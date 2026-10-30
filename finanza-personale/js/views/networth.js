/* Patrimonio: l'andamento di ogni cosa che possiedi (e dei debiti) mese dopo mese,
   e il confronto tra la fine di un anno e la fine dell'anno prima. */

import { h, icon, download } from '../ui/dom.js';
import { barChart, legend } from '../ui/charts.js';
import { openSheet, amountInput, dateInput, segmented, toast, empty, field, selectInput } from '../ui/components.js';
import { money, moneyText, delta, axisMoney, tipMoney, ui } from '../ui/fmt.js';
import { card, avatar, segTabs } from './common.js';
import { accountEditor } from './editors.js';
import { openFileImport } from './invimport.js';
import { saveCheckIn, setSetting } from '../actions.js';
import { ACCOUNT_TYPES, GROUPS, isLiability, hasHoldings, hasPlan } from '../core/model.js';
import { monthKey, monthEnd, addMonthKey, lastMonths, formatMonth, formatDate, monthName, diffMonths, today, isISODate } from '../core/dates.js';
import { formatPercent } from '../core/money.js';
import { toCSV, csvNumber } from '../core/csv.js';

let year = null;
let span = 24;

const GROUP_ORDER = Object.entries(GROUPS).sort((a, b) => a[1].order - b[1].order).map(([k]) => k);
const GROUP_COLOR = { liquidity: 'var(--c3)', investments: 'var(--c1)', assets: 'var(--c4)', debt: 'var(--c8)' };
const t0 = v => (v == null ? '—' : moneyText(v, ui.base, { decimals: 0 }));      // cifre intere nelle tabelle
const pctOf = (a, b) => (a != null && b ? (a - b) / Math.abs(b) * 100 : null);

/** Conti del patrimonio raggruppati, solo quelli che hanno almeno un valore nelle colonne. */
function groupedAccounts(d, cols) {
  return GROUP_ORDER.map(g => ({
    g,
    accounts: d.nwAccounts.filter(a => ACCOUNT_TYPES[a.type].group === g && cols.some(c => c && c.byAcc.get(a.id) != null))
      .sort((a, b) => a.order - b.order || a.created - b.created),
  })).filter(x => x.accounts.length);
}

