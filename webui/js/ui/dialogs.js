/*
 * Modal dialogs on the native <dialog> element: focus stays inside while it
 * is open, Escape closes it, and focus returns to whatever opened it.
 */
(function (root) {
  "use strict";
  const B = root.AIxRay = root.AIxRay || {};
  const { h, icon } = B.dom;

  /**
   * options: { title, eyebrow, body, actions: [{ label, variant, value, onClick, keepOpen }],
   *            wide, initialFocus (selector), onClose(value) }
   * Returns { dialog, close(value), body }.
   */
  function openDialog(options) {
    const opts = options || {};
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const titleId = "dlg-title-" + Math.random().toString(36).slice(2, 8);
    const body = h("div", { class: "dlg-body" }, opts.body || null);
    const closeBtn = h("button", { type: "button", class: "btn btn-icon btn-ghost", title: "Close" },
      icon("close"), h("span", { class: "sr-only" }, "Close"));
    const dialog = h("dialog", { class: "dlg" + (opts.wide ? " wide" : ""), "aria-labelledby": titleId },
      h("div", { class: "dlg-shell" },
        h("header", { class: "dlg-head" },
          h("div", { style: { flex: "1", minWidth: "0" } },
            opts.eyebrow ? h("span", { class: "eyebrow" }, opts.eyebrow) : null,
            h("h2", { id: titleId }, opts.title || "")),
          closeBtn),
        body,
        opts.actions && opts.actions.length ? h("footer", { class: "dlg-foot" }) : null));
    let result;
    const foot = dialog.querySelector(".dlg-foot");
    const api = {
      dialog, body,
      close(value) { result = value; if (dialog.open) dialog.close(); }
    };
    (opts.actions || []).forEach(action => {
      const btn = h("button", { type: "button", class: "btn " + (action.variant || "") }, action.label);
      btn.addEventListener("click", () => {
        let keep = action.keepOpen;
        if (action.onClick) {
          const r = action.onClick(api);
          if (r === false) keep = true;
        }
        if (!keep) api.close(action.value);
      });
      if (action.autofocus) btn.setAttribute("autofocus", "");
      foot.appendChild(btn);
    });
    closeBtn.addEventListener("click", () => api.close(undefined));
    dialog.addEventListener("close", () => {
      dialog.remove();
      if (returnTo && document.contains(returnTo)) returnTo.focus();
      if (opts.onClose) opts.onClose(result);
    });
    document.body.appendChild(dialog);
    dialog.showModal();
    const first = opts.initialFocus ? dialog.querySelector(opts.initialFocus) :
      dialog.querySelector("[autofocus]") || body.querySelector("input, select, textarea, button, a[href]");
    if (first) first.focus();
    return api;
  }

  /** Resolves with the chosen action's value, or undefined when dismissed. */
  function choose(options) {
    return new Promise(resolve => {
      openDialog(Object.assign({}, options, { onClose: resolve }));
    });
  }

  function confirmDialog(title, message, confirmLabel, danger) {
    return choose({
      title,
      body: typeof message === "string" ? h("p", null, message) : message,
      actions: [
        { label: "Cancel", value: false },
        { label: confirmLabel || "Continue", value: true, variant: danger ? "btn-danger" : "btn-primary", autofocus: true }
      ]
    }).then(v => v === true);
  }

  function messageDialog(title, message) {
    return choose({
      title,
      body: typeof message === "string" ? h("p", null, message) : message,
      actions: [{ label: "Close", value: true, variant: "btn-primary", autofocus: true }]
    });
  }

  /** Lists validation errors and warnings with their field paths. */
  function issueList(items, limit) {
    const max = limit || 50;
    return h("ul", { class: "issue-list" }, items.slice(0, max).map(item =>
      h("li", null, item.message, item.path ? [" ", h("code", null, item.path)] : null)),
      items.length > max ? h("li", { class: "muted" }, (items.length - max) + " more not shown.") : null);
  }

  B.dialogs = { openDialog, choose, confirmDialog, messageDialog, issueList };
})(typeof globalThis !== "undefined" ? globalThis : this);
