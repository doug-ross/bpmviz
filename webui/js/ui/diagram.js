/*
 * Process diagram rendering: one Diagram per pane, a Camera shared by all
 * visible panes (one pan and zoom), and a Navigator overview.
 * Status is shown by shape, stroke and a corner glyph as well as color.
 */
(function (root) {
  "use strict";
  const B = root.AIxRay = root.AIxRay || {};
  const { h, s, clear, icon } = B.dom;
  const { fitted, update, measure } = B.textfit;
  const { G } = B.layout;
  const schema = B.schema;
  const units = B.units;
  const replayLib = B.replay;

  const STATE_TEXT = {
    pending: "Not started", unscheduled: "No timing supplied", excluded: "Not in this scenario",
    unknown: "Route not confirmed", done: "Complete", active: "In progress"
  };

  function statusText(st, timeBasis) {
    if (!st) return "No scenario selected";
    if (st.state === "active") {
      let text = "In progress";
      if (st.visitCount > 1) text += ", visit " + (st.visitIndex + 1) + " of " + st.visitCount;
      text += ", " + units.formatDuration(st.elapsed, timeBasis) + " elapsed";
      if (st.sla) text += st.sla.state === "breach" ? ", over SLA target" : st.sla.state === "warn" ? ", near SLA target" : "";
      return text;
    }
    if (st.state === "done") {
      return st.completedVisits > 1 ? "Complete, " + st.completedVisits + " visits" :
        (st.visitCount > 1 ? "Visit 1 of " + st.visitCount + " complete" : "Complete");
    }
    return STATE_TEXT[st.state] || st.state;
  }

  function laneIcon(type) {
    return type === "agent" ? "agent" : type === "external" ? "external" : "person";
  }

  function tagText(node) {
    const t = node.tags || {};
    const parts = [];
    if (t.agent) parts.push("AI");
    if (t.humanReview) parts.push("HUMAN REVIEW");
    if (t.bottleneck) parts.push("BOTTLENECK");
    if (t.optional) parts.push("OPTIONAL");
    if (t.sampled) parts.push("SAMPLED");
    return parts.slice(0, 2).join(" \u00b7 ");
  }

  const CHANGE_TEXT = { added: "ADDED", modified: "CHANGED", removed: "REMOVED" };

  function glyphs(parent, cx, cy) {
    const r = 9;
    const mk = (cls, ...paths) => parent.appendChild(s("g", { class: "glyph " + cls, transform: "translate(" + cx + "," + cy + ")" },
      s("circle", { r }), ...paths));
    mk("g-active", s("path", { class: "fill", d: "M-2.6,-4.4 L4.6,0 L-2.6,4.4 Z" }));
    mk("g-done", s("path", { d: "M-4,0.4 L-1.2,3.2 L4.2,-2.6" }));
    mk("g-excluded", s("path", { d: "M-4,4 L4,-4" }));
    mk("g-unknown", s("path", { d: "M-2.4,-2.2 a2.6,2.6 0 1 1 3.6,2.4 c-0.9,0.4 -1.2,0.9 -1.2,1.8 M0,4.4 v0.2" }));
  }

  class Diagram {
    constructor(opts) {
      this.svg = opts.svg;
      this.gutter = opts.gutter;
      this.view = opts.view;
      this.paneId = opts.paneId;
      this.onActivate = opts.onActivate || (() => {});
      this.onFocusNode = opts.onFocusNode || (() => {});
      this.nodeEls = new Map();
      this.edgeEls = new Map();
      this.model = null;
    }

    build(model, lm, routes, ctx) {
      this.model = model;
      this.lm = lm;
      this.ctx = ctx || {};
      const svg = this.svg;
      clear(svg);
      svg.setAttribute("class", "diagram");
      const defs = s("defs");
      ["default", "traversed", "active"].forEach(kind => {
        const m = s("marker", { id: this.markerId(kind), markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: "auto", markerUnits: "userSpaceOnUse" },
          s("path", { d: "M0,0 L8,4 L0,8 Z", class: "mk mk-" + kind }));
        defs.appendChild(m);
      });
      svg.appendChild(defs);
      const content = s("g", { class: "content" });
      svg.appendChild(content);
      this.content = content;
      model.lanes.forEach((lane, i) => {
        const y = lm.laneTop + i * lm.laneHeight;
        content.appendChild(s("rect", { class: "lane-band " + (i % 2 ? "b" : "a"), x: 0, y, width: lm.width, height: lm.laneHeight }));
        content.appendChild(s("line", { class: "lane-sep", x1: 0, x2: lm.width, y1: y, y2: y }));
      });
      content.appendChild(s("line", { class: "lane-sep", x1: 0, x2: lm.width, y1: lm.height - 4, y2: lm.height - 4 }));
      const edgeLayer = s("g"), labelLayer = s("g"), nodeLayer = s("g");
      content.append(edgeLayer, labelLayer, nodeLayer);
      this.edgeEls.clear();
      model.edges.forEach(edge => {
        const points = routes.get(edge.id);
        if (!points) return;
        const path = s("path", {
          class: "edge" + (edge.dashed ? " dashed" : "") + (edge.removed ? " removed" : ""),
          "data-edge": edge.id,
          d: points.map((p, i) => (i ? "L" : "M") + p.x + "," + p.y).join(" "),
          "marker-end": "url(#" + this.markerId("default") + ")"
        });
        edgeLayer.appendChild(path);
        if (edge.label) this.edgeLabel(labelLayer, points, edge.label);
        this.edgeEls.set(edge.id, { el: path, edge, state: null });
      });
      this.nodeEls.clear();
      const laneById = new Map(model.lanes.map(l => [l.id, l]));
      model.nodes.forEach(node => {
        const p = lm.pos.get(node.id);
        if (!p) return;
        this.nodeEls.set(node.id, this.drawNode(nodeLayer, node, p, laneById.get(node.laneId)));
      });
      this.buildGutter(model, lm);
    }

    markerId(kind) { return "arr-" + this.paneId + "-" + kind; }

    edgeLabel(parent, points, value) {
      const segs = points.slice(1).map((b, i) => {
        const a = points[i];
        return { a, b, horizontal: a.y === b.y, length: Math.abs(a.x - b.x) + Math.abs(a.y - b.y) };
      }).filter(sg => sg.length > 12);
      if (!segs.length) return;
      const preferred = measure(value, 10, 500) + 12;
      const horizontal = segs.filter(sg => sg.horizontal && sg.length >= preferred);
      const seg = (horizontal.length ? horizontal : segs).reduce((a, b) => a.length > b.length ? a : b);
      const width = Math.min(120, Math.max(14, seg.length - 8, Math.min(preferred, seg.length - 8)));
      const cx = (seg.a.x + seg.b.x) / 2, cy = (seg.a.y + seg.b.y) / 2;
      const g = s("g", { class: "edge-tag", transform: "translate(" + cx + "," + cy + ")" + (seg.horizontal ? "" : " rotate(-90)") });
      parent.appendChild(g);
      g.appendChild(s("rect", { x: -width / 2, y: -8, width, height: 16, rx: 3 }));
      fitted(g, value, { x: -width / 2 + 3, y: -7, w: width - 6, h: 14 }, { max: 10, weight: 500 });
    }

    drawNode(parent, node, p, lane) {
      const info = schema.typeInfo(node.semanticType);
      const shape = info.shape;
      const change = node.lineage && node.lineage.change !== "unchanged" ? node.lineage.change : null;
      const tags = node.tags || {};
      const cls = ["node", "shape-" + shape];
      Object.keys(tags).forEach(k => { if (tags[k]) cls.push("tag-" + k); });
      if (node.removed) cls.push("removed");
      if (change) cls.push("chg-" + change);
      const g = s("g", { class: cls.join(" "), tabindex: 0, role: "button", "data-node": node.id });
      g.nodeId = node.id;
      parent.appendChild(g);
      const title = s("title");
      title.textContent = node.label + (node.sub ? ", " + node.sub : "");
      g.appendChild(title);
      const x = p.x, y = p.y;
      let glyphAt, countAt;
      if (shape === "task") {
        g.appendChild(s("rect", { class: "ring", x: x - 98, y: y - 38, width: 196, height: 76, rx: 12 }));
        g.appendChild(s("rect", { class: "nbox", x: x - G.taskW / 2, y: y - G.taskH / 2, width: G.taskW, height: G.taskH, rx: 8 }));
        const tagLine = change ? CHANGE_TEXT[change] : tagText(node);
        if (tagLine) fitted(g, tagLine, { x: x - 84, y: y - 30, w: 96, h: 11 }, { max: 8.5, weight: 700, cls: change ? "change-mark" : "ntag", anchor: "start" });
        g.badge = fitted(g, "", { x: x + 16, y: y - 30, w: 64, h: 11 }, { max: 8.5, weight: 500, cls: "nbadge" });
        g.label = fitted(g, node.label, { x: x - 84, y: y - 17, w: 168, h: 31 }, { max: 15, weight: 600, lines: 2, cls: "nlabel" });
        g.sub = node.sub ? fitted(g, node.sub, { x: x - 84, y: y + 15, w: 168, h: 11 }, { max: 10.5, weight: 400, cls: "nsub" }) : null;
        g.lensTrack = s("rect", { class: "lens-track", x: x - 84, y: y + 25, width: 168, height: 4, rx: 2, visibility: "hidden" });
        g.lensBar = s("rect", { class: "lens-bar", x: x - 84, y: y + 25, width: 0, height: 4, rx: 2, visibility: "hidden" });
        g.append(g.lensTrack, g.lensBar);
        g.lensText = fitted(g, "", { x: x - 84, y: y + 14, w: 168, h: 11 }, { max: 10, weight: 700, cls: "lens-text" });
        glyphAt = [x + G.taskW / 2 - 2, y - G.taskH / 2 + 2];
        countAt = [x + G.taskW / 2 - 2, y + G.taskH / 2 - 2];
      } else {
        const r = shape === "gateway" ? G.gatewayR : G.eventR;
        g.appendChild(s("circle", { class: "ring", cx: x, cy: y, r: r + 7 }));
        if (shape === "gateway") {
          g.appendChild(s("polygon", { class: "nbox", points: x + "," + (y - r) + " " + (x + r) + "," + y + " " + x + "," + (y + r) + " " + (x - r) + "," + y }));
          const mark = info.mark;
          if (mark === "x") g.appendChild(s("path", { class: "gw-mark", d: "M" + (x - 6) + "," + (y - 6) + " L" + (x + 6) + "," + (y + 6) + " M" + (x + 6) + "," + (y - 6) + " L" + (x - 6) + "," + (y + 6) }));
          else if (mark === "+") g.appendChild(s("path", { class: "gw-mark", d: "M" + x + "," + (y - 8) + " V" + (y + 8) + " M" + (x - 8) + "," + y + " H" + (x + 8) }));
          else if (mark === "o") g.appendChild(s("circle", { class: "gw-mark", cx: x, cy: y, r: 7 }));
          else if (mark === "e") g.appendChild(s("circle", { class: "gw-mark", cx: x, cy: y, r: 8 }));
        } else {
          g.appendChild(s("circle", { class: "nbox", cx: x, cy: y, r }));
          if (shape === "start") g.appendChild(s("circle", { class: "start-dot", cx: x, cy: y, r: 5 }));
          if (shape === "event") g.appendChild(s("circle", { class: "nbox", cx: x, cy: y, r: r - 4 }));
        }
        g.label = fitted(g, node.label, { x: x - 92, y: y + r + 3, w: 184, h: 15 }, { max: 11.5, weight: 600, cls: "nlabel" });
        g.badge = null;
        glyphAt = [x + r * 0.78, y - r * 0.78];
        countAt = [x + r * 0.9, y + r * 0.8];
      }
      glyphs(g, glyphAt[0], glyphAt[1]);
      g.recCount = s("g", { class: "rec-count", transform: "translate(" + countAt[0] + "," + countAt[1] + ")", visibility: "hidden" },
        s("circle", { r: 9 }), s("text", { "text-anchor": "middle", "dominant-baseline": "central", "font-size": 10 }, ""));
      g.appendChild(g.recCount);
      g.addEventListener("keydown", ev => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault(); ev.stopPropagation();
          this.onActivate(node.id, { keyboard: true });
        }
      });
      g.addEventListener("focus", () => this.onFocusNode(node.id));
      g.info = { node, lane, shape, typeLabel: schema.typeInfo(node.semanticType).label };
      g.status = "";
      this.setAria(g, "");
      return g;
    }

    setAria(g, status) {
      const i = g.info;
      const parts = [i.node.label, i.typeLabel, i.lane ? i.lane.name : ""];
      if (status) parts.push(status);
      if (g.records) parts.push(g.records + (g.records === 1 ? " linked record" : " linked records"));
      if (i.node.removed) parts.push("removed in this draft");
      parts.push("Press Enter for details");
      g.setAttribute("aria-label", parts.filter(Boolean).join(". ") + ".");
    }

    buildGutter(model, lm) {
      clear(this.gutter);
      this.chips = model.lanes.map(lane => {
        const chip = h("div", { class: "lane-chip", title: lane.name + (lane.role ? ", " + lane.role : "") },
          icon(laneIcon(lane.type)),
          h("span", { class: "ln" }, h("span", { class: "ln-name" }, lane.name), lane.role ? h("span", { class: "ln-role" }, lane.role) : null));
        this.gutter.appendChild(chip);
        return chip;
      });
    }

    /** Applies replay state at time t. rp may be null (no scenario for this model). */
    applyReplay(rp, t, timeBasis) {
      this.nodeEls.forEach((g, id) => {
        const st = rp ? replayLib.nodeStateAt(rp, id, t) : null;
        const state = st ? st.state : "none";
        const sla = st && st.state === "active" && st.sla ? st.sla.state : "";
        const key = state + "|" + sla;
        if (g.stateKey !== key) {
          ["active", "done", "excluded", "unknown", "pending", "unscheduled", "none"].forEach(k => g.classList.toggle("st-" + k, k === state));
          g.classList.toggle("sla-breach", sla === "breach");
          g.classList.toggle("sla-warn", sla === "warn");
          g.stateKey = key;
        }
        const text = rp ? statusText(st, timeBasis) : "";
        if (text !== g.status) { g.status = text; this.setAria(g, text); }
        g.state = st;
      });
      this.edgeEls.forEach(item => {
        const state = rp ? replayLib.edgeStateAt(rp, item.edge, t) : "none";
        if (state === item.state) return;
        ["active", "traversed", "excluded", "pending", "idle", "none"].forEach(k => item.el.classList.toggle("st-" + k, k === state));
        const marker = state === "active" ? "active" : state === "traversed" ? "traversed" : "default";
        item.el.setAttribute("marker-end", "url(#" + this.markerId(marker) + ")");
        item.state = state;
      });
    }

    /** Duration badge per task: time spent in the step for the selected scenario. */
    setDurations(rp, timeBasis) {
      this.nodeEls.forEach((g, id) => {
        if (!g.badge) return;
        let text = "";
        if (rp) {
          const visits = rp.visitsByNode.get(id) || [];
          const total = visits.reduce((sum, v) => sum + (v.end - v.start), 0);
          if (visits.length) text = units.formatDuration(total, timeBasis) + (visits.length > 1 ? " \u00d7" + visits.length : "");
        }
        if (g.badge.fitData.value !== text) update(g.badge, text);
      });
    }

    setLens(lens) {
      this.nodeEls.forEach((g, id) => {
        const hit = lens && lens.nodes[id];
        if (g.lensBar) {
          const level = hit ? (hit.level || (hit.category && hit.category !== "none" ? 4 : 0)) : 0;
          g.lensTrack.setAttribute("visibility", level ? "visible" : "hidden");
          g.lensBar.setAttribute("visibility", level ? "visible" : "hidden");
          g.lensBar.setAttribute("width", String(168 * level / 4));
          g.lensBar.setAttribute("class", "lens-bar" + (hit && hit.category ? " cat cat-" + hit.category : ""));
          const text = hit ? hit.text || "" : "";
          if (g.lensText.fitData.value !== text) update(g.lensText, text);
          if (g.sub) g.sub.setAttribute("visibility", text ? "hidden" : "visible");
        }
        g.classList.toggle("lens-cat", !!(hit && hit.category));
        // One lens-<category> class at a time, whatever categories a lens uses.
        const cat = hit && hit.category ? "lens-" + String(hit.category).replace(/[^A-Za-z0-9_-]/g, "") : "";
        if (g.lensCatClass && g.lensCatClass !== cat) g.classList.remove(g.lensCatClass);
        if (cat) g.classList.add(cat);
        g.lensCatClass = cat;
      });
      this.edgeEls.forEach((item, id) => item.el.classList.toggle("lens-hit", !!(lens && lens.edges[id])));
    }

    setRecordCounts(counts) {
      this.nodeEls.forEach((g, id) => {
        const n = counts.get(id) || 0;
        g.records = n;
        g.recCount.setAttribute("visibility", n ? "visible" : "hidden");
        g.recCount.lastChild.textContent = n > 99 ? "99+" : String(n);
        this.setAria(g, g.status);
      });
    }

    setSelected(nodeId) {
      this.nodeEls.forEach((g, id) => g.classList.toggle("selected", id === nodeId));
    }

    setMatches(ids) {
      this.nodeEls.forEach((g, id) => g.classList.toggle("match", !!(ids && ids.has(id))));
    }

    applyTransform(zoom, panX, panY) {
      if (!this.content) return;
      this.content.setAttribute("transform", "translate(" + panX + "," + panY + ") scale(" + zoom + ")");
      const lm = this.lm;
      (this.chips || []).forEach((chip, i) => {
        const rowH = lm.laneHeight * zoom;
        const height = Math.min(40, Math.max(1, rowH - 4));
        chip.style.height = height + "px";
        chip.style.top = ((lm.laneTop + (i + 0.5) * lm.laneHeight) * zoom + panY - height / 2) + "px";
        const role = chip.querySelector(".ln-role");
        if (role) role.hidden = height < 30;
        chip.style.visibility = height < 12 ? "hidden" : "visible";
      });
    }

    size() { return { w: Math.max(1, this.view.clientWidth), h: Math.max(1, this.view.clientHeight) }; }
    world() { return { width: this.lm ? this.lm.width : 1, height: this.lm ? this.lm.height : 1 }; }
    nodeEl(id) { return this.nodeEls.get(id) || null; }
    nodePos(id) { return this.lm ? this.lm.pos.get(id) : null; }
  }

  /* ---------------- Shared camera ---------------- */

  const READABLE_MIN = 0.7, READABLE_MAX = 1.2;

  class Camera {
    constructor(onChange) {
      this.panes = [];
      this.zoom = 1; this.panX = 8; this.panY = 4; this.mode = "readable";
      this.onChange = onChange || (() => {});
    }

    setPanes(panes) { this.panes = panes.filter(Boolean); }

    fitScale() {
      if (!this.panes.length) return 1;
      return Math.max(0.01, Math.min(...this.panes.map(p => {
        const sz = p.size(), w = p.world();
        return Math.min((sz.w - 16) / w.width, (sz.h - 8) / w.height);
      })));
    }

    clamp() {
      if (!this.panes.length) return;
      const minX = Math.min(8, ...this.panes.map(p => p.size().w - p.world().width * this.zoom - 8));
      const minY = Math.min(4, ...this.panes.map(p => p.size().h - p.world().height * this.zoom - 4));
      this.panX = Math.max(minX, Math.min(8, this.panX));
      this.panY = Math.max(minY, Math.min(4, this.panY));
    }

    apply() {
      this.panes.forEach(p => p.applyTransform(this.zoom, this.panX, this.panY));
      this.onChange(this);
    }

    readable() {
      if (!this.panes.length) return;
      // Fit every lane when the labels stay legible; otherwise keep a legible
      // scale and let the canvas pan.
      const scale = Math.min(...this.panes.map(p => (p.size().h - 8) / p.world().height));
      this.zoom = Math.max(READABLE_MIN, Math.min(READABLE_MAX, scale));
      this.panX = 8; this.panY = 4; this.mode = "readable";
      this.clamp(); this.apply();
    }

    width() {
      if (!this.panes.length) return;
      const w = Math.min(...this.panes.map(p => (p.size().w - 16) / p.world().width));
      this.zoom = Math.max(0.05, Math.min(2.5, w));
      this.panX = 8; this.panY = 4; this.mode = "width";
      this.clamp(); this.apply();
    }

    overview() {
      this.zoom = this.fitScale(); this.panX = 8; this.panY = 4; this.mode = "overview";
      this.apply();
    }

    zoomBy(factor, cx, cy) {
      if (!this.panes.length) return;
      const sz = this.panes[0].size();
      const x = cx == null ? sz.w / 2 : cx, y = cy == null ? sz.h / 2 : cy;
      const wx = (x - this.panX) / this.zoom, wy = (y - this.panY) / this.zoom;
      const fit = this.fitScale();
      this.zoom = Math.max(Math.min(0.05, fit * 0.5), Math.min(Math.max(3, fit * 4), this.zoom * factor));
      this.panX = x - wx * this.zoom; this.panY = y - wy * this.zoom;
      this.mode = "manual"; this.clamp(); this.apply();
    }

    panBy(dx, dy) {
      this.panX += dx; this.panY += dy; this.mode = "manual";
      this.clamp(); this.apply();
    }

    /** Centers a node, zooming in to a readable scale if needed. */
    focusOn(pane, nodeId, minZoom) {
      const p = pane && pane.nodePos(nodeId);
      if (!p) return;
      const sz = pane.size();
      this.zoom = Math.max(this.zoom, minZoom || 0.9);
      this.panX = sz.w / 2 - p.x * this.zoom;
      this.panY = sz.h / 2 - p.y * this.zoom;
      this.mode = "manual"; this.clamp(); this.apply();
    }

    /** Pans just enough to bring a node into view (used when tabbing through steps). */
    ensureVisible(pane, nodeId) {
      const p = pane && pane.nodePos(nodeId);
      if (!p) return;
      const sz = pane.size(), m = 110 * this.zoom;
      const sx = p.x * this.zoom + this.panX, sy = p.y * this.zoom + this.panY;
      let dx = 0, dy = 0;
      if (sx - m < 0) dx = m - sx; else if (sx + m > sz.w) dx = sz.w - m - sx;
      if (sy - m * 0.5 < 0) dy = m * 0.5 - sy; else if (sy + m * 0.5 > sz.h) dy = sz.h - m * 0.5 - sy;
      if (dx || dy) this.panBy(dx, dy);
    }

    visibleRect(pane) {
      const sz = pane.size(), w = pane.world();
      const clampV = (v, max) => Math.max(0, Math.min(max, v));
      const left = clampV(-this.panX / this.zoom, w.width), top = clampV(-this.panY / this.zoom, w.height);
      return { left, top,
        right: Math.max(left, clampV((sz.w - this.panX) / this.zoom, w.width)),
        bottom: Math.max(top, clampV((sz.h - this.panY) / this.zoom, w.height)) };
    }

    /** Pointer, wheel and pinch handling for one pane. onTap(nodeId or null). */
    attach(pane, onTap) {
      const view = pane.view;
      const pointers = new Map();
      let gesture = null;
      const local = e => { const r = view.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      const begin = moved => {
        const pts = [...pointers.values()];
        if (!pts.length) { gesture = null; return; }
        if (pts.length === 1) gesture = { type: "pan", start: pts[0], panX: this.panX, panY: this.panY, moved };
        else {
          const [a, b] = pts, cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
          gesture = { type: "pinch", d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom: this.zoom,
            wx: (cx - this.panX) / this.zoom, wy: (cy - this.panY) / this.zoom, moved: true };
        }
      };
      view.addEventListener("pointerdown", e => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        const p = local(e);
        const nodeEl = e.target.closest && e.target.closest(".node");
        p.node = nodeEl ? nodeEl.nodeId : null;
        pointers.set(e.pointerId, p);
        view.setPointerCapture(e.pointerId);
        view.classList.add("dragging");
        begin(pointers.size > 1);
      });
      view.addEventListener("pointermove", e => {
        if (!pointers.has(e.pointerId) || !gesture) return;
        const old = pointers.get(e.pointerId);
        pointers.set(e.pointerId, Object.assign(local(e), { node: old.node }));
        const pts = [...pointers.values()];
        if (gesture.type === "pinch" && pts.length >= 2) {
          const [a, b] = pts, cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
          const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
          const fit = this.fitScale();
          this.zoom = Math.max(Math.min(0.05, fit * 0.5), Math.min(Math.max(3, fit * 4), gesture.zoom * d / gesture.d));
          this.panX = cx - gesture.wx * this.zoom; this.panY = cy - gesture.wy * this.zoom;
        } else {
          const p = pts[0], dx = p.x - gesture.start.x, dy = p.y - gesture.start.y;
          if (Math.hypot(dx, dy) > 4) gesture.moved = true;
          if (!gesture.moved) return;
          this.panX = gesture.panX + dx; this.panY = gesture.panY + dy;
        }
        this.mode = "manual"; this.clamp(); this.apply();
      });
      const finish = (e, cancelled) => {
        if (!pointers.has(e.pointerId)) return;
        const p = pointers.get(e.pointerId);
        const tap = !cancelled && pointers.size === 1 && gesture && gesture.type === "pan" && !gesture.moved;
        pointers.delete(e.pointerId);
        if (view.hasPointerCapture(e.pointerId)) view.releasePointerCapture(e.pointerId);
        if (!pointers.size) view.classList.remove("dragging");
        if (tap) onTap(p.node);
        begin(true);
      };
      view.addEventListener("pointerup", e => finish(e, false));
      view.addEventListener("pointercancel", e => finish(e, true));
      view.addEventListener("lostpointercapture", e => { if (pointers.has(e.pointerId)) finish(e, true); });
      view.addEventListener("wheel", e => {
        e.preventDefault();
        const p = local(e);
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? view.clientHeight : 1;
        const dx = e.deltaX * unit, dy = e.deltaY * unit;
        if (e.ctrlKey || e.metaKey) this.zoomBy(Math.exp(-Math.max(-100, Math.min(100, dy)) * 0.008), p.x, p.y);
        else this.panBy(-(e.shiftKey ? dy + dx : dx), e.shiftKey ? 0 : -dy);
      }, { passive: false });
      view.addEventListener("dblclick", e => {
        if (!(e.target.closest && e.target.closest(".node"))) { e.preventDefault(); this.overview(); }
      });
    }
  }

  /* ---------------- Navigator ---------------- */

  class Navigator {
    constructor(svg, camera) {
      this.svg = svg;
      this.camera = camera;
      this.rows = [];
      let grab = null;
      const point = e => {
        const m = svg.getScreenCTM();
        if (!m) return null;
        const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
        return pt.matrixTransform(m.inverse());
      };
      const go = e => {
        const pt = point(e);
        if (!pt || !this.rows.length) return;
        if (!grab) {
          const row = this.rows.find(r => pt.y <= r.y + r.height + 8) || this.rows[this.rows.length - 1];
          const v = camera.visibleRect(row.pane), x = (pt.x - 8) / this.scale, y = (pt.y - row.y) / this.scale;
          const inside = x >= v.left && x <= v.right && y >= v.top && y <= v.bottom;
          const sz = row.pane.size();
          grab = { row, ox: inside ? x + camera.panX / camera.zoom : sz.w / camera.zoom / 2,
            oy: inside ? y + camera.panY / camera.zoom : sz.h / camera.zoom / 2 };
        }
        const w = grab.row.pane.world();
        const x = Math.max(0, Math.min(w.width, (pt.x - 8) / this.scale));
        const y = Math.max(0, Math.min(w.height, (pt.y - grab.row.y) / this.scale));
        camera.panX = -(x - grab.ox) * camera.zoom; camera.panY = -(y - grab.oy) * camera.zoom;
        camera.mode = "manual"; camera.clamp(); camera.apply();
      };
      let pid = null;
      svg.addEventListener("pointerdown", e => { if (pid !== null) return; pid = e.pointerId; grab = null; svg.setPointerCapture(e.pointerId); go(e); });
      svg.addEventListener("pointermove", e => { if (e.pointerId === pid) go(e); });
      const end = e => { if (e.pointerId !== pid) return; pid = null; grab = null; };
      ["pointerup", "pointercancel", "lostpointercapture"].forEach(t => svg.addEventListener(t, end));
      svg.addEventListener("keydown", e => {
        const step = 60;
        const map = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
        if (map[e.key]) { e.preventDefault(); camera.panBy(...map[e.key]); }
      });
    }

    rebuild(panes) {
      const svg = this.svg;
      clear(svg);
      this.rows = [];
      if (!panes.length) return;
      const width = Math.max(...panes.map(p => p.world().width));
      this.scale = 234 / width;
      let y = 16;
      panes.forEach(pane => {
        const row = { pane, y, height: pane.world().height * this.scale };
        const label = s("text", { x: 8, y: y - 4, "font-size": 9, class: "mm-label" }, pane.model.name);
        const copy = pane.content.cloneNode(true);
        copy.removeAttribute("transform");
        copy.querySelectorAll("[tabindex]").forEach(n => { n.removeAttribute("tabindex"); n.removeAttribute("role"); n.removeAttribute("aria-label"); });
        copy.querySelectorAll("text, .glyph, .rec-count, .edge-tag").forEach(n => n.remove());
        const wrap = s("g", { transform: "translate(8," + y + ") scale(" + this.scale + ")", "aria-hidden": "true" }, copy);
        row.copy = copy;
        row.box = s("rect", { class: "mm-box", x: 8, y, width: 234, height: row.height });
        svg.append(label, wrap, row.box);
        this.rows.push(row);
        y += row.height + 18;
      });
      svg.setAttribute("viewBox", "0 0 250 " + (y - 10));
      const shown = svg.clientWidth || 250;
      svg.style.height = Math.max(48, Math.min(170, (y - 10) * shown / 250)) + "px";
      this.update();
    }

    /** Copies node and edge state classes from the panes. */
    syncStates() {
      this.rows.forEach(row => {
        const src = row.pane.content.querySelectorAll(".node, .edge");
        const dst = row.copy.querySelectorAll(".node, .edge");
        src.forEach((el, i) => { if (dst[i]) dst[i].setAttribute("class", el.getAttribute("class")); });
      });
    }

    update() {
      this.rows.forEach(row => {
        const v = this.camera.visibleRect(row.pane);
        row.box.setAttribute("x", 8 + v.left * this.scale);
        row.box.setAttribute("y", row.y + v.top * this.scale);
        row.box.setAttribute("width", Math.max(2, (v.right - v.left) * this.scale));
        row.box.setAttribute("height", Math.max(2, (v.bottom - v.top) * this.scale));
      });
    }
  }

  B.diagram = { Diagram, Camera, Navigator, statusText, laneIcon, STATE_TEXT };
})(typeof globalThis !== "undefined" ? globalThis : this);
