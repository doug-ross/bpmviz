# AIxRay

AIxRay is a process workshop workbench. You open a process in the browser, play how a case moves through it, correct it with the people who run it, and add pain points, opportunities, questions, decisions and actions to each step as findings. At the end you save a portable project file and print the report for the client.

It runs from local files. There is no server, account, install or network connection, and nothing you type leaves your machine unless you save or export it, or start one of the optional AI tasks on your own Claude or ChatGPT subscription.

![Playing the underwriting example with a step open in the side panel](docs/screenshots/02-process-step.png)

## Quick start

1. Download or clone this repository.
2. Open `webui/index.htm` in Chrome, Edge, Firefox or Safari. Double-clicking the file is enough.
3. Choose **Try an example** or another bundled example, or open a project file or a BPMN file.

To serve the app over HTTP instead, run `npm run serve` and open `http://127.0.0.1:8080/index.htm`. Both ways are tested.

## What you can do

### Choose which process to start with

Choose **Screen processes** to compare several candidate processes before you pick one. Score each from 1 to 5 against weighted criteria for value, feasibility, and readiness and risk; type a process in, or add a project file you already have. The Ranking tab shows each process's score, where it falls on a chart of value against ease, its yearly hands-on hours and labor cost, any flags, and whether the first choice holds when a weight moves by 20 percent. The Summary tab prints a one-page summary, and **Start a project** turns the chosen process into a new project. A screening is its own file and never changes a project. **Open the example screening** in an empty screening shows a finished one. See [the screening guide](docs/screening.md).

### Build and run a Jumpstart workshop

Choose **Build a process** to start with a blank current state. Add lanes, steps, gateways and labeled flows, then use **Walkthrough** in Present to discuss normal cases and exceptions without entering timings. **Edit scenarios** records timed routes and explicit economic alternatives. Create named future alternatives in the process builder and compare them against their locked baseline.

In Findings, **Workshop** holds the agenda, parking lot, automation designs and checkpoint. Record who approves AI work, what happens on failure and how the pilot will be tested. **Pilot brief** in Present shares reviewed designs, acceptance criteria and owned actions. **Work with an assistant** exports reviewed task packets for Codex, Claude Code or GitHub Copilot and imports their proposals for review. See [the workshop guide](docs/workshops.md) for the full facilitator workflow.

### Play the process honestly

Choose a scenario and play it, or drag the time slider. Each step shows its state with a symbol as well as a color: not started, in progress, complete, not in this scenario, or route not confirmed. A step that is visited twice (rework) shows the visit in progress, not the earlier one. A connector lights up only when the scenario actually used it. Lenses overlay elapsed time, human effort, waits, handovers between lanes, SLA status, suspected bottlenecks or sources, and each lens says how many steps have data.

![A rework loop at minute 9,100: the second Develop Bot visit is in progress and over its SLA target](docs/screenshots/04-rework-sla.png)

The default Readable size keeps labels legible. Overview fits every lane on screen for orientation and says when the labels are too small to read. The search box (Search steps, roles or systems) finds a step by name, role or system, and the step list in the side panel mirrors the canvas for keyboard and screen-reader use.

### Add findings to the steps

Select a step and use its Findings tab to add a finding while the client is talking. Findings keep their link to the step, show as a count on the canvas, and collect in the Findings tab. Edit step corrects the step itself: name, description, owners, systems, typed SLA and effort measures, wait type, where it came from and its sources. Editing pauses playback.

![Adding an open question to the SOV scrub step](docs/screenshots/03-capture.png)

### Compare and plan a future state

When a project has a future state, compare it with the current state on one shared clock. To plan one, choose **Plan a future state** in the side panel: the current state becomes a locked baseline, and every step in the draft remembers where it came from. Changed, added and removed steps are marked, each with the reason you recorded, and selecting a step highlights its counterpart in the other pane.

![Current and proposed future state on a shared clock, with the elapsed-time lens](docs/screenshots/05-compare.png)

![A future-state draft with a changed, an added and a removed step](docs/screenshots/11-future-draft.png)

### Keep findings, opportunities and sources together

The Findings tab lists every finding under All findings, with filters for type, status, owner and step. Each opportunity asks for a type of change (removing the step, simplifying, standardizing and connecting systems come before automation and AI), why a simpler change is not enough, the expected benefit, effort, risk and how to confirm it. The Sources tab tracks the documents and extracts behind the process and whether the client has confirmed them. The To check tab lists what AIxRay noticed when it opened or converted the file, and turns any item into an open question.

![The list of opportunities in the Findings tab](docs/screenshots/07-opportunities.png)

### Check the numbers

