import 'pixi.js/unsafe-eval';
import { Application, Container, Graphics, Matrix, Sprite, Text, Texture } from 'pixi.js';
import {
  BUILDING_TYPES, DEPOSIT_COAL, DEPOSIT_GOLD, DEPOSIT_IRON, FIELD_RIPE, ROCK_STONE, SOLDIER_STATS, TERRAIN_GRASS, TERRAIN_MOUNTAIN,
  TERRAIN_WATER, TREE_MATURE, VISION_NONE, VISION_VISIBLE, canSee, isMilitaryBuilding, isSoldierType, isSpecialistType, isWarMachineType, tileIndex,
  BUILDING_STRUCTURE, WAR_MACHINE_STATS, buildingLabel
} from '../../simulation/src/index.ts';
import type { Building, BuildingTypeId, GoodType, Settler, World } from '../../simulation/src/index.ts';
import { SpriteBank, TREE_VARIANTS, lookOf } from './sprites.ts';
import type { SettlerAnim, Sprite as ArtSprite } from './sprites.ts';
import { buildTerrain } from './terrain.ts';

/** Pixels per tile in the flat (tile-space) drawing of the ground layer. */
export const TILE = 20;
/** On screen at zoom 1, a tile is a diamond this wide and half as tall. */
export const ISO_W = 64;
export const ISO_H = 32;
const MIN_SCALE = 0.3;
const MAX_SCALE = 3;

/** Geologist sign colours: black for coal, silver for iron, gold for gold; an empty ring means nothing found. */
const SIGN_COLORS: Record<number, number> = { [DEPOSIT_COAL]: 0x1e1e1e, [DEPOSIT_IRON]: 0xc9ccd1, [DEPOSIT_GOLD]: 0xe8c547 };

/** Border and banner colour per player: you, then the computer. */
const OWNER_COLORS = [0xe3a33b, 0xd05a5a, 0x8fb3d9, 0x9b7fbf];

const GOOD_COLORS: Record<GoodType, number> = {
  log: 0x7a4d24, plank: 0xd8a85e, stone: 0xa3a39b, grain: 0xe3c35a, flour: 0xf4efe2, water: 0x5d93bf,
  bread: 0xb5763a, fish: 0x8fb3d9, pig: 0xe8a0a0, meat: 0xb04a4a, coal: 0x2a2a2a, iron_ore: 0x8a5a4a, iron: 0x9aa3ad, gold_ore: 0xb8963a, gold: 0xe8c547,
  wine: 0x7a2a4a, beer: 0xc9902a, rice: 0xe8e0c8, rice_wine: 0xd8d0b8, honey: 0xe8b02a, mead: 0xb0702a, sulfur: 0xd8d040, gems: 0x40c0c8, gunpowder: 0x3a3a3a,
  axe: 0x5a5a5a, saw: 0x5a5a5a, pick: 0x5a5a5a, scythe: 0x5a5a5a, shovel: 0x5a5a5a, hammer: 0x5a5a5a, rod: 0x5a5a5a,
  sword: 0xc0c6cc, spear: 0xc0c6cc, bow: 0x8a5a2b
};
const SETTLER_COLORS: Partial<Record<string, number>> = {
  carrier: 0xece6d6, builder: 0xe3a33b, digger: 0xb07a45,
  swordsman: 0xd05a5a, spearman: 0xe3a33b, bowman: 0x8fb3d9,
  geologist: 0x9b7fbf, pioneer: 0x6fb08a, thief: 0x4a4a4a
};
/** Settler phases shown with the work movement while standing still. */
const WORK_PHASES = new Set(['working', 'building', 'leveling', 'prospecting', 'claiming', 'stealing']);

export interface Ghost {
  typeId: BuildingTypeId;
  x: number;
  y: number;
  isValid: boolean;
}

export interface ViewState {
  ghost: Ghost | null;
  /** Top-left tiles where the building being placed fits. */
  markers: readonly number[];
  markerSize: number;
  selectedId: number | null;
  /** The building under the pointer; its name is shown. */
  hoveredId?: number | null;
  selectedSoldiers: ReadonlySet<number>;
  /** Drag-selection rectangle in screen pixels relative to the map canvas. */
  selectionBox: { x0: number; y0: number; x1: number; y1: number } | null;
  /** The work area of the selected gatherer, drawn as a dashed circle. */
  workArea: { x: number; y: number; radius: number } | null;
  /** How far the selected priest reaches with the spell being aimed. */
  spellRange?: { x: number; y: number; radius: number } | null;
  /** The selected marketplace's trade route: from its door through each spot. */
  tradeRoute?: { from: { x: number; y: number }; points: { x: number; y: number }[] } | null;
}

function hash(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  return ((h >>> 0) % 1000) / 1000;
}

/** Screen position (camera space, zoom 1) of a map point in tile coordinates (tile corners are integers). */
export function iso(tx: number, ty: number): { x: number; y: number } {
  return { x: (tx - ty) * ISO_W / 2, y: (tx + ty) * ISO_H / 2 };
}

/** Where a building's group stands on the map; its children are placed in map space, so its own position stays 0. */
const cullPoints = new WeakMap<object, { x: number; y: number }>();

interface BuildingView { root: Container; body: Sprite; scaffold: Sprite; mask: Graphics; marks: Graphics; label: Text; key: string }
interface SettlerView { root: Container; body: Sprite; load: Sprite; dir: number; walked: number }

