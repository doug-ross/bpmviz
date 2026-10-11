# AIxRay Audit Evidence

All code paths are relative to the uploaded archive root. Numbered source excerpts use actual uploaded-file line numbers. Unicode in source is retained to expose existing encoding issues. Test harnesses assemble assets in memory because direct-file and localhost navigation were blocked by the browser environment. Repository files were not modified.

## E01: Repository map

**Runtime / supporting evidence:** `source_manifest.json`

### `README.md:1-37`

```text
   1: # aixray
   2: 
   3: ## A simple visualizer for BPMN diagrams 
   4: 
   5: * Presentations: as-is and to-be process simulations
   6: * Design: how will this process work – and who are the stakeholders?
   7: * Support: enhanced telemetry capture could show real-time execution
   8: * Audit: what happened during this business process?
   9: 
  10: In general, it's a simple way to offer transparency into operations across stakeholder groups.
  11: 
  12: ## Sample
  13: 
  14: http://fpsbi.com/s/k2/bl2/
  15: 
  16: <img width="1920" height="990" alt="image" src="https://github.com/user-attachments/assets/ec21bbf4-20ba-47e8-9b0f-b4d4d7960895" />
  17: 
  18: ## About AIxRay
  19: 
  20: * Self-contained HTML, CSS and JS solution
  21: * Can run anywhere, even from a desktop (no web server needed, but it helps :-)
  22: * Install in any folder
  23: * index.htm is the default loader file and uses the following 
  24: 
  25: <img width="480" alt="image" src="https://github.com/user-attachments/assets/2dca03c7-9bcf-4d02-a3ee-acc64546bd11" />
  26: 
  27: ## Creating your own
  28: 
  29: * Clone this repo
  30: * Take any business process diagram (BPMN file, process diagram in a PDF, etc.) and feed it as input into...
  31: * The *tools/aixray_creator_prompt.txt* - it will leverage any of the above and create all three JS files for you. [1]
  32:   * branding.js - governs appearance
  33:   * process.js - describes the business process
  34:   * samples.js - provides sample runs of the business process
  35: * Run the *index.htm* file in your browser or any web server to see it execute.
  36: 
  37: Note [1]: Recommend the use of Opus-4.6 and higher. Untested with other models.
```

## E02: Repeated visits, transitions, and parallel-path helper

**Runtime / supporting evidence:** `browser_results.json: explorer.rework_test, wrong_branch_test, rework_detail`

### `webui/js/visualizer.js:309-339`

```text
 309: function nodeStateAt(nodeId, simT, sub){
 310:   const visits = sub.path.filter(p=>p.nodeId===nodeId);
 311:   if (visits.length===0) return {state:'pending', visited:false};
 312:   const v = visits[0];
 313:   if (simT < v.t) return {state:'pending', visited:false};
 314:   if (v.dur === 0) {
 315:     return {state: simT >= v.t ? 'complete' : 'pending', visited: simT >= v.t, entry: v};
 316:   }
 317:   if (simT < v.t + v.dur) {
 318:     const elapsed = simT - v.t;
 319:     const node = NODE_BY_ID[nodeId];
 320:     const slaPct = node.sla ? elapsed / node.sla : 0;
 321:     return {state: slaPct > 1 ? 'breach' : (slaPct > 0.9 ? 'warn' : 'active'), visited:true, elapsed, slaPct, entry:v};
 322:   }
 323:   return {state:'complete', visited:true, entry:v};
 324: }
 325: function flowVisited(flow, simT, sub){
 326:   return nodeStateAt(flow.to, simT, sub).visited;
 327: }
 328: function flowJustFired(flow, simT, sub){
 329:   const visits = sub.path.filter(p=>p.nodeId===flow.to);
 330:   if (!visits.length) return false;
 331:   const v = visits[0];
 332:   const delta = simT - v.t;
 333:   return delta >= 0 && delta < 8;
 334: }
 335: function flowFeedingActive(flow, simT, sub){
 336:   const targetSt = nodeStateAt(flow.to, simT, sub);
 337:   if (!['active','warn','breach'].includes(targetSt.state)) return false;
 338:   const sourceSt = nodeStateAt(flow.from, simT, sub);
 339:   return sourceSt.visited;
```

### `webui/js/samples.js:5-26`

```text
   5: function buildPath(steps){
   6:   let t = 0; const out = [];
   7:   function walk(arr){
   8:     for (const s of arr) {
   9:       if (Array.isArray(s[0])) {
  10:         const startT = t; let maxEnd = startT;
  11:         for (const branch of s) {
  12:           let bt = startT;
  13:           for (const [nid, dur] of branch) { out.push({nodeId:nid, t:bt, dur}); bt += dur; }
  14:           if (bt > maxEnd) maxEnd = bt;
  15:         }
  16:         t = maxEnd;
  17:       } else {
  18:         const [nid, dur] = s;
  19:         out.push({nodeId:nid, t, dur});
  20:         t += dur;
  21:       }
  22:     }
  23:   }
  24:   walk(steps);
  25:   return out;
  26: }
```

### `webui/js/samples.js:138-178`

```text
 138:   },
 139: 
 140:   {
 141:     id:'pay004',
 142:     name:'Payroll Variance Bot Â· stuck in rework',
 143:     client:'Payroll Operations',
 144:     engagement:'Variance-detection automation',
 145:     fees:'~12,000 records / cycle',
 146:     partner:'Daniel Okoro',
 147:     office:'London',
 148:     status:'stuck',
 149:     summary:'QA returned defects and the bot bounced back to development. The rework Develop Bot cycle has now blown past its SLA and is escalated.',
 150:     path: buildPath([
 151:       ['start',0],
 152:       ['workshop',115],
 153:       ['useCase',60],
 154:       ['reuseEngine',5],
 155:       ['effortEst',6],
 156:       ['gatherReqs',240],
 157:       ['draftPdd',10],
 158:       ['finalPdd',180],
 159:       ['fork1',0],
 160:       [
 161:         [['provAccess',430]],
 162:         [['dataClass',115]],
 163:         [['preApprovals',920]],
 164:       ],
 165:       ['join1',0],
 166:       ['developBot',2300],
 167:       ['qa',460],
 168:       ['qaGate',0],
 169:       ['developBot',5200],
 170:       ['qa',460],
 171:       ['qaGate',0],
 172:       ['uat',900],
 173:       ['uatGate',0],
 174:       ['deploy',110],
 175:       ['end',0],
 176:     ]),
 177:     pauseAt: 9100
 178:   },
```

```json
{
  "rework_test": {
    "submission": "pay004",
    "visits": [
      {
        "nodeId": "developBot",
        "t": 1536,
        "dur": 2300
      },
      {
        "nodeId": "developBot",
        "t": 4296,
        "dur": 5200
      }
    ],
    "at9100": {
      "state": "complete",
      "visited": true,
      "entry": {
        "nodeId": "developBot",
        "t": 1536,
        "dur": 2300
      }
    },
    "actualActiveVisits": [
      {
        "nodeId": "developBot",
        "t": 4296,
        "dur": 5200
      }
    ]
  }
}
```

```json
{
  "wrong_branch_test": {
    "sample": "Invoice Capture Bot \u00c2\u00b7 deployed to production",
    "hasReworkVisit": 1,
    "defectsEdgeAt4000": true,
    "qaGatewayState": {
      "state": "pending",
      "visited": false
    }
  }
}
```

```json
{
  "rework_detail": "Developer\nDevelop Bot\nCOMPLETE \u00c2\u00b7 1D 14H\nThe developer builds the automation against the finalized PDD, reusing matched components where possible.\nAvg duration\n1d 14h\nSLA target\n3d 8h\nActual\n1d 14h"
}
```

## E03: Overlapping governance nodes

**Runtime / supporting evidence:** `browser_results.json: explorer.geometry_collision`

### `webui/js/process.js:49-59`

```text
  49:   { id:'provAccess', type:'taskService', label:'Provision\nAccess', lane:'gov', col:9,
  50:     avg:420, sla:1440,
  51:     desc:'Service accounts, credentials and system access required by the bot are provisioned across target applications.' },
  52: 
  53:   { id:'dataClass', type:'taskScript', label:'Data\nClassification', lane:'gov', col:9,
  54:     avg:110, sla:480,
  55:     desc:'The data handled by the automation is classified against information-security policy to determine handling and storage controls.' },
  56: 
  57:   { id:'preApprovals', type:'taskUser', label:'Pre-Approvals', lane:'gov', col:9,
  58:     avg:900, sla:2880,
  59:     desc:'Governance and security pre-approvals are obtained from the relevant control owners before the build can proceed.' },
```

### `webui/js/visualizer.js:55-67`

```text
  55: const COL_W = 130, LANE_H = 100, LANE_LBL = 160, PAD_L = 24, PAD_T = 28;
  56: const TASK_W = 118, TASK_H = 70;
  57: const TASK_FONT = 14;
  58: const LINE_H = 16;
  59: const SVG_W = LANE_LBL + (Math.max(...NODES.map(n=>n.col))+1) * COL_W + PAD_L*2 + 20;
  60: const SVG_H = LANE_H * LANES.length + PAD_T*2;
  61: 
  62: function laneIndex(id){ return LANES.findIndex(l=>l.id===id); }
  63: function nodeXY(node){
  64:   return {
  65:     x: PAD_L + LANE_LBL + node.col * COL_W + COL_W/2,
  66:     y: PAD_T + laneIndex(node.lane) * LANE_H + LANE_H/2
  67:   };
```

```json
[
  [
    "provAccess",
    "dataClass",
    {
      "x": 1419,
      "y": 478
    }
  ],
  [
    "provAccess",
    "preApprovals",
    {
      "x": 1419,
      "y": 478
    }
  ],
  [
    "dataClass",
    "preApprovals",
    {
      "x": 1419,
      "y": 478
    }
  ]
]
```

## E04: Excluded routes, completion display, and case scaling

**Runtime / supporting evidence:** `browser_results.json: astra_v2.offroute_state`

### `racer/webui-v2-astra/process.js:11-17`

```text
  11: Representative route (both Before and After):
  12:   Clearance passes → In appetite → Physical survey REQUIRED →
  13:   Fac reinsurance REQUIRED → Within authority (no referral) →
  14:   Broker binds (no negotiate loop) → Policy issued.
  15:   Off-route branches (decline, referral-decline, submission-lost, negotiate
  16:   loop) are drawn as connectors with detail sheets but are NOT scheduled
  17:   on the timed critical path.
```

### `racer/webui-v2-astra/index.htm:1384-1388`

