/* Walkthrough and scenario editor extensions. Engagement content is text. */
(function (root) {
  "use strict";
  const B = root.AIxRay = root.AIxRay || {};
  const W = B.walkthrough, { h, clear } = B.dom, { field, input } = B.forms;
  const states = new WeakMap();
  let seq = 0;
  const text = value => value == null ? "" : typeof value === "object" ? Object.values(value).map(text).filter(Boolean).join(", ") : String(value);
  const button = (label, run, attrs) => h("button", Object.assign({ type: "button", class: "btn", on: { click: run } }, attrs || {}), label);
  const option = (value, label, selected) => h("option", { value, selected }, label);
  function pick(items, value, attrs) {
    return h("select", Object.assign({ class: "select" }, attrs || {}), items.map(x => option(x.id, x.name, x.id === value)));
  }
  function errorLine() { return h("p", { class: "error-text", role: "alert", hidden: true }); }
  function showError(el, err) { el.hidden = false; el.textContent = err.message || String(err); }
  function stateFor(app) {
    let state = states.get(app);
    if (!state) { state = { walk: null, modelId: "", hosts: new Map(), store: null }; states.set(app, state); }
    if (state.store !== app.store) {
      if (state.unsubscribe) state.unsubscribe();
      state.walk = null; state.store = app.store;
      state.unsubscribe = app.store.subscribe((e, event) => {
        if (event.type === "replace" || state.walk && !W.validWalk(e, state.walk)) {
          state.walk = null; state.notice = "The process changed. Choose a start step to begin again.";
        }
        state.hosts.forEach((render, host) => { if (!host.isConnected) state.hosts.delete(host); else render(); });
      });
    }
    state.hosts.forEach((render, host) => { if (!host.isConnected) state.hosts.delete(host); });
    return state;
  }
  function renderWalk(ctx, preferredModel) {
    const app = ctx.app, state = stateFor(app);
    const host = h("section", { class: "walkthrough form-grid", "aria-label": "Guided walkthrough" });
    function render() {
      const active = document.activeElement;
      const focusKey = host.contains(active) && active.dataset.walkFocus;
      clear(host);
      const e = app.store.get();
      if (state.walk && !W.validWalk(e, state.walk)) { state.walk = null; state.notice = "The process changed. Start again."; }
      if (!e.models.some(m => m.id === state.modelId)) state.modelId = preferredModel && e.models.some(m => m.id === preferredModel.id) ? preferredModel.id : (e.models[0] || {}).id;
      const model = e.models.find(m => m.id === state.modelId);
      host.append(h("h3", null, "Business walkthrough"), h("p", { class: "small muted" }, "Discuss the steps without a clock. Choose each branch with the participants."));
      if (!model) { host.append(h("p", null, "Add a process first.")); return; }
      const modelSel = pick(e.models.map(m => ({ id: m.id, name: m.name + " (" + m.role + ")" })), model.id, { "data-walk": "model" });
      modelSel.addEventListener("change", () => { state.modelId = modelSel.value; state.walk = null; state.notice = ""; render(); });
      host.append(field("Process", modelSel));
      const err = errorLine();
      if (!state.walk) {
        const suggested = new Set(W.starts(model).map(n => n.id));
        const choices = model.nodes.filter(n => !n.removed).slice().sort((a, b) => Number(suggested.has(b.id)) - Number(suggested.has(a.id)));
        const start = pick(choices.map(n => ({ id: n.id, name: n.label + (suggested.has(n.id) ? " (start)" : "") })), (choices[0] || {}).id, { "data-walk": "start-step" });
        host.append(field("Start at step", start), button("Start walkthrough", () => {
          try { state.walk = W.begin(app.store.get(), model.id, start.value); state.notice = ""; render(); highlight(); }
          catch (error) { showError(err, error); }
        }, { disabled: !choices.length, "data-walk": "start" }));
        if (state.notice) host.append(h("p", { role: "status" }, state.notice));
      } else {
        const walk = state.walk, node = model.nodes.find(n => n.id === walk.nodeIds[walk.cursor]);
        const lane = model.lanes.find(l => l.id === node.laneId), details = node.details || {};
        host.append(h("div", { class: "walkthrough-current", "aria-live": "polite" },
          h("p", { class: "small muted" }, "Visit " + (walk.cursor + 1) + "; step visited " + walk.nodeIds.slice(0, walk.cursor + 1).filter(id => id === node.id).length + " time(s)"),
          h("h4", { "data-walk": "current", tabindex: "-1" }, node.label),
          h("dl", { class: "walkthrough-facts" }, h("dt", null, "Role"), h("dd", null, text(details.who || details.owner || lane && (lane.role || lane.name)) || "Not provided"),
            h("dt", null, "System"), h("dd", null, text(details.systems) || "Not provided")),
          h("p", null, text(details.desc) || "No description provided.")));
        host.append(h("p", { class: "small", "data-walk": "guidance" }, W.guidance(model, node.id)));
        const edges = W.outgoing(model, node.id);
        const branch = pick([{ id: "", name: "Choose a branch" }].concat(edges.map(edge => ({ id: edge.id, name: (edge.label || "Unlabeled connector " + edge.id) + " -> " + model.nodes.find(n => n.id === edge.to).label }))), edges.length === 1 ? edges[0].id : "", { "data-walk": "branch" });
        if (edges.length > 1) host.append(field("Which branch?", branch));
        const go = () => {
          try { state.walk = W.next(app.store.get(), state.walk, branch.value); render(); highlight(); }
          catch (error) { showError(err, error); }
        };
        const next = button("Next", go, { disabled: !edges.length || edges.length > 1 && !branch.value, "data-walk": "next", dataset: { walkFocus: "next" } });
        branch.addEventListener("change", () => { next.disabled = !branch.value; });
        host.append(h("div", { class: "walkthrough-actions" },
          button("Previous", () => { state.walk = W.previous(state.walk); render(); highlight(); }, { disabled: !walk.cursor, "data-walk": "previous", dataset: { walkFocus: "previous" } }), next,
          button("Start again", () => { state.walk = null; render(); }, { "data-walk": "reset" })));
        if (!edges.length) host.append(h("p", { role: "status" }, /endEvent|terminateEndEvent/.test(node.semanticType) ? "End of the selected route." : "No outgoing connector. Check whether this route is complete."));
        host.append(button("Capture finding at this step", () => B.forms.recordDialog(app, { kind: "note", linkedModelId: model.id, linkedNodeIds: [node.id] }), { "data-walk": "finding" }));
        host.append(h("h4", null, "Route history"), h("ol", { class: "walkthrough-history" }, walk.nodeIds.map((id, i) => h("li", null,
          button((i === walk.cursor ? "Current: " : "") + model.nodes.find(n => n.id === id).label + (i ? " via " + (model.edges.find(x => x.id === walk.edgeIds[i - 1]).label || walk.edgeIds[i - 1]) : ""),
            () => { state.walk = Object.assign({}, state.walk, { cursor: i }); render(); highlight(); }, { "aria-current": i === walk.cursor ? "step" : null })))));
      }
      host.append(err, button("Edit scenarios", () => openEditor(app), { "data-walk": "editor" }));
      if (focusKey) { const target = host.querySelector('[data-walk-focus="' + focusKey + '"]'); if (target && !target.disabled) target.focus(); }
    }
    function highlight() {
      if (state.walk && app.processView && typeof app.processView.selectNode === "function") app.processView.selectNode(state.walk.modelId, state.walk.nodeIds[state.walk.cursor], { center: true, keepTab: true, silent: true });
    }
    state.hosts.set(host, render); render(); return host;
  }

  function openEditor(app) {
    const prefix = "walk-editor-" + (++seq);
    const content = h("div", { class: "form-grid walkthrough-editor", "data-walk-editor": "" });
    let scenarioId = app.view && app.view.scenarioId || (app.store.get().scenarios[0] || {}).id || "";
    let modelId = (app.store.get().models[0] || {}).id || "", rows = [], dirty = false, loaded = "", notice = "";
    let dialog;
    function dispatch(type, payload, err) {
      if (app.dispatch(type, payload, "", err)) { notice = "Change saved in this engagement. Use Save a copy to keep a file."; return true; }
      return false;
    }
    function load() {
      const e = app.store.get(), s = e.scenarios.find(x => x.id === scenarioId);
      rows = s ? W.rowsFor(s, modelId) : []; dirty = false;
      loaded = JSON.stringify([e.id, s, e.models.find(m => m.id === modelId)]);
    }
    function fresh() {
      const e = app.store.get();
      if (loaded !== JSON.stringify([e.id, e.scenarios.find(x => x.id === scenarioId), e.models.find(m => m.id === modelId)])) {
        notice = "The scenario or process changed while this editor was open. Reloaded the saved version; review it before saving.";
        load(); render(); return false;
      }
      return true;
    }
    async function switchTo(change) {
      if (dirty && !await B.dialogs.confirmDialog("Discard unsaved route edits?", "The route changes have not been saved.", "Discard edits")) { render(); return; }
      change(); load(); render();
    }
    function render() {
      const active = document.activeElement;
      const attr = content.contains(active) && (active.hasAttribute("data-walk") ? "data-walk" : active.hasAttribute("aria-label") ? "aria-label" : null);
      const focusValue = attr && active.getAttribute(attr);
      const restoreFocus = () => {
        if (!attr) return;
        const target = [...content.querySelectorAll("button,input,select,textarea")].find(el => el.getAttribute(attr) === focusValue);
        if (target && !target.disabled) target.focus();
      };
      clear(content);
      const e = app.store.get();
      if (!e.models.some(m => m.id === modelId)) modelId = (e.models[0] || {}).id || "";
      if (!e.scenarios.some(s => s.id === scenarioId)) scenarioId = (e.scenarios[0] || {}).id || "";
      const s = e.scenarios.find(x => x.id === scenarioId), model = e.models.find(m => m.id === modelId);
      const err = errorLine(), name = input(s ? s.name : "", { maxlength: 300, "data-walk": "scenario-name" });
      const scenario = pick([{ id: "", name: "Choose a scenario" }].concat(e.scenarios), scenarioId, { "data-walk": "scenario" });
      scenario.addEventListener("change", () => switchTo(() => { scenarioId = scenario.value; }));
      content.append(h("p", { class: "small muted" }, "Author one explicit ordered route per process. Repeated steps represent rework. All times are minutes in the engagement's time basis. This editor does not schedule parallel branches or execute business rules."),
        field("Scenario", scenario), field("Scenario name", name));
      content.append(h("div", { class: "walkthrough-actions" },
        button("Create scenario", () => {
          if (dirty) { showError(err, new Error("Save or reset the route before creating another scenario.")); return; }
          const ids = new Set(app.store.get().scenarios.map(x => x.id));
          if (dispatch("walkthrough/create", { name: name.value }, err)) { scenarioId = app.store.get().scenarios.find(x => !ids.has(x.id)).id; load(); render(); }
        }, { "data-walk": "create-scenario" }),
        button("Rename", () => { if (fresh() && dispatch("walkthrough/rename", { scenarioId, name: name.value }, err)) { loaded = JSON.stringify([app.store.get().id, app.store.get().scenarios.find(x => x.id === scenarioId), model]); render(); } }, { disabled: !s, "data-walk": "rename-scenario" }),
        button("Delete scenario", async () => {
          if (await B.dialogs.confirmDialog("Delete scenario?", "Delete " + s.name + " and its runs? You can undo this change.", "Delete", true) && fresh() && dispatch("walkthrough/delete", { scenarioId }, err)) { scenarioId = ""; render(); load(); render(); }
        }, { disabled: !s, class: "btn btn-danger", "data-walk": "delete-scenario" })));
      content.append(err);
      if (notice) content.append(h("p", { role: "status", "data-walk": "save-status" }, notice));
      if (!s || !model) { restoreFocus(); return; }
      const process = pick(e.models.map(m => ({ id: m.id, name: m.name + " (" + m.role + ")" })), modelId, { "data-walk": "run-model" });
      process.addEventListener("change", () => switchTo(() => { modelId = process.value; }));
      content.append(field("Process for this run", process), h("p", { class: "small" }, "Save a run for the before process, then choose the future process and save its run. Enter effort separately from elapsed duration; blank effort remains unknown. A start may be blank to use the previous end plus wait."));
      const table = h("table", { class: "table walkthrough-visits" }, h("caption", null, "Ordered route visits"),
        h("thead", null, h("tr", null, ["Visit / step", "Incoming branch", "Wait", "Duration", "Human effort", "Start", "Remove"].map(x => h("th", { scope: "col" }, x)))));
      const body = h("tbody"); table.append(body);
      rows.forEach((row, i) => {
        const step = pick(model.nodes.filter(n => !n.removed).map(n => ({ id: n.id, name: n.label })), row.nodeId, { "aria-label": "Step for visit " + (i + 1) });
        step.addEventListener("change", () => { row.nodeId = step.value; row.edgeId = ""; if (rows[i + 1]) rows[i + 1].edgeId = ""; dirty = true; render(); });
        const edges = i ? model.edges.filter(edge => edge.from === rows[i - 1].nodeId && edge.to === row.nodeId) : [];
        if (edges.length === 1 && !row.edgeId) row.edgeId = edges[0].id;
        const incoming = pick([{ id: "", name: i ? "Choose connector" : "Start" }].concat(edges.map(edge => ({ id: edge.id, name: edge.label || "Unlabeled " + edge.id }))), row.edgeId, { disabled: !i, "aria-label": "Incoming branch for visit " + (i + 1) });
        incoming.addEventListener("change", () => { row.edgeId = incoming.value; dirty = true; });
        const nums = ["wait", "duration", "effort", "start"].map(key => {
          const control = input(row[key], { type: "number", min: 0, step: "any", "aria-label": key + " for visit " + (i + 1), "data-visit": i + 1, "data-time": key });
          control.addEventListener("input", () => { row[key] = control.value; dirty = true; }); return h("td", null, control);
        });
        body.append(h("tr", null, h("td", null, h("span", { class: "small" }, String(i + 1)), step), h("td", null, incoming), nums,
          h("td", null, button("Remove " + (i + 1), () => { rows.splice(i, 1); dirty = true; render(); }, { "aria-label": "Remove visit " + (i + 1) }))));
      });
      content.append(h("div", { class: "walkthrough-scroll" }, table));
      const last = rows.length ? rows[rows.length - 1] : null;
      const choices = last ? W.outgoing(model, last.nodeId).map(edge => ({ id: edge.id, name: (edge.label || "Unlabeled " + edge.id) + " -> " + model.nodes.find(n => n.id === edge.to).label })) : model.nodes.filter(n => !n.removed).map(n => ({ id: n.id, name: n.label }));
      const add = pick([{ id: "", name: last ? "Choose next branch and step" : "Choose first step" }].concat(choices), "", { "data-walk": "add-choice" });
      content.append(field(last ? "Next visit" : "First visit", add), h("div", { class: "walkthrough-actions" },
        button("Add visit", () => {
          if (!add.value) { showError(err, new Error("Choose a step or branch first.")); return; }
          const edge = last && model.edges.find(x => x.id === add.value);
          const nodeId = edge ? edge.to : add.value, node = model.nodes.find(n => n.id === nodeId);
          rows.push({ nodeId, edgeId: edge ? edge.id : "", wait: 0, duration: /Event$|Gateway$/.test(node.semanticType) ? 0 : "", effort: "", start: "" }); dirty = true; render();
          const duration = content.querySelector('[data-visit="' + rows.length + '"][data-time="duration"]');
          if (duration) duration.focus();
        }, { disabled: rows.length >= W.MAX_VISITS, "data-walk": "add-visit" }),
        button("Save run", () => {
          if (fresh() && dispatch("walkthrough/saveRun", { scenarioId, modelId, rows }, err)) { load(); render(); }
        }, { disabled: !rows.length, class: "btn btn-primary", "data-walk": "save-run" }),
        button("Reload saved route", () => switchTo(() => {}), { "data-walk": "reload-run" }),
        button("Clear route to replace it", () => { rows = []; dirty = true; render(); }, { "data-walk": "clear-run" })));
      const routeError = errorLine();
      try { if (rows.length) W.buildRun(model, rows); } catch (error) { showError(routeError, error); }
      content.append(routeError);
      if (rows.some(row => /^(parallel|inclusive)Gateway$/.test((model.nodes.find(n => n.id === row.nodeId) || {}).semanticType))) content.append(h("p", { class: "small" }, W.PARALLEL_NOTE));
      content.append(assumptionPanel(e, s, err));
      content.append(comparePanel(app.store.get()));
      restoreFocus();
    }
    function assumptionPanel(e, s, err) {
      const panel = h("details", { class: "walkthrough-assumptions" }, h("summary", null, "Compare processes and enter assumptions"));
      const econ = s.economics || {}, choices = [{ id: "", name: "Not set" }].concat(e.models);
      const before = pick(choices, econ.beforeModelId || "", { "data-walk": "before-model" }), after = pick(choices, econ.afterModelId || "", { "data-walk": "after-model" });
      panel.append(h("div", { class: "field-row" }, field("Before process", before), field("Future process", after)),
        h("p", { class: "small muted" }, "Blank overrides use engagement assumptions. Alternatives copy the saved routes and use only the entered overrides. No savings percentages are generated. Save route edits before changing assumptions."));
      const baseline = {}, variants = { conservative: {}, expected: {}, optimistic: {} };
      const table = h("table", { class: "table walkthrough-assumption-table" }, h("caption", null, "Scenario economics overrides"), h("thead", null, h("tr", null,
        ["Assumption", "This scenario", "Conservative", "Expected", "Optimistic"].map(label => h("th", { scope: "col" }, label)))));
      const body = h("tbody"); table.append(body);
      const status = pick(B.schema.ENUMS.assumptionStatus.map(id => ({ id, name: B.schema.label("assumptionStatus", id) })), "supplied", { "data-walk": "assumption-status" });
      const note = input("", { maxlength: 1000, "data-walk": "assumption-note" });
      const drivers = B.economics.driverMap(e, s);
      B.schema.DRIVERS.forEach(driver => {
        const cells = [h("th", { scope: "row" }, driver.label, h("div", { class: "small muted" }, driver.unit), h("div", { class: "small muted" }, drivers[driver.key] ? "Effective: " + drivers[driver.key].value + " (" + drivers[driver.key].source + ")" : "No effective value"))];
        [baseline, variants.conservative, variants.expected, variants.optimistic].forEach((map, col) => {
          const current = !col && econ.overrides && econ.overrides[driver.key];
          const control = input(current ? current.value : "", { type: "number", min: 0, step: "any", "aria-label": driver.label + " " + ["this scenario", "conservative", "expected", "optimistic"][col], dataset: { assumption: driver.key, variant: String(col) } });
          map[driver.key] = control; cells.push(h("td", null, control));
        });
        body.append(h("tr", null, cells));
      });
      function payload(map) {
        return { beforeModelId: before.value || null, afterModelId: after.value || null,
          overrides: Object.fromEntries(Object.entries(map).map(([key, control]) => {
            const old = econ.overrides && econ.overrides[key];
            const unchanged = map === baseline && old && String(old.value) === control.value;
            return [key, { value: control.value, status: unchanged ? old.status : status.value, note: unchanged ? old.note : note.value }];
          })) };
      }
      panel.append(h("div", { class: "walkthrough-scroll" }, table), h("div", { class: "field-row" }, field("Status for new or changed assumptions", status), field("Basis for new or changed assumptions", note)),
        h("div", { class: "walkthrough-actions" },
          button("Save assumptions", () => {
            if (dirty) { showError(err, new Error("Save or reload the route first.")); return; }
            if (fresh() && dispatch("walkthrough/setAssumptions", Object.assign({ scenarioId }, payload(baseline)), err)) { load(); render(); }
          }, { "data-walk": "save-assumptions" }),
          button("Create three alternatives", () => {
            if (dirty) { showError(err, new Error("Save or reload the route first.")); return; }
            if (fresh() && dispatch("walkthrough/variants", { scenarioId, variants: Object.fromEntries(Object.entries(variants).map(([key, map]) => [key, payload(map)])) }, err)) { load(); render(); }
          }, { "data-walk": "create-variants" })));
      return panel;
    }
    load(); render();
    dialog = B.dialogs.openDialog({ title: "Edit scenarios", wide: true, body: content, actions: [{ label: "Close", value: "close" }], onClose: () => {} });
    dialog.dialog.dataset.walkEditorId = prefix;
    return dialog;
  }
  function comparePanel(e) {
    const panel = h("details", { class: "walkthrough-compare" }, h("summary", null, "Compare saved scenarios"), h("p", { class: "small" }, "These are alternatives. Do not add their annual figures. Capacity is redeployable time; elapsed duration alone does not establish cost savings."));
    const rows = W.compare(e, e.scenarios.map(s => s.id));
    const table = h("table", { class: "table" }, h("caption", null, "Value from existing economics assumptions"), h("thead", null, h("tr", null, ["Scenario", "Annual cost difference", "Time freed up", "Missing assumptions"].map(label => h("th", { scope: "col" }, label)))));
    const body = h("tbody"); table.append(body);
    rows.forEach(row => {
      const annual = row.outputs.find(o => o.key === "annualCostDifference"), capacity = row.outputs.find(o => o.key === "capacityFte");
      const show = out => out && out.value !== null ? B.units.formatMeasure(out.value, out.unit, { currency: e.meta.currency || "USD" }) : "Not calculated";
      const missing = [...new Set([annual, capacity].filter(Boolean).flatMap(o => o.missing))];
      body.append(h("tr", null, h("th", { scope: "row" }, row.name), h("td", null, show(annual)), h("td", null, show(capacity)), h("td", null, missing.join(", ") || (!annual || !capacity ? "Save before and future runs with human effort." : "All required inputs entered"))));
    });
    panel.append(h("div", { class: "walkthrough-scroll" }, table)); return panel;
  }
  B.ext.registerMenuItem({ id: "walkthrough-scenarios", label: "Edit scenarios", icon: "edit", group: "ai", needsEngagement: true, run: openEditor });
  B.ext.registerPresentMode({ id: "walkthrough", label: "Walkthrough", printable: false, render: (host, ctx) => host.append(renderWalk(ctx)) });
  B.ext.registerDrawerSection({ id: "walkthrough", where: "overview", render: (ctx, model) => renderWalk(ctx, model) });
  B.ext.registerDrawerSection({ id: "walkthrough-step", where: "step", render: (ctx, model) => renderWalk(ctx, model) });
  B.ext.registerRefreshEvent("walkthrough/");
  B.ext.registerStructuralEvent("walkthrough/");
  B.walkthroughUI = { renderWalk, openEditor };
})(typeof globalThis !== "undefined" ? globalThis : this);
