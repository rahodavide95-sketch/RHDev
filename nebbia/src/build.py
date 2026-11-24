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
    ("Fifths", [0, 7, 14, 21]),
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


def param(name, long, short, kind, lo, hi, default, unit=5, exp=1.0, sec=None, col=0, row=0, enum=None,
          rect=None, lrect=None, label=("OFF", "ON"), dims=None, ui=None):
    P.append(dict(name=name, long=long, short=short, kind=kind, lo=lo, hi=hi, default=default,
                  unit=unit, exp=exp, sec=sec, col=col, row=row, enum=enum, rect=rect, lrect=lrect,
                  label=label, dims=dims, ui=ui or {}))


# SEQ: 8 steps laid out like a hardware step sequencer. Each step: ON button (at most 4 on), NOTE knob in
# semitones from the Key (or from the held key in Trans mode), ACC (accent) button. One row of controls below.
SEQ_RATES = [("1/16", 0.25), ("1/8", 0.5), ("1/4", 1.0), ("1/2", 2.0), ("1 Bar", 4.0), ("2 Bar", 8.0)]
NCELL = 8
MAXON = 4
SEQ_DEF_ON = [0, 1, 0, 1, 0, 1, 0, 1]  # off-beat 8ths
SEQ_VEL, SEQ_ACC_VEL = 90, 122
PRESET_X = 10
SEQ_X = 130
STEPW = 41  # step column pitch
param("p_seqon", "Seq On", "Seq On", "power", 0, 1, 0, sec="SEQ")
param("p_seqmode", "Seq Mode", "Mode", "menu", 0, 1, 0, sec="SEQ", enum=["Play", "Trans"],
      lrect=[SEQ_X, 113, 52, 13], rect=[SEQ_X, 127, 52, 16])
param("p_seqrate", "Seq Rate", "Rate", "menu", 0, len(SEQ_RATES) - 1, 1, sec="SEQ", enum=[r[0] for r in SEQ_RATES],
      lrect=[SEQ_X + 56, 113, 48, 13], rect=[SEQ_X + 56, 127, 48, 16])
param("p_seqlen", "Seq Length", "Length", "int", 1, NCELL, NCELL, unit=0, sec="SEQ", rect=[SEQ_X + 108, 112, 40, 48])
param("p_sgate", "Seq Gate", "Gate", "dial", 5, 100, 50, sec="SEQ", rect=[SEQ_X + 150, 112, 40, 48])
param("p_swing", "Seq Swing", "Swing", "dial", 0, 100, 0, sec="SEQ", rect=[SEQ_X + 192, 112, 40, 48])
param("p_schance", "Seq Chance", "Chance", "dial", 0, 100, 100, sec="SEQ", rect=[SEQ_X + 234, 112, 40, 48])
for c in range(NCELL):
    cx = SEQ_X + c * STEPW
    param("p_son%d" % (c + 1), "Step %d On" % (c + 1), "%d" % (c + 1), "toggle", 0, 1, SEQ_DEF_ON[c], sec="SEQ",
          rect=[cx, 31, 38, 16])
    param("p_snote%d" % (c + 1), "Step %d Note" % (c + 1), "Note %d" % (c + 1), "int", -24, 24, 0, unit=7,
          sec="SEQ", rect=[cx, 50, 38, 40], ui=dict(showname=0))
    param("p_sacc%d" % (c + 1), "Step %d Accent" % (c + 1), "ACC", "toggle", 0, 1, 0, sec="SEQ",
          rect=[cx, 93, 38, 13])

# CHORD (4 stacked menus + 2 dial columns)
param("p_harm", "Harmony", "Harmony", "menu", 0, 7, 0, sec="CHORD", col=0, row=0,
      enum=["Fixed"] + [s[0] for s in SCALES])
param("p_chord", "Chord", "Chord", "menu", 0, len(CHORDS) - 1, 1, sec="CHORD", col=0, row=1,
      enum=[c[0] for c in CHORDS])
param("p_key", "Key", "Key", "menu", 0, 11, 9, sec="CHORD", col=0, row=2, enum=KEYS)
param("p_voicing", "Voicing", "Voicing", "menu", 0, 7, 6, sec="CHORD", col=0, row=3, enum=VOICINGS)
param("p_notes", "Voices", "Voices", "int", 2, 6, 5, unit=0, sec="CHORD", col=1, row=0)
param("p_oct", "Octave", "Octave", "int", -3, 3, 0, unit=0, sec="CHORD", col=1, row=1)
param("p_strum", "Strum", "Strum", "dial", -250, 250, 6, unit=2, sec="CHORD", col=3, row=0)
param("p_glide", "Glide", "Glide", "dial", 0, 2000, 0, unit=2, exp=3.0, sec="CHORD", col=2, row=0)
param("p_human", "Humanize", "Humanize", "dial", 0, 100, 30, sec="CHORD", col=2, row=1)
param("p_bendr", "Bend Range", "Bend", "int", 0, 12, 2, unit=0, sec="CHORD", col=3, row=1)
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
param("p_sag", "Sag", "Sag", "dial", 0, 100, 15, sec="VOICE", col=3, row=2)
# FILTER
param("p_cutoff", "Cutoff", "Cutoff", "dial", 30, 16000, 900, unit=3, exp=3.0, sec="FILTER", col=0, row=0)
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
param("p_ehicut", "Echo High Cut", "High Cut", "dial", 400, 16000, 3600, unit=3, exp=2.0, sec="ECHO", col=1, row=1)
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
param("p_damp", "Space Damp", "Damp", "dial", 0, 100, 35, sec="SPACE", col=2, row=1)
param("p_rlocut", "Space Low Cut", "Low Cut", "dial", 20, 800, 150, unit=3, exp=2.0, sec="SPACE", col=0, row=2)
param("p_diff", "Space Diffusion", "Diffusion", "dial", 0, 100, 80, sec="SPACE", col=1, row=2)
param("p_rmod", "Space Mod", "Mod", "dial", 0, 100, 35, sec="SPACE", col=2, row=2)
# OUT
param("p_chorus", "Chorus", "Chorus", "dial", 0, 100, 40, sec="OUT", col=0, row=0)
param("p_crate", "Chorus Rate", "Ch Rate", "dial", 0.05, 6, 0.5, unit=3, exp=2.0, sec="OUT", col=1, row=0)
param("p_cdepth", "Chorus Depth", "Ch Depth", "dial", 0, 100, 50, sec="OUT", col=0, row=1)
param("p_width", "Width", "Width", "dial", 0, 100, 80, sec="OUT", col=1, row=1)
param("p_vol", "Volume", "Volume", "dial", -60, 12, -3, unit=4, sec="OUT", col=0, row=2)

# DICE (gen side; the Randomize button, Amount and locks live in Max only)
CHORD_X = SEQ_X + 346
DICE_X = CHORD_X + 234
param("p_cchance", "Chord Chance", "Chance", "dial", 0, 100, 0, sec="DICE",
      rect=[DICE_X, 116, 44, 48])
param("p_cdice", "Chord Dice", "Chord Dice", "menu", 0, 3, 2, sec="DICE",
      enum=["Color", "Voicing", "Both", "Wild"], rect=[DICE_X + 50, 136, 86, 15],
      lrect=[DICE_X + 50, 121, 86, 13])

param("p_diceon", "Dice On", "Dice On", "power", 0, 1, 1, sec="DICE", dims=["p_cchance", "p_cdice"])

# Section switches (header buttons). dims = controls greyed out when the switch is off (None = whole section)
param("p_chordon", "Chord On", "Chord On", "power", 0, 1, 1, sec="CHORD",
      dims=["p_harm", "p_chord", "p_key", "p_voicing", "p_notes", "p_strum"])
param("p_analogon", "Analog", "Analog", "power", 0, 1, 1, sec="VOICE", label=("ANALOG", "ANALOG"),
      dims=["p_drift", "p_driftrate", "p_age", "p_sag"])
param("p_filton", "Filter On", "Filter On", "power", 0, 1, 1, sec="FILTER")
param("p_echoon", "Echo On", "Echo On", "power", 0, 1, 1, sec="ECHO")
param("p_spaceon", "Space On", "Space On", "power", 0, 1, 1, sec="SPACE")
param("p_reverbon", "Reverb On", "Reverb On", "power", 0, 1, 1, sec="SPACE", label=("REV", "REV"),
      dims=["p_rdecay", "p_rsize", "p_diff", "p_rmod"])
param("p_choron", "Chorus On", "Chorus On", "power", 0, 1, 1, sec="OUT", label=("CHORUS", "CHORUS"),
      dims=["p_chorus", "p_crate", "p_cdepth"])

# Params driven by MIDI (not UI)
MIDI_PARAMS = [("p_root", 60), ("p_vel", 100), ("p_gate", 0), ("p_trig", 0),
               ("p_bend", 64), ("p_modw", 0), ("p_bpm", 120), ("p_playing", 0), ("p_songbeat", 0)]

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
# dark colours only (no major / dominant chords): used by Randomize and by the "Wild" dice
DARK_CHORDS = [i for i, c in enumerate(CHORDS) if c[0] not in ("Major", "Maj7", "Maj9", "Dom9")]
# indexes into CHORDS: minor-ish colours and major-ish colours for the "Color" dice
FAM_MIN = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 15]
FAM_MAJ = [10, 11, 12, 13, 7, 8, 6, 15]
FDN_MS = [29.3, 36.7, 41.3, 47.9, 53.7, 61.1, 67.9, 76.3]


