/*
 * Development helpers for driving the app in a real browser: launch the
 * installed Chrome or Edge through playwright-core, and serve webui/ over
 * HTTP for the hosted deployment mode.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const webui = path.join(root, "webui");

const TYPES = {
  ".htm": "text/html; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".woff2": "font/woff2", ".svg": "image/svg+xml",
  ".png": "image/png", ".txt": "text/plain; charset=utf-8"
};

/** Launches Chrome, then Edge. Returns null when neither is installed. */
export async function launch(options) {
  let chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch (_) {
    return null;
  }
  for (const channel of ["chrome", "msedge"]) {
    try {
      return await chromium.launch(Object.assign({ channel, headless: true, args: ["--disable-gpu"] }, options || {}));
    } catch (_) { /* try the next browser */ }
  }
  return null;
}

/** Resolves a URL path to a file inside webui/, or null. Malformed escapes and paths outside webui/ give null. */
export function resolveStatic(urlPath) {
  let clean;
  try {
    clean = decodeURIComponent(new URL(urlPath, "http://x").pathname);
  } catch (_) {
    return null;
  }
  if (clean.includes("\0")) return null;
  const file = path.normalize(path.join(webui, clean === "/" ? "index.htm" : clean));
  if (!file.startsWith(webui + path.sep)) return null;
  try {
    return fs.statSync(file).isFile() ? file : null;
  } catch (_) {
    return null;
  }
}

/**
 * Request handler for the files in webui/. options.headers adds response
 * headers; options.transformHtml(text) rewrites HTML pages before sending.
 */
export function staticHandler(options) {
  const o = options || {};
  return (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain" }); res.end("Method not allowed"); return;
    }
    const file = resolveStatic(req.url);
    if (!file) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Not found"); return; }
    const headers = Object.assign({
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"
    }, o.headers || {});
    if (o.transformHtml && /\.html?$/.test(file)) {
      const text = o.transformHtml(fs.readFileSync(file, "utf8"));
      res.writeHead(200, headers);
      res.end(req.method === "HEAD" ? undefined : text);
      return;
    }
    res.writeHead(200, headers);
    if (req.method === "HEAD") { res.end(); return; }
    fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
  };
}

/** Serves webui/ on 127.0.0.1. Resolves { url, port, server, close }. */
export function serve(port, handler) {
  const server = http.createServer(handler || staticHandler());
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port || 0, "127.0.0.1", () => {
      const { port: p } = server.address();
      resolve({ url: "http://127.0.0.1:" + p + "/index.htm", port: p, server, close: () => new Promise(r => { server.close(r); server.closeAllConnections(); }) });
    });
  });
}

export function fileUrl() {
  return pathToFileURL(path.join(webui, "index.htm")).href;
}

/** Records page errors, console errors, CSP reports and any non-local request. */
export function watch(page) {
  const problems = { errors: [], external: [] };
  page.on("pageerror", e => problems.errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") problems.errors.push("console: " + m.text()); });
  page.on("request", r => {
    const u = r.url();
    if (!/^(file:|data:|blob:|http:\/\/127\.0\.0\.1:)/.test(u)) problems.external.push(u);
  });
  return problems;
}
