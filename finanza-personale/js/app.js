/* [RH] Finance — avvio, navigazione, blocco automatico, ricerca rapida. */

import { h, icon, $, clear } from './ui/dom.js';
import { toast, openSheet, closeAllSheets, topSheet, promptDialog } from './ui/components.js';
import { ui } from './ui/fmt.js';
import * as session from './session.js';
import { S, CLOUD_LABEL, cloudLine } from './session.js';
import { runAutoPost, tidyCategories } from './actions.js';
import { formatDate } from './core/dates.js';
import { applyTheme } from './ui/theme.js';
import { enhanceTables } from './ui/tables.js';

import dashboard from './views/dashboard.js';
import transactions from './views/transactions.js';
import accounts from './views/accounts.js';
import networth from './views/networth.js';
import budget from './views/budget.js';
import recurring from './views/recurring.js';
import goals from './views/goals.js';
import investments, { autoPrices } from './views/investments.js';
import yearly from './views/yearly.js';
import reports from './views/reports.js';
import sims from './views/sims.js';
import markets from './views/markets.js';
import settings from './views/settings.js';
import { renderGate, handleAuthLanding } from './views/gate.js';
import { openPalette } from './views/palette.js';
import { txEditor } from './views/editors.js';

const NAV = [
  { path: '', view: dashboard, label: 'Panoramica', icon: 'home' },
  { group: 'Gestione' },
  { path: 'movimenti', view: transactions, label: 'Movimenti', icon: 'list' },
  { path: 'entrate-uscite', view: yearly, label: 'Entrate e uscite', icon: 'table' },
  { path: 'conti', view: accounts, label: 'Conti', icon: 'wallet' },
  { path: 'patrimonio', view: networth, label: 'Patrimonio', icon: 'layers' },
  { path: 'investimenti', view: investments, label: 'Investimenti', icon: 'trend' },
  { group: 'Pianificazione' },
  { path: 'budget', view: budget, label: 'Budget', icon: 'pie' },
  { path: 'scadenze', view: recurring, label: 'Scadenze', icon: 'calendar' },
  { path: 'obiettivi', view: goals, label: 'Obiettivi', icon: 'target' },
  { group: 'Strumenti' },
  { path: 'analisi', view: reports, label: 'Analisi', icon: 'chart' },
  { path: 'simulazioni', view: sims, label: 'Simulazioni', icon: 'calc' },
  { path: 'mercati', view: markets, label: 'Mercati', icon: 'globe' },
];
const SETTINGS = { path: 'impostazioni', view: settings, label: 'Impostazioni', icon: 'settings' };
const ROUTES = [...NAV.filter(n => n.view), SETTINGS];
const TABS = ['', 'movimenti', '+', 'conti', 'menu'];

/* ─── Tema (applicato anche prima, da boot.js) ─── */
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(S.state?.settings.theme || document.documentElement.dataset.theme));

/* ─── Percorsi: #/movimenti?conto=xyz ─── */
export function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [p, q = ''] = raw.split('?');
  const parts = p.split('/').filter(Boolean).map(decodeURIComponent);
  return { path: parts[0] || '', params: parts.slice(1), query: Object.fromEntries(new URLSearchParams(q)) };
}
export function go(path) {
  const target = '#/' + path.replace(/^\/+/, '');
  if (location.hash === target) render(); else location.hash = target;
}

/* ─── Guscio ─── */
const app = $('#app');
let shell = null;
let currentPath = null;

function saveDot() {
  const st = S.saveStatus, c = S.cloud;
  let cls, label, short;
  if (S.mode === 'demo') { cls = 'demo'; label = 'Prova: non si salva'; short = 'Prova'; }
  else if (st === 'error') { cls = 'error'; label = 'Salvataggio non riuscito'; short = 'Non salvato'; }
  else if (c.linked && c.status !== 'off') { cls = c.status === 'ok' ? 'saved' : c.status === 'syncing' ? 'saving' : c.status === 'offline' ? 'offline' : 'error'; label = CLOUD_LABEL[c.status] || ''; short = { ok: 'Sincronizzato', syncing: 'Sincronizzo…', offline: 'Offline' }[c.status] || 'Non sincronizzato'; }
  else { cls = st; label = st === 'saving' || st === 'pending' ? 'Salvataggio…' : 'Salvato e cifrato su questo dispositivo'; short = st === 'saving' || st === 'pending' ? 'Salvo…' : 'Salvato'; }
  return [h('span.save-dot', { class: 'sd-' + cls, title: label, 'aria-label': label }), h('span.save-t', { title: label, 'aria-hidden': 'true' }, short)];
}

