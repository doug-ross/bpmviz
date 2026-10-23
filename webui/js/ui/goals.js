/*
 * AIxRay goals: the Value goals card in the value workspace, the goal dialog,
 * the "Goals served" section of the opportunity dialog, the Goals column on
 * the opportunity register and the goals section of the report. The data and
 * commands are in lib/goals.js (goal/save, goal/delete, goal/markReviewed,
 * goal/applySuggestions); see docs/goals.md.
 */
(function (root) {
  "use strict";
  const B = root.AIxRay = root.AIxRay || {};
  const { h, icon, clear } = B.dom;
  const { schema, util, goals } = B;
  const { field, input, textarea, select, aiOrigin } = B.forms;
  const { openDialog, confirmDialog } = B.dialogs;
  const badge = (t, tone) => B.drawer.badge(t, tone);
  const BASIS_TONE = { illustrative: "warning", supplied: "info", observed: "success", validated: "success" };

  const opportunitiesOf = e => (e.records || []).filter(r => r.kind === "opportunity" && r.status !== "dropped");
  const numberOf = el => el.value.trim() === "" ? null : Number(el.value);

  /** Opens the goal form for a new goal, or for `goal` when given. */
  function goalDialog(app, goal) {
    const e = app.store.get();
    const g = Object.assign({ kind: "cost", title: "", metric: "", baseline: null, target: null, unit: "", by: "", owner: "",
      basis: "supplied", source: "", quote: "", note: "", sensitive: false }, goal || {});
    const title = input(g.title, { id: "goal-title", maxlength: 300 });
    const kind = select("goalKind", g.kind, { id: "goal-kind" });
    const metric = input(g.metric, { id: "goal-metric", maxlength: 300, placeholder: "For example, cost per claim" });
    const baseline = input(util.isFiniteNumber(g.baseline) ? g.baseline : "", { id: "goal-baseline", type: "number", step: "any", inputmode: "decimal" });
    const target = input(util.isFiniteNumber(g.target) ? g.target : "", { id: "goal-target", type: "number", step: "any", inputmode: "decimal" });
    const unit = input(g.unit, { id: "goal-unit", maxlength: 40, placeholder: "$, days, % of claims" });
    const by = input(g.by, { id: "goal-by", type: "date" });
    const owner = input(g.owner, { id: "goal-owner", maxlength: 200 });
    const basis = select("assumptionStatus", g.basis, { id: "goal-basis" });
    const source = input(g.source, { id: "goal-source", maxlength: 500, placeholder: "Who said it, or where it is written down" });
    const quote = textarea(g.quote, 2); quote.id = "goal-quote"; quote.maxLength = 300;
    const note = textarea(g.note, 2); note.id = "goal-note";
    const sensitive = h("input", { type: "checkbox", id: "goal-sensitive", checked: g.sensitive });
    const reviewed = g.generated ? h("input", { type: "checkbox", id: "goal-ai-reviewed", checked: g.generated.reviewed }) : null;
    const served = new Set(g.id ? goals.servedBy(e, g.id).map(r => r.id) : []);
    const opps = opportunitiesOf(e);
    const boxes = opps.map(r => ({ r, box: h("input", { type: "checkbox", checked: served.has(r.id), dataset: { record: r.id } }) }));
    const err = h("p", { class: "error-text", role: "alert", hidden: true });

    const body = h("form", { class: "form-grid", novalidate: true, id: "goal-form" },
      g.generated ? aiOrigin(g.generated, reviewed, "I checked this goal with the client") : null,
      h("p", { class: "small muted" }, "What the client counts as value for this work. Ask them: is this what value means to you?"),
      field("Goal", title, "For example, cut the cost of handling a claim."),
      h("div", { class: "field-row" }, field("Kind", kind), field("Measured by", metric)),
      h("div", { class: "field-row" }, field("Today", baseline), field("Target", target), field("Unit", unit)),
      h("div", { class: "field-row" }, field("By", by), field("Owner", owner), field("Basis", basis)),
      field("Source", source),
      field("In the client's words", quote),
      field("Note", note),
      h("label", { class: "check" }, sensitive, "Sensitive (kept out of reports and exports unless you include it)"),
      opps.length ? h("fieldset", { class: "form-grid goal-served" },
        h("legend", { class: "field-label" }, "Opportunities that serve this goal"),
        boxes.map(x => h("label", { class: "check" }, x.box, x.r.title))) :
        h("p", { class: "small muted" }, "No opportunities yet. Link this goal from an opportunity when you add one."),
      err);
    body.addEventListener("submit", ev => ev.preventDefault());

    const actions = [];
    if (g.id) {
      actions.push({ label: "Delete", variant: "btn-danger", keepOpen: true, onClick: api => {
        confirmDialog("Delete this goal?", "\"" + g.title + "\" will be deleted and unlinked from its opportunities. You can undo this from the menu.", "Delete", true).then(ok => {
          if (ok && app.dispatch("goal/delete", { id: g.id }, "Goal deleted")) api.close();
        });
        return false;
      } });
    }
    actions.push({ label: "Cancel" });
    actions.push({ label: g.id ? "Save goal" : "Add goal", variant: "btn-primary", keepOpen: true, onClick: api => {
      if (!title.value.trim()) { err.hidden = false; err.textContent = "Give the goal a title."; title.focus(); return false; }
      const payload = {
        goal: {
          id: g.id, kind: kind.value, title: title.value, metric: metric.value, baseline: numberOf(baseline), target: numberOf(target),
          unit: unit.value, by: by.value, owner: owner.value, basis: basis.value, source: source.value, quote: quote.value, note: note.value,
          sensitive: sensitive.checked
        },
        servedByRecordIds: boxes.filter(x => x.box.checked).map(x => x.r.id),
        aiReviewed: reviewed ? reviewed.checked : undefined
      };
      if (app.dispatch("goal/save", payload, g.id ? "Goal saved" : "Goal added", err)) api.close();
      return false;
    } });
    return openDialog({ title: g.id ? "Edit goal" : "Add a value goal", eyebrow: "Value goals", wide: true, body, actions });
  }

  function goalRow(app, e, g) {
    const by = goals.servedBy(e, g.id);
    const edit = h("button", { type: "button", class: "btn", dataset: { goal: g.id }, on: { click: () => goalDialog(app, g) } }, "Edit");
    return h("tr", { dataset: { goal: g.id } },
      h("td", null, h("div", { class: "title-cell" }, g.title,
        goals.isUnreviewedAi(g) ? [" ", badge("AI draft", "purple")] : null, g.sensitive ? [" ", badge("Sensitive", "warning")] : null),
        g.quote ? h("div", { class: "desc" }, "\u201c" + g.quote + "\u201d") : null,
        g.source ? h("div", { class: "desc" }, "Source: " + g.source) : null),
      h("td", null, schema.label("goalKind", g.kind)),
      h("td", null, g.metric || h("span", { class: "muted" }, "Not set")),
      h("td", null, goals.targetText(g) || h("span", { class: "muted" }, "Not set"), g.by ? h("div", { class: "desc" }, "By " + g.by) : null),
      h("td", null, badge(schema.label("assumptionStatus", g.basis), BASIS_TONE[g.basis])),
      h("td", null, by.length ? by.map(r => r.title).join("; ") : h("span", { class: "muted" }, "No opportunity yet")),
      h("td", null, edit));
  }

  /* The Value goals card in the value workspace. */
  function renderGoalsSection(ctx) {
    const app = ctx.app, e = ctx.engagement;
    if (!e) return null;
    const list = Array.isArray(e.goals) ? e.goals : [];
    const drafts = list.filter(goals.isUnreviewedAi);
    const addBtn = h("button", { type: "button", class: "btn btn-primary", id: "goal-add", on: { click: () => goalDialog(app) } }, icon("plus"), "Add a goal");
    const aiBtn = B.aiPanel && B.aiPanel.enabled ? h("button", { type: "button", class: "btn", id: "goal-ai",
      on: { click: () => B.aiPanel.openTask(app, "goals") } }, icon("agent"), "Suggest goals from documents with AI") : null;
    const reviewBtn = drafts.length ? h("button", { type: "button", class: "btn", id: "goal-mark-reviewed",
      on: { click: () => confirmDialog("Mark " + drafts.length + " AI goal" + (drafts.length === 1 ? "" : "s") + " as reviewed?",
        "Do this once you have checked " + (drafts.length === 1 ? "it" : "them") + " with the client. Reviewed goals appear in reports and exports.", "Mark reviewed")
        .then(ok => { if (ok) ctx.dispatch("goal/markReviewed", { ids: drafts.map(g => g.id), reviewed: true }, "Goals marked as reviewed"); }) } },
      "Mark AI goals reviewed") : null;
    const unserved = list.filter(g => !goals.servedBy(e, g.id).length).length;
    return h("section", { class: "card", id: "goal-section", "aria-labelledby": "goal-h" },
      h("h3", { id: "goal-h" }, "Value goals"),
      h("p", { class: "note" }, "What the client counts as value: more revenue, a lower cost, a new capability, less risk or a better experience. Link each opportunity to the goals it serves, so the business case answers the question the client is asking."),
      list.length ? h("div", { class: "table-wrap" }, h("table", { class: "table", id: "goal-table" },
        h("caption", { class: "sr-only" }, "Value goals"),
        h("thead", null, h("tr", null, ["Goal", "Kind", "Measured by", "Target", "Basis", "Served by", ""].map(t => h("th", { scope: "col" }, t)))),
        h("tbody", null, list.map(g => goalRow(app, e, g))))) :
        h("p", { class: "small muted", id: "goal-empty" }, "No goals yet. Add the outcomes the client named in the workshop, or draft them from the meeting notes with AI."),
      drafts.length ? h("p", { class: "small" }, drafts.length + " AI draft" + (drafts.length === 1 ? "" : "s") + " to review. Reports leave " + (drafts.length === 1 ? "it" : "them") + " out until then.") : null,
      unserved && list.length ? h("p", { class: "small muted" }, unserved + " goal" + (unserved === 1 ? " has" : "s have") + " no opportunity serving " + (unserved === 1 ? "it" : "them") + " yet.") : null,
      h("div", { class: "form-actions" }, addBtn, aiBtn, reviewBtn));
  }

  B.ext.registerValueSection({ id: "goals", order: -10, render: renderGoalsSection });

  /* "Goals served" in the opportunity dialog. */
  B.ext.registerRecordDialogSection({
    id: "goals-served", kinds: ["opportunity"],
    render(record, ctx) {
      const e = ctx.engagement;
      const list = (e && Array.isArray(e.goals)) ? e.goals : [];
      const chosen = new Set((record.opportunity && record.opportunity.goalIds) || []);
      const boxes = list.map(g => ({ g, box: h("input", { type: "checkbox", checked: chosen.has(g.id), dataset: { goal: g.id } }) }));
      const el = h("fieldset", { class: "form-grid goal-served", id: "goal-served", style: { border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "var(--space-3)" } },
        h("legend", { class: "field-label" }, "Goals served"),
        list.length ? boxes.map(x => h("label", { class: "check" }, x.box, x.g.title, " ", h("span", { class: "muted small" }, schema.label("goalKind", x.g.kind)))) :
          h("p", { class: "small muted" }, "No value goals yet. Add them in the Value tab."));
      return { el, collect: () => (list.length || chosen.size ? { goalIds: boxes.filter(x => x.box.checked).map(x => x.g.id) } : null) };
    }
  });

  B.ext.registerOpportunityColumn({
    id: "goals", header: "Goals", after: "Wave",
    cell(record, ctx) {
      const names = goals.goalsFor(ctx.engagement, record, { includeSensitive: true, includeUnreviewedAi: true }).map(g => g.title);
      return names.length ? names.join("; ") : h("span", { class: "muted" }, "None linked");
    }
  });

  /* The goals in the report, right after the scope. */
  B.ext.registerHandoffSection({
    id: "goals", after: "scope",
    render(hd, ctx) {
      const e = ctx.engagement;
      const list = goals.visibleGoals(e, { includeSensitive: ctx.includeSensitive, includeUnreviewedAi: ctx.includeUnreviewedAi });
      if (!list.length) return null;
      return [
        h("h2", null, "Value goals"),
        h("p", null, "What the client counts as value for this work, and the opportunities that serve each goal."),
        h("div", { class: "table-wrap" }, h("table", { class: "table", id: "goal-report" },
          h("thead", null, h("tr", null, ["Goal", "Kind", "Measured by", "Target", "Basis", "Served by"].map(t => h("th", { scope: "col" }, t)))),
          h("tbody", null, list.map(g => {
            const by = goals.servedBy(e, g.id).filter(r => (ctx.includeSensitive || !r.sensitive) && (ctx.includeUnreviewedAi || !(r.generated && !r.generated.reviewed)));
            return h("tr", null, h("td", null, g.title), h("td", null, schema.label("goalKind", g.kind)), h("td", null, g.metric || "Not set"),
              h("td", null, [goals.targetText(g) || "Not set", g.by ? " by " + g.by : ""].join("")), h("td", null, schema.label("assumptionStatus", g.basis)),
              h("td", null, by.length ? by.map(r => r.title).join("; ") : "No opportunity yet"));
          }))))
      ];
    }
  });

  B.ext.registerRefreshEvent("goal/");
  B.ext.registerRefreshEvent("checkpoint/");

  B.goalsUi = { goalDialog, renderGoalsSection };
})(typeof globalThis !== "undefined" ? globalThis : this);
