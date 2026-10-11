# AIxRay: Product, Functionality, UI/UX, and Architecture Audit

**Audit date:** September 25, 2026  
**Scope:** Uploaded `aixray-main.zip`, interpreted against the supplied Astra audit brief.  
**Decision:** Converge on the Astra v2 renderer, establish a portable engagement model, and build a trustworthy workshop-capture experience before expanding simulation or ROI functionality.

## Audit basis and limits

The archive contains 15 files, including three applications, three generator prompts, a README, and a license. All three application variants were inspected. Source references below are relative to `aixray-main/`; line numbers refer to the uploaded snapshot, not a remote branch. The archive does not contain Git history, the source BPMN documents mentioned in the sample configurations, or a test suite. Therefore, original implementation chronology is inferred from structure, and source-diagram fidelity cannot be independently verified.

Browser tests used Chromium with each application's local JavaScript and stylesheet assets assembled in memory without changing the repository. Direct `file:` and localhost navigation were blocked by the test environment. External browser requests were intercepted. Screenshots were captured at 1366x768, 1440x900, 1920x1080, 2560x1440, and 1024x768. Focused tests covered replay state, geometry collisions, metric formatting, selected keyboard interactions, before-only rendering, malformed configuration, and harmless untrusted-markup handling.

These are observed rendering and interaction tests, not certification of direct-file deployment, cross-browser behavior, security, screen-reader accessibility, or large-model performance. No client interviews, live data, actual benefits, or implementation outcomes were available. The original source files are unchanged. The evidence package includes source hashes, test scripts, JSON results, screenshots, and source excerpts.

**Evidence notation:** `[E01]` through `[E15]` identify entries in the companion evidence document. Source locations are also provided directly so findings are independently reproducible.

# 1. Executive assessment

1. **The strongest product is not the root explorer.** `racer/webui-v2-astra/` has independent before/after lanes, before-only support, safer text rendering, input checks, keyboard-operable nodes, native dialogs, a movable navigator, and better playback-state handling. It is the best foundation, although its 2,060-line HTML file needs incremental extraction into modules. See `racer/webui-v2-astra/index.htm:697-849,1086-1182,1348-1478,1930-2031`. [E08, E09]

2. **Accuracy must precede visual polish.** The main explorer marks an active rework visit complete and marks an untraversed defects edge visited. The newer viewer marks off-route rejection and lost-submission nodes complete on an issued-policy scenario. These errors undermine the central promise of explaining a process. See `webui/js/visualizer.js:309-339` and `racer/webui-v2-astra/index.htm:1384-1388,1548-1565`. [E02, E04]

3. **The largest workflow gap is capture and continuity.** These applications display prepared configurations. They do not currently provide engagement creation, workshop editing, an opportunity register, engagement autosave, JSON open/save, or client deliverable export. The only browser-storage calls found persist the v2 theme. See runtime API inventory and `racer/webui-v2-astra/index.htm:1977-1982`. [E10]

4. **The business-case presentation is ahead of its calculation engine.** The v2 scorecard accepts supplied strings rather than calculating a transparent business case. A business-days metric is formatted as minutes, and four of five sample after-cost figures do not reconcile to the declared common $400 incremental AI-cost assumption without undocumented overrides. See `index.htm:1630-1675` and `process.js:954-1069` in v2. [E05, E06]

5. **The useful differentiator is a traceable consulting workbench.** Recommended product focus: source fact -> client observation -> pain point -> opportunity -> proposed process change -> quantified assumption -> client decision. The v2 detail model already provides useful seed fields, but they are read-only and not linked records. See `racer/webui-v2-astra/index.htm:1414-1459`. [E11]

6. **The canvas needs focus, not more controls.** At 1440x900, the v2 default presents two partial process views beside a large scorecard and navigator. Fit all reduces sample activity-label text to roughly 1.1-1.8 rendered pixels in the measured examples. The drawing fits, but workshop participants cannot read it. [E07]

7. **Keep local-first deployment; distinguish local from automatically private.** No application data-upload API was found in the inspected runtime files. However, the main page requests Google Fonts, and generated process files are executable JavaScript. Local autosave, export sensitivity, and AI-assisted extraction need explicit privacy design. See `webui/index.htm:6-9` and the generator output contracts. [E10, E12, E13]

8. **The newer generator is materially safer than the older one.** The old Racer prompt prescribes autonomous-agent compression and illustrative financial outcomes. The Astra prompt explicitly distinguishes facts, estimates, proposed authority, timing illustrations, and real process execution. Retire the former as a default generation path and extend the latter to structured, validated data. See `racer/tools/master-prompt-racer.txt:138-167` and `master-prompt-astra-1.txt:20-57,270-321`. [E13]

9. **A framework rewrite is not justified by the evidence.** The immediate problems are data identity, replay correctness, state separation, editing, and persistence. A modular vanilla implementation with a development-only test toolchain can address them while preserving a static distributable. This is an architectural recommendation, not a claim that a framework would never help.

10. **The first build should be a workshop workbench, not a complete modeling platform.** Deliver validated engagement files, linked workshop records, safe saving, basic metadata correction, readable current-state navigation, and a simple presentation/export path. Defer a graphical BPMN editor, automatic process execution, advanced simulation, live multiuser collaboration, and autonomous AI execution.

# 2. Repository and capability map

