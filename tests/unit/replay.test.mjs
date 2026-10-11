// Replay correctness: audit findings UX01, UX02, UX03 and acceptance criteria AC-2, AC-3.
import test from "node:test";
import assert from "node:assert/strict";
import { lib, example, tinyEngagement } from "./helpers.mjs";

const replay = lib("replay");

function rpaReplay(scenarioId) {
  const e = example("rpa-delivery");
  const model = e.models[0];
  const s = e.scenarios.find(x => x.id === scenarioId);
  return { e, model, rp: replay.buildReplay(model, s.runs["m-current"], e.meta.timeBasis) };
}

test("UX01: the second Develop Bot visit is active and breached at minute 9,100", () => {
  const { rp } = rpaReplay("sc-pay004");
  const st = replay.nodeStateAt(rp, "developBot", 9100);
  assert.equal(st.state, "active");
  assert.equal(st.visitIndex, 1, "second visit");
  assert.equal(st.visitCount, 2);
  assert.equal(st.completedVisits, 1);
  assert.equal(st.elapsed, 4804);
  assert.equal(st.sla.state, "breach");
});

test("UX01: between visits the step shows its first visit complete, then active again", () => {
  const { rp } = rpaReplay("sc-pay004");
  assert.equal(replay.nodeStateAt(rp, "developBot", 4000).state, "done");
  assert.equal(replay.nodeStateAt(rp, "developBot", 4296).state, "active");
  assert.deepEqual(replay.visitHistory(rp, "developBot").map(v => v.duration), [2300, 5200]);
});

test("UX03: an untraversed Defects edge is never marked visited", () => {
  const { model, rp } = rpaReplay("sc-inv001");
  const defects = model.edges.find(e => e.label === "Defects");
  [0, 4000, 5000, 1e9].forEach(t => assert.equal(replay.edgeStateAt(rp, defects, t), "idle"));
  const passed = model.edges.find(e => e.label === "Passed");
  assert.equal(replay.edgeStateAt(rp, passed, 1e9), "traversed");
});

test("UX03: the Defects edge is traversed in the rework sample, once QA has decided", () => {
  const { model, rp } = rpaReplay("sc-pay004");
  const defects = model.edges.find(e => e.label === "Defects");
  assert.equal(replay.edgeStateAt(rp, defects, 4000), "pending");
  assert.equal(replay.edgeStateAt(rp, defects, 5000), "active");
  assert.equal(replay.edgeStateAt(rp, defects, 1e9), "traversed");
});

test("UX02: excluded underwriting outcomes never show as complete", () => {
  const e = example("underwriting");
  e.scenarios.forEach(s => {
    e.models.forEach(model => {
      const rp = replay.buildReplay(model, s.runs[model.id], e.meta.timeBasis);
      model.nodes.filter(n => n.tags.optional).forEach(n => {
        [0, rp.duration / 2, rp.duration, 1e9].forEach(t => {
          assert.equal(replay.nodeStateAt(rp, n.id, t).state, "excluded", n.label + " in " + s.id);
        });
      });
    });
  });
});

test("UX02: edges into excluded outcomes and the unexecuted loops are never traversed", () => {
  const e = example("underwriting");
  const model = e.models[0];
  const s = e.scenarios.find(x => x.id === "case-3");
  const rp = replay.buildReplay(model, s.runs[model.id], e.meta.timeBasis);
  const labels = model.edges.filter(ed => replay.edgeStateAt(rp, ed, 1e9) !== "traversed").map(ed => ed.label);
  ["Conflict", "Out of Appetite", "Desk Only", "No (Treaty Fits)", "Exceeds Authority", "Lost", "Negotiate"]
    .forEach(label => assert.ok(labels.includes(label), label + " should not be traversed"));
  const bind = model.edges.find(ed => ed.label === "Bind Order");
  assert.equal(replay.edgeStateAt(rp, bind, 1e9), "traversed");
});

test("parallel joins receive a transition from every branch", () => {
  const { model, rp } = rpaReplay("sc-inv001");
  const intoJoin = model.edges.filter(ed => ed.to === "join1");
  assert.equal(intoJoin.length, 3);
  intoJoin.forEach(ed => assert.equal(replay.edgeStateAt(rp, ed, 1e9), "traversed"));
});

test("unknown membership is not animated", () => {
  const e = example("cash-matching");
  const model = e.models[0];
  const s = e.scenarios[0];
  const rp = replay.buildReplay(model, s.runs[model.id], e.meta.timeBasis);
  const denied = model.nodes.find(n => n.label === "Denied");
  assert.equal(s.runs[model.id].membership[denied.id], "unknown");
  assert.equal(replay.nodeStateAt(rp, denied.id, 1e9).state, "unknown");
});

test("deriveTransitions keeps loops unexecuted when timing does not support them", () => {
  const e = tinyEngagement();
  const model = e.models[0];
  const visits = [
    { id: "v1", nodeId: "start", start: 0, end: 0 },
    { id: "v2", nodeId: "work", start: 0, end: 10 },
    { id: "v3", nodeId: "check", start: 10, end: 10 },
    { id: "v4", nodeId: "end", start: 10, end: 10 }
  ];
  const tr = replay.deriveTransitions(model, visits);
  assert.deepEqual(tr.map(t => t.edgeId), ["e1", "e2", "e5"]);
});

test("deriveTransitions follows a rework loop through repeated visits", () => {
  const e = tinyEngagement();
  const model = e.models[0];
  const visits = [
    { id: "v1", nodeId: "start", start: 0, end: 0 },
    { id: "v2", nodeId: "work", start: 0, end: 10 },
    { id: "v3", nodeId: "check", start: 10, end: 10 },
    { id: "v4", nodeId: "fix", start: 10, end: 15 },
    { id: "v5", nodeId: "work", start: 15, end: 20 },
    { id: "v6", nodeId: "check", start: 20, end: 20 },
    { id: "v7", nodeId: "end", start: 20, end: 20 }
  ];
  const tr = replay.deriveTransitions(model, visits);
  assert.deepEqual(tr.map(t => t.edgeId + ":" + t.fromVisitId + ">" + t.toVisitId), [
    "e1:v1>v2", "e2:v2>v3", "e3:v3>v4", "e4:v4>v5", "e2:v5>v6", "e5:v6>v7"
  ]);
});

test("spanSummary separates elapsed span from the sum of parallel work", () => {
  const { rp } = rpaReplay("sc-inv001");
  const s = replay.spanSummary(rp);
  assert.ok(s.sumOfVisits > s.span, "parallel governance work overlaps");
});
