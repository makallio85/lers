import type { BotType } from './bot.ts';
import {
  BUILDING_TYPES, DEPOSIT_COAL, DEPOSIT_GOLD, DEPOSIT_IRON, DEPOSIT_NONE, GOOD_TYPES, SOLDIER_STATS, TOOL_TYPES, WEAPON_TYPES,
  consumersOf, distributedGoods, emptyGoods, isSoldierType
} from './definitions.ts';
import type { BuildingTypeId, GoodAmounts, GoodType, SettlerType } from './definitions.ts';
import { createRandom } from './random.ts';

export const TICKS_PER_SECOND = 10;

export const TERRAIN_GRASS = 0;
export const TERRAIN_WATER = 1;
export const TERRAIN_MOUNTAIN = 2;

/** Tree growth runs from 0 (sapling) to TREE_MATURE; -1 means no tree. Growth advances one step every GROWTH_TICKS (step.ts). */
export const NO_TREE = -1;
export const TREE_MATURE = 60;
/** Grain field growth, same scale as trees. */
export const NO_FIELD = -1;
export const FIELD_RIPE = 90;
/** Stone in one rock tile when the map is made; a stonecutter takes one at a time. */
export const ROCK_STONE = 12;
export const DEPOSIT_AMOUNT = 20;

/** Fog of war per tile and player. */
export const VISION_NONE = 0;
export const VISION_EXPLORED = 1;
export const VISION_VISIBLE = 2;

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
  /** Goods waiting to be used by the building. */
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
  /** The civilian worker. */
  workerId: number | null;
  /** Soldiers inside a military building, and how many it asks for. */
  garrison: number[];
  garrisonWanted: number;
  /** A military building claims land from the first soldier moving in until its last defender is gone. */
  isOccupied: boolean;
  /** Shifts a miner can still work from the last meal. */
  meals: number;
  /** Paused: a workplace stops working; a construction site gets no materials or crew ("Suspend"). */
  isPaused: boolean;
  /** Construction sites only: served before other sites ("Build first"). */
  isPriority: boolean;
  /** Gatherers only: the centre of the work area, or null for around the door. */
  workX: number | null;
  workY: number | null;
  /** Settlers a residence still has to send out. */
  residentsLeft: number;
  blockedReason: string | null;
  blockedSince: number | null;
  hasWarned: boolean;
}

export type SettlerPhase =
  | 'idle' | 'toPickup' | 'toDrop' | 'toStore' | 'toSite' | 'leveling' | 'building'
  | 'toTool' | 'toWork' | 'inside' | 'toTarget' | 'working' | 'returning'
  | 'toRecruit' | 'toGarrison' | 'defending' | 'moving' | 'attacking'
  | 'prospecting' | 'claiming';

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
  /** Workplace, construction site, barracks or the military building a soldier belongs to. */
  homeId: number | null;
  targetTile: number;
  isInside: boolean;
  /** Soldiers only: health, ticks until the next blow, the enemy fought and the building attacked. */
  health: number;
  cooldown: number;
  enemyId: number | null;
  attackId: number | null;
  /** Specialists only: the tile they were sent to work around, or -1. */
  workCentre: number;
}

export interface PlayerStats {
  buildingsBuilt: number;
  soldiersRecruited: number;
  soldiersLost: number;
  towersTaken: number;
  planksMade: number;
  breadBaked: number;
  largestTerritory: number;
}

export interface PlayerState {
  id: number;
  isBot: boolean;
  /** How this player's built-in bot plays; unused for human players. */
  botType: BotType;
  isEliminated: boolean;
  /** All goods, carried first to last. */
  transportPriority: GoodType[];
  /** Goods that carriers may take to storage. */
  isStored: Record<GoodType, boolean>;
  /** Tools and weapons ordered from the smiths; worked off before the shares. */
  productionOrders: Partial<Record<GoodType, number>>;
  /** Long-run share (0–10) of each tool and weapon. */
  productionShares: Partial<Record<GoodType, number>>;
  productionCredit: Partial<Record<GoodType, number>>;
  /** For goods several building types use: share (0–10) per consumer type, and deliveries so far. */
  distribution: Partial<Record<GoodType, Partial<Record<BuildingTypeId, number>>>>;
  distributionCount: Partial<Record<GoodType, Partial<Record<BuildingTypeId, number>>>>;
  /** Automatic: every weapon at the barracks becomes a soldier. Otherwise only `recruitsLeft` more. */
  isRecruitingAutomatic: boolean;
  recruitsLeft: number;
  /** Occupations: new diggers and builders only while carriers stay at least this share (percent) of the settlers. */
  minCarrierPercent: number;
  /** Occupations: diggers and builders together stay at most this share (percent) of the settlers. */
  maxCrewPercent: number;
  stats: PlayerStats;
}

