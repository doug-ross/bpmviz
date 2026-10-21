# AI tasks on your Claude or ChatGPT subscription

AIxRay can ask an AI assistant to draft six things, five for a project and one for a screening:

| Task | What you get | Command |
|---|---|---|
| Create a process from documents | A new project drafted from PDF, Word, PowerPoint, diagram images, notes or BPMN | `npm run ai -- extract <files...>` |
| Suggest findings | Pain points, opportunities and open questions linked to steps | `npm run ai -- opportunities --in <file>` |
| Draft a future state | Changes to the current state: steps changed, added and removed, new lanes | `npm run ai -- future-state --in <file>` |
| Draft the summary | The executive summary that opens the printed report | `npm run ai -- summary --in <file>` |
| Match event log activities to steps | A suggested step for each activity name in an event log, for the event log import | `npm run ai -- log-mapping --in <file> --activities <file>` |
| Draft screening scores | A 1 to 5 score, with a rationale, for each criterion that people have not scored yet, for each process in a screening | `npm run ai -- screen --in <file.screening.json>` |

The assistant is **Claude Code** (on a Claude Pro, Max, Team or Enterprise plan) or **Codex** (on a ChatGPT Plus, Pro, Business or Enterprise plan). AIxRay runs the tool you have installed, on the account you signed in with, so the work counts against your subscription's usage and not against an API key. AIxRay never asks for, sees or stores a password, token or key.

Every task produces an **AI result file**. You open it in AIxRay with Open, look at each proposed item, tick the ones you want and apply them in one step that Undo reverses. Applied items stay marked **AI draft, not reviewed**, and the report, the Present view and exports leave them out until someone marks them reviewed.

A log-mapping result is the exception: it changes nothing in the project. You load it in the event log import, in the Match activities step, and each match you take still needs its own tick there before the log is added. See [event-logs.md](event-logs.md).

Drafted screening scores go into a screening, not a project. Open the screening (Screen processes, then Open), choose **Load AI scores**, tick the scores you want and apply them. They stay marked as AI drafts until someone reviews each one, and the printed summary leaves them out until then unless you include them. See [screening.md](screening.md).

There are three ways to start a task:

1. **The command line**, `npm run ai`, described below. This is the strictest route and the one to use for client material.
2. **An agent skill** inside Claude Code (`/aixray-extract` and so on) or Codex (`$aixray-extract`).
3. **The app**, when you start it with `npm run serve -- --ai`. The app then shows Draft with AI buttons.

The app opened from disk (`webui/index.htm`) never contacts anything. It can still open and apply result files made any of these ways.

## Set up

You need Node.js 20 or later and this repository with `npm install` run once.

### Claude Code

1. Install Claude Code. On Windows, run `irm https://claude.ai/install.ps1 | iex` in PowerShell. On macOS or Linux, run `curl -fsSL https://claude.ai/install.sh | bash`. Or use `npm install -g @anthropic-ai/claude-code`.
2. Run `claude`, type `/login` and sign in with your Claude account (not the API Console).
3. Check: `npm run ai -- status` should say `signed in` and name your plan, for example `Claude Team`.

For an unattended machine, run `claude setup-token` once and set the token it prints as `CLAUDE_CODE_OAUTH_TOKEN`. AIxRay passes that variable through.

### Codex

1. Install Codex: `npm install -g @openai/codex`.
2. Run `codex login` and choose Sign in with ChatGPT.
3. Check: `npm run ai -- status --with codex`. Codex does not report which ChatGPT plan you are on, so give it with `--plan commercial` (Business or Enterprise) or `--plan consumer` (Plus or Pro) on every task. The app remembers your answer.

### API keys

