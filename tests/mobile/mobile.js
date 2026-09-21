#!/usr/bin/env node
/* =============================================================================
   tests/mobile/mobile.js — the real-phone pass.

   The vitest suites prove the rules. jsdom has no layout engine, so they can say
   nothing at all about whether Ply fits a phone; the README was honest about
   that and listed four surfaces — the Day matrix, the Week grid, the budget rows
   and the check-in cards — that had never been rendered at handset width, plus
   the fact that none of it had run on a device.

   This drives the real markup and the real stylesheet in Chromium at two real
   handset viewports and asserts the six things that were owed:

     1. no horizontal scroll, and nothing clipped out of reach inside a fixed
        overlay (which is worse than scrolling, and is what the goal editor did)
     2. every tap target at least 44px — the hit area, not the ink, so a control
        grown by an ::after inset counts as grown and a native checkbox is
        measured by the label that actually toggles it
     3. the day-strip drag and the matrix drag start from the grip under touch,
        and not from the card body, which has to stay a scroll
     4. the inline scheduling row still fits with the keyboard open
     5. the resolver under the ribbon doesn't push the view off-screen
     6. toasts don't cover the capture field

   It also asserts the two accessibility promises added alongside: the toast is
   a polite live region, and prefers-reduced-motion really does stop the motion
   rather than shortening it.

   Usage
     npm run test:mobile                      assert, and write tests/mobile/shots
     node tests/mobile/mobile.js --out DIR    shots somewhere else
     node tests/mobile/mobile.js --app FILE   render a different index.html
     node tests/mobile/mobile.js --no-assert  capture only, never exit non-zero
     node tests/mobile/mobile.js --grid FILE  also write a before/after grid page
============================================================================= */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { serve, ROOT } from './serve.js';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch (_) {
  console.error('playwright is not installed here. `npm i` then ' +
                '`npx playwright install chromium`, or run this in CI.');
  process.exit(2);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg  = (n, d) => { const i = argv.indexOf(n); return i < 0 ? d : argv[i + 1]; };
const OUT    = path.resolve(arg('--out', path.join(HERE, 'shots')));
const APP    = path.resolve(arg('--app', path.join(ROOT, 'index.html')));
const LABEL  = arg('--label', '');
const ASSERT = !argv.includes('--no-assert');

/* Two handsets in CSS pixels: the narrowest phone still worth supporting, and
   the one most people are actually holding. */
const VIEWPORTS = [
  { name: '375x812', width: 375, height: 812 },   // iPhone X / 11 Pro / 13 mini
  { name: '390x844', width: 390, height: 844 }    // iPhone 12–15
];

/* WCAG 2.2 AA says 24px. Apple says 44, Material says 48. Ply is a one-thumb
   app whose primary gesture is a drag, so 44. */
const MIN_TAP = 44;

/* The keyboard eats roughly half a phone. Chromium has no keyboard, so the
   viewport is cut to what would be left. */
const KEYBOARD_H = 360;

/* =============================== checks ================================== */

/* Horizontal scroll, and who caused it. "Something overflows" is not a bug
   report; ".brow at right:412 in a 375 viewport" is. Content inside its own
   horizontal scroller is excluded, because that is the design — the day strip
   is deliberately wider than the phone and scrolls within its box. */
const hscroll = page => page.evaluate(() => {
  const w = window.innerWidth;
  const over = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - w;
  const blame = [];
  if (over > 1) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      if (r.right <= w + 1 && r.left >= -1) continue;
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed') continue;
      let p = el.parentElement, contained = false;
      while (p && p !== document.body) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'auto' || o === 'scroll' || o === 'hidden') { contained = true; break; }
        p = p.parentElement;
      }
      if (contained) continue;
      blame.push({ sel: sig(el), right: Math.round(r.right), width: Math.round(r.width) });
    }
  }
  function sig(el){
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
      (typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '');
  }
  return { ok: over <= 1, over, blame: blame.slice(0, 8) };
});

/* Content clipped out of reach inside a fixed overlay. The document doesn't
   scroll for it, so the h-scroll check above is blind to it — which is exactly
   how a 750px goal editor survived inside a 327px scrim. */
const clipped = page => page.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll('.scrim > *, .menu, #dragGhost, .installbar')) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    if (r.right > window.innerWidth + 1 || r.left < -1)
      bad.push({ sel: el.className || el.id, left: Math.round(r.left),
                 right: Math.round(r.right), width: Math.round(r.width), vw: window.innerWidth });
  }
  return { ok: bad.length === 0, bad };
});

