import test from "node:test";
import assert from "node:assert/strict";
import { lib, tinyEngagement } from "./helpers.mjs";

const W = lib("walkthrough"), V = lib("validate"), R = lib("replay"), S = lib("store");
function setup() {
  const e = tinyEngagement();
  const future = structuredClone(e.models[0]); future.id = "m-future"; future.role = "future"; future.name = "Future";
  e.models.push(future);
  const result = V.validateEngagement(e); assert.equal(result.ok, true);
  const store = S.createStore(result.engagement);
  const { scenarioId } = store.dispatch("walkthrough/create", { name: "Explicit route" });
  return { store, scenarioId };
}
const route = (duration = 5, effort = 2) => [
  { nodeId: "start", wait: 0, duration: 0, effort: 0, start: 10 },
  { nodeId: "work", edgeId: "e1", wait: 3, duration, effort },
  { nodeId: "check", edgeId: "e2", wait: 0, duration: 0, effort: 0 },
  { nodeId: "fix", edgeId: "e3", wait: 0, duration: 4, effort: 1 },
  { nodeId: "work", edgeId: "e4", wait: 2, duration, effort },
  { nodeId: "check", edgeId: "e2", wait: 0, duration: 0, effort: 0 },
  { nodeId: "end", edgeId: "e5", wait: 0, duration: 0, effort: 0 }
];

test("guided walking chooses labeled branches, supports Previous, rework and divergent history", () => {
  const e = tinyEngagement(); let walk = W.begin(e, "m-current", "start");
  walk = W.next(e, walk); walk = W.next(e, walk);
  assert.throws(() => W.next(e, walk), /Choose a labeled branch/);
  walk = W.next(e, walk, "e3"); walk = W.next(e, walk);
  assert.deepEqual(walk.nodeIds, ["start", "work", "check", "fix", "work"]);
  walk = W.previous(W.previous(walk));
  walk = W.next(e, walk, "e5");
  assert.deepEqual(walk.nodeIds, ["start", "work", "check", "end"]);
  assert.throws(() => W.next(e, walk), /no outgoing/);
  assert.equal(W.previous(W.begin(e, "m-current", "start")).cursor, 0);
});

test("walk scope survives findings but resets on structural changes, model versions and engagement identity", () => {
  const e = tinyEngagement(), walk = W.begin(e, "m-current", "start");
  e.revision++; e.records.push({ id: "note" }); assert.equal(W.validWalk(e, walk), true);
  e.models[0].nodes[0].label = "Changed"; assert.equal(W.validWalk(e, walk), false);
  assert.throws(() => W.next(e, walk), /process changed/);
  e.models[0].nodes[0].label = "Start"; e.id = "another"; assert.equal(W.validWalk(e, walk), false);
});

test("parallel guidance states the limits and does not infer execution or excluded membership", () => {
  const model = tinyEngagement().models[0]; model.nodes[2].semanticType = "parallelGateway";
  assert.match(W.guidance(model, "check"), /Other branches and synchronization/);
  const built = W.buildRun(model, route().slice(0, 3));
  assert.equal(built.run.membership.fix, "unknown");
  assert.equal(built.run.transitions.length, 2);
});

test("path validation refuses disconnected steps, ambiguous edges, backwards times, nonnumbers and excessive loops", () => {
  const model = tinyEngagement().models[0];
  assert.throws(() => W.buildRun(model, [route()[0], route()[3]]), /connector/);
  model.edges.push({ id: "duplicate", from: "start", to: "work", label: "Alternate" });
  const ambiguous = route().slice(0, 2); delete ambiguous[1].edgeId;
  assert.throws(() => W.buildRun(model, ambiguous), /selected connector/);
  const backward = route(); backward[1].start = 5;
  assert.throws(() => W.buildRun(model, backward), /starts before/);
  for (const invalid of ["", "  ", -1, "bad", Infinity, false, [], {}]) {
    const rows = route(); rows[1].duration = invalid; assert.throws(() => W.buildRun(model, rows), /nonnegative/);
  }
  const e = tinyEngagement(); let walk = W.begin(e, "m-current", "work");
  assert.throws(() => { for (let i = 0; i < 100; i++) { walk = W.next(e, walk, "e2"); walk = W.next(e, walk, "e3"); walk = W.next(e, walk, "e4"); } }, /Visit limit/);
  assert.throws(() => W.buildRun(model, Array(101).fill(route()[0])), /1 to 100/);
});

