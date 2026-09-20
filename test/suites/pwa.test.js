/* ===========================================================================
   pwa — the service-worker registration guard, and notification scheduling
   ---------------------------------------------------------------------------
   Two things live here, and they are here rather than in tests/mobile because
   neither needs layout and both need to be driven at arbitrary clock times.

   The guard, because "register a service worker" has four different wrong
   answers (no API, file://, an insecure origin, a rejected registration) and
   each of them has to turn into something Settings can say out loud rather than
   a dead switch and a console warning.

   The scheduling, because notifPlan() is a pure function of the database and a
   timestamp. It decides what *should* have fired by a given moment; notifTick()
   is the thin part that shows them and writes down that it did. Testing the
   pure half means the 15-minute lead, the 24-hour hard clock and the
   fire-once rule are provable without a browser that can show a notification.
=========================================================================== */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, tinyDB, makeGoal } from '../harness.js';

let h, api;

/* jsdom has no Notification, which is itself one of the states under test, so
   it is installed explicitly rather than left to the environment. */
function notifStub(win, {permission='granted', answer='granted'}={}){
  const shown=[], asked=[];
  function N(title, opts){ shown.push({title, ...(opts||{})}); }
  N.permission = permission;
  N.requestPermission = cb => { asked.push(1);
    const p = Promise.resolve(N.__answer ?? answer);
    if (typeof cb === 'function') p.then(cb);
    return p; };
  win.Notification = N;
  return {shown, asked, N};
}

/* A step with a real slot on a real day, so the 15-minute lead has something to
   count down to. Returns the wall-clock ms of the slot's start. */
function scheduledStep(at /* minutes since midnight */, day = null){
  const made = tinyDB(api, a => makeGoal(a, {title:'Ship the thing', type:'milestone',
                                             step:'Wire the pipeline'}));
  const k = day || api.today();
  api.CAL.anchor(made.goal, made.thread, made.step, k, at, 45);
  api.save();
  return { ...made, dateKey:k, start:at,
           atMs: api.parseKey(k).getTime() + at*60000 };
}

beforeEach(async () => {
  h = await boot({seed:false});
  api = h.api;
  h.forbidNatives();
});
afterEach(() => { try{ api.notifStop(); }catch(_){}
                  try{ api.gStop(); }catch(_){}
                  try{ h.close(); }catch(_){} });

/* ======================================================================= */
describe('the service worker registration guard', () => {

  const nav = has => (has ? {serviceWorker:{register(){}}} : {});

  it('refuses when the browser has no service worker at all', () => {
    expect(api.swBlockedBecause({protocol:'https:', hostname:'ply.example'}, nav(false)))
      .toBe('unsupported');
  });

  it('refuses a file:// build, which is the one Ply ships as a single file', () => {
    expect(api.swBlockedBecause({protocol:'file:', hostname:''}, nav(true))).toBe('file');
  });

  it('refuses a plain-http origin that is not local', () => {
    expect(api.swBlockedBecause({protocol:'http:', hostname:'ply.example'}, nav(true)))
      .toBe('insecure');
  });

  it('allows https anywhere', () => {
    expect(api.swBlockedBecause({protocol:'https:', hostname:'grey.github.io'}, nav(true)))
      .toBe(null);
  });

  it('allows the three shapes of localhost, because npm run serve is one of them', () => {
    for (const hostname of ['localhost','127.0.0.1','::1','ply.localhost'])
      expect(api.swBlockedBecause({protocol:'http:', hostname}, nav(true))).toBe(null);
  });

  it('has a sentence for every reason it can give', () => {
    for (const why of ['unsupported','file','insecure','error'])
      expect(typeof api.SW_WHY[why]).toBe('string');
  });

  it('resolves rather than throwing when it is blocked, and never touches navigator', async () => {
    // jsdom has no navigator.serviceWorker, so this is the real blocked path
    const r = await api.registerSW();
    expect(r.ok).toBe(false);
    expect(r.why).toBe('unsupported');
  });

  it('stamps the registration URL with SCHEMA, so new data means a new cache', async () => {
    const seen = [];
    h.window.navigator.serviceWorker = {
      register(url, opts){ seen.push({url, opts}); return Promise.resolve({scope:'./', active:{}}); }
    };
    const r = await api.registerSW();
    expect(r.ok).toBe(true);
    expect(seen).toHaveLength(1);
    const q = new URL(seen[0].url, 'https://x/').searchParams;
    expect(q.get('schema')).toBe(String(api.SCHEMA));
    expect(q.get('build')).toBe(api.BUILD);
    expect(seen[0].opts.scope).toBe('./');
    delete h.window.navigator.serviceWorker;
  });

  it('swallows a rejected registration instead of leaving an unhandled promise', async () => {
    h.window.navigator.serviceWorker = { register: () => Promise.reject(new Error('nope')) };
    const r = await api.registerSW();
    expect(r.ok).toBe(false);
    expect(r.why).toBe('error');
    expect(r.error).toBe('nope');
    delete h.window.navigator.serviceWorker;
  });
});