/* Tap targets.

   The coarse-pointer block deliberately grows the target rather than the ink,
   sometimes with an absolutely-positioned ::after — so the hit box is the union
   of the element's own rect and that pseudo's, and measuring only the element
   would fail controls that really are thumb-sized. A native checkbox can't
   carry a pseudo-element at all, so it is measured by the label that wraps it,
   because tapping that label is what toggles it. */
const TAPPABLE = [
  'button:not([disabled])', 'a[href]', 'input:not([type=hidden])', 'select', 'textarea',
  '.chk', '.subchk', '.grip', '.subgrip', '.sig', '.ltog', '.evchip', '.tchip',
  '[data-snooze]', '[data-fix]', '[data-act]', '[data-ui]', '[data-ck]', '[data-ge]', '[data-bud]'
].join(',');

const tapTargets = (page, min, scoped) => page.evaluate(({ sel, min, scoped }) => {
  /* When a dialog is open the page behind it is inert: auditing it would report
     the same background failures on every modal surface and drown the real ones. */
  const root = scoped && document.querySelector('.scrim') ? document.querySelector('.scrim') : document;
  const px = v => { const f = parseFloat(v); return Number.isFinite(f) ? f : 0; };
  const seen = new Set(), bad = [];
  let n = 0;
  for (const el of root.querySelectorAll(sel)) {
    if (seen.has(el)) continue; seen.add(el);
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    let r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;

    let target = el;
    const type = (el.getAttribute && el.getAttribute('type')) || '';
    if (el.tagName === 'INPUT' && (type === 'checkbox' || type === 'radio')) {
      const lab = el.closest('label');
      if (lab) { target = lab; r = lab.getBoundingClientRect(); }
    }
    let w = r.width, h = r.height;
    for (const pseudo of ['::after', '::before']) {
      const ps = getComputedStyle(target, pseudo);
      if (ps.content === 'none' || ps.position !== 'absolute') continue;
      const grow = -Math.min(px(ps.top), px(ps.left), px(ps.right), px(ps.bottom), 0);
      if (grow > 0) { w += grow * 2; h += grow * 2; }
    }
    n++;
    if (Math.min(w, h) < min - 0.5) {
      bad.push({ sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
                      (typeof el.className === 'string' && el.className.trim()
                        ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''),
                 w: Math.round(w), h: Math.round(h),
                 text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24) });
    }
  }
  return { ok: bad.length === 0, audited: n, bad };
}, { sel: TAPPABLE, min, scoped: scoped !== false });

/* ============================== surfaces ================================= */

const zoom = async (page, k) => {
  await page.evaluate(z => document.querySelector(`#zoombar [data-z="${z}"]`).click(), k);
  await page.waitForTimeout(90);
};

export const SURFACES = [
  { id: 'day',       title: 'Day — strip and matrix',   go: p => zoom(p, 'day') },
  { id: 'week',      title: 'Week — seven columns',     go: p => zoom(p, 'week') },
  { id: 'quarter',   title: 'Quarter — roadmap',        go: p => zoom(p, 'quarter') },
  { id: 'list',      title: 'List — rows and filters',  go: p => zoom(p, 'list') },
  { id: 'budget',    title: 'Week — budget rows',       go: async p => {
      await zoom(p, 'week');
      await p.evaluate(() => document.querySelector('.budget')?.scrollIntoView({ block: 'start' }));
      await p.waitForTimeout(80);
    } },
  { id: 'checkin',   title: 'Check-in — opening card',  go: async p => {
      await p.click('#btnCheckin'); await p.waitForTimeout(150);
    } },
  { id: 'checkin-2', title: 'Check-in — a question',    go: async p => {
      await p.click('#btnCheckin'); await p.waitForTimeout(150);
      const next = await p.$('[data-ck="next"], [data-ck="start"], .mfoot .btn.primary');
      if (next) { await next.click(); await p.waitForTimeout(150); }
    } },
  { id: 'goal',      title: 'Goal editor',              go: async p => {
      await zoom(p, 'day');
      const card = await p.$('.matrix .card .body');
      if (card) { await card.click(); await p.waitForTimeout(180); }
    } },
  { id: 'event',     title: 'Event modal',              go: async p => {
      await zoom(p, 'day');
      const ev = await p.$('.track .ev');
      if (ev) { await ev.click(); await p.waitForTimeout(180); }
    } },
  { id: 'settings',  title: 'Settings',                 go: async p => {
      await p.click('#btnMenu'); await p.waitForTimeout(70);
      await p.click('[data-m="prefs"]'); await p.waitForTimeout(180);
    } },
  { id: 'resolver',  title: 'Ribbon resolver',          go: async p => {
      await zoom(p, 'day');
      const sig = await p.$('.sig[data-sig]');
      if (sig) { await sig.click(); await p.waitForTimeout(180); }
    } }
];

