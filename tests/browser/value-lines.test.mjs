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

for (const mode of ["file", "http"]) {
  test("add value lines and a realization share in the business case editor (" + mode + ")", { timeout: 90000 }, async t => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    t.after(() => context.close(), { timeout: 15000 });
    const page = await context.newPage(), problems = watch(page);
    page.setDefaultTimeout(12000);
    await page.goto((mode === "http" ? server.url : fileUrl()) + "#example=underwriting&ws=records");
    await page.waitForFunction(() => window.AIxRay.app && window.AIxRay.app.store && window.AIxRay.app.workspace === "records");
    await page.evaluate(() => {
      const d = window.AIxRay.app.dispatch;
      d("node/update", { modelId: "m-current", nodeId: "scrub-sov-geocode", patch: { measures: { touchEffort: { value: 30, unit: "minute" } } } });
      d("record/add", { record: { kind: "opportunity", title: "Standard SOV template", linkedModelId: "m-current", linkedNodeIds: ["scrub-sov-geocode"],
        opportunity: { effort: "M", valueCase: { modelId: "m-current", nodeIds: ["scrub-sov-geocode"], effortReductionPct: 50, shareOfCasesPct: 60,
          shareSource: "manual", effortSource: "node", confidence: "high", basis: "supplied" } } } });
    });
    const open = () => page.evaluate(() => { const a = window.AIxRay.app; a.openRecordDialog(a.store.get().records.find(r => r.title === "Standard SOV template")); });
    await open();
    await page.waitForSelector("#bc-vc-realization");
    assert.match(await page.textContent("#bc-vc-preview"), /Estimated at \$9,000 a year/);

    await page.fill("#bc-vc-realization", "40");
    await page.fill("#bc-vc-realized-by", "Overtime cut in the SOV team");
    await page.fill("#bc-vc-finance-owner", "UW finance lead");
    await page.selectOption("#bc-vl-add-kind", "rework");
    await page.click("#bc-vl-add");
    await page.fill("#bc-vl-vl-rework-errorRateBeforePct", "10");
    await page.fill("#bc-vl-vl-rework-errorRateAfterPct", "4");
    await page.fill("#bc-vl-vl-rework-costPerError", "500");
    await page.fill("#bc-vl-vl-rework-realization", "100");
    await page.selectOption("#bc-vl-add-kind", "vendor");
    await page.click("#bc-vl-add");
    await page.fill("#bc-vl-vl-vendor-unitsBefore", "20");
    await page.fill("#bc-vl-vl-vendor-unitsAfter", "12");
    await page.fill("#bc-vl-vl-vendor-costPerUnitPerYear", "1200");
    await page.fill("#bc-vl-vl-vendor-realization", "50");
    await page.fill("#bc-vl-vl-vendor-validated", "4800");
    await page.fill("#bc-vl-vl-vendor-validated-source", "<b>Renewal</b> quote");
    assert.equal(await page.textContent("#bc-vc-preview"), "Gross $30,600 a year, realizable $20,400, confirmed $4,800. Illustrative basis.");
    await page.click("dialog[open] .dlg-foot .btn-primary");
    await page.waitForFunction(() => !document.querySelector("dialog[open]"));

    let r = await page.evaluate(() => window.AIxRay.app.store.get().records.find(x => x.title === "Standard SOV template"));
    assert.deepEqual(r.opportunity.valueLines.map(l => l.dimension), ["rework", "vendor"]);
    assert.equal(r.opportunity.valueCase.realizationPct, 40);
    assert.equal(r.opportunity.valueCase.realizedBy, "Overtime cut in the SOV team");
    await page.click("#rv-tab-opportunities");
    assert.match(await page.textContent("#ws-records"), /\$20,400 a year/, "the Annual value column shows the realizable value");

    await page.click("#tab-present");
    await page.click("#pr-mode-business-case");
    await page.selectOption("#bc-present-select", r.id);
    await page.waitForSelector("#bc-parts");
    assert.equal(await page.locator("#bc-parts tbody tr").count(), 3);
    assert.match(await page.textContent("#bc-onepager"), /Realizable annual value/);
    assert.match(await page.textContent("#bc-parts"), /<b>Renewal<\/b> quote/, "text shows as text");
    assert.equal(await page.locator("#bc-parts b").count(), 0);

    await page.click("#tab-records");
    await open();
    await page.waitForSelector("#bc-vl-vl-rework-box");
    assert.equal(await page.inputValue("#bc-vl-vl-rework-costPerError"), "500");
    await page.click("#bc-vl-vl-rework-remove");
    assert.equal(await page.locator("#bc-vl-vl-rework-box").count(), 0);
    await page.click("dialog[open] .dlg-foot .btn-primary");
    await page.waitForFunction(() => !document.querySelector("dialog[open]"));
    r = await page.evaluate(() => window.AIxRay.app.store.get().records.find(x => x.title === "Standard SOV template"));
    assert.deepEqual(r.opportunity.valueLines.map(l => l.id), ["vl-vendor"]);
    assert.deepEqual(problems.errors, []);
    assert.deepEqual(problems.external, []);
  });
}

