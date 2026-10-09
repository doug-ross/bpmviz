/*
 * BPMVIZ application shell: engagement lifecycle (open, new, save, recover),
 * workspaces, header state, menus and global shortcuts.
 */
(function (root) {
  "use strict";
  const B = root.BPMVIZ;
  const { h, s, clear, icon, iconButton, announce, isTypingTarget, downloadBlob, formatTime, formatDate } = B.dom;
  const { schema, units, validate, exporting, persistence, store: storeLib } = B;
  const { openDialog, choose, confirmDialog, messageDialog, issueList } = B.dialogs;

  const VERSION = "0.1.0";
  const DATA_TONE = { demonstration: "warning", supplied: "info", observed: "success" };
  const SAIL = "M1885 0 1884.68 1220.02C1884.55 1641.18 1579.64 2000.43 1164.04 2069.01L219 2225 219 0 1885 0Z";

  function safeStorage() {
    try {
      const ls = root.localStorage;
      ls.getItem("bpmviz:probe");
      return ls;
    } catch (_) {
      return null;
    }
  }

  const app = {
    store: null,
    view: { display: "", scenarioId: "", t: 0, playing: false, speed: 1, lens: "none", selected: null, drawerTab: "summary", panelOpen: true, labels: true },
    workspace: "start",
    savedRevision: null,
    fileName: null,
    fileHandle: null,
    exampleId: null,
    drafts: persistence.createDraftStore(safeStorage()),
    lastDraft: null,
    storageProblem: null,
    loadInfo: null
  };
  root.BPMVIZ.app = app;
  const el = {};

  /* ---------------- Shell ---------------- */

  function sail(cls) {
    return s("svg", { class: cls, viewBox: "219 0 1666 2225", "aria-hidden": "true", focusable: "false" }, s("path", { d: SAIL, fill: "#0070AD" }));
  }

  function buildShell() {
    el.dataBadge = h("span", { class: "badge", id: "data-status" });
    el.saveState = h("span", { class: "save-state", id: "save-state", role: "status" });
    el.ctxEyebrow = h("div", { class: "context-eyebrow", id: "ctx-eyebrow" });
    el.ctxTitle = h("h1", { class: "context-title", id: "ctx-title" }, "BPMVIZ");
    el.btnNew = iconButton("filePlus", "New", { id: "btn-new" }, { showLabel: true, title: "New engagement" });
    el.btnOpen = iconButton("open", "Open", { id: "btn-open" }, { showLabel: true, title: "Open an engagement, BPMN or AI draft file (Ctrl+O)" });
    el.btnSave = iconButton("save", "Save", { id: "btn-save" }, { showLabel: true, variant: "btn-primary", title: "Save the engagement file (Ctrl+S)" });
    el.btnMenu = iconButton("more", "More actions", { id: "btn-menu", "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": "app-menu" });
    el.menu = h("div", { class: "menu-list", id: "app-menu", role: "menu", hidden: true });
    el.header = h("header", { class: "appbar" },
      h("div", { class: "brand" }, sail("brand-mark"), h("span", { class: "brand-name" }, "BPMVIZ")),
      h("div", { class: "context" }, el.ctxEyebrow, el.ctxTitle),
      h("div", { class: "appbar-status" }, el.dataBadge, el.saveState),
      h("div", { class: "appbar-actions" }, el.btnNew, el.btnOpen, el.btnSave, h("div", { class: "menu" }, el.btnMenu, el.menu)));
    el.tabs = h("nav", { class: "tabs", role: "tablist", "aria-label": "Workspaces" });
    el.revision = h("span", { class: "tabs-end", id: "revision" });
    el.main = h("main", { class: "workspace", id: "main", tabindex: -1 });
    el.footConf = h("span", { id: "foot-conf" });
    el.footDisc = h("span", { id: "foot-disc" });
    el.foot = h("footer", { class: "appfoot" }, el.footConf, el.footDisc, h("span", { class: "spacer" }),
      h("span", null, "BPMVIZ " + VERSION + " \u00b7 Press ", h("span", { class: "kbd" }, "?"), " for help"));
    el.fileInput = h("input", { type: "file", id: "file-input", accept: BASE_ACCEPT, hidden: true });

    app.processView = B.processView.createProcessView(app);
    app.recordsView = B.recordsView.createRecordsView(app);
    app.valueView = B.valueView.createValueView(app);
    app.presentView = B.presentView.createPresentView(app);
    el.panels = {
      start: h("section", { class: "ws-panel", id: "ws-start", "aria-label": "Start" }),
      process: h("section", { class: "ws-panel", id: "ws-process", role: "tabpanel", "aria-labelledby": "tab-process", hidden: true }, app.processView.build()),
      records: h("section", { class: "ws-panel", id: "ws-records", role: "tabpanel", "aria-labelledby": "tab-records", hidden: true }, app.recordsView.build()),
      value: h("section", { class: "ws-panel", id: "ws-value", role: "tabpanel", "aria-labelledby": "tab-value", hidden: true }, app.valueView.build()),
      present: h("section", { class: "ws-panel", id: "ws-present", role: "tabpanel", "aria-labelledby": "tab-present", hidden: true }, app.presentView.build())
    };
    Object.values(el.panels).forEach(p => el.main.appendChild(p));
    const shell = h("div", { class: "app", id: "app" }, el.header, el.tabs, el.main, el.foot);
    document.body.prepend(h("a", { class: "skip-link", href: "#main" }, "Skip to the workspace"), shell);
    document.body.appendChild(el.fileInput);
    buildTabs();
    buildMenu();

    el.btnNew.addEventListener("click", newEngagementDialog);
    el.btnOpen.addEventListener("click", () => openPicker());
    el.btnSave.addEventListener("click", () => save(false));
    el.fileInput.addEventListener("change", () => {
      const file = el.fileInput.files && el.fileInput.files[0];
      el.fileInput.value = "";
      if (file) openFile(file);
    });
    document.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", ev => { if (isDirty()) { ev.preventDefault(); ev.returnValue = ""; } });
    window.addEventListener("hashchange", () => { if (app.suppressHash) return; });
  }

  const TABS = [["process", "Process"], ["records", "Records"], ["value", "Value"], ["present", "Present"]];
  const BASE_ACCEPT = ".json,.bpmn,.xml,application/json,text/xml";

  /* Opens the file picker, accepting the file types that registered features read as well. */
  function openPicker() {
    el.fileInput.accept = [BASE_ACCEPT].concat(B.ext.extraExtensions()).join(",");
    el.fileInput.click();
  }
  app.openPicker = openPicker;

  function buildTabs() {
    clear(el.tabs);
    TABS.forEach(([id, label]) => {
      const t = h("button", { type: "button", class: "tab", role: "tab", id: "tab-" + id, "aria-controls": "ws-" + id, "aria-selected": "false", tabindex: -1 },
        label, id === "records" ? h("span", { class: "count", id: "tab-records-count" }) : null);
      t.addEventListener("click", () => goto(id));
      t.addEventListener("keydown", ev => {
        const i = TABS.findIndex(x => x[0] === id);
        const next = ev.key === "ArrowRight" ? TABS[(i + 1) % TABS.length] : ev.key === "ArrowLeft" ? TABS[(i + TABS.length - 1) % TABS.length] : null;
        if (next) { ev.preventDefault(); goto(next[0]); document.getElementById("tab-" + next[0]).focus(); }
      });
      el.tabs.appendChild(t);
    });
    el.tabs.appendChild(el.revision);
  }

  /* Menu entries. Registered items (BPMVIZ.ext.registerMenuItem) join their group. */
  function menuItems() {
    const group = name => B.ext.list("menuItem").filter(m => m.group === name)
      .map(m => [m.icon || "info", m.label, () => B.ext.guard("menuItem", m, () => m.run(app)), !!m.needsEngagement, null, "menu-" + m.id]);
    return [
      ["settings", "Engagement settings", () => B.forms.settingsDialog(app), true],
      ["undo", "Undo last change", () => undo(), true, "Ctrl+Z"],
      ["save", "Save as a new file", () => save(true), true],
      ...group("export"),
      "-",
      ["upload", "Import a BPMN file", () => openPicker(), false],
      ...group("import"),
      ["list", "Local drafts and recovery", () => draftsDialog(), false],
      B.aiPanel.enabled ? ["agent", "Draft with AI", () => B.aiPanel.chooseTask(app), false] : null,
      ...group("ai"),
      ["trash", "Clear local data", () => clearLocalData(), false],
      "-",
      ["moon", "Switch light or dark theme", () => toggleTheme(), false],
      ["help", "Help and keyboard shortcuts", () => helpDialog(), false, "?"],
      ["info", "About and data handling", () => aboutDialog(), false]
    ].filter(Boolean);
  }

  function fillMenu() {
    clear(el.menu);
    menuItems().forEach(item => {
      if (item === "-") { el.menu.appendChild(h("hr")); return; }
      const [ic, label, fn, needsEngagement, kbd, id] = item;
      const b = h("button", { type: "button", role: "menuitem", tabindex: -1, id: id || null, dataset: { needs: needsEngagement ? "1" : "" } }, icon(ic), label, kbd ? h("span", { class: "kbd" }, kbd) : null);
      b.addEventListener("click", () => { closeMenu(); fn(); });
      el.menu.appendChild(b);
    });
  }

  function buildMenu() {
    fillMenu();
    el.btnMenu.addEventListener("click", () => (el.menu.hidden ? openMenu() : closeMenu()));
    el.menu.addEventListener("keydown", ev => {
      const buttons = [...el.menu.querySelectorAll("button:not([disabled])")];
      const i = buttons.indexOf(document.activeElement);
      if (ev.key === "ArrowDown") { ev.preventDefault(); buttons[(i + 1) % buttons.length].focus(); }
      else if (ev.key === "ArrowUp") { ev.preventDefault(); buttons[(i + buttons.length - 1) % buttons.length].focus(); }
      else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); closeMenu(); el.btnMenu.focus(); }
      else if (ev.key === "Tab") closeMenu();
    });
    document.addEventListener("pointerdown", ev => { if (!el.menu.hidden && !ev.target.closest(".menu")) closeMenu(); });
  }

  function openMenu() {
    fillMenu();
    el.menu.querySelectorAll("button").forEach(b => { b.disabled = b.dataset.needs === "1" && !app.store; });
    el.menu.hidden = false;
    el.btnMenu.setAttribute("aria-expanded", "true");
    const first = el.menu.querySelector("button:not([disabled])");
    if (first) first.focus();
  }

  function closeMenu() {
    el.menu.hidden = true;
    el.btnMenu.setAttribute("aria-expanded", "false");
  }

  /* ---------------- Header state ---------------- */

  function isDirty() {
    return !!app.store && app.store.get().revision !== app.savedRevision;
  }

  function updateHeader() {
    const has = !!app.store;
    el.tabs.hidden = !has;
    el.btnSave.disabled = !has;
    el.dataBadge.hidden = !has;
    if (!has) {
      el.ctxEyebrow.textContent = "Process workshop workbench";
      el.ctxTitle.textContent = "BPMVIZ";
      el.saveState.textContent = "";
      el.footConf.textContent = "";
      el.footDisc.textContent = app.storageProblem ? "Local drafts are off in this browser. Save engagement files to keep your work." : "";
      document.title = "BPMVIZ";
      return;
    }
    const e = app.store.get();
    const m = e.meta;
    el.ctxEyebrow.textContent = [m.clientDisplayName, m.engagementName].filter(Boolean).join(" \u00b7 ") || "Engagement";
    el.ctxTitle.textContent = m.processName;
    el.dataBadge.textContent = schema.label("dataStatus", m.dataStatus);
    el.dataBadge.className = "badge " + (DATA_TONE[m.dataStatus] || "");
    el.dataBadge.title = m.dataStatus === "demonstration" ? "Sample content for demonstration. Not client data and not live." :
      m.dataStatus === "observed" ? "Figures observed from the client's process." : "Scenario content supplied for the engagement; figures are not independently validated.";
    el.revision.textContent = "Revision " + e.revision;
    el.footConf.textContent = schema.label("confidentiality", m.confidentiality);
    el.footDisc.textContent = m.disclosure ? " \u00b7 " + (m.disclosure.length > 140 ? m.disclosure.slice(0, 139) + "..." : m.disclosure) : "";
    document.title = m.processName + " \u00b7 BPMVIZ";
    const count = document.getElementById("tab-records-count");
    if (count) count.textContent = String(e.records.length);
    updateSaveState();
  }

  function updateSaveState() {
    if (!app.store) return;
    const dirty = isDirty();
    let text, cls = "save-state";
    if (!dirty) {
      text = app.exampleId && !app.fileName ? "Bundled example, not modified" : "Saved to file" + (app.fileName ? ": " + app.fileName : "");
    } else {
      text = "Unsaved changes.";
      cls += " dirty";
      if (app.lastDraft && app.lastDraft.ok) text += " Draft kept in this browser at " + formatTime(app.lastDraft.savedAt) + ".";
      else if (app.storageProblem || (app.lastDraft && !app.lastDraft.ok)) {
        text += " " + ((app.lastDraft && app.lastDraft.message) || "Browser storage is not available.") + " Save to a file.";
        cls += " problem";
      }
    }
    el.saveState.textContent = text;
    el.saveState.className = cls;
  }

  const autosave = B.util.debounce(() => {
    if (!app.store || !isDirty()) return;
    app.lastDraft = app.drafts.saveDraft(app.store.get());
    if (!app.lastDraft.ok) app.storageProblem = app.lastDraft.reason;
    updateSaveState();
  }, 700);

  /* ---------------- Workspaces ---------------- */

  function goto(ws) {
    if (!app.store && ws !== "start") ws = "start";
    app.workspace = ws;
    Object.keys(el.panels).forEach(k => { el.panels[k].hidden = k !== ws; });
    TABS.forEach(([id]) => {
      const t = document.getElementById("tab-" + id);
      if (!t) return;
      t.setAttribute("aria-selected", String(id === ws));
      t.tabIndex = id === ws ? 0 : -1;
    });
    if (ws === "process") app.processView.activate();
    else if (ws === "records") app.recordsView.render();
    else if (ws === "value") app.valueView.render();
    else if (ws === "present") app.presentView.render();
    else if (ws === "start") renderStart();
    if (ws !== "process" && app.view.playing) app.processView.setPlaying(false);
    syncHash();
  }

  function gotoStep(modelId, nodeId) {
    const shown = app.processView.displayedModels().map(m => m.id);
    if (!shown.includes(modelId)) app.view.display = "m:" + modelId;
    goto("process");
    requestAnimationFrame(() => app.processView.selectNode(modelId, nodeId, { center: true, focusDrawer: true }));
  }

  function syncHash() {
    const params = new URLSearchParams();
    if (app.exampleId) params.set("example", app.exampleId);
    if (app.store) {
      params.set("ws", app.workspace);
      if (app.view.scenarioId) params.set("scenario", app.view.scenarioId);
      if (app.view.display && !/^m:m-current$/.test(app.view.display)) params.set("view", app.view.display);
    }
    const hash = params.toString();
    try { history.replaceState(null, "", hash ? "#" + hash : location.pathname + location.search); } catch (_) { /* file URLs in some browsers */ }
  }
  app.syncHash = syncHash;

  function parseHash() {
    const p = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
    return { example: p.get("example"), ws: p.get("ws"), scenario: p.get("scenario"), view: p.get("view") };
  }

  /* ---------------- Engagement lifecycle ---------------- */

  function loadEngagement(engagement, info) {
    const meta = info || {};
    const e = engagement;
    const current = e.models.find(m => m.role === "current") || e.models[0];
    Object.assign(app.view, {
      display: meta.view && /^[mc]:/.test(meta.view) ? meta.view : "m:" + current.id,
      scenarioId: meta.scenario && e.scenarios.some(x => x.id === meta.scenario) ? meta.scenario : (e.scenarios[0] ? e.scenarios[0].id : ""),
      t: 0, playing: false, selected: null, drawerTab: "summary", lens: "none",
      panelOpen: !window.matchMedia("(max-width: 1180px)").matches
    });
    app.savedRevision = meta.savedRevision === undefined ? e.revision : meta.savedRevision;
    app.fileName = meta.fileName || null;
    app.fileHandle = meta.fileHandle || null;
    app.exampleId = meta.exampleId || null;
    app.lastDraft = null;
    app.reviewCache = null;
    app.loadInfo = { warnings: meta.warnings || [], source: meta.source || "" };
    if (!app.store) {
      app.store = storeLib.createStore(e);
      app.store.subscribe(onStoreChange);
      onStoreChange(e, { type: "replace" });
    } else {
      app.store.replace(e, meta.source);
    }
    goto(meta.ws && TABS.some(t => t[0] === meta.ws) ? meta.ws : "process");
    announce("Opened " + e.meta.processName + ".");
  }

  function onStoreChange(state, event) {
    app.reviewCache = null;
    updateHeader();
    if (event.type !== "replace") autosave();
    app.processView.onEngagementChange(event);
    if (app.workspace === "records") app.recordsView.render();
    if (app.workspace === "value") app.valueView.render();
    if (app.workspace === "present") app.presentView.render();
  }

  function dispatch(type, payload, message, errEl) {
    try {
      app.store.dispatch(type, payload);
      if (errEl) errEl.hidden = true;
      if (message) announce(message);
      return true;
    } catch (err) {
      const text = err instanceof storeLib.StoreError ? err.message : "That change could not be made: " + (err && err.message ? err.message : err);
      if (errEl) { errEl.hidden = false; errEl.textContent = text; }
      else messageDialog("Change not made", text);
      if (!(err instanceof storeLib.StoreError)) console.error(err);
      return false;
    }
  }
  app.dispatch = dispatch;

  function undo() {
    if (!app.store || !app.store.canUndo()) { announce("Nothing to undo."); return; }
    app.store.undo();
    announce("Last change undone.");
  }

  /** Resolves true when it is fine to replace the open engagement. */
  function guardUnsaved(what) {
    if (!isDirty()) return Promise.resolve(true);
    const draftNote = app.lastDraft && app.lastDraft.ok ? "A draft is kept in this browser, but a saved file is the portable copy." :
      "Browser storage did not keep a draft, so these changes exist only on this page.";
    return choose({
      title: "Save your changes first?",
      body: h("div", null, h("p", null, "The open engagement has changes that are not saved to a file. " + draftNote), h("p", { class: "small muted" }, "Continuing will " + what + ".")),
      actions: [
        { label: "Cancel", value: "cancel" },
        { label: "Discard and continue", value: "discard", variant: "btn-danger" },
        { label: "Save first", value: "save", variant: "btn-primary", autofocus: true }
      ]
    }).then(v => {
      if (v === "discard") return true;
      if (v === "save") return save(false);
      return false;
    });
  }

  function openExample(example, params) {
    const result = validate.validateEngagement(example.engagement);
    if (!result.ok) { messageDialog("Example could not be opened", issueList(result.errors)); return; }
    loadEngagement(result.engagement, Object.assign({ exampleId: example.id, warnings: result.warnings, source: "example" }, params || {}));
  }

  function openExampleGuarded(example, params) {
    const draft = app.drafts.loadDraft(example.engagement.id);
    const proceed = () => guardUnsaved("close the open engagement").then(ok => { if (ok) openExample(example, params); });
    if (draft && draft.revision !== example.engagement.revision) {
      choose({
        title: "Restore your draft?",
        body: h("p", null, "This browser has a draft of \"" + example.title + "\" with changes from " + formatDate(draft.savedAt) + " (revision " + draft.revision + ")."),
        actions: [{ label: "Cancel", value: "" }, { label: "Open the original example", value: "original" }, { label: "Restore the draft", value: "draft", variant: "btn-primary", autofocus: true }]
      }).then(v => {
        if (v === "draft") guardUnsaved("close the open engagement").then(ok => { if (ok) restoreDraft(example.engagement.id, { exampleId: example.id }); });
        else if (v === "original") proceed();
      });
      return;
    }
    proceed();
  }

  function restoreDraft(id, extra, snapshotIndex) {
    const d = snapshotIndex == null ? app.drafts.loadDraft(id) : app.drafts.loadSnapshot(id, snapshotIndex);
    if (!d) { messageDialog("Draft not found", "The draft is no longer in this browser."); return; }
    const result = validate.validateEngagement(d.engagement);
    if (!result.ok) { messageDialog("The draft could not be restored", issueList(result.errors)); return; }
    loadEngagement(result.engagement, Object.assign({ savedRevision: -1, warnings: result.warnings, source: "draft" }, extra || {}));
    announce("Draft restored. Save it to a file to keep a portable copy.");
  }

  function readFileText(file) {
    return new Promise((resolve, reject) => {
      if (file.size > schema.LIMITS.fileBytes) { reject(new Error("The file is larger than the 10 MB limit.")); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("The file could not be read."));
      reader.readAsText(file);
    });
  }

  /*
   * Registered file handlers (BPMVIZ.ext.registerFileHandler) see the file
   * first, by extension and priority, before the 10 MB text read below.
   * Returns true when a handler took the file.
   */
  async function openWithHandler(file) {
    const handlers = B.ext.fileHandlersFor(file.name);
    if (!handlers.length) return false;
    const fit = handlers.filter(x => file.size <= x.maxBytes);
    if (!fit.length) {
      messageDialog("File not opened", "The file is larger than the " + Math.round(Math.max(...handlers.map(x => x.maxBytes)) / 1048576) + " MB limit for this kind of file.");
      return true;
    }
    let bytes;
    try { bytes = await B.files.readBytes(file, Math.max(...fit.map(x => x.maxBytes))); } catch (err) { messageDialog("File not opened", err.message); return true; }
    for (const handler of fit) {
      let take = true;
      if (handler.probe) {
        try { take = !!(await handler.probe(bytes, file.name)); } catch (err) { console.warn("BPMVIZ fileHandler " + handler.id + " probe failed:", err); take = false; }
      }
      if (!take) continue;
      try {
        await handler.open(app, file, bytes);
      } catch (err) {
        messageDialog("File not opened", h("div", null, h("p", null, (err && err.message) || String(err)), h("p", { class: "small muted" }, "The engagement that was open is unchanged.")));
      }
      return true;
    }
    return false;
  }

  async function openFile(file) {
    if (await openWithHandler(file)) return;
    let text;
    try { text = await readFileText(file); } catch (err) { messageDialog("File not opened", err.message); return; }
    const isXml = /\.(bpmn|xml)$/i.test(file.name) || /^\s*</.test(text);
    let result;
    if (isXml) {
      try {
        const doc = new DOMParser().parseFromString(text, "application/xml");
        const imported = B.bpmn.importDocument(doc, { fileName: file.name });
        result = validate.validateEngagement(imported.engagement);
        if (result.ok) result.warnings = imported.warnings.map(w => Object.assign({ level: "warning" }, w)).concat(result.warnings);
      } catch (err) {
        messageDialog("BPMN file not imported", h("div", null, h("p", null, err.message), h("p", { class: "small muted" }, "The engagement that was open is unchanged.")));
        return;
      }
    } else {
      let data = null;
      try { data = JSON.parse(text); } catch (_) { /* parseEngagementText reports it */ }
      const jsonHandler = data && typeof data.schema === "string" ? B.ext.list("jsonHandler").find(x => x.schema === data.schema) : null;
      if (jsonHandler) {
        try {
          await jsonHandler.open(app, data, { fileName: file.name });
        } catch (err) {
          messageDialog("File not opened", h("div", null, h("p", null, (err && err.message) || String(err)), h("p", { class: "small muted" }, "The engagement that was open is unchanged.")));
        }
        return;
      }
      if (B.aiResults.isAiResult(data)) {
        B.aiPanel.openResult(app, B.aiResults.validateAiResult(data), { fileName: file.name });
        return;
      }
      result = validate.parseEngagementText(text);
    }
    if (!result.ok) {
      messageDialog("This file could not be opened", h("div", null,
        h("p", null, file.name + " has " + result.errors.length + " problem" + (result.errors.length === 1 ? "" : "s") + ". The engagement that was open is unchanged."),
        issueList(result.errors)));
      return;
    }
    const ok = await guardUnsaved("replace the open engagement with " + file.name);
    if (!ok) return;
    loadEngagement(result.engagement, {
      savedRevision: isXml ? -1 : result.engagement.revision, fileName: isXml ? null : file.name,
      warnings: result.warnings, source: isXml ? "bpmn" : "file"
    });
    // Interrupt only for warnings where opening the file changed or dropped
    // something; analysis findings such as unreconciled figures stay in Review.
    const changed = /^(link.|ref.|text.|enum.|membership.conflict|semantic.|unit.|bpmn.|time.basis)/;
    const review = result.warnings.filter(w => w.level !== "info" && changed.test(w.code || ""));
    if (review.length) {
      choose({ title: "Opened with items to review", body: h("div", null,
        h("p", null, file.name + " opened. While reading it, " + review.length + " thing" + (review.length === 1 ? " was" : "s were") + " adjusted or left out. Check them before you rely on the file."),
        issueList(review, 8)),
        actions: [{ label: "Continue", value: "" }, { label: "Review now", value: "review", variant: "btn-primary", autofocus: true }] })
        .then(v => { if (v === "review") { goto("records"); app.recordsView.setTab("review"); } });
    }
  }

  async function save(asNew) {
    if (!app.store) return false;
    const e = app.store.get();
    const text = exporting.engagementToJson(e);
    const suggested = (app.fileName && !asNew) ? app.fileName : exporting.fileBase(e) + ".engagement.json";
    let savedName = suggested;
    if (typeof root.showSaveFilePicker === "function" && !app.forceDownload) {
      try {
        const handle = (!asNew && app.fileHandle) || await root.showSaveFilePicker({
          suggestedName: suggested, types: [{ description: "BPMVIZ engagement", accept: { "application/json": [".json"] } }]
        });
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
        app.fileHandle = handle;
        savedName = handle.name;
      } catch (err) {
        if (err && err.name === "AbortError") return false;
        downloadBlob(new Blob([text], { type: "application/json" }), suggested);
      }
    } else {
      downloadBlob(new Blob([text], { type: "application/json" }), suggested);
    }
    app.fileName = savedName;
    app.savedRevision = e.revision;
    app.exampleId = null;
    syncHash();
    updateSaveState();
    announce("Saved " + savedName + ".");
    return true;
  }
  app.saveAs = () => save(true);

  function cloneBaseline(modelId) {
    const name = h("input", { class: "input", id: "clone-name", value: "Future state draft", maxlength: 200 });
    const err = h("p", { class: "error-text", role: "alert", hidden: true });
    openDialog({
      title: "Start a future-state draft", body: h("div", { class: "form-grid" },
        h("p", { class: "small" }, "The draft starts as a copy of the current state. The current state becomes a locked baseline, and each step in the draft remembers which baseline step it came from, so changes stay traceable when steps are renamed or reordered."),
        h("div", { class: "field" }, h("label", { for: "clone-name" }, "Draft name"), name), err),
      actions: [{ label: "Cancel" }, { label: "Create draft", variant: "btn-primary", keepOpen: true, onClick: api => {
        try {
          const { modelId: id } = app.store.dispatch("model/clone", { sourceModelId: modelId, name: name.value });
          app.view.display = "c:" + id;
          api.close();
          app.processView.onEngagementChange({ type: "model/view" });
          announce("Future-state draft created. The baseline is now locked.");
        } catch (e2) { err.hidden = false; err.textContent = e2.message; }
        return false;
      } }]
    });
  }
  app.cloneBaseline = cloneBaseline;
  app.openFile = openFile;
  app.openRecordDialog = record => B.forms.recordDialog(app, record);
  app.insertStepDialog = (m, n) => B.forms.insertStepDialog(app, m, n);
  app.removeStepDialog = (m, n) => B.forms.removeStepDialog(app, m, n);
  app.goto = goto;
  app.gotoStep = gotoStep;
  app.guardUnsaved = guardUnsaved;
  app.loadEngagement = loadEngagement;

  app.reviewItems = function () {
    if (!app.store) return [];
    const e = app.store.get();
    if (app.reviewCache && app.reviewCache.revision === e.revision) return app.reviewCache.items;
    const r = validate.validateEngagement(e);
    const items = r.warnings.filter(w => w.code !== "fields.ignored").map(w => ({ level: w.level, message: w.message, path: w.path, source: "Validation" }));
    ((e.migration && e.migration.warnings) || []).forEach(w => items.push({
      level: /^(membership\.documented|timing\.scaled|layout\.collision|text\.encoding|field\.role|bpmn\.laneTypes|bpmn\.layout)$/.test(w.code) ? "info" : "warning",
      message: w.message, path: w.path, source: "Conversion from " + (e.migration.sourceFormat || "source")
    }));
    app.reviewCache = { revision: e.revision, items };
    return items;
  };

  function newEngagementDialog() {
    const examples = B.bundledExamples || [];
    const template = h("select", { class: "select", id: "new-template" }, examples.map(x => h("option", { value: x.id }, x.title)));
    const client = h("input", { class: "input", id: "new-client", maxlength: 200 });
    const engName = h("input", { class: "input", id: "new-eng", maxlength: 200 });
    const proc = h("input", { class: "input", id: "new-proc", maxlength: 200 });
    const data = h("select", { class: "select", id: "new-data" }, schema.ENUMS.dataStatus.map(v => h("option", { value: v, selected: v === "supplied" }, schema.label("dataStatus", v))));
    const conf = h("select", { class: "select", id: "new-conf" }, schema.ENUMS.confidentiality.map(v => h("option", { value: v, selected: v === "client-confidential" }, schema.label("confidentiality", v))));
    const sync = () => { const x = examples.find(e => e.id === template.value); if (x) proc.placeholder = x.engagement.meta.processName; };
    template.addEventListener("change", sync); sync();
    openDialog({
      title: "New engagement", body: h("div", { class: "form-grid" },
        h("p", { class: "small" }, "Start from a reviewed template, or import a BPMN file for the current state. Records from the template are not copied."),
        h("div", { class: "field" }, h("label", { for: "new-template" }, "Template"), template),
        h("div", { class: "field-row" },
          h("div", { class: "field" }, h("label", { for: "new-client" }, "Client display name"), client),
          h("div", { class: "field" }, h("label", { for: "new-eng" }, "Engagement name"), engName)),
        h("div", { class: "field" }, h("label", { for: "new-proc" }, "Process name"), proc),
        h("div", { class: "field-row" },
          h("div", { class: "field" }, h("label", { for: "new-data" }, "Data status"), data),
          h("div", { class: "field" }, h("label", { for: "new-conf" }, "Confidentiality"), conf))),
      actions: [
        { label: "Import BPMN instead", onClick: () => { openPicker(); } },
        { label: "Cancel" },
        { label: "Create engagement", variant: "btn-primary", onClick: () => {
          const x = examples.find(e => e.id === template.value);
          if (!x) return;
          guardUnsaved("close the open engagement").then(ok => {
            if (!ok) return;
            const e = B.util.clone(x.engagement);
            const now = B.util.nowIso();
            e.id = B.util.uid("eng"); e.revision = 0; e.createdAt = now; e.updatedAt = now; e.records = [];
            if (client.value.trim()) e.meta.clientDisplayName = client.value.trim();
            if (engName.value.trim()) e.meta.engagementName = engName.value.trim();
            if (proc.value.trim()) e.meta.processName = proc.value.trim();
            e.meta.dataStatus = data.value; e.meta.confidentiality = conf.value;
            const r = validate.validateEngagement(e);
            if (!r.ok) { messageDialog("Engagement not created", issueList(r.errors)); return; }
            loadEngagement(r.engagement, { savedRevision: -1, warnings: r.warnings, source: "template" });
          });
        } }
      ]
    });
  }

  function draftsDialog() {
    const list = app.drafts.listDrafts();
    const body = h("div", null);
    if (!app.drafts.available()) body.appendChild(h("p", null, "Browser storage is not available here, so no drafts are kept. Save engagement files to keep your work."));
    else if (!list.length) body.appendChild(h("p", null, "No drafts are stored in this browser."));
    list.forEach(d => {
      const snaps = app.drafts.listSnapshots(d.id);
      body.appendChild(h("div", { class: "card" },
        h("h3", null, d.processName || d.id), h("p", { class: "small muted" }, (d.clientDisplayName ? d.clientDisplayName + " \u00b7 " : "") + "Revision " + d.revision + ", saved " + formatDate(d.savedAt)),
        h("div", { class: "form-actions", style: { justifyContent: "flex-start" } },
          h("button", { type: "button", class: "btn btn-primary", on: { click: () => { api.close(); guardUnsaved("replace the open engagement").then(ok => { if (ok) restoreDraft(d.id); }); } } }, "Restore"),
          snaps.map(sn => h("button", { type: "button", class: "btn", on: { click: () => { api.close(); guardUnsaved("replace the open engagement").then(ok => { if (ok) restoreDraft(d.id, null, sn.index); }); } } }, "Earlier: revision " + sn.revision + ", " + formatTime(sn.savedAt))),
          h("button", { type: "button", class: "btn btn-danger", on: { click: () => { app.drafts.removeDraft(d.id); api.close(); draftsDialog(); } } }, "Delete"))));
    });
    body.appendChild(h("p", { class: "note" }, "Drafts are a safety net in this browser profile only. They are not encrypted. Save engagement files for anything you need to keep or share."));
    const api = openDialog({ title: "Local drafts and recovery", body, actions: [{ label: "Close", variant: "btn-primary" }] });
  }

  function clearLocalData() {
    confirmDialog("Clear local data?", "Every BPMVIZ draft and recovery snapshot in this browser will be deleted. The open engagement stays open, and saved files are not touched.", "Clear local data", true)
      .then(ok => {
        if (!ok) return;
        const done = app.drafts.clearAll();
        app.lastDraft = null;
        updateSaveState();
        announce(done ? "Local data cleared." : "Local data could not be cleared.");
        if (app.workspace === "start") renderStart();
      });
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
    app.drafts.setPref("theme", next);
    announce(next === "dark" ? "Dark theme." : "Light theme.");
  }

  function helpDialog() {
    const kb = (keys, text) => [h("dt", null, keys.map(k => h("span", { class: "kbd" }, k)).reduce((acc, k, i) => i ? acc.concat([" ", k]) : [k], [])), h("dd", null, text)];
    openDialog({
      title: "Help and keyboard shortcuts", wide: true, body: h("div", null,
        h("div", { class: "help-grid" },
          h("section", null, h("h3", null, "Workspaces"),
            h("dl", null,
              h("dt", null, "Process"), h("dd", null, "The process canvas, scenario replay, lenses and the step panel for inspection, capture and edits."),
              h("dt", null, "Records"), h("dd", null, "Every captured record, the opportunity register, evidence sources and review items."),
              h("dt", null, "Value"), h("dd", null, "Assumptions, formula-backed results and checks of supplied figures."),
              h("dt", null, "Present"), h("dd", null, "Presenter view, the printable handoff and exports."))),
          h("section", null, h("h3", null, "Keyboard"),
            h("dl", null,
              kb(["Tab"], "Move through steps on the canvas; the canvas follows focus."),
              kb(["Enter"], "Open the focused step's panel."),
              kb(["Esc"], "Close the step panel and return to the step."),
              kb(["Space"], "Play or pause the scenario replay."),
              kb(["+", "-"], "Zoom in or out."),
              kb(["0"], "Readable view."), kb(["W"], "Fit the width."), kb(["F"], "Overview of every lane."),
              kb(["Arrows"], "Pan the canvas."), kb(["/"], "Find a step."),
              kb(["Ctrl", "S"], "Save the engagement file."), kb(["Ctrl", "O"], "Open a file."), kb(["Ctrl", "Z"], "Undo."),
              kb(["?"], "This help.")))),
        h("h3", { style: { marginTop: "var(--space-4)" } }, "What the replay shows"),
        h("p", { class: "small" }, "The canvas replays the visits and transitions recorded in a scenario. It does not execute gateway logic or BPMN semantics. Steps outside a scenario's route are shown as not in scenario, and steps whose route membership is unclear are shown as not confirmed until someone reviews them."),
        h("p", { class: "small" }, "Overview fits every lane on screen for orientation. Labels at that scale are too small to read; use Readable, Find, or the step list to work with individual steps.")),
      actions: [{ label: "Close", variant: "btn-primary", autofocus: true }]
    });
  }

  function aboutDialog() {
    openDialog({
      title: "About and data handling", body: h("div", null,
        h("p", null, "BPMVIZ " + VERSION + " is a process workshop workbench. " + (B.aiPanel.enabled ?
          "It is running with the local AI helper: the AI tasks you start go to your own Claude Code or Codex account, on the plan you signed in with. Nothing else leaves this machine." :
          "It runs from local files in a browser, with no server, account or network connection.")),
        h("h3", null, "Where your data lives"),
        h("ul", { class: "plain-list small" },
          h("li", null, "The engagement file you save is the durable record. Keep and share it like any client document."),
          h("li", null, "While you work, a recovery draft is kept in this browser's storage for this browser profile. It is not encrypted; clear it on shared machines from the menu."),
          h("li", null, B.aiPanel.enabled ? "The app loads no fonts, scripts or images from the internet. It talks only to the helper on this machine, and only when you start an AI task." :
            "Nothing is uploaded, and the app loads no fonts, scripts or images from the internet."),
          h("li", null, "AI drafts are marked as such and stay out of the handoff and exports until someone reviews them. See docs/ai.md."),
          h("li", null, "Opened files are treated as data. Text is shown as text, links other than http and https are removed, and files are never run as code.")),
        h("h3", null, "Credits"),
        h("p", { class: "small" }, "Based on the original BPMVIZ visualizer and race explorer by Doug Ross, released under the MIT License. Fonts: Ubuntu and Ubuntu Mono, Ubuntu Font Licence 1.0.")),
      actions: [{ label: "Close", variant: "btn-primary", autofocus: true }]
    });
  }

  /* ---------------- Start screen ---------------- */

  function renderStart() {
    const panel = el.panels.start;
    clear(panel);
    const examples = B.bundledExamples || [];
    const drafts = app.drafts.listDrafts();
    const openBtn = h("button", { type: "button", class: "btn btn-primary btn-lg", id: "start-open" }, icon("open"), "Open an engagement file");
    openBtn.addEventListener("click", () => openPicker());
    const bpmnBtn = h("button", { type: "button", class: "btn btn-lg", id: "start-bpmn" }, icon("upload"), "Import a BPMN file");
    bpmnBtn.addEventListener("click", () => openPicker());
    const newBtn = h("button", { type: "button", class: "btn btn-lg", id: "start-new" }, icon("filePlus"), "New from a template");
    newBtn.addEventListener("click", newEngagementDialog);
    const extraBtns = B.ext.list("startAction").map(a => {
      const b = h("button", { type: "button", class: "btn btn-lg", id: "start-" + a.id }, icon(a.icon || "info"), a.label);
      b.addEventListener("click", () => B.ext.guard("startAction", a, () => a.run(app)));
      return b;
    });
    const aiBtn = B.aiPanel.enabled ? h("button", { type: "button", class: "btn btn-lg", id: "start-ai" }, icon("agent"), "Extract from documents with AI") : null;
    if (aiBtn) aiBtn.addEventListener("click", () => B.aiPanel.openTask(app, "extract"));
    panel.appendChild(h("div", { class: "ws-scroll" }, h("div", { class: "start" },
      h("div", { class: "start-hero" },
        h("div", null,
          h("span", { class: "eyebrow" }, "Process workshop workbench"),
          h("h2", null, "Walk the process with the client, and leave with a record of what you found."),
          h("p", null, "Replay a current-state process, correct it with the people who run it, capture pain points, opportunities and decisions against each step, then hand off a portable engagement file and a printable summary."),
          h("div", { class: "start-actions" }, openBtn, bpmnBtn, newBtn, extraBtns, aiBtn),
          h("p", { class: "note" }, app.storageProblem || !app.drafts.available() ?
            "Browser storage is not available here, so recovery drafts are off. Save engagement files to keep your work." :
            B.aiPanel.enabled ? "Everything stays in this browser and in the files you save, except the AI tasks you start, which go to your own Claude Code or Codex account." :
            "Everything stays in this browser and in the files you save. Nothing is uploaded.")),
        h("div", { class: "start-sail", "aria-hidden": "true" }, s("svg", { viewBox: "0 0 240 120" },
          ...[0, 1, 2].map(i => s("rect", { x: 10, y: 14 + i * 36, width: 220, height: 28, rx: 4, fill: i === 1 ? "#FFFFFF" : "#D8F0F9" })),
          ...[[40, 28], [110, 64], [180, 100]].map(([x, y]) => s("rect", { x: x - 22, y: y - 9, width: 44, height: 18, rx: 4, fill: "#2B0A3D" })),
          s("path", { d: "M62 28 H88 V64 M132 64 H158 V100", fill: "none", stroke: "#2B0A3D", "stroke-width": 2 })))),
      drafts.length ? h("section", { "aria-labelledby": "start-drafts" },
        h("h3", { id: "start-drafts" }, "Recover a local draft"),
        h("div", { class: "draft-list" }, drafts.slice(0, 5).map(d => h("div", { class: "draft-row" },
          icon("save", { width: 20, height: 20 }),
          h("div", { class: "grow" }, h("strong", null, d.processName || d.id), h("div", { class: "small muted" },
            (d.clientDisplayName ? d.clientDisplayName + " \u00b7 " : "") + "Revision " + d.revision + ", saved " + formatDate(d.savedAt))),
          h("button", { type: "button", class: "btn", on: { click: () => restoreDraft(d.id) } }, "Restore"),
          h("button", { type: "button", class: "btn btn-ghost", on: { click: () => { app.drafts.removeDraft(d.id); renderStart(); } } }, "Discard"))))) : null,
      h("section", { "aria-labelledby": "start-examples" },
        h("h3", { id: "start-examples" }, "Bundled examples"),
        h("div", { class: "example-grid" }, examples.map(x => {
          const e = x.engagement;
          const steps = e.models.map(m => m.nodes.length).join(" + ");
          const b = h("button", { type: "button", class: "btn", id: "open-" + x.id }, "Open example");
          b.addEventListener("click", () => openExampleGuarded(x));
          return h("article", { class: "example-card" },
            h("h4", null, x.title), h("p", null, x.description),
            h("div", { class: "meta" }, schema.label("dataStatus", e.meta.dataStatus) + " \u00b7 " + e.models.length + (e.models.length === 1 ? " model, " : " models, ") + steps + " steps \u00b7 " + e.scenarios.length + " scenarios"),
            h("div", null, b));
        }))))));
  }

  /* ---------------- Keyboard ---------------- */

  function onKey(ev) {
    if (document.querySelector("dialog[open]")) return;
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && (ev.key === "s" || ev.key === "S")) { ev.preventDefault(); if (app.store) save(ev.shiftKey); return; }
    if (mod && (ev.key === "o" || ev.key === "O")) { ev.preventDefault(); openPicker(); return; }
    if (mod && (ev.key === "z" || ev.key === "Z") && !isTypingTarget(ev.target)) { ev.preventDefault(); undo(); return; }
    if (ev.key === "?" && !isTypingTarget(ev.target)) { ev.preventDefault(); helpDialog(); return; }
    if (app.workspace === "process" && app.store) app.processView.handleKey(ev);
  }

  /* ---------------- Boot ---------------- */

  async function boot() {
    buildShell();
    applyTheme(app.drafts.getPref("theme") || "light");
    if (!app.drafts.available()) app.storageProblem = "unavailable";
    try {
      if (document.fonts && document.fonts.load) {
        await Promise.race([
          Promise.all(["400 15px Ubuntu", "500 15px Ubuntu", "600 15px Ubuntu", "700 9px Ubuntu", "400 16px 'Ubuntu Mono'"].map(f => document.fonts.load(f))),
          new Promise(r => setTimeout(r, 1500))
        ]);
      }
    } catch (_) { /* fonts fall back to system faces */ }
    updateHeader();
    if (B.aiPanel.enabled) B.aiPanel.connect();
    const params = parseHash();
    const example = params.example && (B.bundledExamples || []).find(x => x.id === params.example);
    if (example) {
      const draft = app.drafts.loadDraft(example.engagement.id);
      if (draft && draft.revision !== example.engagement.revision) {
        goto("start");
        openExampleGuarded(example);
      } else {
        openExample(example, { ws: params.ws, scenario: params.scenario, view: params.view });
      }
      return;
    }
    goto("start");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(typeof globalThis !== "undefined" ? globalThis : this);
