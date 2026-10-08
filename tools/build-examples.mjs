#!/usr/bin/env node
/*
 * Builds the bundled example engagements from the archived legacy samples.
 *
 *   node tools/build-examples.mjs
 *
 * Writes webui/examples/*.engagement.json and webui/examples/examples.js
 * (the same data wrapped for direct-file use, where the browser cannot fetch
 * local JSON). The build fails if an example does not validate or still
 * contains an em dash.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const legacy = require("./lib/legacy.cjs");
const { validateEngagement } = require("../webui/js/lib/validate.js");
const util = require("../webui/js/lib/util.js");

const TIMESTAMP = "2026-09-25T00:00:00.000Z";
const OUT = path.join(root, "webui", "examples");

/* Client-visible sample text is rewritten without em dashes. Specific
   phrasings first, then a plain comma for anything left. */
const REWRITES = [
  ["Physical dependency \u2014 cannot be automated away.", "Physical dependency that cannot be automated away."],
  ["External counterparty wait \u2014 persistent even after AI adoption.", "External counterparty wait that persists after AI adoption."],
  ["Terminal \u2014 declined by authority.", "Terminal: declined by authority."],
  ["Terminal \u2014 declined or expired.", "Terminal: declined or expired."],
  ["Deterministic rules govern the decision \u2014 LLM only explains", "Deterministic rules govern the decision; the LLM only explains it"],
  ["Engineer's decision \u2014 unchanged in After.", "Engineer's decision, unchanged in the future state."],
  ["Physical work \u2014 cannot automate", "Physical work that cannot be automated"],
  ["Engineer sign-off required \u2014 AI output is a draft only", "Engineer sign-off required; AI output is a draft only"],
  ["UW signs the quote \u2014 not the agent", "The underwriter signs the quote, not the agent"],
  ["(~3 business days illustrative \u2014 modest improvement from cleaner quote reducing follow-ups)", "(~3 business days, illustrative; a cleaner quote is assumed to reduce follow-ups)"],
  ["ILLUSTRATIVE \u2014 REPRESENTATIVE", "Illustrative, representative"],
  ["ILLUSTRATIVE \u2014 HIGH COMPLEXITY", "Illustrative, high complexity"],
  ["ILLUSTRATIVE \u2014 Structure from BPMN; timings, volumes, and costs are assumptions", "Illustrative. The structure comes from the source BPMN; timings, volumes and costs are assumptions."],
  ["Current State \u2014 Manual Underwriting Workflow (from BPMN)", "Current state: manual underwriting workflow (from the BPMN)"],
  ["Proposed State \u2014 AI-Augmented Underwriting Operating Model", "Proposed state: AI-augmented underwriting operating model"],
  ["Illustrative \u2014 ", "Illustrative: "],
  [" \u2014 $", ", $"]
];

function editorial(text) {
  let out = text;
  REWRITES.forEach(([from, to]) => { out = out.split(from).join(to); });
  return out.replace(/\s*\u2014\s*/g, ", ").replace(/\u2015/g, ", ");
}

function build(name, engagement, meta) {
  const result = validateEngagement(engagement);
  if (!result.ok) {
    console.error(name + " failed validation:");
    result.errors.forEach(e => console.error("  " + e.path + ": " + e.message));
    process.exit(1);
  }
  const json = JSON.stringify(result.engagement, null, 2) + "\n";
  if (/[\u2014\u2015]/.test(json)) {
    console.error(name + " still contains an em dash.");
    process.exit(1);
  }
  fs.writeFileSync(path.join(OUT, name + ".engagement.json"), json);
  console.log(name + ": " + result.engagement.models.map(m => m.nodes.length + " steps").join(" + ") +
    ", " + result.engagement.scenarios.length + " scenarios, " + result.warnings.length + " review items");
  return Object.assign({ id: name, file: name + ".engagement.json" }, meta, { engagement: result.engagement });
}

fs.mkdirSync(OUT, { recursive: true });
const examples = [];

