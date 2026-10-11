/*
 * Turns source files into text an AI tool can read, with locators such as
 * [p12] (paragraph) and [slide 3] so drafted evidence can point back to the
 * source. Handles plain text, Markdown, CSV, JSON, BPMN and XML, DOCX, PPTX
 * and PDF. Images are passed to the AI tool as images, not as text.
 */
import { openZip } from "./zip.mjs";

export const SOURCE_LIMITS = { fileBytes: 25 * 1024 * 1024, totalBytes: 60 * 1024 * 1024, files: 20, pdfPages: 300 };

const TEXT_EXT = new Set([".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".bpmn", ".xml", ".html", ".htm", ".log", ".yaml", ".yml"]);
const IMAGE_TYPES = { png: "image/png", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

/** Identifies a file by its first bytes, then its extension. */
export function sniff(buf, name) {
  const ext = (String(name).match(/\.[^.]+$/) || [""])[0].toLowerCase();
  const b = buf;
  if (b.length >= 5 && b.slice(0, 5).toString("latin1") === "%PDF-") return { kind: "pdf" };
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47) return { kind: "image", mime: IMAGE_TYPES.png, ext: ".png" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: "image", mime: IMAGE_TYPES.jpeg, ext: ".jpg" };
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.slice(0, 6).toString("latin1"))) return { kind: "image", mime: IMAGE_TYPES.gif, ext: ".gif" };
  if (b.length >= 12 && b.slice(0, 4).toString("latin1") === "RIFF" && b.slice(8, 12).toString("latin1") === "WEBP") return { kind: "image", mime: IMAGE_TYPES.webp, ext: ".webp" };
  if (b.length >= 4 && b.readUInt32LE(0) === 0x04034b50) {
    if (ext === ".docx") return { kind: "docx" };
    if (ext === ".pptx") return { kind: "pptx" };
    return { kind: "zip" };
  }
  if (TEXT_EXT.has(ext) || looksLikeText(b)) return { kind: "text" };
  return { kind: "unknown" };
}

function looksLikeText(b) {
  const n = Math.min(b.length, 4096);
  for (let i = 0; i < n; i++) if (b[i] === 0) return false;
  try { new TextDecoder("utf-8", { fatal: true }).decode(b.slice(0, n)); return true; } catch (_) { return false; }
}

function decodeText(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.slice(2));
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.slice(2));
  return new TextDecoder("utf-8").decode(buf).replace(/^\ufeff/, "");
}

function decodeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (all, e) => {
    const k = e.toLowerCase();
    if (k === "amp") return "&";
    if (k === "lt") return "<";
    if (k === "gt") return ">";
    if (k === "quot") return "\"";
    if (k === "apos") return "'";
    const code = k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
  });
}

/* Text runs of one OOXML paragraph: <w:t> or <a:t>, with tabs and breaks. */
function paragraphText(raw, prefix) {
  // Paragraph properties list tab stops as <w:tab/>; they are not text.
  const xml = raw.replace(new RegExp("<" + prefix + ":pPr[\\s>][\\s\\S]*?</" + prefix + ":pPr>", "g"), "");
  const re = new RegExp("<" + prefix + ":(t)(?:\\s[^>]*)?>([^<]*)</" + prefix + ":t>|<" + prefix + ":(tab|br)\\b[^>]*/?>", "g");
  let out = "";
  let m;
  while ((m = re.exec(xml))) out += m[1] ? decodeXml(m[2]) : m[3] === "tab" ? "\t" : "\n";
  return out.replace(/[ \t]+\n/g, "\n").trim();
}

function paragraphs(xml, prefix) {
  const re = new RegExp("<" + prefix + ":p[\\s>][\\s\\S]*?</" + prefix + ":p>", "g");
  return (xml.match(re) || []).map(p => paragraphText(p, prefix)).filter(Boolean);
}

