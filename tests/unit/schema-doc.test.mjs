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
