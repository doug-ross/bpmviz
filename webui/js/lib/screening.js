/*
 * AIxRay screening: score several candidate processes against weighted
 * criteria to choose the first one to work on. A screening is its own file
 * (schema "aixray.screening", version 1), separate from any engagement,
 * because assumptions, scenarios and figures belong to one process.
 *
 * As elsewhere in AIxRay: a missing score or fact leaves the result blank,
 * unknown is never zero, and every result carries the weakest basis of its
 * inputs. A flagged candidate is kept in the ranking with its flags.
 *
 * Every change function returns a new screening and leaves its input as it
 * was, so a view can keep earlier versions for undo. Pure Node/browser
 * library: no DOM or network access.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./util.js"), require("./schema.js"), require("./economics.js"),
      require("./value-case.js"), require("./validate.js"), require("./process-builder.js"));
  } else {
    const B = root.AIxRay = root.AIxRay || {};
    B.screening = factory(B.util, B.schema, B.economics, B.valueCase, B.validate, B.processBuilder);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, schema, economics, valueCase, validate, processBuilder) {
  "use strict";

  const SCREENING_ID = "aixray.screening";
  const SCREENING_VERSION = 1;
  const LIMITS = { candidates: 50, criteria: 30, text: 2000 };
  const SCALE = { min: 1, max: 5 };
  const WEIGHT_MAX = 10;
  const GROUPS = [["value", "Value"], ["feasibility", "Feasibility"], ["readiness", "Readiness and risk"]];
  const GROUP_IDS = GROUPS.map(g => g[0]);
  const BASES = schema.ENUMS.assumptionStatus;
  const FACTS = [
    { key: "annualVolume", label: "Cases per year", unit: "casesPerYear" },
    { key: "effortHoursPerCase", label: "Hands-on hours per case", unit: "hour" },
    { key: "hourlyRate", label: "Fully loaded hourly rate", unit: "currencyPerHour" }
  ];
  const FACT_KEYS = FACTS.map(f => f.key);
  /* A score of 3 or more on average puts a candidate on the high side of an axis. */
  const HIGH_FROM = 50;
  const QUADRANTS = {
    "start-here": "Start here",
    "larger-effort": "Worth it, harder to start",
    "easy-small": "Easy, smaller value",
    "not-now": "Not now"
  };
  const STABILITY_STEP = 0.2;

  /* Every criterion is worded so that a higher score is better. */
  const DEFAULT_CRITERIA = [
    { id: "volume", group: "value", weight: 3, gateAtOrBelow: null, label: "Volume and effort",
      help: "How much work the process takes each year.",
      anchors: { 1: "A few cases a month, minutes each", 3: "Daily work for a small team", 5: "Several people full time" } },
    { id: "pain", group: "value", weight: 2, gateAtOrBelow: null, label: "Pain today",
      help: "How much delays, errors or rework cost the client and its customers.",
      anchors: { 1: "Works well enough", 3: "Known complaints or backlog", 5: "Missed deadlines, penalties or lost customers" } },
    { id: "priority", group: "value", weight: 1, gateAtOrBelow: null, label: "Fit with the client's priorities",
      help: "Whether leadership already wants this process improved.",
      anchors: { 1: "Not on anyone's list", 3: "Mentioned in plans", 5: "A named priority this year" } },
    { id: "rules", group: "feasibility", weight: 2, gateAtOrBelow: null, label: "Clear rules or patterns",
      help: "Whether people follow rules, checklists or recognisable patterns to do the work.",
      anchors: { 1: "Mostly expert judgment", 3: "Rules with frequent judgment calls", 5: "Written rules cover most cases" } },
    { id: "inputs", group: "feasibility", weight: 2, gateAtOrBelow: null, label: "Usable inputs",
      help: "Whether the documents and data the work starts from are digital and readable.",
      anchors: { 1: "Paper, handwriting or calls", 3: "Digital but unstructured, such as email and PDF", 5: "Structured forms or system records" } },
    { id: "systems", group: "feasibility", weight: 1, gateAtOrBelow: null, label: "Access to the systems",
      help: "Whether the systems involved can be read and updated by a tool.",
      anchors: { 1: "No access in sight", 3: "User access or file exports", 5: "Documented interfaces" } },
    { id: "exceptions", group: "feasibility", weight: 1, gateAtOrBelow: null, label: "Few exceptions",
      help: "How many cases follow the main path without special handling.",
      anchors: { 1: "Most cases are special", 3: "About a third need special handling", 5: "Almost all follow the main path" } },
    { id: "sponsor", group: "readiness", weight: 2, gateAtOrBelow: 1, label: "Sponsor and process experts",
      help: "Whether someone will own the change and the people who do the work can take part.",
      anchors: { 1: "No sponsor", 3: "A sponsor, experts hard to reach", 5: "An engaged sponsor and available experts" } },
    { id: "risk", group: "readiness", weight: 2, gateAtOrBelow: null, label: "Low risk if it goes wrong",
      help: "The harm when an automated or AI-assisted step makes a mistake.",
      anchors: { 1: "Regulatory, safety or large financial harm", 3: "Rework a person would catch", 5: "Easy to spot and reverse" } },
    { id: "measurable", group: "readiness", weight: 1, gateAtOrBelow: null, label: "A baseline can be measured",
      help: "Whether today's volumes and times can be measured, so a pilot can prove its effect.",
      anchors: { 1: "No reliable figures", 3: "Counts and estimates", 5: "A system log of the process" } }
  ];

  /*
   * Value that belongs to a portfolio of changes rather than to one process
   * (docs/value-dimensions.md): offered as extra criteria, not in the
   * default set, so a screening that does not use them scores as before.
   */
  const PORTFOLIO_CRITERIA = [
    { id: "reuse", group: "value", weight: 1, gateAtOrBelow: null, label: "Reuse in other processes",
      help: "Whether what gets built here, such as document reading, a rules check or an integration, would make later changes cheaper.",
      anchors: { 1: "Built for this process only", 3: "Parts could serve one or two other processes", 5: "A shared component several processes are waiting for" } },
    { id: "workingCapital", group: "value", weight: 1, gateAtOrBelow: null, label: "Cash tied up by the process",
      help: "Whether a faster process frees cash: invoices sent sooner, payments collected sooner, less stock or work in progress.",
      anchors: { 1: "No effect on cash", 3: "Some days of billing or collection at stake", 5: "Large balances wait on this process" } },
    { id: "learning", group: "value", weight: 1, gateAtOrBelow: null, label: "What a pilot would teach",
      help: "Whether a pilot answers a question the client needs answered before a larger program, at a cost it can afford to lose.",
      anchors: { 1: "Nothing new to learn", 3: "Tests one open assumption", 5: "Settles the key question for a larger program" } }
  ];

  class ScreeningError extends Error {
    constructor(message) { super(message); this.name = "ScreeningError"; this.code = "invalid"; }
  }
  const fail = message => { throw new ScreeningError(message); };

  const plain = x => util.isPlainObject(x) ? x : {};
  const text = (x, max) => typeof x === "string" ? x.slice(0, max || LIMITS.text).trim() : "";
  const list = (x, max) => Array.isArray(x) ? x.slice(0, max) : [];
  const basisOf = x => BASES.includes(x) ? x : "illustrative";
  const enumOr = (name, x, fallback) => schema.ENUMS[name].includes(x) ? x : fallback;
  const nonNegative = x => util.isFiniteNumber(x) && x >= 0 ? x : null;
  const scoreValue = x => Number.isInteger(x) && x >= SCALE.min && x <= SCALE.max ? x : null;
  const weightValue = x => util.isFiniteNumber(x) ? util.clamp(x, 0, WEIGHT_MAX) : 1;
  const gateValue = x => Number.isInteger(x) && x >= SCALE.min && x < SCALE.max ? x : null;

  /* ---------- File shape ---------- */

  const ID = { type: "string", pattern: util.ID_PATTERN.source, maxLength: 80 };
  const str = maxLength => ({ type: "string", maxLength });
  const basisSchema = { enum: BASES };
  const factSchema = { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, required: ["value", "basis"],
    properties: { value: { type: ["number", "null"], minimum: 0 }, basis: basisSchema, note: str(500) } }] };
  const factsSchema = { type: "object", additionalProperties: false, properties: Object.fromEntries(FACT_KEYS.map(k => [k, factSchema])) };
  const SCREENING_SCHEMA = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://aixray.local/schema/screening.schema.json",
    title: "AIxRay screening",
    description: "Candidate processes scored against weighted criteria to choose where to start, schema version 1. " +
      "webui/js/lib/screening.js enforces this contract. Scores run from 1 to 5 and a higher score is always better.",
    type: "object",
    required: ["schema", "schemaVersion", "id", "criteria", "candidates"],
    additionalProperties: false,
    properties: {
      schema: { const: SCREENING_ID },
      schemaVersion: { const: SCREENING_VERSION },
      id: ID,
      revision: { type: "integer", minimum: 0 },
      createdAt: str(40), updatedAt: str(40),
      meta: { type: "object", additionalProperties: false, properties: {
        title: str(200), clientDisplayName: str(200), confidentiality: { enum: schema.ENUMS.confidentiality },
        dataStatus: { enum: schema.ENUMS.dataStatus }, currency: { type: "string", pattern: "^[A-Z]{3}$" },
        hourlyRate: factSchema, note: str(LIMITS.text)
      } },
      criteria: { type: "array", maxItems: LIMITS.criteria, items: { type: "object", additionalProperties: false, required: ["id", "label", "group", "weight"], properties: {
        id: ID, label: str(300), group: { enum: GROUP_IDS }, weight: { type: "number", minimum: 0, maximum: WEIGHT_MAX },
        gateAtOrBelow: { type: ["integer", "null"], minimum: SCALE.min, maximum: SCALE.max - 1,
          description: "A score at or below this flags the candidate. The candidate stays in the ranking." },
        help: str(1000),
        anchors: { type: "object", additionalProperties: false, properties: { 1: str(300), 3: str(300), 5: str(300) } }
      } } },
      candidates: { type: "array", maxItems: LIMITS.candidates, items: { type: "object", additionalProperties: false, required: ["id", "name"], properties: {
        id: ID, name: str(200), owner: str(200), description: str(LIMITS.text),
        confidentiality: { enum: [""].concat(schema.ENUMS.confidentiality), description: "Empty means the screening's confidentiality." },
        sensitive: { type: "boolean" },
        facts: factsSchema,
        scores: { type: "object", description: "Score per criterion ID.", additionalProperties: { type: "object", additionalProperties: false, required: ["value"], properties: {
          value: { type: ["integer", "null"], minimum: SCALE.min, maximum: SCALE.max }, basis: basisSchema, note: str(1000),
          aiDraft: { type: "boolean", description: "True for a score drafted with AI that no one has reviewed yet." }
        } } },
        source: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, required: ["engagementId"],
          description: "Figures copied from a project file when the candidate was added from it. The project itself is not stored.",
          properties: {
            engagementId: ID, engagementRevision: { type: ["integer", "null"], minimum: 0 }, fileName: str(260), takenAt: str(40),
            processName: str(200), dataStatus: { enum: schema.ENUMS.dataStatus }, confidentiality: { enum: schema.ENUMS.confidentiality },
            steps: { type: "integer", minimum: 0 }, stepsWithEffort: { type: "integer", minimum: 0 },
            opportunities: { type: "integer", minimum: 0 }, hasEventLog: { type: "boolean" },
            topOpportunity: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, properties: {
              title: str(300), value: { type: "number" }, unit: { enum: ["currency", "hour"] }, basis: basisSchema
            } }] }
          } }] }
      } } }
    }
  };

  function sanitizeFact(raw) {
    if (!util.isPlainObject(raw)) return null;
    const value = nonNegative(raw.value);
    return { value, basis: basisOf(raw.basis), note: text(raw.note, 500) };
  }

  function sanitizeCriterion(raw) {
    const c = plain(raw);
    if (!util.isValidId(c.id) || !text(c.label, 300)) return null;
    const a = plain(c.anchors);
    return {
      id: c.id, label: text(c.label, 300), group: GROUP_IDS.includes(c.group) ? c.group : "value",
      weight: weightValue(c.weight), gateAtOrBelow: gateValue(c.gateAtOrBelow), help: text(c.help, 1000),
      anchors: { 1: text(a[1], 300), 3: text(a[3], 300), 5: text(a[5], 300) }
    };
  }

  function sanitizeSource(raw) {
    if (!util.isPlainObject(raw) || !util.isValidId(raw.engagementId)) return null;
    const count = x => Number.isInteger(x) && x >= 0 ? x : 0;
    const t = plain(raw.topOpportunity);
    const top = text(t.title, 300) && util.isFiniteNumber(t.value) && ["currency", "hour"].includes(t.unit)
      ? { title: text(t.title, 300), value: t.value, unit: t.unit, basis: basisOf(t.basis) } : null;
    return {
      engagementId: raw.engagementId,
      engagementRevision: Number.isInteger(raw.engagementRevision) && raw.engagementRevision >= 0 ? raw.engagementRevision : null,
      fileName: text(raw.fileName, 260), takenAt: text(raw.takenAt, 40), processName: text(raw.processName, 200),
      dataStatus: enumOr("dataStatus", raw.dataStatus, "supplied"), confidentiality: enumOr("confidentiality", raw.confidentiality, "internal"),
      steps: count(raw.steps), stepsWithEffort: count(raw.stepsWithEffort), opportunities: count(raw.opportunities),
      hasEventLog: raw.hasEventLog === true, topOpportunity: top
    };
  }

  function sanitizeCandidate(raw, criterionIds) {
    const c = plain(raw);
    if (!util.isValidId(c.id) || !text(c.name, 200)) return null;
    const f = plain(c.facts), s = plain(c.scores), scores = {};
    Object.keys(s).forEach(key => {
      if (!criterionIds.has(key) || !util.isPlainObject(s[key])) return;
      scores[key] = { value: scoreValue(s[key].value), basis: basisOf(s[key].basis), note: text(s[key].note, 1000), aiDraft: s[key].aiDraft === true };
    });
    return {
      id: c.id, name: text(c.name, 200), owner: text(c.owner, 200), description: text(c.description),
      confidentiality: c.confidentiality === "" ? "" : enumOr("confidentiality", c.confidentiality, ""),
      sensitive: c.sensitive === true,
      facts: Object.fromEntries(FACT_KEYS.map(k => [k, sanitizeFact(f[k])])),
      scores, source: sanitizeSource(c.source)
    };
  }

  /** Bounded plain JSON in the current shape: { screening, warnings }. */
  function sanitizeScreening(raw) {
    const r = plain(raw), m = plain(r.meta), warnings = [];
    const unique = (items, what) => {
      const seen = new Set();
      return items.filter(x => {
        if (seen.has(x.id)) { warnings.push({ code: "duplicate", message: "A second " + what + " with the ID " + x.id + " was left out." }); return false; }
        seen.add(x.id); return true;
      });
    };
    const rawCriteria = Array.isArray(r.criteria) ? r.criteria : util.clone(DEFAULT_CRITERIA);
    if (rawCriteria.length > LIMITS.criteria) warnings.push({ code: "limit", message: "Only the first " + LIMITS.criteria + " criteria were kept." });
    const criteria = unique(list(rawCriteria, LIMITS.criteria).map(sanitizeCriterion).filter(Boolean), "criterion");
    const droppedCriteria = list(rawCriteria, LIMITS.criteria).length - criteria.length;
    if (droppedCriteria > 0) warnings.push({ code: "dropped", message: droppedCriteria + " criteria without a valid ID or label were left out." });
    const ids = new Set(criteria.map(c => c.id));
    const rawCandidates = list(r.candidates, Infinity);
    if (rawCandidates.length > LIMITS.candidates) warnings.push({ code: "limit", message: "Only the first " + LIMITS.candidates + " candidates were kept." });
    const kept = list(rawCandidates, LIMITS.candidates);
    const candidates = unique(kept.map(c => sanitizeCandidate(c, ids)).filter(Boolean), "candidate");
    const droppedCandidates = kept.length - candidates.length;
    if (droppedCandidates > 0) warnings.push({ code: "dropped", message: droppedCandidates + " candidates without a valid ID or name were left out." });
    const screening = {
      schema: SCREENING_ID, schemaVersion: SCREENING_VERSION,
      id: util.isValidId(r.id) ? r.id : util.uid("scr"),
      revision: Number.isInteger(r.revision) && r.revision >= 0 ? r.revision : 0,
      createdAt: text(r.createdAt, 40) || util.nowIso(), updatedAt: text(r.updatedAt, 40) || util.nowIso(),
      meta: {
        title: text(m.title, 200) || "Process screening", clientDisplayName: text(m.clientDisplayName, 200),
        confidentiality: enumOr("confidentiality", m.confidentiality, "internal"),
        dataStatus: enumOr("dataStatus", m.dataStatus, "supplied"),
        currency: typeof m.currency === "string" && /^[A-Z]{3}$/.test(m.currency) ? m.currency : "USD",
        hourlyRate: sanitizeFact(m.hourlyRate), note: text(m.note)
      },
      criteria, candidates
    };
    return { screening, warnings };
  }

  /**
   * Opens a screening from text or parsed JSON:
   * { ok, errors: [message], warnings: [{ code, message }], screening }.
   */
  function parseScreening(input) {
    let raw = input;
    if (typeof input === "string") {
      try { raw = JSON.parse(input); } catch (err) { return { ok: false, errors: ["This file is not valid JSON."], warnings: [], screening: null }; }
    }
    if (!util.isPlainObject(raw)) return { ok: false, errors: ["This file does not hold a screening."], warnings: [], screening: null };
    if (raw.schema !== SCREENING_ID) return { ok: false, errors: ["This file is not an AIxRay screening."], warnings: [], screening: null };
    if (!Number.isInteger(raw.schemaVersion) || raw.schemaVersion > SCREENING_VERSION) {
      return { ok: false, errors: ["This screening was saved by a newer version of AIxRay."], warnings: [], screening: null };
    }
    const out = sanitizeScreening(raw);
    return { ok: true, errors: [], warnings: out.warnings, screening: out.screening };
  }

  function blankScreening(meta) {
    const m = meta || {};
    const now = util.nowIso();
    return sanitizeScreening({
      schema: SCREENING_ID, schemaVersion: SCREENING_VERSION, id: m.id || util.uid("scr"), revision: 0,
      createdAt: now, updatedAt: now, meta: m, criteria: util.clone(DEFAULT_CRITERIA), candidates: []
    }).screening;
  }

  /* ---------- Changes ---------- */

  function change(s, fn) {
    const next = util.clone(s);
    const result = fn(next) || {};
    next.revision = (next.revision || 0) + 1;
    next.updatedAt = util.nowIso();
    return Object.assign({ screening: next }, result);
  }

  function candidateIn(s, id) {
    return s.candidates.find(c => c.id === id) || fail("That candidate is not in the screening.");
  }

  function criterionIn(s, id) {
    return s.criteria.find(c => c.id === id) || fail("That criterion is not in the screening.");
  }

  function takenIds(items) {
    return new Set(items.map(x => x.id));
  }

  function emptyFacts() {
    return Object.fromEntries(FACT_KEYS.map(k => [k, null]));
  }

  /** Adds a candidate: { screening, candidateId }. fields: { name, owner, description, confidentiality, sensitive, facts }. */
  function addCandidate(s, fields) {
    const f = plain(fields);
    const name = text(f.name, 200) || fail("Give the candidate a name.");
    if (s.candidates.length >= LIMITS.candidates) fail("A screening holds at most " + LIMITS.candidates + " candidates.");
    return change(s, next => {
      const id = util.uniqueId("c-" + util.slug(name, 40), takenIds(next.candidates));
      const c = sanitizeCandidate({ id, name, owner: f.owner, description: f.description, confidentiality: f.confidentiality || "",
        sensitive: f.sensitive, facts: f.facts || emptyFacts(), scores: {}, source: f.source || null }, takenIds(next.criteria));
      next.candidates.push(c);
      return { candidateId: id };
    });
  }

  /** Changes a candidate's name, owner, description, confidentiality, sensitivity or facts. */
  function updateCandidate(s, id, patch) {
    candidateIn(s, id);
    const p = plain(patch);
    if (p.name !== undefined && !text(p.name, 200)) fail("Give the candidate a name.");
    if (p.facts !== undefined) {
      Object.keys(plain(p.facts)).forEach(k => {
        if (!FACT_KEYS.includes(k)) fail("Unknown fact.");
        const v = p.facts[k];
        if (v !== null && (!util.isPlainObject(v) || (v.value !== null && nonNegative(v.value) === null))) fail("Enter zero or a positive number.");
      });
    }
    return change(s, next => {
      const c = candidateIn(next, id);
      ["name", "owner", "description", "confidentiality", "sensitive"].forEach(k => { if (p[k] !== undefined) c[k] = p[k]; });
      if (p.facts !== undefined) c.facts = Object.assign({}, c.facts, p.facts);
      Object.assign(c, sanitizeCandidate(c, takenIds(next.criteria)));
    });
  }

  function removeCandidate(s, id) {
    candidateIn(s, id);
    return change(s, next => { next.candidates = next.candidates.filter(c => c.id !== id); });
  }

  /**
   * Sets one score. score: { value (1 to 5, or null to clear), basis, note,
   * aiDraft }. A score a person sets is theirs: it is no longer an AI draft
   * unless aiDraft is passed as true.
   */
  function setScore(s, candidateId, criterionId, score) {
    candidateIn(s, candidateId); criterionIn(s, criterionId);
    const p = plain(score);
    if (p.value !== null && p.value !== undefined && scoreValue(p.value) === null) fail("Scores run from " + SCALE.min + " to " + SCALE.max + ".");
    return change(s, next => {
      const c = candidateIn(next, candidateId), old = c.scores[criterionId] || { value: null, basis: "illustrative", note: "" };
      const merged = { value: p.value === undefined ? old.value : p.value, basis: p.basis === undefined ? old.basis : p.basis, note: p.note === undefined ? old.note : p.note };
      c.scores[criterionId] = { value: scoreValue(merged.value), basis: basisOf(merged.basis), note: text(merged.note, 1000), aiDraft: p.aiDraft === true };
    });
  }

  /** Marks AI-drafted scores as reviewed: one score, one candidate's, or (with no candidateId) all of them. */
  function reviewAiScores(s, candidateId, criterionId) {
    if (candidateId) candidateIn(s, candidateId);
    if (criterionId) criterionIn(s, criterionId);
    return change(s, next => {
      let reviewed = 0;
      next.candidates.filter(c => !candidateId || c.id === candidateId).forEach(c => {
        Object.keys(c.scores).filter(k => !criterionId || k === criterionId).forEach(k => {
          if (c.scores[k].aiDraft) { c.scores[k].aiDraft = false; reviewed++; }
        });
      });
      return { reviewed };
    });
  }

  /** How many scores are unreviewed AI drafts, in one candidate or in the whole screening. */
  function aiDraftCount(s, candidateId) {
    return s.candidates.filter(c => !candidateId || c.id === candidateId)
      .reduce((n, c) => n + Object.values(c.scores).filter(x => x.aiDraft && x.value !== null).length, 0);
  }

  /** Changes a criterion's label, group, weight, gate, help or anchors. */
  function updateCriterion(s, id, patch) {
    criterionIn(s, id);
    const p = plain(patch);
    if (p.label !== undefined && !text(p.label, 300)) fail("Give the criterion a name.");
    if (p.group !== undefined && !GROUP_IDS.includes(p.group)) fail("Choose value, feasibility or readiness.");
    if (p.weight !== undefined && !(util.isFiniteNumber(p.weight) && p.weight >= 0 && p.weight <= WEIGHT_MAX)) fail("Weights run from 0 to " + WEIGHT_MAX + ".");
    if (p.gateAtOrBelow !== undefined && p.gateAtOrBelow !== null && gateValue(p.gateAtOrBelow) === null) fail("A flag applies to a score from " + SCALE.min + " to " + (SCALE.max - 1) + ".");
    return change(s, next => {
      const c = criterionIn(next, id);
      ["label", "group", "weight", "gateAtOrBelow", "help", "anchors"].forEach(k => { if (p[k] !== undefined) c[k] = p[k]; });
      Object.assign(c, sanitizeCriterion(c));
    });
  }

  /** Adds a criterion: { screening, criterionId }. */
  function addCriterion(s, fields) {
    const f = plain(fields);
    const label = text(f.label, 300) || fail("Give the criterion a name.");
    if (s.criteria.length >= LIMITS.criteria) fail("A screening holds at most " + LIMITS.criteria + " criteria.");
    if (f.group !== undefined && !GROUP_IDS.includes(f.group)) fail("Choose value, feasibility or readiness.");
    return change(s, next => {
      const id = util.uniqueId(util.slug(label, 40), takenIds(next.criteria));
      next.criteria.push(sanitizeCriterion(Object.assign({ weight: 1 }, f, { id, label })));
      return { criterionId: id };
    });
  }

  /** Adds the portfolio criteria not in the screening yet: { screening, added: [ids] }. */
  function addPortfolioCriteria(s) {
    const have = new Set(s.criteria.map(c => c.id));
    const missing = PORTFOLIO_CRITERIA.filter(c => !have.has(c.id));
    if (!missing.length) fail("The portfolio criteria are already in this screening.");
    if (s.criteria.length + missing.length > LIMITS.criteria) fail("A screening holds at most " + LIMITS.criteria + " criteria.");
    return change(s, next => {
      missing.forEach(c => next.criteria.push(sanitizeCriterion(util.clone(c))));
      return { added: missing.map(c => c.id) };
    });
  }

  /** Removes a criterion and every score given against it. */
  function removeCriterion(s, id) {
    criterionIn(s, id);
    return change(s, next => {
      next.criteria = next.criteria.filter(c => c.id !== id);
      next.candidates.forEach(c => { delete c.scores[id]; });
    });
  }

  /** Changes the screening's title, client, confidentiality, data status, currency, hourly rate or note. */
  function updateMeta(s, patch) {
    const p = plain(patch);
    if (p.title !== undefined && !text(p.title, 200)) fail("Give the screening a title.");
    if (p.confidentiality !== undefined && !schema.ENUMS.confidentiality.includes(p.confidentiality)) fail("Choose a confidentiality level.");
    if (p.dataStatus !== undefined && !schema.ENUMS.dataStatus.includes(p.dataStatus)) fail("Choose a data status.");
    if (p.currency !== undefined && !(typeof p.currency === "string" && /^[A-Z]{3}$/.test(p.currency))) fail("Enter a three-letter currency code, such as USD.");
    if (p.hourlyRate !== undefined && p.hourlyRate !== null &&
      (!util.isPlainObject(p.hourlyRate) || (p.hourlyRate.value !== null && nonNegative(p.hourlyRate.value) === null))) fail("Enter zero or a positive number.");
    return change(s, next => {
      ["title", "clientDisplayName", "confidentiality", "dataStatus", "currency", "hourlyRate", "note"].forEach(k => { if (p[k] !== undefined) next.meta[k] = p[k]; });
      next.meta = sanitizeScreening({ meta: next.meta, criteria: [], candidates: [] }).screening.meta;
    });
  }

  /* ---------- From a project ---------- */

  function hoursOf(measure) {
    if (!measure || !util.isFiniteNumber(measure.value)) return null;
    if (measure.unit === "hour") return measure.value;
    if (measure.unit === "minute") return measure.value / 60;
    return null;
  }

  function assumptionFact(e, key) {
    const a = (e.assumptions || []).find(x => x.key === key);
    return a && util.isFiniteNumber(a.value) ? { value: a.value, basis: basisOf(a.status), note: "From the project's assumptions." } : null;
  }

  /**
   * The candidate fields a project file gives: { name, description,
   * confidentiality, facts, source }. Hands-on hours per case are set only
   * when every step of the current state has a touch effort. Opportunities
   * marked sensitive and unreviewed AI drafts are left out unless opts says so.
   * opts: { fileName, includeSensitive, includeUnreviewedAi, now }.
   */
  function fromEngagement(e, opts) {
    const o = opts || {};
    if (!e || !Array.isArray(e.models)) fail("This is not an AIxRay project.");
    const meta = e.meta || {};
    const current = e.models.find(m => m.role === "current") || null;
    const tasks = current ? current.nodes.filter(n => !n.removed && schema.typeInfo(n.semanticType).shape === "task") : [];
    const hours = tasks.map(n => hoursOf(n.measures && n.measures.touchEffort));
    const known = hours.filter(h => h !== null);
    const effort = tasks.length && known.length === tasks.length
      ? { value: known.reduce((a, b) => a + b, 0), basis: tasks.every(n => n.provenance && n.provenance.validation === "validated") ? "validated" : "supplied",
        note: "Sum of the touch effort on " + tasks.length + " steps." }
      : null;
    let volume = assumptionFact(e, "annualVolume");
    if (!volume) {
      const d = (e.datasets || []).find(x => x.role !== "after" && x.cases && util.isFiniteNumber(x.cases.annualizedVolume));
      if (d) volume = { value: d.cases.annualizedVolume, basis: "observed", note: "Annualized from the event log " + (d.name || d.id) + "." };
    }
    const ranked = valueCase.rank(e, { includeSensitive: o.includeSensitive, includeUnreviewedAi: o.includeUnreviewedAi });
    const top = ranked.find(r => r.value !== null && (r.unit === "currency" || r.unit === "hour")) || null;
    return {
      name: text(meta.processName, 200) || (current && current.name) || "Untitled process",
      description: text(meta.summary),
      confidentiality: enumOr("confidentiality", meta.confidentiality, "internal"),
      facts: { annualVolume: volume, effortHoursPerCase: effort, hourlyRate: assumptionFact(e, "hourlyRate") },
      source: sanitizeSource({
        engagementId: e.id, engagementRevision: e.revision, fileName: o.fileName, takenAt: o.now || util.nowIso(),
        processName: meta.processName, dataStatus: meta.dataStatus, confidentiality: meta.confidentiality,
        steps: tasks.length, stepsWithEffort: known.length, opportunities: ranked.length,
        hasEventLog: (e.datasets || []).length > 0,
        topOpportunity: top ? { title: top.title, value: top.value, unit: top.unit, basis: top.basis } : null
      })
    };
  }

  /**
   * Adds a candidate from a project, or refreshes the candidate already added
   * from the same project: { screening, candidateId, refreshed }. Refreshing
   * replaces the copied figures and keeps the name, scores and notes.
   */
  function addFromEngagement(s, e, opts) {
    const fields = fromEngagement(e, opts);
    const existing = s.candidates.find(c => c.source && c.source.engagementId === fields.source.engagementId);
    if (!existing) return Object.assign(addCandidate(s, fields), { refreshed: false });
    return change(s, next => {
      const c = candidateIn(next, existing.id);
      c.source = fields.source;
      FACT_KEYS.forEach(k => { if (fields.facts[k]) c.facts[k] = fields.facts[k]; });
      return { candidateId: c.id, refreshed: true };
    });
  }

  /* ---------- Scoring ---------- */

  const normalize = v => (v - SCALE.min) / (SCALE.max - SCALE.min) * 100;

  /* Weighted mean on 0 to 100 over the criteria given: { score, provisional, coverage, missing, basis }. */
  function combine(criteria, candidate, weights) {
    const weighted = criteria.filter(c => weights[c.id] > 0);
    const scored = weighted.filter(c => candidate.scores[c.id] && candidate.scores[c.id].value !== null);
    const total = weighted.reduce((a, c) => a + weights[c.id], 0);
    const covered = scored.reduce((a, c) => a + weights[c.id], 0);
    const mean = covered > 0 ? scored.reduce((a, c) => a + weights[c.id] * normalize(candidate.scores[c.id].value), 0) / covered : null;
    const complete = weighted.length > 0 && scored.length === weighted.length;
    return {
      score: complete ? mean : null,
      provisional: mean,
      coverage: total > 0 ? covered / total : null,
      missing: weighted.filter(c => !scored.includes(c)).map(c => c.label),
      basis: scored.length ? economics.helpers.weakest(scored.map(c => candidate.scores[c.id].basis)) : null
    };
  }

  function factInput(fact, def) {
    return economics.helpers.inp(def.label, fact ? fact.value : null, def.unit, fact ? fact.basis : undefined);
  }

  /* Annual effort in hours and money, in the economics output shape. */
  function figures(s, c) {
    const def = key => FACTS.find(f => f.key === key);
    const rate = c.facts.hourlyRate || s.meta.hourlyRate;
    const volume = factInput(c.facts.annualVolume, def("annualVolume"));
    const effort = factInput(c.facts.effortHoursPerCase, def("effortHoursPerCase"));
    const hours = economics.helpers.output(
      { key: "annualEffortHours", label: "Hands-on hours per year", unit: "hoursPerYear", formula: "cases per year \u00d7 hands-on hours per case" },
      { inputs: [volume, effort], compute: () => volume.value * effort.value });
    const rateInput = factInput(rate, def("hourlyRate"));
    const cost = economics.helpers.output(
      { key: "annualEffortCost", label: "Labor cost of that effort per year", unit: "currency", formula: "hands-on hours per year \u00d7 hourly rate" },
      { inputs: [volume, effort, rateInput], compute: () => volume.value * effort.value * rateInput.value,
        notes: [c.facts.hourlyRate ? "" : rate ? "Uses the screening's hourly rate." : ""] });
    return { annualEffortHours: hours, annualEffortCost: cost };
  }

  function quadrantOf(value, ease) {
    if (value === null || ease === null) return null;
    const high = value >= HIGH_FROM, easy = ease >= HIGH_FROM;
    return high ? (easy ? "start-here" : "larger-effort") : (easy ? "easy-small" : "not-now");
  }

  function flagsOf(s, c) {
    const flags = [];
    s.criteria.forEach(k => {
      const v = c.scores[k.id] && c.scores[k.id].value;
      if (k.gateAtOrBelow !== null && k.weight > 0 && v !== null && v !== undefined && v <= k.gateAtOrBelow) {
        flags.push({ code: "gate", criterionId: k.id, message: k.label + " scored " + v + ". Settle this before choosing this process." });
      }
    });
    if ((c.confidentiality || s.meta.confidentiality) === "restricted") {
      flags.push({ code: "restricted", message: "Restricted material: AI work on it needs written client approval." });
    }
    return flags;
  }

  function weightsOf(s, overrides) {
    return Object.assign(Object.fromEntries(s.criteria.map(c => [c.id, c.weight])), overrides || {});
  }

  /* Scores this close are the same score: the gap is only rounding in the sums. */
  const TIE = 1e-9;
  const gap = (a, b) => (Math.abs(a - b) < TIE ? 0 : a - b);

  function order(rows) {
    const tier = r => (r.score !== null ? 0 : r.provisional !== null ? 1 : 2);
    const value = r => (r.score !== null ? r.score : r.provisional || 0);
    rows.sort((a, b) => tier(a) - tier(b) || gap(value(b), value(a)) || String(a.name).localeCompare(String(b.name)));
    rows.forEach((r, i) => { r.rank = i + 1; });
    return rows;
  }

  /* The candidate with its unreviewed AI scores left out. */
  function withoutAiDrafts(c) {
    return Object.assign({}, c, { scores: Object.fromEntries(Object.entries(c.scores).filter(([, x]) => !x.aiDraft)) });
  }

  function score(s, opts) {
    const o = opts || {};
    const weights = weightsOf(s, o.weights);
    const ease = s.criteria.filter(c => c.group !== "value");
    const dropAi = o.includeUnreviewedAi === false;
    return order(s.candidates.filter(c => o.includeSensitive || !c.sensitive).map(original => {
      const c = dropAi ? withoutAiDrafts(original) : original;
      const aiDrafts = aiDraftCount({ candidates: [original] });
      const overall = combine(s.criteria, c, weights);
      const groups = Object.fromEntries(GROUP_IDS.map(g => [g, combine(s.criteria.filter(k => k.group === g), c, weights)]));
      const easeResult = combine(ease, c, weights);
      return {
        candidateId: c.id, name: c.name, rank: 0,
        score: overall.score, provisional: overall.provisional, coverage: overall.coverage, missing: overall.missing, basis: overall.basis,
        groups, ease: easeResult.score, quadrant: quadrantOf(groups.value.score, easeResult.score),
        figures: figures(s, c), flags: flagsOf(s, c), sensitive: c.sensitive, source: c.source,
        aiDrafts: dropAi ? 0 : aiDrafts, aiDraftsLeftOut: dropAi ? aiDrafts : 0
      };
    }));
  }

  /**
   * Whether the first choice holds when one weight at a time moves by 20
   * percent up or down: { topId, stable, margin, tiedIds, changes, note }.
   * Only candidates with every weighted criterion scored take part. When the
   * best score is shared, topId is null and tiedIds names the candidates.
   */
  function stability(s, opts) {
    const o = opts || {};
    const complete = rows => rows.filter(r => r.score !== null);
    const base = complete(score(s, o));
    if (base.length < 2) return { topId: base.length ? base[0].candidateId : null, stable: null, margin: null, tiedIds: [], changes: [],
      note: "Score every criterion for at least two candidates to test whether the first choice holds." };
    const changes = [];
    s.criteria.filter(c => c.weight > 0).forEach(c => {
      [1 + STABILITY_STEP, 1 - STABILITY_STEP].forEach(factor => {
        const rows = complete(score(s, Object.assign({}, o, { weights: Object.assign({}, o.weights, { [c.id]: Math.min(WEIGHT_MAX, c.weight * factor) }) })));
        if (rows.length && rows[0].candidateId !== base[0].candidateId) {
          changes.push({ criterionId: c.id, label: c.label, change: factor > 1 ? "up" : "down", topId: rows[0].candidateId, topName: rows[0].name });
        }
      });
    });
    const margin = gap(base[0].score, base[1].score);
    const tiedIds = base.filter(r => gap(base[0].score, r.score) === 0).map(r => r.candidateId);
    if (tiedIds.length > 1) {
      const names = base.filter(r => tiedIds.includes(r.candidateId)).map(r => r.name);
      return { topId: null, stable: false, margin: 0, tiedIds, changes,
        note: names.slice(0, -1).join(", ") + " and " + names[names.length - 1] + " have the same score. Agree the weights or scores that separate them before choosing." };
    }
    return {
      topId: base[0].candidateId, stable: changes.length === 0, margin, tiedIds: [], changes,
      note: changes.length ? "The first choice changes when some weights move by 20 percent. Agree those weights before choosing."
        : "The first choice holds when any one weight moves by 20 percent up or down."
    };
  }

  /**
   * The ranked candidates with their stability check:
   * { rows, stability, notes }. Sensitive candidates are left out unless
   * opts.includeSensitive. Unreviewed AI scores count unless
   * opts.includeUnreviewedAi is false. opts: { includeSensitive, includeUnreviewedAi, weights }.
   */
  function evaluate(s, opts) {
    const rows = score(s, opts);
    const notes = ["Scores run from 0 to 100: the weighted mean of the 1 to 5 scores, where 1 counts as 0 and 5 as 100."];
    const partial = rows.filter(r => r.score === null && r.provisional !== null).length;
    if (partial) notes.push(partial + " candidate" + (partial === 1 ? " is" : "s are") + " not fully scored and rank" + (partial === 1 ? "s" : "") + " after the fully scored ones, on a provisional score.");
    if (rows.some(r => r.flags.length)) notes.push("Flagged candidates stay in the ranking. Read the flags before choosing.");
    const used = rows.reduce((n, r) => n + r.aiDrafts, 0), left = rows.reduce((n, r) => n + r.aiDraftsLeftOut, 0);
    if (used) notes.push(used + " score" + (used === 1 ? " was" : "s were") + " drafted with AI and no one has reviewed " + (used === 1 ? "it" : "them") + " yet.");
    if (left) notes.push(left + " score" + (left === 1 ? "" : "s") + " drafted with AI " + (left === 1 ? "is" : "are") + " left out until someone reviews " + (left === 1 ? "it" : "them") + ".");
    return { rows, stability: stability(s, opts), notes };
  }

  /* ---------- The printed summary ---------- */

  /**
   * What the printed one-page summary shows: { title, client, dataStatus,
   * confidentiality, revision, preparedAt, recommendation, rows, criteria,
   * stability, notes, counts }. Sensitive candidates are left out unless
   * opts.includeSensitive; counts.excluded says how many were left out.
   * Unreviewed AI scores are left out unless opts.includeUnreviewedAi, as
   * AI drafts are everywhere else in AIxRay; then disclosure says so.
   * opts: { includeSensitive, includeUnreviewedAi, now }.
   */
  function buildSummary(s, opts) {
    const o = Object.assign({}, opts || {});
    o.includeUnreviewedAi = o.includeUnreviewedAi === true;
    const result = evaluate(s, o);
    const total = s.criteria.reduce((a, k) => a + k.weight, 0);
    const complete = result.rows.filter(r => r.score !== null);
    const st = result.stability;
    const top = complete[0] || null;
    let recommendation;
    if (st.tiedIds.length > 1) {
      recommendation = { kind: "tie", candidateIds: st.tiedIds, text: st.note };
    } else if (top) {
      const parts = [top.name + " scores " + util.formatNumber(top.score, 0) + " of 100" + (top.quadrant ? " (" + QUADRANTS[top.quadrant] + ")" : "") + "."];
      if (st.stable !== null) parts.push(st.note);
      if (top.flags.length) parts.push("Before choosing it: " + top.flags.map(f => f.message).join(" "));
      recommendation = { kind: "first", candidateIds: [top.candidateId], text: parts.join(" ") };
    } else {
      recommendation = { kind: "none", candidateIds: [], text: "No process is fully scored yet, so there is no first choice." };
    }
    const notes = result.notes.concat([
      "Each score carries the basis of its evidence: illustrative, provided, measured or confirmed. A result shows the weakest basis among its scores.",
      "Hands-on hours and labor cost are modeled from typed figures. They describe today's effort, not savings."
    ]);
    if (s.meta.note) notes.push(s.meta.note);
    return {
      title: s.meta.title, client: s.meta.clientDisplayName,
      dataStatus: schema.label("dataStatus", s.meta.dataStatus), confidentiality: schema.label("confidentiality", s.meta.confidentiality),
      revision: s.revision, preparedAt: o.now || util.nowIso(), currency: s.meta.currency,
      recommendation, rows: result.rows, stability: st, notes,
      disclosure: result.rows.some(r => r.aiDrafts) ? "This summary includes scores drafted with AI assistance that no one has reviewed yet." : "",
      criteria: s.criteria.map(k => ({ id: k.id, label: k.label, group: k.group, groupLabel: GROUPS.find(g => g[0] === k.group)[1], weight: k.weight,
        share: total > 0 ? k.weight / total : null, gateAtOrBelow: k.gateAtOrBelow, help: k.help })),
      counts: { candidates: s.candidates.length, shown: result.rows.length, complete: complete.length, excluded: s.candidates.length - result.rows.length,
        aiDrafts: result.rows.reduce((n, r) => n + r.aiDrafts, 0), aiDraftsLeftOut: result.rows.reduce((n, r) => n + r.aiDraftsLeftOut, 0) }
    };
  }

  /* ---------- The AI task: draft screening scores ---------- */

  const CONFIDENTIALITY_ORDER = ["public", "internal", "client-confidential", "restricted"];

  function sentCandidates(s, o) {
    return s.candidates.filter(c => o.includeSensitive || !c.sensitive);
  }

  /**
   * The data-handling facts for sending a screening to an AI tool: its data
   * status, and the strictest confidentiality among the screening and the
   * candidates that would be sent. opts: { includeSensitive }.
   */
  function dataHandlingOf(s, opts) {
    const o = opts || {};
    const levels = [s.meta.confidentiality].concat(sentCandidates(s, o).map(c => c.confidentiality).filter(Boolean));
    const strictest = levels.reduce((a, b) => (CONFIDENTIALITY_ORDER.indexOf(b) > CONFIDENTIALITY_ORDER.indexOf(a) ? b : a), "public");
    return { confidentiality: strictest, dataStatus: s.meta.dataStatus };
  }

  /**
   * What the AI is given to draft scores: the criteria with what 1, 3 and 5
   * mean, and for each candidate its name, description, yearly figures, the
   * figures copied from its project, the scores people gave and the criteria
   * still to score. Owners are left out because they can name people.
   * Sensitive candidates are left out unless opts.includeSensitive.
   */
  function aiTaskInput(s, opts) {
    const o = opts || {};
    const sent = sentCandidates(s, o);
    const value = f => (f && f.value !== null ? { value: f.value, basis: f.basis } : null);
    return {
      task: "screen", screeningId: s.id, screeningRevision: s.revision,
      screening: { title: s.meta.title, client: s.meta.clientDisplayName, currency: s.meta.currency },
      criteria: s.criteria.map(k => ({ id: k.id, label: k.label, group: k.group, weight: k.weight, help: k.help,
        anchors: Object.fromEntries([1, 3, 5].filter(n => k.anchors[n]).map(n => [n, k.anchors[n]])) })),
      candidates: sent.map(c => {
        const src = c.source;
        return {
          id: c.id, name: c.name, description: c.description,
          facts: Object.fromEntries(FACT_KEYS.map(k => [k, value(c.facts[k])])),
          fromProject: src ? { processName: src.processName, steps: src.steps, stepsWithEffort: src.stepsWithEffort, opportunities: src.opportunities,
            hasEventLog: src.hasEventLog, topOpportunity: src.topOpportunity ? src.topOpportunity.title : null } : null,
          scores: Object.fromEntries(Object.entries(c.scores).filter(([, x]) => x.value !== null)
            .map(([k, x]) => [k, { value: x.value, note: x.note, origin: x.aiDraft ? "ai-draft" : "person" }])),
          toScore: s.criteria.filter(k => !(c.scores[k.id] && c.scores[k.id].value !== null && !c.scores[k.id].aiDraft)).map(k => k.id)
        };
      }),
      excluded: { sensitiveCandidates: s.candidates.length - sent.length }
    };
  }

  /**
   * Checks drafted scores against the screening: { task, errors, warnings,
   * items }. Each item is { key, index, candidateId, criterionId, title,
   * value, confidence, rationale, problems }. An item with problems cannot be
   * applied: the candidate or criterion is not in the screening, a person
   * already scored it, or the AI left it blank.
   */
  function prepareAiScores(result, s) {
    const out = { task: "screen", errors: [], warnings: [], items: [] };
    if (!result || result.task !== "screen") { out.errors.push({ path: "task", message: "This AI result does not hold screening scores." }); return out; }
    if (result.screeningId !== s.id) { out.errors.push({ path: "screeningId", message: "This AI result was made for another screening, so nothing was changed." }); return out; }
    if (result.screeningRevision !== null && result.screeningRevision !== s.revision) {
      out.warnings.push({ code: "result.stale", message: "The screening changed after these scores were drafted. Check each one before you apply it.", path: "" });
    }
    out.items = result.payload.scores.map((x, i) => {
      const c = s.candidates.find(y => y.id === x.candidateId);
      const k = s.criteria.find(y => y.id === x.criterionId);
      const problems = [];
      if (!c) problems.push("The process is not in the screening.");
      if (!k) problems.push("The criterion is not in the screening.");
      const current = c && k ? c.scores[k.id] : null;
      if (current && current.value !== null && !current.aiDraft) problems.push("A person already scored this, and that score stays.");
      if (x.value === null) problems.push("The AI could not score this from the material.");
      return {
        key: x.candidateId + "|" + x.criterionId, index: i, candidateId: x.candidateId, criterionId: x.criterionId,
        title: (c ? c.name : "Unknown process") + ": " + (k ? k.label : "unknown criterion") + (x.value !== null ? ", " + x.value : ""),
        value: x.value, confidence: x.confidence, rationale: x.rationale, problems
      };
    });
    return out;
  }

  /**
   * Applies the chosen drafted scores as unreviewed AI drafts, in one change:
   * { screening, applied }. Items with problems are skipped.
   */
  function applyAiScores(s, review, keys) {
    const chosen = new Set(keys || []);
    const items = review.items.filter(it => chosen.has(it.key) && !it.problems.length);
    return change(s, next => {
      items.forEach(it => {
        const c = candidateIn(next, it.candidateId);
        const rationale = it.rationale ? ": " + it.rationale : ".";
        c.scores[it.criterionId] = { value: it.value, basis: "illustrative", note: text("AI draft, " + it.confidence + " confidence" + rationale, 1000), aiDraft: true };
      });
      return { applied: items.length };
    });
  }

  /* ---------- To a project ---------- */

  /**
   * A new project for one candidate, with its name, client, confidentiality
   * and the facts that are project assumptions. The process itself starts
   * blank, as Build a process does.
   */
  function toStarterEngagement(s, candidateId) {
    const c = candidateIn(s, candidateId);
    const e = processBuilder.blank({
      processName: c.name, clientDisplayName: s.meta.clientDisplayName, engagementName: s.meta.title,
      confidentiality: c.confidentiality || s.meta.confidentiality, dataStatus: s.meta.dataStatus, currency: s.meta.currency,
      summary: c.description
    });
    const assume = (key, fact) => {
      if (!fact || fact.value === null) return;
      const def = schema.DRIVERS.find(d => d.key === key);
      e.assumptions.push({ id: "as-" + util.slug(key), key, label: def.label, value: fact.value, unit: def.unit,
        status: fact.basis, source: "Process screening: " + s.meta.title, note: fact.note || "" });
    };
    assume("annualVolume", c.facts.annualVolume);
    assume("hourlyRate", c.facts.hourlyRate || s.meta.hourlyRate);
    const row = score(s, { includeSensitive: true }).find(r => r.candidateId === c.id);
    const lines = ["Chosen in the screening " + s.meta.title + "."];
    if (row.score !== null) lines.push("Screening score: " + util.formatNumber(row.score, 0) + " of 100.");
    if (c.facts.effortHoursPerCase && c.facts.effortHoursPerCase.value !== null) {
      lines.push("Hands-on hours per case at screening: " + util.formatNumber(c.facts.effortHoursPerCase.value, 2) + ".");
    }
    e.models[0].notes = lines.join(" ");
    const checked = validate.validateEngagement(e);
    if (!checked.ok) fail(checked.errors[0].message);
    return checked.engagement;
  }

  return {
    SCREENING_ID, SCREENING_VERSION, SCREENING_SCHEMA, LIMITS, SCALE, WEIGHT_MAX, GROUPS, FACTS, QUADRANTS, DEFAULT_CRITERIA, PORTFOLIO_CRITERIA, ScreeningError,
    blankScreening, sanitizeScreening, parseScreening,
    addCandidate, updateCandidate, removeCandidate, setScore, reviewAiScores, aiDraftCount, addCriterion, addPortfolioCriteria, updateCriterion, removeCriterion, updateMeta,
    dataHandlingOf, aiTaskInput, prepareAiScores, applyAiScores,
    fromEngagement, addFromEngagement, evaluate, stability, buildSummary, toStarterEngagement
  };
});
