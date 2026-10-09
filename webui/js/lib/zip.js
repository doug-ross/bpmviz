/*
 * BPMVIZ zip: a small ZIP writer and reader for Office files (XLSX, PPTX)
 * and packs. Compression is passed in: the browser gives Compression
 * Streams wrappers (ui/files.js), Node tests give node:zlib. The reader
 * refuses archives that would expand past set limits, the same limits as
 * tools/ai/zip.mjs. ZIP64 and encrypted entries are not supported.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else { const B = root.BPMVIZ = root.BPMVIZ || {}; B.zip = factory(); }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const LIMITS = { entries: 5000, entryBytes: 40 * 1024 * 1024, totalBytes: 120 * 1024 * 1024, ratio: 250 };

  class ZipError extends Error {}

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  /** CRC-32 of a Uint8Array, as an unsigned integer. */
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function utf8(text) {
    return new TextEncoder().encode(text);
  }

  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (typeof data === "string") return utf8(data);
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    throw new ZipError("Entry data must be text or bytes.");
  }

  /* A fixed timestamp (1 January 2026, 00:00) keeps archives byte-for-byte repeatable. */
  const DOS_TIME = 0;
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

  function checkName(name) {
    if (typeof name !== "string" || !name || name.length > 400 || name.startsWith("/") || name.includes("\\") || name.split("/").includes("..")) {
      throw new ZipError("Invalid entry name: " + String(name).slice(0, 80));
    }
  }

  /* Assembles the archive from prepared entries: { name, bytes (stored or deflated), method, crc, size }. */
  function assemble(prepared) {
    if (prepared.length > 0xfffe) throw new ZipError("Too many entries for a ZIP file without ZIP64.");
    const names = prepared.map(p => utf8(p.name));
    let localSize = 0, centralSize = 0;
    prepared.forEach((p, i) => { localSize += 30 + names[i].length + p.bytes.length; centralSize += 46 + names[i].length; });
    if (localSize + centralSize + 22 > 0xffffffff) throw new ZipError("The archive is too large for a ZIP file without ZIP64.");
    const out = new Uint8Array(localSize + centralSize + 22);
    const view = new DataView(out.buffer);
    let at = 0;
    const offsets = [];
    prepared.forEach((p, i) => {
      offsets.push(at);
      view.setUint32(at, 0x04034b50, true);
      view.setUint16(at + 4, 20, true);
      view.setUint16(at + 6, 0x0800, true);
      view.setUint16(at + 8, p.method, true);
      view.setUint16(at + 10, DOS_TIME, true);
      view.setUint16(at + 12, DOS_DATE, true);
      view.setUint32(at + 14, p.crc, true);
      view.setUint32(at + 18, p.bytes.length, true);
      view.setUint32(at + 22, p.size, true);
      view.setUint16(at + 26, names[i].length, true);
      view.setUint16(at + 28, 0, true);
      out.set(names[i], at + 30);
      out.set(p.bytes, at + 30 + names[i].length);
      at += 30 + names[i].length + p.bytes.length;
    });
    const cdStart = at;
    prepared.forEach((p, i) => {
      view.setUint32(at, 0x02014b50, true);
      view.setUint16(at + 4, 20, true);
      view.setUint16(at + 6, 20, true);
      view.setUint16(at + 8, 0x0800, true);
      view.setUint16(at + 10, p.method, true);
      view.setUint16(at + 12, DOS_TIME, true);
      view.setUint16(at + 14, DOS_DATE, true);
      view.setUint32(at + 16, p.crc, true);
      view.setUint32(at + 20, p.bytes.length, true);
      view.setUint32(at + 24, p.size, true);
      view.setUint16(at + 28, names[i].length, true);
      view.setUint16(at + 30, 0, true);
      view.setUint16(at + 32, 0, true);
      view.setUint16(at + 34, 0, true);
      view.setUint16(at + 36, 0, true);
      view.setUint32(at + 38, 0, true);
      view.setUint32(at + 42, offsets[i], true);
      out.set(names[i], at + 46);
      at += 46 + names[i].length;
    });
    view.setUint32(at, 0x06054b50, true);
    view.setUint16(at + 4, 0, true);
    view.setUint16(at + 6, 0, true);
    view.setUint16(at + 8, prepared.length, true);
    view.setUint16(at + 10, prepared.length, true);
    view.setUint32(at + 12, at - cdStart, true);
    view.setUint32(at + 16, cdStart, true);
    view.setUint16(at + 20, 0, true);
    return out;
  }

  function prepare(entries) {
    if (!Array.isArray(entries)) throw new ZipError("Entries must be a list of { name, data }.");
    const seen = new Set();
    return entries.map(e => {
      checkName(e.name);
      if (seen.has(e.name)) throw new ZipError("Duplicate entry name: " + e.name);
      seen.add(e.name);
      const bytes = toBytes(e.data);
      return { name: e.name, raw: bytes, crc: crc32(bytes), size: bytes.length };
    });
  }

  /** Writes a ZIP archive with every entry stored (no compression). entries: [{ name, data }]. */
  function writeZip(entries) {
    return assemble(prepare(entries).map(p => ({ name: p.name, bytes: p.raw, method: 0, crc: p.crc, size: p.size })));
  }

  /**
   * Writes a ZIP archive with DEFLATE. options.deflateRaw(bytes) returns raw
   * deflate data (or a promise of it). An entry is stored when compressing
   * does not make it smaller.
   */
  async function writeZipAsync(entries, options) {
    const deflate = options && options.deflateRaw;
    if (typeof deflate !== "function") return writeZip(entries);
    const prepared = prepare(entries);
    const done = [];
    for (const p of prepared) {
      let packed = p.size > 64 ? toBytes(await deflate(p.raw)) : null;
      if (packed && packed.length >= p.size) packed = null;
      done.push({ name: p.name, bytes: packed || p.raw, method: packed ? 8 : 0, crc: p.crc, size: p.size });
    }
    return assemble(done);
  }

  function findEnd(view) {
    const min = Math.max(0, view.byteLength - 65557);
    for (let i = view.byteLength - 22; i >= min; i--) {
      if (view.getUint32(i, true) === 0x06054b50) return i;
    }
    throw new ZipError("Not a ZIP file (no end of central directory).");
  }

  /** Lists entries: [{ name, method, compressedSize, size, offset, flags, crc }]. */
  function listEntries(bytes, limits) {
    const L = Object.assign({}, LIMITS, limits || {});
    const b = toBytes(bytes);
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (b.length < 22) throw new ZipError("Not a ZIP file.");
    const end = findEnd(view);
    const count = view.getUint16(end + 10, true);
    const cdSize = view.getUint32(end + 12, true);
    const cdOffset = view.getUint32(end + 16, true);
    if (count === 0xffff || cdOffset === 0xffffffff) throw new ZipError("ZIP64 archives are not supported.");
    if (count > L.entries) throw new ZipError("The archive has more than " + L.entries + " entries.");
    if (cdOffset + cdSize > b.length) throw new ZipError("The archive is truncated.");
    const decoder = new TextDecoder("utf-8");
    const entries = [];
    let p = cdOffset;
    let total = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > b.length || view.getUint32(p, true) !== 0x02014b50) throw new ZipError("The archive directory is damaged.");
      const flags = view.getUint16(p + 8, true);
      const method = view.getUint16(p + 10, true);
      const crc = view.getUint32(p + 16, true);
      const compressedSize = view.getUint32(p + 20, true);
      const size = view.getUint32(p + 24, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const offset = view.getUint32(p + 42, true);
      if (p + 46 + nameLen > b.length) throw new ZipError("The archive directory is damaged.");
      const name = decoder.decode(b.subarray(p + 46, p + 46 + nameLen));
      if (size === 0xffffffff || compressedSize === 0xffffffff || offset === 0xffffffff) throw new ZipError("ZIP64 archives are not supported.");
      if (size > L.entryBytes) throw new ZipError("An entry expands past " + Math.round(L.entryBytes / 1048576) + " MB.");
      if (compressedSize > 0 && size / compressedSize > L.ratio) throw new ZipError("An entry compresses suspiciously well (possible ZIP bomb).");
      total += size;
      if (total > L.totalBytes) throw new ZipError("The archive expands past " + Math.round(L.totalBytes / 1048576) + " MB.");
      entries.push({ name, method, compressedSize, size, offset, flags, crc });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  /**
   * Opens an archive: { names, read(name) -> Promise<Uint8Array|null>, readText(name) -> Promise<string|null> }.
   * options.inflateRaw(bytes, maxOutput) expands method-8 entries; options.limits overrides LIMITS.
   */
  function openZipAsync(bytes, options) {
    const o = options || {};
    const L = Object.assign({}, LIMITS, o.limits || {});
    const b = toBytes(bytes);
    let entries;
    try {
      entries = listEntries(b, L);
    } catch (err) {
      return Promise.reject(err);
    }
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const byName = new Map(entries.map(e => [e.name, e]));
    async function read(name) {
      const e = byName.get(name);
      if (!e) return null;
      if (e.flags & 1) throw new ZipError("Encrypted entries are not supported.");
      const p = e.offset;
      if (p + 30 > b.length || view.getUint32(p, true) !== 0x04034b50) throw new ZipError("An entry header is damaged.");
      const start = p + 30 + view.getUint16(p + 26, true) + view.getUint16(p + 28, true);
      if (start + e.compressedSize > b.length) throw new ZipError("An entry is truncated.");
      const data = b.subarray(start, start + e.compressedSize);
      let out;
      if (e.method === 0) out = data;
      else if (e.method === 8) {
        if (typeof o.inflateRaw !== "function") throw new ZipError("This archive is compressed and no decompressor was given.");
        try {
          out = toBytes(await o.inflateRaw(data, Math.min(L.entryBytes, e.size + 1024)));
        } catch (err) {
          throw new ZipError("An entry could not be expanded: " + (err && err.message ? err.message : err));
        }
      } else throw new ZipError("Unsupported compression method " + e.method + ".");
      if (out.length !== e.size) throw new ZipError("An entry has the wrong size.");
      if (crc32(out) !== e.crc) throw new ZipError("An entry is damaged (checksum mismatch).");
      return out;
    }
    return Promise.resolve({
      names: entries.map(e => e.name),
      read,
      readText: name => read(name).then(x => (x === null ? null : new TextDecoder("utf-8").decode(x)))
    });
  }

  return { LIMITS, ZipError, crc32, writeZip, writeZipAsync, listEntries, openZipAsync };
});
