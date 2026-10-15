/* Process authoring through the extension menu and process drawer. */
(function (root) {
  "use strict";
  const B = root.AIxRay = root.AIxRay || {};
  const { h, clear, announce } = B.dom;
  let fieldNumber = 0;
  const live = x => !x.removed;
  function input(key, value, multiline) {
    return h(multiline ? "textarea" : "input", { class: multiline ? "textarea" : "input", "data-builder": key,
      value: multiline ? null : (value == null ? "" : value), maxlength: multiline ? 4000 : 300 }, multiline ? value || "" : null);
  }
  function select(key, options, value) {
    return h("select", { class: "select", "data-builder": key }, options.map(([id, label]) => h("option", { value: id, selected: id === value }, label)));
  }
  function field(label, control) {
    const id = "builder-field-" + (++fieldNumber); control.id = id;
    return h("div", { class: "field" }, h("label", { for: id }, label), control);
  }
  function button(key, label, action, disabled, variant) {
    return h("button", { type: "button", class: "btn " + (variant || ""), "data-builder": key, disabled: !!disabled, on: { click: action } }, label);
  }
  const row = (...children) => h("div", { class: "builder-actions" }, children);
  const types = Object.entries(B.schema.SEMANTIC_TYPES).filter(([key]) => key !== "unsupported").map(([key, info]) => [key, info.label]);
  const flowTypes = ["sequence", "conditional", "default", "loop"].map(key => [key, B.schema.label("edgeType", key)]);
  const laneTypes = B.schema.ENUMS.laneType.map(key => [key, B.schema.label("laneType", key)]);

  function editor(app, modelId, initialNodeId) {
    const host = h("div", { class: "process-builder", "data-builder": "editor" });
    const state = { modelId, nodeId: initialNodeId || "", laneId: "", edgeId: "", message: "", groups: new Map() };
    function render() {
      host.querySelectorAll("details").forEach(group => {
        const summary = group.querySelector("summary");
        if (summary && !group.hasAttribute("data-builder")) state.groups.set(summary.textContent, group.open);
      });
      const engagement = app.store.get();
      const m = engagement.models.find(x => x.id === state.modelId) || engagement.models[0];
      if (!m) { clear(host); host.appendChild(h("p", null, "Open a process first.")); return; }
      state.modelId = m.id;
      const nodes = m.nodes.filter(live), edges = m.edges.filter(live);
      const n = nodes.find(x => x.id === state.nodeId) || nodes[0];
      const l = m.lanes.find(x => x.id === state.laneId) || m.lanes[0];
      const ed = edges.find(x => x.id === state.edgeId) || edges[0];
      state.nodeId = n ? n.id : ""; state.laneId = l ? l.id : ""; state.edgeId = ed ? ed.id : "";
      clear(host);
      const error = h("p", { class: "error-text", role: "alert", hidden: true, "data-builder": "error" });
      function run(verb, payload) {
        try {
          const result = app.store.dispatch("builder/" + verb, Object.assign({ modelId: m.id }, payload));
          if (result.nodeId && verb !== "deleteNode") state.nodeId = result.nodeId;
          if (result.laneId && verb !== "deleteLane") state.laneId = result.laneId;
          if (result.edgeId && verb !== "deleteFlow") state.edgeId = result.edgeId;
          if (verb === "clone") { state.modelId = result.modelId; showModel(app, result.modelId); }
          const count = (result.invalidatedScenarioIds || []).length;
          state.message = "Change saved." + (count ? " Cleared " + count + " scenario run(s) for this diagram. Rebuild their timings before playback." : "");
          render(); announce(state.message);
          return result;
        } catch (err) { error.hidden = false; error.textContent = err.message; return null; }
      }
      const modelSelect = select("model", engagement.models.map(x => [x.id, x.name + (x.locked ? " (locked)" : "")]), m.id);
      modelSelect.addEventListener("change", () => { state.modelId = modelSelect.value; state.nodeId = ""; showModel(app, state.modelId); render(); });
      host.append(field("Process diagram", modelSelect), row(
        button("undo", "Undo last change", () => { app.store.undo(); state.message = "Last change undone."; render(); }, !app.store.canUndo()),
        button("save", "Save a copy", () => app.saveAs())),
      h("p", { class: "small muted", role: "status", "data-builder": "status" }, state.message || "Graph changes clear scenario runs for this diagram. Save a copy to keep your work."), error);

      const baseline = m.role === "current" ? m : engagement.models.find(x => x.id === (m.basedOn || {}).modelId && x.role === "current");
      if (baseline) {
        const alternativeName = input("alternative-name", "Future alternative " + (engagement.models.filter(x => x.role === "future").length + 1));
        host.append(h("details", { class: "builder-group" }, h("summary", null, "Future alternatives"),
          h("p", { class: "small muted" }, "Create a copy of " + baseline.name + ". Its baseline will be locked so you can compare changes."),
          field("Alternative name", alternativeName), button("clone", "Create future alternative", () => run("clone", { sourceModelId: baseline.id, name: alternativeName.value }))));
      }
      if (m.locked) host.append(h("p", { class: "note" }, "This baseline is locked. Select a future alternative or create one to author changes."));
      const controls = h("fieldset", { class: "builder-controls", disabled: m.locked }, h("legend", { class: "sr-only" }, "Author " + m.name));
      const modelName = input("model-name", m.name);
      controls.append(h("details", { class: "builder-group" }, h("summary", null, "Diagram name"), field("Name", modelName),
        button("rename-model", "Rename diagram", () => run("renameModel", { name: modelName.value }))));

      const laneSelect = select("lane", m.lanes.map(x => [x.id, x.name]), state.laneId);
      laneSelect.addEventListener("change", () => { state.laneId = laneSelect.value; render(); });
      const laneName = input("lane-name", l.name), laneType = select("lane-type", laneTypes, l.type);
      const moveLane = select("lane-move-to", [["", "Choose another lane"], ...m.lanes.filter(x => x.id !== l.id).map(x => [x.id, x.name])], "");
      const newLane = input("new-lane-name", ""), newLaneType = select("new-lane-type", laneTypes, "human");
      const laneIndex = m.lanes.indexOf(l);
      controls.append(h("details", { class: "builder-group", open: true }, h("summary", null, "Lanes"),
        field("Lane", laneSelect), field("Lane name", laneName), field("Lane type", laneType), row(
          button("update-lane", "Save lane", () => run("updateLane", { laneId: l.id, patch: { name: laneName.value, type: laneType.value } })),
          button("lane-up", "Move up", () => run("reorderLane", { laneId: l.id, index: laneIndex - 1 }), laneIndex === 0),
          button("lane-down", "Move down", () => run("reorderLane", { laneId: l.id, index: laneIndex + 1 }), laneIndex === m.lanes.length - 1)),
        field("Move steps here when deleting the lane", moveLane), button("delete-lane", "Delete lane", () => run("deleteLane", { laneId: l.id, moveToLaneId: moveLane.value }), m.lanes.length === 1, "btn-danger"),
        h("hr"), field("New lane name", newLane), field("New lane type", newLaneType), button("add-lane", "Add lane", () => run("addLane", { name: newLane.value, type: newLaneType.value }))));

      const newNodeName = input("new-node-name", ""), newNodeType = select("new-node-type", types, "userTask");
      const newNodeLane = select("new-node-lane", m.lanes.map(x => [x.id, x.name]), l.id);
      const insert = select("insert-flow", [["", "Add separately, then connect"], ...edges.map(x => [x.id, flowLabel(m, x)])], "");
      controls.append(h("details", { class: "builder-group", open: true }, h("summary", null, "Add a step or gateway"),
        field("New step name", newNodeName), field("New step type", newNodeType), field("New step lane", newNodeLane), field("Insert into flow (optional)", insert),
        button("add-node", "Add step", () => run("addNode", { label: newNodeName.value, semanticType: newNodeType.value, laneId: newNodeLane.value, edgeId: insert.value || undefined }), false, "btn-primary")));

      if (n) {
        const nodeSelect = select("node", nodes.map(x => [x.id, x.label]), n.id);
        nodeSelect.addEventListener("change", () => { state.nodeId = nodeSelect.value; render(); });
        const nodeName = input("node-name", n.label), nodeType = select("node-type", types, n.semanticType);
        const nodeLane = select("node-lane", m.lanes.map(x => [x.id, x.name]), n.laneId);
        const description = input("node-description", (n.details || {}).desc || "", true);
        const position = input("node-column", ((m.presentation || {}).nodes || {})[n.id] ? m.presentation.nodes[n.id].x : 0);
        position.type = "number"; position.min = "0"; position.max = "10000"; position.step = "any";
        controls.append(h("details", { class: "builder-group", open: !!initialNodeId }, h("summary", null, "Edit or delete steps"),
          field("Step", nodeSelect), field("Step name", nodeName), field("Step type", nodeType), field("Step lane", nodeLane), field("Description", description), field("Diagram column", position),
          row(button("update-node", "Save step", () => run("updateNode", { nodeId: n.id, patch: { label: nodeName.value, semanticType: nodeType.value, laneId: nodeLane.value, description: description.value, x: position.value === "" ? NaN : Number(position.value) } })),
            button("delete-node", "Delete step and its flows", () => run("deleteNode", { nodeId: n.id }), false, "btn-danger")),
          h("p", { class: "field-hint" }, "Deleting disconnects its neighbors. Reconnect them below. Undo restores the step and its flows.")));
      }
      const endpoints = nodes.map(x => [x.id, x.label]);
      const from = select("flow-from", endpoints, n ? n.id : ""), to = select("flow-to", endpoints, nodes[nodes.length - 1] ? nodes[nodes.length - 1].id : "");
      const flowType = select("flow-type", flowTypes, "sequence"), flowName = input("flow-label", "");
      controls.append(h("details", { class: "builder-group", open: true }, h("summary", null, "Connect steps"),
        field("From", from), field("To", to), field("Flow type", flowType), field("Flow label or condition", flowName),
        h("p", { class: "field-hint" }, "Conditional and default flows leave exclusive gateways. Parallel branches use sequence flows. A loop returns to an earlier step."),
        button("add-flow", "Connect", () => run("addFlow", { from: from.value, to: to.value, semanticType: flowType.value, label: flowName.value }))));
      if (ed) {
        const edgeSelect = select("flow", edges.map(x => [x.id, flowLabel(m, x)]), ed.id);
        edgeSelect.addEventListener("change", () => { state.edgeId = edgeSelect.value; render(); });
        const edgeFrom = select("edit-flow-from", endpoints, ed.from), edgeTo = select("edit-flow-to", endpoints, ed.to);
        const edgeType = select("edit-flow-type", flowTypes, ed.semanticType), edgeLabel = input("edit-flow-label", ed.label);
        controls.append(h("details", { class: "builder-group" }, h("summary", null, "Reconnect or delete flows"),
          field("Flow", edgeSelect), field("From step", edgeFrom), field("To step", edgeTo), field("Type", edgeType), field("Label or condition", edgeLabel),
          row(button("update-flow", "Save flow", () => run("updateFlow", { edgeId: ed.id, patch: { from: edgeFrom.value, to: edgeTo.value, semanticType: edgeType.value, label: edgeLabel.value } })),
            button("delete-flow", "Delete flow", () => run("deleteFlow", { edgeId: ed.id }), false, "btn-danger"))));
      }
      host.appendChild(controls);
      const issues = B.processBuilder.integrity(m);
      host.appendChild(h("details", { class: "builder-group", open: true, "data-builder": "checks" }, h("summary", null, "Structure checks (" + issues.length + ")"),
        issues.length ? h("ul", { class: "plain-list" }, issues.map(issue => h("li", null, issue.message))) : h("p", { class: "small" }, "All active steps are reachable from a start and can reach an end.")));
      host.querySelectorAll("details").forEach(group => {
        const summary = group.querySelector("summary");
        if (summary && state.groups.has(summary.textContent)) group.open = state.groups.get(summary.textContent);
      });
    }
    render(); return host;
  }
  function flowLabel(m, ed) {
    const label = id => (m.nodes.find(n => n.id === id) || {}).label || id;
    return label(ed.from) + " -> " + label(ed.to) + (ed.label ? " (" + ed.label + ")" : "");
  }
  function showModel(app, modelId) {
    app.view.display = "m:" + modelId;
    app.view.selected = null; app.view.panelOpen = true;
    app.processView.onEngagementChange({ type: "builder/view" });
  }
  function open(app, modelId, nodeId) {
    if (!app.store) return start(app);
    const e = app.store.get(), displayId = (app.view.display || "").slice(2);
    const m = e.models.find(x => x.id === (modelId || displayId)) || e.models[0];
    const dialog = B.dialogs.openDialog({ title: "Build a process", wide: true, body: editor(app, m.id, nodeId), actions: [{ label: "Close" }] });
    dialog.dialog.id = "builder-dialog";
    return dialog;
  }
  function start(app) {
    const processName = input("process-name", ""), teamName = input("team-name", "Team");
    const error = h("p", { class: "error-text", hidden: true, role: "alert" });
    let busy = false;
    const dialog = B.dialogs.openDialog({ title: "Build a process", body: h("div", { class: "process-builder" },
      h("p", null, "Start with a start event, an end event and a people lane. Add the work and connect the steps."),
      field("Process name", processName), field("Initial lane name", teamName), error,
      button("create", "Create process", async () => {
        if (busy) return;
        if (!processName.value.trim() || !teamName.value.trim()) { error.hidden = false; error.textContent = "Enter a process name and an initial lane name."; return; }
        busy = true;
        try {
          if (app.guardUnsaved && !await app.guardUnsaved("create a process")) return;
          const e = B.processBuilder.blank({ processName: processName.value.trim().slice(0, 200) });
          e.models[0].lanes[0].name = teamName.value.trim().slice(0, 200);
          const checked = B.validate.validateEngagement(e);
          if (!checked.ok) throw new Error(checked.errors[0].message);
          dialog.close();
          app.loadEngagement(checked.engagement, { savedRevision: -1, source: "builder", warnings: checked.warnings });
          app.view.panelOpen = true;
          showModel(app, e.models[0].id);
          open(app);
        } catch (err) { error.hidden = false; error.textContent = err.message; }
        finally { busy = false; }
      }, false, "btn-primary")), actions: [{ label: "Cancel" }] });
    return dialog;
  }
  B.ext.registerStartAction({ id: "process-builder", order: 5, icon: "edit", label: "Build a process", run: start });
  B.ext.registerMenuItem({ id: "process-builder-new", order: 5, icon: "filePlus", label: "Build a process", group: "import", run: start });
  B.ext.registerMenuItem({ id: "process-builder", order: 6, icon: "edit", label: "Edit process structure", group: "import", needsEngagement: true, run: open });
  function drawerSection(ctx, m, n) {
    const issues = B.processBuilder.integrity(m);
    return h("section", { class: "side-section" }, h("h3", null, "Process structure"),
      h("p", { class: "small muted" }, m.locked ? "This baseline is locked. Create a future alternative to make changes." :
        issues.length ? issues.length + " structure check(s) need attention." : "Add lanes, steps, gateways and flows."),
      button("open-editor", "Edit process structure", () => open(ctx.app, m.id, n ? n.id : undefined)));
  }
  B.ext.registerDrawerSection({ id: "process-builder-overview", order: 50, where: "overview", render: drawerSection });
  B.ext.registerDrawerSection({ id: "process-builder-step", order: 50, where: "step", render: drawerSection });
  B.ext.registerStructuralEvent("builder/");
  B.processBuilderUi = { open, start, editor };
})(typeof globalThis !== "undefined" ? globalThis : this);
