// Browser tests for the extension seams: features registered at runtime
// render in the shared views, file handlers see files first, and the
// shared file libraries work with the browser's compression streams.
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto((o.http ? server.url : fileUrl()) + (hash || ""));
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

test("every planned feature file loads as an empty module", async t => {
  const s = await open(t, "");
  if (!s) return;
  const names = await s.page.evaluate(() => {
    const B = window.AIxRay;
    return ["zip", "ooxml", "xlsx", "datasetQuery", "valueCase", "csv", "fuzzy", "mining", "businessCase", "reviews", "reviewPack",
      "pptx", "bpmnExport", "backlog", "benefits", "ext", "files", "logImport", "opportunityValue", "clientReview", "clientExports", "benefitsView"]
      .filter(k => !B[k] || typeof B[k] !== "object");
  });
  assert.deepEqual(names, []);
  const sheets = await s.page.evaluate(() => [...document.styleSheets].map(x => (x.href || "").split("/").pop()));
  ["mining.css", "business-case.css", "client-review.css", "client-exports.css", "benefits.css"].forEach(f => assert.ok(sheets.includes(f), f));
  clean(s.problems);
});

test("registered tabs, views, columns, sections, modes and actions render", async t => {
  const s = await open(t, "#example=underwriting&ws=records");
  if (!s) return;
  const p = s.page;
  await p.evaluate(() => {
    const X = window.AIxRay.ext;
    const { h } = window.AIxRay.dom;
    window.__calls = [];
    X.registerRecordsTab({ id: "demo", label: "Demo tab", count: e => e.records.length, render: (panel, ctx) => panel.appendChild(h("p", { id: "demo-tab-body" }, "Demo tab for " + ctx.engagement.meta.processName)) });
    X.registerOpportunityView({ id: "matrix-demo", label: "Demo view", render: (host, ctx) => host.appendChild(h("p", { id: "demo-view-body" }, ctx.records.length + " opportunities")) });
    X.registerOpportunityColumn({ id: "demo-col", header: "Demo column", after: "Effort", cell: r => "cell " + r.id.length });
    X.registerValueSection({ id: "demo-value", render: ctx => h("section", { class: "card", id: "demo-value" }, h("h3", null, "Demo value"), h("p", null, ctx.scenario ? ctx.scenario.name : "none")) });
    X.registerPresentMode({ id: "demo", label: "Demo mode", printable: true, render: (content, ctx) => content.appendChild(h("article", { class: "handoff-doc", id: "demo-mode-body" }, "Mode, sensitive " + ctx.includeSensitive)) });
    X.registerPresentAction({ id: "demo", label: "Demo action", icon: "download", run: (app, ctx) => window.__calls.push("action " + ctx.mode) });
    X.registerHandoffSection({ id: "demo-scope", after: "scope", render: hd => h("section", { id: "demo-after-scope" }, "After scope of " + hd.title) });
    X.registerHandoffSection({ id: "demo-end", after: "end", render: () => h("p", { id: "demo-at-end" }, "At the end") });
    X.registerHandoffSection({ id: "demo-broken", after: "value", render: () => { throw new Error("deliberate"); } });
    window.AIxRay.app.dispatch("record/add", { record: { kind: "opportunity", title: "Pre-fill the SOV", linkedModelId: "m-current", linkedNodeIds: ["scrub-sov-geocode"], opportunity: { effort: "M" } } });
    window.AIxRay.app.recordsView.render();
  });
  // Records tab, placed before Review, with the add and export buttons hidden.
  const tabs = await p.$$eval(".subtabs [role=tab]", els => els.map(e => e.id));
  assert.deepEqual(tabs, ["rv-tab-records", "rv-tab-opportunities", "rv-tab-evidence", "rv-tab-demo", "rv-tab-review"]);
  await p.click("#rv-tab-demo");
  assert.match(await p.textContent("#demo-tab-body"), /Demo tab for /);
  assert.equal(await p.isHidden("#rv-add"), true);
  assert.equal(await p.isHidden("#rv-csv"), true);
  // Opportunity column and view switcher.
  await p.click("#rv-tab-opportunities");
  const heads = await p.$$eval("#rv-panel thead th", els => els.map(e => e.textContent));
  assert.equal(heads[heads.indexOf("Effort") + 1], "Demo column");
  assert.equal(await p.getAttribute("#rv-oppview-register", "aria-pressed"), "true");
  await p.click("#rv-oppview-matrix-demo");
  assert.match(await p.textContent("#demo-view-body"), /^\d+ opportunities$/);
  assert.equal(await p.getAttribute("#rv-oppview-matrix-demo", "aria-pressed"), "true");
  await p.click("#rv-oppview-register");
  assert.ok(await p.$("#rv-panel table"));
  // Value section after the reconciliation card.
  await p.click("#tab-value");
  await p.waitForSelector("#demo-value");
  const order = await p.$$eval("#ws-value .value-stack > section", els => els.map(e => e.id || e.getAttribute("aria-labelledby")));
  assert.equal(order[order.length - 1], "demo-value");
  assert.equal(order[order.length - 2], "vv-rec");
  // Present: registered mode, action and handoff sections.
  await p.click("#tab-present");
  await p.click("#pr-mode-demo");
  assert.equal(await p.getAttribute("#pr-mode-demo", "aria-pressed"), "true");
  assert.equal(await p.$eval("#demo-mode-body", el => el.parentElement.className), "handoff", "printable modes print like the handoff");
  await p.click("#pr-action-demo");
  assert.deepEqual(await p.evaluate(() => window.__calls), ["action demo"]);
  const actionBeforeJson = await p.$$eval(".present-bar button", els => { const ids = els.map(e => e.id); return ids.indexOf("pr-action-demo") === ids.indexOf("pr-json") - 1; });
  assert.equal(actionBeforeJson, true);
  await p.click("#pr-handoff");
  const placed = await p.$eval("#handoff-doc", doc => {
    const kids = [...doc.children];
    const scope = kids.findIndex(k => k.id === "demo-after-scope");
    const scopeHead = kids.findIndex(k => k.tagName === "H2" && k.textContent === "Scope");
    return { afterScopeTable: scope === scopeHead + 2, last: kids[kids.length - 1].id };
  });
  assert.deepEqual(placed, { afterScopeTable: true, last: "demo-at-end" });
  // The broken section was reported and left out; everything else rendered.
  assert.equal(s.problems.errors.length, 1);
  assert.match(s.problems.errors[0], /handoffSection demo-broken failed/);
  s.problems.errors.length = 0;
  clean(s.problems);
});

