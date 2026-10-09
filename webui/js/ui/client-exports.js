/*
 * BPMVIZ client-exports: The Export for client tools dialog.
 * Owned by the client tool exports feature (exports slice); see docs/extensions.md. Features register with
 * BPMVIZ.ext and BPMVIZ.store.registerCommands from this file.
 */
(function (root) {
  "use strict";
  const B = root.BPMVIZ = root.BPMVIZ || {};
  B.clientExports = {};
})(typeof globalThis !== "undefined" ? globalThis : this);
