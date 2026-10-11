/*
 * AIxRay csv: comma, semicolon, tab and pipe separated text for event logs.
 * Quoted fields follow RFC 4180 (a doubled quote is a quote; quoted fields
 * may hold separators and line breaks). Text after a closing quote is kept,
 * as spreadsheet programs do. A byte order mark is removed. Blank lines are
 * skipped. The reader works in chunks so the app can yield between them.
 * Owned by the event-log import feature (mining slice); see docs/extensions.md.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else { const B = root.AIxRay = root.AIxRay || {}; B.csv = factory(); }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CANDIDATES = [",", ";", "\t", "|"];
  const NAMES = { ",": "comma", ";": "semicolon", "\t": "tab", "|": "pipe" };

  function stripBom(text) {
    const s = String(text == null ? "" : text);
    return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
  }

  /* Counts each candidate separator per line, outside quotes, over the first lines. */
  function countLines(text, maxLines) {
    const counts = [];
    let line = CANDIDATES.map(() => 0);
    let quoted = false;
    for (let i = 0; i < text.length && counts.length < maxLines; i++) {
      const c = text[i];
      if (c === "\"") { quoted = !quoted; continue; }
      if (quoted) continue;
      if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        if (line.some(n => n > 0)) counts.push(line);
        line = CANDIDATES.map(() => 0);
        continue;
      }
      const k = CANDIDATES.indexOf(c);
      if (k >= 0) line[k]++;
    }
    if (counts.length < maxLines && line.some(n => n > 0)) counts.push(line);
    return counts;
  }

  /**
   * The separator that splits the first lines most consistently: the
   * candidate with the highest count that every sampled line shares. Comma
   * when nothing fits.
   */
  function detectDelimiter(text) {
    const lines = countLines(stripBom(text), 30);
    if (!lines.length) return ",";
    let best = ",", bestScore = 0;
    CANDIDATES.forEach((d, k) => {
      const per = lines.map(l => l[k]);
      const min = Math.min(...per);
      const same = per.filter(n => n === per[0]).length / per.length;
      const score = min > 0 ? min + same : 0;
      if (score > bestScore) { best = d; bestScore = score; }
    });
    return best;
  }

  /**
   * A chunked reader: { delimiter, next(maxRows) -> rows, done(), progress(), problems }.
   * rows are arrays of strings. options: { delimiter }.
   */
  function createReader(text, options) {
    const o = options || {};
    const s = stripBom(text);
    const d = CANDIDATES.includes(o.delimiter) ? o.delimiter : detectDelimiter(s);
    const n = s.length;
    let i = 0;
    const problems = { unterminatedQuote: false };

    function plain() {
      let j = i;
      while (j < n) {
        const c = s[j];
        if (c === d || c === "\n" || c === "\r") break;
        j++;
      }
      const out = s.slice(i, j);
      i = j;
      return out;
    }

    function quoted() {
      i++;
      let out = "";
      for (;;) {
        const q = s.indexOf("\"", i);
        if (q < 0) { out += s.slice(i); i = n; problems.unterminatedQuote = true; return out; }
        out += s.slice(i, q);
        if (s[q + 1] === "\"") { out += "\""; i = q + 2; continue; }
        i = q + 1;
        return out + plain();
      }
    }

    function readRow() {
      const row = [];
      for (;;) {
        row.push(s[i] === "\"" ? quoted() : plain());
        if (i >= n) return row;
        const c = s[i];
        if (c === d) { i++; continue; }
        if (c === "\r") { i++; if (s[i] === "\n") i++; } else i++;
        return row;
      }
    }

    function next(maxRows) {
      const max = maxRows > 0 ? maxRows : Infinity;
      const rows = [];
      while (i < n && rows.length < max) {
        const row = readRow();
        if (row.length === 1 && row[0] === "") continue;
        rows.push(row);
      }
      return rows;
    }

    return {
      delimiter: d,
      next,
      done: () => i >= n,
      progress: () => (n ? i / n : 1),
      problems
    };
  }

  /** Parses all of text: { rows, delimiter, problems }. options: { delimiter, maxRows }. */
  function parse(text, options) {
    const o = options || {};
    const reader = createReader(text, o);
    const rows = reader.next(o.maxRows || 0);
    return { rows, delimiter: reader.delimiter, problems: reader.problems, complete: reader.done() };
  }

  function delimiterName(d) {
    return NAMES[d] || "comma";
  }

  /*
   * Bytes to text with the rule the browser import uses: a UTF-8 or UTF-16
   * byte order mark wins, then strict UTF-8, then Windows-1252 (what Excel
   * on Windows writes for "CSV").
   */
  function decodeText(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder("utf-8").decode(b.subarray(3));
    if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b.subarray(2));
    if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b.subarray(2));
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(b);
    } catch (_) {
      return new TextDecoder("windows-1252").decode(b);
    }
  }

  return { CANDIDATES, stripBom, decodeText, detectDelimiter, createReader, parse, delimiterName };
});
