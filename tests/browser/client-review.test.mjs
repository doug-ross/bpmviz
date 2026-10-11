// Browser tests for client review packs: make a pack from the Present bar,
// open the HTML pack on its own from disk (no errors, no requests), answer
// it, save and reload the answers, import them back, apply, check the
// records tab, side panel and handoff, and undo. Also the Excel pack and
// responses that must be refused.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { launch, fileUrl, watch, root } from "../../tools/lib/browser.mjs";

const require = createRequire(import.meta.url);
const libFile = name => require(path.join(root, "webui", "js", "lib", name + ".js"));
const reviewPack = libFile("review-pack");
const xlsx = libFile("xlsx");

let browser = null;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aixray-review-"));
before(async () => { browser = await launch(); });
after(async () => {
  if (browser) await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function context(t) {
  if (!browser) { t.skip("Chrome or Edge is not installed"); return null; }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { window.showSaveFilePicker = undefined; });
  t.after(async () => { await ctx.close(); });
  return ctx;
}

async function openApp(t, hash) {
  const ctx = await context(t);
  if (!ctx) return null;
  const page = await ctx.newPage();
  const problems = watch(page);
  await page.goto(fileUrl() + (hash || ""));
  await page.waitForFunction(h => window.AIxRay && window.AIxRay.app && document.getElementById("app") && (!h || !!window.AIxRay.app.store), hash || "");
  return { ctx, page, problems };
}

function clean(problems) {
  assert.deepEqual(problems.errors, [], "no page or console errors");
  assert.deepEqual(problems.external, [], "no requests outside the files opened");
}

async function download(page, action) {
  const [d] = await Promise.all([page.waitForEvent("download"), action()]);
  return { name: d.suggestedFilename(), bytes: fs.readFileSync(await d.path()) };
}

/* Makes a pack from the Present bar and returns the downloaded file. */
async function makePack(p, format) {
  await p.click("#tab-present");
  await p.click("#pr-action-client-review");
  await p.waitForSelector("dialog[open] #cr-name");
  await p.fill("#cr-name", "Dana Reviewer");
  await p.fill("#cr-role", "Head of Underwriting Operations");
  if (format === "xlsx") await p.click("label:has(#cr-format-xlsx)");
  const file = await download(p, () => p.click("dialog[open] .dlg-foot .btn-primary"));
  await p.waitForFunction(() => !document.querySelector("dialog[open]"));
  return file;
}

async function addFindings(p) {
  await p.evaluate(() => {
    const app = window.AIxRay.app;
    app.dispatch("record/add", { record: { kind: "pain", title: "SOV rekeyed by hand", description: "Assistants retype broker spreadsheets.", linkedModelId: "m-current", linkedNodeIds: ["scrub-sov-geocode"] } });
    app.dispatch("record/add", { record: { kind: "pain", title: "Named underwriter is slow", sensitive: true, linkedModelId: "m-current", linkedNodeIds: ["technical-pricing-rating"] } });
  });
}

test("an HTML pack opens on its own, keeps answers in a file and imports back", async t => {
  const s = await openApp(t, "#example=underwriting-current-state");
  if (!s) return;
  const p = s.page;
  await p.waitForSelector(".node");
  await addFindings(p);
  await p.click("#tab-present");
  await p.click("#pr-action-client-review");
  await p.waitForSelector("dialog[open] #cr-name");
  assert.match(await p.textContent("#cr-summary"), /The form will list 36 items: 35 steps and 1 finding\./);
  assert.match(await p.textContent("dialog[open]"), /Sensitive findings are left out/);
  await p.click("label:has(#cr-inc-steps)");
  assert.match(await p.textContent("#cr-summary"), /1 item: 0 steps and 1 finding/);
  await p.click("label:has(#cr-inc-steps)");
  await p.click("dialog[open] .dlg-foot .btn-primary");
  assert.match(await p.textContent("dialog[open] .error-text"), /Enter the name/);
  await p.fill("#cr-name", "Dana Reviewer");
  await p.fill("#cr-role", "Head of Underwriting Operations");
  await p.fill("#cr-note", "Please answer by Friday.");
  const pack = await download(p, () => p.click("dialog[open] .dlg-foot .btn-primary"));
  assert.match(pack.name, /-review-dana-reviewer\.html$/);
  const stored = await p.evaluate(() => window.AIxRay.app.store.get().reviewPacks);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].items.length, 36);
  const html = pack.bytes.toString("utf8");
  assert.equal(/[^\x00-\x7f]/.test(html), false);
  const data = reviewPack.readPackHtml(html);
  assert.equal(data.packId, stored[0].id);
  const at = ref => data.items.findIndex(it => it.itemRef === ref);
  const iConfirm = at("step/m-current/check-clearance-dedup");
  const iDispute = at("step/m-current/scrub-sov-geocode");
  const iFinding = data.items.findIndex(it => it.kind === "record");
  assert.ok(iConfirm >= 0 && iDispute >= 0 && iFinding >= 0);

  // The pack, opened from disk in its own browser context.
  const packFile = path.join(tmp, "pack.html");
  fs.writeFileSync(packFile, pack.bytes);
  const pctx = await context(t);
  const pp = await pctx.newPage();
  const packProblems = watch(pp);
  await pp.goto(pathToFileURL(packFile).href);
  await pp.waitForSelector("#pack article.item");
  assert.equal(await pp.title(), "Process review: " + data.title);
  assert.equal((await pp.$$("#pack article.item")).length, 36);
  assert.match(await pp.textContent("#pack"), /Please answer by Friday\./);
  assert.equal(await pp.inputValue("#pack-name"), "Dana Reviewer");
  assert.match(await pp.textContent("#pack-progress"), /^0 of 36 items answered$/);
  await pp.click("label[for=pack-v-" + iConfirm + "-confirm]");
  await pp.click("label[for=pack-v-" + iDispute + "-dispute]");
  await pp.fill("#pack-c-" + iDispute, "Geocoding is done by the CAT team.");
  // Keyboard: focus the radio of the finding and choose with the arrow keys.
  await pp.focus("#pack-v-" + iFinding + "-confirm");
  await pp.keyboard.press("ArrowRight");
  await pp.keyboard.press("ArrowRight");
  assert.equal(await pp.isChecked("#pack-v-" + iFinding + "-unsure"), true);
  await pp.fill("#pack-c-" + iFinding, "Only for large schedules.");
  await pp.fill("#pack-general", "Mostly right.");
  assert.match(await pp.textContent("#pack-progress"), /^3 of 36 items answered$/);
  const saved = await download(pp, () => pp.click("#pack-save"));
  assert.match(saved.name, /^review-response-dana-reviewer-rp-[a-z0-9]+\.json$/);
  const response = JSON.parse(saved.bytes.toString("utf8"));
  assert.equal(response.schema, "aixray.review-response");
  assert.equal(response.packId, data.packId);
  assert.equal(response.engagementId, "eng-underwriting-current");
  assert.equal(response.format, "html");
  assert.equal(response.entries.length, 36);
  assert.deepEqual(response.entries[iDispute], { itemRef: "step/m-current/scrub-sov-geocode", verdict: "dispute", comment: "Geocoding is done by the CAT team." });
  assert.equal(response.entries.filter(x => x.verdict === "").length, 33);
  assert.match(await pp.textContent("#pack-status"), /Send this file to the team/);
  const storage = await pp.evaluate(() => { try { return localStorage.length + sessionStorage.length; } catch (_) { return 0; } });
  assert.equal(storage, 0, "the pack keeps nothing in the browser");
  clean(packProblems);

  // Load saved response resumes the review in a fresh copy of the page.
  const pp2 = await pctx.newPage();
  const problems2 = watch(pp2);
  await pp2.goto(pathToFileURL(packFile).href);
  await pp2.waitForSelector("#pack article.item");
  const wrong = Object.assign({}, response, { packId: "rp-another" });
  await pp2.setInputFiles("#pack-load-file", { name: "wrong.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(wrong)) });
  await pp2.waitForFunction(() => /different review form/.test(document.getElementById("pack-status").textContent));
  await pp2.setInputFiles("#pack-load-file", { name: saved.name, mimeType: "application/json", buffer: saved.bytes });
  await pp2.waitForFunction(() => /Loaded 3 answers/.test(document.getElementById("pack-status").textContent));
  assert.equal(await pp2.isChecked("#pack-v-" + iDispute + "-dispute"), true);
  assert.equal(await pp2.inputValue("#pack-c-" + iFinding), "Only for large schedules.");
  assert.equal(await pp2.inputValue("#pack-general"), "Mostly right.");
  assert.match(await pp2.textContent("#pack-progress"), /^3 of 36 items answered$/);
  clean(problems2);

  // Import into the app through Open.
  await p.setInputFiles("#file-input", { name: saved.name, mimeType: "application/json", buffer: saved.bytes });
  await p.waitForSelector("dialog[open] #cr-apply-validation");
  const dlg = await p.textContent("dialog[open]");
  assert.match(dlg, /From Dana Reviewer, Head of Underwriting Operations/);
  assert.match(dlg, /Changes from Not confirmed yet to Confirmed/);
  assert.match(dlg, /Changes from Not confirmed yet to Disputed/);
  assert.equal(await p.isChecked("#cr-apply-questions"), true);
  await p.click("dialog[open] .dlg-foot .btn-primary");
  await p.waitForFunction(() => !document.querySelector("dialog[open]"));
  const after = await p.evaluate(() => {
    const e = window.AIxRay.app.store.get();
    const node = id => e.models[0].nodes.find(n => n.id === id).provenance;
    return { reviews: e.reviews.length, applied: e.reviews[0].applied, confirm: node("check-clearance-dedup"), dispute: node("scrub-sov-geocode").validation,
      questions: e.records.filter(r => r.kind === "question").map(r => r.title), evidence: e.evidence.map(x => x.title) };
  });
  assert.equal(after.reviews, 1);
  assert.equal(after.applied.validations, 2);
  assert.equal(after.applied.questions, 2);
  assert.equal(after.confirm.validation, "validated");
  assert.ok(after.confirm.evidenceRefs.includes(after.applied.evidenceId));
  assert.equal(after.dispute, "disputed");
  assert.deepEqual(after.questions, ["Disputed in client review: Scrub SOV & Geocode", "Not confirmed in client review: SOV rekeyed by hand"]);
  assert.ok(after.evidence.some(x => /^Client review: Dana Reviewer, Head of Underwriting Operations/.test(x)));

  // Records tab.
  await p.click("#tab-records");
  await p.click("#rv-tab-client-review");
  assert.equal((await p.textContent("#rv-tab-client-review .count")).trim(), "1");
  const panel = await p.textContent("#rv-panel");
  assert.match(panel, /Review forms \(1\)/);
  assert.match(panel, /Reviews received \(1\)/);
  assert.match(panel, /1 confirmed, 1 disputed, 1 not sure/);
  assert.match(panel, /Latest answer per item \(3\)/);
  assert.equal(await p.isHidden("#rv-add"), true);
  const again = await download(p, () => p.click("#rv-panel button:has-text('Download again')"));
  assert.equal(reviewPack.readPackHtml(again.bytes.toString("utf8")).packId, data.packId, "the same pack ID");

  // Side panel on the disputed step.
  await p.click("#tab-process");
  await p.waitForSelector(".node");
  await p.focus('.pane .node[data-node="scrub-sov-geocode"]');
  await p.keyboard.press("Enter");
  await p.waitForSelector("#cr-drawer");
  const side = await p.textContent("#cr-drawer");
  assert.match(side, /Dispute/);
  assert.match(side, /Geocoding is done by the CAT team\./);
  assert.match(side, /This step is disputed\./);

  // Report: after the Sources part.
  await p.click("#tab-present");
  await p.click("#pr-handoff");
  await p.waitForSelector("#hd-client-review");
  const placed = await p.$eval("#handoff-doc", doc => {
    const kids = [...doc.children];
    const ev = kids.findIndex(k => k.tagName === "H2" && k.textContent === "Sources");
    return kids.findIndex(k => k.id === "hd-client-review") === ev + 2;
  });
  assert.equal(placed, true);
  assert.match(await p.textContent("#hd-client-review"), /steps 1 confirmed, 1 disputed and 0 not sure; findings 0 confirmed, 0 disputed and 1 not sure/);

  // One undo reverses the import.
  const undone = await p.evaluate(() => {
    const app = window.AIxRay.app;
    app.store.undo();
    const e = app.store.get();
    return { reviews: (e.reviews || []).length, validation: e.models[0].nodes.find(n => n.id === "scrub-sov-geocode").provenance.validation,
      questions: e.records.filter(r => r.kind === "question").length };
  });
  assert.deepEqual(undone, { reviews: 0, validation: "unvalidated", questions: 0 });
  assert.equal(await p.$("#hd-client-review"), null);
  clean(s.problems);
});

test("an Excel pack comes back filled in and applies to a locked baseline", async t => {
  const s = await openApp(t, "#example=underwriting-current-state");
  if (!s) return;
  const p = s.page;
  await p.waitForSelector(".node");
  await addFindings(p);
  await p.evaluate(() => window.AIxRay.app.dispatch("model/clone", { sourceModelId: "m-current", name: "Future state draft" }));
  const pack = await makePack(p, "xlsx");
  assert.match(pack.name, /\.xlsx$/);
  assert.equal(await p.evaluate(bytes => window.AIxRay.clientReview.isReviewWorkbook(new Uint8Array(bytes)), [...pack.bytes]), true);
  // The reviewer fills in the workbook; a re-save keeps the sheets but drops the list validation.
  const wb = await xlsx.readWorkbookAsync(pack.bytes, { inflateRaw: b => zlib.inflateRawSync(b) });
  const review = wb.sheets.find(x => x.name === "Review");
  const about = wb.sheets.find(x => x.name === "About");
  const row = ref => review.rows.findIndex(r => r[0] === ref);
  review.rows[row("step/m-current/check-clearance-dedup")][5] = "Confirm";
  review.rows[row("step/m-current/send-decline-letter")][5] = "disagree";
  review.rows[row("step/m-current/send-decline-letter")][6] = "Letters go out from the broker portal.";
  about.rows.find(r => r[0] === "Your name")[1] = "Lee Excel";
  const filled = await xlsx.workbookBytesAsync({ sheets: wb.sheets.map(x => ({ name: x.name, hidden: x.hidden, rows: x.rows })) }, { deflateRaw: b => zlib.deflateRawSync(b) });
  await p.setInputFiles("#file-input", { name: "filled-review.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(filled) });
  await p.waitForSelector("dialog[open] #cr-apply-validation");
  const dlg = await p.textContent("dialog[open]");
  assert.match(dlg, /From Lee Excel/);
  assert.match(dlg, /The baseline is locked because a future state is based on it/);
  await p.click("dialog[open] .dlg-foot .btn-primary");
  await p.waitForFunction(() => !document.querySelector("dialog[open]"));
  const e = await p.evaluate(() => {
    const x = window.AIxRay.app.store.get();
    return { locked: x.models[0].locked, source: x.reviews[0].source,
      v: ["check-clearance-dedup", "send-decline-letter"].map(id => x.models[0].nodes.find(n => n.id === id).provenance.validation),
      futureChanged: x.models[1].nodes.filter(n => n.lineage.change !== "unchanged").length };
  });
  assert.deepEqual(e, { locked: true, source: "xlsx", v: ["validated", "disputed"], futureChanged: 0 });
  // A workbook that is not a pack is left for other handlers.
  const plain = await xlsx.workbookBytesAsync({ sheets: [{ name: "Events", rows: [["case", "activity"], ["1", "Start"]] }] }, { deflateRaw: b => zlib.deflateRawSync(b) });
  assert.equal(await p.evaluate(bytes => window.AIxRay.clientReview.isReviewWorkbook(new Uint8Array(bytes)), [...plain]), false);
  clean(s.problems);
});

test("responses for another engagement or over the size limit are refused; an unknown pack is matched by IDs", async t => {
  const s = await openApp(t, "#example=underwriting-current-state");
  if (!s) return;
  const p = s.page;
  await p.waitForSelector(".node");
  const fixtures = path.join(root, "tests", "fixtures", "reviews");
  await p.setInputFiles("#file-input", path.join(fixtures, "other-engagement.review-response.json"));
  await p.waitForSelector("dialog[open]");
  assert.match(await p.textContent("dialog[open]"), /Review answers not imported[\s\S]*different project/);
  await p.click("dialog[open] .dlg-foot .btn-primary");
  await p.waitForFunction(() => !document.querySelector("dialog[open]"));
  const big = JSON.parse(fs.readFileSync(path.join(fixtures, "underwriting-current.review-response.json"), "utf8"));
  big.generalComment = "x".repeat(2 * 1024 * 1024 + 10);
  await p.setInputFiles("#file-input", { name: "big.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(big)) });
  await p.waitForSelector("dialog[open]");
  assert.match(await p.textContent("dialog[open]"), /larger than 2 MB, the most AIxRay can open/);
  await p.click("dialog[open] .dlg-foot .btn-primary");
  await p.waitForFunction(() => !document.querySelector("dialog[open]"));
  await p.setInputFiles("#file-input", path.join(fixtures, "underwriting-current.review-response.json"));
  await p.waitForSelector("dialog[open] #cr-apply-validation");
  assert.match(await p.textContent("dialog[open]"), /no record of the review form/);
  await p.click("#cr-apply-evidence");
  await p.click("dialog[open] .dlg-foot .btn-primary");
  await p.waitForFunction(() => !document.querySelector("dialog[open]"));
  const r = await p.evaluate(() => {
    const e = window.AIxRay.app.store.get();
    return { packId: e.reviews[0].packId, entries: e.reviews[0].entries.length, evidence: e.evidence.length, questions: e.records.length };
  });
  assert.deepEqual(r, { packId: null, entries: 4, evidence: 1, questions: 2 });
  clean(s.problems);
  // A saved engagement with a review shows the Client review tab when it is opened again.
  const saved = await p.evaluate(() => window.AIxRay.exporting.engagementToJson(window.AIxRay.app.store.get()));
  const s2 = await openApp(t, "");
  await s2.page.setInputFiles("#file-input", { name: "reviewed.engagement.json", mimeType: "application/json", buffer: Buffer.from(saved) });
  await s2.page.waitForSelector(".node");
  await s2.page.click("#tab-records");
  await s2.page.click("#rv-tab-client-review");
  assert.equal((await s2.page.textContent("#rv-tab-client-review .count")).trim(), "1");
  assert.match(await s2.page.textContent("#rv-panel"), /Dana Reviewer, Head of Underwriting Operations, Example Insurer/);
  assert.match(await s2.page.textContent("#rv-panel"), /Latest answer per item \(4\)/);
  clean(s2.problems);
});

test("the Client review tab follows the open engagement, and Download again leaves out records now sensitive", async t => {
  const s = await openApp(t, "#example=underwriting-current-state");
  if (!s) return;
  const p = s.page;
  await p.waitForSelector(".node");
  const tabIds = () => p.$$eval(".subtabs [role=tab]", els => els.map(e => e.id));
  await addFindings(p);
  await p.click("#tab-records");
  assert.equal((await tabIds()).includes("rv-tab-client-review"), false, "no tab before the engagement has a pack");
  // A pack made from the Present bar lists the tab; Undo removes it again.
  await makePack(p, "html");
  await p.click("#tab-records");
  assert.equal((await tabIds()).includes("rv-tab-client-review"), true);
  await p.evaluate(() => window.AIxRay.app.store.undo());
  assert.equal((await tabIds()).includes("rv-tab-client-review"), false, "undo of the only pack removes the tab");
  await makePack(p, "html");
  await p.click("#tab-records");
  assert.equal((await tabIds()).includes("rv-tab-client-review"), true);
  // An engagement with review data opened straight into Records lists the tab; a blank one does not.
  const saved = await p.evaluate(() => window.AIxRay.exporting.engagementToJson(window.AIxRay.app.store.get()));
  await p.evaluate(json => window.AIxRay.app.loadEngagement(window.AIxRay.validate.validateEngagement(JSON.parse(json)).engagement, { ws: "records" }), saved);
  await p.waitForSelector("#rv-tab-client-review");
  const blank = await p.evaluate(json => {
    const e = JSON.parse(json);
    e.id = "eng-blank";
    e.reviewPacks = [];
    e.reviews = [];
    return JSON.stringify(e);
  }, saved);
  await p.evaluate(json => window.AIxRay.app.loadEngagement(window.AIxRay.validate.validateEngagement(JSON.parse(json)).engagement, { ws: "records" }), blank);
  await p.waitForFunction(() => !document.getElementById("rv-tab-client-review") && !!document.getElementById("rv-tab-records"));
  await p.evaluate(json => window.AIxRay.app.loadEngagement(window.AIxRay.validate.validateEngagement(JSON.parse(json)).engagement, { ws: "process" }), saved);
  await p.waitForSelector(".node");
  await p.click("#tab-records");
  await p.click("#rv-tab-client-review");
  // The finding in the pack is marked sensitive after the pack was made.
  const before = await p.evaluate(() => window.AIxRay.app.store.get().reviewPacks[0].items.length);
  await p.evaluate(() => {
    const app = window.AIxRay.app;
    const r = app.store.get().records.find(x => x.title === "SOV rekeyed by hand");
    app.dispatch("record/update", { id: r.id, patch: { sensitive: true } });
  });
  const again = await download(p, () => p.click("#rv-panel button:has-text('Download again')"));
  const html = again.bytes.toString("utf8");
  const data = reviewPack.readPackHtml(html);
  assert.equal(data.items.length, before - 1);
  assert.equal(data.items.some(it => it.kind === "record"), false);
  assert.equal(html.includes("SOV rekeyed by hand"), false);
  await p.waitForSelector("dialog[open]");
  assert.match(await p.textContent("dialog[open]"), /1 item of the 36 in the form was left out/);
  await p.click("dialog[open] .dlg-foot .btn-primary");
  await p.waitForFunction(() => !document.querySelector("dialog[open]"));
  clean(s.problems);
});
