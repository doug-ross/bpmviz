/*
 * AIxRay units: typed measures and time-basis-aware formatting.
 * Every displayed number carries a unit; nothing is formatted by guessing
 * from a label.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./util.js"));
  else { const B = root.AIxRay = root.AIxRay || {}; B.units = factory(B.util); }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util) {
  "use strict";

  const MINUS = "\u2212";
  const NA = "n/a";

  function minutesPerDay(timeBasis) {
    const tb = timeBasis || {};
    return tb.calendar === "business" ? (tb.businessMinutesPerDay > 0 ? tb.businessMinutesPerDay : 480) : 1440;
  }

  function describeTimeBasis(timeBasis) {
    const tb = timeBasis || {};
    if (tb.calendar === "business") {
      const perDay = minutesPerDay(tb);
      return "Business time: a day is " + util.formatNumber(perDay / 60, 2) + " working hours (" +
        util.formatNumber(perDay, 0) + " minutes), and weekends and holidays are not counted.";
    }
    return "Calendar time: a day is 24 hours.";
  }

  /** Compact duration for clocks and badges: "45m", "7h 30m", "12d 3h". */
  function formatDuration(minutes, timeBasis, options) {
    if (!util.isFiniteNumber(minutes)) return NA;
    const opts = options || {};
    const sign = minutes < 0 ? MINUS : "";
    const total = Math.round(Math.abs(minutes));
    const perDay = minutesPerDay(timeBasis);
    const days = Math.floor(total / perDay);
    const rest = total - days * perDay;
    const hours = Math.floor(rest / 60);
    const mins = rest - hours * 60;
    const parts = [];
    if (days) parts.push(days + "d");
    if (hours) parts.push(hours + "h");
    if (mins && (!days || opts.precise)) parts.push(mins + "m");
    if (!parts.length) parts.push("0m");
    return sign + parts.join(" ");
  }

  function plural(value, singular, pluralWord) {
    return value === 1 ? singular : (pluralWord || singular + "s");
  }

  /** Duration expressed in days of the time basis: "32 business days". */
  function formatDays(minutes, timeBasis) {
    if (!util.isFiniteNumber(minutes)) return NA;
    const days = minutes / minutesPerDay(timeBasis);
    const word = (timeBasis && timeBasis.calendar === "business") ? "business day" : "day";
    return util.formatNumber(days, 1) + " " + plural(Math.abs(days), word);
  }

  /* Whole units from 1,000 up: cents on modeled annual figures suggest precision the inputs do not have. */
  function currency(value, code) {
    const digits = Number.isInteger(value) || Math.abs(value) >= 1000 ? 0 : 2;
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency", currency: code || "USD",
        minimumFractionDigits: digits, maximumFractionDigits: digits
      }).format(value);
    } catch (_) {
      return (code || "USD") + " " + util.formatNumber(value, 2);
    }
  }

  const UNITS = {
    minute: { label: "minutes", kind: "time" },
    businessMinute: { label: "business minutes", kind: "time" },
    hour: { label: "hours", kind: "time" },
    businessDay: { label: "business days", kind: "time" },
    calendarDay: { label: "calendar days", kind: "time" },
    day: { label: "days (calendar or business not stated)", kind: "time" },
    week: { label: "weeks", kind: "time" },
    count: { label: "count", kind: "count" },
    perDay: { label: "per day", kind: "rate" },
    percent: { label: "percent", kind: "ratio" },
    currency: { label: "currency", kind: "money" },
    currencyPerHour: { label: "currency per hour", kind: "money" },
    fte: { label: "FTE-equivalent", kind: "capacity" },
    casesPerYear: { label: "cases per year", kind: "rate" },
    hoursPerYear: { label: "hours per year", kind: "rate" },
    text: { label: "text", kind: "text" }
  };

  function isKnownUnit(unit) {
    return Object.prototype.hasOwnProperty.call(UNITS, unit);
  }

  function unitLabel(unit) {
    return isKnownUnit(unit) ? UNITS[unit].label : String(unit || "");
  }

  /** Converts a time measure to minutes of the time basis, or null when ambiguous. */
  function toMinutes(value, unit, timeBasis) {
    if (!util.isFiniteNumber(value)) return null;
    const tb = timeBasis || {};
    switch (unit) {
      case "minute": return value;
      case "businessMinute": return tb.calendar === "business" ? value : null;
      case "hour": return value * 60;
      case "businessDay": return tb.calendar === "business" ? value * minutesPerDay(tb) : null;
      case "calendarDay": return tb.calendar === "business" ? null : value * 1440;
      default: return null;
    }
  }

  /** Formats one value with its unit. ctx = { timeBasis, currency }. */
  function formatMeasure(value, unit, ctx) {
    const c = ctx || {};
    if (unit === "text") return value == null || value === "" ? NA : String(value);
    if (!util.isFiniteNumber(value)) return NA;
    const n = util.formatNumber(value, 1);
    switch (unit) {
      case "minute": return formatDuration(value, c.timeBasis);
      case "businessMinute": return util.formatNumber(value, 0) + " business " + plural(value, "minute");
      case "hour": return n + " " + plural(value, "hour");
      case "businessDay": return n + " business " + plural(value, "day");
      case "calendarDay": return n + " calendar " + plural(value, "day");
      case "day": return n + " " + plural(value, "day");
      case "week": return n + " " + plural(value, "week");
      case "count": return util.formatNumber(value, 1);
      case "perDay": return n + " per day";
      case "percent": return util.formatNumber(value, 1) + "%";
      case "currency": return currency(value, c.currency);
      case "currencyPerHour": return currency(value, c.currency) + " per hour";
      case "fte": return util.formatNumber(value, 1) + " FTE-equivalent";
      case "casesPerYear": return util.formatNumber(value, 0) + " per year";
      case "hoursPerYear": return util.formatNumber(value, 0) + " hours per year";
      default: return n;
    }
  }

  /** Signed difference after minus before, in the same unit. */
  function formatDelta(before, after, unit, ctx) {
    if (!util.isFiniteNumber(before) || !util.isFiniteNumber(after)) return NA;
    const diff = after - before;
    if (diff === 0) return "No change";
    const text = formatMeasure(Math.abs(diff), unit, ctx);
    return (diff < 0 ? MINUS : "+") + text;
  }

  function percentChange(before, after) {
    if (!util.isFiniteNumber(before) || !util.isFiniteNumber(after) || before === 0) return null;
    return (after - before) / before * 100;
  }

  function formatPercentChange(before, after) {
    const pct = percentChange(before, after);
    if (pct === null) return NA;
    if (pct === 0) return "0%";
    return (pct < 0 ? MINUS : "+") + util.formatNumber(Math.abs(pct), 1) + "%";
  }

  return {
    MINUS, NA, UNITS, minutesPerDay, describeTimeBasis, formatDuration, formatDays,
    formatMeasure, formatDelta, percentChange, formatPercentChange, toMinutes,
    isKnownUnit, unitLabel, currency
  };
});
