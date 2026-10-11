// Browser tests for the event-log import (mining slice): a CSV through the
// file input, mapping, options, adding, the Event logs tab, the lenses, the
// step section, the value model and the handoff, and undo; an Excel log
// through the menu with an AI mapping result loaded in the wizard.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { launch, fileUrl, watch, root } from "../../tools/lib/browser.mjs";

const require = createRequire(import.meta.url);
const lib = name => require(path.join(root, "webui", "js", "lib", name + ".js"));
const ai = lib("ai-results");
const xlsx = lib("xlsx");
const csv = lib("csv");
const LOG = path.join(root, "tests", "fixtures", "logs", "underwriting.csv");

let browser = null;
before(async () => { browser = await launch(); });
after(async () => { if (browser) await browser.close(); });

async function open(t, hash) {
  if (!browser) { t.skip("Chrome or Edge is not installed"); return null; }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(fileUrl() + (hash || ""));
  await page.waitForFunction(() => window.AIxRay && window.AIxRay.app && document.getElementById("app"));
  if (hash) await page.waitForFunction(() => !!window.AIxRay.app.store);
  t.after(async () => { await context.close(); });
  return { page, problems };
}

function clean(problems) {
  assert.deepEqual(problems.errors, [], "no page or console errors");
  assert.deepEqual(problems.external, [], "no requests outside the app's own files");
}

const atStep = (p, n) => p.waitForFunction(k => {
  const el = document.querySelector("dialog[open] .li-step-title");
  return el && el.textContent.startsWith("Step " + k + " of 5") && !document.getElementById("li-next").disabled;
}, n);

async function undo(p) {
  await p.click("#btn-menu");
  await p.click("#app-menu button:has-text('Undo last change')");
}

