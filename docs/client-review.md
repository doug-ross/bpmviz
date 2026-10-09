# Client review packs

A client review pack asks a client stakeholder to check the process as the team captured it. The pack lists the steps of one process model and the findings from the workshop. For each item the reviewer chooses Confirm, Dispute or Not sure and can add a comment. The answers come back as a file that you open in BPMVIZ, and applying them updates the validation status of the steps.

The pack works without BPMVIZ. It is either a web page that opens from the file in any current browser, or an Excel workbook.

## Making a pack

1. In Present, choose **Client review pack**. Once the engagement has a pack or a response, Records also has a **Client review** tab with a **Make a review pack** button.
2. Enter the reviewer's name, role and organization. The name is required so that packs and answers can be told apart.
3. Choose the process model and the format: **Web page** or **Excel workbook**.
4. Choose what to include. Steps and decision points are on by default, as are pain points, opportunities, decisions and assumptions. Open questions can be added. The dialog shows how many items of each kind the pack will hold.
5. Optionally add a note to the reviewer, then choose **Make the pack**. The file downloads, and the pack is recorded in the engagement so that the answers can be matched to it later.

What goes into a pack:

- Steps: the name, the type (step or decision point), the swimlane, and the description with the Who and Systems details. Start, end and intermediate events are left out.
- Findings: records marked for the handoff that are linked to the chosen model or to no model, and that are not dropped. Each finding carries its title, description and the names of its linked steps.
- Sensitive records are left out unless **Include sensitive records** is ticked in the Present bar. AI drafts not yet reviewed are left out unless **Include AI drafts not yet reviewed** is ticked. The pack dialog says which applies.
- The engagement title, client and engagement names, data status, confidentiality and disclosure. Nothing else from the engagement is in the file: no figures, no other records, no evidence and no notes.

A recorded pack can be downloaded again from the Records tab. It is rebuilt from the current engagement with the same pack reference, so answers to either copy match. The findings are checked again: a finding that has since been marked sensitive, dropped or taken out of the handoff, or an AI draft not yet reviewed, is left out, and BPMVIZ says how many items were left out. To send a sensitive finding, make a new pack from the Present bar with **Include sensitive records** ticked.

## The web page pack

The reviewer opens the file in a browser. The page lists the steps by swimlane and the findings by type. The reviewer fills in their name and role, answers each item and adds comments, then chooses **Save response**. That downloads a response file (`review-response-<name>-<pack>.json`) to send back to the team.

The page stores nothing in the browser and sends nothing anywhere. To continue a review later, the reviewer saves a response, opens the page again and chooses **Load saved response**. A response from a different pack is not loaded.

How the page is kept safe:

- Its content security policy allows only the page's own script and style, identified by their SHA-256 hashes, and blocks every network request, form submission and base URL change.
- The pack data is embedded as JSON with `<`, `>`, `&`, the line and paragraph separators and every character outside ASCII written as `\u` escapes, so engagement text cannot end the script block. The file is ASCII only.
- The page shows engagement text with `textContent` and has no inline event handlers.

## The Excel pack

The workbook has three sheets:

- **About**: the engagement, who the pack is for, how to answer, and cells for **Your name**, **Your role**, **Your organization** and **General comment**. It also shows the pack reference, the engagement reference and the engagement revision.
- **Review**: one row per item with the columns Item ID, Type, Lane, Item, Details, Verdict and Comment. The Verdict column offers a list of Confirm, Dispute and Not sure.
- **bpmviz-pack** (hidden): the pack reference, engagement reference and revision.

Every cell is written as text or a number, so no cell is a formula. Text that starts with =, +, - or @ (or a tab) gets a leading apostrophe, as in the CSV exports, so it stays text when the reviewer edits the cell or saves the sheet as CSV. BPMVIZ removes the apostrophe again when it reads the workbook back.

When the workbook comes back, open it with **Open**. BPMVIZ recognizes it by the hidden sheet, or by the About and Review sheets when a re-save lost the hidden sheet. Columns on the Review sheet are found by their headers, so moved columns still read. Verdicts are read generously: Yes, Correct and OK count as Confirm; No, Wrong and Disagree count as Dispute; Maybe and Don't know count as Not sure. Anything else is treated as no answer and listed as a warning; it is never read as Confirm. If the workbook has no submission date, the file's last-modified time is used.

## Importing the answers

