/*
 * The job folder an AI tool works in: a fresh temporary folder holding the
 * sources (under names AIxRay chooses), the prompt files and an out/ folder
 * for results. It is removed when the job ends unless --keep is given.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SOURCE_LIMITS, extractSource } from "./extract-text.mjs";

export function newJobId() {
  return "job-" + crypto.randomBytes(6).toString("hex");
}

export function createJob(id) {
  const jobId = id || newJobId();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aixray-ai-"));
  const sourcesDir = path.join(dir, "sources");
  const outDir = path.join(dir, "out");
  fs.mkdirSync(sourcesDir);
  fs.mkdirSync(outDir);
  let bytes = 0;
  const sources = [];
  const job = {
    id: jobId, dir, sourcesDir, outDir, sources,
    file: name => path.join(dir, name),
    write(name, content) { fs.writeFileSync(path.join(dir, name), content); return path.join(dir, name); },
    cleanup() { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* already gone */ } },

    /**
     * Adds a source from a Buffer. The file is stored as sources/NN-<safe name>
     * and its text (when it has any) as sources/NN-<safe name>.txt.
     */
    async addSource(displayName, buffer) {
      if (sources.length >= SOURCE_LIMITS.files) throw new Error("At most " + SOURCE_LIMITS.files + " sources per job.");
      if (buffer.length > SOURCE_LIMITS.fileBytes) throw new Error(displayName + " is larger than " + (SOURCE_LIMITS.fileBytes / 1048576) + " MB.");
      if (bytes + buffer.length > SOURCE_LIMITS.totalBytes) throw new Error("The sources together are larger than " + (SOURCE_LIMITS.totalBytes / 1048576) + " MB.");
      bytes += buffer.length;
      const n = String(sources.length + 1).padStart(2, "0");
      const base = String(displayName).split(/[\\/]/).pop();
      const safe = n + "-" + (base.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+/, "").slice(0, 80) || "source");
      const extracted = await extractSource(buffer, base);
      const stored = extracted.kind === "image" && !/\.(png|jpe?g|gif|webp)$/i.test(safe) ? safe + extracted.ext : safe;
      fs.writeFileSync(path.join(sourcesDir, stored), buffer);
      let textFile = null;
      if (extracted.text !== null) {
        textFile = stored + ".txt";
        fs.writeFileSync(path.join(sourcesDir, textFile), extracted.text);
      }
      const info = {
        name: base.slice(0, 260), kind: extracted.kind, sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
        pages: Number.isInteger(extracted.pages) ? extracted.pages : null,
        file: "sources/" + stored, textFile: textFile ? "sources/" + textFile : null,
        text: extracted.text, mime: extracted.mime || null, warning: extracted.warning || "", bytes: buffer.length
      };
      sources.push(info);
      return info;
    }
  };
  return job;
}
