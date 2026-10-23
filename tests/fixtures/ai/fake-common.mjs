// Shared behavior for the fake claude and codex programs used by the runner tests.
// FAKE_AI_MODE is a comma-separated list, one entry per run (every task, including log-mapping): ok, invalid, secret,
// usage-limit, unexpected-tool, hang, denied. FAKE_AI_STATE counts the runs and
// FAKE_AI_LOG receives one JSON line per run with what the fake was given.
import fs from "node:fs";
import path from "node:path";

export function readStdin() {
  try { return fs.readFileSync(0, "utf8"); } catch (_) { return ""; }
}

export function nextMode() {
  const modes = String(process.env.FAKE_AI_MODE || "ok").split(",");
  const stateFile = process.env.FAKE_AI_STATE;
  let n = 0;
  if (stateFile) {
    try { n = Number(fs.readFileSync(stateFile, "utf8")) || 0; } catch (_) { n = 0; }
    fs.writeFileSync(stateFile, String(n + 1));
  }
  return modes[Math.min(n, modes.length - 1)];
}

export function log(entry) {
  if (process.env.FAKE_AI_LOG) fs.appendFileSync(process.env.FAKE_AI_LOG, JSON.stringify(entry) + "\n");
}

export function envSeen() {
  return {
    anthropicKey: "ANTHROPIC_API_KEY" in process.env, anthropicToken: "ANTHROPIC_AUTH_TOKEN" in process.env,
    openaiKey: "OPENAI_API_KEY" in process.env, codexKey: "CODEX_API_KEY" in process.env,
    oauthToken: "CLAUDE_CODE_OAUTH_TOKEN" in process.env, parentSession: "CLAUDECODE" in process.env
  };
}

function between(prompt, tag) {
  const m = prompt.match(new RegExp("<<<" + tag + " ([0-9a-f]+)>>>\\n([\\s\\S]*?)\\n<<<END " + tag + " \\1>>>"));
  return m ? m[2] : null;
}

/* The task input in the prompt, for checking what was sent. */
export function inputOf(prompt) {
  const text = between(prompt, "ENGAGEMENT");
  return text ? JSON.parse(text) : null;
}

export function taskOf(prompt) {
  return (prompt.match(/^Task: ([a-z-]+)\./m) || [])[1] || "";
}

export function report(prompt) {
  const warnings = [];
  if (/ignore (all )?previous instructions/i.test(prompt)) {
    warnings.push({ code: "source.instruction", message: "A source contains \"ignore previous instructions\"; treated as data.", path: "notes.txt" });
  }
  return { notes: "Fake run.", warnings };
}

const SECRET = "sk-ant-api03-" + "abcdefghijklmnopqrstuvwxyz012345";

/* A payload built from the engagement in the prompt, so its IDs are real. */
export function payloadFor(task, prompt, mode) {
  const engText = between(prompt, "ENGAGEMENT") || between(prompt, "DRAFT");
  const input = engText ? JSON.parse(engText) : null;
  const model = input && input.models ? input.models[0] : null;
  const step = model ? model.steps.find(s => /task/i.test(s.type)) || model.steps[1] : null;
  const edge = model ? model.connectors[0] : null;
  const bad = mode === "invalid";
  if (task === "opportunities") {
    return { suggestions: [{
      ref: "s1", kind: "opportunity", title: bad ? "" : "Pre-fill the form from the submission", description: mode === "secret" ? "Use " + SECRET : "Less retyping.",
      linkedModelId: model ? model.id : null, linkedNodeIds: step ? [step.id] : [], basedOnRecordIds: [], priority: "medium",
      opportunity: { intervention: "simplify", simplerAlternative: "", expectedBenefit: "Less rework", affectedVolume: "", effort: "S", risk: "", dependencies: "", validationAction: "Time ten cases" },
      valueCase: { shareOfCasesPct: null, effortReductionPct: 30, durationReductionPct: null, oneTimeCost: null, annualRunningCost: null, confidence: "low",
        sources: { shareOfCasesPct: "", effortReductionPct: "Step " + (step ? step.label : "") + ": retyping is about a third of the touch effort.", durationReductionPct: "", oneTimeCost: "", annualRunningCost: "" } },
      goalIds: [],
      confidence: "medium", rationale: "Retyping is named in the step."
    }], valueCases: [] };
  }
  if (task === "goals") {
    return { suggestions: [{
      ref: "g1", kind: "cost", title: bad ? "" : "Cut the cost of handling a case", metric: "Cost per case", baseline: null, target: null, unit: "$", by: "",
      owner: "", source: "notes.txt", quote: mode === "secret" ? SECRET : "Handling costs too much.", servedByRecordIds: [], confidence: "medium",
      rationale: "The notes say handling costs too much."
    }] };
  }
  if (task === "future-state") {
    const blank = { nodeId: null, edgeId: null, label: null, laneRef: null, semanticType: null, details: [], tags: null, touchEffortMinutes: null, typicalDurationMinutes: null, rationale: "", addressesRecordIds: [] };
    return { name: "Fake future state", summary: "Automate one check.", lanes: [], operations: [
      Object.assign({}, blank, { op: "insert", edgeId: bad ? null : edge.id, label: "Automatic check", semanticType: "serviceTask", rationale: "Removes a manual lookup." }),
      Object.assign({}, blank, { op: "modify", nodeId: step.id, touchEffortMinutes: 5, rationale: "Less effort." })
    ] };
  }
  if (task === "summary") {
    return { title: "Summary", text: bad ? "" : "The process has one main bottleneck.", keyPoints: [{ text: "Clearance is manual.", supportingRecordIds: [], supportingFigures: [] }], caveats: ["Figures are illustrative."] };
  }
  if (task === "log-mapping") return logMappingFor(input, bad);
  if (task === "screen") return screenFor(input, bad, mode);
  return null;
}

