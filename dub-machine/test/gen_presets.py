"""Generates the extra factory presets (src/presets_generated.json) so that every folder has at least
`TARGET` presets. Each candidate is drawn from the folder's style (characters, chords, patterns,
progressions), rendered offline, and kept only if it passes the folder's checks (finite output, not
too quiet, dark enough where the folder is dark)."""
import json
import math
import os
import random
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src"))
sys.path.insert(0, HERE)
import build  # noqa: E402
from pool import render_many  # noqa: E402

TARGET = 22
PROGS = [[0, -3, -7, -5], [0, -4, -2, -5], [0, 5, 3, -2], [0, -2, -5, -7], [0, 3, -2, 5], [0, -5], [0, -2],
         [0, 7], [0, -4], [0, -7, -5, -2], [0, 2, -3, -5]]
WORDS = {
    "DUB TECHNO": ("Basement Concrete Rusted Submerged Midnight Hollow Grey Foggy Burnt Damp Distant Underground "
                   "Smoked Tunnel Iron Wet Faded Muted Industrial Echoing",
                   "Stab Chord Signal Pulse Dub Station Corridor Shadow Room Wave Rail Harbour Static Vapour "
                   "Bunker Drop Delay Siren Pressure Tower"),
    "DEEP / MINIMAL": ("Velvet Late Smoky Soft Deep Hazy Low Night Slow Warm Dark Liquid Subtle Quiet Sunken Dusky "
                       "Blue Inner Small Muted",
                       "Keys Groove Stab Pulse Shuffle Lounge Motion Loop Touch Hours Swing Lights Steps Session "
                       "Club Tones Chord Room Tide Signal"),
    "AMBIENT": ("Slow Distant Floating Pale Silent Endless Weightless Drifting Quiet Glass Evening Hidden Open Gentle "
                "Still Vast Faded Warm Soft Morning",
                "Horizon Clouds Fields Air Sky Bloom Rain Shore Memory Breath Mist Valley Lake Snow Dawn Garden "
                "Waves Tide Light Haze"),
    "INTRO / SOFT": ("Early Gentle Opening Rising Low Quiet Waking Faint Calm Tender Hushed Shy Patient Silver Small "
                     "Slow Warm Soft First Morning",
                     "Steps Swell Hum Pulse Glow Door Breath Signal Wave Ember Room Promise Arrival Thread Sunrise "
                     "Murmur Path Light Fog Bloom"),
    "DRONE": ("Deep Ocean Static Low Sunken Heavy Infinite Dark Iron Frozen Distant Black Ancient Slow Cold Vast "
              "Buried Grey Endless Cathedral",
              "Field Hum Floor Pressure Tone Organ Current Bed Choir Engine Monolith Haze Depth Horizon Swarm Hall "
              "Void Tide Drone Fifths"),
    "EXPERIMENTAL": ("Glitched Bent Feral Melted Rogue Fractured Mutant Corrupt Unstable Twisted Wild Haunted "
                     "Shattered Erratic Strange Lost Sick Random Broken Phase",
                     "Circuit Ghost Swarm Logic Tape Engine Voltage Metal Bloom Code Radio Organism Spiral Glass "
                     "Noise Machine Strings Echo Colors Signal"),
}
CFG = {
    "DUB TECHNO": dict(chords=[0, 1, 2, 3, 4, 5, 6, 7, 8], voicings=[6, 6, 7, 0, 4], harm=[0] * 6 + [1, 2, 3],
                       etimes=[3, 3, 2, 4, 5, 1], rates=[1, 1, 1, 0], gate=(30, 60), swing=(0, 25),
                       patterns=[(2, 4, 6, 8), (2, 4, 7, 8), (4,), (2, 6), (3, 6, 8), (2, 4, 6), (2, 5, 8), (4, 8),
                                 (2, 3, 6, 8), (1, 4, 7)],
                       notes=[{}, {}, {6: -2}, {8: 3}, {7: 5}, {6: -2, 8: 3}, {4: -2}], centroid=900),
    "DEEP / MINIMAL": dict(cutoff=(500, 1500), chords=[0, 1, 2, 7, 8, 3], voicings=[6, 7, 0, 5], harm=[0] * 5 + [2, 1],
                           etimes=[2, 3, 5], rates=[1, 1, 0], gate=(25, 60), swing=(10, 45),
                           patterns=[(3, 6, 8), (1, 4, 6), (2, 5, 8), (3, 7), (2, 4, 6, 8), (1, 4, 7), (3, 4, 7, 8),
                                     (2, 3, 6)],
                           notes=[{}, {5: -2, 8: 3}, {4: 5}, {7: -2}, {}], centroid=1400),
    "AMBIENT": dict(chords=[1, 2, 4, 5, 7, 11, 12, 6], voicings=[6, 7, 5], harm=[0] * 4 + [2, 1, 4, 6],
                    etimes=[6, 7, 5, 3], prog=True, pluck=0.25, centroid=1300),
    "INTRO / SOFT": dict(cutoff=(250, 800), chords=[1, 2, 7, 11, 12, 5], voicings=[6, 7], harm=[0] * 4 + [2, 1, 4],
                         etimes=[6, 7, 3], prog=True, pluck=0.3, centroid=900),
    "DRONE": dict(chords=[15, 5, 6, 2, 7, 4], voicings=[5, 6, 0], harm=[0], etimes=[7, 6], drone=True, centroid=900),
    "EXPERIMENTAL": dict(chords=list(range(16)), voicings=list(range(8)), harm=[0, 0, 1, 2, 3, 7],
                         etimes=list(range(8)), exp=True, centroid=2500),
}
pd = {q["name"]: q for q in build.P}


