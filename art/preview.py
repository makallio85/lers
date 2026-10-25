"""Places rendered sprites on a drawn isometric tile grid at their anchors, for review.
Usage: python3 art/preview.py out.jpg [--cols N] sprite.png ...  (each sprite needs its .json next to it)"""
import sys, json
from PIL import Image, ImageDraw
args = sys.argv[1:]; out = args.pop(0); cols = 4
if args[0] == '--cols': cols = int(args[1]); args = args[2:]
TW, TH = 128, 64   # tile diamond at render size (2x)
spacing = 5
rows = (len(args) + cols - 1) // cols
W, Hh = cols * spacing * TW // 1 + TW, rows * spacing * TH * 2 + 300
img = Image.new('RGBA', (int(W), int(Hh)), (52, 80, 34, 255))
d = ImageDraw.Draw(img)
def iso(tx, ty, ox, oy): return ox + (tx - ty) * TW / 2, oy + (tx + ty) * TH / 2
for k, f in enumerate(args):
    meta = json.load(open(f[:-4] + '.json')); n = meta.get('size', 1)
    cx, cy = (k % cols) * spacing * TW + TW * 2, (k // cols) * spacing * TH * 2 + 380
    # footprint diamond: tiles from (-n/2,-n/2) to (n/2,n/2) around the anchor
    pts = [iso(-n / 2, -n / 2, cx, cy), iso(n / 2, -n / 2, cx, cy), iso(n / 2, n / 2, cx, cy), iso(-n / 2, n / 2, cx, cy)]
    d.polygon(pts, outline=(230, 220, 160, 255))
    im = Image.open(f).convert('RGBA'); ax, ay = meta['anchor']
    img.alpha_composite(im, (int(cx - ax), int(cy - ay)))
img.convert('RGB').resize((int(W) // 2, int(Hh) // 2)).save(out, quality=85)
