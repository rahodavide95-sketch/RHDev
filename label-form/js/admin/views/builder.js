/* Costruttore del modulo (come Google Moduli, ma si può cambiare tutto): domande, sezioni,
   immagini, testi, aspetto, contratto e messaggio finale, con l'anteprima dal vivo di come lo vedrà
   l'artista (zoom, telefono/tablet/computer, larghezze da trascinare) e Indietro/Ripeti.
   Si salva da solo. Il link di anteprima mostra il modulo e si aggiorna da solo a ogni modifica. */

import { h, swap, icon, clear, debounce, imageToDataUrl, pickFile, todayYmd } from '../../ui/dom.js';
import { richEditor, richBlock } from '../../ui/rich.js';
import { applyTheme, formHeader, sectionBlock, textOf } from '../../ui/form-view.js';
import { contractDoc } from '../../ui/pdf.js';
import {
  sanitizeForm, FIELD_TYPES, SUB_TYPES, SYSTEM_PLACEHOLDERS, blankField, newId, MUSIC_KEYS, isStatic,
  WIDTHS, widthOf, nearestWidth, fieldById, restoreContract, TEXT_DEFAULTS, TEXT_LABELS, SHOW_DEFAULTS, SHOW_LABELS,
} from '../../core/schema.js';
import { FONTS, PRESETS, applyPreset, sanitizeTheme, themeWarnings, CONTRACT_STYLE, sanitizeContractStyle } from '../../core/theme.js';
import { LINK_KINDS } from '../../core/links.js';
import { contractSnapshot, placeholderLabel } from '../../core/contract.js';
import * as C from '../../core/crypto.js';
import * as K from '../keys.js';
import { A, go, newToken, artistBase } from '../state.js';
import { btn, iconBtn, toast, friendly, field, toggle, selectEl, input, confirmBox, empty, modal, copyText } from '../ui.js';

const clone = x => JSON.parse(JSON.stringify(x));
const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return false; arr.splice(j, 0, arr.splice(i, 1)[0]); return true; };
const reId = f => { const c = clone(f); c.id = newId('f'); if (c.fields) c.fields = c.fields.map(reId); return c; };
const WLABEL = { 25: '¼', 33: '⅓', 50: '½', 67: '⅔', 75: '¾', 100: 'Intera' };
const WLONG = { 25: 'un quarto', 33: 'un terzo', 50: 'metà', 67: 'due terzi', 75: 'tre quarti', 100: 'tutta la riga' };
const DEVICES = { phone: { label: 'Telefono', ic: 'mobile', w: 390 }, tablet: { label: 'Tablet', ic: 'tablet', w: 820 }, desk: { label: 'Computer', ic: 'monitor', w: 0 } };
const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } } };
const editable = el => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
let channel = null;
try { channel = new BroadcastChannel('labelform-preview'); } catch { /* */ }