export interface GameMessage {
  id: number;
  /** Player the message is for. */
  owner: number;
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
  /** Ore under mountain tiles and how much is left. */
  deposit: Uint8Array;
  depositAmount: Uint8Array;
  /** Building id + 1 on footprint tiles, 0 elsewhere. */
  footprint: Int32Array;
  /** Building id + 1 on door tiles, 0 elsewhere. */
  door: Int32Array;
  /** Owner + 1 for owned land, 0 for neutral land. */
  territory: Uint8Array;
  /** Settler id + 1 that has claimed a tree, rock, field or planting spot. */
  claim: Int32Array;
  /** Per player: what each tile shows through the fog of war. */
  vision: Uint8Array[];
  /** Per player: 1 where one of its geologists has put up a sign, so the ore there (or its absence) is known. */
  prospect: Uint8Array[];
  /** Owner + 1 of land claimed by pioneers' posts. Military land takes precedence over it. */
  pioneerLand: Uint8Array;
  /** Owner + 1 of land claimed by military buildings alone; worked out with the territory, not saved. */
  militaryLand: Uint8Array;
  players: PlayerState[];
  buildings: Building[];
  settlers: Settler[];
  messages: GameMessage[];
  nextId: number;
  randomState: number;
  /** Bumped when trees, fields, rocks or buildings change, so renderers can redraw. */
  mapVersion: number;
  territoryVersion: number;
  winner: number | null;
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

export function nextRandom(world: World): number {
  const random = createRandom(world.randomState);
  const value = random.next();
  world.randomState = random.state;
  return value;
}

export function isStorageBuilding(b: Building): boolean {
  return b.isComplete && BUILDING_TYPES[b.typeId].storageCapacity > 0;
}

export function isMilitaryBuilding(b: Building): boolean {
  return BUILDING_TYPES[b.typeId].garrisonCapacity > 0;
}

export function storedTotal(b: Building): number {
  let total = 0;
  for (const good of GOOD_TYPES) total += b.stock[good] + b.incoming[good];
  return total;
}

export function newBuilding(world: World, typeId: BuildingTypeId, owner: number, x: number, y: number): Building {
  const type = BUILDING_TYPES[typeId];
  const size = type.size;
  const b: Building = {
    id: world.nextId++, typeId, owner, x, y, size,
    doorX: x + Math.floor(size / 2), doorY: y + size,
    isComplete: false,
    stock: emptyGoods(), input: emptyGoods(), incoming: emptyGoods(), reserved: emptyGoods(),
    delivered: emptyGoods(), built: emptyGoods(),
    levelProgress: 0, buildProgress: 0, diggerId: null, builderId: null, workerId: null,
    garrison: [], garrisonWanted: typeId === 'castle' ? 3 : Math.min(1, type.garrisonCapacity), isOccupied: false, meals: 0,
    isPaused: false, isPriority: false, workX: null, workY: null, residentsLeft: 0,
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
    carrying: null, fromId: null, toId: null, good: null, homeId: null, targetTile: -1, isInside: true,
    health: isSoldierType(settlerType) ? SOLDIER_STATS[settlerType].health : 0, cooldown: 0, enemyId: null, attackId: null,
    workCentre: -1
  };
  world.settlers.push(s);
  return s;
}

export function pushMessage(world: World, owner: number, text: string, detail: string, isWarning: boolean, buildingId: number | null): void {
  world.messages.push({ id: world.nextId++, owner, tick: world.tick, text, detail, isWarning, buildingId });
  if (world.messages.length > 60) world.messages.shift();
}

/** The castle always claims land; any other military building while it is occupied. */
export function claimsTerritory(b: Building): boolean {
  if (!b.isComplete || BUILDING_TYPES[b.typeId].territoryRadius === 0) return false;
  return b.typeId === 'castle' || b.isOccupied;
}

/**
 * Rebuilds owned land: each tile belongs to the nearest military building that claims it. Land no building
 * claims belongs to whoever's pioneers put posts on it.
 */
export function recomputeTerritory(world: World): void {
  const next = new Uint8Array(world.width * world.height);
  const best = new Float32Array(world.width * world.height).fill(Infinity);
  for (const b of world.buildings) {
    if (!claimsTerritory(b)) continue;
    const r = BUILDING_TYPES[b.typeId].territoryRadius;
    const cx = b.x + b.size / 2, cy = b.y + b.size / 2;
    for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(world.height, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(world.width, Math.ceil(cx + r)); x++) {
        const i = tileIndex(world, x, y);
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        // Land already held by another player stays theirs unless this building is closer.
        if (d <= r && d < best[i]) { best[i] = d; next[i] = b.owner + 1; }
      }
    }
  }
  world.militaryLand = next.slice();
  for (let i = 0; i < next.length; i++) if (next[i] === 0) next[i] = world.pioneerLand[i];
  let isChanged = false;
  for (let i = 0; i < next.length; i++) if (next[i] !== world.territory[i]) { isChanged = true; break; }
  if (!isChanged) return;
  world.territory = next;
  world.territoryVersion++;
  for (const p of world.players) {
    let land = 0;
    for (let i = 0; i < next.length; i++) if (next[i] === p.id + 1) land++;
    p.stats.largestTerritory = Math.max(p.stats.largestTerritory, land);
  }
}

