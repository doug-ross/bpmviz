/*
 * BPMVIZ lenses: diagnostic overlays on the process canvas. Every lens states
 * its unit, the population it describes, and how many activities have data.
 * Missing data is reported as missing, never shown as zero.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./util.js"), require("./schema.js"), require("./units.js"), require("./replay.js"));
  } else {
    const B = root.BPMVIZ = root.BPMVIZ || {};
    B.lenses = factory(B.util, B.schema, B.units, B.replay);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, schema, units, replayLib) {
  "use strict";

  const LENSES = [
    { id: "none", label: "No lens" },
    { id: "time", label: "Elapsed time" },
    { id: "effort", label: "Human effort" },
    { id: "waits", label: "Waits" },
    { id: "handoffs", label: "Handoffs" },
    { id: "sla", label: "SLA status" },
    { id: "bottlenecks", label: "Tagged bottlenecks" },
    { id: "evidence", label: "Evidence coverage" }
  ];

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
      result.description = "Elapsed time spent in each activity, summed over repeat visits.";
      result.unit = units.describeTimeBasis(tb);
      result.population = "One case: " + scenarioName + ".";
      result.coverage = { have, total: inScope.length, text: coverageText(have, inScope.length, "activities in the scenario have timing") };
      result.legend = scaleLegend(units.formatDuration(max, tb));
      if (rp) {
        const span = replayLib.spanSummary(rp);
        if (span.sumOfVisits > span.span + 1e-6) {
          result.notes.push("Cycle span is " + units.formatDuration(span.span, tb) +
            ". Activity durations add up to " + units.formatDuration(span.sumOfVisits, tb) +
            " because parallel work overlaps; the span is the elapsed figure.");
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
      result.description = "Typed human touch effort per case (person time, which can exceed elapsed time).";
      result.unit = "Person hours and minutes.";
      result.population = "Per case, as recorded on each activity.";
      result.coverage = { have: typed.length, total: tasks.length, text: coverageText(typed.length, tasks.length, "activities have a typed effort measure") };
      result.legend = typed.length ? scaleLegend(units.formatDuration(max, null, { precise: true })) : [];
      if (!typed.length) result.notes.push("No typed effort measures yet. Add them in the activity editor.");
      if (freeText) result.notes.push(freeText + " activities have free-text effort notes that are not typed measures.");
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
      result.description = "Activities tagged as waiting: queue, external party, or other delay.";
      result.unit = "Category, with elapsed time in the selected scenario.";
      result.population = "Tags recorded on each activity.";
      result.coverage = { have: declared, total: tasks.length, text: coverageText(declared, tasks.length, "activities have a wait type recorded") };
      result.legend = [
        { category: "queue", label: "Queue wait" }, { category: "external", label: "External party wait" },
        { category: "other", label: "Other delay" }
      ];
      if (!declared) result.notes.push("No wait types recorded yet. Set them in the activity editor.");
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
        result.nodes[e.to] = { category: "handoff", text: "Receives a handoff" };
      });
      result.description = "Connectors that move work to a different swimlane.";
      result.unit = "Count of handoffs.";
      result.population = useRun ? "Traversed in " + scenarioName + "." : "Every connector in the model (no scenario timing).";
      result.coverage = { have: count, total: null, text: count + (useRun ? " handoffs traversed" : " cross-lane connectors") };
      result.legend = [{ category: "handoff", label: "Receives a handoff" }];
      result.notes.push("Boundary: a connector whose source and target are in different swimlanes.");
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
          text: sla ? Math.round(sla.pct * 100) + "% of SLA target" : "SLA target set, not started"
        };
      });
      result.description = "Elapsed time in the current visit against each activity's SLA target.";
      result.unit = "Percent of the SLA target at the playhead.";
      result.population = "One case: " + scenarioName + ", at the current playhead.";
      result.coverage = { have: withSla, total: tasks.length, text: coverageText(withSla, tasks.length, "activities have an SLA target") };
      result.legend = [
        { category: "ok", label: "Under 90% of target" }, { category: "warn", label: "90 to 100% of target" },
        { category: "breach", label: "Over target" }, { category: "none", label: "Not started" }
      ];
      if (!withSla) result.notes.push("No SLA targets recorded. Add them in the activity editor.");
      return result;
    }

    if (id === "bottlenecks") {
      let tagged = 0;
      model.nodes.forEach(n => {
        if (n.tags && n.tags.bottleneck) {
          tagged++;
          result.nodes[n.id] = { category: "tagged", text: "Tagged as a bottleneck" };
        }
      });
      result.description = "Activities tagged as bottlenecks in the source configuration.";
      result.unit = "Tag.";
      result.population = "Configured tags. They mark suspected constraints and are not measured.";
      result.coverage = { have: tagged, total: model.nodes.length, text: tagged + " activities tagged" };
      result.legend = [{ category: "tagged", label: "Tagged bottleneck (not measured)" }];
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
          validated: "Validated", referenced: "Source reference recorded",
          estimated: "Provenance recorded, no source reference", none: "No provenance"
        }[category] };
      });
      result.description = "What each activity is based on.";
      result.unit = "Category.";
      result.population = "Every step in the model.";
      result.coverage = { have: referenced, total: model.nodes.length, text: coverageText(referenced, model.nodes.length, "steps have provenance") };
      result.legend = [
        { category: "validated", label: "Validated" }, { category: "referenced", label: "Source reference" },
        { category: "estimated", label: "Provenance, no reference" }, { category: "none", label: "No provenance" }
      ];
      return result;
    }
    return result;
  }

  return { LENSES, computeLens };
});
