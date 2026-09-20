import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import { legacyBridgeSource } from './bridge.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* The migrated tree is the default target once it exists. Until src/main.js is
   there, asking for it would fail every suite for a reason that has nothing to do
   with the behaviour under test, so the monolith is the default instead. */
const HAS_SRC = fs.existsSync(path.join(ROOT, 'src', 'main.js'));
export const TARGET = process.env.PLY_TARGET || (HAS_SRC ? 'src' : 'legacy');
export const isLegacy = TARGET !== 'src';

/* ---------------------------------------------------------------------------
   jsdom has no layout engine, so a handful of things the app calls are simply
   absent. Stubbing them is the documented approach from the original suites
   ("jsdom has no layout, so elementFromPoint is stubbed"): the handler logic is
   what's under test, the geometry isn't.
--------------------------------------------------------------------------- */
export function stubLayout(win){
  const doc = win.document;

  // elementFromPoint: jsdom throws "not implemented". Drive it from a registry the
  // drag tests populate, so a drop can be aimed at a specific element by id.
  win.__hit = null;
  doc.elementFromPoint = (x, y) => {
    if (typeof win.__hit === 'function') return win.__hit(x, y);
    return win.__hit || null;
  };

  // Every rect is 0x0 without layout, which would make calMinAt() always return
  // the start of the day. Let a test declare a rect for an element instead.
  const proto = win.Element.prototype;
  const realRect = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function(){
    if (this.__rect) return this.__rect;
    return realRect ? realRect.call(this) : {x:0,y:0,width:0,height:0,top:0,left:0,right:0,bottom:0};
  };

  // offsetParent is null for everything in jsdom, which would empty the focus
  // trap's candidate list. Treat anything attached to the document as visible.
  if (!Object.getOwnPropertyDescriptor(win.HTMLElement.prototype, '__offsetPatched')) {
    Object.defineProperty(win.HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get(){ return this.isConnected && !this.hidden ? (this.parentElement || this.ownerDocument.body) : null; }
    });
    Object.defineProperty(win.HTMLElement.prototype, '__offsetPatched', {value:true});
  }

  if (!proto.setPointerCapture) proto.setPointerCapture = function(){};
  if (!proto.releasePointerCapture) proto.releasePointerCapture = function(){};

  // exportJSON() reaches for both of these.
  win.URL.createObjectURL = win.URL.createObjectURL || (()=> 'blob:stub');
  win.URL.revokeObjectURL = win.URL.revokeObjectURL || (()=>{});

  // Native dialogs must never be reachable — the "no browser dialogs" suite
  // asserts this by driving every flow with them armed to throw.
  return win;
}

/* Every flow is driven with the natives armed to throw, which is how the suite
   proves they are gone rather than merely unused on the happy path. */
export function forbidNativeDialogs(win){
  const boom = name => () => { throw new Error('native '+name+'() was called'); };
  win.prompt  = boom('prompt');
  win.confirm = boom('confirm');
  win.alert   = boom('alert');
}

export function readLegacyHTML(){
  return fs.readFileSync(path.join(ROOT, 'legacy', 'index.html'), 'utf8');
}
export function readAppHTML(){
  const p = path.join(ROOT, 'index.html');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : readLegacyHTML();
}

/* The markup the app renders into. Taken from whichever index.html is the live
   entry, minus its scripts, so the shell can never drift from the real one. */
export function appShell(html){
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  return (body ? body[1] : '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .trim();
}

let seq = 0;

/* ---------------------------------------------------------------------------
   Teardown between boots.

   The monolith gets a brand-new jsdom per boot, so nothing from the previous
   test can still be listening. The migrated tree shares one document across a
   file's tests, so listeners on window/document and any interval a boot started
   (the Google poll, the notification tick) would pile up: an old instance keeps
   answering events, holding the leader lease and writing to a database the
   current test has replaced.

   Everything registered on window or document is recorded and removed before the
   next boot, which puts the two targets on equal footing.
--------------------------------------------------------------------------- */
let wired = [];
let timers = [];
let patched = false;

function trackGlobals(win){
  if (patched) return;
  patched = true;
  for (const target of [win, win.document]){
    const add = target.addEventListener.bind(target);
    target.addEventListener = (type, fn, opts) => { wired.push([target, type, fn, opts]); return add(type, fn, opts); };
  }
  const setI = win.setInterval.bind(win);
  win.setInterval = (fn, ms, ...rest) => { const id = setI(fn, ms, ...rest); timers.push(id); return id; };
}

function teardownPrevious(win){
  for (const [target, type, fn, opts] of wired){
    try { target.removeEventListener(type, fn, opts); } catch(_) {}
  }
  wired = [];
  for (const id of timers) { try { win.clearInterval(id); } catch(_) {} }
  timers = [];
}

/* ---------------------------------------------------------------------------
   boot() — a fresh app, either target, same handle back.

   opts.seed   true  (default) demo data, as a first run gives you
               false            a clean blankDB
               fn               called with the api to build the DB itself
   opts.stored a JSON string parked in localStorage before load() runs
   opts.key    which localStorage key opts.stored goes under
--------------------------------------------------------------------------- */
export async function boot(opts = {}){
  const { seed = true, stored = null, key = 'ply.v1', legacyDate = null } = opts;
  return isLegacy ? bootLegacy({seed, stored, key, legacyDate})
                  : bootSrc({seed, stored, key, legacyDate});
}

async function bootLegacy({seed, stored, key}){
  const { JSDOM } = await import('jsdom');
  /* legacy/index.html IS the monolith now. Up to the split it was the live
     index.html that was being edited, so this read the live entry; from the
     split on, index.html is the Vite entry and carries no inline script, and the
     monolith the suites are pinned against lives here. It is the last
     single-file build — schema 7, Google provider and PWA included — kept so the
     same suite can still be run against it. */
  let html = readLegacyHTML();
  const bridge = `<script>${legacyBridgeSource()}</script>`;

  // localStorage has to be populated before the app's own script runs, so the
  // seeding script goes in ahead of it.
  const pre = stored
    ? `<script>try{localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(stored)});}catch(e){}</script>`
    : `<script>try{localStorage.clear();}catch(e){}</script>`;
  html = html.replace('<script>', pre + '<script>');
  html = html.replace('</body>', bridge + '</body>');

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://localhost/ply-' + (++seq) + '/',
    pretendToBeVisual: true
  });
  const win = dom.window;
  stubLayout(win);
  const api = win.__ply;
  finishBoot(api, win, {seed, stored});
  return wrap(api, win, dom);
}

