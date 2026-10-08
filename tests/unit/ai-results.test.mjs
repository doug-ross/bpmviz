// AI result files: schemas, the data-handling gate, review and one-step apply (P2-02).
import test from "node:test";
import assert from "node:assert/strict";
import { lib, example, tinyEngagement } from "./helpers.mjs";

const ai = lib("ai-results");
const { createStore } = lib("store");
const { validateEngagement } = lib("validate");
const exporting = lib("exporting");

const GENERATED = { tool: "test", provider: "claude", model: "test-model", surface: "cli", at: "2026-09-01T00:00:00.000Z", jobId: "job-1", plan: "commercial" };

function loaded(e) {
  return validateEngagement(e || tinyEngagement()).engagement;
}

function envelope(engagement, task, payload, extra) {
  return ai.makeEnvelope(Object.assign({
    task, engagementId: engagement ? engagement.id : null, engagementRevision: engagement ? engagement.revision : null,
    baselineModelId: task === "future-state" ? "m-current" : null,
    generated: GENERATED, dataHandling: { confidentiality: "internal", dataStatus: "supplied", approvalConfirmed: true },
    payload
  }, extra || {}));
}

function suggestion(over) {
  return Object.assign({
    ref: "s1", kind: "opportunity", title: "Pre-fill the intake form", description: "Use the submission data.",
    linkedModelId: "m-current", linkedNodeIds: ["work"], basedOnRecordIds: [], priority: "high",
    opportunity: { intervention: "simplify", simplerAlternative: "A checklist", expectedBenefit: "Less rework",
      affectedVolume: "All cases", effort: "S", risk: "", dependencies: "", validationAction: "Time ten cases" },
    confidence: "medium", rationale: "Rework happens at Check."
  }, over || {});
}

function op(over) {
  return Object.assign({
    op: "modify", nodeId: null, edgeId: null, label: null, laneRef: null, semanticType: null, details: [], tags: null,
    touchEffortMinutes: null, typicalDurationMinutes: null, rationale: "", addressesRecordIds: []
  }, over || {});
}

/* Every object must list all properties as required and allow no others (OpenAI strict mode). */
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

test("task schemas follow the strict rules both CLIs accept", () => {
  ["opportunities", "future-state", "summary"].forEach(task => {
    const s = ai.TASK_SCHEMAS[task];
    assert.equal(s.type, "object", task + " root is an object");
    assert.deepEqual(strictProblems(s, task, []), []);
  });
});

test("the data-handling gate covers every plan and confidentiality level", () => {
  const g = (plan, confidentiality, extra) => ai.dataHandlingGate(Object.assign({ plan, confidentiality, dataStatus: "supplied" }, extra || {}));
  // Demonstration or public material goes anywhere.
  assert.equal(ai.dataHandlingGate({ plan: "consumer", confidentiality: "restricted", dataStatus: "demonstration" }).allowed, true);
  assert.equal(g("consumer", "public").allowed, true);
  assert.equal(g("unknown", "public").allowed, true);
  // Commercial plans need approval, and restricted also needs written approval.
  assert.deepEqual(g("commercial", "internal").missing, ["approval"]);
  assert.equal(g("commercial", "internal", { approvalConfirmed: true }).allowed, true);
  assert.equal(g("commercial", "client-confidential", { approvalConfirmed: true }).allowed, true);
  assert.deepEqual(g("commercial", "restricted", { approvalConfirmed: true }).missing, ["writtenApproval"]);
  assert.equal(g("commercial", "restricted", { approvalConfirmed: true, writtenApproval: "J. Smith, 2026-09-01" }).allowed, true);
  // Consumer plans take internal material only, after the training-off confirmation.
  assert.deepEqual(g("consumer", "internal").missing, ["trainingOff"]);
  assert.equal(g("consumer", "internal", { trainingOptOutConfirmed: true }).allowed, true);
  assert.equal(g("consumer", "client-confidential", { approvalConfirmed: true, trainingOptOutConfirmed: true }).blocked, true);
  assert.equal(g("consumer", "restricted", { approvalConfirmed: true, trainingOptOutConfirmed: true, writtenApproval: "Someone, today" }).allowed, false);
  // An unknown plan must be declared first; a missing confidentiality counts as client confidential.
  assert.deepEqual(g("unknown", "internal").missing, ["plan"]);
  assert.equal(ai.dataHandlingGate({ plan: "consumer" }).blocked, true);
});

