/*
 * The two AI command-line tools AIxRay can drive: Claude Code (claude) and
 * Codex (codex). Each runs on the person's own sign-in, so a Claude or
 * ChatGPT subscription is used instead of an API key. AIxRay never sees or
 * stores a credential; it starts the installed tool with the least access
 * the task needs and reads what it prints.
 */
import path from "node:path";
import { resolveBin, runProcess } from "./spawn.mjs";

/* API keys override a subscription sign-in, so they are removed unless asked for. */
const API_KEYS = /^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|OPENAI_API_KEY|CODEX_API_KEY)$/;
/* Variables a parent Claude Code session sets for its own children; the job is not one of them. */
const KEEP_CLAUDE = /^(CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CONFIG_DIR|CLAUDE_CODE_USE_(BEDROCK|VERTEX|FOUNDRY)|CLAUDE_CODE_GIT_BASH_PATH)$/;

export function childEnv(base, options) {
  const o = options || {};
  const env = {};
  Object.keys(base).forEach(k => {
    if (!o.useApiKey && API_KEYS.test(k)) return;
    if (/^CLAUDE/.test(k) && !KEEP_CLAUDE.test(k)) return;
    env[k] = base[k];
  });
  return env;
}

export class AiFailure extends Error {
  constructor(code, message, detail) { super(message); this.code = code; this.detail = detail || ""; }
}

const FAILURES = [
  [/unknown feature flag|unknown configuration field|unknown variant|error loading config/i, "provider.config"],
  [/usage limit|limit reached|rate.?limit|quota|too many requests|\b429\b/i, "provider.usageLimit"],
  [/not (logged|signed) in|please run \/login|\/login|log ?in again|invalid api key|authentication|unauthori[sz]ed|\b401\b|expired token|oauth/i, "auth.signedOut"],
  [/overloaded|\b529\b|\b503\b|service unavailable/i, "provider.overloaded"]
];

export function classifyFailure(text) {
  const t = String(text || "");
  const hit = FAILURES.find(([re]) => re.test(t));
  return hit ? hit[1] : "provider.failed";
}

const PROVIDER_NAMES = { claude: "Claude Code", codex: "Codex" };

export function failureMessage(provider, code, detail) {
  const name = PROVIDER_NAMES[provider] || provider;
  const d = detail ? " (" + String(detail).trim().slice(0, 300) + ")" : "";
  switch (code) {
    case "provider.notInstalled": return provider === "claude" ?
      "Claude Code is not installed or not on PATH. Install it (see docs/ai.md), run claude once and sign in with your Claude account." :
      "Codex is not installed or not on PATH. Install it with npm install -g @openai/codex, then run codex login and sign in with ChatGPT.";
    case "auth.signedOut": return provider === "claude" ?
      "Claude Code is not signed in. Run claude, type /login and sign in with your Claude account." + d :
      "Codex is not signed in. Run codex login and choose Sign in with ChatGPT." + d;
    case "auth.apiKey": return name + " is signed in with an API key, which is billed separately from your subscription. Sign in with your Claude or ChatGPT account instead, or pass --use-api-key to use the key.";
    case "provider.usageLimit": return "Your " + (provider === "claude" ? "Claude" : "ChatGPT") + " usage limit is reached. Try again after it resets." + d;
    case "provider.overloaded": return name + " is busy right now. Try again in a few minutes." + d;
    case "provider.unexpectedTools": return name + " started with tools AIxRay did not ask for, so the run was stopped" + d + ".";
    case "provider.timeout": return name + " did not finish within the time limit. Try again.";
    case "provider.config": return "This " + name + " version does not accept one of the settings AIxRay uses to turn off its shell, web and app tools, so AIxRay stopped it before anything was sent" + d + ". Update AIxRay, or use a " + name + " version listed in docs/ai.md.";
    case "provider.cancelled": return "The run was cancelled.";
    default: return name + " stopped with an error" + d + ". Try again.";
  }
}

/* ---------- Claude Code ---------- */

