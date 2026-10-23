// Value lines (docs/value-dimensions.md): templates, clean-up, the gross,
// realizable and validated figures, hires avoided standing in for labor, and
// that business cases without value lines compute exactly as before.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { lib, example, root } from "./helpers.mjs";

const VL = lib("value-lines");
const valueCase = lib("value-case");
const businessCase = lib("business-case");
const validate = lib("validate");
const storeLib = lib("store");

/* The underwriting example (400 cases a year at $150 an hour) with one opportunity worth 60 hours, $9,000, a year. */
function engagement(opportunity) {
  const e = validate.validateEngagement(example("underwriting")).engagement;
  e.models.find(m => m.id === "m-current").nodes.find(n => n.id === "scrub-sov-geocode").measures = { touchEffort: { value: 30, unit: "minute" } };
  e.records.push({ id: "opp-1", kind: "opportunity", title: "Standard SOV template", status: "open", linkedModelId: "m-current", linkedNodeIds: ["scrub-sov-geocode"],
    opportunity: Object.assign({ effort: "M" }, opportunity) });
  return validate.validateEngagement(e).engagement;
}
const LABOR = { modelId: "m-current", nodeIds: ["scrub-sov-geocode"], effortReductionPct: 50, shareOfCasesPct: 60, shareSource: "manual", effortSource: "node", confidence: "high", basis: "supplied" };
const line = (id, dimension, inputs, more) => Object.assign({ id, dimension, inputs, basis: "supplied" }, more);
const out = (result, key) => result.outputs.find(o => o.key === key);
const record = e => e.records.find(r => r.id === "opp-1");

