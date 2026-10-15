import test from "node:test";
import assert from "node:assert/strict";
import { lib, tinyEngagement } from "./helpers.mjs";

const builder = lib("process-builder"), store = lib("store"), validate = lib("validate"), schema = lib("schema");
function setup(raw) {
  const result = validate.validateEngagement(raw || builder.blank({ processName: "Intake" }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const s = store.createStore(result.engagement);
  const send = (verb, p = {}) => s.dispatch("builder/" + verb, { modelId: "m-current", ...p });
  return { s, send, model: () => s.get().models[0] };
}
function valid(e) {
  const result = validate.validateEngagement(JSON.parse(JSON.stringify(e)));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.warnings.filter(w => w.code === "ref.dangling").length, 0);
  return result.engagement;
}

test("blank is a real portable current state with a connected start, end and human lane", () => {
  const e = builder.blank({ processName: "<img src=x onerror=alert(1)>" });
  assert.equal(e.schema, "aixray.engagement"); assert.equal(e.schemaVersion, 1);
  assert.equal(e.meta.processName, "<img src=x onerror=alert(1)>");
  const m = e.models[0];
  assert.equal(m.role, "current"); assert.equal(m.locked, false);
  assert.equal(m.lanes[0].type, "human");
  assert.deepEqual(m.nodes.map(n => n.semanticType), ["startEvent", "endEvent"]);
  assert.equal(m.edges.length, 1); assert.deepEqual(builder.integrity(m), []);
  assert.deepEqual(valid(e), e);
});

test("blank -> insert task -> save/reopen keeps stable IDs, lane and connections", () => {
  const { s, send, model } = setup();
  const { laneId } = send("addLane", { name: "Underwriter" });
  const originalFlow = model().edges[0].id, end = model().nodes[1].id;
  const { nodeId } = send("addNode", { label: "Check application", laneId, edgeId: originalFlow });
  send("updateNode", { nodeId, patch: { label: "Check request", description: "Read the application", laneId, x: 1.5 } });
  const reopened = valid(s.get()), m = reopened.models[0];
  assert.equal(m.nodes.find(n => n.id === nodeId).details.desc, "Read the application");
  assert.equal(m.nodes.find(n => n.id === nodeId).laneId, laneId);
  assert.equal(m.edges.find(ed => ed.id === originalFlow).to, nodeId);
  assert.ok(m.edges.some(ed => ed.from === nodeId && ed.to === end));
  assert.deepEqual(builder.integrity(m), []);
});

test("lane edits reorder stable IDs and require a safe destination before deleting occupied lanes", () => {
  const { send, model, s } = setup();
  const original = model().lanes[0].id, ids = model().nodes.map(n => n.id);
  const { laneId } = send("addLane", { name: "Review", type: "agent" });
  send("updateLane", { laneId, patch: { name: "Review team", type: "human", role: "Reviewer" } });
  send("reorderLane", { laneId, index: 0 });
  assert.equal(model().lanes[0].id, laneId);
  assert.throws(() => send("deleteLane", { laneId: original }), /existing lane/);
  send("deleteLane", { laneId: original, moveToLaneId: laneId });
  assert.ok(model().nodes.every(n => n.laneId === laneId));
  assert.deepEqual(model().nodes.map(n => n.id), ids);
  assert.throws(() => send("deleteLane", { laneId }), /at least one lane/);
  valid(s.get()); s.undo(); assert.equal(model().lanes.length, 2);
});

test("exclusive and parallel gateways support conditional, default and loop flow editing", () => {
  const { send, model, s } = setup(tinyEngagement());
  send("updateFlow", { edgeId: "e3", patch: { semanticType: "conditional", label: "Needs correction" } });
  send("updateFlow", { edgeId: "e5", patch: { semanticType: "default", label: "Otherwise" } });
  send("updateFlow", { edgeId: "e4", patch: { semanticType: "loop" } });
  assert.deepEqual(builder.integrity(model()), []);
  const { nodeId } = send("addNode", { label: "Fork", semanticType: "parallelGateway", laneId: "a" });
  const { edgeId } = send("addFlow", { from: "work", to: nodeId });
  send("updateFlow", { edgeId, patch: { to: "end", label: "Shortcut" } });
  assert.equal(model().edges.find(ed => ed.id === edgeId).to, "end");
  send("deleteFlow", { edgeId });
  assert.equal(model().edges.some(ed => ed.id === edgeId), false);
  send("addFlow", { from: nodeId, to: "fix" });
  send("addFlow", { from: nodeId, to: "end" });
  assert.throws(() => send("addFlow", { from: nodeId, to: "work", semanticType: "conditional", label: "If" }), /exclusive/);
  valid(s.get());
});

test("invalid edits are atomic and do not create undo entries or lose scenario runs", () => {
  const { send, model, s } = setup(tinyEngagement());
  const before = JSON.stringify(s.get());
  const bad = [
    ["addFlow", { from: "end", to: "work" }, /end event/],
    ["addFlow", { from: "work", to: "start" }, /start event/],
    ["addFlow", { from: "work", to: "work", semanticType: "loop" }, /another step/],
    ["addFlow", { from: "check", to: "end", semanticType: "conditional" }, /condition/],
    ["addFlow", { from: "start", to: "work" }, /already exists/],
    ["updateNode", { nodeId: "work", patch: { label: "Changed", laneId: "missing" } }, /existing lane/],
    ["updateNode", { nodeId: "check", patch: { semanticType: "endEvent" } }, /end event/],
    ["deleteNode", { nodeId: "start" }, /at least one start/],
    ["deleteNode", { nodeId: "end" }, /at least one end/]
  ];
  for (const [verb, payload, pattern] of bad) {
    assert.throws(() => send(verb, payload), pattern); assert.equal(JSON.stringify(s.get()), before);
  }
  assert.equal(s.canUndo(), false); assert.equal(model().nodes[1].label, "Do the work");
  send("updateFlow", { edgeId: "e5", patch: { semanticType: "default" } });
  assert.throws(() => send("updateFlow", { edgeId: "e3", patch: { semanticType: "default" } }), /only one default/);
});

test("structural edits discard only affected runs; one undo restores graph and complete timing data", () => {
  const { send, model, s } = setup(tinyEngagement());
  const e = s.get();
  e.scenarios = [{ id: "case-a", runs: { "m-current": { membership: { work: "included" }, visits: [{ nodeId: "work", start: 0, end: 10 }], traversals: [], milestones: { done: 10 } }, other: { visits: [] } } }, { id: "case-b", runs: { other: {} } }];
  const old = JSON.stringify(e.scenarios[0].runs["m-current"]);
  const result = send("deleteFlow", { edgeId: "e2" });
  assert.deepEqual(result.invalidatedScenarioIds, ["case-a"]);
  assert.equal(s.get().scenarios[0].runs["m-current"], undefined);
  assert.ok(s.get().scenarios[0].runs.other); assert.ok(s.get().scenarios[1].runs.other);
  assert.equal(model().edges.some(ed => ed.id === "e2"), false);
  s.undo(); assert.equal(JSON.stringify(s.get().scenarios[0].runs["m-current"]), old);
  assert.ok(model().edges.some(ed => ed.id === "e2"));
});

test("an authored route loses its derived effort and elapsed figures after a builder edit; undo restores them", () => {
  lib("walkthrough");
  const raw = tinyEngagement();
  raw.models.push({ ...structuredClone(raw.models[0]), id: "m-other", role: "future", name: "Other process" });
  const { s, send } = setup(raw);
  const { scenarioId } = s.dispatch("walkthrough/create", { name: "Authored route" });
  const rows = [
    { nodeId: "start", wait: 0, duration: 0, effort: 0 },
    { nodeId: "work", edgeId: "e1", wait: 3, duration: 8, effort: 4 },
    { nodeId: "check", edgeId: "e2", wait: 0, duration: 2, effort: 1 },
    { nodeId: "end", edgeId: "e5", wait: 0, duration: 0, effort: 0 }
  ];
  for (const modelId of ["m-current", "m-other"]) s.dispatch("walkthrough/saveRun", { scenarioId, modelId, rows });
  s.dispatch("measure/set", { scenarioId, modelId: "m-current", key: "costPerCase", label: "Provided cost per case", value: 120, unit: "currency" });
  const before = structuredClone(s.get().scenarios);
  assert.ok(before[0].measures.some(m => m.key === "humanTouch" && m.values["m-current"] === 5));
  assert.ok(before[0].measures.some(m => m.key === "cycleTime" && m.values["m-current"] === 13));
  const result = send("addNode", { label: "Additional review", laneId: "a", edgeId: "e2" });
  assert.deepEqual(result.invalidatedScenarioIds, [scenarioId]);
  const after = s.get().scenarios[0];
  assert.equal(after.runs["m-current"], undefined);
  assert.deepEqual(after.runs["m-other"], before[0].runs["m-other"]);
  for (const measure of after.measures) {
    if (measure.key.startsWith("walkthroughEffort-") || ["humanTouch", "cycleTime"].includes(measure.key)) {
      assert.equal(measure.values["m-current"], undefined);
      assert.ok(Object.hasOwn(measure.values, "m-other"));
    }
  }
  assert.equal(after.measures.find(m => m.key === "costPerCase").values["m-current"], 120);
  valid(s.get());
  s.undo(); assert.deepEqual(s.get().scenarios, before);
});

test("future alternatives lock baseline, preserve lineage and can be named independently", () => {
  const { send, s } = setup(tinyEngagement());
  const baseline = JSON.stringify(s.get().models[0].nodes);
  const { modelId } = send("clone", { sourceModelId: "m-current", name: "Simplify" });
  assert.equal(s.get().models[0].locked, true);
  assert.throws(() => send("addLane", { name: "Wrong" }), /locked/);
  assert.throws(() => send("renameModel", { name: "Wrong" }), /locked/);
  s.dispatch("builder/updateNode", { modelId, nodeId: "work", patch: { label: "Faster work" } });
  s.dispatch("builder/renameModel", { modelId, name: "Simplify review" });
  let future = s.get().models.find(m => m.id === modelId);
  assert.deepEqual(future.basedOn, { modelId: "m-current", version: 1 });
  assert.equal(future.nodes.find(n => n.id === "work").lineage.change, "modified");
  s.dispatch("builder/deleteNode", { modelId, nodeId: "fix" });
  future = s.get().models.find(m => m.id === modelId);
  assert.equal(future.nodes.find(n => n.id === "fix").lineage.change, "removed");
  assert.equal(future.edges.find(ed => ed.id === "e4").removed, true);
  const added = s.dispatch("builder/addNode", { modelId, label: "New work", laneId: "a", edgeId: "e1" });
  future = s.get().models.find(m => m.id === modelId);
  assert.deepEqual(future.nodes.find(n => n.id === added.nodeId).lineage, { change: "added", rationale: "", baselineNodeId: null });
  s.dispatch("builder/deleteNode", { modelId, nodeId: added.nodeId });
  valid(s.get()); // Modified inherited connectors must never point at a physically deleted new node.
  const second = send("clone", { sourceModelId: "m-current", name: "Automate" });
  assert.notEqual(second.modelId, modelId);
  assert.equal(JSON.stringify(s.get().models[0].nodes), baseline);
  valid(s.get());
});

test("deleting referenced nodes or reconnecting measured flows is blocked with actionable references", () => {
  const { send, s } = setup(tinyEngagement());
  s.get().records.push({ id: "finding", title: "Investigate", linkedModelId: "m-current", linkedNodeIds: ["work"] });
  assert.throws(() => send("deleteNode", { nodeId: "work" }), /finding Investigate/);
  s.get().records = [];
  s.get().reviewPacks = [{ name: "Review", items: [{ itemRef: "step/m-current/work" }] }];
  assert.throws(() => send("deleteNode", { nodeId: "work" }), /review pack Review/);
  s.get().reviewPacks = [];
  s.get().datasets = [{ name: "Measured", modelId: "m-current", transitions: [{ fromNodeId: "work", toNodeId: "check", edgeIds: ["e2"] }] }];
  assert.throws(() => send("deleteNode", { nodeId: "work" }), /event log Measured/);
  assert.throws(() => send("deleteFlow", { edgeId: "e2" }), /event log Measured/);
  assert.throws(() => send("updateFlow", { edgeId: "e2", patch: { to: "end" } }), /event log Measured/);
  assert.throws(() => send("addNode", { label: "Inserted", laneId: "a", edgeId: "e2" }), /event log Measured/);
});

test("checks find disconnected work, a loop without exit and incomplete gateway routing", () => {
  const { send, model } = setup();
  const laneId = model().lanes[0].id;
  const { nodeId } = send("addNode", { label: "Isolated", laneId });
  let issues = builder.integrity(model());
  assert.ok(issues.some(x => x.code === "node.unreachable" && x.nodeId === nodeId));
  assert.ok(issues.some(x => x.code === "node.noEnd" && x.nodeId === nodeId));
  const fork = send("addNode", { label: "Decide", laneId, semanticType: "exclusiveGateway" }).nodeId;
  send("addFlow", { from: fork, to: nodeId });
  issues = builder.integrity(model());
  assert.ok(issues.some(x => x.code === "gateway.branches"));
  send("addFlow", { from: fork, to: model().nodes[1].id });
  assert.ok(builder.integrity(model()).some(x => x.code === "gateway.default"));
});

test("commands enforce schema limits and reject unknown types", () => {
  const { send, model } = setup();
  assert.throws(() => send("addLane", { name: "Bad", type: "robot" }), /valid lane type/);
  assert.throws(() => send("addNode", { label: "Bad", laneId: "team", semanticType: "arbitrary" }), /valid step type/);
  while (model().lanes.length < schema.LIMITS.lanesPerModel) send("addLane", { name: "Lane" });
  assert.throws(() => send("addLane", { name: "Overflow" }), /lane limit/);
});
