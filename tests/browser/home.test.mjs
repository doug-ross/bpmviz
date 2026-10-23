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
  test("the AIxRay name goes back to the start page and the open project stays open (" + mode + ")", { timeout: 60000 }, async t => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    t.after(() => context.close(), { timeout: 15000 });
    const page = await context.newPage(), problems = watch(page);
    await page.goto((mode === "http" ? server.url : fileUrl()) + "#example=underwriting-current-state&ws=records");
    await page.waitForFunction(() => window.AIxRay.app && window.AIxRay.app.store && window.AIxRay.app.workspace === "records");
    await page.evaluate(() => window.AIxRay.app.dispatch("record/add", { record: { kind: "question", title: "Who approves the binder?", linkedModelId: "m-current" } }));
    const before = await page.evaluate(() => window.AIxRay.app.store.get().revision);

    assert.equal(await page.getAttribute("#btn-home", "title"), "Go to the start page");
    await page.click("#btn-home");
    await page.waitForFunction(() => window.AIxRay.app.workspace === "start");
    assert.equal(await page.isVisible("#ws-start .start-actions"), true);
    assert.equal(await page.locator("dialog[open]").count(), 0, "going home asks nothing, because nothing is closed");
    assert.equal(await page.locator('#tab-records[aria-selected="true"]').count(), 0);
    assert.equal(await page.evaluate(() => window.AIxRay.app.store.get().revision), before, "the project is unchanged");

    await page.click("#tab-records");
    await page.waitForFunction(() => window.AIxRay.app.workspace === "records");
    assert.match(await page.textContent("#ws-records"), /Who approves the binder\?/);
    assert.deepEqual(problems.errors, []);
    assert.deepEqual(problems.external, []);
  });
}
