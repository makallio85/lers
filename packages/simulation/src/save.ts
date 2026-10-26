import {
  BUILDING_TYPES, GOOD_TYPES, MAX_TRADE_WAYPOINTS, RACE_TYPES, SHIP_TYPES, RANK_LABELS, SETTLER_LABELS, SOLDIER_TYPES, TOOL_TYPES, TRADE_MODE_TYPES, TRADE_UNLIMITED,
  WEAPON_TYPES, consumersOf
} from './definitions.ts';
import type { BuildingTypeId, GoodAmounts, GoodType, RaceType, ShipType, SoldierType, TradeModeType } from './definitions.ts';
import { FIELD_RIPE, TREE_MATURE, recomputeTerritory, tileIndex } from './world.ts';
import { BOT_TYPES } from './bot.ts';
import type { BotType } from './bot.ts';
import type { Building, FarSight, GameMessage, PlayerState, PlayerStats, Settler, SettlerPhase, TradeRoute, World } from './world.ts';

/** Bump when the saved shape changes; older saves are then refused with a clear message. */
export const SAVE_VERSION = 10;

function raceType(value: unknown): RaceType {
  if (typeof value !== 'string' || !(RACE_TYPES as readonly string[]).includes(value)) fail('a people is unknown');
  return value as RaceType;
}

function botType(value: unknown): BotType {
  if (typeof value !== 'string' || !(BOT_TYPES as readonly string[]).includes(value)) fail('a bot type is unknown');
  return value as BotType;
}

const PHASES: readonly SettlerPhase[] = [
  'idle', 'toPickup', 'toDrop', 'toStore', 'toSite', 'leveling', 'building',
  'toTool', 'toWork', 'inside', 'toTarget', 'working', 'returning',
  'toRecruit', 'toGarrison', 'defending', 'moving', 'attacking',
  'prospecting', 'claiming', 'stealing'
];
const MADE_GOODS: readonly string[] = [...TOOL_TYPES, ...WEAPON_TYPES];
const STAT_KEYS: readonly (keyof PlayerStats)[] = [
  'buildingsBuilt', 'soldiersRecruited', 'soldiersLost', 'towersTaken', 'planksMade', 'breadBaked', 'largestTerritory'
];

export class SaveError extends Error {}

/** A JSON-compatible snapshot of the whole match. */
export function saveGame(world: World): Record<string, unknown> {
  return {
    version: SAVE_VERSION,
    seed: world.seed, tick: world.tick, width: world.width, height: world.height,
    terrain: Array.from(world.terrain), tree: Array.from(world.tree), field: Array.from(world.field),
    rock: Array.from(world.rock), deposit: Array.from(world.deposit), depositAmount: Array.from(world.depositAmount),
    claim: Array.from(world.claim), vision: world.vision.map((v) => Array.from(v)),
    prospect: world.prospect.map((v) => Array.from(v)), pioneerLand: Array.from(world.pioneerLand),
    players: structuredClone(world.players),
    buildings: structuredClone(world.buildings),
    settlers: structuredClone(world.settlers),
    messages: structuredClone(world.messages),
    farSights: structuredClone(world.farSights),
    nextId: world.nextId, randomState: world.randomState, winner: world.winner, mapLayout: world.mapLayout
  };
}

function fail(what: string): never {
  throw new SaveError(`This save cannot be loaded: ${what}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tradeRoute(value: unknown, width: number, height: number): TradeRoute | null {
  if (value === null) return null;
  if (!isRecord(value) || !Array.isArray(value.waypoints) || value.waypoints.length > MAX_TRADE_WAYPOINTS || !isRecord(value.goods)) fail('a trade route is invalid');
  const goods: Partial<Record<GoodType, number>> = {};
  for (const [g, amount] of Object.entries(value.goods)) {
    if (!(GOOD_TYPES as readonly string[]).includes(g)) fail('a trade route has an unknown good');
    goods[g as GoodType] = int(amount, TRADE_UNLIMITED, 100_000, 'trade amount');
  }
  return {
    x: int(value.x, 0, width - 1, 'trade route end'), y: int(value.y, 0, height - 1, 'trade route end'),
    waypoints: value.waypoints.map((w: unknown) => int(w, 0, width * height - 1, 'trade waypoint')), goods
  };
}

function shipType(value: unknown): ShipType {
  if (typeof value !== 'string' || !(SHIP_TYPES as readonly string[]).includes(value)) fail('a ship type is unknown');
  return value as ShipType;
}

function shipOrders(value: unknown): Partial<Record<ShipType, number>> {
  if (!isRecord(value)) fail('ship orders are missing');
  const out: Partial<Record<ShipType, number>> = {};
  for (const [k, v] of Object.entries(value)) out[shipType(k)] = int(v, 0, 99, 'ship order');
  return out;
}

function tradeMode(value: unknown): TradeModeType {
  if (typeof value !== 'string' || !(TRADE_MODE_TYPES as readonly string[]).includes(value)) fail('a trade mode is unknown');
  return value as TradeModeType;
}

function ranks(value: unknown): Record<SoldierType, number> {
  if (!isRecord(value)) fail('soldier ranks are missing');
  const out = {} as Record<SoldierType, number>;
  for (const t of SOLDIER_TYPES) out[t] = int(value[t], 0, RANK_LABELS.length - 1, 'soldier rank');
  return out;
}

function int(value: unknown, min: number, max: number, what: string): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) fail(`${what} is out of range`);
  return value as number;
}

function num(value: unknown, min: number, max: number, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${what} is out of range`);
  return value;
}

