/*
 * AIxRay ai-results: the portable AI result file (schema "aixray.ai-result").
 *
 * An AI job (the command line, an agent skill or the local helper) writes one
 * of these files. The app opens it like an engagement, checks it here, lists
 * each proposed change for review and applies the ticked ones in one undoable
 * step. This module never talks to a network or to an AI service.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./util.js"), require("./schema.js"), require("./validate.js"),
      require("./store.js"), require("./exporting.js"));
  } else {
    const B = root.AIxRay = root.AIxRay || {};
    B.aiResults = factory(B.util, B.schema, B.validate, B.store, B.exporting);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, schema, validate, store, exporting) {
  "use strict";

  const RESULT_SCHEMA = "aixray.ai-result";
  const RESULT_VERSION = 1;
  const MAX_SUGGESTIONS = 60;
  const MAX_OPERATIONS = 200;
  const MAX_NEW_LANES = 10;
  const MAX_MINUTES = 525600;

  const SUGGESTION_KINDS = ["opportunity", "pain", "question"];
  const WARNING_CODES = ["source.instruction", "source.unreadable", "source.conflict", "source.gap", "assumption", "other"];
  const CONFIDENCE = ["low", "medium", "high"];
  const TASK_TYPES = Object.keys(schema.SEMANTIC_TYPES).filter(k =>
    schema.SEMANTIC_TYPES[k].shape === "task" && schema.SEMANTIC_TYPES[k].replay);

  /*
   * Payload schemas. Every object lists all of its properties as required and
   * allows no others, so the same schema works for Claude Code --json-schema
   * and for Codex --output-schema (OpenAI strict mode). Optional values are
   * nullable instead of absent.
   */
  const S = { type: "string" };
  const NULLABLE_S = { type: ["string", "null"] };
  const NULLABLE_N = { type: ["number", "null"] };
  const BOOL = { type: "boolean" };
  const IDS = { type: "array", items: S };

  function strict(properties) {
    return { type: "object", additionalProperties: false, required: Object.keys(properties), properties };
  }

  const OPPORTUNITY = strict({
    intervention: { type: "string", enum: schema.ENUMS.intervention },
    simplerAlternative: S, expectedBenefit: S, affectedVolume: S,
    effort: { type: "string", enum: schema.ENUMS.effortSize },
    risk: S, dependencies: S, validationAction: S
  });

  const TASK_SCHEMAS = {
    opportunities: strict({
      suggestions: {
        type: "array",
        items: strict({
          ref: S,
          kind: { type: "string", enum: SUGGESTION_KINDS },
          title: S, description: S,
          linkedModelId: NULLABLE_S, linkedNodeIds: IDS, basedOnRecordIds: IDS,
          priority: { type: "string", enum: schema.ENUMS.priority },
          opportunity: { anyOf: [OPPORTUNITY, { type: "null" }] },
          confidence: { type: "string", enum: CONFIDENCE },
          rationale: S
        })
      }
    }),
    "future-state": strict({
      name: S, summary: S,
      lanes: {
        type: "array",
        items: strict({ ref: S, name: S, role: S, type: { type: "string", enum: schema.ENUMS.laneType } })
      },
      operations: {
        type: "array",
        items: strict({
          op: { type: "string", enum: ["modify", "insert", "remove"] },
          nodeId: NULLABLE_S, edgeId: NULLABLE_S, label: NULLABLE_S, laneRef: NULLABLE_S,
          semanticType: { type: ["string", "null"], enum: TASK_TYPES.concat([null]) },
          details: { type: "array", items: strict({ key: { type: "string", enum: store.DETAIL_KEYS }, value: S }) },
          tags: { anyOf: [strict({ bottleneck: BOOL, agent: BOOL, humanReview: BOOL }), { type: "null" }] },
          touchEffortMinutes: NULLABLE_N, typicalDurationMinutes: NULLABLE_N,
          rationale: S, addressesRecordIds: IDS
        })
      }
    }),
    summary: strict({
      title: S, text: S,
      keyPoints: {
        type: "array",
        items: strict({ text: S, supportingRecordIds: IDS, supportingFigures: { type: "array", items: S } })
      },
      caveats: { type: "array", items: S }
    }),
    "log-mapping": strict({
      mappings: {
        type: "array",
        items: strict({
          activity: S, nodeId: NULLABLE_S,
          confidence: { type: "string", enum: CONFIDENCE },
          rationale: S
        })
      }
    })
  };

  const REPORT = {
    notes: S,
    warnings: { type: "array", items: strict({ code: { type: "string", enum: WARNING_CODES }, message: S, path: S }) }
  };

  /**
   * What the AI tool returns for a task: the payload with its notes and
   * warnings. An extraction writes the engagement to a file, so its answer is
   * the notes and warnings only.
   */
  function outputSchema(task) {
    return task === "extract" ? strict(REPORT) : strict(Object.assign({ payload: TASK_SCHEMAS[task] }, REPORT));
  }

  /* ---------- Shape checking against the payload schemas ---------- */

  function typeOk(t, v) {
    if (t === "null") return v === null;
    if (t === "array") return Array.isArray(v);
    if (t === "object") return util.isPlainObject(v);
    if (t === "number") return util.isFiniteNumber(v);
    if (t === "integer") return Number.isInteger(v);
    return typeof v === t;
  }

  function joinPath(path, key) {
    return path ? path + "." + key : key;
  }

  /* Checks value against a schema node. Missing and mistyped values are errors; extra keys are listed. */
  function checkShape(node, value, path, errors, extra) {
    if (errors.length >= 40) return;
    if (node.anyOf) {
      const fits = node.anyOf.some(n => { const e = []; checkShape(n, value, path, e, []); return !e.length; });
      if (!fits) {
        const objectForm = node.anyOf.find(n => n.type === "object");
        if (objectForm && util.isPlainObject(value)) checkShape(objectForm, value, path, errors, extra);
        else errors.push({ path, message: "Expected " + node.anyOf.map(n => [].concat(n.type).join(" or ")).join(" or ") + "." });
      }
      return;
    }
    const types = [].concat(node.type || []);
    if (types.length && !types.some(t => typeOk(t, value))) {
      errors.push({ path, message: "Expected " + types.join(" or ") + "." });
      return;
    }
    if (node.enum && !node.enum.includes(value)) {
      errors.push({ path, message: "Unexpected value \"" + String(value).slice(0, 60) + "\"." });
      return;
    }
    if (Array.isArray(value) && node.items) {
      value.forEach((v, i) => checkShape(node.items, v, path + "[" + i + "]", errors, extra));
    } else if (util.isPlainObject(value) && node.properties) {
      (node.required || []).forEach(k => {
        if (!Object.prototype.hasOwnProperty.call(value, k)) errors.push({ path: joinPath(path, k), message: "A value is required (use null or an empty list when there is none)." });
      });
      Object.keys(value).forEach(k => {
        if (node.properties[k]) checkShape(node.properties[k], value[k], joinPath(path, k), errors, extra);
        else extra.push(joinPath(path, k));
      });
    }
  }

  /* ---------- Small sanitizers ---------- */

  function text(v, max) {
    if (v === undefined || v === null) return "";
    return String(v).slice(0, max || 4000);
  }

  function ids(list) {
    return Array.isArray(list) ? [...new Set(list.filter(util.isValidId))].slice(0, 100) : [];
  }

  function enumOr(name, v, fallback) {
    return schema.ENUMS[name].includes(v) ? v : fallback;
  }

  function sanitizeGenerated(g) {
    const x = util.isPlainObject(g) ? g : {};
    return {
      tool: text(x.tool, 80),
      provider: enumOr("aiProvider", x.provider, "other"),
      model: text(x.model, 120),
      surface: enumOr("aiSurface", x.surface, "cli"),
      at: text(x.at, 40),
      jobId: text(x.jobId, 80),
      plan: enumOr("aiPlan", x.plan, "unknown")
    };
  }

  function sanitizeDataHandling(d) {
    const x = util.isPlainObject(d) ? d : {};
    return {
      confidentiality: enumOr("confidentiality", x.confidentiality, "client-confidential"),
      dataStatus: enumOr("dataStatus", x.dataStatus, "supplied"),
      approvalConfirmed: x.approvalConfirmed === true,
      trainingOptOutConfirmed: x.trainingOptOutConfirmed === true,
      writtenApproval: text(x.writtenApproval, 500),
      sensitiveIncluded: x.sensitiveIncluded === true
    };
  }

  function sanitizeSources(list) {
    return (Array.isArray(list) ? list : []).slice(0, 50).filter(util.isPlainObject).map(s => ({
      name: text(s.name, 260),
      kind: text(s.kind, 40),
      sha256: /^[0-9a-f]{64}$/.test(s.sha256) ? s.sha256 : "",
      pages: Number.isInteger(s.pages) && s.pages >= 0 ? s.pages : null
    }));
  }

  function sanitizeWarnings(list) {
    return (Array.isArray(list) ? list : []).slice(0, 200).filter(util.isPlainObject).map(w => ({
      code: text(w.code, 80) || "warning", message: text(w.message, 2000), path: text(w.path, 300)
    })).filter(w => w.message);
  }

  /* ---------- Secrets ---------- */

  const SECRET_PATTERNS = [
    ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ["an Anthropic key or token", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
    ["an OpenAI key", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/],
    ["an AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
    ["a GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}/],
    ["a Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
    ["a Google API key", /\bAIza[0-9A-Za-z_-]{35}/],
    ["a JSON web token", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/]
  ];

  /** Lists strings that look like credentials: [{ path, kind }]. */
  function scanSecrets(value, path) {
    const hits = [];
    const walk = (v, p, depth) => {
      if (hits.length >= 20 || depth > 24) return;
      if (typeof v === "string") {
        SECRET_PATTERNS.forEach(([kind, re]) => { if (re.test(v)) hits.push({ path: p, kind }); });
      } else if (Array.isArray(v)) {
        v.forEach((x, i) => walk(x, p + "[" + i + "]", depth + 1));
      } else if (util.isPlainObject(v)) {
        Object.keys(v).forEach(k => walk(v[k], joinPath(p, k), depth + 1));
      }
    };
    walk(value, path || "", 0);
    return hits;
  }

  /* ---------- Draft rules for extracted engagements ---------- */

  const EXTRACT_DISCLOSURE = "Drafted with AI assistance from source documents. Not yet confirmed with the people who do the work.";

  /*
   * An extracted engagement is a draft: nothing in it is validated, no data
   * is observed, evidence is unreviewed and links are removed. Every model
   * and record carries the AI stamp until someone marks it reviewed.
   */
  function enforceDraftRules(engagement, stamp, dataHandling) {
    const e = util.clone(engagement);
    const d = dataHandling || {};
    const changes = [];
    const note = (message, path) => changes.push({ code: "draft.rule", message, path: path || "", level: "info" });
    const mark = Object.assign({}, stamp || {}, { task: "extract", reviewed: false, reviewedAt: "" });
    e.revision = 0;
    e.migration = null;
    // The person who ran the job declared the data status and confidentiality; the AI does not choose them.
    const status = d.dataStatus && d.dataStatus !== "observed" ? d.dataStatus : "supplied";
    if (e.meta.dataStatus !== status) {
      note("Data status changed from " + schema.label("dataStatus", e.meta.dataStatus) + " to " + schema.label("dataStatus", status) + ", as set for this task.", "meta.dataStatus");
      e.meta.dataStatus = status;
    }
    if (d.confidentiality && e.meta.confidentiality !== d.confidentiality) {
      note("Confidentiality changed from " + schema.label("confidentiality", e.meta.confidentiality) + " to " + schema.label("confidentiality", d.confidentiality) + ", as set for this task.", "meta.confidentiality");
      e.meta.confidentiality = d.confidentiality;
    }
    if (!e.meta.disclosure) e.meta.disclosure = EXTRACT_DISCLOSURE;
    let steps = 0;
    e.models.forEach(m => {
      m.generated = Object.assign({}, mark);
      m.nodes.forEach(n => {
        if (n.provenance.validation !== "unvalidated") { n.provenance.validation = "unvalidated"; steps++; }
        if (n.provenance.source === "workshop") n.provenance.source = "generated";
      });
    });
    if (steps) note(steps + " step" + (steps === 1 ? " was" : "s were") + " marked as confirmed. AIxRay set " + (steps === 1 ? "it" : "them") + " to not confirmed yet.");
    let ev = 0, links = 0;
    e.evidence.forEach(x => {
      if (x.status !== "unreviewed" || x.reviewer || x.reviewDate) { x.status = "unreviewed"; x.reviewer = ""; x.reviewDate = ""; ev++; }
      if (x.link) { x.link = null; links++; }
    });
    if (ev) note(ev + " source" + (ev === 1 ? " was" : "s were") + " marked as reviewed. AIxRay set " + (ev === 1 ? "it" : "them") + " to not reviewed.");
    if (links) note(links + " source link" + (links === 1 ? " was" : "s were") + " removed. Add links yourself after you check them.");
    e.scenarios.forEach(s => { if (s.provenance === "observed") { s.provenance = "supplied"; note("Scenario " + s.name + " changed from measured to provided."); } });
    e.assumptions.forEach(a => {
      if (a.status === "validated" || a.status === "observed") {
        note("Assumption " + a.label + " changed from " + (a.status === "validated" ? "confirmed" : "measured") + " to provided.");
        a.status = "supplied";
      }
    });
    // Observed data comes from an event log a person imports, never from an extraction.
    const DROP = { datasets: ["event log", "event logs"], reviewPacks: ["review form", "review forms"], reviews: ["set of review answers", "sets of review answers"] };
    Object.keys(DROP).forEach(key => {
      if (!Array.isArray(e[key])) return;
      const n = e[key].length;
      if (n) note(n + " " + DROP[key][n === 1 ? 0 : 1] + (n === 1 ? " was" : " were") + " removed. Add event logs and review answers yourself.", key);
      delete e[key];
    });
    let observed = 0;
    e.scenarios.forEach(s => {
      if (s.observedFrom) { delete s.observedFrom; observed++; }
      (s.measures || []).forEach(m => { if (m.status === "observed") { m.status = "supplied"; observed++; } });
      const ov = (s.economics && s.economics.overrides) || {};
      Object.keys(ov).forEach(k => { if (ov[k].status === "observed") { ov[k].status = "supplied"; observed++; } });
    });
    e.records.forEach(r => {
      const vc = r.opportunity && r.opportunity.valueCase;
      if (!vc) return;
      if (vc.datasetId || vc.shareSource === "dataset" || vc.effortSource === "dataset") { vc.datasetId = null; vc.shareSource = "manual"; vc.effortSource = "node"; observed++; }
      if (vc.basis === "observed" || vc.basis === "validated") { vc.basis = "supplied"; observed++; }
    });
    if (observed) note(observed + " measured or confirmed figure" + (observed === 1 ? " was" : "s were") + " set to provided.");
    e.records.forEach(r => { r.generated = Object.assign({}, mark); });
    return { engagement: e, changes };
  }

  /* ---------- Payload sanitizers ---------- */

  function sanitizeOpportunity(o) {
    if (!util.isPlainObject(o)) return null;
    return {
      intervention: enumOr("intervention", o.intervention, ""),
      simplerAlternative: text(o.simplerAlternative), expectedBenefit: text(o.expectedBenefit),
      affectedVolume: text(o.affectedVolume, 500), effort: enumOr("effortSize", o.effort, ""),
      risk: text(o.risk), dependencies: text(o.dependencies), validationAction: text(o.validationAction)
    };
  }

  function sanitizeOpportunities(p, errors, warnings) {
    const list = p.suggestions;
    if (list.length > MAX_SUGGESTIONS) warnings.push({ code: "payload.truncated", message: "Only the first " + MAX_SUGGESTIONS + " suggestions are kept.", path: "payload.suggestions" });
    const refs = new Set();
    const suggestions = [];
    list.slice(0, MAX_SUGGESTIONS).forEach((s, i) => {
      const path = "payload.suggestions[" + i + "]";
      const title = text(s.title, 300).trim();
      if (!title) { errors.push({ path: path + ".title", message: "Each suggestion needs a title." }); return; }
      const ref = util.uniqueId(text(s.ref, 60).trim() || "s" + (i + 1), refs);
      suggestions.push({
        ref, kind: s.kind, title, description: text(s.description),
        linkedModelId: util.isValidId(s.linkedModelId) ? s.linkedModelId : null,
        linkedNodeIds: ids(s.linkedNodeIds), basedOnRecordIds: ids(s.basedOnRecordIds),
        priority: s.priority, opportunity: s.kind === "opportunity" ? sanitizeOpportunity(s.opportunity) : null,
        confidence: s.confidence, rationale: text(s.rationale, 2000)
      });
    });
    return { suggestions };
  }

  function minutes(v, path, errors) {
    if (v === null || v === undefined) return null;
    if (v < 0 || v > MAX_MINUTES) { errors.push({ path, message: "Minutes must be between 0 and " + MAX_MINUTES + "." }); return null; }
    return v;
  }

  function sanitizeFutureState(p, errors, warnings) {
    const laneRefs = new Set();
    if (p.lanes.length > MAX_NEW_LANES) warnings.push({ code: "payload.truncated", message: "Only the first " + MAX_NEW_LANES + " new lanes are kept.", path: "payload.lanes" });
    const lanes = p.lanes.slice(0, MAX_NEW_LANES).map((l, i) => {
      const ref = text(l.ref, 60).trim();
      const name = text(l.name, 200).trim();
      if (!ref || laneRefs.has(ref)) errors.push({ path: "payload.lanes[" + i + "].ref", message: "Each new lane needs a unique ref." });
      if (!name) errors.push({ path: "payload.lanes[" + i + "].name", message: "Each new lane needs a name." });
      laneRefs.add(ref);
      return { ref, name, role: text(l.role, 300), type: l.type };
    });
    if (p.operations.length > MAX_OPERATIONS) warnings.push({ code: "payload.truncated", message: "Only the first " + MAX_OPERATIONS + " changes are kept.", path: "payload.operations" });
    const operations = p.operations.slice(0, MAX_OPERATIONS).map((o, i) => {
      const path = "payload.operations[" + i + "]";
      if (o.op !== "insert" && !util.isValidId(o.nodeId)) errors.push({ path: path + ".nodeId", message: "A " + o.op + " change needs the ID of a baseline step." });
      if (o.op === "insert" && !util.isValidId(o.edgeId)) errors.push({ path: path + ".edgeId", message: "An insert needs the ID of a baseline connector." });
      if (o.op === "insert" && !text(o.label, 300).trim()) errors.push({ path: path + ".label", message: "An inserted step needs a label." });
      const details = [];
      const seen = new Set();
      o.details.forEach(d => { if (!seen.has(d.key)) { seen.add(d.key); details.push({ key: d.key, value: text(d.value, 4000) }); } });
      return {
        op: o.op,
        nodeId: o.op === "insert" ? null : o.nodeId,
        edgeId: o.op === "insert" ? o.edgeId : null,
        label: o.op === "remove" ? null : (text(o.label, 300).trim() || null),
        laneRef: o.op === "remove" ? null : (text(o.laneRef, 80).trim() || null),
        semanticType: o.op === "remove" ? null : o.semanticType,
        details: o.op === "remove" ? [] : details,
        tags: o.op === "remove" ? null : o.tags,
        touchEffortMinutes: o.op === "remove" ? null : minutes(o.touchEffortMinutes, path + ".touchEffortMinutes", errors),
        typicalDurationMinutes: o.op === "remove" ? null : minutes(o.typicalDurationMinutes, path + ".typicalDurationMinutes", errors),
        rationale: text(o.rationale, 2000),
        addressesRecordIds: ids(o.addressesRecordIds)
      };
    });
    return { name: text(p.name, 200).trim() || "AI future-state draft", summary: text(p.summary, 4000), lanes, operations };
  }

  function sanitizeSummary(p, errors, warnings) {
    const out = {
      title: text(p.title, 300).trim() || "Executive summary",
      text: text(p.text, 8000).trim(),
      keyPoints: p.keyPoints.slice(0, 12).map(k => ({
        text: text(k.text, 1000).trim(),
        supportingRecordIds: ids(k.supportingRecordIds),
        supportingFigures: (k.supportingFigures || []).slice(0, 10).map(f => text(f, 200))
      })).filter(k => k.text),
      caveats: p.caveats.slice(0, 12).map(c => text(c, 1000).trim()).filter(Boolean)
    };
    if (!out.text) errors.push({ path: "payload.text", message: "The summary text is empty." });
    if (p.keyPoints.length > 12 || p.caveats.length > 12) warnings.push({ code: "payload.truncated", message: "Only the first 12 key points and caveats are kept.", path: "payload" });
    if (summaryText(out).length > 12000) errors.push({ path: "payload.text", message: "The summary is longer than 12,000 characters." });
    return out;
  }

  /** The narrative text stored in the engagement: summary, key points and caveats. */
  function summaryText(p) {
    const parts = [p.text];
    if (p.keyPoints.length) parts.push("Key points:\n" + p.keyPoints.map(k => "- " + k.text).join("\n"));
    if (p.caveats.length) parts.push("Caveats:\n" + p.caveats.map(c => "- " + c).join("\n"));
    return parts.join("\n\n");
  }

  function sanitizeLogMapping(p, errors, warnings) {
    const max = schema.LIMITS.aiActivities;
    if (p.mappings.length > max) warnings.push({ code: "payload.truncated", message: "Only the first " + max + " mappings are kept.", path: "payload.mappings" });
    const seen = new Set();
    const mappings = [];
    p.mappings.slice(0, max).forEach((m, i) => {
      const path = "payload.mappings[" + i + "]";
      const activity = text(m.activity, 300).trim();
      if (!activity) { errors.push({ path: path + ".activity", message: "Each mapping needs the activity name." }); return; }
      if (seen.has(activity)) {
        warnings.push({ code: "payload.duplicate", message: "Activity \"" + activity.slice(0, 60) + "\" is mapped twice; the first mapping is kept.", path });
        return;
      }
      seen.add(activity);
      let nodeId = m.nodeId === null || m.nodeId === "" ? null : m.nodeId;
      if (nodeId !== null && !util.isValidId(nodeId)) {
        warnings.push({ code: "payload.reference", message: "The step for \"" + activity.slice(0, 60) + "\" is not a valid ID; the activity stays unmatched.", path: path + ".nodeId" });
        nodeId = null;
      }
      mappings.push({ activity, nodeId, confidence: m.confidence, rationale: text(m.rationale, 2000) });
    });
    return { mappings };
  }

  /* ---------- The result file ---------- */

  function isAiResult(data) {
    return util.isPlainObject(data) && schema.currentFormatId(data.schema) === RESULT_SCHEMA;
  }

  function stampOf(result) {
    const g = result.generated;
    return { task: result.task, provider: g.provider, model: g.model, surface: g.surface, at: g.at, jobId: g.jobId, plan: g.plan };
  }

  /**
   * Checks and sanitizes an AI result file on its own (without the engagement).
   * Returns { ok, errors, warnings, result }. result is null when errors exist.
   */
  function validateAiResult(input) {
    const errors = [];
    const warnings = [];
    const done = result => ({ ok: !errors.length, errors, warnings, result: errors.length ? null : result });
    if (!isAiResult(input)) {
      errors.push({ path: "schema", message: "This is not an AIxRay AI result file." });
      return done(null);
    }
    if (input.schemaVersion !== RESULT_VERSION) {
      errors.push({ path: "schemaVersion", message: Number(input.schemaVersion) > RESULT_VERSION ?
        "This AI result was made by a newer version of AIxRay. Update AIxRay to open it." : "AIxRay does not recognize the version of this AI result file." });
      return done(null);
    }
    if (!schema.ENUMS.aiTask.includes(input.task)) {
      errors.push({ path: "task", message: "AIxRay does not recognize the AI task \"" + String(input.task).slice(0, 40) + "\"." });
      return done(null);
    }
    const task = input.task;
    const result = {
      schema: RESULT_SCHEMA, schemaVersion: RESULT_VERSION, task,
      engagementId: util.isValidId(input.engagementId) ? input.engagementId : null,
      engagementRevision: Number.isInteger(input.engagementRevision) && input.engagementRevision >= 0 ? input.engagementRevision : null,
      baselineModelId: util.isValidId(input.baselineModelId) ? input.baselineModelId : null,
      generated: sanitizeGenerated(input.generated),
      dataHandling: sanitizeDataHandling(input.dataHandling),
      sources: sanitizeSources(input.sources),
      notes: text(input.notes, 4000),
      warnings: sanitizeWarnings(input.warnings),
      payload: null
    };
    if (task !== "extract" && !result.engagementId) errors.push({ path: "engagementId", message: "The result does not say which project it was made for." });
    if (task === "future-state" && !result.baselineModelId) errors.push({ path: "baselineModelId", message: "A future-state result needs the baseline model ID." });
    if (task === "log-mapping" && !result.baselineModelId) errors.push({ path: "baselineModelId", message: "A log-mapping result needs the ID of the model the activities are mapped to." });

    scanSecrets({ payload: input.payload, notes: input.notes, warnings: input.warnings }).forEach(hit => {
      errors.push({ path: hit.path, code: "output.secret", message: "This looks like " + hit.kind + ". The result was not loaded. " +
        (task === "log-mapping" ? "Check the activity names and the model steps" : task === "extract" ? "Remove it from the sources" : "Remove it from the project") + " and run the task again." });
    });

    const payload = input.payload;
    if (!util.isPlainObject(payload)) {
      errors.push({ path: "payload", message: "The result has no payload." });
      return done(result);
    }
    if (task === "extract") {
      const v = validate.validateEngagement(payload.engagement);
      v.errors.forEach(e => errors.push({ path: joinPath("payload.engagement", e.path), message: e.message }));
      v.warnings.forEach(w => warnings.push(Object.assign({}, w, { path: joinPath("payload.engagement", w.path) })));
      if (v.ok) {
        const drafted = enforceDraftRules(v.engagement, stampOf(result), result.dataHandling);
        drafted.changes.forEach(c => warnings.push(c));
        result.payload = { engagement: drafted.engagement };
      }
      return done(result);
    }
    const shapeErrors = [];
    const extra = [];
    checkShape(TASK_SCHEMAS[task], payload, "payload", shapeErrors, extra);
    shapeErrors.forEach(e => errors.push(e));
    if (extra.length) warnings.push({ code: "fields.ignored", message: "Ignored " + extra.length + " unrecognized field" + (extra.length === 1 ? "" : "s") + ": " + extra.slice(0, 6).join(", ") + (extra.length > 6 ? ", ..." : "") + ".", path: "payload", level: "info" });
    if (shapeErrors.length) return done(result);
    if (task === "opportunities") result.payload = sanitizeOpportunities(payload, errors, warnings);
    else if (task === "future-state") result.payload = sanitizeFutureState(payload, errors, warnings);
    else if (task === "log-mapping") result.payload = sanitizeLogMapping(payload, errors, warnings);
    else result.payload = sanitizeSummary(payload, errors, warnings);
    return done(result);
  }

  function parseAiResultText(textValue) {
    if (typeof textValue !== "string") return { ok: false, errors: [{ path: "", message: "The file could not be read as text." }], warnings: [], result: null };
    if (textValue.length > schema.LIMITS.fileBytes) return { ok: false, errors: [{ path: "", message: "The file is larger than the 10 MB limit." }], warnings: [], result: null };
    let data;
    try {
      data = JSON.parse(textValue);
    } catch (err) {
      return { ok: false, errors: [{ path: "", message: "The file is not valid JSON: " + String(err.message || err).slice(0, 200) }], warnings: [], result: null };
    }
    return validateAiResult(data);
  }

  /** Builds a result envelope. Runners fill in the payload and the job details. */
  function makeEnvelope(o) {
    const x = o || {};
    return {
      schema: RESULT_SCHEMA, schemaVersion: RESULT_VERSION, task: x.task,
      engagementId: x.engagementId || null,
      engagementRevision: Number.isInteger(x.engagementRevision) ? x.engagementRevision : null,
      baselineModelId: x.baselineModelId || null,
      generated: Object.assign({ tool: "aixray-ai", provider: "other", model: "", surface: "cli", at: util.nowIso(), jobId: "", plan: "unknown" }, x.generated || {}),
      dataHandling: sanitizeDataHandling(x.dataHandling),
      sources: x.sources || [],
      notes: x.notes || "",
      warnings: x.warnings || [],
      payload: x.payload === undefined ? null : x.payload
    };
  }

  /* ---------- Data handling ---------- */

  const GATE_TEXT = {
    plan: "Choose the plan this AI account is on.",
    approval: "I confirm the project lead approved sending this material to this AI account.",
    writtenApproval: "The client's written approval for restricted material: who approved, and when.",
    trainingOff: "I turned off model training for this account. In Claude: Settings, Privacy, \"Help improve Claude\". In ChatGPT: Settings, Data controls, \"Improve the model for everyone\"."
  };

  /*
   * Who may send what where. Demonstration and public material may go to any
   * plan. Other material needs an approval on a commercial plan (Claude Team
   * or Enterprise, ChatGPT Business or Enterprise). A consumer plan (Claude
   * Pro or Max, ChatGPT Plus or Pro) takes internal material only, after the
   * user confirms training is off, and never takes client material.
   */
  function dataHandlingGate(ctx) {
    const c = ctx || {};
    const plan = enumOr("aiPlan", c.plan, "unknown");
    const level = c.dataStatus === "demonstration" || c.confidentiality === "public" ? "open" :
      enumOr("confidentiality", c.confidentiality, "client-confidential");
    const label = level === "open" ? "Demonstration or public material" : schema.label("confidentiality", level) + " material";
    let requires = [];
    let blocked = false;
    let message = "";
    if (level === "open") {
      message = label + " may be sent to any plan.";
    } else if (plan === "unknown") {
      requires = ["plan"];
      message = label + " needs a known plan. Choose the plan this AI account is on.";
    } else if (plan === "commercial") {
      requires = level === "restricted" ? ["approval", "writtenApproval"] : ["approval"];
      message = label + " may be sent to a commercial plan with the project lead's approval" +
        (level === "restricted" ? " and the client's written approval." : ".");
    } else if (level === "internal") {
      requires = ["trainingOff"];
      message = "Internal material may be sent to a consumer plan only with model training turned off.";
    } else {
      blocked = true;
      message = label + " cannot be sent to a consumer plan (Claude Pro or Max, ChatGPT Plus or Pro). " +
        "Use a Claude Team or Enterprise account, or ChatGPT Business or Enterprise.";
    }
    const have = {
      plan: plan !== "unknown",
      approval: c.approvalConfirmed === true,
      writtenApproval: typeof c.writtenApproval === "string" && c.writtenApproval.trim().length >= 5,
      trainingOff: c.trainingOptOutConfirmed === true
    };
    const missing = requires.filter(k => !have[k]);
    return { level, plan, allowed: !blocked && !missing.length, blocked, requires, missing, message };
  }

  /* ---------- What the AI is given ---------- */

  function compact(obj) {
    const out = {};
    Object.keys(obj).forEach(k => {
      const v = obj[k];
      if (v === null || v === undefined || v === "" || v === false) return;
      if (Array.isArray(v) && !v.length) return;
      if (util.isPlainObject(v) && !Object.keys(v).length) return;
      out[k] = v;
    });
    return out;
  }

  function modelView(m) {
    return {
      id: m.id, name: m.name, role: m.role, status: m.status, version: m.version,
      lanes: m.lanes.map(l => compact({ id: l.id, name: l.name, role: l.role, type: l.type })),
      steps: m.nodes.filter(n => !n.removed).map(n => compact({
        id: n.id, label: n.label, sub: n.sub, type: n.semanticType, laneId: n.laneId,
        details: compact(n.details || {}),
        measures: compact({
          typicalDuration: n.measures && n.measures.typicalDuration,
          slaTarget: n.measures && n.measures.slaTarget,
          touchEffort: n.measures && n.measures.touchEffort,
          waitType: n.measures && n.measures.waitType
        }),
        tags: Object.keys(n.tags || {}).filter(k => n.tags[k] === true),
        validation: n.provenance && n.provenance.validation,
        change: n.lineage && n.lineage.change !== "unchanged" ? n.lineage.change : ""
      })),
      connectors: m.edges.filter(x => !x.removed).map(x => compact({ id: x.id, from: x.from, to: x.to, label: x.label, type: x.semanticType }))
    };
  }

  /**
   * The engagement content an AI task needs, and nothing else: no visit
   * lists, no evidence links, no sensitive records unless asked for, and for
   * the summary no unreviewed AI drafts.
   */
  function buildTaskInput(engagement, task, options) {
    const o = options || {};
    const e = engagement;
    if (task === "log-mapping") return logMappingInput(e, o);
    const records = e.records.filter(r => (o.includeSensitive || !r.sensitive) &&
      (task !== "summary" || o.includeUnreviewedAi || !exporting.isUnreviewedAi(r)));
    const baseline = e.models.find(m => m.id === o.baselineModelId) || e.models.find(m => m.role === "current");
    const input = {
      task,
      engagementId: e.id,
      engagementRevision: e.revision,
      engagement: compact({
        processName: e.meta.processName, clientDisplayName: e.meta.clientDisplayName, engagementName: e.meta.engagementName,
        confidentiality: e.meta.confidentiality, dataStatus: e.meta.dataStatus, currency: e.meta.currency,
        timeBasis: e.meta.timeBasis, summary: e.meta.summary
      }),
      models: task === "future-state" ? [modelView(baseline)] : e.models.map(modelView),
      records: records.map(r => compact({
        id: r.id, kind: r.kind, title: r.title, description: r.description, status: r.status, priority: r.priority,
        linkedModelId: r.linkedModelId, linkedNodeIds: r.linkedNodeIds,
        opportunity: r.opportunity ? compact(Object.assign({}, r.opportunity, { aiAssessment: undefined })) : null,
        origin: r.generated ? (r.generated.reviewed ? "ai-reviewed" : "ai-draft") : ""
      })),
      assumptions: e.assumptions.map(a => compact({ key: a.key, label: a.label, value: a.value, unit: a.unit, status: a.status, source: a.source })),
      evidence: e.evidence.map(x => compact({ id: x.id, title: x.title, locator: x.locator, extractedFact: x.extractedFact, status: x.status })),
      excluded: { sensitiveRecords: e.records.filter(r => r.sensitive).length - records.filter(r => r.sensitive).length }
    };
    if (task === "future-state") input.baselineModelId = baseline ? baseline.id : null;
    if (task === "summary") {
      const h = exporting.buildHandoff(e, { includeSensitive: o.includeSensitive, includeUnreviewedAi: o.includeUnreviewedAi, scenarioId: o.scenarioId });
      input.figures = {
        scenario: h.scenario,
        value: h.value || [],
        reconciliation: h.reconciliation,
        evidence: h.evidence,
        models: h.models,
        assumptions: h.assumptions
      };
    }
    return input;
  }

  /*
   * For log mapping the AI sees the steps of one model (ID, label, lane,
   * description) and the activity names from the log. No events, case IDs,
   * resource names, timings or counts are sent. options: { modelId, activities: [{ name, events }] }.
   * The most frequent names are sent first, up to LIMITS.aiActivities.
   * Names that look like credentials are never sent; they are counted in
   * excluded.secretActivities and stay in the import for manual mapping.
   */
  function logMappingInput(e, o) {
    const model = e.models.find(m => m.id === o.modelId) || e.models.find(m => m.role === "current") || null;
    const lanes = new Map(model ? model.lanes.map(l => [l.id, l.name]) : []);
    const seen = new Set();
    const acts = [];
    let secretActivities = 0;
    (Array.isArray(o.activities) ? o.activities : []).forEach(a => {
      const name = text(a && typeof a === "object" ? a.name : a, 300).trim();
      if (!name || seen.has(name)) return;
      seen.add(name);
      if (scanSecrets(name).length) { secretActivities++; return; }
      acts.push({ name, events: a && util.isFiniteNumber(a.events) ? a.events : 0 });
    });
    acts.sort((a, b) => b.events - a.events);
    const sent = acts.slice(0, schema.LIMITS.aiActivities);
    const desc = n => {
      const d = n.details && n.details.desc;
      return d == null ? "" : text(Array.isArray(d) ? d.join(" ") : d, 1000);
    };
    return {
      task: "log-mapping",
      engagementId: e.id,
      engagementRevision: e.revision,
      modelId: model ? model.id : null,
      baselineModelId: model ? model.id : null,
      engagement: compact({ processName: e.meta.processName }),
      steps: model ? model.nodes.filter(n => !n.removed && schema.typeInfo(n.semanticType).shape !== "gateway")
        .map(n => compact({ id: n.id, label: n.label, lane: lanes.get(n.laneId) || "", description: desc(n) })) : [],
      activities: sent.map(a => a.name),
      excluded: { activities: acts.length - sent.length, secretActivities }
    };
  }

  /* ---------- Figures in a drafted summary ---------- */

  const NUMBER_RE = /(?:([$\u20ac\u00a3])\s?)?(\d(?:[\d,]*\d)?(?:\.\d+)?)(\s?%|[kKmM](?![A-Za-z])|bn(?![A-Za-z])|\s(?:million|thousand|billion)(?![A-Za-z]))?/g;
  const SCALE = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, bn: 1e9, billion: 1e9 };

  function numbersIn(value) {
    const out = [];
    const s = String(value == null ? "" : value);
    let m;
    NUMBER_RE.lastIndex = 0;
    while ((m = NUMBER_RE.exec(s))) {
      const before = s.charAt(m.index - 1);
      if (!m[1] && /[A-Za-z_\-.]/.test(before)) continue;
      let n = Number(m[2].replace(/,/g, ""));
      if (!Number.isFinite(n)) continue;
      const suffix = (m[3] || "").trim().toLowerCase();
      const scaled = !!SCALE[suffix] && (!!m[1] || suffix.length > 1);
      if (scaled) n *= SCALE[suffix];
      out.push({ raw: m[0].trim(), value: n, marked: !!m[1] || suffix === "%" || m[2].includes(".") || scaled });
    }
    return out;
  }

  function allowedNumbers(source) {
    const values = [];
    const walk = (v, depth) => {
      if (depth > 24) return;
      if (typeof v === "number" && Number.isFinite(v)) values.push(v, v / 60, v / 480, v / 1440, v * 100);
      else if (typeof v === "string") numbersIn(v).forEach(x => values.push(x.value));
      else if (Array.isArray(v)) v.forEach(x => walk(x, depth + 1));
      else if (util.isPlainObject(v)) Object.keys(v).forEach(k => walk(v[k], depth + 1));
    };
    walk(source, 0);
    return values;
  }

  /**
   * Flags figures in a drafted summary that do not appear in what the AI was
   * given. Small counts and years are not checked.
   */
  function checkSummaryNumbers(payload, taskInput) {
    const allowed = allowedNumbers(taskInput);
    const flagged = [];
    const seen = new Set();
    const check = (value, path) => numbersIn(value).forEach(x => {
      if (!x.marked && Number.isInteger(x.value) && (x.value < 10 || (x.value >= 1900 && x.value <= 2100))) return;
      const ok = allowed.some(a => Math.abs(a - x.value) <= Math.max(0.5, Math.abs(a) * 0.01));
      if (ok || seen.has(x.raw)) return;
      seen.add(x.raw);
      flagged.push({ code: "summary.number", path, level: "warning",
        message: "The figure \"" + x.raw + "\" is not in the project's figures or findings. Check it before you accept the summary." });
    });
    check(payload.title, "payload.title");
    check(payload.text, "payload.text");
    payload.keyPoints.forEach((k, i) => {
      check(k.text, "payload.keyPoints[" + i + "].text");
      k.supportingFigures.forEach((f, j) => check(f, "payload.keyPoints[" + i + "].supportingFigures[" + j + "]"));
    });
    payload.caveats.forEach((c, i) => check(c, "payload.caveats[" + i + "]"));
    return flagged;
  }

  /* ---------- Review against the open engagement ---------- */

  /** Whether the result belongs to this engagement, and whether it has changed since. */
  function staleCheck(result, engagement) {
    if (result.task === "extract") return { error: "", warning: "" };
    if (!engagement) return { error: "Open the project this draft was made for, then open the draft again.", warning: "" };
    if (result.engagementId !== engagement.id) {
      return { error: "This draft was made for a different project. Open that project, then open the draft again.", warning: "" };
    }
    if (result.engagementRevision !== null && result.engagementRevision !== engagement.revision) {
      return { error: "", warning: "The project has changed since this draft was made. Check each item against the project as it is now." };
    }
    return { error: "", warning: "" };
  }

  function describeEngagement(e) {
    return {
      processName: e.meta.processName, client: e.meta.clientDisplayName,
      confidentiality: schema.label("confidentiality", e.meta.confidentiality),
      models: e.models.map(m => ({ name: m.name, role: schema.label("modelRole", m.role), steps: m.nodes.length, lanes: m.lanes.length })),
      records: e.records.length, evidence: e.evidence.length, scenarios: e.scenarios.length, assumptions: e.assumptions.length
    };
  }

  function opportunityItems(result, engagement) {
    const nodeIndex = new Map(engagement.models.map(m => [m.id, new Map(m.nodes.map(n => [n.id, n]))]));
    const records = new Map(engagement.records.map(r => [r.id, r]));
    const titles = new Set(engagement.records.map(r => r.title.trim().toLowerCase()));
    return result.payload.suggestions.map((s, i) => {
      const notes = [];
      let modelId = s.linkedModelId;
      if (modelId && !nodeIndex.has(modelId)) { notes.push("Linked model " + modelId + " not found; link removed."); modelId = null; }
      const stepLabels = [];
      const linkedNodeIds = s.linkedNodeIds.filter(id => {
        const hit = modelId ? nodeIndex.get(modelId).get(id) : [...nodeIndex.values()].map(x => x.get(id)).find(Boolean);
        if (hit) stepLabels.push(hit.label);
        else notes.push("Step " + id + " not found; link removed.");
        return !!hit;
      });
      const basedOn = s.basedOnRecordIds.filter(id => records.has(id));
      if (titles.has(s.title.toLowerCase())) notes.push("A finding with this title already exists.");
      const why = [s.rationale && "Why: " + s.rationale, "Confidence: " + s.confidence + ".",
        basedOn.length ? "Based on: " + basedOn.map(id => records.get(id).title).join("; ") + "." : ""].filter(Boolean).join(" ");
      return {
        key: "s" + i, index: i, kind: s.kind, title: s.title, description: s.description, priority: s.priority,
        confidence: s.confidence, rationale: s.rationale, opportunity: s.opportunity,
        stepLabels, basedOnTitles: basedOn.map(id => records.get(id).title), problems: [], notes,
        record: {
          kind: s.kind, title: s.title, status: "open", priority: s.priority,
          description: [s.description, why].filter(Boolean).join("\n\n"),
          linkedModelId: modelId, linkedNodeIds, opportunity: s.opportunity || undefined
        }
      };
    });
  }

  function futureStateItems(result, engagement, out) {
    const baseline = engagement.models.find(m => m.id === result.baselineModelId);
    if (!baseline) { out.errors.push({ path: "baselineModelId", message: "The current-state model this draft starts from is not in this project." }); return []; }
    if (baseline.role !== "current") { out.errors.push({ path: "baselineModelId", message: "A future-state draft must start from a current-state model." }); return []; }
    out.baseline = { id: baseline.id, name: baseline.name, version: baseline.version };
    const p = result.payload;
    const nodes = new Map(baseline.nodes.map(n => [n.id, n]));
    const edges = new Map(baseline.edges.map(x => [x.id, x]));
    const lanes = new Map(baseline.lanes.map(l => [l.id, l.name]));
    p.lanes.forEach(l => lanes.set(l.ref, l.name + " (new)"));
    const records = new Map(engagement.records.map(r => [r.id, r]));
    const touched = new Map();
    return p.operations.map((o, i) => {
      const problems = [], notes = [], changes = [];
      const node = o.nodeId ? nodes.get(o.nodeId) : null;
      const edge = o.edgeId ? edges.get(o.edgeId) : null;
      let title = "";
      if (o.op === "insert") {
        if (!edge) problems.push("Connector " + o.edgeId + " is not in the baseline.");
        const from = edge && nodes.get(edge.from), to = edge && nodes.get(edge.to);
        title = "Add \"" + o.label + "\"" + (from && to ? " between \"" + from.label + "\" and \"" + to.label + "\"" : "");
      } else {
        if (!node) problems.push("Step " + o.nodeId + " is not in the baseline.");
        const name = node ? node.label : o.nodeId;
        title = (o.op === "remove" ? "Remove \"" : "Change \"") + name + "\"";
        if (node && o.op === "remove") {
          const shape = schema.typeInfo(node.semanticType).shape;
          if (shape === "start") problems.push("The start event cannot be removed.");
          if (shape === "end") problems.push("End events cannot be removed. Change the steps before them instead.");
        }
        if (node && o.op === "modify" && o.semanticType && schema.typeInfo(node.semanticType).shape !== "task") {
          problems.push("Only task steps can change type.");
        }
        if (node) {
          const earlier = touched.get(node.id);
          if (earlier === "remove" || (earlier && o.op === "remove")) problems.push("Another change in this draft already " + (earlier === "remove" ? "removes" : "changes") + " this step.");
          touched.set(node.id, o.op);
        }
      }
      if (o.laneRef && !lanes.has(o.laneRef)) problems.push("Lane " + o.laneRef + " is not in the baseline or the new lanes.");
      if (o.op === "modify" && o.label && node && o.label !== node.label) changes.push("Rename to \"" + o.label + "\"");
      if (o.laneRef && lanes.has(o.laneRef) && (!node || node.laneId !== o.laneRef)) changes.push("Lane: " + lanes.get(o.laneRef));
      if (o.semanticType && (!node || node.semanticType !== o.semanticType)) changes.push("Type: " + schema.typeInfo(o.semanticType).label);
      if (o.touchEffortMinutes !== null) changes.push("Touch effort: " + util.formatNumber(o.touchEffortMinutes) + " min");
      if (o.typicalDurationMinutes !== null) changes.push("Typical duration: " + util.formatNumber(o.typicalDurationMinutes) + " min");
      if (o.tags) {
        const on = ["bottleneck", "agent", "humanReview"].filter(k => o.tags[k]);
        if (on.length) changes.push("Tags: " + on.map(k => k === "humanReview" ? "human review" : k).join(", "));
      }
      o.details.forEach(d => changes.push((d.key === "desc" ? "Description" : d.key) + ": " + d.value.slice(0, 160)));
      if (o.op === "modify" && !changes.length) problems.push("This change does not change anything.");
      const addresses = o.addressesRecordIds.filter(id => records.has(id)).map(id => records.get(id).title);
      if (addresses.length < o.addressesRecordIds.length) notes.push("Some linked findings were not found.");
      return { key: "o" + i, index: i, op: o.op, title, changes, rationale: o.rationale, addresses, problems, notes };
    });
  }

  function summaryItems(result, engagement, out) {
    const p = result.payload;
    const input = buildTaskInput(engagement, "summary", {
      includeSensitive: result.dataHandling.sensitiveIncluded, includeUnreviewedAi: false
    });
    const flagged = checkSummaryNumbers(p, input);
    const records = new Set(engagement.records.map(r => r.id));
    const notes = flagged.map(f => f.message);
    const missing = p.keyPoints.reduce((n, k) => n + k.supportingRecordIds.filter(id => !records.has(id)).length, 0);
    if (missing) notes.push(missing + " supporting finding" + (missing === 1 ? " was" : "s were") + " not found.");
    const existing = (engagement.narratives || []).find(n => n.kind === "executive-summary");
    if (existing) notes.push("Accepting this replaces the current executive summary.");
    flagged.forEach(f => out.warnings.push(f));
    return [{ key: "summary", index: 0, title: p.title, text: p.text, keyPoints: p.keyPoints, caveats: p.caveats, problems: [], notes }];
  }

  /*
   * Log-mapping items. context.activities, when given, lists the activity
   * names that were sent; a mapping for any other name cannot be applied.
   */
  function logMappingItems(result, engagement, out, context) {
    const model = engagement.models.find(m => m.id === result.baselineModelId);
    if (!model) { out.errors.push({ path: "baselineModelId", message: "The model these activities were matched to is not in this project." }); return []; }
    out.baseline = { id: model.id, name: model.name, version: model.version };
    const nodes = new Map(model.nodes.filter(n => !n.removed).map(n => [n.id, n]));
    const names = context && Array.isArray(context.activities) ?
      new Set(context.activities.map(a => (a && typeof a === "object" ? a.name : a)).filter(x => typeof x === "string").map(x => x.trim())) : null;
    return result.payload.mappings.map((m, i) => {
      const problems = [], notes = [];
      const node = m.nodeId ? nodes.get(m.nodeId) : null;
      if (m.nodeId && !node) problems.push("Step " + m.nodeId + " is not in " + model.name + ".");
      else if (node && schema.typeInfo(node.semanticType).shape === "gateway") problems.push("A gateway is a decision point, so an activity cannot map to it. Choose a step instead.");
      if (names && !names.has(m.activity)) problems.push("The activity \"" + m.activity + "\" was not sent to the assistant.");
      if (!m.nodeId) notes.push("No matching step suggested; the activity stays unmatched.");
      return {
        key: "m" + i, index: i, activity: m.activity, nodeId: m.nodeId, stepLabel: node ? node.label : "",
        confidence: m.confidence, rationale: m.rationale,
        title: m.activity + (node ? " to " + node.label : ""), problems, notes
      };
    });
  }

  /**
   * Lists the items a person reviews before applying a result.
   * Returns { task, errors, warnings, items, baseline, engagementSummary }.
   * Items with problems cannot be applied. context is optional and used by
   * log mapping (see logMappingItems).
   */
  function prepareReview(result, engagement, context) {
    const out = { task: result.task, errors: [], warnings: [], items: [], baseline: null, engagementSummary: null };
    const st = staleCheck(result, engagement);
    if (st.error) { out.errors.push({ path: "engagementId", message: st.error }); return out; }
    if (st.warning) out.warnings.push({ code: "result.stale", message: st.warning, path: "" });
    const gate = dataHandlingGate(Object.assign({ plan: result.generated.plan }, result.dataHandling));
    if (gate.blocked) out.warnings.push({ code: "result.gate", message: "This draft was made on a consumer plan with " + schema.label("confidentiality", result.dataHandling.confidentiality).toLowerCase() + " material. " + gate.message, path: "dataHandling" });
    if (result.task === "extract") {
      out.engagementSummary = describeEngagement(result.payload.engagement);
      return out;
    }
    if (result.task === "opportunities") out.items = opportunityItems(result, engagement);
    else if (result.task === "future-state") out.items = futureStateItems(result, engagement, out);
    else if (result.task === "log-mapping") out.items = logMappingItems(result, engagement, out, context);
    else out.items = summaryItems(result, engagement, out);
    return out;
  }

  /**
   * The store command that applies the chosen items: { type, payload }.
   * For an extraction it is { type: "open", engagement }. For log mapping it
   * is { type: "log-mapping/proposals", payload }: proposals for the import
   * wizard to show, not a store command.
   */
  function applyCommand(result, review, selectedKeys) {
    const chosen = new Set(selectedKeys || []);
    const stamp = stampOf(result);
    if (result.task === "extract") return { type: "open", engagement: result.payload.engagement };
    const picked = review.items.filter(it => chosen.has(it.key) && !it.problems.length);
    if (!picked.length) return null;
    if (result.task === "opportunities") {
      return { type: "ai/applySuggestions", payload: { records: picked.map(it => it.record), stamp } };
    }
    if (result.task === "log-mapping") {
      return {
        type: "log-mapping/proposals",
        payload: {
          modelId: result.baselineModelId,
          mappings: picked.map(it => ({ activity: it.activity, nodeId: it.nodeId, method: "ai", confidence: it.confidence, rationale: it.rationale })),
          stamp
        }
      };
    }
    if (result.task === "summary") {
      const p = result.payload;
      return { type: "narrative/set", payload: { kind: "executive-summary", title: p.title, text: summaryText(p), status: "draft", generated: stamp } };
    }
    const p = result.payload;
    const order = { modify: 0, insert: 1, remove: 2 };
    const ops = picked.map(it => {
      const o = p.operations[it.index];
      const why = [o.rationale, it.addresses.length ? "Addresses: " + it.addresses.join("; ") + "." : ""].filter(Boolean).join(" ");
      return Object.assign({}, o, { rationale: why });
    }).sort((a, b) => order[a.op] - order[b.op]);
    const usedLanes = new Set(ops.map(o => o.laneRef).filter(Boolean));
    return {
      type: "ai/applyFutureState",
      payload: {
        baselineModelId: result.baselineModelId, name: p.name, summary: p.summary,
        lanes: p.lanes.filter(l => usedLanes.has(l.ref)), operations: ops, stamp
      }
    };
  }

  return {
    RESULT_SCHEMA, RESULT_VERSION, TASK_SCHEMAS, TASK_TYPES, SUGGESTION_KINDS, WARNING_CODES, GATE_TEXT, EXTRACT_DISCLOSURE,
    MAX_SUGGESTIONS, outputSchema,
    isAiResult, validateAiResult, parseAiResultText, makeEnvelope, stampOf, checkShape,
    enforceDraftRules, scanSecrets, checkSummaryNumbers, numbersIn, buildTaskInput, dataHandlingGate,
    staleCheck, prepareReview, applyCommand, summaryText
  };
});
