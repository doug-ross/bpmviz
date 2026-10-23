/*
 * Benefit checkpoints: figures a delivery team records by hand after a change,
 * such as 30, 60 or 90 days in, when there is no event log to compare. Each
 * one belongs to an opportunity. Pure Node/browser library; loads before
 * validation. The comparison with the business case is in benefits.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./util.js"), require("./schema.js"));
  else { const B = root.AIxRay = root.AIxRay || {}; B.checkpoints = factory(B.util, B.schema); }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, schema) {
  "use strict";
  const LIMIT = schema.LIMITS.checkpoints;
  const LABELS = ["30 days", "60 days", "90 days"];
  const BASES = ["supplied", "observed", "validated"];
  const FIELDS = ["id", "recordId", "label", "date", "hoursPerCaseAfter", "shareOfCasesPct", "annualVolume", "cycleTimeAfterMinutes",
    "oneTimeCostActual", "basis", "source", "note"];
  const plain = x => util.isPlainObject(x) ? x : {};
  const text = (x, max) => typeof x === "string" ? x.slice(0, max).trim() : "";
  const atLeast0 = x => typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null;
  const pct = x => atLeast0(x) !== null && x <= 100 ? x : null;
  function date(x) {
    const s = text(x, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s ? s : "";
  }
  const opportunityIds = e => new Set(((e && e.records) || []).filter(r => r.kind === "opportunity").map(r => r.id));

  /** One checkpoint as bounded plain JSON, or null when it is unusable. */
  function checkpointOf(raw, known) {
    const c = plain(raw);
    if (!util.isValidId(c.id) || !util.isValidId(c.recordId) || (known && !known.has(c.recordId))) return null;
    return {
      id: c.id, recordId: c.recordId, label: text(c.label, 60) || "Checkpoint", date: date(c.date),
      hoursPerCaseAfter: atLeast0(c.hoursPerCaseAfter), shareOfCasesPct: pct(c.shareOfCasesPct), annualVolume: atLeast0(c.annualVolume),
      cycleTimeAfterMinutes: atLeast0(c.cycleTimeAfterMinutes), oneTimeCostActual: atLeast0(c.oneTimeCostActual),
      basis: BASES.includes(c.basis) ? c.basis : "supplied", source: text(c.source, 500), note: text(c.note, 2000)
    };
  }

  /** Returns the checkpoint list, or undefined when the optional field is absent. Checkpoints for missing opportunities are dropped. */
  function sanitizeCheckpoints(raw, e) {
    if (raw === undefined || raw === null) return undefined;
    const known = opportunityIds(e), seen = new Set();
    return (Array.isArray(raw) ? raw.slice(0, LIMIT) : []).map(x => checkpointOf(x, known)).filter(c => {
      if (!c || seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  }

  /* Paths of checkpoints the sanitizer dropped, for the validator's warning. */
  function dropped(raw, e) {
    const known = opportunityIds(e);
    return (Array.isArray(raw) ? raw : []).map((x, i) => checkpointOf(x, known) ? null : "checkpoints[" + i + "]").filter(Boolean);
  }

  /** The checkpoints recorded for one opportunity, earliest date first, undated last. */
  function forRecord(e, recordId) {
    return ((e && e.checkpoints) || []).filter(c => c.recordId === recordId)
      .sort((a, b) => (a.date || "9999") < (b.date || "9999") ? -1 : (a.date || "9999") > (b.date || "9999") ? 1 : 0);
  }

  /** Store command handlers. The store adds them to its own commands. */
  function commands(StoreError) {
    const fail = message => { throw new StoreError("invalid", message); };
    const listOf = e => { if (!Array.isArray(e.checkpoints)) e.checkpoints = []; return e.checkpoints; };
    return {
      "checkpoint/save"(e, p) {
        const raw = plain(p.checkpoint), all = listOf(e);
        const record = (e.records || []).find(r => r.id === raw.recordId && r.kind === "opportunity");
        if (!record) fail("Choose an opportunity for this checkpoint.");
        const existing = raw.id ? all.find(c => c.id === raw.id) : null;
        if (raw.id && !existing) throw new StoreError("not-found", "That checkpoint no longer exists.");
        if (!existing && all.length >= LIMIT) fail("A project can hold up to " + LIMIT + " checkpoints.");
        if (atLeast0(raw.hoursPerCaseAfter) === null) fail("Enter the hands-on hours per affected case after the change, 0 or more.");
        if (raw.shareOfCasesPct !== undefined && raw.shareOfCasesPct !== null && pct(raw.shareOfCasesPct) === null) fail("The share of cases must be between 0 and 100.");
        [["annualVolume", "Cases per year"], ["cycleTimeAfterMinutes", "Cycle time"], ["oneTimeCostActual", "The actual one-time cost"]].forEach(([k, label]) => {
          if (raw[k] !== undefined && raw[k] !== null && atLeast0(raw[k]) === null) fail(label + " must be 0 or more.");
        });
        if (text(raw.date, 10) && !date(raw.date)) fail("Use a valid date for the checkpoint.");
        if (raw.basis !== undefined && !BASES.includes(raw.basis)) fail("Choose Provided, Measured or Confirmed.");
        const id = existing ? existing.id : util.uniqueId("cp-" + util.slug(record.id + "-" + (text(raw.label, 60) || "checkpoint"), 40), new Set(all.map(c => c.id)));
        const cp = checkpointOf(Object.assign({}, raw, { id }), null);
        if (existing) all[all.indexOf(existing)] = cp; else all.push(cp);
        return { id };
      },
      "checkpoint/delete"(e, p) {
        const all = listOf(e), before = all.length;
        e.checkpoints = all.filter(c => c.id !== p.id);
        if (e.checkpoints.length === before) throw new StoreError("not-found", "That checkpoint no longer exists.");
        return { id: p.id };
      }
    };
  }

  return { FIELDS, LABELS, BASES, sanitizeCheckpoints, checkpointOf, dropped, forRecord, commands };
});
