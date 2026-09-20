import { TYPE } from '../types.js';
import { QUAD } from './render.jsx';
import { CAL } from '../cal.js';
import { money, shortName, subProgress } from '../engine.js';
import { DB, currentStep, eventById, liveGoals } from '../store.js';
import { addDays, clamp, daysBetween, dkey, esc, fmtDate, parseKey, startOfWeek, today } from '../util.js';

/* ================= QUARTER ================= */
export function quarterRange(k){
  const d=parseKey(k); const qStart=new Date(d.getFullYear(), Math.floor(d.getMonth()/3)*3, 1);
  const from=startOfWeek(dkey(qStart));
  return {from, to:addDays(from, 13*7-1), weeks:13};
}
export function viewQuarter(){
  const {from,to,weeks}=quarterRange(DB.meta.cursor);
  const total=daysBetween(from,to)+1;
  const x = k => clamp(daysBetween(from,k)/total*100,0,100);

  // week density
  const loads=[]; for(let w=0;w<weeks;w++){ const ws=addDays(from,w*7); loads.push({ws,mins:CAL.loadWeek(ws)}); }
  const max=Math.max(600, ...loads.map(l=>l.mins));
  const bars=loads.map((l,i)=>{
    const h=Math.round(l.mins/max*100);
    const cls = l.mins>max*.75?'hot': l.mins>max*.5?'heavy':'';
    const cur = today()>=l.ws && today()<addDays(l.ws,7) ? 'cur':'';
    return `<div class="dbar ${cls} ${cur}" data-jump="${l.ws}" title="${Math.round(l.mins/60*10)/10}h booked">
      <div class="b" style="height:${Math.max(2,h)}%"></div><div class="wk">${parseKey(l.ws).getMonth()+1}/${parseKey(l.ws).getDate()}</div></div>`;
  }).join('');

  let ticks='',grid='';
  for(let w=0;w<weeks;w+=2){ const k=addDays(from,w*7);
    ticks+=`<span style="left:${x(k)}%">${fmtDate(k)}</span>`;
    grid+=`<div class="grid" style="left:${x(k)}%"></div>`; }

  const rows = liveGoals().filter(g=>g.type!=='task').map(g=>{
    const spec=TYPE[g.type];
    // band window
    let s=dkey(new Date(g.createdAt)); if(s<from)s=from;
    let e = g.smart.deadline || null;
    if(!e){ e = (g.type==='habit'||g.type==='maintenance'||g.type==='pipeline'||g.type==='contingent') ? to : addDays(s,56); }
    if(e>to)e=to; if(e<s)e=s;
    const left=x(s), w=Math.max(2,x(e)-left);
    const prog = g.smart.target ? clamp((g.smart.current||0)/g.smart.target*100,0,100)
               : (g.type==='milestone'? clamp((doneCount(g)+partialCount(g))/(doneCount(g)+g.backlog.length+1)*100,0,100) : 0);

    // next step across threads
    const act=g.threads.filter(t=>t.status!=='done');
    const nexts=act.map(t=>{
      const st=currentStep(t);
      if(t.status==='blocked') return `<b>waiting on ${esc(t.blockedOn||'?')}</b>`;
      if(t.status==='dormant') return `<b>dormant</b> until ${esc(g.trigger||'trigger undefined')}`;
      if(!st) return `<b style="color:var(--bad)">no next step</b>`;
      const ev=st.eventId?eventById(st.eventId):null;
      return `<b>${esc(st.title)}</b>${ev?` <span class="mono tiny">${fmtDate(ev.dateKey)}</span>`:` <span class="tiny" style="color:var(--warn)">unscheduled</span>`}`;
    });
    const dots = g.threads.flatMap(t=>t.steps.filter(st=>st.eventId).map(st=>eventById(st.eventId)))
      .filter(ev=>ev&&ev.dateKey>=from&&ev.dateKey<=to)
      .map(ev=>`<div class="stepdot" style="left:${x(ev.dateKey)}%;${ev.done?'background:var(--dim2)':''}"></div>`).join('');
    const dl = g.smart.deadline&&g.smart.deadline>=from&&g.smart.deadline<=to
      ? `<div class="today-line" style="left:${x(g.smart.deadline)}%;background:var(--warn);opacity:.55"></div>`:'';

    return `<div class="rmrow">
      <div class="rmleft" data-goal="${g.id}">
        <div class="n"><span class="dot" style="background:${QUAD[bestQuadrant(g)].c}"></span>${esc(shortName(g))}
          <span class="pill">${spec.label}</span></div>
        ${nexts.map(n=>`<div class="ns"><span class="muted">&rsaquo;</span><span>${n}</span></div>`).join('')}
      </div>
      <div class="rmtrack">${grid}
        <div class="band ${spec.color}" data-goal="${g.id}" style="left:${left}%;width:${w}%">
          ${prog?`<div class="prog" style="width:${prog}%"></div>`:''}
          <span style="position:relative">${g.smart.target?money(g.smart.current||0)+' / '+money(g.smart.target)
            : g.smart.deadline?fmtDate(g.smart.deadline):spec.label}</span></div>
        ${dots}${dl}
        ${today()>=from&&today()<=to?`<div class="today-line" style="left:${x(today())}%"></div>`:''}
      </div></div>`;
  }).join('');

  return `<div class="viewhead">
      <h2>Quarter</h2><span class="sub">${fmtDate(from)} &ndash; ${fmtDate(to)}</span>
      <div class="spacer" style="flex:1"></div>
      <div class="nav">
        <button class="btn sm" data-nav="-91">&larr;</button>
        <button class="btn sm" data-nav="0">Now</button>
        <button class="btn sm" data-nav="91">&rarr;</button>
      </div></div>
    <div class="qwrap">
      <div class="density">
        <div class="lbl tiny muted" style="text-transform:uppercase;letter-spacing:.06em">How booked each week already is</div>
        <div class="dbars">${bars}</div>
      </div>
      <div class="roadmap">
        <div class="rmhead"><div class="l">Goal &amp; current next step</div><div class="rmticks">${ticks}</div></div>
        ${rows || '<div style="padding:24px;text-align:center" class="muted">No goals yet. Capture one up top.</div>'}
      </div>
    </div>`;
}
export function doneCount(g){ return g.threads.reduce((n,t)=>n+t.steps.filter(s=>s.done).length,0); }
/* a half-ticked checklist is real progress; count it as a fraction of a step so the
   quarter bar moves as subtasks close rather than jumping only when a step does */
export function partialCount(g){
  return g.threads.reduce((n,t)=>{
    const s=currentStep(t); const p=s?subProgress(s):null;
    return n + (p&&p.any ? p.frac : 0);
  },0);
}
export function bestQuadrant(g){
  const s=g.threads.map(currentStep).filter(Boolean);
  for(const q of ['q1','q2','q3','q4']) if(s.some(x=>x.quadrant===q)) return q;
  return 'q4';
}

