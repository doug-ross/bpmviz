import test from "node:test";
import assert from "node:assert/strict";
import { lib, tinyEngagement } from "./helpers.mjs";

const handoff = lib("assistant-handoff");
const ai = lib("ai-results");
const { validateEngagement } = lib("validate");
const { createStore } = lib("store");
const clone = value => JSON.parse(JSON.stringify(value));
const project = () => validateEngagement(tinyEngagement()).engagement;
const options = (extra = {}) => Object.assign({
  provider: "codex", task: "opportunities", baselineModelId: "m-current",
  plan: "commercial", approvalConfirmed: true, policyConfirmed: true
}, extra);
const packet = (e = project(), extra = {}) => handoff.createPacket(e, options(extra));
const suggestion = () => ({
  ref: "s1", kind: "question", title: "Who checks exceptions?", description: "Confirm the handoff.",
  linkedModelId: "m-current", linkedNodeIds: ["work"], basedOnRecordIds: [], priority: "",
  opportunity: null, confidence: "low", rationale: "Ownership needs confirmation."
});
const payloads = {
  opportunities: { suggestions: [suggestion()] },
  "future-state": { name: "Simpler intake", summary: "Test a checklist.", lanes: [], operations: [] },
  summary: { title: "Intake review", text: "Confirm who checks the work.", keyPoints: [], caveats: ["No observed figures supplied."] },
  "log-mapping": { mappings: [{ activity: "Do work", nodeId: "work", confidence: "high", rationale: "Same task." }] }
};
function completion(p) {
  const result = clone(p.resultTemplate);
  result.payload = clone(payloads[p.task]);
  result.generated.at = "2026-10-15T12:00:00.000Z";
  return result;
}

test("the current policy gates every assistant without inferring a plan from its label", () => {
  const e = project();
  for (const provider of Object.keys(handoff.PROVIDERS)) {
    assert.throws(() => packet(e, { provider, plan: "unknown" }), { code: "policy.required" });
    assert.throws(() => packet(e, { provider, approvalConfirmed: false }), { code: "policy.required" });
    assert.throws(() => packet(e, { provider, policyConfirmed: false }), { code: "policy.required" });
    const p = packet(e, { provider });
    assert.equal(p.assistant.planSource, "user-declared");
    assert.equal(p.assistant.modelSource, "unknown");
    assert.equal(p.resultTemplate.generated.model, "");
    assert.equal(p.resultTemplate.generated.at, "");
    assert.equal(p.resultTemplate.generated.provider, provider === "copilot" ? "other" : provider);
  }
  // Caller overrides must not downgrade the project's classification.
  e.meta.confidentiality = "restricted";
  assert.throws(() => packet(e, { confidentiality: "public", dataStatus: "demonstration" }), { code: "policy.required" });
  assert.throws(() => packet(e, { plan: "consumer", writtenApproval: "Lead, today" }), { code: "policy.required" });
  assert.equal(packet(e, { writtenApproval: "Lead, today" }).dataHandling.confidentiality, "restricted");
  e.meta.confidentiality = "internal";
  assert.throws(() => packet(e, { plan: "consumer" }), { code: "policy.required" });
  assert.equal(packet(e, { plan: "consumer", trainingOptOutConfirmed: true }).assistant.plan, "consumer");
  e.meta.confidentiality = "public";
  const publicPacket = packet(e, { plan: "unknown", approvalConfirmed: false });
  assert.equal(publicPacket.assistant.plan, "unknown");
  assert.equal(publicPacket.resultTemplate.generated.plan, "unknown");
});

test("packets filter sensitive and unreviewed material for every task with no mutation", () => {
  const store = createStore(project());
  for (const title of ["Approved question", "Sensitive marker", "Unreviewed marker"]) {
    store.dispatch("record/add", { record: { kind: "question", title, linkedModelId: "m-current", linkedNodeIds: ["work"] } });
  }
  const e = clone(store.get());
  e.records[1].sensitive = true;
  e.records[2].generated = { provider: "codex", reviewed: false };
  e.records[0].owner = "Owner marker";
  e.records[0].evidenceRefs = ["ev-secret"];
  e.evidence = [{ id: "ev-secret", title: "Evidence marker", extractedFact: "Evidence fact marker", link: "https://example.com/private" }];
  e.meta.clientDisplayName = "Client marker";
  e.meta.summary = "Summary marker";
  e.assumptions = [{ id: "assumption-a", key: "a", label: "Assumption marker", value: 1, source: "Source marker" }];
  e.models.push(Object.assign(clone(e.models[0]), { id: "unreviewed-model", name: "Model marker", generated: { reviewed: false } }));
  e.models[0].nodes[0].credential = "Ignored marker";
  e.datasets = [{ id: "private", notes: "Raw log marker" }];
  const before = clone(e);
  for (const task of Object.keys(handoff.TASKS)) {
    const p = packet(e, { task, activities: [{ name: "Do work", events: 99, caseId: "Case marker", resource: "Resource marker" }], includeSensitive: true, includeUnreviewedAi: true });
    const text = JSON.stringify(p);
    for (const marker of ["Sensitive marker", "Unreviewed marker", "Evidence marker", "Evidence fact marker", "Client marker", "Summary marker", "Assumption marker", "Owner marker", "Model marker", "Raw log marker", "Case marker", "Resource marker", "Ignored marker", "https://example.com/private"]) {
      assert.equal(text.includes(marker), false, task + ": " + marker);
    }
    assert.equal(p.input.baselineModelId, "m-current");
    assert.equal(p.dataHandling.sensitiveIncluded, false);
    assert.deepEqual(p.input.evidence || [], []);
    assert.deepEqual(p.input.assumptions || [], []);
    if (task !== "log-mapping") assert.equal(p.input.records[0].title, "Approved question");
  }
  assert.deepEqual(e, before);
});

