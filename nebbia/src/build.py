#!/usr/bin/env python3
"""
NEBBIA - living chord engine for Max for Live (Ableton Live instrument).

This script is the single source of truth. It generates:
  * src/nebbia.genexpr   - the GenExpr DSP code that runs inside gen~
  * Nebbia.maxpat        - the Max patcher (open it in Max if you want to edit)
  * Nebbia.amxd          - the Max for Live instrument to drop into Live
  * test/nebbia_sim.js   - the same DSP code translated to JavaScript, used
                           by test/render.js to render audio offline

Run:  python3 src/build.py
"""
import json
import math
import os
import random
import re
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
NV = 6  # voices

# --------------------------------------------------------------------------
# Musical tables
# --------------------------------------------------------------------------
CHORDS = [
    ("Min7", [0, 3, 7, 10]),
    ("Min9", [0, 3, 7, 10, 14]),
    ("Min11", [0, 3, 7, 10, 14, 17]),
    ("m7 Open", [0, 7, 10, 15]),
    ("m11 Open", [0, 7, 10, 15, 17]),
    ("So What", [0, 5, 10, 15, 19]),
    ("Quartal", [0, 5, 10, 15]),
    ("Sus2", [0, 2, 7]),
    ("7sus4", [0, 5, 7, 10]),
    ("Minor", [0, 3, 7]),
    ("Major", [0, 4, 7]),
    ("Maj7", [0, 4, 7, 11]),
    ("Maj9", [0, 4, 7, 11, 14]),
    ("Dom9", [0, 4, 7, 10, 14]),
    ("m7b5", [0, 3, 6, 10]),
    ("Fifths", [0, 7, 12, 19]),
]
SCALES = [  # Harmony menu entries 1..7 (0 = Fixed chord)
    ("Minor", [0, 2, 3, 5, 7, 8, 10]),
    ("Dorian", [0, 2, 3, 5, 7, 9, 10]),
    ("Phrygian", [0, 1, 3, 5, 7, 8, 10]),
    ("Major", [0, 2, 4, 5, 7, 9, 11]),
    ("Mixolyd", [0, 2, 4, 5, 7, 9, 10]),
    ("Lydian", [0, 2, 4, 6, 7, 9, 11]),
    ("HarmMin", [0, 2, 3, 5, 7, 8, 11]),
]
VOICINGS = ["Root", "Inv 1", "Inv 2", "Inv 3", "Open", "Spread", "Smooth", "Smooth Op"]
KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
ECHO_DIVS = [("1/16", 0.25), ("1/8T", 1 / 3), ("1/8", 0.5), ("1/8D", 0.75),
             ("1/4T", 2 / 3), ("1/4", 1.0), ("1/4D", 1.5), ("1/2", 2.0)]

# --------------------------------------------------------------------------
# Parameters (UI). unit: Live unitstyle (0 int, 1 float, 2 ms, 3 Hz, 4 dB, 5 %)
# --------------------------------------------------------------------------
P = []


def param(name, long, short, kind, lo, hi, default, unit=5, exp=1.0, sec=None, col=0, row=0, enum=None):
    P.append(dict(name=name, long=long, short=short, kind=kind, lo=lo, hi=hi, default=default,
                  unit=unit, exp=exp, sec=sec, col=col, row=row, enum=enum))


# CHORD (4 stacked menus + 2 dial columns)
param("p_harm", "Harmony", "Harmony", "menu", 0, 7, 0, sec="CHORD", col=0, row=0,
      enum=["Fixed"] + [s[0] for s in SCALES])
param("p_chord", "Chord", "Chord", "menu", 0, len(CHORDS) - 1, 1, sec="CHORD", col=0, row=1,
      enum=[c[0] for c in CHORDS])
param("p_key", "Key", "Key", "menu", 0, 11, 9, sec="CHORD", col=0, row=2, enum=KEYS)
param("p_voicing", "Voicing", "Voicing", "menu", 0, 7, 6, sec="CHORD", col=0, row=3, enum=VOICINGS)
param("p_notes", "Notes", "Notes", "int", 2, 6, 5, unit=0, sec="CHORD", col=1, row=0)
param("p_oct", "Octave", "Octave", "int", -3, 3, 0, unit=0, sec="CHORD", col=1, row=1)
param("p_strum", "Strum", "Strum", "dial", -250, 250, 6, unit=2, sec="CHORD", col=1, row=2)
param("p_glide", "Glide", "Glide", "dial", 0, 2000, 0, unit=2, exp=3.0, sec="CHORD", col=2, row=0)
param("p_human", "Humanize", "Humanize", "dial", 0, 100, 30, sec="CHORD", col=2, row=1)
param("p_bendr", "Bend Range", "Bend", "int", 0, 12, 2, unit=0, sec="CHORD", col=2, row=2)
# VOICE
param("p_shape", "Shape", "Shape", "dial", 0, 100, 25, sec="VOICE", col=0, row=0)
param("p_pw", "PW", "PW", "dial", 5, 50, 42, sec="VOICE", col=1, row=0)
param("p_pwm", "PWM", "PWM", "dial", 0, 100, 25, sec="VOICE", col=2, row=0)
param("p_pwmrate", "PWM Rate", "PWM Rate", "dial", 0.02, 10, 0.6, unit=3, exp=3.0, sec="VOICE", col=3, row=0)
param("p_osc2", "Osc 2", "Osc 2", "dial", 0, 100, 70, sec="VOICE", col=0, row=1)
param("p_detune", "Detune", "Detune", "dial", 0, 50, 7, unit=1, exp=2.0, sec="VOICE", col=1, row=1)
param("p_sub", "Sub", "Sub", "dial", 0, 100, 0, sec="VOICE", col=2, row=1)
param("p_air", "Air", "Air", "dial", 0, 100, 10, sec="VOICE", col=3, row=1)
param("p_drift", "Drift", "Drift", "dial", 0, 100, 35, sec="VOICE", col=0, row=2)
param("p_driftrate", "Drift Rate", "Drft Rate", "dial", 0.05, 5, 0.5, unit=3, exp=3.0, sec="VOICE", col=1, row=2)
param("p_age", "Age", "Age", "dial", 0, 100, 40, sec="VOICE", col=2, row=2)
param("p_sag", "Sag", "Sag", "dial", 0, 100, 35, sec="VOICE", col=3, row=2)
# FILTER
param("p_cutoff", "Cutoff", "Cutoff", "dial", 30, 16000, 600, unit=3, exp=3.0, sec="FILTER", col=0, row=0)
param("p_reso", "Resonance", "Reso", "dial", 0, 100, 30, sec="FILTER", col=1, row=0)
param("p_drive", "Drive", "Drive", "dial", 0, 100, 30, sec="FILTER", col=2, row=0)
param("p_slope", "Slope", "Slope", "menu", 0, 1, 0, sec="FILTER", col=3, row=0, enum=["24 dB", "12 dB"])
param("p_fenv", "Env Amount", "Env Amt", "dial", -100, 100, 45, sec="FILTER", col=0, row=1)
param("p_ktrk", "Key Track", "Key Trk", "dial", 0, 100, 35, sec="FILTER", col=1, row=1)
param("p_mwcut", "ModWheel Cutoff", "MW>Cut", "dial", 0, 100, 60, sec="FILTER", col=2, row=1)
param("p_lforate", "LFO Rate", "LFO Rate", "dial", 0.02, 12, 0.15, unit=3, exp=3.0, sec="FILTER", col=0, row=2)
param("p_lfoamt", "LFO Amount", "LFO Amt", "dial", 0, 100, 15, sec="FILTER", col=1, row=2)
param("p_lfowave", "LFO Wave", "LFO Wave", "menu", 0, 3, 0, sec="FILTER", col=2, row=2,
      enum=["Sine", "Triangle", "S&H", "Drift"])
# ENVELOPES
param("p_fa", "F Attack", "F Attack", "dial", 0.5, 5000, 2, unit=2, exp=3.0, sec="ENV", col=0, row=0)
param("p_fd", "F Decay", "F Decay", "dial", 5, 10000, 280, unit=2, exp=3.0, sec="ENV", col=1, row=0)
param("p_fs", "F Sustain", "F Sustain", "dial", 0, 100, 0, sec="ENV", col=2, row=0)
param("p_fr", "F Release", "F Release", "dial", 5, 10000, 350, unit=2, exp=3.0, sec="ENV", col=3, row=0)
param("p_aa", "Attack", "Attack", "dial", 0.5, 5000, 3, unit=2, exp=3.0, sec="ENV", col=0, row=1)
param("p_ad", "Decay", "Decay", "dial", 5, 10000, 450, unit=2, exp=3.0, sec="ENV", col=1, row=1)
param("p_as", "Sustain", "Sustain", "dial", 0, 100, 0, sec="ENV", col=2, row=1)
param("p_ar", "Release", "Release", "dial", 5, 10000, 350, unit=2, exp=3.0, sec="ENV", col=3, row=1)
param("p_velsens", "Velocity Amp", "Vel>Amp", "dial", 0, 100, 40, sec="ENV", col=0, row=2)
param("p_velfilt", "Velocity Filter", "Vel>Filt", "dial", 0, 100, 50, sec="ENV", col=1, row=2)
# ECHO
param("p_etime", "Echo Time", "Time", "menu", 0, len(ECHO_DIVS) - 1, 3, sec="ECHO", col=0, row=0,
      enum=[d[0] for d in ECHO_DIVS])