| Area | What exists | Strength | Limitation | Recommended future role |
|---|---|---|---|---|
| `webui/` | Config-driven single-process explorer; 6 lanes, 20 configured nodes, 5 sample submissions; playback, scrubber, task SLA bars, heat, event log, minimap | Separate branding/model/samples/engine files; stable node IDs; sample paths can include repeated node visits and parallel branches | Replay ignores later visits; three governance activities share coordinates; unsafe HTML interpolation; misleading live copy; no authoring/persistence | Legacy example and migration fixture; reuse concepts, not the defective state engine |
| `racer/webui/` | Cash-matching before/after race, shared lane catalog, case selection, milestone comparison, supplied executive metrics | Establishes synchronized process comparison | Monolithic UI; positional edges; weaker text safety/accessibility; resets playback on case change; cosmetic rather than analytical bottlenecks | Historical prototype only; preserve as an archived sample |
| `racer/webui-v2-astra/` | Underwriting sample with 40 before nodes in 7 lanes and 38 after nodes in 9 lanes; 5 illustrative cases; six themes; native dialogs; validation; navigator; splitter; before-only mode | Most complete presentation and inspection experience; rich business metadata; safe escaping in inspected detail paths; reduced-motion startup behavior | Monolithic file; off-route state defect; scorecard unit bug; positional graph identity; no editable engagement model; no persistent work | Canonical renderer and application foundation after targeted repairs |
| `tools/aixray_creator_prompt.txt` | Generates three JavaScript configurations from process documentation | Clear legacy contracts and sample-path instructions | Encourages invented samples; relies on a mental checklist; disallows fields needed for provenance; no machine validator or review UI | Legacy migration documentation, not the future primary workflow |
| `racer/tools/master-prompt-racer.txt` | Generates a before/after `window.PROCESS` object | Captures the original comparison contract | Prescriptive AI future state; assumed dramatic duration compression; arbitrary financial targets; lossy handling of intermediate events | Deprecate as an authoritative generator |
| `racer/tools/master-prompt-astra-1.txt` | Source-grounded process generator with detailed operating-model and economic rules | Best facts/assumptions separation, source-mapping guidance, and economic discipline | Outputs executable JavaScript; its guidance is not enforced by the viewer or a persisted evidence model | Main generator specification, revised to the canonical JSON contract |
| `README.md` | Explains static deployment and generating three JS files | Simple onboarding | Does not explain the two Racer variants, which entrypoint is canonical, migration, limits, or testing | Replace with an application map, quick start, trust limits, and migration guide |

**Historical qualification:** The root `webui` appears to be the original documented application; the archive does not provide commit history to prove chronology. The v2 variant is the most capable based on inspected features, not its name alone. [E01]

## Capability maturity

**Preserve:** v2 independent lanes, before-only behavior, safe text formatting, native modal details, keyboard node activation, reduced-motion-aware initial playback, comparison clock that also supports a slower future state, structural checks, and professional theme. Focused tests confirmed before-only loading, rejection of unknown lanes/negative timing, and pause preservation on case change, rewind, and jump to end. [E08, E09]

**Repair before reuse:** replay membership and repeated visits; metric units; economic input reconciliation; visual claims of live operation; readability; engagement identity. [E02-E07]

**Reintroduce deliberately:** the main explorer's time scrubbing and task-level SLA concept. Neither should be carried over without accessible controls, explicit units, and correct event semantics. The v2 timeline is not currently an equivalent scrubber. [E02, E14]

**Do not describe as mature analytics:** static `bott` flags, case-wide proportional timing scaling, or supplied financial strings. These are presentation inputs, not diagnosed constraints, route-specific simulation, or a formula engine. See `racer/webui-v2-astra/index.htm:1409-1413,1619-1627,1648-1675`. [E04-E06]

## Convergence strategy

Use `/webui/index.htm` as the stable future entrypoint, backed by extracted v2 components. Keep the v2 professional presentation as the initial visual basis. Convert the current root, original Racer, and v2 samples into fixtures against one engagement schema. Archive prototype entrypoints only after parity fixtures pass; do not maintain three independently evolving products.

Do not concatenate renderers or carry all global state forward. Preserve gateway and event semantics in the canonical model even when a renderer uses a common visual shape. In particular, a `gatewayP` or `gatewayX` should not become an undifferentiated `gw` without retained semantic metadata.

Use trusted bundled adapters for the known legacy samples. Do not add a browser feature that evaluates arbitrary uploaded `.js` files. Preserve legacy source identifiers and flag unsupported constructs rather than silently dropping them.

# 3. Client journey audit

The current-state column below describes the uploaded snapshot. Recommendations describe a future product, not existing capabilities. [E01, E10, E11, E13]

| Stage | What works today | Missing capability and friction | Recommended improvement |
|---|---|---|---|
| Preparation | A developer can generate or edit configuration and show a prepared process | No engagement wizard, artifact import/review, reusable client workspace, or validation report | New engagement from a template or validated JSON; metadata and evidence review before presentation |
| Discovery | v2 can show descriptions, ownership, systems, pain, controls, evidence, and assumptions supplied in configuration | Consultant cannot capture client corrections while speaking | Editable node details and keyboard-friendly quick capture |
| Mapping | Three renderers display task/lane/edge configurations | No in-app structural editing; legacy semantics differ; source BPMN absent | First allow metadata corrections; later add a constrained table editor and supported BPMN import |
| Diagnosis | Legacy SLA visualization and static bottleneck markers draw attention | No defensible separation of touch, wait, queue, rework, frequency, or evidence coverage | Typed measures; selectable analytical lenses; show unknowns and denominators |
| Redesign | A configured after-state can be displayed | Cannot clone baseline, compare alternatives, or link an intervention to a changed activity | Immutable current-state baseline plus editable future-state versions and change records |
| Comparison | v2 compares independent lane structures on a shared clock | Case changes scale offsets, not routing decisions; excluded nodes look complete | Explicit scenario membership; lineage-based activity matching; honest completion states |
| Value modeling | Supplied scorecard communicates a before/after story | No editable drivers, calculation trace, scenario allocation, investment basis, or financial validation | Formula-backed assumptions panel with capacity, cost, and realized cash separated |
| Presentation | A polished v2 shell, themes, details, and navigator exist | Dense sidebars and tiny fitted labels; no dedicated executive layout/export | Presenter view with focused process segments, selected findings, and visible assumptions |
| Follow-up | Files can be copied manually outside the application | No saved engagement, action log, opportunity register, snapshot, or deliverable export | Portable engagement file, recoverable local draft, linked actions, and selected exports |

**Product conclusion:** Today AIxRay primarily helps clients watch and inspect a preconfigured process illustration. The requested consulting lifecycle requires editable, persistent, traceable knowledge around that illustration.

# 4. Prioritized UI/UX and accuracy findings

Severity expresses the effect on a client workshop, not a security vulnerability score.

