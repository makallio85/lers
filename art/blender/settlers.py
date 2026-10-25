"""Renders settler sprite frames: every look, for every people, in 8 directions.

Run: blender -b --python art/blender/settlers.py -- [race ...] [--only look,look]
Writes art/.renders/settlers/<race>/<look>/<anim>_<dir>_<frame>.png and <look>.json with the anchor.
Direction d faces game direction (sin(d*45deg), cos(d*45deg)): 0 = south (+y), 2 = east (+x), 4 = north, 6 = west.
"""
import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from nature import weapon_sword, weapon_spear, weapon_bow

SCALE = 0.9
CELL = (88, 96)
FRAMES = {'walk': 8, 'carry': 8, 'work': 6, 'attack': 6}
SOURCE = {'walk': 'walk', 'work': 'interact-right', 'attack': 'attack-melee-right'}

# look -> (model, tool, animations). Several settler types share a look (see the client's sprite table).
LOOKS = {
    'carrier': ('character-male-a', None, ('walk', 'carry')),
    'builder': ('character-male-b', 'tool-hammer', ('walk', 'work')),
    'digger': ('character-male-c', 'tool-shovel', ('walk', 'work')),
    'woodcutter': ('character-male-d', 'tool-axe', ('walk', 'work')),
    'stonecutter': ('character-male-e', 'tool-pickaxe', ('walk', 'work')),
    'farmer': ('character-female-a', 'tool-hoe', ('walk', 'work')),
    'fisher': ('character-male-f', 'rod', ('walk', 'work')),
    'worker': ('character-female-b', None, ('walk',)),
    'geologist': ('character-female-d', 'tool-hammer', ('walk', 'work')),
    'pioneer': ('character-female-e', 'tool-shovel', ('walk', 'work')),
    'thief': ('character-female-f', None, ('walk', 'work')),
    'swordsman': ('character-male-e', 'sword', ('walk', 'attack')),
    'spearman': ('character-male-b', 'spear', ('walk', 'attack')),
    'bowman': ('character-female-c', 'bow', ('walk', 'attack')),
}
SOLDIERS = ('swordsman', 'spearman', 'bowman')


def carry_action(arm, walk, hold):
    """The walk with the arms held forward, as if carrying something in both hands."""
    act = walk.copy(); act.name = 'carry'
    for fc in list(act.fcurves):
        if 'arm-left' in fc.data_path or 'arm-right' in fc.data_path: act.fcurves.remove(fc)
    for fc in hold.fcurves:
        if 'arm-left' not in fc.data_path and 'arm-right' not in fc.data_path: continue
        new = act.fcurves.new(fc.data_path, index=fc.array_index, action_group=fc.group.name if fc.group else '')
        v = fc.evaluate(hold.frame_range[0])
        new.keyframe_points.insert(walk.frame_range[0], v); new.keyframe_points.insert(walk.frame_range[1], v)
    return act


def attach(s, objs, arm, bone):
    """Parents props to a bone, keeping where they are now."""
    bpy.context.view_layer.update()
    for o in objs:
        mw = o.matrix_world.copy()
        o.parent = arm; o.parent_type = 'BONE'; o.parent_bone = bone
        o.matrix_world = mw


def hand_tool(s, tool, x, y, z):
    """A tool held upright in the right hand: a handle with the tool's head on top."""
    wood = s.mat('handle', '7a5a32'); steel = s.mat('steel', 'a0a4a8', rough=0.3, metal=0.8)
    handle = s.cyl(x, y, z - 0.08, 0.014, 0.36, wood, 6)
    top = z + 0.27
    if tool == 'tool-axe': heads = [s.box(x, y - 0.035, top - 0.06, 0.02, 0.07, 0.08, steel)]
    elif tool == 'tool-hammer': heads = [s.box(x, y, top - 0.02, 0.05, 0.1, 0.05, steel)]
    elif tool == 'tool-pickaxe':
        heads = [s.box(x, y, top - 0.02, 0.025, 0.2, 0.03, steel)]
    elif tool == 'tool-shovel':
        handle.location.z -= 0.1; heads = [s.box(x, y, z - 0.2, 0.02, 0.08, 0.1, steel)]
    elif tool == 'tool-hoe': heads = [s.box(x, y - 0.04, top - 0.03, 0.02, 0.09, 0.03, steel)]
    else: heads = []
    return [handle] + heads


