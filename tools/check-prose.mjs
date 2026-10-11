#!/usr/bin/env node
/*
 * Prose gate for client-visible text: fails on em dashes and flags filler
 * words in the README, docs, prompts, agent skills, UI copy and bundled examples.
 *   node tools/check-prose.mjs
 * The audit copies in docs/audit/ and the archived prototypes are not checked.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const claudeSkills = path.join(root, ".claude", "skills");
const aixraySkills = fs.existsSync(claudeSkills) ? fs.readdirSync(claudeSkills).filter(n => n.startsWith("aixray-")).map(n => ".claude/skills/" + n) : [];
const TARGETS = ["README.md", "AGENTS.md", "CLAUDE.md", "docs", "tools/prompts", "archive/README.md", "webui", ".agents/skills"].concat(aixraySkills);
const SKIP = new Set(["audit", "node_modules", "fonts", "screenshots"]);
const EXT = new Set([".md", ".js", ".css", ".htm", ".html", ".json", ".txt"]);
const DASH = /[\u2014\u2015]/;
const BUZZ = /\b(delve|leverag(e|es|ed|ing)|robust|seamless(ly)?|tapestry|realm|unlock(s|ed|ing)?|elevate[sd]?|supercharg\w*|game[- ]changer|cutting[- ]edge|revolutionary|transformative|synerg\w*|holistic|paradigm)\b/i;

function walk(p) {
  const full = path.join(root, p);
  if (!fs.existsSync(full)) return [];
  const stat = fs.statSync(full);
  if (stat.isFile()) return EXT.has(path.extname(full)) ? [full] : [];
  return fs.readdirSync(full).flatMap(name => SKIP.has(name) ? [] : walk(path.join(p, name)));
}

const problems = [];
TARGETS.flatMap(walk).forEach(file => {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    const where = path.relative(root, file) + ":" + (i + 1);
    if (DASH.test(line)) problems.push({ where, what: "em dash", text: line.trim().slice(0, 120) });
    const m = line.match(BUZZ);
    if (m) problems.push({ where, what: "filler word \"" + m[0] + "\"", text: line.trim().slice(0, 120) });
  });
});

if (problems.length) {
  problems.forEach(p => console.log(p.where + "  " + p.what + "\n    " + p.text));
  console.log("\n" + problems.length + " prose problem" + (problems.length === 1 ? "" : "s") + " found.");
  process.exit(1);
}
console.log("Prose check passed: no em dashes or filler words in client-visible text.");
