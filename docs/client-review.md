# Review forms

A review form asks a client stakeholder to check the process as the team captured it. The form lists the steps of one process model and the findings from the workshop. For each item the reviewer chooses Confirm, Dispute or Not sure and can add a comment. The answers come back as a file that you open in AIxRay, and applying them marks the steps confirmed or disputed.

The form works without AIxRay. It is either a web page that opens from the file in any current browser, or an Excel workbook.

## Making a review form

1. In Present, choose **Send for review**. Once the project has a review form or answers, Findings also has a **Reviews** tab with a **Send for review** button.
2. Enter the reviewer's name, role and organization. The name is required so that forms and answers can be told apart.
3. Choose the process and the format: **Web page (opens in any browser)** or **Excel workbook**.
4. Under **What to include**, choose what goes in. Steps and decision points are on by default, as are pain points, opportunities, decisions and assumptions. Open questions and **Business case figures** can be added. The dialog shows how many items of each kind the form will hold.
5. Optionally add a note to the reviewer, then choose **Download review form**. The file downloads, and the form is recorded in the project so that the answers can be matched to it later.

What goes into a review form:

- Steps: the name, the type (step or decision point), the lane, and the description with the Who and Systems details. Start, end and intermediate events are left out.
- Findings: findings included in the report that are linked to the chosen model or to no model, and that are not dropped. Each finding carries its title, description and the names of its linked steps.
- Sensitive findings are left out unless **Include sensitive findings** is ticked in the Present bar. AI drafts not yet reviewed are left out unless **Include unreviewed AI drafts** is ticked. The Send for review dialog says which applies.
- Business case figures, only when ticked: the project assumptions with a value (such as the hourly rate and the annual volume), and for each opportunity that passes the same checks as findings, each figure set in its business case: the labor estimate's effort and duration reduction, share of cases, one-time and running cost and realizable share, and each value line's inputs and realizable share. Each figure is listed with its value, under the opportunity's name. Figures drafted with AI and not yet reviewed, and a share of cases read from an event log, are left out.
- The project title, client and project names, data status, confidentiality and disclosure. Nothing else from the project is in the file: no other figures, no other findings, no sources and no notes.

A recorded form can be downloaded again from the Reviews tab with **Download again**. It is rebuilt from the current project with the same form reference, so answers to either copy match. The findings are checked again: a finding that has since been marked sensitive, dropped or taken out of the report, or an AI draft not yet reviewed, is left out, and AIxRay says how many items were left out. To send a sensitive finding, make a new form from the Present bar with **Include sensitive findings** ticked.

## The web page form

The reviewer opens the file in a browser. The page lists the steps by lane and the findings by type. The reviewer fills in their name and role, answers each item and adds comments, then chooses **Save answers**. That downloads an answers file (`review-response-<name>-<pack>.json`) to send back to the team.

The page stores nothing in the browser and sends nothing anywhere. To continue a review later, the reviewer saves their answers, opens the page again and chooses **Open saved answers**. Answers from a different review form are not loaded.

How the page is kept safe:

- Its content security policy allows only the page's own script and style, identified by their SHA-256 hashes, and blocks every network request, form submission and base URL change.
- The form data is embedded as JSON with `<`, `>`, `&`, the line and paragraph separators and every character outside ASCII written as `\u` escapes, so project text cannot end the script block. The file is ASCII only.
- The page shows project text with `textContent` and has no inline event handlers.

## The Excel form

The workbook has three sheets:

- **About**: the project, who the form is for, how to answer, and cells for **Your name**, **Your role**, **Your organization** and **General comment**. It also shows the **Form reference**, **Project reference** and **Project version**.
- **Review**: one row per item with the columns Item ID, Type, Lane, Item, Details, Your answer and Your comment. The Your answer column offers a list of Confirm, Dispute and Not sure.
- **aixray-pack** (hidden): the form reference, project reference and project version.

Every cell is written as text or a number, so no cell is a formula. Text that starts with =, +, - or @ (or a tab) gets a leading apostrophe, as in the CSV exports, so it stays text when the reviewer edits the cell or saves the sheet as CSV. AIxRay removes the apostrophe again when it reads the workbook back.

When the workbook comes back, open it with **Open**. AIxRay recognizes it by the hidden sheet, or by the About and Review sheets when a re-save lost the hidden sheet. Columns on the Review sheet are found by their headers, so moved columns still read. Answers in the Your answer column are read generously: Yes, Correct and OK count as Confirm; No, Wrong and Disagree count as Dispute; Maybe and Don't know count as Not sure. Anything else is treated as no answer and listed as a warning; it is never read as Confirm. If the workbook has no submission date, the file's last-modified time is used.

## Importing the answers

Open the answers file or the filled-in workbook with **Open**, or choose **Import answers** in the Reviews tab. AIxRay checks it first:

- Answers made for a different project are refused. Open that project and import them again.
- An answers file larger than 2 MB is refused.
- Answers for steps or findings that no longer exist are left out, with a note.
- A step renamed since the form was made is flagged with its name in the form, so you can check the answer still applies.
- Answers to a review form this project has no record of are still imported; the answers are matched by their item IDs.
- Importing the same answers twice is flagged.

