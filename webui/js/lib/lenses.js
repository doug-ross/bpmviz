/*
 * AIxRay lenses: diagnostic overlays on the process canvas. Every lens states
 * its unit, the population it describes, and how many activities have data.
 * Missing data is reported as missing, never shown as zero.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./util.js"), require("./schema.js"), require("./units.js"), require("./replay.js"));
  } else {
    const B = root.AIxRay = root.AIxRay || {};
    B.lenses = factory(B.util, B.schema, B.units, B.replay);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, schema, units, replayLib) {
  "use strict";

  const LENSES = [
    { id: "none", label: "No lens" },
    { id: "time", label: "Elapsed time" },
    { id: "effort", label: "Human effort" },
    { id: "waits", label: "Waits" },
    { id: "handoffs", label: "Handovers between lanes" },
    { id: "sla", label: "SLA status" },
    { id: "bottlenecks", label: "Suspected bottlenecks" },
    { id: "evidence", label: "Sources" }
  ];

  const REGISTERED = new Map();

  /**
   * Adds a lens from a feature module: { id, label, compute(ctx) }. compute
   * returns the same shape as computeLens (title, description, unit,
   * population, coverage, nodes, edges, legend, notes); missing keys get the
   * empty defaults. A duplicate id throws.
   */
  function registerLens(def) {
    if (!def || typeof def.id !== "string" || !/^[a-z][a-z0-9-]{0,40}$/.test(def.id)) throw new TypeError("A lens needs an id of lowercase letters, digits and hyphens.");
    if (typeof def.compute !== "function") throw new TypeError("Lens " + def.id + " needs a compute function.");
    if (LENSES.some(l => l.id === def.id)) throw new Error("Lens " + def.id + " is already registered.");
    LENSES.push({ id: def.id, label: String(def.label || def.id) });
    REGISTERED.set(def.id, def);
    return def;
  }

  function isTask(node) {
    return schema.typeInfo(node.semanticType).shape === "task";
  }

  function levelFor(value, max) {
    if (!util.isFiniteNumber(value) || value <= 0 || !(max > 0)) return 0;
    return Math.max(1, Math.min(4, Math.ceil(value / max * 4)));
  }

  function coverageText(have, total, what) {
    return have + " of " + total + " " + what;
  }

  function scaleLegend(maxText) {
    return [
      { level: 1, label: "Lowest quarter" }, { level: 2, label: "" },
      { level: 3, label: "" }, { level: 4, label: "Highest quarter (max " + maxText + ")" }
    ];
  }

  function effortMinutes(node) {
    const e = node.measures && node.measures.touchEffort;
    if (!e || !util.isFiniteNumber(e.value)) return null;
    if (e.unit === "hour") return e.value * 60;
    if (e.unit === "minute") return e.value;
    return null;
  }

  /**
   * ctx = { model, replay, t, engagement }. Returns
   * { id, title, description, unit, population, coverage, nodes, edges, legend, notes }.
   */
  function computeLens(id, ctx) {
    const model = ctx.model;
    const rp = ctx.replay;
    const tb = ctx.engagement && ctx.engagement.meta ? ctx.engagement.meta.timeBasis : null;
    const tasks = model.nodes.filter(isTask);
    const result = {
      id, title: (LENSES.find(l => l.id === id) || LENSES[0]).label, description: "", unit: "",
      population: "", coverage: null, nodes: {}, edges: {}, legend: [], notes: []
    };
    const scenarioName = ctx.scenarioName || "the selected scenario";
    if (id === "none") return result;
    if (REGISTERED.has(id)) {
      const extra = REGISTERED.get(id).compute(ctx) || {};
      return Object.assign(result, extra, { id });
    }

    if (id === "time") {
      const inScope = tasks.filter(n => rp && rp.membership.get(n.id) !== "excluded");
      const values = inScope.map(n => {
        const total = (rp.visitsByNode.get(n.id) || []).reduce((s, v) => s + (v.end - v.start), 0);
        return { n, total, has: rp.visitsByNode.has(n.id) };
      });
      const max = Math.max(0, ...values.map(v => v.total));
      values.forEach(v => {
        if (!v.has) return;
        result.nodes[v.n.id] = { level: levelFor(v.total, max), text: units.formatDuration(v.total, tb) };
      });
      const have = values.filter(v => v.has).length;
      result.description = "How long the case spends in each step, with repeat visits added together.";
      result.unit = units.describeTimeBasis(tb);
      result.population = "One case: " + scenarioName + ".";
      result.coverage = { have, total: inScope.length, text: coverageText(have, inScope.length, "steps in the scenario have timings") };
      result.legend = scaleLegend(units.formatDuration(max, tb));
      if (rp) {
        const span = replayLib.spanSummary(rp);
        if (span.sumOfVisits > span.span + 1e-6) {
          result.notes.push("The case takes " + units.formatDuration(span.span, tb) +
            " from start to finish. The step times add up to " + units.formatDuration(span.sumOfVisits, tb) +
            " because parallel work overlaps, so " + units.formatDuration(span.span, tb) + " is the elapsed time.");
        }
      }
      return result;
    }

    if (id === "effort") {
      const values = tasks.map(n => ({ n, minutes: effortMinutes(n) }));
      const typed = values.filter(v => v.minutes !== null);
      const max = Math.max(0, ...typed.map(v => v.minutes));
      typed.forEach(v => {
        result.nodes[v.n.id] = { level: levelFor(v.minutes, max), text: units.formatDuration(v.minutes, null, { precise: true }) };
      });
      const freeText = tasks.filter(n => effortMinutes(n) === null && n.details && n.details.effort).length;
      result.description = "Hands-on time people spend on each step per case. It can be more than the elapsed time.";
      result.unit = "Person hours and minutes.";
      result.population = "Per case, as entered on each step.";
      result.coverage = { have: typed.length, total: tasks.length, text: coverageText(typed.length, tasks.length, "steps have an effort figure") };
      result.legend = typed.length ? scaleLegend(units.formatDuration(max, null, { precise: true })) : [];
      if (!typed.length) result.notes.push("No effort figures yet. Select a step and add one on its Edit step tab.");
      if (freeText) result.notes.push(freeText + (freeText === 1 ? " step has" : " steps have") + " free-text effort notes, which the lens cannot use as figures.");
      return result;
    }

    if (id === "waits") {
      let declared = 0;
      tasks.forEach(n => {
        const w = n.measures && n.measures.waitType;
        if (w) declared++;
        if (w === "queue" || w === "external" || w === "other") {
          const total = rp ? (rp.visitsByNode.get(n.id) || []).reduce((s, v) => s + (v.end - v.start), 0) : null;
          result.nodes[n.id] = { category: w, text: schema.label("waitType", w) + (total ? ", " + units.formatDuration(total, tb) : "") };
        }
      });
      result.description = "Steps marked as waiting: in a queue, on an external party, or for another reason.";
      result.unit = "Type of wait, with the elapsed time in the selected scenario.";
      result.population = "Wait types entered on each step.";
      result.coverage = { have: declared, total: tasks.length, text: coverageText(declared, tasks.length, "steps have a wait type") };
      result.legend = [
        { category: "queue", label: "Waiting in a queue" }, { category: "external", label: "Waiting on an external party" },
        { category: "other", label: "Other delay" }
      ];
      if (!declared) result.notes.push("No wait types yet. Select a step and set one on its Edit step tab.");
      return result;
    }

    if (id === "handoffs") {
      const laneOf = new Map(model.nodes.map(n => [n.id, n.laneId]));
      const crossing = model.edges.filter(e => laneOf.get(e.from) !== laneOf.get(e.to));
      const useRun = rp && rp.hasRun;
      let count = 0;
      crossing.forEach(e => {
        const traversed = useRun ? (rp.transitionsByEdge.get(e.id) || []).length : 1;
        if (!traversed) return;
        count += traversed;
        result.edges[e.id] = { level: 4 };
        result.nodes[e.to] = { category: "handoff", text: "Receives work from another lane" };
      });
      result.description = "Connectors where work passes to a different lane.";
      result.unit = "Number of handovers.";
      result.population = useRun ? "Handovers the case makes in " + scenarioName + "." : "Every connector in the process (no timing recorded).";
      result.coverage = { have: count, total: null, text: count + (useRun ? (count === 1 ? " handover in the scenario" : " handovers in the scenario") : (count === 1 ? " connector crosses lanes" : " connectors cross lanes")) };
      result.legend = [{ category: "handoff", label: "Receives work from another lane" }];
      result.notes.push("A handover is any connector between steps in different lanes.");
      return result;
    }

    if (id === "sla") {
      let withSla = 0;
      tasks.forEach(n => {
        if (replayLib.slaMinutes(n, tb) === null) return;
        withSla++;
        const st = rp ? replayLib.nodeStateAt(rp, n.id, ctx.t || 0) : null;
        const sla = st && st.sla;
        const category = sla ? sla.state : "none";
        result.nodes[n.id] = {
          category,
          text: sla ? Math.round(sla.pct * 100) + "% of SLA target" : "Has an SLA target, not started"
        };
      });
      result.description = "Time spent so far in each step, against its SLA target.";
      result.unit = "Percent of the SLA target at the current playback position.";
      result.population = "One case: " + scenarioName + ", at the current playback position.";
      result.coverage = { have: withSla, total: tasks.length, text: coverageText(withSla, tasks.length, "steps have an SLA target") };
      result.legend = [
        { category: "ok", label: "Under 90% of target" }, { category: "warn", label: "90 to 100% of target" },
        { category: "breach", label: "Over target" }, { category: "none", label: "Not started" }
      ];
      if (!withSla) result.notes.push("No SLA targets yet. Select a step and add one on its Edit step tab.");
      return result;
    }

    if (id === "bottlenecks") {
      let tagged = 0;
      model.nodes.forEach(n => {
        if (n.tags && n.tags.bottleneck) {
          tagged++;
          result.nodes[n.id] = { category: "tagged", text: "Suspected bottleneck" };
        }
      });
      result.description = "Steps marked as a suspected bottleneck.";
      result.unit = "Marked or not.";
      result.population = "Marks entered by hand. They are not measured.";
      result.coverage = { have: tagged, total: model.nodes.length, text: tagged + (tagged === 1 ? " step marked" : " steps marked") };
      result.legend = [{ category: "tagged", label: "Suspected bottleneck" }];
      return result;
    }

    if (id === "evidence") {
      let referenced = 0;
      model.nodes.forEach(n => {
        const p = n.provenance || {};
        const refs = (p.evidenceRefs || []).length + (n.sourceIds || []).length;
        let category = "none";
        if (p.validation === "validated") category = "validated";
        else if (refs) category = "referenced";
        else if (p.source && p.source !== "unknown") category = "estimated";
        if (category !== "none") referenced++;
        result.nodes[n.id] = { category, text: {
          validated: "Confirmed", referenced: "Linked to a source",
          estimated: "Basis noted, no source linked", none: "Nothing recorded"
        }[category] };
      });
      result.description = "What each step is based on.";
      result.unit = "Category.";
      result.population = "Every step in the process.";
      result.coverage = { have: referenced, total: model.nodes.length, text: coverageText(referenced, model.nodes.length, "steps have a recorded basis") };
      result.legend = [
        { category: "validated", label: "Confirmed" }, { category: "referenced", label: "Linked to a source" },
        { category: "estimated", label: "Basis noted, no source" }, { category: "none", label: "Nothing recorded" }
      ];
      return result;
    }
    return result;
  }

  return { LENSES, computeLens, registerLens };
});
