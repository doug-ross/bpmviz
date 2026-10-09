// Event-log import (mining slice): timestamps, time bases, statistics, the
// aggregation into a dataset, generated scenarios and the store commands.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { lib, root, tinyEngagement, example } from "./helpers.mjs";

const csv = lib("csv");
const fuzzy = lib("fuzzy");
const mining = lib("mining");
const validate = lib("validate");
const storeLib = lib("store");
const xlsx = lib("xlsx");
const datasetQuery = lib("dataset-query");
mining.registerStoreCommands();

const loaded = e => validate.validateEngagement(e).engagement;
const utc = s => Date.parse(s + "Z");

/* Reads tests/fixtures/logs/<name> and maps activities by name. */
function readLog(name, extra) {
  const text = fs.readFileSync(path.join(root, "tests", "fixtures", "logs", name), "utf8");
  const table = mining.tableFromRows(csv.parse(text).rows);
  const cols = mining.guessColumns(table.header);
  const fmt = mining.detectTimestampFormat(table.rows.map(r => r[cols.mode === "start-end" ? cols.start : cols.timestamp]));
  const builder = mining.createEventBuilder(cols, Object.assign({ mode: cols.mode, format: fmt.format, resources: "counted" }, extra || {}));
  builder.add(table.rows, table.firstDataRow);
  return { cols, fmt, table, built: builder.result() };
}

function tinyImport(options) {
  const e = loaded(tinyEngagement());
  const model = e.models[0];
  const { cols, built } = readLog("tiny.csv");
  const matches = fuzzy.matchActivities(mining.activitiesOf(built.events), mining.mappableSteps(model).map(n => ({ id: n.id, label: n.label })));
  const mapping = Object.fromEntries(matches.map(m => [m.activity, { nodeId: m.nodeId, method: m.method || "ignored" }]));
  const ends = mining.defaultEndNodes(model, matches.map(m => m.nodeId).filter(Boolean));
  const out = mining.aggregate(Object.assign({
    model, events: built.events, caseNames: built.caseNames, mapping, mode: cols.mode, timeBasis: e.meta.timeBasis,
    scenarioTimeBasis: e.meta.timeBasis, endNodeIds: ends, requireEnd: true, resources: "counted", caseIds: "sequence",
    topVariants: 3, name: "Tiny log", dataStatus: "demonstration",
    source: { fileName: "tiny.csv", format: "csv", rows: built.rows, droppedRows: built.droppedRows }
  }, options || {}));
  return { e, model, out, built, ends };
}

test("timestamps: ISO with and without offsets, day or month first, 12-hour clocks and Excel numbers", () => {
  assert.equal(mining.parseTimestamp("2026-01-05 09:30", "iso"), utc("2026-01-05T09:30:00"));
  assert.equal(mining.parseTimestamp("2026-01-05T09:30:15.250Z", "iso"), utc("2026-01-05T09:30:15.250"));
  assert.equal(mining.parseTimestamp("2026-01-05T09:30:00+01:00", "iso"), utc("2026-01-05T08:30:00"));
  assert.equal(mining.parseTimestamp("2026-01-05T09:30-0500", "iso"), utc("2026-01-05T14:30:00"));
  assert.equal(mining.parseTimestamp("2026/01/05", "iso"), utc("2026-01-05T00:00:00"));
  assert.equal(mining.parseTimestamp("31/01/2026 14:05", "dmy"), utc("2026-01-31T14:05:00"));
  assert.equal(mining.parseTimestamp("01/31/2026 2:05 PM", "mdy"), utc("2026-01-31T14:05:00"));
  assert.equal(mining.parseTimestamp("01/31/26 12:10 am", "mdy"), utc("2026-01-31T00:10:00"));
  assert.equal(mining.parseTimestamp("05.01.2026 09:00:00", "dmy"), utc("2026-01-05T09:00:00"));
  assert.equal(mining.parseTimestamp("30/02/2026", "dmy"), null, "no 30 February");
  assert.equal(mining.parseTimestamp("2026-01-05 25:00", "iso"), null);
  assert.equal(mining.parseTimestamp("yesterday", "iso"), null);
  assert.equal(mining.parseTimestamp("46027.5", "serial"), utc("2026-01-05T12:00:00"));
  assert.equal(mining.parseTimestamp({ date: 46027.25 }, "dmy"), utc("2026-01-05T06:00:00"), "an Excel date cell is a date in any format");
  assert.equal(mining.parseTimestamp({ date: 44565.5 }, "iso", true), utc("2026-01-05T12:00:00"), "1904 date system");
  assert.equal(mining.parseTimestamp(46027, "iso"), utc("2026-01-05T00:00:00"));
});

