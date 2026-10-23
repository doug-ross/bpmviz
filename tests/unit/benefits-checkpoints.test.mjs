// Checkpoints recorded by hand after a change, compared with the business case without an event log.
import test from "node:test";
import assert from "node:assert/strict";
import { lib, tinyEngagement } from "./helpers.mjs";

const benefits = lib("benefits");
const { createStore } = lib("store");
const { validateEngagement } = lib("validate");
const bc = lib("business-case");
const pptx = lib("pptx");

const CASE = { effortReductionPct: 50, shareOfCasesPct: 40, annualRunningCost: 2000, basis: "supplied" };

function project(checkpoints, extra) {
  const e = tinyEngagement();
  e.models[0].nodes[1].measures = { touchEffort: { value: 30, unit: "minute" } };
  e.models[0].nodes[3].measures = { touchEffort: { value: 1, unit: "hour" } };
  e.models[0].nodes.forEach(n => { n.provenance = { source: "client", validation: "validated", evidenceRefs: [], note: "" }; });
  e.assumptions = [
    { id: "as-rate", key: "hourlyRate", value: 100, status: "supplied" },
    { id: "as-vol", key: "annualVolume", value: 1000, status: "supplied" }
  ];
  e.records = [{ id: "opp-a", kind: "opportunity", title: "Pre-fill intake", linkedModelId: "m-current", linkedNodeIds: ["work", "fix"],
    opportunity: { effort: "S", valueCase: Object.assign({}, CASE) } }];
  if (checkpoints) e.checkpoints = checkpoints;
  Object.assign(e, extra || {});
  const r = validateEngagement(e);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r.engagement;
}

const cp = (id, over) => Object.assign({ id, recordId: "opp-a", label: "30 days", date: "2027-01-31", hoursPerCaseAfter: 0.9, basis: "observed", source: "Time study of 20 claims" }, over || {});

test("realized hours and money follow the business case formula, with the same thresholds as the event-log comparison", () => {
  // Before: 0.5 h + 1 h = 1.5 h per affected case; 1,000 cases, 40% affected, 50% reduction: 300 hours expected.
  const e = project([cp("c90", { label: "90 days", date: "2027-03-31", hoursPerCaseAfter: 1.6 }), cp("c30"), cp("c60", { label: "60 days", date: "2027-02-28", hoursPerCaseAfter: 1.2 }),
    cp("cmix", { label: "6 months", date: "", hoursPerCaseAfter: 1.2, shareOfCasesPct: 50, annualVolume: 1200 })]);
  const [row] = benefits.expectedVsCheckpoints(e);
  assert.equal(row.expected.value, 300);
  assert.deepEqual(row.checkpoints.map(c => c.id), ["c30", "c60", "c90", "cmix"], "dated checkpoints first, earliest first");
  const [c30, c60, c90, mix] = row.checkpoints;
  assert.ok(Math.abs(c30.realized.value - 240) < 1e-9);
  assert.ok(Math.abs(c30.realizedMoney.value - 22000) < 1e-6);
  assert.equal(c30.status, "met");
  assert.ok(Math.abs(c30.ratio - 0.8) < 1e-9);
  assert.equal(c60.status, "partial");
  assert.equal(c90.status, "worse");
  assert.equal(c90.ratio, null);
  assert.ok(Math.abs(mix.realized.value - 180) < 1e-9, "1,200 cases x 50% x 0.3 h");
  assert.ok(mix.notes.some(n => /share of cases of 50%/.test(n)));
  assert.ok(mix.notes.some(n => /1,200 cases a year/.test(n)));
  assert.match(c30.outputs[0].formula, /hours per affected case before/);
  assert.equal(c30.basis, "supplied", "the weakest basis among the inputs");
});