function bool(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') fail(`${what} is not true or false`);
  return value;
}

function nullableInt(value: unknown, what: string): number | null {
  return value === null ? null : int(value, 0, Number.MAX_SAFE_INTEGER, what);
}

function text(value: unknown, what: string, maxLength = 200): string {
  if (typeof value !== 'string' || value.length > maxLength) fail(`${what} is not valid text`);
  return value;
}

function good(value: unknown, what: string): GoodType {
  if (typeof value !== 'string' || !(GOOD_TYPES as readonly string[]).includes(value)) fail(`${what} is not a known good`);
  return value as GoodType;
}

function nullableGood(value: unknown, what: string): GoodType | null {
  return value === null ? null : good(value, what);
}

function goods(value: unknown, what: string): GoodAmounts {
  if (!isRecord(value)) fail(`${what} is missing`);
  const out = {} as GoodAmounts;
  for (const g of GOOD_TYPES) out[g] = int(value[g], 0, 1_000_000, `${what}.${g}`);
  return out;
}

function intArray(value: unknown, length: number, min: number, max: number, what: string): number[] {
  if (!Array.isArray(value) || value.length !== length) fail(`${what} has the wrong size`);
  for (const v of value) if (!Number.isInteger(v) || v < min || v > max) fail(`${what} has an invalid value`);
  return value as number[];
}

/** A record keyed by goods (only `allowed` ones) with numbers checked by `check`. */
function goodRecord(value: unknown, allowed: readonly string[], check: (v: unknown, what: string) => number, what: string): Partial<Record<GoodType, number>> {
  if (!isRecord(value)) fail(`${what} is missing`);
  const out: Partial<Record<GoodType, number>> = {};
  for (const [key, v] of Object.entries(value)) {
    if (!allowed.includes(key)) fail(`${what} names an unknown good`);
    out[key as GoodType] = check(v, `${what}.${key}`);
  }
  return out;
}

function consumerRecords(value: unknown, max: number, what: string): Partial<Record<GoodType, Partial<Record<BuildingTypeId, number>>>> {
  if (!isRecord(value)) fail(`${what} is missing`);
  const out: Partial<Record<GoodType, Partial<Record<BuildingTypeId, number>>>> = {};
  for (const [key, inner] of Object.entries(value)) {
    const g = good(key, what);
    if (!isRecord(inner)) fail(`${what} is invalid`);
    const consumers = consumersOf(g);
    const shares: Partial<Record<BuildingTypeId, number>> = {};
    for (const [typeId, v] of Object.entries(inner)) {
      if (!(consumers as string[]).includes(typeId)) fail(`${what} names a building that does not use ${g}`);
      shares[typeId as BuildingTypeId] = int(v, 0, max, what);
    }
    out[g] = shares;
  }
  return out;
}