/* barra laterale comprimibile (icone con il nome sotto): la scelta resta su questo dispositivo.
   Tra 760 e 1100 px di larghezza è sempre compressa (html.side-auto); html.side-mini = compressa davvero. */
const mqSide = matchMedia('(min-width: 760px) and (max-width: 1100px)');
let sidePref = false;
try { sidePref = localStorage.getItem('rhf-side') === 'mini'; } catch { /* navigazione privata */ }
function applySide() {
  const R = document.documentElement;
  R.classList.toggle('side-auto', mqSide.matches);
  R.classList.toggle('side-mini', mqSide.matches || sidePref);
  const b = document.querySelector('.side-mini-btn');
  if (b) { const t = sidePref ? 'Allarga la barra laterale ([)' : 'Comprimi la barra laterale ([)'; b.title = t; b.setAttribute('aria-label', t.replace(/ \(\[\)$/, '')); }
}
function toggleSide() {
  if (mqSide.matches) return;
  sidePref = !sidePref;
  try { localStorage.setItem('rhf-side', sidePref ? 'mini' : ''); } catch { /* navigazione privata */ }
  applySide();
  setTimeout(() => dispatchEvent(new Event('resize')), 250);     // le tabelle che si adattano alla larghezza
}
mqSide.addEventListener?.('change', applySide);
applySide();
addEventListener('rhf-rerender', () => render());

/* ─── Annulla e Ripeti (D: "metti anche undo e avanti"; "con mac è cmd shift z"): pulsanti in alto,
   Cmd+Z / Cmd+Maiusc+Z su Mac, Ctrl+Z / Ctrl+Y (o Ctrl+Maiusc+Z) su Windows; anche nel menu del profilo ─── */
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const KEY_UNDO = MAC ? '⌘Z' : 'Ctrl+Z', KEY_REDO = MAC ? '⇧⌘Z' : 'Ctrl+Y';
function doUndo() {
  const l = session.undo();
  if (l) toast(`Annullato: ${l}`, { action: session.canRedo() ? { label: 'Ripeti', fn: doRedo } : null });
  else toast('Niente da annullare');
}
function doRedo() {
  const l = session.redo();
  if (l) toast(`Rifatto: ${l}`, { action: { label: 'Annulla', fn: doUndo } });
  else toast('Niente da ripetere');
}
function undoButtons() {
  const u = session.canUndo(), r = session.canRedo();
  return [
    h('button.icon-btn.only-desktop.hist-btn', { type: 'button', disabled: !u, onclick: doUndo, 'aria-label': 'Annulla', title: u ? `Annulla: ${session.undoLabel()} (${KEY_UNDO})` : 'Niente da annullare' }, icon('undo', 20)),
    h('button.icon-btn.only-desktop.hist-btn', { type: 'button', disabled: !r, onclick: doRedo, 'aria-label': 'Ripeti', title: r ? `Ripeti: ${session.redoLabel()} (${KEY_REDO})` : 'Niente da ripetere' }, icon('redo', 20)),
  ];
}

/* ─── Profilo in alto a destra (D: "le impostazioni puoi metterle anche in alto a destra se crei tipo un
   cerchio con le iniziali del profilo e se clicchi da lì puoi andare nelle impostazioni generali, oltre a
   quelle della mail dell'account"): iniziali del nome (o dell'email), menu con le impostazioni, l'account,
   nascondi importi e blocca. ─── */
function initials() {
  const n = (S.state?.settings?.name || '').trim();
  if (n) { const w = n.split(/\s+/).filter(Boolean); return ((w[0][0] || '') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase(); }
  return (S.cloud?.email || '').slice(0, 1).toUpperCase();
}
function profileBtn(on = false) {
  const ini = initials();
  return h('button.prof-btn', { type: 'button', id: 'prof-btn', class: on ? 'on' : '', 'aria-label': 'Profilo e impostazioni', title: 'Profilo e impostazioni', 'aria-haspopup': 'menu',
    onclick: e => { e.stopPropagation(); if (profPop) closeProfile(); else openProfile(e.currentTarget); } }, ini ? h('span', ini) : icon('user', 18));
}
let profPop = null;
function closeProfile() { if (profPop) { profPop.remove(); profPop = null; } }
function openProfile(btn) {
  const name = (S.state?.settings?.name || '').trim();
  const ini = initials();
  const item = (ic, label, fn, key) => h('button.prof-item', { type: 'button', role: 'menuitem', onclick: () => { closeProfile(); fn(); } }, icon(ic, 18), h('span', label), key ? h('kbd', key) : null);
  const where = S.mode === 'demo' ? 'Prova con dati di esempio' : S.cloud.linked ? S.cloud.email : 'Solo su questo dispositivo';
  profPop = h('div.prof-pop', { role: 'menu', 'aria-label': 'Profilo e impostazioni' },
    h('div.prof-head', h('span.prof-av', ini ? h('span', ini) : icon('user', 20)),
      h('div.prof-id', h('b', name || 'Il tuo profilo'), h('span', where), h('span.prof-status', ...saveDot()))),
    h('div.prof-sep'),
    item('settings', 'Impostazioni', () => go('impostazioni')),
    item('user', 'Profilo', () => go('impostazioni?sez=profile')),
    S.mode === 'demo' ? null : item('refresh', S.cloud.linked ? 'Account e sincronizzazione' : 'Accedi o crea un account', () => go('impostazioni?sez=account')),
    item('sun', 'Aspetto e colori', () => go('impostazioni?sez=look')),
    item('download', 'Backup e dati', () => go('impostazioni?sez=backup')),
    item('shield', 'Sicurezza', () => go('impostazioni?sez=security')),
    h('div.prof-sep'),
    session.canUndo() ? item('undo', `Annulla: ${session.undoLabel()}`, doUndo, KEY_UNDO) : null,
    session.canRedo() ? item('redo', `Ripeti: ${session.redoLabel()}`, doRedo, KEY_REDO) : null,
    item(ui.privacy ? 'eye' : 'eyeOff', ui.privacy ? 'Mostra gli importi' : 'Nascondi gli importi', togglePrivacy, 'H'),
    S.mode === 'demo' ? item('logout', 'Esci dalla prova', () => session.lock()) : item('lock', 'Blocca ora', () => session.lock(), 'L'));
  document.body.append(profPop);
  const r = btn.getBoundingClientRect();
  profPop.style.top = (r.bottom + 8) + 'px';
  profPop.style.right = Math.max(8, innerWidth - r.right) + 'px';
  profPop.querySelector('.prof-item')?.focus();
}
addEventListener('pointerdown', e => { if (profPop && !profPop.contains(e.target) && !e.target.closest?.('#prof-btn')) closeProfile(); }, true);
addEventListener('keydown', e => { if (e.key === 'Escape') closeProfile(); });
addEventListener('hashchange', closeProfile);

function buildShell() {
  const nav = h('nav.side-nav', { 'aria-label': 'Sezioni' },
    NAV.map(n => n.group
      ? h('div.side-group', { role: 'presentation' }, h('span', n.group))
      : h('a.side-link', { href: '#/' + n.path, dataset: { path: n.path }, title: n.label }, icon(n.icon, 20), h('span', n.label))));
  const side = h('aside.side',
    h('a.brand', { href: '#/', 'aria-label': '[RH] Finance, panoramica' }, h('img.brand-ic', { src: 'icons/mark-192.png', alt: '', width: 30, height: 30 }), h('span.brand-name', '[RH]', h('b', ' Finance'))),
    h('button.side-search', { type: 'button', onclick: () => openPalette(ctxBase()), title: 'Cerca o vai a…' }, icon('search', 18), h('span', 'Cerca o vai a…'), h('span.mini-l', 'Cerca'), h('kbd', navigator.platform?.includes('Mac') ? '⌘K' : 'Ctrl K')),
    nav,
    // in fondo solo "comprimi" e lo stato del salvataggio: impostazioni, nascondi importi e blocca
    // stanno nel cerchio del profilo in alto a destra (così la barra entra sempre tutta)
    h('div.side-foot',
      h('div.side-tools',
        h('button.icon-btn.side-mini-btn', { type: 'button', onclick: toggleSide, 'aria-label': sidePref ? 'Allarga la barra laterale' : 'Comprimi la barra laterale', title: sidePref ? 'Allarga la barra laterale ([)' : 'Comprimi la barra laterale ([)' }, icon('sidebar', 20)),
        h('span.side-save', { id: 'side-save' }, saveDot()))));
  const top = h('header.topbar',
    h('div.top-titles', h('h1.top-title', { id: 'top-title' }), h('p.top-sub', { id: 'top-sub' })),
    h('div.top-actions', { id: 'top-actions' }));
  const banners = h('div.banners', { id: 'banners' });
  const view = h('div.view', { id: 'view', tabindex: '-1' });
  const main = h('main.main', { id: 'main' }, top, banners, view);
  const tabbar = h('nav.tabbar', { 'aria-label': 'Sezioni principali' },
    h('div.tab-capsule', TABS.map(t => {
      if (t === '+') return h('button.tab-add', { type: 'button', 'aria-label': 'Nuovo movimento', onclick: () => txEditor(ctxBase()) }, icon('plus', 26));
      if (t === 'menu') return h('button.tab', { type: 'button', dataset: { path: 'menu' }, onclick: openMenu }, icon('menu', 22), h('span', 'Altro'));
      const n = ROUTES.find(r => r.path === t);
      return h('a.tab', { href: '#/' + t, dataset: { path: t } }, icon(n.icon, 22), h('span', t === '' ? 'Home' : n.label));
    })));
  shell = h('div.shell', side, main, tabbar);
  return shell;
}

function openMenu() {
  const items = [...ROUTES.filter(r => !TABS.includes(r.path))];
  const s = openSheet({
    title: 'Tutte le sezioni', size: 'sm',
    body: h('div.menu-grid',
      items.map(r => h('a.menu-tile', { href: '#/' + r.path, onclick: () => s.close(true) }, h('span.menu-ic', icon(r.icon, 22)), h('span', r.label))),
      h('button.menu-tile', { type: 'button', onclick: () => { s.close(true); togglePrivacy(); } }, h('span.menu-ic', icon(ui.privacy ? 'eye' : 'eyeOff', 22)), h('span', ui.privacy ? 'Mostra importi' : 'Nascondi importi')),
      h('button.menu-tile', { type: 'button', onclick: () => { s.close(true); session.lock(); } }, h('span.menu-ic', icon('lock', 22)), h('span', 'Blocca'))),
  });
}

async function reloginDialog() {
  const ok = await promptDialog({
    title: 'Accedi di nuovo', label: 'Password', type: 'password', autocomplete: 'current-password', confirm: 'Accedi',
    message: `Account ${S.cloud.email}.`,
    validate: async v => { try { await session.relogin(v); return ''; } catch (e) { return e?.message || String(e); } },
  });
  if (ok) toast('Di nuovo collegato', { kind: 'ok' });
}

export function togglePrivacy() {
  ui.privacy = !ui.privacy;
  toast(ui.privacy ? 'Importi nascosti' : 'Importi visibili');
  render();
}

function ctxBase() {
  return { S, st: S.state, d: session.derived(), go, rerender: render, route: parseRoute() };
}

function banners(ctx) {
  const out = [];
  if (S.mode === 'demo') out.push(h('div.banner.banner-demo.banner-slim', icon('sparkle', 18), h('span', h('b', 'Prova'), h('span.only-wide', ' con dati di esempio'), ': niente viene salvato.'), h('button.btn.btn-sm', { type: 'button', onclick: () => session.lock() }, 'Esci')));
  if (S.vaultWarning) out.push(h('div.banner.banner-warn', icon('alert', 18), h('span', S.vaultWarning), h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: () => { S.vaultWarning = ''; render(); } }, 'Ok')));
  if (S.mode === 'open' && S.cloud.linked && S.cloud.status === 'login') out.push(h('div.banner.banner-warn', icon('refresh', 18), h('span', h('b', 'Sincronizzazione ferma: '), 'la sessione dell\'account è scaduta. I dati restano qui e si sincronizzano appena accedi.'), h('button.btn.btn-sm', { type: 'button', onclick: () => reloginDialog() }, 'Accedi')));
  if (S.mode === 'open' && S.cloud.linked && S.cloud.status === 'error' && S.cloud.error) out.push(h('div.banner.banner-warn', icon('alert', 18), h('span', h('b', 'Non sincronizzato: '), S.cloud.error), h('button.btn.btn-sm', { type: 'button', onclick: () => session.cloudSync() }, 'Riprova')));
  if (S.saveStatus === 'error') out.push(h('div.banner.banner-err', icon('alert', 18), h('span', h('b', 'Non riesco a salvare: '), S.saveError, '. Riprovo da solo; intanto scarica un backup.'), h('button.btn.btn-sm', { type: 'button', onclick: () => go('impostazioni') }, 'Backup')));
  if (S.mode === 'open') {
    const st = ctx.st;
    const days = st.settings.backupDays;
    const since = st.meta.lastBackup ? (Date.now() - st.meta.lastBackup) / 864e5 : (Date.now() - st.meta.created) / 864e5;
    if (days && st.meta.changesSinceBackup >= 5 && since >= days) {
      out.push(h('div.banner', icon('shield', 18), h('span', st.meta.lastBackup ? `Ultimo backup il ${formatDate(new Date(st.meta.lastBackup).toISOString().slice(0, 10))}. ` : 'Non hai ancora fatto un backup. ', 'I dati sono solo su questo dispositivo: tienine una copia cifrata.'),
        h('button.btn.btn-sm', { type: 'button', onclick: () => go('impostazioni?backup=1') }, 'Fai il backup')));
    }
  }
  return out;
}

