import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { lib, root, example, tinyEngagement } from "./helpers.mjs";

const S = lib("screening");
const validate = lib("validate");

/* A screening with two criteria per group, so the arithmetic is easy to follow. */
function small() {
  const s = S.blankScreening({ id: "scr-test", title: "Test screening", currency: "EUR" });
  s.criteria = [
    { id: "v1", label: "Volume", group: "value", weight: 3, gateAtOrBelow: null, help: "", anchors: { 1: "", 3: "", 5: "" } },
    { id: "v2", label: "Pain", group: "value", weight: 1, gateAtOrBelow: null, help: "", anchors: { 1: "", 3: "", 5: "" } },
    { id: "f1", label: "Rules", group: "feasibility", weight: 2, gateAtOrBelow: null, help: "", anchors: { 1: "", 3: "", 5: "" } },
    { id: "r1", label: "Sponsor", group: "readiness", weight: 2, gateAtOrBelow: 1, help: "", anchors: { 1: "", 3: "", 5: "" } }
  ];
  return s;
}

function withCandidate(s, name, scores, fields) {
  const added = S.addCandidate(s, Object.assign({ name }, fields));
  let next = added.screening;
  Object.entries(scores).forEach(([k, v]) => { next = S.setScore(next, added.candidateId, k, typeof v === "object" ? v : { value: v }).screening; });
  return { screening: next, id: added.candidateId };
}

test("a blank screening has the default criteria and survives a save and open", () => {
  const s = S.blankScreening({ title: "Q3 screening", clientDisplayName: "Northwind" });
  assert.equal(s.schema, "aixray.screening");
  assert.equal(s.criteria.length, S.DEFAULT_CRITERIA.length);
  assert.deepEqual(s.criteria.map(c => c.group).filter((g, i, a) => a.indexOf(g) === i), ["value", "feasibility", "readiness"]);
  const { screening } = withCandidate(s, "Claims intake", { volume: 4, pain: { value: 5, basis: "supplied", note: "Backlog of 3 weeks" } },
    { facts: { annualVolume: { value: 12000, basis: "supplied", note: "" }, effortHoursPerCase: null, hourlyRate: null } });
  const opened = S.parseScreening(JSON.stringify(screening));
  assert.equal(opened.ok, true, opened.errors.join("; "));
  assert.deepEqual(opened.warnings, []);
  assert.deepEqual(opened.screening, screening);
});

test("files that are not screenings, or from a newer version, are refused", () => {
  assert.match(S.parseScreening("{not json").errors[0], /not valid JSON/);
  assert.match(S.parseScreening("[]").errors[0], /does not hold a screening/);
  assert.match(S.parseScreening(JSON.stringify(tinyEngagement())).errors[0], /not an AIxRay screening/);
  assert.match(S.parseScreening({ schema: "aixray.screening", schemaVersion: 2 }).errors[0], /newer version/);
});

test("opening a screening keeps only bounded, known data", () => {
  const raw = {
    schema: "aixray.screening", schemaVersion: 1, id: "scr-x", extra: "dropped",
    meta: { title: "x".repeat(500), confidentiality: "top-secret", currency: "euro" },
    criteria: [
      { id: "a", label: "Alpha", group: "nonsense", weight: 99, gateAtOrBelow: 5 },
      { id: "a", label: "Duplicate" },
      { id: "bad id!", label: "Bad" },
      { id: "b", label: "" }
    ],
    candidates: [
      { id: "c1", name: "One", scores: { a: { value: 9 }, ghost: { value: 3 } }, facts: { annualVolume: { value: -4 }, unknown: { value: 1 } },
        source: { engagementId: "eng-1", steps: -1, topOpportunity: { title: "T", value: 10, unit: "parsecs" } }, sensitive: "yes" },
      { id: "c2", name: "  " }
    ]
  };
  const { ok, warnings, screening } = S.parseScreening(raw);
  assert.equal(ok, true);
  assert.equal(screening.meta.title.length, 200);
  assert.equal(screening.meta.confidentiality, "internal");
  assert.equal(screening.meta.currency, "USD");
  assert.deepEqual(screening.criteria.map(c => [c.id, c.group, c.weight, c.gateAtOrBelow]), [["a", "value", 10, null]]);
  const c = screening.candidates[0];
  assert.equal(screening.candidates.length, 1);
  assert.deepEqual(c.scores, { a: { value: null, basis: "illustrative", note: "" } });
  assert.deepEqual(c.facts.annualVolume, { value: null, basis: "illustrative", note: "" });
  assert.equal("unknown" in c.facts, false);
  assert.equal(c.sensitive, false);
  assert.equal(c.source.steps, 0);
  assert.equal(c.source.topOpportunity, null);
  assert.equal("extra" in screening, false);
  assert.ok(warnings.some(w => /second criterion/.test(w.message)));
  assert.ok(warnings.some(w => /criteria without a valid ID/.test(w.message)));
  assert.ok(warnings.some(w => /candidates without a valid ID/.test(w.message)));
});