/* ======================================================================= */
describe('what the app asks for, and when', () => {

  it('never asks for notification permission on load', async () => {
    const stub = notifStub(h.window, {permission:'default'});
    const fresh = await boot({seed:true});
    expect(stub.asked).toHaveLength(0);
    fresh.close();
  });

  it('starts with notifications off, whatever the browser already granted', () => {
    notifStub(h.window, {permission:'granted'});
    expect(api.notifWanted()).toBe(false);
    expect(api.notifOn()).toBe(false);
  });

  it('asks only when the toggle does, and only stores the answer when it is yes', async () => {
    const stub = notifStub(h.window, {permission:'default', answer:'denied'});
    expect(await api.notifEnable()).toBe('denied');
    expect(stub.asked).toHaveLength(1);
    expect(api.DB.meta.notify).toBe(false);

    stub.N.__answer = 'granted';
    expect(await api.notifEnable()).toBe('granted');
    expect(api.DB.meta.notify).toBe(true);
  });

  it('does not re-ask when the browser has already said no', async () => {
    const stub = notifStub(h.window, {permission:'denied'});
    expect(await api.notifEnable()).toBe('denied');
    expect(stub.asked).toHaveLength(0);
    expect(api.DB.meta.notify).toBe(false);
  });

  it('says so plainly instead of throwing where there is no Notification API', async () => {
    delete h.window.Notification;
    expect(api.notifPerm()).toBe('unsupported');
    expect(await api.notifEnable()).toBe('unsupported');
    expect(api.notifPrefsHTML()).toContain('no Notifications API');
  });

  it('turning it off stops the timer and clears the stored answer', async () => {
    notifStub(h.window);
    await api.notifEnable();
    expect(api.notifStart()).toBe(false);      // already running after enable
    api.notifDisable();
    expect(api.DB.meta.notify).toBe(false);
    expect(api.NOTIF_TIMER).toBe(null);
  });
});

