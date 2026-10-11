# Event logs: measure the process from system data

An event log is an export from a workflow, ticketing or core system with one row per event: which case it belongs to, what happened, and when. AIxRay reads the log, matches its activities to the steps of a process model, and keeps the result as counts and times per step. The figures then show on the canvas, in the side panel, in the value model and in the report, each labelled with where it came from.

The project file never holds the events themselves, the case IDs or the names of the people in the log. It holds aggregates: how many cases visited a step, how long the step took, which paths cases followed.

## What a log needs

| Column | Needed | Examples of headers AIxRay recognizes |
|---|---|---|
| Case ID | Yes | Case ID, Claim number, Submission ID, `case:concept:name` |
| Activity | Yes | Activity, Step, Task, Event, `concept:name` |
| Time | Yes: one time per event, or a start and an end | Timestamp, Completed at, `time:timestamp`; Start time and End time |
| Who did the work | No | Resource, User, Performer, `org:resource` |

- File types: comma, semicolon, tab or pipe separated text (`.csv`, `.tsv`, `.txt`) and Excel workbooks (`.xlsx`). Text is read as UTF-8, or as Windows-1252 when it is not valid UTF-8, which is what spreadsheet programs on Windows write.
- Limits: 25 MB, 200,000 events and 100,000 cases per log; 12 logs per project.
- The header is the first row with at least two filled cells, so a title row above the table is fine. In a workbook, pick the sheet that holds the log.

## Import a log

Open the project first. Then either choose **More actions, Import an event log**, or open the log file with **Open** like any other file. The import takes five steps in one dialog. Nothing changes in the project until the last step.

1. **Choose file.** The first 20 rows are shown as they were read. For text files, check the separator; for workbooks, the sheet.
2. **Match columns.** Choose the process to measure against (**Measure against**) and the columns for the case ID, the activity, the time or times, and optionally **Who did the work (optional)**. AIxRay suggests the columns from the header and detects the **Date and time format**; the samples under the format show how the first values are read.
3. **Match activities.** Each activity name in the log is matched to a step (see below). Tick **Use** for each match you accept.
4. **Options.** Name the log, choose how case IDs are treated and whether to count people, which steps count as the end of a case, the time basis, the role (baseline, or after a change and compared with an earlier log), the data status and how many scenarios to make.
5. **Review.** A summary of what will be stored and a list of what to check: rows that could not be read, suggestions left unticked, cases left out, step pairs the model does not explain. **Add the event log** adds it as one change, which one Undo reverses.

## Timestamps

| Format | Example |
|---|---|
| Year first (ISO 8601) | `2026-01-31 14:05`, `2026-01-31T14:05:00Z`, `2026-01-31T14:05:00+01:00` |
| Day first | `31/01/2026 14:05`, `31.01.2026` |
| Month first | `01/31/2026 2:05 PM` |
| Excel date numbers | `46053.59`, or a date-formatted cell in a workbook |

- A time without a time zone is read as a wall-clock time. AIxRay does not convert it to your computer's time zone, so a change to or from daylight saving time cannot add or remove an hour from a duration. A time with an offset (`Z`, `+01:00`) is converted to UTC.
- Day first and month first can only be told apart when some value has a day above 12. When none has, AIxRay reads the values day first and says so; check the samples and change the date and time format if needed.
- Two-digit years are read as 2000 to 2099.

## Match activities to steps

Each activity matches one step at most. Several activities may match the same step, such as "Start review" and "Complete review". Gateways are decision points and cannot be matched.

- **Same name.** Names that are equal once case, accents, punctuation and "&" are ignored are matched and ticked already.
- **Similar name.** Otherwise AIxRay compares the name with every step label, by shared words (token Jaccard index) and by spelling (normalized Levenshtein distance), and takes the higher of the two. From 75% it suggests the step. A suggestion is not used until you tick it.
- **Chosen by hand.** Pick a step in the list; your choice counts as accepted.
- **Left out.** An activity without a step is not counted. Its events show as "Events not matched".

An AI assistant can suggest steps for the names that are still unmatched. It only ever sees the activity names and the steps of the model (ID, label, lane and description): no times, case IDs, counts or people. Activity names are client material, so the data-handling rules in [ai.md](ai.md) apply. A name that looks like a key or token is never sent; it stays in the Match activities step for you to match by hand.

- **In the app with the AI helper** (`npm run serve -- --ai`): **Ask AI for the rest** in the Match activities step.
- **On the command line or with an agent skill**: **Save names for the command line** saves the names, one per line, most frequent first. Run `npm run ai -- log-mapping --in <file> --activities <names.txt>` (the log file itself also works as `--activities`, read as UTF-8 or Windows-1252 with the same rule as the import, so the names match), or `/aixray-log-mapping` in Claude Code or `$aixray-log-mapping` in Codex. Then **Load an AI mapping result** in the Match activities step.

The suggestions you tick in the review come back into the Match activities step marked "Suggested by AI". Each one still needs its own tick. A suggestion never replaces a match you have ticked.

## Privacy

- **Case IDs** are hashed by default: each case that is played back as a scenario is named by 8 characters of a SHA-256 hash of its ID with a random salt, and the salt is thrown away. You can number the cases instead, or keep the original IDs after ticking a confirmation. Only the cases played back as scenarios are named at all.
- **People** are not counted by default. If you choose **Count people per step (names are not saved)**, AIxRay stores how many distinct people worked on each step and how often work changed hands into it, never the names.
- The file's SHA-256 fingerprint, its name and the row counts are stored, so a figure can be traced back to the file it came from.

