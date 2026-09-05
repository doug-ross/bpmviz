(function(){
  "use strict";
  function N(lane,x,type,label,sub,s,e,opt){
    opt=opt||{};
    return Object.assign({lane,x,type,label,sub,s,e,bs:s,be:e},opt);
  }
  const COL=c=>90+c*240;              // column x helper — 8 columns used (0..7)

  // COLS=8 -> CONTENT_W = max(1660, 214+(8-1)*240) = 1894
  // lanes=6 -> CONTENT_H = 8 + 6*84 = 512
  const layout={ CONTENT_W:1894, CONTENT_H:512,
    GUTTER:164, LANE_TOP:8, LH:84, BASE_B:710, BASE_A:34, DURATION:22000,
    startZoom:0.8 /* 8-column diagram; opens readable, "All" fits everything */ };

  // Lane_System (GLOBB Matching & Posting Engine) modeled as internal "human"-typed lane
  // because it is an existing rules-based system operated by GLOBB Ops (not literally a
  // person, but not the new AI agent either) — contract only supports ext|human|agent.
  const lanes=[
    {id:"ext",  name:"GCAS / Haloes", role:"Ext. Feeds", type:"ext"},
    {id:"deal", name:"Deal Setup",    role:"Analytics",  type:"human"},
    {id:"ops",  name:"CS Analyst",    role:"Maker",      type:"human"},
    {id:"review",name:"Reviewer/RM", role:"Approver",    type:"human"},
    {id:"sys",  name:"Matching Eng.", role:"Rules Engine",type:"human"},
    {id:"ai",   name:"Agentic AI",    role:"Autonomous",  type:"agent"}
  ];

  const milestones={
    names:["Deal Setup","Cash Config","Matching","Reconciliation","Posted"],
    x:[0.34,0.42,0.45,0.90,1.0],
    baseB:[240,300,315,650,710],
    baseA:[10,10,26,34,34]
  };

  // ---------- BEFORE (current state) ----------
  // Durations: manual deal setup/approval and manual triage are the two big bottlenecks
  // (4h and 5h respectively); feed ingest/matching are near-instant automated steps.
  const before={
    nodes:[
      N("deal",  COL(0),"start","Deal initiated","New deal request",0,0),
      N("deal",  COL(1),"gw",   "Setup path?","",0,0),
      N("deal",  COL(2),"task", "Setup & submit","Shell+overview+appr",0,240,{bott:true}),
      N("review",COL(3),"gw",   "Deal approved?","",240,240),
      N("review",COL(4),"end",  "Denied","Changes lost",240,240),
      N("deal",  COL(4),"task", "Configure cash","Timing+accounts",240,300),
      N("ext",   COL(5),"task", "Send txn feeds","GCAS+Haloes 5min",300,305),
      N("sys",   COL(5),"gw",   "Auto-matched?","rules+tolerance",305,305),
      N("sys",   COL(6),"task", "Reconcile match","Recon Group ID",305,315),
      N("ops",   COL(6),"task", "Manual triage","Match/adjust/clear",305,605,{bott:true}),
      N("review",COL(6),"task", "Approve posting","Dual control",605,650),
      N("sys",   COL(7),"task", "Confirm & post","Haloes+ledger",650,710),
      N("ext",   COL(7),"end",  "Reportable","Cash Activity ID",710,710)
    ],
    edges:[
      [0,1],
      [1,2,"All Deals"],
      [1,2,"Direct"],
      [2,3],
      [3,4,"Denied"],
      [3,5,"Approved"],
      [5,6],
      [6,7],
      [7,8,"Yes"],
      [7,9,"No"],
      [9,7,"Retry",{dashed:true}],
      [8,10],
      [9,10],
      [10,11],
      [11,12],
      [11,9,"Failed",{dashed:true}]
    ]
  };

  // ---------- AFTER (agentic future state) ----------
  // Setup Agent + Matching Agent + Posting Agent handle routine work end-to-end.
  // Three gateways route the majority straight-through (early bypass); only true
  // exceptions (nonstandard deals, unresolved matches, high-value postings) hit a
  // human-in-the-loop. A light 5% QA sample audits auto-reconciled items.
  const after={
    nodes:[
      N("deal", COL(0),"start","Deal initiated","New deal request",0,0),
      N("ai",   COL(1),"task", "Auto-config deal","Setup+cash rules",0,10,{agent:true,role:"AI"}),
      N("ai",   COL(2),"gw",   "Exception deal?","",10,10),
      N("deal", COL(3),"task", "Review deal","Nonstandard terms",10,30,{exc:true,role:"HITL"}),
      N("ai",   COL(3),"task", "Ingest & match","Feeds+rules",10,18,{agent:true,role:"AI"}),
      N("ai",   COL(4),"gw",   "Match found?","",18,18),
      N("ops",  COL(5),"task", "Resolve match","True exception",18,33,{exc:true,role:"HITL"}),
      N("ai",   COL(5),"task", "Auto-reconcile","Recon Group ID",18,26,{agent:true,role:"AI"}),
      N("ai",   COL(6),"gw",   "Approval needed?","",26,26),
      N("review",COL(6),"task","Approve posting","High-value only",26,33,{exc:true,role:"HITL"}),
      N("ai",   COL(7),"task", "Post & confirm","Haloes+ledger",26,34,{agent:true,role:"AI"}),
      N("ext",  COL(7),"end",  "Reportable","Cash Activity ID",34,34),
      N("deal", COL(7),"task", "QA audit sample","Sampled review",26,34,{opt:true})
    ],
    edges:[
      [0,1],
      [1,2],
      [2,3,"Yes"],
      [2,4,"No",{early:true}],
      [3,4],
      [4,5],
      [5,6,"No"],
      [5,7,"Yes",{early:true}],
      [6,7],
      [7,8],
      [7,12,"5% QA",{dashed:true}],
      [8,9,"Yes"],
      [8,10,"No",{early:true}],
      [9,10],
      [10,11]
    ]
  };

  const cases=[
    { id:1, title:"Auto-Match Reconciliation", status:"COMPLETED", tag:"t-done",
      fund:"Meridian Credit Fund", amt:"$1.8M", b:460, a:22,
      exec:{ save:"7.3 hrs", saveS:"95%", cut:"$290", fte:"0.4" },
      mt:[ ["Cycle time",460,22,"-95%"], ["Cost / item","$320","$28","-91%"],
           ["Human touches",5,1,"-80%"], ["Straight-through","0%","96%","+96pp"],
           ["Match accuracy","93%","99%","+6pp"], ["Throughput / day",45,180,"+300%"] ] },
    { id:2, title:"Deal Approval Delay", status:"STUCK", tag:"t-stuck",
      fund:"Horizon Opportunities", amt:"$5.2M", b:1440, a:55,
      exec:{ save:"23.1 hrs", saveS:"96%", cut:"$1,155", fte:"0.7" },
      mt:[ ["Cycle time",1440,55,"-96%"], ["Cost / item","$1,250","$95","-92%"],
           ["Human touches",9,2,"-78%"], ["Straight-through","0%","80%","+80pp"],
           ["Approval loops",4,1,"-75%"], ["Throughput / day",12,60,"+400%"] ] },
    { id:3, title:"Manual Triage Heavy", status:"IN PROGRESS", tag:"t-prog",
      fund:"Blue Harbor SMA", amt:"$3.1M", b:710, a:34,
      exec:{ save:"11.3 hrs", saveS:"95%", cut:"$480", fte:"0.5" },
      mt:[ ["Cycle time",710,34,"-95%"], ["Cost / item","$520","$40","-92%"],
           ["Human touches",7,2,"-71%"], ["Straight-through","0%","90%","+90pp"],
           ["Match accuracy","91%","98%","+7pp"], ["Throughput / day",30,140,"+367%"] ] },
    { id:4, title:"Net-Zero Adjustment", status:"COMPLETED", tag:"t-done",
      fund:"Cascade Fixed Income", amt:"$920K", b:600, a:30,
      exec:{ save:"9.5 hrs", saveS:"95%", cut:"$395", fte:"0.4" },
      mt:[ ["Cycle time",600,30,"-95%"], ["Cost / item","$430","$34","-92%"],
           ["Human touches",6,1,"-83%"], ["Straight-through","0%","92%","+92pp"],
           ["Net-zero errors","4%","0.5%","-3.5pp"], ["Throughput / day",35,150,"+329%"] ] },
    { id:5, title:"New Deal Onboarding", status:"NEW", tag:"t-new",
      fund:"Tidewater Municipal", amt:"$4.4M", b:710, a:34,
      exec:{ save:"11.3 hrs (proj.)", saveS:"95%", cut:"$480", fte:"0.5" },
      mt:[ ["Cycle time",710,34,"-95%"], ["Cost / item","$520","$40","-92%"],
           ["Human touches",7,2,"-71%"], ["Straight-through","0%","90%","+90pp"],
           ["Match accuracy","91%","98%","+7pp"], ["Throughput / day",30,140,"+367%"] ] }
  ];

  const branding={
    docTitle:"E2E Transaction Matching — Race Explorer",
    kicker:"GLOBB · Cash Transaction Matching",
    title:"E2E Transaction Matching: From Manual Triage to Agentic Reconciliation",
    status:"Current State &rarr; AI-Agentified Future State",
    beforeLabel:"Before · Current State",
    afterLabel:"After · Future State",
    footer:"Source: E2E Transaction Matching current-state BPMN (GLOBB / CT Operations).",
    linkedin:"linkedin.com/in/dougross",
    startCase:3,
    helpText:"Click any node for full detail.\nUse Before/After toggle to compare states.\nDrag to pan, scroll or pinch to zoom.\n\"All\" button fits the whole diagram.\nDashed edges = retries, failures, or sampled QA."
  };

  const styles=`
  :root{
    --bg:#0b1220; --panel:#111a2b; --panel2:#0f1830; --grid:#1c2942; --ink:#e8edf6; --muted:#93a3bd;
    --ext:#5b7fb0; --human:#3f8f6b; --agent:#a86ee0; --bott:#e0a83f; --exc:#e05f5f; --opt:#6b7ca8;
    --done:#3fae6a; --prog:#4fa0e0; --stuck:#e05f5f; --new:#c9a63f; --edge:#3a4a6b; --edge-dash:#5c6f95;
  }
  *{box-sizing:border-box;}
  body{background:var(--bg);color:var(--ink);font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;}
  .app{display:flex;flex-direction:column;height:100vh;}
  .topbar{display:flex;align-items:center;gap:16px;padding:10px 18px;background:var(--panel);border-bottom:1px solid var(--grid);}
  .kicker{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);}
  .title{font-size:16px;font-weight:600;color:var(--ink);}
  .status-pill{font-size:11px;padding:3px 10px;border-radius:12px;background:var(--panel2);color:var(--muted);border:1px solid var(--grid);}
  .toggle{display:flex;border:1px solid var(--grid);border-radius:8px;overflow:hidden;margin-left:auto;}
  .toggle button{background:var(--panel2);color:var(--muted);border:none;padding:6px 14px;font-size:12px;cursor:pointer;}
  .toggle button.active{background:var(--agent);color:#fff;}
  .btn{background:var(--panel2);color:var(--ink);border:1px solid var(--grid);border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;}
  .btn:hover{border-color:var(--agent);}
  .main{display:flex;flex:1;overflow:hidden;}
  .canvas-wrap{flex:1;position:relative;overflow:hidden;background:radial-gradient(circle at 20% 10%,#101c33,var(--bg) 60%);}
  svg.diagram{width:100%;height:100%;}
  .lane-row{fill:var(--panel2);opacity:.5;}
  .lane-row:nth-child(even){opacity:.3;}
  .lane-label{fill:var(--muted);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;}
  .lane-role{fill:var(--muted);font-size:9px;opacity:.7;}
  .milestone-line{stroke:var(--grid);stroke-dasharray:4 4;stroke-width:1;}
  .milestone-label{fill:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.05em;}
  .node-box{fill:var(--panel2);stroke:var(--edge);stroke-width:1.3;rx:8;cursor:pointer;transition:filter .15s;}
  .node-box:hover{filter:brightness(1.25);}
  .node-box.type-start,.node-box.type-end{fill:var(--panel);stroke:var(--muted);}
  .node-box.lane-ext{stroke:var(--ext);}
  .node-box.lane-human{stroke:var(--human);}
  .node-box.lane-agent, .node-box.agent{stroke:var(--agent);}
  .node-box.bott{stroke:var(--bott);stroke-width:2.2;filter:drop-shadow(0 0 6px rgba(224,168,63,.5));}
  .node-box.exc{stroke:var(--exc);stroke-width:2;}
  .node-box.opt{stroke:var(--opt);stroke-dasharray:3 3;}
  .node-label{fill:var(--ink);font-size:11px;font-weight:600;}
  .node-sub{fill:var(--muted);font-size:9px;}
  .node-badge{fill:var(--muted);font-size:8px;}
  .role-pill{fill:var(--panel);stroke:var(--agent);font-size:8px;}
  .gw-diamond{fill:var(--panel2);stroke:var(--edge);stroke-width:1.3;cursor:pointer;}
  .gw-label{fill:var(--ink);font-size:10px;font-weight:600;text-anchor:middle;}
  .edge-path{fill:none;stroke:var(--edge);stroke-width:1.4;marker-end:url(#arrow);}
  .edge-path.dashed{stroke:var(--edge-dash);stroke-dasharray:5 4;}
  .edge-path.early{stroke:var(--agent);}
  .edge-label{fill:var(--muted);font-size:9px;}
  .token{fill:var(--agent);filter:drop-shadow(0 0 4px var(--agent));}
  .token.before{fill:var(--bott);}
  .sidebar{width:340px;background:var(--panel);border-left:1px solid var(--grid);overflow-y:auto;padding:14px;}
  .case-card{background:var(--panel2);border:1px solid var(--grid);border-radius:8px;padding:10px 12px;margin-bottom:10px;cursor:pointer;}
  .case-card.active{border-color:var(--agent);}
  .case-title{font-size:12px;font-weight:600;color:var(--ink);}
  .case-meta{font-size:10px;color:var(--muted);margin-top:2px;}
  .tag{display:inline-block;font-size:9px;padding:2px 7px;border-radius:10px;margin-top:4px;}
  .t-done{background:rgba(63,174,106,.18);color:var(--done);}
  .t-prog{background:rgba(79,160,224,.18);color:var(--prog);}
  .t-stuck{background:rgba(224,95,95,.18);color:var(--stuck);}
  .t-new{background:rgba(201,166,63,.18);color:var(--new);}
  .metrics-table{width:100%;font-size:11px;border-collapse:collapse;margin-top:8px;}
  .metrics-table td{padding:4px 2px;border-bottom:1px solid var(--grid);color:var(--ink);}
  .metrics-table td.delta{color:var(--done);text-align:right;}
  .exec-strip{display:flex;gap:10px;margin-top:8px;flex-wrap:wrap;}
  .exec-chip{background:var(--panel);border:1px solid var(--grid);border-radius:6px;padding:6px 10px;font-size:10px;color:var(--muted);}
  .exec-chip b{color:var(--ink);font-size:12px;display:block;}
  .detail-panel{position:absolute;right:16px;bottom:16px;max-width:320px;background:var(--panel);border:1px solid var(--grid);
    border-radius:10px;padding:12px 14px;box-shadow:0 10px 30px rgba(0,0,0,.4);}
  .detail-panel h4{margin:0 0 4px;font-size:13px;color:var(--ink);}
  .detail-panel p{margin:0;font-size:11px;color:var(--muted);}
  .footer{padding:6px 18px;font-size:10px;color:var(--muted);border-top:1px solid var(--grid);background:var(--panel);
    display:flex;justify-content:space-between;}
  .footer a{color:var(--agent);text-decoration:none;}
  .help-tooltip{position:absolute;top:10px;right:10px;background:var(--panel);border:1px solid var(--grid);
    border-radius:8px;padding:8px 10px;font-size:10px;color:var(--muted);white-space:pre-line;max-width:260px;}
  `;

  window.PROCESS={layout,lanes,milestones,before,after,cases,branding,styles};
})();