```text
1384:   function stateFor(n,elapsed) {
1385:     if(n.type==="start") return elapsed>0?"done":"active";
1386:     if(n.type==="gw"||n.type==="end") return elapsed>=n.e?"done":"";
1387:     if(elapsed>=n.e) return "done";
1388:     return elapsed>=n.s?"active":"";
```

### `racer/webui-v2-astra/index.htm:1548-1565`

```text
1548:   function render() {
1549:     const total=HAS_AFTER?Math.max(currentCase.b,currentCase.a):currentCase.b;
1550:     const elapsed=app.t*total;
1551:     KEYS.forEach(k=>{
1552:       const tr=app.tracks[k],time=Math.min(k==="before"?currentCase.b:currentCase.a,elapsed);
1553:       tr.nodeEls.forEach(g=>{
1554:         const n=g.nodeData,state=stateFor(n,time);
1555:         if(state!==g.state) {
1556:           g.classList.toggle("active",state==="active");
1557:           g.classList.toggle("done",state==="done"); g.state=state;
1558:         }
1559:         const star=g.querySelector(".star");
1560:         if(star) star.classList.toggle("show",app.stars&&time>=n.e);
1561:       });
1562:       tr.edges.forEach(edge=>{
1563:         const done=time>=edge.to.s;
1564:         if(done!==edge.done) {edge.el.classList.toggle("done",done);edge.done=done;}
1565:       });
```

### `racer/webui-v2-astra/index.htm:1619-1627`

```text
1619:   function rescale() {
1620:     KEYS.forEach(k=>{
1621:       const m=MODELS[k],f=(k==="before"?currentCase.b:currentCase.a)/m.base;
1622:       m.nodes.forEach(n=>{n.s=n.bs*f;n.e=n.be*f;});
1623:       milestoneTimes[k]=(k==="before"?MS.b:MS.a).map(v=>v*f);
1624:       app.tracks[k].nodeEls.forEach(g=>{
1625:         if(g.badge) updateFittedText(g.badge,fmt(g.nodeData.e-g.nodeData.s,true));
1626:       });
1627:     });
```

```json
[
  {
    "label": "Send Decline Letter",
    "opt": true,
    "s": 120,
    "e": 120,
    "state": "done",
    "class": "node lane-human opt done"
  },
  {
    "label": "Rejected (Clearance/Appetite)",
    "opt": true,
    "s": 120,
    "e": 120,
    "state": "done",
    "class": "node lane-human opt done"
  },
  {
    "label": "Review Technical Referral",
    "opt": true,
    "s": 9120,
    "e": 9120,
    "state": "done",
    "class": "node lane-human exc opt done"
  },
  {
    "label": "Authority Sign-off?",
    "opt": true,
    "s": 9120,
    "e": 9120,
    "state": "done",
    "class": "node lane-human opt done"
  },
  {
    "label": "Risk Declined by Authority",
    "opt": true,
    "s": 9120,
    "e": 9120,
    "state": "done",
    "class": "node lane-human opt done"
  },
  {
    "label": "Submission Lost",
    "opt": true,
    "s": 11640,
    "e": 11640,
    "state": "done",
    "class": "node lane-human opt done"
  }
]
```

## E05: Metric-unit formatting

**Runtime / supporting evidence:** `focused_tests.json: metric_rows`

### `racer/webui-v2-astra/index.htm:1630-1631`

```text
1630:   function metricValue(name,value) {
1631:     return /cycle\s*time/i.test(String(name))&&Number.isFinite(value)?fmt(value,true):value??"—";
```

### `racer/webui-v2-astra/process.js:1010-1023`

```text
1010:       b: 15360,  // 32 business days — matches BASE_B
1011:       a: 7440,   // 15.5 business days — matches BASE_A
1012:       exec: {
1013:         save: "132 cycle-hrs saved (16.5 business days)",
1014:         saveS: "−52% cycle time",
1015:         cut: "~$4,550 cost saved per submission",
1016:         fte: "7.3 FTE-equivalent capacity release (annualized at 400 subs)"
1017:       },
1018:       mt: [
1019:         ["Cycle time (business days)", 32,   15.5, "−52%"],
1020:         ["Human touch (hrs)",          55,   22,   "−33 hrs"],
1021:         ["Handoffs",                   19,   8,    "−11"],
1022:         ["External waits (days)",      11,   8,    "−3 days"],
1023:         ["Cost per submission",        "$8,250", "$3,700", "−$4,550"]
```

```text
Cycle time (business days)	32m	16m	−52%
Human touch (hrs)	55	22	−33 hrs
Handoffs	19	8	−11
External waits (days)	11	8	−3 days
Cost per submission	$8,250	$3,700	−$4,550
```

## E06: Economic assumptions and reconciliation

**Runtime / supporting evidence:** `financial_reconciliation.json`

### `racer/webui-v2-astra/process.js:954-1071`

```text
 954:   // All figures illustrative. Financial assumptions:
 955:   //   Rate $150/hr, 400 subs/yr, 1,800 FTE hrs/yr, AI ~$400/sub.
 956:   const cases = [
 957:     {
 958:       id: 1,
 959:       title: "Mid-Market Manufacturing — $150M TIV",
 960:       status: "ILLUSTRATIVE",
 961:       tag: "t-done",
 962:       fund: "Illustrative — single-location manufacturing, light fac",
 963:       amt: "$150M TIV / $2.4M premium",
 964:       b: 6720,   // 14 business days
 965:       a: 3360,   // 7 business days
 966:       exec: {
 967:         save: "56 cycle-hrs saved (7 business days)",
 968:         saveS: "−50% cycle time",
 969:         cut: "~$2,050 cost saved per submission",
 970:         fte: "3.3 FTE-equivalent capacity release (annualized at 400 subs)"
 971:       },
 972:       mt: [
 973:         ["Cycle time (business days)", 14,   7,    "−50%"],
 974:         ["Human touch (hrs)",          25,   10,   "−15 hrs"],
 975:         ["Handoffs",                   14,   6,    "−8"],
 976:         ["External waits (days)",      6,    5,    "−1 day"],
 977:         ["Cost per submission",        "$3,750", "$1,700", "−$2,050"]
 978:       ]
 979:     },
 980:     {
 981:       id: 2,
 982:       title: "Regional Retail Portfolio — $500M TIV",
 983:       status: "ILLUSTRATIVE",
 984:       tag: "t-done",
 985:       fund: "Illustrative — 40-location retail chain, moderate CAT",
 986:       amt: "$500M TIV / $6.8M premium",
 987:       b: 10560,  // 22 business days
 988:       a: 5040,   // 10.5 business days
 989:       exec: {
 990:         save: "92 cycle-hrs saved (11.5 business days)",
 991:         saveS: "−52% cycle time",
 992:         cut: "~$3,300 cost saved per submission",
 993:         fte: "5.3 FTE-equivalent capacity release (annualized at 400 subs)"
 994:       },
 995:       mt: [
 996:         ["Cycle time (business days)", 22,   10.5, "−52%"],
 997:         ["Human touch (hrs)",          40,   16,   "−24 hrs"],
 998:         ["Handoffs",                   16,   7,    "−9"],
 999:         ["External waits (days)",      8,    6,    "−2 days"],
1000:         ["Cost per submission",        "$6,000", "$2,700", "−$3,300"]
1001:       ]
1002:     },
1003:     {
1004:       id: 3,
1005:       title: "National Manufacturing Schedule — $1B TIV (Representative)",
1006:       status: "ILLUSTRATIVE — REPRESENTATIVE",
1007:       tag: "t-prog",
1008:       fund: "Illustrative — 120-location multi-state, wind & convective storm exposure, fac required",
1009:       amt: "$1B TIV / $12.5M premium",
1010:       b: 15360,  // 32 business days — matches BASE_B
1011:       a: 7440,   // 15.5 business days — matches BASE_A
1012:       exec: {
1013:         save: "132 cycle-hrs saved (16.5 business days)",
1014:         saveS: "−52% cycle time",
1015:         cut: "~$4,550 cost saved per submission",
1016:         fte: "7.3 FTE-equivalent capacity release (annualized at 400 subs)"
1017:       },
1018:       mt: [
1019:         ["Cycle time (business days)", 32,   15.5, "−52%"],
1020:         ["Human touch (hrs)",          55,   22,   "−33 hrs"],
1021:         ["Handoffs",                   19,   8,    "−11"],
1022:         ["External waits (days)",      11,   8,    "−3 days"],
1023:         ["Cost per submission",        "$8,250", "$3,700", "−$4,550"]
1024:       ]
1025:     },
1026:     {
1027:       id: 4,
1028:       title: "Multi-State Industrial — $2B TIV",
1029:       status: "ILLUSTRATIVE",
1030:       tag: "t-new",
1031:       fund: "Illustrative — heavy manufacturing, wind + quake, multiple fac layers",
1032:       amt: "$2B TIV / $22M premium",
1033:       b: 20160,  // 42 business days
1034:       a: 9600,   // 20 business days
1035:       exec: {
1036:         save: "176 cycle-hrs saved (22 business days)",
1037:         saveS: "−52% cycle time",
1038:         cut: "~$6,700 cost saved per submission",
1039:         fte: "10.0 FTE-equivalent capacity release (annualized at 400 subs)"
1040:       },
1041:       mt: [
1042:         ["Cycle time (business days)", 42,   20,   "−52%"],
1043:         ["Human touch (hrs)",          75,   30,   "−45 hrs"],
1044:         ["Handoffs",                   22,   10,   "−12"],
1045:         ["External waits (days)",      14,   10,   "−4 days"],
1046:         ["Cost per submission",        "$11,250", "$4,550", "−$6,700"]
1047:       ]
1048:     },
1049:     {
1050:       id: 5,
1051:       title: "Global Industrial Portfolio — $3.5B TIV",
1052:       status: "ILLUSTRATIVE — HIGH COMPLEXITY",
1053:       tag: "t-stuck",
1054:       fund: "Illustrative — multi-jurisdictional, several manuscript endorsements, complex fac tower",
1055:       amt: "$3.5B TIV / $38M premium",
1056:       b: 26400,  // 55 business days
1057:       a: 12480,  // 26 business days
1058:       exec: {
1059:         save: "232 cycle-hrs saved (29 business days)",
1060:         saveS: "−53% cycle time",
1061:         cut: "~$8,900 cost saved per submission",
1062:         fte: "13.3 FTE-equivalent capacity release (annualized at 400 subs)"
1063:       },
1064:       mt: [
1065:         ["Cycle time (business days)", 55,   26,   "−53%"],
1066:         ["Human touch (hrs)",          100,  40,   "−60 hrs"],
1067:         ["Handoffs",                   28,   12,   "−16"],
1068:         ["External waits (days)",      18,   13,   "−5 days"],
1069:         ["Cost per submission",        "$15,000", "$6,100", "−$8,900"]
1070:       ]
1071:     }
```

