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
  const state = { files: [], manual: [], resolutions: {}, prices: {}, priceSrc: {}, settings: { year: 2025, rebase2025: false, useCarry: true, swapRule: 'circ30' }, taxpayer: { name: '', cf: '' }, custodians: {}, platforms: [], example: false };
  const ui = { tab: 'overview', investTab: 'summary', navOpen: false, res: null, error: null, detail: 'cessioni', filter: '', confirmReset: false, toast: '', busy: '', ver: 0, pdf: null, pdfBusy: false, platform: null, method: 'file', confirmRemove: null, manualChoices: false, priceFail: 0 };

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
  /** Se nei file non ci sono operazioni dell'anno selezionato, passa all'ultimo anno che ne ha (e lo dice). Una scelta esplicita dell'utente non si tocca. */
  function autoYear() {
    const res = ui.res;
    if (!res || state.settings.yearChosen || !res.dataYears.length || res.dataYears.includes(res.year)) return;
    const ok = res.dataYears.filter((y) => CT.tax.YEARS.includes(y));
    if (!ok.length) return;
    state.settings.year = Math.max(...ok); ui.yearNote = true; recompute();
  }
  function changed(nextTab) {
    ui.ver++; ui.pdf = null;
    recompute(); autoYear(); save();
    if (nextTab) ui.tab = nextTab;
    render();
    maybeAutoPrices();
  }
  function toast(msg) {
    ui.toast = msg; render();
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { ui.toast = ''; const el = document.querySelector('.toast'); if (el) el.remove(); }, 6000);
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
  const goPlatforms = () => go('files', { platform: null, picker: false });
  const goAdd = () => go('files', { platform: null, picker: true });   // apre direttamente la scelta di un'altra piattaforma
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
    changed('overview');
  }
  function exitExample() {
    state.files = []; state.manual = []; state.resolutions = {}; state.prices = {}; state.platforms = []; state.example = false; ui.platform = null; ui.picker = false;
    changed('files');
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
      nodes.push(callout('info', 'Da dove vengono le tue cripto o il tuo oro?', 'Scegli la piattaforma che usi e carica i suoi file. Se non hai investimenti all\'estero puoi saltare questa parte.',
        !state.files.length ? h('button', { class: 'btn', onclick: loadExample }, 'Prima vedi un esempio') : null));
      nodes.push(pickerCard(free, false));
    } else {
      nodes.push(h('ul', { class: 'plist' }, addedKeys.map(platformBlock)));
      if (free.length) nodes.push(ui.picker ? pickerCard(free, true) : h('div', null, h('button', { class: 'btn', onclick: () => { ui.picker = true; render(); } }, '+ Aggiungi un\'altra piattaforma o wallet')));
    }
    return h('div', { class: 'stack' }, nodes);
  }

  function resetBlock() {
    return h('div', { class: 'row' },
      ui.confirmReset
        ? [h('span', { class: 'small' }, 'Cancellare tutte le piattaforme, i file, le scelte e i prezzi?'),
          h('button', { class: 'btn danger', onclick: () => { state.files = []; state.manual = []; state.resolutions = {}; state.prices = {}; state.platforms = []; state.example = false; ui.confirmReset = false; ui.platform = null; ui.picker = false; changed('overview'); toast('Dati cancellati'); } }, 'Sì, cancella tutto'),
          h('button', { class: 'btn', onclick: () => { ui.confirmReset = false; render(); } }, 'Annulla')]
        : h('button', { class: 'btn quiet danger', onclick: () => { ui.confirmReset = true; render(); } }, 'Cancella tutti i dati salvati'));
  }

  /** Elenco compatto di scelta: una riga con icona per ogni piattaforma non ancora aggiunta. Scegliere una riga la aggiunge. */
  function pickerCard(keys, closable) {
    return h('div', { class: 'card' },
      h('div', { class: 'row between' },
        h('h2', null, closable ? 'Quale vuoi aggiungere?' : 'Scegli la piattaforma'),
        closable ? h('button', { class: 'btn quiet', onclick: () => { ui.picker = false; render(); } }, 'Chiudi') : null),
      h('ul', { class: 'plist pick' }, keys.map((k) => h('li', null,
        h('button', { class: 'pickrow', 'aria-label': `Aggiungi ${P[k].name}`, onclick: () => openPlatform(k) },
          platIcon(k),
          h('span', { class: 'ptxt' }, h('span', { class: 'pname' }, P[k].name), h('span', { class: 'muted small' }, P[k].blurb)),
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

  function openPlatform(k, method) {
    ensurePlatform(k);
    ui.platform = k; ui.picker = false; ui.tab = 'files';
    // se l'API non c'e', l'unica strada e' il file: si seleziona da solo; altrimenti la scelta resta all'utente
    ui.method = method || (CT.api && CT.api.forPlatform && CT.api.forPlatform(k) ? null : 'file');
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
        CT.api && CT.api.forPlatform && CT.api.forPlatform(k) && p.api.status !== 'none' ? [h('h3', null, 'Come vuoi aggiungere i dati?'), methodChoice(k)] : null),
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
        h('p', null, 'Hai finito di caricare, o devi aggiungere altri file o un\'altra piattaforma?'),
        added.length > 1 ? h('div', { class: 'chips' }, added.map((x) => h('span', { class: 'row', style: 'gap:6px' }, platIcon(x, true), h('span', { class: 'small' }, P[x].name)))) : null,
        h('div', { class: 'btns' },
          h('button', { class: 'btn primary', onclick: () => { close(); ui.platform = null; go('checks'); } }, 'Ho finito: avanti'),
          h('button', { class: 'btn', onclick: () => { close(); goAdd(); } }, 'No, devo aggiungerne altri'),
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
    // prima il pulsante per scegliere i file, poi (ripiegate) le istruzioni per scaricarli
    const inputId = `fileInput_${k}`;
    const input = h('input', { type: 'file', id: inputId, multiple: true, accept: '.csv,.txt,.zip', class: 'sr', onchange: (e) => { addFiles(e.target.files, k); e.target.value = ''; } });
    const drop = h('label', { class: 'drop', for: inputId },
      h('strong', null, `Scegli i file di ${p.name}`),
      h('span', { class: 'muted' }, p.kinds.length > 1 ? `Servono: ${p.kinds.map((kd) => kd.label).join(' e ')}. CSV oppure .zip, anche di periodi diversi.` : 'CSV oppure .zip. Puoi caricarne più d\'uno, anche di periodi diversi.'),
      h('span', { class: 'btn primary' }, 'Scegli i file'), input);
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files, k); });
    nodes.push(drop);
    nodes.push(h('details', { class: 'card', open: !st.files.length }, h('summary', null, 'Come scarico i file?'),
      h('ol', { class: 'steps' }, p.steps.map((x) => h('li', null, x))),
      !p.native ? h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => saveFile('modello-universale.csv', '﻿' + CT.importers.GENERIC_TEMPLATE, 'text/csv') }, 'Scarica il modello universale')) : null));
    if (p.kinds.length > 1) {
      nodes.push(h('div', { class: 'card' }, h('h3', null, 'File che servono'),
        h('ul', { class: 'clean' }, p.kinds.map((kd) => { const n = st.files.filter((f) => f.type === kd.type).length; return h('li', null, n ? '✓ ' : '○ ', kd.label, n ? ` · ${n} caricato${n === 1 ? '' : 'i'}` : ' · mancante'); }))));
    }
    nodes.push(h('p', { class: 'muted small' }, 'I file restano nel tuo browser e non vengono inviati a nessuno.'));

    if (st.files.length) {
      nodes.push(h('div', { class: 'card' }, h('h3', null, `File di ${p.name} (${st.files.length})`),
        st.files.map((f) => fileRow(f, st.parsed.find((x) => x.file.id === f.id), k))));
      nodes.push(h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: () => { go(ui.res && ui.res.groups.blockCount ? 'checks' : 'invest'); } }, 'Avanti: controlla i dati'),
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
      check('o_carry', 'useCarry', 'Riporta le minusvalenze degli anni precedenti', 'Le perdite che emergono dai tuoi file (dal 2023) riducono le tasse degli anni successivi, entro 4 anni. Per legge valgono solo se le hai indicate nella dichiarazione dell\'anno in cui le hai avute (quadro RT): se quell\'anno non le avevi dichiarate, togli la spunta. Per il 2023 e il 2024 si riportano solo le perdite nette oltre 2.000 €.'),
      h('div', { class: 'check' },
        h('input', { type: 'checkbox', id: 'o_swapall', checked: s.swapRule === 'all', onchange: (e) => { s.swapRule = e.target.checked ? 'all' : 'circ30'; changed(); } }),
        h('label', { for: 'o_swapall' }, h('strong', null, 'Tassa anche gli scambi tra cripto (es. BTC → ETH)')),
        h('span', { class: 'hint muted small' }, 'Normalmente spento. Secondo l\'Agenzia delle Entrate (Circolare 30/E del 2023) lo scambio tra due cripto non è una vendita: non si paga niente e il costo passa alla cripto ricevuta. Si paga invece quando passi a euro, a stablecoin (USDC, USDT…) o paghi con le cripto. Accendilo solo se il tuo commercialista preferisce tassare ogni scambio.')),
      check('o_rebase', 'rebase2025', 'Ho rideterminato il costo al 1° gennaio 2025', 'Facoltativo e raro: pagando un\'imposta del 18% (entro il 1° dicembre 2025) sul valore delle cripto possedute il 1/1/2025, quel valore diventa il nuovo costo di acquisto, ma una vendita in perdita di quelle cripto non dà una minusvalenza. Se non sai di cosa si tratta lascia spento: vuol dire che non l\'hai fatto.'));
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
      out.push({ kind: 'dup', uid: i.uid, action: 'dup_skip',
        text: `${d.count === 1 ? 'Un\'operazione è scritta' : d.count + ' operazioni sono scritte'} due volte nei tuoi file (${d.names.join(' e ')}). Esempi: ${d.examples.join('; ')}. Sono le stesse: le conto una volta sola.` });
    }
    for (const i of res.groups.conversions) {
      const dt = i.data;
      if (CT.STABLE.has(dt.asset) && CT.STABLE.has(dt.counter)) continue;   // tra due stablecoin non c'e' una risposta ovvia: resta la domanda
      const same = dt.qty.minus(dt.counterQty).abs().lte(dt.qty.times('0.001'));
      out.push({ kind: 'conv', uid: i.uid, action: same ? 'migration' : 'swap',
        text: same ? `Il ${dmy(dt.day)} Crypto.com ha cambiato ${qty(dt.qty)} ${dt.asset} in ${qty(dt.counterQty)} ${dt.counter}: stessa quantità, di solito è un cambio di nome o una migrazione. Non è una vendita e non si paga niente.`
          : `Il ${dmy(dt.day)} hai cambiato ${qty(dt.qty)} ${dt.asset} in ${qty(dt.counterQty)} ${dt.counter}: quantità diverse, per il fisco è una vendita (si paga la tassa sul guadagno).` });
    }
    return out;
  }
  function panelChecks() {
    const res = ui.res;
    if (!res) return noData();
    const g = res.groups;
    const out = [];
    if (!g.blockCount && g.assumptionCount) out.push(h('div', { class: 'card tone-warn' }, h('h2', null, g.assumptionCount === 1 ? 'Quasi pronto: c\'è 1 ipotesi' : `Quasi pronto: ci sono ${g.assumptionCount} ipotesi`),
      h('p', { class: 'muted' }, 'Non resta niente da sistemare, ma il risultato si basa su scelte che hai fatto tu o su stime del programma (le trovi qui sotto, e nei PDF). Falle vedere al commercialista.'),
      h('button', { class: 'btn quiet', onclick: () => { go('invest', { investTab: 'ops', detail: 'giacenze' }); } }, 'Confronta le quantità con quelle dell\'app')));
    else if (!g.blockCount) out.push(h('div', { class: 'card tone-good' }, h('h2', null, 'Tutto a posto'), h('p', { class: 'muted' }, 'Non ci sono punti da risolvere. Se hai un attimo, confronta le quantità che risultano a fine anno con quelle che vedi nell\'app della piattaforma.'),
      h('button', { class: 'btn quiet', onclick: () => { go('invest', { investTab: 'ops', detail: 'giacenze' }); } }, 'Vedi le quantità')));
    else out.push(h('div', { class: 'card tone-warn' }, h('h2', null, g.blockCount === 1 ? '1 cosa da controllare' : `${g.blockCount} cose da controllare`), h('p', { class: 'muted' }, 'Finché non le sistemi, il calcolo delle imposte è una bozza. Qui sotto trovi solo quello che il programma non può sapere da solo.')));

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
    const recUids = new Set(rec.map((r) => r.uid));
    const nearDupShow = g.nearDup.filter((i) => ui.manualChoices || !recUids.has(i.uid));
    const convShow = g.conversions.filter((i) => ui.manualChoices || !recUids.has(i.uid));
    if (nearDupShow.length) {
      const applyAll = (action, msg) => { nearDupShow.forEach((i) => { state.resolutions[i.uid] = { action }; }); changed(); toast(msg); };
      for (const i of nearDupShow) {
        const d = i.data;
        out.push(issueCard('bad', `Sembra la stessa operazione in più file (${d.count})`,
          `In ${d.names.map((x) => `«${x}»`).join(' e in ')} ${d.count === 1 ? 'c\'è un\'operazione' : 'ci sono ' + d.count + ' operazioni'} con la stessa data (entro 5 minuti), lo stesso asset e la stessa quantità. Di solito sono le stesse operazioni esportate due volte (per esempio l'export «contanti» e quello «criptovaluta»): se le contassi due volte, acquisti e vendite risulterebbero doppi.`,
          h('ul', { class: 'clean muted small' }, d.examples.map((m) => h('li', null, m))),
          h('div', { class: 'row' },
            h('button', { class: 'btn primary', onclick: () => resolve(i.uid, { action: 'dup_skip' }, 'Contate una volta sola') }, 'Sono le stesse: contale una volta'),
            h('button', { class: 'btn', onclick: () => resolve(i.uid, { action: 'ack' }, 'Annotato: sono operazioni diverse') }, 'Sono diverse: tienile tutte'))));
      }
      if (nearDupShow.length > 1) out.push(h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => applyAll('dup_skip', 'Contate una volta sola') }, `Sono le stesse in tutti i casi (${nearDupShow.length})`),
        h('button', { class: 'btn', onclick: () => applyAll('ack', 'Annotato: sono operazioni diverse') }, 'Sono sempre diverse')));
    }
    if (convShow.length) {
      const setAll = (action, msg) => { convShow.forEach((i) => { state.resolutions[i.uid] = { action }; }); changed(); toast(msg); };
      const WHAT = 'Crypto.com ha convertito da solo questo saldo in un altro token (per esempio quando un token cambia nome o viene aggiornato). Se è un aggiornamento 1 a 1 dello stesso token non è una vendita: nessuna tassa e il costo di acquisto passa al nuovo token. Se lo consideri uno scambio tra cripto diverse, è una vendita imponibile.';
      out.push(issueCard('bad', convShow.length === 1 ? 'Conversione di saldo da classificare' : `${convShow.length} conversioni di saldo da classificare`, WHAT,
        h('ul', { class: 'clean', style: 'display:grid;gap:12px' }, convShow.map((i) => {
          // stesse quantita' = di solito cambio di nome o migrazione 1 a 1; quantita' diverse = di solito una vera conversione
          const same = i.data.qty.minus(i.data.counterQty).abs().lte(i.data.qty.times('0.001'));
          return h('li', { class: 'row between' },
            h('span', null, i.message, h('div', { class: 'small muted' }, same ? 'Le quantità sono uguali: di solito è un cambio di nome o una migrazione del token.' : 'Le quantità sono diverse: di solito è una vera conversione in un altro asset, quindi una vendita.')),
            h('span', { class: 'row' },
              h('button', { class: `btn${same ? ' primary' : ''}`, onclick: () => resolve(i.uid, { action: 'migration' }, 'Trattata come aggiornamento del token') }, 'Aggiornamento del token'),
              h('button', { class: `btn${same ? '' : ' primary'}`, onclick: () => resolve(i.uid, { action: 'swap' }, 'Trattata come scambio imponibile') }, 'Scambio imponibile')));
        })),
        convShow.length > 1 ? h('div', { class: 'row' },
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
      const v = i.data.value;
      out.push(issueCard('bad', `${qty(i.data.qty)} ${i.data.asset} arrivati su ${i.data.account} il ${dmy(i.data.day)}`,
        /Bitpanda/.test(i.data.note || '') ? `Bitpanda la chiama «transfer»: può essere uno spostamento tra i suoi prodotti, un bonus, un cashback o un regalo.${v ? ` Valore all'arrivo secondo il file: ${money(v)}.` : ''} Se è un premio della piattaforma usa il valore all'arrivo come costo.`
          : `Non so da dove vengono. Per calcolare l'eventuale guadagno mi serve quanto li avevi pagati.${v ? ` Valore all'arrivo secondo il file: ${money(v)}.` : ''}`,
        h('div', { class: 'fields' }, cost.el, when.el),
        h('div', { class: 'row' },
          v ? h('button', { class: 'btn primary', onclick: () => resolve(i.uid, { action: 'set_cost', cost_eur: v.toFixed(2) }, 'Costo = valore all\'arrivo') }, `Costo = valore all'arrivo (${money(v)})`) : null,
          h('button', { class: v ? 'btn' : 'btn primary', onclick: () => { const c = needNumber(cost.input.value, 'il costo'); if (c) resolve(i.uid, { action: 'set_cost', cost_eur: c, acquired: when.input.value || undefined }, 'Costo salvato'); } }, 'Salva il costo scritto'),
          h('button', { class: 'btn', onclick: () => resolve(i.uid, { action: 'from_self_custody' }, 'Registrato come ritorno da un tuo wallet') }, 'Arrivano da un mio wallet'),
          h('button', { class: 'btn quiet', onclick: () => resolve(i.uid, { action: 'set_cost', cost_eur: '0' }, 'Costo zero registrato') }, 'Costo zero (regalo, premio…)'))));
    }
    if (g.history.length) {
      const items = g.history;
      const one = items.length === 1;
      const assets = [...new Set(items.map((i) => i.data.asset))];
      const platOf = (i) => Object.keys(P).find((k) => P[k].account && P[k].account === i.data.account) || 'other';
      const costFields = items.map((i) => {
        const cost = field(`Quanto hai speso in tutto per ${qty(i.data.qty)} ${i.data.asset}? (in euro)`, { placeholder: 'es. 400', id: `h_${i.uid}`, inputmode: 'decimal' });
        const when = field('Data di acquisto (facoltativa)', { type: 'date', id: `hd_${i.uid}` });
        return h('div', null, h('div', { class: 'fields' }, cost.el, when.el),
          h('button', { class: 'btn', onclick: () => { const v = needNumber(cost.input.value, 'il costo'); if (v) resolve(i.uid, { action: 'cover_cost', cost_eur: v, qty: i.data.qty.toString(), acquired: when.input.value || undefined }, 'Costo salvato'); } }, 'Salva questo costo'));
      });
      out.push(issueCard('bad', one ? `Non trovo quando hai comprato ${assets[0]}` : `Non trovo quando hai comprato ${assets.length <= 3 ? assets.join(', ') : assets.length + ' monete'}`,
        'Nei file che hai caricato manca l\'acquisto. Di solito significa che manca un file più vecchio, dall\'apertura del conto: se ce l\'hai caricalo e questo punto sparisce da solo.',
        h('ul', { class: 'clean muted small' }, items.map((i) => h('li', null, `${dmy(i.data.day)} · ${i.data.account} · ${qty(i.data.qty)} ${i.data.asset}`))),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: () => openPlatform(platOf(items[0]), 'file') }, 'Ho altri file'),
          h('button', { class: 'btn', onclick: () => { items.forEach((i) => { state.resolutions[i.uid] = { action: 'cover_cost', cost_eur: '0', qty: i.data.qty.toString(), undocumented: true }; }); changed(); toast('Calcolato con costo 0'); } }, 'Non ho documenti: vai avanti con costo 0')),
        h('p', { class: 'small muted' }, 'Se non puoi dimostrare quanto hai speso, il costo conta come zero e tutto l\'incasso è guadagno: pagheresti più tasse del dovuto. Se hai una ricevuta o un estratto conto, scrivi qui sotto la cifra: le tasse scendono. Il commercialista può confermare.'),
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
          h('button', { class: 'btn primary', onclick: () => { go('files', { platform: i.data.platform, method: 'file' }); } }, 'Aggiungi il file'),
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
    if (g.prices.size || res.engine.missingPrices.size) {
      const n = res.engine.missingPrices.size;
      const why = priceReasons(res);
      const kinds = [...res.engine.missingPrices.keys()].map((k) => why.get(k) || 'op');
      const onlyRW = kinds.length > 0 && kinds.every((x) => x === 'rw');
      const blocking = g.prices.size > 0;
      const status = h('p', { class: 'small muted' }, ui.busy ? 'Sto scaricando i prezzi…'
        : ui.priceFail ? (insideClaude() ? `Non sono riuscito a scaricarne ${ui.priceFail}: dentro claude.ai il download non è possibile. Apri il link pubblicato.`
          : `Non sono riuscito a scaricarne ${ui.priceFail}. ${(ui.priceWhy || []).join(' · ')}. Riprova tra qualche minuto, oppure scrivili a mano.`)
          : 'Li scarico da solo: cripto da Binance, Crypto.com, Kraken, Coinbase o CryptoCompare; oro e metalli dal prezzo ufficiale LBMA; valute dalla BCE. Dentro claude.ai non è possibile: apri il link pubblicato.');
      const btns = h('div', { class: 'row' },
        h('button', { class: 'btn primary', disabled: !!ui.busy, onclick: () => autoPrices(false) }, ui.busy || (blocking ? 'Scarica i prezzi in automatico' : 'Riprova a scaricare i prezzi esatti')),
        h('button', { class: 'btn', onclick: () => { go('prices'); } }, 'Vedi e inserisci a mano'));
      if (blocking) {
        out.push(issueCard('bad', onlyRW ? (n === 1 ? 'Manca 1 valore di fine anno per il quadro RW' : `Mancano ${n} valori di fine anno per il quadro RW`) : (n === 1 ? 'Manca 1 prezzo in euro' : `Mancano ${n} prezzi in euro`),
          onlyRW ? 'Il file contiene già il valore in euro di ogni operazione e il programma lo usa. Quello che manca sono i prezzi del 31 dicembre (e del 1° gennaio) delle cripto che possiedi: non stanno in nessuna riga perché quel giorno non è successo niente. Servono solo al prospetto RW e all\'imposta sul valore; non cambiano le plusvalenze né l\'imposta sostitutiva.'
            : 'Servono soprattutto al prospetto del monitoraggio (RW: valore delle cripto al 1° gennaio e al 31 dicembre) e a valorizzare qualche operazione che nel file non ha un valore in euro.', btns, status));
      } else {
        out.push(issueCard('warn', n === 1 ? 'Ho stimato 1 prezzo di fine anno' : `Ho stimato ${n} prezzi di fine anno`,
          'Per il quadro RW servono i prezzi del 31 dicembre (e del 1° gennaio) di quello che possiedi. Non li ho trovati nei tuoi file e non sono ancora riuscito a scaricarli, quindi per ora ho usato il prezzo più vicino che conosco (anche di mesi prima) e l\'ho segnato «stimato». Se hai l\'estratto conto al 31/12 della piattaforma, il prezzo scritto lì è quello giusto: inseriscilo nella pagina dei prezzi. Non cambia le tasse sulle vendite: cambia il valore del quadro RW e la piccola imposta sul valore (IVCA).', btns, status));
      }
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
      return `${what}: ${act}${res.engine.obsolete.has(key) ? ' (non serve più: con le regole applicate non è una vendita)' : ''}`;
    };
    return h('details', { class: 'card', open: !res.groups.blockCount }, h('summary', null, `Decisioni prese (${decided.length})`),
      h('p', { class: 'muted small' }, 'Le scelte che hai fatto finora. Se ti sei sbagliato annullala: il punto tornerà tra le cose da controllare.'),
      h('ul', { class: 'clean', style: 'display:grid;gap:8px' }, decided.map((d) => h('li', { class: 'row between' },
        h('span', { class: 'small' }, label(d)),
        h('button', { class: 'btn quiet', onclick: () => { delete state.resolutions[d[0]]; changed(); toast('Scelta annullata'); } }, 'Annulla')))));
  }

  // ------------------------------------------------------------------ pannello: calcolo imposte
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
    if (b.nonDeductible.gt(0)) rows.push({ label: 'Perdite su cripto rideterminate al 1/1/2025: non deducibili (già escluse)', value: money(b.nonDeductible) });
    rows.push({ label: 'Imponibile', value: money(b.taxable), cls: 'total' });
    rows.push({ label: `Imposta sostitutiva (${pct(b.rate)}${b.emtShare.gt(0) ? ', di cui parte al 26% su stablecoin in euro' : ''})`, value: money(b.tax), cls: 'total' });
    if (b.newLoss.gt(0)) rows.push({ label: `Minusvalenza ${b.year} da riportare agli anni successivi (va indicata in dichiarazione)`, value: money(b.newLoss) });
    if (b.lossNotCarried.gt(0)) rows.push({ label: `Minusvalenza ${b.year} non riportabile (fino a 2.000 € nel 2023-2024 non si riporta)`, value: money(b.lossNotCarried) });
    for (const c of b.carryUnused) rows.push({ label: `Minusvalenza ${c.year} ancora disponibile`, value: money(c.amount) });
    for (const c of b.carryExpired) rows.push({ label: `Minusvalenza ${c.year} scaduta (oltre 4 anni)`, value: money(c.amount) });
    return h('div', { class: 'card' }, h('h2', null, b.name), h('p', { class: 'muted small' }, `${b.law} · ${b.nDisposals} cessioni nell'anno · quadro RT`),
      b.nDisposals === 0 && b.income.isZero() ? h('p', { class: 'muted' }, 'Nessuna operazione imponibile in questo anno.') : kvTable(rows));
  }

  /** «Da dove arriva l'imposta»: elenca cosa ha contato il programma (vendite, scambi, pagamenti, premi), cosi' si capisce anche senza aver venduto. */
  function sourcesCard(res) {
    const sx = R.taxSources(res);
    if (!sx.rows.length && !sx.neutralSwaps) return null;
    const signed = (r) => (r.group === 'income' ? money(r.amount) : `${r.amount.gte(0) ? '+' : '−'} ${money(r.amount.abs())}`);
    const rows = sx.rows.map((r) => h('tr', null,
      h('td', null, r.label, h('div', { class: 'small muted' }, r.group === 'income' ? 'tassato per intero' : 'guadagno (+) o perdita (−)')),
      h('td', { class: 'num' }, r.count), h('td', { class: 'num' }, signed(r))));
    const intro = sx.hasSales ? `Questo è tutto quello che il programma ha contato nel ${res.year}.`
      : `Nel ${res.year} non risultano vendite in euro. Ma il fisco tassa anche altre cose: ecco quali ha trovato il programma nei tuoi file.`;
    return h('div', { class: 'card' },
      h('h2', null, `Da dove arriva l'imposta del ${res.year}`),
      h('p', { class: 'muted' }, intro),
      h('div', { class: 'tbl-wrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', null, 'Che cosa'), h('th', { class: 'num' }, 'Quante'), h('th', { class: 'num' }, 'Importo'))),
        h('tbody', null, rows))),
      sx.hasCashback ? h('p', { class: 'small' }, 'Il cashback della carta lo conto come un guadagno (scelta prudenziale). Se il tuo commercialista lo considera uno sconto sulla spesa, l\'imposta scende: chiedigli come vuole trattarlo.') : null,
      sx.neutralSwaps ? h('p', { class: 'small' }, `In più ${sx.neutralSwaps === 1 ? 'c\'è 1 scambio' : `ci sono ${sx.neutralSwaps} scambi`} tra crypto (es. BTC → ETH) che non ${sx.neutralSwaps === 1 ? 'è tassato' : 'sono tassati'}: per l'Agenzia delle Entrate non sono vendite, il costo passa alla crypto ricevuta.`) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn quiet', onclick: () => { go('invest', { investTab: 'ops', detail: 'cessioni' }); } }, 'Vedi vendite e scambi'),
        h('button', { class: 'btn quiet', onclick: () => { go('invest', { investTab: 'ops', detail: 'proventi' }); } }, 'Vedi premi e interessi')));
  }

  // ------------------------------------------------------------------ mattoni comuni delle pagine
  const go = (tab, extra) => { Object.assign(ui, extra || {}); ui.tab = tab; ui.navOpen = false; if (tab === 'files' && !(extra && 'platform' in extra)) ui.platform = null; render(); window.scrollTo(0, 0); };
  /** Scheda con titolo, testo di introduzione facoltativo e contenuto. */
  function card(title, intro, ...kids) {
    return h('section', { class: 'card' }, title ? h('h2', null, title) : null, intro ? h('p', { class: 'muted' }, intro) : null, ...kids);
  }
  const kpi = (label, value, sub, tone) => h('div', { class: `kpi${tone ? ' ' + tone : ''}` },
    h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value' }, value), sub ? h('div', { class: 'kpi-sub' }, sub) : null);
  const kpis = (...items) => h('div', { class: 'kpis' }, items.filter(Boolean));
  /** Riquadro colorato per avvisi e conferme: tone = info | good | warn | bad. */
  const callout = (tone, title, text, ...actions) => h('div', { class: `callout ${tone}` },
    h('div', null, title ? h('strong', null, title) : null, text ? h('p', null, text) : null), actions.filter(Boolean).length ? h('div', { class: 'row' }, actions) : null);
  const linkBtn = (label, tab, extra, primary) => h('button', { class: `btn${primary ? ' primary' : ''}`, onclick: () => go(tab, extra) }, label);
  function draftCallout(res) {
    const blk = res.groups.blockCount;
    if (!blk) return null;
    return callout('warn', `Bozza: ${blk} ${blk === 1 ? 'punto' : 'punti'} da controllare negli investimenti`, 'Finché non li sistemi i numeri degli investimenti possono cambiare.', linkBtn('Vai a «Da controllare»', 'checks'));
  }
  function emptyState(title, text, action, tab) {
    return h('section', { class: 'card empty' }, h('h2', null, title), h('p', { class: 'muted' }, text), action ? linkBtn(action, tab, null, true) : null);
  }
  const whereTable = (rows) => {
    const codes = rows.some(([a]) => a);
    return h('div', { class: 'tbl-wrap' }, h('table', { class: 'where' },
      h('thead', null, h('tr', null, codes ? h('th', null, 'Rigo') : null, h('th', null, codes ? 'Cosa' : 'Voce'), h('th', { class: 'num' }, 'Importo'))),
      h('tbody', null, rows.map(([a, b, v]) => h('tr', null, codes ? h('td', null, a ? h('span', { class: 'code' }, a) : null) : null, h('td', null, b), h('td', { class: 'num' }, typeof v === 'string' ? v : money(v)))))));
  };

  /** Come copiare una Certificazione Unica: [punto, cosa c'e' scritto, dove va]. */
  const cuGuide = (rows) => h('div', { class: 'tbl-wrap' }, h('table', { class: 'where' },
    h('thead', null, h('tr', null, h('th', null, 'Punto CU'), h('th', null, 'Cosa c\'è scritto'), h('th', null, 'Dove va'))),
    h('tbody', null, rows.map(([a, b, d]) => h('tr', null, h('td', null, h('span', { class: 'code' }, a)), h('td', null, b), h('td', null, d))))));

  // ------------------------------------------------------------------ redditi (stipendio, musica, spese): dati inseriti a mano
  function othersState() {
    const o = state.others = state.others || {};
    if (!Array.isArray(o.occ)) o.occ = [];
    if (!Array.isArray(o.dir)) o.dir = [];
    if (!o.skip || typeof o.skip !== 'object') o.skip = {};
    return o;
  }
  const othersChanged = () => { ui.ver++; ui.pdf = null; save(); render(); };
  /** Mentre si scrive: niente ridisegno della pagina (si perderebbe il campo attivo), solo i riquadri dei risultati. */
  const othersTyped = () => {
    ui.ver++; ui.pdf = null; save();
    const c = CT.others.compute(othersState());
    for (const box of document.querySelectorAll('[data-live]')) box.replaceChildren(...liveBox(box.dataset.live, c));
  };
  const WHERE = { lavoro: /^(RC|RV3$|RV11$)/, musica: /^(RL|Ritenute sez|Riepilogo sez)/, spese: /^(RP|Quadro RP)/, addiz: /^RV/ };
  const stepsTable = (st) => kvTable(st.map(([label, v]) => ({ label, value: v.lt(0) ? `− ${money(v.neg())}` : money(v), cls: /da versare|a credito/.test(label) ? 'total' : null })));
  function estimateNodes(c) {
    if (!c.any) return [h('p', { class: 'muted small' }, 'Inserisci stipendio, compensi o spese nelle pagine precedenti: qui compare la stima dell\'IRPEF da versare o a credito.')];
    return [stepsTable(CT.others.steps(c)),
      h('p', { class: 'small muted' }, 'Stima con le regole del 2025: l\'importo esatto lo calcola il software della dichiarazione (precompilata o commercialista). Non sono considerati familiari a carico, immobili e trattamento integrativo tra 15.000 e 28.000 €. Fino a 12 € per ciascuna imposta non si versa e non si rimborsa.')];
  }
  function addizNodes(c) {
    if (!c.any) return [h('p', { class: 'muted small' }, 'Inserisci i redditi nelle pagine precedenti: qui compare il calcolo delle addizionali.')];
    const rv = CT.others.where(c).filter(([r]) => WHERE.addiz.test(r));
    return [stepsTable(CT.others.addizSteps(c)), rv.length ? [h('h3', null, 'Dove si scrive (quadro RV)'), whereTable(rv)] : null];
  }
  function liveBox(kind, c) {
    if (kind === 'estimate') return estimateNodes(c);
    if (kind === 'addiz') return addizNodes(c);
    const rows = CT.others.where(c).filter(([r]) => WHERE[kind].test(r));
    return rows.length ? [whereTable(rows)] : [h('p', { class: 'muted small' }, 'Compila i campi qui sopra: qui compare in quale rigo del modello va ogni numero.')];
  }
  const live = (kind) => h('div', { 'data-live': kind }, liveBox(kind, CT.others.compute(othersState())));

  /** Tabella modificabile: una riga per ricevuta o certificazione. */
  function rowsEditor(list, cols, emptyRow, addLabel) {
    const body = list.map((r, idx) => h('tr', null,
      cols.map((c) => h('td', { 'data-l': c.label }, h('input', { type: 'text', value: r[c.key] || '', placeholder: c.ph || '', inputmode: c.num ? 'decimal' : null, 'aria-label': c.label,
        class: c.num ? 'num-in' : null, oninput: (e) => { r[c.key] = e.target.value; othersTyped(); } }))),
      h('td', { class: 'act' }, h('button', { class: 'btn quiet danger', 'aria-label': 'Elimina la riga', onclick: () => { list.splice(idx, 1); othersChanged(); } }, 'Elimina'))));
    return h('div', { class: 'editor' },
      list.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'edit' }, h('thead', null, h('tr', null, cols.map((c) => h('th', { class: c.num ? 'num' : null }, c.label)), h('th', null, ''))), h('tbody', null, body))) : null,
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { list.push(Object.assign({ id: uid() }, emptyRow)); othersChanged(); } }, addLabel)));
  }
  const numField = (o, key, label, ph, hint) => h('label', { class: 'field' }, h('span', null, label),
    h('input', { type: 'text', inputmode: 'decimal', value: o[key] || '', placeholder: ph || '', oninput: (e) => { o[key] = e.target.value; othersTyped(); } }), hint ? h('small', { class: 'muted' }, hint) : null);
  function skipToggle(o, key, label, filled) {
    if (filled) return null;
    return h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: !!o.skip[key], onchange: (e) => { o.skip[key] = e.target.checked; othersChanged(); } }), h('span', null, label));
  }
  function precompilataTip() {
    return h('details', { class: 'card tip' }, h('summary', null, 'Il modo più semplice: la dichiarazione precompilata'),
      h('ol', { class: 'steps' },
        h('li', null, 'Entra nel sito dell\'Agenzia delle Entrate con SPID, CIE o CNS e apri la «Dichiarazione precompilata», modello Redditi PF.'),
        h('li', null, 'Trovi già le Certificazioni Uniche (stipendio, SIAE, etichette e locali che ti hanno pagato con ritenuta) e le spese sanitarie del Sistema Tessera Sanitaria: controlla che ci siano tutte.'),
        h('li', null, 'Aggiungi quello che manca (compensi senza CU, pagamenti dall\'estero, quadri RT e RW degli investimenti) con i numeri della pagina «Guida alla compilazione».'),
        h('li', null, 'Il programma dell\'Agenzia calcola IRPEF, addizionali e acconti e prepara l\'F24.')));
  }

  function pageLavoro() {
    const o = othersState(), c = CT.others.compute(o), Y = state.settings.year;
    return [
      skipToggle(o, 'lavoro', `Nel ${Y} non ho avuto stipendio né pensione`, c.altri.gt(0)),
      o.skip.lavoro && !c.altri.gt(0) ? callout('good', 'Sezione completata', 'Hai indicato che non hai redditi da lavoro dipendente o pensione.') : [
        card('Dati della Certificazione Unica', `Il datore di lavoro (o l'INPS, per la pensione) ti manda la CU ${Y + 1} con i dati del ${Y}. Con più datori di lavoro somma redditi e ritenute di tutte le CU.`,
          h('div', { class: 'fields' },
            numField(o, 'altri', 'Reddito di lavoro dipendente o pensione (€)', 'es. 28000', 'CU, punto 1 (indeterminato) o 2 (determinato); pensione punto 3'),
            numField(o, 'giorni', 'Giorni di lavoro', '365', 'CU, punto 6 o 7'),
            numField(o, 'ritCU', 'Ritenute IRPEF (€), facoltativo', 'es. 4200', 'CU, punto 21: se vuoto si considera giusto quanto trattenuto in busta paga'),
            numField(o, 'addRegTr', 'Addizionale regionale trattenuta (€)', 'es. 420', 'CU, punto 22'),
            numField(o, 'addComTr', 'Addizionale comunale trattenuta (€)', 'es. 160', 'CU, punti 26 e 27 (acconto e saldo): somma i due'))),
        card('Dove si scrive', 'Quadro RC del modello Redditi PF. Nella precompilata questi dati ci sono già.', live('lavoro')),
      ],
      precompilataTip(),
    ];
  }

  function pageMusica() {
    const o = othersState(), c = CT.others.compute(o), Y = state.settings.year;
    const filled = c.occ.length + c.dir.length > 0;
    return [
      skipToggle(o, 'musica', `Nel ${Y} non ho avuto compensi da musica o lavori occasionali`, filled),
      o.skip.musica && !filled ? callout('good', 'Sezione completata', 'Hai indicato che non hai compensi occasionali né diritti d\'autore.') : [
        card('Serate da DJ e lavori occasionali', 'Ricevute di «prestazione occasionale» senza partita IVA. Una riga per ricevuta o per Certificazione Unica: chi ti ha pagato, il lordo, la ritenuta del 20% e le spese documentate. Se il locale, l\'associazione o la società ti ha mandato la CU (causale M), copia il punto 4 nel lordo e il punto 9 nella ritenuta.',
          rowsEditor(o.occ, [{ key: 'chi', label: 'Chi ti ha pagato', ph: 'es. Locale XY' }, { key: 'lordo', label: 'Lordo € (CU punto 4)', num: true, ph: '500' }, { key: 'rit', label: 'Ritenuta € (CU punto 9)', num: true, ph: '100' }, { key: 'spese', label: 'Spese €', num: true, ph: '0' }], {}, '+ Aggiungi una ricevuta o una CU'),
          h('ul', { class: 'notes' },
            h('li', null, 'Se fai serate in modo continuativo e organizzato non è più «occasionale»: serve la partita IVA.'),
            h('li', null, 'Oltre 5.000 € di compensi l\'anno scatta l\'iscrizione alla Gestione separata INPS (i contributi li versa in parte il committente).'))),
        card('Diritti d\'autore e royalties', `SIAE, editori musicali, etichette, distributori. La SIAE ti manda ogni anno la Certificazione Unica ${Y + 1} con i diritti del ${Y}: come per lo stipendio, aggiungi una riga per ogni CU e copia due numeri. Se sei l'autore (testi, musica, produzione firmata) si paga sul 75% del lordo, sul 60% se avevi meno di 35 anni: la riduzione la fa il programma.`,
          cuGuide([
            ['1', 'Causale: B = diritti d\'autore', 'questa tabella (con M va in quella delle serate)'],
            ['4', 'Ammontare lordo corrisposto', 'colonna «Lordo»'],
            ['7 e 8', 'Parte non tassata (25% o 40%) e imponibile', 'non servono: non copiarli'],
            ['9', 'Ritenute a titolo d\'acconto', 'colonna «Ritenuta»'],
          ]),
          h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: !!o.under35, onchange: (e) => { o.under35 = e.target.checked; othersTyped(); } }), h('span', null, `Nel ${Y} avevo meno di 35 anni (la parte esente sale dal 25% al 40%)`)),
          rowsEditor(o.dir, [{ key: 'chi', label: 'Da chi', ph: 'es. SIAE, etichetta' }, { key: 'lordo', label: 'Lordo € (CU punto 4)', num: true, ph: '1000' }, { key: 'rit', label: 'Ritenuta € (CU punto 9)', num: true, ph: '150' }], {}, '+ Aggiungi una CU o un pagamento'),
          h('ul', { class: 'notes' },
            h('li', null, 'Più CU dalla SIAE (per esempio una per ogni mandato o anno)? Una riga per ciascuna. Royalties come interprete (non autore): guarda la causale della CU. B = diritti d\'autore (rigo RL25), M = lavoro occasionale (rigo RL15). Senza CU fai confermare al commercialista.'),
            h('li', null, 'Pagamenti dall\'estero (DistroKid, YouTube, Bandcamp…): niente ritenuta italiana, si dichiara il lordo in euro. Per tasse trattenute all\'estero chiedi il credito d\'imposta (quadro CE); un conto PayPal estero va nel quadro RW.'))),
        card('Dove si scrive', 'Quadro RL: serate al rigo RL15, diritti d\'autore al rigo RL25. Riduzione forfettaria e ritenute vanno nei righi di riepilogo, li calcola il software.', live('musica')),
      ],
    ];
  }

  function pageSpese() {
    const o = othersState(), c = CT.others.compute(o), Y = state.settings.year;
    const filled = c.sanTot.gt(0) || c.altreDetr.gt(0) || c.ded.gt(0);
    return [
      skipToggle(o, 'spese', `Nel ${Y} non ho spese da detrarre`, filled),
      o.skip.spese && !filled ? callout('good', 'Sezione completata', 'Hai indicato che non hai spese da detrarre.') : [
        card('Spese sanitarie', 'Visite, esami, farmaci, dentista, occhiali, per te e per i familiari a carico. Il 19% di quello che supera 129,11 € si toglie dall\'IRPEF. Serve il pagamento con carta, bancomat o bonifico, tranne farmaci, dispositivi medici e strutture pubbliche o convenzionate.',
          h('div', { class: 'fields' }, numField(o, 'san', `Totale spese sanitarie ${Y} (€)`, 'es. 850', 'Nella precompilata le trovi già dal Sistema Tessera Sanitaria'))),
        card('Altre spese che fanno risparmiare', 'Interessi del mutuo prima casa, istruzione, sport dei figli, veterinario, assicurazioni (19%); bonus edilizi (rata dell\'anno); fondi pensione e contributi volontari (deducibili). Scrivi il totale già calcolato.',
          h('div', { class: 'fields' },
            numField(o, 'altreDetr', 'Altre detrazioni (€ da togliere dall\'IRPEF)', 'es. 380', 'Quadro RP, sezioni I e III'),
            numField(o, 'deducibili', 'Oneri deducibili (€ da togliere dal reddito)', 'es. 1500', 'Quadro RP, sezione II'))),
      ],
      card('Dove si scrive', 'Quadro RP del modello Redditi PF.', live('spese')),
    ];
  }

  function pageIrpef() {
    const o = othersState(), c = CT.others.compute(o), Y = state.settings.year;
    const noCU = c.altri.gt(0) && (c.reg.trat === null || c.com.trat === null);
    return [
      card('IRPEF su tutti i redditi (stima)', 'Stipendio, musica e spese delle pagine precedenti messi insieme, con le regole del 2025.', live('estimate')),
      card('Addizionali regionale e comunale', `Sono una percentuale del reddito decisa dalla tua Regione e dal tuo Comune. Se conosci quanto devi per il ${Y} (nella precompilata ai righi RV2 e RV10, oppure dal commercialista) scrivilo qui e il programma usa il tuo numero. Se lasci vuoto lo stimo ${c.altri.gt(0) ? 'con le aliquote che risultano dalla tua CU' : 'con un\'aliquota media'}.`,
        h('div', { class: 'fields' },
          numField(o, 'addRegMan', `Addizionale regionale dovuta ${Y} (€)`, 'vuoto = stima', 'Precompilata, rigo RV2'),
          numField(o, 'addComMan', `Addizionale comunale dovuta ${Y} (€)`, 'vuoto = stima', 'Precompilata, rigo RV10')),
        noCU ? callout('info', 'Hai la CU dello stipendio?', 'Scrivi anche le addizionali già trattenute in busta paga (punti 22, 26 e 27) nella pagina «Lavoro dipendente». Senza, il programma suppone che il datore di lavoro abbia trattenuto il giusto.', linkBtn('Lavoro dipendente', 'lavoro')) : null,
        live('addiz')),
    ];
  }

  // ------------------------------------------------------------------ cosa pagare
  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const payPlan = (res) => CT.payments.plan(res, state, { payDay: ui.payDay || todayIso() });
  const laterOf = (p) => p.items.filter((i) => !p.now.includes(i) && !i.credit);

  function payTable(p) {
    const later = laterOf(p);
    const laterSum = later.reduce((s, i) => s.plus(i.payAmount), CT.ZERO);
    const GROUPS = [['inv', 'Investimenti'], ['other', 'Redditi (stima)']];
    const row = (i) => i.credit
      ? h('tr', { class: 'credit' }, h('td', { 'data-l': 'Cosa' }, h('strong', null, i.title), h('div', { class: 'small muted' }, i.why)), h('td', { 'data-l': 'Codice F24' }, '—'), h('td', { 'data-l': 'Quando' }, 'in dichiarazione'), h('td', { class: 'num', 'data-l': 'Importo' }, h('strong', { class: 'good-txt' }, `credito ${money(i.creditAmount)}`)))
      : h('tr', null,
        h('td', { 'data-l': 'Cosa paghi' }, h('strong', null, i.title), h('div', { class: 'small muted' }, i.why), h('div', { class: 'small muted' }, `Dove: ${i.quadro}`), i.note ? h('div', { class: 'small muted' }, i.note) : null),
        h('td', { 'data-l': 'Codice F24' }, h('span', { class: 'code' }, i.code), i.codeCheck ? h('div', { class: 'small muted' }, 'da confermare') : null),
        h('td', { 'data-l': 'Scadenza' }, dmy(i.due), i.late ? h('div', null, h('span', { class: 'pill bad' }, 'scaduta')) : null),
        h('td', { class: 'num', 'data-l': 'Importo' }, i.ravv
          ? [h('div', { class: 'small muted' }, `imposta ${money(i.amount)}`), h('div', { class: 'small muted' }, `${i.ravv.magg ? 'maggiorazione' : 'sanzione e interessi'} ${money(i.ravv.sanction.plus(i.ravv.interest))}`), h('strong', null, money(i.payAmount))]
          : h('strong', null, money(i.amount))));
    const rows = GROUPS.flatMap(([g, label]) => {
      const list = p.items.filter((i) => (i.group || 'inv') === g);
      return list.length ? [h('tr', { class: 'grp' }, h('td', { colspan: 4 }, label)), ...list.map(row)] : [];
    });
    return h('div', { class: 'tbl-wrap' }, h('table', { class: 'paytbl' },
      h('thead', null, h('tr', null, h('th', null, 'Cosa paghi'), h('th', null, 'Codice F24'), h('th', null, 'Scadenza'), h('th', { class: 'num' }, 'Importo'))),
      h('tbody', null, rows),
      h('tfoot', null,
        h('tr', { class: 'total' }, h('td', { colspan: 3 }, 'Da pagare adesso'), h('td', { class: 'num' }, money(p.payNow))),
        later.length ? h('tr', null, h('td', { colspan: 3 }, `Più avanti (entro il ${dmy(later[later.length - 1].due)})`), h('td', { class: 'num' }, money(laterSum))) : null)));
  }

  function pagePay(res) {
    const p = payPlan(res), Y = res.year, dl = p.deadlines;
    const later = laterOf(p), laterSum = later.reduce((s, i) => s.plus(i.payAmount), CT.ZERO);
    const cred = p.items.find((i) => i.credit);
    const dateIn = h('input', { type: 'date', id: 'payDay', value: ui.payDay || todayIso(), onchange: (e) => { ui.payDay = e.target.value || null; render(); } });
    return [
      kpis(kpi('Da pagare adesso', money(p.payNow), p.lateExtra.gt(0) ? `di cui ${money(p.lateExtra)} per il ritardo (stima)` : p.payNow.gt(0) ? `entro il ${dmy(dl.saldo)}` : 'nessun versamento', p.payNow.gt(0) ? 'warn' : 'good'),
        laterSum.gt(0) ? kpi('Più avanti', money(laterSum), `entro il ${dmy(later[later.length - 1].due)}`) : null,
        cred ? kpi('A credito', money(cred.creditAmount), 'rimborso o compensazione', 'good') : null),
      draftCallout(res),
      p.items.length ? card('Da versare con l\'F24', `Modello F24, sezione «Erario», anno di riferimento ${Y} (per gli acconti l'anno a cui si riferiscono).`,
        payTable(p),
        h('label', { class: 'field date-field' }, h('span', null, 'Quando pensi di pagare? Cambia la stima di sanzione e interessi'), dateIn),
        p.lateExtra.gt(0) ? callout('warn', `La scadenza del ${dmy(dl.saldo)} è passata`, 'Si paga lo stesso, con il «ravvedimento operoso»: sanzione ridotta (dal 3,125% oltre 90 giorni) più interessi legali. Sanzione e interessi hanno codici tributo propri: li mette il commercialista.') : null)
        : card('Niente da versare', p.hasRW ? `Non ci sono imposte da pagare per il ${Y}. Il quadro RW va comunque compilato, perché nel ${Y} hai avuto investimenti all'estero o nei wallet.` : `Non risultano imposte da pagare per il ${Y}.`),
      p.others && p.others.any ? card('Come è calcolata l\'IRPEF (stima)', null, ...estimateNodes(p.others)) : null,
      card('Scadenze', null, h('ul', { class: 'timeline' },
        h('li', { class: p.payDay > dl.saldo ? 'past' : '' }, h('strong', null, dmy(dl.saldo)), h('span', null, `Saldo delle imposte ${Y} e primo acconto ${Y + 1} (fino al ${dmy(dl.saldoMagg)} con lo 0,40% in più)`)),
        h('li', { class: p.payDay > dl.filing ? 'past' : 'next' }, h('strong', null, dmy(dl.filing)), h('span', null, `Invio del modello Redditi PF ${Y + 1}`)),
        h('li', { class: p.payDay > dl.acconto2 ? 'past' : '' }, h('strong', null, dmy(dl.acconto2)), h('span', null, `Secondo acconto (o acconto unico) ${Y + 1}`)))),
      card('Come si paga', null, h('ul', { class: 'notes' },
        h('li', null, 'Dall\'home banking (sezione F24), alla posta, in banca o con i servizi online dell\'Agenzia delle Entrate.'),
        h('li', null, 'Un rigo per ogni codice tributo nella sezione «Erario», colonna «importi a debito versati».'),
        h('li', null, `Il codice 1715 (cripto) non si può rateizzare. Conserva le ricevute F24 almeno fino al 31/12/${Y + 6}.`))),
    ];
  }

  function todoCard(res) {
    const p = payPlan(res), Y = res.year, dl = p.deadlines, blk = res.groups.blockCount;
    const oc = p.others && p.others.any ? p.others : null;
    const quadri = [oc && oc.altri.gt(0) ? 'RC (stipendio)' : null, oc && (oc.occ.length || oc.dir.length) ? 'RL (musica)' : null,
      oc && (oc.sanTot.gt(0) || oc.altreDetr.gt(0) || oc.ded.gt(0)) ? 'RP (spese)' : null, p.hasRT ? 'RT (cripto e oro)' : null, p.hasRW ? 'RW (investimenti all\'estero)' : null].filter(Boolean);
    const steps = [];
    if (blk) steps.push(h('li', null, h('strong', null, `Sistema ${blk === 1 ? 'il punto' : `i ${blk} punti`} da controllare`), ' negli investimenti: finché ci sono, i numeri sono una bozza.'));
    steps.push(h('li', null, h('strong', null, 'Scarica i documenti'), ' (pagina Documenti) e mandali al commercialista, oppure usali per compilare da solo.'));
    if (quadri.length) steps.push(h('li', null, h('strong', null, `Compila il Redditi PF ${Y + 1} entro il ${dmy(dl.filing)}`), `: quadri ${quadri.join(', ')}. ${p.m730Passed ? `Il 730 scadeva il ${dmy(dl.m730)}.` : ''}`,
      p.filingLate ? h('div', { class: 'small bad-txt' }, `La scadenza è passata: entro 90 giorni si può presentare una dichiarazione tardiva. Chiedi subito al commercialista.`) : null));
    if (p.now.length) steps.push(h('li', null, h('strong', null, `Paga con l'F24${p.now.some((i) => i.late) ? ' appena puoi' : ` entro il ${dmy(dl.saldo)}`}`), `: ${p.now.map((i) => `${money(i.payAmount)} (codice ${i.code})`).join(' + ')}.`));
    for (const i of laterOf(p)) steps.push(h('li', null, h('strong', null, `Entro il ${dmy(i.due)}`), `: ${i.title}, ${money(i.amount)} (codice ${i.code}).`));
    if (res.y.crypto.newLoss.gt(0)) steps.push(h('li', null, h('strong', null, 'Perdite da riportare'), `: la minusvalenza ${Y} di ${money(res.y.crypto.newLoss)} va scritta nel quadro RT per usarla fino al ${Y + 4}.`));
    steps.push(h('li', null, h('strong', null, 'Conserva tutto'), `: export, PDF e ricevute F24 almeno fino al 31/12/${Y + 6}.`));
    return card('Cosa fare adesso, passo per passo', null, h('ol', { class: 'steps' }, steps));
  }

  const GLOSSARY = [
    ['Plusvalenza / minusvalenza', 'Il guadagno (o la perdita) quando vendi una cripto: incasso meno quello che l\'avevi pagata.'],
    ['Imposta sostitutiva', 'La tassa sui guadagni delle cripto: 26% per il 2025 (33% dal 2026), separata dall\'IRPEF.'],
    ['Proventi', 'Interessi, staking, cashback e premi in cripto: tassati sul valore in euro del giorno in cui li ricevi.'],
    ['Scambio tra cripto', 'Cambiare una cripto con un\'altra (es. BTC → ETH) non è una vendita. Lo è passare a euro, a stablecoin (USDC, USDT…) o pagare con le cripto.'],
    ['LIFO', 'Quando vendi, si considera venduto per primo l\'ultimo acquisto fatto: è il metodo indicato dall\'Agenzia.'],
    ['Quadro RT', 'Dove si scrivono guadagni e perdite: sezione V-A per le cripto, sezione II per l\'oro.'],
    ['Quadro RW', 'Dove si comunica cosa avevi all\'estero o nei wallet. Si compila anche se non hai guadagnato niente.'],
    ['IVCA (IC nel quadro RW)', 'Imposta sul valore delle cripto: 0,2% all\'anno del loro valore. Codice F24 1727.'],
    ['CU (Certificazione Unica)', 'Il riepilogo annuale di chi ti paga con ritenuta (datore di lavoro, SIAE, locali): redditi e tasse già trattenute.'],
    ['Prestazione occasionale', 'Un lavoro saltuario senza partita IVA (es. una serata da DJ): quadro RL, rigo RL15.'],
    ['Diritti d\'autore', 'Quello che incassi come autore di brani: si paga sul 75% (60% sotto i 35 anni). Quadro RL, rigo RL25.'],
    ['Ritenuta d\'acconto', 'La parte (di solito il 20%) che chi ti paga versa al fisco per te: in dichiarazione si toglie dalle tasse.'],
    ['Detrazione / deduzione', 'La detrazione si toglie dalle tasse (es. 19% delle spese mediche); la deduzione si toglie dal reddito.'],
    ['F24', 'Il modulo per pagare le tasse (home banking, Poste, banca). Ogni imposta ha il suo codice tributo.'],
    ['Ravvedimento operoso', 'Pagare in ritardo spontaneamente con una sanzione ridotta e gli interessi.'],
    ['Acconto', 'Un anticipo sulle tasse dell\'anno dopo, calcolato su quelle dell\'anno prima.'],
  ];
  function glossaryCard() {
    return h('details', { class: 'card' }, h('summary', null, 'Parole difficili, spiegate in breve'),
      h('dl', { class: 'gloss' }, GLOSSARY.map(([t, d]) => [h('dt', null, t), h('dd', null, d)])));
  }

  // ------------------------------------------------------------------ panoramica
  /** Stato di ogni sezione: done (fatta), skip (non ne ho), todo, warn (punti aperti), na (non serve). */
  function sectionStatus(res) {
    const o = othersState(), c = CT.others.compute(o);
    const has = state.files.length + state.manual.length > 0;
    return {
      lavoro: c.altri.gt(0) ? 'done' : o.skip.lavoro ? 'skip' : 'todo',
      musica: c.occ.length + c.dir.length ? 'done' : o.skip.musica ? 'skip' : 'todo',
      spese: c.sanTot.gt(0) || c.altreDetr.gt(0) || c.ded.gt(0) ? 'done' : o.skip.spese ? 'skip' : 'todo',
      irpef: c.any ? 'done' : 'na',
      files: has ? 'done' : 'todo',
      checks: !has ? 'na' : res && res.groups.blockCount ? 'warn' : 'done',
      invest: has ? 'done' : 'na',
      export: ui.bundleDone || ui.pdfDone || ui.fxDone ? 'done' : 'todo',
    };
  }

  function pageOverview(res) {
    const p = payPlan(res), Y = res.year, dl = p.deadlines, st = sectionStatus(res);
    const c = p.others || CT.others.compute(othersState());
    const later = laterOf(p), laterSum = later.reduce((s, i) => s.plus(i.payAmount), CT.ZERO);
    const cred = p.items.find((i) => i.credit);
    const invTax = p.items.filter((i) => i.group === 'inv' && !i.advance).reduce((s, i) => s.plus(i.amount), CT.ZERO);
    const has = state.files.length + state.manual.length > 0;
    const STEPS = [
      ['lavoro', 'Lavoro dipendente', c.altri.gt(0) ? money(c.altri) : null],
      ['musica', 'Musica (DJ e SIAE)', c.occ.length + c.dir.length ? money(c.occLordo.plus(c.dirLordo)) + ' lordi' : null],
      ['spese', 'Spese e detrazioni', c.sanTot.gt(0) || c.altreDetr.gt(0) || c.ded.gt(0) ? money(c.sanTot.plus(c.altreDetr).plus(c.ded)) : null],
      ['files', 'Investimenti caricati', has ? `${state.files.length} ${state.files.length === 1 ? 'file' : 'file'}` : null],
      ['checks', 'Controlli sugli investimenti', res.groups.blockCount ? `${res.groups.blockCount} da sistemare` : null],
      ['export', 'Documenti scaricati', null],
    ];
    const LABEL = { done: 'fatto', skip: 'non serve', todo: 'da fare', warn: 'da sistemare', na: 'non serve' };
    const next = STEPS.find(([k]) => st[k] === 'todo' || st[k] === 'warn');
    return [
      kpis(
        kpi('Da pagare adesso', money(p.payNow), p.lateExtra.gt(0) ? `compresi ${money(p.lateExtra)} per il ritardo (stima)` : p.payNow.gt(0) ? `entro il ${dmy(dl.saldo)}` : 'nessun versamento', p.payNow.gt(0) ? 'warn' : 'good'),
        cred ? kpi('IRPEF a credito', money(cred.creditAmount), 'ti viene restituita', 'good') : null,
        laterSum.gt(0) ? kpi('Più avanti', money(laterSum), `acconti entro il ${dmy(later[later.length - 1].due)}`) : null,
        kpi('Invio della dichiarazione', dmy(dl.filing), `modello Redditi PF ${Y + 1}`, p.filingLate ? 'bad' : null)),
      next ? callout(st[next[0]] === 'warn' ? 'warn' : 'info', `Prossimo passo: ${next[1]}`, st[next[0]] === 'warn' ? `Ci sono ${res.groups.blockCount} punti da sistemare negli investimenti: finché ci sono, i numeri sono una bozza.` : 'Completa questa sezione per avere il calcolo completo.', linkBtn('Vai', next[0], null, true))
        : callout('good', 'Tutto pronto', 'Hai completato tutte le sezioni. Scarica i documenti e falli vedere al commercialista prima di inviare.', linkBtn('Vai ai documenti', 'export', null, true)),
      h('div', { class: 'tiles' },
        h('section', { class: 'card tile' }, h('div', { class: 'tile-head' }, h('h2', null, 'Redditi'), statusPill(['lavoro', 'musica', 'spese'].map((k) => st[k]))),
          kvTable([
            { label: 'Stipendio o pensione', value: c.altri.gt(0) ? money(c.altri) : '—' },
            { label: 'Musica (netto)', value: c.extra.gt(0) ? money(c.extra) : '—' },
            { label: 'Detrazioni per spese', value: c.det19.gt(0) ? money(c.det19) : '—' },
            { label: c.irpefCredit.gt(0) ? 'IRPEF a credito (stima)' : 'IRPEF da versare (stima)', value: money(c.irpefCredit.gt(0) ? c.irpefCredit : c.irpefDue), cls: 'total' },
            c.addiz.gt(0) ? { label: 'Addizionali da versare (stima)', value: money(c.addiz) } : null,
          ].filter(Boolean)), linkBtn('Vedi il calcolo', 'irpef')),
        h('section', { class: 'card tile' }, h('div', { class: 'tile-head' }, h('h2', null, 'Investimenti'), statusPill([st.files, st.checks])),
          has ? kvTable([
            { label: 'Imposta su cripto (26%)', value: money(res.y.crypto.tax) },
            { label: 'Imposta su oro e metalli', value: money(res.y.metals.tax) },
            { label: 'Imposta sul valore (IVCA)', value: money(p.ivca) },
            { label: 'Totale investimenti', value: money(invTax), cls: 'total' },
          ]) : h('p', { class: 'muted' }, 'Nessuna piattaforma caricata. Se non hai cripto, oro o altri investimenti all\'estero puoi saltare questa parte.'),
          linkBtn(has ? 'Vedi il calcolo' : 'Carica i file', has ? 'invest' : 'files')),
        h('section', { class: 'card tile' }, h('div', { class: 'tile-head' }, h('h2', null, 'Pagamenti e documenti'), statusPill([st.export])),
          kvTable([
            { label: 'Da pagare adesso', value: money(p.payNow) },
            { label: 'Più avanti', value: laterSum.gt(0) ? money(laterSum) : '—' },
            { label: 'Stato dei documenti', value: res.groups.blockCount ? 'bozza' : 'pronti' },
          ]), linkBtn('Cosa pagare', 'pay'))),
      card('Avanzamento', null, h('ol', { class: 'progress' }, STEPS.map(([k, label, val]) => h('li', { class: `st-${st[k]}` },
        h('span', { class: 'dot', 'aria-hidden': 'true' }, st[k] === 'done' || st[k] === 'skip' || st[k] === 'na' ? '✓' : st[k] === 'warn' ? '!' : ''),
        h('button', { class: 'linkish', onclick: () => go(k) }, label), h('span', { class: 'muted small' }, val ? `${val} · ${LABEL[st[k]]}` : LABEL[st[k]]))))),
    ];
  }
  function statusPill(list) {
    if (list.includes('warn')) return h('span', { class: 'pill warn' }, 'da sistemare');
    if (list.includes('todo')) return h('span', { class: 'pill idle' }, 'da completare');
    return h('span', { class: 'pill good' }, 'completo');
  }

  // ------------------------------------------------------------------ investimenti: calcolo delle imposte
  const INV_TABS = [['summary', 'Riepilogo'], ['rt', 'Quadro RT'], ['rw', 'Quadro RW'], ['ops', 'Operazioni'], ['other', 'Azioni, ETF e conti'], ['years', 'Anni'], ['method', 'Metodo']];
  function pageInvest(res) {
    const has = state.files.length + state.manual.length > 0;
    if (!has) return [emptyState('Nessun investimento caricato', 'Carica i file delle piattaforme (Crypto.com, Bitpanda, Binance…) per calcolare le imposte su cripto e oro. Se non hai investimenti all\'estero puoi saltare questa parte.', 'Carica i file', 'files'), otherInvestmentsCard(res)];
    const y = res.y, p = payPlan(res);
    const t = ui.investTab || 'summary';
    const seg = h('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Dettagli degli investimenti' },
      INV_TABS.map(([k, label]) => h('button', { role: 'tab', 'aria-selected': t === k ? 'true' : 'false', onclick: () => { ui.investTab = k; render(); } }, label)));
    let body;
    if (t === 'summary') body = sourcesCard(res) || card('Niente di tassabile', `Nel ${res.year} non risultano vendite, scambi tassabili o premi.`);
    else if (t === 'rt') body = h('div', { class: 'grid2' }, basketCard(y.crypto), basketCard(y.metals));
    else if (t === 'rw') body = rwCard(res);
    else if (t === 'ops') body = opsCard(res);
    else if (t === 'other') body = otherInvestmentsCard(res);
    else if (t === 'years') body = yearsCard(res);
    else body = methodCard(res);
    return [
      kpis(kpi('Imposta su cripto', money(y.crypto.tax), `${(y.crypto.rate.times(100)).toFixed(0)}% · quadro RT sez. V-A`), kpi('Imposta su oro', money(y.metals.tax), '26% · quadro RT sez. II'),
        kpi('Imposta sul valore (IVCA)', money(p.ivca), '0,2% · quadro RW'), kpi('Guadagno netto cripto', money(y.crypto.net.plus(y.crypto.income)), 'plus/minusvalenze e premi')),
      draftCallout(res),
      seg, body,
    ];
  }
  function rwCard(res) {
    const rwTotal = res.rw.reduce((s, r) => s.plus(r.ivca), CT.ZERO);
    return card('Monitoraggio (quadro RW) e imposta sul valore', 'Cripto e oro custoditi presso piattaforme estere o wallet personali: valore a inizio e fine anno, giorni di detenzione e imposta sul valore (0,2%).',
      res.rw.length ? h('div', { class: 'tbl-wrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', null, 'Dove'), h('th', null, 'Asset'), h('th', { class: 'num' }, 'Giorni'), h('th', { class: 'num' }, 'Valore iniziale'), h('th', { class: 'num' }, 'Valore finale'), h('th', { class: 'num' }, 'IVCA 0,2%'))),
        h('tbody', null, res.rw.map((r) => h('tr', null, h('td', null, r.account), h('td', null, r.asset), h('td', { class: 'num' }, r.days), h('td', { class: 'num' }, money(r.valueInitial), r.estimated ? h('div', { class: 'small muted' }, 'stimato') : null), h('td', { class: 'num' }, money(r.valueFinal), r.estimated ? h('div', { class: 'small muted' }, 'stimato') : null), h('td', { class: 'num' }, r.cls === 'metal' ? '—' : money(r.ivca))))),
        h('tfoot', null, h('tr', { class: 'total' }, h('td', { colspan: 5 }, 'IVCA totale'), h('td', { class: 'num' }, money(rwTotal)))))) : h('p', { class: 'muted' }, 'Nessuna cripto o oro detenuti in questo anno.'),
      h('p', { class: 'small muted' }, 'I valori a inizio e fine anno usano i prezzi del 1° gennaio e del 31 dicembre, scaricati con la fonte indicata o scritti da te (per esempio dall\'estratto conto della piattaforma). Il modulo del quadro RW già compilato si scarica dalla pagina Documenti.'),
      h('div', { class: 'row' }, linkBtn('Prezzi usati e fonti', 'prices')));
  }
  function yearsCard(res) {
    const yrs = Object.values(res.years).sort((a, b) => b.year - a.year);
    return card('Anni a confronto', 'Gli anni precedenti al 2023 seguivano regole diverse e non sono inclusi.', h('div', { class: 'tbl-wrap' }, h('table', null,
      h('thead', null, h('tr', null, h('th', null, 'Anno'), h('th', { class: 'num' }, 'Saldo cripto'), h('th', { class: 'num' }, 'Saldo oro'), h('th', { class: 'num' }, 'Imposta'))),
      h('tbody', null, yrs.map((r) => h('tr', null, h('td', null, r.year), h('td', { class: 'num' }, money(r.crypto.net.plus(r.crypto.income))), h('td', { class: 'num' }, money(r.metals.net)), h('td', { class: 'num' }, money(r.totalTax))))))));
  }
  function methodCard(res) {
    return card('Come si calcola', null, h('ul', { class: 'notes' },
      h('li', null, 'Costo di acquisto con il metodo LIFO (si vendono prima gli ultimi acquistati), un unico conto per ogni asset su tutte le piattaforme.'),
      state.settings.swapRule === 'all'
        ? h('li', null, 'Hai scelto di tassare anche gli scambi tra cripto: ogni scambio, il passaggio a stablecoin e i pagamenti sono vendite imponibili.')
        : h('li', null, 'Lo scambio tra due cripto (es. BTC → ETH) non è una vendita: il costo passa alla cripto ricevuta (Circolare 30/E del 2023). Sono vendite il passaggio a euro, a stablecoin, i pagamenti e le commissioni pagate in cripto.'),
      h('li', null, 'Staking, interessi e premi sono tassati per intero al valore del giorno in cui li ricevi. Un cashback stornato riduce i premi.'),
      h('li', null, 'Le perdite sulle cripto compensano solo guadagni su cripto; l\'oro ha un conteggio separato. Riporto per 4 anni (2023-2024: solo perdite nette oltre 2.000 €).'),
      h('li', null, 'Date secondo l\'ora italiana. Importi dei quadri arrotondati all\'euro.'),
      h('li', null, `Regole ${res.year}: ${res.y.rule.note}`)),
      h('div', { class: 'row' }, linkBtn('Cambia le opzioni di calcolo', 'settings')));
  }

  /** Investimenti che il programma non calcola (azioni, ETF, conti): cosa c'e' nei file e dove si dichiara. */
  function otherInvestmentsCard(res) {
    const oos = [...new Set(res.groups.outOfScope.map((i) => i.data && i.data.asset).filter(Boolean))];
    return card('Azioni, ETF, conti e altri broker', null,
      oos.length ? callout('warn', `Nei tuoi file ci sono anche: ${oos.slice(0, 12).join(', ')}${oos.length > 12 ? '…' : ''}`, 'Sono azioni, ETF o valute: il programma non li calcola. Vanno dichiarati come spiegato qui sotto.')
        : h('p', { class: 'muted' }, 'Cripto e oro sono calcolati dal programma. Se hai anche azioni, ETF o conti presso broker o banche estere (Bitpanda Stocks, Trade Republic, Degiro, Revolut, Interactive Brokers…), ecco dove si dichiarano.'),
      h('ul', { class: 'notes' },
        h('li', null, h('strong', null, 'Broker italiano in regime amministrato'), ' (Fineco, Directa, banche italiane): non dichiari niente, paga la banca.'),
        h('li', null, h('strong', null, 'Azioni, obbligazioni, certificati presso broker esteri'), ': quadro RT, sezione II (26%, codice F24 1100); perdite riportabili per 4 anni, non compensano le cripto.'),
        h('li', null, h('strong', null, 'ETF e fondi esteri'), ': il guadagno è reddito di capitale (quadro RM, 26%); la perdita va nel quadro RT.'),
        h('li', null, h('strong', null, 'Dividendi e interessi esteri'), ': quadro RM (26%); per le ritenute estere chiedi al commercialista.'),
        h('li', null, h('strong', null, 'Monitoraggio'), ': conti e titoli all\'estero nel quadro RW, con IVAFE dello 0,2% sui titoli e 34,20 € per conto con giacenza media sopra 5.000 €. L\'oro fisico (es. Bitpanda Metals) va nel quadro RW senza IVAFE.'),
        h('li', null, h('strong', null, 'Bitpanda'), ': cripto e metalli li legge questo programma; per Bitpanda Stocks (in passato contratti derivati) fai confermare il trattamento al commercialista.')));
  }

  // ------------------------------------------------------------------ guida alla compilazione: tutti i numeri, quadro per quadro
  function quadroCard(code, title, intro, rows) {
    return h('section', { class: 'card quadro' }, h('div', { class: 'quadro-head' }, h('span', { class: 'qbadge' }, code), h('div', null, h('h2', null, title), intro ? h('p', { class: 'muted small' }, intro) : null)),
      rows.length ? whereTable(rows) : h('p', { class: 'muted small' }, 'Niente da indicare.'));
  }
  function basketRows(b) {
    const r = [['', 'Corrispettivi delle cessioni (al netto delle commissioni)', b.proceeds], ['', 'Costo o valore di acquisto', b.costs], ['', 'Plusvalenze', b.gains], ['', 'Minusvalenze', b.losses]];
    if (b.income.gt(0)) r.push(['', 'Proventi (staking, interessi, premi)', b.income]);
    for (const cu of b.carryUsed) r.push(['', `Minusvalenza ${cu.year} utilizzata`, cu.amount]);
    r.push(['', 'Imponibile', b.taxable], ['', `Imposta sostitutiva ${(b.rate.times(100)).toFixed(0)}%`, b.tax]);
    if (b.newLoss.gt(0)) r.push(['', `Minusvalenza ${b.year} da riportare`, b.newLoss]);
    return r;
  }
  function pageGuide(res) {
    const p = payPlan(res), Y = res.year, c = p.others || CT.others.compute(othersState());
    const where = CT.others.where(c);
    const has = state.files.length + state.manual.length > 0;
    const fx = has && CT.facsimile ? CT.facsimile.build(res, state) : null;
    const rwRows = [];
    if (fx && fx.available) {
      fx.rows.forEach((r, i) => rwRows.push([`RW${(i % 5) + 1}${fx.rows.length > 5 ? ` (mod. ${Math.floor(i / 5) + 1})` : ''}`,
        `${r.account} · ${r.cls === 'crypto' ? 'codice 21 cripto' : 'oro: codice da verificare'} · titolo 1 · quota 100 · criterio 1 · ${r.days} giorni`,
        r.incomplete ? 'da completare' : `${money(CT.roundEuro(r.vi))} → ${money(CT.roundEuro(r.vf))}${r.cls === 'crypto' ? ` · IC ${money(r.icDue)}` : ''}`]));
      rwRows.push(['RW8', 'Imposta cripto-attività: totale (col. 1) · acconti versati (col. 4)', `${money(p.ivca)} · ${p.ivcaAdvance === null ? 'acconti da indicare' : money(p.ivcaAdvance)}`]);
    } else if (has) for (const r of res.rw) rwRows.push(['RW', `${r.account} · ${r.asset} · ${r.days} giorni`, `${money(r.valueInitial)} → ${money(r.valueFinal)}`]);
    return [
      callout('info', 'Come usare questa pagina', `Qui c'è ogni numero da scrivere nel modello Redditi PF ${Y + 1}, nell'ordine dei quadri. Apri la dichiarazione precompilata (o mandala al commercialista) e copia riga per riga.`),
      quadroCard('RC', 'Redditi di lavoro dipendente', 'Nella precompilata ci sono già dalla Certificazione Unica.', where.filter(([r]) => /^RC/.test(r))),
      quadroCard('RL', 'Altri redditi: lavoro occasionale e diritti d\'autore', 'Serate da DJ al rigo RL15, diritti d\'autore al rigo RL25.', where.filter(([r]) => WHERE.musica.test(r))),
      quadroCard('RP', 'Oneri e spese', 'Spese sanitarie al rigo RP1; altre detrazioni e oneri deducibili nelle sezioni del quadro.', where.filter(([r]) => WHERE.spese.test(r))),
      where.some(([r]) => WHERE.addiz.test(r)) ? quadroCard('RV', 'Addizionali regionale e comunale', 'Nella precompilata quelle trattenute in busta paga ci sono già dalla CU; il dovuto lo calcola il software.', where.filter(([r]) => WHERE.addiz.test(r))) : null,
      has ? quadroCard('RT', 'Cripto-attività · sezione V-A', 'Plusvalenze e proventi da cripto. Imposta con codice F24 1715. I numeri dei righi sono nelle istruzioni del modello.', basketRows(res.y.crypto)) : null,
      has && (res.y.metals.nDisposals || res.y.metals.income.gt(0)) ? quadroCard('RT', 'Oro e metalli preziosi · sezione II', 'Imposta con codice F24 1100 (da confermare).', basketRows(res.y.metals)) : null,
      has ? quadroCard('RW', 'Investimenti all\'estero e imposta sul valore', 'Una riga per piattaforma. Il modulo già compilato è nella pagina Documenti.', rwRows) : null,
      quadroCard('RN · RV · F24', 'Calcolo finale e versamenti', 'IRPEF e addizionali le calcola il software della dichiarazione; qui la stima e i codici F24.',
        p.items.map((i) => [i.credit ? '—' : i.code, i.title, i.credit ? `credito ${money(i.creditAmount)}` : money(i.payAmount)])),
      precompilataTip(),
      todoCard(res),
      glossaryCard(),
    ];
  }

  // ------------------------------------------------------------------ pannello: Dettaglio
  function dataTable(head, rows, numCols) {
    return h('div', { class: 'tbl-wrap' }, h('table', null,
      h('thead', null, h('tr', null, head.map((x, i) => h('th', { class: numCols.includes(i) ? 'num' : null }, x)))),
      h('tbody', null, rows.length ? rows : h('tr', null, h('td', { colspan: head.length, class: 'muted' }, 'Nessuna riga.')))));
  }
  function opsCard(res) {
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
    return h('section', { class: 'card' }, h('h2', null, 'Operazioni dell\'anno'), h('div', { class: 'row between' }, bar, filter), body);
  }

  // ------------------------------------------------------------------ pannello: Prezzi
  const insideClaude = () => !!(typeof window !== 'undefined' && window.claude && window.claude.use);
  /** Prezzo in euro alla chiusura del giorno: prova piu' servizi pubblici (vedi pricefeed.js). Un valore non credibile si scarta. */
  /** Asset custoditi su Bitpanda: per quelli il prezzo si prende prima dal listino Bitpanda, cosi' coincide con l'estratto conto. */
  const onBitpanda = (sym) => !!(ui.res && ui.res.rw.some((r) => r.asset === sym && /bitpanda/i.test(r.account)));
  async function fetchPrice(sym, day) {
    const r = await CT.pricefeed.fetchEur(sym, day, { prefer: onBitpanda(sym) ? 'bitpanda' : undefined });
    const n = Number(r.price);
    if (!Number.isFinite(n) || n <= 0) { const e = new Error('prezzo non valido'); e.details = [`${r.source}: prezzo non valido`]; throw e; }
    // due fonti molto diverse: meglio non usare nessuna delle due senza un controllo
    if (r.check && r.check.diffPct > 25) { const e = new Error('fonti in disaccordo'); e.details = [`${sym}: ${r.source} dà ${n} €, ${r.check.source} ${r.check.price} € (differenza ${r.check.diffPct}%): scrivi il prezzo dell'estratto conto`]; throw e; }
    const near = ui.res && ui.res.engine.prices.nearest(sym, day);
    if (near) {
      const ref = Number(near.price.toString());
      if (!CT.pricefeed.plausible(n, ref, near.daysApart)) { const e = new Error('prezzo non credibile'); e.details = [`${r.source}: ${sym} a ${n} € non è credibile (nei tuoi file, ${near.daysApart} giorni prima o dopo, valeva circa ${ref.toPrecision(3)} €)`]; throw e; }
    }
    return r;
  }
  /** Perche' serve ogni prezzo mancante: 'rw' (quadro RW), 'rebase' (rideterminazione) o 'op' (valorizzare un'operazione). */
  function priceReasons(res) {
    const why = new Map();
    for (const i of res.engine.issues) {
      if ((i.code !== 'missing_price' && i.code !== 'missing_value' && i.code !== 'rw_estimated') || !i.data) continue;
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
        try { const r = await fetchPrice(n.symbol, n.day); if (!state.prices[k]) { state.prices[k] = r.price; (state.priceSrc = state.priceSrc || {})[k] = CT.pricefeed.describe(r); } ok++; }
        catch (e) { ko++; for (const d of e.details || [e.message]) why.set(`${d.split(':')[0]}|${n.symbol}`, d); }
      }));
    }
    ui.busy = ''; ui.priceFail = ko; ui.priceWhy = [...why.values()].slice(0, 6); changed();
    if (!quiet || ok) toast(`${ok} ${ok === 1 ? 'prezzo scaricato' : 'prezzi scaricati'}${ko ? `, ${ko} da inserire a mano` : ''}`);
  }
  /** Appena mancano dei prezzi li chiede da solo, una volta sola per ciascuno: l'utente non deve fare niente. */
  function maybeAutoPrices() {
    const res = ui.res;
    if (!res || ui.busy || typeof fetch !== 'function') return;
    const todo = [...res.engine.missingPrices.values()].filter((n) => !state.prices[`${n.symbol}|${n.day}`] && !priceTried.has(`${n.symbol}|${n.day}`));
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
      for (const [k, input] of inputs) { const v = input.value.trim().replace(',', '.'); if (v && !Number.isNaN(Number(v)) && Number(v) > 0) { state.prices[k] = v; if (state.priceSrc) delete state.priceSrc[k]; n++; } }
      if (!n) { toast('Scrivi almeno un prezzo valido'); return; }
      changed(); toast(`${n} prezzi salvati`);
    };
    const auto = () => autoPrices(false);
    const have = Object.entries(state.prices);
    return h('div', { class: 'stack' },
      h('div', null, h('button', { class: 'btn quiet', onclick: () => { go('checks'); } }, '← Torna ai controlli')),
      h('div', { class: 'card' }, h('h2', null, need.length ? `Prezzi mancanti (${need.length})` : 'Nessun prezzo mancante'),
        need.length ? h('div', { class: 'stack', style: 'padding:0;gap:8px' },
          h('p', null, 'Per calcolare le tasse sulle vendite il programma usa gli importi in euro scritti nei tuoi file. Qui mancano invece alcuni prezzi in euro di una cripto in un certo giorno.'),
          h('p', { class: 'muted' }, nRW ? `${nRW} ${nRW === 1 ? 'serve' : 'servono'} al prospetto RW (il quadro del monitoraggio, e di conseguenza all'imposta sul valore delle cripto): il valore in euro che le cripto che possiedi avevano il 1° gennaio e il 31 dicembre. ` : '', nRebase ? `${nRebase} ${nRebase === 1 ? 'serve' : 'servono'} alla rideterminazione del costo al 1° gennaio 2025. ` : '', nOp ? `${nOp} ${nOp === 1 ? 'serve' : 'servono'} a valorizzare singole operazioni. ` : '', 'Sotto ogni asset trovi a cosa serve quel prezzo.'),
          h('p', { class: 'muted' }, 'Il programma li scarica da solo appena apri la pagina pubblicata (su Vercel passa dal proprio server, così le borse non bloccano la richiesta). Ogni prezzo arriva con la fonte e, quando possibile, con il confronto con una seconda fonte: li trovi qui sotto e nel PDF, così il commercialista può verificarli. Solo se un prezzo non arriva da nessuna fonte scrivilo a mano (euro per 1 unità alla chiusura del giorno; per oro e metalli euro per 1 grammo).')) : h('p', { class: 'muted' }, 'Il programma usa già i prezzi che ricava dalle tue operazioni dello stesso giorno.'),
        need.length ? [h('div', { class: 'row' },
            h('button', { class: 'btn primary', disabled: !!ui.busy, onclick: auto }, ui.busy || 'Scarica i prezzi in automatico'),
            h('button', { class: 'btn', onclick: saveAll }, 'Salva i prezzi scritti a mano'),
            h('span', { class: 'muted small' }, 'Il download invia solo simbolo e data, nessun dato personale.')),
          ui.priceFail ? h('p', { class: 'small muted' }, `Non arrivati: ${ui.priceFail}. ${(ui.priceWhy || []).join(' · ')}`) : null,
          h('div', { class: 'tbl-wrap' }, h('table', null, h('thead', null, h('tr', null, ['Asset', 'Data', 'Suggerimento', 'Prezzo in €'].map((x) => h('th', null, x)))), h('tbody', null, rows)))] : null),
      have.length ? h('div', { class: 'card' }, h('h3', null, `Prezzi usati (${have.length})`),
        h('p', { class: 'muted small' }, 'Per ogni prezzo scaricato c\'è la fonte esatta (borsa, coppia, giorno) e il confronto con una seconda fonte: chiunque può ricontrollarlo. Se una riga dice ATTENZIONE le due fonti non coincidono: verifica o correggi.'),
        h('p', { class: 'muted small' }, 'Hai l\'estratto conto della piattaforma al 31/12 (per esempio Bitpanda: colonna «Prezzo»)? Per il quadro RW è il documento migliore: scrivi quel prezzo nella casella e il programma usa il tuo.'),
        h('div', { class: 'tbl-wrap' }, h('table', null, h('thead', null, h('tr', null, ['Asset', 'Data', 'Prezzo €', 'Fonte', ''].map((x) => h('th', null, x)))),
          h('tbody', null, have.map(([k, v]) => { const [s, d] = k.split('|'); const src = (state.priceSrc || {})[k]; return h('tr', null, h('td', null, h('strong', null, s), CT.pricefeed.kindOf(s) === 'metal' ? h('div', { class: 'muted small' }, 'per grammo') : null), h('td', null, dmy(d)), h('td', null, h('input', { type: 'text', inputmode: 'decimal', class: 'num-in', style: 'width:120px', 'aria-label': `Prezzo ${s} ${dmy(d)}`, value: String(v).replace('.', ','),
              onchange: (e) => { const t = e.target.value.trim().replace(/\s/g, '').replace(',', '.'); if (!(Number(t) > 0)) { toast('Scrivi un prezzo valido'); return; } if (t === String(v)) return; state.prices[k] = t; if (state.priceSrc) delete state.priceSrc[k]; changed(); toast('Prezzo salvato: ora vale il tuo'); } })),
            h('td', { class: 'small' }, src ? h('span', { class: /ATTENZIONE/.test(src) ? 'warn-text' : 'muted' }, src) : h('span', { class: 'muted' }, 'scritto a mano')),
            h('td', null, h('button', { class: 'btn quiet danger', onclick: () => { delete state.prices[k]; if (state.priceSrc) delete state.priceSrc[k]; changed(); } }, 'Elimina'))); }))))) : null);
  }

  // ------------------------------------------------------------------ versione per il computer
  /** Ricostruisce dalla pagina aperta un file .html autonomo (stesso codice), da usare fuori da claude.ai. */
  function standaloneHtml() {
    const style = document.querySelector('style[data-app]');
    const scripts = [...document.querySelectorAll('script[data-app]')];
    if (!style || !scripts.length) return null;
    return `<!doctype html>\n<html lang="it">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<meta name="robots" content="noindex">\n<title>Dichiarazione Redditi</title>\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap">\n<style>\n${style.textContent}\n</style>\n</head>\n<body>\n<div id="app"></div>\n${scripts.map((x) => `<script>\n${x.textContent}\n</script>`).join('\n')}\n</body>\n</html>\n`;
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
    if (f) { await saveFile(f.name, f.data, which === 'zip' ? 'application/zip' : 'application/pdf'); ui.pdfDone = f.name; render(); }
  }
  /** Campi facoltativi usati sia nei moduli fac-simile sia nei PDF con i calcoli: codice fiscale e societa' che custodisce le cripto. */
  function taxpayerFields(res, onChange) {
    const tp = state.taxpayer = state.taxpayer || { name: '', cf: '' };
    state.custodians = state.custodians || {};
    const touch = () => { ui.ver++; ui.pdf = null; save(); };
    const name = field('Cognome e nome', { id: 'tp_name', value: tp.name, placeholder: 'es. Rossi Mario', oninput: (e) => { tp.name = e.target.value; touch(); } });
    const cf = field('Codice fiscale', { id: 'tp_cf', value: tp.cf, maxlength: '16', placeholder: 'es. RSSMRA80A01H501U', oninput: (e) => { e.target.value = e.target.value.toUpperCase(); tp.cf = e.target.value; touch(); }, onchange: () => { if (onChange) onChange(); } });
    const accounts = [...new Set(res.rw.map((r) => r.account))];
    const cust = accounts.map((a) => {
      const c = state.custodians[a] = state.custodians[a] || { name: '', country: '' };
      const n = field(`${a}: società che custodisce i fondi`, { id: `cu_n_${a}`, value: c.name, placeholder: 'dai termini e condizioni della piattaforma', oninput: (e) => { c.name = e.target.value; touch(); }, onchange: () => { if (onChange) onChange(); } });
      const k = field('Stato', { id: `cu_s_${a}`, value: c.country, placeholder: 'es. Malta', oninput: (e) => { c.country = e.target.value; touch(); }, onchange: () => { if (onChange) onChange(); } });
      return h('div', { class: 'fields' }, n.el, k.el);
    });
    const adv = field('Acconti IVCA già versati (€): 0 se nessuno', { id: 'tp_adv', value: tp.advance || '', inputmode: 'decimal', placeholder: 'es. 0', oninput: (e) => { tp.advance = e.target.value; touch(); }, onchange: () => { if (onChange) onChange(); } });
    return { name, cf, adv, accounts, cust };
  }

  // ------------------------------------------------------------------ tutto per il commercialista, in un unico .zip
  async function downloadBundle(res) {
    const out = await makePdfs();
    if (!out) return;
    try {
      ui.bundleBusy = true; render();
      const Y = res.year, enc = (t) => new TextEncoder().encode(t);
      const fx = CT.facsimile.build(res, state);
      const files = [{ name: `${Y}-00-LEGGIMI-cosa-pagare-e-cosa-dichiarare.txt`, data: enc(R.handoffText(res, state, payPlan(res), fx.available ? fx.rows : null)) },
        { name: out.full.name, data: out.full.data }];
      if (fx.available) {
        files.push({ name: `${Y}-Quadro-RW-facsimile.pdf`, data: new Uint8Array(CT.facsimile.toPdf(fx.rw, 'Quadro RW · Redditi PF 2026')) });
        files.push({ name: `${Y}-Quadro-W-facsimile-solo-per-730.pdf`, data: new Uint8Array(CT.facsimile.toPdf(fx.w, 'Quadro W · Modello 730/2026')) });
      }
      for (const [n, head, rows] of [['cessioni', R.DISPOSAL_HEAD, R.disposalsRows(res)], ['lotti', R.LOTS_HEAD, R.lotsRows(res)], ['proventi', R.INCOME_HEAD, R.incomesRows(res)], ['rw', R.RW_HEAD, R.rwRows(res)], ['saldi-31-12', R.BAL_HEAD, R.balancesRows(res)]]) {
        files.push({ name: `tabelle-excel/${Y}-${n}.csv`, data: enc(R.csv(head, rows)) });
      }
      const used = new Set();
      for (const f of state.files) {
        let name = String(f.name || 'file').replace(/[\\/:*?"<>|]/g, '_');
        if (String(f.type).startsWith('api_')) name = name.replace(/\.json$/i, '') + '.json';
        while (used.has(name)) name = '1-' + name;
        used.add(name);
        files.push({ name: `export-originali/${name}`, data: enc(f.text) });
      }
      const zip = CT.zipStore(files);
      await saveFile(`${Y}-dichiarazione-per-il-commercialista.zip`, zip, 'application/zip');
      ui.bundleDone = true;
    } catch (e) { console.error(e); toast('Non riesco a preparare il file: ' + e.message); }
    finally { ui.bundleBusy = false; render(); }
  }
  function bundleCard(res) {
    const blk = res.groups.blockCount, busy = ui.bundleBusy || ui.pdfBusy;
    return h('section', { class: 'card feature' },
      h('h2', null, 'Tutto per il commercialista, in un solo file'),
      h('p', { class: 'muted' }, 'Un file .zip da mandare per email o WhatsApp. Contiene:'),
      h('ul', { class: 'notes' },
        h('li', null, h('strong', null, 'LEGGIMI'), ': cosa pagare (codici F24, scadenze, ravvedimento) e i numeri da scrivere in ogni quadro'),
        h('li', null, h('strong', null, 'PDF con tutti i calcoli'), ': vendite, costi, premi, saldi, redditi, fonti e scelte fatte'),
        h('li', null, h('strong', null, 'Modulo del quadro RW'), ' già compilato, con in rosso i campi da completare'),
        h('li', null, h('strong', null, 'Tabelle per Excel'), ' e i file originali delle piattaforme')),
      blk ? callout('warn', `Ci sono ancora ${blk} ${blk === 1 ? 'punto' : 'punti'} da controllare`, 'Puoi mandarlo lo stesso, ma è una bozza: meglio sistemarli prima.', linkBtn('Da controllare', 'checks')) : null,
      h('div', { class: 'row' }, h('button', { class: 'btn primary big', disabled: busy, onclick: () => downloadBundle(res) }, busy ? 'Sto preparando il file…' : 'Scarica tutto (.zip)')),
      ui.bundleDone ? callout('good', 'Fatto: il file è nella cartella Download', 'Prima di mandarlo, se puoi, completa i campi in rosso qui sotto.') : null);
  }

  // ------------------------------------------------------------------ moduli fac-simile (anteprima e download)
  function fxCard(res) {
    const fx = CT.facsimile.build(res, state);
    if (!fx.available) return h('div', { class: 'card' }, h('h2', null, 'Moduli per il commercialista'), h('p', { class: 'muted' }, fx.reason));
    const blk = res.groups.blockCount, asm = res.groups.assumptionCount;
    const forms = [
      { key: 'rw', title: `Quadro RW · Redditi PF 2026`, sub: 'Monitoraggio degli investimenti all\'estero e imposta sulle cripto-attività (IC)', pages: fx.rw, file: `${res.year}-Quadro-RW-facsimile.pdf` },
      { key: 'w', title: `Quadro W · Modello 730/2026`, sub: `Stesso contenuto, solo per chi usa il 730 (scadeva il ${dmy(CT.payments.deadlines(res.year).m730)}: dopo quella data si usa il Redditi PF, cioè il quadro RW qui sopra)`, pages: fx.w, file: `${res.year}-Quadro-W-facsimile.pdf` },
    ];
    const download = async (f) => {
      try {
        const buf = CT.facsimile.toPdf(f.pages, f.title);
        await saveFile(f.file, new Uint8Array(buf), 'application/pdf'); ui.fxDone = f.file; render();
      } catch (e) { console.error(e); toast('Non riesco a creare il PDF: ' + e.message); }
    };
    const item = (f) => {
      const open = ui.fxOpen === f.key;
      const cards = [h('div', { class: 'row between' },
        h('div', null, h('strong', null, f.title), h('div', { class: 'muted small' }, f.sub)),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => { ui.fxOpen = open ? null : f.key; render(); } }, open ? 'Chiudi anteprima' : 'Anteprima'),
          h('button', { class: 'btn primary', onclick: () => download(f) }, 'Scarica PDF')))];
      if (open) {
        cards.push(h('div', { class: 'fxprev' }, f.pages.map((pg, i) => {
          const cv = h('canvas', { class: 'fxcv', role: 'img', 'aria-label': `${f.title}, modulo ${i + 1} di ${f.pages.length}` });
          setTimeout(() => CT.facsimile.renderCanvas(pg, cv, 1100).catch((e) => console.error(e)), 0);
          return h('div', null, f.pages.length > 1 ? h('div', { class: 'small muted' }, `Modulo n. ${i + 1} di ${f.pages.length}`) : null, cv);
        })));
      }
      return h('div', { class: 'fxitem' }, cards);
    };
    return h('section', { class: 'card' },
      h('h2', null, `Moduli fac-simile · ${res.year}`),
      h('p', { class: 'muted' }, 'Sono i moduli dell\'Agenzia delle Entrate (fac-simile) già compilati con i tuoi calcoli. Li dai al commercialista, che li ricopia nel suo programma: non si inviano così come sono.'),
      blk ? h('p', { class: 'pill warn block' }, `Ci sono ancora ${blk} ${blk === 1 ? 'punto' : 'punti'} da sistemare: i moduli portano la scritta BOZZA.`)
        : asm ? h('p', { class: 'pill warn block' }, `Pronti, con ${asm} ${asm === 1 ? 'ipotesi' : 'ipotesi'} (le trovi nei PDF con i calcoli): falle vedere al commercialista.`) : null,
      fx.rows.length ? null : h('p', { class: 'muted' }, 'Non risultano cripto o oro detenuti in questo anno: i moduli sono vuoti.'),
      forms.map(item),
      ui.fxDone ? h('p', { class: 'small', style: 'margin-top:8px' }, `Fatto: «${ui.fxDone}» è nella cartella Download del tuo computer (o dove salvi i file dal telefono). Mandalo al tuo commercialista.`) : null,
      fx.rows.length ? h('p', { class: 'small muted' }, `Una riga per ogni piattaforma: ${fx.rows.length} ${fx.rows.length === 1 ? 'riga' : 'righe'} in tutto (cinque righe per modulo). Dentro ogni riga ci sono sommate tutte le cripto di quella piattaforma.`) : null,
      h('div', { class: 'redkey' }, h('strong', null, 'Cosa vuol dire il rosso. '), 'Le scritte in nero sono calcolate dal programma. Quelle in ',
        h('span', { class: 'redtxt' }, 'rosso'), ' sono i campi da compilare o controllare: il codice fiscale (se non l\'hai scritto in «Completa i dati»), gli «Acconti versati» (dai file non si può sapere se hai già pagato qualcosa: se non hai pagato acconti scrivi 0), le eccedenze dell\'anno prima (solo se ne avevi), il codice dell\'oro e i valori a cui manca un prezzo. Il codice 21 indica le cripto-attività.'));
  }

  function pdfCard(res) {
    const blk = res.groups.blockCount;
    const asm = res.groups.assumptionCount;
    const busy = ui.pdfBusy;
    return h('div', { class: 'card' },
      h('h2', null, `PDF con tutti i calcoli · ${res.year}`),
      h('p', { class: 'muted' }, 'Riepilogo delle imposte, elenco delle vendite con il costo di acquisto, proventi, saldi, fonti dei dati e scelte fatte. Servono al commercialista per capire e verificare i numeri dei moduli, e a te in caso di controllo.'),
      blk ? h('p', { class: 'pill warn block' }, `Ci sono ancora ${blk} ${blk === 1 ? 'punto' : 'punti'} da sistemare: ogni pagina avrà la filigrana BOZZA.`)
        : asm ? h('p', { class: 'pill warn block' }, `Con ${asm} ${asm === 1 ? 'ipotesi' : 'ipotesi'} elencate nell'Allegato E.`) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn', disabled: busy, onclick: () => downloadPdf('full') }, busy ? 'Sto preparando i PDF…' : 'Scarica il PDF con i calcoli'),
        h('button', { class: 'btn', disabled: busy, onclick: () => downloadPdf('zip') }, 'Scarica i PDF separati (.zip)')),
      ui.pdfDone ? h('p', { class: 'small', style: 'margin-top:8px' }, `Fatto: «${ui.pdfDone}» è nella cartella Download.`) : null,
      res.dataYears.filter((x) => x !== res.year && CT.tax.YEARS.includes(x)).length ? h('p', { class: 'small muted' }, `Hai operazioni anche nel ${res.dataYears.filter((x) => x !== res.year && CT.tax.YEARS.includes(x)).join(' e nel ')}: per averne i PDF cambia l'anno dal menu.`) : null,
      h('details', null, h('summary', null, 'Scarica un singolo documento'),
        h('div', { class: 'stack', style: 'padding:8px 0;gap:0' },
          CT.pdf.SECTIONS.map((sec) => h('div', { class: 'row between', style: 'padding:8px 0;border-top:1px solid var(--line)' },
            h('span', null, sec.title), h('button', { class: 'btn', disabled: busy, onclick: () => downloadPdf(`${res.year}-${sec.file}.pdf`) }, 'Scarica'))))));
  }

  function noData() {
    return emptyState('Prima inserisci i tuoi dati', 'Carica i file delle piattaforme di investimento oppure inserisci stipendio, musica e spese nella sezione Redditi.', 'Vai ai file', 'files');
  }

  // ------------------------------------------------------------------ documenti
  /** Dati che il programma non conosce e che servono ai moduli: nome, codice fiscale, acconti, custodi. In rosso finche' mancano. */
  function dataCard(res) {
    const tf = taxpayerFields(res, () => render());
    const tp = state.taxpayer || {};
    const missing = [!tp.cf ? 'codice fiscale' : null, !String(tp.advance || '').trim() ? 'acconti IVCA già versati (0 se nessuno)' : null].filter(Boolean);
    for (const [f, ok] of [[tf.cf, !!tp.cf], [tf.adv, !!String(tp.advance || '').trim()]]) if (!ok) f.input.classList.add('need');
    return card('Completa i dati per i moduli', missing.length ? null : 'Tutti i dati principali sono compilati.',
      missing.length ? callout('bad', `Da completare: ${missing.join(', ')}`, 'Nei moduli questi campi compaiono in rosso finché non li scrivi qui.') : null,
      h('div', { class: 'fields' }, tf.name.el, tf.cf.el, tf.adv.el),
      tf.accounts.length ? [h('h3', null, 'Dove sono custodite le cripto (facoltativo)'), h('p', { class: 'muted small' }, 'La società che custodisce i fondi compare accanto alla riga del quadro RW, per aiutare il commercialista.'), tf.cust] : null);
  }
  function tablesCard(res) {
    const y = res.year;
    const item = (title, desc, name, build, mime) => h('div', { class: 'list-row' },
      h('div', null, h('strong', null, title), h('div', { class: 'muted small' }, desc)),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => saveFile(name, build(), mime) }, 'Salva'), h('button', { class: 'btn quiet', onclick: () => copyText(build().replace(/^﻿/, ''), title) }, 'Copia')));
    return h('details', { class: 'card' }, h('summary', null, 'Tabelle per Excel e riepiloghi di testo'),
      h('p', { class: 'muted small' }, 'I file CSV si aprono con Excel (separatore ; e virgola decimale).'),
      item('Riepilogo', 'Testo con i totali per quadro', `riepilogo-${y}.txt`, () => R.summaryText(res), 'text/plain'),
      item('Vendite e scambi', 'Una riga per ogni cessione, con costo e guadagno', `cessioni-${y}.csv`, () => R.csv(R.DISPOSAL_HEAD, R.disposalsRows(res)), 'text/csv'),
      item('Dettaglio lotti', 'Per ogni cessione, i lotti di acquisto usati', `lotti-${y}.csv`, () => R.csv(R.LOTS_HEAD, R.lotsRows(res)), 'text/csv'),
      item('Proventi', 'Staking, interessi, premi ricevuti nell\'anno', `proventi-${y}.csv`, () => R.csv(R.INCOME_HEAD, R.incomesRows(res)), 'text/csv'),
      item('Prospetto RW', 'Valori iniziali e finali, giorni e IVCA', `rw-${y}.csv`, () => R.csv(R.RW_HEAD, R.rwRows(res)), 'text/csv'),
      item('Saldi al 31/12', 'Quanto risulta in ogni conto a fine anno', `saldi-${y}.csv`, () => R.csv(R.BAL_HEAD, R.balancesRows(res)), 'text/csv'),
      item('Problemi e note', 'Tutto quello che il programma ha segnalato', `problemi-${y}.csv`, () => R.csv(R.ISSUE_HEAD, R.issuesRows(res)), 'text/csv'));
  }
  function pageExport(res) {
    return [bundleCard(res), dataCard(res), fxCard(res), pdfCard(res), tablesCard(res)];
  }

  // ------------------------------------------------------------------ impostazioni
  function pageSettings() {
    const res = ui.res;
    return [
      optionsCard(),
      card('Salvataggio del lavoro', 'Il lavoro si salva da solo in questo browser. Per una copia o per spostarlo su un altro computer salva il progetto e riaprilo da qui.',
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => saveFile('progetto-dichiarazione.json', JSON.stringify(state), 'application/json') }, 'Salva il progetto'),
          h('label', { class: 'btn', for: 'projIn' }, 'Apri un progetto salvato', h('input', { type: 'file', id: 'projIn', accept: '.json', class: 'sr', onchange: async (e) => {
            try { const s = JSON.parse(await e.target.files[0].text()); if (!Array.isArray(s.files)) throw new Error(); Object.assign(state, s); changed('overview'); toast('Progetto caricato'); } catch (err) { toast('Il file non è un progetto valido'); }
          } })))),
      card('Usa il programma sul tuo computer', 'Un unico file .html con lo stesso programma: si apre con un doppio clic, anche senza internet. I dati restano su quel computer.',
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { const html = standaloneHtml(); if (!html) { toast('Non riesco a preparare il file'); return; } saveFile('dichiarazione-redditi.html', html, 'text/html'); } }, 'Scarica il programma (.html)'))),
      card('Assistenza', 'Se un file non viene letto bene, la diagnostica descrive la struttura dei file senza nessun importo: puoi mandarla a chi sviluppa il programma.',
        h('div', { class: 'row' }, h('button', { class: 'btn', disabled: !res, onclick: () => copyText(R.diagnostics(res, state.files), 'Diagnostica') }, 'Copia la diagnostica (senza importi)'))),
      card('Dati di prova e cancellazione', null,
        h('div', { class: 'row' }, state.example ? h('button', { class: 'btn', onclick: exitExample }, 'Esci dall\'esempio') : h('button', { class: 'btn', onclick: loadExample, disabled: state.files.length > 0 }, 'Prova con dati di esempio')),
        resetBlock()),
    ];
  }

  // ------------------------------------------------------------------ cornice: menu laterale, intestazione, pagine
  const NI = {
    overview: ['M3 11l9-8 9 8', 'M5 10v10h5v-6h4v6h5V10'],
    lavoro: ['M3 8h18v12H3z', 'M8 8V5h8v3', 'M3 13h18'],
    musica: ['M9 18V5l12-2v13', 'M9 18a3 3 0 1 1-6 0a3 3 0 1 1 6 0', 'M21 16a3 3 0 1 1-6 0a3 3 0 1 1 6 0'],
    spese: ['M6 3h12v18l-3-2-3 2-3-2-3 2z', 'M9 8h6', 'M9 12h6'],
    irpef: ['M6 3h12v18H6z', 'M9 7h6v3H9z', 'M9 14v.5', 'M12 14v.5', 'M15 14v.5', 'M9 17v.5', 'M12 17v.5', 'M15 17v.5'],
    files: ['M3 7h6l2 2h10v10H3z'],
    checks: ['M12 3l10 18H2z', 'M12 10v4', 'M12 17v.5'],
    invest: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M3 20h18'],
    pay: ['M17 6a7 7 0 1 0 0 12', 'M4 10h9', 'M4 14h9'],
    export: ['M7 3h7l4 4v14H7z', 'M14 3v4h4', 'M9 13h6', 'M9 17h6'],
    guide: ['M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z', 'M9 4v14', 'M15 6v14'],
    settings: ['M12 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6', 'M12 2v3', 'M12 19v3', 'M2 12h3', 'M19 12h3', 'M4.9 4.9l2.1 2.1', 'M17 17l2.1 2.1', 'M4.9 19.1L7 17', 'M17 7l2.1-2.1'],
    menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  };
  const PAGES = [
    { key: 'overview', label: 'Panoramica', lead: (Y) => `Il riepilogo della dichiarazione ${Y}: quanto pagare, cosa manca e il prossimo passo.` },
    { group: 'Redditi' },
    { key: 'lavoro', label: 'Lavoro dipendente', lead: () => 'Stipendio o pensione: i dati della Certificazione Unica (CU).' },
    { key: 'musica', label: 'Musica (DJ e SIAE)', lead: () => 'Serate da DJ con prestazione occasionale, diritti d\'autore SIAE e royalties.' },
    { key: 'spese', label: 'Spese e detrazioni', lead: () => 'Spese mediche e altre spese che riducono le tasse.' },
    { key: 'irpef', label: 'IRPEF e addizionali', lead: () => 'Il calcolo su tutti i redditi e le addizionali regionale e comunale, che puoi scrivere tu.' },
    { group: 'Investimenti' },
    { key: 'files', label: 'Piattaforme e file', lead: () => 'Cripto, oro e altri investimenti: carica i file di Crypto.com, Bitpanda, Binance o di un wallet.' },
    { key: 'checks', label: 'Da controllare', lead: () => 'Quello che il programma non può sapere da solo: rispondi e il calcolo diventa definitivo.' },
    { key: 'invest', label: 'Calcolo imposte', lead: () => 'Imposte su cripto e oro (quadro RT) e monitoraggio con imposta sul valore (quadro RW).' },
    { group: 'Chiusura' },
    { key: 'pay', label: 'Cosa pagare', lead: () => 'Tutti i versamenti con l\'F24: importi, codici tributo, scadenze ed eventuale ravvedimento.' },
    { key: 'export', label: 'Documenti', lead: () => 'Il pacchetto per il commercialista, i moduli fac-simile e il PDF con tutti i calcoli.' },
    { key: 'guide', label: 'Guida alla compilazione', lead: (Y) => `Ogni numero da scrivere nel modello Redditi PF ${Y + 1}, quadro per quadro.` },
    { group: '' },
    { key: 'settings', label: 'Impostazioni', lead: () => 'Opzioni di calcolo, salvataggio del lavoro, dati di prova.' },
  ];
  const ORDER = PAGES.filter((p) => p.key && p.key !== 'settings').map((p) => p.key);
  const PARENT = { prices: 'checks', detail: 'invest', result: 'overview', others: 'lavoro' };
  const pageOf = (k) => PAGES.find((p) => p.key === k);
  const groupOf = (k) => { let g = ''; for (const p of PAGES) { if (p.group !== undefined) g = p.group; if (p.key === k) return g; } return ''; };

  function navList(res) {
    const st = sectionStatus(res);
    const cur = PARENT[ui.tab] || ui.tab;
    const out = [];
    for (const p of PAGES) {
      if (p.group !== undefined) { out.push(p.group ? h('div', { class: 'nav-group' }, p.group) : h('hr', { class: 'nav-sep' })); continue; }
      const s = st[p.key];
      const meta = p.key === 'checks' && res && res.groups.blockCount ? h('span', { class: 'nav-badge' }, res.groups.blockCount)
        : s === 'done' || s === 'skip' ? h('span', { class: 'nav-ok', 'aria-label': 'completato' }, '✓') : null;
      out.push(h('button', { class: 'nav-item', 'aria-current': cur === p.key ? 'page' : null, onclick: () => go(p.key) },
        h('span', { class: 'nav-ic' }, svgIcon(NI[p.key])), h('span', { class: 'nav-label' }, p.label), meta));
    }
    return out;
  }
  function yearSelect(id) {
    return h('select', { id, 'aria-label': 'Anno d\'imposta', onchange: (e) => { state.settings.year = +e.target.value; state.settings.yearChosen = true; ui.yearNote = false; changed(); } },
      CT.tax.YEARS.map((y) => h('option', { value: y, selected: state.settings.year === y }, `Anno ${y}`)));
  }
  function statusBadge(res) {
    const blk = res ? res.groups.blockCount : 0;
    if (blk) return h('button', { class: 'pill warn', onclick: () => go('checks') }, `Bozza · ${blk} da controllare`);
    return h('span', { class: 'pill good' }, 'Calcolo pronto');
  }
  function sidebar(res) {
    return h('aside', { class: 'side', 'aria-label': 'Sezioni' },
      h('div', { class: 'brand' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, '€'),
        h('div', null, h('div', { class: 'brand-name' }, 'Dichiarazione Redditi'), h('div', { class: 'brand-sub' }, `Redditi PF ${state.settings.year + 1}`))),
      h('div', { class: 'side-ctl' }, yearSelect('yearSel'), statusBadge(res)),
      h('nav', { class: 'nav' }, navList(res)),
      h('p', { class: 'side-foot' }, 'I dati restano nel tuo browser: niente viene inviato.'));
  }
  function pager(key) {
    const i = ORDER.indexOf(key);
    if (i < 0) return null;
    const prev = ORDER[i - 1], next = ORDER[i + 1];
    return h('nav', { class: 'pager', 'aria-label': 'Pagina precedente e successiva' },
      prev ? h('button', { class: 'btn', onclick: () => go(prev) }, '← ', pageOf(prev).label) : h('span'),
      next ? h('button', { class: 'btn primary', onclick: () => go(next) }, pageOf(next).label, ' →') : null);
  }
  function pageContent(res) {
    switch (ui.tab) {
      case 'lavoro': return pageLavoro();
      case 'musica': return pageMusica();
      case 'spese': return pageSpese();
      case 'irpef': return pageIrpef();
      case 'files': return [ui.platform ? panelPlatform(ui.platform) : panelPlatforms()];
      case 'checks': return state.files.length + state.manual.length ? [panelChecks()] : [emptyState('Niente da controllare', 'I controlli riguardano i file degli investimenti: caricali e qui compare quello che il programma non sa da solo.', 'Carica i file', 'files')];
      case 'prices': return [panelPrices()];
      case 'invest': return pageInvest(res);
      case 'pay': return pagePay(res);
      case 'export': return pageExport(res);
      case 'guide': return pageGuide(res);
      case 'settings': return pageSettings();
      default: return pageOverview(res);
    }
  }

  let rendering = false, renderAgain = false;
  function render() {
    // un ridisegno chiesto mentre ne e' in corso un altro (es. evento "change" quando un campo sparisce) si fa subito dopo
    if (rendering) { renderAgain = true; return; }
    rendering = true;
    try { renderNow(); } finally { rendering = false; }
    if (renderAgain) { renderAgain = false; setTimeout(render, 0); }
  }
  function renderNow() {
    const root = document.getElementById('app');
    if (ui.tab === 'detail') { ui.tab = 'invest'; ui.investTab = 'ops'; }
    if (ui.tab === 'result') ui.tab = 'overview';
    if (ui.tab === 'others') ui.tab = 'lavoro';
    const res = ui.res;
    const key = PARENT[ui.tab] || ui.tab;
    const pg = pageOf(key) || pageOf('overview');
    const Y = state.settings.year;
    let content;
    if (!res) content = [emptyState('Qualcosa non ha funzionato', ui.error ? `Errore: ${ui.error.message}` : 'Il calcolo non è disponibile.', 'Vai alle impostazioni', 'settings')];
    else content = pageContent(res);
    const scrollY = window.scrollY;
    root.replaceChildren(...[
      h('div', { class: `shell${ui.navOpen ? ' nav-open' : ''}` },
        sidebar(res),
        h('div', { class: 'scrim', onclick: () => { ui.navOpen = false; render(); } }),
        h('div', { class: 'main' },
          h('header', { class: 'topbar' },
            h('button', { class: 'icon-btn', 'aria-label': 'Apri il menu', onclick: () => { ui.navOpen = true; render(); } }, svgIcon(NI.menu)),
            h('div', { class: 'topbar-title' }, h('span', null, pg.label), h('small', null, groupOf(key) || 'Dichiarazione Redditi')),
            yearSelect('yearSelTop')),
          h('main', { class: 'page', id: 'main' },
            state.example ? callout('warn', 'Dati di esempio', 'Sono numeri inventati, non i tuoi.', h('button', { class: 'btn', onclick: exitExample }, 'Usa i miei dati')) : null,
            ui.yearNote ? h('p', { class: 'small muted' }, `Ho scelto il ${Y} perché è l'ultimo anno dei tuoi file. Puoi cambiarlo dal menu.`) : null,
            h('header', { class: 'page-head' }, groupOf(key) ? h('div', { class: 'eyebrow' }, groupOf(key)) : null, h('h1', null, pg.label), h('p', { class: 'lead' }, pg.lead(Y))),
            ...content.flat(Infinity).filter(Boolean),
            pager(key)))),
      ui.toast ? h('div', { class: 'toast', role: 'status' }, ui.toast) : null, askMoreModal()].filter(Boolean));
    window.scrollTo(0, scrollY);
    const mf = root.querySelector('.modal .btn.primary');
    if (mf) mf.focus();
  }

  async function start() {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (ui.askMore) { ui.askMore = null; render(); } else if (ui.navOpen) { ui.navOpen = false; render(); }
    });
    await load();
    recompute(); autoYear();
    render();
    maybeAutoPrices();
  }

  CT.app = { state, ui, render, start, recompute, addFileText, changed };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  }
})();
