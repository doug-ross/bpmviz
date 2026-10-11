// AI result files in the browser (P2-02): opened from disk with no network,
// reviewed item by item, applied in one undoable step and kept out of the
// handoff until reviewed.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { launch, fileUrl, watch, root } from "../../tools/lib/browser.mjs";

const require = createRequire(import.meta.url);
const ai = require(path.join(root, "webui", "js", "lib", "ai-results.js"));
const underwriting = JSON.parse(fs.readFileSync(path.join(root, "webui", "examples", "underwriting-current-state.engagement.json"), "utf8"));
const GENERATED = { tool: "test", provider: "claude", model: "test-model", surface: "cli", at: "2026-09-01T10:00:00.000Z", jobId: "job-b1", plan: "commercial" };

let browser = null;
before(async () => { browser = await launch(); });
after(async () => { if (browser) await browser.close(); });

async function open(t, hash) {
  if (!browser) { t.skip("Chrome or Edge is not installed"); return null; }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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

function resultFile(task, payload, extra) {
  const env = ai.makeEnvelope(Object.assign({
    task, engagementId: task === "extract" ? null : underwriting.id, engagementRevision: 0,
    baselineModelId: task === "future-state" ? "m-current" : null, generated: GENERATED,
    dataHandling: { confidentiality: "internal", dataStatus: "demonstration" }, payload
  }, extra || {}));
  return { name: task + ".ai-result.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(env)) };
}

const state = page => page.evaluate(() => window.AIxRay.app.store.get());

test("the app stays offline and opens, reviews and applies suggested records", async t => {
  const s = await open(t, "#example=underwriting-current-state&ws=records");
  if (!s) return;
  const csp = await s.page.getAttribute("meta[http-equiv='Content-Security-Policy']", "content");
  assert.match(csp, /connect-src 'none'/);
  const first = underwriting.models[0].nodes[1];
  await s.page.setInputFiles("#file-input", resultFile("opportunities", { suggestions: [
    { ref: "s1", kind: "opportunity", title: "Pre-check clearance rules", description: "Run the duplicate check on intake.",
      linkedModelId: "m-current", linkedNodeIds: [first.id], basedOnRecordIds: [], priority: "high",
      opportunity: { intervention: "deterministic-automation", simplerAlternative: "A shared checklist", expectedBenefit: "Faster clearance",
        affectedVolume: "All submissions", effort: "M", risk: "", dependencies: "", validationAction: "Time twenty cases" },
      confidence: "medium", rationale: "Clearance is manual." },
    { ref: "s2", kind: "question", title: "Who owns appetite rules?", description: "", linkedModelId: null, linkedNodeIds: ["ghost-step"],
      basedOnRecordIds: [], priority: "", opportunity: null, confidence: "low", rationale: "" }
  ] }));
  await s.page.waitForSelector("dialog[open] #ai-apply");
  assert.equal(await s.page.isDisabled("#ai-apply"), true, "nothing is ticked at first");
  assert.match(await s.page.textContent("dialog[open]"), /Drafted by Claude \(Claude Code\), test-model/);
  assert.match(await s.page.textContent("dialog[open]"), /ghost-step not found; link removed/);
  const before = (await state(s.page)).revision;
  await s.page.click("#ai-select-all");
  assert.match(await s.page.textContent("#ai-apply"), /Apply 2 selected/);
  await s.page.click("#ai-apply");
  await s.page.waitForSelector("dialog[open]", { state: "detached" });
  const e = await state(s.page);
  assert.equal(e.revision, before + 1, "one revision");
  assert.equal(e.records.filter(r => r.generated && !r.generated.reviewed).length, 2);
  await s.page.waitForSelector("#rv-mark-reviewed");
  assert.equal(await s.page.locator(".badge", { hasText: "AI draft" }).count(), 2);

  await s.page.evaluate(() => { window.AIxRay.app.goto("present"); window.AIxRay.app.presentView.setMode("handoff"); });
  assert.doesNotMatch(await s.page.textContent("#handoff-doc"), /Pre-check clearance rules/, "unreviewed drafts stay out of the handoff");
  assert.match(await s.page.textContent("#handoff-doc"), /2 AI-drafted findings are left out until someone reviews them/);
  await s.page.check("#pr-unreviewed");
  assert.match(await s.page.textContent("#handoff-doc"), /Pre-check clearance rules\s*AI draft, not reviewed/);

  await s.page.evaluate(() => { window.AIxRay.app.goto("records"); });
  await s.page.click("#rv-mark-reviewed");
  await s.page.click("dialog[open] .btn-primary");
  await s.page.waitForFunction(() => window.AIxRay.app.store.get().records.every(r => r.generated.reviewed));
  await s.page.evaluate(() => { window.AIxRay.app.store.undo(); window.AIxRay.app.store.undo(); });
  assert.equal((await state(s.page)).records.length, 0, "undo removes the applied suggestions");
  clean(s.problems);
});

test("a future-state change set opens as an AI draft that can be marked reviewed", async t => {
  const s = await open(t, "#example=underwriting-current-state");
  if (!s) return;
  const m = underwriting.models[0];
  const edge = m.edges[0];
  const task = m.nodes.find(n => n.semanticType === "task");
  const start = m.nodes.find(n => n.semanticType === "startEvent");
  await s.page.setInputFiles("#file-input", resultFile("future-state", {
    name: "Automated clearance", summary: "Automate the duplicate check.",
    lanes: [{ ref: "bot", name: "Clearance automation", role: "Runs duplicate checks", type: "agent" }],
    operations: [
      { op: "insert", nodeId: null, edgeId: edge.id, label: "Run duplicate check", laneRef: "bot", semanticType: "serviceTask",
        details: [], tags: null, touchEffortMinutes: 0, typicalDurationMinutes: 1, rationale: "Removes manual lookups.", addressesRecordIds: [] },
      { op: "modify", nodeId: task.id, edgeId: null, label: task.label + " (exceptions only)", laneRef: null, semanticType: null,
        details: [], tags: null, touchEffortMinutes: null, typicalDurationMinutes: null, rationale: "Only exceptions need a person.", addressesRecordIds: [] },
      { op: "remove", nodeId: start.id, edgeId: null, label: null, laneRef: null, semanticType: null,
        details: [], tags: null, touchEffortMinutes: null, typicalDurationMinutes: null, rationale: "", addressesRecordIds: [] }
    ]
  }));
  await s.page.waitForSelector("dialog[open] #ai-apply");
  assert.match(await s.page.textContent("dialog[open]"), /Cannot be applied: The start event cannot be removed\./);
  assert.equal(await s.page.locator("dialog[open] .ai-item.blocked input").isDisabled(), true);
  await s.page.click("#ai-select-all");
  assert.match(await s.page.textContent("#ai-apply"), /Apply 2 selected/);
  await s.page.click("#ai-apply");
  await s.page.waitForSelector(".pane-head .badge:has-text('AI draft')");
  const e = await state(s.page);
  const draft = e.models.find(x => x.generated);
  assert.equal(draft.name, "Automated clearance");
  assert.ok(draft.lanes.some(l => l.name === "Clearance automation"));
  assert.equal(draft.nodes.find(n => n.label === "Run duplicate check").lineage.change, "added");
  await s.page.click(".pane-head .link-btn:has-text('Mark reviewed')");
  await s.page.waitForFunction(() => window.AIxRay.app.store.get().models.find(x => x.generated).generated.reviewed);
  clean(s.problems);
});

test("a drafted summary is held back until reviewed, then prints with its disclosure", async t => {
  const s = await open(t, "#example=underwriting-current-state&ws=present");
  if (!s) return;
  await s.page.setInputFiles("#file-input", resultFile("summary", {
    title: "Clearance is the bottleneck", text: "Most delay sits in clearance and triage.\n\nKey points:\n- Clearance is manual\n- Triage waits on data",
    keyPoints: [], caveats: ["Timing is illustrative."]
  }));
  await s.page.waitForSelector("dialog[open] #ai-apply");
  assert.equal(await s.page.isDisabled("#ai-apply"), false, "a single summary needs no ticking");
  await s.page.click("#ai-apply");
  await s.page.waitForSelector("#handoff-doc");
  assert.doesNotMatch(await s.page.textContent("#handoff-doc"), /Clearance is the bottleneck/);
  assert.match(await s.page.textContent("#handoff-doc"), /waiting for review/);
  await s.page.click("#pr-summary-review");
  await s.page.click("dialog[open] .btn-primary");
  await s.page.waitForSelector("#hd-summary");
  const text = await s.page.textContent(".exec-summary");
  assert.match(text, /Clearance is the bottleneck/);
  assert.match(text, /Drafted with AI assistance \(Claude\), reviewed \d{4}-\d{2}-\d{2}\./);
  assert.equal(await s.page.locator(".exec-summary li").count(), 3, "hyphen lines print as a list");
  assert.equal(await s.page.locator(".exec-summary .handoff-tools.no-print").count(), 1);
  clean(s.problems);
});

test("an extraction opens as a new draft engagement, and a result for another engagement is refused", async t => {
  const s = await open(t);
  if (!s) return;
  const raw = JSON.parse(JSON.stringify(underwriting));
  raw.meta.dataStatus = "observed";
  raw.evidence = [{ id: "ev-1", title: "Underwriting guide", status: "validated", link: "https://example.com/guide" }];
  await s.page.setInputFiles("#file-input", resultFile("extract", { engagement: raw }, { dataHandling: { confidentiality: "client-confidential" } }));
  await s.page.waitForSelector("dialog[open]");
  assert.match(await s.page.textContent("dialog[open]"), /What AIxRay changed to keep this a draft/);
  await s.page.click("dialog[open] .btn-primary");
  await s.page.waitForSelector(".node");
  const e = await state(s.page);
  assert.notEqual(e.id, underwriting.id, "the draft gets its own ID");
  assert.equal(e.meta.dataStatus, "supplied");
  assert.equal(e.evidence[0].link, null);
  assert.ok(e.models.every(m => m.generated && !m.generated.reviewed));
  assert.match(await s.page.textContent("#save-state"), /Unsaved changes/);

  await s.page.setInputFiles("#file-input", resultFile("summary", { title: "t", text: "Short.", keyPoints: [], caveats: [] }));
  await s.page.waitForSelector("dialog[open]");
  assert.match(await s.page.textContent("dialog[open]"), /made for a different project/);
  await s.page.click("dialog[open] .btn-primary");
  assert.equal((await state(s.page)).id, e.id, "the open engagement is unchanged");
  clean(s.problems);
});
