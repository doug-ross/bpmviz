# Extending AIxRay

This page is for people adding a feature to AIxRay. Features plug into the app through a small registry, `AIxRay.ext`, and through store commands they register themselves, so a feature lives in its own files and does not edit the shared views. The registry, the shared libraries and an empty module for every planned feature are already loaded by `webui/index.htm`.

## Who owns which files

The workshop workflows use four additional vertical slices. Their libraries load before their UI modules; `workshop.js` loads before validation and depends only on `util` and `schema`.

| Workflow | Library, UI and stylesheet | Store commands and extension points |
| --- | --- | --- |
| Process authoring | `process-builder.js`, `ui/process-builder.js`, `process-builder.css` | `builder/`, start action, import menu and compact drawer launchers |
| Walkthrough and scenarios | `walkthrough.js`, `ui/walkthrough.js`, `walkthrough.css` | `walkthrough/`, process drawer, scenario dialog and Present mode |
| Workshop and pilot closure | `workshop.js`, `ui/workshop.js`, `workshop.css` | `workshop/`, Findings subtab, step designs, printable Pilot brief and handoff |
| External assistants | `assistant-handoff.js`, `ui/assistant-handoff.js`, `assistant-handoff.css` | AI menu; packets use existing AI result schemas and the existing review flow |

`engagement.workshop` is optional and sanitized on open through `workshop.sanitizeWorkshop`. Its JSON Schema is exported as `WORKSHOP_SCHEMA` and included by `tools/build-schema.mjs`. The schema version remains 1. Agenda, designs and checkpoint references live there; routes remain standard scenarios. Saving a project preserves both.

Graph authoring uses `store.helpers.invalidateModelRuns` to discard obsolete runs and figures derived from authored routes while retaining independent supplied measures and event-log evidence. Undo restores the graph and its runs together. Proposal commands may carry `expectedRevision`; the store refuses them when that revision no longer matches. The AI review also checks the live project immediately before applying and requires explicit review when the result's original revision differs.

The client-value build adds five features in parallel. Each feature owns its files; the shared files are frozen while they are built.

| Feature | Owns |
| --- | --- |
| Shared (frozen) | `lib/schema.js`, `lib/validate.js`, `lib/store.js`, `lib/economics.js`, `lib/lenses.js`, `lib/zip.js`, `lib/ooxml.js`, `lib/xlsx.js`, `lib/dataset-query.js`, `ui/ext.js`, `ui/files.js`, `ui/diagram.js`, `ui/drawer.js`, `ui/forms.js`, `ui/process-view.js`, `ui/records-view.js`, `ui/value-view.js`, `ui/present-view.js`, `app.js`, `index.htm`, `tools/build-schema.mjs`, `webui/schema/*.json`, `tests/unit/helpers.mjs`, `tests/fixtures/datasets/*`, the foundation tests, this page, `package.json`, `tools/escape-ascii.mjs` |
| Event-log import (mining) | `lib/csv.js`, `lib/fuzzy.js`, `lib/mining.js`, `ui/log-import.js`, `css/mining.css`, `lib/ai-results.js` (fixes only), `ui/ai-panel.js`, `tools/ai/*.mjs`, `tools/prompts/ai-log-mapping.md`, the `aixray-log-mapping` skills, `tests/fixtures/logs/*`, `tests/fixtures/ai/*`, `docs/event-logs.md`, `docs/ai.md` |
| Value case and business case (value) | `lib/value-case.js` (function signatures frozen), `lib/business-case.js`, `ui/opportunity-value.js`, `css/business-case.css`, `docs/business-case.md` |
| Client review (review) | `lib/reviews.js`, `lib/review-pack.js`, `ui/client-review.js`, `css/client-review.css`, `tests/fixtures/reviews/*`, `docs/client-review.md` |
| Exports for client tools (exports) | `lib/pptx.js`, `lib/bpmn-export.js`, `lib/backlog.js`, `ui/client-exports.js`, `css/client-exports.css`, `docs/exports.md` |
| Benefits tracking (benefits) | `lib/benefits.js`, `ui/benefits-view.js`, `css/benefits.css`, `tools/make-sample-logs.mjs`, `docs/samples/*`, `docs/benefits.md` |

