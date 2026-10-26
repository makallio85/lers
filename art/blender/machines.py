"""Renders the four war machines in 8 directions, rolling and firing, in the settler sheet layout.

Run: blender -b --python art/blender/machines.py -- [quick]
Writes art/.renders/settlers/<race>/<machine>/<anim>_<dir>_<frame>.png and <machine>.json, so pack.py packs
them like settler sheets. Direction d faces game direction (sin(d*45deg), cos(d*45deg)), as for settlers.
"""
import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

CELL = (128, 120)
FRAMES = {'walk': 4, 'attack': 6}
# Each people's machine; the kit models point along +X, so they turn -90 degrees to face direction 0 (south).
MACHINES = {'romans': 'catapult', 'egyptians': 'ballista', 'asians': 'cannon', 'amazons': 'war_gong'}
DONKEY_FRAMES = {'walk': 6}


def build(race, machine):
    s = Scene(race)
    root = bpy.data.objects.new('machine', None); s.sc.collection.objects.link(root)
    parts, moving = [], []
    wood = s.mat('mwood', '6a4628', noise=8, stretch=(1, 1, 6)); dark = s.mat('mdark', '2e2a26')
    iron = s.mat('miron', '5a5d60', rough=0.4, metal=0.7); bronze = s.mat('bronze', 'b07a30', rough=0.3, metal=0.8)
    if machine in ('catapult', 'ballista'):
        before = set(bpy.data.objects)
        s.put(CASTLE + ('siege-catapult.glb' if machine == 'catapult' else 'siege-ballista.glb'), 0, 0, 0, 0, 0.6)
        parts = [o for o in bpy.data.objects if o not in before and o.parent is None]
    elif machine == 'cannon':
        # A bronze-bound barrel on a two-wheeled carriage.
        parts += [s.box(0, 0, 0.12, 0.62, 0.32, 0.1, wood)]
        for y in (-0.2, 0.2):
            w = s.cyl(-0.12, y, 0.02, 0.17, 0.05, wood, 16, rot=(math.pi / 2, 0, 0)); w.location.z = 0.17; parts.append(w)
        barrel = s.cyl(0.08, 0, 0.3, 0.09, 0.7, iron, 18, rot=(0, math.pi / 2 - 0.18, 0)); barrel.location = (0.12, 0, 0.32)
        ring = s.cyl(0.42, 0, 0.36, 0.105, 0.06, bronze, 18, rot=(0, math.pi / 2 - 0.18, 0)); ring.location = (0.44, 0, 0.38)
        parts += [barrel, ring]; moving = [barrel, ring]
    else:
        # A great gong hung in a wooden frame on a low cart.
        parts += [s.box(0, 0, 0.1, 0.7, 0.4, 0.08, wood)]
        for x in (-0.3, 0.3):
            w = s.cyl(x, 0, 0, 0.12, 0.46, wood, 14, rot=(math.pi / 2, 0, 0)); w.location.z = 0.12; parts.append(w)
        for y in (-0.16, 0.16): parts.append(s.box(0, y, 0.18, 0.05, 0.05, 0.75, wood))
        parts.append(s.box(0, 0, 0.92, 0.06, 0.44, 0.05, wood))
        bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.3, depth=0.04, location=(0, 0, 0.58)); gong = bpy.context.object
        gong.rotation_euler = (0, math.pi / 2, 0); gong.data.materials.append(bronze); parts.append(gong); moving = [gong]
        boss = s.sphere(0.03, 0, 0.58, 0.06, bronze, 0.5); boss.scale = (0.5, 1, 1); parts.append(boss); moving.append(boss)
    bpy.context.view_layer.update()
    for o in parts:
        mw = o.matrix_world.copy(); o.parent = root; o.matrix_world = mw
    root.rotation_mode = 'XYZ'
    return s, root, moving


def pose(root, moving, machine, anim, d, k, n):
    root.rotation_euler = (0, 0, math.radians(d * 45 - 90))
    t = k / n
    # Rolling: a gentle rock; firing: a kick back and settle, the gong swings.
    root.location = (0, 0, 0.012 * math.sin(t * 2 * math.pi) if anim == 'walk' else 0)
    if anim == 'attack':
        kick = math.sin(min(1, t * 3) * math.pi) * (1 - t)
        f = math.radians(d * 45)
        root.location = (-math.sin(f) * 0.06 * kick, math.cos(f) * 0.06 * kick, 0)
        for o in moving:
            if machine == 'war_gong': o.rotation_euler = (0.35 * math.sin(t * 2 * math.pi), math.pi / 2, 0)


