// The client-value foundation contract: new enumerations, datasets, value
// cases, reviews, the log-mapping AI task and the store commands that keep
// references clean. See docs/extensions.md.
import test from "node:test";
import assert from "node:assert/strict";
import { lib, example, tinyEngagement, datasetFixture, tinyDataset } from "./helpers.mjs";

const schema = lib("schema");
const util = lib("util");
const { validateEngagement, sanitizeDataset, sanitizeValueCase, sanitizeScenarioFor, sanitizeReviewPack, sanitizeReview,
  validateReviewResponse, parseItemRef } = lib("validate");
const { createStore, StoreError } = lib("store");
const economics = lib("economics");
const lenses = lib("lenses");
const ai = lib("ai-results");

const codes = r => r.warnings.map(w => w.code);

function withDatasets() {
  const e = tinyEngagement();
  e.datasets = [datasetFixture("tiny-baseline"), datasetFixture("tiny-after")];
  return e;
}

function storeFor(e) {
  const r = validateEngagement(e);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return createStore(r.engagement);
}

test("new enumerations list their default first and keep existing values", () => {
  const E = schema.ENUMS;
  assert.deepEqual(E.datasetRole, ["baseline", "after"]);
  assert.deepEqual(E.logFormat, ["csv", "tsv", "xlsx"]);
  assert.deepEqual(E.timestampMode, ["single", "start-end"]);
  assert.deepEqual(E.caseIdHandling, ["hashed", "sequence", "original"]);
  assert.deepEqual(E.mappingMethod, ["exact", "fuzzy", "ai", "manual", "ignored"]);
  assert.deepEqual(E.wave, ["", "now", "next", "later"]);
  assert.deepEqual(E.confidence, ["", "low", "medium", "high"]);
  assert.deepEqual(E.valueInputSource, ["manual", "dataset"]);
  assert.deepEqual(E.reviewVerdict, ["confirm", "dispute", "unsure"]);
  assert.deepEqual(E.reviewFormat, ["html", "xlsx"]);
  assert.deepEqual(E.assumptionStatus, ["illustrative", "supplied", "observed", "validated"]);
  assert.equal(E.aiTask[E.aiTask.length - 1], "log-mapping");
  assert.equal(schema.label("aiTask", "log-mapping"), "Map event log activities to steps");
  assert.equal(schema.REVIEW_RESPONSE_ID, "aixray.review-response");
  assert.equal(schema.REVIEW_PACK_ID, "aixray.review-pack");
  assert.equal(schema.LIMITS.datasets, 12);
  assert.equal(schema.LIMITS.eventLogBytes, 25 * 1024 * 1024);
  assert.equal(schema.LIMITS.reviewResponseBytes, 2 * 1024 * 1024);
  assert.equal(schema.LIMITS.aiActivities, 500);
  const blank = schema.blankEngagement({});
  assert.deepEqual([blank.datasets, blank.reviewPacks, blank.reviews], [[], [], []]);
});

test("engagements without the new collections keep their shape", () => {
  const r = validateEngagement(tinyEngagement());
  assert.equal(r.ok, true);
  assert.equal("datasets" in r.engagement, false);
  assert.equal("reviewPacks" in r.engagement, false);
  assert.equal("reviews" in r.engagement, false);
});

test("dataset fixtures validate against their engagements and survive a second pass", () => {
  const tiny = validateEngagement(withDatasets());
  assert.equal(tiny.ok, true, JSON.stringify(tiny.errors));
  assert.deepEqual(tiny.warnings.filter(w => /^datasets/.test(w.path)), []);
  assert.deepEqual(validateEngagement(tiny.engagement).engagement.datasets, tiny.engagement.datasets);
  const uw = example("underwriting-current-state");
  uw.datasets = [datasetFixture("underwriting-baseline"), datasetFixture("underwriting-after")];
  const r = validateEngagement(uw);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.engagement.datasets[1].comparesToDatasetId, "ds-uw-baseline");
  assert.deepEqual(r.warnings.filter(w => /^datasets/.test(w.path)), []);
});

test("datasets hold aggregates only: unknown fields such as events are dropped", () => {
  const e = withDatasets();
  e.datasets[0].events = [{ caseId: "C-1", activity: "Do work", resource: "Jane Smith" }];
  e.datasets[0].steps[0].resourceNames = ["Jane Smith"];
  const r = validateEngagement(e);
  assert.equal(r.ok, true);
  assert.equal("events" in r.engagement.datasets[0], false);
  assert.equal("resourceNames" in r.engagement.datasets[0].steps[0], false);
  assert.ok(codes(r).includes("fields.ignored"));
  assert.doesNotMatch(JSON.stringify(r.engagement.datasets), /Jane Smith/);
});

