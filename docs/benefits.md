# Benefits tracking

Once an engagement has an event log from before a change and another event log from after it, the Benefits section in the Value workspace compares the two: what each measured step actually took, and whether an opportunity's modeled value case was borne out. It never reports a figure as "savings realized". A measured change is just that, a change the two logs recorded, and it can be confounded by seasonality, a different volume mix, or a mapping that drifted between the two periods. The section lists those caveats next to every comparison.

This page is for a consultant reading the section, and for a developer extending it. Importing an event log itself is a separate feature (see `docs/event-logs.md` once it exists); this page assumes two event-log datasets are already in the engagement.

## Recording a comparison

The Benefits section appears once the engagement has at least one event-log dataset. With two or more datasets, it shows a small form: choose the event log taken after the change and the baseline it compares to, and record the comparison. This sets the "after" log's role to **After the change** and its comparison to the baseline you chose, through the same `dataset/update` command the dataset list itself uses, so it is undoable and keeps the engagement's history.

A comparison already recorded (an "after" dataset with its comparison set) shows automatically, with a **Remove this comparison** button that clears the link without deleting either event log.

## Reading a comparison

Each comparison shows:

- **Overall figures**: the measurement period, the number of cases in each log, the annualized volume, and the median cycle time, before and after, with the percent change.
- **Step by step**: for every step the two logs both measure, the median duration, the median time the step sat open (sojourn), the rework rate, the share of cases that visited it, and the visits per case, before and after. A step only one log measures, or that the mapping does not carry across, is listed separately as not matched rather than guessed at.
- **Caveats**: plain-language notes when the two measurement periods are a different length, case volume differs by more than a fifth, steps could not be matched, a step rests on fewer than 30 visits in either log, or either log is demonstration data.

Steps correspond between the two logs through the model's own lineage (the same mechanism that links a future-state draft back to its baseline), not by matching names, so a step renamed between the baseline and the future state still lines up correctly. Two logs mapped to the very same model, the common case before a future state exists, correspond to themselves.

## Expected versus measured change

When an opportunity record has a value case (see `docs/business-case.md` once it exists) whose affected steps overlap the comparison's model, the section adds a row: the **modeled** figure that opportunity's value case predicts, the **measured** figure the two event logs actually show on those steps, and a status:

| Status | Meaning |
|---|---|
| Met | The measured change is at least 80% of the modeled figure. |
| Partially met | Between 20% and 80%. |
| Not yet | Under 20%. |
| Worse | The measured change moved the wrong way; affected steps took longer or were visited more, not less. |
| Not measurable | The value case or the two logs do not have what is needed to compare: a missing input, steps outside the compared model, or no measured duration for them in one of the logs. |

Both figures are human hours saved per year, never money. The modeled figure uses the opportunity's declared inputs, in full, exactly as the Value workspace computes them. The measured figure comes only from what the two logs recorded: the change in each affected step's median duration and visits per case, scaled by the share of cases the after log shows touching those steps and the after log's own annualized volume. Keeping both figures in hours, and never converting the measured one to money, keeps the comparison honest about what an event log can and cannot show; a financial case still needs the hourly rate and running-cost assumptions in the Value workspace.

## The observed-change lens

With a baseline and an after log recorded for the model on screen, the Process workspace's lens picker offers **Observed change**: a diagnostic overlay that marks each measured step faster, slower or about the same (a 5% move either way), from the same comparison the Benefits section shows. It is read-only and does not affect any figure elsewhere.

## Caveats, in full

- **Short or mismatched periods.** A comparison spanning a different number of days on each side can reflect the calendar as much as the change: a holiday week, a different quarter, a partial month.
- **Volume mix.** A step's share of cases, or the overall case volume, moving by more than a fifth between the two logs is a sign the mix of work changed, not only its speed.
- **Mapping drift.** If an activity was renamed, merged, or mapped to a different step after the change, a step can show as "not matched" even though the same work still happens somewhere in the after log.
- **Small samples.** A step with fewer than 30 visits in either log carries a lot of noise; its percent change is reported, but it should not carry a business case on its own.
- **Demonstration data.** Figures built from demonstration data describe the shape of the measurement, not a real result.

## Sample data

`node tools/make-sample-logs.mjs` writes `docs/samples/underwriting-baseline.csv` and `docs/samples/underwriting-after.csv`: two demonstration event logs, columns `case, activity, start, end, resource`, generated by a seeded random walk of the bundled underwriting-current-state example's own process graph. Each gateway is weighted with the same share of cases the test fixtures in `tests/fixtures/datasets/` record for it, and the after log reflects a plausible improvement on three steps (scrubbing the SOV and geocoding it, the appetite and capacity triage, and technical pricing and rating), with every other step unchanged. Running the script again writes byte-identical files; it is demonstration data, not from a real engagement, meant for trying the event-log import wizard once it exists and for screenshots.

## For developers

`lib/benefits.js` is read-only: it never writes to the engagement.

- `compareDatasets(e, baselineId, afterId)` returns `{ baseline, after, overall, steps, unmatched, caveats }`. `baseline` and `after` are `{ id, name, dataStatus, modelId }` or null when that dataset is no longer in the engagement. `overall` is null when either dataset is missing; otherwise `{ cases, annualizedVolume, period, cycleTime }`, each `{ before, after }`. `steps` is the per-step comparison described above, each entry `{ nodeId, afterNodeId, label, duration, sojourn, reworkRate, caseShare, visitsPerCase, smallSample }`, with `duration` and `sojourn` as `{ before, after }` of the dataset's own Stats objects (or null) and the rest as `{ before, after }` numbers. `unmatched` lists `{ nodeId, label, side }` for a step on one side with no corresponding step on the other, through model lineage.
- `expectedVsRealized(e, baselineId, afterId)` returns one row per opportunity record with a value case: `{ recordId, title, expected, realized, ratio, status, notes }`. `expected` and `realized` are `{ value, unit: "hour", basis, label }` or null; `ratio` is `realized.value / expected.value` or null; `notes` explains anything left out of the figures.
- `observedChangeLens(ctx)` is a plain function with the shape `BPMVIZ.lenses.registerLens`'s `compute` expects (`ctx` is `{ model, engagement, ... }`); `ui/benefits-view.js` registers it as the lens `observed-change`. It has no data, with a note saying why, when the model has no baseline log or no after log compared to it.

`ui/benefits-view.js` registers the value section `benefits` (`BPMVIZ.ext.registerValueSection`), a handoff section after `value` (`BPMVIZ.ext.registerHandoffSection`), and the lens above. It renders nothing when the engagement has no event-log datasets at all, so an engagement that never used the feature sees no empty card for it. Linking two datasets goes through the foundation's `dataset/update` command (`{ patch: { role: "after", comparesToDatasetId } }`); the feature adds no commands of its own.