export async function render(el, id) {
  let row;
  try { row = await A.api.getForm(id); } catch { swap(el, empty('layers', 'Modulo non trovato', '', btn('Torna ai moduli', () => go('#/moduli')))); return; }
  const invites = await A.api.listInvites();
  const usedBy = invites.filter(i => i.form_id === id).length;
  const form = clone(sanitizeForm(row.schema));
  let tab = 'domande', openField = null, saving = false;
  const pv = { hash: row.preview_hash || '', enc: row.preview_enc || '' };
  const previewAnswers = {};
  const labelInfo = () => ({ name: A.settings.label_name, logo: A.settings.logo, signature: A.settings.label_signature, signer: A.settings.label_signer });

  /* ─── salvataggio ─── */
  const status = h('span.save-st', 'Salvato');
  const doSave = async () => {
    if (saving) { save(); return; }
    saving = true; status.textContent = 'Salvo…'; status.className = 'save-st busy';
    try {
      const clean = sanitizeForm(form);
      await A.api.updateForm(id, { title: clean.title, schema: clean });
      A.forms.delete(id);
      status.textContent = 'Salvato'; status.className = 'save-st';
    } catch (x) { status.textContent = 'Non salvato'; status.className = 'save-st bad'; toast(friendly(x), { type: 'error' }); }
    saving = false;
  };
  const save = debounce(doSave, 900);
  const broadcast = () => { if (channel && pv.hash) try { channel.postMessage({ k: pv.hash.slice(0, 16), form: sanitizeForm(form), label: labelInfo() }); } catch { /* */ } };
  const prev = debounce(() => { drawPreview(); broadcast(); }, 200);
  const dirty = () => { status.textContent = 'Modifiche…'; status.className = 'save-st busy'; };

  /* ─── Indietro / Ripeti ─── */
  let hist = [JSON.stringify(form)], pos = 0;
  const undoBtn = iconBtn('undo', 'Indietro (Ctrl+Z)', () => undo());
  const redoBtn = iconBtn('redo', 'Ripeti (Ctrl+Maiusc+Z)', () => redo());
  const paintHist = () => { undoBtn.disabled = pos === 0; redoBtn.disabled = pos >= hist.length - 1; };
  const commit = () => {
    const s = JSON.stringify(form);
    if (s === hist[pos]) return;
    hist = hist.slice(0, pos + 1); hist.push(s);
    if (hist.length > 150) hist.shift();
    pos = hist.length - 1; paintHist();
  };
  const commitSoon = debounce(commit, 600);
  const restore = s => {
    for (const k of Object.keys(form)) delete form[k];
    Object.assign(form, JSON.parse(s));
    titleIn.value = form.title;
    if (openField && !fieldById(form, openField)) openField = null;
    dirty(); save(); drawTabs(); drawPanel(); drawPreview(); broadcast(); paintHist();
  };
  function undo() { commitSoon.flush(); if (pos > 0) { pos--; restore(hist[pos]); } else toast('Niente da annullare'); }
  function redo() { commitSoon.flush(); if (pos < hist.length - 1) { pos++; restore(hist[pos]); } else toast('Niente da ripetere'); }
  const changed = (redraw = false) => { dirty(); save(); prev(); if (redraw) { drawPanel(); commit(); } else commitSoon(); };
  const onKey = e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if ((k === 'z' && !e.shiftKey) && !editable(document.activeElement)) { e.preventDefault(); undo(); }
    else if (((k === 'z' && e.shiftKey) || k === 'y') && !editable(document.activeElement)) { e.preventDefault(); redo(); }
  };
  document.addEventListener('keydown', onKey);

  /* ─── anteprima: cornice, zoom, dispositivo ─── */
  const view = { dev: DEVICES[ls.get('labelform-b-dev')] ? ls.get('labelform-b-dev') : 'desk', zoom: Math.min(2, Math.max(0.3, Number(ls.get('labelform-b-zoom')) || 1)) };
  const previewInner = h('div.b-prev-inner');
  const frame = h('div.fx.b-frame', previewInner);
  const preview = h('div.b-prev', frame);
  const zoomLabel = h('button.b-zoom-v', { type: 'button', title: 'Dimensione normale (100%)', onclick: () => setZoom(1) });
  const devBtns = Object.entries(DEVICES).map(([k, d]) => h('button.seg-b', { type: 'button', title: d.label, 'aria-label': d.label, dataset: { dev: k }, onclick: () => { view.dev = k; ls.set('labelform-b-dev', k); paintFrame(); if (k !== 'desk') fitZoom(); } }, icon(d.ic, 17)));
  function setZoom(z) { view.zoom = Math.round(Math.min(2, Math.max(0.3, z)) * 100) / 100; ls.set('labelform-b-zoom', String(view.zoom)); paintFrame(); }
  function fitZoom() {
    const avail = preview.clientWidth - 32;
    const w = DEVICES[view.dev].w || 1100;
    setZoom(avail > 0 ? Math.min(1, avail / w) : 1);
  }
  function paintFrame() {
    frame.dataset.dev = view.dev;
    frame.style.zoom = String(view.zoom);
    zoomLabel.textContent = Math.round(view.zoom * 100) + '%';
    devBtns.forEach(b => b.classList.toggle('on', b.dataset.dev === view.dev));
  }
  preview.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(view.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); } }, { passive: false });
  const pvBtn = btn('Link anteprima', () => previewLink(), { ic: 'link', kind: 'ghost small' });
  const prevBar = h('div.b-prev-bar',
    h('span.b-prev-label', icon('eye', 14), 'Come lo vede l\'artista'),
    h('span.spacer'),
    h('div.seg', devBtns),
    h('div.seg', iconBtn('zoomOut', 'Rimpicciolisci', () => setZoom(view.zoom - 0.1), 'tiny'), zoomLabel, iconBtn('zoomIn', 'Ingrandisci', () => setZoom(view.zoom + 0.1), 'tiny'), iconBtn('fit', 'Adatta alla finestra', () => fitZoom(), 'tiny')),
    pvBtn);

  function drawPreview() {
    const y = preview.scrollTop, x = preview.scrollLeft;
    const clean = sanitizeForm(form);
    applyTheme(frame, clean.theme);
    clear(previewInner);
    const label = labelInfo();
    const head = () => formHeader({ form: clean, label, release: { title: 'Esempio EP', catalog: 'CAT001' }, artist: 'Nome artista', design: true });
    const ctx = { shareWith: clean.shareWith || A.settings.notify_email, onChange: () => {}, design: true, showRequired: clean.show.required };
    const nav = () => h('div.f-actions', h('button.f-btn.ghost', { type: 'button' }, icon('back', 18), textOf(clean, 'back')), h('button.f-btn', { type: 'button' }, textOf(clean, 'next'), icon('arrowR', 18)));
    const progress = (i, n, name) => clean.show.progress ? h('div.f-progress', h('div.f-progress-row', h('span', textOf(clean, 'step', { n: i, tot: n })), h('span', name)), h('div.f-bar', h('i', { style: { width: Math.round(i / n * 100) + '%' } }))) : null;
    if (tab === 'contratto') {
      const snap = contractSnapshot({ form: clean, answers: previewAnswers, ctx: { label: label.name, signer: label.signer, release: 'Esempio EP', catalog: 'CAT001', artist: 'Nome artista', artistPct: 50 }, inviteId: 'anteprima',
        labelSignature: clean.contract.labelSigns ? label.signature : '', signature: { name: '', place: '', date: todayYmd(), time: '', png: '' } });
      previewInner.append(h('div.f-wrap', clean.contract.enabled
        ? h('section.f-card', h('h2.f-stitle', textOf(clean, 'contractTitle')), h('p.f-note', textOf(clean, 'contractNote')), h('p.f-note.b-sample', icon('info', 14), ' Con dati d\'esempio: gli spazi vuoti si riempiono con i dati dell\'artista.'), contractDoc(snap, { label }))
        : h('div.f-card.f-msg', h('h2', 'Contratto spento'), h('p', 'Accendilo qui a sinistra per farlo firmare agli artisti.'))));
    } else if (tab === 'testi') {
      const n = clean.sections.length + (clean.contract.enabled ? 2 : 1);
      previewInner.append(h('div.f-wrap', head(), progress(1, n, clean.sections[0].title || 'Parte 1'), sectionBlock(clean.sections[0], previewAnswers, ctx), nav(),
        h('section.f-card', h('h2.f-stitle', textOf(clean, 'reviewTitle')), h('div.f-actions', h('button.f-btn.ghost', { type: 'button' }, icon('back', 18), textOf(clean, 'back')), h('button.f-btn', { type: 'button' }, icon('send', 18), textOf(clean, 'send')))),
        h('div.f-card.f-msg', h('div.f-bigicon.ok', icon('checkCircle', 30)), h('h2', textOf(clean, 'doneTitle')), richBlock(clean.done, {}, 'f-intro')),
        clean.show.foot ? h('p.f-foot', icon('lock', 14), h('span', textOf(clean, 'foot', { etichetta: label.name || 'l\'etichetta' }))) : null));
    } else {
      const n = clean.sections.length + (clean.contract.enabled ? 2 : 1);
      previewInner.append(h('div.f-wrap', head(), progress(1, n, clean.sections[0].title || 'Parte 1'),
        clean.sections.map(s => sectionBlock(s, previewAnswers, ctx)), nav(),
        clean.show.foot ? h('p.f-foot', icon('lock', 14), h('span', textOf(clean, 'foot', { etichetta: label.name || 'l\'etichetta' }))) : null));
    }
    markPicked();
    preview.scrollTop = y; preview.scrollLeft = x;
  }
  const markPicked = () => {
    frame.querySelectorAll('.is-picked').forEach(n => n.classList.remove('is-picked'));
    if (openField) frame.querySelectorAll(`[data-fid="${CSS.escape(openField)}"]`).forEach(n => n.classList.add('is-picked'));
  };
  // tocco nell'anteprima → apre quell'elemento a sinistra
  frame.addEventListener('click', e => {
    if (e.target.closest('.b-rs')) return;
    const fEl = e.target.closest('[data-fid]');
    if (fEl) {
      openField = fEl.dataset.fid;
      if (tab !== 'domande') { tab = 'domande'; drawTabs(); }
      drawPanel(); markPicked();
      requestAnimationFrame(() => { const r = panel.querySelector(`.b-field[data-fid="${CSS.escape(openField)}"]`); if (r) r.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
      return;
    }
    if (e.target.closest('.f-cover') || e.target.closest('.f-logo')) { tab = 'aspetto'; drawTabs(); drawPanel(); drawPreview(); return; }
    if (e.target.closest('.f-actions, .f-foot, .f-progress')) { tab = 'testi'; drawTabs(); drawPanel(); drawPreview(); return; }
    if (e.target.closest('.f-titlecard')) { if (tab !== 'domande') { tab = 'domande'; drawTabs(); drawPanel(); drawPreview(); } panel.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    const sec = e.target.closest('[data-section]');
    if (sec && tab === 'domande') { const c = panel.querySelector(`.b-sec[data-sid="${CSS.escape(sec.dataset.section)}"]`); if (c) c.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  });
  // maniglie: larghezza dei campi, altezza della testata, grandezza del logo
  frame.addEventListener('pointerdown', e => {
    const hnd = e.target.closest('.b-rs');
    if (!hnd) return;
    e.preventDefault(); e.stopPropagation();
    const kind = hnd.dataset.rs;
    const tip = h('div.b-size-tip');
    document.body.append(tip);
    document.body.classList.add('b-resizing');
    hnd.setPointerCapture(e.pointerId);
    const z = view.zoom || 1;
    const sx = e.clientX, sy = e.clientY;
    const t = form.theme;
    let apply = () => {};
    let onMove = () => {};
    if (kind === 'w') {
      const box = hnd.parentElement, cont = box.parentElement;
      const f = fieldById(form, hnd.dataset.target);
      if (!f) return;
      const br = box.getBoundingClientRect(), cr = cont.getBoundingClientRect();
      let w = widthOf(f);
      onMove = ev => { w = nearestWidth((ev.clientX - br.left) / cr.width * 100); box.style.setProperty('--fw', String(w / 100)); tip.textContent = 'Larghezza: ' + WLONG[w]; };
      apply = () => { if (w !== widthOf(f)) { f.w = w; delete f.half; openField = f.id; changed(true); } };
    } else if (kind === 'cover') {
      const cover = hnd.parentElement, start = sanitizeTheme(t).headerHeight;
      let v = start;
      onMove = ev => { v = Math.round(Math.min(600, Math.max(60, start + (ev.clientY - sy) / z))); cover.style.height = v + 'px'; tip.textContent = `Altezza della testata: ${v}px`; };
      apply = () => { if (v !== start) { t.headerHeight = v; t.preset = t.preset || 'custom'; changed(true); } };
    } else if (kind === 'logo') {
      const img = hnd.parentElement.querySelector('.f-logo'), start = sanitizeTheme(t).logoSize;
      let v = start;
      onMove = ev => { v = Math.round(Math.min(240, Math.max(20, start + Math.max(ev.clientX - sx, ev.clientY - sy) / z))); img.style.width = img.style.height = v + 'px'; tip.textContent = `Logo: ${v}px`; };
      apply = () => { if (v !== start) { t.logoSize = v; changed(true); } };
    }
    const move = ev => { onMove(ev); tip.style.left = ev.clientX + 14 + 'px'; tip.style.top = ev.clientY + 14 + 'px'; };
    const end = () => {
      hnd.removeEventListener('pointermove', move); hnd.removeEventListener('pointerup', end); hnd.removeEventListener('pointercancel', end);
      tip.remove(); document.body.classList.remove('b-resizing');
      apply();
    };
    move(e);
    hnd.addEventListener('pointermove', move); hnd.addEventListener('pointerup', end); hnd.addEventListener('pointercancel', end);
  });

  /* ─── pannelli ─── */
  const panel = h('div.b-panel');
  const tabsBar = h('div.tabs.b-tabs');
  const TABS = [['domande', 'Domande', 'list'], ['aspetto', 'Aspetto', 'palette'], ['contratto', 'Contratto', 'pen'], ['testi', 'Testi', 'type']];
  const drawTabs = () => { clear(tabsBar); for (const [k, l, ic] of TABS) tabsBar.append(h('button.tab' + (tab === k ? '.on' : ''), { type: 'button', onclick: () => { tab = k; drawTabs(); drawPanel(); drawPreview(); } }, icon(ic, 16), l)); };

  function drawPanel() {
    const y = panel.scrollTop;
    clear(panel);
    if (tab === 'domande') panel.append(questionsPanel());
    if (tab === 'aspetto') panel.append(lookPanel());
    if (tab === 'contratto') panel.append(contractPanel());
    if (tab === 'testi') panel.append(textsPanel());
    panel.scrollTop = y;
  }

  /* piccoli controlli */
  const slider = (label, min, max, value, unit, on, step = 1) => {
    const lab = h('span.fld-l', `${label}: ${value}${unit}`);
    return h('label.fld', lab, h('input.range', { type: 'range', min, max, step, value, oninput: e => { const v = Number(e.target.value); lab.textContent = `${label}: ${v}${unit}`; on(v); } }));
  };
  const colorField = (get, set, label) => {
    const hex = input({ type: 'text', value: get(), maxlength: 7, class: 'inp hex', oninput: e => { if (/^#[0-9a-f]{6}$/i.test(e.target.value)) { pickEl.value = e.target.value; set(e.target.value.toLowerCase()); } } });
    const pickEl = h('input.swatch', { type: 'color', value: get(), oninput: e => { hex.value = e.target.value; set(e.target.value); } });
    return h('label.color-f', h('span', label), h('span.color-in', pickEl, hex));
  };
  const widthPicker = f => h('div.fld', h('span.fld-l', 'Larghezza'),
    h('div.wpick', WIDTHS.map(w => h('button.wpick-b' + (widthOf(f) === w ? '.on' : ''), { type: 'button', title: 'Occupa ' + WLONG[w], onclick: () => { f.w = w; delete f.half; changed(true); } },
      h('span.wpick-bar', h('i', { style: { width: w + '%' } })), h('span', WLABEL[w])))),
    h('span.fld-h', 'Oppure trascina il bordo destro del campo nell\'anteprima.'));

  /* domande */
  function typePicker(types, onPick) {
    return h('div.type-pop', types.map(t => h('button.type-i', { type: 'button', onclick: e => { e.currentTarget.parentElement.remove(); onPick(t); } }, icon(FIELD_TYPES[t].icon, 18), FIELD_TYPES[t].label)));
  }
  const togglePicker = (b, types, onPick) => { if (b.nextSibling && b.nextSibling.classList && b.nextSibling.classList.contains('type-pop')) { b.nextSibling.remove(); return; } b.after(typePicker(types, onPick)); };
  function optionsEditor(f) {
    const box = h('div.opts');
    const draw = () => {
      clear(box);
      f.options.forEach((o, i) => box.append(h('div.opt-row',
        h('span.opt-dot', icon(f.type === 'checks' ? 'checkbox' : f.type === 'select' ? 'chevronR' : 'radio', 16)),
        input({ type: 'text', value: o, maxlength: 200, oninput: e => { f.options[i] = e.target.value; changed(); } }),
        iconBtn('up', 'Su', () => { if (move(f.options, i, -1)) { changed(); draw(); } }, 'tiny'),
        iconBtn('down', 'Giù', () => { if (move(f.options, i, 1)) { changed(); draw(); } }, 'tiny'),
        iconBtn('x', 'Togli', () => { if (f.options.length > 1) { f.options.splice(i, 1); changed(); draw(); } }, 'tiny'))));
      box.append(h('div.row', btn('Opzione', () => { f.options.push(`Opzione ${f.options.length + 1}`); changed(); draw(); box.querySelectorAll('input')[f.options.length - 1]?.select(); }, { ic: 'plus', kind: 'ghost small' }),
        btn('Incolla un elenco', () => {
          const t = prompt('Una opzione per riga (sostituiscono quelle attuali):', f.options.join('\n'));
          if (t === null) return;
          const list = t.split(/\n/).map(x => x.trim()).filter(Boolean);
          if (list.length) { f.options = [...new Set(list)].slice(0, 100); changed(); draw(); }
        }, { ic: 'para', kind: 'ghost small' }),
        f.type === 'select' && !f.label.toLowerCase().includes('tonalit') ? btn('Tonalità musicali', () => { f.options = [...MUSIC_KEYS]; changed(); draw(); }, { ic: 'music', kind: 'ghost small' }) : null));
    };
    draw();
    return box;
  }
  function imageEditor(f) {
    const box = h('div.b-stack');
    box.append(f.src ? h('div.img-prev', h('img', { src: f.src, alt: '' })) : h('p.muted.small', 'Nessuna immagine ancora.'),
      h('div.row',
        btn(f.src ? 'Cambia immagine' : 'Carica immagine', async () => {
          const file = await pickFile('image/png,image/jpeg,image/webp,image/gif');
          if (!file) return;
          try { f.src = await imageToDataUrl(file, { max: 1600, maxChars: 480000, keepAlpha: file.type === 'image/png' }); changed(true); }
          catch (x) { toast(x.message === 'too_big' ? 'Immagine troppo pesante: prova con una più piccola' : 'Scegli un\'immagine JPG, PNG o WebP', { type: 'error' }); }
        }, { ic: 'image', kind: 'ghost small' }),
        f.src ? btn('Togli immagine', () => { f.src = ''; changed(true); }, { ic: 'x', kind: 'ghost small' }) : null),
      h('div.row2',
        field('Descrizione (per chi non vede l\'immagine)', input({ type: 'text', value: f.alt || '', maxlength: 200, oninput: e => { f.alt = e.target.value; changed(); } })),
        field('Didascalia sotto (facoltativa)', input({ type: 'text', value: f.caption || '', maxlength: 300, oninput: e => { f.caption = e.target.value; changed(); } }))),
      h('div.row3',
        field('Allineamento', selectEl([['l', 'A sinistra'], ['c', 'Al centro'], ['r', 'A destra']], f.align || 'c', v => { f.align = v; changed(); })),
        slider('Angoli', 0, 60, f.radius || 0, 'px', v => { f.radius = v; changed(); }),
        slider('Altezza massima', 0, 1200, f.maxH || 0, f.maxH ? 'px' : ' (libera)', v => { f.maxH = v; changed(); }, 20)));
    return box;
  }
  function fieldEditor(f, list, sub) {
    const types = sub ? SUB_TYPES : Object.keys(FIELD_TYPES);
    const box = h('div.fe');
    const typeSel = field('Tipo', selectEl(types.map(t => [t, FIELD_TYPES[t].label]), f.type, v => {
      const keep = { id: f.id, label: f.label, help: f.help, required: f.required, checklist: f.checklist, w: widthOf(f) };
      for (const k of Object.keys(f)) delete f[k];
      Object.assign(f, blankField(v), keep);
      changed(true);
    }));
    if (f.type === 'image' || f.type === 'divider') {
      box.append(h('div.row2', field('Nome (solo per te, nell\'elenco)', input({ type: 'text', value: f.label, maxlength: 300, placeholder: FIELD_TYPES[f.type].label, oninput: e => { f.label = e.target.value; headLabel(f); changed(); } })), typeSel));
      if (f.type === 'image') box.append(imageEditor(f));
      else box.append(h('div.row2',
        field('Stile', selectEl([['line', 'Linea'], ['dots', 'Puntini'], ['space', 'Solo spazio']], f.style || 'line', v => { f.style = v; changed(); })),
        slider('Spazio', 0, 200, f.size ?? 24, 'px', v => { f.size = v; changed(); })));
      box.append(widthPicker(f));
      return box;
    }
    const lbl = input({ type: 'text', value: f.label, maxlength: 300, placeholder: f.type === 'info' ? 'Titolo (facoltativo)' : 'Domanda', oninput: e => { f.label = e.target.value; headLabel(f); changed(); } });
    box.append(h('div.row2', field(f.type === 'info' ? 'Titolo' : 'Domanda', lbl), typeSel));
    box.append(field(f.type === 'info' ? 'Testo' : 'Spiegazione (facoltativa)', richEditor({ value: f.help, compact: true, hint: f.type === 'info' ? 'Scrivi il testo…' : 'Aiuta l\'artista: formato, dimensioni, esempi…', onChange: d => { f.help = d; changed(); } }).el));
    if (f.type === 'info') { box.append(widthPicker(f)); return box; }

    box.append(h('div.tgl-row',
      toggle('Obbligatoria', !!f.required, v => { f.required = v; if (!sub && v) f.checklist = true; changed(true); }),
      sub ? null : toggle('Nella checklist', !!f.checklist, v => { f.checklist = v; changed(); }, 'La vedi nella release: "manca…"'),
      toggle('Dato riservato', !!f.sensitive, v => { f.sensitive = v; changed(); }, 'Nascosto nelle email e nella bozza'),
      toggle('Nascondi il titolo', !!f.hideLabel, v => { f.hideLabel = v; changed(); }, 'Resta solo il campo')));
    box.append(widthPicker(f));
    if (['short', 'long', 'email', 'phone', 'number', 'link', 'iban', 'taxid', 'select'].includes(f.type)) {
      box.append(field(f.type === 'select' ? 'Testo prima della scelta' : 'Esempio dentro il campo', input({ type: 'text', value: f.placeholder || '', maxlength: 200, oninput: e => { f.placeholder = e.target.value; changed(); } })));
    }
    if (f.type === 'short' || f.type === 'long') box.append(h('div.row2',
      field('Lunghezza massima (caratteri)', input({ type: 'number', min: 1, max: f.type === 'long' ? 20000 : 2000, value: f.maxLength || (f.type === 'long' ? 5000 : 300), oninput: e => { f.maxLength = Number(e.target.value) || undefined; changed(); } })),
      f.type === 'long' ? slider('Altezza del riquadro', 2, 30, f.rows || 4, ' righe', v => { f.rows = v; changed(); }) : null));
    if (f.type === 'number') {
      box.append(h('div.row3',
        field('Minimo', input({ type: 'number', value: f.min ?? '', oninput: e => { f.min = e.target.value === '' ? null : Number(e.target.value); changed(); } })),
        field('Massimo', input({ type: 'number', value: f.max ?? '', oninput: e => { f.max = e.target.value === '' ? null : Number(e.target.value); changed(); } })),
        field('Unità', input({ type: 'text', maxlength: 20, value: f.unit || '', placeholder: 'es. BPM', oninput: e => { f.unit = e.target.value; changed(); } }))),
      toggle('Accetta i decimali', !!f.decimals, v => { f.decimals = v; changed(); }));
    }
    if (f.type === 'link') box.append(field('Che link accetta', selectEl(Object.entries(LINK_KINDS).map(([k, v]) => [k, v.label]), f.linkKind || 'any', v => { f.linkKind = v; changed(); }), 'Il modulo controlla il link e segnala errori di battitura'));
    if (['choice', 'checks', 'select'].includes(f.type)) {
      box.append(field('Opzioni', optionsEditor(f)));
      if (f.type !== 'select') box.append(toggle('Aggiungi "Altro…" (risposta libera)', !!f.other, v => { f.other = v; changed(); }));
    }
    if (f.type === 'split') {
      box.append(toggle('Le percentuali devono fare 100', f.total100 !== false, v => { f.total100 = v; changed(); }),
        field('Ruoli (separati da virgola)', input({ type: 'text', value: (f.roles || []).join(', '), oninput: e => { f.roles = e.target.value.split(',').map(x => x.trim()).filter(Boolean); changed(); } })));
    }
    if (f.type === 'group') {
      box.append(h('div.row3',
        field('Nome di ogni elemento', input({ type: 'text', maxlength: 60, value: f.itemLabel || '', placeholder: 'Traccia', oninput: e => { f.itemLabel = e.target.value; changed(); } })),
        field('Minimo', input({ type: 'number', min: 0, max: 50, value: f.min ?? 0, oninput: e => { f.min = Number(e.target.value) || 0; changed(); } })),
        field('Massimo', input({ type: 'number', min: 1, max: 100, value: f.max ?? 20, oninput: e => { f.max = Number(e.target.value) || 20; changed(); } }))));
      const subs = h('div.b-subs');
      f.fields.forEach((sf, i) => subs.append(fieldRow(sf, f.fields, i, true)));
      const addSub = btn('Aggiungi campo', e => togglePicker(e.currentTarget, SUB_TYPES, t => { const nf = blankField(t); f.fields.push(nf); openField = nf.id; changed(true); }), { ic: 'plus', kind: 'ghost small' });
      box.append(h('div.fld', h('span.fld-l', 'Campi di ogni elemento'), subs, h('div', addSub)));
    }
    if (!sub) {
      const others = form.sections.filter(s => !s.fields.includes(f));
      if (others.length) box.append(field('Sposta in un\'altra sezione', selectEl([['', '—'], ...others.map(s => [s.id, s.title || 'Sezione senza titolo'])], '', v => {
        const to = form.sections.find(s => s.id === v); if (!to) return;
        list.splice(list.indexOf(f), 1); to.fields.push(f); changed(true);
      })));
    }
    return box;
  }
  const headLabels = new Map();
  const nameOf = f => f.label || (isStatic(f) ? FIELD_TYPES[f.type].label : 'Domanda senza titolo');
  const headLabel = f => { const n = headLabels.get(f.id); if (n) n.textContent = nameOf(f); };

  /* trascinamento per riordinare (computer); su telefono restano le frecce */
  let drag = null;
  const clearMarks = () => panel.querySelectorAll('.drop-before, .drop-after, .drop-into, .dragging').forEach(n => n.classList.remove('drop-before', 'drop-after', 'drop-into', 'dragging'));
  const grip = (onStart, title = 'Trascina per spostare') => h('span.bf-grip', { draggable: 'true', title, 'aria-hidden': 'true',
    ondragstart: e => { onStart(e); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', 'label-form'); } catch { /* */ } },
    ondragend: () => { drag = null; clearMarks(); } }, icon('grip', 16));

  function fieldRow(f, list, i, sub = false) {
    const open = openField === f.id || (f.type === 'group' && f.fields.some(x => x.id === openField));
    const lab = h('span.bf-l', nameOf(f));
    headLabels.set(f.id, lab);
    const head = h('div.bf-head', { onclick: e => { if (e.target.closest('.icon-btn, .bf-grip')) return; openField = open ? null : f.id; drawPanel(); markPicked(); } },
      grip(() => { drag = { kind: sub ? 'sub' : 'field', f, list }; requestAnimationFrame(() => rowEl.classList.add('dragging')); }),
      h('span.bf-ic', icon(FIELD_TYPES[f.type].icon, 17)),
      h('span.bf-t', lab, h('small', FIELD_TYPES[f.type].label, widthOf(f) < 100 ? ' · ' + WLABEL[widthOf(f)] : '', f.required ? ' · obbligatoria' : '', !sub && f.checklist ? ' · checklist' : '', f.sensitive ? ' · riservato' : '')),
      h('span.bf-tools',
        iconBtn('up', 'Su', () => { if (move(list, i, -1)) changed(true); }, 'tiny'),
        iconBtn('down', 'Giù', () => { if (move(list, i, 1)) changed(true); }, 'tiny'),
        iconBtn('copy', 'Duplica', () => { const c = reId(f); if (f.label) c.label = f.label + ' (copia)'; list.splice(i + 1, 0, c); openField = c.id; changed(true); }, 'tiny'),
        iconBtn('trash', 'Elimina', async () => {
          if (usedBy && !isStatic(f) && !(await confirmBox({ title: 'Eliminare la domanda?', text: 'Il modulo è già in uso: le risposte già inviate a questa domanda restano visibili nell\'invio come "campi non più nel modulo".', ok: 'Elimina', danger: true }))) return;
          list.splice(list.indexOf(f), 1); changed(true); toast('Eliminato. Puoi tornare indietro con "Indietro".');
        }, 'tiny danger')),
      icon(open ? 'up' : 'down', 18, 'bf-chev'));
    const rowEl = h('div.b-field' + (open ? '.open' : '') + (sub ? '.sub' : ''), { dataset: { fid: f.id } }, head, open ? fieldEditor(f, list, sub) : null);
    rowEl.addEventListener('dragover', e => {
      if (!drag || drag.f === f || drag.kind !== (sub ? 'sub' : 'field') || (sub && drag.list !== list)) return;
      e.preventDefault(); e.stopPropagation();
      const r = rowEl.getBoundingClientRect();
      clearMarks(); rowEl.classList.add(e.clientY > r.top + r.height / 2 ? 'drop-after' : 'drop-before');
    });
    rowEl.addEventListener('drop', e => {
      if (!drag || drag.f === f || drag.kind !== (sub ? 'sub' : 'field')) return;
      e.preventDefault(); e.stopPropagation();
      const after = rowEl.classList.contains('drop-after');
      drag.list.splice(drag.list.indexOf(drag.f), 1);
      list.splice(list.indexOf(f) + (after ? 1 : 0), 0, drag.f);
      openField = drag.f.id; drag = null; changed(true);
    });
    return rowEl;
  }

  function questionsPanel() {
    const out = h('div.b-stack');
    if (usedBy) out.append(h('div.note', icon('info', 16), h('span', `Questo modulo è usato da ${usedBy} ${usedBy === 1 ? 'artista' : 'artisti'}: le modifiche valgono subito anche per loro. I dati già inviati non si perdono.`)));
    out.append(h('div.card.b-sec',
      h('div.b-sec-head', h('span.b-sec-n', 'Titolo e introduzione')),
      field('Titolo del modulo', input({ type: 'text', value: form.title, maxlength: 200, oninput: e => { form.title = e.target.value; titleIn.value = e.target.value; changed(); } })),
      field('Introduzione', richEditor({ value: form.intro, onChange: d => { form.intro = d; changed(); }, hint: 'Un messaggio di benvenuto per l\'artista…' }).el),
      field('Email con cui condividere le cartelle (facoltativa)', input({ type: 'email', value: form.shareWith || '', placeholder: A.settings.notify_email || 'la tua email', oninput: e => { form.shareWith = e.target.value.trim(); changed(); } }),
        'Sotto i campi dei link suggeriamo di condividere i file con questa email (vuoto = email degli avvisi)')));
    form.sections.forEach((s, si) => {
      const fields = h('div.b-fields');
      s.fields.forEach((f, fi) => fields.append(fieldRow(f, s.fields, fi)));
      if (!s.fields.length) fields.append(h('p.muted.small.b-drop-here', 'Sezione vuota: aggiungi un elemento o trascinalo qui.'));
      fields.addEventListener('dragover', e => { if (!drag || drag.kind !== 'field' || s.fields.length) return; e.preventDefault(); clearMarks(); fields.classList.add('drop-into'); });
      fields.addEventListener('drop', e => { if (!drag || drag.kind !== 'field' || s.fields.length) return; e.preventDefault(); drag.list.splice(drag.list.indexOf(drag.f), 1); s.fields.push(drag.f); openField = drag.f.id; drag = null; changed(true); });
      const addQ = btn('Aggiungi', e => togglePicker(e.currentTarget, Object.keys(FIELD_TYPES), t => { const nf = blankField(t); s.fields.push(nf); openField = nf.id; changed(true); }), { ic: 'plus', kind: 'ghost' });
      const quick = (t, ic, label) => btn(label, () => { const nf = blankField(t); s.fields.push(nf); openField = nf.id; changed(true); }, { ic, kind: 'ghost small' });
      const card = h('div.card.b-sec' + (s.contract ? '.contract' : ''), { dataset: { sid: s.id } },
        h('div.b-sec-head',
          grip(() => { drag = { kind: 'section', s }; requestAnimationFrame(() => card.classList.add('dragging')); }, 'Trascina per spostare la sezione'),
          h('span.b-sec-n', `Sezione ${si + 1} di ${form.sections.length}`),
          h('span.bf-tools',
            iconBtn('up', 'Sposta su', () => { if (move(form.sections, si, -1)) changed(true); }, 'tiny'),
            iconBtn('down', 'Sposta giù', () => { if (move(form.sections, si, 1)) changed(true); }, 'tiny'),
            iconBtn('copy', 'Duplica sezione', () => { const c = clone(s); c.id = newId('s'); c.title = s.title ? s.title + ' (copia)' : ''; c.fields = c.fields.map(reId); form.sections.splice(si + 1, 0, c); changed(true); }, 'tiny'),
            iconBtn('trash', 'Elimina sezione', async () => {
              if (form.sections.length === 1) { toast('Serve almeno una sezione'); return; }
              if (s.fields.length && !(await confirmBox({ title: 'Eliminare la sezione?', text: `Spariscono anche i suoi ${s.fields.length} elementi. Puoi tornare indietro con "Indietro".`, ok: 'Elimina', danger: true }))) return;
              form.sections.splice(si, 1); changed(true);
            }, 'tiny danger'))),
        input({ type: 'text', class: 'inp b-sec-title', value: s.title, maxlength: 200, placeholder: 'Titolo della sezione (vuoto = nessun titolo)', oninput: e => { s.title = e.target.value; changed(); } }),
        richEditor({ value: s.desc, compact: true, hint: 'Descrizione della sezione (facoltativa)', onChange: d => { s.desc = d; changed(); } }).el,
        toggle('Dati del contratto', !!s.contract, v => { s.contract = v; changed(true); }, 'Vanno nel contratto e si bloccano dopo la firma'),
        fields,
        h('div.row', addQ, quick('info', 'info', 'Testo'), quick('image', 'image', 'Immagine'), quick('divider', 'divider', 'Separatore')));
      card.addEventListener('dragover', e => {
        if (!drag || drag.kind !== 'section' || drag.s === s) return;
        e.preventDefault();
        const r = card.getBoundingClientRect();
        clearMarks(); card.classList.add(e.clientY > r.top + r.height / 2 ? 'drop-after' : 'drop-before');
      });
      card.addEventListener('drop', e => {
        if (!drag || drag.kind !== 'section' || drag.s === s) return;
        e.preventDefault();
        const after = card.classList.contains('drop-after');
        form.sections.splice(form.sections.indexOf(drag.s), 1);
        form.sections.splice(form.sections.indexOf(s) + (after ? 1 : 0), 0, drag.s);
        drag = null; changed(true);
      });
      out.append(card);
    });
    out.append(btn('Aggiungi sezione', () => { form.sections.push({ id: newId('s'), title: '', desc: [], contract: false, fields: [] }); changed(true); requestAnimationFrame(() => { panel.scrollTop = panel.scrollHeight; }); }, { ic: 'plus', kind: 'ghost block' }));
    return out;
  }

  /* aspetto */
  function lookPanel() {
    const t = form.theme = sanitizeTheme(form.theme);
    const set = (k, v, redraw = false) => { t[k] = v; t.preset = 'custom'; changed(redraw); };
    const presets = h('div.presets', Object.entries(PRESETS).map(([k, p]) => h('button.preset' + (t.preset === k ? '.on' : ''), { type: 'button', onclick: () => { form.theme = applyPreset(t, k); changed(true); } },
      h('span.preset-sw', { style: { background: p.bg } }, h('i', { style: { background: p.card } }), h('b', { style: { background: p.accent } })), p.label)));
    const warns = themeWarnings(t);
    const fonts = Object.entries(FONTS).map(([k, f]) => [k, f.label]);
    return h('div.b-stack',
      h('div.card.b-sec', h('h3', 'Stili pronti'), presets),
      h('div.card.b-sec', h('h3', 'Colori'), h('div.colors',
        colorField(() => t.bg, v => set('bg', v), 'Sfondo'), colorField(() => t.bg2, v => set('bg2', v), 'Sfondo 2'), colorField(() => t.card, v => set('card', v), 'Riquadri'),
        colorField(() => t.text, v => set('text', v), 'Testo'), colorField(() => t.accent, v => set('accent', v), 'Colore principale')),
        warns.map(w => h('div.note.warn', icon('alert', 16), h('span', w))),
        h('div.row3',
          field('Sfondo', selectEl([['solid', 'Tinta unita'], ['gradient', 'Sfumato'], ['glow', 'Con luce']], t.bgStyle, v => set('bgStyle', v))),
          field('Riquadri', selectEl([['glass', 'Vetro'], ['shadow', 'Ombra'], ['border', 'Bordo'], ['flat', 'Piatti']], t.cardStyle, v => set('cardStyle', v))),
          field('Pulsanti', selectEl([['fill', 'Pieni'], ['outline', 'Contorno'], ['pill', 'Pillola']], t.button, v => set('button', v))))),
      h('div.card.b-sec', h('h3', 'Caratteri e misure'),
        h('div.row2',
          field('Carattere dei titoli', selectEl(fonts, t.titleFont, v => set('titleFont', v))),
          field('Carattere del testo', selectEl(fonts, t.bodyFont, v => set('bodyFont', v)))),
        h('div.row2',
          slider('Testo', 12, 22, t.fontPx, 'px', v => set('fontPx', v)),
          slider('Titolo del modulo', 18, 80, t.titlePx, 'px', v => set('titlePx', v))),
        h('div.row2',
          slider('Larghezza del modulo', 420, 1280, t.widthPx, 'px', v => set('widthPx', v), 10),
          slider('Angoli', 0, 28, t.radius, 'px', v => set('radius', v))),
        h('div.row2',
          slider('Spazio dentro i riquadri', 6, 64, t.cardPad, 'px', v => set('cardPad', v)),
          slider('Spazio tra le domande', 0, 48, t.fieldGap, 'px', v => set('fieldGap', v))),
        h('div.row2',
          field('Allineamento della testata', selectEl([['left', 'A sinistra'], ['center', 'Al centro'], ['right', 'A destra']], t.titleAlign, v => set('titleAlign', v))),
          h('div', toggle('Titoli in maiuscolo', t.titleCase === 'upper', v => set('titleCase', v ? 'upper' : 'normal'))))),
      h('div.card.b-sec', h('h3', 'Logo'),
        toggle('Mostra il logo dell\'etichetta', t.logo !== false, v => set('logo', v, true), A.settings.logo ? '' : 'Caricalo in Impostazioni'),
        h('div.row2',
          field('Forma', selectEl([['square', 'Quadrato'], ['rounded', 'Angoli arrotondati'], ['circle', 'Cerchio']], t.logoShape, v => set('logoShape', v))),
          slider('Grandezza', 20, 240, t.logoSize, 'px', v => set('logoSize', v))),
        h('p.fld-h', 'Puoi anche trascinare l\'angolo del logo nell\'anteprima.')),
      h('div.card.b-sec', h('h3', 'Immagine di testata'),
        t.header ? h('div.head-prev', { style: { backgroundImage: `url("${t.header}")` } }) : h('p.muted.small', 'Nessuna immagine: puoi metterne una (copertina, foto, grafica dell\'etichetta).'),
        h('div.row',
          btn(t.header ? 'Cambia immagine' : 'Carica immagine', async () => {
            const f = await pickFile('image/png,image/jpeg,image/webp');
            if (!f) return;
            try { set('header', await imageToDataUrl(f, { max: 1800, maxChars: 650000 }), true); } catch (x) { toast(x.message === 'too_big' ? 'Immagine troppo pesante' : 'Scegli un\'immagine JPG, PNG o WebP', { type: 'error' }); }
          }, { ic: 'image', kind: 'ghost' }),
          t.header ? btn('Togli', () => set('header', '', true), { ic: 'x', kind: 'ghost' }) : null),
        t.header ? h('div.row2',
          slider('Altezza', 60, 600, t.headerHeight, 'px', v => set('headerHeight', v)),
          field('Adattamento', selectEl([['cover', 'Riempie lo spazio'], ['contain', 'Immagine intera']], t.headerFit, v => set('headerFit', v)))) : null));
  }

  /* contratto */
  function contractPanel() {
    const c = form.contract;
    const st = c.style = sanitizeContractStyle(c.style);
    const setS = (k, v, redraw = false) => { st[k] = v; changed(redraw); };
    const phs = () => [
      ...Object.entries(SYSTEM_PLACEHOLDERS).map(([pid, label]) => ({ id: pid, label })),
      ...form.sections.flatMap(s => s.fields).filter(f => !isStatic(f) && f.type !== 'group').map(f => ({ id: f.id, label: f.label || 'Domanda senza titolo' })),
    ];
    const phLabel = pid => placeholderLabel(sanitizeForm(form), pid);
    const rich = (value, on, hint) => richEditor({ value, placeholders: phs, phLabel, hint, onChange: d => { on(d); changed(); } }).el;
    const fonts = Object.entries(FONTS).map(([k, f]) => [k, f.label]);
    const contractSecs = form.sections.filter(s => s.contract);
    return h('div.b-stack',
      h('div.card.b-sec',
        toggle('Fai firmare un contratto', !!c.enabled, v => { c.enabled = v; changed(true); }, 'L\'artista lo legge con i suoi dati già dentro e firma con il dito o il mouse'),
        c.enabled ? toggle('Firma obbligatoria prima dell\'invio', c.required !== false, v => { c.required = v; changed(); }, 'Se spento, l\'artista può firmare dopo (serve la sua password)') : null,
        c.enabled ? toggle('Mostra la firma dell\'etichetta', c.labelSigns !== false, v => { c.labelSigns = v; changed(); }, A.settings.label_signature ? 'Quella salvata in Impostazioni' : 'Prima salvala in Impostazioni') : null),
      c.enabled ? [
        h('div.card.b-sec', h('h3', 'Pagina dell\'accordo'),
          field('Titolo', input({ type: 'text', value: c.title, maxlength: 300, oninput: e => { c.title = e.target.value; changed(); } })),
          h('div.fld', h('span.fld-l', 'Introduzione (sotto il titolo)'), rich(c.intro, d => { c.intro = d; }, 'Facoltativa')),
          h('div.fld', h('span.fld-l', 'Testo del contratto'),
            h('span.fld-h', 'Con "+ Dato" inserisci i dati dell\'artista (nome, tracce, percentuali…): nel contratto si riempiono da soli.'),
            rich(c.body, d => { c.body = d; }))),
        h('div.card.b-sec', h('h3', 'Pagina dei dati e firme'),
          toggle('Pagina separata con i dati e le firme', c.copyPage !== false, v => { c.copyPage = v; changed(true); }, 'Spenta: le firme vanno in fondo all\'accordo'),
          c.copyPage !== false ? field('Titolo della pagina', input({ type: 'text', value: c.copyTitle, maxlength: 300, oninput: e => { c.copyTitle = e.target.value; changed(); } })) : null,
          c.copyPage !== false ? h('div.fld', h('span.fld-l', 'Dati (tracce, autori, nome…)'), rich(c.copy, d => { c.copy = d; })) : null,
          field('Frase di conferma prima delle firme', input({ type: 'text', value: c.confirm, maxlength: 600, placeholder: 'Vuoto = nessuna frase', oninput: e => { c.confirm = e.target.value; changed(); } })),
          h('div.row2',
            field('Etichetta della data', input({ type: 'text', value: c.dateLabel, maxlength: 120, placeholder: 'Vuoto = niente data', oninput: e => { c.dateLabel = e.target.value; changed(); } })),
            field('Spazio firma vuoto', input({ type: 'text', value: c.blank, maxlength: 80, oninput: e => { c.blank = e.target.value; changed(); } }))),
          h('div.row2',
            field('Firma dell\'etichetta', input({ type: 'text', value: c.labelRole, maxlength: 200, oninput: e => { c.labelRole = e.target.value; changed(); } }), '{label} = nome dell\'etichetta'),
            field('Firma dell\'artista', input({ type: 'text', value: c.artistRole, maxlength: 200, oninput: e => { c.artistRole = e.target.value; changed(); } }), '{name} = nome e cognome di chi firma')),
          field('Frase accanto alla casella "accetto"', input({ type: 'text', value: c.accept, maxlength: 300, oninput: e => { c.accept = e.target.value; changed(); } }))),
        h('div.card.b-sec', h('h3', 'Formattazione e impaginazione'),
          h('div.row2',
            field('Carattere del testo', selectEl(fonts, st.font, v => setS('font', v))),
            field('Carattere del titolo', selectEl(fonts, st.titleFont, v => setS('titleFont', v)))),
          h('div.row2',
            slider('Dimensione del testo', 9, 20, st.size, 'px', v => setS('size', v), 0.25),
            slider('Interlinea', 110, 240, st.line, '%', v => setS('line', v), 2)),
          h('div.row2',
            slider('Titolo', 90, 260, st.titleSize, '%', v => setS('titleSize', v), 2),
            slider('Titoletti degli articoli', 80, 200, st.headSize, '%', v => setS('headSize', v), 2)),
          h('div.row3',
            field('Testo', selectEl([['j', 'Giustificato'], ['l', 'A sinistra']], st.align, v => setS('align', v))),
            field('Titolo', selectEl([['c', 'Al centro'], ['l', 'A sinistra']], st.titleAlign, v => setS('titleAlign', v))),
            field('Firme', selectEl([['row', 'Affiancate'], ['col', 'Una sotto l\'altra']], st.signs, v => setS('signs', v)))),
          h('div.tgl-row',
            toggle('Titolo in maiuscolo', st.titleUpper, v => setS('titleUpper', v)),
            toggle('Barretta sotto il titolo', st.titleBar, v => setS('titleBar', v)),
            toggle('Linea sotto l\'intestazione', st.headLine, v => setS('headLine', v)),
            toggle('Bordo del foglio (sullo schermo)', st.paper, v => setS('paper', v))),
          h('div.colors',
            colorField(() => st.text, v => setS('text', v), 'Testo'), colorField(() => st.heading, v => setS('heading', v), 'Titoli'),
            colorField(() => st.accent, v => setS('accent', v), 'Barretta'), colorField(() => st.lineColor, v => setS('lineColor', v), 'Linea')),
          h('div.row3',
            field('Logo', selectEl([['r', 'A destra'], ['c', 'Al centro'], ['l', 'A sinistra']], st.logoPos, v => setS('logoPos', v))),
            field('Sfondo del logo', selectEl([['auto', 'Automatico'], ['none', 'Nessuno'], ['dark', 'Scuro'], ['light', 'Chiaro']], st.logoBg, v => setS('logoBg', v)), 'Automatico: scuro se il logo è chiaro'),
            slider('Altezza del logo', 20, 160, st.logoH, 'px', v => setS('logoH', v))),
          slider('Margini del foglio', 12, 90, st.pad, 'px', v => setS('pad', v))),
        h('div.card.b-sec',
          h('div.row',
            btn('Ripristina testo e impaginazione originali', async () => {
              if (!(await confirmBox({ title: 'Ripristinare il contratto originale?', text: 'Testo, pagina dei dati e formattazione tornano quelli di partenza. Puoi tornare indietro con "Indietro".', ok: 'Ripristina' }))) return;
              form.contract = restoreContract(form.contract, form.sections); changed(true);
            }, { ic: 'reset', kind: 'ghost small' }),
            btn('Ripristina solo la formattazione', () => { c.style = { ...CONTRACT_STYLE }; changed(true); }, { ic: 'palette', kind: 'ghost small' })),
          h('div.note', icon('lock', 16), h('span', 'I contratti già firmati non cambiano: restano esattamente come sono stati firmati, anche nella forma. Le modifiche valgono per i prossimi.')),
          contractSecs.length ? h('p.muted.small', `Sezioni con i dati del contratto (bloccati dopo la firma): ${contractSecs.map(s => s.title || 'senza titolo').join(', ')}.`)
            : h('div.note.warn', icon('alert', 16), h('span', 'Nessuna sezione è segnata come "Dati del contratto": in Domande accendi l\'interruttore sulla sezione giusta.'))),
      ] : null);
  }

  /* testi */
  function textsPanel() {
    form.texts = { ...TEXT_DEFAULTS, ...(form.texts || {}) };
    form.show = { ...SHOW_DEFAULTS, ...(form.show || {}) };
    const tin = k => h('div.txt-row', input({ type: 'text', value: form.texts[k], maxlength: 300, placeholder: TEXT_DEFAULTS[k], oninput: e => { form.texts[k] = e.target.value; changed(); } }),
      form.texts[k] !== TEXT_DEFAULTS[k] ? iconBtn('reset', 'Rimetti il testo di partenza', () => { form.texts[k] = TEXT_DEFAULTS[k]; changed(true); }, 'tiny') : null);
    return h('div.b-stack',
      h('div.card.b-sec', h('h3', 'Cosa si vede'),
        h('div.tgl-col', Object.entries(SHOW_LABELS).map(([k, l]) => toggle(l, form.show[k] !== false, v => { form.show[k] = v; changed(); })))),
      h('div.card.b-sec', h('h3', 'Testi e pulsanti'),
        h('p.fld-h', 'Cambia qualsiasi parola della pagina dell\'artista. {artista} = nome dell\'artista, {etichetta} = nome dell\'etichetta, {n} e {tot} = numero del passo.'),
        Object.keys(TEXT_DEFAULTS).map(k => h('label.fld', h('span.fld-l', TEXT_LABELS[k]), tin(k)))),
      h('div.card.b-sec', h('h3', 'Messaggio dopo l\'invio'),
        richEditor({ value: form.done, onChange: d => { form.done = d; changed(); }, hint: 'Grazie! Abbiamo ricevuto tutto…' }).el,
        h('p.muted.small', 'Dopo l\'invio l\'artista può anche scaricare una copia in PDF o riceverla per email (se le email sono attive).')));
  }

  /* ─── link di anteprima ─── */
  const previewUrl = token => new URL('anteprima.html', artistBase()).href + `#p=${token}${A.demo ? '&demo=1' : ''}`;
  async function previewLink() {
    const m = modal({ title: 'Link di anteprima' });
    const draw = async () => {
      clear(m.body); clear(m.foot);
      m.body.append(h('p.muted', 'Mostra il modulo esattamente come lo vede l\'artista, con dati d\'esempio, e si aggiorna da solo a ogni modifica: tienilo aperto sul telefono o in un\'altra finestra mentre lavori qui. Da lì non si può inviare niente.'));
      if (!pv.hash) {
        m.foot.append(btn('Chiudi', () => m.close(), { kind: 'ghost' }), btn('Crea il link', async () => {
          try { const t = await newToken(); await A.api.setPreview(id, { preview_hash: t.token_hash, preview_enc: t.token_enc }); pv.hash = t.token_hash; pv.enc = t.token_enc; pv.token = t.token; await doSave(); draw(); }
          catch (x) { toast(friendly(x), { type: 'error' }); }
        }, { ic: 'link' }));
        return;
      }
      let token = pv.token;
      if (!token) { try { token = pv.token = await C.openTextForLabel(K.privateKey(), pv.enc); } catch { m.body.append(h('div.note.warn', icon('alert', 16), h('span', 'Non riesco ad aprire il link: creane uno nuovo.'))); } }
      if (token) {
        const url = previewUrl(token);
        m.body.append(h('div.copyrow', input({ type: 'text', value: url, readOnly: true, onfocus: e => e.target.select() }), btn('Copia', () => copyText(url, 'Link copiato'), { ic: 'copy', kind: 'ghost' })),
          h('div.row', { style: { marginTop: '10px' } }, h('a.btn.small', { href: url, target: '_blank', rel: 'noopener' }, icon('external', 18), h('span', 'Apri l\'anteprima'))));
      }
      m.body.append(h('p.muted.small', { style: { marginTop: '12px' } }, 'Chi ha il link vede solo il modulo (domande, aspetto, contratto con gli spazi vuoti), mai i dati degli artisti.'));
      m.foot.append(
        btn('Spegni il link', async () => { try { await A.api.setPreview(id, {}); pv.hash = pv.enc = ''; pv.token = null; toast('Link di anteprima spento'); draw(); } catch (x) { toast(friendly(x), { type: 'error' }); } }, { ic: 'x', kind: 'ghost small danger' }),
        btn('Nuovo link', async () => {
          if (!(await confirmBox({ title: 'Creare un link nuovo?', text: 'Il link di adesso smette di funzionare.', ok: 'Nuovo link' }))) return;
          try { const t = await newToken(); await A.api.setPreview(id, { preview_hash: t.token_hash, preview_enc: t.token_enc }); pv.hash = t.token_hash; pv.enc = t.token_enc; pv.token = t.token; draw(); }
          catch (x) { toast(friendly(x), { type: 'error' }); }
        }, { ic: 'refresh', kind: 'ghost small' }),
        btn('Fatto', () => m.close(), { kind: 'small' }));
    };
    draw();
  }

  /* ─── struttura ─── */
  const titleIn = input({ type: 'text', class: 'inp b-title', value: form.title, maxlength: 200, 'aria-label': 'Titolo del modulo', oninput: e => { form.title = e.target.value; changed(); } });
  const root = h('div.builder');
  const prevToggle = h('button.btn.ghost.small.b-prev-toggle', { type: 'button', onclick: () => { root.classList.toggle('show-prev'); prevToggle.lastChild.textContent = root.classList.contains('show-prev') ? 'Modifica' : 'Anteprima'; drawPreview(); if (root.classList.contains('show-prev') && view.dev !== 'desk') fitZoom(); } }, icon('eye', 17), h('span', 'Anteprima'));
  root.append(
    h('div.b-top', h('a.back', { href: '#/moduli' }, icon('back', 16), 'Moduli'), titleIn, h('div.b-hist', undoBtn, redoBtn), status, prevToggle),
    h('div.b-cols', h('div.b-edit', tabsBar, panel), h('div.b-prev-col', prevBar, preview)));
  swap(el, root);
  paintHist(); paintFrame();
  drawTabs(); drawPanel(); drawPreview();
  document.body.classList.add('wide-view');

  const beforeUnload = e => { if (status.classList.contains('busy')) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  return async () => {
    document.body.classList.remove('wide-view');
    window.removeEventListener('beforeunload', beforeUnload);
    document.removeEventListener('keydown', onKey);
    if (status.classList.contains('busy')) await doSave();
  };
}
