/* Disegno di un modulo: lo stesso codice per la pagina dell'artista e per l'anteprima del costruttore.
   Ogni campo legge e scrive in un oggetto "answers" { idCampo: valore } tramite onChange. */

import { h, icon, clear, debounce } from './dom.js';
import { richBlock } from './rich.js';
import { themeVars, sanitizeTheme, safeImage } from '../core/theme.js';
import { checkLink, LINK_KINDS } from '../core/links.js';
import { formatValue, fieldProblem, parseNumber, compactIban, formatIban, isFilled } from '../core/answers.js';
import { isEmptyRich } from '../core/richtext.js';
import { widthOf, fillText, TEXT_DEFAULTS, SHOW_DEFAULTS } from '../core/schema.js';
import { logoTone } from './pdf.js';

/** Testi e interruttori della pagina dell'artista (con i valori predefiniti se mancano). */
export const textOf = (form, key, vars = {}) => fillText((form.texts && form.texts[key]) || TEXT_DEFAULTS[key] || '', vars);
export const shown = (form, key) => form.show && typeof form.show[key] === 'boolean' ? form.show[key] : SHOW_DEFAULTS[key];
const widthStyle = f => ({ '--fw': String(widthOf(f) / 100) });
/** Maniglia per allargare/stringere un elemento nell'anteprima del costruttore. */
const resizeHandle = (kind, id) => h('span.b-rs', { dataset: { rs: kind, target: id }, title: 'Trascina per cambiare la larghezza', 'aria-hidden': 'true' });

/** Applica l'aspetto del modulo a un elemento (variabili CSS + attributi, mai stili scritti a mano). */
export function applyTheme(el, theme) {
  const t = sanitizeTheme(theme);
  for (const [k, v] of Object.entries(themeVars(t))) el.style.setProperty(k, v);
  el.dataset.bg = t.bgStyle;
  el.dataset.card = t.cardStyle;
  el.dataset.btn = t.button;
  el.style.colorScheme = themeVars(t)['--f-scheme'];
  return t;
}

/** Testata: immagine, logo, nome dell'etichetta, titolo e introduzione. design = maniglie del costruttore. */
export function formHeader({ form, label = {}, release = null, artist = '', design = false }) {
  const t = sanitizeTheme(form.theme);
  const head = h('header.f-head');
  const src = safeImage(label.logo || '');
  // logo: dove (nel riquadro del titolo, sopra, sull'immagine di testata) e da che parte (sinistra, centro, destra)
  const logoEl = () => {
    const img = h('img.f-logo', { src, alt: '' });
    logoTone(src).then(x => { if (x !== 'none' && isLight(t.card)) img.dataset.bg = x; });
    return design ? h('span.b-logo-wrap', img, h('span.b-rs.b-rs-xy', { dataset: { rs: 'logo' }, title: 'Trascina per cambiare la grandezza', 'aria-hidden': 'true' })) : img;
  };
  const withLogo = t.logo && src;
  const place = t.logoPlace === 'cover' && !t.header ? 'top' : t.logoPlace;
  if (t.header) head.append(h('div.f-cover', { style: { backgroundImage: `url("${safeImage(t.header)}")`, backgroundSize: t.headerFit } },
    withLogo && place === 'cover' ? h('div.f-logo-cover', { dataset: { pos: t.logoPos } }, logoEl()) : null,
    design ? h('span.b-rs.b-rs-y', { dataset: { rs: 'cover' }, title: 'Trascina per cambiare l\'altezza', 'aria-hidden': 'true' }) : null));
  const top = h('div.f-brand', { dataset: { pos: t.logoPos } });
  if (withLogo && place === 'card') top.append(logoEl());
  if (label.name && shown(form, 'labelName')) top.append(h('span.f-label', label.name));
  const card = h('div.f-card.f-titlecard', { dataset: { align: t.titleAlign } },
    withLogo && place === 'top' ? h('div.f-logo-top', { dataset: { pos: t.logoPos } }, logoEl()) : null,
    top.childNodes.length ? top : null,
    h('h1.f-title', form.title),
    release && shown(form, 'release') ? h('p.f-release', icon('disc', 16), h('span', releaseLine(form, release))) : null,
    artist && shown(form, 'hello') ? h('p.f-hello', textOf(form, 'hello', { artista: artist, nome: artist })) : null,
    isEmptyRich(form.intro) ? null : richBlock(form.intro, {}, 'f-intro'),
  );
  head.append(card);
  return head;
}
/** Riga della release: il modello dei testi con titolo e numero di catalogo (senza separatori orfani se manca il numero). */
export function releaseLine(form, release) {
  const t = textOf(form, 'release', { release: release.title || '', catalogo: release.catalog || '' });
  return t.replace(/\(\s*\)|\[\s*\]/g, '').replace(/^[\s·|,–-]+|[\s·|,–-]+$/g, '').replace(/\s{2,}/g, ' ') || release.title || '';
}
const isLight = hex => { const n = parseInt(String(hex).slice(1), 16); return ((n >> 16 & 255) * 0.299 + (n >> 8 & 255) * 0.587 + (n & 255) * 0.114) > 150; };

