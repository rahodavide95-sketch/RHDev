"""Structural checks on Dub Machine.maxpat: every patch cord points to existing inlets/outlets (at every level,
including the section bpatchers), parameter names are unique, every send has its receive."""
import collections
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
root = json.load(open(os.path.join(HERE, "..", "Dub Machine.maxpat")))["patcher"]
params, sends, recvs, counts = [], collections.Counter(), collections.Counter(), collections.Counter()


# Live theme colors used by the device (names as Max for Live patches store them: themecolor.<name>)
LIVE_THEME = {"live_surface_bg", "live_lcd_bg", "live_lcd_frame", "live_control_fg", "live_control_fg_off",
              "live_lcd_control_fg", "live_value_arc", "live_led_bg"}


def walk(pat, where):
    ids = {b["box"]["id"]: b["box"] for b in pat["boxes"]}
    for ln in pat["lines"]:
        (s, so), (d, di) = ln["patchline"]["source"], ln["patchline"]["destination"]
        assert s in ids and d in ids, (where, s, d)
        assert so < ids[s]["numoutlets"], (where, ids[s].get("text"), so)
        assert di < ids[d]["numinlets"], (where, ids[d].get("text"), ids[d]["maxclass"], di)
    for b in ids.values():
        counts[b["maxclass"]] += 1
        saa = b.get("saved_attribute_attributes", {})
        if "valueof" in saa:
            params.append(saa["valueof"]["parameter_longname"])
        # colors follow the Live theme: only known theme colors, and Live controls keep the theme's own colors
        for attr, v in saa.items():
            if attr != "valueof":
                assert v.get("expression", "").replace("themecolor.", "") in LIVE_THEME, (where, b["id"], attr, v)
        if b["maxclass"] in ("live.dial", "live.text", "live.menu", "live.numbox"):
            assert not [k for k in b if k.endswith("color")], (where, b["id"], "fixed color on a Live control")
        t = b.get("text", "")
        if t.startswith("expr "):  # Max truncates long formulas and handles at most 9 inlets
            assert len(t) - 5 <= 120 and " " not in t[5:], (where, "expr too long", t)
            assert max([int(v) for v in re.findall(r"\$[fi](\d+)", t)] or [0]) <= 9, (where, "expr inlets", t)
        m = re.match(r"^(s|r) (---\S+)$", t)
        if m:
            (sends if m.group(1) == "s" else recvs)[m.group(2)] += 1
        if b["maxclass"] == "bpatcher":
            walk(b["patcher"], b.get("varname"))


walk(root, "main")
dup = [p for p, c in collections.Counter(params).items() if c > 1]
assert not dup, dup
assert set(sends) == set(recvs), (set(sends) ^ set(recvs))
assert all(c == 1 for c in sends.values()) and all(c == 1 for c in recvs.values())
print("ok: %d boxes (%d bpatchers), %d Live parameters, %d send/receive pairs"
      % (sum(counts.values()), counts["bpatcher"], len(params), len(sends)))