| ID / severity | Verified evidence | User impact | Recommendation and expected improvement |
|---|---|---|---|
| UX01 / Critical | Main `nodeStateAt()` selects `visits[0]`. At minute 9,100, Payroll Variance's second Develop Bot visit is active, but the detail panel says Complete. `visualizer.js:309-323`. [E02] | The tool contradicts the actual configured rework example | Derive node status from the applicable visit; expose visit history. Rework becomes explainable rather than misleading |
| UX02 / Critical | v2 `stateFor()` ignores route membership; end-of-scenario testing marks decline, rejection, referral-decline, and lost-submission nodes Done. `index.htm:1384-1388,1548-1565`. [E04] | Clients can see mutually incompatible business outcomes as completed | Add explicit included/excluded/unknown scenario membership and actual traversed-edge state |
| UX03 / High | Main `flowVisited()` checks only whether the destination was visited. A Defects edge is visited before its source QA decision occurs. `visualizer.js:325-339`. [E02] | False history and incorrect interpretation of decisions | Store transitions or visited edge IDs per occurrence; never infer a traversed edge solely from its destination |
| UX04 / High | Provision Access, Data Classification, and Pre-Approvals all occupy `(1419,478)` under the root layout. `process.js:49-59`; `visualizer.js:63-67`. [E03] | Two activities are obscured beneath a third | Retain v2 collision slots; validate same-lane collisions and connector routing |
| UX05 / Critical | v2 table shows `Cycle time (business days): 32m -> 16m` from source values 32 and 15.5. `index.htm:1630-1631`; `process.js:1018-1023`. [E05] | Executive numbers are visibly wrong | Typed units and calendar-aware formatters; no formatting based on a label regex |
| UX06 / High | Four supplied after-costs need undisclosed incremental-cost overrides to match the common assumption. [E06] | Unexplained financial precision weakens confidence | Calculate from typed drivers or mark supplied values unreconciled and exclude them from validated outputs |
| UX07 / High | At 1440x900, Fit all reaches 11% zoom; measured example label sizes are about 1.1-1.8 rendered pixels. [E07] | Diagram coverage is mistaken for usability | Label Fit all as overview; add readable phase/focus views, search, and list representation |
| UX08 / High | Default comparison shows two partial diagrams plus scorecard, cases, navigator, and controls. At 1024x768, scorecard text wraps into fragments. [E07] | Navigation competes with the discussion | Default to one current-state canvas; open comparison intentionally; use a collapsible, task-specific side panel |
| UX09 / High | Root has zero keyboard-focusable SVG nodes in the inspected DOM; help leaves focus on its trigger with no dialog semantics. v2 has 78 focusable nodes and native dialog behavior. [E08] | Keyboard users cannot equivalently explore the root diagram | Preserve v2 behavior; add focus-to-node scrolling, a structured activity list, and keyboard-accessible editing |
| UX10 / Medium | Main branding states Telemetry connected and Live, while samples are static configurations. `branding.js:7-9`; `index.htm:134-146`. [E12] | Presentation suggests an integration that is not implemented | Persistent Demonstration / Supplied scenario / Observed data badges with clear provenance |
| UX11 / Medium | Main labels contain visible mojibake from source strings; the UI uses tiny secondary text and unnecessary 3D tilt. [E07, E12] | Reduces professionalism and legibility | Repair encoding in fixtures; use a flat canvas and larger presentation typography |
| UX12 / Medium | v2 detail opens a large read-only modal with many empty placeholders; animation may continue behind it. `index.htm:1422-1477`. [E11] | Inspection interrupts live annotation and creates long scans | Use a compact editable drawer, required-field prompts, and optional full details; pause playback for editing |
| UX13 / Medium | v2 Metrics toggles the sidebar, while legacy Metrics means task SLA bars; Heat relies on configured bottleneck flags. [E14] | Same terms imply different capabilities | Rename actions to their actual function: Scorecard, SLA overlay, Tagged bottlenecks |
| UX14 / High when importing | Root detail/list uses unsanitized configuration in `innerHTML`; harmless markup is parsed. v2 escaped the same test value. `visualizer.js:728-740,765-807`. [E10] | Untrusted imported or generated content would create a dangerous trust boundary | Prefer text-only fields and safe DOM sinks; validate link schemes and imported structure |

## Responsive and accessibility assessment

The five viewport sizes were captured, but they were not five physical device tests. The major recurring issue is the canvas-to-sidebar allocation, not a crash. Wider screens provide more working room; they do not solve whole-process label readability. At tablet-landscape dimensions, collapse the scorecard and use one process pane as the default.

v2 already handles reduced-motion preference at startup with `playing: !matchMedia(...).matches`; do not list this as missing. It also preserves Stop on case change, rewind, and end, and its node Enter key opens a native dialog. Preserve these tested strengths. [E08]

Still required: full keyboard walkthroughs for every editing action, visible focus under each theme, readable nonvisual process order, text alternatives for chart/state meaning, color-independent status labels, zoomed-text tests, and screen-reader validation. No complete contrast or WCAG conformance determination was performed. W3C's modal-dialog guidance supports contained focus, Escape behavior, and return of focus to the trigger; use this as acceptance guidance, not as a claim that the product is certified. [W1]

# 5. Feature and functionality gap analysis

## 5.1 Capability priorities

| Domain | Current position | Recommended capability |
|---|---|---|
| Process modeling | Static process objects; no user-facing model editor | Stable activity/edge IDs, preserved semantic type, editable metadata, later constrained structural editing |
| Workshop facilitation | Read-only inspection and presentation controls | Fast node-linked notes, pain points, decisions, actions, owner assignment, open questions |
| Process analytics | Configured timings, root SLA bars, static bottleneck flags | Explicit touch/wait/queue/rework metrics, coverage indicators, role/system views, branch-weighted calculations only with valid inputs |
| Improvement design | Manually authored after state | Clone current state, record changes, retain lineage, preserve mandatory controls |
| Scenario comparison | Shared-clock replay; proportional case scaling | Explicit route and assumption sets, alternative future states, matched activity groups, visible changed/added/removed steps |
| Automation/AI assessment | Agent labels and detailed narrative fields | Node-linked opportunity assessment, intervention alternatives, authority limits, prerequisites, fallback and review requirements |
| Value/ROI | Supplied text and tables | Editable formula inputs, sensitivity ranges, implementation/operating costs, benefits traceability, no capacity/cash double counting |
| Evidence and assumptions | Rich v2 fields, generally free-form and static | Addressable source records, field-level provenance, evidence status, reviewer/date, unresolved questions |
| Collaboration/workshop capture | No edit workflow or shared state | Single-facilitator local capture first; explicit ownership and workshop identity; multiuser later |
| Persistence | Theme only | Validated portable JSON, autosave where supported, recovery, snapshots, dirty-state protection |
| Export and presentation | No implemented deliverable exports found | Engagement JSON, opportunity/action CSV, static process SVG/PNG, print-friendly executive summary |
| Administration/branding | Config text; six v2 themes | Engagement settings for client/process/display name, optional approved logo, disclosure and time convention |