const fieldId = (path) => 'q-' + path.replace(/[^a-z0-9_-]/gi, '-');

function linkHint(field, shareWith) {
  const kind = LINK_KINDS[field.linkKind] || LINK_KINDS.any;
  const parts = [field.linkKind === 'any' ? '' : `Accettati: ${kind.hint}`];
  if (shareWith && (field.linkKind === 'files' || field.linkKind === 'audio')) parts.push(`Condividi il file o la cartella con ${shareWith} (meglio di "chiunque abbia il link").`);
  return parts.filter(Boolean).join(' ');
}

/** Controllo di un singolo campo. ctx: { readonly, locked, errors, shareWith, onChange } */
function control(field, value, path, ctx, set) {
  const id = fieldId(path);
  const ro = ctx.readonly || ctx.locked;
  if (ro) {
    const text = formatValue(field, value);
    if (field.type === 'link' && text) return h('a.f-value.f-linkv', { href: checkLink(text, 'any').url || '#', target: '_blank', rel: 'noopener noreferrer nofollow' }, icon('external', 15), text);
    return h('div.f-value' + (text ? '' : '.empty'), text || '—');
  }
  const common = { id, name: id, placeholder: field.placeholder || '', 'aria-describedby': id + '-err' };
  switch (field.type) {
    case 'long': {
      const ta = h('textarea.f-input', { ...common, rows: field.rows || 4, style: { minHeight: ((field.rows || 4) * 1.5 + 1.6) + 'em' }, maxlength: field.maxLength, value: value || '', oninput: e => { set(e.target.value); grow(e.target); } });
      requestAnimationFrame(() => grow(ta));
      return ta;
    }
    case 'email': return h('input.f-input', { ...common, type: 'email', autocomplete: 'email', inputmode: 'email', maxlength: 254, value: value || '', oninput: e => set(e.target.value.trim()) });
    case 'phone': return h('input.f-input', { ...common, type: 'tel', autocomplete: 'tel', maxlength: 24, value: value || '', oninput: e => set(e.target.value) });
    case 'number': return h('div.f-num', h('input.f-input', { ...common, type: 'text', inputmode: 'decimal', maxlength: 14, value: value ?? '', oninput: e => set(e.target.value) }), field.unit ? h('span.f-unit', field.unit) : null);
    case 'date': return h('input.f-input', { ...common, type: 'date', value: value || '', min: '1900-01-01', max: '2200-12-31', oninput: e => set(e.target.value) });
    case 'iban': return h('input.f-input.f-mono', { ...common, type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: 42, value: value ? formatIban(value) : '', placeholder: field.placeholder || 'IT00 X000 0000 0000 0000 0000 000',
      oninput: e => set(compactIban(e.target.value)), onblur: e => { if (e.target.value) e.target.value = formatIban(e.target.value); } });
    case 'taxid': return h('input.f-input.f-mono', { ...common, type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: 40, value: value || '', oninput: e => set(e.target.value.toUpperCase()), onblur: e => { e.target.value = e.target.value.toUpperCase().trim(); } });
    case 'link': {
      const status = h('div.f-linkstatus', { 'aria-live': 'polite' });
      const check = v => {
        clear(status); status.className = 'f-linkstatus';
        if (!v || !v.trim()) return;
        const r = checkLink(v, field.linkKind);
        if (!r.ok) { status.classList.add('bad'); status.append(icon('alert', 15), h('span', r.error)); return; }
        status.classList.add(r.warning ? 'warn' : 'ok');
        status.append(icon(r.warning ? 'alert' : 'checkCircle', 15), h('span', r.warning || (r.provider ? `Link di ${r.provider}` : 'Link valido')));
      };
      const later = debounce(check, 350);
      const inp = h('input.f-input', { ...common, type: 'url', inputmode: 'url', autocomplete: 'off', spellcheck: 'false', maxlength: 2000, value: value || '', placeholder: field.placeholder || 'https://',
        oninput: e => { set(e.target.value.trim()); later(e.target.value); },
        onblur: e => { const r = checkLink(e.target.value, field.linkKind); if (r.ok && r.url !== e.target.value) { e.target.value = r.url; set(r.url); } check(e.target.value); } });
      check(value || '');
      return h('div', inp, status);
    }
    case 'choice': {
      const other = field.other && value && !field.options.includes(value);
      const otherIn = h('input.f-input.f-other', { type: 'text', maxlength: 300, placeholder: 'Altro…', value: other ? value : '', oninput: e => { set(e.target.value); const r = box.querySelector('input[value="__other"]'); if (r) r.checked = true; } });
      const box = h('div.f-options', { role: 'radiogroup', id },
        field.options.map(o => h('label.f-opt', h('input', { type: 'radio', name: id, value: o, checked: value === o, onchange: () => set(o) }), h('span', o))),
        field.other ? h('label.f-opt.f-opt-other', h('input', { type: 'radio', name: id, value: '__other', checked: !!other, onchange: () => { set(otherIn.value); otherIn.focus(); } }), otherIn) : null);
      return box;
    }
    case 'checks': {
      const cur = new Set(Array.isArray(value) ? value : []);
      const others = [...cur].filter(x => !field.options.includes(x));
      const otherIn = h('input.f-input.f-other', { type: 'text', maxlength: 300, placeholder: 'Altro…', value: others[0] || '', oninput: () => emit() });
      const boxes = [];
      const emit = () => {
        const out = boxes.filter(b => b.checked).map(b => b.value);
        if (field.other && otherIn.value.trim()) out.push(otherIn.value.trim());
        set(out);
      };
      return h('div.f-options', { id },
        field.options.map(o => h('label.f-opt', h('input', { type: 'checkbox', value: o, checked: cur.has(o), ref: el => boxes.push(el), onchange: emit }), h('span', o))),
        field.other ? h('label.f-opt.f-opt-other', h('span.f-other-l', 'Altro:'), otherIn) : null);
    }
    case 'select':
      return h('div.f-selectwrap', h('select.f-input', { ...common, onchange: e => set(e.target.value) },
        h('option', { value: '' }, field.placeholder || 'Scegli…'),
        field.options.map(o => h('option', { value: o, selected: value === o }, o))), icon('chevron', 16));
    case 'split': return splitControl(field, value, id, set);
    default: return h('input.f-input', { ...common, type: 'text', maxlength: field.maxLength || 300, value: value || '', oninput: e => set(e.target.value) });
  }
}

