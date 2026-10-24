import { BUILDING_TYPES, GOOD_TYPES, emptyGoods } from './definitions.ts';
import type { BuildingTypeId, GoodAmounts, GoodType, SettlerType } from './definitions.ts';
import { createRandom } from './random.ts';

export const TICKS_PER_SECOND = 10;

export const TERRAIN_GRASS = 0;
export const TERRAIN_WATER = 1;
export const TERRAIN_MOUNTAIN = 2;

/** Tree growth runs from 0 (sapling) to TREE_MATURE; -1 means no tree. Growth advances every 10 ticks. */
export const NO_TREE = -1;
export const TREE_MATURE = 60;
/** Grain field growth, same scale as trees. */
export const NO_FIELD = -1;
export const FIELD_RIPE = 90;
export const ROCK_STONE = 6;

export interface Building {
  id: number;
  typeId: BuildingTypeId;
  owner: number;
  /** Top-left footprint tile. */
  x: number;
  y: number;
  size: number;
  /** Walkable tile below the footprint where settlers enter. */
  doorX: number;
  doorY: number;
  isComplete: boolean;
  /** Goods held: storage for storage buildings, finished output for producers. */
  stock: GoodAmounts;
  /** Goods waiting to be processed by a workshop. */
  input: GoodAmounts;
  /** Goods carriers are on their way to deliver. */
  incoming: GoodAmounts;
  /** Goods in stock that a carrier has promised to fetch. */
  reserved: GoodAmounts;
  /** Construction materials on site, not yet built in. */
  delivered: GoodAmounts;
  /** Construction materials already built in. */
  built: GoodAmounts;
  /** 0..1: diggers level the site before builders start. */
  levelProgress: number;
  buildProgress: number;
  diggerId: number | null;
  builderId: number | null;
  /** The worker, or for a military building the occupying soldier. */
  workerId: number | null;
  isPaused: boolean;
  /** Settlers a residence still has to send out. */
  residentsLeft: number;
  blockedReason: string | null;
  blockedSince: number | null;
  hasWarned: boolean;
}

export type SettlerPhase =
  | 'idle' | 'toPickup' | 'toDrop' | 'toStore' | 'toSite' | 'leveling' | 'building'
  | 'toTool' | 'toWork' | 'inside' | 'toTarget' | 'working' | 'returning';

export interface Settler {
  id: number;
  owner: number;
  settlerType: SettlerType;
  /** Tile coordinates of the settler's position (tile centre = integer). */
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  path: number[];
  phase: SettlerPhase;
  timer: number;
  carrying: GoodType | null;
  /** Transport: building to collect from and deliver to. Tool pickup: the storage. */
  fromId: number | null;
  toId: number | null;
  good: GoodType | null;
  /** Workplace, construction site or occupied tower. */
  homeId: number | null;
  targetTile: number;
  isInside: boolean;
}

export interface PlayerState {
  id: number;
  /** All goods, carried first to last. */
  transportPriority: GoodType[];
  /** Goods that carriers may take to storage. */
  isStored: Record<GoodType, boolean>;
}

export interface GameMessage {
  id: number;
  tick: number;
  text: string;
  detail: string;
  isWarning: boolean;
  buildingId: number | null;
}

export interface World {
  seed: number;
  tick: number;
  width: number;
  height: number;
  terrain: Uint8Array;
  tree: Int16Array;
  field: Int16Array;
  rock: Uint8Array;
  /** Building id + 1 on footprint tiles, 0 elsewhere. */
  footprint: Int32Array;
  /** Building id + 1 on door tiles, 0 elsewhere. */
  door: Int32Array;
  /** Owner + 1 for owned land, 0 for neutral land. */
  territory: Uint8Array;
  /** Settler id + 1 that has claimed a tree, rock, field or planting spot. */
  claim: Int32Array;
  players: PlayerState[];
  buildings: Building[];
  settlers: Settler[];
  messages: GameMessage[];
  nextId: number;
  randomState: number;
  /** Bumped when trees, fields, rocks or buildings change, so renderers can redraw. */
  mapVersion: number;
  territoryVersion: number;
}

export function tileIndex(world: World, x: number, y: number): number {
  return y * world.width + x;
}

