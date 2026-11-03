/* Patrimonio = il riepilogo del Net Worth di D, con i valori effettivi di ogni fine mese.
   D: "il patrimonio non è la somma di entrate, networth e wallet… nel patrimonio deve esserci
   semplicemente il riassunto del networth e quindi quello effettivo è quello di ogni fine mese.
   La sezione investimenti è a sé." Qui: patrimonio all'ultima fine mese, una scheda per sezione,
   l'andamento, il foglio Net Worth dell'anno, anno per anno; "Aggiorna i valori" = il Net Worth
   di fine mese, riga per riga. */

import { h, icon, download } from '../ui/dom.js';
import { barChart, legend, sparkline } from '../ui/charts.js';
import { openSheet, amountInput, toast, empty, selectInput, colorChoice, textInput, field } from '../ui/components.js';
import { money, moneyText, delta, axisMoney, tipMoney, ui } from '../ui/fmt.js';
import { card, accAvatar, segTabs, filterBox, hdBadge, colorVar, colorDot, setSectionColor, softColor, loadPeriod, savePeriod, periodPicker, editInCell, resumeEdit, renameBtn } from './common.js';
import { cleanPeriod } from '../core/period.js';
import { accountEditor, undoToast } from './editors.js';
import { openFileImport } from './invimport.js';
import { bankLogo } from '../data/banks.js';
import { saveCheckIn, setSetting, editNwItem, setNwCell, moveNwItem, renameNwSection } from '../actions.js';
import { isLiability, hasPlan, position } from '../core/model.js';
import { monthKey, monthEnd, addMonthKey, formatMonth, formatDate, monthName } from '../core/dates.js';
import { formatPercent, formatNumber } from '../core/money.js';
import { toCSV, csvNumber } from '../core/csv.js';
import { fitTable, watchFit, fitMoney } from '../ui/fit.js';

let year = null;
// periodo del grafico (D: "voglio la possibilità di personalizzare il range del periodo per l'istogramma"):
// 12 | 24 mesi, 'ytd' (dal 31/12), 'all', oppure { from: 'AAAA-MM', to: 'AAAA-MM' }; resta su questo dispositivo
// (prima era in 'rhf-nw-span': la scelta fatta allora resta)
let span = loadPeriod('nw', (() => { try { return cleanPeriod(JSON.parse(localStorage.getItem('rhf-nw-span')), 12); } catch { return 12; } })());
const setSpan = v => { span = v; savePeriod('nw', v); };
let nwQ = '';
const pctOf = (a, b) => (a != null && b ? (a - b) / Math.abs(b) * 100 : null);

/* ─── Net Worth come il foglio di D: sezioni con le loro righe, Total, Gain/Loss e %;
   in fondo l'Asset Allocation (somme per sezione, quota nella prima colonna) e il Net Worth ─── */
