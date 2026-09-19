/* ===========================================================================
   google provider
   ---------------------------------------------------------------------------
   Everything here runs against a stubbed `fetch` and a stubbed Google Identity
   Services, so the suite is about Ply's rules rather than Google's uptime. The
   router in fetchStub answers 404 for anything it wasn't told about, which is
   what stops a test passing on a request it never meant to make.
=========================================================================== */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, gisStub, fetchStub, gEvent, tinyDB, makeGoal } from '../harness.js';

let h, api, net;

/* ---- fixtures ---------------------------------------------------------- */

/* the happy-path routes: a userinfo call, a list, and the three writes */
function routes(state){
  /* read through `state` on every call: a test installs `listed` after the router
     is built, and capturing it up front would silently use the default forever */
  const listed = rec => state.listed
    ? state.listed(rec)
    : {body:{items:state.items||[], nextSyncToken:state.nextToken||'tok-A'}};
  return [
    [u=>u.startsWith('https://www.googleapis.com/oauth2/v3/userinfo'),
      ()=>({body:{email:state.email||'grey@example.com'}})],
    [(u,m)=>m==='GET' && u.includes('/events?'),
      rec=>{ state.lists=(state.lists||[]).concat(rec.url); return listed(rec); }],
    [(u,m)=>m==='POST' && /\/events$/.test(u.split('?')[0]),
      rec=>{ const id='new'+(state.made=(state.made||0)+1);
             state.posted=(state.posted||[]).concat(rec);
             return {body:{id, etag:'"p1"', updated:'2026-09-19T12:00:00.000Z', status:'confirmed',
                           htmlLink:'https://calendar.google.com/x/'+id}}; }],
    [(u,m)=>m==='PATCH',
      rec=>{ state.patched=(state.patched||[]).concat(rec);
             return {body:{id:rec.url.split('/').pop(), etag:'"p2"',
                           updated:'2026-09-19T13:00:00.000Z', status:'confirmed'}}; }],
    [(u,m)=>m==='DELETE',
      rec=>{ state.deleted=(state.deleted||[]).concat(rec); return {status:204}; }]
  ];
}

/* a live goal with one step, and nothing else in the way */
function subject(){
  return tinyDB(api, a=>makeGoal(a, {title:'Ship the thing', type:'milestone', step:'Wire the pipeline'}));
}

async function connect(state={}){
  gisStub(h.window);
  net = fetchStub(h.window, routes(state));
  api.gmeta().clientId='cid-123.apps.googleusercontent.com';
  await api.gConnect();
  return state;
}

beforeEach(async ()=>{
  h = await boot({seed:false});
  api = h.api;
  h.forbidNatives();          // the no-native-dialogs rule holds here too
});
afterEach(()=>{ try{ api.gStop(); }catch(_){ } try{ h.close(); }catch(_){ } });

/* ======================================================================= */
describe('google provider — auth state', ()=>{

  it('refuses to connect with no client id, and says which thing is missing', async ()=>{
    gisStub(h.window); fetchStub(h.window, routes({}));
    await expect(api.gConnect()).rejects.toMatchObject({kind:'config'});
    expect(api.gmeta().enabled).toBe(false);
    expect(api.CAL.provider).toBe('local');
  });

  it('connects, records the account, and asks for the calendar.events scope', async ()=>{
    const st = await connect();
    expect(api.GSTATE).toBe('ready');
    expect(api.gmeta().enabled).toBe(true);
    expect(api.gmeta().account).toBe('grey@example.com');
    expect(api.CAL.provider).toBe('google');
    expect(api.CAL.online).toBe(true);
    const asked = h.window.google.__calls.find(c=>c.scope);
    expect(asked.scope).toContain('https://www.googleapis.com/auth/calendar.events');
    expect(asked.client_id).toBe('cid-123.apps.googleusercontent.com');
    expect(st.lists.length).toBe(1);
  });

  it('keeps the access token out of localStorage entirely', async ()=>{
    await connect();
    expect(api.GTOK.token).toBe('tok-1');
    const dump = Object.keys(h.window.localStorage)
      .map(k=>String(h.window.localStorage.getItem(k))).join('|');
    expect(dump).not.toContain('tok-1');
    /* what does get stored is the sync cursor and the public client id */
    expect(h.window.localStorage.getItem(api.G_SYNCKEY)).toContain('tok-A');
    expect(dump).toContain('cid-123');
  });

  it('a 401 buys exactly one silent renewal, then parks in stale', async ()=>{
    const st = await connect();
    let calls=0;
    net.routes = [[(u,m)=>m==='GET' && u.includes('/events?'), ()=>{ calls++; return {status:401}; }]];
    await expect(api.gSync({full:true})).rejects.toMatchObject({kind:'auth'});
    expect(calls).toBe(2);                 // the original and one retry, not a loop
    expect(api.GSTATE).toBe('stale');
    expect(api.gChips().some(c=>/reconnect/i.test(c.text))).toBe(true);
  });

  it('a network failure reports offline rather than expired', async ()=>{
    await connect();
    net.routes = [[()=>true, ()=>new TypeError('Failed to fetch')]];
    await expect(api.gSync({full:true})).rejects.toMatchObject({kind:'offline'});
    expect(api.GSTATE).toBe('offline');
    expect(api.CAL.online).toBe(false);
    expect(api.CAL.writable).toBe(true);   // writable means "Ply may schedule", and it still may
  });

  it('disconnecting revokes, drops the foreign cache and keeps your own schedule', async ()=>{
    const {goal,thread,step} = subject();
    const st = await connect({items:[gEvent({id:'foreign1'})]});
    api.CAL.anchor(goal,thread,step,api.today(),9*60,45);
    await api.gFlush();
    expect(api.DB.events.length).toBe(2);

    api.gDisconnect();
    expect(h.window.google.__calls.some(c=>c.revoked==='tok-1')).toBe(true);
    expect(api.gmeta().enabled).toBe(false);
    expect(api.CAL.provider).toBe('local');
    expect(api.DB.events.length).toBe(1);                 // the foreign row went
    const kept = api.DB.events[0];
    expect(kept.stepId).toBe(step.id);                    // ours stayed, as a local event
    expect(kept.gcal).toBe(null);
    expect(kept.src).toBe('manual');
    expect(api.findStep(step.id).step.eventId).toBe(kept.id);
    expect(api.DB.meta.gqueue.length).toBe(0);
  });
});

