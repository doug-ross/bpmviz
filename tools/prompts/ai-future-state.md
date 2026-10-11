# Task: draft a future state as a change set

Propose changes to the baseline model given in the engagement (`baselineModelId`). AIxRay copies the baseline and applies your changes one by one, so each step keeps its link to the baseline step it came from. A person chooses which changes to accept.

## Changes

- `modify` changes an existing step (`nodeId`). Give a new `label`, `laneRef`, `semanticType`, `details`, `tags`, `touchEffortMinutes` or `typicalDurationMinutes`, or `null` (or an empty list) to keep what is there.
- `insert` adds a step on a connector (`edgeId`), between the connector's two steps. `label` is required. Several inserts on the same connector are placed in the order given.
- `remove` takes a step out (`nodeId`); AIxRay reconnects its neighbours. Never remove start or end events. Remove a gateway only when you also deal with its branches.
- `lanes` lists new swimlanes you need: `ref` (a short label), `name`, `role` and `type` (`human`, `agent` or `external`). Refer to a new lane from a change with `laneRef` set to its `ref`, or to an existing lane with its ID.
- `semanticType` for a change is one of {{TASK_TYPES}}, or `null`.
- `details` keys are {{DETAIL_KEYS}}. Values are plain text.
- `tags` is `null`, or sets `bottleneck`, `agent` (an AI agent step) and `humanReview` (a person checks the output).

## Design rules

- Tie every change to a named step, bottleneck or record. `addressesRecordIds` lists the records it answers; `rationale` says why in one or two sentences.
- Keep approvals, delegated authority limits, segregation of duties, external confirmations and human authorization for material commitments.
- Tell rules-based automation (`serviceTask`, `businessRuleTask`) apart from AI assistance. Not every automated step is an AI agent.
- For each AI-enabled step, say in `details` what it does (`desc`), which systems it uses (`systems`), what it may not authorize (`authority`), when it hands back to a person (`escalation`), which controls apply (`controls`) and who owns the outcome (`owner`).
- `touchEffortMinutes` is active human effort; `typicalDurationMinutes` is elapsed time. Leave them `null` when you cannot justify a number. AI does not shorten physical work, customer decisions or external response times; if you make one faster, say why in `rationale`.
- Keep the change set focused, usually 3 to 15 changes. Give `name` (a short draft name) and `summary` (two or three sentences on the design).
