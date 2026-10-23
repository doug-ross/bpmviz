// Value dimensions step 3: a comparison group in the event-log comparison
// (lib/benefits.js). Two logs from a team that did not get the change give
// a difference in differences, so what moved for both teams is not counted.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { lib, tinyEngagement, datasetFixture, root } from "./helpers.mjs";

const benefits = lib("benefits");
const { validateEngagement } = lib("validate");
const { createStore, StoreError } = lib("store");

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, (msg || "") + ": " + a + " is not " + b);

/* A copy of the tiny baseline log under a new ID, with the work step's median duration set. */
function groupLog(id, workMinutes) {
  const d = datasetFixture("tiny-baseline");
  Object.assign(d, { id, name: "Team without the change, " + id, comparesToDatasetId: null });
  d.steps.find(s => s.nodeId === "work").duration.p50 = workMinutes;
  return d;
}

/* The tiny project with a baseline and after log, the group's two logs, and one opportunity on the work step. */
function project(groupAfterWorkMinutes, group) {
  const e = tinyEngagement();
  e.datasets = [datasetFixture("tiny-baseline"), datasetFixture("tiny-after"), groupLog("ds-group-before", 45), groupLog("ds-group-after", groupAfterWorkMinutes)];
  const after = e.datasets[1];
  if (group !== null) after.comparisonGroup = group || { baselineId: "ds-group-before", afterId: "ds-group-after" };
  e.assumptions = [{ id: "as-vol", key: "annualVolume", value: 1460, status: "supplied" }];
  e.records = [{ id: "a", kind: "opportunity", title: "Opportunity a", linkedModelId: "m-current", linkedNodeIds: ["work"],
    opportunity: { intervention: "standardize", effort: "M", valueCase: { modelId: "m-current", nodeIds: ["work"], effortReductionPct: 100, shareOfCasesPct: 100,
      shareSource: "manual", effortSource: "node", confidence: "medium", basis: "illustrative" } } }];
  e.models[0].nodes.find(n => n.id === "work").measures = { touchEffort: { value: 45, unit: "minute" } };
  const r = validateEngagement(e);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r.engagement;
}

