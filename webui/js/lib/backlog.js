/*
 * AIxRay backlog: turns opportunity and action records into a delivery
 * backlog for Jira or Azure DevOps, or an Excel workbook. Opportunities
 * become Epics (Jira) or Features (Azure DevOps); actions become Tasks
 * (Jira) or User Stories (Azure DevOps). Acceptance criteria combine the
 * recorded validation action, the value case's targets and any open
 * questions linked to the same steps. Sensitive records and unreviewed AI
 * drafts are left out unless asked for.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./util.js"), require("./schema.js"), require("./exporting.js"));
  } else {
    const B = root.AIxRay = root.AIxRay || {};
    B.backlog = factory(B.util, B.schema, B.exporting);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, schema, exporting) {
  "use strict";

  const TRACKER_TYPE = {
    jira: { epic: "Epic", task: "Task" },
    azure: { epic: "Feature", task: "User Story" }
  };

  function stepLabels(e, record) {
    const map = new Map();
    e.models.forEach(m => m.nodes.forEach(n => map.set(m.id + "|" + n.id, n.label)));
    return record.linkedNodeIds.map(id => {
      if (record.linkedModelId) return map.get(record.linkedModelId + "|" + id) || id;
      const hit = e.models.map(m => map.get(m.id + "|" + id)).find(Boolean);
      return hit || id;
    });
  }

  /* Two records share a step when both link steps and at least one step id is common (and their models do not conflict). */
  function sharesStep(a, b) {
    if (!a.linkedNodeIds.length || !b.linkedNodeIds.length) return false;
    if (a.linkedModelId && b.linkedModelId && a.linkedModelId !== b.linkedModelId) return false;
    return a.linkedNodeIds.some(id => b.linkedNodeIds.includes(id));
  }

  function acceptanceCriteria(e, record, questions) {
    const criteria = [];
    const o = record.opportunity || {};
    if (o.validationAction) criteria.push(o.validationAction);
    const vc = o.valueCase;
    if (vc) {
      if (util.isFiniteNumber(vc.effortReductionPct)) criteria.push("Effort on the affected steps drops by " + util.formatNumber(vc.effortReductionPct, 1) + "%.");
      if (util.isFiniteNumber(vc.durationReductionPct)) criteria.push("Elapsed time on the affected steps drops by " + util.formatNumber(vc.durationReductionPct, 1) + "%.");
      if (util.isFiniteNumber(vc.shareOfCasesPct)) criteria.push("Reaches " + util.formatNumber(vc.shareOfCasesPct, 1) + "% of affected cases.");
    }
    questions.filter(q => sharesStep(record, q)).forEach(q => criteria.push("Open question: " + q.title));
    return criteria;
  }

  /**
   * Backlog items from an engagement's records: { epics, tasks }, each a list
   * of { id, type, title, description, owner, priority, status, steps,
   * acceptanceCriteria, sensitive }. opts: { includeSensitive, includeUnreviewedAi, ids }.
   */
  function backlogItems(e, opts) {
    const o = opts || {};
    const records = exporting.selectRecords(e, { includeSensitive: o.includeSensitive, includeUnreviewedAi: o.includeUnreviewedAi, ids: o.ids });
    const questions = records.filter(r => r.kind === "question");
    const build = (r, type) => ({
      id: r.id, type, title: r.title, description: r.description || "", owner: r.owner || "",
      priority: r.priority || "", status: r.status, steps: stepLabels(e, r),
      acceptanceCriteria: acceptanceCriteria(e, r, questions), sensitive: !!r.sensitive
    });
    return {
      epics: records.filter(r => r.kind === "opportunity").map(r => build(r, "epic")),
      tasks: records.filter(r => r.kind === "action").map(r => build(r, "task"))
    };
  }

  function rowsFor(items, trackerKey, headers) {
    return [headers].concat(items.map(it => [
      TRACKER_TYPE[trackerKey][it.type], it.title, it.description, it.owner,
      it.priority ? schema.label("priority", it.priority) : "",
      schema.label("recordStatus", it.status), it.steps.join("; "), it.acceptanceCriteria.join("\n")
    ]));
  }

  /** Jira's CSV importer columns. Cells that look like formulas are neutralized (see util.toCsv). */
  function toJiraCsv(items) {
    return util.toCsv(rowsFor(items, "jira", ["Issue Type", "Summary", "Description", "Assignee", "Priority", "Status", "Labels", "Acceptance Criteria"]));
  }

  /** Azure DevOps' work item CSV import columns. */
  function toAzureCsv(items) {
    return util.toCsv(rowsFor(items, "azure", ["Work Item Type", "Title", "Description", "Assigned To", "Priority", "State", "Tags", "Acceptance Criteria"]));
  }

  /** One workbook spec (for lib/xlsx.js writeWorkbook) with every item on a single sheet. */
  function toWorkbookSpec(items, props) {
    const headers = ["Type", "ID", "Title", "Description", "Owner", "Priority", "Status", "Linked steps", "Acceptance criteria"];
    const rows = [headers].concat(items.map(it => [
      it.type === "epic" ? "Epic / Feature" : "Task / User story", it.id, it.title, it.description, it.owner,
      it.priority ? schema.label("priority", it.priority) : "", schema.label("recordStatus", it.status),
      it.steps.join("; "), it.acceptanceCriteria.join("\n")
    ]));
    return {
      props: props || {},
      sheets: [{ name: "Backlog", headerRows: 1, freeze: { rows: 1 }, columns: [14, 16, 28, 40, 16, 10, 12, 30, 40], rows }]
    };
  }

  return { backlogItems, toJiraCsv, toAzureCsv, toWorkbookSpec };
});