def fnum(x):
    if isinstance(x, str):
        return x
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
    f.append("// chord families used by the dice\nfammin(i) {\n\treturn %s;\n}\n" % tern("i", FAM_MIN))
    f.append("fammaj(i) {\n\treturn %s;\n}\n" % tern("i", FAM_MAJ))
    f.append("famdark(i) {\n\treturn %s;\n}\n" % tern("i", DARK_CHORDS))
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
    smooth("s_emix", "clamp(p_emix, 0, 100) * 0.01 * (p_echoon > 0.5)", PDEF["p_emix"] / 100)
    smooth("s_rmix", "clamp(p_rmix, 0, 100) * 0.01 * (p_spaceon > 0.5)", PDEF["p_rmix"] / 100)
    smooth("s_eon", "p_echoon > 0.5", 1.0)
    smooth("s_son", "p_spaceon > 0.5", 1.0)
    smooth("s_rev", "p_reverbon > 0.5", 1.0)
    smooth("s_flt", "p_filton > 0.5", 1.0)
    smooth("s_tune", "clamp(p_tune, 0, 100) * 0.01", PDEF["p_tune"] / 100)
    smooth("s_chor", "clamp(p_chorus, 0, 100) * 0.01 * (p_choron > 0.5)", PDEF["p_chorus"] / 100)
    smooth("s_wid", "clamp(p_width, 0, 100) * 0.01", PDEF["p_width"] / 100)
    smooth("s_vol", "exp(clamp(p_vol, -70, 12) * 0.1151293)", 10 ** (PDEF["p_vol"] / 20))
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
    w("anon = p_analogon > 0.5;")
    w("drift = clamp(p_drift, 0, 100) * 0.01 * anon;")
    w("age = clamp(p_age, 0, 100) * 0.01 * anon;")
    w("fenv = clamp(p_fenv, -100, 100) * 0.06;")
    w("ktrk = clamp(p_ktrk, 0, 100) * 0.01 * 0.0833333;")
    w("lfoamt = clamp(p_lfoamt, 0, 100) * 0.02;")
    w("vsens = clamp(p_velsens, 0, 100) * 0.01;")
    w("sagk = clamp(p_sag, 0, 100) * 0.01 * anon;")
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
    # oscillator mix normalised to unity; the filter input is clean at Drive 0 and saturates as Drive rises
    w("mixn = 1 / (1 + lv2 * 0.85 + subl * 0.5);")
    w("gdrv = 0.38 * exp(s_drv * 2.2);")
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
    w("// ---- 4-step sequencer, locked to Live's beat (in1 carries plugphasor~)")
    for hn, iv in [("h_bph", 0.0), ("h_bint", 0.0), ("h_sbeat", 0.0), ("h_lastk", -1.0), ("h_scnt", 0.0),
                   ("h_sgt", 0.0), ("h_src", 0.0), ("h_rootin", 60.0), ("h_velin", 100.0)]:
        H(hn, iv)
    w("smode = (p_seqon > 0.5) * (1 + floor(p_seqmode + 0.5));")
    w("mtrig = p_trig != h_trig;")
    w("mgate = p_gate > 0.5;")
    w("bph = clamp(in1, 0, 1);")
    w("bint = h_bint + (bph < h_bph - 0.5);")
    w("if (p_songbeat != h_sbeat) {")
    w("\tbint = floor(p_songbeat - bph + 0.5);")
    w("}")
    w("sbpm = clamp(p_bpm, 20, 999);")
    w("slb = %s;" % tern("floor(p_seqrate + 0.5)", [r[1] for r in SEQ_RATES]))
    w("slen = clamp(floor(p_seqlen + 0.5), 1, %d);" % NCELL)
    w("su = (bint + bph) / slb;")
    w("kk = floor(su);")
    w("sfr = su - kk;")
    w("stp = kk - slen * floor(kk / slen);")
    w("srun = (smode > 0.5) * (p_playing > 0.5) * ((smode < 1.5) + mgate > 0);")
    w("sodd = stp - 2 * floor(stp * 0.5);")
    w("sdl = (sodd > 0.5) * clamp(p_swing, 0, 100) * 0.005;")
    w("sready = (kk != h_lastk) * (sfr >= sdl) * (sfr < sdl + 0.5);")
    w("lastk = -1;")
    w("if (srun > 0) {")
    w("\tlastk = (sready > 0) ? kk : h_lastk;")
    w("}")
    pick = lambda pre: tern("stp", ["%s%d" % (pre, c + 1) for c in range(NCELL)])
    w("strig = 0;")
    w("if (srun * sready > 0) {")
    w("\tif (%s > 0.5) {" % pick("p_son"))
    w("\t\tif ((noise() * 0.5 + 0.5) < clamp(p_schance, 0, 100) * 0.01) {")
    w("\t\t\tstrig = 1;")
    w("\t\t}")
    w("\t}")
    w("}")
    w("snote = ((smode > 1.5) ? floor(p_root + 0.5) : (48 + floor(p_key + 0.5))) + floor(%s + 0.5);" % pick("p_snote"))
    w("svel = (%s > 0.5) ? %d : %d;" % (pick("p_sacc"), SEQ_ACC_VEL, SEQ_VEL))
    w("scnt = min(h_scnt + 1, 100000000);")
    w("sgt = h_sgt;")
    w("if (strig > 0) {")
    w("\tscnt = 0;")
    w("\tsgt = 1;")
    w("}")
    w("if (scnt >= clamp(p_sgate, 1, 100) * 0.01 * slb * 60 / sbpm * sr) {")
    w("\tsgt = 0;")
    w("}")
    w("if (srun < 0.5) {")
    w("\tsgt = 0;")
    w("}")
    w("mt = mtrig * (smode < 1.5);")
    w("src = h_src;")
    w("rootin = h_rootin;")
    w("velin = h_velin;")
    w("if (mt > 0) {")
    w("\tsrc = 0;")
    w("\trootin = p_root;")
    w("\tvelin = p_vel;")
    w("}")
    w("if (strig > 0) {")
    w("\tsrc = 1;")
    w("\trootin = snote;")
    w("\tvelin = svel;")
    w("}")
    for hn, ex in [("h_bph", "bph"), ("h_bint", "bint"), ("h_sbeat", "p_songbeat"), ("h_lastk", "lastk"),
                   ("h_scnt", "scnt"), ("h_sgt", "sgt"), ("h_src", "src"), ("h_rootin", "rootin"),
                   ("h_velin", "velin")]:
        U(hn, ex)
    w("")
    H("h_trig", 0.0); H("h_st", 0.0)
    w("trig = (mt + strig) > 0;")
    w("gon = (src > 0.5) ? sgt : mgate * (smode < 1.5);")
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
    w("\tdz = 0;")
    w("\tif (trig > 0) {")
    w("\t\tdz = ((noise() * 0.5 + 0.5) < clamp(p_cchance, 0, 100) * 0.01) * (p_diceon > 0.5) * (p_chordon > 0.5);")
    w("\t}")
    w("\tdmd = floor(p_cdice + 0.5);")
    w("\tdcol = dz * (dmd != 1);")
    w("\tdvoi = dz * (dmd != 0);")
    w("\tdwild = dz * (dmd > 2.5);")
    w("\trc = noise() * 0.5 + 0.5;")
    w("\tro = noise();")
    w("\trv = noise() * 0.5 + 0.5;")
    w("\troot = floor(rootin + 0.5) + 12 * floor(p_oct + 0.5);")
    w("\tif (dvoi > 0) {")
    w("\t\troot = root - 12 * (ro < -0.7);")
    w("\t}")
    w("\tharm = floor(p_harm + 0.5);")
    w("\tnreq = clamp(floor(p_notes + 0.5), 2, 6);")
    w("\tif (dcol * (harm > 0.5) > 0) {")
    w("\t\tnreq = 3 + min(floor(rc * 4), 3);")
    w("\t}")
    w("\tn = nreq;")
    for k in range(NV):
        w("\ta%d = root;" % k)
    w("\tif (harm < 0.5) {")
    w("\t\tcid = clamp(floor(p_chord + 0.5), 0, %d);" % (len(CHORDS) - 1))
    w("\t\tif (dcol > 0) {")
    w("\t\t\tif (dwild > 0) {")
    w("\t\t\t\tcid = famdark(min(floor(rc * %d), %d));" % (len(DARK_CHORDS), len(DARK_CHORDS) - 1))
    w("\t\t\t}")
    w("\t\t\telse if ((cid > 9.5) * (cid < 13.5) > 0) {")
    w("\t\t\t\tcid = fammaj(min(floor(rc * %d), %d));" % (len(FAM_MAJ), len(FAM_MAJ) - 1))
    w("\t\t\t}")
    w("\t\t\telse {")
    w("\t\t\t\tcid = fammin(min(floor(rc * %d), %d));" % (len(FAM_MIN), len(FAM_MIN) - 1))
    w("\t\t\t}")
    w("\t\t}")
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
    w("\tif (dvoi > 0) {")
    w("\t\tvm = min(floor(rv * 6), 5);")
    w("\t}")
    w("\tif (p_chordon < 0.5) {")
    w("\t\tn = 1;")
    w("\t\tvm = 0;")
    w("\t}")
    w("\tjj = 0;")
    w("\too = 0;")
    w("\tif ((vm > 0.5) * (vm < 3.5) > 0) {")
    w("\t\tjj = min(vm, n - 1);")
    w("\t\tif (dvoi * (jj * 2 > n) > 0) {")
    w("\t\t\too = -12;")
    w("\t\t}")
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
    w("\tcmean = (%s) / n;" % " + ".join(["q0"] + ["q%d * (n > %d)" % (s, s) for s in range(1, NV)]))
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
        w(V("\tvl_# = clamp(velin / 127, 0, 1) * (1 - hum * 0.25 * (noise() * 0.5 + 0.5));"))
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
        w(V("vin_# = (sw_# * (1 - shp) + pl_# * shp + s2_# * lv2 + noise() * air%s) * mixn;" % extra))
        # ladder
        w(V("fco_# = s_cut + fenv * fe_# * vF_# + ktrk * (pv_# - 60) + lfo1 * lfoamt + s_mw + age * %s"
            " + drift * gdv * 0.15 - sagk * h_sagv * 0.35;" % fnum(t["f"])))
        w(V("fc_# = clamp(exp(fco_# * 0.693147), 16, sr * 0.42);"))
        w(V("g_# = tan(fc_# * 3.14159265 * isr);"))
        w(V("G_# = g_# / (1 + g_#);"))
        w(V("B_# = 1 / (1 + g_#);"))
        w(V("k_# = s_res * 4.2 * (1 + age * %s);" % fnum(t["r"] * 0.05)))
        w(V("S_# = B_# * (G_# * G_# * G_# * h_l1_# + G_# * G_# * h_l2_# + G_# * h_l3_# + h_l4_#);"))
        w(V("u_# = tanh((vin_# * gdrv - k_# * S_#) / (1 + k_# * G_# * G_# * G_# * G_#));"))
        w(V("v1_# = (u_# - h_l1_#) * G_#;"))
        w(V("y1_# = v1_# + h_l1_#;"))
        w(V("v2_# = (y1_# - h_l2_#) * G_#;"))
        w(V("y2_# = v2_# + h_l2_#;"))
        w(V("v3_# = (y2_# - h_l3_#) * G_#;"))
        w(V("y3_# = v3_# + h_l3_#;"))
        w(V("v4_# = (y3_# - h_l4_#) * G_#;"))
        w(V("y4_# = v4_# + h_l4_#;"))
        # resonance bass compensation and the drive make-up gain come after the filter, so they never overdrive it
        w(V("vo_# = (((p_slope < 0.5) ? y4_# : y2_#) * (1 + 0.6 * k_#) / gdrv * s_flt + vin_# * (1 - s_flt)) * ae_# * vA_# * sagg;"))
        w(V("vo_# = vo_# * (1 + age * %s);" % fnum(t["g"])))
        sign = "-1" if s % 2 == 0 else "1"
        w(V("pn_# = s_wid * %s * (0.25 + 0.75 * min(# / max(nn - 1, 1), 1));" % sign))
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
    w("// ================= stereo ensemble (three BBD lines per side, like the string-machine chorus) =================")
    D("chM", 8192)
    H("h_cph", 0.0); H("h_vph", 0.0); H("h_cbl", 0.0); H("h_cbr", 0.0)
    w("cph = h_cph + clamp(p_crate, 0.01, 20) * isr;")
    w("cph = cph - floor(cph);")
    w("vph = h_vph + 5.7 * isr;")
    w("vph = vph - floor(vph);")
    w("cdp = clamp(p_cdepth, 0, 100) * 0.025;")
    w("chM.write((vL + vR) * 0.5);")
    taps = []
    for i in range(3):
        for side, off in (("l", 0.0), ("r", 0.5)):
            ph = i / 3 + off
            w("ce%s%d = chM.read((4.2 + cdp * ftri(cph + %s) + 0.12 * sin(6.2831853 * (vph + %s))) * 0.001 * sr);"
              % (side, i, fnum(ph), fnum(ph)))
    w("cwl = (cel0 + cel1 + cel2) * 0.333333;")
    w("cwr = (cer0 + cer1 + cer2) * 0.333333;")
    w("cbb = 1 - exp(-6.2831853 * 9000 * isr);")
    w("cbl = h_cbl + (cwl - h_cbl) * cbb;")
    w("cbr = h_cbr + (cwr - h_cbr) * cbb;")
    w("xL = vL * (1 - 0.35 * s_chor) + cbl * s_chor * 1.1;")
    w("xR = vR * (1 - 0.35 * s_chor) + cbr * s_chor * 1.1;")
    U("h_cph", "cph"); U("h_vph", "vph"); U("h_cbl", "cbl"); U("h_cbr", "cbr")

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
    w("ein = (xL + xR) * 0.5;")
    w("edL.write((ein + s_efb * (etl * (1 - pp) + etr * pp)) * s_eon);")
    w("edR.write((ein * (1 - pp) + s_efb * (etr * (1 - pp) + etl * pp)) * s_eon);")
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
    w("sex = (hil + hir) * 0.5 * s_tune * s_son;")
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
    w("rinl = (hil * (1 - 0.7 * s_tune) + stL * s_tune * %s) * s_son * s_rev;" % fnum(STR_IN))
    w("rinr = (hir * (1 - 0.7 * s_tune) + stR * s_tune * %s) * s_son * s_rev;" % fnum(STR_IN))
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
    # with the internal reverb off the strings come out on their own, louder (they no longer feed the reverb)
    w("sgo = %s + 0.55 * (1 - s_rev);" % fnum(STR_OUT))
    w("ml = xL + el2 * s_emix + (rvL * s_rev + stL * s_tune * sgo) * s_rmix;")
    w("mr = xR + er2 * s_emix + (rvR * s_rev + stR * s_tune * sgo) * s_rmix;")
    w("msw = 0.8 + 0.5 * s_wid;")
    w("mmid = (ml + mr) * 0.5;")
    w("mside = (ml - mr) * 0.5 * msw;")
    w("dyl = (mmid + mside) - h_dxl + 0.9993 * h_dyl;")
    w("dyr = (mmid - mside) - h_dxr + 0.9993 * h_dyr;")
    U("h_dxl", "mmid + mside"); U("h_dyl", "dyl"); U("h_dxr", "mmid - mside"); U("h_dyr", "dyr")
    # clean look-ahead peak limiter at -1.5 dBFS: the level is read 64 samples ahead of the audio, the gain glides
    # down in ~0.25 ms (fully settled before the peak arrives) and recovers in ~100 ms, so nothing reaches the soft
    # clip and nothing is squared off
    D("lkL", 128); D("lkR", 128)
    H("h_lenv", 0.0); H("h_lg", 1.0)
    w("lkL.write(dyl);")
    w("lkR.write(dyr);")
    w("lpk = max(abs(dyl), abs(dyr)) * s_vol;")
    w("lenv = (lpk > h_lenv) ? lpk : h_lenv * exp(-12.5 / sr);")
    w("lgt = (lenv > 0.84) ? 0.84 / lenv : 1;")
    w("lg = h_lg + (lgt - h_lg) * ((lgt < h_lg) ? (1 - exp(-4000 / sr)) : (1 - exp(-10 / sr)));")
    U("h_lenv", "lenv"); U("h_lg", "lg")
    w("out1 = sclip(lkL.read(64) * s_vol * lg);")
    w("out2 = sclip(lkR.read(64) * s_vol * lg);")
    for s in range(NV):
        w("out%d = (%d < nn) ? q%d : -1;" % (s + 3, s, s))
    w("out%d = (srun > 0) ? stp : -1;" % (NV + 3))
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
    js.append("const P = {in1: 0, %s};" % ", ".join("%s: %s" % (p, fnum(PDEF[p])) for p in params))
    for nm, v in hist.items():
        js.append("let %s = %s;" % (nm, fnum(v)))
    for nm, sz in delays.items():
        js.append("const %s = new GDelay(%d);" % (nm, sz))
    btxt = "\n".join(body)
    # params become P.x
    btxt = re.sub(r"\bin1\b", "P.in1", btxt)
    for p in sorted(params, key=len, reverse=True):
        btxt = re.sub(r"\b%s\b" % p, "P." + p, btxt)
    locs = sorted(set(re.findall(r"\b([A-Za-z_]\w*)\s*=(?!=)", btxt)) - set(hist) - {"out1", "out2"})
    js.append("let out1 = 0, out2 = 0;")
    js.append("function perform() {\n\tlet %s;\n%s\n}" % (", ".join(locs), btxt))
    js.append("module.exports = { P, perform, peek: (n) => eval(n), get out() { return [out1, out2]; } };")
    return "\n".join(js) + "\n"


def to_web_js(functions, body, hist, delays, target="worklet"):
    """Faster JavaScript twin for the web player (same results as to_js): statements that only depend on
    the controls run once per audio block (perBlock), the chord brain runs in its own function, and every
    variable lives at module level so that the per-sample function stays small enough for the JIT.
    target "worklet" adds an AudioWorkletProcessor, "node" exports the functions for tests."""
    base = to_js(functions, body, hist, delays, 48000)
    head = base[:base.index("let out1 = 0, out2 = 0;")]
    head = head.replace("// generated by src/build.py - JavaScript twin of nebbia.genexpr for offline tests",
                        "// generated by src/build.py - NEBBIA engine for the web player (same DSP as the device)")
    if target == "worklet":
        head = head.replace("const samplerate = 48000;", "const samplerate = sampleRate;")
    params = [p["name"] for p in P] + [m[0] for m in MIDI_PARAMS]
    btxt = "\n".join(body)
    btxt = re.sub(r"\bin1\b", "P.in1", btxt)
    for p in sorted(params, key=len, reverse=True):
        btxt = re.sub(r"\b%s\b" % p, "P." + p, btxt)
    lines = btxt.split("\n")
    start = lines.index("if (trig + chg > 0) {")
    depth, end = 0, None
    for i in range(start, len(lines)):
        depth += lines[i].count("{") - lines[i].count("}")
        if depth == 0:
            end = i
            break
    chord = lines[start + 1:end]
    main = lines[:start] + ["if (trig + chg > 0) {", "\tchordBlock();", "}"] + lines[end + 1:]
    assigned = re.findall(r"\b([A-Za-z_]\w*)\s*=(?!=)", btxt)
    count = {}
    for nm in assigned:
        count[nm] = count.get(nm, 0) + 1
    fn_names = set(re.findall(r"^([A-Za-z_]\w*)\s*\(", functions, re.M))
    safe = fn_names | {"exp", "log", "tan", "tanh", "sin", "cos", "sqrt", "floor", "abs", "pow", "min", "max",
                       "clamp", "samplerate"}
    block_vars, hoisted, keep = set(), [], []
    for ln in main:
        m = re.match(r"^([A-Za-z_]\w*) = (.*);$", ln)
        if m and count.get(m.group(1)) == 1 and m.group(1) not in hist:
            ids = set(re.findall(r"\b([A-Za-z_]\w*)\b", re.sub(r"P\.\w+", "", m.group(2)))) - {"e"}
            ids = {i for i in ids if not re.match(r"^\d", i)}
            if "noise" not in ids and ids <= (safe | block_vars):
                hoisted.append(ln)
                block_vars.add(m.group(1))
                continue
        keep.append(ln)
    locs = sorted(set(assigned) - set(hist) - {"out1", "out2"} - {"out%d" % i for i in range(3, 3 + NV + 1)})
    js = [head]
    js.append("let out1 = 0, out2 = 0, %s;" % ", ".join("out%d = -1" % i for i in range(3, 3 + NV + 1)))
    js.append("let %s;" % ", ".join(locs))
    js.append("function perBlock() {\n%s\n}" % "\n".join("\t" + ln for ln in hoisted))
    js.append("function chordBlock() {\n%s\n}" % "\n".join(chord))
    js.append("function perform() {\n%s\n}" % "\n".join("\t" + ln for ln in keep))
    if target == "node":
        js.append("module.exports = { P, perBlock, perform, peek: (n) => eval(n), "
                  "get out() { return [out1, out2]; } };")
    else:
        js.append(WORKLET_TAIL % {"chord": ", ".join("out%d" % i for i in range(3, 3 + NV)), "step": "out%d" % (3 + NV)})
    return "\n".join(js) + "\n", len(hoisted), len(keep)


WORKLET_TAIL = """
// ---------------------------------------------------------------- the web player's audio processor
class NebbiaProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.beat = 0; this.playing = false; this.root = -1; this.blocks = 0; this.busy = 0; this.spent = 0;
    this.port.onmessage = (e) => this.message(e.data);
    const init = options && options.processorOptions && options.processorOptions.init;
    if (init) for (const m of init) this.message(m);
  }
  message(d) {
    if (d.params) for (const k in d.params) if (k in P) P[k] = d.params[k];
    if (d.noteOn !== undefined) {
      P.p_root = d.noteOn; P.p_vel = d.vel || 100; P.p_gate = 1; P.p_trig = (P.p_trig %% 9999) + 1;
      this.root = d.noteOn;
    }
    if (d.noteOff !== undefined && d.noteOff === this.root) P.p_gate = 0;
    if (d.play !== undefined) {
      this.playing = !!d.play; this.beat = 0;
      P.p_playing = this.playing ? 1 : 0; P.p_songbeat = this.playing ? 0.0001 : 0;
    }
  }
  process(inputs, outputs) {
    const ch = outputs[0], L = ch[0], R = ch[1] || ch[0];
    const t0 = Date.now();
    perBlock();
    const inc = P.p_bpm / 60 / samplerate;
    for (let i = 0; i < L.length; i++) {
      if (this.playing) this.beat += inc;
      P.in1 = this.beat - Math.floor(this.beat);
      perform();
      L[i] = out1; if (R !== L) R[i] = out2;
    }
    this.spent += Date.now() - t0;
    if (++this.blocks %% 32 === 0) {
      if (this.playing) P.p_songbeat = this.beat;
      const budget = 32 * L.length / samplerate * 1000;
      this.port.postMessage({ chord: [%(chord)s], step: %(step)s, load: this.spent / budget });
      this.spent = 0;
    }
    return true;
  }
}
registerProcessor('nebbia', NebbiaProcessor);
"""


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
                 "fontsize": 12.0, "numinlets": 1, "numoutlets": 3 + NV, "outlettype": [""] * (3 + NV),
                 "patching_rect": [20.0, 50.0, 900.0, 700.0]}},
        {"box": {"id": "obj-2", "maxclass": "newobj", "text": "in 1", "numinlets": 0, "numoutlets": 1,
                 "outlettype": [""], "patching_rect": [20.0, 15.0, 30.0, 22.0]}},
        {"box": {"id": "obj-3", "maxclass": "newobj", "text": "out 1", "numinlets": 1, "numoutlets": 0,
                 "patching_rect": [20.0, 770.0, 35.0, 22.0]}},
        {"box": {"id": "obj-4", "maxclass": "newobj", "text": "out 2", "numinlets": 1, "numoutlets": 0,
                 "patching_rect": [880.0, 770.0, 35.0, 22.0]}},
    ]
    for s in range(NV + 1):
        boxes.append({"box": {"id": "obj-%d" % (5 + s), "maxclass": "newobj", "text": "out %d" % (3 + s),
                              "numinlets": 1, "numoutlets": 0,
                              "patching_rect": [140.0 + 110 * s, 770.0, 35.0, 22.0]}})
    lines = [
        {"patchline": {"source": ["obj-2", 0], "destination": ["obj-1", 0]}},
        {"patchline": {"source": ["obj-1", 0], "destination": ["obj-3", 0]}},
        {"patchline": {"source": ["obj-1", 1], "destination": ["obj-4", 0]}},
    ]
    for s in range(NV + 1):
        lines.append({"patchline": {"source": ["obj-1", 2 + s], "destination": ["obj-%d" % (5 + s), 0]}})
    return {
        "fileversion": 1, "appversion": APPVERSION, "classnamespace": "dsp.gen",
        "rect": [100.0, 100.0, 960.0, 840.0], "bglocked": 0, "openinpresentation": 0,
        "default_fontsize": 12.0, "default_fontface": 0, "default_fontname": "Arial",
        "gridonopen": 1, "gridsize": [15.0, 15.0], "gridsnaponopen": 1, "objectsnaponopen": 1,
        "statusbarvisible": 2, "toolbarvisible": 1, "boxanimatetime": 200, "enablehscroll": 1,
        "enablevscroll": 1, "devicewidth": 0.0, "description": "", "digest": "", "tags": "", "style": "",
        "subpatcher_template": "", "assistshowspatchername": 0, "boxes": boxes, "lines": lines,
    }


# --------------------------------------------------------------------------
# Look & feel
# --------------------------------------------------------------------------
def rgb(h, a=1.0):
    h = h.lstrip("#")
    return [round(int(h[i:i + 2], 16) / 255, 4) for i in (0, 2, 4)] + [a]


C_BG = rgb("#141619")        # device background
C_CARD = rgb("#1E2125")      # section cards
C_CARD_DICE = rgb("#1B2224")  # dice card, faint teal
C_MENU = rgb("#2A2E34")
C_LINE = rgb("#30353B")
C_TEXT = rgb("#E7E9EC")
C_MID = rgb("#A3AAB3")
C_LOW = rgb("#6D747D")
C_AMBER = rgb("#F2A03D")     # sodium street light in the fog
C_TEAL = rgb("#58C9C2")      # dice / generative
C_ARC_OFF = rgb("#3A4047")
F_HEAD = "Ableton Sans Bold"
F_TEXT = "Ableton Sans Medium"

