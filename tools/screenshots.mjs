#!/usr/bin/env node
/*
 * Captures the README screenshots into docs/screenshots/.
 *   node tools/screenshots.mjs
 * Uses the installed Chrome or Edge. The records added here are illustrative.
 */
import fs from "node:fs";
import path from "node:path";
import { launch, fileUrl, watch, root } from "./lib/browser.mjs";

const OUT = path.join(root, "docs", "screenshots");
fs.mkdirSync(OUT, { recursive: true });
const browser = await launch();
if (!browser) { console.error("Chrome or Edge is needed to capture screenshots."); process.exit(1); }
const W = 1440, H = 900;

async function page(hash, opts) {
  const context = await browser.newContext(Object.assign({ viewport: { width: W, height: H }, deviceScaleFactor: 1 }, opts || {}));
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
  const p = await context.newPage();
  const problems = watch(p);
  await p.goto(fileUrl() + hash);
  await p.waitForFunction(() => window.BPMVIZ && window.BPMVIZ.app);
  if (/example=/.test(hash)) await p.waitForFunction(() => !!window.BPMVIZ.app.store);
  await p.waitForTimeout(600);
  return { p, context, problems };
}

async function shot(p, name) {
  await p.waitForTimeout(350);
  await p.screenshot({ path: path.join(OUT, name) });
  console.log("captured " + name);
}

const seedUnderwriting = () => {
  const a = window.BPMVIZ.app;
  a.dispatch("evidence/add", { evidence: { title: "Workshop interview: underwriting operations", locator: "Session 1, clearance and SOV intake", extractedFact: "SOV cleanup takes four to eight hours on large schedules; five brokers send most incomplete SOVs.", status: "validated", reviewer: "UW Ops Manager", reviewDate: "2026-09-24" } });
  const ev = a.store.get().evidence.find(e => e.title.startsWith("Workshop interview")).id;
  const add = r => a.dispatch("record/add", { record: Object.assign({ linkedModelId: "m-current" }, r) });
  add({ kind: "pain", title: "SOV quality varies widely by broker", description: "Completeness of COPE data and addresses depends on the broker; the worst schedules need a full day of cleanup.", owner: "UW Ops Manager", linkedNodeIds: ["scrub-sov-geocode"], evidenceRefs: [ev], priority: "high" });
  add({ kind: "opportunity", title: "Standard SOV template for the top five brokers", owner: "Head of UW Operations", status: "in-progress", linkedNodeIds: ["scrub-sov-geocode", "ingest-sov-into-cat-platform"], evidenceRefs: [ev],
    opportunity: { intervention: "standardize", simplerAlternative: "A template removes most cleanup before any automation is needed.", expectedBenefit: "Less rework in scrub and CAT ingest; fewer geocoding warnings.", effort: "M", risk: "Brokers may not adopt it without a commercial reason.", validationAction: "Sample 20 recent submissions from the five brokers and time the cleanup." } });
  add({ kind: "question", title: "What drives the four-day facultative market wait?", description: "Is it market response time, slip quality, or internal follow-up?", owner: "Ceded reinsurance lead", linkedNodeIds: ["obtain-fac-binder-from-market"] });
  add({ kind: "decision", title: "Keep OFAC sign-off with a named compliance reviewer", status: "done", owner: "Compliance", linkedNodeIds: ["validate-subjectivities-ofac"] });
  add({ kind: "action", title: "Pull clearance timestamps for the last quarter", owner: "UW Ops analyst", priority: "medium", linkedNodeIds: ["check-clearance-dedup"] });
  add({ kind: "assumption", title: "Survey scheduling adds two business days on average", owner: "Risk engineering", linkedNodeIds: ["perform-on-site-loss-prevention-survey"] });
};

// 1. Start screen
{
  const { p, context } = await page("");
  await shot(p, "01-start.png");
  await context.close();
}

