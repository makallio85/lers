"""Renders trees (by growth stage), rocks (by stone left), field stages, mountain and meadow decorations, and goods.

Run: blender -b --python art/blender/nature.py
Writes art/.renders/nature/<name>.png and art/.renders/goods/<good>.png, each with a .json anchor.
"""
import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

TREES = ['tree_oak', 'tree_default', 'tree_pineRoundB', 'tree_fat']
TREE_STAGES = [0.35, 0.6, 0.85, 1.3]          # saplings grow through these sizes; the last is a mature tree
ROCK_STAGES = [0.45, 0.7, 0.95, 1.2]          # by stone left, smallest first


def out(kind, name):
    return os.path.join(RENDERS, kind, name + '.png')


def shoot(s, path, canvas, target_z=0.0, samples=24, size=1):
    s.camera(canvas[0], canvas[1], target_z)
    s.render(path, samples)
    write_meta(path[:-4] + '.json', {'anchor': s.anchor(), 'size': size})


def trees():
    for t in TREES:
        for k, sc in enumerate(TREE_STAGES):
            s = Scene()
            s.put(NAT + t + '.glb', 0, 0, 0, 30 * k, sc)
            shoot(s, out('nature', f'{t}-{k}'), (192, 320), 1.2)


def rocks():
    for v in range(2):
        for k, sc in enumerate(ROCK_STAGES):
            s = Scene()
            parts = [(0, 0, 1.0), (0.25, -0.15, 0.7), (-0.25, 0.1, 0.6)][:1 + min(2, k)]
            for (x, y, f) in parts: s.put(CASTLE + 'rocks-large.glb', x * sc, y * sc, 0, 70 * v + 40 * k + x * 90, sc * f * 0.75)
            shoot(s, out('nature', f'rock{v}-{k}'), (256, 256), 0.3)


def fields():
    for k in range(4):
        s = Scene()
        s.box(0, 0, 0, 0.92, 0.92, 0.02, s.mat('soil', '4a3420', noise=6))
        if k > 0:
            crop = ['crops_wheatStageA', 'crops_wheatStageA', 'crops_wheatStageB'][k - 1]
            for i in range(2):
                for j in range(2): s.put(NAT + crop + '.glb', -0.22 + i * 0.44, -0.22 + j * 0.44, 0.02, 0, 0.9 if k > 1 else 0.55)
        if k == 3:
            for o in bpy.data.objects:
                for slot in getattr(o, 'material_slots', []):
                    if slot.material and slot.material.name.startswith('_defaultMat'):
                        slot.material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.75, 0.55, 0.15, 1)
        shoot(s, out('nature', f'field-{k}'), (160, 160), 0.2)


def decorations():
    for k, (path, sc) in enumerate([(NAT + 'grass_large.glb', 1.3), (NAT + 'grass.glb', 1.3), (NAT + 'flower_yellowA.glb', 1.2),
                                    (NAT + 'flower_redA.glb', 1.2), (NAT + 'plant_bushSmall.glb', 1.1), (NAT + 'mushroom_redGroup.glb', 1.1)]):
        s = Scene(); s.put(path, 0, 0, 0, 40 * k, sc); shoot(s, out('nature', f'meadow{k}'), (96, 96), 0.1)
    for k, (path, sc) in enumerate([(NAT + 'rock_tallA.glb', 1.4), (NAT + 'rock_tallB.glb', 1.4), (NAT + 'rock_largeB.glb', 1.2),
                                    (CASTLE + 'rocks-small.glb', 1.0)]):
        s = Scene(); s.put(path, 0, 0, 0, 60 * k, sc)
        for o in bpy.data.objects:
            for slot in getattr(o, 'material_slots', []):
                if slot.material and 'Principled BSDF' in slot.material.node_tree.nodes:
                    slot.material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.30, 0.28, 0.25, 1)
        shoot(s, out('nature', f'mountain{k}'), (160, 192), 0.4)


