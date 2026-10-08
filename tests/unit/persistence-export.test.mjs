// Local drafts, exports and handoff: P0-05, P1-07, AC-8, AC-12.
import test from "node:test";
import assert from "node:assert/strict";
import { lib, example } from "./helpers.mjs";

const { createDraftStore, memoryStorage } = lib("persistence");
const exporting = lib("exporting");
const { validateEngagement } = lib("validate");

test("drafts save, list, load and clear", () => {
  const drafts = createDraftStore(memoryStorage());
  const e = example("rpa-delivery");
  assert.equal(drafts.available(), true);
  const saved = drafts.saveDraft(e);
  assert.equal(saved.ok, true);
  assert.equal(drafts.listDrafts()[0].id, e.id);
  assert.deepEqual(drafts.loadDraft(e.id).engagement, e);
  drafts.setPref("theme", "dark");
  assert.equal(drafts.clearAll(), true);
  assert.equal(drafts.loadDraft(e.id), null);
  assert.equal(drafts.getPref("theme"), "dark", "preferences survive clearing drafts");
});

test("earlier revisions are kept as recovery snapshots", () => {
  const drafts = createDraftStore(memoryStorage());
  const e = example("rpa-delivery");
  drafts.saveDraft(e);
  const next = JSON.parse(JSON.stringify(e));
  next.revision = 1;
  drafts.saveDraft(next);
  const snaps = drafts.listSnapshots(e.id);
  assert.equal(snaps.length, 1);
  assert.equal(drafts.loadSnapshot(e.id, 0).revision, 0);
});

test("storage failure is reported, not thrown", () => {
  const full = createDraftStore(memoryStorage({ failWrites: true }));
  const r = full.saveDraft(example("rpa-delivery"));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "quota");
  assert.equal(full.available(), false);
  const none = createDraftStore(null);
  assert.equal(none.saveDraft(example("rpa-delivery")).reason, "unavailable");
  assert.deepEqual(none.listDrafts(), []);
});

test("a corrupted draft is ignored", () => {
  const storage = memoryStorage();
  storage.setItem("bpmviz:draft:eng-x", "{broken");
  assert.equal(createDraftStore(storage).loadDraft("eng-x"), null);
});

function withRecords() {
  const e = example("underwriting");
  e.records = [
    { id: "r1", kind: "pain", title: "=HYPERLINK(\"http://x\")", owner: "Ops", status: "open", linkedModelId: "m-current", linkedNodeIds: ["scrub-sov-geocode"], includeInHandoff: true },
    { id: "r2", kind: "note", title: "Salary figures for named staff", sensitive: true, includeInHandoff: true },
    { id: "r3", kind: "action", title: "Confirm survey lead times", owner: "Risk engineering", status: "open", includeInHandoff: true },
    { id: "r4", kind: "decision", title: "Internal only", includeInHandoff: false }
  ];
  return validateEngagement(e).engagement;
}

test("CSV export guards against spreadsheet formulas and leaves out sensitive records", () => {
  const csv = exporting.recordsToCsv(withRecords(), {});
  assert.match(csv, /"'=HYPERLINK\(""http:\/\/x""\)"/);
  assert.doesNotMatch(csv, /Salary figures/);
  assert.match(csv, /Scrub SOV & Geocode/);
  assert.match(exporting.recordsToCsv(withRecords(), { includeSensitive: true }), /Salary figures/);
});

test("AC-12: the handoff carries scope, version, owners, status and evidence labels; sensitive notes stay out", () => {
  const h = exporting.buildHandoff(withRecords(), { scenarioId: "case-3" });
  assert.equal(h.title, "Large commercial property underwriting and issuance");
  assert.equal(h.dataStatus, "Demonstration data");
  assert.equal(h.models.length, 2);
  assert.equal(h.sections.action[0].owner, "Risk engineering");
  assert.equal(h.sections.action[0].status, "Open");
  assert.equal(h.sections.pain[0].steps[0], "Scrub SOV & Geocode");
  assert.equal(h.sections.note.length, 0);
  assert.equal(h.excludedSensitive, 1);
  assert.equal(h.sections.decision.length, 0, "records not marked for handoff are left out");
  assert.equal(h.evidence.unavailable, 1);
  assert.equal(h.reconciliation.status, "reconciled");
});

test("file names carry the revision", () => {
  assert.equal(exporting.fileBase(example("rpa-delivery")), "automation-center-of-excellence-sample-ai-assisted-rpa-delivery-r0");
});
