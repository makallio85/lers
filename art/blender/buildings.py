"""Renders every building for every people that has it, plus construction scaffolds.

Run: blender -b --python art/blender/buildings.py -- [race ...] [--only type,type]
Writes art/.renders/buildings/<race>/<type>.png and a .json with the anchor (where the footprint centre lands).
"""
import bpy, sys, os, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

# Footprint sizes and which peoples have which buildings, as in packages/simulation/src/definitions.ts.
SIZES = {
    'woodcutter': 2, 'forester': 2, 'sawmill': 3, 'stonecutter': 2, 'coal_mine': 2, 'iron_mine': 2, 'gold_mine': 2, 'smelter': 3,
    'gold_smelter': 3, 'gem_mine': 2, 'sulfur_mine': 2, 'charcoal_maker': 2, 'alchemist': 2, 'toolsmith': 3, 'farm': 3, 'mill': 3,
    'bakery': 3, 'waterworks': 2, 'fisher': 2, 'pig_farm': 3, 'slaughterhouse': 3, 'winery': 3, 'brewery': 3, 'rice_farm': 3,
    'distillery': 3, 'beekeeper': 2, 'mead_maker': 3, 'donkey_ranch': 3, 'guard_tower_small': 2, 'guard_tower_large': 3, 'castle': 4,
    'lookout': 2, 'barracks': 3, 'weaponsmith': 3, 'gunpowder_maker': 3, 'residence_small': 2, 'residence_medium': 3,
    'residence_large': 4, 'storage': 3, 'healer': 2, 'marketplace': 3,
    'catapult_hall': 3, 'ballista_hall': 3, 'cannon_hall': 3, 'gong_hall': 3}
ONLY = {'gem_mine': ('egyptians', 'amazons'), 'sulfur_mine': ('asians', 'amazons'), 'charcoal_maker': ('romans',), 'alchemist': ('amazons',),
        'winery': ('romans',), 'brewery': ('egyptians',), 'rice_farm': ('asians',), 'distillery': ('asians',), 'beekeeper': ('amazons',),
        'mead_maker': ('amazons',), 'gunpowder_maker': ('asians',),
        'catapult_hall': ('romans',), 'ballista_hall': ('egyptians',), 'cannon_hall': ('asians',), 'gong_hall': ('amazons',)}
CANVAS = {2: 640, 3: 832, 4: 1024}


