// Business-case one-pagers, the portfolio pager and the wave command (lib/business-case.js).
import test from "node:test";
import assert from "node:assert/strict";
import { lib, tinyEngagement } from "./helpers.mjs";

const bc = lib("business-case");
const { validateEngagement } = lib("validate");
const { StoreError } = lib("store");

function opp(id, valueCase, extra) {
  return Object.assign({
    id, kind: "opportunity", title: "Opportunity " + id, linkedModelId: "m-current", linkedNodeIds: ["work", "fix"],
    opportunity: { intervention: "standardize", effort: "M", valueCase }
  }, extra || {});
}

const BASE_CASE = { effortReductionPct: 50, shareOfCasesPct: 40, oneTimeCost: 12000, annualRunningCost: 2000, durationReductionPct: 20, confidence: "medium", basis: "supplied" };

function engagement(records) {
  const e = tinyEngagement();
  e.models[0].nodes[1].measures = { touchEffort: { value: 30, unit: "minute" } };
  e.models[0].nodes[3].measures = { touchEffort: { value: 1, unit: "hour" } };
  e.assumptions = [
    { id: "as-rate", key: "hourlyRate", value: 100, status: "supplied" },
    { id: "as-vol", key: "annualVolume", value: 1000, status: "supplied" },
    { id: "as-fte", key: "productiveHoursPerFte", value: 1600, status: "supplied" }
  ];
  e.records = records;
  const r = validateEngagement(e);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r.engagement;
}

test("buildOnePager describes one opportunity with its ranking", () => {
  const e = engagement([
    opp("a", Object.assign({}, BASE_CASE, { effortReductionPct: 80, confidence: "high" }), { opportunity: { effort: "S", wave: "now", valueCase: Object.assign({}, BASE_CASE, { effortReductionPct: 80, confidence: "high" }) } }),
    opp("b", null, { opportunity: { effort: "L" } })
  ]);
  const page = bc.buildOnePager(e, "a");
  assert.equal(page.recordId, "a");
  assert.equal(page.title, "Opportunity a");
  assert.equal(page.wave, "now");
  assert.equal(page.waveLabel, "Now");
  assert.equal(page.hasValueCase, true);
  assert.equal(page.confidenceLabel, "High");
  assert.equal(page.quadrant, "quick-win");
  assert.equal(page.quadrantLabel, "Quick win");
  assert.equal(page.rank, 1, "the opportunity with a value case outranks the one without");
  assert.deepEqual(page.outputs.map(o => o.key), ["hoursPerCase", "annualHoursSaved", "laborCostSaved", "netAnnualBenefit", "fteReleased", "paybackMonths", "elapsedSavedPerCase"]);
  assert.deepEqual(page.affectedSteps, ["Do the work", "Fix"]);
  assert.equal(page.oneTimeCost, 12000);
  assert.equal(page.annualRunningCost, 2000);
  assert.deepEqual(page.missing, []);
});

test("buildOnePager reports an opportunity with no value case, without crashing", () => {
  const e = engagement([opp("b", null, { opportunity: { effort: "M" } })]);
  const page = bc.buildOnePager(e, "b");
  assert.equal(page.hasValueCase, false);
  assert.deepEqual(page.outputs, []);
  assert.deepEqual(page.missing, ["value case"]);
  assert.equal(page.basis, null);
  assert.equal(page.rank, 1, "an unscored opportunity is still listed, just ranked last");
  assert.equal(page.quadrant, null);
  assert.equal(page.suggestedWave, "");
});

test("buildOnePager returns null for a record that is not an opportunity, or that does not exist", () => {
  const e = engagement([{ id: "p1", kind: "pain", title: "A pain point" }]);
  assert.equal(bc.buildOnePager(e, "p1"), null);
  assert.equal(bc.buildOnePager(e, "missing"), null);
});

