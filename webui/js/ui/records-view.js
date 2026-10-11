/*
 * Records workspace: workshop records, the opportunity register, evidence
 * sources and the review list of validation and migration findings.
 */
(function (root) {
  "use strict";
  const B = root.AIxRay = root.AIxRay || {};
  const { h, clear, icon, iconButton, formatDate, downloadBlob, announce } = B.dom;
  const { schema, exporting } = B;
  const badge = (t, tone) => B.drawer.badge(t, tone);
  const STATUS_TONE = { open: "", "in-progress": "info", done: "success", dropped: "" };
  const EV_TONE = { unreviewed: "", validated: "success", disputed: "warning", unavailable: "error" };

  function createRecordsView(app) {
    const el = {};
    const filters = { q: "", kind: "", status: "", owner: "", step: "", origin: "", handoff: false };
    const ORIGINS = [["", "Any origin"], ["workshop", "Workshop"], ["ai-draft", "AI draft, not reviewed"], ["ai-reviewed", "AI draft, reviewed"]];
    const originOf = r => !r.generated ? "workshop" : r.generated.reviewed ? "ai-reviewed" : "ai-draft";
    let tab = "records";
    let oppView = "register";
    const ctx = extra => B.ext.context(app, Object.assign({ rerender: render }, extra || {}));
    const customTab = () => B.ext.list("recordsTab").find(t => t.id === tab) || null;

    function eng() { return app.store.get(); }

    function stepLabels(e) {
      const map = new Map();
      e.models.forEach(m => m.nodes.forEach(n => map.set(m.id + "|" + n.id, { label: n.label, model: m })));
      return r => r.linkedNodeIds.map(id => {
        const key = r.linkedModelId ? r.linkedModelId + "|" + id : [...map.keys()].find(k => k.endsWith("|" + id));
        const hit = map.get(key);
        return { id, label: hit ? hit.label : id, modelId: hit ? hit.model.id : r.linkedModelId };
      });
    }

    function build() {
      el.tabs = h("div", { class: "subtabs", role: "tablist", "aria-label": "Record views" });
      el.panel = h("div", { role: "tabpanel", id: "rv-panel", tabindex: -1 });
      el.add = h("button", { type: "button", class: "btn btn-primary", id: "rv-add" }, icon("plus"), "Add record");
      el.csv = h("button", { type: "button", class: "btn", id: "rv-csv" }, icon("download"), "Export CSV");
      el.add.addEventListener("click", () => {
        if (tab === "evidence") B.forms.evidenceDialog(app, null);
        else app.openRecordDialog(tab === "opportunities" ? { kind: "opportunity" } : null);
      });
      el.csv.addEventListener("click", exportCsv);
      el.ai = B.aiPanel.enabled ? h("button", { type: "button", class: "btn", id: "rv-ai" }, icon("agent"), "Suggest with AI") : null;
      if (el.ai) el.ai.addEventListener("click", () => B.aiPanel.openTask(app, "opportunities"));
      el.root = h("div", { class: "ws-scroll" }, h("div", { class: "page" },
        h("div", { class: "page-head" },
          h("div", null, h("h2", null, "Workshop records"),
            h("p", null, "Pain points, opportunities, questions, decisions and actions captured against the process, with the sources behind them.")),
          h("div", { class: "form-actions", style: { marginTop: "0" } }, el.ai, el.csv, el.add)),
        el.tabs, el.panel));
      return el.root;
    }

    function renderTabs() {
      const e = eng();
      const opps = e.records.filter(r => r.kind === "opportunity").length;
      const review = app.reviewItems().length;
      const ext = B.ext.list("recordsTab");
      const items = [["records", "Records", e.records.length], ["opportunities", "Opportunities", opps],
        ["evidence", "Evidence", e.evidence.length]]
        .concat(ext.map(t => [t.id, t.label, t.count ? B.ext.guard("recordsTab", t, () => t.count(e), null) : null]))
        .concat([["review", "Review", review]]);
      if (!items.some(x => x[0] === tab)) tab = "records";
      const custom = ext.some(t => t.id === tab);
      clear(el.tabs);
      items.forEach(([id, label, count]) => {
        const b = h("button", { type: "button", class: "tab", role: "tab", id: "rv-tab-" + id, "aria-selected": String(tab === id),
          "aria-controls": "rv-panel", tabindex: tab === id ? 0 : -1 }, label, count === null || count === undefined ? null : h("span", { class: "count" }, String(count)));
        b.addEventListener("click", () => { tab = id; render(); });
        b.addEventListener("keydown", ev => {
          const i = items.findIndex(x => x[0] === id);
          const n = ev.key === "ArrowRight" ? items[(i + 1) % items.length] : ev.key === "ArrowLeft" ? items[(i + items.length - 1) % items.length] : null;
          if (n) { ev.preventDefault(); tab = n[0]; render(); el.tabs.querySelector("#rv-tab-" + n[0]).focus(); }
        });
        el.tabs.appendChild(b);
      });
      el.panel.setAttribute("aria-labelledby", "rv-tab-" + tab);
      el.add.hidden = tab === "review" || custom;
      el.add.lastChild.textContent = tab === "evidence" ? "Add source" : tab === "opportunities" ? "Add opportunity" : "Add record";
      el.csv.hidden = tab === "evidence" || tab === "review" || custom;
      if (el.ai) el.ai.hidden = tab === "evidence" || tab === "review" || custom;
    }

    function filtered(e) {
      const q = filters.q.trim().toLowerCase();
      const labels = stepLabels(e);
      return e.records.filter(r => {
        if (tab === "opportunities" && r.kind !== "opportunity") return false;
        if (filters.kind && r.kind !== filters.kind) return false;
        if (filters.status && r.status !== filters.status) return false;
        if (filters.owner && r.owner !== filters.owner) return false;
        if (filters.step && !r.linkedNodeIds.includes(filters.step)) return false;
        if (filters.origin && originOf(r) !== filters.origin) return false;
        if (filters.handoff && !r.includeInHandoff) return false;
        if (q && !(r.title + " " + r.description + " " + r.owner + " " + labels(r).map(x => x.label).join(" ")).toLowerCase().includes(q)) return false;
        return true;
      });
    }

    function filterBar(e) {
      const owners = [...new Set(e.records.map(r => r.owner).filter(Boolean))].sort();
      const current = e.models.find(m => m.role === "current");
      const linked = new Set(e.records.flatMap(r => r.linkedNodeIds));
      const steps = e.models.flatMap(m => m.nodes.filter(n => linked.has(n.id)).map(n => ({ id: n.id, label: n.label + (m !== current ? " (" + m.name + ")" : "") })));
      const mk = (id, label, control) => { control.id = id; return h("div", { class: "field" + (id === "rf-q" ? " grow" : "") }, h("label", { for: id }, label), control); };
      const q = h("input", { class: "input", type: "search", value: filters.q, placeholder: "Title, details, owner or step" });
      const kind = h("select", { class: "select" }, h("option", { value: "" }, "All types"), schema.ENUMS.recordKind.map(k => h("option", { value: k, selected: k === filters.kind }, schema.label("recordKind", k))));
      const status = h("select", { class: "select" }, h("option", { value: "" }, "Any status"), schema.ENUMS.recordStatus.map(k => h("option", { value: k, selected: k === filters.status }, schema.label("recordStatus", k))));
      const owner = h("select", { class: "select" }, h("option", { value: "" }, "Any owner"), owners.map(o => h("option", { value: o, selected: o === filters.owner }, o)));
      const step = h("select", { class: "select" }, h("option", { value: "" }, "Any step"), steps.map(s => h("option", { value: s.id, selected: s.id === filters.step }, s.label)));
      const origin = h("select", { class: "select" }, ORIGINS.map(([v, l]) => h("option", { value: v, selected: v === filters.origin }, l)));
      const handoff = h("input", { type: "checkbox", checked: filters.handoff });
      q.addEventListener("input", () => { filters.q = q.value; renderTable(); });
      [[kind, "kind"], [status, "status"], [owner, "owner"], [step, "step"], [origin, "origin"]].forEach(([c, k]) => c.addEventListener("change", () => { filters[k] = c.value; renderTable(); }));
      handoff.addEventListener("change", () => { filters.handoff = handoff.checked; renderTable(); });
      return h("div", { class: "filters", role: "search", "aria-label": "Filter records" },
        mk("rf-q", "Search", q), tab === "records" ? mk("rf-kind", "Type", kind) : null, mk("rf-status", "Status", status),
        mk("rf-owner", "Owner", owner), mk("rf-step", "Linked step", step),
        e.records.some(r => r.generated) ? mk("rf-origin", "Origin", origin) : null,
        h("label", { class: "check", style: { paddingBottom: "8px" } }, handoff, "In handoff only"));
    }

    function stepLinks(r, labels) {
      const list = labels(r);
      if (!list.length) return h("span", { class: "muted" }, "Not linked");
      return h("span", null, list.map((s, i) => [i ? ", " : "", h("button", { type: "button", class: "link-btn",
        on: { click: ev => { ev.stopPropagation(); app.gotoStep(s.modelId, s.id); } } }, s.label)]));
    }

    function renderTable() {
      const e = eng();
      const rows = filtered(e);
      const labels = stepLabels(e);
      clear(el.tableHost);
      el.count.textContent = rows.length + " of " + (tab === "opportunities" ? e.records.filter(r => r.kind === "opportunity").length : e.records.length) + " shown";
      const drafts = rows.filter(r => exporting.isUnreviewedAi(r));
      if (drafts.length) {
        el.tableHost.appendChild(h("div", { class: "ai-bar", role: "note" }, icon("agent"),
          h("span", { class: "grow" }, drafts.length + (drafts.length === 1 ? " AI draft is" : " AI drafts are") + " shown and not yet reviewed. They stay out of the handoff and exports until someone checks them."),
          h("button", { type: "button", class: "btn", id: "rv-mark-reviewed", on: { click: () => markReviewed(drafts) } }, icon("check"), "Mark shown drafts reviewed")));
      }
      const view = tab === "opportunities" && oppView !== "register" ? B.ext.list("opportunityView").find(v => v.id === oppView) : null;
      if (view) {
        const host = h("div", { id: "rv-oppview-host" });
        el.tableHost.appendChild(host);
        B.ext.guard("opportunityView", view, () => view.render(host, ctx({ records: rows })));
        return;
      }
      if (!rows.length) {
        el.tableHost.appendChild(h("div", { class: "empty" }, e.records.length ?
          "No records match these filters." : "No records yet. Select a step on the process canvas and use Capture, or add a record here."));
        return;
      }
      let head, body;
      if (tab === "opportunities") {
        const opp = r => r.opportunity || {};
        const cols = [
          ["Opportunity", r => titleCell(r)],
          ["Intervention", r => opp(r).intervention ? schema.label("intervention", opp(r).intervention) : h("span", { class: "muted" }, "Not chosen")],
          ["Linked steps", r => stepLinks(r, labels)],
          ["Expected benefit", r => opp(r).expectedBenefit || ""],
          ["Effort", r => opp(r).effort ? schema.label("effortSize", opp(r).effort) : ""],
          ["Validation action", r => opp(r).validationAction || h("span", { class: "muted" }, "None recorded")],
          ["Owner", r => r.owner || h("span", { class: "muted" }, "Unassigned")],
          ["Status", r => badge(schema.label("recordStatus", r.status), STATUS_TONE[r.status])]
        ];
        const c = ctx();
        B.ext.list("opportunityColumn").forEach(def => {
          const at = cols.findIndex(x => x[0] === def.after);
          cols.splice(at >= 0 ? at + 1 : cols.length, 0, [def.header, r => B.ext.guard("opportunityColumn", def, () => def.cell(r, c), "")]);
        });
        head = cols.map(x => x[0]);
        body = rows.map(r => tr(r, cols.map(x => x[1](r))));
      } else {
        head = ["Type", "Record", "Linked steps", "Owner", "Status", "Priority", "Updated"];
        body = rows.map(r => tr(r, [
          h("span", { class: "nowrap" }, schema.label("recordKind", r.kind)), titleCell(r), stepLinks(r, labels),
          r.owner || h("span", { class: "muted" }, "Unassigned"),
          badge(schema.label("recordStatus", r.status), STATUS_TONE[r.status]),
          r.priority ? schema.label("priority", r.priority) : "", h("span", { class: "nowrap small muted" }, formatDate(r.updatedAt))
        ]));
      }
      el.tableHost.appendChild(h("div", { class: "table-wrap" }, h("table", { class: "table" },
        h("caption", { class: "sr-only" }, tab === "opportunities" ? "Opportunity register" : "Workshop records"),
        h("thead", null, h("tr", null, head.map(x => h("th", { scope: "col" }, x)), h("th", { scope: "col" }, h("span", { class: "sr-only" }, "Actions")))),
        h("tbody", null, body))));
    }

    function markReviewed(drafts) {
      B.dialogs.confirmDialog("Mark " + drafts.length + " AI draft" + (drafts.length === 1 ? "" : "s") + " reviewed?",
        "Confirm that you checked " + (drafts.length === 1 ? "this record" : "these records") + " against the sources. Reviewed records are included in the handoff and exports. You can undo this from the menu.", "Mark reviewed")
        .then(ok => { if (ok) app.dispatch("record/markReviewed", { ids: drafts.map(r => r.id) }, drafts.length + " records marked reviewed."); });
    }

    function aiBadge(r) {
      if (!r.generated) return null;
      return [" ", r.generated.reviewed ? badge("AI, reviewed", "") : badge("AI draft", "purple")];
    }

    function titleCell(r) {
      return h("div", null, h("div", { class: "title-cell" }, r.title, r.sensitive ? [" ", badge("Sensitive", "warning")] : null, aiBadge(r)),
        r.description ? h("div", { class: "desc" }, r.description.length > 140 ? r.description.slice(0, 140) + "..." : r.description) : null);
    }

    function tr(r, cells) {
      const row = h("tr", { class: "clickable" }, cells.map(c => h("td", null, c)),
        h("td", { class: "actions" }, iconButton("edit", "Edit " + r.title, { on: { click: ev => { ev.stopPropagation(); app.openRecordDialog(r); } } }, { variant: "btn-ghost" })));
      row.addEventListener("click", () => app.openRecordDialog(r));
      return row;
    }

    function renderRecords() {
      const e = eng();
      el.tableHost = h("div");
      el.count = h("p", { class: "note", "aria-live": "polite" });
      el.panel.append(filterBar(e), tab === "opportunities" ? viewSwitcher() : null, el.count, el.tableHost);
      if (tab === "opportunities") {
        el.panel.prepend(h("p", { class: "small", style: { maxWidth: "80ch" } },
          "Each opportunity links a pain point or step to an intervention. Simpler options such as eliminating, standardizing or integrating come before automation and AI in the list, and each entry asks why the simpler option is not enough."));
      }
      renderTable();
    }

    /* Register plus the registered opportunity views; shown only when a feature adds a view. */
    function viewSwitcher() {
      const views = B.ext.list("opportunityView");
      if (!views.length) { oppView = "register"; return null; }
      if (oppView !== "register" && !views.some(v => v.id === oppView)) oppView = "register";
      const group = h("div", { class: "btn-group", role: "group", "aria-label": "Opportunity view", style: { marginBottom: "var(--space-2)" } });
      [{ id: "register", label: "Register" }].concat(views).forEach(v => {
        const b = h("button", { type: "button", class: "btn", id: "rv-oppview-" + v.id, "aria-pressed": String(oppView === v.id) }, v.label);
        b.addEventListener("click", () => {
          oppView = v.id;
          group.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
          renderTable();
        });
        group.appendChild(b);
      });
      return group;
    }

    function renderCustom(def) {
      B.ext.guard("recordsTab", def, () => def.render(el.panel, ctx()));
    }

    function renderEvidence() {
      const e = eng();
      const current = e.models.find(m => m.role === "current");
      const refCount = new Map();
      e.models.forEach(m => m.nodes.forEach(n => (n.provenance.evidenceRefs || []).forEach(id => refCount.set(id, (refCount.get(id) || 0) + 1))));
      e.records.forEach(r => r.evidenceRefs.forEach(id => refCount.set(id, (refCount.get(id) || 0) + 1)));
      const withSource = current ? current.nodes.filter(n => n.provenance.evidenceRefs.length || n.sourceIds.length).length : 0;
      const validated = current ? current.nodes.filter(n => n.provenance.validation === "validated").length : 0;
      el.panel.appendChild(h("div", { class: "stat-row" },
        stat(String(e.evidence.length), "Sources recorded", e.evidence.filter(x => x.status === "validated").length + " validated"),
        stat(current ? withSource + " of " + current.nodes.length : "0", "Current-state steps with a source reference", "Structure traced to a document or system"),
        stat(current ? validated + " of " + current.nodes.length : "0", "Steps validated with the client", "Provenance and validation are tracked separately")));
      if (!e.evidence.length) {
        el.panel.appendChild(h("div", { class: "empty" }, "No sources recorded. Add the documents, extracts and interviews the process is based on."));
        return;
      }
      el.panel.appendChild(h("div", { class: "table-wrap" }, h("table", { class: "table" },
        h("caption", { class: "sr-only" }, "Evidence sources"),
        h("thead", null, h("tr", null, ["Source", "Locator", "Status", "Reviewer", "Referenced by"].map(x => h("th", { scope: "col" }, x)), h("th", null, h("span", { class: "sr-only" }, "Actions")))),
        h("tbody", null, e.evidence.map(ev => {
          const row = h("tr", { class: "clickable" },
            h("td", null, h("div", { class: "title-cell" }, ev.title), ev.extractedFact ? h("div", { class: "desc" }, ev.extractedFact) : null,
              ev.link ? h("a", { href: ev.link, target: "_blank", rel: "noopener noreferrer", on: { click: x => x.stopPropagation() } }, "Open link") : null),
            h("td", null, ev.locator || h("span", { class: "muted" }, "None")),
            h("td", null, badge(schema.label("evidenceStatus", ev.status), EV_TONE[ev.status])),
            h("td", null, ev.reviewer ? ev.reviewer + (ev.reviewDate ? ", " + ev.reviewDate : "") : h("span", { class: "muted" }, "Not reviewed")),
            h("td", { class: "num" }, String(refCount.get(ev.id) || 0)),
            h("td", { class: "actions" }, iconButton("edit", "Edit " + ev.title, { on: { click: x => { x.stopPropagation(); B.forms.evidenceDialog(app, ev); } } }, { variant: "btn-ghost" })));
          row.addEventListener("click", () => B.forms.evidenceDialog(app, ev));
          return row;
        })))));
    }

    function stat(value, label, sub) {
      return h("div", { class: "stat" }, h("span", { class: "v" }, value), h("span", { class: "l" }, label), sub ? h("span", { class: "s" }, sub) : null);
    }

    function renderReview() {
      const items = app.reviewItems();
      const decide = items.filter(i => i.level !== "info");
      const info = items.filter(i => i.level === "info");
      el.panel.appendChild(h("p", { class: "small", style: { maxWidth: "80ch" } },
        "Findings from validating this engagement and from converting its source. Items that need a decision can be turned into open questions, so they are followed up in the workshop."));
      const list = (title, arr) => h("section", { class: "card" }, h("h3", null, title + " (" + arr.length + ")"),
        arr.length ? h("ul", { class: "issue-list" }, arr.map(item => h("li", null,
          h("div", { class: "warn-line" }, icon(item.level === "info" ? "info" : "alert"),
            h("div", { style: { flex: "1" } }, item.message, item.path ? [" ", h("code", null, item.path)] : null,
              h("div", { class: "small muted" }, item.source))),
          item.level !== "info" ? h("div", { style: { marginTop: "4px" } }, h("button", { type: "button", class: "link-btn", on: { click: () => {
            app.dispatch("record/add", { record: { kind: "question", title: item.message.slice(0, 280), description: "From review: " + item.message + (item.path ? " (" + item.path + ")" : ""), includeInHandoff: true } }, "Open question added");
          } } }, "Add as an open question")) : null))) : h("p", { class: "small muted" }, "Nothing here."));
      el.panel.append(list("Needs a decision", decide), list("For information", info));
    }

    function render() {
      if (!el.root) return;
      renderTabs();
      clear(el.panel);
      const custom = customTab();
      if (custom) renderCustom(custom);
      else if (tab === "evidence") renderEvidence();
      else if (tab === "review") renderReview();
      else renderRecords();
    }

    function exportCsv() {
      const e = eng();
      const sensitive = e.records.filter(r => r.sensitive).length;
      const go = include => {
        const ids = filtered(e).map(r => r.id);
        // The working CSV keeps AI drafts; its Origin column says which ones are not reviewed.
        const csv = exporting.recordsToCsv(e, { includeSensitive: include, includeUnreviewedAi: true, ids });
        downloadBlob(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }), exporting.fileBase(e) + (tab === "opportunities" ? "-opportunities" : "-records") + ".csv");
        announce("CSV exported.");
      };
      if (!sensitive) { go(false); return; }
      B.dialogs.choose({ title: "Include sensitive records?", body: h("p", null, sensitive + " records are marked sensitive. They are left out unless you include them."),
        actions: [{ label: "Cancel" }, { label: "Include them", value: "yes" }, { label: "Leave them out", value: "no", variant: "btn-primary", autofocus: true }] })
        .then(v => { if (v === "yes") go(true); else if (v === "no") go(false); });
    }

    function setTab(id) { tab = id; render(); }
    function setOpportunityView(id) { oppView = id || "register"; if (tab !== "opportunities") tab = "opportunities"; render(); }

    return { build, render, setTab, setOpportunityView, onEngagementChange: render };
  }

  B.recordsView = { createRecordsView };
})(typeof globalThis !== "undefined" ? globalThis : this);
