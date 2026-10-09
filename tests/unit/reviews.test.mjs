// Client review packs: choosing the items, the Excel pack and reading it
// back, checking a response against the engagement, and the review/apply
// command that records it (lib/reviews.js).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { lib, root, tinyEngagement, example } from "./helpers.mjs";

const reviews = lib("reviews");
const storeLib = lib("store");
const validate = lib("validate");
const xlsx = lib("xlsx");
const zip = lib("zip");
const ooxml = lib("ooxml");

const inflateRaw = bytes => zlib.inflateRawSync(bytes);
const deflateRaw = bytes => zlib.deflateRawSync(bytes);
const responseFixture = name => JSON.parse(fs.readFileSync(path.join(root, "tests", "fixtures", "reviews", name), "utf8"));

/* The tiny engagement with findings of every handling kind. */
function engagement() {
  const e = tinyEngagement();
  const rec = (id, kind, title, extra) => Object.assign({ id, kind, title, description: "", owner: "", status: "open", priority: "",
    linkedModelId: "m-current", linkedModelVersion: 1, linkedNodeIds: ["work"], evidenceRefs: [], sensitive: false, includeInHandoff: true,
    opportunity: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }, extra || {});
  e.records = [
    rec("r-pain", "pain", "Work is rekeyed", { description: "Copied by hand from email." }),
    rec("r-opp", "opportunity", "Pre-fill the form", { opportunity: {} }),
    rec("r-secret", "pain", "Named staff member is slow", { sensitive: true }),
    rec("r-ai", "pain", "AI drafted finding", { generated: { task: "opportunities", provider: "claude", surface: "cli", reviewed: false, reviewedAt: "" } }),
    rec("r-dropped", "decision", "Old decision", { status: "dropped" }),
    rec("r-hidden", "decision", "Not for the handoff", { includeInHandoff: false }),
    rec("r-question", "question", "Who signs off?", { linkedNodeIds: [] })
  ];
  const v = validate.validateEngagement(e);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  return v.engagement;
}

function packed(store, opts) {
  const e = store.get();
  const items = reviews.buildPackItems(e, Object.assign({ modelId: "m-current" }, opts || {}));
  const pack = reviews.newPack(e, { format: "xlsx", stakeholder: { name: "A. Client", role: "Ops lead", organization: "Client Co" }, modelId: "m-current", note: "Thanks" }, items);
  const payload = reviews.packPayload(e, pack, items);
  store.dispatch("review/recordPack", { pack });
  return { pack, payload, items };
}

function response(e, packId, entries, extra) {
  return Object.assign({
    schema: "bpmviz.review-response", schemaVersion: 1, packId, engagementId: e.id, engagementRevision: e.revision, format: "html",
    reviewer: { name: "A. Client", role: "Ops lead", organization: "Client Co" }, submittedAt: "2026-03-04T10:00:00.000Z", generalComment: "Mostly right",
    entries
  }, extra || {});
}

/* Turns every inline string of a written workbook into a shared string, as Excel does when it saves. */
function excelResave(parts, opts) {
  const o = opts || {};
  const strings = [];
  const out = parts.filter(p => !(o.dropHidden && p.name === "xl/worksheets/sheet3.xml")).map(p => {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(p.name)) return p;
    const data = p.data.replace(/<c r="([A-Z]+\d+)"( s="\d+")? t="inlineStr"><is><t xml:space="preserve">([\s\S]*?)<\/t><\/is><\/c>/g, (m, ref, s, t) => {
      strings.push(t);
      return "<c r=\"" + ref + "\"" + (s || "") + " t=\"s\"><v>" + (strings.length - 1) + "</v></c>";
    });
    return { name: p.name, data };
  }).map(p => {
    if (p.name === "[Content_Types].xml") {
      return { name: p.name, data: p.data.replace("</Types>", "<Override PartName=\"/xl/sharedStrings.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml\"/></Types>") };
    }
    if (p.name === "xl/_rels/workbook.xml.rels") {
      return { name: p.name, data: p.data.replace("</Relationships>", "<Relationship Id=\"rId99\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings\" Target=\"sharedStrings.xml\"/></Relationships>") };
    }
    if (o.dropHidden && p.name === "xl/workbook.xml") return { name: p.name, data: p.data.replace(/<sheet name="bpmviz-pack"[^>]*\/>/, "") };
    return p;
  });
  out.push({ name: "xl/sharedStrings.xml", data: ooxml.XML_HEAD + "<sst xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" count=\"" + strings.length + "\" uniqueCount=\"" + strings.length + "\">" +
    strings.map(t => "<si><r><t xml:space=\"preserve\">" + t + "</t></r></si>").join("") + "</sst>" });
  return out;
}

