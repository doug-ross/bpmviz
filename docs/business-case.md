# The business case

Every opportunity can carry a business case: the inputs that turn a type of change into a modeled annual figure, a place in a ranked matrix, a wave of delivery, and a one-page business case you can print or hand to a sponsor.

This feature adds no new figures of its own. It reads `lib/value-case.js`, which the foundation built and this feature now owns, and presents the same computed outputs everywhere: in the opportunity dialog, the Opportunities list, the Matrix and Waves views, the Business case mode in Present, and the report.

## The business case editor

Open an opportunity and its dialog shows a **Business case** section underneath the usual opportunity fields:

- **Effort comes from**: **Touch effort on each step** (the step's typed touch effort or typical duration), or **Measured step time from an event log**, the measured median duration (needs an event log recorded against the project).
- **Share of cases comes from**: **Entered by hand** as a percentage, or **From an event log**, the share of cases that visit the linked steps.
- **Event log**: which event log provides the measured figures, shown only when it is needed.
- **Effort reduction (%)** and **Duration reduction (%)**: percentages. Effort reduction drives the money and time freed up figures; duration reduction drives elapsed time saved, which is never priced.
- **One-time cost** and **annual running cost**: the running cost is optional and only lowers the net annual benefit when it is recorded.
- **Confidence**: low, medium or high. It discounts the ranking score, not the modeled figures themselves.
- **Basis**: illustrative, provided, measured or confirmed, for the figures you typed by hand. A figure read from an event log or a confirmed step carries its own basis regardless of this setting; the result always shows the weakest basis among its inputs.
- **Wave**: now, next or later. The Matrix and Waves views suggest a wave; this is your decision, not something AIxRay sets.

As you fill in the effort and duration fields, a line under the form estimates the opportunity's annual value right away, using the same formula the Opportunities list and the business case pages use. Leaving a field blank keeps the result blank rather than treating it as zero.

## Formulas

All figures are economics-shaped outputs: each one lists its formula, its inputs and the weakest status among them, and a missing required input leaves the result blank.

- **Human hours per affected case** = sum over the affected steps of (typed touch effort in hours, or the measured median duration) times visits per affected case. Visits default to one when no event log provides them, and that assumption is noted. When the share of cases affected also comes from the event log, a step's visits are weighted by the fraction of the affected cases that reach that step, so a step only some of them visit is not charged to every affected case. When the share is typed by hand, the event log cannot say which affected cases reach which step, so visits assume every affected case visits every linked step, and that assumption is noted too. Gateways and events among the linked steps are not counted as work.
- **Human hours saved per year** = annual volume times share of cases affected times human hours per affected case times effort reduction. Annual volume comes from the project's assumptions, or from the event log's annualized period when no assumption is set.
- **Labor cost of the hours saved per year** = human hours saved per year times the hourly rate.
- **Modeled net annual benefit** = labor cost of the hours saved per year minus the annual running cost (zero, noted, when not recorded). This is a modeled benefit, not realized cash: adoption and ramp-up are not included.
- **Time freed up (FTE-equivalent)** = human hours saved per year divided by productive hours per FTE. This is time people can spend on other work, not a headcount reduction.
- **Simple payback period** = one-time cost divided by (modeled net annual benefit divided by 12), shown only when the net annual benefit is positive.
- **Elapsed time saved per affected case** = sum of the affected steps' durations times duration reduction, in minutes. This is time only; it is never converted to money.

## Other kinds of value, and how value becomes money

Labor hours are one kind of value. Under **Other kinds of value** in the editor, add a value line for each other kind, worked out with its own formula: **Errors and rework**, **SLA penalties avoided**, **Hires avoided** and **Licenses and vendor fees**. Each line has its inputs, a basis and a note.

Every part of the business case, the labor estimate included, also records how it becomes money: the **share that can be realized**, **how it becomes money** in words (such as overtime cut, planned hires not made, or seats dropped at renewal), the **finance owner**, and the **amount Finance confirmed per year** with where it comes from. When an opportunity uses any of this, its business case shows three figures:

- **Gross annual value** = labor cost of the hours saved + every value line. A hires-avoided line is how the labor hours are realized, so when there is one, the labor cost is shown for reference and not counted again. If more hires are avoided than the labor estimate frees up, the case says so.
- **Modeled net annual benefit** = gross annual value minus the annual running cost.
- **Realizable annual value** = the sum of each part's gross value times its realizable share, minus the annual running cost. It stays blank until every part has a realizable share, and that does not make the business case incomplete.
- **Validated annual value** = the sum of the amounts Finance confirmed, with how many parts are confirmed. Its basis is confirmed.

An opportunity is ranked on its realizable annual value when it has one, otherwise on its modeled net annual benefit. Payback uses the realizable value when there is one. Opportunities without value lines or realization fields compute exactly as described above. The CFO one-pager lists each part under **Value by type**. The design, and the dimensions still to come, are in [value-dimensions.md](value-dimensions.md).

## Ranking, the Matrix and Waves views

Every opportunity with an effort size is scored:

```
score = headline value x confidence factor (low 0.5, medium 0.75, high 1; not set counts as low) / effort (S 1, M 2, L 3)
```

The headline value is the modeled net annual benefit when it is calculated, otherwise the human hours saved per year. Opportunities priced in money rank ahead of opportunities scored only in hours, which rank ahead of opportunities that cannot be scored yet (no effort size, or no business case).

Each opportunity's value is compared with the median value among opportunities that share its unit (money, or hours), which places it in one of four quadrants:

| | Low effort (S or M) | High effort (L) |
| --- | --- | --- |
| At or above the median value | Quick win (suggested wave: now) | Major project (suggested wave: next) |
| Below the median value | Fill-in (suggested wave: later) | Reconsider (suggested wave: later) |

The **Matrix** opportunity view charts the scored opportunities into these four quadrants and lists every opportunity, scored or not, in an equivalent table with its rank, effort, value, basis, quadrant, suggested wave and actual wave.

The **Waves** opportunity view lays opportunities out in columns by wave, with each opportunity's wave changed through a "Move to" select, so moving an opportunity needs no dragging. Each wave column totals its modeled net annual benefit, and a note names any step that two opportunities in the same wave both change, since their savings may be double-counted.

## Business cases drafted with AI

The **Suggest findings** AI task can also draft the figures of a business case: share of cases affected, effort reduction, duration reduction, one-time cost and annual running cost. It drafts them for the opportunities it suggests and for opportunities already in the project that have no business case yet. It works only from figures in the project (assumptions, step efforts, findings and source facts) and gives a source for each figure. A figure without a source, or out of range, is left blank. See `docs/ai.md`.

- A drafted business case is marked **AI draft, not reviewed**. Its figures have a dashed outline in the editor, and each one shows the source the AI gave.
- Its basis is Illustrative, and its figures stay out of the ranking, the Matrix, the wave totals, the deck, the CFO one-pager and the report until someone reviews them. Turning on **Include unreviewed AI drafts** in an export or the Present view shows them, labeled as drafts.
- To review one, check each figure against its source, then clear the **AI draft, not reviewed** tick in the editor and save. The figures and their sources stay; the business case is now yours.
- A business case a person entered is never replaced by an AI draft. The review lists such a proposal as one that cannot be applied.

## The CFO one-pager

The **Business case** mode in Present is printable. It opens on the All opportunities page: the client's value goals and the opportunities that serve each one (see `docs/goals.md`), then every ranked opportunity, with the wave totals (net annual benefit, one-time cost and time freed up) for now, next and later. The **Show** select above the page switches to a single opportunity's one-page business case: its headline figures, the value goals it serves, its results at checkpoints after the change (see `docs/benefits.md`), affected steps, note and any inputs still missing. The report carries a shorter version of the same table, Opportunity value and waves, after the Opportunities section, built from only the opportunities kept in the report, so a reader who never opens the Business case mode still sees the modeled value and the wave plan.

Because the total adds every planned wave together, two opportunities that change the same step in different waves would otherwise double-count that step's savings with no warning. The All opportunities page and the report both name any step changed by opportunities planned in more than one wave, in a note under the totals.

## The opportunity/setWaves command

Moving an opportunity's wave, from the Waves view or by hand, dispatches:

```
opportunity/setWaves { changes: [{ id, wave }] }
```

`wave` is `""`, `now`, `next` or `later`. The command is undoable like any other store command. `id` must name an opportunity in the project; an unknown id or an unknown wave is rejected and nothing is changed.

## Files

| File | Holds |
| --- | --- |
| `webui/js/lib/value-lines.js` | The value line templates, their clean-up and each line's gross value |
| `webui/js/lib/value-case.js` | `compute`, `rank` and `portfolio`: the formulas above (owned by this feature; its function signatures are frozen for the other features that read it) |
| `webui/js/lib/business-case.js` | `buildOnePager`, `buildPortfolioPager` and `suggestWave`, which shape `value-case.js`'s output for the UI, and the `opportunity/setWaves` command body |
| `webui/js/ui/opportunity-value.js` | The business case editor, the opportunity columns, the Matrix and Waves views, the Business case mode in Present and the report section |
| `webui/css/business-case.css` | Styles for the quadrant chart and the wave board |

See `docs/extensions.md` for the registries this feature uses (`AIxRay.ext` and `AIxRay.store.registerCommands`) and how they fit the rest of the app.