export const DEFAULT_MIN_CARRIER_PERCENT = 30;
export const DEFAULT_MAX_CREW_PERCENT = 25;

export function defaultPlayer(id: number, isBot: boolean, botType: BotType = 'aggressive'): PlayerState {
  const isStored = {} as Record<GoodType, boolean>;
  for (const good of GOOD_TYPES) isStored[good] = true;
  const productionShares: Partial<Record<GoodType, number>> = {};
  for (const tool of TOOL_TYPES) productionShares[tool] = tool === 'pick' || tool === 'axe' ? 3 : tool === 'hammer' || tool === 'saw' ? 2 : 1;
  productionShares.sword = 5; productionShares.spear = 2; productionShares.bow = 3;
  const distribution: PlayerState['distribution'] = {};
  for (const good of distributedGoods()) {
    distribution[good] = {};
    for (const consumer of consumersOf(good)) distribution[good]![consumer] = 5;
  }
  return {
    id, isBot, botType, isEliminated: false,
    transportPriority: ['plank', 'stone', 'log', ...TOOL_TYPES, ...WEAPON_TYPES, 'coal', 'iron_ore', 'iron', 'gold_ore', 'gold',
      'water', 'grain', 'flour', 'bread', 'fish', 'pig', 'meat'],
    isStored, productionOrders: {}, productionShares, productionCredit: {}, distribution, distributionCount: {},
    isRecruitingAutomatic: true, recruitsLeft: 0, minCarrierPercent: DEFAULT_MIN_CARRIER_PERCENT, maxCrewPercent: DEFAULT_MAX_CREW_PERCENT,
    stats: { buildingsBuilt: 0, soldiersRecruited: 0, soldiersLost: 0, towersTaken: 0, planksMade: 0, breadBaked: 0, largestTerritory: 0 }
  };
}

export interface CreateWorldOptions {
  seed?: number;
  width?: number;
  height?: number;
  /** 1: sandbox. 2: a match against a computer player on a mirrored map. */
  playerCount?: 1 | 2;
  botType?: BotType;
}

export const STARTING_STOCK: Partial<GoodAmounts> = {
  log: 8, plank: 40, stone: 40, axe: 5, saw: 3, pick: 5, scythe: 4, rod: 2, hammer: 3, shovel: 2, bread: 4, fish: 4
};
export const STARTING_SETTLERS: Partial<Record<SettlerType, number>> = {
  carrier: 20, digger: 3, builder: 4, swordsman: 3, spearman: 1, bowman: 2
};

