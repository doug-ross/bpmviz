import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { lib, tinyEngagement, root } from "./helpers.mjs";

const W = lib("workshop"), S = lib("store");
W.registerStoreCommands(S);
function design(patch = {}) {
  return Object.assign({ modelId: "m-current", nodeId: "work", responsibility: "ai-assist", owner: "Operator", sensitive: false, reviewed: true }, Object.fromEntries(W.DESIGN_FIELDS.map(k => [k, k + " definition"])), patch);
}
function setup() {
  const store = S.createStore(lib("validate").validateEngagement(tinyEngagement()).engagement);
  store.dispatch("workshop/setModels", { currentModelId: "m-current" });
  return store;
}
function checkpoint(store, patch = {}) {
  store.dispatch("workshop/checkpoint", { checkpoint: Object.assign({ reviewer: "Reviewer", date: "2026-10-15", reviewed: true, sensitive: false,
    criteria: [{ id: "criterion-1", text: "All failed cases reach an operator within 5 minutes", owner: "Pilot owner" }], acceptedRecordIds: [], unresolvedRecordIds: [] }, patch) });
}

test("workshop sanitizer roundtrips bounded plain JSON and drops unknown or dangling fields", () => {
  const e = tinyEngagement();
  const raw = { currentModelId: "m-current", futureModelId: "missing", extra: "discard", agenda: [
    { id: "agenda-1", title: "Opening", owner: "Facilitator", minutes: 900, status: "done", extra: {} },
    { id: "agenda-1", title: "Duplicate" }, { id: "bad/id", title: "Invalid" }
  ], designs: [design({ inputs: "i".repeat(3000), extra: "discard" }), design(), design({ nodeId: "gone" }), null] };
  const actual = W.sanitizeWorkshop(raw, e);
  assert.equal(actual.futureModelId, null);
  assert.equal(actual.agenda.length, 1);
  assert.equal(actual.agenda[0].minutes, 480);
  assert.equal(actual.designs.length, 1);
  assert.equal(actual.designs[0].inputs.length, W.LIMITS.text);
  assert.equal(actual.extra, undefined);
  assert.equal(actual.designs[0].extra, undefined);
  assert.deepEqual(W.sanitizeWorkshop(JSON.parse(JSON.stringify(actual)), e), actual);
  assert.equal(W.sanitizeWorkshop(undefined, e), undefined);
  assert.equal(W.sanitizeWorkshop(null, e), undefined);
  assert.doesNotThrow(() => W.sanitizeWorkshop({ agenda: [null, 42], designs: [{ modelId: "missing" }], checkpoint: {} }, e));
  const capped = W.sanitizeWorkshop({ agenda: Array.from({ length: 500 }, (_, i) => ({ id: "a" + i, title: "Agenda", minutes: 15 })) }, e);
  assert.equal(capped.agenda.length, W.LIMITS.agenda);
  assert.equal(W.WORKSHOP_SCHEMA.additionalProperties, false);
});

test("workshop library loads before validation/store as a browser script and without DOM/network", () => {
  const sandbox = { AIxRay: { util: lib("util"), schema: lib("schema") } };
  vm.runInNewContext(fs.readFileSync(path.join(root, "webui/js/lib/workshop.js"), "utf8"), sandbox);
  assert.equal(typeof sandbox.AIxRay.workshop.registerStoreCommands, "function");
  assert.match(sandbox.AIxRay.workshop.fingerprint(tinyEngagement()), /^ws1-[a-f0-9]{16}$/);
});

test("store commands persist workshop with one undo per operation", () => {
  const s = setup();
  s.dispatch("workshop/saveAgenda", { agenda: [{ id: "agenda-1", title: "Design discussion", minutes: 30, status: "active", owner: "Facilitator" }] });
  s.dispatch("workshop/saveDesign", { design: design() });
  const reopened = JSON.parse(lib("exporting").engagementToJson(s.get()));
  assert.deepEqual(W.sanitizeWorkshop(reopened.workshop, reopened), s.get().workshop);
  s.dispatch("workshop/saveDesign", { design: design({ trigger: "A new request" }) });
  assert.equal(s.get().workshop.designs.length, 1);
  assert.equal(s.get().workshop.designs[0].trigger, "A new request");
  assert.equal(s.undo(), true);
  assert.equal(s.get().workshop.designs[0].trigger, "trigger definition");
  s.dispatch("workshop/deleteDesign", { modelId: "m-current", nodeId: "work" });
  assert.equal(s.get().workshop.designs.length, 0);
});

