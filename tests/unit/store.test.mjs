// Engagement store: revisions, records, baseline lock and future-state lineage (P0-05, P1-01, P1-05, AC-6).
import test from "node:test";
import assert from "node:assert/strict";
import { lib, example, tinyEngagement } from "./helpers.mjs";

const { createStore, StoreError } = lib("store");
const { validateEngagement } = lib("validate");

function storeFor(e) {
  return createStore(validateEngagement(e).engagement);
}

test("business changes increment the revision and can be undone", () => {
  const store = storeFor(tinyEngagement());
  assert.equal(store.get().revision, 0);
  store.dispatch("node/update", { modelId: "m-current", nodeId: "work", patch: { label: "Prepare the file", details: { owner: "Team lead" } } });
  assert.equal(store.get().revision, 1);
  assert.equal(store.get().models[0].nodes[1].label, "Prepare the file");
  assert.equal(store.get().models[0].nodes[1].details.owner, "Team lead");
  assert.equal(store.undo(), true);
  assert.equal(store.get().models[0].nodes[1].label, "Do the work");
  assert.equal(store.get().revision, 2, "undo is itself a new revision");
});

test("records are added, edited, filtered by kind and deleted with links intact", () => {
  const store = storeFor(tinyEngagement());
  const { id } = store.dispatch("record/add", { record: { kind: "pain", title: "Rework is common", owner: "QA", linkedModelId: "m-current", linkedNodeIds: ["work", "ghost"] } });
  let r = store.get().records.find(x => x.id === id);
  assert.deepEqual(r.linkedNodeIds, ["work"]);
  assert.equal(r.status, "open");
  assert.equal(r.linkedModelVersion, 1);
  store.dispatch("record/update", { id, patch: { status: "in-progress", owner: "Process owner" } });
  r = store.get().records.find(x => x.id === id);
  assert.equal(r.status, "in-progress");
  assert.equal(r.owner, "Process owner");
  assert.deepEqual(r.linkedNodeIds, ["work"]);
  store.dispatch("record/add", { record: { kind: "question", title: "Who approves?" } });
  assert.equal(store.get().records.filter(x => x.kind === "pain").length, 1);
  store.dispatch("record/delete", { id });
  assert.equal(store.get().records.length, 1);
});

test("a record needs a title", () => {
  const store = storeFor(tinyEngagement());
  assert.throws(() => store.dispatch("record/add", { record: { kind: "pain", title: "  " } }), StoreError);
  assert.equal(store.get().revision, 0, "a failed command changes nothing");
});

test("cloning locks the baseline and records lineage for every step", () => {
  const store = storeFor(example("underwriting-current-state"));
  const { modelId } = store.dispatch("model/clone", { sourceModelId: "m-current", name: "Future state draft" });
  const e = store.get();
  const base = e.models.find(m => m.id === "m-current");
  const draft = e.models.find(m => m.id === modelId);
  assert.equal(base.locked, true);
  assert.equal(draft.role, "future");
  assert.deepEqual(draft.basedOn, { modelId: "m-current", version: 1 });
  draft.nodes.forEach(n => assert.equal(n.lineage.baselineNodeId, n.id));
  assert.throws(() => store.dispatch("node/update", { modelId: "m-current", nodeId: base.nodes[1].id, patch: { label: "x" } }),
    err => err.code === "locked");
  assert.equal(validateEngagement(e).ok, true);
});

test("editing, inserting and removing future steps records the change", () => {
  const store = storeFor(example("underwriting-current-state"));
  const { modelId } = store.dispatch("model/clone", { sourceModelId: "m-current" });
  const draft = () => store.get().models.find(m => m.id === modelId);
  const scrub = "scrub-sov-geocode";
  store.dispatch("node/update", { modelId, nodeId: scrub, patch: { label: "Scrub SOV with extraction tool", rationale: "Tool pre-fills fields" } });
  assert.equal(draft().nodes.find(n => n.id === scrub).lineage.change, "modified");

  const edge = draft().edges.find(e => e.from === scrub);
  const { nodeId } = store.dispatch("model/insertStep", { modelId, edgeId: edge.id, label: "Spot-check extraction", rationale: "Keep a human check" });
  const added = draft().nodes.find(n => n.id === nodeId);
  assert.equal(added.lineage.change, "added");
  assert.equal(added.lineage.baselineNodeId, null);
  assert.ok(draft().edges.some(e => e.from === scrub && e.to === nodeId));
  assert.ok(draft().edges.some(e => e.from === nodeId && e.to === edge.to));

  const assign = "assign-to-underwriter";
  store.dispatch("model/removeStep", { modelId, nodeId: assign, rationale: "Routing rules assign automatically" });
  const removed = draft().nodes.find(n => n.id === assign);
  assert.equal(removed.removed, true);
  assert.equal(removed.lineage.change, "removed");
  const live = draft().edges.filter(e => !e.removed);
  assert.ok(!live.some(e => e.from === assign || e.to === assign));
  assert.ok(live.some(e => e.lineage && e.lineage.change === "added" && /Bypasses/.test(e.lineage.rationale)));
  assert.equal(validateEngagement(store.get()).ok, true);
});

test("deleting the only draft unlocks the baseline", () => {
  const store = storeFor(example("underwriting-current-state"));
  const { modelId } = store.dispatch("model/clone", { sourceModelId: "m-current" });
  store.dispatch("model/delete", { modelId });
  assert.equal(store.get().models.find(m => m.id === "m-current").locked, false);
});

test("assumptions and scenario overrides are typed and validated", () => {
  const store = storeFor(example("underwriting"));
  store.dispatch("assumption/set", { key: "oneTimeInvestment", value: 250000, status: "supplied", source: "Client finance" });
  const a = store.get().assumptions.find(x => x.key === "oneTimeInvestment");
  assert.equal(a.unit, "currency");
  assert.throws(() => store.dispatch("assumption/set", { key: "hourlyRate", value: "abc" }), StoreError);
  store.dispatch("scenario/override", { scenarioId: "case-1", key: "incrementalCostPerCase", value: 200, status: "supplied", note: "Lighter AI use" });
  assert.equal(store.get().scenarios.find(s => s.id === "case-1").economics.overrides.incrementalCostPerCase.value, 200);
});

test("evidence links must be http or https", () => {
  const store = storeFor(tinyEngagement());
  assert.throws(() => store.dispatch("evidence/add", { evidence: { title: "Doc", link: "file:///c:/secret" } }), StoreError);
  const { id } = store.dispatch("evidence/add", { evidence: { title: "Doc", link: "https://example.com/doc" } });
  store.dispatch("node/update", { modelId: "m-current", nodeId: "work", patch: { provenance: { evidenceRefs: [id], source: "client" } } });
  store.dispatch("evidence/delete", { id });
  assert.deepEqual(store.get().models[0].nodes[1].provenance.evidenceRefs, []);
});

test("subscribers hear about every change", () => {
  const store = storeFor(tinyEngagement());
  const events = [];
  store.subscribe((state, event) => events.push(event.type));
  store.dispatch("meta/update", { patch: { clientDisplayName: "Client A", timeBasis: { calendar: "business", businessMinutesPerDay: 450 } } });
  store.undo();
  assert.deepEqual(events, ["meta/update", "undo"]);
  assert.throws(() => store.dispatch("meta/update", { patch: { timeBasis: { businessMinutesPerDay: 0 } } }), StoreError);
});
