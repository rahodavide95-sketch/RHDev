/* Componenti dell'area dell'etichetta: finestre, avvisi, conferme, pulsanti, campi. */

import { h, icon, clear } from '../ui/dom.js';

export function toast(msg, { type = '', ms = 3200 } = {}) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = h('div.toast' + (type ? '.' + type : ''), { role: 'status' }, type === 'ok' ? icon('checkCircle', 18) : type === 'error' ? icon('alert', 18) : null, h('span', msg));
  document.body.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

/** Finestra (dal basso su telefono, al centro su computer). Restituisce { el, body, foot, close }. */
export function modal({ title, wide = false, onClose } = {}) {
  const body = h('div.m-body');
  const foot = h('div.m-foot');
  const close = () => { back.classList.add('out'); setTimeout(() => back.remove(), 180); document.removeEventListener('keydown', esc); onClose && onClose(); };
  const esc = e => { if (e.key === 'Escape') close(); };
  const box = h('div.m-box' + (wide ? '.wide' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '' },
    h('div.m-head', h('h2', title || ''), h('button.icon-btn', { type: 'button', 'aria-label': 'Chiudi', onclick: close }, icon('x', 20))),
    body, foot);
  const back = h('div.m-back', { onmousedown: e => { if (e.target === back) close(); } }, box);
  document.body.append(back);
  document.addEventListener('keydown', esc);
  setTimeout(() => { const f = box.querySelector('input:not([type=checkbox]):not([type=color]), textarea, select'); if (f) f.focus(); }, 60);
  return { el: box, body, foot, close };
}

export function confirmBox({ title, text, ok = 'Conferma', danger = false, cancel = 'Annulla' }) {
  return new Promise(resolve => {
    let done = false;
    const m = modal({ title, onClose: () => { if (!done) resolve(false); } });
    m.body.append(h('p.muted', text));
    m.foot.append(
      h('button.btn.ghost', { type: 'button', onclick: () => { done = true; resolve(false); m.close(); } }, cancel),
      h('button.btn' + (danger ? '.danger' : ''), { type: 'button', onclick: () => { done = true; resolve(true); m.close(); } }, ok));
  });
}

export const btn = (label, onclick, { ic, kind = '', type = 'button', title, disabled } = {}) =>
  h('button.btn' + (kind ? '.' + kind.split(' ').join('.') : ''), { type, onclick, title, disabled }, ic ? icon(ic, 18) : null, label ? h('span', label) : null);
export const iconBtn = (ic, title, onclick, cls = '') => h('button.icon-btn' + (cls ? '.' + cls : ''), { type: 'button', title, 'aria-label': title, onclick }, icon(ic, 18));

/** Riga di campo con etichetta. */
export function field(label, control, hint = '') {
  return h('label.fld', h('span.fld-l', label), control, hint ? h('span.fld-h', hint) : null);
}
export function toggle(label, checked, onchange, hint = '') {
  return h('label.tgl', h('input', { type: 'checkbox', checked, onchange: e => onchange(e.target.checked) }), h('span.tgl-ui'), h('span.tgl-t', h('span', label), hint ? h('small', hint) : null));
}
export function selectEl(options, value, onchange, attrs = {}) {
  return h('select.inp', { ...attrs, onchange: e => onchange(e.target.value) }, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
}
export const input = (attrs) => h('input.inp', attrs);

export function empty(ic, title, text, action) {
  return h('div.empty', h('div.empty-ic', icon(ic, 28)), h('h3', title), text ? h('p.muted', text) : null, action || null);
}
export function chip(text, tone = '', ic = '') { return h('span.chip' + (tone ? '.' + tone : ''), ic ? icon(ic, 13) : null, text); }

export function spinner() { return h('div.spin'); }
export function loading(target, text = 'Carico…') { clear(target); target.append(h('div.loading', spinner(), h('span', text))); }

export async function copyText(text, msg = 'Copiato') {
  try { await navigator.clipboard.writeText(text); toast(msg, { type: 'ok' }); }
  catch {
    const ta = h('textarea', { style: { position: 'fixed', left: '-9999px' } }, text);
    document.body.append(ta); ta.select();
    try { document.execCommand('copy'); toast(msg, { type: 'ok' }); } catch { toast('Copia non riuscita: selezionalo a mano', { type: 'error' }); }
    ta.remove();
  }
}

export function friendly(e) {
  const m = (e && (e.message || e.code)) || '';
  if (/network|fetch|Connessione/i.test(m)) return 'Connessione non riuscita. Controlla internet e riprova.';
  if (/JWT|session|Accedi|aal/i.test(m)) return 'Sessione scaduta: accedi di nuovo.';
  if (/permission|row-level|policy/i.test(m)) return 'Permesso negato (serve la verifica in due passaggi).';
  if (/firmato/.test(m)) return 'Il contratto è firmato: questo dato non si può più cambiare.';
  return m || 'Qualcosa non ha funzionato.';
}