Current-state assessment is grounded in the interface, runtime API inventory, and source contracts. These recommendations are not claims that the functions already exist. [E09-E14]

## 5.2 Process-improvement analytics: make the measures meaningful

Create a typed measurement model before adding charts. Each measure should identify its value, unit, time basis, population, scenario, source, and validation status. Unknown is not zero. A branch probability of zero is not the same thing as an unknown probability.

Keep these quantities distinct:

- **Elapsed process time:** business or calendar time from start to completion. Do not sum concurrent branch durations as if they were serial.
- **Human touch effort:** person-minutes of work, including required review, exception handling, and rework. Two people working concurrently can consume more effort than elapsed time.
- **Waiting categories:** queue wait, external-counterparty wait, and other delay. Define whether the categories overlap before aggregating them.
- **Frequency and volume:** transaction volume, expected visits, branch mix, exceptions, and rework. Do not claim annual impact from a single illustrative trace without these assumptions.

Useful initial analyses are time by role, tagged wait by activity, handoff count with a defined boundary, known-versus-missing data coverage, and an opportunity list linked to affected nodes. More advanced queue/throughput or stochastic simulation should wait for arrival rates, resource capacities, calendars, distributions, and route semantics.

The existing main helper takes the maximum branch completion time for its supported parallel block, which is useful. Its node/edge rendering does not correctly represent all visits and transitions. Preserve the valid scheduling concept without implying that either viewer implements a BPMN execution engine. `webui/js/samples.js:5-26`; `racer/tools/master-prompt-astra-1.txt:46-57`. [E02, E13]

## 5.3 Financial model and trust

The representative underwriting scenario declares 55 before human hours and 22 after human hours, a $150 hourly rate, 400 annual submissions, 1,800 productive annual hours per FTE, and approximately $400 incremental AI cost per submission. On those illustrative inputs:

- Capacity release = `(55 - 22) * 400 / 1800 = 7.33 FTE-equivalent`.
- Before modeled cost = `55 * 150 = $8,250` per submission.
- After modeled cost = `22 * 150 + 400 = $3,700` per submission.
- Modeled cost difference = `$4,550` per submission.

This is arithmetic reconciliation of sample assumptions, not verified savings, realized cash, or a validated client business case. The source's own newer prompt makes this distinction. `racer/webui-v2-astra/process.js:954-955,1004-1023`; `racer/tools/master-prompt-astra-1.txt:284-321`. [E06, E13]

Other supplied cases do not reconcile to that common $400 input:

| Case | After touch hours | Supplied after cost | After cost with $150/hour plus $400 | Incremental amount implied by supplied cost |
|---|---:|---:|---:|---:|
| 1 | 10 | $1,700 | $1,900 | $200 |
| 2 | 16 | $2,700 | $2,800 | $300 |
| 3 | 22 | $3,700 | $3,700 | $400 |
| 4 | 30 | $4,550 | $4,900 | $50 |
| 5 | 40 | $6,100 | $6,400 | $100 |

Per-case overrides could explain the differences, but none are declared in the structured sample. The model should request those overrides or show a reconciliation warning, not silently choose a number. Also, all five FTE examples annualize at 400 submissions; summing them would count the same illustrative annual population multiple times unless explicit mutually exclusive allocations are supplied. [E06, E13]

For the future calculator, show formula inputs and outputs together. Separate capacity value from cashable savings and cost avoidance. Add adoption, eligible volume, realization, startup cost, recurring operating cost, and benefit timing only when the engagement supplies them. Do not invent default client outcomes. Do not label a per-case cost delta as ROI without an investment basis. Base cost reduction on human effort and actual costs, not elapsed cycle-time reduction.

## 5.4 Automation and AI opportunities

Use an Opportunity Register linked to one or more activities and pain points. Capture the problem, evidence, candidate intervention, affected volume, effort, expected benefit, owner, dependencies, risk, and next validation action.

Interventions should include eliminate, simplify, standardize, integrate, orchestrate, deterministic automation, self-service, AI assist, AI agent, and control/data improvement. Ask why each intervention is preferable to a simpler alternative. Avoid a single opaque AI-readiness score.

For AI candidates, record input structure, data availability, judgment requirements, exception conditions, action authority, human review, auditability, failure handling, and whether the proposal is assistance or autonomous execution. Preserve approval authority as explicit data. A box labeled Human-in-the-loop is not an implemented control. The newer generator already says this; the UI should make the distinction visible. [E13]

## 5.5 Generator-to-workshop workflow

The root prompt asks for source interpretation, three JS files, invented examples, and a mental checklist. The older Racer prompt goes further by prescribing agentic future-state patterns and illustrative financial values. The newer Astra prompt corrects much of that reasoning but still emits JavaScript that the user must place beside the viewer. [E13]

Recommended pipeline:

`Source artifact -> extraction draft -> schema validation -> source-mapping review -> consultant corrections -> client validation -> workshop annotations -> scenarios/value -> presentation/export`

Use one generator contract, with a versioned JSON schema, source references, confidence/uncertainty fields, and unsupported-construct warnings. The model should report what it inferred; deterministic validators should verify references, units, bounds, and reconciliation. Neither a generator's self-check nor a successfully rendered diagram proves source fidelity.

Initially support prepared JSON and trusted templates. BPMN XML import can follow for a declared supported subset. PDF, slide, screenshot, or SOP extraction should be a separate, explicitly approved assistive workflow with human review. Do not promise universal import in the first build or send client artifacts to an external model automatically.

## 5.6 Client outputs

Prioritize portable engagement JSON first because it preserves the complete working record. Next add opportunity/action CSV and a print-friendly summary with process scope, pain points, recommendations, assumptions, evidence gaps, owners, and decisions. Add SVG/PNG process exports with legends and scenario/evidence labels. These enable presentation assembly without building an entire document-generation platform.

