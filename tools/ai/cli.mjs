#!/usr/bin/env node
/*
 * BPMVIZ AI tasks on your own Claude Code or Codex sign-in.
 *   npm run ai -- status
 *   npm run ai -- extract notes.docx diagram.png --process-name "Claims intake"
 *   npm run ai -- opportunities --in claims.engagement.json --yes
 *   npm run ai -- future-state --in claims.engagement.json --yes
 *   npm run ai -- summary --in claims.engagement.json --yes
 *   npm run ai -- check claims.opportunities.ai-result.json --in claims.engagement.json
 * Run with --help for every option. See docs/ai.md.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PROVIDERS, AiFailure } from "./providers.mjs";
import { runTask, gateFor } from "./runner.mjs";
import { extractSource } from "./extract-text.mjs";
import { root } from "./prompt.mjs";

const require = createRequire(import.meta.url);
const lib = name => require(path.join(root, "webui", "js", "lib", name + ".js"));
const ai = lib("ai-results");
const validate = lib("validate");
const storeLib = lib("store");
const exporting = lib("exporting");
const schema = lib("schema");

const HELP = `BPMVIZ AI tasks, run on your own Claude Code or Codex sign-in.

Usage: npm run ai -- <command> [options]

Commands
  status                          Is Claude Code or Codex installed and signed in, and on which plan
  extract <files...>              Draft a current-state engagement from PDF, DOCX, PPTX, images, notes or BPMN
  opportunities --in <file>       Suggest pain points, opportunities and open questions
  future-state --in <file>        Draft a future state as changes to the current state
  summary --in <file>             Draft the executive summary for the handoff
  check <result> [--in <file>]    Check an AI result file, and what it would change in the engagement
  gate [--in <file>]              Say whether this engagement may go to this AI account, and what to confirm
  text <file>                     Print the text BPMVIZ reads from a document
  input <task> --in <file>        Print what a task sends to the AI tool
  wrap <task> --payload <file>    Turn an agent skill's output into a checked result file

Options
  --with claude|codex             AI tool to use (default: claude)
  --out <file>                    Result file (default: <name>.<task>.ai-result.json in this folder)
  --plan commercial|consumer      Your plan, when the tool does not report it (Codex always needs this)
  --yes                           Confirm the engagement lead approved sending this material to this account
  --training-off                  Confirm model training is off for this account (needed on consumer plans)
  --written-approval "<text>"     Written client approval for restricted material: who approved, and when
  --include-sensitive             Also send records marked sensitive
  --baseline <model id>           Current-state model a future state starts from (default: the first)
  --confidentiality <level>       extract: internal, client-confidential (default), restricted or public
  --data-status <status>          extract: supplied (default) or demonstration
  --process-name <text>           extract: process name
  --client <text>                 extract: client display name
  --engagement-name <text>        extract: engagement name
  --model <name>                  Model to ask the tool for
  --apply                         Also write a copy of the engagement with every item applied, marked as unreviewed AI drafts
  --keep                          Keep the job folder for inspection
  --use-api-key                   Allow an API key sign-in instead of a subscription (billed to the key)
  --surface cli|skill|app         How the task was started (wrap sets skill)
  --remove-payload                wrap: delete the payload file once the result is written
  --json                          Print progress and the outcome as JSON lines

Plans
  Commercial: Claude Team or Enterprise, ChatGPT Business or Enterprise. Consumer: Claude Pro or Max, ChatGPT Plus or Pro.
  Client confidential and restricted material never goes to a consumer plan. See docs/ai.md.
`;

const FLAGS = new Set(["yes", "training-off", "include-sensitive", "apply", "keep", "use-api-key", "json", "help", "remove-payload"]);

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h") { out.help = true; continue; }
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const eq = a.indexOf("=");
    const key = a.slice(2, eq > 0 ? eq : undefined);
    if (FLAGS.has(key)) { out[key] = true; continue; }
    const value = eq > 0 ? a.slice(eq + 1) : argv[++i];
    if (value === undefined) throw new Error("--" + key + " needs a value.");
    out[key] = value;
  }
  return out;
}

class UsageError extends Error {}

function readEngagement(file) {
  if (!file) throw new UsageError("Give the engagement file with --in.");
  const v = validate.parseEngagementText(fs.readFileSync(file, "utf8"));
  if (!v.ok) throw new UsageError(file + " is not a valid engagement:\n" + v.errors.slice(0, 10).map(x => "  " + (x.path ? x.path + ": " : "") + x.message).join("\n"));
  return v.engagement;
}

function baseName(file, fallback) {
  if (!file) return fallback;
  return path.basename(file).replace(/\.engagement\.json$|\.json$/i, "").replace(/\.[^.]+$/, "") || fallback;
}

function say(opts, text) {
  if (!opts.json) process.stderr.write(text + "\n");
}

function emitJson(opts, obj) {
  if (opts.json) process.stdout.write(JSON.stringify(obj) + "\n");
}

function describeReview(review, result) {
  const lines = [];
  if (result.task === "extract") {
    const e = result.payload.engagement;
    lines.push("  " + e.models.map(m => m.name + ": " + m.nodes.length + " steps in " + m.lanes.length + " swimlanes").join("; "));
    lines.push("  " + e.records.length + " records, " + e.evidence.length + " sources, " + e.scenarios.length + " scenarios");
    return lines;
  }
  const items = review ? review.items : [];
  const blocked = items.filter(it => it.problems.length).length;
  const noun = { opportunities: "suggestion", "future-state": "change", summary: "summary" }[result.task];
  lines.push("  " + items.length + " " + noun + (items.length === 1 ? "" : "s") + (blocked ? ", " + blocked + " cannot be applied" : ""));
  items.slice(0, 20).forEach(it => lines.push("   - " + it.title + (it.problems.length ? "  [cannot be applied: " + it.problems.join(" ") + "]" : "")));
  if (items.length > 20) lines.push("   ... and " + (items.length - 20) + " more");
  return lines;
}

function printWarnings(opts, warnings) {
  const shown = warnings.filter(w => w.level !== "info" && w.code !== "fields.ignored");
  if (!shown.length) return;
  say(opts, "Check before you apply:");
  shown.slice(0, 15).forEach(w => say(opts, "  - " + w.message));
  if (shown.length > 15) say(opts, "  ... and " + (shown.length - 15) + " more");
}

/* Applies every item that can be applied and writes a new engagement file next to the input. */
function applyAll(result, review, engagement, inFile) {
  const s = storeLib.createStore(engagement);
  const cmd = ai.applyCommand(result, review, review.items.map(it => it.key));
  if (!cmd) return null;
  s.dispatch(cmd.type, cmd.payload);
  const out = path.join(path.dirname(inFile), baseName(inFile, "engagement") + ".with-ai.engagement.json");
  fs.writeFileSync(out, exporting.engagementToJson(s.get()));
  return out;
}

