/* Interfaccia. Nessun innerHTML con dati dell'utente: tutto passa da textContent (i file possono contenere testo qualsiasi). */
(function () {
  'use strict';
  const CT = globalThis.CT;
  const { D } = CT;
  const R = CT.report;

  // ------------------------------------------------------------------ utilita'
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'for') el.htmlFor = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'multiple') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const eurFmt = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
  const money = (x) => (x === null || x === undefined ? '—' : eurFmt.format(Number(D(x).toFixed(2))));
  const qty = (x) => (x === null || x === undefined ? '—' : CT.fq(x).replace('.', ','));
  const dmy = R.dmy;
  const pct = (x) => `${D(x).times(100).toFixed(0)}%`;
  const uid = () => Math.random().toString(36).slice(2, 9);

  // ------------------------------------------------------------------ stato e salvataggio
  const state = { files: [], manual: [], resolutions: {}, prices: {}, settings: { year: 2025, rebase2025: false, useCarry: true }, taxpayer: { name: '', cf: '' }, custodians: {}, platforms: [], example: false };
  const ui = { tab: 'files', res: null, error: null, detail: 'cessioni', filter: '', confirmReset: false, toast: '', busy: '', ver: 0, pdf: null, pdfBusy: false, platform: null, method: 'file', confirmRemove: null, manualChoices: false, priceFail: 0 };

  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('dichiarazione-crypto', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbGet(k) { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
  async function idbSet(k, v) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
  let saveTimer;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { idbSet('state', JSON.parse(JSON.stringify(state))).catch(() => {}); } catch (e) { /* archiviazione non disponibile */ } }, 250);
  }
  async function load() {
    try {
      const s = await idbGet('state');
      if (s && Array.isArray(s.files)) {
        Object.assign(state, s, { settings: Object.assign(state.settings, s.settings || {}) });
        if (!Array.isArray(state.platforms)) state.platforms = [];
        for (const f of state.files) {          // progetti salvati prima dell'elenco piattaforme
          if (!f.platform) f.platform = CT.platformOfType(f.type) || 'other';
          if (!state.platforms.includes(f.platform)) state.platforms.push(f.platform);
        }
      }
    } catch (e) { /* archiviazione non disponibile: si parte da zero */ }
  }

  function recompute() {
    try { ui.res = CT.analyze(state); ui.error = null; } catch (e) { console.error(e); ui.res = null; ui.error = e; }
  }
  function changed(nextTab) {
    ui.ver++; ui.pdf = null;
    recompute(); save();
    if (nextTab) ui.tab = nextTab;
    render();
    maybeAutoPrices();
  }
  function toast(msg) {
    ui.toast = msg; render();
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { ui.toast = ''; const el = document.querySelector('.toast'); if (el) el.remove(); }, 3500);
  }
  function resolve(uidKey, resolution, msg) { state.resolutions[uidKey] = resolution; changed(); toast(msg || 'Fatto'); }

  // ------------------------------------------------------------------ salvataggio file (esportazione)
  async function saveFile(name, data, mime) {
    try {
      const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
      if (dl) { await dl.save({ filename: name, data }); toast(`Salvato: ${name}`); return; }
    } catch (e) {
      if (e && e.code === 'declined') return;
    }
    try {
      const blob = new Blob([data], { type: mime || 'text/plain' });
      const a = h('a', { href: URL.createObjectURL(blob), download: name });
      document.body.append(a); a.click(); a.remove();
      toast(`Scaricato: ${name}`);
    } catch (e) { toast('Salvataggio non riuscito: usa il pulsante Copia'); }
  }
  async function copyText(text, label) {
    try { await navigator.clipboard.writeText(text); toast(`${label || 'Testo'} copiato negli appunti`); }
    catch (e) {
      const ta = h('textarea', { class: 'sr' }, text); document.body.append(ta); ta.select();
      try { document.execCommand('copy'); toast(`${label || 'Testo'} copiato negli appunti`); } catch (e2) { toast('Copia non riuscita'); }
      ta.remove();
    }
  }

  // ------------------------------------------------------------------ piattaforme e file
  const P = CT.PLATFORMS;
  const platformOfFile = (f) => f.platform || CT.platformOfType(f.type) || 'other';
  const goPlatforms = () => { ui.tab = 'files'; ui.platform = null; ui.picker = false; render(); window.scrollTo(0, 0); };
  const goAdd = () => { ui.tab = 'files'; ui.platform = null; ui.picker = true; render(); window.scrollTo(0, 0); };   // apre direttamente la scelta di un'altra piattaforma
  function ensurePlatform(k) { if (!Array.isArray(state.platforms)) state.platforms = []; if (!state.platforms.includes(k)) state.platforms.push(k); }

  const EXAMPLE_APP = `Timestamp (UTC),Transaction Description,Currency,Amount,To Currency,To Amount,Native Currency,Native Amount,Native Amount (in USD),Transaction Kind
2025-01-10 10:00:00,Buy BTC,EUR,-1000,BTC,0.01,EUR,1000,1100,viban_purchase
2025-02-01 10:00:00,BTC -> ETH,BTC,-0.01,ETH,0.2,EUR,1200,1300,crypto_exchange
2025-03-01 10:00:00,Sell ETH,ETH,-0.2,EUR,1300,EUR,1300,1400,crypto_viban_exchange
2025-03-05 10:00:00,Earn,CRO,5,,,EUR,0.5,0.55,crypto_earn_interest_paid
2025-03-07 10:00:00,To exchange,CRO,-5,,,EUR,0.5,0.55,crypto_to_exchange_transfer
2025-03-08 10:00:00,Tipo di esempio non gestito,CRO,1,,,EUR,0.1,0.11,tipo_sconosciuto_esempio
`;
  const EXAMPLE_BP = `Transaction ID,Timestamp,Transaction Type,In/Out,Amount Fiat,Fiat,Amount Asset,Asset,Asset market price,Asset market price currency,Asset class,Product ID,Fee,Fee asset,Spread,Spread Currency
E1,2025-01-05T09:05:00+01:00,buy,incoming,500.00,EUR,10.0,XAU,50,EUR,Metal,,5.00,EUR,0,EUR
E2,2025-03-05T09:05:00+01:00,sell,outgoing,350.00,EUR,5.0,XAU,70,EUR,Metal,,3.00,EUR,0,EUR
`;

  /** Aggiunge un file a una piattaforma. Il tipo si riconosce da solo; se e' di un'altra piattaforma viene segnalato. */
  function addFileText(name, text, platformKey) {
    if (state.files.some((f) => f.name === name && f.text === text)) return null;
    const plat = P[platformKey];
    const det = CT.importers.detectType(text);
    let type = det && plat.types.includes(det) ? det : '';
    if (!type && det) type = det;                                  // riconosciuto, ma di un'altra piattaforma
    if (!type && plat.types.length === 1) type = plat.types[0];    // piattaforma con un solo tipo di file
    const f = { id: uid(), name, text, type, account: plat.account && type === 'generic' ? plat.account : '', platform: platformKey };
    state.files.push(f);
    ensurePlatform(platformKey);
    return f;
  }
  async function addFiles(list, platformKey) {
    const plat = P[platformKey];
    let added = 0; const failed = [], skipped = [];
    for (const f of Array.from(list)) {
      try {
        if (/\.zip$/i.test(f.name)) {
          const entries = (await CT.unzip(await f.arrayBuffer())).filter((z) => /\.(csv|txt)$/i.test(z.name));
          for (const z of entries) {
            if (plat.zipPolicy && entries.length > 1 && !plat.zipPolicy(z.name)) { skipped.push(z.name); continue; }
            if (addFileText(z.name, z.text, platformKey)) added++;
          }
        } else if (addFileText(f.name, await f.text(), platformKey)) added++;
      } catch (e) { failed.push(f.name); }
    }
    changed();
    if (added) { ui.askMore = platformKey; render(); }
    toast(added ? `${added} file aggiunti${skipped.length ? ` · ${skipped.length} file dello zip non necessari ignorati` : ''}` : failed.length ? `Non riesco a leggere: ${failed.join(', ')}` : 'File già caricati');
  }
  function loadExample() {
    addFileText('ESEMPIO-crypto.com-app.csv', EXAMPLE_APP, 'cryptocom_app');
    addFileText('ESEMPIO-bitpanda.csv', EXAMPLE_BP, 'bitpanda');
    state.example = true;
    ui.platform = null;
    changed('checks');
  }

  function platformStats(k) {
    const files = state.files.filter((f) => platformOfFile(f) === k);
    const parsed = ui.res ? ui.res.parsed.filter((x) => files.some((f) => f.id === x.file.id)) : [];
    let rows = 0, unknown = 0, errors = 0;
    for (const x of parsed) { if (!x.ok) errors++; else { rows += x.result.rows; unknown += x.result.unknown.reduce((a, u) => a + u.count, 0); } }
    const missing = P[k].kinds.filter((kd) => !files.some((f) => f.type === kd.type));
    return { files, parsed, rows, unknown, errors, missing };
  }

  // ------------------------------------------------------------------ icone
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function svgIcon(paths) {
    const el = document.createElementNS(SVG_NS, 'svg');
    el.setAttribute('viewBox', '0 0 24 24'); el.setAttribute('fill', 'none'); el.setAttribute('stroke', 'currentColor');
    el.setAttribute('stroke-width', '1.7'); el.setAttribute('stroke-linecap', 'round'); el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('aria-hidden', 'true'); el.setAttribute('focusable', 'false');
    for (const d of paths) { const pa = document.createElementNS(SVG_NS, 'path'); pa.setAttribute('d', d); el.appendChild(pa); }
    return el;
  }
  const ICON_FILE = ['M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M14 3v4h4', 'M9 12h6', 'M9 16h6'];
  const ICON_API = ['M9 3v5', 'M15 3v5', 'M7 8h10v3a5 5 0 0 1-10 0V8z', 'M12 16v5'];
  function platIcon(k, small) {
    const p = P[k];
    return h('span', { class: `pico${small ? ' sm' : ''}`, style: `--h:${p.hue}`, 'aria-hidden': 'true' }, svgIcon(p.icon));
  }
  const toolIcon = (paths) => h('span', { class: 'pico', style: '--h:215', 'aria-hidden': 'true' }, svgIcon(paths));

  // ------------------------------------------------------------------ pannello 1: le piattaforme aggiunte + scelta di una nuova
  const isAdded = (k) => (state.platforms || []).includes(k) || platformStats(k).files.length > 0;

  function panelPlatforms() {
    const nodes = [];
    const addedKeys = Object.keys(P).filter(isAdded);
    const free = Object.keys(P).filter((k) => !addedKeys.includes(k));
    if (!addedKeys.length) {
      nodes.push(h('div', { class: 'card' },
        h('h2', null, 'Scegli la piattaforma da aggiungere'),
        h('p', { class: 'muted' }, 'Scegli una piattaforma dall\'elenco, poi decidi se aggiungerla con i file o con le API. Dopo la prima potrai aggiungerne altre: i trasferimenti tra le tue piattaforme vengono riconosciuti da soli.'),
        !state.files.length ? h('div', { class: 'row' }, h('button', { class: 'btn', onclick: loadExample }, 'Prima vedi un esempio')) : null));
      nodes.push(pickerCard(free, false));
    } else {
      nodes.push(h('div', { class: 'card' },
        h('div', { class: 'row between' },
          h('div', null, h('h2', null, 'Le tue piattaforme'), h('p', { class: 'muted small' }, 'Solo quelle che hai scelto. Ognuna può avere più file e dati da API.')),
          h('button', { class: 'btn primary', onclick: () => { ui.tab = 'checks'; render(); window.scrollTo(0, 0); } }, 'Avanti: controlla i dati'))));
      nodes.push(h('ul', { class: 'plist' }, addedKeys.map(platformBlock)));
      if (free.length) nodes.push(ui.picker ? pickerCard(free, true) : h('div', null, h('button', { class: 'btn', onclick: () => { ui.picker = true; render(); } }, '+ Aggiungi un\'altra piattaforma o wallet')));
    }
    nodes.push(optionsCard());
    nodes.push(h('div', { class: 'row' },
      ui.confirmReset
        ? [h('span', { class: 'small' }, 'Cancellare tutte le piattaforme, i file, le scelte e i prezzi?'),
          h('button', { class: 'btn danger', onclick: () => { state.files = []; state.manual = []; state.resolutions = {}; state.prices = {}; state.platforms = []; state.example = false; ui.confirmReset = false; ui.platform = null; ui.picker = false; changed('files'); toast('Dati cancellati'); } }, 'Sì, cancella tutto'),
          h('button', { class: 'btn', onclick: () => { ui.confirmReset = false; render(); } }, 'Annulla')]
        : h('button', { class: 'btn quiet danger', onclick: () => { ui.confirmReset = true; render(); } }, 'Cancella tutti i dati salvati')));
    return h('div', { class: 'stack' }, nodes);
  }

  /** Elenco compatto di scelta: una riga con icona per ogni piattaforma non ancora aggiunta. Scegliere una riga la aggiunge. */
  function pickerCard(keys, closable) {
    return h('div', { class: 'card' },
      h('div', { class: 'row between' },
        h('h2', null, closable ? 'Quale vuoi aggiungere?' : 'Piattaforme e wallet'),
        closable ? h('button', { class: 'btn quiet', onclick: () => { ui.picker = false; render(); } }, 'Chiudi') : null),
      h('ul', { class: 'plist pick' }, keys.map((k) => h('li', null,
        h('button', { class: 'pickrow', 'aria-label': `Aggiungi ${P[k].name}`, onclick: () => openPlatform(k) },
          platIcon(k),
          h('span', { class: 'ptxt' }, h('span', { class: 'pname' }, P[k].name), h('span', { class: 'muted small' }, P[k].blurb),
            h('span', { class: 'chips' }, h('span', { class: `pill ${P[k].native ? 'good' : 'idle'}` }, P[k].native ? 'File' : 'File (modello)'), apiBadge(k))),
          h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'))))));
  }

  function apiBadge(k) {
    const p = P[k], conn = CT.api && CT.api.forPlatform ? CT.api.forPlatform(k) : null;
    if (p.api.status === 'none') return h('span', { class: 'pill idle' }, 'API: non disponibile');
    return conn ? h('span', { class: 'pill warn' }, 'API: sperimentale') : h('span', { class: 'pill idle' }, 'API: in arrivo');
  }

  /** Blocco di una piattaforma gia' aggiunta. */
  function platformBlock(k) {
    const p = P[k], st = platformStats(k);
    const status = !st.files.length ? h('span', { class: 'small' }, 'Nessun dato ancora: scegli come aggiungerlo')
      : h('span', { class: 'small' }, `✓ ${st.files.length} ${st.files.length === 1 ? 'fonte' : 'fonti'} · ${st.rows} ${st.rows === 1 ? 'riga' : 'righe'}`,
        st.unknown ? ` · ${st.unknown} da controllare` : '', st.errors ? ` · ${st.errors} con errori` : '',
        p.kinds.length > 1 && st.missing.length ? ` · mancano: ${st.missing.map((m) => m.label).join(', ')}` : '');
    return h('li', { class: 'prow on' },
      platIcon(k),
      h('div', { class: 'ptxt' }, h('span', { class: 'pname' }, p.name), status),
      h('div', { class: 'pact' }, h('button', { class: 'btn', 'aria-label': `Apri ${p.name}`, onclick: () => openPlatform(k) }, st.files.length ? 'Apri' : 'Aggiungi dati')));
  }

  function openPlatform(k) {
    ensurePlatform(k);
    ui.platform = k; ui.picker = false;
    // se l'API non c'e', l'unica strada e' il file: si seleziona da solo; altrimenti la scelta resta all'utente
    ui.method = CT.api && CT.api.forPlatform && CT.api.forPlatform(k) ? null : 'file';
    save(); render(); window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------------ pannello 2: una piattaforma (scelta API o file)
  function methodChoice(k) {
    const p = P[k], a = p.api, conn = CT.api && CT.api.forPlatform ? CT.api.forPlatform(k) : null;
    const apiOk = !!conn && a.status !== 'none';
    const apiChip = a.status === 'none' ? h('span', { class: 'pill idle' }, 'Non disponibile') : conn ? h('span', { class: 'pill warn' }, 'Sperimentale') : h('span', { class: 'pill idle' }, 'In arrivo');
    const apiDesc = a.status === 'none' ? a.text : conn ? 'Collegamento diretto con una chiave di sola lettura. Sperimentale: non ancora provato con un account reale.' : 'Non ancora disponibile: per ora usa i file.';
    const opt = (m, icon, title, desc, chip, enabled) => h('button', { class: `opt${ui.method === m ? ' sel' : ''}`, disabled: !enabled, 'aria-pressed': ui.method === m ? 'true' : 'false', onclick: () => { ui.method = m; render(); } },
      toolIcon(icon), h('div', { class: 'otxt' }, h('strong', null, title), h('span', { class: 'muted small' }, desc), chip ? h('span', { class: 'chips' }, chip) : null));
    return h('div', { class: 'opts', role: 'group', 'aria-label': 'Come aggiungere i dati' },
      opt('file', ICON_FILE, 'Con i file', 'Carica i file (CSV o .zip) scaricati dalla piattaforma. È la via più completa e verificabile.', p.native ? h('span', { class: 'pill good' }, 'Consigliato') : h('span', { class: 'pill idle' }, 'Modello universale'), true),
      opt('api', ICON_API, 'Con le API', apiDesc, apiChip, apiOk));
  }

  function existingData(k, st) {
    const apiFiles = st.files.filter((f) => String(f.type).startsWith('api_'));
    const otherFiles = st.files.filter((f) => !String(f.type).startsWith('api_'));
    if (!st.files.length) return h('p', { class: 'muted small' }, 'Scegli un metodo per continuare.');
    return h('div', { class: 'stack', style: 'padding:0' },
      otherFiles.length ? h('div', { class: 'card' }, h('h3', null, `File già aggiunti (${otherFiles.length})`), otherFiles.map((f) => fileRow(f, st.parsed.find((x) => x.file.id === f.id), k))) : null,
      apiFiles.map((f) => apiDataCard(f)));
  }

  function panelPlatform(k) {
    const p = P[k], st = platformStats(k);
    const remove = ui.confirmRemove === k
      ? h('span', { class: 'row' }, h('span', { class: 'small' }, 'Rimuovere la piattaforma e i suoi dati?'),
        h('button', { class: 'btn danger', onclick: () => { state.files = state.files.filter((f) => platformOfFile(f) !== k); state.platforms = (state.platforms || []).filter((x) => x !== k); ui.confirmRemove = null; ui.platform = null; changed('files'); toast('Piattaforma rimossa'); } }, 'Sì, rimuovi'),
        h('button', { class: 'btn', onclick: () => { ui.confirmRemove = null; render(); } }, 'Annulla'))
      : h('button', { class: 'btn quiet danger', onclick: () => { ui.confirmRemove = k; render(); } }, 'Rimuovi piattaforma');
    return h('div', { class: 'stack' },
      h('div', null, h('button', { class: 'btn quiet', onclick: goPlatforms }, '← Tutte le piattaforme')),
      h('div', { class: 'card' },
        h('div', { class: 'row between' }, h('div', { class: 'row' }, platIcon(k), h('div', null, h('h2', null, p.name), h('p', { class: 'muted small' }, p.blurb))), remove),
        h('h3', null, 'Come vuoi aggiungere i dati?'), methodChoice(k)),
      ui.method === 'api' ? apiPanel(k) : ui.method === 'file' ? filePanel(k, st) : existingData(k, st));
  }

  // ------------------------------------------------------------------ finestra: "vuoi aggiungere altro?"
  function askMoreModal() {
    const k = ui.askMore;
    if (!k || !P[k]) return null;
    const p = P[k], st = platformStats(k);
    const added = Object.keys(P).filter((x) => (state.platforms || []).includes(x) || platformStats(x).files.length > 0);
    const blk = ui.res ? ui.res.groups.blockCount : 0;
    const close = () => { ui.askMore = null; };
    return h('div', { class: 'modal-back', onclick: (e) => { if (e.target === e.currentTarget) { close(); render(); } } },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'askTitle' },
        h('div', { class: 'row' }, platIcon(k),
          h('div', null, h('h2', { id: 'askTitle' }, `${p.name}: dati aggiunti`),
            h('p', { class: 'muted small' }, `${st.rows} ${st.rows === 1 ? 'riga letta' : 'righe lette'}${st.unknown ? ` · ${st.unknown} da controllare` : ''}${st.errors ? ` · ${st.errors} con errori` : ''}`))),
        h('p', null, 'Vuoi aggiungere un altro wallet o un\'altra piattaforma?'),
        added.length > 1 ? h('div', { class: 'chips' }, added.map((x) => h('span', { class: 'row', style: 'gap:6px' }, platIcon(x, true), h('span', { class: 'small' }, P[x].name)))) : null,
        h('div', { class: 'btns' },
          h('button', { class: 'btn primary', onclick: () => { close(); goAdd(); } }, 'Sì, aggiungi un\'altra piattaforma o wallet'),
          h('button', { class: 'btn', onclick: () => { close(); ui.platform = null; ui.tab = blk ? 'checks' : 'result'; render(); window.scrollTo(0, 0); } }, 'No, avanti: controlla i dati'),
          h('button', { class: 'btn quiet', onclick: () => { close(); render(); } }, `Resto su ${p.name}`))));
  }

  function apiPanel(k) {
    const conn = CT.api && CT.api.forPlatform ? CT.api.forPlatform(k) : null;
    if (conn) return connectorPanel(k, conn);
    const a = P[k].api;
    return h('div', { class: 'card tone-warn' },
      h('div', { class: 'row' }, h('h3', null, a.status === 'none' ? 'Nessuna API disponibile' : 'Collegamento API non ancora disponibile'),
        h('span', { class: `pill ${a.status === 'none' ? 'idle' : 'warn'}` }, a.status === 'none' ? 'Non esiste' : 'In arrivo')),
      h('p', { class: 'muted' }, a.text),
      a.points && a.points.length ? h('ul', { class: 'clean muted small' }, a.points.map((t) => h('li', null, t))) : null,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => { ui.method = 'file'; render(); } }, 'Aggiungi i file')));
  }

  /** Collegamento API vero: le chiavi restano in memoria, non vengono mai salvate e vanno solo alla piattaforma. */
  function connectorPanel(k, c) {
    const p = P[k];
    const existing = state.files.filter((f) => platformOfFile(f) === k && String(f.type).startsWith('api_'));
    const inputs = {}, optInputs = {};
    const fieldEls = c.fields.map((f) => {
      const input = h('input', { type: f.secret ? 'password' : 'text', id: `api_${k}_${f.key}`, placeholder: f.placeholder || '', autocomplete: 'off', spellcheck: 'false' });
      inputs[f.key] = input;
      return h('label', { class: 'field' }, h('span', null, f.label), input);
    });
    const optEls = (c.options || []).map((o) => {
      const input = h('input', { type: 'text', id: `api_${k}_opt_${o.key}`, placeholder: o.placeholder || '', value: o.default || '', autocomplete: 'off' });
      optInputs[o.key] = input;
      return h('label', { class: 'field' }, h('span', null, o.label), input, o.help ? h('span', { class: 'small muted' }, o.help) : null);
    });
    const status = h('div', { id: 'apiStatus', class: 'small', role: 'status', 'aria-live': 'polite' });
    const btn = h('button', { class: 'btn primary', id: 'apiGo', onclick: () => runSync(k, c, inputs, optInputs, btn, status) }, existing.length ? 'Scarica di nuovo lo storico' : 'Collega e scarica lo storico');
    return h('div', { class: 'stack', style: 'padding:0' },
      h('div', { class: 'card tone-warn' },
        h('div', { class: 'row' }, h('h3', null, `Collegamento API di ${p.name}`), h('span', { class: 'pill warn' }, 'Sperimentale')),
        h('p', { class: 'muted' }, 'Costruito sulla documentazione ufficiale e provato solo su risposte simulate, non ancora con un account reale. Dopo il download controlla i saldi (scheda Dettaglio, Giacenze) e confrontali con la piattaforma. Per la dichiarazione il file con lo storico completo resta la via più sicura.')),
      h('div', { class: 'card' }, h('h3', null, 'Come creare la chiave (solo lettura)'),
        h('ol', { class: 'steps' }, c.help.map((x) => h('li', null, x))),
        h('p', { class: 'small muted' }, `Non abilitare mai prelievi o trading. La chiave resta in questa pagina, non viene salvata e viene inviata solo a ${p.name}. A lavoro finito eliminala dalla piattaforma.`)),
      h('div', { class: 'card' }, h('h3', null, 'Collega'),
        h('div', { class: 'fields' }, fieldEls, optEls),
        h('div', { class: 'row' }, btn), status),
      existing.length ? existing.map((f) => apiDataCard(f)) : null,
      h('details', { class: 'card' }, h('summary', null, 'Cosa non viene scaricato'), h('ul', { class: 'clean muted' }, c.limits.map((x) => h('li', null, x)))));
  }

  function apiDataCard(f) {
    const info = f.api || { coverage: [], warnings: [] };
    const rows = (info.coverage || []).map((c) => h('tr', null,
      h('td', null, c.what), h('td', { class: 'num' }, c.count === undefined ? '' : c.count),
      h('td', null, c.from ? `${dmy(CT.taxDate(new Date(c.from)))} - ${c.to ? dmy(CT.taxDate(new Date(c.to))) : ''}` : ''),
      h('td', null, c.complete === false ? h('span', { class: 'pill warn' }, 'Da integrare') : h('span', { class: 'pill good' }, 'Completo')),
      h('td', { class: 'small muted' }, c.note || '')));
    return h('div', { class: 'card' }, h('h3', null, 'Dati scaricati'),
      h('p', { class: 'muted small' }, f.name + (f.disabled ? ' · disattivati (non conteggiati)' : '')),
      rows.length ? h('div', { class: 'tbl-wrap' }, h('table', null, h('thead', null, h('tr', null, ['Cosa', 'Righe', 'Periodo', 'Stato', 'Note'].map((x) => h('th', null, x)))), h('tbody', null, rows))) : null,
      info.warnings && info.warnings.length ? h('ul', { class: 'clean small' }, info.warnings.map((w) => h('li', null, w))) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn quiet', onclick: () => { f.disabled = !f.disabled; changed(); } }, f.disabled ? 'Riattiva' : 'Disattiva'),
        h('button', { class: 'btn quiet danger', onclick: () => { state.files = state.files.filter((y) => y.id !== f.id); changed(); toast('Dati API rimossi'); } }, 'Rimuovi i dati API')));
  }

  async function runSync(k, c, inputs, optInputs, btn, statusEl) {
    const creds = {};
    for (const f of c.fields) creds[f.key] = inputs[f.key].value.trim();
    if (c.fields.some((f) => !creds[f.key])) { toast('Compila tutte le chiavi richieste'); return; }
    const options = {};
    for (const o of c.options || []) options[o.key] = (optInputs[o.key].value || '').trim() || o.default || '';
    const say = (m, bad) => { statusEl.textContent = m; statusEl.className = 'small' + (bad ? ' err' : ''); };
    btn.disabled = true;
    say('Mi collego…');
    try {
      const out = await c.sync(creds, { onProgress: (m) => say(m), options });
      for (const f of c.fields) inputs[f.key].value = '';           // le chiavi non restano nemmeno nei campi
      state.files = state.files.filter((f) => !(platformOfFile(f) === k && String(f.type).startsWith('api_')));
      const t = new Date();
      state.files.push({
        id: uid(), platform: k, type: 'api_' + c.id, account: '', text: JSON.stringify(out.raw),
        name: `${P[k].name} · dati da API · ${t.toLocaleDateString('it-IT')} ${t.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`,
        api: { coverage: out.coverage || [], warnings: out.warnings || [], fetchedAt: (out.raw && out.raw.fetchedAt) || t.toISOString() },
      });
      ensurePlatform(k);
      changed();
      ui.askMore = k; render();
      toast('Storico scaricato: controlla il riepilogo qui sotto');
    } catch (e) {
      if (!(e instanceof CT.ApiError)) console.error(e);
      btn.disabled = false;
      say(e instanceof CT.ApiError ? e.message : `Errore imprevisto: ${e.message}`, true);
      const diag = JSON.stringify({ piattaforma: k, codice: e.code || 'imprevisto', messaggio: e.message, dettaglio: e.detail || {} }, null, 2);
      statusEl.append(' ', h('button', { class: 'btn quiet', onclick: () => copyText(diag, 'Diagnostica dell\'errore') }, 'Copia diagnostica dell\'errore'));
    }
  }

  function filePanel(k, st) {
    const p = P[k];
    const nodes = [];
    if (p.kinds.length > 1) {
      nodes.push(h('div', { class: 'card' }, h('h3', null, 'File che servono'),
        h('ul', { class: 'clean' }, p.kinds.map((kd) => { const n = st.files.filter((f) => f.type === kd.type).length; return h('li', null, n ? '✓ ' : '○ ', kd.label, n ? ` · ${n} caricato${n === 1 ? '' : 'i'}` : ' · mancante'); }))));
    }
    nodes.push(h('div', { class: 'card' }, h('h3', null, 'Come ottenere i file'),
      h('ol', { class: 'steps' }, p.steps.map((x) => h('li', null, x))),
      !p.native ? h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => saveFile('modello-universale.csv', '﻿' + CT.importers.GENERIC_TEMPLATE, 'text/csv') }, 'Scarica il modello universale')) : null));

    const inputId = `fileInput_${k}`;
    const input = h('input', { type: 'file', id: inputId, multiple: true, accept: '.csv,.txt,.zip', class: 'sr', onchange: (e) => { addFiles(e.target.files, k); e.target.value = ''; } });
    const drop = h('label', { class: 'drop', for: inputId },
      h('strong', null, `Trascina qui i file di ${p.name}`),
      h('span', { class: 'muted' }, 'CSV oppure .zip. Puoi caricarne più d\'uno, anche di periodi diversi.'),
      h('span', { class: 'btn primary' }, 'Scegli i file'), input);
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files, k); });
    nodes.push(drop);
    nodes.push(h('p', { class: 'muted small' }, 'I file restano nel tuo browser e non vengono inviati a nessuno.'));

    if (st.files.length) {
      nodes.push(h('div', { class: 'card' }, h('h3', null, `File di ${p.name} (${st.files.length})`),
        st.files.map((f) => fileRow(f, st.parsed.find((x) => x.file.id === f.id), k))));
      nodes.push(h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: () => { ui.platform = null; ui.tab = ui.res && ui.res.groups.blockCount ? 'checks' : 'result'; render(); window.scrollTo(0, 0); } }, 'Avanti: controlla i dati'),
        h('button', { class: 'btn', onclick: goAdd }, 'Aggiungi un\'altra piattaforma')));
    }
    if (p.manual) nodes.push(manualCard());
    nodes.push(h('details', { class: 'card' }, h('summary', null, 'Cosa viene letto e cosa no'), h('ul', { class: 'clean muted' }, p.limits.map((x) => h('li', null, x)))));
    return h('div', { class: 'stack', style: 'padding:0' }, nodes);
  }

  function fileRow(f, x, k) {
    const plat = P[k];
    const meta = [];
    let chip, warn = null;
    const isApi = String(f.type).startsWith('api_');
    if (f.disabled) chip = h('span', { class: 'pill idle' }, 'Disattivato: non conteggiato');
    else if (!x) chip = h('span', { class: 'pill idle' }, '…');
    else if (!x.ok) chip = h('span', { class: 'pill bad' }, x.error);
    else {
      const r = x.result;
      meta.push(h('span', null, `${r.rows} righe`));
      if (r.from) meta.push(h('span', null, `dal ${dmy(CT.taxDate(r.from))} al ${dmy(CT.taxDate(r.to))}`));
      const unk = r.unknown.reduce((a, u) => a + u.count, 0);
      chip = unk ? h('span', { class: 'pill warn' }, `${unk} ${unk === 1 ? 'riga da controllare' : 'righe da controllare'}`) : h('span', { class: 'pill good' }, 'Letto correttamente');
    }
    if (f.type && !plat.types.includes(f.type) && !isApi) {
      const other = CT.platformOfType(f.type);
      warn = h('div', { class: 'row' }, h('span', { class: 'pill warn' }, `Sembra un export di ${P[other].name}`),
        h('button', { class: 'btn', onclick: () => { f.platform = other; ensurePlatform(other); changed(); toast(`Spostato su ${P[other].name}`); } }, `Spostalo su ${P[other].name}`));
    }
    const sel = h('select', { 'aria-label': `Tipo di file per ${f.name}`, onchange: (e) => { f.type = e.target.value; changed(); } },
      h('option', { value: '' }, 'Scegli il tipo di file…'),
      plat.kinds.map((kd) => h('option', { value: kd.type, selected: f.type === kd.type }, kd.label)),
      f.type && !plat.types.includes(f.type) ? h('option', { value: f.type, selected: true }, CT.importers.TYPES[f.type].label) : null);
    const needsDiag = x && !f.disabled && (!x.ok || x.result.unknown.length);
    const selOrApi = isApi ? h('span', { class: 'pill idle' }, 'Dati da API') : sel;
    return h('div', { class: 'file' },
      h('div', null, h('div', { class: 'name' }, f.name), h('div', { class: 'meta' }, meta), h('div', { class: 'row', style: 'margin-top:8px' }, selOrApi, chip), warn ? h('div', { style: 'margin-top:8px' }, warn) : null),
      h('div', { class: 'row' },
        needsDiag ? h('button', { class: 'btn quiet', onclick: () => copyText(R.diagnostics(ui.res, [f]), 'Diagnostica') }, 'Copia diagnostica') : null,
        h('button', { class: 'btn quiet', onclick: () => { f.disabled = !f.disabled; changed(); } }, f.disabled ? 'Riattiva' : 'Disattiva'),
        h('button', { class: 'btn quiet danger', onclick: () => { state.files = state.files.filter((y) => y.id !== f.id); changed(); } }, 'Rimuovi')));
  }

  function manualCard() {
    const F = (label, attrs) => { const input = attrs.options ? h('select', { id: attrs.id }, attrs.options.map(([v, t]) => h('option', { value: v }, t))) : h('input', Object.assign({ type: 'text' }, attrs)); return { input, el: h('label', { class: 'field' }, h('span', null, label), input) }; };
    const date = F('Data', { id: 'm_date', type: 'date', value: `${state.settings.year}-06-30` });
    const tipo = F('Operazione', { id: 'm_tipo', options: [['acquisto', 'Acquisto'], ['vendita', 'Vendita'], ['permuta', 'Scambio tra due asset'], ['provento', 'Provento (staking, interessi…)'], ['pagamento', 'Pagamento con crypto'], ['trasferimento_uscita', 'Trasferimento in uscita'], ['trasferimento_entrata', 'Trasferimento in entrata']] });
    const conto = F('Conto o wallet', { id: 'm_conto', value: 'Wallet personale' });
    const asset = F('Asset (es. BTC)', { id: 'm_asset', placeholder: 'BTC' });
    const q = F('Quantità', { id: 'm_q', placeholder: '0,5' });
    const val = F('Valore in € (se lo conosci)', { id: 'm_v', placeholder: '1500' });
    const asset2 = F('Solo scambi: asset ricevuto', { id: 'm_a2', placeholder: 'ETH' });
    const q2 = F('Solo scambi: quantità ricevuta', { id: 'm_q2', placeholder: '2' });
    const tp = F('Solo proventi: tipo', { id: 'm_tp', options: [['staking', 'Staking'], ['interest', 'Interessi'], ['airdrop', 'Airdrop'], ['cashback', 'Cashback'], ['other', 'Altro']] });
    const add = () => {
      if (!asset.input.value.trim() || !q.input.value.trim() || !date.input.value) { toast('Compila almeno data, asset e quantità'); return; }
      state.manual.push({ id: uid(), data: `${date.input.value} 12:00`, tipo: tipo.input.value, conto: conto.input.value, asset: asset.input.value, quantita: q.input.value, valore_eur: val.input.value,
        asset_ricevuto: asset2.input.value, quantita_ricevuta: q2.input.value, tipo_provento: tp.input.value });
      changed(); toast('Operazione aggiunta');
    };
    return h('details', { class: 'card', open: state.manual.length > 0 || null },
      h('summary', null, 'Wallet personali, altre piattaforme o operazioni mancanti'),
      h('p', { class: 'muted small' }, 'Per i wallet che non hanno un export, per piattaforme non ancora supportate o per un acquisto che non compare nei file: inserisci le operazioni a mano oppure carica un file con il modello universale.'),
      h('div', { class: 'fields' }, date.el, tipo.el, conto.el, asset.el, q.el, val.el, asset2.el, q2.el, tp.el),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: add }, 'Aggiungi operazione'),
        h('button', { class: 'btn', onclick: () => saveFile('modello-universale.csv', '﻿' + CT.importers.GENERIC_TEMPLATE, 'text/csv') }, 'Scarica il modello CSV')),
      state.manual.length ? h('div', { class: 'tbl-wrap' }, h('table', null,
        h('thead', null, h('tr', null, ['Data', 'Operazione', 'Conto', 'Asset', 'Quantità', 'Valore €', ''].map((x) => h('th', null, x)))),
        h('tbody', null, state.manual.map((m) => h('tr', null, h('td', null, dmy(m.data.slice(0, 10))), h('td', null, m.tipo.replace('_', ' ')), h('td', null, m.conto), h('td', null, m.asset),
          h('td', { class: 'num' }, m.quantita), h('td', { class: 'num' }, m.valore_eur), h('td', null, h('button', { class: 'btn quiet danger', onclick: () => { state.manual = state.manual.filter((x) => x.id !== m.id); changed(); } }, 'Elimina'))))))) : null);
  }

  function optionsCard() {
    const s = state.settings;
    const check = (id, key, title, hint) => h('div', { class: 'check' },
      h('input', { type: 'checkbox', id, checked: !!s[key], onchange: (e) => { s[key] = e.target.checked; changed(); } }),
      h('label', { for: id }, h('strong', null, title)), h('span', { class: 'hint muted small' }, hint));
    return h('div', { class: 'card' }, h('h2', null, 'Opzioni di calcolo'),
      check('o_carry', 'useCarry', 'Riporta le minusvalenze degli anni precedenti', 'Le perdite che emergono dai tuoi file (dal 2023) riducono le tasse degli anni successivi, entro 4 anni. Calcolate in automatico: non serve sapere cosa hai dichiarato.'),
      check('o_rebase', 'rebase2025', 'Ho rideterminato il costo al 1° gennaio 2025', 'Facoltativo e raro: pagando un\'imposta del 18% sul valore delle cripto possedute il 1/1/2025, quel valore diventa il nuovo costo di acquisto. Se non sai di cosa si tratta lascia spento: vuol dire che non l\'hai fatto.'));
  }

  // ------------------------------------------------------------------ pannello: Da controllare
  function field(label, attrs) { const input = h('input', Object.assign({ type: 'text' }, attrs)); return { input, el: h('label', { class: 'field' }, h('span', null, label), input) }; }

  function issueCard(tone, title, body, ...rest) {
    return h('div', { class: `card tone-${tone}` }, h('h3', null, title), body ? h('p', { class: 'muted' }, body) : null, ...rest);
  }
  function needNumber(v, what) {
    const t = String(v).trim().replace(',', '.');
    if (!t || Number.isNaN(Number(t)) || Number(t) < 0) { toast(`Inserisci ${what} (un numero, es. 1500)`); return null; }
    return t;
  }

  /** Risposte consigliate per i punti con una scelta chiara: duplicati tra file e conversioni di saldo. */
  function recommended(res) {
    const out = [];
    for (const i of res.groups.nearDup) {
      const d = i.data;
      out.push({ kind: 'dup', uid: i.uid, action: 'dup_skip', text: `${d.count === 1 ? 'Un\'operazione compare' : d.count + ' operazioni compaiono'} in più file (${d.names.join(', ')}): sono le stesse, le conto una volta sola.` });
    }
    for (const i of res.groups.conversions) {
      const same = i.data.qty.minus(i.data.counterQty).abs().lte(i.data.qty.times('0.001'));
      out.push({ kind: 'conv', uid: i.uid, action: same ? 'migration' : 'swap',
        text: same ? `${i.message}: stessa quantità, è un cambio di nome o una migrazione del token, non una vendita (nessuna tassa, il costo di acquisto passa al nuovo token).`
          : `${i.message}: quantità diverse, è una vera conversione, quindi una vendita imponibile.` });
    }
    return out;
  }

  /** Pulsante grande per il passo successivo: chi usa il programma deve sempre sapere cosa fare adesso. */
  function nextBar(label, tab, primary, back) {
    return h('div', { class: 'row', style: 'margin-top:8px' },
      back ? h('button', { class: 'btn quiet', onclick: () => { ui.tab = back[1]; render(); window.scrollTo(0, 0); } }, back[0]) : null,
      h('button', { class: `btn${primary ? ' primary' : ''}`, style: 'min-height:48px;font-size:16px', onclick: () => { ui.tab = tab; render(); window.scrollTo(0, 0); } }, label));
  }

  function panelChecks() {
    const res = ui.res;
    if (!res) return noData();
    const g = res.groups;
    const out = [];
    if (!g.blockCount) out.push(h('div', { class: 'card tone-good' }, h('h2', null, 'Tutto a posto'), h('p', { class: 'muted' }, 'Non ci sono punti da risolvere. Controlla comunque i saldi finali nella scheda Dettaglio e confrontali con quelli che vedi nelle piattaforme.')));
    else out.push(h('div', { class: 'card tone-warn' }, h('h2', null, g.blockCount === 1 ? '1 cosa da controllare' : `${g.blockCount} cose da controllare`), h('p', { class: 'muted' }, 'Finché non le sistemi, il Risultato è una bozza. Qui sotto trovi solo quello che il programma non può sapere da solo.')));

    // scelte consigliate: per i punti in cui la risposta piu' probabile e' chiara le propongo tutte insieme, accettabili con un clic
    const rec = recommended(res);
    if (rec.length && !ui.manualChoices) {
      out.push(h('div', { class: 'card tone-warn' },
        h('h3', null, rec.length === 1 ? 'Ho preparato una scelta per te' : `Ho preparato ${rec.length} scelte per te`),
        h('p', { class: 'muted' }, 'Per questi punti non posso saperlo con certezza, ma la risposta più probabile è chiara. Se la accetti la segno tra le decisioni (le trovi in fondo a questa pagina e nei PDF) e puoi cambiarla quando vuoi.'),
        h('ul', { style: 'display:grid;gap:8px;padding-left:20px' }, rec.map((r) => h('li', null, r.text))),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: () => { rec.forEach((r) => { state.resolutions[r.uid] = { action: r.action }; }); changed(); toast('Scelte accettate'); } }, rec.length === 1 ? 'Va bene, accetta' : 'Va bene, accetta tutte'),
          h('button', { class: 'btn quiet', onclick: () => { ui.manualChoices = true; render(); } }, 'Preferisco decidere io'))));
    }
    // prima le domande che cambiano il conteggio delle operazioni: le schede che ne dipendono (storico mancante, trasferimenti) vengono dopo
    if (g.nearDup.length && (ui.manualChoices || !rec.some((r) => r.kind === 'dup'))) {
      const applyAll = (action, msg) => { g.nearDup.forEach((i) => { state.resolutions[i.uid] = { action }; }); changed(); toast(msg); };
      for (const i of g.nearDup) {
        const d = i.data;
        out.push(issueCard('bad', `Sembra la stessa operazione in più file (${d.count})`,
          `In ${d.names.map((x) => `«${x}»`).join(' e in ')} ${d.count === 1 ? 'c\'è un\'operazione' : 'ci sono ' + d.count + ' operazioni'} con la stessa data (entro 5 minuti), lo stesso asset e la stessa quantità. Di solito sono le stesse operazioni esportate due volte (per esempio l'export «contanti» e quello «criptovaluta»): se le contassi due volte, acquisti e vendite risulterebbero doppi.`,
          h('ul', { class: 'clean muted small' }, d.examples.map((m) => h('li', null, m))),
          h('div', { class: 'row' },
            h('button', { class: 'btn primary', onclick: () => resolve(i.uid, { action: 'dup_skip' }, 'Contate una volta sola') }, 'Sono le stesse: contale una volta'),
            h('button', { class: 'btn', onclick: () => resolve(i.uid, { action: 'ack' }, 'Annotato: sono operazioni diverse') }, 'Sono diverse: tienile tutte'))));
      }
      if (g.nearDup.length > 1) out.push(h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => applyAll('dup_skip', 'Contate una volta sola') }, `Sono le stesse in tutti i casi (${g.nearDup.length})`),
        h('button', { class: 'btn', onclick: () => applyAll('ack', 'Annotato: sono operazioni diverse') }, 'Sono sempre diverse')));
    }
    if (g.conversions.length && (ui.manualChoices || !rec.some((r) => r.kind === 'conv'))) {
      const setAll = (action, msg) => { g.conversions.forEach((i) => { state.resolutions[i.uid] = { action }; }); changed(); toast(msg); };
      const WHAT = 'Crypto.com ha convertito da solo questo saldo in un altro token (per esempio quando un token cambia nome o viene aggiornato). Se è un aggiornamento 1 a 1 dello stesso token non è una vendita: nessuna tassa e il costo di acquisto passa al nuovo token. Se lo consideri uno scambio tra cripto diverse, è una vendita imponibile.';
      out.push(issueCard('bad', g.conversions.length === 1 ? 'Conversione di saldo da classificare' : `${g.conversions.length} conversioni di saldo da classificare`, WHAT,
        h('ul', { class: 'clean', style: 'display:grid;gap:12px' }, g.conversions.map((i) => {
          // stesse quantita' = di solito cambio di nome o migrazione 1 a 1; quantita' diverse = di solito una vera conversione
          const same = i.data.qty.minus(i.data.counterQty).abs().lte(i.data.qty.times('0.001'));
          return h('li', { class: 'row between' },
            h('span', null, i.message, h('div', { class: 'small muted' }, same ? 'Le quantità sono uguali: di solito è un cambio di nome o una migrazione del token.' : 'Le quantità sono diverse: di solito è una vera conversione in un altro asset, quindi una vendita.')),
            h('span', { class: 'row' },
              h('button', { class: `btn${same ? ' primary' : ''}`, onclick: () => resolve(i.uid, { action: 'migration' }, 'Trattata come aggiornamento del token') }, 'Aggiornamento del token'),
              h('button', { class: `btn${same ? '' : ' primary'}`, onclick: () => resolve(i.uid, { action: 'swap' }, 'Trattata come scambio imponibile') }, 'Scambio imponibile')));
        })),
        g.conversions.length > 1 ? h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => setAll('migration', 'Trattate come aggiornamento del token') }, 'Tutte: aggiornamento del token'),
          h('button', { class: 'btn', onclick: () => setAll('swap', 'Trattate come scambi imponibili') }, 'Tutte: scambio imponibile')) : null));
    }

    for (const i of g.transferOut) {
      const wallet = field('Nome del wallet', { value: 'Wallet personale', id: `w_${i.uid}` });
      const val = field('Valore in € al momento', { placeholder: 'es. 1500', id: `v_${i.uid}` });
      out.push(issueCard('bad', `${qty(i.data.qty)} ${i.data.asset} usciti da ${i.data.account} il ${dmy(i.data.day)}`,
        'Non trovo dove sono arrivati. Se li hai mandati a un tuo wallet non è una vendita. Se li hai venduti o usati per pagare, indica il valore.',
        h('div', { class: 'fields' }, wallet.el, val.el),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: () => resolve(i.uid, { action: 'self_custody', wallet: wallet.input.value || 'Wallet personale' }, 'Registrato come trasferimento a un tuo wallet') }, 'È andato su un mio wallet'),
          h('button', { class: 'btn', onclick: () => { const v = needNumber(val.input.value, 'il valore in euro'); if (v) resolve(i.uid, { action: 'disposal', value_eur: v }, 'Registrato come vendita'); } }, 'Venduto o usato per pagare'),
          h('button', { class: 'btn quiet', onclick: () => resolve(i.uid, { action: 'ignore' }, 'Riga ignorata') }, 'Ignora'))));
    }
    for (const i of g.transferIn) {
      const cost = field('Costo totale pagato (€)', { placeholder: 'es. 800', id: `c_${i.uid}` });
      const when = field('Data di acquisto (facoltativa)', { type: 'date', id: `d_${i.uid}` });
      out.push(issueCard('bad', `${qty(i.data.qty)} ${i.data.asset} arrivati su ${i.data.account} il ${dmy(i.data.day)}`,
        'Non so da dove vengono. Per calcolare l\'eventuale guadagno mi serve quanto li avevi pagati.',
        h('div', { class: 'fields' }, cost.el, when.el),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: () => { const v = needNumber(cost.input.value, 'il costo'); if (v) resolve(i.uid, { action: 'set_cost', cost_eur: v, acquired: when.input.value || undefined }, 'Costo salvato'); } }, 'Salva il costo'),
          h('button', { class: 'btn', onclick: () => resolve(i.uid, { action: 'from_self_custody' }, 'Registrato come ritorno da un tuo wallet') }, 'Arrivano da un mio wallet'),
          h('button', { class: 'btn quiet', onclick: () => resolve(i.uid, { action: 'set_cost', cost_eur: '0' }, 'Costo zero registrato') }, 'Costo zero (regalo, premio…)'))));
    }
    if (g.history.length) {
      const items = g.history;
      const one = items.length === 1;
      const costFields = items.map((i) => {
        const cost = field(`Quanto hai speso in tutto per ${qty(i.data.qty)} ${i.data.asset}? (€)`, { placeholder: 'es. 400', id: `h_${i.uid}` });
        const when = field('Data di acquisto (facoltativa)', { type: 'date', id: `hd_${i.uid}` });
        return h('div', null, h('div', { class: 'fields' }, cost.el, when.el),
          h('button', { class: 'btn', onclick: () => { const v = needNumber(cost.input.value, 'il costo'); if (v) resolve(i.uid, { action: 'cover_cost', cost_eur: v, acquired: when.input.value || undefined }, 'Costo salvato'); } }, 'Salva questo costo'));
      });
      out.push(issueCard('bad', one ? `Non trovo l'acquisto di ${qty(items[0].data.qty)} ${items[0].data.asset}` : `Non trovo gli acquisti di ${items.length} operazioni`,
        'Nei file caricati manca l\'acquisto di quello che hai venduto o convertito. Di solito manca un file più vecchio (dall\'apertura del conto): aggiungilo e il problema sparisce da solo.',
        h('ul', { class: 'clean muted small' }, items.map((i) => h('li', null, `${dmy(i.data.day)} · ${i.data.account} · ${qty(i.data.qty)} ${i.data.asset}`))),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: goAdd }, 'Aggiungi i file più vecchi'),
          h('button', { class: 'btn', onclick: () => { items.forEach((i) => { state.resolutions[i.uid] = { action: 'cover_cost', cost_eur: '0', undocumented: true }; }); changed(); toast('Calcolato con costo 0'); } }, 'Non ho altri file: usa costo 0')),
        h('p', { class: 'small muted' }, 'Con «costo 0» tutto l\'incasso conta come guadagno, quindi paghi più tasse del dovuto: va bene solo se non hai davvero nessun documento. Se ricordi quanto hai speso, scrivilo qui sotto.'),
        h('details', null, h('summary', null, 'Conosco il costo: lo scrivo io'), h('div', { class: 'stack', style: 'padding:8px 0;gap:14px' }, costFields))));
    }
    for (const i of g.overlap) {
      const pk = i.data.platform;
      out.push(issueCard('bad', `${P[pk].name}: dati API e file sullo stesso periodo`,
        'Le stesse operazioni verrebbero contate due volte. Scegli quale fonte tenere: l\'altra viene disattivata, non cancellata.',
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: () => { state.files.forEach((f) => { if (i.data.fileIds.includes(f.id)) f.disabled = true; }); changed(); toast('Uso i dati API: i file sono disattivati'); } }, 'Tieni i dati API'),
          h('button', { class: 'btn', onclick: () => { state.files.forEach((f) => { if (i.data.apiIds.includes(f.id)) f.disabled = true; }); changed(); toast('Uso i file: i dati API sono disattivati'); } }, 'Tieni i file'))));
    }
    if (g.apiIncomplete.length > 1) {
      out.push(issueCard('bad', `${g.apiIncomplete.length} tipi di dati non scaricati dalle API`,
        'Le API non scaricano tutto. Per ognuno qui sotto aggiungi il file della piattaforma oppure conferma di non avere operazioni di quel tipo. Se le conosci già tutte puoi confermarle insieme.',
        h('ul', { class: 'clean muted small' }, g.apiIncomplete.map((i) => h('li', null, `${P[i.data.platform].name}: ${i.data.what}`))),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: () => { g.apiIncomplete.forEach((i) => { state.resolutions[i.uid] = { action: 'ack' }; }); changed(); toast('Annotato: nessuna operazione di questi tipi'); } }, `Non ho operazioni di nessuno di questi tipi (${g.apiIncomplete.length})`),
          h('button', { class: 'btn', onclick: goPlatforms }, 'Ne ho: aggiungo il file'))));
    }
    for (const i of g.apiIncomplete.length > 1 ? [] : g.apiIncomplete) {   // con più voci basta la scheda unica sopra
      out.push(issueCard('bad', `${P[i.data.platform].name} (API): ${i.data.what}`,
        i.data.note || 'Questo tipo di dati non viene scaricato dall\'API oppure lo storico potrebbe essere incompleto.',
        h('p', { class: 'small muted' }, 'Per essere sicuro aggiungi anche il file di questa piattaforma, oppure conferma di non avere operazioni di questo tipo.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: () => { ui.platform = i.data.platform; ui.method = 'file'; ui.tab = 'files'; render(); window.scrollTo(0, 0); } }, 'Aggiungi il file'),
          h('button', { class: 'btn', onclick: () => resolve(i.uid, { action: 'ack' }, 'Annotato: nessuna operazione di questo tipo') }, 'Non ho operazioni di questo tipo'))));
    }
    for (const u of g.unknown.values()) {
      const ex = u.items.slice(0, 3).map((i) => i.message);
      out.push(issueCard('bad', `${u.items.length} righe di tipo sconosciuto`, u.key,
        h('ul', { class: 'clean muted small' }, ex.map((m) => h('li', null, m))),
        /conversione di saldo/.test(u.key)
          ? h('p', { class: 'small muted' }, 'Sono conversioni di saldo che non riesco ad abbinare con certezza. Se le ignori il saldo resta sbagliato: il vecchio token risulta ancora posseduto e quello nuovo manca (e il quadro RW ne risente). La strada più sicura è inserire la conversione a mano come «scambio» (nel modello universale, piattaforma «Altra piattaforma o wallet personale») e poi ignorare queste righe. Oppure copia la diagnostica e mandala a chi sviluppa l\'app.')
          : h('p', { class: 'small muted' }, 'Questo tipo di riga non è ancora gestito. Se è solo uno spostamento interno senza effetti fiscali puoi ignorarla; se invece è un acquisto, una vendita o un premio, copia la diagnostica e mandala a chi sviluppa l\'app così la aggiungiamo.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => { u.items.forEach((i) => { state.resolutions[i.uid] = { action: 'ignore' }; }); changed(); toast('Righe ignorate'); } }, /conversione di saldo/.test(u.key) ? `Ignora comunque (${u.items.length})` : `Ignora tutte (${u.items.length})`),
          h('button', { class: 'btn', onclick: () => copyText(R.diagnostics(res, state.files), 'Diagnostica') }, 'Copia diagnostica'))));
    }
    if (g.prices.size || [...res.engine.missingPrices.keys()].length) {
      const n = res.engine.missingPrices.size;
      const why = priceReasons(res);
      const kinds = [...res.engine.missingPrices.keys()].map((k) => why.get(k) || 'op');
      const onlyRW = kinds.length > 0 && kinds.every((x) => x === 'rw');
      const title = onlyRW ? (n === 1 ? 'Manca 1 valore di fine anno per il quadro RW' : `Mancano ${n} valori di fine anno per il quadro RW`) : (n === 1 ? 'Manca 1 prezzo in euro' : `Mancano ${n} prezzi in euro`);
      const text = onlyRW
        ? 'Il file contiene già il valore in euro di ogni operazione e il programma lo usa. Quello che manca sono i prezzi del 31 dicembre (e del 1° gennaio) delle cripto che possiedi: non stanno in nessuna riga perché quel giorno non è successo niente. Servono solo al prospetto RW e all\'imposta sul valore; non cambiano le plusvalenze né l\'imposta sostitutiva.'
        : 'Servono soprattutto al prospetto del monitoraggio (RW: valore delle cripto al 1° gennaio e al 31 dicembre) e a valorizzare qualche operazione che nel file non ha un valore in euro.';
      out.push(issueCard('bad', title, text,
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', disabled: !!ui.busy, onclick: () => autoPrices(false) }, ui.busy || 'Scarica i prezzi in automatico'),
          h('button', { class: 'btn', onclick: () => { ui.tab = 'prices'; render(); } }, 'Vedi e inserisci a mano')),
        h('p', { class: 'small muted' }, ui.busy ? 'Sto scaricando i prezzi…'
          : ui.priceFail ? (insideClaude() ? `Non sono riuscito a scaricarne ${ui.priceFail}: dentro claude.ai il download non è possibile. Apri il link pubblicato.`
            : `Non sono riuscito a scaricarne ${ui.priceFail}. ${(ui.priceWhy || []).join(' · ')}. Premi di nuovo «Scarica i prezzi in automatico» tra qualche minuto, oppure scrivili a mano.`)
            : 'Provo a scaricarli da solo (Binance, Kraken o CryptoCompare). Dentro claude.ai non è possibile: apri il link pubblicato.')));
    }
    for (const i of g.notes.filter((x) => x.level === 'block')) out.push(issueCard('bad', i.message, null));
    if (g.outOfScope.length) {
      const assets = [...new Set(g.outOfScope.map((i) => i.data.asset))].join(', ');
      out.push(issueCard('warn', `${g.outOfScope.length} operazioni ignorate (azioni, ETF o altro)`, `Riguardano: ${assets}. Questa versione calcola cripto e oro; azioni ed ETF non sono ancora inclusi.`));
    }
    const notes = g.notes.filter((x) => x.level !== 'block');
    if (notes.length) out.push(h('details', { class: 'card' }, h('summary', null, `Altre note (${notes.length})`), h('ul', { class: 'clean muted small' }, notes.slice(0, 200).map((i) => h('li', null, i.message)))));
    const decided = Object.entries(state.resolutions || {});
    if (decided.length) out.push(decisionsCard(res, decided));
    out.push(g.blockCount ? nextBar('Vai al risultato (provvisorio)', 'result', false) : nextBar('Avanti: vedi il risultato', 'result', true));
    return h('div', { class: 'stack' }, out);
  }

  /** Elenco delle scelte fatte, con possibilita' di annullarle (un clic sbagliato non deve restare per sempre). */
  function decisionsCard(res, decided) {
    const ACT = { ignore: 'riga ignorata', ack: 'confermato', dup_skip: 'contate una volta sola', migration: 'aggiornamento del token (nessuna vendita)', swap: 'scambio imponibile',
      self_custody: 'verso un proprio wallet', from_self_custody: 'da un proprio wallet', disposal: 'trattata come vendita', set_cost: 'costo impostato', cover_cost: 'costo del mancante impostato', set_value: 'valore impostato' };
    const fname = (id) => { const f = state.files.find((x) => x.id === id); return f ? f.name : '(file rimosso)'; };
    const label = ([key, r]) => {
      const act = ACT[r.action] || r.action;
      if (key.startsWith('neardup:')) return `Operazioni uguali in ${key.slice(8).split('|').map(fname).join(' e ')}: ${act}`;
      if (key.startsWith('api_cov:')) return `Dati non scaricati dalle API (${key.split(':').slice(2).join(':')}): ${act}`;
      const base = key.replace(/^conv:/, '').replace(/#(fee|netfee)$/, '');
      const e = res.events.find((x) => x.uid === base);
      const what = e ? `${dmy(CT.taxDate(e.ts))} · ${e.account} · ${CT.fq(e.qty)} ${e.asset}${key.startsWith('conv:') ? ' → ' + CT.fq(e.counterQty) + ' ' + e.counterAsset : ''}` : key;
      return `${what}: ${act}`;
    };
    return h('details', { class: 'card' }, h('summary', null, `Decisioni prese (${decided.length})`),
      h('p', { class: 'muted small' }, 'Le scelte che hai fatto finora. Se ti sei sbagliato annullala: il punto tornerà tra le cose da controllare.'),
      h('ul', { class: 'clean', style: 'display:grid;gap:8px' }, decided.map((d) => h('li', { class: 'row between' },
        h('span', { class: 'small' }, label(d)),
        h('button', { class: 'btn quiet', onclick: () => { delete state.resolutions[d[0]]; changed(); toast('Scelta annullata'); } }, 'Annulla')))));
  }

  // ------------------------------------------------------------------ pannello: Risultato
  function kvTable(rows, opts) {
    return h('div', { class: 'tbl-wrap' }, h('table', { class: 'kv' }, h('tbody', null, rows.map((r) => h('tr', { class: r.cls }, h('td', null, r.label), h('td', { class: 'num' }, r.value))))));
  }
  function basketCard(b) {
    const rows = [
      { label: 'Corrispettivi delle cessioni (al netto delle commissioni)', value: money(b.proceeds) },
      { label: 'Costi di acquisto', value: money(b.costs) },
      { label: 'Plusvalenze', value: money(b.gains) },
      { label: 'Minusvalenze', value: money(b.losses) },
    ];
    if (b.income.gt(0)) rows.push({ label: 'Proventi (staking, interessi, premi…)', value: money(b.income) });
    for (const c of b.carryUsed) rows.push({ label: `Minusvalenza ${c.year} utilizzata`, value: `− ${money(c.amount)}` });
    if (b.thresholdExempt) rows.push({ label: 'Sotto la franchigia di 2.000 € (non tassato)', value: money(0) });
    rows.push({ label: 'Imponibile', value: money(b.taxable), cls: 'total' });
    rows.push({ label: `Imposta sostitutiva (${pct(b.rate)}${b.emtShare.gt(0) ? ', di cui parte al 26% su stablecoin in euro' : ''})`, value: money(b.tax), cls: 'total' });
    if (b.newLoss.gt(0)) rows.push({ label: `Minusvalenza ${b.year} da riportare agli anni successivi`, value: money(b.newLoss) });
    for (const c of b.carryUnused) rows.push({ label: `Minusvalenza ${c.year} ancora disponibile`, value: money(c.amount) });
    for (const c of b.carryExpired) rows.push({ label: `Minusvalenza ${c.year} scaduta (oltre 4 anni)`, value: money(c.amount) });
    return h('div', { class: 'card' }, h('h2', null, b.name), h('p', { class: 'muted small' }, `${b.law} · ${b.nDisposals} cessioni nell'anno · quadro RT`),
      b.nDisposals === 0 && b.income.isZero() ? h('p', { class: 'muted' }, 'Nessuna operazione imponibile in questo anno.') : kvTable(rows));
  }

  function panelResult() {
    const res = ui.res;
    if (!res) return noData();
    const { y, groups: g } = res;
    const blk = g.blockCount;
    const nodes = [];
    nodes.push(h('div', { class: `card hero tone-${blk ? 'warn' : 'good'}` },
      h('span', { class: 'lbl' }, `Imposta sostitutiva stimata · anno ${res.year}`),
      h('div', { class: 'big' }, money(y.totalTax)),
      h('div', { class: 'row' },
        blk ? h('button', { class: 'pill warn', onclick: () => { ui.tab = 'checks'; render(); } }, `Bozza: ${blk} da controllare →`) : h('span', { class: 'pill good' }, 'Nessun punto da risolvere'),
        state.example ? h('span', { class: 'example' }, 'DATI DI ESEMPIO') : null),
      h('p', { class: 'muted small' }, `Cripto ${money(y.crypto.tax)} · Oro e metalli ${money(y.metals.tax)}. ${y.rule.note}`)));
    nodes.push(h('div', { class: 'grid2' }, basketCard(y.crypto), basketCard(y.metals)));

    // RW
    const rwTotal = res.rw.reduce((s, r) => s.plus(r.ivca), CT.ZERO);
    nodes.push(h('div', { class: 'card' }, h('h2', null, 'Monitoraggio (quadro RW) e imposta sul valore delle cripto'),
      h('p', { class: 'muted small' }, 'Cripto e oro custoditi presso piattaforme estere o wallet personali. Bozza di lavoro: i codici e i righi vanno presi dalle istruzioni del modello.'),
      res.rw.length ? h('div', { class: 'tbl-wrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', null, 'Dove'), h('th', null, 'Asset'), h('th', { class: 'num' }, 'Giorni'), h('th', { class: 'num' }, 'Valore iniziale'), h('th', { class: 'num' }, 'Valore finale'), h('th', { class: 'num' }, 'IVCA 0,2%'))),
        h('tbody', null, res.rw.map((r) => h('tr', null, h('td', null, r.account), h('td', null, r.asset), h('td', { class: 'num' }, r.days), h('td', { class: 'num' }, money(r.valueInitial)), h('td', { class: 'num' }, money(r.valueFinal)), h('td', { class: 'num' }, r.cls === 'metal' ? '—' : money(r.ivca))))),
        h('tfoot', null, h('tr', { class: 'total' }, h('td', { colspan: 5 }, 'IVCA indicativa totale'), h('td', { class: 'num' }, money(rwTotal)))))) : h('p', { class: 'muted' }, 'Nessuna cripto o oro detenuti in questo anno.')));

    // storico anni
    const yrs = Object.values(res.years).sort((a, b) => b.year - a.year);
    nodes.push(h('div', { class: 'card' }, h('h2', null, 'Anni a confronto'),
      h('div', { class: 'tbl-wrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', null, 'Anno'), h('th', { class: 'num' }, 'Saldo cripto'), h('th', { class: 'num' }, 'Saldo oro'), h('th', { class: 'num' }, 'Imposta'))),
        h('tbody', null, yrs.map((r) => h('tr', null, h('td', null, r.year), h('td', { class: 'num' }, money(r.crypto.net.plus(r.crypto.income))), h('td', { class: 'num' }, money(r.metals.net)), h('td', { class: 'num' }, money(r.totalTax))))))),
      h('p', { class: 'muted small' }, 'Gli anni precedenti al 2023 seguivano regole diverse e non sono inclusi.')));

    nodes.push(h('details', { class: 'card' }, h('summary', null, 'Come sono stati fatti i calcoli'),
      h('ul', { class: 'clean muted small' },
        h('li', null, 'Costo di acquisto: metodo LIFO (si vendono prima gli ultimi acquistati), un unico conto virtuale per ogni asset su tutte le piattaforme.'),
        h('li', null, 'Gli scambi tra crypto, il passaggio a stablecoin e i pagamenti in crypto sono vendite imponibili al valore del giorno (dal 2023). Prima del 2023 non lo erano e il costo si trasferisce.'),
        h('li', null, 'Staking, interessi e premi sono tassati al valore del giorno in cui li ricevi e non si compensano con le perdite sulle vendite (scelta prudenziale).'),
        h('li', null, 'Le perdite sulle cripto compensano solo guadagni su cripto; l\'oro ha un conteggio separato.'),
        h('li', null, 'Le date contano secondo l\'orario italiano. Gli importi del quadro sono arrotondati all\'euro.'),
        h('li', null, `Regole ${res.year}: ${y.rule.status}. Aliquote e franchigie provengono da fonti secondarie: falle confermare da un professionista prima di firmare la dichiarazione.`))));
    nodes.push(h('div', { class: 'row' }, nextBar('Avanti: scarica i PDF', 'export', true),
      h('button', { class: 'btn quiet', onclick: () => { ui.tab = 'detail'; render(); window.scrollTo(0, 0); } }, 'Vedi tutte le operazioni')));
    return h('div', { class: 'stack' }, nodes);
  }

  // ------------------------------------------------------------------ pannello: Dettaglio
  function dataTable(head, rows, numCols) {
    return h('div', { class: 'tbl-wrap' }, h('table', null,
      h('thead', null, h('tr', null, head.map((x, i) => h('th', { class: numCols.includes(i) ? 'num' : null }, x)))),
      h('tbody', null, rows.length ? rows : h('tr', null, h('td', { colspan: head.length, class: 'muted' }, 'Nessuna riga.')))));
  }
  function panelDetail() {
    const res = ui.res;
    if (!res) return noData();
    const tabs = [['cessioni', 'Vendite e scambi'], ['proventi', 'Proventi'], ['giacenze', 'Giacenze al 31/12'], ['lotti', 'Lotti di acquisto']];
    const bar = h('div', { class: 'subtabs', role: 'group', 'aria-label': 'Tipo di dettaglio' }, tabs.map(([k, t]) => h('button', { class: 'chip', 'aria-pressed': ui.detail === k ? 'true' : 'false', onclick: () => { ui.detail = k; render(); } }, t)));
    let body;
    const q = ui.filter.trim().toLowerCase();
    const match = (cells) => !q || cells.join(' ').toLowerCase().includes(q);
    if (ui.detail === 'cessioni') {
      const ds = res.engine.disposals.filter((d) => d.year === res.year).sort((a, b) => a.ts - b.ts);
      const rows = [];
      for (const d of ds) {
        const cells = [dmy(d.day), d.account, d.asset, R.KIND_IT[d.kind] || d.kind];
        if (!match(cells)) continue;
        const det = h('tr', { class: 'sub', hidden: true }, h('td', { colspan: 9 },
          h('div', null, `Fonte del valore: ${d.source}. Lotti usati (LIFO):`),
          h('ul', { class: 'clean' }, d.uses.map((u) => h('li', null, `${qty(u.qty)} ${d.asset} acquistati il ${dmy(u.day)} · costo ${money(u.cost)}${u.documented ? '' : ' · COSTO NON DOCUMENTATO'}${u.rebased ? ' · costo rideterminato' : ''}`)))));
        rows.push(h('tr', null, h('td', null, dmy(d.day)), h('td', null, d.account), h('td', null, d.asset), h('td', null, R.KIND_IT[d.kind] || d.kind), h('td', { class: 'num' }, qty(d.qty)), h('td', { class: 'num' }, money(d.proceeds)), h('td', { class: 'num' }, money(d.cost)),
          h('td', { class: 'num', style: `color:var(--${d.gain.gte(0) ? 'good' : 'bad'})` }, money(d.gain)), h('td', null, h('button', { class: 'btn quiet', onclick: () => { det.hidden = !det.hidden; } }, 'Lotti')))); rows.push(det);
      }
      body = dataTable(['Data', 'Conto', 'Asset', 'Tipo', 'Quantità', 'Incasso netto', 'Costo', 'Guadagno / perdita', ''], rows, [4, 5, 6, 7]);
    } else if (ui.detail === 'proventi') {
      const rows = R.incomesRows(res).filter(match).map((r) => h('tr', null, h('td', null, r[0]), h('td', null, r[1]), h('td', null, r[2]), h('td', null, r[4]), h('td', { class: 'num' }, r[5]), h('td', { class: 'num' }, r[6] + ' €')));
      body = dataTable(['Data', 'Conto', 'Asset', 'Tipo', 'Quantità', 'Valore al ricevimento'], rows, [4, 5]);
    } else if (ui.detail === 'giacenze') {
      const rows = res.balances.filter((b) => match([b.account, b.asset])).map((b) => h('tr', null, h('td', null, b.account), h('td', null, b.asset), h('td', { class: 'num' }, qty(b.qty))));
      body = h('div', { class: 'stack', style: 'padding:0' }, h('p', { class: 'muted small' }, `Saldo che risulta dai tuoi file al 31/12/${res.year}. Confrontalo con quello che vedi nelle app: se non coincide manca qualche operazione.`), dataTable(['Dove', 'Asset', 'Quantità'], rows, [2]));
    } else {
      const lots = [];
      for (const [asset, pool] of res.engine.pools) for (const l of pool.lots) if (match([asset])) lots.push([asset, l]);
      body = h('div', { class: 'stack', style: 'padding:0' }, h('p', { class: 'muted small' }, 'Lotti ancora in portafoglio alla fine dei dati caricati (quanto resta di ogni acquisto e il suo costo unitario).'),
        dataTable(['Asset', 'Acquistato il', 'Quantità residua', 'Costo unitario', 'Costo documentato'], lots.map(([a, l]) => h('tr', null, h('td', null, a), h('td', null, dmy(CT.taxDate(l.ts))), h('td', { class: 'num' }, qty(l.qty)), h('td', { class: 'num' }, money(l.unitCost)), h('td', null, l.documented ? 'sì' : 'NO'))), [2, 3]));
    }
    const filter = h('input', { type: 'text', placeholder: 'Cerca (asset, conto…)', value: ui.filter, 'aria-label': 'Cerca', oninput: (e) => { ui.filter = e.target.value; const pos = e.target.selectionStart; render(); const n = document.querySelector('input[aria-label="Cerca"]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } } });
    return h('div', { class: 'stack' }, h('div', null, h('button', { class: 'btn quiet', onclick: () => { ui.tab = 'result'; render(); window.scrollTo(0, 0); } }, '← Torna al risultato')), h('div', { class: 'card' }, h('div', { class: 'row between' }, bar, filter), body));
  }

  // ------------------------------------------------------------------ pannello: Prezzi
  const insideClaude = () => !!(typeof window !== 'undefined' && window.claude && window.claude.use);
  /** Prezzo in euro alla chiusura del giorno: prova piu' servizi pubblici (vedi pricefeed.js). */
  async function fetchPrice(sym, day) {
    const r = await CT.pricefeed.dailyEur(sym, day);
    ui.priceSource = r.source;
    return r.price;
  }
  /** Perche' serve ogni prezzo mancante: 'rw' (quadro RW), 'rebase' (rideterminazione) o 'op' (valorizzare un'operazione). */
  function priceReasons(res) {
    const why = new Map();
    for (const i of res.engine.issues) {
      if ((i.code !== 'missing_price' && i.code !== 'missing_value') || !i.data) continue;
      const k = `${i.data.symbol}|${i.data.day}`;
      if (why.get(k) === 'op') continue;
      why.set(k, i.data.forRW ? 'rw' : i.data.forRebase ? 'rebase' : 'op');
    }
    return why;
  }
  /** Scarica i prezzi mancanti (CryptoCompare: invia solo simbolo e data). Non funziona dentro claude.ai. */
  const priceTried = new Set();
  async function autoPrices(quiet) {
    const res = ui.res;
    if (!res || ui.busy) return;
    const need = [...res.engine.missingPrices.values()].filter((n) => !state.prices[`${n.symbol}|${n.day}`]);
    if (!need.length) return;
    ui.busy = 'Scarico i prezzi…'; render();
    let ok = 0, ko = 0;
    const why = new Map();
    for (let i = 0; i < need.length; i += 3) {
      await Promise.all(need.slice(i, i + 3).map(async (n) => {
        const k = `${n.symbol}|${n.day}`; priceTried.add(k);
        if (CT.classify(n.symbol) !== 'crypto') { ko++; why.set('oro', 'i metalli non si scaricano: scrivi il prezzo di 1 grammo'); return; }
        try { state.prices[k] = await fetchPrice(n.symbol, n.day); ok++; }
        catch (e) { ko++; for (const d of e.details || [e.message]) why.set(d.split(':')[0], d); }
      }));
    }
    ui.busy = ''; ui.priceFail = ko; ui.priceWhy = [...why.values()].slice(0, 4); changed();
    if (!quiet || ok) toast(`${ok} ${ok === 1 ? 'prezzo scaricato' : 'prezzi scaricati'}${ko ? `, ${ko} da inserire a mano` : ''}`);
  }
  /** Appena mancano dei prezzi li chiede da solo, una volta sola per ciascuno: l'utente non deve fare niente. */
  function maybeAutoPrices() {
    const res = ui.res;
    if (!res || ui.busy || typeof fetch !== 'function') return;
    const todo = [...res.engine.missingPrices.values()].filter((n) => CT.classify(n.symbol) === 'crypto' && !state.prices[`${n.symbol}|${n.day}`] && !priceTried.has(`${n.symbol}|${n.day}`));
    if (todo.length) autoPrices(true);
  }
  function panelPrices() {
    const res = ui.res;
    if (!res) return noData();
    const need = [...res.engine.missingPrices.values()].sort((a, b) => (a.symbol + a.day < b.symbol + b.day ? -1 : 1));
    const inputs = new Map();
    // perche' serve ogni prezzo: dal quadro RW (valore a inizio/fine anno), dalla rideterminazione o per valorizzare un'operazione in euro
    const why = priceReasons(res);
    const reason = (n) => {
      const w = why.get(`${n.symbol}|${n.day}`);
      if (w === 'rebase') return 'Rideterminazione del costo al 1/1/2025';
      if (w !== 'rw') return 'Per valorizzare un\'operazione';
      return n.day.endsWith('-12-31') ? 'Quadro RW: valore a fine anno' : n.day.endsWith('-01-01') ? 'Quadro RW: valore a inizio anno' : 'Quadro RW: valore quando l\'hai acquistata o venduta';
    };
    const nRW = need.filter((n) => why.get(`${n.symbol}|${n.day}`) === 'rw').length;
    const nRebase = need.filter((n) => why.get(`${n.symbol}|${n.day}`) === 'rebase').length;
    const nOp = need.length - nRW - nRebase;
    const rows = need.map((n) => {
      const key = `${n.symbol}|${n.day}`;
      const sug = res.engine.prices.nearest(n.symbol, n.day);
      const input = h('input', { type: 'text', 'aria-label': `Prezzo ${n.symbol} ${n.day}`, placeholder: '€ per 1 ' + n.symbol, id: `p_${key}`, style: 'width:140px' });
      inputs.set(key, input);
      const far = sug && sug.daysApart > 7;
      return h('tr', null, h('td', null, h('strong', null, n.symbol), h('div', { class: 'muted small' }, reason(n))), h('td', null, dmy(n.day)),
        h('td', { class: 'muted small' }, sug ? h('span', null, `${money(sug.price)} (${dmy(sug.day)}, ${sug.daysApart} ${sug.daysApart === 1 ? 'giorno' : 'giorni'} ${sug.daysApart === 1 ? 'prima o dopo' : 'di distanza'}) `, far ? h('span', { class: 'pill warn' }, 'lontano: approssimato') : null, ' ', h('button', { class: 'btn quiet', onclick: () => { input.value = sug.price.toDecimalPlaces(8).toString(); } }, 'Usa')) : 'nessun prezzo noto'),
        h('td', null, input));
    });
    const saveAll = () => {
      let n = 0;
      for (const [k, input] of inputs) { const v = input.value.trim().replace(',', '.'); if (v && !Number.isNaN(Number(v)) && Number(v) > 0) { state.prices[k] = v; n++; } }
      if (!n) { toast('Scrivi almeno un prezzo valido'); return; }
      changed(); toast(`${n} prezzi salvati`);
    };
    const auto = () => autoPrices(false);
    const have = Object.entries(state.prices);
    return h('div', { class: 'stack' },
      h('div', null, h('button', { class: 'btn quiet', onclick: () => { ui.tab = 'checks'; render(); window.scrollTo(0, 0); } }, '← Torna ai controlli')),
      h('div', { class: 'card' }, h('h2', null, need.length ? `Prezzi mancanti (${need.length})` : 'Nessun prezzo mancante'),
        need.length ? h('div', { class: 'stack', style: 'padding:0;gap:8px' },
          h('p', null, 'Per calcolare le tasse sulle vendite il programma usa gli importi in euro scritti nei tuoi file. Qui mancano invece alcuni prezzi in euro di una cripto in un certo giorno.'),
          h('p', { class: 'muted' }, nRW ? `${nRW} ${nRW === 1 ? 'serve' : 'servono'} al prospetto RW (il quadro del monitoraggio, e di conseguenza all'imposta sul valore delle cripto): il valore in euro che le cripto che possiedi avevano il 1° gennaio e il 31 dicembre. ` : '', nRebase ? `${nRebase} ${nRebase === 1 ? 'serve' : 'servono'} alla rideterminazione del costo al 1° gennaio 2025. ` : '', nOp ? `${nOp} ${nOp === 1 ? 'serve' : 'servono'} a valorizzare singole operazioni. ` : '', 'Sotto ogni asset trovi a cosa serve quel prezzo.'),
          h('p', { class: 'muted' }, 'Il modo più veloce: premi «Scarica i prezzi in automatico». Funziona dal link pubblicato o dal programma scaricato sul computer, non dentro claude.ai. Se qualche prezzo non arriva, scrivilo a mano (prezzo in euro di 1 unità alla chiusura del giorno). Il suggerimento con «Usa» è il prezzo di un\'altra operazione e può essere di mesi prima o dopo: serve solo come approssimazione, controlla i giorni indicati. Per l\'oro scrivi il prezzo di 1 grammo.')) : h('p', { class: 'muted' }, 'Il programma usa già i prezzi che ricava dalle tue operazioni dello stesso giorno.'),
        need.length ? [h('div', { class: 'row' },
            h('button', { class: 'btn primary', disabled: !!ui.busy, onclick: auto }, ui.busy || 'Scarica i prezzi in automatico'),
            h('button', { class: 'btn', onclick: saveAll }, 'Salva i prezzi scritti a mano'),
            h('span', { class: 'muted small' }, 'Il download automatico (Binance, Kraken o CryptoCompare) invia solo simbolo e data.')),
          h('div', { class: 'tbl-wrap' }, h('table', null, h('thead', null, h('tr', null, ['Asset', 'Data', 'Suggerimento', 'Prezzo in €'].map((x) => h('th', null, x)))), h('tbody', null, rows)))] : null),
      have.length ? h('div', { class: 'card' }, h('h3', null, `Prezzi inseriti (${have.length})`),
        h('div', { class: 'tbl-wrap' }, h('table', null, h('thead', null, h('tr', null, ['Asset', 'Data', 'Prezzo €', ''].map((x) => h('th', null, x)))),
          h('tbody', null, have.map(([k, v]) => { const [s, d] = k.split('|'); return h('tr', null, h('td', null, s), h('td', null, dmy(d)), h('td', { class: 'num' }, v), h('td', null, h('button', { class: 'btn quiet danger', onclick: () => { delete state.prices[k]; changed(); } }, 'Elimina'))); }))))) : null);
  }

  // ------------------------------------------------------------------ pannello: Esporta
  function panelExport() {
    const res = ui.res;
    if (!res) return noData();
    const y = res.year;
    const item = (title, desc, name, build, mime) => h('div', { class: 'row between', style: 'padding:10px 0;border-top:1px solid var(--line)' },
      h('div', null, h('strong', null, title), h('div', { class: 'muted small' }, desc)),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => saveFile(name, build(), mime) }, 'Salva'), h('button', { class: 'btn', onclick: () => copyText(build().replace(/^﻿/, ''), title) }, 'Copia')));
    return h('div', { class: 'stack' },
      pdfCard(res),
      h('div', { class: 'card' }, h('h2', null, `Altri formati · ${y}`),
        h('p', { class: 'muted small' }, 'I file CSV si aprono con Excel (separatore ; e virgola decimale).'),
        item('Riepilogo', 'Testo con i totali per quadro', `riepilogo-${y}.txt`, () => R.summaryText(res), 'text/plain'),
        item('Vendite e scambi', 'Una riga per ogni cessione, con il costo e il guadagno', `cessioni-${y}.csv`, () => R.csv(R.DISPOSAL_HEAD, R.disposalsRows(res)), 'text/csv'),
        item('Dettaglio lotti', 'Per ogni cessione, i lotti di acquisto usati (utile in caso di controllo)', `lotti-${y}.csv`, () => R.csv(R.LOTS_HEAD, R.lotsRows(res)), 'text/csv'),
        item('Proventi', 'Staking, interessi, premi ricevuti nell\'anno', `proventi-${y}.csv`, () => R.csv(R.INCOME_HEAD, R.incomesRows(res)), 'text/csv'),
        item('Prospetto RW', 'Valori iniziali e finali, giorni e IVCA indicativa', `rw-${y}.csv`, () => R.csv(R.RW_HEAD, R.rwRows(res)), 'text/csv'),
        item('Saldi al 31/12', 'Quanto risulta in ogni conto a fine anno', `saldi-${y}.csv`, () => R.csv(R.BAL_HEAD, R.balancesRows(res)), 'text/csv'),
        item('Problemi e note', 'Tutto quello che il programma ha segnalato', `problemi-${y}.csv`, () => R.csv(R.ISSUE_HEAD, R.issuesRows(res)), 'text/csv')),
      h('div', { class: 'card' }, h('h2', null, 'Salvataggio del lavoro'),
        h('p', { class: 'muted small' }, 'Il lavoro si salva da solo in questo browser. Per fare una copia o spostarlo su un altro computer salva il progetto e ricaricalo da qui.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => saveFile('progetto-dichiarazione-crypto.json', JSON.stringify(state), 'application/json') }, 'Salva il progetto'),
          h('label', { class: 'btn', for: 'projIn' }, 'Apri un progetto salvato', h('input', { type: 'file', id: 'projIn', accept: '.json', class: 'sr', onchange: async (e) => {
            try { const s = JSON.parse(await e.target.files[0].text()); if (!Array.isArray(s.files)) throw new Error(); Object.assign(state, s); changed('result'); toast('Progetto caricato'); } catch (err) { toast('Il file non è un progetto valido'); }
          } })),
          h('button', { class: 'btn', onclick: () => copyText(R.diagnostics(res, state.files), 'Diagnostica') }, 'Copia diagnostica (senza importi)'))),
      h('div', { class: 'card' }, h('h2', null, 'Usa il programma sul tuo computer'),
        h('p', { class: 'muted small' }, 'Un unico file .html con lo stesso programma: lo apri con un doppio clic, anche senza internet e fuori da claude.ai. I dati che inserisci restano su quel computer. Per portarci il lavoro fatto qui usa "Salva il progetto" e poi "Apri un progetto salvato".'),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { const html = standaloneHtml(); if (!html) { toast('Non riesco a preparare il file'); return; } saveFile('dichiarazione-crypto.html', html, 'text/html'); } }, 'Scarica il programma per il computer (.html)'))));
  }


  // ------------------------------------------------------------------ versione per il computer
  /** Ricostruisce dalla pagina aperta un file .html autonomo (stesso codice), da usare fuori da claude.ai. */
  function standaloneHtml() {
    const style = document.querySelector('style[data-app]');
    const scripts = [...document.querySelectorAll('script[data-app]')];
    if (!style || !scripts.length) return null;
    return `<!doctype html>\n<html lang="it">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<meta name="robots" content="noindex">\n<title>Dichiarazione Crypto</title>\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">\n<style>\n${style.textContent}\n</style>\n</head>\n<body>\n<div id="app"></div>\n${scripts.map((x) => `<script>\n${x.textContent}\n</script>`).join('\n')}\n</body>\n</html>\n`;
  }

  // ------------------------------------------------------------------ PDF
  async function makePdfs() {
    if (ui.pdf && ui.pdf.ver === ui.ver) return ui.pdf.out;
    ui.pdfBusy = true; render();
    try {
      const out = await CT.pdf.buildAll(ui.res, state);
      ui.pdf = { ver: ui.ver, out };
      return out;
    } catch (e) {
      console.error(e); toast('Non sono riuscito a creare i PDF: ' + e.message); return null;
    } finally { ui.pdfBusy = false; render(); }
  }
  async function downloadPdf(which) {
    const out = await makePdfs();
    if (!out) return;
    const f = which === 'full' ? out.full : which === 'zip' ? out.zip : out.parts.find((x) => x.name === which);
    if (f) saveFile(f.name, f.data, which === 'zip' ? 'application/zip' : 'application/pdf');
  }
  function pdfCard(res) {
    const tp = state.taxpayer = state.taxpayer || { name: '', cf: '' };
    state.custodians = state.custodians || {};
    const touch = () => { ui.ver++; ui.pdf = null; save(); };
    const name = field('Cognome e nome', { id: 'tp_name', value: tp.name, placeholder: 'es. Rossi Mario', oninput: (e) => { tp.name = e.target.value; touch(); } });
    const cf = field('Codice fiscale', { id: 'tp_cf', value: tp.cf, maxlength: '16', placeholder: 'es. RSSMRA80A01H501U', oninput: (e) => { e.target.value = e.target.value.toUpperCase(); tp.cf = e.target.value; touch(); } });
    const accounts = [...new Set(res.rw.map((r) => r.account))];
    const cust = accounts.map((a) => {
      const c = state.custodians[a] = state.custodians[a] || { name: '', country: '' };
      const n = field(`${a}: società che custodisce i fondi`, { id: `cu_n_${a}`, value: c.name, placeholder: 'dai termini e condizioni della piattaforma', oninput: (e) => { c.name = e.target.value; touch(); } });
      const k = field('Stato', { id: `cu_s_${a}`, value: c.country, placeholder: 'es. Malta', oninput: (e) => { c.country = e.target.value; touch(); } });
      return h('div', { class: 'fields' }, n.el, k.el);
    });
    const blk = res.groups.blockCount;
    const busy = ui.pdfBusy;
    return h('div', { class: `card tone-${blk ? 'warn' : 'good'}` },
      h('h2', null, `Documenti per la dichiarazione · ${res.year}`),
      h('p', { class: 'muted' }, 'PDF pronti per te o per il commercialista: prospetti per i quadri RT e RW, riepilogo delle imposte e allegati che documentano ogni calcolo.'),
      h('p', { class: 'small muted' }, 'Attenzione: l\'Agenzia delle Entrate non ha un modulo ufficiale per questi dati e non vuole allegati. I dati si dichiarano nel Modello Redditi PF; questi documenti servono a compilarlo e a dimostrare i calcoli in caso di controllo. Non sono moduli ufficiali.'),
      blk ? h('p', { class: 'pill warn block' }, `Ci sono ${blk} punti da controllare: ogni pagina avrà la filigrana BOZZA.`) : h('p', { class: 'pill good block' }, 'Nessun punto aperto: i PDF non avranno la filigrana BOZZA.'),
      h('h3', null, 'Dati del contribuente (facoltativi)'),
      h('div', { class: 'fields' }, name.el, cf.el),
      accounts.length ? [h('h3', null, 'Custodi per il quadro RW'), h('p', { class: 'small muted' }, 'Per ogni piattaforma o wallet servono la denominazione della società che custodisce i fondi e lo Stato. Se non li indichi, nel prospetto resta "(da indicare)".'), cust] : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', disabled: busy, onclick: () => downloadPdf('full') }, busy ? 'Sto preparando i PDF…' : 'Scarica il fascicolo completo (PDF)'),
        h('button', { class: 'btn', disabled: busy, onclick: () => downloadPdf('zip') }, 'Scarica tutti i PDF separati (.zip)')),
      h('details', null, h('summary', null, 'Scarica un singolo documento'),
        h('div', null, CT.pdf.SECTIONS.map((sec) => h('div', { class: 'row between', style: 'padding:8px 0;border-top:1px solid var(--line)' },
          h('span', null, sec.title), h('button', { class: 'btn', disabled: busy, onclick: () => downloadPdf(`${res.year}-${sec.file}.pdf`) }, 'Scarica'))))));
  }

  function noData() {
    return h('div', { class: 'stack' }, h('div', { class: 'card empty' }, h('h2', null, 'Prima scegli le piattaforme'), h('p', { class: 'muted' }, ui.error ? `Errore: ${ui.error.message}` : 'Qui comparirà il risultato appena aggiungi una piattaforma e i suoi file.'),
      h('button', { class: 'btn primary', onclick: goPlatforms }, 'Scegli le piattaforme')));
  }

  // ------------------------------------------------------------------ cornice
  // quattro passi; "Dettaglio" e "Prezzi" restano raggiungibili da un link e si illuminano sotto il passo a cui appartengono
  const TABS = [['files', 'File'], ['checks', 'Controlli'], ['result', 'Risultato'], ['export', 'PDF']];
  const PARENT = { detail: 'result', prices: 'checks' };
  function render() {
    const root = document.getElementById('app');
    const res = ui.res;
    const blk = res ? res.groups.blockCount : 0;
    const hasData = state.files.length || state.manual.length;
    const status = !hasData ? h('span', { class: 'pill idle' }, 'Nessun dato')
      : blk ? h('button', { class: 'pill warn', onclick: () => { ui.tab = 'checks'; render(); } }, `Bozza · ${blk} da controllare`) : h('span', { class: 'pill good' }, 'Pronto');
    const yearSel = h('select', { id: 'yearSel', 'aria-label': 'Anno d\'imposta', onchange: (e) => { state.settings.year = +e.target.value; changed(); } },
      CT.tax.YEARS.map((y) => h('option', { value: y, selected: state.settings.year === y }, y)));
    const nav = h('nav', { class: 'nav', role: 'tablist' }, TABS.map(([k, t], i) => h('button', { class: 'tab', role: 'tab', 'aria-selected': (PARENT[ui.tab] || ui.tab) === k ? 'true' : 'false', onclick: () => { ui.tab = k; if (k === 'files') ui.platform = null; render(); window.scrollTo(0, 0); } },
      h('span', { class: 'n' }, i + 1), t,
      k === 'checks' && blk ? h('span', { class: 'badge' }, blk) : null)));
    const panel = { files: () => (ui.platform ? panelPlatform(ui.platform) : panelPlatforms()), checks: panelChecks, result: panelResult, detail: panelDetail, prices: panelPrices, export: panelExport }[ui.tab]();
    const scrollY = window.scrollY;
    root.replaceChildren(...[
      h('header', { class: 'top' }, h('div', { class: 'wrap' },
        h('div', { class: 'top-in' }, h('div', null, h('div', { class: 'brand-name' }, 'Dichiarazione Crypto'), h('div', { class: 'brand-sub' }, 'Cripto e oro · redditi diversi · quadri RT e RW')),
          h('div', { class: 'top-ctl' }, h('label', { class: 'lbl', for: 'yearSel' }, 'Anno d\'imposta'), yearSel, status)), nav)),
      h('main', { class: 'wrap', id: 'main' }, panel),
      ui.toast ? h('div', { class: 'toast', role: 'status' }, ui.toast) : null, askMoreModal()].filter(Boolean));
    window.scrollTo(0, scrollY);
    const mf = root.querySelector('.modal .btn.primary');
    if (mf) mf.focus();
  }

  async function start() {
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.askMore) { ui.askMore = null; render(); } });
    await load();
    recompute();
    if (state.files.length && ui.res) ui.tab = ui.res.groups.blockCount ? 'checks' : 'result';
    render();
    maybeAutoPrices();
  }
  CT.app = { state, ui, render, start, recompute, addFileText, changed };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  }
})();