The Value tab (What the change is worth) calculates cost per case, cost difference, time freed up (in FTE), cycle time reduction and payback from typed assumptions, and shows each formula with its inputs. A missing input leaves a result blank instead of assuming zero. Figures provided with a scenario are checked against the assumptions in **Do the provided figures add up?** In the underwriting example, four of the five provided future-state costs do not add up with the declared incremental AI cost, and the app shows the cost each one implies. **Which inputs matter most** shows which inputs move a result most.

![Formula-backed results for one scenario](docs/screenshots/08-value.png)

### Present and report

The Present tab has two modes: **Present**, a low-chrome view for the room, and **Report**, a printable summary of scope and versions, data status, findings, opportunities, decisions, actions with owners, assumptions, modeled figures and gaps in the sources. Findings marked sensitive stay out unless you tick Include sensitive findings. Exports: Export findings (CSV), Export diagram (SVG) and (PNG), and Save a copy of the project file.

![The printable report](docs/screenshots/10-handoff.png)

### Draft with AI on your Claude or ChatGPT plan

Claude Code (Claude Pro, Max, Team or Enterprise) or Codex (ChatGPT Plus, Pro, Business or Enterprise) can draft four things: a current state extracted from PDF, Word, PowerPoint, diagram images, notes or BPMN; suggested pain points, opportunities and questions; a future state as changes to the current state; and the executive summary for the report. AIxRay runs the tool you already use, on the account you signed in with, so no API key is involved and AIxRay never handles a credential.

```
npm run ai -- status
npm run ai -- extract intake-procedure.docx claims-flow.png --process-name "Claims intake" --yes
npm run ai -- opportunities --in claims.engagement.json --yes
```

Each task writes an AI result file. Open it in AIxRay with Open, look at each item and tick the ones you want; they go in as one change that Undo reverses. Applied items are marked as AI drafts and stay out of the report, the Present view and exports until someone reviews them. A reviewed AI summary prints with a line saying it was drafted with AI assistance.

![Reviewing opportunities that Claude Code drafted for the underwriting example](docs/screenshots/13-ai-review.png)

Client material goes only to commercial plans, with the project lead's approval; consumer plans take internal material only, with model training turned off. AIxRay checks this before anything is sent. The tool runs in a separate session with no shell, web access, hooks, plugins or MCP servers, and nothing is saved when it ends. The same tasks are available as agent skills in Claude Code and Codex, and as Draft with AI buttons when you start the app with `npm run serve -- --ai`.

![Starting an AI task from the app, with the data-handling check](docs/screenshots/14-ai-task.png)

`docs/ai.md` covers setup, which plan may take which material, the options, the safety checks and troubleshooting.

### Measure the process from system data

If the client can export a log from the workflow, ticketing or core system that ran the process, AIxRay reads it and shows how the process actually ran: how many cases visited each step, how long each step took, which paths cases followed. This gives you real figures to show alongside what the workshop captured, instead of estimates only.

Open the project, then choose **More actions, Import an event log**, or just open the log file like any other file. A five-step wizard (Choose file, Match columns, Match activities, Options, Review) walks through the file, the columns, matching the log's activity names to the steps of your model, a few options, and a summary of what will be added. Nothing changes in the project until you choose **Add the event log**. The figures then show on the canvas as two new lenses (Measured share of cases, Measured time per visit), in the side panel, in the Value tab and in the report.

![Matching activity names from a sample event log to the steps of the underwriting process](docs/screenshots/15-log-import.png)

Only aggregates are kept: counts and times per step, never the individual events, case IDs or the names of people in the log. `docs/event-logs.md` covers the file formats, the timestamp rules, how activities are matched to steps, and what is and is not stored.

### Build the business case for an opportunity

Every opportunity can carry a business case: typed or measured inputs for how much effort it saves, how many cases it affects, and what it costs to deliver. As you fill it in, AIxRay estimates the opportunity's annual value right away, using the same formula everywhere it shows up.

The **Matrix** view in Findings, Opportunities charts every scored opportunity by value against effort, so you can see quick wins against major projects at a glance. The **Waves** view lays opportunities out by delivery wave (now, next, later) with a running total for each wave. The **Business case** mode in Present is a printable CFO one-pager: an All opportunities page with the wave totals, or a single opportunity's own page with its headline figures and what is still missing.

![Opportunities charted by value and effort in the Matrix view](docs/screenshots/16-business-case-matrix.png)

A missing input leaves a result blank rather than assuming zero, and every figure carries the basis of its weakest input (illustrative, provided, measured or confirmed). See `docs/business-case.md` for the formulas and how ranking and the quadrants work.

### Check whether a change actually worked