The **Apply review answers** dialog shows the reviewer, the counts of confirmed, disputed, not sure and unanswered items, every warning, the general comment, and for each answer the effect it will have. Under **When you apply the answers**, you choose what applying does:

- **Update the steps** (on by default): a confirmed step becomes Confirmed and a disputed step becomes Disputed. Not sure leaves the step as it is. Findings have no confirmation status, so their answers are recorded with the review.
- **Mark business case figures the client confirmed as Confirmed** (on by default, shown when the answers include figures): a project assumption the client confirmed gets the status Confirmed. A part of a business case, the labor estimate or one value line, gets the basis Confirmed once every figure in it is confirmed, by this review or an earlier one. Until then each confirmed figure says how many in its part are still to confirm. A figure that changed since the form was made is flagged and not confirmed, since the answer was about the old value. A disputed figure with a comment becomes an open question named after the opportunity. Because every figure carries the basis of its weakest input, a business case only reads as Confirmed when its assumptions are confirmed too.
- **Add an open question** for each item that has a comment and was not confirmed. The question is linked to the step, or to the finding's steps, and quotes the reviewer.
- **Add the review as a source**, titled "Client review: name, role, organization, date", with status Confirmed, linked to the confirmed steps.

Choose **Apply answers**. Applying is one change, so a single Undo reverses all of it.

Applying works on a locked baseline. It changes only whether the steps are confirmed and which sources they link to; it never edits a step, and it never marks a future-state step as modified, because a client's confirmation is not a process change.

### When reviewers disagree

Each set of answers is kept as a separate review. For every item the latest answer, by submission date, is current. Answers without a submission date count from the time they are imported. Earlier answers stay visible in the Reviews tab and in the step's side panel. If you import older answers after newer ones, they are recorded but do not overwrite the status set by the newer ones, and the Apply review answers dialog says so.

## Where the answers show

- **Findings, Reviews**: this tab is listed while the open project has a review form or answers, and not for a project without them. It lists the **Review forms** created (with Download again and Delete), the **Reviews received** (with what each one changed), and the **Latest answer per item** with earlier answers beside it. The figures at the top are counted from the latest answer per item.
- **Process side panel**: a step that has answers shows a Review section with the latest answer, the reviewer, the comment, earlier answers and whether the step is confirmed.
- **Report**: a Review answers section after Sources lists who answered, the counts per answer from the latest answer per item (steps, findings and business case figures), and the items that were disputed or marked not sure with their comments. Sensitive findings and unreviewed AI drafts follow the Present bar settings.

Deleting a review's answers removes them from the project. Step statuses already set, the open questions and the source stay; use Undo straight after an import to reverse all of it. Deleting a review form removes its record; answers already imported stay.

## Data contract

Review forms are stored as packs in `engagement.reviewPacks[]` and received reviews in `engagement.reviews[]`, as described in `webui/schema/engagement.schema.json`. Items are referred to as `step/<modelId>/<nodeId>`, `record/<recordId>`, `value/<recordId>/<field>` for a business case figure (`vc.<key>` for the labor estimate, `vl.<lineId>.<key>` for a value line) or `assumption/<assumptionId>`. A review's `applied.values` counts the bases it marked Confirmed, and is kept only when there were some. An answers file follows `webui/schema/review-response.schema.json` (`schema: "aixray.review-response"`); an entry's verdict may be empty when the reviewer gave none. A stored review entry without a verdict reads as Not sure, never as Confirm.

## For developers

- `webui/js/lib/reviews.js`: `buildPackItems(e, opts)`, `packCounts`, `newPack`, `packPayload`, `workbookSpec(pack, payload)`, `responseFromWorkbook(workbook)`, `normalizeVerdict`, `prepareApply(e, response)` giving `{ ok, errors, warnings, response, pack, items, counts }`, `buildApplyPayload(e, prepared, choices)` (with `bases` for the confirmed business case parts and assumptions), `valueInputsOf(record)`, `latestVerdicts(e)` and `summarize(e, opts)`. It registers the store commands `review/recordPack { pack }`, `review/apply { review, validations, questions, evidence, bases }`, `review/delete { id }` and `review/deletePack { id }`.
- `webui/js/lib/review-pack.js`: `buildPackHtml(payload)`, `readPackHtml(html)`, and `PACK_SCRIPT`, `PACK_STYLE` with their hashes `PACK_SCRIPT_SHA256` and `PACK_STYLE_SHA256`. After changing the pack script or style, update the two hash constants; `tests/unit/review-pack.test.mjs` fails with the expected values until they match.
- `webui/js/ui/client-review.js`: the Send for review action in Present, the Reviews tab in Findings, the JSON and Excel file handlers, the side panel section and the Review answers section of the report, all registered through `AIxRay.ext`.
- Tests: `tests/unit/reviews.test.mjs`, `tests/unit/reviews-values.test.mjs`, `tests/unit/review-pack.test.mjs`, `tests/browser/client-review.test.mjs` and `tests/browser/review-values.test.mjs`, with response fixtures in `tests/fixtures/reviews/`.
