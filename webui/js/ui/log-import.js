/*
 * BPMVIZ log-import: the event-log import wizard and everything that shows
 * an imported log. Registered through BPMVIZ.ext (see docs/extensions.md):
 *
 *  - a file handler for .csv, .tsv and .xlsx and the menu item "Import an
 *    event log", which open the wizard;
 *  - the Records tab "Event logs" (rename, role, comparison, data status,
 *    figures for the value model, delete), shown while the engagement holds
 *    event logs;
 *  - the "Observed in the event log" section on a step and the event-log
 *    card in the process overview;
 *  - the "Observed inputs" card in the Value workspace and the "Event logs"
 *    section of the handoff after the scope;
 *  - the observed-share and observed-time lenses.
 *
 * The wizard reads the file in chunks, yielding between them, because the
 * app opened from disk cannot start workers. Nothing leaves the browser: the
 * AI assistant is reached only through the local helper, when it runs.
 * Engagement data is always shown as text.
 */
(function (root) {
  "use strict";
  const B = root.BPMVIZ = root.BPMVIZ || {};
  const { h, clear, icon, announce } = B.dom;
  const { schema, util, units, mining, csv, fuzzy, datasetQuery } = B;
  const { openDialog, messageDialog } = B.dialogs;
  const L = schema.LIMITS;
  const TAB_ID = "event-logs";
  const PREVIEW_ROWS = 20;
  const CHUNK = 5000;
  const STEPS = ["File", "Columns", "Activities", "Options", "Check and add"];
  const BASIS_TONE = { observed: "success", supplied: "info", illustrative: "warning" };
  const METHOD_TEXT = { exact: "Same name", fuzzy: "Similar name", ai: "Suggested by AI", manual: "Chosen by hand", ignored: "Left out" };
  const badge = (t, tone) => B.drawer.badge(t, tone);
  const yieldNow = () => new Promise(r => setTimeout(r, 0));
  const count = n => util.formatNumber(n, 0);
  const plural = (n, one, many) => count(n) + " " + (n === 1 ? one : (many || one + "s"));

  let seq = 0;
  const uid = p => "li-" + p + "-" + (++seq);

  mining.registerStoreCommands(B.store);

  /* ---------- Small helpers ---------- */

  function formatOf(name) {
    const m = /\.([^.]+)$/.exec(String(name || "").toLowerCase());
    const ext = m ? m[1] : "";
    return ext === "xlsx" ? "xlsx" : ext === "tsv" ? "tsv" : "csv";
  }

  function baseName(name) {
    return String(name || "Event log").replace(/\.[^.]+$/, "").slice(0, 200) || "Event log";
  }

  function basisText(tb) {
    return tb && tb.calendar === "business" ? "business time" : "calendar time";
  }

  function durationText(minutes, tb) {
    return util.isFiniteNumber(minutes) ? units.formatDuration(minutes, tb, { precise: true }) + " (" + basisText(tb) + ")" : "n/a";
  }

  function basisBadge(d) {
    const b = datasetQuery.basisOf(d);
    return badge(schema.label("assumptionStatus", b), BASIS_TONE[b]);
  }

  function modelName(e, id) {
    const m = e.models.find(x => x.id === id);
    return m ? m.name + " v" + m.version : "No model";
  }

  function randomHex(bytes) {
    const a = new Uint8Array(bytes);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(a);
    else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    return Array.from(a, x => x.toString(16).padStart(2, "0")).join("");
  }

  function minutesToClock(m) {
    const v = Number.isFinite(m) ? m : 540;
    return String(Math.floor(v / 60)).padStart(2, "0") + ":" + String(v % 60).padStart(2, "0");
  }

  function clockToMinutes(text) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(text || "").trim());
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  function field(label, control, hint) {
    return B.forms.field(label, control, hint);
  }

  function select(id, options, value, attrs) {
    return h("select", Object.assign({ class: "select", id }, attrs || {}), options.map(([v, l]) => h("option", { value: v, selected: String(v) === String(value) }, l)));
  }

  function previewTable(header, rows, caption) {
    const width = Math.max(header.length, ...rows.map(r => r.length));
    const cell = v => (v === null || v === undefined ? "" : typeof v === "object" ? (v.date === undefined ? "" : "Excel date " + v.date) : String(v));
    return h("div", { class: "table-wrap li-preview" }, h("table", { class: "table", id: "li-preview" },
      h("caption", { class: "sr-only" }, caption),
      h("thead", null, h("tr", null, Array.from({ length: width }, (_, i) => h("th", { scope: "col" }, header[i] ? String(header[i]) : "Column " + (i + 1))))),
      h("tbody", null, rows.map(r => h("tr", null, Array.from({ length: width }, (_, i) => h("td", null, cell(r[i]).slice(0, 200))))))));
  }

  /* ---------- Reading the file ---------- */

  async function readFile(st, progress) {
    const f = st.file;
    try { f.sha256 = await B.files.sha256Hex(f.bytes); } catch (_) { f.sha256 = ""; }
    if (f.format === "xlsx") {
      progress("Opening the workbook");
      const wb = await B.xlsx.readWorkbookAsync(f.bytes, { inflateRaw: B.files.inflateRaw });
      st.sheets = wb.sheets;
      st.date1904 = wb.date1904;
      const firstUseful = wb.sheets.findIndex(s => !s.hidden && mining.tableFromRows(s.rows).header.length);
      st.sheetIndex = firstUseful >= 0 ? firstUseful : 0;
      if (!st.sheets.length) throw new Error("The workbook has no sheets.");
    } else {
      st.text = csv.decodeText(f.bytes);
      st.delimiter = f.format === "tsv" ? "\t" : csv.detectDelimiter(st.text);
      await parseText(st, progress);
    }
    useTable(st);
  }

  async function parseText(st, progress) {
    const reader = csv.createReader(st.text, { delimiter: st.delimiter });
    const rows = [];
    while (!reader.done()) {
      const chunk = reader.next(CHUNK);
      for (let i = 0; i < chunk.length; i++) rows.push(chunk[i]);
      if (rows.length > L.eventLogEvents + 1) throw new Error("The file has more than " + count(L.eventLogEvents) + " rows. Filter the log to a shorter period or one process first.");
      progress("Reading rows: " + Math.round(reader.progress() * 100) + "%");
      await yieldNow();
    }
    st.rawRows = rows;
    st.unterminated = reader.problems.unterminatedQuote;
  }

  function rowsNow(st) {
    return st.file.format === "xlsx" ? (st.sheets[st.sheetIndex] || { rows: [] }).rows : st.rawRows;
  }

  function useTable(st) {
    st.table = mining.tableFromRows(rowsNow(st));
    if (st.table.rows.length > L.eventLogEvents) throw new Error("The sheet has more than " + count(L.eventLogEvents) + " rows. Filter the log to a shorter period or one process first.");
    const g = mining.guessColumns(st.table.header);
    st.cols = { caseId: g.caseId, activity: g.activity, timestamp: g.timestamp, start: g.start, end: g.end, resource: g.resource };
    st.mode = g.mode;
    detectFormat(st);
    st.built = null;
  }

  function timeValues(st) {
    const idx = st.mode === "start-end" ? [st.cols.start, st.cols.end] : [st.cols.timestamp];
    const out = [];
    for (let i = 0; i < st.table.rows.length && out.length < 2000; i++) idx.forEach(k => { if (k >= 0) out.push(st.table.rows[i][k]); });
    return out;
  }

  function detectFormat(st) {
    st.detected = mining.detectTimestampFormat(timeValues(st));
    st.format = st.detected.format || "iso";
  }

  /* ---------- Mapping rows ---------- */

  function modelOf(app, st) {
    return app.store.get().models.find(m => m.id === st.modelId) || null;
  }

  function stepOptions(model) {
    const steps = mining.mappableSteps(model);
    return model.lanes.map(l => ({ lane: l.name, steps: steps.filter(n => n.laneId === l.id) })).filter(g => g.steps.length);
  }

  function makeRows(st, model) {
    const steps = mining.mappableSteps(model).map(n => ({ id: n.id, label: n.label }));
    st.rows = fuzzy.matchActivities(st.activities, steps).map(m => ({
      activity: m.activity, events: m.events, nodeId: m.nodeId, method: m.method || "ignored", score: m.score, confirmed: m.confirmed, rationale: ""
    }));
    st.endNodeIds = null;
  }

  function effectiveMapping(st) {
    const out = {};
    st.rows.forEach(r => { out[r.activity] = r.nodeId && r.confirmed ? { nodeId: r.nodeId, method: r.method } : { nodeId: null, method: "ignored" }; });
    return out;
  }

  function mappedNodeIds(st) {
    return [...new Set(st.rows.filter(r => r.nodeId && r.confirmed).map(r => r.nodeId))];
  }

  /* ---------- The wizard ---------- */

  function openWizard(app, preset) {
    if (!app.store) {
      messageDialog("Open an engagement first", "An event log is measured against a process model. Open or create the engagement first, then import the log.");
      return null;
    }
    const e = app.store.get();
    if ((e.datasets || []).length >= L.datasets) {
      messageDialog("No room for another event log", "An engagement holds at most " + L.datasets + " event logs. Delete one in Records, Event logs, first.");
      return null;
    }
    const displayed = /^[mc]:(.+)$/.exec(app.view.display || "");
    const shownModel = displayed && e.models.find(m => m.id === displayed[1]);
    const tb = e.meta.timeBasis || {};
    const st = {
      step: 1, busy: false, file: null, modelId: (shownModel || e.models.find(m => m.role === "current") || e.models[0] || {}).id,
      opts: {
        name: "", caseIds: "hashed", keepIds: false, resources: "dropped", requireEnd: true,
        calendar: tb.calendar === "business" ? "business" : "calendar", businessMinutesPerDay: tb.businessMinutesPerDay > 0 ? tb.businessMinutesPerDay : 480, dayStartMinute: 540,
        role: "baseline", comparesToDatasetId: "", dataStatus: e.meta.dataStatus === "demonstration" ? "demonstration" : "observed", topVariants: 3
      }
    };
    const stepper = h("ol", { class: "li-steps", "aria-label": "Import steps" });
    const status = h("p", { class: "small muted li-status", role: "status", "aria-live": "polite", id: "li-status" });
    const panel = h("div", { class: "li-panel", id: "li-panel", tabindex: -1 });
    const err = h("p", { class: "error-text", role: "alert", id: "li-error", hidden: true });
    const body = h("div", { class: "li-wizard" }, stepper, panel, status, err);
    let backBtn = null, nextBtn = null;

    const showError = msg => { err.hidden = !msg; err.textContent = msg || ""; };
    const progress = msg => { status.textContent = msg || ""; };
    async function busy(fn) {
      st.busy = true;
      sync();
      showError("");
      try { return await fn(); } catch (ex) {
        showError((ex && ex.message) || String(ex));
        return false;
      } finally {
        st.busy = false;
        progress("");
        sync();
      }
    }

    function sync() {
      clear(stepper);
      STEPS.forEach((label, i) => stepper.appendChild(h("li", { "aria-current": st.step === i + 1 ? "step" : null, class: st.step > i + 1 ? "done" : "" }, (i + 1) + ". " + label)));
      if (backBtn) { backBtn.disabled = st.busy || st.step === 1; backBtn.hidden = st.step === 1; }
      if (nextBtn) {
        nextBtn.disabled = st.busy || (st.step === 1 && !st.table);
        nextBtn.textContent = st.step === 5 ? "Add the event log" : "Next";
      }
    }

    function render() {
      clear(panel);
      const head = h("h3", { class: "li-step-title" }, "Step " + st.step + " of " + STEPS.length + ": " + STEPS[st.step - 1]);
      panel.appendChild(head);
      const views = [null, renderFile, renderColumns, renderActivities, renderOptions, renderCheck];
      panel.appendChild(views[st.step]());
      sync();
    }

    function goStep(n) {
      st.step = n;
      showError("");
      render();
      panel.focus();
    }

    /* Step 1: the file, the sheet or separator, and a preview. */
    function renderFile() {
      const box = h("div", { class: "form-grid" });
      const pick = h("button", { type: "button", class: "btn", id: "li-choose" }, icon("upload"), st.file ? "Choose another file" : "Choose an event log");
      pick.addEventListener("click", async () => {
        const file = await B.files.pickFile(".csv,.tsv,.txt,.xlsx");
        if (!file) return;
        await load(file, null);
      });
      box.appendChild(h("p", { class: "small" }, "An event log has one row per event: the case it belongs to, the activity, and when it happened (one time, or a start and an end). Comma or tab separated text and Excel workbooks up to " +
        Math.round(L.eventLogBytes / 1048576) + " MB and " + count(L.eventLogEvents) + " events can be read."));
      box.appendChild(h("div", null, pick));
      if (!st.file || !st.table) return box;
      box.appendChild(h("dl", { class: "facts" },
        h("dt", null, "File"), h("dd", null, st.file.name + " (" + util.formatNumber(st.file.size / 1024, 0) + " KB, " + schema.label("logFormat", st.file.format).toLowerCase() + ")"),
        h("dt", null, "Data rows"), h("dd", null, count(st.table.rows.length) + (st.table.headerRow ? ", header in row " + st.table.headerRow : ""))));
      if (st.file.format === "xlsx") {
        const sheet = select("li-sheet", st.sheets.map((s, i) => [i, s.name + (s.hidden ? " (hidden)" : "") + ", " + plural(s.rows.length, "row")]), st.sheetIndex);
        sheet.addEventListener("change", () => busy(async () => { st.sheetIndex = Number(sheet.value); useTable(st); render(); }));
        box.appendChild(field("Sheet", sheet));
      } else {
        const delim = select("li-delimiter", csv.CANDIDATES.map(d => [d, csv.delimiterName(d)[0].toUpperCase() + csv.delimiterName(d).slice(1)]), st.delimiter);
        delim.addEventListener("change", () => busy(async () => { st.delimiter = delim.value; await parseText(st, progress); useTable(st); render(); }));
        box.appendChild(field("Separator", delim, "Detected from the first lines of the file."));
        if (st.unterminated) box.appendChild(h("p", { class: "small" }, icon("alert"), " A quoted value is not closed, so the rest of the file was read into one value. Check the separator, or fix the file."));
      }
      if (!st.table.header.length) {
        box.appendChild(h("p", { class: "error-text" }, "No header row was found. The first row of the log should name the columns."));
        return box;
      }
      box.appendChild(h("p", { class: "section-title" }, "The first " + Math.min(PREVIEW_ROWS, st.table.rows.length) + " rows"));
      box.appendChild(previewTable(st.table.header, st.table.rows.slice(0, PREVIEW_ROWS), "Preview of the first rows of the file"));
      return box;
    }

    async function load(file, bytes) {
      await busy(async () => {
        progress("Reading " + file.name);
        const data = bytes || await B.files.readBytes(file, L.eventLogBytes);
        const next = { name: file.name, size: file.size || data.length, format: formatOf(file.name), bytes: data };
        const scratch = { file: next };
        await readFile(scratch, progress);
        Object.assign(st, scratch, { rows: null, activities: null, builtKey: "" });
        st.opts.name = baseName(file.name);
        render();
        return true;
      });
    }

    /* Step 2: the model, the columns and the timestamp format. */
    function renderColumns() {
      const e = app.store.get();
      const header = st.table.header;
      const colOptions = (none) => (none ? [[-1, none]] : [[-1, "Choose a column"]]).concat(header.map((name, i) => [i, name || "Column " + (i + 1)]));
      const model = select("li-model", e.models.map(m => [m.id, m.name + " v" + m.version + " (" + schema.label("modelRole", m.role).toLowerCase() + ")"]), st.modelId);
      model.addEventListener("change", () => { st.modelId = model.value; });
      const mode = select("li-mode", [["single", "One time per event"], ["start-end", "A start and an end time per event"]], st.mode);
      const caseSel = select("li-col-case", colOptions(), st.cols.caseId);
      const actSel = select("li-col-activity", colOptions(), st.cols.activity);
      const timeSel = select("li-col-time", colOptions(), st.cols.timestamp);
      const startSel = select("li-col-start", colOptions(), st.cols.start);
      const endSel = select("li-col-end", colOptions(), st.cols.end);
      const resSel = select("li-col-resource", colOptions("No resource column"), st.cols.resource);
      const fmtSel = select("li-format", mining.FORMATS, st.format);
      const fmtNote = h("div", { class: "small", id: "li-format-note", "aria-live": "polite" });
      const single = h("div", { class: "field-row" }, field("Time of the event", timeSel));
      const pair = h("div", { class: "field-row" }, field("Start time", startSel), field("End time", endSel));
      function refresh(redetect) {
        st.mode = mode.value;
        st.cols = { caseId: Number(caseSel.value), activity: Number(actSel.value), timestamp: Number(timeSel.value), start: Number(startSel.value), end: Number(endSel.value), resource: Number(resSel.value) };
        single.hidden = st.mode !== "single";
        pair.hidden = st.mode !== "start-end";
        if (redetect) { detectFormat(st); fmtSel.value = st.format; }
        st.format = fmtSel.value;
        clear(fmtNote);
        const d = st.detected;
        if (d.total) {
          const fmtLabel = (mining.FORMATS.find(f => f[0] === d.format) || ["", ""])[1].split(",")[0];
          fmtNote.appendChild(h("p", null, "Detected: " + fmtLabel.toLowerCase() + ". " + count(d.matched) + " of " + count(d.total) + " sampled values can be read that way."));
          if (d.ambiguous && st.format === d.format) fmtNote.appendChild(h("p", null, icon("alert"), " No value has a day above 12, so day first and month first cannot be told apart. Check the samples below and change the format if needed."));
        }
        const values = timeValues(st).filter(v => v !== null && v !== undefined && String(typeof v === "object" ? v.date : v).trim() !== "").slice(0, 3);
        if (values.length) {
          fmtNote.appendChild(h("ul", { class: "plain-list" }, values.map(v => {
            const ms = mining.parseTimestamp(v, st.format, st.date1904);
            const shown = typeof v === "object" ? "Excel date " + v.date : String(v);
            return h("li", null, shown + " is read as " + (ms === null ? "nothing (not readable in this format)" : new Date(ms).toISOString().slice(0, 16).replace("T", " ")));
          })));
        }
      }
      [mode, caseSel, actSel, timeSel, startSel, endSel, resSel].forEach(c => c.addEventListener("change", () => refresh(c !== resSel && c !== caseSel && c !== actSel)));
      fmtSel.addEventListener("change", () => refresh(false));
      const box = h("div", { class: "form-grid" },
        field("Measure against", model, "The process model the activities are mapped to."),
        h("div", { class: "field-row" }, field("Case ID", caseSel), field("Activity", actSel)),
        field("Times in the log", mode), single, pair,
        field("Timestamp format", fmtSel), fmtNote,
        h("p", { class: "note" }, "Times without a time zone are read as wall-clock times, so a change to or from daylight saving time cannot shift a duration."),
        field("Resource (optional)", resSel, "Who did the work. By default it is not used; on the options step you can count people per step. Names are never stored."));
      refresh(false);
      return box;
    }

    async function nextFromColumns() {
      const c = st.cols;
      if (c.caseId < 0 || c.activity < 0) throw new Error("Choose the case ID column and the activity column.");
      if (c.caseId === c.activity) throw new Error("The case ID and the activity must be different columns.");
      if (st.mode === "single" && c.timestamp < 0) throw new Error("Choose the column with the time of each event.");
      if (st.mode === "start-end" && (c.start < 0 || c.end < 0)) throw new Error("Choose the start and the end time columns.");
      if (st.mode === "start-end" && c.start === c.end) throw new Error("The start and the end must be different columns. Choose one time per event instead.");
      const model = modelOf(app, st);
      if (!model) throw new Error("Choose the model to measure against.");
      const key = JSON.stringify([st.sheetIndex, st.delimiter, c, st.mode, st.format, st.modelId]);
      if (st.builtKey !== key) {
        const b = mining.createEventBuilder(c, { mode: st.mode, format: st.format, date1904: st.date1904, resources: c.resource >= 0 ? "counted" : "dropped" });
        const rows = st.table.rows;
        for (let i = 0; i < rows.length; i += CHUNK) {
          b.add(rows.slice(i, i + CHUNK), i + 1);
          progress("Reading events: " + Math.round(i / Math.max(1, rows.length) * 100) + "%");
          await yieldNow();
        }
        const built = b.result();
        if (built.tooManyEvents) throw new Error("The log has more than " + count(L.eventLogEvents) + " events. Filter it to a shorter period or one process first.");
        if (built.tooManyCases) throw new Error("The log has more than " + count(L.eventLogCases) + " cases. Filter it to a shorter period first.");
        if (!built.events.length) throw new Error("No row has a case, an activity and a time that can be read. Check the columns and the timestamp format.");
        st.built = built;
        st.activities = mining.activitiesOf(built.events);
        makeRows(st, model);
        st.builtKey = key;
      }
      return true;
    }

    /* Step 3: activities to steps. */
    function renderActivities() {
      const model = modelOf(app, st);
      const groups = stepOptions(model);
      const summary = h("p", { class: "small", id: "li-map-summary", "aria-live": "polite" });
      const tools = h("div", { class: "li-tools" });
      const tbody = h("tbody");
      function updateSummary() {
        const total = st.rows.reduce((n, r) => n + r.events, 0);
        const used = st.rows.filter(r => r.nodeId && r.confirmed);
        const waiting = st.rows.filter(r => r.nodeId && !r.confirmed).length;
        const covered = used.reduce((n, r) => n + r.events, 0);
        summary.textContent = used.length + " of " + plural(st.rows.length, "activity", "activities") + " mapped, covering " +
          util.formatNumber(total ? covered / total * 100 : 0, 1) + "% of " + plural(total, "event") + "." +
          (waiting ? " " + plural(waiting, "suggestion is", "suggestions are") + " waiting for a tick." : "");
      }
      st.rows.forEach((r, i) => {
        const sel = h("select", { class: "select", id: "li-step-" + i, "aria-label": "Step for " + r.activity },
          h("option", { value: "" }, "Leave out"),
          groups.map(g => h("optgroup", { label: g.lane }, g.steps.map(n => h("option", { value: n.id, selected: n.id === r.nodeId }, n.label)))));
        if (!r.nodeId) sel.value = "";
        const ok = h("input", { type: "checkbox", id: "li-ok-" + i, checked: !!(r.nodeId && r.confirmed), disabled: !r.nodeId, "aria-label": "Accept the mapping of " + r.activity });
        const how = h("span", { class: "small" });
        const why = h("div", { class: "small muted" });
        const showHow = () => {
          how.textContent = METHOD_TEXT[r.nodeId ? r.method : "ignored"] + (r.method === "fuzzy" && r.nodeId ? " (" + util.formatNumber(r.score * 100, 0) + "% alike)" : "") +
            (r.nodeId && !r.confirmed ? ", not ticked" : "");
          why.textContent = r.method === "ai" && r.rationale ? r.rationale : "";
          ok.checked = !!(r.nodeId && r.confirmed);
          ok.disabled = !r.nodeId;
        };
        sel.addEventListener("change", () => {
          r.nodeId = sel.value || null;
          r.method = r.nodeId ? "manual" : "ignored";
          r.confirmed = !!r.nodeId;
          r.rationale = "";
          showHow();
          updateSummary();
        });
        ok.addEventListener("change", () => { r.confirmed = ok.checked; showHow(); updateSummary(); });
        showHow();
        tbody.appendChild(h("tr", null,
          h("td", null, h("div", { class: "title-cell" }, r.activity), why),
          h("td", { class: "num" }, count(r.events)),
          h("td", null, sel),
          h("td", null, h("label", { class: "check" }, ok, "Use")),
          h("td", null, how)));
      });
      const unmapped = () => st.rows.filter(r => !r.nodeId).map(r => ({ name: r.activity, events: r.events }));
      if (B.aiPanel && B.aiPanel.enabled) {
        const ask = h("button", { type: "button", class: "btn", id: "li-ask-ai" }, icon("agent"), "Ask AI for the rest");
        ask.addEventListener("click", () => {
          const rest = unmapped();
          if (!rest.length) { messageDialog("Nothing left to map", "Every activity already has a step or a suggestion."); return; }
          B.aiPanel.openTask(app, "log-mapping", { taskOptions: { modelId: st.modelId, activities: rest }, onProposals: takeProposals });
        });
        tools.appendChild(ask);
      }
      const save = h("button", { type: "button", class: "btn", id: "li-save-names" }, icon("download"), "Save names for the command line");
      save.addEventListener("click", () => {
        const text = st.rows.map(r => r.activity.replace(/[\r\n]+/g, " ")).join("\r\n") + "\r\n";
        B.files.downloadBytes(new TextEncoder().encode(text), baseName(st.file.name) + ".activities.txt", "text/plain");
        announce("Activity names saved.");
      });
      const loadAi = h("button", { type: "button", class: "btn", id: "li-load-ai" }, icon("open"), "Load an AI mapping result");
      loadAi.addEventListener("click", async () => {
        const file = await B.files.pickFile(".json,application/json");
        if (!file) return;
        let text;
        try { text = new TextDecoder().decode(await B.files.readBytes(file, L.fileBytes)); } catch (ex) { messageDialog("File not opened", ex.message); return; }
        const v = B.aiResults.parseAiResultText(text);
        if (v.ok && v.result.task !== "log-mapping") {
          messageDialog("This is not a log mapping", file.name + " is an AI result for \"" + schema.label("aiTask", v.result.task) + "\". Choose a file made with npm run ai -- log-mapping or the bpmviz-log-mapping skill.");
          return;
        }
        B.aiPanel.openResult(app, v, { fileName: file.name, context: { activities: st.activities }, onProposals: takeProposals });
      });
      tools.append(save, loadAi);
      function takeProposals(payload) {
        if (payload.modelId !== st.modelId) {
          messageDialog("Mapped to another model", "These mappings are for " + modelName(app.store.get(), payload.modelId) + ", and this import measures against " + modelName(app.store.get(), st.modelId) + ". Change the model on the columns step, or run the mapping again.");
          return;
        }
        let used = 0;
        payload.mappings.forEach(m => {
          const r = st.rows.find(x => x.activity === m.activity);
          if (!r || (r.confirmed && r.nodeId) || !m.nodeId) return;
          Object.assign(r, { nodeId: m.nodeId, method: "ai", confirmed: false, rationale: m.rationale || "" });
          used++;
        });
        render();
        progress(plural(used, "AI suggestion") + " added. Tick each one you accept.");
      }
      updateSummary();
      return h("div", { class: "form-grid" },
        h("p", { class: "small" }, "Each activity in the log maps to one step at most; several activities may map to the same step. Same names are ticked already. Similar names and AI suggestions need their own tick. Activities left out are counted as unmapped events."),
        tools, summary,
        h("div", { class: "table-wrap li-map" }, h("table", { class: "table", id: "li-map" },
          h("caption", { class: "sr-only" }, "Activities in the log and the steps they map to"),
          h("thead", null, h("tr", null, h("th", { scope: "col" }, "Activity in the log"), h("th", { scope: "col", class: "num" }, "Events"),
            h("th", { scope: "col" }, "Step"), h("th", { scope: "col" }, "Accept"), h("th", { scope: "col" }, "How it was matched"))),
          tbody)),
        h("p", { class: "note" }, "Only the activity names are ever sent to an AI assistant or saved for the command line, never times, case IDs or people. Activity names are client material, so the data-handling rules apply."));
    }

    /* Step 4: privacy and options. */
    function renderOptions() {
      const e = app.store.get();
      const model = modelOf(app, st);
      const o = st.opts;
      const mapped = mappedNodeIds(st);
      if (!st.endNodeIds) st.endNodeIds = mining.defaultEndNodes(model, mapped);
      st.endNodeIds = st.endNodeIds.filter(id => mapped.includes(id));
      const name = h("input", { class: "input", id: "li-name", value: o.name, maxlength: 200 });
      name.addEventListener("input", () => { o.name = name.value; });
      const radio = (value, label, hint) => {
        const inp = h("input", { type: "radio", name: "li-caseids", id: "li-caseids-" + value, value, checked: o.caseIds === value });
        inp.addEventListener("change", () => { o.caseIds = value; keepRow.hidden = value !== "original"; });
        return h("label", { class: "check li-radio" }, inp, h("span", null, h("strong", null, label), " ", h("span", { class: "muted" }, hint)));
      };
      const keep = h("input", { type: "checkbox", id: "li-keep-ids", checked: o.keepIds });
      keep.addEventListener("change", () => { o.keepIds = keep.checked; });
      const keepRow = h("div", { class: "li-keep", hidden: o.caseIds !== "original" },
        h("p", { class: "small" }, icon("alert"), " Original case IDs can identify customers, staff or contracts. They are stored as the case names of the scenarios made from the log and travel with the engagement file."),
        h("label", { class: "check" }, keep, "Keep the original case IDs in the engagement file"));
      const resources = select("li-resources", [["dropped", "Leave the resource column out"], ["counted", "Count the people per step (names are not stored)"]], o.resources, { disabled: st.cols.resource < 0 });
      resources.addEventListener("change", () => { o.resources = resources.value; });
      const requireEnd = h("input", { type: "checkbox", id: "li-require-end", checked: o.requireEnd });
      requireEnd.addEventListener("change", () => { o.requireEnd = requireEnd.checked; });
      const ends = h("ul", { class: "plain-list li-ends", id: "li-ends" }, mapped.map((id, i) => {
        const n = model.nodes.find(x => x.id === id);
        const box = h("input", { type: "checkbox", id: "li-end-" + i, checked: st.endNodeIds.includes(id) });
        box.addEventListener("change", () => {
          st.endNodeIds = box.checked ? st.endNodeIds.concat([id]) : st.endNodeIds.filter(x => x !== id);
        });
        return h("li", null, h("label", { class: "check" }, box, n ? n.label : id));
      }));
      const calendar = select("li-calendar", [["calendar", "Calendar time (24 hours a day, every day)"], ["business", "Business time (Monday to Friday, working hours)"]], o.calendar);
      const perDay = h("input", { class: "input", id: "li-bmpd", type: "number", min: 1, max: 1440, step: 1, value: String(o.businessMinutesPerDay) });
      const dayStart = h("input", { class: "input", id: "li-daystart", type: "time", value: minutesToClock(o.dayStartMinute) });
      const businessRow = h("div", { class: "field-row" }, field("Working minutes per day", perDay), field("Working day starts at", dayStart));
      const tbNote = h("p", { class: "small", id: "li-tb-note" });
      const syncBasis = () => {
        o.calendar = calendar.value;
        businessRow.hidden = o.calendar !== "business";
        const etb = e.meta.timeBasis || {};
        tbNote.textContent = mining.sameBasis({ calendar: o.calendar, businessMinutesPerDay: Number(perDay.value) }, etb) ? "Same time basis as the engagement." :
          "The engagement uses " + basisText(etb) + ". Scenarios from the log use the engagement's time basis; the log's figures use this one, and its cycle time cannot go into the value model.";
      };
      calendar.addEventListener("change", syncBasis);
      perDay.addEventListener("change", () => { o.businessMinutesPerDay = Number(perDay.value); syncBasis(); });
      dayStart.addEventListener("change", () => { const m = clockToMinutes(dayStart.value); if (m !== null) o.dayStartMinute = m; });
      syncBasis();
      const others = (e.datasets || []).filter(d => d.modelId === st.modelId || datasetQuery.correspondence(e, d.modelId, st.modelId).size);
      const role = select("li-role", schema.ENUMS.datasetRole.map(v => [v, schema.label("datasetRole", v)]), o.role);
      const compare = select("li-compare", [["", "Not compared"]].concat((e.datasets || []).map(d => [d.id, d.name + " (" + schema.label("datasetRole", d.role).toLowerCase() + ")"])), o.comparesToDatasetId,
        { disabled: o.role !== "after" || !(e.datasets || []).length });
      role.addEventListener("change", () => {
        o.role = role.value;
        compare.disabled = o.role !== "after" || !(e.datasets || []).length;
        if (o.role === "after" && !compare.value && others.length) { compare.value = others[0].id; o.comparesToDatasetId = compare.value; }
        if (o.role !== "after") { compare.value = ""; o.comparesToDatasetId = ""; }
      });
      compare.addEventListener("change", () => { o.comparesToDatasetId = compare.value; });
      const status = select("li-status-sel", schema.ENUMS.dataStatus.map(v => [v, schema.label("dataStatus", v)]), o.dataStatus);
      status.addEventListener("change", () => { o.dataStatus = status.value; });
      const scen = select("li-scenarios", Array.from({ length: L.scenariosPerDataset + 1 }, (_, i) => [i, i === 0 ? "None" : String(i)]), o.topVariants);
      scen.addEventListener("change", () => { o.topVariants = Number(scen.value); });
      return h("div", { class: "form-grid" },
        field("Name", name),
        h("fieldset", { class: "li-fieldset" }, h("legend", null, "Case IDs"),
          h("p", { class: "small muted" }, "The engagement never stores the events. Case IDs appear only as the names of the cases replayed as scenarios."),
          radio("hashed", "Hashed (recommended).", "A code of 8 characters from a salted SHA-256 hash. The salt is thrown away, so the code cannot be traced back."),
          radio("sequence", "Numbered.", "Case 1, Case 2 and so on, in the order of the file."),
          radio("original", "Original IDs.", "As they are in the log."),
          keepRow),
        field("Resources", resources, st.cols.resource < 0 ? "No resource column was chosen." : "Counting gives the number of people per step and how often work changes hands."),
        h("fieldset", { class: "li-fieldset" }, h("legend", null, "Complete cases"),
          h("label", { class: "check" }, requireEnd, "Leave out cases whose last mapped event is not one of these end steps"),
          mapped.length ? ends : h("p", { class: "small muted" }, "No mapped steps.")),
        h("div", { class: "field-row" }, field("Time basis", calendar), field("Data status", status)), businessRow, tbNote,
        h("div", { class: "field-row" }, field("Role", role), field("Compare with", compare)),
        field("Scenarios from the most common variants", scen, "Each scenario replays the case whose cycle time is closest to the median of its variant."));
    }

    function nextFromOptions() {
      const o = st.opts;
      if (!String(o.name || "").trim()) throw new Error("Give the event log a name.");
      if (o.caseIds === "original" && !o.keepIds) throw new Error("Tick the box to keep the original case IDs, or choose hashed or numbered IDs.");
      if (o.calendar === "business") {
        if (!(o.businessMinutesPerDay >= 1 && o.businessMinutesPerDay <= 1440)) throw new Error("Working minutes per day must be between 1 and 1,440.");
        if (o.dayStartMinute + o.businessMinutesPerDay > 1440) throw new Error("The working day must end before midnight.");
      }
      if (o.requireEnd && !st.endNodeIds.length) throw new Error("Tick at least one end step, or include every case.");
      return true;
    }

    async function measure() {
      const e = app.store.get();
      const model = modelOf(app, st);
      const o = st.opts;
      progress("Measuring the log");
      await yieldNow();
      const salt = randomHex(16);
      const enc = new TextEncoder();
      const tb = { calendar: o.calendar, businessMinutesPerDay: o.businessMinutesPerDay, dayStartMinute: o.dayStartMinute };
      st.result = mining.aggregate({
        model, events: st.built.events, caseNames: st.built.caseNames, mapping: effectiveMapping(st), mode: st.mode,
        timeBasis: tb, scenarioTimeBasis: Object.assign({}, e.meta.timeBasis, { dayStartMinute: o.dayStartMinute }),
        endNodeIds: st.endNodeIds, requireEnd: o.requireEnd, resources: st.cols.resource >= 0 ? o.resources : "dropped",
        caseIds: o.caseIds, hashCase: id => B.files.sha256Js(enc.encode(salt + "\u0000" + id)), topVariants: o.topVariants,
        name: o.name.trim(), role: o.role, comparesToDatasetId: o.role === "after" ? o.comparesToDatasetId || null : null, dataStatus: o.dataStatus,
        source: { fileName: st.file.name, format: st.file.format, sha256: st.file.sha256, rows: st.built.rows, droppedRows: st.built.droppedRows }
      });
      if (!st.result.dataset.cases.count) throw new Error("No case is left to measure. Check the end steps on the options step, or map more activities.");
      return true;
    }

    /* Step 5: what will be added, and what to check first. */
    function renderCheck() {
      const r = st.result;
      const d = r.dataset;
      const tb = d.timeBasis;
      const built = st.built;
      const warnings = [];
      const dropped = Object.keys(built.dropped).filter(k => built.dropped[k]);
      if (dropped.length) {
        warnings.push(plural(built.droppedRows, "row was", "rows were") + " not read: " + dropped.map(k => count(built.dropped[k]) + " with " + mining.DROP_REASONS[k]).join(", ") + "." +
          (built.examples.length ? " For example data row" + (built.examples.length === 1 ? " " : "s ") + built.examples.slice(0, 5).map(x => x.row).join(", ") + "." : ""));
      }
      const unticked = st.rows.filter(x => x.nodeId && !x.confirmed).length;
      if (unticked) warnings.push(plural(unticked, "suggested mapping was", "suggested mappings were") + " not ticked, so " + (unticked === 1 ? "that activity is" : "those activities are") + " left out.");
      if (st.detected && st.detected.ambiguous && st.format === st.detected.format) warnings.push("Day first and month first could not be told apart from the values. The log was read day first.");
      r.warnings.forEach(w => warnings.push(w.message));
      if (st.unterminated) warnings.push("A quoted value in the file is not closed.");
      const top = d.variants[0];
      const facts = h("dl", { class: "facts", id: "li-summary" },
        h("dt", null, "Event log"), h("dd", null, d.name + " (" + schema.label("dataStatus", d.dataStatus).toLowerCase() + ")"),
        h("dt", null, "Measured against"), h("dd", null, modelName(app.store.get(), d.modelId)),
        h("dt", null, "Rows read"), h("dd", null, count(built.rows) + ", giving " + plural(d.source.events, "event")),
        h("dt", null, "Cases measured"), h("dd", null, count(d.cases.count) +
          (d.source.excludedIncompleteCases ? ", " + count(d.source.excludedIncompleteCases) + " left out as incomplete" : "") +
          (r.counts.noMapped ? ", " + count(r.counts.noMapped) + " left out with no mapped event" : "")),
        h("dt", null, "Period"), h("dd", null, mining.periodText(d) + " (" + util.formatNumber(d.period.days, 1) + " days)"),
        h("dt", null, "Annualized volume"), h("dd", null, count(d.cases.annualizedVolume) + " cases per year (cases per day in the period times 365)"),
        h("dt", null, "Median cycle time"), h("dd", null, d.cases.cycleTime ? durationText(d.cases.cycleTime.p50, tb) : "n/a"),
        h("dt", null, "Events not mapped"), h("dd", null, count(d.source.unmatchedEvents)),
        h("dt", null, "Variants"), h("dd", null, count(d.variants.length + d.otherVariants.variants) + (top ? "; the most common covers " + util.formatNumber(top.share * 100, 1) + "% of cases" : "") +
          (d.otherVariants.variants ? "; " + count(d.otherVariants.variants) + " rare variants are only counted" : "")),
        h("dt", null, "Scenarios"), h("dd", null, r.scenarios.length ? r.scenarios.map(s => s.name).join("; ") : "None"),
        h("dt", null, "Stored"), h("dd", null, "Counts and times per step and variant. No events, no case IDs" + (d.source.caseIds === "original" ? " except the scenario case names" : "") + " and no names of people."));
      return h("div", { class: "form-grid" },
        facts,
        warnings.length ? h("section", { class: "li-warnings", "aria-labelledby": "li-warn-head", id: "li-warnings" },
          h("h4", { id: "li-warn-head" }, "Check before you add (" + warnings.length + ")"),
          h("ul", { class: "issue-list" }, warnings.map(w => h("li", null, w)))) : h("p", { class: "small", id: "li-warnings" }, icon("check"), " Nothing to check."),
        h("p", { class: "note" }, "Adding is one change: Undo removes the event log and its scenarios again."));
    }

    function add() {
      const r = st.result;
      let out;
      try {
        out = app.store.dispatch("dataset/import", { dataset: r.dataset, scenarios: r.scenarios });
      } catch (ex) {
        showError(ex instanceof B.store.StoreError ? ex.message : "The event log could not be added: " + (ex && ex.message ? ex.message : ex));
        if (!(ex instanceof B.store.StoreError)) console.error(ex);
        return false;
      }
      api.close();
      if (out.scenarioIds.length) app.view.scenarioId = app.view.scenarioId || out.scenarioIds[0];
      app.goto("records");
      app.recordsView.setTab(TAB_ID);
      announce("Event log added with " + plural(out.scenarioIds.length, "scenario") + ". Undo removes it.");
      return true;
    }

    async function next() {
      if (st.busy) return;
      if (st.step === 1) { if (st.table && st.table.header.length) goStep(2); return; }
      if (st.step === 2) { if (await busy(nextFromColumns)) goStep(3); return; }
      if (st.step === 3) {
        if (!st.rows.some(r => r.nodeId && r.confirmed)) { showError("Map and tick at least one activity."); return; }
        goStep(4);
        return;
      }
      if (st.step === 4) {
        try { nextFromOptions(); } catch (ex) { showError(ex.message); return; }
        if (await busy(measure)) goStep(5);
        return;
      }
      add();
    }

    const api = openDialog({
      title: "Import an event log", eyebrow: e.meta.processName, wide: true, body,
      actions: [
        { label: "Cancel" },
        { label: "Back", keepOpen: true, onClick: () => { if (!st.busy && st.step > 1) goStep(st.step - 1); return false; } },
        { label: "Next", variant: "btn-primary", keepOpen: true, onClick: () => { next(); return false; } }
      ]
    });
    api.dialog.classList.add("li-dialog");
    const buttons = api.dialog.querySelectorAll(".dlg-foot button");
    buttons[0].id = "li-cancel";
    backBtn = buttons[1]; backBtn.id = "li-back";
    nextBtn = buttons[2]; nextBtn.id = "li-next";
    render();
    if (preset && preset.file) load(preset.file, preset.bytes || null);
    return api;
  }

  /* ---------- Event logs in Records ---------- */

  function editDialog(app, d) {
    const e = app.store.get();
    const name = h("input", { class: "input", id: "el-name", value: d.name, maxlength: 200 });
    const role = select("el-role", schema.ENUMS.datasetRole.map(v => [v, schema.label("datasetRole", v)]), d.role);
    const compare = select("el-compare", [["", "Not compared"]].concat(e.datasets.filter(x => x.id !== d.id).map(x => [x.id, x.name])), d.comparesToDatasetId || "");
    const status = select("el-status", schema.ENUMS.dataStatus.map(v => [v, schema.label("dataStatus", v)]), d.dataStatus);
    const notes = h("textarea", { class: "textarea", id: "el-notes", rows: 3, maxlength: 4000 }, d.notes || "");
    const err = h("p", { class: "error-text", role: "alert", hidden: true });
    openDialog({
      title: "Edit " + d.name, eyebrow: "Event log",
      body: h("div", { class: "form-grid" }, field("Name", name), h("div", { class: "field-row" }, field("Role", role), field("Compare with", compare)),
        field("Data status", status, "Observed data is a real log; demonstration data marks every figure from it as illustrative."), field("Notes", notes), err),
      actions: [{ label: "Cancel" }, { label: "Save", variant: "btn-primary", keepOpen: true, onClick: api => {
        const ok = app.dispatch("dataset/update", { id: d.id, patch: { name: name.value, role: role.value, comparesToDatasetId: compare.value || null, dataStatus: status.value, notes: notes.value } }, "Event log updated.", err);
        if (ok) api.close();
        return false;
      } }]
    });
  }

  function deleteDialog(app, d) {
    const made = app.store.get().scenarios.filter(s => d.scenarioIds.includes(s.id) || (s.observedFrom && s.observedFrom.datasetId === d.id));
    const also = h("input", { type: "checkbox", id: "el-delete-scenarios", checked: made.length > 0 });
    openDialog({
      title: "Delete " + d.name + "?", eyebrow: "Event log",
      body: h("div", { class: "form-grid" }, h("p", null, "The figures from this log are removed from the engagement. Figures already copied into the value model stay, with their source."),
        made.length ? h("label", { class: "check" }, also, "Also delete the " + plural(made.length, "scenario") + " made from it") : null),
      actions: [{ label: "Cancel" }, { label: "Delete", variant: "btn-danger", onClick: () => {
        app.dispatch("dataset/delete", { id: d.id, removeScenarios: made.length > 0 && also.checked }, "Event log deleted. Undo restores it.");
      } }]
    });
  }

  /** Copies figures from a log into the value model: annual volume, and cycle time and human touch into a scenario. */
  function valueDialog(app, d) {
    const e = app.store.get();
    const tb = d.timeBasis;
    const vol = datasetQuery.annualVolume(d);
    const cycle = d.cases.cycleTime ? d.cases.cycleTime.p50 : null;
    const touch = mining.humanTouchHours(e, d);
    const sameTb = mining.sameBasis(d.timeBasis, e.meta.timeBasis);
    const scenarios = e.scenarios.filter(s => !d.modelId || s.runs[d.modelId] || !Object.keys(s.runs).length || (s.measures || []).some(m => m.values && m.values[d.modelId] !== undefined));
    const list = scenarios.length ? scenarios : e.scenarios;
    const pick = list.find(s => s.id === app.view.scenarioId) || list[0];
    const boxVol = h("input", { type: "checkbox", id: "ev-volume", checked: vol !== null, disabled: vol === null });
    const boxCycle = h("input", { type: "checkbox", id: "ev-cycle", checked: cycle !== null && sameTb && !!pick, disabled: cycle === null || !sameTb || !pick });
    const boxTouch = h("input", { type: "checkbox", id: "ev-touch", checked: touch !== null && !!pick, disabled: touch === null || !pick });
    const scen = select("ev-scenario", list.map(s => [s.id, s.name]), pick ? pick.id : "", { disabled: !list.length });
    const err = h("p", { class: "error-text", role: "alert", hidden: true });
    const basis = schema.label("assumptionStatus", datasetQuery.basisOf(d)).toLowerCase();
    openDialog({
      title: "Use " + d.name + " in the value model", eyebrow: "Event log",
      body: h("div", { class: "form-grid" },
        h("p", { class: "small" }, "Each figure is copied with the basis " + basis + " and names the log as its source: " + mining.sourceText(d) + "."),
        h("label", { class: "check" }, boxVol, "Annual eligible volume: " + (vol === null ? "not available" : count(vol) + " cases per year, annualized from " + plural(d.cases.count, "case") + " over " + util.formatNumber(d.period.days, 1) + " days")),
        field("Scenario that receives the cycle time and effort", scen),
        h("label", { class: "check" }, boxCycle, "Cycle time: " + (cycle === null ? "not available" : "median " + durationText(cycle, tb)) + (sameTb ? "" : ". Not available: the log is in " + basisText(tb) + " and the engagement in " + basisText(e.meta.timeBasis))),
        h("label", { class: "check" }, boxTouch, "Human touch effort: " + (touch === null ? "not available (it needs start and end times on steps in people swimlanes)" : util.formatNumber(touch, 2) + " hours per case, the average start to end time of the steps in people swimlanes")),
        err),
      actions: [{ label: "Cancel" }, { label: "Use the ticked figures", variant: "btn-primary", keepOpen: true, onClick: api => {
        const ok = app.dispatch("dataset/applyToValueModel", { datasetId: d.id, annualVolume: boxVol.checked, scenarioId: scen.value, cycleTime: boxCycle.checked, humanTouch: boxTouch.checked },
          "Figures from the event log copied to the value model.", err);
        if (ok) api.close();
        return false;
      } }]
    });
  }

  function datasetCard(app, d) {
    const e = app.store.get();
    const tb = d.timeBasis;
    const made = e.scenarios.filter(s => d.scenarioIds.includes(s.id));
    const mapped = d.mapping.filter(m => m.nodeId);
    const model = e.models.find(m => m.id === d.modelId);
    const nodeLabel = id => { const n = model && model.nodes.find(x => x.id === id); return n ? n.label : id; };
    const compare = d.comparesToDatasetId ? e.datasets.find(x => x.id === d.comparesToDatasetId) : null;
    const btn = (id, ic, label, fn) => { const b = h("button", { type: "button", class: "btn", id }, icon(ic), label); b.addEventListener("click", fn); return b; };
    return h("section", { class: "card li-card", "aria-labelledby": "el-h-" + d.id },
      h("div", { class: "li-card-head" },
        h("h3", { id: "el-h-" + d.id }, d.name), basisBadge(d),
        h("span", { class: "spacer" }),
        btn("el-edit-" + d.id, "edit", "Edit", () => editDialog(app, d)),
        btn("el-value-" + d.id, "list", "Use in the value model", () => valueDialog(app, d)),
        btn("el-delete-" + d.id, "trash", "Delete", () => deleteDialog(app, d))),
      h("dl", { class: "facts" },
        h("dt", null, "Model"), h("dd", null, modelName(e, d.modelId)),
        h("dt", null, "Role"), h("dd", null, schema.label("datasetRole", d.role) + (compare ? ", compared with " + compare.name : "")),
        h("dt", null, "Source"), h("dd", null, (d.source.fileName || "File name not recorded") + ", " + schema.label("logFormat", d.source.format).toLowerCase() + ", " + plural(d.source.rows, "row") + " (" + count(d.source.droppedRows) + " not read)"),
        h("dt", null, "Period"), h("dd", null, mining.periodText(d) + " (" + util.formatNumber(d.period.days, 1) + " days)"),
        h("dt", null, "Cases"), h("dd", null, count(d.cases.count) + " measured" + (d.source.excludedIncompleteCases ? ", " + count(d.source.excludedIncompleteCases) + " left out as incomplete" : "") +
          "; " + count(d.cases.annualizedVolume) + " per year when annualized"),
        h("dt", null, "Median cycle time"), h("dd", null, d.cases.cycleTime ? durationText(d.cases.cycleTime.p50, tb) + ", 90th percentile " + units.formatDuration(d.cases.cycleTime.p90, tb, { precise: true }) : "n/a"),
        h("dt", null, "Mapping"), h("dd", null, mapped.length + " of " + plural(d.mapping.length, "activity", "activities") + " mapped; " + plural(d.source.unmatchedEvents, "event") + " not mapped"),
        h("dt", null, "Case IDs"), h("dd", null, schema.label("caseIdHandling", d.source.caseIds) + "; resources " + (d.source.resources === "counted" ? "counted, names not stored" : "left out")),
        h("dt", null, "Scenarios"), h("dd", null, made.length ? made.map(s => s.name).join("; ") : "None")),
      h("details", { class: "small li-details" }, h("summary", null, "Activity mapping (" + d.mapping.length + ")"),
        h("div", { class: "table-wrap" }, h("table", { class: "table" },
          h("thead", null, h("tr", null, h("th", { scope: "col" }, "Activity"), h("th", { scope: "col", class: "num" }, "Events"), h("th", { scope: "col" }, "Step"), h("th", { scope: "col" }, "How"))),
          h("tbody", null, d.mapping.map(m => h("tr", null, h("td", null, m.activity), h("td", { class: "num" }, count(m.events)),
            h("td", null, m.nodeId ? nodeLabel(m.nodeId) : "Left out"), h("td", null, METHOD_TEXT[m.method] || m.method))))))),
      d.notes ? h("p", { class: "small" }, d.notes) : null);
  }

  function renderTab(panel, ctx) {
    const app = ctx.app;
    const list = (ctx.engagement.datasets || []).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const imp = h("button", { type: "button", class: "btn btn-primary", id: "el-import" }, icon("upload"), "Import an event log");
    imp.addEventListener("click", () => openWizard(app, {}));
    panel.appendChild(h("div", { class: "li-tab-head" },
      h("p", { class: "small" }, "Event logs measured against the process models. Each one holds counts and times per step and variant, never the events, case IDs or names of people."),
      imp));
    if (!list.length) { panel.appendChild(h("p", { class: "empty" }, "No event logs yet.")); return; }
    list.forEach(d => panel.appendChild(datasetCard(app, d)));
  }

  /*
   * The tab is shown only while the engagement holds event logs, so the
   * Records tabs stay as they are for engagements without one. The store
   * gives no change hook to features, so the store factory is wrapped to
   * subscribe each new store (see contract change requests in the build notes).
   */
  const tabDef = { id: TAB_ID, label: "Event logs", order: 10, count: e => (e.datasets || []).length, render: renderTab };
  let tabOn = false;
  function syncTab(e) {
    const want = !!(e && Array.isArray(e.datasets) && e.datasets.length);
    if (want === tabOn) return;
    if (want) B.ext.registerRecordsTab(tabDef); else B.ext.unregister("recordsTab", TAB_ID);
    tabOn = want;
  }
  if (B.store && typeof B.store.createStore === "function" && !B.store.createStore.bpmvizEventLogs) {
    const create = B.store.createStore;
    const wrapped = function (initial) {
      const s = create.apply(this, arguments);
      s.subscribe(state => syncTab(state));
      syncTab(s.get());
      return s;
    };
    wrapped.bpmvizEventLogs = true;
    B.store.createStore = wrapped;
  }

  /* ---------- Process view: drawer sections and lenses ---------- */

  function stepSection(ctx, model, node) {
    if (!node || schema.typeInfo(node.semanticType).shape === "gateway") return null;
    const d = mining.datasetFor(ctx.engagement, model.id);
    if (!d) return null;
    const facts = mining.stepFacts(d, node.id);
    return h("section", { class: "side-section", id: "drawer-observed", "aria-labelledby": "drawer-observed-h" },
      h("h3", { id: "drawer-observed-h" }, "Observed in the event log"),
      facts ? h("dl", { class: "facts" }, facts.map(([k, v]) => [h("dt", null, k), h("dd", null, v)])) :
        h("p", { class: "small muted" }, "No event in " + d.name + " maps to this step."),
      h("p", { class: "note" }, "From " + d.name + ", " + mining.periodText(d) + ", " + plural(d.cases.count, "case") + ". " + schema.label("dataStatus", d.dataStatus) + ". Times are in " + basisText(d.timeBasis) + "."));
  }

  function overviewSection(ctx, model) {
    if (!model) return null;
    const d = mining.datasetFor(ctx.engagement, model.id);
    if (!d) return null;
    const top = d.variants[0];
    const lens = h("button", { type: "button", class: "btn", id: "drawer-observed-lens" }, icon("search"), "Show the share of cases");
    lens.addEventListener("click", () => {
      const sel = document.getElementById("pv-lens");
      if (!sel) return;
      sel.value = "observed-share";
      sel.dispatchEvent(new Event("change"));
      announce("Lens: observed share of cases.");
    });
    const open = h("button", { type: "button", class: "link-btn", id: "drawer-observed-open" }, "Open the event logs");
    open.addEventListener("click", () => { ctx.app.goto("records"); ctx.app.recordsView.setTab(TAB_ID); });
    return h("section", { class: "side-section", id: "drawer-event-log", "aria-labelledby": "drawer-event-log-h" },
      h("h3", { id: "drawer-event-log-h" }, "Event log"),
      h("dl", { class: "facts" },
        h("dt", null, "Log"), h("dd", null, d.name),
        h("dt", null, "Cases"), h("dd", null, count(d.cases.count) + ", " + mining.periodText(d)),
        h("dt", null, "Median cycle time"), h("dd", null, d.cases.cycleTime ? durationText(d.cases.cycleTime.p50, d.timeBasis) : "n/a"),
        top ? [h("dt", null, "Most common path"), h("dd", null, util.formatNumber(top.share * 100, 1) + "% of cases")] : null,
        h("dt", null, "Basis"), h("dd", null, schema.label("dataStatus", d.dataStatus))),
      h("div", { class: "li-actions" }, lens, open));
  }

  /* ---------- Value workspace and handoff ---------- */

  function valueSection(ctx) {
    const e = ctx.engagement;
    const list = e.datasets || [];
    if (!list.length) return null;
    const rows = list.map(d => {
      const touch = mining.humanTouchHours(e, d);
      const use = h("button", { type: "button", class: "btn", id: "vv-observed-use-" + d.id }, "Use");
      use.setAttribute("aria-label", "Use " + d.name + " in the value model");
      use.addEventListener("click", () => valueDialog(ctx.app, d));
      return h("tr", null,
        h("td", null, h("div", { class: "title-cell" }, d.name), h("div", { class: "formula" }, mining.periodText(d) + ", " + plural(d.cases.count, "case"))),
        h("td", { class: "num" }, util.isFiniteNumber(d.cases.annualizedVolume) ? count(d.cases.annualizedVolume) + " per year" : "n/a"),
        h("td", { class: "num" }, d.cases.cycleTime ? durationText(d.cases.cycleTime.p50, d.timeBasis) : "n/a"),
        h("td", { class: "num" }, touch === null ? "n/a" : util.formatNumber(touch, 2) + " hours"),
        h("td", null, basisBadge(d)),
        h("td", null, use));
    });
    return h("section", { class: "card", id: "vv-observed", "aria-labelledby": "vv-observed-h" },
      h("h3", { id: "vv-observed-h" }, "Observed inputs"),
      h("div", { class: "table-wrap" }, h("table", { class: "table" },
        h("caption", { class: "sr-only" }, "Figures from event logs"),
        h("thead", null, h("tr", null, h("th", { scope: "col" }, "Event log"), h("th", { scope: "col", class: "num" }, "Annual volume"),
          h("th", { scope: "col", class: "num" }, "Median cycle time"), h("th", { scope: "col", class: "num" }, "Human touch per case"),
          h("th", { scope: "col" }, "Basis"), h("th", { scope: "col" }, h("span", { class: "sr-only" }, "Action")))),
        h("tbody", null, rows))),
      h("p", { class: "note" }, "Annual volume is the cases per day in the log period times 365. Human touch is the average start to end time per case of the steps in people swimlanes, so it can include interruptions. Use copies a figure into the assumptions or a scenario with its basis and source; nothing changes until you do."));
  }

  function handoffSection(hd, ctx) {
    const e = ctx.engagement;
    const list = e.datasets || [];
    if (!list.length) return null;
    return [h("h2", null, "Event logs (" + list.length + ")"),
      h("div", { class: "table-wrap" }, h("table", { class: "table", id: "handoff-event-logs" },
        h("thead", null, h("tr", null, ["Event log", "Model", "Role", "Period", "Cases", "Median cycle time", "Basis"].map(c => h("th", { scope: "col" }, c)))),
        h("tbody", null, list.map(d => h("tr", null,
          h("td", null, d.name), h("td", null, modelName(e, d.modelId)), h("td", null, schema.label("datasetRole", d.role)),
          h("td", null, mining.periodText(d)), h("td", { class: "num" }, count(d.cases.count)),
          h("td", { class: "num" }, d.cases.cycleTime ? durationText(d.cases.cycleTime.p50, d.timeBasis) : "n/a"),
          h("td", null, schema.label("assumptionStatus", datasetQuery.basisOf(d)))))))),
      h("p", { class: "note" }, "Figures from event logs are counts and times per step. The engagement file holds no events, case IDs or names of people from the logs.")];
  }

  /* ---------- Registration ---------- */

  B.ext.registerFileHandler({ id: "event-log", extensions: [".csv", ".tsv", ".xlsx"], priority: 0, maxBytes: L.eventLogBytes,
    open: (app, file, bytes) => { openWizard(app, { file, bytes }); } });
  B.ext.registerMenuItem({ id: "event-log", order: 10, group: "import", needsEngagement: true, icon: "upload", label: "Import an event log", run: app => openWizard(app, {}) });
  B.ext.registerDrawerSection({ id: "observed-step", where: "step", render: stepSection });
  B.ext.registerDrawerSection({ id: "observed-overview", where: "overview", render: overviewSection });
  B.ext.registerValueSection({ id: "observed-inputs", render: valueSection });
  B.ext.registerHandoffSection({ id: "event-logs", after: "scope", render: handoffSection });
  B.lenses.registerLens({ id: "observed-share", label: "Observed share of cases", compute: mining.shareLens });
  B.lenses.registerLens({ id: "observed-time", label: "Observed time per visit", compute: mining.timeLens });

  B.logImport = { openWizard, syncTab, TAB_ID };
})(typeof globalThis !== "undefined" ? globalThis : this);
