/* Analisi Finanziarie — avvio, navigazione, blocco automatico, ricerca rapida. */

import { h, icon, $, clear } from './ui/dom.js';
import { toast, openSheet, closeAllSheets, topSheet } from './ui/components.js';
import { ui } from './ui/fmt.js';
import * as session from './session.js';
import { S } from './session.js';
import { runAutoPost } from './actions.js';
import { formatDate } from './core/dates.js';
import { applyTheme } from './ui/theme.js';

import dashboard from './views/dashboard.js';
import transactions from './views/transactions.js';
import accounts from './views/accounts.js';
import networth from './views/networth.js';
import budget from './views/budget.js';
import recurring from './views/recurring.js';
import goals from './views/goals.js';
import investments from './views/investments.js';
import reports from './views/reports.js';
import sims from './views/sims.js';
import markets from './views/markets.js';
import settings from './views/settings.js';
import { renderGate } from './views/gate.js';
import { openPalette } from './views/palette.js';
import { txEditor } from './views/editors.js';

const NAV = [
  { path: '', view: dashboard, label: 'Panoramica', icon: 'home' },
  { group: 'Gestione' },
  { path: 'movimenti', view: transactions, label: 'Movimenti', icon: 'list' },
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
  const st = S.saveStatus;
  const label = S.mode === 'demo' ? 'Prova: non si salva' : st === 'error' ? 'Salvataggio non riuscito' : st === 'saving' || st === 'pending' ? 'Salvataggio…' : 'Salvato e cifrato';
  return h('span.save-dot', { class: 'sd-' + (S.mode === 'demo' ? 'demo' : st), title: label, 'aria-label': label });
}

function buildShell() {
  const nav = h('nav.side-nav', { 'aria-label': 'Sezioni' },
    NAV.map(n => n.group
      ? h('div.side-group', n.group)
      : h('a.side-link', { href: '#/' + n.path, dataset: { path: n.path } }, icon(n.icon, 20), h('span', n.label))));
  const side = h('aside.side',
    h('a.brand', { href: '#/', 'aria-label': 'Analisi Finanziarie, panoramica' }, h('img.brand-ic', { src: 'icons/icon.svg', alt: '', width: 30, height: 30 }), h('span.brand-name', 'Analisi', h('b', ' Finanziarie'))),
    h('button.side-search', { type: 'button', onclick: () => openPalette(ctxBase()) }, icon('search', 18), h('span', 'Cerca o vai a…'), h('kbd', navigator.platform?.includes('Mac') ? '⌘K' : 'Ctrl K')),
    nav,
    h('div.side-foot',
      h('a.side-link', { href: '#/impostazioni', dataset: { path: 'impostazioni' } }, icon('settings', 20), h('span', 'Impostazioni')),
      h('div.side-tools',
        h('button.icon-btn', { type: 'button', id: 'side-priv', onclick: togglePrivacy, 'aria-label': 'Nascondi gli importi' }, icon('eye', 20)),
        h('button.icon-btn', { type: 'button', onclick: () => session.lock(), 'aria-label': 'Blocca ora', title: 'Blocca ora (L)' }, icon('lock', 20)),
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
  document.title = (route.path ? title + ' · ' : '') + 'Analisi Finanziarie';
  $('#top-actions').replaceChildren(
    ...actions,
    h('button.icon-btn.only-mobile', { type: 'button', 'aria-label': 'Cerca', onclick: () => openPalette(ctx) }, icon('search', 20)),
    h('button.icon-btn.only-desktop', { type: 'button', 'aria-label': ui.privacy ? 'Mostra gli importi' : 'Nascondi gli importi', title: 'Nascondi/mostra importi (H)', onclick: togglePrivacy }, icon(ui.privacy ? 'eyeOff' : 'eye', 20)),
    h('button.btn.btn-primary.only-desktop', { type: 'button', onclick: () => txEditor(ctx), title: 'Nuovo movimento (N)' }, icon('plus', 18), h('span', 'Movimento')));
  $('#banners').replaceChildren(...banners(ctx));
  viewEl.replaceChildren(node);
  viewEl.dataset.route = route.path || 'home';
  const priv = $('#side-priv');
  if (priv) { priv.replaceChildren(icon(ui.privacy ? 'eyeOff' : 'eye', 20)); priv.setAttribute('aria-label', ui.privacy ? 'Mostra gli importi' : 'Nascondi gli importi'); }
  updateSave();
  if (changed) {
    currentPath = location.hash;
    viewEl.classList.remove('enter'); void viewEl.offsetWidth; viewEl.classList.add('enter');
    window.scrollTo(0, 0);
  } else window.scrollTo(0, y);
}

function updateSave() {
  const el = $('#side-save');
  if (el) el.replaceChildren(saveDot());
}

/* ─── Dopo lo sblocco ─── */
function afterOpen() {
  ui.privacy = !!S.state.settings.hideAmounts;
  ui.base = S.state.settings.currency;
  applyTheme(S.state.settings.theme);
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
  if (typing || e.metaKey || e.ctrlKey || e.altKey || topSheet()) return;
  const k = e.key.toLowerCase();
  if (k === 'n') { e.preventDefault(); txEditor(ctxBase()); }
  else if (k === 'l') { e.preventDefault(); session.lock(); }
  else if (k === 'h') { e.preventDefault(); togglePrivacy(); }
  else if (k === '/') { e.preventDefault(); openPalette(ctxBase()); }
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
session.boot();
render();
