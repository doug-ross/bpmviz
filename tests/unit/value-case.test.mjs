// Value case formulas, ranking and wave totals (lib/value-case.js).
import test from "node:test";
import assert from "node:assert/strict";
import { lib, tinyEngagement, datasetFixture } from "./helpers.mjs";

const vc = lib("value-case");
const { validateEngagement } = lib("validate");

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, (msg || "") + ": " + a + " is not " + b);

function opp(id, valueCase, extra) {
  return Object.assign({
    id, kind: "opportunity", title: "Opportunity " + id, linkedModelId: "m-current", linkedNodeIds: ["work", "fix"],
    opportunity: { intervention: "standardize", effort: "M", valueCase }
  }, extra || {});
}

const BASE_CASE = { effortReductionPct: 50, shareOfCasesPct: 40, oneTimeCost: 12000, annualRunningCost: 2000, durationReductionPct: 20, confidence: "medium", basis: "supplied" };

function engagement(records, opts) {
  const e = tinyEngagement();
  const o = opts || {};
  e.models[0].nodes[1].measures = { touchEffort: { value: 30, unit: "minute" }, typicalDuration: { value: 2, unit: "hour" } };
  e.models[0].nodes[3].measures = { touchEffort: { value: 1, unit: "hour" }, typicalDuration: { value: 60, unit: "minute" } };
  e.assumptions = [
    { id: "as-rate", key: "hourlyRate", value: 100, status: o.rateStatus || "supplied" },
    { id: "as-vol", key: "annualVolume", value: 1000, status: "supplied" },
    { id: "as-fte", key: "productiveHoursPerFte", value: 1600, status: "supplied" }
  ];
  if (o.datasets) e.datasets = [datasetFixture("tiny-baseline")];
  e.records = records;
  const r = validateEngagement(e);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r.engagement;
}

const out = (result, key) => result.outputs.find(o => o.key === key);

test("the value case follows the published formulas", () => {
  const e = engagement([opp("a", BASE_CASE)]);
  const r = vc.compute(e, e.records[0]);
  assert.equal(r.recordId, "a");
  close(out(r, "hoursPerCase").value, 1.5, "hours per affected case: 0.5 h + 1 h, one visit each");
  close(out(r, "annualHoursSaved").value, 300, "1,000 cases x 40% x 1.5 h x 50%");
  close(out(r, "laborCostSaved").value, 30000, "300 h x 100");
  close(out(r, "netAnnualBenefit").value, 28000, "30,000 - 2,000 running cost");
  close(out(r, "fteReleased").value, 300 / 1600);
  close(out(r, "paybackMonths").value, 12000 / (28000 / 12));
  close(out(r, "elapsedSavedPerCase").value, 36, "(120 + 60) min x 20%");
  assert.equal(out(r, "elapsedSavedPerCase").unit, "minute", "elapsed time is never priced");
  assert.equal(r.basis, "supplied");
  assert.equal(r.confidence, "medium");
  assert.deepEqual(r.missing, []);
  assert.ok(r.notes.some(n => /One visit per affected case/.test(n)));
  assert.ok(r.notes.some(n => /Not counted as work steps/.test(n)) === false);
  r.outputs.forEach(o => { assert.ok(o.formula && o.label && Array.isArray(o.inputs), o.key); });
});

test("results inherit the weakest input status", () => {
  const e = engagement([opp("a", Object.assign({}, BASE_CASE, { basis: "validated" }))], { rateStatus: "illustrative" });
  const r = vc.compute(e, e.records[0]);
  assert.equal(out(r, "annualHoursSaved").basis, "supplied");
  assert.equal(out(r, "laborCostSaved").basis, "illustrative");
  assert.equal(r.basis, "illustrative");
});

test("a missing required input leaves the result blank, never zero", () => {
  const e = engagement([opp("a", Object.assign({}, BASE_CASE, { shareOfCasesPct: null }))]);
  const r = vc.compute(e, e.records[0]);
  assert.equal(out(r, "annualHoursSaved").value, null);
  assert.equal(out(r, "netAnnualBenefit").value, null);
  assert.ok(r.missing.includes("Share of cases affected"));
  const noEffort = engagement([opp("b", BASE_CASE)]);
  noEffort.models[0].nodes[3].measures.touchEffort = null;
  const r2 = vc.compute(noEffort, noEffort.records[0]);
  assert.equal(out(r2, "hoursPerCase").value, null);
  assert.ok(r2.missing.some(m => /Touch effort x visits, Fix/.test(m)));
  const none = vc.compute(noEffort, { id: "x", kind: "opportunity", linkedNodeIds: [], opportunity: {} });
  assert.deepEqual(none.outputs, []);
  assert.deepEqual(none.missing, ["value case"]);
});

