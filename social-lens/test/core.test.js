/* Prove del motore di Social Lens: TZ=Europe/Rome node --test test/ */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const L = require('../core.js');

const DAY = 86400000;
const NOW = new Date(2026, 10, 5, 15, 0).getTime(); // 5 novembre 2026, 15:00

test('testo dell\'export: lettere accentate ed emoji tornano a posto', () => {
  const broken = Buffer.from('Città 🎧 è', 'utf8').toString('latin1');
  assert.equal(L.fixText(broken), 'Città 🎧 è');
  assert.equal(L.fixText('normale'), 'normale');
  assert.equal(L.fixText('già giusto è'), 'già giusto è');
  const j = L.parseJSON(JSON.stringify({ a: broken }));
  assert.equal(j.a, 'Città 🎧 è');
});

test('nomi utente dai link', () => {
  assert.equal(L.userFromHref('https://www.instagram.com/mario.rossi'), 'mario.rossi');
  assert.equal(L.userFromHref('https://www.instagram.com/_u/mario_rossi/'), 'mario_rossi');
  assert.equal(L.userFromHref('https://www.instagram.com/p/ABC123/'), '');
  assert.equal(L.userFromHref('https://www.instagram.com/stories/anna/123'), 'anna');
});

function exportFiles() {
  const broken = (s) => Buffer.from(s, 'utf8').toString('latin1');
  return [
    // formato classico
    { path: 'connections/followers_and_following/followers_1.json', text: JSON.stringify([
      { title: '', media_list_data: [], string_list_data: [{ href: 'https://www.instagram.com/anna', value: 'anna', timestamp: 1700000000 }] },
      { title: '', media_list_data: [], string_list_data: [{ href: 'https://www.instagram.com/bruno', value: 'bruno', timestamp: 1710000000 }] },
      { title: '', media_list_data: [], string_list_data: [{ href: 'https://www.instagram.com/carla', value: 'carla', timestamp: 1720000000 }] },
    ]) },
    { path: 'connections/followers_and_following/followers_2.json', text: JSON.stringify([
      { title: '', string_list_data: [{ href: 'https://www.instagram.com/dario', value: 'dario', timestamp: 1730000000 }] },
      { title: '', string_list_data: [{ href: 'https://www.instagram.com/anna', value: 'anna', timestamp: 1700000000 }] },
    ]) },
    // formato nuovo: il nome sta nel titolo, niente "value"
    { path: 'connections/followers_and_following/following.json', text: JSON.stringify({ relationships_following: [
      { title: 'anna', string_list_data: [{ href: 'https://www.instagram.com/_u/anna', timestamp: 1700000100 }] },
      { title: 'enzo', string_list_data: [{ href: 'https://www.instagram.com/_u/enzo', timestamp: 1730000100 }] },
      { title: 'Bruno', string_list_data: [{ href: 'https://www.instagram.com/_u/bruno', timestamp: 1710000100 }] },
    ] }) },
    { path: 'connections/followers_and_following/recently_unfollowed_profiles.json', text: JSON.stringify({ relationships_unfollowed_users: [{ title: '', string_list_data: [{ href: 'https://www.instagram.com/franco', value: 'franco', timestamp: 1731000000 }] }] }) },
    { path: 'your_instagram_activity/content/posts_1.json', text: JSON.stringify([
      { media: [{ uri: 'a.jpg', creation_timestamp: 1730000000, title: broken('Ciao #Musica è bello') }] },
      { media: [{ uri: 'a.jpg', creation_timestamp: 1731000000, title: '' }, { uri: 'b.mp4', creation_timestamp: 1731000000, title: '' }], title: 'Carosello #live', creation_timestamp: 1731000000 },
      { media: [{ uri: 'v.mp4', creation_timestamp: 1732000000, title: 'Video' }] },
    ]) },
    { path: 'your_instagram_activity/content/reels.json', text: JSON.stringify({ ig_reels_media: [{ media: [{ uri: 'r.mp4', creation_timestamp: 1733000000, title: 'Reel #musica' }] }] }) },
    { path: 'your_instagram_activity/content/stories.json', text: JSON.stringify({ ig_stories: [{ uri: 's.jpg', creation_timestamp: 1733000000, title: '' }] }) },
    // mi piace: un elemento nel formato classico e uno con label_values
    { path: 'your_instagram_activity/likes/liked_posts.json', text: JSON.stringify({ likes_media_likes: [
      { title: 'anna', string_list_data: [{ href: 'https://www.instagram.com/p/x/', value: '👍', timestamp: 1730000000 }] },
      { timestamp: 1730000500, media: [], label_values: [{ label: 'URL', value: 'https://www.instagram.com/p/y/' }, { title: 'Owner', dict: [{ dict: [{ label: 'URL', value: 'https://www.instagram.com/anna' }, { label: 'Name', value: 'Anna' }, { label: 'Username', value: 'anna' }] }] }] },
      { timestamp: 1730000600, label_values: [{ label: 'URL', value: 'https://www.instagram.com/p/z/' }, { title: 'Owner', dict: [{ dict: [{ label: 'Username', value: 'bruno' }] }] }] },
    ] }) },
    { path: 'your_instagram_activity/comments/post_comments_1.json', text: JSON.stringify([
      { string_map_data: { Comment: { value: 'Bello!' }, 'Media Owner': { value: 'carla' }, Time: { timestamp: 1730000000 } } },
      { string_map_data: { Commento: { value: 'Forte' }, 'Proprietario del contenuto multimediale': { value: 'carla' }, Ora: { timestamp: 1730000100 } } },
    ]) },
    { path: 'personal_information/personal_information/personal_information.json', text: JSON.stringify({ profile_user: [{ string_map_data: { Username: { value: 'io.stesso' }, Name: { value: broken('Mattìa') } } }] }) },
    { path: 'your_instagram_activity/messages/inbox/anna_123/message_1.json', text: JSON.stringify({ participants: [{ name: 'Anna' }, { name: 'Io' }], title: 'Anna', messages: [{ sender_name: 'Anna', timestamp_ms: 1730000000000, content: 'ciao' }, { sender_name: 'Io', timestamp_ms: 1730000500000 }] }) },
    { path: 'media/posts/202410/a.jpg', text: 'non json' },
  ];
}

