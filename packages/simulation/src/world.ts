import type { BotDifficultyType, BotType } from './bot.ts';
import { stockFish } from './land.ts';
import {
  BUILDING_TYPES, DEPOSIT_COAL, DEPOSIT_GEMS, buildingCost, DEPOSIT_GOLD, DEPOSIT_IRON, DEPOSIT_NONE, DEPOSIT_SULFUR, GOOD_TYPES, SOLDIER_STATS, THIEF_HEALTH, TOOL_TYPES, WEAPON_TYPES,
  WAR_MACHINE_STATS, SHIP_HEALTH, STARTING_GOODS_SETTINGS, consumersOf, distributedGoods, emptyGoods, isShipType, isSoldierType, isWarMachineType
} from './definitions.ts';
import type { BuildingTypeId, GoodAmounts, GoodType, MapLayoutType, RaceType, SettlerType, ShipType, SoldierType, StartingGoodsType, TradeModeType, VictoryType } from './definitions.ts';
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
  /** The diggers levelling the site and the builders putting it up: a crew of several, as in The Settlers III. */
  diggerIds: number[];
  builderIds: number[];
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
  /** Battering from war machines; the building falls when this reaches its structure (BUILDING_STRUCTURE). */
  damage: number;
  /** Ticks to the next priest (large temple). */
  timer: number;
  /** Mines under a Blight spell produce half as much until this tick; 0 otherwise. */
  blightUntil: number;
  /** Marketplaces only: where caravans go, and how goods are collected for them. */
  tradeRoute: TradeRoute | null;
  tradeMode: TradeModeType;
  /** Shipyards only: ships still ordered, and the one being built. */
  shipOrders: Partial<Record<ShipType, number>>;
  shipInProgress: ShipType | null;
}

/** A marketplace's land route: its end, up to 3 tiles to pass on the way, and how much of each good to send. */
export interface TradeRoute {
  x: number;
  y: number;
  /** Tile indices, in order. */
  waypoints: number[];
  /** Amount still to send per good; TRADE_UNLIMITED for as much as there is. */
  goods: Partial<Record<GoodType, number>>;
}

export type SettlerPhase =
  | 'idle' | 'toPickup' | 'toDrop' | 'toStore' | 'toSite' | 'leveling' | 'building'
  | 'toTool' | 'toWork' | 'inside' | 'toTarget' | 'working' | 'returning'
  | 'toRecruit' | 'toGarrison' | 'defending' | 'moving' | 'attacking'
  | 'prospecting' | 'claiming' | 'stealing'
  /** Waiting inside a building to come out, one after another, and walk to its spot (`targetTile`). */
  | 'leaving';

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
  /** While attacking the tower that covers another: the covered one, attacked again once the cover falls. */
  attackAfterId: number | null;
  /** Specialists only: the tile they were sent to work around, or -1. Patrolling soldiers: where the patrol started. */
  workCentre: number;
  /** Soldiers only: tiles still to walk to after the current path, in order. */
  waypoints: number[];
  /** Soldiers only: walking between workCentre and targetTile until given another order. */
  isPatrolling: boolean;
  /** Soldiers only: stay put and fight only what comes into reach. */
  isHolding: boolean;
  /** Soldiers only: walk on without stopping to fight until they arrive. */
  isIgnoringEnemies: boolean;
  /** War machines only: shots left before going back to the hall to reload. */
  ammo: number;
  /** Soldiers only: 0 private, 1 sergeant, 2 captain. */
  rank: number;
  /** Spells on this settler last until these ticks; 0 when none. */
  shieldUntil: number;
  furyUntil: number;
  frozenUntil: number;
  /** Donkeys and trade ships: how many of the carried good they have aboard. */
  cargo: number;
  /** Passengers only: the transport ship they are aboard. */
  shipId: number | null;
}

export interface PlayerStats {
  buildingsBuilt: number;
  soldiersRecruited: number;
  soldiersLost: number;
  towersTaken: number;
  planksMade: number;
  breadBaked: number;
  /** Goods the player's workshops and mines made over the match, per good: the economic mode's progress. */
  goodsMade: Partial<GoodAmounts>;
  largestTerritory: number;
  /** A snapshot every STATS_SAMPLE_TICKS, oldest first, for the statistics graphs. */
  history: StatsSample[];
}

/** How often a player's statistics are sampled for the graphs: once a minute of game time. */
export const STATS_SAMPLE_TICKS = 600;