If `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `OPENAI_API_KEY` or `CODEX_API_KEY` is set, the tool would bill the key instead of your subscription. AIxRay removes them from the tool's environment. If the tool itself is signed in with an API key, AIxRay stops and says so; pass `--use-api-key` if that is what you want.

## Which material may go to which plan

| Project confidentiality | Commercial plan (Claude Team or Enterprise, ChatGPT Business or Enterprise) | Consumer plan (Claude Pro or Max, ChatGPT Plus or Pro) |
|---|---|---|
| Demonstration data, or Public | Allowed | Allowed |
| Internal | With the project lead's approval (`--yes`) | Only with model training turned off (`--training-off`) |
| Client confidential | With the project lead's approval (`--yes`) | Not allowed |
| Restricted | With approval and written client approval (`--yes --written-approval "Name, date"`) | Not allowed |

Commercial plans do not use your conversations to train models by default. Consumer plans may, unless you turn it off: in Claude, Settings, Privacy, "Help improve Claude"; in ChatGPT, Settings, Data controls, "Improve the model for everyone". Your organization's own rules come first: if it has not approved an assistant for client material, do not use one.

AIxRay applies this table before anything is sent, in all three routes. Claude Code reports its plan, so AIxRay uses that; for Codex it uses the plan you declare. An extraction has no project yet, so its confidentiality is Client confidential unless you say otherwise with `--confidentiality`. A screening is held to the strictest confidentiality among the screening and the processes that would be sent. Findings and screening processes marked sensitive are never sent unless you add `--include-sensitive`. The result file records the plan and the confirmations you gave.

Check a case without running anything:

```
npm run ai -- gate --in claims.engagement.json
```

## The command line

```
npm run ai -- extract intake-procedure.docx claims-flow.png workshop-notes.md --process-name "Claims intake" --client "Northwind" --yes
npm run ai -- opportunities --in claims.engagement.json --yes
npm run ai -- future-state --in claims.engagement.json --yes
npm run ai -- summary --in claims.engagement.json --yes
npm run ai -- log-mapping --in claims.engagement.json --activities claims-log.csv --yes
npm run ai -- screen --in shortlist.screening.json --yes
npm run ai -- check claims.opportunities.ai-result.json --in claims.engagement.json
```

Each task writes `<name>.<task>.ai-result.json` in the current folder (or `--out <file>`), prints what it holds and lists anything to check. Then open the project in AIxRay, open the result file with Open, and review it. For an extraction there is no project to open first: the result opens as a new project (**Open as a new project**).

| Option | Meaning |
|---|---|
| `--with claude` or `--with codex` | Which tool to use. Claude Code is the default. |
| `--plan commercial` or `--plan consumer` | Your plan, when the tool does not report it. |
| `--yes`, `--training-off`, `--written-approval "<text>"` | The confirmations from the table above. |
| `--include-sensitive` | Also send findings marked sensitive. |
| `--baseline <model id>` | The current-state model a future state starts from, or the model whose steps a log mapping matches the activities to. |
| `--activities <file>` | log-mapping: the activity names. A `.txt` file with one name per line (as the import's Save names for the command line writes it), or the event log itself as `.csv`, `.tsv` or `.xlsx`. |
| `--activity-column <name>` | log-mapping: the column that holds the activity names, when AIxRay does not find it from the header. |
| `--confidentiality`, `--data-status`, `--process-name`, `--client`, `--engagement-name` | Details for an extraction. |
| `--model <name>` | Ask the tool for a specific model. |
| `--apply` | Also write `<name>.with-ai.engagement.json` with every item applied, still marked as unreviewed AI drafts. Not used by log-mapping. |
| `--keep` | Keep the job folder for inspection. |
| `--json` | Machine-readable progress, one JSON object per line. |

Exit codes: 0 done, 1 failed, 2 wrong usage, 3 stopped by the data-handling rules.

`npm run ai -- text <file>` prints the text AIxRay reads from a document, which is a quick way to see what an assistant will get from a PDF or a slide deck. `npm run ai -- input <task> --in <file>` prints exactly what a task sends; for log-mapping add `--activities <file>`.

For screening scores the assistant sees the criteria with what 1, 3 and 5 mean, and for each process its name, description, yearly figures, the figures copied from its project, the scores people gave and the criteria still to score. It never sees process owners, because they can name people, or processes marked sensitive unless you add `--include-sensitive`. It drafts only the criteria nobody has scored; a score a person gave cannot be replaced. `--apply` writes `<name>.with-ai.screening.json` with every drafted score applied as an unreviewed AI draft. The app's Draft with AI buttons do not run this task; use the command line or a skill.

For log mapping the assistant sees the steps of one model (ID, label, lane and description, without gateways) and the activity names, most frequent first, up to 500 of them. It never sees events, times, case IDs, counts or people. Activity names that look like a key or token are left out before anything is sent, and the result says how many. A suggested match to a step that is not in the model, to a gateway, or for a name that was not sent cannot be used.

## Agent skills

The repository includes one skill per task for each tool:

- Claude Code: open Claude Code in the repository folder and type `/aixray-extract`, `/aixray-opportunities`, `/aixray-future-state`, `/aixray-summary`, `/aixray-log-mapping` or `/aixray-screen`, followed by the file names. The skills run only when you type them.
- Codex: open Codex in the repository folder and ask for `$aixray-extract`, `$aixray-opportunities`, `$aixray-future-state`, `$aixray-summary`, `$aixray-log-mapping` or `$aixray-screen`.

A skill checks the data-handling rules with `npm run ai -- gate` before it reads anything, asks you for the confirmations it needs, drafts the result, checks it with `npm run ai -- wrap` and tells you which file to open.

To start a skill from a script, pass it as the prompt: `claude -p "/aixray-summary claims.engagement.json"`. In Git Bash on Windows, set `MSYS_NO_PATHCONV=1` first, or Git Bash turns the leading slash into a Windows path and Claude Code receives text instead of the command. Typing the command in an interactive session is not affected.

A skill runs inside your own session, with your settings, hooks, plugins and MCP servers. The command line and the app run the tool in a separate session with none of those, so for client material prefer them.

## In the app

```
npm run serve -- --ai
```

This starts AIxRay at `http://127.0.0.1:8080` with a local AI helper and prints a link that ends in `#ai=` and a one-time code. Open that link. The app then shows:

- **Create from documents with AI** on the start screen.
- **Suggest findings with AI** in the Findings tab, and in the Process tab's side panel.
- **Draft a future state with AI** in the Process tab's side panel.
- **Draft with AI** next to the executive summary in Present, Report.
- **Draft with AI** in More actions, for any of the first four.
- **Ask AI for the rest** in the Match activities step of the event log import, for the activity names that are not matched yet.

The task dialog shows the tool and plan, the data-handling check and what will be sent, then runs the task and shows its progress. Cancel stops the tool. When it finishes, the review dialog opens as it does for a result file.

The helper accepts requests only from the page it served, in the tab that used the code. It listens on 127.0.0.1 only, runs one task at a time and never sends CORS headers. To use it in another tab, open the fresh link the terminal prints.

## What AIxRay does to keep material safe

- **Least access.** Claude Code runs with `--restricted --safe-mode --strict-mcp-config`: no shell or code tools, no web access, no hooks, CLAUDE.md files, skills, plugins or MCP servers, and file tools limited to the job folder. An extraction may write only in the job's `out/` folder; the other tasks get no tools at all. If the tool starts with any other tool, the run is stopped. Codex runs in a read-only sandbox without your `config.toml` or rules files (so none of your MCP servers, notification hooks or profiles), with the shell, the command runner, web search, apps, browser and computer use, sub-agents, hooks, plugins and memories turned off, and receives everything in the prompt.
- **No history.** Sessions are not saved (`--no-session-persistence`, `--ephemeral`). Each job works in a new temporary folder that is removed when it ends.
- **Sources are data.** Documents are fenced with markers that carry a random code, and the assistant is told to report any instruction it finds in them rather than follow it. Such reports appear as warnings in the review.
- **Drafts stay drafts.** An extraction has every step set to Not confirmed yet, every source to Not reviewed and every link removed, and it takes the confidentiality and data status you declared. Suggestions and changes that point at steps that do not exist cannot be applied.
- **Credentials are caught.** A result that contains something that looks like a key, token or private key is refused. For log mapping, activity names that look like one are not sent at all.
- **Figures are traced.** A drafted summary is checked against the project's figures, and any number that cannot be found is flagged for review.
- **A person decides.** Nothing is applied until you tick it, and applied items stay marked as AI drafts until someone reviews them.

## Limits

- Up to 20 sources per job, 25 MB each and 60 MB in total. DOCX and PPTX archives that would expand past 120 MB are refused.
- Scanned PDF pages have no text. AIxRay says how many; export those pages as images and add them as sources.
- Codex reads documents only through the text AIxRay puts in the prompt, up to about 300,000 characters. Claude Code can open the rest of a long document from the job folder.
- Log mapping sends at most 500 activity names, the most frequent first; the rest stay for you to match.
- A task takes from one to twenty minutes. Plan usage limits apply; when you hit one, AIxRay says so and does not retry.
- If a draft fails the checks, AIxRay asks the tool to fix it, at most twice, each time in a fresh session that sees only the draft and the problems.

## When something goes wrong

| Message | What to do |
|---|---|
| not installed | Install the tool (see Set up) and open a new terminal so it is on PATH. |
| not signed in | Run `claude` then `/login`, or `codex login`. |
| signed in with an API key | Sign in with your Claude or ChatGPT account, or pass `--use-api-key`. |
| usage limit is reached | Wait for your plan's limit to reset. |
| started with tools AIxRay did not ask for | A setting or plugin added tools. Run `npm run ai -- status` and check your Claude Code or Codex configuration. |
| does not accept one of the settings | Your Codex release renamed a setting AIxRay uses to switch tools off. Nothing was sent. Use a Codex version listed in this guide, or update AIxRay. |
| Not allowed | The material may not go to this account. See the table above. |
| still has problems after 2 repair rounds | Run the task again, or use `--keep` and look at `out/` in the job folder. |

AIxRay's Codex settings were checked against Codex 0.160. They are passed with `--strict-config`, so if a later release renames one of them, Codex stops with "does not accept one of the settings" before anything is sent, instead of running with a tool left on. After installing or updating Codex, run `npm run smoke:ai -- --with codex`.

`npm run smoke:ai` runs a summary of the demonstration example and an extraction from a test note with a hidden instruction, and checks the safety points above on your own sign-in. It uses a little of your plan's usage.