const dmy = iso => `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const pc = v => (v == null ? '' : formatPercent(v, 2, true));
const tone = v => (v == null || !Math.round(v * 100) ? '' : v > 0 ? 'pos' : 'neg');

const CUR_SYM = { USD: '$', GBP: '£', JPY: '¥', CHF: 'CHF' };

/* ─── Scrivere un valore nella cella (editInCell, in common) ───
   Per un conto è il saldo a quella data nella sua valuta, per un titolo il valore del Net Worth di
   quel mese. I debiti si possono scrivere anche positivi. */
function editCell(td, r, dt, cur) {
  editInCell(td, {
    cur, label: `${r.label} al ${formatDate(dt, { year: true })}`,
    save: c => {
      const liab = r.acc && isLiability(r.acc);
      const val = c == null ? null : liab ? -Math.abs(c) : c;
      if (val === cur) return false;
      setNwCell(r.hd ? { holding: r.hd.id } : { account: r.acc.id }, dt, val);
      undoToast(val == null ? `Valore tolto: ${r.label}, ${formatDate(dt, { year: true })}` : `${r.label}, ${formatDate(dt, { year: true })}: ${r.cur ? `${formatNumber(val / 100, 2, 2)} ${CUR_SYM[r.cur] || r.cur}` : moneyText(val)}`);
      return true;
    },
  });
}

/* ─── Spostare una riga trascinandola (D: "voglio spostare una riga trascinandola… e se la sposto
   in un'altra categoria tutto deve aggiornarsi"): sopra o sotto un'altra riga, sulla testata di una
   sezione (in cima) o sul suo Total (in fondo). Col mouse si trascina il nome, col dito la maniglia. */
let dragEnd = 0;
const dragJustEnded = () => Date.now() - dragEnd < 300;
function startDrag(e, ctx) {
  if (e.button !== 0) return;
  if (e.pointerType === 'touch' && !e.target.closest('.nw-grip')) return;
  const src = e.currentTarget.closest('tr.nw-item');
  const x0 = e.clientX, y0 = e.clientY;
  let on = false, mark = null, where = null;
  const clear = () => { mark?.classList.remove('drop-before', 'drop-after'); mark = null; };
  const move = ev => {
    if (!on) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      on = true; src.classList.add('nw-dragging'); document.body.classList.add('nw-drag-on');
    }
    ev.preventDefault();
    if (ev.clientY < 70) scrollBy(0, -14); else if (ev.clientY > innerHeight - 50) scrollBy(0, 14);
    const tr = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('table.nw-sheet tr');
    clear(); where = null;
    if (!tr || tr === src) return;
    const sec = tr.dataset.sec;
    if (!sec) return;
    const r = tr.getBoundingClientRect();
    if (tr.classList.contains('nw-item')) {
      const up = ev.clientY < r.top + r.height / 2;
      where = { section: sec, ...(up ? { before: tr.dataset.k } : { after: tr.dataset.k }) };
      mark = tr; tr.classList.add(up ? 'drop-before' : 'drop-after');
    } else if (tr.classList.contains('nw-band') && tr.closest('tbody') && sec !== 'Asset Allocation' && !tr.classList.contains('nw-aa')) {
      where = { section: sec, at: 'start' }; mark = tr; tr.classList.add('drop-after');
    } else if (tr.classList.contains('nw-total')) {
      where = { section: sec, at: 'end' }; mark = tr; tr.classList.add('drop-before');
    }
  };
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    if (!on) return;
    dragEnd = Date.now();
    src.classList.remove('nw-dragging'); document.body.classList.remove('nw-drag-on'); clear();
    if (!where) return;
    const from = src.dataset.sec;
    moveNwItem(ctx.d.nwGroups(), src.dataset.k, where.section, where);
    undoToast(from === where.section ? 'Riga spostata' : `Spostata in ${where.section}`);
  };
  addEventListener('pointermove', move, { passive: false }); addEventListener('pointerup', up); addEventListener('pointercancel', up);
}

function sheetTable(ctx, Y) {
  const { d } = ctx;
  const S0 = d.nwSheet(Y, nwQ);
  const curY = Number(d.refDate.slice(0, 4));
  const every = [...S0.sections.flatMap(x => [...x.rows.flatMap(r => r.values), ...x.total, ...x.gain]), ...S0.total, ...S0.gain];
  const fitMax = every.reduce((m, v) => Math.max(m, Math.abs(v || 0)), 0);
  const lastI = vals => { for (let i = 12; i > 0; i--) if (vals[i] != null) return i; return -1; };
  const yearPct = vals => { const i = lastI(vals); return i < 0 || !vals[0] ? 0 : (vals[i] - vals[0]) / Math.abs(vals[0]) * 100; };
  const fitPctMax = [...S0.sections.flatMap(x => [...x.pct, yearPct(x.total), ...x.rows.map(r => yearPct(r.values))]), ...S0.pct, yearPct(S0.total)]
    .reduce((m, v) => Math.max(m, Math.abs(v || 0)), 0);
  const fit = fitTable({ maxAbs: fitMax, maxPct: fitPctMax });
  watchFit('#/patrimonio', fit, () => fitTable({ maxAbs: fitMax, maxPct: fitPctMax }));
  const dec = fit ? fit.dec : 2;
  const noEuro = fit && !fit.euro;
  const num = fitMoney(fit, moneyText, ui.base, ui.privacy);
  const t2 = v => num(v, false);
  const sg = v => num(v, true);
  const dates = [`${Y - 1}-12-31`, ...Array.from({ length: 12 }, (_, i) => monthEnd(`${Y}-${String(i + 1).padStart(2, '0')}`))];
  // differenza dal 31/12 dell'anno prima all'ultima fine mese con un valore
  const lastIdx = vals => { for (let i = 12; i > 0; i--) if (vals[i] != null) return i; return -1; };
  const diffOf = vals => { const i = lastIdx(vals); return i < 0 || vals[0] == null ? null : vals[i] - vals[0]; };
  const diffPct = vals => { const dv = diffOf(vals); return dv == null || !vals[0] ? null : dv / Math.abs(vals[0]) * 100; };
  const head = h('tr', h('th.sticky', { dataset: { col: 'name' } }, noEuro ? 'Net Worth (€)' : 'Net Worth'),
    dates.map((dt, i) => h('th.num', { dataset: { col: 'c' + i }, class: [i === 0 ? 'prev' : '', S0.cols[i] ? '' : 'future'].join(' ') }, fit && fit.short ? dmy(dt).slice(0, 6) + dt.slice(2, 4) : dmy(dt))),
    h('th.num.nw-dcol', { dataset: { col: 'diff' }, title: `Differenza dal 31/12/${Y - 1} all'ultima fine mese` }, fit && fit.per < 105 ? `Diff. ${String(Y - 1).slice(2)}→${String(Y).slice(2)}` : `Diff. ${Y - 1}→${Y}`), h('th.num.nw-dpct', { dataset: { col: 'pct' } }, '%'));
  const pcs = v => (v == null ? '' : formatPercent(v, fit ? fit.pdec : 2, true));
  const cells = (vals, fmt, cls) => vals.map((v, i) => h('td.num', { class: [cls ? cls(v) : '', i === 0 ? 'prev' : '', S0.cols[i] ? '' : 'future'].join(' ') }, fmt(v)));
  const diffs = (vals, fmt) => [h('td.num.nw-dcol', { class: tone(diffOf(vals)) }, fmt ? (diffOf(vals) == null ? '' : (diffOf(vals) > 0 ? '+' : '') + fmt(diffOf(vals))) : sg(diffOf(vals))), h('td.num.nw-dpct', { class: tone(diffPct(vals)) }, pcs(diffPct(vals)))];
  const noDiff = () => [h('td.num.nw-dcol'), h('td.num.nw-dpct')];
  const band = (label, color, raw) => h('tr.nw-band', { style: { '--sec': color }, dataset: { sec: label } },
    // sezione: quadratino del colore e matita per il nome; Asset Allocation senza quadratino (D)
    h('td.sticky', h('span', raw !== undefined ? colorDot(raw, c => setSectionColor(d, label, c), `Colore di ${label}`) : null, label),
      raw !== undefined ? renameBtn('Nome della sezione', label, v => { renameNwSection(d.nwGroups(), label, v); undoToast(`Sezione rinominata: ${v}`); }) : null),
    dates.map(() => h('td')), noDiff());
  // spazio tra una sezione e l'altra: si vede dove finisce un blocco e ne comincia un altro
  const gap = () => h('tr.nw-gap', { 'aria-hidden': 'true' }, h('td.sticky'), dates.map(() => h('td')), noDiff());
  const body = [];
  // le celle delle righe si scrivono direttamente (D: "se clicco in una cella devo poter modificare da solo
  // l'importo"); una riga in un'altra valuta (i contanti in dollari) si legge nella sua valuta, come nel foglio
  const natFmt = (v, cur) => (v == null ? '' : ui.privacy ? moneyText(v, cur) : `${formatNumber(v / 100, 2, 2)} ${CUR_SYM[cur] || cur}`);
  const itemCells = r => r.values.map((v, i) => {
    const dt = S0.cols[i];
    const nat = r.native ? r.native[i] : v;
    const can = !!dt && !(r.acc && hasPlan(r.acc));
    const attrs = { class: [i === 0 ? 'prev' : '', dt ? '' : 'future', can ? 'nw-cell cell-edit' : ''].join(' '), dataset: { k: r.key, i: String(i) },
      title: r.native && v != null ? `${natFmt(nat, r.cur)} ≈ ${moneyText(v)} al cambio` : can ? 'Tocca per scrivere il valore esatto' : null };
    if (can) {
      attrs.tabindex = '0';
      attrs.onclick = e => { e.stopPropagation(); editCell(e.currentTarget, r, dt, nat); };
      attrs.onkeydown = e => { if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); editCell(e.currentTarget, r, dt, nat); } };
    }
    return h('td.num', attrs, r.native ? natFmt(nat, r.cur) : t2(v));
  });
  for (const sec of S0.sections) {
    const col = colorVar(sec.color);
    if (body.length) body.push(gap());
    body.push(band(sec.name, col, sec.color));
    for (const r of sec.rows) {
      // tocca il nome: nome e sezione a piacere, oppure apri il conto / il titolo; trascinalo per spostare la riga
      body.push(h('tr.nw-item.click', { onclick: () => { if (!dragJustEnded()) nwItemSheet(ctx, r, sec.name); }, style: { '--sec': col }, dataset: { k: r.key, sec: sec.name } },
        // una riga sola come nel foglio: il tipo (conto corrente, ETF…) si legge passandoci sopra
        h('td.sticky.nw-drag-h', { title: [r.label, r.hd && r.label !== r.name ? r.name : r.sub, 'trascina per spostare'].filter(Boolean).join(' · '), onpointerdown: e => startDrag(e, ctx) },
          h('span.nw-name', icon('grip', 14, 'nw-grip'), r.hd ? hdBadge(r.hd, true) : r.acc && bankLogo(r.acc.name, r.acc.institution) ? h('img.nw-logo', { src: bankLogo(r.acc.name, r.acc.institution), alt: '', width: 16, height: 16 }) : r.acc?.cls ? hdBadge(r.acc, true) : null, r.label)),
        itemCells(r), diffs(r.native || r.values, r.native ? v => natFmt(v, r.cur) : null)));
    }
    body.push(h('tr.nw-total', { style: { '--sec': col }, dataset: { sec: sec.name } }, h('td.sticky', 'Total'), cells(sec.total, t2), diffs(sec.total)));
    body.push(h('tr.nw-gain', h('td.sticky', 'Gain/Loss'), cells(sec.gain, sg, tone), noDiff()));
    body.push(h('tr.nw-pct', h('td.sticky', '%'), cells(sec.pct, pcs, tone), noDiff()));
  }
  // Asset Allocation come nel foglio di D: per ogni sezione le sue somme mese per mese, la quota (%)
  // solo nella prima colonna (quella dell'ultima fine mese); sotto il Net Worth: Total, Gain/Loss, %
  // (D: "nelle varie celle ci sono le somme di tutto, le % sono solo nella prima colonna")
  const endI = lastIdx(S0.total);
  const shareOf = name => { const a = S0.alloc.find(x => x.name === name); return a && endI >= 0 ? a.pct[endI] : null; };
  body.push(gap(), band('Asset Allocation', 'var(--ink-3)'));
  body[body.length - 1].classList.add('nw-aa'); delete body[body.length - 1].dataset.sec;
  for (const sec of S0.sections) {
    const sh = shareOf(sec.name);
    body.push(h('tr.nw-alloc', { style: { '--sec': colorVar(sec.color) } },
      h('td.sticky', h('span.nw-al', colorDot(sec.color, c => setSectionColor(d, sec.name, c), `Colore di ${sec.name}`), h('span.nw-al-n', sec.name), h('b.nw-share', sh == null ? '' : formatPercent(sh, 1)))),
      cells(sec.total, t2), diffs(sec.total)));
  }
  body.push(h('tr.nw-total.nw-grand', h('td.sticky', 'Total'), cells(S0.total, t2), diffs(S0.total)));
  body.push(h('tr.nw-gain', h('td.sticky', 'Gain/Loss'), cells(S0.gain, sg, tone), noDiff()));
  body.push(h('tr.nw-pct', h('td.sticky', '%'), cells(S0.pct, pcs, tone), noDiff()));

  const exportCsv = () => {
    const rows = [['Net Worth', ...dates.map(dmy), `Diff. ${Y - 1}-${Y}`, '%']];
    const pct2 = v => v.toFixed(2).replace('.', ',');
    const line = (label, vals, f = csvNumber, withDiff = true) => rows.push([label, ...vals.map(v => (v == null ? '' : f(v))), withDiff && diffOf(vals) != null ? csvNumber(diffOf(vals)) : '', withDiff && diffPct(vals) != null ? pct2(diffPct(vals)) : '']);
    for (const sec of S0.sections) {
      rows.push([sec.name]);
      for (const r of sec.rows) line(r.label, r.values);
      line('Total', sec.total); line('Gain/Loss', sec.gain, csvNumber, false); line('%', sec.pct, pct2, false);
    }
    rows.push(['Asset Allocation', '%']);
    for (const sec of S0.sections) { const sh = shareOf(sec.name); line(`${sec.name}${sh == null ? '' : ` (${pct2(sh)}%)`}`, sec.total); }
    line('Total', S0.total); line('Gain/Loss', S0.gain, csvNumber, false); line('%', S0.pct, pct2, false);
    download(new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' }), `net-worth-${Y}.csv`);
    toast('Tabella esportata', { kind: 'ok' });
  };
  const table = h('table.table.nw-table.nw-months.nw-sheet', { 'data-tid': fit ? 'nw-fit' : 'nw', class: fit ? 'fit' : '' }, h('thead', head), h('tbody', body));
  // dopo Invio / Tab nella cella di prima: si continua a scrivere in quella dopo
  resumeEdit(table);
  if (fit) { table.style.setProperty('--nw-first', fit.first + 'px'); table.style.fontSize = fit.font + 'px'; }
  const scroller = h('div.table-wrap.nw-scroll', table);
  // su telefono si apre sui mesi più recenti
  if (!fit && Y === curY) requestAnimationFrame(() => requestAnimationFrame(() => { const th = scroller.querySelectorAll('thead th')[Math.max(1, Number(d.refDate.slice(5, 7)) - 3)]; if (th) scroller.scrollLeft = th.offsetLeft - 220; }));
  return card(`Net Worth ${Y}`, {
    sub: 'Valori a fine mese, al centesimo. Tocca una cella per scrivere il valore, tocca un nome per rinominarlo o trascinalo per spostare la riga.',
    action: h('div.card-acts', h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: () => organizeSheet(ctx, S0) }, icon('edit', 16), 'Organizza'), h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: exportCsv }, icon('download', 16), 'CSV')),
  }, h('div.inv-filters', filterBox('nw', nwQ, v => { nwQ = v; ctx.rerender(); }, 'Filtra: conto, titolo o sezione')), scroller);
}