### `racer/webui-v2-astra/index.htm:1648-1679`

```text
1648:   function renderExec() {
1649:     const c=currentCase,e=c.exec||{},difference=HAS_AFTER?c.b-c.a:null;
1650:     text("#scoreTitle",HAS_AFTER?"EXECUTIVE IMPACT":"PROCESS BASELINE");
1651:     text("#scoreStatus",c.status||"SCENARIO");
1652:     text("#execFund",(c.id??"")+" · "+(c.title||c.fund||"Selected submission"));
1653:     text("#scoreBefore",fmt(c.b));
1654:     text("#scoreAfter",HAS_AFTER?fmt(c.a):"N/A");
1655:     text("#scoreAfterLabel",HAS_AFTER?"AFTER · CYCLE TIME":"AFTER · NOT SUPPLIED");
1656:     text("#cSave",HAS_AFTER?(e.save??signedTime(difference)):"—");
1657:     text("#cSaveS",HAS_AFTER?
1658:       (e.saveS?e.saveS+" supplied reduction":
1659:         Math.abs(difference/c.b*100).toFixed(1)+"% "+(difference>=0?"reduction":"increase")):
1660:       "Comparison not available");
1661:     text("#cCut",HAS_AFTER?(e.cut??"—"):"—");
1662:     text("#cFte",HAS_AFTER?(e.fte??"—"):"—");
1663:     text("#cFteS",HAS_AFTER?"Redeployable capacity":"Comparison not available");
1664:     const rows=Array.isArray(c.mt)?c.mt:[];
1665:     const cost=rows.find(r=>Array.isArray(r)&&/cost\s*\/\s*item/i.test(r[0]));
1666:     text("#cCutS",HAS_AFTER?(cost?cost[1]+" → "+cost[2]:"Supplied scenario estimate"):"Comparison not available");
1667:     $("#mtBody").innerHTML=rows.filter(Array.isArray).map(row=>
1668:       "<tr><td>"+esc(row[0])+'</td><td class="b4">'+esc(metricValue(row[0],row[1]))+
1669:       '</td><td class="af">'+esc(HAS_AFTER?metricValue(row[0],row[2]):"—")+
1670:       '</td><td class="delta">'+esc(HAS_AFTER?(row[3]??"—"):"—")+"</td></tr>"
1671:     ).join("")||'<tr><td>Cycle time</td><td class="b4">'+fmt(c.b,true)+
1672:       '</td><td class="af">'+(HAS_AFTER?fmt(c.a,true):"—")+
1673:       '</td><td>'+(HAS_AFTER?signedTime(c.a-c.b):"—")+"</td></tr>";
1674:     text("#scoreNote",HAS_AFTER?
1675:       "Illustrative / supplied scenario figures; not independently validated. Savings and FTE are displayed as supplied, not recalculated from hidden assumptions.":"Before-only definition. Baseline metrics are shown where supplied; after values and comparative savings are unavailable.");
1676:     text("#fastTxt",HAS_AFTER?
1677:       "After: "+fmt(c.a)+" · Before: "+fmt(c.b)+" · "+fmt(Math.abs(difference))+
1678:       (difference>=0?" faster":" slower"):
1679:       "Before baseline: "+fmt(c.b,true));
```

## E07: Responsive layout and fitted label readability

**Runtime / supporting evidence:** `All viewport PNG files; focused_tests.json: fit_all_zoom, fit_all_font_sample`

### `racer/webui-v2-astra/index.htm:423-447`

```text
 423: @media(max-width:1250px) {
 424:   .mainbody { grid-template-columns:minmax(0,1fr) 318px }
 425:   .hstat { display:none }
 426:   .toolbar { gap:5px }
 427:   .score-team .value { font-size:23px }
 428:   .trackhint { font-size:8px }
 429: }
 430: @media(max-width:760px) {
 431:   :root { --gutter:126px }
 432:   .app-header { padding:11px }
 433:   .kick { font-size:8px }
 434:   .toolbar { padding:7px }
 435:   .spacer { display:none }
 436:   .mainbody,.app.metrics-hidden .mainbody { display:block; overflow:auto }
 437:   .stage { height:max(650px,calc(100dvh - 155px)); padding:7px }
 438:   .side { height:740px; border-left:0; border-top:1px solid var(--border) }
 439:   .trackhint,.fast { display:none }
 440:   .cap { font-size:9px }
 441:   .gchip { left:6px; gap:5px }
 442:   .detail-grid { grid-template-columns:1fr }
 443:   .detail-facts { grid-template-columns:repeat(2,minmax(0,1fr)) }
 444:   .detail-head { padding-left:17px }
 445:   .detail-body { padding:15px 17px }
 446:   .dname { font-size:21px }
 447:   .navigator { height:190px }
```

### `racer/webui-v2-astra/index.htm:1184-1252`

```text
1184:   function trackSize(track) {
1185:     return {w:Math.max(1,track.view.clientWidth),h:Math.max(1,track.view.clientHeight)};
1186:   }
1187:   function sharedSize() {
1188:     const sizes=KEYS.map(k=>trackSize(app.tracks[k]));
1189:     return {w:Math.min(...sizes.map(s=>s.w)),h:Math.min(...sizes.map(s=>s.h))};
1190:   }
1191:   function fitScale() {
1192:     return Math.max(.001,Math.min(...KEYS.map(k=>{
1193:       const tr=app.tracks[k],s=trackSize(tr);
1194:       return Math.min(Math.max(1,s.w-16)/tr.model.width,
1195:         Math.max(1,s.h-8)/tr.model.height);
1196:     })));
1197:   }
1198:   function clampPan() {
1199:     // Union bounds: every diagram remains reachable with one shared transform.
1200:     const minX=Math.min(8,...KEYS.map(k=>{
1201:       const tr=app.tracks[k]; return trackSize(tr).w-tr.model.width*app.zoom-8;
1202:     }));
1203:     const minY=Math.min(4,...KEYS.map(k=>{
1204:       const tr=app.tracks[k]; return trackSize(tr).h-tr.model.height*app.zoom-4;
1205:     }));
1206:     app.panX=Math.max(minX,Math.min(8,app.panX));
1207:     app.panY=Math.max(minY,Math.min(4,app.panY));
1208:   }
1209:   function applyTransform() {
1210:     const transform=`translate(${app.panX},${app.panY}) scale(${app.zoom})`;
1211:     KEYS.forEach(k=>{
1212:       const tr=app.tracks[k],m=tr.model;
1213:       tr.content.setAttribute("transform",transform);
1214:       tr.chips.forEach((chip,i)=>{
1215:         const rowHeight=m.laneHeight*app.zoom;
1216:         const height=Math.min(34,Math.max(1,rowHeight-2));
1217:         chip.style.height=height+"px";
1218:         chip.style.top=((m.laneTop+(i+.5)*m.laneHeight)*app.zoom+app.panY-height/2)+"px";
1219:         chip.querySelector(".gn").style.fontSize=Math.min(10,Math.max(6,height*.42))+"px";
1220:         chip.querySelector(".gr").hidden=height<30;
1221:       });
1222:     });
1223:     text("#zpct",Math.round(app.zoom*100)+"%");
1224:     drawViewport();
1225:   }
1226:   function widthView() {
1227:     const size=sharedSize();
1228:     app.zoom=Math.max(.001,Math.min(2.5,(size.w-16)/WORLD_W));
1229:     app.panX=8; app.panY=4; app.viewMode="width";
1230:     applyTransform();
1231:   }
1232:   
1233: 		const TARGET_LANES = 5.5;   // how many swimlanes to show by default
1234: 
1235: 		function lanesScale() {
1236: 		  return Math.max(.001, Math.min(...KEYS.map(k => {
1237: 			const tr = app.tracks[k], s = trackSize(tr);
1238: 			// height of TARGET_LANES lanes (never more than the model actually has)
1239: 			const lanes = Math.min(TARGET_LANES, tr.model.lanes.length);
1240: 			const wanted = tr.model.laneTop + lanes * tr.model.laneHeight;
1241: 			return Math.max(1, s.h - 8) / wanted;
1242: 		  })));
1243: 		}
1244: 		function lanesView() {
1245: 		  app.zoom = Math.min(2.5, lanesScale());
1246: 		  app.panX = 8; app.panY = 4; app.viewMode = "manual";
1247: 		  clampPan(); applyTransform();
1248: 		}
1249: 
1250:   function fitAll() {
1251:     app.zoom=fitScale(); app.panX=8; app.panY=4; app.viewMode="fit";
1252:     applyTransform();
```

### `webui/css/styles.css:12-22`

```text
  12:   margin:0; padding:0; height:100%; overflow:hidden;
  13:   background: radial-gradient(ellipse at 30% 20%, #0d1426 0%, #050810 60%, #02040a 100%);
  14:   color: var(--ink-0);
  15:   font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
  16:   font-size: 13px; -webkit-font-smoothing: antialiased;
  17: }
  18: .app {
  19:   display: grid;
  20:   grid-template-rows: 54px 44px 1fr 30px;
  21:   grid-template-columns: 1fr 340px;
  22:   height: 100vh;
```

```json
{
  "fit_all_zoom": "11%",
  "fit_all_font_sample": [
    {
      "text": "Check Clearance & Dedup",
      "sourceFont": "13.96px",
      "renderedFont": 1.5724565964937212
    },
    {
      "text": "Clearance Approved?",
      "sourceFont": "10.71px",
      "renderedFont": 1.113577930268765
    },
    {
      "text": "Rejected (Clearance/Appetite)",
      "sourceFont": "10.71px",
      "renderedFont": 1.113577930268765
    },
    {
      "text": "AI Clearance & Dedup",
      "sourceFont": "15.99px",
      "renderedFont": 1.8011161158978939
    }
  ]
}
```

## E08: Accessibility and playback strengths and gaps

**Runtime / supporting evidence:** `browser_results.json: focusableNodes, help_accessibility, node_keyboard_dialog; focused_tests.json: paused/reduced-motion checks`

### `racer/webui-v2-astra/index.htm:841-849`

