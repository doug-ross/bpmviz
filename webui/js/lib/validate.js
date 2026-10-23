/*
 * AIxRay validate: checks an engagement in layers and returns a sanitized copy.
 *
 * Layers: parse and schema, identity, graph references, semantic support,
 * timing and replay membership, units, economic reconciliation, evidence.
 * Errors block loading. Warnings load but are listed for review.
 * Only known fields are copied; imported content is data and is never run.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./util.js"), require("./schema.js"), require("./units.js"),
      require("./economics.js"), require("./migrate.js"), require("./replay.js"), require("./workshop.js"),
      require("./goals.js"), require("./checkpoints.js"), require("./value-lines.js"), require("./investment.js"));
  } else {
    const B = root.AIxRay = root.AIxRay || {};
    B.validate = factory(B.util, B.schema, B.units, B.economics, B.migrate, B.replay, B.workshop, B.goals, B.checkpoints, B.valueLines, B.investment);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, schema, units, economics, migrate, replay, workshop, goals, checkpoints, valueLines, investment) {
  "use strict";

  const L = schema.LIMITS;
  const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

  function Checker() {
    this.errors = [];
    this.warnings = [];
    this.ignored = [];
  }
  Checker.prototype.error = function (path, message) { this.errors.push({ path, message }); };
  Checker.prototype.warn = function (path, message, code, level) {
    this.warnings.push({ path, message, code: code || "warning", level: level || "warning" });
  };

  function knownKeys(c, obj, path, allowed) {
    if (!util.isPlainObject(obj)) return;
    Object.keys(obj).forEach(k => {
      if (!allowed.includes(k)) c.ignored.push(path ? path + "." + k : k);
    });
  }

  function str(c, v, path, opts) {
    const o = opts || {};
    if (v === undefined || v === null) {
      if (o.required) c.error(path, "A value is required.");
      return o.fallback !== undefined ? o.fallback : "";
    }
    if (typeof v === "number" || typeof v === "boolean") v = String(v);
    if (typeof v !== "string") {
      c.error(path, "Expected text here.");
      return o.fallback !== undefined ? o.fallback : "";
    }
    const max = o.max || L.stringLength;
    if (v.length > max) {
      c.warn(path, "Text longer than " + max + " characters was shortened.", "text.truncated");
      v = v.slice(0, max);
    }
    if (o.required && !v.trim()) c.error(path, "A value is required.");
    return v;
  }

  function num(c, v, path, opts) {
    const o = opts || {};
    if (v === undefined || v === null || v === "") {
      if (o.required) c.error(path, "A number is required.");
      return o.fallback !== undefined ? o.fallback : null;
    }
    if (typeof v !== "number" || !Number.isFinite(v)) {
      c.error(path, "Expected a number.");
      return o.fallback !== undefined ? o.fallback : null;
    }
    if (o.min !== undefined && v < o.min) c.error(path, "Must be at least " + o.min + ".");
    if (o.max !== undefined && v > o.max) c.error(path, "Must be at most " + o.max + ".");
    if (o.integer && !Number.isInteger(v)) c.error(path, "Must be a whole number.");
    return v;
  }

  function bool(v) {
    return v === true;
  }

  function en(c, v, name, path, opts) {
    const o = opts || {};
    const allowed = schema.ENUMS[name];
    if (v === undefined || v === null || v === "") {
      if (o.required) c.error(path, "A value is required.");
      return o.fallback !== undefined ? o.fallback : allowed[0];
    }
    if (!allowed.includes(v)) {
      c.warn(path, "Unknown value \"" + String(v).slice(0, 60) + "\" was replaced with \"" +
        (o.fallback !== undefined ? o.fallback : allowed[0]) + "\".", "enum.unknown");
      return o.fallback !== undefined ? o.fallback : allowed[0];
    }
    return v;
  }

  function arr(c, v, path, max) {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) { c.error(path, "Expected a list here."); return []; }
    if (max && v.length > max) { c.error(path, "Too many entries: the most allowed is " + max + "."); return v.slice(0, max); }
    return v;
  }

  function obj(c, v, path, required) {
    if (v === undefined || v === null) {
      if (required) c.error(path, "This section is missing.");
      return {};
    }
    if (!util.isPlainObject(v)) { c.error(path, "This section is not in the expected format."); return {}; }
    return v;
  }

  function idOf(c, v, path, taken) {
    if (!util.isValidId(v)) {
      c.error(path, "Missing or invalid ID. Use 1 to 80 letters, digits, and . _ : - characters.");
      return typeof v === "string" ? v : "";
    }
    if (taken) {
      if (taken.has(v)) c.error(path, "Duplicate ID \"" + v + "\": each ID can be used only once.");
      taken.add(v);
    }
    return v;
  }

  function idList(c, v, path) {
    return arr(c, v, path, 1000).filter((x, i) => {
      if (util.isValidId(x)) return true;
      c.warn(path + "[" + i + "]", "A link that was not valid was left out.", "ref.invalid");
      return false;
    });
  }

  /* Free-form detail values: text, numbers, booleans, lists and nested objects. */
  function freeForm(c, v, path, depth) {
    if (typeof v === "string") return str(c, v, path);
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "boolean") return v;
    if (v === null || v === undefined) return null;
    if (depth >= L.detailDepth) { c.warn(path, "Detail nested too deeply was left out.", "detail.depth"); return null; }
    if (Array.isArray(v)) {
      return v.slice(0, 500).map((x, i) => freeForm(c, x, path + "[" + i + "]", depth + 1)).filter(x => x !== null);
    }
    if (util.isPlainObject(v)) {
      const out = {};
      Object.keys(v).slice(0, 200).forEach(k => {
        if (FORBIDDEN_KEYS.has(k) || k.length > 100) return;
        const val = freeForm(c, v[k], path + "." + k, depth + 1);
        if (val !== null) out[k] = val;
      });
      return out;
    }
    return null;
  }

  function measureValue(c, v, path) {
    if (v === undefined || v === null) return null;
    const m = obj(c, v, path);
    const value = num(c, m.value, path + ".value");
    const unit = str(c, m.unit, path + ".unit", { max: 40 }) || "minute";
    if (!units.isKnownUnit(unit)) c.warn(path + ".unit", "Unknown unit \"" + unit + "\".", "unit.unknown");
    return value === null ? null : { value, unit };
  }

  /* Marker on records and models drafted by an AI assistant. Absent when a person wrote the item. */
  function sanitizeGenerated(c, v, path) {
    if (v === undefined || v === null) return undefined;
    const g = obj(c, v, path);
    return {
      task: en(c, g.task, "aiTask", path + ".task"),
      provider: en(c, g.provider, "aiProvider", path + ".provider", { fallback: "other" }),
      model: str(c, g.model, path + ".model", { max: 120 }),
      surface: en(c, g.surface, "aiSurface", path + ".surface"),
      at: str(c, g.at, path + ".at", { max: 40 }),
      jobId: str(c, g.jobId, path + ".jobId", { max: 80 }),
      plan: en(c, g.plan, "aiPlan", path + ".plan"),
      reviewed: bool(g.reviewed),
      reviewedAt: str(c, g.reviewedAt, path + ".reviewedAt", { max: 40 })
    };
  }

  function sanitizeNarrative(c, raw, i, kinds) {
    const path = "narratives[" + i + "]";
    const n = obj(c, raw, path, true);
    knownKeys(c, n, path, ["id", "kind", "title", "text", "status", "generated", "createdAt", "updatedAt"]);
    const kind = en(c, n.kind, "narrativeKind", path + ".kind");
    if (kinds.has(kind)) c.error(path + ".kind", "There can be only one summary of each kind.");
    kinds.add(kind);
    const out = {
      id: idOf(c, n.id, path + ".id"),
      kind,
      title: str(c, n.title, path + ".title", { max: 300 }),
      text: str(c, n.text, path + ".text", { max: 12000 }),
      status: en(c, n.status, "narrativeStatus", path + ".status"),
      createdAt: str(c, n.createdAt, path + ".createdAt", { max: 40 }),
      updatedAt: str(c, n.updatedAt, path + ".updatedAt", { max: 40 })
    };
    const generated = sanitizeGenerated(c, n.generated, path + ".generated");
    if (generated) out.generated = generated;
    return out;
  }

  function sanitizeMeta(c, raw) {
    const m = obj(c, raw, "meta", true);
    knownKeys(c, m, "meta", ["clientDisplayName", "engagementName", "processName", "confidentiality",
      "dataStatus", "timeBasis", "currency", "disclosure", "summary", "credits"]);
    let tb = m.timeBasis;
    if (!util.isPlainObject(tb)) {
      c.warn("meta.timeBasis", "The file does not say how time is counted, so calendar time is used.", "time.basis");
      tb = {};
    }
    const unit = tb.unit === undefined ? "minute" : tb.unit;
    if (unit !== "minute") c.error("meta.timeBasis.unit", "Timings must be in minutes (\"minute\").");
    const currency = typeof m.currency === "string" && /^[A-Z]{3}$/.test(m.currency) ? m.currency : "USD";
    return {
      clientDisplayName: str(c, m.clientDisplayName, "meta.clientDisplayName", { max: 200 }),
      engagementName: str(c, m.engagementName, "meta.engagementName", { max: 200 }),
      processName: str(c, m.processName, "meta.processName", { max: 200 }) || "Untitled process",
      confidentiality: en(c, m.confidentiality, "confidentiality", "meta.confidentiality"),
      dataStatus: en(c, m.dataStatus, "dataStatus", "meta.dataStatus", { fallback: "supplied" }),
      timeBasis: {
        unit: "minute",
        calendar: en(c, tb.calendar, "timeCalendar", "meta.timeBasis.calendar"),
        businessMinutesPerDay: num(c, tb.businessMinutesPerDay, "meta.timeBasis.businessMinutesPerDay",
          { min: 1, max: 1440, fallback: 480 })
      },
      currency,
      disclosure: str(c, m.disclosure, "meta.disclosure", { max: 2000 }),
      summary: str(c, m.summary, "meta.summary", { max: 4000 }),
      credits: str(c, m.credits, "meta.credits", { max: 500 })
    };
  }

  function sanitizeModel(c, raw, i, modelIds) {
    const path = "models[" + i + "]";
    const m = obj(c, raw, path, true);
    knownKeys(c, m, path, ["id", "role", "name", "version", "status", "locked", "basedOn", "sourceRefs",
      "lanes", "nodes", "edges", "presentation", "notes", "generated"]);
    const model = {
      id: idOf(c, m.id, path + ".id", modelIds),
      role: en(c, m.role, "modelRole", path + ".role", { required: true }),
      name: str(c, m.name, path + ".name", { max: 200 }) || (m.role === "future" ? "Future state" : "Current state"),
      version: num(c, m.version, path + ".version", { min: 1, integer: true, fallback: 1 }),
      status: en(c, m.status, "modelStatus", path + ".status"),
      locked: bool(m.locked),
      basedOn: null,
      sourceRefs: idList(c, m.sourceRefs, path + ".sourceRefs"),
      notes: str(c, m.notes, path + ".notes", { max: 4000 }),
      lanes: [], nodes: [], edges: [], presentation: { laneHeight: null, nodes: {} }
    };
    if (m.basedOn !== undefined && m.basedOn !== null) {
      const b = obj(c, m.basedOn, path + ".basedOn");
      model.basedOn = {
        modelId: idOf(c, b.modelId, path + ".basedOn.modelId"),
        version: num(c, b.version, path + ".basedOn.version", { min: 1, integer: true, fallback: 1 })
      };
    }
    const laneIds = new Set();
    arr(c, m.lanes, path + ".lanes", L.lanesPerModel).forEach((l, j) => {
      const lp = path + ".lanes[" + j + "]";
      const lane = obj(c, l, lp, true);
      knownKeys(c, lane, lp, ["id", "name", "role", "type"]);
      model.lanes.push({
        id: idOf(c, lane.id, lp + ".id", laneIds),
        name: str(c, lane.name, lp + ".name", { max: 200 }) || String(lane.id || "Lane"),
        role: str(c, lane.role, lp + ".role", { max: 300 }),
        type: en(c, lane.type, "laneType", lp + ".type")
      });
    });
    if (!model.lanes.length) c.error(path + ".lanes", "A process needs at least one lane.");

    const nodeIds = new Set();
    const nodes = arr(c, m.nodes, path + ".nodes", L.nodesPerModel);
    if (!nodes.length) c.error(path + ".nodes", "A process needs at least one step.");
    nodes.forEach((n, j) => {
      const np = path + ".nodes[" + j + "]";
      const node = obj(c, n, np, true);
      knownKeys(c, node, np, ["id", "label", "sub", "semanticType", "laneId", "sourceIds", "details",
        "tags", "measures", "provenance", "lineage", "removed"]);
      const semanticType = typeof node.semanticType === "string" ? node.semanticType : "task";
      if (!schema.SEMANTIC_TYPES[semanticType]) {
        c.warn(np + ".semanticType", "Step type \"" + semanticType.slice(0, 60) +
          "\" is not supported. It is shown as a plain step, and playback does not interpret it.", "semantic.unsupported");
      } else if (!schema.SEMANTIC_TYPES[semanticType].replay) {
        c.warn(np + ".semanticType", schema.SEMANTIC_TYPES[semanticType].label +
          " is shown, but playback does not follow its rules.", "semantic.limited", "info");
      }
      const laneId = typeof node.laneId === "string" ? node.laneId : "";
      if (!laneIds.has(laneId)) c.error(np + ".laneId", "Unknown lane \"" + String(node.laneId).slice(0, 60) + "\".");
      const tags = obj(c, node.tags, np + ".tags");
      const meas = obj(c, node.measures, np + ".measures");
      const prov = obj(c, node.provenance, np + ".provenance");
      const clean = {
        id: idOf(c, node.id, np + ".id", nodeIds),
        label: str(c, node.label, np + ".label", { max: 300 }) || String(node.id || "Step"),
        sub: str(c, node.sub, np + ".sub", { max: 300 }),
        semanticType: schema.SEMANTIC_TYPES[semanticType] ? semanticType : "unsupported",
        sourceType: schema.SEMANTIC_TYPES[semanticType] ? undefined : semanticType.slice(0, 80),
        laneId,
        sourceIds: arr(c, node.sourceIds, np + ".sourceIds", 100).map((s, k) => str(c, s, np + ".sourceIds[" + k + "]", { max: 200 })).filter(Boolean),
        details: util.isPlainObject(node.details) ? freeForm(c, node.details, np + ".details", 0) : {},
        tags: {
          bottleneck: bool(tags.bottleneck), agent: bool(tags.agent), humanReview: bool(tags.humanReview),
          optional: bool(tags.optional), sampled: bool(tags.sampled)
        },
        measures: {
          typicalDuration: measureValue(c, meas.typicalDuration, np + ".measures.typicalDuration"),
          slaTarget: measureValue(c, meas.slaTarget, np + ".measures.slaTarget"),
          touchEffort: measureValue(c, meas.touchEffort, np + ".measures.touchEffort"),
          waitType: en(c, meas.waitType, "waitType", np + ".measures.waitType", { fallback: "" })
        },
        provenance: {
          source: en(c, prov.source, "provenanceSource", np + ".provenance.source"),
          validation: en(c, prov.validation, "validation", np + ".provenance.validation"),
          evidenceRefs: idList(c, prov.evidenceRefs, np + ".provenance.evidenceRefs"),
          note: str(c, prov.note, np + ".provenance.note", { max: 4000 })
        },
        lineage: null,
        removed: bool(node.removed)
      };
      if (clean.sourceType === undefined) delete clean.sourceType;
      if (node.lineage !== undefined && node.lineage !== null) {
        const lin = obj(c, node.lineage, np + ".lineage");
        clean.lineage = {
          baselineNodeId: lin.baselineNodeId == null ? null : idOf(c, lin.baselineNodeId, np + ".lineage.baselineNodeId"),
          change: en(c, lin.change, "change", np + ".lineage.change"),
          rationale: str(c, lin.rationale, np + ".lineage.rationale", { max: 4000 })
        };
      }
      model.nodes.push(clean);
    });

    const edgeIds = new Set();
    arr(c, m.edges, path + ".edges", L.edgesPerModel).forEach((e, j) => {
      const ep = path + ".edges[" + j + "]";
      const edge = obj(c, e, ep, true);
      knownKeys(c, edge, ep, ["id", "from", "to", "label", "semanticType", "dashed", "emphasis", "removed", "lineage"]);
      if (!nodeIds.has(edge.from)) c.error(ep + ".from", "Connector starts at an unknown step \"" + String(edge.from).slice(0, 60) + "\".");
      if (!nodeIds.has(edge.to)) c.error(ep + ".to", "Connector ends at an unknown step \"" + String(edge.to).slice(0, 60) + "\".");
      const clean = {
        id: idOf(c, edge.id, ep + ".id", edgeIds),
        from: typeof edge.from === "string" ? edge.from : "",
        to: typeof edge.to === "string" ? edge.to : "",
        label: str(c, edge.label, ep + ".label", { max: 200 }),
        semanticType: en(c, edge.semanticType, "edgeType", ep + ".semanticType"),
        dashed: bool(edge.dashed),
        emphasis: edge.emphasis === "early" ? "early" : "",
        removed: bool(edge.removed),
        lineage: null
      };
      if (edge.lineage !== undefined && edge.lineage !== null) {
        const lin = obj(c, edge.lineage, ep + ".lineage");
        clean.lineage = { change: en(c, lin.change, "change", ep + ".lineage.change"),
          rationale: str(c, lin.rationale, ep + ".lineage.rationale", { max: 4000 }) };
      }
      model.edges.push(clean);
    });

    const pres = obj(c, m.presentation, path + ".presentation");
    model.presentation.laneHeight = num(c, pres.laneHeight, path + ".presentation.laneHeight", { min: 60, max: 400 });
    const pnodes = obj(c, pres.nodes, path + ".presentation.nodes");
    Object.keys(pnodes).forEach(k => {
      if (!nodeIds.has(k)) return;
      const p = obj(c, pnodes[k], path + ".presentation.nodes." + k);
      const x = num(c, p.x, path + ".presentation.nodes." + k + ".x");
      if (x !== null) model.presentation.nodes[k] = { x };
    });
    const generated = sanitizeGenerated(c, m.generated, path + ".generated");
    if (generated) model.generated = generated;
    return model;
  }

  /*
   * datasetIds, when given, is the set of event-log dataset IDs that
   * observedFrom may point to; a dangling reference is removed with a warning.
   */
  function sanitizeScenario(c, raw, i, scenarioIds, modelsById, datasetIds, pathOverride) {
    const path = pathOverride || "scenarios[" + i + "]";
    const s = obj(c, raw, path, true);
    knownKeys(c, s, path, ["id", "name", "statusLabel", "statusTone", "provenance", "summary", "attributes",
      "timing", "runs", "measures", "economics", "observedFrom"]);
    const timing = obj(c, s.timing, path + ".timing");
    const scenario = {
      id: idOf(c, s.id, path + ".id", scenarioIds),
      name: str(c, s.name, path + ".name", { max: 300 }) || "Scenario " + (i + 1),
      statusLabel: str(c, s.statusLabel, path + ".statusLabel", { max: 80 }),
      statusTone: ["done", "progress", "stuck", "new", ""].includes(s.statusTone) ? s.statusTone : "",
      provenance: en(c, s.provenance, "scenarioProvenance", path + ".provenance"),
      summary: str(c, s.summary, path + ".summary", { max: 4000 }),
      attributes: arr(c, s.attributes, path + ".attributes", 50).map((a, j) => {
        const ap = path + ".attributes[" + j + "]";
        const at = obj(c, a, ap);
        return { label: str(c, at.label, ap + ".label", { max: 120 }), value: str(c, at.value, ap + ".value", { max: 500 }) };
      }).filter(a => a.label),
      timing: {
        method: en(c, timing.method, "timingMethod", path + ".timing.method"),
        note: str(c, timing.note, path + ".timing.note", { max: 2000 })
      },
      runs: {}, measures: [], economics: null
    };

    const runs = obj(c, s.runs, path + ".runs");
    Object.keys(runs).forEach(modelId => {
      if (FORBIDDEN_KEYS.has(modelId)) return;
      const rp = path + ".runs." + modelId;
      const model = modelsById.get(modelId);
      if (!model) { c.error(rp, "Timing refers to a process that is not in the file."); return; }
      const r = obj(c, runs[modelId], rp);
      knownKeys(c, r, rp, ["visits", "transitions", "membership", "pauseAt", "milestones"]);
      const nodeIds = new Set(model.nodes.map(n => n.id));
      const edgeById = new Map(model.edges.map(e => [e.id, e]));
      const visitIds = new Set();
      const visitNode = new Map();
      const membership = {};
      const mem = obj(c, r.membership, rp + ".membership");
      Object.keys(mem).forEach(nodeId => {
        if (!nodeIds.has(nodeId)) { c.warn(rp + ".membership." + nodeId, "A route setting for an unknown step was left out.", "ref.dangling"); return; }
        membership[nodeId] = en(c, mem[nodeId], "membership", rp + ".membership." + nodeId, { fallback: "unknown" });
      });
      const visits = [];
      arr(c, r.visits, rp + ".visits", L.visitsPerRun).forEach((v, j) => {
        const vp = rp + ".visits[" + j + "]";
        const visit = obj(c, v, vp, true);
        const id = idOf(c, visit.id, vp + ".id", visitIds);
        if (!nodeIds.has(visit.nodeId)) { c.error(vp + ".nodeId", "Visit refers to an unknown step."); return; }
        const start = num(c, visit.start, vp + ".start", { required: true, min: 0 });
        const end = num(c, visit.end, vp + ".end", { required: true, min: 0 });
        if (start !== null && end !== null && end < start) c.error(vp + ".end", "A visit cannot end before it starts.");
        if (membership[visit.nodeId] === "excluded") {
          c.warn(vp, "Timing for a step marked Not in scenario was left out.", "membership.conflict");
          return;
        }
        visits.push({ id, nodeId: visit.nodeId, start: start || 0, end: end === null ? (start || 0) : end });
        visitNode.set(id, visit.nodeId);
      });
      const transitions = [];
      arr(c, r.transitions, rp + ".transitions", L.visitsPerRun * 2).forEach((t, j) => {
        const tp = rp + ".transitions[" + j + "]";
        const tr = obj(c, t, tp, true);
        const edge = edgeById.get(tr.edgeId);
        if (!edge) { c.error(tp + ".edgeId", "Transition refers to an unknown connector."); return; }
        if (!visitNode.has(tr.fromVisitId) || !visitNode.has(tr.toVisitId)) {
          c.error(tp, "Transition refers to an unknown visit."); return;
        }
        if (visitNode.get(tr.fromVisitId) !== edge.from || visitNode.get(tr.toVisitId) !== edge.to) {
          c.error(tp, "Transition visits do not match the connector's steps."); return;
        }
        transitions.push({ edgeId: tr.edgeId, fromVisitId: tr.fromVisitId, toVisitId: tr.toVisitId });
      });
      const ms = {};
      const rawMs = obj(c, r.milestones, rp + ".milestones");
      Object.keys(rawMs).forEach(k => {
        if (FORBIDDEN_KEYS.has(k)) return;
        const v = num(c, rawMs[k], rp + ".milestones." + k, { min: 0 });
        if (v !== null) ms[k] = v;
      });
      if (!transitions.length && visits.length > 1 && r.transitions === undefined) {
        replay.deriveTransitions(model, visits).forEach(tr => transitions.push(tr));
        c.warn(rp + ".transitions", "The file does not say how the case moves between steps, so AIxRay worked it out from the timings and connectors. Check loops and decisions.", "transitions.derived", "info");
      }
      scenario.runs[modelId] = {
        visits, transitions, membership,
        pauseAt: num(c, r.pauseAt, rp + ".pauseAt", { min: 0 }),
        milestones: ms
      };
    });

    scenario.measures = arr(c, s.measures, path + ".measures", 200).map((m, j) => {
      const mp = path + ".measures[" + j + "]";
      const me = obj(c, m, mp, true);
      const unit = str(c, me.unit, mp + ".unit", { max: 40 }) || "count";
      if (!units.isKnownUnit(unit)) c.warn(mp + ".unit", "Unknown unit \"" + unit + "\".", "unit.unknown");
      const values = {}, suppliedText = {};
      const vals = obj(c, me.values, mp + ".values");
      Object.keys(vals).forEach(k => {
        if (!modelsById.has(k)) { c.warn(mp + ".values." + k, "A value for a process that is not in the file was left out.", "ref.dangling"); return; }
        values[k] = num(c, vals[k], mp + ".values." + k);
      });
      const st = obj(c, me.suppliedText, mp + ".suppliedText");
      Object.keys(st).forEach(k => { if (modelsById.has(k)) suppliedText[k] = str(c, st[k], mp + ".suppliedText." + k, { max: 200 }); });
      return {
        key: str(c, me.key, mp + ".key", { max: 80 }) || "measure-" + j,
        label: str(c, me.label, mp + ".label", { max: 200 }) || String(me.key || "Measure"),
        unit,
        values, suppliedText,
        status: MEASURE_STATUS.includes(me.status) ? me.status : "supplied",
        note: str(c, me.note, mp + ".note", { max: 2000 })
      };
    });

    if (s.economics !== undefined && s.economics !== null) {
      const ep = path + ".economics";
      const e = obj(c, s.economics, ep);
      const sup = obj(c, e.supplied, ep + ".supplied");
      const text = obj(c, sup.text, ep + ".supplied.text");
      const overrides = {};
      const ov = obj(c, e.overrides, ep + ".overrides");
      Object.keys(ov).forEach(k => {
        if (FORBIDDEN_KEYS.has(k)) return;
        const o = obj(c, ov[k], ep + ".overrides." + k);
        const value = num(c, o.value, ep + ".overrides." + k + ".value");
        if (value !== null) overrides[k] = { value, status: en(c, o.status, "assumptionStatus", ep + ".overrides." + k + ".status"), note: str(c, o.note, ep + ".overrides." + k + ".note", { max: 1000 }) };
      });
      const modelRef = (v, p) => {
        if (v == null) return null;
        if (!modelsById.has(v)) { c.error(p, "Refers to a process that is not in the file."); return null; }
        return v;
      };
      scenario.economics = {
        beforeModelId: modelRef(e.beforeModelId, ep + ".beforeModelId"),
        afterModelId: modelRef(e.afterModelId, ep + ".afterModelId"),
        supplied: {
          beforeCostPerCase: num(c, sup.beforeCostPerCase, ep + ".supplied.beforeCostPerCase"),
          afterCostPerCase: num(c, sup.afterCostPerCase, ep + ".supplied.afterCostPerCase"),
          costSavedPerCase: num(c, sup.costSavedPerCase, ep + ".supplied.costSavedPerCase"),
          fteCapacity: num(c, sup.fteCapacity, ep + ".supplied.fteCapacity"),
          text: {
            cycleSaved: str(c, text.cycleSaved, ep + ".supplied.text.cycleSaved", { max: 300 }),
            cycleSavedShare: str(c, text.cycleSavedShare, ep + ".supplied.text.cycleSavedShare", { max: 300 }),
            costSaved: str(c, text.costSaved, ep + ".supplied.text.costSaved", { max: 300 }),
            fte: str(c, text.fte, ep + ".supplied.text.fte", { max: 300 })
          }
        },
        overrides
      };
    }
    if (s.observedFrom !== undefined && s.observedFrom !== null) {
      const op = path + ".observedFrom";
      const o = obj(c, s.observedFrom, op);
      knownKeys(c, o, op, ["datasetId", "variantId", "caseLabel"]);
      const datasetId = util.isValidId(o.datasetId) ? o.datasetId : null;
      if (!datasetId || (datasetIds && !datasetIds.has(datasetId))) {
        c.warn(op + ".datasetId", "Event log \"" + String(o.datasetId).slice(0, 60) + "\" not found; link removed.", "ref.dangling");
      } else {
        scenario.observedFrom = {
          datasetId,
          variantId: o.variantId == null ? null : str(c, o.variantId, op + ".variantId", { max: 80 }),
          caseLabel: str(c, o.caseLabel, op + ".caseLabel", { max: 200 })
        };
      }
    }
    return scenario;
  }

  /* ---------- Event-log datasets, value cases and client reviews (all optional) ---------- */

  const MEASURE_STATUS = ["supplied", "calculated", "observed", "validated"];
  const STAT_KEYS = ["n", "mean", "min", "p10", "p25", "p50", "p75", "p90", "max"];

  /** Lookup sets for cross-references, built from a sanitized (or partly sanitized) engagement. */
  function refsOf(e) {
    const list = key => (e && Array.isArray(e[key]) ? e[key] : []);
    return {
      modelsById: new Map(list("models").map(m => [m.id, m])),
      nodeIndex: new Map(list("models").map(m => [m.id, new Set(m.nodes.map(n => n.id))])),
      edgeIndex: new Map(list("models").map(m => [m.id, new Set(m.edges.map(x => x.id))])),
      scenarioIds: new Set(list("scenarios").map(s => s.id)),
      datasetIds: new Set(list("datasets").map(d => d.id)),
      recordIds: new Set(list("records").map(r => r.id)),
      evidenceIds: new Set(list("evidence").map(x => x.id)),
      packIds: new Set(list("reviewPacks").map(p => p.id)),
      goalIds: new Set(list("goals").map(g => g.id)),
      assumptionIds: new Set(list("assumptions").map(a => a.id))
    };
  }

  function count(c, v, path) {
    return num(c, v, path, { min: 0, integer: true, fallback: 0 });
  }

  /* An optional reference: null when absent; removed with a warning when it does not resolve. */
  function optionalRef(c, v, path, known, what) {
    if (v === undefined || v === null || v === "") return null;
    if (util.isValidId(v) && known.has(v)) return v;
    c.warn(path, what + " \"" + String(v).slice(0, 60) + "\" not found; link removed.", "ref.dangling");
    return null;
  }

  function stats(c, v, path) {
    if (v === undefined || v === null) return null;
    const s = obj(c, v, path);
    knownKeys(c, s, path, STAT_KEYS);
    const out = { n: count(c, s.n, path + ".n") };
    STAT_KEYS.slice(1).forEach(k => { out[k] = num(c, s[k], path + "." + k); });
    return out;
  }

  function share(c, v, path) {
    return num(c, v, path, { min: 0, max: 1 });
  }

  /**
   * One event-log dataset: aggregates only, never events, case IDs or
   * resource names. refs come from refsOf(); datasetIds are the IDs that
   * comparesToDatasetId may name; taken collects dataset IDs.
   */
  function datasetOf(c, raw, path, refs, datasetIds, taken) {
    const d = obj(c, raw, path, true);
    knownKeys(c, d, path, ["id", "name", "role", "comparesToDatasetId", "comparisonGroup", "modelId", "dataStatus", "createdAt", "source", "period",
      "timeBasis", "mapping", "cases", "steps", "transitions", "variants", "otherVariants", "scenarioIds", "notes"]);
    const id = idOf(c, d.id, path + ".id", taken);
    const modelId = optionalRef(c, d.modelId, path + ".modelId", refs.modelsById, "Model");
    if (d.modelId == null) c.warn(path + ".modelId", "The event log is not linked to a process.", "dataset.model", "info");
    const nodes = modelId ? refs.nodeIndex.get(modelId) : null;
    const edges = modelId ? refs.edgeIndex.get(modelId) : null;
    const nodeRef = (v, p) => {
      if (!util.isValidId(v)) { c.warn(p, "A link to a step was not valid and was left out.", "ref.invalid"); return null; }
      if (nodes && !nodes.has(v)) { c.warn(p, "Step \"" + v + "\" not found; link removed.", "ref.dangling"); return null; }
      return v;
    };
    let compares = null;
    if (d.comparesToDatasetId != null && d.comparesToDatasetId !== "") {
      if (d.comparesToDatasetId === d.id) c.warn(path + ".comparesToDatasetId", "An event log cannot be compared with itself; the comparison was removed.", "ref.dangling");
      else compares = optionalRef(c, d.comparesToDatasetId, path + ".comparesToDatasetId", datasetIds, "Event log");
    }
    // A comparison group: two other logs, from a team that did not get the change. Kept only when set.
    let group = null;
    if (d.comparisonGroup !== undefined && d.comparisonGroup !== null) {
      const gp = path + ".comparisonGroup";
      const g = util.isPlainObject(d.comparisonGroup) ? d.comparisonGroup : {};
      knownKeys(c, g, gp, ["baselineId", "afterId"]);
      const gb = optionalRef(c, g.baselineId, gp + ".baselineId", datasetIds, "Event log");
      const ga = optionalRef(c, g.afterId, gp + ".afterId", datasetIds, "Event log");
      const own = [id, compares];
      if (gb && ga && gb !== ga && !own.includes(gb) && !own.includes(ga)) group = { baselineId: gb, afterId: ga };
      else c.warn(gp, "A comparison group needs two other event logs, one from before and one from after; it was removed.", "ref.dangling");
    }
    const sp = path + ".source";
    const src = obj(c, d.source, sp);
    knownKeys(c, src, sp, ["fileName", "format", "sha256", "rows", "events", "timestampMode", "caseIds", "resources",
      "droppedRows", "unmatchedEvents", "excludedIncompleteCases"]);
    if (src.sha256 && !/^[0-9a-f]{64}$/.test(String(src.sha256))) c.warn(sp + ".sha256", "The file fingerprint was not valid, so it was removed.", "dataset.hash");
    const pp = path + ".period", tp = path + ".timeBasis", cp = path + ".cases", op = path + ".otherVariants";
    const period = obj(c, d.period, pp);
    const tb = obj(c, d.timeBasis, tp);
    const cases = obj(c, d.cases, cp);
    const other = obj(c, d.otherVariants, op);
    knownKeys(c, period, pp, ["start", "end", "days"]);
    knownKeys(c, tb, tp, ["calendar", "businessMinutesPerDay", "dayStartMinute"]);
    knownKeys(c, cases, cp, ["count", "complete", "arrivalsPerDay", "annualizedVolume", "cycleTime", "eventsPerCase"]);
    knownKeys(c, other, op, ["variants", "cases"]);
    const out = {
      id,
      name: str(c, d.name, path + ".name", { max: 200 }).trim() || str(c, src.fileName, sp + ".fileName", { max: 260 }) || "Event log",
      role: en(c, d.role, "datasetRole", path + ".role"),
      comparesToDatasetId: compares,
      modelId,
      dataStatus: en(c, d.dataStatus, "dataStatus", path + ".dataStatus", { fallback: "supplied" }),
      createdAt: str(c, d.createdAt, path + ".createdAt", { max: 40 }),
      source: {
        fileName: str(c, src.fileName, sp + ".fileName", { max: 260 }),
        format: en(c, src.format, "logFormat", sp + ".format"),
        sha256: /^[0-9a-f]{64}$/.test(String(src.sha256 || "")) ? src.sha256 : "",
        rows: count(c, src.rows, sp + ".rows"),
        events: count(c, src.events, sp + ".events"),
        timestampMode: en(c, src.timestampMode, "timestampMode", sp + ".timestampMode"),
        caseIds: en(c, src.caseIds, "caseIdHandling", sp + ".caseIds"),
        resources: src.resources === "counted" ? "counted" : "dropped",
        droppedRows: count(c, src.droppedRows, sp + ".droppedRows"),
        unmatchedEvents: count(c, src.unmatchedEvents, sp + ".unmatchedEvents"),
        excludedIncompleteCases: count(c, src.excludedIncompleteCases, sp + ".excludedIncompleteCases")
      },
      period: {
        start: str(c, period.start, pp + ".start", { max: 40 }),
        end: str(c, period.end, pp + ".end", { max: 40 }),
        days: num(c, period.days, pp + ".days", { min: 0 })
      },
      timeBasis: {
        calendar: en(c, tb.calendar, "timeCalendar", tp + ".calendar"),
        businessMinutesPerDay: num(c, tb.businessMinutesPerDay, tp + ".businessMinutesPerDay", { min: 1, max: 1440, fallback: 480 }),
        dayStartMinute: num(c, tb.dayStartMinute, tp + ".dayStartMinute", { min: 0, max: 1439, integer: true, fallback: 540 })
      },
      mapping: [],
      cases: {
        count: count(c, cases.count, cp + ".count"),
        complete: count(c, cases.complete, cp + ".complete"),
        arrivalsPerDay: num(c, cases.arrivalsPerDay, cp + ".arrivalsPerDay", { min: 0 }),
        annualizedVolume: num(c, cases.annualizedVolume, cp + ".annualizedVolume", { min: 0 }),
        cycleTime: stats(c, cases.cycleTime, cp + ".cycleTime"),
        eventsPerCase: stats(c, cases.eventsPerCase, cp + ".eventsPerCase")
      },
      steps: [], transitions: [], variants: [],
      otherVariants: { variants: count(c, other.variants, op + ".variants"), cases: count(c, other.cases, op + ".cases") },
      scenarioIds: [],
      notes: str(c, d.notes, path + ".notes", { max: 4000 })
    };
    if (group) out.comparisonGroup = group;
    const activities = new Set();
    arr(c, d.mapping, path + ".mapping", L.datasetMapping).forEach((m, j) => {
      const mp = path + ".mapping[" + j + "]";
      const row = obj(c, m, mp, true);
      knownKeys(c, row, mp, ["activity", "nodeId", "method", "events"]);
      const activity = str(c, row.activity, mp + ".activity", { max: 300 });
      if (!activity.trim()) { c.warn(mp + ".activity", "A mapping row without an activity name was ignored.", "dataset.mapping"); return; }
      if (activities.has(activity)) { c.warn(mp + ".activity", "Activity \"" + activity.slice(0, 60) + "\" is mapped twice; the first mapping is kept.", "dataset.mapping"); return; }
      activities.add(activity);
      out.mapping.push({
        activity,
        nodeId: row.nodeId == null || row.nodeId === "" ? null : nodeRef(row.nodeId, mp + ".nodeId"),
        method: en(c, row.method, "mappingMethod", mp + ".method"),
        events: count(c, row.events, mp + ".events")
      });
    });
    const stepIds = new Set();
    arr(c, d.steps, path + ".steps", L.nodesPerModel).forEach((s, j) => {
      const stp = path + ".steps[" + j + "]";
      const row = obj(c, s, stp, true);
      knownKeys(c, row, stp, ["nodeId", "visits", "cases", "caseShare", "reworkCases", "reworkRate", "duration", "wait", "sojourn", "resources", "handoffRate"]);
      const nodeId = nodeRef(row.nodeId, stp + ".nodeId");
      if (!nodeId) return;
      if (stepIds.has(nodeId)) { c.warn(stp + ".nodeId", "Step \"" + nodeId + "\" is listed twice; the first entry is kept.", "dataset.step"); return; }
      stepIds.add(nodeId);
      out.steps.push({
        nodeId,
        visits: count(c, row.visits, stp + ".visits"),
        cases: count(c, row.cases, stp + ".cases"),
        caseShare: share(c, row.caseShare, stp + ".caseShare"),
        reworkCases: count(c, row.reworkCases, stp + ".reworkCases"),
        reworkRate: share(c, row.reworkRate, stp + ".reworkRate"),
        duration: stats(c, row.duration, stp + ".duration"),
        wait: stats(c, row.wait, stp + ".wait"),
        sojourn: stats(c, row.sojourn, stp + ".sojourn"),
        resources: row.resources == null ? null : count(c, row.resources, stp + ".resources"),
        handoffRate: share(c, row.handoffRate, stp + ".handoffRate")
      });
    });
    arr(c, d.transitions, path + ".transitions", L.datasetTransitions).forEach((t, j) => {
      const trp = path + ".transitions[" + j + "]";
      const row = obj(c, t, trp, true);
      knownKeys(c, row, trp, ["fromNodeId", "toNodeId", "count", "edgeIds"]);
      const from = nodeRef(row.fromNodeId, trp + ".fromNodeId");
      const to = nodeRef(row.toNodeId, trp + ".toNodeId");
      if (!from || !to) return;
      out.transitions.push({
        fromNodeId: from, toNodeId: to, count: count(c, row.count, trp + ".count"),
        edgeIds: idList(c, row.edgeIds, trp + ".edgeIds").filter(x => {
          if (!edges || edges.has(x)) return true;
          c.warn(trp + ".edgeIds", "Connector \"" + x + "\" not found; link removed.", "ref.dangling");
          return false;
        })
      });
    });
    const variantIds = new Set();
    arr(c, d.variants, path + ".variants", L.datasetVariants).forEach((v, j) => {
      const vp = path + ".variants[" + j + "]";
      const row = obj(c, v, vp, true);
      knownKeys(c, row, vp, ["id", "nodeIds", "cases", "share", "cycleTime"]);
      out.variants.push({
        id: idOf(c, row.id, vp + ".id", variantIds),
        nodeIds: arr(c, row.nodeIds, vp + ".nodeIds", L.variantSteps).map((x, k) => nodeRef(x, vp + ".nodeIds[" + k + "]")).filter(Boolean),
        cases: count(c, row.cases, vp + ".cases"),
        share: share(c, row.share, vp + ".share"),
        cycleTime: stats(c, row.cycleTime, vp + ".cycleTime")
      });
    });
    out.scenarioIds = idList(c, arr(c, d.scenarioIds, path + ".scenarioIds", L.scenariosPerDataset), path + ".scenarioIds").filter(x => {
      if (refs.scenarioIds.has(x)) return true;
      c.warn(path + ".scenarioIds", "Scenario \"" + x + "\" not found; link removed.", "ref.dangling");
      return false;
    });
    return out;
  }

  const VALUE_CASE_KEYS = ["modelId", "nodeIds", "effortReductionPct", "durationReductionPct", "shareOfCasesPct", "shareSource",
    "effortSource", "datasetId", "oneTimeCost", "annualRunningCost", "confidence", "basis", "note", "aiDraft", "sources",
    "realizationPct", "realizedBy", "financeOwner", "validatedAnnual", "validatedSource"];
  /* The figures an AI draft cites a source for, one line of text each. */
  const VALUE_CASE_SOURCE_KEYS = ["shareOfCasesPct", "effortReductionPct", "durationReductionPct", "oneTimeCost", "annualRunningCost"];

  /* The figures behind an opportunity's value. Empty nodeIds means the record's linked steps. */
  function valueCaseOf(c, raw, path, refs, record) {
    const v = obj(c, raw, path);
    knownKeys(c, v, path, VALUE_CASE_KEYS);
    const modelId = optionalRef(c, v.modelId, path + ".modelId", refs.modelsById, "Model");
    const scope = modelId || (record && record.linkedModelId) || null;
    const nodeIds = idList(c, v.nodeIds, path + ".nodeIds").filter(id => {
      const ok = scope && refs.nodeIndex.has(scope) ? refs.nodeIndex.get(scope).has(id) : [...refs.nodeIndex.values()].some(s => s.has(id));
      if (!ok) c.warn(path + ".nodeIds", "Step \"" + id + "\" not found; link removed.", "ref.dangling");
      return ok;
    });
    const pct = key => num(c, v[key], path + "." + key, { min: 0, max: 100 });
    const money = key => num(c, v[key], path + "." + key, { min: 0 });
    const out = {
      modelId, nodeIds: [...new Set(nodeIds)],
      effortReductionPct: pct("effortReductionPct"),
      durationReductionPct: pct("durationReductionPct"),
      shareOfCasesPct: pct("shareOfCasesPct"),
      shareSource: en(c, v.shareSource, "valueInputSource", path + ".shareSource"),
      effortSource: v.effortSource === "dataset" ? "dataset" : "node",
      datasetId: optionalRef(c, v.datasetId, path + ".datasetId", refs.datasetIds, "Event log"),
      oneTimeCost: money("oneTimeCost"),
      annualRunningCost: money("annualRunningCost"),
      confidence: en(c, v.confidence, "confidence", path + ".confidence", { fallback: "" }),
      basis: en(c, v.basis, "assumptionStatus", path + ".basis"),
      note: str(c, v.note, path + ".note", { max: 2000 })
    };
    // Kept only when set, so value cases written before AI drafting keep their shape.
    if (v.aiDraft === true) out.aiDraft = true;
    // How the labor value is realized (docs/value-dimensions.md), also kept only when set.
    const realization = num(c, v.realizationPct, path + ".realizationPct", { min: 0, max: 100 });
    if (realization !== null) out.realizationPct = realization;
    const validated = num(c, v.validatedAnnual, path + ".validatedAnnual", {});
    if (validated !== null) out.validatedAnnual = validated;
    [["realizedBy", valueLines.TEXT.realizedBy], ["financeOwner", valueLines.TEXT.financeOwner], ["validatedSource", valueLines.TEXT.validatedSource]].forEach(([k, max]) => {
      const t = str(c, v[k], path + "." + k, { max }).trim();
      if (t) out[k] = t;
    });
    if (v.sources !== undefined && v.sources !== null) {
      const src = obj(c, v.sources, path + ".sources");
      knownKeys(c, src, path + ".sources", VALUE_CASE_SOURCE_KEYS);
      const sources = {};
      VALUE_CASE_SOURCE_KEYS.forEach(k => { const t = str(c, src[k], path + ".sources." + k, { max: 500 }).trim(); if (t) sources[k] = t; });
      if (Object.keys(sources).length) out.sources = sources;
    }
    return out;
  }

  /**
   * Splits an item reference: "step/<modelId>/<nodeId>" or "record/<recordId>".
   * Returns { kind: "step", modelId, nodeId }, { kind: "record", recordId } or null.
   */
  function parseItemRef(ref) {
    if (typeof ref !== "string" || ref.length > 200) return null;
    const parts = ref.split("/");
    if (parts[0] === "step" && parts.length === 3 && util.isValidId(parts[1]) && util.isValidId(parts[2])) return { kind: "step", modelId: parts[1], nodeId: parts[2] };
    if (parts[0] === "record" && parts.length === 2 && util.isValidId(parts[1])) return { kind: "record", recordId: parts[1] };
    if (parts[0] === "value" && parts.length === 3 && util.isValidId(parts[1]) && util.isValidId(parts[2])) return { kind: "value", recordId: parts[1], field: parts[2] };
    if (parts[0] === "assumption" && parts.length === 2 && util.isValidId(parts[1])) return { kind: "assumption", assumptionId: parts[1] };
    return null;
  }

  function itemRefResolves(ref, refs) {
    const p = parseItemRef(ref);
    if (!p) return false;
    if (p.kind === "record" || p.kind === "value") return refs.recordIds.has(p.recordId);
    if (p.kind === "assumption") return refs.assumptionIds.has(p.assumptionId);
    return refs.nodeIndex.has(p.modelId) && refs.nodeIndex.get(p.modelId).has(p.nodeId);
  }

  /* A reference to a reviewed item. Unreadable or dangling references give null with a warning. */
  function itemRefOf(c, v, path, refs) {
    if (!parseItemRef(v)) { c.warn(path, "A link to an item was not valid and was left out.", "ref.invalid"); return null; }
    if (refs && !itemRefResolves(v, refs)) { c.warn(path, "Item \"" + String(v).slice(0, 120) + "\" not found; it was left out.", "ref.dangling"); return null; }
    return v;
  }

  function personOf(c, v, path) {
    const p = obj(c, v, path);
    knownKeys(c, p, path, ["name", "role", "organization"]);
    return {
      name: str(c, p.name, path + ".name", { max: 200 }),
      role: str(c, p.role, path + ".role", { max: 200 }),
      organization: str(c, p.organization, path + ".organization", { max: 200 })
    };
  }

  function reviewPackOf(c, raw, path, refs, taken) {
    const p = obj(c, raw, path, true);
    knownKeys(c, p, path, ["id", "createdAt", "format", "stakeholder", "engagementRevision", "modelId", "items", "note"]);
    return {
      id: idOf(c, p.id, path + ".id", taken),
      createdAt: str(c, p.createdAt, path + ".createdAt", { max: 40 }),
      format: en(c, p.format, "reviewFormat", path + ".format"),
      stakeholder: personOf(c, p.stakeholder, path + ".stakeholder"),
      engagementRevision: num(c, p.engagementRevision, path + ".engagementRevision", { min: 0, integer: true }),
      modelId: optionalRef(c, p.modelId, path + ".modelId", refs.modelsById, "Model"),
      items: arr(c, p.items, path + ".items", L.reviewEntries).map((it, j) => {
        const ip = path + ".items[" + j + "]";
        const x = obj(c, it, ip, true);
        knownKeys(c, x, ip, ["itemRef", "label"]);
        const itemRef = itemRefOf(c, x.itemRef, ip + ".itemRef", refs);
        return itemRef ? { itemRef, label: str(c, x.label, ip + ".label", { max: 300 }) } : null;
      }).filter(Boolean),
      note: str(c, p.note, path + ".note", { max: 4000 })
    };
  }

  function reviewOf(c, raw, path, refs, taken) {
    const r = obj(c, raw, path, true);
    knownKeys(c, r, path, ["id", "packId", "receivedAt", "submittedAt", "source", "reviewer", "generalComment", "entries", "applied"]);
    const ap = path + ".applied";
    const applied = obj(c, r.applied, ap);
    knownKeys(c, applied, ap, ["validations", "questions", "evidenceId", "values"]);
    const out = {
      id: idOf(c, r.id, path + ".id", taken),
      packId: optionalRef(c, r.packId, path + ".packId", refs.packIds, "Review form"),
      receivedAt: str(c, r.receivedAt, path + ".receivedAt", { max: 40 }),
      submittedAt: str(c, r.submittedAt, path + ".submittedAt", { max: 40 }),
      source: en(c, r.source, "reviewFormat", path + ".source"),
      reviewer: personOf(c, r.reviewer, path + ".reviewer"),
      generalComment: str(c, r.generalComment, path + ".generalComment", { max: 4000 }),
      entries: arr(c, r.entries, path + ".entries", L.reviewEntries).map((it, j) => {
        const ip = path + ".entries[" + j + "]";
        const x = obj(c, it, ip, true);
        knownKeys(c, x, ip, ["itemRef", "label", "verdict", "comment"]);
        const itemRef = itemRefOf(c, x.itemRef, ip + ".itemRef", refs);
        return itemRef ? {
          itemRef, label: str(c, x.label, ip + ".label", { max: 300 }),
          verdict: en(c, x.verdict, "reviewVerdict", ip + ".verdict", { fallback: "unsure" }),
          comment: str(c, x.comment, ip + ".comment", { max: 4000 })
        } : null;
      }).filter(Boolean),
      applied: {
        validations: count(c, applied.validations, ap + ".validations"),
        questions: count(c, applied.questions, ap + ".questions"),
        evidenceId: optionalRef(c, applied.evidenceId, ap + ".evidenceId", refs.evidenceIds, "Evidence")
      }
    };
    // Business case figures marked confirmed (lib/reviews.js), kept only when some were.
    const values = count(c, applied.values, ap + ".values");
    if (values > 0) out.applied.values = values;
    return out;
  }

  function noteIgnored(c) {
    if (c.ignored.length) {
      c.warn("", "Ignored " + c.ignored.length + " unrecognized field" + (c.ignored.length === 1 ? "" : "s") + ": " +
        c.ignored.slice(0, 8).join(", ") + (c.ignored.length > 8 ? ", ..." : "") + ".", "fields.ignored", "info");
    }
  }

  /* Runs one sanitizer on its own checker: { value, errors, warnings }. Check errors before using value. */
  function standalone(fn) {
    const c = new Checker();
    const value = fn(c);
    noteIgnored(c);
    return { value, errors: c.errors, warnings: c.warnings };
  }

  /** A dataset that is not yet in engagement e (its ID must be new). */
  function sanitizeDataset(raw, e) {
    const refs = refsOf(e);
    return standalone(c => datasetOf(c, raw, "dataset", refs, refs.datasetIds, new Set(refs.datasetIds)));
  }

  /** An opportunity's value case, checked against engagement e and the record it belongs to. */
  function sanitizeValueCase(raw, e, record) {
    return standalone(c => valueCaseOf(c, raw, "valueCase", refsOf(e), record || null));
  }

  /** An opportunity's investment settings in shape (lib/investment.js). */
  function sanitizeInvestment(raw) {
    return investment.sanitizeInvestment(raw);
  }

  /** An opportunity's value lines in shape: { lines, dropped }. */
  function sanitizeValueLines(raw) {
    return valueLines.sanitizeLines(raw);
  }

  /** A scenario that is not yet in engagement e, such as one generated from an event log. */
  function sanitizeScenarioFor(raw, e) {
    const refs = refsOf(e);
    return standalone(c => sanitizeScenario(c, raw, (e.scenarios || []).length, new Set(refs.scenarioIds), refs.modelsById, refs.datasetIds, "scenario"));
  }

  /** A review pack that is not yet in engagement e. */
  function sanitizeReviewPack(raw, e) {
    const refs = refsOf(e);
    return standalone(c => reviewPackOf(c, raw, "reviewPack", refs, new Set(refs.packIds)));
  }

  /** A received review that is not yet in engagement e. */
  function sanitizeReview(raw, e) {
    const refs = refsOf(e);
    return standalone(c => reviewOf(c, raw, "review", refs, new Set(((e && e.reviews) || []).map(x => x.id))));
  }

  /**
   * Checks a client's review response file (schema aixray.review-response).
   * With an engagement, a response made for another engagement is refused and
   * entries for items that no longer exist are left out with a warning.
   * Returns { ok, errors, warnings, response }; response is null when errors exist.
   */
  function validateReviewResponse(data, e) {
    const c = new Checker();
    const done = response => {
      noteIgnored(c);
      const ok = c.errors.length === 0;
      return { ok, errors: c.errors, warnings: c.warnings, response: ok ? response : null };
    };
    if (!util.isPlainObject(data) || schema.currentFormatId(data.schema) !== schema.REVIEW_RESPONSE_ID) {
      c.error("schema", "This is not a file of review answers from AIxRay.");
      return done(null);
    }
    if (data.schemaVersion !== 1) {
      c.error("schemaVersion", Number(data.schemaVersion) > 1 ? "These review answers were made by a newer version of AIxRay. Update AIxRay, then import them again." : "AIxRay does not recognize the version of these review answers.");
      return done(null);
    }
    knownKeys(c, data, "", ["schema", "schemaVersion", "packId", "engagementId", "engagementRevision", "format", "reviewer",
      "submittedAt", "generalComment", "entries"]);
    const refs = e ? refsOf(e) : null;
    const response = {
      schema: schema.REVIEW_RESPONSE_ID, schemaVersion: 1,
      packId: idOf(c, data.packId, "packId"),
      engagementId: idOf(c, data.engagementId, "engagementId"),
      engagementRevision: num(c, data.engagementRevision, "engagementRevision", { min: 0, integer: true }),
      format: en(c, data.format, "reviewFormat", "format"),
      reviewer: personOf(c, data.reviewer, "reviewer"),
      submittedAt: str(c, data.submittedAt, "submittedAt", { max: 40 }),
      generalComment: str(c, data.generalComment, "generalComment", { max: 4000 }),
      entries: []
    };
    if (e && response.engagementId && response.engagementId !== e.id) {
      c.error("engagementId", "These answers are for a different project (" + response.engagementId + "). Open that project, then import the answers again.");
    }
    const byRef = new Map();
    arr(c, data.entries, "entries", L.reviewEntries).forEach((it, j) => {
      const ip = "entries[" + j + "]";
      const x = obj(c, it, ip, true);
      knownKeys(c, x, ip, ["itemRef", "verdict", "comment"]);
      const itemRef = itemRefOf(c, x.itemRef, ip + ".itemRef", refs);
      if (!itemRef) return;
      let verdict = x.verdict == null ? "" : x.verdict;
      if (verdict !== "" && !schema.ENUMS.reviewVerdict.includes(verdict)) {
        c.warn(ip + ".verdict", "Unknown answer \"" + String(verdict).slice(0, 40) + "\"; treated as no answer.", "enum.unknown");
        verdict = "";
      }
      if (byRef.has(itemRef)) c.warn(ip, "Item \"" + itemRef + "\" is answered twice; the later answer is kept.", "review.duplicate");
      byRef.set(itemRef, { itemRef, verdict, comment: str(c, x.comment, ip + ".comment", { max: 4000 }) });
    });
    response.entries = [...byRef.values()];
    return done(response);
  }

  const AI_KEYS = ["inputStructure", "dataAvailability", "judgment", "exceptions", "authority",
    "humanReview", "auditability", "failureHandling"];

  function sanitizeRecord(c, raw, i, ids, nodeIndex, modelsById, refs) {
    const path = "records[" + i + "]";
    const r = obj(c, raw, path, true);
    knownKeys(c, r, path, ["id", "kind", "title", "description", "owner", "status", "priority", "linkedModelId",
      "linkedModelVersion", "linkedNodeIds", "evidenceRefs", "sensitive", "includeInHandoff", "opportunity",
      "generated", "createdAt", "updatedAt"]);
    const linkedModelId = r.linkedModelId && modelsById.has(r.linkedModelId) ? r.linkedModelId : null;
    if (r.linkedModelId && !linkedModelId) c.warn(path + ".linkedModelId", "Linked process not found; link removed.", "ref.dangling");
    const linkedNodeIds = idList(c, r.linkedNodeIds, path + ".linkedNodeIds").filter(id => {
      const ok = linkedModelId ? nodeIndex.get(linkedModelId).has(id) : [...nodeIndex.values()].some(s => s.has(id));
      if (!ok) c.warn(path + ".linkedNodeIds", "Linked step \"" + id + "\" not found; link removed.", "ref.dangling");
      return ok;
    });
    const record = {
      id: idOf(c, r.id, path + ".id", ids),
      kind: en(c, r.kind, "recordKind", path + ".kind", { fallback: "note" }),
      title: str(c, r.title, path + ".title", { max: 300 }).trim() || "Untitled finding",
      description: str(c, r.description, path + ".description"),
      owner: str(c, r.owner, path + ".owner", { max: 200 }),
      status: en(c, r.status, "recordStatus", path + ".status"),
      priority: en(c, r.priority, "priority", path + ".priority", { fallback: "" }),
      linkedModelId,
      linkedModelVersion: num(c, r.linkedModelVersion, path + ".linkedModelVersion", { min: 1, integer: true }),
      linkedNodeIds,
      evidenceRefs: idList(c, r.evidenceRefs, path + ".evidenceRefs"),
      sensitive: bool(r.sensitive),
      includeInHandoff: r.includeInHandoff === undefined ? true : bool(r.includeInHandoff),
      opportunity: null,
      createdAt: str(c, r.createdAt, path + ".createdAt", { max: 40 }),
      updatedAt: str(c, r.updatedAt, path + ".updatedAt", { max: 40 })
    };
    if (r.opportunity !== undefined && r.opportunity !== null) {
      const op = path + ".opportunity";
      const o = obj(c, r.opportunity, op);
      const ai = obj(c, o.aiAssessment, op + ".aiAssessment");
      record.opportunity = {
        intervention: en(c, o.intervention, "intervention", op + ".intervention", { fallback: "" }),
        simplerAlternative: str(c, o.simplerAlternative, op + ".simplerAlternative", { max: 4000 }),
        expectedBenefit: str(c, o.expectedBenefit, op + ".expectedBenefit", { max: 4000 }),
        affectedVolume: str(c, o.affectedVolume, op + ".affectedVolume", { max: 500 }),
        effort: en(c, o.effort, "effortSize", op + ".effort", { fallback: "" }),
        risk: str(c, o.risk, op + ".risk", { max: 4000 }),
        dependencies: str(c, o.dependencies, op + ".dependencies", { max: 4000 }),
        validationAction: str(c, o.validationAction, op + ".validationAction", { max: 4000 }),
        aiAssessment: Object.assign(
          Object.fromEntries(AI_KEYS.map(k => [k, str(c, ai[k], op + ".aiAssessment." + k, { max: 2000 })])),
          { mode: ["assist", "autonomous", ""].includes(ai.mode) ? ai.mode : "" })
      };
      if (o.wave !== undefined) record.opportunity.wave = en(c, o.wave, "wave", op + ".wave", { fallback: "" });
      if (o.goalIds !== undefined && o.goalIds !== null) {
        const known = (refs || refsOf(null)).goalIds;
        record.opportunity.goalIds = [...new Set(idList(c, o.goalIds, op + ".goalIds"))].filter(id => {
          if (known.has(id)) return true;
          c.warn(op + ".goalIds", "Goal \"" + id + "\" not found; link removed.", "ref.dangling");
          return false;
        });
      }
      if (o.valueCase !== undefined && o.valueCase !== null) {
        record.opportunity.valueCase = valueCaseOf(c, o.valueCase, op + ".valueCase", refs || refsOf(null), record);
      }
      if (o.valueLines !== undefined && o.valueLines !== null) {
        const v = valueLines.sanitizeLines(arr(c, o.valueLines, op + ".valueLines", valueLines.LIMIT));
        record.opportunity.valueLines = v.lines;
        if (v.dropped > 0) c.warn(op + ".valueLines", v.dropped + " value line" + (v.dropped === 1 ? "" : "s") + " without a valid ID or a known kind of value, or with a repeated ID, " + (v.dropped === 1 ? "was" : "were") + " left out.", "valueLines.dropped");
      }
      if (o.investment !== undefined && o.investment !== null) {
        if (!util.isPlainObject(o.investment)) c.warn(op + ".investment", "The investment settings were not an object and were left out.", "investment.dropped");
        else record.opportunity.investment = investment.sanitizeInvestment(o.investment);
      }
    }
    const generated = sanitizeGenerated(c, r.generated, path + ".generated");
    if (generated) record.generated = generated;
    return record;
  }

  function sanitizeEvidence(c, raw, i, ids) {
    const path = "evidence[" + i + "]";
    const e = obj(c, raw, path, true);
    knownKeys(c, e, path, ["id", "title", "locator", "extractedFact", "status", "reviewer", "reviewDate", "link"]);
    let link = null;
    if (e.link) {
      link = util.safeHttpUrl(String(e.link));
      if (!link) c.warn(path + ".link", "Only http and https links are allowed; link removed.", "link.unsafe");
    }
    return {
      id: idOf(c, e.id, path + ".id", ids),
      title: str(c, e.title, path + ".title", { max: 300 }).trim() || "Untitled source",
      locator: str(c, e.locator, path + ".locator", { max: 500 }),
      extractedFact: str(c, e.extractedFact, path + ".extractedFact"),
      status: en(c, e.status, "evidenceStatus", path + ".status"),
      reviewer: str(c, e.reviewer, path + ".reviewer", { max: 200 }),
      reviewDate: str(c, e.reviewDate, path + ".reviewDate", { max: 40 }),
      link
    };
  }

  function sanitizeAssumption(c, raw, i, ids) {
    const path = "assumptions[" + i + "]";
    const a = obj(c, raw, path, true);
    knownKeys(c, a, path, ["id", "key", "label", "value", "unit", "status", "source", "note"]);
    const key = str(c, a.key, path + ".key", { max: 80, required: true });
    const def = schema.DRIVERS.find(d => d.key === key);
    const unit = def ? def.unit : (str(c, a.unit, path + ".unit", { max: 40 }) || "count");
    return {
      id: idOf(c, a.id, path + ".id", ids),
      key,
      label: str(c, a.label, path + ".label", { max: 300 }) || (def ? def.label : key),
      value: num(c, a.value, path + ".value"),
      unit,
      status: en(c, a.status, "assumptionStatus", path + ".status"),
      source: str(c, a.source, path + ".source", { max: 500 }),
      note: str(c, a.note, path + ".note", { max: 2000 })
    };
  }

  /**
   * Validates and sanitizes an engagement object.
   * Returns { ok, errors, warnings, engagement }. engagement is null when errors exist.
   */
  function validateEngagement(input) {
    const c = new Checker();
    if (!util.isPlainObject(input)) {
      c.error("", "This file does not contain an AIxRay project.");
      return { ok: false, errors: c.errors, warnings: c.warnings, engagement: null };
    }
    if (schema.currentFormatId(input.schema) !== schema.SCHEMA_ID) {
      c.error("schema", "This is not an AIxRay project file. " +
        "To open an older .js configuration, convert it first with tools/convert-legacy.mjs.");
      return { ok: false, errors: c.errors, warnings: c.warnings, engagement: null };
    }
    if (schema.isLegacyFormatId(input.schema)) {
      c.warn("schema", "This file was saved by BPMVIZ, the earlier name of AIxRay. It opens as usual, and AIxRay saves it as an AIxRay project file.", "format.renamed", "info");
    }
    const migrated = migrate.migrateEngagement(input);
    if (migrated.error) {
      c.error("schemaVersion", migrated.error);
      return { ok: false, errors: c.errors, warnings: c.warnings, engagement: null };
    }
    migrated.notes.forEach(n => c.warn("schemaVersion", n, "migration", "info"));
    const raw = migrated.engagement;
    knownKeys(c, raw, "", ["schema", "schemaVersion", "id", "revision", "createdAt", "updatedAt", "meta",
      "milestones", "models", "scenarios", "records", "evidence", "assumptions", "narratives", "datasets", "reviewPacks", "reviews",
      "migration", "workshop", "goals", "checkpoints"]);

    const out = {
      schema: schema.SCHEMA_ID,
      schemaVersion: schema.SCHEMA_VERSION,
      id: idOf(c, raw.id, "id"),
      revision: num(c, raw.revision, "revision", { min: 0, integer: true, fallback: 0 }),
      createdAt: str(c, raw.createdAt, "createdAt", { max: 40 }) || util.nowIso(),
      updatedAt: str(c, raw.updatedAt, "updatedAt", { max: 40 }) || util.nowIso(),
      meta: sanitizeMeta(c, raw.meta),
      milestones: [], models: [], scenarios: [], records: [], evidence: [], assumptions: [], narratives: [],
      migration: null
    };

    const msIds = new Set();
    arr(c, raw.milestones, "milestones", 50).forEach((m, i) => {
      const p = "milestones[" + i + "]";
      const ms = obj(c, m, p, true);
      out.milestones.push({
        id: idOf(c, ms.id, p + ".id", msIds),
        name: str(c, ms.name, p + ".name", { max: 120 }) || "Milestone " + (i + 1),
        position: num(c, ms.position, p + ".position", { min: 0, max: 1, fallback: (i + 1) / 10 })
      });
    });

    const modelIds = new Set();
    const models = arr(c, raw.models, "models", L.models);
    models.forEach((m, i) => out.models.push(sanitizeModel(c, m, i, modelIds)));
    if (!out.models.some(m => m.role === "current")) {
      c.error("models", "A project needs a current state.");
    }
    const modelsById = new Map(out.models.map(m => [m.id, m]));
    out.models.forEach((m, i) => {
      if (!m.basedOn) return;
      const base = modelsById.get(m.basedOn.modelId);
      if (!base) { c.error("models[" + i + "].basedOn.modelId", "Based on a process that is not in the file."); return; }
      const baseIds = new Set(base.nodes.map(n => n.id));
      m.nodes.forEach((n, j) => {
        if (n.lineage && n.lineage.baselineNodeId && !baseIds.has(n.lineage.baselineNodeId)) {
          c.error("models[" + i + "].nodes[" + j + "].lineage.baselineNodeId", "This future-state step points to a baseline step that does not exist.");
        }
      });
    });

    // Dataset IDs are collected first so scenarios and datasets can refer to each other.
    const rawDatasets = raw.datasets === undefined || raw.datasets === null ? null : arr(c, raw.datasets, "datasets", L.datasets);
    const datasetIds = new Set((rawDatasets || []).filter(d => util.isPlainObject(d) && util.isValidId(d.id)).map(d => d.id));
    const scenarioIds = new Set();
    arr(c, raw.scenarios, "scenarios", L.scenarios).forEach((s, i) =>
      out.scenarios.push(sanitizeScenario(c, s, i, scenarioIds, modelsById, datasetIds)));

    if (rawDatasets) {
      const refs = refsOf(out);
      const taken = new Set();
      out.datasets = rawDatasets.map((d, i) => datasetOf(c, d, "datasets[" + i + "]", refs, datasetIds, taken));
    }

    const evidenceIds = new Set();
    arr(c, raw.evidence, "evidence", L.evidence).forEach((e, i) => out.evidence.push(sanitizeEvidence(c, e, i, evidenceIds)));

    if (raw.goals !== undefined && raw.goals !== null) {
      const rawGoals = arr(c, raw.goals, "goals", L.goals);
      out.goals = goals.sanitizeGoals(rawGoals);
      goals.ignoredKeys(rawGoals).forEach(k => c.ignored.push(k));
      const lost = rawGoals.length - out.goals.length;
      if (lost > 0) c.warn("goals", lost + " goal" + (lost === 1 ? "" : "s") + " without a valid ID or title, or with a repeated ID, " + (lost === 1 ? "was" : "were") + " left out.", "goals.dropped");
    }

    const nodeIndex = new Map(out.models.map(m => [m.id, new Set(m.nodes.map(n => n.id))]));
    const recordIds = new Set();
    const recordRefs = refsOf(out);
    arr(c, raw.records, "records", L.records).forEach((r, i) => out.records.push(sanitizeRecord(c, r, i, recordIds, nodeIndex, modelsById, recordRefs)));

    const assumptionIds = new Set();
    arr(c, raw.assumptions, "assumptions", L.assumptions).forEach((a, i) => out.assumptions.push(sanitizeAssumption(c, a, i, assumptionIds)));

    const narrativeKinds = new Set();
    arr(c, raw.narratives, "narratives", L.narratives).forEach((n, i) => out.narratives.push(sanitizeNarrative(c, n, i, narrativeKinds)));

    if (raw.checkpoints !== undefined && raw.checkpoints !== null) {
      const rawCheckpoints = arr(c, raw.checkpoints, "checkpoints", L.checkpoints);
      out.checkpoints = checkpoints.sanitizeCheckpoints(rawCheckpoints, out);
      checkpoints.dropped(rawCheckpoints, out).forEach(p => c.warn(p, "A checkpoint without a valid ID, or for an opportunity that is not in the file, was left out.", "ref.dangling"));
    }

    if (raw.reviewPacks !== undefined && raw.reviewPacks !== null) {
      const refs = refsOf(out);
      const taken = new Set();
      out.reviewPacks = arr(c, raw.reviewPacks, "reviewPacks", L.reviewPacks).map((p, i) => reviewPackOf(c, p, "reviewPacks[" + i + "]", refs, taken));
    }
    if (raw.reviews !== undefined && raw.reviews !== null) {
      const refs = refsOf(out);
      const taken = new Set();
      out.reviews = arr(c, raw.reviews, "reviews", L.reviews).map((r, i) => reviewOf(c, r, "reviews[" + i + "]", refs, taken));
    }

    // Evidence references must resolve.
    const dropDangling = (list, path) => list.filter(id => {
      if (evidenceIds.has(id)) return true;
      c.warn(path, "Source \"" + id + "\" not found; link removed.", "ref.dangling");
      return false;
    });
    out.models.forEach((m, i) => {
      m.sourceRefs = dropDangling(m.sourceRefs, "models[" + i + "].sourceRefs");
      m.nodes.forEach((n, j) => {
        n.provenance.evidenceRefs = dropDangling(n.provenance.evidenceRefs, "models[" + i + "].nodes[" + j + "].provenance.evidenceRefs");
      });
    });
    out.records.forEach((r, i) => { r.evidenceRefs = dropDangling(r.evidenceRefs, "records[" + i + "].evidenceRefs"); });

    if (raw.migration && util.isPlainObject(raw.migration)) {
      const mg = raw.migration;
      out.migration = {
        sourceFormat: str(c, mg.sourceFormat, "migration.sourceFormat", { max: 120 }),
        sourceFiles: arr(c, mg.sourceFiles, "migration.sourceFiles", 50).map((f, i) => str(c, f, "migration.sourceFiles[" + i + "]", { max: 300 })),
        convertedAt: str(c, mg.convertedAt, "migration.convertedAt", { max: 40 }),
        warnings: arr(c, mg.warnings, "migration.warnings", 500).map((w, i) => {
          const wo = obj(c, w, "migration.warnings[" + i + "]");
          return { code: str(c, wo.code, "migration.warnings[" + i + "].code", { max: 80 }),
            message: str(c, wo.message, "migration.warnings[" + i + "].message", { max: 2000 }),
            path: str(c, wo.path, "migration.warnings[" + i + "].path", { max: 300 }) };
        })
      };
    }

    if (raw.workshop !== undefined && raw.workshop !== null) out.workshop = workshop.sanitizeWorkshop(raw.workshop, out);

    noteIgnored(c);

    if (!c.errors.length) {
      out.scenarios.forEach((s, i) => {
        economics.reconcileScenario(out, s).warnings.forEach(w =>
          c.warn("scenarios[" + i + "].economics", s.name + ": " + w.message, w.code));
      });
      economics.engagementNotes(out).forEach(n => c.warn("scenarios", n.message, n.code, "info"));
      out.models.forEach((m, i) => {
        const none = m.nodes.filter(n => !(n.sourceIds.length || n.provenance.evidenceRefs.length ||
          n.provenance.source !== "unknown")).length;
        if (none) {
          c.warn("models[" + i + "]", m.name + ": " + none + " of " + m.nodes.length +
            " steps have nothing recorded about where they came from.", "evidence.coverage", "info");
        }
      });
    }

    const ok = c.errors.length === 0;
    return { ok, errors: c.errors, warnings: c.warnings, engagement: ok ? out : null };
  }

  /** Parses JSON text with a size limit, then validates it. */
  function parseEngagementText(text) {
    if (typeof text !== "string") {
      return { ok: false, errors: [{ path: "", message: "This file could not be read as text." }], warnings: [], engagement: null };
    }
    if (text.length > L.fileBytes) {
      return { ok: false, errors: [{ path: "", message: "This file is larger than 10 MB, the most AIxRay can open." }], warnings: [], engagement: null };
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      return { ok: false, errors: [{ path: "", message: "This file is not valid JSON: " + String(err.message || err).slice(0, 200) }], warnings: [], engagement: null };
    }
    return validateEngagement(data);
  }

  return {
    validateEngagement, parseEngagementText,
    sanitizeDataset, sanitizeValueCase, sanitizeValueLines, sanitizeInvestment, sanitizeScenarioFor, sanitizeReviewPack, sanitizeReview, validateReviewResponse,
    parseItemRef, refsOf
  };
});
