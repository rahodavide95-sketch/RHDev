'use strict';
// Sound "health" metrics on the web engine twin (all its variables are reachable with peek):
//  sat%   how often the filter input of voice 0 is pushed into the tanh (|u| > 0.8 while the voice sounds)
//  corr   L/R correlation of the dry voice bus and of the final output (1 = mono, 0 = fully wide)
//  hf%    share of the output energy above 3 kHz;  centroid in Hz;  crest = peak / RMS in dB
// Usage: node test/sound_metrics.js [engine module] ;  prints one line per test sound
const path = require('path');
const mod = path.resolve(process.argv[2] || path.join(__dirname, 'dubmachine_web_node.js'));
const presets = require(path.join(__dirname, '..', 'web', 'presets.json'));
const SR = 48000;

function run(name, values, seconds = 4) {
  delete require.cache[mod];
  const E = require(mod);
  for (const p of presets.params) E.P[p.name] = p.default;
  Object.assign(E.P, values, { p_seqon: 1, p_seqmode: 0, p_playing: 1, p_bpm: 120 });
  const N = SR * seconds, L = new Float64Array(N), R = new Float64Array(N);
  let sat = 0, act = 0, beat = 0, dl = 0, dr = 0, dlr = 0;
  for (let n = 0; n < N; n++) {
    if (n % 128 === 0) { E.perBlock(); if (n % 4096 === 0) E.P.p_songbeat = beat; }
    beat += 2 / SR; E.P.in1 = beat % 1;
    E.perform();
    const o = E.out; L[n] = o[0]; R[n] = o[1];
    if (E.peek('ae_0') > 0.05) { act++; if (Math.abs(E.peek('u_0')) > 0.8) sat++; }
    const vl = E.peek('vL'), vr = E.peek('vR'); dl += vl * vl; dr += vr * vr; dlr += vl * vr;
  }
  let el = 0, er = 0, elr = 0, peak = 0;
  for (let n = 0; n < N; n++) { el += L[n] * L[n]; er += R[n] * R[n]; elr += L[n] * R[n]; peak = Math.max(peak, Math.abs(L[n]), Math.abs(R[n])); }
  // spectrum of the mid signal (radix-2 FFT on the first 2^17 samples)
  const M = 1 << 17, re = new Float64Array(M), im = new Float64Array(M);
  for (let i = 0; i < M; i++) re[i] = (L[i] + R[i]) * 0.5 * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / M));
  for (let i = 1, j = 0; i < M; i++) { let bit = M >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= M; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < M; i += len) { let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) { const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } } }
  let tot = 0, hf = 0, cen = 0;
  for (let k = 1; k < M / 2; k++) { const e = re[k] * re[k] + im[k] * im[k], f = k * SR / M; tot += e; cen += e * f; if (f > 3000) hf += e; }
  const rms = Math.sqrt((el + er) / (2 * N));
  console.log(`${name.padEnd(16)} sat ${(100 * sat / Math.max(act, 1)).toFixed(0).padStart(3)}%  corr dry ${(dlr / Math.sqrt(dl * dr + 1e-30)).toFixed(2)}  out ${(elr / Math.sqrt(el * er + 1e-30)).toFixed(2)}  hf ${(100 * hf / tot).toFixed(1).padStart(4)}%  centroid ${Math.round(cen / tot).toString().padStart(4)} Hz  crest ${(20 * Math.log10(peak / rms)).toFixed(1)} dB  peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS`);
}

const find = (n) => { for (const f of presets.folders) for (const p of f.presets) if (p.name === n) return p.values; };
for (const n of ['Fog Stab', 'Concrete Dub', 'Deep Chord Pad', 'Soft Horizon', 'Night Drone']) run(n, find(n));
