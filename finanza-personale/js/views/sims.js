/* Simulazioni: PAC, conto deposito, conto corrente, mutuo, indipendenza finanziaria,
   inflazione, BTP, costo reale delle spese fisse. I dati inseriti restano salvati. */

import { h, icon, debounce } from '../ui/dom.js';
import { lineChart, barChart, legend } from '../ui/charts.js';
import { field, numberInput, selectInput, toggle, ring } from '../ui/components.js';
import { money, moneyText, axisMoney } from '../ui/fmt.js';
import { card } from './common.js';
import { saveSim } from '../actions.js';
import { simPAC, simInterest, simLoan, simFIRE, simInflation, simTrueCost, simBond, TAX_STANDARD, TAX_GOV } from '../core/finance.js';
import { formatPercent, formatNumber } from '../core/money.js';
import { monthKey, monthStart, monthEnd, addMonthKey } from '../core/dates.js';

const eur = v => moneyText(Math.round(v * 100));
const eurEl = (v, opts) => money(Math.round(v * 100), undefined, opts);
const tipEur = v => eur(v);
const axisEur = v => axisMoney(Math.round(v * 100));
const pct = (v, d = 2) => (v == null ? '—' : formatPercent(v, d));

/* ─── Definizione dei simulatori ─── */
const SIMS = {
  pac: {
    title: 'PAC e interesse composto', emoji: '📈', desc: 'Quanto può diventare un investimento con versamenti periodici, al netto di tasse, costi e inflazione.',
    fields: [
      { k: 'initial', label: 'Capitale iniziale', t: 'eur', def: 5000 },
      { k: 'contribution', label: 'Versamento', t: 'eur', def: 300 },
      { k: 'freq', label: 'Ogni', t: 'sel', def: 12, opts: [[52, 'settimana'], [12, 'mese'], [4, 'trimestre'], [2, 'semestre'], [1, 'anno']] },
      { k: 'years', label: 'Durata', t: 'num', def: 20, suf: 'anni' },
      { k: 'annualReturn', label: 'Rendimento medio annuo lordo', t: 'pct', def: 6, hint: 'Azionario globale storico ~6-7% (non garantito)' },
      { k: 'ter', label: 'Costi del fondo (TER)', t: 'pct', def: 0.2 },
      { k: 'inflation', label: 'Inflazione', t: 'pct', def: 2 },
      { k: 'contribGrowth', label: 'Aumento annuo del versamento', t: 'pct', def: 0 },
      { k: 'taxRate', label: 'Tassa sul guadagno', t: 'sel', def: 26, opts: [[26, '26% (ETF, azioni)'], [12.5, '12,5% (titoli di Stato)'], [20, '20% (misto)'], [0, 'Nessuna']] },
      { k: 'bollo', label: 'Imposta di bollo 0,20%', t: 'bool', def: true },
      { k: 'spread', label: 'Scenari ±', t: 'pct', def: 2, hint: 'Mostra la fascia tra rendimento più basso e più alto' },
    ],
    mine: ctx => ({ initial: Math.round(ctx.d.portfolio().value / 100) || undefined }),
    run: p => simPAC(p),
    view: (r, p) => {
      const t = r.totals;
      return [
        kpis([
          ['Capitale finale netto', eurEl(t.net), `in ${p.years} anni, se vendi tutto`],
          ['Hai versato', eurEl(t.invested), null],
          ['Guadagno netto', eurEl(t.netGain, { sign: true, tone: t.netGain >= 0 ? 'pos' : 'neg' }), `×${formatNumber(t.multiple, 2, 2)} i soldi versati`],
          ['Rendimento netto annuo', pct(t.netIrr), 'tenendo conto di quando versi'],
        ]),
        card('Crescita', { sub: `Scenari dal ${pct(p.annualReturn - (p.spread ?? 2), 0)} al ${pct(p.annualReturn + (p.spread ?? 2), 0)}: da ${eur(t.lowNet)} a ${eur(t.highNet)}` },
          lineChart({ labels: r.rows.map(x => 'Anno ' + x.year), series: [{ name: 'Valore', color: 'var(--c1)', values: r.rows.map(x => x.value), area: true }, { name: 'Versato', color: 'var(--ink-3)', values: r.rows.map(x => x.invested), dashed: true }], band: { low: r.low.map(x => x.value), high: r.high.map(x => x.value), color: 'var(--c1)' }, fmt: tipEur, fmtAxis: axisEur, height: 260 }),
          legend([{ label: 'Valore lordo', color: 'var(--c1)' }, { label: 'Soldi versati', color: 'var(--ink-3)', dashed: true }, { label: 'Fascia degli scenari', color: 'var(--c1-soft)' }])),
        card('Dove vanno i soldi', {},
          breakdown([
            ['Valore lordo a fine periodo', t.value],
            ['Tasse sul guadagno alla vendita', -t.tax],
            ['Imposta di bollo pagata', -t.bollo],
            ['Netto in tasca', t.net, true],
          ]),
          h('p.card-foot', `Costi del fondo pagati nel tempo (già tolti dal valore): ${eur(t.ter)}. Con l'inflazione al ${pct(p.inflation, 1)}, il netto vale come ${eur(t.real)} di oggi; i soldi versati lasciati fermi varrebbero ${eur(t.cashReal)}.`)),
        yearTable(['Anno', 'Versato', 'Valore', 'Guadagno', 'Netto se vendi', 'Netto reale'], r.rows.slice(1).map(x => [x.year, eur(x.invested), eur(x.value), eur(x.gain), eur(x.net), eur(x.real)])),
      ];
    },
  },
  deposito: {
    title: 'Conto deposito', emoji: '🐷', desc: 'Interessi netti, imposta di bollo e rendimento effettivo di un conto deposito, vincolato o libero.',
    fields: [
      { k: 'capital', label: 'Capitale', t: 'eur', def: 10000 },
      { k: 'rate', label: 'Tasso annuo lordo', t: 'pct', def: 3 },
      { k: 'months', label: 'Durata', t: 'num', def: 12, suf: 'mesi' },
      { k: 'period', label: 'Interessi pagati', t: 'sel', def: 3, opts: [[1, 'ogni mese'], [3, 'ogni trimestre'], [6, 'ogni semestre'], [12, 'ogni anno'], [0, 'a scadenza']] },
      { k: 'compound', label: 'Gli interessi restano sul deposito (si sommano)', t: 'bool', def: true },
      { k: 'bollo', label: 'Imposta di bollo', t: 'sel', def: 'percent', opts: [['percent', '0,20% annuo'], ['fixed', '34,20 € se giacenza > 5.000 €'], ['none', 'Pagata dalla banca']] },
      { k: 'monthlyDeposit', label: 'Versamento mensile aggiuntivo', t: 'eur', def: 0 },
    ],
    mine: ctx => ({ capital: Math.round(ctx.d.groupTotals.liquidity / 100) || undefined }),
    run: p => simInterest({ ...p, taxRate: TAX_STANDARD }),
    view: (r, p) => interestView(r, p),
  },
  conto: {
    title: 'Conto corrente remunerato', emoji: '🏦', desc: 'Quanto rende davvero la liquidità sul conto, con canone e bollo da 34,20 €.',
    fields: [
      { k: 'capital', label: 'Giacenza', t: 'eur', def: 8000 },
      { k: 'rate', label: 'Tasso annuo lordo', t: 'pct', def: 2 },
      { k: 'months', label: 'Durata', t: 'num', def: 24, suf: 'mesi' },
      { k: 'period', label: 'Interessi pagati', t: 'sel', def: 12, opts: [[1, 'ogni mese'], [3, 'ogni trimestre'], [12, 'ogni anno']] },
      { k: 'monthlyFee', label: 'Canone mensile', t: 'eur', def: 0 },
      { k: 'bollo', label: 'Imposta di bollo', t: 'sel', def: 'fixed', opts: [['fixed', '34,20 € se giacenza > 5.000 €'], ['none', 'Pagata dalla banca']] },
    ],
    mine: ctx => {
      const cc = ctx.st.accounts.filter(a => a.type === 'checking' && !a.archived).reduce((s, a) => s + ctx.d.toBase(ctx.d.balances.get(a.id) || 0, a.currency), 0);
      return { capital: Math.round(cc / 100) || undefined };
    },
    run: p => simInterest({ ...p, compound: true, taxRate: TAX_STANDARD }),
    view: (r, p) => interestView(r, p),
  },
  mutuo: {
    title: 'Mutuo e prestiti', emoji: '🏠', desc: 'Rata, interessi, TAEG e piano d\'ammortamento. Con l\'estinzione anticipata: meno anni o rata più bassa.',
    fields: [
      { k: 'principal', label: 'Importo', t: 'eur', def: 150000 },
      { k: 'tan', label: 'TAN', t: 'pct', def: 3.2 },
      { k: 'years', label: 'Durata', t: 'num', def: 25, suf: 'anni' },
      { k: 'type', label: 'Tipo di rata', t: 'sel', def: 'francese', opts: [['francese', 'Rata costante (francese)'], ['italiano', 'Quota capitale costante (italiana)']] },
      { k: 'upfront', label: 'Spese iniziali (istruttoria, perizia…)', t: 'eur', def: 1500 },
      { k: 'monthlyExtra', label: 'Spese mensili (incasso rata, assicurazione)', t: 'eur', def: 3 },
      { k: 'ppYear', label: 'Estinzione parziale dopo', t: 'num', def: 0, suf: 'anni', hint: '0 = nessuna' },
      { k: 'ppAmount', label: 'Importo dell\'estinzione', t: 'eur', def: 0 },
      { k: 'ppMode', label: 'Dopo l\'estinzione', t: 'sel', def: 'durata', opts: [['durata', 'stessa rata, meno anni'], ['rata', 'stessi anni, rata più bassa']] },
    ],
    run: p => {
      const base = { principal: p.principal, tan: p.tan, months: Math.round((p.years || 1) * 12), type: p.type, upfront: p.upfront, monthlyExtra: p.monthlyExtra };
      const pp = p.ppYear > 0 && p.ppAmount > 0 ? [{ month: Math.round(p.ppYear * 12), amount: p.ppAmount, mode: p.ppMode }] : [];
      return { r: simLoan({ ...base, prepayments: pp }), plain: pp.length ? simLoan(base) : null };
    },
    view: ({ r, plain }, p) => {
      const t = r.totals;
      const saved = plain ? plain.totals.interest - t.interest : 0;
      return [
        kpis([
          ['Rata mensile', eurEl(t.firstRata), p.type === 'italiano' ? `l'ultima ${eur(t.lastRata)}` : null],
          ['Interessi totali', eurEl(t.interest), `${formatPercent(t.interest / (p.principal || 1) * 100, 0)} dell'importo`],
          ['TAEG', pct(t.taeg), 'costo totale annuo, con le spese'],
          ['Durata effettiva', `${Math.floor(t.months / 12)} anni${t.months % 12 ? ' e ' + (t.months % 12) + ' mesi' : ''}`, `${t.months} rate`],
        ]),
        plain ? h('section.card.callout', icon('sparkle', 20), h('div', h('b', `Con l'estinzione risparmi ${eur(saved)} di interessi`), h('p.muted', p.ppMode === 'durata' ? `Finisci ${Math.floor((plain.totals.months - t.months) / 12)} anni e ${(plain.totals.months - t.months) % 12} mesi prima.` : `La rata scende a ${eur(r.rows[Math.round(p.ppYear * 12)]?.rata || 0)}.`))) : null,
        card('Debito residuo', {}, lineChart({ labels: r.years.map(y => 'Anno ' + y.year), series: [{ name: 'Debito residuo', color: 'var(--c8)', values: r.years.map(y => y.balance), area: true }, ...(plain ? [{ name: 'Senza estinzione', color: 'var(--ink-3)', values: plain.years.map(y => y.balance), dashed: true }] : [])], fmt: tipEur, fmtAxis: axisEur, height: 220 }),
          plain ? legend([{ label: 'Con estinzione', color: 'var(--c8)' }, { label: 'Senza', color: 'var(--ink-3)', dashed: true }]) : null),
        card('Cosa paghi ogni anno', {}, barChart({ labels: r.years.map(y => String(y.year)), tipLabels: r.years.map(y => 'Anno ' + y.year), series: [{ name: 'Capitale', color: 'var(--c1)', values: r.years.map(y => y.capital) }, { name: 'Interessi', color: 'var(--c2)', values: r.years.map(y => y.interest) }], stacked: true, fmt: tipEur, fmtAxis: axisEur, height: 200 }),
          legend([{ label: 'Quota capitale', color: 'var(--c1)' }, { label: 'Quota interessi', color: 'var(--c2)' }])),
        yearTable(['Anno', 'Pagato', 'Capitale', 'Interessi', 'Estinzione', 'Debito residuo'], r.years.map(y => [y.year, eur(y.paid), eur(y.capital), eur(y.interest), y.prepaid ? eur(y.prepaid) : '—', eur(y.balance)])),
      ];
    },
  },
  fire: {
    title: 'Indipendenza finanziaria', emoji: '🌴', desc: 'Quando potresti vivere dei tuoi investimenti (FIRE), con la regola del prelievo sostenibile.',
    fields: [
      { k: 'annualExpenses', label: 'Spese annue', t: 'eur', def: 24000 },
      { k: 'assets', label: 'Patrimonio investito oggi', t: 'eur', def: 30000 },
      { k: 'monthlySaving', label: 'Risparmio investito al mese', t: 'eur', def: 800 },
      { k: 'realReturn', label: 'Rendimento reale annuo', t: 'pct', def: 4, hint: 'Al netto dell\'inflazione' },
      { k: 'swr', label: 'Prelievo sostenibile', t: 'pct', def: 3.5, hint: 'La "regola del 4%"; 3-3,5% è più prudente' },
      { k: 'age', label: 'La tua età (facoltativa)', t: 'num', def: 0, suf: 'anni' },
    ],
    mine: ctx => {
      const { d } = ctx;
      const f = [];
      const end = monthKey(d.refDate);
      for (let i = 1; i <= 12; i++) { const m = addMonthKey(end, -i); f.push(d.flows(monthStart(m), monthEnd(m))); }
      const used = f.filter(x => x.expense || x.income);
      const exp = used.length ? used.reduce((a, x) => a + x.expense, 0) / used.length * 12 : 0;
      const sav = used.length ? used.reduce((a, x) => a + x.net, 0) / used.length : 0;
      return { annualExpenses: Math.round(exp / 100) || undefined, assets: Math.round((d.groupTotals.investments) / 100) || undefined, monthlySaving: Math.max(0, Math.round(sav / 100)) || undefined };
    },
    run: p => simFIRE(p),
    view: (r, p) => [
      h('section.card.fire-hero',
        ring(r.progress, 120, 10, Math.round(r.progress * 100) + '%'),
        h('div',
          h('div.hero-label', 'Il tuo numero'), h('div.hero-value', eurEl(r.target)),
          h('p', r.months === 0 ? h('b', 'Ci sei già: il patrimonio copre le spese.') : r.years != null ? [h('b', `Tra circa ${formatNumber(r.years, 1)} anni`), r.fiAge ? ` (a ${Math.round(r.fiAge)} anni)` : '', '.'] : h('b', 'Con questi numeri non ci arrivi in 100 anni: aumenta il risparmio o il rendimento.')),
          h('p.muted', `A quel punto potresti prelevare circa ${eur(r.monthlyIncomeAtFI)} al mese.`))),
      card('Il percorso', {}, lineChart({ labels: r.series.map(x => 'Anno ' + formatNumber(x.year, 1)), series: [{ name: 'Patrimonio', color: 'var(--c3)', values: r.series.map(x => x.assets), area: true }], target: { value: r.target, label: 'obiettivo' }, fmt: tipEur, fmtAxis: axisEur, height: 240 })),
      card('E se risparmiassi un po\' di più?', {}, h('div.mini-list', r.sensitivity.map(s => h('div.mini-row', h('span.mini-l', `+${eur(s.extra)} al mese`), h('span.mini-r', s.months == null ? 'oltre 100 anni' : `${formatNumber(s.months / 12, 1)} anni`, r.months && s.months != null ? h('span.pos', ` (−${formatNumber((r.months - s.months) / 12, 1)})`) : null))))),
      h('p.fine', icon('info', 14), ' Stima semplificata con rendimento costante. I mercati non salgono in linea retta: tieni un margine di sicurezza.'),
    ],
  },
  inflazione: {
    title: 'Inflazione', emoji: '🎈', desc: 'Quanto perdono valore i soldi fermi e quanto costeranno le cose tra qualche anno.',
    fields: [
      { k: 'amount', label: 'Importo', t: 'eur', def: 10000 },
      { k: 'years', label: 'Tra', t: 'num', def: 10, suf: 'anni' },
      { k: 'rate', label: 'Inflazione media annua', t: 'pct', def: 2.5 },
      { k: 'nominalReturn', label: 'Rendimento dei soldi (facoltativo)', t: 'pct', def: 0, hint: 'Es. il tasso netto del tuo conto deposito' },
    ],
    run: p => simInflation(p),
    view: (r, p) => [
      kpis([
        ['Varranno come', eurEl(r.totals.purchasingPower), `di oggi (−${formatPercent(r.totals.lossPct, 0)})`],
        ['Quello che oggi costa ' + eur(p.amount), eurEl(r.totals.futureCost), `costerà tra ${p.years} anni`],
        ['Rendimento reale', pct(r.totals.realReturn), p.nominalReturn ? `con il ${pct(p.nominalReturn, 1)} di rendimento` : 'soldi fermi'],
        ['Investiti, varranno', eurEl(r.totals.investedReal), 'in soldi di oggi'],
      ]),
      card('Potere d\'acquisto', {}, lineChart({ labels: r.rows.map(x => 'Anno ' + x.year), series: [{ name: 'Soldi fermi', color: 'var(--c8)', values: r.rows.map(x => x.purchasingPower), area: true }, ...(p.nominalReturn ? [{ name: 'Investiti', color: 'var(--c3)', values: r.rows.map(x => x.invested) }] : []), { name: 'Prezzi', color: 'var(--ink-3)', values: r.rows.map(x => x.futureCost), dashed: true }], fmt: tipEur, fmtAxis: axisEur, height: 240, zero: false }),
        legend([{ label: 'Valore reale dei soldi fermi', color: 'var(--c8)' }, ...(p.nominalReturn ? [{ label: 'Valore reale se investiti', color: 'var(--c3)', line: true }] : []), { label: 'Costo delle stesse cose', color: 'var(--ink-3)', dashed: true }])),
    ],
  },
  btp: {
    title: 'BTP e obbligazioni', emoji: '🏛️', desc: 'Rendimento a scadenza lordo e netto di un titolo di Stato o di un\'obbligazione comprata a un certo prezzo.',
    fields: [
      { k: 'amount', label: 'Quanto investi', t: 'eur', def: 10000 },
      { k: 'price', label: 'Prezzo (su 100)', t: 'num', def: 98.5 },
      { k: 'coupon', label: 'Cedola annua', t: 'pct', def: 3 },
      { k: 'freq', label: 'Cedole', t: 'sel', def: 2, opts: [[2, 'semestrali'], [1, 'annuali']] },
      { k: 'years', label: 'Anni alla scadenza', t: 'num', def: 5, suf: 'anni' },
      { k: 'taxRate', label: 'Tassazione', t: 'sel', def: TAX_GOV, opts: [[TAX_GOV, '12,5% (titoli di Stato)'], [TAX_STANDARD, '26% (obbligazioni societarie)']] },
      { k: 'feePct', label: 'Commissione d\'acquisto', t: 'pct', def: 0.1 },
    ],
    run: p => simBond(p),
    view: (r, p) => [
      kpis([
        ['Rendimento netto a scadenza', pct(r.totals.netYtm), 'annuo, se tieni fino alla fine'],
        ['Rendimento lordo', pct(r.totals.grossYtm), null],
        ['Cedole nette all\'anno', eurEl(r.totals.couponNetYear), `su ${eur(r.totals.nominal)} di nominale`],
        ['Guadagno netto totale', eurEl(r.totals.profitNet, { sign: true, tone: r.totals.profitNet >= 0 ? 'pos' : 'neg' }), `in ${formatNumber(p.years, 1)} anni`],
      ]),
      h('p.fine', icon('info', 14), ` Comprato sotto 100, a scadenza ricevi 100: la differenza è un guadagno tassato al ${String(p.taxRate).replace('.', ',')}%. I titoli di Stato non pagano l'imposta di successione e non contano nell'ISEE fino a 50.000 €.`),
    ],
  },
  costo: {
    title: 'Quanto costa davvero', emoji: '☕', desc: 'Una spesa fissa (abbonamento, caffè, sigarette) nel tempo, e quanto varrebbe se la investissi.',
    fields: [
      { k: 'monthly', label: 'Spesa al mese', t: 'eur', def: 40 },
      { k: 'years', label: 'Per', t: 'num', def: 15, suf: 'anni' },
      { k: 'annualReturn', label: 'Rendimento se investita', t: 'pct', def: 5 },
    ],
    run: p => simTrueCost(p),
    view: (r, p) => [
      kpis([
        ['Spendi in tutto', eurEl(r.totals.spent), `${eur(r.totals.yearly)} all'anno`],
        ['Investita, diventerebbe', eurEl(r.totals.invested), 'netto tasse'],
        ['Differenza', eurEl(r.totals.invested - r.totals.spent, { sign: true, tone: 'pos' }), `in ${p.years} anni`],
      ]),
      card('Nel tempo', {}, barChart({ labels: r.rows.map(x => String(x.year)), tipLabels: r.rows.map(x => 'Anno ' + x.year), series: [{ name: 'Speso', color: 'var(--c2)', values: r.rows.map(x => x.spent) }, { name: 'Se investito', color: 'var(--c3)', values: r.rows.map(x => x.net) }], fmt: tipEur, fmtAxis: axisEur, height: 220 }),
        legend([{ label: 'Speso', color: 'var(--c2)' }, { label: 'Se investito (netto)', color: 'var(--c3)' }])),
    ],
  },
};