Each feature also owns new test files named `tests/unit/<feature>*.test.mjs` and `tests/browser/<feature>*.test.mjs`. `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/AUDIT_TRACKER.md`, `tools/screenshots.mjs` and `docs/screenshots/*` change only when the features are integrated.

When a feature needs a change to a frozen file, record it as a contract change request and work around it in the feature's own files until the change is made.

## Rules that apply to every feature

- Files under `webui/js/lib/` load as browser scripts and as Node modules (the same wrapper as the existing files). They have no DOM or network access. Compression is passed in: the browser passes `AIxRay.files.inflateRaw` and `deflateRaw`; Node tests pass `node:zlib`.
- JavaScript sources are ASCII only. After editing, run `npm run fix:ascii`, which rewrites any other character as a `\u` escape in `.js`, `.mjs` and `.cjs` files under `webui/js`, `tools` and `tests`.
- Engagement data is shown with `textContent` (the `h()` helper does this). Never assign it to `innerHTML`.
- The app opened from disk makes no network requests.
- All new data is optional. `schemaVersion` stays 1, and an older build drops unknown fields with its "Ignored N fields" note.
- Client-visible text has no em dashes and no filler words; `npm run check` enforces this.

## Load order

`index.htm` loads, in order: the bundled examples, the core libraries, then `zip`, `ooxml`, `xlsx`, `dataset-query`, `value-case`, `csv`, `fuzzy`, `mining`, `business-case`, `reviews`, `review-pack`, `pptx`, `bpmn-export`, `backlog`, `benefits`; then the interface files with `ext.js` and `files.js` right after `dialogs.js`; then the feature files `log-import.js`, `opportunity-value.js`, `client-review.js`, `client-exports.js`, `benefits-view.js`; and `app.js` last. The stylesheets `mining.css`, `business-case.css`, `client-review.css`, `client-exports.css` and `benefits.css` load after `app.css`.

A feature's interface file runs before `app.js` starts the app, so it registers at load time. The views read the registry each time they render, so registering later also works.

## The registry: AIxRay.ext

Every registration is an object with an `id` (letters, digits, `-` and `_`) and an optional `order` (lower first; ties keep the order of registration). A duplicate `id` within one kind throws, and so does an `id` the app uses itself. `AIxRay.ext.list(kind)` returns the registrations of a kind in order.

Callbacks run inside a guard: if one throws, the error is logged to the console and the rest of the view still renders. Browser tests fail on console errors, so a broken callback shows up in tests.

Most callbacks receive the common context:

```
{ app, engagement, dispatch(type, payload, message, errorElement), includeSensitive, includeUnreviewedAi, scenarioId, rerender() }
```