/** Creates a seeded map: a sandbox for one player, or a mirrored two-player match. */
export function createWorld({ seed = 1, width, height, playerCount = 1, botType = 'aggressive' }: CreateWorldOptions = {}): World {
  const w = width ?? (playerCount === 2 ? 144 : 96);
  const h = height ?? 96;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('seed must be a uint32');
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 48 || h < 48 || w > 512 || h > 512) {
    throw new RangeError('map size must be between 48 and 512 tiles');
  }
  const n = w * h;
  const players = Array.from({ length: playerCount }, (_, k) => defaultPlayer(k, k > 0, botType));
  const world: World = {
    seed, tick: 0, width: w, height: h,
    terrain: new Uint8Array(n), tree: new Int16Array(n).fill(NO_TREE), field: new Int16Array(n).fill(NO_FIELD),
    rock: new Uint8Array(n), deposit: new Uint8Array(n), depositAmount: new Uint8Array(n),
    footprint: new Int32Array(n), door: new Int32Array(n), territory: new Uint8Array(n),
    claim: new Int32Array(n), vision: players.map(() => new Uint8Array(n)), prospect: players.map(() => new Uint8Array(n)),
    pioneerLand: new Uint8Array(n), militaryLand: new Uint8Array(n), players, buildings: [], settlers: [], messages: [],
    nextId: 1, randomState: seed >>> 0, mapVersion: 0, territoryVersion: 0, winner: null
  };
  generateTerrain(world);
  const start = playerCount === 2
    ? findCastleSpot(world, Math.floor(w * 0.18), Math.floor(w / 2) - 24)
    : findCastleSpot(world, Math.floor(w * 0.35), w - 12);
  prepareStart(world, start.x, start.y);
  if (playerCount === 2) mirrorLeftHalf(world);
  placeCastle(world, 0, start.x, start.y);
  if (playerCount === 2) placeCastle(world, 1, w - start.x - BUILDING_TYPES.castle.size, start.y);
  recomputeTerritory(world);
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
  const ore = valueNoise(seed ^ 0x2545f491, width, height, 5);
  const random = createRandom(seed ^ 0x27d4eb2f);
  for (let i = 0; i < width * height; i++) {
    const elevation = coarse[i] * 0.7 + fine[i] * 0.3;
    if (elevation < 0.27) world.terrain[i] = TERRAIN_WATER;
    else if (elevation > 0.74) world.terrain[i] = TERRAIN_MOUNTAIN;
  }
  for (let i = 0; i < width * height; i++) {
    const r = random.next();
    if (world.terrain[i] === TERRAIN_MOUNTAIN) {
      if (r < 0.25) world.rock[i] = ROCK_STONE;
      // Gold is the rarest ore, found where the ore is richest.
      else if (ore[i] > 0.4) setDeposit(world, i, ore[i] > 0.78 ? DEPOSIT_GOLD : ore[i] > 0.62 ? DEPOSIT_IRON : DEPOSIT_COAL);
    }
    else if (world.terrain[i] === TERRAIN_GRASS && forest[i] > 0.58 && r < 0.6) world.tree[i] = TREE_MATURE;
    else if (world.terrain[i] === TERRAIN_GRASS && r < 0.012) world.rock[i] = ROCK_STONE;
  }
}

function setDeposit(world: World, i: number, deposit: number): void {
  world.deposit[i] = deposit;
  world.depositAmount[i] = deposit === DEPOSIT_NONE ? 0 : DEPOSIT_AMOUNT;
}

