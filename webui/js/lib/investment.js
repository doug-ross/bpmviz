/*
 * AIxRay investment: an opportunity's business case over time. The yearly
 * benefit (the realizable value, or the modeled value when nothing is
 * marked realizable yet) ramps up with adoption, the costs are kept by
 * category, and the cash flows give NPV, ROI and the payback month, under
 * low, expected and high cases. A gain-share fee is priced on the value
 * Finance confirmed. See docs/value-dimensions.md, step 3.
 *
 * As everywhere in AIxRay, a missing input leaves a result blank rather
 * than counting as zero. Pure Node/browser library; loads before validation
 * and takes value-case's result as an input, so it does not depend on it.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./util.js"));
  else { const B = root.AIxRay = root.AIxRay || {}; B.investment = factory(B.util); }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util) {
  "use strict";

  const HORIZONS = [3, 4, 5];
  const COST_LIMIT = 20;
  const CATEGORIES = [
    ["implementation", "Implementation: design, build and testing"],
    ["integration", "Integration and data"],
    ["modelUsage", "Model and inference use"],
    ["orchestration", "Agent orchestration, tools and retries"],
    ["humanOversight", "Human review, approvals and fallback"],
    ["evaluation", "Evaluation and monitoring"],
    ["infrastructure", "Infrastructure and hosting"],
    ["governance", "Security and governance"],
    ["changeManagement", "Training and change management"],
    ["maintenance", "Maintenance"],
    ["other", "Other"]
  ];
  const CATEGORY_IDS = CATEGORIES.map(c => c[0]);
  const label = id => (CATEGORIES.find(c => c[0] === id) || [id, id])[1];

  const plain = x => util.isPlainObject(x) ? x : {};
  const text = (x, max) => typeof x === "string" ? x.slice(0, max).trim() : "";
  const nonNegative = x => util.isFiniteNumber(x) && x >= 0 ? x : null;
  const percent = (x, max) => nonNegative(x) !== null && x <= (max || 100) ? x : null;

  /** One cost line, or null when it has no valid ID. */
  function costOf(raw) {
    const c = plain(raw);
    if (!util.isValidId(c.id)) return null;
    return { id: c.id, category: CATEGORY_IDS.includes(c.category) ? c.category : "other", note: text(c.note, 300),
      oneTime: nonNegative(c.oneTime), yearly: nonNegative(c.yearly) };
  }

  /**
   * The investment settings in shape, or undefined when absent.
   * { horizonYears, discountRatePct, adoptionPct: [per year], costs,
   *   successfulWorkflowsPerYear, lowPct, highPct, gainSharePct, gainShareMonths }
   */
  function sanitizeInvestment(raw) {
    if (raw === undefined || raw === null) return undefined;
    const v = plain(raw);
    const horizon = HORIZONS.includes(v.horizonYears) ? v.horizonYears : 3;
    const seen = new Set();
    const costs = (Array.isArray(v.costs) ? v.costs.slice(0, COST_LIMIT) : []).map(costOf).filter(c => c && !seen.has(c.id) && seen.add(c.id));
    const ramp = Array.isArray(v.adoptionPct) ? v.adoptionPct : [];
    return {
      horizonYears: horizon,
      discountRatePct: percent(v.discountRatePct, 50),
      adoptionPct: Array.from({ length: horizon }, (_, i) => percent(ramp[i])),
      costs,
      successfulWorkflowsPerYear: nonNegative(v.successfulWorkflowsPerYear),
      lowPct: percent(v.lowPct), highPct: percent(v.highPct, 300),
      gainSharePct: percent(v.gainSharePct), gainShareMonths: Number.isInteger(v.gainShareMonths) && v.gainShareMonths > 0 && v.gainShareMonths <= 60 ? v.gainShareMonths : null
    };
  }

  /** A new cost ID that is not used yet. */
  function newCostId(category, costs) {
    return util.uniqueId("cost-" + category, new Set((costs || []).map(c => c.id)));
  }

  const sum = xs => xs.reduce((a, b) => a + b, 0);

  /*
   * The yearly benefit the investment case starts from, before running
   * costs: the realizable value when every part has a realizable share,
   * otherwise the modeled gross value, flagged.
   */
  function benefitBase(result) {
    const out = k => (result.outputs || []).find(o => o.key === k);
    const parts = result.parts || [];
    if (parts.length && parts.every(p => p.realizable !== null)) {
      return { value: sum(parts.map(p => p.realizable)), kind: "realizable", label: "Realizable annual value before running costs" };
    }
    const gross = out("grossAnnualValue") || out("laborCostSaved");
    if (gross && gross.value !== null) {
      return { value: gross.value, kind: "modeled", label: "Modeled annual value before running costs" };
    }
    return { value: null, kind: "missing", label: "Annual value" };
  }

  /* NPV, ROI and payback month for one set of yearly benefits and costs. Year 0 is the up-front investment. */
  function economicsOf(benefits, costs, ratePct) {
    const net = benefits.map((b, i) => (b === null || costs[i] === null ? null : b - costs[i]));
    const complete = net.every(x => x !== null);
    const npv = complete && ratePct !== null ? sum(net.map((x, t) => x / Math.pow(1 + ratePct / 100, t))) : null;
    const totalCost = complete ? sum(costs) : null;
    const roiPct = complete && totalCost > 0 ? (sum(benefits) - totalCost) / totalCost * 100 : null;
    let payback = null;
    if (complete) {
      let cum = net[0];
      if (cum >= 0) payback = 0;
      for (let t = 1; t < net.length && payback === null; t++) {
        if (cum + net[t] >= 0 && net[t] > 0) payback = (t - 1) * 12 + (-cum / net[t]) * 12;
        cum += net[t];
      }
    }
    let cumulative = 0;
    return {
      years: net.map((x, t) => {
        cumulative = x === null || cumulative === null ? null : cumulative + x;
        return { year: t, benefit: benefits[t], cost: costs[t], net: x,
          discounted: x === null || ratePct === null ? null : x / Math.pow(1 + ratePct / 100, t), cumulative };
      }),
      npv, roiPct, paybackMonths: payback, totalBenefit: complete ? sum(benefits) : null, totalCost
    };
  }

  /* One-time and yearly cost: the cost lines, or else the business case's one-time and running cost. */
  function costsOf(record, inv) {
    const vc = (record.opportunity && record.opportunity.valueCase) || {};
    if (inv.costs.length) return { oneTime: sum(inv.costs.map(c => c.oneTime || 0)), yearly: sum(inv.costs.map(c => c.yearly || 0)), lines: true };
    return { oneTime: nonNegative(vc.oneTimeCost), yearly: nonNegative(vc.annualRunningCost) === null ? 0 : vc.annualRunningCost, lines: false };
  }

  /**
   * The investment case for one opportunity. result is valueCase.compute()
   * for the same record. cases, optional, is { low, high }, each { record,
   * result } for the business case with every figure at the low or high end
   * of its range (lib/ranges.js); the low and high cases then come from
   * them instead of a share of the expected benefit. Returns null when the
   * opportunity has no investment settings. Otherwise:
   * { base, horizonYears, discountRatePct, years, npv, roiPct, paybackMonths,
   *   totalBenefit, totalCost, oneTimeCost, yearlyCost, costsByCategory,
   *   scenarios: { low, expected, high }, costPerSuccessfulWorkflow,
   *   gainShare, missing, notes }.
   */
  function compute(record, result, cases) {
    const inv = record && record.opportunity && record.opportunity.investment;
    if (!inv) return null;
    const vc = (record.opportunity && record.opportunity.valueCase) || {};
    const notes = [], missing = [];
    const base = benefitBase(result);
    if (base.kind === "modeled") notes.push("No part of the business case is marked realizable yet, so the yearly benefit is the modeled value. Set how much can be realized to make this the case Finance would fund.");
    if (base.kind === "missing") missing.push("Annual value");

    // Costs: the cost lines, or else the business case's one-time and running cost.
    const { oneTime, yearly, lines: useLines } = costsOf(record, inv);
    if (!useLines) notes.push("Costs are the business case's one-time and annual running cost. Add cost lines to break them down by category.");
    else if (util.isFiniteNumber(vc.oneTimeCost) || util.isFiniteNumber(vc.annualRunningCost)) notes.push("The cost lines replace the business case's one-time and annual running cost here.");
    if (oneTime === null) missing.push("One-time cost");

    const ramp = inv.adoptionPct;
    ramp.forEach((p, i) => { if (p === null) missing.push("Adoption in year " + (i + 1)); });
    if (inv.discountRatePct === null) missing.push("Discount rate");

    const yearsOf = (value, factor) => [0].concat(ramp.map(p => (value === null || p === null ? null : value * factor * p / 100)));
    const costsFor = c => [c.oneTime].concat(ramp.map(() => c.yearly));
    const costs = costsFor({ oneTime, yearly });
    const expected = economicsOf(yearsOf(base.value, 1), costs, inv.discountRatePct);
    const fromRanges = !!(cases && cases.low && cases.high);
    // From the ranges: the case's own benefit and costs, both moved by its figures. Otherwise a share of the expected benefit.
    const scenario = fromRanges ? c => economicsOf(yearsOf(benefitBase(c.result).value, 1), costsFor(costsOf(c.record, inv)), inv.discountRatePct) :
      pct => (pct === null ? null : economicsOf(yearsOf(base.value, pct / 100), costs, inv.discountRatePct));
    const low = scenario(fromRanges ? cases.low : inv.lowPct), high = scenario(fromRanges ? cases.high : inv.highPct);
    if (fromRanges) notes.push("The low and high cases set every figure to the end of its range that lowers or raises the value, so the costs can move too.");

    const byCategory = CATEGORY_IDS.map(id => {
      const lines = inv.costs.filter(c => c.category === id);
      return lines.length ? { category: id, label: label(id), oneTime: sum(lines.map(c => c.oneTime || 0)), yearly: sum(lines.map(c => c.yearly || 0)) } : null;
    }).filter(Boolean);

    const workflows = inv.successfulWorkflowsPerYear;
    const costPerSuccessfulWorkflow = workflows && workflows > 0 ? yearly / workflows : null;
    if (useLines && workflows) notes.push("Cost per successful workflow divides every yearly cost, including failed runs, retries and review, by the workflows that complete correctly.");

    // Gain-share is priced on the value Finance confirmed, never on a forecast.
    const confirmed = (result.outputs || []).find(o => o.key === "validatedAnnualValue");
    const gainShare = inv.gainSharePct === null || inv.gainShareMonths === null ? null : {
      sharePct: inv.gainSharePct, months: inv.gainShareMonths, confirmedAnnual: confirmed ? confirmed.value : null,
      fee: confirmed && confirmed.value !== null ? confirmed.value * inv.gainShareMonths / 12 * inv.gainSharePct / 100 : null
    };
    if (gainShare && gainShare.fee === null) notes.push("The gain-share fee is priced on the value Finance confirmed, and none is confirmed yet.");
    notes.push("Year 0 is the up-front cost. Benefits are spread evenly within each year for the payback month.");

    return Object.assign({
      base, horizonYears: inv.horizonYears, discountRatePct: inv.discountRatePct, adoptionPct: ramp,
      oneTimeCost: oneTime, yearlyCost: yearly, costsByCategory: byCategory,
      scenarios: {
        low: low ? { pct: fromRanges ? null : inv.lowPct, source: fromRanges ? "ranges" : "share", npv: low.npv, roiPct: low.roiPct, paybackMonths: low.paybackMonths } : null,
        expected: { pct: 100, source: "expected", npv: expected.npv, roiPct: expected.roiPct, paybackMonths: expected.paybackMonths },
        high: high ? { pct: fromRanges ? null : inv.highPct, source: fromRanges ? "ranges" : "share", npv: high.npv, roiPct: high.roiPct, paybackMonths: high.paybackMonths } : null
      },
      costPerSuccessfulWorkflow, gainShare, missing, notes
    }, expected);
  }

  return { HORIZONS, CATEGORIES, CATEGORY_IDS, COST_LIMIT, sanitizeInvestment, newCostId, benefitBase, economicsOf, compute };
});
