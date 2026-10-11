// Files and browser drafts saved before the app was renamed from BPMVIZ to
// AIxRay still open (schema.js LEGACY_FORMAT_IDS), and AIxRay writes the
// current format tags when it saves them again.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { lib, root, tinyEngagement, example } from "./helpers.mjs";

const schema = lib("schema");
const validate = lib("validate");
const ai = lib("ai-results");
const reviews = lib("reviews");
const storeLib = lib("store");
const xlsx = lib("xlsx");
const persistence = lib("persistence");

const inflateRaw = bytes => zlib.inflateRawSync(bytes);
const deflateRaw = bytes => zlib.deflateRawSync(bytes);
const responseFixture = name => JSON.parse(fs.readFileSync(path.join(root, "tests", "fixtures", "reviews", name), "utf8"));

test("every old BPMVIZ format tag maps to the current AIxRay tag", () => {
  assert.equal(schema.currentFormatId("bpmviz.engagement"), schema.SCHEMA_ID);
  assert.equal(schema.currentFormatId("bpmviz.review-response"), schema.REVIEW_RESPONSE_ID);
  assert.equal(schema.currentFormatId("bpmviz.review-pack"), schema.REVIEW_PACK_ID);
  assert.equal(schema.currentFormatId("bpmviz.ai-result"), ai.RESULT_SCHEMA);
  assert.equal(schema.currentFormatId(schema.SCHEMA_ID), schema.SCHEMA_ID, "current tags pass through");
  assert.equal(schema.currentFormatId("other.thing"), "other.thing");
  assert.equal(schema.currentFormatId(undefined), undefined);
  assert.equal(schema.isLegacyFormatId("bpmviz.engagement"), true);
  assert.equal(schema.isLegacyFormatId(schema.SCHEMA_ID), false);
  assert.equal(schema.isLegacyFormatId("toString"), false, "only the listed tags count");
});

test("a project file saved by BPMVIZ opens, says so, and is written back with the AIxRay tag", () => {
  const old = Object.assign(example("underwriting-current-state"), { schema: "bpmviz.engagement" });
  const r = validate.validateEngagement(old);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.engagement.schema, schema.SCHEMA_ID);
  const note = r.warnings.find(w => w.code === "format.renamed");
  assert.ok(note, "an information note says the file came from BPMVIZ");
  assert.equal(note.level, "info");
  assert.match(note.message, /saved by BPMVIZ, the earlier name of AIxRay/);
  const same = validate.validateEngagement(example("underwriting-current-state"));
  assert.deepEqual(r.engagement.models, same.engagement.models, "the content is read exactly as before");
  assert.equal(same.warnings.some(w => w.code === "format.renamed"), false, "no note for a current file");
  assert.equal(validate.validateEngagement(Object.assign(tinyEngagement(), { schema: "bpmviz.other" })).ok, false);
});

test("review answers saved from a BPMVIZ form are accepted", () => {
  const fx = Object.assign(responseFixture("underwriting-current.review-response.json"), { schema: "bpmviz.review-response" });
  const e = validate.validateEngagement(example("underwriting-current-state")).engagement;
  const checked = validate.validateReviewResponse(fx, e);
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  assert.equal(checked.response.schema, schema.REVIEW_RESPONSE_ID);
  const prepared = reviews.prepareApply(e, fx);
  assert.equal(prepared.ok, true, JSON.stringify(prepared.errors));
  assert.equal(prepared.items.length, 4);
});

