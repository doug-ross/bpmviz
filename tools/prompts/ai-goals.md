# Task: draft value goals

The sources are meeting notes, transcripts or documents from the client. The engagement block is the AIxRay project they belong to. Draft the client's value goals: what the client counts as value for this work, in the client's own terms. The consultant will read each goal back to the client and ask "is this what value means to you?", so a goal the client did not say is worse than no goal.

- A goal is a business outcome, not an IT outcome. Ask what the client wants more or less of: revenue, cost, a new capability, risk, or the experience of customers or employees. `kind` is one of {{GOAL_KINDS}}.
- Draft only goals the sources state or clearly imply. Do not add goals from general knowledge of this kind of process.
- `title` is a short statement of the goal in plain words, such as "Cut the cost of handling a claim".
- `metric` is what the client would measure it by, such as "Cost per claim" or "Days from application to decision". Leave it empty when the sources do not say.
- `baseline` is today's figure and `target` is the figure the client wants, as numbers, with `unit` such as `$`, `days` or `% of claims`. Use `null` unless a person in the sources gave the number. Never work out or invent a number.
- `by` is the date the client wants the goal met, as YYYY-MM-DD, or empty.
- `owner` is the person or role on the client side who owns the goal, when the sources name one; otherwise empty.
- `source` names where the goal comes from: the document and a locator such as `[p3]`, `[slide 4]` or `[02:19]`, and the speaker when the sources show one.
- `quote` is the client's own words that support the goal, copied exactly, at most 300 characters. Leave it empty when there is no direct statement.
- `servedByRecordIds` lists the IDs of opportunities in the engagement that would serve the goal, exactly as given. Leave it empty when none does.
- Goals already in the engagement (`goals`) do not need drafting again. Goals with `origin: "ai-draft"` are earlier AI drafts that nobody has reviewed yet.
- `confidence` is `high` when the client states the goal directly, `medium` when it is implied, and `low` when it is an inference to test with the client.
- `rationale` is one or two sentences on why this is a goal for the client, in plain words the client could read.
- `ref` is a short unique label for each goal, such as `g1`.
- Put the goals in `payload.suggestions`, the ones the client stressed most first.
