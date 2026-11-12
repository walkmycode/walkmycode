"""WalkMyCode brand kit: SVG sources (lettering as outlines, so they render anywhere, GitHub included) and PNG exports.
Run from this folder:  python build_brand.py
Needs: fonttools, brotli, Pillow, Google Chrome (for PNG export).
"""
import io, math, pathlib, subprocess
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.varLib import instancer

HERE = pathlib.Path(__file__).parent
OUT = HERE.parent
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

# ── tokens (from the app's globals.css) ───────────────────────────────────────
WALL, RAISED, PANEL, PANEL2, LINE = "#23201c", "#2d2924", "#2e2a25", "#3a352e", "#4a443c"
GLOW, INK = "#f3d77a", "#2a2112"
BOARD, BOARD2, WOOD, WOOD2 = "#1f3a31", "#244437", "#6b4a2b", "#4d3420"
CHALK, DIM = "#f1efe6", "#b8ae9c"
LANES = [("pages", "#9fd3f0"), ("api", "#f3d77a"), ("logic", "#e0c9a6"), ("data", "#a8e0a0"), ("services", "#f2a7a0")]

# ── fonts → outlines ──────────────────────────────────────────────────────────
_fonts = {}
def font(name, wght):
    key = (name, wght)
    if key not in _fonts:
        f = TTFont(HERE / "fonts" / f"{name}-{wght}.woff2")
        if "fvar" in f:
            f = instancer.instantiateVariableFont(f, {"wght": wght})
        _fonts[key] = f
    return _fonts[key]

def text_path(txt, name, wght, size, x, y, anchor="start", tracking=0.0):
    """Returns (svg path d, width). (x, y) is the baseline origin."""
    f = font(name, wght); gs = f.getGlyphSet(); cmap = f.getBestCmap(); upm = f["head"].unitsPerEm
    s = size / upm
    hmtx = f["hmtx"]
    names = [cmap.get(ord(c), ".notdef") for c in txt]
    adv = [hmtx[n][0] * s + tracking * size for n in names]
    width = sum(adv) - (tracking * size if names else 0)
    x0 = x - (width if anchor == "end" else width / 2 if anchor == "middle" else 0)
    d = []; cx = x0
    for n, a in zip(names, adv):
        pen = SVGPathPen(gs)
        gs[n].draw(TransformPen(pen, (s, 0, 0, -s, cx, y)))
        d.append(pen.getCommands()); cx += a
    return " ".join(d), width

def T(txt, name, wght, size, x, y, fill, anchor="start", tracking=0.0, extra=""):
    d, w = text_path(txt, name, wght, size, x, y, anchor, tracking)
    return f'<path d="{d}" fill="{fill}" {extra}/>', w

# ── motifs ────────────────────────────────────────────────────────────────────
def glow_defs(uid):
    return f'''<radialGradient id="halo{uid}"><stop offset="0" stop-color="{GLOW}" stop-opacity=".55"/><stop offset=".35" stop-color="{GLOW}" stop-opacity=".18"/><stop offset="1" stop-color="{GLOW}" stop-opacity="0"/></radialGradient>
<radialGradient id="core{uid}" cx=".4" cy=".38" r=".7"><stop offset="0" stop-color="#fff6cf"/><stop offset=".55" stop-color="{GLOW}"/><stop offset="1" stop-color="#e2bd4f"/></radialGradient>'''

def light(uid, cx, cy, r, halo=4.2):
    return f'<circle cx="{cx}" cy="{cy}" r="{r*halo}" fill="url(#halo{uid})"/><circle cx="{cx}" cy="{cy}" r="{r}" fill="url(#core{uid})"/>'

def lanes(x, y, w, h, cards=(5, 7, 4, 6, 3), gap=None, card_h=None, opacity=1.0, rx=None):
    """Five columns of little cards: the map. Returns svg and each lane's card centres."""
    n = 5; gap = gap if gap is not None else w * .05
    cw = (w - gap * (n - 1)) / n
    card_h = card_h or h / 9; rx = rx if rx is not None else card_h * .28
    out, centres = [], []
    for i, ((_, col), k) in enumerate(zip(LANES, cards)):
        lx = x + i * (cw + gap); cs = []
        for j in range(k):
            cy = y + j * (card_h * 1.32)
            if cy + card_h > y + h: break
            out.append(f'<rect x="{lx:.1f}" y="{cy:.1f}" width="{cw:.1f}" height="{card_h:.1f}" rx="{rx:.1f}" fill="{col}" opacity="{opacity * (0.9 - j * 0.07):.2f}"/>')
            cs.append((lx + cw / 2, cy + card_h / 2))
        centres.append(cs)
    return "".join(out), centres, cw

