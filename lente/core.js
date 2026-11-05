/* Lente — il motore dell'analisi (niente interfaccia).
   Nel browser diventa window.Lente, in Node si usa con require() per i test.
   Tutto gira sul dispositivo: nessun dato viene mandato a server nostri. */
(function (root) {
  'use strict';

  const DAY = 86400000;
  const DAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
  const DAYS_LONG = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];
  const SLOTS = ['0–3', '3–6', '6–9', '9–12', '12–15', '15–18', '18–21', '21–24'];
  const TYPE_LABEL = { image: 'Foto', carousel: 'Carosello', video: 'Video', reel: 'Reel', story: 'Storia' };

  /* ---------------- numeri e piccole utilità ---------------- */
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const sum = (a) => { let s = 0; for (const x of a) s += x; return s; };
  const mean = (a) => (a.length ? sum(a) / a.length : null);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  function median(a) {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function stdev(a) {
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(sum(a.map((x) => (x - m) * (x - m))) / (a.length - 1));
  }
  function countBy(items, key) {
    const m = new Map();
    for (const it of items) { const k = key(it); if (k) m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n || (a.k < b.k ? -1 : 1));
  }
  const pad2 = (n) => String(n).padStart(2, '0');
  const monthKey = (ts) => { const d = new Date(ts); return d.getFullYear() + '-' + pad2(d.getMonth() + 1); };
  const dayIdx = (ts) => (new Date(ts).getDay() + 6) % 7; // lunedì = 0
  const slotIdx = (ts) => Math.floor(new Date(ts).getHours() / 3);

  /* ---------------- formattazione in italiano ---------------- */
  // 'always': anche 1.234 con il punto (di base l'italiano lo mette solo da 10.000)
  const nf = (o) => { try { return new Intl.NumberFormat('it-IT', Object.assign({ useGrouping: 'always' }, o)); } catch (e) { return new Intl.NumberFormat('it-IT', o); } };
  const NF0 = nf({ maximumFractionDigits: 0 });
  const NF1 = nf({ maximumFractionDigits: 1 });
  const NF2 = nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function fmtNum(n) { return isNum(n) ? NF0.format(Math.round(n)) : '—'; }
  function fmtCompact(n) {
    if (!isNum(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1e9) return NF1.format(n / 1e9) + ' Mld';
    if (a >= 1e6) return NF1.format(n / 1e6) + ' Mln';
    if (a >= 1e4) return NF1.format(n / 1e3) + 'K';
    return NF0.format(Math.round(n));
  }
  function fmtPct(n, digits) {
    if (!isNum(n)) return '—';
    const f = digits === 1 ? NF1 : digits === 0 ? NF0 : NF2;
    return f.format(n) + '%';
  }
  function fmtDec(n) { return isNum(n) ? NF1.format(n) : '—'; }
  function fmtDate(ts, withTime) {
    if (!isNum(ts)) return '—';
    const d = new Date(ts);
    const s = pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear();
    return withTime ? s + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) : s;
  }
  const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  function fmtMonth(key) { const [y, m] = key.split('-'); return MONTHS[+m - 1] + ' ' + y.slice(2); }
  function fmtEuro(n) { return isNum(n) ? '€ ' + NF0.format(n) : '—'; }

  /* ---------------- testo dell'export (le "lettere strane") ----------------
     Gli export di Meta salvano l'UTF-8 come se fosse Latin-1: "è" diventa "Ã¨"
     e le emoji diventano "ð…". Qui si rimette a posto. */
  const MOJI = /[Â-ô][\u0080-¿]/;
  function fixText(s) {
    if (typeof s !== 'string' || !MOJI.test(s)) return s;
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c > 255) return s; b[i] = c; }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { return s; }
  }
  function parseJSON(text) {
    return JSON.parse(String(text).replace(/^﻿/, ''), (k, v) => (typeof v === 'string' ? fixText(v) : v));
  }

  /* ---------------- nomi utente ---------------- */
  const USER_RE = /^[a-z0-9._]{1,30}$/i;
  const RESERVED = new Set(['p', 'reel', 'reels', 'tv', 'explore', 'stories', 'accounts', 'direct', 'about', 'developer', 'legal', 'web']);
  function cleanUser(u) { return String(u || '').trim().replace(/^@/, '').toLowerCase(); }
  function userFromHref(h) {
    const m = String(h || '').match(/instagram\.com\/([^?#]*)/i);
    if (!m) return '';
    const seg = m[1].split('/').filter(Boolean);
    if (seg[0] === '_u') seg.shift();
    if (seg[0] && seg[0].toLowerCase() === 'stories') return seg[1] && USER_RE.test(seg[1]) ? seg[1] : '';
    if (!seg[0] || RESERVED.has(seg[0].toLowerCase())) return '';
    return USER_RE.test(seg[0]) ? seg[0] : '';
  }
  function findLabel(o, re, depth) {
    depth = depth || 0;
    if (!o || typeof o !== 'object' || depth > 8) return '';
    if (Array.isArray(o)) { for (const x of o) { const r = findLabel(x, re, depth + 1); if (r) return r; } return ''; }
    if (typeof o.label === 'string' && re.test(o.label) && typeof o.value === 'string' && o.value) return o.value;
    for (const k in o) { const v = o[k]; if (v && typeof v === 'object') { const r = findLabel(v, re, depth + 1); if (r) return r; } }
    return '';
  }
  function listOf(j) {
    if (Array.isArray(j)) return j;
    if (j && typeof j === 'object') {
      const arrs = Object.values(j).filter(Array.isArray);
      if (arrs.length) return [].concat(...arrs);
    }
    return [];
  }

  /* ---------------- export dei dati di Instagram ---------------- */
  const KINDS = [
    ['followers', /(^|\/)followers(_\d+)?\.json$/],
    ['following', /(^|\/)following(_\d+)?\.json$/],
    ['unfollowed', /recently_unfollowed_(profiles|accounts)\.json$/],
    ['pending', /pending_follow_requests\.json$/],
    ['received', /follow_requests_you.?ve_received\.json$/],
    ['closeFriends', /close_friends\.json$/],
    ['blocked', /blocked_(profiles|accounts)\.json$/],
    ['restricted', /restricted_(profiles|accounts)\.json$/],
    ['hideStory', /hide_story_from\.json$/],
    ['posts', /(^|\/)posts_\d+\.json$/],
    ['reels', /(^|\/)reels\.json$/],
    ['stories', /(^|\/)stories\.json$/],
    ['likes', /(^|\/)liked_posts(_\d+)?\.json$/],
    ['comments', /(^|\/)(post_comments(_\d+)?|reels_comments)\.json$/],
    ['storyLikes', /(^|\/)story_likes\.json$/],
    ['profile', /(^|\/)personal_information\.json$/],
    ['messages', /messages\/inbox\/[^/]+\/message_\d+\.json$/],
    ['interests', /(^|\/)(ads_interests|your_topics|recommended_topics)\.json$/],
  ];
  const normPath = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();
  function kindOf(path) {
    const p = normPath(path);
    if (!p.endsWith('.json')) return null;
    for (const [k, re] of KINDS) if (re.test(p)) return k;
    return null;
  }
  const looksLikeHtmlExport = (path) => /(followers(_\d+)?|following)\.html?$/.test(normPath(path));

  function relItem(it) {
    if (!it || typeof it !== 'object') return null;
    const sld = Array.isArray(it.string_list_data) ? it.string_list_data[0] || {} : {};
    let u = typeof sld.value === 'string' && USER_RE.test(sld.value) ? sld.value : '';
    if (!u && typeof it.title === 'string' && USER_RE.test(it.title)) u = it.title;
    if (!u) u = userFromHref(sld.href);
    if (!u) { const f = findLabel(it, /^(username|nome utente)$/i); if (USER_RE.test(f)) u = f; }
    if (!u) u = userFromHref(findLabel(it, /^url$/i));
    if (!u) return null;
    const ts = isNum(sld.timestamp) ? sld.timestamp : isNum(it.timestamp) ? it.timestamp : null;
    return { u: cleanUser(u), ts: ts ? ts * 1000 : null };
  }
  function postItem(it, forceType) {
    if (!it || typeof it !== 'object') return null;
    const media = Array.isArray(it.media) ? it.media : it.uri ? [it] : [];
    const first = media[0] || {};
    const ts = isNum(it.creation_timestamp) ? it.creation_timestamp : isNum(first.creation_timestamp) ? first.creation_timestamp : null;
    if (!ts) return null;
    const cap = (typeof it.title === 'string' && it.title) || (typeof first.title === 'string' && first.title) || '';
    const isVid = media.some((m) => /\.(mp4|mov|m4v)$/i.test(m.uri || ''));
    const type = forceType || (media.length > 1 ? 'carousel' : isVid ? 'video' : 'image');
    return { ts: ts * 1000, caption: cap, type, n: media.length || 1 };
  }
  function commentItem(it) {
    if (!it || typeof it !== 'object') return null;
    const m = it.string_map_data || {};
    let text = '', owner = '', ts = null;
    for (const k in m) {
      const v = m[k] || {};
      if (isNum(v.timestamp) && v.timestamp > 0) ts = v.timestamp * 1000;
      if (/owner|propriet/i.test(k)) owner = v.value || owner;
      else if (/comment/i.test(k)) text = v.value || text;
    }
    if (!text) text = findLabel(it, /^(comment|commento)$/i);
    if (!owner) owner = findLabel(it, /owner|propriet|^(username|nome utente)$/i);
    if (!owner) for (const k in m) { const v = (m[k] || {}).value; if (v && v !== text && USER_RE.test(v)) { owner = v; break; } }
    if (!ts && isNum(it.timestamp)) ts = it.timestamp * 1000;
    if (!text && !owner) return null;
    return { u: USER_RE.test(owner) ? cleanUser(owner) : '', ts, text };
  }
  function profileOf(j) {
    const it = listOf(j)[0] || (j && typeof j === 'object' ? j : {});
    const m = it.string_map_data || {};
    const get = (re) => { for (const k in m) if (re.test(k)) return (m[k] || {}).value || ''; return findLabel(it, re); };
    return {
      username: cleanUser(get(/^(username|nome utente)$/i)),
      name: get(/^(name|nome)$/i),
      bio: get(/^(bio|biografia)$/i),
      website: get(/^(website|sito web)$/i),
    };
  }
  function interestValues(j) {
    const out = [];
    for (const it of listOf(j)) {
      if (!it || typeof it !== 'object') continue;
      if (it.string_map_data) for (const k in it.string_map_data) { const v = it.string_map_data[k] && it.string_map_data[k].value; if (v) out.push(v); }
      else if (Array.isArray(it.label_values)) for (const lv of it.label_values) { if (lv && typeof lv.value === 'string' && lv.value) out.push(lv.value); }
      else if (Array.isArray(it.string_list_data)) for (const s of it.string_list_data) { if (s && s.value) out.push(s.value); }
      else if (typeof it.title === 'string' && it.title) out.push(it.title);
    }
    return out;
  }
  function dedupe(list) {
    const m = new Map();
    for (const x of list) {
      const o = m.get(x.u);
      if (!o) m.set(x.u, x);
      else if (x.ts && (!o.ts || x.ts < o.ts)) m.set(x.u, x);
    }
    return [...m.values()];
  }

  /* files: [{ path, text }] (testo JSON) oppure [{ path, json }] */
  function parseExport(files) {
    const R = {
      owner: { username: '', name: '', bio: '', website: '' },
      followers: [], following: [], unfollowed: [], pending: [], received: [], closeFriends: [], blocked: [], restricted: [], hideStory: [],
      posts: [], stories: [], likes: [], comments: [], storyLikes: [], threads: [], interests: [],
      files: 0, errors: [], html: false,
    };
    const threads = new Map();
    for (const f of files) {
      const p = normPath(f.path);
      const kind = kindOf(p);
      if (!kind) { if (looksLikeHtmlExport(p)) R.html = true; continue; }
      let j;
      try { j = f.json !== undefined ? f.json : parseJSON(f.text); } catch (e) { R.errors.push(f.path); continue; }
      R.files++;
      const items = listOf(j);
      switch (kind) {
        case 'followers': case 'following': case 'unfollowed': case 'pending': case 'received':
        case 'closeFriends': case 'blocked': case 'restricted': case 'hideStory': case 'storyLikes':
          for (const it of items) { const r = relItem(it); if (r) R[kind].push(r); }
          break;
        case 'likes':
          for (const it of items) { const r = relItem(it); if (r) R.likes.push(r); }
          break;
        case 'posts':
          for (const it of items) { const r = postItem(it); if (r) R.posts.push(r); }
          break;
        case 'reels':
          for (const it of items) { const r = postItem(it, 'reel'); if (r) R.posts.push(r); }
          break;
        case 'stories':
          for (const it of items) { const r = postItem(it, 'story'); if (r) R.stories.push(r); }
          break;
        case 'comments':
          for (const it of items) { const r = commentItem(it); if (r) R.comments.push(r); }
          break;
        case 'profile': {
          const o = profileOf(j);
          for (const k in o) if (o[k] && !R.owner[k]) R.owner[k] = o[k];
          break;
        }
        case 'messages': {
          const key = p.replace(/\/message_\d+\.json$/, '');
          const t = threads.get(key) || { title: '', n: 0, first: null, last: null, people: 0 };
          if (j && typeof j.title === 'string' && j.title) t.title = j.title;
          if (j && Array.isArray(j.participants)) t.people = Math.max(t.people, j.participants.length);
          for (const msg of (j && Array.isArray(j.messages) ? j.messages : [])) {
            const ts = msg && msg.timestamp_ms;
            t.n++;
            if (isNum(ts)) { if (!t.first || ts < t.first) t.first = ts; if (!t.last || ts > t.last) t.last = ts; }
          }
          threads.set(key, t);
          break;
        }
        case 'interests':
          for (const v of interestValues(j)) R.interests.push(v);
          break;
      }
    }
    for (const k of ['followers', 'following', 'unfollowed', 'pending', 'received', 'closeFriends', 'blocked', 'restricted', 'hideStory']) R[k] = dedupe(R[k]);
    R.posts.sort((a, b) => a.ts - b.ts);
    R.stories.sort((a, b) => a.ts - b.ts);
    R.interests = [...new Set(R.interests)].slice(0, 300);
    R.threads = [...threads.values()].filter((t) => t.n > 0).sort((a, b) => b.n - a.n);
    return R;
  }

  function byMonth(tsList, from, to) {
    const m = new Map();
    for (const ts of tsList) if (isNum(ts)) { const k = monthKey(ts); m.set(k, (m.get(k) || 0) + 1); }
    if (!m.size) return [];
    const keys = [...m.keys()].sort();
    const start = from || keys[0], end = to || keys[keys.length - 1];
    const out = [];
    let [y, mo] = start.split('-').map(Number);
    const [ey, em] = end.split('-').map(Number);
    let guard = 0;
    while ((y < ey || (y === ey && mo <= em)) && guard++ < 400) {
      const k = y + '-' + pad2(mo);
      out.push({ k, n: m.get(k) || 0 });
      mo++; if (mo > 12) { mo = 1; y++; }
    }
    return out;
  }
  const lastMonths = (series, n) => series.slice(Math.max(0, series.length - n));

  function analyzeExport(R, prev, now) {
    now = now || Date.now();
    const fers = new Set(R.followers.map((x) => x.u));
    const fing = new Set(R.following.map((x) => x.u));
    const byTsDesc = (a, b) => (b.ts || 0) - (a.ts || 0);
    const notBack = R.following.filter((x) => !fers.has(x.u)).sort(byTsDesc);
    const fans = R.followers.filter((x) => !fing.has(x.u)).sort(byTsDesc);
    const mutual = R.following.filter((x) => fers.has(x.u)).sort(byTsDesc);
    const posts = R.posts;
    const heat = Array.from({ length: 7 }, () => Array(8).fill(0));
    for (const p of posts) heat[dayIdx(p.ts)][slotIdx(p.ts)]++;
    const tags = countBy(posts.flatMap((p) => hashtagsOf(p.caption)), (t) => t);
    const types = countBy(posts, (p) => p.type).map((x) => ({ type: x.k, label: TYPE_LABEL[x.k] || x.k, n: x.n }));
    let diff = null;
    if (prev && Array.isArray(prev.list) && (prev.owner || '') === (R.owner.username || '')) {
      const old = new Set(prev.list);
      diff = {
        since: prev.at,
        gained: R.followers.filter((x) => !old.has(x.u)).map((x) => x.u),
        lost: prev.list.filter((u) => !fers.has(u)),
      };
    }
    const firstFollower = R.followers.reduce((m, x) => (x.ts && (!m || x.ts < m) ? x.ts : m), null);
    const ratio = R.followers.length && R.following.length ? R.followers.length / R.following.length : null;
    const last30 = (list) => list.filter((x) => x.ts && now - x.ts <= 30 * DAY).length;
    return {
      owner: R.owner,
      counts: {
        followers: R.followers.length, following: R.following.length, mutual: mutual.length, notBack: notBack.length, fans: fans.length,
        unfollowed: R.unfollowed.length, pending: R.pending.length, received: R.received.length, closeFriends: R.closeFriends.length,
        blocked: R.blocked.length, restricted: R.restricted.length, posts: posts.filter((p) => p.type !== 'reel').length,
        reels: posts.filter((p) => p.type === 'reel').length, stories: R.stories.length, likes: R.likes.length, comments: R.comments.length,
        storyLikes: R.storyLikes.length, threads: R.threads.length,
      },
      ratio,
      newFollowers30: last30(R.followers),
      newFollowing30: last30(R.following),
      firstFollower,
      lists: {
        notBack, fans, mutual,
        followers: [...R.followers].sort(byTsDesc), following: [...R.following].sort(byTsDesc),
        unfollowed: [...R.unfollowed].sort(byTsDesc), pending: [...R.pending].sort(byTsDesc), received: [...R.received].sort(byTsDesc),
        closeFriends: R.closeFriends, blocked: R.blocked, restricted: R.restricted, hideStory: R.hideStory,
      },
      followersByMonth: lastMonths(byMonth(R.followers.map((x) => x.ts)), 36),
      followingByMonth: lastMonths(byMonth(R.following.map((x) => x.ts)), 36),
      postsByMonth: lastMonths(byMonth(posts.map((p) => p.ts)), 36),
      storiesByMonth: lastMonths(byMonth(R.stories.map((p) => p.ts)), 24),
      likesByMonth: lastMonths(byMonth(R.likes.map((x) => x.ts)), 24),
      postHeat: heat,
      postTypes: types,
      tags: tags.slice(0, 30),
      avgCaption: posts.length ? mean(posts.map((p) => (p.caption || '').length)) : null,
      topLiked: countBy(R.likes, (x) => x.u).slice(0, 15),
      topCommented: countBy(R.comments, (x) => x.u).slice(0, 15),
      topStoryLikes: countBy(R.storyLikes, (x) => x.u).slice(0, 15),
      threads: R.threads.slice(0, 15),
      interests: R.interests,
      diff,
      html: R.html,
      files: R.files,
    };
  }
  function followersSnapshot(R, now) {
    return { owner: R.owner.username || '', at: now || Date.now(), list: R.followers.map((x) => x.u) };
  }

  /* ---------------- lettura ZIP (senza librerie) ----------------
     Legge solo l'indice e i file .json che servono: un export di parecchi GB
     non viene caricato tutto in memoria. Supporta anche ZIP64. */
  async function zipEntries(blob) {
    const size = blob.size;
    const tailLen = Math.min(size, 65557 + 20);
    const tail = new DataView(await blob.slice(size - tailLen).arrayBuffer());
    let e = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('Il file non sembra uno ZIP valido.');
    let total = tail.getUint16(e + 10, true), cdSize = tail.getUint32(e + 12, true), cdOff = tail.getUint32(e + 16, true);
    if (cdOff === 0xffffffff || cdSize === 0xffffffff || total === 0xffff) {
      const loc = e - 20;
      if (loc >= 0 && tail.getUint32(loc, true) === 0x07064b50) {
        const z64 = Number(tail.getBigUint64(loc + 8, true));
        const z = new DataView(await blob.slice(z64, z64 + 56).arrayBuffer());
        if (z.getUint32(0, true) === 0x06064b50) {
          total = Number(z.getBigUint64(32, true)); cdSize = Number(z.getBigUint64(40, true)); cdOff = Number(z.getBigUint64(48, true));
        }
      }
    }
    const cd = new DataView(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
    const dec = new TextDecoder('utf-8');
    const out = [];
    let p = 0;
    while (p + 46 <= cd.byteLength && cd.getUint32(p, true) === 0x02014b50) {
      const flags = cd.getUint16(p + 8, true), method = cd.getUint16(p + 10, true);
      let comp = cd.getUint32(p + 20, true), unc = cd.getUint32(p + 24, true);
      const nl = cd.getUint16(p + 28, true), xl = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true);
      let off = cd.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nl));
      let x = p + 46 + nl;
      const xe = x + xl;
      while (x + 4 <= xe) {
        const id = cd.getUint16(x, true), len = cd.getUint16(x + 2, true);
        if (id === 1) {
          let q = x + 4;
          if (unc === 0xffffffff) { unc = Number(cd.getBigUint64(q, true)); q += 8; }
          if (comp === 0xffffffff) { comp = Number(cd.getBigUint64(q, true)); q += 8; }
          if (off === 0xffffffff) { off = Number(cd.getBigUint64(q, true)); q += 8; }
        }
        x += 4 + len;
      }
      out.push({ name, method, comp, unc, off, encrypted: !!(flags & 1), dir: name.endsWith('/') });
      p = xe + cl;
    }
    return out;
  }
  async function zipRead(blob, entry) {
    if (entry.encrypted) throw new Error('Lo ZIP è protetto da password.');
    const h = new DataView(await blob.slice(entry.off, entry.off + 30).arrayBuffer());
    if (h.getUint32(0, true) !== 0x04034b50) throw new Error('ZIP danneggiato.');
    const start = entry.off + 30 + h.getUint16(26, true) + h.getUint16(28, true);
    const data = blob.slice(start, start + entry.comp);
    if (entry.method === 0) return new Uint8Array(await data.arrayBuffer());
    if (entry.method === 8) {
      const ds = data.stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(ds).arrayBuffer());
    }
    throw new Error('Compressione ZIP non supportata (' + entry.method + ').');
  }
  /* Restituisce [{path, text}] dei soli file utili + quanti file c'erano in tutto. */
  async function readExportZip(blob, onProgress) {
    const entries = await zipEntries(blob);
    const want = entries.filter((en) => !en.dir && (kindOf(en.name) || looksLikeHtmlExport(en.name)));
    const files = [];
    const dec = new TextDecoder('utf-8');
    let i = 0;
    for (const en of want) {
      if (looksLikeHtmlExport(en.name)) { files.push({ path: en.name, text: '' }); continue; }
      const bytes = await zipRead(blob, en);
      files.push({ path: en.name, text: dec.decode(bytes) });
      i++;
      if (onProgress) onProgress(i, want.length);
    }
    return { files, total: entries.length };
  }

  /* ---------------- CSV (Meta Business Suite, Excel o fatto a mano) ---------------- */
  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const delim = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  }
  function parseNum(v) {
    if (isNum(v)) return v;
    let s = String(v == null ? '' : v).trim().toLowerCase().replace(/[\s '’]/g, '');
    if (!s || s === '-' || s === '—' || s === 'n/a' || s === 'na') return null;
    let mult = 1;
    const m = s.match(/(mila|mln|mio|k|m|b)$/);
    if (m) { mult = { k: 1e3, mila: 1e3, m: 1e6, mln: 1e6, mio: 1e6, b: 1e9 }[m[1]]; s = s.slice(0, -m[1].length); }
    s = s.replace(/[^\d.,-]/g, '');
    if (!s || !/\d/.test(s)) return null;
    const hasDot = s.includes('.'), hasComma = s.includes(',');
    if (hasDot && hasComma) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (hasComma) {
      s = mult === 1 && /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    } else if (hasDot) {
      if (mult === 1 && /^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    }
    const n = parseFloat(s);
    return isFinite(n) ? n * mult : null;
  }
  /* Data e ora: ISO (anche "+0000" delle API), gg/mm/aaaa, mm/gg/aaaa, Unix. */
  function parseDate(v, order) {
    if (isNum(v)) return v > 1e12 ? v : v * 1000;
    let s = String(v == null ? '' : v).trim();
    if (!s) return null;
    if (/^\d{10}$/.test(s)) return +s * 1000;
    if (/^\d{13}$/.test(s)) return +s;
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12).getTime();
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) {
      s = s.replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
      const t = Date.parse(s);
      return isNaN(t) ? null : t;
    }
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ ,T]+(\d{1,2})[:.](\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i);
    if (m) {
      let a = +m[1], b = +m[2], y = +m[3];
      if (y < 100) y += 2000;
      let d, mo;
      if (order === 'mdy') { mo = a; d = b; } else { d = a; mo = b; }
      if (mo > 12 && d <= 12) { const t = mo; mo = d; d = t; }
      let h = m[4] ? +m[4] : 12, mi = m[5] ? +m[5] : 0;
      const ss = m[6] ? +m[6] : 0;
      if (m[7]) { const pm = m[7].toLowerCase() === 'pm'; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
      if (!m[4]) { h = 12; mi = 0; }
      const t = new Date(y, mo - 1, d, h, mi, ss).getTime();
      return isNaN(t) ? null : t;
    }
    const t = Date.parse(s);
    return isNaN(t) ? null : t;
  }
  function dateOrder(values, englishHeader) {
    let dmy = false, mdy = false;
    for (const v of values) {
      const m = String(v || '').trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/);
      if (!m) continue;
      if (+m[1] > 12) dmy = true;
      if (+m[2] > 12) mdy = true;
    }
    if (dmy && !mdy) return 'dmy';
    if (mdy && !dmy) return 'mdy';
    return englishHeader ? 'mdy' : 'dmy';
  }
  function typeFrom(v) {
    const s = String(v || '').toLowerCase();
    if (/reel|clip/.test(s)) return 'reel';
    if (/carosel|carousel|album|sequenz/.test(s)) return 'carousel';
    if (/video/.test(s)) return 'video';
    if (/stor/.test(s)) return 'story';
    return 'image';
  }
  const norm = (h) => String(h || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const COLS = [
    ['date', (h) => /pubblicaz|publish|^(data|date|timestamp|giorno|data e ora|orario|time)$/.test(h)],
    ['likes', (h) => /^(likes?|mi piace|like|reazioni|reactions)$/.test(h) || h.includes('mi piace')],
    ['comments', (h) => /^(comments?|commenti?)$/.test(h)],
    ['views', (h) => /^(views|visualizzazioni|plays|riproduzioni|video views)$/.test(h)],
    ['impressions', (h) => /^(impressions?|impressioni)$/.test(h)],
    ['reach', (h) => /^(reach|copertura|account raggiunti)$/.test(h)],
    ['saves', (h) => /^(saves?|salvataggi|salvati)$/.test(h)],
    ['shares', (h) => /^(shares?|condivisioni)$/.test(h)],
    ['type', (h) => /^(post type|tipo di post|tipo|type|formato|tipo di contenuto)$/.test(h)],
    ['caption', (h) => /^(description|descrizione|caption|didascalia|testo|title|titolo)$/.test(h)],
    ['url', (h) => /^(permalink|link|url)$/.test(h)],
    ['username', (h) => /^(account username|nome utente dell'account|nome utente account|username|nome utente)$/.test(h)],
    ['name', (h) => /^(account name|nome dell'account|nome account)$/.test(h)],
    ['id', (h) => /^(post id|id post|id del post|id)$/.test(h)],
  ];
  function csvToPosts(text) {
    const rows = parseCSV(text);
    if (!rows.length) return { posts: [], warnings: ['Il file è vuoto.'], meta: {} };
    let hi = 0, map = null;
    for (let r = 0; r < Math.min(rows.length, 6); r++) {
      const m = {};
      rows[r].forEach((h, i) => { const n = norm(h); for (const [k, f] of COLS) if (m[k] === undefined && f(n)) { m[k] = i; break; } });
      const pub = rows[r].findIndex((h) => /pubblicaz|publish/.test(norm(h)));
      if (pub >= 0) m.date = pub;
      if (m.date !== undefined && (m.likes !== undefined || m.comments !== undefined || m.views !== undefined || m.reach !== undefined)) { hi = r; map = m; break; }
    }
    if (!map) return { posts: [], warnings: ['Non trovo le colonne: servono almeno "data" e "like" (o "commenti").'], meta: {} };
    const header = rows[hi].map(norm);
    const english = header.some((h) => /publish|likes|comments/.test(h));
    const body = rows.slice(hi + 1);
    const order = dateOrder(body.map((r) => r[map.date]), english);
    const posts = [], warnings = [];
    let bad = 0;
    const meta = {};
    body.forEach((r, i) => {
      const ts = parseDate(r[map.date], order);
      if (!ts) { bad++; return; }
      const g = (k) => (map[k] === undefined ? null : parseNum(r[map[k]]));
      const s = (k) => (map[k] === undefined ? '' : String(r[map[k]] || '').trim());
      if (!meta.username && s('username')) meta.username = cleanUser(s('username'));
      if (!meta.name && s('name')) meta.name = s('name');
      posts.push({
        id: s('id') || 'csv' + i, ts, type: typeFrom(s('type')), caption: s('caption'),
        likes: g('likes'), comments: g('comments'), views: g('views') != null ? g('views') : g('impressions'),
        reach: g('reach'), saves: g('saves'), shares: g('shares'), url: s('url'),
      });
    });
    if (bad) warnings.push(bad + (bad === 1 ? ' riga senza una data valida è stata saltata.' : ' righe senza una data valida sono state saltate.'));
    return { posts, warnings, meta, order };
  }
  function postsToCSV(posts) {
    const esc = (v) => { const s = v == null ? '' : String(v); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const head = ['Data', 'Tipo', 'Mi piace', 'Commenti', 'Interazioni', 'ER %', 'Visualizzazioni', 'Copertura', 'Salvataggi', 'Condivisioni', 'Hashtag', 'Didascalia', 'Link'];
    const lines = [head.join(';')];
    for (const p of posts) {
      lines.push([fmtDate(p.ts, true), TYPE_LABEL[p.type] || p.type, p.likes, p.comments, p.eng, p.er != null ? NF2.format(p.er) : '',
        p.views, p.reach, p.saves, p.shares, hashtagsOf(p.caption).map((t) => '#' + t).join(' '), (p.caption || '').replace(/\s+/g, ' '), p.url || ''].map(esc).join(';'));
    }
    return '﻿' + lines.join('\r\n');
  }
  function listToCSV(list, label) {
    const lines = ['Nome utente;Link;' + (label || 'Data')];
    for (const x of list) lines.push([x.u, 'https://www.instagram.com/' + x.u + '/', x.ts ? fmtDate(x.ts) : ''].join(';'));
    return '﻿' + lines.join('\r\n');
  }

  /* ---------------- testo delle didascalie ---------------- */
  function hashtagsOf(s) {
    const out = [];
    const re = /#([\p{L}\p{N}_]+)/gu;
    let m;
    while ((m = re.exec(String(s || '')))) if (!/^\d+$/.test(m[1])) out.push(m[1].toLowerCase());
    return out;
  }
  function mentionsOf(s) {
    const out = [];
    const re = /(^|[^\w@])@([A-Za-z0-9._]{1,30})/g;
    let m;
    while ((m = re.exec(String(s || '')))) out.push(m[2].replace(/\.+$/, '').toLowerCase());
    return out.filter(Boolean);
  }
  const EMOJI_RE = /\p{Extended_Pictographic}/u;

  /* ---------------- fasce di profilo e valori di riferimento ----------------
     Engagement rate = (mi piace + commenti) medi per post / follower.
     I valori tipici sono indicativi (medie di settore 2024–2026). */
  const TIERS = [
    { key: 'start', label: 'Profilo iniziale', range: 'meno di 1.000 follower', max: 1e3, lo: 3, hi: 8 },
    { key: 'nano', label: 'Nano', range: '1.000 – 10.000 follower', max: 1e4, lo: 2, hi: 5 },
    { key: 'micro', label: 'Micro', range: '10.000 – 50.000 follower', max: 5e4, lo: 1.5, hi: 3 },
    { key: 'mid', label: 'Medio', range: '50.000 – 500.000 follower', max: 5e5, lo: 1, hi: 2 },
    { key: 'macro', label: 'Macro', range: '500.000 – 1 milione di follower', max: 1e6, lo: 0.7, hi: 1.5 },
    { key: 'mega', label: 'Mega', range: 'oltre 1 milione di follower', max: Infinity, lo: 0.5, hi: 1.2 },
  ];
  function tierOf(followers) { for (const t of TIERS) if ((followers || 0) < t.max) return t; return TIERS[TIERS.length - 1]; }
  function erRating(er, tier) {
    if (!isNum(er)) return null;
    if (er < tier.lo * 0.5) return { key: 'low', label: 'Bassa', tone: 'bad' };
    if (er < tier.lo) return { key: 'below', label: 'Sotto la media', tone: 'warn' };
    if (er <= tier.hi) return { key: 'avg', label: 'Nella media', tone: 'ok' };
    if (er <= tier.hi * 1.8) return { key: 'good', label: 'Buona', tone: 'good' };
    return { key: 'great', label: 'Ottima', tone: 'good' };
  }

  /* ---------------- un post, in forma comune ---------------- */
  function normPost(p, i) {
    const n = (v) => (v === null || v === undefined || v === '' ? null : isNum(v) ? v : parseNum(v));
    const ts = isNum(p.ts) ? p.ts : parseDate(p.ts || p.timestamp || p.date);
    return {
      id: String(p.id || 'p' + i), ts, type: TYPE_LABEL[p.type] ? p.type : typeFrom(p.type),
      caption: String(p.caption || ''), likes: n(p.likes), comments: n(p.comments), views: n(p.views),
      reach: n(p.reach), saves: n(p.saves), shares: n(p.shares), url: p.url || '', thumb: p.thumb || '',
    };
  }

  /* ---------------- l'analisi di un profilo ---------------- */
  function analyze(P, now) {
    now = now || Date.now();
    const followers = isNum(P.followers) ? P.followers : null;
    const all = (P.posts || []).map(normPost).filter((p) => isNum(p.ts) && p.type !== 'story').sort((a, b) => a.ts - b.ts);
    for (const p of all) {
      p.eng = (p.likes || 0) + (p.comments || 0);
      p.hasEng = p.likes !== null || p.comments !== null;
      p.er = followers && p.hasEng ? (p.eng / followers) * 100 : null;
      p.tags = hashtagsOf(p.caption);
    }
    // i post delle ultime 24 ore non hanno ancora raccolto le loro interazioni
    const settledAll = all.filter((p) => now - p.ts > DAY);
    const base = (settledAll.length >= 3 ? settledAll : all).filter((p) => p.hasEng);
    const fresh = all.length - (settledAll.length >= 3 ? settledAll.length : all.length);
    const likesKnown = base.filter((p) => p.likes !== null);
    const avgLikes = likesKnown.length ? mean(likesKnown.map((p) => p.likes)) : null;
    const commentsKnown = base.filter((p) => p.comments !== null);
    const avgComments = commentsKnown.length ? mean(commentsKnown.map((p) => p.comments)) : null;
    const engs = base.map((p) => p.eng);
    const avgEng = engs.length ? mean(engs) : null;
    const er = followers && (avgLikes !== null || avgComments !== null) ? (((avgLikes || 0) + (avgComments || 0)) / followers) * 100 : null;
    const erMedian = followers && engs.length ? (median(engs) / followers) * 100 : null;
    const views = base.filter((p) => isNum(p.views)).map((p) => p.views);
    const avgViews = views.length ? mean(views) : null;
    const tier = tierOf(followers);
    const rating = erRating(er, tier);
    const ratio = isNum(followers) && isNum(P.following) && P.following > 0 ? followers / P.following : null;
    const c2l = avgLikes && avgComments !== null ? (avgComments / avgLikes) * 100 : null;

    // ritmo di pubblicazione
    const first = all.length ? all[0].ts : null;
    const last = all.length ? all[all.length - 1].ts : null;
    const gaps = [];
    for (let i = 1; i < all.length; i++) gaps.push((all[i].ts - all[i - 1].ts) / DAY);
    const gapAvg = gaps.length ? mean(gaps) : null;
    const gapMax = gaps.length ? Math.max(...gaps) : null;
    const gapCv = gaps.length > 2 && gapAvg > 0 ? stdev(gaps) / gapAvg : null;
    let perWeek = null;
    if (all.length) {
      const span = (now - first) / DAY;
      if (span > 90) perWeek = all.filter((p) => now - p.ts <= 90 * DAY).length / (90 / 7);
      else perWeek = (all.length / Math.max(span, 7)) * 7;
    }
    const daysSinceLast = last ? Math.max(0, (now - last) / DAY) : null;
    const lastAgo = last ? calDays(last, now) : null;

    // quando pubblicare: giorno × fascia oraria
    const cells = Array.from({ length: 7 }, () => Array.from({ length: 8 }, () => ({ n: 0, s: 0 })));
    for (const p of base) { const c = cells[dayIdx(p.ts)][slotIdx(p.ts)]; c.n++; c.s += p.eng; }
    const heat = cells.map((row) => row.map((c) => ({ n: c.n, avg: c.n ? c.s / c.n : null })));
    const byDay = cells.map((row, i) => { const n = sum(row.map((c) => c.n)), s = sum(row.map((c) => c.s)); return { i, label: DAYS[i], n, avg: n ? s / n : null }; });
    const bySlot = SLOTS.map((label, j) => { let n = 0, s = 0; for (const row of cells) { n += row[j].n; s += row[j].s; } return { j, label, n, avg: n ? s / n : null }; });
    const minN = base.length >= 20 ? 2 : 1;
    const pick = (list) => list.filter((x) => x.n >= minN && x.avg !== null).sort((a, b) => b.avg - a.avg)[0] || null;
    const bestDay = base.length >= 6 ? pick(byDay) : null;
    const bestSlot = base.length >= 6 ? pick(bySlot) : null;
    let bestCell = null;
    if (base.length >= 10) {
      heat.forEach((row, d) => row.forEach((c, s) => { if (c.n >= minN && c.avg !== null && (!bestCell || c.avg > bestCell.avg)) bestCell = { d, s, avg: c.avg, n: c.n }; }));
    }

    // formati
    const types = countBy(base, (p) => p.type).map(({ k, n }) => {
      const ps = base.filter((p) => p.type === k);
      const a = mean(ps.map((p) => p.eng));
      const v = ps.filter((p) => isNum(p.views));
      return { type: k, label: TYPE_LABEL[k] || k, n, share: n / base.length, avg: a, er: followers ? (a / followers) * 100 : null, lift: avgEng ? a / avgEng - 1 : null, views: v.length ? mean(v.map((p) => p.views)) : null };
    }).sort((a, b) => b.avg - a.avg);

    // hashtag e menzioni
    const tagMap = new Map();
    for (const p of base) for (const t of new Set(p.tags)) { const o = tagMap.get(t) || { tag: t, n: 0, s: 0 }; o.n++; o.s += p.eng; tagMap.set(t, o); }
    const tags = [...tagMap.values()].map((o) => ({ tag: o.tag, n: o.n, avg: o.s / o.n, lift: avgEng ? o.s / o.n / avgEng - 1 : null })).sort((a, b) => b.n - a.n || b.avg - a.avg);
    const bestTags = tags.filter((t) => t.n >= 2).sort((a, b) => b.avg - a.avg).slice(0, 10);
    const tagsPerPost = all.length ? mean(all.map((p) => p.tags.length)) : null;
    const mentions = countBy(all.flatMap((p) => mentionsOf(p.caption)), (u) => u).slice(0, 15);

    // didascalie
    const BUCKETS = [['Nessuna', 0, 0], ['Breve (fino a 50)', 1, 50], ['Media (51–150)', 51, 150], ['Lunga (151–400)', 151, 400], ['Molto lunga (oltre 400)', 401, Infinity]];
    const capLen = (p) => p.caption.replace(/#[\p{L}\p{N}_]+/gu, '').trim().length;
    const captions = BUCKETS.map(([label, lo, hi]) => { const ps = base.filter((p) => { const l = capLen(p); return l >= lo && l <= hi; }); return { label, n: ps.length, avg: ps.length ? mean(ps.map((p) => p.eng)) : null }; });
    const bestCaption = base.length >= 8 ? captions.filter((c) => c.n >= 2).sort((a, b) => b.avg - a.avg)[0] || null : null;
    const withQ = base.filter((p) => /\?/.test(p.caption)), noQ = base.filter((p) => !/\?/.test(p.caption));
    const question = withQ.length >= 3 && noQ.length >= 3 ? { withN: withQ.length, with: mean(withQ.map((p) => p.eng)), without: mean(noQ.map((p) => p.eng)) } : null;
    if (question) question.lift = question.without ? question.with / question.without - 1 : null;
    const emojiShare = all.length ? all.filter((p) => EMOJI_RE.test(p.caption)).length / all.length : null;

    // andamento nel tempo
    let trend = null;
    if (base.length >= 6) {
      const h = Math.floor(base.length / 2);
      const older = mean(base.slice(0, h).map((p) => p.eng)), recent = mean(base.slice(base.length - h).map((p) => p.eng));
      trend = { older, recent, pct: older ? (recent / older - 1) * 100 : null, n: h };
    }
    const monthsMap = new Map();
    for (const p of all) { const k = monthKey(p.ts); const o = monthsMap.get(k) || { k, n: 0, s: 0, m: 0 }; o.n++; if (p.hasEng) { o.s += p.eng; o.m++; } monthsMap.set(k, o); }
    const monthly = byMonth(all.map((p) => p.ts)).map(({ k }) => { const o = monthsMap.get(k) || { n: 0, s: 0, m: 0 }; return { k, n: o.n, avg: o.m ? o.s / o.m : null }; });

    // post migliori, peggiori, fuori scala
    const ranked = [...base].sort((a, b) => b.eng - a.eng);
    const top = ranked.slice(0, 6);
    const bottom = base.length >= 8 ? ranked.slice(-3).reverse() : [];
    const sd = stdev(engs);
    const outliers = base.length >= 8 ? base.filter((p) => p.eng > avgEng + 2 * sd).sort((a, b) => b.eng - a.eng) : [];

    // insights (solo per il proprio account, con le API o dal CSV di Meta)
    const withReach = base.filter((p) => isNum(p.reach) && p.reach > 0);
    const ins = withReach.length ? {
      n: withReach.length,
      reach: mean(withReach.map((p) => p.reach)),
      reachRate: followers ? (mean(withReach.map((p) => p.reach)) / followers) * 100 : null,
      saves: mean(withReach.map((p) => p.saves || 0)),
      shares: mean(withReach.map((p) => p.shares || 0)),
      erReach: mean(withReach.map((p) => ((p.eng + (p.saves || 0) + (p.shares || 0)) / p.reach) * 100)),
      topSaved: [...withReach].sort((a, b) => (b.saves || 0) - (a.saves || 0)).slice(0, 3),
      topShared: [...withReach].sort((a, b) => (b.shares || 0) - (a.shares || 0)).slice(0, 3),
    } : null;

    const A = {
      at: now, n: all.length, nBase: base.length, fresh, first, last, lastAgo, minN, followers, following: isNum(P.following) ? P.following : null,
      postsCount: isNum(P.postsCount) ? P.postsCount : null, ratio, avgLikes, avgComments, avgEng, er, erMedian, avgViews,
      viewRate: avgViews && followers ? (avgViews / followers) * 100 : null, likesHidden: base.length - likesKnown.length,
      tier, rating, c2l, perWeek, daysSinceLast, gapAvg, gapMax, gapCv, heat, byDay, bySlot, bestDay, bestSlot, bestCell, types,
      tags, bestTags, tagsPerPost, mentions, captions, bestCaption, question, emojiShare, trend, monthly, top, bottom, outliers,
      ins, posts: [...all].reverse(),
    };
    A.score = scoreOf(A, P);
    A.tips = tipsOf(A, P);
    A.signals = signalsOf(A, P);
    A.value = valueOf(A);
    return A;
  }

  /* ---------------- punteggio 0–100 ---------------- */
  function scoreOf(A, P) {
    const parts = [];
    if (isNum(A.er)) {
      const mid = (A.tier.lo + A.tier.hi) / 2;
      parts.push({ key: 'eng', label: 'Coinvolgimento', max: 35, pts: 35 * clamp(A.er / mid / 1.5, 0, 1), note: 'Engagement rate ' + fmtPct(A.er) + ' (tipico per la fascia: ' + fmtPct(A.tier.lo, 1) + '–' + fmtPct(A.tier.hi, 1) + ')' });
    }
    if (isNum(A.perWeek)) {
      const freq = Math.min(A.perWeek / 3, 1);
      const steady = A.gapCv === null ? 0.8 : 1 - Math.min(A.gapCv, 1.5) / 1.5;
      parts.push({ key: 'freq', label: 'Costanza', max: 20, pts: 20 * freq * (0.6 + 0.4 * steady), note: fmtDec(A.perWeek) + ' post a settimana' });
    }
    if (isNum(A.daysSinceLast)) {
      const d = A.daysSinceLast;
      parts.push({ key: 'recent', label: 'Attività recente', max: 15, pts: d <= 3 ? 15 : d <= 7 ? 12 : d <= 14 ? 8 : d <= 30 ? 4 : 0, note: 'Ultimo post ' + agoText(A.lastAgo) });
    }
    if (A.n >= 3) {
      const fams = new Set(A.posts.map((p) => (p.type === 'video' ? 'reel' : p.type)));
      const k = fams.size;
      parts.push({ key: 'mix', label: 'Varietà dei formati', max: 10, pts: k >= 3 ? 10 : k === 2 ? 7 : 4, note: k + (k === 1 ? ' formato usato' : ' formati usati') });
    }
    const hasMeta = P.source === 'api' || P.source === 'demo' || (P.bio !== undefined && P.bio !== null && P.source !== 'csv');
    if (hasMeta) {
      let pts = 0;
      if (P.bio && P.bio.trim().length >= 20) pts += 4; else if (P.bio) pts += 2;
      if (P.website) pts += 3;
      if (P.name) pts += 1;
      if (P.avatar || P.source === 'demo') pts += 2;
      parts.push({ key: 'bio', label: 'Profilo completo', max: 10, pts, note: [P.bio ? 'bio' : 'senza bio', P.website ? 'link' : 'senza link'].join(', ') });
    }
    if (A.trend && isNum(A.trend.pct)) {
      const t = A.trend.pct;
      parts.push({ key: 'trend', label: 'Andamento', max: 10, pts: t >= 15 ? 10 : t >= 0 ? 8 : t >= -15 ? 5 : 2, note: (t >= 0 ? '+' : '') + fmtPct(t, 0) + ' di interazioni negli ultimi post' });
    }
    const max = sum(parts.map((p) => p.max));
    const total = max ? Math.round((sum(parts.map((p) => p.pts)) / max) * 100) : null;
    const grade = total === null ? null : total >= 85 ? 'Eccellente' : total >= 70 ? 'Ottimo' : total >= 55 ? 'Buono' : total >= 40 ? 'Discreto' : 'Da migliorare';
    for (const p of parts) p.pts = Math.round(p.pts * 10) / 10;
    return { total, grade, parts };
  }
  /* giorni di calendario tra due momenti (ieri alle 23 e oggi alle 9 = 1 giorno) */
  function calDays(ts, now) {
    const a = new Date(ts), b = new Date(now || Date.now());
    return Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()) - new Date(a.getFullYear(), a.getMonth(), a.getDate())) / DAY);
  }
  function agoText(d) {
    if (!isNum(d)) return '—';
    if (d < 1) return 'oggi';
    if (d < 2) return 'ieri';
    if (d < 60) return Math.floor(d) + ' giorni fa';
    if (d < 730) return Math.floor(d / 30) + ' mesi fa';
    return Math.floor(d / 365) + ' anni fa';
  }

  /* ---------------- consigli pratici ---------------- */
  function tipsOf(A, P) {
    const T = [];
    const add = (tone, title, text) => T.push({ tone, title, text });
    if (!A.nBase) { add('tip', 'Servono dei post', 'Con almeno 6 post con mi piace e commenti l\'analisi diventa molto più utile.'); return T; }
    if (A.rating) {
      if (A.rating.tone === 'good') add('good', 'Pubblico molto coinvolto', 'L\'engagement rate (' + fmtPct(A.er) + ') è sopra i valori tipici per un profilo ' + A.tier.label.toLowerCase() + '. Continua così e punta sui contenuti che funzionano meglio.');
      else if (A.rating.tone === 'ok') add('tip', 'Coinvolgimento nella media', 'Un ER del ' + fmtPct(A.er) + ' è normale per la tua fascia. Per salire: più Reel, domande nelle didascalie e risposte veloci ai commenti.');
      else add('warn', 'Coinvolgimento da migliorare', 'L\'ER (' + fmtPct(A.er) + ') è sotto il tipico ' + fmtPct(A.tier.lo, 1) + '–' + fmtPct(A.tier.hi, 1) + ' della fascia. Prova contenuti più personali, chiamate all\'azione e orari migliori.');
    }
    if (A.bestCell) add('tip', 'Il momento migliore', 'I tuoi post rendono di più il ' + DAYS_LONG[A.bestCell.d] + ' tra le ' + SLOTS[A.bestCell.s].replace('–', ' e le ') + ' (media ' + fmtNum(A.bestCell.avg) + ' interazioni).');
    else if (A.bestDay) add('tip', 'Il giorno migliore', 'In media il ' + DAYS_LONG[A.bestDay.i] + ' è il giorno che rende di più (' + fmtNum(A.bestDay.avg) + ' interazioni per post).');
    if (A.types.length >= 2) {
      const best = A.types[0], worst = A.types[A.types.length - 1];
      if (best.n >= 2 && worst.avg > 0 && best.avg / worst.avg >= 1.25) add('tip', best.label + ' al primo posto', 'I contenuti "' + best.label + '" ottengono il ' + fmtPct((best.avg / worst.avg - 1) * 100, 0) + ' di interazioni in più rispetto a "' + worst.label + '". Dagli più spazio nel piano editoriale.');
    }
    if (A.n >= 4 && !A.types.some((t) => t.type === 'reel' || t.type === 'video')) add('tip', 'Prova i Reel', 'Negli ultimi post non ci sono video: i Reel sono il formato che raggiunge più persone che non ti seguono ancora.');
    if (isNum(A.perWeek)) {
      if (A.perWeek < 1) add('warn', 'Pubblichi poco', 'Meno di un post a settimana: l\'algoritmo premia la costanza. Un obiettivo realistico è 2–4 post a settimana.');
      else if (A.perWeek > 14) add('tip', 'Ritmo molto alto', 'Più di 2 post al giorno: verifica che la qualità non cali e che il pubblico non si stanchi.');
      else if (A.perWeek >= 3) add('good', 'Ritmo costante', 'Con ' + fmtDec(A.perWeek) + ' post a settimana hai un buon ritmo di pubblicazione.');
    }
    if (isNum(A.daysSinceLast) && A.daysSinceLast > 14) add('warn', 'Profilo fermo', 'L\'ultimo post è di ' + agoText(A.lastAgo) + '. Torna a pubblicare: dopo una pausa lunga la copertura cala.');
    if (isNum(A.gapMax) && A.gapMax > 30 && A.n >= 6) add('tip', 'Pause lunghe', 'C\'è stata una pausa di ' + Math.round(A.gapMax) + ' giorni tra due post. Un calendario editoriale aiuta a evitare i vuoti.');
    if (isNum(A.tagsPerPost)) {
      if (A.tagsPerPost > 15) add('tip', 'Troppi hashtag', 'In media usi ' + fmtDec(A.tagsPerPost) + ' hashtag per post. Oggi ne bastano 3–5, mirati e pertinenti.');
      else if (A.tagsPerPost < 0.5 && A.n >= 5) add('tip', 'Usa qualche hashtag', 'Quasi nessun post ha hashtag: 3–5 hashtag specifici del tuo settore aiutano a farti trovare.');
    }
    if (A.bestTags.length && A.bestTags[0].lift > 0.3) add('good', 'Hashtag che funzionano', 'I post con ' + A.bestTags.slice(0, 3).map((t) => '#' + t.tag).join(', ') + ' vanno sopra la tua media.');
    if (A.bestCaption && A.bestCaption.label !== 'Nessuna') add('tip', 'Lunghezza della didascalia', 'Le didascalie "' + A.bestCaption.label.toLowerCase() + '" sono quelle con più interazioni.');
    if (A.question && isNum(A.question.lift)) {
      if (A.question.lift > 0.1) add('good', 'Le domande funzionano', 'I post con una domanda nella didascalia ottengono il ' + fmtPct(A.question.lift * 100, 0) + ' di interazioni in più.');
      else if (A.question.lift < -0.1) add('tip', 'Domande da ripensare', 'Finora i post con domande hanno reso meno: prova domande più semplici e dirette.');
    } else if (isNum(A.c2l) && A.c2l < 1.5) add('tip', 'Stimola i commenti', 'Ricevi pochi commenti rispetto ai mi piace. Chiudi la didascalia con una domanda per aprire la conversazione.');
    if (A.trend && isNum(A.trend.pct)) {
      if (A.trend.pct <= -20) add('warn', 'Interazioni in calo', 'Gli ultimi ' + A.trend.n + ' post hanno il ' + fmtPct(-A.trend.pct, 0) + ' di interazioni in meno dei precedenti. Guarda i post migliori e riprendi quello stile.');
      else if (A.trend.pct >= 20) add('good', 'Interazioni in crescita', 'Gli ultimi ' + A.trend.n + ' post rendono il ' + fmtPct(A.trend.pct, 0) + ' in più dei precedenti.');
    }
    if (isNum(A.ratio) && A.ratio < 0.5 && (A.following || 0) > 500) add('tip', 'Segui molti account', 'Segui il doppio degli account che ti seguono: per un profilo professionale un rapporto equilibrato dà più credibilità.');
    if (P.source === 'api' || P.source === 'demo') {
      if (!P.website) add('tip', 'Aggiungi un link', 'Nel profilo manca un link: aggiungi il sito, lo shop o una pagina con tutti i tuoi link.');
      if (!P.bio) add('tip', 'Scrivi la bio', 'Una bio chiara (chi sei, cosa offri, cosa fare ora) trasforma i visitatori in follower.');
    }
    if (A.outliers.length) add('good', 'Post fuori scala', A.outliers.length + (A.outliers.length === 1 ? ' post ha' : ' post hanno') + ' ottenuto molto più della media: riprendi idea, formato e orario.');
    if (A.ins && isNum(A.ins.reachRate)) {
      if (A.ins.reachRate < 15) add('tip', 'Copertura bassa', 'In media i post raggiungono il ' + fmtPct(A.ins.reachRate, 0) + ' dei follower: contenuti da salvare e condividere (consigli, guide) aiutano la copertura.');
      else if (A.ins.reachRate > 60) add('good', 'Ottima copertura', 'I post raggiungono in media il ' + fmtPct(A.ins.reachRate, 0) + ' dei follower: arrivi anche a chi non ti segue.');
    }
    if (A.likesHidden > 0) add('tip', 'Mi piace nascosti', 'In ' + A.likesHidden + ' post i mi piace sono nascosti: per quei post conto solo i commenti.');
    return T;
  }

  /* ---------------- segnali da controllare (non sono prove) ---------------- */
  function signalsOf(A, P) {
    const S = [];
    const add = (tone, title, text) => S.push({ tone, title, text });
    if (A.rating && (A.rating.key === 'low') && (A.followers || 0) >= 5000) add('warn', 'Engagement molto basso per i follower che ha', 'Può succedere con molti follower inattivi o acquistati. Da solo non basta per dirlo.');
    if (isNum(A.c2l)) {
      if (A.c2l < 0.4 && (A.avgLikes || 0) > 200) add('warn', 'Pochissimi commenti rispetto ai mi piace', 'Meno di 4 commenti ogni 1.000 mi piace: a volte indica mi piace automatici.');
      else if (A.c2l > 15 && A.nBase >= 5) add('warn', 'Moltissimi commenti rispetto ai mi piace', 'Può dipendere da giveaway o da gruppi che si commentano a vicenda.');
      else add('ok', 'Rapporto commenti/mi piace normale', fmtPct(A.c2l, 1) + ' di commenti rispetto ai mi piace (di solito tra 0,5% e 10%).');
    }
    if (A.nBase >= 8) {
      const cv = A.avgEng ? stdev(A.posts.filter((p) => p.hasEng).map((p) => p.eng)) / A.avgEng : null;
      if (isNum(cv) && cv < 0.08) add('warn', 'Interazioni quasi identiche in ogni post', 'Numeri troppo regolari sono insoliti per un pubblico vero.');
      else if (isNum(cv)) add('ok', 'Interazioni variabili in modo naturale', 'Post diversi ottengono risultati diversi, come succede di solito.');
    }
    if (isNum(A.ratio) && A.ratio < 0.3 && (A.following || 0) >= 1000) add('warn', 'Segue molti più account di quanti lo seguono', 'Tipico della strategia "segui per farti seguire".');
    if (isNum(A.ratio) && A.ratio >= 1) add('ok', 'Più follower che account seguiti', 'Rapporto follower/seguiti di ' + fmtDec(A.ratio) + '.');
    return S;
  }

  /* ---------------- valore indicativo di un post sponsorizzato ---------------- */
  function valueOf(A) {
    if (!isNum(A.followers) || A.followers < 1000 || !isNum(A.er)) return null;
    const mid = (A.tier.lo + A.tier.hi) / 2;
    const f = clamp(A.er / mid, 0.4, 2);
    const k = A.followers / 1000;
    const round = (x) => (x < 100 ? Math.round(x / 5) * 5 : x < 1000 ? Math.round(x / 10) * 10 : Math.round(x / 50) * 50);
    return { lo: round(k * 5 * f), hi: round(k * 12 * f), story: [round(k * 2 * f), round(k * 5 * f)] };
  }

  /* ---------------- confronto e storico ---------------- */
  function snapshotOf(P, A) {
    return { at: A.at, followers: A.followers, following: A.following, posts: A.postsCount, er: A.er, avgLikes: A.avgLikes, avgComments: A.avgComments, score: A.score.total };
  }
  function growthOf(history) {
    const h = (history || []).filter((s) => isNum(s.followers)).sort((a, b) => a.at - b.at);
    if (h.length < 2) return null;
    const a = h[0], b = h[h.length - 1];
    const days = Math.max((b.at - a.at) / DAY, 1);
    return { from: a.at, to: b.at, delta: b.followers - a.followers, pct: a.followers ? ((b.followers - a.followers) / a.followers) * 100 : null, perDay: (b.followers - a.followers) / days, points: h };
  }

  /* ---------------- API ufficiali di Meta (Instagram Graph API) ----------------
     Due tipi di token:
     - "EAA…" (Accesso con Facebook): graph.facebook.com. Permette anche di
       analizzare altri profili Business/Creator con business_discovery.
     - "IG…" (Accesso con Instagram): graph.instagram.com. Solo il proprio account. */
  const API_VERSION = 'v25.0';
  function tokenKind(token) { return /^IG/.test(String(token || '').trim()) ? 'ig' : 'fb'; }
  function graphBase(token) { return tokenKind(token) === 'ig' ? 'https://graph.instagram.com' : 'https://graph.facebook.com'; }
  class ApiError extends Error {
    constructor(err, status) {
      const e = err || {};
      super(e.message || 'Errore ' + status);
      this.code = e.code; this.sub = e.error_subcode; this.status = status; this.type = e.type; this.raw = e;
    }
  }
  function explainError(e) {
    if (!e) return 'Errore sconosciuto.';
    if (e.status === 0) return 'Nessuna connessione con Meta. Controlla la rete e riprova.';
    const c = e.code;
    if (c === 190 || c === 102 || /token/i.test(e.message || '') && /expir|scadut|invalid|session/i.test(e.message || '')) return 'Il token non è valido o è scaduto. Generane uno nuovo (vedi la Guida).';
    if (c === 4 || c === 17 || c === 32 || c === 613 || c === 80002) return 'Meta ha messo un limite temporaneo alle richieste. Riprova tra un\'ora circa.';
    if (c === 110 || /business_discovery|cannot be found|invalid user id/i.test(e.message || '')) return 'Non trovo questo profilo: deve esistere, essere pubblico ed essere un account Business o Creator (i profili personali non si possono leggere).';
    if (c === 10 || c === 200 || /permission/i.test(e.message || '')) return 'Al token mancano dei permessi (servono instagram_basic, instagram_manage_insights, pages_show_list, business_management).';
    if (c === 100) return 'Richiesta non accettata da Meta: ' + (e.message || '');
    return 'Meta ha risposto: ' + (e.message || 'errore ' + e.status);
  }
  async function pool(items, n, fn) {
    const out = new Array(items.length);
    let i = 0;
    const run = async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } };
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
    return out;
  }
  const MEDIA_FULL = 'id,caption,like_count,comments_count,timestamp,media_type,media_product_type,permalink,media_url,thumbnail_url';
  const MEDIA_SAFE = 'id,caption,like_count,comments_count,timestamp,media_type,permalink';
  function mediaToPost(m) {
    const prod = String(m.media_product_type || '').toUpperCase(), mt = String(m.media_type || '').toUpperCase();
    const type = prod === 'REELS' ? 'reel' : mt === 'CAROUSEL_ALBUM' ? 'carousel' : mt === 'VIDEO' ? 'video' : 'image';
    return {
      id: m.id, ts: parseDate(m.timestamp), type, caption: m.caption || '',
      likes: isNum(m.like_count) ? m.like_count : null, comments: isNum(m.comments_count) ? m.comments_count : null,
      views: isNum(m.view_count) ? m.view_count : null, url: m.permalink || '',
      thumb: (mt === 'VIDEO' ? m.thumbnail_url : m.media_url) || m.thumbnail_url || '',
    };
  }
  function makeApi(opts) {
    const token = String(opts.token || '').trim();
    const version = opts.version || API_VERSION;
    const fetchFn = opts.fetch || (typeof fetch !== 'undefined' ? fetch.bind(root) : null);
    const base = graphBase(token);
    const kind = tokenKind(token);
    async function get(path, params) {
      const u = new URL(base + '/' + version + '/' + String(path).replace(/^\//, ''));
      for (const k in params || {}) u.searchParams.set(k, params[k]);
      u.searchParams.set('access_token', token);
      let res;
      try { res = await fetchFn(u.toString()); } catch (e) { throw new ApiError({ message: 'Rete non raggiungibile' }, 0); }
      let j = null;
      try { j = await res.json(); } catch (e) { j = null; }
      if (!res.ok || !j || j.error) throw new ApiError(j && j.error, res.status);
      return j;
    }
    async function getFallback(path, fieldSets, extra) {
      let lastErr;
      for (const f of fieldSets) {
        try { return await get(path, Object.assign({ fields: f }, extra || {})); } catch (e) { lastErr = e; if (e.code !== 100) throw e; }
      }
      throw lastErr;
    }
    /* Gli account Instagram collegati al token */
    async function accounts() {
      if (kind === 'ig') {
        const me = await getFallback('me', ['user_id,username,name,profile_picture_url,followers_count', 'user_id,username', 'id,username']);
        return [{ id: me.user_id || me.id, username: me.username, name: me.name || '', avatar: me.profile_picture_url || '', followers: me.followers_count, page: '' }];
      }
      const j = await get('me/accounts', { fields: 'name,instagram_business_account{id,username,name,profile_picture_url,followers_count}', limit: 100 });
      return (j.data || []).filter((p) => p.instagram_business_account).map((p) => {
        const a = p.instagram_business_account;
        return { id: a.id, username: a.username, name: a.name || '', avatar: a.profile_picture_url || '', followers: a.followers_count, page: p.name };
      });
    }
    /* Un altro profilo Business/Creator (solo con token EAA…) */
    async function discover(igId, username, max, onProgress) {
      if (kind === 'ig') throw new ApiError({ message: 'Per analizzare altri profili serve un token "Accesso con Facebook" (inizia con EAA).', code: 10 }, 400);
      const user = cleanUser(username);
      const USER = 'username,name,biography,website,profile_picture_url,followers_count,follows_count,media_count';
      let mediaFields = MEDIA_FULL + ',view_count';
      const posts = [];
      let after = null, info = null, guard = 0;
      max = max || 50;
      while (posts.length < max && guard++ < 40) {
        const lim = Math.min(50, max - posts.length);
        const media = 'media' + (after ? '.after(' + after + ')' : '') + '.limit(' + lim + '){' + mediaFields + '}';
        let j;
        try {
          j = await get(igId, { fields: 'business_discovery.username(' + user + '){' + USER + ',' + media + '}' });
        } catch (e) {
          if (e.code === 100 && mediaFields !== MEDIA_SAFE && /field|campo|nonexist/i.test(e.message || '')) { mediaFields = mediaFields === MEDIA_FULL + ',view_count' ? MEDIA_FULL : MEDIA_SAFE; continue; }
          throw e;
        }
        const bd = j.business_discovery || {};
        if (!info) info = bd;
        const data = (bd.media && bd.media.data) || [];
        for (const m of data) posts.push(mediaToPost(m));
        if (onProgress) onProgress(posts.length, Math.min(max, bd.media_count || max));
        const next = bd.media && bd.media.paging && bd.media.paging.cursors && bd.media.paging.cursors.after;
        if (!data.length || data.length < lim || !next || next === after) break;
        after = next;
      }
      info = info || {};
      return {
        source: 'api', username: info.username || user, name: info.name || '', bio: info.biography || '', website: info.website || '',
        avatar: info.profile_picture_url || '', followers: info.followers_count, following: info.follows_count, postsCount: info.media_count,
        posts: posts.slice(0, max), fetchedAt: Date.now(), own: false,
      };
    }
    /* Il proprio account, con insights */
    async function own(igId, max, withInsights, onProgress) {
      const node = kind === 'ig' ? 'me' : igId;
      const info = await getFallback(node, [
        'username,name,biography,website,profile_picture_url,followers_count,follows_count,media_count',
        'username,name,profile_picture_url,followers_count,follows_count,media_count',
        'username,followers_count,media_count',
      ]);
      max = max || 50;
      const posts = [];
      let after = null, guard = 0, fields = MEDIA_FULL;
      while (posts.length < max && guard++ < 40) {
        const lim = Math.min(50, max - posts.length);
        let j;
        try {
          const p = { fields, limit: lim };
          if (after) p.after = after;
          j = await get(node + '/media', p);
        } catch (e) {
          if (e.code === 100 && fields !== MEDIA_SAFE) { fields = MEDIA_SAFE; continue; }
          throw e;
        }
        const data = j.data || [];
        for (const m of data) posts.push(mediaToPost(m));
        if (onProgress) onProgress('media', posts.length, Math.min(max, info.media_count || max));
        const next = j.paging && j.paging.cursors && j.paging.cursors.after;
        if (!data.length || !(j.paging && j.paging.next) || !next || next === after) break;
        after = next;
      }
      const P = {
        source: 'api', own: true, username: info.username || '', name: info.name || '', bio: info.biography || '', website: info.website || '',
        avatar: info.profile_picture_url || '', followers: info.followers_count, following: info.follows_count, postsCount: info.media_count,
        posts: posts.slice(0, max), fetchedAt: Date.now(), insights: null,
      };
      if (withInsights) P.insights = await insights(node, P.posts, onProgress);
      return P;
    }
    async function mediaInsights(post) {
      const sets = ['reach,saved,shares,views,total_interactions', 'reach,saved,shares', 'reach,saved', 'reach'];
      for (const metric of sets) {
        try {
          const j = await get(post.id + '/insights', { metric });
          const out = {};
          for (const d of j.data || []) {
            const v = d.values && d.values[0] ? d.values[0].value : d.total_value ? d.total_value.value : null;
            if (isNum(v)) out[d.name] = v;
          }
          return out;
        } catch (e) {
          if (e.code === 100 || e.code === 10) continue;
          throw e;
        }
      }
      return {};
    }
    async function insights(node, posts, onProgress) {
      const res = { media: 0, demographics: {}, account: {}, followerDays: [], errors: [] };
      let done = 0;
      const targets = posts.filter((p) => p.type !== 'story').slice(0, 60);
      await pool(targets, 4, async (p) => {
        try {
          const m = await mediaInsights(p);
          if (isNum(m.reach)) p.reach = m.reach;
          if (isNum(m.saved)) p.saves = m.saved;
          if (isNum(m.shares)) p.shares = m.shares;
          if (isNum(m.views)) p.views = m.views;
          if (Object.keys(m).length) res.media++;
        } catch (e) { if (res.errors.length < 3) res.errors.push(explainError(e)); }
        done++;
        if (onProgress) onProgress('insights', done, targets.length);
      });
      for (const br of ['country', 'city', 'age', 'gender']) {
        try {
          const j = await get(node + '/insights', { metric: 'follower_demographics', period: 'lifetime', metric_type: 'total_value', breakdown: br });
          const d = (j.data || [])[0];
          const results = d && d.total_value && d.total_value.breakdowns && d.total_value.breakdowns[0] ? d.total_value.breakdowns[0].results || [] : [];
          res.demographics[br] = results.map((r) => ({ k: (r.dimension_values || [])[0], n: r.value })).filter((r) => r.k && isNum(r.n)).sort((a, b) => b.n - a.n);
        } catch (e) { /* sotto i 100 follower i dati demografici non ci sono */ }
      }
      const until = Math.floor(Date.now() / 1000), since = until - 28 * 86400;
      const metrics = ['reach', 'views', 'accounts_engaged', 'total_interactions', 'profile_links_taps'];
      const readTotals = (j) => { for (const d of j.data || []) if (d.total_value && isNum(d.total_value.value)) res.account[d.name] = d.total_value.value; };
      try { readTotals(await get(node + '/insights', { metric: metrics.join(','), period: 'day', metric_type: 'total_value', since, until })); } catch (e) {
        for (const m of metrics) { try { readTotals(await get(node + '/insights', { metric: m, period: 'day', metric_type: 'total_value', since, until })); } catch (e2) { /* metrica non disponibile */ } }
      }
      try {
        const j = await get(node + '/insights', { metric: 'follower_count', period: 'day', since, until });
        const d = (j.data || [])[0];
        res.followerDays = d && Array.isArray(d.values) ? d.values.map((v) => ({ ts: parseDate(v.end_time), n: v.value })).filter((v) => v.ts && isNum(v.n)) : [];
      } catch (e) { /* non disponibile */ }
      return res;
    }
    return { get, accounts, discover, own, kind, base };
  }

  /* ---------------- profilo d'esempio (dati inventati) ---------------- */
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function demoProfile(variant, now) {
    now = now || Date.now();
    const v = variant === 2
      ? { seed: 7, username: 'demo.band', name: 'Band d\'esempio', followers: 48200, following: 610, posts: 412, n: 45, base: 520, reel: 1.2, every: 4.2 }
      : { seed: 3, username: 'demo.artista', name: 'Artista d\'esempio', followers: 12840, following: 438, posts: 214, n: 60, base: 205, reel: 1.9, every: 3.3 };
    const r = rng(v.seed);
    const capts = [
      'Nuovo singolo fuori ora! Link in bio 🎧 #nuovamusica #musicaitaliana #indie',
      'Studio day ☕️ cosa vorreste sentire nel prossimo pezzo? #studio #producer',
      'Grazie Milano, che serata ❤️ #live #concerto #milano',
      'Dietro le quinte del video 🎬 #backstage #videoclip',
      'Prove per il tour, ci vediamo sotto il palco? #tour #live',
      'Un pezzo a cui tengo tanto. Ascoltalo e dimmi cosa ne pensi 👇 #cantautore #musicaitaliana',
      'Copertina del disco, vi piace? #artwork #album',
      'Sessione acustica in salotto 🎸 #acoustic #cover',
      'Domenica lenta.',
      'Countdown: mancano 3 giorni! #nuovamusica #release',
      '',
      'Con @demo.producer in studio, presto novità #producer #studio',
    ];
    const posts = [];
    let t = now - 0.4 * DAY;
    for (let i = 0; i < v.n; i++) {
      const roll = r();
      const type = roll < 0.42 ? 'reel' : roll < 0.68 ? 'carousel' : roll < 0.95 ? 'image' : 'video';
      const d = new Date(t);
      const evening = [18, 19, 20, 21][Math.floor(r() * 4)], midday = [12, 13, 14][Math.floor(r() * 3)];
      d.setHours(r() < 0.65 ? evening : midday, Math.floor(r() * 60), 0, 0);
      let ts = d.getTime();
      if (ts > now - 3600e3) ts -= DAY;
      const day = dayIdx(ts);
      const cap = capts[Math.floor(r() * capts.length)];
      let f = v.base * (type === 'reel' ? v.reel : type === 'carousel' ? 1.25 : type === 'video' ? 1.1 : 0.85);
      if (day === 3 || day === 4) f *= 1.3;
      if (day === 0) f *= 0.8;
      if (new Date(ts).getHours() >= 18) f *= 1.15;
      if (/\?/.test(cap)) f *= 1.2;
      f *= 1 + (v.n - i) / v.n * 0.25; // un po' di crescita nel tempo
      f *= 0.6 + r() * 0.8;
      if (i === 7) f *= 3.2; // un post "virale"
      const likes = Math.round(f);
      const comments = Math.round(likes * (0.02 + r() * 0.04));
      posts.push({
        id: 'demo' + v.seed + '_' + i, ts, type, caption: cap, likes, comments,
        views: type === 'reel' || type === 'video' ? Math.round(likes * (9 + r() * 8)) : null, url: '',
      });
      t -= DAY * v.every * (0.4 + r() * 1.3) + (i === 30 ? 24 * DAY : 0);
    }
    const history = [];
    for (let k = 6; k >= 1; k--) history.push({ at: now - k * 30 * DAY, followers: Math.round(v.followers * (1 - k * 0.035 + (r() - 0.5) * 0.01)) });
    return {
      source: 'demo', username: v.username, name: v.name, bio: 'Musica, live e dietro le quinte. Nuovo singolo fuori ora 👇',
      website: 'https://example.com', avatar: '', followers: v.followers, following: v.following, postsCount: v.posts,
      posts, fetchedAt: now, demoHistory: history,
    };
  }
  /* export d'esempio, nello stesso formato dei file veri */
  function demoExportFiles(now) {
    now = now || Date.now();
    const r = rng(11);
    const S = (sec) => Math.floor(sec / 1000);
    const names = [];
    for (let i = 0; i < 420; i++) names.push(['luca', 'giulia', 'marco', 'sara', 'ale', 'fede', 'chiara', 'davide', 'marta', 'paolo', 'ele', 'nico'][i % 12] + '.' + ['music', 'foto', 'live', 'art', 'mi', 'rm', 'to', 'na'][Math.floor(i / 12) % 8] + (i > 95 ? i : ''));
    const followers = names.slice(0, 340).map((u, i) => ({ title: '', media_list_data: [], string_list_data: [{ href: 'https://www.instagram.com/' + u, value: u, timestamp: S(now - (r() * 900 + (i < 20 ? -880 : 0)) * DAY) }] }));
    const following = names.slice(60, 420).map((u) => ({ title: u, string_list_data: [{ href: 'https://www.instagram.com/_u/' + u, timestamp: S(now - r() * 1000 * DAY) }] }));
    const mk = (u, days) => ({ title: '', string_list_data: [{ href: 'https://www.instagram.com/' + u, value: u, timestamp: S(now - days * DAY) }] });
    const posts = [];
    for (let i = 0; i < 48; i++) {
      const ts = S(now - (i * 9 + r() * 5) * DAY);
      const cap = ['Live a Roma 🎤 #live #roma', 'Nuovo pezzo #nuovamusica', 'Studio #studio #producer', 'Estate ☀️'][i % 4];
      posts.push(i % 3 === 0
        ? { media: [{ uri: 'media/posts/a.jpg', creation_timestamp: ts, title: '' }, { uri: 'media/posts/b.jpg', creation_timestamp: ts, title: '' }], title: cap, creation_timestamp: ts }
        : { media: [{ uri: i % 3 === 1 ? 'media/posts/c.mp4' : 'media/posts/d.jpg', creation_timestamp: ts, title: cap }] });
    }
    const reels = { ig_reels_media: Array.from({ length: 14 }, (_, i) => ({ media: [{ uri: 'media/reels/r.mp4', creation_timestamp: S(now - (i * 21 + 3) * DAY), title: 'Reel ' + (i + 1) + ' #reels' }] })) };
    const stories = { ig_stories: Array.from({ length: 90 }, (_, i) => ({ uri: 'media/stories/s.jpg', creation_timestamp: S(now - i * 6 * DAY), title: '' })) };
    const likes = { likes_media_likes: Array.from({ length: 300 }, (_, i) => ({ title: names[Math.floor(Math.pow(r(), 2) * 120)], string_list_data: [{ href: 'https://www.instagram.com/p/x' + i + '/', value: '👍', timestamp: S(now - r() * 400 * DAY) }] })) };
    const comments = Array.from({ length: 40 }, (_, i) => ({ string_map_data: { Comment: { value: 'Bellissimo! 🔥' }, 'Media Owner': { value: names[Math.floor(r() * 50)] }, Time: { timestamp: S(now - i * 7 * DAY) } } }));
    return [
      { path: 'connections/followers_and_following/followers_1.json', text: JSON.stringify(followers) },
      { path: 'connections/followers_and_following/following.json', text: JSON.stringify({ relationships_following: following }) },
      { path: 'connections/followers_and_following/recently_unfollowed_profiles.json', text: JSON.stringify({ relationships_unfollowed_users: [mk('ex.amico', 12), mk('vecchio.profilo', 40)] }) },
      { path: 'connections/followers_and_following/pending_follow_requests.json', text: JSON.stringify({ relationships_follow_requests_sent: [mk('profilo.privato', 5)] }) },
      { path: 'connections/followers_and_following/close_friends.json', text: JSON.stringify({ relationships_close_friends: names.slice(60, 72).map((u) => mk(u, 200)) }) },
      { path: 'your_instagram_activity/content/posts_1.json', text: JSON.stringify(posts) },
      { path: 'your_instagram_activity/content/reels.json', text: JSON.stringify(reels) },
      { path: 'your_instagram_activity/content/stories.json', text: JSON.stringify(stories) },
      { path: 'your_instagram_activity/likes/liked_posts.json', text: JSON.stringify(likes) },
      { path: 'your_instagram_activity/comments/post_comments_1.json', text: JSON.stringify(comments) },
      { path: 'personal_information/personal_information/personal_information.json', text: JSON.stringify({ profile_user: [{ string_map_data: { Username: { value: 'demo.artista' }, Name: { value: 'Artista d\'esempio' }, Bio: { value: 'Musica e live' } } }] }) },
    ];
  }

  const Lente = {
    DAY, DAYS, DAYS_LONG, SLOTS, TYPE_LABEL, TIERS, API_VERSION,
    mean, median, stdev, countBy, monthKey,
    fmtNum, fmtCompact, fmtPct, fmtDec, fmtDate, fmtMonth, fmtEuro, agoText, calDays,
    fixText, parseJSON, cleanUser, userFromHref, kindOf, looksLikeHtmlExport,
    parseExport, analyzeExport, followersSnapshot, byMonth,
    zipEntries, zipRead, readExportZip,
    parseCSV, parseNum, parseDate, csvToPosts, postsToCSV, listToCSV,
    hashtagsOf, mentionsOf, tierOf, erRating, normPost, analyze, snapshotOf, growthOf,
    tokenKind, graphBase, makeApi, explainError, ApiError, mediaToPost,
    demoProfile, demoExportFiles,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Lente;
  else root.Lente = Lente;
})(typeof self !== 'undefined' ? self : this);
