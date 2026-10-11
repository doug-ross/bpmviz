// Browser tests for the benefits tracking feature: the Benefits value
// section, its handoff summary and the observed-change lens.
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

async function open(t, hash) {
  if (!browser) { t.skip("Chrome or Edge is not installed"); return null; }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(fileUrl() + (hash || ""));
  await page.waitForFunction(() => window.AIxRay && window.AIxRay.app && document.getElementById("app"));
  if (/example=/.test(hash || "")) await page.waitForFunction(() => !!window.AIxRay.app.store);
  t.after(async () => { await context.close(); });
  return { page, problems };
}

function clean(problems) {
  assert.deepEqual(problems.errors, [], "no page or console errors");
  assert.deepEqual(problems.external, [], "no requests outside the app's own files");
}

const dataset = name => JSON.parse(fs.readFileSync(path.join(root, "tests", "fixtures", "datasets", name + ".dataset.json"), "utf8"));

/** Replaces the open engagement's datasets with the given ones, through the validator. */
async function loadDatasets(page, datasets) {
  return page.evaluate(sets => {
    const B = window.AIxRay;
    const e = B.util.clone(B.app.store.get());
    e.datasets = sets;
    const v = B.validate.validateEngagement(e);
    if (!v.ok) return { errors: v.errors };
    B.app.store.replace(v.engagement, "test");
    return { errors: [] };
  }, datasets);
}

test("the Benefits section compares two event logs and flags a demonstration-data caveat", async t => {
  const s = await open(t, "#example=underwriting-current-state&ws=value");
  if (!s) return;
  const p = s.page;
  const result = await loadDatasets(p, [dataset("underwriting-baseline"), dataset("underwriting-after")]);
  assert.deepEqual(result.errors, []);
  await p.waitForSelector("#bv-h");
  const text = await p.textContent("#ws-value");
  assert.match(text, /Scrub SOV/);
  assert.match(text, /260 baseline, 271 after/);
  assert.match(text, /demonstration data/);
  clean(s.problems);
});

test("expected versus measured change shows a figure and a status for a linked opportunity", async t => {
  const s = await open(t, "#example=underwriting-current-state&ws=value");
  if (!s) return;
  const p = s.page;
  await loadDatasets(p, [dataset("underwriting-baseline"), dataset("underwriting-after")]);
  await p.waitForSelector("#bv-h");
  await p.evaluate(() => {
    window.AIxRay.app.dispatch("record/add", { record: {
      kind: "opportunity", title: "Automate SOV scrub and triage",
      linkedModelId: "m-current", linkedNodeIds: ["scrub-sov-geocode", "appetite-capacity-triage", "technical-pricing-rating"],
      opportunity: { effort: "M", valueCase: {
        modelId: "m-current", nodeIds: ["scrub-sov-geocode", "appetite-capacity-triage", "technical-pricing-rating"],
        effortReductionPct: 30, shareOfCasesPct: null, shareSource: "dataset", effortSource: "dataset",
        datasetId: "ds-uw-baseline", confidence: "medium", basis: "supplied"
      } }
    } });
  });
  await p.waitForSelector("text=Automate SOV scrub and triage");
  const row = p.locator("#bv-section tr", { hasText: "Automate SOV scrub and triage" }).first();
  const rowText = await row.textContent();
  assert.doesNotMatch(rowText, /Not calculated/, "both expected and measured figures are available");
  const statusText = await row.locator("td").last().textContent();
  assert.match(statusText, /^(Met|Partially met|Not yet|Worse)$/);
  clean(s.problems);
});

test("a comparison can be recorded through the form and removed again", async t => {
  const s = await open(t, "#example=underwriting-current-state&ws=value");
  if (!s) return;
  const p = s.page;
  const baseline = dataset("underwriting-baseline");
  const after = dataset("underwriting-after");
  after.role = "baseline";
  after.comparesToDatasetId = null;
  after.id = "ds-uw-second";
  after.name = "Second log, not yet linked";
  await loadDatasets(p, [baseline, after]);
  await p.waitForSelector("#bv-link-after");
  assert.equal(await p.locator("#bv-section .benefits-pair").count(), 0, "no comparison is recorded yet");
  await p.selectOption("#bv-link-after", "ds-uw-second");
  await p.selectOption("#bv-link-baseline", "ds-uw-baseline");
  await p.click("#bv-section button:has-text('Record this comparison')");
  await p.waitForSelector(".benefits-pair");
  assert.match(await p.textContent(".benefits-pair"), /Second log, not yet linked compared to/);
  await p.click(".benefits-pair button:has-text('Remove this comparison')");
  await p.waitForFunction(() => !document.querySelector(".benefits-pair"));
  await p.waitForSelector("#bv-link-after");
  clean(s.problems);
});

test("the handoff summary reports measured change after the value section", async t => {
  const s = await open(t, "#example=underwriting-current-state&ws=value");
  if (!s) return;
  const p = s.page;
  await loadDatasets(p, [dataset("underwriting-baseline"), dataset("underwriting-after")]);
  await p.waitForSelector("#bv-h");
  await p.click("#tab-present");
  await p.click("#pr-handoff");
  const doc = await p.$eval("#handoff-doc", el => {
    const kids = [...el.children];
    const valueHead = kids.findIndex(k => k.tagName === "H2" && k.textContent === "Evidence");
    const benefitsHead = kids.findIndex(k => k.tagName === "H3" && k.textContent === "Benefits measured");
    return { beforeEvidence: benefitsHead !== -1 && benefitsHead < valueHead, text: el.textContent };
  });
  assert.equal(doc.beforeEvidence, true, "the benefits summary sits after the value section and before evidence");
  assert.match(doc.text, /Benefits measured/);
  assert.match(doc.text, /comparing/i.test(doc.text) ? /comparing/i : /compared to/);
  clean(s.problems);
});

test("the observed-change lens shows the measured direction of change on the canvas", async t => {
  const s = await open(t, "#example=underwriting-current-state");
  if (!s) return;
  const p = s.page;
  await p.waitForSelector(".node");
  await loadDatasets(p, [dataset("underwriting-baseline"), dataset("underwriting-after")]);
  await p.waitForSelector(".node");
  assert.ok(await p.$("#pv-lens option[value=observed-change]"));
  await p.selectOption("#pv-lens", "observed-change");
  await p.waitForSelector(".node.lens-faster");
  assert.match(await p.textContent("#pv-lens-info"), /median duration/);
  const node = await p.$('.pane .node[data-node="scrub-sov-geocode"]');
  assert.ok(node);
  assert.match(await node.getAttribute("class"), /lens-faster/);
  clean(s.problems);
});