test("record dialog sections add fields to the opportunity and can block saving", async t => {
  const s = await open(t, "#example=underwriting&ws=records");
  if (!s) return;
  const p = s.page;
  await p.evaluate(() => {
    const { h } = window.AIxRay.dom;
    window.AIxRay.ext.registerRecordDialogSection({ id: "demo-wave", render: record => {
      const sel = h("select", { class: "select", id: "demo-wave-select" }, ["", "now", "next", "later"].map(v => h("option", { value: v, selected: v === ((record.opportunity || {}).wave || "") }, v || "Not set")));
      return { el: h("div", { class: "field", id: "demo-wave-field" }, h("label", { for: "demo-wave-select" }, "Wave"), sel),
        collect: () => ({ wave: sel.value }), check: () => (sel.value ? null : "Choose a wave.") };
    } });
  });
  await p.click("#rv-tab-opportunities");
  await p.click("#rv-add");
  await p.waitForSelector("dialog[open] #demo-wave-field");
  assert.equal(await p.isVisible("#demo-wave-field"), true);
  await p.fill("dialog[open] input[required]", "Route files automatically");
  await p.click("dialog[open] .dlg-foot .btn-primary");
  assert.match(await p.textContent("dialog[open] .error-text"), /Choose a wave/);
  await p.selectOption("#demo-wave-select", "next");
  await p.click("dialog[open] .dlg-foot .btn-primary");
  await p.waitForFunction(() => !document.querySelector("dialog[open]"));
  const wave = await p.evaluate(() => window.AIxRay.app.store.get().records.find(r => r.title === "Route files automatically").opportunity.wave);
  assert.equal(wave, "next");
  await p.click("#rv-add");
  await p.waitForSelector("dialog[open] #demo-wave-field");
  await p.selectOption("dialog[open] select >> nth=0", "pain");
  assert.equal(await p.isVisible("#demo-wave-field"), false, "the section belongs to opportunities");
  await p.keyboard.press("Escape");
  clean(s.problems);
});

