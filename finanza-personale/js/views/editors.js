/* Finestre per inserire e modificare: movimenti, conti, scadenze, obiettivi, titoli, categorie. */

import { h, icon } from '../ui/dom.js';
import { openSheet, field, textInput, textArea, dateInput, amountInput, numberInput, selectInput, selectValue, segmented, toggle, emojiButton, toast, twoTap, confirmDialog } from '../ui/components.js';
import { moneyText } from '../ui/fmt.js';
import * as A from '../actions.js';
import { S, undoToken, undo } from '../session.js';
import { ACCOUNT_TYPES, GROUPS, ASSET_CLASSES, isLiability, hasHoldings, suggestCategory, position, uid, stamp } from '../core/model.js';
import { CURRENCIES, formatMoney, formatNumber } from '../core/money.js';
import { today, isISODate, describeRule, nextOccurrence, formatDate, addDays } from '../core/dates.js';
import { simLoan } from '../core/finance.js';

const st = () => S.state;
const accName = id => st().accounts.find(a => a.id === id)?.name || 'Conto eliminato';

export function undoToast(msg) {
  const tk = undoToken();
  toast(msg, { kind: 'ok', action: tk ? { label: 'Annulla', fn: () => { if (undo(tk)) toast('Annullato'); else toast('Non si può più annullare: nel frattempo hai fatto altre modifiche'); } } : null });
}

export function accountOptions({ filter, includeArchived = false } = {}) {
  const list = st().accounts.filter(a => (includeArchived || !a.archived) && (!filter || filter(a)))
    .sort((a, b) => GROUPS[ACCOUNT_TYPES[a.type].group].order - GROUPS[ACCOUNT_TYPES[b.type].group].order || a.order - b.order);
  return list.map(a => ({ value: a.id, label: `${a.emoji || ACCOUNT_TYPES[a.type].emoji} ${a.name}${a.currency !== st().settings.currency ? ' (' + a.currency + ')' : ''}`, group: GROUPS[ACCOUNT_TYPES[a.type].group].label }));
}

const catLabel = c => (c ? `${c.emoji} ${c.name}` : 'Senza categoria');

/* ═══ Scelta della categoria ═════════════════════════════════════════════ */
export function pickCategory(kind, current, onPick) {
  const cats = st().categories.filter(c => c.kind === kind && !c.archived);
  const groups = [...new Set(cats.map(c => c.group))];
  const q = textInput({ placeholder: 'Cerca una categoria', autofocus: true });
  const list = h('div.cat-groups');
  const draw = () => {
    const term = q.value.trim().toLowerCase();
    list.replaceChildren(...groups.map(g => {
      const items = cats.filter(c => c.group === g && (!term || c.name.toLowerCase().includes(term)));
      if (!items.length) return null;
      return h('div.cat-group', h('div.cat-group-t', g), h('div.cat-grid', items.map(c => h('button.cat-chip', { type: 'button', class: c.id === current ? 'on' : '', onclick: () => { onPick(c.id); s.close(true); } }, h('span.cat-emoji', c.emoji), h('span', c.name)))));
    }).filter(Boolean),
    h('div.cat-group', h('div.cat-grid',
      h('button.cat-chip', { type: 'button', class: !current ? 'on' : '', onclick: () => { onPick(null); s.close(true); } }, h('span.cat-emoji', '∅'), h('span', 'Senza categoria')),
      h('button.cat-chip.add', { type: 'button', onclick: () => { s.close(true); categoryEditor(null, kind, id => onPick(id)); } }, icon('plus', 16), h('span', 'Nuova categoria')))));
  };
  q.addEventListener('input', draw);
  draw();
  const s = openSheet({ title: kind === 'income' ? 'Categoria di entrata' : 'Categoria di spesa', body: h('div.stack', q, list), size: 'md' });
}