function grow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(600, ta.scrollHeight + 2) + 'px'; }

function splitControl(field, value, id, set) {
  let rows = Array.isArray(value) && value.length ? value.map(r => ({ ...r })) : [{ name: '', role: field.roles[0] || '', pct: '100' }];
  const wrap = h('div.f-split', { id });
  const total = h('div.f-split-total');
  const draw = () => {
    clear(wrap);
    rows.forEach((r, i) => {
      wrap.append(h('div.f-split-row',
        h('input.f-input', { type: 'text', placeholder: 'Nome e cognome', maxlength: 120, value: r.name || '', 'aria-label': 'Nome', oninput: e => { r.name = e.target.value; emit(); } }),
        h('div.f-selectwrap', h('select.f-input', { 'aria-label': 'Ruolo', onchange: e => { r.role = e.target.value; emit(); } },
          h('option', { value: '' }, 'Ruolo'), field.roles.map(o => h('option', { value: o, selected: r.role === o }, o))), icon('chevron', 16)),
        h('div.f-num.f-pct', h('input.f-input', { type: 'text', inputmode: 'decimal', maxlength: 6, value: r.pct ?? '', 'aria-label': 'Percentuale', oninput: e => { r.pct = e.target.value; emit(); } }), h('span.f-unit', '%')),
        h('button.f-iconbtn', { type: 'button', title: 'Togli', 'aria-label': 'Togli questa persona', disabled: rows.length === 1, onclick: () => { rows.splice(i, 1); emit(); draw(); } }, icon('x', 16))));
    });
    wrap.append(h('div.f-split-foot', h('button.f-add', { type: 'button', onclick: () => { rows.push({ name: '', role: '', pct: '' }); emit(); draw(); wrap.querySelectorAll('.f-split-row input')[(rows.length - 1) * 2]?.focus(); } }, icon('plus', 16), 'Aggiungi persona'), total));
    paintTotal();
  };
  const paintTotal = () => {
    const tot = rows.reduce((a, r) => a + (parseNumber(r.pct) || 0), 0);
    total.textContent = `Totale ${String(Math.round(tot * 100) / 100).replace('.', ',')}%`;
    total.classList.toggle('bad', field.total100 && Math.abs(tot - 100) > 0.01);
  };
  const emit = () => { set(rows.map(r => ({ name: r.name || '', role: r.role || '', pct: r.pct ?? '' }))); paintTotal(); };
  draw();
  return wrap;
}

