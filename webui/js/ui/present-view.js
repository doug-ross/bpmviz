/*
 * Present workspace: a low-chrome presenter view, the printable handoff
 * summary with its executive summary, and exports (engagement JSON, records
 * CSV, process SVG and PNG). Unreviewed AI drafts are left out unless the
 * presenter includes them.
 */
(function (root) {
  "use strict";
  const B = root.AIxRay = root.AIxRay || {};
  const { h, s, clear, icon, downloadBlob, announce, formatDate } = B.dom;
  const { schema, units, exporting, layout, replay: replayLib } = B;
  const { Diagram, Camera, statusText } = B.diagram;
  const badge = (t, tone) => B.drawer.badge(t, tone);
  const DATA_TONE = { demonstration: "warning", supplied: "info", observed: "success" };

  function createPresentView(app) {
    const el = {};
    let mode = "presenter";
    let includeSensitive = false;
    let includeUnreviewedAi = false;
    let focusStep = null;
    let camera = null, panes = [];
    const eng = () => app.store.get();

    /* The context registered modes, actions and handoff sections receive. */
    function extCtx() {
      return B.ext.context(app, { includeSensitive, includeUnreviewedAi, scenarioId: app.view.scenarioId || "", rerender: render, mode });
    }

    /* Built-in modes, then modes registered with AIxRay.ext.registerPresentMode. */
    function modes() {
      return [{ id: "presenter", label: "Present", builtin: true, printable: false },
        { id: "handoff", label: "Report", builtin: true, printable: true }].concat(B.ext.list("presentMode"));
    }

    function renderModeTabs() {
      const list = modes();
      const key = list.map(m => m.id).join("|");
      if (el.modeTabs.dataset.key !== key) {
        clear(el.modeTabs);
        list.forEach(m => {
          const b = h("button", { type: "button", class: "btn", id: m.builtin ? "pr-" + m.id : "pr-mode-" + m.id, dataset: { mode: m.id } }, m.label);
          b.addEventListener("click", () => { mode = m.id; render(); });
          el.modeTabs.appendChild(b);
        });
        el.modeTabs.dataset.key = key;
      }
      el.modeTabs.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
    }

    /* Buttons registered with AIxRay.ext.registerPresentAction, just before Save a copy (pr-json). */
    function renderActions() {
      const list = B.ext.list("presentAction");
      const key = list.map(a => a.id).join("|");
      if (el.actions.dataset.key === key) return;
      clear(el.actions);
      list.forEach(a => {
        const b = h("button", { type: "button", class: "btn", id: "pr-action-" + a.id }, icon(a.icon || "download"), a.label);
        b.addEventListener("click", () => B.ext.guard("presentAction", a, () => a.run(app, extCtx())));
        el.actions.appendChild(b);
      });
      el.actions.dataset.key = key;
    }

    function build() {
      el.modeTabs = h("div", { class: "btn-group", role: "group", "aria-label": "Show as" });
      el.actions = h("span", { class: "present-actions", style: { display: "contents" } });
      renderModeTabs();
      el.sensitive = h("input", { type: "checkbox", id: "pr-sensitive" });
      el.sensitive.addEventListener("change", () => { includeSensitive = el.sensitive.checked; render(); });
      el.unreviewed = h("input", { type: "checkbox", id: "pr-unreviewed" });
      el.unreviewed.addEventListener("change", () => { includeUnreviewedAi = el.unreviewed.checked; render(); });
      el.unreviewedLabel = h("label", { class: "check", title: "Unreviewed AI drafts stay marked as AI drafts wherever they appear" }, el.unreviewed, "Include unreviewed AI drafts");
      const btn = (iconName, label, id, fn, title) => {
        const b = h("button", { type: "button", class: "btn", id, title: title || null }, icon(iconName), label);
        b.addEventListener("click", fn);
        return b;
      };
      // Row 1: what to show and the one action that fits it (Full screen to present, Print for a report).
      // Row 2: what to include, then sharing and exports. Registered actions stay directly before Save a copy (pr-json).
      el.full = btn("fullscreen", "Full screen", "pr-full", () => { const t = el.root; if (t.requestFullscreen) t.requestFullscreen().catch(() => {}); });
      el.print = btn("printer", "Print or save as PDF", "pr-print", printHandoff, "Print the report, or save it as a PDF");
      el.bar = h("div", { class: "present-bar", role: "toolbar", "aria-label": "Present, report and export" },
        h("div", { class: "tb-row" },
          h("div", { class: "tb-group" }, h("span", { class: "tb-label" }, "Show as"), el.modeTabs),
          h("span", { class: "tb-spacer" }),
          el.full, el.print),
        h("div", { class: "tb-row tb-row-display" },
          h("div", { class: "tb-group", role: "group", "aria-label": "Include" },
            h("label", { class: "check" }, el.sensitive, "Include sensitive findings"),
            el.unreviewedLabel),
          h("span", { class: "tb-spacer" }),
          h("div", { class: "tb-group present-exports", role: "group", "aria-label": "Share and export" },
            btn("download", "Export findings (CSV)", "pr-csv", exportCsv, "The findings in the report, as a CSV file"),
            btn("image", "Export diagram (SVG)", "pr-svg", () => exportDiagram("svg"), "The process diagram as it is shown on the Process tab"),
            btn("image", "Export diagram (PNG)", "pr-png", () => exportDiagram("png"), "The process diagram as it is shown on the Process tab"),
            el.actions,
            btn("save", "Save a copy", "pr-json", () => app.saveAs(), "Save a copy of the project file"))));
      el.content = h("div", { style: { minHeight: "0", overflow: "auto" } });
      el.root = h("div", { class: "present-ws" }, el.bar, el.content);
      return el.root;
    }

    /* ---------- Presenter ---------- */

    function findingsFor(e) {
      return exporting.selectRecords(e, { includeSensitive, includeUnreviewedAi, handoffOnly: true })
        .filter(r => !focusStep || (r.linkedNodeIds.includes(focusStep.nodeId) && (!r.linkedModelId || r.linkedModelId === focusStep.modelId)));
    }

    function renderPresenter() {
      const e = eng();
      const sc = e.scenarios.find(x => x.id === app.view.scenarioId) || e.scenarios[0] || null;
      const models = app.processView.displayedModels();
      const stage = h("div", { class: "panes" + (models.length > 1 ? " compare" : ""), style: { minHeight: "360px" } });
      const main = h("div", { class: "presenter-main" },
        h("div", { class: "presenter-title" },
          h("div", { class: "eyebrow" }, [e.meta.clientDisplayName, e.meta.engagementName].filter(Boolean).join(" \u00b7 ")),
          h("h2", null, e.meta.processName),
          h("div", { class: "meta" }, badge(schema.label("dataStatus", e.meta.dataStatus), DATA_TONE[e.meta.dataStatus]),
            models.map(m => h("span", null, m.name + " v" + m.version)),
            sc ? h("span", null, "Scenario: " + sc.name + " (" + schema.label("scenarioProvenance", sc.provenance).toLowerCase() + ")") : null,
            sc ? h("span", null, "Shown at " + units.formatDuration(app.view.t, e.meta.timeBasis)) : null)),
        stage);
      const side = h("div", { class: "presenter-side", "aria-label": "Findings" });
      el.content.appendChild(h("div", { class: "presenter", style: { height: "100%" } }, main, side));
      // Diagram
      const lay = layout.computeLayout(models);
      camera = new Camera();
      panes = models.map((m, i) => {
        const svg = s("svg", { "aria-label": m.name + " diagram", role: "group" });
        const gutter = h("div", { class: "gutter", "aria-hidden": "true" });
        const viewEl = h("div", { class: "view" }, svg);
        if (i === 1) stage.appendChild(h("div"));
        stage.appendChild(h("section", { class: "pane", "aria-label": m.name },
          h("header", { class: "pane-head" }, h("span", { class: "pane-title" }, m.name)), h("div", { class: "pane-body" }, gutter, viewEl)));
        const d = new Diagram({ svg, gutter, view: viewEl, paneId: "pr" + i,
          onActivate: id => { focusStep = { modelId: m.id, nodeId: id }; renderSideOnly(side); } });
        const lm = lay.models[m.id];
        d.build(m, lm, layout.routeAll(m, lm), {});
        const run = sc && sc.runs[m.id];
        const rp = run ? replayLib.buildReplay(m, run, e.meta.timeBasis) : null;
        d.applyReplay(rp, app.view.t, e.meta.timeBasis);
        d.setDurations(rp, e.meta.timeBasis);
        const counts = new Map();
        exporting.selectRecords(e, { includeSensitive, includeUnreviewedAi, handoffOnly: true }).forEach(r => {
          if (!r.linkedModelId || r.linkedModelId === m.id) r.linkedNodeIds.forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
        });
        d.setRecordCounts(counts);
        camera.attach(d, id => { focusStep = id ? { modelId: m.id, nodeId: id } : null; renderSideOnly(side); });
        return d;
      });
      camera.setPanes(panes);
      requestAnimationFrame(() => camera.readable());
      renderSideOnly(side);
    }

    function renderSideOnly(side) {
      const e = eng();
      clear(side);
      const records = findingsFor(e);
      panes.forEach(p => p.setSelected(focusStep && p.model.id === focusStep.modelId ? focusStep.nodeId : null));
      if (focusStep) {
        const m = e.models.find(x => x.id === focusStep.modelId), n = m && m.nodes.find(x => x.id === focusStep.nodeId);
        side.appendChild(h("div", { class: "card" }, h("div", { class: "eyebrow" }, "Findings for"), h("h3", null, n ? n.label : ""),
          h("button", { type: "button", class: "link-btn", on: { click: () => { focusStep = null; renderSideOnly(side); } } }, "Show all findings")));
      }
      const groups = [["pain", "Pain points"], ["opportunity", "Opportunities"], ["decision", "Decisions"], ["action", "Actions"], ["question", "Open questions"], ["assumption", "Assumptions"], ["note", "Notes"]];
      let any = false;
      groups.forEach(([kind, title]) => {
        const list = records.filter(r => r.kind === kind);
        if (!list.length) return;
        any = true;
        side.appendChild(h("section", null, h("h3", null, title + " (" + list.length + ")"),
          list.map(r => h("div", { class: "finding" }, h("strong", null, r.title, exporting.isUnreviewedAi(r) ? [" ", badge("AI draft", "purple")] : null),
            r.description ? h("span", null, r.description.length > 180 ? r.description.slice(0, 180) + "..." : r.description) : null,
            h("div", { class: "muted small" }, [r.owner ? "Owner: " + r.owner : "No owner", schema.label("recordStatus", r.status)].join(" \u00b7 "))))));
      });
      if (!any) side.appendChild(h("p", { class: "small muted" }, focusStep ? "No findings for this step are in the report." :
        "No findings in the report yet. Select a step on the Process tab and add one."));
      const excluded = e.records.filter(r => r.sensitive && r.includeInHandoff).length;
      if (excluded && !includeSensitive) side.appendChild(h("p", { class: "note" }, excluded + (excluded === 1 ? " sensitive finding is hidden." : " sensitive findings are hidden.")));
      const drafts = e.records.filter(r => r.includeInHandoff && exporting.isUnreviewedAi(r) && (includeSensitive || !r.sensitive)).length;
      if (drafts && !includeUnreviewedAi) side.appendChild(h("p", { class: "note" }, drafts + (drafts === 1 ? " unreviewed AI draft is hidden." : " unreviewed AI drafts are hidden.")));
      if (e.meta.disclosure) side.appendChild(h("p", { class: "note" }, e.meta.disclosure));
    }

    /* ---------- Report (the handoff summary) ---------- */

    function renderHandoff() {
      const e = eng();
      const hd = exporting.buildHandoff(e, { scenarioId: app.view.scenarioId, includeSensitive, includeUnreviewedAi });
      const c = extCtx();
      // Sections registered with AIxRay.ext.registerHandoffSection, placed after their anchor.
      const ext = anchor => B.ext.list("handoffSection").filter(x => x.after === anchor)
        .map(x => B.ext.guard("handoffSection", x, () => x.render(hd, c), null));
      const sec = (title, kind, cols) => {
        const list = hd.sections[kind];
        if (!list.length) return null;
        return [h("h2", null, title + " (" + list.length + ")"),
          h("div", { class: "table-wrap" }, h("table", { class: "table" },
            h("thead", null, h("tr", null, cols.map(c => h("th", { scope: "col" }, c[0])))),
            h("tbody", null, list.map(r => h("tr", null, cols.map(c => h("td", null, c[1](r)))))))) ];
      };
      const title = r => h("div", null, h("div", { class: "title-cell" }, r.title, r.aiDraft ? [" ", badge("AI draft, not reviewed", "purple")] : null),
        r.description ? h("div", { class: "desc" }, r.description) : null);
      const steps = r => r.steps.join(", ") || "Not linked";
      const doc = h("article", { class: "handoff-doc", id: "handoff-doc" },
        h("div", { class: "handoff-sail", "aria-hidden": "true" }),
        h("p", { class: "eyebrow", style: { marginTop: "var(--space-4)" } }, [hd.client, hd.engagementName].filter(Boolean).join(" \u00b7 ") || "Process review"),
        h("h1", null, hd.title),
        h("p", { class: "lede" }, "The process as reviewed, what was found and decided, and who owns each next step."),
        h("dl", { class: "facts" },
          h("dt", null, "Data status"), h("dd", null, hd.dataStatus),
          h("dt", null, "Confidentiality"), h("dd", null, hd.confidentiality),
          h("dt", null, "File version"), h("dd", null, String(hd.revision)),
          h("dt", null, "Prepared"), h("dd", null, formatDate(hd.generatedAt)),
          hd.scenario ? [h("dt", null, "Scenario"), h("dd", null, hd.scenario.name + ". " + hd.scenario.provenance + ", " + hd.scenario.timing.toLowerCase() + ".")] : null,
          h("dt", null, "Timing"), h("dd", null, hd.timeBasis)),
        summarySection(e, hd),
        ext("summary"),
        h("h2", null, "Scope"),
        h("div", { class: "table-wrap" }, h("table", { class: "table" },
          h("thead", null, h("tr", null, ["Diagram", "Type", "Version", "Status", "Steps"].map(col => h("th", { scope: "col" }, col)))),
          h("tbody", null, hd.models.map(m => h("tr", null, h("td", null, m.name), h("td", null, m.role), h("td", null, String(m.version)), h("td", null, m.status), h("td", { class: "num" }, String(m.steps))))))),
        ext("scope"),
        sec("Pain points", "pain", [["Pain point", title], ["Steps", steps], ["Owner", r => r.owner || "Unassigned"], ["Status", r => r.status]]),
        ext("pain"),
        sec("Opportunities", "opportunity", [["Opportunity", title], ["Type of change", r => r.opportunity ? r.opportunity.intervention || "Not chosen" : ""],
          ["Expected benefit", r => r.opportunity ? r.opportunity.expectedBenefit : ""], ["How to confirm", r => r.opportunity ? r.opportunity.validationAction : ""], ["Owner", r => r.owner || "Unassigned"]]),
        ext("opportunity"),
        sec("Decisions", "decision", [["Decision", title], ["Steps", steps], ["Owner", r => r.owner || "Unassigned"], ["Status", r => r.status]]),
        ext("decision"),
        sec("Actions", "action", [["Action", title], ["Owner", r => r.owner || "Unassigned"], ["Status", r => r.status], ["Priority", r => r.priority]]),
        ext("action"),
        sec("Open questions", "question", [["Question", title], ["Steps", steps], ["Owner", r => r.owner || "Unassigned"]]),
        ext("question"),
        sec("Assumptions", "assumption", [["Assumption", title], ["Owner", r => r.owner || "Unassigned"], ["Sources", r => r.evidence.join("; ") || "None"]]),
        sec("Notes", "note", [["Note", title], ["Steps", steps], ["Owner", r => r.owner || "Unassigned"]]),
        h("h2", null, "Cost and volume assumptions"),
        hd.assumptions.length ? h("div", { class: "table-wrap" }, h("table", { class: "table" },
          h("thead", null, h("tr", null, ["Assumption", "Value", "Status", "Source"].map(col => h("th", { scope: "col" }, col)))),
          h("tbody", null, hd.assumptions.map(a => h("tr", null, h("td", null, a.label), h("td", { class: "num" }, a.value), h("td", null, a.status), h("td", null, a.source || "")))))) :
          h("p", null, "No cost or volume assumptions yet."),
        hd.value && hd.value.length ? [h("h3", null, "Modeled figures for " + (hd.scenario ? hd.scenario.name : "the scenario")),
          h("ul", null, hd.value.map(v => h("li", null, v.label + ": " + v.text + " (from " + schema.label("assumptionStatus", v.basis).toLowerCase() + " inputs; " + v.formula + ")")))] : null,
        hd.reconciliation && hd.reconciliation.warnings.length ? [h("h3", null, "Figures that do not add up"),
          h("ul", null, hd.reconciliation.warnings.map(w => h("li", null, w)))] : null,
        ext("value"),
        h("h2", null, "Sources"),
        h("p", null, hd.evidence.total + (hd.evidence.total === 1 ? " source" : " sources") + ": " + hd.evidence.validated + " confirmed, " + hd.evidence.unreviewed + " not reviewed, " +
          hd.evidence.disputed + " disputed, " + hd.evidence.unavailable + " unavailable. " +
          hd.evidence.stepsWithoutProvenance + " of " + hd.evidence.currentSteps + " current-state steps have nothing recorded about where they came from."),
        ext("evidence"),
        hd.excludedSensitive ? h("p", { class: "note" }, hd.excludedSensitive + (hd.excludedSensitive === 1 ? " sensitive finding is" : " sensitive findings are") + " left out of this report.") : null,
        hd.excludedUnreviewedAi ? h("p", { class: "note no-print" }, hd.excludedUnreviewedAi + (hd.excludedUnreviewedAi === 1 ? " AI-drafted finding is" : " AI-drafted findings are") +
          " left out until someone reviews " + (hd.excludedUnreviewedAi === 1 ? "it" : "them") + " on the Findings tab. To show " + (hd.excludedUnreviewedAi === 1 ? "it" : "them") + " anyway, tick Include unreviewed AI drafts.") : null,
        hd.disclosure ? [h("h2", null, "About this data"), h("p", null, hd.disclosure)] : null,
        ext("end"));
      el.content.appendChild(h("div", { class: "handoff" }, doc));
    }

    /* Paragraphs separated by blank lines; runs of lines that start with a hyphen become a list. */
    function summaryBlocks(text) {
      const out = [];
      const bullet = /^[-*]\s+/;
      String(text || "").split(/\n\s*\n/).forEach(par => {
        const lines = par.split("\n").map(l => l.trim()).filter(Boolean);
        if (!lines.length) return;
        const lead = bullet.test(lines[0]) ? null : lines[0];
        const rest = lead === null ? lines : lines.slice(1);
        if (rest.length && rest.every(l => bullet.test(l))) {
          if (lead !== null) out.push(h("p", { class: "summary-lead" }, lead));
          out.push(h("ul", null, rest.map(l => h("li", null, l.replace(bullet, "")))));
        } else {
          out.push(h("p", null, lines.join(" ")));
        }
      });
      return out;
    }

    function reviewSummary() {
      B.dialogs.confirmDialog("Mark the summary reviewed?",
        "Confirm that you checked the AI-drafted summary against the project. The report then includes it, with a line saying it was drafted with AI assistance and the date it was reviewed.", "Mark reviewed")
        .then(ok => { if (ok) app.dispatch("narrative/review", { kind: "executive-summary" }, "Summary marked reviewed."); });
    }

    function summarySection(e, hd) {
      const n = (e.narratives || []).find(x => x.kind === "executive-summary");
      const tools = h("div", { class: "handoff-tools no-print" },
        h("button", { type: "button", class: "btn", id: "pr-summary-edit", on: { click: () => B.forms.summaryDialog(app) } }, icon("edit"), n ? "Edit summary" : "Write an executive summary"),
        n && n.generated && !n.generated.reviewed ? h("button", { type: "button", class: "btn", id: "pr-summary-review", on: { click: reviewSummary } }, icon("check"), "Mark summary reviewed") : null,
        B.aiPanel.enabled ? h("button", { type: "button", class: "btn", id: "pr-summary-ai", on: { click: () => B.aiPanel.openTask(app, "summary") } }, icon("agent"), "Draft with AI") : null);
      if (!hd.executiveSummary) {
        return [n ? h("p", { class: "note no-print" }, "An AI-drafted executive summary is waiting for review. It stays out of the report until someone reviews it, unless you include unreviewed AI drafts.") : null, tools];
      }
      const x = hd.executiveSummary;
      return h("section", { class: "exec-summary", "aria-labelledby": "hd-summary" },
        h("h2", { id: "hd-summary" }, x.title || "Executive summary"),
        summaryBlocks(x.text),
        x.disclosure ? h("p", { class: "note" }, x.disclosure) : null,
        tools);
    }

    /* ---------- Exports ---------- */

    /* Prints the current mode when it is printable, otherwise the report. */
    function printHandoff() {
      const current = modes().find(m => m.id === mode);
      if (!current || !current.printable) { mode = "handoff"; render(); }
      setTimeout(() => window.print(), 50);
    }

    function exportCsv() {
      const e = eng();
      const csv = exporting.recordsToCsv(e, { includeSensitive, includeUnreviewedAi, handoffOnly: true });
      downloadBlob(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }), exporting.fileBase(e) + "-report-findings.csv");
      announce("Findings in the report exported" + (includeSensitive ? ", including sensitive findings." : "."));
    }

    const STYLE_PROPS = ["fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "font-family", "font-size", "font-weight", "text-decoration", "fill-opacity"];

    /** Builds a standalone SVG of the process panes shown in the Process workspace. */
    function buildSvg() {
      const e = eng();
      const sourcePanes = app.processView.panes;
      if (!sourcePanes.length) return null;
      const sc = e.scenarios.find(x => x.id === app.view.scenarioId) || null;
      const gutterW = 190, headerH = 84, gap = 36;
      const width = gutterW + Math.max(...sourcePanes.map(p => p.diagram.world().width));
      const out = s("svg", { xmlns: B.dom.SVG_NS, width, height: 10, viewBox: "0 0 " + width + " 10", "font-family": "Ubuntu, Segoe UI, Arial, sans-serif" });
      const bgColor = getComputedStyle(document.documentElement).getPropertyValue("--canvas").trim() || "#ffffff";
      const ink = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#2B0A3D";
      const muted = getComputedStyle(document.documentElement).getPropertyValue("--ink-muted").trim() || "#71717E";
      out.appendChild(s("rect", { x: 0, y: 0, width: "100%", height: "100%", fill: bgColor }));
      out.appendChild(s("text", { x: 16, y: 30, "font-size": 20, "font-weight": 700, fill: ink }, e.meta.processName));
      out.appendChild(s("text", { x: 16, y: 54, "font-size": 12, fill: muted },
        [schema.label("dataStatus", e.meta.dataStatus), sc ? "Scenario: " + sc.name + " (" + schema.label("scenarioProvenance", sc.provenance).toLowerCase() + ") at " + units.formatDuration(app.view.t, e.meta.timeBasis) : "No timing recorded",
          "Exported " + formatDate(new Date().toISOString())].join("  \u00b7  ")));
      out.appendChild(s("text", { x: 16, y: 72, "font-size": 11, fill: muted }, "Key: bold green outline, complete; bold blue outline, in progress; faded dashed outline, not in scenario; dotted purple outline, route not confirmed."));
      let y = headerH;
      sourcePanes.forEach(p => {
        const d = p.diagram;
        out.appendChild(s("text", { x: 16, y: y + 16, "font-size": 14, "font-weight": 700, fill: ink }, p.model.name + " v" + p.model.version));
        y += 26;
        const lm = d.lm;
        p.model.lanes.forEach((lane, i) => {
          const ly = y + lm.laneTop + (i + 0.5) * lm.laneHeight;
          out.appendChild(s("text", { x: 16, y: ly, "font-size": 12, "font-weight": 700, fill: ink, "dominant-baseline": "central" }, lane.name.length > 28 ? lane.name.slice(0, 27) + "..." : lane.name));
        });
        const clone = d.content.cloneNode(true);
        const srcEls = [d.content, ...d.content.querySelectorAll("*")];
        const dstEls = [clone, ...clone.querySelectorAll("*")];
        const remove = [];
        srcEls.forEach((src, i) => {
          const dst = dstEls[i];
          if (!dst) return;
          const cs = getComputedStyle(src);
          if (cs.display === "none" || cs.visibility === "hidden") { remove.push(dst); return; }
          STYLE_PROPS.forEach(prop => {
            const v = cs.getPropertyValue(prop);
            if (v && v !== "none" || prop === "fill" || prop === "stroke") dst.setAttribute(prop, v);
          });
          dst.removeAttribute("class");
          dst.removeAttribute("tabindex");
          dst.removeAttribute("role");
        });
        remove.forEach(n => n.remove());
        clone.querySelectorAll("[marker-end]").forEach(path => {
          const kind = /active/.test(path.getAttribute("marker-end")) ? "active" : /traversed/.test(path.getAttribute("marker-end")) ? "traversed" : "default";
          path.setAttribute("marker-end", "url(#x-" + kind + ")");
        });
        clone.setAttribute("transform", "translate(" + gutterW + "," + y + ")");
        out.appendChild(clone);
        y += lm.height + gap;
      });
      const defs = s("defs");
      ["default", "traversed", "active"].forEach(kind => {
        const color = getComputedStyle(document.documentElement).getPropertyValue(kind === "active" ? "--edge-active" : kind === "traversed" ? "--edge-traversed" : "--edge").trim();
        defs.appendChild(s("marker", { id: "x-" + kind, markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: "auto", markerUnits: "userSpaceOnUse" },
          s("path", { d: "M0,0 L8,4 L0,8 Z", fill: color })));
      });
      out.insertBefore(defs, out.firstChild);
      if (e.meta.disclosure) { out.appendChild(s("text", { x: 16, y: y, "font-size": 11, fill: muted }, e.meta.disclosure)); y += 20; }
      out.setAttribute("height", String(y));
      out.setAttribute("viewBox", "0 0 " + width + " " + y);
      return { text: new XMLSerializer().serializeToString(out), width, height: y };
    }

    /**
     * Renders the process panes shown in the Process workspace to a PNG:
     * Promise<{ blob, width, height }> (pixels). opts.scale defaults to 2 and
     * is capped so neither side passes 16,000 pixels. Rejects when the
     * Process workspace has not drawn a diagram yet.
     */
    function renderPng(opts) {
      const o = opts || {};
      return new Promise((resolve, reject) => {
        const svg = buildSvg();
        if (!svg) { reject(new Error("Open the Process tab once so the diagram is drawn, then try again.")); return; }
        const img = new Image();
        const url = URL.createObjectURL(new Blob([svg.text], { type: "image/svg+xml" }));
        img.onload = () => {
          const scale = Math.min(Number.isFinite(o.scale) && o.scale > 0 ? o.scale : 2, 16000 / svg.width, 16000 / svg.height);
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(svg.width * scale); canvas.height = Math.round(svg.height * scale);
          const g = canvas.getContext("2d");
          g.scale(scale, scale);
          g.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          canvas.toBlob(blob => {
            if (blob) resolve({ blob, width: canvas.width, height: canvas.height });
            else reject(new Error("Your browser could not turn the diagram into an image. Use Export diagram (SVG) instead."));
          }, "image/png");
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Your browser could not turn the diagram into an image. Use Export diagram (SVG) instead.")); };
        img.src = url;
      });
    }

    function exportDiagram(kind) {
      const e = eng();
      if (!app.processView.panes.length) app.goto("process");
      const svg = buildSvg();
      if (!svg) { B.dialogs.messageDialog("Nothing to export yet", "Open the Process tab once so the diagram is drawn, then export again."); return; }
      const base = exporting.fileBase(e) + "-process";
      if (kind === "svg") {
        downloadBlob(new Blob([svg.text], { type: "image/svg+xml" }), base + ".svg");
        announce("Diagram exported as SVG.");
        return;
      }
      renderPng().then(r => { downloadBlob(r.blob, base + ".png"); announce("Diagram exported as PNG."); })
        .catch(err => B.dialogs.messageDialog("The PNG export did not work", err.message));
    }

    function renderMode() {
      const def = B.ext.list("presentMode").find(m => m.id === mode);
      const host = h("div", { class: def.printable ? "handoff" : "present-mode", id: "pr-mode-host" });
      el.content.appendChild(host);
      B.ext.guard("presentMode", def, () => def.render(host, extCtx()));
    }

    function render() {
      if (!el.root) return;
      if (!modes().some(m => m.id === mode)) mode = "presenter";
      renderModeTabs();
      renderActions();
      const current = modes().find(m => m.id === mode);
      el.full.classList.toggle("btn-primary", mode === "presenter");
      el.print.classList.toggle("btn-primary", !!(current && current.printable));
      const e = eng();
      el.unreviewedLabel.hidden = !(e.records.some(r => exporting.isUnreviewedAi(r)) || (e.narratives || []).some(n => exporting.isUnreviewedAi(n)));
      if (el.unreviewedLabel.hidden && includeUnreviewedAi) { includeUnreviewedAi = false; el.unreviewed.checked = false; }
      clear(el.content);
      el.content.style.height = mode === "presenter" ? "100%" : "";
      if (mode === "presenter") renderPresenter(); else if (mode === "handoff") renderHandoff(); else renderMode();
    }

    return { build, render, onEngagementChange: render, buildSvg, renderPng, getMode: () => mode, setMode: m => { mode = m; render(); } };
  }

  B.presentView = { createPresentView };
})(typeof globalThis !== "undefined" ? globalThis : this);