test("a pack lists the model's steps by lane and flow, then the findings in the handoff", () => {
  const e = engagement();
  const items = reviews.buildPackItems(e, { modelId: "m-current" });
  assert.deepEqual(items.map(i => i.itemRef), ["step/m-current/work", "step/m-current/check", "step/m-current/fix", "record/r-pain", "record/r-opp"]);
  assert.deepEqual(items.map(i => i.type), ["Step", "Decision point", "Step", "Pain point", "Opportunity"]);
  assert.equal(items[0].lane, "Team A");
  assert.equal(items[3].details, "Copied by hand from email. Steps: Do the work.");
  assert.equal(items[3].lane, "Team A");
  // Sensitive records and AI drafts only when asked; dropped and non-handoff records never.
  const all = reviews.buildPackItems(e, { modelId: "m-current", steps: false, kinds: reviews.FINDING_KINDS, includeSensitive: true, includeUnreviewedAi: true });
  assert.deepEqual(all.map(i => i.itemRef), ["record/r-pain", "record/r-secret", "record/r-ai", "record/r-opp", "record/r-question"]);
  const counts = reviews.packCounts(e, { modelId: "m-current" });
  assert.equal(counts.steps, 3);
  assert.equal(counts.records.pain, 1);
  assert.equal(counts.records.question, 1);
  // A recorded pack can be rebuilt from its item references.
  const again = reviews.buildPackItems(e, { modelId: "m-current", itemRefs: ["record/r-opp", "step/m-current/fix"] });
  assert.deepEqual(again.map(i => i.itemRef), ["step/m-current/fix", "record/r-opp"]);
});

test("review/recordPack stores a checked pack and refuses an empty one", () => {
  const store = storeLib.createStore(engagement());
  const { pack, payload } = packed(store);
  const e = store.get();
  assert.equal(e.reviewPacks.length, 1);
  assert.equal(e.reviewPacks[0].id, pack.id);
  assert.equal(e.reviewPacks[0].engagementRevision, 0);
  assert.equal(e.reviewPacks[0].items.length, 5);
  assert.equal(payload.engagementId, "eng-tiny");
  assert.equal(payload.responseSchema, "bpmviz.review-response");
  assert.deepEqual(payload.verdicts.map(v => v.label), ["Confirm", "Dispute", "Not sure"]);
  assert.throws(() => store.dispatch("review/recordPack", { pack: Object.assign({}, pack, { id: "rp-empty", items: [] }) }), /at least one/);
  assert.throws(() => store.dispatch("review/recordPack", { pack }), /Duplicate ID/);
  assert.equal(validate.validateEngagement(store.get()).ok, true);
});

test("the Excel pack round-trips, including an Excel re-save with shared strings", async () => {
  const store = storeLib.createStore(engagement());
  const { pack, payload } = packed(store);
  const spec = reviews.workbookSpec(pack, payload);
  assert.deepEqual(spec.sheets.map(s => [s.name, !!s.hidden]), [["About", false], ["Review", false], ["bpmviz-pack", true]]);
  assert.deepEqual(spec.sheets[1].rows[0], reviews.REVIEW_HEADERS);
  assert.deepEqual(spec.sheets[1].validations, [{ range: "F2:F6", list: ["Confirm", "Dispute", "Not sure"] }]);
  const fill = rows => {
    rows[1][5] = "Confirm";
    rows[2][5] = "Dispute"; rows[2][6] = "Two people check this";
    rows[4][5] = "Not sure"; rows[4][6] = "Only for large cases";
  };
  // Our own writer, read back.
  const filled = reviews.workbookSpec(pack, payload);
  fill(filled.sheets[1].rows);
  filled.sheets[0].rows.find(r => r[0] === "General comment")[1] = "Looks right overall";
  const bytes = await xlsx.workbookBytesAsync(filled, { deflateRaw });
  const r1 = reviews.responseFromWorkbook(await xlsx.readWorkbookAsync(bytes, { inflateRaw }));
  assert.equal(r1.packId, pack.id);
  assert.equal(r1.engagementId, "eng-tiny");
  assert.equal(r1.engagementRevision, 0);
  assert.equal(r1.format, "xlsx");
  assert.deepEqual(r1.reviewer, { name: "A. Client", role: "Ops lead", organization: "Client Co" });
  assert.equal(r1.generalComment, "Looks right overall");
  assert.deepEqual(r1.entries.map(x => x.verdict), ["confirm", "dispute", "", "unsure", ""]);
  assert.equal(r1.entries[1].comment, "Two people check this");
  // Excel's own save: shared strings with rich-text runs, and in a second copy the hidden sheet is gone.
  for (const dropHidden of [false, true]) {
    const parts = excelResave(xlsx.writeWorkbook(filled), { dropHidden });
    const wb = await xlsx.readWorkbookAsync(await zip.writeZipAsync(parts, { deflateRaw }), { inflateRaw });
    assert.equal(wb.sheets.some(s => s.name === "bpmviz-pack"), !dropHidden);
    const r2 = reviews.responseFromWorkbook(wb);
    assert.deepEqual(r2.entries, r1.entries, "dropHidden " + dropHidden);
    assert.equal(r2.packId, pack.id);
    assert.equal(validate.validateReviewResponse(r2, store.get()).ok, true);
  }
});

