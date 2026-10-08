// The local AI helper (P2-02): only the page it served can use it, uploads
// are capped, the data-handling rules hold on the server side, and jobs run,
// report progress and cancel. The runner is replaced so nothing is spawned.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { root, tinyEngagement, lib } from "./helpers.mjs";
import { createBridge, helperHtml } from "../../tools/ai/bridge.mjs";
import { serve } from "../../tools/lib/browser.mjs";
import { AiFailure } from "../../tools/ai/providers.mjs";

const { validateEngagement } = lib("validate");
let server, bridge, port, calls = [];
const saved = {};

/* A stand-in runner: finishes, or waits for cancel when the task is "summary". */
async function fakeRun(o) {
  calls.push(o);
  o.onEvent({ type: "stage", message: "Running Claude Code" });
  if (o.task === "summary") {
    await new Promise((resolve, reject) => o.signal.addEventListener("abort", () => reject(new AiFailure("provider.cancelled", "The run was cancelled."))));
  }
  return { ok: true, rounds: 0, errors: [], result: { schema: "bpmviz.ai-result", task: o.task, sources: o.sources.map(s => s.name) } };
}

before(async () => {
  ["BPMVIZ_CLAUDE_BIN", "BPMVIZ_CODEX_BIN", "FAKE_CLAUDE_AUTH"].forEach(k => { saved[k] = process.env[k]; });
  process.env.BPMVIZ_CLAUDE_BIN = path.join(root, "tests", "fixtures", "ai", "fake-claude.mjs");
  process.env.BPMVIZ_CODEX_BIN = path.join(root, "tests", "fixtures", "ai", "fake-codex.mjs");
  server = http.createServer((req, res) => bridge.handler(req, res));
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
  bridge = createBridge({ port, runTask: fakeRun });
});
after(async () => {
  Object.keys(saved).forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  await new Promise(r => { server.close(r); server.closeAllConnections(); });
});