/* ======================================================================= */
describe('google provider — merge', ()=>{

  it('maps a timed event into the local shape', async ()=>{
    const k=api.addDays(api.today(),2);
    await connect({items:[gEvent({id:'t1', summary:'Standup',
      start:api.gISO(k,9*60), end:api.gISO(k,9*60+25)})]});
    const row=api.DB.events.find(e=>e.gcal&&e.gcal.id==='t1');
    expect(row.title).toBe('Standup');
    expect(row.dateKey).toBe(k);
    expect(row.start).toBe(9*60);
    expect(row.dur).toBe(25);
    expect(row.src).toBe('google');
    expect(row.recur).toBe(null);
    expect(api.gForeign(row)).toBe(true);
  });

  it('CAL.on and CAL.list return remote and local events together', async ()=>{
    const k=api.today();
    const {goal,thread,step}=subject();
    await connect({items:[gEvent({id:'r1', summary:'Their meeting',
      start:api.gISO(k,15*60), end:api.gISO(k,16*60)})]});
    api.CAL.anchor(goal,thread,step,k,9*60,45);
    await api.gFlush();
    const on=api.CAL.on(k).map(e=>e.title);
    expect(on).toEqual(['Wire the pipeline','Their meeting']);   // sorted by start
    expect(api.CAL.list(k,api.addDays(k,1)).length).toBe(2);
  });

  it('an all-day event lands all-day and costs the day nothing', async ()=>{
    const k=api.addDays(api.today(),1);
    await connect({items:[gEvent({id:'a1', summary:'Company holiday', date:k})]});
    const row=api.DB.events.find(e=>e.gcal&&e.gcal.id==='a1');
    expect(row.allDay).toBe(true);
    expect(api.CAL.loadOn(k)).toBe(0);
  });

  it('recurring instances arrive pre-expanded and never touch occurrenceOf', async ()=>{
    const a=api.today(), b=api.addDays(a,7);
    await connect({items:[
      gEvent({id:'rec_1', summary:'1:1', start:api.gISO(a,14*60), end:api.gISO(a,14*60+30)}),
      gEvent({id:'rec_2', summary:'1:1', start:api.gISO(b,14*60), end:api.gISO(b,14*60+30)})
    ]});
    const rows=api.DB.events.filter(e=>e.gcal);
    expect(rows.length).toBe(2);
    expect(rows.every(r=>r.recur===null && (r.skips||[]).length===0)).toBe(true);
    expect(api.CAL.on(a).length).toBe(1);
    expect(api.CAL.on(b).length).toBe(1);
    /* each instance is its own stored row, so no virtual ids are minted */
    expect(rows.every(r=>!String(r.id).includes('@'))).toBe(true);
  });

  it('an event carrying plyStepId is ours, and finds its step', async ()=>{
    const {goal,thread,step}=subject();
    const k=api.addDays(api.today(),3);
    await connect({items:[gEvent({id:'mine1', summary:'Wire the pipeline', stepId:step.id,
      goalId:goal.id, threadId:thread.id, start:api.gISO(k,11*60), end:api.gISO(k,11*60+45)})]});
    const row=api.DB.events.find(e=>e.gcal&&e.gcal.id==='mine1');
    expect(row.stepId).toBe(step.id);
    expect(row.gcal.own).toBe(true);
    expect(api.gForeign(row)).toBe(false);
    expect(api.findStep(step.id).step.eventId).toBe(row.id);   // adopted from another device
  });

  it('a foreign event opens read-only, with no way to save it', async ()=>{
    await connect({items:[gEvent({id:'f1', summary:'Someone else’s review'})]});
    const row=api.DB.events.find(e=>e.gcal&&e.gcal.id==='f1');
    api.openEvent(row.id);
    const modal=h.$('.modal');
    expect(modal.textContent).toContain('From Google Calendar');
    expect(h.$('[data-ui="ev-save"]')).toBe(null);
    expect(h.$('[data-ui="ev-del"]')).toBe(null);
    expect(h.$('#evT')).toBe(null);
    expect(modal.querySelector('a[href*="calendar.google.com"]')).toBeTruthy();
  });

  it('escapes a hostile title from Google everywhere it renders', async ()=>{
    const k=api.today();
    const bad='<img src=x onerror="window.__pwn=1">';
    await connect({items:[gEvent({id:'x1', summary:bad, start:api.gISO(k,10*60), end:api.gISO(k,11*60)})]});
    api.render();
    expect(h.$('#view').querySelector('img')).toBe(null);
    expect(h.window.__pwn).toBe(undefined);
    expect(h.$('#view').textContent).toContain('onerror');
    const row=api.DB.events.find(e=>e.gcal&&e.gcal.id==='x1');
    api.openEvent(row.id);
    expect(h.$('.modal').querySelector('img')).toBe(null);
  });
});

