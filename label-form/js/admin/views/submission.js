/* L'invio di un artista, decifrato nel tuo browser: dati, contratto (con verifica dell'impronta)
   e storico delle modifiche con il "prima → dopo" di ogni campo cambiato. */

import { h, swap, icon, clear, fmtDateTime, ago } from '../../ui/dom.js';
import { contractDoc, copyDocument, savePdf, pdfName } from '../../ui/pdf.js';
import { formatValue, summaryRows, changedIds } from '../../core/answers.js';
import { checkLink } from '../../core/links.js';
import { fieldById, isStatic } from '../../core/schema.js';
import { verifyContract } from '../../core/contract.js';
import { A, go, formOf, openInvite, openVersion, inviteState, checklist, tokenOf } from '../state.js';
import { btn, iconBtn, toast, friendly, empty, chip, copyText } from '../ui.js';
import { shareModal } from './release.js';

function valueNode(f, v) {
  const text = formatValue(f, v);
  if (!text) return h('span.faint', '—');
  if (f.type === 'link') {
    const u = checkLink(text, 'any').url;
    return u ? h('a.val-link', { href: u, target: '_blank', rel: 'noopener noreferrer nofollow' }, icon('external', 14), text) : h('span', text);
  }
  return h('span.val', text);
}
function rowFor(f, v) {
  if (f.type === 'group') {
    const items = Array.isArray(v) ? v : [];
    return h('div.drow.group', h('div.dl', f.label, h('small.muted', ` · ${items.length}`)),
      h('div.dv', items.length ? items.map((it, i) => h('div.ditem', h('div.ditem-h', `${f.itemLabel} ${i + 1}`),
        f.fields.map(sf => h('div.drow.sub', h('div.dl', sf.label), h('div.dv', valueNode(sf, it && it[sf.id]),
          formatValue(sf, it && it[sf.id]) ? iconBtn('copy', 'Copia', () => copyText(formatValue(sf, it[sf.id]), 'Copiato'), 'tiny') : null))))) : h('span.faint', '—')));
  }
  const text = formatValue(f, v);
  return h('div.drow', h('div.dl', f.label, f.sensitive ? h('span.sens', { title: 'Dato riservato' }, icon('lock', 12)) : null),
    h('div.dv', valueNode(f, v), text ? iconBtn('copy', 'Copia', () => copyText(text, 'Copiato'), 'tiny') : null));
}