def rnd_val(rng, lo, hi):
    v = math.exp(rng.uniform(math.log(lo), math.log(hi))) if lo > 0 and hi / lo >= 8 else rng.uniform(lo, hi)
    return round(v) if abs(v) >= 100 else (round(v, 1) if abs(v) >= 10 else round(v, 2))


def clamp(nm, v):
    return max(pd[nm]["lo"], min(pd[nm]["hi"], v))


def candidate(folder, rng):
    cfg = CFG[folder]
    first, count = build.FOLDER_ARCH[folder]
    _, ranges, on = build.ARCHETYPES[rng.randrange(first, first + count)]
    ov = {k: rnd_val(rng, lo, hi) for k, (lo, hi) in ranges.items()}
    for sw, prob in on.items():
        ov[sw] = int(rng.random() < prob)
    if "cutoff" in cfg:
        ov["p_cutoff"] = rnd_val(rng, *cfg["cutoff"])
    ov["p_chord"] = rng.choice(cfg["chords"])
    ov["p_voicing"] = rng.choice(cfg["voicings"])
    ov["p_harm"] = rng.choice(cfg["harm"])
    ov["p_etime"] = rng.choice(cfg["etimes"])
    if cfg.get("prog"):
        if rng.random() < cfg["pluck"]:
            seq = build._seq(rng.choice([(1, 4, 7), (2, 4, 6, 8), (1, 3, 6)]), rate=1, gate=rng.randint(25, 45))
            ov.update(p_aa=rnd_val(rng, 1, 40), p_as=rnd_val(rng, 0, 20))
        else:
            prog = rng.choice(PROGS)
            seq = build._seq(tuple(range(1, len(prog) + 1)), notes={i + 1: v for i, v in enumerate(prog)},
                             rate=rng.choice([4, 4, 5]), length=len(prog), gate=rng.randint(90, 98))
    elif cfg.get("drone"):
        two = rng.random() < 0.6
        seq = build._seq((1, 2) if two else (1,), notes={2: rng.choice([-5, -2, -7, 5])} if two else {},
                         rate=5, length=2 if two else 1, gate=rng.randint(98, 100))
        ov.update(p_as=rnd_val(rng, 80, 100), p_ad=rnd_val(rng, 6000, 10000), p_ar=rnd_val(rng, 5000, 9000),
                  p_aa=rnd_val(rng, 1000, 4000), p_oct=rng.choice([0, -1]))
    elif cfg.get("exp"):
        pos = tuple(sorted(rng.sample(range(1, 9), rng.randint(2, 4))))
        seq = build._seq(pos, notes={p: rng.randint(-6, 6) for p in pos}, acc=tuple(p for p in pos if rng.random() < 0.3),
                         rate=rng.choice([0, 0, 1, 2]), length=rng.choice([5, 6, 7, 8]),
                         gate=rng.randint(20, 80), chance=rng.randint(55, 90))
        if rng.random() < 0.4:
            ov.update(p_cchance=rng.randint(40, 100), p_cdice=3)
        if rng.random() < 0.4:
            ov.update(p_strum=rng.choice([-1, 1]) * rng.randint(80, 250), p_human=rng.randint(50, 100))
        if rng.random() < 0.3:
            ov.update(p_reso=rng.randint(70, 100))
        if rng.random() < 0.4:
            ov.update(p_lfowave=2, p_lforate=rnd_val(rng, 2, 8), p_lfoamt=rng.randint(30, 60))
    else:
        pat = rng.choice(cfg["patterns"])
        rate = rng.choice(cfg["rates"])
        sw_lo, sw_hi = cfg["swing"]
        seq = build._seq(pat, notes=rng.choice(cfg["notes"]), acc=tuple(p for p in pat if rng.random() < 0.25),
                         rate=rate, gate=rng.randint(*cfg["gate"]),
                         swing=rng.randint(sw_lo + (15 if rate == 0 else 0), sw_hi + (15 if rate == 0 else 0)))
    ov.update(seq)
    return {k: clamp(k, v) for k, v in ov.items()}


