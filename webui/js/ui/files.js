/*
 * BPMVIZ files: reading and writing local files in the browser. Bytes,
 * text decoding, raw deflate through the Compression Streams API (passed to
 * lib/zip.js and lib/xlsx.js as inflateRaw / deflateRaw), SHA-256 and
 * downloads. Nothing here uses the network.
 */
(function (root) {
  "use strict";
  const B = root.BPMVIZ = root.BPMVIZ || {};

  class FileLimitError extends Error {}

  function mb(bytes) {
    return Math.round(bytes / 1048576) + " MB";
  }

  /** Reads a File or Blob as a Uint8Array, refusing files larger than max bytes. */
  function readBytes(file, max) {
    if (max && file.size > max) return Promise.reject(new FileLimitError("The file is larger than the " + mb(max) + " limit."));
    if (typeof file.arrayBuffer === "function") return file.arrayBuffer().then(buf => new Uint8Array(buf));
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result));
      reader.onerror = () => reject(reader.error || new Error("The file could not be read."));
      reader.readAsArrayBuffer(file);
    });
  }

  /* Pipes bytes through a transform stream, stopping once the output passes maxOutput bytes. */
  async function pipe(stream, bytes, maxOutput) {
    const writer = stream.writable.getWriter();
    const writing = writer.write(bytes).then(() => writer.close()).catch(() => {});
    const reader = stream.readable.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (maxOutput && total > maxOutput) {
        await reader.cancel().catch(() => {});
        throw new FileLimitError("A compressed part expands past " + mb(maxOutput) + ".");
      }
      chunks.push(value);
    }
    await writing;
    const out = new Uint8Array(total);
    let at = 0;
    chunks.forEach(c => { out.set(c, at); at += c.length; });
    return out;
  }

  function streamsAvailable() {
    return typeof root.DecompressionStream === "function" && typeof root.CompressionStream === "function";
  }

  /** Raw DEFLATE decompression (ZIP method 8). maxOutput caps the result size. */
  function inflateRaw(bytes, maxOutput) {
    if (!streamsAvailable()) return Promise.reject(new Error("This browser cannot read compressed files. Use a current Chrome, Edge, Firefox or Safari."));
    return pipe(new root.DecompressionStream("deflate-raw"), bytes, maxOutput);
  }

  /** Raw DEFLATE compression. */
  function deflateRaw(bytes) {
    if (!streamsAvailable()) return Promise.reject(new Error("This browser cannot write compressed files."));
    return pipe(new root.CompressionStream("deflate-raw"), bytes, 0);
  }

  /*
   * Text from bytes: a UTF-8 or UTF-16 byte order mark is honoured; otherwise
   * strict UTF-8 is tried first and Windows-1252 is the fallback, which is
   * what spreadsheet programs on Windows write for CSV.
   */
  function textOf(bytes) {
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

  /* ---------- SHA-256 ---------- */

  function hex(buf) {
    return Array.from(new Uint8Array(buf), x => x.toString(16).padStart(2, "0")).join("");
  }

  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  /* Plain JavaScript SHA-256, used where SubtleCrypto is not available. */
  function sha256Js(bytes) {
    const len = bytes.length;
    const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
    padded.set(bytes);
    padded[len] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor(len / 0x20000000));
    view.setUint32(padded.length - 4, (len << 3) >>> 0);
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const W = new Uint32Array(64);
    const rot = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < padded.length; off += 64) {
      for (let i = 0; i < 16; i++) W[i] = view.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rot(W[i - 15], 7) ^ rot(W[i - 15], 18) ^ (W[i - 15] >>> 3);
        const s1 = rot(W[i - 2], 17) ^ rot(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
        const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    const out = new DataView(new ArrayBuffer(32));
    H.forEach((v, i) => out.setUint32(i * 4, v));
    return hex(out.buffer);
  }

  /** Lowercase hex SHA-256 of bytes or a string (UTF-8). */
  function sha256Hex(data) {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
    const subtle = root.crypto && root.crypto.subtle;
    if (subtle && typeof subtle.digest === "function") {
      return subtle.digest("SHA-256", bytes).then(hex, () => sha256Js(bytes));
    }
    return Promise.resolve(sha256Js(bytes));
  }

  /* ---------- Saving and choosing files ---------- */

  /** Downloads bytes (or a string) as a file. */
  function downloadBytes(bytes, fileName, type) {
    B.dom.downloadBlob(new Blob([bytes], { type: type || "application/octet-stream" }), fileName);
  }

  /** Asks for one file. Resolves the File, or null when the person cancels. */
  function pickFile(accept) {
    return new Promise(resolve => {
      const input = document.createElement("input");
      input.type = "file";
      if (accept) input.accept = accept;
      input.hidden = true;
      let settled = false;
      const finish = file => {
        if (settled) return;
        settled = true;
        input.remove();
        resolve(file || null);
      };
      input.addEventListener("change", () => finish(input.files && input.files[0]));
      input.addEventListener("cancel", () => finish(null));
      document.body.appendChild(input);
      input.click();
    });
  }

  B.files = { readBytes, inflateRaw, deflateRaw, textOf, sha256Hex, sha256Js, downloadBytes, pickFile, FileLimitError };
})(typeof globalThis !== "undefined" ? globalThis : this);