/* ─── Disegno della pagina ─── */
let rendering = false;
export function render() {
  if (rendering) return;
  rendering = true;
  try { doRender(); } finally { rendering = false; }
}

function doRender() {
  const root = document.documentElement;
  root.classList.toggle('privacy', ui.privacy);
  if (S.mode !== 'open' && S.mode !== 'demo') {
    shell = null; currentPath = null;
    closeAllSheets();
    clear(app).append(renderGate({ S, session, onOpened: afterOpen, applyTheme }));
    return;
  }
  if (!shell || !shell.isConnected) { clear(app).append(buildShell()); }
  const r = parseRoute();
  const route = ROUTES.find(x => x.path === r.path) || ROUTES[0];
  const ctx = { ...ctxBase(), route: r };
  autoPrices(ctx);    // prezzi dei titoli aggiornati da soli, se consentito (al massimo ogni 3 ore)
  // menu attivo
  shell.querySelectorAll('[data-path]').forEach(a => {
    const on = a.dataset.path === route.path || (a.dataset.path === 'menu' && !TABS.includes(route.path));
    a.classList.toggle('on', on);
    if (a.tagName === 'A') a.setAttribute('aria-current', on ? 'page' : 'false');
  });
  const viewEl = $('#view');
  const changed = currentPath !== location.hash;
  const y = changed ? 0 : window.scrollY;
  let node, title, sub, actions;
  try {
    const out = route.view.render(ctx);
    node = out.node; title = out.title ?? route.label; sub = out.sub || ''; actions = out.actions || [];
  } catch (e) {
    console.error(e);
    node = h('div.card.error-card', h('h3', 'Qualcosa non ha funzionato in questa pagina'), h('p.muted', String(e?.message || e)), h('button.btn', { type: 'button', onclick: () => go('') }, 'Torna alla panoramica'));
    title = route.label; actions = [];
  }
  $('#top-title').textContent = title;
  $('#top-sub').textContent = sub;
  document.title = (route.path ? title + ' · ' : '') + '[RH] Finance';
  $('#top-actions').replaceChildren(
    ...actions,
    h('button.icon-btn.only-mobile', { type: 'button', 'aria-label': 'Cerca', onclick: () => openPalette(ctx) }, icon('search', 20)),
    ...undoButtons(),
    h('button.icon-btn.only-desktop', { type: 'button', 'aria-label': ui.privacy ? 'Mostra gli importi' : 'Nascondi gli importi', title: 'Nascondi/mostra importi (H)', onclick: togglePrivacy }, icon(ui.privacy ? 'eyeOff' : 'eye', 20)),
    h('button.btn.btn-primary.only-desktop', { type: 'button', onclick: () => txEditor(ctx), title: 'Nuovo movimento (N)' }, icon('plus', 18), h('span', 'Movimento')),
    profileBtn(route.path === 'impostazioni'));
  closeProfile();
  $('#banners').replaceChildren(...banners(ctx));
  viewEl.replaceChildren(node);
  viewEl.dataset.route = route.path || 'home';
  enhanceTables(viewEl);
  updateSave();
  if (changed) {
    currentPath = location.hash;
    viewEl.classList.remove('enter'); void viewEl.offsetWidth; viewEl.classList.add('enter');
    window.scrollTo(0, 0);
  } else window.scrollTo(0, y);
}