export function docxText(buf) {
  const zip = openZip(buf);
  const body = zip.read("word/document.xml");
  if (body === null) throw new Error("This DOCX file has no document body.");
  const lines = [];
  let n = 0;
  // Tables: keep each row on one line with cells separated by " | ".
  const parts = body.split(/(<w:tbl[\s>][\s\S]*?<\/w:tbl>)/);
  parts.forEach(part => {
    if (/^<w:tbl[\s>]/.test(part)) {
      (part.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) || []).forEach(row => {
        const cells = (row.match(/<w:tc[\s>][\s\S]*?<\/w:tc>/g) || []).map(c => paragraphs(c, "w").join(" "));
        if (cells.some(Boolean)) lines.push("[p" + (++n) + "] " + cells.join(" | "));
      });
    } else {
      paragraphs(part, "w").forEach(p => lines.push("[p" + (++n) + "] " + p));
    }
  });
  const notes = zip.read("word/footnotes.xml");
  if (notes) paragraphs(notes, "w").forEach((p, i) => lines.push("[footnote " + (i + 1) + "] " + p));
  return { text: lines.join("\n"), pages: null, units: n };
}

export function pptxText(buf) {
  const zip = openZip(buf);
  const num = name => Number((name.match(/(\d+)\.xml$/) || [0, 0])[1]);
  const slides = zip.names.filter(x => /^ppt\/slides\/slide\d+\.xml$/.test(x)).sort((a, b) => num(a) - num(b));
  if (!slides.length) throw new Error("This PPTX file has no slides.");
  const lines = [];
  slides.forEach(name => {
    const n = num(name);
    const text = paragraphs(zip.read(name), "a");
    lines.push("[slide " + n + "] " + (text.length ? text.join("\n") : "(no text)"));
    const notes = zip.read("ppt/notesSlides/notesSlide" + n + ".xml");
    if (notes) {
      const t = paragraphs(notes, "a").filter(x => !/^\d+$/.test(x));
      if (t.length) lines.push("[slide " + n + " notes] " + t.join("\n"));
    }
  });
  return { text: lines.join("\n\n"), pages: slides.length, units: slides.length };
}

/* PDF text through pdfjs-dist (a development dependency). Scanned pages have no text. */
export async function pdfText(buf) {
  let pdfjs;
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch (_) {
    throw new Error("PDF text needs the pdfjs-dist package. Run npm install, or convert the PDF to text first.");
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  try {
    const pages = Math.min(doc.numPages, SOURCE_LIMITS.pdfPages);
    const lines = [];
    let empty = 0;
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let text = "";
      content.items.forEach(it => { text += (it.str || "") + (it.hasEOL ? "\n" : " "); });
      text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      if (!text) empty++;
      lines.push("[page " + i + "] " + (text || "(no text on this page; it may be a scanned image)"));
      page.cleanup();
    }
    if (doc.numPages > pages) lines.push("[note] Only the first " + pages + " of " + doc.numPages + " pages were read.");
    return { text: lines.join("\n\n"), pages: doc.numPages, units: pages, emptyPages: empty };
  } finally {
    await task.destroy();
  }
}

/**
 * Extracts one source. Returns { kind, text, pages, mime, warning }.
 * text is null for images.
 */
export async function extractSource(buf, name) {
  const s = sniff(buf, name);
  if (s.kind === "image") return { kind: "image", text: null, pages: null, mime: s.mime, ext: s.ext };
  if (s.kind === "text") return { kind: "text", text: decodeText(buf), pages: null };
  if (s.kind === "docx") return Object.assign({ kind: "docx" }, docxText(buf));
  if (s.kind === "pptx") return Object.assign({ kind: "pptx" }, pptxText(buf));
  if (s.kind === "pdf") {
    const r = await pdfText(buf);
    const warning = r.emptyPages ? r.emptyPages + " of " + r.units + " pages have no text layer (scanned). Export those pages as images to include them." : "";
    return Object.assign({ kind: "pdf", warning }, r);
  }
  if (s.kind === "zip") throw new Error("ZIP archives other than DOCX and PPTX are not read. Unzip them first.");
  throw new Error("This file type is not supported. Use PDF, DOCX, PPTX, images, text, Markdown, CSV or BPMN.");
}