test('export: follower, seguiti, non ricambiano, fan, reciproci', () => {
  const R = L.parseExport(exportFiles());
  assert.equal(R.followers.length, 4, 'anna compare due volte ma conta una');
  assert.deepEqual(R.following.map((x) => x.u).sort(), ['anna', 'bruno', 'enzo']);
  const X = L.analyzeExport(R, null, NOW);
  assert.deepEqual(X.lists.notBack.map((x) => x.u), ['enzo']);
  assert.deepEqual(X.lists.fans.map((x) => x.u).sort(), ['carla', 'dario']);
  assert.deepEqual(X.lists.mutual.map((x) => x.u).sort(), ['anna', 'bruno']);
  assert.equal(X.counts.unfollowed, 1);
  assert.equal(R.owner.username, 'io.stesso');
  assert.equal(R.owner.name, 'Mattìa');
});

test('export: post, reel, storie, mi piace, commenti, messaggi', () => {
  const R = L.parseExport(exportFiles());
  assert.equal(R.posts.length, 4);
  assert.deepEqual(R.posts.map((p) => p.type), ['image', 'carousel', 'video', 'reel']);
  assert.equal(R.posts[0].caption, 'Ciao #Musica è bello');
  assert.equal(R.posts[1].caption, 'Carosello #live');
  assert.equal(R.stories.length, 1);
  assert.deepEqual(R.likes.map((x) => x.u), ['anna', 'anna', 'bruno']);
  assert.equal(R.comments.length, 2);
  assert.ok(R.comments.every((c) => c.u === 'carla'));
  const X = L.analyzeExport(R, null, NOW);
  assert.equal(X.topLiked[0].k, 'anna');
  assert.equal(X.topLiked[0].n, 2);
  assert.equal(X.tags[0].k, 'musica');
  assert.equal(X.tags[0].n, 2);
  assert.equal(X.threads[0].n, 2);
  assert.equal(X.counts.posts, 3);
  assert.equal(X.counts.reels, 1);
});

