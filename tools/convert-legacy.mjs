#!/usr/bin/env node
/*
 * Converts a legacy AIxRay configuration to an engagement JSON file.
 *
 *   node tools/convert-legacy.mjs <folder-or-process.js> [--out file.engagement.json]
 *        [--exclude-optional] [--batch] [--business-day <minutes>] [--client "Name"]
 *
 * Accepts the original explorer (a folder with branding.js, process.js and
 * samples.js) and both race explorer formats (a process.js that sets
 * window.PROCESS).
 *
 *   --exclude-optional  Mark steps flagged opt:true as Not in scenario. Use it when the
 *                       source documents those steps as off the representative route.
 *   --batch             The cases show a batch where several decision outcomes run
 *                       together (as in the cash-matching sample).
 *   --business-day N    Timings are business minutes with N minutes per day.
 *
 * Legacy configurations are JavaScript. This tool runs them in Node, so only
 * convert files you trust. The browser app never runs them.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const legacy = require("./lib/legacy.cjs");
const { validateEngagement } = require("../webui/js/lib/validate.js");
const util = require("../webui/js/lib/util.js");

const args = process.argv.slice(2);
const value = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const target = args.find((a, i) => !a.startsWith("--") && !["--out", "--business-day", "--client"].includes(args[i - 1]));
if (!target) {
  console.error("Usage: node tools/convert-legacy.mjs <folder-or-process.js> [--out file] [--exclude-optional] [--batch] [--business-day N] [--client \"Name\"]");
  process.exit(2);
}

const perDay = Number(value("--business-day"));
const config = {
  id: util.uid("eng"),
  excludeOptional: args.includes("--exclude-optional"),
  gatewayConsumption: args.includes("--batch") ? "per-edge" : undefined,
  timeBasis: perDay > 0 ? { unit: "minute", calendar: "business", businessMinutesPerDay: perDay } : undefined,
  clientDisplayName: value("--client")
};

let engagement;
try {
  engagement = legacy.convertPath(path.resolve(target), config);
} catch (err) {
  console.error("Conversion failed: " + err.message);
  process.exit(1);
}
engagement.meta.dataStatus = "supplied";
const result = validateEngagement(engagement);
if (!result.ok) {
  console.error("The converted engagement does not validate:");
  result.errors.forEach(e => console.error("  " + e.path + ": " + e.message));
  process.exit(1);
}
const out = value("--out") || path.join(process.cwd(), util.slug(result.engagement.meta.processName, 60) + ".engagement.json");
fs.writeFileSync(out, JSON.stringify(result.engagement, null, 2) + "\n");
console.log("Wrote " + out);
console.log(result.engagement.models.map(m => "  " + m.name + ": " + m.nodes.length + " steps, " + m.lanes.length + " lanes").join("\n"));
console.log("  " + result.engagement.scenarios.length + " scenarios");
const notes = (result.engagement.migration.warnings || []).concat(result.warnings);
if (notes.length) {
  console.log("Review before use:");
  notes.forEach(w => console.log("  - " + w.message));
}