/* ======================================================================= */
describe('a step starting in fifteen minutes', () => {

  beforeEach(() => notifStub(h.window));

  it('fires at the lead time and not before', () => {
    const s = scheduledStep(14*60);                        // 2pm
    api.DB.meta.notify = true;
    const lead = api.NOTIF_LEAD_MIN*60000;

    expect(api.notifPlan(s.atMs - lead - 60000).filter(n=>n.kind==='step')).toHaveLength(0);
    const due = api.notifPlan(s.atMs - lead + 1000).filter(n=>n.kind==='step');
    expect(due).toHaveLength(1);
    expect(due[0].body).toContain('Wire the pipeline');
    expect(due[0].body).toContain('2pm');
    expect(due[0].title).toBe(api.shortName(s.goal));
  });

  it('gives up rather than arriving an hour late, so a woken phone is not a pile', () => {
    const s = scheduledStep(14*60);
    api.DB.meta.notify = true;
    const at = s.atMs - api.NOTIF_LEAD_MIN*60000;
    expect(api.notifPlan(at + (api.NOTIF_WINDOW_MIN-1)*60000).filter(n=>n.kind==='step')).toHaveLength(1);
    expect(api.notifPlan(at + (api.NOTIF_WINDOW_MIN+1)*60000).filter(n=>n.kind==='step')).toHaveLength(0);
  });

  it('says nothing about an all-day slot, which has no start to warn about', () => {
    const s = scheduledStep(9*60);
    api.eventById(s.step.eventId).allDay = true;
    api.save();
    api.DB.meta.notify = true;
    const at = s.atMs - api.NOTIF_LEAD_MIN*60000;
    expect(api.notifPlan(at + 1000).filter(n=>n.kind==='step')).toHaveLength(0);
  });

  it('says nothing about a step whose slot Google deleted — that is a signal, not an alarm', () => {
    const s = scheduledStep(9*60);
    const ev = api.eventById(s.step.eventId);
    ev.gcal = {id:'g-1', etag:null, updated:null, cal:'primary', own:true,
               status:'cancelled', link:null, pending:false};
    ev.src = 'google';
    api.save();
    api.DB.meta.notify = true;
    const at = s.atMs - api.NOTIF_LEAD_MIN*60000;
    expect(api.notifPlan(at + 1000).filter(n=>n.kind==='step')).toHaveLength(0);
  });
});

/* ======================================================================= */
describe('a hard signal that has been hard for a day', () => {

  beforeEach(() => notifStub(h.window));

  /* A goal with no next step is hard immediately, which makes it the cleanest
     subject: the clock, not the condition, is what is under test. */
  function hardSubject(){
    return tinyDB(api, a => makeGoal(a, {title:'Renew the domain', type:'deadline', step:null}));
  }

  it('starts the clock on first sighting and fires nothing yet', () => {
    hardSubject();
    api.DB.meta.notify = true;
    const t0 = Date.now();
    expect(api.notifPlan(t0).filter(n=>n.kind==='hard')).toHaveLength(0);
    expect(Object.keys(api.DB.meta.sigHardSince)).not.toHaveLength(0);
  });

  it('fires once the day is up, and not at twenty-three hours', () => {
    hardSubject();
    api.DB.meta.notify = true;
    const t0 = Date.now();
    api.notifPlan(t0);                                  // first sighting
    expect(api.notifPlan(t0 + 23*3600e3).filter(n=>n.kind==='hard')).toHaveLength(0);
    const due = api.notifPlan(t0 + 25*3600e3).filter(n=>n.kind==='hard');
    expect(due.length).toBeGreaterThan(0);
    expect(due[0].body).toContain('a full day');
  });

  it('restarts the clock when the signal clears, rather than firing the moment it breaks again', () => {
    const made = hardSubject();
    api.DB.meta.notify = true;
    const t0 = Date.now();
    api.notifPlan(t0);
    const first = {...api.DB.meta.sigHardSince};
    expect(Object.keys(first).length).toBeGreaterThan(0);

    // give it a next step: the signal goes away, and so does its clock
    made.thread.steps.push(api.newStep('Actually renew it'));
    api.save();
    api.notifPlan(t0 + 3600e3);
    expect(api.DB.meta.sigHardSince).toEqual({});

    // break it again — twenty-five hours after the *original* sighting is still
    // nothing, because this is a new signal with a new clock
    made.thread.steps = [];
    api.save();
    api.notifPlan(t0 + 2*3600e3);
    expect(api.notifPlan(t0 + 25*3600e3).filter(n=>n.kind==='hard')).toHaveLength(0);
    expect(api.notifPlan(t0 + 27*3600e3).filter(n=>n.kind==='hard').length).toBeGreaterThan(0);
  });

  it('leaves warnings alone — only hard signals are worth an interruption', () => {
    // a blocked thread is a warn, not a hard
    tinyDB(api, a => {
      const m = makeGoal(a, {title:'Waiting on legal', type:'milestone', step:'Get sign-off'});
      m.thread.status = 'blocked';
      m.thread.blockedOn = 'legal';
      m.thread.blockedSince = new Date(Date.now() - 30*86400e3).toISOString();
    });
    api.DB.meta.notify = true;
    const t0 = Date.now();
    api.notifPlan(t0);
    expect(api.notifPlan(t0 + 48*3600e3).filter(n=>n.kind==='hard')).toHaveLength(0);
  });
});

