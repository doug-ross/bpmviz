import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { launch, serve, fileUrl, watch } from "../../tools/lib/browser.mjs";

let browser, server;
before(async () => { browser = await launch(); assert.ok(browser, "Chrome or Edge must start; skipping is not a pass"); server = await serve(); });
after(async () => { if (browser) await browser.close(); if (server) await server.close(); });

async function open(t, http = false) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  t.after(() => context.close());
  const page = await context.newPage(), problems = watch(page);
  await page.goto((http ? server.url : fileUrl()) + "#example=underwriting-current-state&ws=records");
  await page.waitForFunction(() => !!window.AIxRay?.app?.store);
  // The parent owns index.htm. This also runs while the isolated slice is awaiting script wiring.
  if (!await page.evaluate(() => !!window.AIxRay.workshop)) await page.addScriptTag({ url: new URL("js/lib/workshop.js", page.url()).href });
  if (!await page.evaluate(() => !!window.AIxRay.workshopUi)) await page.addScriptTag({ url: new URL("js/ui/workshop.js", page.url()).href });
  if (!await page.evaluate(() => Array.from(document.styleSheets).some(s => /workshop\.css$/.test(s.href || "")))) await page.addStyleTag({ url: new URL("css/workshop.css", page.url()).href });
  await page.evaluate(() => window.AIxRay.app.recordsView.render());
  await page.click("#rv-tab-workshop");
  return { page, problems };
}
function clean(s) { assert.deepEqual(s.problems.errors, []); assert.deepEqual(s.problems.external, []); }
async function agree(page) {
  await page.selectOption("#workshop-current", "m-current");
  await page.getByRole("button", { name: "Agree processes", exact: true }).click();
}
async function capture(page) {
  await page.fill("#workshop-reviewer", "Pilot reviewer");
  await page.fill("#workshop-date", "2026-10-15");
  await page.getByLabel("Acceptance criterion", { exact: true }).first().fill("No failed case waits more than five minutes");
  await page.getByLabel("Criterion owner", { exact: true }).first().fill("Operations owner");
  await page.getByLabel("Reviewed: these checkpoint details and criteria may be shared", { exact: true }).check();
  await page.getByRole("button", { name: "Capture checkpoint", exact: true }).click();
}

for (const http of [false, true]) test("Workshop agenda, action, closure, print and download over " + (http ? "HTTP" : "local files"), async t => {
  const s = await open(t, http), p = s.page;
  await agree(p);
  await p.getByRole("button", { name: "Add agenda item", exact: true }).click();
  await p.getByLabel("Agenda title", { exact: true }).fill("Review failed cases");
  await p.getByLabel("Agenda owner", { exact: true }).fill("Facilitator");
  await p.getByLabel("Agenda minutes", { exact: true }).fill("20");
  await p.getByLabel("Agenda status", { exact: true }).selectOption("active");
  await p.getByRole("button", { name: "Save agenda", exact: true }).click();
  assert.equal(await p.evaluate(() => window.AIxRay.app.store.get().workshop.agenda[0].minutes), 20);
  await p.getByRole("button", { name: "Add an action", exact: true }).click();
  const dialog = p.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill("Confirm operational support");
  await dialog.getByLabel("Owner", { exact: true }).fill("Support lead");
  await dialog.getByRole("button", { name: "Add finding", exact: true }).click();
  assert.match(await p.locator(".workshop-records").textContent(), /Confirm operational support.*Support lead/);
  await capture(p);
  assert.equal(await p.locator(".workshop-checkpoint-status").getAttribute("data-status"), "current");
  await p.getByRole("button", { name: "Open pilot brief", exact: true }).click();
  assert.equal(await p.locator("#pr-mode-pilot-brief").getAttribute("aria-pressed"), "true");
  assert.match(await p.locator("#pr-mode-host").textContent(), /Operations owner/);
  assert.equal(await p.locator("#pr-mode-host").getAttribute("class"), "handoff");
  const downloading = p.waitForEvent("download");
  await p.click("#pr-action-pilot-brief");
  const download = await downloading;
  assert.match(download.suggestedFilename(), /-pilot-brief\.txt$/);
  const output = await fs.readFile(await download.path(), "utf8");
  assert.match(output, /No failed case waits more than five minutes/);
  assert.match(output, /Confirm operational support/);
  await p.emulateMedia({ media: "print" });
  assert.equal(await p.locator(".workshop-brief").isVisible(), true);
  await p.emulateMedia({ media: "screen" });
  await p.click("#pr-handoff");
  assert.match(await p.locator("#handoff-doc").textContent(), /Pilot brief/);
  clean(s);
});

