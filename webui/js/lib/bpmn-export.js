/*
 * AIxRay bpmn-export: writes one model back out as BPMN 2.0 XML, the reverse
 * of lib/bpmn.js. Removed steps and connectors are left out; edge labels
 * become sequence flow names, and no gateway condition is invented. Element
 * IDs reuse the model's source IDs when they are valid XML names, and are
 * otherwise sanitized and made unique. Diagram positions come from
 * lib/layout.js, offset to leave room for the pool and lane headers.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./util.js"), require("./schema.js"), require("./layout.js"), require("./ooxml.js"));
  } else {
    const B = root.AIxRay = root.AIxRay || {};
    B.bpmnExport = factory(B.util, B.schema, B.layout, B.ooxml);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, schema, layout, ooxml) {
  "use strict";

  class BpmnExportError extends Error {}

  const POOL_HEADER_W = 30;
  const LANE_HEADER_W = 150;

  const NC_START = /^[A-Za-z_]/;
  const NC_CHARS = /^[A-Za-z0-9_.-]+$/;

  function isNcName(s) {
    return typeof s === "string" && s.length > 0 && s.length <= 200 && NC_START.test(s) && NC_CHARS.test(s);
  }

  function ncSanitize(raw) {
    let s = String(raw == null ? "" : raw).replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 200);
    if (!s || !NC_START.test(s)) s = "_" + s;
    return s || "_id";
  }

  function idMapFor(items, sourceOf, used) {
    const map = new Map();
    items.forEach(it => {
      const src = sourceOf(it);
      const base = isNcName(src) ? src : ncSanitize(it.id);
      map.set(it.id, util.uniqueId(base, used));
    });
    return map;
  }

  /* One flow node element, with its event definition when the semantic type needs one. */
  function nodeXml(n, id) {
    const nm = n.label ? " name=\"" + ooxml.escapeXml(n.label) + "\"" : "";
    const el = (tag, inner) => "<" + tag + " id=\"" + id + "\"" + nm + (inner ? ">" + inner + "</" + tag + ">" : "/>");
    switch (n.semanticType) {
      case "startEvent": return el("startEvent");
      case "messageStartEvent": return el("startEvent", "<messageEventDefinition/>");
      case "timerStartEvent": return el("startEvent", "<timerEventDefinition/>");
      case "endEvent": return el("endEvent");
      case "terminateEndEvent": return el("endEvent", "<terminateEventDefinition/>");
      case "intermediateEvent": return el("intermediateCatchEvent");
      case "messageEvent": return el("intermediateCatchEvent", "<messageEventDefinition/>");
      case "userTask": return el("userTask");
      case "manualTask": return el("manualTask");
      case "serviceTask": return el("serviceTask");
      case "scriptTask": return el("scriptTask");
      case "businessRuleTask": return el("businessRuleTask");
      case "sendTask": return el("sendTask");
      case "receiveTask": return el("receiveTask");
      case "subProcess": return el("subProcess");
      case "callActivity": return el("callActivity");
      case "exclusiveGateway": return el("exclusiveGateway");
      case "parallelGateway": return el("parallelGateway");
      case "inclusiveGateway": return el("inclusiveGateway");
      case "eventBasedGateway": return el("eventBasedGateway");
      case "task": return el("task");
      default: return el("task"); // a generic gateway, an unsupported element, or any other type exports as a plain task
    }
  }

  /**
   * BPMN 2.0 XML for one model: a collaboration with one participant, its
   * lanes, flow nodes and sequence flows, and a diagram with shapes and
   * waypoints. Throws BpmnExportError when the model has no steps left once
   * removed steps are dropped.
   */
  function exportModel(e, modelId) {
    const model = (e && e.models || []).find(m => m.id === modelId);
    if (!model) throw new BpmnExportError("That process is no longer in this project.");
    const nodes = model.nodes.filter(n => !n.removed);
    if (!nodes.length) throw new BpmnExportError("\"" + model.name + "\" has no steps to export. Removed steps are left out of BPMN files.");
    const nodeSet = new Set(nodes.map(n => n.id));
    const edges = model.edges.filter(ed => !ed.removed && nodeSet.has(ed.from) && nodeSet.has(ed.to));

    const sub = { id: model.id, lanes: model.lanes, nodes, edges, presentation: model.presentation || { nodes: {} } };
    const lay = layout.computeLayout([sub]);
    const lm = lay.models[sub.id];
    const routes = layout.routeAll(sub, lm);

    const usedIds = new Set();
    const nodeId = idMapFor(nodes, n => n.sourceIds && n.sourceIds[0], usedIds);
    const edgeId = idMapFor(edges, ed => ed.id, usedIds);
    const laneId = idMapFor(model.lanes, l => l.id, usedIds);

    const processId = "Process_" + ncSanitize(model.id || "1");
    const participantId = "Participant_" + ncSanitize(model.id || "1");
    const collaborationId = "Collaboration_1";

    const lanesUsed = model.lanes.filter(l => nodes.some(n => n.laneId === l.id));
    const laneSetXml = lanesUsed.length ? "<laneSet id=\"LaneSet_1\">" + lanesUsed.map(l => {
      const refs = nodes.filter(n => n.laneId === l.id).map(n => "<flowNodeRef>" + nodeId.get(n.id) + "</flowNodeRef>").join("");
      return "<lane id=\"" + laneId.get(l.id) + "\" name=\"" + ooxml.escapeXml(l.name || "") + "\">" + refs + "</lane>";
    }).join("") + "</laneSet>" : "";

    const nodesXml = nodes.map(n => nodeXml(n, nodeId.get(n.id))).join("");
    const flowsXml = edges.map(ed => {
      const nm = ed.label ? " name=\"" + ooxml.escapeXml(ed.label) + "\"" : "";
      return "<sequenceFlow id=\"" + edgeId.get(ed.id) + "\" sourceRef=\"" + nodeId.get(ed.from) + "\" targetRef=\"" + nodeId.get(ed.to) + "\"" + nm + "/>";
    }).join("");

    const processXml = "<process id=\"" + processId + "\" name=\"" + ooxml.escapeXml(model.name || "") + "\" isExecutable=\"false\">" +
      laneSetXml + nodesXml + flowsXml + "</process>";

    const OX = POOL_HEADER_W + LANE_HEADER_W;
    const poolW = Math.round(OX + lm.width);
    const poolH = Math.round(lm.laneTop + model.lanes.length * lm.laneHeight + lm.laneTop);
    let diShapes = "<bpmndi:BPMNShape bpmnElement=\"" + participantId + "\" isHorizontal=\"true\">" +
      "<omgdc:Bounds x=\"0\" y=\"0\" width=\"" + poolW + "\" height=\"" + poolH + "\"/></bpmndi:BPMNShape>";
    model.lanes.forEach((l, i) => {
      if (!lanesUsed.includes(l)) return;
      const ly = lm.laneTop + i * lm.laneHeight;
      diShapes += "<bpmndi:BPMNShape bpmnElement=\"" + laneId.get(l.id) + "\" isHorizontal=\"true\">" +
        "<omgdc:Bounds x=\"" + POOL_HEADER_W + "\" y=\"" + Math.round(ly) + "\" width=\"" + Math.round(LANE_HEADER_W + lm.width) + "\" height=\"" + Math.round(lm.laneHeight) + "\"/></bpmndi:BPMNShape>";
    });
    nodes.forEach(n => {
      const p = lm.pos.get(n.id);
      const shape = schema.typeInfo(n.semanticType).shape;
      const halfW = shape === "task" ? 92 : shape === "gateway" ? 24 : 22;
      const halfH = shape === "task" ? 32 : shape === "gateway" ? 24 : 22;
      diShapes += "<bpmndi:BPMNShape bpmnElement=\"" + nodeId.get(n.id) + "\"><omgdc:Bounds x=\"" + Math.round(OX + p.x - halfW) +
        "\" y=\"" + Math.round(p.y - halfH) + "\" width=\"" + (halfW * 2) + "\" height=\"" + (halfH * 2) + "\"/></bpmndi:BPMNShape>";
    });
    let diEdges = "";
    edges.forEach(ed => {
      const pts = routes.get(ed.id) || [];
      diEdges += "<bpmndi:BPMNEdge bpmnElement=\"" + edgeId.get(ed.id) + "\">" +
        pts.map(pt => "<omgdi:waypoint x=\"" + Math.round(OX + pt.x) + "\" y=\"" + Math.round(pt.y) + "\"/>").join("") + "</bpmndi:BPMNEdge>";
    });

    return ooxml.XML_HEAD +
      "<definitions xmlns=\"http://www.omg.org/spec/BPMN/20100524/MODEL\" xmlns:bpmndi=\"http://www.omg.org/spec/BPMN/20100524/DI\" " +
      "xmlns:omgdc=\"http://www.omg.org/spec/DD/20100524/DC\" xmlns:omgdi=\"http://www.omg.org/spec/DD/20100524/DI\" " +
      "id=\"Definitions_1\" targetNamespace=\"http://aixray.local/bpmn\">" +
      "<collaboration id=\"" + collaborationId + "\"><participant id=\"" + participantId + "\" name=\"" + ooxml.escapeXml(model.name || "") +
      "\" processRef=\"" + processId + "\"/></collaboration>" +
      processXml +
      "<bpmndi:BPMNDiagram id=\"Diagram_1\"><bpmndi:BPMNPlane id=\"Plane_1\" bpmnElement=\"" + collaborationId + "\">" + diShapes + diEdges +
      "</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></definitions>";
  }

  return { BpmnExportError, exportModel };
});
