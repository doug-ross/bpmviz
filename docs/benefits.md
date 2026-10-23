# Benefits tracking

Once a project has an event log from before a change and another event log from after it, the Benefits section in the Value tab compares the two: what each measured step actually took, and whether an opportunity's modeled business case was borne out. It never reports a figure as "savings realized". A measured change is just that, a change the two logs recorded, and it can be confounded by seasonality, a different volume mix, or a change in how activities were matched between the two periods. The section lists those caveats in the notes under every comparison.

Many clients have no clean event log. For them, the delivery team records **checkpoints** by hand: what the change achieved at 30, 60 or 90 days, or any other date. The same section compares each checkpoint with the opportunity's business case. See [Checkpoints recorded by hand](#checkpoints-recorded-by-hand).

This page is for someone reading the section, and for a developer extending it. Importing an event log itself is a separate feature (see `docs/event-logs.md`).

## Recording a comparison

The Benefits section appears once the project has an event log, an opportunity with a business case, or a checkpoint. With two or more logs, it shows a small form, **Record a comparison**: choose the **Event log after the change** and the **Baseline log** it compares to, and choose **Record this comparison**. This sets the "after" log's role to **After the change** and its comparison to the baseline you chose, through the same `dataset/update` command the event log list itself uses, so it is undoable and keeps the project's history.

A comparison already recorded (an "after" log with its comparison set) shows automatically, with a **Remove this comparison** button that clears the link without deleting either event log.

## Reading a comparison

Each comparison shows:

- **Overall figures**: the measurement period, the number of cases in each log, the annualized volume, and the median cycle time, before and after, with the percent change.
- **Step by step**: for every step the two logs both measure, the median duration, the median time since the previous event (sojourn), the rework rate, the share of cases that visited it, and the visits per case, before and after. A step only one log measures, or that the matching does not carry across, is listed separately as not matched rather than guessed at.
- **Notes**: plain-language caveats when the two measurement periods are a different length, case volume differs by more than a fifth, steps could not be matched, a step rests on fewer than 30 visits in either log, or either log is demonstration data.

Steps correspond between the two logs through the model's own lineage (the same mechanism that links a future-state draft back to its baseline), not by matching names, so a step renamed between the baseline and the future state still lines up correctly. Two logs mapped to the very same model, the common case before a future state exists, correspond to themselves.

## Expected versus measured change

When an opportunity has a business case (see `docs/business-case.md`) whose affected steps overlap the comparison's model, the section adds a row under **Expected versus measured change**: the **Expected (modeled)** figure that opportunity's business case predicts, the **Measured change** the two event logs actually show on those steps, and a status:

| Status | Meaning |
|---|---|
| Met | The measured change is at least 80% of the modeled figure. |
| Partially met | Between 20% and 80%. |
| Not yet | Under 20%. |
| Worse | The measured change moved the wrong way; affected steps took longer or were visited more, not less. |
| Not measurable | The business case or the two logs do not have what is needed to compare: a missing input, steps outside the compared model, or no measured duration for them in one of the logs. |

Both figures are human hours saved per year, never money. The modeled figure uses the opportunity's declared inputs, in full, exactly as the Value tab computes them. The measured figure comes only from what the two logs recorded: for each affected step, the median duration times the visits per case times the share of cases that reach it, in the baseline log minus the same in the after log, scaled to the annual volume the business case itself uses (or the after log's annualized volume when the business case has none, with a note). Using the same volume on both sides means the two figures differ only by what the logs measured. A step that no case reaches in the after log counts as no time when the after log still matches activities to it, or the after model removed it; otherwise it is reported as not measured. The measured figure carries the weaker status of the two logs, so demonstration data shows as illustrative. Keeping both figures in hours, and never converting the measured one to money, keeps the comparison about what an event log can and cannot show; a financial case still needs the hourly rate and running-cost assumptions in the Value tab.

## The measured-change lens

With a baseline and an after log recorded for the model on screen, the Process tab's Lens picker offers **Measured change**: a diagnostic overlay that marks each measured step faster, slower or about the same (a 5% move either way), from the same comparison the Benefits section shows. It is read-only and does not affect any figure elsewhere.

## The notes, in full

- **Short or mismatched periods.** A comparison spanning a different number of days on each side can reflect the calendar as much as the change: a holiday week, a different quarter, a partial month.
- **Volume mix.** A step's share of cases, or the overall case volume, moving by more than a fifth between the two logs is a sign the mix of work changed, not only its speed.
- **Matching drift.** If an activity was renamed, merged, or matched to a different step after the change, a step can show as "not matched" even though the same work still happens somewhere in the after log.
- **Small samples.** A step with fewer than 30 visits in either log carries a lot of noise; its percent change is reported, but it should not carry a business case on its own.
- **Different time bases.** Two logs imported with different time bases (calendar time in one, business time in the other, or a different working day) cannot be compared step by step; the comparison says so and the measured figure is left out.
- **Demonstration data.** Figures built from demonstration data describe the shape of the measurement, not a real result.

## Checkpoints recorded by hand

Under **Results at checkpoints**, choose an opportunity with a business case and **Add a checkpoint**. Record:

- **Checkpoint**: 30 days, 60 days, 90 days, or a name of your own, and the date.
- **Hands-on hours per affected case after the change**: measured by the delivery team or the client, for example from a time study of a sample of cases. The form shows the business case's own figure before the change, for comparison.
- **Share of cases affected** and **Cases per year**: optional. Leave them blank to use the business case's figures.
- **Cycle time after** and **Actual one-time cost**: optional, for the record.
- **Basis**: Provided, Measured or Confirmed, and the **Source** of the figure.

AIxRay works out the result with the business case's own formula:

- **Realized human hours saved per year** = annual volume x share of cases affected x (hours per affected case before - hours per affected case after). The hours before are the business case's hours per affected case.
- **Realized net annual benefit** = realized hours saved per year x hourly rate - annual running cost. Like the modeled figure, this is the value of freed time, not cash, unless the freed time is used or the cost is removed.
- **Status** compares the realized hours with the modeled hours saved per year, with the same thresholds as the event-log comparison: Met at 80% or more, Partially met from 20%, Not yet below that, and Worse when the hours went up.
- **Basis** is the weakest among the inputs, so a checkpoint measured against an illustrative "before" figure is illustrative too.

The notes under each checkpoint say when the hours before are only illustrative, when no hourly rate is set, and when the checkpoint uses a different share of cases or volume than the business case.

Checkpoints appear in the report under Benefits measured, on the opportunity's one-page business case, and on a **Results at checkpoints** slide in the deck. Sensitive opportunities and unreviewed AI drafts stay out unless included. Deleting an opportunity deletes its checkpoints; Undo restores both.

## Sample data

`node tools/make-sample-logs.mjs` writes `docs/samples/underwriting-baseline.csv` and `docs/samples/underwriting-after.csv`: two demonstration event logs, columns `case, activity, start, end, resource`, generated by a seeded random walk of the bundled underwriting-current-state example's own process graph, with every step placed in working hours (Monday to Friday, 9:00 to 17:00 UTC) so that durations read correctly in the example's business time basis. Each gateway is weighted with the same share of cases the test fixtures in `tests/fixtures/datasets/` record for it, and the after log reflects a plausible improvement on three steps (scrubbing the SOV and geocoding it, the appetite and capacity triage, and technical pricing and rating), with every other step unchanged. Running the script again writes byte-identical files; it is demonstration data, not from a real project, meant for trying the event log import wizard and for screenshots.

## For developers

`lib/benefits.js` is read-only: it never writes to the engagement.

- `compareDatasets(e, baselineId, afterId)` returns `{ baseline, after, overall, steps, unmatched, caveats }`. `baseline` and `after` are `{ id, name, dataStatus, modelId }` or null when that dataset is no longer in the engagement. `overall` is null when either dataset is missing; otherwise `{ cases, annualizedVolume, period, cycleTime }`, each `{ before, after }`. `steps` is the per-step comparison described above, each entry `{ nodeId, afterNodeId, label, duration, sojourn, reworkRate, caseShare, visitsPerCase, smallSample }`, with `duration` and `sojourn` as `{ before, after }` of the dataset's own Stats objects (or null) and the rest as `{ before, after }` numbers. `unmatched` lists `{ nodeId, label, side }` for a step on one side with no corresponding step on the other, through model lineage.
- `expectedVsRealized(e, baselineId, afterId)` returns one row per opportunity record with a value case: `{ recordId, title, expected, realized, ratio, status, notes }`. `expected` and `realized` are `{ value, unit: "hour", basis, label }` or null; `ratio` is `realized.value / expected.value` or null; `notes` explains anything left out of the figures.
- `observedChangeLens(ctx)` is a plain function with the shape `AIxRay.lenses.registerLens`'s `compute` expects (`ctx` is `{ model, engagement, ... }`); `ui/benefits-view.js` registers it as the lens `observed-change`. It has no data, with a note saying why, when the model has no baseline log or no after log compared to it.

- `expectedVsCheckpoints(e, opts)` returns one row per opportunity with checkpoints: `{ recordId, title, expected, notes, checkpoints }`, each checkpoint `{ id, label, date, realized, realizedMoney, outputs, ratio, status, basis, source, note, cycleTimeAfterMinutes, oneTimeCostActual, notes }`. `outputs` are the two figures above in the economics output shape, with their formula and inputs. `opts` is `{ scenarioId, includeSensitive, includeUnreviewedAi }`.

`ui/benefits-view.js` registers the value section `benefits` (`AIxRay.ext.registerValueSection`), a Benefits measured section in the report after `value` (`AIxRay.ext.registerHandoffSection`), and the lens above. It renders nothing when the project has no event log, business case or checkpoint, so a project that never used the feature sees no empty card for it. Linking two datasets goes through the foundation's `dataset/update` command (`{ patch: { role: "after", comparesToDatasetId } }`). Checkpoints live in the optional `engagement.checkpoints` list; `lib/checkpoints.js` holds their sanitizer and the commands `checkpoint/save` and `checkpoint/delete`, which the store adds to its own commands.