/* ═══ Movimento ═════════════════════════════════════════════════════════ */
export function txEditor(ctx, tx = null, preset = {}) {
  const state = st();
  if (!state.accounts.filter(a => !a.archived).length) {
    toast('Prima crea un conto: è lì che finiscono i movimenti.');
    accountEditor(ctx);
    return;
  }
  const isNew = !tx;
  const lastAcc = state.transactions.length ? state.transactions[state.transactions.length - 1].account : null;
  const v = {
    kind: tx?.kind || preset.kind || 'expense',
    account: tx?.account || preset.account || (state.accounts.find(a => a.id === lastAcc && !a.archived) ? lastAcc : state.accounts.find(a => !a.archived)?.id),
    toAccount: tx?.toAccount || preset.toAccount || null,
    category: tx?.category ?? preset.category ?? null,
    date: tx?.date || preset.date || today(),
  };
  let catTouched = !!tx?.category;
  const accCur = id => state.accounts.find(a => a.id === id)?.currency || state.settings.currency;

  const amount = amountInput({ value: tx?.amount ?? preset.amount ?? null, currency: accCur(v.account), autofocus: isNew, big: true });
  const amountTo = amountInput({ value: tx?.amountTo ?? null, currency: accCur(v.toAccount) });
  const accSel = selectInput(accountOptions(), v.account, val => { v.account = val; amount.setCurrency(accCur(val)); refresh(); });
  const toSel = selectInput([{ value: '', label: 'Scegli il conto' }, ...accountOptions()], v.toAccount || '', val => { v.toAccount = val || null; amountTo.setCurrency(accCur(val)); refresh(); });
  const payees = [...new Set(state.transactions.slice(-600).map(t => t.payee).filter(Boolean))].slice(-200);
  const dl = h('datalist', { id: 'payees-dl' }, payees.map(p => h('option', { value: p })));
  const payee = textInput({ value: tx?.payee || preset.payee || '', placeholder: 'Es. Esselunga, Stipendio, Affitto', list: 'payees-dl', max: 120 });
  const date = dateInput(v.date);
  const note = textArea({ value: tx?.note || '', placeholder: 'Facoltativa', rows: 2 });
  const tags = textInput({ value: (tx?.tags || []).join(', '), placeholder: 'es. vacanze, lavoro', max: 200 });
  const remember = toggle('Ricorda la categoria per questo nome', false, null, { hint: 'I prossimi movimenti con lo stesso nome la prenderanno da soli' });
  const flagged = toggle('Da verificare', !!tx?.flagged, null, { hint: 'Un promemoria per controllarlo dopo (c\'è un filtro apposta nei movimenti)' });
  const catBtn = h('button.cat-select', { type: 'button', onclick: () => pickCategory(v.kind, v.category, id => { v.category = id; catTouched = true; refresh(); }) });

  const kindSeg = segmented([
    { value: 'expense', label: 'Uscita', icon: 'out' },
    { value: 'income', label: 'Entrata', icon: 'in' },
    { value: 'transfer', label: 'Giroconto', icon: 'transfer' },
  ], v.kind, val => {
    v.kind = val;
    const c = state.categories.find(x => x.id === v.category);
    if (c && c.kind !== val) v.category = null;
    refresh();
  }, { label: 'Tipo di movimento' });

  payee.addEventListener('change', () => {
    if (catTouched || v.kind === 'transfer') return;
    const sug = suggestCategory(state, payee.value, v.kind);
    if (sug) { v.category = sug.category; refresh(); }
  });

  const catField = field('Categoria', catBtn);
  const toField = field('Verso il conto', toSel);
  const toAmtField = field('Importo arrivato', amountTo, { hint: 'Conti in valute diverse: quanto è arrivato sull\'altro conto' });
  const accField = field('Conto', accSel);
  const rememberWrap = h('div', remember);
  function refresh() {
    const c = state.categories.find(x => x.id === v.category);
    catBtn.replaceChildren(h('span.cat-emoji', c?.emoji || '∅'), h('span', c ? c.name : 'Scegli la categoria'), icon('chevR', 16));
    catBtn.classList.toggle('empty', !c);
    const tr = v.kind === 'transfer';
    catField.hidden = tr;
    toField.hidden = !tr;
    toAmtField.hidden = !tr || !v.toAccount || accCur(v.toAccount) === accCur(v.account);
    accField.querySelector('.field-label').textContent = tr ? 'Dal conto' : 'Conto';
    rememberWrap.hidden = tr || !v.category || !payee.value.trim() || state.rules.some(r => r.match === payee.value.trim().toLowerCase());
    amount.classList.toggle('tone-in', v.kind === 'income');
    amount.classList.toggle('tone-out', v.kind === 'expense');
  }
  payee.addEventListener('input', refresh);
  refresh();

  const err = h('p.field-err', { hidden: true, role: 'alert' });
  const save = again => {
    const cents = amount.getCents();
    const sameCur = accCur(v.toAccount) === accCur(v.account);
    const msg = !cents ? 'Scrivi un importo maggiore di zero.' : !isISODate(date.value) ? 'La data non è valida.'
      : v.kind === 'transfer' && !v.toAccount ? 'Scegli il conto di destinazione.' : v.kind === 'transfer' && v.toAccount === v.account ? 'I due conti devono essere diversi.'
      : v.kind === 'transfer' && !sameCur && !amountTo.getCents() ? `Scrivi quanto è arrivato sul conto in ${accCur(v.toAccount)}.` : '';
    if (msg) { err.textContent = msg; err.hidden = false; return; }
    A.saveTx({
      id: tx?.id, kind: v.kind, amount: cents, account: v.account, toAccount: v.toAccount, amountTo: v.kind === 'transfer' ? (sameCur ? cents : amountTo.getCents() || cents) : null,
      category: v.category, payee: payee.value.trim(), date: date.value, note: note.value.trim(),
      tags: tags.value.split(',').map(x => x.trim().toLowerCase().replace(/^#/, '')).filter(Boolean), rememberRule: remember.input.checked, recurring: tx?.recurring, flagged: flagged.input.checked,
    });
    toast(isNew ? 'Movimento aggiunto' : 'Modifiche salvate', { kind: 'ok' });
    s.close(true);
    if (again) txEditor(ctx, null, { kind: v.kind, account: v.account, date: date.value });
  };
  const s = openSheet({
    title: isNew ? 'Nuovo movimento' : 'Modifica movimento',
    body: h('form.stack', { onsubmit: e => { e.preventDefault(); save(false); } },
      kindSeg, amount, dl,
      h('div.grid-2', accField, toField, catField),
      toAmtField,
      field('Descrizione', payee),
      h('div.grid-2', field('Data', date), field('Etichette', tags, { hint: 'Separate da virgole' })),
      field('Nota', note),
      rememberWrap, flagged, err,
      h('button', { type: 'submit', hidden: true })),
    footer: [
      !isNew ? twoTap('Elimina', () => { A.deleteTx(tx.id); s.close(true); undoToast('Movimento eliminato'); }, { iconName: 'trash', cls: 'btn btn-danger-soft' }) : h('button.btn.btn-ghost.only-desktop', { type: 'button', onclick: () => save(true) }, 'Salva e nuovo'),
      !isNew ? h('button.btn.btn-ghost', { type: 'button', onclick: () => { A.duplicateTx(tx.id); s.close(true); toast('Duplicato con la data di oggi', { kind: 'ok' }); } }, icon('copy', 18), 'Duplica') : null,
      h('button.btn.btn-primary', { type: 'button', onclick: () => save(false) }, isNew ? 'Aggiungi' : 'Salva'),
    ],
  });
  return s;
}

/* ═══ Conto ═════════════════════════════════════════════════════════════ */
export function accountEditor(ctx, acc = null, preset = {}) {
  const state = st();
  const isNew = !acc;
  const v = { type: acc?.type || preset.type || 'checking', currency: acc?.currency || state.settings.currency };
  const name = textInput({ value: acc?.name || '', placeholder: 'Es. Conto Fineco, Carta Visa, Casa', autofocus: isNew, max: 60 });
  const inst = textInput({ value: acc?.institution || '', placeholder: 'Banca o società (facoltativo)', max: 60 });
  const emoji = emojiButton(acc?.emoji || ACCOUNT_TYPES[v.type].emoji);
  const typeOpts = Object.entries(ACCOUNT_TYPES).map(([k, t]) => ({ value: k, label: `${t.emoji} ${t.label}`, group: GROUPS[t.group].label }));
  const curOpts = Object.entries(CURRENCIES).map(([k, c]) => ({ value: k, label: `${k} · ${c.name}` }));
  const open = state.valuations.find(x => x.account === acc?.id && x.kind === 'open');
  const opening = amountInput({ value: open ? Math.abs(open.value) : null, currency: v.currency, allowNegative: true });
  const openDate = dateInput(open?.date || today());
  const inNW = toggle('Conta nel patrimonio', acc ? acc.inNetWorth : true);
  const archived = toggle('Archiviato', acc?.archived || false, null, { hint: 'Nascosto dagli elenchi, i movimenti restano' });
  const notes = textArea({ value: acc?.notes || '', placeholder: 'Facoltative (non scrivere password o PIN)', rows: 2 });
  // piano di ammortamento per mutui e prestiti
  const plan = acc?.plan || {};
  const pPrincipal = amountInput({ value: plan.principal ? Math.round(plan.principal * 100) : null, currency: v.currency });
  const pTan = numberInput({ value: plan.tan ?? '', suffix: '%', placeholder: '3,2' });
  const pYears = numberInput({ value: plan.months ? plan.months / 12 : '', suffix: 'anni', placeholder: '25' });
  const pStart = dateInput(plan.start || today());
  const pType = segmented([{ value: 'francese', label: 'Rata costante' }, { value: 'italiano', label: 'Quota capitale costante' }], plan.type || 'francese', null, { small: true });
  const planPreview = h('p.field-hint');
  const typeSel = selectInput(typeOpts, v.type, val => {
    if (emoji.value === ACCOUNT_TYPES[v.type].emoji) { emoji.value = ACCOUNT_TYPES[val].emoji; emoji.textContent = emoji.value; }
    v.type = val; refresh();
  });
  const curSel = selectInput(curOpts, v.currency, val => { v.currency = val; opening.setCurrency(val); pPrincipal.setCurrency(val); });
  const openLabel = h('span');
  const openHint = h('p.field-hint');
  const openField = h('div.field', h('label.field-label', { for: opening.input.id = 'f-open' }, openLabel), opening, openHint);
  const planBox = h('div.subcard.stack',
    h('div.subcard-t', icon('receipt', 18), 'Piano di ammortamento'),
    h('p.field-hint', 'Con il piano, il debito residuo si aggiorna da solo ogni mese. Registra le rate come spese dal conto corrente.'),
    h('div.grid-2', field('Importo finanziato', pPrincipal), field('TAN', pTan)),
    h('div.grid-2', field('Durata', pYears), field('Inizio', pStart)),
    pType, planPreview);
  const updPreview = () => {
    const P = pPrincipal.getCents(), t = pTan.getValue(), y = pYears.getValue();
    if (P && t != null && y) { const r = simLoan({ principal: P / 100, tan: t, months: Math.round(y * 12), type: pType.value }); planPreview.textContent = `Rata ${formatMoney(Math.round(r.totals.firstRata * 100), v.currency)} · interessi totali ${formatMoney(Math.round(r.totals.interest * 100), v.currency)}`; }
    else planPreview.textContent = '';
  };
  [pPrincipal.input, pTan.input, pYears.input].forEach(i => i.addEventListener('input', updPreview));
  pType.addEventListener('click', updPreview);
  updPreview();
  function refresh() {
    const t = ACCOUNT_TYPES[v.type];
    planBox.hidden = !t.plan;
    const usePlan = t.plan;
    openField.hidden = usePlan;
    openLabel.textContent = t.liability ? 'Debito attuale' : t.group === 'assets' ? 'Valore attuale' : hasHoldings({ type: v.type }) ? 'Liquidità sul conto' : 'Saldo';
    openHint.textContent = t.liability ? 'Quanto devi, come numero positivo' : hasHoldings({ type: v.type }) ? 'Solo i contanti; i titoli li aggiungi dopo in Investimenti' : '';
  }
  refresh();
  const err = h('p.field-err', { hidden: true });
  const save = () => {
    const nm = name.value.trim();
    if (!nm) { err.textContent = 'Dai un nome al conto.'; err.hidden = false; name.focus(); return; }
    const t = ACCOUNT_TYPES[v.type];
    let planObj = null;
    if (t.plan) {
      const P = pPrincipal.getCents(), tan = pTan.getValue(), y = pYears.getValue();
      if (P && tan != null && y && isISODate(pStart.value)) planObj = { principal: P / 100, tan, months: Math.round(y * 12), start: pStart.value, type: pType.value };
      else if (P || y) { err.textContent = 'Completa importo, TAN e durata del piano (o lasciali vuoti).'; err.hidden = false; return; }
    }
    let val = opening.getCents() || 0;
    if (t.liability) val = -Math.abs(val);
    const data = { name: nm, type: v.type, institution: inst.value.trim(), currency: v.currency, emoji: emoji.value, inNetWorth: inNW.input.checked, notes: notes.value.trim(), plan: planObj };
    if (isNew) {
      const id = A.addAccount(data, planObj ? 0 : val, isISODate(openDate.value) ? openDate.value : today());
      toast('Conto creato', { kind: 'ok' });
      preset.onCreated?.(id);
    } else {
      A.updateAccount(acc.id, { ...data, archived: archived.input.checked });
      if (!planObj) A.setOpening(acc.id, val, isISODate(openDate.value) ? openDate.value : today());
      toast('Conto aggiornato', { kind: 'ok' });
    }
    s.close(true);
  };
  const s = openSheet({
    title: isNew ? 'Nuovo conto' : 'Modifica conto',
    body: h('form.stack', { onsubmit: e => { e.preventDefault(); save(); } },
      h('div.name-row', emoji, field('Nome', name, { wide: true })),
      h('div.grid-2', field('Tipo', typeSel), field('Valuta', curSel)),
      field('Banca o società', inst),
      h('div.grid-2', openField, isNew ? field('Alla data', openDate) : field('Data del saldo iniziale', openDate)),
      planBox,
      inNW, !isNew ? archived : null,
      field('Note', notes), err,
      h('button', { type: 'submit', hidden: true })),
    footer: [
      !isNew ? twoTap('Elimina', async () => {
        const n = state.transactions.filter(t => t.account === acc.id || t.toAccount === acc.id).length;
        if (n && !(await confirmDialog({ title: 'Eliminare il conto?', message: `Verranno eliminati anche ${n} movimenti collegati, le scadenze e i titoli di questo conto. Se vuoi solo nasconderlo, usa "Archiviato".`, confirm: 'Elimina tutto', danger: true }))) return;
        A.deleteAccount(acc.id); s.close(true); undoToast('Conto eliminato'); ctx?.go?.('conti');
      }, { iconName: 'trash' }) : null,
      h('button.btn.btn-primary', { type: 'button', onclick: save }, isNew ? 'Crea conto' : 'Salva'),
    ],
  });
}

/** "Il saldo vero è…" */
export function adjustEditor(ctx, acc) {
  const d = ctx.d;
  const cur = d.balances.get(acc.id) || 0;
  const liab = isLiability(acc);
  const amt = amountInput({ value: Math.abs(cur), currency: acc.currency, autofocus: true, allowNegative: !liab, big: true });
  const date = dateInput(today());
  const note = textInput({ placeholder: 'Facoltativa, es. "estratto conto di ottobre"', max: 200 });
  const diff = h('p.field-hint');
  const upd = () => { const c = amt.getCents(); if (c == null) { diff.textContent = ''; return; } const nv = liab ? -Math.abs(c) : c; const dd = nv - cur; diff.textContent = dd === 0 ? 'Nessuna differenza' : `Differenza: ${formatMoney(dd, acc.currency, { sign: true })}`; };
  amt.input.addEventListener('input', upd);
  const save = () => {
    const c = amt.getCents();
    if (c == null || !isISODate(date.value)) return;
    A.adjustBalance(acc.id, liab ? -Math.abs(c) : c, date.value, note.value.trim());
    toast('Saldo aggiornato', { kind: 'ok' });
    s.close(true);
  };
  const s = openSheet({
    title: liab ? 'Aggiorna il debito' : acc.type === 'property' || acc.type === 'vehicle' || acc.type === 'asset' ? 'Aggiorna il valore' : 'Aggiorna il saldo',
    subtitle: acc.name,
    body: h('form.stack', { onsubmit: e => { e.preventDefault(); save(); } },
      h('p.muted', hasHoldings(acc) ? 'Indica la liquidità (non i titoli) che vedi oggi sul conto. I movimenti dopo questa data si sommeranno a questo valore.' : 'Scrivi il valore che vedi davvero (estratto conto, app della banca). I movimenti dopo questa data si sommeranno a questo valore.'),
      amt, diff, h('div.grid-2', field('Alla data', date), field('Nota', note)), h('button', { type: 'submit', hidden: true })),
    footer: [h('button.btn.btn-primary', { type: 'button', onclick: save }, 'Aggiorna')],
  });
}

/* ═══ Scadenza / abbonamento ════════════════════════════════════════════ */
export function recurringEditor(ctx, r = null, preset = {}) {
  const state = st();
  if (!state.accounts.filter(a => !a.archived).length) { toast('Prima crea un conto.'); accountEditor(ctx); return; }
  const isNew = !r;
  const v = { kind: r?.kind || preset.kind || 'expense', account: r?.account || state.accounts.find(a => !a.archived)?.id, toAccount: r?.toAccount || null, category: r?.category ?? null, unit: r?.unit || 'month' };
  const accCur = id => state.accounts.find(a => a.id === id)?.currency || state.settings.currency;
  const name = textInput({ value: r?.name || preset.name || '', placeholder: 'Es. Affitto, Netflix, Stipendio', autofocus: isNew, max: 80 });
  const emoji = emojiButton(r?.emoji || '🔁');
  const amount = amountInput({ value: r?.amount ?? null, currency: accCur(v.account), big: true });
  const accSel = selectInput(accountOptions(), v.account, val => { v.account = val; amount.setCurrency(accCur(val)); });
  const toSel = selectInput([{ value: '', label: 'Scegli il conto' }, ...accountOptions()], v.toAccount || '', val => { v.toAccount = val || null; });
  const every = numberInput({ value: r?.every || 1, placeholder: '1' });
  const unitSel = selectInput([{ value: 'day', label: 'giorni' }, { value: 'week', label: 'settimane' }, { value: 'month', label: 'mesi' }, { value: 'year', label: 'anni' }], v.unit, val => { v.unit = val; updNext(); });
  const start = dateInput(r?.start || today());
  const end = dateInput(r?.end || '');
  const auto = toggle('Registra in automatico', r ? r.autoPost : true, null, { hint: 'Il movimento si crea da solo alla data. Spegnilo per importi che cambiano (bollette): te lo chiederò io.' });
  const sub = toggle('È un abbonamento', r ? r.subscription : v.kind === 'expense' && preset.subscription !== false, null, { hint: 'Compare nel riepilogo degli abbonamenti con il costo annuo' });
  const active = toggle('Attiva', r ? r.active : true);
  const catBtn = h('button.cat-select', { type: 'button', onclick: () => pickCategory(v.kind, v.category, id => { v.category = id; refresh(); }) });
  const nextInfo = h('p.field-hint');
  const updNext = () => {
    const ev = Math.max(1, Math.round(every.getValue() || 1));
    if (!isISODate(start.value)) { nextInfo.textContent = ''; return; }
    const rule = { unit: v.unit, every: ev, start: start.value, end: isISODate(end.value) ? end.value : null };
    const n = nextOccurrence(rule, today());
    nextInfo.textContent = `${describeRule(rule)} · prossima: ${n ? formatDate(n, { long: true, year: true }) : 'nessuna'}`;
  };
  [every.input, start, end].forEach(x => x.addEventListener('input', updNext));
  const kindSeg = segmented([{ value: 'expense', label: 'Uscita', icon: 'out' }, { value: 'income', label: 'Entrata', icon: 'in' }, { value: 'transfer', label: 'Giroconto', icon: 'transfer' }], v.kind, val => {
    v.kind = val;
    const c = state.categories.find(x => x.id === v.category);
    if (c && c.kind !== val) v.category = null;
    refresh();
  });
  const catField = field('Categoria', catBtn), toField = field('Verso il conto', toSel);
  const subWrap = h('div', sub);
  function refresh() {
    const c = state.categories.find(x => x.id === v.category);
    catBtn.replaceChildren(h('span.cat-emoji', c?.emoji || '∅'), h('span', c ? c.name : 'Scegli la categoria'), icon('chevR', 16));
    catField.hidden = v.kind === 'transfer';
    toField.hidden = v.kind !== 'transfer';
    subWrap.hidden = v.kind !== 'expense';
  }
  refresh(); updNext();
  const err = h('p.field-err', { hidden: true });
  const save = () => {
    const cents = amount.getCents();
    const nm = name.value.trim();
    const msg = !nm ? 'Dai un nome alla scadenza.' : cents == null ? 'Scrivi l\'importo (anche indicativo).' : !isISODate(start.value) ? 'Scegli la data della prima volta.' : v.kind === 'transfer' && (!v.toAccount || v.toAccount === v.account) ? 'Scegli un conto di destinazione diverso.' : '';
    if (msg) { err.textContent = msg; err.hidden = false; return; }
    A.saveRecurring({
      id: r?.id, name: nm, emoji: emoji.value, kind: v.kind, amount: cents, account: v.account, toAccount: v.kind === 'transfer' ? v.toAccount : null,
      category: v.kind === 'transfer' ? null : v.category, payee: nm, unit: v.unit, every: Math.max(1, Math.round(every.getValue() || 1)),
      start: start.value, end: isISODate(end.value) ? end.value : null, autoPost: auto.input.checked, subscription: v.kind === 'expense' && sub.input.checked, active: active.input.checked,
      // una scadenza nuova con inizio nel passato non registra gli arretrati: parte dalla prossima
      ...(isNew && start.value < today() ? { lastPosted: today() } : {}),
    });
    const n = A.runAutoPost();
    toast((isNew ? 'Scadenza aggiunta' : 'Scadenza aggiornata') + (n ? ` · ${n} registrata oggi` : ''), { kind: 'ok' });
    s.close(true);
  };
  const s = openSheet({
    title: isNew ? 'Nuova scadenza' : 'Modifica scadenza',
    body: h('form.stack', { onsubmit: e => { e.preventDefault(); save(); } },
      kindSeg,
      h('div.name-row', emoji, field('Nome', name, { wide: true })),
      amount,
      h('div.grid-2', field(v.kind === 'transfer' ? 'Dal conto' : 'Conto', accSel), toField, catField),
      h('div.grid-2', field('Ogni', h('div.every-row', every, unitSel)), field('Prima volta', start)),
      nextInfo,
      field('Fine (facoltativa)', end),
      auto, subWrap, !isNew ? active : null, err,
      h('button', { type: 'submit', hidden: true })),
    footer: [
      !isNew ? twoTap('Elimina', () => { A.deleteRecurring(r.id); s.close(true); undoToast('Scadenza eliminata'); }, { iconName: 'trash' }) : null,
      h('button.btn.btn-primary', { type: 'button', onclick: save }, isNew ? 'Aggiungi' : 'Salva'),
    ],
  });
}

/* ═══ Obiettivo ═════════════════════════════════════════════════════════ */
export function goalEditor(ctx, g = null) {
  const isNew = !g;
  const name = textInput({ value: g?.name || '', placeholder: 'Es. Fondo emergenza, Auto nuova, Viaggio', autofocus: isNew, max: 60 });
  const emoji = emojiButton(g?.emoji || '🎯');
  const target = amountInput({ value: g?.target ?? null, big: true });
  const date = dateInput(g?.date || '');
  const accSel = selectInput([{ value: '', label: 'Nessuno: segno io i versamenti' }, ...accountOptions({ filter: a => !isLiability(a) })], g?.account || '');
  const initial = amountInput({ value: null });
  const initialField = field('Già messo da parte', initial);
  const err = h('p.field-err', { hidden: true });
  const syncInit = () => { initialField.hidden = !isNew || !!selectValue(accSel); };
  accSel.addEventListener('change', syncInit);
  syncInit();
  const save = () => {
    const t = target.getCents();
    if (!name.value.trim() || !t) { err.textContent = 'Serve un nome e una cifra da raggiungere.'; err.hidden = false; return; }
    A.saveGoal({ id: g?.id, name: name.value.trim(), emoji: emoji.value, target: t, date: isISODate(date.value) ? date.value : null, account: selectValue(accSel) || null, initial: initial.getCents() || 0 });
    toast(isNew ? 'Obiettivo creato' : 'Obiettivo aggiornato', { kind: 'ok' });
    s.close(true);
  };
  const s = openSheet({
    title: isNew ? 'Nuovo obiettivo' : 'Modifica obiettivo',
    body: h('form.stack', { onsubmit: e => { e.preventDefault(); save(); } },
      h('div.name-row', emoji, field('Nome', name, { wide: true })),
      field('Cifra da raggiungere', target),
      h('div.grid-2', field('Entro il (facoltativo)', date), initialField),
      field('Collegato a un conto', accSel, { hint: 'Se lo colleghi, l\'avanzamento è il saldo di quel conto (es. un conto deposito dedicato)' }),
      err, h('button', { type: 'submit', hidden: true })),
    footer: [
      !isNew ? twoTap('Elimina', () => { A.deleteGoal(g.id); s.close(true); undoToast('Obiettivo eliminato'); }, { iconName: 'trash' }) : null,
      h('button.btn.btn-primary', { type: 'button', onclick: save }, isNew ? 'Crea' : 'Salva'),
    ],
  });
}

export function contributeEditor(ctx, g, withdraw = false) {
  const amt = amountInput({ autofocus: true, big: true });
  const date = dateInput(today());
  const note = textInput({ placeholder: 'Facoltativa', max: 200 });
  const save = () => {
    const c = amt.getCents();
    if (!c) return;
    A.contribute(g.id, withdraw ? -c : c, isISODate(date.value) ? date.value : today(), note.value.trim());
    toast(withdraw ? 'Prelievo registrato' : 'Versamento registrato', { kind: 'ok' });
    s.close(true);
  };
  const s = openSheet({
    title: withdraw ? 'Togli dall\'obiettivo' : 'Aggiungi all\'obiettivo', subtitle: `${g.emoji} ${g.name}`, size: 'sm',
    body: h('form.stack', { onsubmit: e => { e.preventDefault(); save(); } }, amt, h('div.grid-2', field('Data', date), field('Nota', note)), h('button', { type: 'submit', hidden: true })),
    footer: [h('button.btn.btn-primary', { type: 'button', onclick: save }, withdraw ? 'Togli' : 'Aggiungi')],
  });
}

/* ═══ Titolo e operazioni ════════════════════════════════════════════════ */
export function holdingEditor(ctx, hd = null, preset = {}) {
  const invAccounts = accountOptions({ filter: a => hasHoldings(a) });
  if (!invAccounts.length) {
    toast('Crea prima un conto investimenti o un wallet crypto.');
    accountEditor(ctx, null, { type: 'broker' });
    return;
  }
  const isNew = !hd;
  const v = { account: hd?.account || preset.account || invAccounts[0].value, cls: hd?.cls || 'etf_eq', currency: hd?.currency || 'EUR' };
  const name = textInput({ value: hd?.name || preset.name || '', placeholder: 'Es. Vanguard FTSE All-World', autofocus: isNew, max: 80 });
  const symbol = textInput({ value: hd?.symbol || preset.symbol || '', placeholder: 'Es. VWCE.DE, AAPL, BTC-USD', max: 24 });
  const isin = textInput({ value: hd?.isin || '', placeholder: 'Es. IE00BK5BQT80', max: 12 });
  const accSel = selectInput(invAccounts, v.account, val => { v.account = val; });
  const clsSel = selectInput(Object.entries(ASSET_CLASSES).map(([k, c]) => ({ value: k, label: `${c.label} · tassa ${String(c.tax).replace('.', ',')}%` })), v.cls, val => { v.cls = val; });
  const curSel = selectInput(Object.keys(CURRENCIES).map(k => ({ value: k, label: k })), v.currency, val => { v.currency = val; });
  const price = numberInput({ value: hd?.price || '', placeholder: '0,00', suffix: '' });
  const priceAuto = toggle('Aggiorna il prezzo online', hd ? hd.priceAuto : true, null, { hint: 'Quando premi "Aggiorna prezzi", viene inviato solo il simbolo del titolo, mai le quantità' });
  const group = textInput({ value: hd?.group || '', placeholder: 'Es. Azioni USA, Oro, Liquidità', list: 'inv-groups-dl', max: 40 });
  const groupsDl = h('datalist', { id: 'inv-groups-dl' }, investGroups().map(g => h('option', { value: g })));
  const ter = numberInput({ value: hd?.ter || '', placeholder: '0,00', suffix: '%' });
  // primo acquisto
  const qty = numberInput({ placeholder: 'Quantità' });
  const bprice = numberInput({ placeholder: 'Prezzo unitario' });
  const fee = numberInput({ placeholder: '0' });
  const bdate = dateInput(today());
  const payCash = toggle('Pagato con la liquidità del conto', false, null, { hint: 'Spento: stai inserendo titoli che avevi già' });
  const buyBox = isNew ? h('div.subcard.stack', h('div.subcard-t', icon('plus', 18), 'Acquisto (facoltativo)'), h('div.grid-3', field('Quantità', qty), field('Prezzo', bprice), field('Commissioni', fee)), field('Data', bdate), payCash) : null;
  const err = h('p.field-err', { hidden: true });
  const save = () => {
    const nm = name.value.trim() || symbol.value.trim();
    if (!nm) { err.textContent = 'Serve almeno il nome o il simbolo.'; err.hidden = false; return; }
    const p = price.getValue();
    const ops = [];
    if (isNew) {
      const q = qty.getValue(), bp = bprice.getValue();
      if (q && bp) ops.push({ id: uid('o-'), date: isISODate(bdate.value) ? bdate.value : today(), type: 'buy', qty: q, price: bp, fee: fee.getValue() || 0, amount: 0, cash: payCash.input.checked, note: '', created: stamp() });
    }
    const id = A.saveHolding({ id: hd?.id, account: v.account, name: nm, symbol: symbol.value.trim(), isin: isin.value.trim(), cls: v.cls, group: group.value, ter: Math.max(0, Math.min(10, ter.getValue() || 0)), currency: v.currency, price: p || (ops[0]?.price ?? hd?.price ?? 0), priceDate: p ? today() : hd?.priceDate, priceAuto: priceAuto.input.checked, ops: isNew ? ops : undefined });
    toast(isNew ? 'Titolo aggiunto' : 'Titolo aggiornato', { kind: 'ok' });
    s.close(true);
    return id;
  };
  const s = openSheet({
    title: isNew ? 'Nuovo titolo' : 'Modifica titolo',
    body: h('form.stack', { onsubmit: e => { e.preventDefault(); save(); } },
      field('Nome', name),
      h('div.grid-2', field('Simbolo (ticker)', symbol, { hint: 'Come su Yahoo Finance: VWCE.DE, ENI.MI, AAPL' }), field('ISIN', isin)),
      h('div.grid-2', field('Conto', accSel), field('Tipo', clsSel)),
      h('div.grid-2', field('Categoria', group, { hint: 'Il tuo raggruppamento, per vedere quanto hai in ognuno' }), field('TER', ter, { hint: 'Costo annuo del fondo, nella sua scheda (es. 0,07%)' })), groupsDl,
      h('div.grid-2', field('Valuta del titolo', curSel), field('Prezzo attuale', price)),
      priceAuto, buyBox, err, h('button', { type: 'submit', hidden: true })),
    footer: [
      !isNew ? twoTap('Elimina', () => { A.deleteHolding(hd.id); s.close(true); undoToast('Titolo eliminato'); }, { iconName: 'trash' }) : null,
      h('button.btn.btn-primary', { type: 'button', onclick: save }, isNew ? 'Aggiungi' : 'Salva'),
    ],
  });
}

/** Numero da scrivere in un campo (senza separatori delle migliaia). */
const numStr = (x, dec) => String(Math.round(x * 10 ** dec) / 10 ** dec).replace('.', ',');
/** Importo "tondo" di un acquisto passato (2,61 × 114,96 = 300,04 → 300). */
const roundish = x => (x >= 10 && Math.abs(x - Math.round(x)) / x < 0.005 ? Math.round(x) : Math.round(x * 100) / 100);

/** Categorie già usate nei titoli, più qualche suggerimento. */
function investGroups() {
  const used = st().holdings.map(x => x.group).filter(Boolean);
  return [...new Set([...used, 'Azioni mondo', 'Azioni USA (S&P 500)', 'Azioni Europa', 'Mercati emergenti', 'Obbligazioni', 'Titoli di Stato', 'Oro', 'Liquidità', 'Crypto', 'Tematici'])];
}

export function opEditor(ctx, hd, op = null, presetType = 'buy') {
  const isNew = !op;
  const v = { type: op?.type || presetType };
  const cur = hd.currency;
  const sym = CURRENCIES[cur]?.symbol || cur;
  const qty = numberInput({ value: op?.qty || '', placeholder: '0', autofocus: isNew });
  const price = numberInput({ value: op?.price || (isNew ? hd.price || '' : ''), placeholder: '0,00', suffix: sym });
  const gross = numberInput({ value: op?.qty && op?.price ? numStr(op.qty * op.price, 2) : '', placeholder: '0,00', suffix: sym });
  const fee = numberInput({ value: op?.fee || '', placeholder: '0', suffix: sym });
  const tax = numberInput({ value: op?.tax || '', placeholder: '0', suffix: sym });
  const amount = numberInput({ value: op?.amount ? Math.abs(op.amount) : '', placeholder: '0,00', suffix: sym });
  const date = dateInput(op?.date || today());
  const note = textInput({ value: op?.note || '', placeholder: 'Facoltativa, es. PAC', max: 200 });
  const cashBal = ctx.d.accountValue(st().accounts.find(a => a.id === hd.account)) - ctx.d.holdingsValue(st().accounts.find(a => a.id === hd.account));
  const cash = toggle('Muove la liquidità del conto', op ? op.cash : cashBal > 0, null, { hint: 'Acquisti e costi la tolgono, vendite e cedole la aggiungono' });
  const total = h('p.field-hint');
  const taxHint = h('p.field-hint');
  const useEst = h('button.link-btn', { type: 'button', hidden: true }, 'Usa la stima');
  const qtyF = field('Quantità', qty), priceF = field('Prezzo unitario', price), grossF = field('Importo', gross), feeF = field('Commissioni', fee);
  const taxF = h('div.field', h('label.field-label', { for: tax.input.id || (tax.input.id = 'tax-in') }, 'Imposta trattenuta'), tax, h('div.field-row', taxHint, useEst));
  const amtF = field('Importo netto', amount);
  let est = 0;
  const upd = () => {
    const tr = v.type === 'buy' || v.type === 'sell';
    qtyF.hidden = !tr; priceF.hidden = !tr; grossF.hidden = !tr; feeF.hidden = !tr; amtF.hidden = tr; taxF.hidden = v.type !== 'sell';
    amtF.querySelector('.field-label').textContent = v.type === 'div' ? 'Importo incassato (netto)' : 'Importo del costo';
    const q = qty.getValue() || 0, p = price.getValue() || 0, f = fee.getValue() || 0, t = v.type === 'sell' ? tax.getValue() || 0 : 0;
    total.textContent = tr && q && p ? `Totale ${v.type === 'buy' ? 'pagato' : 'incassato'}: ${formatNumber(v.type === 'buy' ? q * p + f : q * p - f - t, 2, 2)} ${cur}` : '';
    // stima dell'imposta sulla plusvalenza (costo medio alla data, aliquota del tipo di titolo)
    est = 0;
    if (v.type === 'sell' && q && p) {
      const before = position({ ...hd, ops: hd.ops.filter(o => o.id !== op?.id) }, isISODate(date.value) ? date.value : today());
      const gain = Math.min(q, before.qty) * (p - before.avg) - f;
      est = Math.max(0, gain) * (ASSET_CLASSES[hd.cls]?.tax ?? 26) / 100;
      taxHint.textContent = gain > 0 ? `Stima ${String(ASSET_CLASSES[hd.cls]?.tax ?? 26).replace('.', ',')}% sul guadagno: ${formatNumber(est, 2, 2)} ${cur}` : 'Nessun guadagno: di solito niente imposta';
    } else taxHint.textContent = 'Quella che il broker trattiene sul guadagno';
    useEst.hidden = !(est > 0);
  };
  // due valori tra quantità, prezzo e importo bastano: il terzo si calcola
  qty.input.addEventListener('input', () => { const q = qty.getValue(), p = price.getValue(); if (q && p) gross.input.value = numStr(q * p, 2); upd(); });
  price.input.addEventListener('input', () => { const q = qty.getValue(), p = price.getValue(); if (q && p) gross.input.value = numStr(q * p, 2); upd(); });
  gross.input.addEventListener('input', () => {
    const g = gross.getValue(), p = price.getValue(), q = qty.getValue();
    if (g && p) qty.input.value = numStr(g / p, 6);
    else if (g && q) price.input.value = numStr(g / q, 6);
    upd();
  });
  [fee.input, tax.input, date].forEach(i => i.addEventListener('input', upd));
  useEst.addEventListener('click', () => { tax.input.value = numStr(est, 2); upd(); });
  const typeSeg = segmented([{ value: 'buy', label: 'Acquisto' }, { value: 'sell', label: 'Vendita' }, { value: 'div', label: 'Cedola / dividendo' }, { value: 'fee', label: 'Costo' }], v.type, val => { v.type = val; upd(); }, { small: true });
  upd();
  const err = h('p.field-err', { hidden: true });
  const save = () => {
    const tr = v.type === 'buy' || v.type === 'sell';
    const q = qty.getValue(), p = price.getValue(), a = amount.getValue();
    if (tr && (!q || !p)) { err.textContent = 'Servono due tra quantità, prezzo e importo.'; err.hidden = false; return; }
    if (!tr && !a) { err.textContent = 'Serve l\'importo.'; err.hidden = false; return; }
    if (v.type === 'sell') {
      const owned = position({ ...hd, ops: hd.ops.filter(o => o.id !== op?.id) }, isISODate(date.value) ? date.value : today()).qty;
      if (q > owned + 1e-9) { err.textContent = `Alla data ne avevi solo ${formatNumber(owned, 6)}.`; err.hidden = false; return; }
    }
    A.saveOp(hd.id, { id: op?.id, type: v.type, date: isISODate(date.value) ? date.value : today(), qty: tr ? q : 0, price: tr ? p : 0, fee: tr ? fee.getValue() || 0 : 0, tax: v.type === 'sell' ? Math.abs(tax.getValue() || 0) : 0, amount: tr ? 0 : Math.abs(a), cash: cash.input.checked, note: note.value.trim() });
    toast('Operazione salvata', { kind: 'ok' });
    s.close(true);
  };
  const s = openSheet({
    title: isNew ? 'Nuova operazione' : 'Modifica operazione', subtitle: hd.name,
    body: h('form.stack', { onsubmit: e => { e.preventDefault(); save(); } }, typeSeg, h('div.grid-3', qtyF, priceF, grossF), h('div.grid-2', feeF, taxF), amtF, total, h('div.grid-2', field('Data', date), field('Nota', note)), cash, err, h('button', { type: 'submit', hidden: true })),
    footer: [
      !isNew ? twoTap('Elimina', () => { A.deleteOp(hd.id, op.id); s.close(true); undoToast('Operazione eliminata'); }, { iconName: 'trash' }) : null,
      h('button.btn.btn-primary', { type: 'button', onclick: save }, 'Salva'),
    ],
  });
}

/** Sceglie il titolo e apre la nuova operazione. */
export function pickHoldingOp(ctx) {
  const list = st().holdings.filter(x => { const a = st().accounts.find(y => y.id === x.account); return a && !a.archived; })
    .map(x => ({ hd: x, qty: position(x).qty })).sort((a, b) => (b.qty > 0) - (a.qty > 0) || a.hd.name.localeCompare(b.hd.name));
  if (!list.length) { holdingEditor(ctx); return; }
  if (list.length === 1) { opEditor(ctx, list[0].hd); return; }
  const s = openSheet({
    title: 'Nuova operazione', subtitle: 'Su quale titolo?', size: 'sm',
    body: h('div.rows', list.map(({ hd, qty }) => h('button.row', { type: 'button', onclick: () => { s.close(true); opEditor(ctx, hd); } },
      h('span.row-main', h('span.row-title', hd.name), h('span.row-sub', [hd.symbol, qty > 0 ? `${formatNumber(qty, 6)} quote` : 'posizione chiusa'].filter(Boolean).join(' · '))), icon('chevR', 18)))),
  });
}

/* ═══ PAC del mese: più acquisti alla stessa data ═══════════════════════ */
export function pacEditor(ctx) {
  const state = st();
  const lastBuy = hd => [...hd.ops].filter(o => o.type === 'buy').sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.created - a.created))[0];
  const items = state.holdings.filter(x => { const a = state.accounts.find(y => y.id === x.account); return a && !a.archived && position(x).qty > 0; })
    .map(hd => ({ hd, last: lastBuy(hd) }))
    .sort((a, b) => (b.last?.date || '').localeCompare(a.last?.date || '') || a.hd.name.localeCompare(b.hd.name));
  if (!items.length) { toast('Aggiungi prima i titoli che hai: il PAC li ricompra.'); holdingEditor(ctx); return; }
  const date = dateInput(today());
  const recent = items[0].last?.date;
  const rows = items.map(({ hd, last }) => {
    const sym = CURRENCIES[hd.currency]?.symbol || hd.currency;
    // preselezionati i titoli comprati nell'ultimo PAC (entro 20 giorni dall'acquisto più recente)
    const on = !!(last && recent && last.date >= addDays(recent, -20));
    const chk = h('input', { type: 'checkbox', checked: on, 'aria-label': hd.name });
    const amt = numberInput({ value: last ? numStr(roundish(last.qty * last.price), 2) : '', placeholder: '0,00', suffix: sym });
    const price = numberInput({ value: hd.price ? numStr(hd.price, 6) : '', placeholder: '0,00', suffix: sym });
    const fee = numberInput({ value: last?.fee ? numStr(last.fee, 2) : '', placeholder: '0', suffix: sym });
    const out = h('p.field-hint');
    const box = h('div.subcard.pac-item', { class: on ? '' : 'off' },
      h('label.pac-head', chk, h('span.pac-name', hd.name), h('span.muted', hd.symbol || '')),
      h('div.grid-3', field('Importo', amt), field('Prezzo', price), field('Commissioni', fee)), out);
    const upd = () => {
      const a = amt.getValue(), p = price.getValue();
      out.textContent = a && p ? `≈ ${formatNumber(a / p, 6)} quote · totale ${formatNumber(a + (fee.getValue() || 0), 2, 2)} ${hd.currency}` : 'Scrivi importo e prezzo';
      box.classList.toggle('off', !chk.checked);
    };
    [amt.input, price.input, fee.input, chk].forEach(i => i.addEventListener('input', upd));
    chk.addEventListener('change', upd);
    upd();
    return { hd, last, chk, amt, price, fee, box };
  });
  const cashDefault = items.some(x => x.last?.cash);
  const cash = toggle('Pagato con la liquidità del conto', cashDefault, null, { hint: 'Spento se i soldi arrivano da fuori (es. addebito dal conto corrente che registri a parte)' });
  const note = textInput({ value: 'PAC', max: 200 });
  const err = h('p.field-err', { hidden: true });
  const save = () => {
    const d = isISODate(date.value) ? date.value : today();
    const sel = rows.filter(r => r.chk.checked);
    if (!sel.length) { err.textContent = 'Scegli almeno un titolo.'; err.hidden = false; return; }
    const bad = sel.find(r => !r.amt.getValue() || !r.price.getValue());
    if (bad) { err.textContent = `Per ${bad.hd.name} servono importo e prezzo.`; err.hidden = false; return; }
    A.saveOps(sel.map(r => ({ holding: r.hd.id, op: { type: 'buy', date: d, qty: Math.round(r.amt.getValue() / r.price.getValue() * 1e6) / 1e6, price: r.price.getValue(), fee: r.fee.getValue() || 0, amount: 0, cash: cash.input.checked, note: note.value.trim() } })));
    s.close(true);
    undoToast(sel.length === 1 ? 'Acquisto registrato' : `${sel.length} acquisti registrati`);
  };
  const s = openSheet({
    title: 'Registra il PAC', subtitle: 'Più acquisti alla stessa data, in un colpo solo',
    body: h('form.stack', { onsubmit: e => { e.preventDefault(); save(); } },
      h('div.grid-2', field('Data', date), field('Nota', note)),
      h('p.field-hint', 'Importi e commissioni sono quelli dell\'ultimo acquisto; il prezzo è l\'ultimo che conosco: correggilo con quello dell\'esecuzione.'),
      ...rows.map(r => r.box), cash, err, h('button', { type: 'submit', hidden: true })),
    footer: [h('button.btn.btn-primary', { type: 'button', onclick: save }, 'Registra')],
  });
}