test("changes return a new screening and leave the old one as it was", () => {
  const s = small();
  const before = JSON.stringify(s);
  const added = S.addCandidate(s, { name: "Invoice matching" });
  assert.equal(JSON.stringify(s), before);
  assert.equal(added.screening.revision, s.revision + 1);
  assert.equal(added.candidateId, "c-invoice-matching");
  const again = S.addCandidate(added.screening, { name: "Invoice matching" });
  assert.equal(again.candidateId, "c-invoice-matching-2");
  const scored = S.setScore(again.screening, added.candidateId, "v1", { value: 4 }).screening;
  assert.equal(again.screening.candidates[0].scores.v1, undefined);
  assert.equal(scored.candidates[0].scores.v1.value, 4);
  const noted = S.setScore(scored, added.candidateId, "v1", { note: "From the ops lead" }).screening;
  assert.deepEqual(noted.candidates[0].scores.v1, { value: 4, basis: "illustrative", note: "From the ops lead" });
  const removed = S.removeCandidate(noted, "c-invoice-matching-2").screening;
  assert.deepEqual(removed.candidates.map(c => c.id), ["c-invoice-matching"]);
});

test("changes refuse input a person can fix, with a plain message", () => {
  const { screening: s, id } = withCandidate(small(), "Payroll", {});
  assert.throws(() => S.setScore(s, id, "v1", { value: 0 }), /Scores run from 1 to 5/);
  assert.throws(() => S.setScore(s, id, "v1", { value: 2.5 }), /Scores run from 1 to 5/);
  assert.throws(() => S.setScore(s, "c-nope", "v1", { value: 3 }), /not in the screening/);
  assert.throws(() => S.setScore(s, id, "nope", { value: 3 }), /not in the screening/);
  assert.throws(() => S.addCandidate(s, { name: " " }), /Give the candidate a name/);
  assert.throws(() => S.updateCandidate(s, id, { facts: { annualVolume: { value: -1, basis: "supplied" } } }), /zero or a positive number/);
  assert.throws(() => S.updateCriterion(s, "v1", { weight: 11 }), /Weights run from 0 to 10/);
  assert.throws(() => S.updateCriterion(s, "v1", { gateAtOrBelow: 5 }), /score from 1 to 4/);
  assert.throws(() => S.updateCriterion(s, "v1", { group: "other" }), /value, feasibility or readiness/);
  try { S.setScore(s, id, "v1", { value: 7 }); } catch (err) { assert.equal(err.name, "ScreeningError"); }
});

