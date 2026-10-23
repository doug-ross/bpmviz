/*
 * The guided tour: a card that walks a first-time user, or a demo, through
 * the real app one step at a time, with a ring around the control to use.
 * The steps are in ui/tour-flows.js. The person can click the ringed control
 * or choose Next, which does it for them.
 *
 * Start it with Take a tour (start screen or More actions), from the offer
 * shown once on a first visit, or with index.htm#tour=analyze or
 * #tour=screen for a demo.
 *
 * Modal dialogs make everything outside them inert, so the tour's layer
 * moves into the topmost open dialog while one is open.
 */
(function (root) {
  "use strict";
  const B = root.AIxRay = root.AIxRay || {};
  const { h, icon, announce } = B.dom;

  const PREF_OFFERED = "tour.offered";
  const MISSING_AFTER_MS = 8000;
  const ALIASES = { a: "analyze", b: "screen" };
  /* Read before the app rewrites the address for its own state. */
  const HASH_FLOW = (() => {
    const m = /(?:^|[#&])tour=([a-z]+)/.exec(String(location.hash || ""));
    return m ? (ALIASES[m[1]] || m[1]) : "";
  })();

  let run = null;
  let suppress = false;

  const pause = ms => new Promise(r => setTimeout(r, ms));
  const flows = () => B.tourFlows || [];
  const flowOf = id => flows().find(f => f.id === (ALIASES[id] || id)) || null;
  const ctx = () => ({ app: B.app });
  const current = () => (run ? run.flow.steps[run.index] : null);
  const safe = (fn, fallback) => { try { return fn(); } catch (_) { return fallback; } };

  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /* The element a step points at, or null when it is not on screen. */
  function resolve(step) {
    if (!step || !step.target) return null;
    const el = safe(() => (typeof step.target === "function" ? step.target() : document.querySelector(step.target)), null);
    return el && el.isConnected && visible(el) ? el : null;
  }

  /* The topmost open modal dialog, which is the only place a click can land while it is open. */
  function host() {
    const open = [...document.querySelectorAll("dialog[open]")];
    return open.length ? open[open.length - 1] : document.body;
  }

  /* Body text marks commands with backticks; they show as code, everything else as text. */
  function rich(el, text) {
    el.textContent = "";
    String(text || "").split("`").forEach((part, i) => {
      if (!part) return;
      el.appendChild(i % 2 ? h("code", null, part) : document.createTextNode(part));
    });
  }

  /* ---------- The layer: ring and card ---------- */

  function buildLayer() {
    const btn = (id, label, cls, onClick) => h("button", { type: "button", class: "btn " + (cls || ""), id, on: { click: onClick } }, label);
    const ui = {
      ring: h("div", { class: "tour-ring", id: "tour-ring", hidden: true, "aria-hidden": "true" }),
      count: h("span", { class: "tour-count", id: "tour-count" }),
      title: h("h2", { class: "tour-title", id: "tour-title", tabindex: "-1" }),
      body: h("p", { class: "tour-body", id: "tour-body" }),
      action: h("p", { class: "tour-do", id: "tour-do" }),
      status: h("p", { class: "tour-status", id: "tour-status", role: "status" }),
      back: btn("tour-back", "Back", "", () => back()),
      retry: btn("tour-retry", "Try again", "", () => show(run.index, 0)),
      other: btn("tour-other", "", "", () => { const o = flows().find(f => f !== run.flow); if (o) start(o.id); }),
      next: btn("tour-next", "Next", "btn-primary", () => next()),
      end: h("button", { type: "button", class: "btn btn-ghost btn-icon", id: "tour-end", title: "End the tour", on: { click: () => end(true) } },
        icon("close"), h("span", { class: "sr-only" }, "End the tour"))
    };
    ui.card = h("section", { class: "tour-card", id: "tour-card", role: "dialog", "aria-modal": "false", "aria-labelledby": "tour-title" },
      h("div", { class: "tour-head" }, h("span", { class: "tour-name", id: "tour-name" }), ui.end),
      ui.count, ui.title, ui.body, ui.action, ui.status,
      h("div", { class: "tour-nav" }, ui.back, ui.retry, ui.other, ui.next));
    ui.layer = h("div", { class: "tour-layer", id: "tour-layer" }, ui.ring, ui.card);
    ui.card.addEventListener("keydown", ev => {
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); end(true); }
      else if (ev.key === "ArrowRight" && !ev.target.closest("input, textarea, select")) { ev.preventDefault(); next(); }
      else if (ev.key === "ArrowLeft" && !ev.target.closest("input, textarea, select")) { ev.preventDefault(); back(); }
    });
    return ui;
  }

  /* A dialog the step did not expect, such as "Save your changes first?", waits for the person. */
  const asking = () => [...document.querySelectorAll("dialog[open]")].some(d => d.id !== "screening-dialog" && !resolve(current()));

  /*
   * Puts the card beside the target where it fits: below, right, above, left,
   * or else a corner. With no target it sits in the middle, or in the
   * bottom-left corner while the app is asking the person something.
   */
  function place(el) {
    const ui = run.ui, card = ui.card, m = 16, gap = 14;
    const vw = window.innerWidth, vh = window.innerHeight, cw = card.offsetWidth, ch = card.offsetHeight;
    const clampX = x => Math.max(m, Math.min(x, vw - cw - m));
    const clampY = y => Math.max(m, Math.min(y, vh - ch - m));
    let x, y;
    if (!el) {
      ui.ring.hidden = true;
      if (run.status !== "shown" && asking()) { x = m; y = vh - ch - m; }
      else { x = (vw - cw) / 2; y = Math.max(m, (vh - ch) / 3); }
    } else {
      const r = el.getBoundingClientRect(), pad = 6;
      ui.ring.hidden = false;
      Object.assign(ui.ring.style, { left: (r.left - pad) + "px", top: (r.top - pad) + "px", width: (r.width + pad * 2) + "px", height: (r.height + pad * 2) + "px" });
      const options = [
        () => (r.bottom + gap + ch <= vh - m ? [clampX(r.left), r.bottom + gap] : null),
        () => (r.right + gap + cw <= vw - m ? [r.right + gap, clampY(r.top)] : null),
        () => (r.top - gap - ch >= m ? [clampX(r.left), r.top - gap - ch] : null),
        () => (r.left - gap - cw >= m ? [r.left - gap - cw, clampY(r.top)] : null)
      ];
      const spot = options.map(f => f()).find(Boolean) || [vw - cw - m, vh - ch - m];
      x = spot[0]; y = spot[1];
    }
    card.style.left = Math.round(x) + "px";
    card.style.top = Math.round(y) + "px";
  }

  /* Every frame: keep the layer where clicks can reach it, follow the target, and move on when a step is done. */
  function frame() {
    if (!run) return;
    const ui = run.ui, where = host();
    if (ui.layer.parentNode !== where) where.appendChild(ui.layer);
    ui.layer.classList.toggle("in-dialog", where !== document.body);
    const step = current();
    const el = run.status === "shown" || run.status === "missing" || run.status === "waiting" ? resolve(step) : null;
    if (el && run.status !== "shown") setShown();
    place(run.status === "shown" && step.target ? el : null);
    if (run.status === "shown" && step.done && !run.busy) {
      const done = safe(() => step.done(ctx()), false);
      if (!done) run.armed = true;
      else if (run.armed) { run.armed = false; advance(run.token); }
    }
    run.raf = requestAnimationFrame(frame);
  }

  function setStatus(text) {
    run.ui.status.textContent = text || "";
    run.ui.status.hidden = !text;
  }

  function setShown() {
    run.status = "shown";
    run.ui.retry.hidden = true;
    setStatus("");
  }

  /* ---------- Moving through the steps ---------- */

  function render(step) {
    const ui = run.ui, steps = run.flow.steps, last = run.index === steps.length - 1;
    ui.card.querySelector("#tour-name").textContent = run.flow.title;
    ui.count.textContent = "Step " + (run.index + 1) + " of " + steps.length;
    ui.title.textContent = step.title;
    rich(ui.body, last && run.flow.end ? step.body + " " + run.flow.end : step.body);
    ui.action.textContent = "";
    if (step.action) ui.action.append(h("strong", null, "Click "), step.action, h("span", { class: "tour-or" }, ", or choose Next."));
    ui.action.hidden = !step.action;
    ui.back.disabled = run.index === 0;
    ui.next.textContent = last ? "Finish" : "Next";
    const other = flows().find(f => f !== run.flow);
    ui.other.hidden = !last || !other;
    if (other) ui.other.textContent = "Take the other tour";
  }

  /* Shows the step at index, running its preparation and waiting for its target. */
  async function show(index, direction) {
    if (!run) return;
    const steps = run.flow.steps;
    let i = Math.max(0, Math.min(index, steps.length - 1));
    while (direction && steps[i] && steps[i].skipIf && safe(() => steps[i].skipIf(ctx()), false) && i + direction >= 0 && i + direction < steps.length) i += direction;
    const token = ++run.token;
    run.index = i;
    run.armed = false;
    run.status = "preparing";
    const step = steps[i];
    render(step);
    run.ui.ring.hidden = true;
    run.ui.retry.hidden = true;
    setStatus("Getting the screen ready.");
    run.busy = true;
    try {
      if (step.prepare) await step.prepare(ctx());
    } catch (err) {
      setStatus("The tour could not set up this step: " + ((err && err.message) || err) + ". Choose Try again, Back, or End the tour.");
    } finally { if (run && token === run.token) run.busy = false; }
    if (!run || token !== run.token) return;
    run.ui.title.focus({ preventScroll: true });
    announce(run.flow.title + ". Step " + (i + 1) + ": " + step.title);
    if (!step.target) { setShown(); return; }
    const started = Date.now();
    run.status = "waiting";
    while (run && token === run.token && run.status !== "shown") {
      const el = resolve(step);
      if (el) {
        if (!(el instanceof SVGElement)) safe(() => el.scrollIntoView({ block: "nearest", inline: "nearest" }));
        setShown();
        break;
      }
      if (asking()) {
        run.status = "waiting";
        run.ui.retry.hidden = true;
        setStatus("Answer the question on screen to carry on.");
      } else if (Date.now() - started > MISSING_AFTER_MS) {
        run.status = "missing";
        run.ui.retry.hidden = false;
        setStatus("This part of the screen is not showing. Choose Try again, Back, or End the tour.");
      }
      await pause(120);
    }
  }

  function go(index, direction) {
    if (!run) return;
    if (index >= run.flow.steps.length) { end(true); return; }
    show(index, direction);
  }

  /* Moves on from the step that token belongs to; a second signal for the same step is ignored. */
  function advance(token) {
    if (run && run.token === token) go(run.index + 1, 1);
  }

  async function next() {
    if (!run || run.busy) return;
    const step = current();
    if (run.index === run.flow.steps.length - 1) { end(true); return; }
    run.busy = true;
    const token = run.token;
    try {
      if (step.next) {
        if (await step.next(ctx()) === false) { run.busy = false; return; }
      } else if (step.click) {
        const el = resolve(step);
        if (el) {
          suppress = true;
          try { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window })); } finally { suppress = false; }
        }
      }
    } catch (err) {
      setStatus("That did not work: " + ((err && err.message) || err) + ".");
    }
    if (!run || token !== run.token) return;
    run.busy = false;
    await pause(80);
    if (run && token === run.token) show(run.index + 1, 1);
  }

  function back() {
    if (!run || run.index === 0) return;
    show(run.index - 1, -1);
  }

  /* A click on the ringed control counts as doing the step. The app handles the click first. */
  document.addEventListener("click", ev => {
    if (!run || suppress || run.busy || run.status !== "shown") return;
    const step = current();
    if (!step.click) return;
    const el = resolve(step);
    if (!el || !(el === ev.target || el.contains(ev.target))) return;
    const token = run.token;
    setTimeout(() => advance(token), 0);
  }, true);

  /* ---------- Starting and ending ---------- */

  function rememberOffered() {
    const app = B.app;
    if (app && app.drafts) app.drafts.setPref(PREF_OFFERED, "1");
  }

  function end(say) {
    removeOffer();
    if (!run) return;
    cancelAnimationFrame(run.raf);
    run.ui.layer.remove();
    const title = run.flow.title;
    run = null;
    if (say) announce("Tour ended: " + title + ".");
  }

  /** Starts a tour by id (analyze or screen, or a and b). Resolves true when it started. */
  async function start(id) {
    const flow = flowOf(id);
    if (!flow) return false;
    end(false);
    rememberOffered();
    run = { flow, index: 0, token: 0, status: "preparing", busy: false, armed: false, ui: buildLayer() };
    host().appendChild(run.ui.layer);
    run.raf = requestAnimationFrame(frame);
    await show(0, 1);
    return true;
  }

  /* Take a tour: choose one of the two. */
  function chooser() {
    let picked = null;
    const option = f => h("button", { type: "button", class: "tour-option", id: "tour-choose-" + f.id, on: { click: () => { picked = f.id; dlg.close(); } } },
      h("strong", null, f.title), h("span", null, f.summary), h("span", { class: "tour-option-meta" }, f.steps.length + " steps"));
    const dlg = B.dialogs.openDialog({
      title: "Take a tour", eyebrow: "Guided tour",
      body: h("div", { class: "form-grid" },
        h("p", { class: "small" }, "Each tour runs in the app on a bundled example, so your own project and files stay as they are. Click the ringed control at each step, or choose Next."),
        h("div", { class: "tour-options" }, flows().map(option))),
      actions: [{ label: "Not now" }],
      onClose: () => { rememberOffered(); if (picked) start(picked); }
    });
    dlg.dialog.id = "tour-chooser";
    return dlg;
  }

  /* ---------- The offer on a first visit ---------- */

  function removeOffer() {
    const o = document.getElementById("tour-offer");
    if (o) o.remove();
  }

  function offer() {
    if (document.getElementById("tour-offer")) return;
    rememberOffered();
    const pick = id => () => { removeOffer(); start(id); };
    const card = h("section", { class: "tour-offer", id: "tour-offer", "aria-labelledby": "tour-offer-title" },
      h("h2", { id: "tour-offer-title" }, "New to AIxRay?"),
      h("p", null, "Take a short guided tour on the bundled examples. Your own files are not touched."),
      h("div", { class: "tour-offer-actions" },
        flows().map(f => h("button", { type: "button", class: "btn", id: "tour-offer-" + f.id, on: { click: pick(f.id) } }, f.title)),
        h("button", { type: "button", class: "btn btn-ghost", id: "tour-offer-dismiss", on: { click: removeOffer } }, "Not now")));
    document.body.appendChild(card);
  }

  /*
   * Once the app has started: run the tour the address asks for, or offer
   * one on a first visit. Automated browsers are not offered one, so test
   * and screenshot runs see the app as it is.
   */
  async function afterBoot() {
    for (let i = 0; i < 150; i++) {
      const app = B.app;
      if (app && (app.store || document.querySelector(".start-actions"))) break;
      await pause(100);
    }
    const app = B.app;
    if (!app) return;
    if (HASH_FLOW && flowOf(HASH_FLOW)) { start(HASH_FLOW); return; }
    const firstVisit = app.drafts && app.drafts.available() && !app.drafts.getPref(PREF_OFFERED);
    if (firstVisit && !navigator.webdriver && app.workspace === "start" && !app.store) offer();
  }

  B.ext.registerStartAction({ id: "tour", order: 1, icon: "help", label: "Take a tour", run: () => chooser() });
  B.ext.registerMenuItem({ id: "tour", order: 1, icon: "help", label: "Take a tour", group: "import", run: () => chooser() });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", afterBoot);
  else afterBoot();

  B.tour = {
    start, end, chooser, offer,
    state: () => (run ? { flow: run.flow.id, index: run.index, count: run.flow.steps.length, status: run.status, title: current().title } : null)
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