```text
 841:   let initialCase = Number.isInteger(P.startCase) ? P.startCase :
 842:     CASES.findIndex(c => c.id === BRAND.startCase);
 843:   if (initialCase < 0 || initialCase >= CASES.length) initialCase = 0;
 844: 
 845:   const app = {
 846:     zoom:1,panX:8,panY:4,viewMode:"width",
 847:     t:0,playing:!matchMedia("(prefers-reduced-motion: reduce)").matches,
 848:     hold:0,speed:1,loop:true,heat:false,labels:true,stars:false,metrics:true,
 849:     caseIdx:initialCase,tracks:{},split:.5
```

### `racer/webui-v2-astra/index.htm:1086-1133`

```text
1086:   function drawNode(parent,n,model) {
1087:     const lane=model.lanes.find(l=>l.id===n.lane);
1088:     const classes=["node","lane-"+lane.type];
1089:     ["bott","agent","exc","opt"].forEach(k=>{if(n[k])classes.push(k);});
1090:     const g=svgEl("g",{class:classes.join(" "),tabindex:0,role:"button",
1091:       "aria-label":n.label+". "+lane.name+". Open step details."});
1092:     parent.appendChild(g); g.nodeData=n;
1093:     const title=svgEl("title"); title.textContent=n.label+(n.sub?" — "+n.sub:"");
1094:     g.appendChild(title);
1095:     if(n.type==="task") {
1096:       g.appendChild(svgEl("rect",{class:"nbox",x:n.x-92,y:n.y-32,width:184,height:64,rx:9}));
1097:       fittedText(g,n.label,{x:n.x-82,y:n.y-16,w:164,h:31},
1098:         {max:16,weight:650,lines:2,cls:"nlabel"});
1099:       if(n.sub) fittedText(g,n.sub,{x:n.x-82,y:n.y+17,w:164,h:12},
1100:         {max:11,weight:450,cls:"nsub"});
1101:       const role=n.role||(n.bott?"BOTTLENECK":n.opt?"OPTIONAL":"");
1102:       if(role) fittedText(g,role,{x:n.x-82,y:n.y-29,w:90,h:10},
1103:         {max:8.5,weight:700,cls:"roletext"});
1104:       g.badge=fittedText(g,fmt(n.e-n.s,true),{x:n.x+14,y:n.y-29,w:68,h:10},
1105:         {max:8.5,weight:550,cls:"badge"});
1106:     } else {
1107:       if(n.type==="gw") {
1108:         const r=G.gatewayR;
1109:         g.appendChild(svgEl("polygon",{class:"nbox",
1110:           points:`${n.x},${n.y-r} ${n.x+r},${n.y} ${n.x},${n.y+r} ${n.x-r},${n.y}`}));
1111:         g.appendChild(svgEl("path",{class:"gateway-mark",
1112:           d:`M${n.x-5},${n.y-5} L${n.x+5},${n.y+5} M${n.x+5},${n.y-5} L${n.x-5},${n.y+5}`}));
1113:       } else {
1114:         const circle=svgEl("circle",{class:"nbox",cx:n.x,cy:n.y,r:G.eventR});
1115:         if(n.type==="end") circle.style.strokeWidth="3.2";
1116:         g.appendChild(circle);
1117:         if(n.type==="start") g.appendChild(svgEl("circle",{
1118:           class:"start-dot",cx:n.x,cy:n.y,r:5}));
1119:         else g.appendChild(svgEl("path",{class:"star",d:starPath(n.x,n.y,10)}));
1120:       }
1121:       fittedText(g,n.label,{x:n.x-90,y:n.y+26,w:180,h:14},
1122:         {max:11.5,weight:600,cls:"nsub"});
1123:     }
1124:     g.addEventListener("keydown",event=>{
1125:       if(event.key==="Enter"||event.code==="Space") {
1126:         event.preventDefault(); event.stopPropagation(); showNodeDetail(n,model.which);
1127:       }
1128:     });
1129:     // Keyboard and assistive-technology activation; pointer taps are handled by the view.
1130:     g.addEventListener("click",event=>{
1131:       if(event.detail===0) showNodeDetail(n,model.which);
1132:     });
1133:     return g;
```

### `racer/webui-v2-astra/index.htm:1348-1358`

```text
1348:   function closeDetail() {
1349:     if($("#detailWrap").open) $("#detailWrap").close();
1350:     detailContext=null;
1351:   }
1352:   function openDetail(html) {
1353:     $("#detail").innerHTML=html;
1354:     $("#dclose").onclick=closeDetail;
1355:     const dialog=$("#detailWrap");
1356:     if(!dialog.open) dialog.showModal();
1357:     dialog.scrollTop=0;
1358:   }
```

### `racer/webui-v2-astra/index.htm:1681-1687`

```text
1681:   function selectCase(index) {
1682:     if(!Number.isInteger(index)||!CASES[index]) return;
1683:     app.caseIdx=index;currentCase=CASES[index];
1684:     app.t=0;app.hold=0;lastTs=0;
1685:     // Intentionally preserve app.playing, including an explicit Stop.
1686:     closeDetail();rescale();renderList();renderExec();
1687:     $("#caseSel").value=String(index);syncPlay();render();
```

### `racer/webui-v2-astra/index.htm:1930-1947`

```text
1930:     window.addEventListener("keydown",e=>{
1931:       if($("#detailWrap").open||e.ctrlKey||e.metaKey||e.altKey)return;
1932:       const target=e.target;
1933:       if(target instanceof Element&&target.closest(
1934:         "input,select,textarea,button,a,[contenteditable='true'],summary"))return;
1935:       if(e.key==="+"||e.key==="="||e.code==="NumpadAdd") {
1936:         e.preventDefault();zoomBy(1.2);
1937:       } else if(e.key==="-"||e.key==="−"||e.code==="NumpadSubtract") {
1938:         e.preventDefault();zoomBy(1/1.2);
1939:       } else if(e.code==="Space") {
1940:         e.preventDefault();setPlaying(!app.playing);
1941:       } else if(e.key==="?") {
1942:         e.preventDefault();showHelp();
1943:       } else if(e.key.startsWith("Arrow")) {
1944:         e.preventDefault();
1945:         panBy(e.key==="ArrowLeft"?40:e.key==="ArrowRight"?-40:0,
1946:           e.key==="ArrowUp"?40:e.key==="ArrowDown"?-40:0);
1947:       }
```

### `webui/js/visualizer.js:1025-1047`

```text
1025: const helpModal = document.getElementById('help-modal');
1026: document.getElementById('btn-help').addEventListener('click', ()=>helpModal.classList.add('show'));
1027: helpModal.addEventListener('click', (e)=>{
1028:   if(e.target===helpModal) helpModal.classList.remove('show');
1029:   if(e.target.id==='help-close') helpModal.classList.remove('show');
1030: });
1031: 
1032: document.getElementById('sub-select').addEventListener('change', (e)=>{
1033:   selectSubmission(parseInt(e.target.value));
1034: });
1035: 
1036: window.addEventListener('keydown', (e)=>{
1037:   if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
1038:   if (e.key === ' ') { e.preventDefault(); setPlaying(!STATE.playing); }
1039:   else if (e.key === '+' || e.key === '=' || (e.shiftKey && e.key === 'ArrowUp')) { STATE.zoom = Math.min(8, STATE.zoom*1.15); applyView(); }
1040:   else if (e.key === '-' || e.key === '_' || (e.shiftKey && e.key === 'ArrowDown')) { STATE.zoom = Math.max(0.4, STATE.zoom/1.15); applyView(); }
1041:   else if (e.key === '0') { setDefaultView(); }
1042:   else if (e.key === 'f' || e.key === 'F') { setFitAllView(); }
1043:   else if (e.key === '?' || e.key === '/') { helpModal.classList.toggle('show'); }
1044:   else if (e.key === 'Escape') { helpModal.classList.remove('show'); STATE.selectedNode = null; renderDetail(); }
1045:   else if (e.key === 'r' || e.key === 'R') { STATE.simT = 0; setPlaying(true); }
1046:   else if (e.key === 'e' || e.key === 'E') { STATE.simT = Math.min(currentSub().pauseAt, maxT(currentSub())); setPlaying(false); }
1047: });
```

## E09: Model contracts and structural validation

**Runtime / supporting evidence:** `browser_results.json: astra_v2.configuration; focused_tests.json: before_only, invalid_lane, negative_time, after_slower`

### `webui/js/process.js:90-116`

```text
  90: const FLOWS = [
  91:   ['start','workshop'],
  92:   ['workshop','useCase'],
  93:   ['useCase','reuseEngine'],
  94:   ['reuseEngine','effortEst'],
  95:   ['effortEst','gatherReqs'],
  96:   ['gatherReqs','draftPdd'],
  97:   ['draftPdd','finalPdd'],
  98:   ['finalPdd','fork1'],
  99:   ['fork1','provAccess'],
 100:   ['fork1','dataClass'],
 101:   ['fork1','preApprovals'],
 102:   ['provAccess','join1'],
 103:   ['dataClass','join1'],
 104:   ['preApprovals','join1'],
 105:   ['join1','developBot'],
 106:   ['developBot','qa'],
 107:   ['qa','qaGate'],
 108:   ['qaGate','developBot','Defects'],
 109:   ['qaGate','uat','Passed'],
 110:   ['uat','uatGate'],
 111:   ['uatGate','developBot','Rework'],
 112:   ['uatGate','deploy','Accepted'],
 113:   ['deploy','end'],
 114: ].map(f => ({ from:f[0], to:f[1], label:f[2]||null, id:`${f[0]}__${f[1]}` }));
 115: 
 116: const NODE_BY_ID = Object.fromEntries(NODES.map(n=>[n.id,n]));
```

### `racer/webui-v2-astra/index.htm:697-807`

