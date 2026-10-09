/*
 * BPMVIZ client-review: Making review packs and importing responses.
 * Owned by the client review feature (review slice); see docs/extensions.md. Features register with
 * BPMVIZ.ext and BPMVIZ.store.registerCommands from this file.
 */
(function (root) {
  "use strict";
  const B = root.BPMVIZ = root.BPMVIZ || {};
  B.clientReview = {};
})(typeof globalThis !== "undefined" ? globalThis : this);
