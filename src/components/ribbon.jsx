import { render } from '../views/render.jsx';
import { render as preactRender } from 'preact';
import { useEffect } from 'preact/hooks';
import { signals, shortName } from '../engine.js';
import { SEV_RANK } from '../engine.js';
import { gChips } from '../google.js';
import { $ } from '../util.js';
import { signalsC, uiRev } from '../signals.js';
import { FIXABLE, sigResolverHTML } from './resolver.js';
import { SIG_KIND, SIG_MAX, SIGOPEN, SIGALL, SIGFIX, setSigOpen, setSigFix } from './ribbon.js';

/* ---------- signal ribbon ----------
   A wall of chips gets ignored, and an ignored ribbon defeats the whole premise.
   So: one chip per *kind*, not per thread. Kinds with several threads behind them
   collapse to a count and expand on click; the ribbon itself never exceeds SIG_MAX.

   Component form. The chips are keyed by kind and the expanded rows by signal
   key, so opening a group or arming a resolver patches the row it belongs to
   rather than rebuilding the ribbon — which is what stops the resolver's fields
   losing their caret every time the DB is saved underneath them. */

function Chip({ group }){
  const keys = group.items.map(i => i.key).join('|');
  const cls = group.sev === 'hard' ? 'hard' : group.sev === 'mute' ? 'mute' : '';
  const snooze = <span class="zz" data-snooze={keys} title="Snooze 7 days">{'×'}</span>;

  if (group.items.length === 1){
    const s = group.items[0];
    return (
      <div class={'sig ' + cls + ' ' + (SIGFIX === s.key ? 'open' : '')}
           data-sig={s.key} data-goal={s.goal.id}>
        <b>{shortName(s.goal)}</b> {s.text}
        {FIXABLE.has(s.kind) ? <span class="fixmark">fix</span> : null}
        {snooze}
      </div>
    );
  }
  const open = SIGOPEN === group.kind;
  return (
    <div class={'sig ' + cls + ' ' + (open ? 'open' : '')} data-grp={group.kind}>
      <b>{group.items.length} {group.kind === 'gate'
        ? 'question' + (group.items.length > 1 ? 's' : '') : 'threads'}</b>
      {' '}{SIG_KIND[group.kind] || group.kind}
      <span class="caret">{open ? '▲' : '▼'}</span>
      {snooze}
    </div>
  );
}

function Ribbon(){
  signalsC.value; uiRev.value;
  const sig = signals();

  /* The provider's own chips sit ahead of the groups and are deliberately not
     snoozeable: "three changes waiting to sync" is a fact about the app, not a
     nag about a thread, and muting it would just lose the writes quietly. */
  const pins = gChips();

  const byKind = {}, groups = [];
  for (const s of sig){
    let gr = byKind[s.kind];
    if (!gr){ gr = byKind[s.kind] = { kind: s.kind, sev: s.sev, items: [] }; groups.push(gr); }
    gr.items.push(s);
    if (SEV_RANK[s.sev] < SEV_RANK[gr.sev]) gr.sev = s.sev;
  }
  groups.sort((a,b) => SEV_RANK[a.sev]-SEV_RANK[b.sev] || b.items.length-a.items.length);

  if (SIGOPEN && !byKind[SIGOPEN]) setSigOpen(null);
  const fix = SIGFIX && sig.find(s => s.key === SIGFIX);
  if (SIGFIX && !fix) setSigFix(null);

  /* nothing drifting and nothing queued: the ribbon renders as genuinely empty,
     not as an empty row, because the header collapses on the class alone */
  if (!sig.length && !pins.length) return null;

  const shown = SIGALL ? groups : groups.slice(0, SIG_MAX);
  const rest  = SIGALL ? [] : groups.slice(SIG_MAX);
  const opened = SIGOPEN && byKind[SIGOPEN] && byKind[SIGOPEN].items.length > 1
    ? byKind[SIGOPEN].items : null;

  useEffect(() => {
    if (!fix) return;
    const f = $('#fxStep') || $('#fxTrig') || $('#fxDate') || $('#fxWhen');
    if (f) setTimeout(() => f.focus(), 20);
  }, [fix && fix.key]);

  return (
    <>
      <div class="sigrow">
        {pins.map(c => <div key={c.act} class={'sig ' + c.cls} data-gact={c.act}>{c.text}</div>)}
        {shown.map(gr => <Chip key={gr.kind} group={gr} />)}
        {rest.length
          ? <div class="sig more" data-sigmore="1">+{rest.reduce((n,g)=>n+g.items.length,0)} more</div>
          : (SIGALL && groups.length > SIG_MAX
              ? <div class="sig more" data-sigmore="1">show less</div> : null)}
      </div>

      {opened &&
        <div class="sigopen">
          {opened.map(s => (
            <div key={s.key} class={'srow ' + (SIGFIX === s.key ? 'on' : '')}
                 data-sig={s.key} data-goal={s.goal.id}>
              <b>{shortName(s.goal)}</b><span class="t">{s.text}</span>
              {FIXABLE.has(s.kind) ? <span class="fixmark">fix</span> : null}
              <span class="zz" data-snooze={s.key} title="Snooze 7 days">snooze</span>
            </div>
          ))}
          <div class="sfoot">
            <span class="zz" data-snooze={opened.map(i=>i.key).join('|')}>
              Snooze all {opened.length} for 7 days
            </span>
          </div>
        </div>}

      {/* the resolver sits under the ribbon so it reads as an answer to the chip above it */}
      {fix && <div dangerouslySetInnerHTML={{ __html: sigResolverHTML(fix) }} />}
    </>
  );
}

export function renderSignals(){
  const r = $('#signals');
  const sig = signals();
  r.classList.toggle('empty', sig.length === 0 && !gChips().length);
  preactRender(<Ribbon />, r);
}
