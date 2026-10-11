// Browser tests against the real app in Chrome or Edge, in both deployment
// modes: opened directly from disk (file://) and served over HTTP.
// They cover the audit's first-build acceptance criteria (AC-1 to AC-13).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launch, serve, fileUrl, watch, root } from "../../tools/lib/browser.mjs";

let browser = null, server = null;
before(async () => {
  browser = await launch();
  if (browser) server = await serve();
});
after(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
});

async function open(t, hash, opts) {
  const o = opts || {};
  if (!browser) { t.skip("Chrome or Edge is not installed"); return null; }
  const context = await browser.newContext(Object.assign({ viewport: { width: 1440, height: 900 } }, o.context || {}));
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
  if (o.blockStorage) {
    await context.addInitScript(() => {
      Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    });
  }
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto((o.http ? server.url : fileUrl()) + (hash || ""));
  await page.waitForFunction(() => window.AIxRay && window.AIxRay.app && document.getElementById("app"));
  if (/example=/.test(hash || "")) {
    await page.waitForFunction(() => !!window.AIxRay.app.store);
    if (!/ws=(records|value|present)/.test(hash)) await page.waitForSelector(".node");
  }
  t.after(async () => { await context.close(); });
  return { page, context, problems };
}

function clean(problems) {
  assert.deepEqual(problems.errors, [], "no page or console errors");
  assert.deepEqual(problems.external, [], "no requests outside the app's own files");
}

const engagementOf = page => page.evaluate(() => window.AIxRay.app.store.get());

for (const mode of ["file", "http"]) {
  test("AC-1, AC-11 (" + mode + "): every bundled example loads with no errors and no external requests", async t => {
    const s = await open(t, "", { http: mode === "http" });
    if (!s) return;
    const ids = await s.page.evaluate(() => window.AIxRay.bundledExamples.map(x => x.id));
    assert.deepEqual(ids.sort(), ["cash-matching", "rpa-delivery", "underwriting", "underwriting-current-state"]);
    for (const id of ids) {
      await s.page.click("#open-" + id);
      await s.page.waitForSelector(".node");
      const count = await s.page.$$eval(".pane", els => els.length);
      assert.equal(count, 1, id + " opens on one current-state canvas");
      await s.page.evaluate(() => { window.AIxRay.app.goto("start"); });
    }
    clean(s.problems);
  });
}

test("AC-2: Payroll Variance at minute 9,100 shows the second Develop Bot visit, active and over SLA", async t => {
  const s = await open(t, "#example=rpa-delivery&scenario=sc-pay004");
  if (!s) return;
  const node = '.pane .node[data-node="developBot"]';
  const cls = await s.page.getAttribute(node, "class");
  assert.match(cls, /st-active/);
  assert.match(cls, /sla-breach/);
  assert.doesNotMatch(cls, /st-done/);
  const label = await s.page.getAttribute(node, "aria-label");
  assert.match(label, /visit 2 of 2/);
  assert.match(label, /over SLA target/);
  await s.page.focus(node);
  await s.page.keyboard.press("Enter");
  assert.match(await s.page.textContent("#drawer-status"), /visit 2 of 2/);
  assert.match(await s.page.textContent("#drawer-status"), /100% of SLA/);
  for (const value of ["300", "650", "1000"]) {
    await s.page.evaluate(v => { const r = document.getElementById("pv-scrub"); r.value = v; r.dispatchEvent(new Event("input")); }, value);
    assert.doesNotMatch(await s.page.textContent("#drawer-status"), /null|undefined/, "status line while the playhead moves");
  }
  clean(s.problems);
});

test("AC-3: excluded outcomes never show complete and untraversed connectors are never marked", async t => {
  const s = await open(t, "#example=underwriting&scenario=case-3");
  if (!s) return;
  await s.page.click("#pv-end");
  const optional = await s.page.$$eval(".pane .node.tag-optional", els => els.map(e => e.getAttribute("class")));
  assert.equal(optional.length, 6);
  optional.forEach(c => { assert.match(c, /st-excluded/); assert.doesNotMatch(c, /st-done/); });
  const ids = await s.page.evaluate(() => {
    const m = window.AIxRay.app.store.get().models[0];
    return ["Desk Only", "Negotiate", "No (Treaty Fits)", "Bind Order"].map(l => m.edges.find(e => e.label === l).id);
  });
  const state = id => s.page.getAttribute('.pane path[data-edge="' + id + '"]', "class");
  for (const id of ids.slice(0, 3)) assert.doesNotMatch(await state(id), /st-traversed|st-active/, id);
  assert.match(await state(ids[3]), /st-traversed/);
  clean(s.problems);
});

