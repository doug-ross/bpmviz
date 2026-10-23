// Value dimensions step 3: low and high values per figure in the business
// case editor, which figures matter most on the one-pager, and the
// investment case's low and high cases taken from them.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { launch, fileUrl, watch } from "../../tools/lib/browser.mjs";

let browser;
before(async () => { browser = await launch(); }, { timeout: 60000 });
after(async () => { if (browser) await browser.close(); }, { timeout: 30000 });

test("give figures a low and a high, and see the low and high case", { timeout: 90000 }, async t => {
  assert.ok(browser, "Chrome or Edge must launch; retry outside the sandbox if child process creation is blocked.");
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  t.after(() => context.close(), { timeout: 15000 });
  const page = await context.newPage(), problems = watch(page);
  page.setDefaultTimeout(12000);
  await page.goto(fileUrl() + "#example=underwriting&ws=records");
  await page.waitForFunction(() => window.AIxRay.app && window.AIxRay.app.store);
  // $9,000 of labor a year, 40% realizable: $3,600.
  await page.evaluate(() => {
    const d = window.AIxRay.app.dispatch;
    d("node/update", { modelId: "m-current", nodeId: "scrub-sov-geocode", patch: { measures: { touchEffort: { value: 30, unit: "minute" } } } });
    d("record/add", { record: { kind: "opportunity", title: "Standard SOV template", linkedModelId: "m-current", linkedNodeIds: ["scrub-sov-geocode"],
      opportunity: { effort: "M", valueCase: { modelId: "m-current", nodeIds: ["scrub-sov-geocode"], effortReductionPct: 50, shareOfCasesPct: 60,
        shareSource: "manual", effortSource: "node", confidence: "high", basis: "supplied", realizationPct: 40 },
        investment: { horizonYears: 3, discountRatePct: 10, adoptionPct: [50, 90, 100], lowPct: 70, highPct: 120,
          costs: [{ id: "cost-implementation", category: "implementation", oneTime: 3000 }] } } } });
  });
  const open = () => page.evaluate(() => { const a = window.AIxRay.app; a.openRecordDialog(a.store.get().records.find(r => r.title === "Standard SOV template")); });
  const stored = () => page.evaluate(() => window.AIxRay.app.store.get().records.find(x => x.title === "Standard SOV template"));
  await open();
  await page.waitForSelector("#bc-rng");
  assert.equal(await page.getAttribute("#bc-rng", "open"), null);
  await page.click("#bc-rng > summary");
  assert.match(await page.textContent("#bc-rng-vc-effortReductionPct-today"), /^50%$/);
  assert.match(await page.textContent("#bc-rng-as-hourlyRate-today"), /\$150 per hour/);
  assert.match(await page.textContent("#bc-rng-preview"), /Give a low and a high/);
  await page.fill("#bc-rng-vc-effortReductionPct-low", "30");
  await page.fill("#bc-rng-vc-effortReductionPct-high", "60");
  await page.fill("#bc-rng-as-hourlyRate-low", "100");
  await page.fill("#bc-rng-as-hourlyRate-high", "200");
  assert.match(await page.textContent("#bc-rng-preview"), /^Low case \$1,440 and high case \$5,760, against \$3,600 \(.+\)\. Matters most: fully loaded hourly rate\.$/);
  assert.match(await page.textContent("#bc-inv-preview"), /Low case NPV .*high case NPV/);
  // Clearing a figure takes its row out; typing it again brings the row back with its range.
  await page.fill("#bc-vc-effort-pct", "");
  await page.waitForFunction(() => !document.getElementById("bc-rng-vc-effortReductionPct-low"));
  await page.fill("#bc-vc-effort-pct", "50");
  await page.waitForSelector("#bc-rng-vc-effortReductionPct-low");
  assert.equal(await page.inputValue("#bc-rng-vc-effortReductionPct-low"), "30");
  await page.click("dialog[open] .dlg-foot .btn-primary");
  await page.waitForFunction(() => !document.querySelector("dialog[open]"));
  const r = await stored();
  assert.deepEqual(r.opportunity.ranges, { "vc.effortReductionPct": { low: 30, high: 60 }, "as.hourlyRate": { low: 100, high: 200 } });

  await page.click("#tab-present");
  await page.click("#pr-mode-business-case");
  await page.selectOption("#bc-present-select", r.id);
  await page.waitForSelector("#bc-rng-onepager");
  assert.equal(await page.locator("#bc-rng-onepager tbody tr").count(), 2);
  assert.match(await page.textContent("#bc-onepager"), /the low case is \$1,440 and the high case is \$5,760\./);
  assert.match(await page.textContent("#bc-inv-cases"), /From the ranges/);
  assert.deepEqual(problems.errors, []);
  assert.deepEqual(problems.external, []);
});
