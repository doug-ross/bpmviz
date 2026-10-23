// Business cases drafted with AI: sources per figure, a person's business case protected, and drafts left out of reports until reviewed.
import test from "node:test";
import assert from "node:assert/strict";
import { lib, tinyEngagement } from "./helpers.mjs";

const ai = lib("ai-results");
const { createStore } = lib("store");
const { validateEngagement } = lib("validate");
const valueCase = lib("value-case");
const bc = lib("business-case");
const pptx = lib("pptx");

const GENERATED = { tool: "test", provider: "claude", model: "test-model", surface: "cli", at: "2026-10-23T00:00:00.000Z", jobId: "job-1", plan: "commercial" };
const BLANK_SOURCES = { shareOfCasesPct: "", effortReductionPct: "", durationReductionPct: "", oneTimeCost: "", annualRunningCost: "" };

function project() {
  const e = tinyEngagement();
  e.meta.confidentiality = "internal";
  e.models[0].nodes[1].measures = { touchEffort: { value: 30, unit: "minute" } };
  e.models[0].nodes[3].measures = { touchEffort: { value: 1, unit: "hour" } };
  e.assumptions = [
    { id: "as-rate", key: "hourlyRate", value: 100, status: "supplied" },
    { id: "as-vol", key: "annualVolume", value: 1000, status: "supplied" }
  ];
  e.records = [
    { id: "opp-a", kind: "opportunity", title: "Pre-fill intake", linkedModelId: "m-current", linkedNodeIds: ["work", "fix"], opportunity: { effort: "S" } },
    { id: "opp-b", kind: "opportunity", title: "Checklist for fixes", linkedModelId: "m-current", linkedNodeIds: ["fix"],
      opportunity: { effort: "M", valueCase: { effortReductionPct: 20, shareOfCasesPct: 10, basis: "supplied" } } },
    { id: "pain-c", kind: "pain", title: "Slow checks" }
  ];
  const r = validateEngagement(e);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r.engagement;
}

function vc(over) {
  return Object.assign({ shareOfCasesPct: 40, effortReductionPct: 50, durationReductionPct: null, oneTimeCost: 5000, annualRunningCost: null, confidence: "medium",
    sources: Object.assign({}, BLANK_SOURCES, { shareOfCasesPct: "Finding Slow checks: about 4 in 10 claims", effortReductionPct: "Step Do the work: half is retyping", oneTimeCost: "" }) }, over || {});
}

function suggestion(over) {
  return Object.assign({
    ref: "s1", kind: "opportunity", title: "Route simple claims straight through", description: "", linkedModelId: "m-current", linkedNodeIds: ["work"],
    basedOnRecordIds: [], priority: "", opportunity: { intervention: "simplify", simplerAlternative: "", expectedBenefit: "", affectedVolume: "", effort: "M", risk: "", dependencies: "", validationAction: "" },
    valueCase: vc(), goalIds: ["ghost"], confidence: "medium", rationale: "Most claims are simple."
  }, over || {});
}

function result(e, payload) {
  const v = ai.validateAiResult(ai.makeEnvelope({ task: "opportunities", engagementId: e.id, engagementRevision: e.revision, generated: GENERATED,
    dataHandling: { confidentiality: "internal", dataStatus: "supplied", approvalConfirmed: true }, payload }));
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  return v;
}

test("a drafted figure without a source, or out of range, is left blank", () => {
  const e = project();
  const v = result(e, { suggestions: [suggestion({ valueCase: vc({ durationReductionPct: 140, sources: Object.assign({}, vc().sources, { durationReductionPct: "Guess" }) }) })], valueCases: [] });
  const drafted = v.result.payload.suggestions[0].valueCase;
  assert.equal(drafted.oneTimeCost, null, "no source");
  assert.equal(drafted.durationReductionPct, null, "out of range");
  assert.equal(drafted.effortReductionPct, 50);
  assert.ok(v.warnings.some(w => w.code === "payload.source"));
  assert.ok(v.warnings.some(w => w.code === "payload.range"));
  const none = result(e, { suggestions: [suggestion({ valueCase: vc({ sources: BLANK_SOURCES }) })], valueCases: [] });
  assert.equal(none.result.payload.suggestions[0].valueCase, null);
});

test("result files from before business cases were drafted still open", () => {
  const e = project();
  const old = suggestion();
  delete old.valueCase;
  delete old.goalIds;
  const v = result(e, { suggestions: [old] });
  assert.equal(v.result.payload.suggestions[0].valueCase, null);
  assert.deepEqual(v.result.payload.valueCases, []);
});

