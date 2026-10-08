# Archived prototypes

These are the three earlier BPMVIZ apps and their generator prompts, kept for reference and as the source of the bundled examples. They are not maintained. Use `webui/index.htm` for real work.

| Folder | What it is | Converted example |
|---|---|---|
| `explorer-v1/` | The original single-process explorer with sample submissions, SLA bars and an event log | `webui/examples/rpa-delivery.engagement.json` |
| `racer-v1/` | The first before-and-after race explorer (cash transaction matching) | `webui/examples/cash-matching.engagement.json` |
| `racer-v2-astra/` | The v2 comparison explorer (commercial property underwriting), the basis of the current renderer | `webui/examples/underwriting.engagement.json` |
| `prompts/` | Generator prompts that produce the legacy JavaScript formats | Replaced by `tools/prompts/engagement-generator-prompt.md` |

A hosted copy of the original explorer was published at http://fpsbi.com/s/k2/bl2/.

## Known problems in these versions

The September 2026 audit (`docs/audit/`) found issues that are fixed in the current app but still present here:

- The original explorer shows a step as complete during its second (rework) visit, and marks a connector as used when only its destination was visited.
- The v2 explorer shows off-route outcomes (decline, rejection, lost submission) as complete at the end of a case, and formats business days as minutes in the scorecard.
- Four of the five v2 sample cases supply after-costs that do not match the declared $400 incremental cost.
- The original explorer labels static samples as live telemetry and inserts configuration text as HTML.

Character encoding in the original explorer's files was repaired in place; nothing else was changed.

## Converting your own legacy files

If you generated your own `process.js` (and `branding.js` and `samples.js`) with the old prompts, convert them:

```
node tools/convert-legacy.mjs path/to/folder-or-process.js --out my-process.engagement.json
```

Options and caveats are listed at the top of `tools/convert-legacy.mjs`. The converter runs the legacy JavaScript in Node, so only convert files you trust.
