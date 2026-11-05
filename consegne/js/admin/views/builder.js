/* Costruttore del modulo (come Google Moduli): domande, sezioni, testi formattati, aspetto,
   contratto e messaggio finale, con l'anteprima dal vivo di come lo vedrà l'artista.
   Si salva da solo. */

import { h, swap, icon, clear, debounce, imageToDataUrl, pickFile, todayYmd } from '../../ui/dom.js';
import { richEditor, richBlock } from '../../ui/rich.js';
import { applyTheme, formHeader, sectionBlock } from '../../ui/form-view.js';
import { contractDoc } from '../../ui/pdf.js';
import { sanitizeForm, FIELD_TYPES, SUB_TYPES, SYSTEM_PLACEHOLDERS, blankField, newId, MUSIC_KEYS } from '../../core/schema.js';
import { FONTS, PRESETS, applyPreset, sanitizeTheme, themeWarnings } from '../../core/theme.js';
import { LINK_KINDS } from '../../core/links.js';
import { contractSnapshot, placeholderLabel } from '../../core/contract.js';
import { A, go } from '../state.js';
import { btn, iconBtn, toast, friendly, field, toggle, selectEl, input, confirmBox, empty } from '../ui.js';

const clone = x => JSON.parse(JSON.stringify(x));
const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return false; arr.splice(j, 0, arr.splice(i, 1)[0]); return true; };
const reId = f => { const c = clone(f); c.id = newId('f'); if (c.fields) c.fields = c.fields.map(reId); return c; };