param("p_efb", "Echo Feedback", "Feedback", "dial", 0, 110, 62, sec="ECHO", col=1, row=0)
param("p_emix", "Echo Mix", "Mix", "dial", 0, 100, 45, sec="ECHO", col=2, row=0)
param("p_elocut", "Echo Low Cut", "Low Cut", "dial", 20, 1000, 90, unit=3, exp=2.0, sec="ECHO", col=0, row=1)
param("p_ehicut", "Echo High Cut", "High Cut", "dial", 400, 16000, 2600, unit=3, exp=2.0, sec="ECHO", col=1, row=1)
param("p_edrive", "Echo Drive", "Drive", "dial", 0, 100, 35, sec="ECHO", col=2, row=1)
param("p_wow", "Echo Wow", "Wow", "dial", 0, 100, 30, sec="ECHO", col=0, row=2)
param("p_flutter", "Echo Flutter", "Flutter", "dial", 0, 100, 20, sec="ECHO", col=1, row=2)
param("p_espread", "Echo Spread", "Spread", "dial", 0, 100, 75, sec="ECHO", col=2, row=2)
# SPACE
param("p_rdecay", "Space Decay", "Decay", "dial", 300, 20000, 4500, unit=2, exp=2.0, sec="SPACE", col=0, row=0)
param("p_rsize", "Space Size", "Size", "dial", 50, 150, 100, sec="SPACE", col=1, row=0)
param("p_rmix", "Space Mix", "Mix", "dial", 0, 100, 32, sec="SPACE", col=2, row=0)
param("p_tune", "Space Tune", "Tune", "dial", 0, 100, 50, sec="SPACE", col=0, row=1)
param("p_sdecay", "String Decay", "Strings", "dial", 200, 20000, 3500, unit=2, exp=2.0, sec="SPACE", col=1, row=1)
param("p_damp", "Space Damp", "Damp", "dial", 0, 100, 45, sec="SPACE", col=2, row=1)
param("p_rlocut", "Space Low Cut", "Low Cut", "dial", 20, 800, 150, unit=3, exp=2.0, sec="SPACE", col=0, row=2)
param("p_diff", "Space Diffusion", "Diffusion", "dial", 0, 100, 80, sec="SPACE", col=1, row=2)
param("p_rmod", "Space Mod", "Mod", "dial", 0, 100, 35, sec="SPACE", col=2, row=2)
# OUT
param("p_chorus", "Chorus", "Chorus", "dial", 0, 100, 30, sec="OUT", col=0, row=0)
param("p_crate", "Chorus Rate", "Ch Rate", "dial", 0.05, 6, 0.5, unit=3, exp=2.0, sec="OUT", col=1, row=0)
param("p_cdepth", "Chorus Depth", "Ch Depth", "dial", 0, 100, 50, sec="OUT", col=0, row=1)
param("p_width", "Width", "Width", "dial", 0, 100, 60, sec="OUT", col=1, row=1)
param("p_vol", "Volume", "Volume", "dial", -60, 6, -3, unit=4, sec="OUT", col=0, row=2)

# Params driven by MIDI (not UI)
MIDI_PARAMS = [("p_root", 60), ("p_vel", 100), ("p_gate", 0), ("p_trig", 0),
               ("p_bend", 64), ("p_modw", 0), ("p_bpm", 120)]

PDEF = {p["name"]: p["default"] for p in P}
PDEF.update(dict(MIDI_PARAMS))

# Per-voice "component tolerances" (fixed, like a real unit coming off the line)
_rng = random.Random(1995)
TOL = []
for s in range(NV):
    TOL.append(dict(
        p=_rng.uniform(-6, 6),          # cents
        f=_rng.uniform(-0.35, 0.35),    # octaves of cutoff
        e=_rng.uniform(-0.22, 0.22),    # envelope time spread
        r=_rng.uniform(-1, 1),          # resonance spread
        g=_rng.uniform(-0.1, 0.1),      # VCA gain spread
        dr=_rng.uniform(0.19, 0.83),    # drift rate Hz
        dp=_rng.random(),               # drift phase
        po=s * 0.173 + _rng.uniform(0, 0.05),  # PWM LFO phase offset
    ))

STR_K = float(os.environ.get("NEBBIA_STR_K", 100))     # sympathetic string excitation
STR_OUT = float(os.environ.get("NEBBIA_STR_OUT", 0.25))  # direct string output level
STR_IN = float(os.environ.get("NEBBIA_STR_IN", 0.3))    # strings into the reverb network
FDN_MS = [29.3, 36.7, 41.3, 47.9, 53.7, 61.1, 67.9, 76.3]


def fnum(x):
    if isinstance(x, bool):
        x = int(x)
    if isinstance(x, int):
        return str(x)
    s = ("%.7f" % x).rstrip("0").rstrip(".")
    if s in ("-0", "", "-"):
        s = "0"
    return s


def tern(var, vals):
    s = fnum(vals[-1])
    for i in range(len(vals) - 2, -1, -1):
        s = "((%s < %s) ? %s : %s)" % (var, fnum(i + 0.5), fnum(vals[i]), s)
    return s


# --------------------------------------------------------------------------
# GenExpr generation
# --------------------------------------------------------------------------
def build_functions():
    f = []
    f.append("""// PolyBLEP residual (band-limited edges)
blep(t, dt) {
	r = 0;
	x = 0;
	if (t < dt) {
		x = t / dt;
		r = x + x - x * x - 1;
	}
	else if (t > 1 - dt) {
		x = (t - 1) / dt;
		r = x * x + x + x + 1;
	}
	return r;
}

// triangle -1..1 from a phase
ftri(x) {
	fr = x - floor(x);
	return 1 - 4 * abs(fr - 0.5);
}

// transparent below 0.8, smooth ceiling at 1.0
sclip(x) {
	ax = abs(x);
	y = x;
	if (ax > 0.8) {
		y = ((x > 0) ? 1 : -1) * (0.8 + 0.2 * tanh((ax - 0.8) * 5));
	}
	return y;
}

pick6(i, v0, v1, v2, v3, v4, v5) {
	return ((i < 0.5) ? v0 : ((i < 1.5) ? v1 : ((i < 2.5) ? v2 : ((i < 3.5) ? v3 : ((i < 4.5) ? v4 : v5)))));
}
""")
    f.append("chordsize(c) {\n\treturn %s;\n}\n" % tern("c", [len(c[1]) for c in CHORDS]))
    body = ["chordiv(c, k) {", "\tr = 0;"]
    for i, (_, iv) in enumerate(CHORDS):
        pad = list(iv)
        while len(pad) < NV:
            pad.append(pad[len(pad) - len(iv)] + 12)
        cond = "if" if i == 0 else "else if"
        if i == len(CHORDS) - 1:
            body.append("\telse {")
        else:
            body.append("\t%s (c < %s) {" % (cond, fnum(i + 0.5)))
        body.append("\t\tr = %s;" % tern("k", pad))
        body.append("\t}")
    body.append("\treturn r;\n}\n")
    f.append("\n".join(body))
    body = ["scalenote(s, i) {", "\tr = 0;"]
    for i, (_, sc) in enumerate(SCALES):
        cond = "if" if i == 0 else "else if"
        if i == len(SCALES) - 1:
            body.append("\telse {")
        else:
            body.append("\t%s (s < %s) {" % (cond, fnum(i + 1.5)))
        body.append("\t\tr = %s;" % tern("i", sc))
        body.append("\t}")
    body.append("\treturn r;\n}\n")
    f.append("\n".join(body))
    f.append("""sdeg(s, idx) {
	o = floor(idx / 7);
	return scalenote(s, idx - 7 * o) + 12 * o;
}
""")
    f.append("edivs(i) {\n\treturn %s;\n}\n" % tern("i", [d[1] for d in ECHO_DIVS]))
    return "\n".join(f)


