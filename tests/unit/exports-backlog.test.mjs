// Backlog export (lib/backlog.js): opportunities and actions turned into a
// Jira CSV, an Azure DevOps CSV, or a workbook spec.
import test from "node:test";
import assert from "node:assert/strict";
import { lib, tinyEngagement } from "./helpers.mjs";

const backlog = lib("backlog");
const { validateEngagement } = lib("validate");

function engagement(records) {
  const e = tinyEngagement();
  e.records = records;
  const r = validateEngagement(e);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r.engagement;
}

const VALUE_CASE = { effortReductionPct: 40, durationReductionPct: 10, shareOfCasesPct: 75, oneTimeCost: 1000, annualRunningCost: 0, confidence: "medium", basis: "supplied" };

test("opportunities become epics and actions become tasks, each with the steps they touch", () => {
  const e = engagement([
    { id: "o1", kind: "opportunity", title: "Automate the handoff", description: "Cuts manual rekeying.", owner: "Jo", priority: "high",
      linkedModelId: "m-current", linkedNodeIds: ["work", "fix"], opportunity: { validationAction: "Pilot with 10 cases", valueCase: VALUE_CASE } },
    { id: "a1", kind: "action", title: "Run the pilot", owner: "Sam", linkedModelId: "m-current", linkedNodeIds: ["fix"] },
    { id: "p1", kind: "pain", title: "Rekeying is slow", linkedModelId: "m-current", linkedNodeIds: ["fix"] }
  ]);
  const items = backlog.backlogItems(e, {});
  assert.equal(items.epics.length, 1);
  assert.equal(items.tasks.length, 1);
  const epic = items.epics[0];
  assert.equal(epic.type, "epic");
  assert.equal(epic.title, "Automate the handoff");
  assert.deepEqual(epic.steps, ["Do the work", "Fix"]);
  assert.ok(epic.acceptanceCriteria.includes("Pilot with 10 cases"));
  assert.ok(epic.acceptanceCriteria.some(c => /drops by 40%/.test(c)));
  assert.ok(epic.acceptanceCriteria.some(c => /drops by 10%/.test(c)));
  assert.ok(epic.acceptanceCriteria.some(c => /reaches 75% of cases/.test(c)));
  assert.equal(items.tasks[0].title, "Run the pilot");
});

test("a pain point and a question are not turned into backlog items", () => {
  const e = engagement([
    { id: "p1", kind: "pain", title: "Pain" },
    { id: "q1", kind: "question", title: "Question" },
    { id: "d1", kind: "decision", title: "Decision" }
  ]);
  const items = backlog.backlogItems(e, {});
  assert.deepEqual(items.epics, []);
  assert.deepEqual(items.tasks, []);
});

test("open questions on the same step are linked as acceptance criteria", () => {
  const e = engagement([
    { id: "o1", kind: "opportunity", title: "Automate scoring", linkedModelId: "m-current", linkedNodeIds: ["work"], opportunity: {} },
    { id: "o2", kind: "opportunity", title: "Unrelated opportunity", linkedModelId: "m-current", linkedNodeIds: ["check"], opportunity: {} },
    { id: "q1", kind: "question", title: "Who approves the automated score", linkedModelId: "m-current", linkedNodeIds: ["work"] },
    { id: "q2", kind: "question", title: "Not linked to any step" }
  ]);
  const items = backlog.backlogItems(e, {});
  const byId = Object.fromEntries(items.epics.map(i => [i.id, i]));
  assert.deepEqual(byId.o1.acceptanceCriteria, ["Open question: Who approves the automated score"]);
  assert.deepEqual(byId.o2.acceptanceCriteria, []);
});

test("sensitive records and unreviewed AI drafts are left out unless asked for", () => {
  const e = engagement([
    { id: "o1", kind: "opportunity", title: "Sensitive opportunity", sensitive: true, opportunity: {} },
    { id: "o2", kind: "opportunity", title: "Draft opportunity", generated: { task: "opportunities", provider: "claude", reviewed: false }, opportunity: {} },
    { id: "o3", kind: "opportunity", title: "Ordinary opportunity", opportunity: {} }
  ]);
  const items = backlog.backlogItems(e, {});
  assert.deepEqual(items.epics.map(i => i.id), ["o3"]);
  const all = backlog.backlogItems(e, { includeSensitive: true, includeUnreviewedAi: true });
  assert.deepEqual(all.epics.map(i => i.id).sort(), ["o1", "o2", "o3"]);
});

test("Jira and Azure DevOps CSVs use their own issue-type names and neutralize formula-like text", () => {
  const e = engagement([
    { id: "o1", kind: "opportunity", title: "=cmd|' /C calc'!A1", opportunity: {} },
    { id: "a1", kind: "action", title: "Follow up, with a comma", opportunity: null }
  ]);
  const items = backlog.backlogItems(e, {});
  const all = items.epics.concat(items.tasks);
  const jira = backlog.toJiraCsv(all);
  assert.match(jira, /^Issue Type,Summary,Description,Assignee,Priority,Status,Labels,Acceptance Criteria\r\n/);
  assert.match(jira, /^Epic,'=cmd\|' \/C calc'!A1,/m, "a leading = is neutralized with a leading apostrophe");
  assert.match(jira, /^Task,"Follow up, with a comma",/m);
  const azure = backlog.toAzureCsv(all);
  assert.match(azure, /^Work Item Type,Title,Description,Assigned To,Priority,State,Tags,Acceptance Criteria\r\n/);
  assert.match(azure, /^Feature,/m);
  assert.match(azure, /^User Story,/m);
});

test("toWorkbookSpec builds one sheet that lib/xlsx.js can write and read back", async () => {
  const zlib = await import("node:zlib");
  const xlsx = lib("xlsx");
  const e = engagement([
    { id: "o1", kind: "opportunity", title: "Automate the handoff", owner: "Jo", priority: "high", opportunity: { validationAction: "Pilot" } }
  ]);
  const items = backlog.backlogItems(e, {});
  const spec = backlog.toWorkbookSpec(items.epics.concat(items.tasks), { title: "Backlog" });
  assert.equal(spec.sheets.length, 1);
  assert.equal(spec.sheets[0].name, "Backlog");
  const bytes = await xlsx.workbookBytesAsync(spec, { deflateRaw: b => zlib.deflateRawSync(b) });
  const wb = await xlsx.readWorkbookAsync(bytes, { inflateRaw: (b, max) => zlib.inflateRawSync(b, max ? { maxOutputLength: max } : {}) });
  assert.deepEqual(wb.sheets[0].rows[0], ["Type", "ID", "Title", "Description", "Owner", "Priority", "Status", "Linked steps", "Acceptance criteria"]);
  assert.equal(wb.sheets[0].rows[1][2], "Automate the handoff");
  assert.equal(wb.sheets[0].rows[1][5], "High");
});
