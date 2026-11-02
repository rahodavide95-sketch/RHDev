/* Patrimonio = il riepilogo del Net Worth di D, con i valori effettivi di ogni fine mese.
   D: "il patrimonio non è la somma di entrate, networth e wallet… nel patrimonio deve esserci
   semplicemente il riassunto del networth e quindi quello effettivo è quello di ogni fine mese.
   La sezione investimenti è a sé." Qui: patrimonio all'ultima fine mese, una scheda per sezione,
   l'andamento, il foglio Net Worth dell'anno, anno per anno; "Aggiorna i valori" = il Net Worth
   di fine mese, riga per riga. */

import { h, icon, download } from '../ui/dom.js';
import { barChart, legend, sparkline } from '../ui/charts.js';
import { openSheet, amountInput, toast, empty, selectInput, colorChoice } from '../ui/components.js';
import { money, moneyText, delta, axisMoney, tipMoney, ui } from '../ui/fmt.js';
import { card, accAvatar, segTabs, filterBox, hdBadge, colorVar } from './common.js';
import { accountEditor } from './editors.js';
import { openFileImport } from './invimport.js';
import { bankLogo } from '../data/banks.js';
import { saveCheckIn, setSetting } from '../actions.js';
import { isLiability, hasPlan, position } from '../core/model.js';
import { monthKey, monthEnd, addMonthKey, formatMonth, formatDate, monthName } from '../core/dates.js';
import { formatPercent, formatNumber } from '../core/money.js';
import { toCSV, csvNumber } from '../core/csv.js';

let year = null;
let span = 12;
let nwQ = '';
const pctOf = (a, b) => (a != null && b ? (a - b) / Math.abs(b) * 100 : null);

/* ─── Net Worth come il foglio di D: sezioni con le loro righe, Total, Gain/Loss e %;
   in fondo il patrimonio netto e l'Asset Allocation ─── */