function updateSave() {
  const el = $('#side-save');
  if (el) el.replaceChildren(...saveDot());
}
/** Stato della sincronizzazione: aggiorna solo il pallino, gli avvisi e la riga nelle Impostazioni (mai tutta la pagina). */
function updateCloud() {
  updateSave();
  if (S.mode !== 'open' || !shell) return;
  $('#banners')?.replaceChildren(...banners(ctxBase()));
  const st = $('#cloud-status');
  if (st) st.textContent = cloudLine();
}


/* ─── Dopo lo sblocco ─── */
function afterOpen() {
  ui.privacy = !!S.state.settings.hideAmounts;
  ui.base = S.state.settings.currency;
  applyTheme(S.state.settings.theme, S.state.settings.look);
  if (S.mode === 'open') { const n = tidyCategories(); if (n) toast('Categorie sistemate: doppioni uniti e statistiche (es. "Liquidità a fine 2025") tolte dalle entrate', { kind: 'ok' }); }
  lastActivity = Date.now();
  if (S.mode === 'open') {
    const n = runAutoPost();
    if (n) toast(`${n} ${n === 1 ? 'scadenza registrata' : 'scadenze registrate'} in automatico`, { kind: 'ok' });
    session.snapshot();
  }
  if (!location.hash || location.hash === '#') history.replaceState(null, '', '#/');
  render();
  // lo stato di salvataggio si legge da S
}