```text
 697:   function normalize() {
 698:     P = window.PROCESS;
 699:     if (!P || !P.before) throw new Error("process.js must define window.PROCESS.before.");
 700:     BRAND = P.branding || {};
 701:     const layout = P.layout || {};
 702:     if (P.after != null && !Array.isArray(P.after.nodes)) {
 703:       throw new Error("after.nodes must be an array, or omit after for a before-only process.");
 704:     }
 705:     HAS_AFTER = !!(P.after && P.after.nodes.length);
 706:     KEYS = HAS_AFTER ? ["before","after"] : ["before"];
 707:     MODELS = {};
 708:     DURATION = positive(layout.DURATION) ? Math.max(1000,layout.DURATION) : 22000;
 709:     const laneTop = Number.isFinite(layout.LANE_TOP) ? Math.max(4,layout.LANE_TOP) : 8;
 710:     const laneHeight = Math.max(84,Number(layout.LH) || 84);
 711: 
 712:     KEYS.forEach(which => {
 713:       const raw = P[which];
 714:       if (!Array.isArray(raw.nodes) || !raw.nodes.length || !Array.isArray(raw.edges)) {
 715:         throw new Error(which + " requires a nonempty nodes array and an edges array.");
 716:       }
 717:       const explicit = Array.isArray(raw.lanes);
 718:       const catalog = explicit ? raw.lanes : P.lanes;
 719:       if (!Array.isArray(catalog) || !catalog.length) {
 720:         throw new Error("Provide " + which + ".lanes or the legacy PROCESS.lanes array.");
 721:       }
 722:       const ids = new Set();
 723:       catalog.forEach(l => {
 724:         if (!l || l.id == null || ids.has(l.id)) {
 725:           throw new Error(which + " has a missing or duplicate lane ID.");
 726:         }
 727:         ids.add(l.id);
 728:       });
 729:       const used = new Set(raw.nodes.map(n => n.lane));
 730:       const lanes = catalog.filter(l => explicit || used.has(l.id))
 731:         .map(l => ({...l,type:laneType(l.type)}));
 732:       raw.nodes.forEach((n,i) => {
 733:         if (!ids.has(n.lane)) throw new Error(which + " node " + i + " has an unknown lane.");
 734:         if (!["task","gw","start","end"].includes(n.type)) {
 735:           throw new Error(which + " node " + i + " has an unsupported type.");
 736:         }
 737:         if (![n.x,n.s,n.e].every(Number.isFinite) || n.s < 0 || n.e < n.s) {
 738:           throw new Error(which + " node " + i + " has invalid geometry or timing.");
 739:         }
 740:         const bs = Number.isFinite(n.bs) ? n.bs : n.s;
 741:         const be = Number.isFinite(n.be) ? n.be : n.e;
 742:         if (bs < 0 || be < bs) throw new Error(which + " has invalid baseline timing.");
 743:       });
 744:       raw.edges.forEach(edge => {
 745:         if (!Array.isArray(edge) || !Number.isInteger(edge[0]) ||
 746:             !Number.isInteger(edge[1]) || !raw.nodes[edge[0]] || !raw.nodes[edge[1]]) {
 747:           throw new Error("Invalid connector in " + which + ".");
 748:         }
 749:       });
 750:       const configuredBase = which === "before" ? layout.BASE_B : layout.BASE_A;
 751:       const base = positive(configuredBase) ? configuredBase :
 752:         Math.max(1,...raw.nodes.map(n => Number.isFinite(n.be) ? n.be : n.e));
 753:       MODELS[which] = {
 754:         which,lanes,base,laneTop,laneHeight,
 755:         height:laneTop + lanes.length*laneHeight + 4,
 756:         nodes:raw.nodes.map((n,i) => ({
 757:           ...n,index:i,originalX:n.x,
 758:           bs:Number.isFinite(n.bs) ? n.bs : n.s,
 759:           be:Number.isFinite(n.be) ? n.be : n.e
 760:         })),
 761:         edges:raw.edges.map(([f,t,label,opt]) => [f,t,label,{...(opt || {})}])
 762:       };
 763:     });
 764: 
 765:     /*
 766:      * Reserve subcolumns for collisions in the same lane/column.
 767:      * This separates the supplied task/end overlap and optional QA overlap.
 768:      * Both models share the expanded column map, preserving horizontal sync.
 769:      */
 770:     const columns = [...new Set(KEYS.flatMap(k => MODELS[k].nodes.map(n => n.originalX)))]
 771:       .sort((a,b) => a-b);
 772:     const capacity = new Map(columns.map(x => [x,1]));
 773:     KEYS.forEach(k => {
 774:       const counts = new Map();
 775:       MODELS[k].nodes.forEach(n => {
 776:         if (!counts.has(n.lane)) counts.set(n.lane,new Map());
 777:         const row = counts.get(n.lane), slot = row.get(n.originalX) || 0;
 778:         n.slot = slot;
 779:         row.set(n.originalX,slot+1);
 780:         capacity.set(n.originalX,Math.max(capacity.get(n.originalX),slot+1));
 781:       });
 782:     });
 783:     let totalSlots = 0;
 784:     const offsets = new Map();
 785:     columns.forEach(x => {
 786:       offsets.set(x,totalSlots);
 787:       totalSlots += capacity.get(x);
 788:     });
 789:     WORLD_W = G.firstX + Math.max(0,totalSlots-1)*G.column + G.taskW/2 + 30;
 790:     KEYS.forEach(k => {
 791:       const m = MODELS[k];
 792:       m.nodes.forEach(n => {
 793:         n.x = G.firstX + (offsets.get(n.originalX)+n.slot)*G.column;
 794:         n.y = m.laneTop + (m.lanes.findIndex(l => l.id === n.lane)+.5)*m.laneHeight;
 795:       });
 796:       m.width = WORLD_W;
 797:     });
 798: 
 799:     const suppliedCases = Array.isArray(P.cases) && P.cases.length ? P.cases : [{
 800:       id:1,title:"Process baseline",status:"SCENARIO",fund:"Supplied process definition",
 801:       b:MODELS.before.base,...(HAS_AFTER ? {a:MODELS.after.base} : {})
 802:     }];
 803:     CASES = suppliedCases.map(c => {
 804:       if (!positive(c.b) || (HAS_AFTER && !positive(c.a))) {
 805:         throw new Error("Each case needs a positive b time, and a positive a time when after exists.");
 806:       }
 807:       return {...c};
```

### `racer/webui-v2-astra/index.htm:810-833`

```text
 810:     const sourceMS = P.milestones;
 811:     if (sourceMS && Array.isArray(sourceMS.names) && sourceMS.names.length) {
 812:       const names = sourceMS.names.map(String), count = names.length;
 813:       const x = Array.isArray(sourceMS.x) ? [...sourceMS.x] :
 814:         names.map((_,i) => (i+1)/count);
 815:       const b = sourceMS.baseB;
 816:       const a = sourceMS.baseA;
 817:       if (x.length !== count || !Array.isArray(b) || b.length !== count ||
 818:           (HAS_AFTER && (!Array.isArray(a) || a.length !== count))) {
 819:         throw new Error("Milestone arrays must match names; baseA is only required for an after flow.");
 820:       }
 821:       [x,b,...(HAS_AFTER ? [a] : [])].forEach(arr => {
 822:         arr.forEach((v,i) => {
 823:           if (!Number.isFinite(v) || v < 0 || (i && v < arr[i-1])) {
 824:             throw new Error("Milestone values must be finite, nonnegative, and ordered.");
 825:           }
 826:         });
 827:       });
 828:       if (x.some(v => v > 1)) throw new Error("Milestone x positions must be between 0 and 1.");
 829:       MS = {names,x,b:[...b],a:HAS_AFTER ? [...a] : []};
 830:     } else {
 831:       MS = {names:["Process complete"],x:[1],b:[MODELS.before.base],
 832:         a:HAS_AFTER ? [MODELS.after.base] : []};
 833:     }
```

## E10: Persistence/API inventory and safe data rendering

**Runtime / supporting evidence:** `static_api_scan.json; focused_tests.json: main_untrusted_html_parsed, v2_untrusted_html_parsed, v2_untrusted_html_literal_visible`

### `webui/js/visualizer.js:719-743`

```text
 719: function renderSubList(){
 720:   const list = document.getElementById('sub-list');
 721:   list.innerHTML = '';
 722:   SUBMISSIONS.forEach((sub, i) => {
 723:     const card = document.createElement('div');
 724:     card.className = 'sub-card' + (i===STATE.selected ? ' selected' : '');
 725:     const total = maxT(sub);
 726:     const pct = Math.min(100, Math.round((Math.min(sub.pauseAt, total) / total) * 100));
 727:     const barColor = sub.status==='disputed'?'#f87171':sub.status==='completed'?'#4ade80':sub.status==='stuck'?'#fbbf24':'#7dd3fc';
 728:     card.innerHTML = `
 729:       <div class="row">
 730:         <div class="name">${sub.name}</div>
 731:         <span class="chip ${sub.status}">${sub.status.replace('-',' ')}</span>
 732:       </div>
 733:       <div class="meta">${sub.engagement} Â· ${sub.fees} Â· ${sub.partner}</div>
 734:       <div class="micro-bar"><div style="width:${pct}%; background: ${barColor};"></div></div>
 735:     `;
 736:     card.addEventListener('click', () => selectSubmission(i));
 737:     list.appendChild(card);
 738:   });
 739:   const sel = document.getElementById('sub-select');
 740:   sel.innerHTML = SUBMISSIONS.map((s,i)=>`<option value="${i}" ${i===STATE.selected?'selected':''}>${s.name}</option>`).join('');
 741:   document.getElementById('sample-list-count').textContent =
 742:     `${SUBMISSIONS.length} ${BRANDING.copy.sampleListUnit}`;
 743: }
```

### `webui/js/visualizer.js:765-808`

