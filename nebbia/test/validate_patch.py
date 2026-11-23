"""Structural checks on Nebbia.maxpat: every patch cord points to existing inlets/outlets (at every level,
including the section bpatchers), parameter names are unique, every send has its receive."""
import collections
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
root = json.load(open(os.path.join(HERE, "..", "Nebbia.maxpat")))["patcher"]
params, sends, recvs, counts = [], collections.Counter(), collections.Counter(), collections.Counter()


def walk(pat, where):
    ids = {b["box"]["id"]: b["box"] for b in pat["boxes"]}
    for ln in pat["lines"]:
        (s, so), (d, di) = ln["patchline"]["source"], ln["patchline"]["destination"]
        assert s in ids and d in ids, (where, s, d)
        assert so < ids[s]["numoutlets"], (where, ids[s].get("text"), so)
        assert di < ids[d]["numinlets"], (where, ids[d].get("text"), ids[d]["maxclass"], di)
    for b in ids.values():
        counts[b["maxclass"]] += 1
        if "saved_attribute_attributes" in b:
            params.append(b["saved_attribute_attributes"]["valueof"]["parameter_longname"])
        t = b.get("text", "")
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
