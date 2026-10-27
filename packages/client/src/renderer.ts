import 'pixi.js/unsafe-eval';
import { Application, Container, Graphics, Matrix, Sprite, Text, Texture } from 'pixi.js';
import {
  BUILDING_TYPES, DEPOSIT_COAL, DEPOSIT_GEMS, DEPOSIT_GOLD, DEPOSIT_IRON, DEPOSIT_SULFUR, FIELD_RIPE, ROCK_STONE, SOLDIER_STATS, TERRAIN_GRASS, TERRAIN_MOUNTAIN,
  GOOD_TYPES, isStorageBuilding, TERRAIN_WATER, TREE_MATURE, VISION_NONE, VISION_VISIBLE, canSee, isMilitaryBuilding, isSoldierType, isSpecialistType, isWarMachineType, isShipType, tileIndex,
  BUILDING_STRUCTURE, WAR_MACHINE_STATS, buildingLabel, TOOL_TYPES, WEAPON_TYPES
} from '../../simulation/src/index.ts';
import type { Building, BuildingTypeId, GoodType, RaceType, Settler, World } from '../../simulation/src/index.ts';
import { SpriteBank, TREE_VARIANTS, lookOf } from './sprites.ts';
import type { SettlerAnim, SettlerLook, Sprite as ArtSprite } from './sprites.ts';
import type { SoundId } from './sound.ts';
import { buildTerrain } from './terrain.ts';
import { OWNER_COLORS } from './colors.ts';

/** Pixels per tile in the flat (tile-space) drawing of the ground layer. */
export const TILE = 20;
/** On screen at zoom 1, a tile is a diamond this wide and half as tall. */
export const ISO_W = 64;
export const ISO_H = 32;
/** Side of a placement marker's square, in screen pixels at zoom 1. */
const MARKER_SIDE = 7;
const MIN_SCALE = 0.3;
const MAX_SCALE = 3;

/** Geologist sign colours: black for coal, silver for iron, gold for gold; an empty ring means nothing found. */
/** Flag colour of a geologist's sign per ore: coal black, iron steel, gold yellow, gems blue, sulfur green-yellow. */
const SIGN_COLORS: Record<number, number> = {
  [DEPOSIT_COAL]: 0x1e1e1e, [DEPOSIT_IRON]: 0xb8c4d0, [DEPOSIT_GOLD]: 0xf0c53a, [DEPOSIT_GEMS]: 0x4fc3e8, [DEPOSIT_SULFUR]: 0xc8d84a
};

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
  /** How fast the game runs: 0 while paused or over, so everything on the map holds still. */
  speed: number;
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
  /** While the player picks a work area: how far from the building it may be, drawn as a thin solid ring. */
  workReach?: { x: number; y: number; radius: number } | null;
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

interface BuildingView {
  root: Container; body: Sprite; scaffold: Sprite; mask: Graphics; marks: Graphics; label: Text; key: string;
  /** Goods piled in the yard: drawn flat on the ground, under the settlers, trees and buildings. */
  piles: Sprite[];
  /** Soldiers on the walls. */
  guards: Container;
  /** A mill's sails, turning while the miller works. */
  sails: Sprite;
  /** A sawmill's sawhorse by the door. */
  sawhorse?: Sprite;
  /** When the building left the world and began to collapse, and where its sprite stood then. */
  collapsedAt?: number; collapseY?: number;
  /** The building's middle, in tiles, for the sound of its collapse. */
  foot?: { x: number; y: number };
}

/** A settler drawn outside its building while the simulation has it inside: where, facing which way, doing what. */
interface OutdoorPose { x: number; y: number; dir: number; anim: SettlerAnim; isWalking: boolean; carrying: GoodType | null }

/** The share of each plank's time the carpenter saws; the rest he carries the plank to the pile and walks back. */
const SAW_SHARE = 0.65;

/** A sawmill's yard, in map coordinates: the sawhorse left of the door, where he stands to saw, the door, the pile. */
function sawmillSpots(b: Building): { horse: { x: number; y: number }; saw: { x: number; y: number }; door: { x: number; y: number }; pile: { x: number; y: number } } {
  const front = b.y + b.size + 0.45;
  return {
    horse: { x: b.x + 0.05, y: front }, saw: { x: b.x + 0.78, y: front },
    door: { x: b.doorX + 0.5, y: b.doorY + 0.75 }, pile: { x: b.x + b.size - 0.45, y: b.y + b.size + 0.25 }
  };
}

/** The 8-way direction from one point to another (0 south, 2 east, 4 north, 6 west in map terms). */
function dirToward(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return (Math.round(Math.atan2(to.x - from.x, to.y - from.y) / (Math.PI / 4)) + 8) % 8;
}

/** Garrison soldiers are drawn at this share of a settler's size, small enough to fit a tower's top. */
const GUARD_SCALE = 0.7;
type GuardedBuildingType = 'guard_tower_small' | 'guard_tower_large' | 'castle';
/**
 * Where garrison soldiers stand on each people's towers and castle: platforms, walls and windows, read off the
 * rendered art. Each spot is in the art's pixels from the building's foot (its manifest anchor); the first spots fill
 * first. Re-read them whenever these buildings are rendered anew.
 */
const GUARD_SPOTS: Record<RaceType, Record<GuardedBuildingType, readonly (readonly [number, number])[]>> = {
  romans: {
    guard_tower_small: [[30, -58]],
    guard_tower_large: [[42, -121], [10, 5], [-140, -80]],
    castle: [[90, -85], [-80, -140], [80, -150], [-85, -85]]
  },
  egyptians: {
    guard_tower_small: [[-15, -222], [20, -224]],
    guard_tower_large: [[-25, -300], [15, -298], [12, 13], [-135, -67]],
    castle: [[-30, -280], [20, -278], [-120, -100], [130, -80], [-188, -132], [202, -117]]
  },
  asians: {
    guard_tower_small: [[-18, -176], [-20, -111]],
    guard_tower_large: [[-19, -262], [-34, -192], [13, 23], [-139, -57]],
    castle: [[-24, -205], [-24, -128], [-160, -70], [140, -55], [60, -40]]
  },
  amazons: {
    guard_tower_small: [[-25, -172], [20, -172]],
    guard_tower_large: [[-40, -228], [0, -224], [40, -228]],
    castle: [[15, -165], [50, -165]]
  }
};

/** How long a demolished building takes to collapse, in milliseconds. */
const COLLAPSE_MS = 1500;

/** Most piles the castle's stockpile shows on the ground around it. */
const CASTLE_PILES = 48;
/**
 * The castle's stockpile lies in four heaps in front of it, each of one kind of goods: wood beside the door, stone and
 * what mines bring, food and drink, and tools and weapons along the right-hand wall.
 */
