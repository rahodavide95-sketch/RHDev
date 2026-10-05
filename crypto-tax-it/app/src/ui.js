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
  const ui = { tab: 'files', res: null, error: null, detail: 'cessioni', filter: '', confirmReset: false, toast: '', busy: '', ver: 0, pdf: null, pdfBusy: false, platform: null, method: 'file', confirmRemove: null };

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
  const goPlatforms = () => { ui.tab = 'files'; ui.platform = null; render(); window.scrollTo(0, 0); };
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

  // ------------------------------------------------------------------ pannello: Piattaforme (elenco)
  function panelPlatforms() {
    const nodes = [];
    nodes.push(h('div', { class: 'card' },
      h('h2', null, 'Da quali piattaforme vuoi importare i dati?'),
      h('p', { class: 'muted' }, 'Scegli una piattaforma, poi aggiungi i suoi file o, quando sarà disponibile, il collegamento API. Puoi aggiungerne quante vuoi: i trasferimenti tra le tue piattaforme vengono riconosciuti da soli.'),
      !state.files.length ? h('div', { class: 'row' }, h('button', { class: 'btn', onclick: loadExample }, 'Prima vedi un esempio'), state.example ? null : null) : null));
    nodes.push(h('div', { class: 'plats' }, Object.keys(P).map(platformCard)));
    nodes.push(optionsCard());
    nodes.push(h('div', { class: 'row' },
      ui.confirmReset
        ? [h('span', { class: 'small' }, 'Cancellare tutte le piattaforme, i file, le scelte e i prezzi?'),
          h('button', { class: 'btn danger', onclick: () => { state.files = []; state.manual = []; state.resolutions = {}; state.prices = {}; state.platforms = []; state.example = false; ui.confirmReset = false; ui.platform = null; changed('files'); toast('Dati cancellati'); } }, 'Sì, cancella tutto'),
          h('button', { class: 'btn', onclick: () => { ui.confirmReset = false; render(); } }, 'Annulla')]
        : h('button', { class: 'btn quiet danger', onclick: () => { ui.confirmReset = true; render(); } }, 'Cancella tutti i dati salvati')));
    return h('div', { class: 'stack' }, nodes);
  }

  function platformCard(k) {
    const p = P[k], st = platformStats(k);
    const added = (state.platforms || []).includes(k) || st.files.length > 0;
    let status;
    if (!added) status = h('p', { class: 'muted small' }, 'Non ancora aggiunta');
    else if (!st.files.length) status = h('p', { class: 'small' }, 'Aggiunta · nessun file ancora');
    else status = h('p', { class: 'small' }, `${st.files.length} ${st.files.length === 1 ? 'file' : 'file'} · ${st.rows} righe`,
      st.unknown ? ` · ${st.unknown} da controllare` : '', st.errors ? ` · ${st.errors} con errori` : '',
      p.kinds.length > 1 && st.missing.length ? ` · mancano: ${st.missing.map((m) => m.label).join(', ')}` : '');
    return h('div', { class: `card pcard${added ? ' on' : ''}` },
      h('h3', null, p.name), h('p', { class: 'muted small' }, p.blurb),
      h('div', { class: 'row' },
        h('span', { class: `pill ${p.native ? 'good' : 'idle'}` }, p.native ? 'File' : 'File (modello)'),
        h('span', { class: 'pill idle' }, p.api.status === 'none' ? 'API: non disponibile' : 'API: in arrivo')),
      status,
      h('button', { class: `btn ${added ? '' : 'primary'}`, onclick: () => { ensurePlatform(k); ui.platform = k; ui.method = 'file'; save(); render(); window.scrollTo(0, 0); } }, added ? 'Apri' : 'Aggiungi'));
  }

  // ------------------------------------------------------------------ pannello: una piattaforma
  function panelPlatform(k) {
    const p = P[k], st = platformStats(k);
    const seg = h('div', { class: 'subtabs', role: 'group', 'aria-label': 'Come aggiungere i dati' },
      [['file', 'Con i file'], ['api', 'Con le API']].map(([m, t]) => h('button', { class: 'chip', 'aria-pressed': ui.method === m ? 'true' : 'false', onclick: () => { ui.method = m; render(); } }, t)));
    const remove = ui.confirmRemove === k
      ? h('span', { class: 'row' }, h('span', { class: 'small' }, 'Rimuovere la piattaforma e i suoi file?'),
        h('button', { class: 'btn danger', onclick: () => { state.files = state.files.filter((f) => platformOfFile(f) !== k); state.platforms = (state.platforms || []).filter((x) => x !== k); ui.confirmRemove = null; ui.platform = null; changed('files'); toast('Piattaforma rimossa'); } }, 'Sì, rimuovi'),
        h('button', { class: 'btn', onclick: () => { ui.confirmRemove = null; render(); } }, 'Annulla'))
      : h('button', { class: 'btn quiet danger', onclick: () => { ui.confirmRemove = k; render(); } }, 'Rimuovi piattaforma');
    return h('div', { class: 'stack' },
      h('div', null, h('button', { class: 'btn quiet', onclick: goPlatforms }, '← Tutte le piattaforme')),
      h('div', { class: 'card' },
        h('div', { class: 'row between' }, h('h2', null, p.name), remove),
        h('p', { class: 'muted' }, p.blurb),
        h('p', { class: 'lbl' }, 'Come vuoi aggiungere i dati?'), seg),
      ui.method === 'api' ? apiPanel(k) : filePanel(k, st));
  }

  function apiPanel(k) {
    const a = P[k].api;
    return h('div', { class: `card tone-${a.status === 'none' ? 'warn' : 'warn'}` },
      h('div', { class: 'row' }, h('h3', null, a.status === 'none' ? 'Nessuna API disponibile' : 'Collegamento API non ancora disponibile'),
        h('span', { class: `pill ${a.status === 'none' ? 'idle' : 'warn'}` }, a.status === 'none' ? 'Non esiste' : 'In arrivo')),
      h('p', { class: 'muted' }, a.text),
      a.points.length ? h('ul', { class: 'clean muted small' }, a.points.map((t) => h('li', null, t))) : null,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => { ui.method = 'file'; render(); } }, 'Aggiungi i file')));
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
        h('button', { class: 'btn primary', onclick: () => { ui.platform = null; ui.tab = ui.res && ui.res.groups.blockCount ? 'checks' : 'result'; render(); window.scrollTo(0, 0); } }, 'Continua: controlla e calcola'),
        h('button', { class: 'btn', onclick: goPlatforms }, 'Aggiungi un\'altra piattaforma')));
    }
    if (p.manual) nodes.push(manualCard());
    nodes.push(h('details', { class: 'card' }, h('summary', null, 'Cosa viene letto e cosa no'), h('ul', { class: 'clean muted' }, p.limits.map((x) => h('li', null, x)))));
    return h('div', { class: 'stack', style: 'padding:0' }, nodes);
  }

  function fileRow(f, x, k) {
    const plat = P[k];
    const meta = [];
    let chip, warn = null;
    if (!x) chip = h('span', { class: 'pill idle' }, '…');
    else if (!x.ok) chip = h('span', { class: 'pill bad' }, x.error);
    else {
      const r = x.result;
      meta.push(h('span', null, `${r.rows} righe`));
      if (r.from) meta.push(h('span', null, `dal ${dmy(CT.taxDate(r.from))} al ${dmy(CT.taxDate(r.to))}`));
      const unk = r.unknown.reduce((a, u) => a + u.count, 0);
      chip = unk ? h('span', { class: 'pill warn' }, `${unk} righe da controllare`) : h('span', { class: 'pill good' }, 'Letto correttamente');
    }
    if (f.type && !plat.types.includes(f.type)) {
      const other = CT.platformOfType(f.type);
      warn = h('div', { class: 'row' }, h('span', { class: 'pill warn' }, `Sembra un export di ${P[other].name}`),
        h('button', { class: 'btn', onclick: () => { f.platform = other; ensurePlatform(other); changed(); toast(`Spostato su ${P[other].name}`); } }, `Spostalo su ${P[other].name}`));
    }
    const sel = h('select', { 'aria-label': `Tipo di file per ${f.name}`, onchange: (e) => { f.type = e.target.value; changed(); } },
      h('option', { value: '' }, 'Scegli il tipo di file…'),
      plat.kinds.map((kd) => h('option', { value: kd.type, selected: f.type === kd.type }, kd.label)),
      f.type && !plat.types.includes(f.type) ? h('option', { value: f.type, selected: true }, CT.importers.TYPES[f.type].label) : null);
    const needsDiag = x && (!x.ok || x.result.unknown.length);
    return h('div', { class: 'file' },
      h('div', null, h('div', { class: 'name' }, f.name), h('div', { class: 'meta' }, meta), h('div', { class: 'row', style: 'margin-top:8px' }, sel, chip), warn ? h('div', { style: 'margin-top:8px' }, warn) : null),
      h('div', { class: 'row' },
        needsDiag ? h('button', { class: 'btn quiet', onclick: () => copyText(R.diagnostics(ui.res, [f]), 'Diagnostica') }, 'Copia diagnostica') : null,
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

  function panelChecks() {
    const res = ui.res;
    if (!res) return noData();
    const g = res.groups;
    const out = [];
    if (!g.blockCount) out.push(h('div', { class: 'card tone-good' }, h('h2', null, 'Tutto a posto'), h('p', { class: 'muted' }, 'Non ci sono punti da risolvere. Controlla comunque i saldi finali nella scheda Dettaglio e confrontali con quelli che vedi nelle piattaforme.')));
    else out.push(h('div', { class: 'card tone-warn' }, h('h2', null, g.blockCount === 1 ? '1 cosa da controllare' : `${g.blockCount} cose da controllare`), h('p', { class: 'muted' }, 'Finché non le risolvi i numeri del Risultato sono una bozza. Il programma non indovina: ti chiede quello che non può sapere.')));

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
    for (const i of g.history) {
      const cost = field('Costo totale di quanto manca (€)', { placeholder: 'es. 400', id: `h_${i.uid}` });
      const when = field('Data di acquisto (facoltativa)', { type: 'date', id: `hd_${i.uid}` });
      out.push(issueCard('bad', `Vendita di ${i.data.asset} del ${dmy(i.data.day)}: mancano ${qty(i.data.qty)}`,
        'Nei file caricati non risulta l\'acquisto di questa quantità. Carica anche i file più vecchi (dall\'apertura del conto) oppure indica a che costo l\'avevi presa.',
        h('div', { class: 'fields' }, cost.el, when.el),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: () => { const v = needNumber(cost.input.value, 'il costo'); if (v) resolve(i.uid, { action: 'cover_cost', cost_eur: v, acquired: when.input.value || undefined }, 'Costo salvato'); } }, 'Salva il costo'),
          h('button', { class: 'btn', onclick: goPlatforms }, 'Aggiungi altri file'))));
    }
    for (const u of g.unknown.values()) {
      const ex = u.items.slice(0, 3).map((i) => i.message);
      out.push(issueCard('bad', `${u.items.length} righe di tipo sconosciuto`, u.key,
        h('ul', { class: 'clean muted small' }, ex.map((m) => h('li', null, m))),
        h('p', { class: 'small muted' }, 'Questo tipo di riga non è ancora gestito. Se è solo uno spostamento interno senza effetti fiscali puoi ignorarla; se invece è un acquisto, una vendita o un premio, copia la diagnostica e mandala a chi sviluppa l\'app così la aggiungiamo.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => { u.items.forEach((i) => { state.resolutions[i.uid] = { action: 'ignore' }; }); changed(); toast('Righe ignorate'); } }, `Ignora tutte (${u.items.length})`),
          h('button', { class: 'btn', onclick: () => copyText(R.diagnostics(res, state.files), 'Diagnostica') }, 'Copia diagnostica'))));
    }
    if (g.prices.size || [...res.engine.missingPrices.keys()].length) {
      const n = res.engine.missingPrices.size;
      out.push(issueCard('bad', `Mancano ${n} prezzi in euro`, 'Servono per valorizzare gli scambi e per il prospetto del monitoraggio (valore al 1° gennaio e al 31 dicembre).',
        h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => { ui.tab = 'prices'; render(); } }, 'Inserisci i prezzi'))));
    }
    for (const i of g.notes.filter((x) => x.level === 'block')) out.push(issueCard('bad', i.message, null));
    if (g.outOfScope.length) {
      const assets = [...new Set(g.outOfScope.map((i) => i.data.asset))].join(', ');
      out.push(issueCard('warn', `${g.outOfScope.length} operazioni ignorate (azioni, ETF o altro)`, `Riguardano: ${assets}. Questa versione calcola cripto e oro; azioni ed ETF non sono ancora inclusi.`));
    }
    const notes = g.notes.filter((x) => x.level !== 'block');
    if (notes.length) out.push(h('details', { class: 'card' }, h('summary', null, `Altre note (${notes.length})`), h('ul', { class: 'clean muted small' }, notes.slice(0, 200).map((i) => h('li', null, i.message)))));
    return h('div', { class: 'stack' }, out);
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
    return h('div', { class: 'stack' }, h('div', { class: 'card' }, h('div', { class: 'row between' }, bar, filter), body));
  }

  // ------------------------------------------------------------------ pannello: Prezzi
  async function fetchPrice(sym, day) {
    const ts = Math.floor(Date.parse(day + 'T23:59:59Z') / 1000);
    const r = await fetch(`https://min-api.cryptocompare.com/data/v2/histoday?fsym=${encodeURIComponent(sym)}&tsym=EUR&limit=1&toTs=${ts}`);
    const j = await r.json();
    const row = j && j.Data && j.Data.Data && j.Data.Data.find((x) => new Date(x.time * 1000).toISOString().slice(0, 10) === day);
    if (!row || !row.close) throw new Error('prezzo non disponibile');
    return String(row.close);
  }
  function panelPrices() {
    const res = ui.res;
    if (!res) return noData();
    const need = [...res.engine.missingPrices.values()].sort((a, b) => (a.symbol + a.day < b.symbol + b.day ? -1 : 1));
    const inputs = new Map();
    const rows = need.map((n) => {
      const key = `${n.symbol}|${n.day}`;
      const sug = res.engine.prices.nearest(n.symbol, n.day);
      const input = h('input', { type: 'text', 'aria-label': `Prezzo ${n.symbol} ${n.day}`, placeholder: '€ per 1 ' + n.symbol, id: `p_${key}`, style: 'width:140px' });
      inputs.set(key, input);
      return h('tr', null, h('td', null, n.symbol), h('td', null, dmy(n.day)),
        h('td', { class: 'muted small' }, sug ? h('span', null, `${money(sug.price)} (${dmy(sug.day)}, ${sug.daysApart} gg ${sug.daysApart === 1 ? 'prima/dopo' : 'di distanza'}) `, h('button', { class: 'btn quiet', onclick: () => { input.value = sug.price.toDecimalPlaces(8).toString(); } }, 'Usa')) : 'nessun prezzo noto'),
        h('td', null, input));
    });
    const saveAll = () => {
      let n = 0;
      for (const [k, input] of inputs) { const v = input.value.trim().replace(',', '.'); if (v && !Number.isNaN(Number(v)) && Number(v) > 0) { state.prices[k] = v; n++; } }
      if (!n) { toast('Scrivi almeno un prezzo valido'); return; }
      changed(); toast(`${n} prezzi salvati`);
    };
    const auto = async () => {
      ui.busy = 'Scarico i prezzi…'; render();
      let ok = 0, ko = 0;
      for (const n of need) {
        if (CT.classify(n.symbol) !== 'crypto') { ko++; continue; }
        try { state.prices[`${n.symbol}|${n.day}`] = await fetchPrice(n.symbol, n.day); ok++; } catch (e) { ko++; }
      }
      ui.busy = ''; changed(); toast(`${ok} prezzi scaricati${ko ? `, ${ko} da inserire a mano` : ''}`);
    };
    const have = Object.entries(state.prices);
    return h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('h2', null, need.length ? `Prezzi mancanti (${need.length})` : 'Nessun prezzo mancante'),
        h('p', { class: 'muted' }, 'Il programma usa già i prezzi che ricava dalle tue operazioni dello stesso giorno. Per gli altri casi serve il prezzo in euro (chiusura giornaliera). Per l\'oro scrivi il prezzo di 1 grammo.'),
        need.length ? [h('div', { class: 'tbl-wrap' }, h('table', null, h('thead', null, h('tr', null, ['Asset', 'Data', 'Suggerimento', 'Prezzo in €'].map((x) => h('th', null, x)))), h('tbody', null, rows))),
          h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: saveAll }, 'Salva i prezzi'),
            h('button', { class: 'btn', disabled: !!ui.busy, onclick: auto }, ui.busy || 'Scarica i prezzi in automatico'),
            h('span', { class: 'muted small' }, 'Il download automatico (CryptoCompare) invia solo simbolo e data. Potrebbe non funzionare in tutte le versioni dell\'app.'))] : null),
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
          h('button', { class: 'btn', onclick: () => copyText(R.diagnostics(res, state.files), 'Diagnostica') }, 'Copia diagnostica (senza importi)'))));
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
  const TABS = [['files', 'Piattaforme'], ['checks', 'Da controllare'], ['result', 'Risultato'], ['detail', 'Dettaglio'], ['prices', 'Prezzi'], ['export', 'Documenti']];
  function render() {
    const root = document.getElementById('app');
    const res = ui.res;
    const blk = res ? res.groups.blockCount : 0;
    const missing = res ? res.engine.missingPrices.size : 0;
    const hasData = state.files.length || state.manual.length;
    const status = !hasData ? h('span', { class: 'pill idle' }, 'Nessun dato')
      : blk ? h('button', { class: 'pill warn', onclick: () => { ui.tab = 'checks'; render(); } }, `Bozza · ${blk} da controllare`) : h('span', { class: 'pill good' }, 'Pronto');
    const yearSel = h('select', { id: 'yearSel', 'aria-label': 'Anno d\'imposta', onchange: (e) => { state.settings.year = +e.target.value; changed(); } },
      CT.tax.YEARS.map((y) => h('option', { value: y, selected: state.settings.year === y }, y)));
    const nav = h('nav', { class: 'nav', role: 'tablist' }, TABS.map(([k, t], i) => h('button', { class: 'tab', role: 'tab', 'aria-selected': ui.tab === k ? 'true' : 'false', onclick: () => { ui.tab = k; render(); window.scrollTo(0, 0); } },
      h('span', { class: 'n' }, i + 1), t,
      k === 'checks' && blk ? h('span', { class: 'badge' }, blk) : null, k === 'prices' && missing ? h('span', { class: 'badge' }, missing) : null)));
    const panel = { files: () => (ui.platform ? panelPlatform(ui.platform) : panelPlatforms()), checks: panelChecks, result: panelResult, detail: panelDetail, prices: panelPrices, export: panelExport }[ui.tab]();
    const scrollY = window.scrollY;
    root.replaceChildren(...[
      h('header', { class: 'top' }, h('div', { class: 'wrap' },
        h('div', { class: 'top-in' }, h('div', null, h('div', { class: 'brand-name' }, 'Dichiarazione Crypto'), h('div', { class: 'brand-sub' }, 'Cripto e oro · redditi diversi · quadri RT e RW')),
          h('div', { class: 'top-ctl' }, h('label', { class: 'lbl', for: 'yearSel' }, 'Anno d\'imposta'), yearSel, status)), nav)),
      h('main', { class: 'wrap', id: 'main' }, panel),
      ui.toast ? h('div', { class: 'toast', role: 'status' }, ui.toast) : null].filter(Boolean));
    window.scrollTo(0, scrollY);
  }

  async function start() {
    await load();
    recompute();
    if (state.files.length && ui.res) ui.tab = ui.res.groups.blockCount ? 'checks' : 'result';
    render();
  }
  CT.app = { state, ui, render, start, recompute, addFileText, changed };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  }
})();
