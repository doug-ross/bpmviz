// ZIP, OOXML and XLSX libraries: archives round-trip, limits hold, and a
// workbook shaped like one Excel saves (shared strings, rich text, formulas,
// date styles) reads back as values.
import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { lib } from "./helpers.mjs";
import { openZip as toolOpenZip } from "../../tools/ai/zip.mjs";

const zip = lib("zip");
const ooxml = lib("ooxml");
const xlsx = lib("xlsx");

const inflateRaw = (bytes, max) => new Uint8Array(zlib.inflateRawSync(bytes, max ? { maxOutputLength: max } : {}));
const deflateRaw = bytes => new Uint8Array(zlib.deflateRawSync(bytes));
const text = bytes => new TextDecoder().decode(bytes);

test("CRC-32 matches the standard check value", () => {
  assert.equal(zip.crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(zip.crc32(new Uint8Array(0)), 0);
});

test("stored and deflated archives round-trip, and the AI tools can read them", async () => {
  const entries = [
    { name: "a.txt", data: "hello" },
    { name: "dir/b.xml", data: "<x>" + "repeat ".repeat(500) + "</x>" },
    { name: "bin/c.bin", data: new Uint8Array([0, 1, 2, 255]) },
    { name: "na\u00efve/\u00e9t\u00e9.txt", data: "caf\u00e9" }
  ];
  for (const bytes of [zip.writeZip(entries), await zip.writeZipAsync(entries, { deflateRaw })]) {
    const pkg = await zip.openZipAsync(bytes, { inflateRaw });
    assert.deepEqual(pkg.names, entries.map(e => e.name));
    assert.equal(await pkg.readText("a.txt"), "hello");
    assert.match(await pkg.readText("dir/b.xml"), /^<x>repeat/);
    assert.deepEqual([...(await pkg.read("bin/c.bin"))], [0, 1, 2, 255]);
    assert.equal(await pkg.readText("na\u00efve/\u00e9t\u00e9.txt"), "caf\u00e9");
    assert.equal(await pkg.read("missing"), null);
    const tool = toolOpenZip(Buffer.from(bytes));
    assert.equal(tool.read("dir/b.xml").length, entries[1].data.length);
  }
  const deflated = await zip.writeZipAsync(entries, { deflateRaw });
  const listed = zip.listEntries(deflated);
  assert.equal(listed.find(e => e.name === "dir/b.xml").method, 8);
  assert.equal(listed.find(e => e.name === "a.txt").method, 0, "small entries are stored");
  assert.deepEqual(zip.writeZip(entries), zip.writeZip(entries), "archives are repeatable byte for byte");
});

test("the reader refuses damaged, oversized and suspicious archives", async () => {
  await assert.rejects(zip.openZipAsync(new TextEncoder().encode("not a zip at all, just text"), { inflateRaw }), zip.ZipError);
  const bomb = await zip.writeZipAsync([{ name: "zeros.txt", data: new Uint8Array(4 * 1024 * 1024) }], { deflateRaw });
  await assert.rejects(zip.openZipAsync(bomb, { inflateRaw }), /suspiciously well/);
  const many = zip.writeZip(Array.from({ length: 12 }, (_, i) => ({ name: "f" + i, data: "x" })));
  await assert.rejects(zip.openZipAsync(many, { inflateRaw, limits: { entries: 10 } }), /more than 10 entries/);
  const big = zip.writeZip([{ name: "big.txt", data: "y".repeat(5000) }]);
  await assert.rejects(zip.openZipAsync(big, { limits: { entryBytes: 1000 } }), /expands past/);
  const good = zip.writeZip([{ name: "a.txt", data: "hello world" }]);
  const broken = good.slice();
  broken[30 + 5] ^= 0xff;
  const pkg = await zip.openZipAsync(broken, { inflateRaw });
  await assert.rejects(pkg.read("a.txt"), /checksum/);
  const deflated = await zip.writeZipAsync([{ name: "d.txt", data: "z".repeat(400) + "abc" }], { deflateRaw });
  await assert.rejects((await zip.openZipAsync(deflated, {})).read("d.txt"), /no decompressor/);
  assert.throws(() => zip.writeZip([{ name: "../evil.txt", data: "x" }]), zip.ZipError);
  assert.throws(() => zip.writeZip([{ name: "/abs.txt", data: "x" }]), zip.ZipError);
  assert.throws(() => zip.writeZip([{ name: "a", data: "1" }, { name: "a", data: "2" }]), zip.ZipError);
});

test("XML escaping removes characters XML cannot hold", () => {
  assert.equal(ooxml.escapeXml("a<b>&\"c'"), "a&lt;b&gt;&amp;&quot;c&apos;");
  assert.equal(ooxml.escapeXml("tab\tline\nbell\u0007 null\u0000"), "tab\tline\nbell null");
  assert.equal(ooxml.escapeXml("lone \ud800 low \udc00 pair \ud83d\ude00 \uffff"), "lone  low  pair \ud83d\ude00 ");
  assert.equal(ooxml.escapeXml(null), "");
  const ct = ooxml.contentTypes({ defaults: [{ extension: "png", contentType: "image/png" }], overrides: [{ partName: "/x.xml", contentType: "a/b" }] });
  assert.match(ct, /^<\?xml/);
  assert.match(ct, /Extension="rels"/);
  assert.match(ct, /Extension="png"/);
  assert.match(ct, /PartName="\/x.xml"/);
  const rels = ooxml.rels([{ id: "rId1", type: ooxml.REL.officeDocument, target: "a&b.xml" }]);
  assert.match(rels, /Target="a&amp;b.xml"/);
  const core = ooxml.coreProps({ title: "Review <pack>", creator: "AIxRay", created: "2026-03-01T10:00:00.000Z" });
  assert.match(core, /<dc:title>Review &lt;pack&gt;<\/dc:title>/);
  assert.match(core, /2026-03-01T10:00:00Z/);
  assert.match(ooxml.appProps({ company: "Client & Co" }), /<Company>Client &amp; Co<\/Company>/);
});

test("written workbooks read back with hidden sheets, validations and no formulas", async () => {
  const spec = {
    props: { title: "Review pack", creator: "AIxRay" },
    sheets: [
      { name: "Review", headerRows: 1, freeze: { rows: 1 }, columns: [12, 40, { width: 20 }],
        rows: [["Item ID", "Item", "Verdict"], ["step/m/work", "=SUM(A1:A9)", null], ["record/r1", "Line one\nline two \u00e9", "Confirm"], [1, 2.5, true]],
        validations: [{ range: "C2:C200", list: ["Confirm", "Dispute", "Not sure"] }] },
      { name: "aixray-pack", hidden: true, rows: [["packId", "pack-1"], ["engagementId", "eng-tiny"]] },
      { name: "Dates", rows: [[{ date: 45658.5 }]] },
      { name: "A/B:C*?[x]", rows: [["odd name"]] }
    ]
  };
  const parts = xlsx.writeWorkbook(spec);
  const sheet1 = parts.find(p => p.name === "xl/worksheets/sheet1.xml").data;
  assert.doesNotMatch(sheet1, /<f>/);
  assert.match(sheet1, /t="inlineStr"><is><t xml:space="preserve">=SUM\(A1:A9\)<\/t>/);
  assert.match(sheet1, /<dataValidation type="list"[^>]*sqref="C2:C200"><formula1>&quot;Confirm,Dispute,Not sure&quot;<\/formula1>/);
  assert.match(sheet1, /state="frozen"/);
  assert.match(parts.find(p => p.name === "xl/workbook.xml").data, /name="aixray-pack" sheetId="2" state="hidden"/);
  for (const bytes of [zip.writeZip(parts), await xlsx.workbookBytesAsync(spec, { deflateRaw })]) {
    const wb = await xlsx.readWorkbookAsync(bytes, { inflateRaw });
    assert.deepEqual(wb.sheets.map(s => [s.name, s.hidden]), [["Review", false], ["aixray-pack", true], ["Dates", false], ["A B C   x", false]]);
    assert.deepEqual(wb.sheets[0].rows, [["Item ID", "Item", "Verdict"], ["step/m/work", "=SUM(A1:A9)"], ["record/r1", "Line one\nline two \u00e9", "Confirm"], [1, 2.5, true]]);
    assert.deepEqual(wb.sheets[1].rows, [["packId", "pack-1"], ["engagementId", "eng-tiny"]]);
    assert.deepEqual(wb.sheets[2].rows, [[{ date: 45658.5 }]]);
    assert.equal(wb.date1904, false);
  }
  assert.throws(() => xlsx.writeWorkbook({ sheets: [{ name: "x", hidden: true, rows: [] }] }), xlsx.XlsxError);
  assert.throws(() => xlsx.writeWorkbook({ sheets: [{ name: "x", rows: [], validations: [{ range: "C2:C9", list: ["a,b"] }] }] }), xlsx.XlsxError);
  assert.throws(() => xlsx.writeWorkbook({ sheets: [] }), xlsx.XlsxError);
});

/* A workbook written the way Excel writes one: shared strings, styles, prefixed tags. */
function excelStyleWorkbook(date1904) {
  const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const files = {
    "[Content_Types].xml": "<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>",
    "_rels/.rels": "<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
      "<Relationship Id=\"rId1\" Type=\"" + rel + "/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>",
    "xl/workbook.xml": "<?xml version=\"1.0\"?><workbook xmlns=\"" + main + "\" xmlns:r=\"" + rel + "\">" +
      (date1904 ? "<workbookPr date1904=\"1\"/>" : "<workbookPr/>") +
      "<sheets><sheet name=\"Event log\" sheetId=\"1\" r:id=\"rId1\"/><sheet name=\"Lists\" sheetId=\"2\" state=\"veryHidden\" r:id=\"rId2\"/></sheets></workbook>",
    "xl/_rels/workbook.xml.rels": "<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
      "<Relationship Id=\"rId1\" Type=\"" + rel + "/worksheet\" Target=\"worksheets/sheet1.xml\"/>" +
      "<Relationship Id=\"rId2\" Type=\"" + rel + "/worksheet\" Target=\"/xl/worksheets/sheet2.xml\"/>" +
      "<Relationship Id=\"rId3\" Type=\"" + rel + "/sharedStrings\" Target=\"sharedStrings.xml\"/>" +
      "<Relationship Id=\"rId4\" Type=\"" + rel + "/styles\" Target=\"styles.xml\"/></Relationships>",
    "xl/sharedStrings.xml": "<?xml version=\"1.0\"?><sst xmlns=\"" + main + "\" count=\"6\" uniqueCount=\"6\">" +
      "<si><t>Case</t></si><si><t>Activity</t></si><si><t>Start</t></si>" +
      "<si><r><rPr><b/></rPr><t>Check </t></r><r><t xml:space=\"preserve\">credit &amp; limits</t></r></si>" +
      "<si><t>\u5ba1\u67fb</t><rPh sb=\"0\" eb=\"2\"><t>\u30b7\u30f3\u30b5</t></rPh></si>" +
      "<si><t/></si></sst>",
    "xl/styles.xml": "<?xml version=\"1.0\"?><styleSheet xmlns=\"" + main + "\"><numFmts count=\"2\">" +
      "<numFmt numFmtId=\"164\" formatCode=\"yyyy\\-mm\\-dd\\ hh:mm\"/><numFmt numFmtId=\"165\" formatCode=\"&quot;days&quot;\\ 0.0\"/></numFmts>" +
      "<cellStyleXfs count=\"1\"><xf numFmtId=\"22\"/></cellStyleXfs>" +
      "<cellXfs count=\"4\"><xf numFmtId=\"0\"/><xf numFmtId=\"164\" applyNumberFormat=\"1\"/><xf numFmtId=\"14\"/><xf numFmtId=\"165\"/></cellXfs></styleSheet>",
    "xl/worksheets/sheet1.xml": "<?xml version=\"1.0\"?><x:worksheet xmlns:x=\"" + main + "\"><x:sheetData>" +
      "<x:row r=\"1\"><x:c r=\"A1\" t=\"s\"><x:v>0</x:v></x:c><x:c r=\"B1\" t=\"s\"><x:v>1</x:v></x:c><x:c r=\"C1\" t=\"s\"><x:v>2</x:v></x:c></x:row>" +
      "<x:row r=\"2\"><x:c r=\"A2\"><x:v>1001</x:v></x:c><x:c r=\"B2\" t=\"s\"><x:v>3</x:v></x:c><x:c r=\"C2\" s=\"1\"><x:v>45658.375</x:v></x:c>" +
      "<x:c r=\"E2\" s=\"3\"><x:v>2.5</x:v></x:c></x:row>" +
      "<x:row r=\"4\"><x:c r=\"A4\" t=\"str\"><x:f>A2&amp;\"-b\"</x:f><x:v>1001-b</x:v></x:c><x:c r=\"B4\" t=\"s\"><x:v>4</x:v></x:c>" +
      "<x:c r=\"C4\" s=\"2\"><x:v>45659</x:v></x:c><x:c r=\"D4\" t=\"e\"><x:f>1/0</x:f><x:v>#DIV/0!</x:v></x:c><x:c r=\"F4\" t=\"b\"><x:v>1</x:v></x:c>" +
      "<x:c r=\"G4\" t=\"inlineStr\"><x:is><x:t>inline</x:t></x:is></x:c><x:c r=\"H4\" t=\"s\"><x:v>5</x:v></x:c></x:row>" +
      "</x:sheetData></x:worksheet>",
    "xl/worksheets/sheet2.xml": "<?xml version=\"1.0\"?><worksheet xmlns=\"" + main + "\"><sheetData><row><c><v>7</v></c><c t=\"e\"><v>#N/A</v></c></row></sheetData></worksheet>"
  };
  return Object.keys(files).map(name => ({ name, data: files[name] }));
}

test("an Excel-style workbook reads shared strings, rich text and cached values", async () => {
  const bytes = await zip.writeZipAsync(excelStyleWorkbook(false), { deflateRaw });
  const wb = await xlsx.readWorkbookAsync(bytes, { inflateRaw });
  assert.deepEqual(wb.sheets.map(s => [s.name, s.hidden]), [["Event log", false], ["Lists", true]]);
  const rows = wb.sheets[0].rows;
  assert.deepEqual(rows[0], ["Case", "Activity", "Start"]);
  assert.deepEqual(rows[1], [1001, "Check credit & limits", { date: 45658.375 }, null, 2.5]);
  assert.deepEqual(rows[2], []);
  assert.equal(rows[3][0], "1001-b", "the cached result of a formula is read, the formula is not");
  assert.equal(rows[3][1], "\u5ba1\u67fb", "phonetic runs are left out");
  assert.deepEqual(rows[3][2], { date: 45659 });
  assert.equal(rows[3][3], null, "error results read as empty");
  assert.equal(rows[3][4], null);
  assert.equal(rows[3][5], true);
  assert.equal(rows[3][6], "inline");
  assert.equal(rows[3][7], "");
  assert.deepEqual(wb.sheets[1].rows, [[7, null]]);
  assert.equal(new Date(xlsx.excelSerialToMs(rows[1][2].date, wb.date1904)).toISOString(), "2025-01-01T09:00:00.000Z");
  const wb1904 = await xlsx.readWorkbookAsync(zip.writeZip(excelStyleWorkbook(true)), { inflateRaw });
  assert.equal(wb1904.date1904, true);
  await assert.rejects(xlsx.readWorkbookAsync(zip.writeZip([{ name: "a.txt", data: "x" }]), { inflateRaw }), xlsx.XlsxError);
});

test("Excel date serials convert to UTC wall-clock milliseconds", () => {
  const iso = (s, d1904) => new Date(xlsx.excelSerialToMs(s, d1904)).toISOString();
  assert.equal(iso(1), "1900-01-01T00:00:00.000Z");
  assert.equal(iso(59), "1900-02-28T00:00:00.000Z");
  assert.equal(iso(61), "1900-03-01T00:00:00.000Z");
  assert.equal(iso(45658), "2025-01-01T00:00:00.000Z");
  assert.equal(iso(45658.999988426), "2025-01-01T23:59:59.000Z");
  assert.equal(iso(0, true), "1904-01-01T00:00:00.000Z");
  assert.equal(iso(44196, true), "2025-01-01T00:00:00.000Z");
  assert.equal(xlsx.excelSerialToMs("x"), null);
  assert.equal(xlsx.isDateFormat("yyyy-mm-dd"), true);
  assert.equal(xlsx.isDateFormat("[h]:mm:ss"), true);
  assert.equal(xlsx.isDateFormat("[Red]0.00"), false);
  assert.equal(xlsx.isDateFormat("\"days\" 0"), false);
  assert.equal(xlsx.isDateFormat("General"), false);
  assert.equal(xlsx.colName(0) + xlsx.colName(25) + xlsx.colName(26) + xlsx.colName(701) + xlsx.colName(702), "AZAAZZAAA");
});
