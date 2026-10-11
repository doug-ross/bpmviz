/*
 * AIxRay BPMN import: reads BPMN 2.0 XML into a current-state model.
 *
 * Supported: one process with lanes, start/end/intermediate events,
 * task types, exclusive and parallel gateways, and sequence flows.
 * Other elements are imported as flagged steps or reported, never dropped
 * without a warning. BPMN element IDs are kept as source IDs.
 * The caller supplies a parsed XML Document (the browser's DOMParser).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./util.js"), require("./schema.js"));
  else { const B = root.AIxRay = root.AIxRay || {}; B.bpmn = factory(B.util, B.schema); }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, schema) {
  "use strict";

  const TASKS = { task: "task", userTask: "userTask", manualTask: "manualTask", serviceTask: "serviceTask", scriptTask: "scriptTask",
    businessRuleTask: "businessRuleTask", sendTask: "sendTask", receiveTask: "receiveTask" };
  const GATEWAYS = { exclusiveGateway: "exclusiveGateway", parallelGateway: "parallelGateway", inclusiveGateway: "inclusiveGateway", eventBasedGateway: "eventBasedGateway" };
  const LIMITED = { subProcess: "subProcess", callActivity: "callActivity", transaction: "subProcess", adHocSubProcess: "subProcess" };
  const UNSUPPORTED = new Set(["complexGateway", "boundaryEvent"]);
  const IGNORED = new Set(["dataObject", "dataObjectReference", "dataStoreReference", "textAnnotation", "association", "group", "laneSet", "extensionElements", "documentation", "ioSpecification", "property"]);

  function children(el, name) {
    return Array.from(el.children || []).filter(c => c.localName === name);
  }

  function hasDefinition(el, name) {
    return children(el, name).length > 0;
  }

  function cleanName(el) {
    return String(el.getAttribute("name") || "").replace(/\s+/g, " ").trim();
  }

  function laneTypeFromName(name) {
    if (/\b(ai|agent|bot|system|automat|engine|platform)\b/i.test(name)) return "agent";
    if (/\b(customer|client|broker|vendor|supplier|bank|external|partner|insured|applicant|patient)\b/i.test(name)) return "external";
    return "human";
  }

  /**
   * doc: XML Document. options: { fileName, timestamp }.
   * Returns { engagement, warnings } or throws an Error with a readable message.
   */
  function importDocument(doc, options) {
    const opts = options || {};
    const warnings = [];
    const warn = (code, message, path) => warnings.push({ code, message, path: path || "" });
    if (!doc || !doc.documentElement || doc.getElementsByTagName("parsererror").length) {
      throw new Error("The file is not well-formed XML.");
    }
    if (doc.documentElement.localName !== "definitions") {
      throw new Error("The file is not BPMN 2.0 XML (no <definitions> element).");
    }
    const all = name => Array.from(doc.getElementsByTagNameNS("*", name));
    const processes = all("process");
    if (!processes.length) throw new Error("The BPMN file has no <process>.");
    const flowCount = p => Array.from(p.children).filter(c => TASKS[c.localName] || GATEWAYS[c.localName] || /Event$/.test(c.localName)).length;
    const process = processes.slice().sort((a, b) => flowCount(b) - flowCount(a))[0];
    if (processes.length > 1) {
      warn("bpmn.pools", "The file has " + processes.length + " processes (pools). Imported \"" + (cleanName(process) || process.getAttribute("id")) + "\"; the others are not imported.");
    }
    const messageFlows = all("messageFlow").length;
    if (messageFlows) warn("bpmn.messageFlow", messageFlows + " message flows between pools are not imported.");

    const participant = all("participant").find(p => p.getAttribute("processRef") === process.getAttribute("id"));
    const processName = cleanName(process) || (participant && cleanName(participant)) || String(opts.fileName || "Imported process").replace(/\.(bpmn|xml)$/i, "");

    // Diagram interchange positions.
    const bounds = new Map();
    all("BPMNShape").forEach(shape => {
      const ref = shape.getAttribute("bpmnElement");
      const b = Array.from(shape.children).find(c => c.localName === "Bounds");
      if (ref && b) bounds.set(ref, { x: Number(b.getAttribute("x")), y: Number(b.getAttribute("y")), w: Number(b.getAttribute("width")), h: Number(b.getAttribute("height")) });
    });

    // Lanes: leaf lanes only; nested lane sets are flattened.
    const lanes = [];
    const laneOf = new Map();
    const laneIds = new Set();
    let nested = false;
    const walkLanes = (laneSet, prefix) => {
      children(laneSet, "lane").forEach(lane => {
        const childSets = children(lane, "childLaneSet");
        const name = cleanName(lane) || lane.getAttribute("id");
        if (childSets.length) { nested = true; childSets.forEach(cs => walkLanes(cs, prefix ? prefix + " / " + name : name)); return; }
        const id = util.uniqueId(util.slug(lane.getAttribute("id") || name), laneIds);
        const full = prefix ? prefix + " / " + name : name;
        lanes.push({ id, name: full, role: "", type: laneTypeFromName(full), y: (bounds.get(lane.getAttribute("id")) || {}).y });
        children(lane, "flowNodeRef").forEach(ref => laneOf.set(ref.textContent.trim(), id));
      });
    };
    children(process, "laneSet").forEach(ls => walkLanes(ls, ""));
    if (nested) warn("bpmn.nestedLanes", "Nested lanes were flattened into one row each.");
    if (lanes.some(l => Number.isFinite(l.y))) lanes.sort((a, b) => (a.y || 0) - (b.y || 0));

    // Flow nodes.
    const nodes = [];
    const idMap = new Map();
    const nodeIds = new Set();
    const skipped = new Map();
    const addNode = (el, semanticType, extra) => {
      const src = el.getAttribute("id");
      if (!src) return;
      const id = util.uniqueId(util.isValidId(src) ? src : util.slug(src), nodeIds);
      idMap.set(src, id);
      const doc = children(el, "documentation").map(d => d.textContent.trim()).filter(Boolean).join(" ");
      nodes.push(Object.assign({
        id, label: cleanName(el) || src, sub: "", semanticType, laneId: laneOf.get(src) || "", sourceIds: [src],
        details: doc ? { desc: doc } : {},
        tags: { bottleneck: false, agent: false, humanReview: false, optional: false, sampled: false },
        measures: { typicalDuration: null, slaTarget: null, touchEffort: null, waitType: "" },
        provenance: { source: "source-document", validation: "unvalidated", evidenceRefs: ["ev-bpmn"], note: "Imported from " + (opts.fileName || "the BPMN file") + "." },
        lineage: null, removed: false
      }, extra || {}));
    };
    Array.from(process.children).forEach(el => {
      const name = el.localName;
      if (TASKS[name]) addNode(el, TASKS[name]);
      else if (GATEWAYS[name]) addNode(el, GATEWAYS[name]);
      else if (name === "startEvent") addNode(el, hasDefinition(el, "messageEventDefinition") ? "messageStartEvent" : hasDefinition(el, "timerEventDefinition") ? "timerStartEvent" : "startEvent");
      else if (name === "endEvent") addNode(el, hasDefinition(el, "terminateEventDefinition") ? "terminateEndEvent" : "endEvent");
      else if (name === "intermediateCatchEvent" || name === "intermediateThrowEvent") addNode(el, hasDefinition(el, "messageEventDefinition") ? "messageEvent" : "intermediateEvent");
      else if (LIMITED[name]) {
        addNode(el, LIMITED[name]);
        const inner = Array.from(el.children).filter(c => TASKS[c.localName] || GATEWAYS[c.localName] || /Event$/.test(c.localName)).length;
        if (inner) warn("bpmn.subprocess", "Subprocess \"" + (cleanName(el) || el.getAttribute("id")) + "\" is shown collapsed; its " + inner + " inner elements are not imported.", el.getAttribute("id"));
      } else if (UNSUPPORTED.has(name)) {
        addNode(el, "unsupported", { sourceType: name });
        warn("bpmn.unsupported", "\"" + (cleanName(el) || el.getAttribute("id")) + "\" is a " + name + ", which is not supported. It is shown as a flagged step.", el.getAttribute("id"));
      } else if (name !== "sequenceFlow" && !IGNORED.has(name)) {
        skipped.set(name, (skipped.get(name) || 0) + 1);
      } else if (IGNORED.has(name) && name !== "laneSet" && name !== "extensionElements" && name !== "documentation") {
        skipped.set(name, (skipped.get(name) || 0) + 1);
      }
    });
    skipped.forEach((count, name) => warn("bpmn.skipped", count + " " + name + " element" + (count === 1 ? " is" : "s are") + " not part of the process flow and were not imported."));
    if (!nodes.length) throw new Error("The process has no steps this importer can read.");

    // Unassigned nodes get their own lane.
    if (nodes.some(n => !n.laneId)) {
      const id = util.uniqueId(lanes.length ? "unassigned" : util.slug(processName), laneIds);
      lanes.push({ id, name: lanes.length ? "Not in a lane" : (participant && cleanName(participant)) || processName, role: "", type: "human" });
      nodes.forEach(n => { if (!n.laneId) n.laneId = id; });
      if (lanes.length > 1) warn("bpmn.unlaned", "Some steps are not in a lane; they are shown in \"Not in a lane\".");
    }
    if (lanes.some(l => l.type !== "human")) warn("bpmn.laneTypes", "Lane types were inferred from lane names. Check them in the engagement file.", "", "info");

    // Sequence flows.
    const edges = [];
    const edgeIds = new Set();
    const defaults = new Set(Array.from(process.children).map(el => el.getAttribute("default")).filter(Boolean));
    children(process, "sequenceFlow").forEach(f => {
      const from = idMap.get(f.getAttribute("sourceRef")), to = idMap.get(f.getAttribute("targetRef"));
      const src = f.getAttribute("id") || "";
      if (!from || !to) { warn("bpmn.flow", "Sequence flow " + src + " connects an element that was not imported, so it was skipped.", src); return; }
      const conditional = children(f, "conditionExpression").length > 0;
      edges.push({ id: util.uniqueId(util.isValidId(src) ? src : "e-" + from + "-" + to, edgeIds), from, to, label: cleanName(f),
        semanticType: defaults.has(src) ? "default" : conditional ? "conditional" : "sequence", dashed: false, emphasis: "", removed: false, lineage: null });
    });

    // Columns from diagram positions, when present.
    const presentation = { laneHeight: null, nodes: {} };
    const placed = nodes.filter(n => bounds.has(n.sourceIds[0]));
    if (placed.length === nodes.length) {
      const centers = [...new Set(placed.map(n => { const b = bounds.get(n.sourceIds[0]); return Math.round((b.x + b.w / 2) / 40); }))].sort((a, b) => a - b);
      const rank = new Map(centers.map((c, i) => [c, i]));
      placed.forEach(n => { const b = bounds.get(n.sourceIds[0]); presentation.nodes[n.id] = { x: rank.get(Math.round((b.x + b.w / 2) / 40)) }; });
    } else if (placed.length) {
      warn("bpmn.layout", "Diagram positions are missing for some steps, so the layout follows the flow instead.", "", "info");
    }

    const e = schema.blankEngagement({
      id: util.uid("eng"), processName, dataStatus: "supplied", engagementName: "",
      timeBasis: { unit: "minute", calendar: "calendar", businessMinutesPerDay: 480 },
      summary: "Imported from " + (opts.fileName || "a BPMN file") + ". No scenario timing is included; replay is off until timings are added."
    });
    if (opts.timestamp) e.createdAt = e.updatedAt = opts.timestamp;
    e.evidence.push({ id: "ev-bpmn", title: opts.fileName || "Imported BPMN file", locator: "Process " + (process.getAttribute("id") || ""),
      extractedFact: "Lanes, steps and sequence flows for the current-state model.", status: "unreviewed", reviewer: "", reviewDate: "", link: null });
    e.models.push({ id: "m-current", role: "current", name: "Current state", version: 1, status: "baseline", locked: false, basedOn: null,
      sourceRefs: ["ev-bpmn"], notes: "", lanes: lanes.map(({ y, ...l }) => l), nodes, edges, presentation });
    e.migration = { sourceFormat: "BPMN 2.0 XML (supported subset)", sourceFiles: [opts.fileName || ""], convertedAt: e.createdAt, warnings };
    return { engagement: e, warnings };
  }

  return { importDocument };
});