test("Excel answers are matched by header and verdict wording is normalized", () => {
  const wb = { sheets: [
    { name: "About", rows: [["Your name", "B. Reviewer"], ["Your role", 42], ["Pack reference", "rp-1"], ["Engagement reference", "eng-tiny"], ["Engagement revision", "3"]] },
    { name: "Answers", rows: [["Process review"], [], ["Comment", "Verdict", "Item", "Item ID"],
      ["fine", "Yes", "Do the work", "step/m-current/work"], ["", " disagree ", "Check", "step/m-current/check"],
      ["?", "maybe", "Fix", "step/m-current/fix"], ["no item id", "Confirm", "", ""], ["odd", "Perhaps later", "Pain", "record/r-pain"]] }
  ] };
  const r = reviews.responseFromWorkbook(wb);
  assert.equal(r.packId, "rp-1");
  assert.equal(r.engagementRevision, 3);
  assert.equal(r.reviewer.role, "42");
  assert.deepEqual(r.entries.map(x => [x.itemRef, x.verdict, x.comment]), [
    ["step/m-current/work", "confirm", "fine"], ["step/m-current/check", "dispute", ""], ["step/m-current/fix", "unsure", "?"],
    ["record/r-pain", "Perhaps later", "odd"]]);
  const checked = validate.validateReviewResponse(r, engagement());
  assert.equal(checked.ok, true);
  assert.equal(checked.response.entries[3].verdict, "", "an unrecognized verdict is no answer, never confirm");
  ["Confirmed", "OK", "correct", "No", "Incorrect", "Not sure", "don't know", "", null, true].forEach(v => assert.ok(["confirm", "dispute", "unsure", ""].includes(reviews.normalizeVerdict(v)), String(v)));
  assert.equal(reviews.normalizeVerdict("don't know"), "unsure");
  assert.throws(() => reviews.responseFromWorkbook({ sheets: [{ name: "Events", rows: [["case", "activity"]] }] }), /not a BPMVIZ review pack/);
  assert.throws(() => reviews.responseFromWorkbook({ sheets: [{ name: "About", rows: [["Pack reference", "rp-1"], ["Engagement reference", "eng-tiny"]] }] }), /Review sheet/);
});

test("a response for another engagement is refused", () => {
  const e = engagement();
  const p = reviews.prepareApply(e, response(e, "rp-x", [{ itemRef: "step/m-current/work", verdict: "confirm" }], { engagementId: "eng-other" }));
  assert.equal(p.ok, false);
  assert.match(p.errors[0].message, /different engagement/);
  const fixture = reviews.prepareApply(validate.validateEngagement(example("underwriting-current-state")).engagement, responseFixture("other-engagement.review-response.json"));
  assert.equal(fixture.ok, false);
  assert.equal(reviews.prepareApply(e, { schema: "bpmviz.engagement" }).ok, false);
});

