/*
 * Process screening: score candidate processes against weighted criteria and
 * see which one to start with (see docs/screening.md). The screening is its
 * own file, so it opens in its own window over whatever project is open and
 * never changes that project. Logic lives in lib/screening.js.
 */
(function (root) {
  "use strict";
  const B = root.AIxRay = root.AIxRay || {};
  const { h, s, clear, icon, announce, downloadBlob, isTypingTarget } = B.dom;
  const { openDialog, confirmDialog, messageDialog, issueList } = B.dialogs;
  const S = B.screening, schema = B.schema, units = B.units, util = B.util;

  const TABS = [["candidates", "Candidates"], ["criteria", "Criteria"], ["ranking", "Ranking"], ["summary", "Summary"]];
  const HISTORY = 50;
  const GROUP_LABEL = Object.fromEntries(S.GROUPS);

  /* One screening per browser tab. It stays here when the window closes, until the page reloads. */
  let state = null;
  let view = null;
  let appRef = null;

  function fresh(screening, info) {
    const i = info || {};
    return { screening, past: [], savedRevision: screening.revision, fileName: i.fileName || null, fileHandle: null,
      tab: "candidates", includeSensitive: false, status: "" };
  }
  const dirty = () => !!state && state.screening.revision !== state.savedRevision;
  const ctxOf = sc => ({ currency: sc.meta.currency });
  const fmt = (value, unit, sc) => units.formatMeasure(value, unit, ctxOf(sc));
  const basisLabel = b => schema.label("assumptionStatus", b);
  const muted = textValue => h("span", { class: "muted" }, textValue);
  const whole = v => util.formatNumber(v, 0);

  root.addEventListener("beforeunload", ev => { if (dirty()) { ev.preventDefault(); ev.returnValue = ""; } });

  /* ---------- Changes and history ---------- */

  /*
   * Keeps the change and redraws. A quiet change redraws only the toolbar and
   * the status line, so typing from one field to the next keeps its place.
   */
  function commit(result, message, quiet) {
    state.past.push(state.screening);
    if (state.past.length > HISTORY) state.past.shift();
    state.screening = result.screening;
    state.status = message || "";
    if (message) announce(message);
    if (quiet) renderQuiet(); else render();
    return result;
  }

  /**
   * Runs a change; a ScreeningError becomes a message instead of an
   * exception. message is a string or a function of the change's result.
   */
  function attempt(fn, message, quiet) {
    try {
      const result = fn(state.screening);
      return commit(result, typeof message === "function" ? message(result) : message, quiet);
    } catch (err) {
      if (!(err instanceof S.ScreeningError)) throw err;
      messageDialog("Not changed", err.message);
      render();
      return null;
    }
  }

  function undo() {
    if (!state.past.length) return;
    state.screening = state.past.pop();
    state.status = "Undone.";
    announce("Undone.");
    render();
  }

  /* ---------- Files ---------- */

  async function readText(file) {
    if (file.size > schema.LIMITS.fileBytes) throw new Error(file.name + " is larger than " + Math.round(schema.LIMITS.fileBytes / 1048576) + " MB.");
    return file.text();
  }

  async function save() {
    const sc = state.screening;
    const textValue = JSON.stringify(sc, null, 2) + "\n";
    const suggested = state.fileName || util.slug(sc.meta.title, 60) + ".screening.json";
    let savedName = suggested;
    if (typeof root.showSaveFilePicker === "function") {
      try {
        const handle = state.fileHandle || await root.showSaveFilePicker({
          suggestedName: suggested, types: [{ description: "AIxRay screening", accept: { "application/json": [".json"] } }]
        });
        const writable = await handle.createWritable();
        await writable.write(textValue);
        await writable.close();
        state.fileHandle = handle;
        savedName = handle.name;
      } catch (err) {
        if (err && err.name === "AbortError") return false;
        downloadBlob(new Blob([textValue], { type: "application/json" }), suggested);
      }
    } else {
      downloadBlob(new Blob([textValue], { type: "application/json" }), suggested);
    }
    state.fileName = savedName;
    state.savedRevision = sc.revision;
    state.status = "Saved " + savedName + ".";
    announce(state.status);
    render();
    return true;
  }

  async function replaceWith(screening, info) {
    if (dirty() && !await confirmDialog("Replace this screening?", "The open screening has changes that are not saved. Save it first to keep them.", "Replace", true)) return false;
    state = fresh(screening, info);
    render();
    return true;
  }

  /* The bundled example: three of the bundled processes and one typed in, all illustrative. */
  async function openExample() {
    const result = S.parseScreening(B.bundledScreening.screening);
    if (!result.ok) { messageDialog("Example not opened", result.errors[0]); return; }
    if (!await replaceWith(result.screening, {})) return;
    state.status = "Opened the example screening. Every score and figure in it is illustrative.";
    announce(state.status);
    render();
  }

  async function openScreeningFile() {
    const file = await B.files.pickFile(".json,application/json");
    if (!file) return;
    let result;
    try { result = S.parseScreening(await readText(file)); } catch (err) { messageDialog("File not opened", err.message); return; }
    if (!result.ok) { messageDialog("This file didn't open", h("div", null, h("p", null, file.name + " is not a screening AIxRay can open."), issueList(result.errors.map(message => ({ message }))))); return; }
    if (await replaceWith(result.screening, { fileName: file.name })) showWarnings(file.name, result.warnings);
  }

  function showWarnings(fileName, warnings) {
    if (!warnings.length) return;
    messageDialog("Opened, with a few things to check", h("div", null,
      h("p", null, "AIxRay left out " + warnings.length + " thing" + (warnings.length === 1 ? "" : "s") + " while opening " + fileName + "."),
      issueList(warnings)));
  }

  function addEngagement(engagement, fileName) {
    const name = (engagement.meta && engagement.meta.processName) || "the project";
    attempt(sc => S.addFromEngagement(sc, engagement, { fileName }), r => (r.refreshed ? "Updated the figures for " : "Added ") + name + ".");
  }

  async function addFromProjectFile() {
    const file = await B.files.pickFile(".json,application/json");
    if (!file) return;
    let result;
    try { result = B.validate.parseEngagementText(await readText(file)); } catch (err) { messageDialog("File not opened", err.message); return; }
    if (!result.ok) { messageDialog("This project didn't open", h("div", null, h("p", null, file.name + " has " + result.errors.length + " problem" + (result.errors.length === 1 ? "" : "s") + "."), issueList(result.errors))); return; }
    addEngagement(result.engagement, file.name);
  }

  /* ---------- Small controls ---------- */

  function field(label, control, hint) {
    const id = control.id || "scr-f-" + Math.random().toString(36).slice(2, 8);
    control.id = id;
    return h("div", { class: "field" }, h("label", { for: id }, label), control, hint ? h("span", { class: "field-hint" }, hint) : null);
  }

  function enumSelect(name, value, attrs, extra) {
    return h("select", Object.assign({ class: "select" }, attrs || {}),
      (extra || []).map(([v, l]) => h("option", { value: v, selected: v === value }, l)),
      schema.ENUMS[name].map(v => h("option", { value: v, selected: v === value }, schema.label(name, v))));
  }

  function basisSelect(value, attrs) {
    return enumSelect("assumptionStatus", value || "illustrative", attrs);
  }

  function scoreSelect(value, attrs) {
    return h("select", Object.assign({ class: "select" }, attrs || {}),
      h("option", { value: "", selected: value === null || value === undefined }, ""),
      [1, 2, 3, 4, 5].map(v => h("option", { value: String(v), selected: v === value }, String(v))));
  }

  /* A typed number, null for blank, or NaN for something that is not a number. */
  function numberOf(input) {
    const raw = input.value.trim();
    return raw === "" ? null : Number(raw);
  }

  function factEditor(prefix, fact, def, hint) {
    const value = h("input", { class: "input", type: "number", min: "0", step: "any", id: prefix + "-value",
      value: fact && fact.value !== null ? String(fact.value) : "" });
    const basis = basisSelect(fact ? fact.basis : "illustrative", { id: prefix + "-basis", "aria-label": def.label + ", basis" });
    const el = h("div", { class: "field-row" }, field(def.label, value, hint), field("Basis", basis));
    return {
      el,
      collect() {
        const v = numberOf(value);
        if (v !== null && !(Number.isFinite(v) && v >= 0)) throw new S.ScreeningError(def.label + ": enter zero or a positive number.");
        return v === null ? null : { value: v, basis: basis.value, note: (fact && fact.note) || "" };
      }
    };
  }

  /* ---------- Candidate dialog ---------- */

  function sourceSummary(src) {
    const lines = ["Figures copied from " + (src.fileName || src.processName || "a project") +
      (src.engagementRevision !== null ? ", revision " + src.engagementRevision : "") + (src.takenAt ? ", on " + B.dom.formatDate(src.takenAt) : "") + "."];
    lines.push(src.steps + " step" + (src.steps === 1 ? "" : "s") + ", " + src.stepsWithEffort + " with a touch effort. " +
      src.opportunities + " opportunit" + (src.opportunities === 1 ? "y" : "ies") + (src.hasEventLog ? ", and an event log." : "."));
    if (src.topOpportunity) lines.push("Top opportunity: " + src.topOpportunity.title + ", " + fmt(src.topOpportunity.value, src.topOpportunity.unit, state.screening) + " a year (" + basisLabel(src.topOpportunity.basis).toLowerCase() + ").");
    lines.push("Add the same project again to update these figures. Your scores stay.");
    return h("div", { class: "scr-source" }, lines.map(l => h("p", { class: "small" }, l)));
  }

  function candidateDialog(candidateId) {
    const sc = state.screening;
    const c = candidateId ? sc.candidates.find(x => x.id === candidateId) : null;
    const name = h("input", { class: "input", id: "scr-c-name", value: c ? c.name : "", maxlength: "200" });
    const owner = h("input", { class: "input", id: "scr-c-owner", value: c ? c.owner : "", maxlength: "200" });
    const description = h("textarea", { class: "textarea", id: "scr-c-description", rows: "2" });
    description.value = c ? c.description : "";
    const conf = enumSelect("confidentiality", c ? c.confidentiality : "", { id: "scr-c-confidentiality" }, [["", "Same as the screening (" + schema.label("confidentiality", sc.meta.confidentiality) + ")"]]);
    const sensitive = h("input", { type: "checkbox", id: "scr-c-sensitive", checked: !!(c && c.sensitive) });
    const facts = S.FACTS.map(def => Object.assign({ key: def.key }, factEditor("scr-c-" + def.key, c && c.facts[def.key], def,
      def.key === "hourlyRate" ? "Leave blank to use the screening's rate." : def.key === "effortHoursPerCase" ? "Time people spend working on one case, not waiting." : "")));
    const scoreRows = sc.criteria.map(k => {
      const current = c && c.scores[k.id];
      const value = scoreSelect(current ? current.value : null, { id: "scr-c-score-" + k.id, "aria-label": k.label + ", score" });
      const basis = basisSelect(current ? current.basis : "illustrative", { id: "scr-c-basis-" + k.id, "aria-label": k.label + ", basis" });
      const note = h("input", { class: "input", id: "scr-c-note-" + k.id, value: current ? current.note : "", maxlength: "1000", "aria-label": k.label + ", note" });
      const anchors = [1, 3, 5].filter(n => k.anchors[n]).map(n => n + ": " + k.anchors[n]).join(". ");
      return { k, value, basis, note, row: h("tr", null,
        h("td", null, h("div", { class: "title-cell" }, k.label), h("div", { class: "desc" }, GROUP_LABEL[k.group] + (k.weight ? ", weight " + util.formatNumber(k.weight, 1) : ", not counted")),
          k.help ? h("div", { class: "desc" }, k.help) : null, anchors ? h("div", { class: "desc" }, anchors + ".") : null),
        h("td", null, value), h("td", null, basis), h("td", null, note)) };
    });
    const error = h("p", { class: "error-text", hidden: true, role: "alert", id: "scr-c-error" });
    const body = h("div", { class: "form-grid" },
      h("div", { class: "field-row" }, field("Process name", name), field("Owner", owner, "Who would sponsor or run the change.")),
      field("What the process does", description),
      h("div", { class: "field-row" }, field("Confidentiality", conf),
        h("label", { class: "check", style: { alignSelf: "end" } }, sensitive, "Sensitive: leave out of the ranking unless included")),
      c && c.source ? sourceSummary(c.source) : null,
      h("h3", { class: "section-title" }, "Yearly figures"),
      facts.map(f => f.el),
      h("h3", { class: "section-title" }, "Scores"),
      h("p", { class: "small muted" }, "1 is worst and 5 is best for every criterion. Leave a score blank until you know it; a blank is never counted as zero."),
      h("div", { class: "table-wrap" }, h("table", { class: "table scr-score-table" },
        h("thead", null, h("tr", null, ["Criterion", "Score", "Basis", "Note"].map(x => h("th", { scope: "col" }, x)))),
        h("tbody", null, scoreRows.map(r => r.row)))),
      error);
    function apply() {
      try {
        const patch = {
          name: name.value, owner: owner.value.trim(), description: description.value.trim(), confidentiality: conf.value, sensitive: sensitive.checked,
          facts: Object.fromEntries(facts.map(f => [f.key, f.collect()]))
        };
        let next = state.screening, id = candidateId;
        if (id) next = S.updateCandidate(next, id, patch).screening;
        else { const added = S.addCandidate(next, patch); next = added.screening; id = added.candidateId; }
        scoreRows.forEach(r => {
          next = S.setScore(next, id, r.k.id, { value: r.value.value === "" ? null : Number(r.value.value), basis: r.basis.value, note: r.note.value }).screening;
        });
        commit({ screening: next }, (candidateId ? "Saved " : "Added ") + next.candidates.find(x => x.id === id).name + ".");
        return true;
      } catch (err) {
        if (!(err instanceof S.ScreeningError)) throw err;
        error.hidden = false; error.textContent = err.message;
        return false;
      }
    }
    const actions = [{ label: "Cancel" }];
    if (c) actions.push({ label: "Remove", variant: "btn-danger", keepOpen: true, onClick: api => {
      confirmDialog("Remove " + c.name + "?", "Its scores and figures go with it. Undo brings them back.", "Remove", true).then(ok => {
        if (!ok) return;
        api.close();
        attempt(x => S.removeCandidate(x, c.id), "Removed " + c.name + ".");
      });
    } });
    actions.push({ label: c ? "Save" : "Add process", variant: "btn-primary", onClick: () => apply() ? undefined : false });
    const dlg = openDialog({ title: c ? c.name : "Add a process", eyebrow: "Candidate", wide: true, body, actions, initialFocus: "#scr-c-name",
      onClose: () => focusFirst(c ? "#scr-edit-" + c.id : null, "#scr-add") });
    dlg.dialog.id = "scr-candidate-dialog";
    return dlg;
  }

  /* ---------- Details dialog ---------- */

  function detailsDialog() {
    const m = state.screening.meta;
    const title = h("input", { class: "input", id: "scr-m-title", value: m.title, maxlength: "200" });
    const client = h("input", { class: "input", id: "scr-m-client", value: m.clientDisplayName, maxlength: "200" });
    const conf = enumSelect("confidentiality", m.confidentiality, { id: "scr-m-confidentiality" });
    const status = enumSelect("dataStatus", m.dataStatus, { id: "scr-m-data-status" });
    const currency = h("input", { class: "input", id: "scr-m-currency", value: m.currency, maxlength: "3", style: { maxWidth: "8ch" } });
    const rate = factEditor("scr-m-rate", m.hourlyRate, S.FACTS.find(f => f.key === "hourlyRate"), "Used for every process that has no rate of its own.");
    const note = h("textarea", { class: "textarea", id: "scr-m-note", rows: "3" });
    note.value = m.note;
    const error = h("p", { class: "error-text", hidden: true, role: "alert" });
    const dlg = openDialog({ title: "Screening details", body: h("div", { class: "form-grid" },
      field("Title", title), field("Client", client),
      h("div", { class: "field-row" }, field("Confidentiality", conf), field("Data", status), field("Currency", currency)),
      rate.el, field("Note", note), error),
      actions: [{ label: "Cancel" }, { label: "Save", variant: "btn-primary", onClick: () => {
        try {
          commit(S.updateMeta(state.screening, { title: title.value, clientDisplayName: client.value.trim(), confidentiality: conf.value,
            dataStatus: status.value, currency: currency.value.trim().toUpperCase(), hourlyRate: rate.collect(), note: note.value.trim() }), "Saved the screening details.");
          return undefined;
        } catch (err) {
          if (!(err instanceof S.ScreeningError)) throw err;
          error.hidden = false; error.textContent = err.message;
          return false;
        }
      } }] });
    dlg.dialog.id = "scr-details-dialog";
  }

  /* ---------- Candidates tab ---------- */

  function scoreText(row) {
    if (!row) return muted("Left out");
    if (row.score !== null) return whole(row.score);
    if (row.provisional !== null) return h("span", null, whole(row.provisional) + " so far", h("span", { class: "desc" }, row.missing.length + " to score"));
    return muted("Not scored");
  }

  function candidatesTab(host) {
    const sc = state.screening;
    const rows = new Map(S.evaluate(sc, { includeSensitive: true }).rows.map(r => [r.candidateId, r]));
    host.appendChild(h("div", { class: "form-actions scr-actions" },
      h("button", { type: "button", class: "btn btn-primary", id: "scr-add", on: { click: () => candidateDialog(null) } }, icon("plus"), "Add a process"),
      h("button", { type: "button", class: "btn", id: "scr-add-file", on: { click: addFromProjectFile } }, icon("open"), "Add from a project file"),
      B.app && B.app.store ? h("button", { type: "button", class: "btn", id: "scr-add-open", on: { click: () => addEngagement(B.app.store.get(), B.app.fileName || "") } },
        icon("filePlus"), "Add the open project") : null));
    if (!sc.candidates.length) {
      host.appendChild(h("div", { class: "empty" },
        h("p", null, "No processes yet. Add the ones you are choosing between: type them in, or add a project file you already have."),
        B.bundledScreening ? h("button", { type: "button", class: "btn", id: "scr-example", on: { click: openExample } }, icon("play"), "Open the example screening") : null));
      return;
    }
    const groups = S.GROUPS.map(([id, label]) => ({ id, label, criteria: sc.criteria.filter(k => k.group === id) })).filter(g => g.criteria.length);
    const criteria = groups.flatMap(g => g.criteria);
    const head1 = h("tr", null, h("th", { scope: "col", rowspan: "2" }, "Process"),
      groups.map(g => h("th", { scope: "colgroup", colspan: String(g.criteria.length), class: "scr-group" }, g.label)),
      h("th", { scope: "col", rowspan: "2", class: "num" }, "Score"), h("th", { scope: "col", rowspan: "2" }, h("span", { class: "sr-only" }, "Actions")));
    const head2 = h("tr", null, criteria.map(k => h("th", { scope: "col", class: "scr-crit", title: k.help || k.label },
      k.label, k.weight ? null : h("span", { class: "desc" }, "Not counted"))));
    const body = sc.candidates.map(c => h("tr", { id: "scr-row-" + c.id },
      h("th", { scope: "row" }, h("button", { type: "button", class: "link-btn title-cell", id: "scr-edit-" + c.id, on: { click: () => candidateDialog(c.id) } }, c.name),
        c.owner ? h("div", { class: "desc" }, c.owner) : null,
        c.sensitive ? h("div", { class: "desc" }, "Sensitive") : null,
        c.source ? h("div", { class: "desc" }, "From a project") : null),
      criteria.map(k => {
        const current = c.scores[k.id];
        const sel = scoreSelect(current ? current.value : null, { id: "scr-score-" + c.id + "-" + k.id, "aria-label": k.label + " for " + c.name });
        sel.addEventListener("change", () => attempt(x => S.setScore(x, c.id, k.id, { value: sel.value === "" ? null : Number(sel.value) }),
          k.label + " for " + c.name + (sel.value ? " scored " + sel.value + "." : " cleared.")));
        return h("td", { class: "scr-cell" }, sel);
      }),
      h("td", { class: "num", id: "scr-total-" + c.id }, scoreText(rows.get(c.id))),
      h("td", { class: "actions" }, h("button", { type: "button", class: "btn btn-ghost btn-icon", title: "Details for " + c.name, on: { click: () => candidateDialog(c.id) } },
        icon("edit"), h("span", { class: "sr-only" }, "Details for " + c.name)))));
    host.appendChild(h("div", { class: "table-wrap" }, h("table", { class: "table scr-grid", id: "scr-grid" },
      h("caption", { class: "sr-only" }, "Scores from 1 (worst) to 5 (best) for each process and criterion"),
      h("thead", null, head1, head2), h("tbody", null, body))));
    host.appendChild(h("p", { class: "note" }, "Scores run from 1 (worst) to 5 (best). Select a process name to see what 1, 3 and 5 mean for each criterion, record where a score came from, and add its yearly figures."));
  }

  /* ---------- Criteria tab ---------- */

  function weightShares(sc) {
    const total = sc.criteria.reduce((a, k) => a + k.weight, 0);
    if (!(total > 0)) return "No criterion counts yet: give at least one a weight above 0.";
    return "Share of the total weight: " + S.GROUPS.map(([id, label]) =>
      label + " " + util.formatNumber(sc.criteria.filter(k => k.group === id).reduce((a, k) => a + k.weight, 0) / total * 100, 1) + "%").join(", ") + ".";
  }

  function criteriaTab(host) {
    const sc = state.screening;
    host.appendChild(h("p", { class: "small", style: { maxWidth: "75ch" } },
      "Each criterion is scored from 1 to 5, and higher is always better. The weight says how much it counts. A weight of 0 keeps the criterion visible without counting it. A flag marks any process scored at or below the level you set, without removing it from the ranking."));
    host.appendChild(h("p", { class: "small", id: "scr-weight-shares" }, weightShares(sc)));
    const row = k => {
      const label = h("input", { class: "input", id: "scr-k-label-" + k.id, value: k.label, maxlength: "300", "aria-label": "Criterion name" });
      const group = h("select", { class: "select", id: "scr-k-group-" + k.id, "aria-label": k.label + ", group" }, S.GROUPS.map(([id, l]) => h("option", { value: id, selected: id === k.group }, l)));
      const weight = h("input", { class: "input scr-weight", type: "number", min: "0", max: String(S.WEIGHT_MAX), step: "0.5", id: "scr-k-weight-" + k.id, value: String(k.weight), "aria-label": k.label + ", weight" });
      const gate = h("select", { class: "select", id: "scr-k-gate-" + k.id, "aria-label": k.label + ", flag" },
        h("option", { value: "", selected: k.gateAtOrBelow === null }, "No flag"),
        [1, 2, 3, 4].map(v => h("option", { value: String(v), selected: v === k.gateAtOrBelow }, "At " + v + (v > 1 ? " or below" : ""))));
      const help = h("input", { class: "input", id: "scr-k-help-" + k.id, value: k.help, maxlength: "1000", "aria-label": k.label + ", what it means" });
      const set = (patch, message) => attempt(x => S.updateCriterion(x, k.id, patch), message, true);
      label.addEventListener("change", () => set({ label: label.value }, "Renamed the criterion."));
      group.addEventListener("change", () => set({ group: group.value }, k.label + " moved to " + GROUP_LABEL[group.value] + "."));
      weight.addEventListener("change", () => {
        const v = numberOf(weight);
        set({ weight: v === null ? 0 : v }, k.label + " weight set to " + util.formatNumber(v === null ? 0 : v, 1) + ".");
      });
      gate.addEventListener("change", () => set({ gateAtOrBelow: gate.value === "" ? null : Number(gate.value) }, gate.value ? k.label + " flags a score at " + gate.value + " or below." : k.label + " no longer flags a score."));
      help.addEventListener("change", () => set({ help: help.value }, "Saved what " + k.label + " means."));
      const remove = h("button", { type: "button", class: "btn btn-ghost btn-icon", id: "scr-k-remove-" + k.id, title: "Remove " + k.label, on: { click: async () => {
        const scored = state.screening.candidates.filter(c => c.scores[k.id] && c.scores[k.id].value !== null).length;
        if (scored && !await confirmDialog("Remove " + k.label + "?", scored + " process" + (scored === 1 ? " has a score" : "es have scores") + " for it, and they go with it. Undo brings them back.", "Remove", true)) return;
        attempt(x => S.removeCriterion(x, k.id), "Removed " + k.label + ".");
      } } }, icon("trash"), h("span", { class: "sr-only" }, "Remove " + k.label));
      return h("tr", { id: "scr-k-row-" + k.id }, h("td", null, label), h("td", null, group), h("td", null, weight), h("td", null, gate), h("td", null, help), h("td", { class: "actions" }, remove));
    };
    host.appendChild(h("div", { class: "table-wrap" }, h("table", { class: "table scr-criteria", id: "scr-criteria" },
      h("thead", null, h("tr", null, ["Criterion", "Group", "Weight", "Flag", "What it means", ""].map(x => h("th", { scope: "col" }, x)))),
      h("tbody", null, sc.criteria.map(row)))));
    const newLabel = h("input", { class: "input", id: "scr-k-new-label", maxlength: "300" });
    const newGroup = h("select", { class: "select", id: "scr-k-new-group" }, S.GROUPS.map(([id, l]) => h("option", { value: id }, l)));
    host.appendChild(h("form", { class: "scr-add-criterion", on: { submit: ev => {
      ev.preventDefault();
      if (attempt(x => S.addCriterion(x, { label: newLabel.value, group: newGroup.value }), "Added " + newLabel.value.trim() + ".")) {
        const added = document.getElementById("scr-k-new-label");
        if (added) added.focus();
      }
    } } }, field("New criterion", newLabel), field("Group", newGroup),
      h("button", { type: "submit", class: "btn", id: "scr-k-add" }, icon("plus"), "Add criterion")));
  }

  /* ---------- Ranking tab ---------- */

  const QUADRANT_GRID = { "larger-effort": [0, 0], "start-here": [1, 0], "not-now": [0, 1], "easy-small": [1, 1] };

  function chart(rows, id) {
    const width = 640, height = 440, left = 40, top = 16, plotW = width - left - 16, plotH = height - top - 48;
    const x = v => left + v / 100 * plotW, y = v => top + (1 - v / 100) * plotH;
    const svg = s("svg", { viewBox: "0 0 " + width + " " + height, width: "100%", role: "img", id: id || "scr-chart",
      "aria-label": "Processes placed by value against ease. The table below lists the same processes with their scores." });
    Object.entries(QUADRANT_GRID).forEach(([id, [cx, cy]]) => {
      svg.appendChild(s("rect", { x: left + cx * plotW / 2 + 2, y: top + cy * plotH / 2 + 2, width: plotW / 2 - 4, height: plotH / 2 - 4, class: "bc-quadrant" + (id === "start-here" ? " scr-quadrant-start" : "") }));
      svg.appendChild(s("text", { x: left + cx * plotW / 2 + 10, y: top + cy * plotH / 2 + 22, class: "bc-quadrant-label" }, S.QUADRANTS[id]));
    });
    svg.appendChild(s("text", { x: left + plotW / 2, y: height - 12, "text-anchor": "middle", class: "bc-axis-label" }, "Ease: feasibility, readiness and risk (0 to 100)"));
    svg.appendChild(s("text", { x: 14, y: top + plotH / 2, "text-anchor": "middle", class: "bc-axis-label", transform: "rotate(-90 14 " + (top + plotH / 2) + ")" }, "Value (0 to 100)"));
    [0, 50, 100].forEach(v => {
      svg.appendChild(s("text", { x: x(v), y: top + plotH + 16, "text-anchor": "middle", class: "bc-axis-label" }, String(v)));
      svg.appendChild(s("text", { x: left - 6, y: y(v) + 4, "text-anchor": "end", class: "bc-axis-label" }, String(v)));
    });
    const seen = new Map();
    rows.filter(r => r.quadrant).forEach(r => {
      const key = Math.round(r.ease / 4) + "|" + Math.round(r.groups.value.score / 4);
      const n = seen.get(key) || 0;
      seen.set(key, n + 1);
      const cx = x(r.ease) + n * 14, cy = y(r.groups.value.score) - n * 6;
      const g = s("g", { class: "bc-dot-group", "data-candidate": r.candidateId });
      g.appendChild(s("title", {}, r.name + ", rank " + r.rank + ": value " + whole(r.groups.value.score) + ", ease " + whole(r.ease)));
      g.appendChild(s("circle", { cx, cy, r: 11, class: "bc-dot" + (r.flags.length ? " scr-dot-flagged" : "") }));
      g.appendChild(s("text", { x: cx, y: cy + 4, "text-anchor": "middle", class: "bc-dot-rank" }, String(r.rank)));
      svg.appendChild(g);
    });
    return svg;
  }

  function flagCell(r) {
    return r.flags.length ? h("ul", { class: "plain-list scr-flags" }, r.flags.map(f => h("li", { class: "warn-line" }, icon("alert"), f.message))) : muted("None");
  }

  function figure(o, sc) {
    return o.value !== null ? fmt(o.value, o.unit, sc)
      : h("span", { class: "muted", title: "Missing: " + o.missing.join(", ") }, o.missing.length + " figure" + (o.missing.length === 1 ? "" : "s") + " missing");
  }

  /* The ranking as a table. withActions adds Start a project to each row. */
  function rankingTable(rows, sc, id, withActions) {
    const cols = ["Rank", "Process", "Score", "Value", "Ease", "Where it falls", "Hands-on hours a year", "Labor cost a year", "Basis", "Flags"];
    return h("div", { class: "table-wrap" }, h("table", { class: "table", id },
      h("caption", { class: "sr-only" }, "Processes in rank order, the same information as the chart"),
      h("thead", null, h("tr", null, cols.map((x, i) => h("th", { scope: "col", class: [0, 2, 3, 4, 6, 7].includes(i) ? "num" : null }, x)),
        withActions ? h("th", { scope: "col" }, h("span", { class: "sr-only" }, "Actions")) : null)),
      h("tbody", null, rows.map(r => h("tr", { id: id + "-" + r.candidateId },
        h("td", { class: "num" }, String(r.rank)),
        h("td", null, h("div", { class: "title-cell" }, r.name), r.sensitive ? h("div", { class: "desc" }, "Sensitive") : null,
          r.missing.length ? h("div", { class: "desc" }, "To score: " + r.missing.join(", ")) : null),
        h("td", { class: "num" }, scoreText(r)),
        h("td", { class: "num" }, r.groups.value.score !== null ? whole(r.groups.value.score) : muted("Incomplete")),
        h("td", { class: "num" }, r.ease !== null ? whole(r.ease) : muted("Incomplete")),
        h("td", null, r.quadrant ? S.QUADRANTS[r.quadrant] : muted("Not placed")),
        h("td", { class: "num" }, figure(r.figures.annualEffortHours, sc)),
        h("td", { class: "num" }, figure(r.figures.annualEffortCost, sc)),
        h("td", null, r.basis ? basisLabel(r.basis) : muted("None")),
        h("td", null, flagCell(r)),
        withActions ? h("td", { class: "actions" }, h("button", { type: "button", class: "btn btn-ghost", id: "scr-start-" + r.candidateId,
          on: { click: () => startProject(r.candidateId) } }, icon("filePlus"), "Start a project", h("span", { class: "sr-only" }, " for " + r.name))) : null)))));
  }

  function sensitiveToggle(host) {
    const count = state.screening.candidates.filter(c => c.sensitive).length;
    if (!count) return;
    const box = h("input", { type: "checkbox", id: "scr-include-sensitive", checked: state.includeSensitive });
    box.addEventListener("change", () => { state.includeSensitive = box.checked; render(); });
    host.appendChild(h("label", { class: "check" }, box, "Include " + count + " sensitive process" + (count === 1 ? "" : "es")));
  }

  function rankingTab(host) {
    const sc = state.screening;
    sensitiveToggle(host);
    const result = S.evaluate(sc, { includeSensitive: state.includeSensitive });
    if (!result.rows.length) { host.appendChild(h("div", { class: "empty" }, sc.candidates.length ? "Every process is marked sensitive. Include them to rank them." : "Add processes and score them to see the ranking.")); return; }
    const placed = result.rows.filter(r => r.quadrant);
    const top = result.rows[0], tied = result.stability.tiedIds;
    const firstChoice = tied.length > 1
      ? [h("span", { class: "scr-first", id: "scr-first-choice" }, "Tied"),
        h("span", { class: "s" }, result.rows.filter(r => tied.includes(r.candidateId)).map(r => r.name).join(", ") + ": score " + whole(top.score) + " of 100")]
      : [h("span", { class: "scr-first", id: "scr-first-choice" }, top.score !== null ? top.name : "Not yet"),
        h("span", { class: "s" }, top.score !== null ? "Score " + whole(top.score) + " of 100" + (top.quadrant ? ", " + S.QUADRANTS[top.quadrant].toLowerCase() : "") : "No process is fully scored.")];
    host.appendChild(h("div", { class: "stat-row", id: "scr-summary" },
      h("div", { class: "stat" }, h("span", { class: "l" }, "First choice"), firstChoice,
        tied.length <= 1 && top.score !== null ? h("button", { type: "button", class: "btn scr-start-first", id: "scr-start-first", on: { click: () => startProject(top.candidateId) } },
          icon("filePlus"), "Start a project for it") : null),
      h("div", { class: "stat" }, h("span", { class: "l" }, "Does the choice hold?"),
        h("span", { class: "scr-first", id: "scr-stability-headline" }, result.stability.stable === null ? "Not tested yet" : result.stability.stable ? "Yes" : "Not yet"),
        h("span", { class: "s" }, tied.length > 1 ? "The best score is shared." : result.stability.margin !== null ? util.formatNumber(result.stability.margin, 1) + " points ahead of the next process" : "Needs two fully scored processes."))));
    if (placed.length) host.appendChild(h("div", { class: "scr-chart" }, chart(result.rows)));
    else host.appendChild(h("p", { class: "note" }, "A process appears on the chart once every value criterion and every other criterion is scored."));
    host.appendChild(rankingTable(result.rows, sc, "scr-ranking", true));
    const st = result.stability;
    host.appendChild(h("section", { class: "card scr-stability", id: "scr-stability", "aria-labelledby": "scr-stability-h" },
      h("h3", { id: "scr-stability-h" }, "Does the first choice hold?"),
      h("p", { class: "small" }, st.note),
      st.changes.length ? h("ul", { class: "plain-list" }, st.changes.map(c => h("li", { class: "small" },
        (c.change === "up" ? "More" : "Less") + " weight on " + c.label + ": " + c.topName + " comes first."))) : null));
    host.appendChild(h("ul", { class: "plain-list scr-notes" }, result.notes.map(n => h("li", { class: "note" }, n))));
  }

  /* ---------- Summary and printing ---------- */

  /* The one-page summary. prefix keeps element IDs apart when the page and the print copy both exist. */
  function summaryDoc(sum, sc, prefix) {
    const pct = v => (v === null ? "" : util.formatNumber(v * 100, 1) + "%");
    return h("article", { class: "handoff-doc scr-doc", id: prefix + "-doc" },
      h("div", { class: "handoff-sail", "aria-hidden": "true" }),
      h("p", { class: "eyebrow", style: { marginTop: "var(--space-4)" } }, [sum.client, "Process screening"].filter(Boolean).join(" \u00b7 ")),
      h("h1", null, sum.title),
      h("p", { class: "lede" }, "Candidate processes scored against the same criteria, to choose where to start."),
      h("dl", { class: "facts" },
        h("dt", null, "Data status"), h("dd", null, sum.dataStatus),
        h("dt", null, "Confidentiality"), h("dd", null, sum.confidentiality),
        h("dt", null, "File version"), h("dd", null, String(sum.revision)),
        h("dt", null, "Prepared"), h("dd", null, B.dom.formatDate(sum.preparedAt)),
        h("dt", null, "Processes"), h("dd", null, sum.counts.shown + " compared, " + sum.counts.complete + " fully scored" +
          (sum.counts.excluded ? ". " + sum.counts.excluded + " sensitive left out" : ""))),
      h("h2", null, "Recommendation"),
      h("p", { id: prefix + "-recommendation" }, sum.recommendation.text),
      sum.rows.some(r => r.quadrant) ? h("div", { class: "scr-chart" }, chart(sum.rows, prefix + "-chart")) : null,
      h("h2", null, "Ranking"),
      sum.rows.length ? rankingTable(sum.rows, sc, prefix + "-ranking", false) : h("p", null, "No processes to rank."),
      h("h2", null, "Criteria and weights"),
      h("div", { class: "table-wrap" }, h("table", { class: "table" },
        h("thead", null, h("tr", null, ["Criterion", "Group", "Weight", "Share", "Flag"].map((x, i) => h("th", { scope: "col", class: i === 2 || i === 3 ? "num" : null }, x)))),
        h("tbody", null, sum.criteria.map(k => h("tr", null,
          h("td", null, h("div", { class: "title-cell" }, k.label), k.help ? h("div", { class: "desc" }, k.help) : null),
          h("td", null, k.groupLabel),
          h("td", { class: "num" }, util.formatNumber(k.weight, 1)),
          h("td", { class: "num" }, k.weight ? pct(k.share) : muted("Not counted")),
          h("td", null, k.gateAtOrBelow === null ? muted("None") : "At " + k.gateAtOrBelow + (k.gateAtOrBelow > 1 ? " or below" : ""))))))),
      h("h2", null, "How to read this"),
      h("ul", { class: "plain-list" }, sum.notes.map(n => h("li", { class: "small" }, n))));
  }

  function summaryTab(host) {
    const sc = state.screening;
    sensitiveToggle(host);
    host.appendChild(h("div", { class: "form-actions scr-actions" },
      h("button", { type: "button", class: "btn btn-primary", id: "scr-print-btn", on: { click: printSummary } }, icon("printer"), "Print or save as PDF")));
    host.appendChild(h("div", { class: "handoff scr-summary" }, summaryDoc(S.buildSummary(sc, { includeSensitive: state.includeSensitive }), sc, "scr-sum")));
  }

  /* Prints the summary from a copy outside the window, since printing hides dialogs. */
  function printSummary() {
    const sc = state.screening;
    const old = document.getElementById("scr-print");
    if (old) old.remove();
    const holder = h("div", { class: "handoff", id: "scr-print" }, summaryDoc(S.buildSummary(sc, { includeSensitive: state.includeSensitive }), sc, "scr-print"));
    document.body.appendChild(holder);
    document.body.classList.add("scr-printing");
    root.addEventListener("afterprint", () => {
      document.body.classList.remove("scr-printing");
      holder.remove();
    }, { once: true });
    setTimeout(() => root.print(), 50);
  }

  /* ---------- To a project ---------- */

  async function startProject(candidateId) {
    const sc = state.screening;
    const c = sc.candidates.find(x => x.id === candidateId);
    if (!c) return;
    const result = S.evaluate(sc, { includeSensitive: true });
    const row = result.rows.find(r => r.candidateId === c.id);
    const tied = result.stability.tiedIds;
    const body = h("div", null,
      h("p", null, "The new project gets the process name, the client, the confidentiality and data status, and the yearly volume and hourly rate as assumptions. The process itself starts blank, with a start and an end, for you to build with the people who run it."),
      c.source ? h("p", null, c.name + " was added from " + (c.source.fileName || "a project file") + ". To keep working on that project, open that file with Open instead.") : null,
      row.score === null ? h("p", null, "This process is not fully scored yet.")
        : tied.length > 1 && tied.includes(c.id) ? h("p", null, "This process shares the best score with another one.")
          : row.rank !== 1 ? h("p", null, "This process ranks " + row.rank + " of " + result.rows.length + ".") : null,
      row.flags.length ? h("ul", { class: "plain-list" }, row.flags.map(f => h("li", { class: "warn-line" }, icon("alert"), f.message))) : null,
      dirty() ? h("p", { class: "small muted" }, "The screening stays open in this tab, but it is not saved to a file yet. Save it to keep it.") : null);
    if (!await confirmDialog("Start a project for " + c.name + "?", body, "Start the project")) return;
    let e;
    try { e = S.toStarterEngagement(sc, c.id); } catch (err) { messageDialog("Project not started", err.message); return; }
    const app = appRef || B.app;
    if (app.guardUnsaved && !await app.guardUnsaved("start a project for " + c.name)) return;
    if (view) view.dialog.close();
    app.loadEngagement(e, { savedRevision: -1, source: "screening" });
    app.view.panelOpen = true;
    if (B.processBuilderUi) B.processBuilderUi.open(app);
    announce("Started a project for " + c.name + ".");
  }

  /* ---------- The window ---------- */

  function header() {
    const sc = state.screening;
    const tabs = h("div", { class: "subtabs scr-tabs", role: "tablist", "aria-label": "Screening sections" });
    TABS.forEach(([id, label], i) => {
      const count = id === "candidates" ? sc.candidates.length : id === "criteria" ? sc.criteria.length : null;
      const b = h("button", { type: "button", class: "tab", role: "tab", id: "scr-tab-" + id, "aria-selected": String(state.tab === id),
        "aria-controls": "scr-panel", tabindex: state.tab === id ? 0 : -1 }, label, count === null ? null : h("span", { class: "count" }, String(count)));
      b.addEventListener("click", () => { state.tab = id; state.status = ""; render(); });
      b.addEventListener("keydown", ev => {
        const n = ev.key === "ArrowRight" ? TABS[(i + 1) % TABS.length] : ev.key === "ArrowLeft" ? TABS[(i + TABS.length - 1) % TABS.length] : null;
        if (n) { ev.preventDefault(); state.tab = n[0]; state.status = ""; render(); document.getElementById("scr-tab-" + n[0]).focus(); }
      });
      tabs.appendChild(b);
    });
    return tabs;
  }

  function toolbar() {
    const sc = state.screening;
    const saveState = !state.fileName ? "Not saved yet" : dirty() ? "Changes not saved to " + state.fileName : "Saved as " + state.fileName;
    return h("div", { class: "scr-bar" },
      h("span", { class: "badge info", id: "scr-data-status" }, schema.label("dataStatus", sc.meta.dataStatus)),
      h("span", { class: "badge", id: "scr-confidentiality" }, schema.label("confidentiality", sc.meta.confidentiality)),
      sc.meta.clientDisplayName ? h("span", { class: "small" }, sc.meta.clientDisplayName) : null,
      h("span", { class: "small muted", id: "scr-save-state" }, saveState),
      h("span", { class: "grow" }),
      h("button", { type: "button", class: "btn btn-ghost", id: "scr-undo", disabled: !state.past.length, on: { click: undo } }, icon("undo"), "Undo"),
      h("button", { type: "button", class: "btn btn-ghost", id: "scr-details", on: { click: detailsDialog } }, icon("settings"), "Details"),
      h("button", { type: "button", class: "btn btn-ghost", id: "scr-new", on: { click: () => replaceWith(S.blankScreening()) } }, icon("filePlus"), "New"),
      h("button", { type: "button", class: "btn btn-ghost", id: "scr-open", on: { click: openScreeningFile } }, icon("open"), "Open"),
      h("button", { type: "button", class: "btn btn-primary", id: "scr-save", on: { click: save } }, icon("save"), "Save"));
  }

  function focusFirst(...selectors) {
    if (!view) return;
    const target = selectors.filter(Boolean).map(sel => view.dialog.querySelector(sel)).find(Boolean);
    if (target) target.focus();
  }

  function renderQuiet() {
    if (!view || !view.dialog.open) return;
    clear(view.bar).appendChild(toolbar());
    const status = view.body.querySelector("#scr-status");
    if (status) status.textContent = state.status;
    const shares = view.body.querySelector("#scr-weight-shares");
    if (shares) shares.textContent = weightShares(state.screening);
  }

  function render() {
    if (!view || !view.dialog.open) return;
    const active = document.activeElement && document.activeElement.id && view.dialog.contains(document.activeElement) ? document.activeElement.id : null;
    const scroll = view.body.scrollTop;
    view.title.textContent = state.screening.meta.title;
    clear(view.bar).appendChild(toolbar());
    clear(view.body);
    view.body.appendChild(header());
    view.body.appendChild(h("p", { class: "small scr-status", role: "status", id: "scr-status" }, state.status));
    const panel = h("div", { role: "tabpanel", id: "scr-panel", "aria-labelledby": "scr-tab-" + state.tab });
    view.body.appendChild(panel);
    if (state.tab === "criteria") criteriaTab(panel);
    else if (state.tab === "ranking") rankingTab(panel);
    else if (state.tab === "summary") summaryTab(panel);
    else candidatesTab(panel);
    view.body.scrollTop = scroll;
    const again = active && document.getElementById(active);
    if (again) again.focus();
  }

  function buildWindow() {
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const title = h("h2", { id: "scr-title" });
    const bar = h("div");
    const body = h("div", { class: "dlg-body" });
    const close = h("button", { type: "button", class: "btn btn-icon btn-ghost", id: "scr-close", title: "Close" }, icon("close"), h("span", { class: "sr-only" }, "Close"));
    const dialog = h("dialog", { class: "dlg wide screening-dlg", id: "screening-dialog", "aria-labelledby": "scr-title" },
      h("div", { class: "dlg-shell" },
        h("header", { class: "dlg-head" }, h("div", { style: { flex: "1", minWidth: "0" } }, h("span", { class: "eyebrow" }, "Process screening"), title), close),
        bar, body));
    close.addEventListener("click", () => dialog.close());
    dialog.addEventListener("keydown", ev => {
      const mod = ev.ctrlKey || ev.metaKey;
      if (ev.target.closest("dialog") !== dialog) return;
      if (mod && (ev.key === "s" || ev.key === "S")) { ev.preventDefault(); save(); }
      else if (mod && (ev.key === "z" || ev.key === "Z") && !isTypingTarget(ev.target)) { ev.preventDefault(); undo(); }
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      view = null;
      if (returnTo && document.contains(returnTo)) returnTo.focus();
    });
    document.body.appendChild(dialog);
    dialog.showModal();
    return { dialog, title, bar, body };
  }

  /**
   * Opens the screening window. With a screening, it replaces the one held in
   * this tab (asking first when that one has unsaved changes); without one, it
   * shows the screening held in this tab or a new one.
   */
  async function open(app, screening, info) {
    if (app) appRef = app;
    if (screening && state && !await replaceWith(screening, info)) return;
    if (screening && !state) state = fresh(screening, info);
    if (!state) state = fresh(S.blankScreening());
    if (!view) view = buildWindow();
    render();
    const first = view.dialog.querySelector("#scr-add, #scr-tab-" + state.tab);
    if (first && !view.dialog.contains(document.activeElement)) first.focus();
    if (info && info.warnings) showWarnings(info.fileName || "the file", info.warnings);
  }

  B.ext.registerStartAction({ id: "screening", order: 6, icon: "list", label: "Screen processes", run: app => open(app) });
  B.ext.registerMenuItem({ id: "screening", order: 7, icon: "list", label: "Screen processes", group: "import", run: app => open(app) });
  B.ext.registerJsonHandler({ id: "screening", schema: S.SCREENING_ID, open: (app, data, info) => {
    const result = S.parseScreening(data);
    if (!result.ok) throw new Error(result.errors[0]);
    return open(app, result.screening, { fileName: info && info.fileName, warnings: result.warnings });
  } });

  B.screeningUi = { open, current: () => (state ? state.screening : null), isDirty: dirty };
})(typeof globalThis !== "undefined" ? globalThis : this);
