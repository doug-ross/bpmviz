/*
 * AIxRay util: small shared helpers.
 * Loads as a classic browser script (window.AIxRay.util) or a CommonJS module.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.AIxRay = root.AIxRay || {}).util = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;

  function randomChars(count) {
    const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
    const out = [];
    const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : null;
    if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
      const bytes = new Uint8Array(count);
      cryptoObj.getRandomValues(bytes);
      for (let i = 0; i < count; i++) out.push(alphabet[bytes[i] % alphabet.length]);
    } else {
      for (let i = 0; i < count; i++) out.push(alphabet[Math.floor(Math.random() * alphabet.length)]);
    }
    return out.join("");
  }

  /** New random identifier such as "rec-k3j9x0a2". */
  function uid(prefix) {
    return (prefix || "id") + "-" + randomChars(8);
  }

  function slug(text, max) {
    const value = String(text == null ? "" : text)
      .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const limit = max || 40;
    if (value.length <= limit) return value || "item";
    const cut = value.slice(0, limit);
    const boundary = value.charAt(limit) === "-" ? cut : cut.slice(0, Math.max(cut.lastIndexOf("-"), 0));
    return (boundary.length >= limit / 2 ? boundary : cut).replace(/-+$/, "") || "item";
  }

  /** Returns base, or base-2, base-3 ... so the result is not in `taken`. Adds it. */
  function uniqueId(base, taken) {
    let id = base, n = 2;
    while (taken.has(id)) id = base + "-" + n++;
    taken.add(id);
    return id;
  }

  function isValidId(id) {
    return typeof id === "string" && ID_PATTERN.test(id);
  }

  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) &&
      (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  /*
   * Text that was saved as UTF-8, read as Windows-1252 and saved again shows
   * sequences such as "\u00c2\u00b7" for "\u00b7". This reverses that when the round trip
   * decodes cleanly, and leaves every other string untouched.
   */
  const CP1252 = {
    0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86,
    0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C,
    0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95,
    0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B,
    0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F
  };
  const MOJIBAKE_HINT = /[\u00c2-\u00f4][\u0080-\u00bf\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013\u2014\u2018-\u201e\u2020-\u2022\u2026\u2030\u2039\u203a\u20ac\u2122]/;

  function repairMojibake(text) {
    if (typeof text !== "string" || !MOJIBAKE_HINT.test(text)) return text;
    const bytes = [];
    for (const ch of text) {
      const code = ch.codePointAt(0);
      if (code <= 0xFF) bytes.push(code);
      else if (CP1252[code] !== undefined) bytes.push(CP1252[code]);
      else return text;
    }
    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
      return decoded === text ? text : repairMojibake(decoded);
    } catch (_) {
      return text;
    }
  }

  /** Accepts http(s) URLs only. Returns the normalized href or null. */
  function safeHttpUrl(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    const raw = value.trim();
    try {
      const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : "https://" + raw);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    } catch (_) {
      return null;
    }
  }

  /*
   * CSV cell with quoting. Cells that a spreadsheet would treat as a formula
   * (leading = + - @, tab or carriage return) are prefixed with an apostrophe.
   */
  function csvCell(value) {
    let text = value == null ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function toCsv(rows) {
    return rows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }

  function formatNumber(value, maxDigits) {
    if (!isFiniteNumber(value)) return "";
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: maxDigits == null ? 1 : maxDigits
    }).format(value);
  }

  /** Parses "$8,250", "~$4,550 cost saved", "7.3 FTE" into a number, or null. */
  function parseLooseNumber(value) {
    if (isFiniteNumber(value)) return value;
    if (typeof value !== "string") return null;
    const match = value.replace(/,/g, "").replace(/\u2212/g, "-").match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function debounce(fn, wait) {
    let timer = null;
    const wrapped = function (...args) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; fn.apply(this, args); }, wait);
    };
    wrapped.flush = function (...args) {
      if (timer) { clearTimeout(timer); timer = null; }
      fn.apply(this, args);
    };
    wrapped.cancel = function () { if (timer) clearTimeout(timer); timer = null; };
    return wrapped;
  }

  return {
    ID_PATTERN, uid, slug, uniqueId, isValidId, clone, isPlainObject, nowIso, clamp,
    isFiniteNumber, repairMojibake, safeHttpUrl, csvCell, toCsv, formatNumber,
    parseLooseNumber, debounce
  };
});