test("the step comparison carries the comparison group's durations and the change net of it", () => {
  const cmp = benefits.compareDatasets(project(40), "ds-tiny-baseline", "ds-tiny-after");
  assert.equal(cmp.comparisonGroup.usable, true);
  assert.equal(cmp.comparisonGroup.baseline.id, "ds-group-before");
  const work = cmp.steps.find(s => s.nodeId === "work");
  assert.equal(work.group.duration.after.p50, 40);
  assert.equal(work.group.netChange, (30 - 45) - (40 - 45), "15 minutes faster, of which 5 the other team saw too");
  assert.equal(cmp.steps.find(s => s.nodeId === "fix").group.netChange, -5);
  assert.ok(cmp.caveats.some(c => /moved in step/.test(c)));
  assert.ok(cmp.caveats.some(c => /comparison group's event logs is demonstration data/.test(c)));
  const plain = benefits.compareDatasets(project(40, null), "ds-tiny-baseline", "ds-tiny-after");
  assert.equal("comparisonGroup" in plain, false, "without a group the result keeps its shape");
  assert.equal("group" in plain.steps[0], false);
});

test("the measured change takes out the comparison group's own change", () => {
  const [r] = benefits.expectedVsRealized(project(40), "ds-tiny-baseline", "ds-tiny-after");
  close(r.unadjusted.value, (54 - 33) / 60 * 1460, "45 x 1.2 visits down to 30 x 1.1");
  close(r.groupChange.value, (54 - 48) / 60 * 1460, "the other team went from 45 to 40 minutes a visit");
  close(r.realized.value, (21 - 6) / 60 * 1460);
  assert.match(r.realized.label, /net of the comparison group/);
  assert.equal(r.realized.basis, "illustrative");
  assert.ok(r.notes.some(n => /own change of 146 hours a year is taken out/.test(n)), r.notes.join(" | "));
  close(r.ratio, 365 / 1095);
  assert.equal(r.status, "partial");

  // When the other team got slower, the change it saw is added back.
  close(benefits.expectedVsRealized(project(50), "ds-tiny-baseline", "ds-tiny-after")[0].realized.value, (21 + 6) / 60 * 1460);
  const plain = benefits.expectedVsRealized(project(40, null), "ds-tiny-baseline", "ds-tiny-after")[0];
  assert.equal("unadjusted" in plain, false);
  close(plain.realized.value, 511);
});

test("a comparison group that cannot be used leaves the measured change unadjusted and says why", () => {
  const e = project(40);
  e.datasets.find(d => d.id === "ds-group-after").steps = e.datasets.find(d => d.id === "ds-group-after").steps.filter(s => s.nodeId !== "work");
  let [r] = benefits.expectedVsRealized(e, "ds-tiny-baseline", "ds-tiny-after");
  close(r.realized.value, 511);
  assert.equal(r.groupChange, null);
  assert.ok(r.notes.some(n => /no measured duration for Do the work, so the measured change is not adjusted/.test(n)));

  const e2 = project(40);
  e2.datasets.find(d => d.id === "ds-group-after").timeBasis = { calendar: "business", businessMinutesPerDay: 480 };
  [r] = benefits.expectedVsRealized(e2, "ds-tiny-baseline", "ds-tiny-after");
  close(r.realized.value, 511);
  assert.ok(r.notes.some(n => /measure time differently from the compared logs/.test(n)));
  const cmp = benefits.compareDatasets(e2, "ds-tiny-baseline", "ds-tiny-after");
  assert.equal(cmp.comparisonGroup.usable, false);
  assert.equal("group" in cmp.steps[0], false);

  const e3 = project(40);
  e3.datasets = e3.datasets.filter(d => d.id !== "ds-group-before");
  assert.ok(benefits.compareDatasets(e3, "ds-tiny-baseline", "ds-tiny-after").caveats.some(c => /no longer in the project/.test(c)));
});

test("opening a file keeps a valid comparison group and drops one that names the compared logs", () => {
  const e = project(40);
  const opened = validateEngagement(JSON.parse(JSON.stringify(e)));
  assert.deepEqual(opened.engagement.datasets[1].comparisonGroup, { baselineId: "ds-group-before", afterId: "ds-group-after" });
  assert.equal("comparisonGroup" in opened.engagement.datasets[0], false, "kept only when set");
  for (const bad of [{ baselineId: "ds-tiny-baseline", afterId: "ds-group-after" }, { baselineId: "ds-group-before", afterId: "ds-group-before" },
    { baselineId: "ds-group-before", afterId: "ds-gone" }, "nonsense"]) {
    const raw = JSON.parse(JSON.stringify(e));
    raw.datasets[1].comparisonGroup = bad;
    const v = validateEngagement(raw);
    assert.equal(v.ok, true);
    assert.equal("comparisonGroup" in v.engagement.datasets[1], false, JSON.stringify(bad));
    assert.ok(v.warnings.some(w => /comparisonGroup/.test(w.path)));
  }
  const doc = JSON.parse(fs.readFileSync(path.join(root, "webui", "schema", "engagement.schema.json"), "utf8"));
  assert.deepEqual(doc.$defs.dataset.properties.comparisonGroup.required, ["baselineId", "afterId"]);
});

test("dataset/update records and clears a comparison group, and deleting a log clears it", () => {
  const store = createStore(project(40, null));
  const after = () => store.get().datasets.find(d => d.id === "ds-tiny-after");
  store.dispatch("dataset/update", { id: "ds-tiny-after", patch: { comparisonGroup: { baselineId: "ds-group-before", afterId: "ds-group-after" } } });
  assert.deepEqual(after().comparisonGroup, { baselineId: "ds-group-before", afterId: "ds-group-after" });
  assert.throws(() => store.dispatch("dataset/update", { id: "ds-tiny-after", patch: { comparisonGroup: { baselineId: "ds-tiny-baseline", afterId: "ds-group-after" } } }), StoreError);
  assert.throws(() => store.dispatch("dataset/update", { id: "ds-tiny-after", patch: { comparisonGroup: { baselineId: "ds-group-after", afterId: "ds-group-after" } } }), StoreError);
  assert.throws(() => store.dispatch("dataset/update", { id: "ds-tiny-after", patch: { comparisonGroup: { baselineId: "ds-x", afterId: "ds-group-after" } } }), StoreError);
  store.dispatch("dataset/update", { id: "ds-tiny-after", patch: { comparisonGroup: null } });
  assert.equal("comparisonGroup" in after(), false);

  store.dispatch("dataset/update", { id: "ds-tiny-after", patch: { comparisonGroup: { baselineId: "ds-group-before", afterId: "ds-group-after" } } });
  store.dispatch("dataset/update", { id: "ds-tiny-after", patch: { comparesToDatasetId: null } });
  assert.equal("comparisonGroup" in after(), false, "removing the comparison removes its group");

  store.dispatch("dataset/update", { id: "ds-tiny-after", patch: { comparesToDatasetId: "ds-tiny-baseline", comparisonGroup: { baselineId: "ds-group-before", afterId: "ds-group-after" } } });
  store.dispatch("dataset/delete", { id: "ds-group-after" });
  assert.equal("comparisonGroup" in after(), false);
  assert.equal(after().comparesToDatasetId, "ds-tiny-baseline");
  assert.equal(validateEngagement(store.get()).ok, true);
});
