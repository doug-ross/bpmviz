import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { launch, serve, fileUrl, watch } from "../../tools/lib/browser.mjs";

let browser;
let server;
before(async () => {
  browser = await launch();
  assert.ok(browser, "Chrome or Edge must launch; browser skips do not verify assistant handoff");
  server = await serve();
});
after(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
});

async function open(t, mode = "file") {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  const problems = watch(page);
  t.after(async () => { await context.close(); });
  await page.goto((mode === "file" ? fileUrl() : server.url) + "#example=underwriting-current-state");
  await page.waitForFunction(() => !!window.AIxRay?.app?.store);
  await page.waitForSelector(".node");
  await page.evaluate(() => {
    const B = window.AIxRay;
    const e = B.util.clone(B.app.store.get());
    e.meta.confidentiality = "internal";
    e.meta.dataStatus = "supplied";
    B.app.store.replace(B.validate.validateEngagement(e).engagement, "test");
  });
  return { page, problems };
}
async function dialog(page) {
  await page.click("#btn-menu");
  await page.click("#menu-assistant-handoff");
  await page.waitForSelector("#ah-export");
}
async function approve(page) {
  await page.selectOption("#ah-plan", "commercial");
  await page.check("#ah-approval");
  await page.check("#ah-policy");
  await page.check("#ah-reviewed");
}
async function exportPacket(page) {
  const downloaded = page.waitForEvent("download");
  await page.click("#ah-export");
  const file = await downloaded;
  const stream = await file.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return { name: file.suggestedFilename(), text: Buffer.concat(chunks).toString("utf8") };
}
async function packetFrom(page, task = "summary") {
  return page.evaluate(task => {
    const B = window.AIxRay;
    return B.assistantHandoff.createPacket(B.app.store.get(), {
      provider: "copilot", task, baselineModelId: B.app.store.get().models[0].id,
      plan: "commercial", approvalConfirmed: true, policyConfirmed: true
    });
  }, task);
}
function complete(packet) {
  const result = structuredClone(packet.resultTemplate);
  result.payload = { title: "Handoff review", text: "Confirm ownership of exception checks.", keyPoints: [], caveats: ["No observed figures supplied."] };
  result.generated.at = "2026-10-15T12:00:00.000Z";
  return result;
}
const resultFile = result => ({ name: "completed.ai-result.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(result)) });
const state = page => page.evaluate(() => window.AIxRay.app.store.get());
const change = page => page.evaluate(() => {
  window.AIxRay.app.store.dispatch("record/add", { record: { kind: "question", title: "Who checks the handoff?" } });
});
function clean(problems) {
  assert.deepEqual(problems.errors, []);
  assert.deepEqual(problems.external, []);
}

for (const mode of ["file", "http"]) {
  test("assistant packet exports behind the current policy and preview check (" + mode + ")", async t => {
    const { page, problems } = await open(t, mode);
    await page.evaluate(() => {
      const store = window.AIxRay.app.store;
      store.dispatch("record/add", { record: { kind: "question", title: "Excluded private marker", sensitive: true } });
      store.dispatch("record/add", { record: { kind: "question", title: "<img src=x onerror=alert(1)>" } });
    });
    const before = await state(page);
    await dialog(page);
    assert.equal(await page.isDisabled("#ah-export"), true);
    await page.check("#ah-policy");
    assert.equal(await page.isDisabled("#ah-export"), true, "unknown plan blocks internal data");
    assert.equal(await page.locator("#ah-provider option").allTextContents().then(x => x.join(",")), "Codex,Claude Code,GitHub Copilot");
    await page.selectOption("#ah-provider", "copilot");
    await page.selectOption("#ah-task", "summary");
    await approve(page);
    assert.equal(await page.isDisabled("#ah-export"), false);
    assert.equal(await page.locator("#ah-preview img").count(), 0, "project content is text only");
    const file = await exportPacket(page);
    const packet = JSON.parse(file.text);
    assert.equal(packet.assistant.label, "GitHub Copilot");
    assert.equal(packet.assistant.planSource, "user-declared");
    assert.equal(packet.resultTemplate.generated.provider, "other");
    assert.equal(packet.resultTemplate.generated.model, "");
    assert.equal(packet.engagementRevision, before.revision);
    assert.equal(file.name, "assistant-summary-r" + before.revision + ".json");
    assert.equal(file.text.includes("Excluded private marker"), false);
    assert.equal(packet.input.records.some(r => r.title.startsWith("<img")), true);
    assert.equal(packet.payloadSchema.type, "object");
    assert.match(await page.getAttribute("meta[http-equiv='Content-Security-Policy']", "content"), /connect-src 'none'/);
    assert.equal((await state(page)).revision, before.revision, "export never changes the engagement");
    await page.selectOption("#ah-format", "text");
    const textFile = await exportPacket(page);
    assert.match(textFile.name, /\.txt$/);
    assert.match(textFile.text, /Return one complete JSON envelope/);
    await page.selectOption("#ah-provider", "claude");
    assert.equal(await page.inputValue("#ah-plan"), "unknown");
    assert.equal(await page.isChecked("#ah-policy"), false);
    assert.equal(await page.isDisabled("#ah-export"), true, "approval does not carry to another destination");
    clean(problems);
  });
}

test("completed packets import through openFile and the existing review, then apply and undo", async t => {
  const { page, problems } = await open(t);
  const packet = await packetFrom(page);
  const before = await state(page);
  await dialog(page);
  await page.setInputFiles("#ah-import", resultFile(complete(packet)));
  await page.waitForSelector("#ai-apply");
  assert.equal((await state(page)).revision, before.revision, "import itself is read only");
  await page.click("#ai-apply");
  await page.waitForSelector("#ai-apply", { state: "detached" });
  const after = await state(page);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.narratives.at(-1).generated.provider, "other");
  assert.equal(after.narratives.at(-1).generated.reviewed, false);
  await page.evaluate(() => window.AIxRay.app.store.undo());
  assert.equal((await state(page)).narratives.length, before.narratives.length);
  clean(problems);
});

test("stale and missing packet revisions need explicit review before existing Apply", async t => {
  const { page, problems } = await open(t);
  const packet = await packetFrom(page);
  await change(page);
  for (const revision of [packet.engagementRevision, null]) {
    const result = complete(packet);
    result.engagementRevision = revision;
    const current = await state(page);
    await dialog(page);
    await page.setInputFiles("#ah-import", resultFile(result));
    await page.waitForSelector("#ai-apply");
    assert.equal(await page.isDisabled("#ai-apply"), true);
    assert.match(await page.locator("dialog[open]").textContent(), new RegExp("I checked this draft against revision " + current.revision));
    await page.check("#ai-revision-reviewed");
    assert.equal(await page.isDisabled("#ai-apply"), false);
    await page.click("#ai-apply");
    await page.waitForSelector("#ai-apply", { state: "detached" });
    assert.equal((await state(page)).revision, current.revision + 1);
    assert.equal(result.engagementRevision, revision, "the imported binding is never rewritten");
  }
  clean(problems);
});

test("edits while reviewing reject Apply and another project ID never opens an applicable review", async t => {
  const { page, problems } = await open(t);
  const packet = await packetFrom(page);
  await dialog(page);
  await page.setInputFiles("#ah-import", resultFile(complete(packet)));
  await page.waitForSelector("#ai-apply");
  await change(page);
  const live = await state(page);
  await page.click("#ai-apply");
  assert.match(await page.locator("dialog[open]").textContent(), /project changed while this review was open/i);
  assert.equal((await state(page)).revision, live.revision);
  assert.equal((await state(page)).narratives.length, live.narratives.length);
  await page.locator("dialog[open] .dlg-foot button", { hasText: "Cancel" }).click();
  const wrongProject = complete(packet);
  wrongProject.engagementId = "different-project";
  await dialog(page);
  await page.setInputFiles("#ah-import", resultFile(wrongProject));
  await page.waitForSelector("dialog[open]");
  assert.equal(await page.locator("#ai-apply").count(), 0);
  assert.match(await page.locator("dialog[open]").textContent(), /different project/);
  assert.equal((await state(page)).revision, live.revision);
  clean(problems);
});

test("credentials block export and changed content requires preview review again", async t => {
  const { page, problems } = await open(t);
  await dialog(page);
  await approve(page);
  await change(page);
  // Re-running export re-reads live state and clears the obsolete preview approval.
  await page.click("#ah-export");
  assert.equal(await page.isDisabled("#ah-export"), true);
  assert.equal(await page.isChecked("#ah-reviewed"), false);
  await page.selectOption("#ah-task", "log-mapping");
  await page.fill("#ah-activities", "password=secret-example-value");
  assert.equal(await page.isDisabled("#ah-export"), true);
  assert.match(await page.locator("#ah-status").textContent(), /possible credential/);
  assert.equal((await page.locator("#ah-preview").textContent()).includes("secret-example-value"), false);
  clean(problems);
});

test("completed results with generic credentials are blocked before opening a review", async t => {
  const { page, problems } = await open(t);
  const packet = await packetFrom(page);
  const result = complete(packet);
  result.payload.text = "password=secret-example-value";
  const before = await state(page);
  await dialog(page);
  await page.setInputFiles("#ah-import", resultFile(result));
  await page.waitForFunction(() => document.getElementById("ah-status").textContent.includes("possible credential"));
  assert.equal(await page.locator("#ai-apply").count(), 0);
  assert.equal((await page.locator("dialog[open]").textContent()).includes("secret-example-value"), false);
  assert.equal((await state(page)).revision, before.revision);
  clean(problems);
});