test("the format is detected from the values, and day-month order is ambiguous until a part passes 12", () => {
  assert.deepEqual(mining.detectTimestampFormat(["2026-01-05 09:00", "2026-01-06 10:00", ""]), { format: "iso", ambiguous: false, matched: 2, total: 2 });
  assert.equal(mining.detectTimestampFormat(["05/01/2026", "31/01/2026"]).format, "dmy");
  assert.equal(mining.detectTimestampFormat(["01/05/2026", "01/31/2026"]).format, "mdy");
  const amb = mining.detectTimestampFormat(["01/02/2026", "03/04/2026"]);
  assert.deepEqual([amb.format, amb.ambiguous], ["dmy", true]);
  assert.equal(mining.detectTimestampFormat([46027.5, { date: 46028 }, "46029.1"]).format, "serial");
  assert.deepEqual(mining.detectTimestampFormat([null, ""]), { format: null, ambiguous: false, matched: 0, total: 0 });
});

test("wall-clock times are read as UTC, so a daylight-saving change does not shift a duration", () => {
  // 29 March 2026 is the European clock change; 01:30 to 03:30 is two hours on the wall clock.
  const a = mining.parseTimestamp("2026-03-29 01:30", "iso"), b = mining.parseTimestamp("2026-03-29 03:30", "iso");
  assert.equal(mining.elapsedMinutes(a, b, { calendar: "calendar" }), 120);
});

test("business time counts Monday to Friday within working hours", () => {
  const tb = { calendar: "business", businessMinutesPerDay: 480, dayStartMinute: 540 };
  const fri = utc("2026-01-09T16:00:00"), mon = utc("2026-01-12T10:00:00");
  assert.equal(mining.elapsedMinutes(fri, mon, { calendar: "calendar" }), 66 * 60);
  assert.equal(mining.elapsedMinutes(fri, mon, tb), 120, "Friday 16:00 to 17:00 and Monday 09:00 to 10:00");
  assert.equal(mining.elapsedMinutes(utc("2026-01-10T10:00:00"), utc("2026-01-11T15:00:00"), tb), 0, "a weekend has no business time");
  assert.equal(mining.elapsedMinutes(utc("2026-01-05T07:00:00"), utc("2026-01-05T20:00:00"), tb), 480, "outside hours counts nothing");
  assert.equal(mining.elapsedMinutes(utc("2026-01-05T09:00:00"), utc("2026-01-19T09:00:00"), tb), 10 * 480);
  assert.equal(mining.sameBasis({ calendar: "calendar" }, { calendar: "calendar", businessMinutesPerDay: 300 }), true);
  assert.equal(mining.sameBasis(tb, { calendar: "business", businessMinutesPerDay: 450 }), false);
});

test("statistics use linear-interpolation percentiles", () => {
  assert.deepEqual(mining.statsOf([4, 1, 3, 2]), { n: 4, mean: 2.5, min: 1, p10: 1.3, p25: 1.75, p50: 2.5, p75: 3.25, p90: 3.7, max: 4 });
  assert.deepEqual(mining.statsOf([7]), { n: 1, mean: 7, min: 7, p10: 7, p25: 7, p50: 7, p75: 7, p90: 7, max: 7 });
  assert.equal(mining.statsOf([]), null);
});