test('export: confronto con quello precedente (chi ha smesso di seguirti)', () => {
  const R = L.parseExport(exportFiles());
  const prev = { owner: 'io.stesso', at: NOW - 30 * DAY, list: ['anna', 'bruno', 'zeta'] };
  const X = L.analyzeExport(R, prev, NOW);
  assert.deepEqual(X.diff.lost, ['zeta']);
  assert.deepEqual(X.diff.gained.sort(), ['carla', 'dario']);
  // export di un altro account: niente confronto
  assert.equal(L.analyzeExport(R, { owner: 'altro', at: 1, list: [] }, NOW).diff, null);
});

test('export in HTML viene riconosciuto', () => {
  const R = L.parseExport([{ path: 'connections/followers_and_following/followers_1.html', text: '<html>' }]);
  assert.equal(R.files, 0);
  assert.equal(R.html, true);
});

function makeZip(dir, files, zip64) {
  for (const f of files) { const p = path.join(dir, 'src', f.path); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.text); }
  const out = path.join(dir, 'export.zip');
  const py = `
import zipfile, os, sys
src, out, z64 = sys.argv[1], sys.argv[2], sys.argv[3] == '1'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _, names in os.walk(src):
        for n in sorted(names):
            p = os.path.join(root, n); arc = os.path.relpath(p, src)
            if arc.endswith('.jpg'):
                z.write(p, arc, compress_type=zipfile.ZIP_STORED)
            else:
                with open(p, 'rb') as fh, z.open(arc, 'w', force_zip64=z64) as w:
                    w.write(fh.read())
`;
  execFileSync('python3', ['-c', py, path.join(dir, 'src'), out, zip64 ? '1' : '0']);
  return out;
}

