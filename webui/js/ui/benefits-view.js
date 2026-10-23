/*
 * AIxRay benefits-view: the Benefits section in the value workspace and its
 * handoff summary. Compares a baseline event log against one taken after a
 * change and checks opportunities' modeled value cases against what the
 * logs actually measured, net of a comparison group when one is recorded
 * (two logs of a team that did not get the change). Without event logs, delivery teams record
 * checkpoints by hand (checkpoint/save, checkpoint/delete in lib/checkpoints.js)
 * and see them against the same business case. Linking two existing event
 * logs together goes through the foundation's dataset/update command.
 * See docs/benefits.md.
 */
(function (root) {
  "use strict";
  const B = root.AIxRay = root.AIxRay || {};
  const { h, clear } = B.dom;
  const { util, units, schema, benefits, valueCase } = B;
  const badge = (t, tone) => B.drawer.badge(t, tone);

  const STATUS_LABEL = {
    met: "Met", partial: "Partially met", "not-yet": "Not yet",
    worse: "Worse", "not-measurable": "Not measurable"
  };
  const STATUS_TONE = { met: "success", partial: "info", "not-yet": "warning", worse: "error", "not-measurable": "" };
  const BASIS_TONE = { illustrative: "warning", supplied: "info", observed: "success", validated: "success" };

  /** Datasets marked "after" with a recorded baseline, paired with the baseline dataset itself. */
  function pairsOf(e) {
    const datasets = (e && e.datasets) || [];
    return datasets.filter(d => d.role === "after" && d.comparesToDatasetId)
      .map(d => ({ after: d, baseline: datasets.find(x => x.id === d.comparesToDatasetId) }))
      .filter(p => p.baseline);
  }

  function unitsCtx(dataset, e) {
    return { timeBasis: (dataset && dataset.timeBasis) || (e.meta && e.meta.timeBasis), currency: e.meta && e.meta.currency };
  }

  function minuteText(stats, dataset, e) {
    return stats ? units.formatMeasure(stats.p50, "minute", unitsCtx(dataset, e)) : "Not measured";
  }

  function pct(v) {
    return util.isFiniteNumber(v) ? util.formatNumber(v * 100, 1) + "%" : "Not measured";
  }

  function count(v, digits) {
    return util.isFiniteNumber(v) ? util.formatNumber(v, digits == null ? 2 : digits) : "Not measured";
  }

  /* "X to Y (change)", or a single "Not measured" when neither log has a figure. */
  function beforeAfter(beforeText, afterText, change) {
    return beforeText === "Not measured" && afterText === "Not measured" ? "Not measured" : beforeText + " to " + afterText + (change || "");
  }

  function changeText(before, after) {
    if (!util.isFiniteNumber(before) || !util.isFiniteNumber(after)) return "";
    return " (" + units.formatPercentChange(before, after) + ")";
  }

  /* A step's change net of the comparison group, in minutes: "5 min faster". */
  function netChangeText(minutes, pair, e) {
    if (!util.isFiniteNumber(minutes)) return "Not measured";
    if (Math.abs(minutes) < 0.05) return "No change";
    return units.formatMeasure(Math.abs(minutes), "minute", unitsCtx(pair.baseline, e)) + (minutes < 0 ? " faster" : " slower");
  }

  /* One row of the step-by-step comparison table. */
  function stepRow(s, pair, e, withGroup) {
    const durBefore = s.duration.before ? s.duration.before.p50 : null;
    const durAfter = s.duration.after ? s.duration.after.p50 : null;
    const sojBefore = s.sojourn.before ? s.sojourn.before.p50 : null;
    const sojAfter = s.sojourn.after ? s.sojourn.after.p50 : null;
    return h("tr", null,
      h("td", null, h("div", { class: "title-cell" }, s.label),
        s.smallSample ? h("div", { class: "desc" }, "Fewer than " + benefits.SMALL_SAMPLE_MIN + " visits in one of the logs.") : null,
        !s.duration.after && s.duration.before ? h("div", { class: "desc" }, "Not visited in the after log.") : null),
      h("td", { class: "num" }, beforeAfter(minuteText(s.duration.before, pair.baseline, e), minuteText(s.duration.after, pair.after, e), changeText(durBefore, durAfter))),
      h("td", { class: "num" }, beforeAfter(minuteText(s.sojourn.before, pair.baseline, e), minuteText(s.sojourn.after, pair.after, e), changeText(sojBefore, sojAfter))),
      h("td", { class: "num" }, beforeAfter(pct(s.reworkRate.before), pct(s.reworkRate.after))),
      h("td", { class: "num" }, beforeAfter(pct(s.caseShare.before), pct(s.caseShare.after))),
      h("td", { class: "num" }, beforeAfter(count(s.visitsPerCase.before), count(s.visitsPerCase.after))),
      withGroup ? h("td", { class: "num" }, netChangeText(s.group && s.group.netChange, pair, e)) : null);
  }

  function overallFacts(cmp, pair, e) {
    const o = cmp.overall;
    const day = v => (v ? String(v).slice(0, 10) : "?");
    const period = p => day(p.start) + " to " + day(p.end) + " (" + util.formatNumber(p.days || 0, 0) + " days)";
    return h("dl", { class: "facts" },
      h("dt", null, "Baseline period"), h("dd", null, period(o.period.before)),
      h("dt", null, "After period"), h("dd", null, period(o.period.after)),
      h("dt", null, "Cases in the log"), h("dd", null, o.cases.before + " baseline, " + o.cases.after + " after"),
      h("dt", null, "Annualized volume"), h("dd", null,
        (util.isFiniteNumber(o.annualizedVolume.before) ? units.formatMeasure(o.annualizedVolume.before, "casesPerYear", {}) : "Not recorded") +
        " baseline, " + (util.isFiniteNumber(o.annualizedVolume.after) ? units.formatMeasure(o.annualizedVolume.after, "casesPerYear", {}) : "Not recorded") + " after"),
      h("dt", null, "Median cycle time"), h("dd", null,
        minuteText(o.cycleTime.before, pair.baseline, e) + " baseline, " + minuteText(o.cycleTime.after, pair.after, e) + " after" +
        changeText(o.cycleTime.before && o.cycleTime.before.p50, o.cycleTime.after && o.cycleTime.after.p50)));
  }

  function expectedVsRealizedTable(rows, e) {
    if (!rows.length) return null;
    const c = { currency: e.meta && e.meta.currency };
    const figure = f => f ? h("span", null, units.formatMeasure(f.value, f.unit, c), " ", badge(schema.label("assumptionStatus", f.basis) || f.basis, BASIS_TONE[f.basis])) : h("span", { class: "muted" }, "Not calculated");
    return h("div", { class: "table-wrap" }, h("table", { class: "table" },
      h("caption", { class: "sr-only" }, "Expected versus measured change per opportunity"),
      h("thead", null, h("tr", null, ["Opportunity", "Expected (modeled)", "Measured change", "Status"].map(t => h("th", { scope: "col" }, t)))),
      h("tbody", null, rows.map(r => h("tr", null,
        h("td", null, h("div", { class: "title-cell" }, r.title), r.notes.length ? h("div", { class: "desc" }, r.notes.join(" ")) : null),
        h("td", { class: "num" }, figure(r.expected)),
        h("td", { class: "num" }, figure(r.realized),
          r.unadjusted ? h("div", { class: "desc" }, "Before the comparison group: " + units.formatMeasure(r.unadjusted.value, r.unadjusted.unit, c)) : null),
        h("td", null, badge(STATUS_LABEL[r.status], STATUS_TONE[r.status])))))));
  }

  /*
   * The comparison group under a comparison: which two logs it is, or a form
   * to choose them from the project's other event logs.
   */
  function groupBlock(pair, cmp, e, ctx) {
    const id = pair.after.id;
    const g = pair.after.comparisonGroup;
    const datasets = e.datasets || [];
    const intro = "Optional. Two event logs from a team or region that did not get the change, one from each period. Its own change is taken out of the measured change, so what changed for everyone, such as the season or the mix of work, is not counted.";
    if (g) {
      const named = x => { const d = datasets.find(y => y.id === x); return d ? d.name : "a log no longer in the project"; };
      const cg = cmp.comparisonGroup;
      const groupBaseline = datasets.find(d => d.id === g.baselineId);
      const cycle = cg && cg.usable && cg.cycleTime.before && cg.cycleTime.after ?
        " Its median cycle time went from " + minuteText(cg.cycleTime.before, groupBaseline, e) + " to " + minuteText(cg.cycleTime.after, groupBaseline, e) +
          changeText(cg.cycleTime.before.p50, cg.cycleTime.after.p50) + "." : "";
      const remove = h("button", { class: "btn", type: "button", id: "bv-group-remove-" + id }, "Remove the comparison group");
      remove.addEventListener("click", () => ctx.dispatch("dataset/update", { id, patch: { comparisonGroup: null } }, "Comparison group removed"));
      return h("div", { class: "form-grid bv-group", id: "bv-group-" + id },
        h("p", { class: "section-title benefits-sub" }, "Comparison group"),
        h("p", { class: "small" }, "Logs from a team that did not get the change: " + named(g.baselineId) + " (before) and " + named(g.afterId) + " (after)." + cycle),
        h("div", { class: "form-actions" }, remove));
    }
    const others = datasets.filter(d => d.id !== id && d.id !== pair.baseline.id);
    if (others.length < 2) {
      return h("p", { class: "small muted", id: "bv-group-" + id }, "To take out what changed for everyone, such as the season, import two event logs from a team that did not get the change, one for each period, and use them as a comparison group.");
    }
    const option = d => h("option", { value: d.id }, d.name);
    const before = h("select", { class: "select", id: "bv-group-before-" + id }, others.map(option));
    const after = h("select", { class: "select", id: "bv-group-after-" + id }, others.map(option));
    after.value = others[1].id;
    const err = h("p", { class: "error-text", hidden: true });
    const save = h("button", { class: "btn", type: "button", id: "bv-group-save-" + id }, "Use as the comparison group");
    save.addEventListener("click", () => ctx.dispatch("dataset/update",
      { id, patch: { comparisonGroup: { baselineId: before.value, afterId: after.value } } }, "Comparison group recorded", err));
    return h("div", { class: "form-grid bv-group", id: "bv-group-" + id },
      h("p", { class: "section-title benefits-sub" }, "Comparison group"),
      h("p", { class: "small" }, intro),
      h("div", { class: "field-row" },
        h("div", { class: "field" }, h("label", { for: before.id }, "Comparison group, before the change"), before),
        h("div", { class: "field" }, h("label", { for: after.id }, "Comparison group, after the change"), after)),
      h("div", { class: "form-actions" }, save),
      err);
  }

  function pairCard(pair, e, ctx) {
    const cmp = benefits.compareDatasets(e, pair.baseline.id, pair.after.id);
    const withGroup = !!(cmp.comparisonGroup && cmp.comparisonGroup.usable);
    const vs = benefits.expectedVsRealized(e, pair.baseline.id, pair.after.id);
    const removeBtn = h("button", { class: "btn", type: "button" }, "Remove this comparison");
    removeBtn.addEventListener("click", () => ctx.dispatch("dataset/update", { id: pair.after.id, patch: { comparesToDatasetId: null } }, "Comparison removed"));
    return h("div", { class: "benefits-pair" },
      h("h4", { class: "benefits-pair-title" }, pair.after.name + " compared to " + pair.baseline.name),
      h("p", { class: "small" },
        "Baseline: ", badge(schema.label("dataStatus", pair.baseline.dataStatus), ""), " \u00b7 After: ",
        badge(schema.label("dataStatus", pair.after.dataStatus), "")),
      cmp.overall ? overallFacts(cmp, pair, e) : null,
      vs.length ? [h("p", { class: "section-title benefits-sub" }, "Expected versus measured change"), expectedVsRealizedTable(vs, e)] : null,
      h("p", { class: "section-title benefits-sub" }, "Step by step"),
      cmp.steps.length ? h("div", { class: "table-wrap" }, h("table", { class: "table" },
        h("caption", { class: "sr-only" }, "Step-by-step comparison"),
        h("thead", null, h("tr", null, ["Step", "Median duration", "Median time since the previous event", "Rework rate", "Share of cases", "Visits per case"]
          .concat(withGroup ? ["Duration change net of the comparison group"] : []).map(t => h("th", { scope: "col" }, t)))),
        h("tbody", null, cmp.steps.map(s => stepRow(s, pair, e, withGroup))))) :
        h("p", { class: "small muted" }, "The two logs have no measured step in common to compare."),
      cmp.unmatched.length ? h("p", { class: "note" },
        cmp.unmatched.length + " step" + (cmp.unmatched.length === 1 ? "" : "s") + " with no match in the other log: " +
        cmp.unmatched.map(u => u.label + " (" + u.side + ")").join(", ") + ".") : null,
      groupBlock(pair, cmp, e, ctx),
      cmp.caveats.length ? [h("p", { class: "section-title benefits-sub" }, "Notes"),
        h("ul", { class: "plain-list small" }, cmp.caveats.map(c => h("li", null, c)))] : null,
      h("div", { class: "form-actions" }, removeBtn));
  }

  function linkForm(e, ctx) {
    const datasets = e.datasets || [];
    const option = d => h("option", { value: d.id }, d.name);
    const afterSel = h("select", { class: "select", id: "bv-link-after" }, datasets.map(option));
    const baseSel = h("select", { class: "select", id: "bv-link-baseline" }, datasets.map(option));
    // Suggest the newest log (an "after" log first) against the newest baseline,
    // so recording the defaults never compares a log with itself or backwards.
    const newestFirst = datasets.map((d, i) => ({ d, i }))
      .sort((a, b) => String(b.d.createdAt || "").localeCompare(String(a.d.createdAt || "")) || b.i - a.i).map(x => x.d);
    const afterPick = newestFirst.find(d => d.role === "after" && !d.comparesToDatasetId) || newestFirst[0];
    const basePick = newestFirst.find(d => d !== afterPick && d.role === "baseline") || newestFirst.find(d => d !== afterPick);
    if (afterPick) afterSel.value = afterPick.id;
    if (basePick) baseSel.value = basePick.id;
    const err = h("p", { class: "error-text", hidden: true });
    const saveBtn = h("button", { class: "btn btn-primary", type: "button" }, "Record this comparison");
    saveBtn.addEventListener("click", () => ctx.dispatch("dataset/update",
      { id: afterSel.value, patch: { role: "after", comparesToDatasetId: baseSel.value } }, "Comparison recorded", err));
    return h("div", { class: "form-grid" },
      h("p", { class: "section-title" }, "Record a comparison"),
      h("p", { class: "small" }, "Choose the event log taken after the change and the baseline log to compare it with."),
      h("div", { class: "field-row" },
        h("div", { class: "field" }, h("label", { for: "bv-link-after" }, "Event log after the change"), afterSel),
        h("div", { class: "field" }, h("label", { for: "bv-link-baseline" }, "Baseline log"), baseSel)),
      h("div", { class: "form-actions" }, saveBtn),
      err);
  }

  /* ---------- Checkpoints recorded by hand ---------- */

  const BASES = ["supplied", "observed", "validated"];
  const sized = e => ((e && e.records) || []).filter(r => r.kind === "opportunity" && r.status !== "dropped" && r.opportunity && r.opportunity.valueCase);

  /** Opens the checkpoint form for one opportunity, empty or for an existing checkpoint. */
  function checkpointDialog(ctx, recordId, cp) {
    const e = ctx.engagement;
    const c = Object.assign({ label: "30 days", date: "", hoursPerCaseAfter: null, shareOfCasesPct: null, annualVolume: null,
      cycleTimeAfterMinutes: null, oneTimeCostActual: null, basis: "observed", source: "", note: "" }, cp || {});
    const { field, input, textarea } = B.forms;
    const preset = B.checkpoints.LABELS.includes(c.label) ? c.label : "other";
    const labelSel = h("select", { class: "select", id: "bv-cp-label" },
      B.checkpoints.LABELS.map(l => h("option", { value: l, selected: l === preset }, l)), h("option", { value: "other", selected: preset === "other" }, "Other"));
    const labelText = input(preset === "other" ? c.label : "", { id: "bv-cp-label-text", maxlength: 60, placeholder: "For example, 6 months" });
    const labelTextField = field("Checkpoint name", labelText);
    const num = (v, id, attrs) => input(util.isFiniteNumber(v) ? v : "", Object.assign({ id, type: "number", step: "any", min: 0, inputmode: "decimal" }, attrs || {}));
    const date = input(c.date, { id: "bv-cp-date", type: "date" });
    const after = num(c.hoursPerCaseAfter, "bv-cp-hours");
    const share = num(c.shareOfCasesPct, "bv-cp-share", { max: 100 });
    const volume = num(c.annualVolume, "bv-cp-volume");
    const cycle = num(c.cycleTimeAfterMinutes, "bv-cp-cycle");
    const cost = num(c.oneTimeCostActual, "bv-cp-cost");
    const basis = h("select", { class: "select", id: "bv-cp-basis" }, BASES.map(b => h("option", { value: b, selected: b === c.basis }, schema.label("assumptionStatus", b))));
    const source = input(c.source, { id: "bv-cp-source", maxlength: 500, placeholder: "Where the figure comes from, such as a time study or the team's tracker" });
    const note = textarea(c.note, 2); note.id = "bv-cp-note";
    const record = (e.records || []).find(r => r.id === recordId);
    const result = record ? valueCase.compute(e, record, { scenarioId: ctx.scenarioId }) : null;
    const before = result ? (result.outputs.find(o => o.key === "hoursPerCase") || {}).value : null;
    const err = h("p", { class: "error-text", role: "alert", hidden: true });
    const syncLabel = () => { labelTextField.hidden = labelSel.value !== "other"; };
    labelSel.addEventListener("change", syncLabel);
    syncLabel();
    const numberOf = el => el.value.trim() === "" ? null : Number(el.value);
    const body = h("form", { class: "form-grid", novalidate: true, id: "bv-cp-form" },
      h("p", { class: "small muted" }, "Record what the change achieved, measured by the delivery team or the client. AIxRay works out the realized hours and money with the same formula as the business case."),
      h("div", { class: "field-row" }, field("Checkpoint", labelSel), labelTextField, field("Date", date)),
      field("Hands-on hours per affected case after the change", after,
        util.isFiniteNumber(before) ? "The business case has " + util.formatNumber(before, 2) + " hours per affected case before the change." : "The business case has no hours per affected case yet."),
      h("div", { class: "field-row" }, field("Share of cases affected (%)", share, "Leave blank to use the business case's share."),
        field("Cases per year", volume, "Leave blank to use the business case's volume.")),
      h("div", { class: "field-row" }, field("Cycle time after, in minutes", cycle, "Optional."), field("Actual one-time cost", cost, "Optional.")),
      h("div", { class: "field-row" }, field("Basis", basis), field("Source", source)),
      field("Note", note),
      err);
    body.addEventListener("submit", ev => ev.preventDefault());
    const actions = [];
    if (c.id) {
      actions.push({ label: "Delete", variant: "btn-danger", keepOpen: true, onClick: api => {
        B.dialogs.confirmDialog("Delete this checkpoint?", "The " + c.label + " checkpoint will be deleted. You can undo this from the menu.", "Delete", true).then(ok => {
          if (ok && ctx.dispatch("checkpoint/delete", { id: c.id }, "Checkpoint deleted")) api.close();
        });
        return false;
      } });
    }
    actions.push({ label: "Cancel" });
    actions.push({ label: c.id ? "Save checkpoint" : "Add checkpoint", variant: "btn-primary", keepOpen: true, onClick: api => {
      if (after.value.trim() === "") { err.hidden = false; err.textContent = "Enter the hands-on hours per affected case after the change."; after.focus(); return false; }
      const payload = { checkpoint: {
        id: c.id, recordId, label: labelSel.value === "other" ? (labelText.value.trim() || "Checkpoint") : labelSel.value, date: date.value,
        hoursPerCaseAfter: numberOf(after), shareOfCasesPct: numberOf(share), annualVolume: numberOf(volume),
        cycleTimeAfterMinutes: numberOf(cycle), oneTimeCostActual: numberOf(cost), basis: basis.value, source: source.value, note: note.value
      } };
      if (ctx.dispatch("checkpoint/save", payload, c.id ? "Checkpoint saved" : "Checkpoint added", err)) api.close();
      return false;
    } });
    return B.dialogs.openDialog({ title: (c.id ? "Edit checkpoint: " : "Add a checkpoint: ") + (record ? record.title : ""), eyebrow: "Results after the change", wide: true, body, actions });
  }

  function checkpointTable(row, e, ctx) {
    const c = { currency: e.meta && e.meta.currency };
    const figure = f => f ? h("span", null, units.formatMeasure(f.value, f.unit, c), " ", badge(schema.label("assumptionStatus", f.basis) || f.basis, BASIS_TONE[f.basis])) : h("span", { class: "muted" }, "Not calculated");
    const cps = (e.checkpoints || []);
    return h("div", { class: "table-wrap" }, h("table", { class: "table bv-checkpoints", dataset: { record: row.recordId } },
      h("caption", { class: "sr-only" }, "Checkpoints for " + row.title),
      h("thead", null, h("tr", null, ["Checkpoint", "Expected (modeled)", "Realized hours a year", "Realized net benefit", "Status", ""].map(t => h("th", { scope: "col" }, t)))),
      h("tbody", null, row.checkpoints.map(x => h("tr", { dataset: { checkpoint: x.id } },
        h("td", null, h("div", { class: "title-cell" }, x.label + (x.date ? ", " + x.date : "")),
          x.source ? h("div", { class: "desc" }, "Source: " + x.source) : null,
          x.notes.length ? h("div", { class: "desc" }, x.notes.join(" ")) : null),
        h("td", { class: "num" }, figure(row.expected)),
        h("td", { class: "num" }, figure(x.realized)),
        h("td", { class: "num" }, figure(x.realizedMoney)),
        h("td", null, badge(STATUS_LABEL[x.status], STATUS_TONE[x.status])),
        h("td", null, h("button", { type: "button", class: "btn", on: { click: () => checkpointDialog(ctx, row.recordId, cps.find(cp => cp.id === x.id)) } }, "Edit")))))));
  }

  function checkpointsBlock(e, ctx) {
    const opps = sized(e);
    const rows = benefits.expectedVsCheckpoints(e, { scenarioId: ctx.scenarioId, includeSensitive: true, includeUnreviewedAi: true });
    const pick = h("select", { class: "select", id: "bv-cp-record" }, opps.map(r => h("option", { value: r.id }, r.title)));
    const addBtn = h("button", { type: "button", class: "btn btn-primary", id: "bv-cp-add", disabled: !opps.length,
      on: { click: () => checkpointDialog(ctx, pick.value) } }, "Add a checkpoint");
    return h("div", { class: "benefits-pair", id: "bv-checkpoints" },
      h("h4", { class: "benefits-pair-title" }, "Results at checkpoints"),
      h("p", { class: "small" }, "No event log? Record what the change achieved at 30, 60 or 90 days, or any date, and compare it with the business case."),
      rows.map(row => [h("p", { class: "section-title benefits-sub" }, row.title),
        row.notes.length ? h("p", { class: "small muted" }, row.notes.join(" ")) : null,
        checkpointTable(row, e, ctx)]),
      opps.length ? h("div", { class: "field-row" }, h("div", { class: "field" }, h("label", { for: "bv-cp-record" }, "Opportunity"), pick)) :
        h("p", { class: "small muted" }, "Add a business case to an opportunity first. Checkpoints are compared with it."),
      h("div", { class: "form-actions" }, addBtn));
  }

  /*
   * Shown when there is an event log, an opportunity with a business case or
   * a checkpoint; otherwise left out of the value workspace rather than empty.
   */
  function renderBenefitsSection(ctx) {
    const e = ctx.engagement;
    const datasets = (e && e.datasets) || [];
    const manual = !!e && (sized(e).length > 0 || ((e.checkpoints || []).length > 0));
    if (!datasets.length && !manual) return null;
    const pairs = pairsOf(e);
    const body = [];
    pairs.forEach(p => body.push(pairCard(p, e, ctx)));
    if (datasets.length > 1) {
      body.push(linkForm(e, ctx));
    } else if (datasets.length) {
      body.push(h("p", { class: "small muted" }, "No comparison yet. Import a second event log, taken after the change, to compare with this one."));
    }
    if (manual) body.push(checkpointsBlock(e, ctx));
    return h("section", { class: "card", id: "bv-section", "aria-labelledby": "bv-h" },
      h("h3", { id: "bv-h" }, "Benefits"),
      h("p", { class: "note" }, datasets.length ?
        "The measured change between two event logs of the same process, and results recorded by hand at checkpoints. Seasonal effects, a different mix of work or a change in how activities were matched can also move these figures, so check the notes before you report a figure." :
        "Results recorded by hand at checkpoints after the change, compared with the business case. Check the notes under each checkpoint before you report a figure."),
      body);
  }

  B.ext.registerValueSection({ id: "benefits", render: renderBenefitsSection });

  B.ext.registerHandoffSection({
    id: "benefits", after: "value",
    render(hd, ctx) {
      const e = ctx.engagement;
      const pairs = pairsOf(e);
      const manual = benefits.expectedVsCheckpoints(e, { scenarioId: ctx.scenarioId, includeSensitive: ctx.includeSensitive, includeUnreviewedAi: ctx.includeUnreviewedAi });
      if (!pairs.length && !manual.length) return null;
      const manualList = manual.length ? [h("h4", null, "Results at checkpoints"),
        h("ul", null, manual.flatMap(row => row.checkpoints.map(x => h("li", null,
          row.title + ", " + x.label + (x.date ? " (" + x.date + ")" : "") + ": " + STATUS_LABEL[x.status] +
          (x.realized ? " (" + units.formatMeasure(x.realized.value, "hour", {}) + " a year realized, " + schema.label("assumptionStatus", x.realized.basis).toLowerCase() + ")" : ""))))),
        h("p", { class: "small" }, "Realized figures come from hours per case the delivery team recorded after the change, not from an event log.")] : null;
      if (!pairs.length) return [h("h3", null, "Benefits measured"), manualList];
      const caveats = new Set();
      const vsRows = [];
      let stepsMeasured = 0;
      pairs.forEach(p => {
        const cmp = benefits.compareDatasets(e, p.baseline.id, p.after.id);
        stepsMeasured += cmp.steps.length;
        cmp.caveats.forEach(c => caveats.add(c));
        benefits.expectedVsRealized(e, p.baseline.id, p.after.id).forEach(r => vsRows.push(r));
      });
      return [
        h("h3", null, "Benefits measured"),
        h("p", null, stepsMeasured + " step" + (stepsMeasured === 1 ? "" : "s") + " measured across " + pairs.length +
          " comparison" + (pairs.length === 1 ? "" : "s") + ": " + pairs.map(p => p.after.name + " compared to " + p.baseline.name).join("; ") + "."),
        vsRows.length ? h("ul", null, vsRows.map(r => h("li", null,
          r.title + ": " + STATUS_LABEL[r.status] + (r.realized ? " (" + units.formatMeasure(r.realized.value, r.realized.unit, {}) +
            (r.groupChange ? " measured, net of a comparison group)" : " measured)") : "")))) : null,
        caveats.size ? [h("h4", null, "Notes"), h("ul", null, [...caveats].map(c => h("li", null, c)))] : null,
        manualList
      ];
    }
  });

  if (B.lenses && typeof B.lenses.registerLens === "function") {
    B.lenses.registerLens({ id: "observed-change", label: "Measured change", compute: ctx => benefits.observedChangeLens(ctx) });
  }

  B.benefitsView = { pairsOf, renderBenefitsSection, checkpointDialog };
})(typeof globalThis !== "undefined" ? globalThis : this);