test("result files are recognized and malformed ones are refused", () => {
  assert.equal(ai.isAiResult({ schema: "bpmviz.ai-result" }), true);
  assert.equal(ai.isAiResult({ schema: "bpmviz.engagement" }), false);
  assert.equal(ai.validateAiResult({ schema: "bpmviz.engagement" }).ok, false);
  assert.match(ai.validateAiResult({ schema: "bpmviz.ai-result", schemaVersion: 2, task: "summary" }).errors[0].message, /newer version/);
  assert.equal(ai.parseAiResultText("{not json").ok, false);
  const e = loaded();
  const missing = envelope(e, "opportunities", { suggestions: [{ ref: "s1", kind: "opportunity", title: "x" }] });
  const v = ai.validateAiResult(missing);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(x => x.path === "payload.suggestions[0].rationale"));
  const noEngagement = envelope(null, "summary", { title: "t", text: "x", keyPoints: [], caveats: [] });
  assert.ok(ai.validateAiResult(noEngagement).errors.some(x => x.path === "engagementId"));
});

test("a result that contains a credential is not loaded", () => {
  const e = loaded();
  const leaked = envelope(e, "summary", { title: "Summary", text: "Use key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123 for access.", keyPoints: [], caveats: [] });
  const v = ai.validateAiResult(leaked);
  assert.equal(v.ok, false);
  assert.match(v.errors[0].message, /Anthropic key/);
  assert.equal(ai.scanSecrets({ a: ["-----BEGIN RSA PRIVATE KEY-----"] })[0].path, "a[0]");
  assert.deepEqual(ai.scanSecrets({ text: "The skip-level manager signs off on 12 cases." }), []);
});

test("suggestions are reviewed, applied in one revision, excluded from the handoff until reviewed and undone", () => {
  const store = createStore(loaded());
  store.dispatch("record/add", { record: { kind: "pain", title: "Rework at Check", linkedModelId: "m-current", linkedNodeIds: ["check"] } });
  const pain = store.get().records[0];
  const file = envelope(store.get(), "opportunities", { suggestions: [
    suggestion({ basedOnRecordIds: [pain.id, "rec-ghost"] }),
    suggestion({ ref: "s2", kind: "question", title: "Who approves fixes?", linkedNodeIds: ["fix", "ghost"], opportunity: null, confidence: "low", priority: "" }),
    suggestion({ ref: "s3", kind: "pain", title: "Rework at Check", opportunity: null })
  ] });
  const v = ai.validateAiResult(JSON.parse(JSON.stringify(file)));
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const review = ai.prepareReview(v.result, store.get());
  assert.deepEqual(review.errors, []);
  assert.equal(review.items.length, 3);
  assert.deepEqual(review.items[0].stepLabels, ["Do the work"]);
  assert.deepEqual(review.items[0].basedOnTitles, ["Rework at Check"]);
  assert.ok(review.items[1].notes.some(n => /ghost not found/.test(n)));
  assert.ok(review.items[2].notes.some(n => /already exists/.test(n)));

  assert.equal(ai.applyCommand(v.result, review, []), null, "nothing ticked, nothing to apply");
  const cmd = ai.applyCommand(v.result, review, ["s0", "s1"]);
  const before = store.get().revision;
  store.dispatch(cmd.type, cmd.payload);
  const e = store.get();
  assert.equal(e.revision, before + 1, "one revision for all ticked suggestions");
  const added = e.records.filter(r => r.generated);
  assert.equal(added.length, 2);
  assert.equal(added[0].generated.provider, "claude");
  assert.equal(added[0].generated.reviewed, false);
  assert.equal(added[0].opportunity.intervention, "simplify");
  assert.match(added[0].description, /Confidence: medium\./);
  assert.deepEqual(added[1].linkedNodeIds, ["fix"]);

  let handoff = exporting.buildHandoff(e);
  assert.equal(handoff.sections.opportunity.length, 0, "unreviewed AI drafts stay out of the handoff");
  assert.equal(handoff.excludedUnreviewedAi, 2);
  assert.equal(exporting.buildHandoff(e, { includeUnreviewedAi: true }).sections.opportunity.length, 1);
  assert.match(exporting.recordsToCsv(e, { includeUnreviewedAi: true }), /AI draft \(Claude\), not reviewed/);
  assert.doesNotMatch(exporting.recordsToCsv(e), /Pre-fill/);

  store.dispatch("record/markReviewed", { ids: [added[0].id] });
  handoff = exporting.buildHandoff(store.get());
  assert.equal(handoff.sections.opportunity.length, 1);
  assert.equal(handoff.excludedUnreviewedAi, 1);

  store.undo();
  store.undo();
  assert.equal(store.get().records.filter(r => r.generated).length, 0, "undo removes the applied suggestions");
});