/* ======================================================================= */
describe('google provider — write', ()=>{

  it('anchoring creates the remote event and tags it as ours', async ()=>{
    const {goal,thread,step}=subject();
    const st=await connect();
    const k=api.addDays(api.today(),1);
    const ev=api.CAL.anchor(goal,thread,step,k,9*60,45);

    /* the local row exists before the network does — scheduling never waits */
    expect(ev.src).toBe('google');
    expect(ev.gcal.id).toBe(null);
    expect(ev.gcal.pending).toBe(true);
    expect(step.eventId).toBe(ev.id);
    expect(api.gPending()).toBe(1);

    await api.gFlush();
    expect(st.posted.length).toBe(1);
    const body=st.posted[0].body;
    expect(body.summary).toBe('Wire the pipeline');
    expect(body.start.dateTime).toBe(api.gISO(k,9*60));
    expect(body.end.dateTime).toBe(api.gISO(k,9*60+45));
    expect(body.extendedProperties.private.plyStepId).toBe(step.id);
    expect(body.extendedProperties.private.plyGoalId).toBe(goal.id);
    expect(ev.gcal.id).toBe('new1');
    expect(ev.gcal.pending).toBe(false);
    expect(api.gPending()).toBe(0);
  });

  it('re-anchoring patches the same event in place — never delete then create', async ()=>{
    const {goal,thread,step}=subject();
    const st=await connect();
    const a=api.addDays(api.today(),1), b=api.addDays(api.today(),4);
    const ev=api.CAL.anchor(goal,thread,step,a,9*60,45);
    await api.gFlush();
    const remoteId=ev.gcal.id;

    const again=api.CAL.anchor(goal,thread,step,b,15*60,90);
    await api.gFlush();

    expect(again).toBe(ev);                      // the same local row moved
    expect(api.DB.events.length).toBe(1);
    expect(ev.gcal.id).toBe(remoteId);           // and the same remote event
    expect(st.posted.length).toBe(1);            // no second create
    expect(st.deleted).toBe(undefined);          // and nothing was deleted
    expect(st.patched.length).toBe(1);
    expect(st.patched[0].url).toContain('/events/'+remoteId);
    expect(st.patched[0].body.start.dateTime).toBe(api.gISO(b,15*60));
    expect(st.patched[0].body.end.dateTime).toBe(api.gISO(b,15*60+90));
  });

  it('a re-anchor beats the time the remote is holding', async ()=>{
    const {goal,thread,step}=subject();
    const st=await connect();
    const a=api.addDays(api.today(),1), b=api.addDays(api.today(),2);
    const ev=api.CAL.anchor(goal,thread,step,a,9*60,45);
    await api.gFlush();

    api.CAL.anchor(goal,thread,step,b,16*60,30);          // queued, not yet delivered
    expect(ev.gcal.pending).toBe(true);
    /* a pull arriving mid-flight must not undo the move the person just made */
    api.gApply([gEvent({id:ev.gcal.id, summary:'Wire the pipeline', stepId:step.id,
      updated:'2099-01-01T00:00:00.000Z', start:api.gISO(a,9*60), end:api.gISO(a,9*60+45)})],
      {cal:'primary', replace:false});
    expect(ev.dateKey).toBe(b);
    expect(ev.start).toBe(16*60);

    await api.gFlush();
    expect(ev.gcal.pending).toBe(false);
  });

  it('unanchoring deletes the remote event and clears the link', async ()=>{
    const {goal,thread,step}=subject();
    const st=await connect();
    const ev=api.CAL.anchor(goal,thread,step,api.today(),9*60,45);
    await api.gFlush();
    const remoteId=ev.gcal.id;

    api.CAL.unanchor(step);
    await api.gFlush();
    expect(step.eventId).toBe(null);
    expect(api.DB.events.length).toBe(0);
    expect(st.deleted.length).toBe(1);
    expect(st.deleted[0].url).toContain('/events/'+remoteId);
  });

  it('scheduling then unscheduling before a flush touches the network not at all', async ()=>{
    const {goal,thread,step}=subject();
    const st=await connect();
    net.routes=[[()=>true, ()=>{ throw new Error('nothing should have been sent'); }]];
    api.CAL.anchor(goal,thread,step,api.today(),9*60,45);
    expect(api.gPending()).toBe(1);
    api.CAL.unanchor(step);
    expect(api.gPending()).toBe(0);              // create + delete cancel out
    await api.gFlush();
    expect(st.posted).toBe(undefined);
  });

  it('deleting a goal takes its remote events with it', async ()=>{
    const {goal,thread,step}=subject();
    const st=await connect();
    const ev=api.CAL.anchor(goal,thread,step,api.today(),9*60,45);
    await api.gFlush();
    api.deleteGoal(goal.id);
    await api.gFlush();
    expect(st.deleted.length).toBe(1);
    expect(st.deleted[0].url).toContain(ev.gcal.id);
  });
});