test("the score is the weighted mean of the 1 to 5 scores on 0 to 100", () => {
  const top = withCandidate(small(), "All fives", { v1: 5, v2: 5, f1: 5, r1: 5 });
  const low = withCandidate(top.screening, "All twos", { v1: 2, v2: 2, f1: 2, r1: 2 });
  // v1 4 (75) x3, v2 2 (25) x1, f1 3 (50) x2, r1 5 (100) x2 = (225 + 25 + 100 + 200) / 8 = 68.75
  const mixed = withCandidate(low.screening, "Mixed", { v1: 4, v2: 2, f1: 3, r1: 5 });
  const rows = S.evaluate(mixed.screening).rows;
  assert.deepEqual(rows.map(r => [r.name, r.score]), [["All fives", 100], ["Mixed", 68.75], ["All twos", 25]]);
  const m = rows.find(r => r.name === "Mixed");
  assert.equal(m.groups.value.score, (3 * 75 + 25) / 4);
  assert.equal(m.groups.feasibility.score, 50);
  assert.equal(m.ease, 75);
  assert.equal(m.coverage, 1);
  assert.deepEqual(m.missing, []);
});

test("a missing score leaves the score blank; the candidate ranks after complete ones on a provisional score", () => {
  const complete = withCandidate(small(), "Complete", { v1: 2, v2: 2, f1: 2, r1: 2 });
  const partial = withCandidate(complete.screening, "Partial", { v1: 5, v2: 5, f1: 5 });
  const empty = withCandidate(partial.screening, "Empty", {});
  const { rows, notes } = S.evaluate(empty.screening);
  assert.deepEqual(rows.map(r => r.name), ["Complete", "Partial", "Empty"]);
  const p = rows[1];
  assert.equal(p.score, null);
  assert.equal(p.provisional, 100);
  assert.equal(p.coverage, 6 / 8);
  assert.deepEqual(p.missing, ["Sponsor"]);
  assert.equal(p.ease, null);
  assert.equal(p.quadrant, null, "no quadrant without both axes complete");
  assert.equal(rows[2].provisional, null);
  assert.equal(rows[2].coverage, 0);
  assert.ok(notes.some(n => /not fully scored/.test(n)));
});

test("a criterion with weight 0 does not count and does not block a complete score", () => {
  let { screening: s, id } = withCandidate(small(), "One", { v1: 5, v2: 1, f1: 5 });
  s = S.updateCriterion(s, "r1", { weight: 0 }).screening;
  const row = S.evaluate(s).rows[0];
  assert.equal(row.score, (3 * 100 + 0 + 2 * 100) / 6);
  assert.deepEqual(row.missing, []);
  assert.equal(S.updateCriterion(s, "r1", { weight: 2 }).screening.candidates.find(c => c.id === id).scores.r1, undefined);
});

test("quadrants place value against ease, with 50 as the line", () => {
  const cases = [
    [{ v1: 5, v2: 5, f1: 5, r1: 5 }, "start-here"],
    [{ v1: 5, v2: 5, f1: 1, r1: 2 }, "larger-effort"],
    [{ v1: 1, v2: 1, f1: 5, r1: 5 }, "easy-small"],
    [{ v1: 2, v2: 2, f1: 2, r1: 2 }, "not-now"],
    [{ v1: 3, v2: 3, f1: 3, r1: 3 }, "start-here"]
  ];
  cases.forEach(([scores, quadrant]) => {
    const { screening } = withCandidate(small(), "Q", scores);
    assert.equal(S.evaluate(screening).rows[0].quadrant, quadrant, JSON.stringify(scores));
  });
  assert.deepEqual(Object.keys(S.QUADRANTS), ["start-here", "larger-effort", "easy-small", "not-now"]);
});

test("a result carries the weakest basis among its scores", () => {
  const { screening } = withCandidate(small(), "B", {
    v1: { value: 4, basis: "validated" }, v2: { value: 4, basis: "observed" }, f1: { value: 4, basis: "supplied" }, r1: { value: 4, basis: "validated" }
  });
  const row = S.evaluate(screening).rows[0];
  assert.equal(row.basis, "supplied");
  assert.equal(row.groups.value.basis, "observed");
});