def build_body():
    hist = {}      # name -> init
    delays = {}    # name -> size
    L = []
    upd = []       # (history, expr) written at the end of the sample

    def w(s=""):
        L.append(s)

    def H(name, init=0.0):
        hist[name] = init
        return name

    def D(name, size):
        delays[name] = size
        return name

    def U(hname, expr):
        upd.append((hname, expr))

    # ---------------- setup & smoothed params
    w("// ================= setup =================")
    w("sr = samplerate;")
    w("isr = 1 / sr;")
    w("sm = 1 - exp(-1 / (0.015 * sr));")

    def smooth(var, target, init):
        H("h_" + var, init)
        w("%s = h_%s + ((%s) - h_%s) * sm;" % (var, var, target, var))
        U("h_" + var, var)

    smooth("s_cut", "log(clamp(p_cutoff, 20, 20000)) * 1.442695", math.log2(PDEF["p_cutoff"]))
    smooth("s_res", "clamp(p_reso, 0, 100) * 0.01", PDEF["p_reso"] / 100)
    smooth("s_drv", "clamp(p_drive, 0, 100) * 0.01", PDEF["p_drive"] / 100)
    smooth("s_efb", "clamp(p_efb, 0, 110) * 0.01", PDEF["p_efb"] / 100)
    smooth("s_emix", "clamp(p_emix, 0, 100) * 0.01", PDEF["p_emix"] / 100)
    smooth("s_rmix", "clamp(p_rmix, 0, 100) * 0.01", PDEF["p_rmix"] / 100)
    smooth("s_tune", "clamp(p_tune, 0, 100) * 0.01", PDEF["p_tune"] / 100)
    smooth("s_chor", "clamp(p_chorus, 0, 100) * 0.01", PDEF["p_chorus"] / 100)
    smooth("s_wid", "clamp(p_width, 0, 100) * 0.01", PDEF["p_width"] / 100)
    smooth("s_vol", "exp(clamp(p_vol, -70, 6) * 0.1151293)", 10 ** (PDEF["p_vol"] / 20))
    smooth("s_mw", "clamp(p_modw, 0, 127) / 127 * clamp(p_mwcut, 0, 100) * 0.05", 0.0)
    smooth("s_size", "clamp(p_rsize, 50, 150) * 0.01", PDEF["p_rsize"] / 100)
    w("shp = clamp(p_shape, 0, 100) * 0.01;")
    w("pwb = clamp(p_pw, 5, 50) * 0.01;")
    w("pwmd = clamp(p_pwm, 0, 100) * 0.004;")
    w("det = clamp(p_detune, 0, 50);")
    w("lv2 = clamp(p_osc2, 0, 100) * 0.01;")
    w("hum = clamp(p_human, 0, 100) * 0.01;")
    w("vfs = clamp(p_velfilt, 0, 100) * 0.01;")
    w("cfr = 1 - exp(-4 / (max(p_fr, 1) * 0.001 * sr));")
    w("detu = exp(det * 0.000577623);")
    w("detd = 1 / detu;")
    w("subl = clamp(p_sub, 0, 100) * 0.01;")
    w("air = clamp(p_air, 0, 100) * 0.008;")
    w("drift = clamp(p_drift, 0, 100) * 0.01;")
    w("age = clamp(p_age, 0, 100) * 0.01;")
    w("fenv = clamp(p_fenv, -100, 100) * 0.06;")
    w("ktrk = clamp(p_ktrk, 0, 100) * 0.01 * 0.0833333;")
    w("lfoamt = clamp(p_lfoamt, 0, 100) * 0.02;")
    w("vsens = clamp(p_velsens, 0, 100) * 0.01;")
    w("sagk = clamp(p_sag, 0, 100) * 0.01;")
    w("fsus = clamp(p_fs, 0, 100) * 0.01;")
    w("asus = clamp(p_as, 0, 100) * 0.01;")
    w("cfa = 1 - exp(-1.466 / (max(p_fa, 0.3) * 0.001 * sr));")
    w("cfd = 1 - exp(-4 / (max(p_fd, 1) * 0.001 * sr));")
    w("caa = 1 - exp(-1.466 / (max(p_aa, 0.3) * 0.001 * sr));")
    w("cad = 1 - exp(-4 / (max(p_ad, 1) * 0.001 * sr));")
    w("car = 1 - exp(-4 / (max(p_ar, 1) * 0.001 * sr));")
    w("glc = 1 - exp(-3 / (max(p_glide, 0.05) * 0.001 * sr));")
    w("sgl = 1 - exp(-3 / (max(p_glide, 90) * 0.001 * sr));")
    w("bendst = (clamp(p_bend, 0, 127) - 64) * 0.015625 * clamp(p_bendr, 0, 24);")
    w("drm = clamp(p_driftrate, 0.01, 10) * 2;")
    w("dsm = 1 - exp(-6.2831853 * clamp(p_driftrate, 0.01, 10) / sr);")
    w("gin = 0.42 * (1 + s_drv * 4);")
    w("strum_s = abs(clamp(p_strum, -1000, 1000)) * 0.001 * sr;")
    w("sdn = p_strum < 0;")

    # ---------------- modulators
    w("")
    w("// ================= modulators =================")
    H("h_lph", 0.0); H("h_pph", 0.0); H("h_lsh", 0.0); H("h_lsm", 0.0)
    w("lfr = clamp(p_lforate, 0.005, 40);")
    w("lph = h_lph + lfr * isr;")
    w("lsh = h_lsh;")
    w("if (lph >= 1) {")
    w("\tlsh = noise();")
    w("}")
    w("lph = lph - floor(lph);")
    w("lsm = h_lsm + (lsh - h_lsm) * (1 - exp(-12.566371 * lfr / sr));")
    w("lfw = floor(p_lfowave + 0.5);")
    w("lfo1 = (lfw < 0.5) ? sin(6.2831853 * lph) : ((lfw < 1.5) ? ftri(lph) : ((lfw < 2.5) ? lsh : lsm * 1.6));")
    w("pph = h_pph + clamp(p_pwmrate, 0.005, 40) * isr;")
    w("pph = pph - floor(pph);")
    U("h_lph", "lph"); U("h_pph", "pph"); U("h_lsh", "lsh"); U("h_lsm", "lsm")
    # global thermal drift (slow, shared by the whole "circuit")
    H("h_gdp", 0.37); H("h_gdt", 0.0); H("h_gdv", 0.0)
    w("gdp = h_gdp + 0.071 * isr;")
    w("gdt = h_gdt;")
    w("if (gdp >= 1) {")
    w("\tgdp = gdp - 1;")
    w("\tgdt = noise();")
    w("}")
    w("gdv = h_gdv + (gdt - h_gdv) * (1 - exp(-0.45 / sr));")
    U("h_gdp", "gdp"); U("h_gdt", "gdt"); U("h_gdv", "gdv")

    # ---------------- trigger & chord brain
    w("")
    w("// ================= trigger & chord brain =================")
    H("h_trig", 0.0); H("h_st", 0.0)
    w("trig = p_trig != h_trig;")
    w("gon = p_gate > 0.5;")
    w("st = min(h_st + 1, 100000000);")
    w("if (trig > 0) {")
    w("\tst = 0;")
    w("}")
    U("h_trig", "p_trig"); U("h_st", "st")
    chg_terms = []
    for pn, hn in [("p_harm", "h_harm"), ("p_chord", "h_chord"), ("p_key", "h_key"),
                   ("p_voicing", "h_voic"), ("p_notes", "h_notes"), ("p_oct", "h_oct")]:
        H(hn, PDEF[pn])
        chg_terms.append("(%s != %s)" % (pn, hn))
        U(hn, pn)
    w("chg = %s;" % " + ".join(chg_terms))
    w("chgo = (chg > 0) * (trig < 0.5);")
    H("h_nn", 0.0)
    w("nn = h_nn;")
    for s in range(NV):
        H("h_q%d" % s, 60.0)
        w("q%d = h_q%d;" % (s, s))
    for nm in ["rmean", "rtop", "rbot", "rvalid", "cmean", "ctop", "cbot", "cvalid"]:
        H("h_" + nm, 0.0)
        w("%s = h_%s;" % (nm, nm))
    w("if (trig + chg > 0) {")
    w("\tif (trig > 0) {")
    w("\t\trmean = h_cmean;")
    w("\t\trtop = h_ctop;")
    w("\t\trbot = h_cbot;")
    w("\t\trvalid = h_cvalid;")
    w("\t}")
    w("\troot = floor(p_root + 0.5) + 12 * floor(p_oct + 0.5);")
    w("\tharm = floor(p_harm + 0.5);")
    w("\tnreq = clamp(floor(p_notes + 0.5), 2, 6);")
    w("\tn = nreq;")
    for k in range(NV):
        w("\ta%d = root;" % k)
    w("\tif (harm < 0.5) {")
    w("\t\tcid = clamp(floor(p_chord + 0.5), 0, %d);" % (len(CHORDS) - 1))
    w("\t\tn = min(chordsize(cid), nreq);")
    for k in range(NV):
        w("\t\ta%d = root + chordiv(cid, %d);" % (k, k))
    w("\t}")
    w("\telse {")
    w("\t\tsid = clamp(harm, 1, 7);")
    w("\t\tpc = root - floor(p_key + 0.5);")
    w("\t\tpc = pc - 12 * floor(pc / 12);")
    w("\t\tbase = root - pc;")
    w("\t\tdeg = %s;" % " + ".join("(scalenote(sid, %d) <= pc)" % i for i in range(1, 7)))
    for k in range(NV):
        w("\t\ta%d = base + sdeg(sid, deg + %d);" % (k, 2 * k))
    w("\t}")
    # voicing
    w("\tvm = clamp(floor(p_voicing + 0.5), 0, 7);")
    w("\tjj = 0;")
    w("\too = 0;")
    w("\tif ((vm > 0.5) * (vm < 3.5) > 0) {")
    w("\t\tjj = min(vm, n - 1);")
    w("\t}")
    w("\tif (vm > 5.5) {")
    w("\t\tasum = a0 + a1 + %s;" % " + ".join("a%d * (n > %d)" % (k, k) for k in range(2, NV)))
    w("\t\talast = pick6(n - 1, a0, a1, a2, a3, a4, a5);")
    w("\t\tctr = asum / n;")
    w("\t\tbest = 1000000000;")
    w("\t\tcm = 0;")
    w("\t\tct = 0;")
    w("\t\tcb = 0;")
    w("\t\tcc = 0;")
    w("\t\tc2 = 0;")
    w("\t\tlow = 0;")
    w("\t\tsemi = 0;")
    w("\t\tgd = 0;")
    for j in range(NV):
        for o in (-12, 0, 12):
            w("\t\tcm = (asum + %d) / n + %d;" % (12 * j, o))
            if j == 0:
                w("\t\tct = alast + %d;" % o)
                w("\t\tcb = a0 + %d;" % o)
            else:
                w("\t\tct = max(alast, a%d + 12) + %d;" % (j - 1, o))
                w("\t\tcb = min(a%d, a0 + 12) + %d;" % (j, o))
            pen = "" if j == 0 else " + (n < %d) * 1000000 + (1 - rvalid) * 0.5" % (j + 1)
            # second-lowest note of this rotation (merge of the two ascending lists)
            if j == 0:
                w("\t\tc2 = a1 + %d;" % o)
            else:
                nxt = "((n > %d) ? a%d : 1000)" % (j + 1, j + 1) if j + 1 < NV else "1000"
                hi2 = "a1 + 12" if j > 1 else "1000"
                w("\t\tc2 = ((a%d <= a0 + 12) ? min(%s, a0 + 12) : min(a%d, %s)) + %d;" % (j, nxt, j, hi2, o))
            w("\t\tlow = (cb < 60) * ((c2 - cb < 1.5) * 3 + (c2 - cb < 2.5) * 1.5);")
            # semitone clashes anywhere in the voicing
            xs = ["(a%d + %d)" % (k, (12 if k < j else 0) + o) for k in range(NV)]
            pairs = []
            for k in range(NV):
                for m in range(k + 1, NV):
                    gate = "(n > %d) * " % m if m >= 2 else ""
                    pairs.append("%s(abs(%s - %s) < 1.5)" % (gate, xs[k], xs[m]))
            w("\t\tsemi = %s;" % " + ".join(pairs))
            w("\t\tgd = abs(cm - ctr);")
            w("\t\tcc = (abs(cm - rmean) + 0.6 * abs(ct - rtop) + 0.3 * abs(cb - rbot)) * rvalid"
              " + 0.25 * gd + 0.2 * max(gd - 5, 0) * max(gd - 5, 0) + low + 2 * semi%s;" % pen)
            w("\t\tif (cc < best) {")
            w("\t\t\tbest = cc;")
            w("\t\t\tjj = %d;" % j)
            w("\t\t\too = %d;" % o)
            w("\t\t}")
    w("\t}")
    for k in range(NV):
        w("\tc%d = a%d + 12 * (%d < jj) + oo;" % (k, k, k))

    def ranks(prefix):
        for k in range(NV):
            terms = []
            for m in range(NV):
                if m == k:
                    continue
                if m < k:
                    terms.append("(n > %d) * ((c%d < c%d) + (c%d == c%d))" % (m, m, k, m, k))
                else:
                    terms.append("(n > %d) * (c%d < c%d)" % (m, m, k))
            w("\t%s%d = %s;" % (prefix, k, " + ".join(terms)))

    ranks("rk")
    w("\tif ((vm == 4) + (vm == 7) > 0) {")
    w("\t\tif (n > 2) {")
    for k in range(NV):
        w("\t\t\tc%d = c%d - 12 * (rk%d == n - 2);" % (k, k, k))
    w("\t\t}")
    w("\t}")
    w("\tif (vm == 5) {")
    for k in range(NV):
        w("\t\tc%d = c%d + 12 * (rk%d - 2 * floor(rk%d * 0.5) > 0.5);" % (k, k, k, k))
    w("\t}")
    ranks("rq")
    # sorted slots
    for s in range(NV):
        terms = " + ".join("(n > %d) * (rq%d == %d) * c%d" % (k, k, s, k) for k in range(NV))
        if s == 0:
            w("\tq0 = %s;" % terms)
        else:
            w("\tq%d = (n > %d) ? (%s) : (pick6(%d - n * floor(%d / n), q0, q1, q2, q3, q4, q5) + 12 * floor(%d / n));"
              % (s, s, terms, s, s, s))
    w("\tcmean = (%s) / n;" % " + ".join(["q0", "q1"] + ["q%d * (n > %d)" % (s, s) for s in range(2, NV)]))
    w("\tctop = pick6(n - 1, q0, q1, q2, q3, q4, q5);")
    w("\tcbot = q0;")
    w("\tif (trig > 0) {")
    w("\t\tcvalid = 1;")
    w("\t}")
    w("\tnn = n;")
    w("}")
    U("h_nn", "nn")
    for s in range(NV):
        U("h_q%d" % s, "q%d" % s)
    for nm in ["rmean", "rtop", "rbot", "rvalid", "cmean", "ctop", "cbot", "cvalid"]:
        U("h_" + nm, nm)

    # ---------------- voices
    w("")
    w("// ================= living analog voices =================")
    H("h_sagv", 0.0)
    w("sagg = 1.6 / sqrt(max(nn, 1)) / (1 + sagk * h_sagv * 0.6);")
    w("vL = 0;")
    w("vR = 0;")
    w("en = 0;")
    for s in range(NV):
        t = TOL[s]
        V = lambda x: x.replace("#", str(s))  # noqa: E731
        for hn, init in [("pd", 0), ("hz", 0), ("tp", 60), ("pv", 60), ("vl", 0.8), ("as", 0), ("ae", 0),
                         ("fs", 0), ("fe", 0), ("dp", t["dp"]), ("dr", 0), ("dv", 0), ("p1", _rng.random()),
                         ("p2", _rng.random()), ("l1", 0), ("l2", 0), ("l3", 0), ("l4", 0), ("sp", 60)]:
            H("h_%s_%d" % (hn, s), float(init))
        w(V("// ---- voice # ----"))
        w(V("act_# = # < nn;"))
        w(V("pd_# = h_pd_#;"))
        w(V("hz_# = h_hz_#;"))
        w(V("if (trig > 0) {"))
        w(V("\tpd_# = act_#;"))
        if s > 0:
            w(V("\thz_# = (noise() * 0.5 + 0.5) * hum * 0.012 * sr;"))
        w("}")
        w(V("pd_# = pd_# * gon * act_#;"))
        w(V("go_# = 0;"))
        w(V("if (pd_# > 0.5) {"))
        w(V("\tif (st >= ((sdn > 0) ? (nn - 1 - #) : #) * strum_s + hz_#) {"))
        w(V("\t\tgo_# = 1;"))
        w(V("\t\tpd_# = 0;"))
        w("\t}")
        w("}")
        w(V("tp_# = h_tp_#;"))
        w(V("if (go_# + chgo * act_# > 0) {"))
        w(V("\ttp_# = q#;"))
        w("}")
        w(V("pv_# = h_pv_# + (tp_# - h_pv_#) * glc;"))
        w(V("if (go_# * (h_ae_# < 0.001) > 0) {"))
        w(V("\tpv_# = tp_#;"))
        w("}")
        w(V("vl_# = h_vl_#;"))
        w(V("if (go_# > 0) {"))
        w(V("\tvl_# = clamp(p_vel / 127, 0, 1) * (1 - hum * 0.25 * (noise() * 0.5 + 0.5));"))
        w("}")
        w(V("vA_# = 1 - vsens + vsens * vl_#;"))
        w(V("vF_# = 1 - vfs + vfs * vl_#;"))
        # envelopes
        w(V("as_# = h_as_#;"))
        w(V("ae_# = h_ae_#;"))
        w(V("fs_# = h_fs_#;"))
        w(V("fe_# = h_fe_#;"))
        w(V("if (go_# > 0) {"))
        w(V("\tas_# = 1;"))
        w(V("\tfs_# = 1;"))
        w("}")
        w(V("if ((gon < 0.5) + (act_# < 0.5) > 0) {"))
        w(V("\tif ((as_# > 0.5) * (as_# < 2.5) > 0) {"))
        w(V("\t\tas_# = 3;"))
        w("\t}")
        w(V("\tif ((fs_# > 0.5) * (fs_# < 2.5) > 0) {"))
        w(V("\t\tfs_# = 3;"))
        w("\t}")
        w("}")
        w(V("ti_# = 1 / (1 + age * %s);" % fnum(t["e"])))
        for (stv, val, ca, cd, sus, cr) in [("as", "ae", "caa", "cad", "asus", "car"),
                                            ("fs", "fe", "cfa", "cfd", "fsus", "cfr")]:
            w(V("if (%s_# == 1) {" % stv))
            w(V("\t%s_# = %s_# + (1.3 - %s_#) * min(%s * ti_#, 1);" % (val, val, val, ca)))
            w(V("\tif (%s_# >= 1) {" % val))
            w(V("\t\t%s_# = 1;" % val))
            w(V("\t\t%s_# = 2;" % stv))
            w("\t}")
            w("}")
            w(V("else if (%s_# == 2) {" % stv))
            w(V("\t%s_# = %s_# + (%s - %s_#) * min(%s * ti_#, 1);" % (val, val, sus, val, cd)))
            w("}")
            w(V("else if (%s_# == 3) {" % stv))
            w(V("\t%s_# = %s_# - %s_# * min(%s * ti_#, 1);" % (val, val, val, cr)))
            w(V("\tif (%s_# < 0.00002) {" % val))
            w(V("\t\t%s_# = 0;" % val))
            w(V("\t\t%s_# = 0;" % stv))
            w("\t}")
            w("}")
        # drift
        w(V("dp_# = h_dp_# + %s * drm * isr;" % fnum(t["dr"])))
        w(V("dr_# = h_dr_#;"))
        w(V("if (dp_# >= 1) {"))
        w(V("\tdp_# = dp_# - 1;"))
        w(V("\tdr_# = noise();"))
        w("}")
        w(V("dv_# = h_dv_# + (dr_# - h_dv_#) * dsm;"))
        # oscillators
        w(V("cts_# = drift * (dv_# * 8 + gdv * 5) + age * %s - sagk * h_sagv * 9;" % fnum(t["p"])))
        w(V("f1_# = min(440 * exp((pv_# + bendst + cts_# * 0.01 - 69) * 0.057762265), sr * 0.45);"))
        w(V("d1_# = f1_# * isr;"))
        w(V("p1_# = h_p1_# + d1_#;"))
        w(V("p1_# = p1_# - floor(p1_#);"))
        w(V("sw_# = 2 * p1_# - 1 - blep(p1_#, d1_#);"))
        w(V("pw_# = clamp(pwb + pwmd * ftri(pph + %s), 0.04, 0.96);" % fnum(t["po"])))
        w(V("pq_# = p1_# - pw_# + 1;"))
        w(V("pq_# = pq_# - floor(pq_#);"))
        w(V("pl_# = ((p1_# < pw_#) ? 1 : -1) + blep(p1_#, d1_#) - blep(pq_#, d1_#) - (2 * pw_# - 1);"))
        w(V("d2_# = min(d1_# * %s, 0.45);" % ("detu" if s % 2 == 0 else "detd")))
        w(V("p2_# = h_p2_# + d2_#;"))
        w(V("p2_# = p2_# - floor(p2_#);"))
        w(V("s2_# = 2 * p2_# - 1 - blep(p2_#, d2_#);"))
        extra = ""
        if s == 0:
            H("h_p3", 0.0)
            w("d3 = d1_0 * 0.5;")
            w("p3 = h_p3 + d3;")
            w("p3 = p3 - floor(p3);")
            w("pq3 = p3 + 0.5;")
            w("pq3 = pq3 - floor(pq3);")
            w("sb = ((p3 < 0.5) ? 1 : -1) + blep(p3, d3) - blep(pq3, d3);")
            U("h_p3", "p3")
            extra = " + sb * subl"
        w(V("vin_# = (sw_# * (1 - shp) + pl_# * shp + s2_# * lv2 + noise() * air%s) * gin;" % extra))
        # ladder
        w(V("fco_# = s_cut + fenv * fe_# * vF_# + ktrk * (pv_# - 60) + lfo1 * lfoamt + s_mw + age * %s"
            " + drift * gdv * 0.15 - sagk * h_sagv * 0.35;" % fnum(t["f"])))
        w(V("fc_# = clamp(exp(fco_# * 0.693147), 16, sr * 0.42);"))
        w(V("g_# = tan(fc_# * 3.14159265 * isr);"))
        w(V("G_# = g_# / (1 + g_#);"))
        w(V("B_# = 1 / (1 + g_#);"))
        w(V("k_# = s_res * 4.2 * (1 + age * %s);" % fnum(t["r"] * 0.05)))
        w(V("S_# = B_# * (G_# * G_# * G_# * h_l1_# + G_# * G_# * h_l2_# + G_# * h_l3_# + h_l4_#);"))
        w(V("u_# = tanh((vin_# * (1 + 0.7 * k_#) - k_# * S_#) / (1 + k_# * G_# * G_# * G_# * G_#));"))
        w(V("v1_# = (u_# - h_l1_#) * G_#;"))
        w(V("y1_# = v1_# + h_l1_#;"))
        w(V("v2_# = (y1_# - h_l2_#) * G_#;"))
        w(V("y2_# = v2_# + h_l2_#;"))
        w(V("v3_# = (y2_# - h_l3_#) * G_#;"))
        w(V("y3_# = v3_# + h_l3_#;"))
        w(V("v4_# = (y3_# - h_l4_#) * G_#;"))
        w(V("y4_# = v4_# + h_l4_#;"))
        w(V("vo_# = ((p_slope < 0.5) ? y4_# : y2_#) * ae_# * vA_# * sagg;"))
        w(V("vo_# = vo_# * (1 + age * %s);" % fnum(t["g"])))
        sign = "-1" if s % 2 == 0 else "1"
        w(V("pn_# = s_wid * %s * min(# / max(nn - 1, 1), 1);" % sign))
        w(V("vL = vL + vo_# * sqrt(0.5 - 0.5 * pn_#);"))
        w(V("vR = vR + vo_# * sqrt(0.5 + 0.5 * pn_#);"))
        w(V("en = en + ae_# * vA_#;"))
        w(V("sp_# = h_sp_# + (q# - h_sp_#) * sgl;"))
        for hn in ["pd", "hz", "tp", "pv", "vl", "as", "ae", "fs", "fe", "dp", "dr", "dv", "p1", "p2", "sp"]:
            U("h_%s_%d" % (hn, s), "%s_%d" % (hn, s))
        U("h_l1_%d" % s, "y1_%d + v1_%d" % (s, s))
        U("h_l2_%d" % s, "y2_%d + v2_%d" % (s, s))
        U("h_l3_%d" % s, "y3_%d + v3_%d" % (s, s))
        U("h_l4_%d" % s, "y4_%d + v4_%d" % (s, s))
    w("en3 = en * 0.333333;")
    w("sagv = h_sagv + (en3 - h_sagv) * ((en3 > h_sagv) ? (1 - exp(-50 / sr)) : (1 - exp(-3.3 / sr)));")
    U("h_sagv", "sagv")

    # ---------------- chorus
    w("")
    w("// ================= BBD chorus =================")
    D("chL", 8192); D("chR", 8192)
    H("h_cph", 0.0); H("h_cbl", 0.0); H("h_cbr", 0.0)
    w("cph = h_cph + clamp(p_crate, 0.01, 20) * isr;")
    w("cph = cph - floor(cph);")
    w("cmo = ftri(cph);")
    w("cdp = clamp(p_cdepth, 0, 100) * 0.025;")
    w("cwl = chL.read((3.3 + cdp * cmo) * 0.001 * sr);")
    w("cwr = chR.read((3.3 - cdp * cmo) * 0.001 * sr);")
    w("chL.write(vL);")
    w("chR.write(vR);")
    w("cbb = 1 - exp(-6.2831853 * 7000 * isr);")
    w("cbl = h_cbl + (cwl - h_cbl) * cbb;")
    w("cbr = h_cbr + (cwr - h_cbr) * cbb;")
    w("xL = vL * (1 - 0.3 * s_chor) + cbl * s_chor * 0.8;")
    w("xR = vR * (1 - 0.3 * s_chor) + cbr * s_chor * 0.8;")
    U("h_cph", "cph"); U("h_cbl", "cbl"); U("h_cbr", "cbr")

    # ---------------- dub tape echo
    w("")
    w("// ================= dub tape echo =================")
    D("edL", 400000); D("edR", 400000)
    for hn in ["ets", "wph", "fph", "ehl", "el1", "el2", "ehr", "er1", "er2"]:
        H("h_" + hn, 0.0)
    hist["h_ets"] = 0.375 * 48000  # 1/8D at 120 BPM, avoids a sweep on load
    w("bpm = clamp(p_bpm, 20, 999);")
    w("etg = clamp(60 / bpm * edivs(clamp(floor(p_etime + 0.5), 0, 7)) * sr, 64, 380000);")
    w("ets = h_ets + (etg - h_ets) * (1 - exp(-3.3 / sr));")
    w("wph = h_wph + 0.37 * isr;")
    w("wph = wph - floor(wph);")
    w("fph = h_fph + 5.3 * isr;")
    w("fph = fph - floor(fph);")
    w("wamt = clamp(p_wow, 0, 100) * 0.01;")
    w("famt = clamp(p_flutter, 0, 100) * 0.01;")
    w("wm = (wamt * (sin(6.2831853 * wph) * 0.0019 + gdv * 0.0012) + famt * sin(6.2831853 * fph) * 0.0003) * sr;")
    w("pp = clamp(p_espread, 0, 100) * 0.01;")
    w("eol = edL.read(clamp(ets + wm, 2, 390000));")
    w("eor = edR.read(clamp(ets - wm * 0.7 + pp * 0.004 * sr, 2, 390000));")
    w("ehc = 1 - exp(-6.2831853 * clamp(p_elocut, 10, 2000) * isr);")
    w("elc = 1 - exp(-6.2831853 * clamp(p_ehicut, 200, 20000) * isr);")
    w("ehl = h_ehl + (eol - h_ehl) * ehc;")
    w("el1 = h_el1 + (eol - ehl - h_el1) * elc;")
    w("el2 = h_el2 + (el1 - h_el2) * elc;")
    w("ehr = h_ehr + (eor - h_ehr) * ehc;")
    w("er1 = h_er1 + (eor - ehr - h_er1) * elc;")
    w("er2 = h_er2 + (er1 - h_er2) * elc;")
    w("edg = 0.3 + clamp(p_edrive, 0, 100) * 0.03;")
    w("etl = tanh(el2 * edg) / edg;")
    w("etr = tanh(er2 * edg) / edg;")
    w("ein = (xL + xR) * 0.5 + in1;")
    w("edL.write(ein + s_efb * (etl * (1 - pp) + etr * pp));")
    w("edR.write(ein * (1 - pp) + s_efb * (etr * (1 - pp) + etl * pp));")
    for hn in ["ets", "wph", "fph", "ehl", "el1", "el2", "ehr", "er1", "er2"]:
        U("h_" + hn, hn)

    # ---------------- space: sympathetic strings + FDN
    w("")
    w("// ================= space: sympathetic strings tuned to the chord =================")
    H("h_shl", 0.0); H("h_shr", 0.0)
    w("sil = xL + el2 * s_emix;")
    w("sir = xR + er2 * s_emix;")
    w("shc = 1 - exp(-6.2831853 * clamp(p_rlocut, 10, 2000) * isr);")
    w("shl = h_shl + (sil - h_shl) * shc;")
    w("shr = h_shr + (sir - h_shr) * shc;")
    w("hil = sil - shl;")
    w("hir = sir - shr;")
    U("h_shl", "shl"); U("h_shr", "shr")
    w("sdamp = clamp(p_damp, 0, 100) * 0.01;")
    w("sa = 0.85 - 0.55 * sdamp;")
    w("stau = (1 - sa) / sa;")
    w("rt = clamp(p_rdecay, 100, 30000) * 0.001;")
    w("srt = clamp(p_sdecay, 100, 30000) * 0.001;")
    w("sex = (hil + hir) * 0.5 * s_tune;")
    w("stL = 0;")
    w("stR = 0;")
    for s in range(NV):
        D("sd%d" % s, 8192)
        H("h_sl_%d" % s, 0.0)
        V = lambda x: x.replace("#", str(s))  # noqa: E731
        w(V("sf_# = 440 * exp((h_sp_# - 69) * 0.057762265);"))
        w(V("sP_# = clamp(sr / sf_#, 6, 8000);"))
        w(V("sy_# = sd#.read(max(sP_# - stau, 2));"))
        w(V("sl_# = h_sl_# + (sy_# - h_sl_#) * sa;"))
        w(V("sg_# = exp(-6.9078 * sP_# / (srt * sr));"))
        w(V("sd#.write(tanh(sex * (1 - sg_#) * %s + sl_# * sg_#));" % fnum(STR_K)))
        w(V("st%s = st%s + sl_#;" % (("L", "L") if s % 2 == 0 else ("R", "R"))))
        U("h_sl_%d" % s, "sl_%d" % s)
    w("")
    w("// ================= space: 8-line feedback delay network =================")
    for nm, ms in [("apl1", 4.3), ("apl2", 6.9), ("apr1", 5.1), ("apr2", 7.7)]:
        D(nm, 4096)
    w("apg = clamp(p_diff, 0, 100) * 0.0075;")
    w("rinl = hil * (1 - 0.7 * s_tune) + stL * s_tune * %s;" % fnum(STR_IN))
    w("rinr = hir * (1 - 0.7 * s_tune) + stR * s_tune * %s;" % fnum(STR_IN))
    for ch, (n1, n2, m1, m2) in [("l", ("apl1", "apl2", 4.3, 6.9)), ("r", ("apr1", "apr2", 5.1, 7.7))]:
        w("ap%sa = %s.read(%s * 0.001 * sr);" % (ch, n1, fnum(m1)))
        w("ap%sw = rin%s + apg * ap%sa;" % (ch, ch, ch))
        w("%s.write(ap%sw);" % (n1, ch))
        w("ap%sy = ap%sa - apg * ap%sw;" % (ch, ch, ch))
        w("ap%sb = %s.read(%s * 0.001 * sr);" % (ch, n2, fnum(m2)))
        w("ap%sv = ap%sy + apg * ap%sb;" % (ch, ch, ch))
        w("%s.write(ap%sv);" % (n2, ch))
        w("dif%s = ap%sb - apg * ap%sv;" % (ch, ch, ch))
    H("h_mph", 0.0)
    w("mph = h_mph + 0.29 * isr;")
    w("mph = mph - floor(mph);")
    w("rmod = sin(6.2831853 * mph) * clamp(p_rmod, 0, 100) * 0.00001 * sr;")
    U("h_mph", "mph")
    w("rdc = 1 - exp(-6.2831853 * 12000 * exp(sdamp * -2.3) * isr);")
    for i, ms in enumerate(FDN_MS):
        D("fd%d" % i, 32768)
        H("h_dl%d" % i, 0.0)
        mod = ""
        if i == 1:
            mod = " + rmod"
        elif i == 6:
            mod = " - rmod"
        w("fl%d = %s * s_size * 0.001 * sr%s;" % (i, fnum(ms), mod))
        w("fr%d = fd%d.read(fl%d);" % (i, i, i))
        w("dl%d = h_dl%d + (fr%d - h_dl%d) * rdc;" % (i, i, i, i))
        w("z%d = dl%d * exp(-6.9078 * fl%d / (rt * sr));" % (i, i, i))
        U("h_dl%d" % i, "dl%d" % i)
    # fast Walsh-Hadamard (8)
    w("a0h = z0 + z1;"); w("a1h = z0 - z1;"); w("a2h = z2 + z3;"); w("a3h = z2 - z3;")
    w("a4h = z4 + z5;"); w("a5h = z4 - z5;"); w("a6h = z6 + z7;"); w("a7h = z6 - z7;")
    w("b0h = a0h + a2h;"); w("b2h = a0h - a2h;"); w("b1h = a1h + a3h;"); w("b3h = a1h - a3h;")
    w("b4h = a4h + a6h;"); w("b6h = a4h - a6h;"); w("b5h = a5h + a7h;"); w("b7h = a5h - a7h;")
    inj = ["difl", "difr", "-difl", "-difr", "difl", "-difr", "-difl", "difr"]
    pairs = [(0, 4), (1, 5), (2, 6), (3, 7)]
    for (a, b) in pairs:
        w("fd%d.write((b%dh + b%dh) * 0.3535534 + %s * 0.5);" % (a, a, b, inj[a].replace("-", "0 - ")))
        w("fd%d.write((b%dh - b%dh) * 0.3535534 + %s * 0.5);" % (b, a, b, inj[b].replace("-", "0 - ")))
    w("rvL = (dl0 - dl2 + dl4 + dl6) * 0.5;")
    w("rvR = (dl1 + dl3 - dl5 + dl7) * 0.5;")

    # ---------------- output
    w("")
    w("// ================= output =================")
    for hn in ["dxl", "dyl", "dxr", "dyr"]:
        H("h_" + hn, 0.0)
    w("ml = xL + el2 * s_emix + (rvL + stL * s_tune * %s) * s_rmix;" % fnum(STR_OUT))
    w("mr = xR + er2 * s_emix + (rvR + stR * s_tune * %s) * s_rmix;" % fnum(STR_OUT))
    w("dyl = ml - h_dxl + 0.9993 * h_dyl;")
    w("dyr = mr - h_dxr + 0.9993 * h_dyr;")
    U("h_dxl", "ml"); U("h_dyl", "dyl"); U("h_dxr", "mr"); U("h_dyr", "dyr")
    w("out1 = sclip(dyl * s_vol);")
    w("out2 = sclip(dyr * s_vol);")
    w("")
    w("// ================= state =================")
    for hname, expr in upd:
        w("%s = %s;" % (hname, expr))
    return L, hist, delays