export async function render(el, id) {
  const inv = await A.api.getInviteData(id);
  if (!inv) { swap(el, empty('file', 'Invio non trovato', '', btn('Torna alle release', () => go('#/release')))); return; }
  const [releases, fm] = await Promise.all([A.api.listReleases(), formOf(inv.form_id)]);
  const release = releases.find(r => r.id === inv.release_id) || { title: '' };
  const form = fm.schema;
  const st = inviteState(inv);

  // avvisi di questo invito: letti
  A.api.listEvents(300).then(ev => { const ids = ev.filter(e => e.invite_id === id && !e.read_at).map(e => e.id); if (ids.length) return A.api.markRead(ids).then(() => A.refreshBadge()); }).catch(() => {});

  const head = h('div.page-head',
    h('div', h('a.back', { href: '#/release/' + inv.release_id }, icon('back', 16), release.title || 'Release'),
      h('h1', inv.artist_name, chip(st.text, st.tone, st.ic)),
      h('p.muted', `${fm.title} · versione ${inv.version || 0}${inv.submitted_at ? ' · inviato il ' + fmtDateTime(inv.submitted_at) : ''}${inv.version > 1 ? ' · modificato ' + ago(inv.updated_at) : ''}`)),
    h('div.head-actions', iconBtn('link', 'Link dell\'artista', async () => { try { shareModal(inv, release, await tokenOf(inv)); } catch (x) { toast(friendly(x), { type: 'error' }); } })));

  if (!inv.version) {
    swap(el, head, empty('clock', 'Ancora niente', inv.opened_at ? `${inv.artist_name} ha aperto il link ${ago(inv.opened_at)} ma non ha ancora inviato.` : `${inv.artist_name} non ha ancora aperto il link.`));
    return;
  }

  let opened;
  try { opened = await openInvite(inv); }
  catch (x) { swap(el, head, empty('lock', 'Non riesco ad aprire i dati', 'La chiave sbloccata non corrisponde a questo invio (la chiave dell\'etichetta è stata cambiata?). ' + friendly(x))); return; }
  const answers = opened.answers;
  const snap = opened.contract && opened.contract.snapshot;

  const items = checklist(inv, form);
  const checks = h('div.checks.big', items.map(x => h('span.ck' + (x.ok ? '.ok' : ''), icon(x.ok ? 'check' : 'minus', 14), x.ok ? x.label : `manca ${x.label.toLowerCase()}`)));

  // dati
  const data = h('div');
  for (const s of form.sections) {
    const fields = s.fields.filter(f => !isStatic(f));
    if (!fields.length) continue;
    data.append(h('section.card.dsec', h('h2', s.title || 'Dati', s.contract ? chip(inv.contract_signed_at ? 'Nel contratto firmato' : 'Per il contratto', inv.contract_signed_at ? 'green' : 'muted', 'pen') : null),
      fields.map(f => rowFor(f, answers[f.id]))));
  }
  // campi tolti dal modulo dopo l'invio
  const known = new Set(form.sections.flatMap(s => s.fields.map(f => f.id)));
  const orphans = Object.keys(answers).filter(k => !known.has(k));
  if (orphans.length) data.append(h('section.card.dsec', h('h2', 'Campi non più nel modulo'), h('p.muted.small', 'L\'artista li aveva compilati, poi il modulo è cambiato.'),
    orphans.map(k => h('div.drow', h('div.dl', k), h('div.dv', h('span.val', typeof answers[k] === 'string' ? answers[k] : JSON.stringify(answers[k])))))));

  // contratto
  const contractBox = h('div');
  if (snap) {
    const ok = await verifyContract(snap, inv.contract_hash);
    contractBox.append(h('div.verify' + (ok ? '.ok' : '.bad'), icon(ok ? 'shield' : 'alert', 18),
      h('span', ok ? `Integrità verificata: il contratto è esattamente quello firmato il ${fmtDateTime(inv.contract_signed_at)}.` : 'Attenzione: l\'impronta non corrisponde. Il contratto potrebbe essere stato alterato.')),
      contractDoc(snap, { label: { name: A.settings.label_name, logo: A.settings.logo, signer: A.settings.label_signer }, signedAt: inv.contract_signed_at, hash: inv.contract_hash }));
  } else if (form.contract.enabled) contractBox.append(empty('pen', 'Contratto non ancora firmato', 'L\'artista potrà firmarlo riaprendo il suo invio con la password.'));
  else contractBox.append(h('p.muted', 'Questo modulo non ha un contratto.'));

  // storico
  const histBox = h('div');
  const loadHistory = async () => {
    clear(histBox).append(h('div.loading', h('div.spin'), h('span', 'Apro lo storico…')));
    const versions = await A.api.listVersions(id);
    const cache = new Map();
    const ans = async v => { if (!cache.has(v.version)) cache.set(v.version, await openVersion(opened.dek, id, v)); return cache.get(v.version); };
    clear(histBox);
    for (let n = 0; n < versions.length; n++) {
      const v = versions[n], prev = versions[n + 1];
      const detail = h('div.diff', { hidden: true });
      const labels = (v.changed || []).map(c => (fieldById(form, c) || { label: c }).label);
      const row = h('div.card.ver',
        h('button.ver-h', { type: 'button', onclick: async () => {
          if (!detail.hidden) { detail.hidden = true; return; }
          detail.hidden = false;
          if (detail.childNodes.length) return;
          detail.append(h('div.loading', h('div.spin')));
          try {
            const now = await ans(v);
            if (!prev) { clear(detail).append(h('p.muted', 'Primo invio.')); return; }
            const before = await ans(prev);
            const ids = changedIds(form, before, now);
            clear(detail);
            if (!ids.length) detail.append(h('p.muted', 'Nessuna differenza nei campi del modulo (forse è stato solo firmato il contratto).'));
            for (const fid of ids) {
              const f = fieldById(form, fid);
              detail.append(h('div.dchange', h('div.dl', f ? f.label : fid),
                h('div.dbefore', h('small', 'Prima'), h('span', (f ? formatValue(f, before[fid]) : '') || '—')),
                h('div.dafter', h('small', 'Dopo'), h('span', (f ? formatValue(f, now[fid]) : '') || '—'))));
            }
          } catch (x) { clear(detail).append(h('p.err', friendly(x))); }
        } },
          h('span.ver-n', `v${v.version}`),
          h('span.ver-t', v.version === 1 ? 'Primo invio' : labels.length ? 'Cambiati: ' + labels.join(', ') : 'Salvato', h('small.muted', ' · ' + fmtDateTime(v.created_at))),
          icon('chevron', 18)),
        detail);
      histBox.append(row);
    }
  };

  const tabs = [['Dati', data], ['Contratto', contractBox], [`Storico (${inv.version})`, histBox]];
  let historyLoaded = false;
  const bodies = h('div.tab-bodies');
  const bar = h('div.tabs', tabs.map(([label, body], i) => h('button.tab' + (i === 0 ? '.on' : ''), { type: 'button', onclick: e => {
    bar.querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
    e.currentTarget.classList.add('on');
    bodies.replaceChildren(body);
    if (body === histBox && !historyLoaded) { historyLoaded = true; loadHistory().catch(x => histBox.replaceChildren(h('p.err', friendly(x)))); }
  } }, label)));
  bodies.append(data);

  const label = { name: A.settings.label_name, logo: A.settings.logo, signer: A.settings.label_signer };
  const tools = h('div.tools-row',
    btn('Scarica PDF', async e => {
      const b = e.currentTarget; b.disabled = true; toast('Preparo il PDF…');
      try { await savePdf(copyDocument({ form, answers, label, release, artist: inv.artist_name, when: inv.updated_at, version: inv.version, contract: snap ? { snap, signedAt: inv.contract_signed_at, hash: inv.contract_hash } : null }), pdfName(release.title, inv.artist_name)); }
      catch (x) { toast(friendly(x), { type: 'error' }); }
      b.disabled = false;
    }, { ic: 'download', kind: 'ghost' }),
    btn('Copia tutto come testo', () => copyText(summaryRows(form, answers, { skipEmpty: true }).map(r => `${r.label}: ${r.value}`).join('\n'), 'Dati copiati'), { ic: 'copy', kind: 'ghost' }));

  swap(el, head, checks, tools, bar, bodies);
}