test("columns are guessed from common and XES headers", () => {
  assert.deepEqual(mining.guessColumns(["Case ID", "Activity", "Start", "End", "Resource"]),
    { caseId: 0, activity: 1, start: 2, end: 3, timestamp: -1, resource: 4, mode: "start-end" });
  const xes = mining.guessColumns(["case:concept:name", "concept:name", "time:timestamp", "org:resource"]);
  assert.deepEqual([xes.caseId, xes.activity, xes.timestamp, xes.resource, xes.mode], [0, 1, 2, 3, "single"]);
  const claim = mining.guessColumns(["Claim number", "Step", "Completed at"]);
  assert.deepEqual([claim.caseId, claim.activity, claim.timestamp, claim.mode], [0, 1, 2, "single"]);
  assert.deepEqual(mining.tableFromRows([[], ["Report"], ["case", "activity"], ["1", "a"], [null, ""], ["2", "b"]]),
    { header: ["case", "activity"], rows: [["1", "a"], ["2", "b"]], headerRow: 3, firstDataRow: 4 });
});

test("rows without a case, an activity or a readable time are dropped and counted", () => {
  const { built } = readLog("tiny.csv");
  assert.equal(built.rows, 13);
  assert.equal(built.droppedRows, 2);
  assert.deepEqual(built.dropped, { missingCase: 1, missingActivity: 0, badTimestamp: 1, endBeforeStart: 0 });
  assert.deepEqual(built.examples.map(x => x.reason), ["no case ID", "a time that could not be read"]);
  assert.equal(built.events.length, 11);
  assert.deepEqual(mining.activitiesOf(built.events).map(a => a.name + " " + a.events), ["Do the work 5", "Done 3", "Fix 2", "Coffee break 1"]);
  const b = mining.createEventBuilder({ caseId: 0, activity: 1, start: 2, end: 3, resource: -1 }, { mode: "start-end", format: "iso", maxEvents: 1 });
  b.add([["1", "a", "2026-01-05 10:00", "2026-01-05 09:00"], ["1", "a", "2026-01-05 09:00", "2026-01-05 10:00"], ["2", "b", "2026-01-05 09:00", "2026-01-05 10:00"]], 2);
  const r = b.result();
  assert.equal(r.dropped.endBeforeStart, 1);
  assert.equal(r.tooManyEvents, true);
  assert.equal(r.events[0].r, null, "resources are dropped unless counted");
});

test("the tiny log aggregates into steps, rework, waits, transitions and variants", () => {
  const { out, ends } = tinyImport();
  const d = out.dataset;
  assert.deepEqual(ends.sort(), ["end", "work"], "cases may end at the step before the end event");
  assert.deepEqual(d.source, { fileName: "tiny.csv", format: "csv", sha256: "", rows: 13, events: 11, timestampMode: "start-end", caseIds: "sequence",
    resources: "counted", droppedRows: 2, unmatchedEvents: 1, excludedIncompleteCases: 1 });
  assert.deepEqual(d.period, { start: "2026-01-05T09:00:00.000Z", end: "2026-01-05T13:00:00.000Z", days: 0.17 });
  assert.deepEqual([d.cases.count, d.cases.complete, d.cases.arrivalsPerDay, d.cases.annualizedVolume], [3, 3, 3, 1095]);
  assert.deepEqual([d.cases.cycleTime.min, d.cases.cycleTime.p50, d.cases.cycleTime.max], [40, 60, 90]);
  const work = d.steps.find(s => s.nodeId === "work");
  assert.deepEqual([work.visits, work.cases, work.caseShare, work.reworkCases, work.reworkRate], [4, 3, 1, 1, 0.3333]);
  assert.deepEqual([work.duration.n, work.duration.p50, work.duration.mean], [4, 25, 28.75]);
  assert.deepEqual([work.wait.n, work.wait.p50, work.sojourn.p50], [1, 10, 30]);
  assert.deepEqual([work.resources, work.handoffRate], [2, 1]);
  const end = d.steps.find(s => s.nodeId === "end");
  assert.equal(end.duration, null, "events have no duration");
  assert.deepEqual(d.transitions.map(t => [t.fromNodeId, t.toNodeId, t.count, t.edgeIds.join("+")]),
    [["work", "end", 3, "e2+e5"], ["work", "fix", 1, "e2+e3"], ["fix", "work", 1, "e4"]]);
  assert.deepEqual(d.variants.map(v => [v.id, v.nodeIds.join(">"), v.cases, v.share, v.cycleTime.p50]),
    [["v1", "work>end", 2, 0.6667, 50], ["v2", "work>fix>work>end", 1, 0.3333, 90]]);
  assert.deepEqual(d.otherVariants, { variants: 0, cases: 0 });
  assert.deepEqual(d.mapping.map(m => [m.activity, m.nodeId, m.method, m.events]),
    [["Do the work", "work", "exact", 5], ["Done", "end", "exact", 3], ["Fix", "fix", "exact", 2], ["Coffee break", null, "ignored", 1]]);
  assert.deepEqual(out.warnings.map(w => w.code), ["mining.order", "mining.incomplete"]);
  const text = JSON.stringify(d);
  ["C1", "C2", "Ann", "Ben", "Cat"].forEach(x => assert.ok(!text.includes("\"" + x + "\""), x + " is not stored"));
  const v = validate.sanitizeDataset(d, loaded(tinyEngagement()));
  assert.deepEqual(v.errors, []);
});

