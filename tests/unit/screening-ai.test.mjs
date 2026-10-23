// The screen AI task: drafted screening scores. Result checks, what is sent,
// review and apply, the runner with the fake tools, and the command line.
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { root, lib, example } from "./helpers.mjs";
import { runTask } from "../../tools/ai/runner.mjs";
import { systemPrompt } from "../../tools/ai/prompt.mjs";
import { main as cli } from "../../tools/ai/cli.mjs";
import { createBridge } from "../../tools/ai/bridge.mjs";

const S = lib("screening");
const ai = lib("ai-results");
const { validateEngagement } = lib("validate");
const fakes = path.join(root, "tests", "fixtures", "ai");
const ENV_KEYS = ["AIXRAY_CLAUDE_BIN", "AIXRAY_CODEX_BIN", "FAKE_AI_MODE", "FAKE_AI_STATE", "FAKE_AI_LOG", "FAKE_CLAUDE_AUTH", "FAKE_CODEX_AUTH"];
const saved = {};
let scratch;

beforeEach(() => {
  ENV_KEYS.forEach(k => { saved[k] = process.env[k]; delete process.env[k]; });
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "aixray-screen-"));
  process.env.AIXRAY_CLAUDE_BIN = path.join(fakes, "fake-claude.mjs");
  process.env.AIXRAY_CODEX_BIN = path.join(fakes, "fake-codex.mjs");
  process.env.FAKE_AI_STATE = path.join(scratch, "state");
  process.env.FAKE_AI_LOG = path.join(scratch, "log.jsonl");
});
afterEach(() => {
  ENV_KEYS.forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  fs.rmSync(scratch, { recursive: true, force: true });
});
const runs = () => fs.existsSync(process.env.FAKE_AI_LOG) ? fs.readFileSync(process.env.FAKE_AI_LOG, "utf8").trim().split("\n").map(l => JSON.parse(l)) : [];

/* Two processes: Claims scored by a person on volume, Payroll not at all, and a sensitive one. */
function screening() {
  let s = S.blankScreening({ id: "scr-ai", title: "AI test", confidentiality: "internal", dataStatus: "supplied" });
  let r = S.addCandidate(s, { name: "Claims intake", owner: "Dana Smith", description: "New claims arrive by email and are keyed into the claims system." });
  s = S.setScore(r.screening, r.candidateId, "volume", { value: 5, note: "Ops report" }).screening;
  r = S.addCandidate(s, { name: "Payroll changes", description: "Managers send changes on a form." });
  s = r.screening;
  r = S.addCandidate(s, { name: "Board pack", description: "Private.", sensitive: true });
  return r.screening;
}

function envelope(s, scores, extra) {
  return Object.assign(ai.makeEnvelope({ task: "screen", screeningId: s.id, screeningRevision: s.revision,
    generated: { provider: "claude", plan: "commercial", at: "2026-10-21T00:00:00.000Z" }, payload: { scores } }), extra || {});
}
const score = (candidateId, criterionId, value, more) => Object.assign({ candidateId, criterionId, value, confidence: "medium", rationale: "Because." }, more);