test("a future-state change set becomes one draft with lineage, and bad changes are held back", () => {
  const store = createStore(loaded());
  const file = envelope(store.get(), "future-state", {
    name: "Automated check", summary: "Automate the check and drop the manual fix loop.",
    lanes: [{ ref: "bot", name: "Automation", role: "Runs the rules", type: "agent" }, { ref: "unused", name: "Unused", role: "", type: "human" }],
    operations: [
      op({ op: "remove", nodeId: "fix", rationale: "Rules catch errors at entry." }),
      op({ op: "insert", edgeId: "e2", label: "Validate automatically", laneRef: "bot", semanticType: "serviceTask", touchEffortMinutes: 0, typicalDurationMinutes: 1, details: [{ key: "systems", value: "Rules engine" }] }),
      op({ op: "insert", edgeId: "e2", label: "Notify the owner", laneRef: "bot", semanticType: "sendTask" }),
      op({ op: "modify", nodeId: "work", semanticType: "userTask", label: "Enter the file", touchEffortMinutes: 12, tags: { bottleneck: false, agent: false, humanReview: true } }),
      op({ op: "remove", nodeId: "start" }),
      op({ op: "remove", nodeId: "end" }),
      op({ op: "modify", nodeId: "ghost", label: "Nothing" }),
      op({ op: "modify", nodeId: "check", semanticType: "serviceTask" })
    ]
  });
  const v = ai.validateAiResult(file);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const review = ai.prepareReview(v.result, store.get());
  assert.equal(review.baseline.id, "m-current");
  const byIndex = i => review.items[i];
  assert.deepEqual(byIndex(0).problems, []);
  assert.match(byIndex(1).title, /between "Do the work" and "Check"/);
  assert.match(byIndex(4).problems[0], /start event/);
  assert.match(byIndex(5).problems[0], /End events/);
  assert.match(byIndex(6).problems[0], /not in the baseline/);
  assert.match(byIndex(7).problems[0], /Only task steps/);

  const cmd = ai.applyCommand(v.result, review, review.items.map(it => it.key));
  assert.equal(cmd.payload.operations.length, 4, "items with problems are never applied");
  assert.deepEqual(cmd.payload.operations.map(o => o.op), ["modify", "insert", "insert", "remove"]);
  assert.deepEqual(cmd.payload.lanes.map(l => l.ref), ["bot"], "only lanes that a chosen change uses");
  const before = store.get().revision;
  const { modelId } = store.dispatch(cmd.type, cmd.payload);
  const e = store.get();
  assert.equal(e.revision, before + 1);
  const draft = e.models.find(m => m.id === modelId);
  assert.equal(draft.role, "future");
  assert.equal(draft.generated.task, "future-state");
  assert.equal(draft.generated.reviewed, false);
  assert.equal(e.models.find(m => m.id === "m-current").locked, true);
  const lane = draft.lanes.find(l => l.name === "Automation");
  assert.equal(lane.type, "agent");
  const auto = draft.nodes.find(n => n.label === "Validate automatically");
  const notify = draft.nodes.find(n => n.label === "Notify the owner");
  assert.equal(auto.laneId, lane.id);
  assert.equal(auto.semanticType, "serviceTask");
  assert.equal(auto.provenance.source, "generated");
  assert.equal(auto.lineage.change, "added");
  assert.equal(auto.details.systems, "Rules engine");
  assert.equal(auto.measures.typicalDuration.value, 1);
  const path = [];
  let at = "work";
  for (let i = 0; i < 4; i++) {
    const out = draft.edges.find(x => x.from === at && !x.removed);
    at = out.to;
    path.push(at);
  }
  assert.deepEqual(path.slice(0, 3), [auto.id, notify.id, "check"], "inserts on one connector keep their order");
  const work = draft.nodes.find(n => n.id === "work");
  assert.equal(work.label, "Enter the file");
  assert.equal(work.lineage.change, "modified");
  assert.equal(work.tags.humanReview, true);
  assert.equal(draft.nodes.find(n => n.id === "fix").lineage.change, "removed");
  assert.equal(validateEngagement(JSON.parse(JSON.stringify(e))).ok, true);

  store.dispatch("model/markReviewed", { modelId });
  assert.equal(store.get().models.find(m => m.id === modelId).generated.reviewed, true);
  store.undo();
  store.undo();
  assert.equal(store.get().models.length, 1, "undo removes the draft");
  assert.equal(store.get().models[0].locked, false);
});