test("drawer sections, a registered lens and the PNG renderer work on the process canvas", async t => {
  const s = await open(t, "#example=underwriting-current-state");
  if (!s) return;
  const p = s.page;
  await p.waitForSelector(".node");
  await p.evaluate(() => {
    const B = window.AIxRay;
    const { h } = B.dom;
    B.ext.registerDrawerSection({ id: "demo-overview", where: "overview", render: (ctx, model) => h("section", { class: "side-section", id: "demo-overview" }, "Overview of " + model.name) });
    B.ext.registerDrawerSection({ id: "demo-step", where: "step", render: (ctx, model, node) => h("section", { class: "side-section", id: "demo-step" }, "Step " + node.label) });
    B.lenses.registerLens({ id: "demo-lens", label: "Demo lens", compute: ctx => ({
      description: "Every task, tagged.", unit: "Category.", population: "Demo.",
      nodes: Object.fromEntries(ctx.model.nodes.filter(n => /task/i.test(n.semanticType)).map(n => [n.id, { category: "demo-tag", text: "Tagged" }])),
      legend: [{ category: "demo-tag", label: "Tagged" }]
    }) });
    B.app.dispatch("meta/update", { patch: { summary: "Rebuild the canvas" } });
  });
  await p.waitForSelector("#demo-overview");
  assert.match(await p.textContent("#demo-overview"), /Overview of Current state/);
  assert.ok(await p.$("#pv-lens option[value=demo-lens]"), "registered lenses are offered after a rebuild");
  await p.selectOption("#pv-lens", "demo-lens");
  assert.match(await p.textContent("#pv-lens-info"), /Every task, tagged/);
  assert.ok((await p.$$(".node.lens-demo-tag")).length > 5);
  await p.selectOption("#pv-lens", "waits");
  assert.equal((await p.$$(".node.lens-demo-tag")).length, 0, "the previous lens category is removed");
  assert.ok((await p.$$(".node.lens-external")).length >= 1);
  await p.focus('.pane .node[data-node="scrub-sov-geocode"]');
  await p.keyboard.press("Enter");
  await p.waitForSelector("#demo-step");
  assert.match(await p.textContent("#demo-step"), /Step Scrub SOV/);
  const png = await p.evaluate(async () => {
    const r = await window.AIxRay.app.presentView.renderPng({ scale: 1 });
    return { type: r.blob.type, width: r.width, height: r.height, size: r.blob.size };
  });
  assert.equal(png.type, "image/png");
  assert.ok(png.width > 500 && png.height > 200 && png.size > 1000);
  clean(s.problems);
});