/* ======================================================================= */
describe('google provider — sync token', ()=>{

  it('the first sync is unbounded and mints a token; the next one sends it back', async ()=>{
    const st=await connect();
    const first=st.lists[0];
    /* timeMin/timeMax cannot be combined with syncToken, so the full sync must not
       carry them — the window is applied locally instead */
    expect(first).not.toContain('timeMin');
    expect(first).not.toContain('timeMax');
    expect(first).toContain('singleEvents=true');
    expect(first).toContain('showDeleted=true');
    expect(first).not.toContain('syncToken');
    expect(api.gCursor().token).toBe('tok-A');

    st.nextToken='tok-B';
    await api.gSync({reason:'test'});
    const second=st.lists[1];
    expect(second).toContain('syncToken=tok-A');
    expect(second).not.toContain('timeMin');
    expect(api.gCursor().token).toBe('tok-B');
  });

  it('the sync cursor stays out of DB, so a quiet poll writes nothing', async ()=>{
    const st=await connect();
    expect(api.DB.meta.google.syncToken).toBe(undefined);
    const before=h.window.localStorage.getItem(api.KEY);
    st.nextToken='tok-C';
    const r=await api.gSync({reason:'test'});
    expect(r.n).toBe(0);
    expect(h.window.localStorage.getItem(api.KEY)).toBe(before);   // no storage event for other tabs
    expect(api.gCursor().token).toBe('tok-C');
  });

  it('pages through a multi-page sync and keeps the token from the last page', async ()=>{
    const k=api.today();
    const st={};
    gisStub(h.window);
    let page=0;
    net=fetchStub(h.window, routes(st));
    st.listed=rec=>{
      page++;
      if(page===1) return {body:{items:[gEvent({id:'p1', start:api.gISO(k,8*60), end:api.gISO(k,9*60)})],
                                 nextPageToken:'page2'}};
      return {body:{items:[gEvent({id:'p2', start:api.gISO(k,10*60), end:api.gISO(k,11*60)})],
                    nextSyncToken:'tok-END'}};
    };
    api.gmeta().clientId='cid-123.apps.googleusercontent.com';
    await api.gConnect();
    expect(page).toBe(2);
    expect(st.lists[1]).toContain('pageToken=page2');
    expect(api.gCursor().token).toBe('tok-END');
    expect(api.DB.events.filter(e=>e.gcal).length).toBe(2);
  });

  it('a cancelled item in an incremental pull removes a foreign row', async ()=>{
    const k=api.today();
    const st=await connect({items:[gEvent({id:'c1', start:api.gISO(k,9*60), end:api.gISO(k,10*60)})]});
    expect(api.DB.events.length).toBe(1);
    st.items=[{id:'c1', status:'cancelled'}];
    const r=await api.gSync({reason:'test'});
    expect(r.n).toBe(1);
    expect(api.DB.events.length).toBe(0);
  });

  it('a 410 drops the token, falls back to a full sync, and recovers', async ()=>{
    const k=api.today();
    const st=await connect();
    let gave410=false;
    st.listed=rec=>{
      if(rec.url.includes('syncToken')){ gave410=true; return {status:410}; }
      return {body:{items:[gEvent({id:'after410', start:api.gISO(k,9*60), end:api.gISO(k,10*60)})],
                    nextSyncToken:'tok-FRESH'}};
    };
    const r=await api.gSync({reason:'test'});
    expect(gave410).toBe(true);
    expect(r.incremental).toBe(false);            // it came back as a full sync
    expect(api.gCursor().token).toBe('tok-FRESH');
    expect(api.DB.events.some(e=>e.gcal&&e.gcal.id==='after410')).toBe(true);
  });

  it('a full sync drops cached rows the calendar no longer returns', async ()=>{
    const k=api.today();
    const st=await connect({items:[
      gEvent({id:'keep', start:api.gISO(k,9*60), end:api.gISO(k,10*60)}),
      gEvent({id:'gone', start:api.gISO(k,11*60), end:api.gISO(k,12*60)})]});
    expect(api.DB.events.length).toBe(2);
    st.items=[gEvent({id:'keep', start:api.gISO(k,9*60), end:api.gISO(k,10*60)})];
    await api.gSync({full:true, reason:'test'});
    expect(api.DB.events.map(e=>e.gcal.id)).toEqual(['keep']);
  });

  it('events outside the cached window are not stored', async ()=>{
    const far=api.addDays(api.today(), api.G_FWD_DAYS+10);
    const old=api.addDays(api.today(), -(api.G_BACK_DAYS+10));
    await connect({items:[
      gEvent({id:'far', start:api.gISO(far,9*60), end:api.gISO(far,10*60)}),
      gEvent({id:'old', start:api.gISO(old,9*60), end:api.gISO(old,10*60)})]});
    expect(api.DB.events.length).toBe(0);
    expect(api.inWindow(api.today())).toBe(true);
    expect(api.inWindow(far)).toBe(false);
  });

  it('only one tab syncs, so a poll cannot wipe another tab undo stack', async ()=>{
    await connect();
    h.window.localStorage.setItem('ply.gcal.leader',
      JSON.stringify({tab:'some-other-tab', ts:Date.now()}));
    const r=await api.gSync({reason:'test'});
    expect(r.skipped).toBe('follower');
  });
});

