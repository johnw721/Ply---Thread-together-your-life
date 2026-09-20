import { DayStrip, ItemCard } from '../components/card.jsx';
import { activeItems, itemsOn, overdueItems, unscheduledItems } from '../engine.js';
import { DB } from '../store.js';
import { fmtDate, fmtFull, today } from '../util.js';
import { QUAD } from './render.jsx';
import { activeItemsC, uiRev } from '../signals.js';

/* ================= DAY =================
   A timed calendar strip with a now-line, then the Eisenhower matrix. Cards drag
   between quadrants; anything with no slot drops into the tray below.

   Same markup and data attributes as the string version it replaces, so the
   click router and the drag engine are untouched. Cards are keyed by step id,
   so completing one patches that card out instead of rebuilding the matrix. */

function Tray({ items }){
  if (!items.length) return null;
  return (
    <div class="strip" style="margin-top:14px">
      <div class="lbl">
        <span>Not on the calendar yet {'—'} {items.length} next step{items.length>1?'s':''}</span>
        <span class="tiny muted">if it isn't scheduled, it isn't real</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px">
        {items.map(i => <ItemCard key={i.step.id} item={i} />)}
      </div>
    </div>
  );
}

export function DayView(){
  activeItemsC.value; uiRev.value;
  const k = DB.meta.cursor;
  const isToday = k === today();

  let items = itemsOn(k);
  if (isToday){
    items = items.concat(overdueItems());
    // plain tasks with no slot always live in the matrix — they have nowhere else to be
    items = items.concat(activeItems().filter(i => !i.dateKey && i.goal.type === 'task'));
  }
  const seen = new Set(); items = items.filter(i => !seen.has(i.step.id) && seen.add(i.step.id));

  return (
    <>
      <div class="viewhead">
        <h2>{isToday ? 'Today' : fmtDate(k)}</h2>
        <span class="sub">{fmtFull(k)}</span>
        <div class="spacer" style="flex:1" />
        <div class="nav">
          <button class="btn sm" data-nav="-1">{'←'}</button>
          <button class="btn sm" data-nav="0">Today</button>
          <button class="btn sm" data-nav="1">{'→'}</button>
          <button class="btn sm" data-act="newEvent">+ Event</button>
        </div>
      </div>

      <DayStrip k={k} drop />

      <div class="axis"><div>{'←'} urgent</div><div>not urgent {'→'}</div></div>

      <div class="matrix">
        {Object.keys(QUAD).map(q => {
          const list = items.filter(i => i.quadrant === q);
          return (
            <div key={q} class="quad" data-quad={q}>
              <h3>
                <span class="dot" style={'background:' + QUAD[q].c} />{QUAD[q].n}
                <span class="sub">{QUAD[q].ax}</span><span class="n">{list.length}</span>
              </h3>
              <div class="items">
                { list.length
                  ? list.map(i => <ItemCard key={i.step.id} item={i} />)
                  : <div class="empty">nothing here</div> }
              </div>
            </div>
          );
        })}
      </div>

      <Tray items={unscheduledItems()} />
    </>
  );
}