GEN_RESERVED = set("""
in out in1 in2 out1 out2 noise mix gate phasor train cycle wave rate scale slide sah latch delta change
counter accum plusequals mulequals history delay data buffer param constant pass switch selector
abs min max minimum maximum clamp clip wrap fold step smoothstep sign floor ceil round trunc fract
exp exp2 log log2 log10 ln pow sqrt sin cos tan asin acos atan atan2 sinh cosh tanh asinh acosh atanh
fastsin fastcos fasttan fastexp fastpow hypot absdiff neg not and or xor bool int float eq neq gt lt gte lte
add sub mul div mod rsub rdiv peek poke lookup sample nearest dim channels samplerate vectorsize elapsed
voice mtof ftom atodb dbtoa mstosamps sampstoms t60 t60time dcblock e pi twopi halfpi invpi degtorad
radtodeg sqrt2 sqrt1_2 ln2 ln10 log2e log10e phi fixdenorm fixnan isdenorm isnan cartopol poltocar
interp triangle spike
""".split())


def lint(functions, body_lines, hist, delays, params):
    """Light syntax checks so that gen~ compiles the code on first load."""
    errors = []
    code = functions + "\n" + "\n".join(body_lines)
    # statements end with ';'
    for i, line in enumerate(code.split("\n")):
        st = line.strip()
        if not st or st.startswith("//"):
            continue
        if st.endswith("{") or st == "}" or st.endswith(";"):
            continue
        errors.append("line %d missing ';': %s" % (i + 1, st))
    # braces
    if code.count("{") != code.count("}"):
        errors.append("unbalanced braces")
    if code.count("(") != code.count(")"):
        errors.append("unbalanced parentheses")
    # assigned names must not clash with gen operators/constants
    assigned = set(re.findall(r"\b([A-Za-z_]\w*)\s*=(?!=)", code))
    declared = set(hist) | set(delays) | set(params)
    for nm in (assigned | declared) - {"out1", "out2"}:
        if nm in GEN_RESERVED:
            errors.append("identifier '%s' clashes with a gen operator" % nm)
    # every identifier read in the body must be known
    known = assigned | declared | GEN_RESERVED | {"samplerate"}
    fn_names = set(re.findall(r"^([A-Za-z_]\w*)\s*\(", functions, re.M))
    known |= fn_names
    body = "\n".join(body_lines)
    body_nocomment = re.sub(r"//.*", "", body)
    for nm in set(re.findall(r"\b([A-Za-z_]\w*)\b", body_nocomment)):
        if nm in ("if", "else", "read", "write"):
            continue
        if nm not in known:
            errors.append("unknown identifier in body: %s" % nm)
    if errors:
        raise SystemExit("GenExpr lint failed:\n  " + "\n  ".join(errors))


