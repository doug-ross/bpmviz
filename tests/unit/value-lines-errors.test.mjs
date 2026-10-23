// Value dimensions step 2 (docs/value-dimensions.md): the cost per error
// built up from error types and the steps they make people redo, and the
// templates for late cases, throughput, handoffs, exceptions, decisions,
// win rate, customer contacts and billing leakage.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { lib, example, root } from "./helpers.mjs";

const VL = lib("value-lines");
const valueCase = lib("value-case");
const businessCase = lib("business-case");
const validate = lib("validate");

const gross = (dimension, inputs, ctx) => VL.grossOf(VL.lineOf({ id: "vl-x", dimension, inputs, basis: "supplied" }), ctx).value;
const RATE = { label: "Fully loaded hourly rate", value: 80, unit: "currencyPerHour", status: "supplied" };

test("the step 2 templates work out their value", () => {
  assert.equal(gross("lateCases", { casesPerYear: 8000, lateBeforePct: 6, lateAfterPct: 2.5, costPerLateCase: 180 }), 8000 * 0.035 * 180);
  assert.equal(gross("throughput", { demandPerYear: 70000, capacityBefore: 60000, capacityAfter: 80000, marginPerUnit: 45 }), 450000, "capacity past demand is worth nothing");
  assert.equal(gross("throughput", { demandPerYear: 50000, capacityBefore: 60000, capacityAfter: 80000, marginPerUnit: 45 }), 0, "no value when today's capacity already meets demand");
  assert.equal(gross("coordination", { casesPerYear: 12000, touchesBefore: 5, touchesAfter: 2, minutesPerTouch: 7 }, { hourlyRate: RATE }), 12000 * 3 * 7 / 60 * 80);
  assert.equal(gross("exceptions", { exceptionsBefore: 9000, exceptionsAfter: 4500, costPerException: 22 }), 99000);
  assert.equal(gross("decisions", { decisionsPerYear: 5000, lostBeforePct: 8, lostAfterPct: 3, marginPerKept: 320 }), 80000);
  assert.equal(gross("winRate", { opportunitiesPerYear: 12000, winRateBeforePct: 20, winRateAfterPct: 22, marginPerWin: 600 }), 144000);
  assert.equal(gross("contacts", { contactsBefore: 260000, contactsAfter: 220000, costPerContact: 4.5 }), 180000);
  assert.equal(gross("leakage", { itemsPerYear: 10000, leakageRatePct: 6, amountPerLeak: 400, recoveryBeforePct: 10, recoveryAfterPct: 60, marginSharePct: 80 }), 96000);
  const noRate = VL.grossOf(VL.lineOf({ id: "vl-c", dimension: "coordination", inputs: { casesPerYear: 100, touchesBefore: 2, touchesAfter: 1, minutesPerTouch: 6 } }));
  assert.equal(noRate.value, null);
  assert.deepEqual(noRate.missing, ["Hourly rate"]);
  Object.values(VL.DIMENSIONS).forEach(d => assert.ok(VL.TREATMENTS[d.treatment], d.label + " has a known way to become money"));
});

test("error types are kept in shape, and only on an Errors and rework line", () => {
  const l = VL.lineOf({ id: "vl-r", dimension: "rework", inputs: {}, errorTypes: [
    { id: "et-a", name: "Wrong rate on invoice", severity: "catastrophic", perMonth: -3, redoNodeIds: ["a", "a", "bad id!", "b"], directCost: 40 },
    { id: "et-a", name: "Repeat" }, { id: "et-b", name: "" }, null] });
  assert.deepEqual(l.errorTypes, [{ id: "et-a", name: "Wrong rate on invoice", severity: "moderate", perMonth: null, perMonthAfter: null,
    originNodeId: null, detectedNodeId: null, redoNodeIds: ["a", "b"], investigationHours: null, directCost: 40, riskCost: null, basis: "illustrative", note: "" }]);
  assert.equal("errorTypes" in VL.lineOf({ id: "vl-s", dimension: "sla", inputs: {}, errorTypes: [{ id: "et-a", name: "x" }] }), false);
  assert.equal("errorTypes" in VL.lineOf({ id: "vl-r", dimension: "rework", inputs: {}, errorTypes: [] }), false);
  assert.equal(VL.newErrorTypeId("Wrong rate", [{ id: "et-wrong-rate" }]), "et-wrong-rate-2");
});