test("unreviewed models and steps cannot enter a baseline", () => {
  const e = project();
  e.models[0].generated = { reviewed: false };
  assert.deepEqual(handoff.baselines(e), []);
  assert.throws(() => packet(e), { code: "baseline.invalid" });
  e.models[0].generated.reviewed = true;
  e.models[0].nodes[1].generated = { reviewed: false };
  const p = packet(e);
  assert.equal(p.input.models[0].steps.some(s => s.id === "work"), false);
  assert.equal(p.input.models[0].connectors.some(c => c.to === "work" || c.from === "work"), false);
});

test("every payload schema is the existing task schema and envelopes roundtrip through the existing validator", () => {
  for (const task of Object.keys(handoff.TASKS)) {
    for (const provider of Object.keys(handoff.PROVIDERS)) {
      const p = packet(project(), { task, provider, activities: [{ name: "Do work" }] });
      assert.deepEqual(p.payloadSchema, ai.TASK_SCHEMAS[task]);
      assert.deepEqual(p.resultSchema.properties.payload, ai.TASK_SCHEMAS[task]);
      const result = completion(p);
      assert.equal(handoff.validateCompletion(p, result).ok, true, task + " " + provider);
      const v = ai.parseAiResultText(JSON.stringify(result));
      assert.equal(v.ok, true, JSON.stringify(v.errors));
      assert.equal(v.result.engagementRevision, p.engagementRevision);
      assert.equal(v.result.baselineModelId, p.baselineModelId);
      assert.ok(p.instructions.some(s => /live project revision/.test(s)));
      assert.equal(JSON.parse(handoff.serialize(p, "json")).schema, handoff.PACKET_SCHEMA);
      assert.match(handoff.serialize(p, "text"), /Return one complete JSON envelope/);
    }
  }
});

test("a packet binds completions to its original ID, revision, task, baseline and policy", () => {
  const p = packet();
  for (const [key, value] of [["engagementId", "another"], ["engagementRevision", 1], ["engagementRevision", null], ["task", "summary"], ["baselineModelId", "missing"]]) {
    assert.throws(() => handoff.validateCompletion(p, Object.assign(completion(p), { [key]: value })), { code: "result.binding" });
  }
  const result = completion(p);
  result.generated.plan = "unknown";
  assert.throws(() => handoff.validateCompletion(p, result), { code: "result.shape" });
  result.generated.plan = "commercial";
  result.dataHandling.confidentiality = "public";
  assert.throws(() => handoff.validateCompletion(p, result), { code: "result.shape" });
  assert.throws(() => packet(project(), { baselineModelId: "missing" }), { code: "baseline.invalid" });
  assert.throws(() => packet(project(), { provider: "constructor" }), { code: "provider.invalid" });
  assert.throws(() => packet(project(), { task: "extract" }), { code: "task.invalid" });
});

test("credentials in selected data or approvals block export without echoing their value", () => {
  for (const value of ["sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123", "ghp_" + "a".repeat(36), "github_pat_" + "b".repeat(30), "password=secret-example-value", "Authorization: Bearer abcdefghijklmnop", "https://username:password@example.com", "-----BEGIN RSA PRIVATE KEY-----"]) {
    const e = project();
    e.models[0].nodes[1].label = value;
    assert.throws(() => packet(e), err => err.code === "input.secret" && !err.message.includes(value));
    assert.throws(() => packet(project(), { writtenApproval: value }), { code: "input.secret" });
    const p = packet();
    const result = completion(p);
    result.notes = value;
    assert.throws(() => handoff.validateCompletion(p, result), { code: "output.secret" });
  }
  assert.equal(handoff.secretHits("Ask the API key owner to check access.").length, 0);
  const p = packet(project(), { task: "log-mapping", activities: [{ name: "Do work" }, { name: "ghp_" + "a".repeat(36) }] });
  assert.deepEqual(p.input.activities, ["Do work"]);
  assert.equal(p.input.excluded.secretActivities, 1);
  assert.throws(() => packet(project(), { task: "log-mapping", activities: [{ name: "password=abcdefghi" }] }), { code: "input.secret" });
});

test("immutable revision guard and existing proposal apply preserve one revision and undo", () => {
  const store = createStore(project());
  const p = packet(store.get());
  const result = handoff.validateCompletion(p, completion(p)).result;
  assert.equal(handoff.requireCurrentRevision(result, store.get()), true);
  const review = ai.prepareReview(result, store.get());
  assert.deepEqual(review.errors, []);
  const command = ai.applyCommand(result, review, ["s0"]);
  command.payload.expectedRevision = p.engagementRevision;
  store.dispatch(command.type, command.payload);
  assert.equal(store.get().revision, p.engagementRevision + 1);
  assert.equal(store.get().records.at(-1).generated.reviewed, false);
  assert.throws(() => store.dispatch(command.type, command.payload), { code: "stale" });
  assert.equal(store.get().revision, p.engagementRevision + 1, "a replay cannot bypass the store revision guard");
  assert.throws(() => handoff.requireCurrentRevision(result, store.get()), { code: "result.revision" });
  assert.throws(() => handoff.requireCurrentRevision(Object.assign({}, result, { engagementId: "other" }), store.get()), { code: "result.project" });
  assert.throws(() => handoff.requireCurrentRevision(Object.assign({}, result, { engagementRevision: null }), project()), { code: "result.revision" });
  assert.equal(handoff.validateCompletion(p, completion(p)).ok, true, "validation keeps the original packet binding after the project changes");
  assert.equal(p.resultTemplate.engagementRevision, 0);
  store.undo();
  assert.equal(store.get().records.length, 0);
});
