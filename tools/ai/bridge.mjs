/*
 * The local AI helper behind the app's Draft with AI buttons, started with
 *   npm run serve -- --ai
 * It serves webui/ on 127.0.0.1 and adds /api/ai/*, which runs AI tasks with
 * the same runner as the command line.
 *
 * Only the page it served may use it: every request must name this host,
 * and API calls need a session token that the page gets by trading the
 * one-time code from the printed link. Browsers send that token in a custom
 * header, which a page on another site cannot do without a CORS preflight,
 * and the helper answers no preflight and sends no CORS headers. Business
 * outcomes (not signed in, blocked by the data-handling rules) come back as
 * 200 { ok: false } so the browser console stays clean.
 */
import crypto from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";
import { staticHandler } from "../lib/browser.mjs";
import { PROVIDERS, AiFailure } from "./providers.mjs";
import { runTask, gateFor, TASKS, cleanTaskOptions } from "./runner.mjs";
import { SOURCE_LIMITS } from "./extract-text.mjs";
import { root } from "./prompt.mjs";

const require = createRequire(import.meta.url);
const validate = require(path.join(root, "webui", "js", "lib", "validate.js"));
const schema = require(path.join(root, "webui", "js", "lib", "schema.js"));

export const JSON_LIMIT = 12 * 1024 * 1024;
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Resource-Policy": "same-origin", "Cache-Control": "no-store"
};

const token = () => crypto.randomBytes(24).toString("hex");

/* The page in helper mode may call its own origin, and says so to the app. */
export function helperHtml(text) {
  return text.replace("connect-src 'none'", "connect-src 'self'")
    .replace("<head>", "<head>\n<meta name=\"bpmviz-ai-helper\" content=\"1\">");
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, Object.assign({ "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text) }, SECURITY_HEADERS));
  res.end(text);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (declared > limit) { reject(new HttpError(413, "Too large.")); req.resume(); return; }
    // Past the limit the rest is read and dropped, so the reply can still be a 413.
    let chunks = [];
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > limit) chunks = null;
      else if (chunks) chunks.push(chunk);
    });
    req.on("end", () => { if (chunks) resolve(Buffer.concat(chunks)); else reject(new HttpError(413, "Too large.")); });
    req.on("error", reject);
  });
}

async function readJson(req) {
  if (!/^application\/json\b/i.test(req.headers["content-type"] || "")) throw new HttpError(415, "Expected application/json.");
  const buf = await readBody(req, JSON_LIMIT);
  try { return JSON.parse(buf.toString("utf8") || "{}"); } catch (_) { throw new HttpError(400, "Malformed JSON."); }
}

/**
 * Creates the helper. options: { port, log, runTask and status (for tests and screenshots), statusTtlMs }.
 * Returns { handler, launchUrl(), newCode(), jobs }.
 */
