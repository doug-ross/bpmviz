/*
 * BPMVIZ mining: Aggregates an event log into a dataset.
 * Owned by the event-log import feature (mining slice); see docs/extensions.md. The foundation ships
 * this empty module so index.htm and the Node tests can load it already.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else { const B = root.BPMVIZ = root.BPMVIZ || {}; B.mining = factory(); }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  return {};
});
