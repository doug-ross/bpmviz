// Benefits tracking: dataset-to-dataset comparison and expected-vs-realized (lib/benefits.js).
import test from "node:test";
import assert from "node:assert/strict";
import { lib, example, tinyEngagement, datasetFixture } from "./helpers.mjs";

const benefits = lib("benefits");
const { validateEngagement } = lib("validate");

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, (msg || "") + ": " + a + " is not " + b);

function opp(id, valueCase) {
  return { id, kind: "opportunity", title: "Opportunity " + id, linkedModelId: "m-current", linkedNodeIds: valueCase.nodeIds,
    opportunity: { intervention: "standardize", effort: "M", valueCase } };
}

function tinyWithDatasets(records, assumptions) {
  const e = tinyEngagement();
  e.datasets = [datasetFixture("tiny-baseline"), datasetFixture("tiny-after")];
  if (assumptions) e.assumptions = assumptions;
  if (records) e.records = records;
  const r = validateEngagement(e);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r.engagement;
}

test("compareDatasets reports the two event logs missing from the engagement", () => {
  const e = tinyWithDatasets();
  const cmp = benefits.compareDatasets(e, "ds-tiny-baseline", "nope");
  assert.equal(cmp.overall, null);
  assert.deepEqual(cmp.steps, []);
  assert.deepEqual(cmp.unmatched, []);
  assert.equal(cmp.baseline.id, "ds-tiny-baseline");
  assert.equal(cmp.after, null);
  assert.ok(cmp.caveats.some(c => /no longer in the project/.test(c)));
});

test("compareDatasets compares matched steps and rolls up the dataset totals", () => {
  const e = tinyWithDatasets();
  const cmp = benefits.compareDatasets(e, "ds-tiny-baseline", "ds-tiny-after");
  assert.equal(cmp.baseline.id, "ds-tiny-baseline");
  assert.equal(cmp.after.id, "ds-tiny-after");
  assert.deepEqual(cmp.unmatched, [], "the same model corresponds to itself");

  assert.deepEqual(cmp.overall.cases, { before: 100, after: 100 });
  assert.deepEqual(cmp.overall.annualizedVolume, { before: 1460, after: 1460 });
  assert.equal(cmp.overall.cycleTime.before.p50, 96);
  assert.equal(cmp.overall.cycleTime.after.p50, 56.8);

  // Start and end carry no duration or sojourn, so they are not compared.
  assert.deepEqual(cmp.steps.map(s => s.nodeId).sort(), ["fix", "work"]);

  const work = cmp.steps.find(s => s.nodeId === "work");
  assert.equal(work.afterNodeId, "work");
  assert.equal(work.label, "Do the work");
  assert.equal(work.duration.before.p50, 45);
  assert.equal(work.duration.after.p50, 30);
  close((work.duration.after.p50 - work.duration.before.p50) / work.duration.before.p50 * 100, -100 / 3, "work duration fell by a third");
  assert.equal(work.sojourn.before.p50, 72);
  assert.equal(work.sojourn.after.p50, 48);
  assert.deepEqual(work.reworkRate, { before: 0.2, after: 0.1 });
  assert.deepEqual(work.caseShare, { before: 1, after: 1 });
  close(work.visitsPerCase.before, 1.2);
  close(work.visitsPerCase.after, 1.1);
  assert.equal(work.smallSample, false, "120 and 110 visits are not a small sample");

  const fix = cmp.steps.find(s => s.nodeId === "fix");
  assert.equal(fix.duration.before.p50, 30);
  assert.equal(fix.duration.after.p50, 25);
  assert.deepEqual(fix.caseShare, { before: 0.2, after: 0.1 });
  assert.equal(fix.smallSample, true, "20 and 10 visits are both under the small-sample threshold");

  assert.ok(cmp.caveats.some(c => /fewer than 30 visits/.test(c)));
  assert.ok(cmp.caveats.some(c => /demonstration data/.test(c)));
  assert.equal(cmp.caveats.length, 2, "same period length and same volume raise no caveat");
});

test("compareDatasets does not call a step a small sample just because it has no sojourn", () => {
  const e = tinyWithDatasets();
  e.datasets.forEach(d => { d.steps.find(s => s.nodeId === "work").sojourn = null; });
  const work = benefits.compareDatasets(e, "ds-tiny-baseline", "ds-tiny-after").steps.find(s => s.nodeId === "work");
  assert.equal(work.smallSample, false, "the first step of a case has no sojourn; 120 and 110 visits are plenty");
});