def name_all(folder, items, used, seed):
    """Names the kept presets of a folder so that every word is used once where possible."""
    adj, noun = (w.split() for w in WORDS[folder])
    rng = random.Random(seed)
    rng.shuffle(adj)
    rng.shuffle(noun)
    taken = {w for n in used for w in n.split()}
    adj = [a for a in adj if a not in taken] + [a for a in adj if a in taken]
    noun = [x for x in noun if x not in taken] + [x for x in noun if x in taken]
    for i, item in enumerate(items):
        k = 0
        while "%s %s" % (adj[(i + k) % len(adj)], noun[(i * 7 + k) % len(noun)]) in used:
            k += 1
        item[0] = "%s %s" % (adj[(i + k) % len(adj)], noun[(i * 7 + k) % len(noun)])
        used.add(item[0])


def measure(key):
    path = os.path.join(HERE, "..", "demo", key + ".wav")
    with wave.open(path) as w:
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64).reshape(-1, 2).mean(1)
        sr = w.getframerate()
    os.remove(path)
    x /= 32768
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    cen = (spec * np.fft.rfftfreq(len(x), 1 / sr)).sum() / (spec.sum() + 1e-20)
    win = int(0.4 * sr)
    rms = [np.sqrt(np.mean(x[s:s + win] ** 2)) + 1e-9 for s in range(0, len(x) - win, win // 2)]
    return cen, 20 * np.log10(np.percentile(rms, 95))


def main():
    used = {n for _, lst in build.HAND_FOLDERS for n, _ in lst}
    out = {}
    for fi, (folder, hand) in enumerate(build.HAND_FOLDERS):
        need = TARGET - len(hand)
        rng = random.Random(1000 + fi)
        cands = []
        for k in range(int(need * 1.8) + 4):
            ov = candidate(folder, rng)
            cands.append(("gen_%d_%d" % (fi, k), ov))
        scen = {key: {"seconds": 4, "transport": True, "params": dict(ov, p_seqon=1, p_seqmode=0), "events": []}
                for key, ov in cands}
        stats = render_many(scen)
        kept, rejected = [], 0
        for key, ov in cands:
            bad = "non-finite samples 0" not in stats.get(key, "")
            cen, loud = measure(key)
            if bad or loud < -45 or cen > CFG[folder]["centroid"] or len(kept) >= need:
                rejected += 1
                continue
            kept.append([None, ov])
        assert len(kept) == need, (folder, len(kept), need)
        name_all(folder, kept, used, 77 + fi)
        out[folder] = kept
        print("%-15s %2d hand-made + %2d generated (%d candidates rendered, %d left out)"
              % (folder, len(hand), len(kept), len(cands), rejected))
    json.dump(out, open(os.path.join(HERE, "..", "src", "presets_generated.json"), "w"), indent=1)
    print("wrote src/presets_generated.json")


if __name__ == "__main__":
    main()
