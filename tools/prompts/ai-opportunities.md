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
- `ref` is a short unique label for each suggestion, such as `s1`.
- Put the suggestions in `payload.suggestions`, most useful first.
