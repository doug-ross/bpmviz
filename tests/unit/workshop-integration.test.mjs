import test from "node:test";
import assert from "node:assert/strict";
import { lib, tinyEngagement } from "./helpers.mjs";

const validate = lib("validate");
const storeLib = lib("store");
const workshop = lib("workshop");

test("a workshop and its automation details survive the project save/open boundary", () => {
  const e = validate.validateEngagement(tinyEngagement()).engagement;
  e.workshop = workshop.sanitizeWorkshop({ currentModelId: "m-current", agenda: [
    { id: "discover", title: "Confirm the process", owner: "Facilitator", minutes: 30, status: "active" }
  ], designs: [{ modelId: "m-current", nodeId: "work", owner: "Operations", responsibility: "ai-assist",
    trigger: "Application received", inputs: "Application", outputs: "Proposed classification", systems: "Case system",
    rules: "Check required fields", approval: "Case handler approves", fallback: "Manual review", testCriteria: "Missing fields are flagged",
    sensitive: false, reviewed: true }] }, e);
  const opened = validate.parseEngagementText(JSON.stringify(e));
  assert.equal(opened.ok, true, JSON.stringify(opened.errors));
  assert.deepEqual(opened.engagement.workshop, e.workshop);
  assert.equal(opened.warnings.some(w => w.code === "fields.ignored" && /workshop/.test(w.message)), false);
});

test("a proposal's expected revision rejects changes atomically without altering undo history", () => {
  const store = storeLib.createStore(validate.validateEngagement(tinyEngagement()).engagement);
  store.dispatch("node/update", { modelId: "m-current", nodeId: "work", patch: { label: "Changed by facilitator" } });
  const before = JSON.stringify(store.get());
  assert.throws(() => store.dispatch("node/update", { expectedRevision: 0, modelId: "m-current", nodeId: "work", patch: { label: "Old proposal" } }), /project changed/i);
  assert.equal(JSON.stringify(store.get()), before);
  assert.equal(store.undo(), true);
  assert.equal(store.get().models[0].nodes.find(n => n.id === "work").label, "Do the work");
  assert.equal(store.canUndo(), false);
});
