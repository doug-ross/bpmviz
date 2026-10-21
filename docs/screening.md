# Screening processes

A screening compares several candidate processes against the same criteria, so you can choose which one to work on first. It is its own file, `<name>.screening.json`, separate from any project: each project holds one process with its own assumptions and figures, and a screening sits above them.

Choose **Screen processes** on the start screen or in More actions. The screening opens in its own window over the app and never changes the open project. Close the window and it stays in the browser tab until the page reloads; save it to keep it.

## Candidates

Add each process you are choosing between:

- **Add a process** types one in. A few minutes per process is enough for a first screening.
- **Add from a project file** reads an AIxRay project and copies in its process name, confidentiality, cases per year and hourly rate from the project's assumptions, the number of steps, and the top opportunity by modeled value. Hands-on hours per case are copied only when every step of the current state has a touch effort, so a partial total never looks complete. Opportunities marked sensitive and unreviewed AI drafts are left out. The project itself is not stored in the screening.
- **Add the open project** does the same for the project open in the app.

Adding the same project again updates the copied figures and keeps the name, scores and notes.

Score each process in the table from 1 (worst) to 5 (best) for every criterion. Select a process name to see what 1, 3 and 5 mean for each criterion, record the basis of each score (illustrative, provided, measured or confirmed) with a note, and enter its yearly figures: cases per year, hands-on hours per case and the hourly rate. A process without its own rate uses the screening's rate from **Details**.

A process marked sensitive is left out of the ranking and the summary unless you tick to include it.

## Criteria

The screening starts with ten criteria in three groups. Every criterion is worded so that a higher score is better.

| Group | Criterion | Weight |
| --- | --- | --- |
| Value | Volume and effort | 3 |
| Value | Pain today | 2 |
| Value | Fit with the client's priorities | 1 |
| Feasibility | Clear rules or patterns | 2 |
| Feasibility | Usable inputs | 2 |
| Feasibility | Access to the systems | 1 |
| Feasibility | Few exceptions | 1 |
| Readiness and risk | Sponsor and process experts (flags a score of 1) | 2 |
| Readiness and risk | Low risk if it goes wrong | 2 |
| Readiness and risk | A baseline can be measured | 1 |

In the Criteria tab you can rename criteria, move them between groups, change weights from 0 to 10, add and remove criteria, and set a flag. A weight of 0 keeps a criterion visible without counting it. A flag marks any process scored at or below the level you set; the process stays in the ranking with the flag next to it. Removing a criterion removes the scores given against it, and Undo brings them back.

## How the ranking works

- **Score** is the weighted mean of a process's scores on a scale of 0 to 100, where a 1 counts as 0 and a 5 as 100.
- **Value** uses the value criteria only. **Ease** uses the feasibility and readiness criteria together.
- A missing score leaves the score blank, never zero. A process that is not fully scored ranks after the fully scored ones, on a provisional score over the criteria it has.
- **Where it falls** places a fully scored process in one of four quadrants, with 50 as the line on both axes: Start here (high value, high ease), Worth it, harder to start (high value, low ease), Easy, smaller value, and Not now.
- **Hands-on hours a year** is cases per year times hands-on hours per case. **Labor cost a year** multiplies that by the hourly rate. These describe today's effort, not savings, and stay blank when a figure is missing.
- **Basis** is the weakest basis among a process's scores.
- **Does the first choice hold?** moves each weight 20 percent up and then down, one at a time, and reports any change that would put another process first. When two processes share the best score, the screening says they are tied instead of naming a first choice.

The figures in `lib/screening.js` follow the same rules as the rest of AIxRay: an unknown is never zero, and every result carries the weakest basis of its inputs.

## Summary and next step

The **Summary** tab is a one-page summary of the recommendation, the chart, the ranking, the criteria with their weights and how to read it. **Print or save as PDF** prints it on its own, without the app around it.

**Start a project** on a ranked process, or **Start a project for it** under the first choice, creates a new project with the process name, the client, the confidentiality and data status, and the cases per year and hourly rate as assumptions, then opens the process builder. The process itself starts blank, as **Build a process** does. If the process came from a project file, open that file instead to keep working on it.

## The file

A screening file has the schema tag `aixray.screening`, version 1. The format is published in `webui/schema/screening.schema.json` and enforced by `parseScreening` in `webui/js/lib/screening.js`. Opening a file keeps only known fields within their limits (50 candidates, 30 criteria), drops scores for criteria that are not in the file, and says what it left out. A file saved by a newer version is refused, and the screening already open stays as it was.

## Files

| File | Holds |
| --- | --- |
| `webui/js/lib/screening.js` | The file format, changes, scoring, the stability check, the summary and the starter project |
| `webui/js/ui/screening.js` | The screening window, its tabs, printing and Start a project |
| `webui/css/screening.css` | Styles for the window and the printed summary |
| `tests/unit/screening.test.mjs`, `tests/browser/screening.test.mjs` | Unit and browser tests |