export async function render(el, id) {
  let row;
  try { row = await A.api.getForm(id); } catch { swap(el, empty('layers', 'Modulo non trovato', '', btn('Torna ai moduli', () => go('#/moduli')))); return; }
  const invites = await A.api.listInvites();
  const usedBy = invites.filter(i => i.form_id === id).length;
  const form = clone(sanitizeForm(row.schema));
  let tab = 'domande', openField = null, saving = false, lastSaved = row.updated_at;
  const previewAnswers = {};

  /* ─── salvataggio ─── */
  const status = h('span.save-st', 'Salvato');
  const doSave = async () => {
    if (saving) { save(); return; }
    saving = true; status.textContent = 'Salvo…'; status.className = 'save-st busy';
    try {
      const clean = sanitizeForm(form);
      const r = await A.api.updateForm(id, { title: clean.title, schema: clean });
      lastSaved = r.updated_at; A.forms.delete(id);
      status.textContent = 'Salvato'; status.className = 'save-st';
    } catch (x) { status.textContent = 'Non salvato'; status.className = 'save-st bad'; toast(friendly(x), { type: 'error' }); }
    saving = false;
  };
  const save = debounce(doSave, 900);
  const prev = debounce(() => drawPreview(), 220);
  const changed = (redraw = false) => { status.textContent = 'Modifiche…'; status.className = 'save-st busy'; save(); prev(); if (redraw) drawPanel(); };

  /* ─── anteprima ─── */
  const previewInner = h('div.b-prev-inner');
  const preview = h('div.fx.b-prev', previewInner);
  function drawPreview() {
    const y = preview.scrollTop;
    const clean = sanitizeForm(form);
    applyTheme(preview, clean.theme);
    clear(previewInner);
    const label = { name: A.settings.label_name, logo: A.settings.logo, signature: A.settings.label_signature, signer: A.settings.label_signer };
    if (tab === 'contratto') {
      const snap = contractSnapshot({ form: clean, answers: previewAnswers, ctx: { label: label.name, release: 'Esempio EP', catalog: 'CAT001', artist: 'Nome artista', artistPct: 50 }, inviteId: 'anteprima',
        labelSignature: clean.contract.labelSigns ? label.signature : '', signature: { name: '', place: '', date: todayYmd(), time: '', png: '' } });
      previewInner.append(h('div.f-wrap', clean.contract.enabled ? h('section.f-card', h('h2.f-stitle', 'Anteprima del contratto'), h('p.f-note', 'Con dati d\'esempio: gli spazi vuoti si riempiono con i dati dell\'artista.'), contractDoc(snap, { label }))
        : h('div.f-card.f-msg', h('h2', 'Contratto spento'), h('p', 'Accendilo qui a sinistra per farlo firmare agli artisti.'))));
    } else if (tab === 'fine') {
      previewInner.append(h('div.f-wrap', formHeader({ form: clean, label, release: { title: 'Esempio EP', catalog: 'CAT001' }, artist: 'Nome artista' }),
        h('div.f-card.f-msg', h('div.f-bigicon.ok', icon('checkCircle', 30)), h('h2', 'Inviato!'), richRead(clean.done))));
    } else {
      previewInner.append(h('div.f-wrap', formHeader({ form: clean, label, release: { title: 'Esempio EP', catalog: 'CAT001' }, artist: 'Nome artista' }),
        clean.sections.map(s => sectionBlock(s, previewAnswers, { shareWith: clean.shareWith || A.settings.notify_email, onChange: () => {} })),
        h('div.f-actions', h('span'), h('button.f-btn', { type: 'button' }, 'Avanti', icon('arrowR', 18)))));
    }
    preview.scrollTop = y;
  }
  const richRead = doc => richBlock(doc, {}, 'f-intro');

  /* ─── pannelli ─── */
  const panel = h('div.b-panel');
  const tabsBar = h('div.tabs.b-tabs');
  const TABS = [['domande', 'Domande', 'list'], ['aspetto', 'Aspetto', 'palette'], ['contratto', 'Contratto', 'pen'], ['fine', 'Fine', 'checkCircle']];
  const drawTabs = () => { clear(tabsBar); for (const [k, l, ic] of TABS) tabsBar.append(h('button.tab' + (tab === k ? '.on' : ''), { type: 'button', onclick: () => { tab = k; drawTabs(); drawPanel(); drawPreview(); } }, icon(ic, 16), l)); };

  function drawPanel() {
    const y = panel.scrollTop;
    clear(panel);
    if (tab === 'domande') panel.append(questionsPanel());
    if (tab === 'aspetto') panel.append(lookPanel());
    if (tab === 'contratto') panel.append(contractPanel());
    if (tab === 'fine') panel.append(endPanel());
    panel.scrollTop = y;
  }

  /* domande */
  function typePicker(types, onPick) {
    const pop = h('div.type-pop', types.map(t => h('button.type-i', { type: 'button', onclick: () => { pop.remove(); onPick(t); } }, icon(FIELD_TYPES[t].icon, 18), FIELD_TYPES[t].label)));
    return pop;
  }
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
        f.type === 'select' && f.label.toLowerCase().includes('tonalit') ? null : f.type === 'select' ? btn('Tonalità musicali', () => { f.options = [...MUSIC_KEYS]; changed(); draw(); }, { ic: 'music', kind: 'ghost small' }) : null));
    };
    draw();
    return box;
  }
  function fieldEditor(f, list, sub) {
    const types = sub ? SUB_TYPES : Object.keys(FIELD_TYPES);
    const box = h('div.fe');
    const lbl = input({ type: 'text', value: f.label, maxlength: 300, placeholder: f.type === 'info' ? 'Titolo (facoltativo)' : 'Domanda', oninput: e => { f.label = e.target.value; headLabel(f); changed(); } });
    box.append(h('div.row2',
      field(f.type === 'info' ? 'Titolo' : 'Domanda', lbl),
      field('Tipo', selectEl(types.map(t => [t, FIELD_TYPES[t].label]), f.type, v => {
        const keep = { id: f.id, label: f.label, help: f.help, required: f.required, checklist: f.checklist, half: f.half };
        for (const k of Object.keys(f)) delete f[k];
        Object.assign(f, blankField(v), keep);
        changed(true);
      }))));
    box.append(field(f.type === 'info' ? 'Testo' : 'Spiegazione (facoltativa)', richEditor({ value: f.help, compact: true, hint: f.type === 'info' ? 'Scrivi il testo…' : 'Aiuta l\'artista: formato, dimensioni, esempi…', onChange: d => { f.help = d; changed(); } }).el));
    if (f.type === 'info') return box;

    const tg = h('div.tgl-row',
      toggle('Obbligatoria', !!f.required, v => { f.required = v; if (!sub && v) f.checklist = true; changed(true); }),
      sub ? null : toggle('Nella checklist', !!f.checklist, v => { f.checklist = v; changed(); }, 'La vedi nella release: "manca…"'),
      toggle('Dato riservato', !!f.sensitive, v => { f.sensitive = v; changed(); }, 'Nascosto nelle email e nella bozza'),
      toggle('Mezza larghezza', !!f.half, v => { f.half = v; changed(); }));
    box.append(tg);
    if (['short', 'long', 'email', 'phone', 'number', 'link', 'iban', 'taxid', 'select'].includes(f.type)) {
      box.append(field(f.type === 'select' ? 'Testo prima della scelta' : 'Esempio dentro il campo', input({ type: 'text', value: f.placeholder || '', maxlength: 200, oninput: e => { f.placeholder = e.target.value; changed(); } })));
    }
    if (f.type === 'short' || f.type === 'long') box.append(field('Lunghezza massima (caratteri)', input({ type: 'number', min: 1, max: f.type === 'long' ? 20000 : 2000, value: f.maxLength || (f.type === 'long' ? 5000 : 300), oninput: e => { f.maxLength = Number(e.target.value) || undefined; changed(); } })));
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
      const addSub = btn('Aggiungi campo', e => { const b = e.currentTarget; if (b.nextSibling && b.nextSibling.classList && b.nextSibling.classList.contains('type-pop')) { b.nextSibling.remove(); return; } b.after(typePicker(SUB_TYPES, t => { const nf = blankField(t); f.fields.push(nf); openField = nf.id; changed(true); })); }, { ic: 'plus', kind: 'ghost small' });
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
  const headLabel = f => { const n = headLabels.get(f.id); if (n) n.textContent = f.label || (f.type === 'info' ? 'Testo' : 'Domanda senza titolo'); };
  function fieldRow(f, list, i, sub = false) {
    const open = openField === f.id;
    const lab = h('span.bf-l', f.label || (f.type === 'info' ? 'Testo' : 'Domanda senza titolo'));
    headLabels.set(f.id, lab);
    const head = h('div.bf-head', { onclick: e => { if (e.target.closest('.icon-btn')) return; openField = open ? null : f.id; drawPanel(); } },
      h('span.bf-ic', icon(FIELD_TYPES[f.type].icon, 17)),
      h('span.bf-t', lab, h('small', FIELD_TYPES[f.type].label, f.required ? ' · obbligatoria' : '', !sub && f.checklist ? ' · checklist' : '', f.sensitive ? ' · riservato' : '')),
      h('span.bf-tools',
        iconBtn('up', 'Su', () => { if (move(list, i, -1)) changed(true); }, 'tiny'),
        iconBtn('down', 'Giù', () => { if (move(list, i, 1)) changed(true); }, 'tiny'),
        iconBtn('copy', 'Duplica', () => { const c = reId(f); c.label = f.label + (f.label ? ' (copia)' : ''); list.splice(i + 1, 0, c); openField = c.id; changed(true); }, 'tiny'),
        iconBtn('trash', 'Elimina', async () => {
          if (usedBy && !(await confirmBox({ title: 'Eliminare la domanda?', text: 'Il modulo è già in uso: le risposte già inviate a questa domanda restano visibili nell\'invio come "campi non più nel modulo".', ok: 'Elimina', danger: true }))) return;
          list.splice(list.indexOf(f), 1); changed(true);
        }, 'tiny danger')),
      icon(open ? 'up' : 'down', 18, 'bf-chev'));
    return h('div.b-field' + (open ? '.open' : '') + (sub ? '.sub' : ''), head, open ? fieldEditor(f, list, sub) : null);
  }
  function questionsPanel() {
    const out = h('div.b-stack');
    if (usedBy) out.append(h('div.note', icon('info', 16), h('span', `Questo modulo è usato da ${usedBy} ${usedBy === 1 ? 'artista' : 'artisti'}: le modifiche valgono subito anche per loro. I dati già inviati non si perdono.`)));
    out.append(h('div.card.b-sec',
      field('Titolo del modulo', input({ type: 'text', value: form.title, maxlength: 200, oninput: e => { form.title = e.target.value; titleIn.value = e.target.value; changed(); } })),
      field('Introduzione', richEditor({ value: form.intro, onChange: d => { form.intro = d; changed(); }, hint: 'Un messaggio di benvenuto per l\'artista…' }).el),
      field('Email con cui condividere le cartelle (facoltativa)', input({ type: 'email', value: form.shareWith || '', placeholder: A.settings.notify_email || 'la tua email', oninput: e => { form.shareWith = e.target.value.trim(); changed(); } }),
        'Sotto i campi dei link suggeriamo di condividere i file con questa email (vuoto = email degli avvisi)')));
    form.sections.forEach((s, si) => {
      const fields = h('div.b-fields');
      s.fields.forEach((f, fi) => fields.append(fieldRow(f, s.fields, fi)));
      const addQ = btn('Aggiungi domanda', e => {
        const b = e.currentTarget;
        if (b.nextSibling && b.nextSibling.classList && b.nextSibling.classList.contains('type-pop')) { b.nextSibling.remove(); return; }
        b.after(typePicker(Object.keys(FIELD_TYPES), t => { const nf = blankField(t); s.fields.push(nf); openField = nf.id; changed(true); }));
      }, { ic: 'plus', kind: 'ghost' });
      out.append(h('div.card.b-sec' + (s.contract ? '.contract' : ''),
        h('div.b-sec-head', h('span.b-sec-n', `Sezione ${si + 1} di ${form.sections.length}`),
          h('span.bf-tools',
            iconBtn('up', 'Sposta su', () => { if (move(form.sections, si, -1)) changed(true); }, 'tiny'),
            iconBtn('down', 'Sposta giù', () => { if (move(form.sections, si, 1)) changed(true); }, 'tiny'),
            iconBtn('copy', 'Duplica sezione', () => { const c = clone(s); c.id = newId('s'); c.title = s.title + ' (copia)'; c.fields = c.fields.map(reId); form.sections.splice(si + 1, 0, c); changed(true); }, 'tiny'),
            iconBtn('trash', 'Elimina sezione', async () => {
              if (form.sections.length === 1) { toast('Serve almeno una sezione'); return; }
              if (s.fields.length && !(await confirmBox({ title: 'Eliminare la sezione?', text: `Spariscono anche le sue ${s.fields.length} domande.`, ok: 'Elimina', danger: true }))) return;
              form.sections.splice(si, 1); changed(true);
            }, 'tiny danger'))),
        input({ type: 'text', class: 'inp b-sec-title', value: s.title, maxlength: 200, placeholder: 'Titolo della sezione', oninput: e => { s.title = e.target.value; changed(); } }),
        richEditor({ value: s.desc, compact: true, hint: 'Descrizione della sezione (facoltativa)', onChange: d => { s.desc = d; changed(); } }).el,
        toggle('Dati del contratto', !!s.contract, v => { s.contract = v; changed(true); }, 'Vanno nel contratto e si bloccano dopo la firma'),
        fields, h('div', addQ)));
    });
    out.append(btn('Aggiungi sezione', () => { form.sections.push({ id: newId('s'), title: '', desc: [], contract: false, fields: [] }); changed(true); requestAnimationFrame(() => { panel.scrollTop = panel.scrollHeight; }); }, { ic: 'plus', kind: 'ghost block' }));
    return out;
  }

  /* aspetto */
  function lookPanel() {
    const t = form.theme = sanitizeTheme(form.theme);
    const set = (k, v, redraw = false) => { t[k] = v; t.preset = 'custom'; changed(redraw); };
    const color = (k, label) => {
      const hex = input({ type: 'text', value: t[k], maxlength: 7, class: 'inp hex', oninput: e => { if (/^#[0-9a-f]{6}$/i.test(e.target.value)) { pick.value = e.target.value; set(k, e.target.value.toLowerCase()); } } });
      const pick = h('input.swatch', { type: 'color', value: t[k], oninput: e => { hex.value = e.target.value; set(k, e.target.value); } });
      return h('label.color-f', h('span', label), h('span.color-in', pick, hex));
    };
    const presets = h('div.presets', Object.entries(PRESETS).map(([k, p]) => h('button.preset' + (t.preset === k ? '.on' : ''), { type: 'button', onclick: () => { form.theme = applyPreset(t, k); changed(true); } },
      h('span.preset-sw', { style: { background: p.bg } }, h('i', { style: { background: p.card } }), h('b', { style: { background: p.accent } })), p.label)));
    const warns = themeWarnings(t);
    return h('div.b-stack',
      h('div.card.b-sec', h('h3', 'Stili pronti'), presets),
      h('div.card.b-sec', h('h3', 'Colori'), h('div.colors', color('bg', 'Sfondo'), color('bg2', 'Sfondo 2'), color('card', 'Riquadri'), color('text', 'Testo'), color('accent', 'Colore principale')),
        warns.map(w => h('div.note.warn', icon('alert', 16), h('span', w))),
        h('div.row3',
          field('Sfondo', selectEl([['solid', 'Tinta unita'], ['gradient', 'Sfumato'], ['glow', 'Con luce']], t.bgStyle, v => set('bgStyle', v))),
          field('Riquadri', selectEl([['glass', 'Vetro'], ['shadow', 'Ombra'], ['border', 'Bordo'], ['flat', 'Piatti']], t.cardStyle, v => set('cardStyle', v))),
          field('Pulsanti', selectEl([['fill', 'Pieni'], ['outline', 'Contorno'], ['pill', 'Pillola']], t.button, v => set('button', v))))),
      h('div.card.b-sec', h('h3', 'Caratteri e forme'),
        h('div.row2',
          field('Titoli', selectEl(Object.entries(FONTS).map(([k, f]) => [k, f.label]), t.titleFont, v => set('titleFont', v))),
          field('Testo', selectEl(Object.entries(FONTS).map(([k, f]) => [k, f.label]), t.bodyFont, v => set('bodyFont', v)))),
        h('div.row3',
          field('Dimensione testo', selectEl([['s', 'Piccola'], ['m', 'Media'], ['l', 'Grande']], t.size, v => set('size', v))),
          field('Larghezza', selectEl([['s', 'Stretta'], ['m', 'Media'], ['l', 'Larga']], t.width, v => set('width', v))),
          field(`Angoli: ${t.radius}px`, h('input.range', { type: 'range', min: 0, max: 28, value: t.radius, oninput: e => { set('radius', Number(e.target.value)); e.target.closest('.fld').querySelector('.fld-l').textContent = `Angoli: ${e.target.value}px`; } }))),
        toggle('Titoli in maiuscolo', t.titleCase === 'upper', v => set('titleCase', v ? 'upper' : 'normal'))),
      h('div.card.b-sec', h('h3', 'Testata'),
        t.header ? h('div.head-prev', { style: { backgroundImage: `url("${t.header}")` } }) : h('p.muted.small', 'Nessuna immagine: puoi metterne una (copertina, foto, grafica dell\'etichetta).'),
        h('div.row',
          btn(t.header ? 'Cambia immagine' : 'Carica immagine', async () => {
            const f = await pickFile('image/png,image/jpeg,image/webp');
            if (!f) return;
            try { set('header', await imageToDataUrl(f, { max: 1800, maxChars: 650000 }), true); } catch (x) { toast(x.message === 'too_big' ? 'Immagine troppo pesante' : 'Scegli un\'immagine JPG, PNG o WebP', { type: 'error' }); }
          }, { ic: 'image', kind: 'ghost' }),
          t.header ? btn('Togli', () => set('header', '', true), { ic: 'x', kind: 'ghost' }) : null),
        t.header ? h('div.row2',
          field(`Altezza: ${t.headerHeight}px`, h('input.range', { type: 'range', min: 80, max: 420, value: t.headerHeight, oninput: e => { set('headerHeight', Number(e.target.value)); e.target.closest('.fld').querySelector('.fld-l').textContent = `Altezza: ${e.target.value}px`; } })),
          field('Adattamento', selectEl([['cover', 'Riempie lo spazio'], ['contain', 'Immagine intera']], t.headerFit, v => set('headerFit', v)))) : null,
        toggle('Mostra il logo dell\'etichetta', t.logo !== false, v => set('logo', v), A.settings.logo ? '' : 'Caricalo in Impostazioni')));
  }

  /* contratto */
  function contractPanel() {
    const c = form.contract;
    const phs = () => [
      ...Object.entries(SYSTEM_PLACEHOLDERS).map(([id, label]) => ({ id, label })),
      ...form.sections.flatMap(s => s.fields).filter(f => f.type !== 'info' && f.type !== 'group').map(f => ({ id: f.id, label: f.label || 'Domanda senza titolo' })),
    ];
    const contractSecs = form.sections.filter(s => s.contract);
    return h('div.b-stack',
      h('div.card.b-sec',
        toggle('Fai firmare un contratto', !!c.enabled, v => { c.enabled = v; changed(true); }, 'L\'artista lo legge con i suoi dati già dentro e firma con il dito o il mouse'),
        c.enabled ? toggle('Firma obbligatoria prima dell\'invio', c.required !== false, v => { c.required = v; changed(); }, 'Se spento, l\'artista può firmare dopo (serve la sua password)') : null,
        c.enabled ? toggle('Mostra la firma dell\'etichetta', c.labelSigns !== false, v => { c.labelSigns = v; changed(); }, A.settings.label_signature ? 'Quella salvata in Impostazioni' : 'Prima salvala in Impostazioni') : null),
      c.enabled ? h('div.card.b-sec',
        field('Titolo', input({ type: 'text', value: c.title, maxlength: 300, oninput: e => { c.title = e.target.value; changed(); } })),
        h('div.fld', h('span.fld-l', 'Testo del contratto'),
          h('span.fld-h', 'Con "+ Dato" inserisci i dati dell\'artista (nome, tracce, percentuali…): nel contratto si riempiono da soli.'),
          richEditor({ value: c.body, placeholders: phs, phLabel: pid => placeholderLabel(sanitizeForm(form), pid), onChange: d => { c.body = d; changed(); } }).el),
        field('Frase di accettazione (accanto alla casella)', input({ type: 'text', value: c.accept, maxlength: 300, oninput: e => { c.accept = e.target.value; changed(); } })),
        h('div.note', icon('lock', 16), h('span', 'I contratti già firmati non cambiano: restano esattamente come sono stati firmati. Le modifiche valgono per i prossimi.')),
        contractSecs.length ? h('p.muted.small', `Sezioni con i dati del contratto (bloccati dopo la firma): ${contractSecs.map(s => s.title || 'senza titolo').join(', ')}.`)
          : h('div.note.warn', icon('alert', 16), h('span', 'Nessuna sezione è segnata come "Dati del contratto": in Domande accendi l\'interruttore sulla sezione giusta.'))) : null);
  }

  /* fine */
  function endPanel() {
    return h('div.b-stack', h('div.card.b-sec',
      field('Messaggio dopo l\'invio', richEditor({ value: form.done, onChange: d => { form.done = d; changed(); }, hint: 'Grazie! Abbiamo ricevuto tutto…' }).el),
      h('p.muted.small', 'Dopo l\'invio l\'artista può anche scaricare una copia in PDF o riceverla per email (se le email sono attive).')));
  }

  /* ─── struttura ─── */
  const titleIn = input({ type: 'text', class: 'inp b-title', value: form.title, maxlength: 200, 'aria-label': 'Titolo del modulo', oninput: e => { form.title = e.target.value; changed(); } });
  const root = h('div.builder');
  const prevToggle = h('button.btn.ghost.small.b-prev-toggle', { type: 'button', onclick: () => { root.classList.toggle('show-prev'); prevToggle.lastChild.textContent = root.classList.contains('show-prev') ? 'Modifica' : 'Anteprima'; drawPreview(); } }, icon('eye', 17), h('span', 'Anteprima'));
  root.append(
    h('div.b-top', h('a.back', { href: '#/moduli' }, icon('back', 16), 'Moduli'), titleIn, status, prevToggle),
    h('div.b-cols', h('div.b-edit', tabsBar, panel), h('div.b-prev-col', h('div.b-prev-label', icon('eye', 14), 'Come lo vede l\'artista'), preview)));
  swap(el, root);
  drawTabs(); drawPanel(); drawPreview();
  document.body.classList.add('wide-view');

  const beforeUnload = e => { if (status.classList.contains('busy')) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  return async () => {
    document.body.classList.remove('wide-view');
    window.removeEventListener('beforeunload', beforeUnload);
    if (status.classList.contains('busy')) await doSave();
  };
}
