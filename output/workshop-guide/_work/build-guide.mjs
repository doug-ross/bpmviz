import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire('C:/Users/JOOTEY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/');
const {Document,Packer,Paragraph,TextRun,ImageRun,Header,Footer,PageNumber,HeadingLevel,AlignmentType,LevelFormat,ExternalHyperlink}=require('docx');
const root=process.cwd(),work=path.join(root,'output/workshop-guide/_work');
const raw=await fs.readFile(path.join(root,'docs/workshops.md'),'utf8');
const screenshots=await fs.readFile(path.join(work,'screenshots.json'),'utf8').then(JSON.parse);
const blocks=new Map();let section='intro';blocks.set(section,[]);
for(const block of raw.trim().split(/\r?\n\s*\r?\n/)) {
  if(/^# /.test(block))continue;
  if(/^#{2,3} /.test(block)){section=block.replace(/^#+ /,'');blocks.set(section,[]);}
  else blocks.get(section).push(block.replace(/\r?\n/g,' '));
}
const S=n=>[...blocks.entries()].find(([k])=>k.startsWith(n+'. '))[1];
const a=S(1),w=S(2),s=S(3),f=S(4),d=S(5),c=S(6),p=S(7),external=blocks.get('External assistant packets');
const intro=blocks.get('intro');
const pages=[
  {title:'AIxRay process workshop guide',key:'01-start',titlePage:true,paras:[intro[0],intro[1],a[0]],after:['Open webui/index.htm in a current browser. Choose Build a process, enter the name and first lane, then select Create process. The application intake example throughout this guide is synthetic; its figures are illustrative.']},
  {title:'1 Add lanes and steps',key:'02-add-step',paras:[a[1]],after:['For the example, add Review application in Case team. Select the existing Start to End flow under Insert into flow, then choose Add step. Add Customer and Approver lanes for the exception and approval work.']},
  {title:'1 Connect decisions and loops',key:'03-connect',paras:['Add Documents complete as an Exclusive gateway after the review. Connect a Complete default route to Approve application and then End. Add a Missing documents conditional route to Provide missing documents, followed by a loop back to Review application.',a[2]],after:['Use Connect steps to create flows. Reconnect or delete flows changes an existing flow. Check Structure checks after each route change and use Undo last change if the result is wrong.']},
  {title:'1 Check the current process',key:'04-current-process',paras:['Read the finished map with the people who do the work. Confirm the normal route, each handoff, and the exception route. In this example the customer resubmits missing documents and the case team reviews the application again.'],after:['Choose Readable size to discuss labels and Overview to orient the room. Search for a step, role or system when a participant needs to find a particular activity. Capture uncertainty as a question rather than treating a connected diagram as confirmation.']},
  {title:'2 Walk normal and exception routes',key:'05-walkthrough',paras:[w[0]],after:['At Documents complete, select Missing documents and choose Next. Follow the rework loop back to Review application, then revisit the gateway and take the Complete route. Previous and Route history let you return to an earlier point.']},
  {title:'2 Capture a finding at the step',key:'06-finding',paras:['Choose Capture finding at this step while the relevant step is selected. Enter a clear title, choose the appropriate finding type and name an owner. The form keeps the model and step link. Select Add finding to save it.',w[1]],after:['In the example, Confirm which documents are required belongs to the completeness decision. Record the process owner as its owner and keep the issue open until the required-document rules are confirmed.']},
  {title:'3 Record a timed scenario',key:'07-scenarios',paras:[s[0]],after:['For the normal example, enter Start, Review application, Documents complete, Approve application and End. Enter 15 minutes of wait before review, 20 minutes of review effort and duration, and 10 minutes for approval. Enter zero effort for events and decisions when appropriate; leave unknown effort blank. These values are illustrative.']},
  {title:'3 Compare explicit assumptions',key:'08-assumptions',paras:[s[1]],after:['The example uses annual volumes of 1800, 2000 and 2400 for conservative, expected and optimistic alternatives, with an hourly rate of 60. Replace these inputs with supported project assumptions. A future run still needs its own route and human-effort inputs before the comparison can establish a difference.']},
  {title:'4 Create a future alternative',key:'09-future-alternative',paras:[f[0]],after:['Name the copy AI-assisted intake. In the future diagram add an AI assistant lane, move the completeness activity there and describe the proposal. Keep the Approver activity with a person. Record the reason for each change and the finding it addresses.']},
  {title:'4 Compare the process designs',key:'10-future-compare',paras:['In Process, select the Side by side view for the future alternative. The current process is the locked baseline; changed, added and removed steps are marked in the future model. Check each handoff and exception with the participants.'],after:['This view compares the designs. No timing for this draft yet means the future run has not been authored. Use Edit scenarios to add that run with supported assumptions before discussing a time or cost reduction. The example retains human approval and the missing-document route.']},
  {title:'5 Describe the automation work',key:'11-automation-inputs',paras:[d[0]],after:['For AI checks application completeness, choose AI assist and name Operations lead as the design owner. State the documents it receives and the proposed completeness check it produces. Keep the systems and the trigger explicit so the team can judge whether the step is feasible.']},
  {title:'5 Define approval fallback and tests',key:'12-automation-controls',paras:[d[1]],after:['The example limits the AI to required-field checks. A case handler approves every external message. Failed extraction returns to manual intake and uncertain cases go to the duty manager. The test set checks that every missing required document is flagged. Select Save automation design after reviewing the fields.']},
  {title:'6 Run the agenda and parking lot',key:'13-agenda',paras:[c[0]],after:['Keep the process versions under Agreed processes aligned with the discussion. In the example, a 45-minute agenda item covers confirming the current state and agreeing the pilot. Prepare the pilot test set is an action owned by Operations lead. Save the agenda before leaving the tab.']},
  {title:'6 Capture a workshop checkpoint',key:'14-checkpoint',paras:[c[1],c[2]],after:['The example accepts Pilot retains human approval, leaves the required-document question unresolved, and names an owner for the approval and fallback acceptance criterion. A checkpoint that matches the design can be shared only after its review and sensitivity settings are checked.']},
  {title:'7 Review and share the pilot brief',key:'15-pilot-brief',paras:[p[0]],after:['Read the agreed current and future process names, accepted decisions, unresolved questions, acceptance criteria and actions aloud. Confirm that each owner accepts the action. If a process, finding or automation design changes, review the stale checkpoint and capture a new one before sharing its details.']},
  {title:'7 Save and reopen the project',key:'16-save-reopen',paras:[p[1]],after:['Save and Save a copy keep the portable project, while Download pilot brief produces the text handoff. The project file is the durable working copy; the browser recovery draft is a convenience. Store the project in the agreed location and identify its owner.']},
  {title:'8 Prepare an assistant packet',key:'17-assistant',paras:[external[0],external[1]],after:[]},
  {title:'8 Export and return the result',key:'17b-assistant-export',paras:['Review exported packet shows exactly what will be handed to the assistant. Confirm the account plan and organizational policy, review the packet, then select Export packet. Give the downloaded packet to Codex, Claude Code or GitHub Copilot through the approved route.'],after:['Ask for a complete .ai-result.json envelope that preserves the project ID, revision, task and baseline. Back in Work with an assistant, select the file under Import completed result. This handoff is offline file exchange; it does not launch an assistant or verify its account.']},
  {title:'8 Review the returned proposal',key:'18-result-review',paras:[external[2]],after:['Apply only the proposals you accept. They remain AI drafts until reviewed, and Undo reverses the applied change. A stale draft requires an explicit check against the current project revision; a project change while the review is open blocks application.'],habits:true}
];
pages.splice(1,0,{title:'1 Name the roles and lanes',key:'01b-lanes',paras:['In Build a process, expand Lanes. Use clear role names for the teams and external parties who perform the work. Lane type distinguishes People, Automation or AI agent, and External party. Enter a New lane name, choose its type and select Add lane.'],after:['The example uses Case team and Approver as people lanes and Customer as an external party. Save lane updates, use Move up or Move down to reorder lanes, and choose a destination for its steps before deleting an occupied lane. Keep at least one lane. The AI assistant lane is added only to the future alternative.']});
function runs(text){return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g).filter(Boolean).map(t=>{
  const link=t.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if(link)return new ExternalHyperlink({link:'https://github.com/doug-ross/bpmviz/blob/main/docs/'+link[2],children:[new TextRun({text:link[1],style:'Hyperlink'})]});
  return new TextRun({text:t.replace(/^\*\*|\*\*$/g,'').replace(/^`|`$/g,''),bold:t.startsWith('**')});
});}
const para=(text,opts={})=>new Paragraph({children:runs(text),spacing:{after:110,line:285},...opts});
let children=[];
for(let i=0;i<pages.length;i++){
  const item=pages[i], image=screenshots.find(s=>s.key===item.key);if(!image)throw Error('Missing '+item.key);
  children.push(new Paragraph({text:item.title,heading:item.titlePage?HeadingLevel.TITLE:HeadingLevel.HEADING_1,pageBreakBefore:i>0,keepNext:true,spacing:{after:180}}));
  if(item.titlePage)children.push(para('Facilitator edition  |  15 October 2026',{style:'GuideMeta'}));
  for(const text of item.paras)children.push(para(text));
  const factor=Math.min(7.15*96/image.width,5.25*96/image.height);
  children.push(new Paragraph({alignment:AlignmentType.CENTER,keepNext:true,spacing:{before:100,after:70},children:[new ImageRun({data:await fs.readFile(image.file),type:'png',transformation:{width:Math.round(image.width*factor),height:Math.round(image.height*factor)},altText:{title:item.title,description:image.caption,name:item.key}})]}));
  children.push(para(image.caption,{style:'Caption',spacing:{after:150,line:240}}));
  for(const text of item.after)children.push(para(text));
  if(item.habits){
    children.push(new Paragraph({text:'Facilitator habits',heading:HeadingLevel.HEADING_2,keepNext:true}));
    const habits=raw.split('## Facilitator habits')[1].trim().split(/\r?\n/).filter(l=>l.startsWith('- '));
    for(const h of habits)children.push(para(h.slice(2),{numbering:{reference:'bullets',level:0},spacing:{after:55,line:260}}));
  }
}
const doc=new Document({creator:'AIxRay',title:'AIxRay process workshop guide',description:'Facilitator guide to building, walking and agreeing a business process and future state, with screenshots.',
  styles:{default:{document:{run:{font:'Arial',size:22,color:'000000'},paragraph:{spacing:{after:110,line:285}}}},paragraphStyles:[
    {id:'Title',name:'Title',basedOn:'Normal',next:'Normal',quickFormat:true,run:{font:'Arial',size:48,bold:true,color:'000000'},paragraph:{spacing:{after:180}}},
    {id:'Heading1',name:'heading 1',basedOn:'Normal',next:'Normal',quickFormat:true,run:{font:'Arial',size:34,bold:true,color:'000000'},paragraph:{keepNext:true,spacing:{after:160}}},
    {id:'Heading2',name:'heading 2',basedOn:'Normal',next:'Normal',quickFormat:true,run:{font:'Arial',size:25,bold:true,color:'000000'},paragraph:{keepNext:true,spacing:{before:140,after:90}}},
    {id:'Caption',name:'Caption',basedOn:'Normal',run:{font:'Arial',size:19,italics:true,color:'333333'}},
    {id:'GuideMeta',name:'Guide metadata',basedOn:'Normal',run:{font:'Arial',size:19,color:'333333'}}]},
  numbering:{config:[{reference:'bullets',levels:[{level:0,format:LevelFormat.BULLET,text:'\u2022',alignment:AlignmentType.LEFT,style:{paragraph:{indent:{left:260,hanging:160}}}}]}]},
  sections:[{properties:{page:{size:{width:12240,height:15840},margin:{top:850,bottom:850,left:900,right:900,header:360,footer:360}}},
    headers:{default:new Header({children:[new Paragraph({children:[new TextRun({text:'AIxRay  |  Process workshop',size:18,color:'000000'})],spacing:{after:50}})]})},
    footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.RIGHT,children:[new TextRun({text:'AIxRay workshop guide  |  ',size:17}),new TextRun({children:[PageNumber.CURRENT],size:17})]})]})},children}]});
const output=path.join(root,'output/workshop-guide/AIxRay_Process_Workshop_Guide.docx');await fs.writeFile(output,await Packer.toBuffer(doc));
await fs.writeFile(path.join(work,'document-plan.json'),JSON.stringify({source:'docs/workshops.md',sourceCommit:'94b59f2',pages:pages.map(p=>({title:p.title,screenshot:p.key})),screenshots:screenshots.length},null,2));
console.log(output);
