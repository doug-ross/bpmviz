// The extension registry (webui/js/ui/ext.js) and store.registerCommands:
// the seams feature modules use instead of editing shared files.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { lib, root, tinyEngagement } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const ext = require(path.join(root, "webui", "js", "ui", "ext.js"));
const storeLib = lib("store");
const { validateEngagement } = lib("validate");

const noop = () => {};

test("registrations sort by order, then by registration", () => {
  ext.registerValueSection({ id: "t-late", order: 50, render: noop });
  ext.registerValueSection({ id: "t-early", order: -5, render: noop });
  ext.registerValueSection({ id: "t-default", render: noop });
  ext.registerValueSection({ id: "t-default-2", render: noop });
  assert.deepEqual(ext.list("valueSection").map(x => x.id).filter(id => id.startsWith("t-")), ["t-early", "t-default", "t-default-2", "t-late"]);
  ["t-late", "t-early", "t-default", "t-default-2"].forEach(id => assert.equal(ext.unregister("valueSection", id), true));
  assert.deepEqual(ext.list("valueSection").filter(x => x.id.startsWith("t-")), []);
});

test("duplicate, reserved and malformed registrations throw", () => {
  ext.registerRecordsTab({ id: "t-tab", label: "Test", render: noop });
  assert.throws(() => ext.registerRecordsTab({ id: "t-tab", label: "Again", render: noop }), /already registered/);
  assert.throws(() => ext.registerRecordsTab({ id: "review", label: "Clash", render: noop }), /used by the app/);
  assert.throws(() => ext.registerPresentMode({ id: "handoff", label: "Clash", render: noop }), /used by the app/);
  assert.throws(() => ext.registerOpportunityView({ id: "register", label: "Clash", render: noop }), /used by the app/);
  assert.throws(() => ext.registerRecordsTab({ id: "has space", label: "x", render: noop }), TypeError);
  assert.throws(() => ext.registerRecordsTab({ id: "t-no-render", label: "x" }), TypeError);
  assert.throws(() => ext.registerMenuItem({ id: "t-menu", label: "x", group: "tools", run: noop }), TypeError);
  assert.throws(() => ext.registerHandoffSection({ id: "t-hand", after: "middle", render: noop }), TypeError);
  assert.throws(() => ext.registerDrawerSection({ id: "t-drawer", where: "footer", render: noop }), TypeError);
  assert.throws(() => ext.registerFileHandler({ id: "t-file", extensions: [], open: noop }), TypeError);
  assert.throws(() => ext.registerJsonHandler({ id: "t-json", open: noop }), TypeError);
  // The same id in another kind is fine.
  ext.registerOpportunityView({ id: "t-tab", label: "Test", render: noop });
  ext.unregister("recordsTab", "t-tab");
  ext.unregister("opportunityView", "t-tab");
});

test("every documented kind registers and lists", () => {
  const made = [
    ["menuItem", () => ext.registerMenuItem({ id: "t-k", label: "x", group: "export", run: noop })],
    ["startAction", () => ext.registerStartAction({ id: "t-k", label: "x", run: noop })],
    ["jsonHandler", () => ext.registerJsonHandler({ id: "t-k", schema: "aixray.test", open: noop })],
    ["recordsTab", () => ext.registerRecordsTab({ id: "t-k", label: "x", render: noop })],
    ["opportunityView", () => ext.registerOpportunityView({ id: "t-k", label: "x", render: noop })],
    ["opportunityColumn", () => ext.registerOpportunityColumn({ id: "t-k", header: "x", after: "Effort", cell: noop })],
    ["recordDialogSection", () => ext.registerRecordDialogSection({ id: "t-k", render: noop })],
    ["valueSection", () => ext.registerValueSection({ id: "t-k", render: noop })],
    ["presentMode", () => ext.registerPresentMode({ id: "t-k", label: "x", render: noop })],
    ["presentAction", () => ext.registerPresentAction({ id: "t-k", label: "x", run: noop })],
    ["handoffSection", () => ext.registerHandoffSection({ id: "t-k", after: "end", render: noop })],
    ["drawerSection", () => ext.registerDrawerSection({ id: "t-k", where: "step", render: noop })]
  ];
  made.forEach(([kind, make]) => {
    const def = make();
    assert.equal(def.order, 0, kind);
    assert.ok(ext.list(kind).some(x => x.id === "t-k"), kind);
    ext.unregister(kind, "t-k");
  });
  const section = ext.registerRecordDialogSection({ id: "t-k2", render: noop });
  assert.deepEqual(section.kinds, ["opportunity"], "record dialog sections default to opportunities");
  ext.unregister("recordDialogSection", "t-k2");
  const mode = ext.registerPresentMode({ id: "t-k3", label: "x", render: noop, printable: 1 });
  assert.equal(mode.printable, true);
  ext.unregister("presentMode", "t-k3");
});