for (const zip64 of [false, true]) {
  test('ZIP dell\'export letto senza librerie' + (zip64 ? ' (ZIP64)' : ''), async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-lens-'));
    const files = exportFiles();
    files.push({ path: 'media/big.jpg', text: 'x'.repeat(200000) });
    const zipPath = makeZip(dir, files, zip64);
    const blob = new Blob([fs.readFileSync(zipPath)]);
    let calls = 0;
    const { files: read, total } = await L.readExportZip(blob, () => calls++);
    assert.ok(total >= files.length);
    assert.ok(read.every((f) => !/\.jpg$/.test(f.path)), 'le foto non vengono lette');
    assert.ok(calls > 5);
    const R = L.parseExport(read);
    assert.equal(R.followers.length, 4);
    assert.equal(R.posts[0].caption, 'Ciao #Musica è bello');
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

test('lo ZIP non valido dà un errore chiaro', async () => {
  await assert.rejects(() => L.readExportZip(new Blob(['ciao'])), /ZIP/);
});

test('numeri scritti in tanti modi', () => {
  assert.equal(L.parseNum('1.234'), 1234);
  assert.equal(L.parseNum('1,234'), 1234);
  assert.equal(L.parseNum('1.234,5'), 1234.5);
  assert.equal(L.parseNum('1,234.5'), 1234.5);
  assert.equal(L.parseNum('2,5'), 2.5);
  assert.equal(L.parseNum('12,5K'), 12500);
  assert.equal(L.parseNum('1,2 mln'), 1200000);
  assert.equal(L.parseNum('3 mila'), 3000);
  assert.equal(L.parseNum('—'), null);
  assert.equal(L.parseNum(''), null);
  assert.equal(L.parseNum(42), 42);
});

test('date: API di Meta, italiano, americano, Unix', () => {
  assert.equal(L.parseDate('2026-11-03T18:30:00+0000'), Date.UTC(2026, 10, 3, 18, 30));
  assert.equal(L.parseDate('2026-11-03T18:30:00Z'), Date.UTC(2026, 10, 3, 18, 30));
  assert.equal(L.parseDate('03/11/2026 18:30'), new Date(2026, 10, 3, 18, 30).getTime());
  assert.equal(L.parseDate('11/03/2026 6:30 pm', 'mdy'), new Date(2026, 10, 3, 18, 30).getTime());
  assert.equal(L.parseDate('25/12/2025'), new Date(2025, 11, 25, 12).getTime());
  assert.equal(L.parseDate('1730000000'), 1730000000000);
  assert.equal(L.parseDate('boh'), null);
});

test('CSV di Meta Business Suite (inglese, mese/giorno)', () => {
  const csv = [
    'Post ID,Account ID,Account username,Account name,Description,Duration (sec),Publish time,Permalink,Post type,Data comment,Date,Views,Reach,Likes,Shares,Follows,Comments,Saves',
    '1,9,mio.profilo,Mio Profilo,"Nuovo singolo, fuori ora! #musica",15,11/03/2026 18:30,https://www.instagram.com/reel/a/,IG reel,,Lifetime,"12,400",8300,950,40,12,38,77',
    '2,9,mio.profilo,Mio Profilo,Foto del live,0,10/28/2026 13:05,https://www.instagram.com/p/b/,IG image,,Lifetime,3100,2500,410,5,1,9,11',
  ].join('\n');
  const r = L.csvToPosts(csv);
  assert.equal(r.posts.length, 2);
  assert.equal(r.meta.username, 'mio.profilo');
  const [a, b] = r.posts;
  assert.equal(a.ts, new Date(2026, 10, 3, 18, 30).getTime());
  assert.equal(b.ts, new Date(2026, 9, 28, 13, 5).getTime());
  assert.equal(a.type, 'reel'); assert.equal(b.type, 'image');
  assert.equal(a.likes, 950); assert.equal(a.comments, 38); assert.equal(a.views, 12400);
  assert.equal(a.reach, 8300); assert.equal(a.saves, 77); assert.equal(a.shares, 40);
  assert.equal(a.caption, 'Nuovo singolo, fuori ora! #musica');
});

test('CSV italiano con punto e virgola', () => {
  const csv = 'data;tipo;mi piace;commenti;visualizzazioni;didascalia\n03/11/2026 18:30;reel;1.250;48;15.400;Ciao\n31/10/2026;carosello;980;31;;\nriga senza data;;;;;\n';
  const r = L.csvToPosts(csv);
  assert.equal(r.posts.length, 2);
  assert.equal(r.posts[0].likes, 1250);
  assert.equal(r.posts[0].views, 15400);
  assert.equal(r.posts[1].type, 'carousel');
  assert.equal(r.posts[1].ts, new Date(2026, 9, 31, 12).getTime());
  assert.match(r.warnings[0], /1 riga/);
});

test('CSV senza colonne utili', () => {
  const r = L.csvToPosts('nome;cognome\nmario;rossi');
  assert.equal(r.posts.length, 0);
  assert.match(r.warnings[0], /colonne/);
});

function profile(posts, extra) {
  return Object.assign({ source: 'api', username: 'prova', name: 'Prova', bio: 'Una bio abbastanza lunga per contare', website: 'https://example.com', followers: 10000, following: 500, postsCount: 120, posts }, extra || {});
}

test('engagement rate, mediana e post freschi esclusi', () => {
  const posts = [];
  for (let i = 1; i <= 10; i++) posts.push({ id: 'p' + i, ts: NOW - i * 3 * DAY, type: 'image', likes: 200, comments: 10, caption: '' });
  posts.push({ id: 'nuovo', ts: NOW - 2 * 3600e3, type: 'reel', likes: 5, comments: 0, caption: '' });
  const A = L.analyze(profile(posts), NOW);
  assert.equal(A.n, 11);
  assert.equal(A.fresh, 1);
  assert.equal(A.avgLikes, 200);
  assert.equal(A.avgComments, 10);
  assert.equal(A.er, 2.1);
  assert.equal(A.tier.key, 'micro');
  assert.equal(A.rating.key, 'avg');
  assert.ok(Math.abs(A.c2l - 5) < 1e-9);
  assert.equal(A.lastAgo, 0);
});

test('mi piace nascosti: si contano solo i commenti', () => {
  const posts = [
    { ts: NOW - 2 * DAY, likes: null, comments: 30 },
    { ts: NOW - 4 * DAY, likes: 100, comments: 10 },
    { ts: NOW - 6 * DAY, likes: 300, comments: 20 },
  ];
  const A = L.analyze(profile(posts), NOW);
  assert.equal(A.likesHidden, 1);
  assert.equal(A.avgLikes, 200);
  assert.equal(A.avgComments, 20);
});

test('momento migliore, formati, hashtag, domande', () => {
  const posts = [];
  // giovedì alle 19 rende il triplo
  for (let w = 0; w < 8; w++) {
    const thu = new Date(2026, 9, 1 + w * 7, 19, 0).getTime(); // 1/10/2026 è giovedì
    const mon = new Date(2026, 9, 5 + w * 7, 9, 0).getTime();
    posts.push({ ts: thu, type: 'reel', likes: 900, comments: 30, caption: 'Che ne pensate? #tour #live' });
    posts.push({ ts: mon, type: 'image', likes: 300, comments: 10, caption: 'Buongiorno #live' });
  }
  const A = L.analyze(profile(posts), NOW);
  assert.equal(A.bestCell.d, 3); // giovedì
  assert.equal(A.bestCell.s, 6); // 18–21
  assert.equal(A.types[0].type, 'reel');
  assert.ok(A.types[0].lift > 0.4);
  assert.equal(A.tags[0].tag, 'live');
  assert.equal(A.bestTags[0].tag, 'tour');
  assert.ok(A.question.lift > 1);
  assert.ok(A.tips.some((t) => t.title === 'Il momento migliore' && /giovedì/.test(t.text)));
  assert.ok(A.score.total > 0 && A.score.total <= 100);
});

test('profilo fermo e poco attivo: consigli di avviso', () => {
  const posts = [];
  for (let i = 0; i < 8; i++) posts.push({ ts: NOW - (40 + i * 20) * DAY, type: 'image', likes: 20, comments: 0, caption: '#a #b #c #d #e #f #g #h #i #j #k #l #m #n #o #p' });
  const A = L.analyze(profile(posts, { website: '', bio: '' }), NOW);
  const titles = A.tips.map((t) => t.title);
  assert.ok(titles.includes('Profilo fermo'));
  assert.ok(titles.includes('Pubblichi poco'));
  assert.ok(titles.includes('Troppi hashtag'));
  assert.ok(titles.includes('Aggiungi un link'));
  assert.ok(titles.includes('Coinvolgimento da migliorare'));
  assert.ok(A.score.total < 40);
});

test('crescita dalle misure salvate', () => {
  const g = L.growthOf([{ at: NOW - 10 * DAY, followers: 1000 }, { at: NOW, followers: 1100 }, { at: NOW - 5 * DAY, followers: 1040 }]);
  assert.equal(g.delta, 100);
  assert.equal(g.pct, 10);
  assert.equal(g.perDay, 10);
  assert.equal(L.growthOf([{ at: 1, followers: 1 }]), null);
});

test('profilo d\'esempio: analisi completa senza errori', () => {
  for (const v of [1, 2]) {
    const A = L.analyze(L.demoProfile(v, NOW), NOW);
    assert.ok(A.n >= 40);
    assert.ok(A.er > 0);
    assert.ok(A.tips.length >= 3);
    assert.ok(A.bestCell);
    assert.ok(A.value.hi > A.value.lo);
  }
  const R = L.parseExport(L.demoExportFiles(NOW));
  assert.ok(R.followers.length > 300 && R.following.length > 300);
  assert.ok(L.analyzeExport(R, null, NOW).counts.notBack > 0);
});

test('esportazione CSV dei post', () => {
  const A = L.analyze(profile([{ ts: NOW - 3 * DAY, type: 'reel', likes: 10, comments: 2, caption: 'a;b "c" #x', url: 'https://i.g/1' }]), NOW);
  const csv = L.postsToCSV(A.posts);
  assert.ok(csv.startsWith('﻿Data;Tipo;'));
  assert.ok(csv.includes('"a;b ""c"" #x"'));
  assert.ok(csv.includes(';Reel;10;2;12;'));
});

/* ---------- API di Meta, con un finto server ---------- */
function fakeFetch(routes, log) {
  return async (url) => {
    const u = new URL(url);
    log && log.push(u);
    for (const [test, reply] of routes) {
      if (test(u)) {
        const r = typeof reply === 'function' ? reply(u) : reply;
        return { ok: !r.error, status: r.error ? 400 : 200, json: async () => r };
      }
    }
    return { ok: false, status: 404, json: async () => ({ error: { message: 'non previsto: ' + u.pathname, code: 100 } }) };
  };
}
const media = (i, extra) => Object.assign({ id: 'm' + i, caption: 'Post ' + i + ' #tag', like_count: 100 + i, comments_count: 5, timestamp: new Date(NOW - (i + 2) * DAY).toISOString().replace('.000Z', '+0000'), media_type: 'IMAGE', media_product_type: 'FEED', permalink: 'https://www.instagram.com/p/' + i + '/' }, extra || {});

test('API: profilo di un altro account, con paginazione', async () => {
  const log = [];
  const fetch = fakeFetch([
    [(u) => u.pathname.endsWith('/178') && /business_discovery/.test(u.searchParams.get('fields')), (u) => {
      const f = u.searchParams.get('fields');
      const after = (f.match(/after\(([^)]+)\)/) || [])[1];
      const start = after ? +after : 0;
      const data = Array.from({ length: start === 0 ? 50 : 20 }, (_, k) => media(start + k, start + k === 0 ? { media_type: 'VIDEO', media_product_type: 'REELS', view_count: 9000 } : {}));
      return { business_discovery: { username: 'altro', name: 'Altro', biography: 'Bio', followers_count: 5000, follows_count: 300, media_count: 70, profile_picture_url: 'https://cdn/x.jpg', media: { data, paging: { cursors: { after: String(start + data.length) } } } }, id: '178' };
    }],
  ], log);
  const api = L.makeApi({ token: 'EAAtest', fetch });
  const P = await api.discover('178', '@Altro', 100);
  assert.equal(P.username, 'altro');
  assert.equal(P.followers, 5000);
  assert.equal(P.posts.length, 70);
  assert.equal(P.posts[0].type, 'reel');
  assert.equal(P.posts[0].views, 9000);
  assert.equal(P.posts[0].ts, NOW - 2 * DAY);
  assert.equal(log.length, 2);
  assert.ok(log[0].href.startsWith('https://graph.facebook.com/v25.0/178?'));
  assert.equal(log[0].searchParams.get('access_token'), 'EAAtest');
  assert.match(log[0].searchParams.get('fields'), /business_discovery\.username\(altro\)/);
  assert.match(log[1].searchParams.get('fields'), /media\.after\(50\)\.limit\(50\)/);
});

test('API: se un campo non esiste si riprova con meno campi', async () => {
  let calls = 0;
  const fetch = fakeFetch([
    [(u) => /view_count/.test(u.searchParams.get('fields') || ''), () => { calls++; return { error: { message: '(#100) Tried accessing nonexisting field (view_count) on node type (Media)', code: 100 } }; }],
    [(u) => /business_discovery/.test(u.searchParams.get('fields') || ''), () => { calls++; return { business_discovery: { username: 'x', followers_count: 10, media: { data: [media(1)] } } }; }],
  ]);
  const P = await L.makeApi({ token: 'EAA1', fetch }).discover('1', 'x', 50);
  assert.equal(P.posts.length, 1);
  assert.equal(calls, 2);
});

test('API: errori spiegati in italiano', async () => {
  const fetch = fakeFetch([[() => true, { error: { message: 'Invalid OAuth access token', code: 190 } }]]);
  const err = await L.makeApi({ token: 'EAA1', fetch }).discover('1', 'x', 10).catch((e) => e);
  assert.ok(err instanceof L.ApiError);
  assert.match(L.explainError(err), /token/);
  assert.match(L.explainError(new L.ApiError({ message: 'Invalid user id', code: 110 }, 400)), /Business o Creator/);
  assert.match(L.explainError(new L.ApiError({ message: 'x', code: 4 }, 400)), /limite/);
  const offline = await L.makeApi({ token: 'EAA1', fetch: async () => { throw new TypeError('Failed to fetch'); } }).accounts().catch((e) => e);
  assert.match(L.explainError(offline), /connessione/);
});

test('API: token Instagram non può leggere altri profili', async () => {
  const api = L.makeApi({ token: 'IGAAxyz', fetch: fakeFetch([]) });
  assert.equal(api.base, 'https://graph.instagram.com');
  await assert.rejects(() => api.discover('1', 'x', 10), /EAA/);
});

test('API: account collegati alle Pagine', async () => {
  const fetch = fakeFetch([[(u) => u.pathname.endsWith('/me/accounts'), { data: [{ name: 'Pagina senza IG' }, { name: 'La mia pagina', instagram_business_account: { id: '1784', username: 'io', followers_count: 1200 } }] }]]);
  const acc = await L.makeApi({ token: 'EAA1', fetch }).accounts();
  assert.deepEqual(acc.map((a) => [a.id, a.username, a.page]), [['1784', 'io', 'La mia pagina']]);
});

test('API: il mio account con insights e dati demografici', async () => {
  const fetch = fakeFetch([
    [(u) => u.pathname.endsWith('/1784') , { username: 'io', name: 'Io', biography: 'b', followers_count: 2000, follows_count: 100, media_count: 3 }],
    [(u) => u.pathname.endsWith('/1784/media'), { data: [media(1), media(2), media(3, { media_product_type: 'REELS', media_type: 'VIDEO' })], paging: { cursors: { after: 'z' } } }],
    [(u) => /\/m3\/insights$/.test(u.pathname) && /total_interactions/.test(u.searchParams.get('metric')), { error: { message: 'metric not supported', code: 100 } }],
    [(u) => /\/m\d\/insights$/.test(u.pathname), (u) => ({ data: u.searchParams.get('metric').split(',').map((name) => ({ name, period: 'lifetime', values: [{ value: name === 'reach' ? 800 : name === 'saved' ? 12 : 3 }] })) })],
    [(u) => u.pathname.endsWith('/1784/insights') && u.searchParams.get('metric') === 'follower_demographics', (u) => ({ data: [{ name: 'follower_demographics', total_value: { breakdowns: [{ dimension_keys: [u.searchParams.get('breakdown')], results: u.searchParams.get('breakdown') === 'country' ? [{ dimension_values: ['US'], value: 100 }, { dimension_values: ['IT'], value: 900 }] : [] }] } }] })],
    [(u) => u.pathname.endsWith('/1784/insights') && u.searchParams.get('metric') === 'follower_count', { data: [{ name: 'follower_count', values: [{ value: 3, end_time: '2026-11-01T07:00:00+0000' }, { value: 5, end_time: '2026-11-02T07:00:00+0000' }] }] }],
    [(u) => u.pathname.endsWith('/1784/insights'), { data: [{ name: 'reach', total_value: { value: 15000 } }, { name: 'views', total_value: { value: 40000 } }] }],
  ]);
  const P = await L.makeApi({ token: 'EAA1', fetch }).own('1784', 50, true);
  assert.equal(P.own, true);
  assert.equal(P.posts.length, 3);
  assert.ok(P.posts.every((p) => p.reach === 800 && p.saves === 12));
  assert.deepEqual(P.insights.demographics.country.map((c) => c.k), ['IT', 'US']);
  assert.equal(P.insights.account.reach, 15000);
  assert.equal(P.insights.followerDays.length, 2);
  const A = L.analyze(P, NOW);
  assert.equal(A.ins.reach, 800);
  assert.equal(A.ins.reachRate, 40);
});
