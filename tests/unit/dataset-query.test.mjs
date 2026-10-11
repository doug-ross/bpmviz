// Read-only questions about event-log datasets (lib/dataset-query.js).
import test from "node:test";
import assert from "node:assert/strict";
import { lib, example, tinyEngagement, datasetFixture } from "./helpers.mjs";

const dq = lib("dataset-query");
const { validateEngagement } = lib("validate");
const { createStore } = lib("store");

function tiny() {
  const e = tinyEngagement();
  e.datasets = [datasetFixture("tiny-baseline"), datasetFixture("tiny-after")];
  return validateEngagement(e).engagement;
}

test("datasets are listed, fetched and chosen per model and role", () => {
  const e = tiny();
  assert.deepEqual(dq.list(e).map(d => d.id), ["ds-tiny-baseline", "ds-tiny-after"]);
  assert.deepEqual(dq.list(e, { role: "after" }).map(d => d.id), ["ds-tiny-after"]);
  assert.deepEqual(dq.list(e, { modelId: "m-other" }), []);
  assert.equal(dq.get(e, "ds-tiny-after").name, "Tiny log after the change");
  assert.equal(dq.get(e, "nope"), null);
  assert.equal(dq.forModel(e, "m-current").id, "ds-tiny-baseline");
  assert.equal(dq.forModel(e, "m-current", "after").id, "ds-tiny-after");
  const two = tiny();
  two.datasets.push(Object.assign({}, two.datasets[0], { id: "ds-newer", createdAt: "2026-03-01T00:00:00.000Z" }));
  assert.equal(dq.forModel(two, "m-current").id, "ds-newer", "the most recent baseline wins");
  assert.deepEqual(dq.list(tinyEngagement()), [], "an engagement without datasets is fine");
  assert.equal(dq.forModel({}, "m-current"), null);
});

test("figures from a dataset carry the dataset's status", () => {
  assert.equal(dq.basisOf({ dataStatus: "observed" }), "observed");
  assert.equal(dq.basisOf({ dataStatus: "supplied" }), "supplied");
  assert.equal(dq.basisOf({ dataStatus: "demonstration" }), "illustrative");
  assert.equal(dq.basisOf(null), "supplied");
});

test("step figures, visits per case and annual volume", () => {
  const d = tiny().datasets[0];
  assert.equal(dq.step(d, "work").visits, 120);
  assert.equal(dq.step(d, "check"), null, "gateways have no step figures");
  assert.equal(dq.visitsPerCase(d, "work"), 1.2);
  assert.equal(dq.visitsPerCase(d, "fix"), 1);
  assert.equal(dq.visitsPerCase(d, "ghost"), null);
  assert.equal(dq.annualVolume(d), d.cases.annualizedVolume);
  assert.equal(dq.annualVolume({ cases: {} }), null);
});

test("case share is exact when every case is in a kept variant", () => {
  const d = tiny().datasets[0];
  assert.deepEqual(dq.caseShareForNodes(d, ["fix"]), { value: 0.2, lower: 0.2, upper: 0.2, exact: true });
  assert.deepEqual(dq.caseShareForNodes(d, ["work", "fix"]), { value: 1, lower: 1, upper: 1, exact: true });
  assert.deepEqual(dq.caseShareForNodes(d, []), { value: 0, lower: 0, upper: 0, exact: true });
  assert.equal(dq.caseShareForNodes(null, ["fix"]), null);
});

test("case share gives bounds when some variants were not kept", () => {
  const d = datasetFixture("underwriting-baseline");
  const total = d.variants.reduce((n, v) => n + v.cases, 0) + d.otherVariants.cases;
  const r = dq.caseShareForNodes(d, ["structure-fac-placement-slip"]);
  assert.equal(r.exact, false);
  assert.ok(r.lower <= r.value && r.value <= r.upper);
  assert.ok(Math.abs(r.lower - 40 / total) < 1e-9);
  assert.ok(r.upper <= 50 / total + 1e-9, "at most every case in the variants not kept");
  const all = dq.caseShareForNodes(d, ["submission-received"]);
  assert.ok(all.value > 0.95 && all.upper <= 1);
  const noVariants = { steps: [{ nodeId: "a", caseShare: 0.3 }, { nodeId: "b", caseShare: 0.5 }], variants: [], otherVariants: { variants: 0, cases: 0 } };
  assert.deepEqual(dq.caseShareForNodes(noVariants, ["a"]), { value: 0.3, lower: 0.3, upper: 0.3, exact: true });
  assert.deepEqual(dq.caseShareForNodes(noVariants, ["a", "b"]), { value: 0.5, lower: 0.5, upper: 0.8, exact: false });
});

test("steps correspond between a baseline and its future state in both directions", () => {
  const store = createStore(validateEngagement(example("underwriting-current-state")).engagement);
  const { modelId } = store.dispatch("model/clone", { sourceModelId: "m-current" });
  const draft = () => store.get().models.find(m => m.id === modelId);
  const edge = draft().edges.find(x => x.from === "scrub-sov-geocode");
  const { nodeId } = store.dispatch("model/insertStep", { modelId, edgeId: edge.id, label: "Spot-check extraction" });
  const e = store.get();
  const forward = dq.correspondence(e, "m-current", modelId);
  assert.equal(forward.get("scrub-sov-geocode"), "scrub-sov-geocode");
  assert.equal([...forward.values()].includes(nodeId), false, "an added step has no baseline counterpart");
  const back = dq.correspondence(e, modelId, "m-current");
  assert.equal(back.get("assign-to-underwriter"), "assign-to-underwriter");
  assert.equal(back.has(nodeId), false);
  assert.equal(dq.correspondence(e, "m-current", "m-current").get("check-clearance-dedup"), "check-clearance-dedup");
  assert.equal(dq.correspondence(e, "m-current", "m-missing").size, 0);
});

test("small samples are flagged", () => {
  assert.equal(dq.smallSample({ n: 4 }), true);
  assert.equal(dq.smallSample({ n: 5 }), false);
  assert.equal(dq.smallSample({ n: 29 }, 30), true);
  assert.equal(dq.smallSample(null), true);
});