/* ========================= behavioural checks ============================ */

/* Both halves of the touch rule matter: a touch that starts on the card body
   has to scroll the page, and a touch that starts on the grip has to drag. */
async function touchProbe(page, cardSel, gripSel){
  const card = await page.$(cardSel);
  if (!card) return { skipped: cardSel + ' not on this surface' };

  const fromBody = await page.evaluate(s => {
    const card = document.querySelector(s);
    const body = card.querySelector('.body, .lttl, .x') || card;
    const r = body.getBoundingClientRect();
    const mk = (t, x, y) => Object.assign(new Event(t, { bubbles: true, cancelable: true }),
      { clientX: x, clientY: y, pointerId: 71, pointerType: 'touch', button: 0 });
    card.dispatchEvent(mk('pointerdown', r.left + 12, r.top + 8));
    document.querySelector('#view').dispatchEvent(mk('pointermove', r.left + 70, r.top + 90));
    const dragging = !!document.getElementById('dragGhost');
    document.querySelector('#view').dispatchEvent(
      Object.assign(new Event('pointercancel', { bubbles: true }), { pointerId: 71, pointerType: 'touch' }));
    return dragging;
  }, cardSel);

  const grip = await page.$(gripSel);
  if (!grip) return { skipped: gripSel + ' missing', draggedFromBody: fromBody };
  const gb = await grip.boundingBox();

  const fromGrip = await page.evaluate(({ g, x, y }) => {
    const grip = document.querySelector(g);
    const mk = (t, cx, cy) => Object.assign(new Event(t, { bubbles: true, cancelable: true }),
      { clientX: cx, clientY: cy, pointerId: 72, pointerType: 'touch', button: 0 });
    grip.dispatchEvent(mk('pointerdown', x, y));
    document.querySelector('#view').dispatchEvent(mk('pointermove', x + 48, y + 70));
    const dragging = !!document.getElementById('dragGhost');
    document.querySelector('#view').dispatchEvent(
      Object.assign(new Event('pointercancel', { bubbles: true }), { pointerId: 72, pointerType: 'touch' }));
    return dragging;
  }, { g: gripSel, x: gb.x + gb.width / 2, y: gb.y + gb.height / 2 });

  return { draggedFromBody: fromBody, draggedFromGrip: fromGrip,
           gripW: Math.round(gb.width), gripH: Math.round(gb.height) };
}

async function checkTouchDrag(page){
  const notes = [];
  await zoom(page, 'day');
  notes.push({ where: 'matrix card',
    ...await touchProbe(page, '.matrix .card[data-step]', '.matrix .card[data-step] .grip') });
  await zoom(page, 'list');
  notes.push({ where: 'list row (the day-strip drag source)',
    ...await touchProbe(page, '.lrow[data-step]', '.lrow[data-step] .grip') });

  const ok = notes.every(n => n.skipped ||
    (n.draggedFromBody === false && n.draggedFromGrip === true &&
     Math.min(n.gripW, n.gripH) >= MIN_TAP));
  return { ok, notes };
}

/* The scheduling row lives in the ribbon resolver and in the goal editor, and it
   is the one row in the app that is always used with the keyboard up. */
