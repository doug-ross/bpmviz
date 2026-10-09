/*
 * BPMVIZ client-review: making client review packs and importing the
 * answers. Everything here plugs into the app through BPMVIZ.ext:
 *  - Present bar action "Client review pack" (pr-action-client-review)
 *  - Records tab "Client review" (rv-tab-client-review): packs, responses and the latest answer per item
 *  - Open handles review response files (JSON handler) and filled-in Excel packs (.xlsx handler)
 *  - Process side panel: the latest client answer on a step
 *  - Handoff summary: a Client review section after Evidence
 * The store commands come from lib/reviews.js. See docs/client-review.md.
 */
(function (root) {
  "use strict";
  const B = root.BPMVIZ = root.BPMVIZ || {};
  const { h, icon, announce } = B.dom;
  const { schema, util } = B;
  const R = B.reviews;
  const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const VERDICT_TONE = { confirm: "success", dispute: "warning", unsure: "" };
  const KIND_TITLES = { pain: "Pain points", opportunity: "Opportunities", decision: "Decisions", assumption: "Assumptions", question: "Open questions", action: "Actions", note: "Notes" };
  const OFFERED_KINDS = ["pain", "opportunity", "decision", "assumption", "question"];

  const badge = (text, tone) => h("span", { class: "badge" + (tone ? " " + tone : "") }, text);
  const verdictBadge = v => v ? badge(schema.label("reviewVerdict", v), VERDICT_TONE[v]) : badge("No verdict", "");
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many || one + "s");

  function formatDay(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
  }

  function stat(value, label, sub) {
    return h("div", { class: "stat" }, h("span", { class: "v" }, String(value)), h("span", { class: "l" }, label), sub ? h("span", { class: "s" }, sub) : null);
  }

  function table(caption, heads, rows) {
    return h("div", { class: "table-wrap" }, h("table", { class: "table cr-table" },
      h("caption", { class: "sr-only" }, caption),
      h("thead", null, h("tr", null, heads.map(x => h("th", { scope: "col", class: x[1] || null }, x[0])))),
      h("tbody", null, rows)));
  }

  /* ---------- Making a pack ---------- */

  function defaultModel(e) {
    return (e.models.find(m => m.role === "current") || e.models[0] || {}).id || null;
  }

  async function packFile(e, pack, payload) {
    if (pack.format === "xlsx") {
      const bytes = await B.xlsx.workbookBytesAsync(R.workbookSpec(pack, payload), { deflateRaw: B.files.deflateRaw });
      return { bytes, ext: ".xlsx", type: XLSX_TYPE };
    }
    return { bytes: B.reviewPack.buildPackHtml(payload), ext: ".html", type: "text/html;charset=utf-8" };
  }

  function packFileName(e, pack) {
    return B.exporting.fileBase(e) + "-review-" + (util.slug(pack.stakeholder.name || "client", 40) || "client");
  }

  /** The dialog that makes a pack. ctx carries the Present bar's sensitive and AI-draft choices. */
  function packDialog(app, ctx) {
    if (!app.store) return;
    const e = app.store.get();
    const scope = { includeSensitive: !!(ctx && ctx.includeSensitive), includeUnreviewedAi: !!(ctx && ctx.includeUnreviewedAi) };
    const err = h("p", { class: "error-text", role: "alert", hidden: true });
    const name = h("input", { class: "input", id: "cr-name", maxlength: 200, required: true, autocomplete: "off" });
    const role = h("input", { class: "input", id: "cr-role", maxlength: 200, autocomplete: "off" });
    const org = h("input", { class: "input", id: "cr-org", maxlength: 200, value: e.meta.clientDisplayName || "", autocomplete: "off" });
    const model = h("select", { class: "select", id: "cr-model" }, e.models.map(m => h("option", { value: m.id, selected: m.id === defaultModel(e) },
      m.name + " (" + schema.label("modelRole", m.role).toLowerCase() + ")")));
    const formats = schema.ENUMS.reviewFormat.map((f, i) => h("label", null,
      h("input", { type: "radio", name: "cr-format", id: "cr-format-" + f, value: f, checked: i === 0 }),
      h("span", null, f === "html" ? "Web page (opens in a browser)" : "Excel workbook")));
    const steps = h("input", { type: "checkbox", id: "cr-inc-steps", checked: true });
    const stepsText = h("span");
    const kinds = OFFERED_KINDS.map(k => ({ kind: k, input: h("input", { type: "checkbox", id: "cr-inc-" + k, checked: R.DEFAULT_KINDS.includes(k) }), text: h("span") }));
    const note = h("textarea", { class: "textarea", id: "cr-note", maxlength: 4000, rows: 3, placeholder: "What you would like the reviewer to focus on, and when you need the answers" });
    const summary = h("p", { class: "small", id: "cr-summary", "aria-live": "polite" });

    const options = () => ({
      modelId: model.value, steps: steps.checked, kinds: kinds.filter(k => k.input.checked).map(k => k.kind),
      includeSensitive: scope.includeSensitive, includeUnreviewedAi: scope.includeUnreviewedAi
    });
    function update() {
      const counts = R.packCounts(e, options());
      stepsText.textContent = "Steps and decision points (" + counts.steps + ")";
      kinds.forEach(k => { k.text.textContent = KIND_TITLES[k.kind] + " (" + counts.records[k.kind] + ")"; });
      const items = R.buildPackItems(e, options());
      const nSteps = items.filter(i => i.kind === "step").length;
      summary.textContent = items.length ? "The pack will list " + plural(items.length, "item") + ": " + plural(nSteps, "step") + " and " + plural(items.length - nSteps, "finding") + "." :
        "Nothing is selected yet. Choose at least one kind of item that has entries.";
    }
    [model, steps].concat(kinds.map(k => k.input)).forEach(x => x.addEventListener("change", update));
    update();

    const privacy = "The pack holds the chosen steps and findings with their descriptions, and the engagement's title, client, data status, confidentiality and disclosure. Nothing else from the engagement goes in. " +
      (scope.includeSensitive ? "Sensitive records are included because Include sensitive records is ticked in the Present bar. " : "Sensitive records are left out. ") +
      (scope.includeUnreviewedAi ? "AI drafts not yet reviewed are included." : "AI drafts not yet reviewed are left out.");

    let busy = false;
    async function make(api) {
      if (busy) return;
      busy = true;
      try { await makeOnce(api); } finally { busy = false; }
    }
    async function makeOnce(api) {
      err.hidden = true;
      if (!name.value.trim()) { err.hidden = false; err.textContent = "Enter the name of the person who will review the pack."; name.focus(); return; }
      const items = R.buildPackItems(e, options());
      if (!items.length) { err.hidden = false; err.textContent = "Choose at least one kind of item that has entries."; return; }
      const format = (formats.map(l => l.querySelector("input")).find(i => i.checked) || {}).value || "html";
      const pack = R.newPack(e, { format, stakeholder: { name: name.value, role: role.value, organization: org.value }, modelId: model.value, note: note.value }, items);
      const payload = R.packPayload(e, pack, items);
      let file;
      try { file = await packFile(e, pack, payload); } catch (x) { err.hidden = false; err.textContent = "The pack could not be made: " + (x && x.message ? x.message : x); return; }
      const fileName = packFileName(e, pack) + file.ext;
      showTab();
      if (!app.dispatch("review/recordPack", { pack }, null, err)) return;
      B.files.downloadBytes(file.bytes, fileName, file.type);
      api.close("made");
      announce("Review pack for " + pack.stakeholder.name + " saved as " + fileName + ".");
    }

    const body = h("div", { class: "form-grid cr-dialog" },
      h("p", { class: "small" }, "The pack lists steps and findings for a client stakeholder to confirm, dispute or mark as not sure, with a comment. It works on its own: the web page opens in any current browser from the file, and the workbook opens in Excel. The answers come back as a file you open in BPMVIZ."),
      h("div", { class: "field-row" },
        h("div", { class: "field" }, h("label", { for: "cr-name" }, "Reviewer's name"), name),
        h("div", { class: "field" }, h("label", { for: "cr-role" }, "Role"), role),
        h("div", { class: "field" }, h("label", { for: "cr-org" }, "Organization"), org)),
      h("div", { class: "field" }, h("label", { for: "cr-model" }, "Process model"), model),
      h("fieldset", { class: "segmented" }, h("legend", null, "Format"), formats),
      h("fieldset", { class: "cr-options" }, h("legend", { class: "field-label" }, "Include"),
        h("label", { class: "check" }, steps, stepsText),
        kinds.map(k => h("label", { class: "check" }, k.input, k.text)),
        h("p", { class: "field-hint" }, "Findings are the records marked for the handoff that are linked to this model or to no model.")),
      h("div", { class: "field" }, h("label", { for: "cr-note" }, "Note to the reviewer (optional)"), note),
      summary,
      h("p", { class: "note" }, privacy),
      err);
    B.dialogs.openDialog({
      title: "Make a client review pack", eyebrow: "Client review", wide: true, body, initialFocus: "#cr-name",
      actions: [{ label: "Cancel" }, { label: "Make the pack", variant: "btn-primary", keepOpen: true, onClick: api => { make(api); return false; } }]
    });
  }

  /* Downloads a recorded pack again, rebuilt from the current engagement with the same pack ID. */
  async function downloadAgain(app, pack) {
    const e = app.store.get();
    const items = R.buildPackItems(e, { modelId: pack.modelId, itemRefs: pack.items.map(i => i.itemRef) });
    if (!items.length) { B.dialogs.messageDialog("Pack not downloaded", "None of the items in this pack exist any more."); return; }
    try {
      const file = await packFile(e, pack, R.packPayload(e, pack, items));
      const fileName = packFileName(e, pack) + file.ext;
      B.files.downloadBytes(file.bytes, fileName, file.type);
      announce("Review pack saved again as " + fileName + ".");
    } catch (x) {
      B.dialogs.messageDialog("Pack not downloaded", "The pack could not be made: " + (x && x.message ? x.message : x));
    }
  }

  /* ---------- Importing a response ---------- */

  function effectOf(it) {
    if (it.kind !== "step") return "Recorded with the review";
    if (it.superseded) return "No change: a later review answered this step";
    if (!it.targetValidation) return "Validation stays " + schema.label("validation", it.currentValidation).toLowerCase();
    if (it.targetValidation === it.currentValidation) return "Already " + schema.label("validation", it.currentValidation).toLowerCase();
    return "Validation: " + schema.label("validation", it.currentValidation) + " to " + schema.label("validation", it.targetValidation);
  }

  function warningList(list) {
    return h("ul", { class: "issue-list" }, list.map(w => h("li", null, h("div", { class: "warn-line" }, icon(w.level === "info" ? "info" : "alert"), h("span", null, w.message)))));
  }

  /** Checks a response against the open engagement, then shows what applying it changes. */
  function openResponse(app, data, info) {
    const fileName = (info && info.fileName) || "";
    if (!app.store) {
      B.dialogs.messageDialog("Open the engagement first", "This is a client review response. Open the engagement it belongs to, then open the response again.");
      return;
    }
    const prepared = R.prepareApply(app.store.get(), data);
    if (!prepared.ok) {
      B.dialogs.messageDialog("Review response not imported", h("div", null,
        h("p", null, (fileName ? fileName + " " : "This response ") + "could not be imported. The engagement that was open is unchanged."),
        B.dialogs.issueList(prepared.errors)));
      return;
    }
    importDialog(app, prepared, fileName);
  }

  function importDialog(app, prepared, fileName) {
    const r = prepared.response;
    const n = prepared.counts;
    const items = prepared.items;
    const err = h("p", { class: "error-text", role: "alert", hidden: true });
    const changes = items.filter(it => it.kind === "step" && it.targetValidation && it.targetValidation !== it.currentValidation).length;
    const askable = items.filter(it => (it.verdict === "dispute" || it.verdict === "unsure" || !it.verdict) && it.comment.trim()).length;
    const confirmedSteps = items.filter(it => it.kind === "step" && it.verdict === "confirm").length;
    const locked = items.some(it => it.kind === "step" && it.locked);
    const opt = (id, text, checked) => {
      const input = h("input", { type: "checkbox", id, checked });
      return { input, el: h("label", { class: "check" }, input, h("span", null, text)) };
    };
    const optValidation = opt("cr-apply-validation", "Update step validation: confirmed steps become validated and disputed steps disputed (" + plural(changes, "change") + "). Not sure leaves a step as it is.", true);
    const optQuestions = opt("cr-apply-questions", "Add an open question for each disputed or unconfirmed item with a comment (" + askable + ")", askable > 0);
    const optEvidence = opt("cr-apply-evidence", confirmedSteps ? "Record the review as an evidence source, linked to the " + plural(confirmedSteps, "confirmed step") :
      "Record the review as an evidence source (no step was confirmed, so it is not linked to steps)", true);
    const pack = prepared.pack;
    const rows = items.map(it => h("tr", null,
      h("td", null, h("div", { class: "title-cell" }, it.label), it.renamed ? h("div", { class: "desc" }, "Called \"" + it.packLabel + "\" in the pack") : null),
      h("td", null, it.type),
      h("td", null, verdictBadge(it.verdict)),
      h("td", { class: "cr-comment" }, it.comment || h("span", { class: "muted" }, "None")),
      h("td", null, effectOf(it))));
    const body = h("div", { class: "form-grid cr-dialog" },
      h("p", null, "From " + R.who(r.reviewer) + (r.submittedAt ? ", submitted " + formatDay(r.submittedAt) : "") + ". " +
        (pack ? "Answers to the " + schema.label("reviewFormat", pack.format).toLowerCase() + " pack made for " + (pack.stakeholder.name || "the client") + " on " + formatDay(pack.createdAt) + "." :
          "This engagement has no record of the pack, so the answers are matched by item IDs.")),
      h("div", { class: "stat-row" },
        stat(n.confirm, "Confirmed", "Answers in this response"),
        stat(n.dispute, "Disputed", "Answers in this response"),
        stat(n.unsure, "Not sure", "Answers in this response"),
        stat(n.unanswered, "Not answered", pack ? "Of " + plural(n.total, "item") + " in the pack" : "Items with no verdict or comment")),
      prepared.warnings.length ? h("section", null, h("h3", null, "Check before applying (" + prepared.warnings.length + ")"), warningList(prepared.warnings)) : null,
      r.generalComment ? h("section", null, h("h3", null, "General comment"), h("p", { class: "cr-comment" }, r.generalComment)) : null,
      items.length ? table("Answers in this response", [["Item"], ["Type"], ["Verdict"], ["Comment"], ["Effect"]], rows) : h("p", { class: "empty" }, "This response has no answers."),
      h("fieldset", { class: "cr-options" }, h("legend", { class: "field-label" }, "When applying"), optValidation.el, optQuestions.el, optEvidence.el),
      locked ? h("p", { class: "note" }, "The baseline is locked because a future state is based on it. Applying the review changes only the validation and evidence links of its steps; the steps are not edited or marked as modified.") : null,
      h("p", { class: "note" }, "Applying is one change that Undo reverses."),
      err);
    B.dialogs.openDialog({
      title: "Import a client review", eyebrow: fileName || "Client review", wide: true, body,
      actions: [{ label: "Cancel" }, { label: "Apply the review", variant: "btn-primary", keepOpen: true, onClick: api => {
        const e = app.store.get();
        const payload = R.buildApplyPayload(e, prepared, { validations: optValidation.input.checked, questions: optQuestions.input.checked, evidence: optEvidence.input.checked });
        const nv = payload.validations.length, nq = payload.questions.length;
        showTab();
        const ok = app.dispatch("review/apply", payload, "Client review from " + (r.reviewer.name || "the reviewer") + " applied: " + plural(nv, "step") + " updated, " + plural(nq, "open question") + " added.", err);
        if (ok) api.close("applied");
        return false;
      } }]
    });
  }

  function jsonOpen(app, data, info) {
    let size = 0;
    try { size = JSON.stringify(data).length; } catch (_) { size = Infinity; }
    if (size > schema.LIMITS.reviewResponseBytes) {
      throw new Error("This review response is larger than the " + Math.round(schema.LIMITS.reviewResponseBytes / 1048576) + " MB limit for responses.");
    }
    openResponse(app, data, info);
  }

  /* An .xlsx file is a review pack when it has the hidden bpmviz-pack sheet, or About and Review sheets that carry a pack reference. */
  async function isReviewWorkbook(bytes) {
    if (!bytes || bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
    try {
      const pkg = await B.zip.openZipAsync(bytes, { inflateRaw: B.files.inflateRaw });
      const wb = await pkg.readText("xl/workbook.xml");
      if (!wb) return false;
      if (/<(?:\w+:)?sheet\b[^>]*\bname="bpmviz-pack"/i.test(wb)) return true;
      if (!/<(?:\w+:)?sheet\b[^>]*\bname="About"/i.test(wb) || !/<(?:\w+:)?sheet\b[^>]*\bname="Review"/i.test(wb)) return false;
      R.responseFromWorkbook(await B.xlsx.readWorkbookAsync(bytes, { inflateRaw: B.files.inflateRaw }));
      return true;
    } catch (_) {
      return false;
    }
  }

  async function workbookOpen(app, file, bytes) {
    const wb = await B.xlsx.readWorkbookAsync(bytes, { inflateRaw: B.files.inflateRaw });
    const response = R.responseFromWorkbook(wb);
    if (!response.submittedAt && file && Number.isFinite(file.lastModified) && file.lastModified > 0) response.submittedAt = new Date(file.lastModified).toISOString();
    openResponse(app, response, { fileName: file ? file.name : "" });
  }

  /* ---------- Records tab ---------- */

  function stepLink(app, it) {
    if (it.kind !== "step") return h("span", { class: "title-cell" }, it.label);
    return h("button", { type: "button", class: "link-btn", on: { click: () => app.gotoStep(it.modelId, it.nodeId) } }, it.label);
  }

  function renderTab(panel, ctx) {
    const app = ctx.app;
    const e = ctx.engagement;
    const packs = e.reviewPacks || [];
    const list = e.reviews || [];
    const sum = R.summarize(e, { includeSensitive: true, includeUnreviewedAi: true });
    const importBtn = h("button", { type: "button", class: "btn", id: "cr-import" }, icon("upload"), "Import a response");
    importBtn.addEventListener("click", () => B.files.pickFile(".json,.xlsx").then(f => { if (f) app.openFile(f); }));
    const makeBtn = h("button", { type: "button", class: "btn btn-primary", id: "cr-make" }, icon("plus"), "Make a review pack");
    makeBtn.addEventListener("click", () => packDialog(app, ctx));
    const responsesTo = id => list.filter(r => r.packId === id).length;
    const disputed = sum.steps.dispute + sum.findings.dispute;
    panel.append(
      h("div", { class: "cr-intro" },
        h("p", { class: "small" }, "Send steps and findings to a client stakeholder to confirm, dispute or mark as not sure. A pack is a web page or an Excel workbook that works without BPMVIZ. Import the answers here or with Open: confirmed steps become validated, disputed steps are marked disputed, and comments can become open questions."),
        h("div", { class: "form-actions" }, importBtn, makeBtn)),
      h("div", { class: "stat-row" },
        stat(packs.length, "Review packs made", packs.length ? "Latest " + formatDay(packs[packs.length - 1].createdAt) : "None yet"),
        stat(list.length, "Responses received", sum.reviewers.length ? plural(sum.reviewers.length, "reviewer") : "None yet"),
        stat(sum.steps.confirm, "Steps confirmed", "Latest answer per step"),
        stat(disputed, "Items disputed", "Latest answer per step or finding")));
    // Packs
    panel.appendChild(h("section", { class: "card", "aria-labelledby": "cr-packs-h" }, h("h3", { id: "cr-packs-h" }, "Review packs (" + packs.length + ")"),
      packs.length ? table("Review packs", [["Prepared for"], ["Format"], ["Made"], ["Items", "num"], ["Responses", "num"], [h("span", { class: "sr-only" }, "Actions")]],
        packs.slice().reverse().map(p => h("tr", null,
          h("td", null, h("div", { class: "title-cell" }, R.who(p.stakeholder)), p.note ? h("div", { class: "desc" }, p.note) : null),
          h("td", null, schema.label("reviewFormat", p.format)),
          h("td", null, formatDay(p.createdAt)),
          h("td", { class: "num" }, String(p.items.length)),
          h("td", { class: "num" }, String(responsesTo(p.id))),
          h("td", { class: "actions" },
            h("button", { type: "button", class: "btn btn-ghost", on: { click: () => downloadAgain(app, p) } }, icon("download"), h("span", null, "Download again"), h("span", { class: "sr-only" }, " for " + (p.stakeholder.name || "the client"))),
            h("button", { type: "button", class: "btn btn-ghost btn-danger", on: { click: () => {
              B.dialogs.confirmDialog("Delete this review pack?", "The record of the pack is removed. Responses already imported stay, and a response to this pack that arrives later can still be imported; it is then matched by item IDs.", "Delete pack", true)
                .then(ok => { if (ok) ctx.dispatch("review/deletePack", { id: p.id }, "Review pack deleted."); });
            } } }, icon("trash"), h("span", { class: "sr-only" }, "Delete the pack for " + (p.stakeholder.name || "the client"))))))) :
        h("p", { class: "small muted" }, "No packs yet. Make one from here or from the Present bar.")));
    // Responses
    panel.appendChild(h("section", { class: "card", "aria-labelledby": "cr-reviews-h" }, h("h3", { id: "cr-reviews-h" }, "Responses received (" + list.length + ")"),
      list.length ? table("Responses received", [["Reviewer"], ["Submitted"], ["Answers"], ["Applied"], [h("span", { class: "sr-only" }, "Actions")]],
        list.slice().reverse().map(r => {
          const c = { confirm: 0, dispute: 0, unsure: 0 };
          r.entries.forEach(en => { c[en.verdict] = (c[en.verdict] || 0) + 1; });
          const applied = [plural(r.applied.validations, "validation change"), plural(r.applied.questions, "open question")]
            .concat(r.applied.evidenceId ? ["evidence source"] : []).join(", ");
          return h("tr", null,
            h("td", null, h("div", { class: "title-cell" }, R.who(r.reviewer)), r.generalComment ? h("div", { class: "desc cr-comment" }, r.generalComment) : null),
            h("td", null, formatDay(r.submittedAt || r.receivedAt), h("div", { class: "desc" }, schema.label("reviewFormat", r.source) + ", imported " + formatDay(r.receivedAt))),
            h("td", null, c.confirm + " confirmed, " + c.dispute + " disputed, " + c.unsure + " not sure"),
            h("td", null, applied),
            h("td", { class: "actions" }, h("button", { type: "button", class: "btn btn-ghost btn-danger", on: { click: () => {
              B.dialogs.confirmDialog("Delete this response?", "The answers are removed from the engagement. Validation already set on steps, open questions and the evidence source stay as they are; use Undo right after an import to reverse all of it.", "Delete response", true)
                .then(ok => { if (ok) ctx.dispatch("review/delete", { id: r.id }, "Response deleted."); });
            } } }, icon("trash"), h("span", { class: "sr-only" }, "Delete the response from " + (r.reviewer.name || "the reviewer")))));
        })) :
        h("p", { class: "small muted" }, "No responses yet. Open a response file, or a filled-in Excel pack, to import it.")));
    // Latest answer per item
    panel.appendChild(h("section", { class: "card", "aria-labelledby": "cr-items-h" }, h("h3", { id: "cr-items-h" }, "Latest answer per item (" + sum.items.length + ")"),
      sum.items.length ? [
        h("p", { class: "small" }, "When reviewers disagree, the answer submitted last is current; earlier answers are listed with it."),
        table("Latest answer per item", [["Item"], ["Type"], ["Latest answer"], ["Comment"], ["Earlier answers"]],
          sum.items.map(it => {
            const a = it.answer;
            const earlier = a.history.slice(0, -1);
            return h("tr", null,
              h("td", null, stepLink(app, it), it.lane ? h("div", { class: "desc" }, it.lane) : null),
              h("td", null, it.type),
              h("td", null, verdictBadge(a.verdict), h("div", { class: "desc" }, R.who(a.reviewer) + (a.at ? ", " + formatDay(a.at) : ""))),
              h("td", { class: "cr-comment" }, a.comment || h("span", { class: "muted" }, "None")),
              h("td", null, earlier.length ? h("ul", { class: "plain-list small" }, earlier.map(x => h("li", null,
                (x.reviewer.name || "Reviewer not named") + ": " + schema.label("reviewVerdict", x.verdict) + (x.at ? ", " + formatDay(x.at) : "")))) : h("span", { class: "muted" }, "None")));
          }))] :
        h("p", { class: "small muted" }, "Answers appear here once a response is imported.")));
  }

  /* ---------- Process side panel and handoff ---------- */

  function drawerSection(ctx, model, node) {
    syncTab(ctx.engagement);
    const latest = R.latestVerdicts(ctx.engagement).get(R.stepRef(model.id, node.id));
    if (!latest) return null;
    const earlier = latest.history.slice(0, -1);
    const validation = (node.provenance && node.provenance.validation) || "unvalidated";
    return h("section", { class: "side-section", id: "cr-drawer", "aria-labelledby": "cr-drawer-h" },
      h("h3", { id: "cr-drawer-h" }, "Client review"),
      h("div", { class: "cr-answer" }, verdictBadge(latest.verdict), h("span", { class: "small" }, R.who(latest.reviewer) + (latest.at ? ", " + formatDay(latest.at) : ""))),
      latest.comment ? h("p", { class: "small cr-comment" }, latest.comment) : null,
      earlier.length ? h("ul", { class: "plain-list small", "aria-label": "Earlier answers" }, earlier.map(x => h("li", null,
        "Earlier: " + (x.reviewer.name || "Reviewer not named") + ", " + schema.label("reviewVerdict", x.verdict).toLowerCase() + (x.at ? " on " + formatDay(x.at) : "") + (x.comment ? ". " + x.comment : "")))) : null,
      h("p", { class: "note" }, "Latest of " + plural(latest.history.length, "answer") + ". Validation of this step: " + schema.label("validation", validation).toLowerCase() + "."));
  }

  function handoffSection(hd, ctx) {
    const e = ctx.engagement;
    syncTab(e);
    if (!(e.reviews || []).length) return null;
    const sum = R.summarize(e, { includeSensitive: ctx.includeSensitive, includeUnreviewedAi: ctx.includeUnreviewedAi });
    const open = sum.items.filter(it => it.answer.verdict !== "confirm");
    const count = b => b.confirm + " confirmed, " + b.dispute + " disputed and " + b.unsure + " not sure";
    return h("section", { class: "cr-handoff", id: "hd-client-review", "aria-labelledby": "hd-cr-h" },
      h("h2", { id: "hd-cr-h" }, "Client review"),
      h("p", null, plural(sum.reviews, "response") + " received from " + sum.reviewers.join("; ") + "."),
      h("p", null, "Latest answer per item: steps " + count(sum.steps) + "; findings " + count(sum.findings) + "."),
      open.length ? [h("h3", null, "Disputed or not sure (" + open.length + ")"),
        h("div", { class: "table-wrap" }, h("table", { class: "table" },
          h("thead", null, h("tr", null, ["Item", "Type", "Answer", "Reviewer", "Comment"].map(c => h("th", { scope: "col" }, c)))),
          h("tbody", null, open.map(it => h("tr", null,
            h("td", null, it.label), h("td", null, it.type), h("td", null, schema.label("reviewVerdict", it.answer.verdict)),
            h("td", null, (it.answer.reviewer.name || "Not named") + (it.answer.at ? ", " + formatDay(it.answer.at) : "")),
            h("td", { class: "cr-comment" }, it.answer.comment || "")))))) ] :
        h("p", null, sum.items.length ? "Every reviewed item in this summary was confirmed." : "The answers concern findings that are left out of this summary."));
  }

  /* ---------- Registration ---------- */

  const X = B.ext;

  /*
   * The Client review records tab appears once the open engagement has a
   * review pack or a response, or once a pack is made or a response applied
   * in this session; it then stays for the session. Making a pack starts from
   * the Present bar and importing from Open, so nothing is out of reach before.
   * syncTab runs from the Process side panel (shown when an engagement opens)
   * and the handoff; showTab runs before this feature's own commands, so the
   * Records view that renders after the command already lists the tab.
   */
  let tabShown = false;
  function showTab() {
    if (tabShown) return;
    tabShown = true;
    X.registerRecordsTab({ id: "client-review", order: 10, label: "Client review", count: e => (e.reviews || []).length, render: renderTab });
  }
  function syncTab(e) {
    if (!tabShown && e && ((e.reviewPacks || []).length || (e.reviews || []).length)) showTab();
  }

  X.registerPresentAction({ id: "client-review", order: -10, icon: "person", label: "Client review pack", run: (app, ctx) => packDialog(app, ctx) });
  X.registerJsonHandler({ id: "client-review", schema: schema.REVIEW_RESPONSE_ID, open: jsonOpen });
  X.registerFileHandler({ id: "client-review", extensions: [".xlsx"], priority: 10, maxBytes: schema.LIMITS.fileBytes, probe: isReviewWorkbook, open: workbookOpen });
  X.registerDrawerSection({ id: "client-review", where: "step", render: drawerSection });
  X.registerDrawerSection({ id: "client-review-overview", where: "overview", render: ctx => { syncTab(ctx.engagement); return null; } });
  X.registerHandoffSection({ id: "client-review", after: "evidence", render: handoffSection });

  B.clientReview = { packDialog, openResponse, isReviewWorkbook, downloadAgain, showTab };
})(typeof globalThis !== "undefined" ? globalThis : this);
