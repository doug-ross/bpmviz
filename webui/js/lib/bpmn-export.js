/*
 * BPMVIZ bpmn-export: BPMN 2.0 XML export.
 * Owned by the client tool exports feature (exports slice); see docs/extensions.md. The foundation ships
 * this empty module so index.htm and the Node tests can load it already.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else { const B = root.BPMVIZ = root.BPMVIZ || {}; B.bpmnExport = factory(); }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  return {};
});
