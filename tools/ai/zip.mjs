/*
 * A small ZIP reader for Office files (DOCX, PPTX). It reads only the
 * entries asked for and refuses archives that would expand past set limits,
 * so a crafted file cannot exhaust memory. ZIP64 and encrypted entries are
 * not supported.
 */
import zlib from "node:zlib";

export const ZIP_LIMITS = { entries: 5000, entryBytes: 40 * 1024 * 1024, totalBytes: 120 * 1024 * 1024, ratio: 250 };

export class ZipError extends Error {}

function findEnd(buf) {
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new ZipError("Not a ZIP file (no end of central directory).");
}

/** Lists entries: [{ name, method, compressedSize, size, offset, flags }]. */
export function listEntries(buf, limits) {
  const L = Object.assign({}, ZIP_LIMITS, limits || {});
  const end = findEnd(buf);
  const count = buf.readUInt16LE(end + 10);
  const cdSize = buf.readUInt32LE(end + 12);
  const cdOffset = buf.readUInt32LE(end + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new ZipError("ZIP64 archives are not supported.");
  if (count > L.entries) throw new ZipError("The archive has more than " + L.entries + " entries.");
  if (cdOffset + cdSize > buf.length) throw new ZipError("The archive is truncated.");
  const entries = [];
  let p = cdOffset;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ZipError("The archive directory is damaged.");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    if (size > L.entryBytes) throw new ZipError("An entry expands past " + Math.round(L.entryBytes / 1048576) + " MB.");
    if (compressedSize > 0 && size / compressedSize > L.ratio) throw new ZipError("An entry compresses suspiciously well (possible ZIP bomb).");
    total += size;
    if (total > L.totalBytes) throw new ZipError("The archive expands past " + Math.round(L.totalBytes / 1048576) + " MB.");
    entries.push({ name, method, compressedSize, size, offset, flags });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Reads one entry as a Buffer. */
export function readEntry(buf, entry, limits) {
  const L = Object.assign({}, ZIP_LIMITS, limits || {});
  if (entry.flags & 1) throw new ZipError("Encrypted entries are not supported.");
  const p = entry.offset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) throw new ZipError("An entry header is damaged.");
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const start = p + 30 + nameLen + extraLen;
  const data = buf.slice(start, start + entry.compressedSize);
  if (data.length < entry.compressedSize) throw new ZipError("An entry is truncated.");
  if (entry.method === 0) return data;
  if (entry.method !== 8) throw new ZipError("Unsupported compression method " + entry.method + ".");
  try {
    return zlib.inflateRawSync(data, { maxOutputLength: Math.min(L.entryBytes, Math.max(entry.size, 1) + 1024) });
  } catch (err) {
    throw new ZipError("An entry could not be expanded: " + err.message);
  }
}

/** Opens an archive: { names, read(name) -> string | null }. */
export function openZip(buf, limits) {
  const entries = listEntries(buf, limits);
  const byName = new Map(entries.map(e => [e.name, e]));
  return {
    names: entries.map(e => e.name),
    read(name) {
      const e = byName.get(name);
      return e ? readEntry(buf, e, limits).toString("utf8") : null;
    }
  };
}