test("without the end-step rule every case counts, and an unknown pair has no connector path", () => {
  const { out } = tinyImport({ requireEnd: false });
  assert.equal(out.dataset.cases.count, 4);
  assert.equal(out.dataset.cases.complete, 3);
  assert.equal(out.dataset.source.excludedIncompleteCases, 0);
  const model = tinyEngagement().models[0];
  assert.equal(mining.edgePath(model, "fix", "end"), null);
  assert.deepEqual(mining.edgePath(model, "start", "work"), ["e1"]);
  const events = [{ c: 0, a: "Fix", s: 0, e: 60000, i: 0 }, { c: 0, a: "Done", s: 120000, e: 120000, i: 1 }];
  const r = mining.aggregate({ model, events, mapping: { Fix: "fix", Done: "end" }, mode: "start-end", topVariants: 0, dataStatus: "observed" });
  assert.deepEqual(r.dataset.transitions, [{ fromNodeId: "fix", toNodeId: "end", count: 1, edgeIds: [] }]);
  assert.ok(r.warnings.some(w => w.code === "mining.notInModel"));
  assert.equal(r.scenarios.length, 0);
});

test("cases with no mapped event are not reported as incomplete, and without end steps no case counts as complete", () => {
  const model = tinyEngagement().models[0];
  const events = [];
  for (let c = 0; c < 5; c++) events.push({ c, a: "Coffee break", s: c * 60000, e: c * 60000 + 1000, i: events.length });
  events.push({ c: 5, a: "Do the work", s: 0, e: 60000, i: events.length }, { c: 5, a: "Done", s: 120000, e: 120000, i: events.length + 1 });
  events.push({ c: 6, a: "Fix", s: 0, e: 60000, i: events.length + 2 });
  const mapping = { "Do the work": "work", Done: "end", Fix: "fix" };
  const free = mining.aggregate({ model, events, mapping, mode: "start-end", requireEnd: false, topVariants: 0, dataStatus: "observed" });
  assert.equal(free.dataset.source.excludedIncompleteCases, 0, "no end-step rule applied");
  assert.deepEqual([free.counts.noMapped, free.dataset.cases.count, free.dataset.cases.complete], [5, 2, 0]);
  assert.ok(free.warnings.some(w => w.code === "mining.unmapped" && /^5 cases have no event mapped/.test(w.message)));
  assert.ok(free.warnings.some(w => w.code === "mining.noEndSteps"));
  const ruled = mining.aggregate({ model, events, mapping, mode: "start-end", endNodeIds: ["end"], topVariants: 0, dataStatus: "observed" });
  assert.equal(ruled.dataset.source.excludedIncompleteCases, 1, "only the case ending at Fix is incomplete");
  assert.deepEqual([ruled.counts.noMapped, ruled.dataset.cases.count, ruled.dataset.cases.complete], [5, 1, 1]);
  assert.ok(!ruled.warnings.some(w => w.code === "mining.noEndSteps"));
  const open = mining.aggregate({ model, events, mapping, mode: "start-end", endNodeIds: ["end"], requireEnd: false, topVariants: 0, dataStatus: "observed" });
  assert.deepEqual([open.dataset.cases.count, open.dataset.cases.complete, open.dataset.source.excludedIncompleteCases], [2, 1, 0]);
});

