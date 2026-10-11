# Task: extract a current state from source documents

You are running unattended. Nobody can answer questions while this task runs.

Build one AIxRay engagement file for the **current state only** of the process the sources describe, following the engagement rules below. Do not draft a future state; the consultant does that later with the client.

- Wherever you would ask a question, add an open question record instead (`kind: "question"`, `includeInHandoff: true`) and carry on.
- Set `meta` from the job details in the message: confidentiality, data status and any names given. Use `dataStatus` exactly as given.
- Every step's `provenance.validation` is `unvalidated`. Every evidence item's `status` is `unreviewed`. Do not add links.
- Add one evidence item per source document, and cite locators such as `[p12]`, `[slide 3]` or `[page 4]` from the extracted text in `locator` and `extractedFact`.
- Scenarios are optional. If the sources give no timings, leave `scenarios` empty rather than invent them. If you add one, label it illustrative and follow the timing rules.
- Use `"migration": { "sourceFormat": "AI extraction", "sourceFiles": [the source names], "warnings": [...] }` for simplifications and inferences.

{{OUTPUT}}

---

# Engagement rules

{{GENERATOR_RULES}}