export function inBounds(world: World, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < world.width && y < world.height;
}

export function isWalkable(world: World, index: number): boolean {
  return world.terrain[index] !== TERRAIN_WATER && world.rock[index] === 0 && world.footprint[index] === 0;
}

export function buildingById(world: World, id: number | null): Building | undefined {
  if (id === null) return undefined;
  return world.buildings.find((b) => b.id === id);
}

export function settlerById(world: World, id: number | null): Settler | undefined {
  if (id === null) return undefined;
  return world.settlers.find((s) => s.id === id);
}

export function castleOf(world: World, owner: number): Building | undefined {
  return world.buildings.find((b) => b.owner === owner && b.typeId === 'castle');
}

export function playerOf(world: World, owner: number): PlayerState | undefined {
  return world.players.find((p) => p.id === owner);
}

export function isStorageBuilding(b: Building): boolean {
  return b.isComplete && BUILDING_TYPES[b.typeId].storageCapacity > 0;
}

export function storedTotal(b: Building): number {
  let total = 0;
  for (const good of GOOD_TYPES) total += b.stock[good] + b.incoming[good];
  return total;
}

export function newBuilding(world: World, typeId: BuildingTypeId, owner: number, x: number, y: number): Building {
  const size = BUILDING_TYPES[typeId].size;
  const b: Building = {
    id: world.nextId++, typeId, owner, x, y, size,
    doorX: x + Math.floor(size / 2), doorY: y + size,
    isComplete: false,
    stock: emptyGoods(), input: emptyGoods(), incoming: emptyGoods(), reserved: emptyGoods(),
    delivered: emptyGoods(), built: emptyGoods(),
    levelProgress: 0, buildProgress: 0, diggerId: null, builderId: null, workerId: null,
    isPaused: false, residentsLeft: 0,
    blockedReason: null, blockedSince: null, hasWarned: false
  };
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const i = tileIndex(world, x + dx, y + dy);
      world.footprint[i] = b.id + 1;
      world.field[i] = NO_FIELD;
    }
  }
  world.door[tileIndex(world, b.doorX, b.doorY)] = b.id + 1;
  world.field[tileIndex(world, b.doorX, b.doorY)] = NO_FIELD;
  world.buildings.push(b);
  world.mapVersion++;
  return b;
}

export function removeBuilding(world: World, b: Building): void {
  for (let dy = 0; dy < b.size; dy++) {
    for (let dx = 0; dx < b.size; dx++) world.footprint[tileIndex(world, b.x + dx, b.y + dy)] = 0;
  }
  world.door[tileIndex(world, b.doorX, b.doorY)] = 0;
  world.buildings = world.buildings.filter((other) => other.id !== b.id);
  world.mapVersion++;
}

export function newSettler(world: World, owner: number, settlerType: SettlerType, x: number, y: number): Settler {
  const s: Settler = {
    id: world.nextId++, owner, settlerType, x, y, prevX: x, prevY: y, path: [], phase: 'idle', timer: 0,
    carrying: null, fromId: null, toId: null, good: null, homeId: null, targetTile: -1, isInside: true
  };
  world.settlers.push(s);
  return s;
}

export function pushMessage(world: World, text: string, detail: string, isWarning: boolean, buildingId: number | null): void {
  world.messages.push({ id: world.nextId++, tick: world.tick, text, detail, isWarning, buildingId });
  if (world.messages.length > 30) world.messages.shift();
}

/** A military building counts once finished and occupied; the castle always counts. */
export function claimsTerritory(world: World, b: Building): boolean {
  if (!b.isComplete || BUILDING_TYPES[b.typeId].territoryRadius === 0) return false;
  if (b.typeId === 'castle') return true;
  const soldier = settlerById(world, b.workerId);
  return !!soldier && soldier.phase === 'inside';
}