/* ═══ Imposta di bollo (e altre spese del conto titoli) ═════════════════ */
export function bolloEditor(ctx) {
  const state = st();
  const accs = accountOptions({ filter: a => hasHoldings(a) });
  if (!accs.length) { toast('Crea prima un conto investimenti.'); accountEditor(ctx, null, { type: 'broker' }); return; }
  const v = { account: accs[0].value };
  const accSel = selectInput(accs, v.account, val => { v.account = val; amt.setCurrency(state.accounts.find(a => a.id === val)?.currency || 'EUR'); });
  const amt = amountInput({ currency: state.accounts.find(a => a.id === v.account)?.currency || 'EUR', autofocus: true });
  const date = dateInput(today());
  const period = textInput({ placeholder: 'Es. 01/07 – 30/09/2026', max: 60 });
  const err = h('p.field-err', { hidden: true });
  const cat = state.categories.find(c => c.id === 'c-tasse') || state.categories.find(c => c.kind === 'expense' && /tass|impost/i.test(c.name));
  const save = () => {
    const c = amt.getCents();
    if (!c) { err.textContent = 'Serve l\'importo.'; err.hidden = false; return; }
    A.saveTx({ kind: 'expense', date: isISODate(date.value) ? date.value : today(), amount: c, account: v.account, category: cat?.id || null, payee: 'Imposta di bollo', note: period.value.trim() });
    s.close(true);
    undoToast('Imposta di bollo registrata');
  };
  const s = openSheet({
    title: 'Imposta di bollo', subtitle: 'Quella che il broker toglie dalla liquidità', size: 'sm',
    body: h('form.stack', { onsubmit: e => { e.preventDefault(); save(); } }, field('Importo', amt), field('Conto', accSel), h('div.grid-2', field('Data', date), field('Periodo', period)),
      h('p.field-hint', 'La tolgo dalla liquidità del conto, come fa il broker, e la conto in "Tasse e costi" degli investimenti.'), err, h('button', { type: 'submit', hidden: true })),
    footer: [h('button.btn.btn-primary', { type: 'button', onclick: save }, 'Salva')],
  });
}

