// The goals AI task: its schema, review, apply and undo, the extract draft rules for goals, and the CLI with a fake assistant.
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { root, lib, tinyEngagement } from "./helpers.mjs";
import { main as cli } from "../../tools/ai/cli.mjs";
import { systemPrompt } from "../../tools/ai/prompt.mjs";

const ai = lib("ai-results");
const { createStore } = lib("store");
const { validateEngagement } = lib("validate");
const goalsLib = lib("goals");

const GENERATED = { tool: "test", provider: "claude", model: "test-model", surface: "cli", at: "2026-10-23T00:00:00.000Z", jobId: "job-1", plan: "commercial" };

function project() {
  const e = tinyEngagement();
  e.meta.confidentiality = "internal";
  e.meta.dataStatus = "supplied";
  e.goals = [{ id: "goal-cost", kind: "cost", title: "Cut the cost of a claim", basis: "supplied" }];
  e.records = [{ id: "opp-a", kind: "opportunity", title: "Pre-fill intake", linkedModelId: "m-current", linkedNodeIds: ["work"], opportunity: { effort: "S" } }];
  return validateEngagement(e).engagement;
}

function goal(over) {
  return Object.assign({
    ref: "g1", kind: "revenue", title: "Win more renewals", metric: "Renewal rate", baseline: 70, target: 80, unit: "%", by: "2027-12-31",
    owner: "Sales lead", source: "Kickoff notes [p1]", quote: "We lose renewals because quotes are slow.", servedByRecordIds: ["opp-a", "ghost"],
    confidence: "medium", rationale: "The sales lead said so."
  }, over || {});
}

function envelope(e, payload) {
  return ai.makeEnvelope({ task: "goals", engagementId: e.id, engagementRevision: e.revision, generated: GENERATED,
    dataHandling: { confidentiality: "internal", dataStatus: "supplied", approvalConfirmed: true }, payload });
}

