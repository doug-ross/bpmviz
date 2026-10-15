import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { launch, serve, fileUrl, watch } from "../../tools/lib/browser.mjs";

let browser, server;
before(async () => {
  browser = await launch();
  assert.ok(browser, "Chrome or Edge must launch; retry outside the sandbox if child process creation is blocked.");
  server = await serve();
}, { timeout: 60000 });
after(async () => { if (browser) await browser.close(); if (server) await server.close(); }, { timeout: 30000 });
async function open(t, mode = "file", hash = "") {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  t.after(() => context.close(), { timeout: 15000 });
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
  const page = await context.newPage(), problems = watch(page);
  page.setDefaultTimeout(12000);
  await page.goto((mode === "file" ? fileUrl() : server.url) + hash);
  await page.waitForFunction(() => !!window.AIxRay.processBuilderUi && !!window.AIxRay.app);
  return { page, problems };
}
const control = (page, key) => page.locator('#builder-dialog [data-builder="' + key + '"]');
const engagement = page => page.evaluate(() => window.AIxRay.app.store.get());
async function expand(page, text) {
  const summary = page.locator("#builder-dialog summary").filter({ hasText: text });
  if (!await summary.evaluate(el => el.parentElement.open)) await summary.click();
}
async function create(page, title = "Request intake") {
  await page.click("#start-process-builder");
  await page.locator('[data-builder="process-name"]').fill(title);
  await page.locator('[data-builder="team-name"]').fill("Operations");
  await page.locator('[data-builder="create"]').click();
  await page.waitForSelector("#builder-dialog");
}
function clean(problems) {
  assert.deepEqual(problems.errors, [], "no console errors, page errors or CSP violations");
  assert.deepEqual(problems.external, [], "no requests outside local files");
}

for (const mode of ["file", "http"]) {
  test("build a blank process, connect a task, save and reopen (" + mode + ")", { timeout: 60000 }, async t => {
    const { page, problems } = await open(t, mode);
    await create(page, "<img src=x onerror=alert(1)>");
    let e = await engagement(page), m = e.models[0];
    const start = m.nodes[0].id, end = m.nodes[1].id, originalFlow = m.edges[0].id;
    assert.equal(m.lanes[0].name, "Operations");
    await control(page, "new-node-name").fill("Review <script>request</script>");
    await control(page, "add-node").click();
    m = (await engagement(page)).models[0];
    const task = m.nodes.find(n => n.semanticType === "userTask");
    assert.ok(task);
    assert.match(await control(page, "checks").innerText(), /cannot be reached/);
    await control(page, "flow-from").selectOption(start);
    await control(page, "flow-to").selectOption(task.id);
    await control(page, "add-flow").click();
    await control(page, "flow-from").selectOption(task.id);
    await control(page, "flow-to").selectOption(end);
    await control(page, "flow-label").fill("Complete");
    await control(page, "add-flow").click();
    await expand(page, "Reconnect or delete flows");
    await control(page, "flow").selectOption(originalFlow);
    await expand(page, "Reconnect or delete flows");
    await control(page, "delete-flow").click();
    assert.match(await control(page, "checks").innerText(), /Structure checks \(0\)/);
    const downloadReady = page.waitForEvent("download");
    await control(page, "save").click();
    const download = await downloadReady;
    const bytes = fs.readFileSync(await download.path());
    const saved = JSON.parse(bytes.toString("utf8"));
    assert.equal(saved.models[0].nodes.length, 3);
    assert.equal(saved.models[0].edges.length, 2);
    await page.locator("#builder-dialog .dlg-foot button").click();
    assert.equal(await page.locator('.pane .node[data-node="' + task.id + '"]').count(), 1, "the real canvas was rebuilt");
    assert.equal(await page.locator(".process-builder script, .process-builder img").count(), 0, "names are text");
    await page.setInputFiles("#file-input", { name: "saved.engagement.json", mimeType: "application/json", buffer: bytes });
    await page.waitForFunction(id => window.AIxRay.app.fileName === "saved.engagement.json" && window.AIxRay.app.store.get().id === id, saved.id);
    e = await engagement(page);
    assert.deepEqual(e.models, saved.models);
    await page.locator('[data-builder="open-editor"]').click();
    assert.match(await control(page, "checks").innerText(), /Structure checks \(0\)/);
    assert.equal(await control(page, "model-name").inputValue(), "Current state");
    clean(problems);
  });
}