test("build a cost per error from the steps an error makes people redo", { timeout: 90000 }, async t => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  t.after(() => context.close(), { timeout: 15000 });
  const page = await context.newPage(), problems = watch(page);
  page.setDefaultTimeout(12000);
  await page.goto(fileUrl() + "#example=underwriting&ws=records");
  await page.waitForFunction(() => window.AIxRay.app && window.AIxRay.app.store);
  await page.evaluate(() => {
    const a = window.AIxRay.app;
    a.dispatch("node/update", { modelId: "m-current", nodeId: "scrub-sov-geocode", patch: { measures: { touchEffort: { value: 30, unit: "minute" } } } });
    a.dispatch("record/add", { record: { kind: "opportunity", title: "Validate SOVs on intake", linkedModelId: "m-current", linkedNodeIds: ["scrub-sov-geocode"], opportunity: { effort: "S" } } });
    a.openRecordDialog(a.store.get().records.find(r => r.title === "Validate SOVs on intake"));
  });
  await page.waitForSelector("#bc-vl-add");
  await page.selectOption("#bc-vl-add-kind", "rework");
  await page.click("#bc-vl-add");
  await page.click("#bc-vl-vl-rework-add-type");
  const tp = "#bc-vl-vl-rework-et-et-error-";
  await page.fill(tp + "name", "Bad geocode found at pricing");
  assert.equal(await page.isChecked(tp + "redo-scrub-sov-geocode"), true, "the opportunity's linked step is redone by default");
  await page.fill(tp + "per-month", "10");
  await page.fill(tp + "per-month-after", "4");
  await page.fill(tp + "investigation", "1");
  await page.fill(tp + "direct", "40");
  assert.equal(await page.textContent(tp + "cost"), "Cost per error $265 (1.5 hours of work). Today $31,800 a year, avoided $19,080 a year.");
  await page.fill("#bc-vl-vl-rework-realization", "100");
  await page.selectOption("#bc-vl-add-kind", "winRate");
  await page.click("#bc-vl-add");
  await page.fill("#bc-vl-vl-winRate-opportunitiesPerYear", "400");
  await page.fill("#bc-vl-vl-winRate-winRateBeforePct", "20");
  await page.fill("#bc-vl-vl-winRate-winRateAfterPct", "25");
  await page.fill("#bc-vl-vl-winRate-marginPerWin", "2000");
  await page.fill("#bc-vl-vl-winRate-realization", "50");
  assert.match(await page.textContent("#bc-vc-preview"), /^Gross \$59,080 a year, realizable \$39,080\./);
  await page.click("dialog[open] .dlg-foot .btn-primary");
  await page.waitForFunction(() => !document.querySelector("dialog[open]"));
  const r = await page.evaluate(() => window.AIxRay.app.store.get().records.find(x => x.title === "Validate SOVs on intake"));
  assert.deepEqual(r.opportunity.valueLines[0].errorTypes[0].redoNodeIds, ["scrub-sov-geocode"]);
  await page.click("#tab-present");
  await page.click("#pr-mode-business-case");
  await page.selectOption("#bc-present-select", r.id);
  await page.waitForSelector(".bc-errors");
  assert.match(await page.textContent(".bc-errors"), /Bad geocode found at pricing.*Moderate.*10 then 4.*\$265.*\$31,800.*\$19,080/);
  assert.match(await page.textContent("#bc-onepager"), /Errors cost \$31,800 a year today/);
  assert.deepEqual(problems.errors, []);
  assert.deepEqual(problems.external, []);
});