test("reviewed automation requires owner, fallback, approval and tests; invalid commands do not mutate", () => {
  const s = setup(), rev = s.get().revision;
  for (const patch of [{ owner: "" }, { fallback: "" }, { approval: "" }, { testCriteria: "" }, { nodeId: "missing" }, { responsibility: "unknown" }]) {
    assert.throws(() => s.dispatch("workshop/saveDesign", { design: design(patch) }), S.StoreError);
  }
  assert.equal(s.get().revision, rev);
  s.dispatch("workshop/saveDesign", { design: design({ reviewed: false, fallback: "", owner: "" }) });
  assert.equal(s.get().workshop.designs[0].reviewed, false);
  assert.throws(() => s.dispatch("workshop/saveAgenda", { agenda: [{ id: "a", title: "", minutes: 0 }] }), /Agenda items/);
  assert.throws(() => s.dispatch("workshop/setModels", { currentModelId: "missing" }), /existing current/);
});

test("checkpoint captures versions, reviewer/date/criteria and ignores agenda and revision bookkeeping", () => {
  const s = setup();
  s.dispatch("workshop/saveDesign", { design: design() });
  checkpoint(s);
  assert.equal(W.checkpointStatus(s.get()).status, "current");
  const before = W.fingerprint(s.get());
  s.dispatch("workshop/saveAgenda", { agenda: [{ id: "a", title: "Wrap up", minutes: 5, status: "done" }] });
  assert.equal(W.fingerprint(s.get()), before);
  assert.equal(W.checkpointStatus(s.get()).status, "current");
  assert.deepEqual(s.get().workshop.checkpoint.modelVersions, [{ modelId: "m-current", version: 1 }]);
  const changed = structuredClone(s.get());
  changed.revision += 1; changed.updatedAt = "tomorrow"; changed.models[0].presentation = { zoom: 99 }; changed.models[0].version = 100;
  assert.equal(W.fingerprint(changed), before);
  assert.equal(W.fingerprint(JSON.parse(JSON.stringify(s.get()))), before);
  s.dispatch("workshop/saveDesign", { design: design({ rules: "A changed limit" }) });
  assert.equal(W.checkpointStatus(s.get()).status, "stale");
  assert.equal(W.buildPilotBrief(s.get()).checkpoint, null);
  checkpoint(s); assert.equal(W.checkpointStatus(s.get()).status, "current");
  s.dispatch("node/update", { modelId: "m-current", nodeId: "work", patch: { label: "Updated work" } });
  assert.equal(W.checkpointStatus(s.get()).status, "stale");
  s.dispatch("workshop/clearCheckpoint"); assert.equal(W.checkpointStatus(s.get()).status, "missing");
});

test("checkpoints reject invalid dates and ownerless acceptance criteria", () => {
  const s = setup();
  assert.throws(() => checkpoint(s, { date: "2026-02-30" }), /valid date/);
  assert.throws(() => checkpoint(s, { criteria: [] }), /criterion/);
  assert.throws(() => checkpoint(s, { criteria: [{ id: "c", text: "Faster", owner: "" }] }), /owner/);
  assert.throws(() => checkpoint(s, { acceptedRecordIds: ["missing"] }), /existing findings/);
  const empty = S.createStore(tinyEngagement());
  assert.throws(() => checkpoint(empty), /Agree a current process/);
});

test("current and stale checkpoints preserve their status across validated save/reopen", () => {
  const s = setup();
  s.dispatch("workshop/saveDesign", { design: design() });
  checkpoint(s);
  const reopen = () => {
    const result = lib("validate").parseEngagementText(JSON.stringify(s.get()));
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    return result.engagement;
  };
  assert.equal(W.checkpointStatus(reopen()).status, "current");
  assert.equal(W.fingerprint(reopen()), W.fingerprint(s.get()));
  s.dispatch("node/update", { modelId: "m-current", nodeId: "work", patch: { details: { desc: "A newly agreed exception" } } });
  assert.equal(W.checkpointStatus(reopen()).status, "stale");
  assert.equal(W.buildPilotBrief(reopen()).checkpoint, null);
});