function interestView(r, p) {
  const t = r.totals;
  return [
    kpis([
      ['Interessi netti', eurEl(t.net - t.bollo - t.fees, { sign: true, tone: t.net - t.bollo - t.fees >= 0 ? 'pos' : 'neg' }), 'dopo tasse, bollo e canone'],
      ['Capitale finale', eurEl(t.final), p.compound === false ? `di cui ${eur(t.paidOut)} già accreditati` : null],
      ['Rendimento netto annuo', pct(t.netYield), `lordo ${pct(p.rate)}`],
      ['Tasse e bollo', eurEl(t.tax + t.bollo), `ritenuta 26% ${eur(t.tax)} · bollo ${eur(t.bollo)}`],
    ]),
    card('Andamento', {}, lineChart({ labels: r.rows.map(x => 'Mese ' + x.month), series: [{ name: 'Sul conto', color: 'var(--c1)', values: r.rows.map(x => x.balance + x.paidOut), area: true }], fmt: tipEur, fmtAxis: axisEur, height: 200, zero: false })),
    card('Ogni liquidazione', {}, h('div.table-wrap', h('table.table.compact', h('thead', h('tr', h('th', 'Mese'), h('th.num', 'Lordi'), h('th.num', 'Ritenuta'), h('th.num', 'Bollo'), h('th.num', 'Netti'), h('th.num', 'Saldo'))),
      h('tbody', r.rows.map(x => h('tr', h('td', String(x.month)), h('td.num', eur(x.gross)), h('td.num', eur(x.tax)), h('td.num', eur(x.bollo)), h('td.num.pos', eur(x.net - x.bollo)), h('td.num', eur(x.balance + x.paidOut)))))))),
  ];
}