test("a drafted summary flags figures it cannot trace and carries its disclosure once reviewed", () => {
  const store = createStore(loaded(example("underwriting")));
  const input = ai.buildTaskInput(store.get(), "summary");
  const known = input.figures.value.length ? input.figures.value[0].text : "";
  const file = envelope(store.get(), "summary", {
    title: "Underwriting redesign", text: "The redesign saves $987,654 a year. " + known,
    keyPoints: [{ text: "Clearance takes 3 steps.", supportingRecordIds: ["rec-ghost"], supportingFigures: [] }],
    caveats: ["Figures are illustrative."]
  });
  const v = ai.validateAiResult(file);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const review = ai.prepareReview(v.result, store.get());
  const flagged = review.warnings.filter(w => w.code === "summary.number");
  assert.equal(flagged.length, 1, JSON.stringify(flagged));
  assert.match(flagged[0].message, /\$987,654/);
  assert.ok(review.items[0].notes.some(n => /not found/.test(n)));

  const cmd = ai.applyCommand(v.result, review, ["summary"]);
  store.dispatch(cmd.type, cmd.payload);
  const n = store.get().narratives[0];
  assert.equal(n.status, "draft");
  assert.match(n.text, /Key points:\n- Clearance takes 3 steps\./);
  assert.equal(exporting.buildHandoff(store.get()).executiveSummary, null, "an unreviewed AI summary is left out");
  assert.match(exporting.buildHandoff(store.get(), { includeUnreviewedAi: true }).executiveSummary.disclosure, /Not yet reviewed/);
  store.dispatch("narrative/review", { kind: "executive-summary" });
  const summary = exporting.buildHandoff(store.get()).executiveSummary;
  assert.match(summary.disclosure, /^Drafted with AI assistance \(Claude\), reviewed \d{4}-\d{2}-\d{2}\.$/);
  const reopened = validateEngagement(JSON.parse(JSON.stringify(store.get())));
  assert.equal(reopened.engagement.narratives[0].generated.reviewed, true, "generated survives save and reopen");
});

