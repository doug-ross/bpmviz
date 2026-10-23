/*
 * AIxRay ranges: a low and a high value for each figure in an opportunity's
 * business case, and what they do to it. Each figure is moved to its low
 * and its high with the others held (which inputs matter most), and the
 * combined low and high cases set every figure to the end of its range that
 * lowers or raises the value. The investment case uses these two cases for
 * its low and high cases. See docs/value-dimensions.md, step 3.
 *
 * Figures are named as in the review form: vc.<key> for the labor
 * estimate, vl.<lineId>.<key> for a value line, and as.<key> for a project
 * assumption the business case reads (hourly rate, annual volume). A blank
 * end of a range counts as today's value. Pure Node/browser library; it
 * loads before validation and reaches value-case only when it computes.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./util.js"), require("./economics.js"), require("./value-lines.js"), () => require("./value-case.js"));
  } else {
    const B = root.AIxRay = root.AIxRay || {};
    B.ranges = factory(B.util, B.economics, B.valueLines, () => B.valueCase);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, economics, valueLines, valueCaseOf) {
  "use strict";

  const LIMIT = 60;
  const FIELD = /^(vc\.[A-Za-z]{1,40}|as\.[A-Za-z]{1,40}|vl\.[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}\.[A-Za-z]{1,40})$/;
  /* The labor estimate's figures, in the editor's order. */
  const LABOR_FIELDS = [
    ["effortReductionPct", "Effort reduction", "percent", 100],
    ["durationReductionPct", "Duration reduction", "percent", 100],
    ["shareOfCasesPct", "Share of cases affected", "percent", 100],
    ["oneTimeCost", "One-time cost", "currency", null],
    ["annualRunningCost", "Annual running cost", "currency", null],
    ["realizationPct", "Share of the labor value that can be realized", "percent", 100]
  ];
  /* Project assumptions every business case reads. */
  const ASSUMPTION_KEYS = ["hourlyRate", "annualVolume"];

  const plain = x => util.isPlainObject(x) ? x : {};
  const nonNegative = x => util.isFiniteNumber(x) && x >= 0 ? x : null;
  const lowerFirst = t => t.charAt(0).toLowerCase() + t.slice(1);

  /** The ranges in shape: { "<field>": { low, high } }, or undefined when absent. */
  function sanitizeRanges(raw) {
    if (raw === undefined || raw === null) return undefined;
    const out = {};
    Object.keys(plain(raw)).filter(k => FIELD.test(k)).slice(0, LIMIT).forEach(k => {
      const r = plain(raw[k]);
      const low = nonNegative(r.low), high = nonNegative(r.high);
      if (low !== null || high !== null) out[k] = { low, high };
    });
    return out;
  }

  function scenarioOf(e, opts) {
    const id = opts && opts.scenarioId;
    return id ? (e.scenarios || []).find(s => s.id === id) || null : null;
  }

  /**
   * The figures of a business case that can take a range, with today's value:
   * [{ field, label, value, unit, max }]. max is 100 for a percentage.
   */
  function fieldsOf(e, record, opts) {
    const o = (record && record.opportunity) || {};
    const out = [];
    const vc = o.valueCase;
    if (vc) {
      LABOR_FIELDS.forEach(([key, label, unit, max]) => {
        if (key === "shareOfCasesPct" && vc.shareSource === "dataset") return;
        if (util.isFiniteNumber(vc[key])) out.push({ field: "vc." + key, label, value: vc[key], unit, max });
      });
    }
    (Array.isArray(o.valueLines) ? o.valueLines : []).forEach(line => {
      const dim = valueLines.DIMENSIONS[line.dimension];
      if (!dim) return;
      dim.inputs.forEach(d => {
        const v = line.inputs && line.inputs[d.key];
        if (util.isFiniteNumber(v)) out.push({ field: "vl." + line.id + "." + d.key, label: dim.label + ", " + lowerFirst(d.label), value: v, unit: d.unit, max: d.kind === "percent" ? 100 : null });
      });
      if (util.isFiniteNumber(line.realizationPct)) {
        out.push({ field: "vl." + line.id + ".realizationPct", label: dim.label + ", share that can be realized", value: line.realizationPct, unit: "percent", max: 100 });
      }
    });
    if (vc || out.length) {
      const drivers = economics.driverMap(e, scenarioOf(e, opts));
      ASSUMPTION_KEYS.forEach(key => {
        const d = drivers[key];
        if (d && util.isFiniteNumber(d.value)) out.push({ field: "as." + key, label: d.label, value: d.value, unit: d.unit || (key === "hourlyRate" ? "currencyPerHour" : "casesPerYear"), max: null });
      });
    }
    return out;
  }

  /*
   * The engagement and record with some figures set to other values:
   * { e, record }. Only what changes is copied.
   */
  function variant(e, record, opts, values) {
    const rec = util.clone(record);
    let eng = e;
    Object.keys(values).forEach(field => {
      const v = values[field];
      const parts = field.split(".");
      const o = rec.opportunity;
      if (parts[0] === "vc" && o.valueCase) o.valueCase[parts[1]] = v;
      else if (parts[0] === "vl") {
        const key = parts[parts.length - 1], lineId = parts.slice(1, -1).join(".");
        const line = (o.valueLines || []).find(l => l.id === lineId);
        if (line && key === "realizationPct") line.realizationPct = v;
        else if (line) line.inputs = Object.assign({}, line.inputs, { [key]: v });
      } else if (parts[0] === "as") {
        // A project assumption, or the scenario's own value for it when the scenario overrides it.
        if (eng === e) eng = Object.assign({}, e, { assumptions: util.clone(e.assumptions || []), scenarios: util.clone(e.scenarios || []) });
        const s = scenarioOf(eng, opts);
        if (s && s.economics && s.economics.overrides && s.economics.overrides[parts[1]]) s.economics.overrides[parts[1]].value = v;
        const a = eng.assumptions.find(x => x.key === parts[1]);
        if (a) a.value = v;
      }
    });
    return { e: eng, record: rec };
  }

  /**
   * What the ranges do to an opportunity's business case, or null when it
   * has none. The figure tested is the business case's headline (the
   * realizable value, else the net annual benefit, else hours saved).
   * { figure: { key, label, unit, value }, rows: [{ field, label, unit,
   *   value, low, high, atLow, atHigh, spread }] (widest first), low, high
   *   ({ value, settings, record, result }), notes }.
   */
  function analyze(e, record, opts) {
    const ranges = record && record.opportunity && record.opportunity.ranges;
    if (!ranges || !Object.keys(ranges).length) return null;
    const valueCase = valueCaseOf();
    const base = valueCase.compute(e, record, opts);
    const head = valueCase.headline(base);
    const notes = [];
    if (!head) return { figure: null, rows: [], low: null, high: null, notes: ["The business case has no figure yet to test the ranges on."] };
    const label = (base.outputs.find(o => o.key === head.key) || {}).label || head.key;
    const run = values => {
      const v = variant(e, record, opts, values);
      const result = valueCase.compute(v.e, v.record, opts);
      const o = result.outputs.find(x => x.key === head.key);
      return { value: o && o.value !== null ? o.value : null, record: v.record, result };
    };
    const fields = fieldsOf(e, record, opts);
    const rows = fields.filter(f => ranges[f.field]).map(f => {
      const r = ranges[f.field];
      const atLow = r.low !== null ? run({ [f.field]: r.low }).value : null;
      const atHigh = r.high !== null ? run({ [f.field]: r.high }).value : null;
      const ends = [head.value, atLow, atHigh].filter(x => x !== null);
      return { field: f.field, label: f.label, unit: f.unit, value: f.value, low: r.low, high: r.high, atLow, atHigh,
        spread: ends.length > 1 ? Math.max(...ends) - Math.min(...ends) : 0 };
    }).sort((a, b) => b.spread - a.spread);
    const unused = Object.keys(ranges).filter(k => !fields.some(f => f.field === k)).length;
    if (unused) notes.push(unused + (unused === 1 ? " range is for a figure" : " ranges are for figures") + " no longer set in the business case, so " + (unused === 1 ? "it is" : "they are") + " left out.");

    // Every figure at the end of its range that lowers, or raises, the value. Today's value counts as an end.
    const pick = better => Object.fromEntries(rows.map(r => {
      const ends = [[r.value, head.value], [r.low, r.atLow], [r.high, r.atHigh]].filter(([x, y]) => x !== null && y !== null);
      return [r.field, ends.reduce((a, b) => (better(b[1], a[1]) ? b : a))[0]];
    }));
    const lowSettings = pick((x, y) => x < y), highSettings = pick((x, y) => x > y);
    const low = Object.assign({ settings: lowSettings }, run(lowSettings));
    const high = Object.assign({ settings: highSettings }, run(highSettings));
    notes.push("Each figure is moved to its low and its high with the others held. The low case sets every figure to the end of its range that lowers the value, and the high case to the end that raises it.");
    return { figure: { key: head.key, label, unit: head.unit, value: head.value }, rows, low, high, notes };
  }

  return { LIMIT, FIELD, sanitizeRanges, fieldsOf, variant, analyze };
});
