/* ============================================================
   SAMPLES â€” exercising different paths through AI-Assisted RPA Delivery
   ============================================================ */

function buildPath(steps){
  let t = 0; const out = [];
  function walk(arr){
    for (const s of arr) {
      if (Array.isArray(s[0])) {
        const startT = t; let maxEnd = startT;
        for (const branch of s) {
          let bt = startT;
          for (const [nid, dur] of branch) { out.push({nodeId:nid, t:bt, dur}); bt += dur; }
          if (bt > maxEnd) maxEnd = bt;
        }
        t = maxEnd;
      } else {
        const [nid, dur] = s;
        out.push({nodeId:nid, t, dur});
        t += dur;
      }
    }
  }
  walk(steps);
  return out;
}

const SUBMISSIONS = [
  {
    id:'inv001',
    name:'Invoice Capture Bot Â· deployed to production',
    client:'Accounts Payable',
    engagement:'Document-extraction automation',
    fees:'~3,200 invoices / month',
    partner:'Priya Nair',
    office:'Bengaluru',
    status:'completed',
    summary:'Clean run end-to-end. Passed QA first time and was accepted in UAT without rework, now live and processing AP invoices in production.',
    path: buildPath([
      ['start',0],
      ['workshop',110],
      ['useCase',55],
      ['reuseEngine',4],
      ['effortEst',5],
      ['gatherReqs',220],
      ['draftPdd',9],
      ['finalPdd',170],
      ['fork1',0],
      [
        [['provAccess',420]],
        [['dataClass',110]],
        [['preApprovals',900]],
      ],
      ['join1',0],
      ['developBot',2300],
      ['qa',460],
      ['qaGate',0],
      ['uat',900],
      ['uatGate',0],
      ['deploy',110],
      ['end',0],
    ]),
    pauseAt: 999999
  },

  {
    id:'apr002',
    name:'AP Reconciliation Bot Â· in development',
    client:'Finance Shared Services',
    engagement:'Ledger reconciliation automation',
    fees:'~1,800 statements / month',
    partner:'Marcus Feld',
    office:'Frankfurt',
    status:'in-progress',
    summary:'Governance fan-out cleared and the developer is mid-build against the finalized PDD. On track for the QA and UAT gates downstream.',
    path: buildPath([
      ['start',0],
      ['workshop',105],
      ['useCase',50],
      ['reuseEngine',5],
      ['effortEst',6],
      ['gatherReqs',230],
      ['draftPdd',10],
      ['finalPdd',160],
      ['fork1',0],
      [
        [['provAccess',400]],
        [['dataClass',120]],
        [['preApprovals',850]],
      ],
      ['join1',0],
      ['developBot',2400],
      ['qa',460],
      ['qaGate',0],
      ['uat',900],
      ['uatGate',0],
      ['deploy',110],
      ['end',0],
    ]),
    pauseAt: 2600
  },

  {
    id:'hro003',
    name:'HR Onboarding Automation Â· intake started',
    client:'People Operations',
    engagement:'New-hire provisioning automation',
    fees:'~450 hires / quarter',
    partner:'Sofia Alvarez',
    office:'Madrid',
    status:'new',
    summary:'Freshly raised request. Discovery workshops are underway with People Ops to confirm scope and feasibility before a use case is logged.',
    path: buildPath([
      ['start',0],
      ['workshop',120],
      ['useCase',55],
      ['reuseEngine',4],
      ['effortEst',5],
      ['gatherReqs',220],
      ['draftPdd',9],
      ['finalPdd',170],
      ['fork1',0],
      [
        [['provAccess',420]],
        [['dataClass',110]],
        [['preApprovals',900]],
      ],
      ['join1',0],
      ['developBot',2300],
      ['qa',460],
      ['qaGate',0],
      ['uat',900],
      ['uatGate',0],
      ['deploy',110],
      ['end',0],
    ]),
    pauseAt: 55
  },

  {
    id:'pay004',
    name:'Payroll Variance Bot Â· stuck in rework',
    client:'Payroll Operations',
    engagement:'Variance-detection automation',
    fees:'~12,000 records / cycle',
    partner:'Daniel Okoro',
    office:'London',
    status:'stuck',
    summary:'QA returned defects and the bot bounced back to development. The rework Develop Bot cycle has now blown past its SLA and is escalated.',
    path: buildPath([
      ['start',0],
      ['workshop',115],
      ['useCase',60],
      ['reuseEngine',5],
      ['effortEst',6],
      ['gatherReqs',240],
      ['draftPdd',10],
      ['finalPdd',180],
      ['fork1',0],
      [
        [['provAccess',430]],
        [['dataClass',115]],
        [['preApprovals',920]],
      ],
      ['join1',0],
      ['developBot',2300],
      ['qa',460],
      ['qaGate',0],
      ['developBot',5200],
      ['qa',460],
      ['qaGate',0],
      ['uat',900],
      ['uatGate',0],
      ['deploy',110],
      ['end',0],
    ]),
    pauseAt: 9100
  },

  {
    id:'stm005',
    name:'Statement Recon Bot Â· UAT rework loop',
    client:'Treasury Operations',
    engagement:'Bank-statement reconciliation',
    fees:'~6,500 lines / day',
    partner:'Hannah Liu',
    office:'Singapore',
    status:'disputed',
    summary:'Passed QA and reached UAT, but the business rejected acceptance and sent it back for rework. Developer is reworking before re-testing.',
    path: buildPath([
      ['start',0],
      ['workshop',110],
      ['useCase',55],
      ['reuseEngine',4],
      ['effortEst',5],
      ['gatherReqs',225],
      ['draftPdd',9],
      ['finalPdd',165],
      ['fork1',0],
      [
        [['provAccess',410]],
        [['dataClass',110]],
        [['preApprovals',880]],
      ],
      ['join1',0],
      ['developBot',2350],
      ['qa',455],
      ['qaGate',0],
      ['uat',900],
      ['uatGate',0],
      ['developBot',2200],
      ['qa',460],
      ['qaGate',0],
      ['uat',880],
      ['uatGate',0],
      ['deploy',110],
      ['end',0],
    ]),
    pauseAt: 6200
  },
];
