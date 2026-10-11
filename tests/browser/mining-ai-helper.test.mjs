// The event-log import with the local AI helper (mining slice): "Ask AI for
// the rest" sends the unmapped activity names to a fake Claude through the
// helper, and the ticked suggestions come back into the wizard unticked.
// An activity name that looks like a credential is never sent.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { launch, watch, root } from "../../tools/lib/browser.mjs";
import { createBridge } from "../../tools/ai/bridge.mjs";

let browser = null, server = null, bridge = null, scratch = null;
const KEY = "AKIAABCDEFGHIJKLMNOP";
const saved = {};
const KEYS = ["AIXRAY_CLAUDE_BIN", "AIXRAY_CODEX_BIN", "FAKE_AI_MODE", "FAKE_AI_STATE", "FAKE_AI_LOG"];

before(async () => {
  KEYS.forEach(k => { saved[k] = process.env[k]; delete process.env[k]; });
  process.env.AIXRAY_CLAUDE_BIN = path.join(root, "tests", "fixtures", "ai", "fake-claude.mjs");
  process.env.AIXRAY_CODEX_BIN = path.join(root, "tests", "fixtures", "ai", "fake-codex.mjs");
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "aixray-logmap-ui-"));
  process.env.FAKE_AI_LOG = path.join(scratch, "log.jsonl");
  browser = await launch();
  if (!browser) return;
  server = http.createServer((req, res) => bridge.handler(req, res));
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  bridge = createBridge({ port: server.address().port });
});
after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(r => { server.close(r); server.closeAllConnections(); });
  KEYS.forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
});

const atStep = (p, n) => p.waitForFunction(k => {
  const el = document.querySelector("dialog[open] .li-step-title");
  return el && el.textContent.startsWith("Step " + k + " of 5") && !document.getElementById("li-next").disabled;
}, n);

test("Ask AI for the rest maps the unmapped names through the helper, and each suggestion still needs a tick", async t => {
  if (!browser) { t.skip("Chrome or Edge is not installed"); return; }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  t.after(() => context.close());
  const problems = watch(page);
  await page.goto(bridge.launchUrl().replace("#ai=", "#example=underwriting-current-state&ai="));
  await page.waitForFunction(() => window.AIxRay && window.AIxRay.app && window.AIxRay.app.store);
  await page.waitForSelector(".node");
  await page.setInputFiles("#file-input", { name: "underwriting.csv", mimeType: "text/csv", buffer: Buffer.concat([fs.readFileSync(path.join(root, "tests", "fixtures", "logs", "underwriting.csv")),
    Buffer.from("SUB-1001,Login " + KEY + ",2026-02-02 10:00,2026-02-02 10:05,Ops A\n")]) });
  await page.waitForSelector("dialog[open] #li-preview");
  await page.click("#li-next");
  await atStep(page, 2);
  await page.click("#li-next");
  await atStep(page, 3);
  await page.click("#li-ask-ai");
  await page.waitForSelector("#ai-start");
  assert.match(await page.textContent("#ai-sent"), /1 activity name from the event log/);
  assert.match(await page.textContent("#ai-sent-secret"), /^1 activity name that looks like a credential, left out\. Match it yourself\.$/);
  assert.doesNotMatch(await page.textContent("#ai-sent"), new RegExp(KEY), "the preview of what is sent leaves it out");
  assert.match(await page.textContent("#ai-sent"), /No events, case IDs, times, counts or people/);
  assert.match(await page.textContent("#ai-gate-message"), /Demonstration or public material may be sent to any plan/);
  await page.click("#ai-start");
  await page.waitForSelector("#ai-apply", { timeout: 60000 });
  assert.match(await page.textContent("dialog[open] .ai-items"), /Email the broker/);
  await page.click("#ai-select-all");
  await page.click("#ai-apply");
  await page.waitForFunction(() => document.querySelectorAll("dialog[open]").length === 1 && document.querySelector("#li-map"));
  const row = await page.$$eval("#li-map tbody tr", trs => {
    const tr = trs.find(x => x.querySelector(".title-cell").textContent === "Email the broker");
    return { step: tr.querySelector("select").value, ok: tr.querySelector("input[type=checkbox]").checked, how: tr.cells[4].textContent };
  });
  assert.equal(row.ok, false);
  assert.match(row.step, /broker/);
  assert.match(row.how, /Suggested by AI, not ticked/);
  const secretRow = await page.$$eval("#li-map tbody tr", (trs, key) => {
    const tr = trs.find(x => x.querySelector(".title-cell").textContent.includes(key));
    return tr ? { step: tr.querySelector("select").value, how: tr.cells[4].textContent } : null;
  }, KEY);
  assert.ok(secretRow, "the activity stays in the wizard for manual mapping");
  assert.equal(secretRow.step, "");
  const sent = fs.readFileSync(process.env.FAKE_AI_LOG, "utf8");
  assert.match(sent, /Email the broker/);
  assert.doesNotMatch(sent, new RegExp(KEY), "the AI tool never received the key");
  assert.equal(await page.evaluate(() => (window.AIxRay.app.store.get().datasets || []).length), 0, "nothing is added until the log is added");
  assert.deepEqual(problems.errors, [], "no page or console errors");
  assert.deepEqual(problems.external, [], "only 127.0.0.1 is contacted");
});