const dmy = iso => `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const pc = v => (v == null ? '' : formatPercent(v, 2, true));
const tone = v => (v == null || !Math.round(v * 100) ? '' : v > 0 ? 'pos' : 'neg');

/* La tabella si adatta allo schermo (D: "far entrare tutto da dic 2025 alla differenza tra
   2025-2026, anche senza comprimere la barra"): su computer 15 colonne uguali che riempiono la
   pagina; carattere, decimali e simbolo € scelti in base allo spazio e al numero più lungo
   (prima si tolgono i decimali, poi si rimpicciolisce, per ultimo si toglie il simbolo €,
   che resta nell'intestazione). Su telefono la tabella scorre. */
let fitMax = 0, fitPctMax = 0;
const measure = (txt, px) => {
  const c = measure.c || (measure.c = document.createElement('canvas').getContext('2d'));
  c.font = `700 ${px}px Inter, system-ui, sans-serif`;
  return c.measureText(txt).width;
};
function fitOf(maxAbs = fitMax, maxPct = fitPctMax) {
  const W = (document.getElementById('view')?.clientWidth || innerWidth) - 50;
  if (innerWidth < 760 || W < 820) return null;
  const first = W > 1700 ? 240 : W > 1350 ? 200 : W > 1000 ? 170 : 150;
  const per = (W - first) / 15 - 12;     // spazio per il testo (tolti i margini della cella)
  // il numero più lungo scritto con zeri (cifre tutte larghe uguali)
  const big = Math.floor(Math.abs(maxAbs) / 100) || 1;
  const sample = (dec, euro) => '+' + formatNumber(Number('9'.repeat(String(big).length)), dec, dec).replace(/\d/g, '0') + (euro ? ' €' : '');
  const pctSample = pd => '+' + '0'.repeat(String(Math.floor(Math.abs(maxPct)) || 1).length) + (pd ? ',' + '0'.repeat(pd) : '') + '%';
  const tries = [[14, 2, true], [14, 0, true], [13, 0, true], [12, 0, true], [12, 0, false], [11.5, 0, false], [11, 0, false], [10.5, 0, false]];
  const [font, dec, euro] = tries.find(([f, dd, e]) => measure(sample(dd, e), f) <= per) || tries[tries.length - 1];
  const pdec = [2, 1, 0].find(pd => measure(pctSample(pd), font) <= per) ?? 0;
  return { first, per: per + 12, dec, font, euro, pdec, short: measure('31/12/2025', font * 0.86) > per - 2 };
}
const fitSig = f => (f ? `${f.dec}|${f.font}|${f.first}|${f.euro}|${f.short}|${f.pdec}` : 'scroll');
let fitKey = '';
addEventListener('resize', () => {
  clearTimeout(fitOf.t);
  fitOf.t = setTimeout(() => {
    if (fitSig(fitOf()) !== fitKey && location.hash.startsWith('#/patrimonio')) window.dispatchEvent(new CustomEvent('rhf-rerender'));
  }, 200);
});

function sheetTable(ctx, Y) {
  const { d } = ctx;
  const S0 = d.nwSheet(Y, nwQ);
  const curY = Number(d.refDate.slice(0, 4));
  const every = [...S0.sections.flatMap(x => [...x.rows.flatMap(r => r.values), ...x.total, ...x.gain]), ...S0.total, ...S0.gain];
  fitMax = every.reduce((m, v) => Math.max(m, Math.abs(v || 0)), 0);
  const lastI = vals => { for (let i = 12; i > 0; i--) if (vals[i] != null) return i; return -1; };
  const yearPct = vals => { const i = lastI(vals); return i < 0 || !vals[0] ? 0 : (vals[i] - vals[0]) / Math.abs(vals[0]) * 100; };
  fitPctMax = [...S0.sections.flatMap(x => [...x.pct, yearPct(x.total), ...x.rows.map(r => yearPct(r.values))]), ...S0.pct, yearPct(S0.total)]
    .reduce((m, v) => Math.max(m, Math.abs(v || 0)), 0);
  const fit = fitOf(fitMax, fitPctMax);
  fitKey = fitSig(fit);
  const dec = fit ? fit.dec : 2;
  const noEuro = fit && !fit.euro;
  const num = (v, sign) => (v == null ? '' : noEuro && !ui.privacy ? (sign && v > 0 ? '+' : '') + formatNumber(v / 100, dec, dec) : moneyText(v, ui.base, { sign, decimals: dec }));
  const t2 = v => num(v, false);
  const sg = v => num(v, true);
  const dates = [`${Y - 1}-12-31`, ...Array.from({ length: 12 }, (_, i) => monthEnd(`${Y}-${String(i + 1).padStart(2, '0')}`))];
  // differenza dal 31/12 dell'anno prima all'ultima fine mese con un valore
  const lastIdx = vals => { for (let i = 12; i > 0; i--) if (vals[i] != null) return i; return -1; };
  const diffOf = vals => { const i = lastIdx(vals); return i < 0 || vals[0] == null ? null : vals[i] - vals[0]; };
  const diffPct = vals => { const dv = diffOf(vals); return dv == null || !vals[0] ? null : dv / Math.abs(vals[0]) * 100; };
  const head = h('tr', h('th.sticky', noEuro ? 'Net Worth (€)' : 'Net Worth'),
    dates.map((dt, i) => h('th.num', { class: [i === 0 ? 'prev' : '', S0.cols[i] ? '' : 'future'].join(' ') }, fit && fit.short ? dmy(dt).slice(0, 6) + dt.slice(2, 4) : dmy(dt))),
    h('th.num.nw-dcol', { title: `Differenza dal 31/12/${Y - 1} all'ultima fine mese` }, fit && fit.per < 105 ? `Diff. ${String(Y - 1).slice(2)}→${String(Y).slice(2)}` : `Diff. ${Y - 1}→${Y}`), h('th.num.nw-dpct', '%'));
  const pcs = v => (v == null ? '' : formatPercent(v, fit ? fit.pdec : 2, true));
  const cells = (vals, fmt, cls) => vals.map((v, i) => h('td.num', { class: [cls ? cls(v) : '', i === 0 ? 'prev' : '', S0.cols[i] ? '' : 'future'].join(' ') }, fmt(v)));
  const diffs = vals => [h('td.num.nw-dcol', { class: tone(diffOf(vals)) }, sg(diffOf(vals))), h('td.num.nw-dpct', { class: tone(diffPct(vals)) }, pcs(diffPct(vals)))];
  const noDiff = () => [h('td.num.nw-dcol'), h('td.num.nw-dpct')];
  const band = (label, color) => h('tr.nw-band', { style: { '--sec': color } }, h('td.sticky', h('span', label)), dates.map(() => h('td')), noDiff());
  const body = [];
  for (const sec of S0.sections) {
    const col = colorVar(sec.color);
    body.push(band(sec.name, col));
    for (const r of sec.rows) {
      const go = r.hd ? () => ctx.go('investimenti/' + r.hd.id) : r.acc ? () => ctx.go('conti/' + r.acc.id) : null;
      body.push(h('tr.nw-item.click', { onclick: go, style: { '--sec': col } },
        h('td.sticky', h('span.nw-name', r.hd ? hdBadge(r.hd, true) : r.acc && bankLogo(r.acc.name, r.acc.institution) ? h('img.nw-logo', { src: bankLogo(r.acc.name, r.acc.institution), alt: '', width: 16, height: 16 }) : null, r.label), h('span.nw-sub', r.hd && r.label !== r.name ? r.name : r.sub)),
        cells(r.values, t2), diffs(r.values)));
    }
    body.push(h('tr.nw-total', { style: { '--sec': col } }, h('td.sticky', 'Total'), cells(sec.total, t2), diffs(sec.total)));
    body.push(h('tr.nw-gain', h('td.sticky', 'Gain/Loss'), cells(sec.gain, sg, tone), noDiff()));
    body.push(h('tr.nw-pct', h('td.sticky', '%'), cells(sec.pct, pcs, tone), noDiff()));
  }
  body.push(band('Net Worth', 'var(--brand)'));
  body.push(h('tr.nw-total.nw-grand', h('td.sticky', 'Total'), cells(S0.total, t2), diffs(S0.total)));
  body.push(h('tr.nw-gain', h('td.sticky', 'Gain/Loss'), cells(S0.gain, sg, tone), noDiff()));
  body.push(h('tr.nw-pct', h('td.sticky', '%'), cells(S0.pct, pcs, tone), noDiff()));
  body.push(band('Asset Allocation', 'var(--ink-3)'));
  for (const a of S0.alloc) {
    const dv = diffOf(a.pct);
    body.push(h('tr.nw-alloc', h('td.sticky', h('span.dl-key', { style: { background: colorVar(a.color) } }), a.name), cells(a.pct, v => (v == null ? '' : formatPercent(v, fit ? Math.min(fit.pdec, 2) : 2))),
      h('td.num.nw-dcol', { class: tone(dv) }, dv == null ? '' : `${dv > 0 ? '+' : ''}${formatPercent(dv, 1).replace('%', '')} pt`), h('td.num.nw-dpct')));
  }

  const exportCsv = () => {
    const rows = [['Net Worth', ...dates.map(dmy), `Diff. ${Y - 1}-${Y}`, '%']];
    const pct2 = v => v.toFixed(2).replace('.', ',');
    const line = (label, vals, f = csvNumber, withDiff = true) => rows.push([label, ...vals.map(v => (v == null ? '' : f(v))), withDiff && diffOf(vals) != null ? csvNumber(diffOf(vals)) : '', withDiff && diffPct(vals) != null ? pct2(diffPct(vals)) : '']);
    for (const sec of S0.sections) {
      rows.push([sec.name]);
      for (const r of sec.rows) line(r.label, r.values);
      line('Total', sec.total); line('Gain/Loss', sec.gain, csvNumber, false); line('%', sec.pct, pct2, false);
    }
    rows.push(['Net Worth']); line('Total', S0.total); line('Gain/Loss', S0.gain, csvNumber, false); line('%', S0.pct, pct2, false);
    rows.push(['Asset Allocation']);
    for (const a of S0.alloc) line(a.name, a.pct, pct2, false);
    download(new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' }), `net-worth-${Y}.csv`);
    toast('Tabella esportata', { kind: 'ok' });
  };
  const table = h('table.table.nw-table.nw-months.nw-sheet', { 'data-tid': fit ? 'nw-fit' : 'nw', class: fit ? 'fit' : '' }, h('thead', head), h('tbody', body));
  if (fit) { table.style.setProperty('--nw-first', fit.first + 'px'); table.style.fontSize = fit.font + 'px'; }
  const scroller = h('div.table-wrap.nw-scroll', table);
  // su telefono si apre sui mesi più recenti
  if (!fit && Y === curY) requestAnimationFrame(() => requestAnimationFrame(() => { const th = scroller.querySelectorAll('thead th')[Math.max(1, Number(d.refDate.slice(5, 7)) - 3)]; if (th) scroller.scrollLeft = th.offsetLeft - 220; }));
  return card(`Net Worth ${Y}`, {
    sub: 'Valori a fine mese, sezione per sezione, con guadagno o perdita sul mese prima e la differenza sull\'anno. Tocca una riga per i dettagli.',
    action: h('div.card-acts', h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: () => organizeSheet(ctx, S0) }, icon('edit', 16), 'Organizza'), h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: exportCsv }, icon('download', 16), 'CSV')),
  }, h('div.inv-filters', filterBox('nw', nwQ, v => { nwQ = v; ctx.rerender(); }, 'Filtra: conto, titolo o sezione')), scroller);
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

