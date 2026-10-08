/*
 * Trusted adapters for the legacy BPMVIZ configuration formats.
 *
 *   explorer-v1  branding.js + process.js + samples.js (LANES, NODES, FLOWS, SUBMISSIONS)
 *   racer        window.PROCESS with before/after models and scaled cases (v1 and v2)
 *
 * Legacy files are JavaScript. They are loaded here, in Node, from files you
 * trust, and converted to engagement JSON. The browser app never runs them.
 * Every judgment the conversion makes is recorded in engagement.migration.warnings.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const lib = path.join(__dirname, "..", "..", "webui", "js", "lib");
const util = require(path.join(lib, "util.js"));
const schema = require(path.join(lib, "schema.js"));
const replay = require(path.join(lib, "replay.js"));

/* ---------------- Loading ---------------- */

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

/** Runs the explorer-v1 scripts in one context and returns their globals. */
function loadExplorerV1(dir) {
  const context = vm.createContext({ console, Math, Object, Array, JSON });
  ["branding.js", "process.js", "samples.js"].forEach(name => {
    vm.runInContext(readText(path.join(dir, name)), context, { filename: name, timeout: 2000 });
  });
  return vm.runInContext("({ BRANDING, LANES, NODES, FLOWS, SUBMISSIONS })", context);
}

/** Runs a racer process.js and returns window.PROCESS. */
function loadRacer(file) {
  const win = {};
  const context = vm.createContext({ window: win, console, Math, Object, Array, JSON });
  vm.runInContext(readText(file), context, { filename: path.basename(file), timeout: 2000 });
  if (!win.PROCESS) throw new Error(file + " does not define window.PROCESS.");
  return JSON.parse(JSON.stringify(win.PROCESS));
}

/* ---------------- Text helpers ---------------- */

function makeTextCleaner(warnings, editorial) {
  let repaired = 0;
  const fn = function clean(value) {
    if (typeof value !== "string") return value;
    let text = util.repairMojibake(value);
    if (text !== value) repaired++;
    text = text.replace(/\\n|\n/g, " ").replace(/\s{2,}/g, " ").trim();
    return editorial ? editorial(text) : text;
  };
  fn.report = () => {
    if (repaired) warnings.push({ code: "text.encoding", message: "Repaired character encoding in " + repaired + " text values (for example \"\u00c2\u00b7\" back to \"\u00b7\").", path: "" });
  };
  return fn;
}

function cleanDeep(value, clean) {
  if (typeof value === "string") return clean(value);
  if (Array.isArray(value)) return value.map(v => cleanDeep(v, clean));
  if (value && typeof value === "object") {
    const out = {};
    Object.keys(value).forEach(k => { out[k] = cleanDeep(value[k], clean); });
    return out;
  }
  return value;
}

