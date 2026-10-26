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


args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
for race in [a for a in args if a in RACES] or list(RACES):
    render(race, 'quick' in args)
