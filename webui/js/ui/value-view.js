/*
 * Value workspace: typed assumptions, formula-backed outputs with their
 * inputs, and reconciliation of supplied figures against the assumptions.
 */
(function (root) {
  "use strict";
  const B = root.AIxRay = root.AIxRay || {};
  const { h, clear, icon } = B.dom;
  const { schema, units, economics, util } = B;
  const badge = (t, tone) => B.drawer.badge(t, tone);
  const BASIS_TONE = { illustrative: "warning", supplied: "info", observed: "success", validated: "success" };
  const RECON_TONE = { reconciled: "success", unreconciled: "error", "not-checkable": "" };
  const RECON_TEXT = { reconciled: "Adds up", unreconciled: "Does not add up", "not-checkable": "Cannot check yet" };
  /* The display label of a basis or input status: "Provided" for supplied, "Measured" for observed. */
  const basisLabel = status => schema.label("assumptionStatus", status);

  function createValueView(app) {
    const el = {};
    const eng = () => app.store.get();

    function build() {
      el.body = h("div");
      el.scenarioSel = h("select", { class: "select", id: "vv-scenario" });
      el.scenarioSel.addEventListener("change", () => { app.view.scenarioId = el.scenarioSel.value; render(); app.syncHash(); });
      el.root = h("div", { class: "ws-scroll" }, h("div", { class: "page" },
        h("div", { class: "page-head" },
          h("div", null, h("h2", null, "What the change is worth"),
            h("p", null, "Every figure shows its formula and inputs, and stays blank until all of its inputs are filled in.")),
          h("div", { class: "field", style: { width: "300px" } }, h("label", { for: "vv-scenario" }, "Scenario"), el.scenarioSel)),
        el.body));
      return el.root;
    }

    function ctxUnits() { return { timeBasis: eng().meta.timeBasis, currency: eng().meta.currency }; }

    function numberInput(value, label, onCommit) {
      const inp = h("input", { class: "input", type: "number", min: 0, step: "any", inputmode: "decimal", value: util.isFiniteNumber(value) ? String(value) : "", "aria-label": label });
      inp.addEventListener("change", () => onCommit(inp.value === "" ? null : Number(inp.value)));
      return inp;
    }

    function statusSelect(value, label, onCommit) {
      const sel = h("select", { class: "select", "aria-label": label }, schema.ENUMS.assumptionStatus.map(v => h("option", { value: v, selected: v === value }, schema.label("assumptionStatus", v))));
      sel.addEventListener("change", () => onCommit(sel.value));
      return sel;
    }

    /* Unit text for a driver row; money shows the project currency, such as "USD per hour". */
    function unitText(unit) {
      const code = eng().meta.currency || "USD";
      if (unit === "currency") return code;
      if (unit === "currencyPerHour") return code + " per hour";
      return units.unitLabel(unit);
    }

    function driversCard() {
      const e = eng();
      const rows = schema.DRIVERS.map(d => {
        const a = e.assumptions.find(x => x.key === d.key);
        const set = patch => app.dispatch("assumption/set", Object.assign({ key: d.key, value: a ? a.value : null }, patch), d.label + " updated");
        return h("div", { class: "driver-row" },
          h("div", null, h("div", null, d.label), h("div", { class: "formula" }, unitText(d.unit) + (a && a.source ? " \u00b7 " + a.source : ""))),
          numberInput(a ? a.value : null, d.label, v => set({ value: v })),
          statusSelect(a ? a.status : "illustrative", d.label + " status", v => set({ status: v })));
      });
      return h("section", { class: "card", "aria-labelledby": "vv-drivers" },
        h("h3", { id: "vv-drivers" }, "Assumptions for all scenarios"),
        h("p", { class: "note" }, "Choose Confirmed only when the people who own a figure have checked it. A figure someone gives you is Provided until then."),
        rows);
    }

    function scenarioCard(s) {
      const e = eng();
      const ids = economics.modelIds(e, s);
      const touch = (s.measures || []).find(m => m.key === "humanTouch");
      const modelName = id => (e.models.find(m => m.id === id) || {}).name || id;
      const hoursRow = id => h("div", { class: "driver-row" },
        h("div", null, "Human hours per case, " + modelName(id)),
        numberInput(touch && touch.values ? touch.values[id] : null, "Human hours, " + modelName(id), v =>
          app.dispatch("measure/set", { scenarioId: s.id, key: "humanTouch", label: "Human touch effort", unit: "hour", modelId: id, value: v }, "Human hours updated")),
        h("span", { class: "formula" }, touch ? schema.label("assumptionStatus", touch.status === "calculated" ? "supplied" : touch.status) || "" : "Not provided"));
      const overrides = (s.economics && s.economics.overrides) || {};
      const overrideRows = ["incrementalCostPerCase", "beforeNonLaborCostPerCase", "afterNonLaborCostPerCase"].map(key => {
        const d = schema.DRIVERS.find(x => x.key === key);
        const o = overrides[key];
        return h("div", { class: "driver-row" },
          h("div", null, h("div", null, d.label), h("div", { class: "formula" }, o ? "Replaces the project value in this scenario" : "Uses the project value")),
          numberInput(o ? o.value : null, d.label + ", this scenario only", v => app.dispatch("scenario/override", { scenarioId: s.id, key, value: v, status: o ? o.status : "supplied" }, "Value for this scenario updated")),
          o ? statusSelect(o.status, d.label + ", this scenario only, status", v => app.dispatch("scenario/override", { scenarioId: s.id, key, value: o.value, status: v }, "Status updated")) : h("span"));
      });
      return h("section", { class: "card", "aria-labelledby": "vv-scn" },
        h("h3", { id: "vv-scn" }, "Inputs for " + s.name),
        hoursRow(ids.before), ids.after ? hoursRow(ids.after) : null,
        ids.after ? h("div", null, h("p", { class: "section-title", style: { marginTop: "var(--space-3)" } }, "Values for this scenario only"), overrideRows) : null);
    }

    function resultsCard(s) {
      const value = economics.computeValue(eng(), s);
      const c = ctxUnits();
      const pick = key => value.outputs.find(o => o.key === key);
      const headline = ["costSaved", "capacityFte", "cycleReduction"].map(pick).filter(Boolean);
      const statBlock = o => h("div", { class: "stat" },
        h("span", { class: "v" }, o.value === null ? "Not calculated" : o.unit === "fte" ? util.formatNumber(o.value, 1) + " FTE" : units.formatMeasure(o.value, o.unit, c)),
        h("span", { class: "l" }, o.label),
        h("span", { class: "s" }, o.value === null ? "Needs " + o.missing.join(", ").toLowerCase() : "From " + basisLabel(o.basis).toLowerCase() + " inputs"));
      const rows = value.outputs.map(o => h("tr", null,
        h("td", null, h("div", { class: "title-cell" }, o.label), h("div", { class: "formula" }, o.formula),
          o.notes.map(n => h("div", { class: "formula" }, n))),
        h("td", { class: "num" }, o.value === null ? h("span", { class: "muted" }, "Not calculated") :
          h("span", { class: "result-value" }, o.key === "paybackMonths" ? util.formatNumber(o.value, 1) + " months" : units.formatMeasure(o.value, o.unit, c))),
        h("td", null, h("ul", { class: "plain-list small" }, o.inputs.map(i => h("li", null,
          i.label + ": " + (util.isFiniteNumber(i.value) ? units.formatMeasure(i.value, i.unit, c) : (i.required === false ? "not provided (optional)" : "missing")) +
          (util.isFiniteNumber(i.value) && i.status ? " (" + basisLabel(i.status).toLowerCase() + ")" : ""))))),
        h("td", null, o.value === null ? badge("Missing input", "") : badge(basisLabel(o.basis), BASIS_TONE[o.basis]))));
      return h("section", { class: "card", "aria-labelledby": "vv-res" },
        h("h3", { id: "vv-res" }, "Modeled results for " + s.name),
        headline.length ? h("div", { class: "stat-row" }, headline.map(statBlock)) : null,
        h("div", { class: "table-wrap" }, h("table", { class: "table" },
          h("caption", { class: "sr-only" }, "Figures with their formulas and inputs"),
          h("thead", null, h("tr", null, h("th", { scope: "col" }, "Figure and formula"), h("th", { scope: "col", class: "num" }, "Result"), h("th", { scope: "col" }, "Inputs"), h("th", { scope: "col" }, "Based on"))),
          h("tbody", null, rows))),
        h("p", { class: "note" }, "Each result is only as strong as its weakest input. Illustrative inputs give illustrative results, however precise they look."));
    }

    let sensKey = "costSaved", sensPct = 20;

    function sensitivityCard(s) {
      const c = ctxUnits();
      const outputSel = h("select", { class: "select", id: "vv-sens-output" },
        [["costSaved", "Modeled cost difference per case"], ["capacityFte", "Time freed up"], ["annualCostDifference", "Modeled annual cost difference"], ["afterCost", "Future-state cost per case"]]
          .map(([v, l]) => h("option", { value: v, selected: v === sensKey }, l)));
      const pctSel = h("select", { class: "select", id: "vv-sens-pct" }, [10, 20, 30].map(v => h("option", { value: v, selected: v === sensPct }, v + "%")));
      outputSel.addEventListener("change", () => { sensKey = outputSel.value; render(); document.getElementById("vv-sens-output").focus(); });
      pctSel.addEventListener("change", () => { sensPct = Number(pctSel.value); render(); document.getElementById("vv-sens-pct").focus(); });
      const r = economics.sensitivity(eng(), s, sensKey, sensPct);
      const fmt = v => r.unit === "fte" ? util.formatNumber(v, 2) + " FTE" : units.formatMeasure(v, r.unit, c);
      let body;
      if (r.base === null) {
        body = h("p", { class: "small muted" }, "This figure cannot be calculated yet. Fill in its inputs first.");
      } else {
        const lo = Math.min(r.base, ...r.rows.map(x => Math.min(x.low, x.high)));
        const hi = Math.max(r.base, ...r.rows.map(x => Math.max(x.low, x.high)));
        const span = hi - lo || 1;
        const pos = v => ((v - lo) / span * 100) + "%";
        body = h("div", { class: "table-wrap" }, h("table", { class: "table sens-table" },
          h("caption", { class: "sr-only" }, "Effect of each input on " + r.label),
          h("thead", null, h("tr", null, h("th", { scope: "col" }, "Input"),
            h("th", { scope: "col", class: "num" }, "Down " + r.pct + "%"), h("th", { scope: "col", class: "num" }, "Up " + r.pct + "%"),
            h("th", { scope: "col" }, "Range around " + fmt(r.base)))),
          h("tbody", null, r.rows.map(row => {
            const a = Math.min(row.low, row.high), b = Math.max(row.low, row.high);
            const tip = row.label + ": " + fmt(row.low) + " when " + r.pct + "% lower, " + fmt(row.high) + " when " + r.pct + "% higher";
            return h("tr", null, h("td", null, row.label),
              h("td", { class: "num" }, fmt(row.low)), h("td", { class: "num" }, fmt(row.high)),
              h("td", { class: "sens-cell" }, h("div", { class: "sens-track", title: tip, role: "img", "aria-label": tip },
                h("span", { class: "sens-bar", style: { left: pos(a), width: "calc(" + pos(b) + " - " + pos(a) + ")" } }),
                h("span", { class: "sens-base", style: { left: pos(r.base) } }))));
          }))));
      }
      return h("section", { class: "card", "aria-labelledby": "vv-sens" },
        h("h3", { id: "vv-sens" }, "Which inputs matter most"),
        h("p", { class: "note" }, "Each input is moved down and up while the others stay the same. The wider the range, the more a better estimate of that input matters."),
        h("div", { class: "filters" }, h("div", { class: "field grow" }, h("label", { for: "vv-sens-output" }, "Figure"), outputSel),
          h("div", { class: "field" }, h("label", { for: "vv-sens-pct" }, "Move each input by"), pctSel)),
        body);
    }

    function reconciliationCard() {
      const e = eng();
      const c = ctxUnits();
      const rows = [];
      e.scenarios.forEach(s => {
        if (!s.economics) return;
        const r = economics.reconcileScenario(e, s);
        r.checks.forEach(chk => rows.push(h("tr", null,
          h("td", null, s.name), h("td", null, chk.label),
          h("td", { class: "num" }, units.formatMeasure(chk.supplied, chk.unit, c)),
          h("td", { class: "num" }, chk.calculated === null ? h("span", { class: "muted" }, "n/a") : units.formatMeasure(chk.calculated, chk.unit, c)),
          h("td", null, badge(RECON_TEXT[chk.status], RECON_TONE[chk.status])),
          h("td", { class: "small" }, chk.impliedIncremental != null ? "Implies " + units.formatMeasure(chk.impliedIncremental, "currency", c) + " incremental cost per case" :
            chk.status === "not-checkable" ? "Needs " + (chk.missing || []).join(", ").toLowerCase() : ""))));
      });
      const notes = economics.engagementNotes(e);
      return h("section", { class: "card", "aria-labelledby": "vv-rec" },
        h("h3", { id: "vv-rec" }, "Do the provided figures add up?"),
        rows.length ? h("div", { class: "table-wrap" }, h("table", { class: "table" },
          h("caption", { class: "sr-only" }, "Provided figures checked against the assumptions"),
          h("thead", null, h("tr", null, ["Scenario", "Figure", "Provided", "Calculated", "Check", "Note"].map((x, i) => h("th", { scope: "col", class: i === 2 || i === 3 ? "num" : "" }, x)))),
          h("tbody", null, rows))) : h("p", { class: "small muted" }, "No provided cost or capacity figures to check."),
        h("p", { class: "note" }, "A figure that does not add up is still shown as provided, and is never used in place of a calculated result. If the difference has a real cause, enter a value for this scenario only under Inputs."),
        notes.map(n => h("div", { class: "warn-line" }, icon("info"), h("span", null, n.message))));
    }

    /* Sections registered with AIxRay.ext.registerValueSection, after the reconciliation card. */
    function extSections(s) {
      const c = B.ext.context(app, { scenario: s || null, scenarioId: s ? s.id : "", rerender: render });
      return B.ext.list("valueSection").map(def => B.ext.guard("valueSection", def, () => def.render(c), null)).filter(x => x instanceof Node);
    }

    function render() {
      if (!el.root) return;
      const e = eng();
      clear(el.scenarioSel);
      e.scenarios.forEach(s => el.scenarioSel.appendChild(h("option", { value: s.id, selected: s.id === app.view.scenarioId }, s.name)));
      el.scenarioSel.disabled = !e.scenarios.length;
      clear(el.body);
      const s = e.scenarios.find(x => x.id === app.view.scenarioId) || e.scenarios[0];
      if (!s) {
        el.body.append(h("div", { class: "value-grid" }, h("div", null, driversCard()),
          h("div", { class: "card" }, h("h3", null, "No scenario yet"), h("p", { class: "small" }, "Figures are worked out per scenario, and this project has none. Import an event log to make scenarios from it, or open a project that has them."))));
        const extra = extSections(null);
        if (extra.length) el.body.append(h("div", { class: "value-stack" }, extra));
        return;
      }
      // The answer first (what the change is worth), then the inputs behind it, then the checks.
      el.body.append(
        resultsCard(s),
        h("div", { class: "value-grid", style: { marginTop: "var(--space-5)" } }, driversCard(), scenarioCard(s)),
        h("div", { class: "value-stack" }, s.economics ? sensitivityCard(s) : null, reconciliationCard(), extSections(s)));
    }

    return { build, render, onEngagementChange: render };
  }

  B.valueView = { createValueView };
})(typeof globalThis !== "undefined" ? globalThis : this);
