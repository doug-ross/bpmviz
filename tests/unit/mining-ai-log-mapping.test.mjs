// Event-log import (mining slice): the log-mapping AI task. Result checks,
// the review, what is sent, and the runner, helper and command line driven
// by the fake claude and codex programs, so no AI service is contacted.
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { root, tinyEngagement, example, lib } from "./helpers.mjs";
import { runTask, cleanTaskOptions } from "../../tools/ai/runner.mjs";
import { createBridge } from "../../tools/ai/bridge.mjs";
import { systemPrompt } from "../../tools/ai/prompt.mjs";
import { main as cli, readActivities } from "../../tools/ai/cli.mjs";

const ai = lib("ai-results");
const { validateEngagement } = lib("validate");
const fakes = path.join(root, "tests", "fixtures", "ai");
const ENV_KEYS = ["BPMVIZ_CLAUDE_BIN", "BPMVIZ_CODEX_BIN", "FAKE_AI_MODE", "FAKE_AI_STATE", "FAKE_AI_LOG", "FAKE_CLAUDE_AUTH", "FAKE_CODEX_AUTH"];
const saved = {};
let scratch;

beforeEach(() => {
  ENV_KEYS.forEach(k => { saved[k] = process.env[k]; delete process.env[k]; });
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bpmviz-logmap-"));
  process.env.BPMVIZ_CLAUDE_BIN = path.join(fakes, "fake-claude.mjs");
  process.env.BPMVIZ_CODEX_BIN = path.join(fakes, "fake-codex.mjs");
  process.env.FAKE_AI_STATE = path.join(scratch, "state");
  process.env.FAKE_AI_LOG = path.join(scratch, "log.jsonl");
});
afterEach(() => {
  ENV_KEYS.forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  fs.rmSync(scratch, { recursive: true, force: true });
});

const runs = () => fs.existsSync(process.env.FAKE_AI_LOG) ? fs.readFileSync(process.env.FAKE_AI_LOG, "utf8").trim().split("\n").map(l => JSON.parse(l)) : [];
const internal = () => { const e = validateEngagement(tinyEngagement()).engagement; e.meta.confidentiality = "internal"; e.meta.dataStatus = "supplied"; return e; };
const ACTIVITIES = [{ name: "Fix the form", events: 4 }, { name: "Work done", events: 40 }, { name: "Email sent", events: 9 }];

function envelope(mappings, extra) {
  return ai.makeEnvelope(Object.assign({
    task: "log-mapping", engagementId: "eng-tiny", engagementRevision: 0, baselineModelId: "m-current",
    generated: { provider: "claude", model: "m", surface: "cli", at: "2026-01-01T00:00:00Z", jobId: "j", plan: "commercial" },
    dataHandling: { confidentiality: "internal", dataStatus: "supplied", approvalConfirmed: true },
    payload: { mappings }
  }, extra || {}));
}

test("a log-mapping result is checked: model named, names kept once, step IDs valid, at most 500 mappings", () => {
  const ok = ai.validateAiResult(envelope([
    { activity: " Work done ", nodeId: "work", confidence: "high", rationale: "Same work." },
    { activity: "Work done", nodeId: "fix", confidence: "low", rationale: "Twice." },
    { activity: "Email sent", nodeId: "not a valid id!", confidence: "low", rationale: "" },
    { activity: "Coffee", nodeId: null, confidence: "medium", rationale: "No step." }
  ]));
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.deepEqual(ok.result.payload.mappings.map(m => [m.activity, m.nodeId]), [["Work done", "work"], ["Email sent", null], ["Coffee", null]]);
  assert.ok(ok.warnings.some(w => w.code === "payload.duplicate"));
  assert.ok(ok.warnings.some(w => w.code === "payload.reference"));
  const noModel = ai.validateAiResult(envelope([], { baselineModelId: null }));
  assert.equal(noModel.ok, false);
  assert.match(noModel.errors[0].message, /needs the ID of the model/);
  const many = ai.validateAiResult(envelope(Array.from({ length: 501 }, (_, i) => ({ activity: "A" + i, nodeId: null, confidence: "low", rationale: "" }))));
  assert.equal(many.result.payload.mappings.length, 500);
  assert.ok(many.warnings.some(w => w.code === "payload.truncated"));
  const bad = ai.validateAiResult(envelope([{ activity: "x", nodeId: "work", confidence: "sure", rationale: "" }]));
  assert.equal(bad.ok, false, "the confidence must be low, medium or high");
});