def _sections():
    widths = [("PRESET", 104, C_AMBER), ("SEQ", 330, C_AMBER), ("CHORD", 218, C_AMBER), ("DICE", 136, C_TEAL), ("VOICE", 182, C_AMBER),
              ("FILTER", 182, C_AMBER), ("ENV", 182, C_AMBER), ("ECHO", 136, C_AMBER),
              ("SPACE", 136, C_AMBER), ("OUT", 90, C_AMBER)]
    out, x = [], PRESET_X
    for name, wdt, acc in widths:
        out.append((name, x, x + wdt, acc))
        x += wdt + 16
    return out


SECTIONS = _sections()
assert SECTIONS[1][1] == SEQ_X and SECTIONS[2][1] == CHORD_X and SECTIONS[3][1] == DICE_X
COLW = 46
ROW_Y = [18, 67, 116]
DEVICE_W = SECTIONS[-1][2] + 10
CHORD_DIAL_X = CHORD_X + 82  # first dial column of the CHORD section (menus sit on its left)
STEP_X = SEQ_X + 148         # first step column of the SEQ section
LOCK_GROUPS = [("Seq", ["SEQ"]), ("Chord", ["CHORD"]), ("Voice", ["VOICE"]), ("Filter", ["FILTER"]),
               ("Env", ["ENV"]), ("Echo", ["ECHO"]), ("Space", ["SPACE", "OUT"])]

# Randomize ranges: (lo, hi, curve). Parameters not listed here are never randomised
# (Key, Octave, Bend, MW>Cut, Volume and the dice controls themselves).
RAND = {
    "p_harm": (0, 7, "darkharm"), "p_chord": (0, 15, "darkchord"), "p_voicing": (0, 7, 1), "p_notes": (3, 6, 1),
    "p_strum": (-60, 60, 1), "p_glide": (0, 400, 2), "p_human": (0, 60, 1),
    "p_shape": (0, 100, 1), "p_pw": (10, 50, 1), "p_pwm": (0, 80, 1), "p_pwmrate": (0.1, 3, 2),
    "p_osc2": (0, 100, 1), "p_detune": (0, 25, 2), "p_sub": (0, 60, 1.5), "p_air": (0, 40, 1.5),
    "p_drift": (0, 80, 1), "p_driftrate": (0.1, 2, 2), "p_age": (0, 90, 1), "p_sag": (0, 80, 1),
    "p_cutoff": (120, 1600, 2), "p_reso": (0, 70, 1), "p_drive": (0, 80, 1), "p_slope": (0, 1, 1),
    "p_fenv": (-30, 90, 1), "p_ktrk": (0, 80, 1), "p_lforate": (0.03, 4, 3), "p_lfoamt": (0, 60, 1.5),
    "p_lfowave": (0, 3, 1),
    "p_fa": (0.5, 300, 3), "p_fd": (60, 3000, 2.5), "p_fs": (0, 60, 1.5), "p_fr": (50, 3000, 2.5),
    "p_aa": (0.5, 800, 3), "p_ad": (100, 4000, 2.5), "p_as": (0, 80, 1.5), "p_ar": (80, 4000, 2.5),
    "p_velsens": (0, 80, 1), "p_velfilt": (0, 90, 1),
    "p_etime": (0, 7, 1), "p_efb": (20, 92, 1), "p_emix": (10, 70, 1), "p_elocut": (30, 400, 2),
    "p_ehicut": (800, 3500, 2), "p_edrive": (0, 80, 1), "p_wow": (0, 70, 1), "p_flutter": (0, 50, 1),
    "p_espread": (0, 100, 1),
    "p_rdecay": (1000, 12000, 2), "p_rsize": (60, 140, 1), "p_rmix": (10, 60, 1), "p_tune": (0, 100, 1),
    "p_sdecay": (800, 10000, 2), "p_damp": (35, 85, 1), "p_rlocut": (40, 400, 2), "p_diff": (40, 100, 1),
    "p_rmod": (0, 80, 1), "p_chorus": (0, 70, 1), "p_crate": (0.1, 2, 2), "p_cdepth": (10, 90, 1),
    "p_width": (20, 100, 1),
    "p_sgate": (20, 90, 1), "p_swing": (0, 40, 1),
}
# sequencer randomization: off-beats are more likely; at most 4 steps stay on (enforced in the patch)
SON_DENS = [1500 if c % 2 == 0 else 5500 for c in range(NCELL)]
SEMI_EXPR = ("($f1 >= 5000.) * (0. - 2.) + ($f1 >= 6000.) * 5. + ($f1 >= 7000.) * 2. + ($f1 >= 8000.) * 2. "
             "+ ($f1 >= 9000.) * (0. - 12.)")  # root 50%, -2, +3, +5, +7, -5
for _c in range(NCELL):
    RAND["p_son%d" % (_c + 1)] = (0, 1, "gate")
    RAND["p_snote%d" % (_c + 1)] = (-24, 24, "semis")
    RAND["p_sacc%d" % (_c + 1)] = (0, 1, "acc")

# Randomize first picks a character, then draws every listed parameter inside that character's range.
# Parameters not listed keep the general RAND range. "on" = probability that a section switch is on.
# The characters on offer follow the preset folder you are in (see FOLDER_ARCH).
ARCHETYPES = [
    # ---- dub techno (0-5)
    ("DUB STAB", dict(p_aa=(0.5, 8), p_ad=(150, 600), p_as=(0, 8), p_ar=(120, 500), p_fa=(0.5, 5), p_fd=(80, 350),
                      p_fs=(0, 10), p_fr=(100, 400), p_cutoff=(250, 900), p_reso=(15, 60), p_fenv=(35, 80),
                      p_drive=(10, 55), p_efb=(60, 92), p_emix=(35, 65), p_ehicut=(1200, 2800), p_rmix=(15, 35),
                      p_tune=(25, 70), p_glide=(0, 20), p_strum=(-12, 12), p_damp=(45, 75)),
     dict(p_echoon=0.98, p_spaceon=0.85, p_choron=0.35, p_analogon=0.85)),
    ("CONCRETE", dict(p_aa=(0.5, 5), p_ad=(200, 500), p_as=(0, 5), p_ar=(150, 400), p_fd=(120, 300),
                      p_cutoff=(300, 600), p_reso=(30, 60), p_fenv=(45, 75), p_drive=(30, 70), p_efb=(70, 95),
                      p_emix=(45, 70), p_ehicut=(1100, 2000), p_elocut=(100, 250), p_wow=(30, 60),
                      p_edrive=(35, 70), p_rmix=(15, 30), p_damp=(55, 80)),
     dict(p_echoon=1.0, p_spaceon=0.8, p_choron=0.2, p_analogon=0.9)),
    ("DEEP CHORD", dict(p_aa=(150, 1500), p_ad=(1500, 5000), p_as=(45, 85), p_ar=(1500, 5000),
                        p_fa=(300, 2500), p_fd=(1500, 5000), p_fs=(15, 55), p_fr=(1500, 5000), p_cutoff=(300, 900),
                        p_reso=(5, 35), p_fenv=(10, 35), p_osc2=(60, 100), p_detune=(6, 20), p_emix=(15, 40),
                        p_efb=(40, 75), p_rmix=(30, 55), p_rdecay=(6000, 14000), p_tune=(40, 85),
                        p_chorus=(35, 75), p_glide=(60, 350), p_strum=(10, 70), p_lfoamt=(10, 35),
                        p_lforate=(0.03, 0.3), p_damp=(50, 80)),
     dict(p_echoon=0.6, p_spaceon=1.0, p_choron=0.8, p_analogon=0.95)),
    ("SUBMERGED", dict(p_aa=(0.5, 30), p_ad=(300, 1200), p_as=(0, 40), p_ar=(200, 1000), p_fd=(100, 600),
                       p_cutoff=(110, 400), p_reso=(25, 65), p_drive=(45, 85), p_sub=(40, 90), p_fenv=(15, 55),
                       p_ehicut=(800, 1600), p_elocut=(30, 90), p_efb=(50, 85), p_emix=(25, 55),
                       p_rlocut=(180, 400), p_rmix=(10, 30), p_tune=(5, 45), p_damp=(60, 85)),
     dict(p_echoon=0.9, p_spaceon=0.7, p_choron=0.15, p_analogon=0.9)),
    ("TAPE GHOST", dict(p_age=(60, 90), p_drift=(50, 85), p_sag=(45, 80), p_air=(15, 40), p_wow=(45, 75),
                        p_flutter=(25, 55), p_edrive=(40, 80), p_ehicut=(800, 1800), p_cutoff=(250, 900),
                        p_detune=(8, 22), p_driftrate=(0.2, 1.2), p_lfoamt=(10, 35), p_efb=(60, 90),
                        p_emix=(35, 65), p_damp=(55, 85)),
     dict(p_echoon=0.95, p_spaceon=0.85, p_choron=0.5, p_analogon=1.0)),
    ("THROW", dict(p_aa=(0.5, 4), p_ad=(100, 300), p_as=(0, 5), p_ar=(80, 250), p_fd=(60, 200), p_cutoff=(350, 1000),
                   p_fenv=(40, 85), p_efb=(88, 104), p_emix=(55, 80), p_ehicut=(1000, 2200), p_elocut=(120, 300),
                   p_espread=(70, 100), p_wow=(20, 55), p_rmix=(15, 35), p_damp=(50, 80)),
     dict(p_echoon=1.0, p_spaceon=0.85, p_choron=0.3, p_analogon=0.85)),
    # ---- ambient / soft (6-10)
    ("SOFT PAD", dict(p_aa=(600, 3000), p_ad=(3000, 8000), p_as=(60, 90), p_ar=(3000, 8000), p_fa=(800, 3000),
                      p_fd=(3000, 8000), p_fs=(30, 70), p_fr=(3000, 8000), p_cutoff=(400, 1500), p_reso=(0, 25),
                      p_fenv=(0, 25), p_osc2=(60, 100), p_detune=(6, 18), p_chorus=(40, 85), p_emix=(5, 30),
                      p_rmix=(40, 65), p_rdecay=(8000, 18000), p_tune=(40, 90), p_glide=(100, 500),
                      p_strum=(20, 90), p_lfoamt=(5, 30), p_lforate=(0.02, 0.2), p_damp=(45, 75)),
     dict(p_echoon=0.5, p_spaceon=1.0, p_choron=0.9, p_analogon=0.95)),
    ("SWELL", dict(p_aa=(2000, 5000), p_ad=(5000, 10000), p_as=(70, 100), p_ar=(4000, 9000), p_fa=(2000, 5000),
                   p_fs=(40, 80), p_cutoff=(250, 900), p_fenv=(10, 40), p_lfoamt=(10, 35), p_rmix=(40, 60),
                   p_tune=(50, 90), p_emix=(10, 30), p_chorus=(30, 70), p_damp=(50, 80)),
     dict(p_echoon=0.5, p_spaceon=1.0, p_choron=0.8, p_analogon=0.95)),
    ("HAZE", dict(p_air=(20, 50), p_age=(40, 80), p_drift=(40, 80), p_wow=(30, 70), p_cutoff=(300, 1000),
                  p_aa=(500, 3000), p_as=(50, 85), p_ar=(3000, 8000), p_ad=(3000, 8000), p_rmix=(45, 70),
                  p_tune=(60, 100), p_sdecay=(6000, 14000), p_damp=(55, 85), p_emix=(15, 40)),
     dict(p_echoon=0.7, p_spaceon=1.0, p_choron=0.6, p_analogon=1.0)),
    ("FOG STRINGS", dict(p_aa=(0.5, 20), p_ad=(500, 2000), p_as=(0, 25), p_ar=(800, 3000), p_fd=(200, 900),
                         p_cutoff=(400, 1100), p_reso=(30, 60), p_fenv=(15, 50), p_air=(10, 35), p_tune=(80, 100),
                         p_sdecay=(5000, 12000), p_rmix=(35, 60), p_rdecay=(5000, 12000), p_emix=(20, 45),
                         p_ehicut=(1500, 3000), p_damp=(40, 70)),
     dict(p_echoon=0.75, p_spaceon=1.0, p_choron=0.4, p_analogon=0.85)),
    ("NIGHT DRONE", dict(p_aa=(600, 3000), p_ad=(3000, 8000), p_as=(75, 100), p_ar=(2500, 7000), p_fa=(500, 3000),
                         p_fs=(40, 80), p_cutoff=(200, 700), p_reso=(10, 45), p_fenv=(0, 25), p_shape=(40, 100),
                         p_pwm=(30, 80), p_pwmrate=(0.1, 0.6), p_chorus=(40, 85), p_emix=(10, 30), p_rmix=(35, 60),
                         p_rdecay=(8000, 16000), p_tune=(60, 100), p_sdecay=(5000, 10000), p_lfoamt=(15, 45),
                         p_lforate=(0.02, 0.2), p_damp=(55, 85)),
     dict(p_echoon=0.4, p_spaceon=1.0, p_choron=0.85, p_analogon=0.95)),
    # ---- experimental (11-13)
    ("BROKEN", dict(p_age=(85, 100), p_drift=(80, 100), p_driftrate=(1, 5), p_sag=(70, 100), p_air=(20, 50),
                    p_wow=(60, 100), p_flutter=(50, 100), p_edrive=(60, 100), p_efb=(80, 104), p_cutoff=(300, 1500),
                    p_reso=(30, 75), p_human=(50, 100)),
     dict(p_echoon=0.95, p_spaceon=0.8, p_choron=0.5, p_analogon=1.0)),
    ("METAL", dict(p_shape=(60, 100), p_pw=(5, 20), p_reso=(55, 90), p_cutoff=(1000, 4000), p_tune=(85, 100),
                   p_sdecay=(8000, 15000), p_damp=(5, 35), p_aa=(0.5, 5), p_ad=(100, 600), p_as=(0, 10),
                   p_ar=(1000, 4000)),
     dict(p_echoon=0.7, p_spaceon=1.0, p_choron=0.3, p_analogon=0.7)),
    ("RUNAWAY", dict(p_efb=(95, 108), p_emix=(50, 75), p_edrive=(60, 95), p_ehicut=(1200, 3000), p_elocut=(100, 300),
                     p_wow=(40, 80), p_espread=(80, 100), p_aa=(0.5, 5), p_ad=(100, 300), p_ar=(80, 250)),
     dict(p_echoon=1.0, p_spaceon=0.7, p_choron=0.3, p_analogon=0.9)),
]
for _sw in ("p_echoon", "p_spaceon", "p_choron", "p_analogon"):
    RAND[_sw] = (0, 1, "coin")


# ---------------------------------------------------------------- factory presets, by folder (genre / style)
# Missing parameters use the defaults. Key and SEQ on/mode are never changed by a preset (they belong to your
# track). Volume is level-matched per preset (src/preset_levels.json, written by test/presets_tour.py).
PRESET_SKIP = ("p_key", "p_seqon", "p_seqmode", "p_reverbon")


def _seq(on=(2, 4, 6, 8), notes=None, acc=(), rate=1, length=8, gate=50, swing=0, chance=100):
    assert len(on) <= MAXON
    d = {"p_seqrate": rate, "p_seqlen": length, "p_sgate": gate, "p_swing": swing, "p_schance": chance}
    notes = notes or {}
    for c in range(1, NCELL + 1):
        d["p_son%d" % c] = int(c in on)
        d["p_snote%d" % c] = notes.get(c, 0)
        d["p_sacc%d" % c] = int(c in acc)
    return d


def _p(seq=None, **kw):
    d = dict(kw)
    d.update(seq or _seq())
    return d