async function checkSchedulingRowWithKeyboard(page, vp, url){
  await page.setViewportSize({ width: vp.width, height: KEYBOARD_H });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(280);
  await zoom(page, 'day');
  await page.evaluate(() => {
    const sigs = [...document.querySelectorAll('.sig[data-sig]')];
    (sigs.find(s => /calendar|slot/i.test(s.textContent)) || sigs[0])?.click();
  });
  await page.waitForTimeout(180);
  const res = await page.evaluate(() => {
    const row = document.querySelector('.sigfix .fixrow');
    if (!row) return { found: false };
    const r = row.getBoundingClientRect();
    const kids = [...row.querySelectorAll('input,select,button')].map(c => {
      const k = c.getBoundingClientRect();
      return { tag: c.tagName.toLowerCase(), w: Math.round(k.width), h: Math.round(k.height),
               right: Math.round(k.right), bottom: Math.round(k.bottom),
               inView: k.top >= 0 && k.bottom <= window.innerHeight + 1,
               tall: Math.min(k.width, k.height) };
    });
    const ribbon = document.querySelector('#signals').getBoundingClientRect();
    return {
      found: true, vh: window.innerHeight, vw: window.innerWidth,
      rowRight: Math.round(r.right), rowBottom: Math.round(r.bottom),
      ribbonBottom: Math.round(ribbon.bottom),
      clippedRight: kids.some(k => k.right > window.innerWidth + 1),
      allInView: kids.every(k => k.inView),
      allBigEnough: kids.every(k => k.tall >= 44 - 0.5),
      kids
    };
  });
  await page.setViewportSize({ width: vp.width, height: vp.height });
  return { ok: !!res.found && !res.clippedRight && res.allInView && res.allBigEnough,
           keyboardViewport: { width: vp.width, height: KEYBOARD_H }, ...res };
}

/* Opening a resolver must not shove the view out from under the ribbon: the
   resolver lives inside #signals, which is a flex child of the page, so the
   thing to prove is that main keeps usable height and nothing lands below the
   fold. Checked at the full viewport and again with the keyboard up. */
async function checkResolverPlacement(page, vp, url){
  const at = async (h, minMain) => {
    await page.setViewportSize({ width: vp.width, height: h });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(280);
    await zoom(page, 'day');
    const sig = await page.$('.sig[data-sig]');
    if (!sig) return { skipped: 'no fixable signal', ok: true };
    await sig.click();
    await page.waitForTimeout(180);
    return page.evaluate(minMain => {
      const fix = document.querySelector('.sigfix');
      const main = document.querySelector('main').getBoundingClientRect();
      const sigs = document.querySelector('#signals').getBoundingClientRect();
      const f = fix && fix.getBoundingClientRect();
      /* The requirement is that the resolver doesn't push the view off-screen:
         the ribbon itself stays fully on screen, the resolver's head is visible
         (it may scroll inside a capped ribbon when the keyboard is up), and main
         keeps enough height to still be a view rather than a sliver. */
      return { ok: !!fix && sigs.bottom <= window.innerHeight + 1 &&
                   f.top >= 0 && f.top < window.innerHeight &&
                   main.height >= minMain && sigs.top >= 0,
               vh: window.innerHeight, ribbonTop: Math.round(sigs.top),
               ribbonBottom: Math.round(sigs.bottom),
               resolverTop: f ? Math.round(f.top) : null,
               resolverBottom: f ? Math.round(f.bottom) : null,
               mainHeight: Math.round(main.height), minMain };
    }, minMain);
  };
  const full = await at(vp.height, 120);
  const kb   = await at(KEYBOARD_H, 64);   // with the keyboard up, a sliver is fine; nothing is not
  await page.setViewportSize({ width: vp.width, height: vp.height });
  return { ok: full.ok && kb.ok, full, keyboard: kb };
}

/* A toast that lands on the capture field makes the one thing the app is built
   around unusable at exactly the moment it is being used. Checked with the
   field focused, at full height and with the keyboard up, and with a dialog
   open — where it used to sit squarely on the modal footer. */
