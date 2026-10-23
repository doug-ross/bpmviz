// Value dimensions step 3: choosing a comparison group for an event-log
// comparison in the Benefits section, and the measured change net of it.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launch, fileUrl, watch, root } from "../../tools/lib/browser.mjs";

let browser = null;
before(async () => { browser = await launch(); }, { timeout: 60000 });
after(async () => { if (browser) await browser.close(); }, { timeout: 30000 });

const dataset = name => JSON.parse(fs.readFileSync(path.join(root, "tests", "fixtures", "datasets", name + ".dataset.json"), "utf8"));

/* The baseline log again, as a team that did not get the change; its scrub step a little faster after. */
function groupLog(id, name, scrubFactor) {
  const d = dataset("underwriting-baseline");
  Object.assign(d, { id, name, role: "baseline", comparesToDatasetId: null });
  const s = d.steps.find(x => x.nodeId === "scrub-sov-geocode");
  s.duration = Object.fromEntries(Object.entries(s.duration).map(([k, v]) => [k, k === "n" || v === null ? v : v * scrubFactor]));
  return d;
}

test("record a comparison group and see the measured change net of it", { timeout: 90000 }, async t => {
  assert.ok(browser, "Chrome or Edge must launch; retry outside the sandbox if child process creation is blocked.");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  t.after(() => context.close(), { timeout: 15000 });
  const p = await context.newPage(), problems = watch(p);
  p.setDefaultTimeout(12000);
  await p.goto(fileUrl() + "#example=underwriting-current-state&ws=value");
  await p.waitForFunction(() => window.AIxRay && window.AIxRay.app && window.AIxRay.app.store);
  const errors = await p.evaluate(sets => {
    const B = window.AIxRay;
    const e = B.util.clone(B.app.store.get());
    e.datasets = sets;
    const v = B.validate.validateEngagement(e);
    if (v.ok) B.app.store.replace(v.engagement, "test");
    return v.errors;
  }, [dataset("underwriting-baseline"), dataset("underwriting-after"), groupLog("ds-group-before", "Other region, before", 1), groupLog("ds-group-after", "Other region, after", 0.9)]);
  assert.deepEqual(errors, []);
  await p.evaluate(() => {
    window.AIxRay.app.dispatch("record/add", { record: {
      kind: "opportunity", title: "Automate SOV scrub", linkedModelId: "m-current", linkedNodeIds: ["scrub-sov-geocode"],
      opportunity: { effort: "M", valueCase: { modelId: "m-current", nodeIds: ["scrub-sov-geocode"], effortReductionPct: 30, shareOfCasesPct: null,
        shareSource: "dataset", effortSource: "dataset", datasetId: "ds-uw-baseline", confidence: "medium", basis: "supplied" } } } });
  });
  const afterId = await p.evaluate(() => window.AIxRay.app.store.get().datasets.find(d => d.role === "after").id);
  await p.waitForSelector("#bv-group-save-" + afterId);
  const row = () => p.locator("#bv-section tr", { hasText: "Automate SOV scrub" }).first();
  const before = await row().textContent();
  assert.doesNotMatch(before, /Before the comparison group/);

  await p.selectOption("#bv-group-before-" + afterId, "ds-group-before");
  await p.selectOption("#bv-group-after-" + afterId, "ds-group-after");
  await p.click("#bv-group-save-" + afterId);
  await p.waitForSelector("#bv-group-remove-" + afterId);
  const ds = await p.evaluate(id => window.AIxRay.app.store.get().datasets.find(d => d.id === id).comparisonGroup, afterId);
  assert.deepEqual(ds, { baselineId: "ds-group-before", afterId: "ds-group-after" });
  assert.match(await p.textContent("#bv-group-" + afterId), /did not get the change: Other region, before \(before\) and Other region, after \(after\)\./);
  assert.match(await row().textContent(), /Before the comparison group: /);
  assert.match(await row().textContent(), /own change of [\d,.]+ hours a year is taken out/);
  assert.equal(await p.locator("#bv-section th", { hasText: "Duration change net of the comparison group" }).count(), 1);
  const scrub = p.locator("#bv-section tr", { hasText: "Scrub SOV" }).last();
  assert.match(await scrub.textContent(), /(faster|slower|No change)$/);
  assert.match(await p.textContent("#bv-section"), /moved in step without the change/);

  await p.click("#tab-present");
  await p.click("#pr-handoff");
  assert.match(await p.textContent("#handoff-doc"), /measured, net of a comparison group\)/);

  await p.click("#tab-value");
  await p.click("#bv-group-remove-" + afterId);
  await p.waitForSelector("#bv-group-save-" + afterId);
  assert.doesNotMatch(await row().textContent(), /Before the comparison group/);
  assert.deepEqual(problems.errors, []);
  assert.deepEqual(problems.external, []);
});