/* ======================================================================= */
describe('google provider — conflict rules', ()=>{

  it('remote wins for time and title', async ()=>{
    const {goal,thread,step}=subject();
    const st=await connect();
    const a=api.today(), b=api.addDays(a,3);
    const ev=api.CAL.anchor(goal,thread,step,a,9*60,45);
    await api.gFlush();

    st.items=[gEvent({id:ev.gcal.id, summary:'Moved in Google', stepId:step.id,
      updated:'2099-01-01T00:00:00.000Z', start:api.gISO(b,17*60), end:api.gISO(b,18*60)})];
    await api.gSync({reason:'test'});
    expect(ev.dateKey).toBe(b);
    expect(ev.start).toBe(17*60);
    expect(ev.dur).toBe(60);
    expect(ev.title).toBe('Moved in Google');
  });

  it('Ply wins for the step link, and puts the property back', async ()=>{
    const {goal,thread,step}=subject();
    const st=await connect();
    const k=api.today();
    const ev=api.CAL.anchor(goal,thread,step,k,9*60,45);
    await api.gFlush();
    st.patched=[];

    /* the same event comes back with our private property stripped off */
    st.items=[gEvent({id:ev.gcal.id, summary:'Wire the pipeline',
      updated:'2099-01-01T00:00:00.000Z', start:api.gISO(k,9*60), end:api.gISO(k,9*60+45)})];
    await api.gSync({reason:'test'});

    expect(ev.stepId).toBe(step.id);                        // the link survived
    expect(step.eventId).toBe(ev.id);
    await api.gFlush();
    expect(st.patched.length).toBe(1);                      // and is being restored remotely
    expect(st.patched[0].body.extendedProperties.private.plyStepId).toBe(step.id);
  });

  it('a step whose event was deleted elsewhere raises the unscheduled signal, not a silent unanchor', async ()=>{
    const {goal,thread,step}=subject();
    const st=await connect();
    const k=api.addDays(api.today(),2);
    const ev=api.CAL.anchor(goal,thread,step,k,9*60,45);
    await api.gFlush();
    expect(api.signals().some(s=>s.kind==='unscheduled')).toBe(false);

    st.items=[{id:ev.gcal.id, status:'cancelled'}];
    await api.gSync({reason:'test'});

    expect(step.eventId).toBe(ev.id);                       // the link is deliberately kept
    expect(api.DB.events.length).toBe(1);
    expect(api.gDead(ev)).toBe(true);
    const sig=api.signals().find(s=>s.kind==='unscheduled');
    expect(sig).toBeTruthy();
    expect(sig.text).toContain('Removed from Google');
    /* and the step behaves as unscheduled everywhere else, too */
    expect(api.unscheduledItems().some(i=>i.step.id===step.id)).toBe(true);
    expect(api.itemsOn(k).length).toBe(0);
    expect(api.checkinAgenda().unsched.some(u=>u.step.id===step.id)).toBe(true);
  });

  it('re-anchoring a tombstoned step creates a fresh event instead of patching a corpse', async ()=>{
    const {goal,thread,step}=subject();
    const st=await connect();
    const ev=api.CAL.anchor(goal,thread,step,api.today(),9*60,45);
    await api.gFlush();
    st.items=[{id:ev.gcal.id, status:'cancelled'}];
    await api.gSync({reason:'test'});
    st.patched=[]; st.posted=[];

    api.CAL.anchor(goal,thread,step,api.addDays(api.today(),1),10*60,45);
    await api.gFlush();
    expect(st.patched.length).toBe(0);
    expect(st.posted.length).toBe(1);
    expect(api.signals().some(s=>s.kind==='unscheduled')).toBe(false);
  });
});