```text
 765: function renderDetail(){
 766:   const panel = document.getElementById('detail-panel');
 767:   const src = document.getElementById('detail-source');
 768:   const sub = currentSub();
 769:   if (!STATE.selectedNode) {
 770:     src.textContent = sub.name;
 771:     panel.innerHTML = `
 772:       <h3>${sub.name}</h3>
 773:       <div style="color:#6e7895; font-size:11.5px; margin-bottom:10px;">${sub.summary}</div>
 774:       <div class="kv-grid">
 775:         <div class="k">Client</div><div class="v">${sub.client}</div>
 776:         <div class="k">Engagement</div><div class="v">${sub.engagement}</div>
 777:         <div class="k">Fees</div><div class="v">${sub.fees}</div>
 778:         <div class="k">Partner</div><div class="v">${sub.partner}</div>
 779:         <div class="k">Office</div><div class="v">${sub.office}</div>
 780:         <div class="k">Cycle time</div><div class="v">${fmtMin(STATE.simT)}</div>
 781:         <div class="k">Total est.</div><div class="v">${fmtMin(maxT(sub))}</div>
 782:       </div>
 783:     `;
 784:     return;
 785:   }
 786:   const n = NODE_BY_ID[STATE.selectedNode];
 787:   if (!n) return;
 788:   const st = nodeStateAt(n.id, STATE.simT, sub);
 789:   const lane = LANES.find(l=>l.id===n.lane);
 790:   src.textContent = (n.label||n.id).replace('\n',' ');
 791:   let stateChip = '<span class="chip">PENDING</span>';
 792:   if (st.state==='active') stateChip = `<span class="chip in-progress">ACTIVE Â· ${fmtMin(st.elapsed)}</span>`;
 793:   else if (st.state==='warn') stateChip = `<span class="chip stuck">NEAR SLA Â· ${fmtMin(st.elapsed)}</span>`;
 794:   else if (st.state==='breach') stateChip = `<span class="chip disputed">SLA BREACH Â· ${fmtMin(st.elapsed)}</span>`;
 795:   else if (st.state==='complete') stateChip = `<span class="chip completed">COMPLETE Â· ${fmtMin(st.entry?st.entry.dur:0)}</span>`;
 796:   const slaRow = n.sla ? `
 797:     <div class="kv-grid">
 798:       <div class="k">Avg duration</div><div class="v">${fmtMin(n.avg)}</div>
 799:       <div class="k">SLA target</div><div class="v">${fmtMin(n.sla)}</div>
 800:       ${st.visited && st.entry ? `<div class="k">Actual</div><div class="v">${fmtMin(st.elapsed != null ? st.elapsed : st.entry.dur)}</div>` : ''}
 801:     </div>` : '';
 802:   panel.innerHTML = `
 803:     <span class="lane-pill" style="background: ${lane.accent}33; color: ${lane.accent};">${lane.name}</span>
 804:     <h3>${(n.label||n.id).replace('\n',' ')}</h3>
 805:     <div style="margin-bottom:8px;">${stateChip}</div>
 806:     <div style="color:#6e7895; font-size:11.5px; margin-bottom:10px;">${n.desc||'BPMN '+n.type}</div>
 807:     ${slaRow}
 808:   `;
```

### `racer/webui-v2-astra/index.htm:645-660`

```text
 645:   const esc = v => String(v ?? "").replace(/[&<>"']/g,c => ({
 646:     "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
 647:   }[c]));
 648:   const text = (s,v) => {
 649:     const el = $(s), value = String(v ?? "");
 650:     if (el && el.textContent !== value) el.textContent = value;
 651:   };
 652:   const svgEl = (tag,attrs={}) => {
 653:     const e = document.createElementNS(NS,tag);
 654:     Object.entries(attrs).forEach(([k,v]) => e.setAttribute(k,v));
 655:     return e;
 656:   };
 657:   const decode = v => {
 658:     const e = document.createElement("textarea");
 659:     e.innerHTML = String(v ?? "");
 660:     return e.value;
```

### `racer/webui-v2-astra/index.htm:1360-1370`

```text
1360:   function valueHTML(value,depth=0) {
1361:     if(value===undefined||value===null||value===""||
1362:       (Array.isArray(value)&&!value.length)) return missing();
1363:     if(depth>8) return "<p>"+esc(String(value))+"</p>";
1364:     if(Array.isArray(value)) return "<ul>"+value.map(v=>"<li>"+valueHTML(v,depth+1)+"</li>").join("")+"</ul>";
1365:     if(typeof value==="object") {
1366:       return Object.entries(value).map(([k,v])=>
1367:         '<div class="field"><span class="field-label">'+esc(niceName(k))+"</span>"+
1368:         valueHTML(v,depth+1)+"</div>").join("");
1369:     }
1370:     return "<p>"+esc(value)+"</p>";
```

### `racer/webui-v2-astra/index.htm:1977-1982`

```text
1977:     $("#themeSel").value=document.documentElement.dataset.theme||"professional";
1978:     $("#themeSel").onchange=e=>{
1979:       const t=e.target.value;if(!THEMES.includes(t))return;
1980:       document.documentElement.dataset.theme=t;
1981:       try{localStorage.setItem("process-explorer-theme",t);}catch(_){}
1982:     };
```

## E11: Read-only business detail and provenance fields

**Runtime / supporting evidence:** `browser_results.json: astra_v2.node_detail`

### `racer/webui-v2-astra/index.htm:1414-1477`

```text
1414:     const known=new Set(["desc","who","sla","volume","systems","inputs","outputs",
1415:       "activities","pain","kpis","risks","handoff","note","authority","controls",
1416:       "exceptions","escalation","cost","effort","roi","owner","evidence","assumptions",
1417:       "confidence","dataQuality","dependencies","decisionRules","audit"]);
1418:     const extra=Object.entries(d).filter(([k])=>!known.has(k));
1419:     const knownNode=new Set(["lane","x","y","type","label","sub","s","e","bs","be","bott",
1420:       "agent","exc","opt","role","detail","index","originalX","slot"]);
1421:     const extraNode=Object.entries(n).filter(([k])=>!knownNode.has(k));
1422:     const sections=[
1423:       detailSection("Ownership & accountability",[
1424:         ["Responsible executor",d.who??n.role],["Accountable owner",d.owner],
1425:         ["Swimlane",lane.name],["Lane responsibility",lane.role],
1426:         ["Decision / approval authority",d.authority]
1427:       ]),
1428:       detailSection("Timing & operating expectations",[
1429:         ["Service-level expectation",d.sla],["Volume / frequency",d.volume],
1430:         ["Human effort",d.effort],["Timing basis","Supplied scenario offsets, scaled to the selected submission."],
1431:         ["Baseline duration",fmt(n.be-n.bs,true)]
1432:       ]),
1433:       detailSection("Work performed",[
1434:         ["Activities",d.activities],["Systems / tools",d.systems],
1435:         ["Inputs",d.inputs],["Outputs",d.outputs]
1436:       ]),
1437:       detailSection("Controls, risks & exceptions",[
1438:         ["Controls / safeguards",d.controls],["Risks",d.risks],
1439:         ["Exceptions",d.exceptions],["Escalation path",d.escalation],
1440:         ["Decision rules",d.decisionRules],["Audit requirements",d.audit]
1441:       ]),
1442:       detailSection("Business impact & improvement",[
1443:         ["Pain points / bottlenecks",d.pain],["KPIs / success measures",d.kpis],
1444:         ["Step cost",d.cost],["Step-level ROI / benefit",d.roi],
1445:         ["Data quality",d.dataQuality]
1446:       ]),
1447:       detailSection("Handoffs & process context",[
1448:         ["Handoff description",d.handoff],
1449:         ["Incoming steps",incoming.length?incoming:"None — no incoming connector"],
1450:         ["Outgoing steps",outgoing.length?outgoing:"None — no outgoing connector"],
1451:         ["Dependencies",d.dependencies]
1452:       ]),
1453:       detailSection("Evidence & assumptions",[
1454:         ["Source / modeling notes",d.note],["Evidence references",d.evidence],
1455:         ["Assumptions",d.assumptions],["Confidence / validation status",d.confidence]
1456:       ])
1457:     ];
1458:     if(extra.length) sections.push(detailSection("Additional supplied details",extra.map(([k,v])=>[niceName(k),v])));
1459:     if(extraNode.length) sections.push(detailSection("Additional step metadata",extraNode.map(([k,v])=>[niceName(k),v])));
1460:     const facts=[
1461:       ["Timeline status",stateName],["Duration",fmt(n.e-n.s,true)],
1462:       ["Starts at",fmt(n.s,true)],["Ends at",fmt(n.e,true)]
1463:     ];
1464:     openDetail(
1465:       '<header class="detail-head"><button class="dclose" id="dclose" aria-label="Close">✕</button>'+
1466:       '<div class="dkick">'+esc(type)+" · "+esc(processLabel)+" · Submission "+esc(currentCase.id)+"</div>"+
1467:       '<h2 class="dname" id="detailTitle">'+esc(n.label)+"</h2>"+
1468:       '<div class="dsub">'+esc(n.sub||"")+'</div><div class="flags">'+flags.join("")+"</div></header>"+
1469:       '<div class="detail-body"><div class="detail-summary">'+valueHTML(d.desc)+"</div>"+
1470:       '<div class="detail-facts">'+facts.map(([k,v])=>
1471:         '<div class="fact"><div class="k">'+esc(k)+'</div><div class="v">'+esc(v)+"</div></div>").join("")+"</div>"+
1472:       '<div class="detail-grid">'+sections.join("")+"</div>"+
1473:       '<p class="detail-note">Snapshot at '+esc(fmt(elapsed,true))+
1474:       ' on the selected process clock. The animation may continue behind this window. '+
1475:       'Supplied descriptions and SLA statements are shown as provided; they may use different assumptions '+
1476:       'from the animation offsets. Missing fields are placeholders, not inferred facts. '+
1477:       'The timeline illustrates supplied timings; it does not execute gateway decisions or individual routes.</p></div>'
```

## E12: Demo labeling, encoding, and external fonts

**Runtime / supporting evidence:** `browser_results.json: explorer.external_requests_blocked and viewport screenshots`

### `webui/js/branding.js:5-17`

```text
   5: const BRANDING = {
   6:   app: {
   7:     name: 'BPMN Explorer',
   8:     subtitle: 'Intelligent Automation Â· AI-Assisted RPA Delivery Â· Live',
   9:     headerStatus: 'Telemetry connected Â· Automation CoE Â· FY26 Q2',
  10:     brandMarkGradient: 'conic-gradient(from 220deg, #56c2a3, #a78bfa, #4dd0c1, #56c2a3)',
  11:     brandMarkGlow: '0 0 18px rgba(86, 194, 163, .35)',
  12:   },
  13: 
  14:   footer: {
  15:     org: 'Â© 2026 PracticeOps Beta Â· RPA Delivery Data Model',
  16:     linkText: 'linkedin.com/in/dougross',
  17:     linkHref: 'https://linkedin.com/in/dougross',
```

### `webui/index.htm:4-9`

```text
   4: <meta charset="UTF-8" />
   5: <title>BPMN Explorer</title>
   6: <link rel="preconnect" href="https://fonts.googleapis.com">
   7: <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
   8: <link href="https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;500;600;700&display=swap" rel="stylesheet">
   9: <link rel="stylesheet" href="css/styles.css">
```

### `webui/index.htm:134-146`

