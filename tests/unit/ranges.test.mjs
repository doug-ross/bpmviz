// Value dimensions step 3: a low and a high value per business case figure
// (lib/ranges.js), which inputs matter most, and the combined low and high
// cases the investment case uses.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { lib, example, root } from "./helpers.mjs";

const ranges = lib("ranges");
const inv = lib("investment");
const valueCase = lib("value-case");
const businessCase = lib("business-case");
const validate = lib("validate");
const storeLib = lib("store");

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, (msg || "") + ": " + a + " is not " + b);

/*
 * The underwriting example (400 cases a year at $150 an hour) with one
 * opportunity: $9,000 of labor, 40% realizable, a $9,600 vendor line, 50%
 * realizable, and $500 a year to run. Realizable value: 3,600 + 4,800 - 500 = 7,900.
 */
function engagement(extra) {
  const e = validate.validateEngagement(example("underwriting")).engagement;
  e.models.find(m => m.id === "m-current").nodes.find(n => n.id === "scrub-sov-geocode").measures = { touchEffort: { value: 30, unit: "minute" } };
  e.records.push({ id: "opp-1", kind: "opportunity", title: "Standard SOV template", status: "open", linkedModelId: "m-current", linkedNodeIds: ["scrub-sov-geocode"],
    opportunity: Object.assign({ effort: "M",
      valueCase: { modelId: "m-current", nodeIds: ["scrub-sov-geocode"], effortReductionPct: 50, shareOfCasesPct: 60, shareSource: "manual", effortSource: "node",
        confidence: "high", basis: "supplied", realizationPct: 40, oneTimeCost: 9999, annualRunningCost: 500 },
      valueLines: [{ id: "vl-vendor", dimension: "vendor", inputs: { unitsBefore: 20, unitsAfter: 12, costPerUnitPerYear: 1200 }, realizationPct: 50, basis: "supplied" }],
      ranges: { "vc.effortReductionPct": { low: 30, high: 60 }, "as.hourlyRate": { low: 100, high: 200 }, "vl.vl-vendor.unitsAfter": { low: 10, high: 16 },
        "vc.annualRunningCost": { low: 300, high: 900 } } }, extra) });
  return validate.validateEngagement(e).engagement;
}
const rec = e => e.records.find(r => r.id === "opp-1");

test("ranges are kept in shape", () => {
  assert.equal(ranges.sanitizeRanges(undefined), undefined);
  assert.deepEqual(ranges.sanitizeRanges({ "vc.effortReductionPct": { low: 30, high: "60" }, "vl.vl-1.unitsAfter": { low: -1, high: 4 },
    "as.hourlyRate": { low: null, high: null }, "bad key": { low: 1 }, "vl.x": { low: 1 } }),
  { "vc.effortReductionPct": { low: 30, high: null }, "vl.vl-1.unitsAfter": { low: null, high: 4 } });
  const fields = ranges.fieldsOf(engagement(), rec(engagement()));
  assert.deepEqual(fields.map(f => f.field), ["vc.effortReductionPct", "vc.shareOfCasesPct", "vc.oneTimeCost", "vc.annualRunningCost", "vc.realizationPct",
    "vl.vl-vendor.unitsBefore", "vl.vl-vendor.unitsAfter", "vl.vl-vendor.costPerUnitPerYear", "vl.vl-vendor.realizationPct", "as.hourlyRate", "as.annualVolume"]);
  assert.deepEqual(fields.find(f => f.field === "as.hourlyRate").value, 150);
});