/** One sample of a player's economy: goods made so far (running totals) and what the player had at that moment. */
export interface StatsSample {
  tick: number;
  goodsMade: Partial<GoodAmounts>;
  land: number;
  settlers: number;
  soldiers: number;
  buildings: number;
}

export interface PlayerState {
  id: number;
  /** Players on the same team are allies: they never fight each other, share what they see, and win together. */
  teamId: number;
  isBot: boolean;
  /** How this player's built-in bot plays; unused for human players. */
  botType: BotType;
  /** How well this player's built-in bot plays; unused for human players. */
  difficultyType: BotDifficultyType;
  /** The player's people: their building costs and the buildings only they have. */
  raceType: RaceType;
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
  /** Gathered at small temples; pays for spells and promotions. */
  manna: number;
  /** The rank (0 private, 1 sergeant, 2 captain) new soldiers of each type are recruited at. */
  soldierRanks: Record<SoldierType, number>;
  stats: PlayerStats;
}

/** A spot a Far sight spell shows to its caster until the given tick. */
export interface FarSight {
  playerId: number;
  x: number;
  y: number;
  until: number;
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
  /** Fish in each water tile (land.ts): some waters hold many, some none; fishing takes them, they come back slowly. */
  fish: Uint8Array;
  /** Owner + 1 of land claimed by military buildings alone; worked out with the territory, not saved. */
  militaryLand: Uint8Array;
  players: PlayerState[];
  buildings: Building[];
  settlers: Settler[];
  messages: GameMessage[];
  farSights: FarSight[];
  nextId: number;
  randomState: number;
  /** Bumped when trees, fields, rocks or buildings change, so renderers can redraw. */
  mapVersion: number;
  territoryVersion: number;
  winner: number | null;
  /** Continent or islands; islands need ships to reach the other players. */
  mapLayout: MapLayoutType;
  /** Whether the right half of a match map mirrors the left, so both players start on the same land. */
  isMirrored: boolean;
  startingGoodsType: StartingGoodsType;
  victoryType: VictoryType;
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

/** Whether two players fight each other: different players on different teams. */
export function isEnemy(world: World, a: number, b: number): boolean {
  if (a === b) return false;
  const pa = world.players[a], pb = world.players[b];
  return !pa || !pb || pa.teamId !== pb.teamId;
}

/** Whether a player is on the winning team of a finished match. */
export function isWinner(world: World, playerId: number): boolean {
  return world.winner !== null && !isEnemy(world, world.winner, playerId);
}

/** Ends the match once every player still in it is on one team; `winner` is that team's first player. */
export function settleWinner(world: World): void {
  if (world.players.length < 2 || world.winner !== null) return;
  const alive = world.players.filter((p) => !p.isEliminated);
  if (alive.length > 0 && alive.every((p) => p.teamId === alive[0].teamId)) world.winner = alive[0].id;
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

/** What this building costs its owner, whose race sets the price. */
export function siteCost(world: World, b: Building): Partial<GoodAmounts> {
  return buildingCost(b.typeId, playerOf(world, b.owner)?.raceType ?? 'romans');
}

export function isStorageBuilding(b: Building): boolean {
  return b.isComplete && BUILDING_TYPES[b.typeId].storageCapacity > 0;
}

export function isMilitaryBuilding(b: Building): boolean {
  return BUILDING_TYPES[b.typeId].garrisonCapacity > 0;
}

/**
 * Whether carriers may take goods from this building: storage, and finished goods waiting at a workplace.
 * Goods are moved only where they are needed, or to a storage area, so a workplace's goods can stay there.
 */
export function isSupplyBuilding(b: Building): boolean {
  return b.isComplete && (!isMilitaryBuilding(b) || isStorageBuilding(b));
}

/** How many of a good a player holds where carriers can fetch it: storage and workplaces' finished goods. */
export function heldGood(world: World, owner: number, good: GoodType): number {
  let total = 0;
  for (const b of world.buildings) if (b.owner === owner && isSupplyBuilding(b)) total += b.stock[good];
  return total;
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
    levelProgress: 0, buildProgress: 0, diggerIds: [], builderIds: [], workerId: null,
    garrison: [], garrisonWanted: typeId === 'castle' ? 3 : Math.min(1, type.garrisonCapacity), isOccupied: false, meals: 0,
    isPaused: false, isPriority: false, workX: null, workY: null, residentsLeft: 0,
    blockedReason: null, blockedSince: null, hasWarned: false, damage: 0, timer: 0, blightUntil: 0,
    tradeRoute: null, tradeMode: 'surplus', shipOrders: {}, shipInProgress: null
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
    health: isSoldierType(settlerType) ? SOLDIER_STATS[settlerType].health : isWarMachineType(settlerType) ? WAR_MACHINE_STATS[settlerType].health
      : isShipType(settlerType) ? SHIP_HEALTH
      : settlerType === 'thief' ? THIEF_HEALTH : 0,
    cooldown: 0, enemyId: null, attackId: null, attackAfterId: null,
    workCentre: -1, waypoints: [], isPatrolling: false, isHolding: false, isIgnoringEnemies: false,
    ammo: isWarMachineType(settlerType) ? WAR_MACHINE_STATS[settlerType].shots : 0,
    rank: 0, shieldUntil: 0, furyUntil: 0, frozenUntil: 0, cargo: 0, shipId: null
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
export const DEFAULT_MAX_CREW_PERCENT = 35;

export function defaultPlayer(id: number, isBot: boolean, botType: BotType = 'aggressive', raceType: RaceType = 'romans', teamId = id,
  difficultyType: BotDifficultyType = 'normal'): PlayerState {
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
    teamId,
    id, isBot, botType, difficultyType, raceType, isEliminated: false,
    transportPriority: ['plank', 'stone', 'log', ...TOOL_TYPES, ...WEAPON_TYPES, 'coal', 'iron_ore', 'iron', 'gold_ore', 'gold',
      'water', 'grain', 'flour', 'bread', 'fish', 'pig', 'meat', 'rice', 'honey', 'sulfur', 'gems', 'gunpowder',
      'wine', 'beer', 'rice_wine', 'mead'],
    isStored, productionOrders: {}, productionShares, productionCredit: {}, distribution, distributionCount: {},
    isRecruitingAutomatic: true, recruitsLeft: 0, minCarrierPercent: DEFAULT_MIN_CARRIER_PERCENT, maxCrewPercent: DEFAULT_MAX_CREW_PERCENT,
    manna: 0, soldierRanks: { swordsman: 0, spearman: 0, bowman: 0 },
    stats: { buildingsBuilt: 0, soldiersRecruited: 0, soldiersLost: 0, towersTaken: 0, planksMade: 0, breadBaked: 0, largestTerritory: 0, goodsMade: {}, history: [] }
  };
}

export interface CreateWorldOptions {
  seed?: number;
  width?: number;
  height?: number;
  /** 1: sandbox. 2 to 8: a match; two players may play on a mirrored map. */
  playerCount?: number;
  /** Each player's team, in player order; everyone on their own team when not given. */
  teamIds?: readonly number[];
  botType?: BotType;
  difficultyType?: BotDifficultyType;
  /** The people of each player, in player order; Romans when not given. */
  raceTypes?: readonly RaceType[];
  mapLayout?: MapLayoutType;
  /** Matches only: mirror the left half onto the right (the default), or generate both halves on their own. */
  isMirrored?: boolean;
  startingGoodsType?: StartingGoodsType;
  victoryType?: VictoryType;
}

export const STARTING_STOCK: Partial<GoodAmounts> = {
  log: 8, plank: 40, stone: 40, axe: 5, saw: 3, pick: 5, scythe: 4, rod: 2, hammer: 3, shovel: 2, bread: 4, fish: 4
};
/** Share of planks in each people's buildings (the rest is stone), from the manual: Romans 44:56, Egyptians 31:69, Asians 75:25, Amazons 59:41. Romans start even. */
const RACE_PLANK_SHARE: Record<RaceType, number> = { romans: 0.5, egyptians: 0.31, asians: 0.75, amazons: 0.59 };

export const STARTING_SETTLERS: Partial<Record<SettlerType, number>> = {
  carrier: 20, digger: 3, builder: 4, swordsman: 3, spearman: 1, bowman: 2
};

/** Creates a seeded map: a sandbox for one player, or a match for 2 to 8, two of them on a mirrored map if wanted. */
export function createWorld({
  seed = 1, width, height, playerCount = 1, teamIds = [], botType = 'aggressive', raceTypes = [], mapLayout = 'continent', isMirrored = true,
  startingGoodsType = 'default', victoryType = 'conquest', difficultyType = 'normal'
}: CreateWorldOptions = {}): World {
  if (!Number.isInteger(playerCount) || playerCount < 1 || playerCount > 8) throw new RangeError('a map holds 1 to 8 players');
  const w = width ?? (playerCount >= 2 ? 144 : 96);
  const h = height ?? 96;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('seed must be a uint32');
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 48 || h < 48 || w > 512 || h > 512) {
    throw new RangeError('map size must be between 48 and 512 tiles');
  }
  const n = w * h;
  const players = Array.from({ length: playerCount }, (_, k) => defaultPlayer(k, k > 0, botType, raceTypes[k] ?? 'romans', teamIds[k] ?? k, difficultyType));
  const world: World = {
    seed, tick: 0, width: w, height: h,
    terrain: new Uint8Array(n), tree: new Int16Array(n).fill(NO_TREE), field: new Int16Array(n).fill(NO_FIELD),
    rock: new Uint8Array(n), deposit: new Uint8Array(n), depositAmount: new Uint8Array(n),
    footprint: new Int32Array(n), door: new Int32Array(n), territory: new Uint8Array(n),
    claim: new Int32Array(n), vision: players.map(() => new Uint8Array(n)), prospect: players.map(() => new Uint8Array(n)),
    pioneerLand: new Uint8Array(n), militaryLand: new Uint8Array(n), fish: new Uint8Array(n), players, buildings: [], settlers: [], messages: [], farSights: [],
    nextId: 1, randomState: seed >>> 0, mapVersion: 0, territoryVersion: 0, winner: null, mapLayout,
    isMirrored: playerCount === 2 && isMirrored, startingGoodsType, victoryType: playerCount >= 2 ? victoryType : 'conquest'
  };
  generateTerrain(world);
  const size = BUILDING_TYPES.castle.size;
  if (playerCount > 2) {
    placeRingStarts(world, mapLayout);
    recomputeTerritory(world);
    world.fish = stockFish(world);
    return world;
  }
  const start = playerCount === 2
    ? findCastleSpot(world, Math.floor(w * 0.18), 12, Math.floor(w / 2) - 24)
    : findCastleSpot(world, Math.floor(w * 0.35), 12, w - 12);
  // The second start: mirrored, or the best spot on the right half's own land.
  const second = playerCount !== 2 ? null : world.isMirrored ? { x: w - start.x - size, y: start.y }
    : findCastleSpot(world, w - Math.floor(w * 0.18) - size, Math.floor(w / 2) + 24, w - 12 - size);
  if (mapLayout === 'islands') carveIslands(world, [start, ...(second ? [second] : [])].map((p) => ({ x: p.x + size / 2, y: p.y + size / 2 })));
  const half = Math.floor(w / 2);
  prepareStart(world, start.x, start.y, { minX: 0, maxX: playerCount === 2 ? half : w, minY: 0, maxY: h });
  if (second && world.isMirrored) mirrorLeftHalf(world);
  else if (second) prepareStart(world, second.x, second.y, { minX: half, maxX: w, minY: 0, maxY: h }, 1);
  placeCastle(world, 0, start.x, start.y);
  if (second) placeCastle(world, 1, second.x, second.y);
  recomputeTerritory(world);
  world.fish = stockFish(world);
  return world;
}

export function valueNoise(seed: number, width: number, height: number, cell: number): Float32Array {
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
      else if (ore[i] > 0.47) {
        // Some richer veins hold gems or sulfur instead, for the peoples who mine them.
        const vein = random.next();
        setDeposit(world, i, ore[i] > 0.78 ? (vein < 0.4 ? DEPOSIT_GEMS : DEPOSIT_GOLD) : ore[i] > 0.62 ? (vein < 0.3 ? DEPOSIT_SULFUR : DEPOSIT_IRON) : DEPOSIT_COAL);
      }
    }
    else if (world.terrain[i] === TERRAIN_GRASS && forest[i] > 0.58 && r < 0.6) world.tree[i] = TREE_MATURE;
    else if (world.terrain[i] === TERRAIN_GRASS && r < 0.012) world.rock[i] = ROCK_STONE;
  }
}

