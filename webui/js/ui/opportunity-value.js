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

  /* Lowercases only the first letter, so step names keep their own capitals mid-sentence. */
  const lowerFirst = t => t.charAt(0).toLowerCase() + t.slice(1);

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
    /*
     * The cost per error, built up per error type: how often it happens now
     * and after the change, where it starts and is caught, and the steps it
     * makes people redo. Their touch effort, at the project's hourly rate,
     * is the correction labor.
     */
    const model = e.models.find(m => m.id === record.linkedModelId) || e.models.find(m => m.role === "current") || null;
    const taskSteps = model ? model.nodes.filter(n => !n.removed && schema.typeInfo(n.semanticType).shape === "task") : [];
    const drivers = B.economics.driverMap(e, ctx.scenarioId ? (e.scenarios || []).find(x => x.id === ctx.scenarioId) || null : null);
    const costCtx = {
      hourlyRate: B.economics.helpers.driverInput(drivers, "hourlyRate"),
      step: id => {
        const n = taskSteps.find(x => x.id === id);
        const t = n && n.measures && n.measures.touchEffort;
        const hours = t && util.isFiniteNumber(t.value) ? (t.unit === "hour" ? t.value : t.unit === "minute" ? t.value / 60 : null) : null;
        return n ? { label: n.label, hours, basis: n.provenance && n.provenance.validation === "validated" ? "validated" : "supplied" } : null;
      }
    };
    const stepLabel = n => {
      const t = n.measures && n.measures.touchEffort;
      return n.label + (t && util.isFiniteNumber(t.value) ? " (" + units.formatMeasure(t.value, t.unit, unitsCtxOf(e)) + ")" : " (no touch effort)");
    };

    function errorTypesEditor(line, pre) {
      const editors = [];
      const list = h("div", { class: "bc-et-list", id: pre + "types" });
      const add = h("button", { type: "button", class: "btn", id: pre + "add-type" }, "Add an error type");
      function typeEditor(t) {
        const tp = pre + "et-" + t.id + "-";
        const name = textInput(t.name, tp + "name", valueLines.TEXT.errorName);
        const severity = h("select", { class: "select", id: tp + "severity" }, valueLines.SEVERITIES.map(([v, l]) => h("option", { value: v, selected: v === (t.severity || "moderate") }, l)));
        const perMonth = numberInput(t.perMonth, "Errors per month today", { min: 0, id: tp + "per-month" });
        const perMonthAfter = numberInput(t.perMonthAfter, "Errors per month after the change", { min: 0, id: tp + "per-month-after" });
        const stepSelect = (value, id, label) => h("select", { class: "select", id, "aria-label": label },
          h("option", { value: "" }, "Not chosen"), taskSteps.map(n => h("option", { value: n.id, selected: n.id === value }, n.label)));
        const origin = stepSelect(t.originNodeId, tp + "origin", "Where the error starts");
        const detected = stepSelect(t.detectedNodeId, tp + "detected", "Where the error is caught");
        const redo = taskSteps.map(n => ({ n, box: h("input", { type: "checkbox", id: tp + "redo-" + n.id, checked: (t.redoNodeIds || []).includes(n.id) }) }));
        const investigation = numberInput(t.investigationHours, "Hours spent finding and investigating it", { min: 0, id: tp + "investigation" });
        const direct = numberInput(t.directCost, "Credits, write-offs and penalties per error", { min: 0, id: tp + "direct" });
        const risk = numberInput(t.riskCost, "Expected cost per error of rare severe consequences", { min: 0, id: tp + "risk" });
        const typeBasis = enumSelect("assumptionStatus", t.basis || "illustrative", { id: tp + "basis" });
        const cost = h("p", { class: "small", role: "status", id: tp + "cost" });
        const remove = h("button", { type: "button", class: "btn btn-ghost", id: tp + "remove" }, "Remove error type");
        const value = () => ({
          id: t.id, name: name.value, severity: severity.value, perMonth: numberOf(perMonth), perMonthAfter: numberOf(perMonthAfter),
          originNodeId: origin.value || null, detectedNodeId: detected.value || null, redoNodeIds: redo.filter(x => x.box.checked).map(x => x.n.id),
          investigationHours: numberOf(investigation), directCost: numberOf(direct), riskCost: numberOf(risk), basis: typeBasis.value, note: t.note || ""
        });
        function showCost() {
          const v = valueLines.errorTypeOf(Object.assign(value(), { name: value().name || "Error" }));
          const c = v ? valueLines.errorTypeCost(v, costCtx) : null;
          const fmt = x => units.formatMeasure(x, "currency", unitsCtxOf(e));
          cost.textContent = !c ? "" : c.costPerError === null ? "Cost per error needs " + c.missing.map(lowerFirst).join(", ") + "." :
            "Cost per error " + fmt(c.costPerError) + (c.laborHours ? " (" + util.formatNumber(c.laborHours, 2) + " hours of work)" : "") +
            (c.yearlyToday !== null ? ". Today " + fmt(c.yearlyToday) + " a year" : "") + (c.yearlyAvoided !== null ? ", avoided " + fmt(c.yearlyAvoided) + " a year." : ".");
        }
        [name, perMonth, perMonthAfter, investigation, direct, risk].forEach(x => x.addEventListener("input", () => { showCost(); updatePreview(); }));
        [severity, origin, detected, typeBasis].concat(redo.map(x => x.box)).forEach(x => x.addEventListener("change", () => { showCost(); updatePreview(); }));
        const box = h("fieldset", { class: "bc-et", id: tp + "box" },
          h("legend", null, "Error type"),
          h("div", { class: "field-row" }, field("What goes wrong", name), field("Severity", severity)),
          h("div", { class: "field-row" }, field("Errors per month today", perMonth), field("Errors per month after the change", perMonthAfter)),
          h("div", { class: "field-row" }, field("Where it starts", origin), field("Where it is caught", detected)),
          taskSteps.length ? h("fieldset", { class: "bc-et-redo" }, h("legend", null, "Steps people redo to fix it"),
            h("div", { class: "bc-et-steps" }, redo.map(x => h("label", { class: "check" }, x.box, stepLabel(x.n))))) :
            h("p", { class: "small muted" }, "This process has no work steps to choose from."),
          h("div", { class: "field-row" }, field("Hours finding and investigating it", investigation), field("Credits, write-offs and penalties per error", direct)),
          h("div", { class: "field-row" }, field("Expected cost of rare severe consequences, per error", risk), field("Basis", typeBasis)),
          cost, h("div", { class: "form-actions" }, remove));
        const ed = { el: box, value };
        remove.addEventListener("click", () => { editors.splice(editors.indexOf(ed), 1); box.remove(); updatePreview(); });
        showCost();
        return ed;
      }
      function addType(t) { const ed = typeEditor(t); editors.push(ed); list.appendChild(ed.el); return ed; }
      add.addEventListener("click", () => {
        const linked = (record.linkedNodeIds || []).filter(id => taskSteps.some(n => n.id === id));
        const ed = addType({ id: valueLines.newErrorTypeId("error", editors.map(x => x.value())), name: "", severity: "moderate",
          originNodeId: linked[0] || null, redoNodeIds: linked, basis: "illustrative" });
        ed.el.querySelector("input").focus();
        updatePreview();
      });
      (line.errorTypes || []).forEach(addType);
      return {
        el: h("div", { class: "bc-et-section" },
          h("p", { class: "field-label" }, "Cost per error, by error type"),
          h("p", { class: "small muted" }, "Optional. Trace a real error: where it starts, where it is caught, and which steps people redo. Their touch effort at the hourly rate is the correction work. With error types, this line uses them instead of the error rates and cost per error above."),
          list, add),
        value: () => editors.map(x => x.value()).filter(t => t.name.trim())
      };
    }

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
      const fallbackHint = d => d.fallback === "annualVolume" ? "Leave blank to use the project's annual volume." :
        d.fallback === "hourlyRate" ? "Leave blank to use the project's hourly rate." : undefined;
      const types = line.dimension === "rework" ? errorTypesEditor(line, pre) : null;
      const box = h("fieldset", { class: "bc-vl", id: pre + "box" },
        h("legend", null, dim.label, h("span", { class: "formula" }, " " + valueLines.TREATMENTS[dim.treatment].label)),
        h("p", { class: "small muted" }, dim.hint),
        h("div", { class: "field-row" }, inputs.map(x => field(x.d.label + (x.d.kind === "percent" ? " (%)" : ""), x.el, fallbackHint(x.d)))),
        h("div", { class: "field-row" }, field("Basis", lineBasis), field("Share that can be realized (%)", lineRealization)),
        h("div", { class: "field-row" }, field("How it becomes money", lineRealizedBy), field("Finance owner", lineOwner)),
        h("div", { class: "field-row" }, field("Amount Finance confirmed per year", lineValidated), field("Where the confirmed amount comes from", lineSource)),
        types ? types.el : null,
        field("Note", lineNote),
        h("div", { class: "form-actions" }, remove));
      const ed = {
        el: box,
        value: () => ({
          id: line.id, dimension: line.dimension, inputs: Object.fromEntries(inputs.map(x => [x.d.key, numberOf(x.el)])),
          realizationPct: numberOf(lineRealization), realizedBy: lineRealizedBy.value, financeOwner: lineOwner.value,
          validatedAnnual: numberOf(lineValidated), validatedSource: lineSource.value, basis: lineBasis.value, note: lineNote.value,
          errorTypes: types ? types.value() : undefined
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

    /*
     * The business case over time (lib/investment.js): adoption by year,
     * costs by category, a discount rate, low and high cases, and a
     * gain-share fee priced on the value Finance confirmed.
     */
    const inv = B.investment;
    const invStored = (record.opportunity && record.opportunity.investment) || null;
    const invAt = invStored || { horizonYears: 3, adoptionPct: [], costs: [] };
    const invHorizon = h("select", { class: "select", id: "bc-inv-horizon" },
      inv.HORIZONS.map(n => h("option", { value: String(n), selected: n === invAt.horizonYears }, n + " years")));
    const invRate = numberInput(invAt.discountRatePct, "Discount rate, percent", { min: 0, max: 50, id: "bc-inv-rate" });
    const adoptionRow = h("div", { class: "field-row", id: "bc-inv-adoption" });
    let adoption = [];
    function drawAdoption(values) {
      adoption = Array.from({ length: Number(invHorizon.value) }, (_, i) => {
        const el = numberInput(values[i], "Adoption in year " + (i + 1) + ", percent", { min: 0, max: 100, id: "bc-inv-adopt-" + (i + 1) });
        el.addEventListener("input", updatePreview);
        return el;
      });
      adoptionRow.replaceChildren(...adoption.map((el, i) => field("Year " + (i + 1) + " (%)", el)));
    }
    drawAdoption(invAt.adoptionPct || []);
    invHorizon.addEventListener("change", () => { drawAdoption(adoption.map(numberOf)); updatePreview(); });
    const rampButton = h("button", { type: "button", class: "btn btn-ghost", id: "bc-inv-ramp" }, "Use a typical ramp: 50%, 90%, then 100%");
    rampButton.addEventListener("click", () => { adoption.forEach((el, i) => { el.value = String([50, 90][i] || 100); }); updatePreview(); });

    const costEditors = [];
    const costList = h("div", { class: "bc-et-list", id: "bc-inv-costs" });
    function costEditor(c) {
      const pre = "bc-inv-" + c.id + "-";
      const category = h("select", { class: "select", id: pre + "category" }, inv.CATEGORIES.map(([v, l]) => h("option", { value: v, selected: v === c.category }, l)));
      const oneTime = numberInput(c.oneTime, "One-time cost", { min: 0, id: pre + "one-time" });
      const yearly = numberInput(c.yearly, "Cost per year", { min: 0, id: pre + "yearly" });
      const costNote = textInput(c.note, pre + "note", 300);
      const remove = h("button", { type: "button", class: "btn btn-ghost", id: pre + "remove" }, "Remove cost");
      [oneTime, yearly].forEach(x => x.addEventListener("input", updatePreview));
      category.addEventListener("change", updatePreview);
      const box = h("fieldset", { class: "bc-et", id: pre + "box" },
        h("legend", null, "Cost"),
        h("div", { class: "field-row" }, field("Category", category), field("What it covers", costNote)),
        h("div", { class: "field-row" }, field("One-time", oneTime), field("Per year", yearly)),
        h("div", { class: "form-actions" }, remove));
      const ed = { el: box, value: () => ({ id: c.id, category: category.value, note: costNote.value, oneTime: numberOf(oneTime), yearly: numberOf(yearly) }) };
      remove.addEventListener("click", () => { costEditors.splice(costEditors.indexOf(ed), 1); box.remove(); updatePreview(); });
      return ed;
    }
    function addCost(c) { const ed = costEditor(c); costEditors.push(ed); costList.appendChild(ed.el); return ed; }
    (invAt.costs || []).forEach(addCost);
    const costKind = h("select", { class: "select", id: "bc-inv-add-category", "aria-label": "Kind of cost to add" },
      inv.CATEGORIES.map(([v, l]) => h("option", { value: v }, l)));
    const costAdd = h("button", { type: "button", class: "btn", id: "bc-inv-add-cost" }, "Add a cost");
    costAdd.addEventListener("click", () => {
      const ed = addCost({ id: inv.newCostId(costKind.value, costEditors.map(x => x.value())), category: costKind.value, note: "", oneTime: null, yearly: null });
      ed.el.querySelector("input").focus();
      updatePreview();
    });
    const invWorkflows = numberInput(invAt.successfulWorkflowsPerYear, "Successful workflows per year", { min: 0, id: "bc-inv-workflows" });
    const invLow = numberInput(invAt.lowPct, "Low case, percent of the expected benefit", { min: 0, max: 100, id: "bc-inv-low" });
    const invHigh = numberInput(invAt.highPct, "High case, percent of the expected benefit", { min: 0, max: 300, id: "bc-inv-high" });
    const invShare = numberInput(invAt.gainSharePct, "Gain-share, percent of confirmed value", { min: 0, max: 100, id: "bc-inv-share" });
    const invMonths = numberInput(invAt.gainShareMonths, "Gain-share period in months", { min: 1, max: 60, step: "1", id: "bc-inv-share-months" });
    [invRate, invWorkflows, invLow, invHigh, invShare, invMonths].forEach(x => x.addEventListener("input", updatePreview));
    const invPreview = h("p", { class: "note", role: "status", id: "bc-inv-preview" });
    const invValue = () => ({
      horizonYears: Number(invHorizon.value), discountRatePct: numberOf(invRate), adoptionPct: adoption.map(numberOf),
      costs: costEditors.map(x => x.value()), successfulWorkflowsPerYear: numberOf(invWorkflows),
      lowPct: numberOf(invLow), highPct: numberOf(invHigh), gainSharePct: numberOf(invShare), gainShareMonths: numberOf(invMonths)
    });
    const invTouched = v => v.discountRatePct !== null || v.adoptionPct.some(x => x !== null) || v.costs.length > 0 ||
      v.successfulWorkflowsPerYear !== null || v.lowPct !== null || v.highPct !== null || v.gainSharePct !== null;

    function touchedFields(vc) {
      return vc.effortReductionPct !== null || vc.durationReductionPct !== null ||
        vc.shareOfCasesPct !== null || vc.oneTimeCost !== null || vc.datasetId !== null;
    }

    /*
     * A low and a high value for each figure (lib/ranges.js). The table lists
     * the figures the business case has now, so it is rebuilt when a figure
     * is set or cleared or a value line is added or removed; what was typed
     * is kept by figure.
     */
    const rangeStored = (record.opportunity && record.opportunity.ranges) || null;
    const rangeTyped = new Map(Object.entries(rangeStored || {}).map(([k, v]) => [k, { low: v.low, high: v.high }]));
    const rangeBody = h("tbody", { id: "bc-rng-rows" });
    const rangePreview = h("p", { class: "note", role: "status", id: "bc-rng-preview" });
    let rangeKey = null, rangeFields = [];
    const rangeId = field => "bc-rng-" + field.replace(/[^A-Za-z0-9_-]/g, "-");
    function syncRanges(draft) {
      rangeFields = B.ranges.fieldsOf(e, draft, { scenarioId: ctx.scenarioId });
      const key = rangeFields.map(f => f.field).join("|");
      const today = f => units.formatMeasure(f.value, f.unit, unitsCtxOf(e));
      if (key === rangeKey) {
        rangeFields.forEach(f => { const cell = document.getElementById(rangeId(f.field) + "-today"); if (cell) cell.textContent = today(f); });
        return;
      }
      rangeKey = key;
      rangeBody.replaceChildren(...rangeFields.map(f => {
        const typed = rangeTyped.get(f.field) || { low: null, high: null };
        const end = side => {
          const el = numberInput(typed[side], f.label + ", " + side, { min: 0, max: f.max === null ? undefined : String(f.max), id: rangeId(f.field) + "-" + side });
          el.addEventListener("input", () => {
            const t = rangeTyped.get(f.field) || { low: null, high: null };
            t[side] = numberOf(el);
            rangeTyped.set(f.field, t);
            updatePreview();
          });
          return el;
        };
        return h("tr", null, h("td", null, f.label), h("td", { class: "num", id: rangeId(f.field) + "-today" }, today(f)), h("td", null, end("low")), h("td", null, end("high")));
      }));
    }
    /* The ranges typed for the figures the business case has now. */
    function currentRanges() {
      const out = {};
      rangeFields.forEach(f => { const t = rangeTyped.get(f.field); if (t && (t.low !== null || t.high !== null)) out[f.field] = { low: t.low, high: t.high }; });
      return out;
    }

    /* The record as the editor has it now, for the previews. */
    function draftRecord() {
      const vc = currentValueCase();
      return Object.assign({}, record, { opportunity: Object.assign({}, record.opportunity,
        touchedFields(vc) ? { valueCase: vc } : { valueCase: undefined }, { valueLines: valueLines.sanitizeLines(currentLines()).lines }, { ranges: currentRanges() }) });
    }

    function updatePreview() {
      updateValuePreview();
      syncRanges(draftRecord());
      updateInvestmentPreview(updateRangePreview());
    }

    function updateRangePreview() {
      const draft = draftRecord();
      if (!Object.keys(draft.opportunity.ranges).length) {
        rangePreview.textContent = "Give a low and a high for the figures you are least sure of, to see the low and high case and which figure matters most.";
        return null;
      }
      let r;
      try { r = B.ranges.analyze(e, draft, { scenarioId: ctx.scenarioId }); } catch (err) { rangePreview.textContent = "These ranges don't give a low and high case. Check the numbers you entered."; return null; }
      if (!r || !r.figure) { rangePreview.textContent = r ? r.notes[0] : ""; return null; }
      const fmt = v => v === null ? "not calculated" : units.formatMeasure(v, r.figure.unit, unitsCtxOf(e));
      rangePreview.textContent = "Low case " + fmt(r.low.value) + " and high case " + fmt(r.high.value) + ", against " + fmt(r.figure.value) + " (" + lowerFirst(r.figure.label) + ")." +
        (r.rows.length && r.rows[0].spread > 0 ? " Matters most: " + lowerFirst(r.rows[0].label) + "." : "");
      return r;
    }

    function updateInvestmentPreview(spread) {
      const v = invValue();
      if (!invTouched(v)) { invPreview.textContent = "Fill in adoption by year and a discount rate to see NPV, ROI and payback over " + v.horizonYears + " years."; return; }
      const draft = draftRecord();
      draft.opportunity.investment = inv.sanitizeInvestment(v);
      let r;
      try { r = inv.compute(draft, valueCase.compute(e, draft, { scenarioId: ctx.scenarioId }), spread && spread.low && spread.high ? { low: spread.low, high: spread.high } : null); } catch (err) { invPreview.textContent = "These figures don't give an investment case. Check the numbers you entered."; return; }
      const fmt = x => units.formatMeasure(x, "currency", unitsCtxOf(e));
      const complete = r.totalCost !== null;
      const said = [
        r.npv !== null ? "NPV " + fmt(r.npv) + " over " + r.horizonYears + " years at " + util.formatNumber(r.discountRatePct, 1) + "%" : "NPV needs " + r.missing.map(lowerFirst).join(", "),
        r.roiPct !== null ? "ROI " + util.formatNumber(r.roiPct, 1) + "%" : null,
        r.paybackMonths !== null ? "payback in " + util.formatNumber(r.paybackMonths, 1) + " months" : complete ? "no payback within " + r.horizonYears + " years" : null
      ].filter(Boolean).join(", ") + ".";
      const cases = [["Low", r.scenarios.low], ["high", r.scenarios.high]].filter(([, x]) => x && x.npv !== null).map(([l, x]) => l + " case NPV " + fmt(x.npv)).join(", ");
      invPreview.textContent = [said, cases ? cases.charAt(0).toUpperCase() + cases.slice(1) + "." : "",
        r.costPerSuccessfulWorkflow !== null ? "Cost per successful workflow " + fmt(r.costPerSuccessfulWorkflow) + "." : "",
        r.gainShare ? (r.gainShare.fee !== null ? "Gain-share fee " + fmt(r.gainShare.fee) + "." : "The gain-share fee waits for an amount Finance confirmed.") : "",
        r.base.kind === "modeled" ? "This uses the modeled value, as nothing is marked realizable yet." : ""].filter(Boolean).join(" ");
    }

    function updateValuePreview() {
      datasetField.hidden = !needsDataset();
      shareField.hidden = shareSourceSel.value === "dataset";
      const vc = currentValueCase();
      const lines = currentLines();
      if (!touchedFields(vc) && !lines.length) { preview.textContent = "Fill in the effort or duration reduction, or add another kind of value, to see what this opportunity could be worth."; return; }
      const draft = draftRecord();
      let result;
      try { result = valueCase.compute(e, draft, { scenarioId: ctx.scenarioId }); } catch (err) { preview.textContent = "These figures don't give an estimate. Check the numbers you entered."; return; }
      const head = valueCase.headline(result);
      if (!head) { preview.textContent = "Not enough to estimate the value yet" + (result.missing.length ? ". Still needed: " + result.missing.map(lowerFirst).join(", ") + "." : "."); return; }
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
      h("details", { class: "bc-inv", id: "bc-rng", open: !!(rangeStored && Object.keys(rangeStored).length) },
        h("summary", { class: "field-label" }, "Low and high for each figure"),
        h("p", { class: "small muted" }, "Optional. For the figures you are least sure of, give the lowest and highest you would believe. Each one is moved on its own to show which matters most, and together they give a low and a high case. With ranges, the investment case uses these instead of a share of the expected benefit."),
        h("div", { class: "table-wrap" }, h("table", { class: "table bc-rng-table", id: "bc-rng-table" },
          h("thead", null, h("tr", null, h("th", { scope: "col" }, "Figure"), h("th", { scope: "col", class: "num" }, "Now"), h("th", { scope: "col" }, "Low"), h("th", { scope: "col" }, "High"))),
          rangeBody)),
        rangePreview),
      h("details", { class: "bc-inv", id: "bc-inv", open: !!invStored },
        h("summary", { class: "field-label" }, "Investment over time"),
        h("p", { class: "small muted" }, "Optional. Spread the yearly value over the years as the change is adopted, count every cost, and see NPV, ROI and payback. Year 0 is the up-front cost."),
        h("div", { class: "field-row" }, field("Horizon", invHorizon), field("Discount rate (%)", invRate, "The rate Finance uses for projects like this, often 8 to 12%.")),
        h("p", { class: "field-label bc-sub" }, "Adoption: the share of the yearly value reached in each year"),
        adoptionRow, h("div", { class: "form-actions" }, rampButton),
        h("p", { class: "field-label bc-sub" }, "Costs"),
        h("p", { class: "small muted" }, "With cost lines, these replace the one-time and annual running cost above. Count review, retries and monitoring, not only the build."),
        costList, h("div", { class: "bc-vl-add" }, costKind, costAdd),
        h("div", { class: "field-row" }, field("Successful workflows per year", invWorkflows, "Gives the cost per workflow that completes correctly."),
          field("Low case (% of expected)", invLow), field("High case (% of expected)", invHigh)),
        h("p", { class: "field-label bc-sub" }, "Gain-share"),
        h("p", { class: "small muted" }, "A fee set as a share of the value Finance confirmed, for a set number of months. It is never priced on a forecast."),
        h("div", { class: "field-row" }, field("Share of confirmed value (%)", invShare), field("Months", invMonths)),
        invPreview),
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
        const iv = invValue();
        if (invStored || invTouched(iv)) out.investment = iv;
        const rv = currentRanges();
        if (rangeStored || Object.keys(rv).length) out.ranges = rv;
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
    if (!head) return h("span", { class: "muted" }, result.missing.length ? "Needs " + lowerFirst(result.missing[0]) : "No estimate yet", draft);
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

  /* The cost of poor quality behind an Errors and rework line, per error type. */
  function errorsTable(part, c) {
    const money = v => v === null ? h("span", { class: "muted" }, "Not calculated") : units.formatMeasure(v, "currency", c);
    const sev = Object.fromEntries(valueLines.SEVERITIES.map(([v, l]) => [v, l.split(":")[0]]));
    const k = part.costOfErrors;
    return [
      h("h3", null, "Cost of errors"),
      h("div", { class: "table-wrap" }, h("table", { class: "table bc-errors" },
        h("thead", null, h("tr", null, ["Error type", "Severity", "Errors a month, today then after", "Cost per error", "Cost a year today", "Avoided a year"].map((col, i) => h("th", { scope: "col", class: i > 1 ? "num" : null }, col)))),
        h("tbody", null, part.errorTypes.map(t => h("tr", null,
          h("td", null, t.name, t.missing.length ? h("div", { class: "desc" }, "Needs " + t.missing.map(lowerFirst).join(", ")) : null),
          h("td", null, sev[t.severity] || t.severity),
          h("td", { class: "num" }, (t.perMonth === null ? "?" : util.formatNumber(t.perMonth, 1)) + " then " + (t.perMonthAfter === null ? "?" : util.formatNumber(t.perMonthAfter, 1))),
          h("td", { class: "num" }, money(t.costPerError)), h("td", { class: "num" }, money(t.yearlyToday)), h("td", { class: "num" }, money(t.yearlyAvoided))))))),
      h("p", { class: "note" }, (k.blendedCostPerError !== null ? "Blended cost per error " + units.formatMeasure(k.blendedCostPerError, "currency", c) + ". " : "") +
        (k.yearlyToday !== null ? "Errors cost " + units.formatMeasure(k.yearlyToday, "currency", c) + " a year today. " : "") +
        "Correction work is the touch effort of the steps redone, at the project's hourly rate.")
    ];
  }

  /* Which figures matter most: each moved to its low and high on its own, then all together. */
  function rangesSection(r, c) {
    const none = text => h("span", { class: "muted" }, text);
    const money = v => v === null ? none("Not calculated") : units.formatMeasure(v, r.figure.unit, c);
    const values = r.rows.flatMap(x => [x.atLow, x.atHigh]).concat([r.figure.value, r.low.value, r.high.value]).filter(v => v !== null);
    const lo = Math.min(...values), span = (Math.max(...values) - lo) || 1;
    const pos = v => ((v - lo) / span * 100) + "%";
    return [
      h("h2", null, "Which figures matter most"),
      h("p", null, "Against " + money(r.figure.value) + " (" + lowerFirst(r.figure.label) + "), the low case is " + money(r.low.value) + " and the high case is " + money(r.high.value) + "."),
      h("div", { class: "table-wrap" }, h("table", { class: "table sens-table", id: "bc-rng-onepager" },
        h("thead", null, h("tr", null, ["Figure", "Value at low", "Value at high", "Range"].map((col, i) => h("th", { scope: "col", class: i > 0 && i < 3 ? "num" : null }, col)))),
        h("tbody", null, r.rows.map(x => {
          const ends = [x.atLow, x.atHigh, r.figure.value].filter(v => v !== null);
          const a = Math.min(...ends), b = Math.max(...ends);
          const tip = x.label + ": " + (x.atLow === null ? "" : money(x.atLow) + " at the low end") + (x.atLow !== null && x.atHigh !== null ? ", " : "") + (x.atHigh === null ? "" : money(x.atHigh) + " at the high end");
          const words = v => v === null ? "not given" : units.formatMeasure(v, x.unit, c);
          return h("tr", null, h("td", null, h("div", { class: "title-cell" }, x.label),
              h("div", { class: "desc" }, "Now " + words(x.value) + ". Low " + words(x.low) + ", high " + words(x.high) + ".")),
            h("td", { class: "num" }, x.low === null ? none("Not given") : money(x.atLow)), h("td", { class: "num" }, x.high === null ? none("Not given") : money(x.atHigh)),
            h("td", { class: "sens-cell" }, h("div", { class: "sens-track", title: tip, role: "img", "aria-label": tip },
              h("span", { class: "sens-bar", style: { left: pos(a), width: "calc(" + pos(b) + " - " + pos(a) + ")" } }),
              h("span", { class: "sens-base", style: { left: pos(r.figure.value) } }))));
        })))),
      h("ul", { class: "plain-list small" }, r.notes.map(n => h("li", null, n)))
    ];
  }

  /* The business case over time: cash flows by year, the low and high cases, costs by category and the gain-share fee. */
  function investmentSection(r, c) {
    const none = text => h("span", { class: "muted" }, text);
    // Cash flows read in whole currency units; the cost per successful workflow keeps its cents.
    const money = v => v === null ? none("Not calculated") : units.formatMeasure(Math.round(v), "currency", c);
    const exact = v => v === null ? none("Not calculated") : units.formatMeasure(v, "currency", c);
    const pct = v => v === null ? none("Not calculated") : util.formatNumber(v, 1) + "%";
    const complete = r.totalCost !== null;
    const months = v => v !== null ? util.formatNumber(v, 1) + " months" : none(complete ? "Not within " + r.horizonYears + " years" : "Not calculated");
    const stat = (v, l, sub) => h("div", { class: "stat" }, h("span", { class: "v" }, v), h("span", { class: "l" }, l), sub ? h("span", { class: "s" }, sub) : null);
    const th = (cols, from) => h("thead", null, h("tr", null, cols.map((col, i) => h("th", { scope: "col", class: i >= from ? "num" : null }, col))));
    const cases = [["Low", r.scenarios.low], ["Expected", r.scenarios.expected], ["High", r.scenarios.high]].filter(([, x]) => x);
    return [
      h("h2", null, "Investment over " + r.horizonYears + " years"),
      h("div", { class: "stat-row", id: "bc-inv-stats" },
        stat(money(r.npv), "Net present value", r.discountRatePct !== null ? "At " + util.formatNumber(r.discountRatePct, 1) + "% a year" : "Needs a discount rate"),
        stat(pct(r.roiPct), "Return on investment", "Over the horizon, undiscounted"),
        stat(months(r.paybackMonths), "Payback"),
        r.costPerSuccessfulWorkflow !== null ? stat(exact(r.costPerSuccessfulWorkflow), "Cost per successful workflow", "Yearly cost over the workflows that complete correctly") : null),
      h("p", { class: "note" }, r.base.value === null ? "The yearly value is not calculated yet." :
        "At full adoption the yearly benefit is " + units.formatMeasure(r.base.value, "currency", c) + ", the " + r.base.kind + " value before running costs."),
      h("div", { class: "table-wrap" }, h("table", { class: "table", id: "bc-inv-years" },
        th(["Year", "Adoption", "Benefit", "Cost", "Net", "Discounted", "Cumulative"], 1),
        h("tbody", null, r.years.map(y => h("tr", null,
          h("td", null, y.year === 0 ? "Year 0, up front" : "Year " + y.year),
          h("td", { class: "num" }, y.year === 0 ? "" : pct(r.adoptionPct[y.year - 1])),
          h("td", { class: "num" }, money(y.benefit)), h("td", { class: "num" }, money(y.cost)), h("td", { class: "num" }, money(y.net)),
          h("td", { class: "num" }, money(y.discounted)), h("td", { class: "num" }, money(y.cumulative))))))),
      cases.length > 1 ? h("div", { class: "table-wrap bc-inv-gap" }, h("table", { class: "table", id: "bc-inv-cases" },
        th(["Case", "Benefit, share of expected", "NPV", "ROI", "Payback"], 1),
        h("tbody", null, cases.map(([l, x]) => h("tr", null, h("td", null, l), h("td", { class: "num" }, x.pct === null ? "From the ranges" : util.formatNumber(x.pct, 0) + "%"),
          h("td", { class: "num" }, money(x.npv)), h("td", { class: "num" }, pct(x.roiPct)), h("td", { class: "num" }, months(x.paybackMonths))))))) : null,
      r.costsByCategory.length ? h("div", { class: "table-wrap bc-inv-gap" }, h("table", { class: "table", id: "bc-inv-costs-table" },
        th(["Cost", "One-time", "Per year"], 1),
        h("tbody", null, r.costsByCategory.map(x => h("tr", null, h("td", null, x.label), h("td", { class: "num" }, money(x.oneTime)), h("td", { class: "num" }, money(x.yearly))))))) : null,
      r.gainShare ? h("p", { id: "bc-inv-gain-share" }, r.gainShare.fee !== null ?
        "Gain-share: " + util.formatNumber(r.gainShare.sharePct, 1) + "% of the " + units.formatMeasure(r.gainShare.confirmedAnnual, "currency", c) +
          " a year Finance confirmed, for " + r.gainShare.months + " months, is a fee of " + units.formatMeasure(r.gainShare.fee, "currency", c) + "." :
        "Gain-share: " + util.formatNumber(r.gainShare.sharePct, 1) + "% of confirmed value for " + r.gainShare.months + " months. No value is confirmed yet, so there is no fee.") : null,
      r.missing.length ? h("p", { class: "note" }, "Still needed: " + r.missing.map(lowerFirst).join(", ") + ".") : null,
      h("ul", { class: "plain-list small" }, r.notes.map(n => h("li", null, n)))
    ];
  }

  /* Each part of a business case with its gross, realizable and confirmed figures. */
  function partsTable(parts, c) {
    const money = v => v === null ? h("span", { class: "muted" }, "Not set") : units.formatMeasure(v, "currency", c);
    return h("div", { class: "table-wrap" }, h("table", { class: "table", id: "bc-parts" },
      h("thead", null, h("tr", null, ["Value", "How it becomes money", "Gross a year", "Realizable a year", "Confirmed a year"].map((col, i) => h("th", { scope: "col", class: i > 1 ? "num" : null }, col)))),
      h("tbody", null, parts.map(p => h("tr", null,
        h("td", null, h("div", { class: "title-cell" }, p.label), h("div", { class: "desc" }, p.treatmentLabel + (p.gross !== null ? ", " + basisWord(p.basis) + " basis" : ""))),
        h("td", null, p.realizedBy || h("span", { class: "muted" }, "Not described"), p.financeOwner ? h("div", { class: "desc" }, "Finance owner: " + p.financeOwner) : null),
        h("td", { class: "num" }, p.gross === null ? h("span", { class: "muted" }, "Needs " + lowerFirst(p.missing[0] || "inputs")) : money(p.gross)),
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
      h("span", { class: "s" }, o.value === null ? "Needs " + o.missing.map(lowerFirst).join(", ") : "From " + basisWord(o.basis) + " inputs"));
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
        page.parts.filter(p => p.costOfErrors).map(p => errorsTable(p, c)),
        h("p", { class: "note" }, "Gross is what the change is worth on all the work it touches. Realizable is the share with a named way to become money. Confirmed is what Finance validated.")] : null,
      page.ranges && page.ranges.figure ? rangesSection(page.ranges, c) : null,
      page.investment ? investmentSection(page.investment, c) : null,
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