export function createBridge(options) {
  const o = options || {};
  const port = o.port;
  const log = o.log || (() => {});
  const run = o.runTask || runTask;
  const hosts = new Set(["127.0.0.1:" + port, "localhost:" + port]);
  const origins = new Set(["http://127.0.0.1:" + port, "http://localhost:" + port]);
  const statics = staticHandler({ transformHtml: helperHtml, headers: Object.assign({ "Content-Security-Policy": "frame-ancestors 'none'" }, SECURITY_HEADERS) });
  let code = token();
  const sessions = new Set();
  const jobs = new Map();
  let running = null;
  let statusCache = null;

  const launchUrl = () => "http://127.0.0.1:" + port + "/index.htm#ai=" + code;
  const newCode = () => { code = token(); return launchUrl(); };

  function checkRequest(req, api) {
    if (!hosts.has(String(req.headers.host || "").toLowerCase())) throw new HttpError(403, "Unknown host.");
    if (!api) return;
    const origin = req.headers.origin;
    if (origin !== undefined && !origins.has(origin)) throw new HttpError(403, "Cross-site request.");
    const site = req.headers["sec-fetch-site"];
    if (site !== undefined && site !== "same-origin") throw new HttpError(403, "Cross-site request.");
  }

  function requireSession(req) {
    const t = req.headers["x-bpmviz-token"];
    if (typeof t !== "string" || !sessions.has(t)) throw new HttpError(401, "No session. Open the link printed by npm run serve -- --ai.");
  }

  async function status() {
    if (o.status) return o.status();
    if (statusCache && Date.now() - statusCache.at < (o.statusTtlMs || 60000)) return statusCache.value;
    const value = [];
    for (const id of Object.keys(PROVIDERS)) {
      try { value.push(await PROVIDERS[id].status()); } catch (err) { value.push({ provider: id, installed: false, detail: err.message }); }
    }
    statusCache = { at: Date.now(), value };
    return value;
  }

  function jobView(job, since) {
    const from = Math.max(0, Math.min(Number(since) || 0, job.events.length));
    return { ok: true, id: job.id, state: job.state, events: job.events.slice(from), next: job.events.length,
      result: job.state === "done" ? job.result : null, failure: job.failure || null };
  }

  async function createJobRoute(body) {
    if (running) return { ok: false, code: "busy", message: "Another AI task is running. Wait for it to finish or cancel it." };
    const task = body.task;
    if (!TASKS.includes(task)) return { ok: false, code: "input.task", message: "Unknown task." };
    const provider = body.provider;
    if (!PROVIDERS[provider]) return { ok: false, code: "input.provider", message: "Unknown AI tool." };
    let engagement = null;
    if (task !== "extract") {
      const v = validate.validateEngagement(body.engagement);
      if (!v.ok) return { ok: false, code: "input.engagement", message: "The engagement did not pass validation.", errors: v.errors.slice(0, 10) };
      engagement = v.engagement;
    }
    const names = Array.isArray(body.sourceNames) ? body.sourceNames.slice(0, SOURCE_LIMITS.files + 1).map(n => String(n).slice(0, 260)) : [];
    if (names.length > SOURCE_LIMITS.files) return { ok: false, code: "input.source", message: "At most " + SOURCE_LIMITS.files + " sources per task." };
    if (task === "extract" && !names.length) return { ok: false, code: "input.missing", message: "Choose at least one document." };
    const taskOptions = cleanTaskOptions(task, body.taskOptions);
    if (task === "log-mapping" && !taskOptions.activities.length) return { ok: false, code: "input.missing", message: "There are no activity names to map." };
    const opts = {
      task, provider, engagement, plan: body.plan, approvalConfirmed: body.approvalConfirmed === true,
      trainingOptOutConfirmed: body.trainingOptOutConfirmed === true, writtenApproval: typeof body.writtenApproval === "string" ? body.writtenApproval.slice(0, 500) : "",
      includeSensitive: body.includeSensitive === true, baselineModelId: typeof body.baselineModelId === "string" ? body.baselineModelId : undefined,
      model: typeof body.model === "string" && /^[A-Za-z0-9._:\[\]-]{1,80}$/.test(body.model) ? body.model : undefined,
      confidentiality: schema.ENUMS.confidentiality.includes(body.confidentiality) ? body.confidentiality : undefined,
      dataStatus: ["supplied", "demonstration"].includes(body.dataStatus) ? body.dataStatus : undefined,
      processName: typeof body.processName === "string" ? body.processName.slice(0, 200) : "",
      clientDisplayName: typeof body.clientDisplayName === "string" ? body.clientDisplayName.slice(0, 200) : "",
      engagementName: typeof body.engagementName === "string" ? body.engagementName.slice(0, 200) : "",
      taskOptions, surface: "app"
    };
    // The gate runs here too, so a page that skips its own check still cannot send what the rules forbid.
    const st = (await status()).find(s => s.provider === provider);
    const g = gateFor(opts, st);
    if (!g.gate.allowed) return { ok: false, code: g.gate.blocked ? "gate.blocked" : "gate.missing", message: g.gate.message, gate: g.gate };
    const id = "job-" + crypto.randomBytes(6).toString("hex");
    const job = { id, opts, names, sources: new Array(names.length).fill(null), bytes: 0, state: "pending", events: [], result: null, failure: null, controller: null };
    jobs.set(id, job);
    return { ok: true, id, sourceCount: names.length };
  }

  async function putSource(req, job, index) {
    if (job.state !== "pending") throw new HttpError(409, "The task has started.");
    if (!/^application\/octet-stream\b/i.test(req.headers["content-type"] || "")) throw new HttpError(415, "Expected application/octet-stream.");
    if (!Number.isInteger(index) || index < 0 || index >= job.names.length) throw new HttpError(404, "No such source.");
    const room = Math.min(SOURCE_LIMITS.fileBytes, SOURCE_LIMITS.totalBytes - job.bytes + (job.sources[index] ? job.sources[index].length : 0));
    const buf = await readBody(req, room);
    job.bytes += buf.length - (job.sources[index] ? job.sources[index].length : 0);
    job.sources[index] = buf;
    return { ok: true, index, bytes: buf.length };
  }

  function startJob(job) {
    if (job.state !== "pending") return { ok: false, code: "state", message: "The task has already started." };
    if (running) return { ok: false, code: "busy", message: "Another AI task is running." };
    if (job.sources.some(s => s === null)) return { ok: false, code: "input.source", message: "Some documents were not uploaded." };
    job.state = "running";
    job.controller = new AbortController();
    running = job;
    const sources = job.names.map((name, i) => ({ name, buffer: job.sources[i] }));
    job.sources = [];
    log("AI task " + job.opts.task + " started with " + job.opts.provider + " (" + job.id + ").");
    run(Object.assign({}, job.opts, { jobId: job.id, sources, signal: job.controller.signal, onEvent: ev => { if (ev.type !== "job") job.events.push(ev); } }))
      .then(r => {
        if (r.ok) { job.state = "done"; job.result = r.result; }
        else { job.state = "failed"; job.failure = { code: "output.invalid", message: "The draft still has problems after " + r.rounds + " repair rounds.", errors: r.errors.slice(0, 20) }; }
      })
      .catch(err => {
        job.state = err instanceof AiFailure && err.code === "provider.cancelled" ? "cancelled" : "failed";
        job.failure = { code: err.code || "failed", message: err instanceof AiFailure ? err.message : "The task failed: " + err.message, gate: err.gate || null };
        if (!(err instanceof AiFailure)) log("AI task error: " + (err.stack || err.message));
      })
      .finally(() => { running = null; log("AI task " + job.id + " " + job.state + "."); });
    return { ok: true, state: "running" };
  }

  async function api(req, res, url) {
    const parts = url.pathname.split("/").filter(Boolean);
    const route = parts.slice(2);
    if (req.method === "OPTIONS") throw new HttpError(405, "Not allowed.");
    if (route[0] === "session" && route.length === 1 && req.method === "POST") {
      const body = await readJson(req);
      const given = Buffer.from(String(body.code || ""));
      const expected = Buffer.from(code);
      if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return send(res, 200, { ok: false, code: "session.code", message: "This link was already used or is out of date. Open the latest link from the terminal." });
      const t = token();
      sessions.add(t);
      log("A browser tab connected. For another tab, open: " + newCode());
      return send(res, 200, { ok: true, token: t });
    }
    requireSession(req);
    if (route[0] === "status" && route.length === 1 && req.method === "GET") {
      return send(res, 200, { ok: true, providers: await status(), limits: SOURCE_LIMITS, running: running ? running.id : null });
    }
    if (route[0] !== "jobs") throw new HttpError(404, "Not found.");
    if (route.length === 1 && req.method === "POST") return send(res, 200, await createJobRoute(await readJson(req)));
    const job = jobs.get(route[1]);
    if (!job) throw new HttpError(404, "No such task.");
    if (route.length === 2 && req.method === "GET") return send(res, 200, jobView(job, url.searchParams.get("since")));
    if (route.length === 2 && req.method === "DELETE") {
      if (job.state === "running") job.controller.abort();
      jobs.delete(job.id);
      return send(res, 200, { ok: true });
    }
    if (route.length === 4 && route[2] === "sources" && req.method === "PUT") return send(res, 200, await putSource(req, job, Number(route[3])));
    if (route.length === 3 && route[2] === "start" && req.method === "POST") { await readJson(req); return send(res, 200, startJob(job)); }
    if (route.length === 3 && route[2] === "cancel" && req.method === "POST") {
      await readJson(req);
      if (job.state === "running") job.controller.abort();
      else if (job.state === "pending") { job.state = "cancelled"; job.sources = []; }
      return send(res, 200, { ok: true, state: job.state });
    }
    throw new HttpError(req.method === "GET" || req.method === "POST" || req.method === "PUT" || req.method === "DELETE" ? 404 : 405, "Not found.");
  }

  async function handler(req, res) {
    let url;
    try {
      url = new URL(req.url, "http://127.0.0.1");
    } catch (_) {
      return send(res, 400, { ok: false, message: "Bad request." });
    }
    const isApi = url.pathname.startsWith("/api/");
    try {
      checkRequest(req, isApi);
      if (!isApi) return statics(req, res);
      if (!url.pathname.startsWith("/api/ai/")) throw new HttpError(404, "Not found.");
      await api(req, res, url);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) log("Helper error: " + (err.stack || err.message));
      if (!res.headersSent) send(res, status, { ok: false, message: err instanceof HttpError ? err.message : "Internal error." });
      else res.destroy();
    }
  }

  return { handler, launchUrl, newCode, jobs, sessions };
}