test("an extracted engagement is forced to draft status and marked as AI work", () => {
  const raw = tinyEngagement();
  raw.meta.dataStatus = "observed";
  raw.models[0].nodes[1].provenance = { source: "workshop", validation: "validated", evidenceRefs: ["ev-1"], note: "" };
  raw.evidence = [{ id: "ev-1", title: "Procedure manual", status: "validated", reviewer: "Me", reviewDate: "2026-01-01", link: "https://example.com/manual" }];
  raw.records = [{ id: "rec-1", kind: "pain", title: "Slow checks" }];
  const file = envelope(null, "extract", { engagement: raw }, { dataHandling: { confidentiality: "client-confidential" } });
  const v = ai.validateAiResult(file);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const e = v.result.payload.engagement;
  assert.equal(e.meta.dataStatus, "supplied");
  assert.equal(e.meta.disclosure, ai.EXTRACT_DISCLOSURE);
  assert.equal(e.models[0].nodes[1].provenance.validation, "unvalidated");
  assert.equal(e.models[0].nodes[1].provenance.source, "generated");
  assert.equal(e.evidence[0].status, "unreviewed");
  assert.equal(e.evidence[0].link, null);
  assert.equal(e.records[0].generated.task, "extract");
  assert.equal(e.models[0].generated.reviewed, false);
  assert.ok(v.warnings.some(w => w.code === "draft.rule" && /link/.test(w.message)));
  const review = ai.prepareReview(v.result, null);
  assert.deepEqual(review.errors, []);
  assert.equal(review.engagementSummary.models[0].steps, 5);
  assert.equal(ai.applyCommand(v.result, review, []).type, "open");
  const again = validateEngagement(JSON.parse(JSON.stringify(e)));
  assert.equal(again.ok, true);
  assert.equal(again.engagement.records[0].generated.provider, "claude");

  const broken = envelope(null, "extract", { engagement: { schema: "bpmviz.engagement", schemaVersion: 1, id: "x", models: [] } });
  const bad = ai.validateAiResult(broken);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some(x => x.path.startsWith("payload.engagement")));
});

test("results for another engagement are refused and stale ones are flagged", () => {
  const e = loaded();
  const file = ai.validateAiResult(envelope(e, "summary", { title: "t", text: "Short.", keyPoints: [], caveats: [] })).result;
  assert.match(ai.prepareReview(file, Object.assign({}, e, { id: "eng-other" })).errors[0].message, /different engagement/);
  assert.match(ai.prepareReview(file, null).errors[0].message, /Open the engagement/);
  const moved = Object.assign({}, e, { revision: e.revision + 3 });
  assert.ok(ai.prepareReview(file, moved).warnings.some(w => w.code === "result.stale"));
  const consumer = ai.validateAiResult(envelope(e, "summary", { title: "t", text: "Short.", keyPoints: [], caveats: [] },
    { generated: Object.assign({}, GENERATED, { plan: "consumer" }), dataHandling: { confidentiality: "client-confidential" } })).result;
  assert.ok(ai.prepareReview(consumer, e).warnings.some(w => w.code === "result.gate"));
});

test("task input leaves out sensitive records, visit lists, links and unreviewed drafts for the summary", () => {
  const store = createStore(loaded(example("underwriting")));
  store.dispatch("record/add", { record: { kind: "note", title: "Salary of the underwriter", sensitive: true } });
  store.dispatch("ai/applySuggestions", { records: [{ kind: "pain", title: "AI thought" }], stamp: GENERATED });
  const e = store.get();
  const forOps = ai.buildTaskInput(e, "opportunities");
  const text = JSON.stringify(forOps);
  assert.doesNotMatch(text, /Salary/);
  assert.equal(forOps.excluded.sensitiveRecords, 1);
  assert.doesNotMatch(text, /"visits"/);
  assert.doesNotMatch(text, /"link"/);
  assert.match(text, /AI thought/);
  assert.match(JSON.stringify(ai.buildTaskInput(e, "opportunities", { includeSensitive: true })), /Salary/);
  assert.doesNotMatch(JSON.stringify(ai.buildTaskInput(e, "summary")), /AI thought/);
  const fs = ai.buildTaskInput(e, "future-state");
  assert.equal(fs.models.length, 1);
  assert.equal(fs.baselineModelId, "m-current");
  assert.ok(fs.models[0].connectors.length > 0);
});