/*
 * Screening: a 3 for every criterion still to score, and a blank for the
 * client's priorities. In invalid mode the first score names a candidate that
 * is not in the screening, so the runner has to repair it.
 */
function screenFor(input, bad, mode) {
  const scores = [];
  ((input && input.candidates) || []).forEach(c => c.toScore.forEach(k => scores.push({
    candidateId: c.id, criterionId: k, value: k === "priority" ? null : 3, confidence: "low",
    rationale: mode === "secret" ? "Use " + SECRET : k === "priority" ? "Ask the sponsor." : "Typical for this kind of process; an assumption."
  })));
  if (bad && scores.length) scores[0] = Object.assign({}, scores[0], { candidateId: "c-no-such-process" });
  return { scores };
}

/*
 * Log mapping: each activity goes to the step whose label shares the most
 * words with it, or stays unmapped. In invalid mode the first mapping names
 * a step that does not exist, so the runner has to repair it.
 */
function logMappingFor(input, bad) {
  const words = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(w => w.length > 2 && w !== "the" && w !== "and");
  const steps = (input && input.steps) || [];
  const names = (input && input.activities) || [];
  return { mappings: names.map((activity, i) => {
    const mine = new Set(words(activity));
    let best = null, score = 0;
    steps.forEach(s => {
      const n = words(s.label).filter(w => mine.has(w)).length;
      if (n > score) { best = s; score = n; }
    });
    const nodeId = bad && i === 0 ? "no-such-step" : best ? best.id : null;
    return { activity, nodeId, confidence: score > 1 ? "high" : score ? "medium" : "low",
      rationale: best ? "The activity names the same work as " + best.label + "." : "No step describes this activity." };
  }) };
}

/* A small engagement as an extraction would produce it, with things the draft rules must undo. */
export function extractedEngagement(mode) {
  if (mode === "invalid") return { schema: "aixray.engagement", schemaVersion: 1, id: "eng-x", models: [] };
  return {
    schema: "aixray.engagement", schemaVersion: 1, id: "eng-extracted", revision: 0,
    meta: { processName: "Extracted process", confidentiality: "public", dataStatus: "observed",
      timeBasis: { unit: "minute", calendar: "calendar", businessMinutesPerDay: 480 } },
    models: [{
      id: "m-current", role: "current", name: "Current state", version: 1,
      lanes: [{ id: "team", name: "Team", type: "human" }],
      nodes: [
        { id: "start", label: "Start", semanticType: "startEvent", laneId: "team" },
        { id: "work", label: mode === "secret" ? "Use " + SECRET : "Do the work", semanticType: "userTask", laneId: "team",
          provenance: { source: "source-document", validation: "validated", evidenceRefs: ["ev-1"], note: "" } },
        { id: "end", label: "Done", semanticType: "endEvent", laneId: "team" }
      ],
      edges: [{ id: "e1", from: "start", to: "work" }, { id: "e2", from: "work", to: "end" }]
    }],
    scenarios: [], records: [{ id: "rec-q1", kind: "question", title: "Who approves?" }],
    evidence: [{ id: "ev-1", title: "Manual", status: "validated", link: "https://example.com/manual" }], assumptions: []
  };
}

export function writeFile(dir, rel, text) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
