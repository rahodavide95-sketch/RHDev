/* Lente — l'interfaccia. I calcoli sono in core.js (window.Lente). */
(function () {
  'use strict';
  const L = window.Lente;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeImg = (u) => (/^https:\/\//i.test(String(u || '')) ? String(u) : '');
  const safeLink = (u) => { const s = String(u || '').trim(); if (!s) return ''; if (/^https?:\/\//i.test(s)) return s; if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return 'https://' + s; return ''; };
  const igUrl = (u) => 'https://www.instagram.com/' + encodeURIComponent(u) + '/';
  const initial = (s) => (String(s || '?').replace(/^[@._\d]+/, '')[0] || String(s || '?')[0] || '?').toUpperCase();
  const N = L.fmtNum, C = L.fmtCompact, PCT = L.fmtPct, DEC = L.fmtDec, D = L.fmtDate;
  const plural = (n, one, many) => (n === 1 ? one : many);

  const ICON = {
    heart: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9.2C1.1 8.4 3.2 5 6.6 5c2 0 3.4 1 4.4 2.4C12 6 13.4 5 15.4 5c3.4 0 5.5 3.4 4.1 6.8C19.5 16.4 12 21 12 21z"/></svg>',
    comment: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l12-7.5z"/></svg>',
  };

  const TYPE_ICON = {
    image: '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>',
    carousel: '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="7" y="7" width="14" height="14" rx="3"/><path d="M17 3H6a3 3 0 0 0-3 3v11"/></svg>',
    reel: '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M3 8h18M8 3l3 5M14 3l3 5"/><path d="M10 12v5l4-2.5z" fill="currentColor"/></svg>',
    video: '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="5" width="13" height="14" rx="3"/><path d="m16 10 5-3v10l-5-3z"/></svg>',
  };

  /* ================= archivio sul dispositivo ================= */
  const KEY = 'lente.v1';
  function blank() {
    return { v: 1, profiles: {}, exportSnaps: [], settings: { version: L.API_VERSION, maxPosts: 50, theme: 'auto', accounts: [], igId: '', token: '' } };
  }
  function load() {
    try {
      const j = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (j && j.v === 1) { const b = blank(); return Object.assign(b, j, { settings: Object.assign(b.settings, j.settings || {}) }); }
    } catch (e) { /* archivio illeggibile: si riparte */ }
    return blank();
  }
  let DB = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(DB)); return true; } catch (e) { return false; }
  }
  const sess = {
    get(k) { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set(k, v) { try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch (e) { /* niente */ } },
  };
  let TOKEN = DB.settings.token || sess.get('lente.token');

  const S = {
    view: 'analyze', src: 'api', cur: null, exp: null, rows: [], compare: [],
    tbl: { k: 'ts', dir: -1, type: 'all', show: 25 },
    list: { tab: 'notBack', q: '', show: 120 },
    delArm: '',
  };

  /* ================= piccoli aiuti ================= */
  let toastT;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3200);
  }
  function status(id, msg, err) { const el = $(id); el.textContent = msg || ''; el.classList.toggle('err', !!err); }
  function prog(id, f) {
    const el = $(id);
    if (f === null || f === undefined) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden'); el.firstElementChild.style.width = Math.round(Math.max(0.03, Math.min(1, f)) * 100) + '%';
  }
  function download(name, text, type) {
    const blob = text instanceof Blob ? text : new Blob([text], { type: type || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copiato negli appunti'); } catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Copiato negli appunti'); } catch (e2) { toast('Non riesco a copiare'); }
      ta.remove();
    }
  }
  const stamp = () => { const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); };
  function errText(e) { return e instanceof L.ApiError ? L.explainError(e) : (e && e.message) || 'Errore imprevisto.'; }

  /* le immagini di Instagram scadono dopo qualche giorno: se non si caricano, al loro posto restano le iniziali */
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (t && t.tagName === 'IMG' && t.hasAttribute('data-fallback')) {
      const s = document.createElement('span'); s.textContent = t.getAttribute('data-fallback'); t.replaceWith(s);
    } else if (t && t.tagName === 'IMG' && t.hasAttribute('data-hide')) t.remove();
  }, true);
  function avatarHTML(P, cls) {
    const src = safeImg(P.avatar);
    const ini = initial(P.name || P.username);
    return src ? '<img class="' + (cls || '') + '" src="' + esc(src) + '" alt="" referrerpolicy="no-referrer" data-fallback="' + esc(ini) + '">' : '<span>' + esc(ini) + '</span>';
  }

  /* ================= suggerimenti al passaggio ================= */
  const tip = $('#tip');
  let tipT, tipEl;
  function placeTip(x, y) {
    const r = tip.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > innerHeight - 8) top = y - r.height - 14;
    tip.style.left = Math.max(8, left) + 'px'; tip.style.top = Math.max(8, top) + 'px';
  }
  function showTip(el, x, y) {
    const t = el.getAttribute('data-tip'); if (!t) return;
    if (tipEl && tipEl !== el) tipEl.classList.remove('on');
    tipEl = el; el.classList.add('on');
    tip.textContent = t; tip.classList.add('on'); placeTip(x, y);
  }
  function hideTip() { tip.classList.remove('on'); if (tipEl) tipEl.classList.remove('on'); tipEl = null; }
  document.addEventListener('pointerover', (e) => { if (e.pointerType !== 'mouse') return; const el = e.target.closest('[data-tip]'); if (el) showTip(el, e.clientX, e.clientY); else hideTip(); });
  document.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && tip.classList.contains('on')) placeTip(e.clientX, e.clientY); });
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    const el = e.target.closest('[data-tip]');
    if (el) { showTip(el, e.clientX, e.clientY); clearTimeout(tipT); tipT = setTimeout(hideTip, 2600); } else hideTip();
  });
  window.addEventListener('scroll', hideTip, { passive: true });

  /* ================= grafici (HTML + SVG, senza librerie) ================= */
  function niceStep(span, n) {
    if (!(span > 0)) return 1;
    const raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function tickText(v, step, unit) {
    if (unit === '%') return DEC(v) + '%';
    if (Math.abs(v) >= 10000) return C(v);
    return step < 1 ? DEC(v) : N(v);
  }
  function axis(lo, hi, unit) {
    const st = niceStep(hi - lo, 4);
    const a = Math.floor(lo / st) * st, b = Math.ceil(hi / st) * st || st;
    const ticks = [];
    for (let v = a; v <= b + st / 1e6; v += st) ticks.push(Math.round(v * 1e6) / 1e6);
    const y = ticks.map((t) => '<span style="bottom:' + ((t - a) / (b - a)) * 100 + '%">' + esc(tickText(t, st, unit)) + '</span>').join('');
    const gl = ticks.slice(1).map((t) => '<div class="gl" style="bottom:' + ((t - a) / (b - a)) * 100 + '%"></div>').join('');
    return { lo: a, hi: b, y, gl };
  }
  /* colonne: vals = [{v, tip, hl}] */
  function columns(vals, o) {
    o = o || {};
    if (!vals.length) return '<p class="muted small">Nessun dato.</p>';
    const max = Math.max(0, ...vals.map((v) => v.v || 0), isNum(o.avg) ? o.avg : 0);
    const ax = axis(0, max || 1, o.unit);
    const pct = (v) => Math.max(0, Math.min(100, ((v || 0) - ax.lo) / (ax.hi - ax.lo) * 100));
    const gap = vals.length > 40 ? 1 : 2;
    const bars = vals.map((v) => '<div class="cc-b' + (v.hl ? ' hl' : '') + '" data-tip="' + esc(v.tip) + '"><i style="height:' + pct(v.v) + '%"></i></div>').join('');
    const avg = isNum(o.avg) ? '<div class="cc-avg" style="bottom:' + pct(o.avg) + '%"><span>' + esc(o.avgLabel || 'media') + '</span></div>' : '';
    let xl = '';
    if (o.months) {
      const step = Math.ceil(vals.length / (o.maxLabels || 6));
      const first = (vals.length - 1) % step; // l'ultimo mese ha sempre l'etichetta
      xl = '<div class="cc-x months">' + o.months.map((m, i) => '<span>' + ((i - first) % step === 0 && i >= first ? '<em>' + esc(m) + '</em>' : '') + '</span>').join('') + '</div>';
    } else if (o.xLabels) xl = '<div class="cc-x">' + o.xLabels.map((l) => '<span>' + esc(l) + '</span>').join('') + '</div>';
    return '<div class="chart" style="padding-top:8px" role="img" aria-label="' + esc(o.label || '') + '"><div class="cc" style="--h:' + (o.h || 180) + 'px"><div class="cc-y">' + ax.y + '</div><div class="cc-plot">' + ax.gl + '<div class="cc-bars" style="gap:' + gap + 'px">' + bars + '</div>' + avg + '</div>' + xl + '</div></div>';
  }
  /* linea nel tempo: pts = [{x: ts, y, tip}] */
  function line(pts, o) {
    o = o || {};
    if (pts.length < 2) return '<p class="muted small">Servono almeno due misure.</p>';
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    let lo = Math.min(...ys), hi = Math.max(...ys);
    if (o.zero) lo = Math.min(0, lo);
    else { const pad = (hi - lo) * 0.2 || Math.abs(hi) * 0.02 || 1; lo -= pad; hi += pad; if (lo < 0 && Math.min(...ys) >= 0) lo = 0; }
    const ax = axis(lo, hi, o.unit);
    const X = (x) => (x1 === x0 ? 50 : ((x - x0) / (x1 - x0)) * 100);
    const Y = (y) => 100 - ((y - ax.lo) / (ax.hi - ax.lo)) * 100;
    const d = pts.map((p, i) => (i ? 'L' : 'M') + X(p.x).toFixed(3) + ',' + Y(p.y).toFixed(3)).join(' ');
    const area = d + ' L' + X(pts[pts.length - 1].x).toFixed(3) + ',100 L' + X(pts[0].x).toFixed(3) + ',100 Z';
    const hits = pts.map((p, i) => {
      const cx = X(p.x);
      const l = i ? (X(pts[i - 1].x) + cx) / 2 : 0;
      const r = i < pts.length - 1 ? (X(pts[i + 1].x) + cx) / 2 : 100;
      const w = Math.max(r - l, 0.5);
      const off = ((cx - l) / w) * 100;
      return '<span class="hit" style="left:' + l + '%;width:' + w + '%;--px:' + off + '%" data-tip="' + esc(p.tip) + '"><i style="left:' + off + '%;top:' + Y(p.y) + '%"></i></span>';
    }).join('');
    const last = pts[pts.length - 1];
    const end = '<span class="dot" style="left:' + X(last.x) + '%;top:' + Y(last.y) + '%"></span>' +
      (o.endLabel ? '<span class="endlab" style="left:' + X(last.x) + '%;top:' + Y(last.y) + '%">' + esc(o.endLabel) + '</span>' : '');
    const xl = '<div class="cc-x"><span>' + esc(D(x0)) + '</span><span>' + esc(D(x1)) + '</span></div>';
    return '<div class="chart" style="padding-top:8px" role="img" aria-label="' + esc(o.label || '') + '"><div class="cc" style="--h:' + (o.h || 170) + 'px"><div class="cc-y">' + ax.y + '</div><div class="cc-plot">' + ax.gl +
      '<div class="lc" style="position:absolute;inset:0"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path class="ar" d="' + area + '"/><path class="ln" d="' + d + '"/></svg>' + hits + end + '</div></div>' + xl + '</div></div>';
  }
  /* barre orizzontali: rows = [{k, v, text, tip, href, c}] */
  function hbars(rows, o) {
    o = o || {};
    if (!rows.length) return '<p class="muted small">' + esc(o.empty || 'Nessun dato.') + '</p>';
    const max = Math.max(...rows.map((r) => r.v || 0)) || 1;
    return '<div class="hb">' + rows.map((r) => {
      const k = r.href ? '<a href="' + esc(r.href) + '" target="_blank" rel="noopener">' + esc(r.k) + '</a>' : esc(r.k);
      return '<div class="k" title="' + esc(r.k) + '">' + (r.dot ? '<span class="dotc" style="background:var(--s' + r.dot + ')"></span>' : '') + k + '</div>' +
        '<div class="tr" data-tip="' + esc(r.tip || (r.k + ': ' + r.text)) + '"><i class="' + (r.c ? 'c' + r.c : '') + '" style="width:' + Math.max(1, ((r.v || 0) / max) * 100) + '%"></i></div>' +
        '<div class="v">' + r.text + '</div>';
    }).join('') + '</div>';
  }
  /* mappa di calore giorno × fascia oraria */
  function heatmap(cells, o) {
    o = o || {};
    const val = (c) => (o.counts ? c : c.avg);
    let max = 0, anyFew = false;
    for (const row of cells) for (const c of row) { const v = val(c); if (isNum(v) && v > max) max = v; }
    let h = '<div class="heat" role="img" aria-label="' + esc(o.label || 'Mappa giorno e ora') + '"><div></div>' + L.SLOTS.map((s) => '<div class="hl">' + esc(s) + '</div>').join('');
    cells.forEach((row, d) => {
      h += '<div class="hl">' + L.DAYS[d] + '</div>';
      row.forEach((c, s) => {
        const v = val(c);
        const n = o.counts ? c : c.n;
        const lvl = isNum(v) && v > 0 && max > 0 ? Math.max(1, Math.min(6, Math.ceil((v / max) * 6))) : 0;
        const best = o.best && o.best.d === d && o.best.s === s;
        const few = !o.counts && n > 0 && n < (o.minN || 1);
        if (few) anyFew = true;
        const t = L.DAYS_LONG[d] + ' ' + L.SLOTS[s] + '\n' + (n ? N(n) + ' post' + (o.counts ? '' : '\nmedia ' + N(v) + ' interazioni') : 'nessun post') + (few ? '\npochi post: poco affidabile' : '');
        h += '<div class="hc' + (best ? ' best' : '') + (few ? ' few' : '') + '" style="background:' + (lvl ? 'var(--q' + lvl + ')' : 'var(--chip)') + '" data-tip="' + esc(t + (best ? '\n★ momento migliore' : '')) + '"></div>';
      });
    });
    h += '</div><div class="legend"><span>' + (o.counts ? 'meno post' : 'meno interazioni') + '</span><span class="ramp">' + [1, 2, 3, 4, 5, 6].map((i) => '<i style="background:var(--q' + i + ')"></i>').join('') + '</span><span>' + (o.counts ? 'più post' : 'più interazioni') + '</span>' +
      '<span><span class="sw" style="background:var(--chip)"></span>nessun post</span>' + (anyFew ? '<span><span class="sw" style="background:var(--q4);opacity:.35"></span>un solo post</span>' : '') + (o.best ? '<span><span class="sw" style="outline:2px solid var(--ink);outline-offset:-2px"></span>momento migliore</span>' : '') + '</div>';
    return h;
  }
  function ring(score, grade) {
    const r = 52, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, (score || 0) / 100));
    const col = score >= 70 ? 'var(--good)' : score >= 45 ? 'var(--warn)' : 'var(--crit)';
    return '<div class="ring" role="img" aria-label="Punteggio ' + score + ' su 100: ' + esc(grade) + '"><svg viewBox="0 0 120 120" aria-hidden="true">' +
      '<circle cx="60" cy="60" r="' + r + '" fill="none" style="stroke:color-mix(in srgb,' + col + ' 20%,transparent)" stroke-width="12"/>' +
      '<circle cx="60" cy="60" r="' + r + '" fill="none" style="stroke:' + col + '" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + (c * f).toFixed(2) + ' ' + c.toFixed(2) + '"/></svg>' +
      '<div class="t"><div><b>' + score + '</b><span>' + esc(grade) + '</span></div></div></div>';
  }
  function bench(A) {
    const t = A.tier;
    const top = Math.max(t.hi * 2.2, (A.er || 0) * 1.15);
    const p = (v) => Math.max(0, Math.min(100, (v / top) * 100));
    return '<div class="bench"><div class="track"><div class="band" style="left:' + p(t.lo) + '%;width:' + (p(t.hi) - p(t.lo)) + '%" data-tip="Tipico per la fascia ' + esc(t.label) + ': ' + PCT(t.lo, 1) + '–' + PCT(t.hi, 1) + '"></div>' +
      (isNum(A.er) ? '<div class="mk" style="left:' + p(A.er) + '%"><span>' + PCT(A.er) + '</span></div>' : '') + '</div>' +
      '<div class="lab"><span>0%</span><span>tipico ' + PCT(t.lo, 1) + '–' + PCT(t.hi, 1) + '</span><span>' + PCT(top, 1) + '</span></div></div>';
  }
  function tile(l, v, d, cls) { return '<div class="tile"><div class="l">' + esc(l) + '</div><div class="v">' + v + '</div>' + (d ? '<div class="d ' + (cls || '') + '">' + d + '</div>' : '') + '</div>'; }
  function tipsHTML(list) {
    const sym = { good: '✓', ok: '✓', tip: 'i', warn: '!', bad: '!' };
    return '<div class="tips">' + list.map((t) => '<div class="tipc ' + t.tone + '"><span class="ic" aria-hidden="true">' + sym[t.tone] + '</span><div><b>' + esc(t.title) + '</b><p>' + esc(t.text) + '</p></div></div>').join('') + '</div>';
  }
  const secTitle = (t, s) => '<div class="sec-title"><h2>' + esc(t) + '</h2>' + (s ? '<span>' + esc(s) + '</span>' : '') + '</div>';

  /* ================= navigazione ================= */
  const HASH = { analyze: '#analizza', archive: '#archivio', guide: '#guida' };
  function go(view) {
    S.view = view;
    for (const v of ['analyze', 'archive', 'guide']) $('#v-' + v).classList.toggle('hidden', v !== view);
    $$('nav.tabs button').forEach((b) => { if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    if (view === 'archive') renderArchive();
    if (location.hash !== HASH[view]) history.replaceState(null, '', HASH[view]);
    window.scrollTo({ top: 0 });
  }
  function fromHash() {
    const h = location.hash;
    if (h === '#archivio') go('archive'); else if (h === '#guida') go('guide'); else go('analyze');
  }
  $$('nav.tabs button').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
  window.addEventListener('hashchange', fromHash);
  document.addEventListener('click', (e) => { const a = e.target.closest('[data-goto]'); if (a) { e.preventDefault(); go(a.dataset.goto); } });

  function setSrc(src) {
    S.src = src;
    $$('.src').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.src === src)));
    for (const k of ['api', 'export', 'csv', 'demo']) $('#p-' + k).classList.toggle('hidden', k !== src);
  }
  $$('.src').forEach((b) => b.addEventListener('click', () => setSrc(b.dataset.src)));

  function applyTheme() {
    const t = DB.settings.theme || 'auto';
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
    const name = { auto: 'automatico', light: 'chiaro', dark: 'scuro' }[t];
    $('#themeBtn').title = 'Tema: ' + name; $('#themeBtn').setAttribute('aria-label', 'Tema ' + name + ': tocca per cambiare');
    const svg = {
      auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/>',
      light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
      dark: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    }[t];
    $('#themeBtn').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' + svg + '</svg>';
  }
  $('#themeBtn').addEventListener('click', () => {
    const order = ['auto', 'light', 'dark'];
    DB.settings.theme = order[(order.indexOf(DB.settings.theme || 'auto') + 1) % 3];
    save(); applyTheme();
  });

  /* ================= analisi di un profilo ================= */
  function trimP(P) {
    const c = Object.assign({}, P);
    c.posts = (P.posts || []).slice(0, 200).map((p) => ({
      id: p.id, ts: p.ts, type: p.type, caption: String(p.caption || '').slice(0, 500), likes: p.likes, comments: p.comments,
      views: p.views, reach: p.reach, saves: p.saves, shares: p.shares, url: p.url, thumb: p.thumb,
    }));
    delete c.demoHistory;
    return c;
  }
  function keyOf(P) { return L.cleanUser(P.username) || 'profilo'; }
  function archive(P, A) {
    const key = keyOf(P);
    const rec = DB.profiles[key] || { key, history: [] };
    rec.username = P.username || key; rec.name = P.name || ''; rec.avatar = safeImg(P.avatar); rec.source = P.source; rec.own = !!P.own; rec.at = A.at;
    rec.summary = { followers: A.followers, er: A.er, score: A.score.total, n: A.n };
    rec.last = trimP(P);
    if (P.demoHistory && !rec.history.length) rec.history = P.demoHistory.slice();
    const snap = L.snapshotOf(P, A);
    const prev = rec.history[rec.history.length - 1];
    if (prev && A.at - prev.at < 6 * 3600e3) rec.history[rec.history.length - 1] = snap; else rec.history.push(snap);
    rec.history = rec.history.slice(-200);
    DB.profiles[key] = rec;
    if (!save()) {
      rec.last.posts = rec.last.posts.slice(0, 50);
      if (!save()) { delete DB.profiles[key]; save(); toast('Spazio del browser pieno: elimina qualche profilo dall\'archivio.'); }
    }
  }
  function showProfile(P, opts) {
    opts = opts || {};
    const A = L.analyze(P);
    if (opts.save !== false) archive(P, A);
    S.cur = { P, A, key: keyOf(P) };
    S.exp = null;
    S.tbl = { k: 'ts', dir: -1, type: 'all', show: 25 };
    renderProfile();
    if (S.view !== 'analyze') go('analyze');
    setTimeout(() => { const r = $('#result'); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30);
  }
  function sourceBadge(P) {
    if (P.source === 'demo') return 'Esempio';
    if (P.source === 'api') return P.own ? 'Il tuo account · insights' : 'API Meta';
    return 'Dati inseriti';
  }
  function renderProfile() {
    const { P, A, key } = S.cur;
    const rec = DB.profiles[key];
    const growth = L.growthOf(rec ? rec.history : P.demoHistory);
    const name = P.name || '@' + P.username;
    const site = safeLink(P.website);
    let h = '';

    // testata
    h += '<div class="card" id="resTop"><div class="phead"><div class="avatar">' + avatarHTML(P) + '</div><div class="pinfo">' +
      '<h2>' + esc(name) + ' <span class="badge">' + esc(sourceBadge(P)) + '</span>' + (A.followers ? '<span class="badge">' + esc(A.tier.label) + '</span>' : '') + '</h2>' +
      (P.username ? '<a class="handle" href="' + igUrl(P.username) + '" target="_blank" rel="noopener">@' + esc(P.username) + '</a>' : '') +
      (P.bio ? '<p class="bio">' + esc(P.bio) + '</p>' : '') +
      (site ? '<div class="small" style="margin-top:4px"><a href="' + esc(site) + '" target="_blank" rel="noopener nofollow">' + esc(site.replace(/^https?:\/\//, '').replace(/\/$/, '')) + '</a></div>' : '') +
      '</div></div>' +
      '<p class="small muted" style="margin:12px 0 0">' + (A.n ? 'Analizzati ' + N(A.n) + ' ' + plural(A.n, 'post', 'post') + ' dal ' + D(A.first) + ' al ' + D(A.last) + '. ' : 'Nessun post da analizzare. ') +
      (A.fresh ? N(A.fresh) + ' ' + plural(A.fresh, 'post delle ultime 24 ore è escluso dalle medie', 'post delle ultime 24 ore sono esclusi dalle medie') + '. ' : '') +
      'Dati del ' + D(P.fetchedAt || A.at, true) + '.</p>' +
      '<div class="actions">' +
      (P.source === 'api' ? '<button class="btn sec sm" data-act="refresh">Aggiorna</button>' : '') +
      (A.n ? '<button class="btn ghost sm" data-act="csv">Esporta i post (CSV)</button>' : '') +
      '<button class="btn ghost sm" data-act="json">Scarica i dati (JSON)</button>' +
      '<button class="btn ghost sm" data-act="print">Stampa o salva PDF</button>' +
      '<button class="btn ghost sm" data-act="compare-this">Confronta con altri</button>' +
      '</div></div>';

    // numeri principali
    h += '<div class="tiles" style="margin-top:14px">';
    h += tile('Follower', C(A.followers), A.followers ? esc(A.tier.label) + ' · ' + esc(A.tier.range) : '');
    h += tile('Seguiti', C(A.following), isNum(A.ratio) ? 'rapporto follower/seguiti ' + DEC(A.ratio) : '');
    h += tile('Post', C(A.postsCount != null ? A.postsCount : A.n), 'analizzati ' + N(A.n));
    h += tile('Engagement rate', PCT(A.er), A.rating ? esc(A.rating.label) + (isNum(A.erMedian) ? ' · mediano ' + PCT(A.erMedian) : '') : 'servono i follower', A.rating ? (A.rating.tone === 'good' ? 'up' : A.rating.tone === 'ok' ? '' : 'down') : '');
    h += tile('Media mi piace', C(A.avgLikes), A.likesHidden ? N(A.likesHidden) + ' post con mi piace nascosti' : 'per post');
    h += tile('Media commenti', C(A.avgComments), isNum(A.c2l) ? PCT(A.c2l, 1) + ' dei mi piace' : 'per post');
    if (isNum(A.avgViews)) h += tile('Visualizzazioni medie', C(A.avgViews), isNum(A.viewRate) ? PCT(A.viewRate, 0) + ' dei follower · Reel e video' : 'Reel e video');
    h += tile('Post a settimana', DEC(A.perWeek), isNum(A.gapMax) ? 'pausa più lunga: ' + N(A.gapMax) + ' giorni' : '');
    h += tile('Ultimo post', esc(L.agoText(A.lastAgo)), A.last ? D(A.last) : '');
    if (growth) h += tile('Crescita', (growth.delta >= 0 ? '+' : '−') + C(Math.abs(growth.delta)), 'follower dal ' + D(growth.from) + (isNum(growth.pct) ? ' (' + (growth.pct >= 0 ? '+' : '') + PCT(growth.pct, 1) + ')' : ''), growth.delta >= 0 ? 'up' : 'down');
    h += '</div>';

    // punteggio e riferimento
    h += '<div class="grid g2" style="margin-top:14px">';
    if (A.score.total !== null) {
      h += '<div class="card"><h2>Punteggio del profilo</h2><p class="sub">Da 0 a 100, calcolato su quello che Lente può misurare.</p><div class="score">' + ring(A.score.total, A.score.grade) + '<div class="parts">' +
        A.score.parts.map((p) => '<div class="part"><span>' + esc(p.label) + '</span><span class="tr" data-tip="' + esc(p.label + ': ' + DEC(p.pts) + ' su ' + p.max) + '"><i style="width:' + (p.pts / p.max) * 100 + '%"></i></span><b>' + DEC(p.pts) + '<span class="muted" style="font-weight:500">/' + p.max + '</span></b><small>' + esc(p.note) + '</small></div>').join('') +
        '</div></div></div>';
    }
    h += '<div class="card"><h2>Engagement rispetto alla fascia</h2><p class="sub">Profilo ' + esc(A.tier.label.toLowerCase()) + ' (' + esc(A.tier.range) + '). Valori tipici indicativi.</p>' +
      (isNum(A.er) ? bench(A) + '<p style="margin:12px 0 0">L\'engagement rate è <b>' + PCT(A.er) + '</b>: <b>' + esc(A.rating.label.toLowerCase()) + '</b> per questa fascia.</p>' : '<p class="muted">Inserisci i follower e almeno un post con mi piace o commenti.</p>') +
      (A.value ? '<div class="note" style="margin-top:14px"><b>Valore indicativo di un post sponsorizzato:</b> ' + L.fmtEuro(A.value.lo) + ' – ' + L.fmtEuro(A.value.hi) + '<br><span class="muted">Storia: ' + L.fmtEuro(A.value.story[0]) + ' – ' + L.fmtEuro(A.value.story[1]) + '. Stima molto approssimativa, utile come punto di partenza.</span></div>' : '') +
      '</div></div>';

    // consigli
    if (A.tips.length) h += secTitle('Consigli', 'cosa fare per crescere') + '<div class="card">' + tipsHTML(A.tips) + '</div>';

    if (A.nBase) {
      // rendimento post per post
      const recent = A.posts.filter((p) => p.hasEng).slice(0, 60).reverse();
      const thr = A.outliers.length ? Math.min(...A.outliers.map((p) => p.eng)) : Infinity;
      h += secTitle('Rendimento dei post', recent.length < A.nBase ? 'gli ultimi ' + recent.length : '');
      h += '<div class="card"><h3>Interazioni per post (mi piace + commenti)</h3>' +
        columns(recent.map((p) => ({ v: p.eng, hl: p.eng >= thr, tip: D(p.ts, true) + ' · ' + L.TYPE_LABEL[p.type] + '\n' + N(p.likes) + ' mi piace · ' + N(p.comments) + ' commenti' + (isNum(p.er) ? '\nER ' + PCT(p.er) : '') + (p.caption ? '\n“' + p.caption.slice(0, 70) + (p.caption.length > 70 ? '…' : '') + '”' : '') })),
          { avg: A.avgEng, avgLabel: 'media ' + N(A.avgEng), xLabels: [D(recent[0].ts), D(recent[recent.length - 1].ts)], label: 'Interazioni per post' }) +
        '<div class="legend"><span><span class="sw" style="background:var(--s1)"></span>interazioni del post</span>' + (A.outliers.length ? '<span><span class="sw" style="background:var(--s2)"></span>post fuori scala</span>' : '') + '<span><span class="sw" style="background:var(--ink2);height:2px;vertical-align:3px"></span>media</span></div></div>';

      // quando e cosa
      h += '<div class="grid g2" style="margin-top:14px">';
      h += '<div class="card"><h3>Quando pubblicare</h3><p class="sub">Interazioni medie per giorno e fascia oraria (ora del tuo dispositivo).</p>' + heatmap(A.heat, { best: A.bestCell, minN: A.minN, label: 'Interazioni medie per giorno e ora' }) +
        (A.bestCell ? '<p style="margin:12px 0 0">Momento migliore: <b>' + L.DAYS_LONG[A.bestCell.d] + ', ' + L.SLOTS[A.bestCell.s] + '</b>.</p>' : '') + '</div>';
      h += '<div class="card"><h3>Formati</h3><p class="sub">Interazioni medie per tipo di contenuto.</p>' +
        hbars(A.types.map((t) => ({ k: t.label, v: t.avg, text: N(t.avg) + ' <small>· ' + N(t.n) + ' post</small>', tip: t.label + '\n' + N(t.n) + ' post (' + PCT(t.share * 100, 0) + ')\nmedia ' + N(t.avg) + ' interazioni' + (isNum(t.views) ? '\n' + N(t.views) + ' visualizzazioni medie' : '') + (isNum(t.lift) ? '\n' + (t.lift >= 0 ? '+' : '') + PCT(t.lift * 100, 0) + ' rispetto alla media' : '') }))) +
        '<h3 style="margin-top:18px">Giorni della settimana</h3>' +
        hbars(A.byDay.filter((d) => d.n).map((d) => ({ k: L.DAYS_LONG[d.i], v: d.avg, text: N(d.avg) + ' <small>· ' + N(d.n) + '</small>', tip: L.DAYS_LONG[d.i] + '\n' + N(d.n) + ' post · media ' + N(d.avg) + ' interazioni' }))) + '</div>';
      h += '</div>';

      // hashtag e didascalie
      h += '<div class="grid g2" style="margin-top:14px">';
      h += '<div class="card"><h3>Hashtag</h3><p class="sub">' + (isNum(A.tagsPerPost) ? 'In media ' + DEC(A.tagsPerPost) + ' hashtag per post.' : '') + '</p>' +
        (A.tags.length ? '<h3 class="small muted" style="margin:0 0 6px">I più usati</h3>' + hbars(A.tags.slice(0, 8).map((t) => ({ k: '#' + t.tag, v: t.n, text: N(t.n) + ' <small>post</small>', tip: '#' + t.tag + '\nin ' + N(t.n) + ' post · media ' + N(t.avg) + ' interazioni' }))) : '<p class="muted small">Nessun hashtag nei post analizzati.</p>') +
        (A.bestTags.length ? '<h3 class="small muted" style="margin:16px 0 6px">I più efficaci (usati almeno 2 volte)</h3>' + hbars(A.bestTags.slice(0, 6).map((t) => ({ k: '#' + t.tag, v: t.avg, c: 3, text: N(t.avg) + (isNum(t.lift) ? ' <small>' + (t.lift >= 0 ? '+' : '') + PCT(t.lift * 100, 0) + '</small>' : ''), tip: '#' + t.tag + '\nmedia ' + N(t.avg) + ' interazioni in ' + N(t.n) + ' post' }))) : '') + '</div>';
      h += '<div class="card"><h3>Didascalie</h3><p class="sub">Interazioni medie per lunghezza del testo (senza hashtag).</p>' +
        hbars(A.captions.filter((c) => c.n).map((c) => ({ k: c.label, v: c.avg, text: N(c.avg) + ' <small>· ' + N(c.n) + '</small>', tip: c.label + '\n' + N(c.n) + ' post · media ' + N(c.avg) + ' interazioni' }))) +
        '<div class="tiles" style="margin-top:14px;grid-template-columns:repeat(2,minmax(0,1fr))">' +
        (A.question ? tile('Con una domanda', (A.question.lift >= 0 ? '+' : '−') + PCT(Math.abs(A.question.lift * 100), 0), 'interazioni rispetto ai post senza (' + N(A.question.withN) + ' post)', A.question.lift >= 0 ? 'up' : 'down') : '') +
        (isNum(A.emojiShare) ? tile('Con emoji', PCT(A.emojiShare * 100, 0), 'dei post') : '') + '</div>' +
        (A.mentions.length ? '<h3 class="small muted" style="margin:14px 0 6px">Account citati più spesso</h3><div class="chips">' + A.mentions.slice(0, 12).map((m) => '<a class="chip" href="' + igUrl(m.k) + '" target="_blank" rel="noopener">@' + esc(m.k) + ' · ' + m.n + '</a>').join('') + '</div>' : '') + '</div>';
      h += '</div>';

      // mese per mese
      if (A.monthly.length >= 2) {
        const ms = A.monthly.slice(-18);
        h += secTitle('Mese per mese');
        h += '<div class="grid g2"><div class="card"><h3>Post pubblicati</h3>' + columns(ms.map((m) => ({ v: m.n, tip: L.fmtMonth(m.k) + '\n' + N(m.n) + ' post' })), { months: ms.map((m) => L.fmtMonth(m.k)), h: 150, label: 'Post al mese' }) + '</div>' +
          '<div class="card"><h3>Interazioni medie per post</h3>' + columns(ms.map((m) => ({ v: m.avg || 0, tip: L.fmtMonth(m.k) + '\n' + (m.avg !== null ? N(m.avg) + ' interazioni medie' : 'nessun post') })), { months: ms.map((m) => L.fmtMonth(m.k)), h: 150, label: 'Interazioni medie al mese' }) + '</div></div>';
      }
    }

    // crescita
    if (growth) {
      h += secTitle('Crescita dei follower', 'dalle analisi salvate');
      h += '<div class="card">' + line(growth.points.map((s) => ({ x: s.at, y: s.followers, tip: D(s.at) + '\n' + N(s.followers) + ' follower' })), { endLabel: C(growth.points[growth.points.length - 1].followers), label: 'Follower nel tempo' }) +
        '<p class="small muted" style="margin:10px 0 0">' + (growth.delta >= 0 ? '+' : '−') + N(Math.abs(growth.delta)) + ' follower in ' + N((growth.to - growth.from) / L.DAY) + ' giorni (' + (growth.perDay >= 0 ? '+' : '') + DEC(growth.perDay) + ' al giorno). Analizza di nuovo il profilo nei prossimi giorni per allungare la linea.</p></div>';
    } else if (P.source === 'api') {
      h += '<p class="small muted noprint" style="margin:14px 2px 0">Analizza di nuovo questo profilo nei prossimi giorni: Lente disegnerà la crescita dei follower.</p>';
    }

    // insights del proprio account
    h += insightsHTML(P, A);

    // post migliori
    if (A.top.length) {
      h += secTitle('I post migliori', 'per interazioni');
      h += '<div class="posts">' + A.top.map((p, i) => postCard(p, i + 1)).join('') + '</div>';
      if (A.bottom.length) h += secTitle('Da rivedere', 'i post con meno interazioni') + '<div class="posts">' + A.bottom.map((p) => postCard(p)).join('') + '</div>';
    }

    // segnali
    if (A.signals.length) h += secTitle('Segnali da controllare', 'non sono prove, solo indizi') + '<div class="card">' + tipsHTML(A.signals) + '</div>';

    // tabella
    if (A.n) h += secTitle('Tutti i post analizzati') + '<div class="card" id="postTable"></div>';

    $('#result').innerHTML = h;
    if (A.n) renderTable();
  }
  function insightsHTML(P, A) {
    const I = P.insights;
    if (!A.ins && !I) return '';
    let h = secTitle('Insights', 'solo per il tuo account');
    if (A.ins) {
      h += '<div class="tiles">' +
        tile('Copertura media', C(A.ins.reach), isNum(A.ins.reachRate) ? PCT(A.ins.reachRate, 0) + ' dei follower' : 'account raggiunti per post') +
        tile('Salvataggi medi', DEC(A.ins.saves), 'per post') +
        tile('Condivisioni medie', DEC(A.ins.shares), 'per post') +
        tile('Engagement sulla copertura', PCT(A.ins.erReach), 'interazioni ÷ persone raggiunte') + '</div>';
    }
    if (I && I.account && Object.keys(I.account).length) {
      const lab = { reach: 'Account raggiunti', views: 'Visualizzazioni', accounts_engaged: 'Account che hanno interagito', total_interactions: 'Interazioni totali', profile_links_taps: 'Tocchi sui link del profilo' };
      h += '<div class="card" style="margin-top:14px"><h3>Ultimi 28 giorni</h3><div class="tiles">' + Object.keys(lab).filter((k) => isNum(I.account[k])).map((k) => tile(lab[k], C(I.account[k]))).join('') + '</div></div>';
    }
    if (I && I.followerDays && I.followerDays.length >= 2) {
      const fd = I.followerDays;
      h += '<div class="card" style="margin-top:14px"><h3>Nuovi follower al giorno</h3>' + columns(fd.map((d) => ({ v: d.n, tip: D(d.ts) + '\n' + N(d.n) + ' nuovi follower' })), { xLabels: [D(fd[0].ts), D(fd[fd.length - 1].ts)], h: 150, label: 'Nuovi follower al giorno' }) + '</div>';
    }
    const dem = I && I.demographics ? I.demographics : {};
    const hasDem = ['country', 'city', 'age', 'gender'].some((k) => dem[k] && dem[k].length);
    if (hasDem) {
      const tot = (list) => list.reduce((s, x) => s + x.n, 0) || 1;
      const rows = (list, fmt) => { const t = tot(list); return list.slice(0, 8).map((x) => ({ k: fmt ? fmt(x.k) : x.k, v: x.n, text: PCT((x.n / t) * 100, 0), tip: (fmt ? fmt(x.k) : x.k) + '\n' + N(x.n) + ' follower (' + PCT((x.n / t) * 100, 1) + ')' })); };
      const country = (k) => { try { return new Intl.DisplayNames(['it'], { type: 'region' }).of(k) || k; } catch (e) { return k; } };
      const gender = (k) => ({ F: 'Donne', M: 'Uomini', U: 'Non indicato' }[k] || k);
      const ages = (dem.age || []).slice().sort((a, b) => (a.k < b.k ? -1 : 1));
      h += '<div class="grid g2" style="margin-top:14px">' +
        (dem.country && dem.country.length ? '<div class="card"><h3>Paesi dei follower</h3>' + hbars(rows(dem.country, country)) + '</div>' : '') +
        (dem.city && dem.city.length ? '<div class="card"><h3>Città dei follower</h3>' + hbars(rows(dem.city)) + '</div>' : '') +
        (ages.length ? '<div class="card"><h3>Età</h3>' + hbars(rows(ages).slice(0, 8)) + '</div>' : '') +
        (dem.gender && dem.gender.length ? '<div class="card"><h3>Genere</h3>' + hbars(rows(dem.gender, gender)) + '</div>' : '') + '</div>';
    }
    if (A.ins && A.ins.topSaved.length && A.ins.topSaved[0].saves) {
      h += '<div class="card" style="margin-top:14px"><h3>I più salvati</h3><div class="posts" style="margin-top:8px">' + A.ins.topSaved.map((p) => postCard(p, 0, 'saves')).join('') + '</div></div>';
    }
    if (I && I.errors && I.errors.length) h += '<p class="small muted">Alcuni insights non sono arrivati: ' + esc(I.errors[0]) + '</p>';
    return h;
  }
  function postCard(p, rank, extra) {
    const th = safeImg(p.thumb) ? '<img src="' + esc(p.thumb) + '" alt="" loading="lazy" referrerpolicy="no-referrer" data-hide>' : '';
    const nums = '<span>' + ICON.heart + ' ' + (p.likes !== null ? C(p.likes) : 'nascosti') + '</span><span>' + ICON.comment + ' ' + C(p.comments) + '</span>' +
      (isNum(p.views) ? '<span>' + ICON.play + ' ' + C(p.views) + '</span>' : '') + (extra === 'saves' && isNum(p.saves) ? '<span>' + N(p.saves) + ' salvataggi</span>' : '');
    const url = safeLink(p.url);
    return '<article class="post"><div class="th">' + (TYPE_ICON[p.type] || TYPE_ICON.image) + th + (rank ? '<span class="rank">#' + rank + '</span>' : '') + '<span class="ty">' + esc(L.TYPE_LABEL[p.type] || '') + '</span></div>' +
      '<div class="bd"><div class="nums">' + nums + '</div><div class="cap">' + esc(p.caption || 'Senza didascalia') + '</div>' +
      '<div class="meta"><span>' + D(p.ts) + '</span>' + (isNum(p.er) ? '<span>ER ' + PCT(p.er) + '</span>' : '') + '</div>' +
      (url ? '<a class="small" href="' + esc(url) + '" target="_blank" rel="noopener">Apri su Instagram</a>' : '') + '</div></article>';
  }
  function renderTable() {
    const box = $('#postTable'); if (!box || !S.cur) return;
    const { A } = S.cur;
    const T = S.tbl;
    const types = [...new Set(A.posts.map((p) => p.type))];
    let rows = A.posts.filter((p) => T.type === 'all' || p.type === T.type);
    const val = (p) => (T.k === 'type' ? L.TYPE_LABEL[p.type] : p[T.k]);
    rows = rows.slice().sort((a, b) => { const x = val(a), y = val(b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (x > y ? 1 : x < y ? -1 : 0) * T.dir; });
    const hasViews = A.posts.some((p) => isNum(p.views)), hasReach = A.posts.some((p) => isNum(p.reach));
    const cols = [['ts', 'Data', 0], ['type', 'Tipo', 0], ['likes', 'Mi piace', 1], ['comments', 'Commenti', 1], ['eng', 'Interazioni', 1], ['er', 'ER', 1]];
    if (hasViews) cols.push(['views', 'Visual.', 1]);
    if (hasReach) cols.push(['reach', 'Copertura', 1], ['saves', 'Salvati', 1], ['shares', 'Condiv.', 1]);
    const arrow = (k) => (T.k === k ? (T.dir > 0 ? ' ↑' : ' ↓') : '');
    let h = '<div class="row" style="justify-content:space-between;align-items:center"><div class="chips"><button class="chip" data-act="tbl-type" data-t="all" aria-pressed="' + (T.type === 'all') + '">Tutti · ' + A.posts.length + '</button>' +
      types.map((t) => '<button class="chip" data-act="tbl-type" data-t="' + t + '" aria-pressed="' + (T.type === t) + '">' + esc(L.TYPE_LABEL[t]) + ' · ' + A.posts.filter((p) => p.type === t).length + '</button>').join('') + '</div></div>';
    h += '<div class="tbl-wrap"><table class="tbl"><thead><tr>' + cols.map(([k, l, n]) => '<th class="' + (n ? 'n' : '') + '"><button data-act="tbl-sort" data-k="' + k + '">' + l + arrow(k) + '</button></th>').join('') + '<th>Didascalia</th></tr></thead><tbody>';
    h += rows.slice(0, T.show).map((p) => {
      const url = safeLink(p.url);
      return '<tr><td class="nowrap">' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + D(p.ts, true) + '</a>' : D(p.ts, true)) + '</td><td>' + esc(L.TYPE_LABEL[p.type]) + '</td>' +
        '<td class="n">' + (p.likes === null ? '<span class="muted">nascosti</span>' : N(p.likes)) + '</td><td class="n">' + N(p.comments) + '</td><td class="n">' + N(p.eng) + '</td><td class="n">' + PCT(p.er) + '</td>' +
        (hasViews ? '<td class="n">' + N(p.views) + '</td>' : '') + (hasReach ? '<td class="n">' + N(p.reach) + '</td><td class="n">' + N(p.saves) + '</td><td class="n">' + N(p.shares) + '</td>' : '') +
        '<td class="cap">' + esc((p.caption || '').slice(0, 140)) + (p.caption && p.caption.length > 140 ? '…' : '') + '</td></tr>';
    }).join('');
    h += '</tbody></table></div>';
    if (rows.length > T.show) h += '<div class="row" style="margin-top:10px"><button class="btn ghost sm" data-act="tbl-more">Mostra altri ' + Math.min(25, rows.length - T.show) + ' (di ' + rows.length + ')</button></div>';
    box.innerHTML = h;
  }

  /* ================= export dei dati ================= */
  function hashList(list) {
    let h = 5381;
    const s = [...list].sort().join(',');
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return list.length + ':' + (h >>> 0).toString(36);
  }
  function previousSnap(R) {
    const cur = L.followersSnapshot(R);
    cur.hash = hashList(cur.list);
    const snaps = DB.exportSnaps || [];
    const mine = snaps.filter((s) => (s.owner || '') === (cur.owner || ''));
    let prev = mine[mine.length - 1] || null;
    if (prev && prev.hash === cur.hash) prev = mine[mine.length - 2] || null; // stesso export già caricato
    else if (cur.list.length) {
      snaps.push(cur);
      const keep = []; const per = {};
      for (let i = snaps.length - 1; i >= 0; i--) { const o = snaps[i].owner || ''; per[o] = (per[o] || 0) + 1; if (per[o] <= 3) keep.unshift(snaps[i]); }
      DB.exportSnaps = keep;
      if (JSON.stringify(keep).length > 3e6) DB.exportSnaps = keep.slice(-1);
      if (!save()) { DB.exportSnaps = []; save(); }
    }
    return prev;
  }
  function showExport(R) {
    const prev = previousSnap(R);
    const X = L.analyzeExport(R, prev);
    S.exp = { R, X };
    S.cur = null;
    S.list = { tab: X.counts.notBack ? 'notBack' : 'followers', q: '', show: 120 };
    renderExport();
    if (S.view !== 'analyze') go('analyze');
    setTimeout(() => { const r = $('#result'); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30);
  }
  const LISTS = [
    ['notBack', 'Non ti seguono', 'Account che segui ma che non ti seguono'],
    ['fans', 'Fan che non segui', 'Ti seguono ma tu non li segui'],
    ['mutual', 'Reciproci', 'Vi seguite a vicenda'],
    ['followers', 'Follower', 'Chi ti segue (dal più recente)'],
    ['following', 'Seguiti', 'Chi segui (dal più recente)'],
    ['unfollowed', 'Unfollow recenti', 'Account che hai smesso di seguire di recente'],
    ['pending', 'Richieste inviate', 'Richieste di follow ancora in attesa'],
    ['received', 'Richieste ricevute', 'Chi ha chiesto di seguirti'],
    ['closeFriends', 'Amici stretti', ''],
    ['blocked', 'Bloccati', ''],
    ['restricted', 'Con restrizioni', ''],
    ['hideStory', 'Storie nascoste a', ''],
  ];
  function renderExport() {
    const { X } = S.exp;
    const c = X.counts;
    const o = X.owner || {};
    let h = '<div class="card" id="resTop"><div class="phead"><div class="avatar"><span>' + esc(initial(o.name || o.username || 'Io')) + '</span></div><div class="pinfo">' +
      '<h2>' + esc(o.name || (o.username ? '@' + o.username : 'Il tuo account')) + ' <span class="badge">Export dei tuoi dati</span></h2>' +
      (o.username ? '<a class="handle" href="' + igUrl(o.username) + '" target="_blank" rel="noopener">@' + esc(o.username) + '</a>' : '') +
      (o.bio ? '<p class="bio">' + esc(o.bio) + '</p>' : '') + '</div></div>' +
      '<p class="small muted" style="margin:12px 0 0">Letti ' + N(X.files) + ' file dell\'export. ' + (X.firstFollower ? 'Il follower più vecchio ti segue dal ' + D(X.firstFollower) + '.' : '') + '</p>' +
      '<div class="actions"><button class="btn ghost sm" data-act="exp-json">Scarica il riepilogo (JSON)</button><button class="btn ghost sm" data-act="print">Stampa o salva PDF</button></div></div>';

    if (X.html && !c.followers && !c.following) {
      h += '<div class="card"><div class="tipc warn"><span class="ic">!</span><div><b>Questo export è in formato HTML</b><p>Lente legge il formato JSON. Richiedi di nuovo i dati scegliendo "Formato: JSON" (vedi le istruzioni sopra).</p></div></div></div>';
    }

    h += '<div class="tiles" style="margin-top:14px">' +
      tile('Follower', N(c.followers), X.newFollowers30 ? '+' + N(X.newFollowers30) + ' negli ultimi 30 giorni' : '') +
      tile('Seguiti', N(c.following), isNum(X.ratio) ? 'rapporto ' + DEC(X.ratio) : '') +
      tile('Reciproci', N(c.mutual), c.following ? PCT((c.mutual / c.following) * 100, 0) + ' dei seguiti' : '') +
      tile('Non ti seguono', N(c.notBack), 'li segui, ma non ti seguono', c.notBack ? 'down' : '') +
      tile('Fan che non segui', N(c.fans), 'ti seguono, tu no') +
      (c.unfollowed ? tile('Unfollow recenti', N(c.unfollowed), 'account che hai smesso di seguire') : '') +
      (c.pending ? tile('Richieste in attesa', N(c.pending), 'inviate da te') : '') +
      tile('Post', N(c.posts), c.reels ? '+ ' + N(c.reels) + ' Reel' : '') +
      (c.stories ? tile('Storie', N(c.stories), 'pubblicate') : '') +
      (c.likes ? tile('Mi piace messi', N(c.likes)) : '') +
      (c.comments ? tile('Commenti scritti', N(c.comments)) : '') + '</div>';

    // confronto con l'export precedente
    if (X.diff) {
      const dd = X.diff;
      h += secTitle('Cosa è cambiato', 'rispetto all\'export del ' + D(dd.since));
      h += '<div class="grid g2"><div class="card"><h3>Hanno smesso di seguirti · ' + N(dd.lost.length) + '</h3>' + peopleHTML(dd.lost.slice(0, 300).map((u) => ({ u })), 'Nessuno: ottimo!') + '</div>' +
        '<div class="card"><h3>Nuovi follower · ' + N(dd.gained.length) + '</h3>' + peopleHTML(dd.gained.slice(0, 300).map((u) => ({ u })), 'Nessun nuovo follower.') + '</div></div>';
    } else if (c.followers) {
      h += '<div class="note" style="margin-top:14px">La prossima volta che carichi un export, Lente ti dirà <b>chi ha smesso di seguirti</b> e chi è arrivato nel frattempo.</div>';
    }

    // elenchi
    if (c.followers || c.following) {
      h += secTitle('Elenchi') + '<div class="card" id="lists"></div>';
    }

    // grafici nel tempo
    const monthCols = (series, what) => columns(series.map((m) => ({ v: m.n, tip: L.fmtMonth(m.k) + '\n' + N(m.n) + ' ' + what })), { months: series.map((m) => L.fmtMonth(m.k)), h: 150, label: what });
    const fbm = X.followersByMonth.slice(-24), gbm = X.followingByMonth.slice(-24);
    if (fbm.length >= 2 || gbm.length >= 2) {
      h += secTitle('Nel tempo', 'ultimi 24 mesi');
      h += '<div class="grid g2">' +
        (fbm.length >= 2 ? '<div class="card"><h3>Nuovi follower al mese</h3><p class="sub">Quando hanno iniziato a seguirti le persone che ti seguono oggi.</p>' + monthCols(fbm, 'nuovi follower') + '</div>' : '') +
        (gbm.length >= 2 ? '<div class="card"><h3>Account che hai iniziato a seguire</h3><p class="sub">Per mese.</p>' + monthCols(gbm, 'nuovi seguiti') + '</div>' : '') + '</div>';
    }
    const pbm = X.postsByMonth.slice(-24);
    if (c.posts + c.reels) {
      h += '<div class="grid g2" style="margin-top:14px">' +
        (pbm.length >= 2 ? '<div class="card"><h3>Post e Reel al mese</h3>' + monthCols(pbm, 'post') + '</div>' : '') +
        '<div class="card"><h3>Quando pubblichi</h3><p class="sub">Numero di post per giorno e fascia oraria.</p>' + heatmap(X.postHeat, { counts: true, label: 'Post per giorno e ora' }) + '</div></div>';
      h += '<div class="grid g2" style="margin-top:14px"><div class="card"><h3>Hashtag che usi di più</h3>' + hbars(X.tags.slice(0, 10).map((t) => ({ k: '#' + t.k, v: t.n, text: N(t.n) })), { empty: 'Nessun hashtag nelle tue didascalie.' }) + '</div>' +
        '<div class="card"><h3>Formati</h3>' + hbars(X.postTypes.map((t) => ({ k: t.label, v: t.n, text: N(t.n) }))) + (isNum(X.avgCaption) ? '<p class="small muted" style="margin:12px 0 0">Didascalie lunghe in media ' + N(X.avgCaption) + ' caratteri.</p>' : '') + '</div></div>';
    }

    // attività
    if (X.topLiked.length || X.topCommented.length) {
      h += secTitle('La tua attività');
      const lb = X.likesByMonth.slice(-24);
      h += '<div class="grid g2">' +
        '<div class="card"><h3>A chi metti più mi piace</h3>' + hbars(X.topLiked.slice(0, 10).map((x) => ({ k: '@' + x.k, href: igUrl(x.k), v: x.n, text: N(x.n) })), { empty: 'Nessun dato.' }) + '</div>' +
        '<div class="card"><h3>Dove commenti di più</h3>' + hbars(X.topCommented.slice(0, 10).map((x) => ({ k: '@' + x.k, href: igUrl(x.k), v: x.n, text: N(x.n) })), { empty: 'Nessun commento con l\'autore del post.' }) + '</div></div>';
      if (lb.length >= 2) h += '<div class="card" style="margin-top:14px"><h3>Mi piace messi al mese</h3>' + monthCols(lb, 'mi piace') + '</div>';
    }
    if (X.topStoryLikes.length) h += '<div class="card" style="margin-top:14px"><h3>Storie a cui metti più mi piace</h3>' + hbars(X.topStoryLikes.slice(0, 10).map((x) => ({ k: '@' + x.k, href: igUrl(x.k), v: x.n, text: N(x.n) }))) + '</div>';
    if (X.threads.length) {
      h += '<div class="card" style="margin-top:14px"><h3>Conversazioni più attive</h3><p class="sub">Numero di messaggi (Lente non legge il testo dei messaggi).</p>' +
        hbars(X.threads.slice(0, 10).map((t) => ({ k: t.title || 'Conversazione', v: t.n, text: N(t.n), tip: (t.title || 'Conversazione') + '\n' + N(t.n) + ' messaggi' + (t.first ? '\ndal ' + D(t.first) + ' al ' + D(t.last) : '') }))) + '</div>';
    }
    if (X.interests.length) h += '<div class="card" style="margin-top:14px"><h3>I tuoi interessi secondo Instagram</h3><p class="sub">Quelli che Instagram usa per scegliere le pubblicità e i contenuti consigliati.</p><div class="chips">' + X.interests.slice(0, 80).map((t) => '<span class="chip">' + esc(t) + '</span>').join('') + '</div></div>';

    $('#result').innerHTML = h;
    if (c.followers || c.following) renderLists();
  }
  function peopleHTML(list, empty) {
    if (!list.length) return '<p class="muted small">' + esc(empty || 'Nessuno.') + '</p>';
    return '<div class="people">' + list.map((x) => '<div class="person"><span class="ini">' + esc(initial(x.u)) + '</span><a href="' + igUrl(x.u) + '" target="_blank" rel="noopener">@' + esc(x.u) + '</a>' + (x.ts ? '<small>' + D(x.ts) + '</small>' : '') + '</div>').join('') + '</div>';
  }
  function currentList() {
    const { X } = S.exp;
    const all = X.lists[S.list.tab] || [];
    const q = S.list.q.trim().toLowerCase().replace(/^@/, '');
    return q ? all.filter((x) => x.u.includes(q)) : all;
  }
  function renderLists() {
    const box = $('#lists'); if (!box || !S.exp) return;
    const { X } = S.exp;
    const avail = LISTS.filter(([k], i) => i < 5 || (X.lists[k] && X.lists[k].length));
    const meta = LISTS.find((l) => l[0] === S.list.tab) || LISTS[0];
    const list = currentList();
    let h = '<div class="ltabs">' + avail.map(([k, l]) => '<button class="chip" data-act="list-tab" data-l="' + k + '" aria-pressed="' + (S.list.tab === k) + '">' + esc(l) + ' · ' + N((X.lists[k] || []).length) + '</button>').join('') + '</div>';
    h += '<div class="row"><div class="grow at"><input class="in" id="listQ" type="search" placeholder="cerca un nome utente" value="' + esc(S.list.q) + '" aria-label="Cerca nell\'elenco"></div>' +
      '<button class="btn ghost sm" data-act="list-copy">Copia i nomi</button><button class="btn ghost sm" data-act="list-csv">Scarica CSV</button></div>';
    if (meta[2]) h += '<p class="small muted" style="margin:10px 0 0">' + esc(meta[2]) + (S.list.tab === 'notBack' ? '. Attenzione: ci sono anche artisti, brand e pagine che normalmente non ricambiano.' : '') + '</p>';
    h += '<div id="listBody">' + peopleHTML(list.slice(0, S.list.show), S.list.q ? 'Nessun risultato.' : 'Elenco vuoto.') + '</div>';
    if (list.length > S.list.show) h += '<div class="row" style="margin-top:10px"><button class="btn ghost sm" data-act="list-more">Mostra altri (' + N(list.length - S.list.show) + ')</button></div>';
    box.innerHTML = h;
    const q = $('#listQ');
    q.addEventListener('input', () => {
      S.list.q = q.value; S.list.show = 120;
      const l = currentList();
      $('#listBody').innerHTML = peopleHTML(l.slice(0, S.list.show), S.list.q ? 'Nessun risultato.' : 'Elenco vuoto.');
      const more = box.querySelector('[data-act="list-more"]');
      if (more) more.parentElement.remove();
      if (l.length > S.list.show) $('#listBody').insertAdjacentHTML('afterend', '<div class="row" style="margin-top:10px"><button class="btn ghost sm" data-act="list-more">Mostra altri (' + N(l.length - S.list.show) + ')</button></div>');
    });
  }

  /* lettura dei file scelti o trascinati */
  async function filesFromDrop(dt) {
    const entries = [...(dt.items || [])].map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
    if (!entries.length) return [...(dt.files || [])].map((f) => ({ file: f, path: f.name }));
    const out = [];
    async function walk(entry, path) {
      if (entry.isFile) {
        if (/\.(zip|json|html?)$/i.test(entry.name)) { const f = await new Promise((res, rej) => entry.file(res, rej)); out.push({ file: f, path: path + entry.name }); }
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch;
        do {
          batch = await new Promise((res, rej) => reader.readEntries(res, rej));
          for (const e of batch) await walk(e, path + entry.name + '/');
        } while (batch.length);
      }
    }
    for (const e of entries) await walk(e, '');
    return out;
  }
  async function handleFiles(items) {
    if (!items.length) return;
    status('#expStatus', 'Leggo i file…'); prog('#expProg', 0.05);
    try {
      const texts = [];
      let zips = 0;
      for (const { file, path } of items) {
        if (/\.zip$/i.test(file.name)) {
          zips++;
          const { files } = await L.readExportZip(file, (i, n) => { prog('#expProg', i / n); status('#expStatus', 'Leggo lo ZIP… ' + i + ' di ' + n + ' file utili'); });
          texts.push(...files);
        } else if (L.kindOf(path) || L.kindOf(file.name)) {
          texts.push({ path, text: await file.text() });
        } else if (L.looksLikeHtmlExport(path)) texts.push({ path, text: '' });
      }
      const R = L.parseExport(texts);
      prog('#expProg', null);
      if (!R.files) {
        status('#expStatus', R.html ? 'Questo export è in formato HTML: richiedilo di nuovo scegliendo "Formato: JSON".' : zips ? 'Nello ZIP non trovo i file dell\'export di Instagram (followers_1.json, following.json, posts_1.json…).' : 'Non trovo file dell\'export di Instagram tra quelli scelti.', true);
        return;
      }
      status('#expStatus', 'Fatto: letti ' + R.files + ' file.' + (R.errors.length ? ' ' + R.errors.length + ' file non erano leggibili.' : ''));
      showExport(R);
    } catch (e) {
      prog('#expProg', null);
      status('#expStatus', 'Non riesco a leggere i file: ' + errText(e), true);
    }
  }
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', async (e) => { handleFiles(await filesFromDrop(e.dataTransfer)); });
  $('#zipIn').addEventListener('change', (e) => { handleFiles([...e.target.files].map((f) => ({ file: f, path: f.webkitRelativePath || f.name }))); e.target.value = ''; });
  $('#dirIn').addEventListener('change', (e) => { handleFiles([...e.target.files].filter((f) => /\.(json|html?|zip)$/i.test(f.name)).map((f) => ({ file: f, path: f.webkitRelativePath || f.name }))); e.target.value = ''; });
  function demoExport() { showExport(L.parseExport(L.demoExportFiles())); }
  $('#demoExport').addEventListener('click', demoExport);

  /* ================= API di Meta ================= */
  function api() { return L.makeApi({ token: TOKEN, version: DB.settings.version || L.API_VERSION }); }
  function currentAcc() { return (DB.settings.accounts || []).find((a) => a.id === DB.settings.igId) || null; }
  function renderApi() {
    const kind = TOKEN ? L.tokenKind(TOKEN) : '';
    const ready = !!TOKEN && !!DB.settings.igId;
    $('#apiConnect').classList.toggle('hidden', ready);
    $('#apiReady').classList.toggle('hidden', !ready);
    $('#apiVer').value = DB.settings.version || L.API_VERSION;
    $('#igIdIn').value = DB.settings.igId || '';
    $('#maxPosts').value = String(DB.settings.maxPosts || 50);
    $('#remember').checked = !!DB.settings.token;
    if (!ready) return;
    const a = currentAcc();
    $('#apiWho').textContent = a ? 'Collegato come @' + a.username + (a.page ? ' (Pagina: ' + a.page + ')' : '') : 'Collegato all\'account ' + DB.settings.igId;
    const accs = DB.settings.accounts || [];
    $('#accList').innerHTML = accs.length > 1 ? '<div class="small muted" style="margin-bottom:6px">Account da usare per le richieste:</div>' + accs.map((x) => '<button class="acc" data-act="acc" data-id="' + esc(x.id) + '" aria-pressed="' + (x.id === DB.settings.igId) + '"><span class="mini">' + avatarHTML(x) + '</span><span><b>@' + esc(x.username) + '</b><br><span class="small muted">' + (isNum(x.followers) ? C(x.followers) + ' follower' : '') + (x.page ? ' · ' + esc(x.page) : '') + '</span></span></button>').join('') : '';
    const ig = kind === 'ig';
    $('#uname').disabled = ig; $('#discoverBtn').disabled = ig;
    $('#uname').placeholder = ig ? 'serve un token EAA per altri profili' : 'nomeutente';
  }
  async function connect() {
    const tok = $('#tok').value.trim();
    if (!tok) { status('#apiStatus', 'Incolla prima il token.', true); return; }
    status('#apiStatus', 'Collego…'); prog('#apiProg', 0.3);
    const prevTok = TOKEN;
    TOKEN = tok;
    try {
      let accs = [];
      try { accs = await api().accounts(); } catch (e) { if (!$('#igIdIn').value.trim()) throw e; }
      const manual = $('#igIdIn').value.trim();
      if (!accs.length && !manual) throw new Error('Nessun account Instagram Business o Creator collegato alle tue Pagine Facebook. Controlla il collegamento (vedi la Guida) oppure scrivi l\'ID dell\'account nelle impostazioni avanzate.');
      DB.settings.accounts = accs.map((a) => ({ id: a.id, username: a.username, name: a.name, avatar: safeImg(a.avatar), followers: a.followers, page: a.page }));
      DB.settings.igId = manual && !accs.some((a) => a.id === manual) && !accs.length ? manual : (accs.find((a) => a.id === manual) || accs[0]).id;
      DB.settings.token = $('#remember').checked ? tok : '';
      sess.set('lente.token', tok);
      save();
      $('#tok').value = '';
      status('#apiStatus', 'Collegato.');
      renderApi();
      $('#uname').focus();
    } catch (e) {
      TOKEN = prevTok;
      status('#apiStatus', errText(e), true);
    } finally { prog('#apiProg', null); }
  }
  function disconnect() {
    TOKEN = ''; DB.settings.token = ''; DB.settings.igId = ''; DB.settings.accounts = [];
    sess.set('lente.token', ''); save(); renderApi(); status('#apiStatus', 'Scollegato. Il token è stato cancellato da questo dispositivo.');
  }
  let busy = false;
  async function discover(username) {
    const u = L.cleanUser(username || $('#uname').value).replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/[/?#].*$/, '');
    if (!u) { status('#apiStatus', 'Scrivi il nome utente da analizzare.', true); return; }
    if (busy) return; busy = true;
    const max = +$('#maxPosts').value || 50;
    DB.settings.maxPosts = max; save();
    status('#apiStatus', 'Leggo @' + u + '…'); prog('#apiProg', 0.05);
    try {
      const P = await api().discover(DB.settings.igId, u, max, (n, tot) => { prog('#apiProg', n / Math.max(tot, 1)); status('#apiStatus', 'Leggo @' + u + '… ' + n + ' post'); });
      status('#apiStatus', 'Fatto: @' + P.username + ', ' + P.posts.length + ' post letti.');
      showProfile(P);
    } catch (e) { status('#apiStatus', errText(e), true); } finally { prog('#apiProg', null); busy = false; }
  }
  async function own() {
    if (busy) return; busy = true;
    const max = +$('#maxPosts').value || 50;
    status('#apiStatus', 'Leggo il tuo account…'); prog('#apiProg', 0.05);
    try {
      const P = await api().own(DB.settings.igId, max, true, (phase, n, tot) => {
        prog('#apiProg', phase === 'media' ? 0.4 * (n / Math.max(tot, 1)) : 0.4 + 0.6 * (n / Math.max(tot, 1)));
        status('#apiStatus', phase === 'media' ? 'Leggo i post… ' + n : 'Leggo gli insights… ' + n + ' di ' + tot);
      });
      status('#apiStatus', 'Fatto: @' + P.username + ', ' + P.posts.length + ' post con insights.');
      showProfile(P);
    } catch (e) { status('#apiStatus', errText(e), true); } finally { prog('#apiProg', null); busy = false; }
  }
  $('#connectBtn').addEventListener('click', connect);
  $('#tok').addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });
  $('#disconnectBtn').addEventListener('click', disconnect);
  $('#discoverBtn').addEventListener('click', () => discover());
  $('#uname').addEventListener('keydown', (e) => { if (e.key === 'Enter') discover(); });
  $('#ownBtn').addEventListener('click', own);
  $('#remember').addEventListener('change', () => { if (TOKEN && DB.settings.igId) { DB.settings.token = $('#remember').checked ? TOKEN : ''; save(); } });
  $('#saveAdv').addEventListener('click', () => {
    DB.settings.version = $('#apiVer').value.trim() || L.API_VERSION;
    const id = $('#igIdIn').value.trim();
    if (id && TOKEN) DB.settings.igId = id;
    save(); renderApi(); toast('Impostazioni salvate');
  });

  /* ================= CSV e dati a mano ================= */
  const TYPES = [['image', 'Foto'], ['carousel', 'Carosello'], ['reel', 'Reel'], ['video', 'Video']];
  function renderRows() {
    if (!S.rows.length) { $('#rows').innerHTML = ''; return; }
    $('#rows').innerHTML = '<div class="tbl-wrap"><table class="tbl" style="min-width:560px"><thead><tr><th>Data e ora</th><th>Tipo</th><th class="n">Mi piace</th><th class="n">Commenti</th><th class="n">Visual.</th><th></th></tr></thead><tbody>' +
      S.rows.map((r, i) => '<tr data-i="' + i + '"><td><input class="in" type="datetime-local" data-f="date" value="' + esc(r.date) + '" aria-label="Data"></td>' +
        '<td><select class="in" data-f="type" aria-label="Tipo">' + TYPES.map(([k, l]) => '<option value="' + k + '"' + (r.type === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></td>' +
        ['likes', 'comments', 'views'].map((f) => '<td><input class="in" inputmode="numeric" data-f="' + f + '" value="' + esc(r[f]) + '" style="text-align:right" aria-label="' + f + '"></td>').join('') +
        '<td><button class="btn ghost sm" data-act="row-del" aria-label="Togli il post">×</button></td></tr>').join('') + '</tbody></table></div>';
  }
  $('#rows').addEventListener('input', (e) => { const tr = e.target.closest('tr[data-i]'); if (tr && e.target.dataset.f) S.rows[+tr.dataset.i][e.target.dataset.f] = e.target.value; });
  $('#addRow').addEventListener('click', () => {
    const d = new Date(Date.now() - 2 * L.DAY); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    S.rows.push({ date: d.toISOString().slice(0, 16), type: 'image', likes: '', comments: '', views: '' });
    renderRows();
  });
  $('#tplBtn').addEventListener('click', () => {
    download('modello-lente.csv', '﻿data;tipo;mi piace;commenti;visualizzazioni;didascalia;link\r\n03/11/2026 18:30;reel;1250;48;15400;Nuovo singolo fuori ora! #musica;\r\n31/10/2026 13:05;carosello;980;31;;Le foto del live #concerto;\r\n28/10/2026 19:40;foto;640;12;;Studio day ☕️;\r\n', 'text/csv;charset=utf-8');
  });
  $('#csvIn').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const text = await f.text();
    $('#csvText').value = text;
    const r = L.csvToPosts(text);
    if (r.meta.username && !$('#mUser').value) $('#mUser').value = r.meta.username;
    if (r.meta.name && !$('#mName').value) $('#mName').value = r.meta.name;
    status('#csvStatus', r.posts.length ? 'Lette ' + r.posts.length + ' righe da ' + f.name + '. ' + r.warnings.join(' ') + (r.posts.length && !$('#mFollowers').value ? ' Ora scrivi i follower e premi Analizza.' : '') : r.warnings.join(' '), !r.posts.length);
    e.target.value = '';
  });
  function manual() {
    const text = $('#csvText').value.trim();
    let posts = [], warnings = [], meta = {};
    if (text) { const r = L.csvToPosts(text); posts = r.posts; warnings = r.warnings; meta = r.meta; }
    S.rows.forEach((r, i) => {
      const ts = r.date ? new Date(r.date).getTime() : null;
      if (!ts || isNaN(ts)) return;
      posts.push({ id: 'm' + i, ts, type: r.type, likes: L.parseNum(r.likes), comments: L.parseNum(r.comments), views: L.parseNum(r.views), caption: '' });
    });
    const followers = L.parseNum($('#mFollowers').value);
    if (!followers && !posts.length) { status('#csvStatus', 'Scrivi almeno i follower e qualche post (o carica un CSV).', true); return; }
    if (!followers) { status('#csvStatus', 'Scrivi i follower: servono per calcolare l\'engagement rate.', true); $('#mFollowers').focus(); return; }
    if (text && !posts.length && warnings.length) { status('#csvStatus', warnings.join(' '), true); return; }
    const bio = $('#mBio').value.trim(), site = $('#mSite').value.trim();
    const P = {
      source: text ? 'csv' : 'manual', username: L.cleanUser($('#mUser').value) || meta.username || 'profilo', name: $('#mName').value.trim() || meta.name || '',
      followers, following: L.parseNum($('#mFollowing').value), postsCount: L.parseNum($('#mPosts').value), posts, fetchedAt: Date.now(),
    };
    if (bio || site) { P.bio = bio; P.website = site; P.source = 'manual'; }
    status('#csvStatus', posts.length + ' post pronti. ' + warnings.join(' '));
    showProfile(P);
  }
  $('#manualBtn').addEventListener('click', manual);

  /* ================= esempi ================= */
  $('#demo1').addEventListener('click', () => showProfile(L.demoProfile(1)));
  document.addEventListener('click', (e) => { if (e.target.closest('[data-try-demo]')) { e.preventDefault(); setSrc('demo'); showProfile(L.demoProfile(1)); } });
  $('#demo2').addEventListener('click', () => showProfile(L.demoProfile(2)));
  $('#demo3').addEventListener('click', demoExport);

  /* ================= archivio ================= */
  function freeColor() { for (let c = 1; c <= 4; c++) if (!S.compare.some((x) => x.c === c)) return c; return 0; }
  function toggleCompare(key) {
    const i = S.compare.findIndex((x) => x.key === key);
    if (i >= 0) S.compare.splice(i, 1);
    else { if (S.compare.length >= 4) { toast('Puoi confrontare al massimo 4 profili'); return; } S.compare.push({ key, c: freeColor() }); }
  }
  const aCache = new Map();
  function analysisOf(rec) {
    const k = rec.key + '@' + rec.at;
    if (!aCache.has(k)) aCache.set(k, L.analyze(rec.last, rec.at));
    return aCache.get(k);
  }
  function renderArchive() {
    const box = $('#v-archive');
    S.compare = S.compare.filter((x) => DB.profiles[x.key]);
    const recs = Object.values(DB.profiles).sort((a, b) => b.at - a.at);
    let h = '<div class="hero-intro"><h1>Archivio</h1><p>I profili che hai analizzato, salvati su questo dispositivo. Analizzandoli di nuovo nel tempo vedi la crescita; selezionane da 2 a 4 per confrontarli.</p></div>';
    h += '<div class="row noprint" style="margin-bottom:14px"><button class="btn ghost sm" data-act="arch-export"' + (recs.length ? '' : ' disabled') + '>Esporta l\'archivio</button><label class="btn ghost sm" for="archIn">Importa un archivio</label>' +
      (recs.length ? '<button class="btn danger sm" data-act="arch-clear">' + (S.delArm === '*' ? 'Tocca di nuovo per cancellare tutto' : 'Cancella tutto') + '</button>' : '') + '<input type="file" id="archIn" accept=".json,application/json" class="hidden"></div>';
    if (!recs.length) {
      h += '<div class="card"><h2>Ancora nessun profilo</h2><p class="sub">Analizza un profilo e lo ritrovi qui.</p><button class="btn pri" data-act="arch-demo">Prova con i profili d\'esempio</button></div>';
    } else {
      h += '<div class="arch">' + recs.map((r) => {
        const g = L.growthOf(r.history);
        const sel = S.compare.find((x) => x.key === r.key);
        return '<div class="pc' + (sel ? ' sel' : '') + '"><div class="top"><span class="av">' + avatarHTML(r) + '</span><div class="nm"><b>' + (sel ? '<span class="dotc" style="background:var(--s' + sel.c + ')"></span>' : '') + '@' + esc(r.username) + '</b><span>' + esc(r.name || '') + (r.name ? ' · ' : '') + esc(sourceBadge(r.last || r)) + '</span></div></div>' +
          '<div class="st"><div>Follower<b>' + C(r.summary.followers) + '</b></div><div>ER<b>' + PCT(r.summary.er) + '</b></div><div>Punteggio<b>' + (r.summary.score != null ? r.summary.score : '—') + '</b></div></div>' +
          '<div class="small muted">Ultima analisi ' + D(r.at, true) + (g ? ' · <span class="' + (g.delta >= 0 ? 'up' : 'down') + '">' + (g.delta >= 0 ? '+' : '−') + N(Math.abs(g.delta)) + ' follower</span> dal ' + D(g.from) : '') + ' · ' + N(r.history.length) + ' ' + plural(r.history.length, 'misura', 'misure') + '</div>' +
          '<div class="bt"><button class="btn sec sm" data-act="arch-open" data-key="' + esc(r.key) + '">Apri</button><button class="btn ghost sm" data-act="arch-cmp" data-key="' + esc(r.key) + '" aria-pressed="' + !!sel + '">' + (sel ? '✓ Nel confronto' : 'Confronta') + '</button>' +
          '<button class="btn danger sm" data-act="arch-del" data-key="' + esc(r.key) + '">' + (S.delArm === r.key ? 'Sicuro?' : 'Elimina') + '</button></div></div>';
      }).join('') + '</div>';
      h += '<div id="cmp">' + compareHTML() + '</div>';
    }
    box.innerHTML = h;
    $('#archIn').addEventListener('change', importArchive);
  }
  function compareHTML() {
    if (S.compare.length < 2) return '<div class="note" style="margin-top:16px">Premi <b>Confronta</b> su 2, 3 o 4 profili per vederli fianco a fianco.</div>';
    const items = S.compare.map((x) => { const r = DB.profiles[x.key]; return { r, c: x.c, A: analysisOf(r) }; });
    const M = [
      ['Follower', (A) => A.followers, C, 1],
      ['Seguiti', (A) => A.following, C, 0],
      ['Post', (A) => (A.postsCount != null ? A.postsCount : A.n), C, 0],
      ['Engagement rate', (A) => A.er, (v) => PCT(v), 1],
      ['ER mediano', (A) => A.erMedian, (v) => PCT(v), 1],
      ['Media mi piace', (A) => A.avgLikes, C, 1],
      ['Media commenti', (A) => A.avgComments, C, 1],
      ['Visualizzazioni medie', (A) => A.avgViews, C, 1],
      ['Post a settimana', (A) => A.perWeek, DEC, 1],
      ['Giorni dall\'ultimo post', (A) => A.daysSinceLast, (v) => N(v), -1],
      ['Punteggio', (A) => A.score.total, (v) => N(v), 1],
      ['Formato migliore', (A) => (A.types[0] ? A.types[0].label : null), (v) => esc(v), 0],
      ['Giorno migliore', (A) => (A.bestDay ? L.DAYS_LONG[A.bestDay.i] : null), (v) => esc(v), 0],
      ['Valore indicativo post', (A) => (A.value ? A.value.hi : null), (v, A) => (A.value ? L.fmtEuro(A.value.lo) + '–' + L.fmtEuro(A.value.hi).replace('€ ', '') : '—'), 0],
    ];
    let h = secTitle('Confronto', items.length + ' profili') + '<div class="card"><div class="legend" style="margin:0 0 6px">' + items.map((it) => '<span><span class="dotc" style="background:var(--s' + it.c + ')"></span>@' + esc(it.r.username) + '</span>').join('') + '</div>';
    h += '<div class="tbl-wrap"><table class="tbl" style="min-width:' + (220 + items.length * 140) + 'px"><thead><tr><th></th>' + items.map((it) => '<th class="n"><span class="dotc" style="background:var(--s' + it.c + ')"></span>@' + esc(it.r.username) + '</th>').join('') + '</tr></thead><tbody>';
    for (const [label, get, fmt, better] of M) {
      const vals = items.map((it) => get(it.A));
      if (vals.every((v) => v === null || v === undefined)) continue;
      const nums = vals.filter(isNum);
      const best = better && nums.length > 1 ? (better > 0 ? Math.max(...nums) : Math.min(...nums)) : null;
      h += '<tr><td><b>' + esc(label) + '</b></td>' + vals.map((v, i) => '<td class="n' + (best !== null && v === best ? ' best' : '') + '">' + (v === null || v === undefined ? '—' : fmt(v, items[i].A)) + '</td>').join('') + '</tr>';
    }
    h += '</tbody></table></div><p class="small muted" style="margin:8px 0 0">★ = il valore migliore nella riga.</p></div>';
    const bars = (get, fmt) => hbars(items.filter((it) => isNum(get(it.A))).map((it) => ({ k: '@' + it.r.username, v: get(it.A), c: it.c, dot: it.c, text: fmt(get(it.A)) })));
    h += '<div class="grid g2" style="margin-top:14px">' +
      '<div class="card"><h3>Engagement rate</h3>' + bars((A) => A.er, (v) => PCT(v)) + '</div>' +
      '<div class="card"><h3>Interazioni medie per post</h3>' + bars((A) => A.avgEng, N) + '</div>' +
      '<div class="card"><h3>Follower</h3>' + bars((A) => A.followers, C) + '</div>' +
      '<div class="card"><h3>Post a settimana</h3>' + bars((A) => A.perWeek, DEC) + '</div></div>';
    return h;
  }
  function importArchive(e) {
    const f = e.target.files[0]; if (!f) return;
    f.text().then((t) => {
      const j = JSON.parse(t);
      if (!j || j.app !== 'lente' || !j.profiles) throw new Error('Non è un archivio di Lente.');
      let n = 0;
      for (const k in j.profiles) {
        const inc = j.profiles[k], cur = DB.profiles[k];
        if (!inc || !inc.last) continue;
        if (!cur) { DB.profiles[k] = inc; n++; continue; }
        const hist = [...cur.history, ...inc.history].sort((a, b) => a.at - b.at).filter((s, i, a) => !i || s.at !== a[i - 1].at);
        DB.profiles[k] = inc.at > cur.at ? Object.assign(inc, { history: hist }) : Object.assign(cur, { history: hist });
        n++;
      }
      if (!save()) throw new Error('Spazio del browser pieno.');
      toast('Importati ' + n + ' profili'); renderArchive();
    }).catch((err) => toast('Non riesco a importare: ' + err.message));
    e.target.value = '';
  }

  /* ================= un solo ascoltatore per tutti i pulsanti ================= */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    const key = b.dataset.key;
    if (act !== 'arch-del' && act !== 'arch-clear' && S.delArm) { S.delArm = ''; if (S.view === 'archive' && act.indexOf('arch') !== 0) renderArchive(); }
    switch (act) {
      case 'refresh': {
        const P = S.cur && S.cur.P;
        if (!P) return;
        if (!TOKEN || !DB.settings.igId) { setSrc('api'); toast('Collega prima il token'); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
        setSrc('api');
        if (P.own) own(); else discover(P.username);
        break;
      }
      case 'csv': download('lente-' + S.cur.key + '-' + stamp() + '.csv', L.postsToCSV(S.cur.A.posts), 'text/csv;charset=utf-8'); break;
      case 'json': {
        const { P, A } = S.cur;
        const out = { app: 'lente', tipo: 'analisi', creato: new Date().toISOString(), profilo: trimP(P), risultati: { followers: A.followers, er: A.er, erMediano: A.erMedian, mediaMiPiace: A.avgLikes, mediaCommenti: A.avgComments, postASettimana: A.perWeek, punteggio: A.score, consigli: A.tips, segnali: A.signals, formati: A.types, hashtag: A.tags.slice(0, 50), momentoMigliore: A.bestCell, valoreIndicativo: A.value } };
        download('lente-' + S.cur.key + '-' + stamp() + '.json', JSON.stringify(out, null, 2), 'application/json');
        break;
      }
      case 'exp-json': {
        const X = S.exp.X;
        const out = { app: 'lente', tipo: 'export', creato: new Date().toISOString(), account: X.owner, numeri: X.counts, nonTiSeguono: X.lists.notBack.map((x) => x.u), fan: X.lists.fans.map((x) => x.u), reciproci: X.lists.mutual.map((x) => x.u), cambiamenti: X.diff };
        download('lente-export-' + stamp() + '.json', JSON.stringify(out, null, 2), 'application/json');
        break;
      }
      case 'print': window.print(); break;
      case 'compare-this': {
        const k = S.cur.key;
        if (!S.compare.some((x) => x.key === k)) toggleCompare(k);
        go('archive');
        if (Object.keys(DB.profiles).length < 2) toast('Analizza un altro profilo per confrontarli');
        break;
      }
      case 'tbl-sort': { const k = b.dataset.k; if (S.tbl.k === k) S.tbl.dir *= -1; else { S.tbl.k = k; S.tbl.dir = k === 'type' ? 1 : -1; } renderTable(); break; }
      case 'tbl-type': S.tbl.type = b.dataset.t; S.tbl.show = 25; renderTable(); break;
      case 'tbl-more': S.tbl.show += 25; renderTable(); break;
      case 'list-tab': S.list.tab = b.dataset.l; S.list.q = ''; S.list.show = 120; renderLists(); break;
      case 'list-more': S.list.show += 300; renderLists(); break;
      case 'list-copy': copy(currentList().map((x) => '@' + x.u).join('\n')); break;
      case 'list-csv': download('lente-' + S.list.tab + '-' + stamp() + '.csv', L.listToCSV(currentList(), S.list.tab === 'followers' ? 'Ti segue dal' : 'Data'), 'text/csv;charset=utf-8'); break;
      case 'acc': DB.settings.igId = b.dataset.id; save(); renderApi(); break;
      case 'row-del': { const tr = b.closest('tr[data-i]'); S.rows.splice(+tr.dataset.i, 1); renderRows(); break; }
      case 'arch-open': {
        const r = DB.profiles[key]; if (!r) return;
        setSrc(r.source === 'api' ? 'api' : r.source === 'demo' ? 'demo' : 'csv');
        showProfile(Object.assign({}, r.last), { save: false });
        break;
      }
      case 'arch-cmp': toggleCompare(key); renderArchive(); if (S.compare.length >= 2) setTimeout(() => { const c = $('#cmp'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30); break;
      case 'arch-del':
        if (S.delArm !== key) { S.delArm = key; renderArchive(); return; }
        delete DB.profiles[key]; S.delArm = ''; save(); renderArchive(); toast('Profilo eliminato');
        break;
      case 'arch-clear':
        if (S.delArm !== '*') { S.delArm = '*'; renderArchive(); return; }
        DB.profiles = {}; DB.exportSnaps = []; S.delArm = ''; S.compare = []; save(); renderArchive(); toast('Archivio svuotato');
        break;
      case 'arch-export': download('lente-archivio-' + stamp() + '.json', JSON.stringify({ app: 'lente', v: 1, creato: new Date().toISOString(), profiles: DB.profiles }), 'application/json'); break;
      case 'arch-demo': {
        const a = L.demoProfile(2), b2 = L.demoProfile(1);
        archive(a, L.analyze(a)); archive(b2, L.analyze(b2));
        S.compare = [{ key: 'demo.artista', c: 1 }, { key: 'demo.band', c: 2 }];
        renderArchive();
        break;
      }
    }
  });

  /* ================= avvio ================= */
  applyTheme();
  renderApi();
  fromHash();
  if (!TOKEN) setSrc('api');
})();
