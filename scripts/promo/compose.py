#!/usr/bin/env python3
"""Compose the Forge of Echoes promo collage (2400x1350) from captured frames.

  python3 scripts/promo/compose.py [--out .shots/promo/forge-of-echoes-promo.png]

Frames come from scripts/promo/capture.mjs and sandbox.mjs (.shots/promo/raw/). SHOTS maps each slot to a file and a crop
box (x, y, w, h in source pixels); crops are scaled to the slot with LANCZOS (the sources are 1920x1080 captures, so
everything is a downscale and stays crisp).
"""
import json, os, random, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageEnhance, ImageChops

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
RAW = os.path.join(ROOT, '.shots/promo/raw')
OUTDIR = os.path.join(ROOT, '.shots/promo')
W, H = 2400, 1350
FONT_TITLE = os.path.join(ROOT, 'node_modules/@fontsource/cinzel/files/cinzel-latin-900-normal.woff')
FONT_TITLE_B = os.path.join(ROOT, 'node_modules/@fontsource/cinzel/files/cinzel-latin-700-normal.woff')
FONT_UI = os.path.join(ROOT, 'node_modules/@fontsource/alegreya-sans/files/alegreya-sans-latin-700-normal.woff')
FONT_UI_M = os.path.join(ROOT, 'node_modules/@fontsource/alegreya-sans/files/alegreya-sans-latin-500-normal.woff')

cfg = json.load(open(os.path.join(os.path.dirname(__file__), 'layout.json')))

def font(path, size): return ImageFont.truetype(path, size)

def load(slot):
    s = cfg['shots'][slot]
    im = Image.open(os.path.join(RAW, s['file'])).convert('RGB')
    x, y, w, h = s['crop']
    return im.crop((x, y, x + w, y + h))

def fit(im, w, h):
    return im.resize((w, h), Image.LANCZOS)

def grade(im):
    """One shared grade: slightly warm, a touch more contrast and saturation."""
    im = ImageEnhance.Contrast(im).enhance(1.08)
    im = ImageEnhance.Color(im).enhance(1.08)
    r, g, b = im.split()
    r = r.point(lambda v: min(255, int(v * 1.03)))
    b = b.point(lambda v: int(v * 0.96))
    return Image.merge('RGB', (r, g, b))

def background():
    bg = Image.new('RGB', (W, H), (14, 9, 8))
    px = Image.new('RGB', (W, H))
    # radial ember glow, brighter lower-left and top-right
    glow = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(glow)
    d.ellipse((-600, 700, 1300, 2000), fill=120)
    d.ellipse((1500, -700, 3000, 700), fill=90)
    glow = glow.filter(ImageFilter.GaussianBlur(260))
    ember = Image.new('RGB', (W, H), (120, 42, 12))
    bg = Image.composite(ember, bg, glow.point(lambda v: int(v * 0.55)))
    # vignette
    vig = Image.new('L', (W, H), 0)
    ImageDraw.Draw(vig).ellipse((-500, -400, W + 500, H + 400), fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(300))
    bg = Image.composite(bg, Image.new('RGB', (W, H), (4, 2, 2)), vig)
    # embers
    rnd = random.Random(7)
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    for _ in range(170):
        x, y = rnd.randint(0, W), rnd.randint(0, H)
        s = rnd.choice([2, 2, 3, 4])
        a = rnd.randint(70, 200)
        ld.rectangle((x, y, x + s, y + s), fill=(255, rnd.randint(110, 170), 40, a))
    layer = layer.filter(ImageFilter.GaussianBlur(0.8))
    bg = Image.alpha_composite(bg.convert('RGBA'), layer).convert('RGB')
    # grain
    noise = Image.effect_noise((W, H), 22).convert('RGB')
    bg = Image.blend(bg, ImageChops.add(bg, noise, 1, -118), 0.5)
    return bg

def metal_frame(canvas, box, label=None, glow=(255, 140, 50)):
    x, y, w, h = box
    # shadow
    sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rectangle((x - 2, y + 8, x + w + 2, y + h + 14), fill=(0, 0, 0, 200))
    sh = sh.filter(ImageFilter.GaussianBlur(14))
    canvas.alpha_composite(sh)
    # faint ember glow behind
    gl = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(gl).rectangle((x - 6, y - 6, x + w + 6, y + h + 6), fill=glow + (60,))
    canvas.alpha_composite(gl.filter(ImageFilter.GaussianBlur(18)))

def draw_frame(canvas, box, label=None):
    x, y, w, h = box
    d = ImageDraw.Draw(canvas)
    t = 5
    # gradient metal border: top-left bright gold -> bottom-right bronze/dark
    frame = Image.new('RGB', (w + 2 * t, h + 2 * t))
    fd = ImageDraw.Draw(frame)
    for i in range(frame.size[0] + frame.size[1]):
        k = i / (frame.size[0] + frame.size[1])
        c = (int(232 - 150 * k), int(172 - 120 * k), int(88 - 60 * k))
        fd.line((i, 0, 0, i), fill=c, width=2)
    mask = Image.new('L', frame.size, 0)
    md = ImageDraw.Draw(mask)
    md.rectangle((0, 0, frame.size[0], frame.size[1]), fill=255)
    md.rectangle((t, t, frame.size[0] - t - 1, frame.size[1] - t - 1), fill=0)
    canvas.paste(frame, (x - t, y - t), mask)
    d.rectangle((x - 1, y - 1, x + w, y + h), outline=(30, 16, 10), width=1)
    d.rectangle((x - t, y - t, x + w + t - 1, y + h + t - 1), outline=(20, 10, 6), width=1)