test("timed routes separate effort, wait and elapsed span; unknown effort suppresses totals", () => {
  const model = tinyEngagement().models[0], built = W.buildRun(model, route());
  assert.equal(built.humanTouch, 5); assert.equal(built.cycleTime, 19);
  assert.deepEqual(built.run.visits[4], { id: "v5", nodeId: "work", start: 24, end: 29 });
  const rows = route(); rows[4].effort = "";
  assert.equal(W.buildRun(model, rows).humanTouch, null);
  rows[4].effort = 0; assert.equal(W.buildRun(model, rows).humanTouch, 3);
});

test("before/future runs persist through sanitization and JSON reload, replay repeated visits with explicit transitions", () => {
  const { store, scenarioId } = setup();
  for (const modelId of ["m-current", "m-future"]) store.dispatch("walkthrough/saveRun", { scenarioId, modelId, rows: route() });
  const saved = JSON.stringify(store.get()), result = V.validateEngagement(JSON.parse(saved));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.warnings.filter(w => w.code === "unknown.field").length, 0);
  const s = result.engagement.scenarios[0], model = result.engagement.models[0];
  assert.equal(s.runs["m-current"].transitions.length, 6);
  assert.equal(s.measures.find(m => m.key === "humanTouch").values["m-future"], 5);
  assert.deepEqual(W.rowsFor(s, "m-current").map(r => r.effort), [0, 2, 0, 1, 2, 0, 0]);
  const replay = R.buildReplay(model, s.runs[model.id], result.engagement.meta.timeBasis);
  assert.equal(R.nodeStateAt(replay, "work", 25).visitIndex, 1);
  assert.equal(R.edgeStateAt(replay, model.edges.find(e => e.id === "e4"), 25), "active");
  store.dispatch("walkthrough/rename", { scenarioId, name: "Renamed" }); assert.equal(store.get().scenarios[0].name, "Renamed");
  store.dispatch("walkthrough/delete", { scenarioId }); assert.equal(store.get().scenarios.length, 0);
  store.undo(); assert.equal(store.get().scenarios[0].name, "Renamed");
});

test("invalid writes are atomic and editing observed timings removes measured provenance", () => {
  const { store, scenarioId } = setup(), revision = store.get().revision;
  assert.throws(() => store.dispatch("walkthrough/saveRun", { scenarioId, modelId: "m-current", rows: [{ nodeId: "ghost" }] }), /missing/);
  assert.equal(store.get().revision, revision);
  store.get().scenarios[0].observedFrom = { datasetId: "source" }; store.get().scenarios[0].provenance = "observed";
  store.dispatch("walkthrough/saveRun", { scenarioId, modelId: "m-current", rows: route() });
  assert.equal(store.get().scenarios[0].observedFrom, undefined);
  assert.equal(store.get().scenarios[0].provenance, "supplied");
  const unknown = route(); unknown[1].effort = "";
  store.dispatch("walkthrough/saveRun", { scenarioId, modelId: "m-current", rows: unknown });
  assert.equal(store.get().scenarios[0].measures.some(m => m.key === "humanTouch"), false);
});

test("editing hour-based measures converts other model values and downgrades edited evidence", () => {
  const { store, scenarioId } = setup();
  store.get().scenarios[0].measures = [{ key: "humanTouch", label: "Human effort", unit: "hour", values: { "m-current": 2, "m-future": 1 }, status: "observed", suppliedText: { "m-current": "Two hours" } }];
  store.dispatch("walkthrough/saveRun", { scenarioId, modelId: "m-current", rows: route() });
  const measure = store.get().scenarios[0].measures.find(m => m.key === "humanTouch");
  assert.equal(measure.unit, "minute");
  assert.deepEqual(measure.values, { "m-current": 5, "m-future": 60 });
  assert.equal(measure.status, "supplied");
  assert.equal(measure.suppliedText["m-current"], undefined);
});

