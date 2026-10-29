/* Componenti dell'interfaccia: finestre (dal basso su telefono, al centro su computer),
   avvisi, conferme, campi dei moduli, barre di avanzamento. */

import { h, icon, $, isMobile } from './dom.js';
import { parseAmount, parseDecimal, formatMoney, formatNumber, CURRENCIES } from '../core/money.js';

/* ═══ Finestre ═══════════════════════════════════════════════════════════ */
const stack = [];
let lastFocus = null;

export function openSheet({ title, subtitle, body, footer, size = 'md', onClose, beforeClose, className = '', icon: ic } = {}) {
  const root = $('#overlays');
  if (!stack.length) lastFocus = document.activeElement;
  const head = h('header.sheet-head',
    h('div.sheet-grab', { 'aria-hidden': 'true' }),
    h('div.sheet-titles',
      ic ? h('div.sheet-ic', ic) : null,
      h('div',
        h('h2.sheet-title', { id: 'st-' + stack.length }, title || ''),
        subtitle ? h('p.sheet-sub', subtitle) : null)),
    h('button.icon-btn.sheet-x', { type: 'button', 'aria-label': 'Chiudi', onclick: () => api.close() }, icon('x', 20)));
  const bodyEl = h('div.sheet-body', body);
  const footEl = h('footer.sheet-foot', footer);
  if (!footer) footEl.hidden = true;
  const panel = h('section.sheet', { class: `sheet-${size} ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'st-' + stack.length, tabindex: '-1' }, head, bodyEl, footEl);
  const wrap = h('div.sheet-wrap', h('div.sheet-backdrop', { onclick: () => api.close() }), panel);
  root.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('in'));
  document.documentElement.classList.add('has-sheet');

  // trascinare giù la maniglia chiude (telefono)
  let startY = null, dy = 0;
  head.addEventListener('pointerdown', e => {
    if (!isMobile() || e.target.closest('button')) return;
    startY = e.clientY; dy = 0; panel.style.transition = 'none';
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', e => {
    if (startY == null) return;
    dy = Math.max(0, e.clientY - startY);
    panel.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (startY == null) return;
    startY = null; panel.style.transition = ''; panel.style.transform = '';
    if (dy > 110) api.close();
  };
  head.addEventListener('pointerup', end);
  head.addEventListener('pointercancel', end);

  const api = {
    el: panel, body: bodyEl, foot: footEl,
    setBody(...kids) { bodyEl.replaceChildren(...kids.flat()); },
    setFooter(...kids) { footEl.replaceChildren(...kids.flat()); footEl.hidden = !kids.flat().length; },
    setTitle(t) { $('.sheet-title', panel).textContent = t; },
    async close(force = false) {
      if (!force && beforeClose && (await beforeClose()) === false) return;
      const i = stack.indexOf(api);
      if (i < 0) return;
      stack.splice(i, 1);
      wrap.classList.remove('in');
      wrap.classList.add('out');
      setTimeout(() => wrap.remove(), 260);
      if (!stack.length) {
        document.documentElement.classList.remove('has-sheet');
        try { lastFocus?.focus?.({ preventScroll: true }); } catch { /* */ }
      }
      onClose?.();
    },
  };
  stack.push(api);
  setTimeout(() => {
    // se nel frattempo è già stato toccato un campo della finestra, non spostare il cursore
    if (panel.contains(document.activeElement) && document.activeElement !== panel) return;
    const f = panel.querySelector('[autofocus]') || (!isMobile() && panel.querySelector('input:not([type=checkbox]):not([readonly]),select,textarea'));
    (f || panel).focus({ preventScroll: true });
  }, 60);
  return api;
}

export const topSheet = () => stack[stack.length - 1] || null;
export const closeAllSheets = () => [...stack].reverse().forEach(s => s.close(true));

document.addEventListener('keydown', e => {
  const top = topSheet();
  if (!top) return;
  if (e.key === 'Escape') { e.preventDefault(); top.close(); }
  if (e.key === 'Tab') {
    // il tasto Tab resta dentro la finestra
    const f = [...top.el.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

/** Domanda sì/no. */
export function confirmDialog({ title, message, confirm = 'Conferma', cancel = 'Annulla', danger = false, icon: ic } = {}) {
  return new Promise(resolve => {
    let done = false;
    const s = openSheet({
      title, size: 'sm', className: 'confirm',
      icon: ic ? icon(ic, 22) : (danger ? icon('alert', 22) : null),
      body: message ? (message instanceof Node ? h('div.confirm-msg', message) : h('p.confirm-msg', message)) : null,
      footer: [
        h('button.btn.btn-ghost', { type: 'button', onclick: () => { done = true; s.close(true); resolve(false); } }, cancel),
        h('button.btn', { type: 'button', class: danger ? 'btn-danger' : 'btn-primary', onclick: () => { done = true; s.close(true); resolve(true); } }, confirm),
      ],
      onClose: () => { if (!done) resolve(false); },
    });
  });
}

/** Chiede un testo (es. la password per un'operazione delicata). */
export function promptDialog({ title, message, label, type = 'text', confirm = 'Continua', validate, autocomplete = 'off' } = {}) {
  return new Promise(resolve => {
    let done = false;
    const inp = h('input.input', { type, autocomplete, autofocus: true, 'aria-label': label || title });
    const err = h('p.field-err', { hidden: true });
    const go = async () => {
      const v = inp.value;
      if (validate) {
        btn.disabled = true;
        const msg = await validate(v);
        btn.disabled = false;
        if (msg) { err.textContent = msg; err.hidden = false; inp.select(); return; }
      }
      done = true; s.close(true); resolve(v);
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    const btn = h('button.btn.btn-primary', { type: 'button', onclick: go }, confirm);
    const s = openSheet({
      title, size: 'sm',
      body: h('div.stack', message ? h('p.muted', message) : null, field(label, inp), err),
      footer: [h('button.btn.btn-ghost', { type: 'button', onclick: () => s.close() }, 'Annulla'), btn],
      onClose: () => { if (!done) resolve(null); },
    });
  });
}

/* ═══ Avvisi in basso ════════════════════════════════════════════════════ */
export function toast(msg, { kind = 'info', action, ms = 4200 } = {}) {
  const root = $('#toasts');
  if (!root) return;
  const el = h('div.toast', { class: 'toast-' + kind, role: kind === 'err' ? 'alert' : 'status' },
    kind === 'ok' ? icon('check', 18) : kind === 'err' ? icon('alert', 18) : null,
    h('span.toast-msg', msg),
    action ? h('button.toast-act', { type: 'button', onclick: () => { action.fn(); kill(); } }, action.label) : null);
  // un solo avviso con "Annulla" alla volta, e al massimo due avvisi visibili
  if (action) root.querySelectorAll('.toast.has-act').forEach(x => x.remove());
  if (action) el.classList.add('has-act');
  root.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  const kill = () => { el.classList.remove('in'); setTimeout(() => el.remove(), 250); };
  setTimeout(kill, action ? Math.max(ms, 6000) : ms);
  while (root.children.length > 2) root.firstChild.remove();
}

/* ═══ Campi ══════════════════════════════════════════════════════════════ */
let fid = 0;
export function field(label, control, { hint, wide, extra } = {}) {
  const id = control.id || (control.id = 'f' + (++fid));
  const lab = label ? h('label.field-label', { for: control.matches?.('input,select,textarea') ? id : null }, label) : null;
  return h('div.field', { class: wide ? 'field-wide' : '' }, lab, extra ? h('div.field-row', control, extra) : control, hint ? h('p.field-hint', hint) : null);
}

export function textInput({ value = '', placeholder = '', max = 120, type = 'text', autofocus, list, inputmode, autocomplete = 'off', onInput } = {}) {
  const el = h('input.input', { type, value, placeholder, maxlength: max, autofocus, list, inputmode, autocomplete, spellcheck: 'false' });
  if (onInput) el.addEventListener('input', () => onInput(el.value));
  return el;
}

export function textArea({ value = '', placeholder = '', max = 1000, rows = 3 } = {}) {
  return h('textarea.input.textarea', { placeholder, maxlength: max, rows }, value);
}

export function dateInput(value) {
  return h('input.input', { type: 'date', value: value || '', min: '1900-01-01', max: '2200-12-31' });
}

/** Importo: accetta "12,50", "1.200" e piccoli calcoli ("35+12,4"). getCents() restituisce i centesimi o null. */
export function amountInput({ value = null, currency = 'EUR', placeholder = '0,00', autofocus, allowNegative = false, big = false, onChange } = {}) {
  const inp = h('input.input.amount-input', {
    type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder, autofocus, class: big ? 'amount-big' : '',
    value: value == null ? '' : formatNumber(value / 100, 2, value % 100 ? 2 : 0).replace(/\./g, ''),
    'aria-label': 'Importo',
  });
  const sym = h('span.amount-sym', CURRENCIES[currency]?.symbol || currency);
  const preview = h('span.amount-preview');
  const wrap = h('div.amount-wrap', { class: big ? 'big' : '' }, sym, inp, preview);
  const read = () => {
    const c = parseAmount(inp.value);
    if (c == null) return null;
    return allowNegative ? c : Math.abs(c);
  };
  inp.addEventListener('input', () => {
    const isExpr = /[-+*/×x(]/.test(inp.value.replace(/^-/, ''));
    const c = read();
    preview.textContent = isExpr && c != null ? '= ' + formatMoney(c, currency) : '';
    wrap.classList.toggle('invalid', inp.value.trim() !== '' && c == null);
    onChange?.(c);
  });
  inp.addEventListener('blur', () => {
    const c = read();
    if (c != null && /[-+*/×x(]/.test(inp.value.replace(/^-/, ''))) { inp.value = formatNumber(c / 100, 2, 2).replace(/\./g, ''); preview.textContent = ''; }
  });
  wrap.input = inp;
  wrap.getCents = read;
  wrap.setCurrency = c => { sym.textContent = CURRENCIES[c]?.symbol || c; currency = c; };
  wrap.focus = () => inp.focus();
  return wrap;
}

/** Numero decimale libero (percentuali, quantità, prezzi). */
export function numberInput({ value = '', placeholder = '', suffix = '', autofocus, step } = {}) {
  const inp = h('input.input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder, autofocus, value: value === '' || value == null ? '' : String(value).replace('.', ',') });
  const wrap = h('div.suffix-wrap', inp, suffix ? h('span.suffix', suffix) : null);
  wrap.input = inp;
  wrap.getValue = () => parseDecimal(inp.value);
  wrap.focus = () => inp.focus();
  if (step) wrap.dataset.step = step;
  return wrap;
}

export function selectInput(options, value, onChange) {
  const sel = h('select.input.select');
  let group = null, lastG = null;
  for (const o of options) {
    if (o.group && o.group !== lastG) { group = h('optgroup', { label: o.group }); sel.append(group); lastG = o.group; }
    const opt = h('option', { value: o.value, disabled: o.disabled }, o.label);
    if (String(o.value) === String(value)) opt.selected = true;
    (o.group ? group : sel).append(opt);
  }
  if (onChange) sel.addEventListener('change', () => onChange(sel.value));
  return h('div.select-wrap', sel, icon('chevD', 16, 'select-chev'));
}
export const selectValue = wrap => wrap.querySelector('select').value;

/** Pulsanti a pillola per scegliere una opzione. */
export function segmented(options, value, onChange, { small = false, label } = {}) {
  const el = h('div.seg', { role: 'radiogroup', 'aria-label': label, class: small ? 'seg-sm' : '' });
  const btns = options.map(o => {
    const b = h('button.seg-btn', { type: 'button', role: 'radio', 'aria-checked': String(o.value === value), dataset: { v: o.value } }, o.icon ? icon(o.icon, 16) : null, o.label);
    b.addEventListener('click', () => {
      btns.forEach(x => x.setAttribute('aria-checked', String(x === b)));
      el.value = o.value;
      onChange?.(o.value);
    });
    return b;
  });
  el.append(...btns);
  el.value = value;
  return el;
}

export function toggle(label, checked, onChange, { hint } = {}) {
  const inp = h('input', { type: 'checkbox', checked, role: 'switch' });
  inp.addEventListener('change', () => onChange?.(inp.checked));
  const el = h('label.toggle', h('span.toggle-text', h('span.toggle-label', label), hint ? h('span.toggle-hint', hint) : null), inp, h('span.switch', { 'aria-hidden': 'true' }));
  el.input = inp;
  return el;
}

/* ═══ Emoji ══════════════════════════════════════════════════════════════ */
const EMOJI = ('🏦 🐷 💶 💳 📈 🪙 🌱 🏡 🚗 💎 🤝 🏠 🧾 📉 💼 🎛️ 🎵 🎧 💰 💡 📶 🛋️ 🛒 🍝 ☕ 🍕 🍷 ⛽ 🚆 🚕 ✈️ 🏖️ 🩺 💊 💇 👕 👟 🎟️ 🎬 🎮 📚 🎓 🏋️ ⚽ 📺 📱 💻 🛍️ 🎁 🐾 🧸 👶 🏛️ 🏧 🛡️ ↩️ 🏷️ 📦 🔧 🧹 🧺 🌍 🗽 🎯 🚀 ⭐ ❤️ 🔥 🌈 ☀️ 🌙 🍀 🎄 💍 🏍️ 🚲 🛵 🏝️ 🗻 🎸 🎹 🥁 🎤 📷 🖥️ 🧘 🍼 🐶 🐱 🌿 💧 ⚡ 🔒 📌').split(' ');
export function emojiButton(value, onPick) {
  const btn = h('button.emoji-btn', { type: 'button', 'aria-label': 'Scegli un\'icona' }, value || '🙂');
  btn.value = value || '';
  btn.addEventListener('click', () => {
    const grid = h('div.emoji-grid', EMOJI.map(e => h('button.emoji-cell', { type: 'button', onclick: () => { btn.value = e; btn.textContent = e; onPick?.(e); s.close(true); } }, e)));
    const s = openSheet({ title: 'Scegli un\'icona', size: 'sm', body: grid });
  });
  return btn;
}

/* ═══ Avanzamento ════════════════════════════════════════════════════════ */
export function progressBar(pct, { tone, marker } = {}) {
  const p = Math.max(0, Math.min(1, pct || 0));
  const t = tone || (pct > 1 ? 'neg' : pct > 0.85 ? 'warn' : 'ok');
  return h('div.bar', { class: 'bar-' + t, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(p * 100) },
    h('span.bar-fill', { style: { width: (p * 100).toFixed(1) + '%' } }),
    marker != null ? h('span.bar-mark', { style: { left: (Math.max(0, Math.min(1, marker)) * 100).toFixed(1) + '%' } }) : null);
}

export function ring(pct, size = 56, stroke = 6, label) {
  const p = Math.max(0, Math.min(1, pct || 0));
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const svg = h('svg.ring', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true' },
    h('circle.ring-track', { cx: size / 2, cy: size / 2, r, 'stroke-width': stroke, fill: 'none' }),
    h('circle.ring-fill', { cx: size / 2, cy: size / 2, r, 'stroke-width': stroke, fill: 'none', 'stroke-dasharray': `${(c * p).toFixed(2)} ${c.toFixed(2)}`, transform: `rotate(-90 ${size / 2} ${size / 2})`, 'stroke-linecap': 'round' }));
  return h('div.ring-wrap', { style: { width: size + 'px', height: size + 'px' } }, svg, label != null ? h('span.ring-label', label) : null);
}

export function empty({ icon: ic = 'sparkle', title, text, action }) {
  return h('div.empty', h('div.empty-ic', icon(ic, 26)), h('h3', title), text ? h('p', text) : null, action || null);
}

export function pill(text, tone = '') { return h('span.pill', { class: tone ? 'pill-' + tone : '' }, text); }

/** Bottone che chiede un secondo tocco per confermare (per azioni distruttive veloci). */
export function twoTap(label, onConfirm, { cls = 'btn btn-danger-soft', confirmLabel = 'Tocca di nuovo per confermare', iconName } = {}) {
  let armed = false, t = 0;
  const b = h('button', { type: 'button', class: cls }, iconName ? icon(iconName, 18) : null, h('span', label));
  b.addEventListener('click', () => {
    if (armed) { clearTimeout(t); armed = false; b.classList.remove('armed'); b.lastChild.textContent = label; onConfirm(); return; }
    armed = true; b.classList.add('armed'); b.lastChild.textContent = confirmLabel;
    t = setTimeout(() => { armed = false; b.classList.remove('armed'); b.lastChild.textContent = label; }, 4000);
  });
  return b;
}
