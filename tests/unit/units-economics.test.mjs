// Units and economics: audit findings UX05, UX06 and acceptance criteria AC-4, AC-5.
import test from "node:test";
import assert from "node:assert/strict";
import { lib, example } from "./helpers.mjs";

const units = lib("units");
const economics = lib("economics");
const business = { unit: "minute", calendar: "business", businessMinutesPerDay: 480 };

test("UX05: business-day measures display as business days, not minutes", () => {
  assert.equal(units.formatMeasure(32, "businessDay", { timeBasis: business }), "32 business days");
  assert.equal(units.formatMeasure(15.5, "businessDay", { timeBasis: business }), "15.5 business days");
  assert.equal(units.formatMeasure(1, "businessDay", { timeBasis: business }), "1 business day");
});

test("AC-4: 32 and 15.5 business days reconcile to 15,360 and 7,440 business minutes", () => {
  assert.equal(units.toMinutes(32, "businessDay", business), 15360);
  assert.equal(units.toMinutes(15.5, "businessDay", business), 7440);
  const e = example("underwriting");
  const s = e.scenarios.find(x => x.id === "case-3");
  const ct = s.measures.find(m => m.key === "cycleTime");
  assert.equal(ct.unit, "businessDay");
  assert.equal(units.toMinutes(ct.values["m-current"], ct.unit, e.meta.timeBasis), 15360);
  assert.equal(units.toMinutes(ct.values["m-future"], ct.unit, e.meta.timeBasis), 7440);
  const runEnd = s.runs["m-current"].visits.reduce((m, v) => Math.max(m, v.end), 0);
  assert.equal(runEnd, 15360);
});

test("durations use the time basis day length", () => {
  assert.equal(units.formatDuration(15360, business), "32d");
  assert.equal(units.formatDuration(1500, { calendar: "calendar" }), "1d 1h");
  assert.equal(units.formatDuration(45, business), "45m");
  assert.equal(units.formatDays(7440, business), "15.5 business days");
});

test("ambiguous day conventions do not convert silently", () => {
  assert.equal(units.toMinutes(3, "day", business), null);
  assert.equal(units.toMinutes(3, "calendarDay", business), null);
  assert.equal(units.formatMeasure(3, "day", {}), "3 days");
});

test("deltas and percent changes carry signs and units", () => {
  assert.equal(units.formatDelta(32, 15.5, "businessDay", { timeBasis: business }), "\u221216.5 business days");
  assert.equal(units.formatPercentChange(32, 15.5), "\u221251.6%");
  assert.equal(units.formatMeasure(8250, "currency", { currency: "USD" }), "$8,250");
});

test("representative case reconciles: 7.33 FTE, $8,250 and $3,700 per case", () => {
  const e = example("underwriting");
  const s = e.scenarios.find(x => x.id === "case-3");
  const value = economics.computeValue(e, s);
  const by = Object.fromEntries(value.outputs.map(o => [o.key, o]));
  assert.equal(by.effortSaved.value, 33);
  assert.equal(by.beforeCost.value, 8250);
  assert.equal(by.afterCost.value, 3700);
  assert.equal(by.costSaved.value, 4550);
  assert.ok(Math.abs(by.capacityFte.value - 7.3333) < 0.001);
  assert.equal(economics.reconcileScenario(e, s).status, "reconciled");
});

test("UX06 / AC-5: four of five supplied after-costs are flagged with the implied incremental cost", () => {
  const e = example("underwriting");
  const implied = {};
  e.scenarios.forEach(s => {
    const r = economics.reconcileScenario(e, s);
    const after = r.checks.find(c => c.key === "afterCost");
    implied[s.id] = after.status === "reconciled" ? null : after.impliedIncremental;
  });
  assert.deepEqual(implied, { "case-1": 200, "case-2": 300, "case-3": null, "case-4": 50, "case-5": 100 });
});

test("unreconciled figures are never promoted: calculated values come from declared inputs", () => {
  const e = example("underwriting");
  const s = e.scenarios.find(x => x.id === "case-1");
  const after = economics.computeValue(e, s).outputs.find(o => o.key === "afterCost");
  assert.equal(after.value, 1900, "10 h x $150 + $400, not the supplied $1,700");
  assert.equal(after.basis, "illustrative");
});

test("a scenario override resolves the reconciliation warning", () => {
  const e = example("underwriting");
  const s = e.scenarios.find(x => x.id === "case-1");
  s.economics.overrides.incrementalCostPerCase = { value: 200, status: "supplied", note: "Case-specific estimate" };
  const r = economics.reconcileScenario(e, s);
  assert.equal(r.checks.find(c => c.key === "afterCost").status, "reconciled");
});

test("missing inputs suppress outputs instead of treating unknown as zero", () => {
  const e = example("underwriting");
  e.assumptions = e.assumptions.filter(a => a.key !== "incrementalCostPerCase");
  const s = e.scenarios.find(x => x.id === "case-3");
  const out = economics.computeValue(e, s).outputs;
  const after = out.find(o => o.key === "afterCost");
  assert.equal(after.value, null);
  assert.deepEqual(after.missing, ["Incremental AI and service cost per case (future state)"]);
  assert.equal(out.find(o => o.key === "paybackMonths").value, null, "no investment basis, no payback");
});

test("annualized scenarios carry a do-not-sum note", () => {
  const notes = economics.engagementNotes(example("underwriting"));
  assert.equal(notes[0].code, "economics.annualization");
});

test("capacity uses effort, never cycle time", () => {
  const e = example("underwriting");
  const s = e.scenarios.find(x => x.id === "case-3");
  s.measures.find(m => m.key === "cycleTime").values["m-future"] = 1;
  const fte = economics.computeValue(e, s).outputs.find(o => o.key === "capacityFte");
  assert.ok(Math.abs(fte.value - 7.3333) < 0.001);
});

test("P1-06: one-way sensitivity moves each input with the others held", () => {
  const e = example("underwriting");
  const s = e.scenarios.find(x => x.id === "case-3");
  const r = economics.sensitivity(e, s, "costSaved", 20);
  assert.equal(r.base, 4550);
  assert.equal(r.rows[0].label, "Current human hours per case", "the widest effect comes first");
  assert.equal(Math.round(r.rows[0].low), 2900);
  assert.equal(Math.round(r.rows[0].high), 6200);
  const incremental = r.rows.find(x => x.label.startsWith("Incremental"));
  assert.equal(Math.round(incremental.low), 4630);
  assert.equal(economics.sensitivity(e, s, "paybackMonths", 20).base, null, "no investment basis, nothing to vary");
});