def build(race, look):
    model, tool, anims = LOOKS[look]
    s = Scene(race)
    new = s.put(CHAR + model + '.glb', 0, 0, 0, 0, 1.0)
    for o in new:
        if o.name.startswith('Icosphere'): bpy.data.objects.remove(o)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    root = arm
    bpy.context.view_layer.update()
    head = arm.data.bones['arm-right'].head_local          # the shoulder; the hand hangs below it
    hx, hy, hz = head.x - 0.04, head.y - 0.05, head.z - 0.13
    props = []
    if tool in ('sword',):
        props = weapon_sword(s, hx, hy - 0.04, hz - 0.02, (math.radians(-75), 0, 0), 1.6)
    elif tool == 'spear':
        props = weapon_spear(s, hx, hy - 0.03, hz - 0.45, (math.radians(-8), 0, 0), 1.3)
    elif tool == 'bow':
        props = weapon_bow(s, -hx, hy - 0.02, hz + 0.05, (0, 0, 0))
    elif tool == 'rod':
        props = [s.cyl(hx, hy, hz - 0.05, 0.012, 0.6, s.mat('rod', '8a6a3a'), 6, rot=(math.radians(-50), 0, 0))]
    elif tool:
        props = hand_tool(s, tool, hx, hy, hz)
    if look in SOLDIERS:
        head = arm.matrix_world @ arm.data.bones['head'].head_local
        helm = s.sphere(head.x, head.y, head.z + 0.17, 0.13, s.mat('helmet', '8a8d90', rough=0.35, metal=0.7), 0.75)
        attach(s, [helm], arm, 'head')
    if props: attach(s, [o for o in props if o.parent is None], arm, 'arm-left' if tool == 'bow' else 'arm-right')
    arm.scale = (SCALE, SCALE, SCALE)
    actions = {a.name.split('_')[0]: a for a in bpy.data.actions}
    return s, arm, root, actions, anims


def render_look(race, look):
    s, arm, root, actions, anims = build(race, look)
    s.camera(*CELL, target_z=0.32)
    base = os.path.join(RENDERS, 'settlers', race, look)
    arm.animation_data_create()
    for anim in anims:
        if anim == 'carry': act = carry_action(arm, actions['walk'], actions['holding-both'])
        else: act = actions[SOURCE[anim]]
        arm.animation_data.action = act
        f0, f1 = act.frame_range; n = FRAMES[anim]
        for d in range(8):
            root.rotation_euler = (0, 0, math.radians(d * 45))
            for k in range(n):
                s.sc.frame_set(int(round(f0 + (f1 - f0) * k / n)))
                s.render(os.path.join(base, f'{anim}_{d}_{k}.png'), 12)
    write_meta(base + '.json', {'anchor': s.anchor(), 'anims': {a: FRAMES[a] for a in anims}, 'cell': list(CELL)})


def quick(race, looks):
    for look in looks:
        s, arm, root, actions, anims = build(race, look)
        s.camera(*CELL, target_z=0.32)
        arm.animation_data_create(); arm.animation_data.action = actions[(SOURCE[anims[1]] if anims[1] != 'carry' else 'holding-both') if len(anims) > 1 else 'walk']
        root.rotation_euler = (0, 0, math.radians(45)); s.sc.frame_set(3)
        s.render(os.path.join(RENDERS, 'quick', race, look + '.png'), 12)


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    only = None
    if '--only' in args:
        i = args.index('--only'); only = args[i + 1].split(','); args = args[:i] + args[i + 2:]
    races = [a for a in args if a in RACES] or list(RACES)
    if 'quick' in args:
        for race in races: quick(race, only or LOOKS)
        return
    for race in races:
        for look in (only or LOOKS):
            # A look is finished once its .json is written; skip it so an interrupted run can resume.
            if not only and os.path.exists(os.path.join(RENDERS, 'settlers', race, look + '.json')): continue
            render_look(race, look)


main()
