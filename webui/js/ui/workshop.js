/* Workshop facilitation, step automation design and printable pilot closure. */
(function (root) {
  "use strict";
  const B = root.AIxRay = root.AIxRay || {};
  const W = B.workshop;
  const { h, clear, downloadBlob } = B.dom;
  const { field, input, textarea } = B.forms;
  W.registerStoreCommands(B.store);
  B.ext.registerRefreshEvent("workshop/");
  const labels = { trigger: "Trigger", inputs: "Inputs", outputs: "Outputs", systems: "Systems", rules: "Rules and limits", approval: "Approval", fallback: "Fallback and escalation", testCriteria: "Test criteria" };
  const responsibilities = { human: "Human", rules: "Rules", "ai-assist": "AI assist", agent: "Agent" };
  const selections = new Map();
  const get = e => W.sanitizeWorkshop(e.workshop, e) || { agenda: [], designs: [], checkpoint: null, currentModelId: null, futureModelId: null };
  const errLine = () => h("p", { class: "error-text", role: "alert", hidden: true });
  function button(label, fn, primary) { return h("button", { type: "button", class: "btn" + (primary ? " btn-primary" : ""), on: { click: fn } }, label); }
  function select(options, value, attrs) { return h("select", Object.assign({ class: "select" }, attrs || {}), options.map(([v, label]) => h("option", { value: v, selected: v === value }, label))); }
  function check(label, checked) { const control = h("input", { type: "checkbox", checked }); return { control, el: h("label", { class: "check" }, control, label) }; }
  function section(title, ...body) { return h("section", { class: "card workshop-section" }, h("h3", null, title), body); }
  function exportBrief(app) { downloadBlob(new Blob([W.pilotBriefText(app.store.get())], { type: "text/plain;charset=utf-8" }), B.exporting.fileBase(app.store.get()) + "-pilot-brief.txt"); }

  function modelsForm(ctx, w) {
    const e = ctx.engagement, error = errLine();
    const opts = role => [["", "Not agreed"]].concat(e.models.filter(m => m.role === role).map(m => [m.id, m.name + " (v" + m.version + ")"]));
    const current = select(opts("current"), w.currentModelId || "", { id: "workshop-current" });
    const future = select(opts("future"), w.futureModelId || "", { id: "workshop-future" });
    return section("Agreed processes", h("div", { class: "field-row" }, field("Current process", current), field("Future process", future)),
      button("Agree processes", () => ctx.dispatch("workshop/setModels", { currentModelId: current.value || null, futureModelId: future.value || null }, "Processes agreed", error)), error);
  }

  function agendaForm(ctx, w) {
    const error = errLine(), body = h("div", { class: "workshop-agenda" });
    const rows = [];
    function add(item) {
      const x = item || { id: B.util.uid("agenda"), title: "", owner: "", minutes: 15, status: "planned" };
      const title = input(x.title, { maxlength: 300, "aria-label": "Agenda title" });
      const owner = input(x.owner, { maxlength: 200, "aria-label": "Agenda owner" });
      const minutes = input(x.minutes, { type: "number", min: 1, max: 480, "aria-label": "Agenda minutes" });
      const status = select([ ["planned", "Planned"], ["active", "Active"], ["done", "Done"] ], x.status, { "aria-label": "Agenda status" });
      const row = { id: x.id, title, owner, minutes, status };
      row.el = h("div", { class: "workshop-agenda-row" }, field("Agenda item", title), field("Owner", owner), field("Minutes", minutes), field("Status", status),
        button("Move up", () => { const i = rows.indexOf(row); if (i > 0) { const prev = rows[i - 1]; rows[i - 1] = row; rows[i] = prev; body.insertBefore(row.el, prev.el); } }),
        button("Remove", () => { rows.splice(rows.indexOf(row), 1); row.el.remove(); }));
      rows.push(row); body.appendChild(row.el);
    }
    w.agenda.forEach(add);
    return section("Agenda", h("p", { class: "small" }, "Plan the discussion, name an owner and mark the active item. Save agenda changes before leaving this tab."), body,
      h("div", { class: "form-actions" }, button("Add agenda item", () => add()), button("Save agenda", () => ctx.dispatch("workshop/saveAgenda", { agenda: rows.map(r => ({ id: r.id, title: r.title.value, owner: r.owner.value, minutes: Number(r.minutes.value), status: r.status.value })) }, "Agenda saved", error), true)), error);
  }

  function findings(ctx) {
    const e = ctx.engagement;
    const records = e.records.filter(r => ["question", "note", "action"].includes(r.kind));
    return section("Parking lot and actions", h("p", { class: "small" }, "Capture questions for later and assign actions in the finding form. Findings retain their sensitivity and AI review status."),
      h("div", { class: "form-actions" }, [ ["question", "Park a question"], ["note", "Add a note"], ["pain", "Quick finding"], ["action", "Add an action"] ].map(([kind, label]) => button(label, () => B.forms.recordDialog(ctx.app, { kind })))),
      records.length ? h("ul", { class: "plain-list workshop-records" }, records.map(r => h("li", null,
        button(r.title, () => B.forms.recordDialog(ctx.app, r)), h("span", { class: "small" }, " " + B.schema.label("recordKind", r.kind) + " | " + (r.owner || "Unassigned") + " | " + B.schema.label("recordStatus", r.status) + (r.sensitive ? " | Sensitive" : "") + (r.generated && !r.generated.reviewed ? " | AI draft, not reviewed" : ""))))) : h("p", { class: "muted small" }, "No parked questions or actions yet."));
  }

  function designEditor(ctx, model, node) {
    const e = ctx.engagement, w = get(e), d = w.designs.find(x => x.modelId === model.id && x.nodeId === node.id) || {};
    const error = errLine(), controls = {};
    W.DESIGN_FIELDS.forEach(k => { controls[k] = textarea(d[k] || "", 2); controls[k].maxLength = W.LIMITS.text; });
    const owner = input(d.owner || "", { maxlength: 200 });
    const responsibility = select(Object.entries(responsibilities), d.responsibility || "human");
    const sensitive = check("Sensitive: keep this design out of the pilot brief", d.sensitive);
    const reviewed = check("Reviewed: I checked this design, its limits and test criteria", d.reviewed);
    const collect = () => Object.assign({ modelId: model.id, nodeId: node.id, owner: owner.value, responsibility: responsibility.value, sensitive: sensitive.control.checked, reviewed: reviewed.control.checked }, Object.fromEntries(W.DESIGN_FIELDS.map(k => [k, controls[k].value])));
    return h("div", { class: "workshop-design form-grid" },
      h("p", { class: "small" }, "Record what starts the work, what it may do, when a person approves it and how failure is handled. Reviewed designs require every field and an owner."),
      field("Design owner", owner), field("Responsibility", responsibility), W.DESIGN_FIELDS.map(k => field(labels[k], controls[k])), sensitive.el, reviewed.el,
      h("div", { class: "form-actions" }, button("Save automation design", () => ctx.dispatch("workshop/saveDesign", { design: collect() }, "Automation design saved", error), true),
        d.nodeId ? button("Delete automation design", () => ctx.dispatch("workshop/deleteDesign", { modelId: model.id, nodeId: node.id }, "Automation design removed", error)) : null), error);
  }
  function designsSection(ctx, w) {
    const e = ctx.engagement;
    const remembered = selections.get(e.id) || {};
    const modelId = e.models.some(m => m.id === remembered.modelId) ? remembered.modelId : w.futureModelId || w.currentModelId || e.models[0].id;
    const model = select(e.models.map(m => [m.id, m.name]), modelId, { id: "workshop-design-model" });
    const node = select([], "", { id: "workshop-design-step" }), host = h("div");
    function show() {
      clear(host);
      const m = e.models.find(m => m.id === model.value), n = m.nodes.find(n => n.id === node.value);
      selections.set(e.id, { modelId: model.value, nodeId: node.value });
      if (n) host.appendChild(designEditor(ctx, m, n));
    }
    function fill() {
      clear(node);
      const m = e.models.find(m => m.id === model.value), prior = selections.get(e.id);
      m.nodes.filter(n => !n.removed).forEach(n => node.appendChild(h("option", { value: n.id, selected: !!prior && prior.modelId === m.id && prior.nodeId === n.id }, n.label)));
      show();
    }
    model.addEventListener("change", fill); node.addEventListener("change", show); fill();
    return section("Step automation designs", h("div", { class: "field-row" }, field("Process", model), field("Step", node)), host);
  }

  function checkpointForm(ctx, w) {
    const c = w.checkpoint || {}, status = W.checkpointStatus(ctx.engagement), error = errLine();
    const reviewer = input(c.reviewer || "", { maxlength: 200, id: "workshop-reviewer" });
    const date = input(c.date || new Date().toISOString().slice(0, 10), { type: "date", id: "workshop-date" });
    const sensitive = check("Sensitive: keep all checkpoint details out of the pilot brief", c.sensitive);
    const reviewed = check("Reviewed: these checkpoint details and criteria may be shared", c.reviewed);
    const criteriaBody = h("div", { class: "workshop-criteria" }), criteria = [];
    function addCriterion(value) {
      const x = value || { id: B.util.uid("criterion"), text: "", owner: "" };
      const t = textarea(x.text, 2), owner = input(x.owner, { maxlength: 200 }); t.maxLength = 1000;
      const row = { id: x.id, text: t, owner };
      const el = h("div", { class: "workshop-criterion" }, field("Acceptance criterion", t), field("Criterion owner", owner), button("Remove criterion", () => { criteria.splice(criteria.indexOf(row), 1); el.remove(); }));
      criteria.push(row); criteriaBody.appendChild(el);
    }
    if (c.criteria && c.criteria.length) c.criteria.forEach(addCriterion); else addCriterion();
    const records = ctx.engagement.records;
    const choices = (label, ids) => {
      const control = select(records.map(r => [r.id, r.title + " | " + (r.owner || "Unassigned")]), "", { multiple: true, size: Math.min(6, Math.max(2, records.length)), "aria-label": label });
      Array.from(control.options).forEach(o => { o.selected = (ids || []).includes(o.value); });
      return control;
    };
    const accepted = choices("Accepted changes", c.acceptedRecordIds), unresolved = choices("Unresolved issues", c.unresolvedRecordIds);
    return section("Checkpoint and pilot acceptance", h("p", { class: "workshop-checkpoint-status", role: "status", "data-status": status.status }, status.message),
      c.fingerprint ? h("p", { class: "small muted" }, "Captured " + c.date + " by " + c.reviewer + ". " + c.fingerprint) : null,
      h("p", { class: "small" }, "Capture the agreed processes and designs with a reviewer, accepted changes, unresolved issues and measurable pilot acceptance criteria. Each criterion needs an accountable owner."),
      h("div", { class: "field-row" }, field("Reviewer", reviewer), field("Review date", date)),
      h("div", { class: "field-row" }, field("Accepted changes", accepted), field("Unresolved issues", unresolved)),
      criteriaBody, button("Add acceptance criterion", () => addCriterion()), sensitive.el, reviewed.el,
      h("div", { class: "form-actions" }, button("Capture checkpoint", () => ctx.dispatch("workshop/checkpoint", { checkpoint: {
        reviewer: reviewer.value, date: date.value, acceptedRecordIds: Array.from(accepted.selectedOptions).map(o => o.value), unresolvedRecordIds: Array.from(unresolved.selectedOptions).map(o => o.value),
        criteria: criteria.map(r => ({ id: r.id, text: r.text.value, owner: r.owner.value })), sensitive: sensitive.control.checked, reviewed: reviewed.control.checked
      } }, "Checkpoint captured", error), true), c.fingerprint ? button("Clear checkpoint", () => ctx.dispatch("workshop/clearCheckpoint", {}, "Checkpoint cleared", error)) : null), error);
  }

  function renderWorkshop(panel, ctx) {
    const w = get(ctx.engagement);
    panel.appendChild(h("div", { class: "workshop", id: "workshop-panel" },
      h("div", { class: "page-head" }, h("div", null, h("h2", null, "Workshop"), h("p", null, "Agree the process, capture the design and close with an owned pilot.")),
        h("div", { class: "form-actions" }, button("Open pilot brief", () => { ctx.app.goto("present"); ctx.app.presentView.setMode("pilot-brief"); }), button("Download pilot brief", () => exportBrief(ctx.app)))),
      modelsForm(ctx, w), agendaForm(ctx, w), findings(ctx), ctx.engagement.models.length ? designsSection(ctx, w) : null, checkpointForm(ctx, w)));
  }
  function briefArticle(e) {
    const b = W.buildPilotBrief(e), c = b.checkpoint;
    const recordList = xs => xs.length ? h("ul", null, xs.map(x => h("li", null, x.title + " | Owner: " + (x.owner || "Unassigned") + " | " + x.status))) : h("p", null, "None recorded for sharing.");
    return h("article", { class: "handoff-doc workshop-brief" }, h("h2", null, b.title), h("p", { class: "workshop-brief-status" }, b.message), h("p", { class: "small" }, b.exclusions),
      h("h3", null, "Agreed processes"), b.models.length ? h("ul", null, b.models.map(m => h("li", null, m.role + ": " + m.name + " (" + m.id + ")"))) : h("p", null, "No reviewed process agreed for sharing."),
      c ? [h("h3", null, "Checkpoint"), h("p", null, c.reviewer + " | " + c.date + " | " + c.fingerprint),
        h("p", { class: "small" }, c.modelVersions.map(m => m.modelId + " v" + m.version).join(", ")),
        h("h3", null, "Pilot acceptance criteria"), h("ul", null, c.criteria.map(x => h("li", null, x.text + " | Owner: " + x.owner))),
        h("h3", null, "Accepted changes"), recordList(c.accepted), h("h3", null, "Unresolved issues"), recordList(c.unresolved)] : null,
      h("h3", null, "Automation designs"), b.designs.length ? b.designs.map(d => h("section", { class: "workshop-brief-design" }, h("h4", null, d.step),
        h("p", null, "Owner: " + (d.owner || "Unassigned") + " | Responsibility: " + responsibilities[d.responsibility]),
        h("dl", { class: "facts" }, W.DESIGN_FIELDS.map(k => [h("dt", null, labels[k]), h("dd", null, d[k] || "Not recorded")])))) : h("p", null, "No reviewed designs available for sharing."),
      h("h3", null, "Actions"), recordList(b.actions));
  }
  B.ext.registerRecordsTab({ id: "workshop", label: "Workshop", count: e => get(e).agenda.length, render: renderWorkshop });
  B.ext.registerDrawerSection({ id: "workshop-design", where: "step", render: (ctx, model, node) => node.removed ? null : h("details", { class: "workshop-drawer" }, h("summary", null, "Automation design"), designEditor(ctx, model, node)) });
  B.ext.registerPresentMode({ id: "pilot-brief", label: "Pilot brief", printable: true, render: (content, ctx) => content.appendChild(briefArticle(ctx.engagement)) });
  B.ext.registerPresentAction({ id: "pilot-brief", order: -10, icon: "download", label: "Pilot brief text", run: app => exportBrief(app) });
  B.ext.registerHandoffSection({ id: "workshop", after: "end", render: (hd, ctx) => ctx.engagement.workshop ? briefArticle(ctx.engagement) : null });
  B.workshopUi = { renderWorkshop, designEditor, briefArticle };
})(typeof globalThis !== "undefined" ? globalThis : this);