Once you have an event log from before a change and another from after it, the **Benefits** section in the Value tab compares the two: what each step actually took, and whether an opportunity's modeled business case was borne out. It never claims savings were "realized": a measured change can be confounded by seasonality, a different volume mix, or a change in how activities were matched between the two periods, and the section lists those caveats in the notes under every comparison. A read-only **Measured change** lens on the canvas marks each measured step faster, slower or about the same.

![A step-by-step comparison of a baseline and an after event log](docs/screenshots/19-benefits.png)

Start it from the Value tab once the project has two event logs. See `docs/benefits.md` for how the comparison is built and what each status (Met, Partially met, Not yet, Worse, Not measurable) means.

### Ask a client stakeholder to check the process

A review form lists the steps of a process model and the workshop's findings, and asks the reviewer to Confirm, Dispute or mark Not sure on each one, with a comment. Choose **Send for review** in Present, pick a format (a web page that opens in any browser, or an Excel workbook), choose what to include, choose **Download review form** and send the file. The reviewer's answers come back as a file you open in AIxRay; applying them marks the steps confirmed or disputed, can add open questions for disputed items, and can add the review as a source.

![Setting up a review form](docs/screenshots/17-client-review-pack.png)

The form carries only the steps and the findings chosen for it, plus the project's title, client name, data status, confidentiality and disclosure. No figures, other findings, sources or notes go with it, and sensitive findings or unreviewed AI drafts are left out unless you explicitly include them. See `docs/client-review.md` for how the web page and the Excel workbook are kept safe, and how answers from reviewers who disagree are handled.

### Hand the process to the tools your client already uses

**Export to other tools**, next to Save a copy in Present, builds a PowerPoint deck, a BPMN 2.0 diagram, or a Jira, Azure DevOps or Excel backlog from the current project. It never changes the project, so there is nothing to undo.

![Choosing what to export to other tools](docs/screenshots/18-export-dialog.png)

The deck covers scope, pain points, opportunities with their modeled value, the wave plan, the current process diagram and next steps, built the same way every time so it opens cleanly in PowerPoint, Keynote or Google Slides. The BPMN export round-trips back through AIxRay's own importer. The backlog turns opportunities into epics or features and actions into tasks or stories, with acceptance criteria drawn from the business case. See `docs/exports.md` for what does and does not carry over.

## Your data

- **The project file you save is the copy that counts.** Use Save (Ctrl+S) often and store the file like any client document.
- **A recovery draft is kept in this browser** while you work, with a few earlier snapshots. It is not encrypted. On a shared machine, use More actions, Clear drafts from this browser when you finish. If the browser blocks storage, the header says so and file save still works.
- **Opened files are treated as data.** Text is shown as text, only http and https links are kept, spreadsheet formulas are neutralized in CSV exports, and a file that fails the checks is refused with the reasons while your open project stays as it was.
- **Nothing is fetched from the internet.** Fonts are bundled and the page's content security policy blocks outside connections. Opened from disk, the app cannot contact anything, even to run an AI task; it can still open AI result files.
- **AI drafts are labeled.** Findings, future states and summaries drafted by an AI tool show as AI drafts until someone reviews them, and the report and exports leave them out until then.
- Every screen and export shows whether the content is demonstration data, provided data or measured data.
- **An imported event log keeps only aggregates.** The project never holds the log's individual events, case IDs or the names of people in it, only counts and times per step. Case IDs are hashed by default, and people are counted only if you choose to, with no names stored either way. See `docs/event-logs.md`.
- **A review form carries only what you chose for it.** Steps, the findings you included, and the project's title, client name, data status, confidentiality and disclosure; no figures, other findings, sources or notes. Sensitive findings and unreviewed AI drafts stay out unless included on purpose. The web page form stores nothing in the browser and sends nothing anywhere. See `docs/client-review.md`.
- **A screening is its own file.** It holds the scores and the figures you typed or copied from a project, never the project itself. Processes marked sensitive stay out of the ranking and the summary unless you include them. See `docs/screening.md`.
- **Export to other tools never changes the project.** The PowerPoint deck, BPMN file and backlog it builds respect the same sensitive-finding and AI-draft settings as the report. See `docs/exports.md`.

## Bring your own process

| Starting point | How |
|---|---|
| A BPMN 2.0 file | Open it. Lanes, events, tasks, exclusive and parallel gateways and sequence flows are imported with their BPMN IDs. Other elements are flagged, not dropped. BPMN has no timings, so playback is off until you add a scenario. |
| A process document, SOP, slides, diagrams or notes | Run `npm run ai -- extract <files>` on your Claude or ChatGPT subscription (see `docs/ai.md`), then open the result file. Or paste `tools/prompts/engagement-generator-prompt.md` into an AI assistant your organization approves for the material, and check what it returns with `npm run validate -- my-process.engagement.json`. |
| A reviewed template | New creates a project from one of the bundled examples without its findings. |
| Files made with the old prompts | `npm run convert -- path/to/process.js`. See `archive/README.md`. |

