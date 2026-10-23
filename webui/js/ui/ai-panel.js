/*
 * AI drafts in the app: review and apply an AI result file, and, when the app
 * is served by the local AI helper, start AI tasks from the app.
 *
 * A result file comes from the command line, an agent skill or the local
 * helper. Nothing in it changes the engagement until someone ticks items and
 * applies them. The ticked items go in as one change, marked as AI drafts,
 * and one Undo reverses them. Opened from disk, the app never makes a
 * request; the task buttons appear only in helper mode.
 *
 * A log-mapping result is different: it changes nothing in the engagement.
 * Its ticked mappings go back to the event-log import (info.onProposals),
 * where each one still needs its own tick before the log is added.
 */
(function (root) {
  "use strict";
  const B = root.AIxRay = root.AIxRay || {};
  const { h, icon, announce, formatDate } = B.dom;
  const { schema, aiResults, util } = B;
  const { openDialog, messageDialog, issueList } = B.dialogs;
  const badge = (t, tone) => B.drawer.badge(t, tone);

  const TITLES = {
    extract: "Review the drafted project",
    opportunities: "Review the suggestions",
    "future-state": "Review the future-state draft",
    summary: "Review the drafted summary",
    "log-mapping": "Review the suggested steps",
    goals: "Review the drafted value goals"
  };
  const FIGURE_LABEL = {
    shareOfCasesPct: "Share of cases affected", effortReductionPct: "Effort reduction", durationReductionPct: "Duration reduction",
    oneTimeCost: "One-time cost", annualRunningCost: "Annual running cost"
  };
  const PLAN = { unknown: "not stated", commercial: "commercial", consumer: "consumer" };
  const OP_LABEL = { modify: "Change", insert: "Add", remove: "Remove" };
  /* The app that opened the review, for the project's currency in drafted figures. */
  let app0 = null;
  const OP_TONE = { modify: "info", insert: "success", remove: "warning" };

  /* Who drafted it, on which plan, what was sent, and the file it came from. */
  function provenanceLine(result, fileName) {
    const g = result.generated;
    const d = result.dataHandling;
    const who = [schema.label("aiProvider", g.provider), g.model].filter(Boolean).join(", ");
    const parts = ["Drafted by " + who + " through the " + schema.label("aiSurface", g.surface).toLowerCase() + (g.at ? " on " + formatDate(g.at) : "") + "."];
    parts.push("Plan: " + PLAN[g.plan] + ".");
    parts.push("Sent as " + schema.label("confidentiality", d.confidentiality).toLowerCase() + " material" +
      (d.approvalConfirmed ? ", with approval confirmed" : "") + (d.sensitiveIncluded ? ", including sensitive findings" : "") + ".");
    if (result.sources.length) parts.push("Sources: " + result.sources.map(x => x.name).join(", ") + ".");
    if (fileName) parts.push("File: " + fileName + ".");
    return h("p", { class: "small muted" }, parts.join(" "));
  }

  /* Warnings worth reading before applying: from the job, from validation and from the review. */
  function warningsBlock(result, warnings, review) {
    const all = result.warnings.concat(warnings, review ? review.warnings : [])
      .filter(w => w.level !== "info" && w.code !== "summary.number");
    const seen = new Set();
    const list = all.filter(w => { const k = w.code + "|" + w.message; if (seen.has(k)) return false; seen.add(k); return true; });
    const rules = warnings.filter(w => w.code === "draft.rule");
    if (!list.length && !rules.length) return null;
    return h("section", { class: "ai-warnings", "aria-label": "Before you apply" },
      list.length ? [h("h3", null, "Check before you apply (" + list.length + ")"), issueList(list, 12)] : null,
      rules.length ? [h("h3", null, "What AIxRay changed to keep this a draft"), issueList(rules, 12)] : null);
  }

  function para(label, value) {
    return value ? h("p", { class: "small" }, h("span", { class: "muted" }, label + ": "), value) : null;
  }

  /* A drafted business case: each figure next to the source the AI gave for it. */
  function figureTable(it) {
    if (!it.figures || !it.figures.length) return null;
    const cur = app0 && app0.store ? app0.store.get().meta.currency : "USD";
    const show = f => /Pct$/.test(f.key) ? util.formatNumber(f.value, 1) + "%" : B.units.formatMeasure(f.value, "currency", { currency: cur });
    return h("div", { class: "ai-figures" },
      h("p", { class: "small muted" }, "Drafted business case" + (it.valueCaseConfidence ? ", " + it.valueCaseConfidence + " confidence" : "")),
      h("table", { class: "table small" },
        h("thead", null, h("tr", null, h("th", { scope: "col" }, "Figure"), h("th", { scope: "col", class: "num" }, "Value"), h("th", { scope: "col" }, "Source"))),
        h("tbody", null, it.figures.map(f => h("tr", null, h("td", null, FIGURE_LABEL[f.key] || f.key), h("td", { class: "num" }, show(f)), h("td", null, f.source))))));
  }

  function itemBody(task, it) {
    if (it.kind === "valueCase") {
      return [para("Steps", it.stepLabels.join(", ") || "Its linked steps"), figureTable(it), para("Why", it.rationale)];
    }
    if (task === "goals") {
      const fig = v => v === null || v === undefined ? "" : (it.unit === "$" ? "$" + util.formatNumber(v, 2) : util.formatNumber(v, 2) + (it.unit ? " " + it.unit : ""));
      const target = it.baseline !== null && it.target !== null ? "From " + fig(it.baseline) + " to " + fig(it.target) : it.target !== null ? fig(it.target) : "";
      return [
        para("Measured by", it.metric), para("Target", target), para("By", it.by), para("Owner", it.owner),
        it.quote ? h("p", { class: "small" }, h("span", { class: "muted" }, "In the client's words: "), "\u201c" + it.quote + "\u201d") : null,
        para("Source", it.source), para("Served by", it.servedTitles.join("; ")), para("Why", it.rationale)
      ];
    }
    if (task === "log-mapping") {
      return [para("Step", it.stepLabel || (it.nodeId ? it.nodeId : "No step suggested")), para("Why", it.rationale)];
    }
    if (task === "opportunities") {
      const o = it.opportunity || {};
      return [
        it.description ? h("p", { class: "small" }, it.description) : null,
        o.intervention ? para("Type of change", schema.label("intervention", o.intervention) + (o.effort ? ", " + schema.label("effortSize", o.effort).toLowerCase() + " effort" : "")) : null,
        para("Why not a simpler change", o.simplerAlternative),
        para("Expected benefit", o.expectedBenefit),
        para("How to confirm it", o.validationAction),
        para("Steps", it.stepLabels.join(", ")),
        para("Based on", it.basedOnTitles.join("; ")),
        para("Goals served", (it.goalTitles || []).join("; ")),
        figureTable(it),
        para("Why", it.rationale)
      ];
    }
    if (task === "future-state") {
      return [
        it.changes.length ? h("ul", { class: "plain-list small" }, it.changes.map(c => h("li", null, c))) : null,
        para("Why", it.rationale),
        para("Addresses", it.addresses.join("; "))
      ];
    }
    return [
      h("div", { class: "ai-summary-text small" }, it.text),
      it.keyPoints.length ? [h("p", { class: "small muted" }, "Key points"), h("ul", { class: "plain-list small" }, it.keyPoints.map(k => h("li", null, k.text)))] : null,
      it.caveats.length ? [h("p", { class: "small muted" }, "Caveats"), h("ul", { class: "plain-list small" }, it.caveats.map(c => h("li", null, c)))] : null
    ];
  }

  /* One quiet line under the title: what the item is and how sure the AI is. */
  const itemMeta = parts => h("span", { class: "ai-item-meta" }, parts.filter(Boolean).join(" \u00b7 "));
  const confidenceText = c => c ? c.charAt(0).toUpperCase() + c.slice(1) + " confidence" : "";

  function itemHead(task, it) {
    if (it.kind === "valueCase") return [h("strong", null, "Business case: " + it.title), itemMeta(["For an opportunity already in the project", confidenceText(it.valueCaseConfidence)])];
    if (task === "goals") return [h("strong", null, it.title), itemMeta([schema.label("goalKind", it.goalKind), confidenceText(it.confidence)])];
    if (task === "opportunities") {
      return [h("strong", null, it.title), itemMeta([schema.label("recordKind", it.kind), confidenceText(it.confidence),
        it.priority ? schema.label("priority", it.priority) + " priority" : ""])];
    }
    if (task === "future-state") return [badge(OP_LABEL[it.op], OP_TONE[it.op]), " ", h("strong", null, it.title)];
    if (task === "log-mapping") {
      return [h("strong", null, it.activity), it.stepLabel ? [" to ", h("strong", null, it.stepLabel)] : " stays unmatched",
        itemMeta([confidenceText(it.confidence)])];
    }
    return h("strong", null, it.title);
  }

  function itemView(task, it, withBox, onToggle) {
    const blocked = it.problems.length > 0;
    const box = withBox ? h("input", { type: "checkbox", disabled: blocked, dataset: { key: it.key } }) : null;
    if (box) box.addEventListener("change", () => onToggle(it.key, box.checked));
    const head = withBox ? h("label", { class: "ai-item-head" }, box, h("span", null, itemHead(task, it))) :
      h("div", { class: "ai-item-head" }, h("span", null, itemHead(task, it)));
    return h("li", { class: "ai-item" + (blocked ? " blocked" : "") }, head,
      h("div", { class: "ai-item-body" }, itemBody(task, it),
        it.notes.length ? h("ul", { class: "ai-notes small" }, it.notes.map(n => h("li", null, icon("info"), n))) : null,
        blocked ? h("p", { class: "error-text" }, "Cannot be applied: " + it.problems.join(" ")) : null));
  }

  /* A result that came from the helper exists only in the page until it is saved. */
  function saveAction(app, result, info) {
    if (!info.download) return [];
    return [{ label: "Save draft file", keepOpen: true, onClick: () => {
      const base = app.store && result.task !== "extract" ? B.exporting.fileBase(app.store.get()) : "extract";
      B.dom.downloadBlob(new Blob([JSON.stringify(info.download, null, 2) + "\n"], { type: "application/json" }), base + "." + result.task + ".ai-result.json");
      announce("Draft file saved.");
      return false;
    } }];
  }

  function afterApply(app, result, out, count) {
    if (result.task === "future-state") {
      app.view.display = "c:" + out.modelId;
      app.processView.onEngagementChange({ type: "model/view" });
      app.goto("process");
      announce("Future-state draft created from " + count + " AI change" + (count === 1 ? "" : "s") + ". Undo removes it.");
    } else if (result.task === "log-mapping") {
      announce(count + " AI mapping" + (count === 1 ? "" : "s") + " added to the import. Tick each one you accept.");
    } else if (result.task === "opportunities") {
      const sized = out && out.sized ? out.sized.length : 0, added = out && out.ids ? out.ids.length : count;
      app.goto("records");
      app.recordsView.setTab(sized && !added ? "opportunities" : "records");
      announce([added ? added + " AI draft finding" + (added === 1 ? "" : "s") + " added." : "",
        sized ? sized + " AI draft business case" + (sized === 1 ? "" : "s") + " added to existing opportunities." : "", "Undo removes them."].filter(Boolean).join(" "));
    } else if (result.task === "goals") {
      app.goto("value");
      announce(count + " AI draft goal" + (count === 1 ? "" : "s") + " added. Check " + (count === 1 ? "it" : "them") + " with the client, then mark " + (count === 1 ? "it" : "them") + " reviewed. Undo removes " + (count === 1 ? "it" : "them") + ".");
    } else {
      app.goto("present");
      app.presentView.setMode("handoff");
      announce("Summary added as an AI draft. Check it before you share the report.");
    }
  }

  function reviewChanges(app, result, warnings, info) {
    const e = app.store ? app.store.get() : null;
    const review = aiResults.prepareReview(result, e, info.context);
    if (review.errors.length) {
      messageDialog("This AI draft can't be used here", h("div", null,
        h("p", null, (info.fileName || "The draft") + " doesn't match the open project. Nothing was changed."),
        issueList(review.errors)));
      return null;
    }
    const task = result.task;
    const single = task === "summary";
    const usable = review.items.filter(it => !it.problems.length);
    const selected = new Set(single ? usable.map(it => it.key) : []);
    const count = h("span", { class: "small muted", "aria-live": "polite" });
    const err = h("p", { class: "error-text", role: "alert", hidden: true });
    const reviewedRevision = e.revision;
    const needsRevisionReview = result.engagementRevision !== reviewedRevision;
    const revisionReviewed = h("input", { type: "checkbox", id: "ai-revision-reviewed" });
    revisionReviewed.addEventListener("change", sync);
    const revisionCheck = needsRevisionReview ? h("label", { class: "check" }, revisionReviewed,
      "I checked this draft against revision " + reviewedRevision + " of the open project.") : null;
    const list = h("ul", { class: "ai-items" }, review.items.map(it => itemView(task, it, !single, (key, on) => {
      if (on) selected.add(key); else selected.delete(key);
      sync();
    })));
    let applyBtn = null;
    function sync() {
      count.textContent = selected.size + " of " + usable.length + " selected";
      list.querySelectorAll("input[type=checkbox]").forEach(b => { b.checked = selected.has(b.dataset.key); });
      if (applyBtn) {
        applyBtn.disabled = !selected.size || (needsRevisionReview && !revisionReviewed.checked);
        const verb = task === "log-mapping" ? "Use " : "Apply ";
        applyBtn.textContent = single ? "Add as a draft summary" : selected.size ? verb + selected.size + " selected" : verb + "selected";
      }
    }
    const tools = single ? null : h("div", { class: "ai-tools" },
      h("button", { type: "button", class: "btn", id: "ai-select-all", disabled: !usable.length, on: { click: () => { usable.forEach(it => selected.add(it.key)); sync(); } } }, "Select all"),
      h("button", { type: "button", class: "btn btn-ghost", id: "ai-select-none", on: { click: () => { selected.clear(); sync(); } } }, "Clear"),
      count);
    const p = result.payload;
    const intro = task === "future-state" ? h("div", { class: "ai-intro" },
      h("p", null, h("strong", null, p.name), review.baseline ? " starts as a copy of " + review.baseline.name + " v" + review.baseline.version + "." : ""),
      p.summary ? h("p", { class: "small" }, p.summary) : null,
      p.lanes.length ? para("New lanes, added only if a change you pick uses them", p.lanes.map(l => l.name + " (" + schema.label("laneType", l.type).toLowerCase() + ")").join(", ")) : null) :
      task === "opportunities" ? h("p", { class: "small" }, "Tick the suggestions you want as findings, and the business cases you want on opportunities already in the project. Each one is added as an AI draft and stays out of the report until someone reviews it. Check each drafted figure against its source.") :
      task === "goals" ? h("p", { class: "small" }, "Tick the goals that match what the client said. Each one is added as an AI draft and stays out of the report until someone checks it with the client and marks it reviewed.") :
      task === "log-mapping" ? h("p", { class: "small" }, "Tick the mappings you want in the event log import" + (review.baseline ? " for " + review.baseline.name : "") + ". You still tick each one in the Activities step before the log is added.") :
      h("p", { class: "small" }, "The summary is added as a draft. It stays out of the report until someone reviews it, and the printed report says it was drafted with AI assistance.");
    const body = h("div", { class: "ai-review" },
      intro,
      warningsBlock(result, warnings, review),
      revisionCheck,
      tools,
      review.items.length ? list : h("p", { class: "empty" }, "This draft has nothing to apply."),
      h("p", { class: "note" }, single ? "Undo removes the summary." : task === "log-mapping" ?
        "Nothing in the project changes here. A mapping marked \"Cannot be applied\" points to a step that is not in the model, to a gateway, or to an activity that was not sent." : task === "future-state" ?
        "A change marked \"Cannot be applied\" refers to a step or connector that is not in the baseline, or would break the flow. Undo removes the whole draft." :
        task === "goals" ? "Undo removes all the goals added here." : "Undo removes everything added here."),
      provenanceLine(result, info.fileName),
      err);
    const api = openDialog({
      title: TITLES[task], eyebrow: "AI draft", wide: true, body,
      actions: saveAction(app, result, info).concat([
        { label: "Cancel" },
        { label: "Apply selected", variant: "btn-primary", keepOpen: true, onClick: dlg => {
          const live = app.store && app.store.get();
          if (!live || live.id !== e.id || live.revision !== reviewedRevision) {
            err.hidden = false;
            err.textContent = "The project changed while this review was open. Cancel and open the draft again to review the current revision.";
            return false;
          }
          if (needsRevisionReview && !revisionReviewed.checked) return false;
          const cmd = aiResults.applyCommand(result, review, [...selected]);
          if (!cmd) return false;
          cmd.payload.expectedRevision = reviewedRevision;
          if (cmd.type === "log-mapping/proposals") {
            dlg.close();
            if (info.onProposals) info.onProposals(cmd.payload);
            afterApply(app, result, null, selected.size);
            return false;
          }
          let out;
          try {
            out = app.store.dispatch(cmd.type, cmd.payload);
          } catch (e2) {
            err.hidden = false;
            err.textContent = e2 instanceof B.store.StoreError ? e2.message : "The draft couldn't be applied: " + (e2 && e2.message ? e2.message : e2);
            if (!(e2 instanceof B.store.StoreError)) console.error(e2);
            return false;
          }
          dlg.close();
          afterApply(app, result, out, selected.size);
          return false;
        } }
      ])
    });
    applyBtn = api.dialog.querySelector(".dlg-foot .btn-primary");
    applyBtn.id = "ai-apply";
    sync();
    return api;
  }

  function reviewExtraction(app, result, warnings, info) {
    const review = aiResults.prepareReview(result, null);
    const x = review.engagementSummary;
    const facts = h("dl", { class: "facts" },
      h("dt", null, "Process"), h("dd", null, x.processName),
      x.client ? [h("dt", null, "Client"), h("dd", null, x.client)] : null,
      h("dt", null, "Confidentiality"), h("dd", null, x.confidentiality),
      h("dt", null, "Content"), h("dd", null, [x.records + " findings", x.evidence + " sources", x.assumptions + " assumptions", x.scenarios + " scenarios"]
        .concat(x.goals ? [x.goals + " value goal" + (x.goals === 1 ? "" : "s")] : []).join(", ")));
    const models = h("div", { class: "table-wrap" }, h("table", { class: "table" },
      h("thead", null, h("tr", null, ["Model", "Role", "Lanes", "Steps"].map(c => h("th", { scope: "col" }, c)))),
      h("tbody", null, x.models.map(m => h("tr", null, h("td", null, m.name), h("td", null, m.role), h("td", { class: "num" }, String(m.lanes)), h("td", { class: "num" }, String(m.steps)))))));
    const body = h("div", { class: "ai-review" },
      h("p", { class: "small" }, "This opens as a new project. Everything in it is a draft: no step is confirmed, no source is reviewed, and every model and finding is marked as an AI draft until someone reviews it."),
      warningsBlock(result, warnings, review),
      facts, models,
      h("p", { class: "note" }, "Save the new project to a file to keep it. The project open now does not change."),
      provenanceLine(result, info.fileName));
    return openDialog({
      title: TITLES.extract, eyebrow: "AI draft", wide: true, body,
      actions: saveAction(app, result, info).concat([
        { label: "Cancel" },
        { label: "Open as a new project", variant: "btn-primary", autofocus: true, onClick: () => {
          app.guardUnsaved("replace the open project with the AI draft").then(ok => {
            if (!ok) return;
            const eng = util.clone(result.payload.engagement);
            eng.id = util.uid("eng");
            app.loadEngagement(eng, { savedRevision: -1, warnings, source: "ai" });
            announce("AI draft opened. Check it with the people who do the work, then save it to a file.");
          });
        } }
      ])
    });
  }

  /**
   * Opens a checked result: validation = { ok, errors, warnings, result }
   * from aiResults.validateAiResult.
   */
  function openResult(app, validation, info) {
    app0 = app;
    const meta = info || {};
    if (!validation.ok) {
      messageDialog("This AI draft didn't open", h("div", null,
        h("p", null, (meta.fileName || "The file") + " has " + validation.errors.length + " problem" + (validation.errors.length === 1 ? "" : "s") + ". Nothing was changed."),
        issueList(validation.errors),
        h("p", { class: "small muted" }, "Run the task again, or check the file with npm run ai -- check <file>.")));
      return null;
    }
    const result = validation.result;
    if (result.task === "extract") return reviewExtraction(app, result, validation.warnings, meta);
    if (result.task === "screen") {
      if (B.screeningUi) B.screeningUi.openAiResult(app, validation, meta);
      return null;
    }
    if (result.task === "log-mapping" && !meta.onProposals) {
      messageDialog("Open this mapping from the event-log import", h("div", null,
        h("p", null, (meta.fileName || "This file") + " suggests a step for each activity in an event log. You use it while you import the log, so nothing was changed."),
        h("p", { class: "small" }, "Choose More actions, Import an event log, pick the log, and in the Match activities step choose Load an AI mapping result.")));
      return null;
    }
    return reviewChanges(app, result, validation.warnings, meta);
  }

  /* ---------- The local AI helper (npm run serve -- --ai) ---------- */

  const HELPER = !!document.querySelector("meta[name='aixray-ai-helper']");
  const TOKEN_KEY = "aixray:ai-token";
  const TASK_NAMES = {
    extract: "Create a process from documents", opportunities: "Suggest findings",
    "future-state": "Draft a future state", summary: "Draft the summary",
    "log-mapping": "Match event log activities to steps", goals: "Suggest value goals"
  };
  const TASK_HINTS = {
    extract: "Turn PDF, Word, PowerPoint, diagram images, notes or BPMN files into a draft process in a new project.",
    opportunities: "Pain points, opportunities and open questions for the open project, each linked to its steps.",
    "future-state": "A proposed future state: steps changed, added or removed, and any new lanes.",
    summary: "The executive summary at the start of the printed report.",
    "log-mapping": "A suggested step for each activity name in the event log. Only the activity names and the steps are sent.",
    goals: "What the client counts as value (revenue, cost, capability, risk, experience), drafted from meeting notes or documents against the open project."
  };
  /* The Start button names what the task produces. */
  const START_LABELS = {
    extract: "Create draft", opportunities: "Get suggestions", "future-state": "Draft future state",
    summary: "Draft summary", "log-mapping": "Get suggestions", goals: "Draft goals"
  };
  const ACCEPT = ".pdf,.docx,.pptx,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.markdown,.csv,.tsv,.json,.bpmn,.xml";
  const helper = { token: null, providers: null, limits: null, problem: "" };

  // The one-time code arrives in the link's fragment. Take it before the app rewrites the fragment.
  let launchCode = null;
  if (HELPER) {
    const m = String(root.location.hash || "").match(/(^#|&)ai=([0-9a-f]{16,128})/);
    if (m) {
      launchCode = m[2];
      const rest = root.location.hash.replace(/(^#|&)ai=[0-9a-f]+/, "$1").replace(/^#&/, "#");
      try { root.history.replaceState(null, "", root.location.pathname + root.location.search + (rest === "#" ? "" : rest)); } catch (_) { /* ignore */ }
    }
  }

  function storedToken(value) {
    try {
      if (value === undefined) return root.sessionStorage.getItem(TOKEN_KEY);
      if (value === null) root.sessionStorage.removeItem(TOKEN_KEY);
      else root.sessionStorage.setItem(TOKEN_KEY, value);
    } catch (_) { /* storage blocked: the token lives in memory only */ }
    return null;
  }

  async function call(method, url, body) {
    const headers = {};
    if (helper.token) headers["X-AIxRay-Token"] = helper.token;
    let payload;
    if (body instanceof Blob) { headers["Content-Type"] = "application/octet-stream"; payload = body; }
    else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
    let res;
    try {
      res = await root.fetch(url, { method, headers, body: payload, credentials: "omit", cache: "no-store", redirect: "error" });
    } catch (_) {
      return { ok: false, code: "helper.offline", message: "The AI helper isn't responding. Check that npm run serve -- --ai is still running in the terminal." };
    }
    let data = null;
    try { data = await res.json(); } catch (_) { data = null; }
    if (res.status === 401) {
      helper.token = null;
      storedToken(null);
      return { ok: false, code: "helper.session", message: "This tab isn't connected to the AI helper. Open the latest link printed in the terminal." };
    }
    if (!res.ok) return { ok: false, code: "http." + res.status, message: (data && data.message) || "The AI helper refused the request. Try again, or restart npm run serve -- --ai." };
    return data || { ok: false, code: "helper.reply", message: "The AI helper sent a reply AIxRay didn't expect. Restart npm run serve -- --ai and try again." };
  }

  async function ensureHelper() {
    if (!HELPER) return false;
    if (!helper.token) helper.token = storedToken();
    if (!helper.token && launchCode) {
      const code = launchCode;
      launchCode = null;
      const r = await call("POST", "api/ai/session", { code });
      if (r.ok) { helper.token = r.token; storedToken(r.token); } else helper.problem = r.message;
    }
    if (!helper.token) {
      helper.problem = helper.problem || "Open the link printed by npm run serve -- --ai to use AI tasks in this tab.";
      return false;
    }
    const s = await call("GET", "api/ai/status");
    if (!s.ok) { helper.problem = s.message; return false; }
    helper.providers = s.providers;
    helper.limits = s.limits;
    helper.problem = "";
    return true;
  }

  function providerLine(st) {
    const name = st.provider === "claude" ? "Claude Code" : "Codex";
    if (!st.installed) return name + ": not installed";
    if (!st.loggedIn) return name + ": not signed in";
    if (st.apiKey) return name + ": signed in with an API key, so use the command line with --use-api-key";
    return name + " " + st.version + ", " + st.planLabel + (st.org ? ", " + st.org : "");
  }

  function sizeText(bytes) {
    return bytes >= 1048576 ? util.formatNumber(bytes / 1048576, 1) + " MB" : util.formatNumber(Math.max(1, Math.round(bytes / 1024)), 0) + " KB";
  }

  /* What goes to the AI tool for a task on the open project. */
  function sentSummary(e, task, opts) {
    const input = aiResults.buildTaskInput(e, task, opts);
    if (task === "log-mapping") {
      const model = e.models.find(m => m.id === input.modelId);
      const preview = JSON.stringify(input, null, 1);
      const secret = input.excluded.secretActivities;
      return h("div", { id: "ai-sent" },
        h("ul", { class: "plain-list small" },
          h("li", null, input.activities.length + " activity name" + (input.activities.length === 1 ? "" : "s") + " from the event log" +
            (input.excluded.activities ? ", without the " + input.excluded.activities + " least frequent" : "")),
          secret ? h("li", { id: "ai-sent-secret" }, secret + " activity name" + (secret === 1 ? " that looks" : "s that look") +
            " like a credential, left out. Match " + (secret === 1 ? "it" : "them") + " yourself.") : null,
          h("li", null, "The " + input.steps.length + " steps of " + (model ? model.name : "the model") + ", without gateways: ID, name, lane and description"),
          h("li", null, "The AIxRay instructions for this task")),
        h("p", { class: "small muted" }, "No events, case IDs, times, counts or people from the log are sent."),
        h("details", { class: "small" }, h("summary", null, "Show exactly what is sent"),
          h("pre", { class: "ai-preview" }, preview.length > 40000 ? preview.slice(0, 40000) + "\n..." : preview)));
    }
    const models = input.models.map(m => m.name + " (" + m.steps.length + " steps, " + m.connectors.length + " connectors)").join("; ");
    const sensitiveLeft = input.excluded.sensitiveRecords;
    const lines = [models, input.records.length + " finding" + (input.records.length === 1 ? "" : "s") + (sensitiveLeft ? ", without " + sensitiveLeft + " marked sensitive" : ""),
      input.assumptions.length + " assumption" + (input.assumptions.length === 1 ? "" : "s"),
      input.evidence.length + (input.evidence.length === 1 ? " source" : " sources") + ", with the facts taken from them"];
    if (task === "summary") lines.push("The figures for the report and the number of sources. AI drafts not reviewed yet are left out");
    lines.push("The AIxRay instructions for this task");
    const text = JSON.stringify(input, null, 1);
    return h("div", { id: "ai-sent" },
      h("ul", { class: "plain-list small" }, lines.map(l => h("li", null, l))),
      h("p", { class: "small muted" }, "Not sent: scenario paths, source links or the project history."),
      h("details", { class: "small" }, h("summary", null, "Show exactly what is sent"),
        h("pre", { class: "ai-preview" }, text.length > 40000 ? text.slice(0, 40000) + "\n..." : text)));
  }

  function gateList(gate) {
    return gate && gate.missing && gate.missing.length ? h("ul", { class: "plain-list small" }, gate.missing.map(k => h("li", null, aiResults.GATE_TEXT[k]))) : null;
  }

  /**
   * The task dialog: tool and plan, the data-handling check, what is sent, then run.
   * options: { taskOptions, onProposals }. Log mapping needs taskOptions
   * ({ modelId, activities: [{ name, events }] }) and onProposals(payload),
   * which receives the ticked mappings.
   */
  async function openTask(app, task, options) {
    const o = options || {};
    const taskOptions = o.taskOptions || {};
    const needsFiles = task === "extract" || task === "goals";
    if (!(await ensureHelper())) { messageDialog("AI helper not connected", helper.problem); return null; }
    const e = app.store ? app.store.get() : null;
    if (task !== "extract" && !e) { messageDialog("Open a project first", "This task works on the open project."); return null; }
    const usable = helper.providers.filter(p => p.installed && p.loggedIn && !p.apiKey);
    if (!usable.length) {
      messageDialog("No AI tool is ready", h("div", null,
        h("p", null, "AIxRay couldn't find Claude Code or Codex signed in to a subscription on this computer."),
        h("ul", { class: "plain-list small" }, helper.providers.map(p => h("li", null, providerLine(p)))),
        h("p", { class: "small" }, "To install one and sign in, see docs/ai.md. Then try again.")));
      return null;
    }
    const pref = k => { try { return app.drafts.getPref(k); } catch (_) { return null; } };
    const initial = usable.find(p => p.provider === pref("aiProvider")) || usable[0];
    const field = (label, control, hint) => B.forms.field(label, control, hint);
    const provider = h("select", { class: "select", id: "ai-provider" }, helper.providers.map(p =>
      h("option", { value: p.provider, disabled: !usable.includes(p), selected: p === initial }, providerLine(p))));
    const plan = h("select", { class: "select", id: "ai-plan" },
      h("option", { value: "" }, "Choose the plan this account is on"),
      h("option", { value: "commercial" }, "ChatGPT Business or Enterprise (commercial)"),
      h("option", { value: "consumer" }, "ChatGPT Plus or Pro (consumer)"));
    const planField = field("Plan", plan, "Codex doesn't say which plan you're on. AIxRay remembers your answer in this browser.");
    const planNote = h("p", { class: "small", id: "ai-plan-detected" });

    const files = h("input", { type: "file", id: "ai-files", multiple: true, accept: ACCEPT, class: "input" });
    const fileList = h("ul", { class: "plain-list small", id: "ai-file-list" });
    const processName = h("input", { class: "input", id: "ai-process", maxlength: 200 });
    const client = h("input", { class: "input", id: "ai-client", maxlength: 200 });
    const engName = h("input", { class: "input", id: "ai-eng", maxlength: 200 });
    const conf = h("select", { class: "select", id: "ai-conf" }, schema.ENUMS.confidentiality.map(v =>
      h("option", { value: v, selected: v === "client-confidential" }, schema.label("confidentiality", v))));
    const dataStatus = h("select", { class: "select", id: "ai-data" },
      h("option", { value: "supplied" }, "Provided for this project"),
      h("option", { value: "demonstration" }, "Demonstration material"));
    const currents = e ? e.models.filter(m => m.role === "current") : [];
    const baseline = h("select", { class: "select", id: "ai-baseline" }, currents.map(m => h("option", { value: m.id }, m.name + " v" + m.version)));
    const sensitive = h("input", { type: "checkbox", id: "ai-sensitive" });
    const hasSensitive = !!e && e.records.some(r => r.sensitive);

    const approval = h("input", { type: "checkbox", id: "ai-approval" });
    const trainingOff = h("input", { type: "checkbox", id: "ai-training-off" });
    const written = h("input", { class: "input", id: "ai-written", maxlength: 500, placeholder: "Who approved, and when" });
    const gateRows = {
      approval: h("label", { class: "check" }, approval, aiResults.GATE_TEXT.approval),
      trainingOff: h("label", { class: "check" }, trainingOff, aiResults.GATE_TEXT.trainingOff),
      writtenApproval: field(aiResults.GATE_TEXT.writtenApproval, written)
    };
    const gateMsg = h("p", { class: "small", id: "ai-gate-message", role: "status" });
    const sent = h("div");
    let startBtn = null;

    const current = () => helper.providers.find(p => p.provider === provider.value);
    const planValue = () => { const st = current(); return st && st.planDetected ? st.plan : plan.value; };
    function sync() {
      const st = current();
      planField.hidden = !!(st && st.planDetected);
      planNote.hidden = !(st && st.planDetected);
      planNote.textContent = st && st.planDetected ? "Plan: " + st.planLabel + " (" + st.plan + "), reported by " + (st.provider === "claude" ? "Claude Code" : "Codex") + "." : "";
      const g = aiResults.dataHandlingGate({
        plan: planValue() || "unknown",
        confidentiality: e && task !== "extract" ? e.meta.confidentiality : conf.value,
        dataStatus: e && task !== "extract" ? e.meta.dataStatus : dataStatus.value,
        approvalConfirmed: approval.checked, trainingOptOutConfirmed: trainingOff.checked, writtenApproval: written.value
      });
      gateMsg.textContent = g.message;
      gateMsg.className = g.blocked ? "error-text" : "small";
      Object.keys(gateRows).forEach(k => { gateRows[k].hidden = !g.requires.includes(k); });
      if (task !== "extract") {
        B.dom.clear(sent);
        sent.appendChild(sentSummary(e, task, Object.assign({ includeSensitive: sensitive.checked, baselineModelId: baseline.value || undefined }, taskOptions)));
      } else {
        const list = Array.from(files.files || []);
        B.dom.clear(fileList);
        list.forEach(f => fileList.appendChild(h("li", null, f.name + " (" + sizeText(f.size) + ")")));
      }
      if (task === "goals") {
        B.dom.clear(fileList);
        Array.from(files.files || []).forEach(f => fileList.appendChild(h("li", null, f.name + " (" + sizeText(f.size) + ")")));
      }
      const ready = g.allowed && (!needsFiles || (files.files && files.files.length));
      if (startBtn) startBtn.disabled = !ready;
      return g;
    }
    [provider, plan, conf, dataStatus, baseline, sensitive, approval, trainingOff, files].forEach(c => c.addEventListener("change", sync));
    written.addEventListener("input", sync);
    provider.addEventListener("change", () => {
      const saved = pref("aiPlan:" + provider.value);
      if (saved) { plan.value = saved; sync(); }
    });
    const savedPlan = pref("aiPlan:" + initial.provider);
    if (savedPlan) plan.value = savedPlan;

    // What goes out first, then where it goes, then the data-handling check right above Start.
    const sections = [h("p", { class: "small" }, TASK_HINTS[task])];
    if (task === "extract") {
      sections.push(field("Documents", files, "Up to " + (helper.limits ? helper.limits.files : 20) + " files. Scanned PDF pages have no text, so add them as images."), fileList,
        h("div", { class: "field-row" }, field("Process name", processName), field("Client name", client)),
        field("Project name", engName),
        h("div", { class: "field-row" }, field("Confidentiality", conf), field("Data status", dataStatus)));
    } else {
      if (task === "goals") sections.push(field("Meeting notes or documents", files, "Transcripts, notes, slides or documents where the client says what they count as value."), fileList);
      if (task === "future-state" && currents.length > 1) sections.push(field("Start from", baseline));
      if (hasSensitive && task !== "log-mapping") sections.push(h("label", { class: "check" }, sensitive, "Also send findings marked sensitive"));
      sections.push(h("section", { "aria-labelledby": "ai-sent-head" }, h("h3", { id: "ai-sent-head", class: "small" }, "What will be sent"), sent));
    }
    sections.push(h("div", { class: "field-row" }, field("AI tool", provider), planField), planNote,
      h("section", { class: "ai-warnings", "aria-labelledby": "ai-gate-head" },
        h("h3", { id: "ai-gate-head" }, "Data handling"), gateMsg, gateRows.approval, gateRows.trainingOff, gateRows.writtenApproval),
      h("p", { class: "note" }, "The task uses your own Claude or ChatGPT account and can take several minutes. You review every item before anything changes."));

    const api = openDialog({
      title: TASK_NAMES[task] + " with AI", eyebrow: "AI task", wide: true, body: h("div", { class: "form-grid" }, sections),
      actions: [
        { label: "Cancel" },
        { label: START_LABELS[task], variant: "btn-primary", keepOpen: true, onClick: dlg => {
          if (!sync().allowed) return false;
          const chosen = current();
          try {
            app.drafts.setPref("aiProvider", chosen.provider);
            if (!chosen.planDetected && plan.value) app.drafts.setPref("aiPlan:" + chosen.provider, plan.value);
          } catch (_) { /* preferences are a convenience */ }
          const body = {
            task, provider: chosen.provider, plan: planValue(), approvalConfirmed: approval.checked, trainingOptOutConfirmed: trainingOff.checked,
            writtenApproval: written.value, includeSensitive: sensitive.checked, baselineModelId: baseline.value || undefined
          };
          if (task === "extract") Object.assign(body, { confidentiality: conf.value, dataStatus: dataStatus.value, processName: processName.value, clientDisplayName: client.value, engagementName: engName.value });
          else body.engagement = app.store.get();
          if (task === "log-mapping") body.taskOptions = taskOptions;
          const info = task === "log-mapping" ? { onProposals: o.onProposals, context: { activities: aiResults.buildTaskInput(app.store.get(), task, taskOptions).activities } } : {};
          dlg.close();
          runJob(app, task, body, needsFiles ? Array.from(files.files) : [], chosen, info);
          return false;
        } }
      ]
    });
    startBtn = api.dialog.querySelector(".dlg-foot .btn-primary");
    startBtn.id = "ai-start";
    startBtn.setAttribute("aria-describedby", "ai-gate-message");
    sync();
    return api;
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* Runs a task on the helper and shows its progress; the review opens when it finishes. */
  async function runJob(app, task, body, files, chosen, info) {
    const status = h("p", { role: "status", id: "ai-status" }, "Starting the task");
    const log = h("ol", { class: "ai-progress small", id: "ai-log" });
    const clock = h("p", { class: "small muted" });
    let jobId = null;
    let finished = false;
    const t0 = Date.now();
    const timer = setInterval(() => {
      const s = Math.round((Date.now() - t0) / 1000);
      clock.textContent = s < 60 ? s + " s" : Math.floor(s / 60) + " min " + (s % 60) + " s";
    }, 1000);
    const stop = () => { finished = true; clearInterval(timer); };
    const cancel = () => {
      if (finished) return;
      stop();
      if (jobId) call("POST", "api/ai/jobs/" + jobId + "/cancel", {}).then(() => call("DELETE", "api/ai/jobs/" + jobId));
      announce("AI task cancelled.");
    };
    const dlg = openDialog({
      title: TASK_NAMES[task] + " with AI", eyebrow: "AI task running", body: h("div", { class: "ai-review" }, status, log, clock,
        h("p", { class: "note" }, "Running on " + providerLine(chosen) + ". Closing this dialog cancels the task.")),
      actions: [{ label: "Cancel task", variant: "btn-danger" }],
      onClose: cancel
    });
    const fail = (message, extra) => {
      stop();
      dlg.close();
      if (jobId) call("DELETE", "api/ai/jobs/" + jobId);
      messageDialog("The AI task didn't finish", h("div", null, h("p", null, message), extra || null));
    };
    const created = await call("POST", "api/ai/jobs", Object.assign({}, body, { sourceNames: files.map(f => f.name) }));
    if (finished) return;
    if (!created.ok) { fail(created.message, gateList(created.gate) || (created.errors ? issueList(created.errors, 6) : null)); return; }
    jobId = created.id;
    for (let i = 0; i < files.length; i++) {
      status.textContent = "Passing " + files[i].name + " to the AI helper on this computer";
      const up = await call("PUT", "api/ai/jobs/" + jobId + "/sources/" + i, files[i]);
      if (finished) return;
      if (!up.ok) { fail(up.code === "http.413" ? files[i].name + " is too large. Use smaller files, or fewer of them." : files[i].name + ": " + up.message); return; }
    }
    const started = await call("POST", "api/ai/jobs/" + jobId + "/start", {});
    if (finished) return;
    if (!started.ok) { fail(started.message); return; }
    let next = 0;
    while (!finished) {
      await sleep(1000);
      if (finished) return;
      const r = await call("GET", "api/ai/jobs/" + jobId + "?since=" + next);
      if (finished) return;
      if (!r.ok) { fail(r.message); return; }
      r.events.forEach(ev => {
        if (ev.type === "stage") { status.textContent = ev.message; log.appendChild(h("li", null, ev.message)); }
        else if (ev.type === "tool") log.appendChild(h("li", { class: "muted" }, ev.tool + (ev.target ? " " + ev.target : "")));
      });
      next = r.next;
      if (r.state === "done") {
        stop();
        dlg.close();
        call("DELETE", "api/ai/jobs/" + jobId);
        announce("AI task finished. Review the draft.");
        openResult(app, aiResults.validateAiResult(r.result), Object.assign({ download: r.result }, info || {}));
        return;
      }
      if (r.state === "failed" || r.state === "cancelled") {
        const f = r.failure || {};
        fail(f.message || "The task stopped.", gateList(f.gate) || (f.errors ? issueList(f.errors, 8) : null));
        return;
      }
    }
  }

  function chooseTask(app) {
    app0 = app;
    const has = !!app.store;
    // Log mapping starts from the event-log import, which has the activity names.
    const buttons = Object.keys(TASK_NAMES).filter(task => task !== "log-mapping").map(task => h("button", { type: "button", class: "btn ai-task-btn", id: "ai-task-" + task, disabled: task !== "extract" && !has,
      on: { click: () => { api.close(); openTask(app, task); } } },
      h("strong", null, TASK_NAMES[task]), h("span", { class: "small muted" }, TASK_HINTS[task])));
    const api = openDialog({ title: "Draft with AI", eyebrow: "AI task", body: h("div", { class: "ai-task-list" }, buttons,
      has ? null : h("p", { class: "note" }, "Open a project to use the other tasks.")), actions: [{ label: "Close" }] });
    return api;
  }

  B.aiPanel = { openResult, openTask, chooseTask, enabled: HELPER, connect: ensureHelper, TASK_NAMES };
})(typeof globalThis !== "undefined" ? globalThis : this);
