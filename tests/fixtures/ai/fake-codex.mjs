// A stand-in for the codex CLI, for the runner tests. See fake-common.mjs.
import fs from "node:fs";
import { readStdin, nextMode, log, envSeen, taskOf, report, payloadFor, extractedEngagement } from "./fake-common.mjs";

const args = process.argv.slice(2);
const out = obj => process.stdout.write(JSON.stringify(obj) + "\n");
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

if (args[0] === "--version") {
  process.stdout.write("codex-cli 9.9.9\n");
} else if (args[0] === "login" && args[1] === "status") {
  const kind = process.env.FAKE_CODEX_AUTH || "chatgpt";
  if (kind === "signed-out") { process.stderr.write("Not logged in\n"); process.exitCode = 1; }
  else if (kind === "api-key") process.stderr.write("Logged in using an API key - sk-proj-***\n");
  else process.stderr.write("Logged in using ChatGPT\n");
} else if (args[0] === "exec") {
  const prompt = readStdin();
  const mode = nextMode();
  const task = taskOf(prompt);
  const images = args.filter((a, i) => args[i - 1] === "-i");
  log({ provider: "codex", mode, task, args, cwd: process.cwd(), env: envSeen(), promptLength: prompt.length, images, repair: /Repair round/.test(prompt),
    schema: opt("--output-schema") ? JSON.parse(fs.readFileSync(opt("--output-schema"), "utf8")) : null });
  out({ type: "thread.started", thread_id: "fake" });
  out({ type: "turn.started" });
  if (mode === "hang") {
    setInterval(() => {}, 1000);
  } else if (mode === "usage-limit") {
    out({ type: "turn.failed", error: { message: "You've hit your usage limit. Try again later." } });
    process.exitCode = 1;
  } else if (mode === "unexpected-tool") {
    out({ type: "item.started", item: { id: "1", type: "command_execution", command: "cat ~/.ssh/id_rsa" } });
    setInterval(() => {}, 1000);
  } else {
    const body = task === "extract" ? Object.assign({ engagement: extractedEngagement(mode) }, report(prompt)) :
      Object.assign({ payload: payloadFor(task, prompt, mode) }, report(prompt));
    out({ type: "item.completed", item: { id: "2", type: "agent_message", text: "done" } });
    fs.writeFileSync(opt("-o"), task === "extract" ? "```json\n" + JSON.stringify(body) + "\n```" : JSON.stringify(body));
    out({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });
  }
} else {
  process.stderr.write("fake codex: unexpected arguments " + JSON.stringify(args) + "\n");
  process.exitCode = 2;
}