test("the review flags unknown steps, gateways and names that were not sent; applying gives proposals, not a change", () => {
  const e = internal();
  const result = ai.validateAiResult(envelope([
    { activity: "Work done", nodeId: "work", confidence: "high", rationale: "Same work." },
    { activity: "Fix the form", nodeId: "check", confidence: "medium", rationale: "Gateway." },
    { activity: "Email sent", nodeId: "gone", confidence: "low", rationale: "" },
    { activity: "Invented", nodeId: "fix", confidence: "low", rationale: "" },
    { activity: "Coffee", nodeId: null, confidence: "low", rationale: "" }
  ])).result;
  const review = ai.prepareReview(result, e, { activities: ACTIVITIES.concat([{ name: "Coffee", events: 1 }]) });
  assert.deepEqual(review.errors, []);
  assert.equal(review.baseline.id, "m-current");
  const problems = review.items.map(it => it.problems.join(" "));
  assert.equal(problems[0], "");
  assert.match(problems[1], /gateway is a decision point/);
  assert.match(problems[2], /Step gone is not in Current state/);
  assert.match(problems[3], /was not sent to the assistant/);
  assert.match(review.items[4].notes[0], /stays unmapped/);
  assert.equal(review.items[0].title, "Work done to Do the work");
  const cmd = ai.applyCommand(result, review, review.items.map(it => it.key));
  assert.equal(cmd.type, "log-mapping/proposals");
  assert.deepEqual(cmd.payload.mappings.map(m => [m.activity, m.nodeId, m.method]), [["Work done", "work", "ai"], ["Coffee", null, "ai"]]);
  assert.equal(cmd.payload.modelId, "m-current");
  assert.equal(cmd.payload.stamp.task, "log-mapping");
  const other = ai.prepareReview(Object.assign({}, result, { engagementId: "eng-other" }), e);
  assert.match(other.errors[0].message, /different engagement/);
});

test("the AI is sent step names and activity names only, most frequent first, with gateways left out", () => {
  const e = internal();
  const input = ai.buildTaskInput(e, "log-mapping", { modelId: "m-current", activities: ACTIVITIES.concat([{ name: "Work done", events: 1 }]) });
  assert.deepEqual(input.activities, ["Work done", "Email sent", "Fix the form"]);
  assert.deepEqual(input.steps.map(s => s.id), ["start", "work", "fix", "end"]);
  assert.deepEqual(input.steps[1], { id: "work", label: "Do the work", lane: "Team A" });
  assert.equal(input.baselineModelId, "m-current");
  assert.doesNotMatch(JSON.stringify(input), /"events"|40/);
  const big = ai.buildTaskInput(e, "log-mapping", { modelId: "m-current", activities: Array.from({ length: 520 }, (_, i) => ({ name: "A" + i, events: i })) });
  assert.equal(big.activities.length, 500);
  assert.equal(big.activities[0], "A519");
  assert.equal(big.excluded.activities, 20);
  assert.deepEqual(cleanTaskOptions("log-mapping", { modelId: "m", activities: [" A  b ", "A b", { name: "C", events: -2 }, null, 5] }),
    { modelId: "m", activities: [{ name: "A b", events: 0 }, { name: "C", events: 0 }, { name: "5", events: 0 }] });
  assert.deepEqual(cleanTaskOptions("summary", { activities: ["x"] }), {});
  const sys = systemPrompt("log-mapping", "claude");
  assert.match(sys, /map event log activities to process steps/i);
  assert.doesNotMatch(sys, /\{\{/);
});

test("the runner maps activities with the fake Claude, sends only names and repairs a bad step ID", async () => {
  process.env.FAKE_AI_MODE = "invalid,ok";
  const r = await runTask({ task: "log-mapping", provider: "claude", engagement: internal(), approvalConfirmed: true,
    taskOptions: { modelId: "m-current", activities: ACTIVITIES } });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.rounds, 1, "the step that does not exist was repaired");
  assert.equal(r.result.task, "log-mapping");
  assert.equal(r.result.baselineModelId, "m-current");
  const byName = Object.fromEntries(r.review.items.map(it => [it.activity, it.nodeId]));
  assert.deepEqual(byName, { "Work done": "work", "Email sent": null, "Fix the form": "fix" });
  const [first, second] = runs();
  assert.deepEqual(first.input.activities, ["Work done", "Email sent", "Fix the form"]);
  assert.equal(second.repair, true);
  assert.doesNotMatch(JSON.stringify(first.input), /events/);
  await assert.rejects(runTask({ task: "log-mapping", provider: "claude", engagement: internal(), approvalConfirmed: true, taskOptions: { activities: [] } }), /activity names to map/);
  await assert.rejects(runTask({ task: "log-mapping", provider: "claude", engagement: internal(), approvalConfirmed: true, taskOptions: { modelId: "m-gone", activities: ACTIVITIES } }), /not in the engagement/);
});

test("Codex maps activities too, and client material on a consumer plan is refused before anything runs", async () => {
  const r = await runTask({ task: "log-mapping", provider: "codex", plan: "commercial", engagement: internal(), approvalConfirmed: true,
    taskOptions: { activities: ACTIVITIES } });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.review.items.length, 3);
  assert.equal(runs()[0].schema.properties.payload.properties.mappings.type, "array");
  const e = internal();
  e.meta.confidentiality = "client-confidential";
  process.env.FAKE_CLAUDE_AUTH = "max";
  fs.rmSync(process.env.FAKE_AI_LOG);
  await assert.rejects(runTask({ task: "log-mapping", provider: "claude", engagement: e, approvalConfirmed: true, trainingOptOutConfirmed: true, taskOptions: { activities: ACTIVITIES } }),
    err => err.code === "gate.blocked");
  assert.equal(runs().length, 0);
});