function sentenceCase(text) {
  if (!text || text !== text.toUpperCase()) return text;
  const lower = text.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function laneTypeFrom(value, name) {
  if (value === "agent") return "agent";
  if (value === "ext" || value === "external") return "external";
  if (!value && /\b(ai|agent|bot)\b/i.test(name || "")) return "agent";
  return "human";
}

/* ---------------- Measures ---------------- */

function measureFromRow(row, ids, timeBasis, warnings, scenarioName) {
  const [labelRaw, before, after, delta] = row;
  const label = String(labelRaw);
  const lower = label.toLowerCase();
  let key = util.slug(label.replace(/\(.*?\)/g, ""), 40);
  let unit = "count";
  let cleanLabel = label.replace(/\s*\((?:business days|days|hrs|hours)\)\s*/i, "").trim();
  if (/cycle\s*time/.test(lower)) {
    key = "cycleTime";
    if (/business days/.test(lower)) unit = "businessDay";
    else if (/days/.test(lower)) unit = "day";
    else unit = "minute";
  } else if (/human touch/.test(lower) && /hrs|hours/.test(lower)) {
    key = "humanTouch"; unit = "hour"; cleanLabel = "Human touch effort";
  } else if (/human touch/.test(lower)) {
    key = "humanTouches"; unit = "count";
  } else if (/cost/.test(lower)) {
    key = "costPerCase"; unit = "currency"; cleanLabel = "Cost per case";
  } else if (/throughput/.test(lower)) {
    unit = "perDay"; cleanLabel = cleanLabel.replace(/\s*\/\s*day/i, "");
  } else if (/\(days\)/.test(lower)) {
    unit = "day";
    warnings.push({ code: "unit.convention", message: scenarioName + ": \"" + label + "\" does not say whether days are business or calendar days; shown as days.", path: "" });
  } else if (/\(hrs\)|hours/.test(lower)) {
    unit = "hour";
  }
  if (typeof before === "string" && /%/.test(before)) unit = "percent";
  const values = {};
  const suppliedText = {};
  [[ids.before, before], [ids.after, after]].forEach(([id, v]) => {
    if (!id) return;
    values[id] = util.parseLooseNumber(v);
    if (typeof v === "string") suppliedText[id] = v;
  });
  return {
    key, label: cleanLabel, unit, values, suppliedText, status: "supplied",
    note: delta != null && delta !== "" ? "Change as supplied: " + String(delta).replace(/-/g, "\u2212") + "." : ""
  };
}

/* ---------------- explorer-v1 ---------------- */

const EXPLORER_TYPES = {
  start: "startEvent", end: "endEvent", endTerminate: "terminateEndEvent", eventMessage: "messageEvent",
  gatewayX: "exclusiveGateway", gatewayP: "parallelGateway",
  taskUser: "userTask", taskService: "serviceTask", taskScript: "scriptTask"
};

const EXPLORER_STATUS = {
  completed: ["Completed", "done"], "in-progress": ["In progress", "progress"], new: ["New", "new"],
  stuck: ["Stuck past SLA", "stuck"], disputed: ["Rework after UAT", "stuck"]
};

function fromExplorerV1(src, options) {
  const opts = options || {};
  const warnings = [];
  const clean = makeTextCleaner(warnings, opts.editorial);
  const e = schema.blankEngagement({
    id: opts.id || "eng-rpa-delivery",
    clientDisplayName: opts.clientDisplayName || "Automation Center of Excellence (sample)",
    engagementName: opts.engagementName || "Intelligent automation delivery",
    processName: opts.processName || "AI-assisted RPA delivery",
    dataStatus: "demonstration",
    timeBasis: { unit: "minute", calendar: "calendar", businessMinutesPerDay: 480 },
    summary: opts.summary || "",
    disclosure: "Demonstration data. Sample automation requests with illustrative durations; no live telemetry.",
    credits: "Sample from the original BPMVIZ explorer by Doug Ross (MIT License)."
  });
  e.createdAt = e.updatedAt = opts.timestamp || e.createdAt;
  const evidenceId = "ev-futurestate-bpmn";
  e.evidence.push({
    id: evidenceId, title: "futurestate.bpmn (AI-assisted RPA delivery)",
    locator: "Named in the original branding.js; the file is not in the repository.",
    extractedFact: "Lanes, steps and sequence flows of the sample process.", status: "unavailable",
    reviewer: "", reviewDate: "", link: null
  });

  const lanes = src.LANES.map(l => ({ id: l.id, name: clean(l.name), role: "", type: laneTypeFrom(null, l.name) }));
  const laneType = new Map(lanes.map(l => [l.id, l.type]));
  const model = {
    id: "m-current", role: "current", name: "Current state", version: 1, status: "baseline", locked: false,
    basedOn: null, sourceRefs: [evidenceId], notes: "", lanes, nodes: [], edges: [],
    presentation: { laneHeight: null, nodes: {} }
  };
  const colOf = new Map();
  src.NODES.forEach(n => {
    const semanticType = EXPLORER_TYPES[n.type] || "unsupported";
    if (semanticType === "unsupported") {
      warnings.push({ code: "semantic.unsupported", message: "Step \"" + clean(n.label) + "\" has type \"" + n.type + "\", which has no equivalent. It is shown as a generic step.", path: n.id });
    }
    const measures = { typicalDuration: null, slaTarget: null, touchEffort: null, waitType: "" };
    if (Number.isFinite(n.avg)) measures.typicalDuration = { value: n.avg, unit: "minute" };
    if (Number.isFinite(n.sla)) measures.slaTarget = { value: n.sla, unit: "minute" };
    model.nodes.push({
      id: n.id, label: clean(n.label), sub: "", semanticType, laneId: n.lane, sourceIds: [],
      details: n.desc ? { desc: clean(n.desc) } : {},
      tags: { bottleneck: false, agent: laneType.get(n.lane) === "agent" && semanticType !== "startEvent",
        humanReview: false, optional: false, sampled: false },
      measures,
      provenance: { source: "generated", validation: "unvalidated", evidenceRefs: [evidenceId],
        note: "Generated sample. Descriptions and durations were written for the demonstration." },
      lineage: null, removed: false
    });
    model.presentation.nodes[n.id] = { x: n.col };
    colOf.set(n.id, n.col);
  });
  const shared = new Map();
  src.NODES.forEach(n => {
    const k = n.lane + "|" + n.col;
    shared.set(k, (shared.get(k) || []).concat(clean(n.label)));
  });
  shared.forEach(list => {
    if (list.length > 1) warnings.push({ code: "layout.collision", message: list.join(", ") + " shared one grid position in the original layout. They now sit side by side.", path: "" });
  });
  const edgeIds = new Set();
  const typeOf = new Map(model.nodes.map(n => [n.id, n.semanticType]));
  const loops = cycleEdges(model.nodes.map(n => n.id), src.FLOWS, id => colOf.get(id));
  src.FLOWS.forEach((f, i) => {
    const back = colOf.get(f.to) < colOf.get(f.from);
    model.edges.push({
      id: util.uniqueId("e-" + f.from + "-" + f.to, edgeIds), from: f.from, to: f.to, label: clean(f.label || ""),
      semanticType: loops.has(i) ? "loop" : (typeOf.get(f.from) === "exclusiveGateway" ? "conditional" : "sequence"),
      dashed: back, emphasis: "", removed: false, lineage: null
    });
  });
  e.models.push(model);

  src.SUBMISSIONS.forEach(sub => {
    const nameParts = clean(sub.name).split(/\s+\u00b7\s+/);
    const [statusLabel, tone] = EXPLORER_STATUS[sub.status] || [sentenceCase(sub.status), ""];
    const visits = sub.path.map((p, i) => ({ id: "v" + (i + 1), nodeId: p.nodeId, start: p.t, end: p.t + p.dur }));
    const visited = new Set(visits.map(v => v.nodeId));
    const membership = {};
    model.nodes.forEach(n => { membership[n.id] = visited.has(n.id) ? "included" : "excluded"; });
    const total = visits.reduce((m, v) => Math.max(m, v.end), 0);
    e.scenarios.push({
      id: "sc-" + sub.id, name: nameParts[0], statusLabel, statusTone: tone, provenance: "illustrative",
      summary: clean(sub.summary),
      attributes: [
        { label: "Business area", value: clean(sub.client) },
        { label: "Scope", value: clean(sub.engagement) },
        { label: "Volume", value: clean(sub.fees) },
        { label: "Delivery lead", value: clean(sub.partner) },
        { label: "Location", value: clean(sub.office) },
        { label: "Situation", value: nameParts.slice(1).join(", ") }
      ].filter(a => a.value),
      timing: { method: "explicit-visits", note: "Sample path with illustrative durations in calendar minutes. The path lists the branch taken at each decision." },
      runs: {
        "m-current": {
          visits, transitions: replay.deriveTransitions(model, visits), membership,
          pauseAt: Math.min(sub.pauseAt, total), milestones: {}
        }
      },
      measures: [], economics: null
    });
  });
  warnings.push({ code: "membership.path", message: "Each sample path lists only the branch taken at each decision. Steps a sample never visits are marked Not in scenario.", path: "" });
  clean.report();
  e.migration = {
    sourceFormat: "explorer-v1 (branding.js, process.js, samples.js)",
    sourceFiles: opts.sourceFiles || [], convertedAt: e.createdAt, warnings
  };
  return e;
}

/* ---------------- racer (v1 and v2) ---------------- */

/*
 * Connectors that go back in the flow (rework, renegotiation). Drawing
 * direction alone does not decide it: the legacy layouts draw some forward
 * connectors right to left, and a forward path can sit inside a larger loop.
 * So the loops are a small set of connectors that, once taken out, leave no
 * cycle. Each round picks, among the connectors still on a cycle, the one
 * drawn furthest backward, until the flow has no cycle left.
 */
function cycleEdges(nodeIds, flows, columnOf) {
  const known = new Set(nodeIds);
  const active = new Set(flows.map((_, i) => i).filter(i => known.has(flows[i].from) && known.has(flows[i].to)));
  const loops = new Set();
  const reaches = (from, target) => {
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length) {
      const n = queue.shift();
      if (n === target) return true;
      active.forEach(i => { const fl = flows[i]; if (fl.from === n && !seen.has(fl.to)) { seen.add(fl.to); queue.push(fl.to); } });
    }
    return false;
  };
  const back = i => (columnOf(flows[i].from) || 0) - (columnOf(flows[i].to) || 0);
  for (;;) {
    const onCycle = [...active].filter(i => reaches(flows[i].to, flows[i].from));
    if (!onCycle.length) break;
    const pick = onCycle.reduce((a, b) => back(b) > back(a) ? b : a);
    loops.add(pick);
    active.delete(pick);
  }
  return loops;
}

