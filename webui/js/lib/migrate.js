/*
 * BPMVIZ migrate: upgrades engagement files written by older schema versions.
 * Each step takes version N and returns version N + 1. Version 1 is current,
 * so the registry is empty; the mechanism is tested so that the first real
 * schema change has a place to go.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./util.js"), require("./schema.js"));
  else { const B = root.BPMVIZ = root.BPMVIZ || {}; B.migrate = factory(B.util, B.schema); }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, schema) {
  "use strict";

  /* STEPS[n] upgrades an engagement from schemaVersion n to n + 1. */
  const STEPS = {};

  function migrateEngagement(input, steps) {
    const registry = steps || STEPS;
    const version = input.schemaVersion;
    if (!Number.isInteger(version) || version < 1) {
      return { error: "The file has no valid schemaVersion." };
    }
    if (version > schema.SCHEMA_VERSION && !steps) {
      return { error: "This file was saved by a newer BPMVIZ (schema version " + version +
        "). This copy reads version " + schema.SCHEMA_VERSION + "." };
    }
    let current = util.clone(input);
    const notes = [];
    const target = steps ? Math.max(...Object.keys(registry).map(Number), version - 1) + 1 : schema.SCHEMA_VERSION;
    while (current.schemaVersion < target) {
      const step = registry[current.schemaVersion];
      if (!step) return { error: "No upgrade path from schema version " + current.schemaVersion + "." };
      const from = current.schemaVersion;
      current = step(current);
      current.schemaVersion = from + 1;
      notes.push("Upgraded from schema version " + from + " to " + (from + 1) + ".");
    }
    return { engagement: current, notes };
  }

  return { STEPS, migrateEngagement };
});
