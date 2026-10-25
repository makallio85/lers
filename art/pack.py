"""Crops the Blender renders, packs settler frames into sheets and writes the client's sprite manifest.

Usage: python3 art/pack.py   (needs Pillow with WebP support)
Reads art/.renders/, writes packages/client/public/art/ and packages/client/public/art/manifest.json.
All sizes and anchors in the manifest are in render pixels, which are twice the on-screen size at zoom 1.
"""
import json, os, glob
from PIL import Image

ART = os.path.dirname(os.path.abspath(__file__))
RENDERS = os.path.join(ART, '.renders')
OUT = os.path.join(os.path.dirname(ART), 'packages/client/public/art')
ALPHA = 10           # pixels fainter than this (the shadow catcher's haze) are cut away
PAD = 2


def crop(png):
    meta = json.load(open(png[:-4] + '.json'))
    im = Image.open(png).convert('RGBA')
    mask = im.getchannel('A').point(lambda a: 255 if a > ALPHA else 0)
    box = mask.getbbox() or (0, 0, 1, 1)
    box = (max(0, box[0] - PAD), max(0, box[1] - PAD), min(im.width, box[2] + PAD), min(im.height, box[3] + PAD))
    im = im.crop(box)
    ax, ay = meta['anchor']
    return im, {'anchor': [round(ax - box[0], 1), round(ay - box[1], 1)], 'w': im.width, 'h': im.height, 'size': meta.get('size', 1)}


def save(im, rel):
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, 'WEBP', quality=88, method=6)
    return rel


def main():
    manifest = {'scale': 0.5, 'buildings': {}, 'nature': {}, 'goods': {}, 'settlers': {}}
    for png in sorted(glob.glob(os.path.join(RENDERS, 'buildings/*/*.png'))):
        group, name = png.split('/')[-2], os.path.basename(png)[:-4]
        im, entry = crop(png)
        entry['file'] = save(im, f'buildings/{group}/{name}.webp')
        manifest['buildings'][f'{group}/{name}'] = entry
    for kind in ('nature', 'goods'):
        for png in sorted(glob.glob(os.path.join(RENDERS, kind, '*.png'))):
            name = os.path.basename(png)[:-4]
            im, entry = crop(png)
            entry['file'] = save(im, f'{kind}/{name}.webp')
            manifest[kind][name] = entry
    for meta_path in sorted(glob.glob(os.path.join(RENDERS, 'settlers/*/*.json'))):
        race, look = meta_path.split('/')[-2], os.path.basename(meta_path)[:-5]
        meta = json.load(open(meta_path))
        cw, ch = meta['cell']
        frames = sum(meta['anims'].values())
        sheet = Image.new('RGBA', (cw * frames, ch * 8))
        anims, col = {}, 0
        for anim, n in meta['anims'].items():
            anims[anim] = {'col': col, 'frames': n}
            for d in range(8):
                for k in range(n):
                    sheet.paste(Image.open(os.path.join(RENDERS, 'settlers', race, look, f'{anim}_{d}_{k}.png')).convert('RGBA'), ((col + k) * cw, d * ch))
            col += n
        manifest['settlers'][f'{race}/{look}'] = {
            'file': save(sheet, f'settlers/{race}/{look}.webp'), 'cell': [cw, ch], 'anchor': [round(v, 1) for v in meta['anchor']], 'anims': anims}
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f: json.dump(manifest, f, separators=(',', ':'))
    total = sum(os.path.getsize(p) for p in glob.glob(os.path.join(OUT, '**/*.webp'), recursive=True))
    print(f"{len(manifest['buildings'])} buildings, {len(manifest['nature'])} nature, {len(manifest['goods'])} goods, "
          f"{len(manifest['settlers'])} settler sheets, {total / 1e6:.1f} MB")


main()