/* ======================================================================= */
describe('the check-in, when it is due', () => {

  beforeEach(() => notifStub(h.window));

  it('is offered once and carries the size of the queue', () => {
    tinyDB(api, a => makeGoal(a, {title:'Ship the thing', type:'milestone', step:'Wire it'}));
    api.DB.meta.lastCheckin = null;
    api.save();
    api.DB.meta.notify = true;
    const due = api.notifPlan(Date.now()).filter(n=>n.kind==='checkin');
    expect(due).toHaveLength(1);
    expect(due[0].key).toBe('checkin:' + api.today());
    expect(due[0].title).toBe('Weekly check-in');
  });

  it('says nothing when the check-in is not due', () => {
    tinyDB(api, a => makeGoal(a, {title:'Ship the thing', type:'milestone', step:'Wire it'}));
    api.DB.meta.lastCheckin = api.today();
    api.save();
    api.DB.meta.notify = true;
    expect(api.notifPlan(Date.now()).filter(n=>n.kind==='checkin')).toHaveLength(0);
  });
});

/* ======================================================================= */
describe('firing, once', () => {

  it('shows nothing at all while the toggle is off', () => {
    notifStub(h.window);
    scheduledStep(14*60);
    expect(api.notifTick(Date.now())).toEqual([]);
  });

  it('shows nothing while the browser has not granted permission', () => {
    notifStub(h.window, {permission:'default'});
    const s = scheduledStep(14*60);
    api.DB.meta.notify = true;                 // wanted, but not granted
    expect(api.notifOn()).toBe(false);
    expect(api.notifTick(s.atMs - api.NOTIF_LEAD_MIN*60000 + 1000)).toEqual([]);
  });

  it('fires each notification exactly once, however often the tick runs', () => {
    const stub = notifStub(h.window);
    const s = scheduledStep(14*60);
    api.DB.meta.notify = true;
    const at = s.atMs - api.NOTIF_LEAD_MIN*60000 + 1000;

    expect(api.notifTick(at).filter(n=>n.kind==='step')).toHaveLength(1);
    expect(api.notifTick(at + 60000).filter(n=>n.kind==='step')).toHaveLength(0);
    expect(api.notifTick(at + 120000).filter(n=>n.kind==='step')).toHaveLength(0);
    expect(stub.shown.filter(n=>/Wire the pipeline/.test(n.body||''))).toHaveLength(1);
  });

  it('survives a reload, because what fired is in the database and not in memory', async () => {
    notifStub(h.window);
    const s = scheduledStep(14*60);
    api.DB.meta.notify = true;
    const at = s.atMs - api.NOTIF_LEAD_MIN*60000 + 1000;
    api.notifTick(at);
    const saved = JSON.stringify(api.DB);

    const again = await boot({stored: saved});
    notifStub(again.window);
    expect(again.api.notifTick(at + 30000)).toEqual([]);
    again.close();
  });

  it('hands the notification to the service worker when there is one', () => {
    const stub = notifStub(h.window);
    const viaSW = [];
    api.SWREG = { showNotification: (title, opts) => { viaSW.push({title, ...opts}); } };
    const s = scheduledStep(14*60);
    api.DB.meta.notify = true;
    api.notifTick(s.atMs - api.NOTIF_LEAD_MIN*60000 + 1000);
    const step = viaSW.filter(n => n.data.kind === 'step');
    expect(step).toHaveLength(1);
    expect(stub.shown).toHaveLength(0);          // the page's own Notification stays unused
    expect(step[0].body).toContain('Wire the pipeline');
    api.SWREG = null;
  });

  it('prunes its own record rather than growing a log forever', () => {
    notifStub(h.window);
    tinyDB(api, a => makeGoal(a, {title:'A goal', type:'milestone', step:'A step'}));
    const now = Date.now();
    api.notifMark('old-one', now - 30*864e5);
    api.notifMark('recent-one', now);
    expect(api.notifSentList().map(x=>x.k)).toEqual(['recent-one']);
    expect(api.notifAlreadySent('recent-one')).toBe(true);
    expect(api.notifAlreadySent('old-one')).toBe(false);
  });
});