def render(race, quick=False):
    machine = MACHINES[race]
    s, root, moving = build(race, machine)
    s.camera(*CELL, target_z=0.3)
    base = os.path.join(RENDERS, 'settlers', race, machine)
    for anim, n in FRAMES.items():
        for d in range(8):
            if quick and (anim != 'walk' or d % 2): continue
            for k in range(1 if quick else n):
                pose(root, moving, machine, anim, d, k, n)
                s.render(os.path.join(base, f'{anim}_{d}_{k}.png'), 16)
    if not quick: write_meta(base + '.json', {'anchor': s.anchor(), 'anims': FRAMES, 'cell': list(CELL)})


def donkey():
    """A donkey with pack bags, walking: one sheet shared by every people."""
    s = Scene(None)
    root = bpy.data.objects.new('donkey', None); s.sc.collection.objects.link(root); root.rotation_mode = 'XYZ'
    hide = s.mat('hide', '7d746a', noise=10); dark = s.mat('mane', '3a332c'); bag = s.mat('bag', 'a07a48', noise=12)
    parts = [s.box(0, 0, 0.24, 0.5, 0.2, 0.2, hide), s.box(0.3, 0, 0.36, 0.12, 0.12, 0.14, hide),
             s.box(0.38, 0, 0.36, 0.14, 0.1, 0.09, hide), s.box(0.3, 0, 0.5, 0.04, 0.03, 0.1, dark), s.box(0.3, 0.04, 0.5, 0.04, 0.03, 0.1, dark),
             s.box(-0.27, 0, 0.36, 0.04, 0.04, 0.12, dark)]
    for y in (-0.13, 0.13): parts.append(s.box(0.02, y, 0.26, 0.24, 0.07, 0.16, bag))
    legs = []
    for x in (-0.18, 0.18):
        for y in (-0.07, 0.07):
            leg = s.box(x, y, 0, 0.06, 0.06, 0.25, hide); legs.append(leg); parts.append(leg)
    bpy.context.view_layer.update()
    for o in parts:
        mw = o.matrix_world.copy(); o.parent = root; o.matrix_world = mw
    s.camera(*CELL, target_z=0.2)
    base = os.path.join(RENDERS, 'settlers', 'romans', 'donkey')
    n = DONKEY_FRAMES['walk']
    for d in range(8):
        root.rotation_euler = (0, 0, math.radians(d * 45 - 90))
        for k in range(n):
            t = k / n
            for i, leg in enumerate(legs):
                leg.rotation_euler = (0, 0.45 * math.sin(2 * math.pi * t + (math.pi if i in (1, 2) else 0)), 0)
            root.location = (0, 0, 0.01 * abs(math.sin(2 * math.pi * t)))
            s.render(os.path.join(base, f'walk_{d}_{k}.png'), 16)
    write_meta(base + '.json', {'anchor': s.anchor(), 'anims': DONKEY_FRAMES, 'cell': list(CELL)})


SHIP_CELL = (352, 384)
SHIP_FRAMES = {'walk': 4}
# Kit ship per ship type, and its scale: a transport ship is about three tiles long, a trade ship two and a half.
SHIPS = {'transport_ship': ('ship-medium', 0.27), 'trade_ship': ('ship-small', 0.27)}


def ship(kind, quick=False):
    """A sailing ship rocking on the swell, in 8 directions: one sheet shared by every people."""
    model, scale = SHIPS[kind]
    s = Scene(None)
    root = bpy.data.objects.new(kind, None); s.sc.collection.objects.link(root); root.rotation_mode = 'XYZ'
    parts = [o for o in s.put(PIRATE + model + '.glb', 0, 0, 0, 0, scale) if o.parent is None]
    bpy.context.view_layer.update()
    for o in parts:
        mw = o.matrix_world.copy(); o.parent = root; o.matrix_world = mw
    s.camera(*SHIP_CELL, target_z=1.15)
    base = os.path.join(RENDERS, 'settlers', 'romans', kind)
    n = SHIP_FRAMES['walk']
    for d in range(8):
        if quick and d % 2: continue
        for k in range(1 if quick else n):
            t = k / n
            # The kit's bow points along -Y, which is game direction 0.
            root.rotation_euler = (0.035 * math.sin(2 * math.pi * t), 0.02 * math.cos(2 * math.pi * t), math.radians(d * 45))
            root.location = (0, 0, 0.02 * math.sin(2 * math.pi * t))
            s.render(os.path.join(base, f'walk_{d}_{k}.png'), 16)
    if not quick: write_meta(base + '.json', {'anchor': s.anchor(), 'anims': SHIP_FRAMES, 'cell': list(SHIP_CELL)})


args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if 'donkey' in args:
    donkey()
    sys.exit(0)
if 'ships' in args:
    for kind in SHIPS: ship(kind, 'quick' in args)
    sys.exit(0)
for race in [a for a in args if a in RACES] or list(RACES):
    render(race, 'quick' in args)
