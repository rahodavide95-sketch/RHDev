/* Controllo dei link incollati dagli artisti: che siano davvero di Drive, Dropbox, SoundCloud…,
   che non ci siano errori di battitura nel dominio e che non siano link "sbagliati"
   (la propria cartella personale invece del file condiviso, link che scadono, ecc.). */

import { tr } from './i18n.js';

export const PROVIDERS = [
  { id: 'gdrive', name: 'Google Drive', hosts: ['drive.google.com', 'docs.google.com'], kinds: ['files', 'audio'] },
  { id: 'dropbox', name: 'Dropbox', hosts: ['dropbox.com', 'db.tt', 'dl.dropboxusercontent.com'], kinds: ['files', 'audio'] },
  { id: 'onedrive', name: 'OneDrive', hosts: ['1drv.ms', 'onedrive.live.com', 'sharepoint.com'], kinds: ['files', 'audio'] },
  { id: 'icloud', name: 'iCloud Drive', hosts: ['icloud.com'], kinds: ['files', 'audio'] },
  { id: 'box', name: 'Box', hosts: ['box.com', 'app.box.com'], kinds: ['files', 'audio'] },
  { id: 'mega', name: 'MEGA', hosts: ['mega.nz', 'mega.io'], kinds: ['files', 'audio'] },
  { id: 'pcloud', name: 'pCloud', hosts: ['pcloud.link', 'pcloud.com'], kinds: ['files', 'audio'] },
  { id: 'wetransfer', name: 'WeTransfer', hosts: ['wetransfer.com', 'we.tl'], kinds: ['files', 'audio'], expires: true },
  { id: 'swisstransfer', name: 'SwissTransfer', hosts: ['swisstransfer.com'], kinds: ['files', 'audio'], expires: true },
  { id: 'smash', name: 'Smash', hosts: ['fromsmash.com'], kinds: ['files', 'audio'], expires: true },
  { id: 'disco', name: 'DISCO', hosts: ['disco.ac'], kinds: ['audio'] },
  { id: 'soundcloud', name: 'SoundCloud', hosts: ['soundcloud.com', 'on.soundcloud.com', 'snd.sc'], kinds: ['audio', 'social', 'music'] },
  { id: 'bandcamp', name: 'Bandcamp', hosts: ['bandcamp.com'], kinds: ['music', 'social'] },
  { id: 'spotify', name: 'Spotify', hosts: ['open.spotify.com', 'spotify.link', 'spotify.com'], kinds: ['music', 'social'] },
  { id: 'applemusic', name: 'Apple Music', hosts: ['music.apple.com'], kinds: ['music'] },
  { id: 'beatport', name: 'Beatport', hosts: ['beatport.com'], kinds: ['music'] },
  { id: 'mixcloud', name: 'Mixcloud', hosts: ['mixcloud.com'], kinds: ['audio', 'music', 'social'] },
  { id: 'youtube', name: 'YouTube', hosts: ['youtube.com', 'youtu.be', 'music.youtube.com'], kinds: ['video', 'music', 'social'] },
  { id: 'vimeo', name: 'Vimeo', hosts: ['vimeo.com'], kinds: ['video'] },
  { id: 'instagram', name: 'Instagram', hosts: ['instagram.com', 'instagr.am'], kinds: ['social'] },
  { id: 'facebook', name: 'Facebook', hosts: ['facebook.com', 'fb.com', 'fb.me'], kinds: ['social'] },
  { id: 'tiktok', name: 'TikTok', hosts: ['tiktok.com'], kinds: ['social', 'video'] },
  { id: 'x', name: 'X (Twitter)', hosts: ['x.com', 'twitter.com'], kinds: ['social'] },
  { id: 'threads', name: 'Threads', hosts: ['threads.net', 'threads.com'], kinds: ['social'] },
  { id: 'ra', name: 'Resident Advisor', hosts: ['ra.co', 'residentadvisor.net'], kinds: ['social', 'music'] },
  { id: 'linktree', name: 'Linktree', hosts: ['linktr.ee'], kinds: ['social'] },
];

