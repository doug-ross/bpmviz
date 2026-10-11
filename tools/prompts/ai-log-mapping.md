# Task: map event log activities to process steps

The engagement block holds the steps of one process model (`steps`: ID, label, swimlane and description) and the activity names found in an event log (`activities`). Suggest which step each activity belongs to, so the log can be measured against the model.

- Return one mapping per activity name in `payload.mappings`, with `activity` copied exactly as given (same spelling, case and spacing). Do not add names that are not in the list.
- `nodeId` is the ID of one step from `steps`, or `null` when no step fits. Leave an activity unmapped rather than guess: system events, notifications, comments and housekeeping (for example "Email sent" or "Record viewed") usually have no step.
- Several activities may map to the same step, for example "Start review" and "Complete review". One activity maps to at most one step.
- Match on meaning, not only on spelling: abbreviations, synonyms, other languages and system codes count when the label or description supports them.
- `confidence` is `high` when the names say the same thing, `medium` when the description or the swimlane supports the match, and `low` when it is a plausible guess the consultant should check.
- `rationale` is one short sentence on why the activity belongs to the step, naming the step by its label. For an unmapped activity, say why no step fits.
- You only see names. Do not invent volumes, timings or people.