/** Una riga del Net Worth (D: "se clicco su un etf… voglio avere la possibilità di modificare o spostarlo
    all'interno di una categoria a mio piacimento"): nome, sezione (anche una nuova), e "Apri". */
function nwItemSheet(ctx, r, secName) {
  const G = ctx.d.nwGroups();
  const nameIn = textInput({ value: r.label, max: 60 });
  const newIn = textInput({ value: '', placeholder: 'es. Azioni USA', max: 60 });
  const newWrap = h('div', field('Nome della nuova sezione', newIn));
  newWrap.style.display = 'none';
  let target = secName;
  const opts = [...G.sections.filter(x => x.items.length).map(x => ({ value: x.name, label: x.name })), { value: '__new', label: '+ Nuova sezione…' }];
  const sel = selectInput(opts, secName, v => { target = v; newWrap.style.display = v === '__new' ? '' : 'none'; if (v === '__new') newIn.focus(); });
  const open = r.hd ? () => ctx.go('investimenti/' + r.hd.id) : r.acc ? () => ctx.go('conti/' + r.acc.id) : null;
  const save = () => {
    const section = target === '__new' ? newIn.value.trim() : target;
    if (target === '__new' && !section) { toast('Scrivi il nome della nuova sezione', { kind: 'err' }); return; }
    const name = nameIn.value.trim();
    if (!name) { toast('Il nome non può essere vuoto', { kind: 'err' }); return; }
    if (name === r.label && section === secName) { sh.close(true); return; }
    editNwItem(G, r.key, { name: name !== r.label ? name : '', section: section !== secName ? section : '' });
    sh.close(true);
    undoToast(section !== secName ? `Spostato in ${section}` : 'Nome cambiato');
  };
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  const sh = openSheet({
    title: r.label, subtitle: [r.hd && r.label !== r.name ? r.name : r.sub, secName].filter(Boolean).join(' · '), size: 'sm',
    body: h('div.stack',
      field('Nome', nameIn, { hint: r.acc ? 'Cambia ovunque nell\'app. Reimportando il file, la riga col nome vecchio resta questa.' : 'Il nome che ha nel Net Worth (negli Investimenti resta il suo).' }),
      field('Sezione', sel),
      newWrap),
    footer: [open ? h('button.btn.btn-ghost', { type: 'button', onclick: () => { sh.close(true); open(); } }, r.acc?.cls ? 'Apri i dettagli' : r.acc ? 'Apri il conto' : 'Apri il titolo') : null,
      h('button.btn.btn-primary', { type: 'button', onclick: save }, 'Salva')],
  });
}

