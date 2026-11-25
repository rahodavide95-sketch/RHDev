"""Checks that the space resonates on the chord tones: compares the spectrum of the
reverb tail (1.2 s .. 4.5 s after an Am9 stab) with Tune at 0 % and 100 %."""
import os
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DEMO = os.path.join(HERE, "..", "demo")


def load(name):
    with wave.open(os.path.join(DEMO, name + ".wav")) as w:
        sr = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
    return x.reshape(-1, 2).mean(axis=1), sr


def tone_ratio(x, sr, chord_pcs):
    seg = x[int(1.2 * sr):int(4.5 * sr)]
    spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg)))) ** 2
    freqs = np.fft.rfftfreq(len(seg), 1 / sr)
    band = (freqs > 100) & (freqs < 2000)
    midi = 69 + 12 * np.log2(freqs[band] / 440)
    dist = np.abs(((midi - np.round(midi)) * 100))           # cents from nearest semitone
    pc = np.round(midi).astype(int) % 12
    on = np.isin(pc, chord_pcs) & (dist < 20)
    e = spec[band]
    return e[on].sum() / e.sum(), 10 * np.log10(e.sum() + 1e-30)


am9 = [9, 0, 4, 7, 11]  # A C E G B
for name in ["space_tune0", "space_tune100", "space_rev_off"]:
    x, sr = load(name)
    r, lvl = tone_ratio(x, sr, am9)
    print("%-14s tail energy on Am9 chord tones (+-20 cents): %4.1f %%   tail level %.1f dB" % (name, 100 * r, lvl))
