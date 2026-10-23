// Value dimensions step 3: business case figures in the review form. The
// client confirms them on the form page, and importing the answers marks
// the confirmed figures' basis Confirmed.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { launch, fileUrl, watch } from "../../tools/lib/browser.mjs";

let browser = null;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aixray-review-values-"));
before(async () => { browser = await launch(); }, { timeout: 60000 });
after(async () => { if (browser) await browser.close(); fs.rmSync(tmp, { recursive: true, force: true }); }, { timeout: 30000 });

async function download(page, action) {
  const [d] = await Promise.all([page.waitForEvent("download"), action()]);
  return { name: d.suggestedFilename(), bytes: fs.readFileSync(await d.path()) };
}

test("a client confirms business case figures on the form, and importing marks them Confirmed", { timeout: 120000 }, async t => {
  assert.ok(browser, "Chrome or Edge must launch; retry outside the sandbox if child process creation is blocked.");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { window.showSaveFilePicker = undefined; });
  t.after(() => ctx.close(), { timeout: 15000 });
  const p = await ctx.newPage(), problems = watch(p);
  p.setDefaultTimeout(12000);
  await p.goto(fileUrl() + "#example=underwriting-current-state");
  await p.waitForFunction(() => window.AIxRay && window.AIxRay.app && window.AIxRay.app.store);
  await p.evaluate(() => window.AIxRay.app.dispatch("record/add", { record: {
    kind: "opportunity", title: "Standard SOV template", linkedModelId: "m-current", linkedNodeIds: ["scrub-sov-geocode"],
    opportunity: { effort: "M", valueCase: { modelId: "m-current", nodeIds: ["scrub-sov-geocode"], effortReductionPct: 50, shareOfCasesPct: 60,
      shareSource: "manual", effortSource: "node", confidence: "high", basis: "supplied" } } } }));

  await p.click("#tab-present");
  await p.click("#pr-action-client-review");
  await p.waitForSelector("dialog[open] #cr-inc-values");
  assert.equal(await p.isChecked("#cr-inc-values"), false, "figures go in only when asked");
  await p.click("label:has(#cr-inc-steps)");
  await p.click("label:has(#cr-inc-values)");
  assert.match(await p.textContent("label:has(#cr-inc-values)"), /Business case figures, for the client to confirm \(5\)/);
  assert.match(await p.textContent("#cr-summary"), /: 0 steps, 1 finding and 5 business case figures\./);
  await p.fill("#cr-name", "Robin Finance");
  const pack = await download(p, () => p.click("dialog[open] .dlg-foot .btn-primary"));
  await p.waitForFunction(() => !document.querySelector("dialog[open]"));

  // The form page on its own: a section of figures, grouped by opportunity.
  const file = path.join(tmp, "pack.html");
  fs.writeFileSync(file, pack.bytes);
  const pp = await (await browser.newContext()).newPage();
  const packProblems = watch(pp);
  await pp.goto(pathToFileURL(file).href);
  await pp.waitForSelector("#pack article.item");
  const page = await pp.textContent("#pack");
  assert.match(page, /Figures in the business case \(5\)/);
  assert.match(page, /1 finding, 5 figures\)/);
  assert.match(page, /Effort reduction: 50%/);
  assert.match(page, /Used by every business case/);
  const cards = await pp.$$eval("#pack article.item", els => els.map(el => el.querySelector("h4").textContent));
  for (let i = 0; i < cards.length; i++) {
    if (/^Share of cases affected/.test(cards[i])) {
      await pp.click("label[for=pack-v-" + i + "-dispute]");
      await pp.fill("#pack-c-" + i, "More like 45%.");
    } else if (/: /.test(cards[i])) {
      await pp.click("label[for=pack-v-" + i + "-confirm]");
    }
  }
  const saved = await download(pp, () => pp.click("#pack-save"));
  assert.deepEqual(packProblems.errors, []);
  assert.deepEqual(packProblems.external, []);

  // Import: the hourly rate and the other assumptions become Confirmed; the labor estimate waits for its disputed figure.
  await p.setInputFiles("#file-input", { name: saved.name, mimeType: "application/json", buffer: saved.bytes });
  await p.waitForSelector("dialog[open] #cr-apply-values");
  const dlg = await p.textContent("dialog[open]");
  assert.match(dlg, /Basis changes from Illustrative to Confirmed/);
  assert.match(dlg, /Confirmed\. 1 more figure in this part of the business case to confirm/);
  assert.match(dlg, /\(3 changes\)/);
  await p.click("dialog[open] .dlg-foot .btn-primary");
  await p.waitForFunction(() => !document.querySelector("dialog[open]"));
  const after = await p.evaluate(() => {
    const e = window.AIxRay.app.store.get();
    return { statuses: e.assumptions.map(a => a.status), basis: e.records.find(r => r.title === "Standard SOV template").opportunity.valueCase.basis,
      applied: e.reviews[0].applied, question: (e.records.find(r => r.kind === "question" && /Disputed in client review/.test(r.title)) || {}).title };
  });
  assert.deepEqual(after.statuses, ["validated", "validated", "validated"]);
  assert.equal(after.basis, "supplied");
  assert.equal(after.applied.values, 3);
  assert.equal(after.question, "Disputed in client review: Standard SOV template, share of cases affected: 60%");

  // The Reviews tab and the report count the figures.
  await p.click("#tab-records");
  await p.click("#rv-tab-client-review");
  assert.match(await p.textContent("#ws-records"), /3 business case bases confirmed/);
  await p.click("#tab-present");
  await p.click("#pr-handoff");
  assert.match(await p.textContent("#hd-client-review"), /business case figures 4 confirmed, 1 disputed and 0 not sure/);
  assert.deepEqual(problems.errors, []);
  assert.deepEqual(problems.external, []);
});