async function checkToastClearance(page, vp, url){
  const probe = async (h, withModal) => {
    await page.setViewportSize({ width: vp.width, height: h });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(280);
    if (withModal) { await page.click('#btnMenu'); await page.waitForTimeout(60);
                     await page.click('[data-m="prefs"]'); await page.waitForTimeout(160); }
    await page.evaluate(() => {
      document.querySelector('#capture').focus();
      window.toast('Scheduled Sep 24 for 2pm · that day is now 5h 30m');
    });
    await page.waitForTimeout(260);
    return page.evaluate(() => {
      const t = document.querySelector('#toast');
      const tr = t.getBoundingClientRect();
      const box = sel => { const e = document.querySelector(sel); return e && e.getBoundingClientRect(); };
      const hits = r => !!r && !(tr.right < r.left || tr.left > r.right || tr.bottom < r.top || tr.top > r.bottom);
      const cr = box('#capture'), fr = box('.mfoot');
      return {
        coversCapture: hits(cr), coversFooter: hits(fr),
        inViewport: tr.left >= -1 && tr.right <= window.innerWidth + 1 &&
                    tr.top >= -1 && tr.bottom <= window.innerHeight + 1,
        live: t.getAttribute('aria-live'), role: t.getAttribute('role'),
        toast: { t: Math.round(tr.top), l: Math.round(tr.left),
                 r: Math.round(tr.right), b: Math.round(tr.bottom) },
        footer: fr ? { t: Math.round(fr.top), b: Math.round(fr.bottom),
                       l: Math.round(fr.left), r: Math.round(fr.right) } : null
      };
    });
  };
  const full   = await probe(vp.height, false);
  const kb     = await probe(KEYBOARD_H, false);
  const modal  = await probe(vp.height, true);
  await page.setViewportSize({ width: vp.width, height: vp.height });
  const clean = r => !r.coversCapture && r.inViewport;
  return { ok: clean(full) && clean(kb) && clean(modal) && !modal.coversFooter &&
               full.live === 'polite' && full.role === 'status',
           full, keyboard: kb, withModal: modal };
}

/* prefers-reduced-motion. Asserted from computed style rather than by watching
   pixels, and asserted as *zero* rather than small: a 1ms animation is still an
   animation, and shortening is not disabling. */
async function checkReducedMotion(browser, url, vp){
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height },
                                         reducedMotion: 'reduce', hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(280);
  const res = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'zin';
    document.body.appendChild(probe);
    const t = document.querySelector('#toast');
    t.classList.add('on');
    const toast = getComputedStyle(t);
    const ghost = document.createElement('div');
    ghost.id = 'dragGhost';
    document.body.appendChild(ghost);
    const out = {
      prefers: matchMedia('(prefers-reduced-motion: reduce)').matches,
      toastTransition: toast.transitionDuration,
      toastTransform: toast.transform,
      zoomAnimation: getComputedStyle(probe).animationDuration,
      ghostTransform: getComputedStyle(ghost).transform,
      barTransition: (() => { const b = document.querySelector('.bbar i');
        return b ? getComputedStyle(b).transitionDuration : '0s'; })()
    };
    t.classList.remove('on'); probe.remove(); ghost.remove();
    return out;
  });
  await ctx.close();
  const zero = v => !v || String(v).split(',').every(s => parseFloat(s) === 0);
  /* no translateY component in either transform — that is the slide and the tilt */
  const flat = m => !m || m === 'none' || (() => { const n = m.match(/-?[\d.]+/g);
    return n && n.length >= 6 && Math.abs(+n[1]) < 0.001 && Math.abs(+n[2]) < 0.001; })();
  return { ok: res.prefers && zero(res.toastTransition) && zero(res.zoomAnimation) &&
               zero(res.barTransition) && flat(res.toastTransform) && flat(res.ghostTransform),
           ...res };
}

/* The PWA bits are only meaningful over http, which is why they live here and
   not in the jsdom suite: the manifest has to parse, the icons have to exist,
   and the worker has to actually take control. */
async function checkPWA(page, url){
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1400);
  return page.evaluate(async () => {
    const link = document.querySelector('link[rel=manifest]');
    let manifest = null, iconsOk = false;
    if (link) {
      try {
        manifest = await (await fetch(link.href)).json();
        const results = await Promise.all((manifest.icons || [])
          .map(i => fetch(new URL(i.src, link.href)).then(r => r.ok).catch(() => false)));
        iconsOk = results.length > 0 && results.every(Boolean);
      } catch (_) {}
    }
    const reg = navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null;
    const swURL = reg && (reg.active || reg.installing || reg.waiting)
      ? (reg.active || reg.installing || reg.waiting).scriptURL : null;
    return {
      ok: !!manifest && iconsOk && !!swURL && /schema=\d+/.test(swURL || '') &&
          manifest.display === 'standalone' &&
          (manifest.icons || []).some(i => (i.purpose || '').includes('maskable')),
      manifestName: manifest && manifest.name,
      display: manifest && manifest.display,
      themeColor: manifest && manifest.theme_color,
      maskable: !!manifest && (manifest.icons || []).some(i => (i.purpose || '').includes('maskable')),
      iconsOk, swURL,
      themeMeta: document.querySelector('meta[name=theme-color]')?.content || null
    };
  });
}

