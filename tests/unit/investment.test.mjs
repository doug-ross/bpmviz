// Value dimensions step 3 (docs/value-dimensions.md): the business case over
// time, with adoption, costs by category, NPV, ROI, payback, low and high
// cases, cost per successful workflow and a gain-share fee.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { lib, example, root } from "./helpers.mjs";

const inv = lib("investment");
const valueCase = lib("value-case");
const businessCase = lib("business-case");
const validate = lib("validate");
const storeLib = lib("store");

const close = (a, b, eps) => assert.ok(Math.abs(a - b) < (eps || 1e-6), a + " is not close to " + b);

test("the cash flow math matches the guide's three-year example", () => {
  const r = inv.economicsOf([0, 250000, 500000, 550000], [250000, 160000, 170000, 180000], 10);
  close(r.npv, -250000 + 90000 / 1.1 + 330000 / 1.21 + 370000 / 1.331);
  close(r.npv, 382532, 1);
  close(r.roiPct, (1300000 - 760000) / 760000 * 100);
  close(r.paybackMonths, 12 + 160000 / 330000 * 12);
  assert.deepEqual(r.years.map(y => y.cumulative), [-250000, -160000, 170000, 540000]);
  assert.equal(inv.economicsOf([0, 10, 10], [100, 0, 0], 10).paybackMonths, null, "never pays back within the horizon");
  assert.equal(inv.economicsOf([0, null, 10], [100, 0, 0], 10).npv, null, "a missing year leaves the result blank");
  assert.equal(inv.economicsOf([0, 50, 50], [100, 0, 0], null).npv, null);
  assert.equal(inv.economicsOf([0, 50, 50], [100, 0, 0], null).roiPct, 0, "ROI does not need the discount rate");
});

test("investment settings are kept in shape", () => {
  assert.equal(inv.sanitizeInvestment(undefined), undefined);
  const s = inv.sanitizeInvestment({ horizonYears: 7, discountRatePct: 80, adoptionPct: [50, 150, "90", 100], lowPct: 70, highPct: 400,
    costs: [{ id: "c1", category: "teleport", oneTime: -5, yearly: 1000 }, { id: "c1" }, { id: "bad id!" }], gainSharePct: 50, gainShareMonths: 12.5 });
  assert.deepEqual(s, { horizonYears: 3, discountRatePct: null, adoptionPct: [50, null, null], lowPct: 70, highPct: null,
    costs: [{ id: "c1", category: "other", note: "", oneTime: null, yearly: 1000 }], successfulWorkflowsPerYear: null, gainSharePct: 50, gainShareMonths: null });
  assert.equal(inv.newCostId("modelUsage", [{ id: "cost-modelUsage" }]), "cost-modelUsage-2");
});

/* The underwriting example with one opportunity: $9,000 of labor, 40% realizable, plus a $9,600 vendor line, 50% realizable. */
function engagement(investment, extra) {
  const e = validate.validateEngagement(example("underwriting")).engagement;
  e.models.find(m => m.id === "m-current").nodes.find(n => n.id === "scrub-sov-geocode").measures = { touchEffort: { value: 30, unit: "minute" } };
  e.records.push({ id: "opp-1", kind: "opportunity", title: "Standard SOV template", status: "open", linkedModelId: "m-current", linkedNodeIds: ["scrub-sov-geocode"],
    opportunity: Object.assign({ effort: "M",
      valueCase: { modelId: "m-current", nodeIds: ["scrub-sov-geocode"], effortReductionPct: 50, shareOfCasesPct: 60, shareSource: "manual", effortSource: "node",
        confidence: "high", basis: "supplied", realizationPct: 40, oneTimeCost: 9999, annualRunningCost: 500 },
      valueLines: [{ id: "vl-vendor", dimension: "vendor", inputs: { unitsBefore: 20, unitsAfter: 12, costPerUnitPerYear: 1200 }, realizationPct: 50, basis: "supplied",
        validatedAnnual: 4000, validatedSource: "Renewal quote" }],
      investment }, extra) });
  return validate.validateEngagement(e).engagement;
}
const rec = e => e.records.find(r => r.id === "opp-1");
const SETTINGS = { horizonYears: 3, discountRatePct: 10, adoptionPct: [50, 90, 100], lowPct: 70, highPct: 120,
  costs: [{ id: "cost-build", category: "implementation", oneTime: 6000 }, { id: "cost-model", category: "modelUsage", yearly: 800 }, { id: "cost-review", category: "humanOversight", yearly: 400 }],
  successfulWorkflowsPerYear: 240, gainSharePct: 50, gainShareMonths: 12 };

