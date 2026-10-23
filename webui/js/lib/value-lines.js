/*
 * AIxRay value lines: the kinds of value an opportunity creates besides
 * labor hours, such as fewer errors, fewer SLA penalties, hires not made or
 * licenses retired. Each line is one value dimension with its inputs, the
 * share that can be realized, how it will be realized, who in Finance
 * confirms it, and the amount they validated. See docs/value-dimensions.md.
 *
 * value-case.js combines the lines with the labor estimate into the gross,
 * realizable and validated figures. This module only knows the templates,
 * keeps stored lines in shape, and works out one line's gross value. Pure
 * Node/browser library; loads before validation.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./util.js"), require("./economics.js"));
  else { const B = root.AIxRay = root.AIxRay || {}; B.valueLines = factory(B.util, B.economics); }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, economics) {
  "use strict";

  const LIMIT = 20;
  const BASES = ["illustrative", "supplied", "observed", "validated"];

  /* How a benefit becomes money, which decides how Finance checks it. */
  const TREATMENTS = {
    capacity: { label: "Freed capacity", check: "How the hours become money. Until then the realizable figure stays blank." },
    directExpense: { label: "Direct expense reduction", check: "The account, contract or budget line that changes, and when." },
    costAvoidance: { label: "Cost avoidance", check: "A credible staffing or spending plan the change makes unnecessary." },
    avoidedLoss: { label: "Avoided loss", check: "Documented losses today and the expected loss after the change." }
  };

  /*
   * The templates. Each input is { key, label, unit, kind } where kind is
   * "count", "percent" or "money"; formula is shown with the result. pool
   * names what a line monetizes, so two lines cannot count it twice.
   */
  const DIMENSIONS = {
    rework: {
      label: "Errors and rework", treatment: "avoidedLoss", pool: "",
      formula: "cases per year \u00d7 (error rate today \u2212 error rate after) \u00d7 cost per error",
      hint: "Cost per error is everything an error causes: finding it, fixing it, work redone downstream, credits and write-offs.",
      inputs: [
        { key: "casesPerYear", label: "Cases per year", unit: "casesPerYear", kind: "count", fallback: "annualVolume" },
        { key: "errorRateBeforePct", label: "Error rate today", unit: "percent", kind: "percent" },
        { key: "errorRateAfterPct", label: "Error rate after the change", unit: "percent", kind: "percent" },
        { key: "costPerError", label: "Cost per error", unit: "currency", kind: "money" }
      ],
      value: x => x.casesPerYear * (x.errorRateBeforePct - x.errorRateAfterPct) / 100 * x.costPerError
    },
    sla: {
      label: "SLA penalties avoided", treatment: "avoidedLoss", pool: "",
      formula: "(breaches per year today \u2212 breaches per year after) \u00d7 penalty or credit per breach",
      hint: "Use the penalty or credit actually paid, not the contract maximum.",
      inputs: [
        { key: "breachesBefore", label: "Breaches per year today", unit: "count", kind: "count" },
        { key: "breachesAfter", label: "Breaches per year after the change", unit: "count", kind: "count" },
        { key: "penaltyPerBreach", label: "Penalty or credit per breach", unit: "currency", kind: "money" }
      ],
      value: x => (x.breachesBefore - x.breachesAfter) * x.penaltyPerBreach
    },
    hires: {
      label: "Hires avoided", treatment: "costAvoidance", pool: "labor",
      formula: "(planned hires \u2212 hires still needed) \u00d7 fully loaded annual cost per hire",
      hint: "Count only hires in an approved or credible staffing plan. This is how the labor hours are realized, so labor is not counted again.",
      inputs: [
        { key: "plannedHires", label: "Planned hires", unit: "count", kind: "count" },
        { key: "hiresStillNeeded", label: "Hires still needed after the change", unit: "count", kind: "count" },
        { key: "annualCostPerHire", label: "Fully loaded annual cost per hire", unit: "currency", kind: "money" }
      ],
      value: x => (x.plannedHires - x.hiresStillNeeded) * x.annualCostPerHire
    },
    vendor: {
      label: "Licenses and vendor fees", treatment: "directExpense", pool: "",
      formula: "(seats or units paid for today \u2212 still needed) \u00d7 cost per seat or unit per year",
      hint: "Check the contract: the saving usually starts at renewal, not on the day the work changes.",
      inputs: [
        { key: "unitsBefore", label: "Seats or units paid for today", unit: "count", kind: "count" },
        { key: "unitsAfter", label: "Seats or units still needed", unit: "count", kind: "count" },
        { key: "costPerUnitPerYear", label: "Cost per seat or unit per year", unit: "currency", kind: "money" }
      ],
      value: x => (x.unitsBefore - x.unitsAfter) * x.costPerUnitPerYear
    }
  };
  const DIMENSION_IDS = Object.keys(DIMENSIONS);

  /* The fields every line carries besides its inputs, and their limits. */
  const TEXT = { realizedBy: 500, financeOwner: 200, validatedSource: 500, note: 2000 };

  const plain = x => util.isPlainObject(x) ? x : {};
  const text = (x, max) => typeof x === "string" ? x.slice(0, max).trim() : "";
  const nonNegative = x => util.isFiniteNumber(x) && x >= 0 ? x : null;
  const percent = x => nonNegative(x) !== null && x <= 100 ? x : null;

  function inputValue(def, raw) {
    return def.kind === "percent" ? percent(raw) : nonNegative(raw);
  }

  /**
   * One line as bounded plain JSON, or null when it has no valid ID or an
   * unknown dimension. Inputs that are not numbers in range become blank.
   */
  function lineOf(raw) {
    const l = plain(raw);
    const dim = DIMENSIONS[l.dimension];
    if (!util.isValidId(l.id) || !dim) return null;
    const given = plain(l.inputs);
    return {
      id: l.id, dimension: l.dimension,
      inputs: Object.fromEntries(dim.inputs.map(d => [d.key, inputValue(d, given[d.key])])),
      realizationPct: percent(l.realizationPct),
      realizedBy: text(l.realizedBy, TEXT.realizedBy),
      financeOwner: text(l.financeOwner, TEXT.financeOwner),
      validatedAnnual: util.isFiniteNumber(l.validatedAnnual) ? l.validatedAnnual : null,
      validatedSource: text(l.validatedSource, TEXT.validatedSource),
      basis: BASES.includes(l.basis) ? l.basis : "illustrative",
      note: text(l.note, TEXT.note)
    };
  }

  /** The lines in shape: unusable ones and repeated IDs left out. { lines, dropped }. */
  function sanitizeLines(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const seen = new Set();
    const lines = list.slice(0, LIMIT).map(lineOf).filter(l => {
      if (!l || seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    });
    return { lines, dropped: list.length - lines.length };
  }

  /** The lines an opportunity record carries, or an empty list. */
  function linesOf(record) {
    const l = record && record.opportunity && record.opportunity.valueLines;
    return Array.isArray(l) ? l : [];
  }

  /** A new line ID that is not used in the list yet. */
  function newLineId(dimension, lines) {
    return util.uniqueId("vl-" + dimension, new Set((lines || []).map(l => l.id)));
  }

  /**
   * One line's gross annual value, in the economics output shape (formula,
   * inputs, missing, basis). fallbacks: { annualVolume: input } supplies a
   * blank input from the project's assumptions, with a note.
   */
  function grossOf(line, fallbacks) {
    const dim = DIMENSIONS[line.dimension];
    const notes = [];
    const inputs = dim.inputs.map(d => {
      const v = line.inputs[d.key];
      const fb = d.fallback && fallbacks && fallbacks[d.fallback];
      if (!util.isFiniteNumber(v) && fb && util.isFiniteNumber(fb.value)) {
        notes.push(d.label + " uses the project's " + fb.label.toLowerCase() + ".");
        return economics.helpers.inp(d.label + " (" + fb.label.toLowerCase() + ")", fb.value, d.unit, fb.status);
      }
      return economics.helpers.inp(d.label, v, d.unit, line.basis);
    });
    const x = Object.fromEntries(dim.inputs.map((d, i) => [d.key, inputs[i].value]));
    return economics.helpers.output(
      { key: "line:" + line.id, label: dim.label, unit: "currency", formula: dim.formula },
      { inputs, compute: () => dim.value(x), notes: notes.concat([dim.hint]) });
  }

  return { LIMIT, BASES, TREATMENTS, DIMENSIONS, DIMENSION_IDS, TEXT, lineOf, sanitizeLines, linesOf, newLineId, grossOf };
});
