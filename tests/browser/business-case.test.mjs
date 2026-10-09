// Browser tests for the value case and business case feature: the value case
// editor on the opportunity dialog, the Matrix and Waves views, moving a
// wave, and the Business case present mode (lib/business-case.js,
// ui/opportunity-value.js).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { launch, serve, fileUrl, watch } from "../../tools/lib/browser.mjs";

let browser = null, server = null;
before(async () => {
  browser = await launch();
  if (browser) server = await serve();
});
after(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
});

async function open(t, hash) {
  if (!browser) { t.skip("Chrome or Edge is not installed"); return null; }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(fileUrl() + (hash || ""));
  await page.waitForFunction(() => window.BPMVIZ && window.BPMVIZ.app && document.getElementById("app"));
  if (/example=/.test(hash || "")) await page.waitForFunction(() => !!window.BPMVIZ.app.store);
  t.after(async () => { await context.close(); });
  return { page, problems };
}

function clean(problems) {
  assert.deepEqual(problems.errors, [], "no page or console errors");
  assert.deepEqual(problems.external, [], "no requests outside the app's own files");
}

/* scrub-sov-geocode and appetite-capacity-triage are untimed task steps in the bundled example; give them touch effort so the value case has something to compute from. */
async function giveTouchEffort(page) {
  await page.evaluate(() => {
    const d = window.BPMVIZ.app.dispatch;
    d("node/update", { modelId: "m-current", nodeId: "scrub-sov-geocode", patch: { measures: { touchEffort: { value: 30, unit: "minute" } } } });
    d("node/update", { modelId: "m-current", nodeId: "appetite-capacity-triage", patch: { measures: { touchEffort: { value: 1, unit: "hour" } } } });
  });
}

test("the value case editor estimates value as it is filled in, and the opportunity register shows the result", async t => {
  const s = await open(t, "#example=underwriting&ws=records");
  if (!s) return;
  const p = s.page;
  await giveTouchEffort(p);
  await p.evaluate(() => window.BPMVIZ.app.dispatch("record/add", { record: { kind: "opportunity", title: "Automate SOV scrub",
    linkedModelId: "m-current", linkedNodeIds: ["scrub-sov-geocode", "appetite-capacity-triage"], opportunity: { effort: "M" } } }));
  await p.click("#rv-tab-opportunities");
  await p.click("text=Automate SOV scrub");
  await p.waitForSelector("dialog[open] #bc-vc-effort-pct");
  assert.match(await p.textContent("dialog[open] #bc-vc-preview"), /Fill in the effort or duration reduction/);
  await p.fill("#bc-vc-effort-pct", "50");
  await p.fill("#bc-vc-share-pct", "50");
  await p.waitForFunction(() => /Estimated at/.test(document.getElementById("bc-vc-preview").textContent));
  assert.match(await p.textContent("#bc-vc-preview"), /\$22,500/, "400 cases x 50% x 1.5 hours x 50% x \\$150 an hour");
  await p.fill("#bc-vc-one-time", "5000");
  await p.selectOption("#bc-vc-confidence", "high");
  await p.selectOption("#bc-vc-basis", "supplied");
  await p.selectOption("#bc-vc-wave", "now");
  await p.click("dialog[open] .dlg-foot .btn-primary");
  await p.waitForFunction(() => !document.querySelector("dialog[open]"));
  const saved = await p.evaluate(() => {
    const r = window.BPMVIZ.app.store.get().records.find(x => x.title === "Automate SOV scrub");
    return { wave: r.opportunity.wave, vc: r.opportunity.valueCase };
  });
  assert.equal(saved.wave, "now");
  assert.equal(saved.vc.effortReductionPct, 50);
  assert.equal(saved.vc.oneTimeCost, 5000);
  const cell = await p.textContent("#rv-panel table tbody tr td:nth-child(6)");
  assert.match(cell, /\$22,500 a year/);
  assert.match(cell, /illustrative basis/, "the result inherits the weakest input, here the illustrative engagement assumptions");
  const waveCell = await p.textContent("#rv-panel table tbody tr td:nth-child(7)");
  assert.equal(waveCell.trim(), "Now");
  clean(s.problems);
});

