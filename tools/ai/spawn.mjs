/*
 * Finding and running the AI command-line tools without a shell, on Windows,
 * macOS and Linux. Arguments are passed as a list, never through a shell, so
 * file names and prompts cannot be read as commands.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const IS_WIN = process.platform === "win32";

/*
 * An npm shim on Windows (claude.cmd, codex.cmd) runs a JavaScript file with
 * node. Node refuses to start .cmd files without a shell, so read the shim
 * and run that JavaScript file directly.
 */
export function parseNpmShim(text, shimDir) {
  const m = String(text).match(/"%(?:~dp0|dp0)%\\?([^"%]+\.(?:c?js|mjs))"/i);
  if (!m) return null;
  return path.join(shimDir, m[1]);
}

function candidates(name) {
  const dirs = String(process.env.PATH || process.env.Path || "").split(path.delimiter).filter(Boolean);
  const exts = IS_WIN ? [".exe", ".cmd", ".bat", ""] : [""];
  const out = [];
  dirs.forEach(d => exts.forEach(ext => out.push(path.join(d, name + ext))));
  return out;
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch (_) { return false; }
}

/**
 * Finds a CLI. An override path (for tests, or a tool installed outside PATH)
 * wins. Returns { command, prefix: [args before the tool's own], path } or null.
 */
export function resolveBin(name, override) {
  const run = file => {
    if (/\.(c?js|mjs)$/i.test(file)) return { command: process.execPath, prefix: [file], path: file };
    if (IS_WIN && /\.(cmd|bat)$/i.test(file)) {
      const script = parseNpmShim(fs.readFileSync(file, "utf8"), path.dirname(file));
      return script && isFile(script) ? { command: process.execPath, prefix: [script], path: file } : null;
    }
    return { command: file, prefix: [], path: file };
  };
  if (override) return isFile(override) ? run(override) : null;
  for (const file of candidates(name)) {
    if (!isFile(file)) continue;
    if (IS_WIN && path.extname(file) === "" ) continue;
    const r = run(file);
    if (r) return r;
  }
  return null;
}

/*
 * Stops a process and everything it started. On Windows, taskkill walks the
 * process tree but can take several seconds on machines with endpoint
 * software, so the direct child is also stopped after a short wait.
 */
export function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (IS_WIN) {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, detached: true }).unref();
    } catch (_) { /* fall back to the direct child below */ }
    const timer = setTimeout(() => { if (child.exitCode === null) { try { child.kill(); } catch (_) { /* gone */ } } }, 1500);
    timer.unref();
  } else {
    try { process.kill(-child.pid, "SIGTERM"); } catch (_) { try { child.kill("SIGTERM"); } catch (__) { /* gone */ } }
    const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch (_) { /* gone */ } }, 3000);
    timer.unref();
  }
}

/**
 * Runs a resolved CLI. options: { args, cwd, env, input, timeoutMs, onLine, signal, maxBytes }.
 * Resolves { code, stdout, stderr, timedOut, cancelled, error }.
 */
export function runProcess(bin, options) {
  const o = options || {};
  const maxBytes = o.maxBytes || 32 * 1024 * 1024;
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(bin.command, bin.prefix.concat(o.args || []), {
        cwd: o.cwd, env: o.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: !IS_WIN
      });
    } catch (err) {
      resolve({ code: null, stdout: "", stderr: "", timedOut: false, cancelled: false, error: err });
      return;
    }
    let stdout = "", stderr = "", pending = "", timedOut = false, cancelled = false, settled = false;
    const finish = (code, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (o.signal) o.signal.removeEventListener("abort", onAbort);
      if (pending && o.onLine) o.onLine(pending);
      resolve({ code, stdout, stderr, timedOut, cancelled, error: error || null });
    };
    const onAbort = () => { cancelled = true; killTree(child); };
    const timer = o.timeoutMs ? setTimeout(() => { timedOut = true; killTree(child); }, o.timeoutMs) : null;
    if (o.signal) {
      if (o.signal.aborted) onAbort();
      else o.signal.addEventListener("abort", onAbort);
    }
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      if (stdout.length < maxBytes) stdout += chunk;
      if (!o.onLine) return;
      pending += chunk;
      let i;
      while ((i = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, i).replace(/\r$/, "");
        pending = pending.slice(i + 1);
        if (line.trim()) o.onLine(line);
      }
    });
    child.stderr.on("data", chunk => { if (stderr.length < 1024 * 1024) stderr += chunk; });
    child.on("error", err => finish(null, err));
    child.on("close", code => finish(code));
    // A grandchild can hold the output pipes open after the tool exits; do not wait on it for long.
    child.on("exit", code => { setTimeout(() => finish(code), timedOut || cancelled ? 200 : 2000).unref(); });
    child.stdin.on("error", () => { /* the tool exited before reading its input */ });
    child.stdin.end(o.input || "");
    if (o.onSpawn) o.onSpawn(child);
  });
}