/* ================================= run =================================== */

const pad = (s, n) => String(s).padEnd(n);

async function main(){
  fs.mkdirSync(OUT, { recursive: true });
  const { srv, url } = await serve({ index: APP });
  const browser = await chromium.launch({ executablePath: process.env.PLY_CHROMIUM || undefined });
  const report = { app: APP, label: LABEL, at: new Date().toISOString(),
                   minTap: MIN_TAP, viewports: {} };
  let failures = 0;
  const fail = () => { failures++; };

  for (const vp of VIEWPORTS) {
    const V = report.viewports[vp.name] = { surfaces: {}, checks: {} };
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2, isMobile: true, hasTouch: true
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => ((V.pageErrors ||= []).push(String(e.message))));

    for (const s of SURFACES) {
      // a fresh load per surface: modals and open resolvers are sticky by design
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForTimeout(280);
      try { await s.go(page); }
      catch (e) { V.surfaces[s.id] = { title: s.title, error: String(e.message) }; fail(); continue; }
      await page.waitForTimeout(140);
      const shot = `${vp.name}--${s.id}.png`;
      await page.screenshot({ path: path.join(OUT, shot) });
      const h = await hscroll(page), c = await clipped(page), t = await tapTargets(page, MIN_TAP);
      V.surfaces[s.id] = { title: s.title, shot, hscroll: h, clipped: c, tap: t };
      if (!h.ok) fail();
      if (!c.ok) fail();
      if (!t.ok) fail();
    }

    await page.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(280);
    V.checks.touchDrag = await checkTouchDrag(page);

    V.checks.keyboardRow = await checkSchedulingRowWithKeyboard(page, vp, url);
    await page.screenshot({ path: path.join(OUT, `${vp.name}--sched-keyboard.png`) });

    V.checks.resolver = await checkResolverPlacement(page, vp, url);

    V.checks.toast = await checkToastClearance(page, vp, url);
    await page.screenshot({ path: path.join(OUT, `${vp.name}--toast.png`) });

    V.checks.reducedMotion = await checkReducedMotion(browser, url, vp);
    V.checks.pwa = await checkPWA(page, url);

    for (const v of Object.values(V.checks)) if (v && v.ok === false) fail();
    if (V.pageErrors?.length) fail();
    await ctx.close();
  }

  await browser.close();
  srv.close();

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

  const lines = [];
  for (const [name, V] of Object.entries(report.viewports)) {
    lines.push('', '  ' + name, `  ${pad('surface', 13)}${pad('h-scroll', 11)}${pad('clipped', 10)}tap targets`);
    for (const [id, s] of Object.entries(V.surfaces)) {
      if (s.error) { lines.push(`  ${pad(id, 13)}ERROR ${s.error}`); continue; }
      lines.push(`  ${pad(id, 13)}${pad(s.hscroll.ok ? 'ok' : `+${s.hscroll.over}px`, 11)}` +
                 `${pad(s.clipped.ok ? 'ok' : 'CLIPPED', 10)}` +
                 `${s.tap.ok ? `ok (${s.tap.audited})` : `${s.tap.bad.length} of ${s.tap.audited} under ${MIN_TAP}px`}`);
      for (const b of s.hscroll.blame.slice(0, 3)) lines.push(`                ↳ overflow ${b.sel} right:${b.right}`);
      for (const b of s.clipped.bad.slice(0, 3))   lines.push(`                ↳ clipped ${b.sel} ${b.left}..${b.right} in ${b.vw}`);
      for (const b of s.tap.bad.slice(0, 6))       lines.push(`                ↳ ${b.sel} ${b.w}×${b.h} "${b.text}"`);
    }
    for (const [k, v] of Object.entries(V.checks))
      lines.push(`  ${pad(k, 13)}${v.ok ? 'ok' : 'FAIL'}${v.skipped ? ' (' + v.skipped + ')' : ''}`);
    if (V.pageErrors?.length) lines.push(`  page errors: ${V.pageErrors.join(' | ')}`);
  }
  const text = lines.join('\n');
  console.log(text);
  fs.writeFileSync(path.join(OUT, 'report.txt'), text);
  console.log(`\n  shots → ${OUT}`);
  console.log(`  ${failures} failing check${failures === 1 ? '' : 's'}\n`);

  if (ASSERT && failures) process.exit(1);
  return report;
}

main().catch(e => { console.error(e); process.exit(2); });
