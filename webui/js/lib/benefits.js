/*
 * BPMVIZ benefits: compares two event-log datasets (a baseline and one taken
 * after a change) step by step, and checks whether an opportunity's modeled
 * value case was realized by what the logs actually measured.
 *
 * This library never says "savings realized": a measured change can be
 * confounded by seasonality, volume mix or a mapping that drifted between
 * the two logs, so the comparisons are reported as measured change, with
 * caveats, not as proven savings. It is read-only and never writes to the
 * engagement; see docs/benefits.md.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./util.js"), require("./dataset-query.js"), require("./value-case.js"));
  } else {
    const B = root.BPMVIZ = root.BPMVIZ || {};
    B.benefits = factory(B.util, B.datasetQuery, B.valueCase);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, dq, valueCase) {
  "use strict";

  /* A step resting on fewer visits than this in either log is flagged as a small sample. */
  const SMALL_SAMPLE_MIN = 30;

  /* Ratio of realized to expected that counts as met or partial. */
  const MET_RATIO = 0.8;
  const PARTIAL_RATIO = 0.2;

  const STATUS = { MET: "met", PARTIAL: "partial", NOT_YET: "not-yet", WORSE: "worse", NOT_MEASURABLE: "not-measurable" };

  function p50(stats) {
    return stats && util.isFiniteNumber(stats.p50) ? stats.p50 : null;
  }

  function nodeLabel(e, modelId, nodeId) {
    const m = (e.models || []).find(x => x.id === modelId);
    const n = m && m.nodes.find(x => x.id === nodeId);
    return n ? n.label : nodeId;
  }

  function pair(before, after) {
    return { before: before === undefined || before === null ? null : before, after: after === undefined || after === null ? null : after };
  }

  function datasetHeader(d) {
    return d ? { id: d.id, name: d.name, dataStatus: d.dataStatus, modelId: d.modelId } : null;
  }

  /**
   * Compares a baseline dataset against one taken after a change, step by
   * step: { baseline, after, overall, steps, unmatched, caveats }. Steps
   * correspond through dataset-query's correspondence, which follows model
   * lineage in either direction (a dataset mapped to the same model as the
   * other corresponds to itself). Either id can be missing from the
   * engagement; the result then has no overall or steps, and a caveat says
   * why. Durations and sojourns are the Stats objects the datasets carry
   * (minutes in each dataset's own time basis); the view converts them.
   */
  function compareDatasets(e, baselineId, afterId) {
    const baseline = dq.get(e, baselineId);
    const after = dq.get(e, afterId);
    const caveats = [];
    if (!baseline || !after) {
      caveats.push("One of the two event logs is no longer in the engagement, so nothing can be compared.");
      return { baseline: datasetHeader(baseline), after: datasetHeader(after), overall: null, steps: [], unmatched: [], caveats };
    }

    const corr = (baseline.modelId && after.modelId) ? dq.correspondence(e, baseline.modelId, after.modelId) : new Map();
    const matchedAfterIds = new Set(corr.values());

    const steps = [];
    const unmatched = [];
    let smallSampleSteps = 0;

    (baseline.steps || []).forEach(bs => {
      const afterNodeId = corr.get(bs.nodeId);
      if (!afterNodeId) {
        unmatched.push({ nodeId: bs.nodeId, label: nodeLabel(e, baseline.modelId, bs.nodeId), side: "baseline" });
        return;
      }
      const as = dq.step(after, afterNodeId);
      if (!bs.duration && !bs.sojourn && !(as && (as.duration || as.sojourn))) return; // an event or gateway: nothing to compare
      const small = dq.smallSample(bs.duration, SMALL_SAMPLE_MIN) || dq.smallSample(as && as.duration, SMALL_SAMPLE_MIN) ||
        dq.smallSample(bs.sojourn, SMALL_SAMPLE_MIN) || dq.smallSample(as && as.sojourn, SMALL_SAMPLE_MIN);
      if (small) smallSampleSteps++;
      steps.push({
        nodeId: bs.nodeId, afterNodeId, label: nodeLabel(e, baseline.modelId, bs.nodeId),
        duration: { before: bs.duration || null, after: (as && as.duration) || null },
        sojourn: { before: bs.sojourn || null, after: (as && as.sojourn) || null },
        reworkRate: pair(bs.reworkRate, as && as.reworkRate),
        caseShare: pair(bs.caseShare, as && as.caseShare),
        visitsPerCase: pair(dq.visitsPerCase(baseline, bs.nodeId), as ? dq.visitsPerCase(after, afterNodeId) : null),
        smallSample: small
      });
    });
    (after.steps || []).forEach(as => {
      if (matchedAfterIds.has(as.nodeId)) return;
      unmatched.push({ nodeId: as.nodeId, label: nodeLabel(e, after.modelId, as.nodeId), side: "after" });
    });

    const overall = {
      cases: { before: baseline.cases.count, after: after.cases.count },
      annualizedVolume: { before: dq.annualVolume(baseline), after: dq.annualVolume(after) },
      period: { before: baseline.period, after: after.period },
      cycleTime: { before: baseline.cases.cycleTime || null, after: after.cases.cycleTime || null }
    };

    if (util.isFiniteNumber(baseline.period && baseline.period.days) && util.isFiniteNumber(after.period && after.period.days) &&
      baseline.period.days > 0 && Math.abs(after.period.days - baseline.period.days) / baseline.period.days > 0.2) {
      caveats.push("The two measurement periods are different lengths (" + baseline.period.days + " vs " + after.period.days +
        " days), which can affect volume and mix.");
    }
    if (util.isFiniteNumber(overall.cases.before) && util.isFiniteNumber(overall.cases.after) && overall.cases.before > 0 &&
      Math.abs(overall.cases.after - overall.cases.before) / overall.cases.before > 0.2) {
      caveats.push("Case volume differs by more than 20% between the two logs; the mix of work may not be the same.");
    }
    if (unmatched.length) {
      caveats.push(unmatched.length + " step" + (unmatched.length === 1 ? "" : "s") + " in one log " +
        (unmatched.length === 1 ? "has" : "have") + " no match in the other, usually because the mapping changed.");
    }
    if (smallSampleSteps) {
      caveats.push(smallSampleSteps + " step" + (smallSampleSteps === 1 ? "" : "s") + " rest" + (smallSampleSteps === 1 ? "s" : "") +
        " on fewer than " + SMALL_SAMPLE_MIN + " visits in one of the logs; treat the change with caution.");
    }
    if (baseline.dataStatus === "demonstration" || after.dataStatus === "demonstration") {
      caveats.push("At least one of the two event logs is demonstration data, not from a real engagement.");
    }

    return { baseline: datasetHeader(baseline), after: datasetHeader(after), overall, steps, unmatched, caveats };
  }

  /**
   * Checks each opportunity's modeled value case against what the two event
   * logs measured on its affected steps: [{ recordId, title, expected,
   * realized, ratio, status, notes }]. expected and realized are
   * { value, unit, basis, label } or null; both are in human hours per year
   * so a measured change in effort is never shown as money. ratio is
   * realized divided by expected, or null when either is not available.
   * status is "met" (realized is at least 80% of expected), "partial" (20 to
   * 80%), "not-yet" (under 20%), "worse" (the measured change moved the
   * wrong way) or "not-measurable".
   */
  function expectedVsRealized(e, baselineId, afterId) {
    const baseline = dq.get(e, baselineId);
    const after = dq.get(e, afterId);
    const corr = (baseline && after && baseline.modelId && after.modelId) ? dq.correspondence(e, baseline.modelId, after.modelId) : new Map();
    const records = (e.records || []).filter(r => r.kind === "opportunity" && r.status !== "dropped" && r.opportunity && r.opportunity.valueCase);

    return records.map(r => {
      const notes = [];
      const result = valueCase.compute(e, r);
      const hoursOut = (result.outputs || []).find(o => o.key === "annualHoursSaved");
      const expected = hoursOut && hoursOut.value !== null ?
        { value: hoursOut.value, unit: "hour", basis: hoursOut.basis, label: "Modeled human hours saved per year" } : null;
      if (!expected) notes.push("The value case for this opportunity is not complete enough to model a figure to compare against.");

      let realized = null;
      if (!baseline || !after) {
        notes.push("One of the two event logs is no longer in the engagement.");
      } else {
        const scope = valueCase.affected(e, r);
        if (!scope.model || scope.model.id !== baseline.modelId) {
          notes.push("This opportunity's steps are not in the model the baseline event log maps to.");
        } else if (!scope.nodeIds.length) {
          notes.push("This opportunity has no linked work steps to measure.");
        } else {
          let beforeHours = 0, afterHours = 0, matched = 0, small = false;
          scope.nodeIds.forEach(id => {
            const afterNodeId = corr.get(id);
            const bs = dq.step(baseline, id);
            const as = afterNodeId ? dq.step(after, afterNodeId) : null;
            const bd = p50(bs && bs.duration), ad = p50(as && as.duration);
            if (bd === null || ad === null) {
              notes.push(nodeLabel(e, baseline.modelId, id) + ": the two event logs do not both have a measured duration for this step.");
              return;
            }
            const bv = dq.visitsPerCase(baseline, id), av = dq.visitsPerCase(after, afterNodeId);
            beforeHours += (bd / 60) * (bv === null ? 1 : bv);
            afterHours += (ad / 60) * (av === null ? 1 : av);
            matched++;
            if (dq.smallSample(bs.duration, SMALL_SAMPLE_MIN) || dq.smallSample(as.duration, SMALL_SAMPLE_MIN)) small = true;
          });
          if (matched) {
            const afterNodeIds = scope.nodeIds.map(id => corr.get(id)).filter(Boolean);
            const share = dq.caseShareForNodes(after, afterNodeIds);
            const shareValue = share ? share.value : 1;
            const volume = util.isFiniteNumber(dq.annualVolume(after)) ? dq.annualVolume(after) : dq.annualVolume(baseline);
            if (util.isFiniteNumber(volume)) {
              realized = { value: (beforeHours - afterHours) * shareValue * volume, unit: "hour", basis: "observed", label: "Measured human hours saved per year" };
              if (small) notes.push("At least one measured step rests on fewer than " + SMALL_SAMPLE_MIN + " visits in one of the logs.");
              if (share && !share.exact) notes.push("The share of cases touching these steps is estimated from the event log, not exact.");
            } else {
              notes.push("Neither event log has an annual volume to scale the measured change to a year.");
            }
          }
        }
      }

      let ratio = null, status = STATUS.NOT_MEASURABLE;
      if (expected && realized) {
        if (realized.value < 0) {
          status = STATUS.WORSE;
        } else if (expected.value > 0) {
          ratio = realized.value / expected.value;
          status = ratio >= MET_RATIO ? STATUS.MET : ratio >= PARTIAL_RATIO ? STATUS.PARTIAL : STATUS.NOT_YET;
        }
      }
      return { recordId: r.id, title: r.title, expected, realized, ratio, status, notes };
    });
  }

  /**
   * A lens for BPMVIZ.lenses.registerLens: the percent change in each step's
   * median duration between a model's most recent baseline log and the most
   * recent log marked as after a change that compares to it. ctx is the
   * usual lens context ({ model, engagement, ... }); returns the lens result
   * shape directly, with no data when there is no such pair yet.
   */
  function observedChangeLens(ctx) {
    const e = ctx.engagement;
    const model = ctx.model;
    const result = {
      description: "Change in each step's median duration, measured between a baseline event log and one taken after a change.",
      unit: "Percent change in median duration.", population: "", coverage: null, nodes: {}, edges: {}, legend: [], notes: []
    };
    const baseline = model ? dq.forModel(e, model.id, "baseline") : null;
    if (!baseline) {
      result.notes.push("No baseline event log is recorded for this model.");
      return result;
    }
    const afterCandidates = dq.list(e, { role: "after" }).filter(d => d.comparesToDatasetId === baseline.id);
    const after = afterCandidates.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0] || null;
    if (!after) {
      result.notes.push("No event log taken after a change is recorded against " + baseline.name + ".");
      return result;
    }
    const cmp = compareDatasets(e, baseline.id, after.id);
    result.population = "Steps measured in " + baseline.name + " and " + after.name + ".";
    let have = 0;
    cmp.steps.forEach(s => {
      const before = p50(s.duration.before), afterValue = p50(s.duration.after);
      if (before === null || afterValue === null || before === 0) return;
      have++;
      const pct = (afterValue - before) / before * 100;
      const category = pct <= -5 ? "faster" : pct >= 5 ? "slower" : "flat";
      result.nodes[s.nodeId] = { category, text: (pct > 0 ? "+" : "") + util.formatNumber(pct, 0) + "% duration" };
    });
    result.coverage = { have, total: cmp.steps.length, text: have + " of " + cmp.steps.length + " measured steps have a duration in both logs" };
    result.legend = [
      { category: "faster", label: "Faster after the change" },
      { category: "slower", label: "Slower after the change" },
      { category: "flat", label: "About the same" }
    ];
    cmp.caveats.forEach(c => result.notes.push(c));
    return result;
  }

  return { compareDatasets, expectedVsRealized, observedChangeLens, STATUS, SMALL_SAMPLE_MIN, MET_RATIO, PARTIAL_RATIO };
});
