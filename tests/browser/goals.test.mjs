// Browser tests for value goals and AI-drafted business cases: the Value goals card and dialog,
// linking an opportunity, the report and deck, and reviewing AI goals and AI business cases.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { launch, fileUrl, watch, root } from "../../tools/lib/browser.mjs";

const require = createRequire(import.meta.url);
const ai = require(path.join(root, "webui", "js", "lib", "ai-results.js"));
const underwriting = JSON.parse(fs.readFileSync(path.join(root, "webui", "examples", "underwriting-current-state.engagement.json"), "utf8"));
const GENERATED = { tool: "test", provider: "claude", model: "test-model", surface: "cli", at: "2026-10-23T10:00:00.000Z", jobId: "job-g1", plan: "commercial" };

let browser = null;
before(async () => { browser = await launch(); });
after(async () => { if (browser) await browser.close(); });

async function open(t, hash) {
  assert.ok(browser, "Chrome or Edge is needed for the browser tests");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(fileUrl() + hash);
  await page.waitForFunction(() => window.AIxRay && window.AIxRay.app && window.AIxRay.app.store);
  t.after(async () => { await context.close(); });
  return { page, problems };
}

function clean(problems) {
  assert.deepEqual(problems.errors, [], "no page or console errors");
  assert.deepEqual(problems.external, [], "no requests outside the app's own files");
}