def build_genexpr():
    functions = build_functions()
    body, hist, delays = build_body()
    params = [p["name"] for p in P] + [m[0] for m in MIDI_PARAMS]
    lint(functions, body, hist, delays, params)
    decl = []
    for p in P:
        decl.append("Param %s(%s);" % (p["name"], fnum(p["default"])))
    for nm, v in MIDI_PARAMS:
        decl.append("Param %s(%s);" % (nm, fnum(v)))
    for nm, v in hist.items():
        decl.append("History %s(%s);" % (nm, fnum(v)))
    for nm, sz in delays.items():
        decl.append("Delay %s(%d);" % (nm, sz))
    header = ("// NEBBIA - living chord engine (generated by src/build.py, edit that file instead)\n"
              "// Chord brain with voice leading, 6 analog-behaving voices, dub tape echo,\n"
              "// and a space whose sympathetic strings retune to the chord you play.\n\n")
    code = header + functions + "\n" + "\n".join(decl) + "\n\n" + "\n".join(body) + "\n"
    # wrap negative literals that follow an operator: "a * -2" -> "a * (-2)"
    neg = re.compile(r"([-+*/]) (-\d+(?:\.\d+)?)")
    code = neg.sub(r"\1 (\2)", code)
    body = [neg.sub(r"\1 (\2)", ln) for ln in body]
    return code, functions, body, hist, delays


