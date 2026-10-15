/* Process authoring commands. Pure data operations, shared by Node and browser. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./util.js"), require("./schema.js"), require("./validate.js"), require("./store.js"));
  else { const B = root.AIxRay = root.AIxRay || {}; B.processBuilder = factory(B.util, B.schema, B.validate, B.store); }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, schema, validate, store) {
  "use strict";
  const { editableModel, findModel, findNode, cleanText, StoreError } = store.helpers;
  const fail = message => { throw new StoreError("invalid", message); };
  const active = item => !item.removed;
  function name(value, what, max) {
    const text = cleanText(value, max || 200).trim();
    if (!text) fail("Give the " + what + " a name.");
    return text;
  }
  function choice(value, values, what) {
    if (!values.includes(value)) fail("Choose a valid " + what + ".");
    return value;
  }
  function id(prefix, items) {
    return util.uniqueId(util.uid(prefix), new Set(items.map(x => x.id)));
  }
  function lane(model, laneId) {
    const found = model.lanes.find(l => l.id === laneId);
    if (!found) fail("Choose an existing lane.");
    return found;
  }
  function node(model, nodeId) {
    const found = findNode(model, nodeId);
    if (found.removed) fail("That step has been removed.");
    return found;
  }
  function edge(model, edgeId) {
    const found = model.edges.find(e => e.id === edgeId && active(e));
    if (!found) fail("Choose an existing flow.");
    return found;
  }
  function mark(model, item) {
    if (model.role !== "future") return;
    item.lineage = item.lineage || { change: "modified", rationale: "" };
    if (item.lineage.change === "unchanged") item.lineage.change = "modified";
  }
  function added(model, isNode) {
    return model.role !== "future" ? null : Object.assign({ change: "added", rationale: "" }, isNode ? { baselineNodeId: null } : {});
  }
  function makeNode(model, label, semanticType, laneId) {
    return { id: id("step", model.nodes), label, semanticType, laneId, sub: "", sourceIds: [], details: {},
      tags: { bottleneck: false, agent: false, humanReview: false, optional: false, sampled: false },
      measures: { typicalDuration: null, slaTarget: null, touchEffort: null, waitType: "" },
      provenance: { source: "workshop", validation: "unvalidated", evidenceRefs: [], note: "" }, lineage: added(model, true), removed: false };
  }
  function makeEdge(model, from, to, label, semanticType) {
    return { id: id("flow", model.edges), from, to, label, semanticType, dashed: false, emphasis: "", removed: false, lineage: added(model, false) };
  }
  function blank(meta) {
    const e = schema.blankEngagement(meta);
    const m = { id: "m-current", role: "current", name: "Current state", version: 1, status: "baseline", locked: false,
      basedOn: null, sourceRefs: [], notes: "", lanes: [{ id: "team", name: "Team", role: "", type: "human" }],
      nodes: [], edges: [], presentation: { nodes: {} } };
    m.nodes.push(makeNode(m, "Start", "startEvent", "team"));
    m.nodes.push(makeNode(m, "End", "endEvent", "team"));
    m.nodes.forEach((n, i) => { m.presentation.nodes[n.id] = { x: i * 2 }; });
    m.edges.push(makeEdge(m, m.nodes[0].id, m.nodes[1].id, "", "sequence"));
    e.models.push(m);
    const checked = validate.validateEngagement(e);
    if (!checked.ok) fail(checked.errors[0].message);
    return checked.engagement;
  }
  /* Shared cleanup also drops figures derived from the invalidated route.
   * Independently supplied measures and event-log aggregates remain evidence.
   * Undo restores the route and its figures with the graph. */
  function invalidateRuns(e, modelId) {
    return store.helpers.invalidateModelRuns(e, modelId);
  }
  function references(e, m, nodeIds, edgeIds) {
    const ns = new Set(nodeIds), es = new Set(edgeIds), refs = [];
    (e.records || []).forEach(r => {
      if ((!r.linkedModelId || r.linkedModelId === m.id) && (r.linkedNodeIds || []).some(n => ns.has(n))) refs.push("finding " + r.title);
      const v = r.opportunity && r.opportunity.valueCase;
      if (v && (!(v.modelId || r.linkedModelId) || (v.modelId || r.linkedModelId) === m.id) && (v.nodeIds || []).some(n => ns.has(n))) refs.push("business case " + r.title);
    });
    (e.datasets || []).filter(d => d.modelId === m.id).forEach(d => {
      if ((d.mapping || []).some(x => ns.has(x.nodeId)) || (d.steps || []).some(x => ns.has(x.nodeId)) ||
          (d.variants || []).some(x => (x.nodeIds || []).some(n => ns.has(n))) ||
          (d.transitions || []).some(x => ns.has(x.fromNodeId) || ns.has(x.toNodeId) || (x.edgeIds || []).some(n => es.has(n)))) refs.push("event log " + d.name);
    });
    const itemRefs = new Set(nodeIds.map(n => "step/" + m.id + "/" + n));
    (e.reviewPacks || []).forEach(p => { if ((p.items || []).some(x => itemRefs.has(x.itemRef))) refs.push("client review pack " + p.name); });
    (e.reviews || []).forEach(r => { if ((r.entries || []).some(x => itemRefs.has(x.itemRef))) refs.push("client review " + r.id); });
    e.models.filter(x => x.basedOn && x.basedOn.modelId === m.id).forEach(x => {
      if (x.nodes.some(n => n.lineage && ns.has(n.lineage.baselineNodeId))) refs.push("future state " + x.name);
    });
    return [...new Set(refs)];
  }
  function guardRefs(e, m, nodes, edges) {
    const refs = references(e, m, nodes, edges);
    if (refs.length) fail("This item is used by " + refs.join(", ") + ". Remove those links before deleting it.");
  }
  function removeEdge(m, ed) {
    if (m.role === "future" && ed.lineage && ed.lineage.change !== "added") {
      ed.removed = true; ed.lineage.change = "removed";
    } else m.edges = m.edges.filter(x => x.id !== ed.id);
  }
  function checkFlow(m, ed) {
    const from = node(m, ed.from), to = node(m, ed.to);
    if (schema.typeInfo(from.semanticType).shape === "end") fail("An end event cannot have an outgoing flow.");
    if (schema.typeInfo(to.semanticType).shape === "start") fail("A start event cannot have an incoming flow.");
    if (from.id === to.id) fail("A loop must return to another step.");
    choice(ed.semanticType, ["sequence", "conditional", "default", "loop"], "flow type");
    if (["conditional", "default"].includes(ed.semanticType) && from.semanticType !== "exclusiveGateway") fail("Conditional and default flows must leave an exclusive gateway.");
    if (ed.semanticType === "conditional" && !ed.label.trim()) fail("Describe the condition on this flow.");
    if (ed.semanticType === "default" && m.edges.some(x => active(x) && x.id !== ed.id && x.from === ed.from && x.semanticType === "default")) fail("A gateway can have only one default flow.");
    if (m.edges.some(x => active(x) && x.id !== ed.id && x.from === ed.from && x.to === ed.to && x.semanticType === ed.semanticType && x.label === ed.label)) fail("That flow already exists.");
  }
  function integrity(model) {
    const issues = [], nodes = model.nodes.filter(active), edges = model.edges.filter(active), ids = new Set(nodes.map(n => n.id));
    const add = (code, message, nodeId) => issues.push({ code, message, nodeId: nodeId || null });
    const starts = nodes.filter(n => schema.typeInfo(n.semanticType).shape === "start");
    const ends = nodes.filter(n => schema.typeInfo(n.semanticType).shape === "end");
    if (!starts.length) add("start.missing", "Add a start event.");
    if (!ends.length) add("end.missing", "Add an end event.");
    edges.forEach(ed => { if (!ids.has(ed.from) || !ids.has(ed.to)) add("flow.dangling", "A flow points to a missing or removed step."); });
    const forward = new Map(nodes.map(n => [n.id, []])), backward = new Map(nodes.map(n => [n.id, []]));
    edges.forEach(ed => { if (ids.has(ed.from) && ids.has(ed.to)) { forward.get(ed.from).push(ed.to); backward.get(ed.to).push(ed.from); } });
    const walk = (seeds, links) => {
      const seen = new Set(), todo = seeds.map(n => n.id);
      while (todo.length) { const next = todo.pop(); if (seen.has(next)) continue; seen.add(next); todo.push(...(links.get(next) || [])); }
      return seen;
    };
    const reachable = walk(starts, forward), ending = walk(ends, backward);
    nodes.forEach(n => {
      if (!model.lanes.some(l => l.id === n.laneId)) add("lane.missing", n.label + " needs an existing lane.", n.id);
      if (!reachable.has(n.id)) add("node.unreachable", n.label + " cannot be reached from a start.", n.id);
      if (!ending.has(n.id)) add("node.noEnd", n.label + " has no path to an end.", n.id);
      const outgoing = edges.filter(ed => ed.from === n.id), incoming = edges.filter(ed => ed.to === n.id);
      const shape = schema.typeInfo(n.semanticType).shape;
      if (shape === "start" && incoming.length) add("start.incoming", n.label + " has an incoming flow.", n.id);
      if (shape === "end" && outgoing.length) add("end.outgoing", n.label + " has an outgoing flow.", n.id);
      if (shape === "gateway" && (outgoing.length < 2 && incoming.length < 2)) add("gateway.branches", n.label + " needs at least two incoming or outgoing branches.", n.id);
      if (n.semanticType === "exclusiveGateway" && outgoing.length > 1) {
        if (!outgoing.some(ed => ed.semanticType === "default")) add("gateway.default", n.label + " needs a default branch.", n.id);
        if (outgoing.some(ed => ed.semanticType !== "default" && !ed.label.trim())) add("gateway.condition", "Label each condition leaving " + n.label + ".", n.id);
      }
      if (n.semanticType === "parallelGateway" && outgoing.some(ed => ["conditional", "default"].includes(ed.semanticType))) add("gateway.parallel", n.label + " must use unconditional branches.", n.id);
    });
    return issues;
  }
  const operations = {
    addLane(e, m, p) {
      if (m.lanes.length >= schema.LIMITS.lanesPerModel) fail("This process has reached the lane limit.");
      const l = { id: id("lane", m.lanes), name: name(p.name, "lane"), role: "", type: choice(p.type || "human", schema.ENUMS.laneType, "lane type") };
      m.lanes.push(l); return { laneId: l.id };
    },
    updateLane(e, m, p) {
      const l = lane(m, p.laneId), patch = p.patch || {};
      if (patch.name !== undefined) l.name = name(patch.name, "lane");
      if (patch.type !== undefined) l.type = choice(patch.type, schema.ENUMS.laneType, "lane type");
      if (patch.role !== undefined) l.role = cleanText(patch.role, 300);
      return { laneId: l.id };
    },
    reorderLane(e, m, p) {
      const l = lane(m, p.laneId);
      if (!Number.isInteger(p.index) || p.index < 0 || p.index >= m.lanes.length) fail("Choose a lane position in the list.");
      m.lanes.splice(m.lanes.indexOf(l), 1); m.lanes.splice(p.index, 0, l);
      return { laneId: l.id };
    },
    deleteLane(e, m, p) {
      const l = lane(m, p.laneId);
      if (m.lanes.length === 1) fail("Keep at least one lane.");
      const occupants = m.nodes.filter(n => n.laneId === l.id);
      if (occupants.length) {
        if (p.moveToLaneId === l.id) fail("Move the steps to another lane.");
        lane(m, p.moveToLaneId);
        occupants.forEach(n => { n.laneId = p.moveToLaneId; mark(m, n); });
      }
      m.lanes = m.lanes.filter(x => x.id !== l.id); return { laneId: l.id };
    },
    addNode(e, m, p) {
      if (m.nodes.length >= schema.LIMITS.nodesPerModel) fail("This process has reached the step limit.");
      lane(m, p.laneId);
      const type = choice(p.semanticType || "userTask", Object.keys(schema.SEMANTIC_TYPES).filter(k => k !== "unsupported"), "step type");
      const n = makeNode(m, name(p.label, "step", 300), type, p.laneId);
      const insertion = p.edgeId ? edge(m, p.edgeId) : null;
      if (insertion && ["start", "end"].includes(schema.typeInfo(type).shape)) fail("Add an event separately, then connect it.");
      if (insertion) guardRefs(e, m, [], [insertion.id]);
      m.nodes.push(n);
      m.presentation = m.presentation || { nodes: {} }; m.presentation.nodes = m.presentation.nodes || {};
      let x = Math.max(0, ...Object.values(m.presentation.nodes).map(pos => pos.x || 0)) + 1;
      if (insertion) {
        if (m.edges.length >= schema.LIMITS.edgesPerModel) fail("This process has reached the flow limit.");
        const fromX = (m.presentation.nodes[insertion.from] || {}).x || 0;
        const toX = (m.presentation.nodes[insertion.to] || {}).x;
        x = Number.isFinite(toX) && toX > fromX ? (fromX + toX) / 2 : fromX + 1;
        const target = insertion.to; insertion.to = n.id; mark(m, insertion);
        m.edges.push(makeEdge(m, n.id, target, "", "sequence"));
      }
      m.presentation.nodes[n.id] = { x };
      return { nodeId: n.id };
    },
    updateNode(e, m, p) {
      const n = node(m, p.nodeId), patch = p.patch || {};
      if (patch.label !== undefined) n.label = name(patch.label, "step", 300);
      if (patch.laneId !== undefined) { lane(m, patch.laneId); n.laneId = patch.laneId; }
      if (patch.semanticType !== undefined && patch.semanticType !== n.semanticType) {
        choice(patch.semanticType, Object.keys(schema.SEMANTIC_TYPES), "step type");
        const before = schema.typeInfo(n.semanticType).shape, after = schema.typeInfo(patch.semanticType).shape;
        if (["start", "end"].includes(before) && before !== after && m.nodes.filter(x => active(x) && schema.typeInfo(x.semanticType).shape === before).length === 1) fail("Keep at least one " + before + " event.");
        n.semanticType = patch.semanticType;
        m.edges.filter(ed => active(ed) && (ed.from === n.id || ed.to === n.id)).forEach(ed => checkFlow(m, ed));
      }
      if (patch.x !== undefined) {
        if (!Number.isFinite(patch.x) || patch.x < 0 || patch.x > 10000) fail("Column must be a number between 0 and 10,000.");
        m.presentation = m.presentation || { nodes: {} }; m.presentation.nodes = m.presentation.nodes || {};
        m.presentation.nodes[n.id] = { x: patch.x };
      }
      if (patch.description !== undefined) { n.details = n.details || {}; n.details.desc = cleanText(patch.description, 4000); }
      mark(m, n); return { nodeId: n.id };
    },
    deleteNode(e, m, p) {
      const n = node(m, p.nodeId), shape = schema.typeInfo(n.semanticType).shape;
      if (["start", "end"].includes(shape) && m.nodes.filter(x => active(x) && schema.typeInfo(x.semanticType).shape === shape).length === 1) fail("Keep at least one " + shape + " event.");
      const connected = m.edges.filter(ed => ed.from === n.id || ed.to === n.id);
      guardRefs(e, m, [n.id], connected.map(ed => ed.id));
      connected.forEach(ed => removeEdge(m, ed));
      if (m.role === "future") {
        n.lineage = n.lineage || { baselineNodeId: null, rationale: "" };
        n.removed = true; n.lineage.change = "removed";
      } else {
        m.nodes = m.nodes.filter(x => x.id !== n.id); delete m.presentation.nodes[n.id];
      }
      return { nodeId: n.id };
    },
    addFlow(e, m, p) {
      if (m.edges.length >= schema.LIMITS.edgesPerModel) fail("This process has reached the flow limit.");
      const ed = makeEdge(m, p.from, p.to, cleanText(p.label, 200).trim(), p.semanticType || "sequence");
      checkFlow(m, ed); m.edges.push(ed); return { edgeId: ed.id };
    },
    updateFlow(e, m, p) {
      const ed = edge(m, p.edgeId), patch = p.patch || {};
      if ((patch.from !== undefined && patch.from !== ed.from) || (patch.to !== undefined && patch.to !== ed.to)) guardRefs(e, m, [], [ed.id]);
      ["from", "to", "semanticType"].forEach(k => { if (patch[k] !== undefined) ed[k] = patch[k]; });
      if (patch.label !== undefined) ed.label = cleanText(patch.label, 200).trim();
      checkFlow(m, ed); mark(m, ed); return { edgeId: ed.id };
    },
    deleteFlow(e, m, p) {
      const ed = edge(m, p.edgeId); guardRefs(e, m, [], [ed.id]); removeEdge(m, ed); return { edgeId: ed.id };
    }
  };
  const commands = {};
  Object.keys(operations).forEach(verb => {
    commands["builder/" + verb] = (e, p) => {
      const m = editableModel(e, p.modelId), result = operations[verb](e, m, p);
      result.modelId = m.id;
      result.invalidatedScenarioIds = invalidateRuns(e, m.id);
      return result;
    };
  });
  commands["builder/clone"] = (e, p) => {
    if (e.models.length >= schema.LIMITS.models) fail("This engagement has reached the process limit.");
    const source = findModel(e, p.sourceModelId);
    if (source.role !== "current") fail("Choose a current state as the baseline for an alternative.");
    return store.COMMANDS["model/clone"](e, { sourceModelId: source.id, name: name(p.name, "alternative") });
  };
  commands["builder/renameModel"] = (e, p) => {
    const m = editableModel(e, p.modelId); m.name = name(p.name, "process"); return { modelId: m.id };
  };
  store.registerCommands(commands);
  return { blank, integrity, references, invalidateRuns, commands };
});
