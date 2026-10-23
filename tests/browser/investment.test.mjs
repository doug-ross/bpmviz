// Value dimensions step 3: the Investment over time block in the business
// case editor, and the investment section of the one-pager.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { launch, fileUrl, watch } from "../../tools/lib/browser.mjs";

let browser;
before(async () => {
  browser = await launch();
  assert.ok(browser, "Chrome or Edge must launch; retry outside the sandbox if child process creation is blocked.");
}, { timeout: 60000 });
after(async () => { if (browser) await browser.close(); }, { timeout: 30000 });

test("set up an investment case over three years and see it on the one-pager", { timeout: 90000 }, async t => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  t.after(() => context.close(), { timeout: 15000 });
  const page = await context.newPage(), problems = watch(page);
  page.setDefaultTimeout(12000);
  await page.goto(fileUrl() + "#example=underwriting&ws=records");
  await page.waitForFunction(() => window.AIxRay.app && window.AIxRay.app.store);
  await page.evaluate(() => {
    const d = window.AIxRay.app.dispatch;
    d("node/update", { modelId: "m-current", nodeId: "scrub-sov-geocode", patch: { measures: { touchEffort: { value: 30, unit: "minute" } } } });
    d("record/add", { record: { kind: "opportunity", title: "Standard SOV template", linkedModelId: "m-current", linkedNodeIds: ["scrub-sov-geocode"],
      opportunity: { effort: "M", valueCase: { modelId: "m-current", nodeIds: ["scrub-sov-geocode"], effortReductionPct: 50, shareOfCasesPct: 60,
        shareSource: "manual", effortSource: "node", confidence: "high", basis: "supplied", realizationPct: 40 } } } });
  });
  const open = () => page.evaluate(() => { const a = window.AIxRay.app; a.openRecordDialog(a.store.get().records.find(r => r.title === "Standard SOV template")); });
  const save = async () => { await page.click("dialog[open] .dlg-foot .btn-primary"); await page.waitForFunction(() => !document.querySelector("dialog[open]")); };
  const stored = () => page.evaluate(() => window.AIxRay.app.store.get().records.find(x => x.title === "Standard SOV template"));

  // Left closed and untouched, it saves nothing.
  await open();
  await page.waitForSelector("#bc-inv");
  assert.equal(await page.getAttribute("#bc-inv", "open"), null);
  await save();
  assert.equal("investment" in (await stored()).opportunity, false);

  await open();
  await page.click("#bc-inv > summary");
  assert.match(await page.textContent("#bc-inv-preview"), /Fill in adoption by year/);
  await page.fill("#bc-inv-rate", "10");
  await page.click("#bc-inv-ramp");
  assert.deepEqual(await Promise.all([1, 2, 3].map(i => page.inputValue("#bc-inv-adopt-" + i))), ["50", "90", "100"]);
  await page.selectOption("#bc-inv-add-category", "implementation");
  await page.click("#bc-inv-add-cost");
  await page.fill("#bc-inv-cost-implementation-one-time", "3000");
  await page.selectOption("#bc-inv-add-category", "modelUsage");
  await page.click("#bc-inv-add-cost");
  await page.fill("#bc-inv-cost-modelUsage-yearly", "800");
  await page.fill("#bc-inv-workflows", "240");
  await page.fill("#bc-inv-low", "70");
  await page.fill("#bc-inv-high", "120");
  await page.fill("#bc-inv-share", "50");
  await page.fill("#bc-inv-share-months", "12");
  // $3,600 realizable a year, ramped 50/90/100%, against $3,000 up front and $800 a year.
  const preview = await page.textContent("#bc-inv-preview");
  assert.match(preview, /^NPV \$2,029 over 3 years at 10(\.0)?%, ROI 60(\.0)?%, payback in 21\.8 months\./);
  assert.match(preview, /Low case NPV .*, high case NPV /);
  assert.match(preview, /Cost per successful workflow \$3/);
  assert.match(preview, /waits for an amount Finance confirmed/);
  await page.fill("#bc-vc-validated", "4000");
  assert.match(await page.textContent("#bc-inv-preview"), /Gain-share fee \$2,000\./);
  await save();

  const r = await stored();
  assert.deepEqual(r.opportunity.investment.adoptionPct, [50, 90, 100]);
  assert.deepEqual(r.opportunity.investment.costs.map(c => [c.category, c.oneTime, c.yearly]), [["implementation", 3000, null], ["modelUsage", null, 800]]);
  assert.equal(r.opportunity.investment.gainShareMonths, 12);

  await page.click("#tab-present");
  await page.click("#pr-mode-business-case");
  await page.selectOption("#bc-present-select", r.id);
  await page.waitForSelector("#bc-inv-years");
  assert.equal(await page.locator("#bc-inv-years tbody tr").count(), 4);
  assert.equal(await page.locator("#bc-inv-cases tbody tr").count(), 3);
  assert.equal(await page.locator("#bc-inv-costs-table tbody tr").count(), 2);
  assert.match(await page.textContent("#bc-inv-stats"), /\$2,029/);
  assert.match(await page.textContent("#bc-inv-gain-share"), /is a fee of \$2,000\./);

  // A longer horizon keeps the years already entered.
  await page.click("#tab-records");
  await open();
  await page.waitForSelector("#bc-inv[open]");
  await page.selectOption("#bc-inv-horizon", "5");
  assert.equal(await page.inputValue("#bc-inv-adopt-2"), "90");
  assert.equal(await page.inputValue("#bc-inv-adopt-5"), "");
  assert.match(await page.textContent("#bc-inv-preview"), /NPV needs adoption in year 4, adoption in year 5/);
  await page.click("#bc-inv-cost-modelUsage-remove");
  await save();
  const r2 = await stored();
  assert.equal(r2.opportunity.investment.horizonYears, 5);
  assert.deepEqual(r2.opportunity.investment.costs.map(c => c.id), ["cost-implementation"]);
  assert.deepEqual(problems.errors, []);
  assert.deepEqual(problems.external, []);
});
