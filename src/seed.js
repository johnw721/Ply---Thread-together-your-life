import { subs } from './engine.js';
import { PIPELINE_STAGES } from './types.js';

import { CAL } from './cal.js';
import { DB, addEvent, blankDB, currentStep, newEvent, newGoal, newStep, newSub, newThread, save, setDB } from './store.js';
import { addDays, today, uid } from './util.js';

/* ===================== [SECTION: SEED] ===================== */
export function ago(d){ const x=new Date(); x.setDate(x.getDate()-d); return x.toISOString(); }
export function seed(){
  setDB(blankDB()); DB.meta.cursor=today(); DB.meta.lastCheckin=addDays(today(),-9);

  /* --- deadline-type with a conditional branch --- */
  const cka=newGoal({title:'Pass the CKA retake', type:'deadline',
    why:'Cert unlocks the cloud/platform roles I actually want.',
    smart:{outcome:'CKA certification passed', metricName:'domains drilled clean', metricUnit:'',
           target:5, current:2, deadline:addDays(today(),38), deadlineSoft:false}});
  const ckaT=newThread({name:'Study', rel:'sequential', lastMovement:ago(1)});
  ckaT.steps.push(newStep('Domain 2 drills: cluster architecture',{done:true,doneAt:ago(6),quadrant:'q2'}));
  ckaT.steps.push(newStep('Domain 3 drills: workloads & scheduling',{done:true,doneAt:ago(1),quadrant:'q2'}));
  // this one is anchored for tonight, so its checklist is visible on the Day view at first run
  ckaT.steps.push(newStep('Domain 4 drills: services & networking',{quadrant:'q1', subs:[
    Object.assign(newSub('Services, endpoints, kube-proxy modes'),{done:true,doneAt:ago(1)}),
    newSub('Ingress controllers + TLS termination'),
    newSub('NetworkPolicy: default-deny then allow'),
    newSub('CoreDNS and service discovery')
  ]}));
  const ckaX=newThread({name:'Exam', rel:'conditional', lastMovement:ago(4),
    branches:[{condition:'pass',next:'Book the CKS path and file the cert'},
              {condition:'fail',next:'Reset the study method — timed sim runs only'}]});
  ckaX.steps.push(newStep('Sit the retake',{quadrant:'q2'}));
  cka.threads.push(ckaT,ckaX); DB.goals.push(cka);

  /* --- habit-type, cyclical --- */
  const gtr=newGoal({title:'Practice guitar consistently', type:'habit', cadenceDays:3,
    why:'The only thing I do that has nothing to do with a career outcome.',
    smart:{outcome:'Playing without thinking about it', metricName:'sessions per week',
           target:4, current:2, deadline:null, deadlineSoft:true}});
  const gt=newThread({rel:'cyclical', lastMovement:ago(6)});
  gt.steps.push(newStep('Next session: guitar',{done:true,doneAt:ago(9),auto:true,quadrant:'q2'}));
  gt.steps.push(newStep('Next session: guitar',{done:true,doneAt:ago(6),auto:true,quadrant:'q2'}));
  gt.steps.push(newStep('Next session: guitar',{auto:true,quadrant:'q2'}));
  gtr.threads.push(gt); DB.goals.push(gtr);

  /* --- milestone-type, parallel threads + backlog --- */
  const pl=newGoal({title:'Ship Plumbline v1', type:'milestone', notes:'Project: Plumbline',
    why:'Portfolio piece that proves the cloud engineering side, not just the cert.',
    smart:{outcome:'v1 deployed and publicly reachable', metricName:'features shipped',
           target:6, current:2, deadline:addDays(today(),70)},
    backlog:['Wire CI to run the integration suite','Write the deploy runbook','Add the status page']});
  const pInfra=newThread({name:'Infra', rel:'parallel', lastMovement:ago(3)});
  pInfra.steps.push(newStep('Split the monolith chart into base + overlays',{done:true,doneAt:ago(3),quadrant:'q2'}));
  // a step broken down and half ticked, so the quarter bar shows partial credit
  pInfra.steps.push(newStep('Terraform the staging environment',{auto:true,quadrant:'q2', subs:[
    Object.assign(newSub('Pin the provider versions'),{done:true,doneAt:ago(3)}),
    Object.assign(newSub('Write the VPC + subnet module'),{done:true,doneAt:ago(2)}),
    newSub('Re-run plan against staging'),
    newSub('Get Marcus to review the diff')
  ]}));
  const pDocs=newThread({name:'Docs', rel:'parallel', lastMovement:ago(16)});
  pDocs.steps.push(newStep('Draft the architecture overview',{quadrant:'q4'}));
  const pRev=newThread({name:'Review', rel:'sequential', status:'blocked',
    blockedOn:'Marcus (infra review)', blockedSince:ago(12), lastMovement:ago(12)});
  pRev.steps.push(newStep('Incorporate review feedback on the network policy',{quadrant:'q3'}));
  pl.threads.push(pInfra,pDocs,pRev); DB.goals.push(pl);

  /* --- threshold-type (auto but flagged for review) --- */
  const car=newGoal({title:'Saving for a car — $9,000', type:'threshold',
    smart:{outcome:'$9,000 set aside', metricName:'amount saved', metricUnit:'$',
           target:9000, current:3150, deadline:null, deadlineSoft:true},
    gates:[{id:uid(),kind:'confirm-type',q:'Filed "Saving for a car" as threshold-type. Right call?'}]});
  const ct=newThread({rel:'cyclical', lastMovement:ago(19)});
  ct.steps.push(newStep('This period’s contribution toward $9,000',{auto:true,quadrant:'q2'}));
  car.threads.push(ct); DB.goals.push(car);

  /* --- maintenance-type --- */
  const cook=newGoal({title:'Cooking consistency — stop ordering out', type:'maintenance', cadenceDays:5,
    smart:{outcome:'Cooking most weeknights', metricName:'staying in range', deadline:null, deadlineSoft:true}});
  // 20d against a 5d cadence — past 3x, so this one has gone quiet and stopped nagging
  const ck=newThread({rel:'cyclical', lastMovement:ago(20)});
  ck.steps.push(newStep('Next cooking consistency',{auto:true,quadrant:'q3'}));
  cook.threads.push(ck); DB.goals.push(cook);

  /* --- pipeline-type --- */
  const job=newGoal({title:'Platform engineering applications', type:'pipeline',
    stages:PIPELINE_STAGES.slice(),
    smart:{outcome:'Offer in hand', metricName:'volume + conversion', target:20, current:7, deadline:null}});
  const jb=newThread({name:'Weekly batch', rel:'parallel', lastMovement:ago(5)});
  jb.steps.push(newStep('Send this week’s batch',{auto:true,quadrant:'q2'}));
  const jc=newThread({name:'Northwind', rel:'parallel', lastMovement:ago(9)}); jc.stage='screen';
  jc.steps.push(newStep('Advance to interview: Northwind',{auto:true,quadrant:'q1'}));
  job.threads.push(jb,jc); DB.goals.push(job);

  /* --- contingent-type: dormant, does not nag --- */
  const reno=newGoal({title:'Renovation fund if the house comes through', type:'contingent',
    trigger:'offer accepted on the house',
    smart:{outcome:'Fund started', metricName:'dormant until trigger', deadline:null}});
  reno.threads.push(newThread({rel:'sequential', status:'dormant', lastMovement:ago(30)}));
  DB.goals.push(reno);

  /* --- decision-type --- */
  const dec=newGoal({title:'Decide whether to go deep on Go or stay with Python', type:'decision',
    why:'Every platform role posting wants Go; my whole toolchain is Python.',
    gates:[]});
  const dt=newThread({rel:'sequential', lastMovement:ago(13)});
  dt.steps.push(newStep('Research / decide: whether to go deep on Go or stay with Python',{auto:true,quadrant:'q4'}));
  dec.threads.push(dt); DB.goals.push(dec);

  /* --- plain tasks --- */
  for(const [tt,q] of [['Get a spare key made','q3'],['Buy headphones','q4'],['Renew the domain','q1']]){
    const g=newGoal({title:tt,type:'task'});
    const t=newThread(); t.steps.push(newStep(tt,{quadrant:q})); g.threads.push(t); DB.goals.push(g);
  }

  /* --- calendar: real events + step anchors --- */
  const mk=(title,dayOff,h,dur,recur)=>addEvent(newEvent({title,dateKey:addDays(today(),dayOff),start:h*60,dur,recur:recur||null}));
  // one standing series instead of six copies — that's what repeats are for
  mk('Standup',-1,9,30,{every:1,until:addDays(today(),45)});
  mk('Team retro',4,16,45,{every:14,until:null});
  mk('1:1 with Marcus',0,13,30); mk('Deep work block',0,15,90);
  mk('Dentist',1,11,60);
  mk('Sprint review',2,14,60);

  const anchor=(g,ti,dayOff,h,dur)=>{ const t=g.threads[ti]; const s=currentStep(t);
    /* The seed stands in for a person who scheduled these, so 'manual' is the
       honest tag. Inert for churn regardless: each is a first anchor. */
    if(s) CAL.anchor(g,t,s,addDays(today(),dayOff),h*60,dur,'manual'); };
  anchor(cka,0,0,19,90);          // domain 4 drills tonight
  anchor(cka,1,38,10,180);        // the exam itself
  anchor(pl,0,2,20,60);           // terraform staging
  anchor(job,1,1,10,30);          // Northwind
  // guitar, cooking, docs, savings, decision deliberately left unscheduled + quiet

  /* --- log history so follow-through and streaks are real --- */
  /* Hand-written history, pushed straight past logIt(). These rows carry no
     stepId, so rescheduleHistory() never sees them — 'unknown' anyway, for the
     same reason migrate() backfills it: nothing here recorded a why. */
  const L=(kind,g,t,d,text)=>DB.log.push({id:uid(),ts:ago(d),kind,goalId:g.id,threadId:t.id,text,
    dateKey:addDays(today(),-d), source:kind==='planned'?'unknown':undefined});
  L('planned',cka,ckaT,7,'Domain 2 drills'); L('done',cka,ckaT,6,'Domain 2 drills');
  L('planned',cka,ckaT,2,'Domain 3 drills'); L('done',cka,ckaT,1,'Domain 3 drills');
  L('planned',gtr,gt,10,'session'); L('done',gtr,gt,9,'session');
  L('planned',gtr,gt,7,'session');  L('done',gtr,gt,6,'session');
  L('planned',gtr,gt,4,'session');  // planned, never done — the pattern the app is meant to expose
  L('planned',pl,pInfra,4,'chart split'); L('done',pl,pInfra,3,'chart split');
  L('planned',cook,ck,21,'cook'); L('done',cook,ck,20,'cook');
  L('planned',job,jb,6,'batch'); L('done',job,jb,5,'batch');

  /* --- weekly budget: one category wired to the car savings goal --- */
  DB.meta.budget={ weekly:1200, cats:[
    {id:uid(), name:'Rent + bills',   amount:620, goalId:null},
    {id:uid(), name:'Groceries',      amount:180, goalId:null},
    {id:uid(), name:'Car fund',       amount:150, goalId:car.id},
    {id:uid(), name:'Going out',      amount:110, goalId:null}
  ]};
  save();
}