test("long variants that differ only after the stored steps are one variant row", () => {
  const model = tinyEngagement().models[0];
  const limit = lib("schema").LIMITS.variantSteps;
  const events = [];
  for (let c = 0; c < 2; c++) {
    for (let k = 0; k < 400; k++) {
      const a = k > 250 && c === 1 ? (k % 3 ? "Do the work" : "Fix") : (k % 2 ? "Fix" : "Do the work");
      events.push({ c, a, s: k * 60000, e: k * 60000 + 30000, i: events.length });
    }
  }
  const r = mining.aggregate({ model, events, mapping: { "Do the work": "work", Fix: "fix" }, mode: "start-end", requireEnd: false, topVariants: 0, dataStatus: "observed" });
  const d = r.dataset;
  assert.equal(d.variants.length, 1);
  assert.deepEqual([d.variants[0].nodeIds.length, d.variants[0].cases, d.variants[0].share], [limit, 2, 1]);
  assert.match(r.warnings.find(w => w.code === "mining.variantSteps").message, /^1 variant is longer than 200 steps.*counted as one variant/);
  const ids = d.variants.map(v => v.nodeIds.join(">"));
  assert.equal(new Set(ids).size, ids.length, "stored variant rows are distinct");
  assert.deepEqual(validate.sanitizeDataset(d, loaded(tinyEngagement())).errors, []);
});

test("only the top 100 variants are kept; the rest are counted, and case shares become bounds", () => {
  const model = tinyEngagement().models[0];
  const events = [];
  let i = 0;
  for (let c = 0; c < 105; c++) {
    for (let k = 0; k <= c; k++) events.push({ c, a: "Do the work", s: k * 60000, e: k * 60000 + 30000, i: i++ });
    if (c % 2) events.push({ c, a: "Fix", s: (c + 2) * 60000, e: (c + 3) * 60000, i: i++ });
  }
  const r = mining.aggregate({ model, events, mapping: { "Do the work": { nodeId: "work", method: "manual" }, Fix: { nodeId: "fix", method: "fuzzy" } },
    mode: "start-end", requireEnd: false, topVariants: 2, dataStatus: "observed" });
  const d = r.dataset;
  assert.equal(d.variants.length, 100);
  assert.deepEqual(d.otherVariants, { variants: 5, cases: 5 });
  assert.equal(d.mapping.find(m => m.activity === "Fix").method, "fuzzy");
  const share = datasetQuery.caseShareForNodes(d, ["fix"]);
  assert.equal(share.exact, false);
  assert.ok(share.lower <= share.value && share.value <= share.upper);
  assert.equal(r.scenarios.length, 2);
});

