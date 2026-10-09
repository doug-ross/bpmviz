#!/usr/bin/env node
/*
 * Writes two demonstration event logs for the underwriting current-state
 * example: docs/samples/underwriting-baseline.csv and
 * docs/samples/underwriting-after.csv.
 *
 * A seeded pseudo-random walk follows the real process graph from the
 * bundled underwriting-current-state example, one case at a time, choosing
 * a branch at each gateway with the same share of cases the benefits test
 * fixtures (tests/fixtures/datasets/underwriting-{baseline,after}.dataset.json)
 * record for that gateway, and timing each step with that fixture's own
 * median duration (plus random jitter), counted in working hours (Monday
 * to Friday, 9:00 to 17:00 UTC) to match the example's business time
 * basis. The after log reflects plausible
 * improvements on the three steps those fixtures measure as faster: scrub
 * the SOV and geocode, the appetite and capacity triage, and technical
 * pricing and rating. Every other step keeps the same typical duration.
 *
 * The output is demonstration data, not from a real engagement, columns
 * case, activity, start, end, resource. Running the script again produces
 * byte-identical files, since the random walk is seeded.
 *
 *   node tools/make-sample-logs.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const util = require(path.join(root, "webui", "js", "lib", "util.js"));

const example = JSON.parse(fs.readFileSync(path.join(root, "webui", "examples", "underwriting-current-state.engagement.json"), "utf8"));
const model = example.models[0];
const nodesById = new Map(model.nodes.map(n => [n.id, n]));
const lanesById = new Map(model.lanes.map(l => [l.id, l.name]));
const outEdges = new Map();
const inDegree = new Map();
model.edges.forEach(e => {
  if (!outEdges.has(e.from)) outEdges.set(e.from, []);
  outEdges.get(e.from).push(e);
  inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
});
const startNode = model.nodes.find(n => n.semanticType === "startEvent");

/*
 * Share of cases taking each labeled edge at a gateway, as measured in the
 * dataset fixtures. A gateway not listed here has only one scheduled edge
 * in this demonstration (its other edges describe off-route branches, such
 * as a technical referral to UW authority, that this walk never takes, the
 * same way the bundled example's own summary describes them).
 */
const BRANCH_SHARE = {
  "clearance-approved": { Conflict: 0.12, Clear: 0.88 },
  "within-appetite": { "Out of Appetite": 0, "In Appetite": 1 },
  "on-site-survey-needed": { "Survey Required": 0.1136, "Desk Only": 0.8864 },
  "fac-reinsurance-required": { Yes: 0.1818, "No (Treaty Fits)": 0.8182 },
  "exceeds-uw-authority": { "Exceeds Authority": 0, "Within Authority": 1 },
  "broker-response": { Lost: 0.159, Negotiate: 0, "Bind Order": 0.841 }
};

/* The three steps the after log measures as faster, and by how much (median duration). */
const IMPROVED = {
  "scrub-sov-geocode": { from: 240, to: 96 },
  "appetite-capacity-triage": { from: 90, to: 54 },
  "technical-pricing-rating": { from: 300, to: 210 }
};

/* Median duration in minutes for every measured step, baseline and after. */
const BASE_DURATION = new Map([
  ["check-clearance-dedup", 30], ["scrub-sov-geocode", 240], ["appetite-capacity-triage", 90],
  ["assign-to-underwriter", 20], ["review-cope-exposure-loss-runs", 300], ["desk-review-cope-protections", 360],
  ["publish-risk-report-pml-mfl-recs", 180], ["ingest-sov-into-cat-platform", 120], ["run-wind-flood-quake-aal-pml", 240],
  ["determine-layering-participation", 120], ["technical-pricing-rating", 300], ["select-forms-endorsements", 90],
  ["assemble-multi-option-quote", 120], ["deliver-quote-to-broker", 30], ["process-bind-order", 60],
  ["validate-subjectivities-ofac", 90], ["issue-formal-binder", 45], ["assemble-dec-sheet-forms-endorsements", 180],
  ["qa-reinsurance-reconciliation", 120], ["book-premium-in-pas-gl", 45], ["deliver-policy-package-to-broker", 30],
  ["structure-fac-placement-slip", 240], ["obtain-fac-binder-from-market", 1440], ["perform-on-site-loss-prevention-survey", 960],
  ["send-decline-letter", 20]
]);

function durationsFor(after) {
  const out = new Map(BASE_DURATION);
  if (after) Object.keys(IMPROVED).forEach(id => out.set(id, IMPROVED[id].to));
  return out;
}

/* Mulberry32: a small seeded generator, so the same seed always writes the same file. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickEdge(edges, rand) {
  if (edges.length <= 1) return edges[0];
  const shares = BRANCH_SHARE[edges[0].from];
  if (!shares) return edges[0]; // an off-route gateway: always take the main edge
  const roll = rand();
  let acc = 0;
  for (const edge of edges) {
    acc += shares[edge.label] || 0;
    if (roll < acc) return edge;
  }
  return edges.find(e => shares[e.label]) || edges[0];
}

const MINUTE_MS = 60000;
const isEnd = node => node.semanticType === "endEvent" || node.semanticType === "terminateEndEvent";

/*
 * Walks from one node, timing each measured step. stopAtJoin is set only on
 * a parallel branch: it stops, without consuming, at a parallel gateway
 * that several branches lead into, so the caller can resume once every
 * branch has arrived. At a parallel gateway with more than one outgoing
 * edge (a fork), every branch is walked from the same clock and the walk
 * resumes from their shared join once all of them reach it, so a case
 * that reaches the fork always visits both of its branches, the way the
 * dataset fixtures this script matches record it. Returns
 * { rows: [{ activity, start, end, resource }], next (the node the walk
 * stopped at, or null at an end event), clock }.
 */
