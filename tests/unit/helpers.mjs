import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const libDir = path.join(root, "webui", "js", "lib");
export const lib = name => require(path.join(libDir, name + ".js"));
export const legacy = require(path.join(root, "tools", "lib", "legacy.cjs"));

export function example(name) {
  const text = fs.readFileSync(path.join(root, "webui", "examples", name + ".engagement.json"), "utf8");
  return JSON.parse(text);
}

export function fixture(name) {
  return fs.readFileSync(path.join(root, "tests", "fixtures", name), "utf8");
}

/** A small valid engagement for tests that need a clean slate. */
export function tinyEngagement() {
  return {
    schema: "bpmviz.engagement", schemaVersion: 1, id: "eng-tiny", revision: 0,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    meta: { processName: "Tiny", timeBasis: { unit: "minute", calendar: "calendar", businessMinutesPerDay: 480 } },
    models: [{
      id: "m-current", role: "current", name: "Current state", version: 1,
      lanes: [{ id: "a", name: "Team A", type: "human" }, { id: "b", name: "Team B", type: "human" }],
      nodes: [
        { id: "start", label: "Start", semanticType: "startEvent", laneId: "a" },
        { id: "work", label: "Do the work", semanticType: "userTask", laneId: "a" },
        { id: "check", label: "Check", semanticType: "exclusiveGateway", laneId: "b" },
        { id: "fix", label: "Fix", semanticType: "userTask", laneId: "b" },
        { id: "end", label: "Done", semanticType: "endEvent", laneId: "b" }
      ],
      edges: [
        { id: "e1", from: "start", to: "work" },
        { id: "e2", from: "work", to: "check" },
        { id: "e3", from: "check", to: "fix", label: "Rejected" },
        { id: "e4", from: "fix", to: "work", label: "Retry" },
        { id: "e5", from: "check", to: "end", label: "Accepted" }
      ],
      presentation: { nodes: { start: { x: 0 }, work: { x: 1 }, check: { x: 2 }, fix: { x: 3 }, end: { x: 4 } } }
    }],
    scenarios: [], records: [], evidence: [], assumptions: []
  };
}

/**
 * A dataset fixture from tests/fixtures/datasets: tiny-baseline and tiny-after
 * fit tinyEngagement(); underwriting-baseline and underwriting-after fit the
 * underwriting-current-state example. Each call returns a fresh copy.
 */
export function datasetFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(root, "tests", "fixtures", "datasets", name + ".dataset.json"), "utf8"));
}

/** The tiny baseline dataset, for tinyEngagement(). */
export function tinyDataset() {
  return datasetFixture("tiny-baseline");
}
