// End-to-end browser test for the client-value features working together on
// the bundled underwriting current-state example and the sample event logs
// in docs/samples: import the baseline log through the wizard, see the
// dataset, observed scenarios and observed lens, model a value case on the
// observed share of cases (matrix and one-pager), send and read back both
// client review packs, export the deck, the BPMN file (re-imported) and the
// backlog, then import the after log and read the Benefits comparison.
// The app runs from disk; no AI provider is called, and the AI CLI
// variables point at the fakes in tests/fixtures/ai so nothing real could
// start even if a step reached for one.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { launch, fileUrl, watch, root } from "../../tools/lib/browser.mjs";

process.env.AIXRAY_CLAUDE_BIN = path.join(root, "tests", "fixtures", "ai", "fake-claude.mjs");
process.env.AIXRAY_CODEX_BIN = path.join(root, "tests", "fixtures", "ai", "fake-codex.mjs");

const require = createRequire(import.meta.url);
const lib = name => require(path.join(root, "webui", "js", "lib", name + ".js"));
const reviewPack = lib("review-pack");
const xlsx = lib("xlsx");
const zip = lib("zip");
const inflateRaw = (b, max) => zlib.inflateRawSync(b, max ? { maxOutputLength: max } : {});
const deflateRaw = b => zlib.deflateRawSync(b);
const BASELINE = path.join(root, "docs", "samples", "underwriting-baseline.csv");
const AFTER = path.join(root, "docs", "samples", "underwriting-after.csv");

