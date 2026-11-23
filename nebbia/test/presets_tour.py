"""Renders every factory preset with its own sequencer pattern (Live playing at 120 BPM) into
demo/presets_tour.wav and prints how dark each one is (spectral centroid, lower = darker)."""
import json
import os
import subprocess
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src"))
import build  # noqa: E402

scen, order = {}, []
for i, (name, ov) in enumerate(build.FACTORY):
    params = dict(ov)
    params.update(p_seqon=1, p_seqmode=0)
    key = "preset_%d" % i
    scen[key] = {"seconds": 6, "transport": True, "params": params, "events": []}
    order.append((key, name))
tmp = os.path.join(HERE, "..", "demo", "presets.json")
json.dump(scen, open(tmp, "w"))
out = subprocess.run(["node", os.path.join(HERE, "render.js")], env=dict(os.environ, NEBBIA_SCENARIOS=tmp),
                     capture_output=True, text=True)
os.remove(tmp)
stats = {l.split("]")[0][1:]: l for l in out.stdout.splitlines() if l.startswith("[")}
frames = b""
for key, name in order:
    path = os.path.join(HERE, "..", "demo", key + ".wav")
    with wave.open(path) as w:
        raw = w.readframes(w.getnframes())
        prm = w.getparams()
    os.remove(path)
    frames += raw
    x = np.frombuffer(raw, dtype=np.int16).astype(np.float64).reshape(-1, 2).mean(axis=1)
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    f = np.fft.rfftfreq(len(x), 1 / prm.framerate)
    centroid = (spec * f).sum() / spec.sum()
    peak = stats[key].split("peak ")[1].split(",")[0]
    print("  %-15s centroid %5.0f Hz   peak %s" % (name, centroid, peak))
with wave.open(os.path.join(HERE, "..", "demo", "presets_tour.wav"), "wb") as w:
    w.setparams(prm)
    w.writeframes(frames)
