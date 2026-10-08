/*
 * BPMVIZ economics: formula-backed value outputs and reconciliation of
 * supplied figures against declared assumptions.
 *
 * Rules, from the source-grounded generator guidance:
 *  - Capacity release comes from human effort saved, never from cycle time.
 *  - Capacity is redeployable time, not headcount reduction or cash.
 *  - Incremental AI and service cost is part of the future-state cost.
 *  - A missing input suppresses the output; unknown is never treated as zero.
 *  - No output is called ROI; a payback period needs an investment basis.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./util.js"), require("./schema.js"), require("./units.js"));
  } else {
    const B = root.BPMVIZ = root.BPMVIZ || {};
    B.economics = factory(B.util, B.schema, B.units);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, schema, units) {
  "use strict";

  const STATUS_RANK = { illustrative: 0, supplied: 1, calculated: 1, validated: 2 };

  function driverDef(key) {
    return schema.DRIVERS.find(d => d.key === key) || { key, label: key, unit: "" };
  }

  /** Engagement assumptions merged with a scenario's declared overrides. */
  function driverMap(engagement, scenario) {
    const map = {};
    (engagement.assumptions || []).forEach(a => {
      if (!a || !a.key) return;
      map[a.key] = { key: a.key, label: a.label || driverDef(a.key).label, value: a.value,
        unit: a.unit || driverDef(a.key).unit, status: a.status || "illustrative", source: "engagement", note: a.note || "" };
    });
    const overrides = scenario && scenario.economics && scenario.economics.overrides;
    if (overrides) {
      Object.keys(overrides).forEach(key => {
        const o = overrides[key];
        if (!o || !util.isFiniteNumber(o.value)) return;
        map[key] = { key, label: driverDef(key).label, value: o.value, unit: driverDef(key).unit,
          status: o.status || "supplied", source: "scenario", note: o.note || "" };
      });
    }
    return map;
  }

  function modelIds(engagement, scenario) {
    const current = (engagement.models || []).find(m => m.role === "current");
    const econ = (scenario && scenario.economics) || {};
    const futureId = econ.afterModelId ||
      ((engagement.models || []).find(m => m.role === "future") || {}).id || null;
    return { before: econ.beforeModelId || (current && current.id) || null, after: futureId };
  }

  function measure(scenario, key) {
    return ((scenario && scenario.measures) || []).find(m => m.key === key) || null;
  }

  function hoursValue(m, modelId) {
    if (!m || !modelId || !m.values) return null;
    const v = m.values[modelId];
    if (!util.isFiniteNumber(v)) return null;
    if (m.unit === "minute") return v / 60;
    if (m.unit === "hour") return v;
    return null;
  }

  function cycleMinutes(scenario, modelId, timeBasis) {
    const m = measure(scenario, "cycleTime");
    if (m && m.values && util.isFiniteNumber(m.values[modelId])) {
      const minutes = units.toMinutes(m.values[modelId], m.unit, timeBasis);
      if (minutes !== null) return minutes;
    }
    const run = scenario && scenario.runs && scenario.runs[modelId];
    if (run && Array.isArray(run.visits) && run.visits.length) {
      return run.visits.reduce((max, v) => Math.max(max, v.end), 0);
    }
    return null;
  }

  /** Inputs for one scenario, gathered from measures, runs and drivers. */
  function scenarioInputs(engagement, scenario) {
    const ids = modelIds(engagement, scenario);
    const tb = engagement.meta && engagement.meta.timeBasis;
    const touch = measure(scenario, "humanTouch");
    return {
      ids,
      hasAfter: !!(ids.after && scenario && scenario.runs && scenario.runs[ids.after]) ||
        !!(ids.after && touch && touch.values && util.isFiniteNumber(touch.values[ids.after])),
      drivers: driverMap(engagement, scenario),
      beforeHours: hoursValue(touch, ids.before),
      afterHours: hoursValue(touch, ids.after),
      touchStatus: touch ? (touch.status || "supplied") : null,
      beforeCycle: cycleMinutes(scenario, ids.before, tb),
      afterCycle: ids.after ? cycleMinutes(scenario, ids.after, tb) : null,
      timeBasis: tb,
      currency: (engagement.meta && engagement.meta.currency) || "USD"
    };
  }

  function weakest(statuses) {
    let result = "validated";
    statuses.forEach(s => {
      const rank = STATUS_RANK[s] == null ? 0 : STATUS_RANK[s];
      if (rank < STATUS_RANK[result]) result = rank === 0 ? "illustrative" : "supplied";
    });
    return result;
  }

  function output(def, parts) {
    const missing = parts.inputs.filter(i => i.required !== false && !util.isFiniteNumber(i.value)).map(i => i.label);
    const present = parts.inputs.filter(i => util.isFiniteNumber(i.value));
    const value = missing.length ? null : parts.compute();
    return {
      key: def.key, label: def.label, unit: def.unit, formula: def.formula,
      inputs: parts.inputs, notes: (parts.notes || []).filter(Boolean),
      value: util.isFiniteNumber(value) ? value : null,
      missing,
      status: missing.length || !util.isFiniteNumber(value) ? "not-calculated" : "calculated",
      basis: weakest(present.map(i => i.status || "supplied"))
    };
  }

  function inp(label, value, unit, status, required) {
    return { label, value: util.isFiniteNumber(value) ? value : null, unit, status, required };
  }

  function driverInput(drivers, key, required) {
    const d = drivers[key];
    const def = driverDef(key);
    return inp(def.label, d ? d.value : null, def.unit, d ? d.status : null, required);
  }

  /**
   * Computes the value outputs for one scenario. Every output lists its
   * formula and inputs; outputs with missing required inputs have value null.
   */
  function computeValue(engagement, scenario) {
    const x = scenarioInputs(engagement, scenario);
    const d = x.drivers;
    const val = key => (d[key] && util.isFiniteNumber(d[key].value)) ? d[key].value : null;
    const rate = val("hourlyRate");
    const beforeNonLabor = val("beforeNonLaborCostPerCase");
    const afterNonLabor = val("afterNonLaborCostPerCase");
    const incremental = val("incrementalCostPerCase");
    const hoursStatus = x.touchStatus || "supplied";
    const outputs = [];

    const beforeCost = output({
      key: "beforeCost", label: "Current-state cost per case", unit: "currency",
      formula: "current human hours \u00d7 hourly rate + current non-labor cost"
    }, {
      inputs: [
        inp("Current human hours per case", x.beforeHours, "hour", hoursStatus),
        driverInput(d, "hourlyRate"),
        driverInput(d, "beforeNonLaborCostPerCase", false)
      ],
      compute: () => x.beforeHours * rate + (beforeNonLabor || 0),
      notes: [beforeNonLabor === null ? "Non-labor cost not supplied; the result covers labor only." : ""]
    });
    outputs.push(beforeCost);

    if (x.hasAfter) {
      outputs.unshift(output({
        key: "effortSaved", label: "Human effort saved per case", unit: "hour",
        formula: "current human hours \u2212 future human hours"
      }, {
        inputs: [
          inp("Current human hours per case", x.beforeHours, "hour", hoursStatus),
          inp("Future human hours per case", x.afterHours, "hour", hoursStatus)
        ],
        compute: () => x.beforeHours - x.afterHours
      }));

      const afterCost = output({
        key: "afterCost", label: "Future-state cost per case", unit: "currency",
        formula: "future human hours \u00d7 hourly rate + future non-labor cost + incremental AI and service cost"
      }, {
        inputs: [
          inp("Future human hours per case", x.afterHours, "hour", hoursStatus),
          driverInput(d, "hourlyRate"),
          driverInput(d, "afterNonLaborCostPerCase", false),
          driverInput(d, "incrementalCostPerCase")
        ],
        compute: () => x.afterHours * rate + (afterNonLabor || 0) + incremental,
        notes: [afterNonLabor === null ? "Non-labor cost not supplied; the result covers labor and incremental cost only." : ""]
      });
      outputs.push(afterCost);

      outputs.push(output({
        key: "costSaved", label: "Modeled cost difference per case", unit: "currency",
        formula: "current-state cost per case \u2212 future-state cost per case"
      }, {
        inputs: [
          inp("Current-state cost per case", beforeCost.value, "currency", beforeCost.basis),
          inp("Future-state cost per case", afterCost.value, "currency", afterCost.basis)
        ],
        compute: () => beforeCost.value - afterCost.value
      }));

      const effort = outputs.find(o => o.key === "effortSaved");
      outputs.push(output({
        key: "capacityFte", label: "Redeployable capacity (FTE-equivalent)", unit: "fte",
        formula: "human effort saved per case \u00d7 annual eligible volume \u00f7 productive hours per FTE"
      }, {
        inputs: [
          inp("Human effort saved per case", effort.value, "hour", effort.basis),
          driverInput(d, "annualVolume"),
          driverInput(d, "productiveHoursPerFte")
        ],
        compute: () => effort.value * val("annualVolume") / val("productiveHoursPerFte"),
        notes: ["Capacity is time that can be redeployed to other work. Headcount and cash savings depend on decisions this model does not make."]
      }));

      outputs.push(output({
        key: "cycleReduction", label: "Cycle time reduction", unit: "percent",
        formula: "(current cycle time \u2212 future cycle time) \u00f7 current cycle time \u00d7 100"
      }, {
        inputs: [
          inp("Current cycle time", x.beforeCycle, "minute", "supplied"),
          inp("Future cycle time", x.afterCycle, "minute", "supplied")
        ],
        compute: () => x.beforeCycle > 0 ? (x.beforeCycle - x.afterCycle) / x.beforeCycle * 100 : null,
        notes: ["Elapsed time only. Cost and capacity use human effort, not cycle time."]
      }));

      const saved = outputs.find(o => o.key === "costSaved");
      const annual = output({
        key: "annualCostDifference", label: "Modeled annual cost difference", unit: "currency",
        formula: "modeled cost difference per case \u00d7 annual eligible volume"
      }, {
        inputs: [
          inp("Modeled cost difference per case", saved.value, "currency", saved.basis),
          driverInput(d, "annualVolume")
        ],
        compute: () => saved.value * val("annualVolume"),
        notes: ["A modeled difference, not realized cash. Adoption, ramp-up and realization are not included."]
      });
      outputs.push(annual);

      outputs.push(output({
        key: "paybackMonths", label: "Simple payback period", unit: "count",
        formula: "one-time investment \u00f7 (modeled annual cost difference \u00f7 12)"
      }, {
        inputs: [
          driverInput(d, "oneTimeInvestment"),
          inp("Modeled annual cost difference", annual.value, "currency", annual.basis)
        ],
        compute: () => annual.value > 0 ? val("oneTimeInvestment") / (annual.value / 12) : null,
        notes: ["Months. Shown only when an investment basis is recorded."]
      }));
    }
    return { inputs: x, outputs };
  }

  function tolerance(supplied) {
    return Math.max(1, Math.abs(supplied) * 0.005);
  }

  /**
   * Compares figures supplied with a scenario against the declared
   * assumptions. Unreconciled figures are reported, never silently replaced.
   */
  function reconcileScenario(engagement, scenario) {
    const result = computeValue(engagement, scenario);
    const supplied = (scenario.economics && scenario.economics.supplied) || {};
    const byKey = Object.fromEntries(result.outputs.map(o => [o.key, o]));
    const x = result.inputs;
    const ctx = { currency: x.currency, timeBasis: x.timeBasis };
    const checks = [];
    const warnings = [];

    function check(key, label, suppliedValue, unit, digits) {
      if (!util.isFiniteNumber(suppliedValue)) return;
      const calc = byKey[key];
      if (!calc || calc.value === null) {
        checks.push({ key, label, supplied: suppliedValue, calculated: null, unit, status: "not-checkable",
          missing: calc ? calc.missing : ["future-state model"] });
        return;
      }
      const diff = suppliedValue - calc.value;
      const ok = digits != null ?
        Math.abs(Number(suppliedValue.toFixed(digits)) - Number(calc.value.toFixed(digits))) <= Math.pow(10, -digits) :
        Math.abs(diff) <= tolerance(suppliedValue);
      const item = { key, label, supplied: suppliedValue, calculated: calc.value, difference: diff, unit,
        status: ok ? "reconciled" : "unreconciled" };
      if (!ok && key === "afterCost" && util.isFiniteNumber(x.afterHours) && x.drivers.hourlyRate) {
        const nonLabor = x.drivers.afterNonLaborCostPerCase ? x.drivers.afterNonLaborCostPerCase.value : 0;
        item.impliedIncremental = suppliedValue - x.afterHours * x.drivers.hourlyRate.value - (nonLabor || 0);
      }
      checks.push(item);
      if (!ok) {
        let message = label + " is supplied as " + units.formatMeasure(suppliedValue, unit, ctx) +
          " but the declared assumptions give " + units.formatMeasure(calc.value, unit, ctx) + ".";
        if (item.impliedIncremental != null && x.drivers.incrementalCostPerCase) {
          message += " The supplied figure implies an incremental cost of " +
            units.formatMeasure(item.impliedIncremental, "currency", ctx) + " per case, not the declared " +
            units.formatMeasure(x.drivers.incrementalCostPerCase.value, "currency", ctx) +
            ". Record a scenario override or correct the figure.";
        }
        warnings.push({ code: "economics.unreconciled", key, message });
      }
    }

    check("beforeCost", "Current-state cost per case", supplied.beforeCostPerCase, "currency");
    check("afterCost", "Future-state cost per case", supplied.afterCostPerCase, "currency");
    check("costSaved", "Cost difference per case", supplied.costSavedPerCase, "currency");
    check("capacityFte", "Capacity release", supplied.fteCapacity, "fte", 1);
    const status = checks.some(c => c.status === "unreconciled") ? "unreconciled" :
      checks.length && checks.every(c => c.status === "reconciled") ? "reconciled" :
        checks.length ? "partial" : "none";
    return { status, checks, warnings, value: result };
  }

  /** Engagement-wide notes, such as scenarios that each annualize the same volume. */
  function engagementNotes(engagement) {
    const notes = [];
    const scenarios = engagement.scenarios || [];
    const annualized = scenarios.filter(s => {
      const r = computeValue(engagement, s).outputs.find(o => o.key === "capacityFte");
      return r && r.value !== null;
    });
    if (annualized.length > 1) {
      notes.push({
        code: "economics.annualization",
        message: "Each of the " + annualized.length + " scenarios annualizes the full eligible volume. " +
          "They describe alternatives, so their annual figures must not be added together."
      });
    }
    return notes;
  }

  /**
   * One-way sensitivity: each input moved down and up by `pct` percent with
   * the others held. Returns rows sorted by the width of the effect on the
   * chosen output, largest first. Inputs without a value are skipped.
   */
  function sensitivity(engagement, scenario, outputKey, pct) {
    const share = (pct == null ? 20 : pct) / 100;
    const base = computeValue(engagement, scenario).outputs.find(o => o.key === outputKey);
    if (!base || base.value === null) return { base: null, rows: [] };
    const ids = modelIds(engagement, scenario);
    const rows = [];
    const run = mutate => {
      const copy = util.clone(engagement);
      const s = copy.scenarios.find(x => x.id === scenario.id);
      mutate(copy, s);
      const out = computeValue(copy, s).outputs.find(o => o.key === outputKey);
      return out ? out.value : null;
    };
    const d = driverMap(engagement, scenario);
    Object.keys(d).forEach(key => {
      if (!util.isFiniteNumber(d[key].value) || d[key].value === 0) return;
      const setTo = f => (copy, s) => {
        const target = d[key].source === "scenario" ? s.economics.overrides[key] : copy.assumptions.find(a => a.key === key);
        target.value = d[key].value * f;
      };
      const low = run(setTo(1 - share)), high = run(setTo(1 + share));
      if (low !== null && high !== null) rows.push({ key, label: d[key].label, low, high, spread: Math.abs(high - low) });
    });
    const touch = measure(scenario, "humanTouch");
    [["before", "Current human hours per case"], ["after", "Future human hours per case"]].forEach(([side, label]) => {
      const id = ids[side];
      if (!touch || !id || !util.isFiniteNumber(touch.values[id]) || touch.values[id] === 0) return;
      const setTo = f => (copy, s) => { s.measures.find(m => m.key === "humanTouch").values[id] = touch.values[id] * f; };
      const low = run(setTo(1 - share)), high = run(setTo(1 + share));
      if (low !== null && high !== null) rows.push({ key: "hours-" + side, label, low, high, spread: Math.abs(high - low) });
    });
    rows.sort((a, b) => b.spread - a.spread);
    return { base: base.value, unit: base.unit, label: base.label, pct: share * 100, rows: rows.filter(r => r.spread > 1e-9) };
  }

  return { driverMap, modelIds, scenarioInputs, computeValue, reconcileScenario, engagementNotes, sensitivity };
});
