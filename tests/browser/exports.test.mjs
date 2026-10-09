// Export for client tools (exports slice): the dialog reachable from the
// present bar and the export menu, a BPMN file that re-imports cleanly, a
// backlog that respects the sensitive and AI-draft toggles, and a
// PowerPoint deck that carries the process diagram when one has been drawn.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { launch, fileUrl, watch, root } from "../../tools/lib/browser.mjs";

const require = createRequire(import.meta.url);
const zip = require(path.join(root, "webui", "js", "lib", "zip.js"));
const inflateRaw = (b, max) => zlib.inflateRawSync(b, max ? { maxOutputLength: max } : {});

let browser = null;
before(async () => { browser = await launch(); });
after(async () => { if (browser) await browser.close(); });

async function open(t, hash) {
  if (!browser) { t.skip("Chrome or Edge is not installed"); return null; }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(fileUrl() + (hash || ""));
  await page.waitForFunction(() => window.BPMVIZ && window.BPMVIZ.app && document.getElementById("app"));
  if (hash) await page.waitForFunction(() => !!window.BPMVIZ.app.store);
  t.after(async () => { await context.close(); });
  return { page, problems };
}

function clean(problems) {
  assert.deepEqual(problems.errors, [], "no page or console errors");
  assert.deepEqual(problems.external, [], "no requests outside the app's own files");
}

async function downloadBytes(download) {
  return fs.promises.readFile(await download.path());
}

test("the export dialog opens from the present bar before Engagement JSON, and from the export menu", async t => {
  const s = await open(t, "#example=underwriting-current-state");
  if (!s) return;
  const p = s.page;
  await p.click("#tab-present");
  await p.waitForSelector(".present-bar");
  const order = await p.$$eval(".present-bar button", els => els.map(e => e.id));
  assert.ok(order.includes("pr-action-client-exports"));
  assert.equal(order.indexOf("pr-action-client-exports"), order.indexOf("pr-json") - 1);
  await p.click("#pr-action-client-exports");
  await p.waitForSelector("dialog[open]");
  assert.equal(await p.textContent("dialog[open] h2"), "Export for client tools");
  const titles = await p.$$eval("dialog[open] .export-section h3", els => els.map(e => e.textContent));
  assert.deepEqual(titles, ["PowerPoint deck", "BPMN 2.0 diagram", "Backlog"]);
  await p.keyboard.press("Escape");
  await p.waitForFunction(() => !document.querySelector("dialog[open]"));
  await p.click("#btn-menu");
  const menu = await p.$$eval("#app-menu button", els => els.map(e => e.id || e.textContent));
  assert.equal(menu[menu.findIndex(x => /Save as a new file/.test(x)) + 1], "menu-client-exports");
  await p.click("#menu-client-exports");
  await p.waitForSelector("dialog[open]");
  assert.equal(await p.textContent("dialog[open] h2"), "Export for client tools");
  await p.keyboard.press("Escape");
  clean(s.problems);
});

test("the BPMN export re-imports with the same steps, lanes and no warnings", async t => {
  const s = await open(t, "#example=underwriting-current-state");
  if (!s) return;
  const p = s.page;
  await p.click("#tab-present");
  await p.click("#pr-action-client-exports");
  await p.waitForSelector("dialog[open]");
  const [download] = await Promise.all([p.waitForEvent("download"), p.click("#exp-bpmn")]);
  assert.match(download.suggestedFilename(), /\.bpmn$/);
  const xmlText = (await downloadBytes(download)).toString("utf8");
  const result = await p.evaluate(text => {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const r = window.BPMVIZ.bpmn.importDocument(doc, { fileName: "roundtrip.bpmn" });
    return { nodeCount: r.engagement.models[0].nodes.length, edgeCount: r.engagement.models[0].edges.length,
      laneCount: r.engagement.models[0].lanes.length, warnings: r.warnings };
  }, xmlText);
  const original = await p.evaluate(() => {
    const m = window.BPMVIZ.app.store.get().models.find(x => x.id === "m-current");
    const nodeIds = new Set(m.nodes.filter(n => !n.removed).map(n => n.id));
    return { nodeCount: nodeIds.size, laneCount: m.lanes.length,
      edgeCount: m.edges.filter(e => !e.removed && nodeIds.has(e.from) && nodeIds.has(e.to)).length };
  });
  assert.deepEqual(result, Object.assign({ warnings: [] }, original));
  await p.keyboard.press("Escape");
  clean(s.problems);
});