test("dangling dataset references are removed with warnings", () => {
  const e = withDatasets();
  const d = e.datasets[0];
  d.steps.push({ nodeId: "ghost", visits: 1, cases: 1 });
  d.transitions.push({ fromNodeId: "work", toNodeId: "ghost", count: 1, edgeIds: [] });
  d.transitions[0].edgeIds.push("e-ghost");
  d.mapping.push({ activity: "Phantom", nodeId: "ghost", method: "manual", events: 1 });
  d.variants[0].nodeIds.push("ghost");
  d.scenarioIds = ["no-such-scenario"];
  e.datasets[1].comparesToDatasetId = "ds-missing";
  const r = validateEngagement(e);
  assert.equal(r.ok, true);
  const out = r.engagement.datasets[0];
  assert.equal(out.steps.some(s => s.nodeId === "ghost"), false);
  assert.equal(out.transitions.some(t => t.toNodeId === "ghost"), false);
  assert.equal(out.transitions[0].edgeIds.includes("e-ghost"), false);
  assert.equal(out.mapping.find(m => m.activity === "Phantom").nodeId, null);
  assert.equal(out.variants[0].nodeIds.includes("ghost"), false);
  assert.deepEqual(out.scenarioIds, []);
  assert.equal(r.engagement.datasets[1].comparesToDatasetId, null);
  assert.ok(codes(r).filter(c => c === "ref.dangling").length >= 6);
});

test("a dataset for a missing model is detached with a warning", () => {
  const e = withDatasets();
  e.datasets[0].modelId = "m-gone";
  const r = validateEngagement(e);
  assert.equal(r.ok, true);
  assert.equal(r.engagement.datasets[0].modelId, null);
  assert.ok(r.warnings.some(w => w.code === "ref.dangling" && /modelId/.test(w.path)));
});

test("duplicate dataset IDs and impossible figures are errors", () => {
  const e = withDatasets();
  e.datasets[1].id = e.datasets[0].id;
  assert.equal(validateEngagement(e).ok, false);
  const f = withDatasets();
  f.datasets[0].steps[0].caseShare = 1.5;
  assert.equal(validateEngagement(f).ok, false);
});

test("scenarios link to the event log they came from, and measures may be observed", () => {
  const e = withDatasets();
  e.scenarios = [{
    id: "sc-observed", name: "Most common route", provenance: "observed",
    observedFrom: { datasetId: "ds-tiny-baseline", variantId: "v1", caseLabel: "Case 3f2a1c9e" },
    measures: [{ key: "cycleTime", label: "Cycle time", unit: "minute", values: { "m-current": 90 }, status: "observed" }]
  }];
  e.datasets[0].scenarioIds = ["sc-observed"];
  const r = validateEngagement(e);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const s = r.engagement.scenarios[0];
  assert.deepEqual(s.observedFrom, { datasetId: "ds-tiny-baseline", variantId: "v1", caseLabel: "Case 3f2a1c9e" });
  assert.equal(s.measures[0].status, "observed");
  assert.deepEqual(r.engagement.datasets[0].scenarioIds, ["sc-observed"]);
  e.scenarios[0].observedFrom.datasetId = "ds-missing";
  const r2 = validateEngagement(e);
  assert.equal("observedFrom" in r2.engagement.scenarios[0], false);
  assert.ok(codes(r2).includes("ref.dangling"));
});