/** Rebuilds owned land from the buildings that claim territory. */
export function recomputeTerritory(world: World): void {
  const next = new Uint8Array(world.width * world.height);
  for (const b of world.buildings) {
    if (!claimsTerritory(world, b)) continue;
    const r = BUILDING_TYPES[b.typeId].territoryRadius;
    const cx = b.x + b.size / 2, cy = b.y + b.size / 2;
    for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(world.height, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(world.width, Math.ceil(cx + r)); x++) {
        const i = tileIndex(world, x, y);
        if (next[i] === 0 && Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) next[i] = b.owner + 1;
      }
    }
  }
  let isChanged = false;
  for (let i = 0; i < next.length; i++) if (next[i] !== world.territory[i]) { isChanged = true; break; }
  if (!isChanged) return;
  world.territory = next;
  world.territoryVersion++;
}

export function defaultPlayer(id: number): PlayerState {
  const isStored = {} as Record<GoodType, boolean>;
  for (const good of GOOD_TYPES) isStored[good] = true;
  return {
    id,
    transportPriority: ['plank', 'stone', 'log', 'axe', 'saw', 'pick', 'scythe', 'shovel', 'hammer', 'rod',
      'water', 'grain', 'flour', 'bread', 'fish'],
    isStored
  };
}

export interface CreateWorldOptions {
  seed?: number;
  width?: number;
  height?: number;
}

export const STARTING_STOCK: Partial<GoodAmounts> = {
  log: 8, plank: 40, stone: 40, axe: 3, saw: 2, pick: 3, scythe: 2, rod: 1
};
export const STARTING_SETTLERS: Partial<Record<SettlerType, number>> = { carrier: 20, digger: 3, builder: 4, soldier: 5 };

/** Creates a seeded single-player map with a castle, territory and starting settlers. */
export function createWorld({ seed = 1, width = 96, height = 96 }: CreateWorldOptions = {}): World {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('seed must be a uint32');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 48 || height < 48 || width > 512 || height > 512) {
    throw new RangeError('map size must be between 48 and 512 tiles');
  }
  const n = width * height;
  const world: World = {
    seed, tick: 0, width, height,
    terrain: new Uint8Array(n), tree: new Int16Array(n).fill(NO_TREE), field: new Int16Array(n).fill(NO_FIELD),
    rock: new Uint8Array(n), footprint: new Int32Array(n), door: new Int32Array(n), territory: new Uint8Array(n),
    claim: new Int32Array(n), players: [defaultPlayer(0)], buildings: [], settlers: [], messages: [],
    nextId: 1, randomState: seed >>> 0, mapVersion: 0, territoryVersion: 0
  };
  generateTerrain(world);
  placeCastle(world, 0);
  return world;
}