export default {
  render(ctx) {
    const { d } = ctx;
    const curY = Number(d.refDate.slice(0, 4));
    const M = d.nwMonthly(120);
    const hasData = M.sections.length > 0 && M.total[M.last] != null;
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

    const hero = h('section.card.nw-hero',
      h('div.nw-hero-main',
        h('div.hero-label', `Patrimonio a fine ${mLabel}`),
        h('div.hero-value', money(now)),
        h('div.nw-chips',
          prev != null ? h('div.nw-chip', h('span.hero-chip-l', 'Sul mese prima'), h('span', money(now - prev, d.base, { sign: true, tone: now >= prev ? 'pos' : 'neg' }), ' ', delta(pctOf(now, prev)))) : null,
          dec != null ? h('div.nw-chip', h('span.hero-chip-l', `Dal 31/12/${Number(lastDate.slice(0, 4)) - 1}`), h('span', money(now - dec, d.base, { sign: true, tone: now >= dec ? 'pos' : 'neg' }), ' ', delta(pctOf(now, dec)))) : null,
          peak.i >= 0 ? h('div.nw-chip', h('span.hero-chip-l', 'Il più alto'), h('span', money(peak.v), h('span.muted', ` · ${formatMonth(monthKey(M.cols[peak.i]), true)}`))) : null)),
      h('div.nw-hero-side',
        h('button.btn.btn-primary', { type: 'button', onclick: () => checkInEditor(ctx) }, icon('edit', 18), 'Aggiorna i valori'),
        h('p.field-hint', 'Il patrimonio è quello del tuo Net Worth a fine mese. Gli Investimenti restano a sé.')));

    // una scheda per sezione: valore a fine mese, variazione sul mese prima, quota
    const pos = M.sections.reduce((a, x) => a + Math.max(0, x.total[L] || 0), 0);
    const cards = h('div.fin-cards', M.sections.map(sec => {
      const v = sec.total[L], g = sec.gain[L], p = sec.pct[L];
      const col = colorVar(sec.color);
      return h('div.fin-card.static', { style: { '--chip': col } },
        h('span.fin-card-top', h('span.fin-card-name', sec.name), h('span.fin-card-pct', formatPercent(pos && v ? v / pos * 100 : 0, 1))),
        h('span.fin-card-val', v == null ? '—' : money(v)),
        h('span.fin-card-sub', g == null ? 'sul mese prima: —' : h('span', 'sul mese prima ', h('b', { class: g >= 0 ? 'pos' : 'neg' }, moneyText(g, ui.base, { sign: true })), ' ', p == null ? '' : delta(p))),
        sparkline(sec.total.slice(Math.max(0, L - 11), L + 1).map(x => x ?? 0), { color: col, width: 150, height: 30 }));
    }));

    // andamento a fine mese per sezione + patrimonio
    const n = span === 'all' ? M.cols.length : Math.min(span, M.cols.length);
    const from = Math.max(0, L + 1 - n);
    const idx = Array.from({ length: L + 1 - from }, (_, k) => from + k);
    const chart = card('Andamento', { sub: 'A fine mese: le sezioni (barre) e il patrimonio (linea)', action: segTabs([{ value: 12, label: '12M' }, { value: 24, label: '24M' }, { value: 'all', label: 'Tutto' }], span, v => { span = v; ctx.rerender(); }) },
      barChart({
        labels: idx.map(i => formatMonth(monthKey(M.cols[i]), true)), tipLabels: idx.map(i => `Fine ${formatMonth(monthKey(M.cols[i]))}`),
        series: M.sections.map(sec => ({ name: sec.name, color: colorVar(sec.color), values: idx.map(i => sec.total[i] || 0) })),
        stacked: true, line: { name: 'Patrimonio', color: 'var(--ink)', values: idx.map(i => M.total[i] || 0) },
        fmt: tipMoney, fmtAxis: axisMoney, height: 260, mask: ui.privacy,
        onPick: k => { const y = Number(M.cols[idx[k]].slice(0, 4)); if (years.includes(y)) { year = y; ctx.rerender(); } },
      }),
      legend([...M.sections.map(sec => ({ label: sec.name, color: colorVar(sec.color) })), { label: 'Patrimonio', color: 'var(--ink)', line: true }]));

    const yearTabs = segTabs(years.map(y => ({ value: y, label: String(y) })), year, v => { year = v; ctx.rerender(); });
    return {
      title: 'Patrimonio', sub: 'Il tuo Net Worth, fine mese per fine mese', actions,
      node: h('div.stack', hero, cards, chart,
        h('div.nw-year-bar', h('h2.section-title', 'Net Worth'), yearTabs),
        sheetTable(ctx, year),
        yearsCard(ctx, years),
        h('p.fine', icon('info', 14), ' Il patrimonio è il tuo Net Worth: i valori effettivi di fine mese di conti, titoli, TFR netto… come nel foglio. I titoli valgono quanto scritto nel Net Worth (dal file o da "Aggiorna i valori"), non i prezzi degli Investimenti, che restano a sé. Le entrate e le uscite non si sommano: contano i valori di fine mese.')),
    };
  },
};
