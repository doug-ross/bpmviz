// Value dimensions step 3: client sign-off on business case figures through
// the review form (lib/reviews.js). Confirming every figure in a part of a
// business case, or a project assumption, makes its basis Confirmed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { lib, root, example } from "./helpers.mjs";

const reviews = lib("reviews");
const storeLib = lib("store");
const validate = lib("validate");

/* The underwriting example with one opportunity: a labor estimate and a vendor line. */
function engagement(extraRecords) {
  const e = validate.validateEngagement(example("underwriting")).engagement;
  e.records.push({ id: "opp-1", kind: "opportunity", title: "Standard SOV template", status: "open", includeInHandoff: true, linkedModelId: "m-current", linkedNodeIds: ["scrub-sov-geocode"],
    opportunity: { effort: "M",
      valueCase: { modelId: "m-current", nodeIds: ["scrub-sov-geocode"], effortReductionPct: 50, shareOfCasesPct: 60, shareSource: "manual", effortSource: "node", basis: "supplied" },
      valueLines: [{ id: "vl-vendor", dimension: "vendor", inputs: { unitsBefore: 20, unitsAfter: 12, costPerUnitPerYear: 1200 }, realizationPct: 50, basis: "supplied" }] } });
  (extraRecords || []).forEach(r => e.records.push(r));
  const v = validate.validateEngagement(e);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  return v.engagement;
}

function packed(store, opts) {
  const e = store.get();
  const items = reviews.buildPackItems(e, Object.assign({ modelId: "m-current", steps: false, kinds: [], values: true }, opts || {}));
  const pack = reviews.newPack(e, { format: "html", stakeholder: { name: "A. Client" }, modelId: "m-current" }, items);
  store.dispatch("review/recordPack", { pack });
  return { pack, items };
}

function response(e, packId, entries, at) {
  return { schema: "aixray.review-response", schemaVersion: 1, packId, engagementId: e.id, engagementRevision: e.revision, format: "html",
    reviewer: { name: "A. Client", role: "CFO", organization: "Client Co" }, submittedAt: at || "2026-10-01T10:00:00.000Z", generalComment: "", entries };
}

const apply = (store, data, choices) => {
  const prepared = reviews.prepareApply(store.get(), data);
  assert.equal(prepared.ok, true, JSON.stringify(prepared.errors));
  return { prepared, result: store.dispatch("review/apply", reviews.buildApplyPayload(store.get(), prepared, choices)) };
};
const opp = store => store.get().records.find(r => r.id === "opp-1");
const labor = ["vc.effortReductionPct", "vc.shareOfCasesPct"].map(f => reviews.valueRef("opp-1", f));
const vendor = ["unitsBefore", "unitsAfter", "costPerUnitPerYear", "realizationPct"].map(k => reviews.valueRef("opp-1", "vl.vl-vendor." + k));

test("a pack can list the project assumptions and each opportunity's figures, with their values", () => {
  const e = engagement([
    { id: "opp-ai", kind: "opportunity", title: "Drafted", status: "open", includeInHandoff: true, linkedModelId: "m-current", linkedNodeIds: [],
      opportunity: { valueCase: { effortReductionPct: 20, aiDraft: true, basis: "illustrative" } } },
    { id: "opp-secret", kind: "opportunity", title: "Sensitive", status: "open", sensitive: true, includeInHandoff: true, linkedModelId: "m-current", linkedNodeIds: [],
      opportunity: { valueCase: { effortReductionPct: 20, basis: "illustrative" } } }]);
  assert.equal(reviews.buildPackItems(e, { modelId: "m-current", steps: false, kinds: [] }).length, 0, "figures are left out unless asked");
  const items = reviews.buildPackItems(e, { modelId: "m-current", steps: false, kinds: [], values: true });
  const refs = items.map(i => i.itemRef);
  assert.deepEqual(refs.filter(r => r.startsWith("value/")), labor.concat(vendor), "AI drafts and sensitive opportunities are left out");
  assert.ok(refs.includes("assumption/as-hourly-rate"));
  const rate = items.find(i => i.itemRef === "assumption/as-hourly-rate");
  assert.equal(rate.kind, "value");
  assert.equal(rate.type, "Project assumption");
  assert.match(rate.label, /: \$[\d,]+ per hour$/);
  const effort = items.find(i => i.itemRef === labor[0]);
  assert.deepEqual([effort.label, effort.type, effort.lane], ["Effort reduction: 50%", "Business case figure", "Standard SOV template"]);
  assert.match(items.find(i => i.itemRef === vendor[2]).label, /^Licenses and vendor fees, cost per seat or unit per year: \$1,200$/);
  assert.equal(reviews.packCounts(e, { modelId: "m-current" }).values, items.length);
  // Without any business case, the assumptions alone are not offered.
  const bare = validate.validateEngagement(example("underwriting")).engagement;
  assert.equal(reviews.buildPackItems(bare, { modelId: "m-current", steps: false, kinds: [], values: true }).length, 0);
});

