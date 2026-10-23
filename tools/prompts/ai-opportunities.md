# Task: suggest records for the workshop

Read the engagement and suggest up to {{MAX_SUGGESTIONS}} new records: opportunities, pain points and open questions the consultant can raise with the client.

- Build on what is there. Do not repeat an existing record; list the records a suggestion builds on in `basedOnRecordIds`. Records marked `origin: "ai-draft"` are earlier AI suggestions that nobody has reviewed yet.
- Link each suggestion to the steps it concerns with `linkedModelId` and `linkedNodeIds`, using the IDs given.
- `kind` is `opportunity`, `pain` or `question`. Pain points and questions have `opportunity: null`.
- For an opportunity, fill every `opportunity` field. Prefer the simplest intervention that works, in this order: {{INTERVENTIONS}}. In `simplerAlternative`, say why a simpler option is not enough.
- `expectedBenefit` is qualitative unless figures in the engagement support a number. If you give a number, say where it comes from.
- `validationAction` is the next step to test the idea with the client: who to ask and what data to look at.
- `effort` is `S`, `M`, `L` or empty. `priority` is `high`, `medium`, `low` or empty; leave it empty unless the engagement shows the impact (volume, delay, risk).
- `confidence` is `high` when the engagement states the problem directly, `medium` when it is implied, and `low` when it is a hypothesis to test.
- `rationale` is one or two sentences naming the steps, details or records behind the suggestion.
- `goalIds` lists the IDs of the engagement's value goals (`goals`) the opportunity serves, exactly as given. Leave it empty for pain points, questions and opportunities that serve none.
- `ref` is a short unique label for each suggestion, such as `s1`.
- Put the suggestions in `payload.suggestions`, most useful first.

## Business cases

Draft the figures of a business case where the engagement supports them, so the consultant has a first estimate to check with the client.

- For a suggested opportunity, put the figures in its `valueCase`. Pain points and questions have `valueCase: null`.
- For opportunities already in the engagement that have no business case (`unsizedOpportunityIds`), add an entry to `payload.valueCases` with the opportunity's `recordId`, the step IDs it changes in `nodeIds` (empty means its linked steps) and the figures in `valueCase`. Skip an opportunity you cannot size.
- The figures are `shareOfCasesPct` (the share of cases the change affects, 0 to 100), `effortReductionPct` (how much of the hands-on time on the affected steps goes away, 0 to 100), `durationReductionPct` (how much elapsed time goes away, 0 to 100), `oneTimeCost` and `annualRunningCost` (in the engagement's currency). AIxRay works out hours and money from these with the step efforts, the volume and the hourly rate in the engagement, so do not repeat those.
- Use only figures the engagement supports: assumptions, step efforts and durations, scenario measures, findings and source facts. For each figure, say where it comes from in `sources` under the same name, such as "assumption annualVolume and the share of claims routed to review in finding Manual triage". A figure without a source is left blank.
- Leave a figure `null` rather than guess. Costs are usually `null` unless the engagement gives them.
- `confidence` on the business case is `high` only when every figure comes straight from the engagement, `medium` when one is an inference, and `low` when most are.
- Put `valueCases` in the payload even when it is empty.