test("the helper accepts a log-mapping job and passes the activity names to the runner", async () => {
  const calls = [];
  const fakeRun = async o => { calls.push(o); return { ok: true, rounds: 0, errors: [], result: { schema: "bpmviz.ai-result", task: o.task } }; };
  const server = http.createServer((req, res) => bridge.handler(req, res));
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const bridge = createBridge({ port, runTask: fakeRun, status: async () => [{ provider: "claude", installed: true, loggedIn: true, planDetected: true, plan: "commercial" }] });
  const request = (method, p, body, token) => new Promise((resolve, reject) => {
    const text = body === undefined ? undefined : JSON.stringify(body);
    const headers = { Host: "127.0.0.1:" + port };
    if (text !== undefined) { headers["Content-Type"] = "application/json"; headers["Content-Length"] = Buffer.byteLength(text); }
    if (token) headers["X-BPMVIZ-Token"] = token;
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "null")));
    });
    req.on("error", reject);
    if (text !== undefined) req.write(text);
    req.end();
  });
  try {
    const code = bridge.launchUrl().split("#ai=")[1];
    const { token } = await request("POST", "/api/ai/session", { code });
    const base = { task: "log-mapping", provider: "claude", engagement: internal(), approvalConfirmed: true };
    const empty = await request("POST", "/api/ai/jobs", Object.assign({ taskOptions: { activities: [] } }, base), token);
    assert.equal(empty.ok, false);
    assert.match(empty.message, /no activity names/);
    const job = await request("POST", "/api/ai/jobs", Object.assign({ taskOptions: { modelId: "m-current", activities: ACTIVITIES } }, base), token);
    assert.equal(job.ok, true, JSON.stringify(job));
    assert.equal((await request("POST", "/api/ai/jobs/" + job.id + "/start", {}, token)).ok, true);
    for (let i = 0; i < 50 && !calls.length; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(calls[0].task, "log-mapping");
    assert.deepEqual(calls[0].taskOptions, { modelId: "m-current", activities: ACTIVITIES });
    assert.equal(calls[0].surface, "app");
  } finally {
    await new Promise(r => { server.close(r); server.closeAllConnections(); });
  }
});

test("activity names that look like credentials are never sent, and the other names still map", async () => {
  const KEY = "AKIAABCDEFGHIJKLMNOP";
  const acts = ACTIVITIES.concat([{ name: "Login " + KEY, events: 100 }]);
  const input = ai.buildTaskInput(internal(), "log-mapping", { modelId: "m-current", activities: acts });
  assert.deepEqual(input.activities, ["Work done", "Email sent", "Fix the form"]);
  assert.deepEqual(input.excluded, { activities: 0, secretActivities: 1 });
  assert.doesNotMatch(JSON.stringify(input), new RegExp(KEY));

  const r = await runTask({ task: "log-mapping", provider: "claude", engagement: internal(), approvalConfirmed: true,
    taskOptions: { modelId: "m-current", activities: acts } });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(Object.fromEntries(r.review.items.map(it => [it.activity, it.nodeId])), { "Work done": "work", "Email sent": null, "Fix the form": "fix" });
  const warning = r.result.warnings.find(w => w.code === "input.secret");
  assert.match(warning.message, /^1 activity name that looks like a credential was not sent/);
  assert.doesNotMatch(JSON.stringify(r.result), new RegExp(KEY), "the result does not carry the name either");
  const log = fs.readFileSync(process.env.FAKE_AI_LOG, "utf8");
  assert.equal(runs().length, 1);
  assert.doesNotMatch(log, new RegExp(KEY), "the AI tool never received the key");

  const echoed = ai.validateAiResult(envelope([{ activity: "Work done", nodeId: "work", confidence: "high", rationale: "Login " + KEY }]));
  assert.equal(echoed.ok, false);
  assert.equal(echoed.errors[0].code, "output.secret");
  assert.match(echoed.errors[0].message, /Check the activity names and the model steps/);
  assert.doesNotMatch(echoed.errors[0].message, /sources/);
});

