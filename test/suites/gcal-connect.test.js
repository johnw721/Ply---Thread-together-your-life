/* ===========================================================================
   Google Calendar — the connect dialog
   ---------------------------------------------------------------------------
   The provider itself is pinned by google.test.js. This suite is about getting
   to it: the header button and what it says, the guided setup, the id field
   reading a pasted value the way people actually get it wrong, connecting from
   the dialog end to end, and each way that can fail saying what to do next.
   Same stubs as the provider suite — nothing reaches a real network.
=========================================================================== */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, gisStub, fetchStub, gEvent, TARGET, isLegacy } from '../harness.js';

const d = isLegacy ? describe.skip : describe;    // the monolith never had this dialog
const ID = '123456789-abc123def.apps.googleusercontent.com';

let h, api;

function routes(state){
  return [
    [u=>u.startsWith('https://www.googleapis.com/oauth2/v3/userinfo'),
      ()=>({body:{email:state.email||'grey@example.com'}})],
    [(u,m)=>m==='GET' && u.includes('/events?'),
      rec=>{ state.lists=(state.lists||[]).concat(rec.url);
             if(state.unauth) return {status:401};
             return {body:{items:state.items||[], nextSyncToken:'tok-A'}}; }]
  ];
}
function stubs(state={}, gis={}){
  gisStub(h.window, gis);
  fetchStub(h.window, routes(state));
  return state;
}
/* the connect chain is a few promise hops and a timer in the GIS stub */
async function until(fn, n=40){
  for(let i=0;i<n;i++){ if(fn()) return true; await new Promise(r=>setTimeout(r,0)); }
  return fn();
}
/* GSTATE has no setter — reach 'stale' the way the app does: Google keeps
   answering 401, one silent renewal doesn't help, and the provider parks. */
async function goStale(st){
  st.unauth=true;
  await api.gSync({reason:'poll'}).catch(()=>{});
  st.unauth=false;
  expect(api.GSTATE).toBe('stale');
}
const face  = ()=> { const b=h.$('#gcBody'); return b ? b.dataset.face : null; };
const cbtn  = ()=> h.$('[data-ui="gc-connect"]');
const calb  = ()=> h.$('#btnCal');
const modal = ()=> h.$('.modal').textContent.replace(/\s+/g,' ');

beforeEach(async ()=>{
  h = await boot({seed:false});
  api = h.api;
  h.forbidNatives();
  api.gcReset();
});
afterEach(()=>{ try{ api.gStop(); }catch(_){ } try{ h.close(); }catch(_){ } });

/* ======================================================================= */
d('the header button [' + TARGET + ']', ()=>{

  it('is there, and asks to connect, when nothing is connected', ()=>{
    expect(calb()).toBeTruthy();
    expect(calb().classList.contains('hidden')).toBe(false);
    expect(calb().dataset.state).toBe('off');
    expect(calb().textContent).toContain('Connect calendar');
  });

  it('opens the dialog on click', ()=>{
    h.click('#btnCal');
    expect(h.$('[role="dialog"]')).toBeTruthy();
    expect(face()).toBe('setup');
  });

  it('turns green once connected, and names the account in its title', async ()=>{
    stubs();
    api.gmeta().clientId=ID;
    await api.gConnect(); api.render();
    expect(calb().dataset.state).toBe('good');
    expect(calb().title).toContain('grey@example.com');
    expect(calb().textContent).not.toContain('Connect calendar');
  });

  it('says Reconnect when access has expired', async ()=>{
    const st=stubs();
    api.gmeta().clientId=ID;
    await api.gConnect();
    await goStale(st);
    expect(calb().dataset.state).toBe('bad');
    expect(calb().textContent).toContain('Reconnect');
  });

  it('shows waiting changes as a warning', async ()=>{
    stubs();
    api.gmeta().clientId=ID;
    await api.gConnect();
    api.DB.meta.gqueue=[{id:'j1', op:'create', localId:'x', gcalId:null, at:'', tries:0}];
    api.renderSignals();
    expect(calb().dataset.state).toBe('warn');
    expect(calb().title).toContain('1 change waiting');
  });

  it('the ⋮ menu reaches the same dialog', ()=>{
    h.click('#btnMenu');
    h.click('.menu [data-m="gcal"]');
    expect(face()).toBe('setup');
  });
});

