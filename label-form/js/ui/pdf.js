/* Copia in PDF di un invio (per l'artista e per l'etichetta), fatta nel browser:
   i dati non passano da nessun server. Usa html2pdf (vendor/, versione fissa, caricato solo quando serve). */

import { h, fmtDateTime } from './dom.js';
import { renderRich } from './rich.js';
import { formatValue, formatDate } from '../core/answers.js';
import { safeImage } from '../core/theme.js';

let loading = null;
function loadLib() {
  if (window.html2pdf) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('../../vendor/html2pdf.bundle.min.js', import.meta.url).href;
      s.onload = () => resolve();
      s.onerror = () => { loading = null; reject(new Error('Non riesco a caricare il generatore di PDF')); };
      document.head.append(s);
    });
  }
  return loading;
}

/** Il contratto firmato come blocco (anche sullo schermo). */
export function contractDoc(snap, { label = {}, signedAt = '', hash = '' } = {}) {
  const logo = safeImage(label.logo || '');
  const sig = (role, img, name, meta) => h('div.c-sign', h('div.c-role', role),
    safeImage(img) ? h('img', { src: safeImage(img), alt: '' }) : h('div.c-line'),
    h('div.c-meta', h('b', name || ''), meta ? h('br') : null, meta || ''));
  const body = h('div.rt');
  body.append(renderRich(snap.doc));
  const s = snap.signature || {};
  return h('div.f-contract',
    h('div.c-top', h('b', snap.label || label.name || ''), logo ? h('img', { src: logo, alt: '' }) : null),
    h('h2', snap.title),
    body,
    h('p', h('em', snap.accept || '')),
    h('div.c-signs',
      sig(`Per l'etichetta — ${snap.label || ''}`, snap.labelSignature, label.signer || '', ''),
      sig('Per l\'artista', s.png, s.name, [formatDate(s.date), s.time, s.place].filter(Boolean).join(' · '))),
    signedAt || hash ? h('p.c-meta', { style: { marginTop: '16px' } },
      signedAt ? `Firmato il ${fmtDateTime(signedAt)} (ora registrata dal server). ` : '',
      hash ? `Impronta SHA-256: ${hash.slice(0, 16)}…${hash.slice(-8)}` : '') : null);
}

/** Documento completo: dati per sezione + contratto. */
export function copyDocument({ form, answers, label = {}, release = {}, artist = '', when = '', version = 0, contract = null, mask = false }) {
  const secs = [];
  for (const s of form.sections) {
    const rows = s.fields.filter(f => f.type !== 'info').map(f => {
      const v = formatValue(f, answers[f.id], { mask });
      return h('tr', h('th', f.label), h('td', v || '—'));
    });
    if (!rows.length) continue;
    secs.push(h('section.pdf-sec', h('h3', s.title || 'Dati'), h('table', h('tbody', rows))));
  }
  const logo = safeImage(label.logo || '');
  return h('div.pdf-doc',
    h('div.pdf-top',
      h('div', h('div.pdf-label', label.name || ''), h('h1', form.title),
        h('div.pdf-sub', [release.title, release.catalog].filter(Boolean).join(' · ')),
        h('div.pdf-sub', `${artist}${when ? ' · ' + fmtDateTime(when) : ''}${version ? ' · versione ' + version : ''}`)),
      logo ? h('img.pdf-logo', { src: logo, alt: '' }) : null),
    secs,
    contract ? h('div.pdf-break') : null,
    contract ? contractDoc(contract.snap, { label, signedAt: contract.signedAt, hash: contract.hash }) : null,
    h('p.pdf-foot', 'Copia generata nel browser. I dati viaggiano e restano cifrati: solo l\'etichetta e l\'artista (con la sua password) possono leggerli.'));
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
      pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.c-signs', '.pdf-top'] },
    }).from(docEl).save();
  } finally {
    host.remove();
  }
}

export const pdfName = (...parts) => parts.filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]+/g, '').slice(0, 120) + '.pdf';