test("confirming every figure in a part makes its basis Confirmed, across reviews", () => {
  const store = storeLib.createStore(engagement());
  const { pack } = packed(store);
  // The first reviewer confirms the vendor line, one labor figure and the hourly rate.
  const first = response(store.get(), pack.id, vendor.concat([labor[0], "assumption/as-hourly-rate"]).map(itemRef => ({ itemRef, verdict: "confirm", comment: "" })));
  const { prepared, result } = apply(store, first);
  const effort = prepared.items.find(it => it.itemRef === labor[0]);
  assert.deepEqual([effort.targetValidation, effort.toConfirm], [null, 1], "the labor estimate still has a figure to confirm");
  assert.equal(prepared.items.find(it => it.itemRef === vendor[0]).targetValidation, "validated");
  assert.equal(result.values, 2);
  assert.equal(opp(store).opportunity.valueLines[0].basis, "validated");
  assert.equal(opp(store).opportunity.valueCase.basis, "supplied");
  assert.equal(store.get().assumptions.find(a => a.id === "as-hourly-rate").status, "validated");
  assert.equal(store.get().reviews[0].applied.values, 2);

  // A later reviewer confirms the last labor figure.
  const { result: second } = apply(store, response(store.get(), pack.id, [{ itemRef: labor[1], verdict: "confirm", comment: "" }], "2026-10-05T10:00:00.000Z"));
  assert.equal(second.values, 1);
  assert.equal(opp(store).opportunity.valueCase.basis, "validated");

  // Undo reverses the second review in one step.
  store.undo();
  assert.equal(opp(store).opportunity.valueCase.basis, "supplied");
});

test("a dispute adds a question named after the opportunity, and a figure changed since the form is not confirmed", () => {
  const store = storeLib.createStore(engagement());
  const { pack } = packed(store);
  store.dispatch("record/update", { id: "opp-1", patch: { opportunity: { valueCase: Object.assign({}, opp(store).opportunity.valueCase, { shareOfCasesPct: 70 }) } } });
  const data = response(store.get(), pack.id, [
    { itemRef: labor[0], verdict: "dispute", comment: "Closer to 30%." },
    { itemRef: labor[1], verdict: "confirm", comment: "" }]);
  const { prepared } = apply(store, data);
  assert.ok(prepared.warnings.some(w => /The figure is now "Share of cases affected: 70%"; it was "Share of cases affected: 60%"/.test(w.message)));
  assert.equal(prepared.items.find(it => it.itemRef === labor[1]).targetValidation, null);
  const q = store.get().records.find(r => r.kind === "question" && /Disputed in client review/.test(r.title));
  assert.equal(q.title, "Disputed in client review: Standard SOV template, effort reduction: 50%");
  assert.deepEqual(q.linkedNodeIds, ["scrub-sov-geocode"]);
  assert.equal(opp(store).opportunity.valueCase.basis, "supplied");
  assert.equal("values" in store.get().reviews[0].applied, false, "kept only when a basis changed");
  // Turning the choice off changes no basis.
  const store2 = storeLib.createStore(engagement());
  const p2 = packed(store2).pack;
  apply(store2, response(store2.get(), p2.id, vendor.map(itemRef => ({ itemRef, verdict: "confirm", comment: "" }))), { values: false });
  assert.equal(opp(store2).opportunity.valueLines[0].basis, "supplied");
});

test("figure references save, open and match the schemas, and answers for a deleted opportunity are left out", () => {
  const store = storeLib.createStore(engagement());
  const { pack } = packed(store);
  apply(store, response(store.get(), pack.id, vendor.map(itemRef => ({ itemRef, verdict: "confirm", comment: "" }))));
  const opened = validate.validateEngagement(JSON.parse(JSON.stringify(store.get())));
  assert.equal(opened.ok, true);
  assert.deepEqual(opened.engagement.reviews[0].entries.map(x => x.itemRef), vendor);
  assert.equal(opened.engagement.reviews[0].applied.values, 1);
  assert.equal(opened.engagement.reviewPacks[0].items.length, pack.items.length);
  for (const name of ["engagement.schema.json", "review-response.schema.json"]) {
    const doc = JSON.parse(fs.readFileSync(path.join(root, "webui", "schema", name), "utf8"));
    const def = (doc.$defs && doc.$defs.itemRef) || JSON.parse(JSON.stringify(doc)).properties.entries.items.properties.itemRef;
    const re = new RegExp(def.pattern);
    assert.ok(re.test("value/opp-1/vl.vl-vendor.unitsBefore") && re.test("assumption/as-hourly-rate") && !re.test("value/opp-1"), name);
  }
  assert.deepEqual(validate.parseItemRef("value/opp-1/vc.oneTimeCost"), { kind: "value", recordId: "opp-1", field: "vc.oneTimeCost" });
  store.dispatch("record/delete", { id: "opp-1" });
  const prepared = reviews.prepareApply(store.get(), response(store.get(), pack.id, [{ itemRef: labor[0], verdict: "confirm", comment: "" }]));
  assert.equal(prepared.ok, true);
  assert.equal(prepared.items.length, 0);
});
