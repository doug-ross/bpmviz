/*
 * Value workspace: typed assumptions, formula-backed outputs with their
 * inputs, and reconciliation of supplied figures against the assumptions.
 */
(function (root) {
  "use strict";
  const B = root.BPMVIZ = root.BPMVIZ || {};
  const { h, clear, icon } = B.dom;
  const { schema, units, economics, util } = B;
  const badge = (t, tone) => B.drawer.badge(t, tone);
  const BASIS_TONE = { illustrative: "warning", supplied: "info", observed: "success", validated: "success" };
  const RECON_TONE = { reconciled: "success", unreconciled: "error", "not-checkable": "" };
  const RECON_TEXT = { reconciled: "Reconciles", unreconciled: "Does not reconcile", "not-checkable": "Cannot check" };

  function createValueView(app) {
    const el = {};
    const eng = () => app.store.get();

    function build() {
      el.body = h("div");
      el.scenarioSel = h("select", { class: "select", id: "vv-scenario" });
      el.scenarioSel.addEventListener("change", () => { app.view.scenarioId = el.scenarioSel.value; render(); app.syncHash(); });
      el.root = h("div", { class: "ws-scroll" }, h("div", { class: "page" },
        h("div", { class: "page-head" },
          h("div", null, h("h2", null, "Value model"),
            h("p", null, "Every figure shows its formula and inputs. A missing input leaves the figure blank, nothing is assumed to be zero, and supplied figures are checked against the assumptions.")),
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

    function driversCard() {
      const e = eng();
      const rows = schema.DRIVERS.map(d => {
        const a = e.assumptions.find(x => x.key === d.key);
        const set = patch => app.dispatch("assumption/set", Object.assign({ key: d.key, value: a ? a.value : null }, patch), d.label + " updated");
        return h("div", { class: "driver-row" },
          h("div", null, h("div", null, d.label), h("div", { class: "formula" }, units.unitLabel(d.unit) + (a && a.source ? " \u00b7 " + a.source : ""))),
          numberInput(a ? a.value : null, d.label, v => set({ value: v })),
          statusSelect(a ? a.status : "illustrative", d.label + " status", v => set({ status: v })));
      });
      return h("section", { class: "card", "aria-labelledby": "vv-drivers" },
        h("h3", { id: "vv-drivers" }, "Assumptions for every scenario"),
        h("p", { class: "note" }, "Mark a value validated only when the client has confirmed it. A client-provided number is supplied, not validated."),
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
        h("span", { class: "formula" }, touch ? schema.label("assumptionStatus", touch.status === "calculated" ? "supplied" : touch.status) || "" : "Not supplied"));
      const overrides = (s.economics && s.economics.overrides) || {};
      const overrideRows = ["incrementalCostPerCase", "beforeNonLaborCostPerCase", "afterNonLaborCostPerCase"].map(key => {
        const d = schema.DRIVERS.find(x => x.key === key);
        const o = overrides[key];
        return h("div", { class: "driver-row" },
          h("div", null, h("div", null, d.label), h("div", { class: "formula" }, o ? "Overrides the engagement value for this scenario" : "Uses the engagement value")),
          numberInput(o ? o.value : null, d.label + " override", v => app.dispatch("scenario/override", { scenarioId: s.id, key, value: v, status: o ? o.status : "supplied" }, "Scenario override updated")),
          o ? statusSelect(o.status, d.label + " override status", v => app.dispatch("scenario/override", { scenarioId: s.id, key, value: o.value, status: v }, "Override status updated")) : h("span"));
      });
      return h("section", { class: "card", "aria-labelledby": "vv-scn" },
        h("h3", { id: "vv-scn" }, "Inputs for " + s.name),
        hoursRow(ids.before), ids.after ? hoursRow(ids.after) : null,
        ids.after ? h("div", null, h("p", { class: "section-title", style: { marginTop: "var(--space-3)" } }, "Scenario overrides"), overrideRows) : null);
    }

    function resultsCard(s) {
      const value = economics.computeValue(eng(), s);
      const c = ctxUnits();
      const pick = key => value.outputs.find(o => o.key === key);
      const headline = ["costSaved", "capacityFte", "cycleReduction"].map(pick).filter(Boolean);
      const statBlock = o => h("div", { class: "stat" },
        h("span", { class: "v" }, o.value === null ? "Not calculated" : o.unit === "fte" ? util.formatNumber(o.value, 1) + " FTE" : units.formatMeasure(o.value, o.unit, c)),
        h("span", { class: "l" }, o.label),
        h("span", { class: "s" }, o.value === null ? "Needs " + o.missing.join(", ").toLowerCase() : "From " + o.basis + " inputs"));
      const rows = value.outputs.map(o => h("tr", null,
        h("td", null, h("div", { class: "title-cell" }, o.label), h("div", { class: "formula" }, o.formula),
          o.notes.map(n => h("div", { class: "formula" }, n))),
        h("td", { class: "num" }, o.value === null ? h("span", { class: "muted" }, "Not calculated") :
          h("span", { class: "result-value" }, o.key === "paybackMonths" ? util.formatNumber(o.value, 1) + " months" : units.formatMeasure(o.value, o.unit, c))),
        h("td", null, h("ul", { class: "plain-list small" }, o.inputs.map(i => h("li", null,
          i.label + ": " + (util.isFiniteNumber(i.value) ? units.formatMeasure(i.value, i.unit, c) : (i.required === false ? "not supplied (optional)" : "missing")) +
          (util.isFiniteNumber(i.value) && i.status ? " (" + i.status + ")" : ""))))),
        h("td", null, o.value === null ? badge("Missing input", "") : badge(o.basis, BASIS_TONE[o.basis]))));
      return h("section", { class: "card", "aria-labelledby": "vv-res" },
        h("h3", { id: "vv-res" }, "Modeled results for " + s.name),
        headline.length ? h("div", { class: "stat-row" }, headline.map(statBlock)) : null,
        h("div", { class: "table-wrap" }, h("table", { class: "table" },
          h("caption", { class: "sr-only" }, "Value outputs with formulas and inputs"),
          h("thead", null, h("tr", null, h("th", { scope: "col" }, "Output and formula"), h("th", { scope: "col", class: "num" }, "Result"), h("th", { scope: "col" }, "Inputs"), h("th", { scope: "col" }, "Basis"))),
          h("tbody", null, rows))),
        h("p", { class: "note" }, "Results inherit the weakest status of their inputs. Illustrative inputs give illustrative results, however precise they look."));
    }

    let sensKey = "costSaved", sensPct = 20;

    function sensitivityCard(s) {
      const c = ctxUnits();
      const outputSel = h("select", { class: "select", id: "vv-sens-output" },
        [["costSaved", "Modeled cost difference per case"], ["capacityFte", "Redeployable capacity"], ["annualCostDifference", "Modeled annual cost difference"], ["afterCost", "Future-state cost per case"]]
          .map(([v, l]) => h("option", { value: v, selected: v === sensKey }, l)));
      const pctSel = h("select", { class: "select", id: "vv-sens-pct" }, [10, 20, 30].map(v => h("option", { value: v, selected: v === sensPct }, v + "%")));
      outputSel.addEventListener("change", () => { sensKey = outputSel.value; render(); document.getElementById("vv-sens-output").focus(); });
      pctSel.addEventListener("change", () => { sensPct = Number(pctSel.value); render(); document.getElementById("vv-sens-pct").focus(); });
      const r = economics.sensitivity(eng(), s, sensKey, sensPct);
      const fmt = v => r.unit === "fte" ? util.formatNumber(v, 2) + " FTE" : units.formatMeasure(v, r.unit, c);
      let body;
      if (r.base === null) {
        body = h("p", { class: "small muted" }, "This output is not calculated yet, so there is nothing to vary. Fill in its inputs first.");
      } else {
        const lo = Math.min(r.base, ...r.rows.map(x => Math.min(x.low, x.high)));
        const hi = Math.max(r.base, ...r.rows.map(x => Math.max(x.low, x.high)));
        const span = hi - lo || 1;
        const pos = v => ((v - lo) / span * 100) + "%";
        body = h("div", { class: "table-wrap" }, h("table", { class: "table sens-table" },
          h("caption", { class: "sr-only" }, "Effect of each input on " + r.label),
          h("thead", null, h("tr", null, h("th", { scope: "col" }, "Input moved " + r.pct + "%"),
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
        h("h3", { id: "vv-sens" }, "Sensitivity"),
        h("p", { class: "note" }, "Each input is moved down and up while the others stay fixed. Wider ranges show where a better estimate matters most."),
        h("div", { class: "filters" }, h("div", { class: "field grow" }, h("label", { for: "vv-sens-output" }, "Output"), outputSel),
          h("div", { class: "field" }, h("label", { for: "vv-sens-pct" }, "Change"), pctSel)),
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
        h("h3", { id: "vv-rec" }, "Supplied figures against the assumptions"),
        rows.length ? h("div", { class: "table-wrap" }, h("table", { class: "table" },
          h("caption", { class: "sr-only" }, "Reconciliation of supplied figures"),
          h("thead", null, h("tr", null, ["Scenario", "Figure", "Supplied", "Calculated", "Status", "Note"].map((x, i) => h("th", { scope: "col", class: i === 2 || i === 3 ? "num" : "" }, x)))),
          h("tbody", null, rows))) : h("p", { class: "small muted" }, "No supplied cost or capacity figures to check."),
        h("p", { class: "note" }, "A figure that does not reconcile stays visible as supplied, and is never promoted to a calculated result. Record a scenario override when the difference has a real cause."),
        notes.map(n => h("div", { class: "warn-line" }, icon("info"), h("span", null, n.message))));
    }

    /* Sections registered with BPMVIZ.ext.registerValueSection, after the reconciliation card. */
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
          h("div", { class: "card" }, h("h3", null, "No scenario to model"), h("p", { class: "small" }, "The value model needs a scenario with human effort per case. Open an engagement with scenario timing, or add one to the engagement file."))));
        const extra = extSections(null);
        if (extra.length) el.body.append(h("div", { class: "value-stack" }, extra));
        return;
      }
      el.body.append(
        h("div", { class: "value-grid" }, driversCard(), scenarioCard(s)),
        h("div", { class: "value-stack" }, resultsCard(s), s.economics ? sensitivityCard(s) : null, reconciliationCard(), extSections(s)));
    }

    return { build, render, onEngagementChange: render };
  }

  B.valueView = { createValueView };
})(typeof globalThis !== "undefined" ? globalThis : this);