/** Sezioni e righe del Net Worth: rinomina, colori, ordine, sposta le righe da una sezione all'altra. */
function organizeSheet(ctx, S0) {
  // si parte da quello che si vede (anche le righe messe da sole nelle sezioni di base)
  let secs = S0.sections.map(x => ({ name: x.name, color: x.color, items: x.rows.map(r => r.key) }));
  const labelOf = new Map(S0.sections.flatMap(x => x.rows.map(r => [r.key, r.label])));
  const labels = { ...(ctx.st.settings.nwLayout?.labels || {}) };
  const list = h('div.catman');
  const draw = () => {
    list.replaceChildren(...secs.map((sec, si) => {
      const name = h('input.input', { value: sec.name, maxlength: 60, 'aria-label': 'Nome della sezione', oninput: e => { sec.name = e.target.value; } });
      return h('div.catman-group',
        h('div.catman-head.nw-org-head',
          name,
          h('span.catman-tools',
            (() => { const c = colorChoice(sec.color, v => { sec.color = v; }); c.classList.add('sm'); return c; })(),
            h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Su', disabled: si === 0, onclick: () => { [secs[si - 1], secs[si]] = [secs[si], secs[si - 1]]; draw(); } }, icon('chevU', 16)),
            h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Giù', disabled: si === secs.length - 1, onclick: () => { [secs[si + 1], secs[si]] = [secs[si], secs[si + 1]]; draw(); } }, icon('chevD', 16)))),
        h('div.rows', sec.items.map((k, ii) => h('div.row.catman-row',
          h('span.row-main', h('span.row-title', labelOf.get(k) || k)),
          h('span.catman-tools',
            selectInput(secs.map((x, j) => ({ value: String(j), label: x.name || 'Sezione' })), String(si), v => { sec.items.splice(ii, 1); secs[+v].items.push(k); draw(); }),
            h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Su', disabled: ii === 0, onclick: () => { [sec.items[ii - 1], sec.items[ii]] = [sec.items[ii], sec.items[ii - 1]]; draw(); } }, icon('chevU', 16)),
            h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Giù', disabled: ii === sec.items.length - 1, onclick: () => { [sec.items[ii + 1], sec.items[ii]] = [sec.items[ii], sec.items[ii + 1]]; draw(); } }, icon('chevD', 16)))))),
        sec.items.length ? null : h('p.field-hint', 'Sezione vuota: sparirà salvando.'));
    }), h('button.btn.btn-soft.btn-block', { type: 'button', onclick: () => { secs.push({ name: 'Nuova sezione', color: 0, items: [] }); draw(); } }, icon('plus', 18), 'Nuova sezione'));
  };
  draw();
  const save = () => {
    const layout = { sections: secs.filter(x => x.items.length).map(x => ({ name: (x.name || 'Sezione').trim().slice(0, 60), color: x.color || 0, items: x.items })), labels };
    setSetting('nwLayout', layout);
    sh.close(true);
    toast('Net Worth organizzato', { kind: 'ok' });
  };
  const sh = openSheet({
    title: 'Organizza il Net Worth', subtitle: 'Sezioni, colori e ordine delle righe, come nel tuo foglio', size: 'md',
    body: h('div.stack', list),
    footer: [h('button.btn.btn-primary', { type: 'button', onclick: save }, 'Salva')],
    onClose: () => ctx.rerender(),
  });
}


/* ─── Aggiorna i valori: il Net Worth di una fine mese, riga per riga come nel foglio ─── */
export function checkInEditor(ctx, presetMonth) {
  const { d } = ctx;
  const lastEnd = monthKey(addMonthKey(monthKey(d.refDate), -1));
  let m = presetMonth || lastEnd;
  const body = h('div.stack');
  const inputs = [];
  const draw = () => {
    inputs.length = 0;
    const dt = monthEnd(m), prevDt = monthEnd(addMonthKey(m, -1));
    const Y = Number(m.slice(0, 4));
    const T = d.nwSheet(Y);
    const P = d.nwSheet(Number(prevDt.slice(0, 4)));
    const iCol = Number(m.slice(5, 7)), iPrev = prevDt.slice(0, 4) === m.slice(0, 4) ? iCol - 1 : 12;
    const months = [];
    for (let k = 0; k < 18; k++) months.push(addMonthKey(lastEnd, -k));
    const sel = selectInput(months.map(x => ({ value: x, label: `Fine ${monthName(Number(x.slice(5, 7)))} ${x.slice(0, 4)}` })), m, v => { m = v; draw(); });
    const sections = T.sections.length ? T.sections : P.sections;
    const rowsOf = sec => sec.rows.map(r => {
      const cur = T.sections.find(x => x.name === sec.name)?.rows.find(x => x.key === r.key)?.values[iCol] ?? null;
      const prev = P.sections.find(x => x.name === sec.name)?.rows.find(x => x.key === r.key)?.values[iPrev] ?? null;
      const acc = r.acc, hd = r.hd;
      if (acc && hasPlan(acc)) return h('div.checkin-row', accAvatar(acc), h('div.checkin-main', h('span.row-title', r.label), h('span.row-sub', 'segue il piano d\'ammortamento')), h('div.checkin-ctl', h('span.muted.small', moneyText(cur ?? prev ?? 0))));
      const liab = acc && isLiability(acc);
      // i conti in un'altra valuta si scrivono nella loro valuta (il foglio è nella valuta principale)
      const cur$ = acc ? acc.currency : d.base;
      const rate = d.toBase(1000000, cur$) / 1000000 || 1;
      const inAcc = v => (v == null ? null : Math.round(v / rate));
      const inp = amountInput({ value: cur == null ? null : Math.abs(inAcc(cur)), currency: cur$, placeholder: prev == null ? 'valore' : (Math.abs(inAcc(prev)) / 100).toLocaleString('it-IT', { maximumFractionDigits: 2 }) });
      inputs.push({ r, inp, liab, cur: inAcc(cur) });
      // per un titolo, il valore che ha oggi negli Investimenti (solo come suggerimento: il Net Worth resta a sé)
      const live = hd ? d.toBase(Math.round(position(hd).value * 100), hd.currency) : null;
      return h('div.checkin-row',
        hd ? hdBadge(hd) : acc ? accAvatar(acc) : null,
        h('div.checkin-main', h('span.row-title', r.label),
          h('span.row-sub', prev != null ? `fine mese prima: ${moneyText(prev)}` : 'nuovo', live ? [' · ', h('button.link.small', { type: 'button', onclick: () => { inp.input.value = (live / 100).toFixed(2).replace('.', ','); inp.input.dispatchEvent(new Event('input')); } }, `negli Investimenti oggi ${moneyText(live)}`)] : null)),
        h('div.checkin-ctl', inp));
    });
    body.replaceChildren(
      h('div.field', h('label.field-label', 'Mese'), sel),
      h('p.field-hint', `Scrivi i valori al ${formatDate(dt, { year: true })}, come nel tuo foglio. Le righe vuote restano come sono. I debiti si scrivono come numero positivo.`),
      sections.length ? h('div.checkin-list', sections.map(sec => h('div.checkin-group', h('div.cat-group-t', sec.name), rowsOf(sec)))) : h('p.muted', 'Nessuna riga: importa il tuo foglio Net Worth o aggiungi un conto.'));
  };
  draw();
  const save = () => {
    const dt = monthEnd(m);
    const entries = [];
    for (const { r, inp, liab, cur } of inputs) {
      if (inp.input.value.trim() === '') continue;
      const c = inp.getCents();
      if (c == null) continue;
      const val = liab ? -Math.abs(c) : c;
      if (cur != null && val === cur) continue;
      if (r.hd) entries.push({ holding: r.hd.id, value: val });
      else if (r.acc) entries.push({ account: r.acc.id, value: val });
    }
    if (!entries.length) { toast('Nessun valore cambiato'); return; }
    saveCheckIn(dt, entries);
    toast(`${entries.length} ${entries.length === 1 ? 'valore aggiornato' : 'valori aggiornati'} al ${formatDate(dt, { year: true })}`, { kind: 'ok' });
    s.close(true);
  };
  const s = openSheet({ title: 'Aggiorna il Net Worth', subtitle: 'I valori effettivi di fine mese, riga per riga', size: 'md', body, footer: [h('button.btn.btn-primary', { type: 'button', onclick: save }, 'Salva i valori')] });
}

/* ─── Anno per anno: il patrimonio a fine anno (31/12 del foglio) ─── */
function yearsCard(ctx, years) {
  const { d } = ctx;
  const rows = years.slice().sort().map(Y => {
    const T = d.nwSheet(Y);
    let li = 12;
    while (li > 0 && T.total[li] == null) li--;
    return { Y, end: T.total[li], endCol: T.cols[li], start: T.total[0] };
  }).filter(r => r.end != null).reverse();
  if (rows.length < 1) return null;
  return card('Anno per anno', { sub: 'Patrimonio a fine anno (o all\'ultima fine mese) e differenza dal 31/12 prima' },
    h('div.table-wrap', h('table.table',
      h('thead', h('tr', h('th', 'Anno'), h('th.num', 'Patrimonio'), h('th.num', 'Differenza'), h('th.num', '%'))),
      h('tbody', rows.map(r => h('tr.click', { onclick: () => { year = r.Y; ctx.rerender(); } },
        h('td', r.endCol && r.endCol.slice(5) !== '12-31' ? `${r.Y} (a fine ${monthName(Number(r.endCol.slice(5, 7)))})` : String(r.Y)),
        h('td.num', moneyText(r.end)),
        h('td.num', { class: r.start == null ? 'muted' : r.end - r.start >= 0 ? 'pos' : 'neg' }, r.start == null ? 'primo anno' : moneyText(r.end - r.start, ui.base, { sign: true })),
        h('td.num', r.start ? formatPercent(pctOf(r.end, r.start), 2, true) : '—')))))));
}

/** Scorre fino alla sezione nella tabella del Net Worth e la fa lampeggiare un attimo. */
function showSection(name) {
  const row = [...document.querySelectorAll('table.nw-sheet tr.nw-band')].find(r => r.dataset.sec === name);
  if (!row) return;
  row.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  row.classList.remove('nw-flash'); void row.offsetWidth; row.classList.add('nw-flash');
}

export default {
  render(ctx) {
    const { d } = ctx;
    const curY = Number(d.refDate.slice(0, 4));
    const M = d.nwMonthly(120);
    const hasData = M.sections.length > 0 && M.total[M.last] != null;
    // arrivo da una riga del riepilogo (qui o nella Panoramica): porto la tabella su quella sezione
    const sez = ctx.route.query.sez;
    if (sez) {
      history.replaceState(null, '', '#/patrimonio');
      setTimeout(() => showSection(sez), 60);
    }
    const actions = [
      h('button.btn.btn-soft', { type: 'button', onclick: () => openFileImport(ctx) }, icon('upload', 18), h('span', 'Importa da Excel')),
    ];
    if (!hasData) {
      return { title: 'Patrimonio', sub: 'Il tuo Net Worth, fine mese per fine mese', actions: [...actions, h('button.btn.btn-soft', { type: 'button', onclick: () => checkInEditor(ctx) }, icon('edit', 18), h('span', 'Aggiorna i valori'))],
        node: h('section.card', empty({ icon: 'layers', title: 'Ancora nessun valore di fine mese', text: 'Importa il tuo foglio Net Worth (Excel) oppure aggiungi i conti e scrivi i loro valori a fine mese: qui vedrai il patrimonio effettivo di ogni fine mese, sezione per sezione.', action: h('div.row-btns', h('button.btn.btn-primary', { type: 'button', onclick: () => openFileImport(ctx) }, icon('upload', 18), 'Importa da Excel'), h('button.btn.btn-soft', { type: 'button', onclick: () => accountEditor(ctx) }, icon('plus', 18), 'Aggiungi un conto')) })) };
    }
    const L = M.last, lastDate = M.cols[L];
    const now = M.total[L], prev = L > 0 ? M.total[L - 1] : null;
    const decIdx = M.cols.indexOf(`${Number(lastDate.slice(0, 4)) - 1}-12-31`);
    const dec = decIdx >= 0 ? M.total[decIdx] : null;
    let peak = { v: -Infinity, i: -1 };
    M.total.forEach((v, i) => { if (v != null && v > peak.v) peak = { v, i }; });
    const firstY = Number((M.cols.find((c, i) => M.total[i] != null) || lastDate).slice(0, 4));
    const years = [];
    for (let y = curY; y >= Math.min(firstY, curY); y--) years.push(y);
    if (!year || !years.includes(year)) year = Number(lastDate.slice(0, 4));
    const mLabel = `${monthName(Number(lastDate.slice(5, 7)))} ${lastDate.slice(0, 4)}`;

    // una card sola (D: "anche le cards in patrimonio non mi piacciono"): il numero, le variazioni,
    // l'andamento per sezione e accanto le sezioni con valore, quota e variazione sul mese prima
    const pos = M.sections.reduce((a, x) => a + Math.max(0, x.total[L] || 0), 0) || 1;
    const kpi = (label, value, extra) => h('div.dk', h('span.dk-l', label), h('span.dk-v', value), extra ? h('span.dk-x', extra) : null);
    // i mesi del grafico: dal primo con valori, dal 31/12, le ultime 12 / 24 fine mese o da un mese a un altro
    const withData = M.cols.map((c, i) => i).filter(i => M.total[i] != null && i <= L);
    const firstI = withData[0] ?? 0;
    const posOf = ym => { const i = M.cols.findIndex(c => c && monthKey(c) === ym); return i < 0 ? null : i; };
    let from = Math.max(firstI, L + 1 - 12), to = L;
    if (span === 'all') from = firstI;
    else if (span === 'ytd') { const di = M.cols.indexOf(`${Number(lastDate.slice(0, 4)) - 1}-12-31`); from = di >= firstI ? di : firstI; }
    else if (span === 'py') {
      const y1 = Number(lastDate.slice(0, 4)) - 1;
      from = Math.max(firstI, posOf(`${y1}-01`) ?? firstI); to = Math.min(L, posOf(`${y1}-12`) ?? L);
      if (from > to) { from = Math.max(firstI, L - 11); to = L; }
    }
    else if (span && typeof span === 'object') {
      from = posOf(span.from) ?? firstI; to = posOf(span.to) ?? L;
      if (from > to) [from, to] = [to, from];
      from = Math.max(firstI, from); to = Math.min(L, to);
    } else if (Number.isFinite(span)) from = Math.max(firstI, L + 1 - span);
    const idx = Array.from({ length: Math.max(1, to + 1 - from) }, (_, k) => from + k);
    const rangeTools = h('div.nw-sum-tools',
      periodPicker({ value: span, range: { from: monthKey(M.cols[from]), to: monthKey(M.cols[to]) }, months: withData.map(i => monthKey(M.cols[i])), onChange: v => { setSpan(v); ctx.rerender(); } }));
    const chartEl = barChart({
      labels: idx.map(i => formatMonth(monthKey(M.cols[i]), true)), tipLabels: idx.map(i => `Fine ${formatMonth(monthKey(M.cols[i]))}`),
      series: M.sections.map(sec => ({ name: sec.name, color: softColor(colorVar(sec.color)), values: idx.map(i => sec.total[i] || 0) })),
      stacked: true, line: { name: 'Net Worth', color: 'var(--ink)', values: idx.map(i => M.total[i] || 0) },
      fmt: tipMoney, fmtAxis: axisMoney, height: 270, mask: ui.privacy, title: 'Net Worth a fine mese, per sezione',
      onPick: k => { const y = Number(M.cols[idx[k]].slice(0, 4)); if (years.includes(y)) { year = y; ctx.rerender(); } },
    });
    const summary = h('section.card.dash-card.nw-summary',
      h('div.dash-head',
        h('div', h('span.dash-label', `Net Worth a fine ${mLabel}`), h('div.dash-big', money(now))),
        h('button.btn.btn-primary', { type: 'button', onclick: () => checkInEditor(ctx) }, icon('edit', 18), h('span', 'Aggiorna i valori'))),
      h('div.dash-kpis',
        kpi('Sul mese prima', prev != null ? money(now - prev, d.base, { sign: true, tone: now >= prev ? 'pos' : 'neg' }) : '—', prev != null ? delta(pctOf(now, prev)) : null),
        kpi(`Dal 31/12/${Number(lastDate.slice(0, 4)) - 1}`, dec != null ? money(now - dec, d.base, { sign: true, tone: now >= dec ? 'pos' : 'neg' }) : '—', dec != null ? delta(pctOf(now, dec)) : null),
        kpi('Il più alto', peak.i >= 0 ? money(peak.v) : '—', peak.i >= 0 ? formatMonth(monthKey(M.cols[peak.i])) : null)),
      h('div.dash-nw-body',
        h('div.dash-chart',
          rangeTools,
          chartEl),
        h('div.dash-secs',
          h('div.alloc-bar.dash-alloc', M.sections.filter(x => (x.total[L] || 0) > 0).map(x => h('span', { style: { width: ((x.total[L] || 0) / pos * 100) + '%', background: softColor(colorVar(x.color)) }, title: x.name }))),
          h('div.dash-list', M.sections.map(sec => {
            const v = sec.total[L], g = sec.gain[L];
            return h('div.dash-row.nw-sum-row',
              colorDot(sec.color, c => setSectionColor(d, sec.name, c), `Colore di ${sec.name}`),
              h('a.dash-n', { href: '#/patrimonio?sez=' + encodeURIComponent(sec.name), title: `Vai a ${sec.name} nella tabella` }, sec.name),
              h('span.dash-p', v > 0 ? formatPercent(v / pos * 100, 0) : ''),
              h('span.dash-v', v == null ? h('span.muted', '—') : money(v, d.base, { tone: v < 0 ? 'neg' : '' })),
              h('span.dash-g', g ? money(g, d.base, { sign: true, tone: g >= 0 ? 'pos' : 'neg' }) : ''));
          })))),
      h('p.dash-foot', 'Il patrimonio è quello del tuo Net Worth a fine mese, come nel foglio. Gli Investimenti restano a sé.'));

    const yearTabs = segTabs(years.map(y => ({ value: y, label: String(y) })), year, v => { year = v; ctx.rerender(); });
    return {
      title: 'Patrimonio', sub: 'Il tuo Net Worth, fine mese per fine mese', actions,
      node: h('div.stack', summary,
        h('div.nw-year-bar', h('h2.section-title', 'Net Worth'), yearTabs),
        sheetTable(ctx, year),
        yearsCard(ctx, years),
        h('p.fine', icon('info', 14), ' Il patrimonio è il tuo Net Worth: i valori effettivi di fine mese di conti, titoli, TFR netto… come nel foglio. I titoli valgono quanto scritto nel Net Worth (dal file o da "Aggiorna i valori"), non i prezzi degli Investimenti, che restano a sé. Le entrate e le uscite non si sommano: contano i valori di fine mese.')),
    };
  },
};
