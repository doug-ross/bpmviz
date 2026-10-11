#!/usr/bin/env node
/*
 * Validates AIxRay engagement files, and AI result files, with the same
 * checks the app runs on Open.
 *
 *   node tools/validate-engagement.mjs file.engagement.json [more files] [--json] [--quiet]
 *
 * Exits 1 when any file has errors. Warnings are listed but do not fail the run.
 * Use it on generator output before opening the file in a workshop.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseEngagementText } = require("../webui/js/lib/validate.js");
const economics = require("../webui/js/lib/economics.js");
const aiResults = require("../webui/js/lib/ai-results.js");

const args = process.argv.slice(2);
const json = args.includes("--json");
const quiet = args.includes("--quiet");
const files = args.filter(a => !a.startsWith("--"));

if (!files.length) {
  console.error("Usage: node tools/validate-engagement.mjs <file.engagement.json> [...] [--json] [--quiet]");
  process.exit(2);
}

let failed = false;
const report = files.map(file => {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    failed = true;
    return { file, ok: false, errors: [{ path: "", message: "Cannot read the file: " + err.message }], warnings: [] };
  }
  let data = null;
  try { data = JSON.parse(text); } catch (_) { /* reported below */ }
  if (aiResults.isAiResult(data)) {
    const v = aiResults.validateAiResult(data);
    if (!v.ok) failed = true;
    const p = v.result && v.result.payload;
    const count = !p ? "" : p.suggestions ? p.suggestions.length + " suggestions" : p.operations ? p.operations.length + " changes" :
      p.engagement ? p.engagement.models.map(m => m.nodes.length + " steps").join(" + ") : "1 summary";
    return { file, ok: v.ok, errors: v.errors, warnings: v.warnings.concat(v.result ? v.result.warnings : []),
      summary: v.result ? { aiResult: true, process: "AI result (" + v.result.task + ", " + v.result.generated.provider + ")", models: [count], scenarios: 0, records: 0 } : null };
  }
  const r = parseEngagementText(text);
  if (!r.ok) failed = true;
  const summary = r.engagement ? {
    process: r.engagement.meta.processName,
    models: r.engagement.models.map(m => m.name + " (" + m.nodes.length + " steps, " + m.lanes.length + " lanes)"),
    scenarios: r.engagement.scenarios.length,
    records: r.engagement.records.length,
    reconciliation: r.engagement.scenarios.map(s => s.name + ": " + economics.reconcileScenario(r.engagement, s).status)
  } : null;
  return { file, ok: r.ok, errors: r.errors, warnings: r.warnings, summary };
});

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  report.forEach(r => {
    console.log((r.ok ? "PASS " : "FAIL ") + path.basename(r.file));
    if (r.summary && !quiet) {
      console.log("  " + r.summary.process + ": " + r.summary.models.join("; ") + (r.summary.aiResult ? "" : "; " + r.summary.scenarios + " scenarios, " + r.summary.records + " records"));
    }
    r.errors.forEach(e => console.log("  error    " + (e.path || "(file)") + ": " + e.message));
    if (!quiet) r.warnings.forEach(w => console.log("  " + (w.level === "info" ? "info     " : "warning  ") + (w.path || "(file)") + ": " + w.message));
  });
}
process.exit(failed ? 1 : 0);