test("the screen task has a strict payload schema", () => {
  const out = ai.outputSchema("screen");
  const item = out.properties.payload.properties.scores.items;
  assert.deepEqual([...item.required].sort(), ["candidateId", "confidence", "criterionId", "rationale", "value"]);
  assert.equal(item.additionalProperties, false);
  assert.deepEqual(item.properties.value.type, ["integer", "null"]);
  const doc = JSON.parse(fs.readFileSync(path.join(root, "webui", "schema", "ai-result.schema.json"), "utf8"));
  assert.deepEqual(doc.$defs.screen, JSON.parse(JSON.stringify(ai.TASK_SCHEMAS.screen)));
  assert.ok(doc.properties.screeningId);
  const sys = systemPrompt("screen", "claude");
  assert.match(sys, /draft screening scores/i);
  assert.doesNotMatch(sys, /\{\{/);
});

test("a screen result needs its screening, whole scores from 1 to 5, and no credentials", () => {
  const s = screening();
  const [claims] = s.candidates;
  let v = ai.validateAiResult(envelope(s, [score(claims.id, "pain", 4), score(claims.id, "pain", 2), score(claims.id, "rules", null)]));
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(v.result.screeningId, "scr-ai");
  assert.equal(v.result.payload.scores.length, 2);
  assert.ok(v.warnings.some(w => w.code === "payload.duplicate"));
  assert.match(ai.validateAiResult(envelope(s, [], { screeningId: null })).errors[0].message, /which screening/);
  assert.match(ai.validateAiResult(envelope(s, [score(claims.id, "pain", 7)])).errors[0].message, /whole number from 1 to 5/);
  assert.match(ai.validateAiResult(envelope(s, [score(claims.id, "pain", 2.5)])).errors[0].message, /Expected integer/);
  assert.match(ai.validateAiResult(envelope(s, [score("bad id!", "pain", 3)])).errors[0].message, /IDs exactly as given/);
  const secret = ai.validateAiResult(envelope(s, [score(claims.id, "pain", 3, { rationale: "sk-ant-api03-" + "abcdefghijklmnopqrstuvwxyz012345" })]));
  assert.equal(secret.errors[0].code, "output.secret");
  assert.match(secret.errors[0].message, /Remove it from the screening/);
  assert.match(ai.prepareReview(v.result, validateEngagement(example("underwriting")).engagement).errors[0].message, /Open them in the screening/);
});

test("the AI is sent criteria and descriptions, never owners or sensitive processes", () => {
  const s = screening();
  const input = S.aiTaskInput(s);
  assert.equal(input.screeningId, "scr-ai");
  assert.deepEqual(input.candidates.map(c => c.name), ["Claims intake", "Payroll changes"]);
  assert.equal(input.excluded.sensitiveCandidates, 1);
  assert.doesNotMatch(JSON.stringify(input), /Dana Smith|Board pack/);
  const claims = input.candidates[0];
  assert.deepEqual(claims.scores, { volume: { value: 5, note: "Ops report", origin: "person" } });
  assert.equal(claims.toScore.includes("volume"), false, "a person's score is not drafted again");
  assert.equal(claims.toScore.length, s.criteria.length - 1);
  assert.equal(input.criteria.find(k => k.id === "sponsor").anchors[1], "No sponsor");
  assert.equal(S.aiTaskInput(s, { includeSensitive: true }).candidates.length, 3);
});

test("the gate uses the strictest confidentiality among what is sent", () => {
  let s = screening();
  assert.deepEqual(S.dataHandlingOf(s), { confidentiality: "internal", dataStatus: "supplied" });
  const board = s.candidates[2].id;
  s = S.updateCandidate(s, board, { confidentiality: "restricted" }).screening;
  assert.equal(S.dataHandlingOf(s).confidentiality, "internal", "a sensitive process that is not sent does not count");
  assert.equal(S.dataHandlingOf(s, { includeSensitive: true }).confidentiality, "restricted");
  s = S.updateCandidate(s, s.candidates[1].id, { confidentiality: "client-confidential" }).screening;
  assert.equal(S.dataHandlingOf(s).confidentiality, "client-confidential");
});

test("drafted scores are checked against the screening and applied as unreviewed AI drafts", () => {
  const s = screening();
  const [claims, payroll] = s.candidates;
  const v = ai.validateAiResult(envelope(s, [
    score(claims.id, "pain", 4), score(claims.id, "volume", 2), score(payroll.id, "priority", null),
    score("c-gone", "pain", 3), score(payroll.id, "no-such", 3), score(payroll.id, "rules", 5, { confidence: "high", rationale: "A form drives it." })
  ]));
  const review = S.prepareAiScores(v.result, s);
  assert.deepEqual(review.errors, []);
  const problems = Object.fromEntries(review.items.map(it => [it.key, it.problems.join(" ")]));
  assert.equal(problems[claims.id + "|pain"], "");
  assert.match(problems[claims.id + "|volume"], /A person already scored this/);
  assert.match(problems[payroll.id + "|priority"], /could not score/);
  assert.match(problems["c-gone|pain"], /process is not in the screening/);
  assert.match(problems[payroll.id + "|no-such"], /criterion is not in the screening/);

  const applied = S.applyAiScores(s, review, review.items.map(it => it.key));
  assert.equal(applied.applied, 2);
  const after = applied.screening;
  assert.equal(after.candidates[0].scores.volume.value, 5, "the person's score stays");
  assert.deepEqual(after.candidates[1].scores.rules, { value: 5, basis: "illustrative", note: "AI draft, high confidence: A form drives it.", aiDraft: true });
  assert.equal(S.aiDraftCount(after), 2);
  assert.equal(S.parseScreening(JSON.stringify(after)).screening.candidates[1].scores.rules.aiDraft, true, "the marker survives a save");

  assert.match(S.prepareAiScores(Object.assign({}, v.result, { screeningId: "scr-other" }), s).errors[0].message, /another screening/);
  assert.match(S.prepareAiScores(v.result, after).warnings[0].message, /screening changed after/);
});

test("a person's change or review turns an AI draft into their score", () => {
  const s = screening();
  const [claims, payroll] = s.candidates;
  const v = ai.validateAiResult(envelope(s, [score(claims.id, "pain", 4), score(payroll.id, "pain", 2), score(payroll.id, "rules", 3)]));
  let after = S.applyAiScores(s, S.prepareAiScores(v.result, s), [claims.id + "|pain", payroll.id + "|pain", payroll.id + "|rules"]).screening;
  assert.equal(S.aiDraftCount(after), 3);
  after = S.setScore(after, claims.id, "pain", { value: 3 }).screening;
  assert.equal(after.candidates[0].scores.pain.aiDraft, false);
  const r = S.reviewAiScores(after, payroll.id);
  assert.equal(r.reviewed, 2);
  assert.equal(S.aiDraftCount(r.screening), 0);
});

test("unreviewed AI scores count in the ranking and stay out of the summary unless included", () => {
  let s = screening();
  const payroll = s.candidates[1];
  s.criteria.forEach(k => { s = S.setScore(s, payroll.id, k.id, { value: 4 }).screening; });
  const v = ai.validateAiResult(envelope(s, [score(s.candidates[0].id, "pain", 5)]));
  s = S.applyAiScores(s, S.prepareAiScores(v.result, s), [s.candidates[0].id + "|pain"]).screening;
  const ranked = S.evaluate(s);
  const claims = ranked.rows.find(r => r.name === "Claims intake");
  assert.equal(claims.aiDrafts, 1);
  assert.equal(claims.coverage, 5 / 17, "volume (weight 3) and the drafted pain score (weight 2) and nothing else");
  assert.ok(ranked.notes.some(n => /1 score was drafted with AI and no one has reviewed it yet/.test(n)));

  const sum = S.buildSummary(s);
  const left = sum.rows.find(r => r.name === "Claims intake");
  assert.equal(left.aiDrafts, 0);
  assert.equal(left.aiDraftsLeftOut, 1);
  assert.equal(left.coverage, 3 / 17);
  assert.equal(sum.counts.aiDraftsLeftOut, 1);
  assert.equal(sum.disclosure, "");
  assert.ok(sum.notes.some(n => /left out until someone reviews it/.test(n)));
  const all = S.buildSummary(s, { includeUnreviewedAi: true });
  assert.match(all.disclosure, /drafted with AI assistance that no one has reviewed/);
});

test("the runner drafts scores with the fake Claude and repairs an unknown process", async () => {
  process.env.FAKE_AI_MODE = "invalid,ok";
  const s = screening();
  const r = await runTask({ task: "screen", provider: "claude", screening: s, approvalConfirmed: true });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.rounds, 1, "the process that is not in the screening was repaired");
  assert.equal(r.result.task, "screen");
  assert.equal(r.result.screeningId, "scr-ai");
  assert.equal(r.result.engagementId, null);
  assert.equal(r.result.dataHandling.confidentiality, "internal");
  assert.ok(r.result.warnings.some(w => /1 process marked sensitive was not sent/.test(w.message)));
  const usable = r.review.items.filter(it => !it.problems.length);
  assert.equal(usable.length, (s.criteria.length - 1) + (s.criteria.length) - 2, "every criterion to score, except the two priority blanks");
  const [first] = runs();
  assert.doesNotMatch(JSON.stringify(first.input), /Dana Smith|Board pack/);
  await assert.rejects(runTask({ task: "screen", provider: "claude", approvalConfirmed: true }), /needs a screening/);
});

test("the screen task refuses client material on a consumer plan, and a screening with nothing to draft", async () => {
  let s = screening();
  s = S.updateMeta(s, { confidentiality: "client-confidential" }).screening;
  process.env.FAKE_CLAUDE_AUTH = "max";
  await assert.rejects(runTask({ task: "screen", provider: "claude", screening: s, approvalConfirmed: true, trainingOptOutConfirmed: true }), err => err.code === "gate.blocked");
  assert.equal(runs().length, 0);
  delete process.env.FAKE_CLAUDE_AUTH;
  let full = S.blankScreening({ id: "scr-full" });
  const r = S.addCandidate(full, { name: "Done" });
  full = r.screening;
  full.criteria.forEach(k => { full = S.setScore(full, r.candidateId, k.id, { value: 3 }).screening; });
  await assert.rejects(runTask({ task: "screen", provider: "claude", screening: full, approvalConfirmed: true }), /nothing to draft/);
});

test("the command line drafts, wraps, checks and applies screening scores", async () => {
  const file = path.join(scratch, "shortlist.screening.json");
  fs.writeFileSync(file, JSON.stringify(screening()));
  const out = path.join(scratch, "shortlist.screen.ai-result.json");
  assert.equal(await cli(["gate", "--in", file]), 3, "internal material needs the project lead's approval");
  assert.equal(await cli(["gate", "--in", file, "--yes"]), 0);
  assert.equal(await cli(["screen", "--in", file, "--yes", "--out", out, "--apply"]), 0);
  const result = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.equal(result.task, "screen");
  const applied = JSON.parse(fs.readFileSync(path.join(scratch, "shortlist.with-ai.screening.json"), "utf8"));
  assert.ok(S.aiDraftCount(applied) > 0);
  assert.equal(await cli(["check", out, "--in", file]), 0);

  const draft = path.join(scratch, "aixray-screen.draft.json");
  const s = screening();
  fs.writeFileSync(draft, JSON.stringify({ payload: { scores: [score(s.candidates[1].id, "rules", 4)] }, notes: "By hand.", warnings: [] }));
  const wrapped = path.join(scratch, "wrapped.screen.ai-result.json");
  assert.equal(await cli(["wrap", "screen", "--in", file, "--payload", draft, "--remove-payload", "--out", wrapped, "--yes"]), 0);
  assert.equal(fs.existsSync(draft), false);
  assert.equal(JSON.parse(fs.readFileSync(wrapped, "utf8")).generated.surface, "skill");
  const eng = path.join(scratch, "project.engagement.json");
  fs.writeFileSync(eng, JSON.stringify(example("underwriting")));
  assert.equal(await cli(["check", wrapped, "--in", eng]), 1, "screening scores are not checked against a project");
  assert.equal(await cli(["screen", "--in", eng, "--yes"]), 2, "the screen task needs a screening file");
});

test("the app's AI helper does not start a screening task", async () => {
  const calls = [];
  const server = http.createServer((req, res) => bridge.handler(req, res));
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const bridge = createBridge({ port, runTask: async o => { calls.push(o); return { ok: true }; },
    status: async () => [{ provider: "claude", installed: true, loggedIn: true, planDetected: true, plan: "commercial" }] });
  const request = (method, p, body, token) => new Promise((resolve, reject) => {
    const text = JSON.stringify(body);
    const headers = { Host: "127.0.0.1:" + port, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) };
    if (token) headers["X-AIxRay-Token"] = token;
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "null")));
    });
    req.on("error", reject);
    req.write(text);
    req.end();
  });
  try {
    const { token } = await request("POST", "/api/ai/session", { code: bridge.launchUrl().split("#ai=")[1] });
    const r = await request("POST", "/api/ai/jobs", { task: "screen", provider: "claude", screening: screening(), approvalConfirmed: true }, token);
    assert.equal(r.ok, false);
    assert.match(r.message, /command line/);
    assert.equal(calls.length, 0);
  } finally {
    await new Promise(r => { server.close(r); server.closeAllConnections(); });
  }
});
