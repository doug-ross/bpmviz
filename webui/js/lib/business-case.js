/*
 * BPMVIZ business-case: one-page business cases for a single opportunity, a
 * CFO one-pager across the whole portfolio, and the move-to-wave command.
 * Built entirely on lib/value-case.js: this file adds no new figures, only
 * ways to read and present the ones value-case.js already computes
 * (docs/business-case.md, docs/extensions.md).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./util.js"), require("./schema.js"), require("./value-case.js"));
  } else {
    const B = root.BPMVIZ = root.BPMVIZ || {};
    B.businessCase = factory(B.util, B.schema, B.valueCase);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, schema, valueCase) {
  "use strict";

  /* Figures shown on a one-pager, lead with the supporting figure and end with the headline. */
  const ONE_PAGER_KEYS = ["hoursPerCase", "annualHoursSaved", "laborCostSaved", "netAnnualBenefit",
    "fteReleased", "paybackMonths", "elapsedSavedPerCase"];

  function findRecord(e, recordId) {
    return (e && e.records || []).find(r => r.id === recordId) || null;
  }

  function quadrantLabel(quadrant) {
    return quadrant ? valueCase.QUADRANT_LABEL[quadrant] || quadrant : "";
  }

  /**
   * A one-page business case for one opportunity:
   * { recordId, title, owner, status, intervention, effort, wave, waveLabel,
   *   confidence, confidenceLabel, basis, outputs (ordered), missing, notes,
   *   affectedSteps, skippedSteps, oneTimeCost, annualRunningCost, note,
   *   rank, quadrant, quadrantLabel, suggestedWave, hasValueCase }.
   * Returns null when recordId does not name an opportunity in the engagement.
   * opts: passed through to value-case.js (scenarioId, includeSensitive, includeUnreviewedAi).
   */
  function buildOnePager(e, recordId, opts) {
    const r = findRecord(e, recordId);
    if (!r || r.kind !== "opportunity") return null;
    const o = r.opportunity || {};
    const vc = o.valueCase || null;
    const result = valueCase.compute(e, r, opts);
    const scope = valueCase.affected(e, r);
    const ranked = valueCase.rank(e, opts).find(x => x.recordId === r.id) || null;
    const outputs = ONE_PAGER_KEYS.map(key => result.outputs.find(x => x.key === key)).filter(Boolean);
    return {
      recordId: r.id, title: r.title, owner: r.owner || "", status: r.status,
      intervention: o.intervention ? schema.label("intervention", o.intervention) : "",
      effort: o.effort ? schema.label("effortSize", o.effort) : "",
      wave: o.wave || "", waveLabel: schema.label("wave", o.wave || ""),
      confidence: result.confidence, confidenceLabel: schema.label("confidence", result.confidence || ""),
      basis: result.basis, outputs, missing: result.missing, notes: result.notes,
      affectedSteps: scope.nodes.map(n => n.label), skippedSteps: scope.skipped,
      oneTimeCost: vc && util.isFiniteNumber(vc.oneTimeCost) ? vc.oneTimeCost : null,
      annualRunningCost: vc && util.isFiniteNumber(vc.annualRunningCost) ? vc.annualRunningCost : null,
      note: vc ? vc.note : "",
      rank: ranked ? ranked.rank : null, quadrant: ranked ? ranked.quadrant : null,
      quadrantLabel: quadrantLabel(ranked ? ranked.quadrant : null),
      suggestedWave: ranked ? ranked.suggestedWave : "", hasValueCase: !!vc
    };
  }

  /**
   * The CFO one-pager across the portfolio: every ranked opportunity plus
   * wave totals and overlap warnings, for the Business case present mode
   * and the handoff summary.
   * { rows (rank() rows plus title, waveLabel, quadrantLabel), waves, total, overlaps, notes }.
   */
  function buildPortfolioPager(e, opts) {
    const ranked = valueCase.rank(e, opts);
    const portfolio = valueCase.portfolio(e, opts);
    const byId = new Map((e.records || []).map(r => [r.id, r]));
    const rows = ranked.map(x => Object.assign({
      title: (byId.get(x.recordId) || {}).title || x.recordId,
      quadrantLabel: quadrantLabel(x.quadrant), waveLabel: schema.label("wave", x.wave)
    }, x));
    return { rows, waves: portfolio.waves, total: portfolio.total, overlaps: portfolio.overlaps, notes: portfolio.notes };
  }

  /**
   * The rank-table row for one opportunity (its score, quadrant and suggested
   * wave), or null when it is not ranked under these options (sensitive,
   * unreviewed, dropped, or not an opportunity).
   */
  function suggestWave(e, recordId, opts) {
    return valueCase.rank(e, opts).find(x => x.recordId === recordId) || null;
  }

  /**
   * opportunity/setWaves store command body: payload.changes = [{ id, wave }].
   * StoreError is passed in so this file stays free of a dependency on store.js.
   * Returns { ids } of the opportunities moved.
   */
  function applySetWaves(e, payload, StoreError) {
    const changes = Array.isArray(payload && payload.changes) ? payload.changes : [];
    if (!changes.length) throw new StoreError("invalid", "Nothing to move.");
    const ids = [];
    changes.forEach(change => {
      if (!change || typeof change.id !== "string") throw new StoreError("invalid", "Each change needs an opportunity id.");
      const r = findRecord(e, change.id);
      if (!r || r.kind !== "opportunity") throw new StoreError("not-found", "Opportunity not found.");
      if (!schema.ENUMS.wave.includes(change.wave)) throw new StoreError("invalid", "Unknown wave.");
      r.opportunity.wave = change.wave;
      r.updatedAt = util.nowIso();
      ids.push(r.id);
    });
    return { ids };
  }

  return { buildOnePager, buildPortfolioPager, suggestWave, applySetWaves, ONE_PAGER_KEYS };
});