test("menu items, start actions, file handlers and JSON handlers see files first", async t => {
  const s = await open(t, "");
  if (!s) return;
  const p = s.page;
  await p.evaluate(() => {
    const X = window.AIxRay.ext;
    window.__opened = [];
    X.registerMenuItem({ id: "demo-import", label: "Import a demo file", icon: "upload", group: "import", run: () => window.__opened.push("menu") });
    X.registerMenuItem({ id: "demo-export", label: "Export a demo file", icon: "download", group: "export", needsEngagement: true, run: () => window.__opened.push("export") });
    X.registerStartAction({ id: "demo", label: "Start a demo", icon: "list", run: () => window.__opened.push("start") });
    X.registerFileHandler({ id: "demo-picky", extensions: [".demo"], priority: 10, probe: async bytes => bytes[0] === 0x50, open: async (app, file, bytes) => window.__opened.push("picky " + file.name + " " + bytes.length) });
    X.registerFileHandler({ id: "demo-any", extensions: ["demo", ".big"], maxBytes: 64, open: async (app, file, bytes) => window.__opened.push("any " + file.name + " " + bytes.length) });
    X.registerJsonHandler({ id: "demo-json", schema: "aixray.demo", open: (app, data, info) => window.__opened.push("json " + data.value + " " + info.fileName) });
    window.AIxRay.app.goto("start");
  });
  await p.click("#start-demo");
  const startOrder = await p.$$eval(".start-actions button", els => els.map(e => e.id));
  assert.equal(startOrder[startOrder.indexOf("start-new") + 1], "start-demo");
  await p.click("#btn-menu");
  const menu = await p.$$eval("#app-menu button", els => els.map(e => e.id || e.textContent));
  assert.equal(menu[menu.findIndex(x => /Import a BPMN file/.test(x)) + 1], "menu-demo-import");
  assert.equal(menu[menu.findIndex(x => /Save as a new file/.test(x)) + 1], "menu-demo-export");
  assert.equal(await p.isDisabled("#menu-demo-export"), true, "needs an open engagement");
  await p.click("#menu-demo-import");
  await p.setInputFiles("#file-input", { name: "first.demo", mimeType: "application/octet-stream", buffer: Buffer.from("PK picky") });
  await p.waitForFunction(() => window.__opened.length >= 3);
  await p.setInputFiles("#file-input", { name: "second.DEMO", mimeType: "application/octet-stream", buffer: Buffer.from("not picky") });
  await p.waitForFunction(() => window.__opened.length >= 4);
  await p.setInputFiles("#file-input", { name: "hello.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ schema: "aixray.demo", value: 7 })) });
  await p.waitForFunction(() => window.__opened.length >= 5);
  assert.deepEqual(await p.evaluate(() => window.__opened), ["start", "menu", "picky first.demo 8", "any second.DEMO 9", "json 7 hello.json"]);
  const accept = await p.evaluate(() => {
    const input = document.getElementById("file-input");
    input.click = () => {};
    window.AIxRay.app.openPicker();
    return input.accept;
  });
  assert.match(accept, /\.demo/);
  assert.match(accept, /\.json/);
  await p.setInputFiles("#file-input", { name: "huge.big", mimeType: "application/octet-stream", buffer: Buffer.alloc(100, 1) });
  await p.waitForSelector("dialog[open]");
  assert.match(await p.textContent("dialog[open]"), /larger than/);
  clean(s.problems);
});

test("event-log datasets in the store survive structural and refresh events", async t => {
  const s = await open(t, "#example=underwriting-current-state");
  if (!s) return;
  const p = s.page;
  await p.waitForSelector(".node");
  const result = await p.evaluate(datasets => {
    const B = window.AIxRay;
    const e = B.util.clone(B.app.store.get());
    e.datasets = datasets;
    const v = B.validate.validateEngagement(e);
    if (!v.ok) return { errors: v.errors };
    B.app.store.replace(v.engagement, "test");
    B.app.dispatch("dataset/update", { id: "ds-uw-after", patch: { name: "After go-live" } });
    B.app.dispatch("dataset/delete", { id: "ds-uw-baseline" });
    const after = B.app.store.get();
    B.app.store.undo();
    return { names: after.datasets.map(d => d.name), compares: after.datasets[0].comparesToDatasetId, restored: B.app.store.get().datasets.length,
      share: B.datasetQuery.caseShareForNodes(B.app.store.get().datasets[0], ["send-decline-letter"]).exact };
  }, [dataset("underwriting-baseline"), dataset("underwriting-after")]);
  assert.deepEqual(result, { names: ["After go-live"], compares: null, restored: 2, share: false });
  assert.ok((await p.$$(".node")).length > 10, "the canvas rebuilt");
  clean(s.problems);
});

for (const mode of ["file", "http"]) {
  test("compression, hashing, text decoding and workbooks work in the browser (" + mode + ")", async t => {
    const s = await open(t, "", { http: mode === "http" });
    if (!s) return;
    const r = await s.page.evaluate(async () => {
      const B = window.AIxRay;
      const F = B.files;
      const text = "AIxRay ".repeat(200);
      const raw = new TextEncoder().encode(text);
      const packed = await F.deflateRaw(raw);
      const back = new TextDecoder().decode(await F.inflateRaw(packed, raw.length + 10));
      let capped = "";
      try { await F.inflateRaw(packed, 100); } catch (err) { capped = err.message; }
      const hash = await F.sha256Hex("abc");
      const js = F.sha256Js(new TextEncoder().encode("abc"));
      const cp1252 = F.textOf(new Uint8Array([0x63, 0x61, 0x66, 0xe9]));
      const bom = F.textOf(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]));
      const bytes = await B.xlsx.workbookBytesAsync({ sheets: [{ name: "Review", rows: [["Item", "Verdict"], ["step/m/a", "Confirm"]], validations: [{ range: "B2:B9", list: ["Confirm", "Dispute"] }] },
        { name: "aixray-pack", hidden: true, rows: [["packId", "p1"]] }] }, { deflateRaw: F.deflateRaw });
      const wb = await B.xlsx.readWorkbookAsync(bytes, { inflateRaw: F.inflateRaw });
      return { same: back === text, smaller: packed.length < raw.length, capped, hash, js, cp1252, bom,
        sheets: wb.sheets.map(x => x.name + ":" + x.hidden + ":" + JSON.stringify(x.rows)) };
    });
    assert.equal(r.same, true);
    assert.equal(r.smaller, true);
    assert.match(r.capped, /expands past/);
    assert.equal(r.hash, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert.equal(r.js, r.hash);
    assert.equal(r.cp1252, "caf\u00e9");
    assert.equal(r.bom, "hi");
    assert.deepEqual(r.sheets, ["Review:false:[[\"Item\",\"Verdict\"],[\"step/m/a\",\"Confirm\"]]", "aixray-pack:true:[[\"packId\",\"p1\"]]"]);
    clean(s.problems);
  });
}