test("prepareApply works out the changes, flags renamed steps and counts the answers", () => {
  const store = storeLib.createStore(engagement());
  const { pack } = packed(store);
  store.dispatch("node/update", { modelId: "m-current", nodeId: "fix", patch: { label: "Repair the work" } });
  store.dispatch("node/update", { modelId: "m-current", nodeId: "check", patch: { provenance: { validation: "disputed" } } });
  const e = store.get();
  const p = reviews.prepareApply(e, response(e, pack.id, [
    { itemRef: "step/m-current/work", verdict: "confirm", comment: "" },
    { itemRef: "step/m-current/check", verdict: "dispute", comment: "Two checks, not one" },
    { itemRef: "step/m-current/fix", verdict: "unsure", comment: "" },
    { itemRef: "record/r-pain", verdict: "", comment: "Only on Mondays" },
    { itemRef: "record/r-opp", verdict: "", comment: "" },
    { itemRef: "step/m-current/gone", verdict: "confirm" }
  ], { engagementRevision: 0 }));
  assert.equal(p.ok, true);
  assert.deepEqual(p.counts, { confirm: 1, dispute: 1, unsure: 1, blank: 2, unanswered: 1, total: 5 });
  const by = Object.fromEntries(p.items.map(i => [i.itemRef, i]));
  assert.equal(by["step/m-current/work"].targetValidation, "validated");
  assert.equal(by["step/m-current/check"].targetValidation, "disputed");
  assert.equal(by["step/m-current/check"].currentValidation, "disputed");
  assert.equal(by["step/m-current/fix"].targetValidation, null, "not sure leaves a step unchanged");
  assert.equal(by["step/m-current/fix"].renamed, true);
  assert.equal(by["step/m-current/fix"].packLabel, "Fix");
  assert.equal(by["record/r-pain"].verdict, "");
  assert.equal(by["record/r-opp"], undefined, "unanswered items are left out");
  const codes = p.warnings.map(w => w.code);
  assert.ok(codes.includes("review.renamed"));
  assert.ok(codes.includes("review.revision"));
  assert.ok(codes.includes("ref.dangling"));
  const payload = reviews.buildApplyPayload(e, p, {});
  assert.deepEqual(payload.validations, [{ modelId: "m-current", nodeId: "work", validation: "validated" }], "unchanged validations are not repeated");
  assert.deepEqual(payload.questions.map(q => q.title), ["Disputed in client review: Check", "Not confirmed in client review: Work is rekeyed"]);
  assert.deepEqual(payload.questions[1].linkedNodeIds, ["work"]);
  assert.match(payload.questions[0].description, /A\. Client, Ops lead, Client Co \(2026-03-04\) on "Check": Two checks, not one/);
  assert.equal(payload.evidence.title, "Client review: A. Client, Ops lead, Client Co, 2026-03-04");
  assert.deepEqual(payload.evidence.steps, [{ modelId: "m-current", nodeId: "work" }]);
  assert.equal(payload.review.entries.find(x => x.itemRef === "record/r-pain").verdict, "unsure", "a comment without a verdict is kept as not sure");
  const none = reviews.buildApplyPayload(e, p, { validations: false, questions: false, evidence: false });
  assert.deepEqual([none.validations, none.questions, none.evidence], [[], [], null]);
  // A pack this engagement does not know is matched by item IDs.
  const fx = responseFixture("underwriting-current.review-response.json");
  const uw = validate.validateEngagement(example("underwriting-current-state")).engagement;
  const q = reviews.prepareApply(uw, fx);
  assert.equal(q.ok, true, JSON.stringify(q.errors));
  assert.ok(q.warnings.some(w => w.code === "review.pack"));
  assert.equal(q.items.length, 4);
});