test("the backlog export leaves out sensitive records and unreviewed AI drafts unless asked for", async t => {
  const s = await open(t, "#example=underwriting-current-state");
  if (!s) return;
  const p = s.page;
  await p.evaluate(() => {
    const B = window.BPMVIZ;
    B.app.dispatch("record/add", { record: { kind: "opportunity", title: "Ordinary opportunity", linkedModelId: "m-current", linkedNodeIds: ["scrub-sov-geocode"], opportunity: { effort: "M" } } });
    B.app.dispatch("record/add", { record: { kind: "opportunity", title: "Sensitive opportunity", sensitive: true, opportunity: { effort: "M" } } });
    // record/add does not accept a "generated" origin (that is set only by the AI drafting flow), so a
    // not-yet-reviewed AI draft is added directly, the way an applied AI result would leave it.
    const e = B.util.clone(B.app.store.get());
    e.records.push({
      id: "rec-draft-action", kind: "action", title: "Draft action", description: "", owner: "", status: "open", priority: "",
      linkedModelId: null, linkedModelVersion: null, linkedNodeIds: [], evidenceRefs: [], sensitive: false, includeInHandoff: true,
      opportunity: null, createdAt: e.updatedAt, updatedAt: e.updatedAt,
      generated: { task: "opportunities", provider: "claude", model: "test-model", surface: "cli", at: e.updatedAt, jobId: "job-1", plan: "commercial", reviewed: false, reviewedAt: "" }
    });
    const v = B.validate.validateEngagement(e);
    if (!v.ok) throw new Error(JSON.stringify(v.errors));
    B.app.store.replace(v.engagement, "test: add a not-yet-reviewed AI draft");
  });
  await p.click("#tab-present");
  await p.click("#pr-action-client-exports");
  await p.waitForSelector("dialog[open]");
  const [d1] = await Promise.all([p.waitForEvent("download"), p.click("#exp-backlog")]);
  assert.match(d1.suggestedFilename(), /backlog-jira\.csv$/);
  const csv1 = (await downloadBytes(d1)).toString("utf8");
  assert.match(csv1, /Ordinary opportunity/);
  assert.doesNotMatch(csv1, /Sensitive opportunity/);
  assert.doesNotMatch(csv1, /Draft action/);
  await p.check("#exp-sensitive");
  await p.check("#exp-unreviewed");
  await p.selectOption("#exp-format", "azure");
  const [d2] = await Promise.all([p.waitForEvent("download"), p.click("#exp-backlog")]);
  assert.match(d2.suggestedFilename(), /backlog-azure\.csv$/);
  const csv2 = (await downloadBytes(d2)).toString("utf8").replace(/^\ufeff/, "");
  assert.match(csv2, /^Work Item Type,Title,Description,Assigned To,Priority,State,Tags,Acceptance Criteria\r\n/);
  assert.match(csv2, /Ordinary opportunity/);
  assert.match(csv2, /Sensitive opportunity/);
  assert.match(csv2, /Draft action/);
  await p.selectOption("#exp-format", "xlsx");
  const [d3] = await Promise.all([p.waitForEvent("download"), p.click("#exp-backlog")]);
  assert.match(d3.suggestedFilename(), /backlog\.xlsx$/);
  const bytes = await downloadBytes(d3);
  const pkg = await zip.openZipAsync(bytes, { inflateRaw });
  assert.ok(pkg.names.includes("xl/workbook.xml"));
  await p.keyboard.press("Escape");
  clean(s.problems);
});

test("the backlog export says so and offers no download when nothing is recorded", async t => {
  const s = await open(t, "#example=underwriting-current-state");
  if (!s) return;
  const p = s.page;
  await p.click("#tab-present");
  await p.click("#pr-action-client-exports");
  await p.waitForSelector("dialog[open]");
  await p.click("#exp-backlog");
  await p.waitForFunction(() => document.querySelectorAll("dialog[open]").length === 2);
  const text = await p.$$eval("dialog[open]", els => els[els.length - 1].textContent);
  assert.match(text, /Nothing to export/);
  assert.match(text, /No opportunities or actions are recorded yet/);
  await p.keyboard.press("Escape");
  await p.keyboard.press("Escape");
  clean(s.problems);
});

test("a deck built before the Process workspace has drawn anything notes the missing diagram, not invents one", async t => {
  // ws=present skips the app's normal process-first landing, so the canvas is never drawn.
  const s = await open(t, "#example=underwriting-current-state&ws=present");
  if (!s) return;
  const p = s.page;
  await p.waitForSelector(".present-bar");
  await p.click("#pr-action-client-exports");
  await p.waitForSelector("dialog[open]");
  const [download] = await Promise.all([p.waitForEvent("download"), p.click("#exp-pptx")]);
  const bytes = await downloadBytes(download);
  const pkg = await zip.openZipAsync(bytes, { inflateRaw });
  assert.ok(!pkg.names.some(n => n.startsWith("ppt/media/")), "no image part when the canvas was never drawn");
  const slideTexts = await Promise.all(pkg.names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map(n => pkg.readText(n)));
  assert.ok(slideTexts.some(txt => /No process diagram is available/.test(txt)), "a missing diagram is noted, not invented");
  await p.keyboard.press("Escape");
  clean(s.problems);
});

test("a deck built once the Process workspace has drawn a diagram embeds it as a PNG", async t => {
  const s = await open(t, "#example=underwriting-current-state");
  if (!s) return;
  const p = s.page;
  await p.waitForSelector(".node");
  await p.click("#tab-present");
  await p.click("#pr-action-client-exports");
  await p.waitForSelector("dialog[open]");
  const [download] = await Promise.all([p.waitForEvent("download"), p.click("#exp-pptx")]);
  const bytes = await downloadBytes(download);
  const pkg = await zip.openZipAsync(bytes, { inflateRaw });
  const mediaName = pkg.names.find(n => n.startsWith("ppt/media/"));
  assert.ok(mediaName, "the process diagram is embedded once the canvas has been drawn");
  const imageBytes = await pkg.read(mediaName);
  assert.ok(imageBytes.length > 1000);
  assert.equal(imageBytes[0], 0x89, "a PNG signature byte");
  await p.keyboard.press("Escape");
  clean(s.problems);
});
