/*
 * AIxRay pptx: a PowerPoint deck built from an engagement, for people who
 * work in client tools rather than the app. deckFromEngagement assembles the
 * slide content from the shared libraries (exporting, value-case); buildDeck
 * turns that content into OOXML parts for lib/zip.js. A missing process
 * image is shown as a note rather than invented. Every modeled figure keeps
 * the basis label it already carries.
 *
 * lib/ooxml.js is frozen and only lists content types for packages,
 * workbooks and document properties, so the presentation content types are
 * local constants here.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./util.js"), require("./schema.js"), require("./units.js"),
      require("./exporting.js"), require("./value-case.js"), require("./zip.js"), require("./ooxml.js"));
  } else {
    const B = root.AIxRay = root.AIxRay || {};
    B.pptx = factory(B.util, B.schema, B.units, B.exporting, B.valueCase, B.zip, B.ooxml);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, schema, units, exporting, valueCase, zip, ooxml) {
  "use strict";

  class PptxError extends Error {}

  const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main";

  /* Content types OOXML needs for a presentation package; ooxml.TYPES has none of these. */
  const PPTX_TYPES = {
    presentation: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
    slideMaster: "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml",
    slideLayout: "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml",
    slide: "application/vnd.openxmlformats-officedocument.presentationml.slide+xml",
    theme: "application/vnd.openxmlformats-officedocument.theme+xml"
  };

  function emu(inches) {
    return Math.round(inches * 914400);
  }
  const SLIDE_W = emu(13.333), SLIDE_H = emu(7.5);

  /* ---------- Slide XML building blocks ---------- */

  function para(text, opts) {
    const o = opts || {};
    const sz = o.size || 1600;
    const bullet = o.bullet ? '<a:buFont typeface="Arial"/><a:buChar char="\u2022"/>' : "<a:buNone/>";
    const indent = o.bullet ? ' marL="228600" indent="-228600"' : "";
    return "<a:p><a:pPr" + indent + ">" + bullet + "</a:pPr><a:r><a:rPr lang=\"en-US\" sz=\"" + sz + "\"" +
      (o.bold ? " b=\"1\"" : "") + " dirty=\"0\"/><a:t>" + ooxml.escapeXml(text == null ? "" : String(text)) + "</a:t></a:r></a:p>";
  }

  function textBox(id, name, x, y, w, h, paragraphs) {
    return "<p:sp><p:nvSpPr><p:cNvPr id=\"" + id + "\" name=\"" + ooxml.escapeXml(name) + "\"/><p:cNvSpPr txBox=\"1\"/><p:nvPr/></p:nvSpPr>" +
      "<p:spPr><a:xfrm><a:off x=\"" + Math.round(x) + "\" y=\"" + Math.round(y) + "\"/><a:ext cx=\"" + Math.round(w) + "\" cy=\"" + Math.round(h) + "\"/></a:xfrm>" +
      "<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></p:spPr>" +
      "<p:txBody><a:bodyPr wrap=\"square\" anchor=\"t\"><a:normAutofit/></a:bodyPr><a:lstStyle/>" + paragraphs.join("") + "</p:txBody></p:sp>";
  }

  function tableXml(id, x, y, w, h, headers, rows) {
    const cols = Math.max(1, headers.length);
    const colW = Math.max(1, Math.floor(w / cols));
    const grid = headers.map(() => "<a:gridCol w=\"" + colW + "\"/>").join("");
    const rowH = Math.max(emu(0.28), Math.floor(h / Math.max(1, rows.length + 1)));
    const cell = (text, bold) => "<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>" + para(text, { size: 1200, bold: bold }) +
      "</a:txBody><a:tcPr marL=\"45720\" marR=\"45720\" marT=\"22860\" marB=\"22860\" anchor=\"ctr\"/></a:tc>";
    const row = (cells, bold) => "<a:tr h=\"" + rowH + "\">" + cells.map(c => cell(c, bold)).join("") + "</a:tr>";
    const body = rows.map(r => row(headers.map((h2, i) => (r[i] == null ? "" : r[i])), false)).join("");
    return "<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id=\"" + id + "\" name=\"Table\"/>" +
      "<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp=\"1\"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>" +
      "<p:xfrm><a:off x=\"" + Math.round(x) + "\" y=\"" + Math.round(y) + "\"/><a:ext cx=\"" + Math.round(w) + "\" cy=\"" + Math.round(h) + "\"/></p:xfrm>" +
      "<a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/table\">" +
      "<a:tbl><a:tblPr firstRow=\"1\" bandRow=\"1\"/><a:tblGrid>" + grid + "</a:tblGrid>" + row(headers, true) + body + "</a:tbl></a:graphicData></a:graphic></p:graphicFrame>";
  }

  function pictureXml(id, relId, x, y, w, h) {
    return "<p:pic><p:nvPicPr><p:cNvPr id=\"" + id + "\" name=\"Picture\"/><p:cNvPicPr><a:picLocks noChangeAspect=\"1\"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>" +
      "<p:blipFill><a:blip r:embed=\"" + relId + "\"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>" +
      "<p:spPr><a:xfrm><a:off x=\"" + Math.round(x) + "\" y=\"" + Math.round(y) + "\"/><a:ext cx=\"" + Math.round(w) + "\" cy=\"" + Math.round(h) + "\"/></a:xfrm>" +
      "<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></p:spPr></p:pic>";
  }

  /** One slide's XML. sl: { kind: "title"|"bullets"|"table"|"image", title, subtitle, lines, headers, rows, notes, image, note, caption }. */
  function slideXml(sl, imageRelId) {
    let shapes = "";
    let id = 2;
    const addTitle = title => {
      if (!title) return;
      shapes += textBox(id++, "Title", emu(0.6), emu(0.35), SLIDE_W - emu(1.2), emu(0.9), [para(title, { size: 2800, bold: true })]);
    };
    if (sl.kind === "title") {
      shapes += textBox(id++, "Title", emu(0.7), emu(2.3), SLIDE_W - emu(1.4), emu(1.3), [para(sl.title || "", { size: 3600, bold: true })]);
      if (sl.subtitle) shapes += textBox(id++, "Subtitle", emu(0.7), emu(3.5), SLIDE_W - emu(1.4), emu(0.6), [para(sl.subtitle, { size: 1800 })]);
      if ((sl.lines || []).length) shapes += textBox(id++, "Lines", emu(0.7), emu(4.3), SLIDE_W - emu(1.4), emu(2.4), sl.lines.map(l => para(l, { size: 1400 })));
    } else if (sl.kind === "bullets") {
      addTitle(sl.title);
      const lines = sl.lines && sl.lines.length ? sl.lines : ["Nothing to show."];
      shapes += textBox(id++, "Body", emu(0.7), emu(1.4), SLIDE_W - emu(1.4), SLIDE_H - emu(1.9), lines.map(l => para(l, { size: 1600, bullet: true })));
    } else if (sl.kind === "table") {
      addTitle(sl.title);
      const notesH = sl.notes && sl.notes.length ? emu(0.9) : 0;
      shapes += tableXml(id++, emu(0.5), emu(1.4), SLIDE_W - emu(1), SLIDE_H - emu(1.9) - notesH, sl.headers || [], sl.rows || []);
      if (notesH) shapes += textBox(id++, "Notes", emu(0.5), SLIDE_H - emu(0.9), SLIDE_W - emu(1), emu(0.8), sl.notes.map(n => para(n, { size: 1100, bullet: true })));
    } else if (sl.kind === "image") {
      addTitle(sl.title);
      if (imageRelId && sl.image) {
        const maxW = SLIDE_W - emu(1), maxH = SLIDE_H - emu(2.1);
        const ratio = Math.min(maxW / sl.image.width, maxH / sl.image.height, 1);
        const w = Math.round(sl.image.width * ratio), h = Math.round(sl.image.height * ratio);
        shapes += pictureXml(id++, imageRelId, Math.round((SLIDE_W - w) / 2), emu(1.4) + Math.round((maxH - h) / 2), w, h);
      } else {
        shapes += textBox(id++, "Body", emu(0.7), emu(1.6), SLIDE_W - emu(1.4), emu(1.2), [para(sl.note || "No process diagram is available.", { size: 1600 })]);
      }
      if (sl.caption) shapes += textBox(id++, "Caption", emu(0.7), SLIDE_H - emu(0.7), SLIDE_W - emu(1.4), emu(0.5), [para(sl.caption, { size: 1200 })]);
    } else {
      addTitle(sl.title);
    }
    return ooxml.XML_HEAD + "<p:sld xmlns:a=\"" + A_NS + "\" xmlns:r=\"" + ooxml.NS.officeRel + "\" xmlns:p=\"" + P_NS + "\">" +
      "<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>" +
      "<p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>" +
      shapes + "</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>";
  }

  function presentationXml(slides) {
    return ooxml.XML_HEAD + "<p:presentation xmlns:a=\"" + A_NS + "\" xmlns:r=\"" + ooxml.NS.officeRel + "\" xmlns:p=\"" + P_NS + "\">" +
      "<p:sldMasterIdLst><p:sldMasterId id=\"2147483648\" r:id=\"rId1\"/></p:sldMasterIdLst>" +
      "<p:sldIdLst>" + slides.map((sl, i) => "<p:sldId id=\"" + (256 + i) + "\" r:id=\"rId" + (i + 2) + "\"/>").join("") + "</p:sldIdLst>" +
      "<p:sldSz cx=\"" + SLIDE_W + "\" cy=\"" + SLIDE_H + "\" type=\"screen16x9\"/><p:notesSz cx=\"6858000\" cy=\"9144000\"/>" +
      "</p:presentation>";
  }

  const SLIDE_MASTER_XML = ooxml.XML_HEAD + "<p:sldMaster xmlns:a=\"" + A_NS + "\" xmlns:r=\"" + ooxml.NS.officeRel + "\" xmlns:p=\"" + P_NS + "\">" +
    "<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val=\"FFFFFF\"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>" +
    "<p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>" +
    "<p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>" +
    "</p:spTree></p:cSld>" +
    "<p:clrMap bg1=\"lt1\" tx1=\"dk1\" bg2=\"lt2\" tx2=\"dk2\" accent1=\"accent1\" accent2=\"accent2\" accent3=\"accent3\" accent4=\"accent4\" accent5=\"accent5\" accent6=\"accent6\" hlink=\"hlink\" folHlink=\"folHlink\"/>" +
    "<p:sldLayoutIdLst><p:sldLayoutId id=\"2147483649\" r:id=\"rId1\"/></p:sldLayoutIdLst>" +
    "<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz=\"4400\"/></a:lvl1pPr></p:titleStyle>" +
    "<p:bodyStyle><a:lvl1pPr><a:defRPr sz=\"2800\"/></a:lvl1pPr></p:bodyStyle>" +
    "<p:otherStyle><a:lvl1pPr><a:defRPr sz=\"2800\"/></a:lvl1pPr></p:otherStyle></p:txStyles>" +
    "</p:sldMaster>";

  const SLIDE_LAYOUT_XML = ooxml.XML_HEAD + "<p:sldLayout xmlns:a=\"" + A_NS + "\" xmlns:r=\"" + ooxml.NS.officeRel + "\" xmlns:p=\"" + P_NS + "\" type=\"blank\" preserve=\"1\">" +
    "<p:cSld name=\"Blank\"><p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>" +
    "<p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>" +
    "</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>";

  const THEME_XML = ooxml.XML_HEAD + "<a:theme xmlns:a=\"" + A_NS + "\" name=\"AIxRay\"><a:themeElements>" +
    "<a:clrScheme name=\"AIxRay\">" +
    "<a:dk1><a:sysClr val=\"windowText\" lastClr=\"000000\"/></a:dk1><a:lt1><a:sysClr val=\"window\" lastClr=\"FFFFFF\"/></a:lt1>" +
    "<a:dk2><a:srgbClr val=\"2B0A3D\"/></a:dk2><a:lt2><a:srgbClr val=\"EEEEEE\"/></a:lt2>" +
    "<a:accent1><a:srgbClr val=\"5B2A86\"/></a:accent1><a:accent2><a:srgbClr val=\"8456A8\"/></a:accent2>" +
    "<a:accent3><a:srgbClr val=\"2B0A3D\"/></a:accent3><a:accent4><a:srgbClr val=\"71717E\"/></a:accent4>" +
    "<a:accent5><a:srgbClr val=\"B9A6CC\"/></a:accent5><a:accent6><a:srgbClr val=\"EEEEEE\"/></a:accent6>" +
    "<a:hlink><a:srgbClr val=\"5B2A86\"/></a:hlink><a:folHlink><a:srgbClr val=\"2B0A3D\"/></a:folHlink>" +
    "</a:clrScheme>" +
    "<a:fontScheme name=\"AIxRay\"><a:majorFont><a:latin typeface=\"Ubuntu\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/></a:majorFont>" +
    "<a:minorFont><a:latin typeface=\"Ubuntu\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/></a:minorFont></a:fontScheme>" +
    "<a:fmtScheme name=\"AIxRay\">" +
    "<a:fillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:fillStyleLst>" +
    "<a:lnStyleLst><a:ln w=\"6350\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:ln><a:ln w=\"12700\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:ln><a:ln w=\"19050\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:ln></a:lnStyleLst>" +
    "<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>" +
    "<a:bgFillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:bgFillStyleLst>" +
    "</a:fmtScheme></a:themeElements></a:theme>";

  /** The parts of a deck ([{ name, data }], for zip.writeZip or writeZipAsync). spec: { title, slides }. */
  function buildDeck(spec) {
    const s = spec || {};
    const slides = Array.isArray(s.slides) ? s.slides : [];
    if (!slides.length) throw new PptxError("A deck needs at least one slide.");
    const hasImage = slides.some(sl => sl.kind === "image" && sl.image && sl.image.bytes);
    const overrides = [
      { partName: "/ppt/presentation.xml", contentType: PPTX_TYPES.presentation },
      { partName: "/ppt/slideMasters/slideMaster1.xml", contentType: PPTX_TYPES.slideMaster },
      { partName: "/ppt/slideLayouts/slideLayout1.xml", contentType: PPTX_TYPES.slideLayout },
      { partName: "/ppt/theme/theme1.xml", contentType: PPTX_TYPES.theme },
      { partName: "/docProps/core.xml", contentType: ooxml.TYPES.core },
      { partName: "/docProps/app.xml", contentType: ooxml.TYPES.app }
    ].concat(slides.map((sl, i) => ({ partName: "/ppt/slides/slide" + (i + 1) + ".xml", contentType: PPTX_TYPES.slide })));
    const parts = [];
    parts.push({ name: "[Content_Types].xml", data: ooxml.contentTypes({ defaults: hasImage ? [{ extension: "png", contentType: ooxml.TYPES.png }] : [], overrides }) });
    parts.push({ name: "_rels/.rels", data: ooxml.rels([
      { id: "rId1", type: ooxml.REL.officeDocument, target: "ppt/presentation.xml" },
      { id: "rId2", type: ooxml.REL.coreProperties, target: "docProps/core.xml" },
      { id: "rId3", type: ooxml.REL.extendedProperties, target: "docProps/app.xml" }
    ]) });
    parts.push({ name: "docProps/core.xml", data: ooxml.coreProps({ title: s.title || "Client deck", creator: "AIxRay", created: util.nowIso() }) });
    parts.push({ name: "docProps/app.xml", data: ooxml.appProps({ application: "AIxRay" }) });
    parts.push({ name: "ppt/presentation.xml", data: presentationXml(slides) });
    parts.push({ name: "ppt/_rels/presentation.xml.rels", data: ooxml.rels(
      [{ id: "rId1", type: ooxml.REL.slideMaster, target: "slideMasters/slideMaster1.xml" }]
        .concat(slides.map((sl, i) => ({ id: "rId" + (i + 2), type: ooxml.REL.slide, target: "slides/slide" + (i + 1) + ".xml" })))) });
    parts.push({ name: "ppt/theme/theme1.xml", data: THEME_XML });
    parts.push({ name: "ppt/slideMasters/slideMaster1.xml", data: SLIDE_MASTER_XML });
    parts.push({ name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: ooxml.rels([
      { id: "rId1", type: ooxml.REL.slideLayout, target: "../slideLayouts/slideLayout1.xml" },
      { id: "rId2", type: ooxml.REL.theme, target: "../theme/theme1.xml" }
    ]) });
    parts.push({ name: "ppt/slideLayouts/slideLayout1.xml", data: SLIDE_LAYOUT_XML });
    parts.push({ name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: ooxml.rels([
      { id: "rId1", type: ooxml.REL.slideMaster, target: "../slideMasters/slideMaster1.xml" }
    ]) });
    let imageIndex = 0;
    slides.forEach((sl, i) => {
      const n = i + 1;
      const usesImage = sl.kind === "image" && sl.image && sl.image.bytes;
      let mediaName = null;
      if (usesImage) { imageIndex++; mediaName = "image" + imageIndex + ".png"; }
      parts.push({ name: "ppt/slides/slide" + n + ".xml", data: slideXml(sl, mediaName ? "rId2" : null) });
      const slideRels = [{ id: "rId1", type: ooxml.REL.slideLayout, target: "../slideLayouts/slideLayout1.xml" }];
      if (usesImage) {
        slideRels.push({ id: "rId2", type: ooxml.REL.image, target: "../media/" + mediaName });
        parts.push({ name: "ppt/media/" + mediaName, data: sl.image.bytes });
      }
      parts.push({ name: "ppt/slides/_rels/slide" + n + ".xml.rels", data: ooxml.rels(slideRels) });
    });
    return parts;
  }

  /** The deck as .pptx bytes. options.deflateRaw compresses; without it the parts are stored. */
  function pptxBytesAsync(spec, options) {
    return zip.writeZipAsync(buildDeck(spec), options || {});
  }

  /* ---------- Deck content from an engagement ---------- */

  function paginate(rows, size) {
    const n = size || 10;
    if (!rows.length) return [[]];
    const out = [];
    for (let i = 0; i < rows.length; i += n) out.push(rows.slice(i, i + n));
    return out;
  }

  function tableSlides(title, headers, rows, notes) {
    const pages = paginate(rows, 10);
    return pages.map((page, i) => ({
      kind: "table",
      title: pages.length > 1 ? title + " (" + (i + 1) + " of " + pages.length + ")" : title,
      headers, rows: page,
      notes: i === pages.length - 1 ? (notes || []) : []
    }));
  }

  /**
   * The content of a client deck for one engagement: { title, subtitle, slides }
   * (see buildDeck for the slide shape). opts: { includeSensitive,
   * includeUnreviewedAi, scenarioId, image: { bytes, width, height } | null }.
   * Sensitive records and unreviewed AI drafts are left out unless asked for;
   * a missing process image is noted rather than invented.
   */
  function deckFromEngagement(e, opts) {
    const o = opts || {};
    const ctx = { includeSensitive: !!o.includeSensitive, includeUnreviewedAi: !!o.includeUnreviewedAi, scenarioId: o.scenarioId || "" };
    const fmtCtx = { currency: e.meta.currency, timeBasis: e.meta.timeBasis };
    const hd = exporting.buildHandoff(e, ctx);
    const slides = [];

    slides.push({
      kind: "title", title: hd.title,
      subtitle: [hd.client, hd.engagementName].filter(Boolean).join(" \u00b7 "),
      lines: [hd.dataStatus, hd.confidentiality, "Version " + hd.revision].filter(Boolean)
    });

    slides.push(...tableSlides("Scope", ["Process", "Role", "Version", "Status", "Steps"],
      hd.models.map(m => [m.name, m.role, String(m.version), m.status, String(m.steps)])));

    if (hd.sections.pain.length) {
      slides.push(...tableSlides("Pain points", ["Pain point", "Steps", "Owner", "Status"],
        hd.sections.pain.map(r => [r.title, r.steps.join(", ") || "Not linked", r.owner || "Unassigned", r.status])));
    }

    const ranked = valueCase.rank(e, ctx);
    if (ranked.length) {
      slides.push(...tableSlides("Opportunities", ["Rank", "Opportunity", "Value", "Wave"],
        ranked.map(r => [String(r.rank), r.title,
          r.value === null ? "No estimate yet" : units.formatMeasure(r.value, r.unit, fmtCtx) + " a year (" + schema.label("assumptionStatus", r.basis).toLowerCase() + " inputs)",
          schema.label("wave", r.wave || "")])));
    }

    const folio = valueCase.portfolio(e, ctx);
    const waveRows = folio.waves.filter(w => w.wave).map(w => [w.label, String(w.recordIds.length),
      w.netAnnualBenefit === null ? "No estimate yet" : units.formatMeasure(w.netAnnualBenefit, "currency", fmtCtx),
      w.annualHoursSaved === null ? "No estimate yet" : units.formatMeasure(w.annualHoursSaved, "hour", fmtCtx)]);
    if (waveRows.length) {
      waveRows.push(["Total, all planned waves", String(folio.total.recordIds.length),
        folio.total.netAnnualBenefit === null ? "No estimate yet" : units.formatMeasure(folio.total.netAnnualBenefit, "currency", fmtCtx),
        folio.total.annualHoursSaved === null ? "No estimate yet" : units.formatMeasure(folio.total.annualHoursSaved, "hour", fmtCtx)]);
      slides.push(...tableSlides("Value by wave", ["Wave", "Opportunities", "Net annual benefit", "Hours saved per year"], waveRows, folio.notes));
    }

    slides.push({
      kind: "image", title: "Process", image: o.image || null,
      note: "No process diagram is available. Open the Process tab, then export again.",
      caption: hd.scenario ? "Scenario: " + hd.scenario.name + " (" + hd.scenario.provenance.toLowerCase() + ")" : ""
    });

    [["decision", "Decisions"], ["action", "Actions"], ["question", "Open questions"]].forEach(([kind, title]) => {
      const list = hd.sections[kind];
      if (!list.length) return;
      slides.push(...tableSlides(title, ["Item", "Owner", "Status"], list.map(r => [r.title, r.owner || "Unassigned", r.status])));
    });

    slides.push({
      kind: "bullets", title: "About this data",
      lines: [
        hd.disclosure || "No disclosure statement is recorded for this project.",
        hd.excludedSensitive ? hd.excludedSensitive + " sensitive finding" + (hd.excludedSensitive === 1 ? " is" : "s are") + " left out of this deck." : "",
        hd.excludedUnreviewedAi ? hd.excludedUnreviewedAi + " AI draft" + (hd.excludedUnreviewedAi === 1 ? " is" : "s are") + " not yet reviewed and left out of this deck." : ""
      ].filter(Boolean)
    });

    return { title: hd.title, subtitle: [hd.client, hd.engagementName].filter(Boolean).join(" \u00b7 "), slides };
  }

  return { PptxError, deckFromEngagement, buildDeck, pptxBytesAsync };
});
