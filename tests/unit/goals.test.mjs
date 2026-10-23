// Value goals: the data, the store commands and the reports that carry them (lib/goals.js).
import test from "node:test";
import assert from "node:assert/strict";
import { lib, tinyEngagement } from "./helpers.mjs";

const goals = lib("goals");
const { validateEngagement } = lib("validate");
const { createStore } = lib("store");
const bc = lib("business-case");
const pptx = lib("pptx");
const workshop = lib("workshop");

const GOALS = [
  { id: "goal-cost", kind: "cost", title: "Cut the cost of a claim", metric: "Cost per claim", baseline: 42, target: 30, unit: "$", by: "2027-06-30",
    owner: "Head of claims", basis: "supplied", source: "Workshop notes [p2]", quote: "Get it to thirty dollars.", note: "" },
  { id: "goal-new", kind: "capability", title: "Quote in one visit", metric: "", baseline: null, target: null, unit: "", basis: "illustrative" }
];

function engagement(extra) {
  const e = tinyEngagement();
  e.goals = JSON.parse(JSON.stringify(GOALS));
  e.records = [{ id: "opp-a", kind: "opportunity", title: "Pre-fill intake", linkedModelId: "m-current", linkedNodeIds: ["work"],
    opportunity: { intervention: "simplify", effort: "S", goalIds: ["goal-cost"] } }];
  Object.assign(e, extra || {});
  const r = validateEngagement(e);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r.engagement;
}

test("goals survive a save and reopen, and unknown fields and goal links are dropped with a note", () => {
  const e = tinyEngagement();
  e.goals = [Object.assign({}, GOALS[0], { color: "red" }), { id: "no-title" }, GOALS[1], Object.assign({}, GOALS[1])];
  e.records = [{ id: "opp-a", kind: "opportunity", title: "A", opportunity: { goalIds: ["goal-cost", "ghost", "goal-cost"] } }];
  const r = validateEngagement(e);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.engagement.goals.map(g => g.id), ["goal-cost", "goal-new"]);
  assert.equal(r.engagement.goals[0].target, 30);
  assert.equal(r.engagement.goals[0].color, undefined);
  assert.deepEqual(r.engagement.records[0].opportunity.goalIds, ["goal-cost"]);
  assert.ok(r.warnings.some(w => w.code === "ref.dangling" && /ghost/.test(w.message)));
  assert.ok(r.warnings.some(w => w.code === "goals.dropped"));
  assert.ok(r.warnings.some(w => w.code === "fields.ignored" && /goals\[0\]\.color/.test(w.message)));
  const again = validateEngagement(JSON.parse(JSON.stringify(r.engagement)));
  assert.deepEqual(again.engagement.goals, r.engagement.goals);
  assert.deepEqual(again.engagement.records[0].opportunity.goalIds, ["goal-cost"]);
});

test("a file without goals keeps its shape", () => {
  const r = validateEngagement(tinyEngagement());
  assert.equal(r.engagement.goals, undefined);
  assert.equal(r.engagement.checkpoints, undefined);
});

test("goal commands add, edit, link, review and delete goals, one undo step each", () => {
  const s = createStore(engagement());
  const before = s.get().revision;
  const { id } = s.dispatch("goal/save", { goal: { kind: "revenue", title: "Win more renewals", target: 5, unit: "%" }, servedByRecordIds: ["opp-a"] });
  assert.equal(s.get().revision, before + 1);
  assert.match(id, /^goal-win-more-renewals/);
  assert.deepEqual(s.get().records[0].opportunity.goalIds, ["goal-cost", id]);
  s.dispatch("goal/save", { goal: Object.assign({}, s.get().goals.find(g => g.id === id), { title: "Win more renewals a year" }), servedByRecordIds: [] });
  assert.equal(s.get().goals.find(g => g.id === id).title, "Win more renewals a year");
  assert.deepEqual(s.get().records[0].opportunity.goalIds, ["goal-cost"]);
  assert.throws(() => s.dispatch("goal/save", { goal: { title: " " } }), /needs a title/);
  assert.throws(() => s.dispatch("goal/save", { goal: { title: "X", by: "2027-02-31" } }), /valid date/);
  assert.throws(() => s.dispatch("goal/save", { goal: { id: "ghost", title: "X" } }), /no longer exists/);
  s.dispatch("goal/delete", { id: "goal-cost" });
  assert.deepEqual(s.get().records[0].opportunity.goalIds, []);
  s.undo();
  assert.deepEqual(s.get().records[0].opportunity.goalIds, ["goal-cost"]);
  const saved = validateEngagement(JSON.parse(JSON.stringify(s.get())));
  assert.equal(saved.ok, true, JSON.stringify(saved.errors));
});