test("opportunities keep a wave and a value case, with references checked", () => {
  const e = withDatasets();
  e.records = [{
    id: "rec-opp", kind: "opportunity", title: "Fix fewer files", linkedModelId: "m-current", linkedNodeIds: ["work", "fix"],
    opportunity: {
      intervention: "standardize", wave: "now",
      valueCase: { modelId: "m-current", nodeIds: ["fix", "ghost"], effortReductionPct: 50, shareOfCasesPct: 20, shareSource: "dataset",
        effortSource: "dataset", datasetId: "ds-tiny-baseline", oneTimeCost: 5000, annualRunningCost: null, confidence: "medium", basis: "observed", note: "From the log" }
    }
  }];
  const r = validateEngagement(e);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const o = r.engagement.records[0].opportunity;
  assert.equal(o.wave, "now");
  assert.deepEqual(o.valueCase.nodeIds, ["fix"]);
  assert.equal(o.valueCase.datasetId, "ds-tiny-baseline");
  assert.equal(o.valueCase.basis, "observed");
  assert.ok(codes(r).includes("ref.dangling"));
  e.records[0].opportunity.wave = "someday";
  e.records[0].opportunity.valueCase.datasetId = "ds-gone";
  const r2 = validateEngagement(e);
  assert.equal(r2.engagement.records[0].opportunity.wave, "");
  assert.equal(r2.engagement.records[0].opportunity.valueCase.datasetId, null);
  e.records[0].opportunity.valueCase.effortReductionPct = 140;
  assert.equal(validateEngagement(e).ok, false, "a percentage above 100 is an error");
});

test("opportunities without wave or value case keep their old shape", () => {
  const r = validateEngagement(example("underwriting"));
  const opps = r.engagement.records.filter(x => x.kind === "opportunity");
  opps.forEach(x => { assert.equal("wave" in x.opportunity, false); assert.equal("valueCase" in x.opportunity, false); });
});

test("item references name a step or a record", () => {
  assert.deepEqual(parseItemRef("step/m-current/work"), { kind: "step", modelId: "m-current", nodeId: "work" });
  assert.deepEqual(parseItemRef("record/rec:1"), { kind: "record", recordId: "rec:1" });
  assert.equal(parseItemRef("step/m-current"), null);
  assert.equal(parseItemRef("node/x/y"), null);
  assert.equal(parseItemRef("step/a/b/c"), null);
});

test("review packs and reviews drop items that no longer resolve", () => {
  const e = tinyEngagement();
  e.records = [{ id: "rec-1", kind: "pain", title: "Slow checks" }];
  e.evidence = [{ id: "ev-1", title: "Client review" }];
  e.reviewPacks = [{ id: "pack-1", createdAt: "2026-03-01", format: "html", stakeholder: { name: "A. Client", role: "Ops lead", organization: "Client" },
    engagementRevision: 4, modelId: "m-current",
    items: [{ itemRef: "step/m-current/work", label: "Do the work" }, { itemRef: "record/rec-1", label: "Slow checks" }, { itemRef: "step/m-current/ghost", label: "Gone" }] }];
  e.reviews = [{ id: "rev-1", packId: "pack-1", receivedAt: "2026-03-05", submittedAt: "2026-03-04", source: "html",
    reviewer: { name: "A. Client", role: "Ops lead", organization: "Client" }, generalComment: "Mostly right",
    entries: [{ itemRef: "step/m-current/work", label: "Do the work", verdict: "confirm", comment: "" },
      { itemRef: "record/rec-9", label: "Gone", verdict: "dispute", comment: "x" }, { itemRef: "record/rec-1", label: "Slow checks" }],
    applied: { validations: 1, questions: 0, evidenceId: "ev-1" } }, { id: "rev-2", packId: "pack-9" }];
  const r = validateEngagement(e);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.engagement.reviewPacks[0].items.length, 2);
  assert.equal(r.engagement.reviews[0].entries.length, 2);
  assert.equal(r.engagement.reviews[0].entries[1].verdict, "unsure", "a missing verdict is never read as confirm");
  assert.equal(r.engagement.reviews[0].applied.evidenceId, "ev-1");
  assert.equal(r.engagement.reviews[1].packId, null);
  assert.ok(codes(r).filter(c => c === "ref.dangling").length >= 3);
});

