// Browser tests for files and drafts saved before the app was renamed from
// BPMVIZ to AIxRay: they open through Open and the start page as before.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launch, fileUrl, watch, root } from "../../tools/lib/browser.mjs";

let browser = null;
before(async () => { browser = await launch(); });
after(async () => { if (browser) await browser.close(); });

const example = name => JSON.parse(fs.readFileSync(path.join(root, "webui", "examples", name + ".engagement.json"), "utf8"));

async function open(t, hash, init) {
  if (!browser) { t.skip("Chrome or Edge is not installed"); return null; }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
  if (init) await context.addInitScript(init.fn, init.arg);
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(fileUrl() + (hash || ""));
  await page.waitForFunction(() => window.AIxRay && window.AIxRay.app && document.getElementById("app"));
  t.after(async () => { await context.close(); });
  return { page, problems };
}

function clean(problems) {
  assert.deepEqual(problems.errors, [], "no page or console errors");
  assert.deepEqual(problems.external, [], "no requests outside the app's own files");
}

test("a project file saved by BPMVIZ opens without a prompt and saves as an AIxRay file", async t => {
  const s = await open(t, "");
  if (!s) return;
  const p = s.page;
  const old = Object.assign(example("rpa-delivery"), { schema: "bpmviz.engagement" });
  await p.setInputFiles("#file-input", { name: "old.engagement.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(old)) });
  await p.waitForSelector(".node");
  assert.equal(await p.locator("dialog[open]").count(), 0, "a renamed format is not worth interrupting for");
  assert.equal(await p.evaluate(() => window.AIxRay.app.store.get().schema), "aixray.engagement");
  const [download] = await Promise.all([p.waitForEvent("download"), p.click("#btn-save")]);
  assert.equal(JSON.parse(fs.readFileSync(await download.path(), "utf8")).schema, "aixray.engagement");
  clean(s.problems);
});

test("review answers saved from a BPMVIZ form import through Open", async t => {
  const s = await open(t, "#example=underwriting-current-state");
  if (!s) return;
  const p = s.page;
  await p.waitForSelector(".node");
  const fx = JSON.parse(fs.readFileSync(path.join(root, "tests", "fixtures", "reviews", "underwriting-current.review-response.json"), "utf8"));
  fx.schema = "bpmviz.review-response";
  await p.setInputFiles("#file-input", { name: "answers.review-response.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fx)) });
  await p.waitForSelector("dialog[open] #cr-apply-validation");
  assert.match(await p.textContent("dialog[open]"), /Apply review answers/);
  clean(s.problems);
});

test("a draft kept by BPMVIZ in this browser is listed on the start page and continues", async t => {
  const old = Object.assign(example("rpa-delivery"), { schema: "bpmviz.engagement", id: "eng-old-draft" });
  old.meta.processName = "Draft from before the rename";
  const s = await open(t, "", {
    fn: draft => {
      if (localStorage.getItem("bpmviz:index") || localStorage.getItem("aixray:index")) return;
      localStorage.setItem("bpmviz:draft:" + draft.id, JSON.stringify({ savedAt: "2026-09-01T10:00:00.000Z", revision: draft.revision, engagement: draft }));
      localStorage.setItem("bpmviz:index", JSON.stringify([{ id: draft.id, savedAt: "2026-09-01T10:00:00.000Z", revision: draft.revision, processName: draft.meta.processName }]));
    },
    arg: old
  });
  if (!s) return;
  const p = s.page;
  const row = p.locator(".draft-row", { hasText: "Draft from before the rename" });
  await row.waitFor();
  await row.getByRole("button", { name: "Continue" }).click();
  await p.waitForSelector(".node");
  assert.equal(await p.evaluate(() => window.AIxRay.app.store.get().id), "eng-old-draft");
  assert.equal(await p.evaluate(() => Object.keys(localStorage).some(k => k.startsWith("bpmviz:"))), false, "the old keys were moved");
  clean(s.problems);
});
