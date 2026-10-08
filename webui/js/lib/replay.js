/*
 * BPMVIZ replay: shows a scenario's explicit visits and transitions on a model.
 *
 * This is a replay of recorded or supplied timings. It does not execute
 * gateway logic or BPMN semantics.
 *
 *  - A node's state comes from the visit that applies at time t, so a second
 *    (rework) visit shows as active even though an earlier visit completed.
 *  - An edge is traversed only when a transition on that edge exists; it is
 *    never inferred from its destination having been visited.
 *  - Nodes marked "excluded" from the scenario never show as complete, and
 *    "unknown" membership is shown as unconfirmed instead of being animated.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./util.js"), require("./schema.js"), require("./units.js"));
  } else {
    const B = root.BPMVIZ = root.BPMVIZ || {};
    B.replay = factory(B.util, B.schema, B.units);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, schema, units) {
  "use strict";

  const EPS = 1e-6;

  function sortVisits(list) {
    return list.sort((a, b) => a.start - b.start || a.order - b.order);
  }

  /** Prepares lookup tables for one model and one scenario run (run may be null). */
  function buildReplay(model, run, timeBasis) {
    const nodeById = new Map(model.nodes.map(n => [n.id, n]));
    const visitsByNode = new Map();
    const visitsById = new Map();
    let start = Infinity, end = 0;
    ((run && run.visits) || []).forEach((visit, order) => {
      if (!nodeById.has(visit.nodeId)) return;
      const v = { id: visit.id, nodeId: visit.nodeId, start: visit.start, end: visit.end, order };
      visitsById.set(v.id, v);
      if (!visitsByNode.has(v.nodeId)) visitsByNode.set(v.nodeId, []);
      visitsByNode.get(v.nodeId).push(v);
      start = Math.min(start, v.start);
      end = Math.max(end, v.end);
    });
    visitsByNode.forEach(sortVisits);

    const membership = new Map();
    model.nodes.forEach(n => {
      const declared = run && run.membership ? run.membership[n.id] : undefined;
      if (declared === "included" || declared === "excluded" || declared === "unknown") {
        membership.set(n.id, declared);
      } else {
        membership.set(n.id, visitsByNode.has(n.id) ? "included" : "unknown");
      }
    });

    const transitionsByEdge = new Map();
    ((run && run.transitions) || []).forEach(tr => {
      const target = visitsById.get(tr.toVisitId);
      const source = visitsById.get(tr.fromVisitId);
      if (!target) return;
      if (!transitionsByEdge.has(tr.edgeId)) transitionsByEdge.set(tr.edgeId, []);
      transitionsByEdge.get(tr.edgeId).push({ edgeId: tr.edgeId, source, target });
    });

    return {
      model, run: run || null, nodeById, visitsByNode, visitsById, membership,
      transitionsByEdge, timeBasis: timeBasis || null,
      start: Number.isFinite(start) ? start : 0,
      duration: end,
      hasRun: !!run
    };
  }

  function slaMinutes(node, timeBasis) {
    const target = node && node.measures && node.measures.slaTarget;
    if (!target || !util.isFiniteNumber(target.value) || target.value <= 0) return null;
    return units.toMinutes(target.value, target.unit || "minute", timeBasis);
  }

  function slaStatus(elapsed, sla) {
    if (!util.isFiniteNumber(sla) || sla <= 0) return null;
    const pct = elapsed / sla;
    return { pct, target: sla, state: pct > 1 ? "breach" : pct >= 0.9 ? "warn" : "ok" };
  }

  /**
   * State of a node at time t:
   *   pending      scheduled later in this scenario
   *   active       a visit is in progress (visitIndex says which one)
   *   done         at least one visit has finished and none is in progress
   *   excluded     not part of this scenario's route
   *   unknown      route membership not confirmed; not animated
   *   unscheduled  in the scenario but no timing supplied
   */
  function nodeStateAt(replay, nodeId, t) {
    const membership = replay.membership.get(nodeId) || "unknown";
    const node = replay.nodeById.get(nodeId);
    if (membership === "excluded") return { state: "excluded", membership, visitCount: 0 };
    const visits = replay.visitsByNode.get(nodeId) || [];
    if (!visits.length) {
      return { state: membership === "unknown" ? "unknown" : "unscheduled", membership, visitCount: 0 };
    }
    let active = null, activeIndex = -1, last = null, lastIndex = -1, completed = 0;
    visits.forEach((v, i) => {
      if (v.start > t + EPS) return;
      if (v.end > t + EPS) { active = v; activeIndex = i; }
      else { completed++; last = v; lastIndex = i; }
    });
    const base = { membership, visitCount: visits.length, completedVisits: completed, unconfirmed: membership === "unknown" };
    const sla = slaMinutes(node, replay.timeBasis);
    if (active) {
      const elapsed = t - active.start;
      return Object.assign(base, {
        state: "active", visit: active, visitIndex: activeIndex, elapsed,
        sla: slaStatus(elapsed, sla)
      });
    }
    if (last) {
      const duration = last.end - last.start;
      return Object.assign(base, {
        state: "done", visit: last, visitIndex: lastIndex, duration,
        sla: slaStatus(duration, sla)
      });
    }
    return Object.assign(base, { state: "pending", nextVisit: visits[0] });
  }

  /**
   * State of an edge at time t: "active" (feeding an active visit),
   * "traversed", "pending" (traversed later), "idle" (never traversed in this
   * scenario) or "excluded" (an endpoint is outside the scenario).
   */
  function edgeStateAt(replay, edge, t) {
    const from = replay.membership.get(edge.from), to = replay.membership.get(edge.to);
    if (from === "excluded" || to === "excluded") return "excluded";
    const list = replay.transitionsByEdge.get(edge.id) || [];
    if (!list.length) return "idle";
    let traversed = false, active = false;
    list.forEach(item => {
      if (item.target.start <= t + EPS) {
        traversed = true;
        if (item.target.end > t + EPS) active = true;
      }
    });
    return active ? "active" : traversed ? "traversed" : "pending";
  }

  function visitHistory(replay, nodeId) {
    return (replay.visitsByNode.get(nodeId) || []).map((v, i) => ({
      index: i, start: v.start, end: v.end, duration: v.end - v.start
    }));
  }

  function isJoinType(semanticType) {
    return semanticType === "parallelGateway" || semanticType === "inclusiveGateway";
  }

  function isExclusiveType(semanticType) {
    return semanticType === "exclusiveGateway" || semanticType === "gateway" || semanticType === "eventBasedGateway";
  }

  /**
   * Derives transitions from visits and model edges. For each visit, the
   * candidate sources are earlier visits of the edge's source node that ended
   * before the visit starts and have not already fed that edge. Parallel and
   * inclusive joins keep every candidate; other nodes keep the most recent.
   *
   * options.gatewayConsumption: "exclusive" (default) lets one visit of an
   * exclusive gateway feed only one outgoing edge; "per-edge" allows a batch
   * illustration where several outcomes are scheduled together.
   */
  function deriveTransitions(model, visits, options) {
    const opts = options || {};
    const exclusive = opts.gatewayConsumption !== "per-edge";
    const nodeById = new Map(model.nodes.map(n => [n.id, n]));
    const incoming = new Map();
    model.edges.forEach((edge, order) => {
      if (!incoming.has(edge.to)) incoming.set(edge.to, []);
      incoming.get(edge.to).push({ edge, order });
    });
    const byNode = new Map();
    const indexed = visits.map((v, order) => Object.assign({}, v, { order }));
    indexed.forEach(v => {
      if (!byNode.has(v.nodeId)) byNode.set(v.nodeId, []);
      byNode.get(v.nodeId).push(v);
    });
    const used = new Set();
    const transitions = [];
    const sorted = indexed.slice().sort((a, b) => a.start - b.start || a.order - b.order);
    sorted.forEach(target => {
      const candidates = [];
      (incoming.get(target.nodeId) || []).forEach(({ edge, order }) => {
        const sourceNode = nodeById.get(edge.from);
        const consumeKey = s => exclusive && sourceNode && isExclusiveType(sourceNode.semanticType) ?
          "any:" + s.id : edge.id + ":" + s.id;
        const sources = (byNode.get(edge.from) || []).filter(s =>
          s.id !== target.id && s.end <= target.start + EPS && !used.has(consumeKey(s)));
        if (!sources.length) return;
        const best = sources.reduce((a, b) =>
          (b.end > a.end + EPS || (Math.abs(b.end - a.end) <= EPS && b.order > a.order)) ? b : a);
        candidates.push({ edge, order, source: best, key: consumeKey(best) });
      });
      if (!candidates.length) return;
      const node = nodeById.get(target.nodeId);
      let chosen;
      if (node && isJoinType(node.semanticType)) {
        chosen = candidates;
      } else {
        chosen = [candidates.reduce((a, b) =>
          (b.source.end > a.source.end + EPS) ? b : a)];
      }
      chosen.forEach(c => {
        used.add(c.key);
        transitions.push({ edgeId: c.edge.id, fromVisitId: c.source.id, toVisitId: target.id });
      });
    });
    return transitions;
  }

  function runDuration(run) {
    return ((run && run.visits) || []).reduce((max, v) => Math.max(max, v.end), 0);
  }

  /** Copy of a run with every time multiplied by factor. */
  function scaleRun(run, factor) {
    const copy = util.clone(run);
    copy.visits.forEach(v => { v.start *= factor; v.end *= factor; });
    if (copy.milestones) {
      Object.keys(copy.milestones).forEach(k => { copy.milestones[k] *= factor; });
    }
    if (util.isFiniteNumber(copy.pauseAt)) copy.pauseAt *= factor;
    return copy;
  }

  /** Elapsed span of the run (first start to last end), and the sum of visit durations. */
  function spanSummary(replay) {
    let sum = 0;
    replay.visitsByNode.forEach(list => list.forEach(v => { sum += v.end - v.start; }));
    return { span: replay.duration - replay.start, sumOfVisits: sum };
  }

  return {
    buildReplay, nodeStateAt, edgeStateAt, visitHistory, deriveTransitions,
    runDuration, scaleRun, slaMinutes, spanSummary, isJoinType
  };
});