test("the cost of an error type comes from the steps it makes people redo", () => {
  const steps = { fix: { label: "Fix the invoice", hours: 0.5, basis: "supplied" }, check: { label: "Check the account", hours: 0.25, basis: "validated" }, unset: { label: "Call the client", hours: null, basis: "supplied" } };
  const ctx = { hourlyRate: RATE, step: id => steps[id] || null };
  const t = VL.errorTypeOf({ id: "et-a", name: "Wrong rate", perMonth: 10, perMonthAfter: 4, redoNodeIds: ["fix", "check"], investigationHours: 1, directCost: 40, riskCost: 10, basis: "supplied" });
  const c = VL.errorTypeCost(t, ctx);
  assert.equal(c.laborHours, 1.75);
  assert.equal(c.costPerError, 1.75 * 80 + 40 + 10);
  assert.equal(c.yearlyToday, 12 * 10 * 190);
  assert.equal(c.yearlyAvoided, 12 * 6 * 190);
  assert.deepEqual(c.missing, []);
  const gap = VL.errorTypeCost(Object.assign({}, t, { redoNodeIds: ["fix", "unset", "gone"] }), ctx);
  assert.equal(gap.costPerError, null);
  assert.deepEqual(gap.missing, ["Touch effort on Call the client", "A redone step that is no longer in the process"]);
  assert.deepEqual(VL.errorTypeCost(t, { step: ctx.step }).missing, ["Hourly rate"]);
  const noLabor = VL.errorTypeCost(VL.errorTypeOf({ id: "et-b", name: "Credit", perMonth: 2, perMonthAfter: 1, directCost: 50 }), {});
  assert.equal(noLabor.costPerError, 50, "no hourly rate is needed when nothing is redone");
});

test("error types weight the cost by severity, as in the guide's worked example", () => {
  const line = VL.lineOf({ id: "vl-r", dimension: "rework", inputs: { errorRateBeforePct: 99, errorRateAfterPct: 0, costPerError: 1 }, basis: "supplied", errorTypes: [
    { id: "et-minor", name: "Minor", severity: "minor", perMonth: 800, perMonthAfter: 300, directCost: 25, basis: "supplied" },
    { id: "et-moderate", name: "Moderate", severity: "moderate", perMonth: 180, perMonthAfter: 60, directCost: 225, basis: "supplied" },
    { id: "et-severe", name: "Severe", severity: "severe", perMonth: 20, perMonthAfter: 10, riskCost: 3000, basis: "illustrative" }] });
  const g = VL.grossOf(line, {});
  assert.equal(g.costOfErrors.blendedCostPerError, 120.5);
  assert.equal(g.costOfErrors.yearlyToday, 1446000);
  assert.equal(g.value, 12 * (500 * 25 + 120 * 225 + 10 * 3000));
  assert.equal(g.costOfErrors.yearlyAvoided, g.value);
  assert.equal(g.basis, "illustrative");
  assert.match(g.formula, /sum over error types/);
  assert.ok(g.notes.some(n => /error rates and cost per error above are not used/.test(n)));
  const partial = VL.grossOf(Object.assign({}, line, { errorTypes: line.errorTypes.map((t, i) => i ? t : Object.assign({}, t, { perMonthAfter: null })) }), {});
  assert.equal(partial.value, null);
  assert.deepEqual(partial.missing, ["Minor: errors per month after the change"]);
});

test("an opportunity's error types use the process's touch effort and hourly rate, and print on the one-pager", () => {
  const e = validate.validateEngagement(example("underwriting")).engagement;
  e.models.find(m => m.id === "m-current").nodes.find(n => n.id === "scrub-sov-geocode").measures = { touchEffort: { value: 30, unit: "minute" } };
  e.records.push({ id: "opp-1", kind: "opportunity", title: "Validate SOVs on intake", status: "open", linkedModelId: "m-current", linkedNodeIds: ["scrub-sov-geocode"],
    opportunity: { effort: "S", valueLines: [{ id: "vl-rework", dimension: "rework", inputs: {}, realizationPct: 100, basis: "supplied", errorTypes: [
      { id: "et-geo", name: "Bad geocode found at pricing", severity: "moderate", perMonth: 10, perMonthAfter: 4, originNodeId: "scrub-sov-geocode",
        detectedNodeId: "scrub-sov-geocode", redoNodeIds: ["scrub-sov-geocode"], investigationHours: 1, directCost: 40, basis: "supplied" }] }] } });
  const checked = validate.validateEngagement(e);
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  const opened = validate.parseEngagementText(JSON.stringify(checked.engagement)).engagement;
  const r = opened.records.find(x => x.id === "opp-1");
  assert.equal(r.opportunity.valueLines[0].errorTypes[0].redoNodeIds[0], "scrub-sov-geocode", "error types survive a save and open");
  const result = valueCase.compute(opened, r);
  const per = 0.5 * 150 + 1 * 150 + 40;
  assert.equal(result.outputs.find(o => o.key === "grossAnnualValue").value, 12 * 6 * per);
  assert.equal(result.parts[0].errorTypes[0].costPerError, per);
  assert.equal(result.parts[0].costOfErrors.yearlyToday, 12 * 10 * per);
  const page = businessCase.buildOnePager(opened, "opp-1");
  assert.equal(page.parts[0].costOfErrors.blendedCostPerError, per);
});

test("the published schema describes error types and every template input", () => {
  const doc = JSON.parse(fs.readFileSync(path.join(root, "webui", "schema", "engagement.schema.json"), "utf8"));
  assert.deepEqual(doc.$defs.errorType.properties.severity.enum, VL.SEVERITIES.map(x => x[0]));
  assert.equal(doc.$defs.valueLine.properties.errorTypes.items.$ref, "#/$defs/errorType");
  assert.ok(doc.$defs.valueLine.properties.inputs.properties.marginSharePct);
});
