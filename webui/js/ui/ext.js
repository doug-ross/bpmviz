/*
 * AIxRay ext: the registry that feature modules use to add menu items,
 * tabs, sections, modes and file handlers to the app without editing the
 * shared views. docs/extensions.md lists every seam and who owns what.
 *
 * Each registration is an object with an id (letters, digits, - and _) and
 * an optional order (default 0; lower comes first, ties keep the order of
 * registration). A duplicate id within one kind throws. Registrations can
 * happen at any time: the views read the registry each time they render.
 *
 * The registry itself has no DOM access, so it also loads in Node tests.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else { const B = root.AIxRay = root.AIxRay || {}; B.ext = factory(); }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,60}$/;
  const kinds = new Map();
  let seq = 0;

  const isFn = v => typeof v === "function";
  const MENU_GROUPS = ["import", "export", "ai"];
  const HANDOFF_ANCHORS = ["summary", "scope", "pain", "opportunity", "decision", "action", "question", "value", "evidence", "end"];
  const DRAWER_PLACES = ["overview", "step"];
  const RESERVED = {
    recordsTab: ["records", "opportunities", "evidence", "review"],
    opportunityView: ["register"],
    presentMode: ["presenter", "handoff"]
  };

  /* What each kind needs, checked at registration so mistakes show up early. */
  const RULES = {
    menuItem: d => isFn(d.run) && typeof d.label === "string" && MENU_GROUPS.includes(d.group) || "needs label, run(app) and group import, export or ai",
    startAction: d => isFn(d.run) && typeof d.label === "string" || "needs label and run(app)",
    fileHandler: d => isFn(d.open) && Array.isArray(d.extensions) && d.extensions.length > 0 && (d.probe === undefined || isFn(d.probe)) || "needs extensions, open(app, file, bytes) and an optional probe(bytes, name)",
    jsonHandler: d => isFn(d.open) && typeof d.schema === "string" && d.schema.length > 0 || "needs schema and open(app, data, info)",
    recordsTab: d => isFn(d.render) && typeof d.label === "string" || "needs label, render(panel, ctx) and an optional count(engagement)",
    opportunityView: d => isFn(d.render) && typeof d.label === "string" || "needs label and render(host, ctx)",
    opportunityColumn: d => isFn(d.cell) && typeof d.header === "string" || "needs header and cell(record, ctx)",
    recordDialogSection: d => isFn(d.render) || "needs render(record, ctx) returning { el, collect, check }",
    valueSection: d => isFn(d.render) || "needs render(ctx)",
    presentMode: d => isFn(d.render) && typeof d.label === "string" || "needs label and render(content, ctx)",
    presentAction: d => isFn(d.run) && typeof d.label === "string" || "needs label and run(app, ctx)",
    handoffSection: d => isFn(d.render) && HANDOFF_ANCHORS.includes(d.after) || "needs render(hd, ctx) and after: " + HANDOFF_ANCHORS.join(", "),
    drawerSection: d => isFn(d.render) && DRAWER_PLACES.includes(d.where) || "needs render(ctx, model, node) and where: overview or step"
  };

  function register(kind, def) {
    if (!def || typeof def !== "object") throw new TypeError(kind + ": a registration object is required.");
    if (typeof def.id !== "string" || !ID.test(def.id)) throw new TypeError(kind + ": the id must be 1 to 61 letters, digits, - or _.");
    const ok = RULES[kind](def);
    if (ok !== true) throw new TypeError(kind + " " + def.id + " " + ok + ".");
    if ((RESERVED[kind] || []).includes(def.id)) throw new Error(kind + " id " + def.id + " is used by the app.");
    const list = kinds.get(kind) || [];
    if (list.some(x => x.def.id === def.id)) throw new Error(kind + " " + def.id + " is already registered.");
    list.push({ def: Object.assign({}, def, { order: Number.isFinite(def.order) ? def.order : 0 }), seq: seq++ });
    kinds.set(kind, list);
    return list[list.length - 1].def;
  }

  /** Registrations of one kind, sorted by order. */
  function list(kind) {
    return (kinds.get(kind) || []).slice().sort((a, b) => a.def.order - b.def.order || a.seq - b.seq).map(x => x.def);
  }

  function unregister(kind, id) {
    const items = kinds.get(kind) || [];
    const next = items.filter(x => x.def.id !== id);
    kinds.set(kind, next);
    return next.length !== items.length;
  }

  /* Store events that rebuild the process canvas, and prefixes that refresh lenses and the side panel. */
  const structural = new Set();
  const refresh = new Set();

  function eventName(v) {
    if (typeof v !== "string" || !/^[a-z][A-Za-z-]*\/([A-Za-z][A-Za-z-]*)?$/.test(v)) throw new TypeError("Event names look like area/verb, or area/ for a prefix: " + v);
    return v;
  }

  function matches(set, type) {
    if (typeof type !== "string") return false;
    for (const v of set) {
      if (v.endsWith("/") ? type.startsWith(v) : type === v) return true;
    }
    return false;
  }

  function registerStructuralEvent(typeOrPrefix) { structural.add(eventName(typeOrPrefix)); }
  function registerRefreshEvent(prefix) {
    if (typeof prefix !== "string" || !prefix.endsWith("/")) throw new TypeError("A refresh prefix ends with a slash, such as dataset/.");
    refresh.add(eventName(prefix));
  }

  ["dataset/import", "dataset/delete", "review/apply"].forEach(registerStructuralEvent);
  ["dataset/", "review/", "opportunity/"].forEach(registerRefreshEvent);

  /** File extensions as ".ext", lowercase. */
  function normalizeExtensions(list) {
    return list.map(x => String(x).trim().toLowerCase()).filter(Boolean).map(x => (x.startsWith(".") ? x : "." + x));
  }

  function registerFileHandler(def) {
    const out = register("fileHandler", Object.assign({}, def, {
      extensions: Array.isArray(def && def.extensions) ? normalizeExtensions(def.extensions) : def && def.extensions,
      priority: def && Number.isFinite(def.priority) ? def.priority : 0,
      maxBytes: def && Number.isFinite(def.maxBytes) && def.maxBytes > 0 ? def.maxBytes : 10 * 1024 * 1024
    }));
    return out;
  }

  /** File handlers for a file name, highest priority first. */
  function fileHandlersFor(name) {
    const m = /\.[^./\\]+$/.exec(String(name || "").toLowerCase());
    if (!m) return [];
    return list("fileHandler").filter(h => h.extensions.includes(m[0]))
      .map((h, i) => ({ h, i })).sort((a, b) => b.h.priority - a.h.priority || a.i - b.i).map(x => x.h);
  }

  function extraExtensions() {
    return [...new Set(list("fileHandler").flatMap(h => h.extensions))];
  }

  /**
   * The context every render and run receives:
   * { app, engagement, dispatch, includeSensitive, includeUnreviewedAi, scenarioId, rerender }.
   */
  function context(app, extra) {
    const x = extra || {};
    return Object.assign({
      app,
      engagement: app && app.store ? app.store.get() : null,
      dispatch: (type, payload, message, errEl) => app.dispatch(type, payload, message, errEl),
      includeSensitive: false,
      includeUnreviewedAi: false,
      scenarioId: app && app.view ? app.view.scenarioId || "" : "",
      rerender: () => {}
    }, x);
  }

  /*
   * Runs one registered callback. A failure is reported on the console and
   * returns fallback, so one broken feature does not take the view down.
   */
  function guard(kind, def, fn, fallback) {
    try {
      return fn();
    } catch (err) {
      if (typeof console !== "undefined") console.error("AIxRay " + kind + " " + (def && def.id) + " failed:", err);
      return fallback === undefined ? null : fallback;
    }
  }

  return {
    registerMenuItem: d => register("menuItem", d),
    registerStartAction: d => register("startAction", d),
    registerFileHandler,
    registerJsonHandler: d => register("jsonHandler", d),
    registerRecordsTab: d => register("recordsTab", d),
    registerOpportunityView: d => register("opportunityView", d),
    registerOpportunityColumn: d => register("opportunityColumn", d),
    registerRecordDialogSection: d => register("recordDialogSection", Object.assign({}, d, { kinds: Array.isArray(d && d.kinds) && d.kinds.length ? d.kinds.slice() : ["opportunity"] })),
    registerValueSection: d => register("valueSection", d),
    registerPresentMode: d => register("presentMode", Object.assign({}, d, { printable: !!(d && d.printable) })),
    registerPresentAction: d => register("presentAction", d),
    registerHandoffSection: d => register("handoffSection", d),
    registerDrawerSection: d => register("drawerSection", d),
    registerStructuralEvent, registerRefreshEvent,
    isStructural: type => matches(structural, type),
    isRefresh: type => matches(refresh, type),
    list, unregister, fileHandlersFor, extraExtensions, context, guard,
    MENU_GROUPS, HANDOFF_ANCHORS, DRAWER_PLACES
  };
});
