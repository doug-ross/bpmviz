/*
 * Runs one AI task end to end: checks the sign-in and the data-handling
 * rules, prepares the job folder, runs the chosen tool, checks the draft and
 * repairs it (at most twice, each time in a fresh session with only the
 * draft and the problems), then returns a result file for review.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { PROVIDERS, AiFailure, failureMessage } from "./providers.mjs";
import { createJob } from "./workspace.mjs";
import { systemPrompt, userPrompt, repairPrompt, root } from "./prompt.mjs";

const require = createRequire(import.meta.url);
const ai = require(path.join(root, "webui", "js", "lib", "ai-results.js"));

export const MAX_REPAIRS = 2;
export const TASKS = ["extract", "opportunities", "future-state", "summary", "log-mapping"];
const SECRET_ADVICE = {
  extract: "Remove credentials from the sources", opportunities: "Remove credentials from the engagement",
  "future-state": "Remove credentials from the engagement", summary: "Remove credentials from the engagement",
  "log-mapping": "Check the activity names and the model steps"
};
const TIMEOUT_MS = { extract: 20 * 60000, opportunities: 8 * 60000, "future-state": 10 * 60000, summary: 6 * 60000, "log-mapping": 6 * 60000 };

/*
 * Task options passed through to the task input. Log mapping takes
 * { modelId, activities: [{ name, events }] }: the model to map to and the
 * activity names from the log (events only order the names; they are not sent).
 */
export function cleanTaskOptions(task, raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  if (task !== "log-mapping") return {};
  const seen = new Set();
  const activities = [];
  (Array.isArray(o.activities) ? o.activities : []).slice(0, 5000).forEach(a => {
    const name = String(a && typeof a === "object" ? a.name : a == null ? "" : a).replace(/\s+/g, " ").trim().slice(0, 300);
    if (!name || seen.has(name)) return;
    seen.add(name);
    const events = a && typeof a === "object" && Number.isFinite(a.events) && a.events >= 0 ? Math.floor(a.events) : 0;
    activities.push({ name, events });
  });
  return { modelId: typeof o.modelId === "string" ? o.modelId.slice(0, 80) : undefined, activities };
}

/** The plan to hold the job to: what the tool reports, or else what the person declared. */
export function effectivePlan(status, declared) {
  if (status && status.planDetected) return status.plan;
  return ["commercial", "consumer"].includes(declared) ? declared : "unknown";
}

/** The data-handling facts for a job, and whether the gate lets it run. */
export function gateFor(o, status) {
  const e = o.engagement || null;
  const dataHandling = {
    confidentiality: e ? e.meta.confidentiality : (o.confidentiality || "client-confidential"),
    dataStatus: e ? e.meta.dataStatus : (o.dataStatus || "supplied"),
    approvalConfirmed: o.approvalConfirmed === true,
    trainingOptOutConfirmed: o.trainingOptOutConfirmed === true,
    writtenApproval: o.writtenApproval || "",
    sensitiveIncluded: o.includeSensitive === true
  };
  const plan = effectivePlan(status, o.plan);
  return { plan, dataHandling, gate: ai.dataHandlingGate(Object.assign({ plan }, dataHandling)) };
}

function readDraftFile(job) {
  const file = path.join(job.outDir, "engagement.json");
  if (!fs.existsSync(file)) return { draft: null, problem: "The engagement was not written to out/engagement.json." };
  try {
    return { draft: JSON.parse(fs.readFileSync(file, "utf8")), problem: "" };
  } catch (err) {
    return { draft: null, problem: "out/engagement.json is not valid JSON: " + String(err.message).slice(0, 200) };
  }
}

/**
 * options: { task, provider, engagement, sources: [{ name, buffer }], plan, approvalConfirmed,
 *   trainingOptOutConfirmed, writtenApproval, includeSensitive, baselineModelId, model, surface,
 *   confidentiality, dataStatus, processName, clientDisplayName, engagementName, useApiKey,
 *   keep, signal, onEvent, status, timeoutMs, taskOptions (log mapping: { modelId, activities }) }
 * Resolves { ok, result, errors, warnings, review, rounds, jobId, jobDir, plan }.
 * Throws AiFailure when the job cannot run or the tool fails.
 */