test("an Excel review form made by BPMVIZ, with the bpmviz-pack sheet, imports", async () => {
  const store = storeLib.createStore(tinyEngagement());
  const e = store.get();
  const items = reviews.buildPackItems(e, { modelId: "m-current" });
  const pack = reviews.newPack(e, { format: "xlsx", stakeholder: { name: "A. Client", role: "Ops lead", organization: "Client Co" }, modelId: "m-current", note: "" }, items);
  const payload = reviews.packPayload(e, pack, items);
  store.dispatch("review/recordPack", { pack });
  const spec = reviews.workbookSpec(pack, payload);
  const hidden = spec.sheets.find(s => s.name === reviews.PACK_SHEET);
  hidden.name = reviews.LEGACY_PACK_SHEET;
  hidden.rows = hidden.rows.map(r => r[0] === "schema" ? ["schema", "bpmviz.review-pack"] : r);
  // Drop the About sheet's references so the hidden sheet is the only source.
  const about = spec.sheets.find(s => s.name === reviews.ABOUT_SHEET);
  about.rows = about.rows.filter(r => !/reference/i.test(String(r[0])));
  spec.sheets.find(s => s.name === reviews.REVIEW_SHEET).rows[1][5] = "Confirm";
  const wb = await xlsx.readWorkbookAsync(await xlsx.workbookBytesAsync(spec, { deflateRaw }), { inflateRaw });
  assert.equal(wb.sheets.some(s => s.name === "bpmviz-pack"), true);
  const r = reviews.responseFromWorkbook(wb);
  assert.equal(r.packId, pack.id);
  assert.equal(r.engagementId, "eng-tiny");
  assert.equal(r.entries[0].verdict, "confirm");
  assert.equal(validate.validateReviewResponse(r, store.get()).ok, true);
});

test("an AI result file made by BPMVIZ is recognized and checked as usual", () => {
  const e = validate.validateEngagement(tinyEngagement()).engagement;
  const file = ai.makeEnvelope({
    task: "summary", engagementId: e.id, engagementRevision: e.revision, baselineModelId: null,
    generated: { tool: "bpmviz-ai", provider: "claude", model: "test-model", surface: "cli", at: "2026-09-01T00:00:00.000Z", jobId: "job-1", plan: "commercial" },
    dataHandling: { confidentiality: "internal", dataStatus: "supplied", approvalConfirmed: true },
    payload: { title: "t", text: "Short.", keyPoints: [], caveats: [] }
  });
  file.schema = "bpmviz.ai-result";
  assert.equal(ai.isAiResult(file), true);
  const v = ai.validateAiResult(file);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(v.result.task, "summary");
});

test("browser drafts and preferences saved under the bpmviz: keys move to aixray: once", () => {
  const storage = persistence.memoryStorage();
  const oldDraft = Object.assign(tinyEngagement(), { schema: "bpmviz.engagement", id: "eng-old" });
  storage.setItem("bpmviz:draft:eng-old", JSON.stringify({ savedAt: "2026-09-01T10:00:00.000Z", revision: 0, engagement: oldDraft }));
  storage.setItem("bpmviz:snapshots:eng-old", JSON.stringify([]));
  storage.setItem("bpmviz:index", JSON.stringify([{ id: "eng-old", savedAt: "2026-09-01T10:00:00.000Z", revision: 0, processName: "Old" }]));
  storage.setItem("bpmviz:pref:theme", "dark");
  // A draft already saved by AIxRay is kept as it is.
  storage.setItem("aixray:draft:eng-new", JSON.stringify({ savedAt: "2026-10-01T10:00:00.000Z", revision: 2, engagement: Object.assign(tinyEngagement(), { id: "eng-new" }) }));
  storage.setItem("aixray:index", JSON.stringify([{ id: "eng-new", savedAt: "2026-10-01T10:00:00.000Z", revision: 2, processName: "New" }]));
  storage.setItem("unrelated", "kept");

  const drafts = persistence.createDraftStore(storage);
  assert.deepEqual(drafts.listDrafts().map(d => d.id), ["eng-new", "eng-old"], "both drafts are listed, newest first");
  const restored = drafts.loadDraft("eng-old");
  assert.equal(restored.engagement.id, "eng-old");
  assert.equal(validate.validateEngagement(restored.engagement).ok, true, "the old draft opens");
  assert.equal(drafts.getPref("theme"), "dark");
  const keys = [];
  for (let i = 0; i < storage.length; i++) keys.push(storage.key(i));
  assert.equal(keys.some(k => k.startsWith("bpmviz:")), false, "no old keys are left");
  assert.ok(keys.includes("unrelated"));
  assert.equal(persistence.moveLegacyKeys(storage), 0, "a second run has nothing to move");
  assert.equal(persistence.moveLegacyKeys(null), 0);
});
