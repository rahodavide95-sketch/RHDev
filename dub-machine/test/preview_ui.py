"""Draws an approximate SVG/HTML preview of the device panel from Dub Machine.maxpat (presentation view).
Usage: python3 test/preview_ui.py out.html [FOLDED,SECTIONS] [dark|light]   (then screenshot it with any browser)
The optional second argument replays the fold engine: those sections are drawn as narrow strips.
The third one picks the Live theme to emulate. The device takes every color from the Live theme, so the preview
resolves the themecolor bindings (and the default colors of Live controls) with an approximation of Live's
Dark or Light theme: close, not exact."""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
d = json.load(open(os.path.join(HERE, "..", "Dub Machine.maxpat")))["patcher"]
W, H = int(d["devicewidth"]), 169
folded = set(sys.argv[2].split(",")) if len(sys.argv) > 2 and sys.argv[2] else set()
THEMES = {  # approximations of Live's default Dark and Light themes
    "dark": {"live_surface_bg": "#2E2E2E", "live_lcd_bg": "#1A1A1A", "live_lcd_frame": "#4C4C4C",
             "live_control_fg": "#B8B8B8", "live_control_fg_off": "#767676", "live_lcd_control_fg": "#D4D4D4",
             "live_value_arc": "#3FC1D6", "live_led_bg": "#3B3B3B", "ctl_bg": "#3E3E3E", "ctl_on": "#FFB532",
             "ctl_text": "#B8B8B8", "ctl_text_on": "#161616", "ctl_border": "#575757", "dial_off": "#4D4D4D"},
    "light": {"live_surface_bg": "#C9C9C9", "live_lcd_bg": "#EAEAEA", "live_lcd_frame": "#8E8E8E",
              "live_control_fg": "#1E1E1E", "live_control_fg_off": "#6C6C6C", "live_lcd_control_fg": "#1E1E1E",
              "live_value_arc": "#0B7FC4", "live_led_bg": "#A6A6A6", "ctl_bg": "#DADADA", "ctl_on": "#FFA31A",
              "ctl_text": "#1E1E1E", "ctl_text_on": "#111111", "ctl_border": "#8C8C8C", "dial_off": "#9E9E9E"},
}
TH = THEMES[sys.argv[3] if len(sys.argv) > 3 else "dark"]
# colors Max for Live gives Live controls that carry none of their own (they follow the theme)
LIVE_DEFAULTS = {"dialcolor": "dial_off", "activedialcolor": "live_value_arc", "activeneedlecolor": "live_control_fg",
                 "textcolor": "ctl_text", "activebgcolor": "ctl_bg", "activebgoncolor": "ctl_on",
                 "activetextcolor": "ctl_text", "activetextoncolor": "ctl_text_on", "bordercolor": "ctl_border",
                 "activetricolor": "ctl_text"}
# replay the fold engine: section bpatchers in order, folded ones replaced by their strip
bps = {b["box"]["varname"]: b["box"] for b in d["boxes"] if b["box"]["maxclass"] == "bpatcher"}
order = sorted((b for n, b in bps.items() if not n.startswith("nb_STRIP_")), key=lambda b: b["presentation_rect"][0])
layout, x = [], order[0]["presentation_rect"][0]
for b in order:
    name = b["varname"][3:]
    if name in folded:
        layout.append((bps["nb_STRIP_" + name], x))
        x += bps["nb_STRIP_" + name]["presentation_rect"][2] + 4
    else:
        layout.append((b, x))
        x += b["presentation_rect"][2] + 4
W = int(x) if folded else W
flat = [bb for bb in d["boxes"] if bb["box"]["maxclass"] != "bpatcher"]
for b, x0 in layout:
    for bb in b["patcher"]["boxes"]:
        bx = dict(bb["box"])
        if bx.get("presentation"):
            r = bx["presentation_rect"]
            bx["presentation_rect"] = [r[0] + x0, r[1], r[2], r[3]]
        flat.append({"box": bx})
all_boxes = flat
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def col(c):
    return "rgba(%d,%d,%d,%.2f)" % (c[0] * 255, c[1] * 255, c[2] * 255, c[3])


