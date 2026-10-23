/*
 * AIxRay value lines: the kinds of value an opportunity creates besides
 * labor hours, such as fewer errors, fewer SLA penalties, hires not made or
 * licenses retired. Each line is one value dimension with its inputs, the
 * share that can be realized, how it will be realized, who in Finance
 * confirms it, and the amount they validated. See docs/value-dimensions.md.
 *
 * An Errors and rework line can also carry error types: the cost per error
 * built up from the steps an error makes people redo, so it is not a guess.
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
  const ERROR_TYPE_LIMIT = 12;
  const REDO_STEP_LIMIT = 40;
  const BASES = ["illustrative", "supplied", "observed", "validated"];
  const SEVERITIES = [["minor", "Minor: fixed right away"], ["moderate", "Moderate: work redone downstream"], ["severe", "Severe: money or a customer lost"]];
  const SEVERITY_IDS = SEVERITIES.map(s => s[0]);
  const { inp, output, weakest } = economics.helpers;

  /* How a benefit becomes money, which decides how Finance checks it. */
  const TREATMENTS = {
    capacity: { label: "Freed capacity", check: "How the hours become money. Until then the realizable figure stays blank." },
    directExpense: { label: "Direct expense reduction", check: "The account, contract or budget line that changes, and when." },
    costAvoidance: { label: "Cost avoidance", check: "A credible staffing or spending plan the change makes unnecessary." },
    avoidedLoss: { label: "Avoided loss", check: "Documented losses today and the expected loss after the change." },
    contribution: { label: "Extra margin", check: "Contribution margin on the extra business, never gross revenue." }
  };

  const count = (key, label, more) => Object.assign({ key, label, unit: "count", kind: "count" }, more);
  const pct = (key, label) => ({ key, label, unit: "percent", kind: "percent" });
  const money = (key, label, more) => Object.assign({ key, label, unit: "currency", kind: "money" }, more);
  const cases = (key, label) => ({ key, label, unit: "casesPerYear", kind: "count", fallback: "annualVolume" });
  const rate = () => ({ key: "hourlyRate", label: "Hourly rate", unit: "currencyPerHour", kind: "money", fallback: "hourlyRate" });

  /*
   * The templates. Each input is { key, label, unit, kind, fallback } where
   * kind is "count", "percent" or "money", and fallback names a project
   * assumption that fills a blank input. pool names what a line monetizes,
   * so two lines cannot count it twice.
   */
  const DIMENSIONS = {
    rework: {
      label: "Errors and rework", treatment: "avoidedLoss", pool: "",
      formula: "cases per year \u00d7 (error rate today \u2212 error rate after) \u00d7 cost per error",
      typesFormula: "12 \u00d7 sum over error types of (errors per month today \u2212 after) \u00d7 cost per error",
      hint: "Cost per error is everything an error causes: finding it, fixing it, work redone downstream, credits and write-offs. Add error types to build it up from the steps an error makes people redo.",
      inputs: [cases("casesPerYear", "Cases per year"), pct("errorRateBeforePct", "Error rate today"), pct("errorRateAfterPct", "Error rate after the change"), money("costPerError", "Cost per error")],
      value: x => x.casesPerYear * (x.errorRateBeforePct - x.errorRateAfterPct) / 100 * x.costPerError
    },
    sla: {
      label: "SLA penalties avoided", treatment: "avoidedLoss", pool: "",
      formula: "(breaches per year today \u2212 breaches per year after) \u00d7 penalty or credit per breach",
      hint: "Use the penalty or credit actually paid, not the contract maximum.",
      inputs: [count("breachesBefore", "Breaches per year today"), count("breachesAfter", "Breaches per year after the change"), money("penaltyPerBreach", "Penalty or credit per breach")],
      value: x => (x.breachesBefore - x.breachesAfter) * x.penaltyPerBreach
    },
    lateCases: {
      label: "Late or slow cases", treatment: "avoidedLoss", pool: "",
      formula: "cases per year \u00d7 (share late today \u2212 share late after) \u00d7 cost of a late case",
      hint: "A faster average is worth nothing on its own. Count what a late case costs: expediting, credits, escalations, a missed customer date. The slowest cases often carry most of it, so check the 90th percentile in an event log.",
      inputs: [cases("casesPerYear", "Cases per year"), pct("lateBeforePct", "Share of cases late today"), pct("lateAfterPct", "Share of cases late after the change"), money("costPerLateCase", "Cost of a late case")],
      value: x => x.casesPerYear * (x.lateBeforePct - x.lateAfterPct) / 100 * x.costPerLateCase
    },
    throughput: {
      label: "More work done", treatment: "contribution", pool: "",
      formula: "(lower of demand and capacity after \u2212 lower of demand and capacity today) \u00d7 margin per unit",
      hint: "Extra capacity is worth something only where there is demand for it and the step is the one holding the process back.",
      inputs: [count("demandPerYear", "Demand per year"), count("capacityBefore", "Capacity per year today"), count("capacityAfter", "Capacity per year after the change"), money("marginPerUnit", "Margin per extra unit")],
      value: x => (Math.min(x.demandPerYear, x.capacityAfter) - Math.min(x.demandPerYear, x.capacityBefore)) * x.marginPerUnit
    },
    coordination: {
      label: "Handoffs and coordination", treatment: "capacity", pool: "",
      formula: "cases per year \u00d7 (touches per case today \u2212 after) \u00d7 minutes per touch \u00f7 60 \u00d7 hourly rate",
      hint: "Status requests, clarifications and follow-ups between teams. Count only time not already in the steps' touch effort, so it is not counted twice with labor.",
      inputs: [cases("casesPerYear", "Cases per year"), count("touchesBefore", "Coordination touches per case today"), count("touchesAfter", "Coordination touches per case after"),
        count("minutesPerTouch", "Minutes per touch"), rate()],
      value: x => x.casesPerYear * (x.touchesBefore - x.touchesAfter) * x.minutesPerTouch / 60 * x.hourlyRate
    },
    exceptions: {
      label: "Exceptions handled", treatment: "capacity", pool: "",
      formula: "(exceptions per year today \u2212 after) \u00d7 cost to handle an exception",
      hint: "Cases that leave the standard path: missing data, mismatches, policy conflicts. Include the review of what the AI resolves.",
      inputs: [count("exceptionsBefore", "Exceptions per year today"), count("exceptionsAfter", "Exceptions per year after the change"), money("costPerException", "Cost to handle an exception")],
      value: x => (x.exceptionsBefore - x.exceptionsAfter) * x.costPerException
    },
    decisions: {
      label: "Decisions made in time", treatment: "contribution", pool: "",
      formula: "decisions per year \u00d7 (share lost to delay today \u2212 after) \u00d7 margin per opportunity kept",
      hint: "Only count opportunities that were lost because the decision came too late, not because of price or fit.",
      inputs: [count("decisionsPerYear", "Decisions per year"), pct("lostBeforePct", "Share lost to delay today"), pct("lostAfterPct", "Share lost to delay after the change"), money("marginPerKept", "Margin per opportunity kept")],
      value: x => x.decisionsPerYear * (x.lostBeforePct - x.lostAfterPct) / 100 * x.marginPerKept
    },
    winRate: {
      label: "Faster quotes, more wins", treatment: "contribution", pool: "",
      formula: "opportunities per year \u00d7 (win rate after \u2212 win rate today) \u00d7 margin per win",
      hint: "Where the first quote back usually wins, as with brokers in commercial insurance. Use margin, not revenue, and compare like with like.",
      inputs: [count("opportunitiesPerYear", "Quotes or opportunities per year"), pct("winRateBeforePct", "Win rate today"), pct("winRateAfterPct", "Win rate after the change"), money("marginPerWin", "Margin per win")],
      value: x => x.opportunitiesPerYear * (x.winRateAfterPct - x.winRateBeforePct) / 100 * x.marginPerWin
    },
    contacts: {
      label: "Customer contacts avoided", treatment: "capacity", pool: "",
      formula: "(contacts per year today \u2212 after) \u00d7 avoidable cost per contact",
      hint: "Count issues resolved, not conversations deflected. A customer who calls back is still a contact.",
      inputs: [count("contactsBefore", "Contacts per year today"), count("contactsAfter", "Contacts per year after the change"), money("costPerContact", "Avoidable cost per contact")],
      value: x => (x.contactsBefore - x.contactsAfter) * x.costPerContact
    },
    leakage: {
      label: "Billing and revenue leakage", treatment: "contribution", pool: "",
      formula: "billable items per year \u00d7 leakage rate \u00d7 amount per leak \u00d7 (recovery after \u2212 recovery today) \u00d7 margin share",
      hint: "Revenue the client is owed and does not collect: wrong rates, missed charges, invoices that went out wrong. Finding an error is not the same as recovering it.",
      inputs: [count("itemsPerYear", "Billable items per year"), pct("leakageRatePct", "Share of items with leakage"), money("amountPerLeak", "Amount per leak"),
        pct("recoveryBeforePct", "Share recovered today"), pct("recoveryAfterPct", "Share recovered after the change"), pct("marginSharePct", "Margin share of recovered revenue")],
      value: x => x.itemsPerYear * x.leakageRatePct / 100 * x.amountPerLeak * (x.recoveryAfterPct - x.recoveryBeforePct) / 100 * x.marginSharePct / 100
    },
    hires: {
      label: "Hires avoided", treatment: "costAvoidance", pool: "labor",
      formula: "(planned hires \u2212 hires still needed) \u00d7 fully loaded annual cost per hire",
      hint: "Count only hires in an approved or credible staffing plan. This is how the labor hours are realized, so labor is not counted again.",
      inputs: [count("plannedHires", "Planned hires"), count("hiresStillNeeded", "Hires still needed after the change"), money("annualCostPerHire", "Fully loaded annual cost per hire")],
      value: x => (x.plannedHires - x.hiresStillNeeded) * x.annualCostPerHire
    },
    vendor: {
      label: "Licenses and vendor fees", treatment: "directExpense", pool: "",
      formula: "(seats or units paid for today \u2212 still needed) \u00d7 cost per seat or unit per year",
      hint: "Check the contract: the saving usually starts at renewal, not on the day the work changes.",
      inputs: [count("unitsBefore", "Seats or units paid for today"), count("unitsAfter", "Seats or units still needed"), money("costPerUnitPerYear", "Cost per seat or unit per year")],
      value: x => (x.unitsBefore - x.unitsAfter) * x.costPerUnitPerYear
    }
  };
  const DIMENSION_IDS = Object.keys(DIMENSIONS);

  /* The fields every line carries besides its inputs, and their limits. */
  const TEXT = { realizedBy: 500, financeOwner: 200, validatedSource: 500, note: 2000, errorName: 200 };

  const plain = x => util.isPlainObject(x) ? x : {};
  const text = (x, max) => typeof x === "string" ? x.slice(0, max).trim() : "";
  const nonNegative = x => util.isFiniteNumber(x) && x >= 0 ? x : null;
  const percent = x => nonNegative(x) !== null && x <= 100 ? x : null;
  const idOrNull = x => util.isValidId(x) ? x : null;

  function inputValue(def, raw) {
    return def.kind === "percent" ? percent(raw) : nonNegative(raw);
  }

  /* One error type of an Errors and rework line, or null when it has no valid ID or name. */
  function errorTypeOf(raw) {
    const t = plain(raw);
    if (!util.isValidId(t.id) || !text(t.name, TEXT.errorName)) return null;
    return {
      id: t.id, name: text(t.name, TEXT.errorName), severity: SEVERITY_IDS.includes(t.severity) ? t.severity : "moderate",
      perMonth: nonNegative(t.perMonth), perMonthAfter: nonNegative(t.perMonthAfter),
      originNodeId: idOrNull(t.originNodeId), detectedNodeId: idOrNull(t.detectedNodeId),
      redoNodeIds: [...new Set((Array.isArray(t.redoNodeIds) ? t.redoNodeIds : []).filter(util.isValidId))].slice(0, REDO_STEP_LIMIT),
      investigationHours: nonNegative(t.investigationHours), directCost: nonNegative(t.directCost), riskCost: nonNegative(t.riskCost),
      basis: BASES.includes(t.basis) ? t.basis : "illustrative", note: text(t.note, TEXT.note)
    };
  }

  /**
   * One line as bounded plain JSON, or null when it has no valid ID or an
   * unknown dimension. Inputs that are not numbers in range become blank.
   * errorTypes is kept only on an Errors and rework line that has some.
   */
  function lineOf(raw) {
    const l = plain(raw);
    const dim = DIMENSIONS[l.dimension];
    if (!util.isValidId(l.id) || !dim) return null;
    const given = plain(l.inputs);
    const out = {
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
    if (l.dimension === "rework" && Array.isArray(l.errorTypes) && l.errorTypes.length) {
      const seen = new Set();
      const types = l.errorTypes.slice(0, ERROR_TYPE_LIMIT).map(errorTypeOf).filter(t => t && !seen.has(t.id) && seen.add(t.id));
      if (types.length) out.errorTypes = types;
    }
    return out;
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

  /** A new ID that is not used in the list yet. */
  function newLineId(dimension, lines) {
    return util.uniqueId("vl-" + dimension, new Set((lines || []).map(l => l.id)));
  }

  function newErrorTypeId(name, types) {
    return util.uniqueId("et-" + util.slug(name || "error", 30), new Set((types || []).map(t => t.id)));
  }

  /*
   * The cost of one error type. Correction labor is the touch effort of the
   * steps the error makes people redo, plus the hours spent investigating,
   * at the hourly rate. Direct costs (credits, write-offs, penalties) and the
   * expected cost of rare severe consequences are added per error. Blank
   * optional costs count as none; a redone step without a touch effort, or
   * labor without an hourly rate, leaves the cost blank.
   * ctx: { hourlyRate: input, step(nodeId) -> { label, hours, basis } | null }.
   */
  function errorTypeCost(t, ctx) {
    const c = ctx || {};
    const missing = [];
    const bases = [t.basis];
    let redoHours = 0;
    t.redoNodeIds.forEach(id => {
      const s = c.step ? c.step(id) : null;
      if (!s) { missing.push("A redone step that is no longer in the process"); return; }
      if (!util.isFiniteNumber(s.hours)) { missing.push("Touch effort on " + s.label); return; }
      redoHours += s.hours;
      bases.push(s.basis);
    });
    const laborHours = redoHours + (t.investigationHours || 0);
    const r = c.hourlyRate && util.isFiniteNumber(c.hourlyRate.value) ? c.hourlyRate : null;
    if (laborHours > 0 && !r) missing.push("Hourly rate");
    if (r && laborHours > 0) bases.push(r.status || "supplied");
    if (!util.isFiniteNumber(t.perMonth)) missing.push("Errors per month today");
    if (!util.isFiniteNumber(t.perMonthAfter)) missing.push("Errors per month after the change");
    const costPerError = missing.some(m => m !== "Errors per month today" && m !== "Errors per month after the change") ? null
      : laborHours * (r ? r.value : 0) + (t.directCost || 0) + (t.riskCost || 0);
    const ok = costPerError !== null && util.isFiniteNumber(t.perMonth);
    return {
      id: t.id, name: t.name, severity: t.severity, perMonth: t.perMonth, perMonthAfter: t.perMonthAfter,
      redoHours: missing.length && costPerError === null ? null : redoHours, laborHours: costPerError === null ? null : laborHours,
      costPerError, yearlyToday: ok ? 12 * t.perMonth * costPerError : null,
      yearlyAvoided: ok && util.isFiniteNumber(t.perMonthAfter) ? 12 * (t.perMonth - t.perMonthAfter) * costPerError : null,
      missing, basis: weakest(bases)
    };
  }

  /* The cost of poor quality across the error types: blended cost per error, yearly cost today and avoided. */
  function costOfErrors(rows) {
    const done = rows.every(x => x.yearlyToday !== null);
    const errors = rows.reduce((s, x) => s + (x.perMonth || 0), 0);
    const today = done ? rows.reduce((s, x) => s + x.yearlyToday, 0) : null;
    return {
      errorsPerMonth: errors,
      blendedCostPerError: done && errors > 0 ? today / 12 / errors : null,
      yearlyToday: today,
      yearlyAvoided: rows.every(x => x.yearlyAvoided !== null) ? rows.reduce((s, x) => s + x.yearlyAvoided, 0) : null
    };
  }

  /**
   * One line's gross annual value, in the economics output shape (formula,
   * inputs, missing, basis). ctx: { annualVolume, hourlyRate } are project
   * assumption inputs that fill blank inputs, with a note, and step(nodeId)
   * gives a step's touch effort for error types. An Errors and rework line
   * with error types also carries errorTypes and costOfErrors.
   */
  function grossOf(line, ctx) {
    const dim = DIMENSIONS[line.dimension];
    const c = ctx || {};
    const notes = [];
    if (line.errorTypes && line.errorTypes.length) {
      const rows = line.errorTypes.map(t => errorTypeCost(t, c));
      const o = output({ key: "line:" + line.id, label: dim.label, unit: "currency", formula: dim.typesFormula }, {
        inputs: rows.map(x => Object.assign(inp(x.name + ", yearly cost avoided", x.yearlyAvoided, "currency", x.basis),
          { missingDetail: x.missing })),
        compute: () => rows.reduce((s, x) => s + x.yearlyAvoided, 0),
        notes: ["Built up from " + rows.length + " error type" + (rows.length === 1 ? "" : "s") + "; the error rates and cost per error above are not used.", dim.hint]
      });
      o.missing = [...new Set(rows.flatMap(x => x.missing.map(m => x.name + ": " + m.charAt(0).toLowerCase() + m.slice(1))))];
      o.errorTypes = rows;
      o.costOfErrors = costOfErrors(rows);
      return o;
    }
    const inputs = dim.inputs.map(d => {
      const v = line.inputs[d.key];
      const fb = d.fallback && c[d.fallback];
      if (!util.isFiniteNumber(v) && fb && util.isFiniteNumber(fb.value)) {
        notes.push(dim.label + ": " + d.label.toLowerCase() + " uses the project's " + fb.label.toLowerCase() + ".");
        return inp(d.label + " (" + fb.label.toLowerCase() + ")", fb.value, d.unit, fb.status);
      }
      return inp(d.label, v, d.unit, line.basis);
    });
    const x = Object.fromEntries(dim.inputs.map((d, i) => [d.key, inputs[i].value]));
    return output({ key: "line:" + line.id, label: dim.label, unit: "currency", formula: dim.formula }, { inputs, compute: () => dim.value(x), notes: notes.concat([dim.hint]) });
  }

  return {
    LIMIT, ERROR_TYPE_LIMIT, REDO_STEP_LIMIT, BASES, SEVERITIES, TREATMENTS, DIMENSIONS, DIMENSION_IDS, TEXT,
    lineOf, errorTypeOf, sanitizeLines, linesOf, newLineId, newErrorTypeId, errorTypeCost, costOfErrors, grossOf
  };
});