test("annual effort figures multiply typed facts and stay blank when one is missing", () => {
  const facts = { annualVolume: { value: 1000, basis: "supplied", note: "" }, effortHoursPerCase: { value: 2, basis: "illustrative", note: "" }, hourlyRate: null };
  let { screening: s } = withCandidate(small(), "F", {}, { facts });
  let f = S.evaluate(s).rows[0].figures;
  assert.equal(f.annualEffortHours.value, 2000);
  assert.equal(f.annualEffortHours.basis, "illustrative");
  assert.equal(f.annualEffortCost.value, null);
  assert.deepEqual(f.annualEffortCost.missing, ["Fully loaded hourly rate"]);
  s = S.parseScreening(Object.assign({}, s, { meta: Object.assign({}, s.meta, { hourlyRate: { value: 50, basis: "supplied" } }) })).screening;
  f = S.evaluate(s).rows[0].figures;
  assert.equal(f.annualEffortCost.value, 100000);
  assert.ok(f.annualEffortCost.notes.some(n => /screening's hourly rate/.test(n)));
});

test("flags mark a candidate without removing it from the ranking", () => {
  const a = withCandidate(small(), "No sponsor", { v1: 5, v2: 5, f1: 5, r1: 1 });
  const b = withCandidate(a.screening, "Restricted", { v1: 3, v2: 3, f1: 3, r1: 3 }, { confidentiality: "restricted" });
  const { rows, notes } = S.evaluate(b.screening);
  const noSponsor = rows.find(r => r.name === "No sponsor"), restricted = rows.find(r => r.name === "Restricted");
  assert.equal(noSponsor.rank, 1);
  assert.deepEqual(noSponsor.flags.map(f => [f.code, f.criterionId]), [["gate", "r1"]]);
  assert.match(noSponsor.flags[0].message, /Sponsor scored 1/);
  assert.deepEqual(restricted.flags.map(f => f.code), ["restricted"]);
  assert.ok(notes.some(n => /Flagged candidates stay/.test(n)));
});

test("sensitive candidates are left out unless asked for", () => {
  const a = withCandidate(small(), "Open", { v1: 3 });
  const b = withCandidate(a.screening, "Private", { v1: 3 }, { sensitive: true });
  assert.deepEqual(S.evaluate(b.screening).rows.map(r => r.name), ["Open"]);
  assert.deepEqual(S.evaluate(b.screening, { includeSensitive: true }).rows.map(r => r.name).sort(), ["Open", "Private"]);
});

test("the stability check reports when a 20 percent weight change moves the first choice", () => {
  // A wins on value (v1 weight 3), B on the rest. Close enough that weights decide.
  const a = withCandidate(small(), "A", { v1: 5, v2: 3, f1: 3, r1: 3 });
  const close = withCandidate(a.screening, "B", { v1: 3, v2: 4, f1: 4, r1: 4 });
  const st = S.evaluate(close.screening).stability;
  assert.equal(st.topId, a.id);
  assert.equal(st.stable, false);
  assert.ok(st.changes.some(c => c.criterionId === "v1" && c.change === "down" && c.topName === "B"));
  assert.match(st.note, /Agree those weights/);

  const clear = withCandidate(a.screening, "C", { v1: 1, v2: 1, f1: 1, r1: 2 });
  const ok = S.stability(clear.screening);
  assert.equal(ok.stable, true);
  assert.deepEqual(ok.changes, []);
  assert.ok(ok.margin > 0);

  assert.equal(S.stability(a.screening).stable, null);
});

test("removing a criterion removes its scores", () => {
  const { screening } = withCandidate(small(), "R", { v1: 3, v2: 4 });
  const next = S.removeCriterion(screening, "v2").screening;
  assert.deepEqual(next.criteria.map(c => c.id), ["v1", "f1", "r1"]);
  assert.deepEqual(Object.keys(next.candidates[0].scores), ["v1"]);
  const added = S.addCriterion(next, { label: "Data quality", group: "feasibility", weight: 2 });
  assert.equal(added.criterionId, "data-quality");
  assert.equal(added.screening.criteria.at(-1).group, "feasibility");
});

test("a project gives a candidate its name, assumptions and a snapshot of its figures", () => {
  const e = validate.validateEngagement(example("underwriting")).engagement;
  const f = S.fromEngagement(e, { fileName: "underwriting.engagement.json", now: "2026-10-21T00:00:00.000Z" });
  assert.equal(f.name, e.meta.processName);
  assert.deepEqual(f.facts.annualVolume, { value: 400, basis: "illustrative", note: "From the project's assumptions." });
  assert.equal(f.facts.hourlyRate.value, 150);
  assert.equal(f.facts.effortHoursPerCase, null, "no step has a touch effort");
  assert.equal(f.source.engagementId, "eng-underwriting");
  assert.equal(f.source.steps, 26);
  assert.equal(f.source.stepsWithEffort, 0);
  assert.equal(f.source.fileName, "underwriting.engagement.json");
  assert.equal(f.source.dataStatus, "demonstration");
  assert.equal(f.source.topOpportunity, null);
});

test("hands-on hours come from step touch effort only when every step has one", () => {
  const e = validate.validateEngagement(tinyEngagement()).engagement;
  const tasks = e.models[0].nodes.filter(n => n.semanticType === "userTask");
  tasks[0].measures = { touchEffort: { value: 30, unit: "minute" } };
  assert.equal(S.fromEngagement(e).facts.effortHoursPerCase, null);
  assert.equal(S.fromEngagement(e).source.stepsWithEffort, 1);
  tasks[1].measures = { touchEffort: { value: 1.5, unit: "hour" } };
  assert.deepEqual(S.fromEngagement(e).facts.effortHoursPerCase, { value: 2, basis: "supplied", note: "Sum of the touch effort on 2 steps." });
});

test("the top opportunity leaves out sensitive and unreviewed AI opportunities", () => {
  const e = validate.validateEngagement(tinyEngagement()).engagement;
  e.assumptions = [{ id: "as-v", key: "annualVolume", label: "Volume", value: 1000, unit: "casesPerYear", status: "supplied" },
    { id: "as-r", key: "hourlyRate", label: "Rate", value: 100, unit: "currencyPerHour", status: "supplied" }];
  e.models[0].nodes.find(n => n.id === "work").measures = { touchEffort: { value: 60, unit: "minute" } };
  const opp = (id, title, extra) => Object.assign({ id, kind: "opportunity", title, status: "open", linkedModelId: "m-current", linkedNodeIds: ["work"],
    opportunity: { effort: "S", valueCase: { effortReductionPct: 50, shareSource: "manual", shareOfCasesPct: 100, confidence: "high", basis: "supplied" } } }, extra);
  e.records = [opp("o-secret", "Secret", { sensitive: true }), opp("o-ai", "Drafted", { generated: { task: "opportunities", reviewed: false } }), opp("o-ok", "Reviewed")];
  const f = S.fromEngagement(e);
  assert.equal(f.source.opportunities, 1);
  assert.equal(f.source.topOpportunity.title, "Reviewed");
  assert.equal(S.fromEngagement(e, { includeSensitive: true, includeUnreviewedAi: true }).source.opportunities, 3);
});

test("adding the same project again refreshes its figures and keeps the scores", () => {
  const e = validate.validateEngagement(example("underwriting")).engagement;
  let r = S.addFromEngagement(small(), e);
  assert.equal(r.refreshed, false);
  let s = S.setScore(r.screening, r.candidateId, "v1", { value: 4, note: "Agreed" }).screening;
  s = S.updateCandidate(s, r.candidateId, { name: "Underwriting" }).screening;
  e.revision = 7;
  e.assumptions.find(a => a.key === "annualVolume").value = 520;
  r = S.addFromEngagement(s, e);
  assert.equal(r.refreshed, true);
  assert.equal(r.screening.candidates.length, 1);
  const c = r.screening.candidates[0];
  assert.equal(c.name, "Underwriting");
  assert.equal(c.scores.v1.note, "Agreed");
  assert.equal(c.facts.annualVolume.value, 520);
  assert.equal(c.source.engagementRevision, 7);
});

test("the chosen candidate becomes a valid starter project", () => {
  const facts = { annualVolume: { value: 1200, basis: "supplied", note: "Ops report" }, effortHoursPerCase: { value: 0.75, basis: "illustrative", note: "" }, hourlyRate: null };
  let s = S.parseScreening(Object.assign(small(), { meta: Object.assign(small().meta, { clientDisplayName: "Northwind", confidentiality: "client-confidential", hourlyRate: { value: 80, basis: "validated" } }) })).screening;
  const { screening, id } = withCandidate(s, "Claims intake", { v1: 5, v2: 5, f1: 5, r1: 5 }, { facts, description: "Intake of new claims." });
  const e = S.toStarterEngagement(screening, id);
  assert.equal(validate.validateEngagement(e).ok, true);
  assert.equal(e.meta.processName, "Claims intake");
  assert.equal(e.meta.clientDisplayName, "Northwind");
  assert.equal(e.meta.confidentiality, "client-confidential");
  assert.equal(e.meta.currency, "EUR");
  assert.equal(e.meta.summary, "Intake of new claims.");
  assert.deepEqual(e.assumptions.map(a => [a.key, a.value, a.status]), [["annualVolume", 1200, "supplied"], ["hourlyRate", 80, "validated"]]);
  assert.match(e.models[0].notes, /Screening score: 100 of 100\..*0\.75/);
  assert.equal(e.models[0].nodes.length, 2, "the process starts blank");
});

test("the published screening schema is the library's", () => {
  const file = path.join(root, "webui", "schema", "screening.schema.json");
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), JSON.parse(JSON.stringify(S.SCREENING_SCHEMA)));
  assert.deepEqual(S.SCREENING_SCHEMA.properties.criteria.items.properties.group.enum, S.GROUPS.map(g => g[0]));
});