test("saving the dialog without changes keeps the value case's own scope (modelId and nodeIds)", async t => {
  const s = await open(t, "#example=underwriting&ws=records");
  if (!s) return;
  const p = s.page;
  await giveTouchEffort(p);
  await p.evaluate(() => window.BPMVIZ.app.dispatch("record/add", { record: { kind: "opportunity", title: "Keep my scope",
    linkedModelId: "m-current", linkedNodeIds: ["scrub-sov-geocode", "appetite-capacity-triage"],
    opportunity: { effort: "M", valueCase: {
      modelId: "m-current", nodeIds: ["appetite-capacity-triage"],
      effortReductionPct: 40, shareOfCasesPct: 50, confidence: "medium", basis: "supplied"
    } } } }));
  await p.click("#rv-tab-opportunities");
  await p.click("text=Keep my scope");
  await p.waitForSelector("dialog[open] #bc-vc-effort-pct");
  await p.click("dialog[open] .dlg-foot .btn-primary");
  await p.waitForFunction(() => !document.querySelector("dialog[open]"));
  const vc = await p.evaluate(() => window.BPMVIZ.app.store.get().records.find(r => r.title === "Keep my scope").opportunity.valueCase);
  assert.equal(vc.modelId, "m-current");
  assert.deepEqual(vc.nodeIds, ["appetite-capacity-triage"]);
  assert.equal(vc.effortReductionPct, 40);
  clean(s.problems);
});

test("the value case editor can block saving when a source needs an event log that is not chosen", async t => {
  const s = await open(t, "#example=underwriting&ws=records");
  if (!s) return;
  const p = s.page;
  await p.click("#rv-tab-opportunities");
  await p.click("#rv-add");
  await p.waitForSelector("dialog[open] #bc-vc-effort-source");
  await p.fill("dialog[open] input[required]", "Needs a log");
  await p.selectOption("#bc-vc-effort-source", "dataset");
  await p.click("dialog[open] .dlg-foot .btn-primary");
  assert.match(await p.textContent("dialog[open] .error-text"), /Choose an event log/);
  await p.keyboard.press("Escape");
  clean(s.problems);
});

test("leaving the value case blank does not record an empty one", async t => {
  const s = await open(t, "#example=underwriting&ws=records");
  if (!s) return;
  const p = s.page;
  await p.click("#rv-tab-opportunities");
  await p.click("#rv-add");
  await p.waitForSelector("dialog[open] #bc-vc-effort-pct");
  await p.fill("dialog[open] input[required]", "Not modeled yet");
  await p.click("dialog[open] .dlg-foot .btn-primary");
  await p.waitForFunction(() => !document.querySelector("dialog[open]"));
  const saved = await p.evaluate(() => window.BPMVIZ.app.store.get().records.find(r => r.title === "Not modeled yet").opportunity);
  assert.equal(saved.valueCase, undefined, "no value case field was touched, so none should be recorded");
  const cell = await p.textContent("#rv-panel table tbody tr td:nth-child(6)");
  assert.match(cell, /Not modeled/);
  clean(s.problems);
});

test("the handoff table only lists opportunities kept in the handoff", async t => {
  const s = await open(t, "#example=underwriting&ws=records");
  if (!s) return;
  const p = s.page;
  await giveTouchEffort(p);
  await p.evaluate(() => {
    const d = window.BPMVIZ.app.dispatch;
    const steps = ["scrub-sov-geocode", "appetite-capacity-triage"];
    const valueCase = { effortReductionPct: 50, shareOfCasesPct: 50, confidence: "high", basis: "supplied" };
    d("record/add", { record: { kind: "opportunity", title: "Kept in handoff", linkedModelId: "m-current", linkedNodeIds: steps,
      opportunity: { effort: "M", wave: "now", valueCase } } });
    d("record/add", { record: { kind: "opportunity", title: "Dropped from handoff", linkedModelId: "m-current", linkedNodeIds: steps,
      opportunity: { effort: "M", wave: "now", valueCase }, includeInHandoff: false } });
  });
  await p.click("#tab-present");
  await p.click("#pr-handoff");
  await p.waitForSelector("#handoff-doc");
  const text = await p.textContent("#handoff-doc");
  assert.match(text, /Kept in handoff/);
  assert.doesNotMatch(text, /Dropped from handoff/);
  clean(s.problems);
});

