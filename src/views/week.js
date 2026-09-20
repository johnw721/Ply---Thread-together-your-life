import { QUAD } from './render.jsx';
import { hrs, loadBar, loadState, viewBudget } from '../budget.js';
import { CAL } from '../cal.js';
import { itemCard } from '../components/card.js';
import { itemsOn, unscheduledItems } from '../engine.js';
import { DB, load } from '../store.js';
import { addDays, esc, fmtDate, fmtDay, fmtTime, parseKey, startOfWeek, today } from '../util.js';

/* ================= WEEK ================= */
export function viewWeek(){
  const ws=startOfWeek(DB.meta.cursor);
  const cols=[];
  for(let i=0;i<7;i++){
    const k=addDays(ws,i);
    const evs=CAL.on(k);
    const timed=evs.filter(e=>!e.allDay);
    const untimedItems = itemsOn(k).filter(i=>!i.ev||i.ev.allDay);
    const untimedEvents = evs.filter(e=>e.allDay && !e.stepId);
    const load=CAL.loadOn(k);
    cols.push(`<div class="daycol ${k===today()?'today':''}" data-day="${k}" data-daydrop="1">
      <h4><span>${fmtDay(k)}</span><span class="d">${parseKey(k).getDate()}</span></h4>
      <div class="sect">
        <div class="sl">Calendar${load?' · '+hrs(load):''}${loadState(k).over?' <span class="overtxt">over</span>':''}</div>
        ${loadBar(k)}
        ${ timed.length ? timed.map(e=>`<div class="evchip ${e.stepId?'step':''}" data-ev="${e.id}">
             <span class="t">${fmtTime(e.start)}</span>${e.recur?'&#8635; ':''}${esc(e.title)}</div>`).join('')
          : '<div class="overflow">&mdash;</div>' }
      </div>
      <div class="sect">
        <div class="sl">Tasks</div>
        ${ (untimedItems.length+untimedEvents.length) ? [
             ...untimedItems.map(i=>`<div class="tchip ${i.step.done?'done':''}" data-step="${i.step.id}" data-thread="${i.thread.id}" data-goal="${i.goal.id}">
                 <span class="dot" style="background:${QUAD[i.quadrant].c}"></span><span class="x">${esc(i.step.title)}</span></div>`),
             ...untimedEvents.map(e=>`<div class="tchip" data-ev="${e.id}"><span class="dot" style="background:var(--accent)"></span><span class="x">${esc(e.title)}</span></div>`)
           ].join('') : '<div class="overflow">&mdash;</div>' }
      </div></div>`);
  }
  const tray=unscheduledItems();
  return `<div class="viewhead">
      <h2>Week of ${fmtDate(ws)}</h2>
      <span class="sub">${Math.round(CAL.loadWeek(ws)/60*10)/10}h booked across the week</span>
      <div class="spacer" style="flex:1"></div>
      <div class="nav">
        <button class="btn sm" data-nav="-7">&larr;</button>
        <button class="btn sm" data-nav="0">This week</button>
        <button class="btn sm" data-nav="7">&rarr;</button>
      </div></div>
    <div class="weekgrid">${cols.join('')}</div>
    ${ tray.length?`<div class="strip" style="margin-top:14px">
        <div class="lbl"><span>Unscheduled next steps &mdash; ${tray.length}</span></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px">
          ${tray.map(i=>itemCard(i)).join('')}</div></div>`:'' }
    ${viewBudget()}`;
}

/* ---------------- weekly money budget ---------------- */