# --------------------------------------------------------------------------
# JavaScript translation for the offline renderer
# --------------------------------------------------------------------------
def to_js(functions, body, hist, delays, sr):
    js = []
    js.append("'use strict';")
    js.append("// generated by src/build.py - JavaScript twin of nebbia.genexpr for offline tests")
    js.append("const samplerate = %d;" % sr)
    js.append("const in1 = 0;")
    js.append("""const exp = Math.exp, log = Math.log, tan = Math.tan, tanh = Math.tanh, sin = Math.sin,
  cos = Math.cos, sqrt = Math.sqrt, floor = Math.floor, abs = Math.abs, pow = Math.pow;
function min(a, b) { return a < b ? +a : +b; }
function max(a, b) { return a > b ? +a : +b; }
function clamp(x, a, b) { return x < a ? +a : (x > b ? +b : +x); }
let _seed = 12345;
function noise() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x3fffffff - 1; }
class GDelay {
  constructor(n) { this.n = n; this.N = n + 1; this.buf = new Float64Array(this.N); this.w = 0; }
  read(t) {
    if (t > this.n) t = this.n; if (t < 0) t = 0;
    let pos = this.w - t; let i = Math.floor(pos); const f = pos - i;
    const N = this.N; i = ((i % N) + N) % N; const j = (i + 1) % N;
    return this.buf[i] + (this.buf[j] - this.buf[i]) * f;
  }
  write(x) { this.buf[this.w] = x; this.w = (this.w + 1) % this.N; }
}""")
    # functions
    ftext = functions
    out_f = []
    for m in re.finditer(r"^([A-Za-z_]\w*)\(([^)]*)\)\s*\{(.*?)^\}", ftext, re.M | re.S):
        name, args, fbody = m.group(1), m.group(2), m.group(3)
        argset = {a.strip() for a in args.split(",") if a.strip()}
        locs = sorted(set(re.findall(r"\b([A-Za-z_]\w*)\s*=(?!=)", fbody)) - argset)
        decl = ("\n\tlet %s;" % ", ".join(locs)) if locs else ""
        out_f.append("function %s(%s) {%s%s}" % (name, args, decl, fbody))
    js.extend(out_f)
    params = [p["name"] for p in P] + [m[0] for m in MIDI_PARAMS]
    js.append("const P = {%s};" % ", ".join("%s: %s" % (p, fnum(PDEF[p])) for p in params))
    for nm, v in hist.items():
        js.append("let %s = %s;" % (nm, fnum(v)))
    for nm, sz in delays.items():
        js.append("const %s = new GDelay(%d);" % (nm, sz))
    btxt = "\n".join(body)
    # params become P.x
    for p in sorted(params, key=len, reverse=True):
        btxt = re.sub(r"\b%s\b" % p, "P." + p, btxt)
    locs = sorted(set(re.findall(r"\b([A-Za-z_]\w*)\s*=(?!=)", btxt)) - set(hist) - {"out1", "out2"})
    js.append("let out1 = 0, out2 = 0;")
    js.append("function perform() {\n\tlet %s;\n%s\n}" % (", ".join(locs), btxt))
    js.append("module.exports = { P, perform, peek: (n) => eval(n), get out() { return [out1, out2]; } };")
    return "\n".join(js) + "\n"