export const LINK_KINDS = {
  any: { label: 'Qualsiasi sito', hint: 'Un indirizzo web qualsiasi.', en: 'Any web address.' },
  files: { label: 'Cartella o file (Drive, Dropbox…)', hint: 'Google Drive, Dropbox, OneDrive, iCloud, WeTransfer…', en: 'Google Drive, Dropbox, OneDrive, iCloud, WeTransfer…' },
  audio: { label: 'Audio (Drive, Dropbox, SoundCloud privato…)', hint: 'Google Drive, Dropbox, SoundCloud (anche privato), DISCO…', en: 'Google Drive, Dropbox, SoundCloud (private too), DISCO…' },
  social: { label: 'Profilo social', hint: 'Instagram, SoundCloud, Facebook, TikTok, RA, Linktree…', en: 'Instagram, SoundCloud, Facebook, TikTok, RA, Linktree…' },
  music: { label: 'Musica pubblicata', hint: 'Spotify, Bandcamp, Beatport, Apple Music, SoundCloud…', en: 'Spotify, Bandcamp, Beatport, Apple Music, SoundCloud…' },
  video: { label: 'Video', hint: 'YouTube, Vimeo, TikTok…', en: 'YouTube, Vimeo, TikTok…' },
};

const hostMatches = (host, h) => host === h || host.endsWith('.' + h);
export const providerOf = host => PROVIDERS.find(p => p.hosts.some(h => hostMatches(host, h))) || null;

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Dominio scritto male? Restituisce quello giusto più vicino (es. "drive.gogle.com" → "drive.google.com"). */
export function typoSuggestion(host) {
  const h = host.replace(/^www\./, '');
  if (providerOf(h)) return '';
  let best = '', bestD = 99;
  for (const p of PROVIDERS) {
    for (const k of p.hosts) {
      // confronta anche solo la parte finale (es. "m.soundclod.com" ↔ "soundcloud.com")
      const tail = h.split('.').slice(-k.split('.').length).join('.');
      for (const cand of new Set([h, tail])) {
        const dist = editDistance(cand, k);
        const limit = k.length >= 9 ? 2 : 1;
        if (dist > 0 && dist <= limit && dist < bestD) { best = k; bestD = dist; }
      }
    }
  }
  return best;
}

/**
 * Controlla un link. kind: 'any' | 'files' | 'audio' | 'social' | 'music' | 'video'
 * → { ok, url, provider, error, warning }
 */
/** Elenco dei siti accettati, nella lingua attiva. */
export const kindHint = kind => { const k = LINK_KINDS[kind]; return k ? tr(k.hint, k.en || k.hint) : ''; };