test("standalone sanitizers report errors and warnings for store commands", () => {
  const e = validateEngagement(withDatasets()).engagement;
  const ds = sanitizeDataset(Object.assign(datasetFixture("tiny-baseline"), { id: "ds-new", name: "  " }), e);
  assert.deepEqual(ds.errors, []);
  assert.equal(ds.value.name, "tiny-baseline.csv", "a blank name falls back to the file name");
  assert.equal(sanitizeDataset(tinyDataset(), e).errors.length, 1, "an ID already in the engagement is an error");
  const vc = sanitizeValueCase({ effortReductionPct: 30, nodeIds: ["work", "nope"] }, e, { linkedModelId: "m-current" });
  assert.deepEqual(vc.errors, []);
  assert.deepEqual(vc.value.nodeIds, ["work"]);
  assert.equal(vc.value.shareSource, "manual");
  assert.equal(vc.value.effortSource, "node");
  assert.equal(vc.value.basis, "illustrative");
  assert.equal(vc.value.confidence, "");
  const sc = sanitizeScenarioFor({ id: "sc-1", name: "From log", observedFrom: { datasetId: "ds-tiny-baseline", variantId: "v1" },
    runs: { "m-current": { visits: [{ id: "a", nodeId: "start", start: 0, end: 0 }, { id: "b", nodeId: "work", start: 0, end: 45 }] } } }, e);
  assert.deepEqual(sc.errors, []);
  assert.equal(sc.value.runs["m-current"].transitions.length, 1);
  assert.equal(sc.value.observedFrom.datasetId, "ds-tiny-baseline");
  const pack = sanitizeReviewPack({ id: "pack-1", items: [{ itemRef: "step/m-current/work", label: "Do the work" }] }, e);
  assert.deepEqual(pack.errors, []);
  assert.equal(pack.value.format, "html");
  const review = sanitizeReview({ id: "rev-1", entries: [{ itemRef: "step/m-current/work", verdict: "dispute", comment: "Two people do this" }] }, e);
  assert.deepEqual(review.errors, []);
  assert.equal(review.value.entries[0].verdict, "dispute");
});

test("review responses are checked against the open engagement", () => {
  const e = validateEngagement(tinyEngagement()).engagement;
  const response = {
    schema: "aixray.review-response", schemaVersion: 1, packId: "pack-1", engagementId: "eng-tiny", engagementRevision: 0, format: "html",
    reviewer: { name: "A. Client", role: "Ops lead", organization: "Client" }, submittedAt: "2026-03-04T10:00:00Z", generalComment: "",
    entries: [{ itemRef: "step/m-current/work", verdict: "confirm", comment: "" }, { itemRef: "step/m-current/fix", verdict: "maybe", comment: "Not sure who" },
      { itemRef: "step/m-current/ghost", verdict: "dispute", comment: "" }, { itemRef: "step/m-current/work", verdict: "dispute", comment: "Changed my mind" }]
  };
  const r = validateReviewResponse(response, e);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.response.entries.length, 2);
  assert.equal(r.response.entries.find(x => x.itemRef === "step/m-current/work").verdict, "dispute", "the later answer wins");
  assert.equal(r.response.entries.find(x => x.itemRef === "step/m-current/fix").verdict, "");
  assert.ok(codes(r).includes("enum.unknown") && codes(r).includes("ref.dangling") && codes(r).includes("review.duplicate"));
  assert.equal(validateReviewResponse(Object.assign({}, response, { engagementId: "eng-other" }), e).ok, false);
  assert.equal(validateReviewResponse(Object.assign({}, response, { schemaVersion: 2 }), e).ok, false);
  assert.equal(validateReviewResponse({ schema: "aixray.engagement" }, e).ok, false);
  assert.equal(validateReviewResponse(response, null).ok, true, "without an engagement only the file itself is checked");
});

test("economics ranks observed between supplied and validated", () => {
  assert.deepEqual(economics.STATUS_RANK, { illustrative: 0, supplied: 1, calculated: 1, observed: 2, validated: 3 });
  const w = economics.helpers.weakest;
  assert.equal(w(["validated", "observed"]), "observed");
  assert.equal(w(["observed", "supplied"]), "supplied");
  assert.equal(w(["validated"]), "validated");
  assert.equal(w(["calculated"]), "supplied");
  assert.equal(w([]), "validated");
  assert.equal(w(["observed", "illustrative"]), "illustrative");
  assert.equal(typeof economics.helpers.output, "function");
  assert.equal(typeof economics.helpers.inp, "function");
  assert.equal(typeof economics.helpers.driverInput, "function");
});

test("cycle time reduction carries the status of the cycle-time measure", () => {
  const e = example("underwriting");
  const s = e.scenarios[0];
  const ct = s.measures.find(m => m.key === "cycleTime");
  const before = economics.computeValue(e, s).outputs.find(o => o.key === "cycleReduction");
  assert.equal(before.basis, "supplied");
  ct.status = "observed";
  const r = economics.computeValue(e, s).outputs.find(o => o.key === "cycleReduction");
  assert.equal(r.inputs[0].status, "observed");
  assert.equal(r.basis, "observed");
});