test("scenarios replay the case closest to its variant median and pass validation through dataset/import", () => {
  const { e, out } = tinyImport();
  assert.equal(out.scenarios.length, 2);
  const sc = out.scenarios[0];
  assert.equal(sc.provenance, "illustrative", "a demonstration log gives illustrative scenarios");
  assert.equal(sc.observedFrom.caseLabel, "Case 1");
  const run = sc.runs["m-current"];
  assert.deepEqual(run.visits.map(v => [v.nodeId, v.start, v.end]), [["start", 0, 0], ["work", 0, 30], ["check", 30, 30], ["end", 40, 40]]);
  assert.deepEqual(run.transitions.map(t => t.edgeId), ["e1", "e2", "e5"]);
  assert.deepEqual(run.membership, { start: "included", work: "included", check: "included", fix: "excluded", end: "included" });
  assert.deepEqual(sc.measures.map(m => [m.key, m.unit, m.values["m-current"], m.status]), [["cycleTime", "minute", 40, "supplied"], ["humanTouch", "hour", 0.5, "supplied"]]);

  const store = storeLib.createStore(e);
  const res = store.dispatch("dataset/import", { dataset: out.dataset, scenarios: out.scenarios });
  assert.deepEqual(res, { datasetId: "ds-tiny-log", scenarioIds: ["sc-tiny-log-1", "sc-tiny-log-2"], warnings: 0 });
  const after = store.get();
  assert.deepEqual(after.datasets[0].scenarioIds, res.scenarioIds);
  assert.equal(after.scenarios[1].observedFrom.datasetId, "ds-tiny-log");
  assert.equal(after.scenarios[1].runs["m-current"].visits.length, 7);
  const check = validate.validateEngagement(JSON.parse(JSON.stringify(after)));
  assert.equal(check.ok, true, JSON.stringify(check.errors));
  assert.deepEqual(check.warnings.filter(w => w.level !== "info"), []);
  assert.equal(store.dispatch("dataset/import", { dataset: out.dataset, scenarios: [] }).datasetId, "ds-tiny-log-2");
  store.undo();
  store.undo();
  assert.deepEqual([(store.get().datasets || []).length, store.get().scenarios.length], [0, 0], "each import is one undo step");
});

test("case labels are hashed, numbered or kept, as chosen", () => {
  const salt = crypto.randomBytes(8).toString("hex");
  const hashCase = id => crypto.createHash("sha256").update(salt + id).digest("hex");
  const hashed = tinyImport({ caseIds: "hashed", hashCase }).out;
  assert.match(hashed.scenarios[0].observedFrom.caseLabel, /^Case [0-9a-f]{8}$/);
  assert.equal(hashed.dataset.source.caseIds, "hashed");
  assert.equal(tinyImport({ caseIds: "original" }).out.scenarios[0].observedFrom.caseLabel, "C1");
});

test("a business-time log measures waits in working minutes", () => {
  const model = tinyEngagement().models[0];
  const tb = { calendar: "business", businessMinutesPerDay: 480, dayStartMinute: 540 };
  const events = [
    { c: 0, a: "Do the work", s: utc("2026-01-09T16:00:00"), e: utc("2026-01-09T16:30:00"), i: 0 },
    { c: 0, a: "Done", s: utc("2026-01-12T10:00:00"), e: utc("2026-01-12T10:00:00"), i: 1 }
  ];
  const r = mining.aggregate({ model, events, mapping: { "Do the work": "work", Done: "end" }, mode: "start-end", timeBasis: tb, topVariants: 1, dataStatus: "observed",
    scenarioTimeBasis: { calendar: "calendar" } });
  assert.equal(r.dataset.cases.cycleTime.p50, 120);
  assert.equal(r.dataset.steps.find(s => s.nodeId === "end").wait.p50, 90);
  assert.equal(r.scenarios[0].measures[0].values["m-current"], 66 * 60, "scenarios use the engagement's time basis");
  assert.equal(r.scenarios[0].provenance, "observed");
});

