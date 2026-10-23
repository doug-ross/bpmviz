# Value goals

Success for IT and success for the business are not the same thing. A process can run faster and still not move what the client cares about. Value goals record what the client counts as value for this work, in the client's own terms, so the business case answers the question the client is asking. Read each goal back to the client and ask: is this what value means to you?

## What a goal holds

| Field | What to put in it |
|---|---|
| Goal | A short statement, such as "Cut the cost of handling a claim" |
| Kind | Grow revenue, Reduce cost, New capability, Reduce risk, Customer or employee experience, or Other |
| Measured by | What the client would measure it by, such as "Cost per claim" |
| Today and Target | Numbers, with a unit such as `$`, `days` or `% of claims`. Leave them blank until the client gives them |
| By | The date the client wants the goal met |
| Owner | The person or role on the client side who owns the goal |
| Basis | Illustrative, Provided, Measured or Confirmed, the same labels the business case uses |
| Source and In the client's words | Who said it or where it is written, and their words |
| Sensitive | Keeps the goal out of reports and exports unless you include it |

## Working with goals

- **Add and edit** goals in the Value tab, in the **Value goals** card. The card shows, for each goal, the opportunities that serve it, and counts the goals no opportunity serves yet.
- **Link opportunities** to goals in the opportunity dialog, under **Goals served**, or from the goal dialog. The opportunity register has a **Goals** column.
- **Delete** a goal from its dialog. It is also unlinked from every opportunity. Undo restores both.

## Drafting goals with AI

The **Suggest value goals** task reads meeting notes, transcripts or documents against the open project and drafts the goals the client stated, each with a source and the client's own words. It never invents a target: a figure is drafted only when someone in the sources gave it.

- Command line: `npm run ai -- goals --in <project file> <notes.docx> <transcript.txt>`
- Claude Code: `/aixray-goals <project file> <source files>`. Codex: `$aixray-goals`.
- The app, started with `npm run serve -- --ai`: **Suggest goals from documents with AI** in the Value goals card.

Open the result with Open, tick the goals that match what the client said and apply them. Each drafted goal is marked **AI draft** and has the basis Provided, never Measured or Confirmed. Drafted goals stay out of the report, the deck, the CFO one-pager and the pilot brief until someone checks them with the client and chooses **Mark AI goals reviewed**, or ticks the box in the goal's dialog.

Creating a project from documents (`extract`) also drafts goals when the sources state them, under the same rules.

## Where goals appear

- **Report**: a Value goals table after the scope, with the opportunities that serve each goal.
- **PowerPoint deck**: a Value goals slide after Scope, and a Goals served column on the Opportunities slide. Both appear only when the project has goals the deck may show.
- **CFO one-pager**: the portfolio page lists the goals and which opportunities serve each one. An opportunity's one-pager lists the goals it serves.
- **Pilot brief**: the goals served by the accepted changes, or by the opportunities in the brief before a checkpoint is recorded. Only reviewed goals that are not sensitive appear.
- **AI tasks**: the opportunities task sees the goals and links its suggestions to them. External assistant packets carry only reviewed goals that are not sensitive.

## For developers

`engagement.goals` is optional; a file without it keeps its shape. `lib/goals.js` loads before validation and holds the sanitizer, the report filters (`visibleGoals`, `goalsFor`, `servedBy`, `targetText`) and the store commands `goal/save`, `goal/delete`, `goal/markReviewed` and `goal/applySuggestions`, which the store adds to its own commands. An opportunity's `opportunity.goalIds` is kept only when given, and links to goals that are not in the file are removed with a warning.