test("registered lenses join the list and compute through the registry", () => {
  const before = lenses.LENSES.length;
  lenses.registerLens({ id: "test-lens", label: "Test lens", compute: ctx => ({ description: "From a test", nodes: { [ctx.model.nodes[1].id]: { level: 2, text: "x" } } }) });
  assert.equal(lenses.LENSES.length, before + 1);
  assert.throws(() => lenses.registerLens({ id: "test-lens", label: "Again", compute: () => ({}) }));
  assert.throws(() => lenses.registerLens({ id: "time", label: "Clash", compute: () => ({}) }));
  assert.throws(() => lenses.registerLens({ id: "no-compute", label: "x" }));
  const model = validateEngagement(tinyEngagement()).engagement.models[0];
  const r = lenses.computeLens("test-lens", { model, replay: null, engagement: null });
  assert.equal(r.id, "test-lens");
  assert.equal(r.title, "Test lens");
  assert.equal(r.description, "From a test");
  assert.deepEqual(r.legend, []);
  assert.equal(r.nodes.work.level, 2);
  lenses.LENSES.splice(lenses.LENSES.findIndex(l => l.id === "test-lens"), 1);
});

/* ---------- The log-mapping AI task ---------- */

function strictProblems(node, path, out) {
  const unsupported = ["maxItems", "minItems", "maxLength", "minLength", "pattern", "format", "default", "oneOf", "allOf", "$ref"];
  unsupported.forEach(k => { if (k in node) out.push(path + " uses " + k); });
  if (node.anyOf) node.anyOf.forEach((n, i) => strictProblems(n, path + ".anyOf[" + i + "]", out));
  if ([].concat(node.type).includes("object")) {
    if (node.additionalProperties !== false) out.push(path + " allows extra properties");
    const keys = Object.keys(node.properties || {});
    if (JSON.stringify([...(node.required || [])].sort()) !== JSON.stringify([...keys].sort())) out.push(path + " does not require every property");
    keys.forEach(k => strictProblems(node.properties[k], path + "." + k, out));
  }
  if (node.items) strictProblems(node.items, path + "[]", out);
  return out;
}

function mappingResult(mappings, over) {
  return Object.assign({
    schema: "aixray.ai-result", schemaVersion: 1, task: "log-mapping", engagementId: "eng-tiny", engagementRevision: 0,
    baselineModelId: "m-current", generated: { tool: "aixray-ai", provider: "claude", model: "test", surface: "cli", at: "2026-03-01T00:00:00Z", jobId: "j1", plan: "commercial" },
    dataHandling: { confidentiality: "internal", dataStatus: "demonstration" }, sources: [], notes: "", warnings: [],
    payload: { mappings }
  }, over || {});
}

test("the log-mapping task has a strict schema and a sanitizer", () => {
  assert.deepEqual(strictProblems(ai.TASK_SCHEMAS["log-mapping"], "log-mapping", []), []);
  assert.deepEqual(strictProblems(ai.outputSchema("log-mapping"), "output", []), []);
  const ok = ai.validateAiResult(mappingResult([
    { activity: " Do work ", nodeId: "work", confidence: "high", rationale: "Same words" },
    { activity: "Do work", nodeId: "fix", confidence: "low", rationale: "Duplicate" },
    { activity: "Coffee", nodeId: null, confidence: "low", rationale: "No step" },
    { activity: "Odd", nodeId: "not a valid id!", confidence: "medium", rationale: "" }
  ]));
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.deepEqual(ok.result.payload.mappings.map(m => [m.activity, m.nodeId]), [["Do work", "work"], ["Coffee", null], ["Odd", null]]);
  assert.ok(ok.warnings.some(w => w.code === "payload.duplicate"));
  assert.ok(ok.warnings.some(w => w.code === "payload.reference"));
  assert.equal(ai.validateAiResult(mappingResult([], { baselineModelId: null })).ok, false, "the target model is required");
  assert.equal(ai.validateAiResult(mappingResult([{ activity: "x", nodeId: null, confidence: "sure", rationale: "" }])).ok, false);
  const many = Array.from({ length: 520 }, (_, i) => ({ activity: "A" + i, nodeId: null, confidence: "low", rationale: "" }));
  const big = ai.validateAiResult(mappingResult(many));
  assert.equal(big.result.payload.mappings.length, 500);
  assert.ok(big.warnings.some(w => w.code === "payload.truncated"));
});