# --------------------------------------------------------------------------
# Max patcher
# --------------------------------------------------------------------------
APPVERSION = {"major": 8, "minor": 6, "revision": 2, "architecture": "x64", "modernui": 1}


class Patch:
    def __init__(self):
        self.boxes = []
        self.lines = []
        self.n = 0

    def add(self, maxclass, rect, text=None, ninl=1, nout=1, outtype=None, **kw):
        self.n += 1
        oid = "obj-%d" % self.n
        b = {"id": oid, "maxclass": maxclass, "numinlets": ninl, "numoutlets": nout,
             "patching_rect": [float(x) for x in rect]}
        if outtype is not None:
            b["outlettype"] = outtype
        if text is not None:
            b["text"] = text
        b.update(kw)
        self.boxes.append({"box": b})
        return oid

    def obj(self, text, x, y, ninl=1, nout=1, outtype=None, w=None):
        if outtype is None:
            outtype = [""] * nout
        width = w if w is not None else max(40, 7 * len(text) + 14)
        return self.add("newobj", [x, y, width, 22], text=text, ninl=ninl, nout=nout, outtype=outtype)

    def msg(self, text, x, y):
        return self.add("message", [x, y, max(40, 7 * len(text) + 14), 22], text=text, ninl=2, nout=1,
                        outtype=[""])

    def connect(self, a, ao, b, bi):
        self.lines.append({"patchline": {"source": [a, ao], "destination": [b, bi]}})


def gen_patcher(code):
    boxes = [
        {"box": {"id": "obj-1", "maxclass": "codebox", "code": code, "fontface": 0, "fontname": "<Monospaced>",
                 "fontsize": 12.0, "numinlets": 1, "numoutlets": 2, "outlettype": ["", ""],
                 "patching_rect": [20.0, 50.0, 900.0, 700.0]}},
        {"box": {"id": "obj-2", "maxclass": "newobj", "text": "in 1", "numinlets": 0, "numoutlets": 1,
                 "outlettype": [""], "patching_rect": [20.0, 15.0, 30.0, 22.0]}},
        {"box": {"id": "obj-3", "maxclass": "newobj", "text": "out 1", "numinlets": 1, "numoutlets": 0,
                 "patching_rect": [20.0, 770.0, 35.0, 22.0]}},
        {"box": {"id": "obj-4", "maxclass": "newobj", "text": "out 2", "numinlets": 1, "numoutlets": 0,
                 "patching_rect": [880.0, 770.0, 35.0, 22.0]}},
    ]
    lines = [
        {"patchline": {"source": ["obj-2", 0], "destination": ["obj-1", 0]}},
        {"patchline": {"source": ["obj-1", 0], "destination": ["obj-3", 0]}},
        {"patchline": {"source": ["obj-1", 1], "destination": ["obj-4", 0]}},
    ]
    return {
        "fileversion": 1, "appversion": APPVERSION, "classnamespace": "dsp.gen",
        "rect": [100.0, 100.0, 960.0, 840.0], "bglocked": 0, "openinpresentation": 0,
        "default_fontsize": 12.0, "default_fontface": 0, "default_fontname": "Arial",
        "gridonopen": 1, "gridsize": [15.0, 15.0], "gridsnaponopen": 1, "objectsnaponopen": 1,
        "statusbarvisible": 2, "toolbarvisible": 1, "boxanimatetime": 200, "enablehscroll": 1,
        "enablevscroll": 1, "devicewidth": 0.0, "description": "", "digest": "", "tags": "", "style": "",
        "subpatcher_template": "", "assistshowspatchername": 0, "boxes": boxes, "lines": lines,
    }


SECTIONS = [  # name, x
    ("CHORD", 10),
    ("VOICE", 198),
    ("FILTER", 396),
    ("ENV", 594),
    ("ECHO", 792),
    ("SPACE", 944),
    ("OUT", 1096),
]
COLW = 46
ROW_Y = [18, 67, 116]
DEVICE_W = 1196


