/*
 * BPMVIZ log-import: The event-log import wizard and the Event logs tab.
 * Owned by the event-log import feature (mining slice); see docs/extensions.md. Features register with
 * BPMVIZ.ext and BPMVIZ.store.registerCommands from this file.
 */
(function (root) {
  "use strict";
  const B = root.BPMVIZ = root.BPMVIZ || {};
  B.logImport = {};
})(typeof globalThis !== "undefined" ? globalThis : this);