test("compareDatasets flags a period or volume that is not comparable", () => {
  const e = tinyWithDatasets();
  const after = e.datasets.find(d => d.id === "ds-tiny-after");
  after.period.days = 60;
  after.cases.count = 40;
  const cmp = benefits.compareDatasets(e, "ds-tiny-baseline", "ds-tiny-after");
  assert.ok(cmp.caveats.some(c => /different lengths/.test(c)));
  assert.ok(cmp.caveats.some(c => /Case volume differs/.test(c)));
});

test("compareDatasets reports a step that disappeared in the after log, and lists unmatched steps when the logs do not correspond", () => {
  const e = tinyWithDatasets();
  const after = e.datasets.find(d => d.id === "ds-tiny-after");
  after.steps = after.steps.filter(s => s.nodeId !== "fix");
  const dropped = benefits.compareDatasets(e, "ds-tiny-baseline", "ds-tiny-after");
  const fix = dropped.steps.find(s => s.nodeId === "fix");
  assert.ok(fix, "a step still correspond even when the after log has nothing for it");
  assert.equal(fix.duration.after, null);
  assert.deepEqual(dropped.unmatched, [], "disappearing is not the same as not corresponding");

  // No model link at all: nothing corresponds, so every step on each side is unmatched.
  after.modelId = null;
  const cmp = benefits.compareDatasets(e, "ds-tiny-baseline", "ds-tiny-after");
  assert.equal(cmp.steps.length, 0);
  assert.equal(cmp.unmatched.length, e.datasets[0].steps.length + after.steps.length);
  const work = cmp.unmatched.find(u => u.nodeId === "work" && u.side === "baseline");
  assert.ok(work);
  assert.equal(work.label, "Do the work");
  assert.ok(cmp.caveats.some(c => /no match in the other/.test(c)));
});

function expectedCase(id, nodeId, workIndex, hoursMinutes, effortReductionPct, shareOfCasesPct) {
  return opp(id, {
    modelId: "m-current", nodeIds: [nodeId], effortReductionPct, durationReductionPct: null, shareOfCasesPct,
    shareSource: "manual", effortSource: "node", datasetId: null, oneTimeCost: null, annualRunningCost: null,
    confidence: "medium", basis: "illustrative", note: ""
  });
}

test("expectedVsRealized compares the modeled hours saved against what the logs measured: partial", () => {
  const record = expectedCase("a", "work", 1, 45, 100, 100);
  const e = tinyWithDatasets([record], [{ id: "as-vol", key: "annualVolume", value: 1460, status: "supplied" }]);
  e.models[0].nodes.find(n => n.id === "work").measures = { touchEffort: { value: 45, unit: "minute" } };
  const [r] = benefits.expectedVsRealized(e, "ds-tiny-baseline", "ds-tiny-after");
  assert.equal(r.recordId, "a");
  close(r.expected.value, 1095, "1,460 cases x 100% x 0.75 h x 100%");
  assert.equal(r.expected.unit, "hour");
  close(r.realized.value, 511, "(0.9 - 0.55) h x 1 (exact share) x 1,460 cases");
  assert.equal(r.realized.unit, "hour");
  close(r.ratio, 511 / 1095);
  assert.equal(r.status, "partial");
});

test("expectedVsRealized reports met when the measured change covers most of the modeled figure", () => {
  const record = expectedCase("b", "fix", 3, 30, 10, 20);
  const e = tinyWithDatasets([record], [{ id: "as-vol", key: "annualVolume", value: 1460, status: "supplied" }]);
  e.models[0].nodes.find(n => n.id === "fix").measures = { touchEffort: { value: 30, unit: "minute" } };
  const [r] = benefits.expectedVsRealized(e, "ds-tiny-baseline", "ds-tiny-after");
  close(r.expected.value, 14.6, "1,460 cases x 20% x 0.5 h x 10%");
  close(r.realized.value, (0.5 * 0.2 - 25 / 60 * 0.1) * 1460, "the fix step got faster and half as many cases reach it");
  assert.ok(r.ratio >= 0.8, "ratio " + r.ratio + " should be at least 0.8");
  assert.equal(r.status, "met");
});