/** Elementi senza risposta: testo/titolo, immagine, separatore. */
function staticBlock(field, ctx) {
  const tools = ctx.design ? resizeHandle('w', field.id) : null;
  const ds = { fid: field.id };
  if (field.type === 'image') {
    const src = safeImage(field.src || '');
    const img = src ? h('img', { src, alt: field.alt || '', style: { borderRadius: (field.radius || 0) + 'px', maxHeight: field.maxH ? field.maxH + 'px' : null } }) : (ctx.design ? h('div.f-img-empty', icon('image', 22), h('div', 'Immagine: caricala qui a sinistra')) : null);
    if (!img) return null;
    return h('div.f-img', { dataset: { ...ds, align: field.align || 'c' }, style: widthStyle(field) }, h('figure', img, field.caption ? h('figcaption', field.caption) : null), tools);
  }
  if (field.type === 'divider') {
    return h('div.f-div', { dataset: { ...ds, style: field.style || 'line' }, style: { ...widthStyle(field), paddingTop: (field.size ?? 24) / 2 + 'px', paddingBottom: (field.size ?? 24) / 2 + 'px' } }, h('i'), tools);
  }
  return h('div.f-info', { dataset: ds, style: widthStyle(field) }, field.label ? h('h3.f-info-title', field.label) : null, isEmptyRich(field.help) ? null : richBlock(field.help), tools);
}

/** Un campo completo: etichetta, aiuto, controllo, errore. */
export function fieldBlock(field, answers, ctx, path = field.id, setter = null) {
  if (field.type === 'info' || field.type === 'image' || field.type === 'divider') return staticBlock(field, ctx);
  const set = setter || (v => { answers[field.id] = v; ctx.onChange && ctx.onChange(field.id, v); refreshErr(); });
  const err = h('div.f-err', { id: fieldId(path) + '-err', role: 'alert' });
  const refreshErr = () => {
    if (!ctx.live || !ctx.errors) return;
    const p = ctx.errors[path];
    if (p && !fieldProblem(field, answers[field.id])) { delete ctx.errors[path]; paint(); }
  };
  const paint = () => { const m = ctx.errors && ctx.errors[path]; err.textContent = m || ''; box.classList.toggle('has-err', !!m); };
  const value = setter ? ctx.valueOf(path) : answers[field.id];
  const star = field.required && !ctx.readonly && ctx.showRequired !== false;
  const box = h('div.f-field' + (ctx.locked ? '.locked' : ''), { dataset: { path, fid: field.id }, style: widthStyle(field) },
    h('label.f-q' + (field.hideLabel ? '.f-q-hidden' : ''), { for: fieldId(path) }, field.label, star ? h('span.f-req', { 'aria-label': 'obbligatorio' }, ' *') : null,
      ctx.locked ? h('span.f-lock', icon('lock', 14), 'Firmato') : null),
    !ctx.readonly && !isEmptyRich(field.help) ? richBlock(field.help, {}, 'f-help') : null,
    field.type === 'group' ? groupControl(field, answers, ctx, path) : control(field, value, path, ctx, set),
    field.type === 'link' && !ctx.readonly && !ctx.locked ? h('p.f-hint', linkHint(field, ctx.shareWith)) : null,
    err,
    ctx.design ? resizeHandle('w', field.id) : null);
  paint();
  return box;
}