function walkFrom(nodeId, durations, rand, clock, stopAtJoin) {
  const rows = [];
  let node = nodesById.get(nodeId);
  let steps = 0;
  while (node && steps++ < 40) {
    if (stopAtJoin && node.semanticType === "parallelGateway" && (inDegree.get(node.id) || 0) > 1) return { rows, next: node, clock };
    const typical = durations.get(node.id);
    if (typical != null) {
      const start = clock;
      const end = clock + Math.round(typical * (0.75 + rand() * 0.5)) * MINUTE_MS; // +/- 25%
      rows.push({ activity: node.label, start, end, resource: lanesById.get(node.laneId) || node.laneId });
      clock = end + Math.round(5 + rand() * 25) * MINUTE_MS; // a short wait before the next step
    }
    if (isEnd(node)) return { rows, next: null, clock };
    const edges = outEdges.get(node.id) || [];
    if (!edges.length) return { rows, next: null, clock };
    if (node.semanticType === "parallelGateway" && edges.length > 1) {
      let join = null, latest = clock;
      edges.forEach(edge => {
        const branch = walkFrom(edge.to, durations, rand, clock, true);
        rows.push(...branch.rows);
        if (branch.next) join = branch.next;
        if (branch.clock > latest) latest = branch.clock;
      });
      if (!join) return { rows, next: null, clock: latest };
      node = join;
      clock = latest;
      continue;
    }
    node = nodesById.get(pickEdge(edges, rand).to);
  }
  return { rows, next: node, clock };
}

/** Walks one case through the graph from the given start time, events sorted by when they start. */
function walkCase(durations, rand, startTime) {
  return walkFrom(startNode.id, durations, rand, startTime, false).rows.sort((a, b) => a.start - b.start);
}

function isoMinute(ms) {
  return new Date(Math.round(ms / MINUTE_MS) * MINUTE_MS).toISOString();
}

/*
 * The walk keeps its clock in working time: milliseconds of working hours
 * since the period start. The example engagement measures time in business
 * minutes (Monday to Friday, 480 minutes from 9:00, the event-log import's
 * default day start), so every step is placed inside those hours and its
 * business-time duration is the typical duration above. A step longer than
 * what is left of a working day carries on the next working morning.
 */
const WORK_DAY_MINUTES = 480;
const DAY_START_MINUTE = 9 * 60;
const BUSINESS_DAYS = 63; // the working days in the roughly 88 calendar days each log covers

function wallClock(periodStart, workMs) {
  const minutes = Math.round(workMs / MINUTE_MS);
  const workday = Math.floor(minutes / WORK_DAY_MINUTES);
  const minute = minutes - workday * WORK_DAY_MINUTES;
  const calendarDay = Math.floor(workday / 5) * 7 + (workday % 5); // the period starts on a Monday
  return periodStart + (calendarDay * 1440 + DAY_START_MINUTE + minute) * MINUTE_MS;
}

/** Writes one log: caseCount cases arriving evenly across the period's working days, each a seeded walk. */
function makeLog(fileName, seed, caseCount, periodStartIso, after) {
  const durations = durationsFor(after);
  const rand = mulberry32(seed);
  const periodStart = Date.parse(periodStartIso);
  if (new Date(periodStart).getUTCDay() !== 1 || new Date(periodStart).getUTCHours() !== 0) throw new Error("The period must start on a Monday at midnight UTC.");
  const rows = [["case", "activity", "start", "end", "resource"]];
  for (let i = 0; i < caseCount; i++) {
    const caseId = (after ? "AFT-" : "BASE-") + String(i + 1).padStart(4, "0");
    const day = Math.floor(i / (caseCount / BUSINESS_DAYS));
    const arrivalMinute = Math.floor(rand() * 7 * 60); // between 9:00 and 16:00
    const start = (day * WORK_DAY_MINUTES + arrivalMinute) * MINUTE_MS;
    walkCase(durations, rand, start).forEach(ev => rows.push([caseId, ev.activity, isoMinute(wallClock(periodStart, ev.start)), isoMinute(wallClock(periodStart, ev.end)), ev.resource]));
  }
  const outPath = path.join(root, "docs", "samples", fileName);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, util.toCsv(rows).replace(/\r\n/g, "\n")); // this repo keeps LF line endings in every checkout
  return { fileName, cases: caseCount, events: rows.length - 1 };
}

const baseline = makeLog("underwriting-baseline.csv", 1, 260, "2026-03-02T00:00:00.000Z", false);
const afterLog = makeLog("underwriting-after.csv", 2, 271, "2026-08-03T00:00:00.000Z", true);

console.log("Wrote " + baseline.fileName + ": " + baseline.cases + " cases, " + baseline.events + " events.");
console.log("Wrote " + afterLog.fileName + ": " + afterLog.cases + " cases, " + afterLog.events + " events.");
console.log("Demonstration data: a seeded random walk of the underwriting-current-state example, not from a real engagement.");
