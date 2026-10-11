/*
 * Safe DOM construction. Text always goes in through textContent or text
 * nodes; nothing in the app assigns engagement data to innerHTML.
 */
(function (root) {
  "use strict";
  const B = root.AIxRay = root.AIxRay || {};
  const SVG_NS = "http://www.w3.org/2000/svg";

  function append(el, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(c => append(el, c)); return; }
    el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  function setAttrs(el, attrs, isSvg) {
    Object.keys(attrs || {}).forEach(key => {
      const value = attrs[key];
      if (value === null || value === undefined || value === false) return;
      if (key === "class") el.setAttribute("class", Array.isArray(value) ? value.filter(Boolean).join(" ") : value);
      else if (key === "text") el.textContent = String(value);
      else if (key === "on") Object.keys(value).forEach(ev => el.addEventListener(ev, value[ev]));
      else if (key === "dataset") Object.keys(value).forEach(k => { el.dataset[k] = value[k]; });
      else if (key === "style") Object.keys(value).forEach(k => { el.style[k] = value[k]; });
      else if (key === "props") Object.keys(value).forEach(k => { el[k] = value[k]; });
      else if (value === true) el.setAttribute(key, "");
      else el.setAttribute(key, String(value));
    });
    return el;
  }

  /** h("button", { class: "btn", on: { click } }, "Label", child, [more]) */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    setAttrs(el, attrs, false);
    append(el, children);
    return el;
  }

  function s(tag, attrs, ...children) {
    const el = document.createElementNS(SVG_NS, tag);
    setAttrs(el, attrs, true);
    append(el, children);
    return el;
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  function $(selector, scope) { return (scope || document).querySelector(selector); }
  function $$(selector, scope) { return Array.from((scope || document).querySelectorAll(selector)); }

  let announcer = null;
  /** Polite screen-reader announcement. */
  function announce(message) {
    if (!announcer) announcer = document.getElementById("announcer");
    if (!announcer) return;
    announcer.textContent = "";
    setTimeout(() => { announcer.textContent = message; }, 30);
  }

  /* Icon set: 24px grid, 2px stroke, round joins (Lucide-style shapes, drawn here). */
  const ICONS = {
    play: [["path", { d: "M7 4.5v15l12-7.5z", fill: "currentColor", stroke: "none" }]],
    pause: [["rect", { x: 6, y: 4.5, width: 4, height: 15, rx: 1, fill: "currentColor", stroke: "none" }], ["rect", { x: 14, y: 4.5, width: 4, height: 15, rx: 1, fill: "currentColor", stroke: "none" }]],
    rewind: [["path", { d: "M19 20 9 12l10-8z" }], ["path", { d: "M5 19V5" }]],
    end: [["path", { d: "m5 4 10 8-10 8z" }], ["path", { d: "M19 5v14" }]],
    zoomIn: [["circle", { cx: 11, cy: 11, r: 7.5 }], ["path", { d: "m21 21-4.6-4.6M11 8v6M8 11h6" }]],
    zoomOut: [["circle", { cx: 11, cy: 11, r: 7.5 }], ["path", { d: "m21 21-4.6-4.6M8 11h6" }]],
    overview: [["path", { d: "M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" }]],
    focus: [["circle", { cx: 12, cy: 12, r: 8 }], ["circle", { cx: 12, cy: 12, r: 2.5 }], ["path", { d: "M12 2v3M12 19v3M2 12h3M19 12h3" }]],
    search: [["circle", { cx: 11, cy: 11, r: 7.5 }], ["path", { d: "m21 21-4.6-4.6" }]],
    save: [["path", { d: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" }], ["path", { d: "M17 21v-8H7v8M7 3v5h8" }]],
    open: [["path", { d: "M6 14l1.5-2.9A2 2 0 0 1 9.2 10H20a2 2 0 0 1 1.9 2.5l-1.5 6a2 2 0 0 1-2 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.7.9l.8 1.2a2 2 0 0 0 1.7.9H18a2 2 0 0 1 2 2v2" }]],
    filePlus: [["path", { d: "M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z" }], ["path", { d: "M14 2v6h6M12 18v-6M9 15h6" }]],
    download: [["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" }]],
    printer: [["path", { d: "M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" }], ["rect", { x: 6, y: 14, width: 12, height: 8 }]],
    close: [["path", { d: "M18 6 6 18M6 6l12 12" }]],
    plus: [["path", { d: "M12 5v14M5 12h14" }]],
    more: [["circle", { cx: 5, cy: 12, r: 1.2, fill: "currentColor" }], ["circle", { cx: 12, cy: 12, r: 1.2, fill: "currentColor" }], ["circle", { cx: 19, cy: 12, r: 1.2, fill: "currentColor" }]],
    help: [["circle", { cx: 12, cy: 12, r: 9.5 }], ["path", { d: "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" }]],
    compare: [["rect", { x: 3, y: 3, width: 18, height: 18, rx: 2 }], ["path", { d: "M3 12h18" }]],
    panel: [["rect", { x: 3, y: 3, width: 18, height: 18, rx: 2 }], ["path", { d: "M15 3v18" }]],
    edit: [["path", { d: "M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" }]],
    trash: [["path", { d: "M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" }]],
    alert: [["path", { d: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" }]],
    check: [["path", { d: "M20 6 9 17l-5-5" }]],
    info: [["circle", { cx: 12, cy: 12, r: 9.5 }], ["path", { d: "M12 16v-4M12 8h.01" }]],
    map: [["path", { d: "M1 6v16l7-4 8 4 7-4V2l-7 4-8-4zM8 2v16M16 6v16" }]],
    person: [["path", { d: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" }], ["circle", { cx: 12, cy: 7, r: 4 }]],
    agent: [["rect", { x: 3, y: 10, width: 18, height: 11, rx: 2 }], ["circle", { cx: 12, cy: 5, r: 2 }], ["path", { d: "M12 7v3M8 15h.01M16 15h.01" }]],
    external: [["rect", { x: 4, y: 2, width: 16, height: 20, rx: 2 }], ["path", { d: "M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01" }]],
    undo: [["path", { d: "M3 7v6h6" }], ["path", { d: "M21 17a9 9 0 0 0-15-6.7L3 13" }]],
    records: [["path", { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" }]],
    clone: [["rect", { x: 9, y: 9, width: 13, height: 13, rx: 2 }], ["path", { d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" }]],
    image: [["rect", { x: 3, y: 3, width: 18, height: 18, rx: 2 }], ["circle", { cx: 8.5, cy: 8.5, r: 1.5 }], ["path", { d: "m21 15-5-5L5 21" }]],
    fullscreen: [["path", { d: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" }]],
    moon: [["path", { d: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" }]],
    settings: [["circle", { cx: 12, cy: 12, r: 3 }], ["path", { d: "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" }]],
    list: [["path", { d: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" }]],
    upload: [["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" }]]
  };

  function icon(name, attrs) {
    const def = ICONS[name] || ICONS.info;
    const el = s("svg", Object.assign({
      viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2,
      "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false"
    }, attrs || {}));
    def.forEach(([tag, a]) => el.appendChild(s(tag, a)));
    return el;
  }

  /** Button with an icon and a visible or screen-reader label. */
  function iconButton(name, label, attrs, options) {
    const opts = options || {};
    const btn = h("button", Object.assign({ type: "button", class: "btn " + (opts.showLabel ? "" : "btn-icon ") + (opts.variant || ""), title: opts.title || label, "aria-label": opts.showLabel ? label : null }, attrs || {}),
      icon(name), opts.showLabel ? h("span", { class: "label" }, label) : h("span", { class: "sr-only" }, label));
    return btn;
  }

  function formatTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }) + ", " + formatTime(iso);
  }

  /** Triggers a file download for a Blob. */
  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: fileName });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function isTypingTarget(target) {
    return target instanceof Element && !!target.closest("input, select, textarea, [contenteditable='true']");
  }

  B.dom = { h, s, clear, $, $$, announce, icon, iconButton, formatTime, formatDate, downloadBlob, isTypingTarget, SVG_NS };
})(typeof globalThis !== "undefined" ? globalThis : this);