The file format is documented in `webui/schema/engagement.schema.json`, and the bundled examples in `webui/examples/` are complete files to copy from.

AIxRay was called BPMVIZ before. Files saved under that name still open as they are: project files, review answers from forms sent out before the rename (web page or Excel), AI result files, and drafts kept in the browser. AIxRay saves them with the current `aixray.*` format tags, so an older BPMVIZ copy cannot open them after that.

## Keyboard

| Keys | Action |
|---|---|
| Tab, Enter | Move through steps on the canvas; open a step |
| Esc | Close the step panel and return to the step |
| Space | Play or pause |
| + and -, 0, W, F | Zoom; Readable size; Fit width; Overview |
| Arrow keys, / | Pan the canvas; search steps |
| Ctrl+S, Ctrl+O, Ctrl+Z | Save, open, undo |
| ? | Help |

## Limits

- Playback shows the visits recorded in a scenario. It does not evaluate gateway conditions, simulate queues or predict throughput.
- Figures are only as good as their inputs. The app labels them illustrative, provided, measured or confirmed and checks their arithmetic; it cannot check whether an assumption is true.
- One person works on a project file at a time. There is no shared editing or approval workflow.
- The bundled examples are demonstrations. Their timings, volumes and costs are assumptions from the original samples.
- AI drafts are drafts. AIxRay checks their structure, traces their figures and blocks links and credentials, but it cannot tell whether a drafted step or opportunity is true. Review each one with the people who know the process.
- Automated tests run in Chrome, both from disk and over HTTP. Edge uses the same engine. Firefox and Safari should work but are not covered by the tests, and browsers differ in how they keep storage for pages opened from disk, which is why the saved file is the durable copy.

## Development

You need Node.js 20 or later. The browser tests and screenshot tool also need Chrome or Edge installed.

```
npm install              # installs playwright-core and pdfjs-dist, used only by the tests and tools
npm test                 # unit tests (node --test); the AI tests use fake claude and codex programs
npm run test:browser     # the app in Chrome, from disk, over HTTP and with the AI helper
npm run check            # Sogeti anti-style gate and the prose check
npm run ai -- --help     # AI tasks on your own Claude Code or Codex sign-in
npm run smoke:ai         # a real run on your sign-in with demonstration material, checking the safety points
npm run build:examples   # rebuild webui/examples from the archived samples
npm run screenshots      # regenerate docs/screenshots
```

The app has no build step. Every file under `webui/js/lib/` works both as a browser script and as a Node module, so the tests exercise the same code the app runs.

| Path | Contents |
|---|---|
| `webui/index.htm` | The app |
| `webui/js/lib/` | Model and logic: schema, validation, replay, layout, lenses, economics, store, persistence, exports, BPMN import, AI result files, event-log mining, business case figures, benefits comparison, review forms, process screening |
| `webui/js/ui/` | Interface: diagram, Process tab, side panel, forms, findings, value and present views, AI review and tasks, event-log import wizard, opportunity value and the business case, the benefits section, reviews and exports to other tools, the screening window |
| `webui/css/` | Design tokens (Sogeti palette and Ubuntu type) and app styles |
| `webui/examples/` | Bundled example projects, generated from `archive/` |
| `webui/schema/` | JSON Schemas for project files and AI result files |
| `tools/` | Validator, legacy converter, example and schema builders, screenshot tool, checks, prompts |
| `tools/ai/` | The AI runner, command line and local helper: Claude Code and Codex commands, document text, prompts, checks |
| `.claude/skills/`, `.agents/skills/` | The AIxRay agent skills for Claude Code and Codex |
| `tests/` | Unit tests, browser tests and fixtures |
| `docs/` | AI guide, event logs, the business case, benefits tracking, review forms, exports, process screening, audit tracker, the September 2026 audit, sample event logs and screenshots |
| `archive/` | The earlier prototypes and prompts, kept for reference |

## Audit

This version implements the September 2026 product and architecture audit. `docs/AUDIT_TRACKER.md` lists every finding and backlog item with its status and the tests that cover it. The audit itself is in `docs/audit/`.

## Credits and license

AIxRay was created by Doug Ross; the original explorer and race explorer are in `archive/`. Released under the MIT License (see `LICENSE`). The interface follows the Sogeti design system. Ubuntu and Ubuntu Mono are used under the Ubuntu Font Licence 1.0 (`webui/fonts/UFL.txt`).