test("review/apply works on a locked baseline without marking steps modified, and undoes in one step", () => {
  const store = storeLib.createStore(engagement());
  const { pack } = packed(store);
  store.dispatch("model/clone", { sourceModelId: "m-current", name: "Future" });
  const before = store.get();
  assert.equal(before.models[0].locked, true);
  const futureId = before.models[1].id;
  const p = reviews.prepareApply(before, response(before, pack.id, [
    { itemRef: "step/m-current/work", verdict: "confirm", comment: "Yes" },
    { itemRef: "step/m-current/check", verdict: "dispute", comment: "Two checks" },
    { itemRef: "step/" + futureId + "/fix", verdict: "confirm", comment: "" },
    { itemRef: "record/r-opp", verdict: "unsure", comment: "Cost?" }
  ]));
  assert.equal(p.ok, true, JSON.stringify(p.errors));
  assert.equal(p.items[0].locked, true);
  const result = store.dispatch("review/apply", reviews.buildApplyPayload(before, p, {}));
  const e = store.get();
  const node = (m, id) => e.models.find(x => x.id === m).nodes.find(n => n.id === id);
  assert.equal(node("m-current", "work").provenance.validation, "validated");
  assert.equal(node("m-current", "check").provenance.validation, "disputed");
  assert.equal(node(futureId, "fix").provenance.validation, "validated");
  assert.equal(node(futureId, "fix").lineage.change, "unchanged", "a review is not a process change");
  assert.equal(e.models[0].locked, true);
  assert.equal(result.validations, 3);
  assert.equal(result.questions.length, 2);
  const ev = e.evidence.find(x => x.id === result.evidenceId);
  assert.equal(ev.status, "validated");
  assert.equal(ev.reviewer, "A. Client");
  assert.deepEqual(node("m-current", "work").provenance.evidenceRefs, [ev.id]);
  assert.deepEqual(node("m-current", "check").provenance.evidenceRefs, []);
  const questions = e.records.filter(r => result.questions.includes(r.id));
  assert.deepEqual(questions.map(q => [q.kind, q.evidenceRefs[0] === ev.id, q.includeInHandoff]), [["question", true, true], ["question", true, true]]);
  const review = e.reviews[0];
  assert.equal(review.packId, pack.id);
  assert.deepEqual(review.applied, { validations: 3, questions: 2, evidenceId: ev.id });
  assert.equal(review.entries.length, 4);
  assert.equal(validate.validateEngagement(e).ok, true);
  // Node edits on the locked baseline are still refused.
  assert.throws(() => store.dispatch("node/update", { modelId: "m-current", nodeId: "work", patch: { label: "x" } }), /locked/);
  store.undo();
  const undone = store.get();
  assert.equal((undone.reviews || []).length, 0);
  assert.equal(undone.records.length, before.records.length);
  assert.equal(undone.evidence.length, before.evidence.length);
  assert.equal(undone.models[0].nodes.find(n => n.id === "work").provenance.validation, "unvalidated");
});

test("the latest answer wins and earlier answers stay visible", () => {
  const store = storeLib.createStore(engagement());
  const { pack } = packed(store);
  const apply = (entries, extra) => {
    const e = store.get();
    const p = reviews.prepareApply(e, response(e, pack.id, entries, extra));
    assert.equal(p.ok, true, JSON.stringify(p.errors));
    store.dispatch("review/apply", reviews.buildApplyPayload(e, p, { questions: false, evidence: false }));
    return p;
  };
  apply([{ itemRef: "step/m-current/work", verdict: "confirm" }], { submittedAt: "2026-03-10T09:00:00Z", reviewer: { name: "Later" } });
  const p = apply([{ itemRef: "step/m-current/work", verdict: "dispute", comment: "Not how it works" }], { submittedAt: "2026-03-01T09:00:00Z", reviewer: { name: "Earlier" } });
  const conflict = p.warnings.find(w => w.code === "review.conflict");
  assert.match(conflict.message, /Later answered confirm on 2026-03-10/);
  assert.match(conflict.message, /older/);
  assert.equal(p.items[0].superseded, true);
  assert.equal(p.items[0].targetValidation, null, "an older answer does not overwrite a newer one");
  const e = store.get();
  assert.equal(e.models[0].nodes.find(n => n.id === "work").provenance.validation, "validated");
  const latest = reviews.latestVerdicts(e).get("step/m-current/work");
  assert.equal(latest.verdict, "confirm");
  assert.equal(latest.reviewer.name, "Later");
  assert.equal(latest.conflict, true);
  assert.deepEqual(latest.history.map(h => h.reviewer.name), ["Earlier", "Later"]);
  // The same file imported twice is flagged.
  const again = reviews.prepareApply(e, response(e, pack.id, [{ itemRef: "step/m-current/work", verdict: "confirm" }], { submittedAt: "2026-03-10T09:00:00Z", reviewer: { name: "Later" } }));
  assert.ok(again.warnings.some(w => w.code === "review.again"));
  const sum = reviews.summarize(e);
  assert.equal(sum.reviews, 2);
  assert.deepEqual(sum.steps, { confirm: 1, dispute: 0, unsure: 0 });
  assert.deepEqual(sum.reviewers, ["Later", "Earlier"]);
});

