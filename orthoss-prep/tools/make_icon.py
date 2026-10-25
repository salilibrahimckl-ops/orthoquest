from PIL import Image, ImageDraw, ImageFilter, ImageFont
import math, sys
S = 1296  # 108dp * 12 (supersample); final 432px = 108dp @ xxxhdpi
out = sys.argv[1]

def lerp(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def background():
    im = Image.new("RGB", (S, S))
    px = im.load()
    c1, c2 = (14, 32, 74), (18, 140, 160)   # deep indigo -> teal
    for y in range(S):
        for x in range(0, S):
            t = (x * 0.45 + y * 0.55) / S
            px[x, y] = lerp(c2, c1, min(1, max(0, t)))
    glow = Image.new("L", (S, S), 0)
    ImageDraw.Draw(glow).ellipse([S*0.18, S*0.12, S*0.82, S*0.76], fill=120)
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.12))
    im = Image.composite(Image.new("RGB", (S, S), (120, 230, 235)), im, glow.point(lambda v: v * 0.45))
    return im

def bone_mask():
    m = Image.new("L", (S, S), 0); d = ImageDraw.Draw(m)
    cx = cy = S / 2; L = S * 0.19; w = S * 0.048; r = S * 0.062
    # draw horizontal, rotate later
    d.rounded_rectangle([cx - L, cy - w, cx + L, cy + w], radius=w, fill=255)
    for sx in (-1, 1):
        for sy in (-1, 1):
            d.ellipse([cx + sx * L - r, cy + sy * r * 0.75 - r, cx + sx * L + r, cy + sy * r * 0.75 + r], fill=255)
    return m.rotate(45, resample=Image.BICUBIC, center=(cx, cy))

def foreground():
    fg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    m = bone_mask()
    sh = m.filter(ImageFilter.GaussianBlur(S * 0.02))
    shadow = Image.new("RGBA", (S, S), (4, 18, 40, 0)); shadow.putalpha(sh.point(lambda v: int(v * 0.55)))
    fg.alpha_composite(shadow, (int(S * 0.012), int(S * 0.02)))
    bone = Image.new("RGBA", (S, S), (246, 250, 250, 255)); bone.putalpha(m)
    fg.alpha_composite(bone)
    # gold medal with SS, lower right of the bone
    d = ImageDraw.Draw(fg)
    mcx, mcy, mr = S * 0.6, S * 0.6, S * 0.105
    d.ellipse([mcx - mr - S*0.012, mcy - mr - S*0.012, mcx + mr + S*0.012, mcy + mr + S*0.012], fill=(14, 32, 74, 255))
    for i in range(40):  # radial gold gradient
        t = i / 39; rr = mr * (1 - t * 0.9)
        d.ellipse([mcx - rr, mcy - rr, mcx + rr, mcy + rr], fill=lerp((214, 150, 30), (255, 221, 110), t) + (255,))
    f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", int(S * 0.108))
    d.text((mcx, mcy + S * 0.005), "SS", font=f, fill=(14, 32, 74, 255), anchor="mm")
    # small spark top-left
    sx, sy, k = S * 0.37, S * 0.35, S * 0.04
    d.polygon([(sx, sy - k), (sx + k * 0.25, sy - k * 0.25), (sx + k, sy), (sx + k * 0.25, sy + k * 0.25), (sx, sy + k), (sx - k * 0.25, sy + k * 0.25), (sx - k, sy), (sx - k * 0.25, sy - k * 0.25)], fill=(255, 221, 110, 255))
    return fg

bg = background(); fg = foreground()
bg.resize((432, 432), Image.LANCZOS).save(out + "_bg.png", optimize=True)
fg.resize((432, 432), Image.LANCZOS).save(out + "_fg.png", optimize=True)
# legacy icon: rounded square, content scaled to fill (crop 72/108 safe zone a bit wider)
full = bg.convert("RGBA"); full.alpha_composite(fg)
crop = int(S * 0.12); full = full.crop((crop, crop, S - crop, S - crop)).resize((192, 192), Image.LANCZOS)
mask = Image.new("L", (192 * 4, 192 * 4), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, 192 * 4 - 1, 192 * 4 - 1], radius=192, fill=255)
full.putalpha(mask.resize((192, 192), Image.LANCZOS)); full.save(out + "_legacy.png", optimize=True)
prev = full.resize((192, 192)); prev.save(out + "_preview.png")
print("ok")
