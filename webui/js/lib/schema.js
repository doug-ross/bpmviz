/*
 * BPMVIZ schema: identifiers, enumerations and display labels for the
 * portable engagement format (schema "bpmviz.engagement", version 1).
 * The JSON Schema in webui/schema/engagement.schema.json documents the same
 * contract; validate.js enforces it.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./util.js"));
  else { const B = root.BPMVIZ = root.BPMVIZ || {}; B.schema = factory(B.util); }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util) {
  "use strict";

  const SCHEMA_ID = "bpmviz.engagement";
  const SCHEMA_VERSION = 1;

  /* Each enum lists [value, label]. The first entry is the default. */
  const ENUM_DEFS = {
    laneType: [["human", "People"], ["agent", "Automation or AI agent"], ["external", "External party"]],
    modelRole: [["current", "Current state"], ["future", "Future state"]],
    modelStatus: [["baseline", "Baseline"], ["draft", "Draft"], ["proposed", "Proposed"]],
    dataStatus: [
      ["demonstration", "Demonstration data"],
      ["supplied", "Supplied scenario"],
      ["observed", "Observed data"]
    ],
    confidentiality: [
      ["internal", "Internal"], ["client-confidential", "Client confidential"],
      ["restricted", "Restricted"], ["public", "Public"]
    ],
    timeCalendar: [["calendar", "Calendar time"], ["business", "Business time"]],
    membership: [["included", "In scenario"], ["excluded", "Not in scenario"], ["unknown", "Not confirmed"]],
    scenarioProvenance: [["illustrative", "Illustrative"], ["supplied", "Supplied"], ["observed", "Observed"]],
    timingMethod: [
      ["explicit-visits", "Explicit visits"],
      ["proportional-scale", "Scaled from a representative route"],
      ["population-illustration", "Population illustration"]
    ],
    recordKind: [
      ["pain", "Pain point"], ["opportunity", "Opportunity"], ["question", "Open question"],
      ["decision", "Decision"], ["action", "Action"], ["assumption", "Assumption"], ["note", "Note"]
    ],
    recordStatus: [["open", "Open"], ["in-progress", "In progress"], ["done", "Done"], ["dropped", "Dropped"]],
    priority: [["", "Not set"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]],
    effortSize: [["", "Not set"], ["S", "Small"], ["M", "Medium"], ["L", "Large"]],
    intervention: [
      ["", "Not chosen"],
      ["eliminate", "Eliminate the step"],
      ["simplify", "Simplify"],
      ["standardize", "Standardize"],
      ["integrate", "Integrate systems"],
      ["orchestrate", "Orchestrate handoffs"],
      ["deterministic-automation", "Rules-based automation"],
      ["self-service", "Self-service"],
      ["ai-assist", "AI assistance (human decides)"],
      ["ai-agent", "AI agent (acts within limits)"],
      ["control-data", "Control or data improvement"]
    ],
    evidenceStatus: [
      ["unreviewed", "Not reviewed"], ["validated", "Validated"],
      ["disputed", "Disputed"], ["unavailable", "Source unavailable"]
    ],
    provenanceSource: [
      ["unknown", "Unknown"], ["source-document", "Source document"], ["client", "Client provided"],
      ["consultant-estimate", "Consultant estimate"], ["generated", "Generated draft"], ["workshop", "Workshop capture"]
    ],
    validation: [["unvalidated", "Not validated"], ["validated", "Validated"], ["disputed", "Disputed"]],
    assumptionStatus: [["illustrative", "Illustrative"], ["supplied", "Supplied"], ["observed", "Observed"], ["validated", "Validated"]],
    waitType: [["", "Not set"], ["none", "No wait"], ["queue", "Queue wait"], ["external", "External party wait"], ["other", "Other delay"]],
    edgeType: [
      ["sequence", "Sequence"], ["conditional", "Conditional"], ["default", "Default"],
      ["loop", "Loop back"], ["sample", "Sampled"], ["message", "Message"]
    ],
    change: [["unchanged", "Unchanged"], ["modified", "Modified"], ["added", "Added"], ["removed", "Removed"]],
    aiTask: [
      ["extract", "Extract a current state"], ["opportunities", "Suggest opportunities"],
      ["future-state", "Draft a future state"], ["summary", "Draft a handoff summary"],
      ["log-mapping", "Map event log activities to steps"]
    ],
    aiProvider: [["claude", "Claude (Claude Code)"], ["codex", "ChatGPT (Codex)"], ["other", "Other assistant"]],
    aiSurface: [["cli", "Command line"], ["skill", "Agent skill"], ["app", "In-app helper"]],
    aiPlan: [
      ["unknown", "Plan not known"],
      ["commercial", "Commercial plan (Claude Team or Enterprise, ChatGPT Business or Enterprise)"],
      ["consumer", "Consumer plan (Claude Pro or Max, ChatGPT Plus or Pro)"]
    ],
    narrativeKind: [["executive-summary", "Executive summary"]],
    narrativeStatus: [["draft", "Draft"], ["reviewed", "Reviewed"]],
    datasetRole: [["baseline", "Baseline"], ["after", "After the change"]],
    logFormat: [["csv", "Comma-separated text"], ["tsv", "Tab-separated text"], ["xlsx", "Excel workbook"]],
    timestampMode: [["single", "One timestamp per event"], ["start-end", "Start and end timestamps"]],
    caseIdHandling: [["hashed", "Hashed"], ["sequence", "Numbered in sequence"], ["original", "Original IDs kept"]],
    mappingMethod: [
      ["exact", "Same name"], ["fuzzy", "Similar name"], ["ai", "Suggested by AI"],
      ["manual", "Chosen by hand"], ["ignored", "Left out"]
    ],
    wave: [["", "Not set"], ["now", "Now"], ["next", "Next"], ["later", "Later"]],
    confidence: [["", "Not set"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]],
    valueInputSource: [["manual", "Entered by hand"], ["dataset", "From an event log"]],
    reviewVerdict: [["confirm", "Confirm"], ["dispute", "Dispute"], ["unsure", "Not sure"]],
    reviewFormat: [["html", "Web page"], ["xlsx", "Excel workbook"]]
  };

  const ENUMS = {};
  const LABELS = {};
  Object.keys(ENUM_DEFS).forEach(key => {
    ENUMS[key] = ENUM_DEFS[key].map(pair => pair[0]);
    LABELS[key] = Object.fromEntries(ENUM_DEFS[key]);
  });

  /*
   * Semantic node types. `shape` drives rendering; `replay` says whether the
   * replay engine knows the type's meaning. Anything else is shown with a
   * warning instead of being dropped.
   */
  const SEMANTIC_TYPES = {
    startEvent: { shape: "start", label: "Start event", replay: true },
    messageStartEvent: { shape: "start", label: "Message start event", replay: true },
    timerStartEvent: { shape: "start", label: "Timer start event", replay: true },
    endEvent: { shape: "end", label: "End event", replay: true },
    terminateEndEvent: { shape: "end", label: "Terminate end event", replay: true },
    intermediateEvent: { shape: "event", label: "Intermediate event", replay: false },
    messageEvent: { shape: "event", label: "Message event (wait)", replay: false },
    task: { shape: "task", label: "Task", replay: true },
    userTask: { shape: "task", label: "User task", replay: true },
    manualTask: { shape: "task", label: "Manual task", replay: true },
    serviceTask: { shape: "task", label: "Service task", replay: true },
    scriptTask: { shape: "task", label: "Script task", replay: true },
    businessRuleTask: { shape: "task", label: "Business rule task", replay: true },
    sendTask: { shape: "task", label: "Send task", replay: true },
    receiveTask: { shape: "task", label: "Receive task", replay: true },
    subProcess: { shape: "task", label: "Subprocess (collapsed)", replay: false },
    callActivity: { shape: "task", label: "Call activity", replay: false },
    exclusiveGateway: { shape: "gateway", label: "Exclusive gateway", replay: true, mark: "x" },
    parallelGateway: { shape: "gateway", label: "Parallel gateway", replay: true, mark: "+" },
    inclusiveGateway: { shape: "gateway", label: "Inclusive gateway", replay: false, mark: "o" },
    eventBasedGateway: { shape: "gateway", label: "Event-based gateway", replay: false, mark: "e" },
    gateway: { shape: "gateway", label: "Gateway (type not declared)", replay: true, mark: "" },
    unsupported: { shape: "task", label: "Unsupported element", replay: false }
  };

  function typeInfo(semanticType) {
    return SEMANTIC_TYPES[semanticType] || SEMANTIC_TYPES.unsupported;
  }

  const RECORD_KIND_ORDER = ENUMS.recordKind.slice();

  /* Economic drivers used by the value model. Values live in engagement.assumptions. */
  const DRIVERS = [
    { key: "hourlyRate", label: "Fully loaded hourly rate", unit: "currencyPerHour" },
    { key: "annualVolume", label: "Annual eligible volume", unit: "casesPerYear" },
    { key: "productiveHoursPerFte", label: "Productive hours per FTE per year", unit: "hoursPerYear" },
    { key: "incrementalCostPerCase", label: "Incremental AI and service cost per case (future state)", unit: "currency" },
    { key: "beforeNonLaborCostPerCase", label: "Non-labor cost per case, current state", unit: "currency" },
    { key: "afterNonLaborCostPerCase", label: "Non-labor cost per case, future state", unit: "currency" },
    { key: "oneTimeInvestment", label: "One-time investment for the change", unit: "currency" }
  ];

  const LIMITS = {
    fileBytes: 10 * 1024 * 1024,
    models: 20,
    lanesPerModel: 60,
    nodesPerModel: 2000,
    edgesPerModel: 5000,
    scenarios: 200,
    visitsPerRun: 20000,
    records: 10000,
    evidence: 5000,
    assumptions: 500,
    narratives: 20,
    stringLength: 20000,
    detailDepth: 5,
    datasets: 12,
    datasetMapping: 2000,
    datasetVariants: 100,
    variantSteps: 200,
    datasetTransitions: 2000,
    scenariosPerDataset: 10,
    eventLogBytes: 25 * 1024 * 1024,
    eventLogEvents: 200000,
    eventLogCases: 100000,
    aiActivities: 500,
    reviewPacks: 100,
    reviews: 200,
    reviewEntries: 5000,
    reviewResponseBytes: 2 * 1024 * 1024
  };

  /* Files exchanged with client reviewers (see docs/extensions.md). */
  const REVIEW_RESPONSE_ID = "bpmviz.review-response";
  const REVIEW_PACK_ID = "bpmviz.review-pack";

  function blankEngagement(meta) {
    const now = util.nowIso();
    const m = meta || {};
    return {
      schema: SCHEMA_ID,
      schemaVersion: SCHEMA_VERSION,
      id: m.id || util.uid("eng"),
      revision: 0,
      createdAt: now,
      updatedAt: now,
      meta: {
        clientDisplayName: m.clientDisplayName || "",
        engagementName: m.engagementName || "",
        processName: m.processName || "Untitled process",
        confidentiality: m.confidentiality || "internal",
        dataStatus: m.dataStatus || "supplied",
        timeBasis: m.timeBasis || { unit: "minute", calendar: "calendar", businessMinutesPerDay: 480 },
        currency: m.currency || "USD",
        disclosure: m.disclosure || "",
        summary: m.summary || "",
        credits: m.credits || ""
      },
      milestones: [],
      models: [],
      scenarios: [],
      records: [],
      evidence: [],
      assumptions: [],
      narratives: [],
      datasets: [],
      reviewPacks: [],
      reviews: [],
      migration: null
    };
  }

  function label(enumName, value) {
    const table = LABELS[enumName];
    return table && table[value] != null ? table[value] : String(value == null ? "" : value);
  }

  return {
    SCHEMA_ID, SCHEMA_VERSION, ENUMS, LABELS, SEMANTIC_TYPES, RECORD_KIND_ORDER,
    DRIVERS, LIMITS, REVIEW_RESPONSE_ID, REVIEW_PACK_ID, typeInfo, blankEngagement, label
  };
});
