"""Clicks through the device's control logic with test/maxsim.py and checks what reaches gen~:
factory presets (menu and arrows), locks, Reset, Randomize, sequencer RANDOM and the 4-steps rule,
SAVE / user recall, folding."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src"))
sys.path.insert(0, HERE)
import build  # noqa: E402
from maxsim import Sim  # noqa: E402

P = {p["name"]: p for p in build.P}
failures = []


def check(cond, what):
    if not cond:
        failures.append(what)


def same(name, got, want):
    p = P[name]
    if got is None:
        return False
    if p["kind"] in ("menu", "toggle", "power", "enumdial"):
        return int(got) == int(want)
    if p["kind"] == "int":
        return int(got) == int(round(want))
    return abs(float(got) - float(want)) <= 1e-6 * max(1.0, abs(float(want)))


def expect_preset(sim, ov, skip=(), label=""):
    bad = [n for n in P if n not in build.PRESET_SKIP and n not in skip
           and not same(n, sim.gen.get(n), ov.get(n, P[n]["default"]))]
    check(not bad, "%s: %d parameters wrong, e.g. %s" % (label, len(bad),
          ", ".join("%s=%s (want %s)" % (n, sim.gen.get(n), ov.get(n, P[n]["default"])) for n in bad[:4])))


sim = Sim(os.path.join(HERE, "..", "Dub Machine.maxpat"))
sim.load()
bad = [n for n in P if not same(n, sim.gen.get(n), P[n]["default"])]
check(not bad, "after load: %s" % bad[:5])

fmenu = sim.param("Preset Folder")
umenu = [o for o in sim.objs if o.cls == "umenu"][0]
fnames = [f for f, _ in build.FOLDERS] + ["USER"]

# every factory preset, picked from the menu
n_checked = 0
for fi, (folder, lst) in enumerate(build.FOLDERS):
    sim.set(fmenu, fi)
    check(umenu.items == [n for n, _ in lst], "%s: menu items" % folder)
    for j, (name, ov) in enumerate(lst):
        sim.set(umenu, j)
        expect_preset(sim, ov, label="%s / %s (menu)" % (folder, name))
        n_checked += 1

# arrows: next / prev load the neighbour (with wrap-around) and move the menu's display
sim.set(fmenu, 2)
lst = build.FOLDERS[2][1]
sim.set(umenu, 0)
sim.click(sim.param("Preset Next"))
expect_preset(sim, lst[1][1], label="arrow next")
check(umenu.value == 1, "arrow next: menu display")
sim.click(sim.param("Preset Prev"))
sim.click(sim.param("Preset Prev"))
expect_preset(sim, lst[-1][1], label="arrow prev wraps to the last preset")
check(umenu.value == len(lst) - 1, "arrow prev: menu display")
sim.set(fmenu, 0)
sim.click(sim.param("Preset Next"))
expect_preset(sim, build.FOLDERS[0][1][1][1], label="arrow after changing folder starts from the top")

# locks: with SEQ locked a factory preset keeps the sequence
sim.set(sim.param("Lock Seq"), 1)
before = {n: sim.gen[n] for n in P if P[n]["sec"] == "SEQ"}
sim.set(fmenu, 4)
sim.set(umenu, 2)
check(all(sim.gen[n] == v for n, v in before.items()), "lock Seq: sequence changed")
expect_preset(sim, build.FOLDERS[4][1][2][1], skip=before, label="lock Seq: rest of the preset")
sim.set(sim.param("Lock Seq"), 0)

# reset
sim.click(sim.param("Reset"))
bad = [n for n in P if n not in ("p_key", "p_reverbon") and not same(n, sim.gen.get(n), P[n]["default"])]
check(not bad, "reset: %s" % bad[:5])

# randomize: values move, stay inside their ranges, at most 4 steps on, a character name is shown
for k in range(20):
    old = dict(sim.gen)
    sim.click(sim.param("Randomize"))
    moved = [n for n in build.RAND if sim.gen.get(n) != old.get(n)]
    check(len(moved) > 20, "randomize %d: only %d parameters moved" % (k, len(moved)))
    out = [n for n in P if not (P[n]["lo"] - 1e-9 <= sim.gen[n] <= P[n]["hi"] + 1e-9)]
    check(not out, "randomize %d: out of range %s" % (k, out[:3]))
    check(sum(int(sim.gen["p_son%d" % c]) for c in range(1, 9)) <= 4, "randomize %d: more than 4 steps on" % k)
names = [o.state.get("text") for o in sim.objs if o.cls == "comment" and "text" in o.state]
check(any(t in [a[0] for a in build.ARCHETYPES] for t in names), "randomize: character name not shown")

# with Amount 100 and no locks every value lands inside the range of the character shown in the DICE header
# (the per-character tables live in zl lookup objects), step notes come from the semitone table
arch = {a[0]: a for a in build.ARCHETYPES}
name_box = [o for o in sim.objs if o.cls == "comment" and "text" in o.state][0]
for k in range(30):
    sim.click(sim.param("Randomize"))
    aname, ov, on = arch[name_box.state["text"]]
    for n, (lo, hi, curve) in build.RAND.items():
        v = sim.gen[n]
        if curve == "coin":
            check(v in (0, 1), "randomize %d: %s=%s is not on/off" % (k, n, v))
        elif n in ov and curve not in ("semis", "gate", "acc"):
            tol = 0.5 if P[n]["kind"] != "dial" else 1e-6
            a_lo, a_hi = ov[n]
            check(min(a_lo, a_hi) - tol <= v <= max(a_lo, a_hi) + tol,
                  "randomize %d (%s): %s=%s outside %s..%s" % (k, aname, n, v, a_lo, a_hi))
        elif curve == "semis":
            check(v in build.SEMI_TABLE, "randomize %d: %s=%s not in the semitone table" % (k, n, v))

# sequencer RANDOM changes only the sequencer
for k in range(10):
    old = dict(sim.gen)
    sim.click(sim.param("Seq Random"))
    changed = {n for n in P if sim.gen.get(n) != old.get(n)}
    check(changed and all(P[n]["sec"] == "SEQ" for n in changed), "seq random %d touched %s" % (k, changed))
    check(sum(int(sim.gen["p_son%d" % c]) for c in range(1, 9)) <= 4, "seq random %d: more than 4 steps on" % k)
    bad_notes = [sim.gen["p_snote%d" % c] for c in range(1, 9) if sim.gen["p_snote%d" % c] not in build.SEMI_TABLE]
    check(not bad_notes, "seq random %d: notes outside the semitone table %s" % (k, bad_notes))

# the 5th step cannot be switched on by hand
sim.click(sim.param("Reset"))
sim.set(sim.param("Step 1 On"), 1)
check(int(sim.gen["p_son1"]) == 0, "5th step was allowed on")

# save to slot 3 -> store 3, USER folder shown with "User 3"; user recall sends the slot number
sim.set(sim.param("Save Slot"), 3)
sim.click(sim.param("Preset Save"))
check(["store", 3] in sim.pattr, "save: pattrstorage got %s" % sim.pattr[-3:])
check(fmenu.value == len(fnames) - 1 and umenu.value == 2, "save: menu shows User 3")
sim.set(umenu, 1)
check(sim.pattr[-1] == [2], "user recall: pattrstorage got %s" % sim.pattr[-1:])

# folding Echo: hide the section, show its strip, the device shrinks by the section width minus the strip
sim.tp_msgs.clear()
sim.set(sim.param("Fold Echo"), 1)
flat = [" ".join(str(x) for x in m) for m in sim.tp_msgs]
check("script hide nb_ECHO" in flat and "script show nb_STRIP_ECHO" in flat, "fold: %s" % flat[:3])
gw = {n: r - x + 12 for n, x, r, _ in build.SECTIONS}
check(sim.thisdev_msgs[-1] == ["setwidth", build.DEVICE_W - gw["ECHO"] + build.FOLDW],
      "fold: setwidth %s" % sim.thisdev_msgs[-1:])
sim.set(sim.param("Fold Echo"), 0)
check(sim.thisdev_msgs[-1] == ["setwidth", build.DEVICE_W], "unfold: setwidth %s" % sim.thisdev_msgs[-1:])

# fold several sections: every section (or its strip) lands right after the previous one
fold = {"PRESET", "DICE", "SPACE"}
for n in fold:
    sim.set(sim.param("Fold " + n.title()), 1)
sim.tp_msgs.clear()
sim.set(sim.param("Fold Env"), 0)  # re-sends the whole layout
fold_box = {}
for m in sim.tp_msgs:
    t = [str(x) for x in m]
    if t[:2] == ["script", "sendbox"]:
        fold_box[t[2]] = float(t[4])
x = build.SECTIONS[0][1] - 6
for n, _, _, _ in build.SECTIONS:
    key = ("nb_STRIP_" if n in fold else "nb_") + n
    check(abs(fold_box.get(key, -1) - x) < 1e-6, "fold layout: %s at %s, want %s" % (key, fold_box.get(key), x))
    x += (build.FOLDW if n in fold else gw[n]) + build.GAP
check(sim.thisdev_msgs[-1] == ["setwidth", x], "fold layout: setwidth %s, want %s" % (sim.thisdev_msgs[-1:], x))
for n in fold:
    sim.set(sim.param("Fold " + n.title()), 0)

print("factory presets checked: %d" % n_checked)
if failures:
    print("FAILED (%d):" % len(failures))
    for f in failures[:40]:
        print("  -", f)
    sys.exit(1)
print("all control-logic checks passed")