/* ─── Aggiorna i valori (tanti conti insieme, a una data) ─── */
export function checkInEditor(ctx, presetDate) {
  const { d } = ctx;
  const prevEnd = monthEnd(addMonthKey(monthKey(d.refDate), -1));
  let date = presetDate || today();
  const list = h('div.checkin-list');
  const inputs = new Map();
  const dateIn = dateInput(date);
  const isMonthEnd = iso => iso === monthEnd(monthKey(iso)) && iso < d.refDate;
  const draw = () => {
    inputs.clear();
    const accs = d.nwAccounts.filter(a => !a.archived);
    list.replaceChildren(...GROUP_ORDER.map(g => {
      const items = accs.filter(a => ACCOUNT_TYPES[a.type].group === g);
      if (!items.length) return null;
      return h('div.checkin-group', h('div.cat-group-t', GROUPS[g].label), items.map(a => {
        const cur = d.valueAt(a, date);
        const liab = isLiability(a);
        let ctl, hint;
        if (hasPlan(a)) { ctl = h('span.muted.small', 'segue il piano'); hint = 'Il debito residuo si calcola dal piano d\'ammortamento'; }
        else if (hasHoldings(a) && (d.holdingsByAcc.get(a.id) || []).length && !isMonthEnd(date)) { ctl = h('a.small.link', { href: '#/investimenti' }, 'prezzi in Investimenti'); hint = 'I titoli si valutano con i prezzi: per un valore a mano scegli una fine mese passata'; }
        else {
          const inp = amountInput({ currency: a.currency, placeholder: cur == null ? 'valore' : (Math.abs(cur) / 100).toLocaleString('it-IT', { maximumFractionDigits: 0 }) });
          inputs.set(a.id, { a, inp, liab });
          ctl = inp;
        }
        return h('div.checkin-row',
          avatar(a.emoji || ACCOUNT_TYPES[a.type].emoji),
          h('div.checkin-main', h('span.row-title', a.name), h('span.row-sub', hint || (cur == null ? 'non esisteva ancora a questa data' : `ora: ${moneyText(cur, a.currency)}`))),
          h('div.checkin-ctl', ctl));
      }));
    }).filter(Boolean));
  };
  const quick = segmented([{ value: 'today', label: 'Oggi' }, { value: 'prev', label: `Fine ${monthName(Number(prevEnd.slice(5, 7)))}` }, { value: 'custom', label: 'Altra data' }],
    date === prevEnd ? 'prev' : date === today() ? 'today' : 'custom', v => {
      if (v === 'today') date = today(); else if (v === 'prev') date = prevEnd;
      dateIn.value = date; dateWrap.hidden = v !== 'custom'; draw();
    }, { small: true });
  const dateWrap = field('Data', dateIn);
  dateWrap.hidden = !(date !== today() && date !== prevEnd);
  dateIn.addEventListener('change', () => { if (isISODate(dateIn.value)) { date = dateIn.value; draw(); } });
  draw();
  const save = () => {
    const entries = [];
    for (const { a, inp, liab } of inputs.values()) {
      const c = inp.getCents();
      if (c == null || inp.input.value.trim() === '') continue;
      const val = liab ? -Math.abs(c) : c;
      if (hasHoldings(a) && (d.holdingsByAcc.get(a.id) || []).length) {
        // conto con titoli a fine mese passata: si salva il valore dei titoli (totale meno liquidità)
        const cash = d.accountValue(a, date) - d.holdingsValue(a, date);
        entries.push({ account: a.id, snapshot: val - cash, month: monthKey(date) });
      } else entries.push({ account: a.id, value: val });
    }
    if (!entries.length) { toast('Scrivi almeno un valore'); return; }
    saveCheckIn(date, entries);
    toast(`${entries.length} ${entries.length === 1 ? 'valore aggiornato' : 'valori aggiornati'} al ${formatDate(date, { year: true })}`, { kind: 'ok' });
    s.close(true);
  };
  const s = openSheet({
    title: 'Aggiorna i valori', subtitle: 'Scrivi il valore reale solo di ciò che è cambiato', size: 'md',
    body: h('div.stack', quick, dateWrap,
      h('p.field-hint', 'Casa, auto, fondo pensione, conti che non segui movimento per movimento: un valore al mese basta per vedere l\'andamento. I movimenti dopo questa data si sommano al nuovo valore. I debiti si scrivono come numero positivo.'),
      list),
    footer: [h('button.btn.btn-primary', { type: 'button', onclick: save }, 'Salva i valori')],
  });
}

