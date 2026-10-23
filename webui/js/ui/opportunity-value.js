/*
 * AIxRay opportunity-value: the value case editor on the opportunity dialog,
 * the Matrix and Waves opportunity views, the Annual value and Wave columns,
 * the Business case present mode, and the value summary on the handoff.
 * Owned by the value case and business case feature (value slice); see
 * docs/extensions.md and docs/business-case.md. Registers with AIxRay.ext and
 * AIxRay.store.registerCommands from this file; the figures themselves come
 * from lib/value-case.js and lib/business-case.js.
 */
(function (root) {
  "use strict";
  const B = root.AIxRay = root.AIxRay || {};
  const { h, s } = B.dom;
  const { schema, units, util, valueCase, businessCase, datasetQuery, exporting, valueLines } = B;
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

  /* A figure's basis as the app labels it elsewhere: "Illustrative" in a table cell, "illustrative" mid-sentence. */
  function basisLabel(basis) {
    return basis ? schema.label("assumptionStatus", basis) : "";
  }

  function basisWord(basis) {
    return basisLabel(basis).toLowerCase();
  }

  /* ---------- Record dialog section: the value case editor ---------- */

  function valueCaseSection(record, ctx) {
    const e = ctx.engagement;
    const existing = (record.opportunity && record.opportunity.valueCase) || {};
    const datasets = datasetQuery.list(e);

    const waveSel = enumSelect("wave", (record.opportunity && record.opportunity.wave) || "");
    const effortSourceSel = h("select", { class: "select" },
      [["node", "Touch effort on each step"], ["dataset", "Measured step time from an event log"]].map(([v, l]) =>
        h("option", { value: v, selected: v === (existing.effortSource === "dataset" ? "dataset" : "node") }, l)));
    const shareSourceSel = enumSelect("valueInputSource", existing.shareSource || "manual");
    const datasetSel = h("select", { class: "select" },
      h("option", { value: "" }, datasets.length ? "Choose an event log" : "No event logs in this project"),
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
    const textInput = (value, id, max) => h("input", { class: "input", id, value: value || "", maxlength: String(max) });
    const realization = numberInput(existing.realizationPct, "Share of the labor value that can be realized, percent", { min: 0, max: 100, id: "bc-vc-realization" });
    const realizedBy = textInput(existing.realizedBy, "bc-vc-realized-by", valueLines.TEXT.realizedBy);
    const financeOwner = textInput(existing.financeOwner, "bc-vc-finance-owner", valueLines.TEXT.financeOwner);
    const validated = numberInput(existing.validatedAnnual, "Amount Finance confirmed per year", { id: "bc-vc-validated" });
    const validatedSource = textInput(existing.validatedSource, "bc-vc-validated-source", valueLines.TEXT.validatedSource);
    const lineEditors = [];
    const lineList = h("div", { class: "bc-vl-list", id: "bc-vl-list" });
    waveSel.id = "bc-vc-wave"; effortSourceSel.id = "bc-vc-effort-source"; shareSourceSel.id = "bc-vc-share-source";
    datasetSel.id = "bc-vc-dataset"; effortReduction.id = "bc-vc-effort-pct"; durationReduction.id = "bc-vc-duration-pct";
    shareOfCases.id = "bc-vc-share-pct"; oneTimeCost.id = "bc-vc-one-time"; runningCost.id = "bc-vc-running-cost";
    confidenceSel.id = "bc-vc-confidence"; basisSel.id = "bc-vc-basis"; note.id = "bc-vc-note";

    // Figures drafted with AI carry their source as a hint and a dashed outline until a person clears the tick.
    const sources = existing.sources || {};
    const hint = key => sources[key] ? "AI source: " + sources[key] : undefined;
    const draftBox = existing.aiDraft ? h("input", { type: "checkbox", id: "bc-vc-ai-draft", checked: true }) : null;
    const drafted = [[effortReduction, "effortReductionPct"], [durationReduction, "durationReductionPct"], [shareOfCases, "shareOfCasesPct"],
      [oneTimeCost, "oneTimeCost"], [runningCost, "annualRunningCost"]];
    function markDrafts() { drafted.forEach(([el]) => el.classList.toggle("bc-ai", !!(draftBox && draftBox.checked))); }
    if (draftBox) { draftBox.addEventListener("change", markDrafts); markDrafts(); }

    const datasetField = field("Event log", datasetSel);
    const shareField = field("Share of cases affected (%)", shareOfCases, hint("shareOfCasesPct"));

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
        confidence: confidenceSel.value, basis: basisSel.value, note: note.value,
        aiDraft: !!(draftBox && draftBox.checked),
        realizationPct: numberOf(realization), realizedBy: realizedBy.value, financeOwner: financeOwner.value,
        validatedAnnual: numberOf(validated), validatedSource: validatedSource.value
      });
    }

    /* One value line's editor: its template's inputs, then how it becomes money. */
    function lineEditor(line) {
      const dim = valueLines.DIMENSIONS[line.dimension];
      const pre = "bc-vl-" + line.id + "-";
      const inputs = dim.inputs.map(d => {
        const el = numberInput(line.inputs[d.key], d.label, { min: 0, max: d.kind === "percent" ? 100 : undefined, id: pre + d.key });
        el.addEventListener("input", updatePreview);
        return { d, el };
      });
      const lineBasis = enumSelect("assumptionStatus", line.basis || "illustrative", { id: pre + "basis" });
      const lineRealization = numberInput(line.realizationPct, dim.label + ", share that can be realized, percent", { min: 0, max: 100, id: pre + "realization" });
      const lineRealizedBy = textInput(line.realizedBy, pre + "realized-by", valueLines.TEXT.realizedBy);
      const lineOwner = textInput(line.financeOwner, pre + "finance-owner", valueLines.TEXT.financeOwner);
      const lineValidated = numberInput(line.validatedAnnual, dim.label + ", amount Finance confirmed per year", { id: pre + "validated" });
      const lineSource = textInput(line.validatedSource, pre + "validated-source", valueLines.TEXT.validatedSource);
      const lineNote = textInput(line.note, pre + "note", valueLines.TEXT.note);
      [lineRealization, lineValidated].forEach(x => x.addEventListener("input", updatePreview));
      lineBasis.addEventListener("change", updatePreview);
      const remove = h("button", { type: "button", class: "btn btn-ghost", id: pre + "remove" }, "Remove");
      const fallbackHint = d => d.fallback === "annualVolume" ? "Leave blank to use the project's annual volume." : undefined;
      const box = h("fieldset", { class: "bc-vl", id: pre + "box" },
        h("legend", null, dim.label, h("span", { class: "formula" }, " " + valueLines.TREATMENTS[dim.treatment].label)),
        h("p", { class: "small muted" }, dim.hint),
        h("div", { class: "field-row" }, inputs.map(x => field(x.d.label + (x.d.kind === "percent" ? " (%)" : ""), x.el, fallbackHint(x.d)))),
        h("div", { class: "field-row" }, field("Basis", lineBasis), field("Share that can be realized (%)", lineRealization)),
        h("div", { class: "field-row" }, field("How it becomes money", lineRealizedBy), field("Finance owner", lineOwner)),
        h("div", { class: "field-row" }, field("Amount Finance confirmed per year", lineValidated), field("Where the confirmed amount comes from", lineSource)),
        field("Note", lineNote),
        h("div", { class: "form-actions" }, remove));
      const ed = {
        el: box,
        value: () => ({
          id: line.id, dimension: line.dimension, inputs: Object.fromEntries(inputs.map(x => [x.d.key, numberOf(x.el)])),
          realizationPct: numberOf(lineRealization), realizedBy: lineRealizedBy.value, financeOwner: lineOwner.value,
          validatedAnnual: numberOf(lineValidated), validatedSource: lineSource.value, basis: lineBasis.value, note: lineNote.value
        })
      };
      remove.addEventListener("click", () => {
        lineEditors.splice(lineEditors.indexOf(ed), 1);
        box.remove();
        updatePreview();
      });
      return ed;
    }

    function addLine(line) {
      const ed = lineEditor(line);
      lineEditors.push(ed);
      lineList.appendChild(ed.el);
      return ed;
    }

    const currentLines = () => lineEditors.map(ed => ed.value());
    const addKind = h("select", { class: "select", id: "bc-vl-add-kind", "aria-label": "Kind of value to add" },
      valueLines.DIMENSION_IDS.map(id => h("option", { value: id }, valueLines.DIMENSIONS[id].label)));
    const addButton = h("button", { type: "button", class: "btn", id: "bc-vl-add" }, "Add");
    addButton.addEventListener("click", () => {
      const ed = addLine({ id: valueLines.newLineId(addKind.value, currentLines()), dimension: addKind.value, inputs: {}, basis: basisSel.value || "illustrative" });
      const first = ed.el.querySelector("input");
      if (first) first.focus();
      updatePreview();
    });

    function touchedFields(vc) {
      return vc.effortReductionPct !== null || vc.durationReductionPct !== null ||
        vc.shareOfCasesPct !== null || vc.oneTimeCost !== null || vc.datasetId !== null;
    }

    function updatePreview() {
      datasetField.hidden = !needsDataset();
      shareField.hidden = shareSourceSel.value === "dataset";
      const vc = currentValueCase();
      const lines = currentLines();
      if (!touchedFields(vc) && !lines.length) { preview.textContent = "Fill in the effort or duration reduction, or add another kind of value, to see what this opportunity could be worth."; return; }
      const cleanLines = valueLines.sanitizeLines(lines).lines;
      const draft = Object.assign({}, record, { opportunity: Object.assign({}, record.opportunity, touchedFields(vc) ? { valueCase: vc } : { valueCase: undefined }, { valueLines: cleanLines }) });
      let result;
      try { result = valueCase.compute(e, draft, { scenarioId: ctx.scenarioId }); } catch (err) { preview.textContent = "These figures don't give an estimate. Check the numbers you entered."; return; }
      const head = valueCase.headline(result);
      if (!head) { preview.textContent = "Not enough to estimate the value yet" + (result.missing.length ? ". Still needed: " + result.missing.join(", ").toLowerCase() + "." : "."); return; }
      const fig = key => result.outputs.find(o => o.key === key);
      const gross = fig("grossAnnualValue"), realizable = fig("realizableAnnualValue"), confirmed = fig("validatedAnnualValue");
      const money = o => units.formatMeasure(o.value, o.unit, unitsCtxOf(e));
      if (gross) {
        preview.textContent = (gross.value === null ? "Gross value not calculated yet" : "Gross " + money(gross) + " a year") +
          (realizable && realizable.value !== null ? ", realizable " + money(realizable) : ", realizable not set") +
          (confirmed && confirmed.value !== null ? ", confirmed " + money(confirmed) : "") + ". " + schema.label("assumptionStatus", head.basis) + " basis.";
        return;
      }
      preview.textContent = "Estimated at " + money(head) + " a year, " + basisWord(head.basis) + " basis.";
    }

    [effortReduction, durationReduction, shareOfCases, oneTimeCost, runningCost, realization, validated].forEach(el => el.addEventListener("input", updatePreview));
    [effortSourceSel, shareSourceSel, datasetSel, confidenceSel, basisSel].forEach(el => el.addEventListener("change", updatePreview));
    ((record.opportunity && record.opportunity.valueLines) || []).forEach(addLine);
    updatePreview();

    const el = h("div", { class: "form-grid", style: { border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "var(--space-3)" } },
      h("p", { class: "field-label" }, "Business case"),
      h("p", { class: "small muted" }, "What this opportunity could be worth each year, worked out with the same formulas as the Value tab."),
      draftBox ? h("div", { class: "bc-ai-banner", id: "bc-vc-ai-banner" },
        h("strong", null, "AI draft, not reviewed"),
        h("p", { class: "small" }, "These figures were drafted with AI from the project's own figures. Reports leave them out until someone reviews them. Check each one against its source, then clear the tick to make them yours."),
        h("label", { class: "check" }, draftBox, "AI draft, not reviewed")) : null,
      h("div", { class: "field-row" }, field("Effort comes from", effortSourceSel), field("Share of cases comes from", shareSourceSel)),
      datasetField,
      h("div", { class: "field-row" }, field("Effort reduction (%)", effortReduction, hint("effortReductionPct")), field("Duration reduction (%)", durationReduction, hint("durationReductionPct"))),
      shareField,
      h("div", { class: "field-row" }, field("One-time cost", oneTimeCost, hint("oneTimeCost")), field("Annual running cost", runningCost, hint("annualRunningCost"))),
      h("div", { class: "field-row" }, field("Confidence", confidenceSel), field("Basis", basisSel)),
      h("p", { class: "field-label bc-sub" }, "How the labor value becomes money"),
      h("p", { class: "small muted" }, "Hours saved count as money only through something Finance can see: overtime or contractors cut, planned hires not made, or more profitable work done."),
      h("div", { class: "field-row" }, field("Share that can be realized (%)", realization), field("How it becomes money", realizedBy)),
      h("div", { class: "field-row" }, field("Finance owner", financeOwner), field("Amount Finance confirmed per year", validated)),
      field("Where the confirmed amount comes from", validatedSource),
      h("p", { class: "field-label bc-sub" }, "Other kinds of value"),
      h("p", { class: "small muted" }, "Value besides labor hours, each worked out with its own formula. A hires-avoided line is how the labor hours are realized, so labor is not counted twice."),
      lineList,
      h("div", { class: "bc-vl-add" }, addKind, addButton),
      field("Wave", waveSel, "The Matrix and Waves views suggest a wave from value and effort. The choice is yours."),
      field("Note", note),
      preview);

    return {
      el,
      collect: () => {
        const vc = currentValueCase();
        const hadValueCase = !!(record.opportunity && record.opportunity.valueCase);
        const hadLines = !!(record.opportunity && record.opportunity.valueLines);
        const lines = currentLines();
        const out = { wave: waveSel.value };
        if (hadValueCase || touchedFields(vc)) out.valueCase = vc;
        if (hadLines || lines.length) out.valueLines = lines;
        return out;
      },
      check: () => (needsDataset() && !datasetSel.value ? "Choose an event log, or switch effort and share of cases to values you enter." : null)
    };
  }

  B.ext.registerRecordDialogSection({ id: "value-case", kinds: ["opportunity"], render: valueCaseSection });

  /* ---------- Opportunity register columns ---------- */

  function annualValueCell(record, ctx) {
    if (!record.opportunity || (!record.opportunity.valueCase && !(record.opportunity.valueLines || []).length)) return h("span", { class: "muted" }, "No estimate yet");
    let result;
    try { result = valueCase.compute(ctx.engagement, record, { scenarioId: ctx.scenarioId }); } catch (err) { return h("span", { class: "muted" }, "No estimate yet"); }
    const head = valueCase.headline(result);
    const draft = valueCase.hasDraftValueCase(record) ? h("span", { class: "formula bc-ai-text" }, " AI draft to review") : null;
    if (!head) return h("span", { class: "muted" }, result.missing.length ? "Needs " + result.missing[0].toLowerCase() : "No estimate yet", draft);
    return h("span", null, units.formatMeasure(head.value, head.unit, unitsCtxOf(ctx.engagement)) + " a year", h("span", { class: "formula" }, " " + basisWord(head.basis) + " basis"), draft);
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
    svg.appendChild(s("text", { x: cellW / 2, y: 20, "text-anchor": "middle", class: "bc-axis-label" }, "Low effort (small or medium)"));
    svg.appendChild(s("text", { x: cellW + cellW / 2, y: 20, "text-anchor": "middle", class: "bc-axis-label" }, "High effort (large)"));
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
      h("caption", { class: "sr-only" }, "Opportunities ranked by estimated value and effort, the same information as the chart above"),
      h("thead", null, h("tr", null, ["Rank", "Opportunity", "Effort", "Value", "Basis", "Quadrant", "Suggested wave", "Wave"].map(col => h("th", { scope: "col" }, col)))),
      h("tbody", null, ranked.map(x => h("tr", null,
        h("td", { class: "num" }, String(x.rank)),
        h("td", null, x.title),
        h("td", null, x.effortScore ? schema.label("effortSize", EFFORT_LETTER[x.effortScore]) : h("span", { class: "muted" }, "Not set")),
        h("td", { class: "num" }, x.value === null ? h("span", { class: "muted" }, "No estimate yet") : units.formatMeasure(x.value, x.unit, c) + " a year"),
        h("td", null, x.basis ? basisLabel(x.basis) : h("span", { class: "muted" }, "None")),
        h("td", null, x.quadrant ? valueCase.QUADRANT_LABEL[x.quadrant] : h("span", { class: "muted" }, "Not placed")),
        h("td", null, x.suggestedWave ? schema.label("wave", x.suggestedWave) : ""),
        h("td", null, x.wave ? schema.label("wave", x.wave) : h("span", { class: "muted" }, "Not set")))))));
  }

  function matrixView(host, ctx) {
    const ranked = rankedFor(ctx);
    if (!ranked.length) { host.appendChild(h("div", { class: "empty" }, emptyText(ctx))); return; }
    const scored = ranked.filter(x => x.quadrant);
    const unscored = ranked.filter(x => !x.quadrant);
    host.appendChild(h("p", { class: "small", style: { maxWidth: "70ch" } },
      "Each opportunity placed by value and effort. Quick wins are top left, major projects top right. An opportunity needs an effort size and a business case to appear on the chart."));
    if (scored.length) host.appendChild(h("div", { class: "bc-matrix" }, buildMatrixSvg(scored)));
    host.appendChild(matrixTable(ranked, ctx));
    if (unscored.length) host.appendChild(h("p", { class: "note" }, unscored.length + " opportunit" + (unscored.length === 1 ? "y isn't" : "ies aren't") +
      " on the chart yet. Each one needs an effort size and a business case."));
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
      h("div", { class: "small muted" }, row.value === null ? "No estimate yet" :
        units.formatMeasure(row.value, row.unit, c) + " a year, " + basisWord(row.basis) + " basis" + (row.quadrantLabel ? ", " + row.quadrantLabel.toLowerCase() : "")),
      h("label", { class: "field" }, h("span", { for: selId }, "Move to"), sel));
  }

  function wavesView(host, ctx) {
    const e = ctx.engagement;
    const page = businessCase.buildPortfolioPager(e, { scenarioId: ctx.scenarioId, ids: ctx.records.map(r => r.id), includeSensitive: true, includeUnreviewedAi: true });
    if (!page.rows.length) { host.appendChild(h("div", { class: "empty" }, emptyText(ctx))); return; }
    const c = unitsCtxOf(e);
    const board = h("div", { class: "bc-wave-board" });
    WAVE_COLUMNS.forEach(wave => {
      const total = page.waves.find(w => w.wave === wave);
      const rows = page.rows.filter(r => r.wave === wave).sort((a, b) => a.rank - b.rank);
      board.appendChild(h("div", { class: "bc-wave-col", id: "bc-wave-" + (wave || "none") },
        h("h3", null, schema.label("wave", wave)),
        rows.length ? h("p", { class: "bc-wave-totals" },
          (total.netAnnualBenefit === null ? "No net annual benefit estimated yet" : units.formatMeasure(total.netAnnualBenefit, "currency", c) + " modeled net annual benefit") +
          (total.incomplete ? ", " + total.incomplete + " without an estimate" : "") + ".") : null,
        rows.length ? rows.map(r => waveCard(r, wave, ctx, c)) : h("p", { class: "bc-wave-empty" }, "Nothing planned here.")));
    });
    host.appendChild(board);
    if (page.overlaps.length) host.appendChild(h("p", { class: "note" }, page.overlaps.length + " step" + (page.overlaps.length === 1 ? " is" : "s are") +
      " changed by more than one opportunity planned in the same wave: " + page.overlaps.map(o => o.label).join(", ") + ". Their savings may be counted twice."));
  }

  B.ext.registerOpportunityView({ id: "matrix", label: "Matrix", render: matrixView });
  B.ext.registerOpportunityView({ id: "waves", label: "Waves", render: wavesView });

  /* ---------- Present mode: Business case ---------- */

  let presentSelection = "";

  function portfolioArticle(page, c, e) {
    const stat = (value, label, sub) => h("div", { class: "stat" }, h("span", { class: "v" }, value), h("span", { class: "l" }, label), sub ? h("span", { class: "s" }, sub) : null);
    return h("article", { class: "handoff-doc bc-onepager", id: "bc-portfolio" },
      eyebrowOf(e),
      h("h1", null, "Business case: all opportunities"),
      h("p", { class: "lede" }, "Every opportunity, ranked by estimated value against effort, with totals for the waves planned so far."),
      h("div", { class: "stat-row" },
        stat(page.total.netAnnualBenefit === null ? "No estimate yet" : units.formatMeasure(page.total.netAnnualBenefit, "currency", c),
          "Net annual benefit, all planned waves",
          page.total.incomplete ? page.total.incomplete + " opportunit" + (page.total.incomplete === 1 ? "y" : "ies") + " not yet counted" : "Modeled, not realized"),
        stat(page.total.fteReleased === null ? "No estimate yet" : util.formatNumber(page.total.fteReleased, 1) + " FTE",
          "Time freed up, all planned waves", "Time for other work, not a headcount cut"),
        stat(page.total.oneTimeCost === null ? "Not entered yet" : units.formatMeasure(page.total.oneTimeCost, "currency", c), "One-time cost, all planned waves", "")),
      page.goals.length ? [h("h2", null, "Value goals"), goalsTable(page.goals, page.rows)] : null,
      h("h2", null, "Ranked opportunities"),
      h("div", { class: "table-wrap" }, h("table", { class: "table" },
        h("thead", null, h("tr", null, ["Rank", "Opportunity", "Value", "Basis", "Quadrant", "Wave"].concat(page.goals.length ? ["Goals served"] : []).map(col => h("th", { scope: "col" }, col)))),
        h("tbody", null, page.rows.map(r => h("tr", null,
          h("td", { class: "num" }, String(r.rank)), h("td", null, r.title),
          h("td", { class: "num" }, r.value === null ? h("span", { class: "muted" }, "No estimate yet") : units.formatMeasure(r.value, r.unit, c) + " a year"),
          h("td", null, r.basis ? basisLabel(r.basis) : h("span", { class: "muted" }, "None")),
          h("td", null, r.quadrantLabel || h("span", { class: "muted" }, "Not placed")),
          h("td", null, r.waveLabel),
          page.goals.length ? h("td", null, goalNames(page.goals, r.goalIds)) : null))))),
      h("h2", null, "Wave totals"),
      h("div", { class: "table-wrap" }, h("table", { class: "table" },
        h("thead", null, h("tr", null, ["Wave", "Opportunities", "Net annual benefit", "One-time cost", "Time freed up"].map(col => h("th", { scope: "col" }, col)))),
        h("tbody", null, page.waves.map(w => h("tr", null,
          h("td", null, w.label), h("td", { class: "num" }, String(w.recordIds.length)),
          h("td", { class: "num" }, w.netAnnualBenefit === null ? h("span", { class: "muted" }, "No estimate yet") : units.formatMeasure(w.netAnnualBenefit, "currency", c)),
          h("td", { class: "num" }, w.oneTimeCost === null ? h("span", { class: "muted" }, "Not entered") : units.formatMeasure(w.oneTimeCost, "currency", c)),
          h("td", { class: "num" }, w.fteReleased === null ? h("span", { class: "muted" }, "No estimate yet") : util.formatNumber(w.fteReleased, 1) + " FTE")))))),
      page.notes.map(n => h("p", { class: "note" }, n)));
  }

  function goalNames(goals, ids) {
    const names = goals.filter(g => (ids || []).includes(g.id)).map(g => g.title);
    return names.length ? names.join("; ") : h("span", { class: "muted" }, "None linked");
  }

  /* The client's value goals with what each is measured by and the opportunities that serve it. */
  function goalsTable(goals, rows) {
    const titleOf = id => ((rows || []).find(r => r.recordId === id) || {}).title || id;
    return h("div", { class: "table-wrap" }, h("table", { class: "table", id: "bc-goals" },
      h("thead", null, h("tr", null, ["Goal", "Kind", "Measure", "Target", "By", "Basis"].concat(rows ? ["Served by"] : []).map(col => h("th", { scope: "col" }, col)))),
      h("tbody", null, goals.map(g => h("tr", null,
        h("td", null, g.title), h("td", null, g.kindLabel),
        h("td", null, g.metric || h("span", { class: "muted" }, "Not set")),
        h("td", null, g.target || h("span", { class: "muted" }, "Not set")),
        h("td", null, g.by || h("span", { class: "muted" }, "Not set")),
        h("td", null, basisLabel(g.basis)),
        rows ? h("td", null, g.recordIds.length ? g.recordIds.map(titleOf).join("; ") : h("span", { class: "muted" }, "No opportunity yet")) : null)))));
  }

  const CHECKPOINT_STATUS = { met: "Met", partial: "Partially met", "not-yet": "Not yet", worse: "Worse", "not-measurable": "Not measurable" };

  function checkpointsTable(rows, c) {
    const fig = f => f ? units.formatMeasure(f.value, f.unit, c) + " (" + basisWord(f.basis) + ")" : h("span", { class: "muted" }, "Not calculated");
    return h("div", { class: "table-wrap" }, h("table", { class: "table", id: "bc-checkpoints" },
      h("thead", null, h("tr", null, ["Checkpoint", "Date", "Realized hours a year", "Realized net benefit", "Status"].map(col => h("th", { scope: "col" }, col)))),
      h("tbody", null, rows.map(x => h("tr", null,
        h("td", null, x.label), h("td", null, x.date || h("span", { class: "muted" }, "No date")),
        h("td", { class: "num" }, fig(x.realized)), h("td", { class: "num" }, fig(x.realizedMoney)),
        h("td", null, CHECKPOINT_STATUS[x.status] || x.status))))));
  }

  /* Each part of a business case with its gross, realizable and confirmed figures. */
  function partsTable(parts, c) {
    const money = v => v === null ? h("span", { class: "muted" }, "Not set") : units.formatMeasure(v, "currency", c);
    return h("div", { class: "table-wrap" }, h("table", { class: "table", id: "bc-parts" },
      h("thead", null, h("tr", null, ["Value", "How it becomes money", "Gross a year", "Realizable a year", "Confirmed a year"].map((col, i) => h("th", { scope: "col", class: i > 1 ? "num" : null }, col)))),
      h("tbody", null, parts.map(p => h("tr", null,
        h("td", null, h("div", { class: "title-cell" }, p.label), h("div", { class: "desc" }, p.treatmentLabel + (p.gross !== null ? ", " + basisWord(p.basis) + " basis" : ""))),
        h("td", null, p.realizedBy || h("span", { class: "muted" }, "Not described"), p.financeOwner ? h("div", { class: "desc" }, "Finance owner: " + p.financeOwner) : null),
        h("td", { class: "num" }, p.gross === null ? h("span", { class: "muted" }, "Needs " + (p.missing[0] || "inputs").toLowerCase()) : money(p.gross)),
        h("td", { class: "num" }, p.realizable === null ? h("span", { class: "muted" }, "Not set") : money(p.realizable),
          p.realizationPct !== null ? h("div", { class: "desc" }, util.formatNumber(p.realizationPct, 1) + "% of gross") : null),
        h("td", { class: "num" }, money(p.validated), p.validatedSource ? h("div", { class: "desc" }, p.validatedSource) : null))))));
  }

  /* Client and project name above a page title, or the process name when neither is set. */
  function eyebrowOf(e) {
    const text = [e.meta.clientDisplayName, e.meta.engagementName].filter(Boolean).join(", ") || e.meta.processName || "";
    return text ? h("p", { class: "eyebrow" }, text) : null;
  }

  function onePagerArticle(page, c, e) {
    if (!page) return h("p", { class: "note" }, "Choose an opportunity to see its business case.");
    const stat = o => h("div", { class: "stat" },
      h("span", { class: "v" }, o.value === null ? "Not calculated" : o.key === "paybackMonths" ? util.formatNumber(o.value, 1) + " months" : units.formatMeasure(o.value, o.unit, c)),
      h("span", { class: "l" }, o.label),
      h("span", { class: "s" }, o.value === null ? "Needs " + o.missing.join(", ").toLowerCase() : "From " + basisWord(o.basis) + " inputs"));
    return h("article", { class: "handoff-doc bc-onepager", id: "bc-onepager" },
      eyebrowOf(e),
      h("h1", null, "Business case: " + page.title),
      h("dl", { class: "facts" },
        h("dt", null, "Owner"), h("dd", null, page.owner || "Unassigned"),
        h("dt", null, "Type of change"), h("dd", null, page.intervention || "Not chosen"),
        h("dt", null, "Effort"), h("dd", null, page.effort || "Not set"),
        h("dt", null, "Wave"), h("dd", null, page.waveLabel + (page.suggestedWave ? " (suggested: " + schema.label("wave", page.suggestedWave) + ")" : "")),
        h("dt", null, "Confidence"), h("dd", null, page.confidenceLabel)),
      page.hasValueCase ? h("div", { class: "stat-row" }, page.outputs.map(stat)) :
        h("p", { class: "note" }, page.notes[0] || "This opportunity has no business case yet. Open it in Findings to add one."),
      page.parts && page.parts.length ? [h("h2", null, "Value by type"), partsTable(page.parts, c),
        h("p", { class: "note" }, "Gross is what the change is worth on all the work it touches. Realizable is the share with a named way to become money. Confirmed is what Finance validated.")] : null,
      page.goals.length ? [h("h2", null, "Value goals it serves"), goalsTable(page.goals, null)] : null,
      page.checkpoints.length ? [h("h2", null, "Results at checkpoints"), checkpointsTable(page.checkpoints, c),
        h("p", { class: "note" }, "Realized figures come from hours per case the delivery team recorded after the change.")] : null,
      page.affectedSteps.length ? [h("h2", null, "Affected steps"), h("p", null, page.affectedSteps.join(", "))] : null,
      page.skippedSteps.length ? h("p", { class: "note" }, "Not counted as work steps: " + page.skippedSteps.join(", ") + ".") : null,
      page.note ? [h("h2", null, "Note"), h("p", null, page.note)] : null,
      page.hasValueCase && page.notes.length ? h("ul", { class: "plain-list small" }, page.notes.map(n => h("li", null, n))) : null);
  }

  function businessCaseMode(content, ctx) {
    const e = ctx.engagement;
    const opts = { scenarioId: ctx.scenarioId, includeSensitive: ctx.includeSensitive, includeUnreviewedAi: ctx.includeUnreviewedAi };
    const page = businessCase.buildPortfolioPager(e, opts);
    if (presentSelection && !page.rows.some(r => r.recordId === presentSelection)) presentSelection = "";
    const selId = "bc-present-select";
    const sel = h("select", { class: "select", id: selId },
      h("option", { value: "" }, "All opportunities"),
      page.rows.map(r => h("option", { value: r.recordId, selected: r.recordId === presentSelection }, r.title)));
    sel.addEventListener("change", () => { presentSelection = sel.value; ctx.rerender(); });
    content.appendChild(h("div", { class: "no-print field", style: { maxWidth: "360px", marginBottom: "var(--space-4)" } },
      h("label", { for: selId }, "Show"), sel));
    if (!page.rows.length) { content.appendChild(h("p", { class: "note" }, "No opportunities yet. Select a step in Process and add one.")); return; }
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
            h("td", { class: "num" }, r.value === null ? h("span", { class: "muted" }, "No estimate yet") : units.formatMeasure(r.value, r.unit, c) + " a year"),
            h("td", null, r.basis ? basisLabel(r.basis) : h("span", { class: "muted" }, "None")),
            h("td", null, r.quadrantLabel || h("span", { class: "muted" }, "Not placed")),
            h("td", null, r.waveLabel)))))),
        page.total.netAnnualBenefit !== null ? h("p", null, "All planned waves together: " + units.formatMeasure(page.total.netAnnualBenefit, "currency", c) + " modeled net annual benefit.") : null,
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