function valueNoise(seed: number, width: number, height: number, cell: number): Float32Array {
  const random = createRandom(seed);
  const gw = Math.ceil(width / cell) + 2;
  const gh = Math.ceil(height / cell) + 2;
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = random.next();
  const out = new Float32Array(width * height);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx = x / cell, gy = y / cell;
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      const tx = smooth(gx - x0), ty = smooth(gy - y0);
      const a = grid[y0 * gw + x0], b = grid[y0 * gw + x0 + 1];
      const c = grid[(y0 + 1) * gw + x0], d = grid[(y0 + 1) * gw + x0 + 1];
      out[y * width + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return out;
}

function generateTerrain(world: World): void {
  const { width, height, seed } = world;
  const coarse = valueNoise(seed ^ 0x9e3779b9, width, height, 16);
  const fine = valueNoise(seed ^ 0x85ebca6b, width, height, 6);
  const forest = valueNoise(seed ^ 0xc2b2ae35, width, height, 10);
  const random = createRandom(seed ^ 0x27d4eb2f);
  for (let i = 0; i < width * height; i++) {
    const elevation = coarse[i] * 0.7 + fine[i] * 0.3;
    if (elevation < 0.27) world.terrain[i] = TERRAIN_WATER;
    else if (elevation > 0.74) world.terrain[i] = TERRAIN_MOUNTAIN;
  }
  for (let i = 0; i < width * height; i++) {
    const r = random.next();
    if (world.terrain[i] === TERRAIN_MOUNTAIN && r < 0.35) world.rock[i] = ROCK_STONE;
    else if (world.terrain[i] === TERRAIN_GRASS && forest[i] > 0.58 && r < 0.6) world.tree[i] = TREE_MATURE;
    else if (world.terrain[i] === TERRAIN_GRASS && r < 0.012) world.rock[i] = ROCK_STONE;
  }
}

function placeCastle(world: World, owner: number): void {
  const size = BUILDING_TYPES.castle.size;
  const radius = BUILDING_TYPES.castle.territoryRadius;
  const cx = Math.floor(world.width * 0.35), cy = Math.floor(world.height * 0.5);
  let best = { x: cx, y: cy };
  let bestScore = -Infinity;
  for (let y = 8; y < world.height - 12; y++) {
    for (let x = 8; x < world.width - 12; x++) {
      let grass = 0, water = 0;
      for (let dy = -6; dy <= 9; dy++) {
        for (let dx = -6; dx <= 9; dx++) {
          if (world.terrain[tileIndex(world, x + dx, y + dy)] === TERRAIN_GRASS) grass++;
        }
      }
      // A start with water inside the territory allows waterworks and fishers.
      for (let dy = -12; dy <= 15; dy += 3) {
        for (let dx = -12; dx <= 15; dx += 3) {
          if (inBounds(world, x + dx, y + dy) && world.terrain[tileIndex(world, x + dx, y + dy)] === TERRAIN_WATER) water++;
        }
      }
      const score = grass + Math.min(water, 6) * 8 - Math.hypot(x - cx, y - cy) * 2;
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
  }
  const { x, y } = best;
  const centreX = x + size / 2, centreY = y + size / 2;
  // Clear the castle surroundings so the first buildings have room.
  for (let ty = y - 5; ty < y + size + 6; ty++) {
    for (let tx = x - 5; tx < x + size + 6; tx++) {
      if (!inBounds(world, tx, ty)) continue;
      const i = tileIndex(world, tx, ty);
      world.terrain[i] = TERRAIN_GRASS;
      world.tree[i] = NO_TREE;
      world.rock[i] = 0;
    }
  }
  ensureStartingResources(world, centreX, centreY, radius);
  const castle = newBuilding(world, 'castle', owner, x, y);
  castle.isComplete = true;
  castle.levelProgress = 1;
  castle.buildProgress = 1;
  for (const good of GOOD_TYPES) castle.stock[good] = STARTING_STOCK[good] ?? 0;
  for (const [type, count] of Object.entries(STARTING_SETTLERS) as [SettlerType, number][]) {
    for (let i = 0; i < count; i++) newSettler(world, owner, type, castle.doorX, castle.doorY);
  }
  recomputeTerritory(world);
}

/** Every start gets enough trees and rocks inside its territory to begin the timber chain. */
function ensureStartingResources(world: World, centreX: number, centreY: number, radius: number): void {
  const random = createRandom(world.seed ^ 0x165667b1);
  const inRing = (i: number) => {
    const tx = i % world.width, ty = Math.floor(i / world.width);
    const d = Math.hypot(tx + 0.5 - centreX, ty + 0.5 - centreY);
    return d > 8 && d < radius - 1;
  };
  let trees = 0, rocks = 0;
  const candidates: number[] = [];
  for (let i = 0; i < world.width * world.height; i++) {
    if (!inRing(i)) continue;
    if (world.tree[i] >= 0) trees++;
    if (world.rock[i] > 0) rocks++;
    if (world.terrain[i] === TERRAIN_GRASS && world.tree[i] < 0 && world.rock[i] === 0) candidates.push(i);
  }
  // Grow a grove and a rock cluster on opposite sides, so they compete for space with buildings.
  const angle = random.next() * Math.PI * 2;
  const grove = { x: centreX + Math.cos(angle) * 11, y: centreY + Math.sin(angle) * 11 };
  const quarry = { x: centreX - Math.cos(angle) * 11, y: centreY - Math.sin(angle) * 11 };
  const near = (i: number, p: { x: number; y: number }, r: number) =>
    Math.hypot((i % world.width) + 0.5 - p.x, Math.floor(i / world.width) + 0.5 - p.y) < r;
  for (const i of candidates) {
    if (trees < 30 && near(i, grove, 4) && random.next() < 0.7) { world.tree[i] = TREE_MATURE; trees++; }
    else if (rocks < 8 && near(i, quarry, 2.5) && random.next() < 0.7) { world.rock[i] = ROCK_STONE; rocks++; }
  }
}
