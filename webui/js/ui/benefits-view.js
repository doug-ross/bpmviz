/*
 * AIxRay benefits-view: the Benefits section in the value workspace and its
 * handoff summary. Compares a baseline event log against one taken after a
 * change and checks opportunities' modeled value cases against what the
 * logs actually measured. Read-only except for linking two existing event
 * logs together, which goes through the foundation's dataset/update command.
 * See docs/benefits.md.
 */
(function (root) {
  "use strict";
  const B = root.AIxRay = root.AIxRay || {};
  const { h, clear } = B.dom;
  const { util, units, schema, benefits } = B;
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

  function changeText(before, after) {
    if (!util.isFiniteNumber(before) || !util.isFiniteNumber(after)) return "";
    return " (" + units.formatPercentChange(before, after) + ")";
  }

  /* One row of the step-by-step comparison table. */
  function stepRow(s, pair, e) {
    const durBefore = s.duration.before ? s.duration.before.p50 : null;
    const durAfter = s.duration.after ? s.duration.after.p50 : null;
    const sojBefore = s.sojourn.before ? s.sojourn.before.p50 : null;
    const sojAfter = s.sojourn.after ? s.sojourn.after.p50 : null;
    return h("tr", null,
      h("td", null, h("div", { class: "title-cell" }, s.label),
        s.smallSample ? h("div", { class: "desc" }, "Rests on fewer than " + benefits.SMALL_SAMPLE_MIN + " visits in one of the logs.") : null,
        !s.duration.after && s.duration.before ? h("div", { class: "desc" }, "Not visited in the after log.") : null),
      h("td", { class: "num" }, minuteText(s.duration.before, pair.baseline, e) + " to " + minuteText(s.duration.after, pair.after, e) + changeText(durBefore, durAfter)),
      h("td", { class: "num" }, minuteText(s.sojourn.before, pair.baseline, e) + " to " + minuteText(s.sojourn.after, pair.after, e) + changeText(sojBefore, sojAfter)),
      h("td", { class: "num" }, pct(s.reworkRate.before) + " to " + pct(s.reworkRate.after)),
      h("td", { class: "num" }, pct(s.caseShare.before) + " to " + pct(s.caseShare.after)),
      h("td", { class: "num" }, count(s.visitsPerCase.before) + " to " + count(s.visitsPerCase.after)));
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
      h("thead", null, h("tr", null, ["Opportunity", "Modeled (expected)", "Measured change", "Status"].map(t => h("th", { scope: "col" }, t)))),
      h("tbody", null, rows.map(r => h("tr", null,
        h("td", null, h("div", { class: "title-cell" }, r.title), r.notes.length ? h("div", { class: "desc" }, r.notes.join(" ")) : null),
        h("td", { class: "num" }, figure(r.expected)),
        h("td", { class: "num" }, figure(r.realized)),
        h("td", null, badge(STATUS_LABEL[r.status], STATUS_TONE[r.status])))))));
  }

  function pairCard(pair, e, ctx) {
    const cmp = benefits.compareDatasets(e, pair.baseline.id, pair.after.id);
    const vs = benefits.expectedVsRealized(e, pair.baseline.id, pair.after.id);
    const removeBtn = h("button", { class: "btn", type: "button" }, "Remove this comparison");
    removeBtn.addEventListener("click", () => ctx.dispatch("dataset/update", { id: pair.after.id, patch: { comparesToDatasetId: null } }, "Comparison removed"));
    return h("div", { class: "benefits-pair" },
      h("p", { class: "section-title" }, pair.after.name + " compared to " + pair.baseline.name),
      h("p", { class: "small" },
        badge(schema.label("dataStatus", pair.baseline.dataStatus), ""), " baseline \u00b7 ",
        badge(schema.label("dataStatus", pair.after.dataStatus), ""), " after"),
      cmp.overall ? overallFacts(cmp, pair, e) : null,
      cmp.steps.length ? h("div", { class: "table-wrap" }, h("table", { class: "table" },
        h("caption", { class: "sr-only" }, "Step-by-step comparison"),
        h("thead", null, h("tr", null, ["Step", "Median duration", "Median time in step (sojourn)", "Rework rate", "Share of cases", "Visits per case"].map(t => h("th", { scope: "col" }, t)))),
        h("tbody", null, cmp.steps.map(s => stepRow(s, pair, e))))) :
        h("p", { class: "small muted" }, "Neither log has a measured step in common to compare."),
      cmp.unmatched.length ? h("p", { class: "note" },
        cmp.unmatched.length + " step" + (cmp.unmatched.length === 1 ? "" : "s") + " with no match in the other log: " +
        cmp.unmatched.map(u => u.label + " (" + u.side + ")").join(", ") + ".") : null,
      cmp.caveats.length ? h("ul", { class: "plain-list small" }, cmp.caveats.map(c => h("li", null, c))) : null,
      vs.length ? [h("p", { class: "section-title", style: { marginTop: "var(--space-3)" } }, "Expected versus measured change"), expectedVsRealizedTable(vs, e)] : null,
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
      h("p", { class: "small" }, "Choose an event log taken after a change and the baseline it compares to. Either log can already be in the engagement."),
      h("div", { class: "field-row" },
        h("div", { class: "field" }, h("label", { for: "bv-link-after" }, "Event log after the change"), afterSel),
        h("div", { class: "field" }, h("label", { for: "bv-link-baseline" }, "Compares to this baseline log"), baseSel)),
      h("div", { class: "form-actions" }, saveBtn),
      err);
  }

  /*
   * Nothing to show without at least one event log: the section is left out
   * of the value workspace entirely rather than shown empty.
   */
  function renderBenefitsSection(ctx) {
    const e = ctx.engagement;
    const datasets = (e && e.datasets) || [];
    if (!datasets.length) return null;
    const pairs = pairsOf(e);
    const body = [];
    pairs.forEach(p => body.push(pairCard(p, e, ctx)));
    if (datasets.length > 1) {
      body.push(linkForm(e, ctx));
    } else {
      body.push(h("p", { class: "small muted" }, "Import a second event log, taken after the change, to compare against this one."));
    }
    return h("section", { class: "card", id: "bv-section", "aria-labelledby": "bv-h" },
      h("h3", { id: "bv-h" }, "Benefits"),
      h("p", { class: "note" },
        "Measured change between two event logs for the same process: what the logs actually recorded, not savings realized. " +
        "A measured change can be confounded by seasonality, a different volume mix or a mapping that drifted between the two logs; read the caveats before reporting a figure."),
      body);
  }

  B.ext.registerValueSection({ id: "benefits", render: renderBenefitsSection });

  B.ext.registerHandoffSection({
    id: "benefits", after: "value",
    render(hd, ctx) {
      const e = ctx.engagement;
      const pairs = pairsOf(e);
      if (!pairs.length) return null;
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
          r.title + ": " + STATUS_LABEL[r.status] + (r.realized ? " (" + units.formatMeasure(r.realized.value, r.realized.unit, {}) + " measured)" : "")))) : null,
        caveats.size ? [h("h4", null, "Caveats"), h("ul", null, [...caveats].map(c => h("li", null, c)))] : null
      ];
    }
  });

  if (B.lenses && typeof B.lenses.registerLens === "function") {
    B.lenses.registerLens({ id: "observed-change", label: "Observed change", compute: ctx => benefits.observedChangeLens(ctx) });
  }

  B.benefitsView = { pairsOf, renderBenefitsSection };
})(typeof globalThis !== "undefined" ? globalThis : this);
