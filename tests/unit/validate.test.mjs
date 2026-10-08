// Schema validation and safe import: P0-04, P0-07, AC-7, AC-11.
import test from "node:test";
import assert from "node:assert/strict";
import { lib, example, tinyEngagement } from "./helpers.mjs";

const { validateEngagement, parseEngagementText } = lib("validate");

test("every bundled example validates without errors", () => {
  ["underwriting", "underwriting-current-state", "cash-matching", "rpa-delivery"].forEach(name => {
    const r = validateEngagement(example(name));
    assert.equal(r.ok, true, name + ": " + JSON.stringify(r.errors));
  });
});

test("malformed JSON is rejected with a readable message", () => {
  const r = parseEngagementText("{ not json");
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /not valid JSON/);
  assert.equal(r.engagement, null);
});

test("a file that is not an engagement is rejected", () => {
  const r = validateEngagement({ PROCESS: { before: {} } });
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /not a BPMVIZ engagement/);
});

test("a file from a newer schema version is rejected", () => {
  const e = tinyEngagement();
  e.schemaVersion = 99;
  const r = validateEngagement(e);
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /newer BPMVIZ/);
});

test("invalid references are rejected with field paths", () => {
  const e = tinyEngagement();
  e.models[0].edges.push({ id: "bad", from: "work", to: "nowhere" });
  e.models[0].nodes[1].laneId = "missing-lane";
  const r = validateEngagement(e);
  assert.equal(r.ok, false);
  const paths = r.errors.map(x => x.path);
  assert.ok(paths.includes("models[0].edges[5].to"));
  assert.ok(paths.includes("models[0].nodes[1].laneId"));
});

test("duplicate IDs are rejected", () => {
  const e = tinyEngagement();
  e.models[0].nodes[2].id = "work";
  const r = validateEngagement(e);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(x => /Duplicate ID/.test(x.message)));
});

test("non-finite and negative timing is rejected", () => {
  const e = tinyEngagement();
  e.scenarios.push({ id: "s1", name: "S", runs: { "m-current": { visits: [
    { id: "v1", nodeId: "start", start: -5, end: 0 },
    { id: "v2", nodeId: "work", start: 0, end: 1e400 },
    { id: "v3", nodeId: "check", start: 10, end: 5 }
  ] } } });
  const r = validateEngagement(e);
  assert.equal(r.ok, false);
  const messages = r.errors.map(x => x.path + " " + x.message).join("\n");
  assert.match(messages, /visits\[0\]\.start Must be at least 0/);
  assert.match(messages, /visits\[1\]\.end Expected a finite number/);
  assert.match(messages, /visits\[2\]\.end A visit cannot end before it starts/);
});

test("transitions must match their connector's steps", () => {
  const e = tinyEngagement();
  e.scenarios.push({ id: "s1", name: "S", runs: { "m-current": {
    visits: [{ id: "v1", nodeId: "start", start: 0, end: 0 }, { id: "v2", nodeId: "check", start: 0, end: 1 }],
    transitions: [{ edgeId: "e1", fromVisitId: "v1", toVisitId: "v2" }]
  } } });
  const r = validateEngagement(e);
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /do not match/);
});

test("markup in text stays text; unsafe links are removed", () => {
  const e = tinyEngagement();
  e.models[0].nodes[1].label = "<img src=x onerror=alert(1)>";
  e.evidence.push({ id: "ev1", title: "Source", link: "javascript:alert(1)" });
  const r = validateEngagement(e);
  assert.equal(r.ok, true);
  assert.equal(r.engagement.models[0].nodes[1].label, "<img src=x onerror=alert(1)>");
  assert.equal(r.engagement.evidence[0].link, null);
  assert.ok(r.warnings.some(w => w.code === "link.unsafe"));
});