def svg(w, h, body, defs=""):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}"><defs>{defs}</defs>{body}</svg>'

def wall(w, h, uid):
    return (f'<radialGradient id="wall{uid}" cx=".5" cy=".42" r=".75"><stop offset="0" stop-color="{RAISED}"/><stop offset="1" stop-color="{WALL}"/></radialGradient>',
            f'<rect width="{w}" height="{h}" fill="url(#wall{uid})"/>')

# ── pieces ────────────────────────────────────────────────────────────────────
def mark(size=1000, bg=True):
    """Avatar / app mark: lanes below, a dashed arrow up to the light."""
    s = size / 1000; uid = "m"
    defs = glow_defs(uid)
    body = ""
    if bg:
        wd, wb = wall(size, size, uid); defs += wd; body += wb
    ln, centres, cw = lanes(220 * s, 560 * s, 560 * s, 300 * s, cards=(3, 4, 2, 3, 2), card_h=46 * s, gap=26 * s)
    start = centres[1][0]
    body += ln
    body += f'<path d="M{start[0]:.1f} {start[1] - 30*s:.1f} C {start[0]:.1f} {420*s:.1f}, {500*s:.1f} {470*s:.1f}, {500*s:.1f} {390*s:.1f}" fill="none" stroke="{GLOW}" stroke-width="{12*s}" stroke-dasharray="{2*s} {26*s}" stroke-linecap="round" opacity=".85"/>'
    body += light(uid, 500 * s, 330 * s, 92 * s, 3.4)
    return svg(size, size, body, defs)

def wordmark(height=200, dark_bg=False):
    """'WalkMyCode' in Caveat with the light above the end, like the app's logo."""
    size = height * .78; uid = "w"
    p, w = T("WalkMyCode", "Caveat", 700, size, 10, height * .78, CHALK)
    W = w + size * .55
    body = ""; defs = glow_defs(uid)
    if dark_bg: body += f'<rect width="{W:.0f}" height="{height}" rx="{height*.12}" fill="{WALL}"/>'
    body += p + light(uid, 10 + w + size * .2, height * .2, size * .075, 3.6)
    return svg(round(W), height, body, defs)

def social(w=1280, h=640):
    """Repo social preview."""
    uid = "s"; defs = glow_defs(uid); wd, wb = wall(w, h, uid); defs += wd
    board = f'<rect x="40" y="40" width="{w-80}" height="{h-80}" rx="26" fill="{BOARD}" stroke="{WOOD}" stroke-width="14"/><rect x="47" y="47" width="{w-94}" height="{h-94}" rx="20" fill="none" stroke="{WOOD2}" stroke-width="3"/>'
    chalk_tex = "".join(f'<circle cx="{(i*97)%w}" cy="{(i*53)%h}" r="1.2" fill="{CHALK}" opacity=".05"/>' for i in range(220))
    title, tw = T("WalkMyCode", "Caveat", 700, 150, 110, 250, CHALK)
    tag1, _ = T("Find your way around", "Caveat", 700, 58, 112, 345, CHALK, extra='opacity=".92"')
    tag2, t2w = T("the code you generated.", "Caveat", 700, 58, 112, 410, CHALK, extra='opacity=".92"')
    under = f'<path d="M112 432 C 220 420, 340 440, 460 428 S 620 424, {112 + t2w:.0f} 432" fill="none" stroke="{GLOW}" stroke-width="5" stroke-linecap="round"/>'
    sub, _ = T("A map of every page, route and table · guided tours · a voice that explains", "Inter", 500, 22, 112, 500, DIM)
    ln, centres, cw = lanes(860, 150, 320, 330, cards=(5, 6, 4, 5, 3), card_h=34, gap=14)
    a, b = centres[0][1], centres[3][2]
    path = f'M{a[0]+cw/2:.0f} {a[1]:.0f} C {a[0]+90:.0f} {a[1]-60:.0f}, {b[0]-90:.0f} {b[1]+70:.0f}, {b[0]-cw/2:.0f} {b[1]:.0f}'
    body = wb + board + chalk_tex + ln + f'<path d="{path}" fill="none" stroke="{GLOW}" stroke-width="4" stroke-dasharray="2 12" stroke-linecap="round"/>' \
        + light(uid, b[0] - cw / 2 - 2, b[1], 13, 4.5) + title + light(uid, 110 + tw + 22, 150, 12, 4) + tag1 + tag2 + under + sub
    return svg(w, h, body, defs)

