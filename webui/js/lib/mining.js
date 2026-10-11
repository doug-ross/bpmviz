/*
 * AIxRay mining: turns an event log into a dataset of aggregates.
 *
 *  1. Rows become events: case, activity, timestamps (one, or a start and an
 *     end) and an optional resource. Timestamps without an offset are wall
 *     clock and read as UTC, so a daylight-saving change cannot shift a
 *     duration. Rows without a case, an activity or a readable time are
 *     dropped and counted.
 *  2. Events are sorted per case by time, then by row order. Each activity
 *     maps to at most one step; several activities may map to one step.
 *  3. Cases whose last mapped event is not an end step can be left out.
 *  4. Per step: visits, cases, share, rework, and statistics of the duration
 *     (end minus start), the wait (start minus the previous end) and the
 *     sojourn (time since the previous event). Percentiles interpolate
 *     linearly. Directly-follows pairs map to connector paths through
 *     gateways and events only. Variants are the step sequences of cases.
 *  5. A scenario per top variant replays the case whose cycle time is
 *     closest to the median of its variant.
 *
 * The dataset holds aggregates only: never events, case IDs or resource
 * names. Owned by the event-log import feature (mining slice); see
 * docs/extensions.md and docs/event-logs.md.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./util.js"), require("./schema.js"), require("./units.js"), require("./replay.js"),
      require("./validate.js"), require("./store.js"), require("./dataset-query.js"), require("./xlsx.js"));
  } else {
    const B = root.AIxRay = root.AIxRay || {};
    B.mining = factory(B.util, B.schema, B.units, B.replay, B.validate, B.store, B.datasetQuery, B.xlsx);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, schema, units, replayLib, validate, storeLib, datasetQuery, xlsx) {
  "use strict";

  const DAY = 86400000;
  const MIN = 60000;
  const L = schema.LIMITS;
  const PATH_DEPTH = 6;

  /* ---------- Timestamps ---------- */

  const FORMATS = [
    ["iso", "Year first, such as 2026-01-31 14:05"],
    ["dmy", "Day first, such as 31/01/2026 14:05"],
    ["mdy", "Month first, such as 01/31/2026 2:05 PM"],
    ["serial", "Excel date numbers, such as 46053.59"]
  ];
  const OFFSET = "(Z|[+-]\\d{2}(?::?\\d{2})?)?";
  const TIME = "(?:(?:T|\\s+|,\\s*)(\\d{1,2}):(\\d{2})(?::(\\d{2})(?:[.,](\\d{1,9}))?)?\\s*([AaPp]\\.?[Mm]\\.?)?)?";
  const ISO_RE = new RegExp("^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})" + TIME + "\\s*" + OFFSET + "$", "i");
  const SLASH_RE = new RegExp("^(\\d{1,2})[-/.](\\d{1,2})[-/.](\\d{4}|\\d{2})" + TIME + "\\s*" + OFFSET + "$", "i");
  const SERIAL_MAX = 2958465;

  function offsetMinutes(text) {
    if (!text || /^z$/i.test(text)) return 0;
    const m = /^([+-])(\d{2}):?(\d{2})?$/.exec(text);
    if (!m) return null;
    const v = Number(m[2]) * 60 + Number(m[3] || 0);
    return m[1] === "-" ? -v : v;
  }

  /* Milliseconds for a wall-clock date and time, or null when a part is out of range. */
  function utcMs(y, mo, d, hh, mi, ss, frac, ampm, offset) {
    let h = hh === undefined ? 0 : Number(hh);
    const minute = mi === undefined ? 0 : Number(mi);
    const sec = ss === undefined ? 0 : Number(ss);
    if (mo < 1 || mo > 12 || d < 1) return null;
    if (d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
    if (ampm) {
      if (h < 1 || h > 12) return null;
      h = /^p/i.test(ampm) ? (h % 12) + 12 : h % 12;
    }
    if (h > 23 || minute > 59 || sec > 59) return null;
    const ms = frac ? Math.round(Number("0." + frac) * 1000) : 0;
    const off = offsetMinutes(offset);
    if (off === null) return null;
    return Date.UTC(y, mo - 1, d, h, minute, sec, ms) - off * MIN;
  }

  function isSerialValue(v) {
    if (v && typeof v === "object" && Number.isFinite(v.date)) return true;
    const n = typeof v === "number" ? v : (typeof v === "string" && /^\s*\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN);
    return Number.isFinite(n) && n >= 1 && n <= SERIAL_MAX;
  }

  /**
   * One timestamp in milliseconds since 1970 (UTC wall clock), or null.
   * format: iso, dmy, mdy or serial. An Excel date cell ({ date: serial })
   * is read as a date whatever the format.
   */
  function parseTimestamp(value, format, date1904) {
    if (value === null || value === undefined) return null;
    if (typeof value === "object") return Number.isFinite(value.date) ? xlsx.excelSerialToMs(value.date, date1904) : null;
    if (typeof value === "number") return isSerialValue(value) ? xlsx.excelSerialToMs(value, date1904) : null;
    const text = String(value).trim();
    if (!text) return null;
    if (format === "serial") return isSerialValue(text) ? xlsx.excelSerialToMs(Number(text), date1904) : null;
    if (format === "iso") {
      const m = ISO_RE.exec(text);
      return m ? utcMs(Number(m[1]), Number(m[2]), Number(m[3]), m[4], m[5], m[6], m[7], m[8], m[9]) : null;
    }
    if (format === "dmy" || format === "mdy") {
      const m = SLASH_RE.exec(text);
      if (!m) return null;
      let y = Number(m[3]);
      if (m[3].length === 2) y += 2000;
      const a = Number(m[1]), b = Number(m[2]);
      return format === "dmy" ? utcMs(y, b, a, m[4], m[5], m[6], m[7], m[8], m[9]) : utcMs(y, a, b, m[4], m[5], m[6], m[7], m[8], m[9]);
    }
    return null;
  }

  /**
   * The timestamp format that reads the most of values:
   * { format, ambiguous, matched, total }. Day-first and month-first dates
   * are told apart by a part above 12; when no value has one, the result is
   * day first and ambiguous, so the person confirms it.
   */
  function detectTimestampFormat(values) {
    const sample = [];
    for (const v of values || []) {
      if (v === null || v === undefined || String(typeof v === "object" ? (v.date === undefined ? "" : v.date) : v).trim() === "") continue;
      sample.push(v);
      if (sample.length >= 2000) break;
    }
    if (!sample.length) return { format: null, ambiguous: false, matched: 0, total: 0 };
    let iso = 0, serial = 0, slash = 0, maxFirst = 0, maxSecond = 0;
    sample.forEach(v => {
      if (isSerialValue(v)) { serial++; return; }
      const text = String(v).trim();
      if (ISO_RE.test(text)) { iso++; return; }
      const m = SLASH_RE.exec(text);
      if (m) {
        slash++;
        maxFirst = Math.max(maxFirst, Number(m[1]));
        maxSecond = Math.max(maxSecond, Number(m[2]));
      }
    });
    let format = "iso", ambiguous = false;
    if (serial > iso && serial >= slash) format = "serial";
    else if (slash > iso) {
      if (maxSecond > 12 && maxFirst <= 12) format = "mdy";
      else { format = "dmy"; ambiguous = maxFirst <= 12; }
    }
    const matched = sample.filter(v => parseTimestamp(v, format) !== null).length;
    return { format, ambiguous, matched, total: sample.length };
  }

  /* ---------- Columns and events ---------- */

  function headerText(v) {
    return String(v == null ? "" : v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  const COLUMN_PATTERNS = {
    caseId: [/^case concept name$/, /^case( id| number| no| key)?$/, /\bcase\b/,
      /^(ticket|order|claim|submission|request|application|incident|policy|invoice)( id| number| no)?$/, /(^| )id$/],
    activity: [/^concept name$/, /^activity( name)?$/, /\bactivity\b/, /^(event|task|step|action)( name)?$/],
    start: [/^start( time| timestamp| date| date time)?$/, /\bstart(ed)?\b/, /\bbegin\b/],
    end: [/^(end|complete|completion|finish)( time| timestamp| date| date time)?$/, /\b(end|ended|complete|completed|completion|finish|finished)\b/],
    timestamp: [/^time timestamp$/, /^(timestamp|time|date|date time|datetime|event time)$/, /\b(timestamp|time|date)\b/],
    resource: [/^org resource$/, /^(resource|user|performer|agent|employee|operator|owner)( name| id)?$/, /\b(resource|user|performer|employee|operator)\b/]
  };

  /**
   * Guesses which column holds what from the header row:
   * { caseId, activity, timestamp, start, end, resource, mode } with -1 for
   * a column not found. mode is start-end when both a start and an end
   * column are found.
   */
  function guessColumns(header) {
    const names = (header || []).map(headerText);
    const used = new Set();
    const find = key => {
      for (const re of COLUMN_PATTERNS[key]) {
        const i = names.findIndex((n, k) => !used.has(k) && re.test(n));
        if (i >= 0) { used.add(i); return i; }
      }
      return -1;
    };
    const out = { caseId: find("caseId"), activity: find("activity") };
    out.start = find("start");
    out.end = find("end");
    out.timestamp = find("timestamp");
    out.resource = find("resource");
    if (out.start >= 0 && out.end >= 0) out.mode = "start-end";
    else {
      out.mode = "single";
      if (out.timestamp < 0) out.timestamp = out.end >= 0 ? out.end : out.start;
    }
    return out;
  }

  function filled(v) {
    return v !== null && v !== undefined && String(typeof v === "object" ? (v.date === undefined ? "" : v.date) : v).trim() !== "";
  }

  /**
   * Splits rows (from a CSV file or a worksheet) into a header and data:
   * { header, rows, headerRow (1-based), firstDataRow (1-based) }. The header
   * is the first row with at least two filled cells; empty rows are dropped.
   */
  function tableFromRows(rows) {
    const all = rows || [];
    const at = all.findIndex(r => Array.isArray(r) && r.filter(filled).length >= 2);
    if (at < 0) return { header: [], rows: [], headerRow: 0, firstDataRow: 0 };
    const header = all[at].map(v => (filled(v) ? String(typeof v === "object" ? v.date : v).trim() : ""));
    const data = [];
    let firstDataRow = 0;
    for (let i = at + 1; i < all.length; i++) {
      const r = all[i];
      if (!Array.isArray(r) || !r.some(filled)) continue;
      if (!firstDataRow) firstDataRow = i + 1;
      data.push(r);
    }
    return { header, rows: data, headerRow: at + 1, firstDataRow };
  }

  function cellText(row, index) {
    if (index < 0 || !row) return "";
    const v = row[index];
    if (v === null || v === undefined) return "";
    if (typeof v === "object") return v.date === undefined ? "" : String(v.date);
    return String(v).trim();
  }

  const DROP_REASONS = {
    missingCase: "no case ID",
    missingActivity: "no activity name",
    badTimestamp: "a time that could not be read",
    endBeforeStart: "an end before the start"
  };

  /**
   * Reads rows into events, one chunk at a time:
   * { add(rows, firstRowNumber), result() }. cols are column indexes;
   * options: { mode, format, date1904, resources ("dropped" or "counted"), maxEvents, maxCases }.
   * result() gives { events, caseNames, rows, dropped, droppedRows, examples, tooManyEvents, tooManyCases }.
   * Each event is { c (case index), a (activity), s, e (milliseconds), r (resource or null), i (order) }.
   */
  function createEventBuilder(cols, options) {
    const o = options || {};
    const mode = o.mode === "start-end" ? "start-end" : "single";
    const counted = o.resources === "counted";
    const maxEvents = o.maxEvents || L.eventLogEvents;
    const maxCases = o.maxCases || L.eventLogCases;
    const events = [];
    const caseIndex = new Map();
    const caseNames = [];
    const dropped = { missingCase: 0, missingActivity: 0, badTimestamp: 0, endBeforeStart: 0 };
    const examples = [];
    let rows = 0, tooManyEvents = false, tooManyCases = false;
    const drop = (reason, rowNo) => {
      dropped[reason]++;
      if (examples.length < 10) examples.push({ row: rowNo, reason: DROP_REASONS[reason] });
    };
    const time = v => parseTimestamp(v, o.format, o.date1904);

    function add(chunk, firstRowNumber) {
      const first = Number.isFinite(firstRowNumber) ? firstRowNumber : rows + 1;
      for (let k = 0; k < chunk.length; k++) {
        const r = chunk[k];
        rows++;
        const rowNo = first + k;
        const cs = cellText(r, cols.caseId);
        if (!cs) { drop("missingCase", rowNo); continue; }
        const act = cellText(r, cols.activity).replace(/\s+/g, " ").slice(0, 300);
        if (!act) { drop("missingActivity", rowNo); continue; }
        let s, e;
        if (mode === "start-end") {
          s = time(r[cols.start]);
          e = time(r[cols.end]);
          if (s === null || e === null) { drop("badTimestamp", rowNo); continue; }
          if (e < s) { drop("endBeforeStart", rowNo); continue; }
        } else {
          s = e = time(r[cols.timestamp]);
          if (s === null) { drop("badTimestamp", rowNo); continue; }
        }
        if (events.length >= maxEvents) { tooManyEvents = true; continue; }
        let c = caseIndex.get(cs);
        if (c === undefined) {
          if (caseNames.length >= maxCases) { tooManyCases = true; continue; }
          c = caseNames.length;
          caseIndex.set(cs, c);
          caseNames.push(cs);
        }
        events.push({ c, a: act, s, e, r: counted ? (cellText(r, cols.resource) || null) : null, i: events.length });
      }
    }

    function result() {
      const droppedRows = Object.values(dropped).reduce((a, b) => a + b, 0);
      return { events, caseNames, rows, dropped, droppedRows, examples, tooManyEvents, tooManyCases };
    }
    return { add, result };
  }

  /** Activity names with their event counts, most frequent first. */
  function activitiesOf(events) {
    const counts = new Map();
    (events || []).forEach(ev => counts.set(ev.a, (counts.get(ev.a) || 0) + 1));
    return [...counts.entries()].map(([name, n]) => ({ name, events: n }))
      .sort((a, b) => b.events - a.events || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  /* ---------- Time basis ---------- */

  function dow(day) {
    return (((day + 4) % 7) + 7) % 7;
  }
  const isWorkday = w => w >= 1 && w <= 5;

  function workdaysBefore(day) {
    const q = Math.floor(day / 7);
    let count = q * 5;
    for (let k = 0; k < day - q * 7; k++) if (isWorkday(dow(q * 7 + k))) count++;
    return count;
  }

  function cleanBasis(tb) {
    const t = tb || {};
    const calendar = t.calendar === "business" ? "business" : "calendar";
    const perDay = Number.isFinite(t.businessMinutesPerDay) && t.businessMinutesPerDay > 0 ? Math.min(1440, t.businessMinutesPerDay) : 480;
    const dayStart = Number.isInteger(t.dayStartMinute) && t.dayStartMinute >= 0 && t.dayStartMinute < 1440 ? t.dayStartMinute : 540;
    return { calendar, businessMinutesPerDay: perDay, dayStartMinute: dayStart };
  }

  /* Business minutes from 1970 to ms: Monday to Friday, from dayStartMinute for businessMinutesPerDay minutes. */
  function businessAt(ms, tb) {
    const per = Math.min(tb.businessMinutesPerDay, 1440 - tb.dayStartMinute);
    const day = Math.floor(ms / DAY);
    const minute = (ms - day * DAY) / MIN;
    let v = workdaysBefore(day) * per;
    if (isWorkday(dow(day))) v += Math.min(per, Math.max(0, minute - tb.dayStartMinute));
    return v;
  }

  /** Minutes between two instants in a time basis (calendar, or business time with working hours). */
  function elapsedMinutes(ms0, ms1, timeBasis) {
    const tb = cleanBasis(timeBasis);
    if (tb.calendar === "business") return businessAt(ms1, tb) - businessAt(ms0, tb);
    return (ms1 - ms0) / MIN;
  }

  function sameBasis(a, b) {
    const x = cleanBasis(a), y = cleanBasis(b);
    return x.calendar === y.calendar && (x.calendar === "calendar" || x.businessMinutesPerDay === y.businessMinutesPerDay);
  }

  /* ---------- Statistics ---------- */

  const round = (v, digits) => {
    const f = Math.pow(10, digits == null ? 2 : digits);
    return Math.round(v * f) / f;
  };

  function percentile(sorted, p) {
    if (!sorted.length) return null;
    const pos = (sorted.length - 1) * p;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  /** { n, mean, min, p10, p25, p50, p75, p90, max } with linear interpolation, or null for no values. */
  function statsOf(values) {
    const a = (values || []).filter(Number.isFinite).slice().sort((x, y) => x - y);
    if (!a.length) return null;
    const sum = a.reduce((s, v) => s + v, 0);
    return {
      n: a.length, mean: round(sum / a.length), min: round(a[0]),
      p10: round(percentile(a, 0.1)), p25: round(percentile(a, 0.25)), p50: round(percentile(a, 0.5)),
      p75: round(percentile(a, 0.75)), p90: round(percentile(a, 0.9)), max: round(a[a.length - 1])
    };
  }

  /* ---------- The model ---------- */

  function shapeOf(node) {
    return node ? schema.typeInfo(node.semanticType).shape : "";
  }

  /* Gateways and events can be passed through on the way between two mapped steps. */
  function passable(node) {
    const s = shapeOf(node);
    return s === "gateway" || s === "event" || s === "start" || s === "end";
  }

  function graphOf(model) {
    const nodes = new Map(model.nodes.filter(n => !n.removed).map(n => [n.id, n]));
    const out = new Map();
    model.edges.forEach(e => {
      if (e.removed || !nodes.has(e.from) || !nodes.has(e.to)) return;
      if (!out.has(e.from)) out.set(e.from, []);
      out.get(e.from).push(e);
    });
    return { nodes, out, cache: new Map() };
  }

  /*
   * The shortest connector path from one node to a node accepted by isGoal,
   * passing only through gateways and events, at most PATH_DEPTH connectors.
   * Returns the connectors in order, or null.
   */
  function searchPath(graph, from, isGoal) {
    const queue = [{ node: from, path: [] }];
    const seen = new Set([from]);
    while (queue.length) {
      const { node, path } = queue.shift();
      if (path.length >= PATH_DEPTH) continue;
      for (const e of graph.out.get(node) || []) {
        const next = path.concat([e]);
        if (isGoal(e.to)) return next;
        if (seen.has(e.to) || !passable(graph.nodes.get(e.to))) continue;
        seen.add(e.to);
        queue.push({ node: e.to, path: next });
      }
    }
    return null;
  }

  /** Connector IDs from one step to the next through gateways and events only, or null when there is no such path. */
  function edgePath(model, from, to, graph) {
    const g = graph || graphOf(model);
    const key = from + "\u0001" + to;
    if (!g.cache.has(key)) {
      const p = searchPath(g, from, id => id === to);
      g.cache.set(key, p);
    }
    const p = g.cache.get(key);
    return p ? p.map(e => e.id) : null;
  }

  /**
   * Mapped steps that can finish a case: end events, and steps that reach an
   * end event through gateways and events only.
   */
  function defaultEndNodes(model, mappedNodeIds) {
    const g = graphOf(model);
    const isEnd = id => shapeOf(g.nodes.get(id)) === "end";
    return [...new Set(mappedNodeIds || [])].filter(id => g.nodes.has(id) && (isEnd(id) || !!searchPath(g, id, isEnd)));
  }

  /** The steps an activity may map to: everything except gateways and removed steps. */
  function mappableSteps(model) {
    return model ? model.nodes.filter(n => !n.removed && shapeOf(n) !== "gateway") : [];
  }

  /* ---------- Aggregation ---------- */

  function provenanceOf(dataStatus) {
    const b = datasetQuery.basisOf({ dataStatus });
    return b === "observed" ? "observed" : b === "illustrative" ? "illustrative" : "supplied";
  }

  function measureStatusOf(dataStatus) {
    const b = datasetQuery.basisOf({ dataStatus });
    return b === "observed" ? "observed" : "supplied";
  }

  function iso(ms) {
    return new Date(ms).toISOString();
  }

  /**
   * Aggregates events into a dataset and the scenarios for its top variants.
   * input: {
   *   model, events, caseNames, mapping: { activity: { nodeId, method } } (or a Map),
   *   mode ("single" or "start-end"), timeBasis, scenarioTimeBasis (the engagement's),
   *   endNodeIds (cases must end at one of them when requireEnd), requireEnd,
   *   resources ("dropped" or "counted"), caseIds ("hashed", "sequence" or "original"),
   *   hashCase(originalId) -> label (needed for hashed IDs), topVariants (scenarios to make),
   *   name, role, comparesToDatasetId, dataStatus, createdAt, notes,
   *   source: { fileName, format, sha256, rows, droppedRows }
   * }
   * Returns { dataset, scenarios, warnings: [{ code, message }], counts }.
   * The dataset ID is "ds-new" and scenarios carry provisional IDs; the
   * dataset/import command assigns the final ones.
   */
  function aggregate(input) {
    const o = input || {};
    const model = o.model;
    const mode = o.mode === "start-end" ? "start-end" : "single";
    const tb = cleanBasis(o.timeBasis);
    const scnTb = cleanBasis(o.scenarioTimeBasis || o.timeBasis);
    const counted = o.resources === "counted";
    const graph = graphOf(model);
    const warnings = [];
    const mapping = o.mapping instanceof Map ? o.mapping : new Map(Object.entries(o.mapping || {}));
    const nodeFor = new Map();
    mapping.forEach((m, activity) => {
      const id = m && typeof m === "object" ? m.nodeId : m;
      const node = id ? graph.nodes.get(id) : null;
      if (node && shapeOf(node) !== "gateway") nodeFor.set(activity, id);
    });
    const endSet = new Set(o.endNodeIds || []);
    const requireEnd = o.requireEnd !== false && endSet.size > 0;
    const el = (a, b) => elapsedMinutes(a, b, tb);

    const byCase = new Map();
    (o.events || []).forEach(ev => {
      if (!byCase.has(ev.c)) byCase.set(ev.c, []);
      byCase.get(ev.c).push(ev);
    });

    const steps = new Map();
    const stepOf = id => {
      if (!steps.has(id)) steps.set(id, { visits: 0, cases: 0, rework: 0, duration: [], wait: [], sojourn: [], resources: new Set(), hDen: 0, hNum: 0 });
      return steps.get(id);
    };
    const pairs = new Map();
    const variants = new Map();
    const cycles = [], perCase = [];
    let included = 0, complete = 0, excludedIncomplete = 0, noMapped = 0, unmatched = 0;
    let outOfOrder = 0, tied = 0, overlaps = 0;
    let first = Infinity, last = -Infinity;
    const activityEvents = new Map();

    byCase.forEach((list, c) => {
      list.forEach(ev => activityEvents.set(ev.a, (activityEvents.get(ev.a) || 0) + 1));
      let sortedAlready = true;
      for (let k = 1; k < list.length; k++) if (list[k].s < list[k - 1].s) { sortedAlready = false; break; }
      if (!sortedAlready) outOfOrder++;
      list.sort((a, b) => a.s - b.s || a.i - b.i);
      for (let k = 1; k < list.length; k++) if (list[k].s === list[k - 1].s) { tied++; break; }
      const mapped = [];
      list.forEach(ev => {
        const id = nodeFor.get(ev.a);
        if (id) mapped.push({ ev, id });
      });
      if (!mapped.length) { noMapped++; return; }
      const ends = endSet.has(mapped[mapped.length - 1].id);
      if (requireEnd && !ends) { excludedIncomplete++; return; }
      included++;
      if (ends) complete++;
      const caseStart = mapped[0].ev.s;
      const caseEnd = mapped.reduce((m, x) => Math.max(m, x.ev.e), -Infinity);
      first = Math.min(first, caseStart);
      last = Math.max(last, caseEnd);
      const cycle = el(caseStart, caseEnd);
      cycles.push(cycle);
      perCase.push(list.length);
      const seen = new Map();
      mapped.forEach((x, k) => {
        const st = stepOf(x.id);
        st.visits++;
        seen.set(x.id, (seen.get(x.id) || 0) + 1);
        const prev = k ? mapped[k - 1] : null;
        if (mode === "start-end") {
          st.duration.push(el(x.ev.s, x.ev.e));
          if (prev) {
            if (x.ev.s < prev.ev.e) { overlaps++; st.wait.push(0); } else st.wait.push(el(prev.ev.e, x.ev.s));
            st.sojourn.push(x.ev.e >= prev.ev.e ? el(prev.ev.e, x.ev.e) : 0);
          }
        } else if (prev) {
          st.sojourn.push(el(prev.ev.s, x.ev.s));
        }
        if (counted && x.ev.r) {
          st.resources.add(x.ev.r);
          if (prev && prev.ev.r) { st.hDen++; if (prev.ev.r !== x.ev.r) st.hNum++; }
        }
        if (prev) {
          const key = prev.id + "\u0001" + x.id;
          pairs.set(key, (pairs.get(key) || 0) + 1);
        }
      });
      seen.forEach((n, id) => { const st = stepOf(id); st.cases++; if (n > 1) st.rework++; });
      // Variants are told apart by the steps that are stored, so two long
      // variants that differ only after LIMITS.variantSteps steps are one row.
      const ids = mapped.map(x => x.id);
      const stored = ids.slice(0, L.variantSteps);
      const key = stored.join("\u0001");
      if (!variants.has(key)) variants.set(key, { nodeIds: stored, truncated: false, members: [], order: variants.size });
      if (ids.length > stored.length) variants.get(key).truncated = true;
      variants.get(key).members.push({ c, cycle });
    });

    activityEvents.forEach((n, a) => { if (!nodeFor.has(a)) unmatched += n; });
    const caseCount = included;
    const share = n => (caseCount ? round(n / caseCount, 4) : 0);
    const order = new Map(model.nodes.map((n, i) => [n.id, i]));

    const stepRows = [...steps.entries()].sort((a, b) => order.get(a[0]) - order.get(b[0])).map(([nodeId, st]) => ({
      nodeId, visits: st.visits, cases: st.cases, caseShare: share(st.cases), reworkCases: st.rework,
      reworkRate: st.cases ? round(st.rework / st.cases, 4) : 0,
      duration: mode === "start-end" && shapeOf(graph.nodes.get(nodeId)) === "task" ? statsOf(st.duration) : null,
      wait: statsOf(st.wait), sojourn: statsOf(st.sojourn),
      resources: counted ? st.resources.size : null,
      handoffRate: counted && st.hDen ? round(st.hNum / st.hDen, 4) : null
    }));

    let notInModel = 0, notInModelCount = 0;
    const transitions = [...pairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, L.datasetTransitions).map(([key, count]) => {
      const [from, to] = key.split("\u0001");
      const path = edgePath(model, from, to, graph);
      if (!path) { notInModel++; notInModelCount += count; }
      return { fromNodeId: from, toNodeId: to, count, edgeIds: path || [] };
    });
    if (pairs.size > L.datasetTransitions) warnings.push({ code: "mining.transitions", message: "Only the " + L.datasetTransitions + " most frequent of " + pairs.size + " step pairs are kept." });
    if (notInModel) {
      warnings.push({ code: "mining.notInModel", message: notInModel + " step pair" + (notInModel === 1 ? "" : "s") + " (" + notInModelCount +
        " handover" + (notInModelCount === 1 ? "" : "s") + " between steps) " + (notInModel === 1 ? "has" : "have") + " no connector path in the model. They are kept and marked as not in the model." });
    }

    const ranked = [...variants.values()].sort((a, b) => b.members.length - a.members.length || a.order - b.order);
    const kept = ranked.slice(0, L.datasetVariants);
    const rest = ranked.slice(L.datasetVariants);
    let truncated = 0;
    const variantRows = kept.map((v, i) => {
      if (v.truncated) truncated++;
      return {
        id: "v" + (i + 1), nodeIds: v.nodeIds, cases: v.members.length,
        share: share(v.members.length), cycleTime: statsOf(v.members.map(m => m.cycle))
      };
    });
    if (truncated) warnings.push({ code: "mining.variantSteps", message: truncated + " variant" + (truncated === 1 ? " is" : "s are") + " longer than " + L.variantSteps + " steps; only the first " + L.variantSteps + " steps are listed, and cases that share those steps are counted as one variant." });

    if (outOfOrder) warnings.push({ code: "mining.order", message: outOfOrder + " case" + (outOfOrder === 1 ? " has" : "s have") + " events listed out of time order in the file. They were sorted by time." });
    if (tied) warnings.push({ code: "mining.ties", message: tied + " case" + (tied === 1 ? " has" : "s have") + " events with the same time. Those keep their order in the file, so parallel work may show as a sequence." });
    if (overlaps) warnings.push({ code: "mining.overlap", message: overlaps + " event" + (overlaps === 1 ? " starts" : "s start") + " before the previous event in the case ended (parallel work). Their wait is counted as zero." });
    if (excludedIncomplete) warnings.push({ code: "mining.incomplete", message: excludedIncomplete + " case" + (excludedIncomplete === 1 ? " does" : "s do") + " not end at an end step and " + (excludedIncomplete === 1 ? "is" : "are") + " left out." });
    if (!endSet.size && included) warnings.push({ code: "mining.noEndSteps", message: "No end steps are set, so no case is counted as complete." });
    if (noMapped) warnings.push({ code: "mining.unmapped", message: noMapped + " case" + (noMapped === 1 ? " has" : "s have") + " no event mapped to a step and " + (noMapped === 1 ? "is" : "are") + " left out." });

    const days = Number.isFinite(first) && last >= first ? (last - first) / DAY : 0;
    const arrivals = caseCount ? caseCount / Math.max(days, 1) : 0;
    const acts = [...activityEvents.entries()].sort((a, b) => b[1] - a[1]);
    if (acts.length > L.datasetMapping) warnings.push({ code: "mining.mapping", message: "Only the " + L.datasetMapping + " most frequent of " + acts.length + " activities are listed in the mapping." });
    const src = o.source || {};
    const dataset = {
      id: "ds-new",
      name: String(o.name || src.fileName || "Event log").slice(0, 200),
      role: schema.ENUMS.datasetRole.includes(o.role) ? o.role : "baseline",
      comparesToDatasetId: o.comparesToDatasetId || null,
      modelId: model.id,
      dataStatus: schema.ENUMS.dataStatus.includes(o.dataStatus) ? o.dataStatus : "observed",
      createdAt: o.createdAt || util.nowIso(),
      source: {
        fileName: String(src.fileName || "").slice(0, 260), format: schema.ENUMS.logFormat.includes(src.format) ? src.format : "csv",
        sha256: /^[0-9a-f]{64}$/.test(String(src.sha256 || "")) ? src.sha256 : "",
        rows: src.rows || 0, events: (o.events || []).length, timestampMode: mode,
        caseIds: schema.ENUMS.caseIdHandling.includes(o.caseIds) ? o.caseIds : "hashed",
        resources: counted ? "counted" : "dropped",
        droppedRows: src.droppedRows || 0, unmatchedEvents: unmatched, excludedIncompleteCases: excludedIncomplete
      },
      period: {
        start: Number.isFinite(first) ? iso(first) : "", end: Number.isFinite(last) ? iso(last) : "", days: round(days)
      },
      timeBasis: tb,
      mapping: acts.slice(0, L.datasetMapping).map(([activity, events]) => {
        const m = mapping.get(activity);
        const nodeId = nodeFor.get(activity) || null;
        const method = nodeId ? (m && schema.ENUMS.mappingMethod.includes(m.method) && m.method !== "ignored" ? m.method : "manual") : "ignored";
        return { activity, nodeId, method, events };
      }),
      cases: {
        count: caseCount, complete,
        arrivalsPerDay: round(arrivals, 3), annualizedVolume: Math.round(arrivals * 365),
        cycleTime: statsOf(cycles), eventsPerCase: statsOf(perCase)
      },
      steps: stepRows,
      transitions,
      variants: variantRows,
      otherVariants: { variants: rest.length, cases: rest.reduce((n, v) => n + v.members.length, 0) },
      scenarioIds: [],
      notes: String(o.notes || "").slice(0, 4000)
    };

    const scenarios = [];
    const want = Math.max(0, Math.min(L.scenariosPerDataset, Number.isInteger(o.topVariants) ? o.topVariants : 3, kept.length));
    for (let i = 0; i < want; i++) {
      const v = kept[i];
      const row = variantRows[i];
      const median = row.cycleTime ? row.cycleTime.p50 : 0;
      const rep = v.members.reduce((best, m) => (Math.abs(m.cycle - median) < Math.abs(best.cycle - median) ? m : best), v.members[0]);
      const label = caseLabel(o, rep.c);
      scenarios.push(scenarioFor({ model, graph, mode, tb: scnTb, events: byCase.get(rep.c), nodeFor, dataset, variant: row, index: i, label, caseCount }));
    }
    return {
      dataset, scenarios, warnings,
      counts: { cases: caseCount, complete, excludedIncomplete, noMapped, unmatched, outOfOrder, tied, overlaps, notInModel }
    };
  }

  function caseLabel(o, c) {
    const original = o.caseNames ? o.caseNames[c] : String(c);
    if (o.caseIds === "original") return String(original).slice(0, 200);
    if (o.caseIds === "hashed" && typeof o.hashCase === "function") return "Case " + String(o.hashCase(String(original))).slice(0, 8);
    return "Case " + (c + 1);
  }

  /*
   * One scenario from one case: visits in minutes from the case start, in
   * the engagement's time basis. Gateways and events along the connector
   * paths get zero-length visits, so the replay can follow the flow.
   */
  function scenarioFor(x) {
    const { model, graph, mode, tb, nodeFor, dataset, variant, index, label, caseCount } = x;
    const mapped = x.events.slice().sort((a, b) => a.s - b.s || a.i - b.i).map(ev => ({ ev, id: nodeFor.get(ev.a) })).filter(m => m.id);
    const t0 = mapped[0].ev.s;
    const at = ms => round(elapsedMinutes(t0, ms, tb), 3);
    const visits = [];
    const add = (nodeId, start, end) => { if (visits.length < L.visitsPerRun) visits.push({ id: "vis-" + (visits.length + 1), nodeId, start, end }); };
    const passThrough = (edges, t) => edges.slice(0, -1).forEach(e => add(e.to, t, t));
    const firstShape = shapeOf(graph.nodes.get(mapped[0].id));
    if (firstShape !== "start") {
      const starts = [...graph.nodes.values()].filter(n => shapeOf(n) === "start");
      for (const s of starts) {
        const p = s.id === mapped[0].id ? null : searchPath(graph, s.id, id => id === mapped[0].id);
        if (p) { add(s.id, 0, 0); passThrough(p, 0); break; }
      }
    }
    let human = 0;
    const humanLanes = new Set(model.lanes.filter(l => l.type === "human").map(l => l.id));
    let lastEnd = 0;
    mapped.forEach((m, k) => {
      const prev = k ? mapped[k - 1] : null;
      if (prev) {
        const p = searchPath(graph, prev.id, id => id === m.id);
        if (p) passThrough(p, lastEnd);
      }
      const start = mode === "start-end" ? at(m.ev.s) : (prev ? at(prev.ev.s) : 0);
      const end = mode === "start-end" ? at(m.ev.e) : at(m.ev.s);
      add(m.id, start, end);
      lastEnd = end;
      const node = graph.nodes.get(m.id);
      if (mode === "start-end" && node && humanLanes.has(node.laneId)) human += end - start;
    });
    const lastShape = shapeOf(graph.nodes.get(mapped[mapped.length - 1].id));
    if (lastShape !== "end") {
      const p = searchPath(graph, mapped[mapped.length - 1].id, id => shapeOf(graph.nodes.get(id)) === "end");
      if (p) { passThrough(p, lastEnd); add(p[p.length - 1].to, lastEnd, lastEnd); }
    }
    const visited = new Set(visits.map(v => v.nodeId));
    const membership = {};
    const mappedIds = new Set(nodeFor.values());
    model.nodes.forEach(n => {
      if (visited.has(n.id)) membership[n.id] = "included";
      else if (mappedIds.has(n.id) && shapeOf(n) === "task") membership[n.id] = "excluded";
    });
    const transitions = replayLib.deriveTransitions(model, visits);
    const cycle = visits.reduce((mx, v) => Math.max(mx, v.end), 0);
    const pct = Math.round(variant.share * 1000) / 10;
    const source = dataset.source.fileName || dataset.name;
    const status = measureStatusOf(dataset.dataStatus);
    const measures = [{ key: "cycleTime", label: "Cycle time", unit: "minute", values: { [model.id]: round(cycle) }, suppliedText: {}, status,
      note: "Cycle time of " + label + " in " + source + "." }];
    if (mode === "start-end") {
      measures.push({ key: "humanTouch", label: "Human touch effort", unit: "hour", values: { [model.id]: round(human / 60, 3) }, suppliedText: {}, status,
        note: "Start to end time of the steps in people swimlanes for " + label + ". Elapsed time per step, so it can include interruptions." });
    }
    return {
      id: "sc-new-" + (index + 1),
      name: "Observed variant " + (index + 1) + ": " + util.formatNumber(pct, 1) + "% of cases",
      statusLabel: "", statusTone: "",
      provenance: provenanceOf(dataset.dataStatus),
      summary: "One case from " + source + ": the case whose cycle time is closest to the median of variant " + (index + 1) +
        ", which " + variant.cases + " of " + caseCount + " cases follow.",
      attributes: [
        { label: "Event log", value: dataset.name },
        { label: "Case", value: label },
        { label: "Cases in this variant", value: variant.cases + " of " + caseCount + " (" + util.formatNumber(pct, 1) + "%)" },
        { label: "Median cycle time of the variant", value: units.formatDuration(variant.cycleTime ? variant.cycleTime.p50 : null, dataset.timeBasis) + " (" + (dataset.timeBasis.calendar === "business" ? "business time" : "calendar time") + ")" }
      ],
      timing: {
        method: "explicit-visits",
        note: "Times are from the event log: minutes from the first event of the case, in the engagement's time basis. " +
          (mode === "start-end" ? "Each visit runs from the start to the end of its event." : "The log has one time per event, so each visit runs from the previous event to its own.") +
          " Gateways and events on the way have zero length."
      },
      runs: { [model.id]: { visits, transitions, membership } },
      measures,
      economics: null,
      observedFrom: { datasetId: dataset.id, variantId: variant.id, caseLabel: label }
    };
  }

  /* ---------- Reading the dataset back ---------- */

  function periodText(d) {
    const p = (d && d.period) || {};
    if (!p.start || !p.end) return "period not known";
    return p.start.slice(0, 10) + " to " + p.end.slice(0, 10);
  }

  /** "Event log claims.csv, 2026-01-05 to 2026-01-30, 100 cases". */
  function sourceText(d) {
    const name = (d.source && d.source.fileName) || d.name;
    const n = d.cases ? d.cases.count : 0;
    return "Event log " + name + ", " + periodText(d) + ", " + util.formatNumber(n, 0) + " case" + (n === 1 ? "" : "s");
  }

  /** Average human touch hours per case: mean duration times visits per case, over steps in people swimlanes. Null without durations. */
  function humanTouchHours(e, d) {
    const model = d && e.models.find(m => m.id === d.modelId);
    if (!model || !d.cases || !d.cases.count) return null;
    const lanes = new Set(model.lanes.filter(l => l.type === "human").map(l => l.id));
    const nodes = new Map(model.nodes.map(n => [n.id, n]));
    let minutes = 0, any = false;
    d.steps.forEach(s => {
      const n = nodes.get(s.nodeId);
      if (!n || !lanes.has(n.laneId) || !s.duration || !util.isFiniteNumber(s.duration.mean)) return;
      any = true;
      minutes += s.duration.mean * s.visits / d.cases.count;
    });
    return any ? round(minutes / 60, 3) : null;
  }

  function pctText(v) {
    return util.isFiniteNumber(v) ? util.formatNumber(v * 100, 1) + "%" : "n/a";
  }

  function statText(st, tb, what) {
    if (!st) return null;
    return units.formatDuration(st.p50, tb, { precise: true }) + " median, " + units.formatDuration(st.p90, tb, { precise: true }) + " at the 90th percentile" +
      (datasetQuery.smallSample(st) ? " (only " + st.n + " " + (st.n === 1 ? what.replace(/s$/, "") : what) + ")" : "");
  }

  /** The observed figures for one step as [label, text] pairs, or null when the dataset has no data for it. */
  function stepFacts(d, nodeId) {
    const s = datasetQuery.step(d, nodeId);
    if (!s) return null;
    const tb = d.timeBasis;
    const vpc = datasetQuery.visitsPerCase(d, nodeId);
    return [
      ["Cases", util.formatNumber(s.cases, 0) + " of " + util.formatNumber(d.cases.count, 0) + " (" + pctText(s.caseShare) + ")"],
      ["Visits", util.formatNumber(s.visits, 0) + (vpc ? " (" + util.formatNumber(vpc, 2) + " per case that visits)" : "")],
      ["Repeat visits", util.formatNumber(s.reworkCases, 0) + (s.reworkCases === 1 ? " case (" : " cases (") + pctText(s.reworkRate) + " of the cases that visit)"],
      ["Duration, start to end", statText(s.duration, tb, "visits")],
      ["Wait before the step", statText(s.wait, tb, "visits")],
      ["Time since the previous event", statText(s.sojourn, tb, "visits")],
      ["People involved", s.resources === null ? null : util.formatNumber(s.resources, 0) + (s.resources === 1 ? " distinct resource" : " distinct resources")],
      ["Handoffs into the step", s.handoffRate === null ? null : pctText(s.handoffRate) + " of visits change resource"]
    ].filter(p => p[1] !== null && p[1] !== undefined);
  }

  /** The dataset a lens or drawer uses for a model: the latest baseline, else the latest after dataset. */
  function datasetFor(e, modelId) {
    return datasetQuery.forModel(e, modelId, "baseline") || datasetQuery.forModel(e, modelId, "after");
  }

  function lensLevel(value, max) {
    if (!util.isFiniteNumber(value) || value <= 0 || !(max > 0)) return 0;
    return Math.max(1, Math.min(4, Math.ceil(value / max * 4)));
  }

  function basisWords(d) {
    return schema.label("dataStatus", d.dataStatus) + ".";
  }

  function noDataset(tasks, what) {
    return {
      description: what, unit: "", population: "No event log is linked to this model.",
      coverage: { have: 0, total: tasks.length, text: "0 of " + tasks.length + " activities have observed data" },
      nodes: {}, edges: {}, legend: [],
      notes: ["Import an event log from More actions, Import an event log."]
    };
  }

  /** The observed-share lens: the share of cases that visit each activity. */
  function shareLens(ctx) {
    const model = ctx.model;
    const tasks = model.nodes.filter(n => shapeOf(n) === "task");
    const what = "Share of cases that visit each activity, from an event log.";
    const d = datasetFor(ctx.engagement, model.id);
    if (!d) return noDataset(tasks, what);
    const out = { description: what, unit: "Percent of the " + util.formatNumber(d.cases.count, 0) + " cases in the log.", nodes: {}, edges: {}, notes: [] };
    let have = 0;
    tasks.forEach(n => {
      const s = datasetQuery.step(d, n.id);
      if (!s) return;
      have++;
      out.nodes[n.id] = { level: lensLevel(s.caseShare, 1), text: pctText(s.caseShare) + " of cases" + (s.reworkCases ? ", " + pctText(s.reworkRate) + " repeat" : "") };
    });
    d.transitions.forEach(t => t.edgeIds.forEach(id => { out.edges[id] = { level: 4 }; }));
    out.population = util.formatNumber(d.cases.count, 0) + " cases in " + d.name + ", " + periodText(d) + ". " + basisWords(d);
    out.coverage = { have, total: tasks.length, text: have + " of " + tasks.length + " activities appear in the log" };
    out.legend = [{ level: 1, label: "Up to 25% of cases" }, { level: 2, label: "" }, { level: 3, label: "" }, { level: 4, label: "Over 75% of cases" }];
    const um = d.source.unmatchedEvents;
    if (um) out.notes.push(util.formatNumber(um, 0) + (um === 1 ? " event in the log is" : " events in the log are") + " not mapped to a step and not counted.");
    if (Object.keys(out.edges).length) out.notes.push("Highlighted connectors are the ones the cases in the log take.");
    return out;
  }

  /** The observed-time lens: the median time per visit of each activity. */
  function timeLens(ctx) {
    const model = ctx.model;
    const tasks = model.nodes.filter(n => shapeOf(n) === "task");
    const d = datasetFor(ctx.engagement, model.id);
    const startEnd = d && d.source.timestampMode === "start-end";
    const what = !d ? "" : "Median time per visit in " + (d.timeBasis.calendar === "business" ? "business" : "calendar") + " time, " +
      (startEnd ? "from the start to the end of each event in the log." : "measured from the previous event in the case.");
    if (!d) return noDataset(tasks, "Median time per visit of each activity, from an event log.");
    const out = { description: what, unit: units.describeTimeBasis(d.timeBasis), nodes: {}, edges: {}, notes: [] };
    const values = [];
    let small = 0;
    tasks.forEach(n => {
      const s = datasetQuery.step(d, n.id);
      const st = s ? (startEnd ? s.duration : s.sojourn) : null;
      if (!st) return;
      values.push({ n, st });
      if (datasetQuery.smallSample(st)) small++;
    });
    const max = Math.max(0, ...values.map(v => v.st.p50));
    values.forEach(v => {
      out.nodes[v.n.id] = { level: lensLevel(v.st.p50, max), text: units.formatDuration(v.st.p50, d.timeBasis, { precise: true }) + " median" + (datasetQuery.smallSample(v.st) ? " (n=" + v.st.n + ")" : "") };
    });
    out.population = "Visits in " + d.name + ", " + periodText(d) + ", " + util.formatNumber(d.cases.count, 0) + " cases. " + basisWords(d);
    out.coverage = { have: values.length, total: tasks.length, text: values.length + " of " + tasks.length + " activities have observed times" };
    out.legend = [{ level: 1, label: "Lowest quarter" }, { level: 2, label: "" }, { level: 3, label: "" }, { level: 4, label: "Highest quarter (max " + units.formatDuration(max, d.timeBasis) + ")" }];
    if (small) out.notes.push(small + " activit" + (small === 1 ? "y has" : "ies have") + " fewer than 5 visits; treat their medians with care.");
    return out;
  }

  /* ---------- Store commands ---------- */

  const { StoreError, cleanText } = storeLib.helpers;

  function setMeasure(s, modelId, key, label, unit, value, status, note) {
    let m = s.measures.find(x => x.key === key);
    if (!m) {
      m = { key, label, unit, values: {}, suppliedText: {}, status, note: "" };
      s.measures.push(m);
    }
    if (m.unit !== unit) {
      // Values for other models were in the old unit; they are dropped rather than mixed.
      m.values = {};
      m.suppliedText = {};
      m.unit = unit;
    }
    m.values[modelId] = value;
    m.status = status;
    m.note = cleanText(note, 2000);
  }

  const commands = {
    /*
     * Adds an event-log dataset and the scenarios made from it in one step.
     * payload: { dataset, scenarios }. IDs are assigned here, so a payload
     * from aggregate() can be dispatched as it is.
     */
    "dataset/import"(e, p) {
      if (!p || !util.isPlainObject(p.dataset)) throw new StoreError("invalid", "No event log to add.");
      e.datasets = Array.isArray(e.datasets) ? e.datasets : [];
      if (e.datasets.length >= L.datasets) throw new StoreError("limit", "An engagement holds at most " + L.datasets + " event logs. Delete one first.");
      const list = Array.isArray(p.scenarios) ? p.scenarios : [];
      if (list.length > L.scenariosPerDataset) throw new StoreError("limit", "At most " + L.scenariosPerDataset + " scenarios can come from one event log.");
      if (e.scenarios.length + list.length > L.scenarios) throw new StoreError("limit", "The engagement already has the maximum of " + L.scenarios + " scenarios.");
      const raw = util.clone(p.dataset);
      const id = util.uniqueId("ds-" + util.slug(raw.name || "event-log", 40), new Set(e.datasets.map(d => d.id)));
      raw.id = id;
      raw.scenarioIds = [];
      if (raw.comparesToDatasetId && !e.datasets.some(d => d.id === raw.comparesToDatasetId)) throw new StoreError("not-found", "The event log to compare with was not found.");
      if (!raw.modelId || !e.models.some(m => m.id === raw.modelId)) throw new StoreError("not-found", "The model for this event log was not found.");
      const v = validate.sanitizeDataset(raw, e);
      if (v.errors.length) throw new StoreError("invalid", "The event log could not be added: " + v.errors[0].message);
      e.datasets.push(v.value);
      const taken = new Set(e.scenarios.map(s => s.id));
      const ids = [];
      list.forEach((s, i) => {
        const copy = util.clone(s);
        copy.id = util.uniqueId("sc-" + id.replace(/^ds-/, "") + "-" + (i + 1), new Set(taken));
        taken.add(copy.id);
        copy.observedFrom = Object.assign({}, copy.observedFrom || {}, { datasetId: id });
        const sv = validate.sanitizeScenarioFor(copy, e);
        if (sv.errors.length) throw new StoreError("invalid", "A scenario from the event log could not be added: " + sv.errors[0].message);
        e.scenarios.push(sv.value);
        ids.push(sv.value.id);
      });
      e.datasets[e.datasets.length - 1].scenarioIds = ids;
      return { datasetId: id, scenarioIds: ids, warnings: v.warnings.filter(w => w.level !== "info").length };
    },

    /*
     * Copies figures from an event log into the value model.
     * payload: { datasetId, annualVolume, scenarioId, cycleTime, humanTouch }
     * (the three figure flags are booleans). Each figure keeps the basis of
     * the dataset (observed, supplied or illustrative) and names its source.
     */
    "dataset/applyToValueModel"(e, p) {
      const d = (e.datasets || []).find(x => x.id === p.datasetId);
      if (!d) throw new StoreError("not-found", "Event log not found.");
      const basis = datasetQuery.basisOf(d);
      const src = sourceText(d);
      const applied = [];
      if (p.annualVolume) {
        const v = datasetQuery.annualVolume(d);
        if (!util.isFiniteNumber(v)) throw new StoreError("invalid", "This event log has no annualized volume.");
        storeLib.COMMANDS["assumption/set"](e, {
          key: "annualVolume", value: Math.round(v), status: basis, source: src,
          note: "Annualized from " + d.cases.count + " cases over " + util.formatNumber(d.period.days, 1) + " days: cases per day times 365."
        });
        applied.push("annualVolume");
      }
      if (p.cycleTime || p.humanTouch) {
        const s = e.scenarios.find(x => x.id === p.scenarioId);
        if (!s) throw new StoreError("not-found", "Choose the scenario that receives the figures.");
        if (!d.modelId || !e.models.some(m => m.id === d.modelId)) throw new StoreError("invalid", "The event log is not linked to a model.");
        const status = basis === "illustrative" ? "supplied" : basis;
        const demo = basis === "illustrative" ? " Demonstration data." : "";
        if (p.cycleTime) {
          const st = d.cases.cycleTime;
          if (!st || !util.isFiniteNumber(st.p50)) throw new StoreError("invalid", "This event log has no cycle times.");
          if (!sameBasis(d.timeBasis, e.meta.timeBasis)) {
            throw new StoreError("invalid", "The event log is measured in " + (d.timeBasis.calendar === "business" ? "business" : "calendar") +
              " time and the engagement in " + (e.meta.timeBasis.calendar === "business" ? "business" : "calendar") + " time, so its cycle time cannot be used as it is. Import the log again with the engagement's time basis.");
          }
          setMeasure(s, d.modelId, "cycleTime", "Cycle time", "minute", st.p50, status, "Median cycle time. " + src + "." + demo);
          applied.push("cycleTime");
        }
        if (p.humanTouch) {
          if (d.source.timestampMode !== "start-end") throw new StoreError("invalid", "Human touch effort needs a log with start and end times.");
          const hours = humanTouchHours(e, d);
          if (hours === null) throw new StoreError("invalid", "No step in a people swimlane has durations in this event log.");
          setMeasure(s, d.modelId, "humanTouch", "Human touch effort", "hour", hours, status,
            "Average start to end time per case of the steps in people swimlanes. " + src + ". Elapsed time per step, so it can include interruptions." + demo);
          applied.push("humanTouch");
        }
      }
      if (!applied.length) throw new StoreError("invalid", "Choose at least one figure to use.");
      return { datasetId: d.id, applied };
    }
  };

  /** Registers the commands with the store once. Returns true when they are registered. */
  function registerStoreCommands(store) {
    const target = store || storeLib;
    const missing = Object.keys(commands).filter(name => !Object.prototype.hasOwnProperty.call(target.COMMANDS, name));
    if (!missing.length) return true;
    const defs = {};
    missing.forEach(name => { defs[name] = commands[name]; });
    target.registerCommands(defs);
    return true;
  }

  return {
    FORMATS, DROP_REASONS,
    parseTimestamp, detectTimestampFormat, guessColumns, tableFromRows, createEventBuilder, activitiesOf,
    elapsedMinutes, sameBasis, cleanBasis, statsOf, percentile,
    edgePath, defaultEndNodes, mappableSteps, aggregate,
    periodText, sourceText, humanTouchHours, stepFacts, datasetFor, shareLens, timeLens,
    commands, registerStoreCommands
  };
});