A later executive pack should show what changes, why, modeled impact, assumptions, risks, dependencies, and next decisions. Export only explicitly selected information and warn when detailed notes or identifiers are included. Actual PDF/PPTX generation is not required for the first product increment.

# 6. Target product architecture

## 6.1 Canonical application and module boundaries

Recommended conceptual structure, not an instruction to rewrite everything at once:

```text
webui/
  index.htm                 Stable application entrypoint
  css/                      Shell, canvas, accessibility, presentation styles
  js/
    app.js                  Application boot and orchestration
    model/                  Schema, IDs, validation, migrations
    state/                  Engagement store, commands, revision/dirty state
    render/                 v2-derived SVG renderer, layout, route display
    replay/                 Explicit visit/transition replay, not BPMN execution
    workshop/               Details drawer, records, owners, filters
    analysis/               Typed measures and later formula evaluation
    io/                     JSON open/save, export, recovery adapters
    adapters/               Trusted legacy sample transformations
  examples/                 Canonical engagement fixtures
  tests/                    Unit and browser tests, development-only tooling
```

Separate persisted business data from presentation state. A diagram pan must not create an engagement revision; adding a pain point must. Treat computed metrics as derived output, with source-input references, not as freely editable display strings.

Extract only the modules touched by each feature. v2's `normalize`, `buildTrack`, text fitting, routing, dialog behavior, and navigator are useful seams. Main `tick()` redraws visuals/minimap even when paused and repeatedly rebuilds HTML; do not copy that pattern into editable forms. v2 limits rendering more carefully during stopped playback, but large-model performance remains unbenchmarked. `webui/js/visualizer.js:1076-1094`; `racer/webui-v2-astra/index.htm:1595-1628`. [E14]

## 6.2 Minimal portable engagement model

```text
Engagement
  schemaVersion, id, revision, createdAt, updatedAt
  clientDisplayName, processName, confidentiality, branding
  timeBasis: unit, calendarConvention, businessMinutesPerDay
  models[]
    id, role(current/future), version, sourceRefs, lineage
    lanes[]: id, name, role, type
    nodes[]: id, label, semanticType, laneId, details, provenance
    edges[]: id, fromNodeId, toNodeId, condition, semanticType
    presentation: coordinates and preferred view, separately stored
  scenarios[]
    id, modelRefs, population, assumptions, routeMembership
    visits[]: visitId, nodeId, start, end, status, provenance
    transitions[]: edgeId, sourceVisitId, targetVisitId
  records[]
    id, kind, linkedModelVersion, linkedNodeIds
    title, description, owner, status, evidenceRefs
  evidence[]: id, sourceTitle, locator, extractedFact, reviewer, reviewDate
  measurements[]: key, value, unit, population, basis, sourceRefs, status
```

Record kinds can initially cover pain point, opportunity, assumption, decision, action, and open question. Do not create a separate subsystem for every noun in the audit brief. Later future-state/version and value features should extend this foundation without changing node identity.

The v2 sample nodes have no stable `id` fields and edges use array positions. The root uses stable IDs but a different task/gateway vocabulary. Both facts make a migration layer important. Stable IDs must survive reorder, rename, save/reopen, and baseline cloning; future-state lineage should be explicit rather than inferred from matching labels. [E09]

Keep provenance separate from validation status. A client-provided number is not automatically independently validated; a proposed value does not become a fact because a user saves it. Preserve source artifact references when the underlying attachment is unavailable, and mark that evidence unresolved.

## 6.3 Validation

Validate in layers: parse/schema, stable identity, graph references, semantic support, timing/replay membership, units/calendar, economic reconciliation, and evidence coverage. Reject structurally unsafe input without replacing the open engagement. Surface specific field paths and corrective actions. Preserve the distinction between fatal errors and warnings.

For imported legacy configurations, do not infer that every zero-duration optional node is excluded from a route. Ask for explicit membership where ambiguous. Do not promise execution semantics for inclusive/event-based gateways, subprocesses, or loops until supported and tested.

## 6.4 Persistence and privacy

Make explicit JSON Save/Open the durable portability contract. Offer debounced browser recovery where supported, showing Saved locally, Unsaved changes, or Storage unavailable. Browser storage for direct `file:` URLs has undefined cross-browser behavior; therefore it cannot be the only save mechanism. [W3]

For supported browser-origin deployment, a storage adapter can use IndexedDB for engagement drafts. Keep the app deployable as static assets; an approved local/static server need not become a cloud backend. Validate both direct-file and hosted modes in the actual supported environment before claiming parity. The current audit could not complete those navigation tests.

Protect unsaved work when opening another engagement, importing, or clearing local data. Offer recovery snapshots and an explicit clear-local-data action. Local storage is not a confidentiality guarantee: shared machines, browser profiles, exported files, and backups need handling instructions. Do not claim encryption or regulated-data suitability unless actually implemented and reviewed.

## 6.5 Security boundary

Treat imported and AI-generated content as data, not executable code. Prefer JSON parsing, allowlisted fields, safe text insertion, URL-scheme checks, and bounded file/graph sizes. Use restrictive content policy and no outbound connections in the supported deployment where feasible. Rich text, SVG imports, and embedded evidence attachments should be deferred until their sanitization and handling are designed.

The harmless markup test demonstrated raw parsing in the root detail view and escaped literal display in v2. This is a confirmed rendering difference, not proof of an Internet-exploitable attack path. The current application has no remote import endpoint in the inspected code. OWASP recommends safe text sinks such as `textContent` rather than inserting untrusted data into `innerHTML`; use that guidance when introducing client editing/import. [E10, W2]

## 6.6 Framework decision

**Now:** modular vanilla JavaScript, one validated store, static assets, and development-only automated tests. **Reconsider later:** a framework when complex editing forms, collaboration, or component lifecycle costs justify it. A development build pipeline is separable from a runtime backend and should not be introduced as a prerequisite for a small feature.

# 7. Proposed information architecture and target experience

Do not implement six disconnected applications named Explore, Diagnose, Improve, Compare, Value, and Present. Use one engagement with a few connected workspaces. Explore and Diagnose are lenses on the same process, not separate data silos.