async function cmdStatus(opts) {
  const which = opts.with ? [opts.with] : ["claude", "codex"];
  const rows = [];
  for (const id of which) {
    const p = PROVIDERS[id];
    if (!p) throw new UsageError("Unknown AI tool " + id + ".");
    const st = await p.status(opts);
    rows.push(st);
    if (!st.installed) { say(opts, p.name + ": not installed."); continue; }
    say(opts, p.name + " " + st.version + ": " + (st.loggedIn ? "signed in" + (st.org ? " to " + st.org : "") + ", " + st.planLabel + "." : "not signed in.") +
      (st.apiKey ? " Uses an API key; BPMVIZ needs --use-api-key for that." : "") +
      (st.loggedIn && !st.planDetected ? " Give your plan with --plan commercial or --plan consumer." : ""));
  }
  emitJson(opts, { type: "status", providers: rows });
}

async function cmdGate(opts) {
  const provider = opts.with || "claude";
  const p = PROVIDERS[provider];
  if (!p) throw new UsageError("Unknown AI tool " + provider + ".");
  const status = await p.status(opts);
  const engagement = opts.in ? readEngagement(opts.in) : null;
  const g = gateFor({
    engagement, plan: opts.plan, confidentiality: opts.confidentiality, dataStatus: opts["data-status"],
    approvalConfirmed: !!opts.yes, trainingOptOutConfirmed: !!opts["training-off"], writtenApproval: opts["written-approval"],
    includeSensitive: !!opts["include-sensitive"]
  }, status);
  say(opts, g.gate.message);
  g.gate.missing.forEach(k => say(opts, "  Needed: " + ai.GATE_TEXT[k] + " (" + { plan: "--plan", approval: "--yes", writtenApproval: "--written-approval", trainingOff: "--training-off" }[k] + ")"));
  say(opts, g.gate.allowed ? "Allowed." : g.gate.blocked ? "Not allowed." : "Not allowed until the items above are confirmed.");
  emitJson(opts, { type: "gate", plan: g.plan, dataHandling: g.dataHandling, gate: g.gate, status });
  return g.gate.allowed ? 0 : 3;
}