def build_patcher(code):
    pt = Patch()
    # ------------------------------------------------ core objects
    gen = pt.add("newobj", [40, 1180, 300, 22], text="gen~", ninl=1, nout=2, outtype=["signal", "signal"],
                 patcher=gen_patcher(code))
    plugout = pt.obj("plugout~", 40, 1230, ninl=2, nout=2, outtype=["signal", "signal"])
    pt.connect(gen, 0, plugout, 0)
    pt.connect(gen, 1, plugout, 1)
    thisdev = pt.obj("live.thisdevice", 40, 20, ninl=1, nout=3, outtype=["bang", "int", "int"])

    # ------------------------------------------------ MIDI in -> chord trigger
    notein = pt.obj("notein", 40, 70, ninl=1, nout=3, outtype=["int", "int", "int"])
    pack = pt.obj("pack 0 0", 40, 105, ninl=2, nout=1)
    pt.connect(notein, 0, pack, 0)
    pt.connect(notein, 1, pack, 1)
    rev = pt.obj("zl rev", 40, 140, ninl=2, nout=2)
    pt.connect(pack, 0, rev, 0)
    route = pt.obj("route 0", 40, 175, ninl=2, nout=2)
    pt.connect(rev, 0, route, 0)
    # note off branch
    eq = pt.obj("== 0", 40, 215, ninl=2, nout=1)
    pt.connect(route, 0, eq, 0)
    sel = pt.obj("sel 1", 40, 250, ninl=2, nout=2)
    pt.connect(eq, 0, sel, 0)
    goff = pt.msg("p_gate 0", 40, 285)
    pt.connect(sel, 0, goff, 0)
    pt.connect(goff, 0, gen, 0)
    # note on branch
    unp = pt.obj("unpack 0 0", 200, 215, ninl=1, nout=2)
    pt.connect(route, 1, unp, 0)
    tpitch = pt.obj("t i i", 300, 250, ninl=1, nout=2)
    pt.connect(unp, 1, tpitch, 0)
    pt.connect(tpitch, 0, eq, 1)
    proot = pt.obj("prepend p_root", 300, 285)
    pt.connect(tpitch, 1, proot, 0)
    pt.connect(proot, 0, gen, 0)
    tvel = pt.obj("t b b i", 200, 330, ninl=1, nout=3)
    pt.connect(unp, 0, tvel, 0)
    pvel = pt.obj("prepend p_vel", 330, 370)
    pt.connect(tvel, 2, pvel, 0)
    pt.connect(pvel, 0, gen, 0)
    gon = pt.msg("p_gate 1", 250, 410)
    pt.connect(tvel, 1, gon, 0)
    pt.connect(gon, 0, gen, 0)
    cnt = pt.obj("counter 1 9999", 140, 410, ninl=5, nout=4, outtype=["int", "", "", "int"])
    pt.connect(tvel, 0, cnt, 0)
    ptrig = pt.obj("prepend p_trig", 140, 450)
    pt.connect(cnt, 0, ptrig, 0)
    pt.connect(ptrig, 0, gen, 0)
    # pitch bend & mod wheel
    bend = pt.obj("bendin", 480, 70, ninl=1, nout=2, outtype=["int", "int"])
    pbend = pt.obj("prepend p_bend", 480, 105)
    pt.connect(bend, 0, pbend, 0)
    pt.connect(pbend, 0, gen, 0)
    ctl = pt.obj("ctlin 1", 620, 70, ninl=1, nout=2, outtype=["int", "int"])
    pmw = pt.obj("prepend p_modw", 620, 105)
    pt.connect(ctl, 0, pmw, 0)
    pt.connect(pmw, 0, gen, 0)
    # tempo from Live
    pth = pt.msg("path live_set", 780, 70)
    pt.connect(thisdev, 0, pth, 0)
    lpath = pt.obj("live.path", 780, 105, ninl=1, nout=3)
    pt.connect(pth, 0, lpath, 0)
    obs = pt.obj("live.observer tempo", 780, 140, ninl=2, nout=2)
    pt.connect(lpath, 0, obs, 1)
    pbpm = pt.obj("prepend p_bpm", 780, 175)
    pt.connect(obs, 0, pbpm, 0)
    pt.connect(pbpm, 0, gen, 0)

    # ------------------------------------------------ UI
    def comment(text, rect, size=9.5, face=0, prect=None):
        return pt.add("live.comment", prect or rect, text=text, ninl=1, nout=0, presentation=1,
                      presentation_rect=[float(x) for x in rect], fontsize=size, fontface=face,
                      textjustification=0)

    secx = {s[0]: s[1] for s in SECTIONS}
    for name, x in SECTIONS:
        comment(name, [x, 1, 90, 15], size=10.0, face=1, prect=[1300 + x, 20, 90, 15])

    ui_i = 0
    for p in P:
        sec = p["sec"]
        x0 = secx[sec]
        px = 40 + (ui_i % 10) * 110
        py = 520 + (ui_i // 10) * 130
        ui_i += 1
        vo = {
            "parameter_longname": p["long"],
            "parameter_shortname": p["short"],
            "parameter_type": 2 if p["kind"] == "menu" else (1 if p["kind"] == "int" else 0),
            "parameter_mmin": float(p["lo"]),
            "parameter_mmax": float(p["hi"]),
            "parameter_initial_enable": 1,
            "parameter_initial": [p["default"]],
        }
        if p["kind"] == "menu":
            vo["parameter_enum"] = p["enum"]
            vo["parameter_mmax"] = float(len(p["enum"]) - 1)
            if sec == "CHORD":
                lx, ly = 10, 17 + p["row"] * 37
                comment(p["short"], [lx, ly, 74, 14], size=9.0, prect=[px, py - 18, 74, 14])
                rect = [lx, ly + 14, 76, 15]
            else:  # menus that sit in a dial slot
                cx = x0 + p["col"] * COLW
                comment(p["short"], [cx, ROW_Y[p["row"]] + 4, 46, 14], size=9.0, prect=[px, py - 18, 46, 14])
                rect = [cx, ROW_Y[p["row"]] + 21, 44, 15]
            ui = pt.add("live.menu", [px, py, rect[2], 15], ninl=1, nout=3, outtype=["", "", "float"],
                        parameter_enable=1, presentation=1, presentation_rect=[float(v) for v in rect],
                        varname=p["long"], saved_attribute_attributes={"valueof": vo})
        else:
            vo["parameter_unitstyle"] = p["unit"]
            if p["exp"] != 1.0:
                vo["parameter_exponent"] = float(p["exp"])
            if p["kind"] == "int":
                vo["parameter_steps"] = int(p["hi"] - p["lo"] + 1)
            if sec == "CHORD":
                cx = 94 + (p["col"] - 1) * COLW
            else:
                cx = x0 + p["col"] * COLW
            rect = [cx, ROW_Y[p["row"]], 44, 48]
            ui = pt.add("live.dial", [px, py, 44, 48], ninl=1, nout=2, outtype=["", "float"],
                        parameter_enable=1, presentation=1, presentation_rect=[float(v) for v in rect],
                        varname=p["long"], saved_attribute_attributes={"valueof": vo})
        pre = pt.obj("prepend %s" % p["name"], px, py + 62)
        pt.connect(ui, 0, pre, 0)
        pt.connect(pre, 0, gen, 0)
        pt.connect(thisdev, 0, ui, 0)

    patcher = {
        "fileversion": 1, "appversion": APPVERSION, "classnamespace": "box",
        "rect": [60.0, 80.0, 1500.0, 1300.0], "openrect": [0.0, 0.0, 0.0, 169.0], "bglocked": 0,
        "openinpresentation": 1, "default_fontsize": 10.0, "default_fontface": 0,
        "default_fontname": "Arial Bold", "gridonopen": 1, "gridsize": [8.0, 8.0], "gridsnaponopen": 1,
        "objectsnaponopen": 0, "statusbarvisible": 2, "toolbarvisible": 1, "lefttoolbarpinned": 0,
        "toptoolbarpinned": 0, "righttoolbarpinned": 0, "bottomtoolbarpinned": 0,
        "toolbars_unpinned_last_save": 0, "tallnewobj": 0, "boxanimatetime": 500, "enablehscroll": 1,
        "enablevscroll": 1, "devicewidth": float(DEVICE_W),
        "description": "NEBBIA - living chord engine: one key, a voice-led chord, analog-behaving voices, "
                       "dub tape echo and a space that retunes to the chord.",
        "digest": "Living chord engine for dub techno", "tags": "", "style": "", "subpatcher_template": "",
        "assistshowspatchername": 0, "boxes": pt.boxes, "lines": pt.lines, "dependency_cache": [],
        "latency": 0, "is_mpe": 0, "minimum_live_version": "", "minimum_max_version": "",
        "platform_compatibility": 0, "autosave": 0,
    }
    return {"patcher": patcher}


def write_amxd(patch, path):
    data = json.dumps(patch, indent="\t").encode("utf-8") + b"\n\x00"
    head = b"ampf" + struct.pack("<I", 4) + b"iiii"
    head += b"meta" + struct.pack("<I", 4) + b"\x00\x00\x00\x00"
    head += b"ptch" + struct.pack("<I", len(data))
    with open(path, "wb") as f:
        f.write(head + data)


def main():
    code, functions, body, hist, delays = build_genexpr()
    with open(os.path.join(HERE, "nebbia.genexpr"), "w") as f:
        f.write(code)
    with open(os.path.join(ROOT, "test", "nebbia_sim.js"), "w") as f:
        f.write(to_js(functions, body, hist, delays, 48000))
    patch = build_patcher(code)
    with open(os.path.join(ROOT, "Nebbia.maxpat"), "w") as f:
        json.dump(patch, f, indent="\t")
    write_amxd(patch, os.path.join(ROOT, "Nebbia.amxd"))
    with open(os.path.join(ROOT, "test", "params.json"), "w") as f:
        json.dump(P, f, indent=1)
    print("gen code: %d lines, %d History, %d Delay, %d params" %
          (code.count("\n"), len(hist), len(delays), len(P)))


if __name__ == "__main__":
    main()