FOLDERS = [
    ("DUB TECHNO", [
        ("Fog Stab", _p(p_damp=55, p_ehicut=2200, seq=_seq((2, 4, 6, 8), acc=(4,)))),
        ("Concrete Dub", _p(p_chord=3, p_cutoff=380, p_reso=42, p_fenv=60, p_fd=220, p_ad=380, p_efb=80, p_emix=55,
                            p_ehicut=1700, p_elocut=140, p_wow=45, p_edrive=50, p_rmix=25, p_tune=40, p_damp=65,
                            seq=_seq((2, 4, 7, 8), acc=(8,)))),
        ("Echo Throw", _p(p_ad=180, p_ar=150, p_fd=120, p_cutoff=650, p_fenv=70, p_efb=97, p_emix=72, p_ehicut=1900,
                          p_elocut=180, p_espread=100, p_etime=4, p_rmix=22, p_damp=65, seq=_seq((4,), acc=(4,)))),
        ("Submerged", _p(p_chord=3, p_oct=-1, p_cutoff=220, p_reso=55, p_drive=70, p_sub=70, p_fenv=40, p_fd=300,
                         p_ad=500, p_ehicut=1200, p_elocut=60, p_efb=65, p_emix=40, p_rlocut=250, p_rmix=20,
                         p_tune=25, p_damp=75, p_choron=0, seq=_seq((2, 4, 6, 8), acc=(2, 6)))),
        ("Tape Ghost", _p(p_chord=0, p_age=85, p_drift=70, p_driftrate=0.8, p_sag=70, p_air=30, p_wow=65,
                          p_flutter=45, p_edrive=65, p_ehicut=1500, p_cutoff=480, p_detune=14, p_emix=50, p_efb=72,
                          p_tune=55, p_damp=70, seq=_seq((2, 3, 6, 8), notes={6: -2}))),
        ("Strings In Fog", _p(p_chord=4, p_tune=100, p_sdecay=9000, p_damp=50, p_rmix=50, p_cutoff=750, p_reso=50,
                              p_fenv=35, p_ad=900, p_ar=1500, p_as=10, p_emix=30, p_efb=60, p_ehicut=2500, p_air=20,
                              seq=_seq((2, 5, 6, 8), notes={6: 3}))),
        ("Basement Chord", _p(p_chord=1, p_cutoff=450, p_reso=35, p_fenv=50, p_fd=260, p_ad=500, p_efb=75, p_emix=50,
                              p_etime=3, p_ehicut=1800, p_rmix=30, p_tune=50, p_chorus=20,
                              seq=_seq((2, 4, 6, 8), notes={6: -2, 8: 3}, acc=(2,)))),
        ("Rain On Steel", _p(p_chord=4, p_cutoff=700, p_reso=45, p_fenv=40, p_fd=180, p_ad=300, p_shape=60, p_pw=30,
                             p_efb=85, p_emix=60, p_etime=1, p_espread=100, p_ehicut=2400, p_wow=25, p_rmix=25,
                             p_tune=60, seq=_seq((2, 4, 6, 8), swing=20, acc=(6,)))),
    ]),
    ("DEEP / MINIMAL", [
        ("Deep Minimal Stab", _p(p_chord=0, p_cutoff=800, p_reso=25, p_fenv=35, p_fd=150, p_ad=250, p_ar=200,
                                 p_efb=45, p_emix=30, p_etime=2, p_rmix=18, p_tune=20,
                                 seq=_seq((3, 6, 8), acc=(3,), swing=30))),
        ("Velvet Chord", _p(p_chord=1, p_cutoff=1100, p_reso=15, p_fenv=20, p_ad=700, p_as=30, p_ar=500, p_chorus=50,
                            p_osc2=80, p_detune=9, p_efb=40, p_emix=25, p_rmix=30,
                            seq=_seq((1, 4, 6), swing=15, acc=(1,)))),
        ("Late Night Keys", _p(p_chord=2, p_shape=40, p_cutoff=1400, p_fenv=30, p_fd=400, p_ad=900, p_as=20,
                               p_ar=600, p_velsens=60, p_chorus=35, p_efb=35, p_emix=20, p_rmix=25, p_tune=30,
                               p_strum=15, seq=_seq((2, 5, 8), notes={5: -2, 8: 3}))),
        ("Pulse Chord", _p(p_chord=3, p_cutoff=600, p_fenv=55, p_fd=120, p_ad=200, p_efb=55, p_etime=2, p_emix=35,
                           p_rmix=20, seq=_seq((3, 4, 7, 8), rate=0, swing=25, acc=(3, 7)))),
        ("Smoke Organ", _p(p_chord=0, p_shape=80, p_pwm=50, p_cutoff=900, p_as=80, p_ad=1000, p_aa=10, p_ar=300,
                           p_fenv=10, p_chorus=70, p_crate=0.8, p_efb=30, p_emix=20, p_rmix=25,
                           seq=_seq((1, 4, 7), gate=70))),
        ("Shuffle Stab", _p(p_chord=8, p_cutoff=750, p_reso=30, p_fenv=45, p_fd=140, p_ad=260, p_efb=65, p_emix=45,
                            p_etime=3, seq=_seq((2, 4, 6, 8), rate=0, swing=45, acc=(4, 8)))),
    ]),
    ("AMBIENT", [
        ("Soft Horizon", _p(p_chord=12, p_voicing=7, p_aa=1500, p_ad=6000, p_as=80, p_ar=6000, p_fa=2000, p_fd=6000,
                            p_fs=50, p_fr=5000, p_cutoff=900, p_reso=10, p_fenv=15, p_osc2=90, p_detune=10,
                            p_chorus=70, p_crate=0.3, p_cdepth=70, p_glide=300, p_strum=60, p_emix=20, p_efb=55,
                            p_etime=6, p_rmix=55, p_rdecay=14000, p_tune=60, p_sdecay=9000, p_damp=55, p_lfoamt=20,
                            p_lforate=0.05, p_lfowave=3,
                            seq=_seq((1, 2, 3, 4), notes={2: -3, 3: -7, 4: -5}, rate=4, length=4, gate=95))),
        ("Breathing Pad", _p(p_chord=1, p_voicing=6, p_aa=2500, p_ad=5000, p_as=70, p_ar=7000, p_fa=3000,
                             p_cutoff=600, p_fenv=20, p_lfoamt=35, p_lforate=0.08, p_chorus=50, p_rmix=60,
                             p_rdecay=16000, p_tune=70, p_sdecay=10000, p_damp=60, p_emix=15,
                             seq=_seq((1, 2), notes={2: -5}, rate=5, length=2, gate=98))),
        ("Glass Haze", _p(p_chord=4, p_shape=60, p_pw=20, p_cutoff=1300, p_reso=30, p_aa=400, p_ad=4000, p_as=50,
                          p_ar=5000, p_tune=95, p_sdecay=12000, p_rmix=60, p_damp=45, p_air=15, p_chorus=40,
                          p_emix=25, p_efb=60, p_etime=7, seq=_seq((1, 3), notes={3: 3}, rate=4, length=4, gate=90))),
        ("Slow Tide", _p(p_chord=7, p_voicing=6, p_aa=3000, p_ad=8000, p_as=85, p_ar=8000, p_cutoff=500, p_reso=20,
                         p_lfoamt=40, p_lforate=0.03, p_chorus=60, p_rmix=55, p_rdecay=15000, p_tune=50, p_emix=20,
                         p_efb=70, p_etime=7, p_wow=30,
                         seq=_seq((1, 2, 3, 4), notes={2: -2, 3: -5, 4: -7}, rate=5, length=4, gate=98))),
        ("Warm Blanket", _p(p_chord=11, p_voicing=6, p_osc2=90, p_detune=14, p_cutoff=700, p_reso=10, p_aa=800,
                            p_ad=4000, p_as=75, p_ar=4000, p_sub=30, p_chorus=75, p_cdepth=80, p_drift=50, p_age=50,
                            p_rmix=40, p_rdecay=9000, p_tune=40, p_emix=15,
                            seq=_seq((1, 2), notes={2: 5}, rate=4, length=2, gate=95))),
        ("Cloud Choir", _p(p_chord=5, p_voicing=5, p_shape=30, p_air=30, p_cutoff=1100, p_reso=25, p_aa=1200,
                           p_ad=5000, p_as=70, p_ar=6000, p_chorus=80, p_crate=0.2, p_rmix=65, p_rdecay=18000,
                           p_tune=85, p_sdecay=12000, p_damp=50, p_emix=10,
                           seq=_seq((1, 2), notes={2: -2}, rate=5, length=2, gate=98))),
        ("Distant Lights", _p(p_chord=12, p_voicing=5, p_shape=50, p_cutoff=1600, p_aa=5, p_ad=1800, p_as=10,
                              p_ar=3000, p_fenv=25, p_tune=75, p_emix=45, p_efb=70, p_etime=3, p_espread=100,
                              p_ehicut=3500, p_rmix=55, p_rdecay=12000,
                              seq=_seq((1, 4, 7), notes={4: 7, 7: 5}, gate=30))),
    ]),
    ("INTRO / SOFT", [
        ("First Light", _p(p_chord=12, p_voicing=7, p_aa=2000, p_ad=6000, p_as=60, p_ar=6000, p_cutoff=400, p_fenv=10,
                           p_lfoamt=15, p_rmix=50, p_rdecay=12000, p_tune=60, p_chorus=50, p_emix=15,
                           seq=_seq((1, 2), notes={2: -3}, rate=5, length=2, gate=98))),
        ("Soft Pulse Intro", _p(p_chord=1, p_cutoff=350, p_reso=20, p_fenv=25, p_aa=30, p_ad=700, p_as=30, p_ar=900,
                                p_emix=40, p_efb=60, p_etime=3, p_rmix=40, p_tune=45, p_chorus=30,
                                seq=_seq((2, 4, 6, 8), gate=40))),
        ("Morning Fog", _p(p_chord=7, p_voicing=5, p_aa=1500, p_ad=5000, p_as=70, p_ar=6000, p_air=25, p_cutoff=500,
                           p_rmix=60, p_tune=80, p_sdecay=9000, p_damp=65, p_emix=20, p_wow=30, p_chorus=40,
                           seq=_seq((1, 3), notes={3: -5}, rate=4, length=4, gate=95))),
        ("Tape Lullaby", _p(p_chord=11, p_shape=20, p_age=70, p_drift=60, p_wow=55, p_flutter=35, p_ehicut=1500,
                            p_edrive=40, p_cutoff=800, p_aa=200, p_ad=2500, p_as=50, p_ar=3000, p_emix=30, p_efb=55,
                            p_rmix=35, p_chorus=40, seq=_seq((1, 4, 6), notes={4: 5, 6: -2}, rate=2, gate=80))),
        ("Gentle Swell", _p(p_chord=2, p_voicing=6, p_aa=4000, p_ad=8000, p_as=90, p_ar=5000, p_fa=4000, p_fd=8000,
                            p_fs=70, p_fenv=30, p_cutoff=300, p_rmix=45, p_rdecay=10000, p_tune=55, p_chorus=45,
                            p_emix=10, seq=_seq((1, 2), notes={2: -4}, rate=5, length=2, gate=98))),
        ("Low Hum Intro", _p(p_chord=15, p_oct=-1, p_sub=50, p_cutoff=250, p_reso=30, p_aa=1000, p_ad=6000, p_as=85,
                             p_ar=4000, p_drive=30, p_rmix=35, p_rlocut=200, p_tune=40, p_emix=10, p_chorus=20,
                             seq=_seq((1,), rate=5, length=1, gate=100))),
    ]),
    ("DRONE", [
        ("Night Drone", _p(p_chord=5, p_aa=1200, p_ad=5000, p_as=75, p_ar=4000, p_fs=60, p_cutoff=420, p_reso=30,
                           p_shape=70, p_pwm=60, p_pwmrate=0.25, p_chorus=70, p_crate=0.3, p_emix=20, p_rmix=40,
                           p_rdecay=12000, p_tune=85, p_sdecay=9000, p_damp=70, p_lfoamt=30, p_lforate=0.05,
                           p_lfowave=3, seq=_seq((1, 2), notes={2: -5}, rate=5, length=2, gate=98))),
        ("Deep Ocean", _p(p_chord=2, p_oct=-1, p_cutoff=260, p_reso=40, p_lfoamt=45, p_lforate=0.04, p_lfowave=3,
                          p_aa=3000, p_ad=9000, p_as=95, p_ar=8000, p_sub=40, p_rmix=60, p_rdecay=18000, p_tune=70,
                          p_sdecay=12000, p_damp=75, p_emix=20, p_efb=75, p_etime=7, p_wow=40,
                          seq=_seq((1,), rate=5, length=1, gate=100))),
        ("Cathedral Low", _p(p_chord=5, p_voicing=5, p_shape=100, p_pw=45, p_pwm=40, p_cutoff=600, p_aa=2500,
                             p_ad=8000, p_as=90, p_ar=9000, p_rmix=70, p_rdecay=20000, p_rsize=150, p_tune=90,
                             p_sdecay=15000, p_damp=55, p_chorus=30,
                             seq=_seq((1, 2), notes={2: -5}, rate=5, length=2, gate=98))),
        ("Static Field", _p(p_chord=6, p_air=60, p_age=90, p_drift=90, p_driftrate=3, p_cutoff=900, p_reso=50,
                            p_lfowave=2, p_lforate=4, p_lfoamt=30, p_aa=2000, p_as=80, p_ar=6000, p_ad=6000, p_rmix=55,
                            p_tune=60, p_emix=30, p_efb=85, p_wow=70, p_flutter=60,
                            seq=_seq((1,), rate=5, length=1, gate=100))),
        ("Endless Fifths", _p(p_chord=15, p_oct=-1, p_osc2=100, p_detune=20, p_cutoff=500, p_reso=35, p_aa=4000,
                              p_ad=9000, p_as=100, p_ar=9000, p_chorus=60, p_rmix=50, p_rdecay=16000, p_tune=80,
                              p_emix=25, p_efb=80, p_etime=7,
                              seq=_seq((1, 2), notes={2: -2}, rate=5, length=2, gate=98))),
    ]),
    ("EXPERIMENTAL", [
        ("Broken Machine", _p(p_age=100, p_drift=100, p_driftrate=5, p_sag=100, p_air=40, p_cutoff=700, p_reso=60,
                              p_drive=80, p_wow=90, p_flutter=80, p_edrive=90, p_efb=95, p_emix=55, p_ehicut=1600,
                              p_human=80, p_strum=30,
                              seq=_seq((1, 3, 4, 7), notes={3: 1, 4: -1, 7: 6}, acc=(4,), rate=0, chance=75))),
        ("Metal Strings", _p(p_chord=6, p_shape=100, p_pw=8, p_cutoff=2500, p_reso=75, p_fenv=60, p_aa=0.5,
                             p_ad=150, p_as=0, p_ar=2000, p_tune=100, p_sdecay=15000, p_damp=15, p_rmix=55, p_emix=30,
                             p_etime=1, seq=_seq((1, 4, 6, 7), notes={4: 6, 6: 1, 7: -6}, acc=(1,)))),
        ("Runaway Echo", _p(p_ad=150, p_ar=150, p_fd=100, p_cutoff=700, p_efb=108, p_emix=65, p_edrive=90,
                            p_ehicut=2000, p_elocut=200, p_wow=60, p_espread=100, p_etime=4, p_rmix=20,
                            seq=_seq((1,), rate=2, acc=(1,)))),
        ("Random Colors", _p(p_cchance=100, p_cdice=3, p_voicing=6, p_cutoff=800, p_glide=120, p_efb=70, p_emix=45,
                             p_rmix=35, p_tune=60, seq=_seq((2, 3, 6, 8), swing=20, chance=85))),
        ("Self Oscillate", _p(p_reso=100, p_cutoff=900, p_fenv=70, p_fd=400, p_drive=60, p_shape=0, p_osc2=0, p_air=0,
                              p_aa=1, p_ad=600, p_as=20, p_ar=500, p_ktrk=100, p_emix=40, p_efb=70, p_etime=3,
                              p_rmix=30, seq=_seq((2, 4, 6, 8), notes={4: 3, 6: 7, 8: 10}))),
        ("Glitch Strum", _p(p_strum=-250, p_human=100, p_chord=2, p_notes=6, p_aa=0.5, p_ad=300, p_ar=300,
                            p_cutoff=1200, p_fenv=50, p_efb=60, p_emix=40, p_etime=0, p_rmix=25,
                            seq=_seq((1, 2, 5, 6), rate=0, chance=70))),
        ("Phase Haunt", _p(p_chord=6, p_osc2=100, p_detune=50, p_chorus=100, p_crate=6, p_cdepth=100, p_lfowave=2,
                           p_lforate=6, p_lfoamt=50, p_cutoff=600, p_aa=500, p_ad=3000, p_as=60, p_ar=4000, p_rmix=50,
                           p_tune=70, p_rmod=100, seq=_seq((1, 3), notes={3: -1}, rate=3, length=4))),
    ]),
]
# hand-made presets above; the rest of every folder comes from test/gen_presets.py (rendered and filtered)
HAND_FOLDERS = [(f, list(lst)) for f, lst in FOLDERS]
_gen_path = os.path.join(HERE, "presets_generated.json")
if os.path.exists(_gen_path):
    _gen = json.load(open(_gen_path))
    FOLDERS = [(f, lst + [(n, ov) for n, ov in _gen.get(f, [])]) for f, lst in FOLDERS]


def _lift(nm, v):
    if nm == "p_cutoff":
        return min(16000, round(v * 1.5, 1))
    if nm == "p_ehicut":
        return min(16000, round(v * 1.4))
    if nm == "p_damp":
        return max(0, v - 12)
    if nm == "p_sag":
        return round(v * 0.5, 1)
    return v


FOLDERS = [(f, [(n, {k: _lift(k, v) for k, v in ov.items()}) for n, ov in lst]) for f, lst in FOLDERS]
ARCHETYPES = [(n, {k: (_lift(k, lo), _lift(k, hi)) for k, (lo, hi) in r.items()}, o) for n, r, o in ARCHETYPES]
for _k in ("p_cutoff", "p_ehicut", "p_damp", "p_sag"):
    _lo, _hi, _c = RAND[_k]
    RAND[_k] = (_lift(_k, _lo), _lift(_k, _hi), _c)
FACTORY = [(n, ov) for _, lst in FOLDERS for n, ov in lst]
NUSER = 8
# which Randomize characters each folder offers: (first, count)
FOLDER_ARCH = {"DUB TECHNO": (0, 6), "DEEP / MINIMAL": (0, 6), "AMBIENT": (6, 4), "INTRO / SOFT": (6, 3),
               "DRONE": (8, 3), "EXPERIMENTAL": (11, 3), "USER": (0, len(ARCHETYPES))}
_lv_path = os.path.join(HERE, "preset_levels.json")
PRESET_LEVELS = json.load(open(_lv_path)) if os.path.exists(_lv_path) else {}
_pd = {q["name"]: q for q in P}
for _n, _ov in FACTORY:
    _ov.setdefault("p_vol", PRESET_LEVELS.get(_n, -3.0))
    for _k, _v in _ov.items():
        assert _k in _pd and _k not in PRESET_SKIP, (_n, _k)
        assert _pd[_k]["lo"] <= _v <= _pd[_k]["hi"], (_n, _k, _v)
assert len({n for n, _ in FACTORY}) == len(FACTORY)