test("running cost is optional and payback needs a positive net benefit", () => {
  const e = engagement([opp("a", Object.assign({}, BASE_CASE, { annualRunningCost: null })), opp("b", Object.assign({}, BASE_CASE, { annualRunningCost: 40000 }))]);
  const a = vc.compute(e, e.records[0]);
  close(out(a, "netAnnualBenefit").value, 30000);
  assert.ok(out(a, "netAnnualBenefit").notes.some(n => /running cost not recorded/i.test(n)));
  const b = vc.compute(e, e.records[1]);
  close(out(b, "netAnnualBenefit").value, -10000);
  assert.equal(out(b, "paybackMonths").value, null);
});

test("gateways and events among the linked steps are not counted as work", () => {
  const e = engagement([opp("a", Object.assign({}, BASE_CASE, { nodeIds: ["start", "work", "check"] }))]);
  const r = vc.compute(e, e.records[0]);
  close(out(r, "hoursPerCase").value, 0.5);
  assert.ok(r.notes.some(n => /Start, Check/.test(n)));
});

test("an event log supplies effort, visits per case and the share of cases", () => {
  const e = engagement([opp("a", Object.assign({}, BASE_CASE, { effortSource: "dataset", shareSource: "dataset", datasetId: "ds-tiny-baseline", shareOfCasesPct: null }))], { datasets: true });
  const r = vc.compute(e, e.records[0]);
  close(out(r, "hoursPerCase").value, 45 / 60 * 1.2 + 30 / 60 * 1, "median durations x visits per case");
  const share = out(r, "annualHoursSaved").inputs.find(i => /Share of cases/.test(i.label));
  close(share.value, 100, "every case does the work");
  assert.equal(share.status, "illustrative", "a demonstration log gives illustrative figures");
  assert.equal(r.basis, "illustrative");
  close(out(r, "elapsedSavedPerCase").value, (45 + 30) * 0.2, "observed durations are used for elapsed time");
  assert.ok(r.notes.some(n => /stands in for effort/.test(n)));
  const fixOnly = engagement([opp("b", Object.assign({}, BASE_CASE, { nodeIds: ["fix"], shareSource: "dataset", datasetId: "ds-tiny-baseline" }))], { datasets: true });
  const r2 = vc.compute(fixOnly, fixOnly.records[0]);
  close(out(r2, "hoursPerCase").value, 1, "typed effort with the observed one visit per case");
  close(out(r2, "annualHoursSaved").value, 1000 * 0.2 * 1 * 0.5);
  assert.equal(r2.notes.some(n => /One visit per affected case/.test(n)), false);
});

test("the annual volume falls back to the event log when no assumption is set", () => {
  const e = engagement([opp("a", Object.assign({}, BASE_CASE, { datasetId: "ds-tiny-baseline" }))], { datasets: true });
  e.assumptions = e.assumptions.filter(a => a.key !== "annualVolume");
  const r = vc.compute(e, e.records[0]);
  const volume = out(r, "annualHoursSaved").inputs[0];
  assert.equal(volume.value, e.datasets[0].cases.annualizedVolume);
  assert.ok(r.notes.some(n => /annualized from the event log/.test(n)));
});

