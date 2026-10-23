// Value dimensions step 3: adding the portfolio criteria from the screening's Criteria tab.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { launch, fileUrl, watch } from "../../tools/lib/browser.mjs";

let browser;
before(async () => { browser = await launch(); }, { timeout: 60000 });
after(async () => { if (browser) await browser.close(); }, { timeout: 30000 });

test("add the portfolio criteria to a screening, and undo", { timeout: 90000 }, async t => {
  assert.ok(browser, "Chrome or Edge must launch; retry outside the sandbox if child process creation is blocked.");
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  t.after(() => context.close(), { timeout: 15000 });
  const page = await context.newPage(), problems = watch(page);
  page.setDefaultTimeout(12000);
  await page.goto(fileUrl());
  await page.waitForFunction(() => !!window.AIxRay.screeningUi && !!window.AIxRay.app);
  await page.click("#start-screening");
  await page.waitForSelector("#screening-dialog");
  await page.click("#scr-tab-criteria");
  assert.match(await page.textContent("#scr-portfolio"), /reuse in other processes, cash tied up by the process, what a pilot would teach/);
  await page.click("#scr-k-add-portfolio");
  await page.waitForSelector("#scr-k-row-learning");
  assert.equal(await page.locator("#scr-portfolio").count(), 0, "offered only while one is missing");
  assert.equal(await page.inputValue("#scr-k-label-workingCapital"), "Cash tied up by the process");
  const ids = await page.evaluate(() => window.AIxRay.screeningUi.current().criteria.map(c => c.id));
  assert.deepEqual(ids.slice(-3), ["reuse", "workingCapital", "learning"]);
  await page.click("#scr-undo");
  await page.waitForSelector("#scr-portfolio");
  assert.equal(await page.locator("#scr-k-row-reuse").count(), 0);
  assert.deepEqual(problems.errors, []);
  assert.deepEqual(problems.external, []);
});