# Shown in Live's Info View when the mouse is over a control
ANNOT = {
    "p_harm": "Fixed: ogni tasto suona il tipo di accordo scelto in Chord. Scala: ogni tasto suona l'accordo diatonico di quel grado nella tonalità Key.",
    "p_chord": "Tipo di accordo in modalità Fixed. Limitato dal numero di note in Notes.",
    "p_key": "Tonica della scala (solo quando Harmony è una scala).",
    "p_voicing": "Root/Inv: rivolti fissi. Open: drop 2. Spread: voci aperte. Smooth: voice leading automatico verso l'accordo precedente. Smooth Op: voice leading + drop 2.",
    "p_notes": "Quante note ha l'accordo (2-6): non serve a scrivere note, quelle arrivano dal SEQ o dal MIDI di Live.",
    "p_oct": "Sposta l'accordo di ottave.",
    "p_strum": "Arpeggio d'attacco: positivo dal basso verso l'alto, negativo dall'alto verso il basso.",
    "p_glide": "Portamento: ogni voce scivola verso la sua nota nel nuovo accordo.",
    "p_human": "Micro-ritardi e velocity diverse per ogni voce, nuove a ogni accordo.",
    "p_bendr": "Estensione del pitch bend in semitoni.",
    "p_shape": "Forma d'onda: da dente di sega (0) a pulse (100).",
    "p_pw": "Larghezza dell'impulso.",
    "p_pwm": "Quantità di modulazione della larghezza d'impulso (LFO dedicato, sfasato per voce).",
    "p_pwmrate": "Velocità dell'LFO della PWM.",
    "p_osc2": "Livello del secondo oscillatore a dente di sega.",
    "p_detune": "Scordatura del secondo oscillatore in cent.",
    "p_sub": "Onda quadra un'ottava sotto la nota più bassa dell'accordo.",
    "p_air": "Rumore che passa nel filtro di ogni voce: respiro, polvere.",
    "p_drift": "Deriva casuale e lenta dell'intonazione e del filtro, come un circuito analogico.",
    "p_driftrate": "Velocità della deriva.",
    "p_age": "Tolleranze dei componenti: ogni voce ha accordatura, filtro, inviluppi e livello leggermente diversi. 0 = digitale perfetto.",
    "p_sag": "Cedimento dell'alimentazione: con accordi pieni tutte le voci calano un po' insieme di intonazione, filtro e livello.",
    "p_cutoff": "Frequenza di taglio del filtro ladder (uno per voce).",
    "p_reso": "Risonanza. Al massimo il filtro auto-oscilla.",
    "p_drive": "Saturazione all'ingresso del filtro.",
    "p_slope": "Pendenza del filtro: 24 dB (scuro, morbido) o 12 dB (più aperto).",
    "p_fenv": "Quanto l'inviluppo del filtro muove il cutoff (anche negativo).",
    "p_ktrk": "Il cutoff segue l'altezza di ogni voce.",
    "p_mwcut": "Quanto la mod wheel apre il filtro.",
    "p_lforate": "Velocità dell'LFO sul cutoff.",
    "p_lfoamt": "Quantità dell'LFO sul cutoff.",
    "p_lfowave": "Forma dell'LFO: Sine, Triangle, S&H (scalini casuali), Drift (casuale morbido).",
    "p_fa": "Attacco dell'inviluppo del filtro.",
    "p_fd": "Decadimento dell'inviluppo del filtro.",
    "p_fs": "Sustain dell'inviluppo del filtro.",
    "p_fr": "Rilascio dell'inviluppo del filtro.",
    "p_aa": "Attacco del volume.",
    "p_ad": "Decadimento del volume.",
    "p_as": "Sustain del volume. A 0 ogni accordo è uno stab, anche se tieni premuto.",
    "p_ar": "Rilascio del volume.",
    "p_velsens": "Quanto la velocity cambia il volume.",
    "p_velfilt": "Quanto la velocity apre il filtro.",
    "p_etime": "Tempo dell'eco, a tempo con Live.",
    "p_efb": "Ripetizioni dell'eco. Sopra 100 l'eco cresce da solo (fuga dub), la saturazione lo tiene a bada.",
    "p_emix": "Livello dell'eco.",
    "p_elocut": "Passa-alto nel loop dell'eco: ogni ripetizione più sottile.",
    "p_ehicut": "Passa-basso nel loop dell'eco: ogni ripetizione più scura.",
    "p_edrive": "Saturazione del nastro dentro il loop.",
    "p_wow": "Oscillazione lenta del nastro.",
    "p_flutter": "Oscillazione veloce del nastro.",
    "p_espread": "Da eco mono (0) a ping-pong (100).",
    "p_rdecay": "Durata dello spazio.",
    "p_rsize": "Dimensione dello spazio.",
    "p_rmix": "Livello dello spazio.",
    "p_tune": "Il cuore di NEBBIA: da riverbero normale (0) a corpo risonante con corde simpatiche accordate sull'accordo che suoni (100).",
    "p_sdecay": "Quanto suonano a lungo le corde simpatiche.",
    "p_damp": "Smorzamento delle alte frequenze di spazio e corde.",
    "p_rlocut": "Toglie le basse prima dello spazio: coda pulita, senza fango.",
    "p_diff": "Densità delle prime riflessioni.",
    "p_rmod": "Movimento delle linee dello spazio: meno metallico, più vivo.",
    "p_chorus": "Chorus ensemble stereo: tre linee BBD per lato, sfasate, come nelle string machine.",
    "p_crate": "Velocità del chorus.",
    "p_cdepth": "Profondità del chorus.",
    "p_width": "Apertura stereo delle voci.",
    "p_vol": "Volume d'uscita.",
    "p_cchance": "Probabilità che ogni nota tiri il dado sull'accordo (vedi Chord Dice). 0 = mai.",
    "p_cdice": "Cosa cambia il dado. Color: un altro accordo della stessa famiglia. Voicing: rivolto e ottava. Both: entrambi. Wild: qualsiasi accordo.",
    "p_seqon": "Accende il sequencer interno. Spento: NEBBIA suona solo il MIDI di Live (piano roll, tastiera).",
    "p_seqmode": "Play: il sequencer suona quando premi Play in Live. Trans: suona solo mentre tieni un tasto, trasposto da quel tasto (C3 = come scritto).",
    "p_chordon": "Spento: niente accordi, ogni nota suona da sola (bassi, lead). Restano Octave, Glide, Humanize e Bend.",
    "p_diceon": "Spento: il dado sugli accordi è fermo. Randomize, Reset e i lucchetti funzionano comunque.",
    "p_analogon": "Comportamento analogico (Drift, Age, Sag). Spento: suono digitale pulito e identico su ogni voce.",
    "p_filton": "Spento: il filtro è escluso e passa l'oscillatore pieno.",
    "p_echoon": "Accende o spegne l'eco.",
    "p_spaceon": "Accende o spegne tutto lo spazio (riverbero e corde simpatiche).",
    "p_reverbon": "Accende o spegne solo il riverbero interno: le corde simpatiche (Tune) continuano a suonare, "
                  "così puoi usare il tuo riverbero dopo NEBBIA. Preset e Reset non lo cambiano.",
    "p_choron": "Accende o spegne il chorus.",
    "p_seqrate": "Durata di ogni step. 1/8 = gli 8 step fanno una battuta. 1 Bar = uno step per battuta.",
    "p_seqlen": "Quanti step usa la sequenza (1-8).",
    "p_sgate": "Durata della nota di ogni step, in percentuale dello step.",
    "p_swing": "Ritarda gli step pari (2, 4, 6, 8).",
    "p_schance": "Probabilità che uno step suoni davvero. Sotto 100% il pattern respira da solo.",
}
for _c in range(NCELL):
    ANNOT["p_son%d" % (_c + 1)] = "Accende lo step %d. Massimo 4 step accesi: il quinto si rispegne." % (_c + 1)
    ANNOT["p_snote%d" % (_c + 1)] = ("Nota dello step %d, un semitono per scatto: 0 = la Key (A2 se Key è A), "
                                     "+7 = una quinta sopra. In modalità Trans parte dal tasto che tieni." % (_c + 1))
    ANNOT["p_sacc%d" % (_c + 1)] = "Accento sullo step %d: suona più forte." % (_c + 1)


# --------------------------------------------------------------------------
# Max patcher
# --------------------------------------------------------------------------
FOLDW, GAP = 22, 4  # folded strip width, gap between sections


def sub_patcher(boxes, lines, width):
    return {
        "fileversion": 1, "appversion": APPVERSION, "classnamespace": "box", "rect": [100.0, 100.0, 640.0, 480.0],
        "bglocked": 0, "openinpresentation": 1, "default_fontsize": 10.0, "default_fontface": 0,
        "default_fontname": "Arial Bold", "gridonopen": 1, "gridsize": [8.0, 8.0], "gridsnaponopen": 1,
        "objectsnaponopen": 0, "statusbarvisible": 2, "toolbarvisible": 1, "boxanimatetime": 500,
        "enablehscroll": 0, "enablevscroll": 0, "bgcolor": C_BG, "editing_bgcolor": C_BG, "devicewidth": 0.0,
        "description": "", "digest": "", "tags": "", "style": "", "subpatcher_template": "",
        "assistshowspatchername": 0, "boxes": boxes, "lines": lines,
    }