test("the log-mapping input holds step names and activity names only", () => {
  const e = validateEngagement(tinyEngagement()).engagement;
  e.models[0].nodes[1].details = { desc: "Prepare and check the file", systems: ["Secret CRM"] };
  e.models[0].nodes[1].measures.touchEffort = { value: 42, unit: "minute" };
  const input = ai.buildTaskInput(e, "log-mapping", { modelId: "m-current", activities: [{ name: "Fix it", events: 5 }, { name: "Do work", events: 90 }, { name: "Do work", events: 1 }, { name: "" }] });
  assert.equal(input.task, "log-mapping");
  assert.equal(input.baselineModelId, "m-current");
  assert.deepEqual(input.activities, ["Do work", "Fix it"], "most frequent first, duplicates and blanks left out");
  assert.deepEqual(input.steps.map(s => s.id), ["start", "work", "fix", "end"], "gateways are not offered");
  assert.deepEqual(input.steps[1], { id: "work", label: "Do the work", lane: "Team A", description: "Prepare and check the file" });
  const text = JSON.stringify(input);
  assert.doesNotMatch(text, /Secret CRM|42|"events"/);
  assert.equal("records" in input, false);
  assert.equal("assumptions" in input, false);
});

test("log-mapping review flags unknown steps and names not sent, and returns proposals", () => {
  const e = validateEngagement(tinyEngagement()).engagement;
  const v = ai.validateAiResult(mappingResult([
    { activity: "Do work", nodeId: "work", confidence: "high", rationale: "Same words" },
    { activity: "Repair", nodeId: "ghost", confidence: "medium", rationale: "" },
    { activity: "Decide", nodeId: "check", confidence: "low", rationale: "" },
    { activity: "Invented", nodeId: "fix", confidence: "low", rationale: "" },
    { activity: "Lunch", nodeId: null, confidence: "low", rationale: "" }
  ]));
  const review = ai.prepareReview(v.result, e, { activities: ["Do work", "Repair", "Decide", "Lunch"] });
  assert.deepEqual(review.errors, []);
  const byActivity = Object.fromEntries(review.items.map(it => [it.activity, it]));
  assert.deepEqual(byActivity["Do work"].problems, []);
  assert.equal(byActivity["Do work"].stepLabel, "Do the work");
  assert.match(byActivity.Repair.problems.join(" "), /not in Current state/);
  assert.match(byActivity.Decide.problems.join(" "), /gateway/);
  assert.match(byActivity.Invented.problems.join(" "), /not sent/);
  assert.deepEqual(byActivity.Lunch.problems, []);
  const cmd = ai.applyCommand(v.result, review, review.items.map(it => it.key));
  assert.equal(cmd.type, "log-mapping/proposals");
  assert.equal(cmd.payload.modelId, "m-current");
  assert.deepEqual(cmd.payload.mappings.map(m => [m.activity, m.nodeId, m.method]), [["Do work", "work", "ai"], ["Lunch", null, "ai"]]);
  assert.equal(cmd.payload.stamp.task, "log-mapping");
  assert.equal(lib("store").COMMANDS["log-mapping/proposals"], undefined, "proposals are not a store command");
  const other = ai.prepareReview(Object.assign({}, v.result, { baselineModelId: "m-gone" }), e);
  assert.equal(other.errors.length, 1);
});