/** Island radius around each start, in tiles: the castle's land plus room for the first towers, smaller on small maps. */
export function islandRadius(width: number): number {
  return Math.min(27, Math.floor(width * 0.19));
}

/**
 * Turns the map into sea except each start's island and a neutral island in the middle, with a ragged coast.
 */
function carveIslands(world: World, starts: readonly { x: number; y: number }[], radius = islandRadius(world.width)): void {
  const { width, height } = world;
  const coast = valueNoise(world.seed ^ 0x51ed270b, width, height, 7);
  const midX = width / 2, midY = height / 2;
  // The neutral island keeps a channel of sea to every start's island, the coast's wobble included; too small, it is left out.
  const toMiddle = Math.min(...starts.map((c) => Math.hypot(c.x - midX, c.y - midY)));
  const middle = Math.min(10, width / 10, toMiddle - radius - 8);
  const hasMiddle = middle >= 4;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = tileIndex(world, x, y);
      const wobble = (coast[i] - 0.5) * 8;
      // Each start's island; with one start given, its mirror image on the right too.
      const centres = starts.length === 1 ? [starts[0], { x: width - starts[0].x, y: starts[0].y }] : starts;
      const isStart = centres.some((c) => Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) <= radius + wobble);
      const isMiddle = hasMiddle && Math.hypot(x + 0.5 - midX, y + 0.5 - midY) <= middle + wobble * 0.6;
      if (isStart) continue;
      if (isMiddle) {
        // The neutral island: a rich mountain worth sailing for.
        if (Math.hypot(x + 0.5 - midX, y + 0.5 - midY) <= middle * 0.55) {
          world.terrain[i] = TERRAIN_MOUNTAIN; world.tree[i] = NO_TREE; world.rock[i] = 0;
          setDeposit(world, i, (x + y) % 3 === 0 ? DEPOSIT_GOLD : DEPOSIT_IRON);
        } else if (world.terrain[i] === TERRAIN_WATER) world.terrain[i] = TERRAIN_GRASS;
        continue;
      }
      world.terrain[i] = TERRAIN_WATER; world.tree[i] = NO_TREE; world.rock[i] = 0; setDeposit(world, i, DEPOSIT_NONE);
    }
  }
}