def split_into_bpatchers(pt, groups):
    """Moves every presentation object into a bpatcher per section (by x position, or by its _grp tag).
    Patch cords that cross a bpatcher border become send/receive pairs named ---o<id>_<outlet> /
    ---i<id>_<inlet> (--- makes the names unique per device instance)."""
    boxes = [b["box"] for b in pt.boxes]
    assign = {}
    for b in boxes:
        g = b.pop("_grp", None)
        if g:
            assign[b["id"]] = g
            continue
        if b.get("presentation"):
            x, y, w, h = b["presentation_rect"]
            for gname, gx0, gx1 in groups:
                if gx0 - 0.01 <= x and x + w <= gx1 + 0.01:
                    assign[b["id"]] = gname
                    b["presentation_rect"] = [x - gx0, y, w, h]
                    break
            else:
                assert w >= DEVICE_W - 1, ("presentation object outside every section", b.get("maxclass"),
                                           b.get("text"), b["presentation_rect"])
    gnames = sorted(set(assign.values()))
    sub = {g: {"boxes": [], "lines": []} for g in gnames}
    main_boxes = []
    for b in boxes:
        g = assign.get(b["id"])
        (sub[g]["boxes"] if g else main_boxes).append({"box": b})

    def new_box(where, text, ninl, nout, x, y):
        pt.n += 1
        oid = "obj-%d" % pt.n
        bb = {"box": {"id": oid, "maxclass": "newobj", "text": text, "numinlets": ninl, "numoutlets": nout,
                      "outlettype": [""] * nout, "patching_rect": [float(x), float(y), 120.0, 22.0]}}
        (sub[where]["boxes"] if where else main_boxes).append(bb)
        return oid

    def cord(s, so, d, di):
        return {"patchline": {"source": [s, so], "destination": [d, di]}}

    main_lines, seen = [], set()
    out_proxy, in_proxy = {}, {}
    for ln in pt.lines:
        (s, so), (d, di) = ln["patchline"]["source"], ln["patchline"]["destination"]
        gs, gd = assign.get(s), assign.get(d)
        if gs == gd:
            (sub[gs]["lines"] if gs else main_lines).append(ln)
            continue
        if gs:
            if (s, so) not in out_proxy:
                nm = "---o%s_%d" % (s.split("-")[1], so)
                snd = new_box(gs, "s " + nm, 1, 0, 2000 + len(out_proxy) % 20 * 130, 3000 + len(out_proxy) // 20 * 30)
                sub[gs]["lines"].append(cord(s, so, snd, 0))
                out_proxy[(s, so)] = new_box(None, "r " + nm, 1, 1, 6000 + len(out_proxy) % 20 * 130,
                                             3000 + len(out_proxy) // 20 * 30)
            src_ep = (out_proxy[(s, so)], 0)
        else:
            src_ep = (s, so)
        if gd:
            if (d, di) not in in_proxy:
                nm = "---i%s_%d" % (d.split("-")[1], di)
                rcv = new_box(gd, "r " + nm, 1, 1, 2000 + len(in_proxy) % 20 * 130, 3500 + len(in_proxy) // 20 * 30)
                sub[gd]["lines"].append(cord(rcv, 0, d, di))
                in_proxy[(d, di)] = new_box(None, "s " + nm, 1, 0, 6000 + len(in_proxy) % 20 * 130,
                                            3500 + len(in_proxy) // 20 * 30)
            dst_ep = (in_proxy[(d, di)], 0)
        else:
            dst_ep = (d, di)
        key = (src_ep, dst_ep)
        if key not in seen:
            seen.add(key)
            main_lines.append(cord(src_ep[0], src_ep[1], dst_ep[0], dst_ep[1]))
    gx = {g: (x0, x1) for g, x0, x1 in groups}
    for gi, g in enumerate(gnames):
        strip = g.startswith("STRIP_")
        base = g[len("STRIP_"):] if strip else g
        x0, x1 = gx[base]
        width = FOLDW if strip else x1 - x0
        if not strip:  # exposes the section's parameters to pattrstorage (user presets)
            new_box(g, "autopattr", 1, 4, 20, 3200)
        pt.n += 1
        main_boxes.append({"box": {
            "id": "obj-%d" % pt.n, "maxclass": "bpatcher", "embed": 1, "numinlets": 0, "numoutlets": 0,
            "patcher": sub_patcher(sub[g]["boxes"], sub[g]["lines"], width), "offset": [0.0, 0.0],
            "bgmode": 0, "border": 0, "clickthrough": 0, "enablehscroll": 0, "enablevscroll": 0,
            "lockeddragscroll": 0, "viewvisibility": 1, "varname": "nb_" + g, "presentation": 1,
            "presentation_rect": [float(x0), 0.0, float(width), 169.0], "hidden": 1 if strip else 0,
            "patching_rect": [7000.0 + gi * 40, 40.0 + gi * 30, float(width), 169.0]}})
    return main_boxes, main_lines


def ff(x):
    """float literal for expr (always with a decimal point)"""
    s = "%.6g" % x
    if "." not in s and "e" not in s:
        s += "."
    return s


def build_patcher(code):
    pt = Patch()
    # ------------------------------------------------ look: background and section cards (drawn first)
    def panel(rect, color, rounded=0):
        return pt.add("panel", [1500 + rect[0], 900 + rect[1], rect[2], rect[3]], ninl=1, nout=0,
                      presentation=1, presentation_rect=[float(v) for v in rect], background=1,
                      bgcolor=color, bgfillcolor_type="color", bgfillcolor_color=color,
                      border=0, rounded=rounded, mode=0, ignoreclick=1)

    panel([0, 0, DEVICE_W, 169], C_BG)
    for name, x, right, accent in SECTIONS:
        panel([x - 6, 2, right - x + 12, 165], C_CARD_DICE if name == "DICE" else C_CARD, rounded=7)
        panel([x + 12, 6, 3, 9], accent, rounded=2)

    def comment(text, rect, size=9.0, bold=False, color=C_MID, prect=None):
        return pt.add("live.comment", prect or [1500 + rect[0], 1100 + rect[1], rect[2], rect[3]], text=text,
                      ninl=1, nout=0, presentation=1, presentation_rect=[float(x) for x in rect],
                      fontsize=size, fontname=F_HEAD if bold else F_TEXT, textcolor=color,
                      textjustification=0)

    for name, x, right, accent in SECTIONS:
        comment(name, [x + 17, 2, 9 * len(name) + 6, 15], size=10.0, bold=True, color=C_TEXT)

    # fold buttons (one per section) and the narrow strips shown when a section is folded
    fold_tg, strip_btn = {}, {}
    for si, (name, x, right, accent) in enumerate(SECTIONS):
        fold_tg[name] = pt.add("live.text", [4400 + si * 60, 40, 12, 12], ninl=1, nout=2, outtype=["", ""], mode=1,
                               text="-", texton="+", parameter_enable=1, presentation=1,
                               presentation_rect=[float(x - 2), 4.0, 12.0, 12.0],
                               saved_attribute_attributes={"valueof": {
                                   "parameter_longname": "Fold " + name.title(), "parameter_shortname": "Fold",
                                   "parameter_type": 2, "parameter_mmin": 0.0, "parameter_mmax": 1.0,
                                   "parameter_enum": ["open", "folded"], "parameter_initial_enable": 1,
                                   "parameter_initial": [0], "parameter_invisible": 1}},
                               activebgcolor=C_MENU, activebgoncolor=accent, bgcolor=C_MENU, bgoncolor=accent,
                               textcolor=C_MID, textoncolor=C_BG, activetextcolor=C_MID, activetextoncolor=C_BG,
                               bordercolor=C_LINE, focusbordercolor=accent, fontname=F_HEAD, fontsize=9.0,
                               annotation="Chiude la sezione %s in una striscia sottile: il device si stringe. "
                                          "Il suono non cambia." % name, annotation_name="Fold " + name.title())
        g = "STRIP_" + name
        pt.add("panel", [4400 + si * 60, 80, 20, 165], ninl=1, nout=0, presentation=1,
               presentation_rect=[0.0, 2.0, float(FOLDW - 2), 165.0], background=1, bgcolor=C_CARD,
               bgfillcolor_type="color", bgfillcolor_color=C_CARD, border=0, rounded=7, mode=0, ignoreclick=1,
               _grp=g)
        strip_btn[name] = pt.add("live.text", [4400 + si * 60, 260, 16, 14], ninl=1, nout=2, outtype=["", ""],
                                 mode=0, text="+", texton="+", parameter_enable=0, presentation=1,
                                 presentation_rect=[2.0, 4.0, float(FOLDW - 6), 14.0], activebgcolor=accent,
                                 activebgoncolor=C_TEXT, bgcolor=accent, bgoncolor=C_TEXT, textcolor=C_BG,
                                 textoncolor=C_BG, activetextcolor=C_BG, activetextoncolor=C_BG, bordercolor=accent,
                                 fontname=F_HEAD, fontsize=10.0, _grp=g,
                                 annotation="Riapre la sezione %s." % name, annotation_name="Open " + name.title())
        pt.add("comment", [4400 + si * 60, 290, 16, 140], text=" ".join(name), ninl=1, nout=0, presentation=1,
               presentation_rect=[2.0, 24.0, float(FOLDW - 6), 140.0], textcolor=C_MID, fontname=F_HEAD,
               fontsize=9.0, textjustification=1, _grp=g)

    # ------------------------------------------------ core objects
    gen = pt.add("newobj", [40, 1180, 400, 22], text="gen~", ninl=1, nout=3 + NV,
                 outtype=["signal"] * (3 + NV), patcher=gen_patcher(code))
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
    eq = pt.obj("== 0", 40, 215, ninl=2, nout=1)
    pt.connect(route, 0, eq, 0)
    sel = pt.obj("sel 1", 40, 250, ninl=2, nout=2)
    pt.connect(eq, 0, sel, 0)
    goff = pt.msg("p_gate 0", 40, 285)
    pt.connect(sel, 0, goff, 0)
    pt.connect(goff, 0, gen, 0)
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
    bend = pt.obj("bendin", 480, 70, ninl=1, nout=2, outtype=["int", "int"])
    pbend = pt.obj("prepend p_bend", 480, 105)
    pt.connect(bend, 0, pbend, 0)
    pt.connect(pbend, 0, gen, 0)
    ctl = pt.obj("ctlin 1", 620, 70, ninl=1, nout=2, outtype=["int", "int"])
    pmw = pt.obj("prepend p_modw", 620, 105)
    pt.connect(ctl, 0, pmw, 0)
    pt.connect(pmw, 0, gen, 0)
    pth = pt.msg("path live_set", 780, 70)
    pt.connect(thisdev, 0, pth, 0)
    lpath = pt.obj("live.path", 780, 105, ninl=1, nout=3)
    pt.connect(pth, 0, lpath, 0)
    obs = pt.obj("live.observer tempo", 780, 140, ninl=2, nout=2)
    pt.connect(lpath, 0, obs, 1)
    pbpm = pt.obj("prepend p_bpm", 780, 175)
    pt.connect(obs, 0, pbpm, 0)
    pt.connect(pbpm, 0, gen, 0)

    # ------------------------------------------------ controls
    def dial_style(accent):
        return dict(activedialcolor=accent, activeneedlecolor=C_TEXT, dialcolor=C_ARC_OFF,
                    needlecolor=C_LOW, textcolor=C_MID, focusbordercolor=accent,
                    fontname=F_TEXT, fontsize=9.0)

    menu_style = dict(activebgcolor=C_MENU, bgcolor=C_MENU, textcolor=C_TEXT, activetricolor=C_AMBER,
                      tricolor=C_LOW, bordercolor=C_LINE, focusbordercolor=C_AMBER, fontname=F_TEXT,
                      fontsize=9.5)
    secinfo = {s[0]: s for s in SECTIONS}
    ui_of = {}
    ui_i = 0
    def slot_x(sec, x0, col):
        if sec == "SEQ" and col >= 3:
            return STEP_X + (col - 3) * COLW
        return x0 + col * COLW

    for p in P:
        sec = p["sec"]
        x0 = secinfo[sec][1]
        accent = secinfo[sec][3]
        px = 40 + (ui_i % 10) * 110
        py = 520 + (ui_i // 10) * 130
        ui_i += 1
        vo = {
            "parameter_longname": p["long"],
            "parameter_shortname": p["short"],
            "parameter_type": 2 if p["kind"] in ("menu", "toggle", "power", "enumdial") else (1 if p["kind"] in ("int", "note") else 0),
            "parameter_mmin": float(p["lo"]),
            "parameter_mmax": float(p["hi"]),
            "parameter_initial_enable": 1,
            "parameter_initial": [p["default"]],
        }
        extra = dict(annotation=ANNOT.get(p["name"], ""), annotation_name=p["long"])
        if p["kind"] == "menu":
            vo["parameter_enum"] = p["enum"]
            vo["parameter_mmax"] = float(len(p["enum"]) - 1)
            if p["rect"]:
                rect, lrect = p["rect"], p["lrect"]
            elif sec == "CHORD":
                ly = 17 + p["row"] * 37
                lrect, rect = [CHORD_X, ly, 76, 13], [CHORD_X, ly + 14, 76, 16]
            else:  # menu sitting in a dial slot
                cx = slot_x(sec, x0, p["col"])
                lrect, rect = [cx, ROW_Y[p["row"]] + 5, 46, 13], [cx, ROW_Y[p["row"]] + 21, 44, 16]
            comment(p["short"], lrect, size=9.0, color=C_MID)
            st = dict(menu_style)
            st.update(activetricolor=accent, focusbordercolor=accent)
            ui = pt.add("live.menu", [px, py, rect[2], 15], ninl=1, nout=3, outtype=["", "", "float"],
                        parameter_enable=1, presentation=1, presentation_rect=[float(v) for v in rect],
                        varname=p["name"], saved_attribute_attributes={"valueof": vo}, **st, **extra)
        elif p["kind"] == "power":
            vo["parameter_enum"] = ["off", "on"]
            wdt = 26 if p["label"] == ("OFF", "ON") else max(30, 7 * len(p["label"][1]) + 4)
            rect = [secinfo[sec][2] - wdt, 4, wdt, 12]
            if p["name"] == "p_reverbon":
                rect = [secinfo[sec][2] - 26 - 4 - wdt, 4, wdt, 12]
            ui = pt.add("live.text", [px, py, wdt, 12], ninl=1, nout=2, outtype=["", ""], mode=1,
                        text=p["label"][0], texton=p["label"][1], parameter_enable=1, presentation=1,
                        presentation_rect=[float(v) for v in rect], varname=p["name"],
                        saved_attribute_attributes={"valueof": vo}, activebgcolor=C_MENU,
                        activebgoncolor=accent, bgcolor=C_MENU, bgoncolor=accent, textcolor=C_LOW,
                        textoncolor=C_BG, activetextcolor=C_LOW, activetextoncolor=C_BG, bordercolor=C_LINE,
                        focusbordercolor=accent, fontname=F_HEAD, fontsize=7.5, **extra)
        elif p["kind"] == "toggle":
            vo["parameter_enum"] = ["off", "on"]
            rect = p["rect"] or [slot_x(sec, x0, p["col"]), 38, 44, 18]
            ui = pt.add("live.text", [px, py, 44, 18], ninl=1, nout=2, outtype=["", ""], mode=1,
                        text=p["short"], texton=p["short"], parameter_enable=1, presentation=1,
                        presentation_rect=[float(v) for v in rect], varname=p["name"],
                        saved_attribute_attributes={"valueof": vo}, activebgcolor=C_MENU,
                        activebgoncolor=C_AMBER, bgcolor=C_MENU, bgoncolor=C_AMBER, textcolor=C_MID,
                        textoncolor=C_BG, activetextcolor=C_MID, activetextoncolor=C_BG, bordercolor=C_LINE,
                        focusbordercolor=C_AMBER, fontname=F_HEAD, fontsize=10.0, **extra)
        elif p["kind"] == "note":
            vo["parameter_unitstyle"] = p["unit"]
            rect = [slot_x(sec, x0, p["col"]), 64, 44, 18]
            ui = pt.add("live.numbox", [px, py, 44, 18], ninl=1, nout=2, outtype=["", "float"],
                        parameter_enable=1, presentation=1, presentation_rect=[float(v) for v in rect],
                        varname=p["name"], saved_attribute_attributes={"valueof": vo},
                        activebgcolor=C_MENU, bgcolor=C_MENU, textcolor=C_TEXT, activeslidercolor=C_AMBER,
                        tricolor=C_LOW, focusbordercolor=C_AMBER, bordercolor=C_LINE, fontname=F_TEXT,
                        fontsize=10.0, **extra)
        else:
            if p["kind"] == "enumdial":
                vo["parameter_enum"] = p["enum"]
            else:
                vo["parameter_unitstyle"] = p["unit"]
            if p["exp"] != 1.0:
                vo["parameter_exponent"] = float(p["exp"])
            if p["kind"] == "int":
                vo["parameter_steps"] = int(p["hi"] - p["lo"] + 1)
            if p["rect"]:
                rect = p["rect"]
            elif sec == "CHORD":
                rect = [CHORD_DIAL_X + (p["col"] - 1) * COLW, ROW_Y[p["row"]], 44, 48]
            elif sec == "SEQ" and p["col"] >= 3:
                rect = [slot_x(sec, x0, p["col"]), 92, 44, 48]
            else:
                rect = [slot_x(sec, x0, p["col"]), ROW_Y[p["row"]], 44, 48]
            ui = pt.add("live.dial", [px, py, 44, 48], ninl=1, nout=2, outtype=["", "float"],
                        parameter_enable=1, presentation=1, presentation_rect=[float(v) for v in rect],
                        varname=p["name"], saved_attribute_attributes={"valueof": vo},
                        **dial_style(accent), **extra, **p["ui"])
        ui_of[p["name"]] = ui
        pre = pt.obj("prepend %s" % p["name"], px, py + 62)
        pt.connect(ui, 0, pre, 0)
        pt.connect(pre, 0, gen, 0)
        if p["kind"] not in ("toggle", "power"):  # a bang would flip a toggle: those restore on their own
            pt.connect(thisdev, 0, ui, 0)

    # section switches grey out their controls ("active 0") when off
    for ai, p in enumerate([q for q in P if q["kind"] == "power"]):
        targets = p["dims"] or [q["name"] for q in P if q["sec"] == p["sec"] and q["name"] != p["name"]]
        act = pt.msg("active $1", 2600 + ai * 90, 1300)
        pt.connect(ui_of[p["name"]], 0, act, 0)
        for t in targets:
            pt.connect(act, 0, ui_of[t], 0)

    # ------------------------------------------------ CHORD NOW: keyboard readout of the chord
    comment("CHORD NOW", [CHORD_DIAL_X + 1, 118, 120, 13], size=8.5, color=C_LOW)
    kb = pt.add("kslider", [1900, 400, 136, 30], ninl=2, nout=2, outtype=["int", "int"], presentation=1,
                presentation_rect=[float(CHORD_DIAL_X), 133.0, 136.0, 28.0], mode=1, offset=48, range=36,
                ignoreclick=1, whitekeycolor=rgb("#C9CDD3"), blackkeycolor=rgb("#23262B"),
                hkeycolor=C_AMBER, annotation="Le note dell'accordo che sta suonando NEBBIA (C2-B4).",
                annotation_name="Chord Now")
    for s in range(NV):
        bx = 1900 + s * 120
        snap = pt.obj("snapshot~ 40", bx, 120, ninl=2, nout=1, outtype=["float"])
        pt.connect(gen, 2 + s, snap, 0)
        toint = pt.obj("i", bx, 150, ninl=2, nout=1, outtype=["int"])
        pt.connect(snap, 0, toint, 0)
        chg = pt.obj("change -99", bx, 180, ninl=1, nout=3, outtype=["", "int", "int"])
        pt.connect(toint, 0, chg, 0)
        tib = pt.obj("t i b", bx, 210, ninl=1, nout=2, outtype=["int", "bang"])
        pt.connect(chg, 0, tib, 0)
        prev = pt.obj("i", bx + 60, 240, ninl=2, nout=1, outtype=["int"])
        pt.connect(tib, 1, prev, 0)
        s_off = pt.obj("split 0 127", bx + 60, 270, ninl=3, nout=2)
        pt.connect(prev, 0, s_off, 0)
        p_off = pt.obj("pack 0 0", bx + 60, 300, ninl=2, nout=1)
        pt.connect(s_off, 0, p_off, 0)
        pt.connect(p_off, 0, kb, 0)
        tii = pt.obj("t i i", bx, 240, ninl=1, nout=2, outtype=["int", "int"])
        pt.connect(tib, 0, tii, 0)
        pt.connect(tii, 1, prev, 1)
        s_on = pt.obj("split 0 127", bx, 270, ninl=3, nout=2)
        pt.connect(tii, 0, s_on, 0)
        p_on = pt.obj("pack 0 127", bx, 300, ninl=2, nout=1)
        pt.connect(s_on, 0, p_on, 0)
        pt.connect(p_on, 0, kb, 0)

    # ------------------------------------------------ SEQ: Live transport, playhead LEDs
    phasor = pt.obj("plugphasor~", 40, 1140, ninl=1, nout=1, outtype=["signal"])
    pt.connect(phasor, 0, gen, 0)
    for prop, pname, bx in [("is_playing", "p_playing", 940), ("current_song_time", "p_songbeat", 1100)]:
        ob = pt.obj("live.observer %s" % prop, bx, 140, ninl=2, nout=2)
        pt.connect(lpath, 0, ob, 1)
        pr = pt.obj("prepend %s" % pname, bx, 175)
        pt.connect(ob, 0, pr, 0)
        pt.connect(pr, 0, gen, 0)
    psnap = pt.obj("snapshot~ 20", 1900, 360, ninl=2, nout=1, outtype=["float"])
    pt.connect(gen, 2 + NV, psnap, 0)
    pint = pt.obj("i", 1900, 390, ninl=2, nout=1, outtype=["int"])
    pt.connect(psnap, 0, pint, 0)
    pchg = pt.obj("change -99", 1900, 420, ninl=1, nout=3, outtype=["", "int", "int"])
    pt.connect(pint, 0, pchg, 0)
    for i in range(NCELL):
        eqs = pt.obj("== %d" % i, 1900 + i * 60, 450, ninl=2, nout=1)
        pt.connect(pchg, 0, eqs, 0)
        led = pt.add("led", [1900 + i * 60, 480, 12, 12], ninl=1, nout=1, outtype=["int"], presentation=1,
                     presentation_rect=[float(SEQ_X + i * STEPW + 15), 21.0, 8.0, 8.0], oncolor=C_AMBER,
                     offcolor=C_ARC_OFF, ignoreclick=1, annotation="Step che sta suonando.",
                     annotation_name="Playhead")
        pt.connect(eqs, 0, led, 0)
    comment("follows Live \u25b6", [SEQ_X, 147, 104, 12], size=8.0, color=C_LOW)
    seq_rnd = pt.add("live.text", [2200, 600, 52, 18], ninl=1, nout=2, outtype=["", ""], mode=0,
                     text="RANDOM", texton="RANDOM", parameter_enable=1, presentation=1,
                     presentation_rect=[float(SEQ_X + 278), 127.0, 52.0, 18.0],
                     saved_attribute_attributes={"valueof": {
                         "parameter_longname": "Seq Random", "parameter_shortname": "Seq Random",
                         "parameter_type": 2, "parameter_mmin": 0.0, "parameter_mmax": 1.0,
                         "parameter_enum": ["off", "on"], "parameter_initial_enable": 1, "parameter_initial": [0]}},
                     activebgcolor=rgb("#3A2E1C"), activebgoncolor=C_AMBER, bgcolor=C_MENU, bgoncolor=C_AMBER,
                     textcolor=C_TEXT, textoncolor=C_BG, activetextcolor=C_TEXT, activetextoncolor=C_BG,
                     bordercolor=C_AMBER, focusbordercolor=C_AMBER, fontname=F_HEAD, fontsize=8.5,
                     annotation="Nuovo pattern: step accesi (max 4), note nella tua Key, accenti, Rate (1/16, 1/8, "
                                "1/4), Gate e Swing. Il suono non cambia.",
                     annotation_name="Seq Random")
    srb = pt.obj("route bang 1", 2200, 640, ninl=2, nout=3)
    pt.connect(seq_rnd, 0, srb, 0)
    stb = pt.obj("t b", 2200, 670, ninl=1, nout=1, outtype=["bang"])
    pt.connect(srb, 0, stb, 0)
    pt.connect(srb, 1, stb, 0)
    seq_targets = [("p_seqrate", "expr ($f1 >= 2500.) + ($f1 >= 7500.)"),
                   ("p_sgate", "expr 10. + 80. * $f1 / 10000."),
                   ("p_swing", "expr 40. * pow($f1 / 10000., 2.)")]
    for c in range(NCELL):
        seq_targets += [("p_son%d" % (c + 1), "expr $f1 < %s" % ff(SON_DENS[c])),
                        ("p_snote%d" % (c + 1), "expr " + SEMI_EXPR),
                        ("p_sacc%d" % (c + 1), "expr $f1 < 3000.")]
    suzi = pt.obj("uzi %d" % len(seq_targets), 2200, 700, ninl=2, nout=3, outtype=["bang", "bang", "int"])
    pt.connect(stb, 0, suzi, 0)
    stbi = pt.obj("t b i", 2200, 730, ninl=1, nout=2, outtype=["bang", "int"])
    pt.connect(suzi, 2, stbi, 0)
    srnd = pt.obj("random 10001", 2300, 760, ninl=2, nout=1, outtype=["int"])
    pt.connect(stbi, 0, srnd, 0)
    sgrp = pt.obj("zl group 2", 2200, 790, ninl=2, nout=2)
    pt.connect(stbi, 1, sgrp, 0)
    pt.connect(srnd, 0, sgrp, 0)
    sroute = pt.obj("route " + " ".join(str(i + 1) for i in range(len(seq_targets))), 2200, 820, ninl=2,
                    nout=len(seq_targets) + 1)
    pt.connect(sgrp, 0, sroute, 0)
    for i, (nm, e) in enumerate(seq_targets):
        ex = pt.add("newobj", [2200 + (i % 6) * 150, 860 + (i // 6) * 40, 140, 22], text=e, ninl=1, nout=1,
                    outtype=[""])
        pt.connect(sroute, i, ex, 0)
        pt.connect(ex, 0, ui_of[nm], 0)

    # at most 4 steps on: every ON button feeds a running sum; turning on a 5th one switches it back off
    cpak = pt.obj("pak %s" % " ".join(["0"] * NCELL), 2900, 600, ninl=NCELL, nout=1)
    csum = pt.obj("zl sum", 2900, 640, ninl=2, nout=2)
    pt.connect(cpak, 0, csum, 0)
    for c in range(NCELL):
        cx = 2900 + c * 90
        on_ui = ui_of["p_son%d" % (c + 1)]
        tc = pt.obj("t i i", cx, 560, ninl=1, nout=2, outtype=["int", "int"])
        pt.connect(on_ui, 0, tc, 0)
        pt.connect(tc, 1, cpak, c)
        sel1 = pt.obj("sel 1", cx, 680, ninl=2, nout=2)
        pt.connect(tc, 0, sel1, 0)
        # the check runs after the whole current event: a preset or Reset that sets all 8 steps never trips it,
        # a click on a 5th step (or a Randomize that turned on too many) is switched back off
        dl = pt.obj("deferlow", cx, 695, ninl=1, nout=1)
        pt.connect(sel1, 0, dl, 0)
        held = pt.obj("i", cx, 710, ninl=2, nout=1, outtype=["int"])
        pt.connect(csum, 0, held, 1)
        pt.connect(dl, 0, held, 0)
        over = pt.obj("> %d" % MAXON, cx, 740, ninl=2, nout=1)
        pt.connect(held, 0, over, 0)
        sel2 = pt.obj("sel 1", cx, 770, ninl=2, nout=2)
        pt.connect(over, 0, sel2, 0)
        zero = pt.msg("0", cx, 810)
        pt.connect(sel2, 0, zero, 0)
        pt.connect(zero, 0, on_ui, 0)
        # a step that is off greys out its note knob and accent button
        act = pt.msg("active $1", cx, 830)
        pt.connect(on_ui, 0, act, 0)
        pt.connect(act, 0, ui_of["p_snote%d" % (c + 1)], 0)
        pt.connect(act, 0, ui_of["p_sacc%d" % (c + 1)], 0)

    # ------------------------------------------------ DICE: randomize button, amount, locks
    def maxonly_vo(long, short, ptype, lo, hi, default, enum=None, unit=None):
        vo = {"parameter_longname": long, "parameter_shortname": short, "parameter_type": ptype,
              "parameter_mmin": float(lo), "parameter_mmax": float(hi), "parameter_initial_enable": 1,
              "parameter_initial": [default]}
        if enum:
            vo["parameter_enum"] = enum
        if unit is not None:
            vo["parameter_unitstyle"] = unit
        return {"valueof": vo}

    x = DICE_X
    dice_btn = pt.add("live.text", [1900, 600, 88, 24], ninl=1, nout=2, outtype=["", ""], mode=0,
                      text="RANDOMIZE", texton="RANDOMIZE", parameter_enable=1, presentation=1,
                      presentation_rect=[float(x), 20.0, 88.0, 24.0], 
                      saved_attribute_attributes=maxonly_vo("Randomize", "Randomize", 2, 0, 1, 0, ["off", "on"]),
                      activebgcolor=rgb("#25403F"), activebgoncolor=C_TEAL, bgcolor=C_MENU, bgoncolor=C_TEAL,
                      textcolor=C_TEXT, textoncolor=C_BG, activetextcolor=C_TEXT, activetextoncolor=C_BG,
                      bordercolor=C_TEAL, focusbordercolor=C_TEAL, fontname=F_HEAD, fontsize=10.0,
                      annotation="Sceglie un carattere a caso (Dub Stab, Deep Pad, Pluck, Organ, Glass, Rumble, "
                                 "Worn, Ghost) e genera una patch nuova coerente con quel carattere, accendendo o "
                                 "spegnendo eco, spazio, chorus e analog. Amount decide quanto cambiare, i lucchetti "
                                 "proteggono le sezioni. Cmd/Ctrl+Z per tornare indietro.",
                      annotation_name="Randomize")
    reset_btn = pt.add("live.text", [2000, 600, 88, 16], ninl=1, nout=2, outtype=["", ""], mode=0,
                       text="RESET", texton="RESET", parameter_enable=1, presentation=1,
                       presentation_rect=[float(x), 48.0, 88.0, 15.0], 
                       saved_attribute_attributes=maxonly_vo("Reset", "Reset", 2, 0, 1, 0, ["off", "on"]),
                       activebgcolor=C_MENU, activebgoncolor=C_TEXT, bgcolor=C_MENU, bgoncolor=C_TEXT,
                       textcolor=C_MID, textoncolor=C_BG, activetextcolor=C_MID, activetextoncolor=C_BG,
                       bordercolor=C_LINE, focusbordercolor=C_TEAL, fontname=F_TEXT, fontsize=9.0,
                       annotation="Riporta ai valori iniziali tutte le sezioni senza lucchetto "
                                  "(la Key resta quella del tuo pezzo).", annotation_name="Reset")
    amount = pt.add("live.dial", [2100, 600, 44, 48], ninl=1, nout=2, outtype=["", "float"],
                    parameter_enable=1, presentation=1, presentation_rect=[float(x + 92), 18.0, 44.0, 48.0],
                    
                    saved_attribute_attributes=maxonly_vo("Dice Amount", "Amount", 0, 0, 100, 100, unit=5),
                    annotation="Quanto cambia Randomize: poco = variazione della patch attuale, "
                               "100 = patch completamente nuova.", annotation_name="Dice Amount",
                    **dial_style(C_TEAL))
    pt.connect(thisdev, 0, amount, 0)
    comment("LOCK", [x + 1, 67, 80, 12], size=8.5, color=C_LOW)
    lock_of = {}
    lock_list = []
    for i, (lname, secs) in enumerate(LOCK_GROUPS):
        r = [x + (i % 4) * 34.5, 82 + (i // 4) * 17, 33, 15]
        lk = pt.add("live.text", [1900 + i * 60, 680, 44, 16], ninl=1, nout=2, outtype=["", ""], mode=1,
                    text=lname, texton=lname, parameter_enable=1, presentation=1,
                    presentation_rect=[float(v) for v in r],
                    saved_attribute_attributes=maxonly_vo("Lock " + lname, "Lock " + lname, 2, 0, 1, 0,
                                                          ["off", "on"]),
                    activebgcolor=C_MENU, activebgoncolor=C_TEAL, bgcolor=C_MENU, bgoncolor=C_TEAL,
                    textcolor=C_MID, textoncolor=C_BG, activetextcolor=C_MID, activetextoncolor=C_BG,
                    bordercolor=C_LINE, focusbordercolor=C_TEAL, fontname=F_TEXT, fontsize=8.0,
                    annotation="Acceso: Randomize e Reset non toccano la sezione %s." % lname.upper(),
                    annotation_name="Lock " + lname)
        for s in secs:
            lock_of[s] = lk
        lock_list.append((lk, secs))

    # randomizer engine: button -> uzi -> (index, r1, r2) -> route -> one expr per parameter
    names = [p["name"] for p in P if p["name"] in RAND]
    k = len(names)
    rb = pt.obj("route bang 1", 1900, 760, ninl=2, nout=3)
    pt.connect(dice_btn, 0, rb, 0)
    tb = pt.obj("t b", 1900, 790, ninl=1, nout=1, outtype=["bang"])
    pt.connect(rb, 0, tb, 0)
    pt.connect(rb, 1, tb, 0)
    uzi = pt.obj("uzi %d" % k, 1900, 820, ninl=2, nout=3, outtype=["bang", "bang", "int"])
    tarch = pt.obj("t b b", 1900, 805, ninl=1, nout=2, outtype=["bang", "bang"])
    pt.connect(tb, 0, tarch, 0)
    pt.connect(tarch, 0, uzi, 0)
    arr = pt.obj("random 10000", 2100, 790, ninl=2, nout=1, outtype=["int"])
    pt.connect(tarch, 1, arr, 0)
    arnd = pt.obj("expr $f2 + int($f1 / 10000. * $f3)", 2100, 815, ninl=3, nout=1)
    pt.connect(arr, 0, arnd, 0)
    # the character's name, shown in the DICE header
    aname = pt.add("comment", [2100, 900, 70, 15], text="", ninl=1, nout=0, presentation=1,
                   presentation_rect=[float(DICE_X + 50), 3.0, 58.0, 13.0], textcolor=C_TEAL, fontname=F_HEAD,
                   fontsize=8.5, textjustification=0)
    asel = pt.obj("sel %s" % " ".join(str(i) for i in range(len(ARCHETYPES))), 2100, 840, ninl=2,
                  nout=len(ARCHETYPES) + 1)
    pt.connect(arnd, 0, asel, 0)
    for ai, (an, _, _) in enumerate(ARCHETYPES):
        am = pt.msg("set %s" % an, 2100 + ai * 90, 870)
        pt.connect(asel, ai, am, 0)
        pt.connect(am, 0, aname, 0)
    tbbi = pt.obj("t b b i", 1900, 850, ninl=1, nout=3, outtype=["bang", "bang", "int"])
    pt.connect(uzi, 2, tbbi, 0)
    rnd = pt.obj("random 10001", 2000, 880, ninl=2, nout=1, outtype=["int"])
    pt.connect(tbbi, 0, rnd, 0)
    pt.connect(tbbi, 1, rnd, 0)
    grp = pt.obj("zl group 3", 1900, 910, ninl=2, nout=2)
    pt.connect(tbbi, 2, grp, 0)
    pt.connect(rnd, 0, grp, 0)
    rroute = pt.obj("route " + " ".join(str(i + 1) for i in range(k)), 1900, 940, ninl=2, nout=k + 1)
    pt.connect(grp, 0, rroute, 0)
    pdef = {p["name"]: p for p in P}
    for i, nm in enumerate(names):
        lo, hi, curve = RAND[nm]
        p = pdef[nm]
        bx, by = 40 + (i % 12) * 150, 1400 + (i // 12) * 90
        sel_ = "($f2 < $f3 * (1. - $f5) * 100.)"
        in_arch = any(nm in ov for _, ov, _ in ARCHETYPES)
        if curve == "coin":
            prob = "+".join("($f6==%d)*%d" % (ai, int(on.get(nm, 0.5) * 10000))
                            for ai, (_, _, on) in enumerate(ARCHETYPES))
            e = "expr $f4 + %s * (($f1 < (%s)) - $f4)" % (sel_, prob)
        elif in_arch:
            los, spans = [], []
            for ai, (_, ov, _) in enumerate(ARCHETYPES):
                a_lo, a_hi = ov.get(nm, (lo, hi))
                los.append("($f6==%d)*%s" % (ai, fnum(float(a_lo))))
                spans.append("($f6==%d)*%s" % (ai, fnum(float(a_hi - a_lo))))
            e = ("expr $f4 + $f3 * 0.01 * (1. - $f5) * (((%s) + (%s) * pow($f1 / 10000., %s)) - $f4) + $f2 * 0."
                 % ("+".join(los), "+".join(spans), ff(1.7 if curve != 1 and curve != 1.5 else 1.0)))
        elif curve == "darkchord":  # dark colours only: skip Major, Maj7, Maj9, Dom9 (indexes 10-13)
            e = ("expr $f4 + %s * ((int($f1 / 10001. * %s) + (int($f1 / 10001. * %s) >= 10) * 4) - $f4)"
                 % (sel_, ff(len(DARK_CHORDS)), ff(len(DARK_CHORDS))))
        elif curve == "darkharm":  # Fixed (x2), Minor, Dorian, Phrygian, Harmonic Minor
            e = ("expr $f4 + %s * (((int($f1 / 10001. * 6.) >= 2) * (int($f1 / 10001. * 6.) - 1) "
                 "+ (int($f1 / 10001. * 6.) >= 5) * 3) - $f4)" % sel_)
        elif curve == "gate":
            e = "expr $f4 + %s * (($f1 < %s) - $f4)" % (sel_, ff(SON_DENS[int(nm[5:]) - 1]))
        elif curve == "acc":
            e = "expr $f4 + %s * (($f1 < 3000.) - $f4)" % sel_
        elif curve == "semis":
            e = "expr $f4 + %s * ((%s) - $f4)" % (sel_, SEMI_EXPR)
        elif p["kind"] == "menu":
            e = ("expr $f4 + ($f2 < $f3 * (1. - $f5) * 100.) * (int(%s + $f1 / 10001. * %s) - $f4)"
                 % (ff(lo), ff(hi - lo + 1)))
        elif p["kind"] == "int":
            e = ("expr int($f4 + $f3 * 0.01 * (1. - $f5) * ((%s + %s * $f1 / 10000.) - $f4) + 0.5) + $f2 * 0."
                 % (ff(lo), ff(hi - lo)))
        else:
            e = ("expr $f4 + $f3 * 0.01 * (1. - $f5) * ((%s + %s * pow($f1 / 10000., %s)) - $f4) + $f2 * 0."
                 % (ff(lo), ff(hi - lo), ff(curve)))
        up = pt.obj("unpack 0 0", bx, by, ninl=1, nout=2)
        pt.connect(rroute, i, up, 0)
        ex = pt.add("newobj", [bx, by + 30, 140, 22], text=e, ninl=6 if ("$f6" in e) else 5, nout=1,
                    outtype=[""])
        if "$f6" in e:
            pt.connect(arnd, 0, ex, 5)
        pt.connect(up, 1, ex, 1)
        pt.connect(up, 0, ex, 0)
        pt.connect(amount, 0, ex, 2)
        pt.connect(ui_of[nm], 0, ex, 3)
        pt.connect(lock_of[p["sec"]], 0, ex, 4)
        pt.connect(ex, 0, ui_of[nm], 0)

    # ------------------------------------------------ PRESET: folders (genre / style) + user slots
    px0 = PRESET_X
    fnames = [f for f, _ in FOLDERS] + ["USER"]
    fmenu = pt.add("live.menu", [3200, 560, 104, 16], ninl=1, nout=3, outtype=["", "", "float"],
                   parameter_enable=1, presentation=1, presentation_rect=[float(px0), 20.0, 104.0, 16.0],
                   saved_attribute_attributes={"valueof": {
                       "parameter_longname": "Preset Folder", "parameter_shortname": "Folder", "parameter_type": 2,
                       "parameter_mmin": 0.0, "parameter_mmax": float(len(fnames) - 1), "parameter_enum": fnames,
                       "parameter_initial_enable": 1, "parameter_initial": [0], "parameter_invisible": 1}},
                   annotation="Cartella dei preset: genere e stile. Anche RANDOMIZE segue la cartella "
                              "(scuro in Dub Techno, morbido in Ambient, folle in Experimental).",
                   annotation_name="Preset Folder", **dict(menu_style, textcolor=C_AMBER))
    pt.connect(thisdev, 0, fmenu, 0)
    pumenu = pt.add("umenu", [3200, 600, 104, 18], ninl=1, nout=3, outtype=["int", "", ""], presentation=1,
                    presentation_rect=[float(px0), 39.0, 104.0, 18.0], bgcolor=C_MENU, bgfillcolor_type="color",
                    bgfillcolor_color=C_MENU, textcolor=C_TEXT, color=C_AMBER, fontname=F_TEXT, fontsize=9.5,
                    arrow=1, annotation="Scegli un preset della cartella: si carica subito.",
                    annotation_name="Preset")

    def small_btn(text, rect, ann, accent=C_AMBER, name=None, size=8.5):
        name = name or text.title()
        return pt.add("live.text", [3200 + rect[0], 700 + rect[1], rect[2], rect[3]], ninl=1, nout=2,
                      outtype=["", ""], mode=0, text=text, texton=text, parameter_enable=1, presentation=1,
                      presentation_rect=[float(v) for v in rect],
                      saved_attribute_attributes={"valueof": {
                          "parameter_longname": "Preset " + name, "parameter_shortname": name,
                          "parameter_type": 2, "parameter_mmin": 0.0, "parameter_mmax": 1.0,
                          "parameter_enum": ["off", "on"], "parameter_initial_enable": 1, "parameter_initial": [0],
                          "parameter_invisible": 1}},
                      activebgcolor=C_MENU, activebgoncolor=accent, bgcolor=C_MENU, bgoncolor=accent,
                      textcolor=C_MID, textoncolor=C_BG, activetextcolor=C_MID, activetextoncolor=C_BG,
                      bordercolor=C_LINE, focusbordercolor=accent, fontname=F_HEAD, fontsize=size,
                      annotation=ann, annotation_name="Preset " + name)

    def on_click(btn, x, y):
        rb_ = pt.obj("route bang 1", x, y, ninl=2, nout=3)
        pt.connect(btn, 0, rb_, 0)
        t_ = pt.obj("t b", x, y + 30, ninl=1, nout=1, outtype=["bang"])
        pt.connect(rb_, 0, t_, 0)
        pt.connect(rb_, 1, t_, 0)
        return t_

    prev_b = small_btn("\u25c0", [px0, 61, 50, 15], "Preset precedente nella cartella (si carica subito).",
                       name="Prev", size=9.0)
    next_b = small_btn("\u25b6", [px0 + 54, 61, 50, 15], "Preset successivo nella cartella (si carica subito).",
                       name="Next", size=9.0)
    save_b = small_btn("SAVE", [px0, 84, 62, 15], "Salva il suono attuale nello slot User scelto qui accanto. "
                                                  "I preset User restano salvati nel progetto di Live.")
    slot = pt.add("live.numbox", [3400, 760, 38, 15], ninl=1, nout=2, outtype=["", "float"], parameter_enable=1,
                  presentation=1, presentation_rect=[float(px0 + 66), 84.0, 38.0, 15.0],
                  saved_attribute_attributes={"valueof": {
                      "parameter_longname": "Save Slot", "parameter_shortname": "Slot", "parameter_type": 1,
                      "parameter_mmin": 1.0, "parameter_mmax": float(NUSER), "parameter_initial_enable": 1,
                      "parameter_initial": [1], "parameter_invisible": 1, "parameter_unitstyle": 0}},
                  activebgcolor=C_MENU, bgcolor=C_MENU, textcolor=C_TEXT, activeslidercolor=C_AMBER,
                  tricolor=C_LOW, focusbordercolor=C_AMBER, bordercolor=C_LINE, fontname=F_TEXT, fontsize=9.5,
                  annotation="Slot User (1-8) dove SAVE salva il suono.", annotation_name="Save Slot")
    pt.connect(thisdev, 0, slot, 0)
    comment("user slot", [px0 + 66, 100, 40, 11], size=7.5, color=C_LOW)
    exp_b = small_btn("EXPORT", [px0, 114, 50, 14], "Salva i tuoi preset User su un file, per usarli in altri progetti.",
                      accent=C_TEAL)
    imp_b = small_btn("IMPORT", [px0 + 54, 114, 50, 14], "Carica i preset User da un file salvato con EXPORT.",
                      accent=C_TEAL)
    comment("%d sounds in %d folders" % (len(FACTORY), len(FOLDERS)), [px0, 136, 104, 12], size=7.5, color=C_LOW)
    comment("LOCK keeps sections", [px0, 149, 104, 12], size=7.5, color=C_LOW)

    store = pt.add("newobj", [3200, 1000, 300, 22], text="pattrstorage nebbia @savemode 0 @autorestore 0",
                   ninl=1, nout=5, outtype=["", "", "", "", ""], parameter_enable=1,
                   saved_attribute_attributes={"valueof": {
                       "parameter_longname": "User Presets", "parameter_shortname": "User Presets",
                       "parameter_type": 3, "parameter_invisible": 1}},
                   saved_object_attributes={"parameter_enable": 1, "parameter_mappable": 0,
                                            "client_rect": [4, 44, 358, 172], "storage_rect": [583, 69, 1034, 197]})
    pt.add("newobj", [3200, 1040, 80, 22], text="autopattr", ninl=1, nout=4, outtype=["", "", "", ""])

    # folder -> fill the preset list, set the global offset, and the Randomize characters on offer
    fsel = pt.obj("sel " + " ".join(str(i) for i in range(len(fnames))), 3200, 640, ninl=2, nout=len(fnames) + 1)
    pt.connect(fmenu, 0, fsel, 0)
    padd = pt.obj("+ 0", 3500, 640, ninl=2, nout=1)
    # position of the current preset in the folder, one copy per arrow (both always in sync)
    cur_prev = pt.obj("i", 3800, 640, ninl=2, nout=1, outtype=["int"])
    cur_next = pt.obj("i", 3900, 640, ninl=2, nout=1, outtype=["int"])
    tpick = pt.obj("t i i i", 3500, 610, ninl=1, nout=3, outtype=["int", "int", "int"])
    pt.connect(pumenu, 0, tpick, 0)
    pt.connect(tpick, 2, cur_prev, 1)
    pt.connect(tpick, 1, cur_next, 1)
    pt.connect(tpick, 0, padd, 0)
    step_prev = pt.obj("expr ($f1 + max($f2, 1) - 1) % max($f2, 1)", 3800, 690, ninl=2, nout=1)
    step_next = pt.obj("expr ($f1 + 1) % max($f2, 1)", 3900, 690, ninl=2, nout=1)
    pt.connect(cur_prev, 0, step_prev, 0)
    pt.connect(cur_next, 0, step_next, 0)
    first = 0
    for fi, fname in enumerate(fnames):
        items = [n for n, _ in FOLDERS[fi][1]] if fi < len(FOLDERS) else ["User %d" % (i + 1) for i in range(NUSER)]
        fill = pt.msg(", ".join(["clear"] + ["append %s" % n for n in items] + ["set 0"]), 3200 + fi * 120, 670)
        pt.connect(fsel, fi, fill, 0)
        pt.connect(fill, 0, pumenu, 0)
        off = pt.msg(str(first if fi < len(FOLDERS) else 1000), 3200 + fi * 120, 700)
        pt.connect(fsel, fi, off, 0)
        pt.connect(off, 0, padd, 1)
        size = pt.msg(str(len(items)), 3250 + fi * 120, 700)
        pt.connect(fsel, fi, size, 0)
        pt.connect(size, 0, step_next, 1)
        pt.connect(size, 0, step_prev, 1)
        zero = pt.msg("0", 3300 + fi * 120, 700)
        pt.connect(fsel, fi, zero, 0)
        pt.connect(zero, 0, cur_prev, 1)
        pt.connect(zero, 0, cur_next, 1)
        a_first, a_count = FOLDER_ARCH[fname]
        am1 = pt.msg(str(a_first), 3200 + fi * 120, 730)
        am2 = pt.msg(str(a_count), 3250 + fi * 120, 730)
        pt.connect(fsel, fi, am1, 0)
        pt.connect(fsel, fi, am2, 0)
        pt.connect(am1, 0, arnd, 1)
        pt.connect(am2, 0, arnd, 2)
        if fi < len(FOLDERS):
            first += len(FOLDERS[fi][1])
    # global preset number: factory 0..N-1, user 1000..1007
    pfac = pt.obj("split 0 %d" % (len(FACTORY) - 1), 3500, 670, ninl=3, nout=2)
    pt.connect(padd, 0, pfac, 0)
    fpick = pt.obj("sel " + " ".join(str(i) for i in range(len(FACTORY))), 3500, 700, ninl=2,
                   nout=len(FACTORY) + 1)
    pt.connect(pfac, 0, fpick, 0)
    puser = pt.obj("split 1000 %d" % (999 + NUSER), 3700, 700, ninl=3, nout=2)
    pt.connect(pfac, 1, puser, 0)
    usub = pt.obj("- 999", 3700, 730, ninl=2, nout=1)
    pt.connect(puser, 0, usub, 0)
    pt.connect(usub, 0, store, 0)
    # arrows: compute the neighbouring preset, load it, and move the menu's display to it
    for btn, curx, x in ((prev_b, cur_prev, 3800), (next_b, cur_next, 3900)):
        tb_ = on_click(btn, x, 560)
        pt.connect(tb_, 0, curx, 0)
    tstep = pt.obj("t i i i i", 3850, 720, ninl=1, nout=4, outtype=["int", "int", "int", "int"])
    pt.connect(step_prev, 0, tstep, 0)
    pt.connect(step_next, 0, tstep, 0)
    pt.connect(tstep, 3, cur_prev, 1)
    pt.connect(tstep, 2, cur_next, 1)
    pshow = pt.obj("prepend set", 3950, 750)
    pt.connect(tstep, 1, pshow, 0)
    pt.connect(pshow, 0, pumenu, 0)
    pt.connect(tstep, 0, padd, 0)
    # save -> store N, open the USER folder and show "User N" there (without recalling it)
    tsave = on_click(save_b, 4000, 600)
    sslot = pt.obj("i 1", 4000, 660, ninl=2, nout=1, outtype=["int"])
    pt.connect(slot, 0, sslot, 1)
    pt.connect(tsave, 0, sslot, 0)
    tss = pt.obj("t i b i", 4000, 690, ninl=1, nout=3, outtype=["int", "bang", "int"])
    pt.connect(sslot, 0, tss, 0)
    pstore = pt.obj("prepend store", 4000, 720)
    pt.connect(tss, 2, pstore, 0)
    pt.connect(pstore, 0, store, 0)
    ufold = pt.msg(str(len(fnames) - 1), 4100, 720)
    pt.connect(tss, 1, ufold, 0)
    pt.connect(ufold, 0, fmenu, 0)
    sdec = pt.obj("- 1", 4200, 720, ninl=2, nout=1)
    pt.connect(tss, 0, sdec, 0)
    sset = pt.obj("prepend set", 4200, 750)
    pt.connect(sdec, 0, sset, 0)
    pt.connect(sset, 0, pumenu, 0)
    pt.connect(sdec, 0, cur_prev, 1)
    pt.connect(sdec, 0, cur_next, 1)
    for btn, msgtxt, x in ((exp_b, "write", 4300), (imp_b, "read", 4400)):
        tb_ = on_click(btn, x, 600)
        mm = pt.msg(msgtxt, x, 660)
        pt.connect(tb_, 0, mm, 0)
        pt.connect(mm, 0, store, 0)

    # factory presets: one list per preset, sliced per lock group, through that group's lock, unpacked to controls
    groups = [(lk, secs) for lk, secs in lock_list] + [(None, ["DICE"])]
    gmembers = [[q for q in P if q["sec"] in secs and q["name"] not in PRESET_SKIP] for _, secs in groups]
    plist = pt.obj("t l", 3200, 1160, ninl=1, nout=1)
    for fi, (fname_, ov) in enumerate(FACTORY):
        vals = [fnum(ov.get(q["name"], q["default"])) for mem in gmembers for q in mem]
        mb = pt.msg(" ".join(vals), 5000 + (fi % 4) * 600, 1000 + (fi // 4) * 25)
        pt.connect(fpick, fi, mb, 0)
        pt.connect(mb, 0, plist, 0)
    rest = (plist, 0)  # where the not-yet-used part of the list comes out
    for gi, ((lk, secs), members) in enumerate(zip(groups, gmembers)):
        gx = 3200 + gi * 260
        if gi < len(groups) - 1:
            sl = pt.obj("zl slice %d" % len(members), gx, 1190, ninl=2, nout=2)
            pt.connect(rest[0], rest[1], sl, 0)
            part, rest = (sl, 0), (sl, 1)  # left: this group's values, right: everything after them
        else:
            part = rest
        if lk is not None:
            inv = pt.obj("== 0", gx, 1220, ninl=2, nout=1)
            pt.connect(lk, 0, inv, 0)
            dest = pt.obj("gate 1 1", gx, 1250, ninl=2, nout=1)
            pt.connect(inv, 0, dest, 0)
            pt.connect(part[0], part[1], dest, 1)
        else:
            dest = pt.obj("t l", gx, 1250, ninl=1, nout=1)
            pt.connect(part[0], part[1], dest, 0)
        unp = pt.obj("unpack " + " ".join(["0."] * len(members)), gx, 1300, ninl=1, nout=len(members),
                     outtype=["float"] * len(members), w=240)
        pt.connect(dest, 0, unp, 0)
        for j, q in enumerate(members):
            pt.connect(unp, j, ui_of[q["name"]], 0)

    # reset engine: button -> one gate per lock group -> default value of every parameter in that group
    rrb = pt.obj("route bang 1", 2300, 760, ninl=2, nout=3)
    pt.connect(reset_btn, 0, rrb, 0)
    rtb = pt.obj("t b", 2300, 790, ninl=1, nout=1, outtype=["bang"])
    pt.connect(rrb, 0, rtb, 0)
    pt.connect(rrb, 1, rtb, 0)
    gy = 2400
    for gi, (lk, secs) in enumerate(lock_list):
        inv = pt.obj("== 0", 40 + gi * 220, gy, ninl=2, nout=1)
        pt.connect(lk, 0, inv, 0)
        gt = pt.obj("gate 1 1", 40 + gi * 220, gy + 30, ninl=2, nout=1)
        pt.connect(inv, 0, gt, 0)
        pt.connect(rtb, 0, gt, 1)
        members = [q for q in P if q["sec"] in secs and q["name"] not in ("p_key", "p_reverbon")]
        for j, q in enumerate(members):
            mb = pt.msg(fnum(q["default"]), 40 + gi * 220 + (j % 3) * 70, gy + 70 + (j // 3) * 30)
            pt.connect(gt, 0, mb, 0)
            pt.connect(mb, 0, ui_of[q["name"]], 0)
    for j, q in enumerate([q for q in P if q["sec"] == "DICE"]):
        mb = pt.msg(fnum(q["default"]), 2300 + j * 70, 830)
        pt.connect(rtb, 0, mb, 0)
        pt.connect(mb, 0, ui_of[q["name"]], 0)
    mb = pt.msg("100", 2300 + 2 * 70, 830)
    pt.connect(rtb, 0, mb, 0)
    pt.connect(mb, 0, amount, 0)

    # ------------------------------------------------ fold engine
    # every section is a bpatcher (nb_NAME) with a narrow twin (nb_STRIP_NAME). Folding hides the section, shows
    # the strip, slides the sections on its right to the left and shrinks the device (live.thisdevice setwidth).
    names = [s[0] for s in SECTIONS]
    gw = {n: r - x + 12 for n, x, r, _ in SECTIONS}
    ns = len(names)
    tp = pt.obj("thispatcher", 4400, 900, ninl=1, nout=2)
    fpak = pt.obj("pak " + " ".join(["0"] * ns), 4400, 400, ninl=ns, nout=1, w=200)
    for si, n in enumerate(names):
        pt.connect(fold_tg[n], 0, fpak, si)
        tbs = pt.obj("t b", 4400 + si * 60, 300, ninl=1, nout=1, outtype=["bang"])
        pt.connect(strip_btn[n], 0, tbs, 0)
        z = pt.msg("0", 4400 + si * 60, 330)
        pt.connect(tbs, 0, z, 0)
        pt.connect(z, 0, fold_tg[n], 0)
    funp = pt.obj("unpack " + " ".join(["0"] * ns), 4400, 440, ninl=1, nout=ns, w=200)
    pt.connect(fpak, 0, funp, 0)
    x_of = {}
    for si, n in enumerate(names):
        bx = 4400 + si * 160
        gate = pt.obj("gate 2", bx, 560, ninl=2, nout=2)
        ctl = pt.obj("+ 1", bx, 530, ninl=2, nout=1)
        pt.connect(ctl, 0, gate, 0)
        if si == 0:
            t0 = pt.obj("t b f", bx, 480, ninl=1, nout=2, outtype=["bang", "float"])
            pt.connect(funp, 0, t0, 0)
            pt.connect(t0, 1, ctl, 0)
            x0 = pt.msg(str(SECTIONS[0][1] - 6), bx, 505)
            pt.connect(t0, 0, x0, 0)
            pt.connect(x0, 0, gate, 1)
        else:
            pt.connect(funp, si, ctl, 0)
            terms = " + ".join("(%d - $f%d * %d)" % (gw[names[j]] + GAP, j + 1, gw[names[j]] - FOLDW)
                               for j in range(si))
            ex = pt.obj("expr %d + %s" % (SECTIONS[0][1] - 6, terms), bx, 505, ninl=si, nout=1, w=150)
            for j in range(si):
                pt.connect(funp, j, ex, j)
            pt.connect(ex, 0, gate, 1)
            x_of[n] = ex
        op = pt.msg("script hide nb_STRIP_%s, script show nb_%s, script sendbox nb_%s presentation_rect $1 0 %d 169"
                    % (n, n, n, gw[n]), bx, 600)
        fo = pt.msg("script hide nb_%s, script show nb_STRIP_%s, script sendbox nb_STRIP_%s presentation_rect "
                    "$1 0 %d 169" % (n, n, n, FOLDW), bx, 630)
        pt.connect(gate, 0, op, 0)
        pt.connect(gate, 1, fo, 0)
        pt.connect(op, 0, tp, 0)
        pt.connect(fo, 0, tp, 0)
    last = names[-1]
    tot = pt.obj("expr $f1 + $f2 * %d + (1 - $f2) * %d + %d" % (FOLDW, gw[last], GAP), 4400, 700, ninl=2, nout=1)
    pt.connect(x_of[last], 0, tot, 0)
    pt.connect(funp, ns - 1, tot, 1)
    sw = pt.obj("prepend setwidth", 4400, 730)
    pt.connect(tot, 0, sw, 0)
    pt.connect(sw, 0, thisdev, 0)
    rdel = pt.obj("delay 300", 4600, 400, ninl=2, nout=1, outtype=["bang"])
    pt.connect(thisdev, 0, rdel, 0)
    pt.connect(rdel, 0, fpak, 0)

    groups_x = [(n, x - 6, r + 6) for n, x, r, _ in SECTIONS]
    main_boxes, main_lines = split_into_bpatchers(pt, groups_x)

    patcher = {
        "fileversion": 1, "appversion": APPVERSION, "classnamespace": "box",
        "rect": [60.0, 80.0, 1600.0, 1300.0], "openrect": [0.0, 0.0, 0.0, 169.0], "bglocked": 0,
        "openinpresentation": 1, "default_fontsize": 10.0, "default_fontface": 0,
        "default_fontname": "Arial Bold", "gridonopen": 1, "gridsize": [8.0, 8.0], "gridsnaponopen": 1,
        "objectsnaponopen": 0, "statusbarvisible": 2, "toolbarvisible": 1, "lefttoolbarpinned": 0,
        "toptoolbarpinned": 0, "righttoolbarpinned": 0, "bottomtoolbarpinned": 0,
        "toolbars_unpinned_last_save": 0, "tallnewobj": 0, "boxanimatetime": 500, "enablehscroll": 1,
        "enablevscroll": 1, "devicewidth": float(DEVICE_W),
        "description": "NEBBIA - living chord engine: one key, a voice-led chord, analog-behaving voices, "
                       "dub tape echo and a space that retunes to the chord.",
        "digest": "Living chord engine for dub techno", "tags": "", "style": "", "subpatcher_template": "",
        "assistshowspatchername": 0, "boxes": main_boxes, "lines": main_lines, "dependency_cache": [],
        "latency": 0, "is_mpe": 0, "minimum_live_version": "", "minimum_max_version": "",
        "platform_compatibility": 0, "autosave": 0,
    }
    return {"patcher": patcher}


def write_web_presets(path):
    """Everything the web player needs besides the engine: controls, folders and presets, randomize data."""
    data = {
        "params": [{k: p[k] for k in ("name", "long", "short", "kind", "lo", "hi", "default", "unit", "exp", "sec",
                                      "enum")} for p in P],
        "folders": [{"name": f, "presets": [{"name": n, "values": ov} for n, ov in lst]} for f, lst in FOLDERS],
        "skip": list(PRESET_SKIP),
        "rand": RAND, "archetypes": [{"name": n, "ranges": r, "on": o} for n, r, o in ARCHETYPES],
        "folderArch": FOLDER_ARCH, "sonDens": SON_DENS, "darkChords": DARK_CHORDS,
        "chords": [c[0] for c in CHORDS], "maxOn": MAXON,
    }
    with open(path, "w") as f:
        json.dump(data, f, separators=(",", ":"))


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
    os.makedirs(os.path.join(ROOT, "web"), exist_ok=True)
    wjs, nh, nk = to_web_js(functions, body, hist, delays, "worklet")
    with open(os.path.join(ROOT, "web", "engine.js"), "w") as f:
        f.write(wjs)
    with open(os.path.join(ROOT, "test", "nebbia_web_node.js"), "w") as f:
        f.write(to_web_js(functions, body, hist, delays, "node")[0])
    write_web_presets(os.path.join(ROOT, "web", "presets.json"))
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