export function checkLink(input, kind = 'any') {
  let s = String(input || '').trim();
  const res = { ok: false, url: '', provider: null, error: '', warning: '' };
  if (!s) { res.error = tr('Incolla un link.', 'Paste a link.'); return res; }
  if (s.length > 2000) { res.error = tr('Il link è troppo lungo.', 'The link is too long.'); return res; }
  if (/\s/.test(s)) {
    const parts = s.split(/\s+/).filter(Boolean);
    res.error = parts.length > 1 && parts.every(p => /^https?:\/\//i.test(p)) ? tr('Hai incollato più link: in questo campo ne va uno solo.', 'You pasted more than one link: this field takes just one.') : tr('Il link non deve contenere spazi.', 'The link must not contain spaces.');
    return res;
  }
  if (/^(javascript|data|vbscript|file|blob):/i.test(s)) { res.error = tr('Questo non è un link web.', 'This is not a web link.'); return res; }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    if (/^[\w-]+(\.[\w-]+)+(\/|$|\?)/.test(s)) s = 'https://' + s;   // "drive.google.com/…" senza https
    else { res.error = tr('Non sembra un link: deve iniziare con https://', 'This doesn\'t look like a link: it must start with https://'); return res; }
  }
  let url;
  try { url = new URL(s); } catch { res.error = tr('Il link non è valido: copialo di nuovo dall\'app.', 'The link is not valid: copy it again from the app.'); return res; }
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:') { res.error = tr('Il link deve iniziare con https://', 'The link must start with https://'); return res; }
  if (url.username || url.password) { res.error = tr('Il link non deve contenere nome utente o password.', 'The link must not contain a username or password.'); return res; }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) || host.includes('..')) {
    const sug = typoSuggestion(host);
    res.error = sug ? tr(`Il dominio sembra sbagliato: forse intendevi ${sug}?`, `The domain looks wrong: did you mean ${sug}?`) : tr('Il dominio del link non è valido.', 'The link\'s domain is not valid.');
    return res;
  }
  const provider = providerOf(host);
  if (!provider) {
    const sug = typoSuggestion(host);
    if (sug) { res.error = tr(`"${host}" sembra scritto male: forse intendevi ${sug}?`, `"${host}" looks misspelled: did you mean ${sug}?`); return res; }
    if (kind !== 'any') {
      res.error = (tr('Questo campo accetta link di: ', 'This field accepts links from: ') + kindHint(kind)).trim();
      return res;
    }
  } else if (kind !== 'any' && !provider.kinds.includes(kind)) {
    res.error = tr(`Un link di ${provider.name} non va bene qui. Accettati: `, `A ${provider.name} link doesn't fit here. Accepted: `) + kindHint(kind);
    return res;
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (provider) {
    if (provider.id === 'gdrive') {
      if (host === 'drive.google.com' && (path === '' || /^\/drive(\/u\/\d+)?\/(my-drive|home|recent|shared-with-me|starred|computers|trash)$/.test(path) || path === '/drive')) {
        res.error = tr('Questo è il link alla tua pagina di Drive, non a un file o una cartella condivisa. Apri il file o la cartella, tocca "Condividi" e copia il link.', 'This is the link to your Drive home, not to a shared file or folder. Open the file or folder, tap "Share" and copy the link.');
        return res;
      }
      if (!/\/(file\/d|drive\/(u\/\d+\/)?folders|open|uc|document\/d|spreadsheets\/d|presentation\/d|drive\/folders)/.test(path + '/') && !url.searchParams.get('id')) {
        res.warning = tr('Controlla che sia il link di condivisione del file o della cartella.', 'Check that this is the sharing link of the file or folder.');
      }
    } else if (provider.id === 'dropbox' && host.endsWith('dropbox.com')) {
      if (path === '' || /^\/(home|recents|photos|requests|deleted_files|account)/.test(path)) {
        res.error = tr('Questo è il link alla tua pagina di Dropbox. Apri il file o la cartella, tocca "Condividi" › "Copia link".', 'This is the link to your Dropbox home. Open the file or folder, tap "Share" › "Copy link".');
        return res;
      }
    } else if (provider.id === 'soundcloud' && /^\/(you|discover|stream|upload|feed)?$/.test(path)) {
      res.error = tr('Questo è il link alla home di SoundCloud: copia il link della traccia o del profilo.', 'This is the SoundCloud home page: copy the link of the track or profile.');
      return res;
    } else if (provider.id === 'instagram' && (path === '' || /^\/(accounts|explore|direct)/.test(path))) {
      res.error = tr('Copia il link del profilo (es. instagram.com/nomeartista).', 'Copy your profile link (e.g. instagram.com/artistname).');
      return res;
    }
    if (provider.expires) res.warning = tr(`I link di ${provider.name} scadono dopo pochi giorni: se puoi usa Google Drive o Dropbox.`, `${provider.name} links expire after a few days: if you can, use Google Drive or Dropbox.`);
  }
  // via i parametri di tracciamento più comuni
  // (mai quelli che servono ad aprire il file, come "rlkey" di Dropbox o "id" di Drive)
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'igshid', 'igsh', 'si']) url.searchParams.delete(k);
  res.ok = true;
  res.url = url.href;
  res.provider = provider ? provider.name : '';
  return res;
}