export class MapView {
  readonly app: Application;
  readonly camera = new Container();
  /** The player whose eyes the map is drawn through. */
  viewer = 0;
  private readonly bank = new SpriteBank();
  /** Flat layers drawn in tile space and tilted into the isometric view. */
  private readonly groundBase = new Container();
  private readonly groundTop = new Container();
  private terrain = new Container();
  private readonly territory = new Graphics();
  private readonly flats = new Graphics();
  private readonly marks = new Graphics();
  private readonly fog = new Sprite();
  private readonly overlay = new Graphics();
  /** Upright things (buildings, trees, settlers) sorted front to back. */
  private readonly upright = new Container();
  private readonly bars = new Graphics();
  private readonly screenOverlay = new Graphics();
  private readonly buildingViews = new Map<number, BuildingView>();
  private readonly settlerViews = new Map<number, SettlerView>();
  /** One upright sprite per map tile that has a tree, rock, field or decoration; and what it shows. */
  private tileSprites: (Sprite | null)[] = [];
  private tileShown: Int32Array = new Int32Array(0);
  private ghostSprite = new Sprite();
  private fogCanvas = document.createElement('canvas');
  private mapVersion = -1;
  private territoryVersion = -1;
  private fogKey = -1;
  private growthKey = -1;
  private world: World;

  private constructor(app: Application, world: World) {
    this.app = app;
    this.world = world;
    // Tile space (TILE px per tile) to the isometric diamond grid.
    const m = new Matrix(ISO_W / 2 / TILE, ISO_H / 2 / TILE, -ISO_W / 2 / TILE, ISO_H / 2 / TILE, 0, 0);
    this.groundBase.setFromMatrix(m);
    this.groundTop.setFromMatrix(m);
    this.groundBase.addChild(this.terrain, this.territory, this.flats, this.marks);
    this.groundTop.addChild(this.fog, this.overlay);
    this.upright.sortableChildren = true;
    this.ghostSprite.alpha = 0.6;
    this.ghostSprite.visible = false;
    this.upright.addChild(this.ghostSprite);
    this.camera.addChild(this.groundBase, this.upright, this.groundTop, this.bars);
    app.stage.addChild(this.camera, this.screenOverlay);
  }

