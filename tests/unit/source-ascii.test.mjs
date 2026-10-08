// Source files stay ASCII so they load the same under any file encoding (P0-08).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { root } from "./helpers.mjs";

const DIRS = ["webui/js", "tools", "tests"];
const EXT = new Set([".js", ".mjs", ".cjs"]);

function walk(dir) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap(d => {
    const rel = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === "node_modules" ? [] : walk(rel);
    return EXT.has(path.extname(d.name)) ? [rel] : [];
  });
}

test("JavaScript sources contain only ASCII characters", () => {
  const offenders = [];
  DIRS.flatMap(walk).forEach(file => {
    const lines = fs.readFileSync(path.join(root, file), "utf8").split("\n");
    lines.forEach((line, i) => {
      // eslint-disable-next-line no-control-regex
      if (/[^\x00-\x7f]/.test(line)) offenders.push(file + ":" + (i + 1));
    });
  });
  assert.deepEqual(offenders, [], "use \\u escapes instead of literal characters");
});