test("pilot export dynamically excludes sensitive/unreviewed sources, designs and checkpoint details", () => {
  const s = setup();
  const good = s.dispatch("record/add", { record: { kind: "action", title: "Public action", owner: "Owner", includeInHandoff: true } }).id;
  const secret = s.dispatch("record/add", { record: { kind: "decision", title: "SECRET_RECORD", sensitive: true } }).id;
  const ai = s.dispatch("ai/applySuggestions", { records: [{ kind: "action", title: "UNREVIEWED_RECORD" }], stamp: {} }).ids[0];
  s.dispatch("workshop/saveDesign", { design: design() });
  s.dispatch("workshop/saveDesign", { design: design({ nodeId: "fix", sensitive: true, trigger: "SECRET_DESIGN" }) });
  s.dispatch("workshop/saveDesign", { design: design({ nodeId: "check", reviewed: false, trigger: "UNREVIEWED_DESIGN" }) });
  checkpoint(s, { acceptedRecordIds: [good, secret, ai] });
  const brief = W.buildPilotBrief(s.get()), output = W.pilotBriefText(s.get());
  assert.equal(brief.checkpoint.accepted.length, 1);
  assert.equal(brief.designs.length, 1);
  assert.match(output, /Public action/);
  assert.match(output, /Pilot owner/);
  assert.doesNotMatch(output, /SECRET_|UNREVIEWED_/);
  checkpoint(s, { reviewer: "PRIVATE_REVIEWER", sensitive: true, criteria: [{ id: "c", text: "PRIVATE_CRITERION", owner: "PRIVATE_OWNER" }] });
  assert.doesNotMatch(W.pilotBriefText(s.get()), /PRIVATE_/);
  checkpoint(s, { reviewer: "DRAFT_REVIEWER", reviewed: false });
  assert.doesNotMatch(W.pilotBriefText(s.get()), /DRAFT_REVIEWER/);
  checkpoint(s);
  s.dispatch("record/update", { id: good, patch: { sensitive: true } });
  assert.equal(W.checkpointStatus(s.get()).status, "stale");
  assert.doesNotMatch(W.pilotBriefText(s.get()), /Public action|Pilot owner/);
});

test("agreed future IDs and model AI review gate prevent unreviewed process labels and copied checkpoint text", () => {
  const s = setup();
  const { modelId } = s.dispatch("model/clone", { sourceModelId: "m-current", name: "Future process" });
  s.dispatch("workshop/setModels", { currentModelId: "m-current", futureModelId: modelId });
  checkpoint(s);
  assert.equal(W.buildPilotBrief(s.get()).models.length, 2);
  const e = structuredClone(s.get());
  e.models.find(m => m.id === modelId).generated = { reviewed: false };
  e.models.find(m => m.id === modelId).name = "SECRET_MODEL";
  assert.doesNotMatch(W.pilotBriefText(e), /SECRET_MODEL|Pilot owner/);
  const poisoned = W.sanitizeWorkshop({ designs: [design({ generated: { reviewed: false } })] }, s.get());
  assert.equal(poisoned.designs[0].reviewed, false);
});

test("unvalidated AI step designs and incomplete imported reviewed designs stay out of pilot text", () => {
  const s = setup();
  s.dispatch("workshop/saveDesign", { design: design() });
  const e = structuredClone(s.get());
  const node = e.models[0].nodes.find(n => n.id === "work");
  node.provenance = { source: "generated", validation: "unvalidated" };
  node.label = "DRAFT_STEP";
  assert.equal(W.buildPilotBrief(e).designs.length, 0);
  assert.doesNotMatch(W.pilotBriefText(e), /DRAFT_STEP/);
  node.provenance.validation = "validated";
  assert.equal(W.buildPilotBrief(e).designs.length, 1);
  e.workshop.designs[0].owner = "";
  assert.equal(W.buildPilotBrief(e).designs.length, 0);
});