test("summaries leave out sensitive findings, and deletes keep references valid", () => {
  const store = storeLib.createStore(engagement());
  const { pack } = packed(store, { includeSensitive: true });
  const e0 = store.get();
  const p = reviews.prepareApply(e0, response(e0, pack.id, [
    { itemRef: "record/r-secret", verdict: "dispute", comment: "Unfair" },
    { itemRef: "record/r-pain", verdict: "confirm" }
  ]));
  const { id } = store.dispatch("review/apply", reviews.buildApplyPayload(e0, p, { questions: false }));
  assert.deepEqual(reviews.summarize(store.get()).findings, { confirm: 1, dispute: 0, unsure: 0 });
  assert.deepEqual(reviews.summarize(store.get(), { includeSensitive: true }).findings, { confirm: 1, dispute: 1, unsure: 0 });
  store.dispatch("record/delete", { id: "r-secret" });
  assert.deepEqual(store.get().reviews[0].entries.map(x => x.itemRef), ["record/r-pain"]);
  assert.equal(store.get().reviewPacks[0].items.some(x => x.itemRef === "record/r-secret"), false);
  const evId = store.get().reviews[0].applied.evidenceId;
  store.dispatch("evidence/delete", { id: evId });
  assert.equal(store.get().reviews[0].applied.evidenceId, null);
  store.dispatch("review/deletePack", { id: pack.id });
  assert.equal(store.get().reviews[0].packId, null);
  store.dispatch("review/delete", { id });
  assert.equal(store.get().reviews.length, 0);
  assert.throws(() => store.dispatch("review/delete", { id }), /not found/);
  assert.equal(validate.validateEngagement(store.get()).ok, true);
});

test("review commands are registered once and check their input", () => {
  assert.throws(() => storeLib.registerCommands(reviews.commands), /already registered/);
  const store = storeLib.createStore(engagement());
  assert.throws(() => store.dispatch("review/apply", {}), /no review/);
  assert.throws(() => store.dispatch("review/apply", { review: { entries: [] }, validations: [{ modelId: "m-current", nodeId: "nope", validation: "validated" }] }), /Step not found/);
  assert.throws(() => store.dispatch("review/apply", { review: { entries: [] }, validations: [{ modelId: "m-current", nodeId: "work", validation: "great" }] }), /Unknown validation/);
  const r = store.dispatch("review/apply", { review: { reviewer: { name: "X" }, entries: [{ itemRef: "step/m-current/work", verdict: "confirm" }] } });
  assert.equal(store.get().reviews[0].id, r.id);
  assert.deepEqual(store.get().reviews[0].applied, { validations: 0, questions: 0, evidenceId: null });
});