session.on(what => {
  if (what === 'mode') {
    if (S.mode === 'open' || S.mode === 'demo') afterOpen();
    else { ui.privacy = false; render(); if (S.lockReason) setTimeout(() => toast(S.lockReason), 50); }
  } else if (what === 'data') {
    if (S.state) { ui.base = S.state.settings.currency; }
    render();
  } else if (what === 'save') updateSave();
  else if (what === 'cloud') updateCloud();
});

addEventListener('hashchange', () => { if (topSheet()) closeAllSheets(); render(); });
document.addEventListener('rhf-gate', () => render());

/* ─── Blocco automatico e velo quando l'app va in secondo piano ─── */
let lastActivity = Date.now(), hiddenAt = 0;
const bump = () => { lastActivity = Date.now(); };
for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'input']) addEventListener(ev, bump, { passive: true, capture: true });
const lockAfter = () => (S.state ? S.state.settings.lockMinutes : 5) * 60000;
let autoDay = '';
setInterval(() => {
  // a mezzanotte, con l'app aperta, registra le scadenze automatiche del nuovo giorno
  if (S.mode === 'open') {
    const day = new Date().toDateString();
    if (autoDay && autoDay !== day) runAutoPost();
    autoDay = day;
  }
  if (S.mode !== 'open') return;
  const ms = lockAfter();
  if (ms > 0 && Date.now() - lastActivity > ms) session.lock(`Bloccata dopo ${ms / 60000} ${ms === 60000 ? 'minuto' : 'minuti'} senza attività.`);
}, 10000);
document.addEventListener('visibilitychange', () => {
  const root = document.documentElement;
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); root.classList.add('veiled'); }
  else {
    const ms = lockAfter();
    if (S.mode === 'open' && ms > 0 && hiddenAt && Date.now() - hiddenAt > ms) session.lock('Bloccata mentre l\'app era in secondo piano.');
    else lastActivity = Date.now();
    setTimeout(() => root.classList.remove('veiled'), 30);
  }
});

