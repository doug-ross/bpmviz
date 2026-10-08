/*
 * BPMVIZ validate: checks an engagement in layers and returns a sanitized copy.
 *
 * Layers: parse and schema, identity, graph references, semantic support,
 * timing and replay membership, units, economic reconciliation, evidence.
 * Errors block loading. Warnings load but are listed for review.
 * Only known fields are copied; imported content is data and is never run.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./util.js"), require("./schema.js"), require("./units.js"),
      require("./economics.js"), require("./migrate.js"), require("./replay.js"));
  } else {
    const B = root.BPMVIZ = root.BPMVIZ || {};
    B.validate = factory(B.util, B.schema, B.units, B.economics, B.migrate, B.replay);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, schema, units, economics, migrate, replay) {
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
      c.error(path, "Expected text.");
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
      c.error(path, "Expected a finite number.");
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
      c.warn(path, "Unrecognized value \"" + String(v).slice(0, 60) + "\"; using \"" +
        (o.fallback !== undefined ? o.fallback : allowed[0]) + "\".", "enum.unknown");
      return o.fallback !== undefined ? o.fallback : allowed[0];
    }
    return v;
  }

  function arr(c, v, path, max) {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) { c.error(path, "Expected a list."); return []; }
    if (max && v.length > max) { c.error(path, "More than " + max + " entries."); return v.slice(0, max); }
    return v;
  }

  function obj(c, v, path, required) {
    if (v === undefined || v === null) {
      if (required) c.error(path, "An object is required.");
      return {};
    }
    if (!util.isPlainObject(v)) { c.error(path, "Expected an object."); return {}; }
    return v;
  }

  function idOf(c, v, path, taken) {
    if (!util.isValidId(v)) {
      c.error(path, "Missing or invalid ID. Use 1 to 80 letters, digits, and . _ : - characters.");
      return typeof v === "string" ? v : "";
    }
    if (taken) {
      if (taken.has(v)) c.error(path, "Duplicate ID \"" + v + "\".");
      taken.add(v);
    }
    return v;
  }

  function idList(c, v, path) {
    return arr(c, v, path, 1000).filter((x, i) => {
      if (util.isValidId(x)) return true;
      c.warn(path + "[" + i + "]", "Ignored an invalid reference.", "ref.invalid");
      return false;
    });
  }

  /* Free-form detail values: text, numbers, booleans, lists and nested objects. */
  function freeForm(c, v, path, depth) {
    if (typeof v === "string") return str(c, v, path);
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "boolean") return v;
    if (v === null || v === undefined) return null;
    if (depth >= L.detailDepth) { c.warn(path, "Nested detail too deep; ignored.", "detail.depth"); return null; }
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
    if (kinds.has(kind)) c.error(path + ".kind", "Only one narrative of each kind is allowed.");
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
      c.warn("meta.timeBasis", "No time basis declared; assuming calendar minutes.", "time.basis");
      tb = {};
    }
    const unit = tb.unit === undefined ? "minute" : tb.unit;
    if (unit !== "minute") c.error("meta.timeBasis.unit", "Only \"minute\" is supported as the timing unit.");
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
    if (!model.lanes.length) c.error(path + ".lanes", "A model needs at least one swimlane.");

    const nodeIds = new Set();
    const nodes = arr(c, m.nodes, path + ".nodes", L.nodesPerModel);
    if (!nodes.length) c.error(path + ".nodes", "A model needs at least one step.");
    nodes.forEach((n, j) => {
      const np = path + ".nodes[" + j + "]";
      const node = obj(c, n, np, true);
      knownKeys(c, node, np, ["id", "label", "sub", "semanticType", "laneId", "sourceIds", "details",
        "tags", "measures", "provenance", "lineage", "removed"]);
      const semanticType = typeof node.semanticType === "string" ? node.semanticType : "task";
      if (!schema.SEMANTIC_TYPES[semanticType]) {
        c.warn(np + ".semanticType", "Step type \"" + semanticType.slice(0, 60) +
          "\" is not supported. It is shown as a generic step and is not replayed.", "semantic.unsupported");
      } else if (!schema.SEMANTIC_TYPES[semanticType].replay) {
        c.warn(np + ".semanticType", schema.SEMANTIC_TYPES[semanticType].label +
          " is shown, but its execution semantics are not replayed.", "semantic.limited", "info");
      }
      const laneId = typeof node.laneId === "string" ? node.laneId : "";
      if (!laneIds.has(laneId)) c.error(np + ".laneId", "Unknown swimlane \"" + String(node.laneId).slice(0, 60) + "\".");
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

  function sanitizeScenario(c, raw, i, scenarioIds, modelsById) {
    const path = "scenarios[" + i + "]";
    const s = obj(c, raw, path, true);
    knownKeys(c, s, path, ["id", "name", "statusLabel", "statusTone", "provenance", "summary", "attributes",
      "timing", "runs", "measures", "economics"]);
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
      if (!model) { c.error(rp, "Run refers to an unknown model."); return; }
      const r = obj(c, runs[modelId], rp);
      knownKeys(c, r, rp, ["visits", "transitions", "membership", "pauseAt", "milestones"]);
      const nodeIds = new Set(model.nodes.map(n => n.id));
      const edgeById = new Map(model.edges.map(e => [e.id, e]));
      const visitIds = new Set();
      const visitNode = new Map();
      const membership = {};
      const mem = obj(c, r.membership, rp + ".membership");
      Object.keys(mem).forEach(nodeId => {
        if (!nodeIds.has(nodeId)) { c.warn(rp + ".membership." + nodeId, "Membership for an unknown step was ignored.", "ref.dangling"); return; }
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
          c.warn(vp, "Visit to a step marked Not in scenario was ignored.", "membership.conflict");
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
        c.warn(rp + ".transitions", "No transitions were supplied, so they were derived from visit timing and the connectors. Check loops and exclusive decisions.", "transitions.derived", "info");
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
        if (!modelsById.has(k)) { c.warn(mp + ".values." + k, "Value for an unknown model was ignored.", "ref.dangling"); return; }
        values[k] = num(c, vals[k], mp + ".values." + k);
      });
      const st = obj(c, me.suppliedText, mp + ".suppliedText");
      Object.keys(st).forEach(k => { if (modelsById.has(k)) suppliedText[k] = str(c, st[k], mp + ".suppliedText." + k, { max: 200 }); });
      return {
        key: str(c, me.key, mp + ".key", { max: 80 }) || "measure-" + j,
        label: str(c, me.label, mp + ".label", { max: 200 }) || String(me.key || "Measure"),
        unit,
        values, suppliedText,
        status: ["supplied", "calculated", "validated"].includes(me.status) ? me.status : "supplied",
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
        if (!modelsById.has(v)) { c.error(p, "Refers to an unknown model."); return null; }
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
    return scenario;
  }

  const AI_KEYS = ["inputStructure", "dataAvailability", "judgment", "exceptions", "authority",
    "humanReview", "auditability", "failureHandling"];

  function sanitizeRecord(c, raw, i, ids, nodeIndex, modelsById) {
    const path = "records[" + i + "]";
    const r = obj(c, raw, path, true);
    knownKeys(c, r, path, ["id", "kind", "title", "description", "owner", "status", "priority", "linkedModelId",
      "linkedModelVersion", "linkedNodeIds", "evidenceRefs", "sensitive", "includeInHandoff", "opportunity",
      "generated", "createdAt", "updatedAt"]);
    const linkedModelId = r.linkedModelId && modelsById.has(r.linkedModelId) ? r.linkedModelId : null;
    if (r.linkedModelId && !linkedModelId) c.warn(path + ".linkedModelId", "Linked model not found; link removed.", "ref.dangling");
    const linkedNodeIds = idList(c, r.linkedNodeIds, path + ".linkedNodeIds").filter(id => {
      const ok = linkedModelId ? nodeIndex.get(linkedModelId).has(id) : [...nodeIndex.values()].some(s => s.has(id));
      if (!ok) c.warn(path + ".linkedNodeIds", "Linked step \"" + id + "\" not found; link removed.", "ref.dangling");
      return ok;
    });
    const record = {
      id: idOf(c, r.id, path + ".id", ids),
      kind: en(c, r.kind, "recordKind", path + ".kind", { fallback: "note" }),
      title: str(c, r.title, path + ".title", { max: 300 }).trim() || "Untitled record",
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
      c.error("", "The file does not contain a BPMVIZ engagement object.");
      return { ok: false, errors: c.errors, warnings: c.warnings, engagement: null };
    }
    if (input.schema !== schema.SCHEMA_ID) {
      c.error("schema", "This is not a BPMVIZ engagement file (expected schema \"" + schema.SCHEMA_ID + "\"). " +
        "Legacy .js configurations can be converted with tools/convert-legacy.mjs.");
      return { ok: false, errors: c.errors, warnings: c.warnings, engagement: null };
    }
    const migrated = migrate.migrateEngagement(input);
    if (migrated.error) {
      c.error("schemaVersion", migrated.error);
      return { ok: false, errors: c.errors, warnings: c.warnings, engagement: null };
    }
    migrated.notes.forEach(n => c.warn("schemaVersion", n, "migration", "info"));
    const raw = migrated.engagement;
    knownKeys(c, raw, "", ["schema", "schemaVersion", "id", "revision", "createdAt", "updatedAt", "meta",
      "milestones", "models", "scenarios", "records", "evidence", "assumptions", "narratives", "migration"]);

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
      c.error("models", "An engagement needs a current-state model.");
    }
    const modelsById = new Map(out.models.map(m => [m.id, m]));
    out.models.forEach((m, i) => {
      if (!m.basedOn) return;
      const base = modelsById.get(m.basedOn.modelId);
      if (!base) { c.error("models[" + i + "].basedOn.modelId", "Based on an unknown model."); return; }
      const baseIds = new Set(base.nodes.map(n => n.id));
      m.nodes.forEach((n, j) => {
        if (n.lineage && n.lineage.baselineNodeId && !baseIds.has(n.lineage.baselineNodeId)) {
          c.error("models[" + i + "].nodes[" + j + "].lineage.baselineNodeId", "Lineage points to a step that is not in the baseline.");
        }
      });
    });

    const scenarioIds = new Set();
    arr(c, raw.scenarios, "scenarios", L.scenarios).forEach((s, i) =>
      out.scenarios.push(sanitizeScenario(c, s, i, scenarioIds, modelsById)));

    const evidenceIds = new Set();
    arr(c, raw.evidence, "evidence", L.evidence).forEach((e, i) => out.evidence.push(sanitizeEvidence(c, e, i, evidenceIds)));

    const nodeIndex = new Map(out.models.map(m => [m.id, new Set(m.nodes.map(n => n.id))]));
    const recordIds = new Set();
    arr(c, raw.records, "records", L.records).forEach((r, i) => out.records.push(sanitizeRecord(c, r, i, recordIds, nodeIndex, modelsById)));

    const assumptionIds = new Set();
    arr(c, raw.assumptions, "assumptions", L.assumptions).forEach((a, i) => out.assumptions.push(sanitizeAssumption(c, a, i, assumptionIds)));

    const narrativeKinds = new Set();
    arr(c, raw.narratives, "narratives", L.narratives).forEach((n, i) => out.narratives.push(sanitizeNarrative(c, n, i, narrativeKinds)));

    // Evidence references must resolve.
    const dropDangling = (list, path) => list.filter(id => {
      if (evidenceIds.has(id)) return true;
      c.warn(path, "Evidence reference \"" + id + "\" not found; reference removed.", "ref.dangling");
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

    if (c.ignored.length) {
      c.warn("", "Ignored " + c.ignored.length + " unrecognized field" + (c.ignored.length === 1 ? "" : "s") + ": " +
        c.ignored.slice(0, 8).join(", ") + (c.ignored.length > 8 ? ", ..." : "") + ".", "fields.ignored", "info");
    }

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
            " steps have no recorded provenance.", "evidence.coverage", "info");
        }
      });
    }

    const ok = c.errors.length === 0;
    return { ok, errors: c.errors, warnings: c.warnings, engagement: ok ? out : null };
  }

  /** Parses JSON text with a size limit, then validates it. */
  function parseEngagementText(text) {
    if (typeof text !== "string") {
      return { ok: false, errors: [{ path: "", message: "The file could not be read as text." }], warnings: [], engagement: null };
    }
    if (text.length > L.fileBytes) {
      return { ok: false, errors: [{ path: "", message: "The file is larger than the 10 MB limit." }], warnings: [], engagement: null };
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      return { ok: false, errors: [{ path: "", message: "The file is not valid JSON: " + String(err.message || err).slice(0, 200) }], warnings: [], engagement: null };
    }
    return validateEngagement(data);
  }

  return { validateEngagement, parseEngagementText };
});