function kpis(list) {
  return h('section.card.kpi-grid', list.filter(Boolean).map(([l, v, s]) => h('div.stat', h('div.stat-label', l), h('div.stat-value', v), s ? h('div.stat-extra', s) : null)));
}
function breakdown(rows) {
  return h('div.breakdown', rows.map(([l, v, strong]) => h('div.bd-row', { class: strong ? 'strong' : '' }, h('span', l), eurEl(v, { tone: v < 0 ? 'neg' : '' }))));
}
function yearTable(head, rows) {
  return h('details.card.table-card', h('summary.card-head', h('h2.card-title', 'Tabella anno per anno'), icon('chevD', 18)),
    h('div.table-wrap', h('table.table.compact', h('thead', h('tr', head.map((x, i) => h(i ? 'th.num' : 'th', x)))), h('tbody', rows.map(r => h('tr', r.map((x, i) => h(i ? 'td.num' : 'td', String(x)))))))));
}

/* ─── Campi dei parametri ─── */
function buildForm(ctx, key, def, onChange) {
  const saved = ctx.st.sims[key] || {};
  const p = {};
  for (const f of def.fields) p[f.k] = saved[f.k] ?? f.def;
  const inputs = {};
  const emit = debounce(() => { saveSim(key, { ...p }); }, 600);
  const changed = () => { onChange({ ...p }); emit(); };
  const rows = def.fields.map(f => {
    let ctl;
    if (f.t === 'sel') {
      ctl = selectInput(f.opts.map(([v, l]) => ({ value: v, label: l })), p[f.k], v => { p[f.k] = typeof f.def === 'number' ? Number(v) : v; changed(); });
    } else if (f.t === 'bool') {
      ctl = toggle(f.label, !!p[f.k], v => { p[f.k] = v; changed(); });
      inputs[f.k] = ctl;
      return h('div.field-wide', ctl);
    } else {
      ctl = numberInput({ value: p[f.k], suffix: f.t === 'eur' ? '€' : f.t === 'pct' ? '%' : f.suf || '', placeholder: '0' });
      ctl.input.addEventListener('input', () => { const v = ctl.getValue(); p[f.k] = v == null ? 0 : v; changed(); });
    }
    inputs[f.k] = ctl;
    return field(f.label, ctl, { hint: f.hint });
  });
  const set = vals => {
    for (const [k, v] of Object.entries(vals)) {
      if (v == null || !(k in inputs)) continue;
      p[k] = v;
      const ctl = inputs[k];
      if (ctl.input && ctl.input.type !== 'checkbox') ctl.input.value = String(v).replace('.', ',');
    }
    changed();
  };
  return { p, el: h('div.sim-form', rows), set };
}

