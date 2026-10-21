/* Workshop data, closure checks and pilot briefs. Pure Node/browser library. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./util.js"), require("./schema.js"));
  else { const B = root.AIxRay = root.AIxRay || {}; B.workshop = factory(B.util, B.schema); }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, schema) {
  "use strict";
  const LIMITS = { agenda: 100, designs: 200, criteria: 50, refs: 200, text: 2000 };
  const RESPONSIBILITIES = ["human", "rules", "ai-assist", "agent"];
  const DESIGN_FIELDS = ["trigger", "inputs", "outputs", "systems", "rules", "approval", "fallback", "testCriteria"];
  const plain = x => util.isPlainObject(x) ? x : {};
  const text = (x, max) => typeof x === "string" ? x.slice(0, max || LIMITS.text).trim() : "";
  const id = x => util.isValidId(x) ? x : null;
  const list = (x, max) => Array.isArray(x) ? x.slice(0, max) : [];
  const reviewed = x => x.reviewed === true && !(x.generated && x.generated.reviewed !== true);
  const safe = x => !!x && x.sensitive !== true && !(x.generated && x.generated.reviewed !== true) &&
    !(x.provenance && x.provenance.source === "generated" && x.provenance.validation !== "validated");
  const reviewedSafe = x => safe(x) && x.reviewed === true;
  const unique = (xs, key) => { const seen = new Set(); return xs.filter(x => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }); };
  function date(x) {
    const s = text(x, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s ? s : "";
  }
  const stringSchema = maxLength => ({ type: "string", maxLength });
  const ID = { type: "string", pattern: util.ID_PATTERN.source, maxLength: 80 };
  const nullableId = { anyOf: [ID, { type: "null" }] };
  const objectSchema = properties => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
  const arraySchema = (items, maxItems) => ({ type: "array", items, maxItems });
  const safetySchema = { sensitive: { type: "boolean" }, reviewed: { type: "boolean" } };
  const WORKSHOP_SCHEMA = objectSchema({
    currentModelId: nullableId, futureModelId: nullableId,
    agenda: arraySchema(objectSchema({ id: ID, title: stringSchema(300), owner: stringSchema(200), minutes: { type: "integer", minimum: 1, maximum: 480 }, status: { enum: ["planned", "active", "done"] } }), LIMITS.agenda),
    designs: arraySchema(objectSchema(Object.assign({ modelId: ID, nodeId: ID, owner: stringSchema(200), responsibility: { enum: RESPONSIBILITIES } }, Object.fromEntries(DESIGN_FIELDS.map(k => [k, stringSchema(LIMITS.text)])), safetySchema)), LIMITS.designs),
    checkpoint: { anyOf: [{ type: "null" }, objectSchema(Object.assign({
      fingerprint: { type: "string", pattern: "^ws1-[a-f0-9]{16}$" }, reviewer: stringSchema(200), date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      modelVersions: arraySchema(objectSchema({ modelId: ID, version: { type: "integer", minimum: 0, maximum: 1000000000 } }), 2),
      acceptedRecordIds: arraySchema(ID, LIMITS.refs), unresolvedRecordIds: arraySchema(ID, LIMITS.refs),
      criteria: arraySchema(objectSchema({ id: ID, text: stringSchema(1000), owner: stringSchema(200) }), LIMITS.criteria)
    }, safetySchema))] }
  });

  /** Returns only bounded plain JSON, or undefined when the optional field is absent. */
  function sanitizeWorkshop(raw, e) {
    if (raw === undefined || raw === null) return undefined;
    const r = plain(raw), models = (e && e.models) || [], records = (e && e.records) || [];
    const modelRef = (v, role) => models.some(m => m.id === v && (!role || m.role === role)) ? id(v) : null;
    const out = {
      currentModelId: modelRef(r.currentModelId, "current"), futureModelId: modelRef(r.futureModelId, "future"),
      agenda: unique(list(r.agenda, LIMITS.agenda).filter(x => util.isPlainObject(x) && id(x.id) && text(x.title)).map(x => ({
        id: x.id, title: text(x.title, 300), owner: text(x.owner, 200), minutes: Number.isInteger(x.minutes) ? Math.max(1, Math.min(480, x.minutes)) : 15,
        status: ["planned", "active", "done"].includes(x.status) ? x.status : "planned"
      })), x => x.id),
      designs: [], checkpoint: null
    };
    out.designs = unique(list(r.designs, LIMITS.designs).filter(x => {
      const m = util.isPlainObject(x) && models.find(m => m.id === x.modelId);
      return m && id(x.modelId) && id(x.nodeId) && m.nodes.some(n => n.id === x.nodeId && !n.removed);
    }).map(x => Object.assign({ modelId: x.modelId, nodeId: x.nodeId, owner: text(x.owner, 200), responsibility: RESPONSIBILITIES.includes(x.responsibility) ? x.responsibility : "human" },
      Object.fromEntries(DESIGN_FIELDS.map(k => [k, text(x[k])])), { sensitive: x.sensitive === true, reviewed: reviewed(x) && !!text(x.owner) && DESIGN_FIELDS.every(k => !!text(x[k])) })), x => JSON.stringify([x.modelId, x.nodeId]));
    const c = plain(r.checkpoint);
    if (/^ws1-[a-f0-9]{16}$/.test(c.fingerprint) && text(c.reviewer, 200) && date(c.date)) {
      const refs = xs => unique(list(xs, LIMITS.refs).filter(x => id(x) && records.some(r => r.id === x)), x => x);
      out.checkpoint = {
        fingerprint: c.fingerprint, reviewer: text(c.reviewer, 200), date: date(c.date),
        modelVersions: unique(list(c.modelVersions, 2).filter(x => util.isPlainObject(x) && modelRef(x.modelId)).map(x => ({ modelId: x.modelId, version: Number.isInteger(x.version) ? Math.max(0, Math.min(1000000000, x.version)) : 0 })), x => x.modelId),
        acceptedRecordIds: refs(c.acceptedRecordIds), unresolvedRecordIds: refs(c.unresolvedRecordIds),
        criteria: unique(list(c.criteria, LIMITS.criteria).filter(x => util.isPlainObject(x) && id(x.id) && text(x.text) && text(x.owner)).map(x => ({ id: x.id, text: text(x.text, 1000), owner: text(x.owner, 200) })), x => x.id),
        sensitive: c.sensitive === true, reviewed: reviewed(c)
      };
    }
    return out;
  }
  const state = e => sanitizeWorkshop(e && e.workshop, e) || { currentModelId: null, futureModelId: null, agenda: [], designs: [], checkpoint: null };
  const BOOKKEEPING = new Set(["presentation", "createdAt", "updatedAt", "revision", "version"]);
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  function canonical(x) {
    if (Array.isArray(x)) return "[" + x.map(canonical).join(",") + "]";
    if (x && typeof x === "object") return "{" + Object.keys(x).filter(k => !BOOKKEEPING.has(k) && x[k] !== undefined).sort().map(k => JSON.stringify(k) + ":" + canonical(x[k])).join(",") + "}";
    return JSON.stringify(x);
  }
  /** A change detector, not a security hash. Workshop bookkeeping never participates. */
  function fingerprint(e) {
    const w = state(e), ids = [w.currentModelId, w.futureModelId].filter(Boolean);
    const models = (e.models || []).filter(m => !ids.length || ids.includes(m.id)).slice().sort((a, b) => compare(a.id, b.id));
    const records = (e.records || []).filter(r => !r.linkedModelId || !ids.length || ids.includes(r.linkedModelId)).slice().sort((a, b) => compare(a.id, b.id));
    const s = canonical({ modelIds: ids, models, records, designs: w.designs.slice().sort((a, b) => compare(a.modelId + "/" + a.nodeId, b.modelId + "/" + b.nodeId)) });
    let a = 2166136261, b = 3335557771;
    for (let i = 0; i < s.length; i++) { a = Math.imul(a ^ s.charCodeAt(i), 16777619); b = Math.imul(b ^ s.charCodeAt(i), 2246822519); }
    return "ws1-" + (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
  }
  function checkpointStatus(e) {
    const w = state(e), c = w.checkpoint;
    if (!c) return { status: "missing", stale: false, message: "No checkpoint recorded." };
    const stale = c.fingerprint !== fingerprint(e);
    if (stale) return { status: "stale", stale: true, message: "Process, findings or automation designs changed. Review and capture a new checkpoint." };
    if (!w.currentModelId || !c.criteria.length || !reviewedSafe(c)) return { status: "draft", stale: false, message: "Checkpoint is private or awaiting review and acceptance criteria." };
    return { status: "current", stale: false, message: "Checkpoint matches the agreed process and automation designs." };
  }
  function buildPilotBrief(e) {
    const w = state(e), status = checkpointStatus(e);
    const models = (e.models || []).filter(m => [w.currentModelId, w.futureModelId].includes(m.id) && safe(m));
    const exportedModels = models.map(m => ({ id: m.id, name: m.name, role: m.role }));
    const records = (e.records || []).filter(r => safe(r) && r.includeInHandoff !== false &&
      (!r.linkedModelId || models.some(m => m.id === r.linkedModelId)) &&
      (r.linkedNodeIds || []).every(id => {
        const matches = models.filter(m => !r.linkedModelId || m.id === r.linkedModelId).flatMap(m => m.nodes.filter(n => n.id === id));
        return matches.length > 0 && matches.every(n => !n.removed && safe(n));
      }));
    const recordOf = r => ({ id: r.id, title: r.title, owner: r.owner || "", status: r.status || "open" });
    const designs = w.designs.filter(d => reviewedSafe(d) && models.some(m => m.id === d.modelId && m.nodes.some(n => n.id === d.nodeId && !n.removed && safe(n)))).map(d => Object.assign({}, d, { step: models.find(m => m.id === d.modelId).nodes.find(n => n.id === d.nodeId).label }));
    const c = w.checkpoint;
    // A stale checkpoint may contain copied text from a now-excluded item. Hide all its fields.
    const canExport = c && status.status === "current" && models.length === [w.currentModelId, w.futureModelId].filter(Boolean).length;
    return {
      title: "Pilot brief", status: status.status, message: status.message, models: exportedModels, designs,
      checkpoint: canExport ? { reviewer: c.reviewer, date: c.date, fingerprint: c.fingerprint, modelVersions: c.modelVersions, criteria: c.criteria,
        accepted: records.filter(r => c.acceptedRecordIds.includes(r.id)).map(recordOf), unresolved: records.filter(r => c.unresolvedRecordIds.includes(r.id)).map(recordOf) } : null,
      actions: records.filter(r => r.kind === "action").map(recordOf),
      exclusions: "Sensitive items and unreviewed drafts are excluded. Checkpoint details appear only after review while the checkpoint is current."
    };
  }
  function pilotBriefText(e) {
    const b = buildPilotBrief(e), c = b.checkpoint;
    const lines = [b.title, "", b.message, b.exclusions, "", "Agreed process"];
    b.models.forEach(m => lines.push(m.role + ": " + m.name + " (" + m.id + ")"));
    if (c) {
      lines.push("", "Checkpoint", "Reviewer: " + c.reviewer, "Date: " + c.date, "Fingerprint: " + c.fingerprint);
      c.modelVersions.forEach(m => lines.push("Version: " + m.modelId + " v" + m.version));
      lines.push("", "Pilot acceptance criteria"); c.criteria.forEach(x => lines.push("- " + x.text + " | Owner: " + x.owner));
      [ ["Accepted changes", c.accepted], ["Unresolved issues", c.unresolved] ].forEach(([label, xs]) => { lines.push("", label); xs.forEach(x => lines.push("- " + x.title + " | Owner: " + (x.owner || "Unassigned"))); });
    }
    lines.push("", "Automation designs");
    b.designs.forEach(d => { lines.push("", d.step, "Owner: " + (d.owner || "Unassigned"), "Responsibility: " + d.responsibility); DESIGN_FIELDS.forEach(k => lines.push(k + ": " + (d[k] || "Not recorded"))); });
    lines.push("", "Actions"); b.actions.forEach(x => lines.push("- " + x.title + " | Owner: " + (x.owner || "Unassigned") + " | " + x.status));
    return lines.join("\n") + "\n";
  }
  /** Called by the UI after store loads; no store/validate dependency in this factory. */
  function registerStoreCommands(store) {
    const fail = message => { throw new store.helpers.StoreError("invalid", message); };
    const save = (e, w) => { e.workshop = sanitizeWorkshop(w, e); return {}; };
    return store.registerCommands({
      "workshop/setModels"(e, p) {
        const w = state(e);
        for (const [key, role] of [["currentModelId", "current"], ["futureModelId", "future"]]) {
          const v = p[key] || null;
          if (v && !(e.models || []).some(m => m.id === v && m.role === role)) fail("Choose an existing " + role + " process.");
          w[key] = v;
        }
        return save(e, w);
      },
      "workshop/saveAgenda"(e, p) {
        const w = state(e), a = p.agenda;
        if (!Array.isArray(a) || a.length > LIMITS.agenda || a.some(x => !x || !id(x.id) || !text(x.title) || !Number.isInteger(x.minutes) || x.minutes < 1 || x.minutes > 480)) fail("Agenda items need a title and 1 to 480 minutes.");
        if (new Set(a.map(x => x.id)).size !== a.length) fail("Agenda item IDs must be unique.");
        w.agenda = a; return save(e, w);
      },
      "workshop/saveDesign"(e, p) {
        const w = state(e), d = plain(p.design), m = (e.models || []).find(m => m.id === d.modelId);
        if (!m || !m.nodes.some(n => n.id === d.nodeId && !n.removed)) fail("Choose an existing process step.");
        if (!RESPONSIBILITIES.includes(d.responsibility)) fail("Choose who is responsible for this step.");
        if (d.reviewed === true && (!text(d.owner) || DESIGN_FIELDS.some(k => !text(d[k])))) fail("Reviewed designs need an owner and every design field, including fallback and test criteria.");
        const rest = w.designs.filter(x => x.modelId !== d.modelId || x.nodeId !== d.nodeId);
        if (rest.length >= LIMITS.designs) fail("The workshop design limit has been reached.");
        w.designs = rest.concat(d); return save(e, w);
      },
      "workshop/deleteDesign"(e, p) { const w = state(e); w.designs = w.designs.filter(x => x.modelId !== p.modelId || x.nodeId !== p.nodeId); return save(e, w); },
      "workshop/checkpoint"(e, p) {
        const w = state(e), c = plain(p.checkpoint);
        if (!w.currentModelId) fail("Agree a current process before capturing a checkpoint.");
        if (!text(c.reviewer) || !date(c.date)) fail("A checkpoint needs a reviewer and a valid date.");
        if (!Array.isArray(c.criteria) || !c.criteria.length || c.criteria.length > LIMITS.criteria || c.criteria.some(x => !x || !id(x.id) || !text(x.text) || !text(x.owner))) fail("Each pilot acceptance criterion needs text and an owner.");
        if (new Set(c.criteria.map(x => x.id)).size !== c.criteria.length) fail("Acceptance criterion IDs must be unique.");
        const accepted = list(c.acceptedRecordIds, LIMITS.refs), unresolved = list(c.unresolvedRecordIds, LIMITS.refs);
        if (accepted.concat(unresolved).some(id => !(e.records || []).some(r => r.id === id)) || accepted.some(id => unresolved.includes(id))) fail("Choose existing findings, without marking one both accepted and unresolved.");
        w.checkpoint = Object.assign({}, c, { fingerprint: fingerprint(e), modelVersions: e.models.filter(m => [w.currentModelId, w.futureModelId].includes(m.id)).map(m => ({ modelId: m.id, version: m.version || 0 })) });
        return save(e, w);
      },
      "workshop/clearCheckpoint"(e) { const w = state(e); w.checkpoint = null; return save(e, w); }
    });
  }
  return { LIMITS, DESIGN_FIELDS, RESPONSIBILITIES, WORKSHOP_SCHEMA, sanitizeWorkshop, fingerprint, checkpointStatus, buildPilotBrief, pilotBriefText, registerStoreCommands };
});