const CASTLE_PILE_GROUPS: readonly (readonly GoodType[])[] = [
  ['log', 'plank'],
  ['stone', 'coal', 'iron_ore', 'iron', 'gold_ore', 'gold', 'sulfur', 'gems', 'gunpowder'],
  ['grain', 'flour', 'water', 'bread', 'fish', 'pig', 'meat', 'wine', 'beer', 'rice', 'rice_wine', 'honey', 'mead'],
  [...TOOL_TYPES, ...WEAPON_TYPES]
];
/** Distance between piles inside a heap, in tiles: close enough to read as one heap. */
const HEAP_SPACING = 0.62;
/** Goods drawn per pile: a pile of eight, as storage holds them. */
const PILE_SIZE = 8;
/** Where the items of a pile sit, in screen pixels from its foot: two layers of four. */
const PILE_OFFSETS = [[0, 0], [7, -3], [-7, -3], [0, -6], [0, -6], [7, -9], [-7, -9], [0, -12]];
/** Building materials are drawn larger than other goods, on the ground and in a carrier's arms, so they read at a glance. */
/** How far back goods are sorted among upright things, in tiles of depth. */
const GOODS_DEPTH_BACK = 1.9;
const LARGE_GOODS: ReadonlySet<string> = new Set(['log', 'plank', 'stone']);
const LARGE_GOODS_SCALE = 2.2;
/** Planks' art is already a wide stack, so they grow less. */
const PLANK_SCALE = 1.5;
/** A building stone is about the size of a settler's head: its art is a small block, so it is scaled up most. */
const STONE_SCALE = 3;
interface SettlerView {
  root: Container; body: Sprite; load: Sprite; dir: number; walked: number;
  /** A soldier's helmet top and crest (bowman's cap), drawn over the body in its owner's colour. */
  tint?: Sprite; owner?: number;
  /** A soldier's people and look, kept so it can fall when it dies; and when it died, once it has. */
  race?: RaceType; look?: SettlerLook; diedAt?: number;
  /** What the settler carried last frame, and when that changed: a carrier bends to pick up or put down its load. */
  carried?: string | null; handledAt?: number;
  /** The animation frame whose sound already played, so each stroke sounds once. */
  cuedFrame?: number;
  /** Where the settler was last drawn, in tiles: where it falls if it dies. */
  lastX?: number; lastY?: number;
  /** The pebble an idle carrier kicks, made the first time one does. */
  pebble?: Graphics;
  /** The green cloud an idle carrier lets out, much more rarely; made the first time. */
  fart?: Graphics;
}

/** How long picking up or putting down a load takes on screen, in milliseconds. */
const HANDLE_MS = 600;

/**
 * A carrier with nothing to do kicks a pebble now and then: every 9 to 18 seconds of game time, staggered by settler,
 * a 6-frame kick; the foot meets the pebble halfway, and it hops off half a tile and fades.
 */
const KICK_FRAME_MS = 110, KICK_MS = 6 * KICK_FRAME_MS, KICK_EVERY_MS = 9000, KICK_SPREAD_MS = 9000;
const PEBBLE_MS = 900, PEBBLE_TILES = 0.55;
/** Far more rarely, every 70 to 140 seconds of game time, an idle carrier lets out a green cloud that drifts up and fades. */
const FART_EVERY_MS = 70_000, FART_SPREAD_MS = 70_000, FART_MS = 1800;

/** Workshops with a fire: smoke rises from them while their worker is at work. */
const SMOKY_BUILDINGS: ReadonlySet<BuildingTypeId> = new Set<BuildingTypeId>([
  'smelter', 'gold_smelter', 'bakery', 'toolsmith', 'weaponsmith', 'charcoal_maker', 'gunpowder_maker', 'distillery', 'brewery', 'mead_maker', 'alchemist'
]);

/** How long a fallen soldier plays its fall, then lies before fading, in milliseconds. */
const DIE_FRAME_MS = 110, DIE_FRAMES = 6, FALLEN_MS = 1800;