/* ─── Confronto tra due fine anno ─── */
function yearCompare(ctx, Y) {
  const { d, st } = ctx;
  const startDate = `${Y - 1}-12-31`, endDate = d.yearClose(Y);
  const a = d.netWorthAt(startDate), b = d.netWorthAt(endDate);
  const diff = b.total - a.total;
  const nwIds = new Set(d.nwAccounts.map(x => x.id));
  let savings = 0;
  for (const t of st.transactions) {
    if (t.kind === 'transfer' || t.date <= startDate || t.date > endDate || !nwIds.has(t.account)) continue;
    savings += (t.kind === 'income' ? 1 : -1) * d.txBase(t);
  }
  // conti comparsi durante l'anno: il loro valore iniziale non è né risparmio né guadagno
  let added = 0;
  for (const acc of d.nwAccounts) {
    const s = d.startByAcc.get(acc.id);
    if (s && s > startDate && s <= endDate && a.byAcc.get(acc.id) == null) {
      const v0 = d.valueAt(acc, s);
      if (v0 != null) added += d.toBase(v0, acc.currency);
    }
  }
  const other = diff - savings - added;
  const groups = groupedAccounts(d, [a, b]);
  const isCur = endDate === d.refDate;
  return card(isCur ? `Quest'anno, dal 31 dicembre ${Y - 1} a oggi` : `Il ${Y}: dal 31 dicembre ${Y - 1} al 31 dicembre ${Y}`, { cls: 'nw-compare' },
    h('div.nw-diff',
      h('div', h('div.hero-label', 'Differenza'), h('div.nw-diff-value', money(diff, d.base, { sign: true, tone: diff >= 0 ? 'pos' : 'neg' })), a.total ? h('div', delta(pctOf(b.total, a.total)), h('span.muted', ` · da ${t0(a.total)} a ${t0(b.total)}`)) : null),
      h('div.breakdown.nw-why',
        h('div.bd-row', h('span', 'Risparmiato', h('span.bd-hint', 'entrate meno uscite')), money(savings, d.base, { sign: true, tone: savings >= 0 ? 'pos' : 'neg' })),
        added ? h('div.bd-row', h('span', 'Conti aggiunti', h('span.bd-hint', 'il loro valore iniziale')), money(added, d.base, { sign: true })) : null,
        h('div.bd-row', h('span', 'Variazioni di valore', h('span.bd-hint', 'mercati, casa e auto, quota capitale dei debiti, saldi corretti')), money(other, d.base, { sign: true, tone: other >= 0 ? 'pos' : 'neg' })),
        h('div.bd-row.strong', h('span', 'Totale'), money(diff, d.base, { sign: true, tone: diff >= 0 ? 'pos' : 'neg' })))),
    h('div.table-wrap', h('table.table.nw-table',
      h('thead', h('tr', h('th', ''), h('th.num', `31 dic ${Y - 1}`), h('th.num', isCur ? 'Oggi' : `31 dic ${Y}`), h('th.num', 'Differenza'), h('th.num', '%'))),
      h('tbody', groups.flatMap(({ g, accounts }) => {
        const ga = a.groups[g], gb = b.groups[g];
        return [
          h('tr.grp', h('td', h('span.dl-key', { style: { background: GROUP_COLOR[g] } }), GROUPS[g].label), h('td.num', t0(ga)), h('td.num', t0(gb)), h('td.num', { class: gb - ga >= 0 ? 'pos' : 'neg' }, t0(gb - ga)), h('td.num', ga ? formatPercent(pctOf(gb, ga), 1, true) : '—')),
          ...accounts.map(acc => {
            const va = a.byAcc.get(acc.id), vb = b.byAcc.get(acc.id);
            const dd = (vb ?? 0) - (va ?? 0);
            return h('tr.click', { onclick: () => ctx.go('conti/' + acc.id) }, h('td.acc', acc.name, acc.archived ? h('span.pill', 'chiuso') : null), h('td.num', t0(va)), h('td.num', t0(vb)), h('td.num', { class: dd > 0 ? 'pos' : dd < 0 ? 'neg' : '' }, va == null && vb == null ? '—' : t0(dd)), h('td.num', va ? formatPercent(pctOf(vb ?? 0, va), 1, true) : va == null && vb != null ? 'nuovo' : '—'));
          }),
        ];
      })),
      h('tfoot', h('tr', h('td', 'Patrimonio netto'), h('td.num', t0(a.total)), h('td.num', t0(b.total)), h('td.num', { class: diff >= 0 ? 'pos' : 'neg' }, t0(diff)), h('td.num', a.total ? formatPercent(pctOf(b.total, a.total), 1, true) : '—'))))));
}

/* ─── Tabella mese per mese dell'anno ─── */
/* ─── Net Worth come il foglio di D: sezioni con le loro righe, Total, Gain/Loss e %;
   in fondo il patrimonio netto e l'Asset Allocation ─── */
