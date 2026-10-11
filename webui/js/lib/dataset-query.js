/*
 * AIxRay dataset-query: read-only questions about the event-log datasets in
 * an engagement (engagement.datasets, see docs/extensions.md). Every
 * function tolerates an engagement without datasets. Shares are fractions
 * between 0 and 1; durations are minutes in the dataset's time basis.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./util.js"));
  else { const B = root.AIxRay = root.AIxRay || {}; B.datasetQuery = factory(B.util); }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util) {
  "use strict";

  function all(e) {
    return (e && Array.isArray(e.datasets)) ? e.datasets : [];
  }

  /** Datasets, optionally only those for one model and role. */
  function list(e, opts) {
    const o = opts || {};
    return all(e).filter(d => (!o.modelId || d.modelId === o.modelId) && (!o.role || d.role === o.role));
  }

  function get(e, id) {
    return all(e).find(d => d.id === id) || null;
  }

  /** The most recent dataset for a model and role (baseline by default), or null. */
  function forModel(e, modelId, role) {
    const found = list(e, { modelId, role: role || "baseline" });
    if (!found.length) return null;
    return found.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
  }

  /** The assumption status a figure from this dataset carries. */
  function basisOf(dataset) {
    const s = dataset && dataset.dataStatus;
    if (s === "observed") return "observed";
    if (s === "demonstration") return "illustrative";
    return "supplied";
  }

  function step(dataset, nodeId) {
    return (dataset && Array.isArray(dataset.steps) ? dataset.steps : []).find(s => s.nodeId === nodeId) || null;
  }

  /** Average visits to a step among the cases that visit it, or null. */
  function visitsPerCase(dataset, nodeId) {
    const s = step(dataset, nodeId);
    return s && s.cases > 0 ? s.visits / s.cases : null;
  }

  function annualVolume(dataset) {
    const v = dataset && dataset.cases && dataset.cases.annualizedVolume;
    return util.isFiniteNumber(v) ? v : null;
  }

  /**
   * Share of cases that visit at least one of nodeIds: { value, lower, upper, exact }.
   * Cases in the kept variants are counted exactly. Cases in the variants
   * that were not kept (otherVariants) are assumed to visit at the same rate,
   * which gives value; lower and upper assume none or all of them do, and are
   * narrowed by the per-step shares. exact is true when every case is in a
   * kept variant. Returns null when the dataset has no cases.
   */
  function caseShareForNodes(dataset, nodeIds) {
    if (!dataset) return null;
    const ids = new Set(nodeIds || []);
    const variants = Array.isArray(dataset.variants) ? dataset.variants : [];
    const other = (dataset.otherVariants && dataset.otherVariants.cases) || 0;
    const known = variants.reduce((n, v) => n + (v.cases || 0), 0);
    const steps = [...ids].map(id => step(dataset, id)).filter(Boolean);
    const stepShares = steps.map(s => (util.isFiniteNumber(s.caseShare) ? s.caseShare : null)).filter(x => x !== null);
    const total = known + other;
    if (!total) {
      if (!ids.size || !stepShares.length) return null;
      if (stepShares.length === 1 && ids.size === 1) return { value: stepShares[0], lower: stepShares[0], upper: stepShares[0], exact: true };
      const lo = Math.max(...stepShares), hi = Math.min(1, stepShares.reduce((a, b) => a + b, 0));
      return { value: lo, lower: lo, upper: hi, exact: lo === hi };
    }
    const touching = variants.filter(v => (v.nodeIds || []).some(id => ids.has(id))).reduce((n, v) => n + (v.cases || 0), 0);
    if (!other) {
      const x = touching / total;
      return { value: x, lower: x, upper: x, exact: true };
    }
    let lower = touching / total;
    let upper = (touching + other) / total;
    if (stepShares.length) {
      lower = Math.max(lower, Math.max(...stepShares));
      upper = Math.min(upper, stepShares.reduce((a, b) => a + b, 0));
      if (upper < lower) upper = lower;
    }
    const rate = known ? touching / known : 0;
    const value = Math.min(upper, Math.max(lower, (touching + other * rate) / total));
    return { value, lower, upper, exact: false };
  }

  /**
   * Which step in toModelId corresponds to each step in fromModelId, through
   * lineage.baselineNodeId in either direction: Map(fromNodeId -> toNodeId).
   * The same model maps each step to itself; unrelated models give an empty map.
   */
  function correspondence(e, fromModelId, toModelId) {
    const models = (e && e.models) || [];
    const from = models.find(m => m.id === fromModelId);
    const to = models.find(m => m.id === toModelId);
    const out = new Map();
    if (!from || !to) return out;
    if (from.id === to.id) {
      from.nodes.forEach(n => out.set(n.id, n.id));
      return out;
    }
    if (to.basedOn && to.basedOn.modelId === from.id) {
      const fromIds = new Set(from.nodes.map(n => n.id));
      to.nodes.forEach(n => {
        const b = n.lineage && n.lineage.baselineNodeId;
        if (b && fromIds.has(b) && !out.has(b)) out.set(b, n.id);
      });
    } else if (from.basedOn && from.basedOn.modelId === to.id) {
      const toIds = new Set(to.nodes.map(n => n.id));
      from.nodes.forEach(n => {
        const b = n.lineage && n.lineage.baselineNodeId;
        if (b && toIds.has(b)) out.set(n.id, b);
      });
    }
    return out;
  }

  /** True when a statistic rests on fewer than min observations (5 by default). */
  function smallSample(stats, min) {
    return !stats || !util.isFiniteNumber(stats.n) || stats.n < (min == null ? 5 : min);
  }

  return { list, get, forModel, basisOf, step, visitsPerCase, annualVolume, caseShareForNodes, correspondence, smallSample };
});