def banner(w=1600, h=400):
    """README header."""
    uid = "b"; defs = glow_defs(uid); wd, wb = wall(w, h, uid); defs += wd
    title, tw = T("WalkMyCode", "Caveat", 700, 132, 90, 200, CHALK)
    tag, _ = T("Find your way around the code you generated.", "Caveat", 700, 48, 94, 280, CHALK, extra='opacity=".9"')
    sub, _ = T("Map · Trace it · Guided tours · Voice lecturer · Fly-through", "Inter", 500, 21, 96, 330, DIM, tracking=.01)
    ln, centres, cw = lanes(1040, 70, 460, 270, cards=(5, 6, 4, 5, 3), card_h=30, gap=16)
    a, b = centres[0][2], centres[4][1]
    path = f'M{a[0]+cw/2:.0f} {a[1]:.0f} C {a[0]+160:.0f} {a[1]+70:.0f}, {b[0]-160:.0f} {b[1]-70:.0f}, {b[0]-cw/2:.0f} {b[1]:.0f}'
    body = wb + ln + f'<path d="{path}" fill="none" stroke="{GLOW}" stroke-width="4" stroke-dasharray="2 12" stroke-linecap="round"/>' \
        + light(uid, b[0] - cw / 2 - 2, b[1], 12, 4.5) + title + light(uid, 90 + tw + 28, 82, 13, 4) + tag + sub \
        + f'<rect x="0" y="{h-4}" width="{w}" height="4" fill="{GLOW}" opacity=".5"/>'
    return svg(w, h, body, defs)

def favicon(size):
    """At 16–32 px only the light and the lanes survive."""
    uid = "f"; s = size / 64
    defs = glow_defs(uid)
    body = f'<rect width="{size}" height="{size}" rx="{14*s}" fill="{WALL}"/>'
    for i, (_, col) in enumerate(LANES):
        body += f'<rect x="{(9 + i*10)*s:.2f}" y="{44*s:.2f}" width="{7*s:.2f}" height="{12*s:.2f}" rx="{2*s:.2f}" fill="{col}"/>'
    body += light(uid, 32 * s, 24 * s, 9 * s, 2.4)
    return svg(size, size, body, defs)

# ── export ────────────────────────────────────────────────────────────────────
def png(svg_path, out_path, w, h):
    html = HERE / "_render.html"
    html.write_text(f'<!doctype html><html><body style="margin:0;background:transparent"><img src="{svg_path.as_uri()}" width="{w}" height="{h}" style="display:block"></body></html>', encoding="utf-8")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000",
                    f"--window-size={w},{h}", f"--screenshot={out_path}", html.as_uri()], check=True, capture_output=True)
    html.unlink()

def save(name, content, exports):
    p = OUT / f"{name}.svg"; p.write_text(content, encoding="utf-8")
    for fname, w, h in exports: png(p, OUT / fname, w, h)
    print(name, "+", ", ".join(e[0] for e in exports))

if __name__ == "__main__":
    save("walkmycode-mark", mark(1000), [("walkmycode-avatar-1000.png", 1000, 1000), ("walkmycode-avatar-500.png", 500, 500)])
    save("walkmycode-mark-transparent", mark(1000, bg=False), [])
    wm = wordmark(200); W = int(wm.split('width="')[1].split('"')[0])
    save("walkmycode-wordmark", wm, [])          # transparent, chalk lettering: for dark backgrounds
    save("walkmycode-wordmark-on-dark", wordmark(200, dark_bg=True), [("walkmycode-wordmark-on-dark.png", W, 200)])
    save("walkmycode-social-preview", social(), [("walkmycode-social-preview.png", 1280, 640)])
    save("walkmycode-readme-banner", banner(), [("walkmycode-readme-banner.png", 1600, 400)])
    save("favicon", favicon(64), [("favicon-16.png", 16, 16), ("favicon-32.png", 32, 32), ("apple-touch-icon-180.png", 180, 180), ("icon-512.png", 512, 512)])