export default {
  render(ctx) {
    const key = ctx.route.params[0];
    const def = SIMS[key];
    if (!def) {
      return {
        title: 'Simulazioni', sub: 'Calcoli con le regole fiscali italiane',
        node: h('div.sim-grid', Object.entries(SIMS).map(([k, s]) => h('a.sim-tile', { href: '#/simulazioni/' + k }, h('span.sim-emoji', s.emoji), h('span.sim-t', s.title), h('span.sim-d', s.desc), icon('chevR', 18, 'sim-go')))),
      };
    }
    const results = h('div.sim-results.stack');
    const draw = p => {
      let r;
      try { r = def.run(p); } catch (e) { results.replaceChildren(h('section.card', h('p.field-err', 'Controlla i valori: ' + (e?.message || e)))); return; }
      results.replaceChildren(...def.view(r, p).flat().filter(Boolean));
    };
    const form = buildForm(ctx, key, def, draw);
    draw(form.p);
    const mine = def.mine ? def.mine(ctx) : null;
    const hasMine = mine && Object.values(mine).some(v => v != null);
    return {
      title: def.title, sub: def.desc,
      actions: [h('a.icon-btn', { href: '#/simulazioni', 'aria-label': 'Tutte le simulazioni' }, icon('chevL', 20))],
      node: h('div.sim-layout',
        h('aside.card.sim-inputs',
          h('div.card-head', h('h2.card-title', 'Dati'), h('div.row-btns',
            hasMine ? h('button.btn.btn-sm.btn-soft', { type: 'button', onclick: () => form.set(mine), title: 'Riempi con i numeri dei tuoi conti' }, icon('sparkle', 15), 'I miei dati') : null,
            h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: () => { saveSim(key, Object.fromEntries(def.fields.map(f => [f.k, f.def]))); ctx.rerender(); } }, 'Ripristina'))),
          form.el),
        results),
    };
  },
};