test("suggestions and business cases for existing opportunities apply in one step, as AI drafts, and never replace a person's business case", () => {
  const e = project();
  const v = result(e, {
    suggestions: [suggestion()],
    valueCases: [
      { recordId: "opp-a", nodeIds: ["work", "ghost"], valueCase: vc(), rationale: "Retyping is half the work." },
      { recordId: "opp-b", nodeIds: [], valueCase: vc(), rationale: "Overwrite attempt." },
      { recordId: "pain-c", nodeIds: [], valueCase: vc(), rationale: "Not an opportunity." },
      { recordId: "ghost", nodeIds: [], valueCase: vc({ sources: BLANK_SOURCES }), rationale: "" }
    ]
  });
  const review = ai.prepareReview(v.result, e);
  const byKey = Object.fromEntries(review.items.map(it => [it.key, it]));
  assert.deepEqual(byKey.s0.figures.map(f => f.key), ["shareOfCasesPct", "effortReductionPct"]);
  assert.ok(byKey.s0.notes.some(n => /Goal ghost not found/.test(n)));
  assert.deepEqual(byKey.v0.problems, []);
  assert.ok(byKey.v0.notes.some(n => /Step ghost not found/.test(n)));
  assert.match(byKey.v1.problems.join(" "), /A person already entered a business case/);
  assert.match(byKey.v2.problems.join(" "), /not in this project/);
  assert.match(byKey.v3.problems.join(" "), /could not size/);
  const cmd = ai.applyCommand(v.result, review, ["s0", "v0", "v1"]);
  assert.equal(cmd.payload.records.length, 1);
  assert.equal(cmd.payload.valueCases.length, 1, "items with problems are never applied");
  const s = createStore(e);
  const before = s.get().revision;
  const out = s.dispatch(cmd.type, cmd.payload);
  assert.equal(s.get().revision, before + 1);
  assert.deepEqual(out.sized, ["opp-a"]);
  const sized = s.get().records.find(r => r.id === "opp-a").opportunity.valueCase;
  assert.equal(sized.aiDraft, true);
  assert.equal(sized.basis, "illustrative");
  assert.deepEqual(sized.nodeIds, ["work"]);
  assert.equal(sized.sources.effortReductionPct, "Step Do the work: half is retyping");
  const added = s.get().records.find(r => r.id === out.ids[0]);
  assert.equal(added.opportunity.valueCase.aiDraft, true);
  assert.equal(added.opportunity.goalIds, undefined, "an unknown goal is not linked");
  assert.equal(s.get().records.find(r => r.id === "opp-b").opportunity.valueCase.aiDraft, undefined);
  assert.throws(() => s.dispatch("ai/applySuggestions", { valueCases: [{ recordId: "opp-b", valueCase: vc() }] }), /a person entered/);
  const reopened = validateEngagement(JSON.parse(JSON.stringify(s.get())));
  assert.equal(reopened.ok, true);
  assert.equal(reopened.engagement.records.find(r => r.id === "opp-a").opportunity.valueCase.aiDraft, true);
  s.undo();
  assert.equal(s.get().records.find(r => r.id === "opp-a").opportunity.valueCase, undefined);
});

test("an AI business case stays out of the ranking, the portfolio, the one-pager and the deck until it is reviewed", () => {
  const e = project();
  const s = createStore(e);
  s.dispatch("ai/applySuggestions", { valueCases: [{ recordId: "opp-a", valueCase: Object.assign({ nodeIds: [] }, vc(), { aiDraft: true }) }] });
  const draft = s.get();
  const row = valueCase.rank(draft).find(r => r.recordId === "opp-a");
  assert.equal(row.value, null, "left out by default");
  assert.equal(valueCase.rank(draft, { includeUnreviewedAi: true }).find(r => r.recordId === "opp-a").value, 30000);
  const page = bc.buildOnePager(draft, "opp-a");
  assert.equal(page.hasValueCase, false);
  assert.match(page.notes[0], /drafted with AI and no one has reviewed it/);
  const shown = bc.buildOnePager(draft, "opp-a", { includeUnreviewedAi: true });
  assert.equal(shown.aiDraft, true);
  assert.ok(shown.notes.some(n => /drafted with AI/.test(n)));
  const deck = pptx.deckFromEngagement(draft, {});
  assert.match(deck.slides.find(x => x.title === "Opportunities").rows.find(r => r[1] === "Pre-fill intake")[2], /No estimate yet/);
  // Clearing the tick in the editor saves the same figures as the person's own.
  const mine = Object.assign({}, draft.records.find(r => r.id === "opp-a").opportunity.valueCase, { aiDraft: false, basis: "supplied" });
  s.dispatch("record/update", { id: "opp-a", patch: { opportunity: { valueCase: mine } } });
  const reviewed = s.get().records.find(r => r.id === "opp-a").opportunity.valueCase;
  assert.equal(reviewed.aiDraft, undefined);
  assert.equal(reviewed.effortReductionPct, 50);
  assert.equal(reviewed.sources.shareOfCasesPct, "Finding Slow checks: about 4 in 10 claims", "sources stay with the figures");
  assert.equal(valueCase.rank(s.get()).find(r => r.recordId === "opp-a").value, 30000);
});
