/*
 * BPMVIZ ooxml: shared parts of Office Open XML packages (XLSX, PPTX):
 * escaping, [Content_Types].xml, relationships and document properties.
 * Every function returns XML text; lib/zip.js packs the parts.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else { const B = root.BPMVIZ = root.BPMVIZ || {}; B.ooxml = factory(); }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const XML_HEAD = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n";

  const NS = {
    contentTypes: "http://schemas.openxmlformats.org/package/2006/content-types",
    relationships: "http://schemas.openxmlformats.org/package/2006/relationships",
    officeRel: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    core: "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
    extended: "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties",
    docProps: "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes",
    dc: "http://purl.org/dc/elements/1.1/",
    dcterms: "http://purl.org/dc/terms/",
    dcmitype: "http://purl.org/dc/dcmitype/",
    xsi: "http://www.w3.org/2001/XMLSchema-instance"
  };

  const REL = {
    officeDocument: NS.officeRel + "/officeDocument",
    coreProperties: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
    extendedProperties: NS.officeRel + "/extended-properties",
    worksheet: NS.officeRel + "/worksheet",
    styles: NS.officeRel + "/styles",
    sharedStrings: NS.officeRel + "/sharedStrings",
    theme: NS.officeRel + "/theme",
    slide: NS.officeRel + "/slide",
    slideLayout: NS.officeRel + "/slideLayout",
    slideMaster: NS.officeRel + "/slideMaster",
    image: NS.officeRel + "/image",
    hyperlink: NS.officeRel + "/hyperlink"
  };

  const TYPES = {
    rels: "application/vnd.openxmlformats-package.relationships+xml",
    xml: "application/xml",
    png: "image/png",
    core: "application/vnd.openxmlformats-package.core-properties+xml",
    app: "application/vnd.openxmlformats-officedocument.extended-properties+xml",
    workbook: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    worksheet: "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
    styles: "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml",
    sharedStrings: "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"
  };

  /*
   * Characters XML 1.0 does not allow (most control characters, lone
   * surrogates, U+FFFE and U+FFFF) are removed; the rest is escaped.
   */
  const SUSPECT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/;

  function stripInvalid(text) {
    const s = String(text == null ? "" : text);
    if (!SUSPECT.test(s)) return s;
    let out = "";
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = s.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) { out += s[i] + s[i + 1]; i++; }
        continue;
      }
      if (c >= 0xdc00 && c <= 0xdfff) continue;
      if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0xfffe || c === 0xffff) continue;
      out += s[i];
    }
    return out;
  }

  /** Escapes text for XML element content and attribute values. */
  function escapeXml(text) {
    return stripInvalid(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }

  function attrs(obj) {
    return Object.keys(obj).filter(k => obj[k] !== undefined && obj[k] !== null)
      .map(k => " " + k + "=\"" + escapeXml(obj[k]) + "\"").join("");
  }

  /**
   * [Content_Types].xml. defaults: [{ extension, contentType }] (rels and xml
   * are always included); overrides: [{ partName, contentType }].
   */
  function contentTypes(opts) {
    const o = opts || {};
    const defaults = [{ extension: "rels", contentType: TYPES.rels }, { extension: "xml", contentType: TYPES.xml }];
    (o.defaults || []).forEach(d => { if (!defaults.some(x => x.extension === d.extension)) defaults.push(d); });
    return XML_HEAD + "<Types xmlns=\"" + NS.contentTypes + "\">" +
      defaults.map(d => "<Default" + attrs({ Extension: d.extension, ContentType: d.contentType }) + "/>").join("") +
      (o.overrides || []).map(x => "<Override" + attrs({ PartName: x.partName, ContentType: x.contentType }) + "/>").join("") +
      "</Types>";
  }

  /** A relationships part: [{ id, type, target, targetMode }]. */
  function rels(list) {
    return XML_HEAD + "<Relationships xmlns=\"" + NS.relationships + "\">" +
      (list || []).map(r => "<Relationship" + attrs({ Id: r.id, Type: r.type, Target: r.target, TargetMode: r.targetMode }) + "/>").join("") +
      "</Relationships>";
  }

  /** docProps/core.xml: { title, subject, creator, description, keywords, created, modified } (dates as ISO text). */
  function coreProps(p) {
    const x = p || {};
    const el = (tag, v) => (v ? "<" + tag + ">" + escapeXml(v) + "</" + tag + ">" : "");
    const date = (tag, v) => (v ? "<" + tag + " xsi:type=\"dcterms:W3CDTF\">" + escapeXml(String(v).replace(/\.\d{3}Z$/, "Z")) + "</" + tag + ">" : "");
    return XML_HEAD + "<cp:coreProperties xmlns:cp=\"" + NS.core + "\" xmlns:dc=\"" + NS.dc + "\" xmlns:dcterms=\"" + NS.dcterms +
      "\" xmlns:dcmitype=\"" + NS.dcmitype + "\" xmlns:xsi=\"" + NS.xsi + "\">" +
      el("dc:title", x.title) + el("dc:subject", x.subject) + el("dc:creator", x.creator) + el("dc:description", x.description) +
      el("cp:keywords", x.keywords) + date("dcterms:created", x.created) + date("dcterms:modified", x.modified) +
      "</cp:coreProperties>";
  }

  /** docProps/app.xml: { application, company }. */
  function appProps(p) {
    const x = p || {};
    return XML_HEAD + "<Properties xmlns=\"" + NS.extended + "\" xmlns:vt=\"" + NS.docProps + "\">" +
      "<Application>" + escapeXml(x.application || "BPMVIZ") + "</Application>" +
      (x.company ? "<Company>" + escapeXml(x.company) + "</Company>" : "") +
      "</Properties>";
  }

  return { XML_HEAD, NS, REL, TYPES, escapeXml, stripInvalid, attrs, contentTypes, rels, coreProps, appProps };
});