test("prototype keys and unknown fields are dropped", () => {
  const text = JSON.stringify(tinyEngagement()).replace('"meta":{', '"extra":1,"meta":{')
    .replace('"label":"Do the work"', '"label":"Do the work","details":{"__proto__":{"polluted":true},"desc":"ok"}');
  const r = parseEngagementText(text);
  assert.equal(r.ok, true);
  assert.equal({}.polluted, undefined);
  const details = r.engagement.models[0].nodes[1].details;
  assert.equal(details.desc, "ok");
  assert.equal(Object.prototype.hasOwnProperty.call(details, "__proto__"), false);
  assert.ok(r.warnings.some(w => w.code === "fields.ignored"));
  assert.equal("extra" in r.engagement, false);
});

test("unsupported step types are kept and flagged, not dropped", () => {
  const e = tinyEngagement();
  e.models[0].nodes[3].semanticType = "complexGateway";
  const r = validateEngagement(e);
  assert.equal(r.ok, true);
  const node = r.engagement.models[0].nodes[3];
  assert.equal(node.semanticType, "unsupported");
  assert.equal(node.sourceType, "complexGateway");
  assert.ok(r.warnings.some(w => w.code === "semantic.unsupported"));
});

test("dangling record links and evidence references are removed with warnings", () => {
  const e = tinyEngagement();
  e.records.push({ id: "r1", kind: "pain", title: "Slow", linkedModelId: "m-current", linkedNodeIds: ["work", "ghost"], evidenceRefs: ["ev-none"] });
  const r = validateEngagement(e);
  assert.equal(r.ok, true);
  assert.deepEqual(r.engagement.records[0].linkedNodeIds, ["work"]);
  assert.deepEqual(r.engagement.records[0].evidenceRefs, []);
});

test("save and reopen round-trips IDs, records, owners, evidence and assumptions", () => {
  const e = example("underwriting");
  e.records.push({ id: "rec-1", kind: "opportunity", title: "Pre-fill SOV", owner: "Ops lead", status: "in-progress",
    linkedModelId: "m-current", linkedNodeIds: ["scrub-sov-geocode"], evidenceRefs: ["ev-source-bpmn"],
    opportunity: { intervention: "standardize", validationAction: "Sample 20 submissions" } });
  const first = validateEngagement(e).engagement;
  const reopened = parseEngagementText(JSON.stringify(first));
  assert.equal(reopened.ok, true);
  assert.deepEqual(reopened.engagement, first);
  assert.equal(reopened.engagement.records[0].opportunity.intervention, "standardize");
  assert.deepEqual(reopened.engagement.models[0].nodes.map(n => n.id), first.models[0].nodes.map(n => n.id));
});

test("stable IDs survive reordering nodes and renaming labels", () => {
  const e = tinyEngagement();
  e.models[0].nodes.reverse();
  e.models[0].nodes.find(n => n.id === "work").label = "Renamed";
  e.records.push({ id: "r1", kind: "note", title: "Linked", linkedModelId: "m-current", linkedNodeIds: ["work"] });
  const r = validateEngagement(e);
  assert.equal(r.ok, true);
  assert.deepEqual(r.engagement.records[0].linkedNodeIds, ["work"]);
});

test("oversized files are refused before parsing", () => {
  const r = parseEngagementText("x".repeat(10 * 1024 * 1024 + 1));
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /10 MB/);
});

test("transitions are derived from visits when a run omits them", () => {
  const e = tinyEngagement();
  e.scenarios.push({ id: "s1", name: "S", runs: { "m-current": { visits: [
    { id: "v1", nodeId: "start", start: 0, end: 0 }, { id: "v2", nodeId: "work", start: 0, end: 10 },
    { id: "v3", nodeId: "check", start: 10, end: 10 }, { id: "v4", nodeId: "end", start: 10, end: 10 }
  ] } } });
  const r = validateEngagement(e);
  assert.equal(r.ok, true);
  assert.deepEqual(r.engagement.scenarios[0].runs["m-current"].transitions.map(t => t.edgeId), ["e1", "e2", "e5"]);
  assert.ok(r.warnings.some(w => w.code === "transitions.derived"));
});
