// Regression tests for the step-visit weighting fix in lib/value-case.js:
// an opportunity that links steps visited by different sets of cases must
// not charge every affected case for a step only some of them reach.
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

function engagement(records) {
  const e = tinyEngagement();
  e.assumptions = [
    { id: "as-rate", key: "hourlyRate", value: 100, status: "supplied" },
    { id: "as-vol", key: "annualVolume", value: 1000, status: "supplied" },
    { id: "as-fte", key: "productiveHoursPerFte", value: 1600, status: "supplied" }
  ];
  e.datasets = [datasetFixture("tiny-baseline")];
  e.records = records;
  const r = validateEngagement(e);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r.engagement;
}

const out = (result, key) => result.outputs.find(o => o.key === key);

test("work is visited by every case (visitsPerCase 1.2, caseShare 1) and fix only by 20% of them (visitsPerCase 1, caseShare 0.2)", () => {
  // Sanity check on the fixture the rest of this file depends on.
  const d = datasetFixture("tiny-baseline");
  const work = d.steps.find(s => s.nodeId === "work");
  const fix = d.steps.find(s => s.nodeId === "fix");
  close(work.visits / work.cases, 1.2);
  close(fix.visits / fix.cases, 1);
  assert.equal(fix.caseShare, 0.2);
});

test("a step only some affected cases visit is weighted down, not charged to every affected case", () => {
  const e = engagement([opp("a", Object.assign({}, BASE_CASE, {
    effortSource: "dataset", shareSource: "dataset", datasetId: "ds-tiny-baseline", shareOfCasesPct: null
  }))]);
  const r = vc.compute(e, e.records[0]);
  // Every case visits "work" (share of affected = 100%), so its weight is
  // unchanged; only 20% of cases visit "fix", so fix's visits are weighted
  // by 0.2 / 1.0 before being added, not counted as if every case visited it.
  close(out(r, "hoursPerCase").value, 45 / 60 * 1.2 + 30 / 60 * 1 * 0.2, "0.9h for work plus 0.1h for fix, not 0.9h plus 0.5h");
});

test("the same weighting applies when the typed touch effort is used but visits still come from the event log", () => {
  const e = tinyEngagement();
  e.models[0].nodes[1].measures = { touchEffort: { value: 45, unit: "minute" } };
  e.models[0].nodes[3].measures = { touchEffort: { value: 30, unit: "minute" } };
  e.assumptions = [
    { id: "as-rate", key: "hourlyRate", value: 100, status: "supplied" },
    { id: "as-vol", key: "annualVolume", value: 1000, status: "supplied" },
    { id: "as-fte", key: "productiveHoursPerFte", value: 1600, status: "supplied" }
  ];
  e.datasets = [datasetFixture("tiny-baseline")];
  e.records = [opp("a", Object.assign({}, BASE_CASE, { shareSource: "dataset", datasetId: "ds-tiny-baseline", shareOfCasesPct: null }))];
  const r = validateEngagement(e);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const result = vc.compute(r.engagement, r.engagement.records[0]);
  close(out(result, "hoursPerCase").value, 45 / 60 * 1.2 + 30 / 60 * 1 * 0.2);
});

test("a typed share of cases cannot weight step visits, so it assumes every affected case visits every step, and says so", () => {
  const e = engagement([opp("a", Object.assign({}, BASE_CASE, {
    effortSource: "dataset", datasetId: "ds-tiny-baseline", shareSource: "manual", shareOfCasesPct: 50
  }))]);
  const r = vc.compute(e, e.records[0]);
  close(out(r, "hoursPerCase").value, 45 / 60 * 1.2 + 30 / 60 * 1, "unweighted: the typed share cannot say which affected cases reach fix");
  assert.ok(r.notes.some(n => /assumed to apply evenly across every affected step/.test(n)));
});

test("a single affected step is never weighted down (there is nothing to weight against)", () => {
  const e = engagement([opp("a", Object.assign({}, BASE_CASE, {
    nodeIds: ["fix"], effortSource: "dataset", shareSource: "dataset", datasetId: "ds-tiny-baseline", shareOfCasesPct: null
  }))]);
  const r = vc.compute(e, e.records[0]);
  close(out(r, "hoursPerCase").value, 30 / 60 * 1, "fix alone: its own case share equals the affected share, so the weight is 1");
});

test("portfolio() warns and names steps when the total combines opportunities from more than one wave on the same step", () => {
  const e = engagement([
    opp("now-1", Object.assign({}, BASE_CASE, { effortReductionPct: 50 }), { opportunity: { effort: "S", wave: "now", valueCase: Object.assign({}, BASE_CASE, { effortReductionPct: 50 }) } }),
    opp("next-1", Object.assign({}, BASE_CASE, { effortReductionPct: 50 }), { opportunity: { effort: "S", wave: "next", valueCase: Object.assign({}, BASE_CASE, { effortReductionPct: 50 }) } })
  ]);
  const p = vc.portfolio(e);
  assert.equal(p.overlaps.length, 0, "the two opportunities are in different waves, so there is no same-wave overlap");
  assert.equal(p.total.overlaps.length, 2, "both work and fix are changed by opportunities in more than one wave");
  assert.deepEqual(p.total.overlaps.map(o => o.nodeId).sort(), ["fix", "work"]);
  p.total.overlaps.forEach(o => assert.deepEqual(o.recordIds.sort(), ["next-1", "now-1"]));
  assert.ok(p.notes.some(n => /planned in more than one wave/.test(n) && /Do the work/.test(n) && /Fix/.test(n)));
});