export async function runTask(o) {
  const provider = PROVIDERS[o.provider];
  if (!provider) throw new AiFailure("input.provider", "Unknown AI tool \"" + o.provider + "\". Use claude or codex.");
  const task = o.task;
  if (!TASKS.includes(task)) throw new AiFailure("input.task", "Unknown task \"" + task + "\".");
  const emit = ev => { if (o.onEvent) o.onEvent(ev); };
  const e = o.engagement || null;
  if (task !== "extract" && !e) throw new AiFailure("input.missing", "This task reads an engagement. Give the engagement file with --in.");
  const taskOptions = cleanTaskOptions(task, o.taskOptions);
  if (task === "log-mapping") {
    if (!taskOptions.activities.length) throw new AiFailure("input.missing", "Give the activity names to map, with --activities.");
    const model = e.models.find(m => m.id === taskOptions.modelId) || (taskOptions.modelId ? null : e.models.find(m => m.role === "current"));
    if (!model) throw new AiFailure("input.baseline", "The model " + (taskOptions.modelId || "to map to") + " is not in the engagement.");
    taskOptions.modelId = model.id;
  }

  emit({ type: "stage", stage: "status", message: "Checking " + provider.name + " and its sign-in" });
  const status = o.status || await provider.status(o);
  if (!status.installed) throw new AiFailure("provider.notInstalled", failureMessage(o.provider, "provider.notInstalled"));
  if (!status.loggedIn) throw new AiFailure("auth.signedOut", failureMessage(o.provider, "auth.signedOut"));
  if (status.apiKey && !o.useApiKey) throw new AiFailure("auth.apiKey", failureMessage(o.provider, "auth.apiKey"));

  const { plan, dataHandling, gate } = gateFor(o, status);
  if (!gate.allowed) {
    const err = new AiFailure(gate.blocked ? "gate.blocked" : "gate.missing", gate.message);
    err.gate = gate;
    throw err;
  }

  const job = createJob(o.jobId);
  const keepJob = !!o.keep;
  emit({ type: "job", jobId: job.id, dir: job.dir });
  try {
    const warnings = [];
    for (const src of o.sources || []) {
      emit({ type: "stage", stage: "sources", message: "Reading " + src.name });
      let info;
      try {
        info = await job.addSource(src.name, src.buffer);
      } catch (err) {
        throw new AiFailure("input.source", src.name + ": " + err.message);
      }
      if (info.warning) warnings.push({ code: "source.unreadable", path: info.name, message: info.name + ": " + info.warning });
    }
    if (task === "extract" && !job.sources.length) throw new AiFailure("input.missing", "Give at least one source document to extract from.");

    const input = e ? ai.buildTaskInput(e, task, Object.assign({ includeSensitive: o.includeSensitive, baselineModelId: o.baselineModelId }, taskOptions)) : null;
    const baselineModelId = task === "future-state" || task === "log-mapping" ? input.baselineModelId : null;
    const reviewContext = task === "log-mapping" ? { activities: input.activities } : undefined;
    if (task === "future-state" && !baselineModelId) throw new AiFailure("input.baseline", "The engagement has no current-state model to start from.");
    if (input && input.excluded.activities) {
      warnings.push({ code: "input.activities", path: "activities", message: "Only the " + input.activities.length + " most frequent activity names were sent; " + input.excluded.activities + " were not." });
    }
    if (input && input.excluded.secretActivities) {
      const n = input.excluded.secretActivities;
      warnings.push({ code: "input.secret", path: "activities", message: n + " activity name" + (n === 1 ? " that looks" : "s that look") + " like a credential " + (n === 1 ? "was" : "were") + " not sent. Map " + (n === 1 ? "it" : "them") + " by hand in the event-log import." });
    }
    if (input && input.excluded.sensitiveRecords) {
      warnings.push({ code: "input.sensitive", path: "records", message: input.excluded.sensitiveRecords + " sensitive records were not sent." });
    }

    job.write("system.md", systemPrompt(task, o.provider));
    const details = task === "extract" ? {
      "Confidentiality": dataHandling.confidentiality, "Data status": dataHandling.dataStatus,
      "Process name": o.processName, "Client display name": o.clientDisplayName, "Engagement name": o.engagementName
    } : null;
    const msg = userPrompt({ task, provider: o.provider, jobId: job.id, details, input, sources: job.sources });
    msg.warnings.forEach(w => warnings.push(w));
    const fileTools = task === "extract" && o.provider === "claude";
    const outputSchema = task === "extract" && o.provider === "codex" ? null : ai.outputSchema(task);
    const base = {
      task, schema: outputSchema, fileTools, model: o.model, useApiKey: o.useApiKey, includeHookEvents: !!o.includeHookEvents,
      timeoutMs: o.timeoutMs || TIMEOUT_MS[task], images: msg.images.map(f => path.join(job.dir, f))
    };

    const sources = job.sources.map(s => ({ name: s.name, kind: s.kind, sha256: s.sha256, pages: s.pages }));
    let prompt = msg.text;
    let round = 0;
    let last = null;
    for (;;) {
      emit({ type: "stage", stage: round ? "repair" : "run", round,
        message: round ? "Asking " + provider.name + " to fix " + last.problems.length + " problem" + (last.problems.length === 1 ? "" : "s") + " (round " + round + " of " + MAX_REPAIRS + ")" :
          "Running " + provider.name + " (" + (status.planLabel || plan) + ")" });
      const ctrl = new AbortController();
      const relay = () => ctrl.abort();
      if (o.signal) { if (o.signal.aborted) ctrl.abort(); else o.signal.addEventListener("abort", relay); }
      let run;
      try {
        run = await provider.run(job, Object.assign({}, base, { prompt }), { signal: ctrl.signal, abort: () => ctrl.abort(), onEvent: emit });
      } finally {
        if (o.signal) o.signal.removeEventListener("abort", relay);
      }

      emit({ type: "stage", stage: "check", message: "Checking the draft" });
      const output = run.output && typeof run.output === "object" ? run.output : {};
      const problems = [];
      let payload = null;
      if (task === "extract" && o.provider === "claude") {
        const d = readDraftFile(job);
        if (d.problem) problems.push({ path: "out/engagement.json", message: d.problem });
        payload = { engagement: d.draft };
      } else if (task === "extract") {
        payload = { engagement: output.engagement || null };
        if (!output.engagement) problems.push({ path: "engagement", message: "The reply did not contain an engagement object." });
      } else {
        payload = output.payload;
        if (!payload) problems.push({ path: "payload", message: "The reply did not contain a payload." });
      }
      const runWarnings = warnings.concat(Array.isArray(output.warnings) ? output.warnings : [],
        run.denials.map(d => ({ code: "provider.denied", path: "", message: "The AI tried to use " + d + " and was refused." })));
      const envelope = ai.makeEnvelope({
        task, engagementId: e ? e.id : null, engagementRevision: e ? e.revision : null, baselineModelId,
        generated: { tool: "bpmviz-ai", provider: o.provider, model: run.model || o.model || "", surface: o.surface || "cli",
          at: new Date().toISOString(), jobId: job.id, plan },
        dataHandling, sources, notes: typeof output.notes === "string" ? output.notes : "", warnings: runWarnings, payload
      });
      const validation = problems.length ? null : ai.validateAiResult(envelope);
      let review = null;
      if (validation) {
        const secret = validation.errors.find(x => x.code === "output.secret");
        if (secret) throw new AiFailure("output.secret", "The draft contained what looks like a credential (" + secret.path + "), so it was not kept. " + SECRET_ADVICE[task] + " and run the task again.");
        validation.errors.forEach(x => problems.push(x));
        if (validation.ok && e) {
          review = ai.prepareReview(validation.result, e, reviewContext);
          review.errors.forEach(x => problems.push(x));
          review.items.filter(it => it.problems.length).forEach(it => problems.push({ path: "item " + (it.index + 1), message: it.title + ": " + it.problems.join(" ") }));
        }
      }
      last = { problems, validation, review, output, payload };
      const hardFailure = !validation || !validation.ok;
      if (!problems.length || round >= MAX_REPAIRS) break;
      round++;
      prompt = repairPrompt({
        task, provider: o.provider, jobId: job.id, round, problems, nonce: msg.nonce,
        fileDraft: task === "extract" && o.provider === "claude" && payload.engagement ? "out/engagement.json" : null,
        draft: task === "extract" ? payload.engagement : { payload, notes: output.notes || "", warnings: output.warnings || [] },
        input: hardFailure || task !== "extract" ? input : null
      });
    }

    const v = last.validation;
    if (!v || !v.ok) {
      return { ok: false, result: null, errors: last.problems, warnings: [], review: null, rounds: round, jobId: job.id, jobDir: keepJob ? job.dir : null, plan };
    }
    const result = Object.assign({}, v.result);
    return {
      ok: true, result, errors: [], warnings: v.warnings.concat(last.review ? last.review.warnings : []),
      review: last.review, rounds: round, jobId: job.id, jobDir: keepJob ? job.dir : null, plan,
      unresolved: last.problems
    };
  } finally {
    if (!keepJob) job.cleanup();
  }
}