## What is measured

Events are sorted per case by time, then by their order in the file. Only events matched to a step count. Times are in minutes of the log's time basis: calendar time, or business time (Monday to Friday, from the working day's start for the working minutes per day you set).

| Figure | Meaning |
|---|---|
| Cases | Cases measured. A case with no event matched to a step is left out and listed under what to check. With the end-step rule (**Complete cases** in Options), a case counts only when its last matched event is at an end step; the cases left out by that rule are stored as incomplete. By default the end steps are end events and the steps that lead to an end event through gateways and events only; you can change them. A case is complete when its last matched event is at an end step, so with no end steps no case counts as complete. |
| Cycle time | From the start of the first matched event of a case to the end of its last. |
| Visits, cases and share | How often a step occurs, in how many cases, and the share of measured cases that visit it. |
| Repeat visits | Cases that visit a step more than once, and their share of the cases that visit it. |
| Duration | End minus start of an event (logs with start and end times only). |
| Wait | Start of an event minus the end of the previous event in the case. When work runs in parallel and an event starts before the previous one ended, the wait counts as zero. |
| Time since the previous event | End of an event minus the end of the previous one; with one time per event, the time between the two events. |
| Statistics | Count, mean, minimum, maximum and the 10th, 25th, 50th (median), 75th and 90th percentiles, with linear interpolation between values. Fewer than 5 values are flagged. |
| Step pairs | Pairs of consecutive steps in a case, with the connectors between them. A connector path may pass through gateways and events, up to 6 connectors. A pair with no such path is kept and marked as not in the model; parallel branches that interleave in the log show up this way. |
| Variants | The sequence of steps of a case. The 100 most common are kept; the rest are counted together, which makes the share of cases for a set of steps a range instead of an exact figure. A variant stores its first 200 steps, and cases whose first 200 steps are the same count as one variant, so every stored variant is a different sequence. |
| Annualized volume | Cases per day over the log period (first to last event, at least one day), times 365. A short or seasonal period gives a rough figure. |

## Scenarios from the log

For each of the most common variants (3 by default, up to 10) AIxRay adds a scenario that plays back one real case: the case whose cycle time is closest to the median of its variant. Its visits are minutes from the first event of the case, in the project's time basis. Gateways and events on the way get visits of zero length so playback follows the flow. Steps that are matched but not in the case are marked as not in the scenario. The scenario has a cycle time measure and, for logs with start and end times, a human touch measure (the start to end time of the steps in people lanes).

Scenarios from a measured log are measured; from a demonstration log, illustrative.

## Where the figures appear

- **Findings, Event logs**: one card per log with its source, period, cases, cycle time, matching and scenarios. **Edit** the name, role, comparison, data status and notes; copy figures with **Use in the value model**; or **Delete** the log, with or without its scenarios. The tab appears once the project holds an event log.
- **Process, lenses**: **Measured share of cases** shows the share of cases that visit each activity and highlights the connectors cases take; **Measured time per visit** shows the median time per visit. Both say which log, which period and how many activities they cover.
- **Process, side panel**: the overview shows the log's cases, cycle time and most common path; a step shows "Measured in the event log" with its cases, visits, repeat visits, duration, wait and, when counted, the people involved and how often work changes hands.
- **Value, Measured inputs**: annual volume, median cycle time and human touch per case for each log, with their basis.
- **Present, Report**: an "Event logs" section after the scope.

## Use the figures in the value model

**Use in the value model** copies figures from a log, each marked with the log's basis (measured for measured data, provided, or illustrative for demonstration data) and with the source "Event log *file*, *period*, *N* cases". Tick the figures you want and choose **Copy the ticked figures**:

- **Annual eligible volume**: the annualized volume, into the project's assumptions.
- **Cycle time**: the median cycle time, into the chosen scenario. The log must use the project's time basis.
- **Human touch effort**: the average start to end time per case of the steps in people lanes, into the chosen scenario. It is elapsed time per step, so it can include interruptions; treat it as an upper bound on effort.

Nothing in the value model changes until you copy a figure, and Undo reverses a copy.

## Limits and care points

- Matching decides what is measured. Check the Match activities step, and the events not matched, before relying on the figures.
- Equal timestamps keep their order in the file, so work done in parallel may appear as a sequence.
- A log covers one period. Volumes, mix and staffing change; compare like with like when you compare a baseline with an after log.
- Figures from fewer than 30 cases, or statistics from fewer than 5 values, are indications.
- The import runs in the browser, in chunks. Large logs take a few seconds.

## For developers

The import lives in `webui/js/lib/csv.js` (reading), `webui/js/lib/fuzzy.js` (name matching), `webui/js/lib/mining.js` (timestamps, aggregation, scenarios, lenses and the store commands) and `webui/js/ui/log-import.js` (the wizard, the Event logs tab and the other views, registered through `AIxRay.ext`; see [extensions.md](extensions.md)). The store commands are `dataset/import { dataset, scenarios }` and `dataset/applyToValueModel { datasetId, annualVolume, scenarioId, cycleTime, humanTouch }`. The dataset contract is in `webui/schema/engagement.schema.json`. Test logs are in `tests/fixtures/logs/`.