test("automation design edits persist, invalidate closure and render malicious text safely", async t => {
  const s = await open(t), p = s.page;
  await agree(p);
  await p.selectOption("#workshop-design-step", "scrub-sov-geocode");
  const form = p.locator("#workshop-panel .workshop-design");
  await form.getByLabel("Design owner", { exact: true }).fill("Automation owner");
  await form.getByLabel("Responsibility", { exact: true }).selectOption("ai-assist");
  const attack = '<img src=x onerror="window.workshopXss=1">';
  for (const label of ["Trigger", "Inputs", "Outputs", "Systems", "Rules and limits", "Approval", "Fallback and escalation", "Test criteria"]) {
    await form.getByLabel(label, { exact: true }).fill(label === "Trigger" ? attack : label + " agreed");
  }
  await form.getByLabel("Reviewed: I checked this design, its limits and test criteria", { exact: true }).check();
  await form.getByRole("button", { name: "Save automation design", exact: true }).click();
  await capture(p);
  await p.getByRole("button", { name: "Open pilot brief", exact: true }).click();
  assert.ok((await p.locator(".workshop-brief").textContent()).includes(attack));
  assert.equal(await p.locator(".workshop-brief img").count(), 0);
  assert.equal(await p.evaluate(() => window.workshopXss), undefined);
  await p.evaluate(() => {
    const B = window.AIxRay, e = B.app.store.get();
    const d = Object.assign({}, e.workshop.designs[0], { fallback: "Escalate to duty manager" });
    B.app.dispatch("workshop/saveDesign", { design: d });
  });
  assert.match(await p.locator(".workshop-brief-status").textContent(), /changed/);
  assert.doesNotMatch(await p.locator(".workshop-brief").textContent(), /Operations owner/);
  await p.click("#tab-process");
  await p.locator('.pane .node[data-node="scrub-sov-geocode"]').first().press("Enter");
  // The drawer's Details tab hosts extension step sections.
  const details = p.getByRole("tab", { name: "Details", exact: true });
  if (await details.count()) await details.click();
  await p.waitForSelector(".workshop-drawer");
  assert.equal(await p.locator(".workshop-drawer").getAttribute("open"), null);
  await p.locator(".workshop-drawer summary").click();
  assert.equal(await p.locator(".workshop-drawer").getByLabel("Trigger", { exact: true }).inputValue(), attack);
  clean(s);
});

test("sensitive and unreviewed content stays excluded from pilot/handoff even with shared-view inclusion toggles", async t => {
  const s = await open(t, true), p = s.page;
  await agree(p);
  await p.evaluate(() => {
    const B = window.AIxRay;
    B.app.dispatch("record/add", { record: { kind: "action", title: "PRIVATE_ACTION", sensitive: true } });
    B.app.dispatch("ai/applySuggestions", { records: [{ kind: "action", title: "DRAFT_ACTION" }], stamp: {} });
    B.app.dispatch("workshop/saveDesign", { design: { modelId: "m-current", nodeId: "scrub-sov-geocode", owner: "Owner", responsibility: "rules", trigger: "PRIVATE_DESIGN", reviewed: false, sensitive: true } });
  });
  await capture(p);
  await p.getByRole("button", { name: "Open pilot brief", exact: true }).click();
  await p.evaluate(() => {
    const root = document.querySelector(".present-bar");
    root.querySelectorAll('input[type="checkbox"]').forEach(x => { x.checked = true; x.dispatchEvent(new Event("change", { bubbles: true })); });
  });
  assert.doesNotMatch(await p.locator(".workshop-brief").textContent(), /PRIVATE_|DRAFT_/);
  await p.click("#pr-handoff");
  assert.doesNotMatch(await p.locator("#handoff-doc .workshop-brief").textContent(), /PRIVATE_|DRAFT_/);
  clean(s);
});
