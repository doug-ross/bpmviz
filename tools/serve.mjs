#!/usr/bin/env node
/*
 * Serves webui/ on http://127.0.0.1 for the hosted deployment mode.
 *   node tools/serve.mjs [port]            the app only
 *   node tools/serve.mjs --ai [--port N]   the app with the local AI helper (docs/ai.md)
 * Opening webui/index.htm directly from disk works as well.
 */
import { serve } from "./lib/browser.mjs";

const args = process.argv.slice(2);
const ai = args.includes("--ai");
const portArg = args.includes("--port") ? args[args.indexOf("--port") + 1] : args.find(a => /^\d+$/.test(a));
const port = Number(portArg) || 8080;

try {
  if (ai) {
    const { createBridge } = await import("./ai/bridge.mjs");
    const bridge = createBridge({ port, log: text => console.log(text) });
    await serve(port, bridge.handler);
    console.log("BPMVIZ with the AI helper is running. Open this link (it works once):");
    console.log("  " + bridge.launchUrl());
    console.log("AI tasks run on your own Claude Code or Codex sign-in. Press Ctrl+C to stop.");
  } else {
    const { url } = await serve(port);
    console.log("BPMVIZ is available at " + url + " (Ctrl+C to stop).");
  }
} catch (err) {
  console.error(err.code === "EADDRINUSE" ? "Port " + port + " is in use. Stop the other server or use --port <number>." : err.message);
  process.exitCode = 1;
}