test("extracted drafts never carry observed data, datasets or reviews", () => {
  const e = validateEngagement(withDatasets()).engagement;
  e.assumptions.push({ id: "as-v", key: "annualVolume", label: "Annual eligible volume", value: 1460, unit: "casesPerYear", status: "observed", source: "Event log", note: "" });
  e.scenarios.push({ id: "sc-o", name: "Observed", statusLabel: "", statusTone: "", provenance: "observed", summary: "", attributes: [], timing: { method: "explicit-visits", note: "" },
    runs: {}, measures: [{ key: "cycleTime", label: "Cycle time", unit: "minute", values: { "m-current": 90 }, suppliedText: {}, status: "observed", note: "" }],
    economics: null, observedFrom: { datasetId: "ds-tiny-baseline", variantId: "v1", caseLabel: "" } });
  e.records.push({ id: "rec-o", kind: "opportunity", title: "x", description: "", owner: "", status: "open", priority: "", linkedModelId: "m-current", linkedModelVersion: 1,
    linkedNodeIds: ["work"], evidenceRefs: [], sensitive: false, includeInHandoff: true, createdAt: "", updatedAt: "",
    opportunity: { intervention: "", valueCase: { modelId: null, nodeIds: [], effortReductionPct: 10, durationReductionPct: null, shareOfCasesPct: null, shareSource: "dataset",
      effortSource: "dataset", datasetId: "ds-tiny-baseline", oneTimeCost: null, annualRunningCost: null, confidence: "", basis: "observed", note: "" } } });
  e.reviewPacks = [{ id: "p1", items: [] }];
  e.reviews = [];
  const out = ai.enforceDraftRules(e, { task: "extract" }, { dataStatus: "supplied" });
  const d = out.engagement;
  assert.equal("datasets" in d, false);
  assert.equal("reviewPacks" in d, false);
  assert.equal("reviews" in d, false);
  assert.equal(d.assumptions.find(a => a.id === "as-v").status, "supplied");
  const s = d.scenarios.find(x => x.id === "sc-o");
  assert.equal("observedFrom" in s, false);
  assert.equal(s.provenance, "supplied");
  assert.equal(s.measures[0].status, "supplied");
  const vc = d.records.find(r => r.id === "rec-o").opportunity.valueCase;
  assert.deepEqual([vc.datasetId, vc.shareSource, vc.effortSource, vc.basis], [null, "manual", "node", "supplied"]);
  assert.ok(out.changes.some(c => /event log/.test(c.message)));
  assert.equal(validateEngagement(d).ok, true);
});

/* ---------- Store ---------- */

test("record/update keeps the wave and value case of an opportunity", () => {
  const store = storeFor(withDatasets());
  const { id } = store.dispatch("record/add", { record: { kind: "opportunity", title: "Standardize checks", linkedModelId: "m-current", linkedNodeIds: ["work"],
    opportunity: { intervention: "standardize", wave: "next", valueCase: { effortReductionPct: 25, shareOfCasesPct: 60, datasetId: "ds-tiny-baseline", confidence: "high" } } } });
  store.dispatch("record/update", { id, patch: { status: "in-progress", owner: "Ops" } });
  let r = store.get().records.find(x => x.id === id);
  assert.equal(r.opportunity.wave, "next");
  assert.equal(r.opportunity.valueCase.effortReductionPct, 25);
  assert.equal(r.opportunity.valueCase.datasetId, "ds-tiny-baseline");
  store.dispatch("record/update", { id, patch: { opportunity: { wave: "later", valueCase: Object.assign({}, r.opportunity.valueCase, { confidence: "low" }) } } });
  r = store.get().records.find(x => x.id === id);
  assert.equal(r.opportunity.wave, "later");
  assert.equal(r.opportunity.valueCase.confidence, "low");
  assert.equal(r.opportunity.intervention, "standardize");
  assert.throws(() => store.dispatch("record/update", { id, patch: { opportunity: { valueCase: { effortReductionPct: 300 } } } }), StoreError);
  const plain = store.dispatch("record/add", { record: { kind: "opportunity", title: "Plain" } });
  const p = store.get().records.find(x => x.id === plain.id);
  assert.equal("wave" in p.opportunity, false);
  assert.equal("valueCase" in p.opportunity, false);
  assert.equal(validateEngagement(store.get()).ok, true);
});

test("dataset/update changes names, roles and comparisons", () => {
  const store = storeFor(withDatasets());
  store.dispatch("dataset/update", { id: "ds-tiny-after", patch: { name: "After go-live", role: "after", comparesToDatasetId: null, notes: "Second month", dataStatus: "observed" } });
  const d = store.get().datasets.find(x => x.id === "ds-tiny-after");
  assert.deepEqual([d.name, d.comparesToDatasetId, d.notes, d.dataStatus], ["After go-live", null, "Second month", "observed"]);
  store.dispatch("dataset/update", { id: "ds-tiny-after", patch: { comparesToDatasetId: "ds-tiny-baseline", role: "nonsense" } });
  assert.equal(store.get().datasets[1].comparesToDatasetId, "ds-tiny-baseline");
  assert.equal(store.get().datasets[1].role, "after");
  assert.throws(() => store.dispatch("dataset/update", { id: "ds-tiny-after", patch: { name: " " } }), StoreError);
  assert.throws(() => store.dispatch("dataset/update", { id: "ds-tiny-after", patch: { comparesToDatasetId: "ds-tiny-after" } }), StoreError);
  assert.throws(() => store.dispatch("dataset/update", { id: "ds-tiny-after", patch: { comparesToDatasetId: "ds-x" } }), StoreError);
  assert.throws(() => store.dispatch("dataset/update", { id: "ds-x", patch: {} }), StoreError);
  assert.equal(validateEngagement(store.get()).ok, true);
});

