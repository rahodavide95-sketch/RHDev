/* Stato condiviso dell'area dell'etichetta e piccoli aiuti usati da più pagine. */

import * as C from '../core/crypto.js';
import { sanitizeForm } from '../core/schema.js';
import * as K from './keys.js';

export const A = {
  api: null, demo: false, settings: null, user: null,
  forms: new Map(),           // id → { id, title, schema (pulito), updated_at }
  unread: 0,
  refreshBadge: () => {},
};

export const go = hash => { if (location.hash !== hash) location.hash = hash; else window.dispatchEvent(new HashChangeEvent('hashchange')); };

/** Indirizzo della pagina per gli artisti (dalle impostazioni, oppure accanto a questa pagina). */
export function artistBase() {
  const custom = (A.settings && A.settings.public_url || '').trim();
  if (custom) return custom.replace(/#.*$/, '');
  return new URL('invio.html', location.href.replace(/#.*$/, '')).href;
}
export const linkFor = token => `${artistBase()}#k=${token}${A.demo ? '&demo=1' : ''}`;

export async function formOf(id, { fresh = false } = {}) {
  if (!fresh && A.forms.has(id)) return A.forms.get(id);
  const f = await A.api.getForm(id);
  const v = { id: f.id, title: f.title, schema: sanitizeForm(f.schema), updated_at: f.updated_at, archived: f.archived };
  A.forms.set(id, v);
  return v;
}

/** Nuovo link segreto per un invito: il codice va al database solo come impronta e chiuso con la tua chiave. */
export async function newToken() {
  const token = C.makeToken();
  const pub = await K.publicKey(A.settings.label_key.pub);
  return { token, token_hash: await C.sha256hex(token), token_enc: await C.sealTextForLabel(pub, token) };
}
export async function tokenOf(invite) {
  if (!K.isUnlocked()) throw new Error('Sblocca prima la chiave');
  return C.openTextForLabel(K.privateKey(), invite.token_enc);
}

/** Apre i dati cifrati di un invio con la chiave dell'etichetta. */
export async function openInvite(data) {
  if (!data.dek_label || !data.main_ct) return null;
  const dek = await C.unwrapDataKeyForLabel(K.privateKey(), data.dek_label);
  const main = await C.openJson(dek, data.main_ct, C.partAad('main', data.id));
  const contract = data.contract_ct ? await C.openJson(dek, data.contract_ct, C.partAad('contract', data.id)) : null;
  return { dek, main, contract, answers: { ...(main.answers || {}), ...((contract && contract.answers) || {}) } };
}
export async function openVersion(dek, inviteId, v) {
  const main = await C.openJson(dek, v.main_ct, C.partAad('main', inviteId));
  const contract = v.contract_ct ? await C.openJson(dek, v.contract_ct, C.partAad('contract', inviteId)) : null;
  return { ...(main.answers || {}), ...((contract && contract.answers) || {}) };
}

/** Stato di un invito per le etichette colorate. */
export function inviteState(i) {
  if (i.revoked_at) return { text: 'Link revocato', tone: 'muted', ic: 'x' };
  if (i.expires_at && new Date(i.expires_at) < new Date() && !i.version) return { text: 'Link scaduto', tone: 'muted', ic: 'clock' };
  if (i.version > 1) return { text: 'Modificato', tone: 'blue', ic: 'edit' };
  if (i.version === 1) return { text: 'Inviato', tone: 'green', ic: 'checkCircle' };
  if (i.opened_at) return { text: 'Aperto', tone: 'amber', ic: 'eye' };
  return { text: 'Non ancora aperto', tone: 'muted', ic: 'clock' };
}

/** Checklist di un invito: campi segnati "nella checklist" + contratto. */
export function checklist(invite, form) {
  const items = [];
  const filled = new Set(invite.filled || []);
  for (const s of form.sections) for (const f of s.fields) {
    if (f.type === 'info' || !f.checklist) continue;
    items.push({ label: f.label, ok: filled.has(f.id) });
  }
  if (form.contract.enabled) items.push({ label: 'Contratto firmato', ok: !!invite.contract_signed_at, contract: true });
  return items;
}
export const isComplete = (invite, form) => invite.version > 0 && checklist(invite, form).every(x => x.ok);
