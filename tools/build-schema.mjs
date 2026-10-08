#!/usr/bin/env node
/*
 * Writes webui/schema/engagement.schema.json and ai-result.schema.json from
 * the enumerations in webui/js/lib/schema.js and the task schemas in
 * ai-results.js, so the published contracts and the validators agree.
 *   node tools/build-schema.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = require("../webui/js/lib/schema.js");
const units = require("../webui/js/lib/units.js");
const aiResults = require("../webui/js/lib/ai-results.js");
const E = schema.ENUMS;

const en = name => ({ enum: E[name] });
const id = { $ref: "#/$defs/id" };
const ids = { type: "array", items: id };
const text = max => ({ type: "string", maxLength: max || schema.LIMITS.stringLength });
const unitEnum = { enum: Object.keys(units.UNITS) };
const measureValue = {
  type: ["object", "null"], required: ["value", "unit"], additionalProperties: false,
  properties: { value: { type: "number" }, unit: unitEnum }
};
const flags = ["bottleneck", "agent", "humanReview", "optional", "sampled"];
const aiKeys = ["inputStructure", "dataAvailability", "judgment", "exceptions", "authority", "humanReview", "auditability", "failureHandling"];

const doc = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://bpmviz.local/schema/engagement.schema.json",
  title: "BPMVIZ engagement",
  description: "Portable engagement file for the BPMVIZ process workshop workbench, schema version 1. " +
    "The validator in webui/js/lib/validate.js enforces this contract and also checks references between " +
    "objects, timing and economic reconciliation, which JSON Schema cannot express.",
  type: "object",
  required: ["schema", "schemaVersion", "id", "meta", "models"],
  additionalProperties: false,
  properties: {
    schema: { const: schema.SCHEMA_ID },
    schemaVersion: { const: schema.SCHEMA_VERSION },
    id,
    revision: { type: "integer", minimum: 0, description: "Increments on every business change." },
    createdAt: text(40),
    updatedAt: text(40),
    meta: { $ref: "#/$defs/meta" },
    milestones: { type: "array", maxItems: 50, items: { $ref: "#/$defs/milestone" } },
    models: { type: "array", minItems: 1, maxItems: schema.LIMITS.models, items: { $ref: "#/$defs/model" } },
    scenarios: { type: "array", maxItems: schema.LIMITS.scenarios, items: { $ref: "#/$defs/scenario" } },
    records: { type: "array", maxItems: schema.LIMITS.records, items: { $ref: "#/$defs/record" } },
    evidence: { type: "array", maxItems: schema.LIMITS.evidence, items: { $ref: "#/$defs/evidence" } },
    assumptions: { type: "array", maxItems: schema.LIMITS.assumptions, items: { $ref: "#/$defs/assumption" } },
    narratives: { type: "array", maxItems: schema.LIMITS.narratives, items: { $ref: "#/$defs/narrative" } },
    migration: { anyOf: [{ type: "null" }, { $ref: "#/$defs/migration" }] }
  },
  $defs: {
    id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$" },
    meta: {
      type: "object", additionalProperties: false,
      properties: {
        clientDisplayName: text(200), engagementName: text(200), processName: text(200),
        confidentiality: en("confidentiality"), dataStatus: en("dataStatus"),
        timeBasis: {
          type: "object", additionalProperties: false, required: ["unit", "calendar"],
          properties: { unit: { const: "minute" }, calendar: en("timeCalendar"), businessMinutesPerDay: { type: "number", minimum: 1, maximum: 1440 } }
        },
        currency: { type: "string", pattern: "^[A-Z]{3}$" },
        disclosure: text(2000), summary: text(4000), credits: text(500)
      }
    },
    milestone: { type: "object", required: ["id", "name"], additionalProperties: false, properties: { id, name: text(120), position: { type: "number", minimum: 0, maximum: 1 } } },
    lane: { type: "object", required: ["id", "name"], additionalProperties: false, properties: { id, name: text(200), role: text(300), type: en("laneType") } },
    node: {
      type: "object", required: ["id", "label", "semanticType", "laneId"], additionalProperties: false,
      properties: {
        id, label: text(300), sub: text(300),
        semanticType: { enum: Object.keys(schema.SEMANTIC_TYPES), description: "Other values load as 'unsupported' with a warning." },
        sourceType: text(80),
        laneId: id,
        sourceIds: { type: "array", items: text(200), description: "IDs of the source BPMN elements this step represents." },
        details: { type: "object", description: "Free-form business detail. Known keys: " + require("../webui/js/lib/store.js").DETAIL_KEYS.join(", ") + "." },
        tags: { type: "object", additionalProperties: false, properties: Object.fromEntries(flags.map(k => [k, { type: "boolean" }])) },
        measures: {
          type: "object", additionalProperties: false,
          properties: { typicalDuration: measureValue, slaTarget: measureValue, touchEffort: measureValue, waitType: en("waitType") }
        },
        provenance: {
          type: "object", additionalProperties: false,
          properties: { source: en("provenanceSource"), validation: en("validation"), evidenceRefs: ids, note: text(4000) }
        },
        lineage: {
          anyOf: [{ type: "null" }, {
            type: "object", additionalProperties: false,
            properties: { baselineNodeId: { anyOf: [id, { type: "null" }] }, change: en("change"), rationale: text(4000) }
          }]
        },
        removed: { type: "boolean" }
      }
    },
    edge: {
      type: "object", required: ["id", "from", "to"], additionalProperties: false,
      properties: {
        id, from: id, to: id, label: text(200), semanticType: en("edgeType"), dashed: { type: "boolean" },
        emphasis: { enum: ["", "early"] }, removed: { type: "boolean" },
        lineage: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, properties: { change: en("change"), rationale: text(4000) } }] }
      }
    },
    model: {
      type: "object", required: ["id", "role", "lanes", "nodes", "edges"], additionalProperties: false,
      properties: {
        id, role: en("modelRole"), name: text(200), version: { type: "integer", minimum: 1 }, status: en("modelStatus"),
        locked: { type: "boolean", description: "True for a baseline that a future-state draft is based on." },
        basedOn: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, properties: { modelId: id, version: { type: "integer", minimum: 1 } } }] },
        sourceRefs: ids, notes: text(4000), generated: { $ref: "#/$defs/generated" },
        lanes: { type: "array", minItems: 1, maxItems: schema.LIMITS.lanesPerModel, items: { $ref: "#/$defs/lane" } },
        nodes: { type: "array", minItems: 1, maxItems: schema.LIMITS.nodesPerModel, items: { $ref: "#/$defs/node" } },
        edges: { type: "array", maxItems: schema.LIMITS.edgesPerModel, items: { $ref: "#/$defs/edge" } },
        presentation: {
          type: "object", additionalProperties: false,
          properties: {
            laneHeight: { type: ["number", "null"], minimum: 60, maximum: 400 },
            nodes: {
              type: "object", description: "Column position per step ID; fractions are allowed. Steps without a position are laid out along the flow.",
              additionalProperties: { type: "object", required: ["x"], properties: { x: { type: "number" } } }
            }
          }
        }
      }
    },
    visit: { type: "object", required: ["id", "nodeId", "start", "end"], additionalProperties: false, properties: { id, nodeId: id, start: { type: "number", minimum: 0 }, end: { type: "number", minimum: 0 } } },
    transition: { type: "object", required: ["edgeId", "fromVisitId", "toVisitId"], additionalProperties: false, properties: { edgeId: id, fromVisitId: id, toVisitId: id } },
    run: {
      type: "object", additionalProperties: false,
      properties: {
        visits: { type: "array", maxItems: schema.LIMITS.visitsPerRun, items: { $ref: "#/$defs/visit" } },
        transitions: { type: "array", items: { $ref: "#/$defs/transition" }, description: "Omit to have transitions derived from visit timing and connectors." },
        membership: { type: "object", additionalProperties: en("membership"), description: "Per step ID: included, excluded (shown as Not in scenario) or unknown (shown as Not confirmed)." },
        pauseAt: { type: ["number", "null"], minimum: 0 },
        milestones: { type: "object", additionalProperties: { type: "number", minimum: 0 } }
      }
    },
    measure: {
      type: "object", required: ["key", "unit", "values"], additionalProperties: false,
      properties: {
        key: text(80), label: text(200), unit: unitEnum,
        values: { type: "object", description: "Value per model ID.", additionalProperties: { type: ["number", "null"] } },
        suppliedText: { type: "object", additionalProperties: text(200) },
        status: { enum: ["supplied", "calculated", "validated"] }, note: text(2000)
      }
    },
    scenario: {
      type: "object", required: ["id", "name"], additionalProperties: false,
      properties: {
        id, name: text(300), statusLabel: text(80), statusTone: { enum: ["done", "progress", "stuck", "new", ""] },
        provenance: en("scenarioProvenance"), summary: text(4000),
        attributes: { type: "array", items: { type: "object", properties: { label: text(120), value: text(500) } } },
        timing: { type: "object", properties: { method: en("timingMethod"), note: text(2000) } },
        runs: { type: "object", description: "Run per model ID.", additionalProperties: { $ref: "#/$defs/run" } },
        measures: { type: "array", items: { $ref: "#/$defs/measure" } },
        economics: {
          anyOf: [{ type: "null" }, {
            type: "object", additionalProperties: false,
            properties: {
              beforeModelId: { anyOf: [id, { type: "null" }] }, afterModelId: { anyOf: [id, { type: "null" }] },
              supplied: {
                type: "object",
                properties: {
                  beforeCostPerCase: { type: ["number", "null"] }, afterCostPerCase: { type: ["number", "null"] },
                  costSavedPerCase: { type: ["number", "null"] }, fteCapacity: { type: ["number", "null"] },
                  text: { type: "object", additionalProperties: text(300) }
                }
              },
              overrides: {
                type: "object", description: "Scenario-specific driver values, keyed by driver.",
                additionalProperties: { type: "object", required: ["value"], properties: { value: { type: "number" }, status: en("assumptionStatus"), note: text(1000) } }
              }
            }
          }]
        }
      }
    },
    record: {
      type: "object", required: ["id", "kind", "title"], additionalProperties: false,
      properties: {
        id, kind: en("recordKind"), title: text(300), description: text(), owner: text(200), status: en("recordStatus"), priority: en("priority"),
        linkedModelId: { anyOf: [id, { type: "null" }] }, linkedModelVersion: { type: ["integer", "null"] },
        linkedNodeIds: ids, evidenceRefs: ids, sensitive: { type: "boolean" }, includeInHandoff: { type: "boolean" },
        opportunity: {
          anyOf: [{ type: "null" }, {
            type: "object",
            properties: {
              intervention: en("intervention"), simplerAlternative: text(4000), expectedBenefit: text(4000), affectedVolume: text(500),
              effort: en("effortSize"), risk: text(4000), dependencies: text(4000), validationAction: text(4000),
              aiAssessment: { type: "object", properties: Object.assign(Object.fromEntries(aiKeys.map(k => [k, text(2000)])), { mode: { enum: ["", "assist", "autonomous"] } }) }
            }
          }]
        },
        generated: { $ref: "#/$defs/generated" },
        createdAt: text(40), updatedAt: text(40)
      }
    },
    generated: {
      type: "object", additionalProperties: false,
      description: "Present when an AI assistant drafted the item. Handoff, presenter and CSV exports leave out unreviewed AI drafts by default.",
      properties: {
        task: en("aiTask"), provider: en("aiProvider"), model: text(120), surface: en("aiSurface"), at: text(40),
        jobId: text(80), plan: en("aiPlan"), reviewed: { type: "boolean" }, reviewedAt: text(40)
      }
    },
    narrative: {
      type: "object", required: ["id", "kind", "text"], additionalProperties: false,
      properties: {
        id, kind: en("narrativeKind"), title: text(300), text: text(12000), status: en("narrativeStatus"),
        generated: { $ref: "#/$defs/generated" }, createdAt: text(40), updatedAt: text(40)
      }
    },
    evidence: {
      type: "object", required: ["id", "title"], additionalProperties: false,
      properties: {
        id, title: text(300), locator: text(500), extractedFact: text(), status: en("evidenceStatus"), reviewer: text(200), reviewDate: text(40),
        link: { anyOf: [{ type: "null" }, { type: "string", pattern: "^https?://" }], description: "Only http and https links are kept." }
      }
    },
    assumption: {
      type: "object", required: ["id", "key"], additionalProperties: false,
      properties: {
        id, key: { type: "string", description: "Known driver keys: " + schema.DRIVERS.map(d => d.key).join(", ") + "." },
        label: text(300), value: { type: ["number", "null"], minimum: 0 }, unit: text(40), status: en("assumptionStatus"), source: text(500), note: text(2000)
      }
    },
    migration: {
      type: "object",
      properties: {
        sourceFormat: text(120), sourceFiles: { type: "array", items: text(300) }, convertedAt: text(40),
        warnings: { type: "array", items: { type: "object", properties: { code: text(80), message: text(2000), path: text(300) } } }
      }
    }
  }
};

const out = path.join(root, "webui", "schema", "engagement.schema.json");
fs.writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
console.log("Wrote " + path.relative(root, out));

const T = aiResults.TASK_SCHEMAS;
const resultDoc = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://bpmviz.local/schema/ai-result.schema.json",
  title: "BPMVIZ AI result",
  description: "Output of one AI task (extract, opportunities, future-state or summary), schema version 1. " +
    "The app opens it with Open, lists each proposed change for review and applies the ticked ones in one undoable step. " +
    "webui/js/lib/ai-results.js enforces this contract. Check a file with: npm run ai -- check <file>.",
  type: "object",
  required: ["schema", "schemaVersion", "task", "payload"],
  properties: {
    schema: { const: aiResults.RESULT_SCHEMA },
    schemaVersion: { const: aiResults.RESULT_VERSION },
    task: en("aiTask"),
    engagementId: { anyOf: [id, { type: "null" }], description: "The engagement the task read. Null for extract." },
    engagementRevision: { type: ["integer", "null"], minimum: 0 },
    baselineModelId: { anyOf: [id, { type: "null" }], description: "The current-state model a future-state change set applies to." },
    generated: {
      type: "object",
      properties: { tool: text(80), provider: en("aiProvider"), model: text(120), surface: en("aiSurface"), at: text(40), jobId: text(80), plan: en("aiPlan") }
    },
    dataHandling: {
      type: "object",
      properties: {
        confidentiality: en("confidentiality"), dataStatus: en("dataStatus"), approvalConfirmed: { type: "boolean" },
        trainingOptOutConfirmed: { type: "boolean" }, writtenApproval: text(500), sensitiveIncluded: { type: "boolean" }
      }
    },
    sources: { type: "array", maxItems: 50, items: { type: "object", properties: { name: text(260), kind: text(40), sha256: { type: "string" }, pages: { type: ["integer", "null"] } } } },
    notes: text(4000),
    warnings: { type: "array", items: { type: "object", properties: { code: text(80), message: text(2000), path: text(300) } } },
    payload: {
      description: "extract: { engagement } (see engagement.schema.json). The other tasks use the schemas in $defs.",
      anyOf: [
        { type: "object", required: ["engagement"], properties: { engagement: { $ref: "engagement.schema.json" } } },
        { $ref: "#/$defs/opportunities" }, { $ref: "#/$defs/futureState" }, { $ref: "#/$defs/summary" }
      ]
    }
  },
  $defs: {
    id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$" },
    opportunities: T.opportunities,
    futureState: T["future-state"],
    summary: T.summary
  }
};
const resultOut = path.join(root, "webui", "schema", "ai-result.schema.json");
fs.writeFileSync(resultOut, JSON.stringify(resultDoc, null, 2) + "\n");
console.log("Wrote " + path.relative(root, resultOut));
