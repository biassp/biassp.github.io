#!/usr/bin/env python3
"""Generate Saku's PWA icons as real PNG bytes.

This repo has no asset pipeline (no npm, no build step), so the icons are
generated here with nothing but the standard library: zlib + struct writing
IHDR/IDAT/IEND chunks by hand. Run from anywhere:

    python3 tools/gen-icons.py

Outputs, next to index.html:
    icon-192.png           purpose "any"      (glyph fills the square)
    icon-512.png           purpose "any"
    icon-maskable-512.png  purpose "maskable" (glyph inside the 80% safe zone)
"""
import os
import struct
import zlib

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

BG_A = (0x0b, 0x10, 0x20)   # CV --bg
BG_B = (0x18, 0x21, 0x42)   # CV --card-2
IND = (0x63, 0x66, 0xf1)    # --accent
CY = (0x22, 0xd3, 0xee)     # --accent-2
VI = (0xa8, 0x55, 0xf7)     # --accent-3
WHITE = (0xea, 0xee, 0xfb)  # --text


def lerp(a, b, t):
    t = 0.0 if t < 0 else (1.0 if t > 1 else t)
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def grad3(t):
    """The CV's --grad: indigo -> violet -> cyan."""
    if t < 0.5:
        return lerp(IND, VI, t / 0.5)
    return lerp(VI, CY, (t - 0.5) / 0.5)


def rounded_rect_cover(x, y, x0, y0, x1, y1, r):
    """Signed-ish coverage of a rounded rect: 1 inside, 0 outside, soft edge."""
    dx = max(x0 - x, x - x1)
    dy = max(y0 - y, y - y1)
    if dx <= -r and dy <= -r:
        return 1.0
    # distance to the rounded boundary
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
    return max(0.0, min(1.0, (r - d) + 0.5))


def build(size, safe):
    """safe: fraction of the canvas the glyph is allowed to use (maskable=0.8)."""
    px = [[(0, 0, 0)] * size for _ in range(size)]
    c = (size - 1) / 2.0
    # backdrop: diagonal dark gradient so the icon reads on any launcher
    for yy in range(size):
        for xx in range(size):
            t = (xx + yy) / (2.0 * (size - 1))
            px[yy][xx] = lerp(BG_A, BG_B, t)
    # accent arc sweeping the corner (full bleed, safe to be clipped)
    ro, ri = size * 0.98, size * 0.80
    for yy in range(size):
        for xx in range(size):
            d = ((xx - size) ** 2 + (yy + size * 0.15) ** 2) ** 0.5
            if ri < d < ro:
                t = (d - ri) / (ro - ri)
                px[yy][xx] = lerp(px[yy][xx], grad3(1 - t), 0.55)

    # --- glyph: a pocket (rounded pouch) with a card sliding into it ---
    g = size * safe                       # glyph box side
    gx0, gy0 = c - g / 2, c - g / 2
    pw, ph = g * 0.86, g * 0.60           # pouch
    px0, py0 = c - pw / 2, gy0 + g * 0.34
    px1, py1 = px0 + pw, py0 + ph
    rr = ph * 0.34
    # card behind the pouch, tilted-ish (plain rect, offset up)
    cw, ch = pw * 0.62, ph * 0.62
    cx0, cy0 = c - cw / 2, py0 - ch * 0.58
    cx1, cy1 = cx0 + cw, cy0 + ch
    for yy in range(size):
        for xx in range(size):
            x, y = xx + 0.5, yy + 0.5
            a = rounded_rect_cover(x, y, cx0, cy0, cx1, cy1, ch * 0.22)
            if a > 0 and y < py0 + ph * 0.22:
                px[yy][xx] = lerp(px[yy][xx], CY, a * 0.95)
    for yy in range(size):
        for xx in range(size):
            x, y = xx + 0.5, yy + 0.5
            a = rounded_rect_cover(x, y, px0, py0, px1, py1, rr)
            if a > 0:
                t = (x - px0) / pw
                px[yy][xx] = lerp(px[yy][xx], grad3(t), a)
            # pocket mouth: a lighter notch across the top of the pouch
            b = rounded_rect_cover(x, y, px0 + pw * 0.14, py0 + ph * 0.16,
                                   px1 - pw * 0.14, py0 + ph * 0.34, ph * 0.09)
            if b > 0:
                px[yy][xx] = lerp(px[yy][xx], WHITE, b * 0.92)
    return px


def write_png(path, px):
    size = len(px)
    raw = bytearray()
    for row in px:
        raw.append(0)
        for r, g, b in row:
            raw += bytes((r, g, b))
    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)
    return len(png)


for name, size, safe in (('icon-192.png', 192, 0.92),
                         ('icon-512.png', 512, 0.92),
                         ('icon-maskable-512.png', 512, 0.78)):
    p = os.path.join(OUT, name)
    n = write_png(p, build(size, safe))
    print('wrote %-24s %5d bytes  %dx%d  safe-zone %.0f%%' % (name, n, size, size, safe * 100))