test("without an hourly rate the realized figure is in hours only, and without a business case nothing is measurable", () => {
  const e = project([cp("c30")]);
  e.assumptions = e.assumptions.filter(a => a.key !== "hourlyRate");
  const [row] = benefits.expectedVsCheckpoints(e);
  assert.equal(row.checkpoints[0].realizedMoney, null);
  assert.ok(row.checkpoints[0].notes.some(n => /No hourly rate/.test(n)));
  delete e.records[0].opportunity.valueCase;
  const [bare] = benefits.expectedVsCheckpoints(e);
  assert.equal(bare.expected, null);
  assert.equal(bare.checkpoints[0].status, "not-measurable");
  assert.match(bare.notes[0], /no business case/);
});

test("checkpoint commands validate their figures, and deleting the opportunity deletes its checkpoints", () => {
  const s = createStore(project());
  const { id } = s.dispatch("checkpoint/save", { checkpoint: { recordId: "opp-a", label: "30 days", date: "2027-01-31", hoursPerCaseAfter: 1, basis: "observed" } });
  assert.match(id, /^cp-opp-a-30-days/);
  assert.equal(s.get().checkpoints.length, 1);
  assert.throws(() => s.dispatch("checkpoint/save", { checkpoint: { recordId: "opp-a", hoursPerCaseAfter: -1 } }), /0 or more/);
  assert.throws(() => s.dispatch("checkpoint/save", { checkpoint: { recordId: "opp-a", hoursPerCaseAfter: 1, shareOfCasesPct: 140 } }), /between 0 and 100/);
  assert.throws(() => s.dispatch("checkpoint/save", { checkpoint: { recordId: "ghost", hoursPerCaseAfter: 1 } }), /Choose an opportunity/);
  assert.throws(() => s.dispatch("checkpoint/save", { checkpoint: { recordId: "opp-a", hoursPerCaseAfter: 1, basis: "illustrative" } }), /Provided, Measured or Confirmed/);
  s.dispatch("checkpoint/save", { checkpoint: Object.assign({}, s.get().checkpoints[0], { hoursPerCaseAfter: 0.8, note: "Second look" }) });
  assert.equal(s.get().checkpoints[0].hoursPerCaseAfter, 0.8);
  assert.equal(s.get().checkpoints.length, 1);
  s.dispatch("record/delete", { id: "opp-a" });
  assert.deepEqual(s.get().checkpoints, []);
  s.undo();
  assert.equal(s.get().checkpoints.length, 1);
  s.dispatch("checkpoint/delete", { id });
  assert.deepEqual(s.get().checkpoints, []);
});

test("checkpoints survive a save and reopen, and one for a missing opportunity is dropped with a warning", () => {
  const e = tinyEngagement();
  e.records = [{ id: "opp-a", kind: "opportunity", title: "A", opportunity: {} }];
  e.checkpoints = [cp("c1", { shareOfCasesPct: 30 }), cp("c2", { recordId: "ghost" })];
  const r = validateEngagement(e);
  assert.equal(r.ok, true);
  assert.deepEqual(r.engagement.checkpoints.map(c => c.id), ["c1"]);
  assert.equal(r.engagement.checkpoints[0].shareOfCasesPct, 30);
  assert.ok(r.warnings.some(w => w.path === "checkpoints[1]"));
  assert.deepEqual(validateEngagement(JSON.parse(JSON.stringify(r.engagement))).engagement.checkpoints, r.engagement.checkpoints);
});

test("the one-pager and the deck show results at checkpoints; sensitive opportunities stay out", () => {
  const e = project([cp("c30")]);
  const page = bc.buildOnePager(e, "opp-a");
  assert.equal(page.checkpoints.length, 1);
  assert.equal(page.checkpoints[0].status, "met");
  const slide = pptx.deckFromEngagement(e, {}).slides.find(x => x.title === "Results at checkpoints");
  assert.deepEqual(slide.headers, ["Opportunity", "Checkpoint", "Expected hours a year", "Realized hours a year", "Status"]);
  assert.equal(slide.rows[0][0], "Pre-fill intake");
  assert.equal(slide.rows[0][4], "Met");
  e.records[0].sensitive = true;
  assert.deepEqual(benefits.expectedVsCheckpoints(e), []);
  assert.equal(benefits.expectedVsCheckpoints(e, { includeSensitive: true }).length, 1);
});
