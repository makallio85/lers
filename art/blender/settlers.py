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
# Room added around the cell (left, top, right, bottom, render pixels): the low sun throws a settler's shadow far to
# the right, and soldiers swing weapons and fall wide. pack.py crops each look back to what its frames use.
PAD = (12, 8, 72, 6)
SOLDIER_PAD = (36, 28, 104, 22)
FRAMES = {'walk': 8, 'carry': 8, 'work': 6, 'attack': 6, 'die': 6, 'kick': 6}
# A carrier with nothing to do kicks a pebble now and then.
SOURCE = {'walk': 'walk', 'work': 'interact-right', 'attack': 'attack-melee-right', 'die': 'die', 'kick': 'attack-kick-right'}
# Kit movements that fit each look's work better than the generic reach: a swing for axes, hammers and picks,
# bending down for digging, sowing and planting, and the draw for the bow.
LOOK_SOURCES = {
    'builder': {'work': 'attack-melee-right'}, 'woodcutter': {'work': 'attack-melee-right'},
    'stonecutter': {'work': 'attack-melee-right'}, 'geologist': {'work': 'pick-up'},
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
    # The sawmill's carpenter works outside, at a sawhorse by the door: walking, carrying the plank, sawing.
    'carpenter': ('character-male-c', 'saw', ('walk', 'carry', 'work')),
    'geologist': ('character-female-d', None, ('walk', 'work')),
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


SAW_FORWARD, SAW_BACK = math.radians(float(os.environ.get('SAW_A', '85'))), math.radians(float(os.environ.get('SAW_B', '55')))


def saw_action(arm, still):
    """Sawing: the still pose with the right arm held out over the sawhorse, pushing the saw forward and drawing it
    back, one stroke out and back over the action."""
    act = still.copy(); act.name = 'saw'
    for fc in list(act.fcurves):
        if 'arm-right' in fc.data_path: act.fcurves.remove(fc)
    arm.animation_data_create(); arm.animation_data.action = act
    pb = arm.pose.bones['arm-right']; pb.rotation_mode = 'QUATERNION'
    from mathutils import Quaternion
    for frame, angle in ((0, SAW_FORWARD), (6, SAW_BACK), (12, SAW_FORWARD)):
        pb.rotation_quaternion = Quaternion((1, 0, 0), angle)
        pb.keyframe_insert('rotation_quaternion', frame=frame)
    act.frame_range = (0, 12)
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


def soldier_gear(s, arm, look):
    """What makes a soldier read as one beside the workers: a helmet with a crest, a breastplate and belt, a round
    shield on the off arm for swordsmen and spearmen, and for bowmen a leather cap and jerkin with a quiver on the
    back. Sizes follow the kit's blocky characters (head about 0.45 wide, top at 0.68; torso 0.18 to 0.34;
    facing -Y)."""
    steel = s.mat('armour', 'b4b9be', rough=0.32, metal=0.85)
    leather = s.mat('leather', '6b4a2b', rough=0.75)
    crest = s.mat('crest', 'b3261e', rough=0.6)
    wood = s.mat('shield-wood', '6e4626', rough=0.7, wave=14, stretch=(1, 1, 1))
    is_bow = look == 'bowman'
    cap = leather if is_bow else steel
    # Helmet: a square cap over the top of the kit's square head, cheek guards, and for the foot soldiers a nose
    # guard and a crest running front to back.
    top = s.box(0, 0.0, 0.595, 0.49, 0.38, 0.115, cap)
    head = [top, s.box(0.238, -0.02, 0.47, 0.03, 0.2, 0.14, cap), s.box(-0.238, -0.02, 0.47, 0.03, 0.2, 0.14, cap)]
    # The helmet's top (the bowman's cap) and the crest are drawn in the owner's colour: they go into the tint mask.
    top['tint'] = True
    if is_bow:
        head.append(s.box(0.2, 0.06, 0.70, 0.025, 0.04, 0.17, s.mat('feather', '4f9a3a', rough=0.6)))
    else:
        head.append(s.box(0, -0.195, 0.46, 0.05, 0.03, 0.14, steel))
        ridge = s.box(0, 0.0, 0.715, 0.07, 0.34, 0.1, crest); ridge['tint'] = True
        head.append(ridge)
    attach(s, head, arm, 'head')
    # Body: a breastplate (a jerkin for bowmen) over the tunic, and a belt.
    body = [s.box(0, 0.028, 0.185, 0.3, 0.32, 0.16, leather if is_bow else steel),
            s.box(0, 0.028, 0.165, 0.31, 0.33, 0.04, s.mat('belt', '3a2a1a', rough=0.7))]
    if is_bow:
        quiver = s.cyl(0.08, 0.21, 0.12, 0.055, 0.32, leather, 12, rot=(math.radians(18), math.radians(-12), 0))
        arrows = [s.box(0.08 + dx, 0.255, 0.43, 0.02, 0.02, 0.07, s.mat('fletch', 'e8e2d2', rough=0.6)) for dx in (-0.025, 0.0, 0.025)]
        body += [quiver] + arrows
    attach(s, body, arm, 'torso')
    if not is_bow:
        # A round shield on the left forearm, held forward: wood with a steel rim and a boss.
        face = (math.radians(90), 0, 0)
        sh = [s.cyl(0.2, -0.1, 0.0, 0.16, 0.022, steel, 28, rot=face), s.cyl(0.2, -0.113, 0.0, 0.142, 0.024, wood, 28, rot=face),
              s.sphere(0.2, -0.13, 0.0, 0.04, steel)]
        for o in sh: o.location.z = 0.21
        attach(s, sh, arm, 'arm-left')


def civilian_cap(s, arm):
    """A dark felt cap on every civilian, so a dark head reads as a worker and a coloured crest as a soldier. It sits
    over the top of the kit's square head (about 0.45 wide, top at 0.68) with a short brim at the front (facing -Y)."""
    felt = s.mat('cap-felt', '3a2a1f', rough=0.9)
    cap = [s.box(0, 0.0, 0.635, 0.46, 0.4, 0.1, felt), s.box(0, 0.01, 0.70, 0.34, 0.28, 0.04, felt),
           s.box(0, -0.22, 0.595, 0.3, 0.08, 0.025, felt)]
    attach(s, cap, arm, 'head')


def build(race, look):
    model, tool, anims = LOOKS[look]
    # One outfit for every civilian, another for soldiers; the priest keeps the people's robe.
    s = Scene(race, outfit='soldier' if look in SOLDIERS else None if look == 'priest' else 'civilian')
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
    elif tool == 'saw':
        # A frame-less handsaw held out in front, the blade pointing forward and down a little.
        steel = s.mat('saw-blade', 'c4c8cc', rough=0.25, metal=0.8); wood = s.mat('handle', '7a5a32')
        # The blade runs on from the hand along the arm, so with the arm held out it points forward and down.
        props = [s.box(hx, hy - 0.02, hz - 0.36, 0.012, 0.085, 0.3, steel),
                 s.box(hx, hy, hz - 0.08, 0.035, 0.05, 0.09, wood)]
    elif tool == 'rod':
        props = [s.cyl(hx, hy, hz - 0.05, 0.012, 0.6, s.mat('rod', '8a6a3a'), 6, rot=(math.radians(-50), 0, 0))]
    elif tool:
        props = hand_tool(s, tool, hx, hy, hz)
    if look in SOLDIERS:
        soldier_gear(s, arm, look)
    elif look != 'priest':
        civilian_cap(s, arm)
    if props: attach(s, [o for o in props if o.parent is None], arm, 'arm-left' if tool == 'bow' else 'arm-right')
    arm.scale = (SCALE, SCALE, SCALE)
    actions = {a.name.split('_')[0]: a for a in bpy.data.actions}
    return s, arm, root, actions, anims


def rest_pose(arm):
    """Back to the rest pose before the next action: bones it does not key would keep the last action's pose."""
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
        pb.rotation_quaternion = (1, 0, 0, 0); pb.rotation_euler = (0, 0, 0)


def render_look(race, look, only_anims=None):
    s, arm, root, actions, anims = build(race, look)
    s.camera(*CELL, target_z=0.32, pad=SOLDIER_PAD if look in SOLDIERS else PAD)
    base = os.path.join(RENDERS, 'settlers', race, look)
    arm.animation_data_create()
    for anim in anims:
        if only_anims and anim not in only_anims: continue
        if anim == 'carry': act = carry_action(arm, actions['walk'], actions['holding-both'])
        elif look == 'carpenter' and anim == 'work': act = saw_action(arm, actions['static'])
        else: act = actions[LOOK_SOURCES.get(look, {}).get(anim, SOURCE[anim])]
        rest_pose(arm)
        arm.animation_data.action = act
        f0, f1 = act.frame_range; n = FRAMES[anim]
        for d in range(8):
            root.rotation_euler = (0, 0, math.radians(d * 45))
            for k in range(n):
                s.sc.frame_set(int(round(f0 + (f1 - f0) * k / n)))
                s.render(os.path.join(base, f'{anim}_{d}_{k}.png'), 12)
    write_meta(base + '.json', {'anchor': s.anchor(), 'anims': {a: FRAMES[a] for a in anims}, 'cell': [s.sc.render.resolution_x, s.sc.render.resolution_y]})
    if look in SOLDIERS: render_tint(s, arm, root, actions, anims, race, look, only_anims)


def tint_mode(s):
    """Only the parts drawn in the owner's colour, in plain shaded white; everything else still hides what is behind
    it but shows nothing, and the ground shadow is off. The client tints this sheet and lays it over the soldier."""
    hold = bpy.data.materials.new('holdout'); hold.use_nodes = True; nt = hold.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial'); h = nt.nodes.new('ShaderNodeHoldout')
    nt.links.new(h.outputs['Holdout'], out.inputs['Surface'])
    white = s.mat('tint-white', 'f2f2f2', rough=0.6)
    for o in bpy.data.objects:
        if o.type != 'MESH': continue
        if o.is_shadow_catcher: o.hide_render = True; continue
        m = white if o.get('tint') else hold
        if not o.material_slots: o.data.materials.append(m)
        for slot in o.material_slots: slot.link = 'OBJECT'; slot.material = m


def render_tint(s, arm, root, actions, anims, race, look, only_anims=None):
    tint_mode(s)
    base = os.path.join(RENDERS, 'settlers', race, look + '_tint')
    for anim in anims:
        if only_anims and anim not in only_anims: continue
        act = actions[LOOK_SOURCES.get(look, {}).get(anim, SOURCE[anim])]
        rest_pose(arm)
        arm.animation_data.action = act
        f0, f1 = act.frame_range; n = FRAMES[anim]
        for d in range(8):
            root.rotation_euler = (0, 0, math.radians(d * 45))
            for k in range(n):
                s.sc.frame_set(int(round(f0 + (f1 - f0) * k / n)))
                s.render(os.path.join(base, f'{anim}_{d}_{k}.png'), 8)
    write_meta(base + '.json', {'anchor': s.anchor(), 'anims': {a: FRAMES[a] for a in anims}, 'cell': [s.sc.render.resolution_x, s.sc.render.resolution_y]})


def quick(race, looks):
    for look in looks:
        s, arm, root, actions, anims = build(race, look)
        s.camera(*CELL, target_z=0.32, pad=SOLDIER_PAD if look in SOLDIERS else PAD)
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
