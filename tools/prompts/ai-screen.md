# Task: draft screening scores

The engagement block holds a screening: candidate processes that a consultant is choosing between, and the criteria they are scored on. Draft scores for the criteria each candidate still needs (`toScore`), so the consultant has a first view to discuss with the client.

- Each criterion has a `label`, a `help` text and `anchors` that say what a score of 1, 3 and 5 means. Every criterion is worded so that a higher score is better. Score from 1 to 5 against those anchors, in whole numbers.
- Score only the criteria listed in a candidate's `toScore`, using the candidate and criterion IDs exactly as given. Scores with `origin: "person"` were given by people: use them as context, do not change them. Scores with `origin: "ai-draft"` are earlier AI drafts that nobody has reviewed yet; you may score those criteria again.
- Work from what each candidate says: its `name`, `description`, yearly `facts` and, when it came from a project, `fromProject` (steps, opportunities, whether an event log exists). General process knowledge is fine when the rationale says it is an assumption.
- When the material does not say enough to score a criterion, return `value: null` and say in the rationale what the consultant should ask. A blank is better than a guess. Criteria about the client's organization, such as the sponsor or the client's priorities, usually need `null` unless the material says something.
- `confidence` is `high` when the material states it directly, `medium` when it is implied, and `low` when it rests on general knowledge of this kind of process.
- `rationale` is one or two sentences naming what in the material supports the score, in plain words the client could read. Name processes and criteria by their names, never by their IDs.
- Do not compare candidates in a rationale and do not recommend which process to start with. The ranking is worked out from the scores.
- Put the scores in `payload.scores`, one entry per candidate and criterion.