def label_chip(canvas, box, text, size=27):
    x, y, w, h = box
    f = font(FONT_UI, size)
    # gradient fade at the bottom of the tile for legibility
    fade = Image.new('RGBA', (w, 110), (0, 0, 0, 0))
    fd = ImageDraw.Draw(fade)
    for i in range(110):
        fd.line((0, i, w, i), fill=(8, 4, 3, int(215 * (i / 110) ** 1.6)))
    canvas.alpha_composite(fade, (x, y + h - 110))
    d = ImageDraw.Draw(canvas)
    tw = d.textlength(text.upper(), font=f)
    d.rectangle((x + 18, y + h - 52, x + 22, y + h - 24), fill=(255, 150, 50))
    tracked(d, (x + 34, y + h - 54), text.upper(), f, (250, 226, 186), 2)

def tracked(d, xy, text, f, fill, spacing=0, shadow=True):
    x, y = xy
    for ch in text:
        if shadow: d.text((x + 2, y + 2), ch, font=f, fill=(0, 0, 0))
        d.text((x, y), ch, font=f, fill=fill)
        x += d.textlength(ch, font=f) + spacing
    return x

def title(canvas, x, y, w):
    d = ImageDraw.Draw(canvas)
    big = font(FONT_TITLE, cfg['title_size'])
    lines = ['FORGE', 'OF ECHOES']
    ty = y
    for i, ln in enumerate(lines):
        lw = d.textlength(ln, font=big)
        # glow
        g = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
        ImageDraw.Draw(g).text((x, ty), ln, font=big, fill=(255, 110, 30, 255))
        canvas.alpha_composite(g.filter(ImageFilter.GaussianBlur(16)))
        # gradient text
        mask = Image.new('L', canvas.size, 0)
        ImageDraw.Draw(mask).text((x, ty), ln, font=big, fill=255)
        bb = mask.getbbox()
        grad = Image.new('RGB', canvas.size)
        gd = ImageDraw.Draw(grad)
        top, bot = bb[1], bb[3]
        for yy in range(top, bot + 1):
            k = (yy - top) / max(1, bot - top)
            gd.line((0, yy, canvas.size[0], yy), fill=(255, int(236 - 96 * k), int(170 - 120 * k)))
        shadow = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
        ImageDraw.Draw(shadow).text((x + 4, ty + 6), ln, font=big, fill=(0, 0, 0, 230))
        canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(2)))
        canvas.paste(grad, (0, 0), mask)
        ty += int(cfg['title_size'] * 1.04)
    return ty

def chips(canvas, x, y, maxw, items):
    """A 2x2 grid of equal-width feature chips."""
    d = ImageDraw.Draw(canvas)
    f = font(FONT_UI, 28)
    gap = 14
    cw = (maxw - gap) // 2
    for i, it in enumerate(items):
        cx = x + (i % 2) * (cw + gap)
        cy = y + (i // 2) * (52 + gap)
        chip = Image.new('RGBA', (cw, 52), (0, 0, 0, 0))
        cd = ImageDraw.Draw(chip)
        cd.rounded_rectangle((0, 0, cw - 1, 51), 10, fill=(36, 18, 11, 235), outline=(214, 140, 70, 255), width=2)
        cd.rounded_rectangle((2, 2, cw - 3, 26), 8, fill=(255, 170, 90, 28))
        cd.rectangle((16, 21, 22, 27), fill=(255, 150, 50))
        cd.text((34, 8), it, font=f, fill=(255, 232, 196))
        canvas.alpha_composite(chip, (cx, cy))
    return y + 2 * 52 + gap

def main():
    out = os.path.join(OUTDIR, 'forge-of-echoes-promo.png')
    if '--out' in sys.argv: out = sys.argv[sys.argv.index('--out') + 1]
    canvas = background().convert('RGBA')
    slots = cfg['slots']
    for name, box in slots.items():
        metal_frame(canvas, box)
    for name, box in slots.items():
        x, y, w, h = box
        im = grade(fit(load(name), w, h))
        canvas.paste(im, (x, y))
        draw_frame(canvas, box)
        if name in cfg['labels']:
            label_chip(canvas, box, cfg['labels'][name], cfg.get('label_size', 27))
    t = cfg['title']
    ty = title(canvas, t['x'], t['y'], t['w'])
    d = ImageDraw.Draw(canvas)
    tag = font(FONT_UI_M, cfg['tag_size'])
    yy = ty + 6
    for ln in cfg['tagline']:
        d.text((t['x'] + 2, yy + 2), ln, font=tag, fill=(0, 0, 0))
        d.text((t['x'], yy), ln, font=tag, fill=(238, 214, 178))
        yy += int(cfg['tag_size'] * 1.18)
    chips(canvas, t['x'], yy + 14, t['w'], cfg['chips'])
    final = canvas.convert('RGB')
    final.save(out, optimize=True)
    half = final.resize((1200, 675), Image.LANCZOS)
    half.save(out.replace('.png', '-1200.png'))
    q = 92
    while True:
        half2 = final.resize((2400, 1350), Image.LANCZOS)
        half2.save(out.replace('.png', '.jpg'), quality=q, optimize=True, progressive=True)
        if os.path.getsize(out.replace('.png', '.jpg')) < 1_450_000 or q <= 60: break
        q -= 4
    print('saved', out, os.path.getsize(out.replace('.png', '.jpg')))

if __name__ == '__main__':
    main()