test("AC-4: business-day measures display as business days", async t => {
  const s = await open(t, "#example=underwriting&scenario=case-3");
  if (!s) return;
  const text = await s.page.textContent("#pv-side");
  assert.match(text, /32 business days \u2192 15\.5 business days/);
  assert.doesNotMatch(text, /32m/);
  assert.match(await s.page.textContent("#pv-clock"), /0m \/ 32d/);
  clean(s.problems);
});

test("AC-5: unreconciled supplied costs are flagged, with the implied incremental cost", async t => {
  const s = await open(t, "#example=underwriting&scenario=case-1&ws=value");
  if (!s) return;
  const text = await s.page.textContent("#ws-value");
  assert.match(text, /Does not add up/);
  assert.match(text, /Implies \$200 incremental cost per case/);
  assert.match(text, /\$1,900/, "the calculated figure comes from the declared assumptions");
  assert.match(text, /must not be added together/);
  clean(s.problems);
});

test("AC-6, AC-10: keyboard selection, capture, filtering and focus return", async t => {
  const s = await open(t, "#example=underwriting&scenario=case-3");
  if (!s) return;
  const p = s.page;
  const node = '.pane .node[data-node="check-clearance-dedup"]';
  await p.focus(node);
  await p.keyboard.press("Enter");
  assert.equal(await p.evaluate(() => document.activeElement.id), "drawer-title");
  await p.focus("#dt-summary");
  await p.keyboard.press("ArrowRight");
  assert.equal(await p.getAttribute("#dt-capture", "aria-selected"), "true");
  await p.fill("#cap-title", "Manual keyword search misses name variants");
  await p.fill("#cap-owner", "UW Ops Manager");
  await p.press("#cap-title", "Enter");
  await p.waitForFunction(() => window.AIxRay.app.store.get().records.length === 1);
  assert.equal(await p.textContent("#drawer-title"), "Check Clearance & Dedup", "the selection is kept after capture");
  assert.equal(await p.textContent("#tab-records-count"), "1");
  assert.equal(await p.getAttribute(node, "aria-label").then(l => /1 finding/.test(l)), true);
  await p.keyboard.press("Escape");
  assert.equal(await p.evaluate(() => document.activeElement.dataset.node), "check-clearance-dedup", "focus returns to the step");

  await p.click("#tab-records");
  await p.selectOption("#rf-kind", "pain");
  assert.equal(await p.$$eval("#ws-records tbody tr", r => r.length), 1);
  await p.selectOption("#rf-kind", "decision");
  assert.equal(await p.$$eval("#ws-records tbody tr", r => r.length), 0);
  await p.selectOption("#rf-kind", "");
  await p.click("#ws-records tbody tr .actions button");
  const dlg = p.locator("dialog[open]");
  await dlg.locator("select").nth(1).selectOption("in-progress");
  await dlg.getByRole("button", { name: "Save finding" }).click();
  await p.waitForFunction(() => window.AIxRay.app.store.get().records[0].status === "in-progress");
  assert.match(await p.textContent("#ws-records tbody"), /In progress/);
  clean(s.problems);
});

