/* ============================================================
   PROCESS DEFINITION â€” AI-Assisted RPA Delivery
   ============================================================ */

const LANES = [
  { id:'business', name:'Business',          accent:'#f0a868' },
  { id:'intake',   name:'Intake / CoE',      accent:'#56c2a3' },
  { id:'ai',       name:'AI Assist',         accent:'#a78bfa' },
  { id:'ba',       name:'Business Analyst',  accent:'#7c8db5' },
  { id:'gov',      name:'Governance',        accent:'#f472b6' },
  { id:'dev',      name:'Developer',         accent:'#4dd0c1' },
];

const NODES = [
  { id:'start', type:'start', label:'Request', lane:'business', col:0,
    desc:'A business unit raises a request for a new RPA automation. This is the entry point into the Center of Excellence intake funnel.' },

  { id:'workshop', type:'taskUser', label:'Conduct\nWorkshops', lane:'intake', col:1,
    avg:110, sla:480,
    desc:'The CoE intake team runs discovery workshops with the requesting business to understand the candidate process and confirm automation feasibility.' },

  { id:'useCase', type:'taskUser', label:'Create\nUse Case', lane:'intake', col:2,
    avg:55, sla:240,
    desc:'A formal use case is captured in the automation pipeline manager (APM), logging scope, expected benefits and the process owner.' },

  { id:'reuseEngine', type:'taskService', label:'AI Reuse\nEngine', lane:'ai', col:3,
    avg:4, sla:15,
    desc:'An AI similarity-match engine scans the existing component and bot library to surface reusable assets relevant to the new use case.' },

  { id:'effortEst', type:'taskService', label:'AI Effort\nEstimation', lane:'ai', col:4,
    avg:5, sla:15,
    desc:'AI generates a build effort estimate based on process complexity and the reuse opportunities identified by the similarity match.' },

  { id:'gatherReqs', type:'taskUser', label:'Gather\nRequirements', lane:'ba', col:5,
    avg:220, sla:960,
    desc:'The business analyst elicits detailed functional requirements, capturing process steps, exceptions and data inputs for the automation.' },

  { id:'draftPdd', type:'taskService', label:'Draft PDD\n(AI)', lane:'ai', col:6,
    avg:9, sla:30,
    desc:'AI generates a first-draft Process Definition Document from the gathered requirements, accelerating documentation effort.' },

  { id:'finalPdd', type:'taskUser', label:'Finalize\nPDD', lane:'ba', col:7,
    avg:170, sla:720,
    desc:'The business analyst reviews, corrects and finalizes the AI-drafted PDD, signing it off as the build specification.' },

  { id:'fork1', type:'gatewayP', label:'Fork', lane:'intake', col:8,
    desc:'Parallel split kicking off the governance and environment preparation activities concurrently.' },

  { id:'provAccess', type:'taskService', label:'Provision\nAccess', lane:'gov', col:9,
    avg:420, sla:1440,
    desc:'Service accounts, credentials and system access required by the bot are provisioned across target applications.' },

  { id:'dataClass', type:'taskScript', label:'Data\nClassification', lane:'gov', col:9,
    avg:110, sla:480,
    desc:'The data handled by the automation is classified against information-security policy to determine handling and storage controls.' },

  { id:'preApprovals', type:'taskUser', label:'Pre-Approvals', lane:'gov', col:9,
    avg:900, sla:2880,
    desc:'Governance and security pre-approvals are obtained from the relevant control owners before the build can proceed.' },

  { id:'join1', type:'gatewayP', label:'Join', lane:'intake', col:10,
    desc:'Parallel join synchronizing access provisioning, data classification and pre-approvals before development begins.' },

  { id:'developBot', type:'taskUser', label:'Develop Bot', lane:'dev', col:11,
    avg:2300, sla:4800,
    desc:'The developer builds the automation against the finalized PDD, reusing matched components where possible.' },

  { id:'qa', type:'taskUser', label:'QA', lane:'dev', col:12,
    avg:460, sla:1440,
    desc:'Quality assurance executes test cases against the built bot to verify it meets the documented requirements.' },

  { id:'qaGate', type:'gatewayX', label:'QA\nPassed?', lane:'dev', col:13,
    desc:'Exclusive decision: if QA passes the bot proceeds to UAT, otherwise it is returned to development for defect fixes.' },

  { id:'uat', type:'taskUser', label:'UAT', lane:'business', col:14,
    avg:900, sla:2880,
    desc:'The business performs user acceptance testing to confirm the automation works correctly against real-world scenarios.' },

  { id:'uatGate', type:'gatewayX', label:'UAT\nAccepted?', lane:'business', col:15,
    desc:'Exclusive decision: if the business accepts, the bot is deployed; if not, it is sent back to development for rework.' },

  { id:'deploy', type:'taskService', label:'Deploy', lane:'dev', col:16,
    avg:110, sla:480,
    desc:'The accepted bot is promoted and deployed into the production automation environment.' },

  { id:'end', type:'end', label:'Live', lane:'dev', col:17,
    desc:'The automation is live in production and actively executing in the RPA estate.' },
];

const FLOWS = [
  ['start','workshop'],
  ['workshop','useCase'],
  ['useCase','reuseEngine'],
  ['reuseEngine','effortEst'],
  ['effortEst','gatherReqs'],
  ['gatherReqs','draftPdd'],
  ['draftPdd','finalPdd'],
  ['finalPdd','fork1'],
  ['fork1','provAccess'],
  ['fork1','dataClass'],
  ['fork1','preApprovals'],
  ['provAccess','join1'],
  ['dataClass','join1'],
  ['preApprovals','join1'],
  ['join1','developBot'],
  ['developBot','qa'],
  ['qa','qaGate'],
  ['qaGate','developBot','Defects'],
  ['qaGate','uat','Passed'],
  ['uat','uatGate'],
  ['uatGate','developBot','Rework'],
  ['uatGate','deploy','Accepted'],
  ['deploy','end'],
].map(f => ({ from:f[0], to:f[1], label:f[2]||null, id:`${f[0]}__${f[1]}` }));

const NODE_BY_ID = Object.fromEntries(NODES.map(n=>[n.id,n]));
