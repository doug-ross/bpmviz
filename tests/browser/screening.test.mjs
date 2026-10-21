import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launch, serve, fileUrl, watch, root } from "../../tools/lib/browser.mjs";

let browser, server;
before(async () => {
  browser = await launch();
  assert.ok(browser, "Chrome or Edge must launch; retry outside the sandbox if child process creation is blocked.");
  server = await serve();
}, { timeout: 60000 });
after(async () => { if (browser) await browser.close(); if (server) await server.close(); }, { timeout: 30000 });

async function open(t, mode) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  t.after(() => context.close(), { timeout: 15000 });
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
  const page = await context.newPage(), problems = watch(page);
  page.setDefaultTimeout(12000);
  await page.goto(mode === "file" ? fileUrl() : server.url);
  await page.waitForFunction(() => !!window.AIxRay.screeningUi && !!window.AIxRay.app);
  return { page, problems };
}
const current = page => page.evaluate(() => window.AIxRay.screeningUi.current());
const example = name => path.join(root, "webui", "examples", name + ".engagement.json");
function clean(problems) {
  assert.deepEqual(problems.errors, [], "no console errors, page errors or CSP violations");
  assert.deepEqual(problems.external, [], "no requests outside local files");
}
async function addTyped(page, name, scores) {
  await page.click("#scr-add");
  await page.waitForSelector("#scr-candidate-dialog");
  await page.fill("#scr-c-name", name);
  for (const [criterion, value] of Object.entries(scores || {})) await page.selectOption("#scr-c-score-" + criterion, String(value));
  await page.click("#scr-candidate-dialog .dlg-foot .btn-primary");
  await page.waitForSelector("#scr-candidate-dialog", { state: "detached" });
}
async function addFile(page, file) {
  const chooser = page.waitForEvent("filechooser");
  await page.click("#scr-add-file");
  await (await chooser).setFiles(file);
}
async function scoreAll(page, candidateId, value) {
  const s = await current(page);
  for (const k of s.criteria) await page.selectOption("#scr-score-" + candidateId + "-" + k.id, String(value));
}

