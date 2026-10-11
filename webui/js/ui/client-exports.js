/*
 * AIxRay client-exports: the "Export for client tools" dialog. Registers a
 * present-bar action and an export menu item through AIxRay.ext; it does not
 * change the engagement, so it registers no store commands.
 */
(function (root) {
  "use strict";
  const B = root.AIxRay = root.AIxRay || {};
  const { h, icon, announce } = B.dom;
  const { schema, util } = B;

  let seq = 0;
  function field(label, control, hint) {
    if (!control.id) control.id = "exp-f" + (++seq);
    return h("div", { class: "field" }, h("label", { for: control.id }, label), control, hint ? h("span", { class: "field-hint" }, hint) : null);
  }

  function modelOption(m) {
    return h("option", { value: m.id }, m.name + " (" + schema.label("modelRole", m.role) + ")");
  }

  function section(title, description, controlsEl, button) {
    return h("section", { class: "card export-section" },
      h("h3", null, title), h("p", { class: "small muted" }, description),
      controlsEl, h("div", { class: "export-actions" }, button));
  }

  /** Opens the export dialog. ctx (optional) seeds the scenario and the sensitive/AI-draft toggles. */
  function openExportDialog(app, ctx) {
    const c = ctx || B.ext.context(app, {});
    const fresh = () => app.store.get();
    const eng0 = fresh();
    if (!eng0.models.length) { B.dialogs.messageDialog("Nothing to export", "Add a model to the engagement first."); return; }

    const state = {
      includeSensitive: !!c.includeSensitive, includeUnreviewedAi: !!c.includeUnreviewedAi,
      scenarioId: c.scenarioId || (eng0.scenarios[0] && eng0.scenarios[0].id) || ""
    };

    const sensitiveBox = h("input", { type: "checkbox", id: "exp-sensitive", checked: state.includeSensitive });
    sensitiveBox.addEventListener("change", () => { state.includeSensitive = sensitiveBox.checked; });
    const unreviewedBox = h("input", { type: "checkbox", id: "exp-unreviewed", checked: state.includeUnreviewedAi });
    unreviewedBox.addEventListener("change", () => { state.includeUnreviewedAi = unreviewedBox.checked; });
    const scenarioSelect = h("select", { class: "select", id: "exp-scenario" },
      h("option", { value: "", selected: !state.scenarioId }, "No scenario"),
      eng0.scenarios.map(s => h("option", { value: s.id, selected: s.id === state.scenarioId }, s.name)));
    scenarioSelect.addEventListener("change", () => { state.scenarioId = scenarioSelect.value; });
    const modelSelect = h("select", { class: "select", id: "exp-model" }, eng0.models.map(modelOption));
    const formatSelect = h("select", { class: "select", id: "exp-format" },
      h("option", { value: "jira" }, "Jira (CSV)"),
      h("option", { value: "azure" }, "Azure DevOps (CSV)"),
      h("option", { value: "xlsx" }, "Excel workbook"));

    const status = h("p", { class: "small muted", "aria-live": "polite" });
    const setStatus = msg => { status.textContent = msg || ""; };

    async function downloadDeck() {
      setStatus("Building the deck...");
      let image = null;
      try {
        const r = await app.presentView.renderPng({ scale: 2 });
        image = { bytes: new Uint8Array(await r.blob.arrayBuffer()), width: r.width, height: r.height };
      } catch (_) {
        /* No diagram has been drawn yet. The deck notes this instead of failing. */
      }
      try {
        const eng = fresh();
        const spec = B.pptx.deckFromEngagement(eng, {
          includeSensitive: state.includeSensitive, includeUnreviewedAi: state.includeUnreviewedAi,
          scenarioId: state.scenarioId, image
        });
        const bytes = await B.pptx.pptxBytesAsync(spec, { deflateRaw: B.files.deflateRaw });
        B.files.downloadBytes(bytes, B.exporting.fileBase(eng) + "-client-deck.pptx",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation");
        setStatus("Deck exported.");
        announce("Client deck exported.");
      } catch (err) {
        setStatus("");
        B.dialogs.messageDialog("The deck could not be built", err.message);
      }
    }

    function downloadBpmn() {
      const eng = fresh();
      try {
        const xml = B.bpmnExport.exportModel(eng, modelSelect.value);
        const model = eng.models.find(m => m.id === modelSelect.value);
        const name = B.exporting.fileBase(eng) + "-" + (model ? util.slug(model.name, 40) : "model") + ".bpmn";
        B.files.downloadBytes(xml, name, "application/xml");
        announce("BPMN diagram exported.");
      } catch (err) {
        B.dialogs.messageDialog("The BPMN file could not be built", err.message);
      }
    }

    async function downloadBacklog() {
      const eng = fresh();
      const items = B.backlog.backlogItems(eng, { includeSensitive: state.includeSensitive, includeUnreviewedAi: state.includeUnreviewedAi });
      const all = items.epics.concat(items.tasks);
      if (!all.length) { B.dialogs.messageDialog("Nothing to export", "No opportunities or actions are recorded yet."); return; }
      const base = B.exporting.fileBase(eng);
      if (formatSelect.value === "jira") {
        B.files.downloadBytes("\ufeff" + B.backlog.toJiraCsv(all), base + "-backlog-jira.csv", "text/csv;charset=utf-8");
      } else if (formatSelect.value === "azure") {
        B.files.downloadBytes("\ufeff" + B.backlog.toAzureCsv(all), base + "-backlog-azure.csv", "text/csv;charset=utf-8");
      } else {
        const spec = B.backlog.toWorkbookSpec(all, { title: "Backlog", creator: "AIxRay" });
        const bytes = await B.xlsx.workbookBytesAsync(spec, { deflateRaw: B.files.deflateRaw });
        B.files.downloadBytes(bytes, base + "-backlog.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      }
      announce("Backlog exported.");
    }

    const body = h("div", { class: "export-dialog" },
      h("div", { class: "field-row" }, field("Scenario", scenarioSelect, "Used for the deck's modeled figures.")),
      h("div", { class: "export-toggles" },
        h("label", { class: "check" }, sensitiveBox, "Include sensitive records"),
        h("label", { class: "check" }, unreviewedBox, "Include AI drafts not yet reviewed")),
      h("div", { class: "export-grid" },
        section("PowerPoint deck", "Scope, findings, opportunities ranked by modeled value, and the current process diagram.", null,
          h("button", { type: "button", class: "btn btn-primary", id: "exp-pptx", on: { click: downloadDeck } }, icon("download"), "Download deck")),
        section("BPMN 2.0 diagram", "The chosen model as a standard BPMN file for process modeling tools.",
          field("Model", modelSelect),
          h("button", { type: "button", class: "btn btn-primary", id: "exp-bpmn", on: { click: downloadBpmn } }, icon("download"), "Download BPMN")),
        section("Backlog", "Opportunities as epics or features and actions as tasks or user stories, with acceptance criteria.",
          field("Format", formatSelect),
          h("button", { type: "button", class: "btn btn-primary", id: "exp-backlog", on: { click: downloadBacklog } }, icon("download"), "Download backlog"))),
      status);

    B.dialogs.openDialog({
      title: "Export for client tools", wide: true, body,
      actions: [{ label: "Close", value: true, variant: "btn-primary", autofocus: true }]
    });
  }

  B.ext.registerPresentAction({ id: "client-exports", icon: "download", label: "Export for client tools", run: (app, ctx) => openExportDialog(app, ctx) });
  B.ext.registerMenuItem({
    // A high order keeps this item from claiming the first slot in the export group, which other
    // features (and tests that register their own menu item at runtime) may expect to come first.
    id: "client-exports", order: 100, icon: "download", label: "Export for client tools", group: "export", needsEngagement: true,
    run: app => openExportDialog(app, B.ext.context(app, {}))
  });

  B.clientExports = { openExportDialog };
})(typeof globalThis !== "undefined" ? globalThis : this);
