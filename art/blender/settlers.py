"""Renders settler sprite frames: every look, for every people, in 8 directions.

Run: blender -b --python art/blender/settlers.py -- [race ...] [--only look,look] [--anims anim,anim]
(--anims renders just those animations of the looks and keeps the frames already rendered for the others.)
Writes art/.renders/settlers/<race>/<look>/<anim>_<dir>_<frame>.png and <look>.json with the anchor.
Direction d faces game direction (sin(d*45deg), cos(d*45deg)): 0 = south (+y), 2 = east (+x), 4 = north, 6 = west.
"""
import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from nature import weapon_sword, weapon_spear, weapon_bow

SCALE = 0.9
CELL = (88, 96)
FRAMES = {'walk': 8, 'carry': 8, 'work': 6, 'attack': 6, 'die': 6, 'kick': 6}
# A carrier with nothing to do kicks a pebble now and then.
SOURCE = {'walk': 'walk', 'work': 'interact-right', 'attack': 'attack-melee-right', 'die': 'die', 'kick': 'attack-kick-right'}
# Kit movements that fit each look's work better than the generic reach: a swing for axes, hammers and picks,
# bending down for digging, sowing and planting, and the draw for the bow.
LOOK_SOURCES = {
    'builder': {'work': 'attack-melee-right'}, 'woodcutter': {'work': 'attack-melee-right'},
    'stonecutter': {'work': 'attack-melee-right'}, 'geologist': {'work': 'attack-melee-right'},
    'carrier': {'work': 'pick-up'}, 'digger': {'work': 'pick-up'}, 'pioneer': {'work': 'pick-up'}, 'farmer': {'work': 'pick-up'},
    'bowman': {'attack': 'holding-both-shoot'},
    # The fisher casts: a swing of the rod.
    'fisher': {'work': 'attack-melee-right'},
}
# Tools drawn half again as large as life, so they read at normal zoom.
TOOL_SCALE = 1.5

# look -> (model, tool, animations). Several settler types share a look (see the client's sprite table).
LOOKS = {
    'carrier': ('character-male-a', None, ('walk', 'carry', 'work', 'kick')),
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
    'swordsman': ('character-male-e', 'sword', ('walk', 'attack', 'die')),
    'spearman': ('character-male-b', 'spear', ('walk', 'attack', 'die')),
    'bowman': ('character-female-c', 'bow', ('walk', 'attack', 'die')),
    'priest': ('character-male-f', 'staff', ('walk', 'work')),
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
    k = TOOL_SCALE
    handle = s.cyl(x, y, z - 0.08 * k, 0.014 * k, 0.36 * k, wood, 6)
    top = z + 0.27 * k
    if tool == 'tool-axe': heads = [s.box(x, y - 0.035 * k, top - 0.06 * k, 0.02 * k, 0.07 * k, 0.08 * k, steel)]
    elif tool == 'tool-hammer': heads = [s.box(x, y, top - 0.02 * k, 0.05 * k, 0.1 * k, 0.05 * k, steel)]
    elif tool == 'tool-pickaxe':
        heads = [s.box(x, y, top - 0.02 * k, 0.025 * k, 0.2 * k, 0.03 * k, steel)]
    elif tool == 'tool-shovel':
        handle.location.z -= 0.1 * k; heads = [s.box(x, y, z - 0.2 * k, 0.02 * k, 0.08 * k, 0.1 * k, steel)]
    elif tool == 'tool-hoe': heads = [s.box(x, y - 0.04 * k, top - 0.03 * k, 0.02 * k, 0.09 * k, 0.03 * k, steel)]
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
    elif tool == 'staff':
        props = [s.cyl(hx, hy, hz - 0.3, 0.016, 0.75, s.mat('staff', '6a4a2a'), 8),
                 s.sphere(hx, hy, hz + 0.47, 0.05, s.mat('orb', 'c9b2ff', rough=0.2))]
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


def render_look(race, look, only_anims=None):
    s, arm, root, actions, anims = build(race, look)
    s.camera(*CELL, target_z=0.32)
    base = os.path.join(RENDERS, 'settlers', race, look)
    arm.animation_data_create()
    for anim in anims:
        if only_anims and anim not in only_anims: continue
        if anim == 'carry': act = carry_action(arm, actions['walk'], actions['holding-both'])
        else: act = actions[LOOK_SOURCES.get(look, {}).get(anim, SOURCE[anim])]
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
    only = None; only_anims = None
    if '--anims' in args:
        i = args.index('--anims'); only_anims = args[i + 1].split(','); args = args[:i] + args[i + 2:]
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
            render_look(race, look, only_anims)


if __name__ == "__main__":
    main()
