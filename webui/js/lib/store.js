/*
 * AIxRay store: the open engagement and the commands that change it.
 *
 * Every command is a business change: it increments the revision, stamps
 * updatedAt and can be undone. View state such as pan, zoom, selection and
 * the playhead lives outside the store and never creates a revision.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./util.js"), require("./schema.js"), require("./validate.js"), require("./goals.js"), require("./checkpoints.js"));
  } else {
    const B = root.AIxRay = root.AIxRay || {};
    B.store = factory(B.util, B.schema, B.validate, B.goals, B.checkpoints);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, schema, validate, goals, checkpoints) {
  "use strict";

  class StoreError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }

  const MAX_UNDO = 40;
  const DETAIL_KEYS = ["desc", "who", "owner", "authority", "systems", "inputs", "outputs", "activities",
    "pain", "controls", "risks", "exceptions", "escalation", "decisionRules", "audit", "kpis", "volume",
    "sla", "effort", "handoff", "dependencies", "note", "evidence", "assumptions", "confidence", "dataQuality"];

  function findModel(e, modelId) {
    const m = e.models.find(x => x.id === modelId);
    if (!m) throw new StoreError("not-found", "That process diagram no longer exists.");
    return m;
  }

  function findNode(model, nodeId) {
    const n = model.nodes.find(x => x.id === nodeId);
    if (!n) throw new StoreError("not-found", "Step not found.");
    return n;
  }

  function editableModel(e, modelId) {
    const m = findModel(e, modelId);
    if (m.locked) {
      throw new StoreError("locked", m.name + " is locked because a future state is based on it. Make your changes in the future state instead.");
    }
    return m;
  }

  function cleanText(value, max) {
    if (value == null) return "";
    return String(value).slice(0, max || schema.LIMITS.stringLength);
  }

  function enumValue(name, value, fallback) {
    return schema.ENUMS[name].includes(value) ? value : fallback;
  }

  function markModified(model, node) {
    if (model.role === "future" && node.lineage && node.lineage.change === "unchanged") {
      node.lineage.change = "modified";
    }
  }

  function measure(value) {
    if (value === null) return null;
    if (!value || !util.isFiniteNumber(Number(value.value))) return undefined;
    return { value: Number(value.value), unit: value.unit || "minute" };
  }

  function applyNodePatch(model, node, patch) {
    if (patch.label !== undefined) {
      const label = cleanText(patch.label, 300).trim();
      if (!label) throw new StoreError("invalid", "A step needs a name.");
      node.label = label;
    }
    if (patch.sub !== undefined) node.sub = cleanText(patch.sub, 300);
    if (patch.semanticType !== undefined && patch.semanticType !== null) {
      if (!schema.SEMANTIC_TYPES[patch.semanticType]) throw new StoreError("invalid", "Choose a step type from the list.");
      node.semanticType = patch.semanticType;
    }
    if (patch.laneId !== undefined) {
      if (!model.lanes.some(l => l.id === patch.laneId)) throw new StoreError("invalid", "Choose a lane from the list.");
      node.laneId = patch.laneId;
    }
    if (patch.details) {
      node.details = node.details || {};
      Object.keys(patch.details).forEach(k => {
        if (!DETAIL_KEYS.includes(k)) return;
        const v = patch.details[k];
        if (v === null || v === "") delete node.details[k];
        else node.details[k] = Array.isArray(v) ? v.map(x => cleanText(x, 2000)) : cleanText(v);
      });
    }
    if (patch.measures) {
      node.measures = node.measures || {};
      ["typicalDuration", "slaTarget", "touchEffort"].forEach(k => {
        if (!(k in patch.measures)) return;
        const m = measure(patch.measures[k]);
        if (m !== undefined) node.measures[k] = m;
      });
      if ("waitType" in patch.measures) node.measures.waitType = enumValue("waitType", patch.measures.waitType, "");
    }
    if (patch.provenance) {
      node.provenance = node.provenance || { source: "unknown", validation: "unvalidated", evidenceRefs: [], note: "" };
      const p = patch.provenance;
      if (p.source !== undefined) node.provenance.source = enumValue("provenanceSource", p.source, "unknown");
      if (p.validation !== undefined) node.provenance.validation = enumValue("validation", p.validation, "unvalidated");
      if (p.note !== undefined) node.provenance.note = cleanText(p.note, 4000);
      if (Array.isArray(p.evidenceRefs)) node.provenance.evidenceRefs = p.evidenceRefs.filter(util.isValidId);
    }
    if (patch.tags) {
      node.tags = node.tags || {};
      ["bottleneck", "agent", "humanReview", "optional", "sampled"].forEach(k => {
        if (k in patch.tags) node.tags[k] = patch.tags[k] === true;
      });
    }
    if (patch.rationale !== undefined && node.lineage) node.lineage.rationale = cleanText(patch.rationale, 4000);
    markModified(model, node);
  }

  function newRecord(e, input) {
    const now = util.nowIso();
    const kind = enumValue("recordKind", input.kind, "note");
    const title = cleanText(input.title, 300).trim();
    if (!title) throw new StoreError("invalid", "Give the finding a title.");
    const model = input.linkedModelId ? e.models.find(m => m.id === input.linkedModelId) : null;
    const linkedNodeIds = Array.isArray(input.linkedNodeIds) ? input.linkedNodeIds.filter(id =>
      model ? model.nodes.some(n => n.id === id) : e.models.some(m => m.nodes.some(n => n.id === id))) : [];
    const taken = new Set(e.records.map(r => r.id));
    let id = util.uid("rec");
    while (taken.has(id)) id = util.uid("rec");
    return {
      id, kind, title,
      description: cleanText(input.description),
      owner: cleanText(input.owner, 200),
      status: enumValue("recordStatus", input.status, "open"),
      priority: enumValue("priority", input.priority || "", ""),
      linkedModelId: model ? model.id : null,
      linkedModelVersion: model ? model.version : null,
      linkedNodeIds,
      evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs.filter(id => e.evidence.some(x => x.id === id)) : [],
      sensitive: input.sensitive === true,
      includeInHandoff: input.includeInHandoff !== false,
      opportunity: kind === "opportunity" ? opportunityFields(input.opportunity || {}, e, { linkedModelId: model ? model.id : null, linkedNodeIds }) : null,
      createdAt: now, updatedAt: now
    };
  }

  /*
   * wave, goalIds, valueCase and valueLines are kept only when given, so records written before
   * they existed keep their shape. valueCase goes through the validator's
   * sanitizer, which removes references that do not resolve.
   */
  function opportunityFields(o, e, record) {
    const ai = o.aiAssessment || {};
    const out = {
      intervention: enumValue("intervention", o.intervention || "", ""),
      simplerAlternative: cleanText(o.simplerAlternative, 4000),
      expectedBenefit: cleanText(o.expectedBenefit, 4000),
      affectedVolume: cleanText(o.affectedVolume, 500),
      effort: enumValue("effortSize", o.effort || "", ""),
      risk: cleanText(o.risk, 4000),
      dependencies: cleanText(o.dependencies, 4000),
      validationAction: cleanText(o.validationAction, 4000),
      aiAssessment: {
        inputStructure: cleanText(ai.inputStructure, 2000), dataAvailability: cleanText(ai.dataAvailability, 2000),
        judgment: cleanText(ai.judgment, 2000), exceptions: cleanText(ai.exceptions, 2000),
        authority: cleanText(ai.authority, 2000), humanReview: cleanText(ai.humanReview, 2000),
        auditability: cleanText(ai.auditability, 2000), failureHandling: cleanText(ai.failureHandling, 2000),
        mode: ["assist", "autonomous", ""].includes(ai.mode) ? ai.mode : ""
      }
    };
    if (o.wave !== undefined && o.wave !== null) out.wave = enumValue("wave", o.wave, "");
    if (o.goalIds !== undefined && o.goalIds !== null) out.goalIds = goals.cleanGoalIds(o.goalIds, e);
    if (o.valueCase !== undefined && o.valueCase !== null) {
      const r = validate.sanitizeValueCase(o.valueCase, e, record);
      if (r.errors.length) throw new StoreError("invalid", "Business case: " + r.errors[0].message);
      out.valueCase = r.value;
    }
    if (o.valueLines !== undefined && o.valueLines !== null) {
      if (!Array.isArray(o.valueLines)) throw new StoreError("invalid", "Value lines must be a list.");
      out.valueLines = validate.sanitizeValueLines(o.valueLines).lines;
    }
    if (o.investment !== undefined && o.investment !== null) {
      if (typeof o.investment !== "object" || Array.isArray(o.investment)) throw new StoreError("invalid", "The investment settings must be an object.");
      out.investment = validate.sanitizeInvestment(o.investment);
    }
    if (o.ranges !== undefined && o.ranges !== null) {
      if (typeof o.ranges !== "object" || Array.isArray(o.ranges)) throw new StoreError("invalid", "The low and high values must be an object.");
      out.ranges = validate.sanitizeRanges(o.ranges);
    }
    return out;
  }

  /* Drops review items and entries that point at something that no longer exists. */
  function pruneReviewRefs(e, gone) {
    (e.reviewPacks || []).forEach(p => { p.items = p.items.filter(it => !gone(it.itemRef)); });
    (e.reviews || []).forEach(r => { r.entries = r.entries.filter(it => !gone(it.itemRef)); });
  }

  function nextColumn(model, fromId, toId) {
    const pres = model.presentation.nodes;
    const fx = pres[fromId] ? pres[fromId].x : 0;
    const tx = pres[toId] ? pres[toId].x : fx + 1;
    return tx > fx ? (fx + tx) / 2 : fx + 0.5;
  }

  const COMMANDS = {
    "meta/update"(e, p) {
      const patch = p.patch || {};
      const m = e.meta;
      ["clientDisplayName", "engagementName", "processName", "disclosure", "summary"].forEach(k => {
        if (patch[k] !== undefined) m[k] = cleanText(patch[k], k === "summary" || k === "disclosure" ? 4000 : 200);
      });
      if (patch.confidentiality !== undefined) m.confidentiality = enumValue("confidentiality", patch.confidentiality, m.confidentiality);
      if (patch.dataStatus !== undefined) m.dataStatus = enumValue("dataStatus", patch.dataStatus, m.dataStatus);
      if (patch.currency !== undefined && /^[A-Z]{3}$/.test(patch.currency)) m.currency = patch.currency;
      if (patch.timeBasis) {
        if (patch.timeBasis.calendar !== undefined) m.timeBasis.calendar = enumValue("timeCalendar", patch.timeBasis.calendar, m.timeBasis.calendar);
        const perDay = Number(patch.timeBasis.businessMinutesPerDay);
        if (patch.timeBasis.businessMinutesPerDay !== undefined) {
          if (!(perDay >= 1 && perDay <= 1440)) throw new StoreError("invalid", "A business day must be between 1 and 1,440 minutes.");
          m.timeBasis.businessMinutesPerDay = perDay;
        }
      }
      if (!m.processName.trim()) m.processName = "Untitled process";
      return {};
    },

    "node/update"(e, p) {
      const model = editableModel(e, p.modelId);
      const node = findNode(model, p.nodeId);
      applyNodePatch(model, node, p.patch || {});
      return { nodeId: node.id };
    },

    "record/add"(e, p) {
      const record = newRecord(e, p.record || {});
      e.records.push(record);
      return { id: record.id };
    },

    "record/update"(e, p) {
      const r = e.records.find(x => x.id === p.id);
      if (!r) throw new StoreError("not-found", "That finding no longer exists.");
      const merged = newRecord(e, Object.assign({}, r, p.patch || {},
        { opportunity: Object.assign({}, r.opportunity || {}, (p.patch || {}).opportunity || {}) }));
      merged.id = r.id;
      merged.createdAt = r.createdAt;
      Object.keys(merged).forEach(k => { r[k] = merged[k]; });
      const reviewed = (p.patch || {}).aiReviewed;
      if (r.generated && typeof reviewed === "boolean" && reviewed !== r.generated.reviewed) {
        r.generated.reviewed = reviewed;
        r.generated.reviewedAt = reviewed ? merged.updatedAt : "";
      }
      return { id: r.id };
    },

    "record/delete"(e, p) {
      const before = e.records.length;
      e.records = e.records.filter(r => r.id !== p.id);
      if (e.records.length === before) throw new StoreError("not-found", "That finding no longer exists.");
      pruneReviewRefs(e, ref => ref === "record/" + p.id);
      if (Array.isArray(e.checkpoints)) e.checkpoints = e.checkpoints.filter(c => c.recordId !== p.id);
      return { id: p.id };
    },

    "evidence/add"(e, p) {
      const input = p.evidence || {};
      const title = cleanText(input.title, 300).trim();
      if (!title) throw new StoreError("invalid", "Give the source a title.");
      let link = null;
      if (input.link) {
        link = util.safeHttpUrl(String(input.link));
        if (!link) throw new StoreError("invalid", "Links must start with http:// or https://.");
      }
      const taken = new Set(e.evidence.map(x => x.id));
      let id = util.uid("ev");
      while (taken.has(id)) id = util.uid("ev");
      e.evidence.push({
        id, title, locator: cleanText(input.locator, 500), extractedFact: cleanText(input.extractedFact),
        status: enumValue("evidenceStatus", input.status, "unreviewed"),
        reviewer: cleanText(input.reviewer, 200), reviewDate: cleanText(input.reviewDate, 40), link
      });
      return { id };
    },

    "evidence/update"(e, p) {
      const ev = e.evidence.find(x => x.id === p.id);
      if (!ev) throw new StoreError("not-found", "That source no longer exists.");
      const patch = p.patch || {};
      if (patch.title !== undefined) {
        const t = cleanText(patch.title, 300).trim();
        if (!t) throw new StoreError("invalid", "Give the source a title.");
        ev.title = t;
      }
      ["locator", "extractedFact", "reviewer", "reviewDate"].forEach(k => {
        if (patch[k] !== undefined) ev[k] = cleanText(patch[k], k === "extractedFact" ? undefined : 500);
      });
      if (patch.status !== undefined) ev.status = enumValue("evidenceStatus", patch.status, ev.status);
      if (patch.link !== undefined) {
        if (!patch.link) ev.link = null;
        else {
          const link = util.safeHttpUrl(String(patch.link));
          if (!link) throw new StoreError("invalid", "Links must start with http:// or https://.");
          ev.link = link;
        }
      }
      return { id: ev.id };
    },

    "evidence/delete"(e, p) {
      e.evidence = e.evidence.filter(x => x.id !== p.id);
      e.records.forEach(r => { r.evidenceRefs = r.evidenceRefs.filter(id => id !== p.id); });
      e.models.forEach(m => {
        m.sourceRefs = m.sourceRefs.filter(id => id !== p.id);
        m.nodes.forEach(n => { n.provenance.evidenceRefs = n.provenance.evidenceRefs.filter(id => id !== p.id); });
      });
      (e.reviews || []).forEach(r => { if (r.applied && r.applied.evidenceId === p.id) r.applied.evidenceId = null; });
      return { id: p.id };
    },

    "assumption/set"(e, p) {
      const def = schema.DRIVERS.find(d => d.key === p.key);
      if (!def && !p.label) throw new StoreError("invalid", "Unknown assumption.");
      let a = e.assumptions.find(x => x.key === p.key);
      const value = p.value === null || p.value === "" ? null : Number(p.value);
      if (value !== null && !Number.isFinite(value)) throw new StoreError("invalid", "Enter a number.");
      if (value !== null && value < 0) throw new StoreError("invalid", "Enter zero or a positive number.");
      if (!a) {
        a = { id: util.uniqueId("as-" + util.slug(p.key), new Set(e.assumptions.map(x => x.id))), key: p.key,
          label: def ? def.label : cleanText(p.label, 300), value: null, unit: def ? def.unit : (p.unit || "count"),
          status: "illustrative", source: "", note: "" };
        e.assumptions.push(a);
      }
      a.value = value;
      if (p.status !== undefined) a.status = enumValue("assumptionStatus", p.status, a.status);
      if (p.source !== undefined) a.source = cleanText(p.source, 500);
      if (p.note !== undefined) a.note = cleanText(p.note, 2000);
      return { key: p.key };
    },

    "scenario/override"(e, p) {
      const s = e.scenarios.find(x => x.id === p.scenarioId);
      if (!s) throw new StoreError("not-found", "That scenario no longer exists.");
      s.economics = s.economics || { beforeModelId: null, afterModelId: null,
        supplied: { beforeCostPerCase: null, afterCostPerCase: null, costSavedPerCase: null, fteCapacity: null, text: {} }, overrides: {} };
      if (p.value === null || p.value === "") delete s.economics.overrides[p.key];
      else {
        const v = Number(p.value);
        if (!Number.isFinite(v) || v < 0) throw new StoreError("invalid", "Enter zero or a positive number.");
        s.economics.overrides[p.key] = { value: v, status: enumValue("assumptionStatus", p.status, "supplied"), note: cleanText(p.note, 1000) };
      }
      return { scenarioId: s.id };
    },

    "measure/set"(e, p) {
      const s = e.scenarios.find(x => x.id === p.scenarioId);
      if (!s) throw new StoreError("not-found", "That scenario no longer exists.");
      findModel(e, p.modelId);
      let m = s.measures.find(x => x.key === p.key);
      if (!m) {
        m = { key: p.key, label: cleanText(p.label || p.key, 200), unit: p.unit || "count", values: {}, suppliedText: {}, status: "supplied", note: "" };
        s.measures.push(m);
      }
      const value = p.value === null || p.value === "" ? null : Number(p.value);
      if (value !== null && (!Number.isFinite(value) || value < 0)) throw new StoreError("invalid", "Enter zero or a positive number.");
      m.values[p.modelId] = value;
      m.status = "supplied";
      return { key: m.key };
    },

    "model/clone"(e, p) {
      const source = findModel(e, p.sourceModelId);
      const taken = new Set(e.models.map(m => m.id));
      const id = util.uniqueId("m-future-draft", taken);
      const copy = util.clone(source);
      copy.id = id;
      copy.role = "future";
      copy.status = "draft";
      copy.locked = false;
      copy.version = 1;
      copy.name = cleanText(p.name, 200).trim() || "Future state";
      copy.basedOn = { modelId: source.id, version: source.version };
      delete copy.generated;
      copy.nodes.forEach(n => { n.lineage = { baselineNodeId: n.id, change: "unchanged", rationale: "" }; n.removed = false; });
      copy.edges.forEach(ed => { ed.lineage = { change: "unchanged", rationale: "" }; ed.removed = false; });
      source.locked = true;
      e.models.push(copy);
      return { modelId: id };
    },

    "model/rename"(e, p) {
      const m = findModel(e, p.modelId);
      const name = cleanText(p.name, 200).trim();
      if (!name) throw new StoreError("invalid", "Enter a name.");
      m.name = name;
      return { modelId: m.id };
    },

    "model/setStatus"(e, p) {
      const m = findModel(e, p.modelId);
      if (m.role !== "future") throw new StoreError("invalid", "Only a future state can change status.");
      m.status = enumValue("modelStatus", p.status, m.status);
      return { modelId: m.id };
    },

    "model/delete"(e, p) {
      const m = findModel(e, p.modelId);
      if (m.role !== "future" || !m.basedOn) throw new StoreError("invalid", "Only a future state planned from the current state can be deleted.");
      e.models = e.models.filter(x => x.id !== m.id);
      const base = e.models.find(x => x.id === m.basedOn.modelId);
      if (base && !e.models.some(x => x.basedOn && x.basedOn.modelId === base.id)) base.locked = false;
      const live = new Set(e.models.flatMap(x => x.nodes.map(n => n.id)));
      e.records.forEach(r => {
        if (r.linkedModelId === m.id) { r.linkedModelId = null; r.linkedNodeIds = []; }
        const vc = r.opportunity && r.opportunity.valueCase;
        if (vc) {
          if (vc.modelId === m.id) vc.modelId = null;
          vc.nodeIds = vc.nodeIds.filter(id => live.has(id));
        }
      });
      e.scenarios.forEach(s => { delete s.runs[m.id]; });
      // Event logs mapped to the deleted draft stay, detached from any model.
      (e.datasets || []).forEach(d => { if (d.modelId === m.id) d.modelId = null; });
      (e.reviewPacks || []).forEach(pk => { if (pk.modelId === m.id) pk.modelId = null; });
      pruneReviewRefs(e, ref => ref.indexOf("step/" + m.id + "/") === 0);
      return { modelId: m.id };
    },

    "model/insertStep"(e, p) {
      const model = editableModel(e, p.modelId);
      if (model.role !== "future") throw new StoreError("invalid", "You can add steps to a future state only.");
      const edge = model.edges.find(x => x.id === p.edgeId && !x.removed);
      if (!edge) throw new StoreError("not-found", "Choose the connector to insert the step on.");
      const label = cleanText(p.label, 300).trim();
      if (!label) throw new StoreError("invalid", "A step needs a name.");
      const from = findNode(model, edge.from);
      const laneId = p.laneId && model.lanes.some(l => l.id === p.laneId) ? p.laneId : from.laneId;
      const nodeIds = new Set(model.nodes.map(n => n.id));
      const id = util.uniqueId(util.slug(label), nodeIds);
      const oldTo = edge.to;
      model.presentation.nodes[id] = { x: nextColumn(model, edge.from, oldTo) };
      model.nodes.push({
        id, label, sub: "", semanticType: schema.SEMANTIC_TYPES[p.semanticType] ? p.semanticType : "task",
        laneId, sourceIds: [], details: { desc: cleanText(p.description) },
        tags: { bottleneck: false, agent: false, humanReview: false, optional: false, sampled: false },
        measures: { typicalDuration: null, slaTarget: null, touchEffort: null, waitType: "" },
        provenance: { source: enumValue("provenanceSource", p.provenanceSource, "workshop"), validation: "unvalidated", evidenceRefs: [], note: "" },
        lineage: { baselineNodeId: null, change: "added", rationale: cleanText(p.rationale, 4000) },
        removed: false
      });
      edge.to = id;
      if (edge.lineage && edge.lineage.change === "unchanged") edge.lineage.change = "modified";
      const edgeIds = new Set(model.edges.map(x => x.id));
      model.edges.push({
        id: util.uniqueId("e-" + id + "-" + oldTo, edgeIds), from: id, to: oldTo, label: "",
        semanticType: "sequence", dashed: false, emphasis: "", removed: false,
        lineage: { change: "added", rationale: "" }
      });
      return { nodeId: id, tailEdgeId: model.edges[model.edges.length - 1].id };
    },

    "model/removeStep"(e, p) {
      const model = editableModel(e, p.modelId);
      if (model.role !== "future") throw new StoreError("invalid", "You can remove steps from a future state only.");
      const node = findNode(model, p.nodeId);
      if (schema.typeInfo(node.semanticType).shape === "start") throw new StoreError("invalid", "The start event cannot be removed.");
      if (node.removed) return { nodeId: node.id };
      node.removed = true;
      node.lineage = node.lineage || { baselineNodeId: null, change: "removed", rationale: "" };
      node.lineage.change = "removed";
      node.lineage.rationale = cleanText(p.rationale, 4000);
      const incoming = model.edges.filter(x => x.to === node.id && !x.removed);
      const outgoing = model.edges.filter(x => x.from === node.id && !x.removed);
      incoming.concat(outgoing).forEach(x => { x.removed = true; });
      const edgeIds = new Set(model.edges.map(x => x.id));
      incoming.forEach(inEdge => outgoing.forEach(outEdge => {
        if (inEdge.from === outEdge.to) return;
        if (model.edges.some(x => !x.removed && x.from === inEdge.from && x.to === outEdge.to)) return;
        model.edges.push({
          id: util.uniqueId("e-" + inEdge.from + "-" + outEdge.to, edgeIds), from: inEdge.from, to: outEdge.to,
          label: inEdge.label || outEdge.label || "", semanticType: inEdge.semanticType, dashed: inEdge.dashed,
          emphasis: "", removed: false, lineage: { change: "added", rationale: "Bypasses removed step " + node.label }
        });
      }));
      e.records.forEach(r => {
        if (r.linkedModelId === model.id && r.linkedNodeIds.includes(node.id)) r.updatedAt = util.nowIso();
      });
      return { nodeId: node.id };
    },

    "model/addLane"(e, p) {
      const model = editableModel(e, p.modelId);
      if (model.role !== "future") throw new StoreError("invalid", "You can add lanes to a future state only.");
      const name = cleanText(p.name, 200).trim();
      if (!name) throw new StoreError("invalid", "Give the lane a name.");
      const id = util.uniqueId(util.slug(name), new Set(model.lanes.map(l => l.id)));
      model.lanes.push({ id, name, role: cleanText(p.role, 300), type: enumValue("laneType", p.type, "human") });
      return { laneId: id };
    },

    "record/markReviewed"(e, p) {
      const ids = new Set(Array.isArray(p.ids) ? p.ids : []);
      const now = util.nowIso();
      let count = 0;
      e.records.forEach(r => {
        if (!ids.has(r.id) || !r.generated) return;
        r.generated.reviewed = p.reviewed !== false;
        r.generated.reviewedAt = r.generated.reviewed ? now : "";
        r.updatedAt = now;
        count++;
      });
      return { count };
    },

    "model/markReviewed"(e, p) {
      const m = findModel(e, p.modelId);
      if (!m.generated) throw new StoreError("invalid", "This wasn't drafted with AI.");
      m.generated.reviewed = true;
      m.generated.reviewedAt = util.nowIso();
      return { modelId: m.id };
    },

    "narrative/set"(e, p) {
      e.narratives = e.narratives || [];
      const kind = enumValue("narrativeKind", p.kind, "executive-summary");
      const text = cleanText(p.text, 12000).trim();
      if (!text) throw new StoreError("invalid", "Write the summary text first.");
      const now = util.nowIso();
      let n = e.narratives.find(x => x.kind === kind);
      if (!n) {
        n = { id: util.uniqueId("nar-" + kind, new Set(e.narratives.map(x => x.id))), kind, title: "", text: "", status: "draft", createdAt: now, updatedAt: now };
        e.narratives.push(n);
      }
      n.title = cleanText(p.title, 300);
      n.text = text;
      n.status = enumValue("narrativeStatus", p.status, "draft");
      n.updatedAt = now;
      if (p.generated) n.generated = Object.assign({}, p.generated, { reviewed: false, reviewedAt: "" });
      if (n.generated && (n.status === "reviewed") !== n.generated.reviewed) {
        n.generated.reviewed = n.status === "reviewed";
        n.generated.reviewedAt = n.generated.reviewed ? now : "";
      }
      return { id: n.id };
    },

    "narrative/review"(e, p) {
      const n = (e.narratives || []).find(x => x.kind === p.kind);
      if (!n) throw new StoreError("not-found", "No summary to review.");
      n.status = "reviewed";
      n.updatedAt = util.nowIso();
      if (n.generated) { n.generated.reviewed = true; n.generated.reviewedAt = n.updatedAt; }
      return { id: n.id };
    },

    "narrative/delete"(e, p) {
      e.narratives = (e.narratives || []).filter(x => x.kind !== p.kind);
      return { kind: p.kind };
    },

    /* Renames an event log, or changes its role, comparison, data status or notes. */
    "dataset/update"(e, p) {
      const d = (e.datasets || []).find(x => x.id === p.id);
      if (!d) throw new StoreError("not-found", "Event log not found.");
      const patch = p.patch || {};
      if (patch.name !== undefined) {
        const name = cleanText(patch.name, 200).trim();
        if (!name) throw new StoreError("invalid", "Give the event log a name.");
        d.name = name;
      }
      if (patch.role !== undefined) d.role = enumValue("datasetRole", patch.role, d.role);
      if (patch.dataStatus !== undefined) d.dataStatus = enumValue("dataStatus", patch.dataStatus, d.dataStatus);
      if (patch.notes !== undefined) d.notes = cleanText(patch.notes, 4000);
      if (patch.comparesToDatasetId !== undefined) {
        const target = patch.comparesToDatasetId;
        if (target === null || target === "") d.comparesToDatasetId = null;
        else {
          if (target === d.id) throw new StoreError("invalid", "Choose a different event log to compare with.");
          if (!e.datasets.some(x => x.id === target)) throw new StoreError("not-found", "The event log to compare with no longer exists.");
          d.comparesToDatasetId = target;
        }
        // A comparison group belongs to the comparison: it goes when the comparison does, or when it would compare a log with itself.
        const g = d.comparisonGroup;
        if (g && (!d.comparesToDatasetId || g.baselineId === d.comparesToDatasetId || g.afterId === d.comparesToDatasetId)) delete d.comparisonGroup;
      }
      if (patch.comparisonGroup !== undefined) {
        const g = patch.comparisonGroup;
        if (g === null) delete d.comparisonGroup;
        else {
          if (typeof g !== "object" || Array.isArray(g)) throw new StoreError("invalid", "A comparison group names two event logs.");
          const ids = [g.baselineId, g.afterId];
          if (ids.some(x => !e.datasets.some(y => y.id === x))) throw new StoreError("not-found", "An event log for the comparison group no longer exists.");
          if (ids[0] === ids[1]) throw new StoreError("invalid", "Choose two different event logs for the comparison group, one from before the change and one from after.");
          if (ids.some(x => x === d.id || x === d.comparesToDatasetId)) throw new StoreError("invalid", "A comparison group comes from a team that did not get the change, so it cannot use the logs being compared.");
          d.comparisonGroup = { baselineId: ids[0], afterId: ids[1] };
        }
      }
      return { id: d.id };
    },

    /*
     * Deletes an event log. Scenarios made from it are deleted too when
     * removeScenarios is true; otherwise they stay without the link.
     */
    "dataset/delete"(e, p) {
      const list = e.datasets || [];
      const d = list.find(x => x.id === p.id);
      if (!d) throw new StoreError("not-found", "Event log not found.");
      e.datasets = list.filter(x => x.id !== d.id);
      e.datasets.forEach(x => {
        const g = x.comparisonGroup;
        if (x.comparesToDatasetId === d.id) { x.comparesToDatasetId = null; delete x.comparisonGroup; }
        if (g && (g.baselineId === d.id || g.afterId === d.id)) delete x.comparisonGroup;
      });
      const made = new Set(d.scenarioIds.concat(e.scenarios.filter(s => s.observedFrom && s.observedFrom.datasetId === d.id).map(s => s.id)));
      let removed = 0;
      if (p.removeScenarios === true) {
        const before = e.scenarios.length;
        e.scenarios = e.scenarios.filter(s => !made.has(s.id));
        removed = before - e.scenarios.length;
        e.datasets.forEach(x => { x.scenarioIds = x.scenarioIds.filter(id => !made.has(id)); });
      } else {
        e.scenarios.forEach(s => { if (s.observedFrom && s.observedFrom.datasetId === d.id) delete s.observedFrom; });
      }
      e.records.forEach(r => {
        const vc = r.opportunity && r.opportunity.valueCase;
        if (vc && vc.datasetId === d.id) vc.datasetId = null;
      });
      return { id: d.id, scenariosRemoved: removed };
    },

    /*
     * AI suggestions become records in one step, each marked as an AI draft.
     * Value cases drafted for existing opportunities are added in the same
     * step, marked aiDraft, and never replace a value case a person entered.
     */
    "ai/applySuggestions"(e, p) {
      const records = Array.isArray(p.records) ? p.records : [];
      const valueCases = Array.isArray(p.valueCases) ? p.valueCases : [];
      if (!records.length && !valueCases.length) throw new StoreError("invalid", "Select at least one suggestion to add.");
      const ids = [];
      records.forEach(input => {
        const record = newRecord(e, input);
        record.generated = Object.assign({}, p.stamp || {}, { reviewed: false, reviewedAt: "" });
        e.records.push(record);
        ids.push(record.id);
      });
      const sized = [];
      valueCases.forEach(item => {
        const r = e.records.find(x => x.id === (item && item.recordId) && x.kind === "opportunity");
        if (!r || !r.opportunity) throw new StoreError("not-found", "An opportunity in this proposal no longer exists.");
        if (r.opportunity.valueCase && r.opportunity.valueCase.aiDraft !== true) throw new StoreError("invalid", "\"" + r.title + "\" already has a business case a person entered, and it stays.");
        const v = validate.sanitizeValueCase(Object.assign({}, item.valueCase, { aiDraft: true, basis: "illustrative" }), e, r);
        if (v.errors.length) throw new StoreError("invalid", "Business case: " + v.errors[0].message);
        r.opportunity.valueCase = v.value;
        r.updatedAt = util.nowIso();
        sized.push(r.id);
      });
      return { ids, sized };
    },

    /*
     * An AI future-state change set becomes a draft in one step: clone the
     * baseline, add lanes, then modify, insert and remove steps. Lineage and
     * the baseline lock come from the ordinary commands.
     */
    "ai/applyFutureState"(e, p) {
      const ops = Array.isArray(p.operations) ? p.operations : [];
      if (!ops.length) throw new StoreError("invalid", "Select at least one change to apply.");
      const { modelId } = COMMANDS["model/clone"](e, { sourceModelId: p.baselineModelId, name: p.name || "AI future-state draft" });
      const model = findModel(e, modelId);
      model.notes = cleanText(p.summary, 4000);
      model.generated = Object.assign({}, p.stamp || {}, { reviewed: false, reviewedAt: "" });
      const laneMap = new Map();
      (Array.isArray(p.lanes) ? p.lanes : []).forEach(l => {
        const { laneId } = COMMANDS["model/addLane"](e, { modelId, name: l.name, role: l.role, type: l.type });
        laneMap.set(l.ref, laneId);
      });
      const lane = ref => {
        if (ref === null || ref === undefined || ref === "") return undefined;
        if (laneMap.has(ref)) return laneMap.get(ref);
        if (model.lanes.some(l => l.id === ref)) return ref;
        throw new StoreError("invalid", "Unknown lane " + ref + ".");
      };
      const patchOf = op => {
        const details = {};
        (op.details || []).forEach(d => { if (d && DETAIL_KEYS.includes(d.key)) details[d.key] = d.value; });
        if (op.description) details.desc = op.description;
        const measures = {};
        if (util.isFiniteNumber(op.touchEffortMinutes)) measures.touchEffort = { value: op.touchEffortMinutes, unit: "minute" };
        if (util.isFiniteNumber(op.typicalDurationMinutes)) measures.typicalDuration = { value: op.typicalDurationMinutes, unit: "minute" };
        const patch = { details, measures, rationale: op.rationale || "" };
        if (op.tags) patch.tags = op.tags;
        const laneId = lane(op.laneRef);
        if (laneId) patch.laneId = laneId;
        if (op.semanticType) patch.semanticType = op.semanticType;
        return patch;
      };
      const tails = new Map();
      ops.forEach(op => {
        if (op.op === "modify") {
          const node = findNode(model, op.nodeId);
          const patch = patchOf(op);
          if (op.label) patch.label = op.label;
          applyNodePatch(model, node, patch);
        } else if (op.op === "insert") {
          const target = tails.get(op.edgeId) || op.edgeId;
          const r = COMMANDS["model/insertStep"](e, { modelId, edgeId: target, label: op.label, laneId: lane(op.laneRef),
            semanticType: op.semanticType || "task", description: op.description, rationale: op.rationale, provenanceSource: "generated" });
          tails.set(op.edgeId, r.tailEdgeId);
          const patch = patchOf(op);
          delete patch.laneId;
          delete patch.semanticType;
          applyNodePatch(model, findNode(model, r.nodeId), patch);
        } else if (op.op === "remove") {
          COMMANDS["model/removeStep"](e, { modelId, nodeId: op.nodeId, rationale: op.rationale });
        } else {
          throw new StoreError("invalid", "Unknown change type " + op.op + ".");
        }
      });
      return { modelId };
    }
  };

  function createStore(initial) {
    let state = initial;
    const listeners = new Set();
    const undoStack = [];

    function emit(event) { listeners.forEach(fn => fn(state, event)); }

    function dispatch(type, payload) {
      const handler = COMMANDS[type];
      if (!handler) throw new StoreError("unknown", "Unknown command " + type);
      if (payload && payload.expectedRevision !== undefined && payload.expectedRevision !== state.revision) {
        throw new StoreError("stale", "The project changed. Review the proposal against the current revision before applying it.");
      }
      const draft = util.clone(state);
      const result = handler(draft, payload || {}) || {};
      // The original drawer controls also change graph structure. Their old
      // route timings cannot describe the new graph, even if IDs still exist.
      if (payload && (type === "model/insertStep" || type === "model/removeStep" || type === "node/update")) {
        const before = state.models.find(m => m.id === payload.modelId);
        const after = draft.models.find(m => m.id === payload.modelId);
        const topology = m => JSON.stringify([m.nodes.map(n => [n.id, n.semanticType, n.laneId, !!n.removed]),
          m.edges.map(ed => [ed.id, ed.from, ed.to, ed.semanticType, !!ed.removed])]);
        if (before && after && topology(before) !== topology(after)) {
          const affected = invalidateModelRuns(draft, after.id);
          if (affected.length) result.invalidatedScenarioIds = affected;
        }
      }
      undoStack.push(state);
      if (undoStack.length > MAX_UNDO) undoStack.shift();
      draft.revision = state.revision + 1;
      draft.updatedAt = util.nowIso();
      state = draft;
      emit({ type, payload, result });
      return result;
    }

    function undo() {
      if (!undoStack.length) return false;
      const previous = util.clone(undoStack.pop());
      previous.revision = state.revision + 1;
      previous.updatedAt = util.nowIso();
      state = previous;
      emit({ type: "undo" });
      return true;
    }

    function replace(engagement, reason) {
      state = engagement;
      undoStack.length = 0;
      emit({ type: "replace", reason });
    }

    return {
      get: () => state,
      dispatch, undo, replace,
      canUndo: () => undoStack.length > 0,
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
    };
  }

  Object.assign(COMMANDS, goals.commands(StoreError), checkpoints.commands(StoreError));

  /**
   * Adds commands from a feature module: { "area/verb"(draft, payload) { ... } }.
   * A name that is already taken throws, so two features cannot claim one command.
   */
  function registerCommands(defs) {
    if (!defs || typeof defs !== "object") throw new TypeError("registerCommands needs an object of command handlers.");
    const names = Object.keys(defs);
    names.forEach(name => {
      if (!/^[a-z][A-Za-z-]*\/[A-Za-z][A-Za-z-]*$/.test(name)) throw new TypeError("Command names look like area/verb: " + name);
      if (typeof defs[name] !== "function") throw new TypeError("Command " + name + " needs a handler function.");
      if (Object.prototype.hasOwnProperty.call(COMMANDS, name)) throw new Error("Command " + name + " is already registered.");
    });
    names.forEach(name => { COMMANDS[name] = defs[name]; });
    return names;
  }

  /** Keep independently supplied measures, but discard figures authored from an invalidated route. */
  function invalidateModelRuns(e, modelId) {
    const affected = [];
    e.scenarios.forEach(s => {
      if (s.runs && Object.prototype.hasOwnProperty.call(s.runs, modelId)) {
        delete s.runs[modelId];
        affected.push(s.id);
      }
      s.measures = (s.measures || []).filter(m => {
        if (m.key.startsWith("walkthroughEffort-") ||
          (["humanTouch", "cycleTime"].includes(m.key) && m.note === "Entered in the scenario editor.")) {
          delete m.values[modelId];
          if (m.suppliedText) delete m.suppliedText[modelId];
          return Object.keys(m.values).length > 0;
        }
        return true;
      });
    });
    return affected;
  }

  const helpers = { findModel, findNode, editableModel, applyNodePatch, newRecord, cleanText, enumValue, StoreError, invalidateModelRuns };

  return { createStore, StoreError, COMMANDS, DETAIL_KEYS, registerCommands, helpers };
});
