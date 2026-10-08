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

await browser.close();