```text
Client / Engagement / Process / Version      Evidence status      Save / Open

Process        Opportunities        Scenarios        Value        Present

[Current state v1] [Focus phase] [Find activity] [Lens: None / Time / Effort / Risk]

+--------------------------------------+-----------------------------+
|                                      | Selected activity           |
| One primary process canvas           | Summary / Measures / Source |
|                                      |                             |
| Selected-node and phase focus        | Quick capture               |
| Before/after opens only on request    | Pain / Opportunity / Note   |
|                                      | Decision / Action           |
+--------------------------------------+-----------------------------+

Workshop records: open questions, missing evidence, decisions, next actions
```

**First-build navigation:** Process, Workshop records, and Present. Show an existing comparison only when the engagement contains an after model. Do not ship dead Value or Improve tabs. Expand navigation as capabilities become usable.

**Target engagement workflow:** create/open an engagement; load a reviewed template or structured extraction draft; inspect provenance and gaps; correct the current state with the client; capture linked pain points and questions; examine a diagnostic lens; develop and compare alternative interventions; clone an explicitly proposed future state; revise assumptions and inspect modeled effects; agree decisions, owners, and validation actions; export a portable engagement and selected client outputs.

Default to paused, current-state-first workshop interaction. A consultant should not need to narrate navigation. Provide play only as an explanatory tool. Keep a persistent distinction between observed data, supplied scenarios, proposed changes, and validated outcomes. On entering edit mode, prevent animation from moving the context or replacing form content.

# 8. Prioritized improvement backlog

Effort estimates are relative design estimates, not delivery commitments: **S** is a focused component change; **M** spans several components; **L** requires a new subsystem or substantial migration. Client value and UX effects are qualitative hypotheses to validate with consultants.

## P0: Trust, foundations, and major usability

| ID | Recommendation / problem solved | Persona; client value; UX effect | Effort; dependencies | Likely files/components | Acceptance criteria |
|---|---|---|---|---|---|
| P0-01 | Establish one canonical app and legacy-fixture adapters | Maintainer and consultant; consistent behavior; one clear entrypoint | M; none | `README.md`, `webui/index.htm`, extracted v2 shell, `adapters/` | Three bundled examples load through one model contract; semantic loss is warned; prototype entrypoints are not maintained as products |
| P0-02 | Correct repeated-visit and route/edge display | Process owner; credible history; no contradictory completion | M; canonical replay contract | v2 `stateFor/render`, root replay fixtures, `replay/` | Payroll rework is active/breached at minute 9,100; skipped rejection/lost nodes remain Not in scenario; untraversed edges never show complete |
| P0-03 | Type metric units and flag unreconciled supplied economics | Sponsor; dependable numbers; readable and explainable measures | M; minimal measurement contract | v2 `metricValue/renderExec`, sample adapters, formatter tests | 32 and 15.5 business days stay business days; 480-minute convention is explicit; inconsistent costs receive warnings rather than validated totals |
| P0-04 | Versioned engagement schema, stable IDs, safe JSON import | Consultant; portability; actionable error recovery | M; P0-01 | `model/`, `io/import`, schema, migrations | Reorder/rename preserves links; invalid references/nonfinite timing rejected; malformed import leaves current work unchanged; arbitrary JS is not executed |
| P0-05 | Explicit Save/Open plus recoverable local draft | Facilitator; no lost workshop work; visible save state | M; P0-04 | `state/`, `io/persistence`, toolbar | Round-trip preserves records/IDs/provenance; storage failure is visible; switching engagement protects dirty state; recoverable snapshot restores correctly |
| P0-06 | Current-state-first layout, readable focus, accessible capture shell | Facilitator and client; less explanation; usable laptop workspace | M; P0-01 | shell CSS, drawer, canvas focus, navigator | At 1366x768, primary actions remain usable; Fit all is clearly overview; node selection/details work by keyboard; existing v2 pause/reduced-motion behavior remains |
| P0-07 | Safe content boundary and network-neutral defaults | Engagement owner; confidentiality and trust; clear data handling | M; P0-04 | DOM helpers, import validation, branding, static assets | Untrusted labels remain text; unsafe URLs rejected; bundled workflow makes no external requests; no Telemetry connected claim without an actual connection |
| P0-08 | Automated regression fixtures and supported-deployment checks | Maintainer; predictable client sessions; fewer regressions | M; starts immediately, grows with P0-01 to 07 | `tests/`, browser harness, fixtures, documentation | Tests cover rework, excluded routes, unit conversion, cost warnings, before-only, invalid input, save/recovery, keyboard, and supported deployment modes |

## P1: Make AIxRay a process-improvement tool

| ID | Recommendation / problem solved | Persona; client value; UX effect | Effort; dependencies | Likely files/components | Acceptance criteria |
|---|---|---|---|---|---|
| P1-01 | Node-linked workshop records and metadata correction | Facilitator/process owner; captured client knowledge; no source-code editing during discussion | M; P0-04/05/06/07 | `workshop/`, details drawer, store | Add/edit pain, opportunity, assumption, question, decision, and action; assign owner/status; preserve links on save/reopen |
| P1-02 | Evidence and assumption review with field-level references | Analyst/client owner; traceability; visible unknowns | M; P0-04, P1-01 | provenance editor, evidence register, validators | A displayed metric links to its source/assumption and reviewer; unresolved source is distinct from validated fact; no default zero for missing value |
| P1-03 | Opportunity register with non-AI alternatives | Consultant/automation lead; defensible interventions; process-linked prioritization | M; P1-01/02 | register, filters, node badges | Each opportunity links pain/evidence, intervention, affected nodes, owner, expected outcome, dependencies, risk, and validation action |
| P1-04 | Typed diagnostic lenses for time, effort, waits, and handoffs | Process analyst; actionable diagnosis; targeted visual attention | M; P0-03/04, P1-02 | `analysis/`, canvas overlays, accessible tables | Lens declares units/population/coverage; parallel time is not blindly summed; tagged bottleneck and measured constraint are labeled differently |
| P1-05 | Clone baseline and maintain future-state versions | Process designer; auditable redesign; clear changed/added/removed activities | L; P0-04/05, P1-02/03 | versioning, lineage, constrained model editor | Current baseline is immutable; future edits have rationale; comparisons survive renamed/reordered activities; mandatory controls remain explicit |
| P1-06 | Formula-backed value and sensitivity model | Sponsor/finance reviewer; transparent business case; inspectable assumptions | L; P0-03/04, P1-02/04 | `analysis/value`, assumptions panel, calculation tests | Every result has formula/inputs; AI costs included; capacity separated from cash; scenario volumes do not double count; missing inputs suppress unsupported outputs |
| P1-07 | Presenter layout and selected client deliverables | Facilitator/sponsor; clear handoff; presentation without UI noise | M; P0-05/06, P1-01/02 | presenter, JSON/CSV/print/SVG export | Output includes scope, version, evidence status, assumptions, selected opportunities/actions; sensitive notes excluded unless selected; process labels remain legible |
| P1-08 | Search, phase focus, semantic navigation, and comparison matching | Workshop participants; faster comprehension; no dependence on microtext | M; P0-04/06, later P1-05 | search index, focus views, comparison mapping | Locate an activity by label/role/system; focus restores context; current/future matching uses lineage not screen position; keyboard list mirrors canvas |