/** The part of the map a start's guaranteed resources must lie in, so they stay that player's. */
interface StartArea { minX: number; maxX: number; minY: number; maxY: number }

/**
 * Three to eight players: castles on a ring around the middle, player 0 on the left and the rest in order around it,
 * each on the grassiest spot near its place. Each start gets the same prepared surroundings inside its own area.
 */
function placeRingStarts(world: World, mapLayout: MapLayoutType): void {
  const { width: w, height: h } = world;
  const count = world.players.length;
  const size = BUILDING_TYPES.castle.size;
  // The ring places are 36 to 50 tiles apart on the largest player count of each map size; a start keeps near its
  // place and twice a castle's reach from the others, so no two castles' land overlaps.
  const reach = 6, gapMin = 2 * BUILDING_TYPES.castle.territoryRadius + 2;
  const starts: { x: number; y: number }[] = [];
  for (let k = 0; k < count; k++) {
    const angle = Math.PI + (2 * Math.PI * k) / count;
    const tx = Math.round(w / 2 + Math.cos(angle) * w * 0.35 - size / 2), ty = Math.round(h / 2 + Math.sin(angle) * h * 0.33 - size / 2);
    starts.push(findCastleSpotNear(world, tx, ty, reach, (x, y) => starts.every((o) => Math.hypot(o.x - x, o.y - y) >= gapMin)));
  }
  // Each start's area reaches halfway to its nearest neighbour.
  const gap = (k: number) => Math.min(...starts.filter((_, j) => j !== k).map((o) => Math.hypot(o.x - starts[k].x, o.y - starts[k].y)));
  const areas = starts.map((p, k) => {
    const half = gap(k) / 2;
    return { minX: Math.max(0, Math.floor(p.x + size / 2 - half)), maxX: Math.min(w, Math.ceil(p.x + size / 2 + half)),
      minY: Math.max(0, Math.floor(p.y + size / 2 - half)), maxY: Math.min(h, Math.ceil(p.y + size / 2 + half)) };
  });
  if (mapLayout === 'islands') {
    // Islands stay apart from each other and from the neutral one in the middle, the coast's wobble included.
    const centres = starts.map((p) => ({ x: p.x + size / 2, y: p.y + size / 2 }));
    const radius = Math.floor(Math.min(islandRadius(w), Math.min(...starts.map((_, k) => gap(k))) / 2 - 5));
    carveIslands(world, centres, radius);
  }
  starts.forEach((p, k) => prepareStart(world, p.x, p.y, areas[k], k));
  starts.forEach((p, k) => placeCastle(world, k, p.x, p.y));
}