const dmy = iso => `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const t2 = v => (v == null ? '' : moneyText(v, ui.base));
const sg = v => (v == null ? '' : moneyText(v, ui.base, { sign: true }));
const pc = v => (v == null ? '' : formatPercent(v, 2, true));
const tone = v => (v == null || !Math.round(v * 100) ? '' : v > 0 ? 'pos' : 'neg');

function sheetTable(ctx, Y) {
  const { d } = ctx;
  const S0 = d.nwSheet(Y);
  const curY = Number(d.refDate.slice(0, 4));
  const dates = [`${Y - 1}-12-31`, ...Array.from({ length: 12 }, (_, i) => monthEnd(`${Y}-${String(i + 1).padStart(2, '0')}`))];
  const isToday = i => S0.cols[i] && S0.cols[i] === d.refDate && dates[i] !== d.refDate;
  const head = h('tr', h('th.sticky', 'Net Worth'), dates.map((dt, i) => h('th.num', { class: [i === 0 ? 'prev' : '', S0.cols[i] ? '' : 'future'].join(' ') }, isToday(i) ? `${dmy(d.refDate)} (oggi)` : dmy(dt))));
  const cells = (vals, fmt, cls) => vals.map((v, i) => h('td.num', { class: [cls ? cls(v) : '', i === 0 ? 'prev' : '', S0.cols[i] ? '' : 'future'].join(' ') }, fmt(v)));
  const band = (label, color, extra) => h('tr.nw-band', { style: { '--sec': color } }, h('td.sticky', h('span', label), extra || null), dates.map(() => h('td')));
  const body = [];
  for (const sec of S0.sections) {
    const col = `var(--c${sec.color})`;
    body.push(band(sec.name, col));
    for (const r of sec.rows) {
      const go = r.hd ? () => ctx.go('investimenti/' + r.hd.id) : r.acc ? () => ctx.go('conti/' + r.acc.id) : null;
      body.push(h('tr.nw-item.click', { onclick: go, style: { '--sec': col } },
        h('td.sticky', h('span.nw-name', r.label), r.label !== r.name || r.hd ? h('span.nw-sub', r.hd ? r.name : r.sub) : h('span.nw-sub', r.sub)),
        cells(r.values, t2)));
    }
    body.push(h('tr.nw-total', { style: { '--sec': col } }, h('td.sticky', 'Total'), cells(sec.total, t2)));
    body.push(h('tr.nw-gain', h('td.sticky', 'Gain/Loss'), cells(sec.gain, sg, tone)));
    body.push(h('tr.nw-pct', h('td.sticky', '%'), cells(sec.pct, pc, tone)));
  }
  body.push(band('Net Worth', 'var(--brand)'));
  body.push(h('tr.nw-total.nw-grand', h('td.sticky', 'Total'), cells(S0.total, t2)));
  body.push(h('tr.nw-gain', h('td.sticky', 'Gain/Loss'), cells(S0.gain, sg, tone)));
  body.push(h('tr.nw-pct', h('td.sticky', '%'), cells(S0.pct, pc, tone)));
  body.push(band('Asset Allocation', 'var(--ink-3)'));
  for (const a of S0.alloc) body.push(h('tr.nw-alloc', h('td.sticky', h('span.dl-key', { style: { background: `var(--c${a.color})` } }), a.name), cells(a.pct, v => (v == null ? '' : formatPercent(v, 2)))));

  const exportCsv = () => {
    const rows = [['Net Worth', ...dates.map(dmy)]];
    const line = (label, vals, f = csvNumber) => rows.push([label, ...vals.map(v => (v == null ? '' : f(v)))]);
    for (const sec of S0.sections) {
      rows.push([sec.name]);
      for (const r of sec.rows) line(r.label, r.values);
      line('Total', sec.total); line('Gain/Loss', sec.gain); line('%', sec.pct, v => v.toFixed(2).replace('.', ','));
    }
    rows.push(['Net Worth']); line('Total', S0.total); line('Gain/Loss', S0.gain); line('%', S0.pct, v => v.toFixed(2).replace('.', ','));
    rows.push(['Asset Allocation']);
    for (const a of S0.alloc) line(a.name, a.pct, v => v.toFixed(2).replace('.', ','));
    download(new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' }), `net-worth-${Y}.csv`);
    toast('Tabella esportata', { kind: 'ok' });
  };
  const scroller = h('div.table-wrap.nw-scroll', h('table.table.nw-table.nw-months.nw-sheet', h('thead', head), h('tbody', body)));
  // si apre sui mesi più recenti
  if (Y === curY) requestAnimationFrame(() => requestAnimationFrame(() => { const th = scroller.querySelectorAll('thead th')[Math.max(1, Number(d.refDate.slice(5, 7)) - 3)]; if (th) scroller.scrollLeft = th.offsetLeft - 220; }));
  return card(`Net Worth ${Y}`, {
    sub: 'Valori a fine mese, sezione per sezione, con guadagno o perdita sul mese prima. Tocca una riga per i dettagli.',
    action: h('div.card-acts', h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: () => organizeSheet(ctx, S0) }, icon('edit', 16), 'Organizza'), h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: exportCsv }, icon('download', 16), 'CSV')),
  }, scroller);
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
            h('div.swatches.sm', Array.from({ length: 8 }, (_, i) => h('button.swatch', { type: 'button', 'aria-label': `Colore ${i + 1}`, 'aria-pressed': String(sec.color === i + 1), style: { background: `var(--c${i + 1})` }, onclick: () => { sec.color = i + 1; draw(); } }))),
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

/* ─── Anno per anno ─── */
function yearsCard(ctx, years) {
  const { d, st } = ctx;
  const nwIds = new Set(d.nwAccounts.map(x => x.id));
  const rows = years.slice().sort().map(Y => {
    const end = d.netWorthAt(d.yearClose(Y)).total;
    const sx = d.netWorthAt(`${Y - 1}-12-31`);
    const start = sx.total;
    const first = [...sx.byAcc.values()].every(v => v == null);
    let sav = 0;
    for (const t of st.transactions) if (t.kind !== 'transfer' && t.date.startsWith(String(Y)) && t.date <= d.refDate && nwIds.has(t.account)) sav += (t.kind === 'income' ? 1 : -1) * d.txBase(t);
    return { Y, end, start, diff: end - start, sav, first };
  }).reverse();
  return card('Anno per anno', { sub: 'Patrimonio a fine anno e differenza con l\'anno prima' },
    h('div.table-wrap', h('table.table',
      h('thead', h('tr', h('th', 'Anno'), h('th.num', 'Fine anno'), h('th.num', 'Differenza'), h('th.num', '%'), h('th.num', 'Di cui risparmiato'))),
      h('tbody', rows.map(r => h('tr.click', { onclick: () => { year = r.Y; ctx.rerender(); } },
        h('td', r.Y === Number(d.refDate.slice(0, 4)) ? `${r.Y} (a oggi)` : String(r.Y)),
        h('td.num', t0(r.end)),
        h('td.num', { class: r.first ? 'muted' : r.diff >= 0 ? 'pos' : 'neg' }, r.first ? 'primo anno' : moneyText(r.diff, ui.base, { decimals: 0, sign: true })),
        h('td.num', !r.first && r.start ? formatPercent(pctOf(r.end, r.start), 1, true) : '—'),
        h('td.num', moneyText(r.sav, ui.base, { decimals: 0, sign: true }))))))));
}

export default {
  render(ctx) {
    const { d } = ctx;
    const curY = Number(d.refDate.slice(0, 4));
    if (!d.nwAccounts.length) {
      return { title: 'Patrimonio', node: h('section.card', empty({ icon: 'layers', title: 'Ancora niente da seguire', text: 'Aggiungi i conti, gli investimenti, la casa, l\'auto e i debiti: qui vedrai l\'andamento di ognuno mese dopo mese e il confronto tra un anno e l\'altro.', action: h('div.row-btns', h('button.btn.btn-primary', { type: 'button', onclick: () => accountEditor(ctx) }, icon('plus', 18), 'Aggiungi un conto'), h('button.btn.btn-soft', { type: 'button', onclick: () => openFileImport(ctx) }, icon('upload', 18), 'Importa da Excel')) })) };
    }
    const firstY = Math.min(curY, Number(d.firstDate.slice(0, 4)));
    const years = [];
    for (let y = curY; y >= firstY; y--) years.push(y);
    if (!year || !years.includes(year)) year = curY;

    // grafico: composizione a fine mese
    const totalMonths = Math.min(120, diffMonths(d.firstDate.slice(0, 7) + '-01', d.refDate) + 1);
    const n = span === 'all' ? Math.max(2, totalMonths) : span;
    const months = lastMonths(n, monthKey(d.refDate));
    const pts = months.map(m => d.netWorthAt(d.monthClose(m)));
    const prevYearEnd = d.netWorthAt(`${curY - 1}-12-31`).total;
    const ago12 = d.netWorthAt(d.monthClose(addMonthKey(monthKey(d.refDate), -12))).total;
    let peak = { v: -Infinity, m: '' };
    pts.forEach((p, i) => { if (p.total > peak.v) peak = { v: p.total, m: months[i] }; });
    const ytd = d.netWorth - prevYearEnd;

    const hero = h('section.card.nw-hero',
      h('div.nw-hero-main',
        h('div.hero-label', 'Patrimonio netto oggi'),
        h('div.hero-value', money(d.netWorth)),
        h('div.nw-chips',
          h('div.nw-chip', h('span.hero-chip-l', `Dal 31 dic ${curY - 1}`), h('span', money(ytd, d.base, { sign: true, tone: ytd >= 0 ? 'pos' : 'neg' }), ' ', prevYearEnd ? delta(pctOf(d.netWorth, prevYearEnd)) : null)),
          h('div.nw-chip', h('span.hero-chip-l', 'In 12 mesi'), h('span', money(d.netWorth - ago12, d.base, { sign: true, tone: d.netWorth >= ago12 ? 'pos' : 'neg' }), ' ', ago12 ? delta(pctOf(d.netWorth, ago12)) : null)),
          peak.m ? h('div.nw-chip', h('span.hero-chip-l', 'Il più alto'), h('span', money(peak.v), h('span.muted', ` · ${formatMonth(peak.m, true)}`))) : null)),
      h('div.nw-hero-side',
        h('button.btn.btn-primary', { type: 'button', onclick: () => checkInEditor(ctx) }, icon('edit', 18), 'Aggiorna i valori'),
        h('p.field-hint', 'Per casa, auto, fondo pensione e conti che non segui movimento per movimento')));

    const chart = card('Andamento', { sub: 'A fine mese: cosa possiedi (barre) e patrimonio netto (linea)', action: segTabs([{ value: 12, label: '12M' }, { value: 24, label: '24M' }, { value: 'all', label: 'Tutto' }], span, v => { span = v; ctx.rerender(); }) },
      barChart({
        labels: months.map(m => formatMonth(m, true)), tipLabels: months.map(m => formatMonth(m)),
        series: GROUP_ORDER.map(g => ({ name: GROUPS[g].label, color: GROUP_COLOR[g], values: pts.map(p => p.groups[g]) })),
        stacked: true, line: { name: 'Patrimonio netto', color: 'var(--ink)', values: pts.map(p => p.total) },
        fmt: tipMoney, fmtAxis: axisMoney, height: 260, mask: ui.privacy, highlight: months.length - 1,
        onPick: i => { const y = Number(months[i].slice(0, 4)); if (years.includes(y)) { year = y; ctx.rerender(); } },
      }),
      legend([...GROUP_ORDER.map(g => ({ label: GROUPS[g].label, color: GROUP_COLOR[g] })), { label: 'Patrimonio netto', color: 'var(--ink)', line: true }]));

    const yearTabs = segTabs(years.map(y => ({ value: y, label: String(y) })), year, v => { year = v; ctx.rerender(); });
    const node = h('div.stack', hero, chart,
      h('div.nw-year-bar', h('h2.section-title', 'Anno'), yearTabs),
      sheetTable(ctx, year), yearCompare(ctx, year),
      years.length > 1 ? yearsCard(ctx, years) : null,
      h('p.fine', icon('info', 14), ' Ogni conto conta dal suo saldo iniziale (o dal primo movimento): per avere lo storico degli anni passati, metti la data giusta in "Modifica conto" o usa "Aggiorna i valori" con una data passata. I titoli nei mesi passati valgono la quantità di allora al prezzo di oggi, tranne i mesi in cui l\'app ha salvato il loro valore. Valute estere al cambio attuale.'));
    return {
      title: 'Patrimonio', sub: 'Tutto ciò che hai, mese dopo mese',
      actions: [h('button.btn.btn-soft', { type: 'button', onclick: () => openFileImport(ctx) }, icon('upload', 18), h('span', 'Importa da Excel'))],
      node,
    };
  },
};