function gatewayType(sub) {
  if (/parallel/i.test(sub || "")) return "parallelGateway";
  if (/exclusive/i.test(sub || "")) return "exclusiveGateway";
  return "gateway";
}

const RACER_TONE = { "t-done": "done", "t-prog": "progress", "t-stuck": "stuck", "t-new": "new" };

/**
 * config: {
 *   id, clientDisplayName, engagementName, processName, timeBasis,
 *   excludeOptional: true when the source documents optional steps as off-route,
 *   gatewayConsumption: "per-edge" when cases schedule several outcomes at once,
 *   assumptions: [{ key, value, status, source }], evidence: { title, locator, extractedFact },
 *   caseAttributes: { fund: label or "summary", amt: label }, sourceFiles, timestamp, editorial
 * }
 */
function fromRacer(P, config) {
  const cfg = config || {};
  const warnings = [];
  const clean = makeTextCleaner(warnings, cfg.editorial);
  const branding = P.branding || {};
  const layout = P.layout || {};
  const e = schema.blankEngagement({
    id: cfg.id,
    clientDisplayName: cfg.clientDisplayName || "",
    engagementName: cfg.engagementName || clean(branding.kicker || ""),
    processName: cfg.processName || clean(branding.title || "Process"),
    dataStatus: "demonstration",
    timeBasis: cfg.timeBasis || { unit: "minute", calendar: "calendar", businessMinutesPerDay: 480 },
    summary: clean(branding.helpText || ""),
    disclosure: cfg.disclosure || clean(branding.status || ""),
    credits: "Sample from the original BPMVIZ race explorer by Doug Ross (MIT License)."
  });
  e.createdAt = e.updatedAt = cfg.timestamp || e.createdAt;
  const evId = "ev-source-bpmn";
  if (cfg.evidence) {
    e.evidence.push(Object.assign({ id: evId, status: "unavailable", reviewer: "", reviewDate: "", link: null,
      locator: "", extractedFact: "" }, cfg.evidence));
  }

  const hasAfter = !!(P.after && Array.isArray(P.after.nodes) && P.after.nodes.length);
  const keys = hasAfter ? ["before", "after"] : ["before"];
  const modelId = { before: "m-current", after: "m-future" };
  const built = {};
  const colFromX = x => (x - 90) / 240;

  keys.forEach(which => {
    const raw = P[which];
    const catalog = Array.isArray(raw.lanes) ? raw.lanes : P.lanes;
    const used = new Set(raw.nodes.map(n => n.lane));
    const lanes = catalog.filter(l => Array.isArray(raw.lanes) || used.has(l.id))
      .map(l => ({ id: l.id, name: clean(l.name), role: clean(l.role || ""), type: laneTypeFrom(l.type, l.name) }));
    const isFuture = which === "after";
    const label = clean(isFuture ? (branding.afterLabel || "Future state") : (branding.beforeLabel || "Current state"));
    const model = {
      id: modelId[which], role: isFuture ? "future" : "current",
      name: isFuture ? "Proposed future state" : "Current state",
      version: 1, status: isFuture ? "proposed" : "baseline", locked: false, basedOn: null,
      sourceRefs: cfg.evidence && !isFuture ? [evId] : [], notes: label, lanes, nodes: [], edges: [],
      presentation: { laneHeight: null, nodes: {} }
    };
    const ids = new Set();
    const nodeIds = raw.nodes.map(n => util.uniqueId(util.slug(clean(n.label)), ids));
    raw.nodes.forEach((n, i) => {
      let semanticType = { start: "startEvent", end: "endEvent", task: "task" }[n.type];
      if (n.type === "gw") {
        semanticType = gatewayType(n.sub);
        if (semanticType === "gateway") {
          warnings.push({ code: "semantic.gateway", message: model.name + ": gateway \"" + clean(n.label) + "\" does not say whether it is exclusive or parallel. Replay treats it as exclusive.", path: nodeIds[i] });
        }
      }
      if (!semanticType) semanticType = "unsupported";
      const detail = n.detail && typeof n.detail === "object" ? cleanDeep(n.detail, clean) : {};
      const note = String(detail.note || "");
      const sourceIds = [];
      const re = /Maps to BPMN ([A-Za-z0-9_]+)/g;
      let m;
      while ((m = re.exec(note))) sourceIds.push(m[1]);
      const text = [detail.desc, note, n.sub].join(" ");
      const external = /external counterparty|external customer dependency|external reinsurance market|market wait|decision wait/i.test(text);
      model.nodes.push({
        id: nodeIds[i], label: clean(n.label), sub: clean(n.sub || ""), semanticType, laneId: n.lane, sourceIds,
        details: detail,
        tags: { bottleneck: !!n.bott, agent: !!n.agent, humanReview: !!n.exc, optional: !!n.opt, sampled: false },
        measures: { typicalDuration: null, slaTarget: null, touchEffort: null, waitType: external ? "external" : "" },
        provenance: isFuture ?
          { source: "generated", validation: "unvalidated", evidenceRefs: [], note: "Proposed future-state step. Not validated." } :
          { source: sourceIds.length ? "source-document" : "unknown", validation: "unvalidated",
            evidenceRefs: sourceIds.length && cfg.evidence ? [evId] : [],
            note: sourceIds.length ? "Structure from the source BPMN. Timings are estimates." : "" },
        lineage: null, removed: false
      });
      model.presentation.nodes[nodeIds[i]] = { x: colFromX(n.x) };
    });
    const edgeIds = new Set();
    const xOf = new Map(nodeIds.map((id, i) => [id, raw.nodes[i].x]));
    const loops = cycleEdges(nodeIds, raw.edges.map(([f, t]) => ({ from: nodeIds[f], to: nodeIds[t] })), id => xOf.get(id));
    raw.edges.forEach(([f, t, lbl, opt], i) => {
      const o = opt || {};
      const from = nodeIds[f], to = nodeIds[t];
      const back = raw.nodes[t].x < raw.nodes[f].x;
      model.edges.push({
        id: util.uniqueId("e-" + from + "-" + to, edgeIds), from, to, label: clean(lbl || ""),
        semanticType: loops.has(i) ? "loop" : /qa|sample/i.test(lbl || "") && o.dashed ? "sample" : o.dashed || lbl ? "conditional" : "sequence",
        dashed: !!o.dashed || back, emphasis: o.early ? "early" : "", removed: false, lineage: null
      });
    });
    if (raw.nodes.some(n => n.role)) {
      warnings.push({ code: "field.role", message: model.name + ": step badges such as \"AI\" and \"HITL\" are now derived from the step tags.", path: "" });
    }
    built[which] = { raw, model, nodeIds };
    e.models.push(model);
  });

  // Route membership, decided once per model.
  keys.forEach(which => {
    const { raw, model, nodeIds } = built[which];
    const finalEnd = Math.max(...raw.nodes.map(n => Number.isFinite(n.be) ? n.be : n.e));
    const membership = {};
    const excluded = [], unknown = [];
    raw.nodes.forEach((n, i) => {
      const id = nodeIds[i];
      const zero = (n.be ?? n.e) === (n.bs ?? n.s);
      if (cfg.excludeOptional && n.opt) { membership[id] = "excluded"; excluded.push(clean(n.label)); return; }
      if (n.type === "end" && zero && (n.be ?? n.e) < finalEnd) { membership[id] = "unknown"; unknown.push(clean(n.label)); return; }
      membership[id] = "included";
    });
    built[which].membership = membership;
    if (excluded.length) {
      warnings.push({ code: "membership.documented", message: model.name + ": " + excluded.length + " off-route steps are marked Not in scenario, as the source documents (" + excluded.join(", ") + ").", path: "" });
    }
    unknown.forEach(name => warnings.push({ code: "membership.unconfirmed", message: model.name + ": \"" + name + "\" is an end event outside the scheduled route and is not marked optional. Its membership is Not confirmed until someone reviews it.", path: "" }));
    if (cfg.gatewayConsumption === "per-edge") {
      model.nodes.filter(n => schema.typeInfo(n.semanticType).shape === "gateway").forEach(g => {
        const outs = model.edges.filter(ed => ed.from === g.id && membership[ed.to] === "included");
        const scheduled = outs.filter(ed => {
          const idx = nodeIds.indexOf(ed.to), tn = raw.nodes[idx];
          return (tn.be ?? tn.e) > (tn.bs ?? tn.s);
        });
        if (scheduled.length > 1) {
          warnings.push({ code: "membership.population", message: model.name + ": every case schedules " + scheduled.length + " outcomes of \"" + g.label + "\". The source shows a batch of items, so all scheduled branches appear in the scenario.", path: g.id });
        }
      });
    }
  });

  // Milestones.
  const ms = P.milestones;
  const msIds = [];
  if (ms && Array.isArray(ms.names)) {
    const taken = new Set();
    ms.names.forEach((name, i) => {
      const id = util.uniqueId("ms-" + util.slug(clean(name)), taken);
      msIds.push(id);
      e.milestones.push({ id, name: clean(name), position: Array.isArray(ms.x) ? ms.x[i] : (i + 1) / ms.names.length });
    });
  }

  // Assumptions.
  (cfg.assumptions || []).forEach(a => {
    const def = schema.DRIVERS.find(d => d.key === a.key);
    e.assumptions.push({ id: "as-" + util.slug(a.key), key: a.key, label: def ? def.label : a.key, value: a.value,
      unit: def ? def.unit : "count", status: a.status || "illustrative", source: a.source || "", note: a.note || "" });
  });
  if (!e.assumptions.length && hasAfter) {
    warnings.push({ code: "economics.drivers", message: "The source declares no economic assumptions, so supplied cost and capacity figures cannot be reconciled.", path: "" });
  }

  // Scenarios.
  const bases = { before: layout.BASE_B, after: layout.BASE_A };
  const caseAttrs = cfg.caseAttributes || { fund: "summary", amt: "Size" };
  (P.cases || []).forEach(c => {
    const name = clean(c.title || "Case " + c.id);
    const runs = {};
    keys.forEach(which => {
      const { raw, model, nodeIds, membership } = built[which];
      const base = Number.isFinite(bases[which]) && bases[which] > 0 ? bases[which] :
        Math.max(1, ...raw.nodes.map(n => n.be ?? n.e));
      const total = which === "before" ? c.b : c.a;
      const f = total / base;
      const visits = [];
      raw.nodes.forEach((n, i) => {
        const id = nodeIds[i];
        if (membership[id] !== "included") return;
        visits.push({ id: "v-" + id, nodeId: id, start: (n.bs ?? n.s) * f, end: (n.be ?? n.e) * f });
      });
      const milestones = {};
      if (ms && msIds.length) {
        const times = which === "before" ? ms.baseB : ms.baseA;
        msIds.forEach((id, i) => { if (Array.isArray(times) && Number.isFinite(times[i])) milestones[id] = times[i] * f; });
      }
      runs[model.id] = {
        visits,
        transitions: replay.deriveTransitions(model, visits, { gatewayConsumption: cfg.gatewayConsumption }),
        membership, pauseAt: null, milestones
      };
    });
    const ids = { before: "m-current", after: hasAfter ? "m-future" : null };
    const measures = (Array.isArray(c.mt) ? c.mt : []).filter(Array.isArray)
      .map(row => measureFromRow(row.map(v => typeof v === "string" ? clean(v) : v), ids, e.meta.timeBasis, warnings, name));
    const cost = measures.find(m => m.key === "costPerCase");
    const exec = c.exec || {};
    const attributes = [];
    let summary = "";
    if (caseAttrs.fund === "summary") summary = clean(c.fund || "");
    else if (c.fund) attributes.push({ label: caseAttrs.fund, value: clean(c.fund) });
    if (c.amt) attributes.push({ label: caseAttrs.amt, value: clean(c.amt) });
    e.scenarios.push({
      id: "case-" + util.slug(String(c.id)), name, statusLabel: sentenceCase(clean(c.status || "")),
      statusTone: RACER_TONE[c.tag] || "", provenance: "illustrative", summary, attributes,
      timing: {
        method: cfg.gatewayConsumption === "per-edge" ? "population-illustration" : "proportional-scale",
        note: "Timings scale one representative route to this case's total; the route itself does not change between cases."
      },
      runs, measures,
      economics: hasAfter ? {
        beforeModelId: "m-current", afterModelId: "m-future",
        supplied: {
          beforeCostPerCase: cost ? cost.values["m-current"] : null,
          afterCostPerCase: cost ? cost.values["m-future"] : null,
          costSavedPerCase: util.parseLooseNumber(clean(exec.cut || "")),
          fteCapacity: util.parseLooseNumber(clean(exec.fte || "")),
          text: { cycleSaved: clean(exec.save || ""), cycleSavedShare: clean(exec.saveS || ""),
            costSaved: clean(exec.cut || ""), fte: clean(exec.fte || "") }
        },
        overrides: {}
      } : null
    });
  });
  if ((P.cases || []).length > 1) {
    warnings.push({ code: "timing.scaled", message: "All " + P.cases.length + " cases scale the same representative route. Selecting a case changes timing, not routing.", path: "" });
  }
  clean.report();
  e.migration = {
    sourceFormat: "racer window.PROCESS (" + (Array.isArray(P.before.lanes) ? "independent lanes" : "shared lane catalog") + ")",
    sourceFiles: cfg.sourceFiles || [], convertedAt: e.createdAt, warnings
  };
  return e;
}

/** Detects the legacy format of a folder or file and converts it. */
function convertPath(target, config) {
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    const jsDir = fs.existsSync(path.join(target, "js", "process.js")) ? path.join(target, "js") : target;
    if (fs.existsSync(path.join(jsDir, "samples.js"))) {
      return fromExplorerV1(loadExplorerV1(jsDir), Object.assign({ sourceFiles: ["branding.js", "process.js", "samples.js"] }, config));
    }
    return fromRacer(loadRacer(path.join(jsDir, "process.js")), Object.assign({ sourceFiles: ["process.js"] }, config));
  }
  return fromRacer(loadRacer(target), Object.assign({ sourceFiles: [path.basename(target)] }, config));
}

module.exports = { loadExplorerV1, loadRacer, fromExplorerV1, fromRacer, convertPath, measureFromRow, cycleEdges };
