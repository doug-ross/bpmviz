import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { launch, fileUrl, watch } from "../../tools/lib/browser.mjs";

test("a facilitator builds, walks, designs and saves a pilot without editing JSON", { timeout: 120000 }, async t => {
  const browser = await launch();
  assert.ok(browser, "Chrome or Edge must launch for workshop acceptance");
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
  const page = await context.newPage(), problems = watch(page);
  page.setDefaultTimeout(15000);
  await page.goto(fileUrl());
  await page.click("#start-process-builder");
  await page.locator('[data-builder="process-name"]').fill("Jumpstart application intake");
  await page.locator('[data-builder="team-name"]').fill("Case team");
  await page.locator('[data-builder="create"]').click();
  const builder = page.locator("#builder-dialog");
  const field = key => builder.locator('[data-builder="' + key + '"]');
  const flowId = await page.evaluate(() => window.AIxRay.app.store.get().models[0].edges[0].id);
  await field("new-node-name").fill("Review application");
  await field("insert-flow").selectOption(flowId);
  await field("add-node").click();
  let project = await page.evaluate(() => window.AIxRay.app.store.get());
  assert.equal(project.models[0].nodes.length, 3);
  await builder.locator(".dlg-foot").getByRole("button", { name: "Close", exact: true }).click();

  await page.click("#tab-present");
  await page.click("#pr-mode-walkthrough");
  const walk = page.locator("#pr-mode-host");
  await walk.locator('[data-walk="start"]').click();
  await walk.locator('[data-walk="next"]').click();
  assert.equal(await walk.locator('[data-walk="current"]').textContent(), "Review application");
  await walk.locator('[data-walk="next"]').click();
  assert.match(await walk.locator('[data-walk="current"]').textContent(), /end|done/i);

  await page.click("#btn-menu");
  await page.click("#menu-process-builder");
  await builder.locator("summary").filter({ hasText: "Future alternatives" }).click();
  await field("alternative-name").fill("AI-assisted intake");
  await field("clone").click();
  project = await page.evaluate(() => window.AIxRay.app.store.get());
  const future = project.models.find(m => m.role === "future");
  assert.ok(future);
  assert.equal(project.models[0].locked, true);
  await builder.locator(".dlg-foot").getByRole("button", { name: "Close", exact: true }).click();

  await page.click("#tab-records");
  await page.click("#rv-tab-workshop");
  await page.selectOption("#workshop-current", "m-current");
  await page.selectOption("#workshop-future", future.id);
  await page.getByRole("button", { name: "Agree processes", exact: true }).click();
  const task = future.nodes.find(n => n.label === "Review application");
  await page.selectOption("#workshop-design-model", future.id);
  await page.selectOption("#workshop-design-step", task.id);
  const design = page.locator("#workshop-panel .workshop-design");
  await design.getByLabel("Design owner", { exact: true }).fill("Operations lead");
  await design.getByLabel("Responsibility", { exact: true }).selectOption("ai-assist");
  for (const [label, value] of Object.entries({
    Trigger: "Application received", Inputs: "Application and supporting documents", Outputs: "Proposed completeness check",
    Systems: "Case system", "Rules and limits": "Flag missing required fields", Approval: "Case handler approves requests",
    "Fallback and escalation": "Manual intake when extraction fails", "Test criteria": "All missing required documents flagged"
  })) await design.getByLabel(label, { exact: true }).fill(value);
  await design.getByLabel("Reviewed: I checked this design, its limits and test criteria", { exact: true }).check();
  await design.getByRole("button", { name: "Save automation design", exact: true }).click();
  await page.fill("#workshop-reviewer", "Process owner");
  await page.fill("#workshop-date", "2026-10-15");
  await page.getByLabel("Acceptance criterion", { exact: true }).first().fill("Case handler approves every external message");
  await page.getByLabel("Criterion owner", { exact: true }).first().fill("Operations lead");
  await page.getByLabel("Reviewed: these checkpoint details and criteria may be shared", { exact: true }).check();
  await page.getByRole("button", { name: "Capture checkpoint", exact: true }).click();
  assert.equal(await page.locator(".workshop-checkpoint-status").getAttribute("data-status"), "current");
  await page.getByRole("button", { name: "Open pilot brief", exact: true }).click();
  assert.match(await page.locator("#pr-mode-host").textContent(), /Manual intake when extraction fails/);

  const downloading = page.waitForEvent("download");
  await page.click("#btn-save");
  const download = await downloading;
  const saved = await fs.readFile(await download.path(), "utf8");
  // Reopen the downloaded project through the normal file loader, without changing its content.
  await page.evaluate(async ({ text, name }) => window.AIxRay.app.openFile(new File([text], name, { type: "application/json" })),
    { text: saved, name: download.suggestedFilename() });
  const reopened = await page.evaluate(() => ({ e: window.AIxRay.app.store.get(), status: window.AIxRay.workshop.checkpointStatus(window.AIxRay.app.store.get()).status }));
  assert.equal(reopened.e.workshop.designs[0].approval, "Case handler approves requests");
  assert.equal(reopened.status, "current");
  assert.deepEqual(problems.errors, []);
  assert.deepEqual(problems.external, []);
});