test("a CSV log is mapped, measured and added in one step, shows everywhere, and undo removes it", async t => {
  const s = await open(t, "#example=underwriting-current-state");
  if (!s) return;
  const p = s.page;
  await p.waitForSelector(".node");
  const tabsBefore = await p.evaluate(() => window.AIxRay.ext.list("recordsTab").map(x => x.id));
  assert.deepEqual(tabsBefore, [], "the Event logs tab appears only with event logs");
  await p.setInputFiles("#file-input", { name: "underwriting.csv", mimeType: "text/csv", buffer: fs.readFileSync(LOG) });
  await p.waitForSelector("dialog[open] #li-preview");
  assert.equal(await p.$$eval("#li-preview tbody tr", rows => rows.length), 20);
  assert.match(await p.textContent("dialog[open] .facts"), /underwriting\.csv/);
  assert.equal(await p.inputValue("#li-delimiter"), ",");

  await p.click("#li-next");
  await atStep(p, 2);
  assert.equal(await p.inputValue("#li-mode"), "start-end");
  assert.equal(await p.inputValue("#li-col-case"), "0");
  assert.equal(await p.inputValue("#li-format"), "iso");
  assert.match(await p.textContent("#li-format-note"), /Detected: year first/);
  assert.match(await p.textContent("#li-format-note"), /is read as 2026-02-02/);

  await p.click("#li-next");
  await atStep(p, 3);
  const rows = await p.$$eval("#li-map tbody tr", trs => trs.map(tr => ({
    name: tr.querySelector(".title-cell").textContent, step: tr.querySelector("select").value,
    ok: tr.querySelector("input[type=checkbox]").checked, how: tr.cells[4].textContent })));
  const fuzzyRow = rows.findIndex(r => r.name === "Check clearance and dedupe");
  assert.equal(rows[fuzzyRow].step, "check-clearance-dedup");
  assert.equal(rows[fuzzyRow].ok, false, "a similar name waits for its own tick");
  assert.match(rows[fuzzyRow].how, /Similar name \(\d+% alike\), not ticked/);
  assert.equal(rows.find(r => r.name === "Email the broker").step, "");
  assert.ok(rows.filter(r => r.ok).length >= 20, "same names are ticked already");
  assert.match(await p.textContent("#li-map-summary"), /1 suggestion is waiting for a tick/);
  await p.check("#li-ok-" + fuzzyRow);
  assert.doesNotMatch(await p.textContent("#li-map-summary"), /waiting/);
  assert.equal(await p.locator("#li-ask-ai").count(), 0, "no AI button when the app is opened from disk");

  await p.click("#li-next");
  await atStep(p, 4);
  assert.equal(await p.inputValue("#li-name"), "underwriting");
  assert.equal(await p.isChecked("#li-caseids-hashed"), true);
  assert.equal(await p.inputValue("#li-calendar"), "business", "the engagement's time basis is the default");
  assert.equal(await p.inputValue("#li-status-sel"), "demonstration", "a demonstration engagement gives demonstration data");
  assert.match(await p.textContent("#li-ends"), /Deliver Policy Package to Broker/);
  await p.selectOption("#li-scenarios", "2");
  await p.selectOption("#li-resources", "counted");

  await p.click("#li-next");
  await atStep(p, 5);
  const summary = await p.textContent("#li-summary");
  assert.match(summary, /Cases measured13, 1 left out/);
  assert.match(summary, /Annualized volume/);
  const warnings = await p.textContent("#li-warnings");
  assert.match(warnings, /no connector path in the model/);
  assert.match(warnings, /does not end at an end step/);
  assert.equal(await p.textContent("#li-next"), "Add the event log");
  const revision = await p.evaluate(() => window.AIxRay.app.store.get().revision);
  await p.click("#li-next");
  await p.waitForFunction(() => !document.querySelector("dialog[open]"));

  await p.waitForSelector("#rv-tab-event-logs[aria-selected=true]");
  assert.match(await p.textContent("#rv-tab-event-logs"), /Event logs\s*1/);
  const e = await p.evaluate(() => window.AIxRay.app.store.get());
  assert.equal(e.revision, revision + 1, "one change");
  assert.equal(e.datasets.length, 1);
  const d = e.datasets[0];
  assert.deepEqual([d.cases.count, d.dataStatus, d.source.caseIds, d.source.resources, d.timeBasis.calendar], [13, "demonstration", "hashed", "counted", "business"]);
  assert.equal(d.mapping.find(m => m.activity === "Check clearance and dedupe").method, "fuzzy");
  assert.equal(d.scenarioIds.length, 2);
  const made = e.scenarios.filter(x => d.scenarioIds.includes(x.id));
  assert.ok(made.every(x => x.provenance === "illustrative" && /^Case [0-9a-f]{8}$/.test(x.observedFrom.caseLabel)));
  const text = JSON.stringify(e);
  assert.ok(!text.includes("SUB-1001") && !text.includes("Ops A") && !text.includes("UW 1"), "no case IDs or resource names are stored");
  assert.match(await p.textContent("#rv-panel"), /Median cycle time/);
  assert.match(await p.textContent("#rv-panel details"), /Check clearance and dedupe/);

  // Process: the lens and the step section.
  await p.click("#tab-process");
  await p.waitForSelector(".node");
  await p.selectOption("#pv-lens", "observed-share");
  assert.match(await p.textContent("#pv-lens-info"), /Observed share of cases: .* of \d+ activities appear in the log/);
  assert.match(await p.textContent("#pv-lens-info"), /13 cases in underwriting/);
  assert.ok((await p.$$(".node .lens-bar[visibility=visible]")).length >= 20);
  await p.selectOption("#pv-lens", "observed-time");
  assert.match(await p.textContent("#pv-lens-info"), /Median time per visit in business time/);
  await p.waitForSelector("#drawer-event-log");
  assert.match(await p.textContent("#drawer-event-log"), /Median cycle time/);
  await p.focus('.pane .node[data-node="scrub-sov-geocode"]');
  await p.keyboard.press("Enter");
  await p.waitForSelector("#drawer-observed");
  assert.match(await p.textContent("#drawer-observed"), /Cases10 of 13 \(76\.9%\)/, "the three declined cases skip this step");
  assert.match(await p.textContent("#drawer-observed"), /Duration, start to end/);

  // Value: observed inputs, copied with their basis.
  await p.click("#tab-value");
  await p.waitForSelector("#vv-observed");
  assert.match(await p.textContent("#vv-observed"), /per year/);
  await p.click("#vv-observed button");
  await p.waitForSelector("dialog[open] #ev-volume");
  assert.equal(await p.isChecked("#ev-volume"), true);
  await p.click("dialog[open] .dlg-foot .btn-primary");
  await p.waitForFunction(() => !document.querySelector("dialog[open]"));
  const vol = await p.evaluate(() => window.AIxRay.app.store.get().assumptions.find(a => a.key === "annualVolume"));
  assert.equal(vol.status, "illustrative");
  assert.match(vol.source, /^Event log underwriting\.csv, 2026-02-\d\d to 2026-\d\d-\d\d, 13 cases$/);

  // Present: the handoff lists the log after the scope.
  await p.click("#tab-present");
  await p.click("#pr-handoff");
  await p.waitForSelector("#handoff-event-logs");
  const placed = await p.$eval("#handoff-doc", doc => {
    const kids = [...doc.children];
    const scope = kids.findIndex(k => k.tagName === "H2" && k.textContent === "Scope");
    return kids[scope + 2].textContent;
  });
  assert.equal(placed, "Event logs (1)");

  // Undo the value copy, then the import: the log, its scenarios and the tab go.
  await undo(p);
  await undo(p);
  await p.waitForFunction(() => !(window.AIxRay.app.store.get().datasets || []).length);
  const back = await p.evaluate(() => ({ scenarios: window.AIxRay.app.store.get().scenarios.length, tabs: window.AIxRay.ext.list("recordsTab").map(x => x.id) }));
  assert.deepEqual(back, { scenarios: 1, tabs: [] });
  clean(s.problems);
});