async function cmdText(opts) {
  const file = opts._[1];
  if (!file) throw new UsageError("Give a file: npm run ai -- text <file>");
  const r = await extractSource(fs.readFileSync(file), path.basename(file));
  if (r.text === null) { say(opts, path.basename(file) + " is an image; it is sent to the AI tool as an image."); return; }
  process.stdout.write(r.text + "\n");
  if (r.warning) say(opts, r.warning);
}

function cmdInput(opts) {
  const task = opts._[1];
  if (!["opportunities", "future-state", "summary"].includes(task)) throw new UsageError("Give a task: opportunities, future-state or summary.");
  const e = readEngagement(opts.in);
  process.stdout.write(JSON.stringify(ai.buildTaskInput(e, task, { includeSensitive: !!opts["include-sensitive"], baselineModelId: opts.baseline }), null, 1) + "\n");
}

function checkAndReport(opts, result, validation, engagement) {
  if (!validation.ok) {
    say(opts, "The result has " + validation.errors.length + " problem" + (validation.errors.length === 1 ? "" : "s") + ":");
    validation.errors.slice(0, 30).forEach(x => say(opts, "  - " + (x.path ? x.path + ": " : "") + x.message));
    emitJson(opts, { type: "check", ok: false, errors: validation.errors });
    return 1;
  }
  let review = null;
  if (engagement || result.task === "extract") {
    review = ai.prepareReview(validation.result, engagement);
    if (review.errors.length) {
      review.errors.forEach(x => say(opts, "  - " + x.message));
      emitJson(opts, { type: "check", ok: false, errors: review.errors });
      return 1;
    }
    describeReview(review, validation.result).forEach(l => say(opts, l));
  }
  printWarnings(opts, validation.warnings.concat(validation.result.warnings, review ? review.warnings : []));
  say(opts, "The result is valid." + (engagement || result.task === "extract" ? "" : " Add --in <engagement> to check it against the engagement."));
  emitJson(opts, { type: "check", ok: true, warnings: validation.warnings, review });
  return 0;
}

function cmdCheck(opts) {
  const file = opts._[1];
  if (!file) throw new UsageError("Give a result file: npm run ai -- check <file>");
  const v = ai.parseAiResultText(fs.readFileSync(file, "utf8"));
  const engagement = opts.in ? readEngagement(opts.in) : null;
  return checkAndReport(opts, v.result, v, engagement);
}

