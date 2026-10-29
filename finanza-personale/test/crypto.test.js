import test from 'node:test';
import assert from 'node:assert/strict';
import { createVault, unlockWithPassword, unlockWithRecovery, decryptState, encryptState, rewrapPassword, rewrapRecovery, lockKey, checkVault, WrongSecret, BadVault, normalizeRecoveryCode, isRecoveryCodeShape, passwordStrength } from '../js/core/crypto.js';

const ITER = 100000;   // nei test meno passaggi per andare veloci (l'app usa 600.000)
const state = { hello: 'mondo', n: [1, 2, 3], s: 'àèìòù €' };

test('cassaforte: crea, apri, salva, cambia password', async () => {
  const { vault, dek, recoveryCode } = await createVault('una frase lunga e segreta', state, ITER);
  assert.equal(vault.format, 'rh-finance-vault');
  assert.ok(!JSON.stringify(vault).includes('mondo'), 'i dati non devono essere in chiaro');
  assert.ok(isRecoveryCodeShape(recoveryCode));
  assert.deepEqual(await decryptState(vault, dek), state);

  const k2 = await unlockWithPassword(vault, 'una frase lunga e segreta');
  assert.deepEqual(await decryptState(vault, k2), state);
  await assert.rejects(unlockWithPassword(vault, 'sbagliata'), WrongSecret);

  // il codice di recupero funziona anche scritto male (minuscole, spazi, O al posto di 0)
  const sloppy = recoveryCode.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o');
  const k3 = await unlockWithRecovery(vault, sloppy);
  assert.deepEqual(await decryptState(vault, k3), state);
  await assert.rejects(unlockWithRecovery(vault, 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH'), WrongSecret);

  // la chiave in memoria non si può esportare
  await assert.rejects(globalThis.crypto.subtle.exportKey('raw', k2));

  // salvataggio: IV nuovo ogni volta
  const v2 = await encryptState(vault, k2, { ...state, x: 1 });
  assert.notEqual(v2.data.iv, vault.data.iv);
  assert.equal(v2.rev, vault.rev + 1);
  assert.equal((await decryptState(v2, k2)).x, 1);

  // cambio password: i dati restano, la vecchia password non va più
  const dx = await unlockWithPassword(v2, 'una frase lunga e segreta', true);
  const v3 = await rewrapPassword(v2, dx, 'nuova password ancora più lunga', ITER);
  await assert.rejects(unlockWithPassword(v3, 'una frase lunga e segreta'), WrongSecret);
  const k4 = await unlockWithPassword(v3, 'nuova password ancora più lunga');
  assert.equal((await decryptState(v3, k4)).x, 1);
  // il codice di recupero resta valido dopo il cambio password
  await unlockWithRecovery(v3, recoveryCode);

  // nuovo codice di recupero: il vecchio smette di funzionare
  const { vault: v4, code } = await rewrapRecovery(v3, dx);
  await assert.rejects(unlockWithRecovery(v4, recoveryCode), WrongSecret);
  await unlockWithRecovery(v4, code);
  const locked = await lockKey(dx);
  await assert.rejects(globalThis.crypto.subtle.exportKey('raw', locked));
});

test('cassaforte: file manomessi', async () => {
  const { vault, dek } = await createVault('password-di-prova-1', state, ITER);
  assert.throws(() => checkVault({ ...vault, format: 'altro' }), BadVault);
  assert.throws(() => checkVault({ ...vault, kdf: { ...vault.kdf, iter: 1 } }), BadVault);
  assert.throws(() => checkVault(null), BadVault);
  // un solo byte cambiato nei dati: l'apertura fallisce (AES-GCM autentica tutto)
  const bytes = Buffer.from(vault.data.ct, 'base64');
  bytes[5] ^= 1;
  const bad = { ...vault, data: { ...vault.data, ct: bytes.toString('base64') } };
  await assert.rejects(decryptState(bad, dek), BadVault);
});

test('robustezza password e codice', () => {
  assert.equal(passwordStrength('123456').score, 1);
  assert.equal(passwordStrength('password2026').score <= 2, true);
  assert.ok(passwordStrength('cavallo batteria graffetta corretta').score >= 3);
  assert.ok(passwordStrength('T7#qv9!Lp2@xZ').score >= 3);
  assert.equal(normalizeRecoveryCode('ab-cd o1 il'), 'ABCD0111');
});
