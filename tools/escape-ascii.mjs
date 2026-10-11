#!/usr/bin/env node
/*
 * Rewrites non-ASCII characters in JavaScript sources as \uXXXX escapes, so
 * the sources stay ASCII (tests/unit/source-ascii.test.mjs checks this).
 * Only .js, .mjs and .cjs files under webui/js, tools and tests are touched;
 * Markdown, JSON and CSS files are never changed.
 *   node tools/escape-ascii.mjs          rewrite the files
 *   node tools/escape-ascii.mjs --check  list the files, change nothing
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = ["webui/js", "tools", "tests"];
const EXT = new Set([".js", ".mjs", ".cjs"]);
const SKIP = new Set(["node_modules", ".git"]);
const check = process.argv.includes("--check");

function walk(dir) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap(d => {
    const rel = path.join(dir, d.name);
    if (d.isDirectory()) return SKIP.has(d.name) ? [] : walk(rel);
    return EXT.has(path.extname(d.name)) ? [rel] : [];
  });
}

/* Each UTF-16 code unit above 0x7f becomes \uXXXX; astral characters become a surrogate pair. */
export function escapeText(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out += code > 0x7f ? "\\u" + code.toString(16).padStart(4, "0") : text[i];
  }
  return out;
}

const changed = [];
DIRS.flatMap(walk).forEach(file => {
  const full = path.join(root, file);
  const text = fs.readFileSync(full, "utf8");
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7f]/.test(text)) return;
  changed.push(file);
  if (!check) fs.writeFileSync(full, escapeText(text.replace(/^\ufeff/, "")));
});

if (!changed.length) console.log("All JavaScript sources are ASCII.");
else console.log((check ? "Non-ASCII characters in " : "Escaped non-ASCII characters in ") + changed.length + " file" + (changed.length === 1 ? "" : "s") + ":\n  " + changed.join("\n  "));
if (check && changed.length) process.exit(1);