```text
 134:     <div class="panel-h"><span id="sample-list-title">Active items</span> · <span id="sample-list-count">0 in flight</span> <span id="portfolio-clock" style="color:var(--ink-1); font-variant-numeric: tabular-nums; text-transform:none; letter-spacing:0;">—</span></div>
 135:     <div id="sub-list"></div>
 136: 
 137:     <div class="panel-h">Selected · <span id="detail-source" style="color:var(--ink-1); text-transform:none; letter-spacing:0;">click any node</span></div>
 138:     <div class="detail-panel" id="detail-panel">
 139:       <div style="color:var(--ink-2); font-size:11.5px;">Click any task, gateway, or event in the canvas to inspect its definition, current execution state, and SLA performance. Click empty canvas space (or press Space) to pause / resume.</div>
 140:     </div>
 141: 
 142:     <div class="panel-h">Live telemetry</div>
 143:     <div class="event-log" id="event-log"></div>
 144:     <div class="scroll-hint">Most recent events for the selected item. Press <kbd>Space</kbd> or click empty canvas to pause stream.</div>
 145:   </aside>
 146: 
```

## E13: Generator contracts and safeguards

**Runtime / supporting evidence:** `Source excerpts; no runtime execution of generator prompts`

### `tools/aixray_creator_prompt.txt:1-9`

```text
   1: # Task: Generate BPMN Explorer Config Files from a Process Diagram
   2: 
   3: You will be given a **business process diagram** (BPMN, flowchart, swimlane diagram, or similar). Your job is to produce **three JavaScript files** — `branding.js`, `process.js`, and `samples.js` — that conform exactly to the contracts below. These files plug into an existing visualizer engine; you must not invent new fields or change the schemas.
   4: 
   5: ---
   6: 
   7: ## Step 1: Analyze the PDF
   8: 
   9: Before writing any code, extract and list the following from the diagram. Show your work in a short analysis block at the top of your response.
```

### `tools/aixray_creator_prompt.txt:24-58`

```text
  24: If the diagram has no explicit lanes, **infer 4–8 lanes** by grouping tasks by likely actor/system (e.g., "Customer", "Intake System", "Underwriter", "Risk Committee", "Core Banking"). Document your inference.
  25: 
  26: ### 1c. Nodes
  27: List every shape in the diagram. For each, capture:
  28: - **ID** (camelCase, max ~16 chars, unique)
  29: - **Type**, one of:
  30:   - `start` — circle, thin border, entry point
  31:   - `end` — circle, thick border, normal exit
  32:   - `endTerminate` — circle with filled inner circle (process killed)
  33:   - `eventMessage` — circle with envelope (wait state, external trigger)
  34:   - `gatewayX` — diamond with X (exclusive — pick one branch)
  35:   - `gatewayP` — diamond with + (parallel — all branches)
  36:   - `taskUser` — rectangle, human task
  37:   - `taskService` — rectangle, automated/system task
  38:   - `taskScript` — rectangle, business-rules/script task
  39: - **Label** (use `\n` for line breaks; max 2 lines, ~14 chars per line)
  40: - **Lane ID** it belongs to
  41: - **Column index** (0 = leftmost; increment left-to-right following flow order)
  42: - **Description** (1–3 sentences explaining what happens; infer plausibly if not stated)
  43: - For tasks only:
  44:   - **`avg`** (typical duration in minutes) — infer from task nature
  45:   - **`sla`** (target deadline in minutes) — typically 1.5×–4× the avg
  46: 
  47: ### 1d. Flows (sequence flows / arrows)
  48: List every arrow as a `[from, to, optionalLabel]` triple. Labels are only required on flows exiting an exclusive gateway (e.g., "Yes", "No", "Approved", "Rejected").
  49: 
  50: ### 1e. Sample scenarios
  51: The visualizer needs **3–5 in-flight examples** that exercise different paths through the gateways. Invent realistic-but-plausible scenarios that cover:
  52: 1. A clean happy-path completion (`status: 'completed'`)
  53: 2. An in-progress mid-flow item (`status: 'in-progress'`)
  54: 3. A newly-started item (`status: 'new'`)
  55: 4. A stuck/escalated item past SLA (`status: 'stuck'`)
  56: 5. (If a dispute/rework branch exists) a disputed item (`status: 'disputed'`)
  57: 
  58: For each sample, pick a different gateway-branch combination.
```

### `tools/aixray_creator_prompt.txt:276-321`

```text
 276: ### Hard rules for `samples.js`
 277: 
 278: 1. **Allowed `status` values:** `'in-progress' | 'new' | 'stuck' | 'completed' | 'disputed'`
 279: 2. **Every `path` must end at an `end` or `endTerminate` node** — even for in-progress items. The path describes the *projected full route*; `pauseAt` controls where playback is currently frozen.
 280: 3. **Gateways must appear in the path with `dur:0`** at the moment the decision was made.
 281: 4. **Through an exclusive gateway, only include the branch actually taken** (do not include both branches).
 282: 5. **`pauseAt` placement by status:**
 283:    - `'new'` → very early (within first 1–2 tasks, e.g., 5–60 minutes in)
 284:    - `'in-progress'` → mid-flow (30%–60% of total path duration)
 285:    - `'stuck'` → at or past the SLA boundary of a specific task
 286:    - `'disputed'` → inside the dispute/rework branch
 287:    - `'completed'` → set to `999999` (past total) so the whole path renders done
 288: 6. **Realistic durations:** Use `avg` and `sla` from `process.js` as your baseline. For stuck items, exceed `sla`. For clean items, run near `avg`. Add ±20% variance.
 289: 7. **Sample variety:** Across all 3–5 samples, ensure every gateway branch in the diagram is exercised by at least one sample.
 290: 
 291: ---
 292: 
 293: ## Step 5: Final checklist before returning
 294: 
 295: Run through these mentally and fix anything that fails:
 296: 
 297: - [ ] Every `NODES[i].lane` exists in `LANES`
 298: - [ ] Every `FLOWS[i].from` and `.to` exists in `NODES`
 299: - [ ] Exactly one `start` node, at least one `end`/`endTerminate` node
 300: - [ ] Every flow out of a `gatewayX` has a label; flows out of `gatewayP` have no label
 301: - [ ] Every task has both `avg` and `sla`, with `avg < sla`
 302: - [ ] Every sample's `path` references only node IDs that exist in `NODES`
 303: - [ ] Every sample's `path` follows valid sequence flows (you can trace it on the diagram)
 304: - [ ] Across all samples, every gateway branch is taken by at least one
 305: - [ ] Lane count is 4–10; node count is 10–25; column count is ≤ 18
 306: - [ ] No `\n` in any label produces more than 2 lines
 307: - [ ] All three files use `const` declarations at top level (no `export`, no modules — these are plain `<script>` includes)
 308: 
 309: ---
 310: 
 311: ## Output format
 312: 
 313: Return your response in this exact order:
 314: 
 315: 1. **`## Analysis`** — a short markdown block with the extracted process identity, lanes, nodes, flows, and sample plan from Step 1. Bullet lists are fine.
 316: 2. **`## branding.js`** — a single fenced ```js block
 317: 3. **`## process.js`** — a single fenced ```js block
 318: 4. **`## samples.js`** — a single fenced ```js block
 319: 5. **`## Validation notes`** — brief notes on any assumptions you had to make where the PDF was ambiguous, and confirmation that the final-checklist items all pass.
 320: 
 321: Do not output any other prose, preamble, or postscript. The three code blocks should be droppable into `js/` and run immediately.
```

### `racer/tools/master-prompt-racer.txt:105-120`

```text
 105: ## PART 3 · HOW TO PARSE THE BPMN (before process)
 106: 
 107: 1. **Identify pools and lanes.** Each `<bpmn:lane>` (or unlaned participant) → one `lanes[]` entry, preserving top-to-bottom BPMN order.
 108: 2. **Classify lane `type`:** `ext` (customer/broker/vendor/patient), `human` (internal role), `agent` (any pre-existing bot/AI/RPA).
 109: 3. **Extract flow nodes:** every startEvent, task (all subtypes), gateway, endEvent → one `N(...)` call. Task subtypes go into `sub` if useful. Intermediate events collapse into gateways when they're decision points, otherwise omit.
 110: 4. **Extract sequence flows** → `edges`. Preserve `<bpmn:sequenceFlow name>`. Use `dashed:true` for exception/compensation; `early:true` for skip/happy-path branches.
 111: 5. **Identify bottlenecks (`bott: true`)** — mark tasks where name contains "manual", "rekey", "reconcile", "chase", "order", "wait", OR documented duration in top 25%, OR queue points feeding backward-looping gateways.
 112: 6. **Infer durations** if BPMN lacks them (minutes):
 113:    - automated/system/rule: 1–5
 114:    - human data entry: 15–45
 115:    - verification/reconciliation: 30–120
 116:    - external wait (order, courier, 3rd-party): 120–480
 117:    - review/assessment: 45–120
 118:    - approval/sign-off: 15–60
 119:    - exception handling: 30–90
 120:    Set `s`,`e` sequentially along the critical path; parallel branches may share ranges.
```

### `racer/tools/master-prompt-racer.txt:138-167`

```text
 138: ## PART 5 · DESIGNING THE "AFTER" (agentic to-be)
 139: 
 140: Apply these prescriptive transformations:
 141: 
 142: 1. **Add one `agent` lane** at bottom: `{ id: "ai", name: "Agentic AI", role: "Autonomous", type: "agent" }`.
 143: 2. **Collapse before-tasks into 3–5 named agent-tasks** in the AI lane, each `agent: true`, `role: "AI"`. Domain patterns:
 144:    - Insurance submission: Intake / Risk / Pricing / Bind Agent
 145:    - Claims: FNOL / Coverage / Liability / Settlement Agent
 146:    - Lending: Application / Verification / Credit / Decision / Closing Agent
 147:    - Support: Triage / Resolution / Fulfillment Agent
 148:    - KYC/onboarding: Identity / Screening / Enrichment / Provisioning Agent
 149:    - Procurement: Intake / Sourcing / Contract / PO Agent
 150: 3. **Preserve human oversight** as a single HITL exception task (`exc: true, role: "HITL"`), reached via a gateway labeled "clean & in appetite?" or domain analog. Clean path bypasses; exception path visits.
 151: 4. **Retain manager/approver lane** but as **sampled QA audit** (`opt: true`, dashed edge, "5% sample + high-value cases").
 152: 5. **Cycle time compression** — typical:
 153:    - data entry / clearance: 30–90m → 2–5m
 154:    - 3rd-party data (parallel): 120–480m → 3–10m
 155:    - assessment / rating: 45–120m → 3–8m
 156:    - approval: 30–60m → 1–3m or eliminated
 157:    - overall: 90–98% reduction for data-heavy processes; 70–85% for physical/field.
 158: 6. **Reassign x-coordinates** on the after canvas independently.
 159: 7. **Milestones** must be the same 5 business milestones for both processes so the race is comparable.
 160: 
 161: ---
 162: 
 163: ## PART 6 · CASES
 164: 
 165: Exactly **5 cases** with mix: 2× COMPLETED (`t-done`), 1× IN PROGRESS (`t-prog`), 1× STUCK (`t-stuck`), 1× NEW (`t-new`).
 166: 
 167: For each: plausible ID prefix (SUB-/CLM-/LN-/ONB-/TKT-/PO-/CASE-); `b` ±30% around `baseB`; STUCK case 2–3× `baseB`; `a` modest variance around `baseA`; `exec.cut` = round((b-a)/b × 100)%; `exec.save` $150K–$300K per high-volume process (or higher); `exec.fte` typically 1.2–2.5.