test("each template works out its gross value, and a blank input leaves it blank", () => {
  const f = { annualVolume: { label: "Annual eligible volume", value: 400, unit: "casesPerYear", status: "illustrative" } };
  const rework = VL.grossOf(VL.lineOf(line("a", "rework", { errorRateBeforePct: 10, errorRateAfterPct: 4, costPerError: 500 })), f);
  assert.equal(rework.value, 400 * 0.06 * 500);
  assert.equal(rework.basis, "illustrative", "the fallback volume's basis is the weakest");
  assert.ok(rework.notes.some(n => /uses the project's annual eligible volume/.test(n)));
  assert.equal(VL.grossOf(VL.lineOf(line("b", "sla", { breachesBefore: 120, breachesAfter: 40, penaltyPerBreach: 250 }))).value, 20000);
  assert.equal(VL.grossOf(VL.lineOf(line("c", "hires", { plannedHires: 3, hiresStillNeeded: 1, annualCostPerHire: 90000 }))).value, 180000);
  assert.equal(VL.grossOf(VL.lineOf(line("d", "vendor", { unitsBefore: 20, unitsAfter: 12, costPerUnitPerYear: 1200 }))).value, 9600);
  const blank = VL.grossOf(VL.lineOf(line("e", "vendor", { unitsBefore: 20, costPerUnitPerYear: 1200 })));
  assert.equal(blank.value, null);
  assert.deepEqual(blank.missing, ["Seats or units still needed"]);
  assert.deepEqual(Object.keys(VL.DIMENSIONS), ["rework", "sla", "hires", "vendor"]);
});

test("stored lines are kept in shape", () => {
  const { lines, dropped } = VL.sanitizeLines([
    line("vl-1", "rework", { errorRateBeforePct: 140, errorRateAfterPct: -2, costPerError: "500", unknown: 3 }, { realizationPct: 120, financeOwner: "x".repeat(300), basis: "made-up" }),
    line("vl-1", "sla", {}), line("bad id!", "sla", {}), line("vl-3", "teleport", {}), null
  ]);
  assert.equal(dropped, 4);
  assert.deepEqual(lines, [{ id: "vl-1", dimension: "rework", inputs: { casesPerYear: null, errorRateBeforePct: null, errorRateAfterPct: null, costPerError: null },
    realizationPct: null, realizedBy: "", financeOwner: "x".repeat(200), validatedAnnual: null, validatedSource: "", basis: "illustrative", note: "" }]);
  assert.equal(VL.newLineId("sla", [{ id: "vl-sla" }]), "vl-sla-2");
});

test("a business case without value lines computes exactly as before", () => {
  const e = engagement({ valueCase: LABOR });
  const r = valueCase.compute(e, record(e));
  assert.deepEqual(r.outputs.map(o => o.key), ["hoursPerCase", "annualHoursSaved", "laborCostSaved", "netAnnualBenefit", "fteReleased", "paybackMonths", "elapsedSavedPerCase"]);
  assert.equal(out(r, "netAnnualBenefit").value, 9000);
  assert.equal(out(r, "netAnnualBenefit").formula, "labor cost of the hours saved per year \u2212 annual running cost");
  assert.deepEqual(r.parts, []);
  assert.equal(valueCase.headline(r).key, "netAnnualBenefit");
  const saved = validate.validateEngagement(JSON.parse(JSON.stringify(e))).engagement;
  assert.deepEqual(Object.keys(record(saved).opportunity.valueCase).sort(), Object.keys(LABOR).concat(["datasetId", "durationReductionPct", "note", "oneTimeCost", "annualRunningCost"]).sort(),
    "no new keys appear on a value case that does not use them");
  assert.equal("valueLines" in record(saved).opportunity, false);
});

test("value lines add up to gross, realizable and validated figures", () => {
  const e = engagement({
    valueCase: Object.assign({}, LABOR, { realizationPct: 40, realizedBy: "Overtime cut in the SOV team", financeOwner: "UW finance lead", oneTimeCost: 20000, annualRunningCost: 1000 }),
    valueLines: [
      line("vl-rework", "rework", { errorRateBeforePct: 10, errorRateAfterPct: 4, costPerError: 500 }, { realizationPct: 100, realizedBy: "Fewer rework hours bought from the vendor" }),
      line("vl-vendor", "vendor", { unitsBefore: 20, unitsAfter: 12, costPerUnitPerYear: 1200 }, { realizationPct: 50, validatedAnnual: 4800, validatedSource: "Renewal quote, March" })
    ]
  });
  const r = valueCase.compute(e, record(e));
  assert.deepEqual(r.outputs.map(o => o.key), ["hoursPerCase", "annualHoursSaved", "laborCostSaved", "grossAnnualValue", "netAnnualBenefit", "realizableAnnualValue",
    "validatedAnnualValue", "paybackMonths", "fteReleased", "elapsedSavedPerCase"]);
  assert.equal(out(r, "grossAnnualValue").value, 9000 + 12000 + 9600);
  assert.equal(out(r, "netAnnualBenefit").value, 30600 - 1000);
  assert.equal(out(r, "realizableAnnualValue").value, 3600 + 12000 + 4800 - 1000);
  assert.equal(out(r, "validatedAnnualValue").value, 4800);
  assert.equal(out(r, "validatedAnnualValue").basis, "validated");
  assert.match(out(r, "validatedAnnualValue").notes[0], /1 of 3 parts/);
  assert.equal(out(r, "paybackMonths").value, 20000 / (19400 / 12), "payback uses the realizable value");
  assert.match(out(r, "paybackMonths").formula, /realizable annual value/);
  const head = valueCase.headline(r);
  assert.deepEqual([head.key, head.value], ["realizableAnnualValue", 19400]);
  assert.deepEqual(r.parts.map(p => [p.id, p.treatment, p.gross, p.realizable, p.validated]), [
    ["labor", "capacity", 9000, 3600, null], ["vl-rework", "avoidedLoss", 12000, 12000, null], ["vl-vendor", "directExpense", 9600, 4800, 4800]]);
  assert.equal(r.parts[0].realizedBy, "Overtime cut in the SOV team");
  assert.equal(r.parts[2].validatedSource, "Renewal quote, March");
  assert.equal(valueCase.rank(e).find(x => x.recordId === "opp-1").value, 19400, "the ranking uses the realizable value");
});

test("a part with no realization share leaves the realizable figure blank, without making the case incomplete", () => {
  const e = engagement({ valueCase: LABOR, valueLines: [line("vl-sla", "sla", { breachesBefore: 120, breachesAfter: 40, penaltyPerBreach: 250 }, { realizationPct: 100 })] });
  const r = valueCase.compute(e, record(e));
  assert.equal(out(r, "realizableAnnualValue").value, null);
  assert.deepEqual(out(r, "realizableAnnualValue").missing, ["Realizable part of labor cost of the hours saved per year"]);
  assert.deepEqual(r.missing, [], "realization is not a missing input of the business case itself");
  assert.equal(valueCase.headline(r).key, "netAnnualBenefit");
  assert.equal(valueCase.headline(r).value, 29000);
});

test("hires avoided stands in for labor, and more hires than freed time is flagged", () => {
  const e = engagement({ valueCase: LABOR, valueLines: [line("vl-hires", "hires", { plannedHires: 2, hiresStillNeeded: 1, annualCostPerHire: 90000 }, { realizationPct: 100, realizedBy: "One Q1 hire not made" })] });
  const r = valueCase.compute(e, record(e));
  assert.equal(out(r, "laborCostSaved").value, 9000, "labor stays visible for reference");
  assert.equal(out(r, "grossAnnualValue").value, 90000, "but only the hire counts");
  assert.deepEqual(r.parts.map(p => p.id), ["vl-hires"]);
  assert.ok(r.notes.some(n => /not counted again/.test(n)));
  assert.ok(r.notes.some(n => /hires avoided \(1\) are more than the time the labor estimate frees up \(0/.test(n)), "60 hours is far from one FTE");
});

test("an opportunity with value lines and no labor estimate is valued and ranked", () => {
  const e = engagement({ valueLines: [line("vl-vendor", "vendor", { unitsBefore: 30, unitsAfter: 10, costPerUnitPerYear: 600 }, { realizationPct: 100 })] });
  const r = valueCase.compute(e, record(e));
  assert.equal(out(r, "realizableAnnualValue").value, 12000);
  assert.equal(out(r, "paybackMonths").value, null);
  assert.equal(valueCase.rank(e).find(x => x.recordId === "opp-1").value, 12000);
  const page = businessCase.buildOnePager(e, "opp-1");
  assert.equal(page.hasValueCase, true);
  assert.deepEqual(page.parts.map(p => p.label), ["Licenses and vendor fees"]);
  assert.ok(page.outputs.some(o => o.key === "realizableAnnualValue"));
});

test("value lines and realization fields survive a save and open, and bad lines are reported", () => {
  const e = engagement({ valueCase: Object.assign({}, LABOR, { realizationPct: 40, validatedAnnual: 3000, validatedSource: "Payroll report" }),
    valueLines: [line("vl-sla", "sla", { breachesBefore: 12, breachesAfter: 4, penaltyPerBreach: 250 }, { realizationPct: 100, financeOwner: "Controller" })] });
  const opened = validate.parseEngagementText(JSON.stringify(e));
  assert.equal(opened.ok, true, JSON.stringify(opened.errors));
  assert.deepEqual(record(opened.engagement).opportunity.valueLines, record(e).opportunity.valueLines);
  assert.equal(record(opened.engagement).opportunity.valueCase.realizationPct, 40);
  assert.equal(record(opened.engagement).opportunity.valueCase.validatedSource, "Payroll report");
  const broken = JSON.parse(JSON.stringify(e));
  record(broken).opportunity.valueLines.push({ id: "vl-x", dimension: "teleport" });
  const v = validate.validateEngagement(broken);
  assert.equal(record(v.engagement).opportunity.valueLines.length, 1);
  assert.ok(v.warnings.some(w => w.code === "valueLines.dropped"));
});

test("the store saves value lines on an opportunity and refuses a non-list", () => {
  const store = storeLib.createStore(engagement({ valueCase: LABOR }));
  store.dispatch("record/update", { id: "opp-1", patch: { opportunity: { valueLines: [line("vl-rework", "rework", { costPerError: 80 }, { realizationPct: 30 })] } } });
  const r = record(store.get());
  assert.equal(r.opportunity.valueLines.length, 1);
  assert.equal(r.opportunity.valueCase.effortReductionPct, 50, "the labor estimate is kept");
  assert.throws(() => store.dispatch("record/update", { id: "opp-1", patch: { opportunity: { valueLines: "rework" } } }), /must be a list/);
  store.dispatch("record/update", { id: "opp-1", patch: { opportunity: { valueLines: [] } } });
  assert.deepEqual(record(store.get()).opportunity.valueLines, []);
});

test("the published schema describes value lines", () => {
  const doc = JSON.parse(fs.readFileSync(path.join(root, "webui", "schema", "engagement.schema.json"), "utf8"));
  assert.deepEqual(doc.$defs.valueLine.properties.dimension.enum, VL.DIMENSION_IDS);
  assert.ok(doc.$defs.valueCase.properties.realizationPct);
  assert.deepEqual(Object.keys(doc.$defs.valueLine.properties.inputs.properties).sort(),
    [...new Set(Object.values(VL.DIMENSIONS).flatMap(d => d.inputs.map(i => i.key)))].sort());
});
