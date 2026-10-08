/*
 * Present workspace: a low-chrome presenter view, the printable handoff
 * summary with its executive summary, and exports (engagement JSON, records
 * CSV, process SVG and PNG). Unreviewed AI drafts are left out unless the
 * presenter includes them.
 */
(function (root) {
  "use strict";
  const B = root.BPMVIZ = root.BPMVIZ || {};
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

    function build() {
      el.modeTabs = h("div", { class: "btn-group", role: "group", "aria-label": "Present mode" });
      [["presenter", "Presenter view"], ["handoff", "Handoff summary"]].forEach(([id, label]) => {
        const b = h("button", { type: "button", class: "btn", id: "pr-" + id, "aria-pressed": String(mode === id) }, label);
        b.addEventListener("click", () => { mode = id; render(); });
        el.modeTabs.appendChild(b);
      });
      el.sensitive = h("input", { type: "checkbox", id: "pr-sensitive" });
      el.sensitive.addEventListener("change", () => { includeSensitive = el.sensitive.checked; render(); });
      el.unreviewed = h("input", { type: "checkbox", id: "pr-unreviewed" });
      el.unreviewed.addEventListener("change", () => { includeUnreviewedAi = el.unreviewed.checked; render(); });
      el.unreviewedLabel = h("label", { class: "check", title: "AI drafts are marked as not reviewed wherever they appear" }, el.unreviewed, "Include AI drafts not yet reviewed");
      const btn = (iconName, label, id, fn) => {
        const b = h("button", { type: "button", class: "btn", id }, icon(iconName), label);
        b.addEventListener("click", fn);
        return b;
      };
      el.bar = h("div", { class: "present-bar", role: "toolbar", "aria-label": "Present and export" },
        el.modeTabs,
        h("label", { class: "check" }, el.sensitive, "Include sensitive records"),
        el.unreviewedLabel,
        h("span", { class: "spacer" }),
        btn("printer", "Print or save as PDF", "pr-print", printHandoff),
        btn("download", "Records CSV", "pr-csv", exportCsv),
        btn("image", "Process SVG", "pr-svg", () => exportDiagram("svg")),
        btn("image", "Process PNG", "pr-png", () => exportDiagram("png")),
        btn("save", "Engagement JSON", "pr-json", () => app.saveAs()),
        btn("fullscreen", "Full screen", "pr-full", () => { const t = el.root; if (t.requestFullscreen) t.requestFullscreen().catch(() => {}); }));
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
      if (!any) side.appendChild(h("p", { class: "small muted" }, focusStep ? "No findings for this step are marked for the handoff." :
        "No findings are marked for the handoff yet. Capture them against steps in the Process workspace."));
      const excluded = e.records.filter(r => r.sensitive && r.includeInHandoff).length;
      if (excluded && !includeSensitive) side.appendChild(h("p", { class: "note" }, excluded + " sensitive records are hidden."));
      const drafts = e.records.filter(r => r.includeInHandoff && exporting.isUnreviewedAi(r) && (includeSensitive || !r.sensitive)).length;
      if (drafts && !includeUnreviewedAi) side.appendChild(h("p", { class: "note" }, drafts + " AI drafts not yet reviewed are hidden."));
      if (e.meta.disclosure) side.appendChild(h("p", { class: "note" }, e.meta.disclosure));
    }

    /* ---------- Handoff summary ---------- */

    function renderHandoff() {
      const e = eng();
      const hd = exporting.buildHandoff(e, { scenarioId: app.view.scenarioId, includeSensitive, includeUnreviewedAi });
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
        h("p", { class: "eyebrow", style: { marginTop: "var(--space-4)" } }, [hd.client, hd.engagementName].filter(Boolean).join(" \u00b7 ") || "Process workshop"),
        h("h1", null, hd.title),
        h("p", { class: "lede" }, "Workshop handoff: the process as reviewed, what was found, what was decided, and who owns the next steps."),
        h("dl", { class: "facts" },
          h("dt", null, "Data status"), h("dd", null, hd.dataStatus),
          h("dt", null, "Confidentiality"), h("dd", null, hd.confidentiality),
          h("dt", null, "Engagement revision"), h("dd", null, String(hd.revision)),
          h("dt", null, "Prepared"), h("dd", null, formatDate(hd.generatedAt)),
          hd.scenario ? [h("dt", null, "Scenario"), h("dd", null, hd.scenario.name + ". " + hd.scenario.provenance + ", " + hd.scenario.timing.toLowerCase() + ".")] : null,
          h("dt", null, "Timing"), h("dd", null, hd.timeBasis)),
        summarySection(e, hd),
        h("h2", null, "Scope"),
        h("div", { class: "table-wrap" }, h("table", { class: "table" },
          h("thead", null, h("tr", null, ["Model", "Role", "Version", "Status", "Steps"].map(c => h("th", { scope: "col" }, c)))),
          h("tbody", null, hd.models.map(m => h("tr", null, h("td", null, m.name), h("td", null, m.role), h("td", null, String(m.version)), h("td", null, m.status), h("td", { class: "num" }, String(m.steps))))))),
        sec("Pain points", "pain", [["Finding", title], ["Steps", steps], ["Owner", r => r.owner || "Unassigned"], ["Status", r => r.status]]),
        sec("Opportunities", "opportunity", [["Opportunity", title], ["Intervention", r => r.opportunity ? r.opportunity.intervention || "Not chosen" : ""],
          ["Expected benefit", r => r.opportunity ? r.opportunity.expectedBenefit : ""], ["Next validation", r => r.opportunity ? r.opportunity.validationAction : ""], ["Owner", r => r.owner || "Unassigned"]]),
        sec("Decisions", "decision", [["Decision", title], ["Steps", steps], ["Owner", r => r.owner || "Unassigned"], ["Status", r => r.status]]),
        sec("Actions", "action", [["Action", title], ["Owner", r => r.owner || "Unassigned"], ["Status", r => r.status], ["Priority", r => r.priority]]),
        sec("Open questions", "question", [["Question", title], ["Steps", steps], ["Owner", r => r.owner || "Unassigned"]]),
        sec("Assumptions captured", "assumption", [["Assumption", title], ["Owner", r => r.owner || "Unassigned"], ["Evidence", r => r.evidence.join("; ") || "None"]]),
        sec("Notes", "note", [["Note", title], ["Steps", steps], ["Owner", r => r.owner || "Unassigned"]]),
        h("h2", null, "Economic assumptions"),
        hd.assumptions.length ? h("div", { class: "table-wrap" }, h("table", { class: "table" },
          h("thead", null, h("tr", null, ["Assumption", "Value", "Status", "Source"].map(c => h("th", { scope: "col" }, c)))),
          h("tbody", null, hd.assumptions.map(a => h("tr", null, h("td", null, a.label), h("td", { class: "num" }, a.value), h("td", null, a.status), h("td", null, a.source || "")))))) :
          h("p", null, "No economic assumptions are recorded."),
        hd.value && hd.value.length ? [h("h3", null, "Modeled figures for the scenario"),
          h("ul", null, hd.value.map(v => h("li", null, v.label + ": " + v.text + " (" + v.basis + " inputs; " + v.formula + ")")))] : null,
        hd.reconciliation && hd.reconciliation.warnings.length ? [h("h3", null, "Figures that do not reconcile"),
          h("ul", null, hd.reconciliation.warnings.map(w => h("li", null, w)))] : null,
        h("h2", null, "Evidence"),
        h("p", null, hd.evidence.total + (hd.evidence.total === 1 ? " source" : " sources") + " recorded: " + hd.evidence.validated + " validated, " + hd.evidence.unreviewed + " not reviewed, " +
          hd.evidence.disputed + " disputed, " + hd.evidence.unavailable + " unavailable. " +
          hd.evidence.stepsWithoutProvenance + " of " + hd.evidence.currentSteps + " current-state steps have no recorded provenance."),
        hd.excludedSensitive ? h("p", { class: "note" }, hd.excludedSensitive + " sensitive records are not included in this summary.") : null,
        hd.excludedUnreviewedAi ? h("p", { class: "note no-print" }, hd.excludedUnreviewedAi + " AI-drafted records are not yet reviewed and are not included. Review them in Records, or tick Include AI drafts not yet reviewed.") : null,
        hd.disclosure ? [h("h2", null, "Disclosure"), h("p", null, hd.disclosure)] : null);
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
        "Confirm that you checked the AI-drafted summary against the engagement. The handoff then prints it with a line saying it was drafted with AI assistance and reviewed, with the date.", "Mark reviewed")
        .then(ok => { if (ok) app.dispatch("narrative/review", { kind: "executive-summary" }, "Summary marked reviewed."); });
    }

    function summarySection(e, hd) {
      const n = (e.narratives || []).find(x => x.kind === "executive-summary");
      const tools = h("div", { class: "handoff-tools no-print" },
        h("button", { type: "button", class: "btn", id: "pr-summary-edit", on: { click: () => B.forms.summaryDialog(app) } }, icon("edit"), n ? "Edit summary" : "Write an executive summary"),
        n && n.generated && !n.generated.reviewed ? h("button", { type: "button", class: "btn", id: "pr-summary-review", on: { click: reviewSummary } }, icon("check"), "Mark summary reviewed") : null,
        B.aiPanel.enabled ? h("button", { type: "button", class: "btn", id: "pr-summary-ai", on: { click: () => B.aiPanel.openTask(app, "summary") } }, icon("agent"), "Draft with AI") : null);
      if (!hd.executiveSummary) {
        return [n ? h("p", { class: "note no-print" }, "An AI-drafted executive summary is waiting for review. It stays out of the handoff until it is reviewed, unless you include AI drafts not yet reviewed.") : null, tools];
      }
      const x = hd.executiveSummary;
      return h("section", { class: "exec-summary", "aria-labelledby": "hd-summary" },
        h("h2", { id: "hd-summary" }, x.title || "Executive summary"),
        summaryBlocks(x.text),
        x.disclosure ? h("p", { class: "note" }, x.disclosure) : null,
        tools);
    }

    /* ---------- Exports ---------- */

    function printHandoff() {
      if (mode !== "handoff") { mode = "handoff"; render(); }
      setTimeout(() => window.print(), 50);
    }

    function exportCsv() {
      const e = eng();
      const csv = exporting.recordsToCsv(e, { includeSensitive, includeUnreviewedAi, handoffOnly: true });
      downloadBlob(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }), exporting.fileBase(e) + "-handoff-records.csv");
      announce("Handoff records exported" + (includeSensitive ? ", including sensitive records." : "."));
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
        [schema.label("dataStatus", e.meta.dataStatus), sc ? "Scenario: " + sc.name + " (" + schema.label("scenarioProvenance", sc.provenance).toLowerCase() + ") at " + units.formatDuration(app.view.t, e.meta.timeBasis) : "No scenario",
          "Exported " + formatDate(new Date().toISOString())].join("  \u00b7  ")));
      out.appendChild(s("text", { x: 16, y: 72, "font-size": 11, fill: muted }, "Legend: bold green outline complete, bold blue outline in progress, faded dashed outline not in scenario, dotted purple outline route not confirmed."));
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

    function exportDiagram(kind) {
      const e = eng();
      if (!app.processView.panes.length) app.goto("process");
      const svg = buildSvg();
      if (!svg) { B.dialogs.messageDialog("Nothing to export", "Open the Process workspace once so the diagram is drawn, then export again."); return; }
      const base = exporting.fileBase(e) + "-process";
      if (kind === "svg") {
        downloadBlob(new Blob([svg.text], { type: "image/svg+xml" }), base + ".svg");
        announce("Process SVG exported.");
        return;
      }
      const img = new Image();
      const url = URL.createObjectURL(new Blob([svg.text], { type: "image/svg+xml" }));
      img.onload = () => {
        const scale = Math.min(2, 16000 / svg.width, 16000 / svg.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(svg.width * scale); canvas.height = Math.round(svg.height * scale);
        const g = canvas.getContext("2d");
        g.scale(scale, scale);
        g.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob(blob => { if (blob) { downloadBlob(blob, base + ".png"); announce("Process PNG exported."); } }, "image/png");
      };
      img.onerror = () => { URL.revokeObjectURL(url); B.dialogs.messageDialog("PNG export failed", "Your browser could not render the diagram to an image. Use the SVG export instead."); };
      img.src = url;
    }

    function render() {
      if (!el.root) return;
      el.modeTabs.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.id === "pr-" + mode)));
      const e = eng();
      el.unreviewedLabel.hidden = !(e.records.some(r => exporting.isUnreviewedAi(r)) || (e.narratives || []).some(n => exporting.isUnreviewedAi(n)));
      if (el.unreviewedLabel.hidden && includeUnreviewedAi) { includeUnreviewedAi = false; el.unreviewed.checked = false; }
      clear(el.content);
      el.content.style.height = mode === "presenter" ? "100%" : "";
      if (mode === "presenter") renderPresenter(); else renderHandoff();
    }

    return { build, render, onEngagementChange: render, buildSvg, setMode: m => { mode = m; render(); } };
  }

  B.presentView = { createPresentView };
})(typeof globalThis !== "undefined" ? globalThis : this);