| Function | Shape | Where it appears |
| --- | --- | --- |
| `registerMenuItem` | `{ id, order, icon, label, group, needsEngagement, run(app) }`; `group` is `import`, `export` or `ai` | The More actions menu, button `menu-<id>`: `import` after "Import a BPMN file", `export` after "Save a copy", `ai` after "Draft with AI" |
| `registerStartAction` | `{ id, order, icon, label, run(app) }` | The start screen after the built-in buttons ("Import a BPMN file", or "Create from documents with AI" when the AI helper runs), button `start-<id>` |
| `registerFileHandler` | `{ id, order, extensions, maxBytes, priority, probe(bytes, name), open(app, file, bytes) }` | `app.openFile`: handlers for the file's extension run before the 10 MB text read, highest `priority` first; a handler whose `probe` resolves false is skipped. `maxBytes` defaults to 10 MB. The extensions join the file picker's accept list |
| `registerJsonHandler` | `{ id, order, schema, open(app, data, { fileName }) }` | `app.openFile`, after `JSON.parse`, for files whose `schema` field matches, before the AI result check |
| `registerRecordsTab` | `{ id, order, label, count(engagement), render(panel, ctx) }` | Findings tab, sub-tab `rv-tab-<id>` before To check. Add finding, Export to CSV and Suggest findings with AI are hidden on it |
| `registerOpportunityView` | `{ id, order, label, render(host, ctx) }`; `ctx.records` holds the filtered opportunities | A List / view switcher (`rv-oppview-<id>`) above the list in Findings, Opportunities |
| `registerOpportunityColumn` | `{ id, order, header, after, cell(record, ctx) }` | A column in the Opportunities list after the column headed `after` (or at the end) |
| `registerRecordDialogSection` | `{ id, order, kinds, render(record, ctx) }` returning `{ el, collect(), check() }` | Inside the Opportunity fieldset of the finding dialog (Add a finding, Edit finding). `check()` returns a message to block saving or null; `collect()` returns fields merged into `payload.opportunity`. `kinds` defaults to `["opportunity"]` |
| `registerValueSection` | `{ id, order, render(ctx) }`; `ctx.scenario` is the selected scenario or null | Value tab, after the "Do the provided figures add up?" card (also when there is no scenario). Return a `section.card` |
| `registerPresentMode` | `{ id, order, label, printable, render(content, ctx) }` | The Show as buttons in Present (`pr-mode-<id>`), after Present and Report. A printable mode is wrapped in `.handoff`, so Print or save as PDF prints it |
| `registerPresentAction` | `{ id, order, icon, label, run(app, ctx) }` | The Present bar before Save a copy, button `pr-action-<id>` |
| `registerHandoffSection` | `{ id, order, after, render(handoff, ctx) }`; `after` is `summary`, `scope`, `pain`, `opportunity`, `decision`, `action`, `question`, `value`, `evidence` or `end` | The report (Present, Report), after the named part; `evidence` is the Sources section. `handoff` is `exporting.buildHandoff` output |
| `registerDrawerSection` | `{ id, order, where, render(ctx, model, node) }`; `where` is `overview` or `step` | The process side panel: after the scorecard (overview, `node` is null) or after "Where this came from" on a step's Details tab |
| `registerStructuralEvent(typeOrPrefix)` | `"area/verb"` or `"area/"` | Store events that rebuild the process canvas. Pre-registered: `dataset/import`, `dataset/delete`, `review/apply` |
| `registerRefreshEvent(prefix)` | `"area/"` | Store events that refresh lenses, finding counts and the side panel. Pre-registered: `dataset/`, `review/`, `opportunity/` |

Other hooks:

- `AIxRay.lenses.registerLens({ id, label, compute(ctx) })` adds a lens. `compute` gets `{ model, replay, t, engagement, scenarioName }` and returns the lens result shape (`description`, `unit`, `population`, `coverage`, `nodes`, `edges`, `legend`, `notes`). A node entry with a `category` gets the class `lens-<category>`.
- `app.presentView.renderPng({ scale })` resolves `{ blob, width, height }` for the process panes in the Process tab, and rejects when the canvas has not been drawn yet.
- `app.openFile(file)`, `app.openPicker()`, `app.dispatch(...)`, `app.goto(workspace)` and `app.recordsView.setOpportunityView(id)` are available to features.

## Store commands

`AIxRay.store.registerCommands({ "area/verb"(draft, payload) { ... } })` adds commands. Each command changes the draft it is given and returns a small result; the store clones, increments the revision and keeps one undo step per dispatch. A name that already exists throws. Throw `StoreError` for problems the person can fix; its message is shown as is.

`AIxRay.store.helpers` has `findModel`, `findNode`, `editableModel`, `applyNodePatch`, `newRecord`, `cleanText`, `enumValue` and `StoreError`. Use the validator's sanitizers (below) to check incoming data inside a command.

Commands provided by the foundation:

- `dataset/update { id, patch: { name, role, comparesToDatasetId, dataStatus, notes } }`
- `dataset/delete { id, removeScenarios }`: clears references to the dataset; with `removeScenarios` the scenarios made from it are deleted too.
- `record/update` keeps `opportunity.wave` and `opportunity.valueCase`.
- `model/delete` detaches datasets and review packs from the deleted draft; `record/delete`, `evidence/delete` and `model/delete` remove review references that no longer resolve.

Reserved command names:

| Feature | Commands |
| --- | --- |
| mining | `dataset/import { dataset, scenarios }` (one undoable step, structural), `dataset/applyToValueModel { datasetId, annualVolume, scenarioId, cycleTime, humanTouch }` |
| value | `opportunity/setWaves { changes: [{ id, wave }] }` |
| review | `review/recordPack { pack }`, `review/apply { review, validations, questions, evidence }` |
| exports | none (exports do not change the engagement) |
| benefits | none; uses `dataset/update` to mark a dataset as after |

`log-mapping/proposals` is not a store command: it is what `aiResults.applyCommand` returns for a log-mapping result, for the import wizard to show.

## Data contract

The JSON Schemas in `webui/schema/` are generated by `node tools/build-schema.mjs` from `lib/schema.js` and `lib/ai-results.js`.

New enumerations (first value is the default): `datasetRole` (baseline, after), `logFormat` (csv, tsv, xlsx), `timestampMode` (single, start-end), `caseIdHandling` (hashed, sequence, original), `mappingMethod` (exact, fuzzy, ai, manual, ignored), `wave` ("", now, next, later), `confidence` ("", low, medium, high), `valueInputSource` (manual, dataset), `reviewVerdict` (confirm, dispute, unsure), `reviewFormat` (html, xlsx). `assumptionStatus` is now illustrative, supplied, observed, validated, and `aiTask` adds `log-mapping`. Limits are in `schema.LIMITS` (datasets 12, event logs 25 MB and 200,000 events, 500 activities for AI, review responses 2 MB, and others).

`engagement.datasets[]` holds aggregates of an event log, never events, case IDs or resource names:

```
{ id, name, role, comparesToDatasetId, modelId, dataStatus, createdAt,
  source: { fileName, format, sha256, rows, events, timestampMode, caseIds, resources, droppedRows, unmatchedEvents, excludedIncompleteCases },
  period: { start, end, days }, timeBasis: { calendar, businessMinutesPerDay, dayStartMinute },
  mapping: [{ activity, nodeId, method, events }],
  cases: { count, complete, arrivalsPerDay, annualizedVolume, cycleTime, eventsPerCase },
  steps: [{ nodeId, visits, cases, caseShare, reworkCases, reworkRate, duration, wait, sojourn, resources, handoffRate }],
  transitions: [{ fromNodeId, toNodeId, count, edgeIds }],
  variants: [{ id, nodeIds, cases, share, cycleTime }], otherVariants: { variants, cases },
  scenarioIds, notes }
```

Statistics are `{ n, mean, min, p10, p25, p50, p75, p90, max }` in minutes of the dataset's time basis. Shares are fractions from 0 to 1. A scenario made from a log has `observedFrom: { datasetId, variantId, caseLabel }`, and a measure may have status `observed`.

An opportunity record may have `opportunity.wave` and `opportunity.valueCase`:

```
{ modelId, nodeIds (empty means the linked steps), effortReductionPct, durationReductionPct, shareOfCasesPct,
  shareSource, effortSource ("node" or "dataset"), datasetId, oneTimeCost, annualRunningCost, confidence, basis, note }
```

Reviews refer to items as `step/<modelId>/<nodeId>` or `record/<recordId>`. `engagement.reviewPacks[]` and `engagement.reviews[]` follow `webui/schema/engagement.schema.json`; a client's answers come back as a review response file (`schema: "aixray.review-response"`, `webui/schema/review-response.schema.json`).