test("figures go into the value model with the dataset's basis and source", () => {
  const { e, out } = tinyImport();
  e.scenarios.push(loaded(Object.assign(tinyEngagement(), { scenarios: [{ id: "base", name: "Base", runs: {} }] })).scenarios[0]);
  const store = storeLib.createStore(e);
  const { datasetId } = store.dispatch("dataset/import", { dataset: out.dataset, scenarios: [] });
  const r = store.dispatch("dataset/applyToValueModel", { datasetId, annualVolume: true, scenarioId: "base", cycleTime: true, humanTouch: true });
  assert.deepEqual(r.applied, ["annualVolume", "cycleTime", "humanTouch"]);
  const a = store.get().assumptions.find(x => x.key === "annualVolume");
  assert.deepEqual([a.value, a.status, a.source], [1095, "illustrative", "Event log tiny.csv, 2026-01-05 to 2026-01-05, 3 cases"]);
  const s = store.get().scenarios.find(x => x.id === "base");
  const cycle = s.measures.find(m => m.key === "cycleTime");
  assert.deepEqual([cycle.values["m-current"], cycle.unit, cycle.status], [60, "minute", "supplied"]);
  assert.match(cycle.note, /Median cycle time\. Event log tiny\.csv.*Demonstration data\./);
  assert.equal(s.measures.find(m => m.key === "humanTouch").values["m-current"], 0.806);
  assert.equal(mining.humanTouchHours(store.get(), store.get().datasets[0]), 0.806);
  assert.throws(() => store.dispatch("dataset/applyToValueModel", { datasetId }), /Choose at least one figure/);
  assert.throws(() => store.dispatch("dataset/applyToValueModel", { datasetId, cycleTime: true, scenarioId: "nope" }), /Choose the scenario/);
  const observed = loaded(tinyEngagement());
  observed.meta.timeBasis = { unit: "minute", calendar: "business", businessMinutesPerDay: 480 };
  observed.scenarios.push(s);
  const ds = Object.assign({}, out.dataset, { dataStatus: "observed" });
  const st2 = storeLib.createStore(observed);
  const id2 = st2.dispatch("dataset/import", { dataset: ds, scenarios: [] }).datasetId;
  assert.throws(() => st2.dispatch("dataset/applyToValueModel", { datasetId: id2, cycleTime: true, scenarioId: "base" }), /calendar time and the engagement in business time/);
  st2.dispatch("dataset/applyToValueModel", { datasetId: id2, annualVolume: true });
  assert.equal(st2.get().assumptions.find(x => x.key === "annualVolume").status, "observed");
});

test("dataset/import checks the payload, the limits and the references", () => {
  const { e, out } = tinyImport();
  const store = storeLib.createStore(e);
  assert.throws(() => store.dispatch("dataset/import", {}), /No event log/);
  assert.throws(() => store.dispatch("dataset/import", { dataset: Object.assign({}, out.dataset, { modelId: "m-gone" }) }), /model for this event log/);
  assert.throws(() => store.dispatch("dataset/import", { dataset: Object.assign({}, out.dataset, { comparesToDatasetId: "ds-gone" }) }), /compare with/);
  assert.throws(() => store.dispatch("dataset/import", { dataset: out.dataset, scenarios: new Array(11).fill(out.scenarios[0]) }), /At most 10 scenarios/);
  for (let k = 0; k < 12; k++) store.dispatch("dataset/import", { dataset: out.dataset });
  assert.throws(() => store.dispatch("dataset/import", { dataset: out.dataset }), /at most 12 event logs/);
  assert.equal(mining.registerStoreCommands(), true, "registering twice is harmless");
});

test("lenses and step facts read the latest dataset for the model and say what they cover", () => {
  const { e, out } = tinyImport();
  const model = e.models[0];
  const none = mining.shareLens({ model, engagement: e });
  assert.equal(none.population, "No event log is linked to this model.");
  assert.equal(none.coverage.have, 0);
  const store = storeLib.createStore(e);
  store.dispatch("dataset/import", { dataset: out.dataset, scenarios: [] });
  const eng = store.get();
  const share = mining.shareLens({ model, engagement: eng });
  assert.deepEqual(share.nodes.work, { level: 4, text: "100% of cases, 33.3% repeat" });
  assert.deepEqual(share.nodes.fix, { level: 2, text: "33.3% of cases" });
  assert.deepEqual(share.coverage, { have: 2, total: 2, text: "2 of 2 activities appear in the log" });
  assert.match(share.population, /^3 cases in Tiny log, 2026-01-05 to 2026-01-05\. Demonstration data\.$/);
  assert.ok(share.edges.e5 && share.edges.e4);
  const time = mining.timeLens({ model, engagement: eng });
  assert.equal(time.nodes.work.text, "25m median (n=4)");
  assert.match(time.unit, /Calendar time/);
  assert.match(time.notes[0], /2 activities have fewer than 5 visits/);
  const facts = Object.fromEntries(mining.stepFacts(eng.datasets[0], "work"));
  assert.equal(facts.Cases, "3 of 3 (100%)");
  assert.equal(facts["Repeat visits"], "1 case (33.3% of the cases that visit)");
  assert.match(facts["Duration, start to end"], /^25m median, 41m at the 90th percentile \(only 4 visits\)$/);
  assert.equal(mining.stepFacts(eng.datasets[0], "check"), null);
});