test("dataset/delete clears references and can remove the scenarios made from the log", () => {
  const e = withDatasets();
  e.scenarios = [{ id: "sc-log", name: "From the log", provenance: "observed", observedFrom: { datasetId: "ds-tiny-baseline", variantId: "v1" } },
    { id: "sc-other", name: "Supplied" }];
  e.datasets[0].scenarioIds = ["sc-log"];
  e.records = [{ id: "rec-o", kind: "opportunity", title: "x", opportunity: { valueCase: { datasetId: "ds-tiny-baseline", effortReductionPct: 10 } } }];
  const store = storeFor(e);
  store.dispatch("dataset/delete", { id: "ds-tiny-baseline" });
  let s = store.get();
  assert.deepEqual(s.datasets.map(d => d.id), ["ds-tiny-after"]);
  assert.equal(s.datasets[0].comparesToDatasetId, null);
  assert.equal(s.scenarios.length, 2);
  assert.equal("observedFrom" in s.scenarios[0], false);
  assert.equal(s.records[0].opportunity.valueCase.datasetId, null);
  assert.deepEqual(validateEngagement(s).warnings.filter(w => w.code === "ref.dangling"), []);
  store.undo();
  const out = store.dispatch("dataset/delete", { id: "ds-tiny-baseline", removeScenarios: true });
  s = store.get();
  assert.equal(out.scenariosRemoved, 1);
  assert.deepEqual(s.scenarios.map(x => x.id), ["sc-other"]);
  assert.throws(() => store.dispatch("dataset/delete", { id: "ds-tiny-baseline" }), StoreError);
});

test("deleting a future-state draft detaches its event logs and review items", () => {
  const first = storeFor(example("underwriting-current-state"));
  const { modelId } = first.dispatch("model/clone", { sourceModelId: "m-current" });
  const e = util.clone(first.get());
  e.datasets = [Object.assign(datasetFixture("underwriting-after"), { modelId, comparesToDatasetId: null })];
  e.records = [{ id: "rec-o", kind: "opportunity", title: "Scrub faster", linkedModelId: modelId, linkedNodeIds: ["scrub-sov-geocode"],
    opportunity: { valueCase: { modelId, nodeIds: ["scrub-sov-geocode"], effortReductionPct: 10 } } }];
  e.reviewPacks = [{ id: "p1", modelId, items: [{ itemRef: "step/" + modelId + "/scrub-sov-geocode", label: "Scrub" },
    { itemRef: "step/m-current/scrub-sov-geocode", label: "Scrub" }] }];
  const store = storeFor(e);
  store.dispatch("model/delete", { modelId });
  const s = store.get();
  assert.equal(s.datasets[0].modelId, null);
  assert.equal(s.reviewPacks[0].modelId, null);
  assert.deepEqual(s.reviewPacks[0].items.map(i => i.itemRef), ["step/m-current/scrub-sov-geocode"]);
  assert.equal(s.records[0].opportunity.valueCase.modelId, null);
  assert.deepEqual(validateEngagement(s).warnings.filter(w => w.code === "ref.dangling"), []);
});

test("deleting a record or a source prunes review references to it", () => {
  const e = tinyEngagement();
  e.records = [{ id: "rec-1", kind: "pain", title: "Slow checks" }];
  e.evidence = [{ id: "ev-1", title: "Client review" }];
  e.reviewPacks = [{ id: "p1", items: [{ itemRef: "record/rec-1", label: "Slow checks" }, { itemRef: "step/m-current/work", label: "Do the work" }] }];
  e.reviews = [{ id: "r1", entries: [{ itemRef: "record/rec-1", verdict: "confirm" }], applied: { evidenceId: "ev-1" } }];
  const store = storeFor(e);
  store.dispatch("record/delete", { id: "rec-1" });
  store.dispatch("evidence/delete", { id: "ev-1" });
  const s = store.get();
  assert.deepEqual(s.reviewPacks[0].items.map(i => i.itemRef), ["step/m-current/work"]);
  assert.deepEqual(s.reviews[0].entries, []);
  assert.equal(s.reviews[0].applied.evidenceId, null);
  assert.deepEqual(validateEngagement(s).warnings.filter(w => w.code === "ref.dangling"), []);
});