for (const mode of ["file", "http"]) {
  test("score typed processes, rank them, undo, save and reopen the screening (" + mode + ")", { timeout: 90000 }, async t => {
    const { page, problems } = await open(t, mode);
    await page.click("#start-screening");
    await page.waitForSelector("#screening-dialog");
    assert.match(await page.textContent("#scr-panel"), /No processes yet/);

    await addTyped(page, "<img src=x onerror=alert(1)> Claims intake", { volume: 5, pain: 4 });
    await addTyped(page, "Invoice matching");
    let s = await current(page);
    assert.equal(s.candidates.length, 2);
    const [claims, invoices] = s.candidates;
    assert.equal(claims.scores.volume.value, 5);
    assert.equal(await page.locator("#scr-edit-" + claims.id).textContent(), "<img src=x onerror=alert(1)> Claims intake", "names show as text");
    assert.equal(await page.locator("#screening-dialog img").count(), 0);
    assert.match(await page.textContent("#scr-total-" + claims.id), /so far/);

    await scoreAll(page, claims.id, 4);
    await scoreAll(page, invoices.id, 3);
    assert.equal(await page.textContent("#scr-total-" + claims.id), "75");
    assert.equal(await page.textContent("#scr-total-" + invoices.id), "50");

    await page.click("#scr-tab-ranking");
    assert.equal(await page.textContent("#scr-first-choice"), "<img src=x onerror=alert(1)> Claims intake");
    assert.equal(await page.locator("#scr-chart .bc-dot-group").count(), 2);
    assert.match(await page.textContent("#scr-ranking-" + claims.id), /^1/);
    assert.equal(await page.textContent("#scr-stability-headline"), "Yes");

    await page.click("#scr-tab-criteria");
    await page.fill("#scr-k-weight-volume", "0");
    await page.locator("#scr-k-weight-volume").blur();
    await page.waitForFunction(() => window.AIxRay.screeningUi.current().criteria.find(k => k.id === "volume").weight === 0);
    assert.match(await page.textContent("#scr-weight-shares"), /Value 21\.4%/);
    await page.click("#scr-undo");
    assert.equal((await current(page)).criteria.find(k => k.id === "volume").weight, 3);
    assert.equal(await page.inputValue("#scr-k-weight-volume"), "3");

    await page.click("#scr-details");
    await page.fill("#scr-m-title", "Northwind shortlist");
    await page.fill("#scr-m-currency", "eur");
    await page.click("#scr-details-dialog .dlg-foot .btn-primary");
    assert.equal(await page.textContent("#scr-title"), "Northwind shortlist");
    assert.equal((await current(page)).meta.currency, "EUR");

    assert.equal(await page.textContent("#scr-save-state"), "Not saved yet");
    const downloading = page.waitForEvent("download");
    await page.click("#scr-save");
    const download = await downloading;
    assert.equal(download.suggestedFilename(), "northwind-shortlist.screening.json");
    const saved = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
    assert.equal(saved.schema, "aixray.screening");
    assert.equal(saved.candidates.length, 2);
    assert.equal(await page.textContent("#scr-save-state"), "Saved as northwind-shortlist.screening.json");

    await page.keyboard.press("Escape");
    await page.waitForSelector("#screening-dialog", { state: "detached" });
    await page.click("#start-screening");
    assert.equal(await page.textContent("#scr-title"), "Northwind shortlist", "the screening stays in the tab when the window closes");
    await page.click("#scr-new");
    assert.equal(await page.textContent("#scr-title"), "Process screening");
    await page.keyboard.press("Escape");

    await page.setInputFiles("#file-input", { name: "northwind-shortlist.screening.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(saved)) });
    await page.waitForSelector("#screening-dialog");
    assert.equal(await page.textContent("#scr-title"), "Northwind shortlist");
    assert.deepEqual(await current(page), saved);
    assert.equal(await page.evaluate(() => !!window.AIxRay.app.store), false, "opening a screening does not open a project");
    clean(problems);
  });
}

test("add processes from project files, refresh one, and add the open project", { timeout: 90000 }, async t => {
  const { page, problems } = await open(t, "file");
  await page.click("#start-try");
  await page.waitForFunction(() => !!window.AIxRay.app.store);
  const before = await page.evaluate(() => JSON.stringify(window.AIxRay.app.store.get()));
  await page.click("#btn-menu");
  await page.click("#menu-screening");
  await page.waitForSelector("#screening-dialog");

  await addFile(page, example("cash-matching"));
  await page.waitForFunction(() => /Added End-to-end cash transaction matching/.test(document.querySelector("#scr-status").textContent));
  await page.click("#scr-add-open");
  await page.waitForFunction(() => window.AIxRay.screeningUi.current().candidates.length === 2);
  let s = await current(page);
  const underwriting = s.candidates.find(c => c.source.engagementId === "eng-underwriting");
  assert.equal(underwriting.facts.annualVolume.value, 400);
  assert.equal(underwriting.source.steps, 26);

  await page.selectOption("#scr-score-" + underwriting.id + "-volume", "5");
  await page.click("#scr-add-open");
  await page.waitForFunction(() => /Updated the figures for/.test(document.querySelector("#scr-status").textContent));
  s = await current(page);
  assert.equal(s.candidates.length, 2);
  assert.equal(s.candidates.find(c => c.id === underwriting.id).scores.volume.value, 5, "refreshing keeps the scores");

  await page.click("#scr-edit-" + underwriting.id);
  assert.match(await page.textContent("#scr-candidate-dialog .scr-source"), /26 steps, 0 with a touch effort/);
  await page.fill("#scr-c-effortHoursPerCase-value", "-2");
  await page.click("#scr-candidate-dialog .dlg-foot .btn-primary");
  assert.match(await page.textContent("#scr-c-error"), /zero or a positive number/);
  await page.fill("#scr-c-effortHoursPerCase-value", "6");
  await page.click("#scr-candidate-dialog .dlg-foot .btn-primary");
  await page.click("#scr-tab-ranking");
  assert.match(await page.textContent("#scr-ranking-" + underwriting.id), /2,400 hours per year/);
  assert.match(await page.textContent("#scr-ranking-" + underwriting.id), /\$360,000/);

  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => JSON.stringify(window.AIxRay.app.store.get())), before, "the open project is not changed");
  clean(problems);
});