/* ======================================================================= */
describe('google provider — offline queue', ()=>{

  it('holds every write while the network is gone and shows one chip', async ()=>{
    const {goal,thread,step}=subject();
    const other=tinyDBAdd();
    const st=await connect();
    net.routes=[[()=>true, ()=>new TypeError('Failed to fetch')]];

    api.CAL.anchor(goal,thread,step,api.today(),9*60,45);
    await api.gFlush();
    api.CAL.anchor(other.goal,other.thread,other.step,api.today(),11*60,30);
    await api.gFlush();

    expect(api.gPending()).toBe(2);
    api.renderSignals();
    const chips=h.$$('#signals .sig').map(e=>e.textContent.trim());
    expect(chips.filter(t=>/waiting to sync/.test(t)).length).toBe(1);
    expect(chips.some(t=>t.includes('2 changes waiting to sync'))).toBe(true);
  });

  it('replays in the order the changes were made once the network is back', async ()=>{
    const {goal,thread,step}=subject();
    const other=tinyDBAdd();
    const st=await connect();
    const live=net.routes;
    net.routes=[[()=>true, ()=>new TypeError('Failed to fetch')]];
    api.CAL.anchor(goal,thread,step,api.today(),9*60,45);
    await api.gFlush();
    api.CAL.anchor(other.goal,other.thread,other.step,api.today(),11*60,30);
    await api.gFlush();

    net.routes=live;
    const done=await api.gFlush();
    expect(done).toBe(2);
    expect(api.gPending()).toBe(0);
    expect(st.posted.map(p=>p.body.summary)).toEqual(['Wire the pipeline','Second move']);
    expect(api.gChips().length).toBe(0);
  });

  it('coalesces repeated edits to one row into a single job', async ()=>{
    const {goal,thread,step}=subject();
    const st=await connect();
    api.CAL.anchor(goal,thread,step,api.today(),9*60,45);
    await api.gFlush();
    net.routes=[[()=>true, ()=>new TypeError('Failed to fetch')]];
    api.CAL.anchor(goal,thread,step,api.addDays(api.today(),1),10*60,45);
    await api.gFlush();
    api.CAL.anchor(goal,thread,step,api.addDays(api.today(),2),11*60,45);
    await api.gFlush();
    expect(api.gPending()).toBe(1);               // one patch, not two

    net.routes=routes(st);
    await api.gFlush();
    /* the payload is read at flush time, so the one job carries the latest state */
    expect(st.patched.length).toBe(1);
    expect(st.patched[0].body.start.dateTime).toBe(api.gISO(api.addDays(api.today(),2),11*60));
  });

  it('a delete of something Google already lost counts as done', async ()=>{
    const {goal,thread,step}=subject();
    const st=await connect();
    api.CAL.anchor(goal,thread,step,api.today(),9*60,45);
    await api.gFlush();
    net.routes=[[(u,m)=>m==='DELETE', ()=>({status:404})]];
    api.CAL.unanchor(step);
    await api.gFlush();
    expect(api.gPending()).toBe(0);
    expect(step.eventId).toBe(null);
  });

  it('the queue survives a reload', async ()=>{
    const {goal,thread,step}=subject();
    await connect();
    net.routes=[[()=>true, ()=>new TypeError('Failed to fetch')]];
    api.CAL.anchor(goal,thread,step,api.today(),9*60,45);
    await api.gFlush();
    const saved=h.window.localStorage.getItem(api.KEY);
    expect(JSON.parse(saved).meta.gqueue.length).toBe(1);

    const h2=await boot({stored:saved});
    expect(h2.api.gPending()).toBe(1);
    expect(h2.api.gmeta().enabled).toBe(true);
    try{ h2.api.gStop(); h2.close(); }catch(_){}
  });
});

/* ======================================================================= */
describe('google provider — capacity', ()=>{

  it('the day budget counts what the real calendar holds', async ()=>{
    const k=api.today();
    api.DB.meta.dayBudgetMins=240;
    await connect({items:[
      gEvent({id:'m1', summary:'Sprint review', start:api.gISO(k,10*60), end:api.gISO(k,11*60+30)}),
      gEvent({id:'m2', summary:'1:1',           start:api.gISO(k,14*60), end:api.gISO(k,14*60+30)}),
      gEvent({id:'m3', summary:'Offsite',       date:k})
    ]});
    expect(api.CAL.loadOn(k)).toBe(120);             // 90 + 30; the all-day one is exempt
    const L=api.loadState(k);
    expect(L.free).toBe(120);
    api.render();
    expect(h.$('#view').textContent).toContain('2h of a 4h day');
  });

  it('a tombstoned event stops costing the day anything', async ()=>{
    const k=api.today();
    const {goal,thread,step}=subject();
    const st=await connect({items:[gEvent({id:'z1', start:api.gISO(k,9*60), end:api.gISO(k,10*60)})]});
    expect(api.CAL.loadOn(k)).toBe(60);
    const ev=api.CAL.anchor(goal,thread,step,k,13*60,60);
    await api.gFlush();
    expect(api.CAL.loadOn(k)).toBe(120);
    st.items=[{id:ev.gcal.id, status:'cancelled'}];
    await api.gSync({reason:'test'});
    expect(api.CAL.loadOn(k)).toBe(60);
  });

  it('suggestDay routes around days the real calendar already filled', async ()=>{
    subject();
    api.DB.meta.dayBudgetMins=120;
    const soon=api.addDays(api.today(),2);     // where suggestDay looks first for a milestone
    await connect({items:[
      gEvent({id:'b1', start:api.gISO(soon,9*60),  end:api.gISO(soon,11*60)}),
      gEvent({id:'b2', start:api.gISO(soon,13*60), end:api.gISO(soon,14*60)})
    ]});
    expect(api.CAL.loadOn(soon)).toBe(180);
    const item=api.activeItems()[0];
    expect(api.suggestDay(item,45)).not.toBe(soon);   // the real calendar pushed it off that day
  });
});

