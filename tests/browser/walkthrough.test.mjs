import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { launch, serve, fileUrl, watch } from "../../tools/lib/browser.mjs";
import { tinyEngagement } from "../unit/helpers.mjs";

let browser, server;
before(async () => {
  browser = await launch();
  assert.ok(browser, "Chrome or Edge must launch; a skipped browser is not a passing check. Retry this focused test with elevated execution if sandboxing blocks launch.");
  server = await serve();
});
after(async () => { if (browser) await browser.close(); if (server) await server.close(); });

async function open(t, mode) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  t.after(() => context.close());
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
  const page = await context.newPage(), problems = watch(page);
  await page.goto(mode === "http" ? server.url : fileUrl());
  await page.waitForFunction(() => !!window.AIxRay.app);
  const e = tinyEngagement();
  e.models[0].nodes[1].details = { desc: "Discuss <img src=x onerror=alert(1)> safely", who: "Analyst", systems: ["Case system"] };
  const future = structuredClone(e.models[0]); future.id = "m-future"; future.role = "future"; future.name = "Future"; e.models.push(future);
  e.assumptions = [
    { id: "rate", key: "hourlyRate", label: "Rate", value: 60, unit: "currencyPerHour", status: "supplied" },
    { id: "volume", key: "annualVolume", label: "Volume", value: 1000, unit: "casesPerYear", status: "supplied" },
    { id: "hours", key: "productiveHoursPerFte", label: "Hours", value: 1000, unit: "hoursPerYear", status: "supplied" },
    { id: "incremental", key: "incrementalCostPerCase", label: "Service cost", value: 0, unit: "currency", status: "supplied" }
  ];
  await page.setInputFiles("#file-input", { name: "walkthrough-synthetic.engagement.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(e)) });
  await page.waitForFunction(() => window.AIxRay.app.store && window.AIxRay.app.store.get().id === "eng-tiny");
  assert.deepEqual(problems.errors, []);
  return { page, problems };
}
function clean(problems) { assert.deepEqual(problems.errors, []); assert.deepEqual(problems.external, []); }
const editor = "[data-walk-editor]";
const control = name => editor + ' [data-walk="' + name + '"]';

for (const mode of ["file", "http"]) {
  test("walkthrough follows decisions and rework, captures a linked finding, resets on model change (" + mode + ")", async t => {
    const { page: p, problems } = await open(t, mode);
    await p.click("#tab-present"); await p.click("#pr-mode-walkthrough");
    const walk = "#ws-present .walkthrough";
    await p.selectOption(walk + ' [data-walk="start-step"]', "start");
    await p.click(walk + ' [data-walk="start"]');
    await p.click(walk + ' [data-walk="next"]');
    assert.equal(await p.evaluate(() => document.activeElement.getAttribute("data-walk")), "next");
    assert.match(await p.textContent(walk), /Analyst/); assert.match(await p.textContent(walk), /Case system/);
    assert.match(await p.textContent(walk), /<img src=x onerror=alert\(1\)>/);
    assert.equal(await p.locator(walk + " img").count(), 0);
    await p.click(walk + ' [data-walk="finding"]');
    await p.fill("dialog[open] input[required]", "Check the handoff");
    await p.click("dialog[open] .dlg-foot .btn-primary");
    await p.waitForFunction(() => !document.querySelector("dialog[open]"));
    const finding = await p.evaluate(() => window.AIxRay.app.store.get().records.find(r => r.title === "Check the handoff"));
    assert.equal(finding.linkedModelId, "m-current"); assert.deepEqual(finding.linkedNodeIds, ["work"]);
    assert.equal(await p.textContent(walk + ' [data-walk="current"]'), "Do the work");
    await p.click(walk + ' [data-walk="next"]');
    assert.equal(await p.isDisabled(walk + ' [data-walk="next"]'), true);
    await p.selectOption(walk + ' [data-walk="branch"]', "e3"); await p.click(walk + ' [data-walk="next"]');
    await p.click(walk + ' [data-walk="next"]');
    assert.match(await p.textContent(walk), /step visited 2 time/);
    await p.click(walk + ' [data-walk="previous"]'); await p.click(walk + ' [data-walk="previous"]');
    await p.selectOption(walk + ' [data-walk="branch"]', "e5"); await p.click(walk + ' [data-walk="next"]');
    assert.match(await p.textContent(walk), /End of the selected route/);
    assert.equal(await p.locator(walk + " .walkthrough-history li").count(), 4);
    await p.evaluate(() => window.AIxRay.app.dispatch("node/update", { modelId: "m-current", nodeId: "work", patch: { label: "Changed work" } }));
    assert.equal(await p.locator(walk + ' [data-walk="start"]').count(), 1);
    assert.match(await p.textContent(walk), /process changed/);
    clean(problems);
  });

  test("scenario editor persists repeated before/future routes, assumptions and alternatives through real save/open (" + mode + ")", async t => {
    const { page: p, problems } = await open(t, mode);
    await p.click("#btn-menu"); await p.click("#menu-walkthrough-scenarios");
    assert.equal(await p.evaluate(() => document.activeElement.getAttribute("data-walk")), "scenario");
    await p.fill(control("scenario-name"), "Workshop case"); await p.click(control("create-scenario"));
    const add = async (choice, duration, effort) => {
      await p.selectOption(control("add-choice"), choice); await p.click(control("add-visit"));
      const count = await p.locator(editor + " .walkthrough-visits tbody tr").count();
      assert.equal(await p.evaluate(() => document.activeElement.getAttribute("data-time")), "duration");
      await p.fill(editor + ' [data-visit="' + count + '"][data-time="duration"]', String(duration));
      await p.fill(editor + ' [data-visit="' + count + '"][data-time="effort"]', String(effort));
    };
    const author = async effort => {
      await add("start", 0, 0); await add("e1", 5, effort); await add("e2", 0, 0);
      await add("e3", 4, 1); await add("e4", 5, effort); await add("e2", 0, 0); await add("e5", 0, 0);
      await p.fill(editor + ' [data-visit="2"][data-time="wait"]', "3");
      await p.click(control("save-run"));
      assert.match(await p.textContent(control("save-status")), /Change saved/);
      assert.equal(await p.evaluate(() => document.activeElement.getAttribute("data-walk")), "save-run");
    };
    await author(2);
    await p.selectOption(control("run-model"), "m-future"); await author(1);
    await p.click(editor + " .walkthrough-assumptions summary");
    await p.fill(editor + ' [data-assumption="hourlyRate"][data-variant="0"]', "75");
    await p.click(control("save-assumptions"));
    await p.click(editor + " .walkthrough-assumptions summary");
    for (const [variant, value] of [[1, 30], [2, 60], [3, 90]]) await p.fill(editor + ' [data-assumption="hourlyRate"][data-variant="' + variant + '"]', String(value));
    await p.fill(control("assumption-note"), "Explicit finance range");
    await p.click(control("create-variants"));
    const result = await p.evaluate(() => {
      const B = window.AIxRay, e = B.app.store.get();
      const s = e.scenarios[0], rp = B.replay.buildReplay(e.models[0], s.runs["m-current"], e.meta.timeBasis);
      return { names: e.scenarios.map(x => x.name), value: B.walkthrough.compare(e, e.scenarios.slice(1).map(x => x.id)).map(x => x.outputs.find(o => o.key === "annualCostDifference").value),
        current: s.measures.find(m => m.key === "humanTouch").values["m-current"], future: s.measures.find(m => m.key === "humanTouch").values["m-future"],
        repeated: B.replay.nodeStateAt(rp, "work", 14).visitIndex };
    });
    assert.deepEqual(result.value, [1000, 2000, 3000]); assert.equal(result.current, 5); assert.equal(result.future, 3);
    assert.equal(result.repeated, 1); assert.equal(result.names.length, 4);
    await p.click("dialog[open] .dlg-foot .btn");
    const pendingDownload = p.waitForEvent("download"); await p.click("#btn-save");
    const download = await pendingDownload, downloaded = JSON.parse(await fs.readFile(await download.path(), "utf8"));
    assert.equal(downloaded.scenarios.length, 4);
    const savedId = downloaded.scenarios[0].id;
    await p.evaluate(() => { window.__walkReloaded = false; window.AIxRay.app.store.subscribe((e, event) => { if (event.type === "replace") window.__walkReloaded = true; }); });
    await p.setInputFiles("#file-input", await download.path());
    await p.waitForFunction(id => window.__walkReloaded && window.AIxRay.app.store.get().scenarios[0].id === id, savedId);
    await p.click("#btn-menu"); await p.click("#menu-walkthrough-scenarios");
    await p.selectOption(control("scenario"), savedId);
    assert.equal(await p.inputValue(editor + ' [data-visit="2"][data-time="effort"]'), "2");
    assert.equal(await p.inputValue(editor + ' [data-visit="2"][data-time="wait"]'), "3");
    assert.equal(await p.locator(editor + " .walkthrough-visits tbody tr").count(), 7);
    await p.fill(control("scenario-name"), "Renamed workshop"); await p.click(control("rename-scenario"));
    assert.equal(await p.inputValue(control("scenario-name")), "Renamed workshop");
    await p.click(control("delete-scenario"));
    await p.getByRole("button", { name: "Delete", exact: true }).click();
    await p.waitForFunction(() => window.AIxRay.app.store.get().scenarios.length === 3);
    clean(problems);
  });
}