test("ranking scores value by confidence and effort, and suggests waves", () => {
  const e = engagement([
    opp("big-easy", Object.assign({}, BASE_CASE, { effortReductionPct: 80, confidence: "high" }), { opportunity: { effort: "S", wave: "next", valueCase: Object.assign({}, BASE_CASE, { effortReductionPct: 80, confidence: "high" }) } }),
    opp("big-hard", null, { opportunity: { effort: "L", valueCase: Object.assign({}, BASE_CASE, { effortReductionPct: 90, confidence: "high" }) } }),
    opp("small-easy", null, { opportunity: { effort: "S", valueCase: Object.assign({}, BASE_CASE, { effortReductionPct: 5, annualRunningCost: 0, confidence: "low" }) } }),
    opp("small-hard", null, { opportunity: { effort: "L", valueCase: Object.assign({}, BASE_CASE, { effortReductionPct: 6, annualRunningCost: 0 }) } }),
    opp("no-effort", null, { opportunity: { effort: "", valueCase: BASE_CASE } }),
    opp("no-case", null, { opportunity: { effort: "S" } }),
    opp("dropped", null, { status: "dropped", opportunity: { effort: "S", valueCase: BASE_CASE } }),
    { id: "pain", kind: "pain", title: "Not an opportunity" }
  ]);
  const ranked = vc.rank(e);
  const by = Object.fromEntries(ranked.map(x => [x.recordId, x]));
  assert.equal(by.dropped, undefined);
  assert.equal(by.pain, undefined);
  assert.deepEqual(ranked.slice(0, 4).map(x => x.recordId), ["big-easy", "big-hard", "small-easy", "small-hard"]);
  assert.deepEqual(ranked.map(x => x.rank), ranked.map((_, i) => i + 1));
  close(by["big-easy"].score, (1000 * 0.4 * 1.5 * 0.8 * 100 - 2000) * 1 / 1, "net benefit x high confidence / small effort");
  close(by["big-hard"].score, (1000 * 0.4 * 1.5 * 0.9 * 100 - 2000) * 1 / 3);
  assert.equal(by["big-easy"].unit, "currency");
  assert.equal(by["big-easy"].confidenceFactor, 1);
  assert.equal(by["small-easy"].confidenceFactor, 0.5);
  assert.equal(by["small-hard"].confidenceFactor, 0.75);
  assert.equal(by["big-easy"].quadrant, "quick-win");
  assert.equal(by["big-hard"].quadrant, "major");
  assert.equal(by["small-easy"].quadrant, "fill-in");
  assert.equal(by["small-hard"].quadrant, "reconsider");
  assert.deepEqual([by["big-easy"].suggestedWave, by["big-hard"].suggestedWave, by["small-easy"].suggestedWave, by["small-hard"].suggestedWave], ["now", "next", "later", "later"]);
  assert.equal(by["big-easy"].wave, "next", "the wave the consultant set is reported, not replaced");
  assert.equal(by["no-effort"].score, null);
  assert.equal(by["no-case"].value, null);
  assert.ok(by["no-effort"].rank > 4 && by["no-case"].rank > 4, "unscored opportunities rank last");
});

test("sensitive and unreviewed AI opportunities stay out unless asked for", () => {
  const e = engagement([opp("a", BASE_CASE, { sensitive: true }), opp("b", BASE_CASE, { generated: { task: "opportunities", provider: "claude", reviewed: false } })]);
  assert.deepEqual(vc.rank(e).map(x => x.recordId), []);
  assert.deepEqual(vc.rank(e, { includeSensitive: true, includeUnreviewedAi: true }).map(x => x.recordId).sort(), ["a", "b"]);
});

test("wave totals add planned opportunities and flag shared steps", () => {
  const e = engagement([
    opp("now-1", null, { opportunity: { effort: "S", wave: "now", valueCase: BASE_CASE } }),
    opp("now-2", null, { linkedNodeIds: ["work"], opportunity: { effort: "M", wave: "now", valueCase: Object.assign({}, BASE_CASE, { oneTimeCost: 3000 }) } }),
    opp("later-1", null, { linkedNodeIds: ["fix"], opportunity: { effort: "M", wave: "later", valueCase: Object.assign({}, BASE_CASE, { shareOfCasesPct: null }) } }),
    opp("unset", null, { opportunity: { effort: "M", valueCase: BASE_CASE } })
  ]);
  const p = vc.portfolio(e);
  const wave = id => p.waves.find(w => w.wave === id);
  assert.deepEqual(p.waves.map(w => w.wave), ["now", "next", "later", ""]);
  assert.deepEqual(wave("now").recordIds, ["now-1", "now-2"]);
  close(wave("now").annualHoursSaved, 300 + 1000 * 0.4 * 0.5 * 0.5);
  close(wave("now").netAnnualBenefit, 28000 + (10000 - 2000));
  assert.equal(wave("now").oneTimeCost, 15000);
  assert.equal(wave("next").netAnnualBenefit, null);
  assert.equal(wave("later").incomplete, 1);
  assert.deepEqual(wave("").recordIds, ["unset"]);
  close(p.total.netAnnualBenefit, 36000, "the total covers now, next and later only");
  assert.equal(p.total.incomplete, 1);
  assert.equal(p.overlaps.length, 1);
  assert.deepEqual(p.overlaps[0], { wave: "now", modelId: "m-current", nodeId: "work", label: "Do the work", recordIds: ["now-1", "now-2"] });
  assert.ok(p.notes.some(n => /counted twice/.test(n)));
  assert.ok(p.notes.some(n => /left out of the money totals/.test(n)));
  assert.ok(p.notes.some(n => /not realized savings/.test(n)));
});