def c(b, attr):
    """the color an attribute shows: its Live theme binding, its own value, or the Live control default"""
    expr = b.get("saved_attribute_attributes", {}).get(attr, {}).get("expression")
    if expr:
        return TH[expr.replace("themecolor.", "")]
    if attr in b:
        return col(b[attr])
    return TH[LIVE_DEFAULTS[attr]]


els = []
for x in all_boxes:
    b = x["box"]
    if not b.get("presentation"):
        continue
    X, Y, w, h = b["presentation_rect"]
    mc = b["maxclass"]
    vo = b.get("saved_attribute_attributes", {}).get("valueof", {})
    if mc == "panel":
        stroke = ' stroke="%s"' % c(b, "bordercolor") if b.get("border") else ""
        els.append('<rect x="%s" y="%s" width="%s" height="%s" rx="%s" fill="%s"%s/>'
                   % (X + 0.5, Y + 0.5, w - 1, h - 1, b.get("rounded", 0), c(b, "bgcolor"), stroke))
    elif mc == "comment" and b["text"] and b.get("textjustification") == 1:  # letter of a folded strip's name
        els.append('<text x="%s" y="%s" font-size="%s" font-weight="700" text-anchor="middle" fill="%s" '
                   'font-family="Inter,Arial">%s</text>' % (X + w / 2, Y + 11, b["fontsize"], c(b, "textcolor"),
                                                           b["text"]))
    elif mc == "live.comment":
        bold = "Bold" in b["fontname"]
        els.append('<text x="%s" y="%s" font-size="%s" font-weight="%s" fill="%s" font-family="Inter,Arial" '
                   'letter-spacing="%s">%s</text>' % (X + 2, Y + h - 3, b["fontsize"] + 0.5, 700 if bold else 500,
                                                      c(b, "textcolor"), 0.8 if bold else 0, b["text"]))
    elif mc == "live.dial":
        lo, hi, v = vo["parameter_mmin"], vo["parameter_mmax"], vo["parameter_initial"][0]
        t = ((v - lo) / (hi - lo)) ** (1 / vo.get("parameter_exponent", 1)) if hi > lo else 0
        cx, cy, r = X + w / 2, Y + (h / 2 if b.get("showname") == 0 else 26), 11 if h >= 44 else 9
        a0, a1, ae = math.radians(135), math.radians(135 + 270 * t), math.radians(405)

        def pt(a):
            return cx + r * math.cos(a), cy + r * math.sin(a)

        def arc(aa, bb, c):
            x1, y1 = pt(aa)
            x2, y2 = pt(bb)
            return ('<path d="M%.1f,%.1f A%s,%s 0 %d 1 %.1f,%.1f" stroke="%s" stroke-width="3" fill="none" '
                    'stroke-linecap="round"/>' % (x1, y1, r, r, 1 if bb - aa > math.pi else 0, x2, y2, c))

        els.append(arc(a0, ae, c(b, "dialcolor")))
        if t > 0.001:
            els.append(arc(a0, a1, c(b, "activedialcolor")))
        nx, ny = pt(a1)
        els.append('<line x1="%s" y1="%s" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="1.5"/>'
                   % (cx, cy, nx, ny, c(b, "activeneedlecolor")))
        unit = {2: " ms", 3: " Hz", 4: " dB", 5: " %"}.get(vo.get("parameter_unitstyle"), "")
        val = ("%g" % round(v, 2)) + unit
        if vo.get("parameter_unitstyle") == 8:
            val = "%s%d" % (NAMES[int(v) % 12], int(v) // 12 - 2)
        if vo.get("parameter_unitstyle") == 7:
            val = ("%+d st" % int(v)) if int(v) else "0 st"
        rows = [(Y + h - 1, val)] if b.get("showname") == 0 else [(Y + 9, vo["parameter_shortname"]), (Y + h - 1, val)]
        for yy, txt in rows:
            els.append('<text x="%s" y="%s" font-size="8.5" text-anchor="middle" fill="%s" '
                       'font-family="Inter,Arial">%s</text>' % (cx, yy, c(b, "textcolor"), txt))
    elif mc == "umenu":
        first = None
        for bb in all_boxes:
            t = bb["box"].get("text", "")
            if bb["box"]["maxclass"] == "message" and t.startswith("clear, append "):
                first = t.split(", ")[1][len("append "):]
                break
        els.append('<rect x="%s" y="%s" width="%s" height="%s" rx="2" fill="%s"/>' % (X, Y, w, h, c(b, "bgcolor")))
        els.append('<text x="%s" y="%s" font-size="9.5" fill="%s" font-family="Inter,Arial">%s</text>'
                   % (X + 4, Y + h - 5, c(b, "textcolor"), first or ""))
        els.append('<path d="M%s,%s l5,0 l-2.5,4 z" fill="%s"/>' % (X + w - 9, Y + 7, c(b, "color")))
    elif mc == "live.menu":
        els.append('<rect x="%s" y="%s" width="%s" height="%s" rx="2" fill="%s"/>'
                   % (X, Y, w, h, c(b, "activebgcolor")))
        els.append('<text x="%s" y="%s" font-size="9" fill="%s" font-family="Inter,Arial">%s</text>'
                   % (X + 4, Y + h - 4, c(b, "textcolor"), vo["parameter_enum"][int(vo["parameter_initial"][0])]))
        els.append('<path d="M%s,%s l5,0 l-2.5,4 z" fill="%s"/>' % (X + w - 9, Y + 6, c(b, "activetricolor")))
    elif mc == "live.text":
        on = vo.get("parameter_initial", [0])[0] == 1 and b.get("mode") == 1
        bg = c(b, "activebgoncolor") if on else c(b, "activebgcolor")
        tc = c(b, "activetextoncolor") if on else c(b, "activetextcolor")
        els.append('<rect x="%s" y="%s" width="%s" height="%s" rx="2" fill="%s" stroke="%s"/>'
                   % (X, Y, w, h, bg, c(b, "bordercolor")))
        els.append('<text x="%s" y="%s" font-size="%s" text-anchor="middle" fill="%s" font-family="Inter,Arial" '
                   'font-weight="600">%s</text>' % (X + w / 2, Y + h / 2 + 3.5, b["fontsize"], tc,
                                                    b["texton"] if on else b["text"]))
    elif mc == "live.numbox":
        v = int(vo["parameter_initial"][0])
        els.append('<rect x="%s" y="%s" width="%s" height="%s" rx="2" fill="%s"/>'
                   % (X, Y, w, h, c(b, "activebgcolor")))
        els.append('<text x="%s" y="%s" font-size="10" text-anchor="middle" fill="%s" font-family="Inter,Arial">'
                   '%s</text>' % (X + w / 2, Y + h - 5, c(b, "textcolor"),
                                  ("%s%d" % (NAMES[v % 12], v // 12 - 2)) if vo.get("parameter_unitstyle") == 8 else v))
    elif mc == "led":
        els.append('<circle cx="%s" cy="%s" r="%s" fill="%s"/>' % (X + w / 2, Y + h / 2, w / 2 - 1, c(b, "offcolor")))
    elif mc == "kslider":
        nw = 21
        ww = w / nw
        lit = {5, 7, 9, 11, 13}  # example chord (A2 C3 E3 G3 B3 on a C1-based view)
        for i in range(nw):
            els.append('<rect x="%.1f" y="%s" width="%.1f" height="%s" fill="%s"/>'
                       % (X + i * ww, Y, ww - 0.6, h, c(b, "hkeycolor") if i in lit else c(b, "whitekeycolor")))
        for o in range(3):
            for k in (0, 1, 3, 4, 5):
                els.append('<rect x="%.1f" y="%s" width="%.1f" height="%s" fill="%s"/>'
                           % (X + (o * 7 + k + 0.65) * ww, Y, ww * 0.6, h * 0.6, c(b, "blackkeycolor")))
svg = '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d">%s</svg>' % (W, H, "".join(els))
out = sys.argv[1] if len(sys.argv) > 1 else "ui_preview.html"
open(out, "w").write('<html><body style="margin:0;background:%s">%s</body></html>' % (TH["live_surface_bg"], svg))
print("wrote", out, W, "x", H)