// 2-4. Process workspace: replay, step panel, capture
{
  const { p, context, problems } = await page("#example=underwriting&scenario=case-3");
  await p.evaluate(seedUnderwriting);
  await p.evaluate(() => {
    const a = window.BPMVIZ.app;
    a.view.t = 8200;
    a.processView.selectNode("m-current", "obtain-fac-binder-from-market", { center: true, silent: true });
  });
  await p.evaluate(() => window.BPMVIZ.app.processView.camera.focusOn(window.BPMVIZ.app.processView.panes[0].diagram, "obtain-fac-binder-from-market", 0.8));
  await p.click("#pv-scrub");
  await p.evaluate(() => { const s = document.getElementById("pv-scrub"); s.value = String(Math.round(8200 / 15360 * 1000)); s.dispatchEvent(new Event("input")); });
  await shot(p, "02-process-step.png");
  await p.evaluate(() => window.BPMVIZ.app.processView.selectNode("m-current", "scrub-sov-geocode", { tab: "capture", center: true, silent: true }));
  await p.check("input[name=cap-kind][value=question]", { force: true });
  await p.fill("#cap-title", "Which brokers send most of the incomplete SOVs?");
  await p.fill("#cap-owner", "UW Ops Manager");
  await p.evaluate(() => { document.getElementById("pv-side").scrollTop = 230; });
  await shot(p, "03-capture.png");
  await p.evaluate(() => window.BPMVIZ.app.processView.closeDrawer());
  await p.selectOption("#pv-display", "c:m-future");
  await p.selectOption("#pv-lens", "time");
  await p.evaluate(() => { const s = document.getElementById("pv-scrub"); s.value = String(Math.round(6800 / 15360 * 1000)); s.dispatchEvent(new Event("input")); });
  await p.evaluate(() => {
    const pv = window.BPMVIZ.app.processView;
    pv.camera.readable();
    pv.camera.focusOn(pv.panes[0].diagram, "risk-insights-reunited", 0.7);
  });
  await shot(p, "05-compare.png");
  await p.click("#tab-records");
  await shot(p, "06-records.png");
  await p.click("#rv-tab-opportunities");
  await shot(p, "07-opportunities.png");
  await p.click("#tab-present");
  await p.click("#pr-handoff");
  await shot(p, "10-handoff.png");
  if (problems.errors.length || problems.external.length) console.warn(problems);
  await context.close();
}

// 4. Rework and SLA: the Payroll Variance sample at minute 9,100
{
  const { p, context } = await page("#example=rpa-delivery&scenario=sc-pay004");
  await p.selectOption("#pv-lens", "sla");
  await p.evaluate(() => window.BPMVIZ.app.processView.selectNode("m-current", "developBot", { center: true, silent: true }));
  await p.evaluate(() => window.BPMVIZ.app.processView.camera.focusOn(window.BPMVIZ.app.processView.panes[0].diagram, "qa", 0.85));
  await shot(p, "04-rework-sla.png");
  await context.close();
}

// 8-9. Value model: reconciliation and sensitivity
{
  const { p, context } = await page("#example=underwriting&scenario=case-1&ws=value");
  await p.evaluate(() => { document.getElementById("vv-res").scrollIntoView({ block: "start" }); document.querySelector("#ws-value .ws-scroll").scrollBy(0, -16); });
  await shot(p, "08-value.png");
  await p.evaluate(() => document.getElementById("vv-sens").scrollIntoView({ block: "start" }));
  await p.evaluate(() => document.querySelector("#ws-value .ws-scroll").scrollBy(0, -16));
  await shot(p, "09-sensitivity.png");
  await context.close();
}

// 11. Future-state draft with tracked changes
{
  const { p, context } = await page("#example=underwriting-current-state");
  await p.evaluate(() => {
    const a = window.BPMVIZ.app;
    const { modelId } = a.store.dispatch("model/clone", { sourceModelId: "m-current", name: "Future state draft" });
    const draft = () => a.store.get().models.find(m => m.id === modelId);
    const edge = draft().edges.find(e => e.from === "scrub-sov-geocode");
    a.store.dispatch("model/insertStep", { modelId, edgeId: edge.id, label: "Spot-check extracted SOV fields", rationale: "Keep a human check on low-confidence rows." });
    a.store.dispatch("node/update", { modelId, nodeId: "scrub-sov-geocode", patch: { label: "Extract and scrub SOV with tooling", rationale: "Extraction tool pre-fills COPE fields." } });
    a.store.dispatch("model/removeStep", { modelId, nodeId: "assign-to-underwriter", rationale: "Routing rules assign by geography and TIV band." });
    a.view.display = "c:" + modelId;
    a.processView.onEngagementChange({ type: "model/view" });
  });
  await p.waitForTimeout(400);
  await p.evaluate(() => {
    const pv = window.BPMVIZ.app.processView;
    pv.selectNode("m-future-draft", "scrub-sov-geocode", { center: true, silent: true });
  });
  await shot(p, "11-future-draft.png");
  await context.close();
}