// 1. Large commercial property underwriting (racer v2, current and proposed future state).
const v2 = legacy.loadRacer(path.join(root, "archive", "racer-v2-astra", "process.js"));
const underwritingConfig = {
  id: "eng-underwriting",
  clientDisplayName: "Commercial P&C insurer (illustrative)",
  engagementName: "Large commercial property underwriting",
  processName: "Large commercial property underwriting and issuance",
  timeBasis: { unit: "minute", calendar: "business", businessMinutesPerDay: 480 },
  excludeOptional: true,
  assumptions: [
    { key: "hourlyRate", value: 150, status: "illustrative", source: "Declared in the source process.js header" },
    { key: "annualVolume", value: 400, status: "illustrative", source: "Declared in the source process.js header" },
    { key: "productiveHoursPerFte", value: 1800, status: "illustrative", source: "Declared in the source process.js header" },
    { key: "incrementalCostPerCase", value: 400, status: "illustrative", source: "Declared in the source process.js header (LLM inference and tooling)" }
  ],
  evidence: {
    title: "large-commercial-property-sample-underwriting-master-gemflash.bpmn",
    locator: "Named in the source process.js header; the file is not in the repository.",
    extractedFact: "40 flow nodes across 7 lanes: node identity, lanes, sequence flows, gateway outcomes, parallel fork and join, the negotiate loop, the external facultative market dependency, authority referral and the subjectivities gate."
  },
  caseAttributes: { fund: "summary", amt: "Exposure" },
  sourceFiles: ["archive/racer-v2-astra/process.js"],
  timestamp: TIMESTAMP,
  editorial
};
examples.push(build("underwriting", legacy.fromRacer(v2, underwritingConfig), {
  title: "Commercial property underwriting",
  description: "Current state from a BPMN, a proposed AI-augmented future state, and five illustrative cases with economics to reconcile."
}));

// 2. The same process, current state only: the usual starting point for a workshop.
const v2CurrentOnly = JSON.parse(JSON.stringify(v2));
v2CurrentOnly.after = null;
v2CurrentOnly.cases.forEach(c => { delete c.a; delete c.exec; c.mt = (c.mt || []).map(r => [r[0], r[1], null, null]); });
const currentOnly = legacy.fromRacer(v2CurrentOnly, Object.assign({}, underwritingConfig, {
  id: "eng-underwriting-current",
  engagementName: "Underwriting current-state workshop",
  assumptions: underwritingConfig.assumptions.filter(a => a.key !== "incrementalCostPerCase")
}));
currentOnly.scenarios = currentOnly.scenarios.filter(s => s.id === "case-3");
currentOnly.scenarios.forEach(s => { s.measures = s.measures.filter(m => m.key !== "costPerCase"); });
examples.push(build("underwriting-current-state", currentOnly, {
  title: "Underwriting, current state only",
  description: "The same process before any redesign. Use it to rehearse capture, then clone the baseline into a future-state draft."
}));

// 3. Cash transaction matching (racer v1).
const v1 = legacy.loadRacer(path.join(root, "archive", "racer-v1", "process.js"));
examples.push(build("cash-matching", legacy.fromRacer(v1, {
  id: "eng-cash-matching",
  clientDisplayName: "Fund services operations (illustrative)",
  engagementName: "Cash transaction matching",
  processName: "End-to-end cash transaction matching",
  timeBasis: { unit: "minute", calendar: "calendar", businessMinutesPerDay: 480 },
  excludeOptional: false,
  gatewayConsumption: "per-edge",
  disclosure: "Illustrative. Current state from a transaction-matching BPMN; future state and all figures are illustrative.",
  evidence: {
    title: "E2E Transaction Matching current-state BPMN (GLOBB / CT Operations)",
    locator: "Named in the source process.js footer; the file is not in the repository.",
    extractedFact: "Current-state lanes, steps and sequence flows."
  },
  caseAttributes: { fund: "Fund", amt: "Amount" },
  sourceFiles: ["archive/racer-v1/process.js"],
  timestamp: TIMESTAMP,
  editorial
}), {
  title: "Cash transaction matching",
  description: "A batch process where several decision outcomes run together. Supplied figures have no declared assumptions, so they stay unreconciled."
}));

// 4. AI-assisted RPA delivery (explorer v1, explicit visits including rework).
const x1 = legacy.loadExplorerV1(path.join(root, "archive", "explorer-v1", "js"));
examples.push(build("rpa-delivery", legacy.fromExplorerV1(x1, {
  id: "eng-rpa-delivery",
  sourceFiles: ["archive/explorer-v1/js/branding.js", "archive/explorer-v1/js/process.js", "archive/explorer-v1/js/samples.js"],
  timestamp: TIMESTAMP,
  editorial,
  summary: "Automation requests move from intake through AI-assisted scoping, a parallel governance fan-out, build, QA and UAT. Samples include QA and UAT rework loops."
}), {
  title: "AI-assisted RPA delivery",
  description: "Five sample automation requests with explicit visit paths, including QA and UAT rework and SLA targets."
}));

const bundle = "/* Generated by tools/build-examples.mjs. Do not edit by hand. */\n" +
  "(function (root) {\n  \"use strict\";\n  const B = root.BPMVIZ = root.BPMVIZ || {};\n  B.bundledExamples = " +
  JSON.stringify(examples.map(e => ({ id: e.id, title: e.title, description: e.description, file: e.file, engagement: e.engagement }))) +
  ";\n})(typeof globalThis !== \"undefined\" ? globalThis : this);\n";
fs.writeFileSync(path.join(OUT, "examples.js"), bundle);
console.log("Wrote " + examples.length + " examples (" + util.formatNumber(bundle.length / 1024, 0) + " KB bundle).");