function claudePlan(status) {
  if (status.apiProvider && status.apiProvider !== "firstParty") return { plan: "commercial", label: "cloud provider account (" + status.apiProvider + ")" };
  if (status.authMethod && status.authMethod !== "claude.ai") return { plan: "commercial", label: "API key", apiKey: true };
  const t = String(status.subscriptionType || "").toLowerCase();
  if (t === "team" || t === "enterprise") return { plan: "commercial", label: "Claude " + t[0].toUpperCase() + t.slice(1) };
  if (t === "pro" || t === "max" || t === "free") return { plan: "consumer", label: "Claude " + t[0].toUpperCase() + t.slice(1) };
  return { plan: "unknown", label: t ? "Claude (" + t + ")" : "Claude" };
}

const claude = {
  id: "claude",
  name: "Claude Code",
  bin: () => resolveBin("claude", process.env.AIXRAY_CLAUDE_BIN),

  async status(options) {
    const bin = this.bin();
    if (!bin) return { provider: "claude", installed: false };
    const env = childEnv(process.env, options);
    const v = await runProcess(bin, { args: ["--version"], env, timeoutMs: 30000 });
    if (v.error || v.code !== 0) return { provider: "claude", installed: false, detail: String(v.stderr || (v.error && v.error.message) || "").slice(0, 300) };
    const version = (v.stdout.match(/\d+\.\d+\.\d+/) || [""])[0];
    const a = await runProcess(bin, { args: ["auth", "status"], env, timeoutMs: 30000 });
    let s = {};
    try { s = JSON.parse(a.stdout); } catch (_) { s = { loggedIn: a.code === 0 && !/not logged in/i.test(a.stdout + a.stderr) }; }
    const plan = claudePlan(s);
    return {
      provider: "claude", installed: true, version, path: bin.path, loggedIn: s.loggedIn === true,
      authMethod: s.authMethod || "", apiKey: !!plan.apiKey, plan: plan.plan, planLabel: plan.label,
      org: s.orgName || "", planDetected: plan.plan !== "unknown"
    };
  },

  /*
   * One unattended run in the job folder. --restricted drops the tools that
   * run code and ignores user and project settings, --safe-mode turns off
   * hooks, CLAUDE.md files, skills, plugins and MCP servers, and --tools lists
   * the only built-in tools the task may use. File writes are allowed in out/
   * only; anything else is refused without a prompt (dontAsk).
   */
  args(job, spec) {
    const args = ["-p", "--output-format", "stream-json", "--verbose",
      "--permission-mode", "dontAsk", "--permission-prompts", "none",
      "--no-session-persistence", "--disable-slash-commands",
      "--restricted", "--safe-mode", "--strict-mcp-config",
      "--settings", job.file("claude-settings.json"),
      "--append-system-prompt-file", job.file("system.md")];
    if (spec.fileTools) {
      args.push("--tools", "Read,Glob,Grep,Write,Edit", "--allowedTools", "Read", "Glob", "Grep", "Write(./out/**)", "Edit(./out/**)");
    } else {
      args.push("--tools", "");
    }
    args.push("--json-schema", JSON.stringify(spec.schema));
    if (spec.model) args.push("--model", spec.model);
    // The smoke test asks for hook events so it can prove that none ran.
    if (spec.includeHookEvents) args.push("--include-hook-events");
    return args;
  },

  settings() {
    return {
      disableAllHooks: true,
      autoMemoryEnabled: false,
      permissions: { deny: ["Bash", "PowerShell", "WebFetch", "WebSearch", "Task", "Agent", "NotebookEdit", "mcp__*"] }
    };
  },

  allowedTools(spec) {
    return spec.fileTools ? ["Read", "Glob", "Grep", "Write", "Edit", "StructuredOutput"] : ["StructuredOutput"];
  },

  /**
   * Runs one session. Resolves { output, result, denials, model, usage }.
   * Throws AiFailure.
   */
  async run(job, spec, hooks) {
    const bin = this.bin();
    if (!bin) throw new AiFailure("provider.notInstalled", failureMessage("claude", "provider.notInstalled"));
    job.write("claude-settings.json", JSON.stringify(this.settings(), null, 2));
    const allowed = new Set(this.allowedTools(spec));
    const state = { result: null, denials: [], model: "", unexpected: "", child: null };
    const onLine = line => {
      let ev;
      try { ev = JSON.parse(line); } catch (_) { return; }
      if (ev.type === "system" && ev.subtype === "init") {
        state.model = ev.model || "";
        const extra = (ev.tools || []).filter(t => !allowed.has(t));
        const mcp = (ev.mcp_servers || []).map(m => m.name || String(m));
        if (extra.length || mcp.length) {
          state.unexpected = [extra.length ? "tools: " + extra.join(", ") : "", mcp.length ? "MCP servers: " + mcp.join(", ") : ""].filter(Boolean).join("; ");
          if (hooks.abort) hooks.abort();
        }
        if (hooks.onEvent) hooks.onEvent({ type: "started", model: state.model });
      } else if (ev.type === "assistant" && ev.message && Array.isArray(ev.message.content)) {
        ev.message.content.forEach(c => {
          if (c.type === "tool_use" && c.name !== "StructuredOutput" && hooks.onEvent) {
            const target = c.input && (c.input.file_path || c.input.pattern || c.input.path);
            hooks.onEvent({ type: "tool", tool: c.name, target: target ? path.basename(String(target)) : "" });
          }
        });
      } else if (ev.type === "system" && /hook/i.test(ev.subtype || "")) {
        if (hooks.onEvent) hooks.onEvent({ type: "hook", name: ev.hook_name || ev.hook_event || ev.subtype });
      } else if (ev.type === "result") {
        state.result = ev;
      }
    };
    const r = await runProcess(bin, {
      args: this.args(job, spec), cwd: job.dir, env: childEnv(process.env, spec), input: spec.prompt,
      timeoutMs: spec.timeoutMs, signal: hooks.signal, onLine
    });
    if (state.unexpected) throw new AiFailure("provider.unexpectedTools", failureMessage("claude", "provider.unexpectedTools", state.unexpected));
    if (r.cancelled) throw new AiFailure("provider.cancelled", failureMessage("claude", "provider.cancelled"));
    if (r.timedOut) throw new AiFailure("provider.timeout", failureMessage("claude", "provider.timeout"));
    if (r.error) throw new AiFailure(r.error.code === "ENOENT" ? "provider.notInstalled" : "provider.failed", failureMessage("claude", r.error.code === "ENOENT" ? "provider.notInstalled" : "provider.failed", r.error.message));
    const res = state.result;
    if (!res || res.is_error || res.subtype !== "success") {
      const detail = (res && (res.result || res.subtype)) || r.stderr || "exit code " + r.code;
      const code = classifyFailure(detail + " " + (res && res.api_error_status || ""));
      throw new AiFailure(code, failureMessage("claude", code, detail), detail);
    }
    let output = res.structured_output;
    if (output === undefined || output === null) {
      try { output = JSON.parse(res.result); } catch (_) { output = null; }
    }
    return {
      output, denials: (res.permission_denials || []).map(d => d.tool_name + (d.tool_input && d.tool_input.file_path ? " " + path.basename(String(d.tool_input.file_path)) : "")),
      model: state.model, usage: { turns: res.num_turns, durationMs: res.duration_ms }
    };
  }
};

