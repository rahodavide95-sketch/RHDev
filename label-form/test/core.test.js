import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/core/crypto.js';
import { sanitizeRich, richToText, fromPlain, safeHref, isEmptyRich, placeholdersIn } from '../js/core/richtext.js';
import { checkLink, typoSuggestion } from '../js/core/links.js';
import { sanitizeTheme, themeVars, applyPreset, safeImage, onColor } from '../js/core/theme.js';
import { sanitizeForm, defaultForm, blankForm, fieldById, ID_RE } from '../js/core/schema.js';
import * as A from '../js/core/answers.js';
import { contractValues, contractSnapshot, contractHash, verifyContract, fillContract, trackTitles, numWord, writers } from '../js/core/contract.js';
import { sanitizeContractStyle, CONTRACT_STYLE } from '../js/core/theme.js';
import { restoreContract, widthOf, nearestWidth, TEXT_DEFAULTS, TEXTS, translateForm } from '../js/core/schema.js';
import { setLang } from '../js/core/i18n.js';

const FAST = 1000;   // passaggi PBKDF2 ridotti nei test (in produzione 600.000)

/* ─── Cifratura ─── */
test('chiave dell\'etichetta: si apre con la password e con il codice di recupero, non con altro', async () => {
  const { record, privateKey, recoveryCode } = await C.createLabelKey('una password lunga e sicura', 100000);
  assert.equal(C.checkLabelRecord(record), record);
  assert.ok(C.isRecoveryCodeShape(recoveryCode));
  const pub = await C.importLabelPublic(record.pub);
  const sealed = await C.sealTextForLabel(pub, 'segreto');
  assert.equal(await C.openTextForLabel(privateKey, sealed), 'segreto');
  const k1 = await C.unlockLabelKey(record, 'una password lunga e sicura');
  assert.equal(await C.openTextForLabel(k1, sealed), 'segreto');
  const k2 = await C.unlockLabelKeyWithRecovery(record, recoveryCode.toLowerCase().replace(/-/g, ' '));
  assert.equal(await C.openTextForLabel(k2, sealed), 'segreto');
  await assert.rejects(C.unlockLabelKey(record, 'sbagliata'), C.WrongSecret);
  await assert.rejects(C.unlockLabelKeyWithRecovery(record, C.makeRecoveryCode()), C.WrongSecret);
  // la chiave privata in memoria non è esportabile
  await assert.rejects(globalThis.crypto.subtle.exportKey('pkcs8', k1));
  // cambio password e nuovo codice
  const r2 = await C.changeLabelPassphrase(record, 'una password lunga e sicura', 'nuova password ancora più lunga', { iter: 100000 });
  assert.equal(await C.openTextForLabel(await C.unlockLabelKey(r2, 'nuova password ancora più lunga'), sealed), 'segreto');
  await assert.rejects(C.unlockLabelKey(r2, 'una password lunga e sicura'), C.WrongSecret);
  const r3 = await C.changeLabelPassphrase(record, recoveryCode, 'dal codice di recupero', { useRecovery: true, iter: 100000 });
  assert.equal(await C.openTextForLabel(await C.unlockLabelKey(r3, 'dal codice di recupero'), sealed), 'segreto');
  const { record: r4, code } = await C.newLabelRecoveryCode(record, 'una password lunga e sicura');
  assert.notEqual(code, recoveryCode);
  assert.equal(await C.openTextForLabel(await C.unlockLabelKeyWithRecovery(r4, code), sealed), 'segreto');
  await assert.rejects(C.unlockLabelKeyWithRecovery(r4, recoveryCode), C.WrongSecret);
  assert.match(await C.keyFingerprint(record.pub), /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
});

test('invio dell\'artista: etichetta e artista aprono, i dati sono legati all\'invito', async () => {
  const { record, privateKey } = await C.createLabelKey('pass etichetta lunga', 100000);
  const pub = await C.importLabelPublic(record.pub);
  const dk = await C.newDataKey();
  const forLabel = await C.wrapDataKeyForLabel(pub, dk.raw);
  const salt = C.newSalt();
  const a1 = await C.artistSecret('password artista 2026!', salt, FAST);
  const forArtist = await C.wrapDataKeyForArtist(a1.kek, dk.raw);
  const data = { bio: 'Techno da Milano', iban: 'IT60X0542811101000000123456', lista: [1, 2, 3] };
  const sealed = await C.sealJson(dk.key, data, C.partAad('main', 'inv-1'));
  assert.ok(!sealed.ct.includes('Techno'));

  const kLabel = await C.unwrapDataKeyForLabel(privateKey, forLabel);
  assert.deepEqual(await C.openJson(kLabel, sealed, C.partAad('main', 'inv-1')), data);
  // stessa password → stessa prova e stessa chiave
  const a2 = await C.artistSecret('password artista 2026!', salt, FAST);
  assert.equal(a2.verifier, a1.verifier);
  const kArtist = await C.unwrapDataKeyForArtist(a2.kek, forArtist);
  assert.deepEqual(await C.openJson(kArtist, sealed, C.partAad('main', 'inv-1')), data);
  // password sbagliata
  const bad = await C.artistSecret('password sbagliata!!', salt, FAST);
  assert.notEqual(bad.verifier, a1.verifier);
  await assert.rejects(C.unwrapDataKeyForArtist(bad.kek, forArtist), C.WrongSecret);
  // dati spostati su un altro invito o su un'altra parte: non si aprono
  await assert.rejects(C.openJson(kLabel, sealed, C.partAad('main', 'inv-2')), C.BadData);
  await assert.rejects(C.openJson(kLabel, sealed, C.partAad('contract', 'inv-1')), C.BadData);
  // codice del link
  const t = C.makeToken();
  assert.ok(C.isTokenShape(t));
  assert.equal(await C.openTextForLabel(privateKey, await C.sealTextForLabel(pub, t)), t);
});

test('robustezza password e JSON canonico', () => {
  assert.notEqual(C.passwordProblem('corta'), '');
  assert.notEqual(C.passwordProblem('1234567890'), '');
  assert.equal(C.passwordProblem('Viola-Notte-Sintetizzatore'), '');
  assert.equal(C.canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
});

/* ─── Testo formattato ─── */
test('testo formattato: tiene solo ciò che è permesso', () => {
  const doc = sanitizeRich([
    { t: 'p', c: [{ x: 'Ciao ', b: 1 }, { x: 'mondo', b: 1 }, { x: '<script>', h: 'javascript:alert(1)' }, { x: 'blu', k: '#0000FF' }, { x: 'rosso', k: 'red;background:url(x)' }] },
    { t: 'script', c: [{ x: 'no' }] },
    { t: 'ul', li: [[{ x: 'uno' }], [], [{ x: 'due', h: 'https://drive.google.com/x' }]] },
    { t: 'h1', a: 'c', c: [{ f: '$label' }, { f: 'bad id!' }] },
  ]);
  assert.deepEqual(doc[0].c[0], { x: 'Ciao mondo', b: 1 });
  assert.deepEqual(doc[0].c[1], { x: '<script>' });
  assert.deepEqual(doc[0].c[2], { x: 'blu', k: '#0000ff' });
  assert.deepEqual(doc[0].c[3], { x: 'rosso' });
  assert.equal(doc.length, 3);
  assert.equal(doc[1].li.length, 2);
  assert.equal(doc[1].li[1][0].h, 'https://drive.google.com/x');
  assert.deepEqual(doc[2], { t: 'h1', a: 'c', c: [{ f: '$label' }] });
  assert.equal(richToText(doc, { $label: 'SC' }), 'Ciao mondo<script>bluroso'.replace('roso', 'rosso') + '\n\n• uno\n• due\n\nSC');
  assert.deepEqual(placeholdersIn(doc), ['$label']);
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref('https://user:pw@x.com'), '');
  assert.equal(safeHref('mailto:a@b.it'), 'mailto:a@b.it');
  assert.deepEqual(fromPlain('a\nb\n\nc'), [{ t: 'p', c: [{ x: 'a' }, { br: 1 }, { x: 'b' }] }, { t: 'p', c: [{ x: 'c' }] }]);
  assert.ok(isEmptyRich([{ t: 'p', c: [{ x: '   ' }] }]));
  assert.ok(!isEmptyRich(fromPlain('x')));
  assert.deepEqual(sanitizeRich('<b>ciao</b>'), [{ t: 'p', c: [{ x: '<b>ciao</b>' }] }]);
});

/* ─── Link ─── */
test('link: provider giusti, errori di battitura, link sbagliati', () => {
  assert.ok(checkLink('https://drive.google.com/drive/folders/1AbC?usp=sharing', 'files').ok);
  assert.ok(checkLink('drive.google.com/file/d/123/view', 'audio').ok);
  assert.equal(checkLink('drive.google.com/file/d/123/view', 'audio').url, 'https://drive.google.com/file/d/123/view');
  assert.ok(checkLink('https://www.dropbox.com/scl/fi/abc/track.wav?rlkey=xyz&dl=0', 'audio').url.includes('rlkey=xyz'));
  assert.match(checkLink('https://drive.gogle.com/file/d/1', 'files').error, /drive\.google\.com/);
  assert.match(checkLink('https://soundclod.com/artista', 'social').error, /soundcloud\.com/);
  assert.equal(typoSuggestion('dropbx.com'), 'dropbox.com');
  assert.equal(typoSuggestion('example.org'), '');
  assert.match(checkLink('https://drive.google.com/drive/my-drive', 'files').error, /pagina di Drive/);
  assert.match(checkLink('https://www.dropbox.com/home', 'files').error, /pagina di Dropbox/);
  assert.match(checkLink('https://instagram.com/artista', 'files').error, /Instagram/);
  assert.match(checkLink('https://example.com/x', 'files').error, /accetta/);
  assert.ok(checkLink('https://example.com/x', 'any').ok);
  assert.match(checkLink('https://wetransfer.com/downloads/abc', 'files').warning, /scadono/);
  assert.ok(!checkLink('javascript:alert(1)', 'any').ok);
  assert.ok(!checkLink('https://a.com https://b.com', 'any').ok);
  assert.ok(!checkLink('ciao', 'any').ok);
  assert.equal(checkLink('https://instagram.com/artista?igsh=abc&utm_source=x', 'social').url, 'https://instagram.com/artista');
  assert.ok(checkLink('https://artista.bandcamp.com/album/x', 'music').ok);
  assert.ok(checkLink('http://soundcloud.com/artista/traccia/s-PRIVATO', 'audio').url.startsWith('https://'));
});

/* ─── Aspetto ─── */
test('tema: valori controllati, immagini solo come data URL di immagini', () => {
  const t = sanitizeTheme({ bg: 'red', accent: '#ABCDEF', titleFont: 'comic', radius: 99, header: 'data:text/html;base64,AAAA', size: 'xl' });
  assert.equal(t.bg, '#0b0c11');
  assert.equal(t.accent, '#abcdef');
  assert.equal(t.titleFont, 'syne');
  assert.equal(t.radius, 28);
  assert.equal(t.header, '');
  assert.equal(t.size, 'm');
  assert.equal(safeImage('data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(safeImage('data:image/svg+xml;base64,PHN2Zz4='), '');
  const v = themeVars(applyPreset(t, 'carta'));
  assert.equal(v['--f-bg'], '#f3efe7');
  assert.equal(v['--f-scheme'], 'light');
  assert.equal(onColor('#c6ff3d'), '#111111');
  assert.equal(onColor('#6d28d9'), '#ffffff');
});

/* ─── Modulo ─── */
test('modulo: pulizia, id unici, tipi e limiti', () => {
  const f = sanitizeForm({
    title: 'x'.repeat(500),
    sections: [
      { id: 's_uno', title: 'A', fields: [
        { id: 'f_dup', type: 'short', label: 'Uno' },
        { id: 'f_dup', type: 'short', label: 'Due' },
        { id: 'BAD ID', type: 'email', label: 'Tre' },
        { type: 'hack', label: 'no' },
        { type: 'choice', label: 'Scegli', options: ['a', 'a', '', 'b'] },
        { type: 'group', label: 'G', fields: [{ type: 'group' }, { type: 'info' }, { type: 'number', label: 'n', min: 10, max: 2 }] },
        { id: '$label', type: 'short', label: 'riservato' },
      ] },
    ],
  });
  assert.equal(f.title.length, 200);
  const ids = f.sections[0].fields.map(x => x.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(i => ID_RE.test(i)));
  assert.equal(f.sections[0].fields.length, 6);
  assert.deepEqual(f.sections[0].fields[3].options, ['a', 'b']);
  const g = f.sections[0].fields[4];
  assert.equal(g.fields.length, 1);
  assert.deepEqual([g.fields[0].min, g.fields[0].max], [2, 10]);
  assert.notEqual(f.sections[0].fields[5].id, '$label');
  assert.equal(sanitizeForm(null).sections.length, 1);
  assert.equal(blankForm().sections[0].fields.length, 1);
});

test('modulo predefinito "Consegna release" è valido e stabile', () => {
  const f = defaultForm();
  assert.deepEqual(sanitizeForm(JSON.parse(JSON.stringify(f))), f);
  assert.equal(f.sections.length, 5);
  assert.ok(f.sections[4].contract);
  assert.ok(f.contract.enabled);
  const iban = f.sections[4].fields.find(x => x.type === 'iban');
  assert.ok(iban.sensitive);
  assert.ok(fieldById(f, f.sections[2].fields[0].fields[2].id));
});

/* ─── Risposte ─── */
test('IBAN, codice fiscale, partita IVA', () => {
  assert.ok(A.ibanOk('IT60 X054 2811 1010 0000 0123 456'));
  assert.ok(!A.ibanOk('IT60X0542811101000000123457'));
  assert.ok(A.ibanOk('DE89370400440532013000'));
  assert.ok(!A.ibanOk('DE8937040044053201300'));
  assert.ok(A.italianCfOk('RSSMRA85T10A562S'));
  assert.ok(!A.italianCfOk('RSSMRA85T10A562T'));
  assert.equal(A.taxIdProblem('rssmra85t10a562s'), '');
  assert.notEqual(A.taxIdProblem('RSSMRA85T10A562T'), '');
  assert.equal(A.taxIdProblem('IT01114601006'), '');
  assert.notEqual(A.taxIdProblem('01114601007'), '');
  assert.equal(A.taxIdProblem('12345678Z'), '');           // NIF spagnolo: formato libero
  assert.notEqual(A.taxIdProblem('x'), '');
  assert.equal(A.formatIban('it60x0542811101000000123456'), 'IT60 X054 2811 1010 0000 0123 456');
});

test('risposte: controlli, completezza, differenze, maschere', () => {
  const f = defaultForm('it');
  const [art, press, tracks, , contract] = f.sections;
  const tg = tracks.fields[0];
  const [tTitle, , tLink, tBpm, , tSplit] = tg.fields;
  const ans = {
    [art.fields[0].id]: 'DJ Prova',
    [art.fields[1].id]: 'dj@prova.it',
    [art.fields[3].id]: 'Bio',
    [press.fields[0].id]: 'https://drive.google.com/drive/folders/abc',
    [tg.id]: [{ [tTitle.id]: 'Uno', [tLink.id]: 'https://drive.google.com/file/d/1', [tBpm.id]: '128,5', [tSplit.id]: [{ name: 'A', role: 'Autore', pct: '60' }, { name: 'B', pct: '40' }] }],
  };
  assert.deepEqual(A.sectionProblems(art, ans), {});
  assert.deepEqual(A.sectionProblems(tracks, ans), {});
  const p2 = A.sectionProblems(tracks, { [tg.id]: [{ [tTitle.id]: 'x', [tLink.id]: 'https://gogle.com', [tBpm.id]: '500', [tSplit.id]: [{ name: 'A', pct: '50' }] }] });
  assert.ok(p2[`${tg.id}.0.${tLink.id}`]);
  assert.match(p2[`${tg.id}.0.${tBpm.id}`], /massimo/i);
  assert.match(p2[`${tg.id}.0.${tSplit.id}`], /100/);
  assert.match(A.sectionProblems(tracks, {})[tg.id], /Aggiungi/);
  const cp = A.sectionProblems(contract, {});
  assert.ok(Object.keys(cp).length >= 4);

  const filled = A.filledIds(f, ans);
  assert.ok(filled.includes(tg.id) && filled.includes(press.fields[0].id) && !filled.includes(f.sections[3].fields[0].id));
  const ans2 = structuredClone(ans);
  ans2[art.fields[3].id] = 'Bio nuova';
  ans2[tg.id][0][tBpm.id] = '130';
  assert.deepEqual(A.changedIds(f, ans, ans2), [art.fields[3].id, tg.id]);
  assert.deepEqual(A.changedIds(f, ans, { ...ans, [art.fields[2].id]: '' }), []);

  const { main, contract: c } = A.splitAnswers(f, { ...ans, [contract.fields[4].id]: 'it60 x054 2811 1010 0000 0123 456', zzz: 'non nel modulo' });
  assert.equal(c[contract.fields[4].id], 'IT60X0542811101000000123456');
  assert.ok(!('zzz' in main) && !(contract.fields[4].id in main));
  assert.equal(A.formatValue(contract.fields[4], c[contract.fields[4].id], { mask: true }), 'IT•• •••• 3456');
  assert.equal(A.formatValue(tBpm, '128,5'), '128,5');
  assert.equal(A.formatValue(tSplit, ans[tg.id][0][tSplit.id]), 'A (Autore) 60% · B 40%');
  assert.match(A.formatValue(tg, ans[tg.id]), /^Traccia 1: Titolo: Uno/);
  assert.equal(A.summaryRows(f, ans, { skipEmpty: true }).length, 5);
});

/* ─── Contratto ─── */
test('contratto: segnaposto, copia congelata e impronta', async () => {
  const f = defaultForm();
  const tg = f.sections[2].fields[0];
  const name = f.sections[4].fields[0];
  const answers = { [tg.id]: [{ [tg.fields[0].id]: 'Uno', [tg.fields[1].id]: 'Original Mix' }, { [tg.fields[0].id]: 'Due' }], [name.id]: 'Mario Rossi' };
  assert.deepEqual(trackTitles(f, answers), ['Uno (Original Mix)', 'Due']);
  const ctx = { label: 'SUBCONSCIOUS Culture', release: 'Night EP', catalog: 'SSSCLTR005', artist: 'DJ Prova', artistPct: 60 };
  const v = contractValues(f, answers, ctx, '2026-11-05');
  assert.equal(v.$labelPct, '40');
  assert.equal(v.$date, '05/11/2026');
  assert.equal(v[name.id], 'Mario Rossi');
  const filled = fillContract(f.contract.body, v);
  const text = filled.map(b => (b.c || []).map(p => p.x).join('')).join('\n');
  assert.ok(text.includes('60% (sixty percent) to the Artist and 40% (forty percent) to the Label'));
  const copy = fillContract(f.contract.copy, v, '—').map(b => (b.c || []).map(p => p.x).join('')).join('\n');
  assert.ok(copy.includes('Title(s): Uno (Original Mix), Due'));
  assert.ok(copy.includes('Full Name: Mario Rossi'));
  assert.ok(copy.includes('Written by: —'));
  const snap = contractSnapshot({ form: f, answers, ctx, inviteId: 'i1', signature: { name: 'Mario Rossi', place: 'Milano', date: '2026-11-05', time: '10:00', png: 'data:image/png;base64,AAAA' } });
  const h = await contractHash(snap);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.ok(await verifyContract(JSON.parse(JSON.stringify(snap)), h));
  const tampered = structuredClone(snap);
  tampered.text = tampered.text.replace('60%', '10%');
  assert.ok(!(await verifyContract(tampered, h)));
  // anche la forma è coperta dall'impronta
  const restyled = structuredClone(snap); restyled.style.size = 9;
  assert.ok(!(await verifyContract(restyled, h)));
  assert.equal(snap.v, 2);
  assert.equal(snap.artistRole, 'For the Artist — Mario Rossi');
  assert.equal(snap.labelRole, 'For the Label — SUBCONSCIOUS Culture');
  assert.equal(snap.dateText, '05/11/2026');
});

test('contratto: numeri in lettere, autori dai crediti, formattazione e ripristino', () => {
  assert.deepEqual([0, 7, 19, 20, 33, 50, 66, 99, 100, 150].map(numWord), ['zero', 'seven', 'nineteen', 'twenty', 'thirty-three', 'fifty', 'sixty-six', 'ninety-nine', 'one hundred', 'one hundred']);
  const f = defaultForm();
  const tg = f.sections[2].fields[0];
  const sp = tg.fields.find(x => x.type === 'split');
  const a = { [tg.id]: [{ [sp.id]: [{ name: 'Mario Rossi', role: 'Autore', pct: '50' }, { name: 'Luca', role: 'Produttore', pct: '50' }] }, { [sp.id]: [{ name: 'Mario Rossi', role: 'Compositore', pct: '100' }] }] };
  assert.equal(writers(f, a), 'Mario Rossi');
  assert.equal(writers(f, { [tg.id]: [{ [sp.id]: [{ name: 'Anna', role: 'Remixer', pct: '100' }] }] }), 'Anna');
  const st = sanitizeContractStyle({ font: 'comic', size: 99, accent: 'red', logoPos: 'x', line: 10 });
  assert.equal(st.font, CONTRACT_STYLE.font);
  assert.equal(st.size, 20);
  assert.equal(st.accent, CONTRACT_STYLE.accent);
  assert.equal(st.logoPos, 'r');
  assert.equal(st.line, 110);
  const changedC = { ...f.contract, body: [], title: 'X', style: { ...f.contract.style, size: 10 } };
  const r = sanitizeForm({ ...f, contract: restoreContract(changedC, f.sections) }).contract;
  assert.deepEqual(r.body, f.contract.body);
  assert.equal(r.title, f.contract.title);
  assert.equal(r.style.size, CONTRACT_STYLE.size);
  // un contratto salvato prima della nuova impaginazione diventa quello completo, con la pagina dei dati
  const old = sanitizeForm({ ...f, contract: { enabled: true, title: 'Vecchio', body: [{ t: 'h2', c: [{ x: '1. Declaration of ownership of rights' }] }] } }).contract;
  assert.equal(old.layout, 2);
  assert.equal(old.title, f.contract.title);
  assert.ok(old.copy.length > 5);
  const custom = sanitizeForm({ ...f, contract: { enabled: true, title: 'Mio', body: [{ t: 'p', c: [{ x: 'Testo mio' }] }] } }).contract;
  assert.equal(custom.title, 'Mio');
  assert.equal(custom.body.length, 1);
});

test('modulo: larghezze, immagini, separatori e testi della pagina', () => {
  assert.equal(widthOf({ half: true }), 50);
  assert.equal(widthOf({ w: 33 }), 33);
  assert.equal(widthOf({ w: 40 }), 100);
  assert.equal(nearestWidth(30), 33);
  assert.equal(nearestWidth(71), 67);
  const f = sanitizeForm({
    texts: { next: 'Vai avanti', send: '', back: 'Back', hacker: 'x' }, show: { progress: false, hello: 'no' },
    sections: [{ fields: [
      { type: 'image', src: 'data:image/svg+xml;base64,PHN2Zz4=', radius: 999, w: 50 },
      { type: 'image', src: 'data:image/png;base64,iVBORw0KGgo=', align: 'z' },
      { type: 'divider', style: 'boh', size: -5 },
      { type: 'long', label: 'Bio', rows: 99, w: 67, hideLabel: true },
    ] }],
  });
  const [img1, img2, div, bio] = f.sections[0].fields;
  assert.equal(img1.src, '');
  assert.equal(img1.radius, 60);
  assert.equal(img1.w, 50);
  assert.equal(img2.align, 'c');
  assert.equal(div.style, 'line');
  assert.equal(div.size, 0);
  assert.equal(bio.rows, 30);
  assert.equal(bio.w, 67);
  assert.ok(bio.hideLabel);
  assert.equal(f.texts.next, 'Vai avanti');
  assert.equal(f.texts.send, TEXT_DEFAULTS.send);
  assert.equal(f.texts.back, 'Indietro');   // un testo di partenza (anche se in inglese) segue la lingua del modulo
  assert.ok(!('hacker' in f.texts));
  assert.equal(f.show.progress, false);
  assert.equal(f.show.hello, true);
  // immagini e separatori non hanno risposte
  assert.deepEqual(A.filledIds(f, { [img2.id]: 'x', [bio.id]: 'ciao' }), [bio.id]);
  assert.equal(A.fieldProblem(div, undefined), '');
  assert.deepEqual(Object.keys(A.cleanAnswers(f, { [img2.id]: 'x', [div.id]: 'y' })), [bio.id]);
});

test('lingua: il modulo nasce in inglese, si traduce e i messaggi seguono la lingua', () => {
  const en = defaultForm();
  assert.equal(en.lang, 'en');
  assert.equal(en.title, 'Release delivery');
  assert.equal(en.texts.next, TEXTS.en.next);
  assert.equal(en.sections[4].fields[0].label, 'Full name');
  // il vecchio modulo di partenza in italiano, mai ritoccato, passa all'inglese; un testo riscritto resta
  const old = JSON.parse(JSON.stringify(defaultForm('it')));
  delete old.lang;
  old.sections[0].fields[3].label = 'La tua bio';
  const mig = sanitizeForm(old);
  assert.equal(mig.lang, 'en');
  assert.equal(mig.title, 'Release delivery');
  assert.equal(mig.sections[0].fields[0].label, 'Artist name');
  assert.equal(mig.sections[0].fields[3].label, 'La tua bio');
  assert.equal(mig.texts.send, 'Submit');
  // un modulo scritto a mano senza lingua resta in italiano
  assert.equal(sanitizeForm({ title: 'Il mio modulo' }).lang, 'it');
  // da inglese a italiano e ritorno
  const it = sanitizeForm(translateForm(en, 'en', 'it'));
  assert.equal(it.title, 'Consegna release');
  assert.equal(it.texts.back, 'Indietro');
  assert.deepEqual(sanitizeForm(translateForm(it, 'it', 'en')).sections.map(x => x.title), en.sections.map(x => x.title));
  // messaggi
  const req = { type: 'short', required: true, maxLength: 10 };
  setLang('en');
  assert.equal(A.fieldProblem(req, ''), 'This field is required.');
  assert.match(checkLink('ciao').error, /must start with https/);
  assert.equal(C.passwordProblem('corta'), 'At least 10 characters.');
  setLang('it');
  assert.equal(A.fieldProblem(req, ''), 'Campo obbligatorio.');
  assert.match(checkLink('ciao').error, /deve iniziare con https/);
});