test("expectedVsRealized labels demonstration logs as illustrative and scales with the value case's own volume", () => {
  const record = expectedCase("v", "work", 1, 45, 100, 100);
  const e = tinyWithDatasets([record], [{ id: "as-vol", key: "annualVolume", value: 400, status: "supplied" }]);
  e.models[0].nodes.find(n => n.id === "work").measures = { touchEffort: { value: 45, unit: "minute" } };
  const [r] = benefits.expectedVsRealized(e, "ds-tiny-baseline", "ds-tiny-after");
  close(r.expected.value, 300, "400 cases x 100% x 0.75 h x 100%");
  close(r.realized.value, (0.9 - 0.55) * 400, "the same 400 cases, not the logs' 1,460 a year");
  assert.equal(r.realized.basis, "illustrative", "both logs are demonstration data");
  e.datasets.forEach(d => { d.dataStatus = "observed"; });
  assert.equal(benefits.expectedVsRealized(e, "ds-tiny-baseline", "ds-tiny-after")[0].realized.basis, "observed");

  // Without a volume in the value case, the after log's annualized volume is used and said so.
  const noVol = tinyWithDatasets([record]);
  noVol.models[0].nodes.find(n => n.id === "work").measures = { touchEffort: { value: 45, unit: "minute" } };
  const [r2] = benefits.expectedVsRealized(noVol, "ds-tiny-baseline", "ds-tiny-after");
  assert.equal(r2.expected, null);
  close(r2.realized.value, (0.9 - 0.55) * 1460);
  assert.ok(r2.notes.some(n => /after log's annualized volume/.test(n)));
  assert.equal(r2.status, "not-measurable");
});

test("expectedVsRealized counts a step no case reaches any more as no time, and refuses logs on different time bases", () => {
  const record = expectedCase("w", "fix", 3, 30, 100, 20);
  const e = tinyWithDatasets([record], [{ id: "as-vol", key: "annualVolume", value: 1460, status: "supplied" }]);
  e.models[0].nodes.find(n => n.id === "fix").measures = { touchEffort: { value: 30, unit: "minute" } };
  const after = e.datasets.find(d => d.id === "ds-tiny-after");
  after.steps = after.steps.filter(s => s.nodeId !== "fix");
  const [r] = benefits.expectedVsRealized(e, "ds-tiny-baseline", "ds-tiny-after");
  close(r.realized.value, 0.5 * 0.2 * 1460, "the whole baseline time on the step is gone");
  assert.ok(r.notes.some(n => /no case in the after log reaches this step/.test(n)));
  assert.equal(r.status, "met");

  // Not mapped in the after log either: unknown, not zero.
  after.mapping = after.mapping.filter(m => m.nodeId !== "fix");
  const [r2] = benefits.expectedVsRealized(e, "ds-tiny-baseline", "ds-tiny-after");
  assert.equal(r2.realized, null);
  assert.equal(r2.status, "not-measurable");

  after.timeBasis = { calendar: "business", businessMinutesPerDay: 480, dayStartMinute: 540 };
  const cmp = benefits.compareDatasets(e, "ds-tiny-baseline", "ds-tiny-after");
  assert.ok(cmp.caveats.some(c => /measure time differently/.test(c)));
  const [r3] = benefits.expectedVsRealized(e, "ds-tiny-baseline", "ds-tiny-after");
  assert.equal(r3.realized, null);
  assert.ok(r3.notes.some(n => /measure time differently/.test(n)));
});

test("expectedVsRealized reports worse when the measured change moved the wrong way", () => {
  const record = expectedCase("c", "work", 1, 30, 100, 100);
  const e = tinyWithDatasets([record], [{ id: "as-vol", key: "annualVolume", value: 1460, status: "supplied" }]);
  e.models[0].nodes.find(n => n.id === "work").measures = { touchEffort: { value: 30, unit: "minute" } };
  // Swap baseline and after: the "after" log now looks worse than the "baseline".
  const [r] = benefits.expectedVsRealized(e, "ds-tiny-after", "ds-tiny-baseline");
  assert.ok(r.expected.value > 0);
  assert.ok(r.realized.value < 0, "the measured duration increased");
  assert.equal(r.status, "worse");
  assert.equal(r.ratio, null);
});

test("expectedVsRealized reports not-yet for a small measured change against a large modeled one", () => {
  const record = expectedCase("d", "work", 1, 300, 100, 100);
  const e = tinyWithDatasets([record], [{ id: "as-vol", key: "annualVolume", value: 1460, status: "supplied" }]);
  e.models[0].nodes.find(n => n.id === "work").measures = { touchEffort: { value: 300, unit: "minute" } };
  const [r] = benefits.expectedVsRealized(e, "ds-tiny-baseline", "ds-tiny-after");
  assert.ok(r.ratio < 0.2, "ratio " + r.ratio + " should be under 0.2");
  assert.equal(r.status, "not-yet");
});

test("expectedVsRealized reports not-measurable when a log is missing or the opportunity has no value case", () => {
  const record = expectedCase("e", "work", 1, 45, 100, 100);
  const plain = { id: "f", kind: "opportunity", title: "No value case", linkedModelId: "m-current", linkedNodeIds: ["fix"], opportunity: { effort: "S" } };
  const e = tinyWithDatasets([record, plain], [{ id: "as-vol", key: "annualVolume", value: 1460, status: "supplied" }]);
  e.models[0].nodes.find(n => n.id === "work").measures = { touchEffort: { value: 45, unit: "minute" } };
  const rows = benefits.expectedVsRealized(e, "ds-tiny-baseline", "nope");
  assert.equal(rows.length, 1, "the opportunity without a value case is left out entirely");
  assert.equal(rows[0].recordId, "e");
  assert.equal(rows[0].realized, null);
  assert.equal(rows[0].status, "not-measurable");
  assert.ok(rows[0].notes.some(n => /no longer in the project/.test(n)));
});

test("expectedVsRealized skips an opportunity whose steps are outside the baseline's model", () => {
  const record = opp("g", {
    modelId: "m-current", nodeIds: [], effortReductionPct: 50, durationReductionPct: null, shareOfCasesPct: 50,
    shareSource: "manual", effortSource: "node", datasetId: null, oneTimeCost: null, annualRunningCost: null,
    confidence: "low", basis: "illustrative", note: ""
  });
  record.linkedNodeIds = [];
  const e = tinyWithDatasets([record]);
  const [r] = benefits.expectedVsRealized(e, "ds-tiny-baseline", "ds-tiny-after");
  assert.equal(r.realized, null);
  assert.equal(r.status, "not-measurable");
  assert.ok(r.notes.some(n => /no linked work steps/.test(n)));
});

test("compareDatasets and expectedVsRealized work on the larger underwriting fixtures", () => {
  const record = opp("h", {
    modelId: "m-current", nodeIds: ["scrub-sov-geocode", "appetite-capacity-triage", "technical-pricing-rating"],
    effortReductionPct: 30, durationReductionPct: null, shareOfCasesPct: null, shareSource: "dataset",
    effortSource: "dataset", datasetId: "ds-uw-baseline", oneTimeCost: null, annualRunningCost: null,
    confidence: "medium", basis: "supplied", note: ""
  });
  const raw = example("underwriting-current-state");
  raw.datasets = [datasetFixture("underwriting-baseline"), datasetFixture("underwriting-after")];
  raw.records = [record];
  const r0 = validateEngagement(raw);
  assert.equal(r0.ok, true, JSON.stringify(r0.errors));
  const engagement = r0.engagement;

  const cmp = benefits.compareDatasets(engagement, "ds-uw-baseline", "ds-uw-after");
  assert.deepEqual(cmp.unmatched, [], "the after log maps to the same model");
  assert.deepEqual(cmp.overall.cases, { before: 260, after: 271 });
  const scrub = cmp.steps.find(s => s.nodeId === "scrub-sov-geocode");
  assert.equal(scrub.duration.before.p50, 240);
  assert.equal(scrub.duration.after.p50, 96);

  const [r] = benefits.expectedVsRealized(engagement, "ds-uw-baseline", "ds-uw-after");
  assert.ok(r.expected.value > 0, "an observed-effort value case produces a figure");
  assert.ok(r.realized.value > 0, "the after log measured a real reduction on these steps");
  assert.ok(["met", "partial", "not-yet"].includes(r.status));
});

test("observedChangeLens has no data without a matching after log, and reports change once one is recorded", () => {
  const e = tinyWithDatasets();
  const model = e.models[0];
  const empty = benefits.observedChangeLens({ model, engagement: Object.assign({}, e, { datasets: [] }) });
  assert.deepEqual(empty.nodes, {});
  assert.ok(empty.notes.some(n => /No baseline event log/.test(n)));

  const onlyBaseline = benefits.observedChangeLens({ model, engagement: Object.assign({}, e, { datasets: [e.datasets[0]] }) });
  assert.deepEqual(onlyBaseline.nodes, {});
  assert.ok(onlyBaseline.notes.some(n => /No event log taken after a change/.test(n)));

  const result = benefits.observedChangeLens({ model, engagement: e });
  assert.equal(result.nodes.work.category, "faster");
  assert.equal(result.nodes.fix.category, "faster");
  assert.equal(result.coverage.have, 2);
  assert.equal(result.coverage.total, 2);
  assert.ok(result.legend.some(l => l.category === "faster"));
});
