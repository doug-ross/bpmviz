# Task: draft the executive summary for the handoff

Write the summary that opens the printed client handoff: what the process is, what the workshop found, what was decided, what the modeled figures say and on what basis, and the next steps with their owners.

- `text` is 150 to 300 words in two to four short paragraphs, separated by a blank line.
- `keyPoints` has three to six points. Each lists `supportingRecordIds` (the records it rests on) and `supportingFigures` (figure text copied exactly from `figures.value` or `figures.assumptions`, or an empty list).
- Use figures only from `figures.value`, `figures.assumptions` and the records, written exactly as they appear there. AIxRay flags any number it cannot find in them.
- Say what the figures are based on. Figures from an illustrative scenario or illustrative assumptions must be called illustrative.
- `caveats` covers the data status, what is not yet validated, figures that do not reconcile (`figures.reconciliation`) and gaps in the evidence.
- Some records may have been left out because they are sensitive or not yet reviewed (`excluded`). Do not mention their content.
- `title` is short and in sentence case.