/** The grassiest castle spot within `reach` of a place, nearer places breaking ties. */
function findCastleSpotNear(world: World, tx: number, ty: number, reach: number, isAllowed: (x: number, y: number) => boolean): { x: number; y: number } {
  let best = { x: tx, y: ty }, bestScore = -Infinity;
  for (let y = Math.max(12, ty - reach); y <= Math.min(world.height - 16, ty + reach); y++) {
    for (let x = Math.max(12, tx - reach); x <= Math.min(world.width - 16, tx + reach); x++) {
      if (!isAllowed(x, y)) continue;
      let grass = 0;
      for (let dy = -6; dy <= 9; dy++) {
        for (let dx = -6; dx <= 9; dx++) if (world.terrain[tileIndex(world, x + dx, y + dy)] === TERRAIN_GRASS) grass++;
      }
      const score = grass - Math.hypot(x - tx, y - ty) * 2;
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
  }
  return best;
}

function setDeposit(world: World, i: number, deposit: number): void {
  world.deposit[i] = deposit;
  world.depositAmount[i] = deposit === DEPOSIT_NONE ? 0 : DEPOSIT_AMOUNT;
}

function findCastleSpot(world: World, targetX: number, minX: number, maxX: number): { x: number; y: number } {
  const cy = Math.floor(world.height * 0.5);
  let best = { x: targetX, y: cy };
  let bestScore = -Infinity;
  for (let y = 12; y < world.height - 16; y++) {
    for (let x = minX; x < maxX; x++) {
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
function prepareStart(world: World, x: number, y: number, area: StartArea, variant = 0): void {
  const { minX, maxX, minY, maxY } = area;
  const size = BUILDING_TYPES.castle.size;
  const radius = BUILDING_TYPES.castle.territoryRadius;
  const centreX = x + size / 2, centreY = y + size / 2;
  const random = createRandom((world.seed ^ 0x165667b1) + variant * 0x9e3779b9);
  const at = (a: number, d: number) => ({ x: centreX + Math.cos(a) * d, y: centreY + Math.sin(a) * d });
  // The ore mountain straddles the starting border, so mines fit on the player's own land from the start.
  const layout = (a: number) => ({
    grove: at(a, 11), quarry: at(a + Math.PI, 11), pond: at(a + Math.PI / 2, 10), mountain: at(a - Math.PI / 2, radius - 1)
  });
  // Every guaranteed resource must lie on the map and on this player's half, so mirroring keeps it.
  const fits = (p: { x: number; y: number }, r: number) => p.x - r >= minX + 1 && p.y - r >= minY + 1 && p.y + r <= maxY - 2 && p.x + r <= maxX - 2;
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
    // A few tiles of gems and sulfur at the near edge, so every people finds what it mines.
    const tx = i % world.width;
    const edge = d > 3.8 ? (isFarSide ? DEPOSIT_GOLD : tx % 2 === 0 ? DEPOSIT_SULFUR : DEPOSIT_GEMS) : null;
    // As in the original, most of a mountain is bare: iron in the middle, coal on one side of it (the side toward
    // the castle), a little gold and gems at the edge, and plain rock elsewhere. The same at every start.
    const ox = (i % world.width) + 0.5 - mountain.x, oy = Math.floor(i / world.width) + 0.5 - mountain.y;
    const toCastle = Math.atan2(centreY - mountain.y, centreX - mountain.x);
    const off = Math.abs(((Math.atan2(oy, ox) - toCastle + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    const isBare = d >= 2.2 && (edge === null ? off > 1.9 : ((Math.imul(Math.floor(ox) + 31, 73856093) ^ Math.imul(Math.floor(oy) + 17, 19349663)) >>> 0) % 100 < 55);
    setDeposit(world, i, isBare ? DEPOSIT_NONE : d < 2.2 ? DEPOSIT_IRON : edge ?? DEPOSIT_COAL);
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
  // The match's starting goods scale the normal start; each kind keeps at least one.
  const factors = STARTING_GOODS_SETTINGS[world.startingGoodsType];
  const scaled = (n: number, factor: number) => (n === 0 ? 0 : Math.max(1, Math.round(n * factor)));
  for (const good of GOOD_TYPES) castle.stock[good] = scaled(STARTING_STOCK[good] ?? 0, (TOOL_TYPES as readonly string[]).includes(good) ? factors.tools : factors.goods);
  // Planks and stone follow the people's building needs, as in the manual's balance per race; the total stays the same.
  const race = playerOf(world, owner)?.raceType ?? 'romans';
  const total = scaled((STARTING_STOCK.plank ?? 0) + (STARTING_STOCK.stone ?? 0), factors.goods);
  castle.stock.plank = Math.round(total * RACE_PLANK_SHARE[race]);
  castle.stock.stone = total - castle.stock.plank;
  const leaving: Settler[] = [];
  for (const [type, base] of Object.entries(STARTING_SETTLERS) as [SettlerType, number][]) {
    const count = scaled(base, isSoldierType(type) ? factors.soldiers : factors.settlers);
    for (let i = 0; i < count; i++) {
      const s = newSettler(world, owner, type, castle.doorX, castle.doorY);
      if (isSoldierType(type) && castle.garrison.length < castle.garrisonWanted) {
        castle.garrison.push(s.id);
        s.phase = 'inside'; s.homeId = castle.id;
      } else leaving.push(s);
    }
  }
  // Everyone else comes out of the castle one after another and spreads evenly over its land: the soldiers free to
  // be sent to towers or into battle, the civilians ready for work. Mixed, so neither crowds one side.
  leaving.sort((a, b) => (a.id * 7919) % 101 - (b.id * 7919) % 101 || a.id - b.id);
  const spots = spreadSpots(world, castle, leaving.length);
  leaving.forEach((s, k) => {
    s.phase = 'leaving'; s.timer = 5 + k * LEAVE_GAP_TICKS; s.targetTile = spots[k % spots.length] ?? -1;
  });
}

/** Ticks between two settlers coming out of a building, so they leave one by one. */
export const LEAVE_GAP_TICKS = 5;

/**
 * Spots spread evenly over a building's surroundings, nearest first: a sunflower spiral from just outside the
 * building to `WAIT_RADIUS` tiles from its middle, each spot a free walkable tile out of every doorway.
 */
/**
 * Ground where goods lie in the open, which idle settlers keep off (they may walk across it): the castle's heaps in
 * front of it either side of the way in and along its right wall, and a construction site's materials along its right
 * edge. Matches where the client draws them.
 */
export function isGoodsYard(world: World, i: number): boolean {
  const x = i % world.width, y = Math.floor(i / world.width);
  for (const b of world.buildings) {
    const s = b.size;
    if (b.typeId === 'castle') {
      const inFront = y >= b.y + s && y <= b.y + s + 3 && x >= b.doorX - 4 && x <= b.doorX + 5 && Math.abs(x - b.doorX) > 1;
      const bySide = x >= b.x + s && x <= b.x + s + 3 && y >= b.y - 1 && y <= b.y + s + 1;
      if (inFront || bySide) return true;
    } else if (!b.isComplete && x === b.x + s && y >= b.y - 1 && y <= b.y + s) return true;
  }
  return false;
}

export function spreadSpots(world: World, b: Building, count: number): number[] {
  const cx = b.x + b.size / 2, cy = b.y + b.size / 2;
  const inner = b.size / 2 + 1.5, outer = WAIT_RADIUS - 0.5;
  const taken = new Set<number>();
  const spots: number[] = [];
  for (let k = 0; k < count; k++) {
    const r = inner + (outer - inner) * Math.sqrt((k + 0.5) / Math.max(1, count));
    const a = k * 2.399963;
    const tx = Math.round(cx - 0.5 + Math.cos(a) * r), ty = Math.round(cy - 0.5 + Math.sin(a) * r);
    // The nearest free tile to the spiral's point.
    let best = -1, bestDistance = Infinity;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = tx + dx, y = ty + dy;
        if (!inBounds(world, x, y)) continue;
        const i = tileIndex(world, x, y);
        if (taken.has(i) || world.door[i] !== 0 || !isWalkable(world, i) || isGoodsYard(world, i)) continue;
        const d = Math.hypot(dx, dy);
        if (d < bestDistance) { bestDistance = d; best = i; }
      }
    }
    if (best >= 0) { taken.add(best); spots.push(best); }
  }
  return spots;
}

/** How far from a storage area's middle idle settlers wait, in tiles. */
export const WAIT_RADIUS = 9;
