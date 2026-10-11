// A stand-in for the claude CLI, for the runner tests. See fake-common.mjs.
import { readStdin, nextMode, log, envSeen, taskOf, inputOf, report, payloadFor, extractedEngagement, writeFile } from "./fake-common.mjs";

const args = process.argv.slice(2);
const out = obj => process.stdout.write(JSON.stringify(obj) + "\n");

if (args[0] === "--version") {
  process.stdout.write("9.9.9 (Claude Code)\n");
} else if (args[0] === "auth" && args[1] === "status") {
  const kind = process.env.FAKE_CLAUDE_AUTH || "team";
  if (kind === "signed-out") out({ loggedIn: false });
  else if (kind === "api-key") out({ loggedIn: true, authMethod: "api_key", apiProvider: "firstParty" });
  else out({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: kind, orgName: "Test org" });
} else if (args.includes("-p")) {
  const prompt = readStdin();
  const mode = nextMode();
  const task = taskOf(prompt);
  const toolsArg = args[args.indexOf("--tools") + 1];
  log({ provider: "claude", mode, task, args, cwd: process.cwd(), env: envSeen(), promptLength: prompt.length, repair: /Repair round/.test(prompt),
    input: task === "log-mapping" ? inputOf(prompt) : undefined });
  const tools = (toolsArg ? toolsArg.split(",") : []).concat(["StructuredOutput"]);
  if (mode === "unexpected-tool") tools.push("Bash");
  out({ type: "system", subtype: "init", tools, mcp_servers: [], model: "fake-model", permissionMode: "dontAsk" });
  if (mode === "hang") {
    setInterval(() => {}, 1000);
  } else if (mode === "usage-limit") {
    out({ type: "result", subtype: "success", is_error: true, result: "Claude AI usage limit reached. Your limit will reset at 5pm." });
    process.exitCode = 1;
  } else {
    let structured;
    if (task === "extract") {
      if (!/Repair round/.test(prompt) || mode !== "invalid") writeFile(process.cwd(), "out/engagement.json", JSON.stringify(extractedEngagement(mode)));
      structured = report(prompt);
    } else {
      structured = Object.assign({ payload: payloadFor(task, prompt, mode) }, report(prompt));
    }
    if (mode === "unexpected-tool") {
      // The runner stops the process before this is read.
      setInterval(() => {}, 1000);
    } else {
      out({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "sources/01-notes.txt" } }] } });
      out({ type: "result", subtype: "success", is_error: false, result: JSON.stringify(structured), structured_output: structured, num_turns: 2,
        permission_denials: mode === "denied" ? [{ tool_name: "Write", tool_input: { file_path: "C:/elsewhere/leak.txt" } }] : [] });
    }
  }
} else {
  process.stderr.write("fake claude: unexpected arguments " + JSON.stringify(args) + "\n");
  process.exitCode = 2;
}