test("the screening's details change through updateMeta", () => {
  const s = small();
  const next = S.updateMeta(s, { title: "Northwind screening", clientDisplayName: "Northwind", confidentiality: "client-confidential",
    dataStatus: "demonstration", currency: "GBP", hourlyRate: { value: 65, basis: "supplied", note: "Finance" }, note: "Shortlist from the kickoff" }).screening;
  assert.equal(s.meta.title, "Test screening");
  assert.deepEqual(next.meta, { title: "Northwind screening", clientDisplayName: "Northwind", confidentiality: "client-confidential",
    dataStatus: "demonstration", currency: "GBP", hourlyRate: { value: 65, basis: "supplied", note: "Finance" }, note: "Shortlist from the kickoff" });
  assert.equal(S.updateMeta(next, { hourlyRate: null }).screening.meta.hourlyRate, null);
  assert.throws(() => S.updateMeta(s, { title: "" }), /Give the screening a title/);
  assert.throws(() => S.updateMeta(s, { currency: "usd" }), /three-letter currency/);
  assert.throws(() => S.updateMeta(s, { confidentiality: "secret" }), /confidentiality level/);
  assert.throws(() => S.updateMeta(s, { hourlyRate: { value: -1, basis: "supplied" } }), /zero or a positive/);
});

test("equal best scores are a tie, not a first choice", () => {
  // Zeta: 3 x 100 / 8. Alpha: (2 x 75 + 2 x 75) / 8. Both 37.5, reached by different sums.
  const z = withCandidate(small(), "Zeta", { v1: 5, v2: 1, f1: 1, r1: 1 });
  const a = withCandidate(z.screening, "Alpha", { v1: 1, v2: 1, f1: 4, r1: 4 });
  const third = withCandidate(a.screening, "Third", { v1: 1, v2: 1, f1: 1, r1: 2 });
  const { rows, stability } = S.evaluate(third.screening);
  assert.deepEqual(rows.map(r => [r.name, r.score]), [["Alpha", 37.5], ["Zeta", 37.5], ["Third", 6.25]]);
  assert.equal(stability.topId, null);
  assert.equal(stability.stable, false);
  assert.equal(stability.margin, 0);
  assert.deepEqual(stability.tiedIds.sort(), [a.id, z.id].sort());
  assert.match(stability.note, /^Alpha and Zeta have the same score/);
  const broken = S.setScore(third.screening, a.id, "v2", { value: 2 }).screening;
  assert.deepEqual(S.stability(broken).tiedIds, []);
  assert.equal(S.stability(broken).topId, a.id);
});