/* ---------- Codex ---------- */

/* Codex features that would let the model act beyond reading the prompt. */
export const CODEX_DISABLED_FEATURES = ["shell_tool", "unified_exec", "apps", "browser_use", "computer_use", "in_app_browser",
  "multi_agent", "hooks", "plugins", "image_generation", "memories", "view_image", "skill_search", "tool_suggest"];

const codex = {
  id: "codex",
  name: "Codex",
  bin: () => resolveBin("codex", process.env.AIXRAY_CODEX_BIN),

  async status(options) {
    const bin = this.bin();
    if (!bin) return { provider: "codex", installed: false };
    const env = childEnv(process.env, options);
    const v = await runProcess(bin, { args: ["--version"], env, timeoutMs: 30000 });
    if (v.error || v.code !== 0) return { provider: "codex", installed: false, detail: String(v.stderr || (v.error && v.error.message) || "").slice(0, 300) };
    const version = (v.stdout.match(/\d+\.\d+\.\d+/) || [""])[0];
    const a = await runProcess(bin, { args: ["login", "status"], env, timeoutMs: 30000 });
    const text = a.stdout + "\n" + a.stderr;
    const loggedIn = a.code === 0 && /logged in/i.test(text) && !/not logged in/i.test(text);
    const apiKey = /api key/i.test(text);
    // Codex does not report the ChatGPT plan, so the person declares it.
    return {
      provider: "codex", installed: true, version, path: bin.path, loggedIn, authMethod: apiKey ? "api-key" : loggedIn ? "chatgpt" : "",
      apiKey, plan: apiKey ? "commercial" : "unknown", planLabel: apiKey ? "API key" : "ChatGPT (plan not reported)", org: "", planDetected: apiKey
    };
  },

  /*
   * codex exec in a read-only sandbox with no session saved. The person's
   * config.toml (MCP servers, notify hooks, profiles) and rules files are not
   * loaded, every tool that could run commands, browse, call apps or other
   * agents is turned off, and --strict-config makes Codex stop instead of
   * running if a later version no longer knows one of these settings. All text
   * is in the prompt; images go in with -i. Checked against Codex 0.160.
   */
  args(job, spec) {
    const args = ["exec", "-", "--sandbox", "read-only", "--ephemeral", "--skip-git-repo-check",
      "--ignore-user-config", "--ignore-rules", "--strict-config",
      "-C", job.dir, "-o", path.join(job.outDir, "last-message.txt"), "--json",
      "-c", "approval_policy=\"never\"", "-c", "web_search=\"disabled\""];
    CODEX_DISABLED_FEATURES.forEach(f => args.push("--disable", f));
    if (spec.schema) {
      job.write("output-schema.json", JSON.stringify(spec.schema));
      args.push("--output-schema", job.file("output-schema.json"));
    }
    (spec.images || []).forEach(img => args.push("-i", img));
    if (spec.model) args.push("-m", spec.model);
    return args;
  },

  async run(job, spec, hooks) {
    const bin = this.bin();
    if (!bin) throw new AiFailure("provider.notInstalled", failureMessage("codex", "provider.notInstalled"));
    const state = { failed: "", unexpected: "", model: "" };
    const onLine = line => {
      let ev;
      try { ev = JSON.parse(line); } catch (_) { return; }
      const item = ev.item || {};
      if (ev.type === "thread.started" && hooks.onEvent) hooks.onEvent({ type: "started", model: spec.model || "" });
      if ((ev.type === "item.started" || ev.type === "item.completed") && /command_execution|mcp_tool_call|web_search|file_change|collab_tool_call|computer_use|browser/.test(item.type || "")) {
        state.unexpected = item.type + (item.command ? ": " + String(item.command).slice(0, 80) : "");
        if (hooks.abort) hooks.abort();
      }
      if (ev.type === "turn.failed") state.failed = (ev.error && ev.error.message) || "turn failed";
      if (ev.type === "error") state.failed = ev.message || "error";
    };
    const r = await runProcess(bin, {
      args: this.args(job, spec), cwd: job.dir, env: childEnv(process.env, spec), input: spec.prompt,
      timeoutMs: spec.timeoutMs, signal: hooks.signal, onLine
    });
    if (state.unexpected) throw new AiFailure("provider.unexpectedTools", failureMessage("codex", "provider.unexpectedTools", state.unexpected));
    if (r.cancelled) throw new AiFailure("provider.cancelled", failureMessage("codex", "provider.cancelled"));
    if (r.timedOut) throw new AiFailure("provider.timeout", failureMessage("codex", "provider.timeout"));
    if (r.error) throw new AiFailure(r.error.code === "ENOENT" ? "provider.notInstalled" : "provider.failed", failureMessage("codex", r.error.code === "ENOENT" ? "provider.notInstalled" : "provider.failed", r.error.message));
    if (state.failed || r.code !== 0) {
      const detail = state.failed || r.stderr || "exit code " + r.code;
      const code = classifyFailure(detail);
      throw new AiFailure(code, failureMessage("codex", code, detail), detail);
    }
    let text = "";
    try { text = (await import("node:fs")).readFileSync(path.join(job.outDir, "last-message.txt"), "utf8"); } catch (_) { text = ""; }
    return { output: parseJsonMessage(text), denials: [], model: spec.model || "", usage: {} };
  }
};

/** Reads a JSON object from a final message, with or without a code fence. */
export function parseJsonMessage(text) {
  const t = String(text || "").trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : t;
  try { return JSON.parse(body); } catch (_) { /* fall through */ }
  const start = body.indexOf("{"), end = body.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(body.slice(start, end + 1)); } catch (_) { /* not JSON */ }
  }
  return null;
}

export const PROVIDERS = { claude, codex };