test("the command line reads a Windows-1252 log with the same names as the browser import", async () => {
  const file = path.join(root, "tests", "fixtures", "logs", "windows-1252.csv");
  const bytes = fs.readFileSync(file);
  assert.ok(bytes.includes(0xfc), "the fixture holds a Windows-1252 u-umlaut byte");
  assert.throws(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes), "the fixture is not UTF-8");
  const names = (await readActivities(file)).map(a => a.name);
  assert.ok(names.includes("Pr\u00fcfung"), JSON.stringify(names));
  assert.ok(names.includes("Bescheid erstellen"));
  assert.ok(names.every(n => !n.includes("\ufffd")), "no replacement characters");
  const csvLib = lib("csv");
  assert.equal(csvLib.decodeText(bytes), new TextDecoder("windows-1252").decode(bytes));
  assert.equal(csvLib.decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x50, 0xc3, 0xbc])), "P\u00fc", "UTF-8 with a byte order mark");
  const txt = path.join(scratch, "names.txt");
  fs.writeFileSync(txt, Buffer.from([0x50, 0x72, 0xfc, 0x66, 0x75, 0x6e, 0x67, 0x0d, 0x0a]));
  assert.deepEqual(await readActivities(txt), [{ name: "Pr\u00fcfung", events: 1 }]);
});

test("the command line reads activity names from text, CSV and the log itself, and writes a result to check", async () => {
  const e = validateEngagement(example("underwriting-current-state")).engagement;
  const inFile = path.join(scratch, "uw.engagement.json");
  fs.writeFileSync(inFile, JSON.stringify(e));
  const txt = path.join(scratch, "names.txt");
  fs.writeFileSync(txt, "\ufeffScrub SOV & Geocode\r\nEmail the broker\r\n\r\nScrub SOV & Geocode\r\n");
  assert.deepEqual(await readActivities(txt), [{ name: "Scrub SOV & Geocode", events: 2 }, { name: "Email the broker", events: 1 }]);
  const log = path.join(root, "tests", "fixtures", "logs", "underwriting.csv");
  const fromLog = await readActivities(log);
  assert.ok(fromLog.length >= 20);
  assert.ok(fromLog.some(a => a.name === "Check clearance and dedupe" && a.events === 14));
  assert.ok((await readActivities(log, "user")).some(a => a.name === "UW 1"), "the column can be named");
  await assert.rejects(readActivities(log, "nope"), /No column named "nope"/);
  await assert.rejects(readActivities(path.join(scratch, "missing.csv")), /not found/);

  const out = path.join(scratch, "uw.log-mapping.ai-result.json");
  const stderr = process.stderr.write;
  const printed = [];
  process.stderr.write = chunk => { printed.push(String(chunk)); return true; };
  try {
    assert.equal(await cli(["log-mapping", "--in", inFile, "--activities", log, "--out", out]), 0, printed.join(""));
    assert.equal(await cli(["check", out, "--in", inFile, "--activities", log]), 0, printed.join(""));
    assert.match(printed.join(""), /Load an AI mapping result/);
    assert.equal(await cli(["log-mapping", "--in", inFile]), 2, "the activities are required");
  } finally {
    process.stderr.write = stderr;
  }
  // The input command prints to stdout, which the test runner uses itself, so it runs in its own process.
  const sent = JSON.parse(execFileSync(process.execPath, [path.join(root, "tools", "ai", "cli.mjs"), "input", "log-mapping", "--in", inFile, "--activities", txt], { encoding: "utf8" }));
  assert.deepEqual(sent.activities, ["Scrub SOV & Geocode", "Email the broker"]);
  const result = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.equal(result.task, "log-mapping");
  assert.equal(result.baselineModelId, "m-current");
  assert.ok(result.payload.mappings.some(m => m.activity === "Scrub SOV & Geocode" && m.nodeId === "scrub-sov-geocode"));

  const payload = path.join(scratch, "bpmviz-log-mapping.draft.json");
  fs.writeFileSync(payload, JSON.stringify({ payload: { mappings: [{ activity: "Email the broker", nodeId: null, confidence: "low", rationale: "No step sends email." }] }, notes: "", warnings: [] }));
  const wrapped = path.join(scratch, "wrapped.json");
  process.stderr.write = () => true;
  try {
    assert.equal(await cli(["wrap", "log-mapping", "--in", inFile, "--payload", payload, "--activities", txt, "--out", wrapped, "--remove-payload"]), 0);
  } finally {
    process.stderr.write = stderr;
  }
  const w = JSON.parse(fs.readFileSync(wrapped, "utf8"));
  assert.deepEqual([w.generated.surface, w.baselineModelId, w.payload.mappings.length], ["skill", "m-current", 1]);
  assert.equal(fs.existsSync(payload), false);
});
