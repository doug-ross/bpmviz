/*
 * AIxRay value-case: the modeled value of one opportunity, a ranking of
 * opportunities, and totals per delivery wave. Inputs come from the
 * opportunity's value case (record.opportunity.valueCase), the engagement
 * assumptions and, when linked, an event-log dataset.
 *
 * Outputs have the same shape as economics.computeValue outputs. As there:
 * a missing required input leaves the result blank, unknown is never zero,
 * and every result carries the weakest status of its inputs. Effort saving
 * is money; elapsed time saving is time only and is never priced.
 *
 * The function signatures are part of the extension contract
 * (docs/extensions.md); the business-case feature builds on them.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./util.js"), require("./schema.js"), require("./units.js"), require("./economics.js"), require("./dataset-query.js"));
  } else {
    const B = root.AIxRay = root.AIxRay || {};
    B.valueCase = factory(B.util, B.schema, B.units, B.economics, B.datasetQuery);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, schema, units, economics, dq) {
  "use strict";

  const { output, inp, driverInput, weakest } = economics.helpers;
  const CONFIDENCE_FACTOR = { low: 0.5, medium: 0.75, high: 1 };
  const EFFORT_SCORE = { S: 1, M: 2, L: 3 };
  const WAVES = ["now", "next", "later"];
  const SUGGESTED = { "quick-win": "now", major: "next", "fill-in": "later", reconsider: "later" };
  const QUADRANT_LABEL = { "quick-win": "Quick win", major: "Major project", "fill-in": "Fill-in", reconsider: "Reconsider" };

  function isTask(node) {
    return schema.typeInfo(node.semanticType).shape === "task";
  }

  function scenarioOf(e, opts) {
    const id = opts && opts.scenarioId;
    return id ? (e.scenarios || []).find(s => s.id === id) || null : null;
  }

  function modelFor(e, record, vc, nodeIds) {
    const byId = id => (id ? e.models.find(m => m.id === id) || null : null);
    return byId(vc && vc.modelId) || byId(record.linkedModelId) ||
      (nodeIds.length ? e.models.find(m => nodeIds.every(id => m.nodes.some(n => n.id === id))) : null) ||
      e.models.find(m => m.role === "current") || null;
  }

  /** The steps an opportunity affects: { model, nodes (tasks only), skipped (labels), nodeIds }. */
  function affected(e, record) {
    const vc = (record.opportunity && record.opportunity.valueCase) || null;
    const ids = vc && vc.nodeIds && vc.nodeIds.length ? vc.nodeIds : record.linkedNodeIds || [];
    const model = modelFor(e, record, vc, ids);
    const nodes = [], skipped = [];
    if (model) {
      ids.forEach(id => {
        const n = model.nodes.find(x => x.id === id);
        if (!n) return;
        if (isTask(n) && !n.removed) nodes.push(n); else skipped.push(n.label);
      });
    }
    return { model, nodes, skipped, nodeIds: nodes.map(n => n.id) };
  }

  function nodeStatus(n) {
    return n.provenance && n.provenance.validation === "validated" ? "validated" : "supplied";
  }

  function hoursOf(m) {
    if (!m || !util.isFiniteNumber(m.value)) return null;
    if (m.unit === "hour") return m.value;
    if (m.unit === "minute") return m.value / 60;
    return null;
  }

  function p50(stats) {
    return stats && util.isFiniteNumber(stats.p50) ? stats.p50 : null;
  }

  function pct(v) {
    return util.formatNumber(v * 100, 1) + "%";
  }

  /**
   * The modeled value of one opportunity:
   * { recordId, outputs, basis, confidence, missing, notes }.
   * opts: { scenarioId } selects scenario overrides of the assumptions.
   */
  function compute(e, record, opts) {
    const vc = record && record.opportunity && record.opportunity.valueCase;
    if (!vc) {
      return { recordId: record ? record.id : null, outputs: [], basis: null, confidence: "", missing: ["value case"], notes: ["This opportunity has no business case yet."] };
    }
    const notes = [];
    const drivers = economics.driverMap(e, scenarioOf(e, opts));
    const val = key => (drivers[key] && util.isFiniteNumber(drivers[key].value) ? drivers[key].value : null);
    const tb = e.meta && e.meta.timeBasis;
    const dataset = vc.datasetId ? dq.get(e, vc.datasetId) : null;
    const dsBasis = dataset ? dq.basisOf(dataset) : null;
    const scope = affected(e, record);
    if (scope.skipped.length) notes.push("Not counted as work steps: " + scope.skipped.join(", ") + ".");
    if (vc.datasetId && !dataset) notes.push("The linked event log is no longer in this project.");

    // Hours per affected case, step by step. A step's visits come from the
    // event log when it has them. When the share of cases affected also
    // comes from the event log, each step's visits are weighted by the
    // fraction of the affected cases that reach that particular step (its
    // case share divided by the affected share), so a step only some
    // affected cases visit is not charged to every affected case.
    const datasetShare = (vc.shareSource === "dataset" && dataset) ? dq.caseShareForNodes(dataset, scope.nodeIds) : null;
    let assumedVisits = 0;
    let shareAssumedEven = false;
    const stepInputs = scope.nodes.map(n => {
      let hours = null, status = null;
      const s = dataset ? dq.step(dataset, n.id) : null;
      if (vc.effortSource === "dataset") {
        const minutes = s ? p50(s.duration) : null;
        hours = minutes === null ? null : minutes / 60;
        status = dsBasis;
        if (s && s.duration && dq.smallSample(s.duration)) notes.push(n.label + ": the measured time comes from only " + s.duration.n + " visits.");
      } else {
        hours = hoursOf(n.measures && n.measures.touchEffort);
        status = nodeStatus(n);
      }
      let visits = s && s.cases > 0 ? s.visits / s.cases : null;
      let visitStatus = dsBasis;
      if (visits === null) {
        visits = 1; visitStatus = null; assumedVisits++;
      } else if (datasetShare && datasetShare.value > 0 && util.isFiniteNumber(s.caseShare)) {
        visits *= Math.min(1, s.caseShare / datasetShare.value);
      } else {
        shareAssumedEven = true;
      }
      const label = (vc.effortSource === "dataset" ? "Measured median time x visits, " : "Touch effort x visits, ") + n.label;
      return inp(label, hours === null ? null : hours * visits, "hour", weakest([status || "supplied"].concat(visitStatus ? [visitStatus] : [])));
    });
    if (assumedVisits) notes.push("One visit per affected case is assumed for " + assumedVisits + " step" + (assumedVisits === 1 ? "" : "s") + " with no event log data.");
    if (shareAssumedEven && scope.nodes.length > 1) notes.push("The share of cases affected is assumed to apply evenly across every affected step, because the event log can't show which affected cases reach which step.");
    if (vc.effortSource === "dataset") notes.push("Measured step time stands in for effort, so it can include waiting within the step.");
    const hoursPerCase = output({
      key: "hoursPerCase", label: "Human hours per affected case", unit: "hour",
      formula: "sum over affected steps of (touch effort in hours, or measured median time) \u00d7 visits per affected case"
    }, {
      inputs: stepInputs.length ? stepInputs : [inp("Affected work steps", null, "count", null)],
      compute: () => stepInputs.reduce((sum, i) => sum + i.value, 0)
    });

    // Annual volume, from the assumptions or else from the event log.
    let volumeInput = driverInput(drivers, "annualVolume");
    if (!util.isFiniteNumber(volumeInput.value) && dataset && dq.annualVolume(dataset) !== null) {
      volumeInput = inp("Annual volume (from the event log)", dq.annualVolume(dataset), "casesPerYear", dsBasis);
      notes.push("Annual volume is scaled up to a year from the period the event log covers.");
    }

    // Share of cases affected.
    let shareInput;
    if (vc.shareSource === "dataset") {
      const cs = dataset ? dq.caseShareForNodes(dataset, scope.nodeIds) : null;
      shareInput = inp("Share of cases affected (from the event log)", cs ? cs.value * 100 : null, "percent", dsBasis);
      if (cs && !cs.exact) notes.push("Between " + pct(cs.lower) + " and " + pct(cs.upper) + " of cases reach these steps. The exact share isn't known because some less common paths were not kept from the event log.");
    } else {
      shareInput = inp("Share of cases affected", vc.shareOfCasesPct, "percent", vc.basis);
    }
    const reductionInput = inp("Effort reduction", vc.effortReductionPct, "percent", vc.basis);

    const annualHours = output({
      key: "annualHoursSaved", label: "Human hours saved per year", unit: "hour",
      formula: "annual volume \u00d7 share of cases affected \u00d7 hours per affected case \u00d7 effort reduction"
    }, {
      inputs: [volumeInput, shareInput, inp("Human hours per affected case", hoursPerCase.value, "hour", hoursPerCase.basis), reductionInput],
      compute: () => volumeInput.value * shareInput.value / 100 * hoursPerCase.value * reductionInput.value / 100
    });

    const labor = output({
      key: "laborCostSaved", label: "Labor cost of the hours saved per year", unit: "currency",
      formula: "human hours saved per year \u00d7 hourly rate"
    }, {
      inputs: [inp("Human hours saved per year", annualHours.value, "hour", annualHours.basis), driverInput(drivers, "hourlyRate")],
      compute: () => annualHours.value * val("hourlyRate")
    });

    const running = vc.annualRunningCost;
    const net = output({
      key: "netAnnualBenefit", label: "Modeled net annual benefit", unit: "currency",
      formula: "labor cost of the hours saved per year \u2212 annual running cost"
    }, {
      inputs: [inp("Labor cost of the hours saved per year", labor.value, "currency", labor.basis),
        inp("Annual running cost", running, "currency", vc.basis, false)],
      compute: () => labor.value - (running || 0),
      notes: [running === null || running === undefined ? "Annual running cost not recorded, so this figure is before running costs." : "",
        "A modeled benefit, not realized cash. Adoption and ramp-up are not included."]
    });

    const fte = output({
      key: "fteReleased", label: "Time freed up (FTE-equivalent)", unit: "fte",
      formula: "human hours saved per year \u00f7 productive hours per FTE"
    }, {
      inputs: [inp("Human hours saved per year", annualHours.value, "hour", annualHours.basis), driverInput(drivers, "productiveHoursPerFte")],
      compute: () => annualHours.value / val("productiveHoursPerFte"),
      notes: ["This is time people can spend on other work. Any headcount or cash saving depends on decisions outside this estimate."]
    });

    const payback = output({
      key: "paybackMonths", label: "Simple payback period", unit: "count",
      formula: "one-time cost \u00f7 (modeled net annual benefit \u00f7 12)"
    }, {
      inputs: [inp("One-time cost", vc.oneTimeCost, "currency", vc.basis), inp("Modeled net annual benefit", net.value, "currency", net.basis)],
      compute: () => (net.value > 0 ? vc.oneTimeCost / (net.value / 12) : null),
      notes: ["Months. Shown only when the net annual benefit is above zero."]
    });

    // Elapsed time: measured median durations where the event log has them, else typed typical durations.
    const durationInputs = scope.nodes.map(n => {
      const s = dataset ? dq.step(dataset, n.id) : null;
      const observed = s ? p50(s.duration) : null;
      if (observed !== null) return inp("Measured median time, " + n.label, observed, "minute", dsBasis);
      const t = n.measures && n.measures.typicalDuration;
      const minutes = t && util.isFiniteNumber(t.value) ? units.toMinutes(t.value, t.unit, tb) : null;
      return inp("Typical duration, " + n.label, minutes, "minute", nodeStatus(n));
    });
    const durationReduction = inp("Duration reduction", vc.durationReductionPct, "percent", vc.basis);
    const elapsed = output({
      key: "elapsedSavedPerCase", label: "Elapsed time saved per affected case", unit: "minute",
      formula: "sum of affected step durations \u00d7 duration reduction"
    }, {
      inputs: (durationInputs.length ? durationInputs : [inp("Affected work steps", null, "count", null)]).concat([durationReduction]),
      compute: () => durationInputs.reduce((sum, i) => sum + i.value, 0) * durationReduction.value / 100,
      notes: ["Elapsed time only. It is not converted to money."]
    });

    const outputs = [hoursPerCase, annualHours, labor, net, fte, payback, elapsed];
    const head = headline({ outputs });
    return {
      recordId: record.id,
      outputs,
      basis: head ? head.basis : null,
      confidence: vc.confidence || "",
      missing: [...new Set(outputs.filter(o => o.key !== "elapsedSavedPerCase" && o.key !== "paybackMonths").flatMap(o => o.missing))],
      notes: [...new Set(notes)]
    };
  }

  /** The figure an opportunity is ranked by: net annual benefit, else hours saved per year. */
  function headline(result) {
    const pick = key => (result.outputs || []).find(o => o.key === key && o.value !== null);
    const o = pick("netAnnualBenefit") || pick("annualHoursSaved");
    return o ? { key: o.key, value: o.value, unit: o.unit, basis: o.basis } : null;
  }

  function opportunities(e, opts) {
    const o = opts || {};
    return (e.records || []).filter(r => r.kind === "opportunity" && r.status !== "dropped" &&
      (o.includeSensitive || !r.sensitive) && (o.includeUnreviewedAi || !(r.generated && !r.generated.reviewed)) &&
      (!o.ids || o.ids.includes(r.id)));
  }

  function median(values) {
    const v = values.slice().sort((a, b) => a - b);
    if (!v.length) return null;
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  }

  /**
   * Opportunities in rank order: [{ recordId, title, rank, score, value, unit,
   * basis, effortScore, confidenceFactor, quadrant, wave, suggestedWave }].
   * score = value \u00d7 confidence factor (low 0.5, medium 0.75, high 1; not set
   * counts as low) \u00f7 effort (S 1, M 2, L 3). Money values rank ahead of
   * hours-only values, which rank ahead of opportunities that cannot be scored.
   * Quadrants compare value with the median of the same unit; S and M are low
   * effort. The suggested wave is advice only; the consultant sets the wave.
   * opts: { scenarioId, includeSensitive, includeUnreviewedAi, ids }.
   */
  function rank(e, opts) {
    const rows = opportunities(e, opts).map(r => {
      const result = compute(e, r, opts);
      const head = headline(result);
      const o = r.opportunity || {};
      const vc = o.valueCase || {};
      const effortScore = EFFORT_SCORE[o.effort] || null;
      const confidenceFactor = CONFIDENCE_FACTOR[vc.confidence] || CONFIDENCE_FACTOR.low;
      return {
        recordId: r.id, title: r.title, rank: 0,
        score: head && effortScore ? head.value * confidenceFactor / effortScore : null,
        value: head ? head.value : null, unit: head ? head.unit : null, basis: head ? head.basis : null,
        effortScore, confidenceFactor, quadrant: null, wave: o.wave || "", suggestedWave: ""
      };
    });
    ["currency", "hour"].forEach(unit => {
      const group = rows.filter(x => x.unit === unit && x.effortScore);
      const mid = median(group.map(x => x.value));
      group.forEach(x => {
        const high = x.value > 0 && x.value >= mid;
        const low = x.effortScore <= 2;
        x.quadrant = high ? (low ? "quick-win" : "major") : (low ? "fill-in" : "reconsider");
        x.suggestedWave = SUGGESTED[x.quadrant];
      });
    });
    const tier = x => (x.score === null ? 2 : x.unit === "currency" ? 0 : 1);
    rows.sort((a, b) => tier(a) - tier(b) || (b.score || 0) - (a.score || 0) || String(a.title).localeCompare(String(b.title)));
    rows.forEach((x, i) => { x.rank = i + 1; });
    return rows;
  }

  function sum(list) {
    return list.length ? list.reduce((a, b) => a + b, 0) : null;
  }

  /**
   * Totals per wave: { waves: [{ wave, label, recordIds, annualHoursSaved,
   * netAnnualBenefit, oneTimeCost, fteReleased, incomplete }], total, overlaps, notes }.
   * Sums cover opportunities with that figure; incomplete counts those without
   * a net annual benefit. total covers now, next and later, and also carries
   * total.overlaps: steps that two or more planned opportunities change,
   * whichever waves they are in, since the total adds every wave together.
   * overlaps (top level) lists only steps shared by opportunities in the
   * same wave, for the Waves board.
   */
  function portfolio(e, opts) {
    const records = opportunities(e, opts);
    const results = new Map(records.map(r => [r.id, compute(e, r, opts)]));
    const value = (r, key) => {
      const out = results.get(r.id).outputs.find(o => o.key === key);
      return out && out.value !== null ? out.value : null;
    };
    const totals = list => {
      const pick = key => sum(list.map(r => value(r, key)).filter(v => v !== null));
      return {
        recordIds: list.map(r => r.id),
        annualHoursSaved: pick("annualHoursSaved"),
        netAnnualBenefit: pick("netAnnualBenefit"),
        oneTimeCost: sum(list.map(r => r.opportunity.valueCase && r.opportunity.valueCase.oneTimeCost).filter(util.isFiniteNumber)),
        fteReleased: pick("fteReleased"),
        incomplete: list.filter(r => value(r, "netAnnualBenefit") === null).length
      };
    };
    const waveOf = r => (WAVES.includes(r.opportunity && r.opportunity.wave) ? r.opportunity.wave : "");
    const waves = WAVES.concat([""]).map(w => Object.assign({ wave: w, label: schema.label("wave", w) }, totals(records.filter(r => waveOf(r) === w))));
    const planned = records.filter(r => waveOf(r));
    const total = totals(planned);
    const overlaps = [];
    WAVES.forEach(w => {
      const byStep = new Map();
      records.filter(r => waveOf(r) === w).forEach(r => {
        const scope = affected(e, r);
        scope.nodes.forEach(n => {
          const key = scope.model.id + "|" + n.id;
          if (!byStep.has(key)) byStep.set(key, { wave: w, modelId: scope.model.id, nodeId: n.id, label: n.label, recordIds: [] });
          byStep.get(key).recordIds.push(r.id);
        });
      });
      byStep.forEach(x => { if (x.recordIds.length > 1) overlaps.push(x); });
    });
    // The total adds every planned wave together, so two opportunities that
    // change the same step in different waves would otherwise be counted
    // twice with no warning. Look for shared steps across the whole planned
    // set, not just within one wave.
    const byStepAcrossWaves = new Map();
    planned.forEach(r => {
      const w = waveOf(r);
      const scope = affected(e, r);
      scope.nodes.forEach(n => {
        const key = scope.model.id + "|" + n.id;
        if (!byStepAcrossWaves.has(key)) byStepAcrossWaves.set(key, { modelId: scope.model.id, nodeId: n.id, label: n.label, recordIds: [], waves: new Set() });
        const entry = byStepAcrossWaves.get(key);
        entry.recordIds.push(r.id);
        entry.waves.add(w);
      });
    });
    const totalOverlaps = [];
    byStepAcrossWaves.forEach(x => { if (x.waves.size > 1) totalOverlaps.push({ modelId: x.modelId, nodeId: x.nodeId, label: x.label, recordIds: x.recordIds, waves: [...x.waves] }); });
    total.overlaps = totalOverlaps;
    const notes = ["Wave totals add up the opportunities planned in each wave. They are modeled figures, not realized savings."];
    if (overlaps.length) notes.push(overlaps.length + " step" + (overlaps.length === 1 ? " is" : "s are") + " changed by more than one opportunity in the same wave, so their savings may be counted twice.");
    if (totalOverlaps.length) notes.push(totalOverlaps.length + " step" + (totalOverlaps.length === 1 ? " is" : "s are") +
      " changed by opportunities planned in more than one wave, so the total may count part of their savings twice: " + totalOverlaps.map(x => x.label).join(", ") + ".");
    if (total.incomplete) notes.push(total.incomplete + " planned opportunit" + (total.incomplete === 1 ? "y has" : "ies have") + " no net annual benefit yet and " + (total.incomplete === 1 ? "is" : "are") + " left out of the money totals.");
    return { waves, total, overlaps, notes };
  }

  return { compute, rank, portfolio, headline, affected, CONFIDENCE_FACTOR, EFFORT_SCORE, QUADRANT_LABEL, SUGGESTED_WAVE: SUGGESTED };
});