test("editing an opportunity keeps its goals, and a goal that is deleted drops out of the opportunity", () => {
  const s = createStore(engagement());
  s.dispatch("record/update", { id: "opp-a", patch: { title: "Pre-fill the intake form" } });
  assert.deepEqual(s.get().records[0].opportunity.goalIds, ["goal-cost"]);
  s.dispatch("record/update", { id: "opp-a", patch: { opportunity: { goalIds: ["goal-new", "ghost"] } } });
  assert.deepEqual(s.get().records[0].opportunity.goalIds, ["goal-new"]);
});

test("AI goals are drafts until reviewed and stay out of reports until then", () => {
  const s = createStore(engagement());
  const stamp = { task: "goals", provider: "claude", model: "m", surface: "cli", at: "2026-10-23T00:00:00.000Z", jobId: "j", plan: "commercial" };
  const out = s.dispatch("goal/applySuggestions", { goals: [{ goal: { kind: "risk", title: "Fewer audit findings", basis: "supplied" }, servedByRecordIds: ["opp-a"] }], stamp });
  const e = s.get();
  const g = e.goals.find(x => x.id === out.ids[0]);
  assert.equal(g.generated.reviewed, false);
  assert.equal(goals.visibleGoals(e).some(x => x.id === g.id), false);
  assert.equal(goals.visibleGoals(e, { includeUnreviewedAi: true }).some(x => x.id === g.id), true);
  assert.deepEqual(e.records[0].opportunity.goalIds, ["goal-cost", g.id]);
  s.dispatch("goal/markReviewed", { ids: [g.id] });
  assert.equal(s.get().goals.find(x => x.id === g.id).generated.reviewed, true);
  assert.equal(goals.visibleGoals(s.get()).some(x => x.id === g.id), true);
});

test("sensitive goals stay out of reports unless asked for", () => {
  const e = engagement();
  e.goals[1].sensitive = true;
  assert.deepEqual(goals.visibleGoals(e).map(g => g.id), ["goal-cost"]);
  assert.deepEqual(goals.visibleGoals(e, { includeSensitive: true }).map(g => g.id), ["goal-cost", "goal-new"]);
});

test("targets read the way a client would say them", () => {
  assert.equal(goals.targetText(GOALS[0]), "From $42 to $30");
  assert.equal(goals.targetText({ baseline: null, target: 5, unit: "%" }), "Target 5 %");
  assert.equal(goals.targetText({ baseline: 12, target: null, unit: "days" }), "Today 12 days");
  assert.equal(goals.targetText({ baseline: null, target: null, unit: "" }), "");
});

test("the CFO one-pager, the portfolio pager, the deck and the pilot brief carry the goals", () => {
  const e = engagement();
  const page = bc.buildOnePager(e, "opp-a");
  assert.deepEqual(page.goals.map(g => g.title), ["Cut the cost of a claim"]);
  assert.equal(page.goals[0].target, "From $42 to $30");
  const folio = bc.buildPortfolioPager(e);
  assert.deepEqual(folio.goals.map(g => [g.id, g.recordIds]), [["goal-cost", ["opp-a"]], ["goal-new", []]]);
  assert.deepEqual(folio.rows[0].goalIds, ["goal-cost"]);
  const deck = pptx.deckFromEngagement(e, {});
  const slide = deck.slides.find(x => x.title === "Value goals");
  assert.ok(slide);
  assert.deepEqual(slide.rows[0], ["Cut the cost of a claim", "Reduce cost", "Cost per claim", "From $42 to $30", "2027-06-30", "Provided"]);
  const opps = deck.slides.find(x => x.title === "Opportunities");
  assert.equal(opps.headers.at(-1), "Goals served");
  assert.equal(opps.rows[0].at(-1), "Cut the cost of a claim");
  e.workshop = workshop.sanitizeWorkshop({ currentModelId: "m-current" }, e);
  const brief = workshop.buildPilotBrief(e);
  assert.deepEqual(brief.goals.map(g => g.title), ["Cut the cost of a claim"]);
  assert.match(workshop.pilotBriefText(e), /Value goals\n- Cut the cost of a claim \| Reduce cost \| Cost per claim \| From \$42 to \$30 \| By 2027-06-30 \| Basis: Provided/);
});

test("a deck without goals keeps its slides and columns", () => {
  const e = engagement({ goals: undefined });
  const deck = pptx.deckFromEngagement(e, {});
  assert.equal(deck.slides.some(x => x.title === "Value goals"), false);
  assert.deepEqual(deck.slides.find(x => x.title === "Opportunities").headers, ["Rank", "Opportunity", "Value", "Wave"]);
});