function groupControl(field, answers, ctx, path) {
  const list = h('div.f-group');
  if (!Array.isArray(answers[field.id])) answers[field.id] = [];
  const items = answers[field.id];
  if (!items.length && field.min > 0 && !ctx.readonly && !ctx.locked) for (let i = 0; i < field.min; i++) items.push({});
  const changed = () => ctx.onChange && ctx.onChange(field.id, items);
  const draw = () => {
    clear(list);
    if (ctx.readonly && !items.length) { list.append(h('div.f-value.empty', '—')); return; }
    items.forEach((item, i) => {
      const sub = {
        ...ctx,
        valueOf: () => undefined,
      };
      const head = h('div.f-item-head', h('span.f-item-n', `${field.itemLabel} ${i + 1}`),
        ctx.readonly || ctx.locked ? null : h('span.f-item-tools',
          h('button.f-iconbtn', { type: 'button', title: 'Sposta su', 'aria-label': 'Sposta su', disabled: i === 0, onclick: () => { items.splice(i - 1, 0, items.splice(i, 1)[0]); changed(); draw(); } }, icon('up', 16)),
          h('button.f-iconbtn', { type: 'button', title: 'Sposta giù', 'aria-label': 'Sposta giù', disabled: i === items.length - 1, onclick: () => { items.splice(i + 1, 0, items.splice(i, 1)[0]); changed(); draw(); } }, icon('down', 16)),
          h('button.f-iconbtn', { type: 'button', title: 'Togli', 'aria-label': `Togli ${field.itemLabel} ${i + 1}`, disabled: items.length <= field.min,
            onclick: () => { const filled = field.fields.some(sf => isFilled(sf, item[sf.id])); if (filled && !confirm(`Togliere ${field.itemLabel.toLowerCase()} ${i + 1}?`)) return; items.splice(i, 1); changed(); draw(); } }, icon('trash', 16))));
      const body = h('div.f-item-body');
      for (const sf of field.fields) {
        const p = `${path}.${i}.${sf.id}`;
        sub.valueOf = () => item[sf.id];
        body.append(fieldBlock(sf, item, sub, p, v => {
          item[sf.id] = v; changed();
          if (ctx.live && ctx.errors && ctx.errors[p] && !fieldProblem(sf, v)) { delete ctx.errors[p]; const b = body.querySelector(`[data-path="${CSS.escape(p)}"]`); if (b) { b.classList.remove('has-err'); b.querySelector('.f-err').textContent = ''; } }
        }));
      }
      list.append(h('div.f-item', head, body));
    });
    if (!ctx.readonly && !ctx.locked && items.length < field.max) {
      list.append(h('button.f-add.f-add-item', { type: 'button', onclick: () => { items.push({}); changed(); draw(); const last = list.querySelectorAll('.f-item'); last[last.length - 1]?.querySelector('input, textarea, select')?.focus(); } }, icon('plus', 17), `Aggiungi ${field.itemLabel.toLowerCase()}`));
    }
  };
  draw();
  return list;
}

/** Una sezione (riquadro con titolo, descrizione e campi). */
export function sectionBlock(section, answers, ctx) {
  return h('section.f-card.f-section', { dataset: { section: section.id } },
    section.title ? h('h2.f-stitle', section.title) : (ctx.design ? h('h2.f-stitle.b-empty-title', 'Sezione senza titolo') : null),
    isEmptyRich(section.desc) ? null : richBlock(section.desc, {}, 'f-sdesc'),
    h('div.f-fields', section.fields.map(f => fieldBlock(f, answers, { ...ctx, locked: ctx.lockContract && section.contract }))));
}

/** Porta in vista e mette il fuoco sul primo campo con errore. */
export function focusFirstError(root) {
  const bad = root.querySelector('.f-field.has-err');
  if (!bad) return;
  bad.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const inp = bad.querySelector('input, textarea, select');
  if (inp) setTimeout(() => inp.focus({ preventScroll: true }), 350);
}
