// Builds small DOCX and PPTX files for tests: a ZIP with stored or deflated
// entries holding just the parts AIxRay reads.
import zlib from "node:zlib";

export function zip(files, deflate) {
  const locals = [], centrals = [];
  let offset = 0;
  Object.keys(files).forEach(name => {
    const raw = Buffer.from(files[name]);
    const data = deflate ? zlib.deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  });
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(locals.concat([cd, end]));
}

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* paragraphs: strings, or arrays of strings for a table row. */
export function makeDocx(paragraphs) {
  const body = paragraphs.map(p => Array.isArray(p) ?
    "<w:tbl><w:tr>" + p.map(c => "<w:tc><w:p><w:r><w:t>" + esc(c) + "</w:t></w:r></w:p></w:tc>").join("") + "</w:tr></w:tbl>" :
    "<w:p><w:r><w:t xml:space=\"preserve\">" + esc(p) + "</w:t></w:r></w:p>").join("");
  return zip({
    "[Content_Types].xml": "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>",
    "word/document.xml": "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>" + body + "</w:body></w:document>"
  }, true);
}

/* slides: [{ lines: [...], notes: [...] }] */
export function makePptx(slides) {
  const files = { "[Content_Types].xml": "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>" };
  const para = l => "<a:p><a:r><a:t>" + esc(l) + "</a:t></a:r></a:p>";
  slides.forEach((s, i) => {
    files["ppt/slides/slide" + (i + 1) + ".xml"] = "<p:sld xmlns:p=\"p\" xmlns:a=\"a\">" + s.lines.map(para).join("") + "</p:sld>";
    if (s.notes) files["ppt/notesSlides/notesSlide" + (i + 1) + ".xml"] = "<p:notes xmlns:p=\"p\" xmlns:a=\"a\">" + s.notes.map(para).join("") + "</p:notes>";
  });
  return zip(files, true);
}
