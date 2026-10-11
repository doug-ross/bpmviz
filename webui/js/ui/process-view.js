/*
 * Process workspace: one current-state canvas by default, comparison on
 * request, scenario replay with an accessible time scrubber, find, lenses,
 * and the side panel for inspection and capture.
 */
(function (root) {
  "use strict";
  const B = root.AIxRay = root.AIxRay || {};
  const { h, s, clear, icon, iconButton, announce, isTypingTarget } = B.dom;
  const { schema, units, layout, lenses, replay: replayLib } = B;
  const { Diagram, Camera, Navigator } = B.diagram;

  const PLAY_MS = 24000;
  const SPEEDS = [0.5, 1, 2, 4];

  function createProcessView(app) {
    const view = app.view;
    const el = {};
    let panes = [];
    let replays = new Map();
    let raf = 0, lastTs = 0;
    let built = false, needsBuild = true, needsFit = true;
    let lensCache = new Map();
    let positions = new Map();
    let searchResults = [], searchIndex = -1;

    const camera = new Camera(onCamera);

    /* ---------- Model and scenario helpers ---------- */

    const eng = () => app.store.get();
    const tb = () => eng().meta.timeBasis;

    function currentModel() { return eng().models.find(m => m.role === "current") || eng().models[0]; }

    function displayedModels() {
      const e = eng();
      const [kind, id] = String(view.display || "").split(":");
      if (kind === "c") {
        const future = e.models.find(m => m.id === id);
        const base = future && future.basedOn ? e.models.find(m => m.id === future.basedOn.modelId) : currentModel();
        if (future && base) return [base, future];
      }
      const one = e.models.find(m => m.id === id);
      return [one || currentModel()];
    }

    function scenario() {
      const e = eng();
      return e.scenarios.find(x => x.id === view.scenarioId) || e.scenarios[0] || null;
    }

    function total() {
      let max = 0;
      replays.forEach(rp => { if (rp) max = Math.max(max, rp.duration); });
      return max;
    }

    function primaryRun() {
      const sc = scenario(), m = displayedModels()[0];
      return sc && m ? sc.runs[m.id] : null;
    }

    /* ---------- DOM ---------- */

    function build() {
      el.displaySel = h("select", { class: "select", id: "pv-display", "aria-label": "Process view" });
      el.scenarioSel = h("select", { class: "select", id: "pv-scenario", "aria-label": "Scenario" });
      el.rewind = iconButton("rewind", "Back to the start", { id: "pv-rewind" });
      el.play = iconButton("play", "Play", { id: "pv-play", "data-playing": "false" }, { showLabel: true, title: "Play (Space)" });
      el.end = iconButton("end", "Go to end", { id: "pv-end" });
      el.speed = h("button", { type: "button", class: "btn", id: "pv-speed", title: "Playback speed" }, "1\u00d7");
      el.scrub = h("input", { type: "range", min: 0, max: 1000, step: 1, value: 0, id: "pv-scrub", "aria-label": "Playback position" });
      el.clock = h("span", { class: "clock", id: "pv-clock", "aria-live": "off" }, "");
      el.findInput = h("input", { class: "input", id: "pv-find", type: "search", placeholder: "Search steps, roles or systems", "aria-label": "Search steps, roles or systems",
        role: "combobox", "aria-expanded": "false", "aria-controls": "pv-find-list", "aria-autocomplete": "list", autocomplete: "off", spellcheck: "false" });
      el.findList = h("ul", { class: "find-results", id: "pv-find-list", role: "listbox", "aria-label": "Matching steps", hidden: true });
      el.lensSel = h("select", { class: "select", id: "pv-lens", "aria-label": "Lens" });
      el.readable = h("button", { type: "button", class: "btn", id: "pv-readable", title: "Zoom to a size you can read (0)", "aria-pressed": "true" }, "Readable size");
      el.widthBtn = h("button", { type: "button", class: "btn", id: "pv-width", title: "Fit the process to the width (W)", "aria-pressed": "false" }, "Fit width");
      el.overviewBtn = iconButton("overview", "See every lane at once (F); labels may be too small to read", { id: "pv-overview", "aria-pressed": "false" }, { showLabel: true, title: "Overview (F)" });
      el.overviewBtn.querySelector(".label").textContent = "Overview";
      el.zoomOut = iconButton("zoomOut", "Zoom out (-)", { id: "pv-zout" });
      el.zoomIn = iconButton("zoomIn", "Zoom in (+)", { id: "pv-zin" });
      el.labels = h("button", { type: "button", class: "btn", id: "pv-labels", "aria-pressed": "true", title: "Show the labels on connectors" }, "Labels");
      el.panelBtn = iconButton("panel", "Show or hide the details panel", { id: "pv-panel", "aria-pressed": "true" });

      // Controls are grouped by what people are doing: choosing what to look at,
      // playing a case through the process, finding a step, and adjusting the display.
      el.toolbar = h("div", { class: "proc-toolbar", role: "toolbar", "aria-label": "Process controls" },
        h("div", { class: "tb-row" },
          h("div", { class: "tb-section", role: "group", "aria-label": "What you are looking at" },
            h("div", { class: "tb-group" }, h("label", { class: "tb-label", for: "pv-display" }, "View"), el.displaySel),
            h("div", { class: "tb-group" }, h("label", { class: "tb-label", for: "pv-scenario" }, "Scenario"), el.scenarioSel)),
          h("div", { class: "tb-section tb-play", role: "group", "aria-label": "Playback" }, el.rewind, el.play, el.end, el.speed,
            h("span", { class: "scrub" }, el.scrub), el.clock),
          h("div", { class: "tb-group tb-find find" }, icon("search"), el.findInput, el.findList)),
        h("div", { class: "tb-row tb-row-display", role: "group", "aria-label": "Display" },
          h("div", { class: "tb-group" }, h("label", { class: "tb-label", for: "pv-lens" }, "Lens"), el.lensSel),
          h("div", { class: "tb-group btn-group", role: "group", "aria-label": "Zoom presets" }, el.readable, el.widthBtn, el.overviewBtn),
          h("div", { class: "tb-group", role: "group", "aria-label": "Zoom" }, el.zoomOut, el.zoomIn),
          h("span", { class: "tb-spacer" }),
          h("div", { class: "tb-group" }, el.labels, el.panelBtn)));

      el.strip = h("div", { class: "strip", id: "pv-strip", "aria-label": "Milestone progress" });
      el.panes = h("div", { class: "panes", id: "pv-panes" });
      el.legend = h("div", { class: "legend", "aria-label": "Legend" });
      el.lensInfo = h("div", { class: "lens-legend", id: "pv-lens-info", "aria-live": "polite" });
      el.foot = h("div", { class: "stage-foot" }, el.legend, el.lensInfo);
      el.mm = s("svg", { class: "mm", tabindex: 0, "aria-label": "Process map. Arrow keys pan the canvas.", role: "img" });
      el.navZoom = h("span", { class: "muted" }, "");
      el.navToggle = h("button", { type: "button", class: "btn btn-ghost", "aria-expanded": "true", "aria-controls": "pv-map" }, "Hide");
      el.nav = h("div", { class: "navigator", id: "pv-map" },
        h("div", { class: "navigator-head" }, icon("map", { width: 14, height: 14 }), h("span", null, "Map"), el.navZoom, h("span", { class: "spacer" }), el.navToggle),
        el.mm);
      el.stage = h("div", { class: "stage" }, el.strip, el.panes, el.foot, el.nav);
      el.side = h("aside", { class: "side-panel", id: "pv-side", "aria-label": "Details" });
      el.body = h("div", { class: "proc-body" }, el.stage, el.side);
      el.root = h("section", { class: "process-ws", "aria-label": "Process" }, el.toolbar, el.body);

      buildLegend();
      bindControls();
      camera.navigator = new Navigator(el.mm, camera);
      if ("ResizeObserver" in window) new ResizeObserver(onResize).observe(el.stage);
      return el.root;
    }

    function legendGlyph(kind, pathD) {
      return s("svg", { viewBox: "-10 -10 20 20", "aria-hidden": "true", class: "lg lg-" + kind },
        kind === "pending" ? s("rect", { x: -8, y: -6, width: 16, height: 12, rx: 2 }) : s("circle", { r: 8 }),
        pathD ? s("path", { d: pathD, class: /Z$/.test(pathD) ? "solid" : "" }) : null);
    }

    function buildLegend() {
      clear(el.legend);
      [
        ["pending", null, "Not started"],
        ["active", "M-2.4,-4 L4.2,0 L-2.4,4 Z", "In progress"],
        ["done", "M-4,0.4 L-1.2,3.2 L4.2,-2.6", "Complete"],
        ["excluded", "M-4,4 L4,-4", "Not in scenario"],
        ["unknown", "M-2.4,-2.2 a2.6,2.6 0 1 1 3.6,2.4 c-0.9,0.4 -1.2,0.9 -1.2,1.8", "Route not confirmed"]
      ].forEach(([kind, d, label]) => el.legend.appendChild(h("span", { class: "legend-item" }, legendGlyph(kind, d), label)));
    }

    function bindControls() {
      el.displaySel.addEventListener("change", () => { view.display = el.displaySel.value; view.selected = null; rebuild(true); app.syncHash(); });
      el.scenarioSel.addEventListener("change", () => setScenario(el.scenarioSel.value));
      el.play.addEventListener("click", () => setPlaying(!view.playing));
      el.rewind.addEventListener("click", () => { view.t = 0; lastTs = 0; applyStates(); });
      el.end.addEventListener("click", () => { view.t = total(); lastTs = 0; applyStates(); });
      el.speed.addEventListener("click", () => {
        view.speed = SPEEDS[(SPEEDS.indexOf(view.speed) + 1) % SPEEDS.length];
        el.speed.textContent = view.speed + "\u00d7";
        el.speed.setAttribute("aria-label", "Playback speed " + view.speed + " times");
      });
      el.scrub.addEventListener("input", () => { view.t = Number(el.scrub.value) / 1000 * total(); applyStates(); });
      el.lensSel.addEventListener("change", () => { view.lens = el.lensSel.value; lensCache.clear(); applyLens(); });
      el.readable.addEventListener("click", () => camera.readable());
      el.widthBtn.addEventListener("click", () => camera.width());
      el.overviewBtn.addEventListener("click", () => camera.overview());
      el.zoomIn.addEventListener("click", () => camera.zoomBy(1.2));
      el.zoomOut.addEventListener("click", () => camera.zoomBy(1 / 1.2));
      el.labels.addEventListener("click", () => {
        view.labels = !view.labels;
        el.labels.setAttribute("aria-pressed", String(view.labels));
        el.panes.classList.toggle("no-labels", !view.labels);
      });
      el.panelBtn.addEventListener("click", () => setPanel(!view.panelOpen));
      el.navToggle.addEventListener("click", () => {
        const collapsed = el.nav.classList.toggle("collapsed");
        el.navToggle.textContent = collapsed ? "Show" : "Hide";
        el.navToggle.setAttribute("aria-expanded", String(!collapsed));
      });
      el.side.addEventListener("focusin", ev => {
        if (view.playing && ev.target.matches("input, textarea, select")) {
          setPlaying(false);
          announce("Paused while you edit.");
        }
      });
      bindFind();
    }

    /* ---------- Build and rebuild ---------- */

    function populateSelects() {
      const e = eng();
      clear(el.displaySel);
      e.models.forEach(m => el.displaySel.appendChild(h("option", { value: "m:" + m.id },
        m.name + " (" + (m.locked ? "baseline" : schema.label("modelStatus", m.status).toLowerCase()) + ")")));
      e.models.filter(m => m.role === "future").forEach(f => {
        const base = f.basedOn ? e.models.find(m => m.id === f.basedOn.modelId) : currentModel();
        el.displaySel.appendChild(h("option", { value: "c:" + f.id }, "Side by side: " + (base ? base.name : "Current state") + " and " + f.name));
      });
      if (![...el.displaySel.options].some(o => o.value === view.display)) view.display = "m:" + currentModel().id;
      el.displaySel.value = view.display;
      clear(el.scenarioSel);
      if (!e.scenarios.length) el.scenarioSel.appendChild(h("option", { value: "" }, "No timing recorded"));
      e.scenarios.forEach(sc => el.scenarioSel.appendChild(h("option", { value: sc.id }, sc.name + (sc.statusLabel ? " (" + sc.statusLabel + ")" : ""))));
      if (!e.scenarios.some(x => x.id === view.scenarioId)) view.scenarioId = e.scenarios.length ? e.scenarios[0].id : "";
      el.scenarioSel.value = view.scenarioId;
      el.scenarioSel.disabled = !e.scenarios.length;
      // Lenses, including any registered with lenses.registerLens since the last build.
      const lensIds = lenses.LENSES.map(l => l.id).join("|");
      if (el.lensSel.dataset.ids !== lensIds) {
        clear(el.lensSel);
        lenses.LENSES.forEach(l => el.lensSel.appendChild(h("option", { value: l.id }, l.label)));
        el.lensSel.dataset.ids = lensIds;
      }
      if (!lenses.LENSES.some(l => l.id === view.lens)) view.lens = "none";
      el.lensSel.value = view.lens;
    }

    function computeReplays() {
      replays = new Map();
      const sc = scenario();
      displayedModels().forEach(m => {
        const run = sc && sc.runs[m.id];
        replays.set(m.id, run ? replayLib.buildReplay(m, run, tb()) : null);
      });
    }

    function changeSummary(model) {
      const counts = { modified: 0, added: 0, removed: 0 };
      model.nodes.forEach(n => { if (n.lineage && counts[n.lineage.change] !== undefined) counts[n.lineage.change]++; });
      const parts = [];
      if (counts.modified) parts.push(counts.modified + " changed");
      if (counts.added) parts.push(counts.added + " added");
      if (counts.removed) parts.push(counts.removed + " removed");
      return parts.join(", ");
    }

    function paneHead(m, rp) {
      const sc = scenario();
      const status = m.locked ? B.drawer.badge("Locked baseline", "purple") :
        B.drawer.badge(schema.label("modelStatus", m.status), m.status === "draft" ? "info" : m.status === "proposed" ? "warning" : "");
      let hint = "";
      if (!rp) hint = m.role === "future" && m.basedOn ? "No timing for this draft yet" : "No timing recorded";
      else if (sc) hint = schema.label("timingMethod", sc.timing.method);
      const summary = m.role === "future" && m.basedOn ? changeSummary(m) : "";
      const g = m.generated;
      const ai = g ? [B.drawer.badge(g.reviewed ? "AI draft, reviewed" : "AI draft", g.reviewed ? "" : "purple"),
        g.reviewed ? null : h("button", { type: "button", class: "link-btn small", title: "Confirm you have checked this AI draft",
          on: { click: () => app.dispatch("model/markReviewed", { modelId: m.id }, m.name + " marked reviewed.") } }, "Mark reviewed")] : null;
      return h("header", { class: "pane-head" },
        h("span", { class: "pane-title" }, m.name), h("span", { class: "muted small" }, "v" + m.version), status, ai,
        summary ? h("span", { class: "small" }, summary) : null,
        h("span", { class: "spacer" }), h("span", { class: "hint" }, hint));
    }

    function rebuild(refit) {
      if (!isVisible()) { needsBuild = true; if (refit) needsFit = true; return; }
      needsBuild = false;
      populateSelects();
      computeReplays();
      const models = displayedModels();
      const lay = layout.computeLayout(models);
      positions = new Map();
      models.forEach(m => lay.models[m.id].pos.forEach((p, id) => positions.set(m.id + "|" + id, p.x)));
      clear(el.panes);
      el.panes.classList.toggle("compare", models.length > 1);
      el.panes.style.gridTemplateRows = "";
      panes = models.map((m, i) => {
        const rp = replays.get(m.id);
        const svg = s("svg", { "aria-label": m.name + " diagram", role: "group" });
        const gutter = h("div", { class: "gutter", "aria-hidden": "true" });
        const note = h("div", { class: "overview-note", hidden: true }, "Overview scale. Labels are too small to read; use Readable size, search, or select a step.");
        const viewEl = h("div", { class: "view" }, svg, note);
        const paneEl = h("section", { class: "pane", "aria-label": m.name }, paneHead(m, rp), h("div", { class: "pane-body" }, gutter, viewEl));
        const d = new Diagram({
          svg, gutter, view: viewEl, paneId: "p" + i,
          onActivate: (id, info) => selectNode(m.id, id, { focusDrawer: info && info.keyboard }),
          onFocusNode: id => camera.ensureVisible(d, id)
        });
        const lm = lay.models[m.id];
        if (i === 1) el.panes.appendChild(splitter());
        el.panes.appendChild(paneEl);
        d.build(m, lm, layout.routeAll(m, lm), {});
        camera.attach(d, nodeId => { if (nodeId) selectNode(m.id, nodeId, {}); else clearSelection(); });
        return { model: m, diagram: d, el: paneEl, note };
      });
      camera.setPanes(panes.map(p => p.diagram));
      built = true;
      const sc = scenario();
      panes.forEach(p => p.diagram.setDurations(replays.get(p.model.id), tb()));
      refreshRecordCounts();
      if (refit || needsFit) { camera.readable(); needsFit = false; }
      else { camera.clamp(); camera.apply(); }
      camera.navigator.rebuild(panes.map(p => p.diagram));
      if (view.t > total()) view.t = total();
      lensCache.clear();
      buildStrip();
      if (view.selected && !panes.some(p => p.model.id === view.selected.modelId && p.model.nodes.some(n => n.id === view.selected.nodeId))) view.selected = null;
      applySelection();
      applyLens();
      applyStates();
      renderSide();
      el.play.disabled = el.rewind.disabled = el.end.disabled = el.scrub.disabled = el.speed.disabled = !total();
      if (!sc) el.clock.textContent = "No timing";
    }

    function splitter() {
      const bar = h("div", { class: "splitter", role: "separator", tabindex: 0, "aria-orientation": "horizontal",
        "aria-label": "Resize the two panes", "aria-valuemin": 20, "aria-valuemax": 80, "aria-valuenow": 50 });
      let ratio = 0.5, drag = null;
      const setRatio = r => {
        ratio = Math.max(0.2, Math.min(0.8, r));
        el.panes.style.gridTemplateRows = "minmax(0," + ratio + "fr) 12px minmax(0," + (1 - ratio) + "fr)";
        bar.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
        requestAnimationFrame(() => { camera.clamp(); camera.apply(); });
      };
      bar.addEventListener("pointerdown", e => { drag = { y: e.clientY, r: ratio, hgt: el.panes.clientHeight }; bar.setPointerCapture(e.pointerId); });
      bar.addEventListener("pointermove", e => { if (drag) setRatio(drag.r + (e.clientY - drag.y) / Math.max(1, drag.hgt)); });
      bar.addEventListener("pointerup", () => { drag = null; });
      bar.addEventListener("keydown", e => {
        if (e.key === "ArrowUp") { e.preventDefault(); setRatio(ratio - 0.05); }
        if (e.key === "ArrowDown") { e.preventDefault(); setRatio(ratio + 0.05); }
      });
      bar.addEventListener("dblclick", () => setRatio(0.5));
      return bar;
    }

    function isVisible() {
      return el.root && el.root.offsetParent !== null && el.stage.clientWidth > 0;
    }

    /* ---------- State application ---------- */

    function applyStates() {
      if (!built) return;
      const T = total();
      view.t = Math.max(0, Math.min(T, view.t || 0));
      panes.forEach(p => p.diagram.applyReplay(replays.get(p.model.id), view.t, tb()));
      camera.navigator.syncStates();
      if (view.lens === "sla") { lensCache.delete("sla"); applyLens(); }
      updateStrip();
      el.scrub.value = String(T ? Math.round(view.t / T * 1000) : 0);
      const clock = T ? units.formatDuration(view.t, tb()) + " / " + units.formatDuration(T, tb()) : "No timing";
      el.clock.textContent = clock;
      el.scrub.setAttribute("aria-valuetext", clock);
      if (view.selected) B.drawer.refreshStatus(el.side, drawerCtx());
    }

    function applyLens() {
      if (!built) return;
      const sc = scenario();
      let info = null;
      panes.forEach((p, i) => {
        const key = view.lens + "|" + p.model.id;
        let result = lensCache.get(key);
        if (!result) {
          result = lenses.computeLens(view.lens, { model: p.model, replay: replays.get(p.model.id), t: view.t, engagement: eng(), scenarioName: sc ? sc.name : "" });
          lensCache.set(key, result);
        }
        p.diagram.setLens(view.lens === "none" ? null : result);
        if (i === 0) info = result;
      });
      camera.navigator.syncStates();
      el.lensSel.value = view.lens;
      clear(el.lensInfo);
      if (!info || view.lens === "none") return;
      el.lensInfo.appendChild(h("strong", null, info.title + ": "));
      el.lensInfo.appendChild(h("span", null, info.description + " " + (info.coverage ? info.coverage.text + "." : "")));
      info.legend.filter(l => l.label).forEach(l => el.lensInfo.appendChild(h("span", { class: "legend-item" },
        l.level ? h("span", { class: "sw" }, h("i", { style: { width: (l.level * 25) + "%" } })) : null, l.label)));
      info.notes.forEach(n => el.lensInfo.appendChild(h("span", { class: "muted" }, n)));
      el.lensInfo.appendChild(h("span", { class: "muted" }, info.population));
    }

    function buildStrip() {
      clear(el.strip);
      const rows = panes.map(p => ({ p, rp: replays.get(p.model.id) })).filter(r => r.rp);
      el.strip.hidden = !rows.length;
      if (!rows.length) return;
      const T = total();
      const sc = scenario();
      const ms = eng().milestones;
      el.stripRows = rows.map(({ p, rp }) => {
        const run = sc.runs[p.model.id];
        const fill = h("div", { class: "strip-fill" });
        const head = h("div", { class: "strip-head" });
        const marks = ms.filter(m => run.milestones && B.util.isFiniteNumber(run.milestones[m.id])).map(m => {
          const at = run.milestones[m.id];
          const dot = h("div", { class: "strip-ms", title: m.name + " at " + units.formatDuration(at, tb()), style: { left: (T ? at / T * 100 : 0) + "%" } });
          return { dot, at };
        });
        const time = h("span", { class: "strip-time" }, "");
        const track = h("div", { class: "strip-track" }, h("div", { class: "strip-line", style: { width: (T ? rp.duration / T * 100 : 100) + "%" } }), fill, ...marks.map(x => x.dot), head);
        el.strip.appendChild(h("div", { class: "strip-row" }, h("span", { class: "strip-name", title: p.model.name }, p.model.name), track, time));
        return { rp, fill, head, marks, time };
      });
      const first = rows[0], run = sc.runs[first.p.model.id];
      const named = ms.filter(m => run.milestones && B.util.isFiniteNumber(run.milestones[m.id]));
      if (named.length) {
        const names = h("div", { class: "names", "aria-hidden": "true" });
        // Skip names that would overlap the previous one; every marker keeps its tooltip.
        const trackWidth = Math.max(200, el.stage.clientWidth - 260);
        let lastRight = -Infinity;
        named.forEach((m, i) => {
          const at = run.milestones[m.id];
          const x = (T ? at / T : 0) * trackWidth;
          const w = B.textfit.measure(m.name, 11, 400) + 10;
          const isLast = i === named.length - 1;
          const left = i === 0 ? x : isLast ? x - w : x - w / 2;
          if (left < lastRight) return;
          lastRight = left + w;
          names.appendChild(h("span", { class: i === 0 ? "first" : isLast ? "last" : "", style: { left: (T ? at / T * 100 : 0) + "%" } }, m.name));
        });
        el.strip.appendChild(h("div", { class: "strip-labels" }, h("span"), names, h("span")));
      }
    }

    function updateStrip() {
      if (!el.stripRows) return;
      const T = total();
      el.stripRows.forEach(r => {
        const t = Math.min(view.t, r.rp.duration);
        r.fill.style.width = (T ? t / T * 100 : 0) + "%";
        r.head.style.left = (T ? t / T * 100 : 0) + "%";
        r.marks.forEach(m => m.dot.classList.toggle("hit", view.t >= m.at - 1e-6));
        r.time.textContent = units.formatDuration(t, tb());
      });
    }

    function refreshRecordCounts() {
      const e = eng();
      panes.forEach(p => {
        const counts = new Map();
        e.records.forEach(r => {
          if (r.status === "dropped") return;
          if (r.linkedModelId && r.linkedModelId !== p.model.id) return;
          r.linkedNodeIds.forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
        });
        p.counts = counts;
        p.diagram.setRecordCounts(counts);
      });
      camera.navigator.syncStates();
    }

    function recordCount(modelId, nodeId) {
      const p = panes.find(x => x.model.id === modelId);
      return p && p.counts ? p.counts.get(nodeId) || 0 : 0;
    }

    /* ---------- Playback ---------- */

    function setPlaying(value) {
      const T = total();
      if (!T) return;
      if (value && view.t >= T) view.t = 0;
      view.playing = !!value;
      lastTs = 0;
      clear(el.play);
      el.play.append(icon(view.playing ? "pause" : "play"), h("span", { class: "label" }, view.playing ? "Pause" : "Play"));
      el.play.setAttribute("data-playing", String(view.playing));
      el.play.setAttribute("aria-label", view.playing ? "Pause" : "Play");
      el.play.title = view.playing ? "Pause (Space)" : "Play (Space)";
      if (view.playing && !raf) raf = requestAnimationFrame(tick);
      applyStates();
    }

    function tick(ts) {
      raf = 0;
      if (!view.playing) return;
      const dt = lastTs ? Math.min(100, Math.max(0, ts - lastTs)) : 0;
      lastTs = ts;
      const T = total();
      view.t = Math.min(T, view.t + dt / PLAY_MS * T * view.speed);
      applyStates();
      if (view.t >= T) { setPlaying(false); announce("End of the scenario."); return; }
      raf = requestAnimationFrame(tick);
    }

    function setScenario(id) {
      view.scenarioId = id;
      computeReplays();
      const run = primaryRun();
      view.t = run && B.util.isFiniteNumber(run.pauseAt) ? run.pauseAt : 0;
      lastTs = 0;
      lensCache.clear();
      panes.forEach(p => {
        const head = p.el.querySelector(".pane-head");
        head.replaceWith(paneHead(p.model, replays.get(p.model.id)));
        p.diagram.setDurations(replays.get(p.model.id), tb());
      });
      buildStrip();
      applyLens();
      applyStates();
      renderSide();
      el.play.disabled = el.rewind.disabled = el.end.disabled = el.scrub.disabled = el.speed.disabled = !total();
      app.syncHash();
      const sc = scenario();
      if (sc) announce("Scenario " + sc.name + ". " + el.clock.textContent);
    }

    /* ---------- Selection and side panel ---------- */

    function lineageMatches(modelId, nodeId) {
      const e = eng();
      const src = e.models.find(m => m.id === modelId);
      const node = src && src.nodes.find(n => n.id === nodeId);
      const out = new Map();
      panes.forEach(p => {
        if (p.model.id === modelId) return;
        const ids = new Set();
        if (node && node.lineage && node.lineage.baselineNodeId && p.model.id === src.basedOn.modelId) ids.add(node.lineage.baselineNodeId);
        if (p.model.basedOn && p.model.basedOn.modelId === modelId) {
          p.model.nodes.forEach(n => { if (n.lineage && n.lineage.baselineNodeId === nodeId) ids.add(n.id); });
        }
        out.set(p.model.id, ids);
      });
      return out;
    }

    function applySelection() {
      const sel = view.selected;
      const matches = sel ? lineageMatches(sel.modelId, sel.nodeId) : new Map();
      panes.forEach(p => {
        p.diagram.setSelected(sel && sel.modelId === p.model.id ? sel.nodeId : null);
        p.diagram.setMatches(matches.get(p.model.id) || null);
      });
    }

    function selectNode(modelId, nodeId, opts) {
      const o = opts || {};
      const pane = panes.find(p => p.model.id === modelId);
      if (!pane) return;
      const same = view.selected && view.selected.modelId === modelId && view.selected.nodeId === nodeId;
      view.selected = { modelId, nodeId };
      if (!same && !o.keepTab) view.drawerTab = o.tab || "summary";
      if (o.tab) view.drawerTab = o.tab;
      applySelection();
      setPanel(true);
      renderSide();
      if (o.center) camera.focusOn(pane.diagram, nodeId, 0.9);
      if (o.focusDrawer) {
        const t = el.side.querySelector("#drawer-title");
        if (t) t.focus();
      }
      const node = pane.model.nodes.find(n => n.id === nodeId);
      if (node && !o.silent) announce(node.label + " selected.");
    }

    function clearSelection() {
      if (!view.selected) return;
      view.selected = null;
      applySelection();
      renderSide();
    }

    function closeDrawer() {
      const prev = view.selected;
      clearSelection();
      if (prev) {
        const pane = panes.find(p => p.model.id === prev.modelId);
        const nodeEl = pane && pane.diagram.nodeEl(prev.nodeId);
        if (nodeEl) nodeEl.focus();
      }
      if (window.matchMedia("(max-width: 1180px)").matches) setPanel(false);
    }

    function setPanel(open) {
      view.panelOpen = !!open;
      el.body.classList.toggle("panel-closed", !view.panelOpen);
      el.panelBtn.setAttribute("aria-pressed", String(view.panelOpen));
      requestAnimationFrame(() => { if (built) { camera.clamp(); camera.apply(); } });
    }

    function drawerCtx() {
      const e = eng();
      const sc = scenario();
      return {
        app, includeSensitive: false, includeUnreviewedAi: false, scenarioId: view.scenarioId || "", rerender: () => renderSide(),
        engagement: e, scenario: sc, replays, t: view.t, selected: view.selected, tab: view.drawerTab || "summary",
        primaryModel: displayedModels()[0],
        positions: (modelId, nodeId) => positions.get(modelId + "|" + nodeId) || 0,
        recordCount,
        select: (modelId, nodeId, opts) => selectNode(modelId, nodeId, opts),
        setTab: (tab, focusTab) => {
          view.drawerTab = tab;
          renderSide();
          const target = el.side.querySelector(focusTab ? "#dt-" + tab : "#drawer-panel");
          if (target) target.focus();
        },
        close: closeDrawer,
        focusNode: (modelId, nodeId) => { const p = panes.find(x => x.model.id === modelId); if (p) camera.focusOn(p.diagram, nodeId, 0.9); },
        fullDetails: (modelId, nodeId) => {
          const m = e.models.find(x => x.id === modelId), n = m && m.nodes.find(x => x.id === nodeId);
          if (!n) return;
          B.dialogs.openDialog({ title: n.label, eyebrow: "All details", wide: true,
            body: B.drawer.fullDetailsBody(e, m, n, replays.get(modelId), view.t),
            actions: [{ label: "Close", variant: "btn-primary", autofocus: true }] });
        },
        openRecord: r => app.openRecordDialog(r),
        dispatch: (type, payload, msg, errEl) => app.dispatch(type, payload, msg, errEl),
        goto: ws => app.goto(ws),
        cloneBaseline: modelId => app.cloneBaseline(modelId),
        aiTask: B.aiPanel && B.aiPanel.enabled ? task => B.aiPanel.openTask(app, task) : null,
        showModel: (modelId, nodeId) => {
          view.display = "c:" + modelId;
          rebuild(false);
          selectNode(modelId, nodeId, { tab: "edit", center: true });
        },
        baselineLabel: (model, id) => {
          const base = e.models.find(m => model.basedOn && m.id === model.basedOn.modelId);
          const n = base && base.nodes.find(x => x.id === id);
          return n ? n.label + " (" + base.name + ")" : id;
        },
        insertAfter: (modelId, nodeId) => app.insertStepDialog(modelId, nodeId),
        removeStep: (modelId, nodeId) => app.removeStepDialog(modelId, nodeId)
      };
    }

    let sideKey = "";
    function renderSide() {
      if (!built) return;
      const key = view.selected ? view.selected.modelId + "|" + view.selected.nodeId + "|" + view.drawerTab : "overview|" + view.display + "|" + view.scenarioId;
      const scrollTop = key === sideKey ? el.side.scrollTop : 0;
      sideKey = key;
      const ctx = drawerCtx();
      if (view.selected) {
        if (!B.drawer.renderActivity(el.side, ctx)) { view.selected = null; B.drawer.renderOverview(el.side, ctx); }
      } else {
        B.drawer.renderOverview(el.side, ctx);
      }
      el.side.scrollTop = scrollTop;
    }

    /* ---------- Find ---------- */

    function bindFind() {
      const input = el.findInput, list = el.findList;
      const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); searchIndex = -1; };
      const choose = i => {
        const r = searchResults[i];
        if (!r) return;
        close();
        selectNode(r.modelId, r.nodeId, { center: true });
        const pane = panes.find(p => p.model.id === r.modelId);
        const nodeEl = pane && pane.diagram.nodeEl(r.nodeId);
        if (nodeEl) nodeEl.focus({ preventScroll: true });
      };
      const highlight = i => {
        searchIndex = i;
        [...list.children].forEach((li, j) => li.setAttribute("aria-selected", String(j === i)));
        if (list.children[i]) { input.setAttribute("aria-activedescendant", list.children[i].id); list.children[i].scrollIntoView({ block: "nearest" }); }
      };
      input.addEventListener("input", () => {
        const q = input.value.trim().toLowerCase();
        clear(list);
        searchResults = [];
        if (!q) { close(); panes.forEach(p => p.diagram.setMatches(null)); applySelection(); return; }
        panes.forEach(p => {
          const lanes = new Map(p.model.lanes.map(l => [l.id, l]));
          p.model.nodes.forEach(n => {
            const d = n.details || {};
            const lane = lanes.get(n.laneId);
            const hay = [n.label, n.sub, lane && lane.name, lane && lane.role, d.who, d.owner, [].concat(d.systems || []).join(" ")].join(" ").toLowerCase();
            if (hay.includes(q)) searchResults.push({ modelId: p.model.id, nodeId: n.id, label: n.label, where: (lane ? lane.name : "") + (panes.length > 1 ? " \u00b7 " + p.model.name : "") });
          });
        });
        const matchSets = new Map();
        searchResults.forEach(r => { if (!matchSets.has(r.modelId)) matchSets.set(r.modelId, new Set()); matchSets.get(r.modelId).add(r.nodeId); });
        panes.forEach(p => p.diagram.setMatches(matchSets.get(p.model.id) || null));
        searchResults.slice(0, 20).forEach((r, i) => {
          const li = h("li", { role: "option", id: "pv-find-" + i, "aria-selected": "false" }, r.label, h("span", { class: "muted" }, r.where));
          li.addEventListener("mousedown", ev => { ev.preventDefault(); choose(i); });
          list.appendChild(li);
        });
        if (!searchResults.length) list.appendChild(h("li", { role: "option", "aria-disabled": "true", class: "muted" }, "No matching steps"));
        list.hidden = false;
        input.setAttribute("aria-expanded", "true");
        announce(searchResults.length + " matching steps.");
      });
      input.addEventListener("keydown", ev => {
        if (ev.key === "ArrowDown") { ev.preventDefault(); highlight(Math.min(searchResults.length - 1, searchIndex + 1)); }
        else if (ev.key === "ArrowUp") { ev.preventDefault(); highlight(Math.max(0, searchIndex - 1)); }
        else if (ev.key === "Enter") { ev.preventDefault(); choose(searchIndex >= 0 ? searchIndex : 0); }
        else if (ev.key === "Escape") { ev.stopPropagation(); if (!list.hidden) close(); else { input.value = ""; input.dispatchEvent(new Event("input")); } }
      });
      input.addEventListener("blur", () => setTimeout(close, 150));
    }

    /* ---------- Camera and resize ---------- */

    function onCamera(cam) {
      el.readable.setAttribute("aria-pressed", String(cam.mode === "readable"));
      el.widthBtn.setAttribute("aria-pressed", String(cam.mode === "width"));
      el.overviewBtn.setAttribute("aria-pressed", String(cam.mode === "overview"));
      const small = cam.zoom < 0.5;
      panes.forEach(p => { p.note.hidden = !small; });
      el.navZoom.textContent = Math.round(cam.zoom * 100) + "%";
      if (cam.navigator) cam.navigator.update();
    }

    let resizeFrame = 0;
    function onResize() {
      if (resizeFrame) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        if (!isVisible()) return;
        if (needsBuild) { rebuild(needsFit); return; }
        if (camera.mode === "readable") camera.readable();
        else if (camera.mode === "width") camera.width();
        else if (camera.mode === "overview") camera.overview();
        else { camera.clamp(); camera.apply(); }
      });
    }

    /* ---------- Keyboard ---------- */

    function handleKey(ev) {
      if (ev.defaultPrevented) return;
      if (ev.key === "Escape") {
        if (view.selected) { ev.preventDefault(); closeDrawer(); }
        return;
      }
      if (isTypingTarget(ev.target) || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const t = ev.target;
      const onControl = t instanceof Element && !!t.closest("button, a, select, summary, [role=tablist], [role=listbox], .activity-list, .splitter, svg.mm");
      if (ev.key === "/") { ev.preventDefault(); el.findInput.focus(); return; }
      if (onControl && (ev.key === " " || ev.key.startsWith("Arrow"))) return;
      if (ev.key === " ") { ev.preventDefault(); setPlaying(!view.playing); }
      else if (ev.key === "+" || ev.key === "=") { ev.preventDefault(); camera.zoomBy(1.2); }
      else if (ev.key === "-" || ev.key === "_") { ev.preventDefault(); camera.zoomBy(1 / 1.2); }
      else if (ev.key === "0") { ev.preventDefault(); camera.readable(); }
      else if (ev.key === "f" || ev.key === "F") { ev.preventDefault(); camera.overview(); }
      else if (ev.key === "w" || ev.key === "W") { ev.preventDefault(); camera.width(); }
      else if (ev.key.startsWith("Arrow")) {
        ev.preventDefault();
        camera.panBy(ev.key === "ArrowLeft" ? 60 : ev.key === "ArrowRight" ? -60 : 0, ev.key === "ArrowUp" ? 60 : ev.key === "ArrowDown" ? -60 : 0);
      }
    }

    /* ---------- Public ---------- */

    function onEngagementChange(event) {
      const type = event.type;
      const structural = type === "replace" || type === "undo" || type.startsWith("model/") || type === "node/update" || type === "meta/update" || type === "ai/applyFutureState" ||
        B.ext.isStructural(type);
      if (type === "replace") {
        view.selected = null; view.t = 0; view.playing = false; view.lens = view.lens || "none";
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        clear(el.play); el.play.append(icon("play"), h("span", { class: "label" }, "Play"));
        el.play.setAttribute("data-playing", "false");
        el.play.setAttribute("aria-label", "Play");
      }
      if (structural) {
        if (type === "replace") {
          populateSelects();
          computeReplays();
          const run = primaryRun();
          view.t = run && B.util.isFiniteNumber(run.pauseAt) ? run.pauseAt : 0;
        }
        rebuild(type === "replace");
        return;
      }
      if (!built) return;
      if (type.startsWith("record/") || type === "ai/applySuggestions") refreshRecordCounts();
      if (type.startsWith("measure/") || type.startsWith("assumption/") || type.startsWith("scenario/") || type.startsWith("evidence/")) lensCache.clear();
      if (B.ext.isRefresh(type)) { lensCache.clear(); refreshRecordCounts(); applyLens(); }
      renderSide();
    }

    function activate() {
      if (needsBuild || !built) rebuild(needsFit);
      else onResize();
    }

    return {
      build, activate, onEngagementChange, handleKey, selectNode, setScenario, closeDrawer, setPlaying,
      get camera() { return camera; },
      get panes() { return panes; },
      displayedModels,
      state: () => ({ t: view.t, total: total(), playing: view.playing, zoom: camera.zoom, mode: camera.mode })
    };
  }

  B.processView = { createProcessView };
})(typeof globalThis !== "undefined" ? globalThis : this);