test("AC-7: save and reopen keeps IDs and records; an invalid file leaves the open engagement alone", async t => {
  const s = await open(t, "#example=underwriting&scenario=case-3");
  if (!s) return;
  const p = s.page;
  await p.evaluate(() => window.AIxRay.app.dispatch("record/add", { record: {
    kind: "action", title: "Confirm survey lead times", owner: "Risk engineering",
    linkedModelId: "m-current", linkedNodeIds: ["perform-on-site-loss-prevention-survey"], evidenceRefs: ["ev-source-bpmn"] } }));
  const [download] = await Promise.all([p.waitForEvent("download"), p.click("#btn-save")]);
  const saved = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  assert.match(await p.textContent("#save-state"), /^Saved: /);
  assert.equal(saved.records.length, 1);

  const s2 = await open(t, "");
  await s2.page.setInputFiles("#file-input", { name: "roundtrip.engagement.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(saved)) });
  await s2.page.waitForSelector(".node");
  const reopened = await engagementOf(s2.page);
  assert.equal(reopened.revision, saved.revision);
  assert.deepEqual(reopened.records, saved.records);
  assert.deepEqual(reopened.models.map(m => m.nodes.map(n => n.id)), saved.models.map(m => m.nodes.map(n => n.id)));
  assert.deepEqual(reopened.assumptions, saved.assumptions);
  assert.deepEqual(reopened.evidence, saved.evidence);
  assert.match(await s2.page.textContent("#save-state"), /Saved: roundtrip.engagement.json/);

  const before = await engagementOf(s2.page);
  await s2.page.setInputFiles("#file-input", { name: "broken.json", mimeType: "application/json", buffer: Buffer.from("{ \"schema\": ") });
  await s2.page.waitForSelector("dialog[open]");
  assert.match(await s2.page.textContent("dialog[open]"), /didn't open/);
  assert.match(await s2.page.textContent("dialog[open]"), /Your open project hasn't changed/);
  await s2.page.keyboard.press("Escape");
  assert.deepEqual(await engagementOf(s2.page), before);
  clean(s.problems);
  clean(s2.problems);
});

for (const mode of ["file", "http"]) {
  test("AC-8 (" + mode + "): a local draft survives a reload and restores", async t => {
    const s = await open(t, "#example=rpa-delivery", { http: mode === "http" });
    if (!s) return;
    const p = s.page;
    await p.evaluate(() => window.AIxRay.app.dispatch("record/add", { record: { kind: "pain", title: "QA environment is shared", linkedModelId: "m-current", linkedNodeIds: ["qa"] } }));
    await p.waitForFunction(() => /Draft kept at/.test(document.getElementById("save-state").textContent));
    await p.reload();
    await p.waitForSelector("dialog[open]");
    assert.match(await p.textContent("dialog[open]"), /Continue your draft/);
    await p.getByRole("button", { name: "Continue the draft" }).click();
    await p.waitForSelector(".node");
    const e = await engagementOf(p);
    assert.equal(e.records.length, 1);
    assert.equal(e.records[0].title, "QA environment is shared");
    assert.match(await p.textContent("#save-state"), /Unsaved changes/);
    clean(s.problems);
  });
}

test("AC-8: blocked storage is reported and file save stays available", async t => {
  const s = await open(t, "", { blockStorage: true });
  if (!s) return;
  const p = s.page;
  assert.match(await p.textContent("#ws-start"), /can't keep drafts/);
  await p.click("#open-rpa-delivery");
  await p.waitForSelector(".node");
  await p.evaluate(() => window.AIxRay.app.dispatch("record/add", { record: { kind: "note", title: "Storage test" } }));
  await p.waitForTimeout(900);
  assert.match(await p.textContent("#save-state"), /Save to a file/);
  assert.equal(await p.isEnabled("#btn-save"), true);
  const [download] = await Promise.all([p.waitForEvent("download"), p.click("#btn-save")]);
  assert.ok(fs.readFileSync(await download.path(), "utf8").includes("Storage test"));
  clean(s.problems);
});

for (const [w, hgt] of [[1366, 768], [1920, 1080], [1024, 768]]) {
  test("AC-9: usable at " + w + "x" + hgt + " with a readable default and an honest overview", async t => {
    const s = await open(t, "#example=underwriting&scenario=case-3", { context: { viewport: { width: w, height: hgt } } });
    if (!s) return;
    const p = s.page;
    const noScroll = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    assert.equal(noScroll, true, "no horizontal page scroll");
    for (const sel of ["#pv-play", "#btn-save", "#pv-find", "#pv-lens", "#pv-scrub"]) {
      const box = await p.locator(sel).boundingBox();
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= w && box.y + box.height <= hgt, sel + " is on screen");
    }
    const zoom = await p.evaluate(() => window.AIxRay.app.processView.state().zoom);
    assert.ok(zoom >= 0.7, "default zoom keeps labels legible (" + zoom + ")");
    assert.equal(await p.locator(".overview-note").first().isVisible(), false);
    await p.click("#pv-overview");
    assert.ok(await p.evaluate(() => window.AIxRay.app.processView.state().zoom) < 0.5);
    assert.equal(await p.locator(".overview-note").first().isVisible(), true, "overview says labels are too small to read");
    clean(s.problems);
  });
}

test("AC-10: playback starts paused, respects reduced motion, and keeps its state across scenario changes", async t => {
  const s = await open(t, "#example=underwriting&scenario=case-3", { context: { reducedMotion: "reduce" } });
  if (!s) return;
  const p = s.page;
  assert.equal(await p.getAttribute("#pv-play", "data-playing"), "false");
  await p.waitForTimeout(600);
  assert.equal(await p.evaluate(() => window.AIxRay.app.processView.state().t), 0);
  await p.click("#pv-play");
  assert.equal(await p.getAttribute("#pv-play", "data-playing"), "true");
  await p.selectOption("#pv-scenario", "case-2");
  assert.equal(await p.getAttribute("#pv-play", "data-playing"), "true", "play state is kept on scenario change");
  await p.click("#pv-play");
  await p.click("#pv-end");
  await p.click("#pv-rewind");
  assert.equal(await p.getAttribute("#pv-play", "data-playing"), "false", "a stop stays in effect after rewind");
  await p.focus('.pane .node[data-node="check-clearance-dedup"]');
  await p.keyboard.press("Enter");
  await p.click("#dt-edit");
  await p.click("#pv-play");
  await p.focus("#ed-label");
  assert.equal(await p.getAttribute("#pv-play", "data-playing"), "false", "editing pauses playback");
  clean(s.problems);
});

test("AC-11: untrusted content renders as text and unsafe links are dropped", async t => {
  const s = await open(t, "");
  if (!s) return;
  const p = s.page;
  const e = JSON.parse(fs.readFileSync(path.join(root, "webui", "examples", "rpa-delivery.engagement.json"), "utf8"));
  e.models[0].nodes[1].label = "<img src=x onerror=\"window.__xss=1\">";
  e.records = [{ id: "r1", kind: "note", title: "<script>window.__xss=2</script>", linkedModelId: "m-current", linkedNodeIds: [e.models[0].nodes[1].id] }];
  e.evidence.push({ id: "ev-bad", title: "Bad link", link: "javascript:window.__xss=3" });
  await p.setInputFiles("#file-input", { name: "untrusted.engagement.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(e)) });
  await p.waitForSelector("dialog[open]");
  await p.getByRole("button", { name: "Later" }).click();
  await p.waitForSelector(".node");
  assert.equal(await p.evaluate(() => document.querySelectorAll("img").length), 0);
  assert.equal(await p.evaluate(() => window.__xss), undefined);
  const label = await p.getAttribute('.pane .node[data-node="' + e.models[0].nodes[1].id + '"]', "aria-label");
  assert.match(label, /<img src=x/);
  await p.click("#tab-records");
  assert.match(await p.textContent("#ws-records tbody"), /<script>window.__xss=2<\/script>/);
  assert.equal(await p.evaluate(() => window.AIxRay.app.store.get().evidence.find(x => x.id === "ev-bad").link), null);
  clean(s.problems);
});

test("AC-12: the handoff and CSV leave out sensitive records unless included", async t => {
  const s = await open(t, "#example=underwriting&scenario=case-3");
  if (!s) return;
  const p = s.page;
  await p.evaluate(() => {
    const a = window.AIxRay.app;
    a.dispatch("record/add", { record: { kind: "note", title: "Named staff salary detail", sensitive: true } });
    a.dispatch("record/add", { record: { kind: "action", title: "Book the site survey earlier", owner: "Risk engineering" } });
  });
  await p.click("#tab-present");
  await p.click("#pr-handoff");
  let text = await p.textContent("#handoff-doc");
  assert.match(text, /Book the site survey earlier/);
  assert.match(text, /Risk engineering/);
  assert.match(text, /Demonstration data/);
  assert.doesNotMatch(text, /Named staff salary detail/);
  assert.match(text, /1 sensitive finding is left out of this report/);
  const [csv] = await Promise.all([p.waitForEvent("download"), p.click("#pr-csv")]);
  assert.doesNotMatch(fs.readFileSync(await csv.path(), "utf8"), /Named staff salary detail/);
  await p.check("#pr-sensitive");
  text = await p.textContent("#handoff-doc");
  assert.match(text, /Named staff salary detail/);
  clean(s.problems);
});

test("P1-05: cloning the baseline locks it and tracks changes in the draft", async t => {
  const s = await open(t, "#example=underwriting-current-state");
  if (!s) return;
  const p = s.page;
  assert.equal(await p.$$eval("#pv-display option", o => o.length), 1, "no comparison without a future state");
  await p.getByRole("button", { name: "Plan a future state" }).click();
  await p.getByRole("button", { name: "Create", exact: true }).click();
  await p.waitForFunction(() => document.querySelectorAll(".pane").length === 2);
  assert.match(await p.textContent(".pane-head"), /Locked baseline/);
  await p.evaluate(() => window.AIxRay.app.processView.selectNode("m-current", "scrub-sov-geocode", { tab: "edit" }));
  assert.match(await p.textContent("#pv-side"), /locked baseline/);
  await p.evaluate(() => window.AIxRay.app.processView.selectNode("m-future-draft", "scrub-sov-geocode", { tab: "edit" }));
  await p.getByRole("button", { name: "Insert step after" }).click();
  await p.locator("dialog[open] input").first().fill("Spot-check extracted fields");
  await p.getByRole("button", { name: "Insert step", exact: true }).click();
  await p.waitForSelector(".node.chg-added");
  const draft = await p.evaluate(() => window.AIxRay.app.store.get().models.find(m => m.id === "m-future-draft"));
  assert.equal(draft.nodes.length, 41);
  assert.ok(draft.nodes.some(n => n.lineage.change === "added" && n.label === "Spot-check extracted fields"));
  assert.match(await p.textContent(".pane:nth-of-type(3) .pane-head, .pane + .splitter + .pane .pane-head"), /1 added/);
  clean(s.problems);
});

test("P2-01: BPMN import keeps source IDs and reports unsupported elements", async t => {
  const s = await open(t, "");
  if (!s) return;
  const p = s.page;
  await p.setInputFiles("#file-input", path.join(root, "tests", "fixtures", "claims-intake.bpmn"));
  await p.waitForSelector("dialog[open]");
  const review = await p.textContent("dialog[open]");
  assert.match(review, /boundaryEvent/);
  assert.match(review, /message flows/);
  await p.getByRole("button", { name: "Later" }).click();
  await p.waitForSelector(".node");
  assert.equal(await p.$$eval(".pane .node", n => n.length), 12);
  const e = await engagementOf(p);
  const m = e.models[0];
  assert.deepEqual(m.lanes.map(l => l.name), ["Claims intake", "Claims handler", "Claims system"]);
  assert.equal(m.nodes.find(n => n.id === "Split_Checks").semanticType, "parallelGateway");
  assert.equal(m.nodes.find(n => n.id === "Start_Claim").semanticType, "messageStartEvent");
  assert.equal(m.nodes.find(n => n.id === "Timer_Chase").semanticType, "unsupported");
  assert.equal(m.edges.find(ed => ed.id === "Flow_Complete").semanticType, "default");
  assert.match(await p.textContent("#save-state"), /Unsaved changes/);
  assert.equal(await p.isDisabled("#pv-play"), true, "no timing, so no replay");
  clean(s.problems);
});

test("P1-07: process SVG export carries the scenario and data status", async t => {
  const s = await open(t, "#example=underwriting&scenario=case-3");
  if (!s) return;
  const p = s.page;
  await p.click("#tab-present");
  const [svg] = await Promise.all([p.waitForEvent("download"), p.click("#pr-svg")]);
  const text = fs.readFileSync(await svg.path(), "utf8");
  assert.match(text, /^<svg/);
  assert.match(text, /Large commercial property underwriting and issuance/);
  assert.match(text, /Demonstration data/);
  assert.match(text, /National Manufacturing Schedule/);
  clean(s.problems);
});

test("P1-08: find locates a step by role or system and the step list mirrors the canvas", async t => {
  const s = await open(t, "#example=underwriting&scenario=case-3");
  if (!s) return;
  const p = s.page;
  await p.fill("#pv-find", "RMS RiskLink");
  const first = await p.textContent("#pv-find-list li");
  assert.match(first, /Ingest SOV into CAT Platform/);
  await p.keyboard.press("Enter");
  assert.equal(await p.textContent("#drawer-title"), "Ingest SOV into CAT Platform");
  await p.keyboard.press("Escape");
  const listed = await p.$$eval("#pv-side .activity-list button", b => b.length);
  assert.equal(listed, 40);
  clean(s.problems);
});
