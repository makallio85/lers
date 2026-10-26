"""Shared helpers for the Lers art scripts: scene setup, kit import, palette, shapes, camera and rendering.

Every sprite uses the same orthographic camera (30 degrees down, turned 45 degrees), the same sun and the
same scale, so buildings, nature and settlers match. One Blender unit is one map tile.
Map axes: game +x is Blender +X, game +y (south) is Blender -Y. The camera looks from the south-east,
so the south (-Y) and east (+X) faces of a building are the visible fronts.
"""
import bpy, bmesh, math, os, json, random, colorsys
import numpy as np
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

ART = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KITS = os.path.join(ART, '.kits')
RENDERS = os.path.join(ART, '.renders')
TOWN = os.path.join(KITS, 'town/Models/GLB format/')
CASTLE = os.path.join(KITS, 'castle/Models/GLB format/')
SURV = os.path.join(KITS, 'survival/Models/GLB format/')
NAT = os.path.join(KITS, 'nature/Models/GLTF format/')
CHAR = os.path.join(KITS, 'characters/Models/GLB format/')
PIRATE = os.path.join(KITS, 'pirate/Models/GLB format/')

# Sprites are rendered at twice the on-screen size. On screen a tile is 64 px wide (a 64 x 32 diamond).
TILE_SCREEN_W = 64
SUPERSAMPLE = 2
PX_PER_UNIT = TILE_SCREEN_W * SUPERSAMPLE / math.sqrt(2)

RACES = ('romans', 'egyptians', 'asians', 'amazons')

# ---------------------------------------------------------------- palette
H = lambda s: tuple(int(s[i:i + 2], 16) / 255 for i in (0, 2, 4))
# Kenney swatch colour -> Lers colour. Each swatch keeps its own shading.
BASE = {
    'ffc044': 'c9a44a', 'ff7e44': 'b8763c', 'cf534f': 'a34a32', 'de433e': 'a34a32', '6794d9': '5c6b7a', 'd0e8ff': '9fb4bf',
    'a878e8': '6e4f5e', 'f378f0': '9c5a60', '4f5260': '4d4a45', 'a0a8c9': 'd9ccad', 'ffffff': 'e6dfcf', 'f1976c': '8a5a35',
    'b06041': '5e3b23', 'f2bf99': 'e0b08a', 'fde4c7': 'e8d8b8', '61cb8b': '5f8a3a', 'c3495c': '8e3a34', '51b296': 'a55538',
    'eeba88': 'c9a477', '51b985': '4f7a34', 'c58262': '9a6a45', '9a5942': '6a4430', '38383d': '35322e', '868ba1': '8a857a'}
KIT_PALETTE = {
    'castle': {'f1976c': 'b9a27f', 'b06041': '8f7a5c', 'fde4c7': 'cfc4ad', 'f2bf99': 'bfae8e', 'a0a8c9': 'a49d8e', 'ffffff': 'c9c2b2',
               '6794d9': '7a3b2c', 'de433e': '8e3a2c'},
    'characters': {'f1976c': '8a5a35', 'b06041': '5e3b23', 'a0a8c9': '8a8678', 'ffffff': 'ddd5c2', 'fde4c7': 'e8d8b8', 'f2bf99': 'e0b08a'},
}
# Per people: roofs and walls for buildings, clothing for settlers.
RACE_PALETTE = {
    ('town', 'romans'): {'51b296': 'a55538', 'cf534f': 'a55538', 'c3495c': '8e3a2c', 'a0a8c9': 'e2d8c0'},
    ('town', 'egyptians'): {'51b296': 'c9a25e', 'cf534f': 'c9a25e', 'c3495c': 'a8844a', 'a0a8c9': 'd6bd8a', 'f1976c': 'a07a4a', 'b06041': '7a5a35'},
    ('town', 'asians'): {'51b296': '3e4a57', 'cf534f': '3e4a57', 'c3495c': '2e3742', 'a0a8c9': 'e6dcc6', 'f1976c': '7a2e22', 'b06041': '4e1d16'},
    ('town', 'amazons'): {'51b296': '5d6e34', 'cf534f': '5d6e34', 'c3495c': '4a5a28', 'a0a8c9': 'b7a27a', 'f1976c': '6a4a2a', 'b06041': '4a3220'},
    ('castle', 'egyptians'): {'f1976c': 'c9a46a', 'b06041': 'a07a48', 'fde4c7': 'dcc497', 'f2bf99': 'cfb07a', 'a0a8c9': 'c2a676', 'ffffff': 'dcc8a0',
                              '6794d9': '2f5f7a', 'de433e': '2f5f7a'},
    ('castle', 'asians'): {'6794d9': '3e4a57', 'de433e': '7a2e22', 'fde4c7': 'd8d0bc', 'f1976c': '7a2e22'},
    ('castle', 'amazons'): {'6794d9': '5d6e34', 'de433e': '5d6e34', 'fde4c7': 'b7a27a', 'f1976c': '6a4a2a', 'ffffff': 'a89a7a', 'a0a8c9': '8f8468'},
}
CLOTHING = {'romans': ('9a3c32', 'd8cfb8'), 'egyptians': ('e2dccb', '2f5f7a'), 'asians': ('2e3f5e', '9a3a2a'), 'amazons': ('4f6a2e', '7a5a32')}
CLOTHING_SWATCHES = ('6794d9', 'cf534f', '61cb8b', 'a878e8', 'f378f0', 'ffc044', 'ff7e44')
for _race, (_a, _b) in CLOTHING.items():
    RACE_PALETTE['characters', _race] = {k: (_a if i % 2 == 0 else _b) for i, k in enumerate(CLOTHING_SWATCHES)}

