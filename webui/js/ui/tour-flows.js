/*
 * The guided tours: what each step points at, what it says, and how it sets
 * up the screen. ui/tour.js runs them. Every tour works on the bundled
 * examples, so a person's own project and files are never changed.
 *
 * A step is { title, body, action, target, click, done(ctx), prepare(ctx), next(ctx), skipIf(ctx) }.
 * target is a selector or a function returning the element to point at, or
 * null for a step that only explains. click: the step moves on when the
 * person clicks the target; Next clicks it for them unless next() does
 * something else. done() says the person has done the step another way, for
 * example by selecting a step on the diagram, and the tour moves on when it
 * turns true. prepare() runs when the step is shown, going forward or
 * back, and puts the screen in the state the step needs. skipIf() says the
 * step no longer applies, for example after the draft it creates exists, so
 * Back and Next pass over it. Backticks in body
 * text mark commands, shown as code.
 */
(function (root) {
  "use strict";
  const B = root.AIxRay = root.AIxRay || {};

  /* ---------- Helpers shared by the steps ---------- */

  const $ = sel => document.querySelector(sel);
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const byText = (sel, re) => () => [...document.querySelectorAll(sel)].find(el => re.test(el.textContent)) || null;

  /*
   * Opens a bundled example as a fresh copy, without the question about an
   * earlier browser draft. Unsaved changes to an open project are asked
   * about first, as when any project is replaced.
   */
  async function openExample(app, id) {
    if (app.guardUnsaved && !await app.guardUnsaved("open the tour's example project")) return false;
    const x = (B.bundledExamples || []).find(e => e.id === id);
    const r = B.validate.validateEngagement(JSON.parse(JSON.stringify(x.engagement)));
    app.loadEngagement(r.engagement, { exampleId: id, warnings: r.warnings, source: "example" });
    return true;
  }

  function onExample(app, id) {
    return !!app.store && app.store.get().id === (B.bundledExamples || []).find(e => e.id === id).engagement.id;
  }

  async function ensureExample(app, id) {
    if (!onExample(app, id)) await openExample(app, id);
  }

  function goto(app, ws) {
    if (app.workspace !== ws) app.goto(ws);
  }

  function currentModelId(app) {
    const e = app.store.get();
    return (e.models.find(m => m.role === "current") || e.models[0]).id;
  }

  /* The future-state draft the tour works on, if there is one. */
  function draftId(app) {
    const e = app.store.get();
    const shown = (app.view.display || "").slice(2);
    const m = e.models.find(x => x.id === shown && x.role === "future") || e.models.find(x => x.role === "future");
    return m ? m.id : null;
  }

  const UW = "underwriting-current-state";
  const FAC = "obtain-fac-binder-from-market";
  const SAMPLE_OPPORTUNITIES = [
    { title: "Standard SOV template for the top five brokers", node: "scrub-sov-geocode", hours: { value: 6, unit: "hour" },
      intervention: "standardize", effort: "M", wave: "now", reduction: 50, share: 60, confidence: "high" },
    { title: "Rules-based appetite and capacity triage", node: "appetite-capacity-triage", hours: { value: 1, unit: "hour" },
      intervention: "deterministic-automation", effort: "L", wave: "next", reduction: 70, share: 100, confidence: "medium" },
    { title: "Route submissions by geography and TIV band", node: "assign-to-underwriter", hours: { value: 20, unit: "minute" },
      intervention: "simplify", effort: "S", wave: "now", reduction: 80, share: 100, confidence: "high" }
  ];

  /* Three illustrative opportunities with business cases, added once. */
  function seedOpportunities(app) {
    const e = app.store.get();
    SAMPLE_OPPORTUNITIES.forEach(o => {
      if (e.records.some(r => r.title === o.title)) return;
      const modelId = currentModelId(app);
      // A locked baseline keeps the effort it has; the business case still shows what is missing.
      try { app.store.dispatch("node/update", { modelId, nodeId: o.node, patch: { measures: { touchEffort: o.hours } } }); } catch (_) { /* locked */ }
      app.store.dispatch("record/add", { record: { kind: "opportunity", title: o.title, linkedModelId: modelId, linkedNodeIds: [o.node],
        description: "Sample opportunity added by the tour.",
        opportunity: { intervention: o.intervention, effort: o.effort, wave: o.wave,
          valueCase: { modelId, nodeIds: [o.node], effortReductionPct: o.reduction, shareOfCasesPct: o.share, shareSource: "manual", effortSource: "node",
            confidence: o.confidence, basis: "illustrative", oneTimeCost: 40000 } } } });
    });
  }

  /* A changed, an added and a removed step in the draft, each with its reason, added once. */
  function seedDraftChanges(app) {
    let modelId = draftId(app);
    if (!modelId) modelId = app.store.dispatch("model/clone", { sourceModelId: currentModelId(app), name: "Future state" }).modelId;
    const draft = () => app.store.get().models.find(m => m.id === modelId);
    if (!draft().nodes.some(n => n.label === "Spot-check extracted SOV fields")) {
      const edge = draft().edges.find(x => x.from === "scrub-sov-geocode" && !x.removed);
      if (edge) app.store.dispatch("model/insertStep", { modelId, edgeId: edge.id, label: "Spot-check extracted SOV fields", rationale: "Keep a human check on low-confidence rows." });
      app.store.dispatch("node/update", { modelId, nodeId: "scrub-sov-geocode", patch: { label: "Extract and scrub SOV with tooling", rationale: "Extraction tool pre-fills COPE fields from the standard template." } });
      const assign = draft().nodes.find(n => n.id === "assign-to-underwriter");
      if (assign && !assign.removed) app.store.dispatch("model/removeStep", { modelId, nodeId: "assign-to-underwriter", rationale: "Routing rules assign by geography and TIV band." });
    }
    app.view.display = "c:" + modelId;
    app.processView.onEngagementChange({ type: "model/view" });
    return modelId;
  }

  /* ---------- Screening helpers ---------- */

  const scr = () => B.screeningUi && B.screeningUi.current();
  const windowOpen = () => !!$("#screening-dialog");

  async function ensureScreeningWindow(app) {
    if (!windowOpen()) await B.screeningUi.open(app);
  }

  async function ensureExampleScreening(app) {
    await ensureScreeningWindow(app);
    const s = scr();
    if (!s || s.id !== "scr-example") {
      const r = B.screening.parseScreening(B.bundledScreening.screening);
      await B.screeningUi.open(app, r.screening, {});
    }
  }

  function screeningTab(id) {
    const b = $("#scr-tab-" + id);
    if (b && b.getAttribute("aria-selected") !== "true") b.click();
  }

  function closeDialog(sel) {
    const d = $(sel);
    if (d && d.open) d.close();
  }

  /* The open dialog, other than the screening window, whose text matches. */
  const dialogWith = re => [...document.querySelectorAll("dialog[open]")].filter(x => x.id !== "screening-dialog" && re.test(x.textContent)).pop() || null;
  const closeDialogWith = re => { const d = dialogWith(re); if (d) d.close(); };
  const hasDraft = ctx => !!ctx.app.store && !!draftId(ctx.app);

  /* Sample scores for the blanks of the typed-in process, shaped like a real result and labeled as the tour's own. */
  function sampleAiResult() {
    const s = scr();
    const c = s.candidates.find(x => x.id === "c-supplier-invoice-exceptions");
    const drafted = {
      systems: [3, "low", "Invoice systems usually offer exports and user access; an assumption to confirm."],
      exceptions: [2, "medium", "Every case is an invoice that failed the three-way match, so each needs special handling."],
      risk: [4, "medium", "A person still approves each payment, so a wrong suggestion is caught before money moves."],
      measurable: [3, "low", "Exception counts are likely in the finance system; times are not."],
      priority: [null, "low", "Ask the finance lead whether this is on their list this year."]
    };
    const open = s.criteria.filter(k => drafted[k.id] && !(c.scores[k.id] && c.scores[k.id].value !== null && !c.scores[k.id].aiDraft));
    return B.aiResults.validateAiResult(B.aiResults.makeEnvelope({
      task: "screen", screeningId: s.id, screeningRevision: s.revision,
      generated: { tool: "aixray-tour", provider: "other", surface: "app", plan: "unknown" },
      dataHandling: { confidentiality: s.meta.confidentiality, dataStatus: s.meta.dataStatus },
      notes: "Sample scores that the tour made to show the review. They were not drafted by an AI.",
      payload: { scores: open.map(k => ({ candidateId: c.id, criterionId: k.id, value: drafted[k.id][0], confidence: drafted[k.id][1], rationale: drafted[k.id][2] })) }
    }));
  }

  /* ---------- Tour (a): a client's process to a first future state ---------- */

  const analyze = {
    id: "analyze",
    title: "Analyze a process and start its future state",
    summary: "Bring in one client process, replay a case, capture findings, value the opportunities and start a tracked future state.",
    end: "That is the core loop: the process as it runs, what people said about it, what changing it is worth, and a future state tracked against it. The tour used the bundled underwriting example, so your own files are as they were.",
    steps: [
      {
        title: "Bring in the client's process",
        body: "Start from what the client already has: open a saved project, import a BPMN file, build the process with Build a process, or draft it from their documents with `npm run ai -- extract`. The tour uses the bundled underwriting process as the client's.",
        action: "Open the underwriting example",
        target: "#open-" + UW, click: true,
        prepare: ctx => { if (ctx.app.workspace !== "start") ctx.app.goto("start"); },
        next: ctx => openExample(ctx.app, UW)
      },
      {
        title: "See the process as it runs today",
        body: "The current state opens lane by lane. A scenario is a real or representative case; play it to watch the case move through the steps on one clock, with waits and rework where they happened.",
        action: "Play the case",
        target: "#pv-play", click: true,
        prepare: async ctx => { await ensureExample(ctx.app, UW); goto(ctx.app, "process"); }
      },
      {
        title: "Find where time goes",
        body: "Lenses overlay elapsed time, hands-on effort, waits, handovers between teams, SLA status and suspected bottlenecks. Each lens says how many steps have data behind it. The tour picks Waits.",
        action: "",
        target: "#pv-lens", click: false,
        prepare: async ctx => {
          await ensureExample(ctx.app, UW); goto(ctx.app, "process");
          ctx.app.processView.setPlaying(false);
          const scrub = $("#pv-scrub");
          if (scrub && Number(scrub.value) < 400) { scrub.value = "540"; scrub.dispatchEvent(new Event("input")); }
        },
        next: () => {
          const lens = $("#pv-lens");
          const opt = lens && [...lens.options].find(o => /wait/i.test(o.textContent));
          if (opt && lens.value !== opt.value) { lens.value = opt.value; lens.dispatchEvent(new Event("change", { bubbles: true })); }
        }
      },
      {
        title: "Open the step with the longest wait",
        body: "Obtain Fac Binder from Market waits days on an outside market. Select it to see what the workshop knows about it.",
        action: "Select the step",
        target: '#pv-panes [data-node="' + FAC + '"]', click: false,
        done: () => !!$("#dt-capture"),
        prepare: async ctx => {
          await ensureExample(ctx.app, UW); goto(ctx.app, "process");
          const pv = ctx.app.processView;
          if (pv.panes[0]) pv.camera.focusOn(pv.panes[0].diagram, FAC, 0.8);
          await pause(250);
        },
        next: ctx => ctx.app.processView.selectNode(currentModelId(ctx.app), FAC, { center: false })
      },
      {
        title: "Check each step with the people who do it",
        body: "The side panel shows the step's owners, systems, timings and where each fact came from. Edit step corrects it while the client is talking, and every fact keeps its source.",
        action: "Open the step's findings",
        target: "#dt-capture", click: true,
        prepare: async ctx => {
          await ensureExample(ctx.app, UW); goto(ctx.app, "process");
          if (!$("#dt-capture")) ctx.app.processView.selectNode(currentModelId(ctx.app), FAC, { center: false });
        }
      },
      {
        title: "Capture findings as they come up",
        body: "Pain points, opportunities, questions, decisions and actions attach to the step they concern, show as a count on the canvas and collect in the Findings tab. The tour has typed one in; change it if you like.",
        action: "Add the finding",
        target: '#pv-side form button[type="submit"]', click: true,
        prepare: async ctx => {
          await ensureExample(ctx.app, UW); goto(ctx.app, "process");
          if (!$("#cap-title")) { ctx.app.processView.selectNode(currentModelId(ctx.app), FAC, { center: false }); await pause(100); const t = $("#dt-capture"); if (t) t.click(); }
          await pause(100);
          const pain = $("input[name=cap-kind][value=pain]");
          if (pain && !$("#cap-title").value) pain.click();
          if ($("#cap-title") && !$("#cap-title").value) $("#cap-title").value = "Facultative placement waits four days on the market";
          if ($("#cap-owner") && !$("#cap-owner").value) $("#cap-owner").value = "Ceded reinsurance lead";
        }
      },
      {
        title: "Everything found, in one place",
        body: "The Findings tab lists every finding with its step, owner and status, next to the sources behind the process.",
        action: "Open Findings",
        target: "#tab-records", click: true,
        prepare: async ctx => { await ensureExample(ctx.app, UW); }
      },
      {
        title: "Let AI suggest what to raise",
        body: "`npm run ai -- opportunities`, or the `/aixray-opportunities` skill, asks your Claude or ChatGPT plan for pain points, opportunities and questions linked to steps. The data-handling check runs first, and the draft comes back as a file you open here, tick through and apply.",
        action: "",
        target: "#btn-open", click: false,
        prepare: async ctx => { await ensureExample(ctx.app, UW); goto(ctx.app, "records"); }
      },
      {
        title: "Give each opportunity a business case",
        body: "Every opportunity asks for the simplest change that works first, then a business case: effort saved, share of cases and what it costs. The tour adds three sample opportunities with business cases.",
        action: "Open Opportunities",
        target: "#rv-tab-opportunities", click: true,
        prepare: async ctx => { await ensureExample(ctx.app, UW); goto(ctx.app, "records"); seedOpportunities(ctx.app); }
      },
      {
        title: "See them by value and effort",
        body: "Matrix places each scored opportunity as a quick win, a major project, a fill-in or one to reconsider. Waves lays them out as now, next and later.",
        action: "Open Matrix",
        target: "#rv-oppview-matrix", click: true,
        prepare: async ctx => {
          await ensureExample(ctx.app, UW); seedOpportunities(ctx.app); goto(ctx.app, "records");
          if (!$("#rv-oppview-matrix")) { const t = $("#rv-tab-opportunities"); if (t) t.click(); }
        }
      },
      {
        title: "Pick what to change first",
        body: "Each figure carries the basis of its weakest input, and a missing input leaves a result blank instead of counting as zero.",
        action: "",
        target: ".bc-matrix", click: false,
        prepare: async ctx => {
          await ensureExample(ctx.app, UW); seedOpportunities(ctx.app); goto(ctx.app, "records");
          if (!$(".bc-matrix")) { const t = $("#rv-tab-opportunities"); if (t) t.click(); await pause(50); const m = $("#rv-oppview-matrix"); if (m) m.click(); }
          await pause(50);
          const m = $(".bc-matrix");
          if (m) m.scrollIntoView({ block: "center" });
        }
      },
      {
        title: "Back to the process",
        body: "With the first changes chosen, start the future state.",
        action: "Open Process",
        target: "#tab-process", click: true,
        prepare: async ctx => { await ensureExample(ctx.app, UW); }
      },
      {
        title: "Start the future state",
        body: "Plan a future state copies the current process into a draft and locks the original as the baseline, so the two can always be compared.",
        action: "Plan a future state",
        target: byText("#pv-side button", /Plan a future state/), click: true,
        skipIf: hasDraft,
        prepare: async ctx => {
          await ensureExample(ctx.app, UW); goto(ctx.app, "process");
          closeDialogWith(/Plan a future state/);
          ctx.app.view.display = "m:" + currentModelId(ctx.app);
          ctx.app.processView.closeDrawer();
          ctx.app.view.panelOpen = true;
          ctx.app.processView.onEngagementChange({ type: "model/view" });
          await pause(150);
        }
      },
      {
        title: "Name the alternative",
        body: "Keep several named alternatives, each compared with the same locked baseline.",
        action: "Create the draft",
        target: () => { const n = $("#clone-name"); return n ? n.closest("dialog").querySelector(".dlg-foot .btn-primary") : null; }, click: true,
        skipIf: ctx => hasDraft(ctx) && !$("#clone-name"),
        prepare: async ctx => {
          await ensureExample(ctx.app, UW);
          if (!$("#clone-name")) ctx.app.cloneBaseline(currentModelId(ctx.app));
          await pause(50);
          const n = $("#clone-name");
          if (n && n.value === "Future state") n.value = "Future state: standard SOV and routing rules";
        }
      },
      {
        title: "Change, add and remove steps, with a reason for each",
        body: "Changed, added and removed steps are marked with the reason recorded, and selecting a step highlights its counterpart in the baseline. The tour has made three sample changes. `npm run ai -- future-state` can draft changes for you to review the same way.",
        action: "Open Edit step",
        target: "#dt-edit", click: true,
        prepare: async ctx => {
          await ensureExample(ctx.app, UW); goto(ctx.app, "process");
          closeDialogWith(/Plan a future state/);
          const id = seedDraftChanges(ctx.app);
          await pause(250);
          ctx.app.processView.selectNode(id, "scrub-sov-geocode", { center: true });
        }
      },
      {
        title: "Hand over what was found",
        body: "Present shows the process to the room and prints the report.",
        action: "Open Present",
        target: "#tab-present", click: true,
        prepare: async ctx => { await ensureExample(ctx.app, UW); }
      },
      {
        title: "Print the report",
        body: "Report summarizes scope, data status, findings, opportunities with their value, decisions and owned actions.",
        action: "Open Report",
        target: "#pr-handoff", click: true,
        prepare: async ctx => { await ensureExample(ctx.app, UW); goto(ctx.app, "present"); }
      },
      {
        title: "Ready to share",
        body: "Unreviewed AI drafts and sensitive findings stay out unless you include them. From Present, Send for review asks a client stakeholder to confirm or dispute each step, and Export to other tools builds a PowerPoint deck, a BPMN file or a backlog.",
        action: "",
        target: "#handoff-doc", click: false,
        prepare: async ctx => { await ensureExample(ctx.app, UW); goto(ctx.app, "present"); const r = $("#pr-handoff"); if (r && !$("#handoff-doc")) r.click(); }
      }
    ]
  };

  /* ---------- Tour (b): screening several processes ---------- */

  const screen = {
    id: "screen",
    title: "Screen several processes for the first use case",
    summary: "Score candidate processes against weighted criteria, test the first choice and turn it into a project.",
    end: "From here, carry on as in the first tour: analyze the process and start its future state. The example screening stays open in this tab until you reload.",
    steps: [
      {
        title: "Open a screening",
        body: "A screening compares the processes the client is choosing between against the same weighted criteria. It is its own file and never changes a project.",
        action: "Screen processes",
        target: "#start-screening", click: true,
        prepare: ctx => { closeDialog("#screening-dialog"); if (ctx.app.workspace !== "start") ctx.app.goto("start"); },
        next: ctx => B.screeningUi.open(ctx.app)
      },
      {
        title: "Add the candidate processes",
        body: "Type a process in, add a project file you already have, or add the open project, which brings its volume, hourly rate, step count and top opportunity. The tour opens the bundled example.",
        action: "Open the example screening",
        target: "#scr-example", click: true,
        prepare: async ctx => {
          await ensureScreeningWindow(ctx.app);
          if (!$("#scr-example")) await B.screeningUi.open(ctx.app, B.screening.blankScreening(), {});
          screeningTab("candidates");
        }
      },
      {
        title: "Score each process from 1 to 5",
        body: "One row per process and one column per criterion, grouped as value, feasibility, and readiness and risk. A higher score is always better, and a blank stays blank.",
        action: "Open the process that is only partly scored",
        target: "#scr-edit-c-supplier-invoice-exceptions", click: true,
        prepare: async ctx => { closeDialog("#scr-candidate-dialog"); await ensureExampleScreening(ctx.app); screeningTab("candidates"); }
      },
      {
        title: "Score against shared descriptions",
        body: "Each criterion says what a 1, a 3 and a 5 mean, so different people score alike. Every score keeps its basis and a note.",
        action: "",
        target: "#scr-candidate-dialog .scr-score-table", click: false,
        prepare: async ctx => {
          await ensureExampleScreening(ctx.app); screeningTab("candidates");
          if (!$("#scr-candidate-dialog")) { const b = $("#scr-edit-c-supplier-invoice-exceptions"); if (b) b.click(); }
          await pause(100);
          const t = $("#scr-candidate-dialog .scr-score-table");
          if (t) t.scrollIntoView({ block: "start" });
        },
        next: () => closeDialog("#scr-candidate-dialog")
      },
      {
        title: "Let AI draft the blanks",
        body: "`npm run ai -- screen`, or the `/aixray-screen` skill, drafts a score and a rationale for each criterion nobody has scored. Owners are never sent, and the data-handling check runs first. Load AI scores opens the result. Next shows sample scores the tour made.",
        action: "",
        target: "#scr-load-ai", click: false,
        prepare: async ctx => { closeDialog("#scr-candidate-dialog"); closeDialog("#scr-ai-dialog"); await ensureExampleScreening(ctx.app); screeningTab("candidates"); },
        next: ctx => B.screeningUi.openAiResult(ctx.app, sampleAiResult(), { fileName: "Sample scores from the tour" })
      },
      {
        title: "Review every drafted score",
        body: "Each score shows its rationale and confidence with a tick. A blank the AI could not score, or a criterion a person already scored, cannot be applied.",
        action: "Apply the ticked scores",
        target: "#scr-ai-dialog .dlg-foot .btn-primary", click: true,
        prepare: async ctx => {
          await ensureExampleScreening(ctx.app);
          if (!$("#scr-ai-dialog")) await B.screeningUi.openAiResult(ctx.app, sampleAiResult(), { fileName: "Sample scores from the tour" });
        }
      },
      {
        title: "Drafts stay drafts until someone checks them",
        body: "Drafted scores have a dashed outline and count in the ranking. Choosing a value yourself makes a score yours. The printed summary leaves drafts out unless you include them.",
        action: "Open Criteria",
        target: "#scr-tab-criteria", click: true,
        prepare: async ctx => { closeDialog("#scr-ai-dialog"); await ensureExampleScreening(ctx.app); screeningTab("candidates"); }
      },
      {
        title: "Agree the criteria and weights",
        body: "Rename criteria, move them between groups, change weights from 0 to 10 and set flags. The share of weight per group shows the balance between value and ease.",
        action: "Open Ranking",
        target: "#scr-tab-ranking", click: true,
        prepare: async ctx => { await ensureExampleScreening(ctx.app); screeningTab("criteria"); }
      },
      {
        title: "See which process to start with",
        body: "The first choice, its score and where it falls on value against ease. The stability check moves each weight 20 percent up and down and names any change that would put another process first.",
        action: "",
        target: "#scr-stability-headline", click: false,
        prepare: async ctx => { await ensureExampleScreening(ctx.app); screeningTab("ranking"); const b = $("#screening-dialog .dlg-body"); if (b) b.scrollTop = 0; }
      },
      {
        title: "Share a one-page summary",
        body: "The recommendation in words, the chart, the ranking and the criteria with their weights.",
        action: "Open Summary",
        target: "#scr-tab-summary", click: true,
        prepare: async ctx => { await ensureExampleScreening(ctx.app); screeningTab("ranking"); const b = $("#screening-dialog .dlg-body"); if (b) b.scrollTop = 0; }
      },
      {
        title: "Print it on its own",
        body: "Print or save as PDF prints the summary without the app around it.",
        action: "",
        target: "#scr-print-btn", click: false,
        prepare: async ctx => { await ensureExampleScreening(ctx.app); screeningTab("summary"); }
      },
      {
        title: "Turn the first choice into a project",
        body: "Start a project for it creates a project with the process name, client, confidentiality and yearly figures. The screening stays open in this tab.",
        action: "Start a project for it",
        target: "#scr-start-first", click: true,
        prepare: async ctx => {
          closeDialogWith(/Start a project for/);
          await ensureExampleScreening(ctx.app); screeningTab("ranking");
          const b = $("#screening-dialog .dlg-body"); if (b) b.scrollTop = 0;
        }
      },
      {
        title: "Confirm what the new project gets",
        body: "The confirmation says what carries over, and warns when the process is not the first choice, is not fully scored or is flagged.",
        action: "Start the project",
        target: () => { const d = dialogWith(/Start a project for/); return d ? d.querySelector(".dlg-foot .btn-primary") : null; },
        click: true,
        prepare: async ctx => {
          await ensureExampleScreening(ctx.app); screeningTab("ranking");
          if (!dialogWith(/Start a project for/)) { const b = $("#scr-start-first"); if (b) b.click(); }
        }
      },
      {
        title: "Build the chosen process with the client",
        body: "The process builder opens on the new project with a start, an end and a first lane. Add the steps with the people who run it.",
        action: "",
        target: "#builder-dialog", click: false
      }
    ]
  };

  B.tourFlows = [analyze, screen];
})(typeof globalThis !== "undefined" ? globalThis : this);
