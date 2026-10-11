#!/usr/bin/env node
/*
 * Runs the Sogeti design-system anti-style gate over the app, when the
 * sogeti-design skill is installed in .claude/skills. Otherwise it says it
 * skipped, so the check never blocks a machine without the skill.
 *   node tools/check-style.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gate = path.join(root, ".claude", "skills", "sogeti-design", "scripts", "check-ui-anti-style.mjs");
if (!fs.existsSync(gate)) {
  console.log("Style gate skipped: the sogeti-design skill is not installed in .claude/skills.");
  process.exit(0);
}
const run = spawnSync(process.execPath, [gate, path.join(root, "webui")], { stdio: "inherit" });
process.exit(run.status === null ? 1 : run.status);
