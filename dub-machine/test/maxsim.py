"""A small simulator of the Max control logic in Dub Machine.maxpat (no audio): enough of Max's message passing
to click the device's buttons and menus and see which values reach gen~. It follows Max's rules that matter
here: depth-first messages, right-to-left trigger/unpack outlets, fan-out right-to-left by object position,
cold/hot inlets, send/receive across the section bpatchers, delay after the current event."""
import json
import math
import random
import re

NUM = re.compile(r"^-?(\d+\.?\d*|\.\d+)$")


def atom(tok):
    if NUM.match(tok):
        return float(tok) if "." in tok else int(tok)
    return tok


class Obj:
    def __init__(self, sim, key, box):
        self.sim, self.key, self.box = sim, key, box
        self.cls = box["maxclass"]
        self.text = box.get("text", "")
        self.args = [atom(t) for t in self.text.split()[1:]] if self.cls == "newobj" else []
        self.name = self.text.split()[0] if self.cls == "newobj" and self.text else self.cls
        self.x = box["patching_rect"][0]
        self.outs = {}
        self.state = {}
        vo = box.get("saved_attribute_attributes", {}).get("valueof")
        self.vo = vo
        if vo:
            self.value = vo.get("parameter_initial", [0])[0]
        elif self.cls in ("umenu",):
            self.value, self.items = 0, []
        else:
            self.value = 0

    def out(self, outlet, msg):
        for (dst, inlet) in sorted(self.outs.get(outlet, []), key=lambda c: -c[0].x):
            dst.receive(inlet, list(msg))


def num(msg):
    v = msg[0]
    if isinstance(v, str):
        v = msg[1] if v in ("int", "float") and len(msg) > 1 else 0
    return v


class Sim:
    def __init__(self, path, seed=1):
        root = json.load(open(path))["patcher"]
        self.objs, self.sends, self.later = [], {}, []
        self.gen, self.tp_msgs, self.pattr, self.thisdev_msgs = {}, [], [], []
        self.rng = random.Random(seed)
        self.by_varname, self.by_param, self.texts = {}, {}, {}
        self._load(root, "")

    def _load(self, pat, prefix):
        local = {}
        for b in pat["boxes"]:
            b = b["box"]
            o = Obj(self, prefix + b["id"], b)
            local[b["id"]] = o
            self.objs.append(o)
            if b.get("varname"):
                self.by_varname[b["varname"]] = o
            if o.vo:
                self.by_param[o.vo["parameter_longname"]] = o
            if b["maxclass"] == "bpatcher":
                self._load(b["patcher"], prefix + b["id"] + "/")
        for ln in pat["lines"]:
            (s, so), (d, di) = ln["patchline"]["source"], ln["patchline"]["destination"]
            local[s].outs.setdefault(so, []).append((local[d], di))

    # ------------------------------------------------------------------ helpers for tests
    def param(self, longname):
        return self.by_param[longname]

    def flush(self):
        while self.later:
            f = self.later.pop(0)
            f()

    def load(self):
        """Device load: every Live parameter restores (outputs) its value, then live.thisdevice bangs."""
        for o in self.objs:
            if o.vo and o.vo.get("parameter_type", 0) != 3:
                o.out(0, [o.value])
        for o in self.objs:
            if o.name == "live.thisdevice":
                o.out(0, ["bang"])
        self.flush()

    def click(self, obj):
        """A live.text button: outputs 1 when pressed (route bang 1 in the patch also accepts a bang)."""
        obj.receive(0, [1])
        self.flush()

    def set(self, obj, value):
        obj.receive(0, [value])
        self.flush()