def goods():
    """A small model for every good, carried by settlers and shown in menus."""
    def one(name, build):
        s = Scene(); build(s); shoot(s, out('goods', name), (72, 72), 0.12, samples=24)
    sack = lambda c: (lambda s: (s.sphere(0, 0, 0.13, 0.15, s.mat('sack' + c, c, noise=20), 1.1), s.sphere(0, 0, 0.29, 0.05, s.mat('tie', '6a4a2a'))))
    lumps = lambda c: (lambda s: [s.sphere(x, y, z, 0.07, s.mat('lump' + c, c, rough=0.6)) for (x, y, z) in
                                  [(-0.06, 0, 0.06), (0.07, 0.03, 0.06), (0, -0.07, 0.06), (0, 0, 0.15)]])
    ingot = lambda c: (lambda s: [s.taper(0, 0, z, 0.26, 0.2, 0.08, s.mat('ingot' + c, c, rough=0.3, metal=0.7), 0.12, 0.08) for z in (0, 0.08)])
    bottle = lambda c: (lambda s: (s.cyl(0, 0, 0, 0.07, 0.2, s.mat('bottle' + c, c, rough=0.15)), s.cyl(0, 0, 0.2, 0.025, 0.1, s.mat('bottle' + c, c))))
    pot = lambda c: (lambda s: (s.sphere(0, 0, 0.12, 0.12, s.mat('pot' + c, c, rough=0.35), 1.0), s.cyl(0, 0, 0.2, 0.06, 0.06, s.mat('pot' + c, c))))
    barrel = lambda c: (lambda s: s.put(SURV + 'barrel.glb', 0, 0, 0, 0, 0.55))
    tool = lambda t, rot=90: (lambda s: s.put(SURV + t + '.glb', 0, 0, 0.02, rot, 0.75))
    def log(s):
        # Three brown logs, two below and one on top, with their pale cut ends toward the viewer.
        bark = s.mat('logbark', '7a4a26', noise=16); cut = s.mat('logcut', 'd8b07a')
        for (y, z) in [(-0.07, 0.0), (0.07, 0.0), (0.0, 0.11)]:
            s.cyl(0, y, z + 0.06 - 0.15, 0.06, 0.30, bark, 14, rot=(0, math.pi / 2, 0))
            s.cyl(0.151, y, z + 0.06 - 0.004, 0.052, 0.008, cut, 14, rot=(0, math.pi / 2, 0))
    def plank(s):
        # A stack of light, almost beige boards, crossed a little so they read as planks.
        wood = s.mat('plankwood', 'cfae78', noise=10)
        for k, rot in enumerate((0, 0, 8, -6)):
            for dy in (-0.05, 0.05):
                s.box(0, dy, k * 0.026, 0.34, 0.085, 0.022, wood, rot=rot)
    def stone(s): s.put(SURV + 'resource-stone.glb', 0, 0, 0, 0, 0.8)
    def bread(s): s.sphere(0, 0, 0.08, 0.13, s.mat('bread', 'b5763a', noise=12), 0.6)
    def fish(s): s.put(SURV + 'fish.glb', 0, 0, 0.05, 0, 0.9)
    def pig(s):
        m = s.mat('pig', 'd89a8a'); s.box(0, 0, 0.05, 0.26, 0.15, 0.14, m); s.box(0.16, 0, 0.1, 0.1, 0.1, 0.1, m)
    def meat(s): s.sphere(0, 0, 0.09, 0.11, s.mat('meat', 'a03a32'), 0.8); s.cyl(0.12, 0, 0.07, 0.025, 0.12, s.mat('bone', 'e8e0c8'), rot=(0, 1.57, 0))
    def water(s): s.put(SURV + 'bucket.glb', 0, 0, 0, 0, 0.8)
    def gems(s):
        for (x, y, c) in [(0, 0, '40c0c8'), (0.08, 0.05, '7a3ac8'), (-0.07, 0.04, 'c83a5a')]: s.cone(x, y, 0, 0.07, 0.2, s.mat('gem' + c, c, rough=0.1), n=6)
    def saw(s):
        s.box(0, 0, 0.02, 0.32, 0.02, 0.09, s.mat('steel', 'a0a4a8', rough=0.3, metal=0.8)); s.box(-0.2, 0, 0.02, 0.08, 0.04, 0.12, s.mat('handle', '6a4a2a'))
    def rod(s): s.cyl(0, 0, 0.02, 0.012, 0.42, s.mat('rod', '8a6a3a'), rot=(0, 1.2, 0.6))
    def sword(s): weapon_sword(s, 0, 0, 0.03, (0, 1.57, 0.7))
    def spear(s): weapon_spear(s, 0, 0, 0.03, (0, 1.57, 0.7), 0.7)
    def bow(s): weapon_bow(s, 0, 0, 0.12, (0, 0, 0.7))
    GOODS = {
        'log': log, 'plank': plank, 'stone': stone, 'grain': sack('c9a44a'), 'flour': sack('e8e2d2'), 'water': water, 'bread': bread,
        'fish': fish, 'pig': pig, 'meat': meat, 'coal': lumps('1e1c1a'), 'iron_ore': lumps('8a5a4a'), 'iron': ingot('8a8d90'),
        'gold_ore': lumps('b8963a'), 'gold': ingot('d8b040'), 'wine': bottle('5a1a2a'), 'beer': barrel('c9902a'), 'rice': sack('d8d0b8'),
        'rice_wine': bottle('d8d0b8'), 'honey': pot('c98a2a'), 'mead': bottle('a0602a'), 'sulfur': lumps('d8d040'), 'gems': gems,
        'gunpowder': sack('3a3a3a'), 'axe': tool('tool-axe'), 'saw': saw, 'pick': tool('tool-pickaxe'), 'scythe': tool('tool-hoe'),
        'shovel': tool('tool-shovel'), 'hammer': tool('tool-hammer'), 'rod': rod, 'sword': sword, 'spear': spear, 'bow': bow}
    for name, build in GOODS.items(): one(name, build)