test("the goals schema follows the strict rules and is published", () => {
  const sch = ai.TASK_SCHEMAS.goals;
  const item = sch.properties.suggestions.items;
  assert.deepEqual(item.required.slice().sort(), Object.keys(item.properties).sort());
  assert.equal(item.additionalProperties, false);
  assert.deepEqual(item.properties.kind.enum, lib("schema").ENUMS.goalKind);
  const published = JSON.parse(fs.readFileSync(path.join(root, "webui", "schema", "ai-result.schema.json"), "utf8"));
  assert.deepEqual(published.$defs.goals, JSON.parse(JSON.stringify(sch)));
  assert.doesNotMatch(systemPrompt("goals", "claude"), /\{\{/);
  assert.match(systemPrompt("goals", "claude"), /`revenue`, `cost`, `capability`/);
});

test("drafted goals are reviewed, applied as AI drafts linked to their opportunities, kept out of reports and undone", () => {
  const e = project();
  const v = ai.validateAiResult(envelope(e, { suggestions: [goal(), goal({ ref: "g2", title: "Cut the cost of a claim", baseline: null, by: "soon", servedByRecordIds: [] })] }));
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(v.result.payload.suggestions[1].baseline, null);
  assert.equal(v.result.payload.suggestions[1].by, "");
  const review = ai.prepareReview(v.result, e);
  assert.deepEqual(review.errors, []);
  assert.equal(review.items.length, 2);
  assert.ok(review.items[0].notes.some(n => /ghost not found/.test(n)));
  assert.deepEqual(review.items[0].servedTitles, ["Pre-fill intake"]);
  assert.ok(review.items[1].notes.some(n => /already exists/.test(n)));
  const cmd = ai.applyCommand(v.result, review, ["g0"]);
  assert.equal(cmd.type, "goal/applySuggestions");
  const s = createStore(e);
  const out = s.dispatch(cmd.type, cmd.payload);
  const added = s.get().goals.find(g => g.id === out.ids[0]);
  assert.equal(added.basis, "supplied", "a goal from the sources is what the client said, never measured");
  assert.equal(added.generated.task, "goals");
  assert.equal(added.generated.reviewed, false);
  assert.equal(added.target, 80);
  assert.deepEqual(s.get().records[0].opportunity.goalIds, [added.id]);
  assert.equal(goalsLib.visibleGoals(s.get()).some(g => g.id === added.id), false);
  s.undo();
  assert.equal(s.get().goals.length, 1);
});

test("a goals result with no title or with a credential is refused", () => {
  const e = project();
  assert.equal(ai.validateAiResult(envelope(e, { suggestions: [goal({ title: " " })] })).ok, false);
  const secret = ai.validateAiResult(envelope(e, { suggestions: [goal({ quote: "sk-ant-api03-" + "abcdefghijklmnopqrstuvwxyz012345" })] }));
  assert.equal(secret.ok, false);
  assert.ok(secret.errors.some(x => x.code === "output.secret"));
});

test("an extraction's goals are AI drafts and never measured or confirmed", () => {
  const raw = tinyEngagement();
  raw.goals = [{ id: "goal-x", kind: "cost", title: "Lower cost per claim", basis: "validated", target: 30, unit: "$" }];
  raw.records = [{ id: "opp-x", kind: "opportunity", title: "A", opportunity: { goalIds: ["goal-x"] } }];
  const file = ai.makeEnvelope({ task: "extract", generated: GENERATED, dataHandling: { confidentiality: "internal", dataStatus: "supplied" }, payload: { engagement: raw } });
  const v = ai.validateAiResult(file);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const g = v.result.payload.engagement.goals[0];
  assert.equal(g.basis, "supplied");
  assert.equal(g.generated.task, "extract");
  assert.equal(g.generated.reviewed, false);
  assert.deepEqual(v.result.payload.engagement.records[0].opportunity.goalIds, ["goal-x"]);
  assert.ok(v.warnings.some(w => w.code === "draft.rule" && /value goal/.test(w.message)));
  assert.equal(ai.prepareReview(v.result, null).engagementSummary.goals, 1);
});

test("the task input carries the goals the AI may build on, without sensitive ones", () => {
  const e = project();
  e.goals.push({ id: "goal-secret", kind: "other", title: "Private", basis: "supplied", sensitive: true });
  const input = ai.buildTaskInput(e, "opportunities", {});
  assert.deepEqual(input.goals.map(g => g.id), ["goal-cost"]);
  assert.deepEqual(input.unsizedOpportunityIds, ["opp-a"]);
  assert.deepEqual(ai.buildTaskInput(e, "goals", { includeSensitive: true }).goals.map(g => g.id), ["goal-cost", "goal-secret"]);
});

let scratch;
const saved = {};
const ENV_KEYS = ["AIXRAY_CLAUDE_BIN", "AIXRAY_CODEX_BIN", "FAKE_AI_MODE", "FAKE_AI_STATE", "FAKE_AI_LOG", "ANTHROPIC_API_KEY", "CLAUDECODE"];
beforeEach(() => {
  ENV_KEYS.forEach(k => { saved[k] = process.env[k]; delete process.env[k]; });
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "aixray-goals-"));
  process.env.AIXRAY_CLAUDE_BIN = path.join(root, "tests", "fixtures", "ai", "fake-claude.mjs");
  process.env.AIXRAY_CODEX_BIN = path.join(root, "tests", "fixtures", "ai", "fake-codex.mjs");
  process.env.FAKE_AI_STATE = path.join(scratch, "state");
  process.env.FAKE_AI_LOG = path.join(scratch, "log.jsonl");
});
afterEach(() => {
  ENV_KEYS.forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  fs.rmSync(scratch, { recursive: true, force: true });
});

test("the CLI drafts goals from documents against a project and applies them to a copy", async () => {
  const inFile = path.join(scratch, "tiny.engagement.json");
  fs.writeFileSync(inFile, JSON.stringify(project()));
  const notes = path.join(scratch, "notes.txt");
  fs.writeFileSync(notes, "Kickoff. The head of claims said handling costs too much.\n");
  const out = path.join(scratch, "tiny.goals.ai-result.json");
  const stderr = process.stderr.write;
  const printed = [];
  process.stderr.write = chunk => { printed.push(String(chunk)); return true; };
  try {
    assert.equal(await cli(["goals", "--in", inFile, notes, "--out", out, "--yes", "--apply"]), 0, printed.join(""));
    assert.equal(await cli(["goals", "--in", inFile, "--yes"]), 2, "documents are required");
  } finally {
    process.stderr.write = stderr;
  }
  const result = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.equal(result.task, "goals");
  assert.equal(result.sources[0].name, "notes.txt");
  const applied = JSON.parse(fs.readFileSync(path.join(scratch, "tiny.with-ai.engagement.json"), "utf8"));
  assert.equal(applied.goals.length, 2);
  assert.equal(applied.goals[1].generated.reviewed, false);
  assert.match(printed.join(""), /1 goal/);
});