test("alternatives use explicit overrides, preserve routes, calculate existing economics and never invent savings", () => {
  const { store, scenarioId } = setup();
  store.dispatch("walkthrough/saveRun", { scenarioId, modelId: "m-current", rows: route(5, 2) });
  store.dispatch("walkthrough/saveRun", { scenarioId, modelId: "m-future", rows: route(4, 1) });
  const assumptions = value => ({ overrides: { hourlyRate: { value, status: "supplied", note: "Finance assumption" }, annualVolume: { value: 1000 }, incrementalCostPerCase: { value: 0 }, productiveHoursPerFte: { value: 1000 } } });
  const before = JSON.stringify(store.get());
  assert.throws(() => store.dispatch("walkthrough/variants", { scenarioId, variants: { expected: assumptions(60) } }), /Conservative/);
  assert.equal(JSON.stringify(store.get()), before);
  const { scenarioIds } = store.dispatch("walkthrough/variants", { scenarioId, variants: { conservative: assumptions(30), expected: assumptions(60), optimistic: assumptions(90) } });
  assert.equal(scenarioIds.length, 3);
  const compared = W.compare(store.get(), scenarioIds);
  assert.deepEqual(compared.map(c => c.outputs.find(o => o.key === "annualCostDifference").value), [1000, 2000, 3000]);
  assert.deepEqual(store.get().scenarios[1].runs, store.get().scenarios[0].runs);
  assert.equal(store.get().scenarios[0].economics.overrides.hourlyRate, undefined);
  assert.equal(V.validateEngagement(JSON.parse(JSON.stringify(store.get()))).ok, true);
  assert.throws(() => store.dispatch("walkthrough/setAssumptions", { scenarioId, overrides: { inventedSavings: { value: 10 } } }), /Unknown economics/);
  assert.throws(() => store.dispatch("walkthrough/setAssumptions", { scenarioId, beforeModelId: "m-current", afterModelId: "m-current" }), /different/);
});

test("graph invalidation removes authored values only for the changed model and suppresses stale economics", () => {
  const { store, scenarioId } = setup();
  for (const modelId of ["m-current", "m-future"]) store.dispatch("walkthrough/saveRun", { scenarioId, modelId, rows: route() });
  const e = store.get(), s = e.scenarios[0];
  s.measures.push({ key: "independent", note: "From a separate study", values: { "m-current": 42 } });
  delete s.runs["m-current"];
  assert.equal(W.invalidateModelMeasures(s, "m-current"), 9);
  assert.equal(s.measures.find(m => m.key === "humanTouch").values["m-current"], undefined);
  assert.equal(s.measures.find(m => m.key === "humanTouch").values["m-future"], 5);
  assert.equal(s.measures.find(m => m.key === "independent").values["m-current"], 42);
  const cost = lib("economics").computeValue(e, s).outputs.find(o => o.key === "costSaved");
  assert.equal(cost.value, null);
});

test("shared graph helper invalidates walkthrough-derived economics and undo restores the authored run", () => {
  const { store, scenarioId } = setup();
  for (const modelId of ["m-current", "m-future"]) store.dispatch("walkthrough/saveRun", { scenarioId, modelId, rows: route() });
  store.dispatch("walkthrough/setAssumptions", { scenarioId, overrides: { hourlyRate: { value: 60 }, annualVolume: { value: 1000 }, incrementalCostPerCase: { value: 0 }, productiveHoursPerFte: { value: 1000 } } });
  const copy = structuredClone(store.get());
  assert.deepEqual(S.helpers.invalidateModelRuns(copy, "m-future"), [scenarioId]);
  assert.equal(copy.scenarios[0].runs["m-future"], undefined);
  assert.equal(copy.scenarios[0].measures.find(m => m.key === "humanTouch").values["m-future"], undefined);
  assert.equal(W.compare(copy, [scenarioId])[0].outputs.find(o => o.key === "annualCostDifference")?.value ?? null, null);
  store.dispatch("node/update", { modelId: "m-future", nodeId: "check", patch: { semanticType: "parallelGateway" } });
  assert.equal(store.get().scenarios[0].runs["m-future"], undefined);
  assert.equal(store.get().scenarios[0].measures.find(m => m.key === "humanTouch").values["m-future"], undefined);
  store.undo();
  assert.equal(store.get().scenarios[0].runs["m-future"].visits.length, 7);
  assert.equal(store.get().scenarios[0].measures.find(m => m.key === "humanTouch").values["m-future"], 5);
});
