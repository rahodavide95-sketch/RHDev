"""Renders every factory preset with its own sequencer pattern (Live playing at 120 BPM) into
demo/presets_tour.wav, prints how dark (spectral centroid) and how loud each one is.
--calibrate writes src/preset_levels.json so every preset plays at the same loudness."""
import json
import os
import subprocess
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src"))
import build  # noqa: E402

TARGET = -17.0  # dBFS, 95th percentile of 400 ms RMS windows
CEILING = -2.0  # dBFS: never push a preset into the output soft clip
calibrate = "--calibrate" in sys.argv
scen, order = {}, []
for i, (name, ov) in enumerate(build.FACTORY):
    params = dict(ov)
    params.update(p_seqon=1, p_seqmode=0)
    key = "preset_%d" % i
    scen[key] = {"seconds": 6, "transport": True, "params": params, "events": []}
    order.append((key, name, ov["p_vol"]))
tmp = os.path.join(HERE, "..", "demo", "presets.json")
json.dump(scen, open(tmp, "w"))
out = subprocess.run(["node", os.path.join(HERE, "render.js")], env=dict(os.environ, NEBBIA_SCENARIOS=tmp),
                     capture_output=True, text=True)
os.remove(tmp)
stats = {l.split("]")[0][1:]: l for l in out.stdout.splitlines() if l.startswith("[")}
folder_of = {n: f for f, lst in build.FOLDERS for n, _ in lst}
frames, levels, last = b"", {}, None
for key, name, vol in order:
    path = os.path.join(HERE, "..", "demo", key + ".wav")
    with wave.open(path) as w:
        raw = w.readframes(w.getnframes())
        prm = w.getparams()
    os.remove(path)
    frames += raw
    x = np.frombuffer(raw, dtype=np.int16).astype(np.float64).reshape(-1, 2).mean(axis=1) / 32768
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    f = np.fft.rfftfreq(len(x), 1 / prm.framerate)
    centroid = (spec * f).sum() / spec.sum()
    win = int(0.4 * prm.framerate)
    rms = [np.sqrt(np.mean(x[s:s + win] ** 2)) + 1e-9 for s in range(0, len(x) - win, win // 2)]
    loud = 20 * np.log10(np.percentile(rms, 95))
    peak_db = 20 * np.log10(np.max(np.abs(x)) + 1e-9)
    levels[name] = round(float(np.clip(vol + min(TARGET - loud, CEILING - peak_db), -24, 6)), 1)
    if folder_of[name] != last:
        print(folder_of[name])
        last = folder_of[name]
    peak = stats[key].split("peak ")[1].split(",")[0]
    print("  %-18s centroid %5.0f Hz   loudness %6.1f dB   peak %s" % (name, centroid, loud, peak))
with wave.open(os.path.join(HERE, "..", "demo", "presets_tour.wav"), "wb") as w:
    w.setparams(prm)
    w.writeframes(frames)
if calibrate:
    json.dump(levels, open(os.path.join(HERE, "..", "src", "preset_levels.json"), "w"), indent=1)
    print("wrote src/preset_levels.json")
