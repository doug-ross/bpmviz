/*
 * AIxRay business-case: one-page business cases for a single opportunity, a
 * CFO one-pager across the whole portfolio, and the move-to-wave command.
 * Built entirely on lib/value-case.js: this file adds no new figures, only
 * ways to read and present the ones value-case.js already computes
 * (docs/business-case.md, docs/extensions.md).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./util.js"), require("./schema.js"), require("./value-case.js"), require("./goals.js"), () => require("./benefits.js"));
  } else {
    const B = root.AIxRay = root.AIxRay || {};
    B.businessCase = factory(B.util, B.schema, B.valueCase, B.goals, () => B.benefits);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, schema, valueCase, goals, benefits) {
  "use strict";

  /* Figures shown on a one-pager, lead with the supporting figure and end with the headline. */
  const ONE_PAGER_KEYS = ["hoursPerCase", "annualHoursSaved", "laborCostSaved", "netAnnualBenefit",
    "fteReleased", "paybackMonths", "elapsedSavedPerCase"];

  function findRecord(e, recordId) {
    return (e && e.records || []).find(r => r.id === recordId) || null;
  }

  /* A goal as reports show it: { id, kind, kindLabel, title, metric, target, by, basis, aiDraft }. */
  function goalSummary(g) {
    return {
      id: g.id, kind: g.kind, kindLabel: schema.label("goalKind", g.kind), title: g.title, metric: g.metric,
      target: goals.targetText(g), by: g.by, owner: g.owner, basis: g.basis, aiDraft: goals.isUnreviewedAi(g)
    };
  }

  /* Checkpoints recorded by hand for one opportunity, from benefits.js (loaded after this file in the browser). */
  function checkpointRows(e, recordId, opts) {
    const lib = benefits();
    const row = lib ? lib.expectedVsCheckpoints(e, opts).find(x => x.recordId === recordId) : null;
    return row ? row.checkpoints : [];
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
   * Returns null when recordId does not name an opportunity in the engagement,
   * or names a sensitive record and opts.includeSensitive is not set, or an
   * unreviewed AI draft and opts.includeUnreviewedAi is not set (the same
   * rule as valueCase.opportunities() and exporting.selectRecords).
   * opts: passed through to value-case.js (scenarioId, includeSensitive, includeUnreviewedAi).
   */
  function buildOnePager(e, recordId, opts) {
    const r = findRecord(e, recordId);
    if (!r || r.kind !== "opportunity") return null;
    const options = opts || {};
    if (r.sensitive && !options.includeSensitive) return null;
    if (r.generated && !r.generated.reviewed && !options.includeUnreviewedAi) return null;
    const rec = valueCase.forReport(r, options);
    const op = rec.opportunity || {};
    const vc = op.valueCase || null;
    const result = valueCase.compute(e, rec, opts);
    const scope = valueCase.affected(e, r);
    const ranked = valueCase.rank(e, opts).find(x => x.recordId === r.id) || null;
    const outputs = ONE_PAGER_KEYS.map(key => result.outputs.find(x => x.key === key)).filter(Boolean);
    return {
      recordId: r.id, title: r.title, owner: r.owner || "", status: r.status,
      intervention: op.intervention ? schema.label("intervention", op.intervention) : "",
      effort: op.effort ? schema.label("effortSize", op.effort) : "",
      wave: op.wave || "", waveLabel: schema.label("wave", op.wave || ""),
      confidence: result.confidence, confidenceLabel: schema.label("confidence", result.confidence || ""),
      basis: result.basis, outputs, missing: result.missing,
      notes: result.notes.filter(n => !/^Not counted as work steps:/.test(n)),
      affectedSteps: scope.nodes.map(n => n.label), skippedSteps: scope.skipped,
      oneTimeCost: vc && util.isFiniteNumber(vc.oneTimeCost) ? vc.oneTimeCost : null,
      annualRunningCost: vc && util.isFiniteNumber(vc.annualRunningCost) ? vc.annualRunningCost : null,
      note: vc ? vc.note : "",
      rank: ranked ? ranked.rank : null, quadrant: ranked ? ranked.quadrant : null,
      quadrantLabel: quadrantLabel(ranked ? ranked.quadrant : null),
      suggestedWave: ranked ? ranked.suggestedWave : "", hasValueCase: !!vc,
      aiDraft: valueCase.hasDraftValueCase(rec),
      goals: goals.goalsFor(e, r, options).map(goalSummary),
      checkpoints: checkpointRows(e, r.id, options)
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
    const visible = goals.visibleGoals(e, opts);
    const goalIdsOf = r => {
      const ids = new Set(r && r.opportunity && Array.isArray(r.opportunity.goalIds) ? r.opportunity.goalIds : []);
      return visible.filter(g => ids.has(g.id)).map(g => g.id);
    };
    const rows = ranked.map(x => Object.assign({
      title: (byId.get(x.recordId) || {}).title || x.recordId,
      quadrantLabel: quadrantLabel(x.quadrant), waveLabel: schema.label("wave", x.wave),
      goalIds: goalIdsOf(byId.get(x.recordId))
    }, x));
    const goalRows = visible.map(g => Object.assign(goalSummary(g), { recordIds: rows.filter(x => x.goalIds.includes(g.id)).map(x => x.recordId) }));
    return { rows, goals: goalRows, waves: portfolio.waves, total: portfolio.total, overlaps: portfolio.overlaps, notes: portfolio.notes };
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

  return { buildOnePager, buildPortfolioPager, goalSummary, suggestWave, applySetWaves, ONE_PAGER_KEYS };
});