_maps = {}


def palette_map(kit, race=None):
    """The kit's colour map repainted in the Lers palette (and the people's colours), as an image datablock."""
    key = (kit, race)
    if key in _maps: return _maps[key]
    src = bpy.data.images.load(os.path.join(KITS, kit, 'Models/GLB format/Textures/colormap.png'), check_existing=False)
    w, h = src.size
    px = np.array(src.pixels[:], dtype=np.float32).reshape(h, w, 4)
    table = dict(BASE); table.update(KIT_PALETTE.get(kit, {})); table.update(RACE_PALETTE.get(key, {}))
    cw, ch = w // 8, h // 4
    lum = lambda c: 0.299 * c[..., 0] + 0.587 * c[..., 1] + 0.114 * c[..., 2] + 1e-6
    for r in range(4):
        for c in range(8):
            y0, y1 = h - (r + 1) * ch, h - r * ch          # pixel rows are stored bottom-up
            centre = px[y0 + ch // 2, c * cw + cw // 4, :3]
            hexkey = '%02x%02x%02x' % tuple(int(round(v * 255)) for v in centre)
            if hexkey not in table: continue
            target = np.array(H(table[hexkey]), dtype=np.float32)
            cell = px[y0:y1, c * cw:(c + 1) * cw]
            k = (lum(cell[..., :3]) / lum(centre))[..., None]
            cell[..., :3] = np.clip(target * k, 0, 1)
    img = bpy.data.images.new(f'map-{kit}-{race}', w, h, alpha=True)
    img.pixels[:] = px.ravel()
    img.pack()
    bpy.data.images.remove(src)
    _maps[key] = img
    return img


def kit_of(path):
    for kit in ('town', 'castle', 'survival', 'characters', 'pirate'):
        if os.path.join(KITS, kit) in path: return kit
    return None


# Nature kit models use plain colours, picked by material name.
NATURE = {'leafsGreen': (0.20, 0.33, 0.10), 'leafsDark': (0.12, 0.24, 0.08), 'leafsFall': (0.55, 0.36, 0.10), 'woodBark': (0.24, 0.15, 0.09),
          'woodBarkDark': (0.16, 0.10, 0.06), 'stone': (0.40, 0.39, 0.36), 'stoneDark': (0.30, 0.29, 0.27), 'grass': (0.22, 0.34, 0.10),
          'dirt': (0.33, 0.23, 0.13), 'dirtDark': (0.20, 0.13, 0.07), 'flowerRed': (0.6, 0.15, 0.1), 'flowerYellow': (0.75, 0.6, 0.15),
          'plant': (0.18, 0.32, 0.09), '_defaultMat': (0.66, 0.52, 0.22), 'colorRed': (0.55, 0.16, 0.12), 'wood': (0.36, 0.23, 0.12),
          'woodInner': (0.58, 0.45, 0.30)}


class Scene:
    """One sprite's scene. `race` picks the people's palette for town and castle pieces."""

    def __init__(self, race=None, shadow=True):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        _maps.clear()
        self.race = race
        sc = self.sc = bpy.context.scene
        sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 4.0; sun.angle = math.radians(6)
        so = bpy.data.objects.new('sun', sun); sc.collection.objects.link(so)
        so.rotation_euler = (math.radians(50), 0, math.radians(-35))
        w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
        bg = w.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (0.55, 0.65, 0.8, 1); bg.inputs['Strength'].default_value = 0.9
        if shadow:
            bpy.ops.mesh.primitive_plane_add(size=40)
            bpy.context.object.is_shadow_catcher = True
        sc.render.film_transparent = True
        sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.use_denoising = True
        sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'
        self.rng = random.Random(7)
        self.materials = {}

    # ------------------------------------------------------------ kit pieces
    def put(self, path, x, y, z=0, rot=0, s=1.0):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        new = [o for o in bpy.data.objects if o not in before]
        for r in [o for o in new if o.parent is None]:
            r.rotation_mode = 'XYZ'; r.location = (x, y, z); r.rotation_euler = (0, 0, math.radians(rot))
            r.scale = (s, s, s) if isinstance(s, (int, float)) else s
        self._recolor(new, path)
        return new

    def _recolor(self, new, path):
        kit = kit_of(path)
        for o in new:
            if o.type != 'MESH': continue
            for slot in o.material_slots:
                m = slot.material
                if not m or not m.use_nodes: continue
                m.blend_method = 'OPAQUE'
                for n in m.node_tree.nodes:
                    if n.type == 'TEX_IMAGE' and n.image and kit:
                        n.image = palette_map(kit, self.race if kit in ('town', 'castle', 'characters') else None)
                b = m.node_tree.nodes.get('Principled BSDF')
                if not b: continue
                b.inputs['Roughness'].default_value = 0.85
                if kit: continue
                c = NATURE.get(m.name.split('.')[0])
                if c is None:
                    r, g, bb, _ = b.inputs['Base Color'].default_value
                    h, s, v = colorsys.rgb_to_hsv(r, g, bb)
                    if 0.38 < h < 0.55: h = 0.27
                    c = colorsys.hsv_to_rgb(h, s * 0.6, v * 0.6)
                b.inputs['Base Color'].default_value = (*c, 1)

    # ------------------------------------------------------------ materials
    def mat(self, name, c, rough=0.85, noise=None, stretch=(1, 1, 1), c2=None, wave=None, metal=0.0):
        if name in self.materials: return self.materials[name]
        c = H(c) if isinstance(c, str) else c
        c2 = H(c2) if isinstance(c2, str) else c2
        lin = lambda col: tuple(v ** 2.2 for v in col)   # palette colours are sRGB; shaders want linear
        m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
        b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
        b.inputs['Base Color'].default_value = (*lin(c), 1)
        if noise or wave:
            tc = nt.nodes.new('ShaderNodeTexCoord'); mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = stretch
            nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
            if wave:
                t = nt.nodes.new('ShaderNodeTexWave'); t.inputs['Scale'].default_value = wave; t.inputs['Distortion'].default_value = 0
                t.wave_type = 'BANDS'; t.bands_direction = 'Z'
            else:
                t = nt.nodes.new('ShaderNodeTexNoise'); t.inputs['Scale'].default_value = noise; t.inputs['Detail'].default_value = 8
            nt.links.new(mp.outputs['Vector'], t.inputs['Vector'])
            r = nt.nodes.new('ShaderNodeValToRGB'); e = r.color_ramp.elements
            e[0].color = (*lin([v * 0.72 for v in c]), 1); e[1].color = (*lin(c2 or [min(1, v * 1.15) for v in c]), 1)
            e[0].position = .35; e[1].position = .7
            nt.links.new(t.outputs['Fac'], r.inputs['Fac']); nt.links.new(r.outputs['Color'], b.inputs['Base Color'])
        self.materials[name] = m
        return m

    # ------------------------------------------------------------ shapes
    def _link(self, bm, name, m):
        me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
        o = bpy.data.objects.new(name, me); self.sc.collection.objects.link(o); o.data.materials.append(m)
        return o

    def box(self, x, y, z, sx, sy, sz, m, rot=0):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z + sz / 2)); o = bpy.context.object
        o.scale = (sx, sy, sz); o.rotation_euler = (0, 0, math.radians(rot)); o.data.materials.append(m)
        return o

    def taper(self, x, y, z, w0, w1, h, m, d0=None, d1=None):
        d0 = d0 or w0; d1 = d1 or w1; bm = bmesh.new()
        vs = [bm.verts.new((x + sx * w / 2, y + sy * d / 2, z + zz)) for (w, d, zz) in [(w0, d0, 0), (w1, d1, h)]
              for (sx, sy) in [(-1, -1), (1, -1), (1, 1), (-1, 1)]]
        for f in [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]: bm.faces.new([vs[i] for i in f])
        return self._link(bm, 'taper', m)

    def cyl(self, x, y, z, r, h, m, n=24, rot=None):
        bpy.ops.mesh.primitive_cylinder_add(vertices=n, radius=r, depth=h, location=(x, y, z + h / 2)); o = bpy.context.object
        o.data.materials.append(m)
        if rot: o.rotation_euler = rot
        return o

    def cone(self, x, y, z, r, h, m, n=28, r2=0.0):
        bpy.ops.mesh.primitive_cone_add(vertices=n, radius1=r, radius2=r2, depth=h, location=(x, y, z + h / 2)); o = bpy.context.object
        o.data.materials.append(m); bpy.ops.object.shade_smooth()
        return o

    def sphere(self, x, y, z, r, m, sz=1.0):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=(x, y, z), segments=20, ring_count=10); o = bpy.context.object
        o.scale = (1, 1, sz); o.data.materials.append(m); bpy.ops.object.shade_smooth()
        return o

    def gable(self, x, y, z, w, d, h, m, along_x=True, over=0.12):
        """A plain gable roof (a prism), for thatch and simple sheds."""
        a, b = (w / 2 + over, d / 2 + over) if along_x else (d / 2 + over, w / 2 + over)
        bm = bmesh.new()
        v = [bm.verts.new(p) for p in [(-a, -b, 0), (a, -b, 0), (a, b, 0), (-a, b, 0), (-a, 0, h), (a, 0, h)]]
        for f in [(0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5), (0, 3, 2, 1)]: bm.faces.new([v[i] for i in f])
        o = self._link(bm, 'gable', m); o.location = (x, y, z)
        if not along_x: o.rotation_euler = (0, 0, math.radians(90))
        return o

    def curved_roof(self, x, y, z, a, b, h, lift, m, n=28, thick=0.05):
        """Hipped roof with concave slopes and upturned eaves (the Asians)."""
        bm = bmesh.new(); grid = {}
        for i in range(n + 1):
            for j in range(n + 1):
                px, py = -a + 2 * a * i / n, -b + 2 * b * j / n; u, v = min(1.0, abs(px) / a), min(1.0, abs(py) / b); k = max(u, v)
                zz = h * (1 - k) ** 1.7 + lift * k ** 6 * (0.35 + 0.65 * min(u, v) ** 3)
                grid[i, j] = bm.verts.new((x + px, y + py, z + zz))
        for i in range(n):
            for j in range(n): bm.faces.new([grid[i, j], grid[i + 1, j], grid[i + 1, j + 1], grid[i, j + 1]])
        o = self._link(bm, 'roof', m); md = o.modifiers.new('s', 'SOLIDIFY'); md.thickness = thick; md.offset = -1
        for p in o.data.polygons: p.use_smooth = True
        return o

    # ------------------------------------------------------------ camera and output
    def camera(self, canvas_w, canvas_h, target_z=0.0):
        """Fixed sprite camera. The map point (0, 0, 0) lands at the anchor written next to the image."""
        cam = bpy.data.cameras.new('cam'); cam.type = 'ORTHO'; cam.clip_end = 500
        cam.ortho_scale = max(canvas_w, canvas_h) / PX_PER_UNIT
        co = bpy.data.objects.new('cam', cam); self.sc.collection.objects.link(co); self.sc.camera = co
        co.rotation_euler = (math.radians(60), 0, math.radians(45))
        co.location = Vector((0, 0, target_z)) + (co.rotation_euler.to_matrix() @ Vector((0, 0, 50)))
        self.sc.render.resolution_x, self.sc.render.resolution_y = canvas_w, canvas_h
        self.cam = co

    def anchor(self):
        p = world_to_camera_view(self.sc, self.cam, Vector((0, 0, 0)))
        return [p.x * self.sc.render.resolution_x, (1 - p.y) * self.sc.render.resolution_y]

    def render(self, path, samples=32):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.sc.cycles.samples = samples
        self.sc.render.filepath = path
        bpy.ops.render.render(write_still=True)


def write_meta(path, data):
    with open(path, 'w') as f: json.dump(data, f)