test("file handlers are matched by extension, highest priority first", () => {
  ext.registerFileHandler({ id: "t-sheet-low", extensions: ["XLSX", "csv"], open: noop });
  ext.registerFileHandler({ id: "t-sheet-high", extensions: [".xlsx"], priority: 10, maxBytes: 1024, probe: async () => true, open: noop });
  assert.deepEqual(ext.fileHandlersFor("Log.XLSX").map(h => h.id), ["t-sheet-high", "t-sheet-low"]);
  assert.deepEqual(ext.fileHandlersFor("events.csv").map(h => h.id), ["t-sheet-low"]);
  assert.deepEqual(ext.fileHandlersFor("engagement.json").map(h => h.id), []);
  assert.deepEqual(ext.fileHandlersFor("no-extension").map(h => h.id), []);
  const low = ext.list("fileHandler").find(h => h.id === "t-sheet-low");
  assert.deepEqual(low.extensions, [".xlsx", ".csv"]);
  assert.equal(low.maxBytes, 10 * 1024 * 1024);
  assert.equal(low.priority, 0);
  assert.ok(ext.extraExtensions().includes(".csv"));
  ext.unregister("fileHandler", "t-sheet-low");
  ext.unregister("fileHandler", "t-sheet-high");
});

test("structural and refresh events are pre-registered and extendable", () => {
  ["dataset/import", "dataset/delete", "review/apply"].forEach(t => assert.equal(ext.isStructural(t), true, t));
  assert.equal(ext.isStructural("dataset/update"), false);
  ["dataset/update", "review/recordPack", "opportunity/setWaves"].forEach(t => assert.equal(ext.isRefresh(t), true, t));
  assert.equal(ext.isRefresh("record/update"), false);
  ext.registerStructuralEvent("benefits/");
  assert.equal(ext.isStructural("benefits/anything"), true);
  assert.throws(() => ext.registerRefreshEvent("no-slash"), TypeError);
  assert.throws(() => ext.registerStructuralEvent("Bad Name"), TypeError);
});

test("the common context and the guard", () => {
  const calls = [];
  const app = { store: { get: () => ({ id: "eng-x" }) }, view: { scenarioId: "sc-1" }, dispatch: (...a) => { calls.push(a); return true; } };
  const ctx = ext.context(app, { includeSensitive: true });
  assert.equal(ctx.app, app);
  assert.equal(ctx.engagement.id, "eng-x");
  assert.equal(ctx.scenarioId, "sc-1");
  assert.equal(ctx.includeSensitive, true);
  assert.equal(ctx.includeUnreviewedAi, false);
  assert.equal(typeof ctx.rerender, "function");
  ctx.dispatch("record/add", { record: {} }, "Added");
  assert.deepEqual(calls[0].slice(0, 3), ["record/add", { record: {} }, "Added"]);
  const errors = [];
  const original = console.error;
  console.error = (...a) => errors.push(a);
  try {
    assert.equal(ext.guard("valueSection", { id: "t-bad" }, () => { throw new Error("boom"); }, "fallback"), "fallback");
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 1);
  assert.equal(ext.guard("valueSection", { id: "t-ok" }, () => 42), 42);
});

test("registerCommands adds undoable commands and refuses duplicates", () => {
  const names = storeLib.registerCommands({
    "test/rename"(e, p) {
      const { findModel, cleanText, StoreError } = storeLib.helpers;
      const m = findModel(e, p.modelId);
      const name = cleanText(p.name, 200).trim();
      if (!name) throw new StoreError("invalid", "A name is required.");
      m.name = name;
      return { modelId: m.id };
    }
  });
  assert.deepEqual(names, ["test/rename"]);
  assert.throws(() => storeLib.registerCommands({ "test/rename"() {} }), /already registered/);
  assert.throws(() => storeLib.registerCommands({ "record/add"() {} }), /already registered/);
  assert.throws(() => storeLib.registerCommands({ "Bad name"() {} }), TypeError);
  assert.throws(() => storeLib.registerCommands({ "test/x": 42 }), TypeError);
  assert.throws(() => storeLib.registerCommands(null), TypeError);
  const store = storeLib.createStore(validateEngagement(tinyEngagement()).engagement);
  store.dispatch("test/rename", { modelId: "m-current", name: "Renamed" });
  assert.equal(store.get().models[0].name, "Renamed");
  assert.equal(store.get().revision, 1);
  assert.throws(() => store.dispatch("test/rename", { modelId: "m-current", name: " " }), storeLib.StoreError);
  store.undo();
  assert.equal(store.get().models[0].name, "Current state");
  delete storeLib.COMMANDS["test/rename"];
});

test("store helpers are exported for feature commands", () => {
  const h = storeLib.helpers;
  ["findModel", "findNode", "editableModel", "applyNodePatch", "newRecord", "cleanText", "enumValue", "StoreError"].forEach(k => assert.equal(typeof h[k], "function", k));
  const e = validateEngagement(tinyEngagement()).engagement;
  assert.throws(() => h.findModel(e, "nope"), err => err.code === "not-found");
  assert.equal(h.enumValue("wave", "now", ""), "now");
  assert.equal(h.enumValue("wave", "soon", ""), "");
  const r = h.newRecord(e, { kind: "opportunity", title: "x", opportunity: { wave: "later" } });
  assert.equal(r.opportunity.wave, "later");
});
