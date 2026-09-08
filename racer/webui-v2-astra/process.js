/*
PROCESS.JS — Large Commercial Property Underwriting & Issuance

Source:
  Attached BPMN "large-commercial-property-sample-underwriting-master-gemflash.bpmn"
  — 40 flow nodes across 7 lanes. Before model aggregates 1:1 from the BPMN.

Mode:
  Before + Proposed AI-augmented After.

Representative route (both Before and After):
  Clearance passes → In appetite → Physical survey REQUIRED →
  Fac reinsurance REQUIRED → Within authority (no referral) →
  Broker binds (no negotiate loop) → Policy issued.
  Off-route branches (decline, referral-decline, submission-lost, negotiate
  loop) are drawn as connectors with detail sheets but are NOT scheduled
  on the timed critical path.

Lane aggregation:
  Before  = 7 BPMN lanes preserved 1:1.
  After   = 9 lanes: 3 AI agent lanes added + 6 retained human/external lanes.

Timing basis:
  Business minutes. 8-hour business day = 480 min. Weekends/holidays ignored.
  BASE_B = 15,360 min (32 business days).
  BASE_A =  7,440 min (15.5 business days).
  Cycle reduction ≈ 51.6%.

Documented facts (from BPMN):
  Node identity, lane assignment, sequence flows, gateway outcomes,
  parallel fork/join structure, negotiate-loop back-edge to layering,
  external fac market dependency, authority referral, subjectivities gate.

Estimated assumptions (NOT in source):
  All timings, volumes, cost, effort, FTE, TIV bands, broker & fac
  market wait durations, AI processing durations.

Proposed changes (After only):
  AI Intake & Triage Agent for clearance, SOV scrub/geocode, appetite,
  routing. AI Analytics Agent for CAT ingest, CAT metrics, layering
  draft, technical pricing draft, forms selection draft, fac slip draft,
  quote assembly. AI Policy Assembly Agent for dec-sheet/forms compile,
  PAS booking, delivery. HUMAN retained for: UW decisions on drafts,
  engineer sign-off, physical site survey, fac market placement, authority
  referral, bind-order review, OFAC sign-off, pre-commit QA.

Financial basis (illustrative):
  Rate: $150/hr blended loaded.
  Annual eligible volume: 400 large-commercial submissions.
  FTE productive hours: 1,800/yr.
  AI incremental cost: ~$400/submission (LLM inference + tooling).

Known limitations:
  - Physical site survey retained (still 4 business days after).
  - Fac reinsurance market wait retained (still 3 business days after).
  - Broker decision wait retained (still 3 business days after).
  - No live data — all metrics are illustrative.

Validation performed:
  Static review only. Sequential and join dependencies checked.
  Milestone times reconcile to node completions. Runtime/browser testing
  not performed.
*/