/* ═══ Categoria ═════════════════════════════════════════════════════════ */
export function categoryEditor(cat = null, kind = 'expense', onSaved) {
  const state = st();
  const isNew = !cat;
  const name = textInput({ value: cat?.name || '', placeholder: 'Es. Corsi di musica', autofocus: true, max: 50 });
  const emoji = emojiButton(cat?.emoji || '🏷️');
  const groups = [...new Set(state.categories.filter(c => c.kind === (cat?.kind || kind)).map(c => c.group))];
  const group = textInput({ value: cat?.group || '', placeholder: 'Es. Casa, Tempo libero', list: 'groups-dl', max: 40 });
  const dl = h('datalist', { id: 'groups-dl' }, groups.map(g => h('option', { value: g })));
  const save = () => {
    if (!name.value.trim()) return;
    const id = A.saveCategory({ id: cat?.id, name: name.value.trim(), emoji: emoji.value, kind: cat?.kind || kind, group: group.value.trim() || 'Altro' });
    s.close(true);
    onSaved?.(id);
  };
  const s = openSheet({
    title: isNew ? 'Nuova categoria' : 'Modifica categoria', size: 'sm',
    body: h('form.stack', { onsubmit: e => { e.preventDefault(); save(); } }, h('div.name-row', emoji, field('Nome', name, { wide: true })), field('Gruppo', group), dl, h('button', { type: 'submit', hidden: true })),
    footer: [
      !isNew ? twoTap('Elimina', () => { A.deleteCategory(cat.id); s.close(true); undoToast('Categoria eliminata: i movimenti restano senza categoria'); }, { iconName: 'trash' }) : null,
      h('button.btn.btn-primary', { type: 'button', onclick: save }, 'Salva'),
    ],
  });
}

export { accName, catLabel, moneyText };
