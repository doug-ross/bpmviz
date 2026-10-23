import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { launch, serve, fileUrl, watch } from "../../tools/lib/browser.mjs";

let browser, server;
before(async () => {
  browser = await launch();
  assert.ok(browser, "Chrome or Edge must launch; retry outside the sandbox if child process creation is blocked.");
  server = await serve();
}, { timeout: 60000 });
after(async () => { if (browser) await browser.close(); if (server) await server.close(); }, { timeout: 30000 });

async function open(t, mode, hash) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  t.after(() => context.close(), { timeout: 15000 });
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; window.print = () => {}; });
  const page = await context.newPage(), problems = watch(page);
  page.setDefaultTimeout(15000);
  await page.goto((mode === "http" ? server.url : fileUrl()) + (hash || ""));
  await page.waitForFunction(() => !!window.AIxRay.tour && !!window.AIxRay.app && (!!document.querySelector(".start-actions") || !!window.AIxRay.tour.state()));
  return { page, problems };
}
const state = page => page.evaluate(() => window.AIxRay.tour.state());
/* Waits until the tour shows step index (0-based) with its target found. */
async function shown(page, index) {
  await page.waitForFunction(i => { const s = window.AIxRay.tour.state(); return s && s.index === i && s.status === "shown"; }, index);
  return state(page);
}
function clean(problems) {
  assert.deepEqual(problems.errors, [], "no console errors, page errors or CSP violations");
  assert.deepEqual(problems.external, [], "no requests outside local files");
}

/* Walks a whole tour with Next, checking that every step finds what it points at. */
async function walk(page, flow) {
  let s = await shown(page, 0);
  assert.equal(s.flow, flow);
  const titles = [];
  for (let i = 0; i < s.count; i++) {
    s = await shown(page, i);
    titles.push(s.title);
    assert.equal(await page.textContent("#tour-title"), s.title);
    assert.equal(await page.textContent("#tour-count"), "Step " + (i + 1) + " of " + s.count);
    if (i < s.count - 1) await page.click("#tour-next");
  }
  assert.equal(await page.textContent("#tour-next"), "Finish");
  assert.equal(await page.isVisible("#tour-other"), true);
  await page.click("#tour-next");
  await page.waitForFunction(() => !window.AIxRay.tour.state());
  assert.equal(await page.locator("#tour-layer").count(), 0);
  return titles;
}

for (const mode of ["file", "http"]) {
  test("Take a tour runs the process tour from start to finish on the example (" + mode + ")", { timeout: 180000 }, async t => {
    const { page, problems } = await open(t, mode);
    assert.equal(await page.locator("#tour-offer").count(), 0, "automated browsers are not offered a tour");
    await page.click("#start-tour");
    await page.waitForSelector("#tour-chooser");
    assert.equal(await page.locator("#tour-chooser .tour-option").count(), 2);
    await page.click("#tour-choose-analyze");
    const titles = await walk(page, "analyze");
    assert.equal(titles.length, 18);
    const e = await page.evaluate(() => window.AIxRay.app.store.get());
    assert.equal(e.id, "eng-underwriting-current");
    assert.ok(e.records.some(r => r.kind === "pain" && /Facultative placement waits/.test(r.title)), "the finding was added");
    assert.equal(e.records.filter(r => /Sample opportunity added by the tour/.test(r.description || "")).length, 3);
    const draft = e.models.find(m => m.role === "future");
    assert.ok(draft && draft.nodes.some(n => n.label === "Spot-check extracted SOV fields"), "the sample changes are in the draft");
    clean(problems);
  });

  test("the screening tour ends in the process builder for the first choice (" + mode + ")", { timeout: 180000 }, async t => {
    const { page, problems } = await open(t, mode);
    await page.evaluate(() => window.AIxRay.tour.start("screen"));
    const titles = await walk(page, "screen");
    assert.equal(titles.length, 14);
    assert.equal(await page.isVisible("#builder-dialog"), true);
    const e = await page.evaluate(() => window.AIxRay.app.store.get());
    assert.equal(e.meta.processName, "End-to-end cash transaction matching");
    const s = await page.evaluate(() => window.AIxRay.screeningUi.current());
    assert.ok(Object.values(s.candidates.find(c => c.id === "c-supplier-invoice-exceptions").scores).some(x => x.aiDraft), "the sample scores went in as AI drafts");
    clean(problems);
  });
}

test("clicking the ringed controls moves the tour on, and Escape ends it", { timeout: 90000 }, async t => {
  const { page, problems } = await open(t, "file");
  await page.evaluate(() => window.AIxRay.tour.start("a"));
  await shown(page, 0);
  await page.click("#open-underwriting-current-state");
  await shown(page, 1);
  assert.equal(await page.isVisible("#tour-ring"), true);
  await page.click("#pv-play");
  await shown(page, 2);
  await page.click("#tour-next");
  await shown(page, 3);
  await page.click('#pv-panes [data-node="obtain-fac-binder-from-market"]');
  await shown(page, 4);
  await page.click("#dt-capture");
  await shown(page, 5);
  assert.equal(await page.inputValue("#cap-title"), "Facultative placement waits four days on the market");
  await page.click("#tour-back");
  await shown(page, 4);
  await page.focus("#tour-next");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !window.AIxRay.tour.state());
  assert.equal(await page.locator("#tour-layer").count(), 0);
  clean(problems);
});

test("Back passes over the future-state steps once the draft exists", { timeout: 120000 }, async t => {
  const { page, problems } = await open(t, "file");
  await page.evaluate(() => window.AIxRay.tour.start("analyze"));
  await shown(page, 0);
  await page.click("#tour-next");
  for (let i = 1; i < 14; i++) { await shown(page, i); await page.click("#tour-next"); }
  const s = await shown(page, 14);
  assert.match(s.title, /Change, add and remove steps/);
  await page.click("#tour-back");
  const back = await shown(page, 11);
  assert.equal(back.title, "Back to the process", "Plan a future state and Name the alternative are skipped");
  clean(problems);
});

test("a demo link starts a tour, and the first-visit offer starts one too", { timeout: 90000 }, async t => {
  const { page, problems } = await open(t, "file", "#tour=screen");
  const s = await shown(page, 0);
  assert.equal(s.flow, "screen");
  await page.click("#tour-end");
  await page.waitForFunction(() => !window.AIxRay.tour.state());
  await page.evaluate(() => window.AIxRay.tour.offer());
  await page.waitForSelector("#tour-offer");
  assert.equal(await page.evaluate(() => window.AIxRay.app.drafts.getPref("tour.offered")), "1", "the offer is made once");
  await page.click("#tour-offer-analyze");
  await shown(page, 0);
  assert.equal((await state(page)).flow, "analyze");
  assert.equal(await page.locator("#tour-offer").count(), 0);
  clean(problems);
});