async function bootSrc({seed, stored, key}){
  const win = globalThis.window;
  stubLayout(win);
  trackGlobals(win);
  teardownPrevious(win);

  /* Let the previous instance's in-flight work finish before wiping storage.
     A boot that left a sync in flight will still write its leader lease when the
     promise settles; if that lands after the clear, the NEXT instance sees a
     foreign lease, decides another tab owns the pull, and quietly syncs nothing.
     The monolith never had this because each boot got its own jsdom, and its own
     localStorage with it. */
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));

  try { win.localStorage.clear(); } catch(_) {}
  if (stored) { try { win.localStorage.setItem(key, stored); } catch(_) {} }

  // A fresh module graph per boot: the store holds DB at module scope, so without
  // this the second test in a file would inherit the first one's database.
  vi.resetModules();
  win.document.body.innerHTML = appShell(readAppHTML());
  win.document.body.className = '';

  /* main.js boots itself when the browser loads it. Here the harness calls
     bootstrap() explicitly, so the self-boot has to be off or every listener is
     registered twice and each action runs twice. */
  win.__PLY_NO_AUTOBOOT = true;

  /* Boot schedules a couple of deferred nudges (the check-in toast at 700ms).
     In the monolith each boot got its own jsdom, so those died with it; here one
     document is shared across a file's tests and a stale nudge would overwrite
     the toast a later test is reading. Collect and cancel them. */
  const realSetTimeout = win.setTimeout;
  const pending = [];
  win.setTimeout = (fn, ms, ...rest) => { const id = realSetTimeout(fn, ms, ...rest); pending.push(id); return id; };

  const mod = await import('../src/main.js?boot=' + (++seq));
  const api = mod.bootstrap();

  win.setTimeout = realSetTimeout;
  for (const id of pending) win.clearTimeout(id);
  win.__ply = api;
  finishBoot(api, win, {seed, stored});
  return wrap(api, win, null);
}

function finishBoot(api, win, {seed, stored}){
  if (typeof seed === 'function'){
    api.DB = api.blankDB();
    api.DB.meta.cursor = api.today();
    seed(api);
    api.save();
    api.render();
  } else if (seed === false && !stored){
    api.DB = api.blankDB();
    api.DB.meta.cursor = api.today();
    api.save();
    api.render();
  }
}

function wrap(api, win, dom){
  const doc = win.document;
  const h = {
    api, ply: api, window: win, document: doc, dom,
    $:  (s, r=doc) => r.querySelector(s),
    $$: (s, r=doc) => [...r.querySelectorAll(s)],
    text: (s, r=doc) => { const e = r.querySelector(s); return e ? e.textContent.trim() : null; },

    /* click something the way a person would: the real listener chain, plus a
       tick for the deferred undo commit to land. */
    click(target, init={}){
      const el = typeof target === 'string' ? doc.querySelector(target) : target;
      if (!el) throw new Error('nothing to click for ' + target);
      el.dispatchEvent(new win.MouseEvent('click', {bubbles:true, cancelable:true, ...init}));
      return el;
    },
    key(target, key, init={}){
      const el = typeof target === 'string' ? doc.querySelector(target) : target;
      (el || doc).dispatchEvent(new win.KeyboardEvent('keydown',
        {key, bubbles:true, cancelable:true, ...init}));
    },
    type(target, value){
      const el = typeof target === 'string' ? doc.querySelector(target) : target;
      if (!el) throw new Error('no field for ' + target);
      if (el.type === 'checkbox') el.checked = !!value; else el.value = value;
      el.dispatchEvent(new win.Event('input', {bubbles:true}));
      return el;
    },
    change(target, value){
      const el = h.type(target, value);
      el.dispatchEvent(new win.Event('change', {bubbles:true}));
      return el;
    },
    /* the deferred checkpoint commit runs on a timer */
    async settle(){ await new Promise(r => setTimeout(r, 0)); },

    /* pointer drags: jsdom has no PointerEvent, and the app only reads
       clientX/clientY/pointerId/pointerType/button off the event. */
    pointer(el, type, props={}){
      const ev = new win.Event(type, {bubbles:true, cancelable:true});
      Object.assign(ev, {clientX:0, clientY:0, pointerId:1, pointerType:'mouse', button:0}, props);
      el.dispatchEvent(ev);
      return ev;
    },
    aim(elOrFn){ win.__hit = elOrFn; },
    rect(el, r){ el.__rect = {x:0,y:0,top:0,left:0,right:0,bottom:0,width:0,height:0, ...r}; return el; },

    forbidNatives(){ forbidNativeDialogs(win); },
    lastToast(){ const t = doc.querySelector('#toast'); return t ? t.textContent : ''; },
    html(){ return doc.querySelector('#view').innerHTML; },
    close(){ if (dom) dom.window.close(); }
  };
  return h;
}

