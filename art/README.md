# Art

The map's sprites are rendered from free 3D model kits. Nothing is drawn by hand.

- **Source models:** Kenney's Fantasy Town, Castle, Survival, Nature and Mini Characters kits (https://kenney.nl), all CC0. `fetch-kits.sh` downloads them into `art/.kits/`, which is not committed.
- **Blender scripts** (`blender/`, Blender 4.2 LTS, run headless):
  - `common.py`: the scene, the Lers palette that repaints the kits' colour maps (per people for buildings and clothing), shapes, and the sprite camera.
  - `buildings.py`: every building for every people that has it, plus construction scaffolds. Romans build from the town and castle kits. Egyptian, Asian and Amazon shapes are scripted: sandstone with flat roofs, curved roofs on plinths, and round log huts with thatch.
  - `nature.py`: trees by growth stage, rocks by stone left, field stages, meadow and mountain decorations, and goods.
  - `settlers.py`: every settler look for every people, in 8 directions, with walk, carry, work and attack movements.
- **The camera:** every sprite uses the same orthographic camera, 30° down and turned 45°, with the same sun. On screen a tile is a 64 × 32 diamond, and sprites are rendered at twice that size.
- **Packing:** `pack.py` (Python 3 with Pillow) crops the renders, packs settler frames into one sheet per people and look, and writes WebP files and `manifest.json` into `packages/client/public/art/`. The manifest gives each sprite's anchor, the point that stands on the map.

## Rendering everything

```sh
art/fetch-kits.sh
blender -b --python art/blender/buildings.py
blender -b --python art/blender/nature.py
blender -b --python art/blender/settlers.py
python3 art/pack.py
```

On an 8-core CPU without a graphics card this takes about an hour and a half, most of it on settler frames. To redo part of the set, pass peoples or `--only type,type` to the building and settler scripts. `python3 art/preview.py out.jpg sprite.png ...` lays renders out on a tile grid for review.

## Next

Later, an AI image service can repaint these renders in a richer, painted style while keeping their shapes, and fill in what the kits lack.