// 12. Dark theme
{
  const { p, context } = await page("#example=rpa-delivery&scenario=sc-stm005");
  await p.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await p.evaluate(() => window.BPMVIZ.app.processView.camera.readable());
  await shot(p, "12-dark.png");
  await context.close();
}

// 13. Reviewing an AI result file: suggestions Claude Code drafted for the demonstration example
{
  const { p, context } = await page("#example=underwriting-current-state&ws=records");
  await p.setInputFiles("#file-input", path.join(root, "tests", "fixtures", "ai", "underwriting.opportunities.ai-result.json"));
  await p.waitForSelector("dialog[open] #ai-apply");
  const boxes = p.locator("dialog[open] .ai-item input");
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await p.evaluate(() => { document.querySelector("dialog[open] .dlg-body").scrollTop = 0; });
  await shot(p, "13-ai-review.png");
  await context.close();
}

// 14. The AI task dialog when the app runs with the local helper
{
  const http = await import("node:http");
  const { createBridge } = await import("./ai/bridge.mjs");
  let bridge = null;
  const server = http.createServer((req, res) => bridge.handler(req, res));
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  bridge = createBridge({ port: server.address().port, status: async () => [
    { provider: "claude", installed: true, version: "2.1.270", loggedIn: true, plan: "commercial", planLabel: "Claude Team", org: "", planDetected: true },
    { provider: "codex", installed: false }
  ] });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const p = await context.newPage();
  await p.goto(bridge.launchUrl().replace("#ai=", "#example=underwriting-current-state&ws=records&ai="));
  await p.waitForFunction(() => window.BPMVIZ && window.BPMVIZ.app && window.BPMVIZ.app.store);
  await p.evaluate(() => window.BPMVIZ.app.dispatch("meta/update", { patch: { confidentiality: "client-confidential", dataStatus: "supplied" } }));
  await p.click("#rv-ai");
  await p.waitForSelector("#ai-start");
  await shot(p, "14-ai-task.png");
  await context.close();
  await new Promise(r => { server.close(r); server.closeAllConnections(); });
}

// Runs the mining library against a sample event log, inside the page, and
// adds the result as a dataset the same way the import wizard's Add step
// does (mining.aggregate followed by the dataset/import command).
async function importSampleLog(p, csvText, opts) {
  return p.evaluate(({ csvText, opts }) => {
    const B = window.BPMVIZ;
    const app = B.app;
    const e = app.store.get();
    const model = e.models.find(m => m.id === opts.modelId);
    const table = B.mining.tableFromRows(B.csv.parse(csvText).rows);
    const cols = B.mining.guessColumns(table.header);
    const fmt = B.mining.detectTimestampFormat(table.rows.map(r => r[cols.mode === "start-end" ? cols.start : cols.timestamp]));
    const builder = B.mining.createEventBuilder(cols, Object.assign({ mode: cols.mode, format: fmt.format, resources: "dropped" }));
    builder.add(table.rows, table.firstDataRow);
    const built = builder.result();
    const matches = B.fuzzy.matchActivities(B.mining.activitiesOf(built.events), B.mining.mappableSteps(model).map(n => ({ id: n.id, label: n.label })));
    const mapping = Object.fromEntries(matches.map(m => [m.activity, { nodeId: m.nodeId, method: m.method || "ignored" }]));
    const ends = B.mining.defaultEndNodes(model, matches.map(m => m.nodeId).filter(Boolean));
    const result = B.mining.aggregate({
      model, events: built.events, caseNames: built.caseNames, mapping, mode: cols.mode,
      timeBasis: e.meta.timeBasis, scenarioTimeBasis: e.meta.timeBasis,
      endNodeIds: ends, requireEnd: true, resources: "dropped", caseIds: "sequence", topVariants: 3,
      name: opts.name, role: opts.role, comparesToDatasetId: opts.comparesToDatasetId || null, dataStatus: "demonstration",
      source: { fileName: opts.fileName, format: "csv", rows: built.rows, droppedRows: built.droppedRows }
    });
    return app.store.dispatch("dataset/import", { dataset: result.dataset, scenarios: result.scenarios }).datasetId;
  }, { csvText, opts });
}

