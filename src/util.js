/* ===================== [SECTION: UTIL] ===================== */
export const $  = (s,r=document)=>r.querySelector(s);
export const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
export const uid = ()=>Math.random().toString(36).slice(2,10);
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const DAY_MS = 864e5;

export function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function el(html){const t=document.createElement('template');t.innerHTML=html.trim();return t.content.firstElementChild;}

// --- dates: everything internal is ISO. Day keys are 'YYYY-MM-DD' in LOCAL time.
export function dkey(d){const x=new Date(d);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');}
export function parseKey(k){const [y,m,d]=k.split('-').map(Number);return new Date(y,m-1,d);}
export function today(){return dkey(new Date());}
export function addDays(k,n){const d=parseKey(k);d.setDate(d.getDate()+n);return dkey(d);}
export function daysBetween(a,b){return Math.round((parseKey(b)-parseKey(a))/DAY_MS);}
export function startOfWeek(k){const d=parseKey(k);d.setDate(d.getDate()-d.getDay());return dkey(d);} // Sunday
export function fmtDay(k){return parseKey(k).toLocaleDateString(undefined,{weekday:'short'});}
export function fmtDate(k){return parseKey(k).toLocaleDateString(undefined,{month:'short',day:'numeric'});}
export function fmtFull(k){return parseKey(k).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'});}
/* same as fmtDate, but carries the year when it isn't this one — "Apr 26" is
   ambiguous for a date nine months out, which is exactly where projections land */
export function fmtDateY(k){
  const d=parseKey(k);
  return d.getFullYear()===new Date().getFullYear() ? fmtDate(k)
    : d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
}
export function fmtTime(mins){const h=Math.floor(mins/60),m=mins%60;const ap=h<12?'am':'pm';const hh=h%12===0?12:h%12;
  return hh+(m?':'+String(m).padStart(2,'0'):'')+ap;}
export function nowMin(){const d=new Date();return d.getHours()*60+d.getMinutes();}
export function relDays(n){ if(n===0)return'today'; if(n===1)return'tomorrow'; if(n===-1)return'yesterday';
  return n>0?('in '+n+'d'):(Math.abs(n)+'d ago'); }

export function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('on');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('on'),1900);}