## P2: Advanced capability and differentiation

| ID | Recommendation / problem solved | Persona; client value; UX effect | Effort; dependencies | Likely files/components | Acceptance criteria |
|---|---|---|---|---|---|
| P2-01 | Supported-subset BPMN import and source mapping | Analyst; less preparation; visible fidelity limits | L; stable schema and validator | import adapters, mapping review, fixtures | Supported constructs round-trip semantically; unsupported events/gateways are flagged, never silently omitted; source IDs retained |
| P2-02 | Optional AI-assisted artifact extraction/review | Consultant; faster drafting; transparent corrections | L; P1-02, secure import, approved data handling | extraction contract, review UI, provider boundary | Explicit user-approved processing; source locators and uncertainty shown; no client upload by default; generated data cannot execute code |
| P2-03 | Scenario distributions and resource/queue simulation | Improvement analyst; richer what-if analysis; explicit modeling assumptions | L; route semantics, typed metrics, validated inputs | simulation service/module, scenario editor | Scope, calendars, distributions, resource limits, seeds, and confidence intervals documented; deterministic fixtures pass; no claims derived from animation speed |
| P2-04 | Controlled multiuser collaboration and approvals | Distributed client team; governed follow-up; consistent ownership | L; stable local model/versioning | optional backend, auth, access control, merge/audit | Explicit tenant/access design; conflict handling; immutable review history; offline workflow remains useful without backend |

# 9. Quick wins

**First:** correct the business-day formatter; label the main samples as demonstration data; repair source encoding; rename ambiguous controls; make current-state and focused views the default. These changes improve comprehension without a platform rewrite. [E05, E07, E12, E14]

**Second:** correct route-membership display and add regression fixtures. These are correctness repairs, not visual enhancements. Do not treat them as optional polish. [E02, E04]

**Third:** retain v2's tested keyboard, dialog, reduced-motion, escaping, and pause-preservation behavior while reducing modal clutter and sidebar dominance. Remove empty sections from the compact drawer but keep a full details view. [E08, E10, E11]

Do not spend the first increment on additional themes, stars, animated tokens, or more financial cards. Those do not close the preparation/capture/save gap.

# 10. Strategic product bets

**Evidence-linked workshop workbench.** The strongest differentiator is the relationship between a process node, a client observation, its evidence, an improvement hypothesis, and a decision. This extends the existing v2 business-detail concept into a reusable engagement record. [E11]

**Traceable current/future-state comparison.** Preserve baseline identity, show exactly what changed, and attach operational assumptions. This builds on the existing independent-lane comparison without pretending that its animation executes workflow decisions. [E04, E09]

**Explainable value modeling.** Make every displayed benefit inspectable, with uncertainty and realization assumptions. The newer generator contains much of the required discipline; productize it instead of displaying persuasive but independent text strings. [E06, E13]

**Portable confidential engagements.** An engagement that can be prepared, facilitated, saved, reopened, and selectively exported without a mandatory cloud account is a plausible strategic advantage. Validate that value with intended users rather than assuming enterprise adoption.

# 11. Recommended implementation sequence

| Phase | Build | Why next | Reuse/refactor | Explicitly avoid for now |
|---|---|---|---|---|
| A. Trust repairs and executable fixtures | Replay membership/visits, unit formatting, economic warnings, example labeling, core tests | Prevent misleading client demonstrations | Reuse v2 rendering and guardrails; replace defective state/formatting functions | No redesign of the entire renderer |
| B. Engagement foundation | Stable IDs, schema, validated JSON, store, Save/Open, recoverable draft | Durable data enables every workshop feature | Extract v2 normalization and state seams; use trusted adapters for bundled examples | No arbitrary JS import, mandatory cloud backend, or full BPMN execution |
| C. Usable workshop increment | Focused current-state canvas, metadata corrections, linked records, evidence status, simple Present/export | First end-to-end usable client session | Reuse details vocabulary, native controls, safe rendering, before-only mode | No graphical topology editor or automatic document extraction |
| D. Improvement design | Opportunity register, diagnostics, baseline clone, future-state lineage | Connect findings to proposed changes | Extend one store/schema, not parallel apps | No opaque AI suitability score or guaranteed savings |
| E. Decision support | Formula-backed value, sensitivity, scenario allocations, executive comparison | Quantification now has trustworthy inputs | Replace supplied text with derived results | No queues/throughput predictions without supporting resource data |
| F. Selective expansion | BPMN/artifact import, optional collaboration, advanced simulation | Only after repeated client-workshop validation | Add bounded adapters/subsystems | No feature accumulation without demonstrated client value |

After each phase, rehearse a realistic workshop using synthetic client data and confirm that a nondeveloper facilitator can complete the intended workflow. Use observed friction and test results to refine scope. No delivery dates or measured productivity savings are implied by this sequence.

## Engineering references

These sources inform engineering recommendations only. They are not evidence about the uploaded repository or validation of the supplied business assumptions.

