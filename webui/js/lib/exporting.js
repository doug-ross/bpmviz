/*
 * BPMVIZ exporting: engagement JSON, record CSV and the client handoff summary.
 * Records marked sensitive are left out unless the caller asks for them.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./util.js"), require("./schema.js"), require("./units.js"), require("./economics.js"));
  } else {
    const B = root.BPMVIZ = root.BPMVIZ || {};
    B.exporting = factory(B.util, B.schema, B.units, B.economics);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, schema, units, economics) {
  "use strict";

  function engagementToJson(engagement) {
    return JSON.stringify(engagement, null, 2) + "\n";
  }

  function fileBase(engagement) {
    const m = engagement.meta || {};
    const parts = [m.clientDisplayName, m.processName].filter(Boolean).join(" ");
    return util.slug(parts || "engagement", 80) + "-r" + engagement.revision;
  }

  function nodeLabels(engagement) {
    const map = new Map();
    engagement.models.forEach(m => m.nodes.forEach(n => map.set(m.id + "|" + n.id, n.label)));
    return (record) => record.linkedNodeIds.map(id => {
      if (record.linkedModelId) return map.get(record.linkedModelId + "|" + id) || id;
      const hit = engagement.models.map(m => map.get(m.id + "|" + id)).find(Boolean);
      return hit || id;
    });
  }

  function isUnreviewedAi(item) {
    return !!(item && item.generated && !item.generated.reviewed);
  }

  const PROVIDER_NAMES = { claude: "Claude", codex: "ChatGPT" };

  /* "AI draft (Claude)" or "AI draft" when the assistant is not one BPMVIZ knows. */
  function aiPhrase(start, generated) {
    const who = PROVIDER_NAMES[generated && generated.provider];
    return start + (who ? " (" + who + ")" : "");
  }

  /* Who wrote a record: the workshop, or an AI assistant (reviewed or not). */
  function originLabel(item) {
    if (!item || !item.generated) return "Workshop";
    return aiPhrase("AI draft", item.generated) + (item.generated.reviewed ? ", reviewed" : ", not reviewed");
  }

  function selectRecords(engagement, options) {
    const o = options || {};
    return engagement.records.filter(r =>
      (o.includeSensitive || !r.sensitive) &&
      (o.includeUnreviewedAi || !isUnreviewedAi(r)) &&
      (!o.ids || o.ids.includes(r.id)) &&
      (!o.handoffOnly || r.includeInHandoff));
  }

  function recordsToCsv(engagement, options) {
    const labels = nodeLabels(engagement);
    const models = new Map(engagement.models.map(m => [m.id, m.name]));
    const evidence = new Map(engagement.evidence.map(e => [e.id, e.title]));
    const rows = [[
      "ID", "Kind", "Title", "Description", "Owner", "Status", "Priority", "Model", "Linked steps",
      "Evidence", "Intervention", "Simpler alternative considered", "Expected benefit", "Effort", "Risk",
      "Dependencies", "Validation action", "Sensitive", "Origin", "Created", "Updated"
    ]];
    selectRecords(engagement, options).forEach(r => {
      const o = r.opportunity || {};
      rows.push([
        r.id, schema.label("recordKind", r.kind), r.title, r.description, r.owner,
        schema.label("recordStatus", r.status), r.priority ? schema.label("priority", r.priority) : "",
        r.linkedModelId ? models.get(r.linkedModelId) || "" : "", labels(r).join("; "),
        r.evidenceRefs.map(id => evidence.get(id) || id).join("; "),
        o.intervention ? schema.label("intervention", o.intervention) : "", o.simplerAlternative || "",
        o.expectedBenefit || "", o.effort ? schema.label("effortSize", o.effort) : "", o.risk || "",
        o.dependencies || "", o.validationAction || "", r.sensitive ? "Yes" : "No", originLabel(r), r.createdAt, r.updatedAt
      ]);
    });
    return util.toCsv(rows);
  }

  /** Structured content for the printable handoff summary. */
  function buildHandoff(engagement, options) {
    const o = options || {};
    const meta = engagement.meta;
    const labels = nodeLabels(engagement);
    const all = engagement.records.filter(r => r.includeInHandoff);
    const chosen = selectRecords(engagement, { includeSensitive: o.includeSensitive, includeUnreviewedAi: o.includeUnreviewedAi, handoffOnly: true });
    const excludedUnreviewedAi = o.includeUnreviewedAi ? 0 : all.filter(r => isUnreviewedAi(r) && (o.includeSensitive || !r.sensitive)).length;
    const narrative = (engagement.narratives || []).find(n => n.kind === "executive-summary");
    let executiveSummary = null;
    if (narrative && (narrative.status === "reviewed" || o.includeUnreviewedAi || !narrative.generated)) {
      let disclosure = "";
      if (narrative.generated) {
        const lead = aiPhrase("Drafted with AI assistance", narrative.generated);
        disclosure = narrative.generated.reviewed ?
          lead + ", reviewed " + String(narrative.generated.reviewedAt || "").slice(0, 10) + "." :
          lead + ". Not yet reviewed.";
      } else if (narrative.status !== "reviewed") {
        disclosure = "Draft.";
      }
      executiveSummary = { title: narrative.title, text: narrative.text, status: narrative.status, disclosure };
    }
    const sections = {};
    schema.RECORD_KIND_ORDER.forEach(k => { sections[k] = []; });
    chosen.forEach(r => sections[r.kind].push({
      id: r.id, title: r.title, description: r.description, owner: r.owner,
      status: schema.label("recordStatus", r.status), priority: r.priority ? schema.label("priority", r.priority) : "",
      steps: labels(r), sensitive: r.sensitive, aiDraft: isUnreviewedAi(r),
      evidence: r.evidenceRefs.map(id => {
        const ev = engagement.evidence.find(x => x.id === id);
        return ev ? ev.title + " (" + schema.label("evidenceStatus", ev.status) + ")" : id;
      }),
      opportunity: r.opportunity ? {
        intervention: r.opportunity.intervention ? schema.label("intervention", r.opportunity.intervention) : "",
        expectedBenefit: r.opportunity.expectedBenefit, validationAction: r.opportunity.validationAction,
        effort: r.opportunity.effort ? schema.label("effortSize", r.opportunity.effort) : "", risk: r.opportunity.risk
      } : null
    }));
    const scenario = engagement.scenarios.find(s => s.id === o.scenarioId) || engagement.scenarios[0] || null;
    const ctx = { timeBasis: meta.timeBasis, currency: meta.currency };
    let value = null, reconciliation = null;
    if (scenario) {
      reconciliation = economics.reconcileScenario(engagement, scenario);
      value = reconciliation.value.outputs.filter(x => x.status === "calculated").map(x => ({
        label: x.label, text: units.formatMeasure(x.value, x.unit, ctx), formula: x.formula, basis: x.basis
      }));
    }
    const evidence = engagement.evidence;
    const count = s => evidence.filter(e => e.status === s).length;
    const current = engagement.models.find(m => m.role === "current");
    const noProvenance = current ? current.nodes.filter(n => !(n.sourceIds.length || n.provenance.evidenceRefs.length ||
      n.provenance.source !== "unknown")).length : 0;
    return {
      title: meta.processName,
      client: meta.clientDisplayName, engagementName: meta.engagementName,
      confidentiality: schema.label("confidentiality", meta.confidentiality),
      dataStatus: schema.label("dataStatus", meta.dataStatus),
      disclosure: meta.disclosure,
      timeBasis: units.describeTimeBasis(meta.timeBasis),
      revision: engagement.revision, generatedAt: util.nowIso(),
      models: engagement.models.map(m => ({
        name: m.name, role: schema.label("modelRole", m.role), version: m.version,
        status: schema.label("modelStatus", m.status), steps: m.nodes.filter(n => !n.removed).length
      })),
      scenario: scenario ? { name: scenario.name, provenance: schema.label("scenarioProvenance", scenario.provenance),
        timing: schema.label("timingMethod", scenario.timing.method), note: scenario.timing.note } : null,
      sections,
      executiveSummary,
      excludedUnreviewedAi,
      excludedSensitive: all.filter(r => r.sensitive).length - chosen.filter(r => r.sensitive).length,
      assumptions: engagement.assumptions.map(a => ({
        label: a.label, value: util.isFiniteNumber(a.value) ? units.formatMeasure(a.value, a.unit, ctx) : "Not set",
        status: schema.label("assumptionStatus", a.status), source: a.source
      })),
      value,
      reconciliation: reconciliation ? { status: reconciliation.status, warnings: reconciliation.warnings.map(w => w.message) } : null,
      evidence: {
        total: evidence.length, validated: count("validated"), unreviewed: count("unreviewed"),
        disputed: count("disputed"), unavailable: count("unavailable"),
        stepsWithoutProvenance: noProvenance, currentSteps: current ? current.nodes.length : 0
      }
    };
  }

  return { engagementToJson, fileBase, recordsToCsv, buildHandoff, selectRecords, isUnreviewedAi, originLabel, aiPhrase };
});