export class MapView {
  readonly app: Application;
  readonly camera = new Container();
  /** The player whose eyes the map is drawn through. */
  viewer = 0;
  /** Called with each map sound and where it happens on the canvas; nothing plays when unset. */
  onSound: ((id: SoundId, x: number, y: number) => void) | null = null;
  private readonly bank = new SpriteBank();
  /** Flat layers drawn in tile space and tilted into the isometric view. */
  private readonly groundBase = new Container();
  private readonly groundTop = new Container();
  private terrain = new Container();
  private readonly territory = new Graphics();
  private readonly flats = new Graphics();
  private readonly marks = new Graphics();
  /** Outlines on the ground (the selected building's footprint): drawn under the buildings, so a building hides the part behind it. */
  private readonly groundOutlines = new Graphics();
  /** Sites being levelled: bare earth on the ground, under the diggers working on it. */
  private readonly siteGround = new Graphics();
  /** Goods piled on the ground, under everything upright. */
  /** Fish swimming in the water: shadows where a water holds fish, more where it holds many. */
  private readonly fishLayer = new Graphics();
  private readonly fog = new Sprite();
  private readonly overlay = new Graphics();
  /** Placement markers, drawn upright on screen so they show as squares. */
  private readonly markerLayer = new Graphics();
  /** Upright things (buildings, trees, settlers) sorted front to back. */
  private readonly upright = new Container();
  private readonly bars = new Graphics();
  /** Geologists' signs, one sprite per signed tile, sorted with the rocks and trees; and their pictures, by deposit. */
  private readonly signSprites = new Map<number, Sprite>();
  private readonly signTextures = new Map<number, Texture>();
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
  /** Milliseconds of game time shown so far: the clock every animation runs on, still while the game is paused. */
  private clock = 0;
  private lastRender: number | undefined;
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
    this.groundBase.addChild(this.terrain, this.fishLayer, this.territory, this.flats, this.siteGround, this.marks, this.groundOutlines);
    this.groundTop.addChild(this.fog, this.overlay);
    this.upright.sortableChildren = true;
    this.ghostSprite.alpha = 0.6;
    this.ghostSprite.visible = false;
    this.upright.addChild(this.ghostSprite);
    // Goods lie flat on the ground, as in the original: settlers, trees and buildings are always drawn over them.
    this.camera.addChild(this.groundBase, this.upright, this.groundTop, this.markerLayer, this.bars);
    app.stage.addChild(this.camera, this.screenOverlay);
  }

  /** Makes the map view; `onProgress` hears how much of the art has loaded, from 0 to 1. */
  static async create(host: HTMLElement, world: World, onProgress?: (share: number) => void): Promise<MapView> {
    const app = new Application();
    await app.init({
      resizeTo: host, background: '#0f1412', antialias: true, preference: 'webgl',
      autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2)
    });
    host.appendChild(app.canvas);
    // The map area changes size when the phone drawer opens or closes, not only on window resize.
    new ResizeObserver(() => app.resize()).observe(host);
    const view = new MapView(app, world);
    await view.bank.load(world.players.map((p) => p.raceType), onProgress);
    view.setWorld(world);
    return view;
  }

  /** True when the rendered art loaded; otherwise the map is drawn with plain shapes. */
  get hasArt(): boolean { return this.bank.isReady; }

  /** Loads the art a match needs before it is shown, so it never appears in plain shapes first. */
  async prepare(world: World, onProgress?: (share: number) => void): Promise<void> {
    const races = world.players.map((p) => p.raceType);
    if (!this.bank.hasRaces(races)) await this.bank.load(races, onProgress);
    onProgress?.(1);
  }

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
    for (const v of this.buildingViews.values()) { for (const p of v.piles) p.destroy(); v.sawhorse?.destroy(); v.root.destroy({ children: true }); }
    this.buildingViews.clear();
    for (const v of this.settlerViews.values()) v.root.destroy({ children: true });
    this.settlerViews.clear();
    for (const s of this.tileSprites) s?.destroy();
    for (const sign of this.signSprites.values()) sign.destroy();
    this.signSprites.clear();
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

  /** Lays a soldier's owner-coloured helmet or cap over its body, on the same frame; hides it for everyone else. */
  private placeTint(v: SettlerView, race: RaceType, look: SettlerLook, anim: SettlerAnim, dir: number, frame: number, owner: number): void {
    const art = this.bank.settlerTint(race, look, anim, dir, frame);
    if (!art) { if (v.tint) v.tint.visible = false; return; }
    if (!v.tint) { v.tint = new Sprite(); v.root.addChildAt(v.tint, v.root.getChildIndex(v.body) + 1); }
    this.place(v.tint, art, 0, 0);
    v.tint.tint = OWNER_COLORS[owner] ?? 0xffffff;
    v.tint.visible = true;
  }

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
    // Signs are seen where the land has been explored, whoever put them up.
    const vision = world.vision[this.viewer];
    const signed = new Set<number>();
    for (let i = 0; i < world.tree.length; i++) {
      const tx = i % world.width, ty = Math.floor(i / world.width);
      const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
      // A sign on every tile the geologist checked.
      // A building put up there takes its signs down.
      if (prospect && prospect[i] === 1 && world.rock[i] === 0 && world.footprint[i] === 0 && (!vision || vision[i] !== VISION_NONE)) {
        // A wooden sign on a post, standing among the rocks and trees: sorted with them, so what is in front covers it.
        const hasOre = world.deposit[i] !== 0 && world.depositAmount[i] > 0;
        let sign = this.signSprites.get(i);
        if (!sign) { sign = new Sprite(); sign.anchor.set(0.5, 1); this.signSprites.set(i, sign); this.upright.addChild(sign); }
        sign.texture = this.signTexture(hasOre ? world.deposit[i] : 0);
        const p = iso(tx + 0.5, ty + 0.5);
        sign.position.set(p.x, p.y);
        sign.zIndex = tx + ty + 1.05;
        sign.visible = true;
        signed.add(i);
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
    // Signs taken down, or no longer seen.
    for (const [i, sign] of this.signSprites) if (!signed.has(i)) { sign.destroy(); this.signSprites.delete(i); }
  }

  /** The picture of a geologist's sign: a lump of the deposit's ore painted on it, or (0) plain with a dash. */
  private signTexture(deposit: number): Texture {
    let texture = this.signTextures.get(deposit);
    if (texture) return texture;
    const g = new Graphics();
    g.rect(-1, -12, 2, 12).fill(0x4a321c);
    g.roundRect(-6, -21, 12, 10, 1.5).fill(0xc9a46c).stroke({ width: 1, color: 0x3b2814 });
    if (deposit !== 0) {
      g.poly([-3.5, -14, -2.5, -18, 0.5, -19.2, 3.5, -17.2, 3.6, -14, 0.4, -12.8]).fill(SIGN_COLORS[deposit] ?? 0xffffff).stroke({ width: 0.8, color: 0x1b2420 });
    } else {
      g.rect(-3, -16.5, 6, 1.4).fill(0x6a4a2a);
    }
    texture = this.app.renderer.generateTexture({ target: g, resolution: 3 });
    g.destroy();
    this.signTextures.set(deposit, texture);
    return texture;
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

  /** Fish shadows drifting in the water, as many as the water holds (a few tiles each, so it stays light). */
  private drawFish(): void {
    const g = this.fishLayer.clear();
    const { world } = this;
    const t = this.clock / 1000;
    for (let i = 0; i < world.fish.length; i += 3) {
      const fish = world.fish[i];
      if (fish < 3) continue;
      const x = i % world.width, y = Math.floor(i / world.width);
      for (let k = 0; k < (fish >= 8 ? 2 : 1); k++) {
        const seed = (i * 7 + k * 13) % 97;
        const a = t * (0.25 + (seed % 5) * 0.05) + seed;
        const fx = (x + 0.5 + Math.cos(a) * 0.9) * TILE, fy = (y + 0.5 + Math.sin(a * 1.3) * 0.9) * TILE;
        const dir = Math.atan2(Math.cos(a * 1.3) * 1.3, -Math.sin(a));
        const dx = Math.cos(dir), dy = Math.sin(dir);
        g.poly([fx + dx * 5, fy + dy * 5, fx - dy * 1.8, fy + dx * 1.8, fx - dx * 4, fy - dy * 4, fx + dy * 1.8, fy - dx * 1.8])
          .fill({ color: 0x0b1f2a, alpha: 0.45 });
        g.poly([fx - dx * 4, fy - dy * 4, fx - dx * 7 - dy * 2, fy - dy * 7 + dx * 2, fx - dx * 7 + dy * 2, fy - dy * 7 - dx * 2])
          .fill({ color: 0x0b1f2a, alpha: 0.4 });
      }
    }
  }

  private drawBuildings(state: ViewState): void {
    const { world } = this;
    const alive = new Set<number>();
    this.siteGround.clear();
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
        v = { root: new Container(), body: new Sprite(), scaffold: new Sprite(), mask: new Graphics(), marks: new Graphics(), label, key: '',
          piles: [], guards: new Container(), sails: new Sprite() };
        v.root.addChild(v.scaffold, v.body, v.sails, v.mask, v.guards, v.marks, v.label);
        this.upright.addChild(v.root);
        this.buildingViews.set(b.id, v);
      }
      const cx = b.x + b.size / 2, cy = b.y + b.size / 2;
      v.root.zIndex = cx + cy;
      v.foot = { x: cx, y: cy };
      cullPoints.set(v.root, iso(cx, cy));
      // While it rises the building has no shadow yet; it gets its full shadow once it is finished.
      const art = b.isComplete ? this.bank.building(this.raceOf(b.owner), b.typeId) : this.bank.buildingWithoutShadow(this.raceOf(b.owner), b.typeId);
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
      this.drawSails(b, v, cx, cy);
      this.drawSawhorse(b, v);
      this.drawBuildingMarks(b, v, cx, cy, !!art, state);
      this.drawPiles(b, v);
      this.drawGuards(b, v, !!art);
    }
    // A building that leaves the world (demolished, burnt down or brought down by war machines) collapses:
    // it sinks into a cloud of dust and fades. One that only went out of sight just disappears.
    const existing = new Set(world.buildings.map((b) => b.id));
    const now = this.clock;
    for (const [id, v] of this.buildingViews) {
      if (alive.has(id)) continue;
      if (!existing.has(id) && v.body.visible && v.body.texture) {
        if (v.collapsedAt === undefined && v.foot) this.sound('collapse', v.foot.x, v.foot.y);
        v.collapsedAt ??= now;
        const t = (now - v.collapsedAt) / COLLAPSE_MS;
        if (t < 1) {
          for (const p of v.piles) p.visible = false;
          v.guards.visible = false; v.label.visible = false; v.scaffold.visible = false; v.sails.visible = false;
          v.collapseY ??= v.body.y;
          const h = v.body.height;
          // Sinks fast at first, then settles; fades in the second half.
          v.body.y = v.collapseY + h * 0.45 * (1 - (1 - t) * (1 - t));
          v.body.alpha = t < 0.5 ? 1 : 1 - (t - 0.5) * 2;
          // Cut off at the ground it stood on, so it sinks into it rather than sliding down.
          const ground = v.collapseY + 4;
          v.mask.clear().rect(v.body.x - v.body.width, ground - h * 2, v.body.width * 2, h * 2).fill(0xffffff);
          v.body.mask = v.mask; v.mask.visible = true;
          const g = v.marks.clear();
          const foot = v.collapseY;
          for (let k = 0; k < 9; k++) {
            const a = (k / 9) * Math.PI * 2 + id, spread = 0.35 + 0.65 * t;
            g.circle(v.body.x + Math.cos(a) * v.body.width * 0.4 * spread, foot - 6 - Math.sin(a) * 10 * spread - t * 18, 6 + t * 14)
              .fill({ color: 0xb8a990, alpha: 0.55 * (1 - t) });
          }
          continue;
        }
      }
      for (const p of v.piles) p.destroy();
      v.sawhorse?.destroy();
      v.root.destroy({ children: true });
      this.buildingViews.delete(id);
    }
  }

  /**
   * The goods a building holds, piled in its yard as many as it has: what it waits to work on at the front left,
   * what it made at the front right, a storage area's piles across its yard. A construction site shows its delivered
   * materials. The castle keeps its goods inside.
   */
  private drawPiles(b: Building, v: BuildingView): void {
    const isCastle = b.typeId === 'castle';
    const isStore = b.isComplete && isStorageBuilding(b);
    // Every good a building holds lies on the map: a workshop's at its door, a store's and the castle's on its yard.
    const limit = isCastle ? CASTLE_PILES : isStore ? Math.ceil(BUILDING_TYPES[b.typeId].storageCapacity / PILE_SIZE) : 12;
    const piles: { good: GoodType; count: number }[] = [];
    const add = (amounts: Partial<Record<GoodType, number>>) => {
      for (const g of GOOD_TYPES) {
        let n = amounts[g] ?? 0;
        while (n > 0 && piles.length < limit) { piles.push({ good: g, count: Math.min(PILE_SIZE, n) }); n -= PILE_SIZE; }
      }
    };
    if (!isCastle && !isStore) add(b.isComplete ? b.input : b.delivered);
    const inputPiles = piles.length;
    // The castle's piles, by heap: each pile's heap and its place in that heap.
    const heapOf: { heap: number; index: number }[] = [];
    if (isCastle && b.isComplete) {
      CASTLE_PILE_GROUPS.forEach((goods, heap) => {
        const before = piles.length;
        add(Object.fromEntries(goods.map((g) => [g, b.stock[g]])));
        for (let j = before; j < piles.length; j++) heapOf.push({ heap, index: j - before });
      });
    } else if (b.isComplete) add(b.stock);
    let k = 0;
    const want = piles.reduce((n, p) => n + p.count, 0);
    while (v.piles.length < want) { const sprite = new Sprite(); v.piles.push(sprite); this.upright.addChild(sprite); }
    // Slots along the front edge of the yard: inputs from the left, made goods from the right; storage fills rows;
    // the castle's stockpile lies around it on the ground, nearest its door first.
    const heaps = isCastle ? this.castleHeaps(b) : [];
    const slot = (index: number, isOutput: boolean) => {
      if (isCastle) {
        const { heap, index: n } = heapOf[index] ?? { heap: 0, index };
        // A full heap spills into the next one that has room.
        for (let h = 0; h < heaps.length; h++) {
          const spots = heaps[(heap + h) % heaps.length];
          if (n < spots.length) return spots[n];
        }
        return { x: b.doorX + 0.5, y: b.doorY + 1.5 };
      }
      if (isStore) return { x: b.x + 0.5 + (index % b.size), y: b.y + b.size - 0.55 - Math.floor(index / b.size) * 0.8 };
      // A construction site's materials wait in the open along its right front edge, clear of the crew on the site.
      if (!b.isComplete) return { x: b.x + b.size + 0.55, y: b.y + b.size - 0.5 - index * 0.75 };
      const along = isOutput ? b.x + b.size - 0.45 - (index - inputPiles) * 0.55 : b.x + 0.45 + index * 0.55;
      return { x: along, y: b.y + b.size - 0.45 };
    };
    piles.forEach((p, index) => {
      const art = this.bank.good(p.good);
      const at = slot(index, index >= inputPiles);
      const foot = iso(at.x, at.y);
      for (let n = 0; n < p.count; n++) {
        const sprite = v.piles[k++];
        // Goods lie low: sorted almost two tiles back, so a settler on or near a pile is always drawn over it, while the
        // pile still stands in front of the building wall behind it.
        // Never behind the building they belong to, whatever the size of its art.
        sprite.zIndex = Math.max(at.x + at.y - GOODS_DEPTH_BACK, v.root.zIndex + 0.01) + n * 0.01;
        if (!art) { sprite.visible = false; continue; }
        this.place(sprite, art, 0, 0);
        // Stone, logs and planks are rendered at their larger size (art/blender/nature.py), so only the spacing grows.
        const size = p.good === 'stone' ? STONE_SCALE : p.good === 'plank' ? PLANK_SCALE : LARGE_GOODS.has(p.good) ? LARGE_GOODS_SCALE : 1;
        sprite.scale.set(this.bank.scale * 0.75);
        sprite.position.set(foot.x + PILE_OFFSETS[n][0] * size, foot.y + PILE_OFFSETS[n][1] * size);
        sprite.visible = true;
      }
    });
    for (let j = k; j < v.piles.length; j++) v.piles[j].visible = false;
  }

  private readonly heaps = new Map<number, { x: number; y: number }[][]>();
  /**
   * Spots for the castle's four heaps, each a tight cluster of piles on open ground in front of the castle: two in
   * front of its door wall, either side of the way in, and two along its right-hand wall. Nearest the castle first.
   */
  private castleHeaps(b: Building): { x: number; y: number }[][] {
    const known = this.heaps.get(b.id);
    if (known && this.world.tick % 50 !== 0) return known;
    const w = this.world, s = b.size;
    const isOpen = (x: number, y: number) => {
      const tx = Math.floor(x), ty = Math.floor(y);
      if (tx < 0 || ty < 0 || tx >= w.width || ty >= w.height) return false;
      if (Math.abs(tx - b.doorX) <= 1 && ty >= b.y + s) return false;
      // Only ground the castle's art cannot cover: far enough in front that the goods, sorted back as they are, still
      // sort after the castle, and so does a settler walking over them.
      if (x + y - GOODS_DEPTH_BACK < b.x + b.y + s + 0.1) return false;
      const i = tileIndex(w, tx, ty);
      return w.footprint[i] === 0 && w.door[i] === 0 && w.terrain[i] !== TERRAIN_WATER && w.rock[i] === 0 && w.tree[i] < 0;
    };
    // Each heap: a corner to grow from and the two directions it grows in (across, then away from the wall).
    const front = b.y + s + 0.35, side = b.x + s + 0.35;
    const regions: { x: number; y: number; ax: number; ay: number; bx: number; by: number }[] = [
      { x: b.doorX - 1.35, y: front, ax: -1, ay: 0, bx: 0, by: 1 },
      { x: b.doorX + 2.35, y: front, ax: 1, ay: 0, bx: 0, by: 1 },
      { x: side, y: b.y + s - 0.4, ax: 0, ay: -1, bx: 1, by: 0 },
      { x: side, y: b.y + s / 2 - 0.9, ax: 0, ay: -1, bx: 1, by: 0 }
    ];
    const heaps = regions.map((r) => {
      const spots: { x: number; y: number }[] = [];
      for (let depth = 0; depth < 8 && spots.length < 12; depth++) {
        for (let across = 0; across < 4 && spots.length < 12; across++) {
          const x = r.x + (r.ax * across + r.bx * depth) * HEAP_SPACING, y = r.y + (r.ay * across + r.by * depth) * HEAP_SPACING;
          if (isOpen(x, y)) spots.push({ x, y });
        }
      }
      return spots;
    });
    this.heaps.set(b.id, heaps);
    return heaps;
  }

  /** A finished mill's sails: turning a quarter in 8 steps while the miller grinds, at rest otherwise. */
  private drawSails(b: Building, v: BuildingView, cx: number, cy: number): void {
    if (b.typeId !== 'mill' || !b.isComplete) { v.sails.visible = false; return; }
    const worker = b.workerId === null ? undefined : this.world.settlers.find((s) => s.id === b.workerId);
    const isTurning = !!worker && worker.phase === 'working' && !b.isPaused;
    const frame = isTurning ? Math.floor(this.clock / 90) % 8 : b.id % 8;
    const art = this.bank.buildingPart(this.raceOf(b.owner), `mill_sails_${frame}`);
    v.sails.visible = !!art && v.body.visible;
    if (art) this.place(v.sails, art, cx, cy);
  }

  /**
   * Soldiers inside a tower or castle stand where its art has room for them: on its platform or walls, or in its
   * windows. A few show, not the whole garrison; the card gives the count.
   */
  private drawGuards(b: Building, v: BuildingView, hasArt: boolean): void {
    const race = this.raceOf(b.owner);
    const spots = GUARD_SPOTS[race][b.typeId as GuardedBuildingType] ?? [];
    const inside = b.isComplete && hasArt && isMilitaryBuilding(b)
      ? b.garrison.map((id) => this.world.settlers.find((s) => s.id === id)).filter((s): s is Settler => !!s) : [];
    const shown = inside.slice(0, spots.length);
    while (v.guards.children.length < shown.length) v.guards.addChild(new Sprite());
    shown.forEach((s, k) => {
      const sprite = v.guards.children[k] as Sprite;
      const art = this.bank.settler(race, lookOf(s.settlerType), 'walk', 0, 0);
      if (!art) { sprite.visible = false; return; }
      this.place(sprite, art, 0, 0);
      sprite.scale.set(this.bank.scale * GUARD_SCALE);
      // Spots are in the building art's own pixels from its foot, which the body sprite stands on.
      const [dx, dy] = spots[k];
      sprite.position.set(v.body.x + dx * this.bank.scale, v.body.y + dy * this.bank.scale);
      sprite.visible = true;
    });
    for (let j = shown.length; j < v.guards.children.length; j++) v.guards.children[j].visible = false;
  }

  /** Owner flag at the door, garrison shields, pause sign, construction bar and name. */
  private drawBuildingMarks(b: Building, v: BuildingView, cx: number, cy: number, hasArt: boolean, state: ViewState): void {
    const g = v.marks.clear();
    const isMine = b.owner === this.viewer;
    const door = iso(b.doorX + 0.5, b.doorY + 0.2);
    const base = iso(cx, cy);
    const top = hasArt ? v.body.y - v.body.anchor.y * v.body.height : base.y - 30;
    if (!b.isComplete && b.levelProgress < 1) {
      // The site being levelled: bare earth that darkens as the diggers finish, on the ground under them.
      this.siteGround.rect(b.x * TILE, b.y * TILE, b.size * TILE, b.size * TILE).fill({ color: 0x6a4a2a, alpha: 0.25 + 0.45 * b.levelProgress });
    } else if (!hasArt) {
      // Without art: the old flat box, in iso.
      const corners = [iso(b.x, b.y), iso(b.x + b.size, b.y), iso(b.x + b.size, b.y + b.size), iso(b.x, b.y + b.size)];
      g.poly(corners.flatMap((p) => [p.x, p.y])).fill(b.isComplete ? (isMine ? 0xd8cfb8 : 0xbfb3a6) : { color: 0x9c7a50, alpha: 0.5 });
    }
    // Owner flag by the door, as settlers mark their buildings.
    g.rect(door.x - 0.8, door.y - 22, 1.6, 22).fill(0x3b2f22);
    g.poly([door.x + 0.8, door.y - 22, door.x + 11, door.y - 19, door.x + 0.8, door.y - 15]).fill(OWNER_COLORS[b.owner]).stroke({ width: 1, color: 0x1b2420 });
    // A workplace's worker: a settler in a disc beside the door once moved in, an empty ring while it waits for one.
    if (b.isComplete && BUILDING_TYPES[b.typeId].worker !== null && (isMine || canSee(this.world, this.viewer, b.doorX, b.doorY))) {
      const worker = b.workerId === null ? undefined : this.world.settlers.find((s) => s.id === b.workerId);
      const hasMovedIn = !!worker && worker.phase !== 'toTool' && worker.phase !== 'toWork';
      const bx = door.x - 13, by = door.y - 33;
      if (hasMovedIn) {
        g.circle(bx, by, 9).fill(0xece6d6).stroke({ width: 2, color: 0x1b2420 });
        g.circle(bx, by - 3, 2.8).fill(0x1b2420);
        g.roundRect(bx - 4.4, by + 0.8, 8.8, 5.4, 2.7).fill(0x1b2420);
      } else {
        g.circle(bx, by, 8.5).fill({ color: 0x1b2420, alpha: 0.55 }).stroke({ width: 2, color: 0xece6d6, alpha: 0.85 });
      }
    }
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
    if (b.isComplete && SMOKY_BUILDINGS.has(b.typeId) && hasArt) {
      const worker = b.workerId === null ? undefined : this.world.settlers.find((s) => s.id === b.workerId);
      if (worker && worker.phase === 'working' && !b.isPaused) {
        // Smoke rising from the roof while the fire is lit: three puffs that grow and fade as they climb.
        const now = this.clock;
        for (let k = 0; k < 3; k++) {
          const t = (now / 1600 + k / 3 + b.id * 0.17) % 1;
          g.circle(base.x + b.size * 4 + Math.sin(t * 4 + k) * 4, top + 14 - t * 40, 4 + t * 8).fill({ color: 0xd9d4ca, alpha: 0.75 * (1 - t) });
        }
      }
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

  /**
   * Where each visible settler is drawn: its position, pushed apart from others closer than their size so figures
   * stand next to each other, never on top. War machines and ships take more room. A push never moves a figure into a
   * building. Only drawing changes; the simulation keeps the real positions.
   */
  private spacedPositions(alpha: number): Map<number, { x: number; y: number }> {
    const w = this.world;
    const items: { id: number; x: number; y: number; r: number }[] = [];
    for (const s of w.settlers) {
      if (s.isInside) continue;
      if (s.owner !== this.viewer && !canSee(w, this.viewer, s.x, s.y)) continue;
      const r = isShipType(s.settlerType) ? 0.9 : isWarMachineType(s.settlerType) ? 0.45 : 0.22;
      items.push({ id: s.id, x: s.prevX + (s.x - s.prevX) * alpha, y: s.prevY + (s.y - s.prevY) * alpha, r });
    }
    const out = new Map(items.map((it) => [it.id, { x: it.x, y: it.y }]));
    const cells = new Map<number, number[]>();
    items.forEach((it, k) => {
      const key = Math.floor(it.x) * 4096 + Math.floor(it.y);
      (cells.get(key) ?? cells.set(key, []).get(key)!).push(k);
    });
    for (let pass = 0; pass < 2; pass++) {
      items.forEach((a, k) => {
        const p = out.get(a.id)!;
        for (let gx = Math.floor(a.x) - 1; gx <= Math.floor(a.x) + 1; gx++) {
          for (let gy = Math.floor(a.y) - 1; gy <= Math.floor(a.y) + 1; gy++) {
            for (const j of cells.get(gx * 4096 + gy) ?? []) {
              if (j <= k) continue;
              const b = items[j], q = out.get(b.id)!;
              let dx = q.x - p.x, dy = q.y - p.y;
              const min = a.r + b.r, d = Math.hypot(dx, dy);
              if (d >= min) continue;
              // Exactly on top of each other: part them sideways, the same way every frame.
              if (d < 1e-4) { const ang = ((a.id * 7 + b.id * 13) % 16) * (Math.PI / 8); dx = Math.cos(ang); dy = Math.sin(ang); }
              const len = Math.hypot(dx, dy), push = (min - d) / 2;
              const ux = dx / len, uy = dy / len;
              this.nudge(p, -ux * push, -uy * push); this.nudge(q, ux * push, uy * push);
            }
          }
        }
      });
    }
    return out;
  }

  /** Moves a drawn position, unless that would put it inside a building's footprint. */
  private nudge(p: { x: number; y: number }, dx: number, dy: number): void {
    const x = p.x + dx, y = p.y + dy, w = this.world;
    const tx = Math.round(x), ty = Math.round(y);
    if (tx < 0 || ty < 0 || tx >= w.width || ty >= w.height || w.footprint[tileIndex(w, tx, ty)] !== 0) return;
    p.x = x; p.y = y;
  }

  private drawSettlers(alpha: number, selected: ReadonlySet<number>, now: number, selectedBuilding: number | null): void {
    const marks = this.marks.clear();
    const bars = this.bars.clear();
    const alive = new Set<number>();
    const shown = this.spacedPositions(alpha);
    for (const s of this.world.settlers) {
      // A sawmill's carpenter works in the yard, though the simulation has him inside.
      const pose = s.isInside ? this.outdoorPose(s) : null;
      if (s.isInside && !pose) continue;
      if (s.owner !== this.viewer && !canSee(this.world, this.viewer, s.x, s.y)) continue;
      alive.add(s.id);
      const at = pose ? { x: pose.x - 0.5, y: pose.y - 0.5 } : shown.get(s.id)!;
      const x = at.x, y = at.y;
      const tx = x + 0.5, ty = y + 0.5;
      // Owner colour as a soft disc on the ground under every settler, a white ring when selected.
      const gx = tx * TILE, gy = ty * TILE;
      marks.circle(gx, gy, TILE * 0.28).fill({ color: OWNER_COLORS[s.owner], alpha: s.owner === this.viewer ? 0.35 : 0.6 });
      if (selected.has(s.id)) marks.circle(gx, gy, TILE * 0.42).stroke({ width: 2, color: 0xffffff });
      // The selected building's traffic: carriers bringing it goods in green, those coming to take goods away in orange.
      if (selectedBuilding !== null) {
        const isComing = s.toId === selectedBuilding && (s.carrying !== null || s.phase === 'toPickup');
        const isFetching = s.fromId === selectedBuilding && s.phase === 'toPickup';
        if (isFetching) marks.circle(gx, gy, TILE * 0.4).stroke({ width: 2.5, color: 0xe8a33b });
        else if (isComing) marks.circle(gx, gy, TILE * 0.4).stroke({ width: 2.5, color: 0x7fd36a });
      }
      // Spells working on a soldier glow on the ground under it: Shield gold, Fury red, Freeze ice blue.
      const tick = this.world.tick;
      if (s.shieldUntil > tick) marks.circle(gx, gy, TILE * 0.55).fill({ color: 0xffd678, alpha: 0.28 });
      if (s.furyUntil > tick) marks.circle(gx, gy, TILE * 0.5).stroke({ width: 2, color: 0xe85a3a, alpha: 0.8 });
      if (s.frozenUntil > tick) marks.circle(gx, gy, TILE * 0.55).fill({ color: 0xa8d8ff, alpha: 0.4 });
      if (!this.drawSettlerSprite(s, tx, ty, now, pose)) this.drawSettlerShape(s, tx, ty);
      if (isSoldierType(s.settlerType) || isWarMachineType(s.settlerType) || s.settlerType === 'thief') {
        const max = isSoldierType(s.settlerType) ? SOLDIER_STATS[s.settlerType].health : isWarMachineType(s.settlerType) ? WAR_MACHINE_STATS[s.settlerType].health : 30;
        if (s.health < max) {
          const p = iso(tx, ty);
          bars.rect(p.x - 9, p.y - 34, 18, 3).fill(0x1b2420);
          bars.rect(p.x - 9, p.y - 34, 18 * (s.health / max), 3).fill(s.health / max > 0.4 ? 0x8fdc7a : 0xe8763a);
        }
      }
    }
    // Soldiers leave the world only when they die: they fall where they stood, lie a moment and fade.
    const existing = new Set(this.world.settlers.map((s) => s.id));
    for (const [id, v] of this.settlerViews) {
      if (alive.has(id)) continue;
      if (v.look && v.race && !existing.has(id) && this.bank.hasAnim(v.race, v.look, 'die')) {
        if (v.diedAt === undefined && v.lastX !== undefined) this.sound('fall', v.lastX, v.lastY!);
        v.diedAt ??= now;
        const since = now - v.diedAt;
        if (since < DIE_FRAMES * DIE_FRAME_MS + FALLEN_MS) {
          const art = this.bank.settler(v.race, v.look, 'die', v.dir, Math.min(DIE_FRAMES - 1, Math.floor(since / DIE_FRAME_MS)));
          if (art) this.place(v.body, art, 0, 0);
          this.placeTint(v, v.race, v.look, 'die', v.dir, Math.min(DIE_FRAMES - 1, Math.floor(since / DIE_FRAME_MS)), v.owner ?? 0);
          v.load.visible = false;
          v.root.alpha = Math.max(0, Math.min(1, 1 - (since - DIE_FRAMES * DIE_FRAME_MS - FALLEN_MS / 2) / (FALLEN_MS / 2)));
          continue;
        }
      }
      v.root.destroy({ children: true });
      this.settlerViews.delete(id);
    }
  }

  /**
   * Where a sawmill's carpenter is seen while the simulation has him inside, as in The Settlers III: at the sawhorse
   * left of the door sawing for most of each plank, then carrying the plank to the pile right of the door and walking
   * back; with no logs, waiting by the door. Null for everyone else.
   */
  private outdoorPose(s: Settler): OutdoorPose | null {
    if (s.settlerType !== 'carpenter') return null;
    const b = this.world.buildings.find((x) => x.id === s.homeId);
    if (!b || b.typeId !== 'sawmill' || !b.isComplete || b.workerId !== s.id) return null;
    const spots = sawmillSpots(b);
    if (s.phase === 'working') {
      const ticks = BUILDING_TYPES.sawmill.recipe?.ticks ?? 155;
      const t = Math.max(0, Math.min(1, 1 - s.timer / ticks));
      if (t < SAW_SHARE) return { ...spots.saw, dir: 6, anim: 'work', isWalking: false, carrying: null };
      const to = (a: { x: number; y: number }, c: { x: number; y: number }, u: number) => ({ x: a.x + (c.x - a.x) * u, y: a.y + (c.y - a.y) * u });
      const carryEnd = SAW_SHARE + (1 - SAW_SHARE) / 2;
      if (t < carryEnd) {
        const u = (t - SAW_SHARE) / (carryEnd - SAW_SHARE);
        return { ...to(spots.saw, spots.pile, u), dir: dirToward(spots.saw, spots.pile), anim: 'carry', isWalking: true, carrying: 'plank' };
      }
      const u = (t - carryEnd) / (1 - carryEnd);
      return { ...to(spots.pile, spots.saw, u), dir: dirToward(spots.pile, spots.saw), anim: 'walk', isWalking: true, carrying: null };
    }
    // No logs to saw: he waits by the door.
    if (b.blockedReason === 'Waiting: no logs') return { ...spots.door, dir: 0, anim: 'walk', isWalking: false, carrying: null };
    return null;
  }

  /** The sawmill's sawhorse by its door, with a log on it while the carpenter saws. */
  private drawSawhorse(b: Building, v: BuildingView): void {
    if (b.typeId !== 'sawmill' || !b.isComplete || !v.body.visible) { if (v.sawhorse) v.sawhorse.visible = false; return; }
    if (!v.sawhorse) { v.sawhorse = new Sprite(); v.sawhorse.anchor.set(0.5, 1); this.upright.addChild(v.sawhorse); }
    const worker = b.workerId === null ? undefined : this.world.settlers.find((s) => s.id === b.workerId);
    const ticks = BUILDING_TYPES.sawmill.recipe?.ticks ?? 155;
    const isSawing = !!worker && worker.phase === 'working' && 1 - worker.timer / ticks < SAW_SHARE;
    v.sawhorse.texture = this.sawhorseTexture(isSawing);
    const at = sawmillSpots(b).horse, p = iso(at.x, at.y);
    v.sawhorse.position.set(p.x, p.y);
    v.sawhorse.zIndex = at.x + at.y - 0.05;
    v.sawhorse.visible = true;
  }

  private readonly sawhorseTextures = new Map<boolean, Texture>();
  /** A trestle of two crossed leg pairs and a beam, drawn along the map's x axis; with a log laid on it, or bare. */
  private sawhorseTexture(hasLog: boolean): Texture {
    const kept = this.sawhorseTextures.get(hasLog);
    if (kept) return kept;
    const g = new Graphics();
    const wood = 0x8a5c30, dark = 0x3b2814;
    const a = iso(-0.36, 0), c = iso(0.36, 0);
    for (const end of [a, c]) {
      g.moveTo(end.x - 4.5, end.y).lineTo(end.x + 3, end.y - 14).moveTo(end.x + 4.5, end.y).lineTo(end.x - 3, end.y - 14).stroke({ width: 2.6, color: dark });
    }
    g.moveTo(a.x, a.y - 13).lineTo(c.x, c.y - 13).stroke({ width: 4.5, color: wood });
    if (hasLog) {
      const la = iso(-0.46, 0), lc = iso(0.46, 0);
      g.moveTo(la.x, la.y - 18).lineTo(lc.x, lc.y - 18).stroke({ width: 7, color: 0x9a6a3a, cap: 'round' });
      g.circle(lc.x, lc.y - 18, 3.4).fill(0xd9b27a).stroke({ width: 1, color: 0x7a5228 });
    }
    const texture = this.app.renderer.generateTexture({ target: g, resolution: 3 });
    g.destroy();
    this.sawhorseTextures.set(hasLog, texture);
    return texture;
  }

  private drawSettlerSprite(s: Settler, tx: number, ty: number, now: number, pose: OutdoorPose | null = null): boolean {
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
    if (!isMoving && (s.phase === 'building' || s.phase === 'leveling')) {
      // At work on a site: always facing its middle, hammer or spade toward the building.
      const site = this.world.buildings.find((b) => b.id === s.homeId);
      if (site) {
        const fx = site.x + site.size / 2 - 0.5 - s.x, fy = site.y + site.size / 2 - 0.5 - s.y;
        if (Math.hypot(fx, fy) > 0.3) v.dir = (Math.round(Math.atan2(fx, fy) / (Math.PI / 4)) + 8) % 8;
      }
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
    if (anim === 'attack' && isSoldierType(s.settlerType)) {
      // A soldier's strike follows its weapon's rhythm: the blow lands, or the arrow leaves, on the fourth of six
      // frames at the moment the hit is dealt (when the cooldown restarts), then it draws back for the next one.
      const max = SOLDIER_STATS[s.settlerType].cooldown;
      frame = Math.floor(((max - s.cooldown) / max) * 6 + 3) % 6 - s.id;
    }
    if (anim === 'attack' && isWarMachineType(s.settlerType)) {
      // Machines play their shot once, from the moment it was fired (ticks since the shot, two per frame).
      frame = Math.min(5, Math.floor((WAR_MACHINE_STATS[s.settlerType].cooldown - s.cooldown) / 2)) - s.id;
    }
    // Picking up or putting down a load: the carrier bends down for a moment where it happened.
    const carried = s.carrying ?? null;
    if (v.carried !== undefined && carried !== v.carried) v.handledAt = now;
    v.carried = carried;
    if (s.settlerType === 'carrier' && v.handledAt !== undefined && now - v.handledAt < HANDLE_MS && this.bank.hasAnim(race, look, 'work')) {
      anim = 'work'; frame = Math.floor(((now - v.handledAt) / HANDLE_MS) * 6) - s.id;
    }
    const isIdleCarrier = s.settlerType === 'carrier' && s.phase === 'idle' && !s.carrying && !isWalking && anim === 'walk';
    const kickAt = isIdleCarrier && this.bank.hasAnim(race, look, 'kick')
      ? (now + s.id * 1237) % (KICK_EVERY_MS + ((s.id * 2731) % KICK_SPREAD_MS)) : Infinity;
    this.drawFart(v, isIdleCarrier ? (now + s.id * 7919) % (FART_EVERY_MS + ((s.id * 4111) % FART_SPREAD_MS)) : Infinity);
    if (kickAt < KICK_MS) { anim = 'kick'; frame = Math.floor(kickAt / KICK_FRAME_MS) - s.id; }
    this.drawPebble(v, kickAt - KICK_MS / 2);
    // Ships rock on the swell all the time, slowly.
    if (isShipType(s.settlerType)) { anim = 'walk'; frame = Math.floor(now / 260); }
    // At work in a yard: the pose says where he faces and what he does.
    if (pose) {
      v.dir = pose.dir;
      anim = pose.anim === 'work' && !this.bank.hasAnim(race, look, 'work') ? 'walk' : pose.anim === 'carry' && !this.bank.hasAnim(race, look, 'carry') ? 'walk' : pose.anim;
      frame = anim === 'work' ? Math.floor(now / 140) : pose.isWalking ? Math.floor(now / 85) : 0;
    }
    const art = this.bank.settler(race, look, anim, v.dir, frame + s.id);
    if (!art) return false;
    if (isSoldierType(s.settlerType)) { v.race = race; v.look = look; v.owner = s.owner; }
    this.cueSound(s, v, look, anim, frame + s.id, tx, ty);
    this.place(v.body, art, 0, 0);
    this.placeTint(v, race, look, anim, v.dir, frame + s.id, s.owner);
    const p = iso(tx, ty);
    v.root.position.set(p.x, p.y);
    v.root.zIndex = tx + ty;
    v.lastX = tx; v.lastY = ty;
    // A trade ship's cargo is in its hold.
    const carriedGood = pose ? pose.carrying : s.carrying;
    const good = carriedGood && !isShipType(s.settlerType) ? this.bank.good(carriedGood) : null;
    v.load.visible = !!good;
    if (good) {
      this.place(v.load, good, 0, 0);
      // Large enough to tell what is carried at normal zoom.
      v.load.scale.set(this.bank.scale * (s.settlerType === 'donkey' ? 1.3 : 1.5) / (s.carrying === 'stone' ? 1.5 : s.carrying === 'plank' ? 0.83 : s.carrying === 'log' ? 2.4 : 1));
      const fx = Math.sin(v.dir * Math.PI / 4), fy = Math.cos(v.dir * Math.PI / 4);
      const front = iso(fx * 0.12, fy * 0.12);
      // A donkey's load sits on its back; a carrier's in its hands; others carry it above the head.
      v.load.position.set(front.x, front.y - (s.settlerType === 'donkey' ? 14 : anim === 'carry' ? 11 : 24));
      // Behind the body when the settler walks away from the viewer.
      v.root.setChildIndex(v.load, v.dir >= 3 && v.dir <= 5 ? 0 : 1);
    }
    return true;
  }

  /**
   * Sounds of work and battle, at the frame the stroke lands (the fourth of six): a chop, a hammer blow, a pick on
   * stone, a spade in earth, swords meeting, a bow released, a war machine's shot. Once per stroke.
   */
  /** An idle carrier's green cloud, `since` ms after it came out: puffs from behind it that swell, drift up and fade. */
  private drawFart(v: SettlerView, since: number): void {
    if (!(since >= 0 && since < FART_MS)) { if (v.fart) v.fart.visible = false; return; }
    const g = v.fart ??= new Graphics();
    if (!g.parent) v.root.addChild(g);
    const t = since / FART_MS;
    // Out of the back, opposite the way it faces, at hip height.
    const bx = -Math.sin(v.dir * Math.PI / 4), by = -Math.cos(v.dir * Math.PI / 4);
    const back = iso(bx * 0.3, by * 0.3);
    g.clear();
    for (let k = 0; k < 4; k++) {
      const u = Math.max(0, Math.min(1, t * 1.4 - k * 0.12));
      if (u <= 0) continue;
      const x = back.x + bx * u * 14 + Math.sin(u * 5 + k * 1.7) * 4, y = back.y - 9 - u * 18 - k * 3;
      g.circle(x, y, 4 + u * 8 - k * 0.6).fill({ color: k % 2 === 0 ? 0x8fd13a : 0x6fae22, alpha: 0.75 * (1 - u * u) });
    }
    g.visible = true;
    // In front of the body, so the cloud shows whichever way the carrier faces.
    v.root.setChildIndex(g, v.root.children.length - 1);
  }

  /** The kicked pebble, `since` ms after the foot met it: it hops away in the direction the carrier faces and fades. */
  private drawPebble(v: SettlerView, since: number): void {
    if (!(since >= 0 && since < PEBBLE_MS)) { if (v.pebble) v.pebble.visible = false; return; }
    if (!v.pebble) {
      v.pebble = new Graphics().ellipse(0, 0, 3.4, 2.4).fill(0x7d776c).ellipse(-0.8, -0.8, 1.7, 1.1).fill(0xb9b2a5);
      v.root.addChild(v.pebble);
    }
    const t = since / PEBBLE_MS, d = PEBBLE_TILES * (1 - (1 - t) * (1 - t));
    const fx = Math.sin(v.dir * Math.PI / 4), fy = Math.cos(v.dir * Math.PI / 4);
    const p = iso(fx * (0.15 + d), fy * (0.15 + d));
    // Two hops, the second lower, then it rolls to a stop.
    const hop = t < 0.45 ? Math.sin((t / 0.45) * Math.PI) * 7 : t < 0.75 ? Math.sin(((t - 0.45) / 0.3) * Math.PI) * 2.5 : 0;
    v.pebble.visible = true;
    v.pebble.position.set(p.x, p.y - 2 - hop);
    v.pebble.alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    // Behind the body when kicked away from the viewer.
    v.root.setChildIndex(v.pebble, v.dir >= 3 && v.dir <= 5 ? 0 : v.root.children.length - 1);
  }

  private cueSound(s: Settler, v: SettlerView, look: SettlerLook, anim: SettlerAnim, frame: number, tx: number, ty: number): void {
    if (!this.onSound || (anim !== 'work' && anim !== 'attack') || s.settlerType === 'carrier') return;
    const isMachine = isWarMachineType(s.settlerType);
    if (isMachine) {
      // A war machine sounds once, at the start of its firing movement.
      if (frame !== 0 || v.cuedFrame === frame) { if (frame !== 0) v.cuedFrame = undefined; return; }
      v.cuedFrame = frame;
    } else {
      // Once per stroke: the stroke counts as come once its frame has passed, even when a slow screen skipped it.
      const stroke = Math.floor((frame - 3) / 6);
      if (v.cuedFrame === stroke) return;
      const isFirstLook = v.cuedFrame === undefined;
      v.cuedFrame = stroke;
      if (isFirstLook) return;
    }
    const id: SoundId | null = isMachine ? 'siege'
      : anim === 'attack' ? (s.settlerType === 'bowman' ? 'bow' : 'clash')
      : look === 'woodcutter' ? 'chop' : look === 'builder' ? 'hammer' : look === 'stonecutter' ? 'pick'
      : look === 'digger' || look === 'pioneer' || look === 'farmer' ? 'dig' : null;
    if (id) this.sound(id, tx, ty);
  }

  /** Hands a map sound at a tile to whoever plays sound, with where it is on the canvas. */
  private sound(id: SoundId, tx: number, ty: number): void {
    if (!this.onSound) return;
    const p = this.tileToCanvas(tx - 0.5, ty - 0.5);
    this.onSound(id, p.x, p.y);
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
    // Placement markers: a small square on screen at the centre of every spot where the building fits.
    const marks = this.markerLayer.clear();
    const half = markerSize / 2, side = MARKER_SIDE;
    for (const i of markers) {
      const tx = (i % this.world.width) + half, ty = Math.floor(i / this.world.width) + half;
      marks.rect((tx - ty) * ISO_W / 2 - side / 2, (tx + ty) * ISO_H / 2 - side / 2, side, side);
    }
    if (markers.length > 0) marks.fill({ color: 0x8fdc7a, alpha: 0.9 });
    if (ghost) {
      const size = BUILDING_TYPES[ghost.typeId].size;
      const color = ghost.isValid ? 0x8fdc7a : 0xe8763a;
      g.rect(ghost.x * TILE, ghost.y * TILE, size * TILE, size * TILE).fill({ color, alpha: 0.25 }).stroke({ width: 2, color });
      const doorX = ghost.x + Math.floor(size / 2), doorY = ghost.y + size;
      g.rect(doorX * TILE + 3, doorY * TILE + 3, TILE - 6, TILE - 6).stroke({ width: 2, color });
    }
    // Footprint outlines on the ground: the selected building in white, stuck ones in orange.
    const outlines = this.groundOutlines.clear();
    for (const b of this.world.buildings) {
      const isStuck = b.owner === this.viewer && b.blockedReason && b.blockedSince !== null && this.world.tick - b.blockedSince > 30;
      if (b.id !== state.selectedId && !isStuck) continue;
      outlines.rect(b.x * TILE, b.y * TILE, b.size * TILE, b.size * TILE).stroke({ width: 3, color: b.id === state.selectedId ? 0xffffff : 0xe8763a });
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
    if (state.workReach) {
      const { x, y, radius } = state.workReach;
      g.circle((x + 0.5) * TILE, (y + 0.5) * TILE, radius * TILE).stroke({ width: 2, color: 0xece6d6, alpha: 0.6 });
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
    const real = performance.now();
    this.clock += Math.min(250, real - (this.lastRender ?? real)) * state.speed;
    this.lastRender = real;
    const now = this.clock;
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
    this.drawFish();
    this.drawBuildings(state);
    this.drawSettlers(alpha, state.selectedSoldiers, now, state.selectedId);
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

  /** The visible building whose picture is under a point on screen, the front-most one. */
  buildingAtScreen(clientX: number, clientY: number): Building | undefined {
    return this.buildingsAtScreen(clientX, clientY)[0];
  }

  /**
   * Every visible building whose picture covers a point on screen, front-most first. Only solid pixels count, so a
   * building seen through a gap in a bigger one in front of it, or past its edge, is found.
   */
  buildingsAtScreen(clientX: number, clientY: number): Building[] {
    const rect = this.app.canvas.getBoundingClientRect();
    const px = clientX - rect.left, py = clientY - rect.top;
    const hits: { b: Building; z: number }[] = [];
    for (const b of this.world.buildings) {
      const v = this.buildingViews.get(b.id);
      if (!v || !v.body.visible || !v.root.visible || !v.body.texture) continue;
      const bounds = v.body.getBounds();
      if (px < bounds.x || px > bounds.x + bounds.width || py < bounds.y || py > bounds.y + bounds.height) continue;
      const local = v.body.toLocal({ x: px, y: py });
      const tw = v.body.texture.width, th = v.body.texture.height;
      const ax = local.x + v.body.anchor.x * tw, ay = local.y + v.body.anchor.y * th;
      if (!isSolidAt(v.body.texture, ax, ay)) continue;
      hits.push({ b, z: v.root.zIndex });
    }
    return hits.sort((p, q) => q.z - p.z).map((h) => h.b);
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

/** Each picture's alpha, read once, so clicks can tell the building from the empty parts of its picture. */
const alphaCache = new WeakMap<Texture, { w: number; h: number; alpha: Uint8ClampedArray } | null>();
const ALPHA_STEP = 2;

function isSolidAt(texture: Texture, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= texture.width || y >= texture.height) return false;
  let entry = alphaCache.get(texture);
  if (entry === undefined) {
    entry = readAlpha(texture);
    alphaCache.set(texture, entry);
  }
  // Without readable pixels, fall back to the middle of the picture.
  if (!entry) return x > texture.width * 0.12 && x < texture.width * 0.88 && y < texture.height * 0.92;
  const cx = Math.min(entry.w - 1, Math.floor(x / ALPHA_STEP)), cy = Math.min(entry.h - 1, Math.floor(y / ALPHA_STEP));
  return entry.alpha[cy * entry.w + cx] > 40;
}

function readAlpha(texture: Texture): { w: number; h: number; alpha: Uint8ClampedArray } | null {
  const resource = texture.source?.resource as CanvasImageSource | undefined;
  if (!resource || typeof document === 'undefined') return null;
  try {
    const w = Math.max(1, Math.ceil(texture.width / ALPHA_STEP)), h = Math.max(1, Math.ceil(texture.height / ALPHA_STEP));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const f = texture.frame;
    ctx.drawImage(resource, f.x, f.y, f.width, f.height, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const alpha = new Uint8ClampedArray(w * h);
    for (let i = 0; i < w * h; i++) alpha[i] = data[i * 4 + 3];
    return { w, h, alpha };
  } catch { return null; }
}