function findCastleSpot(world: World, targetX: number, maxX: number): { x: number; y: number } {
  const cy = Math.floor(world.height * 0.5);
  let best = { x: targetX, y: cy };
  let bestScore = -Infinity;
  for (let y = 12; y < world.height - 16; y++) {
    for (let x = 12; x < maxX; x++) {
      let grass = 0;
      for (let dy = -6; dy <= 9; dy++) {
        for (let dx = -6; dx <= 9; dx++) {
          if (world.terrain[tileIndex(world, x + dx, y + dy)] === TERRAIN_GRASS) grass++;
        }
      }
      const score = grass - Math.hypot(x - targetX, y - cy) * 2;
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
  }
  return best;
}

/**
 * Clears room around the castle and guarantees the same start everywhere: a grove, a rock cluster and a
 * pond inside the territory, and a mountain with coal and iron just outside it, so expansion matters.
 */
function prepareStart(world: World, x: number, y: number): void {
  const size = BUILDING_TYPES.castle.size;
  const radius = BUILDING_TYPES.castle.territoryRadius;
  const centreX = x + size / 2, centreY = y + size / 2;
  const random = createRandom(world.seed ^ 0x165667b1);
  const at = (a: number, d: number) => ({ x: centreX + Math.cos(a) * d, y: centreY + Math.sin(a) * d });
  // The ore mountain straddles the starting border, so mines fit on the player's own land from the start.
  const layout = (a: number) => ({
    grove: at(a, 11), quarry: at(a + Math.PI, 11), pond: at(a + Math.PI / 2, 10), mountain: at(a - Math.PI / 2, radius - 1)
  });
  // Every guaranteed resource must lie on the map and on this player's half, so mirroring keeps it.
  const fits = (p: { x: number; y: number }, r: number) => p.x - r >= 1 && p.y - r >= 1 && p.y + r <= world.height - 2
    && p.x + r <= (world.players.length > 1 ? world.width / 2 - 2 : world.width - 2);
  const first = random.next() * Math.PI * 2;
  let angle = first;
  for (let k = 0; k < 16; k++) {
    const a = first + (k * Math.PI) / 8, l = layout(a);
    if (fits(l.mountain, 5) && fits(l.grove, 4) && fits(l.quarry, 3) && fits(l.pond, 3)) { angle = a; break; }
  }
  const { grove, quarry, pond, mountain } = layout(angle);
  const forEachNear = (p: { x: number; y: number }, r: number, fn: (i: number, d: number) => void) => {
    for (let ty = Math.floor(p.y - r); ty <= Math.ceil(p.y + r); ty++) {
      for (let tx = Math.floor(p.x - r); tx <= Math.ceil(p.x + r); tx++) {
        if (!inBounds(world, tx, ty)) continue;
        const d = Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y);
        if (d <= r) fn(tileIndex(world, tx, ty), d);
      }
    }
  };
  // Iron in the middle, coal around it, and a little gold at the far edge.
  forEachNear(mountain, 5, (i, d) => {
    world.terrain[i] = TERRAIN_MOUNTAIN; world.tree[i] = NO_TREE; world.rock[i] = 0;
    const isFarSide = Math.hypot((i % world.width) + 0.5 - centreX, Math.floor(i / world.width) + 0.5 - centreY) > radius + 2;
    setDeposit(world, i, d < 2.2 ? DEPOSIT_IRON : d > 3.8 && isFarSide ? DEPOSIT_GOLD : DEPOSIT_COAL);
  });
  forEachNear(pond, 2.4, (i) => { world.terrain[i] = TERRAIN_WATER; world.tree[i] = NO_TREE; world.rock[i] = 0; setDeposit(world, i, DEPOSIT_NONE); });
  forEachNear(grove, 4, (i) => { if (world.terrain[i] === TERRAIN_GRASS && random.next() < 0.7) { world.tree[i] = TREE_MATURE; world.rock[i] = 0; } });
  forEachNear(quarry, 2.5, (i) => { if (world.terrain[i] === TERRAIN_GRASS && random.next() < 0.7) { world.rock[i] = ROCK_STONE; world.tree[i] = NO_TREE; } });
  for (let ty = y - 5; ty < y + size + 6; ty++) {
    for (let tx = x - 5; tx < x + size + 6; tx++) {
      if (!inBounds(world, tx, ty)) continue;
      const i = tileIndex(world, tx, ty);
      world.terrain[i] = TERRAIN_GRASS; world.tree[i] = NO_TREE; world.rock[i] = 0; setDeposit(world, i, DEPOSIT_NONE);
    }
  }
}

/** Copies the left half onto the right, mirrored, so both players start with exactly the same land. */
function mirrorLeftHalf(world: World): void {
  const { width, height } = world;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < Math.floor(width / 2); x++) {
      const from = tileIndex(world, x, y), to = tileIndex(world, width - 1 - x, y);
      world.terrain[to] = world.terrain[from]; world.tree[to] = world.tree[from]; world.rock[to] = world.rock[from];
      world.deposit[to] = world.deposit[from]; world.depositAmount[to] = world.depositAmount[from];
    }
  }
}

function placeCastle(world: World, owner: number, x: number, y: number): void {
  const castle = newBuilding(world, 'castle', owner, x, y);
  castle.isComplete = true;
  castle.levelProgress = 1;
  castle.buildProgress = 1;
  for (const good of GOOD_TYPES) castle.stock[good] = STARTING_STOCK[good] ?? 0;
  for (const [type, count] of Object.entries(STARTING_SETTLERS) as [SettlerType, number][]) {
    for (let i = 0; i < count; i++) {
      const s = newSettler(world, owner, type, castle.doorX, castle.doorY);
      if (isSoldierType(type) && castle.garrison.length < castle.garrisonWanted) {
        castle.garrison.push(s.id);
        s.phase = 'inside'; s.homeId = castle.id;
      } else if (isSoldierType(type)) {
        // The rest of the soldiers wait outside, free to be sent to towers or into battle.
        s.isInside = false;
      }
    }
  }
}
