/* Guided routes and scenario authoring. No business rules are executed. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./util.js"), require("./schema.js"), require("./validate.js"), require("./store.js"), require("./economics.js"), require("./units.js"));
  else {
    const B = root.AIxRay = root.AIxRay || {};
    B.walkthrough = factory(B.util, B.schema, B.validate, B.store, B.economics, B.units);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, schema, validate, store, economics, units) {
  "use strict";
  const MAX_VISITS = 100, MAX_REPEATS = 20;
  const EFFORT = "walkthroughEffort-";
  const AUTHOR_NOTE = "Entered in the scenario editor.";
  const PARALLEL_NOTE = "Parallel or inclusive gateway: this is one selected route. Other branches and synchronization need separate review; no business rules or parallel completion are executed.";
  const { StoreError } = store;
  function fail(message) { throw new StoreError("invalid", message); }
  function modelOf(e, id) {
    const m = e.models.find(x => x.id === id);
    if (!m) fail("That process no longer exists.");
    return m;
  }
  function scenarioOf(e, id) {
    const s = e.scenarios.find(x => x.id === id);
    if (!s) fail("That scenario no longer exists.");
    return s;
  }
  function nameOf(name) {
    if (typeof name !== "string" || !name.trim() || name.length > 300) fail("Enter a scenario name of 1 to 300 characters.");
    return name.trim();
  }
  function outgoing(model, nodeId) {
    return model.edges.filter(x => x.from === nodeId && model.nodes.some(n => n.id === x.to && !n.removed));
  }
  function starts(model) {
    const nodes = model.nodes.filter(n => !n.removed);
    const declared = nodes.filter(n => /StartEvent$|^startEvent$/.test(n.semanticType));
    return declared.length ? declared : nodes.filter(n => !model.edges.some(e => e.to === n.id));
  }
  function scope(e, model) {
    return JSON.stringify([e.id, model.id, model.version, model.nodes, model.edges, model.lanes]);
  }
  function begin(e, modelId, nodeId) {
    const model = modelOf(e, modelId);
    if (!model.nodes.some(n => n.id === nodeId && !n.removed)) fail("Choose a step to start.");
    return { scope: scope(e, model), modelId, nodeIds: [nodeId], edgeIds: [], cursor: 0 };
  }
  function validWalk(e, state) {
    if (!state) return false;
    const model = e.models.find(m => m.id === state.modelId);
    return !!model && scope(e, model) === state.scope;
  }
  function next(e, state, edgeId) {
    if (!validWalk(e, state)) fail("The process changed. Start a new walkthrough.");
    const model = modelOf(e, state.modelId);
    const edges = outgoing(model, state.nodeIds[state.cursor]);
    const edge = edgeId ? edges.find(x => x.id === edgeId) : edges.length === 1 ? edges[0] : null;
    if (!edge) fail(edges.length ? "Choose a labeled branch before continuing." : "This step has no outgoing connector.");
    const nodeIds = state.nodeIds.slice(0, state.cursor + 1);
    if (nodeIds.length >= MAX_VISITS || nodeIds.filter(id => id === edge.to).length >= MAX_REPEATS) fail("Visit limit reached. Start again to explore another route.");
    nodeIds.push(edge.to);
    return Object.assign({}, state, { nodeIds, edgeIds: state.edgeIds.slice(0, state.cursor).concat(edge.id), cursor: state.cursor + 1 });
  }
  function previous(state) { return Object.assign({}, state, { cursor: Math.max(0, state.cursor - 1) }); }
  function guidance(model, nodeId) {
    const node = model.nodes.find(n => n.id === nodeId);
    return node && /^(parallel|inclusive)Gateway$/.test(node.semanticType) ? PARALLEL_NOTE : "Choose the route with the business participants. Connector labels describe choices; rules are not evaluated.";
  }
  function number(value, label, optional) {
    if ((value === "" || value === null || value === undefined) && optional) return null;
    if (value === "" || value === null || value === undefined || !["number", "string"].includes(typeof value) || typeof value === "string" && !value.trim()) fail("Enter " + label + " as a nonnegative number.");
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) fail("Enter " + label + " as a nonnegative number.");
    return n;
  }
  /** Ordered, connected visits. Repeats are explicit; unvisited nodes stay unknown. */
  function buildRun(model, rows) {
    if (!Array.isArray(rows) || !rows.length || rows.length > MAX_VISITS) fail("Enter 1 to " + MAX_VISITS + " visits.");
    const visits = [], transitions = [], membership = {}, efforts = [], counts = new Map();
    model.nodes.forEach(n => { membership[n.id] = "unknown"; });
    rows.forEach((row, i) => {
      const node = model.nodes.find(n => n.id === row.nodeId && !n.removed);
      if (!node) fail("Visit " + (i + 1) + " refers to a missing or removed step.");
      counts.set(node.id, (counts.get(node.id) || 0) + 1);
      if (counts.get(node.id) > MAX_REPEATS) fail("A step can be visited at most " + MAX_REPEATS + " times.");
      const wait = number(row.wait, "wait for visit " + (i + 1));
      const duration = number(row.duration, "duration for visit " + (i + 1));
      const effort = number(row.effort, "human effort for visit " + (i + 1), true);
      const earliest = (i ? visits[i - 1].end : 0) + wait;
      const explicit = number(row.start, "start for visit " + (i + 1), true);
      const start = explicit === null ? earliest : explicit;
      if (start < earliest) fail("Visit " + (i + 1) + " starts before the previous visit and entered wait finish. This editor authors one sequential route.");
      if (!Number.isFinite(start + duration)) fail("Visit timing is too large.");
      const visit = { id: "v" + (i + 1), nodeId: node.id, start, end: start + duration };
      if (i) {
        const candidates = model.edges.filter(e => e.from === visits[i - 1].nodeId && e.to === node.id);
        const edge = row.edgeId ? candidates.find(e => e.id === row.edgeId) : candidates.length === 1 ? candidates[0] : null;
        if (!edge) fail("Visit " + (i + 1) + " must follow a selected connector from the previous visit.");
        transitions.push({ edgeId: edge.id, fromVisitId: visits[i - 1].id, toVisitId: visit.id });
      }
      visits.push(visit); efforts.push(effort); membership[node.id] = "included";
    });
    return { run: { visits, transitions, membership, pauseAt: null, milestones: {} }, efforts,
      humanTouch: efforts.every(x => x !== null) ? efforts.reduce((a, b) => a + b, 0) : null,
      cycleTime: visits[visits.length - 1].end - visits[0].start };
  }
  function rowsFor(scenario, modelId) {
    const run = scenario.runs[modelId];
    if (!run) return [];
    return run.visits.map((v, i) => {
      const measure = scenario.measures.find(m => m.key === EFFORT + v.id);
      const tr = run.transitions.find(t => t.toVisitId === v.id && i && t.fromVisitId === run.visits[i - 1].id);
      return { nodeId: v.nodeId, edgeId: tr ? tr.edgeId : "", start: v.start, duration: v.end - v.start,
        wait: Math.max(0, v.start - (i ? run.visits[i - 1].end : 0)),
        effort: measure && measure.values[modelId] != null ? measure.values[modelId] : "" };
    });
  }
  function checked(e, raw) {
    const context = Object.assign({}, e, { scenarios: e.scenarios.filter(s => s.id !== raw.id) });
    const result = validate.sanitizeScenarioFor(raw, context);
    if (result.errors.length) fail(result.errors.map(x => x.message).join(" "));
    if (result.value.measures.length > 200) fail("This scenario has too many measures. Use a separate scenario for this route.");
    return result.value;
  }
  function empty(e, name) {
    return { id: util.uid("scn"), name: nameOf(name), provenance: "supplied", statusLabel: "Provided", statusTone: "",
      summary: "", attributes: [], timing: { method: "explicit-visits", note: "Authored route. Timings and effort are supplied assumptions; gateway rules are not executed." },
      runs: {}, measures: [], economics: { beforeModelId: (e.models.find(m => m.role === "current") || {}).id || null,
        afterModelId: (e.models.find(m => m.role === "future") || {}).id || null, supplied: {}, overrides: {} } };
  }
  function putMeasure(s, key, label, modelId, value, timeBasis) {
    let m = s.measures.find(x => x.key === key);
    if (!m && value !== null) { m = { key, label, unit: "minute", values: {}, suppliedText: {}, status: "supplied", note: AUTHOR_NOTE }; s.measures.push(m); }
    if (m && m.unit !== "minute") {
      Object.keys(m.values).forEach(id => {
        if (m.values[id] === null) return;
        const converted = units.toMinutes(m.values[id], m.unit, timeBasis);
        if (converted === null) fail("The existing " + label + " measure has a unit that cannot be converted to minutes.");
        m.values[id] = converted;
      });
      m.unit = "minute";
    }
    if (m) {
      if (value === null) delete m.values[modelId];
      else m.values[modelId] = value;
      m.status = "supplied";
      m.note = AUTHOR_NOTE;
      if (m.suppliedText) delete m.suppliedText[modelId];
    }
  }
  function assumptions(e, s, p) {
    const before = p.beforeModelId === undefined ? s.economics && s.economics.beforeModelId : p.beforeModelId;
    const after = p.afterModelId === undefined ? s.economics && s.economics.afterModelId : p.afterModelId;
    if (before) modelOf(e, before);
    if (after) modelOf(e, after);
    if (before && after && before === after) fail("Choose different before and future processes.");
    const overrides = {};
    Object.entries(p.overrides || {}).forEach(([key, raw]) => {
      if (!schema.DRIVERS.some(d => d.key === key)) fail("Unknown economics assumption: " + key);
      const value = number(raw.value, key, true);
      if (value !== null) {
        if (key === "productiveHoursPerFte" && !value) fail("Productive hours must be greater than zero.");
        const status = raw.status || "supplied";
        if (!schema.ENUMS.assumptionStatus.includes(status)) fail("Choose an assumption status.");
        overrides[key] = { value, status, note: store.helpers.cleanText(raw.note, 1000) };
      }
    });
    s.economics = Object.assign({ supplied: {} }, s.economics || {}, { beforeModelId: before || null, afterModelId: after || null, overrides });
  }
  const commands = {
    "walkthrough/create"(e, p) {
      if (e.scenarios.length >= schema.LIMITS.scenarios) fail("The scenario limit has been reached.");
      const s = checked(e, empty(e, p.name)); e.scenarios.push(s); return { scenarioId: s.id };
    },
    "walkthrough/rename"(e, p) { const s = scenarioOf(e, p.scenarioId); s.name = nameOf(p.name); return { scenarioId: s.id }; },
    "walkthrough/delete"(e, p) {
      scenarioOf(e, p.scenarioId);
      e.scenarios = e.scenarios.filter(s => s.id !== p.scenarioId);
      (e.datasets || []).forEach(d => { d.scenarioIds = (d.scenarioIds || []).filter(id => id !== p.scenarioId); });
      return { scenarioId: p.scenarioId };
    },
    "walkthrough/saveRun"(e, p) {
      const s = util.clone(scenarioOf(e, p.scenarioId)), model = modelOf(e, p.modelId);
      const built = buildRun(model, p.rows);
      if (p.provenance && !["supplied", "illustrative"].includes(p.provenance)) fail("Choose supplied or illustrative provenance.");
      s.provenance = p.provenance || "supplied";
      s.timing = { method: "explicit-visits", note: "Authored sequential route; waits, durations and human effort are entered explicitly. Parallel branches require separate review." };
      delete s.observedFrom;
      s.runs[model.id] = built.run;
      s.measures.filter(m => m.key.startsWith(EFFORT)).forEach(m => { delete m.values[model.id]; });
      built.efforts.forEach((value, i) => putMeasure(s, EFFORT + "v" + (i + 1), "Human effort, visit " + (i + 1), model.id, value, e.meta.timeBasis));
      putMeasure(s, "humanTouch", "Human effort per case", model.id, built.humanTouch, e.meta.timeBasis);
      putMeasure(s, "cycleTime", "Elapsed route time", model.id, built.cycleTime, e.meta.timeBasis);
      s.measures = s.measures.filter(m => Object.keys(m.values).length);
      if (s.measures.length > 200) fail("This scenario has too many measures. Use a separate scenario for this route.");
      e.scenarios[e.scenarios.findIndex(x => x.id === s.id)] = checked(e, s);
      return { scenarioId: s.id, modelId: model.id };
    },
    "walkthrough/setAssumptions"(e, p) {
      const s = util.clone(scenarioOf(e, p.scenarioId)); assumptions(e, s, p);
      e.scenarios[e.scenarios.findIndex(x => x.id === s.id)] = checked(e, s); return { scenarioId: s.id };
    },
    "walkthrough/variants"(e, p) {
      const base = scenarioOf(e, p.scenarioId);
      if (e.scenarios.length + 3 > schema.LIMITS.scenarios) fail("There is no room for three more scenarios.");
      const made = ["Conservative", "Expected", "Optimistic"].map(label => {
        const entered = (p.variants || {})[label.toLowerCase()];
        if (!entered || !Object.keys(entered.overrides || {}).some(k => entered.overrides[k].value !== "" && entered.overrides[k].value != null)) fail("Enter explicit assumptions for " + label + ".");
        const s = util.clone(base); s.id = util.uid("scn"); s.name = nameOf(base.name + " - " + label);
        s.provenance = "illustrative"; s.statusLabel = label; delete s.observedFrom;
        assumptions(e, s, entered);
        s.summary = "Alternative using explicitly entered " + label.toLowerCase() + " assumptions. Annual results are alternatives and must not be added.";
        return checked(e, s);
      });
      e.scenarios.push(...made); return { scenarioIds: made.map(s => s.id) };
    }
  };
  store.registerCommands(commands);
  function compare(e, ids) {
    return ids.map(id => { const s = scenarioOf(e, id); return { id, name: s.name, outputs: economics.computeValue(e, s).outputs }; });
  }
  /** Integration helper: remove derived values for a changed graph, preserving other models. */
  function invalidateModelMeasures(scenario, modelId) {
    let removed = 0;
    (scenario.measures || []).forEach(m => {
      if (!m.key.startsWith(EFFORT) && !(["humanTouch", "cycleTime"].includes(m.key) && m.note === AUTHOR_NOTE)) return;
      if (Object.prototype.hasOwnProperty.call(m.values || {}, modelId)) { delete m.values[modelId]; removed++; }
      if (m.suppliedText) delete m.suppliedText[modelId];
    });
    scenario.measures = (scenario.measures || []).filter(m => !m.key.startsWith(EFFORT) && !(["humanTouch", "cycleTime"].includes(m.key) && m.note === AUTHOR_NOTE) || Object.keys(m.values || {}).length);
    return removed;
  }
  return { MAX_VISITS, MAX_REPEATS, PARALLEL_NOTE, AUTHOR_NOTE, starts, outgoing, scope, begin, validWalk, next, previous, guidance, buildRun, rowsFor, compare, invalidateModelMeasures };
});