Open the response file or the filled-in workbook with **Open**, or choose **Import a response** in the Client review tab. BPMVIZ checks it first:

- A response made for a different engagement is refused. Open that engagement and import it again.
- A response file larger than 2 MB is refused.
- Answers for steps or findings that no longer exist are left out, with a note.
- A step renamed since the pack was made is flagged with its name in the pack, so you can check the answer still applies.
- A response to a pack this engagement has no record of is still imported; the answers are matched by their item IDs.
- Importing the same response twice is flagged.

The import dialog shows the reviewer, the counts of confirmed, disputed, not sure and unanswered items, every warning, the general comment, and for each answer the effect it will have. You choose what applying does:

- **Update step validation** (on by default): a confirmed step becomes Validated and a disputed step becomes Disputed. Not sure leaves the step as it is. Findings have no validation status, so their answers are recorded with the review.
- **Add an open question** for each disputed or unconfirmed item that has a comment. The question is linked to the step, or to the finding's steps, and quotes the reviewer.
- **Record the review as an evidence source**, titled "Client review: name, role, organization, date", with status Validated, linked to the confirmed steps.

Applying is one change, so a single Undo reverses all of it.

Applying works on a locked baseline. It changes only the validation status and evidence links of the steps; it never edits a step, and it never marks a future-state step as modified, because a client's confirmation is not a process change.

### When reviewers disagree

Each response is kept as a separate review. For every item the latest answer, by submission date, is current. A response without a submission date counts from the time it is imported. Earlier answers stay visible in the Client review tab and in the step's side panel. If you import an older response after a newer one, its answers are recorded but do not overwrite the validation set by the newer one, and the import dialog says so.

## Where the answers show

- **Records, Client review**: this tab is listed while the open engagement has a review pack or a response, and not for an engagement without them. It lists the packs made (with Download again and Delete), the responses received (with what each one changed), and the latest answer for every item with earlier answers beside it. The figures at the top are counted from the latest answer per item.
- **Process side panel**: a step that has answers shows a Client review section with the latest answer, the reviewer, the comment, earlier answers and the step's validation status.
- **Handoff summary**: a Client review section after Evidence lists who responded, the counts per verdict from the latest answer per item, and the items that were disputed or marked not sure with their comments. Sensitive findings and unreviewed AI drafts follow the Present bar settings.

Deleting a response removes its answers from the engagement. Validation already set on steps, the open questions and the evidence source stay; use Undo straight after an import to reverse all of it. Deleting a pack removes its record; responses already imported stay.

## Data contract

Packs are stored in `engagement.reviewPacks[]` and received reviews in `engagement.reviews[]`, as described in `webui/schema/engagement.schema.json`. Items are referred to as `step/<modelId>/<nodeId>` or `record/<recordId>`. A response file follows `webui/schema/review-response.schema.json` (`schema: "bpmviz.review-response"`); an entry's verdict may be empty when the reviewer gave none. A stored review entry without a verdict reads as Not sure, never as Confirm.

## For developers

- `webui/js/lib/reviews.js`: `buildPackItems(e, opts)`, `packCounts`, `newPack`, `packPayload`, `workbookSpec(pack, payload)`, `responseFromWorkbook(workbook)`, `normalizeVerdict`, `prepareApply(e, response)` giving `{ ok, errors, warnings, response, pack, items, counts }`, `buildApplyPayload(e, prepared, choices)`, `latestVerdicts(e)` and `summarize(e, opts)`. It registers the store commands `review/recordPack { pack }`, `review/apply { review, validations, questions, evidence }`, `review/delete { id }` and `review/deletePack { id }`.
- `webui/js/lib/review-pack.js`: `buildPackHtml(payload)`, `readPackHtml(html)`, and `PACK_SCRIPT`, `PACK_STYLE` with their hashes `PACK_SCRIPT_SHA256` and `PACK_STYLE_SHA256`. After changing the pack script or style, update the two hash constants; `tests/unit/review-pack.test.mjs` fails with the expected values until they match.
- `webui/js/ui/client-review.js`: the Present action, the Client review records tab, the JSON and Excel file handlers, the side panel section and the handoff section, all registered through `BPMVIZ.ext`.
- Tests: `tests/unit/reviews.test.mjs`, `tests/unit/review-pack.test.mjs` and `tests/browser/client-review.test.mjs`, with response fixtures in `tests/fixtures/reviews/`.