  static async create(host: HTMLElement, world: World): Promise<MapView> {
    const app = new Application();
    await app.init({
      resizeTo: host, background: '#0f1412', antialias: true, preference: 'webgl',
      autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2)
    });
    host.appendChild(app.canvas);
    // The map area changes size when the phone drawer opens or closes, not only on window resize.
    new ResizeObserver(() => app.resize()).observe(host);
    const view = new MapView(app, world);
    await view.bank.load(world.players.map((p) => p.raceType));
    view.setWorld(world);
    return view;
  }

  /** True when the rendered art loaded; otherwise the map is drawn with plain shapes. */
  get hasArt(): boolean { return this.bank.isReady; }

  setWorld(world: World): void {
    this.world = world;
    const races = world.players.map((p) => p.raceType);
    if (!this.bank.hasRaces(races)) {
      // Another people's art is needed; draw plain shapes until it arrives, then redraw.
      void this.bank.load(races).then(() => { if (this.world === world) this.setWorld(world); });
    }
    this.mapVersion = -1;
    this.territoryVersion = -1;
    this.fogKey = -1;
    for (const v of this.buildingViews.values()) v.root.destroy({ children: true });
    this.buildingViews.clear();
    for (const v of this.settlerViews.values()) v.root.destroy({ children: true });
    this.settlerViews.clear();
    for (const s of this.tileSprites) s?.destroy();
    this.tileSprites = new Array(world.width * world.height).fill(null);
    this.tileShown = new Int32Array(world.width * world.height).fill(-1);
    this.terrain.destroy({ children: true, texture: true });
    this.terrain = buildTerrain(world, TILE);
    this.groundBase.addChildAt(this.terrain, 0);
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = world.width;
    this.fogCanvas.height = world.height;
    this.fog.texture = Texture.from(this.fogCanvas);
    this.fog.scale.set(TILE);
  }

  get scale(): number { return this.camera.scale.x; }

  private raceOf(owner: number) { return this.world.players[owner]?.raceType ?? 'romans'; }

  private place(sprite: Sprite, art: ArtSprite, tx: number, ty: number): void {
    sprite.texture = art.texture;
    sprite.anchor.set(art.anchorX, art.anchorY);
    sprite.scale.set(this.bank.scale);
    const p = iso(tx, ty);
    sprite.position.set(p.x, p.y);
  }

  private drawTerritory(): void {
    const { world } = this;
    const g = this.territory.clear();
    const ownerAt = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < world.width && y < world.height ? world.territory[tileIndex(world, x, y)] : 0;
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) if (ownerAt(x, y) !== this.viewer + 1) g.rect(x * TILE, y * TILE, TILE, TILE);
    }
    g.fill({ color: 0x0f1412, alpha: 0.18 });
    for (let owner = 1; owner <= world.players.length; owner++) {
      for (let y = 0; y < world.height; y++) {
        for (let x = 0; x < world.width; x++) {
          if (ownerAt(x, y) !== owner) continue;
          const px = x * TILE, py = y * TILE;
          if (ownerAt(x, y - 1) !== owner) g.moveTo(px, py).lineTo(px + TILE, py);
          if (ownerAt(x, y + 1) !== owner) g.moveTo(px, py + TILE).lineTo(px + TILE, py + TILE);
          if (ownerAt(x - 1, y) !== owner) g.moveTo(px, py).lineTo(px, py + TILE);
          if (ownerAt(x + 1, y) !== owner) g.moveTo(px + TILE, py).lineTo(px + TILE, py + TILE);
        }
      }
      g.stroke({ width: 2, color: OWNER_COLORS[owner - 1], alpha: 0.9 });
    }
    // Pioneer posts on land claimed by pioneers, one post per 3×3 tiles where military land does not cover it.
    for (let i = 0; i < world.pioneerLand.length; i++) {
      const owner = world.pioneerLand[i];
      const x = i % world.width, y = Math.floor(i / world.width);
      if (owner === 0 || world.militaryLand[i] !== 0 || world.territory[i] !== owner || x % 3 !== 1 || y % 3 !== 1) continue;
      g.circle(x * TILE + TILE / 2, y * TILE + TILE / 2, 3).fill(OWNER_COLORS[owner - 1]).stroke({ width: 1, color: 0x1b2420 });
    }
  }

  /** What a tile shows upright, as a number: -1 nothing, else an index into tileArt(). */
  private tileCode(i: number): number {
    const { world } = this;
    if (world.field[i] >= 0) return 100 + (world.field[i] >= FIELD_RIPE ? 3 : world.field[i] >= 45 ? 2 : world.field[i] >= 15 ? 1 : 0);
    if (world.rock[i] > 0) return 200 + Math.min(3, Math.floor((world.rock[i] / ROCK_STONE) * 3.999));
    const growth = world.tree[i];
    if (growth >= 0) return 300 + (growth >= TREE_MATURE ? 3 : Math.min(2, Math.floor(growth / 20)));
    const r = hash(i * 7 + 3);
    if (world.terrain[i] === TERRAIN_MOUNTAIN && r < 0.22 && world.footprint[i] === 0) return 400 + Math.floor(r * 18) % 4;
    if (world.terrain[i] === TERRAIN_GRASS && r < 0.05 && world.footprint[i] === 0 && world.door[i] === 0) return 500 + Math.floor(r * 120) % 6;
    return -1;
  }

  private tileArt(i: number, code: number): ArtSprite | null {
    const kind = Math.floor(code / 100), k = code % 100;
    if (kind === 1) return this.bank.nature(`field-${k}`);
    if (kind === 2) return this.bank.nature(`rock${Math.floor(hash(i) * 2)}-${k}`);
    if (kind === 3) return this.bank.nature(`${TREE_VARIANTS[Math.floor(hash(i) * TREE_VARIANTS.length)]}-${k}`);
    if (kind === 4) return this.bank.nature(`mountain${k}`);
    if (kind === 5) return this.bank.nature(`meadow${k}`);
    return null;
  }

  /** Trees, rocks and fields as sprites; geologist signs flat on the ground. */
  private drawObjects(): void {
    const { world } = this;
    const vision = world.vision[this.viewer];
    for (let i = 0; i < world.tree.length; i++) {
      const code = vision && vision[i] === VISION_NONE ? -1 : this.tileCode(i);
      if (code === this.tileShown[i]) continue;
      this.tileShown[i] = code;
      let sprite = this.tileSprites[i];
      const art = code >= 0 ? this.tileArt(i, code) : null;
      if (!art) { if (sprite) sprite.visible = false; continue; }
      if (!sprite) { sprite = new Sprite(); this.tileSprites[i] = sprite; this.upright.addChild(sprite); }
      const x = i % world.width, y = Math.floor(i / world.width);
      // A little jitter so forests do not look planted in rows.
      const jx = code >= 300 && code < 400 ? (hash(i * 3) - 0.5) * 0.4 : 0, jy = code >= 300 && code < 400 ? (hash(i * 5) - 0.5) * 0.4 : 0;
      this.place(sprite, art, x + 0.5 + jx, y + 0.5 + jy);
      sprite.zIndex = x + y + 1 + jx + jy;
      sprite.visible = true;
    }
    this.drawFlats();
  }

  /** Things lying flat on the ground: geologist signs, and plain shapes when the art is missing. */
  private drawFlats(): void {
    const { world } = this;
    const g = this.flats.clear();
    const prospect = world.prospect[this.viewer];
    for (let i = 0; i < world.tree.length; i++) {
      const tx = i % world.width, ty = Math.floor(i / world.width);
      const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
      if (prospect && prospect[i] === 1 && world.rock[i] === 0 && tx % 2 === 0 && ty % 2 === 0) {
        const hasOre = world.deposit[i] !== 0 && world.depositAmount[i] > 0;
        if (hasOre) g.circle(cx, cy, 4).fill(SIGN_COLORS[world.deposit[i]] ?? 0xffffff).stroke({ width: 1, color: 0x1b2420 });
        else g.circle(cx, cy, 3.5).stroke({ width: 1.2, color: 0xece6d6 });
      }
      if (this.bank.isReady) continue;
      if (world.field[i] >= 0) {
        const t = world.field[i] / FIELD_RIPE;
        g.rect(cx - TILE / 2 + 2, cy - TILE / 2 + 2, TILE - 4, TILE - 4).fill(t >= 1 ? 0xe0b84a : 0x8fa34a);
      } else if (world.rock[i] > 0) {
        g.circle(cx, cy, TILE * 0.35).fill(0xa8a59a);
      } else if (world.tree[i] >= 0) {
        g.circle(cx, cy, TILE * (world.tree[i] >= TREE_MATURE ? 0.46 : 0.25)).fill(0x3d5a2e);
      }
    }
  }

  private drawFog(): void {
    const { world } = this;
    const vision = world.vision[this.viewer];
    if (!vision) return;
    const ctx = this.fogCanvas.getContext('2d')!;
    const img = ctx.createImageData(world.width, world.height);
    for (let i = 0; i < vision.length; i++) {
      // Unexplored land is dark; explored land out of sight is dimmed.
      const alpha = vision[i] === VISION_NONE ? 245 : vision[i] === VISION_VISIBLE ? 0 : 110;
      img.data.set([15, 20, 18, alpha], i * 4);
    }
    ctx.putImageData(img, 0, 0);
    this.fog.texture.source.update();
  }

  isBuildingVisible(b: Building): boolean {
    return b.owner === this.viewer || canSee(this.world, this.viewer, b.doorX, b.doorY)
      || canSee(this.world, this.viewer, b.x + b.size / 2, b.y + b.size / 2);
  }

  private drawBuildings(state: ViewState): void {
    const { world } = this;
    const alive = new Set<number>();
    for (const b of world.buildings) {
      if (!this.isBuildingVisible(b)) continue;
      alive.add(b.id);
      let v = this.buildingViews.get(b.id);
      if (!v) {
        const label = new Text({
          text: '', style: { fontFamily: 'Barlow, system-ui, sans-serif', fontSize: 12, fontWeight: '600', fill: 0xece6d6, stroke: { color: 0x0f1412, width: 3 }, align: 'center' },
          resolution: 3
        });
        label.anchor.set(0.5, 1);
        v = { root: new Container(), body: new Sprite(), scaffold: new Sprite(), mask: new Graphics(), marks: new Graphics(), label, key: '' };
        v.root.addChild(v.scaffold, v.body, v.mask, v.marks, v.label);
        this.upright.addChild(v.root);
        this.buildingViews.set(b.id, v);
      }
      const cx = b.x + b.size / 2, cy = b.y + b.size / 2;
      v.root.zIndex = cx + cy;
      cullPoints.set(v.root, iso(cx, cy));
      const art = this.bank.building(this.raceOf(b.owner), b.typeId);
      const scaffoldArt = this.bank.scaffold(b.size);
      if (art) this.place(v.body, art, cx, cy);
      v.body.visible = !!art && (b.isComplete || b.levelProgress >= 1);
      // A rising building shows from the ground up, inside its scaffold.
      const isRising = !b.isComplete && b.levelProgress >= 1;
      v.scaffold.visible = isRising && !!scaffoldArt;
      if (scaffoldArt) this.place(v.scaffold, scaffoldArt, cx, cy);
      if (isRising && art) {
        const h = v.body.height, top = v.body.y - v.body.anchor.y * h;
        const shown = Math.max(0.04, b.buildProgress);
        v.mask.clear().rect(v.body.x - v.body.width, top + h * (1 - shown), v.body.width * 2, h * shown + 4).fill(0xffffff);
        v.body.mask = v.mask; v.mask.visible = true;
      } else if (v.body.mask) { v.body.mask = null; v.mask.clear(); v.mask.visible = false; }
      v.body.alpha = isRising ? 0.95 : 1;
      this.drawBuildingMarks(b, v, cx, cy, !!art, state);
    }
    for (const [id, v] of this.buildingViews) {
      if (alive.has(id)) continue;
      v.root.destroy({ children: true });
      this.buildingViews.delete(id);
    }
  }

  /** Owner flag at the door, garrison shields, pause sign, construction bar and name. */
  private drawBuildingMarks(b: Building, v: BuildingView, cx: number, cy: number, hasArt: boolean, state: ViewState): void {
    const g = v.marks.clear();
    const isMine = b.owner === this.viewer;
    const door = iso(b.doorX + 0.5, b.doorY + 0.2);
    const base = iso(cx, cy);
    const top = hasArt ? v.body.y - v.body.anchor.y * v.body.height : base.y - 30;
    if (!b.isComplete && b.levelProgress < 1) {
      // The site being levelled: bare earth that darkens as the diggers finish.
      const corners = [iso(b.x, b.y), iso(b.x + b.size, b.y), iso(b.x + b.size, b.y + b.size), iso(b.x, b.y + b.size)];
      g.poly(corners.flatMap((p) => [p.x, p.y])).fill({ color: 0x6a4a2a, alpha: 0.25 + 0.45 * b.levelProgress });
    } else if (!hasArt) {
      // Without art: the old flat box, in iso.
      const corners = [iso(b.x, b.y), iso(b.x + b.size, b.y), iso(b.x + b.size, b.y + b.size), iso(b.x, b.y + b.size)];
      g.poly(corners.flatMap((p) => [p.x, p.y])).fill(b.isComplete ? (isMine ? 0xd8cfb8 : 0xbfb3a6) : { color: 0x9c7a50, alpha: 0.5 });
    }
    // Owner flag by the door, as settlers mark their buildings.
    g.rect(door.x - 0.8, door.y - 22, 1.6, 22).fill(0x3b2f22);
    g.poly([door.x + 0.8, door.y - 22, door.x + 11, door.y - 19, door.x + 0.8, door.y - 15]).fill(OWNER_COLORS[b.owner]).stroke({ width: 1, color: 0x1b2420 });
    if (b.isComplete && isMilitaryBuilding(b)) {
      const n = Math.min(b.garrison.length, 6);
      for (let k = 0; k < n; k++) {
        const sx = base.x - n * 4 + k * 8, sy = top - 4;
        g.moveTo(sx, sy).lineTo(sx + 6, sy).lineTo(sx + 6, sy + 4).lineTo(sx + 3, sy + 7).lineTo(sx, sy + 4).closePath()
          .fill(OWNER_COLORS[b.owner]).stroke({ width: 1, color: 0x1b2420 });
      }
    }
    const structure = BUILDING_STRUCTURE[b.typeId];
    if (structure && b.damage > 0) {
      // Battered by war machines: what is left of the structure, above the building.
      const left = Math.max(0, 1 - b.damage / structure);
      g.roundRect(base.x - 22, top - 30, 44, 6, 3).fill({ color: 0x0f1412, alpha: 0.8 });
      g.roundRect(base.x - 21, top - 29, 42 * left, 4, 2).fill(0xe8763a);
    }
    if (b.isComplete && b.isPaused) g.rect(base.x - 6, top - 18, 4, 11).fill(0xece6d6).rect(base.x + 2, top - 18, 4, 11).fill(0xece6d6);
    if (!b.isComplete) {
      const p = b.levelProgress < 1 ? b.levelProgress : b.buildProgress;
      g.roundRect(base.x - 20, base.y + 6, 40, 6, 3).fill({ color: 0x0f1412, alpha: 0.75 });
      g.roundRect(base.x - 19, base.y + 7, 38 * p, 4, 2).fill(b.levelProgress < 1 ? 0xb07a45 : 0xe3a33b);
    }
    const name = buildingLabel(b.typeId, this.raceOf(b.owner));
    const showName = b.id === state.selectedId || b.id === state.hoveredId || !this.bank.isReady;
    v.label.visible = showName;
    if (showName) {
      v.label.text = b.isComplete ? name : b.levelProgress < 1 ? `${name} · levelling ${Math.floor(b.levelProgress * 100)}%` : `${name} ${Math.floor(b.buildProgress * 100)}%`;
      v.label.position.set(base.x, top - 8);
    }
  }

  private drawSettlers(alpha: number, selected: ReadonlySet<number>, now: number): void {
    const marks = this.marks.clear();
    const bars = this.bars.clear();
    const alive = new Set<number>();
    for (const s of this.world.settlers) {
      if (s.isInside) continue;
      if (s.owner !== this.viewer && !canSee(this.world, this.viewer, s.x, s.y)) continue;
      alive.add(s.id);
      const x = s.prevX + (s.x - s.prevX) * alpha, y = s.prevY + (s.y - s.prevY) * alpha;
      const tx = x + 0.5, ty = y + 0.5;
      // Owner colour as a soft disc on the ground under every settler, a white ring when selected.
      const gx = tx * TILE, gy = ty * TILE;
      marks.circle(gx, gy, TILE * 0.28).fill({ color: OWNER_COLORS[s.owner], alpha: s.owner === this.viewer ? 0.35 : 0.6 });
      if (selected.has(s.id)) marks.circle(gx, gy, TILE * 0.42).stroke({ width: 2, color: 0xffffff });
      // Spells working on a soldier glow on the ground under it: Shield gold, Fury red, Freeze ice blue.
      const tick = this.world.tick;
      if (s.shieldUntil > tick) marks.circle(gx, gy, TILE * 0.55).fill({ color: 0xffd678, alpha: 0.28 });
      if (s.furyUntil > tick) marks.circle(gx, gy, TILE * 0.5).stroke({ width: 2, color: 0xe85a3a, alpha: 0.8 });
      if (s.frozenUntil > tick) marks.circle(gx, gy, TILE * 0.55).fill({ color: 0xa8d8ff, alpha: 0.4 });
      if (!this.drawSettlerSprite(s, tx, ty, now)) this.drawSettlerShape(s, tx, ty);
      if (isSoldierType(s.settlerType) || isWarMachineType(s.settlerType) || s.settlerType === 'thief') {
        const max = isSoldierType(s.settlerType) ? SOLDIER_STATS[s.settlerType].health : isWarMachineType(s.settlerType) ? WAR_MACHINE_STATS[s.settlerType].health : 30;
        if (s.health < max) {
          const p = iso(tx, ty);
          bars.rect(p.x - 9, p.y - 34, 18, 3).fill(0x1b2420);
          bars.rect(p.x - 9, p.y - 34, 18 * (s.health / max), 3).fill(s.health / max > 0.4 ? 0x8fdc7a : 0xe8763a);
        }
      }
    }
    for (const [id, v] of this.settlerViews) {
      if (alive.has(id)) continue;
      v.root.destroy({ children: true });
      this.settlerViews.delete(id);
    }
  }

  private drawSettlerSprite(s: Settler, tx: number, ty: number, now: number): boolean {
    if (!this.bank.isReady) return false;
    let v = this.settlerViews.get(s.id);
    if (!v) {
      v = { root: new Container(), body: new Sprite(), load: new Sprite(), dir: 0, walked: 0 };
      v.root.addChild(v.body, v.load);
      this.upright.addChild(v.root);
      this.settlerViews.set(s.id, v);
    }
    const dx = s.x - s.prevX, dy = s.y - s.prevY, isMoving = Math.abs(dx) + Math.abs(dy) > 1e-4;
    if (isMoving) {
      // Direction d faces (sin d·45°, cos d·45°) in map terms: 0 south, 2 east, 4 north, 6 west.
      v.dir = (Math.round(Math.atan2(dx, dy) / (Math.PI / 4)) + 8) % 8;
      v.walked = now;
    }
    if (!isMoving && isWarMachineType(s.settlerType) && s.phase === 'attacking') {
      // Standing to fire: turn toward the target.
      const target = this.world.buildings.find((b) => b.id === s.attackId);
      if (target) v.dir = (Math.round(Math.atan2(target.x + target.size / 2 - 0.5 - s.x, target.y + target.size / 2 - 0.5 - s.y) / (Math.PI / 4)) + 8) % 8;
    }
    // An enemy thief looks like a carrier to everyone but its owner.
    const type = s.settlerType === 'thief' && s.owner !== this.viewer ? 'carrier' : s.settlerType;
    const look = lookOf(type), race = this.raceOf(s.owner);
    const isWalking = now - v.walked < 160;
    let anim: SettlerAnim = s.carrying && this.bank.hasAnim(race, look, 'carry') ? 'carry' : 'walk';
    if (!isWalking && WORK_PHASES.has(s.phase) && this.bank.hasAnim(race, look, 'work')) anim = 'work';
    if (!isWalking && isSoldierType(s.settlerType) && s.enemyId !== null) anim = 'attack';
    // A war machine shows its firing movement for a moment after each shot.
    if (!isWalking && isWarMachineType(s.settlerType) && s.phase === 'attacking' && s.cooldown > WAR_MACHINE_STATS[s.settlerType].cooldown - 12) anim = 'attack';
    let frame = anim === 'walk' || anim === 'carry' ? (isWalking ? Math.floor(now / 85) : 0) : Math.floor(now / 110);
    if (anim === 'attack' && isWarMachineType(s.settlerType)) {
      // Machines play their shot once, from the moment it was fired (ticks since the shot, two per frame).
      frame = Math.min(5, Math.floor((WAR_MACHINE_STATS[s.settlerType].cooldown - s.cooldown) / 2)) - s.id;
    }
    const art = this.bank.settler(race, look, anim, v.dir, frame + s.id);
    if (!art) return false;
    this.place(v.body, art, 0, 0);
    const p = iso(tx, ty);
    v.root.position.set(p.x, p.y);
    v.root.zIndex = tx + ty;
    const good = s.carrying ? this.bank.good(s.carrying) : null;
    v.load.visible = !!good;
    if (good) {
      this.place(v.load, good, 0, 0);
      v.load.scale.set(this.bank.scale * 0.8);
      const fx = Math.sin(v.dir * Math.PI / 4), fy = Math.cos(v.dir * Math.PI / 4);
      const front = iso(fx * 0.12, fy * 0.12);
      // A donkey's load sits on its back; a carrier's in its hands; others carry it above the head.
      v.load.position.set(front.x, front.y - (s.settlerType === 'donkey' ? 14 : anim === 'carry' ? 11 : 24));
      // Behind the body when the settler walks away from the viewer.
      v.root.setChildIndex(v.load, v.dir >= 3 && v.dir <= 5 ? 0 : 1);
    }
    return true;
  }

  /** Plain shapes, used when the art is not available. */
  private drawSettlerShape(s: Settler, tx: number, ty: number): void {
    const p = iso(tx, ty);
    const g = this.bars;
    const looksAs = s.settlerType === 'thief' && s.owner !== this.viewer ? 'carrier' : s.settlerType;
    const color = SETTLER_COLORS[looksAs] ?? 0x8fb3d9;
    g.circle(p.x, p.y - 8, isSoldierType(s.settlerType) ? 7 : 5).fill(color).stroke({ width: 1.5, color: 0x1b2420 });
    if (s.carrying) g.rect(p.x - 4, p.y - 20, 8, 6).fill(GOOD_COLORS[s.carrying]).stroke({ width: 1, color: 0x1b2420 });
    if (isSpecialistType(s.settlerType)) g.rect(p.x - 1, p.y - 22, 2, 8).fill(0x3b2f22);
  }

  private drawGhost(ghost: Ghost | null): void {
    const art = ghost ? this.bank.building(this.raceOf(this.viewer), ghost.typeId) : null;
    this.ghostSprite.visible = !!(ghost && art);
    if (!ghost || !art) return;
    const size = BUILDING_TYPES[ghost.typeId].size;
    this.place(this.ghostSprite, art, ghost.x + size / 2, ghost.y + size / 2);
    this.ghostSprite.zIndex = ghost.x + ghost.y + size;
    this.ghostSprite.tint = ghost.isValid ? 0xffffff : 0xff9a7a;
  }

  private drawOverlay(state: ViewState): void {
    const g = this.overlay.clear();
    const { ghost, markers, markerSize } = state;
    // Placement markers: a small diamond at the centre of every spot where the building fits.
    const half = (markerSize * TILE) / 2;
    for (const i of markers) {
      const cx = (i % this.world.width) * TILE + half, cy = Math.floor(i / this.world.width) * TILE + half;
      g.moveTo(cx, cy - 4).lineTo(cx + 4, cy).lineTo(cx, cy + 4).lineTo(cx - 4, cy).closePath();
    }
    if (markers.length > 0) g.fill({ color: 0x8fdc7a, alpha: 0.85 });
    if (ghost) {
      const size = BUILDING_TYPES[ghost.typeId].size;
      const color = ghost.isValid ? 0x8fdc7a : 0xe8763a;
      g.rect(ghost.x * TILE, ghost.y * TILE, size * TILE, size * TILE).fill({ color, alpha: 0.25 }).stroke({ width: 2, color });
      const doorX = ghost.x + Math.floor(size / 2), doorY = ghost.y + size;
      g.rect(doorX * TILE + 3, doorY * TILE + 3, TILE - 6, TILE - 6).stroke({ width: 2, color });
    }
    // Footprint outlines: the selected building in white, stuck ones in orange.
    for (const b of this.world.buildings) {
      const isStuck = b.owner === this.viewer && b.blockedReason && b.blockedSince !== null && this.world.tick - b.blockedSince > 30;
      if (b.id !== state.selectedId && !isStuck) continue;
      g.rect(b.x * TILE, b.y * TILE, b.size * TILE, b.size * TILE).stroke({ width: 2, color: b.id === state.selectedId ? 0xffffff : 0xe8763a });
    }
    // Routes of selected soldiers: where they are going, their waypoints, and patrol ends.
    const w = this.world.width;
    const centre = (i: number) => ({ x: (i % w) * TILE + TILE / 2, y: Math.floor(i / w) * TILE + TILE / 2 });
    for (const s of this.world.settlers) {
      if (!state.selectedSoldiers.has(s.id) || s.owner !== this.viewer || s.isInside) continue;
      if (s.isPatrolling && s.workCentre >= 0 && s.targetTile >= 0) {
        const a = centre(s.workCentre), b = centre(s.targetTile);
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2, color: 0x8fb3d9, alpha: 0.8 });
        g.circle(a.x, a.y, 4).circle(b.x, b.y, 4).fill(0x8fb3d9);
        continue;
      }
      const stops = [...(s.path.length > 0 ? [s.path[s.path.length - 1]] : []), ...s.waypoints];
      if (stops.length === 0) continue;
      let from = { x: s.x * TILE + TILE / 2, y: s.y * TILE + TILE / 2 };
      for (const stop of stops) {
        const to = centre(stop);
        g.moveTo(from.x, from.y).lineTo(to.x, to.y);
        from = to;
      }
      g.stroke({ width: 2, color: 0xece6d6, alpha: 0.6 });
      for (const stop of stops) { const p = centre(stop); g.circle(p.x, p.y, 3.5).fill({ color: 0xece6d6, alpha: 0.9 }); }
    }
    if (state.workArea) {
      const { x, y, radius } = state.workArea;
      const cx = x * TILE + TILE / 2, cy = y * TILE + TILE / 2, r = radius * TILE;
      g.circle(cx, cy, r).fill({ color: 0xe3a33b, alpha: 0.08 });
      for (let k = 0; k < 48; k += 2) {
        const a0 = (k / 48) * Math.PI * 2, a1 = ((k + 1) / 48) * Math.PI * 2;
        g.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r).lineTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
      }
      g.stroke({ width: 2, color: 0xe3a33b });
    }
    if (state.tradeRoute) {
      // The route as a dashed line, spots as rings and the end as a filled one.
      let a = state.tradeRoute.from;
      const at = (p: { x: number; y: number }) => ({ x: (p.x + 0.5) * TILE, y: (p.y + 0.5) * TILE });
      for (const p of state.tradeRoute.points) {
        const from = at(a), to = at(p), d = Math.hypot(to.x - from.x, to.y - from.y), n = Math.max(1, Math.floor(d / 8));
        for (let k = 0; k < n; k += 2) {
          g.moveTo(from.x + (to.x - from.x) * k / n, from.y + (to.y - from.y) * k / n)
            .lineTo(from.x + (to.x - from.x) * Math.min(n, k + 1) / n, from.y + (to.y - from.y) * Math.min(n, k + 1) / n);
        }
        a = p;
      }
      g.stroke({ width: 2, color: 0xe3a33b });
      state.tradeRoute.points.forEach((p, k) => {
        const c = at(p);
        if (k === state.tradeRoute!.points.length - 1) g.circle(c.x, c.y, 6).fill(0xe3a33b).stroke({ width: 2, color: 0x1b2420 });
        else g.circle(c.x, c.y, 4).stroke({ width: 2, color: 0xe3a33b });
      });
    }
    if (state.spellRange) {
      const { x, y, radius } = state.spellRange;
      const cx = (x + 0.5) * TILE, cy = (y + 0.5) * TILE, r = radius * TILE;
      g.circle(cx, cy, r).fill({ color: 0xc9b2ff, alpha: 0.07 });
      for (let k = 0; k < 64; k += 2) {
        const a0 = (k / 64) * Math.PI * 2, a1 = ((k + 1) / 64) * Math.PI * 2;
        g.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r).lineTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
      }
      g.stroke({ width: 2, color: 0xc9b2ff });
    }
    const box = this.screenOverlay.clear();
    if (state.selectionBox) {
      const { x0, y0, x1, y1 } = state.selectionBox;
      box.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0))
        .fill({ color: 0xece6d6, alpha: 0.08 }).stroke({ width: 2, color: 0xece6d6 });
    }
  }

  render(alpha: number, state: ViewState): void {
    const now = performance.now();
    if (this.territoryVersion !== this.world.territoryVersion) {
      this.territoryVersion = this.world.territoryVersion;
      this.drawTerritory();
    }
    const fogKey = Math.floor(this.world.tick / 10);
    const growthKey = Math.floor(this.world.tick / 50);
    if (this.mapVersion !== this.world.mapVersion || fogKey !== this.fogKey || growthKey !== this.growthKey) {
      // Saplings grow without changing the map version, and newly explored land reveals what stands on it.
      this.mapVersion = this.world.mapVersion; this.growthKey = growthKey;
      this.drawObjects();
    }
    if (fogKey !== this.fogKey) { this.fogKey = fogKey; this.drawFog(); }
    this.drawBuildings(state);
    this.drawSettlers(alpha, state.selectedSoldiers, now);
    this.drawGhost(state.ghost);
    this.drawOverlay(state);
    this.cull();
  }

  /** Hides upright sprites outside the screen, which keeps big maps fast. */
  private cull(): void {
    const { width, height } = this.app.screen;
    const s = this.scale, margin = 260 * s;
    const left = -margin, right = width + margin, top = -margin, bottom = height + margin * 1.6;
    for (const child of this.upright.children) {
      if (!child.visible) continue;
      const at = cullPoints.get(child) ?? child.position;
      const x = at.x * s + this.camera.x, y = at.y * s + this.camera.y;
      child.renderable = x > left && x < right && y > top && y < bottom;
    }
  }

  // ------------------------------------------------------------- camera

  screenToTile(clientX: number, clientY: number): { x: number; y: number } {
    const p = this.screenToWorld(clientX, clientY);
    return { x: Math.floor(p.x), y: Math.floor(p.y) };
  }

  /** Map coordinates in tiles (fractional) of the ground under a point on screen. */
  screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    const sx = (clientX - rect.left - this.camera.x) / this.scale / (ISO_W / 2);
    const sy = (clientY - rect.top - this.camera.y) / this.scale / (ISO_H / 2);
    return { x: (sx + sy) / 2, y: (sy - sx) / 2 };
  }

  /** Screen position (relative to the canvas) of a settler-style tile coordinate (tile centre = integer). */
  tileToCanvas(x: number, y: number): { x: number; y: number } {
    const p = iso(x + 0.5, y + 0.5);
    return { x: p.x * this.scale + this.camera.x, y: p.y * this.scale + this.camera.y };
  }

  /** The visible building whose picture is under a point on screen, front-most first. */
  buildingAtScreen(clientX: number, clientY: number): Building | undefined {
    const rect = this.app.canvas.getBoundingClientRect();
    const px = clientX - rect.left, py = clientY - rect.top;
    let best: Building | undefined, bestZ = -Infinity;
    for (const b of this.world.buildings) {
      const v = this.buildingViews.get(b.id);
      if (!v || !v.body.visible || !v.root.visible) continue;
      const bounds = v.body.getBounds();
      if (px < bounds.x || px > bounds.x + bounds.width || py < bounds.y || py > bounds.y + bounds.height) continue;
      // Only the building itself counts, not the empty corners of its picture.
      const local = v.body.toLocal({ x: px, y: py });
      const ax = local.x + v.body.anchor.x * v.body.texture.width, ay = local.y + v.body.anchor.y * v.body.texture.height;
      if (ax < v.body.texture.width * 0.12 || ax > v.body.texture.width * 0.88 || ay > v.body.texture.height * 0.92) continue;
      if (v.root.zIndex > bestZ) { bestZ = v.root.zIndex; best = b; }
    }
    return best;
  }

  panBy(dx: number, dy: number): void {
    this.camera.x += dx;
    this.camera.y += dy;
    this.clamp();
  }

  zoomAt(factor: number, clientX: number, clientY: number): void {
    const rect = this.app.canvas.getBoundingClientRect();
    const sx = clientX - rect.left, sy = clientY - rect.top;
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.scale * factor));
    const wx = (sx - this.camera.x) / this.scale, wy = (sy - this.camera.y) / this.scale;
    this.camera.scale.set(next);
    this.camera.x = sx - wx * next;
    this.camera.y = sy - wy * next;
    this.clamp();
  }

  zoomCentre(factor: number): void {
    const rect = this.app.canvas.getBoundingClientRect();
    this.zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  centreOn(tileX: number, tileY: number): void {
    const { width, height } = this.app.screen;
    const p = iso(tileX + 0.5, tileY + 0.5);
    this.camera.x = width / 2 - p.x * this.scale;
    this.camera.y = height / 2 - p.y * this.scale;
    this.clamp();
  }

  /** Visible area in tiles, for the minimap frame: the box around the four screen corners. */
  visibleTiles(): { x: number; y: number; w: number; h: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    const corners = [[0, 0], [rect.width, 0], [0, rect.height], [rect.width, rect.height]]
      .map(([x, y]) => this.screenToWorld(rect.left + x, rect.top + y));
    const xs = corners.map((c) => c.x), ys = corners.map((c) => c.y);
    const x = Math.max(0, Math.min(...xs)), y = Math.max(0, Math.min(...ys));
    return { x, y, w: Math.min(this.world.width, Math.max(...xs)) - x, h: Math.min(this.world.height, Math.max(...ys)) - y };
  }

  private clamp(): void {
    const { width, height } = this.app.screen;
    const s = this.scale, { world } = this;
    const minX = iso(0, world.height).x * s, maxX = iso(world.width, 0).x * s;
    const maxY = iso(world.width, world.height).y * s;
    const margin = 160;
    this.camera.x = Math.min(margin - minX, Math.max(width - maxX - margin, this.camera.x));
    this.camera.y = Math.min(margin + 120 * s, Math.max(height - maxY - margin, this.camera.y));
  }
}
