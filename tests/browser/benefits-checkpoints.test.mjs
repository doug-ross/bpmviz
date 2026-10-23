// Browser tests for checkpoints recorded by hand: with no event log, a delivery team adds a 30-day
// checkpoint in the Value tab and sees it against the business case, in the report and on the one-pager.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { launch, fileUrl, watch } from "../../tools/lib/browser.mjs";

let browser = null;
before(async () => { browser = await launch(); });
after(async () => { if (browser) await browser.close(); });

async function open(t, hash) {
  assert.ok(browser, "Chrome or Edge is needed for the browser tests");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(fileUrl() + hash);
  await page.waitForFunction(() => window.AIxRay && window.AIxRay.app && window.AIxRay.app.store);
  t.after(async () => { await context.close(); });
  return { page, problems };
}

test("without an event log, a checkpoint is added and compared with the business case", async t => {
  const s = await open(t, "#example=underwriting-current-state&ws=value");
  const p = s.page;
  await p.evaluate(() => window.AIxRay.app.goto("value"));
  assert.equal(await p.locator("#bv-section").count(), 0, "no benefits card before there is anything to measure");
  await p.evaluate(() => {
    const d = window.AIxRay.app.dispatch;
    d("node/update", { modelId: "m-current", nodeId: "scrub-sov-geocode", patch: { measures: { touchEffort: { value: 1, unit: "hour" } } } });
    d("record/add", { record: { kind: "opportunity", title: "Automate the SOV scrub", linkedModelId: "m-current", linkedNodeIds: ["scrub-sov-geocode"],
      opportunity: { effort: "M", valueCase: { effortReductionPct: 50, shareOfCasesPct: 50, basis: "supplied" } } } });
    window.AIxRay.app.goto("value");
  });
  await p.waitForSelector("#bv-checkpoints");
  assert.match(await p.textContent("#bv-section"), /Results recorded by hand at checkpoints/);
  await p.click("#bv-cp-add");
  await p.waitForSelector("dialog[open] #bv-cp-hours");
  assert.match(await p.textContent("dialog[open]"), /The business case has 1 hours per affected case before the change/);
  await p.selectOption("#bv-cp-label", "30 days");
  await p.fill("#bv-cp-date", "2027-01-31");
  await p.fill("#bv-cp-hours", "0.5");
  await p.selectOption("#bv-cp-basis", "observed");
  await p.fill("#bv-cp-source", "Time study of 20 submissions");
  await p.click("dialog[open] .dlg-foot .btn-primary");
  await p.waitForSelector("dialog[open]", { state: "detached" });
  const table = await p.textContent("#bv-checkpoints table");
  assert.match(table, /30 days, 2027-01-31/);
  assert.match(table, /Met/);
  assert.match(table, /Time study of 20 submissions/);
  const e = await p.evaluate(() => window.AIxRay.app.store.get());
  assert.equal(e.checkpoints.length, 1);
  assert.equal(e.checkpoints[0].hoursPerCaseAfter, 0.5);

  await p.evaluate(() => { window.AIxRay.app.goto("present"); window.AIxRay.app.presentView.setMode("handoff"); });
  assert.match(await p.textContent("#handoff-doc"), /Results at checkpoints/);
  assert.match(await p.textContent("#handoff-doc"), /Automate the SOV scrub, 30 days \(2027-01-31\): Met/);
  const page = await p.evaluate(() => window.AIxRay.businessCase.buildOnePager(window.AIxRay.app.store.get(),
    window.AIxRay.app.store.get().records.find(r => r.title === "Automate the SOV scrub").id));
  assert.equal(page.checkpoints[0].status, "met");
  assert.deepEqual(s.problems.errors, [], "no page or console errors");
  assert.deepEqual(s.problems.external, [], "no requests outside the app's own files");
});