/* Agent skills write a payload; wrap adds the envelope, checks it and writes the result file. */
async function cmdWrap(opts) {
  const task = opts._[1];
  if (!schema.ENUMS.aiTask.includes(task)) throw new UsageError("Give a task: extract, opportunities, future-state or summary.");
  if (!opts.payload) throw new UsageError("Give the skill's output with --payload <file>.");
  let raw;
  try { raw = JSON.parse(fs.readFileSync(opts.payload, "utf8")); } catch (err) { throw new UsageError(opts.payload + " is not valid JSON: " + err.message); }
  const engagement = task === "extract" ? null : readEngagement(opts.in);
  const provider = opts.with || "claude";
  const status = PROVIDERS[provider] ? await PROVIDERS[provider].status(opts) : null;
  const g = gateFor({ engagement, plan: opts.plan, confidentiality: opts.confidentiality, dataStatus: opts["data-status"],
    approvalConfirmed: !!opts.yes, trainingOptOutConfirmed: !!opts["training-off"], writtenApproval: opts["written-approval"],
    includeSensitive: !!opts["include-sensitive"] }, status);
  if (!g.gate.allowed) say(opts, "Warning: this material did not pass the data-handling check for this account: " + g.gate.message + " Run npm run ai -- gate before a skill reads any source.");
  let payload, notes = "", warnings = [];
  if (task === "extract") {
    payload = { engagement: raw.engagement || raw };
    if (raw.engagement) { notes = raw.notes || ""; warnings = raw.warnings || []; }
  } else {
    payload = raw.payload || raw;
    if (raw.payload) { notes = raw.notes || ""; warnings = raw.warnings || []; }
  }
  const baselineModelId = task === "future-state" ? (opts.baseline || (engagement.models.find(m => m.role === "current") || {}).id) : null;
  const envelope = ai.makeEnvelope({
    task, engagementId: engagement ? engagement.id : null, engagementRevision: engagement ? engagement.revision : null, baselineModelId,
    generated: { tool: "bpmviz-ai wrap", provider: PROVIDERS[provider] ? provider : "other", model: opts.model || "", surface: opts.surface || "skill",
      at: new Date().toISOString(), jobId: "", plan: g.plan },
    dataHandling: g.dataHandling, sources: [], notes, warnings, payload
  });
  const v = ai.validateAiResult(envelope);
  const code = checkAndReport(opts, v.result, v, engagement);
  if (code) return code;
  const out = opts.out || baseName(opts.in || (opts.payload), task) + "." + task + ".ai-result.json";
  fs.writeFileSync(out, JSON.stringify(v.result, null, 2) + "\n");
  if (opts["remove-payload"]) fs.rmSync(opts.payload, { force: true });
  say(opts, "Wrote " + out + ". Open it in BPMVIZ with Open to review and apply.");
  emitJson(opts, { type: "written", file: out });
  return 0;
}