function request(method, urlPath, options) {
  const o = options || {};
  return new Promise((resolve, reject) => {
    const headers = Object.assign({ Host: "127.0.0.1:" + port }, o.headers || {});
    let body = o.body;
    if (o.json !== undefined) { body = JSON.stringify(o.json); headers["Content-Type"] = headers["Content-Type"] || "application/json"; }
    if (body !== undefined) headers["Content-Length"] = Buffer.byteLength(body);
    const req = http.request({ host: "127.0.0.1", port, method, path: urlPath, headers }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data = null;
        try { data = JSON.parse(text); } catch (_) { data = null; }
        resolve({ status: res.statusCode, headers: res.headers, text, data });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function session() {
  const code = new URL(bridge.launchUrl()).hash.replace("#ai=", "");
  const r = await request("POST", "/api/ai/session", { json: { code } });
  assert.equal(r.data.ok, true);
  return r.data.token;
}

const internal = () => { const e = validateEngagement(tinyEngagement()).engagement; e.meta.confidentiality = "internal"; e.meta.dataStatus = "supplied"; return e; };

test("every route checks the Host header, and the page is served with the helper's policy", async () => {
  const bad = await request("GET", "/index.htm", { headers: { Host: "evil.example:" + port } });
  assert.equal(bad.status, 403, "DNS rebinding: a foreign host name is refused");
  assert.equal((await request("GET", "/api/ai/status", { headers: { Host: "evil.example" } })).status, 403);
  const page = await request("GET", "/index.htm");
  assert.equal(page.status, 200);
  assert.match(page.text, /connect-src 'self'/);
  assert.match(page.text, /<meta name="bpmviz-ai-helper" content="1">/);
  assert.equal(page.headers["x-frame-options"], "DENY");
  assert.match(page.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.doesNotMatch(helperHtml("<head><meta content=\"connect-src 'none'\">"), /'none'/);
  const plain = await serve(0);
  try {
    const text = await (await fetch(plain.url)).text();
    assert.match(text, /connect-src 'none'/, "without --ai the page keeps its no-network policy");
    assert.doesNotMatch(text, /bpmviz-ai-helper/);
  } finally {
    await plain.close();
  }
});

test("the one-time code is traded once for a token, and API calls need the token", async () => {
  assert.equal((await request("GET", "/api/ai/status")).status, 401);
  const url = bridge.launchUrl();
  const code = new URL(url).hash.replace("#ai=", "");
  assert.equal((await request("POST", "/api/ai/session", { body: JSON.stringify({ code }), headers: { "Content-Type": "text/plain" } })).status, 415);
  const first = await request("POST", "/api/ai/session", { json: { code } });
  assert.equal(first.data.ok, true);
  const again = await request("POST", "/api/ai/session", { json: { code } });
  assert.equal(again.status, 200);
  assert.equal(again.data.ok, false, "a code works once");
  assert.notEqual(bridge.launchUrl(), url, "a fresh link is printed for the next tab");
  const status = await request("GET", "/api/ai/status", { headers: { "X-BPMVIZ-Token": first.data.token } });
  assert.equal(status.status, 200);
  assert.equal(status.data.providers.find(p => p.provider === "claude").planLabel, "Claude Team");
  assert.equal((await request("GET", "/api/ai/status", { headers: { "X-BPMVIZ-Token": "not-a-token" } })).status, 401);
});

test("cross-site requests are refused and no CORS headers are ever sent", async () => {
  const token = await session();
  const cross = await request("GET", "/api/ai/status", { headers: { "X-BPMVIZ-Token": token, Origin: "https://evil.example" } });
  assert.equal(cross.status, 403);
  const site = await request("GET", "/api/ai/status", { headers: { "X-BPMVIZ-Token": token, "Sec-Fetch-Site": "cross-site" } });
  assert.equal(site.status, 403);
  const same = await request("GET", "/api/ai/status", { headers: { "X-BPMVIZ-Token": token, Origin: "http://127.0.0.1:" + port, "Sec-Fetch-Site": "same-origin" } });
  assert.equal(same.status, 200);
  const pre = await request("OPTIONS", "/api/ai/jobs", { headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-bpmviz-token" } });
  assert.ok(pre.status >= 400, "a preflight is never approved");
  for (const r of [cross, site, same, pre]) {
    assert.deepEqual(Object.keys(r.headers).filter(h => h.startsWith("access-control-")), []);
  }
});

test("malformed and traversal URLs are answered and the helper keeps running", async () => {
  assert.equal((await request("GET", "/%E0%A4%A")).status, 404);
  assert.equal((await request("GET", "/..%2f..%2fpackage.json")).status, 404);
  assert.equal((await request("GET", "/..%5cpackage.json")).status, 404);
  const token = await session();
  assert.equal((await request("GET", "/api/ai/jobs/%zz", { headers: { "X-BPMVIZ-Token": token } })).status, 404);
  assert.equal((await request("GET", "/index.htm")).status, 200, "still serving");
});

test("the server applies the data-handling rules even if the page does not", async () => {
  const token = await session();
  const e = validateEngagement(tinyEngagement()).engagement;
  e.meta.confidentiality = "client-confidential";
  e.meta.dataStatus = "supplied";
  const noApproval = await request("POST", "/api/ai/jobs", { headers: { "X-BPMVIZ-Token": token }, json: { task: "summary", provider: "claude", engagement: e } });
  assert.equal(noApproval.status, 200);
  assert.equal(noApproval.data.ok, false);
  assert.equal(noApproval.data.code, "gate.missing");
  const consumer = await request("POST", "/api/ai/jobs", { headers: { "X-BPMVIZ-Token": token }, json: { task: "summary", provider: "codex", plan: "consumer", engagement: e, approvalConfirmed: true, trainingOptOutConfirmed: true } });
  assert.equal(consumer.data.code, "gate.blocked");
  const wrongType = await request("POST", "/api/ai/jobs", { headers: { "X-BPMVIZ-Token": token, "Content-Type": "text/plain" }, body: "{}" });
  assert.equal(wrongType.status, 415);
});

test("a job takes its sources, runs once, reports progress and returns the result", async () => {
  const token = await session();
  const auth = { "X-BPMVIZ-Token": token };
  calls = [];
  const created = await request("POST", "/api/ai/jobs", { headers: auth, json: { task: "extract", provider: "claude", confidentiality: "public", dataStatus: "demonstration", sourceNames: ["notes.txt", "flow.png"] } });
  assert.equal(created.data.ok, true, JSON.stringify(created.data));
  const id = created.data.id;
  const early = await request("POST", "/api/ai/jobs/" + id + "/start", { headers: auth, json: {} });
  assert.equal(early.data.ok, false, "cannot start before every source is uploaded");
  const huge = Buffer.alloc(26 * 1024 * 1024);
  const tooBig = await request("PUT", "/api/ai/jobs/" + id + "/sources/0", { headers: Object.assign({ "Content-Type": "application/octet-stream" }, auth), body: huge });
  assert.equal(tooBig.status, 413);
  assert.equal(bridge.jobs.get(id).sources[0], null, "nothing is kept from a refused upload");
  assert.equal((await request("PUT", "/api/ai/jobs/" + id + "/sources/0", { headers: Object.assign({ "Content-Type": "text/plain" }, auth), body: "x" })).status, 415);
  assert.equal((await request("PUT", "/api/ai/jobs/" + id + "/sources/5", { headers: Object.assign({ "Content-Type": "application/octet-stream" }, auth), body: "x" })).status, 404);
  for (const [i, text] of [[0, "Step one"], [1, "png bytes"]]) {
    const up = await request("PUT", "/api/ai/jobs/" + id + "/sources/" + i, { headers: Object.assign({ "Content-Type": "application/octet-stream" }, auth), body: text });
    assert.equal(up.data.ok, true);
  }
  assert.equal((await request("POST", "/api/ai/jobs/" + id + "/start", { headers: auth, json: {} })).data.ok, true);
  let view;
  for (let i = 0; i < 50; i++) {
    view = (await request("GET", "/api/ai/jobs/" + id + "?since=0", { headers: auth })).data;
    if (view.state !== "running") break;
    await new Promise(r => setTimeout(r, 20));
  }
  assert.equal(view.state, "done");
  assert.deepEqual(view.result.sources, ["notes.txt", "flow.png"]);
  assert.equal(view.events[0].message, "Running Claude Code");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].surface, "app");
  assert.equal(calls[0].jobId, id, "the result carries the helper job ID");
  assert.equal(calls[0].sources[0].buffer.toString(), "Step one");
  assert.equal((await request("DELETE", "/api/ai/jobs/" + id, { headers: auth })).data.ok, true);
  assert.equal((await request("GET", "/api/ai/jobs/" + id, { headers: auth })).status, 404);
});

test("one task runs at a time, and cancel stops it", async () => {
  const token = await session();
  const auth = { "X-BPMVIZ-Token": token };
  const a = await request("POST", "/api/ai/jobs", { headers: auth, json: { task: "summary", provider: "claude", engagement: internal(), approvalConfirmed: true } });
  assert.equal(a.data.ok, true, JSON.stringify(a.data));
  assert.equal((await request("POST", "/api/ai/jobs/" + a.data.id + "/start", { headers: auth, json: {} })).data.ok, true);
  const b = await request("POST", "/api/ai/jobs", { headers: auth, json: { task: "summary", provider: "claude", engagement: internal(), approvalConfirmed: true } });
  assert.equal(b.data.code, "busy");
  assert.equal((await request("POST", "/api/ai/jobs/" + a.data.id + "/cancel", { headers: auth, json: {} })).data.ok, true);
  let state;
  for (let i = 0; i < 50; i++) {
    state = (await request("GET", "/api/ai/jobs/" + a.data.id, { headers: auth })).data.state;
    if (state !== "running") break;
    await new Promise(r => setTimeout(r, 20));
  }
  assert.equal(state, "cancelled");
});