The validator copies known fields only. A reference that does not resolve (a step, connector, dataset, scenario, pack, evidence item or reviewed item) is removed with a `ref.dangling` warning, and a missing model becomes null. These functions in `lib/validate.js` check one object against an engagement and return `{ value, errors, warnings }`: `sanitizeDataset(raw, e)`, `sanitizeValueCase(raw, e, record)`, `sanitizeScenarioFor(raw, e)`, `sanitizeReviewPack(raw, e)`, `sanitizeReview(raw, e)`. `validateReviewResponse(data, e)` returns `{ ok, errors, warnings, response }` and refuses a response made for another engagement. `parseItemRef(ref)` splits an item reference.

## Shared libraries

- `lib/zip.js`: `crc32`, `writeZip(entries)` (stored), `writeZipAsync(entries, { deflateRaw })`, `openZipAsync(bytes, { inflateRaw, limits })` giving `{ names, read(name), readText(name) }`. Same limits as `tools/ai/zip.mjs`; no ZIP64.
- `lib/ooxml.js`: `escapeXml` (also removes characters XML cannot hold), `contentTypes`, `rels`, `coreProps`, `appProps`, and the namespace and relationship constants.
- `lib/xlsx.js`: `writeWorkbook({ sheets: [{ name, rows, columns, hidden, freeze, validations, headerRows }], props })` returns the parts for `zip`; every text cell is an inline string, so no cell can be a formula. `workbookBytesAsync(spec, { deflateRaw })` gives the file. `readWorkbookAsync(bytes, { inflateRaw })` gives `{ sheets: [{ name, hidden, rows }], date1904 }`, reading shared strings, inline strings, rich text and cached values and ignoring formulas; a date-formatted number comes back as `{ date: serial }`, and `excelSerialToMs(serial, date1904)` converts it, reading wall-clock time as UTC.
- `lib/dataset-query.js`: `list`, `get`, `forModel(e, modelId, role)`, `basisOf(dataset)` (observed gives observed, supplied gives supplied, demonstration gives illustrative), `step`, `visitsPerCase`, `annualVolume`, `caseShareForNodes(dataset, nodeIds)` giving `{ value, lower, upper, exact }`, `correspondence(e, fromModelId, toModelId)` through lineage in both directions, `smallSample(stats, min)`.
- `lib/value-case.js`: `compute(e, record, opts)`, `rank(e, opts)` and `portfolio(e, opts)`, with the business-case formulas. Outputs have the shape of `economics.computeValue` outputs. `economics.helpers` (`output`, `inp`, `driverInput`, `weakest`) builds outputs of the same shape.
- `ui/files.js` (browser only): `readBytes(file, max)`, `inflateRaw(bytes, maxOutput)`, `deflateRaw(bytes)`, `textOf(bytes)` (UTF-8 with byte order marks, falling back to Windows-1252), `sha256Hex`, `downloadBytes`, `pickFile(accept)`.

## The log-mapping AI task

`aiResults.TASK_SCHEMAS["log-mapping"]` is `{ mappings: [{ activity, nodeId, confidence, rationale }] }`. The result's `baselineModelId` names the model the activities are mapped to. `buildTaskInput(e, "log-mapping", { modelId, activities: [{ name, events }] })` sends the model's steps (ID, label, lane, description; no gateways) and the activity names, most frequent first, and nothing else from the log. `prepareReview(result, e, { activities })` flags steps that are not in the model, gateways, and names that were not sent. `applyCommand` returns `{ type: "log-mapping/proposals", payload: { modelId, mappings, stamp } }`. Extracted engagements never carry datasets, reviews, review packs or observed figures.

## Tests and fixtures

`tests/unit/helpers.mjs` has `datasetFixture(name)` and `tinyDataset()`. The fixtures in `tests/fixtures/datasets/` are synthetic: `tiny-baseline` and `tiny-after` fit `tinyEngagement()`, and `underwriting-baseline` and `underwriting-after` fit the underwriting-current-state example. The `after` datasets compare to their baselines, so the value and benefits features can be tested without the event-log import.

`tests/browser/foundation.test.mjs` shows how to register seams at runtime in a browser test. Treat a skipped browser test as a failure: it means Chrome or Edge did not start.
