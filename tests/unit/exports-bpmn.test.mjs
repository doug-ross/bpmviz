// BPMN 2.0 export (lib/bpmn-export.js): the reverse of lib/bpmn.js. Real
// re-import through a DOMParser only runs in the browser test; this file
// checks the generated XML structurally.
import test from "node:test";
import assert from "node:assert/strict";
import { lib, tinyEngagement, example } from "./helpers.mjs";

const bpmnExport = lib("bpmn-export");
const { escapeXml } = lib("ooxml");

function tagCount(xml, tag) {
  return (xml.match(new RegExp("<" + tag + "[ />]", "g")) || []).length;
}

function ids(xml, tag) {
  const re = new RegExp("<" + tag + "[^>]*\\bid=\"([^\"]+)\"", "g");
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

test("exportModel writes every lane, step and connector as valid-looking BPMN", () => {
  const e = tinyEngagement();
  const xml = bpmnExport.exportModel(e, "m-current");
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8" standalone="yes"\?>/);
  assert.match(xml, /<definitions xmlns="http:\/\/www\.omg\.org\/spec\/BPMN\/20100524\/MODEL"/);
  assert.equal(tagCount(xml, "collaboration"), 1);
  assert.equal(tagCount(xml, "participant"), 1);
  assert.equal(tagCount(xml, "lane"), 2, "two lanes");
  assert.equal(tagCount(xml, "startEvent"), 1);
  assert.equal(tagCount(xml, "endEvent"), 1);
  assert.equal(tagCount(xml, "userTask"), 2, "work and fix are user tasks");
  assert.equal(tagCount(xml, "exclusiveGateway"), 1);
  assert.equal(tagCount(xml, "sequenceFlow"), 5);
  assert.equal(tagCount(xml, "bpmndi:BPMNShape"), 1 + 2 + 5, "pool, lanes and every flow node");
  assert.equal(tagCount(xml, "bpmndi:BPMNEdge"), 5);
  assert.match(xml, /name="Rejected"/);
  assert.match(xml, /name="Retry"/);
  // No fabricated conditions on the gateway's outgoing flows.
  assert.doesNotMatch(xml, /conditionExpression/);
  // Every sequenceFlow's sourceRef and targetRef resolve to a flow node id that was written.
  const nodeTags = ["startEvent", "endEvent", "userTask", "exclusiveGateway"];
  const nodeIds = new Set(nodeTags.flatMap(t => ids(xml, t)));
  const flowRe = /<sequenceFlow[^>]*sourceRef="([^"]+)"[^>]*targetRef="([^"]+)"/g;
  let m;
  let count = 0;
  while ((m = flowRe.exec(xml))) { count++; assert.ok(nodeIds.has(m[1]), m[1]); assert.ok(nodeIds.has(m[2]), m[2]); }
  assert.equal(count, 5);
  // Every flow node id appears in exactly one BPMNShape, with a positive width and height.
  nodeIds.forEach(id => {
    const shape = new RegExp("<bpmndi:BPMNShape bpmnElement=\"" + id + "\"><omgdc:Bounds x=\"-?\\d+\" y=\"-?\\d+\" width=\"(\\d+)\" height=\"(\\d+)\"");
    const hit = shape.exec(xml);
    assert.ok(hit, "a shape exists for " + id);
    assert.ok(Number(hit[1]) > 0 && Number(hit[2]) > 0);
  });
});

test("source IDs are reused as BPMN element IDs when they are valid XML names", () => {
  const e = tinyEngagement();
  e.models[0].nodes[1].sourceIds = ["Task_DoWork"];
  const xml = bpmnExport.exportModel(e, "m-current");
  assert.match(xml, /<userTask id="Task_DoWork" name="Do the work"\/>/);
});

test("an id that is not a valid XML name is sanitized and made unique", () => {
  const e = tinyEngagement();
  e.models[0].nodes[1].sourceIds = ["1:weird id"];
  e.models[0].nodes[3].sourceIds = ["1:weird id"];
  const xml = bpmnExport.exportModel(e, "m-current");
  const workIds = ids(xml, "userTask");
  assert.equal(workIds.length, 2);
  assert.notEqual(workIds[0], workIds[1]);
  workIds.forEach(id => assert.match(id, /^[A-Za-z_][A-Za-z0-9_.-]*$/));
});

test("node, edge and lane ids never collide even when their source ids coincide", () => {
  const e = tinyEngagement();
  e.models[0].nodes[1].sourceIds = ["Flow_1"]; // a userTask would otherwise take the same id as an edge
  e.models[0].edges[0].id = "Flow_1";
  const xml = bpmnExport.exportModel(e, "m-current");
  const allIds = [];
  const re = /\sid="([^"]+)"/g;
  let m;
  while ((m = re.exec(xml))) allIds.push(m[1]);
  const seen = new Set();
  allIds.forEach(id => {
    assert.ok(!seen.has(id), "id \"" + id + "\" is reused by more than one element");
    seen.add(id);
  });
  assert.ok(seen.has("Flow_1"), "the first claimant still gets to keep the source id");
});