test("flags and sensitive processes, and files that are refused", { timeout: 90000 }, async t => {
  const { page, problems } = await open(t, "file");
  await page.click("#start-screening");
  await addTyped(page, "Open process");
  await addTyped(page, "Private process");
  let s = await current(page);
  const [openOne, privateOne] = s.candidates;
  await scoreAll(page, openOne.id, 3);
  await page.selectOption("#scr-score-" + openOne.id + "-sponsor", "1");
  await scoreAll(page, privateOne.id, 4);
  await page.click("#scr-edit-" + privateOne.id);
  await page.check("#scr-c-sensitive");
  await page.click("#scr-candidate-dialog .dlg-foot .btn-primary");

  await page.click("#scr-tab-ranking");
  assert.equal(await page.locator("#scr-ranking tbody tr").count(), 1);
  assert.match(await page.textContent("#scr-ranking-" + openOne.id), /Sponsor and process experts scored 1/);
  assert.equal(await page.locator("#scr-chart .scr-dot-flagged").count(), 1);
  await page.check("#scr-include-sensitive");
  assert.equal(await page.locator("#scr-ranking tbody tr").count(), 2);
  assert.equal(await page.textContent("#scr-first-choice"), "Private process");

  await page.click("#scr-close");
  await page.setInputFiles("#file-input", { name: "future.screening.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ schema: "aixray.screening", schemaVersion: 2, id: "scr-x", criteria: [], candidates: [] })) });
  await page.waitForSelector("dialog.dlg:not(#screening-dialog)");
  assert.match(await page.textContent("dialog.dlg"), /saved by a newer version of AIxRay/);
  await page.keyboard.press("Escape");
  s = await current(page);
  assert.equal(s.candidates.length, 2, "a refused file leaves the screening in the tab as it was");
  clean(problems);
});

test("print the summary, then start a project for the first choice", { timeout: 90000 }, async t => {
  const { page, problems } = await open(t, "file");
  await page.click("#start-screening");
  await addTyped(page, "Claims intake");
  await addTyped(page, "Payroll changes");
  let s = await current(page);
  const [claims, payroll] = s.candidates;
  await scoreAll(page, claims.id, 4);
  await scoreAll(page, payroll.id, 2);
  await page.click("#scr-edit-" + claims.id);
  await page.fill("#scr-c-annualVolume-value", "12000");
  await page.selectOption("#scr-c-annualVolume-basis", "supplied");
  await page.click("#scr-candidate-dialog .dlg-foot .btn-primary");
  await page.click("#scr-details");
  await page.fill("#scr-m-client", "Northwind");
  await page.fill("#scr-m-rate-value", "70");
  await page.click("#scr-details-dialog .dlg-foot .btn-primary");

  await page.click("#scr-tab-summary");
  assert.match(await page.textContent("#scr-sum-recommendation"), /^Claims intake scores 75 of 100 \(Start here\)\./);
  assert.equal(await page.locator("#scr-sum-ranking tbody tr").count(), 2);
  assert.equal(await page.locator("#scr-sum-ranking button").count(), 0, "the summary has no buttons");
  await page.evaluate(() => {
    window.__printed = null;
    window.print = () => {
      const copy = document.getElementById("scr-print");
      window.__printed = { text: copy && copy.textContent, printing: document.body.classList.contains("scr-printing"), outside: !!copy && !copy.closest("dialog") };
      window.dispatchEvent(new Event("afterprint"));
    };
  });
  await page.click("#scr-print-btn");
  await page.waitForFunction(() => window.__printed !== null);
  const printed = await page.evaluate(() => window.__printed);
  assert.equal(printed.printing, true);
  assert.equal(printed.outside, true, "the print copy sits outside the window, which printing hides");
  assert.match(printed.text, /Northwind \u00b7 Process screening/);
  assert.match(printed.text, /Criteria and weights/);
  assert.equal(await page.locator("#scr-print").count(), 0, "the print copy is removed afterwards");
  assert.equal(await page.evaluate(() => document.body.classList.contains("scr-printing")), false);

  await page.click("#scr-tab-ranking");
  await page.click("#scr-start-" + payroll.id);
  assert.match(await page.textContent("dialog.dlg:not(#screening-dialog)"), /ranks 2 of 2/);
  await page.click("dialog.dlg:not(#screening-dialog) .dlg-foot .btn:not(.btn-primary)");
  await page.click("#scr-start-first");
  await page.click("dialog.dlg:not(#screening-dialog) .dlg-foot .btn-primary");
  await page.waitForSelector("#builder-dialog");
  assert.equal(await page.locator("#screening-dialog").count(), 0);
  const e = await page.evaluate(() => window.AIxRay.app.store.get());
  assert.equal(e.meta.processName, "Claims intake");
  assert.equal(e.meta.clientDisplayName, "Northwind");
  assert.deepEqual(e.assumptions.map(a => [a.key, a.value, a.status]), [["annualVolume", 12000, "supplied"], ["hourlyRate", 70, "illustrative"]]);
  assert.match(e.models[0].notes, /Screening score: 75 of 100/);

  await page.keyboard.press("Escape");
  await page.click("#btn-menu");
  await page.click("#menu-screening");
  assert.equal(await page.textContent("#scr-title"), "Process screening", "the screening is still in the tab");
  assert.equal((await current(page)).candidates.length, 2);
  clean(problems);
});

for (const mode of ["file", "http"]) {
  test("open the example screening from an empty screening (" + mode + ")", { timeout: 60000 }, async t => {
    const { page, problems } = await open(t, mode);
    await page.click("#start-screening");
    await page.click("#scr-example");
    assert.match(await page.textContent("#scr-status"), /Every score and figure in it is illustrative/);
    assert.equal(await page.textContent("#scr-title"), "Where to start: four candidate processes");
    assert.equal(await page.textContent("#scr-data-status"), "Demonstration data");
    assert.equal(await page.locator("#scr-grid tbody tr").count(), 4);
    await page.click("#scr-tab-ranking");
    assert.equal(await page.textContent("#scr-first-choice"), "End-to-end cash transaction matching");
    assert.equal(await page.textContent("#scr-stability-headline"), "Yes");
    assert.equal(await page.locator("#scr-chart .bc-dot-group").count(), 3);
    await page.click("#scr-tab-summary");
    assert.match(await page.textContent("#scr-sum-recommendation"), /^End-to-end cash transaction matching scores 79 of 100 \(Start here\)\./);
    assert.equal(await page.textContent("#scr-save-state"), "Not saved yet");
    clean(problems);
  });
}