test("Excel pack text that starts like a formula is neutralized and reads back unchanged", async () => {
  const store = storeLib.createStore(engagement());
  store.dispatch("node/update", { modelId: "m-current", nodeId: "work", patch: { label: "=HYPERLINK(\"http://evil\",\"x\")", details: { desc: "+cmd|' /C calc'!A0" } } });
  store.dispatch("record/update", { id: "r-pain", patch: { title: "-2 days of rework", description: "@SUM(1)" } });
  const e = store.get();
  const items = reviews.buildPackItems(e, { modelId: "m-current" });
  const pack = reviews.newPack(e, { format: "xlsx", stakeholder: { name: "@SUM(1)", role: "=1+1", organization: "+Org" }, modelId: "m-current", note: "-Answer by Friday" }, items);
  store.dispatch("review/recordPack", { pack });
  const spec = reviews.workbookSpec(pack, reviews.packPayload(store.get(), pack, items));
  const risky = /^[=+\-@\t\r]/;
  spec.sheets.forEach(s => s.rows.forEach(row => row.forEach(cell => {
    assert.equal(typeof cell === "string" && risky.test(cell), false, s.name + ": " + cell);
  })));
  const review = spec.sheets.find(s => s.name === "Review").rows;
  const work = review.find(r => r[0] === "step/m-current/work");
  assert.equal(work[3], "'=HYPERLINK(\"http://evil\",\"x\")");
  assert.match(work[4], /^'\+cmd/);
  assert.equal(review.find(r => r[0] === "record/r-pain")[3], "'-2 days of rework");
  const about = spec.sheets.find(s => s.name === "About").rows;
  assert.equal(about.find(r => r[0] === "Your name")[1], "'@SUM(1)");
  assert.equal(about.find(r => r[0] === "Note from the team")[1], "'-Answer by Friday");
  // The written sheets hold no text that starts like a formula either.
  xlsx.writeWorkbook(spec).filter(p => /^xl\/worksheets\/sheet\d+\.xml$/.test(p.name)).forEach(p => {
    for (const m of p.data.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) assert.equal(risky.test(m[1]), false, p.name + ": " + m[1]);
  });
  // Read back as written, and after the reviewer edits the name cell (Excel then stores it without the apostrophe).
  work[5] = "Confirm";
  work[6] = "=not a formula";
  const r1 = reviews.responseFromWorkbook(await xlsx.readWorkbookAsync(await xlsx.workbookBytesAsync(spec, { deflateRaw }), { inflateRaw }));
  assert.deepEqual(r1.reviewer, { name: "@SUM(1)", role: "=1+1", organization: "+Org" });
  assert.deepEqual(r1.entries.find(x => x.itemRef === "step/m-current/work"), { itemRef: "step/m-current/work", verdict: "confirm", comment: "=not a formula" });
  about.find(r => r[0] === "Your name")[1] = "@SUM(1)";
  const r2 = reviews.responseFromWorkbook(await xlsx.readWorkbookAsync(await xlsx.workbookBytesAsync(spec, { deflateRaw }), { inflateRaw }));
  assert.equal(r2.reviewer.name, "@SUM(1)");
  assert.equal(r2.packId, pack.id);
});

test("a pack downloaded again leaves out records that became sensitive or left the handoff", () => {
  const store = storeLib.createStore(engagement());
  const { pack } = packed(store);
  const refs = pack.items.map(i => i.itemRef);
  assert.ok(refs.includes("record/r-pain") && refs.includes("record/r-opp"));
  const again = scope => reviews.buildPackItems(store.get(), Object.assign({ modelId: pack.modelId, itemRefs: refs }, scope || {})).map(i => i.itemRef);
  assert.deepEqual(again(), refs);
  store.dispatch("record/update", { id: "r-pain", patch: { sensitive: true } });
  store.dispatch("record/update", { id: "r-opp", patch: { includeInHandoff: false } });
  const left = again();
  assert.equal(left.includes("record/r-pain"), false);
  assert.equal(left.includes("record/r-opp"), false);
  assert.equal(left.length, refs.length - 2);
  assert.equal(again({ includeSensitive: true }).includes("record/r-pain"), true, "the Present bar choice still applies");
  store.dispatch("record/update", { id: "r-pain", patch: { status: "dropped" } });
  assert.equal(again({ includeSensitive: true }).includes("record/r-pain"), false);
});

test("an Excel response without a date that follows a dated response is the current answer", async () => {
  const store = storeLib.createStore(engagement());
  const { pack, payload } = packed(store);
  let e = store.get();
  const html = reviews.prepareApply(e, response(e, pack.id, [{ itemRef: "step/m-current/work", verdict: "dispute", comment: "Not like this" }], { submittedAt: "2026-01-01T09:00:00Z" }));
  store.dispatch("review/apply", reviews.buildApplyPayload(e, html, { questions: false, evidence: false }));
  const spec = reviews.workbookSpec(pack, payload);
  spec.sheets[1].rows.find(r => r[0] === "step/m-current/work")[5] = "Confirm";
  const fromXlsx = reviews.responseFromWorkbook(await xlsx.readWorkbookAsync(await xlsx.workbookBytesAsync(spec, { deflateRaw }), { inflateRaw }));
  assert.equal(fromXlsx.submittedAt, "");
  e = store.get();
  const p = reviews.prepareApply(e, fromXlsx);
  assert.equal(p.ok, true, JSON.stringify(p.errors));
  const it = p.items.find(x => x.itemRef === "step/m-current/work");
  assert.equal(it.superseded, false);
  assert.equal(it.targetValidation, "validated");
  assert.match(p.warnings.find(w => w.code === "review.conflict").message, /The latest answer becomes current/);
  store.dispatch("review/apply", reviews.buildApplyPayload(e, p, { questions: false, evidence: false }));
  e = store.get();
  assert.equal(e.models[0].nodes.find(n => n.id === "work").provenance.validation, "validated");
  assert.equal(reviews.latestVerdicts(e).get("step/m-current/work").verdict, "confirm", "the validation and the latest answer agree");
});
