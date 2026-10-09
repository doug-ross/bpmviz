/*
 * BPMVIZ opportunity-value: the value case editor on the opportunity dialog,
 * the Matrix and Waves opportunity views, the Annual value and Wave columns,
 * the Business case present mode, and the value summary on the handoff.
 * Owned by the value case and business case feature (value slice); see
 * docs/extensions.md and docs/business-case.md. Registers with BPMVIZ.ext and
 * BPMVIZ.store.registerCommands from this file; the figures themselves come
 * from lib/value-case.js and lib/business-case.js.
 */
(function (root) {
  "use strict";
  const B = root.BPMVIZ = root.BPMVIZ || {};
  const { h, s } = B.dom;
  const { schema, units, util, valueCase, businessCase, datasetQuery, exporting } = B;
  const { field, textarea } = B.forms;

  function unitsCtxOf(e) {
    return { currency: e.meta.currency, timeBasis: e.meta.timeBasis };
  }

  function enumSelect(name, value, attrs) {
    return h("select", Object.assign({ class: "select" }, attrs || {}),
      schema.ENUMS[name].map(v => h("option", { value: v, selected: v === (value || "") }, schema.label(name, v))));
  }

  function numberInput(value, label, attrs) {
    return h("input", Object.assign({ class: "input", type: "number", step: "any", inputmode: "decimal",
      value: util.isFiniteNumber(value) ? String(value) : "", "aria-label": label }, attrs || {}));
  }

  function numberOf(input) {
    return input.value === "" ? null : Number(input.value);
  }

  /* ---------- Record dialog section: the value case editor ---------- */

  function valueCaseSection(record, ctx) {
    const e = ctx.engagement;
    const existing = (record.opportunity && record.opportunity.valueCase) || {};
    const datasets = datasetQuery.list(e);

    const waveSel = enumSelect("wave", (record.opportunity && record.opportunity.wave) || "");
    const effortSourceSel = h("select", { class: "select" },
      [["node", "Typed touch effort or duration"], ["dataset", "Observed duration from an event log"]].map(([v, l]) =>
        h("option", { value: v, selected: v === (existing.effortSource === "dataset" ? "dataset" : "node") }, l)));
    const shareSourceSel = enumSelect("valueInputSource", existing.shareSource || "manual");
    const datasetSel = h("select", { class: "select" },
      h("option", { value: "" }, datasets.length ? "Choose an event log" : "No event logs in this engagement"),
      datasets.map(d => h("option", { value: d.id, selected: d.id === existing.datasetId }, d.name)));
    const effortReduction = numberInput(existing.effortReductionPct, "Effort reduction, percent", { min: 0, max: 100 });
    const durationReduction = numberInput(existing.durationReductionPct, "Duration reduction, percent", { min: 0, max: 100 });
    const shareOfCases = numberInput(existing.shareOfCasesPct, "Share of cases affected, percent", { min: 0, max: 100 });
    const oneTimeCost = numberInput(existing.oneTimeCost, "One-time cost", { min: 0 });
    const runningCost = numberInput(existing.annualRunningCost, "Annual running cost", { min: 0 });
    const confidenceSel = enumSelect("confidence", existing.confidence || "");
    const basisSel = enumSelect("assumptionStatus", existing.basis || "");
    const note = textarea(existing.note, 2);
    const preview = h("p", { class: "note", role: "status", id: "bc-vc-preview" });
    waveSel.id = "bc-vc-wave"; effortSourceSel.id = "bc-vc-effort-source"; shareSourceSel.id = "bc-vc-share-source";
    datasetSel.id = "bc-vc-dataset"; effortReduction.id = "bc-vc-effort-pct"; durationReduction.id = "bc-vc-duration-pct";
    shareOfCases.id = "bc-vc-share-pct"; oneTimeCost.id = "bc-vc-one-time"; runningCost.id = "bc-vc-running-cost";
    confidenceSel.id = "bc-vc-confidence"; basisSel.id = "bc-vc-basis"; note.id = "bc-vc-note";

    const datasetField = field("Event log", datasetSel, "Used when the effort or the share of cases comes from an event log.");
    const shareField = field("Share of cases affected (%)", shareOfCases);

    function needsDataset() {
      return effortSourceSel.value === "dataset" || shareSourceSel.value === "dataset";
    }

    function currentValueCase() {
      // Start from the stored value case so a scope set another way (an
      // imported value case, or one that names a model or a subset of
      // steps) survives a save that never touches those fields.
      return Object.assign({}, existing, {
        effortReductionPct: numberOf(effortReduction), durationReductionPct: numberOf(durationReduction),
        shareOfCasesPct: numberOf(shareOfCases), shareSource: shareSourceSel.value,
        effortSource: effortSourceSel.value, datasetId: datasetSel.value || null,
        oneTimeCost: numberOf(oneTimeCost), annualRunningCost: numberOf(runningCost),
        confidence: confidenceSel.value, basis: basisSel.value, note: note.value
      });
    }

    function touchedFields(vc) {
      return vc.effortReductionPct !== null || vc.durationReductionPct !== null ||
        vc.shareOfCasesPct !== null || vc.oneTimeCost !== null || vc.datasetId !== null;
    }

    function updatePreview() {
      datasetField.hidden = !needsDataset();
      shareField.hidden = shareSourceSel.value === "dataset";
      const vc = currentValueCase();
      if (!touchedFields(vc)) { preview.textContent = "Fill in the effort or duration reduction to estimate the value of this opportunity."; return; }
      const draft = Object.assign({}, record, { opportunity: Object.assign({}, record.opportunity, { valueCase: vc }) });
      let result;
      try { result = valueCase.compute(e, draft, { scenarioId: ctx.scenarioId }); } catch (err) { preview.textContent = "Could not estimate the value from these figures yet."; return; }
      const head = valueCase.headline(result);
      if (!head) { preview.textContent = "Not enough information to estimate the value yet" + (result.missing.length ? ": needs " + result.missing.join(", ").toLowerCase() + "." : "."); return; }
      preview.textContent = "Estimated at " + units.formatMeasure(head.value, head.unit, unitsCtxOf(e)) + " a year, " + head.basis + " basis.";
    }

    [effortReduction, durationReduction, shareOfCases, oneTimeCost, runningCost].forEach(el => el.addEventListener("input", updatePreview));
    [effortSourceSel, shareSourceSel, datasetSel, confidenceSel, basisSel].forEach(el => el.addEventListener("change", updatePreview));
    updatePreview();

    const el = h("div", { class: "form-grid", style: { border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "var(--space-3)" } },
      h("p", { class: "field-label" }, "Value case"),
      h("p", { class: "small muted" }, "The modeled annual value of this opportunity, built from the same formulas as the value model."),
      h("div", { class: "field-row" }, field("Effort comes from", effortSourceSel), field("Share of cases comes from", shareSourceSel)),
      datasetField,
      h("div", { class: "field-row" }, field("Effort reduction (%)", effortReduction), field("Duration reduction (%)", durationReduction)),
      shareField,
      h("div", { class: "field-row" }, field("One-time cost", oneTimeCost), field("Annual running cost", runningCost)),
      h("div", { class: "field-row" }, field("Confidence", confidenceSel), field("Basis", basisSel)),
      field("Wave", waveSel, "Quick-win, major, fill-in or reconsider are only suggestions; this is the consultant's call."),
      field("Note", note),
      preview);

    return {
      el,
      collect: () => {
        const vc = currentValueCase();
        const hadValueCase = !!(record.opportunity && record.opportunity.valueCase);
        if (!hadValueCase && !touchedFields(vc)) return { wave: waveSel.value };
        return { wave: waveSel.value, valueCase: vc };
      },
      check: () => (needsDataset() && !datasetSel.value ? "Choose an event log, or switch the effort or share of cases to a typed value." : null)
    };
  }

  B.ext.registerRecordDialogSection({ id: "value-case", kinds: ["opportunity"], render: valueCaseSection });

  /* ---------- Opportunity register columns ---------- */

  function annualValueCell(record, ctx) {
    if (!record.opportunity || !record.opportunity.valueCase) return h("span", { class: "muted" }, "Not modeled");
    let result;
    try { result = valueCase.compute(ctx.engagement, record, { scenarioId: ctx.scenarioId }); } catch (err) { return h("span", { class: "muted" }, "Not modeled"); }
    const head = valueCase.headline(result);
    if (!head) return h("span", { class: "muted" }, result.missing.length ? "Needs " + result.missing[0].toLowerCase() : "Not modeled");
    return h("span", null, units.formatMeasure(head.value, head.unit, unitsCtxOf(ctx.engagement)) + " a year", h("span", { class: "formula" }, " " + head.basis + " basis"));
  }

  function waveCell(record) {
    const wave = (record.opportunity && record.opportunity.wave) || "";
    return wave ? schema.label("wave", wave) : h("span", { class: "muted" }, "Not set");
  }

  B.ext.registerOpportunityColumn({ id: "annual-value", header: "Annual value", after: "Effort", cell: annualValueCell });
  B.ext.registerOpportunityColumn({ id: "wave", header: "Wave", after: "Annual value", cell: waveCell });

  /* ---------- Opportunity views: Matrix and Waves ---------- */

  const WAVE_COLUMNS = ["now", "next", "later", ""];
  const EFFORT_LETTER = Object.fromEntries(Object.entries(valueCase.EFFORT_SCORE).map(([letter, score]) => [score, letter]));
  const QUADRANT_GRID = { "quick-win": [0, 0], major: [1, 0], "fill-in": [0, 1], reconsider: [1, 1] };

  function rankedFor(ctx) {
    return valueCase.rank(ctx.engagement, { scenarioId: ctx.scenarioId, ids: ctx.records.map(r => r.id), includeSensitive: true, includeUnreviewedAi: true });
  }

  function buildMatrixSvg(scored) {
    const width = 640, top = 48, cellW = width / 2, cellH = 170, height = top + cellH * 2 + 16;
    const svg = s("svg", { viewBox: "0 0 " + width + " " + height, width: "100%", height, role: "img",
      "aria-label": "Opportunities placed in four quadrants by effort and value. The table below lists the same opportunities with their figures." });
    svg.appendChild(s("text", { x: cellW / 2, y: 20, "text-anchor": "middle", class: "bc-axis-label" }, "Low effort (S or M)"));
    svg.appendChild(s("text", { x: cellW + cellW / 2, y: 20, "text-anchor": "middle", class: "bc-axis-label" }, "High effort (L)"));
    [["quick-win", "Quick win"], ["major", "Major project"], ["fill-in", "Fill-in"], ["reconsider", "Reconsider"]].forEach(([id, label]) => {
      const pos = QUADRANT_GRID[id];
      const x = pos[0] * cellW, y = top + pos[1] * cellH;
      svg.appendChild(s("rect", { x: x + 2, y: y + 2, width: cellW - 4, height: cellH - 4, class: "bc-quadrant" }));
      svg.appendChild(s("text", { x: x + 10, y: y + 20, class: "bc-quadrant-label" }, label));
    });
    const counts = {};
    const perRow = Math.max(1, Math.floor((cellW - 24) / 32));
    scored.forEach(x => {
      const pos = QUADRANT_GRID[x.quadrant];
      const idx = counts[x.quadrant] || 0;
      counts[x.quadrant] = idx + 1;
      const row = Math.floor(idx / perRow), col = idx % perRow;
      const cx = pos[0] * cellW + 26 + col * 32;
      const cy = top + pos[1] * cellH + 48 + row * 32;
      const g = s("g", { class: "bc-dot-group", "data-record": x.recordId });
      g.appendChild(s("title", {}, x.title + ", rank " + x.rank));
      g.appendChild(s("circle", { cx, cy, r: 11, class: "bc-dot" }));
      g.appendChild(s("text", { x: cx, y: cy + 4, "text-anchor": "middle", class: "bc-dot-rank" }, String(x.rank)));
      svg.appendChild(g);
    });
    return svg;
  }

  function matrixTable(ranked, ctx) {
    const c = unitsCtxOf(ctx.engagement);
    return h("div", { class: "table-wrap" }, h("table", { class: "table" },
      h("caption", { class: "sr-only" }, "Opportunities ranked by modeled value and effort, the same information as the chart above"),
      h("thead", null, h("tr", null, ["Rank", "Opportunity", "Effort", "Value", "Basis", "Quadrant", "Suggested wave", "Wave"].map(col => h("th", { scope: "col" }, col)))),
      h("tbody", null, ranked.map(x => h("tr", null,
        h("td", { class: "num" }, String(x.rank)),
        h("td", null, x.title),
        h("td", null, x.effortScore ? schema.label("effortSize", EFFORT_LETTER[x.effortScore]) : h("span", { class: "muted" }, "Not set")),
        h("td", { class: "num" }, x.value === null ? h("span", { class: "muted" }, "Not modeled") : units.formatMeasure(x.value, x.unit, c) + " a year"),
        h("td", null, x.basis || h("span", { class: "muted" }, "n/a")),
        h("td", null, x.quadrant ? valueCase.QUADRANT_LABEL[x.quadrant] : h("span", { class: "muted" }, "Not scored")),
        h("td", null, x.suggestedWave ? schema.label("wave", x.suggestedWave) : ""),
        h("td", null, x.wave ? schema.label("wave", x.wave) : h("span", { class: "muted" }, "Not set")))))));
  }

  function matrixView(host, ctx) {
    const ranked = rankedFor(ctx);
    if (!ranked.length) { host.appendChild(h("div", { class: "empty" }, "No opportunities to plot yet.")); return; }
    const scored = ranked.filter(x => x.quadrant);
    const unscored = ranked.filter(x => !x.quadrant);
    host.appendChild(h("p", { class: "small", style: { maxWidth: "70ch" } },
      "Value against effort. Quick wins sit top left, major projects top right. Give an opportunity an effort size and a value case to place it."));
    if (scored.length) host.appendChild(h("div", { class: "bc-matrix" }, buildMatrixSvg(scored)));
    host.appendChild(matrixTable(ranked, ctx));
    if (unscored.length) host.appendChild(h("p", { class: "note" }, unscored.length + " opportunit" + (unscored.length === 1 ? "y needs" : "ies need") +
      " an effort size and a value case before it can be placed on the chart."));
  }

  function waveCard(row, currentWave, ctx, c) {
    const sel = h("select", { class: "select" }, WAVE_COLUMNS.map(w => h("option", { value: w, selected: w === currentWave }, schema.label("wave", w))));
    const selId = "bc-move-" + row.recordId;
    sel.id = selId;
    sel.addEventListener("change", () => {
      const next = sel.value;
      const ok = ctx.dispatch("opportunity/setWaves", { changes: [{ id: row.recordId, wave: next }] }, row.title + " moved to " + schema.label("wave", next).toLowerCase() + ".");
      if (ok) ctx.rerender(); else sel.value = currentWave;
    });
    return h("div", { class: "bc-wave-card", id: "bc-wave-card-" + row.recordId },
      h("div", { class: "title" }, row.title),
      h("div", { class: "small muted" }, row.value === null ? "Not modeled" :
        units.formatMeasure(row.value, row.unit, c) + " a year, " + row.basis + " basis" + (row.quadrantLabel ? ", " + row.quadrantLabel.toLowerCase() : "")),
      h("label", { class: "field" }, h("span", { for: selId }, "Move to"), sel));
  }

  function wavesView(host, ctx) {
    const e = ctx.engagement;
    const page = businessCase.buildPortfolioPager(e, { scenarioId: ctx.scenarioId, ids: ctx.records.map(r => r.id), includeSensitive: true, includeUnreviewedAi: true });
    if (!page.rows.length) { host.appendChild(h("div", { class: "empty" }, "No opportunities to plan into waves yet.")); return; }
    const c = unitsCtxOf(e);
    const board = h("div", { class: "bc-wave-board" });
    WAVE_COLUMNS.forEach(wave => {
      const total = page.waves.find(w => w.wave === wave);
      const rows = page.rows.filter(r => r.wave === wave).sort((a, b) => a.rank - b.rank);
      board.appendChild(h("div", { class: "bc-wave-col", id: "bc-wave-" + (wave || "none") },
        h("h3", null, schema.label("wave", wave)),
        rows.length ? h("p", { class: "bc-wave-totals" },
          (total.netAnnualBenefit === null ? "No net annual benefit modeled yet" : units.formatMeasure(total.netAnnualBenefit, "currency", c) + " modeled net annual benefit") +
          (total.incomplete ? ", " + total.incomplete + " not yet counted" : "") + ".") : null,
        rows.length ? rows.map(r => waveCard(r, wave, ctx, c)) : h("p", { class: "bc-wave-empty" }, "Nothing planned here.")));
    });
    host.appendChild(board);
    if (page.overlaps.length) host.appendChild(h("p", { class: "note" }, page.overlaps.length + " step" + (page.overlaps.length === 1 ? " is" : "s are") +
      " changed by more than one opportunity planned in the same wave: " + page.overlaps.map(o => o.label).join(", ") + "."));
  }

  B.ext.registerOpportunityView({ id: "matrix", label: "Matrix", render: matrixView });
  B.ext.registerOpportunityView({ id: "waves", label: "Waves", render: wavesView });

  /* ---------- Present mode: Business case ---------- */

  let presentSelection = "";

  function portfolioArticle(page, c, e) {
    const stat = (value, label, sub) => h("div", { class: "stat" }, h("span", { class: "v" }, value), h("span", { class: "l" }, label), sub ? h("span", { class: "s" }, sub) : null);
    return h("article", { class: "handoff-doc bc-onepager", id: "bc-portfolio" },
      h("p", { class: "eyebrow" }, [e.meta.clientDisplayName, e.meta.engagementName].filter(Boolean).join(", ") || "Process workshop"),
      h("h1", null, "Business case: the opportunity portfolio"),
      h("p", { class: "lede" }, "Every tracked opportunity, ranked by modeled value against effort, with totals for the waves planned so far."),
      h("div", { class: "stat-row" },
        stat(page.total.netAnnualBenefit === null ? "Not yet modeled" : units.formatMeasure(page.total.netAnnualBenefit, "currency", c),
          "Net annual benefit, waves now, next and later",
          page.total.incomplete ? page.total.incomplete + " opportunit" + (page.total.incomplete === 1 ? "y" : "ies") + " not yet counted" : "Modeled, not realized"),
        stat(page.total.fteReleased === null ? "Not yet modeled" : util.formatNumber(page.total.fteReleased, 1) + " FTE",
          "Redeployable capacity across planned waves", "Time that can be redeployed, not headcount"),
        stat(page.total.oneTimeCost === null ? "Not yet recorded" : units.formatMeasure(page.total.oneTimeCost, "currency", c), "One-time cost across planned waves", "")),
      h("h2", null, "Ranked opportunities"),
      h("div", { class: "table-wrap" }, h("table", { class: "table" },
        h("thead", null, h("tr", null, ["Rank", "Opportunity", "Value", "Basis", "Quadrant", "Wave"].map(col => h("th", { scope: "col" }, col)))),
        h("tbody", null, page.rows.map(r => h("tr", null,
          h("td", { class: "num" }, String(r.rank)), h("td", null, r.title),
          h("td", { class: "num" }, r.value === null ? h("span", { class: "muted" }, "Not modeled") : units.formatMeasure(r.value, r.unit, c) + " a year"),
          h("td", null, r.basis || h("span", { class: "muted" }, "n/a")),
          h("td", null, r.quadrantLabel || h("span", { class: "muted" }, "Not scored")),
          h("td", null, r.waveLabel)))))),
      h("h2", null, "Wave totals"),
      h("div", { class: "table-wrap" }, h("table", { class: "table" },
        h("thead", null, h("tr", null, ["Wave", "Opportunities", "Net annual benefit", "One-time cost", "Capacity"].map(col => h("th", { scope: "col" }, col)))),
        h("tbody", null, page.waves.map(w => h("tr", null,
          h("td", null, w.label), h("td", { class: "num" }, String(w.recordIds.length)),
          h("td", { class: "num" }, w.netAnnualBenefit === null ? h("span", { class: "muted" }, "Not modeled") : units.formatMeasure(w.netAnnualBenefit, "currency", c)),
          h("td", { class: "num" }, w.oneTimeCost === null ? h("span", { class: "muted" }, "Not recorded") : units.formatMeasure(w.oneTimeCost, "currency", c)),
          h("td", { class: "num" }, w.fteReleased === null ? h("span", { class: "muted" }, "Not modeled") : util.formatNumber(w.fteReleased, 1) + " FTE")))))),
      page.overlaps.length ? h("p", { class: "note" }, page.overlaps.length + " step" + (page.overlaps.length === 1 ? " is" : "s are") +
        " changed by more than one opportunity planned in the same wave.") : null,
      page.notes.map(n => h("p", { class: "note" }, n)));
  }

  function onePagerArticle(page, c, e) {
    if (!page) return h("p", { class: "note" }, "Choose an opportunity to see its business case.");
    const stat = o => h("div", { class: "stat" },
      h("span", { class: "v" }, o.value === null ? "Not calculated" : o.key === "paybackMonths" ? util.formatNumber(o.value, 1) + " months" : units.formatMeasure(o.value, o.unit, c)),
      h("span", { class: "l" }, o.label),
      h("span", { class: "s" }, o.value === null ? "Needs " + o.missing.join(", ").toLowerCase() : "From " + o.basis + " inputs"));
    return h("article", { class: "handoff-doc bc-onepager", id: "bc-onepager" },
      h("p", { class: "eyebrow" }, [e.meta.clientDisplayName, e.meta.engagementName].filter(Boolean).join(", ") || "Process workshop"),
      h("h1", null, "Business case: " + page.title),
      h("dl", { class: "facts" },
        h("dt", null, "Owner"), h("dd", null, page.owner || "Unassigned"),
        h("dt", null, "Intervention"), h("dd", null, page.intervention || "Not chosen"),
        h("dt", null, "Effort"), h("dd", null, page.effort || "Not set"),
        h("dt", null, "Wave"), h("dd", null, page.waveLabel + (page.suggestedWave ? " (suggested: " + schema.label("wave", page.suggestedWave) + ")" : "")),
        h("dt", null, "Confidence"), h("dd", null, page.confidenceLabel)),
      page.hasValueCase ? h("div", { class: "stat-row" }, page.outputs.map(stat)) :
        h("p", { class: "note" }, "No value case is recorded for this opportunity yet."),
      page.affectedSteps.length ? [h("h2", null, "Affected steps"), h("p", null, page.affectedSteps.join(", "))] : null,
      page.skippedSteps.length ? h("p", { class: "note" }, "Not counted as work steps: " + page.skippedSteps.join(", ") + ".") : null,
      page.note ? [h("h2", null, "Note"), h("p", null, page.note)] : null,
      page.notes.length ? h("ul", { class: "plain-list small" }, page.notes.map(n => h("li", null, n))) : null);
  }

  function businessCaseMode(content, ctx) {
    const e = ctx.engagement;
    const opts = { scenarioId: ctx.scenarioId, includeSensitive: ctx.includeSensitive, includeUnreviewedAi: ctx.includeUnreviewedAi };
    const page = businessCase.buildPortfolioPager(e, opts);
    if (presentSelection && !page.rows.some(r => r.recordId === presentSelection)) presentSelection = "";
    const selId = "bc-present-select";
    const sel = h("select", { class: "select", id: selId },
      h("option", { value: "" }, "Portfolio overview"),
      page.rows.map(r => h("option", { value: r.recordId, selected: r.recordId === presentSelection }, r.title)));
    sel.addEventListener("change", () => { presentSelection = sel.value; ctx.rerender(); });
    content.appendChild(h("div", { class: "no-print field", style: { maxWidth: "360px", marginBottom: "var(--space-4)" } },
      h("label", { for: selId }, "Show"), sel));
    if (!page.rows.length) { content.appendChild(h("p", { class: "note" }, "No opportunities are recorded yet.")); return; }
    const c = unitsCtxOf(e);
    content.appendChild(presentSelection ? onePagerArticle(businessCase.buildOnePager(e, presentSelection, opts), c, e) : portfolioArticle(page, c, e));
  }

  B.ext.registerPresentMode({ id: "business-case", label: "Business case", printable: true, render: businessCaseMode });

  /* ---------- Handoff summary section ---------- */

  B.ext.registerHandoffSection({
    id: "value-summary", after: "opportunity",
    render(hd, ctx) {
      const e = ctx.engagement;
      const ids = exporting.selectRecords(e, { includeSensitive: ctx.includeSensitive, includeUnreviewedAi: ctx.includeUnreviewedAi, handoffOnly: true }).map(r => r.id);
      const page = businessCase.buildPortfolioPager(e, { scenarioId: ctx.scenarioId, includeSensitive: ctx.includeSensitive, includeUnreviewedAi: ctx.includeUnreviewedAi, ids });
      if (!page.rows.length) return null;
      const c = unitsCtxOf(e);
      return [
        h("h2", null, "Opportunity value and waves"),
        h("div", { class: "table-wrap" }, h("table", { class: "table" },
          h("thead", null, h("tr", null, ["Rank", "Opportunity", "Value", "Basis", "Quadrant", "Wave"].map(col => h("th", { scope: "col" }, col)))),
          h("tbody", null, page.rows.map(r => h("tr", null,
            h("td", { class: "num" }, String(r.rank)), h("td", null, r.title),
            h("td", { class: "num" }, r.value === null ? h("span", { class: "muted" }, "Not modeled") : units.formatMeasure(r.value, r.unit, c) + " a year"),
            h("td", null, r.basis || h("span", { class: "muted" }, "n/a")),
            h("td", null, r.quadrantLabel || h("span", { class: "muted" }, "Not scored")),
            h("td", null, r.waveLabel)))))),
        page.total.netAnnualBenefit !== null ? h("p", null, "Planned waves together: " + units.formatMeasure(page.total.netAnnualBenefit, "currency", c) + " modeled net annual benefit a year.") : null,
        page.notes.map(n => h("p", { class: "note" }, n))
      ];
    }
  });

  /* ---------- Store command ---------- */

  B.store.registerCommands({
    "opportunity/setWaves": (draft, payload) => businessCase.applySetWaves(draft, payload, B.store.StoreError)
  });

  B.opportunityValue = { rankedFor, EFFORT_LETTER, QUADRANT_GRID };
})(typeof globalThis !== "undefined" ? globalThis : this);
