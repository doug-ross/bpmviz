#!/usr/bin/env node
/*
 * Writes webui/schema/engagement.schema.json, ai-result.schema.json and
 * review-response.schema.json from the enumerations in webui/js/lib/schema.js
 * and the task schemas in ai-results.js, so the published contracts and the
 * validators agree.
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
const L = schema.LIMITS;
const nullableId = { anyOf: [id, { type: "null" }] };
const count = { type: "integer", minimum: 0 };
const share = { type: ["number", "null"], minimum: 0, maximum: 1 };
const percent = { type: ["number", "null"], minimum: 0, maximum: 100 };
const stats = { anyOf: [{ type: "null" }, { $ref: "#/$defs/stats" }] };
const itemRef = { type: "string", pattern: "^(step/[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}/[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}|record/[A-Za-z0-9][A-Za-z0-9_.:-]{0,79})$",
  description: "step/<modelId>/<nodeId> or record/<recordId>." };

const doc = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://aixray.local/schema/engagement.schema.json",
  title: "AIxRay engagement",
  description: "Portable engagement file for the AIxRay process workshop workbench, schema version 1. " +
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
    datasets: { type: "array", maxItems: L.datasets, items: { $ref: "#/$defs/dataset" }, description: "Aggregates of imported event logs. Optional." },
    reviewPacks: { type: "array", maxItems: L.reviewPacks, items: { $ref: "#/$defs/reviewPack" }, description: "Review packs sent to client stakeholders. Optional." },
    reviews: { type: "array", maxItems: L.reviews, items: { $ref: "#/$defs/review" }, description: "Client reviews received and applied. Optional." },
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
        status: { enum: ["supplied", "calculated", "observed", "validated"] }, note: text(2000)
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
        observedFrom: {
          type: "object", required: ["datasetId"], additionalProperties: false,
          description: "Present when the scenario was generated from an event log.",
          properties: { datasetId: id, variantId: { type: ["string", "null"], maxLength: 80 }, caseLabel: text(200) }
        },
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
              wave: en("wave"), valueCase: { $ref: "#/$defs/valueCase" },
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
    stats: {
      type: "object", additionalProperties: false, required: ["n"],
      description: "Summary statistics in minutes of the dataset time basis (counts for eventsPerCase). Percentiles use linear interpolation.",
      properties: Object.assign({ n: count }, Object.fromEntries(["mean", "min", "p10", "p25", "p50", "p75", "p90", "max"].map(k => [k, { type: ["number", "null"] }])))
    },
    dataset: {
      type: "object", required: ["id"], additionalProperties: false,
      description: "Aggregates of one event log: never events, case IDs or resource names.",
      properties: {
        id, name: text(200), role: en("datasetRole"), comparesToDatasetId: nullableId, modelId: nullableId,
        dataStatus: en("dataStatus"), createdAt: text(40),
        source: {
          type: "object", additionalProperties: false,
          properties: {
            fileName: text(260), format: en("logFormat"), sha256: { type: "string", pattern: "^([0-9a-f]{64})?$" },
            rows: count, events: count, timestampMode: en("timestampMode"), caseIds: en("caseIdHandling"),
            resources: { enum: ["dropped", "counted"] }, droppedRows: count, unmatchedEvents: count, excludedIncompleteCases: count
          }
        },
        period: { type: "object", additionalProperties: false, properties: { start: text(40), end: text(40), days: { type: ["number", "null"], minimum: 0 } } },
        timeBasis: {
          type: "object", additionalProperties: false,
          properties: {
            calendar: en("timeCalendar"), businessMinutesPerDay: { type: "number", minimum: 1, maximum: 1440 },
            dayStartMinute: { type: "integer", minimum: 0, maximum: 1439 }
          }
        },
        mapping: {
          type: "array", maxItems: L.datasetMapping,
          items: { type: "object", required: ["activity"], additionalProperties: false, properties: { activity: text(300), nodeId: nullableId, method: en("mappingMethod"), events: count } }
        },
        cases: {
          type: "object", additionalProperties: false,
          properties: {
            count, complete: count, arrivalsPerDay: { type: ["number", "null"], minimum: 0 }, annualizedVolume: { type: ["number", "null"], minimum: 0 },
            cycleTime: stats, eventsPerCase: stats
          }
        },
        steps: {
          type: "array", maxItems: L.nodesPerModel,
          items: {
            type: "object", required: ["nodeId"], additionalProperties: false,
            properties: {
              nodeId: id, visits: count, cases: count, caseShare: share, reworkCases: count, reworkRate: share,
              duration: stats, wait: stats, sojourn: stats, resources: { type: ["integer", "null"], minimum: 0 }, handoffRate: share
            }
          }
        },
        transitions: {
          type: "array", maxItems: L.datasetTransitions,
          items: { type: "object", required: ["fromNodeId", "toNodeId"], additionalProperties: false, properties: { fromNodeId: id, toNodeId: id, count, edgeIds: ids } }
        },
        variants: {
          type: "array", maxItems: L.datasetVariants,
          items: {
            type: "object", required: ["id", "nodeIds"], additionalProperties: false,
            properties: { id, nodeIds: { type: "array", maxItems: L.variantSteps, items: id }, cases: count, share, cycleTime: stats }
          }
        },
        otherVariants: { type: "object", additionalProperties: false, properties: { variants: count, cases: count } },
        scenarioIds: { type: "array", maxItems: L.scenariosPerDataset, items: id },
        notes: text(4000)
      }
    },
    valueCase: {
      type: "object", additionalProperties: false,
      description: "Figures behind an opportunity's modeled value. Empty nodeIds means the record's linked steps.",
      properties: {
        modelId: nullableId, nodeIds: ids,
        effortReductionPct: percent, durationReductionPct: percent, shareOfCasesPct: percent,
        shareSource: en("valueInputSource"), effortSource: { enum: ["node", "dataset"] }, datasetId: nullableId,
        oneTimeCost: { type: ["number", "null"], minimum: 0 }, annualRunningCost: { type: ["number", "null"], minimum: 0 },
        confidence: en("confidence"), basis: en("assumptionStatus"), note: text(2000)
      }
    },
    person: { type: "object", additionalProperties: false, properties: { name: text(200), role: text(200), organization: text(200) } },
    itemRef,
    reviewPack: {
      type: "object", required: ["id"], additionalProperties: false,
      properties: {
        id, createdAt: text(40), format: en("reviewFormat"), stakeholder: { $ref: "#/$defs/person" },
        engagementRevision: { type: ["integer", "null"], minimum: 0 }, modelId: nullableId,
        items: { type: "array", maxItems: L.reviewEntries, items: { type: "object", required: ["itemRef"], additionalProperties: false, properties: { itemRef: { $ref: "#/$defs/itemRef" }, label: text(300) } } },
        note: text(4000)
      }
    },
    review: {
      type: "object", required: ["id"], additionalProperties: false,
      properties: {
        id, packId: nullableId, receivedAt: text(40), submittedAt: text(40), source: en("reviewFormat"),
        reviewer: { $ref: "#/$defs/person" }, generalComment: text(4000),
        entries: {
          type: "array", maxItems: L.reviewEntries,
          items: { type: "object", required: ["itemRef", "verdict"], additionalProperties: false, properties: { itemRef: { $ref: "#/$defs/itemRef" }, label: text(300), verdict: en("reviewVerdict"), comment: text(4000) } }
        },
        applied: { type: "object", additionalProperties: false, properties: { validations: count, questions: count, evidenceId: nullableId } }
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
  $id: "https://aixray.local/schema/ai-result.schema.json",
  title: "AIxRay AI result",
  description: "Output of one AI task (extract, opportunities, future-state, summary or log-mapping), schema version 1. " +
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
    baselineModelId: { anyOf: [id, { type: "null" }], description: "The current-state model a future-state change set applies to, or the model a log mapping maps activities to." },
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
        { $ref: "#/$defs/opportunities" }, { $ref: "#/$defs/futureState" }, { $ref: "#/$defs/summary" }, { $ref: "#/$defs/logMapping" }
      ]
    }
  },
  $defs: {
    id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$" },
    opportunities: T.opportunities,
    futureState: T["future-state"],
    summary: T.summary,
    logMapping: T["log-mapping"]
  }
};
const resultOut = path.join(root, "webui", "schema", "ai-result.schema.json");
fs.writeFileSync(resultOut, JSON.stringify(resultDoc, null, 2) + "\n");
console.log("Wrote " + path.relative(root, resultOut));

const responseDoc = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://aixray.local/schema/review-response.schema.json",
  title: "AIxRay review response",
  description: "A client reviewer's answers to a review pack, schema version 1. The app imports it with Open; " +
    "validateReviewResponse in webui/js/lib/validate.js enforces this contract and refuses a response made for another engagement.",
  type: "object",
  required: ["schema", "schemaVersion", "packId", "engagementId", "entries"],
  additionalProperties: false,
  properties: {
    schema: { const: schema.REVIEW_RESPONSE_ID },
    schemaVersion: { const: 1 },
    packId: id,
    engagementId: id,
    engagementRevision: { type: ["integer", "null"], minimum: 0 },
    format: en("reviewFormat"),
    reviewer: { type: "object", additionalProperties: false, properties: { name: text(200), role: text(200), organization: text(200) } },
    submittedAt: text(40),
    generalComment: text(4000),
    entries: {
      type: "array", maxItems: L.reviewEntries,
      items: {
        type: "object", required: ["itemRef"], additionalProperties: false,
        properties: { itemRef, verdict: { enum: [""].concat(E.reviewVerdict), description: "Empty when the reviewer gave no verdict." }, comment: text(4000) }
      }
    }
  },
  $defs: { id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$" } }
};
const responseOut = path.join(root, "webui", "schema", "review-response.schema.json");
fs.writeFileSync(responseOut, JSON.stringify(responseDoc, null, 2) + "\n");
console.log("Wrote " + path.relative(root, responseOut));
