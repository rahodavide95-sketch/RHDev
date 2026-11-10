/* Copia in PDF di un invio (per l'artista e per l'etichetta), fatta nel browser:
   i dati non passano da nessun server. Usa html2pdf (vendor/, versione fissa, caricato solo quando serve). */

import { h, append, fmtDateTime } from './dom.js';
import { renderRich } from './rich.js';
import { formatValue, formatDate } from '../core/answers.js';
import { safeImage, sanitizeContractStyle, contractVars } from '../core/theme.js';
import { isStatic } from '../core/schema.js';
import { tr } from '../core/i18n.js';

let loading = null;
function loadLib() {
  if (window.html2pdf) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('../../vendor/html2pdf.bundle.min.js', import.meta.url).href;
      s.onload = () => resolve();
      s.onerror = () => { loading = null; reject(new Error(tr('Non riesco a caricare il generatore di PDF', 'Could not load the PDF generator'))); };
      document.head.append(s);
    });
  }
  return loading;
}

/* Logo su carta bianca: un logo chiaro su fondo trasparente (es. bianco) sparirebbe, quindi con
   "automatico" gli mettiamo dietro un fondo scuro. Il controllo si fa una volta per immagine. */
const logoTones = new Map();
export function logoTone(src) {
  if (!src) return Promise.resolve('none');
  if (logoTones.has(src)) return logoTones.get(src);
  const p = new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const n = 48, c = document.createElement('canvas'); c.width = n; c.height = n;
        const x = c.getContext('2d'); x.drawImage(img, 0, 0, n, n);
        const d = x.getImageData(0, 0, n, n).data;
        let clear = 0, sum = 0, cnt = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 40) { clear++; continue; }
          sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255; cnt++;
        }
        resolve(cnt && clear / (n * n) > 0.04 && sum / cnt > 0.78 ? 'dark' : 'none');
      } catch { resolve('none'); }
    };
    img.onerror = () => resolve('none');
    img.src = src;
  });
  logoTones.set(src, p);
  return p;
}

function letterhead(name, logo, st) {
  if (!logo) return h('div.cd-letterhead', h('div.cd-label-logo.cd-label-logo--text', name || ''));
  const img = h('img', { src: logo, alt: name || '' });
  if (st.logoBg === 'dark' || st.logoBg === 'light') img.dataset.bg = st.logoBg;
  else if (st.logoBg === 'auto') logoTone(logo).then(t => { if (t !== 'none') img.dataset.bg = t; });
  return h('div.cd-letterhead', h('div.cd-label-logo', img));
}

/** Il contratto come documento (sullo schermo, nell'anteprima e nel PDF). Stessa impaginazione del
    contratto dell'etichetta: pagina dell'accordo e pagina dei dati con le firme. */