let browser = null;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aixray-e2e-"));
before(async () => { browser = await launch(); });
after(async () => {
  if (browser) await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function clean(problems, what) {
  assert.deepEqual(problems.errors, [], "no page or console errors" + (what ? " in " + what : ""));
  assert.deepEqual(problems.external, [], "no requests outside the files opened" + (what ? " in " + what : ""));
}

async function download(page, action) {
  const [d] = await Promise.all([page.waitForEvent("download"), action()]);
  return { name: d.suggestedFilename(), bytes: fs.readFileSync(await d.path()) };
}

const atStep = (p, n) => p.waitForFunction(k => {
  const el = document.querySelector("dialog[open] .li-step-title");
  return el && el.textContent.startsWith("Step " + k + " of 5") && !document.getElementById("li-next").disabled;
}, n);

/* Runs the event-log wizard on one of the sample logs; returns the new dataset. */
async function importLog(p, file, role) {
  const before = await p.evaluate(() => (window.AIxRay.app.store.get().datasets || []).map(d => d.id));
  await p.setInputFiles("#file-input", { name: path.basename(file), mimeType: "text/csv", buffer: fs.readFileSync(file) });
  await p.waitForSelector("dialog[open] #li-preview");
  await p.click("#li-next");
  await atStep(p, 2);
  assert.equal(await p.inputValue("#li-mode"), "start-end");
  assert.equal(await p.inputValue("#li-format"), "iso");
  await p.click("#li-next");
  await atStep(p, 3);
  // Every activity in the sample logs carries the example's own step names, so all are confirmed.
  const rows = await p.$$eval("#li-map tbody tr", trs => trs.map(tr => ({ step: tr.querySelector("select").value, ok: tr.querySelector("input[type=checkbox]").checked })));
  assert.ok(rows.length >= 20);
  assert.ok(rows.every(r => r.step && r.ok), "every activity mapped and confirmed");
  assert.doesNotMatch(await p.textContent("#li-map-summary"), /waiting/);
  await p.click("#li-next");
  await atStep(p, 4);
  assert.equal(await p.inputValue("#li-calendar"), "business");
  assert.equal(await p.isChecked("#li-caseids-hashed"), true);
  if (role === "after") {
    await p.selectOption("#li-role", "after");
    assert.notEqual(await p.inputValue("#li-compare"), "", "the baseline is offered to compare with");
  }
  await p.click("#li-next");
  await atStep(p, 5);
  await p.click("#li-next");
  await p.waitForFunction(() => !document.querySelector("dialog[open]"));
  return p.evaluate(ids => window.AIxRay.app.store.get().datasets.find(d => !ids.includes(d.id)), before);
}

test("event log to value case, client review, exports and benefits on the underwriting example", async t => {
  if (!browser) { t.skip("Chrome or Edge is not installed"); return; }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(() => { window.showSaveFilePicker = undefined; });
  t.after(async () => { await ctx.close(); });
  const p = await ctx.newPage();
  const problems = watch(p);
  await p.goto(fileUrl() + "#example=underwriting-current-state");
  await p.waitForFunction(() => window.AIxRay && window.AIxRay.app && !!window.AIxRay.app.store);
  await p.waitForSelector(".node");

  // 1. The baseline log, through the wizard.
  const base = await importLog(p, BASELINE, "baseline");
  assert.equal(base.role, "baseline");
  assert.equal(base.cases.count, 260);
  assert.equal(base.dataStatus, "demonstration");
  assert.equal(base.timeBasis.calendar, "business");
  assert.equal(base.scenarioIds.length, 3);
  const scrub = base.steps.find(s => s.nodeId === "scrub-sov-geocode");
  assert.ok(scrub.duration.p50 > 180 && scrub.duration.p50 < 300, "the sample log's steps sit in working hours, so business-time durations are real: " + scrub.duration.p50);
  const stored = await p.evaluate(() => JSON.stringify(window.AIxRay.app.store.get()));
  assert.ok(!stored.includes("BASE-0001"), "no case IDs are stored");
  await p.waitForSelector("#rv-tab-event-logs[aria-selected=true]");
  assert.match(await p.textContent("#rv-panel"), /underwriting-baseline/);
  assert.match(await p.textContent("#rv-panel"), /260/);

  // 2. Observed scenarios and the observed lens.
  await p.click("#tab-process");
  await p.waitForSelector(".node");
  const scenarios = await p.$$eval("#pv-scenario option", os => os.map(o => o.textContent));
  assert.equal(scenarios.filter(x => /^Measured variant \d/.test(x)).length, 3, "three measured scenarios: " + scenarios.join(" | "));
  await p.selectOption("#pv-lens", "observed-share");
  assert.match(await p.textContent("#pv-lens-info"), /260 cases in underwriting-baseline/);
  assert.ok((await p.$$(".node .lens-bar[visibility=visible]")).length >= 20);
  await p.selectOption("#pv-lens", "observed-time");
  assert.match(await p.textContent("#pv-lens-info"), /business time/);

  // 3. A value case on the observed share of cases and observed durations.
  await p.evaluate(() => window.AIxRay.app.dispatch("record/add", { record: { kind: "opportunity", title: "Automate SOV scrub and triage",
    linkedModelId: "m-current", linkedNodeIds: ["scrub-sov-geocode", "appetite-capacity-triage"], opportunity: { intervention: "deterministic-automation", effort: "M" } } }));
  await p.click("#tab-records");
  await p.click("#rv-tab-opportunities");
  await p.click("text=Automate SOV scrub and triage");
  await p.waitForSelector("dialog[open] #bc-vc-share-source");
  await p.selectOption("#bc-vc-effort-source", "dataset");
  await p.selectOption("#bc-vc-share-source", "dataset");
  await p.selectOption("#bc-vc-dataset", base.id);
  assert.equal(await p.isHidden("#bc-vc-share-pct"), true, "no typed share when it comes from the log");
  await p.fill("#bc-vc-effort-pct", "50");
  await p.fill("#bc-vc-one-time", "80000");
  await p.selectOption("#bc-vc-confidence", "medium");
  await p.selectOption("#bc-vc-wave", "now");
  await p.waitForFunction(() => /Estimated at/.test(document.getElementById("bc-vc-preview").textContent));
  await p.click("dialog[open] .dlg-foot .btn-primary");
  await p.waitForFunction(() => !document.querySelector("dialog[open]"));
  const vc = await p.evaluate(() => window.AIxRay.app.store.get().records.find(r => r.title === "Automate SOV scrub and triage").opportunity);
  assert.equal(vc.wave, "now");
  assert.deepEqual([vc.valueCase.shareSource, vc.valueCase.effortSource, vc.valueCase.datasetId], ["dataset", "dataset", base.id]);
  assert.match(await p.textContent("#rv-panel table tbody tr td:nth-child(6)"), /\$[\d,]+(\.\d\d)? a year/);
  await p.click("#rv-oppview-matrix");
  await p.waitForSelector(".bc-matrix svg");
  assert.equal((await p.$$(".bc-dot")).length, 1);
  await p.click("#tab-present");
  await p.click("#pr-mode-business-case");
  await p.waitForSelector("#bc-portfolio");
  await p.selectOption("#bc-present-select", { label: "Automate SOV scrub and triage" });
  await p.waitForSelector("#bc-onepager");
  const onePager = await p.textContent("#bc-onepager");
  assert.match(onePager, /Business case: Automate SOV scrub and triage/);
  assert.match(onePager, /Scrub SOV & Geocode/);

  // 4. The HTML review pack, answered in its own page and imported back.
  await p.click("#pr-action-client-review");
  await p.waitForSelector("dialog[open] #cr-name");
  await p.fill("#cr-name", "Dana Reviewer");
  await p.fill("#cr-role", "Head of Underwriting Operations");
  const htmlPack = await download(p, () => p.click("dialog[open] .dlg-foot .btn-primary"));
  await p.waitForFunction(() => !document.querySelector("dialog[open]"));
  const data = reviewPack.readPackHtml(htmlPack.bytes.toString("utf8"));
  const at = ref => data.items.findIndex(it => it.itemRef === ref);
  const iConfirm = at("step/m-current/check-clearance-dedup"), iDispute = at("step/m-current/scrub-sov-geocode");
  assert.ok(iConfirm >= 0 && iDispute >= 0);
  const packFile = path.join(tmp, "pack.html");
  fs.writeFileSync(packFile, htmlPack.bytes);
  const pp = await ctx.newPage();
  const packProblems = watch(pp);
  await pp.goto(pathToFileURL(packFile).href);
  await pp.waitForSelector("#pack article.item");
  await pp.click("label[for=pack-v-" + iConfirm + "-confirm]");
  await pp.click("label[for=pack-v-" + iDispute + "-dispute]");
  await pp.fill("#pack-c-" + iDispute, "Geocoding is done by the CAT team.");
  const response = await download(pp, () => pp.click("#pack-save"));
  clean(packProblems, "the HTML pack");
  await pp.close();
  await p.setInputFiles("#file-input", { name: response.name, mimeType: "application/json", buffer: response.bytes });
  await p.waitForSelector("dialog[open] #cr-apply-validation");
  await p.click("dialog[open] .dlg-foot .btn-primary");
  await p.waitForFunction(() => !document.querySelector("dialog[open]"));
  let state = await p.evaluate(() => {
    const e = window.AIxRay.app.store.get();
    const v = id => e.models[0].nodes.find(n => n.id === id).provenance.validation;
    return { reviews: e.reviews.length, confirm: v("check-clearance-dedup"), dispute: v("scrub-sov-geocode") };
  });
  assert.deepEqual(state, { reviews: 1, confirm: "validated", dispute: "disputed" });

  // 5. The Excel review pack, filled in outside the app and imported back.
  await p.click("#tab-present");
  await p.click("#pr-action-client-review");
  await p.waitForSelector("dialog[open] #cr-name");
  await p.fill("#cr-name", "Lee Excel");
  await p.fill("#cr-role", "Underwriting manager");
  await p.click("label:has(#cr-format-xlsx)");
  const xlsxPack = await download(p, () => p.click("dialog[open] .dlg-foot .btn-primary"));
  await p.waitForFunction(() => !document.querySelector("dialog[open]"));
  assert.match(xlsxPack.name, /\.xlsx$/);
  const wb = await xlsx.readWorkbookAsync(xlsxPack.bytes, { inflateRaw: b => zlib.inflateRawSync(b) });
  const review = wb.sheets.find(x => x.name === "Review");
  const row = ref => review.rows.findIndex(r => r[0] === ref);
  review.rows[row("step/m-current/appetite-capacity-triage")][5] = "Confirm";
  review.rows[row("step/m-current/send-decline-letter")][5] = "Dispute";
  review.rows[row("step/m-current/send-decline-letter")][6] = "Letters go out from the broker portal.";
  const filled = await xlsx.workbookBytesAsync({ sheets: wb.sheets.map(x => ({ name: x.name, hidden: x.hidden, rows: x.rows })) }, { deflateRaw });
  await p.setInputFiles("#file-input", { name: "filled-review.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(filled) });
  await p.waitForSelector("dialog[open] #cr-apply-validation");
  assert.match(await p.textContent("dialog[open]"), /From Lee Excel/);
  await p.click("dialog[open] .dlg-foot .btn-primary");
  await p.waitForFunction(() => !document.querySelector("dialog[open]"));
  state = await p.evaluate(() => {
    const e = window.AIxRay.app.store.get();
    const v = id => e.models[0].nodes.find(n => n.id === id).provenance.validation;
    return { reviews: e.reviews.map(r => r.source), triage: v("appetite-capacity-triage"), decline: v("send-decline-letter") };
  });
  assert.deepEqual(state, { reviews: ["html", "xlsx"], triage: "validated", decline: "disputed" });

  // 6. Exports: the deck, the BPMN file (re-imported in the page) and the backlog.
  await p.click("#tab-process");
  await p.waitForSelector(".node");
  await p.click("#tab-present");
  await p.click("#pr-action-client-exports");
  await p.waitForSelector("dialog[open] #exp-pptx");
  const deck = await download(p, () => p.click("#exp-pptx"));
  assert.match(deck.name, /\.pptx$/);
  const pkg = await zip.openZipAsync(deck.bytes, { inflateRaw });
  assert.ok(pkg.names.includes("ppt/presentation.xml"));
  assert.ok(pkg.names.some(n => n.startsWith("ppt/media/")), "the process diagram is in the deck");
  const slides = await Promise.all(pkg.names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map(n => pkg.readText(n)));
  assert.ok(slides.some(x => x.includes("Automate SOV scrub and triage")), "the opportunity is in the deck");
  const bpmn = await download(p, () => p.click("#exp-bpmn"));
  assert.match(bpmn.name, /\.bpmn$/);
  const round = await p.evaluate(text => {
    const r = window.AIxRay.bpmn.importDocument(new DOMParser().parseFromString(text, "application/xml"), { fileName: "roundtrip.bpmn" });
    const m = window.AIxRay.app.store.get().models.find(x => x.id === "m-current");
    const ids = new Set(m.nodes.filter(n => !n.removed).map(n => n.id));
    return {
      back: { nodes: r.engagement.models[0].nodes.length, edges: r.engagement.models[0].edges.length, lanes: r.engagement.models[0].lanes.length, warnings: r.warnings },
      original: { nodes: ids.size, edges: m.edges.filter(e => !e.removed && ids.has(e.from) && ids.has(e.to)).length, lanes: m.lanes.length, warnings: [] }
    };
  }, bpmn.bytes.toString("utf8"));
  assert.deepEqual(round.back, round.original, "the BPMN file re-imports with the same steps, connectors and lanes");
  const backlog = await download(p, () => p.click("#exp-backlog"));
  assert.match(backlog.name, /backlog-jira\.csv$/);
  assert.match(backlog.bytes.toString("utf8"), /Epic,Automate SOV scrub and triage/);
  await p.keyboard.press("Escape");
  await p.waitForFunction(() => !document.querySelector("dialog[open]"));

  // 7. The after log, compared with the baseline: Benefits in the value workspace and the handoff.
  const afterDs = await importLog(p, AFTER, "after");
  assert.equal(afterDs.role, "after");
  assert.equal(afterDs.comparesToDatasetId, base.id);
  await p.click("#tab-value");
  await p.waitForSelector("#bv-section");
  const benefits = await p.textContent("#bv-section");
  assert.match(benefits, /underwriting-after compared to underwriting-baseline/);
  assert.match(benefits, /measured change/i);
  assert.doesNotMatch(benefits.replace(/not savings realized/g, ""), /savings realized/i, "a measured change is never called savings realized");
  const stepRow = await p.$$eval("#bv-section table tbody tr", trs => {
    const tr = trs.find(x => /Scrub SOV & Geocode/.test(x.cells[0].textContent));
    return tr ? tr.cells[1].textContent : "";
  });
  assert.match(stepRow, /\([-\u2212]\d+(\.\d+)?%\)/, "the scrub step got faster: " + stepRow);
  const evr = await p.$$eval("#bv-section table", tables => {
    const t = tables.find(x => /Expected versus measured/.test(x.querySelector("caption").textContent));
    return t ? [...t.querySelectorAll("tbody tr")].map(tr => [...tr.cells].map(c => c.textContent)) : [];
  });
  assert.equal(evr.length, 1);
  assert.match(evr[0][0], /Automate SOV scrub and triage/);
  assert.match(evr[0][1], /hours/);
  assert.match(evr[0][2], /hours/);
  assert.match(evr[0][2], /Illustrative/, "a measured figure from demonstration logs is illustrative, not observed");
  assert.match(evr[0][3], /Met|Partially met|Not yet/);
  await p.click("#tab-present");
  await p.click("#pr-handoff");
  await p.waitForSelector("#handoff-doc");
  const handoff = await p.textContent("#handoff-doc");
  assert.match(handoff, /Benefits measured/);
  assert.match(handoff, /Automate SOV scrub and triage: (Met|Partially met|Not yet)/);
  clean(problems, "the app");
});
