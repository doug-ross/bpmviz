/*
 * Dialog forms: workshop records (including opportunities), evidence sources,
 * the executive summary, engagement settings, and the constrained
 * future-state edits.
 */
(function (root) {
  "use strict";
  const B = root.BPMVIZ = root.BPMVIZ || {};
  const { h, icon, formatDate } = B.dom;
  const { schema } = B;
  const { openDialog, confirmDialog } = B.dialogs;

  let seq = 0;
  const fid = name => "f" + (++seq) + "-" + name;

  function field(label, control, hint) {
    if (!control.id) control.id = fid("x");
    return h("div", { class: "field" }, h("label", { for: control.id }, label), control, hint ? h("span", { class: "field-hint" }, hint) : null);
  }
  function input(value, attrs) { return h("input", Object.assign({ class: "input", value: value == null ? "" : String(value) }, attrs || {})); }
  function textarea(value, rows) { return h("textarea", { class: "textarea", rows: rows || 3 }, value || ""); }
  function select(enumName, value, attrs) {
    return h("select", Object.assign({ class: "select" }, attrs || {}), schema.ENUMS[enumName].map(v =>
      h("option", { value: v, selected: v === (value || "") }, schema.label(enumName, v))));
  }
  function errorLine() { return h("p", { class: "error-text", role: "alert", hidden: true }); }

  /* Who drafted an AI item, when, and with which tool. */
  function aiOrigin(g, checkbox, checkLabel) {
    const bits = [schema.label("aiProvider", g.provider), g.model, schema.label("aiSurface", g.surface).toLowerCase(), g.at ? formatDate(g.at) : ""].filter(Boolean);
    return h("div", { class: "ai-origin" + (g.reviewed ? " reviewed" : "") }, icon("agent"),
      h("div", { class: "grow" },
        h("strong", null, g.reviewed ? "AI draft, reviewed" + (g.reviewedAt ? " " + formatDate(g.reviewedAt) : "") : "AI draft, not reviewed"),
        h("div", { class: "small muted" }, "Drafted by " + bits.join(", ") + ". Unreviewed AI drafts stay out of the handoff and exports."),
        checkbox ? h("label", { class: "check" }, checkbox, checkLabel) : null));
  }

  function nodeOptions(model, selected) {
    const sel = new Set(selected || []);
    return model.lanes.map(lane => {
      const nodes = model.nodes.filter(n => n.laneId === lane.id);
      if (!nodes.length) return null;
      return h("optgroup", { label: lane.name }, nodes.map(n => h("option", { value: n.id, selected: sel.has(n.id) }, n.label + (n.removed ? " (removed)" : ""))));
    });
  }

  /**
   * Opens the record form. `record` is an existing record or defaults for a
   * new one. app provides store access and dispatch.
   */
  function recordDialog(app, record) {
    const e = app.store.get();
    const existing = !!(record && record.id && e.records.some(r => r.id === record.id));
    const r = Object.assign({ kind: "note", title: "", description: "", owner: "", status: "open", priority: "",
      linkedModelId: (e.models.find(m => m.role === "current") || {}).id || null, linkedNodeIds: [], evidenceRefs: [],
      sensitive: false, includeInHandoff: true, opportunity: null }, record || {});
    const o = Object.assign({ intervention: "", simplerAlternative: "", expectedBenefit: "", affectedVolume: "", effort: "",
      risk: "", dependencies: "", validationAction: "", aiAssessment: {} }, r.opportunity || {});
    const ai = Object.assign({ inputStructure: "", dataAvailability: "", judgment: "", exceptions: "", authority: "",
      humanReview: "", auditability: "", failureHandling: "", mode: "" }, o.aiAssessment || {});

    const kind = select("recordKind", r.kind);
    const title = input(r.title, { maxlength: 300, required: true, autocomplete: "off" });
    const desc = textarea(r.description, 4);
    const owner = input(r.owner, { maxlength: 200, list: "rec-owner-list", autocomplete: "off" });
    const status = select("recordStatus", r.status);
    const priority = select("priority", r.priority);
    const modelSel = h("select", { class: "select" }, h("option", { value: "" }, "Not linked to a model"),
      e.models.map(m => h("option", { value: m.id, selected: m.id === r.linkedModelId }, m.name)));
    const steps = h("select", { class: "select", multiple: true, size: 8 });
    const fillSteps = selected => {
      while (steps.firstChild) steps.removeChild(steps.firstChild);
      const m = e.models.find(x => x.id === modelSel.value);
      if (m) nodeOptions(m, selected).forEach(g => g && steps.appendChild(g));
      steps.disabled = !m;
    };
    fillSteps(r.linkedNodeIds);
    modelSel.addEventListener("change", () => fillSteps([]));
    const evidence = h("select", { class: "select", multiple: true, size: Math.min(6, Math.max(2, e.evidence.length)) },
      e.evidence.map(x => h("option", { value: x.id, selected: r.evidenceRefs.includes(x.id) }, x.title)));
    const sensitive = h("input", { type: "checkbox", checked: r.sensitive });
    const handoff = h("input", { type: "checkbox", checked: r.includeInHandoff });
    const g = existing ? r.generated : null;
    const aiReviewed = g ? h("input", { type: "checkbox", checked: g.reviewed }) : null;

    const intervention = h("select", { class: "select" }, schema.ENUMS.intervention.map(v =>
      h("option", { value: v, selected: v === o.intervention }, schema.label("intervention", v))));
    const simpler = textarea(o.simplerAlternative, 2);
    const benefit = textarea(o.expectedBenefit, 2);
    const volume = input(o.affectedVolume, { maxlength: 500 });
    const effort = select("effortSize", o.effort);
    const risk = textarea(o.risk, 2);
    const deps = textarea(o.dependencies, 2);
    const validation = textarea(o.validationAction, 2);
    const aiFields = {
      inputStructure: textarea(ai.inputStructure, 2), dataAvailability: textarea(ai.dataAvailability, 2),
      judgment: textarea(ai.judgment, 2), exceptions: textarea(ai.exceptions, 2), authority: textarea(ai.authority, 2),
      humanReview: textarea(ai.humanReview, 2), auditability: textarea(ai.auditability, 2), failureHandling: textarea(ai.failureHandling, 2)
    };
    const mode = h("select", { class: "select" },
      [["", "Not decided"], ["assist", "Assistance: a person decides"], ["autonomous", "Autonomous action within set limits"]].map(([v, l]) =>
        h("option", { value: v, selected: v === ai.mode }, l)));
    const aiBlock = h("fieldset", { class: "form-grid", style: { border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "var(--space-3)" } },
      h("legend", { class: "field-label" }, "AI assessment"),
      h("p", { class: "note" }, "A human review label on a diagram describes a check without enforcing it. Record who can act, what they review and what happens when the AI is wrong."),
      field("Mode", mode),
      h("div", { class: "field-row" },
        field("Input structure", aiFields.inputStructure), field("Data availability", aiFields.dataAvailability)),
      h("div", { class: "field-row" },
        field("Judgment required", aiFields.judgment), field("Exception conditions", aiFields.exceptions)),
      h("div", { class: "field-row" },
        field("Action authority", aiFields.authority), field("Human review", aiFields.humanReview)),
      h("div", { class: "field-row" },
        field("Auditability", aiFields.auditability), field("Failure handling", aiFields.failureHandling)));
    // Sections registered with BPMVIZ.ext.registerRecordDialogSection: { el, collect() -> patch, check() -> message or null }.
    const extCtx = B.ext.context(app, {});
    const extSections = B.ext.list("recordDialogSection").map(def => {
      const out = B.ext.guard("recordDialogSection", def, () => def.render(r, extCtx), null);
      return out && out.el instanceof Node ? { def, out } : null;
    }).filter(Boolean);
    const oppBlock = h("fieldset", { class: "form-grid", style: { border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "var(--space-3)" } },
      h("legend", { class: "field-label" }, "Opportunity"),
      h("div", { class: "field-row" }, field("Intervention", intervention), field("Effort", effort)),
      field("Why not a simpler option?", simpler, "For example: why automate rather than eliminate or standardize the step."),
      field("Expected benefit", benefit),
      field("Affected volume", volume),
      h("div", { class: "field-row" }, field("Risk", risk), field("Dependencies", deps)),
      field("Next validation action", validation),
      extSections.map(x => x.out.el),
      aiBlock);
    const syncKind = () => {
      oppBlock.hidden = kind.value !== "opportunity";
      aiBlock.hidden = !(intervention.value === "ai-assist" || intervention.value === "ai-agent");
      extSections.forEach(x => { x.out.el.hidden = !x.def.kinds.includes(kind.value); });
    };
    const activeSections = () => extSections.filter(x => x.def.kinds.includes(kind.value));
    kind.addEventListener("change", syncKind);
    intervention.addEventListener("change", syncKind);
    syncKind();
    const err = errorLine();
    const owners = [...new Set(e.records.map(x => x.owner).filter(Boolean))];
    const body = h("form", { class: "form-grid", novalidate: true },
      g ? aiOrigin(g, aiReviewed, "I checked this record against the sources") : null,
      h("div", { class: "field-row" }, field("Type", kind), field("Status", status), field("Priority", priority)),
      field("Title", title),
      field("Details", desc),
      h("div", { class: "field-row" }, field("Owner", owner), field("Linked model", modelSel)),
      field("Linked steps", steps, "Ctrl or Cmd to select several."),
      e.evidence.length ? field("Evidence", evidence) : null,
      h("label", { class: "check" }, sensitive, "Sensitive: leave out of exports and the handoff unless selected"),
      h("label", { class: "check" }, handoff, "Include in the client handoff"),
      oppBlock, err, h("datalist", { id: "rec-owner-list" }, owners.map(x => h("option", { value: x }))));
    body.addEventListener("submit", ev => ev.preventDefault());

    const collectBase = () => ({
      kind: kind.value, title: title.value, description: desc.value, owner: owner.value, status: status.value,
      priority: priority.value, linkedModelId: modelSel.value || null,
      linkedNodeIds: Array.from(steps.selectedOptions).map(x => x.value),
      evidenceRefs: Array.from(evidence.selectedOptions || []).map(x => x.value),
      sensitive: sensitive.checked, includeInHandoff: handoff.checked,
      aiReviewed: aiReviewed ? aiReviewed.checked : undefined,
      opportunity: kind.value === "opportunity" ? {
        intervention: intervention.value, simplerAlternative: simpler.value, expectedBenefit: benefit.value,
        affectedVolume: volume.value, effort: effort.value, risk: risk.value, dependencies: deps.value,
        validationAction: validation.value,
        aiAssessment: Object.assign(Object.fromEntries(Object.keys(aiFields).map(k => [k, aiFields[k].value])), { mode: mode.value })
      } : null
    });
    const collect = () => {
      const payload = collectBase();
      if (payload.opportunity) {
        activeSections().forEach(x => {
          const patch = typeof x.out.collect === "function" ? B.ext.guard("recordDialogSection", x.def, () => x.out.collect(), null) : null;
          if (patch && typeof patch === "object") Object.assign(payload.opportunity, patch);
        });
      }
      return payload;
    };

    const actions = [];
    if (existing) {
      actions.push({ label: "Delete", variant: "btn-danger", keepOpen: true, onClick: api => {
        confirmDialog("Delete this record?", "\"" + r.title + "\" will be removed. You can undo this from the menu.", "Delete", true).then(ok => {
          if (ok && app.dispatch("record/delete", { id: r.id }, "Record deleted")) api.close();
        });
        return false;
      } });
    }
    actions.push({ label: "Cancel" });
    actions.push({ label: existing ? "Save record" : "Add record", variant: "btn-primary", keepOpen: true, onClick: api => {
      if (!title.value.trim()) { err.hidden = false; err.textContent = "Give the record a title."; title.focus(); return false; }
      const problem = activeSections().map(x => (typeof x.out.check === "function" ? B.ext.guard("recordDialogSection", x.def, () => x.out.check(), null) : null)).find(Boolean);
      if (problem) { err.hidden = false; err.textContent = String(problem); return false; }
      const payload = collect();
      const ok = existing ?
        app.dispatch("record/update", { id: r.id, patch: payload }, "Record saved", err) :
        app.dispatch("record/add", { record: payload }, schema.label("recordKind", payload.kind) + " added", err);
      if (ok) api.close();
      return false;
    } });
    return openDialog({ title: existing ? "Edit record" : "New record", eyebrow: "Workshop record", body, actions, initialFocus: existing ? "input" : "select" });
  }

  /* The executive summary that opens the handoff. Written by hand or accepted from an AI draft. */
  function summaryDialog(app) {
    const e = app.store.get();
    const n = (e.narratives || []).find(x => x.kind === "executive-summary") || null;
    const g = n && n.generated;
    const title = input(n ? n.title : "Executive summary", { maxlength: 300 });
    const text = textarea(n ? n.text : "", 14);
    text.maxLength = 12000;
    const reviewed = h("input", { type: "checkbox", checked: !!n && n.status === "reviewed" });
    const err = errorLine();
    const body = h("form", { class: "form-grid", novalidate: true },
      g ? aiOrigin(g, null) : null,
      h("p", { class: "small" }, "The summary opens the printed handoff. Separate paragraphs with a blank line; lines that start with a hyphen print as a list."),
      field("Title", title),
      field("Summary", text),
      h("label", { class: "check" }, reviewed, g ? "Reviewed: I checked this AI draft against the engagement" : "Reviewed and ready for the handoff"),
      err);
    body.addEventListener("submit", ev => ev.preventDefault());
    const actions = [];
    if (n) {
      actions.push({ label: "Delete", variant: "btn-danger", keepOpen: true, onClick: api => {
        confirmDialog("Delete the executive summary?", "The summary will be removed from the handoff. You can undo this from the menu.", "Delete", true).then(ok => {
          if (ok && app.dispatch("narrative/delete", { kind: "executive-summary" }, "Summary deleted")) api.close();
        });
        return false;
      } });
    }
    actions.push({ label: "Cancel" });
    actions.push({ label: "Save summary", variant: "btn-primary", keepOpen: true, onClick: api => {
      if (!text.value.trim()) { err.hidden = false; err.textContent = "Write the summary text first."; text.focus(); return false; }
      const ok = app.dispatch("narrative/set", { kind: "executive-summary", title: title.value, text: text.value,
        status: reviewed.checked ? "reviewed" : "draft" }, "Summary saved", err);
      if (ok) api.close();
      return false;
    } });
    return openDialog({ title: n ? "Edit the executive summary" : "Write an executive summary", eyebrow: "Handoff summary", body, actions, wide: true, initialFocus: "textarea" });
  }

  function evidenceDialog(app, evidence) {
    const e = app.store.get();
    const existing = !!(evidence && evidence.id && e.evidence.some(x => x.id === evidence.id));
    const v = Object.assign({ title: "", locator: "", extractedFact: "", status: "unreviewed", reviewer: "", reviewDate: "", link: "" }, evidence || {});
    const title = input(v.title, { maxlength: 300 });
    const locator = input(v.locator, { maxlength: 500 });
    const fact = textarea(v.extractedFact, 3);
    const status = select("evidenceStatus", v.status);
    const reviewer = input(v.reviewer, { maxlength: 200 });
    const date = input(v.reviewDate, { type: "date" });
    const link = input(v.link || "", { type: "url", placeholder: "https://" });
    const err = errorLine();
    const body = h("form", { class: "form-grid", novalidate: true },
      field("Source title", title, "The document, system extract, interview or observation."),
      field("Locator", locator, "Page, section, sheet, timestamp or file name."),
      field("Fact taken from the source", fact),
      h("div", { class: "field-row" }, field("Review status", status), field("Reviewer", reviewer), field("Review date", date)),
      field("Link", link, "Optional. Only http and https links are kept."),
      h("p", { class: "note" }, "A source marked unavailable stays in the record so the gap is visible."),
      err);
    body.addEventListener("submit", ev => ev.preventDefault());
    const actions = [];
    if (existing) {
      actions.push({ label: "Delete", variant: "btn-danger", keepOpen: true, onClick: api => {
        confirmDialog("Delete this source?", "References to it from steps and records will be removed.", "Delete", true).then(ok => {
          if (ok && app.dispatch("evidence/delete", { id: v.id }, "Source deleted")) api.close();
        });
        return false;
      } });
    }
    actions.push({ label: "Cancel" });
    actions.push({ label: existing ? "Save source" : "Add source", variant: "btn-primary", keepOpen: true, onClick: api => {
      const payload = { title: title.value, locator: locator.value, extractedFact: fact.value, status: status.value,
        reviewer: reviewer.value, reviewDate: date.value, link: link.value };
      const ok = existing ? app.dispatch("evidence/update", { id: v.id, patch: payload }, "Source saved", err) :
        app.dispatch("evidence/add", { evidence: payload }, "Source added", err);
      if (ok) api.close();
      return false;
    } });
    return openDialog({ title: existing ? "Edit source" : "Add a source", eyebrow: "Evidence", body, actions });
  }

  function settingsDialog(app) {
    const m = app.store.get().meta;
    const client = input(m.clientDisplayName, { maxlength: 200 });
    const engagement = input(m.engagementName, { maxlength: 200 });
    const process = input(m.processName, { maxlength: 200 });
    const conf = select("confidentiality", m.confidentiality);
    const data = select("dataStatus", m.dataStatus);
    const cal = select("timeCalendar", m.timeBasis.calendar);
    const perDay = input(m.timeBasis.businessMinutesPerDay, { type: "number", min: 1, max: 1440, step: 1 });
    const currency = input(m.currency, { maxlength: 3, pattern: "[A-Z]{3}" });
    const disclosure = textarea(m.disclosure, 2);
    const summary = textarea(m.summary, 3);
    const err = errorLine();
    const body = h("form", { class: "form-grid", novalidate: true },
      h("div", { class: "field-row" }, field("Client display name", client), field("Engagement", engagement)),
      field("Process name", process),
      h("div", { class: "field-row" }, field("Confidentiality", conf), field("Data status", data, "Shown on every screen and export.")),
      h("div", { class: "field-row" }, field("Timing calendar", cal), field("Minutes in a business day", perDay), field("Currency", currency, "ISO code, such as USD or EUR.")),
      field("Disclosure", disclosure, "Printed in the footer and on the handoff summary."),
      field("Summary", summary),
      err);
    body.addEventListener("submit", ev => ev.preventDefault());
    return openDialog({ title: "Engagement settings", body, actions: [
      { label: "Cancel" },
      { label: "Save settings", variant: "btn-primary", keepOpen: true, onClick: api => {
        const ok = app.dispatch("meta/update", { patch: {
          clientDisplayName: client.value, engagementName: engagement.value, processName: process.value,
          confidentiality: conf.value, dataStatus: data.value, currency: currency.value.toUpperCase(),
          disclosure: disclosure.value, summary: summary.value,
          timeBasis: { calendar: cal.value, businessMinutesPerDay: Number(perDay.value) }
        } }, "Settings saved", err);
        if (ok) api.close();
        return false;
      } }
    ] });
  }

  function insertStepDialog(app, modelId, nodeId) {
    const e = app.store.get();
    const model = e.models.find(m => m.id === modelId);
    const node = model.nodes.find(n => n.id === nodeId);
    const outs = model.edges.filter(x => x.from === nodeId && !x.removed);
    if (!outs.length) { B.dialogs.messageDialog("Nothing to insert after", node.label + " has no outgoing connector, so there is nowhere to insert a step."); return; }
    const label = input("", { maxlength: 300 });
    const edge = h("select", { class: "select" }, outs.map(x => {
      const to = model.nodes.find(n => n.id === x.to);
      return h("option", { value: x.id }, "Before " + (to ? to.label : x.to) + (x.label ? " (" + x.label + ")" : ""));
    }));
    const lane = h("select", { class: "select" }, model.lanes.map(l => h("option", { value: l.id, selected: l.id === node.laneId }, l.name)));
    const type = h("select", { class: "select" }, ["task", "userTask", "serviceTask", "manualTask", "exclusiveGateway", "parallelGateway"].map(t =>
      h("option", { value: t }, schema.SEMANTIC_TYPES[t].label)));
    const desc = textarea("", 2);
    const why = textarea("", 2);
    const err = errorLine();
    const body = h("form", { class: "form-grid", novalidate: true },
      h("p", { class: "small" }, "The new step goes after " + node.label + ". The connector you choose is split around it."),
      field("Step name", label), outs.length > 1 ? field("Connector", edge) : null,
      h("div", { class: "field-row" }, field("Swimlane", lane), field("Step type", type)),
      field("Description", desc), field("Reason for the change", why), err);
    body.addEventListener("submit", ev => ev.preventDefault());
    openDialog({ title: "Insert a step", eyebrow: model.name, body, actions: [
      { label: "Cancel" },
      { label: "Insert step", variant: "btn-primary", keepOpen: true, onClick: api => {
        const ok = app.dispatch("model/insertStep", { modelId, edgeId: edge.value, label: label.value, laneId: lane.value,
          semanticType: type.value, description: desc.value, rationale: why.value }, "Step inserted", err);
        if (ok) api.close();
        return false;
      } }
    ] });
  }

  function removeStepDialog(app, modelId, nodeId) {
    const e = app.store.get();
    const model = e.models.find(m => m.id === modelId);
    const node = model.nodes.find(n => n.id === nodeId);
    const why = textarea("", 3);
    const err = errorLine();
    const body = h("form", { class: "form-grid", novalidate: true },
      h("p", { class: "small" }, node.label + " stays in the draft marked as removed, and its neighbours are connected directly. The baseline is not affected."),
      field("Reason for removing it", why), err);
    body.addEventListener("submit", ev => ev.preventDefault());
    openDialog({ title: "Remove " + node.label + "?", eyebrow: model.name, body, actions: [
      { label: "Cancel" },
      { label: "Remove step", variant: "btn-danger", keepOpen: true, onClick: api => {
        const ok = app.dispatch("model/removeStep", { modelId, nodeId, rationale: why.value }, node.label + " removed from the draft", err);
        if (ok) api.close();
        return false;
      } }
    ] });
  }

  B.forms = { recordDialog, evidenceDialog, summaryDialog, aiOrigin, settingsDialog, insertStepDialog, removeStepDialog, field, input, textarea, select };
})(typeof globalThis !== "undefined" ? globalThis : this);
