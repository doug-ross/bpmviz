/*
 * AIxRay benefits: compares two event-log datasets (a baseline and one taken
 * after a change) step by step, and checks whether an opportunity's modeled
 * value case was realized by what the logs actually measured.
 *
 * This library never says "savings realized": a measured change can be
 * confounded by seasonality, volume mix or a mapping that drifted between
 * the two logs, so the comparisons are reported as measured change, with
 * caveats, not as proven savings. It is read-only and never writes to the
 * engagement; see docs/benefits.md.
 *
 * Without event logs, a delivery team can record checkpoints by hand
 * (engagement.checkpoints, lib/checkpoints.js): expectedVsCheckpoints
 * compares those with the same business case figures.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./util.js"), require("./dataset-query.js"), require("./value-case.js"), require("./economics.js"));
  } else {
    const B = root.AIxRay = root.AIxRay || {};
    B.benefits = factory(B.util, B.datasetQuery, B.valueCase, B.economics);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, dq, valueCase, economics) {
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

  /* True when two datasets measure time the same way, so their durations can be compared. */
  function sameTimeBasis(a, b) {
    const x = (a && a.timeBasis) || {}, y = (b && b.timeBasis) || {};
    const cal = t => (t.calendar === "business" ? "business" : "calendar");
    if (cal(x) !== cal(y)) return false;
    return cal(x) === "calendar" || ((x.businessMinutesPerDay || 480) === (y.businessMinutesPerDay || 480));
  }

  /* The weaker of the two datasets' assumption statuses (demonstration data is illustrative). */
  function pairBasis(a, b) {
    const order = ["illustrative", "supplied", "observed"];
    const x = order.indexOf(dq.basisOf(a)), y = order.indexOf(dq.basisOf(b));
    return order[Math.min(x < 0 ? 1 : x, y < 0 ? 1 : y)];
  }

  /*
   * Human minutes a step costs per case in the log, over every case (not
   * only the cases that visit it): median duration x visits per visiting
   * case x share of cases that visit it. null without a median duration.
   */
  function minutesPerCase(dataset, s) {
    const d = p50(s && s.duration);
    if (d === null) return null;
    const visits = s.cases > 0 ? s.visits / s.cases : 1;
    const share = util.isFiniteNumber(s.caseShare) ? s.caseShare : 1;
    return d * visits * share;
  }

  /*
   * True when the after log shows a step is no longer visited: the after
   * model removed it, or the after log's mapping sends activities to it
   * but no case reached it. Without either, a missing step is unknown.
   */
  function goneInAfter(e, after, afterNodeId) {
    const m = (e.models || []).find(x => x.id === after.modelId);
    const n = m && m.nodes.find(x => x.id === afterNodeId);
    if (n && n.removed) return true;
    return (after.mapping || []).some(x => x.nodeId === afterNodeId);
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
      caveats.push("One of the two event logs is no longer in the project, so nothing can be compared.");
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
      // Only statistics a log actually has count: the first step of a case has no sojourn, which is not a small sample.
      const thin = st => !!st && dq.smallSample(st, SMALL_SAMPLE_MIN);
      const small = thin(bs.duration) || thin(as && as.duration) || thin(bs.sojourn) || thin(as && as.sojourn);
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
      caveats.push("The two logs cover periods of different lengths (" + baseline.period.days + " and " + after.period.days +
        " days), which can change volume and mix.");
    }
    if (util.isFiniteNumber(overall.cases.before) && util.isFiniteNumber(overall.cases.after) && overall.cases.before > 0 &&
      Math.abs(overall.cases.after - overall.cases.before) / overall.cases.before > 0.2) {
      caveats.push("Case volume differs by more than 20% between the two logs, so the mix of work may have changed.");
    }
    if (unmatched.length) {
      caveats.push(unmatched.length + " step" + (unmatched.length === 1 ? "" : "s") + " in one log " +
        (unmatched.length === 1 ? "has" : "have") + " no match in the other, usually because the activity matching changed.");
    }
    if (smallSampleSteps) {
      caveats.push(smallSampleSteps + " step" + (smallSampleSteps === 1 ? "" : "s") + " rest" + (smallSampleSteps === 1 ? "s" : "") +
        " on fewer than " + SMALL_SAMPLE_MIN + " visits in one of the logs, so " + (smallSampleSteps === 1 ? "its" : "their") + " change is less reliable.");
    }
    if (!sameTimeBasis(baseline, after)) {
      caveats.push("The two event logs measure time differently (calendar and business time, or different working days), so their durations cannot be compared. Import one of them again with the other's time basis.");
    }
    if (baseline.dataStatus === "demonstration" || after.dataStatus === "demonstration") {
      caveats.push("At least one of the two event logs is demonstration data.");
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
    const records = (e.records || []).filter(r => r.kind === "opportunity" && r.status !== "dropped" && r.opportunity && r.opportunity.valueCase &&
      !valueCase.hasDraftValueCase(r));

    return records.map(r => {
      const notes = [];
      const result = valueCase.compute(e, r);
      const hoursOut = (result.outputs || []).find(o => o.key === "annualHoursSaved");
      const expected = hoursOut && hoursOut.value !== null ?
        { value: hoursOut.value, unit: "hour", basis: hoursOut.basis, label: "Modeled human hours saved per year" } : null;
      if (!expected) notes.push("The business case for this opportunity is not complete enough to give an expected figure.");

      let realized = null;
      if (!baseline || !after) {
        notes.push("One of the two event logs is no longer in the project.");
      } else if (!sameTimeBasis(baseline, after)) {
        notes.push("The two event logs measure time differently, so their durations cannot be compared.");
      } else {
        const scope = valueCase.affected(e, r);
        if (!scope.model || scope.model.id !== baseline.modelId) {
          notes.push("This opportunity's steps are not in the process version the baseline log is measured against.");
        } else if (!scope.nodeIds.length) {
          notes.push("This opportunity has no linked work steps to measure.");
        } else {
          // Minutes per case over every case in each log, so a change in how
          // many cases reach a step counts as well as a change in its duration.
          let beforeMinutes = 0, afterMinutes = 0, matched = 0, small = false;
          scope.nodeIds.forEach(id => {
            const label = nodeLabel(e, baseline.modelId, id);
            const afterNodeId = corr.get(id);
            const bs = dq.step(baseline, id);
            const as = afterNodeId ? dq.step(after, afterNodeId) : null;
            const before = minutesPerCase(baseline, bs);
            let afterValue = minutesPerCase(after, as);
            if (before === null) {
              notes.push(label + ": the baseline event log has no measured duration for this step.");
              return;
            }
            if (afterValue === null && !as && afterNodeId && goneInAfter(e, after, afterNodeId)) {
              afterValue = 0;
              notes.push(label + ": no case in the after log reaches this step, so it counts as no time.");
            }
            if (afterValue === null) {
              notes.push(label + ": the after log has no measured duration for this step.");
              return;
            }
            beforeMinutes += before;
            afterMinutes += afterValue;
            matched++;
            if (dq.smallSample(bs.duration, SMALL_SAMPLE_MIN) || (as && dq.smallSample(as.duration, SMALL_SAMPLE_MIN))) small = true;
          });
          if (matched) {
            // Scale with the same annual volume the modeled figure uses, so the
            // two figures differ only by what the logs measured; fall back to
            // the after log's own annualized volume.
            const hoursInputs = (hoursOut && hoursOut.inputs) || [];
            const modeledVolume = hoursInputs.length && util.isFiniteNumber(hoursInputs[0].value) && hoursInputs[0].unit === "casesPerYear" ? hoursInputs[0].value : null;
            const volume = modeledVolume !== null ? modeledVolume : util.isFiniteNumber(dq.annualVolume(after)) ? dq.annualVolume(after) : dq.annualVolume(baseline);
            if (util.isFiniteNumber(volume)) {
              realized = { value: (beforeMinutes - afterMinutes) / 60 * volume, unit: "hour", basis: pairBasis(baseline, after), label: "Measured change in human hours per year" };
              if (modeledVolume === null) notes.push("The measured change is scaled to the after log's annualized volume, as the business case has none.");
              if (small) notes.push("At least one measured step rests on fewer than " + SMALL_SAMPLE_MIN + " visits in one of the logs.");
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

  function statusOf(expected, realized) {
    if (!expected || !realized) return { ratio: null, status: STATUS.NOT_MEASURABLE };
    if (realized.value < 0) return { ratio: null, status: STATUS.WORSE };
    if (!(expected.value > 0)) return { ratio: null, status: STATUS.NOT_MEASURABLE };
    const ratio = realized.value / expected.value;
    return { ratio, status: ratio >= MET_RATIO ? STATUS.MET : ratio >= PARTIAL_RATIO ? STATUS.PARTIAL : STATUS.NOT_YET };
  }

  /**
   * Expected versus realized from checkpoints recorded by hand, one row per
   * opportunity that has checkpoints:
   * { recordId, title, expected, notes, checkpoints: [{ id, label, date,
   *   realized, realizedMoney, outputs, ratio, status, basis, source, note,
   *   cycleTimeAfterMinutes, oneTimeCostActual, notes }] }.
   * Realized human hours a year = annual volume x share of cases affected x
   * (hours per affected case before - hours per affected case after). The
   * "before" figure is the business case's own hours per affected case, and
   * volume and share come from the checkpoint when it records them, else
   * from the business case. Status uses the same thresholds as the event-log
   * comparison. opts: { scenarioId, includeSensitive, includeUnreviewedAi }.
   */
  function expectedVsCheckpoints(e, opts) {
    const o = opts || {};
    const { output, inp } = economics.helpers;
    const byRecord = new Map();
    ((e && e.checkpoints) || []).forEach(c => {
      if (!byRecord.has(c.recordId)) byRecord.set(c.recordId, []);
      byRecord.get(c.recordId).push(c);
    });
    const records = ((e && e.records) || []).filter(r => r.kind === "opportunity" && byRecord.has(r.id) &&
      (o.includeSensitive || !r.sensitive) && (o.includeUnreviewedAi || !(r.generated && !r.generated.reviewed)));
    const when = c => c.date || "9999-99-99";
    return records.map(raw => {
      const r = valueCase.forReport(raw, o);
      const vc = (r.opportunity && r.opportunity.valueCase) || null;
      const result = valueCase.compute(e, r, o);
      const out = key => (result.outputs || []).find(x => x.key === key) || null;
      const annual = out("annualHoursSaved"), perCase = out("hoursPerCase"), labor = out("laborCostSaved");
      const expected = annual && annual.value !== null ?
        { value: annual.value, unit: "hour", basis: annual.basis, label: "Modeled human hours saved per year" } : null;
      const notes = [];
      if (!vc) notes.push(result.notes[0]);
      else if (!expected) notes.push("The business case for this opportunity is not complete enough to give an expected figure.");
      const volumeIn = annual ? annual.inputs[0] : null, shareIn = annual ? annual.inputs[1] : null;
      const rateIn = labor ? labor.inputs[1] : null;
      const running = vc && util.isFiniteNumber(vc.annualRunningCost) ? vc.annualRunningCost : null;
      const before = perCase ? perCase.value : null, beforeBasis = perCase ? perCase.basis : null;
      const rows = byRecord.get(raw.id).slice().sort((a, b) => when(a) < when(b) ? -1 : when(a) > when(b) ? 1 : 0).map(c => {
        const cn = [];
        const volume = c.annualVolume !== null ? inp("Annual volume (at this checkpoint)", c.annualVolume, "casesPerYear", c.basis)
          : inp("Annual volume", volumeIn ? volumeIn.value : null, "casesPerYear", volumeIn ? volumeIn.status : null);
        const share = c.shareOfCasesPct !== null ? inp("Share of cases affected (at this checkpoint)", c.shareOfCasesPct, "percent", c.basis)
          : inp("Share of cases affected", shareIn ? shareIn.value : null, "percent", shareIn ? shareIn.status : null);
        const hours = output({
          key: "realizedHoursSaved", label: "Realized human hours saved per year", unit: "hour",
          formula: "annual volume \u00d7 share of cases affected \u00d7 (hours per affected case before \u2212 hours per affected case after)"
        }, {
          inputs: [volume, share, inp("Human hours per affected case before", before, "hour", beforeBasis),
            inp("Human hours per affected case after", c.hoursPerCaseAfter, "hour", c.basis)],
          compute: () => volume.value * share.value / 100 * (before - c.hoursPerCaseAfter)
        });
        const money = output({
          key: "realizedNetBenefit", label: "Realized net annual benefit", unit: "currency",
          formula: "realized human hours saved per year \u00d7 hourly rate \u2212 annual running cost"
        }, {
          inputs: [inp("Realized human hours saved per year", hours.value, "hour", hours.basis),
            rateIn ? inp(rateIn.label, rateIn.value, rateIn.unit, rateIn.status) : inp("Hourly rate", null, "currencyPerHour", null),
            inp("Annual running cost", running, "currency", vc ? vc.basis : null, false)],
          compute: () => hours.value * rateIn.value - (running || 0),
          notes: ["The hours are priced at the hourly rate. This is not cash unless the freed time is used or the cost is removed."]
        });
        if (before === null) cn.push("The business case has no hours per affected case to compare with.");
        else if (beforeBasis === "illustrative") cn.push("The hours per affected case before the change are illustrative, so the realized figure is too.");
        if (hours.value !== null && money.value === null) cn.push("No hourly rate is set, so the realized figure is in hours only.");
        if (c.shareOfCasesPct !== null && shareIn && util.isFiniteNumber(shareIn.value) && Math.abs(c.shareOfCasesPct - shareIn.value) > 0.001) {
          cn.push("This checkpoint uses a share of cases of " + util.formatNumber(c.shareOfCasesPct, 1) + "%, where the business case uses " + util.formatNumber(shareIn.value, 1) + "%.");
        }
        if (c.annualVolume !== null && volumeIn && util.isFiniteNumber(volumeIn.value) && Math.abs(c.annualVolume - volumeIn.value) > 0.001) {
          cn.push("This checkpoint uses " + util.formatNumber(c.annualVolume, 0) + " cases a year, where the business case uses " + util.formatNumber(volumeIn.value, 0) + ".");
        }
        const realized = hours.value !== null ? { value: hours.value, unit: "hour", basis: hours.basis, label: hours.label } : null;
        const realizedMoney = money.value !== null ? { value: money.value, unit: "currency", basis: money.basis, label: money.label } : null;
        const st = statusOf(expected, realized);
        return {
          id: c.id, label: c.label, date: c.date, realized, realizedMoney, outputs: [hours, money], ratio: st.ratio, status: st.status,
          basis: realized ? realized.basis : c.basis, source: c.source, note: c.note,
          cycleTimeAfterMinutes: c.cycleTimeAfterMinutes, oneTimeCostActual: c.oneTimeCostActual, notes: cn
        };
      });
      return { recordId: raw.id, title: raw.title, expected, notes, checkpoints: rows };
    });
  }

  /**
   * A lens for AIxRay.lenses.registerLens: the percent change in each step's
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

  return { compareDatasets, expectedVsRealized, expectedVsCheckpoints, observedChangeLens, STATUS, SMALL_SAMPLE_MIN, MET_RATIO, PARTIAL_RATIO };
});