/* A deterministic little database, so tests that care about one rule aren't
   reading around eleven demo goals. */
export function tinyDB(api, build){
  api.DB = api.blankDB();
  api.DB.meta.cursor = api.today();
  api.DB.meta.lastCheckin = api.addDays(api.today(), -7);
  const made = build ? build(api) : null;
  api.save();
  return made;
}

/* goal + thread + live step in one line, for the many tests that need a subject
   rather than a scenario. */
export function makeGoal(api, o = {}){
  const g = api.newGoal({title: o.title || 'A goal', type: o.type || 'milestone', ...o.goal});
  const t = api.newThread({rel: o.rel || 'sequential', ...o.thread});
  if (o.step !== null) t.steps.push(api.newStep(o.step || 'The next move', o.stepOpts || {}));
  g.threads.push(t);
  api.DB.goals.push(g);
  return {goal: g, thread: t, step: t.steps[t.steps.length - 1]};
}

/* ---------------------------------------------------------------------------
   Google stubs. jsdom has no fetch and no Google Identity Services, which is
   precisely the shape the offline path expects, so both are installed
   explicitly rather than left to the environment.

   gFetch() is a tiny recording router: routes are matched in order, each one is
   a [predicate, handler] pair, and everything unmatched is a 404 so a test can
   never pass on a request it didn't mean to make.
--------------------------------------------------------------------------- */
export function gisStub(win, {token='tok-1', expires=3600, fail=null}={}){
  const calls=[];
  win.google = {accounts:{oauth2:{
    initTokenClient(cfg){
      const c={...cfg, requestAccessToken(o){
        calls.push({prompt:(o&&o.prompt)||'', scope:cfg.scope, client_id:cfg.client_id});
        setTimeout(()=>{
          if(fail) (c.error_callback||(()=>{}))({message:fail});
          else c.callback({access_token:(typeof token==='function'?token():token),
                           expires_in:expires, scope:cfg.scope, token_type:'Bearer'});
        },0);
      }};
      return c;
    },
    revoke(t,cb){ calls.push({revoked:t}); if(cb) cb(); }
  }}};
  win.google.__calls = calls;
  return calls;
}

export function fetchStub(win, routes=[]){
  const log=[];
  win.fetch = async (url, init={})=>{
    const u=String(url), method=(init.method||'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    const rec={url:u, method, body, auth:(init.headers||{}).Authorization||null};
    log.push(rec);
    for(const [match, handle] of win.fetch.routes){
      if(!match(u, method, rec)) continue;
      const r = typeof handle==='function' ? await handle(rec) : handle;
      if(r instanceof Error) throw r;
      const status = r.status || 200;
      return {
        ok: status>=200 && status<300, status,
        json: async ()=> r.body===undefined ? {} : r.body,
        text: async ()=> JSON.stringify(r.body||{})
      };
    }
    return {ok:false, status:404, json:async()=>({error:'no stub for '+method+' '+u}),
            text:async()=>'no stub'};
  };
  win.fetch.routes = routes;
  win.fetch.log = log;
  return win.fetch;
}

/* the shape Google returns for one event */
export function gEvent(o={}){
  const {id='g1', summary='Remote thing', date=null, start='2026-09-20T13:00:00-04:00',
         end='2026-09-20T14:00:00-04:00', updated='2026-09-19T10:00:00.000Z',
         status='confirmed', stepId=null, goalId=null, threadId=null, etag='"e1"'} = o;
  const ev={id, summary, status, updated, etag, htmlLink:'https://calendar.google.com/x/'+id};
  if(date){ ev.start={date}; ev.end={date}; }
  else { ev.start={dateTime:start, timeZone:'America/New_York'};
         ev.end={dateTime:end, timeZone:'America/New_York'}; }
  if(stepId) ev.extendedProperties={private:{plyStepId:stepId, plyGoalId:goalId||'', plyThreadId:threadId||'', plyV:'7'}};
  return ev;
}