test("an Excel workbook with date cells reads like the CSV", async () => {
  const { built: fromCsv } = readLog("tiny.csv");
  const serial = ms => ms / 86400000 + 25569;
  const rows = [["Case ID", "Activity", "Start", "End"]].concat(fromCsv.events.map(ev => [fromCsv.caseNames[ev.c], ev.a, { date: serial(ev.s) }, { date: serial(ev.e) }]));
  const bytes = await xlsx.workbookBytesAsync({ sheets: [{ name: "Log", rows }] }, { deflateRaw: b => new Uint8Array(zlib.deflateRawSync(b)) });
  const wb = await xlsx.readWorkbookAsync(bytes, { inflateRaw: (b, max) => new Uint8Array(zlib.inflateRawSync(b, max ? { maxOutputLength: max } : {})) });
  const table = mining.tableFromRows(wb.sheets[0].rows);
  const cols = mining.guessColumns(table.header);
  const fmt = mining.detectTimestampFormat(table.rows.map(r => r[cols.start]));
  assert.equal(fmt.format, "serial");
  const b = mining.createEventBuilder(cols, { mode: cols.mode, format: fmt.format, date1904: wb.date1904 });
  b.add(table.rows, table.firstDataRow);
  assert.deepEqual(b.result().events.map(ev => [ev.a, ev.s, ev.e]), fromCsv.events.map(ev => [ev.a, ev.s, ev.e]));
});

test("an underwriting log maps to the example model, with a similar name suggested", () => {
  const e = loaded(example("underwriting-current-state"));
  const model = e.models[0];
  const { built, cols } = readLog("underwriting.csv");
  const acts = mining.activitiesOf(built.events);
  const matches = fuzzy.matchActivities(acts, mining.mappableSteps(model).map(n => ({ id: n.id, label: n.label })));
  const byName = Object.fromEntries(matches.map(m => [m.activity, m]));
  assert.equal(byName["Check clearance and dedupe"].method, "fuzzy");
  assert.equal(byName["Check clearance and dedupe"].nodeId, "check-clearance-dedup");
  assert.equal(byName["Email the broker"].nodeId, null);
  const mapping = Object.fromEntries(matches.map(m => [m.activity, { nodeId: m.nodeId, method: m.method || "ignored" }]));
  const ends = mining.defaultEndNodes(model, matches.map(m => m.nodeId).filter(Boolean));
  const out = mining.aggregate({ model, events: built.events, caseNames: built.caseNames, mapping, mode: cols.mode, timeBasis: e.meta.timeBasis,
    scenarioTimeBasis: e.meta.timeBasis, endNodeIds: ends, requireEnd: true, topVariants: 3, dataStatus: "demonstration", caseIds: "sequence" });
  assert.ok(out.dataset.cases.count >= 10);
  const parallel = new Set(["desk-review-cope-protections", "publish-risk-report-pml-mfl-recs", "ingest-sov-into-cat-platform", "run-wind-flood-quake-aal-pml"]);
  const off = out.dataset.transitions.filter(t => !t.edgeIds.length);
  assert.ok(off.length > 0, "the two parallel branches interleave in the log");
  assert.ok(off.every(t => parallel.has(t.fromNodeId) && parallel.has(t.toNodeId)), "only pairs across the parallel branches have no connector path");
  assert.ok(out.warnings.some(w => w.code === "mining.notInModel"));
  assert.equal(out.dataset.source.excludedIncompleteCases, 1, "the case that stops at pricing is left out");
  const store = storeLib.createStore(e);
  store.dispatch("dataset/import", { dataset: out.dataset, scenarios: out.scenarios });
  const v = validate.validateEngagement(JSON.parse(JSON.stringify(store.get())));
  assert.equal(v.ok, true, JSON.stringify(v.errors.slice(0, 3)));
  assert.deepEqual(v.warnings.filter(w => w.level !== "info" && !/^(econ|recon|value)/.test(w.code || "")).map(w => w.message), []);
});