test("an Excel log from the menu takes an AI mapping result, and original case IDs need a tick", async t => {
  const s = await open(t, "#example=underwriting-current-state");
  if (!s) return;
  const p = s.page;
  await p.waitForSelector(".node");
  const table = csv.parse(fs.readFileSync(LOG, "utf8")).rows;
  const serial = text => Date.parse(text.replace(" ", "T") + ":00Z") / 86400000 + 25569;
  const sheetRows = [["Report: underwriting events"], []].concat([table[0]], table.slice(1).map(r => [r[0], r[1], { date: serial(r[2]) }, { date: serial(r[3]) }, r[4]]));
  const bytes = await xlsx.workbookBytesAsync({ sheets: [{ name: "Notes", rows: [["Exported for the workshop"]] }, { name: "Events", rows: sheetRows }] },
    { deflateRaw: b => new Uint8Array(zlib.deflateRawSync(b)) });

  await p.click("#btn-menu");
  const menu = await p.$$eval("#app-menu button", els => els.map(e => e.id || e.textContent));
  assert.equal(menu[menu.findIndex(x => /Import a BPMN file/.test(x)) + 1], "menu-event-log");
  await p.click("#menu-event-log");
  await p.waitForSelector("dialog[open] #li-choose");
  const [chooser] = await Promise.all([p.waitForEvent("filechooser"), p.click("#li-choose")]);
  await chooser.setFiles({ name: "events.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(bytes) });
  await p.waitForSelector("#li-sheet");
  assert.equal(await p.inputValue("#li-sheet"), "1", "the first sheet with a header is chosen");
  assert.match(await p.textContent("dialog[open] .facts"), /header in row 3/);
  await p.click("#li-next");
  await atStep(p, 2);
  assert.equal(await p.inputValue("#li-format"), "serial");
  assert.match(await p.textContent("#li-format-note"), /Excel date .* is read as 2026-02-02 10:41/);
  await p.click("#li-next");
  await atStep(p, 3);

  const e = await p.evaluate(() => window.AIxRay.app.store.get());
  const result = ai.makeEnvelope({
    task: "log-mapping", engagementId: e.id, engagementRevision: e.revision, baselineModelId: "m-current",
    generated: { provider: "claude", model: "fake", surface: "cli", at: "2026-03-01T00:00:00Z", jobId: "job-1", plan: "commercial" },
    dataHandling: { confidentiality: e.meta.confidentiality, dataStatus: e.meta.dataStatus, approvalConfirmed: true },
    payload: { mappings: [
      { activity: "Email the broker", nodeId: "deliver-quote-to-broker", confidence: "low", rationale: "Both send something to the broker." },
      { activity: "Check clearance and dedupe", nodeId: "check-clearance-dedup", confidence: "high", rationale: "Same check." },
      { activity: "Scrub SOV & Geocode", nodeId: "appetite-capacity-triage", confidence: "low", rationale: "Wrong on purpose." },
      { activity: "Made up", nodeId: "send-decline-letter", confidence: "low", rationale: "" }
    ] }
  });
  const [chooser2] = await Promise.all([p.waitForEvent("filechooser"), p.click("#li-load-ai")]);
  await chooser2.setFiles({ name: "uw.log-mapping.ai-result.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(result)) });
  await p.waitForSelector("#ai-apply");
  assert.match(await p.textContent("dialog[open] .ai-items"), /was not sent to the assistant/);
  await p.click("#ai-select-all");
  assert.equal(await p.textContent("#ai-apply"), "Use 3 selected");
  await p.click("#ai-apply");
  await p.waitForFunction(() => document.querySelectorAll("dialog[open]").length === 1);
  await atStep(p, 3);
  const mail = await p.$$eval("#li-map tbody tr", trs => {
    const tr = trs.find(x => x.querySelector(".title-cell").textContent === "Email the broker");
    return { step: tr.querySelector("select").value, ok: tr.querySelector("input[type=checkbox]").checked, how: tr.cells[4].textContent, why: tr.cells[0].textContent };
  });
  assert.deepEqual([mail.step, mail.ok], ["deliver-quote-to-broker", false]);
  assert.match(mail.how, /Suggested by AI, not ticked/);
  assert.match(mail.why, /Both send something/);
  const idx = await p.$$eval("#li-map tbody tr", trs => trs.findIndex(x => x.querySelector(".title-cell").textContent === "Email the broker"));
  await p.check("#li-ok-" + idx);

  await p.click("#li-next");
  await atStep(p, 4);
  await p.check("#li-caseids-original");
  await p.selectOption("#li-scenarios", "1");
  await p.click("#li-next");
  assert.match(await p.textContent("#li-error"), /Tick the box to keep the original case IDs/);
  await p.check("#li-keep-ids");
  await p.click("#li-next");
  await atStep(p, 5);
  assert.match(await p.textContent("#li-summary"), /except the scenario case names/);
  await p.click("#li-next");
  await p.waitForFunction(() => !document.querySelector("dialog[open]"));
  const d = await p.evaluate(() => window.AIxRay.app.store.get().datasets[0]);
  assert.equal(d.source.format, "xlsx");
  assert.equal(d.mapping.find(m => m.activity === "Email the broker").method, "ai");
  assert.equal(d.mapping.find(m => m.activity === "Scrub SOV & Geocode").method, "exact", "an AI proposal does not replace a ticked row");
  assert.equal(d.mapping.find(m => m.activity === "Check clearance and dedupe").method, "ignored", "an AI proposal replaces an unticked suggestion, which still needs a tick");
  const label = await p.evaluate(id => window.AIxRay.app.store.get().scenarios.find(x => x.observedFrom && x.observedFrom.datasetId === id).observedFrom.caseLabel, d.id);
  assert.match(label, /^SUB-\d{4}$/);

  // A mapping result opened on its own changes nothing and says where it belongs.
  await p.setInputFiles("#file-input", { name: "uw.log-mapping.ai-result.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(result)) });
  await p.waitForSelector("dialog[open]");
  assert.match(await p.textContent("dialog[open]"), /Open this mapping from the event-log import/);
  await p.click("dialog[open] .dlg-foot .btn-primary");

  // Edit and delete from the Event logs tab.
  await p.click("#tab-records");
  await p.click("#rv-tab-event-logs");
  await p.click("#el-edit-" + d.id);
  await p.fill("#el-name", "Underwriting, February");
  await p.selectOption("#el-role", "after");
  await p.click("dialog[open] .dlg-foot .btn-primary");
  await p.waitForFunction(() => !document.querySelector("dialog[open]"));
  assert.match(await p.textContent("#rv-panel"), /Underwriting, February/);
  assert.match(await p.textContent("#rv-panel"), /After the change/);
  await p.click("#el-delete-" + d.id);
  assert.equal(await p.isChecked("#el-delete-scenarios"), true);
  await p.click("dialog[open] .dlg-foot .btn-danger");
  await p.waitForFunction(() => !(window.AIxRay.app.store.get().datasets || []).length);
  assert.equal(await p.evaluate(() => window.AIxRay.app.store.get().scenarios.length), 1, "its scenario went with it");
  clean(s.problems);
});

test("a log opened with no engagement asks for one first", async t => {
  const s = await open(t, "");
  if (!s) return;
  const p = s.page;
  await p.setInputFiles("#file-input", { name: "underwriting.csv", mimeType: "text/csv", buffer: fs.readFileSync(LOG) });
  await p.waitForSelector("dialog[open]");
  assert.match(await p.textContent("dialog[open]"), /Open an engagement first/);
  const accept = await p.evaluate(() => {
    const input = document.getElementById("file-input");
    input.click = () => {};
    window.AIxRay.app.openPicker();
    return input.accept;
  });
  assert.match(accept, /\.csv/);
  assert.match(accept, /\.xlsx/);
  clean(s.problems);
});