/* ======================================================================= */
describe('google provider — schema 7', ()=>{

  it('migrates a schema 6 file forward', ()=>{
    const d={schema:6, goals:[], events:[{id:'e1', title:'x', dateKey:api.today(), start:540, dur:60,
      src:'manual', recur:null, skips:[]}], log:[], meta:{}};
    const m=api.migrate(d);
    expect(m.ok).toBe(true);
    expect(m.from).toBe(6);
    expect(d.schema).toBe(7);
    expect(d.events[0].gcal).toBe(null);
    expect(d.meta.google).toEqual({enabled:false, clientId:'', calendarId:'primary', account:null});
    expect(d.meta.gqueue).toEqual([]);
  });

  it('coerces a broken mirror object rather than trusting it', ()=>{
    const d={schema:7, goals:[], log:[], events:[
      {id:'a', title:'a', dateKey:api.today(), start:0, dur:60, src:'google', gcal:'nonsense'},
      {id:'b', title:'b', dateKey:api.today(), start:0, dur:60, src:'google',
       gcal:{id:'g9', status:'weird', pending:'yes', link:42}}
    ], meta:{google:'nope', gqueue:[{op:'explode'},{op:'patch',localId:'a'}]}};
    expect(api.migrate(d).ok).toBe(true);
    expect(d.events[0].gcal).toBe(null);
    expect(d.events[0].src).toBe('manual');          // a remote row with no remote id isn't one
    expect(d.events[1].gcal.status).toBe('confirmed');
    expect(d.events[1].gcal.pending).toBe(true);
    expect(d.events[1].gcal.link).toBe(null);
    expect(d.meta.google.calendarId).toBe('primary');
    expect(d.meta.gqueue.length).toBe(1);
    expect(d.meta.gqueue[0].op).toBe('patch');
  });

  it('still refuses a file from a newer build', ()=>{
    const r=api.migrate({schema:8, goals:[]});
    expect(r.ok).toBe(false);
    expect(r.msg).toContain('newer version');
  });

  it('export keeps your own events and leaves the foreign cache behind', async ()=>{
    const {goal,thread,step}=subject();
    const k=api.today();
    await connect({items:[gEvent({id:'theirs', start:api.gISO(k,15*60), end:api.gISO(k,16*60)})]});
    api.CAL.anchor(goal,thread,step,k,9*60,45);
    await api.gFlush();
    expect(api.DB.events.length).toBe(2);

    let written=null;
    h.window.Blob = class { constructor(parts){ written=parts.join(''); } };
    api.exportJSON();
    const out=JSON.parse(written);
    expect(out.schema).toBe(7);
    expect(out.events.length).toBe(1);
    expect(out.events[0].stepId).toBe(step.id);
    expect(written).not.toContain('theirs');
    expect(api.DB.events.length).toBe(2);           // the live store is untouched
  });
});

/* ======================================================================= */
describe('google provider — Settings', ()=>{

  it('offers the connect control once there is a client id, and not before', async ()=>{
    api.openPrefs();
    expect(h.$('#pfGId')).toBeTruthy();
    expect(h.$('[data-ui="g-connect"]').disabled).toBe(true);

    h.type('#pfGId','cid-123.apps.googleusercontent.com');
    api.gReadPrefs(); api.save();
    api.openPrefs();
    expect(h.$('[data-ui="g-connect"]').disabled).toBe(false);
    expect(h.$('.modal').textContent).toContain('local (manual entry)');
  });

  it('names the connected account and the calendar it writes to', async ()=>{
    await connect();
    api.openPrefs();
    const t=h.$('.modal').textContent;
    expect(t).toContain('grey@example.com');
    expect(t).toContain('primary');
    expect(h.$('[data-ui="g-sync"]')).toBeTruthy();
    expect(h.$('[data-ui="g-off"]')).toBeTruthy();
    expect(h.$('[data-ui="g-connect"]')).toBe(null);
  });

  it('changing the calendar invalidates the sync cursor', async ()=>{
    await connect();
    expect(api.gCursor().token).toBe('tok-A');
    api.openPrefs();
    h.type('#pfGCal','work@group.calendar.google.com');
    api.gReadPrefs();
    expect(api.gmeta().calendarId).toBe('work@group.calendar.google.com');
    expect(api.gCursor().token).toBe(null);        // a token is scoped to what minted it
  });

  it('disconnect arms before it fires', async ()=>{
    await connect();
    api.openPrefs();
    api.uiAct('g-off', h.$('[data-ui="g-off"]'));
    expect(api.gmeta().enabled).toBe(true);        // one click only arms it
    expect(h.$('[data-ui="g-off"]').textContent).toContain('Really');
    api.uiAct('g-off', h.$('[data-ui="g-off"]'));
    expect(api.gmeta().enabled).toBe(false);
  });

  it('no native dialog is reachable anywhere in the provider UI', async ()=>{
    /* the natives are armed to throw for the whole suite (see beforeEach) */
    await connect({items:[gEvent({id:'n1'})]});
    api.openPrefs(); api.closeModal();
    const row=api.DB.events.find(e=>e.gcal);
    if(row){ api.openEvent(row.id); api.closeModal(); }
    api.gAct('gsync');
    api.renderSignals();
    expect(true).toBe(true);
  });
});