/* ======================================================================= */
d('guided setup [' + TARGET + ']', ()=>{

  it('walks through the Google Cloud steps with links, and this page\'s origin to copy', ()=>{
    api.openGConnect();
    expect(h.$$('.gcstep').length).toBe(4);
    const hrefs=h.$$('.gcstep a').map(a=>a.getAttribute('href'));
    expect(hrefs).toContain(api.GC_LINKS.api);
    expect(hrefs).toContain(api.GC_LINKS.consent);
    expect(hrefs).toContain(api.GC_LINKS.creds);
    h.$$('.gcstep a').forEach(a=>{ expect(a.target).toBe('_blank'); expect(a.rel).toContain('noopener'); });
    expect(h.text('#gcOrigin')).toBe(h.window.location.origin);
    expect(modal()).toContain('Test users');
  });

  it('keeps Connect disabled until there is an id', ()=>{
    api.openGConnect();
    expect(cbtn().disabled).toBe(true);
    h.type('#gcId', ID);
    expect(cbtn().disabled).toBe(false);
    expect(h.$('#gcIdMsg').className).toContain('good');
    h.type('#gcId', '');
    expect(cbtn().disabled).toBe(true);
  });

  it('refuses a pasted client secret, and says why', ()=>{
    api.openGConnect();
    h.type('#gcId', 'GOCSPX-abcdefghijklmnop');
    expect(cbtn().disabled).toBe(true);
    expect(h.$('#gcIdMsg').className).toContain('bad');
    expect(h.text('#gcIdMsg')).toContain('secret');
  });

  it('warns on an odd-looking id but still lets you try it', ()=>{
    api.openGConnect();
    h.type('#gcId', 'my-weird-client');
    expect(h.$('#gcIdMsg').className).toContain('warn');
    expect(cbtn().disabled).toBe(false);
  });

  it('typing never re-renders the dialog — the field keeps its node', ()=>{
    api.openGConnect();
    const f=h.$('#gcId');
    h.type(f, '1234');
    h.type(f, ID);
    expect(h.$('#gcId')).toBe(f);
  });

  it('gcCheckId reads the common mistakes', ()=>{
    expect(api.gcCheckId('').ok).toBe(false);
    expect(api.gcCheckId(' '+ID+' ').level).toBe('good');
    expect(api.gcCheckId('GOCSPX-x').ok).toBe(false);
    expect(api.gcCheckId('abc def').ok).toBe(false);
    expect(api.gcCheckId('something-else').level).toBe('warn');
  });

  it('Copy puts the origin on the clipboard', async ()=>{
    let wrote=null;
    Object.defineProperty(h.window.navigator, 'clipboard',
      {configurable:true, value:{writeText:v=>{ wrote=v; return Promise.resolve(); }}});
    api.openGConnect();
    h.click('[data-ui="gc-copy"]');
    await until(()=>h.lastToast().includes('Copied'));
    expect(wrote).toBe(h.window.location.origin);
  });

  it('Copy falls back to selecting the text when there is no clipboard', ()=>{
    Object.defineProperty(h.window.navigator, 'clipboard', {configurable:true, value:undefined});
    api.openGConnect();
    h.click('[data-ui="gc-copy"]');
    expect(h.lastToast()).toContain('Selected');
  });
});