function resultFile(task, payload) {
  const env = ai.makeEnvelope({ task, engagementId: underwriting.id, engagementRevision: 0, generated: GENERATED,
    dataHandling: { confidentiality: "internal", dataStatus: "demonstration" }, payload });
  return { name: task + ".ai-result.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(env)) };
}

const state = page => page.evaluate(() => window.AIxRay.app.store.get());
const addOpportunity = (page, title, extra) => page.evaluate(([t, x]) => window.AIxRay.app.dispatch("record/add", { record: Object.assign({ kind: "opportunity", title: t,
  linkedModelId: "m-current", linkedNodeIds: ["scrub-sov-geocode"], opportunity: { effort: "M" } }, x || {}) }), [title, extra]);

test("a goal is added on the Value tab, linked from an opportunity, and carried into the register, the report and the deck", async t => {
  const s = await open(t, "#example=underwriting-current-state&ws=value");
  const p = s.page;
  await addOpportunity(p, "Pre-fill the SOV");
  await p.evaluate(() => window.AIxRay.app.goto("value"));
  await p.waitForSelector("#goal-section");
  assert.match(await p.textContent("#goal-empty"), /No goals yet/);
  await p.click("#goal-add");
  await p.waitForSelector("dialog[open] #goal-title");
  await p.fill("#goal-title", "Quote more submissions a week");
  await p.selectOption("#goal-kind", "revenue");
  await p.fill("#goal-metric", "Quotes issued a week");
  await p.fill("#goal-baseline", "40");
  await p.fill("#goal-target", "55");
  await p.fill("#goal-unit", "quotes");
  await p.fill("#goal-source", "Kickoff, head of underwriting");
  await p.click("dialog[open] .dlg-foot .btn-primary");
  await p.waitForSelector("dialog[open]", { state: "detached" });
  assert.match(await p.textContent("#goal-table"), /Quote more submissions a week/);
  assert.match(await p.textContent("#goal-table"), /From 40 quotes to 55 quotes/);
  assert.match(await p.textContent("#goal-section"), /1 goal has no opportunity serving it yet/);

  await p.evaluate(() => { window.AIxRay.app.goto("records"); window.AIxRay.app.recordsView.setTab("opportunities"); });
  await p.click("text=Pre-fill the SOV");
  await p.waitForSelector("dialog[open] #goal-served input[type=checkbox]");
  await p.check("dialog[open] #goal-served input[type=checkbox]");
  await p.click("dialog[open] .dlg-foot .btn-primary");
  await p.waitForSelector("dialog[open]", { state: "detached" });
  const e = await state(p);
  const goalId = e.goals[0].id;
  assert.deepEqual(e.records.find(r => r.title === "Pre-fill the SOV").opportunity.goalIds, [goalId]);
  assert.match(await p.textContent("#rv-panel table"), /Quote more submissions a week/, "the Goals column");

  await p.evaluate(() => { window.AIxRay.app.goto("present"); window.AIxRay.app.presentView.setMode("handoff"); });
  await p.waitForSelector("#goal-report");
  assert.match(await p.textContent("#goal-report"), /Pre-fill the SOV/);
  const deck = await p.evaluate(() => window.AIxRay.pptx.deckFromEngagement(window.AIxRay.app.store.get(), {}).slides.map(x => x.title));
  assert.ok(deck.includes("Value goals"));
  clean(s.problems);
});

test("AI goals are reviewed, applied as drafts, kept out of the report and then marked reviewed", async t => {
  const s = await open(t, "#example=underwriting-current-state&ws=value");
  const p = s.page;
  await p.setInputFiles("#file-input", resultFile("goals", { suggestions: [{
    ref: "g1", kind: "cost", title: "Lower the cost of a bound policy", metric: "Underwriting cost per bound policy", baseline: null, target: null, unit: "$",
    by: "", owner: "", source: "Kickoff transcript [12:40]", quote: "Every bound policy costs us too much underwriter time.", servedByRecordIds: [],
    confidence: "high", rationale: "Stated by the head of underwriting."
  }] }));
  await p.waitForSelector("dialog[open] #ai-apply");
  assert.match(await p.textContent("dialog[open]"), /Every bound policy costs us too much underwriter time/);
  await p.click("#ai-select-all");
  await p.click("#ai-apply");
  await p.waitForSelector("dialog[open]", { state: "detached" });
  await p.waitForSelector("#goal-mark-reviewed");
  assert.match(await p.textContent("#goal-table"), /AI draft/);
  await p.evaluate(() => { window.AIxRay.app.goto("present"); window.AIxRay.app.presentView.setMode("handoff"); });
  assert.equal(await p.locator("#goal-report").count(), 0, "unreviewed AI goals stay out of the report");
  await p.evaluate(() => window.AIxRay.app.goto("value"));
  await p.click("#goal-mark-reviewed");
  await p.click("dialog[open] .dlg-foot .btn-primary");
  await p.waitForFunction(() => window.AIxRay.app.store.get().goals[0].generated.reviewed === true);
  await p.evaluate(() => { window.AIxRay.app.goto("present"); window.AIxRay.app.presentView.setMode("handoff"); });
  await p.waitForSelector("#goal-report");
  clean(s.problems);
});

test("an AI business case shows its sources, is dashed until reviewed, and becomes the person's own when the tick is cleared", async t => {
  const s = await open(t, "#example=underwriting-current-state&ws=records");
  const p = s.page;
  await addOpportunity(p, "Automate the SOV scrub");
  const recordId = (await state(p)).records.find(r => r.title === "Automate the SOV scrub").id;
  const blank = { shareOfCasesPct: "", effortReductionPct: "", durationReductionPct: "", oneTimeCost: "", annualRunningCost: "" };
  const env = ai.makeEnvelope({ task: "opportunities", engagementId: underwriting.id, engagementRevision: 1, generated: GENERATED,
    dataHandling: { confidentiality: "internal", dataStatus: "demonstration" }, payload: { suggestions: [], valueCases: [{
      recordId, nodeIds: [], rationale: "Most of the scrub is copying fields.",
      valueCase: { shareOfCasesPct: 60, effortReductionPct: 40, durationReductionPct: null, oneTimeCost: null, annualRunningCost: null, confidence: "medium",
        sources: Object.assign({}, blank, { shareOfCasesPct: "Assumption: 60% of submissions arrive with an SOV", effortReductionPct: "Step Scrub SOV: field copying" }) }
    }] } });
  await p.setInputFiles("#file-input", { name: "opportunities.ai-result.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(env)) });
  await p.waitForSelector("dialog[open] .ai-figures");
  assert.match(await p.textContent("dialog[open] .ai-figures"), /Assumption: 60% of submissions arrive with an SOV/);
  await p.click("#ai-select-all");
  await p.click("#ai-apply");
  await p.waitForSelector("dialog[open]", { state: "detached" });
  const vc = (await state(p)).records.find(r => r.id === recordId).opportunity.valueCase;
  assert.equal(vc.aiDraft, true);
  assert.equal(vc.basis, "illustrative");

  await p.evaluate(() => window.AIxRay.app.recordsView.setTab("opportunities"));
  assert.match(await p.textContent("#rv-panel table"), /AI draft to review/);
  await p.click("text=Automate the SOV scrub");
  await p.waitForSelector("dialog[open] #bc-vc-ai-banner");
  assert.equal(await p.getAttribute("#bc-vc-share-pct", "class"), "input bc-ai");
  assert.match(await p.textContent("dialog[open]"), /AI source: Step Scrub SOV: field copying/);
  await p.uncheck("#bc-vc-ai-draft");
  assert.equal(await p.getAttribute("#bc-vc-share-pct", "class"), "input");
  await p.click("dialog[open] .dlg-foot .btn-primary");
  await p.waitForSelector("dialog[open]", { state: "detached" });
  const mine = (await state(p)).records.find(r => r.id === recordId).opportunity.valueCase;
  assert.equal(mine.aiDraft, undefined);
  assert.equal(mine.shareOfCasesPct, 60);
  assert.equal(mine.sources.shareOfCasesPct, "Assumption: 60% of submissions arrive with an SOV");
  clean(s.problems);
});