```

### `racer/tools/master-prompt-astra-1.txt:20-57`

```text
  20: Faithfulness to the supplied source.
  21: Clear separation of documented facts, estimates, and proposals.
  22: Preservation of meaningful controls and dependencies.
  23: Internally consistent timelines and financial assumptions.
  24: Compatibility with the viewer.
  25: Clear, presentation-ready business language.
  26: 1. Establish the requested scope
  27: Review all attachments and earlier answers before asking questions. Do not repeat questions already answered.
  28: 
  29: Establish:
  30: 
  31: Source: Which BPMN, process document, or other attachment is authoritative?
  32: Mode: Does the user want:
  33: Before-only; or
  34: Before and proposed after?
  35: Future-state basis: If an after model is requested, should it follow a supplied target design or may you propose an AI-enabled operating model?
  36: Evidence: Are timings, volumes, effort, costs, and performance measures documented? If not, may you use explicitly labeled illustrative assumptions?
  37: Ask one compact set of questions only when missing information would materially change the output.
  38: 
  39: If the source is unavailable or unreadable, say so. Do not claim to have analyzed an attachment you cannot access.
  40: 
  41: Do not invent a source-grounded current state from a process title alone.
  42: 
  43: If the user permits assumptions, proceed without unnecessary clarification and record the assumptions.
  44: 
  45: 2. Understand the viewer’s limitations
  46: The existing index.htm is a timing visualization, not a BPMN execution engine.
  47: 
  48: Important implications:
  49: 
  50: Connectors illustrate process relationships; the viewer does not execute gateway logic.
  51: Different submissions scale the same process timeline.
  52: Selecting a case does not switch to a different set of nodes or connectors.
  53: Rework arrows do not execute repeated passes.
  54: The viewer does not probabilistically choose exception paths.
  55: Any meaningful approval hidden inside a combined task is descriptive, not an independently enforced software gate.
  56: Both visible processes share a camera and timeline, but may have different lane lists and lane counts.
  57: Do not describe the visualization as implementing controls, executing a process, or validating a proposed operating model.
```

### `racer/tools/master-prompt-astra-1.txt:74-110`

```text
  74: Create a source-to-visual mapping.
  75: 
  76: For each visual node, record the source element IDs it represents when those IDs are available.
  77: 
  78: You may aggregate source tasks to improve readability, but:
  79: 
  80: Preserve their sequence and business meaning.
  81: Explain the aggregation.
  82: Do not silently remove material controls.
  83: Do not call an aggregated diagram a complete one-to-one BPMN rendering.
  84: Do not describe unobserved manual work or delays as documented facts.
  85: If the source contradicts itself, identify the conflict rather than silently resolving it.
  86: 
  87: 4. Choose and disclose a representative route
  88: For complex processes, define a representative completion route.
  89: 
  90: State explicitly:
  91: 
  92: Which gateway outcomes are selected.
  93: Which external dependencies apply.
  94: Which referrals or approvals are triggered.
  95: Whether physical activities are required.
  96: The number of negotiation or rework passes.
  97: The completion outcome.
  98: Which branches are omitted from the animated route.
  99: For a before/after comparison, hold the underlying business case constant unless a change is an explicit part of the proposal.
 100: 
 101: Examples:
 102: 
 103: If a physical survey is required for the representative before case, do not silently remove it from the after case.
 104: If external reinsurance or supplier confirmation is required, retain that dependency.
 105: If a material authority referral applies, preserve its approval requirement.
 106: If proposed preparation eliminates a rework pass, label that as a modeled assumption, not a guaranteed outcome.
 107: Rework may be shown with a dashed back-edge, with its modeled elapsed time and effort embedded in the appropriate activity. Explain that the viewer does not execute the loop.
 108: 
 109: Scenario compatibility
 110: Because cases scale the same diagram, default to cases that share the representative route and differ in complexity, timing, and effort.
```

### `racer/tools/master-prompt-astra-1.txt:270-321`

```text
 270: 8. Calculate metrics consistently
 271: Use documented metrics where available.
 272: 
 273: Otherwise, label all figures as illustrative or proposed, including completed-looking scenario statuses.
 274: 
 275: State common assumptions such as:
 276: 
 277: Annual eligible volume.
 278: Fully loaded hourly rate.
 279: Productive annual hours per FTE.
 280: Before and after human effort.
 281: Nonlabor cost.
 282: Incremental AI and service costs.
 283: Whether setup and fixed operating costs are included.
 284: Use:
 285: 
 286: text
 287: Human effort saved per case
 288: = before human hours − after human hours
 289: 
 290: Before cost per case
 291: = before human hours × hourly rate + before nonlabor cost
 292: 
 293: After cost per case
 294: = after human hours × hourly rate
 295:   + after nonlabor cost
 296:   + incremental AI/service cost
 297: 
 298: Cost saved per case
 299: = before cost per case − after cost per case
 300: 
 301: Annual capacity released, FTE-equivalent
 302: = human effort saved per case × annual eligible volume
 303:   ÷ annual productive hours per FTE
 304: 
 305: Cycle reduction %
 306: = (before cycle − after cycle) ÷ before cycle × 100
 307: 
 308: Rules:
 309: 
 310: Never calculate FTE release from elapsed cycle-time savings.
 311: Call FTE figures redeployable capacity, not guaranteed headcount reductions.
 312: Do not sum scenario-specific annualized benefits unless their volume allocations are mutually exclusive.
 313: Compute before rounding; use consistent displayed rounding.
 314: Include incremental AI costs.
 315: Distinguish per-case savings from program-level ROI.
 316: Do not call savings “ROI” without defining the investment basis.
 317: Define throughput assumptions rather than deriving throughput from lead time alone.
 318: Define what a human touch counts.
 319: Define the scope of straight-through processing.
 320: Do not claim end-to-end straight-through completion for routes with mandatory human approvals.
 321: Do not invent exception-rate or quality improvements merely to populate a table.
```

## E14: Rendering lifecycle, controls, and semantics

**Runtime / supporting evidence:** `Source inspection; no performance benchmark was claimed`

### `webui/js/visualizer.js:1076-1094`

```text
1076: function tick(now){
1077:   const dt = (now - STATE.lastTick) / 1000;
1078:   STATE.lastTick = now;
1079:   if (STATE.playing) {
1080:     STATE.simT += dt * STATE.speed * SIM_RATE;
1081:     const cap = maxT(currentSub());
1082:     if (STATE.simT >= cap) { STATE.simT = cap; setPlaying(false); }
1083:   }
1084:   updateNodeVisuals();
1085:   renderMinimap();
1086:   updateScrubber();
1087:   if (Math.floor(now/250) !== tick._last) {
1088:     tick._last = Math.floor(now/250);
1089:     rebuildLog();
1090:     if (STATE.selectedNode) renderDetail();
1091:     document.getElementById('hdr-clock').textContent = new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
1092:     document.getElementById('portfolio-clock').textContent = `T+${fmtMin(STATE.simT)}`;
1093:   }
1094:   requestAnimationFrame(tick);
```

### `webui/js/visualizer.js:997-1015`

```text
 997: const scrubber = document.getElementById('scrubber');
 998: scrubber.addEventListener('click', (e)=>{
 999:   const rect = scrubber.getBoundingClientRect();
1000:   const pct = (e.clientX - rect.left) / rect.width;
1001:   STATE.simT = Math.max(0, Math.min(1, pct)) * maxT(currentSub());
1002: });
1003: 
1004: function setupToggle(id, key){
1005:   const b = document.getElementById(id);
1006:   b.addEventListener('click', ()=>{
1007:     STATE[key] = !STATE[key];
1008:     b.classList.toggle('active', STATE[key]);
1009:     if (key === 'showStars') document.getElementById('starfield').style.display = STATE[key]?'block':'none';
1010:   });
1011: }
1012: setupToggle('t-heat','showHeat');
1013: setupToggle('t-metrics','showMetrics');
1014: setupToggle('t-labels','showLabels');
1015: setupToggle('t-stars','showStars');
```

### `racer/webui-v2-astra/index.htm:1595-1614`

```text
1595:   function tick(ts) {
1596:     const dt=lastTs?Math.min(100,Math.max(0,ts-lastTs)):0;
1597:     lastTs=ts;
1598:     if(app.playing) {
1599:       if(app.hold>0) {
1600:         app.hold=Math.max(0,app.hold-dt);
1601:         if(!app.hold) {
1602:           if(app.loop) app.t=0;
1603:           else {app.playing=false;syncPlay();}
1604:         }
1605:       } else {
1606:         app.t=Math.min(1,app.t+dt/DURATION*app.speed);
1607:         if(app.t>=1) {
1608:           if(app.loop) app.hold=650;
1609:           else {app.playing=false;syncPlay();}
1610:         }
1611:       }
1612:       render();
1613:     }
1614:     requestAnimationFrame(tick);
```

### `racer/webui-v2-astra/index.htm:2006-2020`

```text
2006:     $("#heat").onclick=()=>{
2007:       app.heat=!app.heat;toggleButton("heat",app.heat);
2008:       KEYS.forEach(k=>$("#trk"+(k==="before"?"Before":"After")).classList.toggle("heat",app.heat));
2009:       syncMiniStates();
2010:     };
2011:     $("#metrics").onclick=()=>{
2012:       if(app.metrics&&!navFloating)floatNavigator();
2013:       app.metrics=!app.metrics;toggleButton("metrics",app.metrics);
2014:       $("#app").classList.toggle("metrics-hidden",!app.metrics);
2015:       scheduleViewportRefresh();
2016:     };
2017:     $("#labels").onclick=()=>{
2018:       app.labels=!app.labels;toggleButton("labels",app.labels);
2019:       document.body.classList.toggle("no-labels",!app.labels);
2020:     };
```

## E15: Integrity and test-environment constraints

**Runtime / supporting evidence:** `integrity.json; file_protocol_attempt.json; http_protocol_attempt.json; browser_run.log`