- **[W1] W3C, WAI-ARIA Authoring Practices: Dialog (Modal) Pattern.** Focus containment, initial focus, Escape, and focus restoration. Accessed September 25, 2026. `https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/`
- **[W2] OWASP, DOM based XSS Prevention Cheat Sheet.** Safe text sinks and untrusted-data handling. Accessed September 25, 2026. `https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html`
- **[W3] MDN, Window.localStorage.** Origin-scoped storage and undefined direct-file behavior. Accessed September 25, 2026. `https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage`

# Recommended First Build

## Scope: AIxRay Workshop Workbench v0.1

The smallest coherent first build is a trustworthy, saveable current-state workshop experience using the v2 renderer. It should allow a consultant to open a prepared engagement, inspect and correct its descriptive metadata, capture linked client observations, and leave with a usable record.

This release does not need to solve every phase of process improvement. It must stop treating the client session as a disposable animation.

## User experience

Open a bundled example or validated engagement JSON. Confirm client/process name, time convention, source status, and demonstration/observed/proposed designation. Enter a paused, single current-state canvas. Find or select an activity and open an editable drawer. Correct its label/description/owner and capture a pain point, opportunity, assumption, question, decision, or action. View the linked record register, save locally, reopen without losing context, and present/export selected outputs. An already supplied after model may remain available as an explicit read-only comparison.

## Features included

1. One canonical application entrypoint with trusted adapters for the bundled legacy examples.
2. Minimal versioned engagement JSON with stable node/edge IDs, linked workshop records, evidence references, and typed time basis.
3. Safe validated Open/Save, visible dirty state, supported local recovery, and protection against accidental replacement of unsaved work.
4. Correct replay display for explicit visits/transitions and route membership. Unsupported or ambiguous semantics are identified rather than animated as established history.
5. Correct metric units and visible warnings for unreconciled supplied economic values. No new ROI engine in this release.
6. Current-state-first layout, readable activity/phase focus, compact editable drawer, keyboard use, and preservation of v2 accessibility strengths.
7. Linked record register with owner/status and basic filtering.
8. Present view, full engagement JSON export, and a simple selected-record CSV or print-friendly handoff.

## Features explicitly deferred

Graphical node/edge editing; universal BPMN fidelity; PDF/screenshot/SOP extraction; AI provider integration; automatic future-state generation; scenario resource simulation; queue prediction; a complete ROI calculator; native PowerPoint/PDF generation; real-time multiuser collaboration; SSO; workflow execution; autonomous agent actions.

Creating a new process from scratch is not required in v0.1. Creating an engagement from a reviewed template or opening prepared JSON is. This keeps the first build coherent while acknowledging that advanced preparation is not yet fully nontechnical.

## Existing capabilities reused

v2's professional theme, independent-lane renderer, collision handling, text fitting, navigator, before-only view, native dialogs, keyboard activation, safe text rendering, structural checks, and reduced-motion/Stop behavior. Use the original sample paths as rework/parallel regression fixtures, not as a trusted finished state engine. [E02, E08, E09]

## Files likely changed

`webui/index.htm`, the application README, extracted v2 CSS/JavaScript modules, a new schema/validator, a small engagement store, workshop drawer/register components, JSON persistence/export helpers, trusted sample adapters, and unit/browser tests. Revise the Astra generator prompt to emit the new contract after the schema is stable. Archive the other entrypoints only after migration and behavior checks.

## Data-model changes

Add engagement/schema/revision IDs; stable node and edge IDs; explicit time unit/calendar convention; source and validation status; node-linked workshop records; evidence references; dirty/recovery state; and explicit replay visits/transitions or membership. Keep layout coordinates separate from business semantics. Preserve all original source data needed for traceability during migration.

## Acceptance criteria

- The bundled main and both Racer examples import through trusted adapters without silently losing task/gateway meaning. Missing or unsupported semantics produce review warnings.
- In the Payroll Variance fixture, Develop Bot at minute 9,100 represents its second visit and shows the appropriate active/SLA state rather than Complete.
- In the representative underwriting route, excluded decline, rejected, and lost outcomes never display as completed; untraversed edges are not marked visited.
- The 32 and 15.5 business-day values display correctly and reconcile to 15,360 and 7,440 business minutes under the declared 480-minute business day.
- The supplied cost inconsistencies are visibly flagged or resolved through explicit recorded assumptions; no unsupported financial claim is promoted to validated output.
- A consultant can add, edit, filter, and assign a linked workshop record without source-code editing or losing the selected activity.
- Save/reopen preserves engagement version, node IDs, records, ownership, evidence, and explicit assumptions. Invalid import leaves the existing engagement intact.
- Storage failure is clearly reported and explicit file save remains available. Recovery and dirty-state behavior are tested in the actual supported deployment modes.
- Core interaction works at 1366x768 and 1920x1080 with readable focused labels; overview is not represented as a readable whole-process view. Tablet layout can collapse secondary panels.
- Keyboard users can select an activity, edit/capture a record, close the panel, and recover focus. Reduced-motion startup and stopped playback behavior do not regress.
- Untrusted configuration values render as data; the bundled workflow makes no external requests during load, capture, save, or selected export.
- The handoff includes process scope/version, selected opportunities/actions, owner/status, and evidence/assumption labels. Sensitive notes are not exported accidentally.
- Source fixtures and regression tests pass before the old entrypoints are archived. Browser/deployment limitations are documented honestly.

## Risks and mitigations

**Migration fidelity:** the root and Racer schemas encode different semantics. Preserve semantic types and original references; use fixture-based adapters, not blind renaming.

**Scope growth:** editing topology, importing PDFs, and calculating ROI could consume the first increment. Limit v0.1 editing to engagement and node metadata plus linked records.

**Storage assumptions:** direct-file browser persistence varies. Make explicit file save mandatory, and test recovery in supported environments.

**False authority:** a polished process map can make assumptions look validated. Keep source status visible and prevent supplied illustrative metrics from becoming confirmed outcomes through formatting alone.

**Monolithic refactor risk:** extract only the modules needed for the first workflow and maintain screenshot/behavior baselines around them.

## Why this is the correct first step

The repository already demonstrates process rendering and comparison. The largest improvement in client usefulness is not another visualization treatment; it is enabling a facilitator to capture, preserve, and hand off client knowledge while the displayed process remains trustworthy. This first build closes that gap without requiring a framework rewrite, a cloud platform, or a full process-execution engine.
