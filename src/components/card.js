import { QUAD } from '../views/render.js';
import { gDead, gForeign } from '../google.js';
import { hrs, loadBar, loadState } from '../budget.js';
import { CAL } from '../cal.js';
import { shortName, subProgress, subs } from '../engine.js';
import { clamp, daysBetween, esc, fmtTime, nowMin, today } from '../util.js';

export const CARDSUBS=new Set();          // step ids whose checklist is expanded on the card
export function itemCard(i,opts={}){
  const g=i.goal, s=i.step, t=i.thread;
  const slip = i.dateKey && i.dateKey<today() && !s.done;
  const meta=[];
  if(g.type!=='task') meta.push(`<span class="goaltag"><span class="dot" style="background:${QUAD[i.quadrant].c}"></span>${esc(shortName(g))}</span>`);
  if(t.name && t.name!=='Main' && g.threads.length>1) meta.push(`<span class="pill">${esc(t.name)}</span>`);
  if(i.ev) meta.push(`<span class="pill mono">${i.ev.allDay?'all day':fmtTime(i.ev.start)}</span>`);
  else if(g.type!=='task') meta.push(`<span class="pill" style="border-color:#5a4a24;color:#e8c98a">unscheduled</span>`);
  if(slip) meta.push(`<span class="pill" style="border-color:#5a2b2b;color:#f0a6a6">slipped ${daysBetween(i.dateKey,today())}d</span>`);
  if(i.blocked) meta.push(`<span class="pill" style="border-color:#5a4a24;color:#e8c98a">waiting on ${esc(t.blockedOn||'?')}</span>`);
  if(s.auto) meta.push(`<span class="pill tiny">auto</span>`);
  if(s.autoScheduled) meta.push(`<span class="pill tiny" title="re-booked by cadence when you completed the last one">&#8635; auto-booked</span>`);
  const sp=subProgress(s);
  if(sp.any) meta.push(`<span class="pill tiny subpill ${sp.done===sp.total?'full':''}" data-act="subs" data-step="${s.id}"
     title="${CARDSUBS.has(s.id)?'Hide':'Show'} subtasks">${sp.done}/${sp.total} ${CARDSUBS.has(s.id)?'&#9650;':'&#9660;'}</span>`);
  return `<div class="card ${s.done?'done':''}" data-step="${s.id}" data-thread="${t.id}" data-goal="${g.id}">
    <div class="qbar" style="background:${QUAD[i.quadrant].c}"></div>
    <div class="chk ${s.done?'on':''}" data-act="toggle">${s.done?'&#10003;':''}</div>
    <div class="body">
      <div class="ttl">${esc(s.title)}</div>
      <div class="meta">${meta.join('')}</div>
      ${ sp.any && CARDSUBS.has(s.id) ? `<div class="cardsubs">${subs(s).map(x=>
        `<div class="subline ${x.done?'done':''}" data-step="${s.id}" data-sub="${x.id}" data-thread="${t.id}" data-goal="${g.id}">
           <span class="subchk ${x.done?'on':''}" data-act="sub" data-step="${s.id}" data-sub="${x.id}"
             role="checkbox" aria-checked="${x.done}" tabindex="0">${x.done?'&#10003;':''}</span>
           <span class="x">${esc(x.title)}</span><span class="grip subgrip" title="Drag onto the calendar to schedule this step">&#8942;&#8942;</span></div>`).join('')}</div>` : '' }
    </div>
    <div class="grip" title="Drag to another quadrant">&#8942;&#8942;</div></div>`;
}

/* ---------- the horizontal day strip ----------
   Shared by Day and List. In List it doubles as a drop target: a row dragged onto it
   is scheduled at the time it lands on, which is the shortest path there is from
   "this exists" to "this is on the calendar" — the rule the whole app turns on. */
export const CAL_S=6*60, CAL_E=22*60, CAL_SPAN=CAL_E-CAL_S;
export const calPos = m => clamp((m-CAL_S)/CAL_SPAN*100,0,100);
/* x-fraction of the track -> a minute, snapped to the quarter hour */
export const calMinAt = f => clamp(Math.round((CAL_S + clamp(f,0,1)*CAL_SPAN)/15)*15, CAL_S, CAL_E-15);

export function dayStripHTML(k,{drop=false}={}){
  const evs=CAL.on(k);
  const timed=evs.filter(e=>!e.allDay), allday=evs.filter(e=>e.allDay);
  let ticks=''; for(let h=6;h<=22;h+=2){
    ticks+=`<div class="hr" style="left:${calPos(h*60)}%"></div><div class="hrlbl" style="left:${calPos(h*60)}%">${fmtTime(h*60)}</div>`;}
  const lanes=timed.map(e=>{
    const l=calPos(e.start), w=Math.max(3,calPos(e.start+e.dur)-l);
    return `<div class="ev${e.stepId?' step':''}${gForeign(e)?' ro':''}${gDead(e)?' gone':''}" data-ev="${e.id}"
      style="left:${l}%;width:${w}%">${e.recur?'&#8635; ':''}${esc(e.title)}</div>`;}).join('');
  const now = k===today() ? `<div class="now" style="left:${calPos(nowMin())}%"></div>` : '';
  const L=loadState(k);
  return `<div class="strip">
    <div class="lbl"><span>Calendar</span>
      <span class="tiny ${L.over?'overtxt':'muted'}">${hrs(L.mins)} of a ${hrs(L.budget)} day${
        L.over?' — over by '+hrs(L.mins-L.budget):''}</span></div>
    ${loadBar(k,{always:true})}
    <div class="trackwrap"><div class="track${drop?' droppable':''}"${drop?' data-caldrop="1"':''}>${ticks}${lanes}${now}<div class="dropline"></div></div></div>
    ${allday.length?`<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">${allday.map(e=>
      `<span class="evchip ${e.stepId?'step':''}${gForeign(e)?' ro':''}${gDead(e)?' gone':''}" data-ev="${e.id}">${
        e.recur?'&#8635; ':''}${esc(e.title)}</span>`).join('')}</div>`:''}
  </div>`;
}