# Weapons are simple scripted shapes, shared with the settler script.
def weapon_sword(s, x, y, z, rot, k=1.0):
    steel = s.mat('steel', 'a0a4a8', rough=0.3, metal=0.8); hilt = s.mat('hilt', '6a4a2a')
    a = s.box(x, y, z, 0.05 * k, 0.02 * k, 0.3 * k, steel); b = s.box(x, y, z - 0.02 * k, 0.12 * k, 0.03 * k, 0.025 * k, hilt)
    c = s.box(x, y, z - 0.1 * k, 0.025 * k, 0.025 * k, 0.08 * k, hilt)
    for o in (a, b, c): o.rotation_euler = rot
    return [a, b, c]


def weapon_spear(s, x, y, z, rot, length=0.8):
    shaft = s.cyl(x, y, z, 0.012, length, s.mat('shaft', '7a5a32'), 6); tip = s.cone(x, y, z + length, 0.03, 0.1, s.mat('steel', 'a0a4a8', rough=0.3, metal=0.8), 6)
    for o in (shaft, tip): o.rotation_euler = rot
    return [shaft, tip]


def weapon_bow(s, x, y, z, rot):
    bpy.ops.mesh.primitive_torus_add(major_radius=0.16, minor_radius=0.012, location=(x, y, z))
    o = bpy.context.object; o.data.materials.append(s.mat('bowwood', '6a4422'))
    o.scale = (0.45, 1, 1); o.rotation_euler = (math.pi / 2 + rot[0], rot[1], rot[2])
    return [o]


if __name__ == '__main__':
    which = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    for name, fn in [('trees', trees), ('rocks', rocks), ('fields', fields), ('decorations', decorations), ('goods', goods)]:
        if not which or name in which: fn()
