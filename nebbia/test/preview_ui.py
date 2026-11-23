"""Draws an approximate SVG/HTML preview of the device panel from Nebbia.maxpat (presentation view).
Usage: python3 test/preview_ui.py out.html   (then screenshot it with any browser)"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
d = json.load(open(os.path.join(HERE, "..", "Nebbia.maxpat")))["patcher"]
W, H = int(d["devicewidth"]), 169
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def col(c):
    return "rgba(%d,%d,%d,%.2f)" % (c[0] * 255, c[1] * 255, c[2] * 255, c[3])


els = []
for x in d["boxes"]:
    b = x["box"]
    if not b.get("presentation"):
        continue
    X, Y, w, h = b["presentation_rect"]
    mc = b["maxclass"]
    vo = b.get("saved_attribute_attributes", {}).get("valueof", {})
    if mc == "panel":
        els.append('<rect x="%s" y="%s" width="%s" height="%s" rx="%s" fill="%s"/>'
                   % (X, Y, w, h, b.get("rounded", 0), col(b["bgcolor"])))
    elif mc == "live.comment":
        bold = "Bold" in b["fontname"]
        els.append('<text x="%s" y="%s" font-size="%s" font-weight="%s" fill="%s" font-family="Inter,Arial" '
                   'letter-spacing="%s">%s</text>' % (X + 2, Y + h - 3, b["fontsize"] + 0.5, 700 if bold else 500,
                                                      col(b["textcolor"]), 0.8 if bold else 0, b["text"]))
    elif mc == "live.dial":
        lo, hi, v = vo["parameter_mmin"], vo["parameter_mmax"], vo["parameter_initial"][0]
        t = ((v - lo) / (hi - lo)) ** (1 / vo.get("parameter_exponent", 1)) if hi > lo else 0
        cx, cy, r = X + w / 2, Y + 26, 11
        a0, a1, ae = math.radians(135), math.radians(135 + 270 * t), math.radians(405)

        def pt(a):
            return cx + r * math.cos(a), cy + r * math.sin(a)

        def arc(aa, bb, c):
            x1, y1 = pt(aa)
            x2, y2 = pt(bb)
            return ('<path d="M%.1f,%.1f A%s,%s 0 %d 1 %.1f,%.1f" stroke="%s" stroke-width="3" fill="none" '
                    'stroke-linecap="round"/>' % (x1, y1, r, r, 1 if bb - aa > math.pi else 0, x2, y2, c))

        els.append(arc(a0, ae, col(b["dialcolor"])))
        if t > 0.001:
            els.append(arc(a0, a1, col(b["activedialcolor"])))
        nx, ny = pt(a1)
        els.append('<line x1="%s" y1="%s" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="1.5"/>'
                   % (cx, cy, nx, ny, col(b["activeneedlecolor"])))
        unit = {2: " ms", 3: " Hz", 4: " dB", 5: " %"}.get(vo.get("parameter_unitstyle"), "")
        val = ("%g" % round(v, 2)) + unit
        if vo.get("parameter_unitstyle") == 8:
            val = "%s%d" % (NAMES[int(v) % 12], int(v) // 12 - 2)
        for yy, txt in [(Y + 9, vo["parameter_shortname"]), (Y + 47, val)]:
            els.append('<text x="%s" y="%s" font-size="8.5" text-anchor="middle" fill="%s" '
                       'font-family="Inter,Arial">%s</text>' % (cx, yy, col(b["textcolor"]), txt))
    elif mc == "live.menu":
        els.append('<rect x="%s" y="%s" width="%s" height="%s" rx="2" fill="%s"/>'
                   % (X, Y, w, h, col(b["activebgcolor"])))
        els.append('<text x="%s" y="%s" font-size="9" fill="%s" font-family="Inter,Arial">%s</text>'
                   % (X + 4, Y + h - 4, col(b["textcolor"]), vo["parameter_enum"][int(vo["parameter_initial"][0])]))
        els.append('<path d="M%s,%s l5,0 l-2.5,4 z" fill="%s"/>' % (X + w - 9, Y + 6, col(b["activetricolor"])))
    elif mc == "live.text":
        on = vo.get("parameter_initial", [0])[0] == 1 and b.get("mode") == 1
        bg = b["activebgoncolor"] if on else b["activebgcolor"]
        tc = b["activetextoncolor"] if on else b["activetextcolor"]
        els.append('<rect x="%s" y="%s" width="%s" height="%s" rx="2" fill="%s" stroke="%s"/>'
                   % (X, Y, w, h, col(bg), col(b["bordercolor"])))
        els.append('<text x="%s" y="%s" font-size="%s" text-anchor="middle" fill="%s" font-family="Inter,Arial" '
                   'font-weight="600">%s</text>' % (X + w / 2, Y + h / 2 + 3.5, b["fontsize"], col(tc),
                                                    b["texton"] if on else b["text"]))
    elif mc == "live.numbox":
        v = int(vo["parameter_initial"][0])
        els.append('<rect x="%s" y="%s" width="%s" height="%s" rx="2" fill="%s"/>'
                   % (X, Y, w, h, col(b["activebgcolor"])))
        els.append('<text x="%s" y="%s" font-size="10" text-anchor="middle" fill="%s" font-family="Inter,Arial">'
                   '%s</text>' % (X + w / 2, Y + h - 5, col(b["textcolor"]),
                                  ("%s%d" % (NAMES[v % 12], v // 12 - 2)) if vo.get("parameter_unitstyle") == 8 else v))
    elif mc == "led":
        els.append('<circle cx="%s" cy="%s" r="%s" fill="%s"/>' % (X + w / 2, Y + h / 2, w / 2 - 1, col(b["offcolor"])))
    elif mc == "kslider":
        nw = 21
        ww = w / nw
        lit = {5, 7, 9, 11, 13}  # example chord (A2 C3 E3 G3 B3 on a C1-based view)
        for i in range(nw):
            els.append('<rect x="%.1f" y="%s" width="%.1f" height="%s" fill="%s"/>'
                       % (X + i * ww, Y, ww - 0.6, h, col(b["hkeycolor"] if i in lit else b["whitekeycolor"])))
        for o in range(3):
            for k in (0, 1, 3, 4, 5):
                els.append('<rect x="%.1f" y="%s" width="%.1f" height="%s" fill="%s"/>'
                           % (X + (o * 7 + k + 0.65) * ww, Y, ww * 0.6, h * 0.6, col(b["blackkeycolor"])))
svg = '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d">%s</svg>' % (W, H, "".join(els))
out = sys.argv[1] if len(sys.argv) > 1 else "ui_preview.html"
open(out, "w").write('<html><body style="margin:0;background:#000">%s</body></html>' % svg)
print("wrote", out, W, "x", H)
