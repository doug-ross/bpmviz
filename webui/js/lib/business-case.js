/*
 * BPMVIZ business-case: One-page business cases and wave planning.
 * Owned by the value case and business case feature (value slice); see docs/extensions.md. The foundation ships
 * this empty module so index.htm and the Node tests can load it already.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else { const B = root.BPMVIZ = root.BPMVIZ || {}; B.businessCase = factory(); }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  return {};
});