/* ─── Scorciatoie da tastiera ─── */
addEventListener('keydown', e => {
  if (S.mode !== 'open' && S.mode !== 'demo') return;
  const typing = e.target.closest?.('input,textarea,select,[contenteditable]');
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (!topSheet()) openPalette(ctxBase()); return; }
  // Annulla / Ripeti (dentro una casella di testo resta l'annulla del testo)
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !typing && !topSheet() && (e.key.toLowerCase() === 'z' || (!MAC && e.key.toLowerCase() === 'y'))) {
    e.preventDefault();
    if (e.key.toLowerCase() === 'y' || e.shiftKey) doRedo(); else doUndo();
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || topSheet()) return;
  const k = e.key.toLowerCase();
  if (k === 'n') { e.preventDefault(); txEditor(ctxBase()); }
  else if (k === 'l') { e.preventDefault(); session.lock(); }
  else if (k === 'h') { e.preventDefault(); togglePrivacy(); }
  else if (k === '/') { e.preventDefault(); openPalette(ctxBase()); }
  else if (k === '[') { e.preventDefault(); toggleSide(); }
});

/* ─── Offline: il service worker tiene una copia dell'app ─── */
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !/claude/.test(location.hostname)) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { scope: './' }).then(reg => {
      const ping = () => reg.active?.postMessage({ t: 'refill' });
      if (reg.active) ping(); else navigator.serviceWorker.ready.then(ping);
    }).catch(() => { /* senza offline va bene lo stesso */ });
  });
}

/* ─── Avvio ─── */
applyTheme(document.documentElement.dataset.theme);
handleAuthLanding();
session.boot();
render();
