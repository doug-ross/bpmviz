/*
 * Value goals: what value means to the client, such as more revenue, a lower
 * cost per case or a new capability. Opportunities link to the goals they
 * serve. Pure Node/browser library; loads before validation.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./util.js"), require("./schema.js"));
  else { const B = root.AIxRay = root.AIxRay || {}; B.goals = factory(B.util, B.schema); }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, schema) {
  "use strict";
  const LIMIT = schema.LIMITS.goals;
  const TEXT = { title: 300, metric: 300, unit: 40, owner: 200, source: 500, quote: 300, note: 2000 };
  const FIELDS = ["id", "kind", "title", "metric", "baseline", "target", "unit", "by", "owner", "basis", "source", "quote", "note", "sensitive", "generated"];
  const plain = x => util.isPlainObject(x) ? x : {};
  const text = (x, max) => typeof x === "string" ? x.slice(0, max).trim() : "";
  const number = x => typeof x === "number" && Number.isFinite(x) ? x : null;
  const oneOf = (name, v, fallback) => schema.ENUMS[name].includes(v) ? v : fallback;
  function date(x) {
    const s = text(x, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s ? s : "";
  }

  /* The same marker records carry when an AI assistant drafted them. */
  function generatedOf(g) {
    if (!util.isPlainObject(g)) return undefined;
    return {
      task: oneOf("aiTask", g.task, schema.ENUMS.aiTask[0]), provider: oneOf("aiProvider", g.provider, "other"),
      model: text(g.model, 120), surface: oneOf("aiSurface", g.surface, schema.ENUMS.aiSurface[0]),
      at: text(g.at, 40), jobId: text(g.jobId, 80), plan: oneOf("aiPlan", g.plan, "unknown"),
      reviewed: g.reviewed === true, reviewedAt: text(g.reviewedAt, 40)
    };
  }

  /** One goal as bounded plain JSON, or null when it has no valid ID or title. */
  function goalOf(raw) {
    const g = plain(raw);
    if (!util.isValidId(g.id) || !text(g.title, TEXT.title)) return null;
    const out = {
      id: g.id, kind: oneOf("goalKind", g.kind, "other"), title: text(g.title, TEXT.title), metric: text(g.metric, TEXT.metric),
      baseline: number(g.baseline), target: number(g.target), unit: text(g.unit, TEXT.unit), by: date(g.by),
      owner: text(g.owner, TEXT.owner), basis: oneOf("assumptionStatus", g.basis, "illustrative"),
      source: text(g.source, TEXT.source), quote: text(g.quote, TEXT.quote), note: text(g.note, TEXT.note),
      sensitive: g.sensitive === true
    };
    const generated = generatedOf(g.generated);
    if (generated) out.generated = generated;
    return out;
  }

  /** Returns the goals list, or undefined when the optional field is absent. */
  function sanitizeGoals(raw) {
    if (raw === undefined || raw === null) return undefined;
    const seen = new Set();
    return (Array.isArray(raw) ? raw.slice(0, LIMIT) : []).map(goalOf).filter(g => {
      if (!g || seen.has(g.id)) return false;
      seen.add(g.id);
      return true;
    });
  }

  /* Counts the fields a file had that were not kept, for the validator's note. */
  function ignoredKeys(raw) {
    const out = [];
    (Array.isArray(raw) ? raw : []).forEach((g, i) => Object.keys(plain(g)).forEach(k => { if (!FIELDS.includes(k)) out.push("goals[" + i + "]." + k); }));
    return out;
  }

  const isUnreviewedAi = g => !!(g && g.generated && g.generated.reviewed !== true);
  const list = e => (e && Array.isArray(e.goals) ? e.goals : []);

  /** Goals a report may show: sensitive goals and unreviewed AI drafts only when asked for. */
  function visibleGoals(e, opts) {
    const o = opts || {};
    return list(e).filter(g => (o.includeSensitive || !g.sensitive) && (o.includeUnreviewedAi || !isUnreviewedAi(g)));
  }

  /** The visible goals an opportunity serves, in the project's order. */
  function goalsFor(e, record, opts) {
    const ids = new Set(record && record.opportunity && Array.isArray(record.opportunity.goalIds) ? record.opportunity.goalIds : []);
    return visibleGoals(e, opts).filter(g => ids.has(g.id));
  }

  /** The open opportunities that serve a goal. */
  function servedBy(e, goalId) {
    return ((e && e.records) || []).filter(r => r.kind === "opportunity" && r.status !== "dropped" &&
      r.opportunity && Array.isArray(r.opportunity.goalIds) && r.opportunity.goalIds.includes(goalId));
  }

  /** "From 12 to 8 days", "Target $50,000", "Today 4 days", or "" when neither figure is set. */
  function targetText(g) {
    const f = v => g.unit === "$" ? "$" + util.formatNumber(v, 2) : util.formatNumber(v, 2) + (g.unit ? " " + g.unit : "");
    if (g.baseline !== null && g.target !== null) return "From " + f(g.baseline) + " to " + f(g.target);
    if (g.target !== null) return "Target " + f(g.target);
    if (g.baseline !== null) return "Today " + f(g.baseline);
    return "";
  }

  /** Keeps only goal IDs that exist in e, without duplicates. */
  function cleanGoalIds(ids, e) {
    const known = new Set(list(e).map(g => g.id));
    return [...new Set((Array.isArray(ids) ? ids : []).filter(id => util.isValidId(id) && known.has(id)))];
  }

  function unlink(e, goalIds) {
    const drop = new Set(goalIds);
    (e.records || []).forEach(r => {
      if (r.opportunity && Array.isArray(r.opportunity.goalIds)) r.opportunity.goalIds = r.opportunity.goalIds.filter(id => !drop.has(id));
    });
  }

  function link(e, goalId, recordIds) {
    (recordIds || []).forEach(rid => {
      const r = (e.records || []).find(x => x.id === rid && x.kind === "opportunity" && x.opportunity);
      if (!r) return;
      const ids = Array.isArray(r.opportunity.goalIds) ? r.opportunity.goalIds : [];
      if (!ids.includes(goalId)) r.opportunity.goalIds = ids.concat(goalId);
    });
  }

  /** Store command handlers. The store adds them to its own commands. */
  function commands(StoreError) {
    const fail = message => { throw new StoreError("invalid", message); };
    const goalsOf = e => { if (!Array.isArray(e.goals)) e.goals = []; return e.goals; };
    return {
      "goal/save"(e, p) {
        const raw = plain(p.goal), all = goalsOf(e);
        if (!text(raw.title, TEXT.title)) fail("A goal needs a title.");
        const existing = raw.id ? all.find(g => g.id === raw.id) : null;
        if (raw.id && !existing) throw new StoreError("not-found", "That goal no longer exists.");
        if (!existing && all.length >= LIMIT) fail("A project can hold up to " + LIMIT + " goals.");
        if (raw.baseline !== undefined && raw.baseline !== null && number(raw.baseline) === null) fail("Today's figure must be a number.");
        if (raw.target !== undefined && raw.target !== null && number(raw.target) === null) fail("The target must be a number.");
        if (text(raw.by, 10) && !date(raw.by)) fail("Use a valid date for when the goal should be met.");
        const id = existing ? existing.id : util.uniqueId("goal-" + util.slug(raw.title, 30), new Set(all.map(g => g.id)));
        const goal = goalOf(Object.assign({}, raw, { id, generated: existing ? existing.generated : undefined }));
        if (goal.generated && typeof p.aiReviewed === "boolean") {
          goal.generated.reviewed = p.aiReviewed;
          goal.generated.reviewedAt = p.aiReviewed ? util.nowIso() : "";
        }
        if (existing) all[all.indexOf(existing)] = goal; else all.push(goal);
        if (Array.isArray(p.servedByRecordIds)) {
          unlink(e, [id]);
          link(e, id, p.servedByRecordIds);
        }
        return { id };
      },
      "goal/delete"(e, p) {
        const all = goalsOf(e), before = all.length;
        e.goals = all.filter(g => g.id !== p.id);
        if (e.goals.length === before) throw new StoreError("not-found", "That goal no longer exists.");
        unlink(e, [p.id]);
        return { id: p.id };
      },
      "goal/markReviewed"(e, p) {
        const ids = new Set(Array.isArray(p.ids) ? p.ids : []), reviewed = p.reviewed !== false, at = util.nowIso();
        let changed = 0;
        goalsOf(e).forEach(g => {
          if (!ids.has(g.id) || !g.generated || g.generated.reviewed === reviewed) return;
          g.generated.reviewed = reviewed;
          g.generated.reviewedAt = reviewed ? at : "";
          changed++;
        });
        return { changed };
      },
      /* AI suggestions become goals in one step, each marked as an AI draft, and are linked to the opportunities they name. */
      "goal/applySuggestions"(e, p) {
        const items = Array.isArray(p.goals) ? p.goals : [];
        if (!items.length) fail("Select at least one goal to add.");
        const all = goalsOf(e);
        if (all.length + items.length > LIMIT) fail("A project can hold up to " + LIMIT + " goals.");
        const taken = new Set(all.map(g => g.id)), ids = [];
        items.forEach(item => {
          const raw = plain(item.goal || item);
          const id = util.uniqueId("goal-" + util.slug(raw.title, 30), taken);
          const goal = goalOf(Object.assign({}, raw, { id, generated: Object.assign({}, p.stamp || {}, { reviewed: false, reviewedAt: "" }) }));
          if (!goal) fail("Each goal needs a title.");
          all.push(goal);
          link(e, id, item.servedByRecordIds);
          ids.push(id);
        });
        return { ids };
      }
    };
  }

  return { FIELDS, TEXT, sanitizeGoals, goalOf, ignoredKeys, isUnreviewedAi, visibleGoals, goalsFor, servedBy, targetText, cleanGoalIds, commands };
});