/* ======================================================================= */
d('connecting from the dialog [' + TARGET + ']', ()=>{

  it('paste, click, connected — and the id is kept', async ()=>{
    const st=stubs({items:[gEvent({id:'e1'})]});
    h.click('#btnCal');
    h.type('#gcId', ID);
    h.click(cbtn());
    expect(api.gcState().busy).toBe(true);
    expect(cbtn().textContent).toContain('Waiting for Google');
    expect(cbtn().disabled).toBe(true);
    await until(()=>face()==='linked');
    expect(face()).toBe('linked');
    expect(api.gmeta().enabled).toBe(true);
    expect(api.gmeta().clientId).toBe(ID);
    expect(modal()).toContain('grey@example.com');
    expect(modal()).toContain('primary');
    expect(st.lists.length).toBeGreaterThan(0);
    expect(h.lastToast()).toContain('Connected as grey@example.com');
    expect(calb().dataset.state).toBe('good');
    expect(h.window.google.__calls[0].prompt).toBe('consent');
    expect(h.window.google.__calls[0].client_id).toBe(ID);
  });

  it('Enter in the id field connects', async ()=>{
    stubs();
    api.openGConnect();
    h.type('#gcId', ID);
    h.key('#gcId', 'Enter');
    await until(()=>face()==='linked');
    expect(api.gmeta().enabled).toBe(true);
  });

  it('Enter does nothing while the id is unusable', ()=>{
    stubs();
    api.openGConnect();
    h.type('#gcId', 'GOCSPX-nope');
    h.key('#gcId', 'Enter');
    expect(api.gcState().busy).toBe(false);
    expect(api.gmeta().clientId||'').toBe('');
  });

  it('a saved id skips straight to one button', async ()=>{
    api.gmeta().clientId=ID; api.save();
    stubs();
    api.openGConnect();
    expect(face()).toBe('ready');
    expect(h.$('#gcId')).toBe(null);
    expect(modal()).toContain(ID);
    h.click(cbtn());
    await until(()=>face()==='linked');
    expect(api.gmeta().enabled).toBe(true);
  });

  it('Change goes back to the id field, and Back returns', ()=>{
    api.gmeta().clientId=ID; api.save();
    api.openGConnect();
    h.click('[data-ui="gc-edit"]');
    expect(face()).toBe('setup');
    expect(h.$('#gcId').value).toBe(ID);
    h.click('[data-ui="gc-edit-cancel"]');
    expect(face()).toBe('ready');
  });

  it('a different calendar id is taken, and invalidates the sync cursor', async ()=>{
    api.gmeta().clientId=ID; api.save();
    api.gCursorSet({token:'old-token'});
    stubs();
    api.openGConnect();
    h.type('#gcCal', 'work@group.calendar.google.com');
    api.gcReadFields();
    expect(api.gmeta().calendarId).toBe('work@group.calendar.google.com');
    expect(api.gCursor().token).toBe(null);
  });

  it('a dismissed sign-in keeps the dialog open and says what to check', async ()=>{
    stubs({}, {fail:'popup_closed'});
    api.openGConnect();
    h.type('#gcId', ID);
    h.click(cbtn());
    await until(()=>!api.gcState().busy);
    expect(face()).toBe('setup');
    expect(api.gmeta().enabled).toBe(false);
    const err=h.$('.gcerr');
    expect(err).toBeTruthy();
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.textContent).toContain('popup_closed');
    expect(err.textContent).toContain('pop-ups');
    expect(err.textContent).toContain('Test users');
    expect(err.textContent).toContain(h.window.location.origin);
    expect(cbtn().disabled).toBe(false);          // free to try again
    expect(h.$('#gcId').value).toBe(ID);          // and nothing retyped
  });

  it('a hostile account name renders as text', async ()=>{
    stubs({email:'<img src=x onerror="window.__pwn=1">'});
    api.gmeta().clientId=ID;
    api.openGConnect();
    h.click(cbtn());
    await until(()=>face()==='linked');
    expect(h.$('.modal img')).toBe(null);
    expect(modal()).toContain('<img');
    expect(h.window.__pwn).toBeUndefined();
  });

  it('closing mid-connect still finishes, and says so in a toast', async ()=>{
    stubs();
    api.gmeta().clientId=ID;
    api.openGConnect();
    h.click(cbtn());
    api.closeModal();
    await until(()=>api.gmeta().enabled);
    await until(()=>h.lastToast().includes('Connected'));
    expect(h.$('#gcBody')).toBe(null);            // didn't reopen itself
    expect(calb().dataset.state).toBe('good');
  });
});

/* ======================================================================= */
d('once connected [' + TARGET + ']', ()=>{

  async function linked(state={}){
    const st=stubs(state);
    api.gmeta().clientId=ID;
    await api.gConnect(); api.render();
    api.openGConnect();
    return st;
  }

  it('Sync now pulls again', async ()=>{
    const st=await linked();
    const before=st.lists.length;
    h.click('[data-ui="gc-sync"]');
    await until(()=>h.lastToast().includes('synced'));
    expect(st.lists.length).toBeGreaterThan(before);
    expect(face()).toBe('linked');
  });

  it('Disconnect arms before it fires, and the header goes back to asking', async ()=>{
    await linked();
    h.click('[data-ui="gc-off"]');
    expect(api.gmeta().enabled).toBe(true);
    expect(h.text('[data-ui="gc-off"]')).toContain('Really');
    h.click('[data-ui="gc-off"]');
    expect(api.gmeta().enabled).toBe(false);
    expect(face()).toBe('ready');                 // the id is kept, so reconnecting is one click
    expect(calb().dataset.state).toBe('off');
  });

  it('an expired session offers Reconnect in place of Sync', async ()=>{
    const st=await linked();
    await goStale(st);
    api.openGConnect();
    expect(h.$('[data-ui="gc-sync"]')).toBe(null);
    expect(cbtn().textContent).toContain('Reconnect');
    expect(modal()).toContain('Access expired');
    h.click(cbtn());
    await until(()=>!api.gcState().busy);
    expect(api.GSTATE).toBe('ready');
  });
});

/* ======================================================================= */
d('from Settings [' + TARGET + ']', ()=>{

  it('offers the walkthrough, carrying a half-typed id across', ()=>{
    api.openPrefs();
    h.type('#pfGId', ID);
    h.click('[data-ui="gc-open"]');
    expect(h.$('#pfMode')).toBe(null);            // Settings gave way to the dialog
    expect(face()).toBe('ready');
    expect(api.gmeta().clientId).toBe(ID);
  });

  it('Settings\' own connect path is unchanged', ()=>{
    api.openPrefs();
    expect(h.$('[data-ui="g-connect"]')).toBeTruthy();
    expect(h.$('[data-ui="g-connect"]').disabled).toBe(true);
  });
});