def _receive(self, inlet, msg):  # noqa: C901  (one big dispatcher, like Max's class table)
    sim, n, a = self.sim, self.name, self.args
    sel = msg[0] if msg else "bang"
    # ---------------------------------------------------------------- UI objects
    if self.cls in ("live.dial", "live.numbox", "live.menu", "live.text"):
        if sel == "active":
            self.state["active"] = msg[1]
            return
        if sel == "set":
            self.value = msg[1]
            return
        if sel != "bang":
            v = num(msg)
            vo = self.vo or {}
            lo, hi = vo.get("parameter_mmin", 0), vo.get("parameter_mmax", 1)
            v = min(max(v, lo), hi)
            if vo.get("parameter_type") in (1, 2):
                v = int(math.floor(v + 0.5)) if vo.get("parameter_type") == 1 else int(v)
            self.value = v
        self.out(0, [self.value])
        return
    if self.cls == "umenu":
        if sel == "clear":
            self.items = []
        elif sel == "append":
            self.items.append(" ".join(str(x) for x in msg[1:]))
        elif sel == "set":
            self.value = int(msg[1])
        elif sel in ("next", "prev"):
            self.value = (self.value + (1 if sel == "next" else -1)) % max(len(self.items), 1)
            self.out(0, [self.value])  # Max: "next"/"prev" behaviour not relied upon any more
        elif sel == "bang":
            self.out(0, [self.value])
        else:
            self.value = int(num(msg))
            self.out(0, [self.value])
        return
    if self.cls in ("comment", "live.comment"):
        if sel == "set":
            self.state["text"] = " ".join(str(x) for x in msg[1:])
        return
    if self.cls in ("led", "kslider", "panel"):
        self.state.setdefault("in", []).append(msg)
        return
    if self.cls == "message":
        args = msg if sel != "bang" else []
        text = self.text
        for part in text.split(","):
            toks = []
            for t in part.split():
                m = re.match(r"^\$(\d)$", t)
                if m:
                    i = int(m.group(1)) - 1
                    toks.append(args[i] if i < len(args) else 0)
                else:
                    toks.append(atom(t))
            if toks:
                self.out(0, toks)
        return
    # ---------------------------------------------------------------- objects
    if n == "s":
        for r in sim.sends.setdefault(a[0], [o for o in sim.objs if o.name == "r" and o.args[0] == a[0]]):
            r.out(0, msg)
    elif n == "prepend":
        self.out(0, a + msg if sel != "bang" else a)
    elif n == "t":
        for i in range(len(a) - 1, -1, -1):
            t = a[i]
            if t == "b":
                self.out(i, ["bang"])
            elif t == "i":
                self.out(i, [int(num(msg))])
            elif t == "f":
                self.out(i, [float(num(msg))])
            else:
                self.out(i, msg)
    elif n == "unpack":
        for i in range(min(len(msg), len(a)) - 1, -1, -1):
            v = msg[i]
            self.out(i, [float(v) if isinstance(a[i], float) else v])
    elif n in ("pack", "pak"):
        vals = self.state.setdefault("v", list(a))
        if sel == "bang":
            self.out(0, list(vals))
            return
        vals[inlet] = num(msg) if not isinstance(msg[0], str) else msg[0]
        if inlet == 0 or n == "pak":
            self.out(0, list(vals))
    elif n == "gate":
        if inlet == 0:
            self.state["open"] = int(num(msg))
        else:
            k = self.state.get("open", a[1] if len(a) > 1 else 0)
            if k:
                self.out(k - 1, msg)
    elif n in ("==", ">", "+", "-"):
        if inlet == 1:
            self.state["r"] = num(msg)
            return
        if sel != "bang":
            self.state["l"] = num(msg)
        lft, rgt = self.state.get("l", 0), self.state.get("r", a[0] if a else 0)
        res = {"==": int(lft == rgt), ">": int(lft > rgt), "+": lft + rgt, "-": lft - rgt}[n]
        self.out(0, [res])
    elif n == "i":
        if inlet == 1:
            self.state["v"] = int(num(msg))
            return
        if sel != "bang":
            self.state["v"] = int(num(msg))
        self.out(0, [self.state.get("v", a[0] if a else 0)])
    elif n == "sel":
        v = msg[0]
        if v in a:
            self.out(a.index(v), ["bang"])
        else:
            self.out(len(a), msg)
    elif n == "split":
        v = num(msg)
        self.out(0 if a[0] <= v <= a[1] else 1, [v])
    elif n == "route":
        v = msg[0]
        if v in a:
            rest = msg[1:]
            self.out(a.index(v), rest if rest else ["bang"])
        else:
            self.out(len(a), msg)
    elif n == "zl":
        mode = a[0]
        if mode == "slice":
            k = a[1]
            if msg[k:]:
                self.out(1, msg[k:])
            self.out(0, msg[:k])
        elif mode == "group":
            buf = self.state.setdefault("buf", [])
            buf.extend(msg)
            if len(buf) >= a[1]:
                self.state["buf"] = []
                self.out(0, buf[:a[1]])
        elif mode == "rev":
            self.out(0, msg[::-1])
        elif mode == "sum":
            self.out(0, [sum(msg)])
    elif n == "change":
        v = num(msg)
        if v != self.state.get("last", a[0] if a else None):
            self.state["last"] = v
            self.out(0, [v])
    elif n == "random":
        self.out(0, [sim.rng.randrange(a[0])])
    elif n == "uzi":
        for i in range(1, a[0] + 1):
            self.out(2, [i])
            self.out(0, ["bang"])
        self.out(1, ["bang"])
    elif n == "delay":
        sim.later.append(lambda: self.out(0, ["bang"]))
    elif n == "deferlow":
        sim.later.append(lambda m=list(msg): self.out(0, m))
    elif n == "counter":
        c = self.state.get("c", a[0])
        self.state["c"] = c + 1 if c < a[1] else a[0]
        self.out(0, [c])
    elif n == "expr":
        vals = self.state.setdefault("f", {})
        if sel != "bang":
            vals[inlet + 1] = float(num(msg))
        e = self.text[5:]
        e = re.sub(r"\$f(\d+)", lambda m: "(%r)" % vals.get(int(m.group(1)), 0.0), e)
        if inlet == 0:
            self.out(0, [eval(e, {"int": lambda x: int(x), "pow": pow, "max": max, "min": min})])
    elif n == "gen~":
        if isinstance(sel, str) and sel.startswith("p_"):
            sim.gen[sel] = msg[1]
    elif n == "thispatcher":
        sim.tp_msgs.append(msg)
    elif n == "pattrstorage":
        sim.pattr.append(msg)
    elif n == "live.thisdevice":
        sim.thisdev_msgs.append(msg)
    # everything else (r, notein, live.observer, snapshot~, plugout~, ...) is passive here


Obj.receive = _receive