test("each figure is moved to its low and high with the others held, widest first", () => {
  const e = engagement();
  const r = ranges.analyze(e, rec(e));
  assert.deepEqual([r.figure.key, r.figure.value], ["realizableAnnualValue", 7900]);
  const row = f => r.rows.find(x => x.field === f);
  assert.deepEqual(r.rows.map(x => x.field), ["vl.vl-vendor.unitsAfter", "as.hourlyRate", "vc.effortReductionPct", "vc.annualRunningCost"]);
  close(row("vc.effortReductionPct").atLow, 2160 + 4800 - 500);
  close(row("vc.effortReductionPct").atHigh, 4320 + 4800 - 500);
  close(row("as.hourlyRate").atLow, 2400 + 4800 - 500);
  close(row("vl.vl-vendor.unitsAfter").atLow, 3600 + 6000 - 500, "fewer seats after is the better end");
  close(row("vl.vl-vendor.unitsAfter").atHigh, 3600 + 2400 - 500);
  close(row("vc.annualRunningCost").spread, 600);
  // Every figure at its worse end, then its better end.
  assert.deepEqual(r.low.settings, { "vl.vl-vendor.unitsAfter": 16, "as.hourlyRate": 100, "vc.effortReductionPct": 30, "vc.annualRunningCost": 900 });
  close(r.low.value, 400 * 0.6 * 0.5 * 0.3 * 100 * 0.4 + 2400 - 900);
  close(r.high.value, 400 * 0.6 * 0.5 * 0.6 * 200 * 0.4 + 6000 - 300);
  assert.equal(rec(e).opportunity.valueCase.effortReductionPct, 50, "the record itself is not changed");
  assert.equal(e.assumptions.find(a => a.key === "hourlyRate").value, 150);
  assert.equal(ranges.analyze(e, Object.assign({}, rec(e), { opportunity: Object.assign({}, rec(e).opportunity, { ranges: {} }) })), null);
});

test("a range for a figure no longer set is left out and said so; a blank end counts as today's value", () => {
  const e = engagement({ ranges: { "vc.effortReductionPct": { low: 30, high: null }, "vl.gone.unitsAfter": { low: 1, high: 2 } } });
  const r = ranges.analyze(e, rec(e));
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].atHigh, null);
  assert.equal(r.high.value, 7900, "no higher end, so the high case is today's");
  assert.ok(r.notes.some(n => /1 range is for a figure no longer set/.test(n)));
});

test("the investment case takes its low and high cases from the ranges, costs included", () => {
  const settings = { horizonYears: 3, discountRatePct: 10, adoptionPct: [50, 90, 100], lowPct: 70, highPct: 120, costs: [] };
  const e = engagement({ investment: settings });
  const r = rec(e);
  const spread = ranges.analyze(e, r);
  const result = valueCase.compute(e, r);
  const withRanges = inv.compute(r, result, { low: spread.low, high: spread.high });
  const lowBenefit = 400 * 0.6 * 0.5 * 0.3 * 100 * 0.4 + 2400;
  close(withRanges.scenarios.low.npv, inv.economicsOf([0, lowBenefit * 0.5, lowBenefit * 0.9, lowBenefit], [9999, 900, 900, 900], 10).npv, "the running cost is at its high end");
  assert.equal(withRanges.scenarios.low.source, "ranges");
  assert.equal(withRanges.scenarios.low.pct, null);
  assert.ok(withRanges.notes.some(n => /end of its range/.test(n)));
  const shares = inv.compute(r, result);
  assert.deepEqual([shares.scenarios.low.source, shares.scenarios.low.pct], ["share", 70], "without the cases, the shares still apply");
  const page = businessCase.buildOnePager(e, "opp-1");
  assert.equal(page.ranges.rows.length, 4);
  close(page.investment.scenarios.high.npv, withRanges.scenarios.high.npv);
});

test("ranges survive a save and open and the store, and old files keep their shape", () => {
  const e = engagement();
  const opened = validate.parseEngagementText(JSON.stringify(e));
  assert.equal(opened.ok, true);
  assert.deepEqual(rec(opened.engagement).opportunity.ranges, rec(e).opportunity.ranges);
  const store = storeLib.createStore(opened.engagement);
  store.dispatch("record/update", { id: "opp-1", patch: { opportunity: { ranges: { "vc.effortReductionPct": { low: 40, high: 55 } } } } });
  assert.deepEqual(rec(store.get()).opportunity.ranges, { "vc.effortReductionPct": { low: 40, high: 55 } });
  assert.throws(() => store.dispatch("record/update", { id: "opp-1", patch: { opportunity: { ranges: [1] } } }), /must be an object/);
  const plain = validate.validateEngagement(example("underwriting")).engagement;
  assert.equal(plain.records.some(x => x.opportunity && "ranges" in x.opportunity), false);
  const doc = JSON.parse(fs.readFileSync(path.join(root, "webui", "schema", "engagement.schema.json"), "utf8"));
  const json = JSON.stringify(doc);
  assert.ok(json.includes(JSON.stringify(ranges.FIELD.source)), "the schema names the same figure pattern");
});