async function cmdTask(opts) {
  const task = opts._[0];
  const provider = opts.with || "claude";
  const engagement = task === "extract" ? null : readEngagement(opts.in);
  const files = task === "extract" ? opts._.slice(1) : [];
  if (task === "extract" && !files.length) throw new UsageError("Give the source files: npm run ai -- extract <files...>");
  const sources = files.map(f => {
    if (!fs.existsSync(f) || !fs.statSync(f).isFile()) throw new UsageError("Source not found: " + f);
    return { name: path.basename(f), buffer: fs.readFileSync(f) };
  });
  const controller = new AbortController();
  const onSignal = () => { say(opts, "\nCancelling..."); controller.abort(); };
  process.once("SIGINT", onSignal);
  let r;
  try {
    r = await runTask({
      task, provider, engagement, sources, plan: opts.plan, approvalConfirmed: !!opts.yes, trainingOptOutConfirmed: !!opts["training-off"],
      writtenApproval: opts["written-approval"], includeSensitive: !!opts["include-sensitive"], baselineModelId: opts.baseline,
      model: opts.model, surface: opts.surface || "cli", confidentiality: opts.confidentiality, dataStatus: opts["data-status"],
      processName: opts["process-name"], clientDisplayName: opts.client, engagementName: opts["engagement-name"],
      useApiKey: !!opts["use-api-key"], keep: !!opts.keep, signal: controller.signal,
      onEvent: ev => {
        emitJson(opts, ev);
        if (ev.type === "stage") say(opts, ev.message + "...");
        else if (ev.type === "tool") say(opts, "  " + ev.tool + (ev.target ? " " + ev.target : ""));
      }
    });
  } finally {
    process.removeListener("SIGINT", onSignal);
  }
  if (!r.ok) {
    say(opts, "The draft still has problems after " + r.rounds + " repair round" + (r.rounds === 1 ? "" : "s") + ", so no result file was written:");
    r.errors.slice(0, 20).forEach(x => say(opts, "  - " + (x.path ? x.path + ": " : "") + x.message));
    if (r.jobDir) say(opts, "The job folder was kept at " + r.jobDir);
    emitJson(opts, { type: "failed", code: "output.invalid", errors: r.errors });
    return 1;
  }
  const out = opts.out || baseName(opts.in || files[0], task) + "." + task + ".ai-result.json";
  fs.writeFileSync(out, JSON.stringify(r.result, null, 2) + "\n");
  say(opts, "Wrote " + out + (r.rounds ? " after " + r.rounds + " repair round" + (r.rounds === 1 ? "" : "s") : "") + ".");
  describeReview(r.review, r.result).forEach(l => say(opts, l));
  printWarnings(opts, r.warnings.concat(r.result.warnings));
  if (r.jobDir) say(opts, "The job folder was kept at " + r.jobDir);
  let applied = null;
  if (opts.apply && task !== "extract" && r.review) {
    applied = applyAll(r.result, r.review, engagement, opts.in);
    if (applied) say(opts, "Wrote " + applied + " with every item applied as an unreviewed AI draft.");
  }
  say(opts, task === "extract" ?
    "Open the result in BPMVIZ with Open, check it, then open it as a new engagement and save it." :
    "Open the result in BPMVIZ with Open (with the engagement open), tick the items you want and apply them.");
  emitJson(opts, { type: "written", file: out, applied, result: opts.json ? r.result : undefined });
  return 0;
}

export async function main(argv) {
  let opts;
  try { opts = parseArgs(argv); } catch (err) { process.stderr.write(err.message + "\n"); return 2; }
  const cmd = opts._[0];
  if (!cmd || opts.help) { process.stdout.write(HELP); return cmd ? 0 : 2; }
  try {
    if (cmd === "status") { await cmdStatus(opts); return 0; }
    if (cmd === "gate") return await cmdGate(opts);
    if (cmd === "text") { await cmdText(opts); return 0; }
    if (cmd === "input") { cmdInput(opts); return 0; }
    if (cmd === "check") return cmdCheck(opts);
    if (cmd === "wrap") return await cmdWrap(opts);
    if (["extract", "opportunities", "future-state", "summary"].includes(cmd)) return await cmdTask(opts);
    process.stderr.write("Unknown command " + cmd + ".\n\n" + HELP);
    return 2;
  } catch (err) {
    if (err instanceof UsageError) { process.stderr.write(err.message + "\n"); return 2; }
    if (err instanceof AiFailure) {
      say(opts, err.message);
      if (err.gate) err.gate.missing.forEach(k => say(opts, "  Needed: " + ai.GATE_TEXT[k] + " (" + { plan: "--plan", approval: "--yes", writtenApproval: "--written-approval", trainingOff: "--training-off" }[k] + ")"));
      emitJson(opts, { type: "failed", code: err.code, message: err.message, gate: err.gate || null });
      return err.code.startsWith("gate.") ? 3 : 1;
    }
    throw err;
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) main(process.argv.slice(2)).then(code => { process.exitCode = code; });