test("buildPortfolioPager carries titles, labels and the wave totals through from value-case.js", () => {
  const e = engagement([
    opp("now-1", null, { opportunity: { effort: "S", wave: "now", valueCase: BASE_CASE } }),
    opp("later-1", null, { linkedNodeIds: ["fix"], opportunity: { effort: "L", wave: "later", valueCase: Object.assign({}, BASE_CASE, { effortReductionPct: 5 }) } })
  ]);
  const page = bc.buildPortfolioPager(e);
  assert.equal(page.rows.length, 2);
  const byId = Object.fromEntries(page.rows.map(r => [r.recordId, r]));
  assert.equal(byId["now-1"].title, "Opportunity now-1");
  assert.equal(byId["now-1"].waveLabel, "Now");
  assert.equal(byId["now-1"].quadrantLabel, "Quick win");
  assert.equal(byId["later-1"].waveLabel, "Later");
  assert.deepEqual(page.waves.map(w => w.wave), ["now", "next", "later", ""]);
  assert.deepEqual(page.waves.find(w => w.wave === "now").recordIds, ["now-1"]);
  assert.ok(page.notes.some(n => /not realized savings/.test(n)));
});

test("suggestWave returns the rank row, or null when the opportunity is filtered out", () => {
  const e = engagement([opp("a", BASE_CASE, { sensitive: true })]);
  assert.equal(bc.suggestWave(e, "a"), null);
  const row = bc.suggestWave(e, "a", { includeSensitive: true });
  assert.equal(row.recordId, "a");
  assert.equal(row.quadrant, "quick-win");
  assert.equal(bc.suggestWave(e, "missing"), null);
});

test("applySetWaves moves one or several opportunities and returns their ids", () => {
  const e = engagement([opp("a", BASE_CASE, { opportunity: { effort: "S", wave: "now", valueCase: BASE_CASE } }), opp("b", BASE_CASE)]);
  const result = bc.applySetWaves(e, { changes: [{ id: "a", wave: "later" }, { id: "b", wave: "next" }] }, StoreError);
  assert.deepEqual(result.ids, ["a", "b"]);
  assert.equal(e.records.find(r => r.id === "a").opportunity.wave, "later");
  assert.equal(e.records.find(r => r.id === "b").opportunity.wave, "next");
});

test("buildOnePager keeps a sensitive or unreviewed-AI record out unless the options ask for it", () => {
  const e = engagement([
    opp("sensitive", BASE_CASE, { sensitive: true }),
    opp("draft", BASE_CASE, { generated: { task: "opportunities", provider: "claude", reviewed: false } })
  ]);
  assert.equal(bc.buildOnePager(e, "sensitive", {}), null);
  assert.notEqual(bc.buildOnePager(e, "sensitive", { includeSensitive: true }), null);
  assert.equal(bc.buildOnePager(e, "draft", {}), null);
  assert.notEqual(bc.buildOnePager(e, "draft", { includeUnreviewedAi: true }), null);
});

test("buildOnePager does not print the skipped-steps note twice", () => {
  const e = engagement([opp("a", BASE_CASE, { linkedNodeIds: ["work", "check"] })]);
  const page = bc.buildOnePager(e, "a");
  assert.deepEqual(page.skippedSteps, ["Check"]);
  assert.equal(page.notes.some(n => /Not counted as work steps/.test(n)), false, "the skippedSteps field already carries this, so the notes list should not repeat it");
});

test("applySetWaves rejects an empty list, an unknown opportunity and an invalid wave", () => {
  const e = engagement([opp("a", BASE_CASE)]);
  assert.throws(() => bc.applySetWaves(e, { changes: [] }, StoreError), StoreError);
  assert.throws(() => bc.applySetWaves(e, {}, StoreError), StoreError);
  assert.throws(() => bc.applySetWaves(e, { changes: [{ id: "missing", wave: "now" }] }, StoreError), StoreError);
  assert.throws(() => bc.applySetWaves(e, { changes: [{ id: "a", wave: "someday" }] }, StoreError), StoreError);
  assert.equal(e.records.find(r => r.id === "a").opportunity.wave, undefined, "a rejected change leaves the record unchanged");
});
