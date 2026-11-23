"""Plays what RANDOMIZE does: one random patch per character (same ranges and logic as the
expr objects in the patch), rendered back to back into demo/randomize_tour.wav."""
import json
import os
import random
import subprocess
import sys
import wave

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src"))
import build  # noqa: E402

rng = random.Random(int(sys.argv[1]) if len(sys.argv) > 1 else 7)
pdef = {p["name"]: p for p in build.P}


def draw(nm, arch):
    lo, hi, curve = build.RAND[nm]
    r1 = rng.randint(0, 10000)
    _, ov, on = build.ARCHETYPES[arch]
    if curve == "coin":
        return int(r1 < on.get(nm, 0.5) * 10000)
    if curve == "spos":
        return (r1 >= 1500) * (2 * int(nm[6:]) - 1 + (r1 >= 4500))
    if curve == "semis":
        return (r1 >= 5000) * -2 + (r1 >= 6000) * 5 + (r1 >= 7000) * 2 + (r1 >= 8000) * 2 + (r1 >= 9000) * -12
    if any(nm in o for _, o, _ in build.ARCHETYPES):
        a_lo, a_hi = ov.get(nm, (lo, hi))
        c = 1.7 if curve not in (1, 1.5) else 1.0
        return a_lo + (a_hi - a_lo) * (r1 / 10000) ** c
    if pdef[nm]["kind"] == "menu":
        return int(lo + r1 / 10001 * (hi - lo + 1))
    if pdef[nm]["kind"] == "int":
        return int(lo + (hi - lo) * r1 / 10000 + 0.5)
    return lo + (hi - lo) * (r1 / 10000) ** curve


scen, order = {}, []
for ai, (name, _, _) in enumerate(build.ARCHETYPES):
    params = {nm: draw(nm, ai) for nm in build.RAND}
    params.update(p_seqon=0, p_harm=0 if ai % 2 == 0 else params["p_harm"])
    ev = []
    for b in range(4):  # bar 1: off-beat stabs
        t = b * 0.5 + 0.25
        ev += [{"t": t, "type": "on", "note": 57, "vel": 100}, {"t": t + 0.12, "type": "off", "note": 57}]
    ev += [{"t": 2.0, "type": "on", "note": 53, "vel": 95}, {"t": 3.6, "type": "off", "note": 53}]  # bar 2: held
    key = "tour_%d" % ai
    scen[key] = {"seconds": 5, "params": params, "events": ev}
    order.append((key, name, params))

tmp = os.path.join(HERE, "..", "demo", "tour.json")
json.dump(scen, open(tmp, "w"))
out = subprocess.run(["node", os.path.join(HERE, "render.js")], env=dict(os.environ, NEBBIA_SCENARIOS=tmp),
                     capture_output=True, text=True)
print("\n".join(l for l in out.stdout.splitlines() if l.startswith("[")))
os.remove(tmp)
frames = b""
for key, name, params in order:
    with wave.open(os.path.join(HERE, "..", "demo", key + ".wav")) as w:
        frames += w.readframes(w.getnframes())
        prm = w.getparams()
    os.remove(os.path.join(HERE, "..", "demo", key + ".wav"))
    show = ["Chord=%s" % build.CHORDS[params["p_chord"]][0], "Voicing=%s" % build.VOICINGS[params["p_voicing"]],
            "Cutoff=%d" % params["p_cutoff"], "A/D/S/R=%d/%d/%d/%d" % (params["p_aa"], params["p_ad"], params["p_as"],
                                                                         params["p_ar"]),
            "Echo=%s" % ("on" if params["p_echoon"] else "off"), "Space=%s" % ("on" if params["p_spaceon"] else "off"),
            "Tune=%d" % params["p_tune"]]
    print("  %-9s %s" % (name, "  ".join(show)))
with wave.open(os.path.join(HERE, "..", "demo", "randomize_tour.wav"), "wb") as w:
    w.setparams(prm)
    w.writeframes(frames)