test("the Matrix view charts and lists opportunities by effort and value", async t => {
  const s = await open(t, "#example=underwriting&ws=records");
  if (!s) return;
  const p = s.page;
  await giveTouchEffort(p);
  await p.evaluate(() => {
    const d = window.BPMVIZ.app.dispatch;
    const steps = ["scrub-sov-geocode", "appetite-capacity-triage"];
    const base = { shareOfCasesPct: 50, durationReductionPct: 10, confidence: "high", basis: "supplied" };
    d("record/add", { record: { kind: "opportunity", title: "Quick win candidate", linkedModelId: "m-current", linkedNodeIds: steps,
      opportunity: { effort: "S", valueCase: Object.assign({ effortReductionPct: 80 }, base) } } });
    d("record/add", { record: { kind: "opportunity", title: "Reconsider candidate", linkedModelId: "m-current", linkedNodeIds: steps,
      opportunity: { effort: "L", valueCase: Object.assign({ effortReductionPct: 5 }, base) } } });
  });
  await p.click("#rv-tab-opportunities");
  assert.equal(await p.isHidden("#rv-oppview-register"), false);
  await p.click("#rv-oppview-matrix");
  await p.waitForSelector(".bc-matrix svg");
  assert.equal((await p.$$(".bc-dot")).length, 2);
  const ranks = await p.$$eval(".bc-dot-rank", els => els.map(e => e.textContent).sort());
  assert.deepEqual(ranks, ["1", "2"]);
  const quadrants = await p.$$eval("#rv-panel table tbody tr", rows => rows.map(r => r.children[5].textContent.trim()));
  assert.deepEqual(quadrants.sort(), ["Quick win", "Reconsider"]);
  await p.click("#rv-oppview-register");
  assert.ok(await p.$("#rv-panel table"));
  clean(s.problems);
});

test("the Waves view moves an opportunity with a keyboard-friendly select, and undo restores it", async t => {
  const s = await open(t, "#example=underwriting&ws=records");
  if (!s) return;
  const p = s.page;
  await giveTouchEffort(p);
  await p.evaluate(() => window.BPMVIZ.app.dispatch("record/add", { record: { kind: "opportunity", title: "Move me",
    linkedModelId: "m-current", linkedNodeIds: ["scrub-sov-geocode"],
    opportunity: { effort: "S", wave: "now", valueCase: { effortReductionPct: 50, shareOfCasesPct: 50, confidence: "medium", basis: "supplied" } } } }));
  await p.click("#rv-tab-opportunities");
  await p.click("#rv-oppview-waves");
  await p.waitForSelector("#bc-wave-now");
  const recordId = await p.evaluate(() => window.BPMVIZ.app.store.get().records.find(r => r.title === "Move me").id);
  assert.equal(await p.$eval("#bc-wave-card-" + recordId, el => el.closest(".bc-wave-col").id), "bc-wave-now");
  await p.selectOption("#bc-move-" + recordId, "later");
  await p.waitForFunction(id => window.BPMVIZ.app.store.get().records.find(r => r.id === id).opportunity.wave === "later", recordId);
  assert.equal(await p.$eval("#bc-wave-card-" + recordId, el => el.closest(".bc-wave-col").id), "bc-wave-later");
  await p.evaluate(() => window.BPMVIZ.app.store.undo());
  await p.waitForFunction(id => window.BPMVIZ.app.store.get().records.find(r => r.id === id).opportunity.wave === "now", recordId);
  await p.waitForSelector("#bc-wave-card-" + recordId);
  assert.equal(await p.$eval("#bc-wave-card-" + recordId, el => el.closest(".bc-wave-col").id), "bc-wave-now");
  clean(s.problems);
});

test("the Business case present mode shows a portfolio page and a single opportunity page, both printable", async t => {
  const s = await open(t, "#example=underwriting&ws=records");
  if (!s) return;
  const p = s.page;
  await giveTouchEffort(p);
  await p.evaluate(() => window.BPMVIZ.app.dispatch("record/add", { record: { kind: "opportunity", title: "Printable opportunity",
    linkedModelId: "m-current", linkedNodeIds: ["scrub-sov-geocode", "appetite-capacity-triage"],
    opportunity: { effort: "M", wave: "now", valueCase: { effortReductionPct: 50, shareOfCasesPct: 50, oneTimeCost: 5000, confidence: "high", basis: "supplied" } } } }));
  await p.click("#tab-present");
  await p.click("#pr-mode-business-case");
  await p.waitForSelector("#bc-portfolio");
  assert.equal(await p.$eval("#bc-portfolio", el => el.parentElement.className), "handoff", "a printable mode prints like the handoff");
  assert.match(await p.textContent("#bc-portfolio"), /Printable opportunity/);
  assert.match(await p.textContent("#bc-portfolio"), /\$22,500/);
  await p.selectOption("#bc-present-select", { label: "Printable opportunity" });
  await p.waitForSelector("#bc-onepager");
  assert.match(await p.textContent("#bc-onepager"), /Business case: Printable opportunity/);
  assert.match(await p.textContent("#bc-onepager"), /\$22,500/);
  await p.selectOption("#bc-present-select", { label: "Portfolio overview" });
  await p.waitForSelector("#bc-portfolio");
  await p.click("#pr-handoff");
  await p.waitForSelector("#handoff-doc");
  assert.match(await p.textContent("#handoff-doc"), /Opportunity value and waves/);
  assert.match(await p.textContent("#handoff-doc"), /Printable opportunity/);
  clean(s.problems);
});