/* a second goal in the same DB, for the ordering tests */
function tinyDBAdd(){
  const g=api.newGoal({title:'Another goal', type:'milestone'});
  const t=api.newThread({rel:'sequential'});
  const s=api.newStep('Second move');
  t.steps.push(s); g.threads.push(t); api.DB.goals.push(g); api.save();
  return {goal:g, thread:t, step:s};
}

/* ======================================================================= */
/* The provider changed code every local install runs through — CAL, removeEvent,
   activeItems, signals, exportJSON. With the pre-migration suites not yet back in
   the repo, these pin the local path so the integration can't have quietly
   changed what Ply does for someone who never connects anything. */
describe('local provider — unchanged by all of this', ()=>{

  it('stays the default, with no network in sight', async ()=>{
    subject();
    const seen=[];
    h.window.fetch = async (u)=>{ seen.push(u); throw new Error('no network expected'); };
    expect(api.CAL.provider).toBe('local');
    expect(api.CAL.writable).toBe(true);
    expect(api.CAL.online).toBe(true);
    expect(api.gChips()).toEqual([]);
    expect(seen.length).toBe(0);
  });

  it('anchors, re-anchors and unanchors purely locally', async ()=>{
    const {goal,thread,step}=subject();
    const k=api.today();
    const ev=api.CAL.anchor(goal,thread,step,k,9*60,45);
    expect(ev.src).toBe('manual');
    expect(ev.gcal).toBe(null);
    expect(step.eventId).toBe(ev.id);
    expect(api.gPending()).toBe(0);
    expect(api.CAL.loadOn(k)).toBe(45);

    const moved=api.CAL.anchor(goal,thread,step,api.addDays(k,1),14*60,60);
    expect(api.DB.events.length).toBe(1);            // the old event isn't orphaned
    expect(step.eventId).toBe(moved.id);
    expect(api.CAL.loadOn(k)).toBe(0);

    api.CAL.unanchor(step);
    expect(step.eventId).toBe(null);
    expect(api.DB.events.length).toBe(0);
  });

  it('still raises the plain unscheduled signal, with the plain wording', ()=>{
    const {step}=subject();
    api.render();
    const sig=api.signals().find(s=>s.kind==='unscheduled');
    expect(sig.text).toBe('Next step not on the calendar');
    expect(api.unscheduledItems().length).toBe(1);
  });

  it('one anchor is one undo step, and undoing gives the slot back', async ()=>{
    const {goal,thread,step}=subject();
    api.checkpoint('that scheduling');
    api.CAL.anchor(goal,thread,step,api.today(),9*60,45);
    await h.settle();
    expect(api.UNDO.length).toBe(1);
    api.undo();
    expect(api.DB.events.length).toBe(0);
    expect(api.findStep(step.id).step.eventId).toBe(null);
  });

  it('repeating events still expand at read time', ()=>{
    const k=api.today();
    api.DB = api.blankDB(); api.DB.meta.cursor=k;
    api.addEvent(api.newEvent({title:'Standup', dateKey:k, start:9*60, dur:15,
      recur:{every:7, until:null}}));
    expect(api.CAL.on(k).length).toBe(1);
    const wk=api.addDays(k,7);
    expect(api.CAL.on(wk).length).toBe(1);
    expect(api.CAL.on(wk)[0].virtual).toBe(true);     // still a generated occurrence
    expect(api.CAL.on(api.addDays(k,1)).length).toBe(0);
    expect(api.CAL.loadWeek(api.startOfWeek(k))).toBeGreaterThan(0);
  });

  it('export of a purely local file carries every event', ()=>{
    const {goal,thread,step}=subject();
    api.CAL.anchor(goal,thread,step,api.today(),9*60,45);
    api.addEvent(api.newEvent({title:'Dentist', dateKey:api.today(), start:16*60, dur:60}));
    let written=null;
    h.window.Blob = class { constructor(parts){ written=parts.join(''); } };
    api.exportJSON();
    const out=JSON.parse(written);
    expect(out.events.length).toBe(2);
    expect(out.schema).toBe(7);
    /* and it round-trips back in */
    const back=JSON.parse(written);
    expect(api.migrate(back).ok).toBe(true);
    expect(back.events.length).toBe(2);
  });
});
