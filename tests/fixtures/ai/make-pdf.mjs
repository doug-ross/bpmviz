// Builds a small text PDF for tests: one array of lines per page. An empty
// array makes a page with no text, as a scanned page would be.
export function makePdf(pages) {
  const objs = [];
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  const kids = pages.map((_, i) => (4 + i * 2) + " 0 R").join(" ");
  objs.push("<< /Type /Pages /Kids [" + kids + "] /Count " + pages.length + " >>");
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pages.forEach((lines, i) => {
    const text = lines.map((l, j) => (j ? "0 -16 Td " : "") + "(" + l.replace(/[()]/g, "") + ") Tj").join(" ");
    const content = lines.length ? "BT /F1 12 Tf 72 720 Td " + text + " ET" : "";
    objs.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents " + (5 + i * 2) + " 0 R >>");
    objs.push("<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream");
  });
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += (i + 1) + " 0 obj\n" + o + "\nendobj\n"; });
  const xref = out.length;
  out += "xref\n0 " + (objs.length + 1) + "\n0000000000 65535 f \n" + offsets.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += "trailer\n<< /Size " + (objs.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  return Buffer.from(out, "latin1");
}
