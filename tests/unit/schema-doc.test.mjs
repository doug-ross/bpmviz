// The published JSON Schema stays in step with the validator's enumerations.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { lib, root } from "./helpers.mjs";

const doc = JSON.parse(fs.readFileSync(path.join(root, "webui", "schema", "engagement.schema.json"), "utf8"));
const schema = lib("schema");

test("the JSON Schema matches the validator's identifiers and enumerations", () => {
  assert.equal(doc.properties.schema.const, schema.SCHEMA_ID);
  assert.equal(doc.properties.schemaVersion.const, schema.SCHEMA_VERSION);
  assert.deepEqual(doc.$defs.record.properties.kind.enum, schema.ENUMS.recordKind);
  assert.deepEqual(doc.$defs.run.properties.membership.additionalProperties.enum, schema.ENUMS.membership);
  assert.deepEqual(doc.$defs.node.properties.semanticType.enum, Object.keys(schema.SEMANTIC_TYPES));
  assert.deepEqual(doc.$defs.record.properties.opportunity.anyOf[1].properties.intervention.enum, schema.ENUMS.intervention);
  assert.deepEqual(doc.$defs.lane.properties.type.enum, schema.ENUMS.laneType);
});

test("the ID pattern in the JSON Schema is the validator's", () => {
  assert.equal(doc.$defs.id.pattern, lib("util").ID_PATTERN.source);
});

test("AI markers, narratives and the AI result schema are published", () => {
  assert.deepEqual(doc.$defs.generated.properties.provider.enum, schema.ENUMS.aiProvider);
  assert.equal(doc.$defs.record.properties.generated.$ref, "#/$defs/generated");
  assert.equal(doc.$defs.model.properties.generated.$ref, "#/$defs/generated");
  assert.deepEqual(doc.$defs.narrative.properties.kind.enum, schema.ENUMS.narrativeKind);
  const result = JSON.parse(fs.readFileSync(path.join(root, "webui", "schema", "ai-result.schema.json"), "utf8"));
  const ai = lib("ai-results");
  assert.equal(result.properties.schema.const, ai.RESULT_SCHEMA);
  assert.deepEqual(result.properties.task.enum, schema.ENUMS.aiTask);
  assert.deepEqual(result.$defs.futureState, JSON.parse(JSON.stringify(ai.TASK_SCHEMAS["future-state"])));
});

test("datasets, value cases, reviews and the log-mapping task are published", () => {
  const E = schema.ENUMS;
  assert.deepEqual(doc.$defs.dataset.properties.role.enum, E.datasetRole);
  assert.deepEqual(doc.$defs.dataset.properties.source.properties.format.enum, E.logFormat);
  assert.deepEqual(doc.$defs.dataset.properties.source.properties.timestampMode.enum, E.timestampMode);
  assert.deepEqual(doc.$defs.dataset.properties.source.properties.caseIds.enum, E.caseIdHandling);
  assert.deepEqual(doc.$defs.dataset.properties.mapping.items.properties.method.enum, E.mappingMethod);
  assert.equal(doc.$defs.dataset.properties.variants.maxItems, schema.LIMITS.datasetVariants);
  assert.equal(doc.properties.datasets.maxItems, schema.LIMITS.datasets);
  const opp = doc.$defs.record.properties.opportunity.anyOf[1].properties;
  assert.deepEqual(opp.wave.enum, E.wave);
  assert.equal(opp.valueCase.$ref, "#/$defs/valueCase");
  assert.deepEqual(doc.$defs.valueCase.properties.confidence.enum, E.confidence);
  assert.deepEqual(doc.$defs.valueCase.properties.basis.enum, E.assumptionStatus);
  assert.deepEqual(doc.$defs.valueCase.properties.shareSource.enum, E.valueInputSource);
  assert.ok(doc.$defs.measure.properties.status.enum.includes("observed"));
  assert.deepEqual(doc.$defs.scenario.properties.observedFrom.required, ["datasetId"]);
  assert.deepEqual(doc.$defs.review.properties.entries.items.properties.verdict.enum, E.reviewVerdict);
  assert.deepEqual(doc.$defs.reviewPack.properties.format.enum, E.reviewFormat);
  const result = JSON.parse(fs.readFileSync(path.join(root, "webui", "schema", "ai-result.schema.json"), "utf8"));
  assert.deepEqual(result.$defs.logMapping, JSON.parse(JSON.stringify(lib("ai-results").TASK_SCHEMAS["log-mapping"])));
  assert.ok(result.properties.payload.anyOf.some(x => x.$ref === "#/$defs/logMapping"));
  const response = JSON.parse(fs.readFileSync(path.join(root, "webui", "schema", "review-response.schema.json"), "utf8"));
  assert.equal(response.properties.schema.const, schema.REVIEW_RESPONSE_ID);
  assert.deepEqual(response.properties.entries.items.properties.verdict.enum, [""].concat(E.reviewVerdict));
  assert.equal(response.properties.entries.maxItems, schema.LIMITS.reviewEntries);
});
