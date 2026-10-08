// Legacy adapters, layout and lenses: P0-01, UX04, UX11, P1-04, AC-1.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { lib, legacy, root, example } from "./helpers.mjs";

const layout = lib("layout");
const lenses = lib("lenses");
const replay = lib("replay");
const { validateEngagement } = lib("validate");

const EXAMPLES = ["underwriting", "underwriting-current-state", "cash-matching", "rpa-delivery"];

test("AC-1: all three legacy formats convert through the trusted adapters", () => {
  const x1 = legacy.fromExplorerV1(legacy.loadExplorerV1(path.join(root, "archive", "explorer-v1", "js")));
  const r1 = legacy.fromRacer(legacy.loadRacer(path.join(root, "archive", "racer-v1", "process.js")), { id: "eng-a" });
  const r2 = legacy.fromRacer(legacy.loadRacer(path.join(root, "archive", "racer-v2-astra", "process.js")), { id: "eng-b", excludeOptional: true });
  [x1, r1, r2].forEach(e => assert.equal(validateEngagement(e).ok, true));
  assert.equal(x1.models[0].nodes.length, 20);
  assert.equal(r2.models[0].nodes.length, 40);
  assert.equal(r2.models[1].nodes.length, 38);
  assert.equal(r2.models[0].lanes.length, 7);
  assert.equal(r2.models[1].lanes.length, 9);
});

test("gateway meaning is preserved, and undeclared gateways are warned about", () => {
  const x = example("rpa-delivery").models[0];
  assert.equal(x.nodes.find(n => n.id === "fork1").semanticType, "parallelGateway");
  assert.equal(x.nodes.find(n => n.id === "qaGate").semanticType, "exclusiveGateway");
  const uw = example("underwriting");
  assert.equal(uw.models[0].nodes.find(n => n.label === "Initiate Parallel Analysis").semanticType, "parallelGateway");
  assert.equal(uw.models[0].nodes.find(n => n.label === "Risk Insights Reunited").semanticType, "parallelGateway");
  assert.ok(uw.migration.warnings.some(w => w.code === "semantic.gateway" && /Broker Response/.test(w.message)));
});

test("source BPMN IDs are retained on converted steps", () => {
  const uw = example("underwriting").models[0];
  assert.deepEqual(uw.nodes.find(n => n.label === "Check Clearance & Dedup").sourceIds, ["Task_ClearanceAndDedup"]);
});

test("UX11: repaired encoding, and no em dashes in bundled example text", () => {
  EXAMPLES.forEach(name => {
    const text = fs.readFileSync(path.join(root, "webui", "examples", name + ".engagement.json"), "utf8");
    assert.doesNotMatch(text, /\u00c2\u00b7|\u00e2\u20ac/, name + " has mojibake");
    assert.doesNotMatch(text, /[\u2014\u2015]/, name + " has an em dash");
  });
  assert.equal(example("rpa-delivery").scenarios[0].name, "Invoice Capture Bot");
});

test("UX04: no two steps are drawn at the same position", () => {
  EXAMPLES.forEach(name => {
    const e = example(name);
    const all = layout.computeLayout(e.models);
    e.models.forEach(m => assert.deepEqual(layout.collisions(all.models[m.id]), [], name + " " + m.id));
    e.models.forEach(m => {
      const single = layout.computeLayout([m]);
      assert.deepEqual(layout.collisions(single.models[m.id]), []);
    });
  });
  const gov = layout.computeLayout(example("rpa-delivery").models).models["m-current"].pos;
  const xs = ["provAccess", "dataClass", "preApprovals"].map(id => gov.get(id).x);
  assert.equal(new Set(xs).size, 3);
});

test("every connector gets a route", () => {
  EXAMPLES.forEach(name => {
    const e = example(name);
    const all = layout.computeLayout(e.models);
    e.models.forEach(m => {
      const routes = layout.routeAll(m, all.models[m.id]);
      assert.equal(routes.size, m.edges.length);
      routes.forEach(points => assert.ok(points.length >= 2));
    });
  });
});

test("auto layout orders steps along the flow when no positions are given", () => {
  const m = JSON.parse(JSON.stringify(example("rpa-delivery").models[0]));
  m.presentation.nodes = {};
  const cols = layout.autoColumns(m);
  assert.equal(cols.get("start"), 0);
  assert.ok(cols.get("developBot") > cols.get("join1"));
  assert.ok(cols.get("end") > cols.get("deploy"));
});

test("lenses declare coverage and never treat missing data as zero", () => {
  const e = example("underwriting");
  const model = e.models[0];
  const s = e.scenarios.find(x => x.id === "case-3");
  const rp = replay.buildReplay(model, s.runs[model.id], e.meta.timeBasis);
  const effort = lenses.computeLens("effort", { model, replay: rp, engagement: e });
  assert.equal(effort.coverage.have, 0);
  assert.equal(Object.keys(effort.nodes).length, 0);
  assert.ok(effort.notes.some(n => /free-text effort notes/.test(n)));
  const handoffs = lenses.computeLens("handoffs", { model, replay: rp, engagement: e });
  assert.ok(handoffs.coverage.have > 0);
  const waits = lenses.computeLens("waits", { model, replay: rp, engagement: e });
  assert.ok(Object.values(waits.nodes).some(n => n.category === "external"));
  const bott = lenses.computeLens("bottlenecks", { model, replay: rp, engagement: e });
  assert.match(bott.population, /not measured/);
});

test("the time lens explains that parallel work is not summed", () => {
  const e = example("rpa-delivery");
  const model = e.models[0];
  const s = e.scenarios[0];
  const rp = replay.buildReplay(model, s.runs[model.id], e.meta.timeBasis);
  const time = lenses.computeLens("time", { model, replay: rp, engagement: e });
  assert.ok(time.notes.some(n => /parallel work overlaps/.test(n)));
});

test("only connectors that go back in the flow are loops, not every one drawn right to left", () => {
  // start -> a -> gate -> b -> end, gate -> c (drawn to the left of gate) -> end, end2 <- b, and b -> a (rework).
  const col = { start: 0, a: 1, gate: 2, b: 3, c: 1.5, end: 4 };
  const flows = [
    { from: "start", to: "a" }, { from: "a", to: "gate" }, { from: "gate", to: "b" }, { from: "b", to: "end" },
    { from: "gate", to: "c" }, { from: "c", to: "end" }, { from: "b", to: "a" }
  ];
  assert.deepEqual([...legacy.cycleEdges(Object.keys(col), flows, id => col[id])], [6], "only the rework connector b -> a");
  // A forward path inside a larger loop stays forward: the long way back is the loop.
  const col2 = { s: 0, q: 1, r: 2, auth: 4, quote: 3, resp: 5 };
  const flows2 = [
    { from: "s", to: "q" }, { from: "q", to: "r" }, { from: "r", to: "auth" }, { from: "auth", to: "quote" },
    { from: "quote", to: "resp" }, { from: "resp", to: "q" }
  ];
  assert.deepEqual([...legacy.cycleEdges(Object.keys(col2), flows2, id => col2[id])], [5]);
  const uw = example("underwriting-current-state").models[0];
  const loops = uw.edges.filter(e => e.semanticType === "loop").map(e => e.label);
  assert.deepEqual(loops, ["Negotiate"]);
});
