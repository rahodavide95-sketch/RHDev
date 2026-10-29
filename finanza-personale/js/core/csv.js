/* File CSV: lettura degli estratti conto delle banche ed esportazione per Excel. */

import { parseAmount } from './money.js';
import { parseDateFlexible } from './dates.js';

/** Legge un CSV (virgolette, a capo dentro i campi, BOM). Il separatore si indovina se non è indicato. */
export function parseCSV(text, delimiter) {
  let s = String(text || '').replace(/^﻿/, '');
  const delim = delimiter || detectDelimiter(s);
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"' && field === '') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(x => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(x => x.trim() !== '')) rows.push(row);
  return { rows: rows.map(r => r.map(x => x.trim())), delimiter: delim };
}

export function detectDelimiter(s) {
  // il separatore giusto compare lo stesso numero di volte in quasi tutte le righe
  // (anche se in cima c'è qualche riga di intestazione della banca senza separatori)
  const lines = s.split(/\r?\n/).filter(l => l.trim()).slice(0, 30);
  let best = ',', bestScore = -1;
  for (const d of [';', ',', '\t', '|']) {
    const freq = new Map();
    for (const l of lines) {
      let n = 0, q = false;
      for (const c of l) { if (c === '"') q = !q; else if (c === d && !q) n++; }
      if (n > 0) freq.set(n, (freq.get(n) || 0) + 1);
    }
    let mode = 0, f = 0;
    for (const [n, k] of freq) if (k > f || (k === f && n > mode)) { mode = n; f = k; }
    if (!mode) continue;
    const score = f * 10 + mode;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const HINTS = {
  date: ['data operazione', 'data contabile', 'data', 'date', 'booking date', 'transaction date', 'data mov', 'data registrazione', 'started date', 'completed date'],
  valueDate: ['data valuta', 'valuta', 'value date'],
  description: ['descrizione operazione', 'descrizione', 'causale', 'description', 'dettagli', 'details', 'beneficiario', 'controparte', 'payee', 'merchant', 'esercente', 'note', 'memo', 'reference', 'counterparty'],
  amount: ['importo', 'amount', 'importo eur', 'importo euro', 'ammontare', 'valore', 'totale', 'importo in euro'],
  income: ['entrate', 'accrediti', 'avere', 'credit', 'credito', 'in', 'paid in', 'money in'],
  expense: ['uscite', 'addebiti', 'dare', 'debit', 'debito', 'out', 'paid out', 'money out'],
  category: ['categoria', 'category'],
};

/** Prova a capire quale colonna è cosa guardando l'intestazione (e i valori se serve). */
export function guessMapping(header, sample = []) {
  const h = header.map(norm);
  const pick = (key, avoid = []) => {
    for (const hint of HINTS[key]) {
      const i = h.findIndex((x, j) => !avoid.includes(j) && x === hint);
      if (i >= 0) return i;
    }
    for (const hint of HINTS[key]) {
      if (hint.length < 4) continue;
      const i = h.findIndex((x, j) => !avoid.includes(j) && x.includes(hint));
      if (i >= 0) return i;
    }
    return -1;
  };
  const m = { date: -1, description: -1, amount: -1, income: -1, expense: -1, category: -1, dateOrder: 'dmy' };
  m.valueDate = pick('valueDate');
  m.date = pick('date', [m.valueDate].filter(x => x >= 0));
  if (m.date < 0) m.date = m.valueDate;
  m.income = pick('income');
  m.expense = pick('expense', [m.income]);
  m.amount = pick('amount', [m.income, m.expense].filter(x => x >= 0));
  m.description = pick('description', [m.date, m.amount, m.income, m.expense].filter(x => x >= 0));
  m.category = pick('category', [m.description].filter(x => x >= 0));
  if (m.amount >= 0) { m.income = -1; m.expense = -1; }
  // se non c'è intestazione riconoscibile, guarda i valori
  if (m.date < 0 && sample.length) m.date = sample[0].findIndex(v => parseDateFlexible(v));
  if (m.amount < 0 && m.income < 0 && sample.length) m.amount = sample[0].findIndex((v, i) => i !== m.date && /\d/.test(v) && parseAmount(v) !== null);
  if (m.description < 0 && sample.length) {
    let best = -1, len = 0;
    sample[0].forEach((v, i) => { if (i !== m.date && i !== m.amount && v.length > len) { best = i; len = v.length; } });
    m.description = best;
  }
  // date americane (mm/gg) se un valore ha il "giorno" oltre 12 nella seconda posizione
  if (m.date >= 0) {
    const vals = sample.map(r => r[m.date]).filter(Boolean);
    const us = vals.some(v => { const x = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/); return x && +x[2] > 12; });
    const eu = vals.some(v => { const x = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/); return x && +x[1] > 12; });
    if (us && !eu) m.dateOrder = 'mdy';
  }
  return m;
}

/** Il file ha una riga d'intestazione? (se la prima riga non contiene né date né importi, sì) */
export function hasHeader(rows) {
  if (!rows.length) return false;
  const first = rows[0];
  return !first.some(v => parseDateFlexible(v)) || first.every(v => !/\d/.test(v));
}

/** Converte le righe in movimenti grezzi {date, amount (centesimi, con segno), description, category}. */
export function rowsToTransactions(rows, mapping, { invert = false } = {}) {
  const out = [], errors = [];
  rows.forEach((r, idx) => {
    const d = parseDateFlexible(r[mapping.date], mapping.dateOrder);
    let amount = null;
    if (mapping.amount >= 0) amount = parseAmount(r[mapping.amount] || '');
    else {
      const inc = mapping.income >= 0 ? parseAmount(r[mapping.income] || '') : null;
      const exp = mapping.expense >= 0 ? parseAmount(r[mapping.expense] || '') : null;
      if (inc || exp) amount = (inc ? Math.abs(inc) : 0) - (exp ? Math.abs(exp) : 0);
    }
    if (!d || amount === null || amount === 0) { errors.push(idx); return; }
    if (invert) amount = -amount;
    const description = [mapping.description].filter(i => i >= 0).map(i => r[i]).join(' ').replace(/\s+/g, ' ').trim();
    out.push({ row: idx, date: d, amount, description: description.slice(0, 120), category: mapping.category >= 0 ? (r[mapping.category] || '') : '' });
  });
  return { items: out, errors };
}

/* ─── Esportazione ─── */
const cell = v => {
  const s = v == null ? '' : String(v);
  // niente formule nelle celle (protezione da "CSV injection" quando si apre in Excel)
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? "'" + s : s;
  return /[";\n\r]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
};
export function toCSV(rows) {
  return '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n');
}
export const csvNumber = cents => ((Number(cents) || 0) / 100).toFixed(2).replace('.', ',');