test("an opportunity's investment case ramps the realizable value and counts every cost", () => {
  const e = engagement(SETTINGS);
  const r = inv.compute(rec(e), valueCase.compute(e, rec(e)));
  const base = 3600 + 4800;
  assert.deepEqual(r.base, { value: base, kind: "realizable", label: "Realizable annual value before running costs" });
  assert.deepEqual(r.years.map(y => [y.benefit, y.cost]), [[0, 6000], [base * 0.5, 1200], [base * 0.9, 1200], [base, 1200]]);
  const expected = inv.economicsOf([0, base * 0.5, base * 0.9, base], [6000, 1200, 1200, 1200], 10);
  close(r.npv, expected.npv);
  close(r.scenarios.low.npv, inv.economicsOf([0, base * 0.35, base * 0.63, base * 0.7], [6000, 1200, 1200, 1200], 10).npv);
  assert.ok(r.scenarios.high.npv > r.npv && r.npv > r.scenarios.low.npv);
  assert.equal(r.costPerSuccessfulWorkflow, 1200 / 240);
  assert.deepEqual(r.costsByCategory.map(c => [c.category, c.oneTime, c.yearly]), [["implementation", 6000, 0], ["modelUsage", 0, 800], ["humanOversight", 0, 400]]);
  assert.deepEqual(r.gainShare, { sharePct: 50, months: 12, confirmedAnnual: 4000, fee: 2000 });
  assert.deepEqual(r.missing, []);
  assert.ok(r.notes.some(n => /cost lines replace/.test(n)));
});

test("without cost lines the business case costs are used, and blanks leave results blank", () => {
  const e = engagement({ horizonYears: 4, discountRatePct: null, adoptionPct: [100, 100, null, 100] });
  const r = inv.compute(rec(e), valueCase.compute(e, rec(e)));
  assert.equal(r.oneTimeCost, 9999);
  assert.equal(r.yearlyCost, 500);
  assert.equal(r.npv, null);
  assert.deepEqual(r.missing, ["Adoption in year 3", "Discount rate"]);
  assert.equal(r.gainShare, null);
  assert.equal(inv.compute({ opportunity: {} }, { outputs: [] }), null, "no settings, no investment case");
});

test("with nothing marked realizable the case uses the modeled value and says so", () => {
  const e = engagement(SETTINGS, { valueLines: [] });
  const r0 = rec(e);
  delete r0.opportunity.valueCase.realizationPct;
  const r = inv.compute(r0, valueCase.compute(e, r0));
  assert.equal(r.base.kind, "modeled");
  assert.equal(r.base.value, 9000);
  assert.ok(r.notes.some(n => /modeled value/.test(n)));
  assert.ok(r.notes.some(n => /none is confirmed yet/.test(n)));
});

test("investment settings survive a save and open and the store, and reach the one-pager", () => {
  const e = engagement(SETTINGS);
  const opened = validate.parseEngagementText(JSON.stringify(e));
  assert.equal(opened.ok, true, JSON.stringify(opened.errors));
  assert.deepEqual(rec(opened.engagement).opportunity.investment, rec(e).opportunity.investment);
  const page = businessCase.buildOnePager(opened.engagement, "opp-1");
  assert.equal(page.investment.gainShare.fee, 2000);
  const store = storeLib.createStore(opened.engagement);
  store.dispatch("record/update", { id: "opp-1", patch: { opportunity: { investment: Object.assign({}, SETTINGS, { horizonYears: 5 }) } } });
  assert.equal(rec(store.get()).opportunity.investment.adoptionPct.length, 5);
  assert.throws(() => store.dispatch("record/update", { id: "opp-1", patch: { opportunity: { investment: [1] } } }), /must be an object/);
  const plainOld = validate.validateEngagement(example("underwriting")).engagement;
  assert.equal(plainOld.records.some(r => r.opportunity && "investment" in r.opportunity), false);
  const doc = JSON.parse(fs.readFileSync(path.join(root, "webui", "schema", "engagement.schema.json"), "utf8"));
  assert.deepEqual(doc.$defs.investment.properties.costs.items.properties.category.enum, inv.CATEGORY_IDS);
});