test("removed steps and their connectors are left out", () => {
  const e = tinyEngagement();
  e.models[0].nodes[3].removed = true; // fix
  const xml = bpmnExport.exportModel(e, "m-current");
  assert.equal(tagCount(xml, "userTask"), 1, "only work remains");
  assert.equal(tagCount(xml, "sequenceFlow"), 3, "the two flows touching fix are dropped");
  assert.doesNotMatch(xml, /name="Retry"/);
});

test("edge labels become sequence flow names; unlabeled flows have none", () => {
  const e = tinyEngagement();
  const xml = bpmnExport.exportModel(e, "m-current");
  const first = /<sequenceFlow id="[^"]+" sourceRef="[^"]+" targetRef="[^"]+"\/>/;
  assert.match(xml, first, "a flow with no label has no name attribute");
});

test("message and timer start events, and a terminate end event, carry their definitions", () => {
  const e = tinyEngagement();
  e.models[0].nodes[0].semanticType = "messageStartEvent";
  e.models[0].nodes[4].semanticType = "terminateEndEvent";
  const xml = bpmnExport.exportModel(e, "m-current");
  assert.match(xml, /<startEvent id="[^"]+" name="Start"><messageEventDefinition\/><\/startEvent>/);
  assert.match(xml, /<endEvent id="[^"]+" name="Done"><terminateEventDefinition\/><\/endEvent>/);
});

test("an unknown semantic type exports as a plain task rather than failing", () => {
  const e = tinyEngagement();
  e.models[0].nodes[2].semanticType = "somethingNew";
  const xml = bpmnExport.exportModel(e, "m-current");
  assert.match(xml, /<task id="[^"]+" name="Check"\/>/);
});

test("a model with no steps left refuses to export", () => {
  const e = tinyEngagement();
  e.models[0].nodes.forEach(n => { n.removed = true; });
  assert.throws(() => bpmnExport.exportModel(e, "m-current"), bpmnExport.BpmnExportError);
  assert.throws(() => bpmnExport.exportModel(e, "no-such-model"), bpmnExport.BpmnExportError);
});

test("a larger example model exports every lane and step", () => {
  const e = example("underwriting-current-state");
  const model = e.models[0];
  const xml = bpmnExport.exportModel(e, model.id);
  const activeNodes = model.nodes.filter(n => !n.removed);
  const activeEdges = model.edges.filter(ed => !ed.removed && activeNodes.some(n => n.id === ed.from) && activeNodes.some(n => n.id === ed.to));
  assert.equal(tagCount(xml, "sequenceFlow"), activeEdges.length);
  assert.equal(tagCount(xml, "bpmndi:BPMNShape"), 1 + model.lanes.length + activeNodes.length);
  model.nodes.forEach(n => { if (!n.removed) assert.match(xml, new RegExp("name=\"" + escapeXml(n.label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\"")); });
});