/* ======================================================================= */
describe('the install hint', () => {

  it('says nothing until the browser has actually offered', () => {
    expect(api.installHint()).toBe(null);
    expect(h.$('#installbar')).toBe(null);
  });

  it('appears under the ribbon once beforeinstallprompt has fired, never over capture', () => {
    api.INSTALL_EVT = {prompt(){}, userChoice: Promise.resolve({outcome:'accepted'})};
    api.renderInstallBar();
    const bar = h.$('#installbar');
    expect(bar).not.toBe(null);
    expect(bar.previousElementSibling.id).toBe('signals');
    expect(h.$('#capture').compareDocumentPosition(bar) & 4).toBeTruthy();  // bar comes after
    api.INSTALL_EVT = null;
  });

  it('is dismissible, and stays dismissed', () => {
    api.INSTALL_EVT = {prompt(){}, userChoice: Promise.resolve({outcome:'dismissed'})};
    api.renderInstallBar();
    h.click('[data-ui="pwa-later"]');
    expect(api.DB.meta.installHidden).toBe(true);
    expect(h.$('#installbar')).toBe(null);
    api.renderInstallBar();
    expect(h.$('#installbar')).toBe(null);
    api.INSTALL_EVT = null;
  });

  it('consumes the event when accepted, so the offer cannot be taken twice', async () => {
    let prompted = 0;
    api.INSTALL_EVT = {prompt(){ prompted++; }, userChoice: Promise.resolve({outcome:'accepted'})};
    expect(await api.doInstall()).toBe('accepted');
    expect(prompted).toBe(1);
    expect(await api.doInstall()).toBe('unavailable');
  });
});

/* ======================================================================= */
describe('where a shortcut and a tapped notification land', () => {

  it('?go=capture puts the caret in the capture field', () => {
    expect(api.plyGoTo('capture')).toBe(true);
    expect(h.document.activeElement.id).toBe('capture');
  });

  it('?go=checkin opens the check-in', () => {
    tinyDB(api, a => makeGoal(a, {title:'Ship the thing', type:'milestone', step:'Wire it'}));
    expect(api.plyGoTo('checkin')).toBe(true);
    expect(h.$('.scrim')).not.toBe(null);
    api.closeModal();
  });

  it('refuses to stack a check-in on top of an open dialog', () => {
    tinyDB(api, a => makeGoal(a, {title:'Ship the thing', type:'milestone', step:'Wire it'}));
    api.openPrefs();
    api.plyGoTo('checkin');
    expect(h.$$('.scrim')).toHaveLength(1);
    api.closeModal();
  });

  it('ignores a name it does not know', () => {
    expect(api.plyGoTo('nonsense')).toBe(false);
  });
});

/* ======================================================================= */
describe('the toast is a live region', () => {
  it('announces politely without stealing focus', () => {
    const t = h.$('#toast');
    expect(t.getAttribute('role')).toBe('status');
    expect(t.getAttribute('aria-live')).toBe('polite');
    expect(t.getAttribute('aria-atomic')).toBe('true');
    api.toast('Scheduled for 2pm');
    expect(t.textContent).toBe('Scheduled for 2pm');
    expect(h.document.activeElement).not.toBe(t);
  });
});