// 15. Event-log import wizard: the activities step, matching the sample log
// against the underwriting example.
{
  const { p, context } = await page("#example=underwriting-current-state");
  await p.click("#btn-menu");
  await p.click("#menu-event-log");
  await p.waitForSelector("dialog[open] #li-choose");
  const [chooser] = await Promise.all([p.waitForEvent("filechooser"), p.click("#li-choose")]);
  await chooser.setFiles(path.join(root, "docs", "samples", "underwriting-baseline.csv"));
  await p.waitForSelector("#li-model");
  await p.click("#li-next");
  await p.waitForSelector("#li-format");
  await p.click("#li-next");
  await p.waitForSelector("#li-map-summary");
  await shot(p, "15-log-import.png");
  await context.close();
}

// 16. Business case: the Matrix view with a few scored opportunities.
{
  const { p, context } = await page("#example=underwriting&ws=records");
  await p.evaluate(() => {
    const d = window.BPMVIZ.app.dispatch;
    d("node/update", { modelId: "m-current", nodeId: "scrub-sov-geocode", patch: { measures: { touchEffort: { value: 30, unit: "minute" } } } });
    d("node/update", { modelId: "m-current", nodeId: "appetite-capacity-triage", patch: { measures: { touchEffort: { value: 1, unit: "hour" } } } });
    d("record/add", { record: { kind: "opportunity", title: "Standard SOV template for the top five brokers", linkedModelId: "m-current",
      linkedNodeIds: ["scrub-sov-geocode"], opportunity: { intervention: "standardize", effort: "M", wave: "now",
        valueCase: { modelId: "m-current", nodeIds: ["scrub-sov-geocode"], effortReductionPct: 50, shareOfCasesPct: 60, shareSource: "manual", effortSource: "node",
          confidence: "high", basis: "supplied" } } } });
    d("record/add", { record: { kind: "opportunity", title: "Automate appetite and capacity triage", linkedModelId: "m-current",
      linkedNodeIds: ["appetite-capacity-triage"], opportunity: { intervention: "deterministic-automation", effort: "L", wave: "next",
        valueCase: { modelId: "m-current", nodeIds: ["appetite-capacity-triage"], effortReductionPct: 70, shareOfCasesPct: 100, shareSource: "manual", effortSource: "node",
          confidence: "medium", basis: "supplied" } } } });
    d("record/add", { record: { kind: "opportunity", title: "Shared mailbox for facultative placement", linkedModelId: "m-current",
      linkedNodeIds: ["scrub-sov-geocode"], opportunity: { intervention: "simplify", effort: "S", wave: "later",
        valueCase: { modelId: "m-current", nodeIds: ["scrub-sov-geocode"], effortReductionPct: 10, shareOfCasesPct: 20, shareSource: "manual", effortSource: "node",
          confidence: "low", basis: "illustrative" } } } });
  });
  await p.click("#rv-tab-opportunities");
  await p.click("#rv-oppview-matrix");
  await p.waitForSelector(".bc-matrix");
  await shot(p, "16-business-case-matrix.png");
  await context.close();
}

// 17. Client review pack dialog, filled in and ready to make.
{
  const { p, context } = await page("#example=underwriting-current-state");
  await p.click("#tab-present");
  await p.click("#pr-action-client-review");
  await p.waitForSelector("dialog[open] #cr-name");
  await p.fill("#cr-name", "Dana Reviewer");
  await p.fill("#cr-role", "Head of Underwriting Operations");
  await shot(p, "17-client-review-pack.png");
  await context.close();
}

// 18. Export for client tools dialog.
{
  const { p, context } = await page("#example=underwriting-current-state");
  await p.click("#tab-present");
  await p.click("#pr-action-client-exports");
  await p.waitForSelector("dialog[open]");
  await shot(p, "18-export-dialog.png");
  await context.close();
}

// 19. Benefits: a baseline and an after log compared, from the sample logs.
{
  const { p, context } = await page("#example=underwriting-current-state&ws=value");
  const baselineCsv = fs.readFileSync(path.join(root, "docs", "samples", "underwriting-baseline.csv"), "utf8");
  const afterCsv = fs.readFileSync(path.join(root, "docs", "samples", "underwriting-after.csv"), "utf8");
  const baselineId = await importSampleLog(p, baselineCsv, { modelId: "m-current", name: "Baseline", role: "baseline", fileName: "underwriting-baseline.csv" });
  await importSampleLog(p, afterCsv, { modelId: "m-current", name: "After the change", role: "after", comparesToDatasetId: baselineId, fileName: "underwriting-after.csv" });
  await p.waitForSelector("#bv-h");
  await p.evaluate(() => { document.getElementById("bv-section").scrollIntoView({ block: "start" }); });
  await shot(p, "19-benefits.png");
  await context.close();
}

await browser.close();