/** Validates an untrusted save completely before building a world from it. */
export function loadGame(data: unknown): World {
  if (!isRecord(data)) fail('it is not a Lers save');
  if (data.version !== SAVE_VERSION) fail(`it was made by another version (${String(data.version)})`);
  const width = int(data.width, 48, 512, 'map width');
  const height = int(data.height, 48, 512, 'map height');
  const n = width * height;
  const nextId = int(data.nextId, 1, Number.MAX_SAFE_INTEGER, 'next id');
  const id = (value: unknown, what: string) => int(value, 1, nextId - 1, what);

  if (!Array.isArray(data.players) || data.players.length < 1 || data.players.length > 8) fail('players are missing');
  const players: PlayerState[] = data.players.map((raw: unknown, k: number) => {
    if (!isRecord(raw)) fail('a player is invalid');
    const order = raw.transportPriority;
    if (!Array.isArray(order) || order.length !== GOOD_TYPES.length || new Set(order).size !== GOOD_TYPES.length) {
      fail('a transport priority list is invalid');
    }
    const isStored = {} as Record<GoodType, boolean>;
    if (!isRecord(raw.isStored)) fail('storage settings are missing');
    for (const g of GOOD_TYPES) isStored[g] = bool(raw.isStored[g], `storage setting for ${g}`);
    if (!isRecord(raw.stats)) fail('statistics are missing');
    const stats = {} as PlayerStats;
    for (const key of STAT_KEYS) stats[key] = int(raw.stats[key], 0, Number.MAX_SAFE_INTEGER, `statistic ${key}`);
    return {
      id: int(raw.id, k, k, 'player id'), isBot: bool(raw.isBot, 'player type'), botType: botType(raw.botType), raceType: raceType(raw.raceType), isEliminated: bool(raw.isEliminated, 'player state'),
      transportPriority: order.map((g) => good(g, 'priority entry')), isStored,
      productionOrders: goodRecord(raw.productionOrders, MADE_GOODS, (v, w) => int(v, 0, 99, w), 'production orders'),
      productionShares: goodRecord(raw.productionShares, MADE_GOODS, (v, w) => int(v, 0, 10, w), 'production shares'),
      productionCredit: goodRecord(raw.productionCredit, MADE_GOODS, (v, w) => num(v, -1e9, 1e9, w), 'production credit'),
      distribution: consumerRecords(raw.distribution, 10, 'distribution'),
      distributionCount: consumerRecords(raw.distributionCount, Number.MAX_SAFE_INTEGER, 'distribution count'),
      isRecruitingAutomatic: bool(raw.isRecruitingAutomatic, 'recruiting'), recruitsLeft: int(raw.recruitsLeft, 0, 99, 'recruits'),
      minCarrierPercent: int(raw.minCarrierPercent, 0, 100, 'carrier share'), maxCrewPercent: int(raw.maxCrewPercent, 0, 100, 'crew share'),
      manna: int(raw.manna, 0, 1_000_000, 'manna'),
      soldierRanks: ranks(raw.soldierRanks),
      stats
    };
  });
  const ownerMax = players.length - 1;

  if (!Array.isArray(data.buildings) || data.buildings.length > 10_000) fail('buildings are missing');
  const buildings: Building[] = data.buildings.map((raw: unknown) => {
    if (!isRecord(raw) || typeof raw.typeId !== 'string' || !Object.hasOwn(BUILDING_TYPES, raw.typeId)) fail('a building has an unknown type');
    const type = BUILDING_TYPES[raw.typeId as BuildingTypeId];
    const x = int(raw.x, 0, width - type.size, 'building position');
    const y = int(raw.y, 0, height - type.size - 1, 'building position');
    if (!Array.isArray(raw.garrison) || raw.garrison.length > type.garrisonCapacity) fail('a garrison is invalid');
    return {
      id: id(raw.id, 'building id'), typeId: type.id, owner: int(raw.owner, 0, ownerMax, 'building owner'), x, y, size: type.size,
      doorX: x + Math.floor(type.size / 2), doorY: y + type.size, isComplete: bool(raw.isComplete, 'building state'),
      stock: goods(raw.stock, 'stock'), input: goods(raw.input, 'input'), incoming: goods(raw.incoming, 'incoming'),
      reserved: goods(raw.reserved, 'reserved'), delivered: goods(raw.delivered, 'delivered'), built: goods(raw.built, 'built'),
      levelProgress: num(raw.levelProgress, 0, 1, 'levelling'), buildProgress: num(raw.buildProgress, 0, 1, 'building progress'),
      diggerId: nullableInt(raw.diggerId, 'digger'), builderId: nullableInt(raw.builderId, 'builder'),
      workerId: nullableInt(raw.workerId, 'worker'),
      garrison: raw.garrison.map((g: unknown) => id(g, 'garrison soldier')),
      garrisonWanted: int(raw.garrisonWanted, 0, type.garrisonCapacity, 'garrison size'),
      isOccupied: bool(raw.isOccupied, 'occupation'), meals: int(raw.meals, 0, 100, 'meals'),
      isPaused: bool(raw.isPaused, 'pause'), isPriority: bool(raw.isPriority, 'site priority'),
      workX: raw.workX === null ? null : int(raw.workX, 0, width - 1, 'work area'),
      workY: raw.workY === null ? null : int(raw.workY, 0, height - 1, 'work area'),
      residentsLeft: int(raw.residentsLeft, 0, 1000, 'residents'),
      blockedReason: raw.blockedReason === null ? null : text(raw.blockedReason, 'blocked reason'),
      blockedSince: nullableInt(raw.blockedSince, 'blocked time'), hasWarned: bool(raw.hasWarned, 'warning state'),
      damage: num(raw.damage, 0, 100_000, 'building damage'),
      timer: int(raw.timer, 0, 1_000_000, 'building timer'), blightUntil: int(raw.blightUntil, 0, Number.MAX_SAFE_INTEGER, 'blight'),
      tradeRoute: tradeRoute(raw.tradeRoute, width, height), tradeMode: tradeMode(raw.tradeMode),
      shipOrders: shipOrders(raw.shipOrders),
      shipInProgress: raw.shipInProgress === null ? null : shipType(raw.shipInProgress)
    };
  });

  if (!Array.isArray(data.settlers) || data.settlers.length > 100_000) fail('settlers are missing');
  const settlers: Settler[] = data.settlers.map((raw: unknown) => {
    if (!isRecord(raw)) fail('a settler is invalid');
    if (typeof raw.settlerType !== 'string' || !Object.hasOwn(SETTLER_LABELS, raw.settlerType)) fail('a settler has an unknown job');
    if (typeof raw.phase !== 'string' || !(PHASES as readonly string[]).includes(raw.phase)) fail('a settler has an unknown task');
    return {
      id: id(raw.id, 'settler id'), owner: int(raw.owner, 0, ownerMax, 'settler owner'),
      settlerType: raw.settlerType as Settler['settlerType'],
      x: num(raw.x, 0, width - 1, 'settler position'), y: num(raw.y, 0, height - 1, 'settler position'),
      prevX: num(raw.prevX, 0, width - 1, 'settler position'), prevY: num(raw.prevY, 0, height - 1, 'settler position'),
      path: intArray(raw.path, Array.isArray(raw.path) ? raw.path.length : -1, 0, n - 1, 'settler path'),
      phase: raw.phase as SettlerPhase, timer: int(raw.timer, 0, 1_000_000, 'settler timer'),
      carrying: nullableGood(raw.carrying, 'carried good'),
      fromId: nullableInt(raw.fromId, 'settler source'), toId: nullableInt(raw.toId, 'settler target'),
      good: nullableGood(raw.good, 'settler good'), homeId: nullableInt(raw.homeId, 'settler home'),
      targetTile: int(raw.targetTile, -1, n - 1, 'settler target tile'), isInside: bool(raw.isInside, 'settler inside'),
      health: num(raw.health, 0, 1000, 'health'), cooldown: int(raw.cooldown, 0, 1000, 'cooldown'),
      enemyId: nullableInt(raw.enemyId, 'enemy'), attackId: nullableInt(raw.attackId, 'attack target'),
      workCentre: int(raw.workCentre, -1, n - 1, 'specialist work area'),
      waypoints: intArray(raw.waypoints, Array.isArray(raw.waypoints) && raw.waypoints.length <= 20 ? raw.waypoints.length : -1, 0, n - 1, 'waypoints'),
      isPatrolling: bool(raw.isPatrolling, 'patrol'), isHolding: bool(raw.isHolding, 'hold position'),
      isIgnoringEnemies: bool(raw.isIgnoringEnemies, 'move without fighting'), ammo: int(raw.ammo, 0, 100, 'ammunition'),
      rank: int(raw.rank, 0, RANK_LABELS.length - 1, 'rank'),
      shieldUntil: int(raw.shieldUntil, 0, Number.MAX_SAFE_INTEGER, 'shield'), furyUntil: int(raw.furyUntil, 0, Number.MAX_SAFE_INTEGER, 'fury'),
      frozenUntil: int(raw.frozenUntil, 0, Number.MAX_SAFE_INTEGER, 'freeze'),
      cargo: int(raw.cargo, 0, 100, 'cargo'), shipId: nullableInt(raw.shipId, 'ship')
    };
  });

  if (!Array.isArray(data.messages) || data.messages.length > 100) fail('messages are missing');
  const messages: GameMessage[] = data.messages.map((raw: unknown) => {
    if (!isRecord(raw)) fail('a message is invalid');
    return {
      id: id(raw.id, 'message id'), owner: int(raw.owner, 0, ownerMax, 'message owner'),
      tick: int(raw.tick, 0, Number.MAX_SAFE_INTEGER, 'message time'),
      text: text(raw.text, 'message'), detail: text(raw.detail, 'message'), isWarning: bool(raw.isWarning, 'message type'),
      buildingId: nullableInt(raw.buildingId, 'message building')
    };
  });

  if (!Array.isArray(data.farSights) || data.farSights.length > 100) fail('far sight spells are missing');
  const farSights: FarSight[] = data.farSights.map((raw: unknown) => {
    if (!isRecord(raw)) fail('a far sight spell is invalid');
    return { playerId: int(raw.playerId, 0, ownerMax, 'far sight owner'), x: int(raw.x, 0, width - 1, 'far sight spot'), y: int(raw.y, 0, height - 1, 'far sight spot'),
      until: int(raw.until, 0, Number.MAX_SAFE_INTEGER, 'far sight time') };
  });
  if (!Array.isArray(data.vision) || data.vision.length !== players.length) fail('the fog of war is missing');
  if (!Array.isArray(data.prospect) || data.prospect.length !== players.length) fail('geologist signs are missing');
  const world: World = {
    seed: int(data.seed, 0, 0xffffffff, 'seed'), tick: int(data.tick, 0, Number.MAX_SAFE_INTEGER, 'game time'), width, height,
    terrain: Uint8Array.from(intArray(data.terrain, n, 0, 2, 'terrain')),
    tree: Int16Array.from(intArray(data.tree, n, -1, TREE_MATURE, 'trees')),
    field: Int16Array.from(intArray(data.field, n, -1, FIELD_RIPE, 'fields')),
    rock: Uint8Array.from(intArray(data.rock, n, 0, 255, 'rocks')),
    deposit: Uint8Array.from(intArray(data.deposit, n, 0, 5, 'deposits')),
    depositAmount: Uint8Array.from(intArray(data.depositAmount, n, 0, 255, 'deposit amounts')),
    claim: Int32Array.from(intArray(data.claim, n, 0, nextId, 'claims')),
    vision: data.vision.map((v: unknown) => Uint8Array.from(intArray(v, n, 0, 2, 'fog of war'))),
    prospect: data.prospect.map((v: unknown) => Uint8Array.from(intArray(v, n, 0, 1, 'geologist signs'))),
    pioneerLand: Uint8Array.from(intArray(data.pioneerLand, n, 0, players.length, 'pioneer land')), militaryLand: new Uint8Array(n),
    footprint: new Int32Array(n), door: new Int32Array(n), territory: new Uint8Array(n),
    players, buildings, settlers, messages, farSights, nextId,
    randomState: int(data.randomState, 0, 0xffffffff, 'random state'), mapVersion: 0, territoryVersion: 0,
    winner: data.winner === null ? null : int(data.winner, 0, ownerMax, 'winner'),
    mapLayout: data.mapLayout === 'islands' ? 'islands' : data.mapLayout === 'continent' ? 'continent' : fail('the map layout is unknown')
  };
  // Building tiles and territory are derived from the buildings rather than trusted from the file.
  for (const b of buildings) {
    if (b.typeId === 'castle' && buildings.filter((o) => o.typeId === 'castle' && o.owner === b.owner).length > 1) fail('a player has two castles');
    for (let dy = 0; dy < b.size; dy++) {
      for (let dx = 0; dx < b.size; dx++) {
        const i = tileIndex(world, b.x + dx, b.y + dy);
        if (world.footprint[i] !== 0 || world.door[i] !== 0) fail('buildings overlap');
        world.footprint[i] = b.id + 1;
      }
    }
    const door = tileIndex(world, b.doorX, b.doorY);
    if (world.footprint[door] !== 0 || world.door[door] !== 0) fail('buildings overlap');
    world.door[door] = b.id + 1;
  }
  const ids = new Set<number>();
  for (const thing of [...buildings, ...settlers, ...messages]) {
    if (ids.has(thing.id)) fail('two things share an id');
    ids.add(thing.id);
  }
  const settlerIds = new Set(settlers.map((s) => s.id));
  for (const b of buildings) for (const g of b.garrison) if (!settlerIds.has(g)) fail('a garrison names a missing soldier');
  for (const p of players) {
    if (!p.isEliminated && !buildings.some((b) => b.typeId === 'castle' && b.owner === p.id)) fail('a player has no castle');
  }
  const stats = players.map((p) => p.stats.largestTerritory);
  recomputeTerritory(world);
  players.forEach((p, k) => { p.stats.largestTerritory = stats[k]; });
  world.territoryVersion = 0;
  return world;
}
