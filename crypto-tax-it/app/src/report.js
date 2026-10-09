/* Tabelle ed esportazioni: CSV per Excel italiano (; e virgola decimale), riepilogo testuale, report stampabile. */
(function () {
  'use strict';
  const CT = (globalThis.CT = globalThis.CT || {});
  const { D, ZERO, fx2, fq } = CT;

  const num = (x) => (x === null || x === undefined ? '' : fx2(x).replace('.', ','));
  const qnum = (x) => (x === null || x === undefined ? '' : fq(x).replace('.', ','));
  const dmy = (day) => (day ? day.split('-').reverse().join('/') : '');
  const KIND_IT = { sell: 'Vendita', swap: 'Permuta', spend: 'Pagamento', fee: 'Commissione', transfer_fee: 'Commissione di rete' };
  const CLS_IT = { crypto: 'Cripto', metal: 'Oro/metalli' };
  // da dove arriva l'imposta dell'anno, in parole semplici: operazioni che realizzano un guadagno/perdita (cessioni) e proventi ricevuti
  const SELL_IT = { sell: 'Vendite in euro', swap: 'Scambi tra due cripto (anche conversioni di piccoli importi)', spend: 'Pagamenti fatti con le cripto (carta, acquisti)', fee: 'Commissioni pagate in cripto', transfer_fee: 'Commissioni di rete pagate in cripto' };
  const GAIN_IT = { interest: 'Interessi (Earn e simili)', staking: 'Staking', cashback: 'Cashback e rimborsi della carta', referral: 'Bonus per inviti', airdrop: 'Airdrop', other: 'Altri premi e accrediti' };
  function taxSources(res) {
    const rows = [];
    const by = new Map();
    for (const d of res.engine.disposals) {
      if (d.year !== res.year) continue;
      const k = 'd:' + d.kind;
      if (!by.has(k)) { const r = { key: k, group: 'sell', kind: d.kind, label: SELL_IT[d.kind] || d.kind, count: 0, amount: CT.ZERO }; by.set(k, r); rows.push(r); }
      const r = by.get(k); r.count++; r.amount = r.amount.plus(d.gain);
    }
    for (const i of res.engine.incomes) {
      if (i.year !== res.year) continue;
      const k = 'i:' + i.type;
      if (!by.has(k)) { const r = { key: k, group: 'income', kind: i.type, label: GAIN_IT[i.type] || i.type, count: 0, amount: CT.ZERO }; by.set(k, r); rows.push(r); }
      const r = by.get(k); r.count++; r.amount = r.amount.plus(i.value);
    }
    const order = ['d:sell', 'd:swap', 'd:spend', 'd:fee', 'd:transfer_fee', 'i:interest', 'i:staking', 'i:cashback', 'i:referral', 'i:airdrop', 'i:other'];
    rows.sort((a, b) => (order.indexOf(a.key) + 99 * (order.indexOf(a.key) < 0)) - (order.indexOf(b.key) + 99 * (order.indexOf(b.key) < 0)));
    return { rows, hasSales: by.has('d:sell'), hasCashback: by.has('i:cashback') };
  }
  const INC_IT = { interest: 'Interessi', staking: 'Staking', cashback: 'Cashback', referral: 'Referral', airdrop: 'Airdrop', other: 'Altro' };

  function csv(headers, rows) {
    const esc = (v) => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return '﻿' + [headers, ...rows].map((r) => r.map(esc).join(';')).join('\r\n') + '\r\n';
  }

  const disposalsRows = (res) => res.engine.disposals.filter((d) => d.year === res.year).sort((a, b) => a.ts - b.ts).map((d) =>
    [dmy(d.day), d.account, d.asset, CLS_IT[d.cls] || d.cls, KIND_IT[d.kind] || d.kind, qnum(d.qty), num(d.proceeds), num(d.fee), num(d.cost), num(d.gain), d.source, d.src]);
  const DISPOSAL_HEAD = ['Data', 'Conto', 'Asset', 'Categoria', 'Tipo', 'Quantità', 'Corrispettivo netto €', 'Commissioni €', 'Costo €', 'Plus/minusvalenza €', 'Fonte del valore', 'Origine nel file'];

  const lotsRows = (res) => res.engine.disposals.filter((d) => d.year === res.year).sort((a, b) => a.ts - b.ts).flatMap((d) =>
    d.uses.map((u) => [dmy(d.day), d.asset, qnum(d.qty), dmy(u.day), qnum(u.qty), num(u.cost), u.documented ? 'sì' : 'NO', u.rebased ? 'sì' : 'no', u.lotId]));
  const LOTS_HEAD = ['Data cessione', 'Asset', 'Quantità ceduta', 'Data acquisto lotto', 'Quantità dal lotto', 'Costo del lotto €', 'Costo documentato', 'Rideterminato 1/1/2025', 'Lotto'];

  const incomesRows = (res) => res.engine.incomes.filter((i) => i.year === res.year).sort((a, b) => a.ts - b.ts).map((i) =>
    [dmy(i.day), i.account, i.asset, CLS_IT[i.cls] || i.cls, INC_IT[i.type] || i.type, qnum(i.qty), num(i.value), i.source, i.src]);
  const INCOME_HEAD = ['Data', 'Conto', 'Asset', 'Categoria', 'Tipo', 'Quantità', 'Valore normale €', 'Fonte del valore', 'Origine nel file'];

  const rwRows = (res) => res.rw.map((r) => [r.account, r.asset, CLS_IT[r.cls] || r.cls, qnum(r.qtyStart), qnum(r.qtyEnd), r.days, num(r.valueInitial), num(r.valueFinal), num(r.ivca), r.notes.join('; ')]);
  const RW_HEAD = ['Custode', 'Asset', 'Categoria', 'Quantità al 1/1', 'Quantità al 31/12', 'Giorni di detenzione', 'Valore iniziale €', 'Valore finale €', 'IVCA indicativa €', 'Note'];

  const issuesRows = (res) => res.engine.issues.map((i) => [i.level === 'block' ? 'DA RISOLVERE' : i.level === 'warn' ? 'Attenzione' : 'Nota', i.code, i.message, i.uid]);
  const ISSUE_HEAD = ['Livello', 'Codice', 'Messaggio', 'Riferimento'];

  const balancesRows = (res) => res.balances.map((b) => [b.account, b.asset, qnum(b.qty)]);
  const BAL_HEAD = ['Conto', 'Asset', `Saldo al 31/12`];

  function basketLines(b) {
    const L = [];
    L.push([`${b.name} (${b.law})`, '']);
    L.push(['Corrispettivi delle cessioni (netto commissioni)', num(b.proceeds)]);
    L.push(['Costi di acquisto', num(b.costs)]);
    L.push(['Plusvalenze', num(b.gains)]);
    L.push(['Minusvalenze', num(b.losses)]);
    if (b.income.gt(0)) L.push(['Proventi (staking, interessi, ecc.)', num(b.income)]);
    for (const c of b.carryUsed) L.push([`Minusvalenza ${c.year} utilizzata`, num(c.amount)]);
    L.push(['Imponibile', num(b.taxable)]);
    L.push([`Imposta sostitutiva (${b.rate.times(100).toFixed(0)}%)`, num(b.tax)]);
    if (b.newLoss.gt(0)) L.push([`Minusvalenza ${b.year} da riportare`, num(b.newLoss)]);
    return L;
  }

  function summaryText(res) {
    const y = res.y, blk = res.groups.blockCount;
    const L = [];
    L.push(`RIEPILOGO FISCALE ${res.year} - cripto e metalli preziosi`);
    L.push(blk ? `*** BOZZA: ${blk} cose da risolvere prima di usare i numeri ***` : 'Nessun problema bloccante rilevato (serve comunque la revisione di un professionista).');
    L.push('');
    for (const b of [y.crypto, y.metals]) { for (const [a, v] of basketLines(b)) L.push(v === '' ? `\n${a}` : `  ${a}: ${v} €`); }
    L.push('', `IMPOSTA SOSTITUTIVA TOTALE STIMATA: ${num(y.totalTax)} €`);
    L.push('', `Regole ${res.year}: ${y.rule.note} (stato: ${y.rule.status})`);
    return L.join('\r\n');
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function table(head, rows) {
    return `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  /** Documento HTML autonomo, da aprire e stampare / salvare in PDF dal browser. */
  function reportHtml(res) {
    const y = res.y, blk = res.groups.blockCount;
    const sec = (b) => `<h2>${esc(b.name)}</h2><p class="law">${esc(b.law)}</p>` + table(['Voce', '€'], basketLines(b).slice(1));
    return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Riepilogo fiscale ${res.year}</title><style>
body{font:14px/1.5 system-ui,Segoe UI,Arial,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;color:#14202b}
h1{font-size:1.5rem}h2{margin-top:2rem;font-size:1.15rem}.law{color:#5d6b7a;margin-top:-.6rem}
table{border-collapse:collapse;width:100%;margin:.5rem 0}th,td{border-bottom:1px solid #dfe4ea;padding:.35rem .5rem;text-align:left;vertical-align:top}
td:last-child,th:last-child{text-align:right}.tot{font-size:1.2rem;font-weight:600;margin:1rem 0}
.warn{background:#fff3d6;border:1px solid #e0b252;padding:.6rem .8rem;border-radius:6px}small{color:#5d6b7a}
@media print{body{margin:0}h2{break-after:avoid}tr{break-inside:avoid}}</style></head><body>
<h1>Riepilogo fiscale ${res.year}</h1>
${blk ? `<p class="warn"><b>BOZZA</b>: ${blk} punti da risolvere prima di usare questi numeri.</p>` : ''}
${sec(y.crypto)}${sec(y.metals)}
<p class="tot">Imposta sostitutiva totale stimata: ${esc(num(y.totalTax))} €</p>
<h2>Monitoraggio (quadro RW) - bozza</h2>
${table(['Custode', 'Asset', 'Giorni', 'Valore iniziale €', 'Valore finale €', 'IVCA indicativa €'], res.rw.map((r) => [r.account, r.asset, r.days, num(r.valueInitial), num(r.valueFinal), num(r.ivca)]))}
<h2>Cessioni dell'anno</h2>${table(DISPOSAL_HEAD.slice(0, 10), disposalsRows(res).map((r) => r.slice(0, 10)))}
<h2>Proventi dell'anno</h2>${table(INCOME_HEAD.slice(0, 7), incomesRows(res).map((r) => r.slice(0, 7)))}
<p><small>Regole ${res.year}: ${esc(y.rule.note)} Stato regole: ${esc(y.rule.status)}. Calcolo automatico: far verificare da un professionista prima dell'uso in dichiarazione.</small></p>
</body></html>`;
  }

  /** Diagnostica: SOLO struttura dei file e conteggi, nessun importo. Da incollare a chi sviluppa l'app. */
  function diagnostics(res, files) {
    const L = ['DIAGNOSTICA (nessun importo)', ''];
    for (const f of files) {
      L.push(`File: ${f.name} | tipo scelto: ${f.type || 'nessuno'}`);
      const d = CT.importers.describeFile(f.text);
      if (d.error) { L.push(`  errore: ${d.error}`); continue; }
      L.push(`  righe dati: ${d.rows} | riga intestazione: ${d.headerLine}`);
      L.push(`  colonne: ${d.headers.join(' | ')}`);
      for (const [k, vals] of Object.entries(d.categorical)) L.push(`  [${k}] ${vals.map(([v, n]) => `${v || '(vuoto)'}×${n}`).join(', ')}`);
    }
    L.push('', 'Problemi per tipo:');
    const c = {};
    for (const i of res.engine.issues) c[`${i.level}:${i.code}`] = (c[`${i.level}:${i.code}`] || 0) + 1;
    for (const [k, n] of Object.entries(c)) L.push(`  ${k}: ${n}`);
    for (const g of res.groups.unknown.values()) L.push(`  non riconosciuto: ${g.key} ×${g.items.length}`);
    return L.join('\n');
  }

  CT.report = { csv, num, qnum, dmy, disposalsRows, DISPOSAL_HEAD, lotsRows, LOTS_HEAD, incomesRows, INCOME_HEAD, rwRows, RW_HEAD,
    issuesRows, ISSUE_HEAD, balancesRows, BAL_HEAD, basketLines, summaryText, reportHtml, diagnostics, KIND_IT, CLS_IT, INC_IT, taxSources };
  if (typeof module !== 'undefined') module.exports = CT.report;
})();