export function contractDoc(snap, { label = {}, signedAt = '', hash = '' } = {}) {
  const v2 = snap && snap.v === 2;
  const st = sanitizeContractStyle(v2 ? snap.style : null);
  const name = snap.label || label.name || '';
  const logo = safeImage(label.logo || '');
  const s = snap.signature || {};
  const root = h('div.cdoc', { dataset: { align: st.align, title: st.titleAlign, logo: st.logoPos, signs: st.signs } });
  for (const [k, v] of Object.entries(contractVars(st))) root.style.setProperty(k, v);
  if (st.titleUpper) root.classList.add('cd-upper');
  if (st.titleBar) root.classList.add('cd-bar');
  if (st.headLine) root.classList.add('cd-rule');
  if (st.frame) root.classList.add('cd-paper');

  const cell = (role, png, who, meta) => h('div.cd-sgn', h('span.cd-sgn-role', role),
    safeImage(png)
      ? [h('img.cd-sig-img', { src: safeImage(png), alt: tr('Firma', 'Signature') }), h('div.cd-sig-meta', h('b', who || ''), meta ? [h('br'), meta] : null)]
      : h('div.cd-sgn-blank', h('span', (v2 && snap.blank) || 'Date / Signature'), h('hr')));
  const artistMeta = [formatDate(s.date), s.time].filter(Boolean).join(' ') + (s.place ? ' · ' + s.place : '');
  const signs = () => h('div.cd-signs',
    cell(v2 ? snap.labelRole : tr(`Per l'etichetta — ${name}`, `For the Label — ${name}`), snap.labelSignature, (v2 && snap.labelSigner) || label.signer || '', s.png ? formatDate(s.date) : ''),
    cell(v2 ? snap.artistRole : tr('Per l\'artista', 'For the Artist'), s.png, s.name, s.png ? artistMeta : ''));
  const closing = () => [
    v2 && snap.confirm ? h('p', snap.confirm) : null,
    v2 && snap.dateLabel ? h('p', h('b', snap.dateLabel), ' ', snap.dateText || '—') : null,
    signs(),
  ];

  const body = h('div.rt.cd-body'); body.append(renderRich(snap.doc || []));
  const page1 = h('div.cd-page', letterhead(name, logo, st), h('h3.cd-title', snap.title || ''));
  if (v2 && snap.intro && snap.intro.length) { const intro = h('div.rt.cd-intro'); intro.append(renderRich(snap.intro)); page1.append(intro); }
  page1.append(body);
  root.append(page1);
  if (v2 && snap.copyPage) {
    const copy = h('div.rt.cd-body.cd-copy'); copy.append(renderRich(snap.copy || []));
    root.append(h('div.cd-page.cd-page--copy', letterhead(name, logo, st), h('h3.cd-title', snap.copyTitle || ''), copy, closing()));
  } else if (v2) {
    append(page1, closing());
  } else {
    append(page1, [snap.accept ? h('p', h('em', snap.accept)) : null, signs()]);
  }
  if (signedAt || hash) root.append(h('p.cd-foot',
    signedAt ? tr(`Firmato il ${fmtDateTime(signedAt)} (ora registrata dal server). `, `Signed on ${fmtDateTime(signedAt)} (time recorded by the server). `) : '',
    hash ? tr('Impronta SHA-256: ', 'SHA-256 fingerprint: ') + `${hash.slice(0, 16)}…${hash.slice(-8)}` : ''));
  return root;
}

/** Documento completo: dati per sezione + contratto. */
export function copyDocument({ form, answers, label = {}, release = {}, artist = '', when = '', version = 0, contract = null, mask = false }) {
  const secs = [];
  for (const s of form.sections) {
    const rows = s.fields.filter(f => !isStatic(f)).map(f => {
      const v = formatValue(f, answers[f.id], { mask });
      return h('tr', h('th', f.label), h('td', v || '—'));
    });
    if (!rows.length) continue;
    secs.push(h('section.pdf-sec', h('h3', s.title || tr('Dati', 'Details')), h('table', h('tbody', rows))));
  }
  const logo = safeImage(label.logo || '');
  return h('div.pdf-doc',
    h('div.pdf-top',
      h('div', h('div.pdf-label', label.name || ''), h('h1', form.title),
        h('div.pdf-sub', [release.title, release.catalog].filter(Boolean).join(' · ')),
        h('div.pdf-sub', `${artist}${when ? ' · ' + fmtDateTime(when) : ''}${version ? tr(' · versione ', ' · version ') + version : ''}`)),
      logo ? h('img.pdf-logo', { src: logo, alt: '', ref: el => logoTone(logo).then(t => { if (t !== 'none') el.dataset.bg = t; }) }) : null),
    secs,
    contract ? h('div.pdf-break') : null,
    contract ? contractDoc(contract.snap, { label, signedAt: contract.signedAt, hash: contract.hash }) : null,
    h('p.pdf-foot', tr('Copia generata nel browser. I dati viaggiano e restano cifrati: solo l\'etichetta e l\'artista (con la sua password) possono leggerli.', 'Copy generated in the browser. The data travels and stays encrypted: only the label and the artist (with their password) can read it.')));
}

export async function savePdf(docEl, filename) {
  await loadLib();
  const host = h('div.pdf-host', docEl);
  document.body.append(host);
  try {
    await window.html2pdf().set({
      margin: [10, 10, 12, 10], filename,
      image: { type: 'jpeg', quality: 0.96 },
      html2canvas: { scale: 2, useCORS: false, backgroundColor: '#ffffff', windowWidth: 740 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.cd-signs', '.cd-sgn', '.pdf-top', '.cd-letterhead'] },
    }).from(docEl).save();
  } finally {
    host.remove();
  }
}

export const pdfName = (...parts) => parts.filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]+/g, '').slice(0, 120) + '.pdf';