class Builder:
    def __init__(self, race, n):
        self.s = Scene(race)
        self.race, self.n = race, n
        s = self.s
        self.STRAW = s.mat('straw', '8a6a2e', noise=22, stretch=(9, 9, 0.35), c2='c2a050')
        self.BARK = s.mat('bark', '5a3a22', noise=10, stretch=(8, 8, 0.5))
        self.DARKWOOD = s.mat('darkwood', '3a2416', noise=6, stretch=(1, 1, 6))
        self.WOOD = s.mat('wood', '7a5230', noise=6, stretch=(1, 1, 6))
        self.LACQUER = s.mat('lacquer', '8a2a1c', rough=0.5)
        self.TILE = s.mat('tile', '33383f', rough=0.55, wave=30, c2='4a515a')
        self.REDTILE = s.mat('redtile', 'a24a30', rough=0.7, wave=26, c2='b85a3a')
        self.PLASTER = s.mat('plaster', 'e2d8c0', noise=5)
        self.SAND = s.mat('sand', 'c9a06a', wave=9, c2='d8b47e')
        self.SANDDARK = s.mat('sanddark', 'a07e4e')
        self.STONE = s.mat('stone', '8e8a80', noise=8, c2='a6a196')
        self.PLINTH = s.mat('plinth', '6e6b66', noise=8)
        self.SLIT = s.mat('slit', '141010')
        self.BLUE = s.mat('blue', '2f5f7a')
        self.GOLD = s.mat('gold', 'c9a03a', rough=0.3, metal=0.6)
        self.IRON = s.mat('iron', '7a7d80', rough=0.4, metal=0.7)
        self.COPPER = s.mat('copper', 'b06a3a', rough=0.35, metal=0.7)
        self.COAL = s.mat('coal', '1e1c1a')
        self.CLOTH = s.mat('cloth', 'd8cfb8')
        self.GREEN = s.mat('leaf', '3e5a22')
        self.PINK = s.mat('pig', 'd89a8a')
        self.GREY = s.mat('donkey', '807a72')
        self.WATER = s.mat('water', '2a4f5a', rough=0.08)
        self.GLOW = s.mat('glow', 'e8763a', rough=1)
        self.door_x = 0.5 if n % 2 == 0 else 0.0

    # ------------------------------------------------------------ people's bodies
    def body(self, w, d, cx=0.0, cy=0.0, floors=1, roof='gable', wood=False):
        """The main house of a building in the people's style. Returns the height of its roof ridge."""
        return getattr(self, 'body_' + self.race)(w, d, cx, cy, floors, roof, wood)

    def body_romans(self, w, d, cx, cy, floors, roof, wood):
        s = self.s
        cells_w, cells_d = max(1, round(w)), max(1, round(d))
        k = min(w / cells_w, d / cells_d)
        wall = 'wall-wood' if wood else 'wall'
        for f in range(floors):
            for i in range(cells_w):
                for j in range(cells_d):
                    x = cx + (i - (cells_w - 1) / 2) * k; y = cy + (j - (cells_d - 1) / 2) * k
                    for rot, side, edge in [(0, 'E', i == cells_w - 1), (90, 'N', j == cells_d - 1), (180, 'W', i == 0), (270, 'S', j == 0)]:
                        if not edge: continue
                        door = f == 0 and side == 'S' and abs(x - self.door_x) < k * 0.6
                        piece = wall + ('-door' if door else ('-window-shutters' if (i + j + f) % 2 == 0 and side in ('S', 'E') else ''))
                        s.put(TOWN + piece + '.glb', x, y, f * k, rot, k)
        top = floors * k
        for i in range(cells_w):
            for j in range(cells_d):
                x = cx + (i - (cells_w - 1) / 2) * k; y = cy + (j - (cells_d - 1) / 2) * k
                s.put(TOWN + ('roof-high' if roof == 'high' else 'roof-gable') + '.glb', x, y, top, 90 if cells_w >= cells_d else 0, k)
        for px in (cx - cells_w * k / 2, cx + cells_w * k / 2):
            for py in (cy - cells_d * k / 2, cy + cells_d * k / 2):
                s.put(TOWN + ('pillar-wood' if wood else 'pillar-stone') + '.glb', px, py, 0, 0, (k, k, k * floors))
        return top + (0.9 if roof == 'high' else 0.55) * k

    def body_egyptians(self, w, d, cx, cy, floors, roof, wood):
        s = self.s; h = 0.95 * floors
        s.box(cx, cy, 0, w, d, h, self.SAND)
        s.box(cx, cy, h, w + 0.1, d + 0.1, 0.08, self.SANDDARK)
        for dx in (-w / 2, w / 2):
            for dy in (-d / 2, d / 2): s.box(cx + dx, cy + dy, h + 0.08, 0.16, 0.16, 0.16, self.SANDDARK)
        s.box(self.door_x, cy - d / 2 - 0.01, 0, 0.34, 0.04, 0.6, self.SLIT)
        s.box(self.door_x, cy - d / 2 - 0.02, 0.6, 0.5, 0.05, 0.1, self.BLUE)
        for f in range(floors):
            for t in (-0.25, 0.25): s.box(cx + w / 2 + 0.01, cy + t * d, 0.45 + f * 0.95, 0.04, 0.16, 0.2, self.SLIT)
        if roof != 'flat': s.box(cx - w * 0.2, cy + d * 0.15, h + 0.08, w * 0.35, d * 0.35, 0.3, self.SAND)
        return h + 0.4

    def body_asians(self, w, d, cx, cy, floors, roof, wood):
        s = self.s; h = 0.85 * floors
        s.box(cx, cy, 0, w + 0.2, d + 0.2, 0.12, self.PLINTH)
        s.box(cx, cy, 0.12, w, d, h, self.PLASTER)
        posts = max(2, round(w / 0.6) + 1)
        for i in range(posts): s.box(cx - w / 2 + i * w / (posts - 1), cy - d / 2 - 0.02, 0.12, 0.09, 0.09, h, self.LACQUER)
        posts = max(2, round(d / 0.6) + 1)
        for i in range(posts): s.box(cx + w / 2 + 0.02, cy - d / 2 + i * d / (posts - 1), 0.12, 0.09, 0.09, h, self.LACQUER)
        for f in range(1, floors): s.box(cx, cy, 0.12 + f * 0.85, w + 0.25, d + 0.25, 0.06, self.TILE)
        s.box(cx + self.door_x * 0.0 + self.door_x, cy - d / 2 - 0.03, 0.12, 0.38, 0.03, 0.58, self.DARKWOOD)
        s.box(cx + w / 2 + 0.03, cy, 0.4, 0.03, 0.36, 0.26, s.mat('paper', 'd8ccaa'))
        rh = 0.55 + 0.12 * min(w, d)
        s.curved_roof(cx, cy, 0.12 + h - 0.05, w / 2 + 0.3, d / 2 + 0.3, rh, 0.2, self.TILE)
        return 0.12 + h + rh

    def body_amazons(self, w, d, cx, cy, floors, roof, wood):
        s = self.s; h = 0.8 * floors
        if abs(w - d) < 0.35:
            r = min(w, d) / 2
            s.cyl(cx, cy, 0, r, h, self.BARK, 28)
            n = int(2 * math.pi * r / 0.13)
            for k in range(n):
                a = k * 2 * math.pi / n
                s.cyl(cx + (r + 0.01) * math.cos(a), cy + (r + 0.01) * math.sin(a), 0, 0.065, h + s.rng.uniform(-.03, .1), self.BARK, 8)
            a = math.atan2(-1, self.door_x - cx + 0.001) if False else math.radians(-90)
            s.box(cx + self.door_x * 0.6, cy - r - 0.04, 0, 0.36, 0.06, 0.6, self.DARKWOOD)
            rh = r * 1.45
            s.cone(cx, cy, h - 0.08, r * 1.45, rh, self.STRAW, 32)
            s.cone(cx, cy, h - 0.08 + rh - 0.1, 0.12, 0.25, self.STRAW, 12)
            return h + rh
        s.box(cx, cy, 0, w, d, h, self.BARK)
        n = int(w / 0.14)
        for k in range(n + 1): s.cyl(cx - w / 2 + k * w / n, cy - d / 2 - 0.02, 0, 0.065, h, self.BARK, 8)
        n = int(d / 0.14)
        for k in range(n + 1): s.cyl(cx + w / 2 + 0.02, cy - d / 2 + k * d / n, 0, 0.065, h, self.BARK, 8)
        s.box(self.door_x, cy - d / 2 - 0.08, 0, 0.36, 0.06, 0.6, self.DARKWOOD)
        rh = 0.5 + 0.25 * min(w, d)
        s.gable(cx, cy, h - 0.05, w, d, rh, self.STRAW, along_x=w >= d, over=0.22)
        return h + rh

    # ------------------------------------------------------------ people's towers
    def tower(self, base, height, cx=0.0, cy=0.0):
        return getattr(self, 'tower_' + self.race)(base, height, cx, cy)

    def tower_romans(self, base, height, cx, cy):
        s = self.s; k = base; z = 0
        s.put(CASTLE + 'tower-square-base.glb', cx, cy, 0, 0, k); z += k
        mids = max(1, round(height / k) - 2)
        for i in range(mids):
            s.put(CASTLE + ('tower-square-mid-door.glb' if i == 0 else 'tower-square-mid-windows.glb'), cx, cy, z, 0, k); z += k
        s.put(CASTLE + 'tower-square-top-roof-high.glb', cx, cy, z, 0, k)
        s.put(CASTLE + 'flag.glb', cx, cy, z + 1.4 * k, 0, 0.8)
        return z + 1.6 * k

    def tower_egyptians(self, base, height, cx, cy):
        s = self.s; top = base * 0.72
        s.taper(cx, cy, 0, base, top, height, self.SAND)
        s.taper(cx, cy, height, top + 0.2, top + 0.2, 0.12, self.SANDDARK)
        n = 5
        for k in range(n):
            t = -top / 2 + k * top / (n - 1)
            for (x, y) in [(t, -top / 2 - 0.05), (top / 2 + 0.05, t), (t, top / 2 + 0.05), (-top / 2 - 0.05, t)]:
                s.box(cx + x, cy + y, height + 0.12, 0.18, 0.18, 0.2, self.SAND)
        for z in (height * 0.4, height * 0.7):
            inset = (base - top) / 2 * z / height
            s.box(cx, cy - base / 2 + inset - 0.02, z, 0.12, 0.04, 0.36, self.SLIT)
            s.box(cx + base / 2 - inset + 0.02, cy, z, 0.04, 0.12, 0.36, self.SLIT)
        s.box(self.door_x, cy - base / 2 - 0.02, 0, 0.42, 0.05, 0.75, self.SLIT)
        s.box(self.door_x, cy - base / 2 - 0.03, 0.75, 0.62, 0.06, 0.12, self.BLUE)
        s.box(cx + top * 0.25, cy + top * 0.25, height + 0.12, 0.05, 0.05, 1.2, self.DARKWOOD)
        s.box(cx + top * 0.25, cy + top * 0.25 - 0.25, height + 1.0, 0.02, 0.5, 0.3, self.BLUE)
        return height + 1.3

    def tower_asians(self, base, height, cx, cy):
        s = self.s
        s.box(cx, cy, 0, base * 1.25, base * 1.25, 0.2, self.PLINTH)
        z = 0.2; tiers = max(2, round(height / 0.95))
        for k in range(tiers):
            w = base * (1 - 0.18 * k); h = height / tiers * (1.1 if k == 0 else 0.85)
            s.box(cx, cy, z, w, w, h, self.PLASTER)
            for sgn in (-1, 1):
                s.box(cx + sgn * w / 2, cy - w / 2, z, 0.08, 0.08, h, self.LACQUER)
                s.box(cx + w / 2, cy + sgn * w / 2, z, 0.08, 0.08, h, self.LACQUER)
            s.box(cx + (self.door_x if k == 0 else 0), cy - w / 2 - 0.01, z + (0 if k == 0 else h * 0.35), w * 0.32, 0.02, h * (0.6 if k == 0 else 0.4),
                  self.DARKWOOD if k == 0 else self.SLIT)
            s.curved_roof(cx, cy, z + h - 0.05, w * 0.85, w * 0.85, 0.38, 0.16, self.TILE, thick=0.04)
            z += h + 0.12
        s.cyl(cx, cy, z - 0.1, 0.04, 0.8, self.GOLD)
        for k in range(3): s.cyl(cx, cy, z + k * 0.18, 0.09, 0.04, self.GOLD)
        return z + 0.8

    def tower_amazons(self, base, height, cx, cy):
        s = self.s; a = base * 0.36; deck = height * 0.75
        for (x, y) in [(-a, -a), (a, -a), (a, a), (-a, a)]: s.cyl(cx + x, cy + y, 0, 0.09, deck, self.BARK, 10)
        for zz in (deck * 0.33, deck * 0.66):
            for sgn in (-1, 1):
                s.box(cx, cy + sgn * a, zz, 2 * a + 0.1, 0.06, 0.06, self.BARK); s.box(cx + sgn * a, cy, zz, 0.06, 2 * a + 0.1, 0.06, self.BARK)
        r = a * 1.55
        s.cyl(cx, cy, deck - 0.05, r, 0.12, self.DARKWOOD, 20)
        n = int(2 * math.pi * r / 0.24)
        for k in range(n):
            ang = k * 2 * math.pi / n; s.cyl(cx + r * math.cos(ang), cy + r * math.sin(ang), deck, 0.05, 0.5 + (k % 2) * 0.12, self.BARK, 6)
        for (x, y) in [(-a, -a), (a, -a), (a, a), (-a, a)]: s.cyl(cx + x, cy + y, deck, 0.05, 0.85, self.BARK, 8)
        s.cone(cx, cy, deck + 0.85, r * 1.3, r * 1.15, self.STRAW, 28)
        rungs = int(deck / 0.3)
        for k in range(rungs): s.box(cx + 0.1, cy - a - 0.12, 0.15 + k * 0.3, 0.36, 0.04, 0.04, self.BARK)
        for dx in (-0.08, 0.28): s.box(cx + dx, cy - a - 0.12, 0, 0.04, 0.04, deck, self.BARK)
        return deck + 0.85 + r * 1.15

    # ------------------------------------------------------------ props
    def logs(self, x, y, s_=1.2): self.s.put(NAT + 'log_stack.glb', x, y, 0, 0, s_)
    def planks(self, x, y, k=3):
        for i in range(k): self.s.put(SURV + 'resource-planks.glb', x, y + i * 0.4, 0, 0, 0.85)
    def stones(self, x, y):
        self.s.put(SURV + 'resource-stone-large.glb', x, y, 0, 0, 1.0); self.s.put(SURV + 'resource-stone.glb', x + 0.45, y - 0.2, 0, 40, 1.0)
    def barrels(self, x, y, k=3):
        for i in range(k): self.s.put(SURV + 'barrel.glb', x + (i % 2) * 0.34, y + (i // 2) * 0.34 - (i % 2) * 0.1, 0, i * 40, 0.9)
    def crates(self, x, y, k=3):
        for i in range(k): self.s.put(SURV + ('box-large.glb' if i % 2 else 'box.glb'), x + i * 0.38, y - (i % 2) * 0.2, 0, i * 25, 0.9)
    def sacks(self, x, y, k=3, m=None):
        for i in range(k): self.s.sphere(x + i * 0.22, y - (i % 2) * 0.15, 0.12, 0.14, m or self.CLOTH, 0.9)
    def chimney(self, x, y, z, h=0.6, m=None):
        self.s.box(x, y, z - 0.3, 0.26, 0.26, h + 0.3, m or self.STONE); self.s.box(x, y, z + h, 0.32, 0.32, 0.06, self.SLIT)
    def fence_pen(self, x0, y0, x1, y1):
        s = self.s; step = 0.5
        for x in [x0 + i * step for i in range(int((x1 - x0) / step) + 1)]:
            for y in (y0, y1): s.cyl(x, y, 0, 0.03, 0.32, self.WOOD, 6)
        for y in [y0 + i * step for i in range(int((y1 - y0) / step) + 1)]:
            for x in (x0, x1): s.cyl(x, y, 0, 0.03, 0.32, self.WOOD, 6)
        for z in (0.12, 0.26):
            for y in (y0, y1): s.box((x0 + x1) / 2, y, z, x1 - x0, 0.03, 0.03, self.WOOD)
            for x in (x0, x1): s.box(x, (y0 + y1) / 2, z, 0.03, y1 - y0, 0.03, self.WOOD)
    def animal(self, x, y, rot, m, k=1.0):
        s = self.s
        s.box(x, y, 0.1 * k, 0.34 * k, 0.18 * k, 0.16 * k, m, rot)
        f = math.radians(rot); hx, hy = x + 0.2 * k * math.cos(f), y + 0.2 * k * math.sin(f)
        s.box(hx, hy, 0.16 * k, 0.12 * k, 0.12 * k, 0.12 * k, m, rot)
        for dx in (-0.1, 0.1):
            for dy in (-0.05, 0.05):
                lx = x + (dx * math.cos(f) - dy * math.sin(f)) * k; ly = y + (dx * math.sin(f) + dy * math.cos(f)) * k
                s.box(lx, ly, 0, 0.04 * k, 0.04 * k, 0.1 * k, m)
    def field(self, x, y, w, d, crop='crops_wheatStageB'):
        s = self.s; s.box(x, y, 0, w, d, 0.02, s.mat('soil', '4a3420', noise=6))
        for i in range(int(w / 0.5)):
            for j in range(int(d / 0.5)):
                s.put(NAT + crop + '.glb', x - w / 2 + 0.25 + i * 0.5, y - d / 2 + 0.25 + j * 0.5, 0.02, 0, 0.9)
    def ore_cart(self, x, y, m):
        s = self.s; s.put(TOWN + 'cart.glb', x, y, 0, 20, 0.7)
        for i in range(4): s.sphere(x + (i % 2) * 0.12 - 0.06, y + (i // 2) * 0.1, 0.42, 0.08, m, 0.8)
    def windmill(self, cx, cy, top):
        s = self.s; s.put(TOWN + 'windmill.glb', cx, cy - 0.62, top - 0.6, 90, 0.95)
    def banner(self, x, y, h=1.4, m=None):
        s = self.s; s.box(x, y, 0, 0.05, 0.05, h, self.DARKWOOD); s.box(x + 0.16, y, h - 0.5, 0.3, 0.02, 0.45, m or self.LACQUER)

    def stone_mound(self, cx, cy, n):
        s = self.s
        for (x, y, k) in [(-0.3, 0.3, 1.5), (0.35, 0.25, 1.3), (-0.45, -0.2, 1.1), (0.25, -0.15, 0.9)]:
            s.put(CASTLE + 'rocks-large.glb', cx + x * n / 2, cy + y * n / 2, 0, s.rng.uniform(0, 360), k * n / 2)

    def mine(self, ore):
        """A mine: an adit into a rock mound with a timber frame, an ore cart and the people's small shed."""
        s = self.s; n = self.n
        self.stone_mound(0, 0.15, n)
        frame = self.DARKWOOD if self.race != 'egyptians' else self.SANDDARK
        x = self.door_x; y = -0.55
        s.box(x, y, 0, 0.5, 0.25, 0.62, self.SLIT)
        for dx in (-0.28, 0.28): s.box(x + dx, y - 0.05, 0, 0.09, 0.09, 0.7, frame)
        s.box(x, y - 0.05, 0.66, 0.7, 0.12, 0.1, frame)
        top = {'romans': self.REDTILE, 'egyptians': self.SAND, 'asians': self.TILE, 'amazons': self.STRAW}[self.race]
        s.gable(x, y - 0.12, 0.76, 0.8, 0.4, 0.25, top, along_x=True, over=0.05)
        self.ore_cart(0.55, -0.75, ore)


def recipe(b, typeId):
    s, n, R = b.s, b.n, b.race
    if typeId == 'woodcutter':
        b.body(1.6, 1.1, -0.1, 0.25); b.logs(0.65, -0.65); s.put(NAT + 'stump_round.glb', -0.75, -0.75, 0, 0, 1.3)
        s.put(SURV + 'tool-axe.glb', -0.6, -0.72, 0.2, 60, 0.7)
    elif typeId == 'forester':
        b.body(1.5, 1.1, -0.15, 0.25)
        for (x, y, k) in [(0.6, -0.6, 0.6), (0.8, -0.2, 0.5), (0.35, -0.85, 0.45)]: s.put(NAT + 'tree_pineSmallA.glb', x, y, 0, 0, k)
        s.put(SURV + 'tool-shovel.glb', -0.6, -0.75, 0, 30, 0.7)
    elif typeId == 'sawmill':
        top = b.body(2.2, 1.6, -0.2, 0.35, roof='high', wood=True)
        b.planks(1.05, -0.6, 3); b.logs(0.8, -1.15, 1.1); s.put(TOWN + 'blade.glb', -1.0, -0.8, 0.3, 90, 0.5)
    elif typeId == 'stonecutter':
        b.body(1.5, 1.1, -0.15, 0.3); b.stones(0.5, -0.65); s.put(SURV + 'tool-pickaxe.glb', -0.6, -0.75, 0, 20, 0.7)
    elif typeId in ('coal_mine', 'iron_mine', 'gold_mine', 'gem_mine', 'sulfur_mine'):
        b.mine({'coal_mine': b.COAL, 'iron_mine': s.mat('ironore', '8a5a4a'), 'gold_mine': b.GOLD, 'gem_mine': s.mat('gem', '40c0c8', rough=0.2),
                'sulfur_mine': s.mat('sulfur', 'd8d040')}[typeId])
    elif typeId in ('smelter', 'gold_smelter'):
        top = b.body(2.0, 1.5, -0.2, 0.3); b.chimney(0.45, 0.55, top - 0.3, 0.9)
        s.box(0.95, -0.55, 0, 0.5, 0.5, 0.45, b.STONE); s.box(0.95, -0.81, 0.08, 0.22, 0.02, 0.2, b.GLOW)
        ingot = b.GOLD if typeId == 'gold_smelter' else b.IRON
        for i in range(4): s.box(-0.4 + (i % 2) * 0.2, -1.0 + (i // 2) * 0.1, (i // 2) * 0.07, 0.17, 0.08, 0.07, ingot)
        if typeId == 'smelter': s.put(NAT + 'rock_smallA.glb', -0.9, -0.9, 0, 0, 1.2)
    elif typeId == 'charcoal_maker':
        b.body(1.2, 1.0, -0.35, 0.35); s.cone(0.55, -0.45, 0, 0.55, 0.6, b.COAL, 20); s.cone(0.55, -0.45, 0.55, 0.08, 0.15, b.GLOW, 8)
        b.logs(-0.6, -0.7, 0.9)
    elif typeId == 'alchemist':
        top = b.body(1.4, 1.2, -0.15, 0.2); b.chimney(0.25, 0.4, top - 0.4, 0.6)
        for i, c in enumerate(['7a3a8a', '3a8a6a', 'c9a03a']):
            s.cyl(0.4 + i * 0.22, -0.75, 0, 0.09, 0.22, s.mat('pot' + c, c, rough=0.3))
        s.put(SURV + 'workbench.glb', -0.55, -0.75, 0, 0, 0.7)
    elif typeId in ('toolsmith', 'weaponsmith'):
        top = b.body(2.0, 1.5, -0.25, 0.35); b.chimney(0.4, 0.6, top - 0.35, 0.8)
        s.put(SURV + 'workbench-anvil.glb', 0.85, -0.7, 0, 0, 0.9)
        if typeId == 'toolsmith':
            for i, t in enumerate(['tool-axe', 'tool-hammer', 'tool-pickaxe', 'tool-shovel']): s.put(SURV + t + '.glb', -0.9 + i * 0.3, -1.0, 0, 90, 0.7)
        else:
            for i in range(4):
                s.box(-0.9 + i * 0.25, -1.0, 0, 0.04, 0.04, 0.55, b.IRON); s.box(-0.9 + i * 0.25, -1.0, 0.18, 0.16, 0.04, 0.03, b.DARKWOOD)
            b.banner(1.3, 0.3)
    elif typeId == 'farm':
        b.body(1.6, 1.2, -0.55, 0.5, wood=True); b.field(0.75, -0.45, 1.2, 1.6)
        s.put(SURV + 'tool-hoe.glb', -0.6, -0.4, 0, 40, 0.7); b.sacks(-1.2, -0.45, 2)
    elif typeId == 'mill':
        if R == 'romans':
            s.put(CASTLE + 'tower-hexagon-base.glb', 0, 0.1, 0, 0, 1.05); s.put(CASTLE + 'tower-hexagon-mid.glb', 0, 0.1, 1.05, 0, 1.05)
            s.put(TOWN + 'roof-point.glb', 0, 0.1, 2.1, 0, 1.2); top = 2.5
        elif R == 'egyptians':
            s.cyl(0, 0.1, 0, 0.6, 2.1, b.SAND, 24); s.cyl(0, 0.1, 2.1, 0.66, 0.1, b.SANDDARK, 24); s.box(0, 0.1, 2.2, 0.5, 0.5, 0.35, b.SAND); top = 2.5
            s.box(b.door_x * 0, -0.5, 0, 0.32, 0.04, 0.55, b.SLIT)
        elif R == 'asians':
            s.box(0, 0.1, 0, 1.3, 1.3, 0.15, b.PLINTH); s.taper(0, 0.1, 0.15, 1.1, 0.8, 2.0, b.PLASTER)
            s.curved_roof(0, 0.1, 2.1, 0.75, 0.75, 0.5, 0.15, b.TILE); top = 2.4
            s.box(0, -0.42, 0.15, 0.34, 0.04, 0.55, b.DARKWOOD)
        else:
            s.cyl(0, 0.1, 0, 0.62, 2.0, b.BARK, 24); s.cone(0, 0.1, 1.95, 0.9, 0.9, b.STRAW, 28); top = 2.4
            s.box(0, -0.53, 0, 0.32, 0.06, 0.55, b.DARKWOOD)
        b.windmill(0, 0.1, top); b.sacks(0.75, -0.85, 3)
    elif typeId == 'bakery':
        top = b.body(1.9, 1.4, -0.3, 0.35); s.sphere(0.85, -0.6, 0.0, 0.42, b.STONE, 0.85); s.box(0.85, -1.0, 0.05, 0.22, 0.04, 0.18, b.GLOW)
        b.chimney(0.85, -0.6, 0.35, 0.35); b.chimney(0.3, 0.6, top - 0.3, 0.5)
        for i in range(3): s.sphere(-0.6 + i * 0.22, -0.95, 0.07, 0.09, s.mat('bread', 'b5763a'), 0.6)
    elif typeId == 'waterworks':
        b.body(1.2, 1.0, -0.35, 0.35)
        s.cyl(0.5, -0.5, 0, 0.32, 0.32, b.STONE, 20); s.cyl(0.5, -0.5, 0.28, 0.25, 0.04, b.WATER, 20)
        for dx in (-0.28, 0.28): s.box(0.5 + dx, -0.5, 0.3, 0.05, 0.05, 0.55, b.DARKWOOD)
        s.gable(0.5, -0.5, 0.85, 0.7, 0.5, 0.22, {'romans': b.REDTILE, 'egyptians': b.SAND, 'asians': b.TILE, 'amazons': b.STRAW}[R], over=0.03)
        s.put(SURV + 'bucket.glb', 0.95, -0.85, 0, 0, 0.8)
    elif typeId == 'fisher':
        b.body(1.3, 1.0, -0.3, 0.35); s.put(NAT + 'canoe.glb', 0.55, -0.6, 0, 60, 0.8)
        for dx in (-0.2, 0.2): s.box(-0.65 + dx, -0.7, 0, 0.04, 0.04, 0.5, b.DARKWOOD)
        s.box(-0.65, -0.7, 0.45, 0.45, 0.03, 0.03, b.DARKWOOD); s.put(SURV + 'fish.glb', -0.6, -0.72, 0.25, 0, 0.8)
        b.barrels(0.9, -0.1, 1)
    elif typeId == 'pig_farm':
        b.body(1.5, 1.2, -0.65, 0.5, wood=True); b.fence_pen(0.15, -1.25, 1.3, 0.6)
        for (x, y, r) in [(0.5, -0.8, 20), (0.95, -0.3, 200), (0.6, 0.2, 120)]: b.animal(x, y, r, b.PINK, 1.0)
    elif typeId == 'slaughterhouse':
        b.body(2.0, 1.4, -0.25, 0.35); b.barrels(0.8, -0.8, 2); b.fence_pen(-1.3, -1.3, -0.3, -0.7)
        b.animal(-0.8, -1.0, 30, b.PINK)
    elif typeId == 'winery':
        b.body(1.6, 1.3, -0.55, 0.45); b.barrels(-1.1, -0.9, 3)
        for i in range(3):
            for j in range(3):
                x, y = 0.5 + i * 0.38, -0.9 + j * 0.55
                s.box(x, y, 0, 0.04, 0.04, 0.5, b.WOOD); s.sphere(x, y, 0.4, 0.16, b.GREEN, 1.2)
                s.sphere(x + 0.06, y - 0.1, 0.3, 0.06, s.mat('grape', '4a2040'))
    elif typeId == 'brewery':
        top = b.body(2.0, 1.4, -0.25, 0.35); b.barrels(0.85, -0.8, 3); b.chimney(0.4, 0.55, top - 0.3, 0.5)
        s.cyl(-0.8, -0.85, 0, 0.28, 0.4, b.COPPER, 20)
    elif typeId == 'rice_farm':
        b.body(1.5, 1.1, -0.65, 0.55)
        s.box(0.6, -0.4, 0, 1.4, 1.7, 0.03, b.WATER); s.box(0.6, -0.4, 0, 1.5, 1.8, 0.015, s.mat('mud', '4a3a24'))
        for i in range(5):
            for j in range(6): s.put(NAT + 'grass.glb', 0.05 + i * 0.28, -1.15 + j * 0.28, 0.03, i * 37 + j * 11, 0.9)
    elif typeId == 'distillery':
        top = b.body(1.8, 1.4, -0.35, 0.35)
        s.cyl(0.85, -0.7, 0, 0.26, 0.45, b.COPPER, 20); s.cone(0.85, -0.7, 0.45, 0.26, 0.3, b.COPPER, 20)
        s.cyl(0.85, -0.7, 0.7, 0.04, 0.35, b.COPPER, 8); b.barrels(-0.8, -0.9, 2)
    elif typeId == 'beekeeper':
        b.body(1.2, 1.0, -0.35, 0.35)
        for (x, y) in [(0.45, -0.7), (0.85, -0.45), (0.85, -0.9)]:
            s.cyl(x, y, 0, 0.04, 0.12, b.WOOD, 6); s.cone(x, y, 0.1, 0.17, 0.3, b.STRAW, 16)
        s.put(NAT + 'flower_yellowA.glb', -0.6, -0.8, 0, 0, 1.3); s.put(NAT + 'flower_redA.glb', -0.85, -0.6, 0, 0, 1.3)
    elif typeId == 'mead_maker':
        b.body(2.0, 1.4, -0.25, 0.35); b.barrels(0.85, -0.85, 3)
        for i in range(3): s.cyl(-0.9 + i * 0.25, -1.0, 0, 0.09, 0.2, s.mat('honeypot', 'c98a2a', rough=0.35))
    elif typeId == 'donkey_ranch':
        b.body(1.5, 1.2, -0.65, 0.5, wood=True); b.fence_pen(0.15, -1.25, 1.3, 0.6)
        for (x, y, r) in [(0.55, -0.75, 30), (0.95, -0.1, 210)]: b.animal(x, y, r, b.GREY, 1.4)
    elif typeId == 'guard_tower_small':
        b.tower(1.1, 2.6, 0, 0.1)
    elif typeId == 'guard_tower_large':
        b.tower(1.5, 3.6, -0.2, 0.2)
        if R == 'amazons':
            for k in range(7): s.put(SURV + 'fence-fortified.glb', -1.3 + k * 0.45, -1.2, 0, 0, 0.6)
        else:
            for x in (-1.2, 1.1): s.put(CASTLE + 'wall-half.glb', x, -0.9, 0, 90, 0.7) if R == 'romans' else s.box(x, -0.9, 0, 0.3, 0.9, 0.6, b.SAND if R == 'egyptians' else b.PLINTH)
    elif typeId == 'castle':
        castle(b)
    elif typeId == 'lookout':
        if R == 'amazons': b.tower_amazons(1.0, 3.6, 0, 0.1)
        else:
            m = {'romans': b.WOOD, 'egyptians': b.SANDDARK, 'asians': b.LACQUER}[R]
            for (x, y) in [(-0.35, -0.35), (0.35, -0.35), (0.35, 0.35), (-0.35, 0.35)]: s.box(x, y + 0.1, 0, 0.1, 0.1, 3.0, m)
            for z in (1.0, 2.0):
                for sgn in (-1, 1): s.box(0, 0.1 + sgn * 0.35, z, 0.8, 0.05, 0.05, m); s.box(sgn * 0.35, 0.1, z, 0.05, 0.8, 0.05, m)
            s.box(0, 0.1, 3.0, 1.0, 1.0, 0.1, b.DARKWOOD)
            roof = {'romans': b.REDTILE, 'egyptians': b.SAND, 'asians': b.TILE}[R]
            if R == 'asians': s.curved_roof(0, 0.1, 3.5, 0.65, 0.65, 0.35, 0.15, b.TILE)
            else: s.taper(0, 0.1, 3.5, 1.1, 0.05, 0.5, roof)
            for (x, y) in [(-0.45, -0.35), (0.45, -0.35), (0.45, 0.55), (-0.45, 0.55)]: s.box(x, y, 3.1, 0.06, 0.06, 0.42, m)
    elif typeId == 'barracks':
        top = b.body(2.3, 1.5, -0.15, 0.3, floors=1, roof='high')
        b.banner(1.1, -0.9, 1.5); b.banner(-1.1, -0.9, 1.5)
        for i in range(3): s.box(-0.3 + i * 0.25, -1.05, 0, 0.04, 0.04, 0.6, b.IRON)
    elif typeId == 'gunpowder_maker':
        top = b.body(1.8, 1.4, -0.35, 0.35); b.chimney(0.2, 0.55, top - 0.35, 0.5)
        for i in range(3): s.put(SURV + 'barrel.glb', 0.6 + (i % 2) * 0.34, -0.8 - (i // 2) * 0.3, 0, i * 30, 0.9)
        s.put(SURV + 'bucket.glb', -0.85, -0.9, 0, 0, 0.8)
    elif typeId == 'residence_small':
        b.body(1.4, 1.1, -0.1, 0.25); s.put(NAT + 'plant_bush.glb', 0.75, -0.7, 0, 0, 1.2); s.put(NAT + 'flower_redA.glb', -0.65, -0.75, 0, 0, 1.2)
    elif typeId == 'residence_medium':
        b.body(2.0, 1.4, -0.15, 0.3, floors=2); s.put(NAT + 'plant_bush.glb', 1.05, -0.8, 0, 0, 1.3); b.fence_pen(-1.3, -1.3, -0.5, -0.85)
    elif typeId == 'residence_large':
        b.body(2.8, 1.9, -0.2, 0.4, floors=2); b.body(1.1, 1.1, 1.3, -0.95)
        s.put(NAT + 'tree_oak.glb', -1.5, -1.4, 0, 0, 1.0); s.put(NAT + 'plant_bush.glb', 0.3, -1.5, 0, 0, 1.3)
    elif typeId == 'storage':
        b.body(2.3, 1.6, -0.15, 0.4, roof='high', wood=True)
        b.crates(0.4, -0.85, 3); b.barrels(-1.15, -0.9, 2); b.sacks(-0.4, -1.1, 3)
    elif typeId == 'healer':
        b.body(1.4, 1.1, -0.15, 0.25); b.banner(0.75, -0.6, 1.2, s.mat('white', 'e8e2d2'))
        for (x, y) in [(-0.7, -0.75), (-0.45, -0.85), (0.3, -0.85)]: s.put(NAT + 'plant_bushSmall.glb', x, y, 0, 0, 1.2)
    elif typeId == 'marketplace':
        for (x, y, st) in [(-0.6, -0.5, 'stall-red'), (0.6, -0.5, 'stall-green'), (-0.6, 0.6, 'stall-green'), (0.6, 0.6, 'stall-red')]:
            s.put(TOWN + st + '.glb', x, y, 0, 0, 0.9)
        b.crates(-0.3, -1.2, 2); b.barrels(0.9, -1.2, 2); b.sacks(0.0, 0.0, 3)
    elif typeId in ('catapult_hall', 'ballista_hall', 'cannon_hall', 'gong_hall'):
        # A big workshop with its machine standing in the yard, and parts waiting.
        b.body(2.2, 1.4, -0.35, 0.45, roof='high', wood=True)
        if typeId in ('catapult_hall', 'ballista_hall'):
            s.put(CASTLE + ('siege-catapult.glb' if typeId == 'catapult_hall' else 'siege-ballista.glb'), 0.75, -0.85, 0, 200, 0.5)
        elif typeId == 'cannon_hall':
            s.box(0.8, -0.85, 0.08, 0.5, 0.26, 0.08, b.WOOD)
            for y in (-1.02, -0.68): s.cyl(0.7, y, 0.02, 0.14, 0.04, b.WOOD, 14, rot=(math.pi / 2, 0, 0)).location.z = 0.14
            barrel = s.cyl(0.9, -0.85, 0.26, 0.075, 0.6, b.IRON, 16, rot=(0, math.pi / 2 - 0.2, 0)); barrel.location = (0.9, -0.85, 0.28)
            b.barrels(-1.1, -1.0, 2)
        else:
            s.box(0.8, -0.85, 0.08, 0.55, 0.32, 0.07, b.WOOD)
            for y in (-0.98, -0.72): s.box(0.8, y, 0.15, 0.04, 0.04, 0.6, b.WOOD)
            s.box(0.8, -0.85, 0.74, 0.05, 0.34, 0.04, b.WOOD)
            bpy.ops.mesh.primitive_cylinder_add(vertices=28, radius=0.24, depth=0.03, location=(0.8, -0.85, 0.45))
            gong = bpy.context.object; gong.rotation_euler = (0, math.pi / 2, 0); gong.data.materials.append(b.GOLD)
        s.put(SURV + 'workbench-anvil.glb', -0.95, -0.95, 0, 0, 0.8)
        for i in range(3): s.box(-0.35 + i * 0.18, -1.15, 0, 0.14, 0.07, 0.06, b.IRON)
    else:
        raise KeyError(typeId)


def castle(b):
    s, R = b.s, b.race
    if R == 'romans':
        for (x, y) in [(-1.4, -1.2), (1.2, -1.2), (-1.4, 1.2), (1.2, 1.2)]:
            s.put(CASTLE + 'tower-square-base.glb', x, y, 0, 0, 1.0); s.put(CASTLE + 'tower-square-mid-windows.glb', x, y, 1, 0, 1.0)
            s.put(CASTLE + 'tower-square-top-roof.glb', x, y, 2, 0, 1.0)
        # One stretched wall per side between the corner towers; overlapping pieces flicker in the render.
        for (x, y, sx, sy) in [(-0.1, -1.2, 1.6, 1.0), (-0.1, 1.2, 1.6, 1.0), (-1.4, 0, 1.0, 1.4), (1.2, 0, 1.0, 1.4)]:
            s.put(CASTLE + 'wall.glb', x, y, 0, 0, (sx, sy, 1.0))
        s.put(CASTLE + 'gate.glb', 0.5, -1.72, 0, 90, 1.0)
        s.box(-0.1, 0, 0, 2.2, 2.0, 1.0, b.STONE)   # the courtyard, so no gaps show through
        s.put(CASTLE + 'tower-hexagon-base.glb', -0.1, 0.3, 0, 0, 1.4); s.put(CASTLE + 'tower-hexagon-mid.glb', -0.1, 0.3, 1.4, 0, 1.4)
        s.put(CASTLE + 'tower-hexagon-roof.glb', -0.1, 0.3, 2.8, 0, 1.4); s.put(CASTLE + 'flag.glb', -0.1, 0.3, 4.3, 0, 1.0)
    elif R == 'egyptians':
        s.box(0, 0.1, 0, 3.4, 3.0, 0.9, b.SAND); s.box(0, 0.1, 0.9, 3.5, 3.1, 0.08, b.SANDDARK)
        b.tower_egyptians(1.6, 3.2, -0.2, 0.4)
        for (x, y) in [(-1.6, -1.35), (1.6, -1.35), (-1.6, 1.55), (1.6, 1.55)]: s.taper(x, y, 0, 0.6, 0.45, 1.5, b.SAND)
        s.box(0.5, -1.42, 0, 0.55, 0.06, 0.75, b.SLIT); s.box(0.5, -1.44, 0.75, 0.8, 0.06, 0.12, b.BLUE)
        s.put(NAT + 'tree_palmTall.glb', 1.85, -1.8, 0, 0, 1.4)
    elif R == 'asians':
        s.box(0, 0.1, 0, 3.4, 3.0, 0.2, b.PLINTH)
        for (x, y, w, d) in [(0, -1.3, 3.2, 0.2), (0, 1.5, 3.2, 0.2), (-1.6, 0.1, 0.2, 3.0), (1.6, 0.1, 0.2, 3.0)]:
            s.box(x, y, 0.2, w, d, 0.6, b.PLASTER); s.box(x, y, 0.8, w + 0.12, d + 0.12, 0.08, b.TILE)
        s.box(0.5, -1.42, 0.2, 0.6, 0.06, 0.55, b.LACQUER)
        b.tower_asians(1.4, 3.0, -0.1, 0.35)
    else:
        for k in range(26):
            a = k * 2 * math.pi / 26; r = 1.65
            if abs(math.cos(a) - 0.3) < 0.15 and math.sin(a) < -0.9: continue
            s.cyl(r * math.cos(a), 0.1 + r * math.sin(a), 0, 0.1, 0.9 + (k % 2) * 0.15, b.BARK, 8)
        b.body_amazons(1.9, 1.9, -0.1, 0.35, 1, 'gable', False)
        b.tower_amazons(0.9, 3.2, 1.0, -0.6)
        b.banner(-1.3, -1.0, 1.6, b.GREEN)


def scaffold(n):
    s = Scene(None); b = Builder.__new__(Builder); b.s = s; b.n = n
    wood = s.mat('wood', '7a5230', noise=6, stretch=(1, 1, 6))
    a = n / 2 - 0.25
    for x in (-a, 0, a):
        for y in (-a, 0, a):
            if x == 0 and y == 0: continue
            s.cyl(x, y, 0, 0.04, 1.5, wood, 6)
    for z in (0.5, 1.0, 1.45):
        for sgn in (-1, 1):
            s.box(0, sgn * a, z, 2 * a + 0.1, 0.05, 0.04, wood); s.box(sgn * a, 0, z, 0.05, 2 * a + 0.1, 0.04, wood)
    s.box(0, -a - 0.12, 0.5, 2 * a, 0.25, 0.03, wood)
    return s


def render_one(race, typeId):
    n = SIZES[typeId]
    b = Builder(race, n)
    recipe(b, typeId)
    b.s.camera(CANVAS[n], int(CANVAS[n] * 1.25), target_z=0.9)
    out = os.path.join(RENDERS, 'buildings', race, typeId + '.png')
    b.s.render(out, 32)
    write_meta(out[:-4] + '.json', {'anchor': b.s.anchor(), 'size': n})


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    only = None
    if '--only' in args:
        i = args.index('--only'); only = set(args[i + 1].split(',')); args = args[:i] + args[i + 2:]
    races = [a for a in args if a in RACES] or list(RACES)
    if 'scaffold' in args or not only:
        for n in (2, 3, 4):
            s = scaffold(n); s.camera(CANVAS[n], int(CANVAS[n] * 1.25), target_z=0.9); out = os.path.join(RENDERS, 'buildings', 'scaffold', f'{n}.png')
            s.render(out, 24); write_meta(out[:-4] + '.json', {'anchor': s.anchor(), 'size': n})
    for race in races:
        for typeId in SIZES:
            if only and typeId not in only: continue
            if race not in ONLY.get(typeId, RACES): continue
            render_one(race, typeId)


main()
