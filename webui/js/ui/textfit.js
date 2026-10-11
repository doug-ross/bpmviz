/*
 * Fits text into a box inside an SVG node: wraps to a line limit and picks
 * the largest font size that fits. Ported from the v2 renderer.
 */
(function (root) {
  "use strict";
  const B = root.AIxRay = root.AIxRay || {};
  const { s } = B.dom;
  const FONT = '"Ubuntu", system-ui, "Segoe UI", sans-serif';
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  function measure(text, size, weight) {
    ctx.font = (weight || 500) + " " + size + "px " + FONT;
    return ctx.measureText(String(text)).width;
  }

  function wrap(text, size, width, weight) {
    const words = String(text).trim().split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const word of words) {
      if (measure(word, size, weight) > width) return null;
      const candidate = line ? line + " " + word : word;
      if (measure(candidate, size, weight) <= width) line = candidate;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }

  function render(group) {
    const { value, box, opt } = group.fitData;
    while (group.firstChild) group.removeChild(group.firstChild);
    if (!value) return;
    const w = Math.max(1, box.w - 2), hgt = Math.max(1, box.h - 2);
    const attempt = size => {
      const lines = wrap(value, size, w, opt.weight);
      return lines && lines.length <= opt.lines && lines.length * size * 1.14 <= hgt ? lines : null;
    };
    let lo = 0.1, hi = opt.max;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (attempt(mid)) lo = mid; else hi = mid;
    }
    const size = Math.max(0.1, Math.floor(lo * 100) / 100);
    const lines = attempt(size) || [value];
    const inner = s("g");
    group.appendChild(inner);
    lines.forEach((line, i) => {
      inner.appendChild(s("text", {
        x: 0, y: (i - (lines.length - 1) / 2) * size * 1.14,
        "text-anchor": opt.anchor === "start" ? "start" : "middle", "dominant-baseline": "central",
        "font-size": size, "font-weight": opt.weight
      }, line));
    });
    let bb = null;
    try { bb = inner.getBBox(); } catch (_) { bb = null; }
    if (bb && bb.width > 0 && bb.height > 0 && opt.anchor !== "start") {
      const k = Math.min(1, w / bb.width, hgt / bb.height);
      inner.setAttribute("transform", "translate(" + (box.x + box.w / 2) + "," + (box.y + box.h / 2) + ") scale(" + k + ") " +
        "translate(" + (-bb.x - bb.width / 2) + "," + (-bb.y - bb.height / 2) + ")");
    } else if (opt.anchor === "start") {
      inner.setAttribute("transform", "translate(" + (box.x + 1) + "," + (box.y + box.h / 2) + ")");
    } else {
      inner.setAttribute("transform", "translate(" + (box.x + box.w / 2) + "," + (box.y + box.h / 2) + ")");
    }
  }

  /** Appends a fitted text group. options: { max, weight, lines, cls, anchor } */
  function fitted(parent, value, box, options) {
    const opt = Object.assign({ max: 16, weight: 500, lines: 1, cls: "", anchor: "middle" }, options || {});
    const group = s("g", { class: opt.cls });
    parent.appendChild(group);
    group.fitData = { value: String(value == null ? "" : value), box, opt };
    render(group);
    return group;
  }

  function update(group, value) {
    if (value !== undefined) group.fitData.value = String(value);
    render(group);
  }

  B.textfit = { fitted, update, measure, FONT };
})(typeof globalThis !== "undefined" ? globalThis : this);
