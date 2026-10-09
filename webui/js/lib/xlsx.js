/*
 * BPMVIZ xlsx: writes simple Excel workbooks and reads cell values back.
 *
 * Writing: every text cell is an inline string, so no cell can be a formula.
 * Reading: shared strings, inline strings, rich-text runs and the cached
 * <v> values; formulas (<f>) are ignored and never evaluated. A number with
 * a date format comes back as { date: serial }; excelSerialToMs converts it.
 * A small tag scanner reads the XML, so this works without DOMParser.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./zip.js"), require("./ooxml.js"));
  else { const B = root.BPMVIZ = root.BPMVIZ || {}; B.xlsx = factory(B.zip, B.ooxml); }
})(typeof globalThis !== "undefined" ? globalThis : this, function (zip, ooxml) {
  "use strict";

  const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const MAX_CELL_TEXT = 32767;
  const STYLE = { normal: 0, bold: 1, date: 2 };

  class XlsxError extends Error {}

  /* ---------- Writing ---------- */

  function colName(index) {
    let n = index + 1, s = "";
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function cellRef(row, col) {
    return colName(col) + (row + 1);
  }

  function colIndex(letters) {
    let n = 0;
    for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n - 1;
  }

  /* Sheet names: at most 31 characters, none of [ ] : * ? / \, unique ignoring case. */
  function sheetName(name, index, used) {
    let s = String(name == null ? "" : name).replace(/[[\]:*?/\\]/g, " ").replace(/^'+|'+$/g, "").trim().slice(0, 31).trim();
    if (!s) s = "Sheet" + (index + 1);
    let candidate = s, n = 2;
    while (used.has(candidate.toLowerCase())) {
      const suffix = " (" + n++ + ")";
      candidate = s.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  }

  function cellXml(value, row, col, bold) {
    if (value === null || value === undefined || value === "") return "";
    const ref = " r=\"" + cellRef(row, col) + "\"";
    const style = bold ? " s=\"" + STYLE.bold + "\"" : "";
    if (typeof value === "number" && Number.isFinite(value)) return "<c" + ref + style + "><v>" + value + "</v></c>";
    if (typeof value === "boolean") return "<c" + ref + style + " t=\"b\"><v>" + (value ? 1 : 0) + "</v></c>";
    if (value && typeof value === "object" && Number.isFinite(value.date)) return "<c" + ref + " s=\"" + STYLE.date + "\"><v>" + value.date + "</v></c>";
    const text = String(value).slice(0, MAX_CELL_TEXT);
    return "<c" + ref + style + " t=\"inlineStr\"><is><t xml:space=\"preserve\">" + ooxml.escapeXml(text) + "</t></is></c>";
  }

  function freezeOf(freeze) {
    if (!freeze) return null;
    const rows = typeof freeze === "number" ? freeze : Math.max(0, Math.floor(freeze.rows || 0));
    const cols = typeof freeze === "number" ? 0 : Math.max(0, Math.floor(freeze.cols || 0));
    return rows || cols ? { rows, cols } : null;
  }

  function validationXml(list) {
    if (!list || !list.length) return "";
    const items = list.map(v => {
      if (!/^[A-Z]{1,3}[0-9]{1,7}(:[A-Z]{1,3}[0-9]{1,7})?$/.test(v.range)) throw new XlsxError("A validation range looks like F2:F200: " + v.range);
      const values = (v.list || []).map(String);
      if (!values.length || values.some(x => x.includes(",") || x.includes("\""))) throw new XlsxError("List validation values cannot be empty or contain commas or quotes.");
      const formula = "\"" + values.join(",") + "\"";
      if (formula.length > 257) throw new XlsxError("A list validation is limited to 255 characters.");
      return "<dataValidation type=\"list\" allowBlank=\"1\" showInputMessage=\"1\" showErrorMessage=\"1\" sqref=\"" + v.range + "\"><formula1>" +
        ooxml.escapeXml(formula) + "</formula1></dataValidation>";
    });
    return "<dataValidations count=\"" + items.length + "\">" + items.join("") + "</dataValidations>";
  }

  function sheetXml(sheet, selected) {
    const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
    const header = Math.max(0, Math.floor(sheet.headerRows || 0));
    const fr = freezeOf(sheet.freeze);
    const pane = fr ? "<pane" + (fr.cols ? " xSplit=\"" + fr.cols + "\"" : "") + (fr.rows ? " ySplit=\"" + fr.rows + "\"" : "") +
      " topLeftCell=\"" + cellRef(fr.rows, fr.cols) + "\" activePane=\"" + (fr.rows && fr.cols ? "bottomRight" : fr.rows ? "bottomLeft" : "topRight") + "\" state=\"frozen\"/>" : "";
    const cols = (sheet.columns || []).map((c, i) => {
      const w = typeof c === "number" ? c : c && c.width;
      return Number.isFinite(w) && w > 0 ? "<col min=\"" + (i + 1) + "\" max=\"" + (i + 1) + "\" width=\"" + Math.min(255, w) + "\" customWidth=\"1\"/>" : "";
    }).join("");
    const data = rows.map((row, r) => {
      const cells = (Array.isArray(row) ? row : []).map((v, c) => cellXml(v, r, c, r < header)).join("");
      return "<row r=\"" + (r + 1) + "\">" + cells + "</row>";
    }).join("");
    return ooxml.XML_HEAD + "<worksheet xmlns=\"" + MAIN + "\" xmlns:r=\"" + ooxml.NS.officeRel + "\">" +
      "<sheetViews><sheetView workbookViewId=\"0\"" + (selected ? " tabSelected=\"1\"" : "") + ">" + pane + "</sheetView></sheetViews>" +
      "<sheetFormatPr defaultRowHeight=\"15\"/>" +
      (cols ? "<cols>" + cols + "</cols>" : "") +
      "<sheetData>" + data + "</sheetData>" +
      validationXml(sheet.validations) +
      "</worksheet>";
  }

  const STYLES_XML = ooxml.XML_HEAD + "<styleSheet xmlns=\"" + MAIN + "\">" +
    "<fonts count=\"2\"><font><sz val=\"11\"/><name val=\"Calibri\"/><family val=\"2\"/></font>" +
    "<font><b/><sz val=\"11\"/><name val=\"Calibri\"/><family val=\"2\"/></font></fonts>" +
    "<fills count=\"2\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill></fills>" +
    "<borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders>" +
    "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>" +
    "<cellXfs count=\"3\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>" +
    "<xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/>" +
    "<xf numFmtId=\"14\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/></cellXfs>" +
    "<cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles>" +
    "</styleSheet>";

  /**
   * The parts of a workbook: [{ name, data }] for zip.writeZip or writeZipAsync.
   * spec: { sheets: [{ name, rows, columns, hidden, freeze, validations: [{ range, list }], headerRows }],
   *         props: { title, subject, creator, description, created, modified, company } }
   * Cell values: text, finite numbers, booleans, null, or { date: serial }.
   */
  function writeWorkbook(spec) {
    const sheets = (spec && spec.sheets) || [];
    if (!sheets.length) throw new XlsxError("A workbook needs at least one sheet.");
    const firstVisible = sheets.findIndex(s => !s.hidden);
    if (firstVisible < 0) throw new XlsxError("At least one sheet must be visible.");
    const used = new Set();
    const names = sheets.map((s, i) => sheetName(s.name, i, used));
    const props = (spec && spec.props) || {};
    const parts = [];
    parts.push({ name: "[Content_Types].xml", data: ooxml.contentTypes({
      overrides: [
        { partName: "/xl/workbook.xml", contentType: ooxml.TYPES.workbook },
        { partName: "/xl/styles.xml", contentType: ooxml.TYPES.styles },
        { partName: "/docProps/core.xml", contentType: ooxml.TYPES.core },
        { partName: "/docProps/app.xml", contentType: ooxml.TYPES.app }
      ].concat(sheets.map((s, i) => ({ partName: "/xl/worksheets/sheet" + (i + 1) + ".xml", contentType: ooxml.TYPES.worksheet })))
    }) });
    parts.push({ name: "_rels/.rels", data: ooxml.rels([
      { id: "rId1", type: ooxml.REL.officeDocument, target: "xl/workbook.xml" },
      { id: "rId2", type: ooxml.REL.coreProperties, target: "docProps/core.xml" },
      { id: "rId3", type: ooxml.REL.extendedProperties, target: "docProps/app.xml" }
    ]) });
    parts.push({ name: "docProps/core.xml", data: ooxml.coreProps(props) });
    parts.push({ name: "docProps/app.xml", data: ooxml.appProps(props) });
    parts.push({ name: "xl/workbook.xml", data: ooxml.XML_HEAD + "<workbook xmlns=\"" + MAIN + "\" xmlns:r=\"" + ooxml.NS.officeRel + "\">" +
      "<bookViews><workbookView activeTab=\"" + firstVisible + "\"/></bookViews><sheets>" +
      sheets.map((s, i) => "<sheet name=\"" + ooxml.escapeXml(names[i]) + "\" sheetId=\"" + (i + 1) + "\"" + (s.hidden ? " state=\"hidden\"" : "") + " r:id=\"rId" + (i + 1) + "\"/>").join("") +
      "</sheets></workbook>" });
    parts.push({ name: "xl/_rels/workbook.xml.rels", data: ooxml.rels(sheets.map((s, i) => ({ id: "rId" + (i + 1), type: ooxml.REL.worksheet, target: "worksheets/sheet" + (i + 1) + ".xml" }))
      .concat([{ id: "rId" + (sheets.length + 1), type: ooxml.REL.styles, target: "styles.xml" }])) });
    parts.push({ name: "xl/styles.xml", data: STYLES_XML });
    sheets.forEach((s, i) => parts.push({ name: "xl/worksheets/sheet" + (i + 1) + ".xml", data: sheetXml(s, i === firstVisible) }));
    return parts;
  }

  /** The workbook as .xlsx bytes. options.deflateRaw compresses; without it the parts are stored. */
  function workbookBytesAsync(spec, options) {
    return zip.writeZipAsync(writeWorkbook(spec), options || {});
  }

  /* ---------- Reading ---------- */

  const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

  function decode(text) {
    if (text.indexOf("&") < 0) return text;
    return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (m, e) => {
      if (e === "lt") return "<";
      if (e === "gt") return ">";
      if (e === "amp") return "&";
      if (e === "quot") return "\"";
      if (e === "apos") return "'";
      const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    });
  }

  function parseAttrs(text) {
    const out = {};
    if (!text) return out;
    ATTR.lastIndex = 0;
    let m;
    while ((m = ATTR.exec(text))) {
      const value = decode(m[2] !== undefined ? m[2] : m[3]);
      out[m[1]] = value;
      const local = m[1].replace(/^[^:]*:/, "");
      if (!(local in out)) out[local] = value;
    }
    return out;
  }

  /*
   * Calls on(event) for each tag and text run: { type: "open" | "close" | "text",
   * name (local name, no prefix), attrs, self }. A self-closing tag gives an
   * open event with self true and no close event.
   */
  function scan(xml, on) {
    TOKEN.lastIndex = 0;
    let m;
    while ((m = TOKEN.exec(xml))) {
      if (m[1] !== undefined) on({ type: "text", text: m[1] });
      else if (m[3] !== undefined) {
        if (m[2] === "/") on({ type: "close", name: m[3] });
        else on({ type: "open", name: m[3], attrs: parseAttrs(m[4]), self: m[5] === "/" });
      } else if (m[6] !== undefined) on({ type: "text", text: decode(m[6]) });
    }
  }

  /* Text of <t> elements under the current element, leaving out phonetic runs (<rPh>). */
  function sharedStrings(xml) {
    const out = [];
    if (!xml) return out;
    let inSi = false, inT = false, phonetic = 0, buf = "";
    scan(xml, ev => {
      if (ev.type === "open") {
        if (ev.name === "si") { inSi = !ev.self; buf = ""; if (ev.self) out.push(""); }
        else if (ev.name === "rPh" && !ev.self) phonetic++;
        else if (ev.name === "t" && inSi && !phonetic && !ev.self) inT = true;
      } else if (ev.type === "close") {
        if (ev.name === "si") { out.push(buf); inSi = false; }
        else if (ev.name === "rPh") phonetic = Math.max(0, phonetic - 1);
        else if (ev.name === "t") inT = false;
      } else if (inT) buf += ev.text;
    });
    return out;
  }

  const BUILTIN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

  function isDateFormat(code) {
    if (!code || /^general$/i.test(code)) return false;
    const plain = code.replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/\[(?!h+\]|m+\]|s+\])[^\]]*\]/gi, "");
    return /[dmyhs]/i.test(plain);
  }

  /* Which cell style indexes (s attribute) show a date or time. */
  function dateStyles(xml) {
    const custom = new Map();
    const styles = [];
    if (!xml) return styles;
    let inXfs = false;
    scan(xml, ev => {
      if (ev.type === "open" && ev.name === "numFmt") custom.set(Number(ev.attrs.numFmtId), ev.attrs.formatCode || "");
      else if (ev.type === "open" && ev.name === "cellXfs") inXfs = !ev.self;
      else if (ev.type === "close" && ev.name === "cellXfs") inXfs = false;
      else if (ev.type === "open" && ev.name === "xf" && inXfs) {
        const id = Number(ev.attrs.numFmtId || 0);
        styles.push(custom.has(id) ? isDateFormat(custom.get(id)) : BUILTIN_DATES.has(id));
      }
    });
    return styles;
  }

  function resolveTarget(base, target) {
    if (!target) return "";
    const parts = (target.startsWith("/") ? target.slice(1) : base + target).split("/");
    const out = [];
    parts.forEach(p => { if (p === "..") out.pop(); else if (p && p !== ".") out.push(p); });
    return out.join("/");
  }

  function relsOf(xml) {
    const map = new Map();
    if (!xml) return map;
    scan(xml, ev => { if (ev.type === "open" && ev.name === "Relationship") map.set(ev.attrs.Id, { target: ev.attrs.Target, type: ev.attrs.Type || "" }); });
    return map;
  }

  function readSheet(xml, strings, dates) {
    const rows = [];
    let rowIndex = -1, colIdx = -1;
    let cell = null, inV = false, inIs = false, inT = false, phonetic = 0;
    scan(xml, ev => {
      if (ev.type === "open") {
        if (ev.name === "row") {
          const r = Number(ev.attrs.r);
          rowIndex = Number.isInteger(r) && r > 0 ? r - 1 : rowIndex + 1;
          colIdx = -1;
          if (!rows[rowIndex]) rows[rowIndex] = [];
        } else if (ev.name === "c") {
          const m = /^([A-Z]+)(\d+)$/.exec(ev.attrs.r || "");
          colIdx = m ? colIndex(m[1]) : colIdx + 1;
          if (m && Number(m[2]) - 1 !== rowIndex) { rowIndex = Number(m[2]) - 1; if (!rows[rowIndex]) rows[rowIndex] = []; }
          cell = { t: ev.attrs.t || "n", s: Number(ev.attrs.s || 0), v: "", is: "", col: colIdx, row: rowIndex };
          if (ev.self) finish();
        } else if (cell && ev.name === "v" && !ev.self) inV = true;
        else if (cell && ev.name === "is" && !ev.self) inIs = true;
        else if (cell && ev.name === "rPh" && !ev.self) phonetic++;
        else if (cell && inIs && ev.name === "t" && !phonetic && !ev.self) inT = true;
      } else if (ev.type === "close") {
        if (ev.name === "c" && cell) finish();
        else if (ev.name === "v") inV = false;
        else if (ev.name === "is") inIs = false;
        else if (ev.name === "rPh") phonetic = Math.max(0, phonetic - 1);
        else if (ev.name === "t") inT = false;
      } else if (cell) {
        if (inV) cell.v += ev.text;
        else if (inT) cell.is += ev.text;
      }
    });
    function finish() {
      const c = cell;
      cell = null; inV = inIs = inT = false; phonetic = 0;
      if (c.row < 0) return;
      let value = null;
      if (c.t === "s") value = c.v.trim() === "" ? null : (strings[Number(c.v)] !== undefined ? strings[Number(c.v)] : null);
      else if (c.t === "inlineStr") value = c.is;
      else if (c.t === "str" || c.t === "d") value = c.v;
      else if (c.t === "b") value = c.v.trim() === "1" || c.v.trim().toLowerCase() === "true";
      else if (c.t === "e") value = null;
      else {
        const n = c.v.trim() === "" ? NaN : Number(c.v);
        value = Number.isFinite(n) ? (dates[c.s] ? { date: n } : n) : null;
      }
      const row = rows[c.row] || (rows[c.row] = []);
      while (row.length < c.col) row.push(null);
      row[c.col] = value;
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    return rows;
  }

  /**
   * Reads a workbook: { sheets: [{ name, hidden, rows }], date1904 }. rows are
   * arrays of cell values (text, number, boolean, null or { date: serial }).
   * options.inflateRaw expands compressed parts; options.limits passes to zip.
   */
  async function readWorkbookAsync(bytes, options) {
    const o = options || {};
    const pkg = await zip.openZipAsync(bytes, { inflateRaw: o.inflateRaw, limits: o.limits });
    const rootRels = relsOf(await pkg.readText("_rels/.rels"));
    let wbPath = "xl/workbook.xml";
    rootRels.forEach(r => { if (/\/officeDocument$/.test(r.type)) wbPath = resolveTarget("", r.target); });
    const wbXml = await pkg.readText(wbPath);
    if (!wbXml) throw new XlsxError("This is not an Excel workbook (no workbook part).");
    const base = wbPath.includes("/") ? wbPath.slice(0, wbPath.lastIndexOf("/") + 1) : "";
    const wbRels = relsOf(await pkg.readText(base + "_rels/" + wbPath.slice(base.length) + ".rels"));
    let date1904 = false;
    const sheetDefs = [];
    scan(wbXml, ev => {
      if (ev.type !== "open") return;
      if (ev.name === "workbookPr") date1904 = ev.attrs.date1904 === "1" || ev.attrs.date1904 === "true";
      if (ev.name === "sheet") sheetDefs.push({ name: ev.attrs.name || "", hidden: ev.attrs.state === "hidden" || ev.attrs.state === "veryHidden", rid: ev.attrs["r:id"] || ev.attrs.id });
    });
    let stringsPath = base + "sharedStrings.xml", stylesPath = base + "styles.xml";
    wbRels.forEach(r => {
      if (/\/sharedStrings$/.test(r.type)) stringsPath = resolveTarget(base, r.target);
      if (/\/styles$/.test(r.type)) stylesPath = resolveTarget(base, r.target);
    });
    const strings = sharedStrings(await pkg.readText(stringsPath));
    const dates = dateStyles(await pkg.readText(stylesPath));
    const sheets = [];
    for (const def of sheetDefs) {
      const rel = wbRels.get(def.rid);
      const xml = rel ? await pkg.readText(resolveTarget(base, rel.target)) : null;
      sheets.push({ name: def.name, hidden: def.hidden, rows: xml ? readSheet(xml, strings, dates) : [] });
    }
    return { sheets, date1904 };
  }

  /**
   * Milliseconds since 1970 for an Excel date serial, reading the wall-clock
   * value as UTC. Serials before 1 March 1900 follow Excel's 1900 leap-year rule.
   */
  function excelSerialToMs(serial, date1904) {
    if (!Number.isFinite(serial)) return null;
    const days = date1904 ? serial + 1462 : serial;
    const adjusted = !date1904 && days < 61 ? days + 1 : days;
    return Math.round((adjusted - 25569) * 86400000);
  }

  return {
    XlsxError, writeWorkbook, workbookBytesAsync, readWorkbookAsync, excelSerialToMs,
    colName, cellRef, isDateFormat, scan
  };
});