(function () {
  "use strict";

  function N(lane, x, type, label, sub, s, e, opt) {
    return Object.assign(
      { lane, x, type, label, sub, s, e, bs: s, be: e },
      opt || {}
    );
  }

  const COL = c => 90 + c * 240;

  // =========================================================
  // LAYOUT
  // =========================================================
  const layout = {
    LANE_TOP: 8,
    LH: 84,
    BASE_B: 15360,   // 32 business days
    BASE_A: 7440,    // 15.5 business days
    DURATION: 24000
  };

  // =========================================================
  // MILESTONES
  // =========================================================
  const milestones = {
    names: ["Received", "Cleared", "Assessed", "Quoted", "Bound", "Issued"],
    x:     [0.02,       0.15,      0.42,       0.65,      0.88,    1.00],
    baseB: [0,          720,       5040,       9720,      13200,   15360],
    baseA: [0,          65,        2705,       5165,      7025,    7440]
  };

  // =========================================================
  // BEFORE — Current-State Manual Workflow (7 lanes, 40 nodes)
  // =========================================================
  const beforeLanes = [
    { id: "ua",         name: "Underwriting Assistant / Operations", role: "Intake, clearance, scrubbing, subjectivities",       type: "human" },
    { id: "uw",         name: "Commercial Property Underwriter",     role: "Risk selection, structuring, pricing, quoting, bind", type: "human" },
    { id: "riskeng",    name: "Risk Engineering & Loss Prevention",  role: "COPE desk review, site survey, PML/MFL report",       type: "human" },
    { id: "catmodel",   name: "Exposure Management & CAT Modeling",  role: "SOV ingest, wind/flood/quake AAL & PML",              type: "human" },
    { id: "cededre",    name: "Ceded Reinsurance / Fac Placement",   role: "Facultative slip, market placement",                  type: "human" },
    { id: "uwauth",     name: "Technical UW Authority / Management", role: "Referral review, sign-off",                           type: "human" },
    { id: "policyops",  name: "Policy Operations & Issuance",        role: "Forms assembly, QA, PAS booking, delivery",           type: "human" }
  ];

  const beforeNodes = [
    // 0
    N("ua", COL(0), "start", "Submission Received", "From broker (email / API)", 0, 0, {
      detail: {
        desc: "Broker transmits a large-commercial property submission (SOV, loss runs, application, supplemental questionnaires).",
        who: "Producing broker",
        owner: "Underwriting Assistant",
        inputs: ["Submission email/API payload", "SOV workbook", "5-yr loss runs", "ACORD 125/140"],
        systems: ["Submission mailbox", "Broker portal"],
        note: "Maps to BPMN Start_SubmissionReceived (message start event)."
      }
    }),

    // 1
    N("ua", COL(1), "task", "Check Clearance & Dedup", "Manual UA review", 0, 120, {
      bott: true,
      detail: {
        desc: "UA searches PAS and clearance system to prevent duplicate quoting, broker-of-record conflicts, and prior declinations.",
        who: "Underwriting Assistant",
        owner: "UW Ops Manager",
        sla: "Target: same business day",
        effort: "~30–45 min active per submission",
        systems: ["Clearance system", "Policy Admin System (PAS)", "CRM"],
        controls: ["Broker-of-record rule", "Duplicate-account check"],
        pain: ["Manual keyword search misses variants of insured names", "Broker BOR letters not always attached"],
        note: "Maps to BPMN Task_ClearanceAndDedup."
      }
    }),

    // 2
    N("ua", COL(2), "gw", "Clearance Approved?", "Exclusive gateway", 120, 120, {
      detail: {
        desc: "Exclusive gateway on clearance outcome.",
        decisionRules: ["Clear → SOV scrub", "Conflict/Duplicate → decline letter"],
        note: "Maps to BPMN Gate_ClearancePassed."
      }
    }),

    // 3
    N("ua", COL(3), "task", "Send Decline Letter", "Off representative route", 120, 120, {
      opt: true,
      detail: {
        desc: "Standard decline letter for clearance conflicts or out-of-appetite submissions.",
        who: "Underwriting Assistant",
        note: "Not on animated route. Also target of AppetiteNo path."
      }
    }),

    // 4
    N("ua", COL(4), "end", "Rejected (Clearance/Appetite)", "Off route", 120, 120, {
      opt: true,
      detail: { desc: "Submission closed with decline/rejection notification.", note: "Off representative route." }
    }),

    // 5
    N("ua", COL(4), "task", "Scrub SOV & Geocode", "Manual data quality", 120, 480, {
      bott: true,
      detail: {
        desc: "UA cleans SOV inconsistencies (COPE gaps, TIV rounding, address normalization), geocodes locations, resolves occupancy codes.",
        who: "Underwriting Assistant",
        effort: "~4–8 active hrs for 100–500 location SOV",
        systems: ["Excel / SOV tooling", "Geocoding service"],
        pain: ["Location-level completeness varies wildly by broker", "Occupancy/construction free-text requires interpretation"],
        note: "Maps to BPMN Task_ScrubSOVAndGeocode (service task, but performed with heavy manual QA)."
      }
    }),

    // 6
    N("ua", COL(5), "task", "Appetite & Capacity Triage", "Rules check", 480, 600, {
      detail: {
        desc: "Line-of-business rules check: occupancy appetite, TIV bands, geography, aggregate capacity availability.",
        who: "UW Assistant, supported by rules engine",
        systems: ["Appetite rules engine", "Aggregate capacity tracker"],
        note: "Maps to BPMN Task_TriageAppetite (business rule task)."
      }
    }),

    // 7
    N("ua", COL(6), "gw", "Within Appetite?", "Exclusive gateway", 600, 600, {
      detail: {
        desc: "Exclusive gateway on appetite outcome.",
        decisionRules: ["In appetite → Assign UW", "Out of appetite → decline letter"],
        note: "Maps to BPMN Gate_AppetiteCheck."
      }
    }),

    // 8
    N("ua", COL(7), "task", "Assign to Underwriter", "Queue-based routing", 600, 720, {
      detail: {
        desc: "Routes submission to the appropriate commercial property UW by geography, industry, and TIV band.",
        who: "UW Ops team",
        note: "Maps to BPMN Task_AssignUnderwriter."
      }
    }),

    // 9
    N("uw", COL(8), "task", "Review COPE, Exposure & Loss Runs", "UW intake review", 720, 1680, {
      bott: true,
      detail: {
        desc: "UW reviews submission holistically: COPE data, loss history, protections, occupancy, business continuity exposures.",
        who: "Commercial Property Underwriter",
        effort: "~10–14 hrs across 2 business days",
        pain: ["Fragmented data across SOV, application, loss runs, broker email thread"],
        note: "Maps to BPMN Task_ReviewSubmissionCOPE."
      }
    }),

    // 10
    N("uw", COL(9), "gw", "Initiate Parallel Analysis", "Parallel fork", 1680, 1680, {
      detail: {
        desc: "Parallel gateway forking Risk Engineering desk review and CAT modeling ingestion.",
        note: "Maps to BPMN Fork_Assessments (parallel gateway)."
      }
    }),

    // 11 — RE branch
    N("riskeng", COL(10), "task", "Desk Review: COPE & Protections", "Engineer paperwork", 1680, 2160, {
      detail: {
        desc: "Risk engineer reviews COPE narrative, sprinkler classifications, protective systems, prior loss patterns.",
        who: "Risk Engineer",
        systems: ["Engineering knowledge base"],
        note: "Maps to BPMN Task_ReviewCOPEAndProtections."
      }
    }),

    // 12
    N("riskeng", COL(11), "gw", "On-site Survey Needed?", "Exclusive gateway", 2160, 2160, {
      detail: {
        desc: "Engineer determines whether physical inspection is required based on TIV, occupancy, prior surveys, and loss history.",
        decisionRules: ["Yes → schedule site survey", "No → desk-only report"],
        note: "Maps to BPMN Gate_PhysicalSurveyNeeded. Representative route selects YES."
      }
    }),

    // 13
    N("riskeng", COL(12), "task", "Perform On-Site Loss Prevention Survey", "Travel + inspection", 2160, 4560, {
      bott: true,
      exc: true,
      detail: {
        desc: "Field engineer visits site(s): construction verification, sprinkler test records, housekeeping, hot-work programs, business continuity walkthrough.",
        who: "Field Risk Engineer",
        effort: "~5 business days elapsed (scheduling, travel, inspection, notes)",
        pain: ["Scheduling with insured", "Multi-location schedules extend elapsed time significantly"],
        dependencies: ["Insured availability", "Travel logistics"],
        note: "Maps to BPMN Task_PerformPhysicalSiteSurvey. Physical dependency — cannot be automated away."
      }
    }),

    // 14
    N("riskeng", COL(13), "task", "Publish Risk Report: PML, MFL & Recs", "Engineer authored", 4560, 5040, {
      detail: {
        desc: "Formal risk engineering report: Probable Maximum Loss, Maximum Foreseeable Loss, protection assessment, recommendations.",
        who: "Risk Engineer",
        outputs: ["PML/MFL report", "Recs schedule"],
        note: "Maps to BPMN Task_CompleteEngineeringAssessment."
      }
    }),

    // 15 — CAT branch
    N("catmodel", COL(10), "task", "Ingest SOV into CAT Platform", "Manual mapping/QA", 1680, 1920, {
      detail: {
        desc: "Analyst loads scrubbed SOV into RMS/AIR, maps occupancy/construction codes, resolves geocoding warnings.",
        who: "CAT Modeling Analyst",
        systems: ["RMS RiskLink", "AIR Touchstone"],
        note: "Maps to BPMN Task_IngestSOVCATPlatform. BPMN types it service task, but requires manual mapping QA."
      }
    }),

    // 16
    N("catmodel", COL(11), "task", "Run Wind/Flood/Quake AAL & PML", "Model runs + interpretation", 1920, 2880, {
      bott: true,
      detail: {
        desc: "Executes CAT model runs, produces AAL, OEP/AEP curves at portfolio and account level, interprets uncertainty.",
        who: "CAT Modeling Analyst",
        effort: "~2 business days including run queue + interpretation",
        outputs: ["AAL by peril", "PML curves", "Portfolio impact memo"],
        note: "Maps to BPMN Task_RunCATLossMetrics."
      }
    }),

    // 17
    N("uw", COL(12), "gw", "Risk Insights Reunited", "Parallel join", 5040, 5040, {
      detail: {
        desc: "Join synchronizes RE and CAT results before UW can structure layering.",
        note: "Maps to BPMN Join_Assessments. Waits on max(RE=5040, CAT=2880) → 5040."
      }
    }),

    // 18
    N("uw", COL(13), "task", "Determine Layering & Participation", "Lead/Quota/Excess design", 5040, 5520, {
      detail: {
        desc: "Structures the placement: attachment, layers, participations, order of layers, quota share vs excess strategy.",
        who: "Commercial Property Underwriter",
        note: "Maps to BPMN Task_DetermineLayeringStructure. Also negotiate-loop return target."
      }
    }),

    // 19
    N("uw", COL(14), "task", "Technical Pricing & Rating", "Rate + credits/debits + CAT load", 5520, 6240, {
      detail: {
        desc: "Technical rate calc, schedule credits/debits, CAT loads, experience-rating credibility blending.",
        who: "Commercial Property Underwriter",
        systems: ["Rating engine", "Experience modification tool"],
        note: "Maps to BPMN Task_TechnicalPricingExperienceRating (business rule task)."
      }
    }),

    // 20
    N("uw", COL(15), "task", "Select Forms & Endorsements", "ISO / Manuscript", 6240, 6720, {
      detail: {
        desc: "Selects policy forms, endorsements, sublimits; drafts any manuscript wording deviations.",
        who: "Commercial Property Underwriter",
        note: "Maps to BPMN Task_SelectCoverageFormsManuscript."
      }
    }),

    // 21
    N("uw", COL(16), "gw", "Fac Reinsurance Required?", "Exclusive gateway", 6720, 6720, {
      detail: {
        desc: "Determines if the desired gross line exceeds net retention and treaty capacity, requiring facultative placement.",
        decisionRules: ["Yes → structure fac", "No → skip to authority check"],
        note: "Maps to BPMN Gate_ReinsuranceRequired. Representative route selects YES."
      }
    }),

    // 22
    N("cededre", COL(17), "task", "Structure Fac Placement Slip", "Slip drafting", 6720, 7200, {
      detail: {
        desc: "Ceded team drafts fac slip: exposure summary, PML, CAT metrics, layer being ceded, terms sought.",
        who: "Ceded Reinsurance Analyst",
        note: "Maps to BPMN Task_StructureFacPlacement."
      }
    }),

    // 23
    N("cededre", COL(18), "task", "Obtain Fac Binder from Market", "External reinsurance market", 7200, 9120, {
      bott: true,
      exc: true,
      detail: {
        desc: "Presents slip to fac reinsurance market, negotiates terms, obtains signed lines and binder confirmation.",
        who: "Ceded Reinsurance Broker & Analyst",
        effort: "~4 business days elapsed (market shopping, quotes, sign-down)",
        dependencies: ["External reinsurer response time", "Market conditions"],
        note: "Maps to BPMN Task_ObtainFacBinder. External counterparty wait — persistent even after AI adoption."
      }
    }),

    // 24
    N("uw", COL(19), "gw", "Exceeds UW Authority?", "Exclusive gateway", 9120, 9120, {
      detail: {
        desc: "Compares proposed terms (limit, deductible structure, manuscript wording) against delegated UW authority.",
        decisionRules: ["Exceeds → referral to authority", "Within → assemble quote"],
        note: "Maps to BPMN Gate_AuthorityLimitExceeded. Representative route selects WITHIN AUTHORITY."
      }
    }),

    // 25 — off-route referral
    N("uwauth", COL(20), "task", "Review Technical Referral", "Off representative route", 9120, 9120, {
      opt: true,
      exc: true,
      detail: {
        desc: "Technical UW authority reviews out-of-authority items and signs off, modifies, or declines.",
        who: "Technical UW Authority / UW Manager",
        note: "Off animated route (representative case is within authority). Preserved as available control."
      }
    }),

    // 26
    N("uwauth", COL(21), "gw", "Authority Sign-off?", "Off route", 9120, 9120, {
      opt: true,
      detail: { desc: "Approved / endorsed → quote; declined → risk exit.", note: "Off animated route." }
    }),

    // 27
    N("uwauth", COL(22), "end", "Risk Declined by Authority", "Off route", 9120, 9120, {
      opt: true,
      detail: { desc: "Terminal — declined by authority.", note: "Off animated route." }
    }),

    // 28
    N("uw", COL(20), "task", "Assemble Multi-Option Quote", "Primary / Excess / QS", 9120, 9600, {
      detail: {
        desc: "Compiles quote proposal: primary, excess layer, quota-share alternatives; premium options; conditions.",
        who: "Commercial Property Underwriter",
        note: "Maps to BPMN Task_AssembleQuoteOptions."
      }
    }),

    // 29
    N("uw", COL(21), "task", "Deliver Quote to Broker", "Formal proposal", 9600, 9720, {
      detail: {
        desc: "Formal quote proposal transmitted to broker with subjectivities list.",
        note: "Maps to BPMN Task_IssueQuoteToBroker."
      }
    }),

    // 30
    N("uw", COL(22), "gw", "Broker Response", "Bind / Negotiate / Lost", 9720, 11640, {
      exc: true,
      detail: {
        desc: "Gateway includes broker decision wait time (illustrative ~3–4 business days for large commercial).",
        decisionRules: ["Bind order → process bind", "Negotiate → return to layering", "Declined/expired → lost"],
        dependencies: ["Broker/insured decision cycle", "Competing carrier quotes"],
        note: "Maps to BPMN Gate_BrokerDecision. Representative route selects BIND."
      }
    }),

    // 31
    N("uw", COL(23), "end", "Submission Lost", "Off route", 11640, 11640, {
      opt: true,
      detail: { desc: "Terminal — declined or expired.", note: "Off animated route." }
    }),

    // 32
    N("uw", COL(23), "task", "Process Bind Order", "Review signed terms", 11640, 12120, {
      detail: {
        desc: "UW receives bind order, reconciles against issued quote, notes any last-minute changes.",
        note: "Maps to BPMN Task_ProcessBindOrder."
      }
    }),

    // 33
    N("ua", COL(24), "task", "Validate Subjectivities & OFAC", "Pre-bind clearance", 12120, 13080, {
      exc: true,
      detail: {
        desc: "Reviews all pre-bind subjectivities cleared (COPE updates, financials, sanctions/OFAC screening).",
        who: "Underwriting Assistant / Compliance",
        controls: ["OFAC/sanctions screening", "Subjectivities log sign-off"],
        note: "Maps to BPMN Task_ValidateSubjectivities."
      }
    }),

    // 34
    N("uw", COL(25), "task", "Issue Formal Binder", "Legal commitment", 13080, 13200, {
      detail: {
        desc: "Executes legally binding binder confirmation to broker.",
        note: "Maps to BPMN Task_IssueFormalBinder."
      }
    }),

    // 35
    N("policyops", COL(26), "task", "Assemble Dec Sheet, Forms & Endorsements", "Policy compilation", 13200, 14160, {
      detail: {
        desc: "Assembles the final policy package: dec sheet, schedule of forms, manuscript endorsements.",
        who: "Policy Operations Analyst",
        effort: "~2 business days",
        note: "Maps to BPMN Task_AssemblePolicyForms."
      }
    }),

    // 36
    N("policyops", COL(27), "task", "QA & Reinsurance Reconciliation", "Pre-issuance audit", 14160, 14880, {
      exc: true,
      detail: {
        desc: "Independent QA on all policy fields; ceded reinsurance allocation verified against fac binder and treaty.",
        controls: ["4-eyes QA", "Ceded allocation reconciliation"],
        note: "Maps to BPMN Task_QualityAuditReconciliation."
      }
    }),

    // 37
    N("policyops", COL(28), "task", "Book Premium in PAS & GL", "System of record", 14880, 15120, {
      detail: {
        desc: "Books premium and commission in PAS, triggers GL accounting entries.",
        systems: ["PAS", "General Ledger"],
        note: "Maps to BPMN Task_BookPolicyPASBilling (service task)."
      }
    }),

    // 38
    N("policyops", COL(29), "task", "Deliver Policy Package to Broker", "Contract transmission", 15120, 15360, {
      detail: {
        desc: "Transmits executed policy contract to broker.",
        note: "Maps to BPMN Task_DeliverPolicyPackage."
      }
    }),

    // 39
    N("policyops", COL(30), "end", "Policy In Force & Serviced", "Terminal", 15360, 15360, {
      detail: { desc: "Policy in force. Ongoing servicing begins.", note: "Maps to BPMN End_PolicyIssuedInForce." }
    })
  ];

  const beforeEdges = [
    [0, 1],
    [1, 2],
    [2, 3, "Conflict", { dashed: true }],
    [2, 5, "Clear"],
    [3, 4],
    [5, 6],
    [6, 7],
    [7, 3, "Out of Appetite", { dashed: true }],
    [7, 8, "In Appetite"],
    [8, 9],
    [9, 10],
    [10, 11],
    [10, 15],
    [11, 12],
    [12, 13, "Survey Required"],
    [12, 14, "Desk Only", { dashed: true }],
    [13, 14],
    [14, 17],
    [15, 16],
    [16, 17],
    [17, 18],
    [18, 19],
    [19, 20],
    [20, 21],
    [21, 22, "Yes"],
    [21, 24, "No (Treaty Fits)", { dashed: true }],
    [22, 23],
    [23, 24],
    [24, 25, "Exceeds Authority", { dashed: true }],
    [24, 28, "Within Authority"],
    [25, 26],
    [26, 27, "Declined", { dashed: true }],
    [26, 28, "Approved", { dashed: true }],
    [28, 29],
    [29, 30],
    [30, 31, "Lost", { dashed: true }],
    [30, 18, "Negotiate", { dashed: true }],
    [30, 32, "Bind Order"],
    [32, 33],
    [33, 34],
    [34, 35],
    [35, 36],
    [36, 37],
    [37, 38],
    [38, 39]
  ];

  // =========================================================
  // AFTER — Proposed AI-Augmented Operating Model (9 lanes)
  // =========================================================
  const afterLanes = [
    { id: "ai_intake",   name: "AI Intake & Triage Agent",             role: "Clearance, SOV scrub/geocode, appetite, routing",     type: "agent"    },
    { id: "ua",          name: "Underwriting Assistant / Ops (HITL)",  role: "Exception handling, subjectivities sign-off",         type: "human"    },
    { id: "uw",          name: "Commercial Property Underwriter",      role: "Reviews AI drafts, decisions, bind",                   type: "human"    },
    { id: "riskeng",     name: "Risk Engineering & Loss Prevention",   role: "Physical survey, engineer sign-off",                   type: "human"    },
    { id: "ai_analytics",name: "AI Analytics, CAT & Pricing Agent",    role: "CAT ingest/metrics, layering, pricing, forms, quote", type: "agent"    },
    { id: "cededre",     name: "Ceded Reinsurance / Fac Placement",    role: "External market placement",                            type: "human"    },
    { id: "uwauth",      name: "Technical UW Authority",               role: "Referral governance (retained)",                       type: "human"    },
    { id: "ai_policy",   name: "AI Policy Assembly & Booking Agent",   role: "Forms compile, PAS booking, delivery",                 type: "agent"    },
    { id: "policyops",   name: "Policy Ops QA (HITL)",                 role: "Pre-commit QA sign-off",                               type: "human"    }
  ];

  const afterNodes = [
    // 0
    N("ai_intake", COL(0), "start", "Submission Received", "From broker (email / API)", 0, 0, {
      detail: {
        desc: "Broker transmits submission; AI intake pipeline triggered immediately.",
        note: "Same trigger as before."
      }
    }),

    // 1
    N("ai_intake", COL(1), "task", "AI Clearance & Dedup", "Semantic entity resolution", 0, 10, {
      agent: true,
      role: "AI",
      detail: {
        desc: "Agent parses submission, extracts insured entity, and performs semantic entity resolution against PAS/clearance to catch name variants, subsidiaries, BOR conflicts.",
        activities: ["Named-entity extraction", "Fuzzy entity match against PAS", "BOR conflict detection"],
        systems: ["PAS", "Clearance system", "LLM extractor"],
        controls: ["Fail-closed on ambiguous match → routes to human UA"],
        escalation: "Ambiguous or conflicting matches → UA queue",
        note: "Replaces manual clearance keyword search. UA authority retained on ambiguous cases."
      }
    }),

    // 2
    N("ai_intake", COL(2), "gw", "Clearance Approved?", "Exclusive gateway", 10, 10, {
      detail: { desc: "Auto-clear or escalate to UA.", note: "Same gateway as Before." }
    }),

    // 3
    N("ai_intake", COL(3), "task", "AI SOV Ingest, Scrub & Geocode", "Structured data extraction", 10, 40, {
      agent: true,
      role: "AI",
      detail: {
        desc: "Agent parses SOV workbook (any layout), normalizes columns, resolves occupancy/construction codes, geocodes locations, flags data gaps with confidence scores.",
        activities: ["Layout inference", "COPE code resolution", "Address normalization", "Geocoding", "Completeness scoring"],
        systems: ["LLM extractor", "Geocoder", "Occupancy/construction code library"],
        outputs: ["Normalized SOV", "Data quality report", "Confidence-flagged fields"],
        controls: ["Low-confidence rows routed to UA review; agent does not overwrite silently"],
        note: "Replaces ~4–8 hrs of manual scrub. Preserves UA authority for low-confidence rows."
      }
    }),

    // 4
    N("ai_intake", COL(4), "task", "AI Appetite & Capacity Triage", "Deterministic rules + LLM reasoning", 40, 55, {
      agent: true,
      role: "AI",
      detail: {
        desc: "Runs appetite rules deterministically; LLM adds reasoning explanation and flags edge cases.",
        activities: ["Rules-engine execution", "Aggregate capacity check", "Rationale narrative"],
        controls: ["Deterministic rules govern the decision — LLM only explains"],
        note: "Rules engine authority preserved."
      }
    }),

    // 5
    N("ai_intake", COL(5), "gw", "Within Appetite?", "Exclusive gateway", 55, 55, {
      detail: { desc: "Same gate as Before." }
    }),

    // 6
    N("ai_intake", COL(6), "task", "Auto-Assign to Underwriter", "Load-balanced routing", 55, 65, {
      agent: true,
      role: "AI",
      detail: {
        desc: "Routes to UW by geography/industry/TIV band with load balancing.",
        note: "Replaces manual queue assignment."
      }
    }),

    // 7
    N("uw", COL(7), "task", "UW Review with AI-Prepared Brief", "Human decision on AI synthesis", 65, 305, {
      exc: true,
      role: "HITL",
      detail: {
        desc: "UW reviews an AI-prepared account brief (COPE summary, loss trend chart, prior-year comparison, exposure highlights). UW makes the risk-selection judgment.",
        who: "Commercial Property Underwriter",
        effort: "~4 hrs (down from ~10–14 hrs)",
        inputs: ["AI account brief", "Normalized SOV", "Loss run summary"],
        controls: ["UW retains risk-selection authority"],
        note: "AI prepares; UW decides."
      }
    }),

    // 8
    N("uw", COL(8), "gw", "Initiate Parallel Analysis", "Parallel fork", 305, 305, {
      detail: { desc: "Same as Before." }
    }),

    // 9 — RE branch
    N("riskeng", COL(9), "task", "AI-Prepped Desk Review + Engineer", "HITL", 305, 545, {
      exc: true,
      role: "HITL",
      detail: {
        desc: "AI pre-compiles COPE, protection, and prior-loss context; risk engineer reviews and decides on survey requirement.",
        who: "Risk Engineer (AI-assisted)",
        effort: "~4 hrs engineer time",
        note: "Engineer authority preserved."
      }
    }),

    // 10
    N("riskeng", COL(10), "gw", "On-site Survey Needed?", "Exclusive gateway", 545, 545, {
      detail: { desc: "Engineer's decision — unchanged in After." }
    }),

    // 11
    N("riskeng", COL(11), "task", "Physical Site Survey (Retained)", "Physical work — cannot automate", 545, 2465, {
      bott: true,
      exc: true,
      detail: {
        desc: "Physical inspection still required. Modest improvement modeled from AI-driven scheduling coordination and pre-populated survey checklist.",
        who: "Field Risk Engineer",
        effort: "~4 business days elapsed (illustrative — down from 5)",
        assumptions: ["AI concierge accelerates insured scheduling by ~1 day"],
        note: "PHYSICAL DEPENDENCY RETAINED. Not eliminated by AI."
      }
    }),

    // 12
    N("riskeng", COL(12), "task", "AI-Drafted Eng Report + Engineer Sign-off", "HITL", 2465, 2705, {
      exc: true,
      role: "HITL",
      detail: {
        desc: "AI drafts PML/MFL narrative and recs schedule from survey notes; engineer reviews, edits, and signs.",
        controls: ["Engineer sign-off required — AI output is a draft only"],
        note: "Engineer accountability preserved."
      }
    }),

    // 13 — CAT branch
    N("ai_analytics", COL(9), "task", "AI CAT Auto-Ingest", "API-driven", 305, 335, {
      agent: true,
      role: "AI",
      detail: {
        desc: "Automated ingest of normalized SOV into CAT platform with API-based occupancy/construction code mapping.",
        systems: ["RMS/AIR APIs"],
        note: "Replaces manual mapping QA."
      }
    }),

    // 14
    N("ai_analytics", COL(10), "task", "AI CAT Metrics Generation", "Model run + interpretation", 335, 815, {
      agent: true,
      role: "AI",
      detail: {
        desc: "Executes model runs and produces AAL, PML curves, and portfolio impact memo; run queue and compute time remain.",
        outputs: ["AAL by peril", "PML curves", "Portfolio impact memo"],
        note: "Compute time retained; interpretation drafted by AI, reviewed by UW downstream."
      }
    }),

    // 15
    N("uw", COL(13), "gw", "Risk Insights Reunited", "Parallel join", 2705, 2705, {
      detail: { desc: "Join waits on max(RE=2705, CAT=815) → 2705." }
    }),

    // 16
    N("ai_analytics", COL(14), "task", "AI-Drafted Layering + UW Decision", "HITL", 2705, 2945, {
      exc: true,
      role: "HITL",
      detail: {
        desc: "Agent proposes candidate layer structures with rationale; UW selects and adjusts.",
        controls: ["UW retains layering/participation authority"]
      }
    }),

    // 17
    N("ai_analytics", COL(15), "task", "AI Technical Pricing + UW Review", "HITL", 2945, 3185, {
      exc: true,
      role: "HITL",
      detail: {
        desc: "Deterministic rating engine computes rate; agent recommends schedule credits/debits with cited rationale; UW approves.",
        controls: ["Rating engine is authoritative for base rate", "UW authority on credits/debits"]
      }
    }),

    // 18
    N("ai_analytics", COL(16), "task", "AI Forms & Endorsements + UW Review", "HITL", 3185, 3425, {
      exc: true,
      role: "HITL",
      detail: {
        desc: "Agent selects appropriate ISO forms and drafts manuscript endorsements from prior precedents; UW reviews and edits.",
        controls: ["Manuscript language changes require UW approval"]
      }
    }),

    // 19
    N("uw", COL(17), "gw", "Fac Reinsurance Required?", "Exclusive gateway", 3425, 3425, {
      detail: { desc: "Same gate as Before." }
    }),

    // 20
    N("ai_analytics", COL(18), "task", "AI-Drafted Fac Slip", "Automated slip generation", 3425, 3545, {
      agent: true,
      role: "AI",
      detail: {
        desc: "Agent auto-composes fac slip: exposure summary, PML, CAT metrics, layer, sought terms.",
        note: "Slip is a draft; ceded team owns market placement."
      }
    }),

    // 21
    N("cededre", COL(19), "task", "Obtain Fac Binder (External Market — Retained)", "Market wait", 3545, 4985, {
      bott: true,
      exc: true,
      detail: {
        desc: "External reinsurance market response time is a persistent dependency. Modest improvement from better-structured slip and faster follow-ups.",
        who: "Ceded Reinsurance Broker & Analyst",
        effort: "~3 business days elapsed (illustrative — down from 4)",
        dependencies: ["External reinsurer response"],
        assumptions: ["AI-drafted slip reduces back-and-forth by ~1 day"],
        note: "EXTERNAL COUNTERPARTY DEPENDENCY RETAINED."
      }
    }),

    // 22
    N("uw", COL(20), "gw", "Exceeds UW Authority?", "Exclusive gateway", 4985, 4985, {
      detail: { desc: "Delegated authority governance retained.", note: "Representative route selects WITHIN AUTHORITY." }
    }),

    // 23 — off-route referral (retained governance)
    N("uwauth", COL(21), "task", "Technical Authority Review", "Retained governance (off route)", 4985, 4985, {
      opt: true,
      exc: true,
      detail: {
        desc: "Retained human authority for out-of-authority terms. AI does not receive delegated authority.",
        controls: ["Authority sign-off remains a hard control"],
        note: "Off animated route in representative case."
      }
    }),

    // 24
    N("uwauth", COL(22), "gw", "Authority Sign-off?", "Off route", 4985, 4985, { opt: true,
      detail: { desc: "Off animated route." }
    }),

    // 25
    N("uwauth", COL(23), "end", "Risk Declined by Authority", "Off route", 4985, 4985, { opt: true,
      detail: { desc: "Off animated route." }
    }),

    // 26
    N("ai_analytics", COL(21), "task", "AI-Assembled Quote Proposal", "Multi-option compilation", 4985, 5105, {
      agent: true,
      role: "AI",
      detail: {
        desc: "Agent compiles multi-option quote (primary, excess, quota share) with narrative rationale and subjectivities list.",
        note: "Draft delivered to UW for issuance."
      }
    }),

    // 27
    N("uw", COL(22), "task", "Issue Quote to Broker", "UW-signed transmission", 5105, 5165, {
      detail: {
        desc: "UW reviews AI-assembled quote and transmits to broker.",
        controls: ["UW signs the quote — not the agent"]
      }
    }),

    // 28
    N("uw", COL(23), "gw", "Broker Response", "Bind / Negotiate / Lost", 5165, 6605, {
      exc: true,
      detail: {
        desc: "Includes broker/insured decision wait (~3 business days illustrative — modest improvement from cleaner quote reducing follow-ups).",
        dependencies: ["Broker/insured decision cycle"],
        note: "EXTERNAL CUSTOMER DEPENDENCY RETAINED."
      }
    }),

    // 29
    N("uw", COL(24), "end", "Submission Lost", "Off route", 6605, 6605, { opt: true,
      detail: { desc: "Off animated route." }
    }),

    // 30
    N("uw", COL(24), "task", "AI-Assisted Bind Order Review", "HITL", 6605, 6725, {
      exc: true,
      role: "HITL",
      detail: {
        desc: "Agent reconciles bind order to issued quote and flags variances; UW authorizes the bind.",
        controls: ["Bind commitment made by human UW, not agent"]
      }
    }),

    // 31
    N("ua", COL(25), "task", "AI OFAC/Sanctions + Human Sign-off", "HITL", 6725, 6965, {
      exc: true,
      role: "HITL",
      detail: {
        desc: "Automated OFAC/sanctions screening and subjectivities checklist; UA/compliance signs off.",
        controls: ["Sanctions compliance sign-off retained by human"],
        note: "Fail-closed if any subjectivity unresolved."
      }
    }),

    // 32
    N("uw", COL(26), "task", "Issue Formal Binder", "Legal commitment", 6965, 7025, {
      detail: {
        desc: "UW executes legally binding binder confirmation to broker.",
        controls: ["Legal commitment made by human UW"]
      }
    }),

    // 33
    N("ai_policy", COL(27), "task", "AI Policy Assembly & Dec Sheet", "Automated compilation", 7025, 7145, {
      agent: true,
      role: "AI",
      detail: {
        desc: "Agent assembles dec sheet, schedule of forms, endorsements from binder record.",
        note: "Assembly is deterministic against templates; QA still required."
      }
    }),

    // 34
    N("policyops", COL(28), "task", "Pre-Commit QA Review", "Human sign-off before booking", 7145, 7385, {
      exc: true,
      role: "HITL",
      detail: {
        desc: "Human QA validates policy fields, ceded allocation, endorsement selection before PAS booking.",
        who: "Policy Ops QA Analyst",
        controls: ["4-eyes QA retained", "Fail-closed if reconciliation breaks"],
        note: "PRE-COMMIT HUMAN QA RETAINED."
      }
    }),

    // 35
    N("ai_policy", COL(29), "task", "Auto PAS Booking & GL Posting", "System write", 7385, 7415, {
      agent: true,
      role: "AI",
      detail: {
        desc: "After QA sign-off, agent writes premium and ceded allocation to PAS and triggers GL posting.",
        controls: ["Only executes after human QA sign-off"],
        note: "Consequential system write is gated by human sign-off."
      }
    }),

    // 36
    N("ai_policy", COL(30), "task", "Auto Delivery to Broker", "Contract transmission", 7415, 7440, {
      agent: true,
      role: "AI",
      detail: { desc: "Transmits executed policy contract to broker." }
    }),

    // 37
    N("policyops", COL(31), "end", "Policy In Force & Serviced", "Terminal", 7440, 7440, {
      detail: { desc: "Policy in force. Servicing begins." }
    })
  ];

  const afterEdges = [
    [0, 1],
    [1, 2],
    [2, 3, "Clear"],
    [3, 4],
    [4, 5],
    [5, 6, "In Appetite"],
    [6, 7],
    [7, 8],
    [8, 9],
    [8, 13],
    [9, 10],
    [10, 11, "Survey Required"],
    [10, 12, "Desk Only", { dashed: true }],
    [11, 12],
    [12, 15],
    [13, 14],
    [14, 15],
    [15, 16],
    [16, 17],
    [17, 18],
    [18, 19],
    [19, 20, "Yes"],
    [19, 22, "No", { dashed: true }],
    [20, 21],
    [21, 22],
    [22, 23, "Exceeds Authority", { dashed: true }],
    [22, 26, "Within Authority"],
    [23, 24],
    [24, 25, "Declined", { dashed: true }],
    [24, 26, "Approved", { dashed: true }],
    [26, 27],
    [27, 28],
    [28, 29, "Lost", { dashed: true }],
    [28, 16, "Negotiate", { dashed: true }],
    [28, 30, "Bind Order"],
    [30, 31],
    [31, 32],
    [32, 33],
    [33, 34],
    [34, 35],
    [35, 36],
    [36, 37]
  ];

  // =========================================================
  // CASES — 5 illustrative submissions on the same route
  // =========================================================
  // All figures illustrative. Financial assumptions:
  //   Rate $150/hr, 400 subs/yr, 1,800 FTE hrs/yr, AI ~$400/sub.
  const cases = [
    {
      id: 1,
      title: "Mid-Market Manufacturing — $150M TIV",
      status: "ILLUSTRATIVE",
      tag: "t-done",
      fund: "Illustrative — single-location manufacturing, light fac",
      amt: "$150M TIV / $2.4M premium",
      b: 6720,   // 14 business days
      a: 3360,   // 7 business days
      exec: {
        save: "56 cycle-hrs saved (7 business days)",
        saveS: "−50% cycle time",
        cut: "~$2,050 cost saved per submission",
        fte: "3.3 FTE-equivalent capacity release (annualized at 400 subs)"
      },
      mt: [
        ["Cycle time (business days)", 14,   7,    "−50%"],
        ["Human touch (hrs)",          25,   10,   "−15 hrs"],
        ["Handoffs",                   14,   6,    "−8"],
        ["External waits (days)",      6,    5,    "−1 day"],
        ["Cost per submission",        "$3,750", "$1,700", "−$2,050"]
      ]
    },
    {
      id: 2,
      title: "Regional Retail Portfolio — $500M TIV",
      status: "ILLUSTRATIVE",
      tag: "t-done",
      fund: "Illustrative — 40-location retail chain, moderate CAT",
      amt: "$500M TIV / $6.8M premium",
      b: 10560,  // 22 business days
      a: 5040,   // 10.5 business days
      exec: {
        save: "92 cycle-hrs saved (11.5 business days)",
        saveS: "−52% cycle time",
        cut: "~$3,300 cost saved per submission",
        fte: "5.3 FTE-equivalent capacity release (annualized at 400 subs)"
      },
      mt: [
        ["Cycle time (business days)", 22,   10.5, "−52%"],
        ["Human touch (hrs)",          40,   16,   "−24 hrs"],
        ["Handoffs",                   16,   7,    "−9"],
        ["External waits (days)",      8,    6,    "−2 days"],
        ["Cost per submission",        "$6,000", "$2,700", "−$3,300"]
      ]
    },
    {
      id: 3,
      title: "National Manufacturing Schedule — $1B TIV (Representative)",
      status: "ILLUSTRATIVE — REPRESENTATIVE",
      tag: "t-prog",
      fund: "Illustrative — 120-location multi-state, wind & convective storm exposure, fac required",
      amt: "$1B TIV / $12.5M premium",
      b: 15360,  // 32 business days — matches BASE_B
      a: 7440,   // 15.5 business days — matches BASE_A
      exec: {
        save: "132 cycle-hrs saved (16.5 business days)",
        saveS: "−52% cycle time",
        cut: "~$4,550 cost saved per submission",
        fte: "7.3 FTE-equivalent capacity release (annualized at 400 subs)"
      },
      mt: [
        ["Cycle time (business days)", 32,   15.5, "−52%"],
        ["Human touch (hrs)",          55,   22,   "−33 hrs"],
        ["Handoffs",                   19,   8,    "−11"],
        ["External waits (days)",      11,   8,    "−3 days"],
        ["Cost per submission",        "$8,250", "$3,700", "−$4,550"]
      ]
    },
    {
      id: 4,
      title: "Multi-State Industrial — $2B TIV",
      status: "ILLUSTRATIVE",
      tag: "t-new",
      fund: "Illustrative — heavy manufacturing, wind + quake, multiple fac layers",
      amt: "$2B TIV / $22M premium",
      b: 20160,  // 42 business days
      a: 9600,   // 20 business days
      exec: {
        save: "176 cycle-hrs saved (22 business days)",
        saveS: "−52% cycle time",
        cut: "~$6,700 cost saved per submission",
        fte: "10.0 FTE-equivalent capacity release (annualized at 400 subs)"
      },
      mt: [
        ["Cycle time (business days)", 42,   20,   "−52%"],
        ["Human touch (hrs)",          75,   30,   "−45 hrs"],
        ["Handoffs",                   22,   10,   "−12"],
        ["External waits (days)",      14,   10,   "−4 days"],
        ["Cost per submission",        "$11,250", "$4,550", "−$6,700"]
      ]
    },
    {
      id: 5,
      title: "Global Industrial Portfolio — $3.5B TIV",
      status: "ILLUSTRATIVE — HIGH COMPLEXITY",
      tag: "t-stuck",
      fund: "Illustrative — multi-jurisdictional, several manuscript endorsements, complex fac tower",
      amt: "$3.5B TIV / $38M premium",
      b: 26400,  // 55 business days
      a: 12480,  // 26 business days
      exec: {
        save: "232 cycle-hrs saved (29 business days)",
        saveS: "−53% cycle time",
        cut: "~$8,900 cost saved per submission",
        fte: "13.3 FTE-equivalent capacity release (annualized at 400 subs)"
      },
      mt: [
        ["Cycle time (business days)", 55,   26,   "−53%"],
        ["Human touch (hrs)",          100,  40,   "−60 hrs"],
        ["Handoffs",                   28,   12,   "−16"],
        ["External waits (days)",      18,   13,   "−5 days"],
        ["Cost per submission",        "$15,000", "$6,100", "−$8,900"]
      ]
    }
  ];

  // =========================================================
  // BRANDING
  // =========================================================
  const branding = {
    docTitle: "Large Commercial Property Underwriting — Process Comparison Explorer",
    kicker: "Insurance | Large Commercial Property | Enterprise P&C",
    title: "Large Commercial Property Underwriting & Issuance",
    status: "ILLUSTRATIVE — Structure from BPMN; timings, volumes, and costs are assumptions",
    beforeLabel: "Current State — Manual Underwriting Workflow (from BPMN)",
    afterLabel: "Proposed State — AI-Augmented Underwriting Operating Model",
    footer: "BPX Process Race",
    linkedin: "linkedin.com/in/dougross",
    startCase: 3,
    helpText: "Click any activity for business detail. All 5 cases scale the same representative route: clearance passes → in appetite → physical survey required → fac reinsurance required → within authority → broker binds → policy issued. Off-route branches (decline, referral-decline, submission-lost, negotiate loop) are drawn but not scheduled."
  };

  // =========================================================
  // ASSEMBLE
  // =========================================================
  window.PROCESS = {
    layout,
    milestones,
    before: {
      lanes: beforeLanes,
      nodes: beforeNodes,
      edges: beforeEdges
    },
    after: {
      lanes: afterLanes,
      nodes: afterNodes,
      edges: afterEdges
    },
    cases,
    branding,
    styles: ""
  };
})();