test("lane changes, gateways, reconnect, undo and future alternatives work from the editor", { timeout: 60000 }, async t => {
  const { page, problems } = await open(t);
  await create(page);
  await control(page, "new-lane-name").fill("Reviewers");
  await control(page, "add-lane").click();
  let m = (await engagement(page)).models[0];
  const reviewLane = m.lanes.find(l => l.name === "Reviewers").id;
  await control(page, "lane-name").fill("Quality review");
  await control(page, "update-lane").click();
  await control(page, "lane-up").click();
  m = (await engagement(page)).models[0]; assert.equal(m.lanes[0].id, reviewLane);
  await control(page, "new-node-name").fill("Review request");
  await control(page, "insert-flow").selectOption(m.edges[0].id);
  await control(page, "add-node").click();
  m = (await engagement(page)).models[0];
  const task = m.nodes.find(n => n.label === "Review request"), start = m.nodes[0].id, end = m.nodes[1].id;
  await expand(page, "Edit or delete steps");
  await control(page, "node-lane").selectOption("team");
  await control(page, "update-node").click();
  assert.equal((await engagement(page)).models[0].nodes.find(n => n.id === task.id).laneId, "team");
  await control(page, "new-node-name").fill("Decision");
  await control(page, "new-node-type").selectOption("exclusiveGateway");
  await control(page, "add-node").click();
  m = (await engagement(page)).models[0]; const decision = m.nodes.find(n => n.label === "Decision");
  await control(page, "flow-from").selectOption(decision.id);
  await control(page, "flow-to").selectOption(task.id);
  await control(page, "flow-type").selectOption("conditional");
  await control(page, "flow-label").fill("Requires review");
  await control(page, "add-flow").click();
  await control(page, "flow-from").selectOption(decision.id);
  await control(page, "flow-to").selectOption(end);
  await control(page, "flow-type").selectOption("default");
  await control(page, "flow-label").fill("Otherwise");
  await control(page, "add-flow").click();
  await control(page, "flow-from").selectOption(decision.id);
  await control(page, "flow-to").selectOption(task.id);
  await control(page, "flow-type").selectOption("default");
  await control(page, "add-flow").click();
  assert.match(await control(page, "error").innerText(), /only one default/);
  await expand(page, "Reconnect or delete flows");
  m = (await engagement(page)).models[0];
  const startFlow = m.edges.find(ed => ed.from === start).id;
  await control(page, "flow").selectOption(startFlow);
  await expand(page, "Reconnect or delete flows");
  await control(page, "edit-flow-to").selectOption(decision.id);
  await control(page, "update-flow").click();
  assert.match(await control(page, "checks").innerText(), /Structure checks \(0\)/);
  await control(page, "undo").click();
  assert.equal((await engagement(page)).models[0].edges.find(ed => ed.id === startFlow).to, task.id);
  await expand(page, "Future alternatives");
  await control(page, "alternative-name").fill("Simplify routing");
  await control(page, "clone").click();
  let e = await engagement(page), future = e.models.find(x => x.role === "future");
  assert.equal(e.models[0].locked, true); assert.equal(future.name, "Simplify routing");
  await expand(page, "Edit or delete steps");
  await control(page, "node").selectOption(task.id);
  await expand(page, "Edit or delete steps");
  await control(page, "node-name").fill("Review once");
  await control(page, "update-node").click();
  e = await engagement(page); future = e.models.find(x => x.role === "future");
  assert.equal(future.nodes.find(n => n.id === task.id).lineage.change, "modified");
  assert.equal(e.models[0].nodes.find(n => n.id === task.id).label, "Review request");
  await control(page, "model").selectOption("m-current");
  assert.equal(await control(page, "add-node").isDisabled(), true);
  clean(problems);
});

test("existing graph timings are cleared by authoring and restored with undo", { timeout: 60000 }, async t => {
  const { page, problems } = await open(t, "file", "#example=underwriting-current-state");
  await page.waitForSelector(".node");
  await page.locator('[data-builder="open-editor"]').click();
  const before = await engagement(page), m = before.models[0];
  assert.ok(before.scenarios.some(s => s.runs[m.id]));
  await control(page, "new-node-name").fill("New review");
  await control(page, "insert-flow").selectOption(m.edges.find(ed => !ed.removed).id);
  await control(page, "add-node").click();
  const changed = await engagement(page);
  assert.ok(changed.scenarios.every(s => !s.runs[m.id]));
  assert.match(await control(page, "status").innerText(), /Cleared .* scenario run/);
  await control(page, "undo").click();
  assert.deepEqual((await engagement(page)).scenarios.map(s => s.runs), before.scenarios.map(s => s.runs));
  clean(problems);
});
