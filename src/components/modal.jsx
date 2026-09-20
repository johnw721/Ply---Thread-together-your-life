import { render } from '../views/render.jsx';
import { render as preactRender } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { disarm, setConfirmCb } from './dialogs.js';
import { setGerow } from '../goal-editor.js';
import { adoptExternal, takeExternal } from '../store.js';
import { $, el } from '../util.js';

/* ===================== [SECTION: UI] =====================
   One dialog, one implementation.

   The dialog semantics used to be split: openModal() wrote the scrim, the
   role and aria-modal as a template string, while the Tab trap was a separate
   delegated listener on #modalRoot, and the focus return was a module-level
   variable read by closeModal(). Three places, one concept. <Modal> owns all of
   it, and every caller — the check-in, the goal editor, the event editor, the
   converter, Settings, the confirm dialog — goes through openModal(), so there
   is nothing to keep in step.

   The body is still passed as markup, because the check-in and the goal editor
   are still built as strings. That is the remaining half of this step, and it
   does not change what a dialog IS. */

export const FOCUSABLE='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** what had focus when the dialog opened, so closing can give it back */
export let RETURN_FOCUS=null;
export function setReturnFocus(el){ RETURN_FOCUS=el; }

export function Modal({ html, wide, nofocus }){
  const ref = useRef(null);

  useEffect(() => {
    const m = ref.current; if (!m) return;
    const inp = m.querySelector('input,select,textarea');
    // only claim focus if nothing inside has it — otherwise this steals the caret
    // from an inline field the moment after someone starts typing in it
    if (inp && !nofocus) setTimeout(() => inp.focus(), 30);
    else setTimeout(() => { if (!m.contains(document.activeElement)) m.focus(); }, 30);
  }, []);

  /* Tab used to walk straight out of an open dialog and into the page behind it,
     where every control still worked. Keep it inside until the dialog is closed. */
  const onKeyDown = e => {
    if (e.key !== 'Tab') return;
    const m = ref.current; if (!m) return;
    const items = [...m.querySelectorAll(FOCUSABLE)]
      .filter(el => el.offsetParent !== null || el === document.activeElement);
    if (!items.length){ e.preventDefault(); m.focus(); return; }
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === m)){
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last){
      e.preventDefault(); first.focus();
    }
  };

  return (
    <div class="scrim">
      <div ref={ref} class={'modal' + (wide ? ' wide' : '')}
           role="dialog" aria-modal="true" tabIndex="-1"
           onKeyDown={onKeyDown}
           dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

export function openModal(html, opts = {}){
  const root = $('#modalRoot');
  // remember what opened this, so closing puts the keyboard back where it was
  if (!root.innerHTML) setReturnFocus(
    (document.activeElement && document.activeElement !== document.body) ? document.activeElement : null);
  preactRender(<Modal html={html} wide={opts.wide} nofocus={opts.nofocus} />, root);
  document.body.classList.add('modal-open');
  return root.firstElementChild;
}

export function closeModal(){
  const root = $('#modalRoot');
  preactRender(null, root);
  root.innerHTML = '';
  document.body.classList.remove('modal-open');
  disarm(); setGerow(null); setConfirmCb(null);
  if (RETURN_FOCUS){ const el = RETURN_FOCUS; setReturnFocus(null);
    if (document.body.contains(el)) try{ el.focus(); }catch(_){} }
  // another tab wrote while this modal was open — take it now that nothing is mid-edit
  { const d = takeExternal(); if (d) adoptExternal(d); }
}
