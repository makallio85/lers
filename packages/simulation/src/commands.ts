import {
  BUILDING_TYPES, GOOD_TYPES, SPECIALIST_TOOLS, SPECIALIST_TYPES, THIEF_HEALTH, TOOL_TYPES, WEAPON_TYPES, WORK_AREA_BUILDINGS, WORK_AREA_REACH,
  RACE_SETTINGS, consumersOf, isBuildableBy, isSoldierType, isSpecialistType, isUnitType, isWarMachineType
} from './definitions.ts';
import type { BuildingTypeId, GoodType, ShipType, SoldierType, SpecialistType, SpellType, ToolType, TradeModeType } from './definitions.ts';
import { MAX_TRADE_WAYPOINTS, SHIP_TYPES, SOLDIER_TYPES, SPELL_STATS, SPELL_TYPES, TRADE_MODE_TYPES, TRADE_UNLIMITED, isShipType } from './definitions.ts';
import { settleWinner } from './world.ts';
import { board, boardingProblem, isOpenSea, isSeaPassable, unload } from './sea.ts';
import { castSpell, promote, promotionProblem, spellProblem } from './magic.ts';
import { isMachinePassable } from './movement.ts';
import { landRegion } from './regions.ts';
import { findPath, reachableFrom } from './pathfinding.ts';
import { hasExplored, hasExploredBuilding } from './vision.ts';
import {
  TERRAIN_GRASS, TERRAIN_MOUNTAIN, TERRAIN_WATER, buildingById, castleOf, claimsTerritory, inBounds, isMilitaryBuilding, isStorageBuilding, isWalkable,
  newBuilding, playerOf, pushMessage, recomputeTerritory, removeBuilding, siteCost, tileIndex, isEnemy
} from './world.ts';
import type { Building, Settler, World } from './world.ts';

export type Command =
  | { type: 'placeBuilding'; playerId: number; buildingType: BuildingTypeId; x: number; y: number }
  | { type: 'demolishBuilding'; playerId: number; buildingId: number }
  | { type: 'setBuildingPaused'; playerId: number; buildingId: number; isPaused: boolean }
  | { type: 'setTransportPriority'; playerId: number; good: GoodType; position: number }
  | { type: 'setGoodStored'; playerId: number; good: GoodType; isStored: boolean }
  | { type: 'setProductionOrder'; playerId: number; good: GoodType; count: number }
  | { type: 'setProductionShare'; playerId: number; good: GoodType; share: number }
  | { type: 'setDistribution'; playerId: number; good: GoodType; buildingType: BuildingTypeId; share: number }
  | { type: 'setRecruiting'; playerId: number; isAutomatic: boolean; count: number }
  | { type: 'setGarrisonWanted'; playerId: number; buildingId: number; count: number }
  | {
    type: 'moveSoldiers'; playerId: number; soldierIds: number[]; x: number; y: number;
    /** Add the spot as a waypoint after the current move (Shift). */
    isAppending?: boolean;
    /** Walk on without stopping to fight until they arrive. */
    isIgnoringEnemies?: boolean;
  }
  | { type: 'patrolSoldiers'; playerId: number; soldierIds: number[]; x: number; y: number }
  | { type: 'holdSoldiers'; playerId: number; soldierIds: number[] }
  | { type: 'attackBuilding'; playerId: number; soldierIds: number[]; buildingId: number }
  | { type: 'setSitePriority'; playerId: number; buildingId: number; isPriority: boolean }
  | { type: 'setWorkArea'; playerId: number; buildingId: number; x: number; y: number }
  | { type: 'setOccupations'; playerId: number; minCarrierPercent: number; maxCrewPercent: number }
  | { type: 'setSpecialists'; playerId: number; specialistType: SpecialistType; count: number }
  | { type: 'moveSpecialists'; playerId: number; settlerIds: number[]; x: number; y: number }
  /** Chosen geologists, pioneers or thieves become carriers where they stand, as pioneers do to start a colony. */
  | { type: 'releaseSpecialists'; playerId: number; settlerIds: number[] }
  | { type: 'castSpell'; playerId: number; priestId: number; spell: SpellType; x: number; y: number }
  | { type: 'promoteSoldiers'; playerId: number; soldierType: SoldierType }
  | { type: 'setTradeRoute'; playerId: number; buildingId: number; x: number; y: number; waypoints: { x: number; y: number }[] }
  | { type: 'setTradeGood'; playerId: number; buildingId: number; good: GoodType; amount: number }
  | { type: 'setTradeMode'; playerId: number; buildingId: number; mode: TradeModeType }
  | { type: 'setShipOrder'; playerId: number; buildingId: number; shipType: ShipType; count: number }
  | { type: 'boardShip'; playerId: number; shipId: number; unitIds: number[] }
  | { type: 'unloadShip'; playerId: number; shipId: number }
  | { type: 'surrender'; playerId: number };

export type CommandResult = { isAccepted: true; buildingId?: number } | { isAccepted: false; reason: string };

/** Share of a building's materials returned when it is demolished. */
export const DEMOLISH_REFUND = 0.5;
export const MAX_SHARE = 10;
export const MAX_ORDER = 99;
export const MAX_SPECIALISTS = 50;
export const MAX_WAYPOINTS = 8;

/**
 * Another occupied military building of the same owner whose land reaches this one. As in the original game,
 * a tower cannot be taken while another of its owner's towers (or the castle) covers it.
 */
export function coveringBuilding(world: World, b: Building): Building | null {
  const cx = b.x + b.size / 2, cy = b.y + b.size / 2;
  for (const other of world.buildings) {
    if (other.id === b.id || other.owner !== b.owner || !claimsTerritory(other)) continue;
    const r = BUILDING_TYPES[other.typeId].territoryRadius;
    if (Math.hypot(other.x + other.size / 2 - cx, other.y + other.size / 2 - cy) <= r) return other;
  }
  return null;
}
const WATER_REACH = 4;

const refuse = (reason: string): CommandResult => ({ isAccepted: false, reason });
const accept = (): CommandResult => ({ isAccepted: true });

function isKnownBuildingType(value: unknown): value is BuildingTypeId {
  return typeof value === 'string' && Object.hasOwn(BUILDING_TYPES, value);
}

function isKnownGood(value: unknown): value is GoodType {
  return typeof value === 'string' && (GOOD_TYPES as readonly string[]).includes(value);
}

function isIntIn(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

function hasWaterNearby(world: World, x: number, y: number, size: number, isSeaOnly = false): boolean {
  for (let ty = y - WATER_REACH; ty < y + size + WATER_REACH; ty++) {
    for (let tx = x - WATER_REACH; tx < x + size + WATER_REACH; tx++) {
      if (!inBounds(world, tx, ty)) continue;
      const i = tileIndex(world, tx, ty);
      if (isSeaOnly ? isOpenSea(world, i) : world.terrain[i] === TERRAIN_WATER) return true;
    }
  }
  return false;
}

/**
 * Why a building cannot go at (x, y) ignoring whether settlers can reach it, or null when the ground fits.
 * Cheap enough to run for every tile when drawing placement markers.
 */
export function groundProblem(world: World, playerId: number, buildingType: BuildingTypeId, x: number, y: number): string | null {
  const type = BUILDING_TYPES[buildingType];
  if (!type.isAvailable) return `${type.label} is not available yet`;
  const race = playerOf(world, playerId)?.raceType ?? 'romans';
  if (!isBuildableBy(buildingType, race)) return `Only the ${type.races!.map((r) => RACE_SETTINGS[r].label).join(' and ')} build this`;
  const size = type.size;
  const doorX = x + Math.floor(size / 2), doorY = y + size;
  if (!inBounds(world, x, y) || !inBounds(world, x + size - 1, doorY)) return 'Too close to the map edge';
  const owned = playerId + 1;
  const terrain = type.placementType === 'mountain' ? TERRAIN_MOUNTAIN : TERRAIN_GRASS;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const i = tileIndex(world, x + dx, y + dy);
      if (world.territory[i] !== owned) return 'Outside your territory';
      if (world.terrain[i] !== terrain) return terrain === TERRAIN_MOUNTAIN ? 'Mines go on mountains' : 'Needs flat grassland';
      if (world.footprint[i] !== 0 || world.door[i] !== 0) return 'Another building is in the way';
      if (world.tree[i] >= 0) return 'Trees are in the way';
      if (world.rock[i] > 0) return 'Rocks are in the way';
      if (world.field[i] >= 0) return 'Fields are in the way';
    }
  }
  const door = tileIndex(world, doorX, doorY);
  if (world.territory[door] !== owned) return 'Outside your territory';
  if (!isWalkable(world, door) || world.door[door] !== 0 || world.tree[door] >= 0) return 'The entrance is blocked';
  if (type.placementType === 'near_water' && !hasWaterNearby(world, x, y, size)) return 'Needs water nearby';
  if (type.placementType === 'shore' && !hasWaterNearby(world, x, y, size, true)) return 'Needs the open sea nearby, not a lake';
  return null;
}

/** Why a building cannot go at (x, y), or null when it can. Shared by the placement preview and the command. */
export function placementProblem(world: World, playerId: number, buildingType: BuildingTypeId, x: number, y: number): string | null {
  const problem = groundProblem(world, playerId, buildingType, x, y);
  if (problem) return problem;
  const castle = castleOf(world, playerId);
  if (!castle) return 'You have no castle';
  const size = BUILDING_TYPES[buildingType].size;
  // Temporarily occupy the footprint so the entrance check sees the finished layout.
  const saved: number[] = [];
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const i = tileIndex(world, x + dx, y + dy);
      saved.push(world.footprint[i]);
      world.footprint[i] = -1;
    }
  }
  const door = tileIndex(world, x + Math.floor(size / 2), y + size);
  const doorX = x + Math.floor(size / 2), doorY = y + size;
  // Stretches of own land as they are now, before the new building stands.
  const home = landRegion(world, castle.doorX, castle.doorY);
  const here = landRegion(world, doorX, doorY);
  const isReachable = reachableFrom(world, tileIndex(world, castle.doorX, castle.doorY));
  // On a colony's land (cut off from the castle), the entrance must connect to one of the player's buildings there,
  // or, before the first one, to where the player's settlers stand on that land.
  const colony = here !== home ? world.buildings.find((b) => b.owner === playerId && landRegion(world, b.doorX, b.doorY) === here) : undefined;
  const settler = here !== home && !colony
    ? world.settlers.find((s) => s.owner === playerId && !s.isInside && !isUnitType(s.settlerType) && landRegion(world, s.x, s.y) === here) : undefined;
  const anchor = colony ? tileIndex(world, colony.doorX, colony.doorY) : settler ? tileIndex(world, Math.round(settler.x), Math.round(settler.y)) : -1;
  const isColonyReachable = here !== 0 && anchor >= 0 ? reachableFrom(world, door)(anchor) : false;
  let k = 0;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) world.footprint[tileIndex(world, x + dx, y + dy)] = saved[k++];
  }
  if (!isReachable(door) && !isColonyReachable) return 'Settlers cannot reach the entrance';
  // The new building must not wall in the entrance of one you already have (on the castle's land; colonies are checked by their own reach).
  for (const b of world.buildings) {
    if (b.owner !== playerId || landRegion(world, b.doorX, b.doorY) !== home) continue;
    if (!isReachable(tileIndex(world, b.doorX, b.doorY))) return 'This would block the entrance of another building';
  }
  return null;
}

function ownBuilding(world: World, playerId: number, buildingId: unknown): Building | null {
  if (!Number.isInteger(buildingId)) return null;
  const b = buildingById(world, buildingId as number);
  return b && b.owner === playerId ? b : null;
}

/** Soldiers and war machines of this player standing outside, by id. Null when any id is not one. */
function ownFieldSoldiers(world: World, playerId: number, ids: unknown): Settler[] | null {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500) return null;
  const out: Settler[] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    if (!Number.isInteger(id) || seen.has(id)) return null;
    seen.add(id);
    const s = world.settlers.find((settler) => settler.id === id);
    if (!s || s.owner !== playerId || !isUnitType(s.settlerType) || s.isInside || s.health <= 0) return null;
    out.push(s);
  }
  return out;
}

/** A unit's route: war machines keep to open ground. */
function unitPath(world: World, s: Settler, goal: number): number[] | null {
  const start = tileIndex(world, Math.round(s.x), Math.round(s.y));
  return findPath(world, start, goal, 40_000, isShipType(s.settlerType) ? isSeaPassable : isWarMachineType(s.settlerType) ? isMachinePassable : isWalkable);
}

/** Walkable tiles around a point, nearest first, so a group spreads out instead of stacking on one tile. */
function formationTiles(world: World, x: number, y: number, count: number, isPassable: (world: World, i: number) => boolean = isWalkable): number[] {
  const tiles: number[] = [];
  for (let r = 0; tiles.length < count && r < 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !inBounds(world, x + dx, y + dy)) continue;
        const i = tileIndex(world, x + dx, y + dy);
        if (isPassable(world, i)) tiles.push(i);
      }
    }
  }
  return tiles;
}

/** Validates and applies one player command. Invalid commands never change the world. */
export function applyCommand(world: World, command: Command): CommandResult {
  if (!command || typeof command !== 'object') return refuse('Malformed command');
  const player = Number.isInteger(command.playerId) ? playerOf(world, command.playerId) : undefined;
  if (!player) return refuse('Unknown player');
  if (player.isEliminated || world.winner !== null) return refuse('The match is over');
  if (!castleOf(world, command.playerId)) return refuse('You have no castle');

  switch (command.type) {
    case 'placeBuilding': {
      if (!isKnownBuildingType(command.buildingType)) return refuse('Unknown building');
      if (!Number.isInteger(command.x) || !Number.isInteger(command.y)) return refuse('Invalid position');
      const problem = placementProblem(world, command.playerId, command.buildingType, command.x, command.y);
      if (problem) return refuse(problem);
      const b = newBuilding(world, command.buildingType, command.playerId, command.x, command.y);
      return { isAccepted: true, buildingId: b.id };
    }
    case 'demolishBuilding': {
      const b = ownBuilding(world, command.playerId, command.buildingId);
      if (!b) return refuse('Unknown building');
      if (b.typeId === 'castle') return refuse('The castle cannot be demolished');
      demolish(world, b);
      return accept();
    }
    case 'setBuildingPaused': {
      const b = ownBuilding(world, command.playerId, command.buildingId);
      if (!b) return refuse('Unknown building');
      if (typeof command.isPaused !== 'boolean') return refuse('Malformed command');
      b.isPaused = command.isPaused;
      return accept();
    }
    case 'setTransportPriority': {
      if (!isKnownGood(command.good) || !isIntIn(command.position, 0, GOOD_TYPES.length - 1)) return refuse('Malformed command');
      const order = player.transportPriority.filter((g) => g !== command.good);
      order.splice(command.position, 0, command.good);
      player.transportPriority = order;
      return accept();
    }
    case 'setGoodStored': {
      if (!isKnownGood(command.good) || typeof command.isStored !== 'boolean') return refuse('Malformed command');
      player.isStored[command.good] = command.isStored;
      return accept();
    }
    case 'setProductionOrder':
    case 'setProductionShare': {
      const isMade = (TOOL_TYPES as readonly string[]).includes(command.good) || (WEAPON_TYPES as readonly string[]).includes(command.good);
      if (!isKnownGood(command.good) || !isMade) return refuse('Only tools and weapons are made to order');
      if (command.type === 'setProductionOrder') {
        if (!isIntIn(command.count, 0, MAX_ORDER)) return refuse('Malformed command');
        player.productionOrders[command.good] = command.count;
      } else {
        if (!isIntIn(command.share, 0, MAX_SHARE)) return refuse('Malformed command');
        player.productionShares[command.good] = command.share;
      }
      return accept();
    }
    case 'setDistribution': {
      if (!isKnownGood(command.good) || !isKnownBuildingType(command.buildingType) || !isIntIn(command.share, 0, MAX_SHARE)) {
        return refuse('Malformed command');
      }
      if (!consumersOf(command.good).includes(command.buildingType) || !player.distribution[command.good]) {
        return refuse('That building does not use this good');
      }
      player.distribution[command.good]![command.buildingType] = command.share;
      return accept();
    }
    case 'setRecruiting': {
      if (typeof command.isAutomatic !== 'boolean' || !isIntIn(command.count, 0, MAX_ORDER)) return refuse('Malformed command');
      player.isRecruitingAutomatic = command.isAutomatic;
      player.recruitsLeft = command.count;
      return accept();
    }
    case 'setGarrisonWanted': {
      const b = ownBuilding(world, command.playerId, command.buildingId);
      if (!b || !isMilitaryBuilding(b)) return refuse('Unknown building');
      const min = b.typeId === 'castle' ? 0 : 1;
      if (!isIntIn(command.count, min, BUILDING_TYPES[b.typeId].garrisonCapacity)) return refuse('Malformed command');
      b.garrisonWanted = command.count;
      return accept();
    }
    case 'moveSoldiers': {
      const soldiers = ownFieldSoldiers(world, command.playerId, command.soldierIds);
      if (!soldiers) return refuse('Choose your own soldiers outside buildings');
      if (!Number.isInteger(command.x) || !Number.isInteger(command.y) || !inBounds(world, command.x, command.y)) return refuse('Invalid position');
      if (!hasExplored(world, command.playerId, command.x, command.y)) return refuse('You have not explored that land');
      if (command.isAppending !== undefined && typeof command.isAppending !== 'boolean') return refuse('Malformed command');
      if (command.isIgnoringEnemies !== undefined && typeof command.isIgnoringEnemies !== 'boolean') return refuse('Malformed command');
      // Ships gather on the water, everyone else on land.
      const isFleet = soldiers.every((s) => isShipType(s.settlerType));
      if (!isFleet && soldiers.some((s) => isShipType(s.settlerType))) return refuse('Order ships and soldiers separately');
      const tiles = formationTiles(world, command.x, command.y, soldiers.length, isFleet ? isSeaPassable : isWalkable);
      if (tiles.length === 0) return refuse(isFleet ? 'Ships need open water there' : 'Soldiers cannot stand there');
      soldiers.forEach((s, k) => {
        const tile = tiles[k % tiles.length];
        s.isHolding = false; s.isPatrolling = false;
        if (command.isAppending && s.phase === 'moving' && s.path.length > 0) {
          if (s.waypoints.length < MAX_WAYPOINTS) s.waypoints.push(tile);
          return;
        }
        const path = unitPath(world, s, tile);
        if (!path) return;
        s.path = path; s.phase = 'moving'; s.attackId = null; s.enemyId = null; s.waypoints = [];
        if (!isWarMachineType(s.settlerType)) s.homeId = null;
        s.isIgnoringEnemies = command.isIgnoringEnemies === true;
      });
      return accept();
    }
    case 'patrolSoldiers': {
      const soldiers = ownFieldSoldiers(world, command.playerId, command.soldierIds);
      if (!soldiers) return refuse('Choose your own soldiers outside buildings');
      if (!Number.isInteger(command.x) || !Number.isInteger(command.y) || !inBounds(world, command.x, command.y)) return refuse('Invalid position');
      if (!hasExplored(world, command.playerId, command.x, command.y)) return refuse('You have not explored that land');
      const tiles = formationTiles(world, command.x, command.y, soldiers.length);
      if (tiles.length === 0) return refuse('Soldiers cannot stand there');
      soldiers.forEach((s, k) => {
        const from = tileIndex(world, Math.round(s.x), Math.round(s.y));
        const path = unitPath(world, s, tiles[k % tiles.length]);
        if (!path) return;
        // Patrol between where each soldier stands now and its spot at the target, until another order.
        s.path = path; s.phase = 'moving'; s.attackId = null; s.enemyId = null; s.waypoints = [];
        if (!isWarMachineType(s.settlerType)) s.homeId = null;
        s.isPatrolling = true; s.isHolding = false; s.isIgnoringEnemies = false;
        s.workCentre = from; s.targetTile = tiles[k % tiles.length];
      });
      return accept();
    }
    case 'holdSoldiers': {
      const soldiers = ownFieldSoldiers(world, command.playerId, command.soldierIds);
      if (!soldiers) return refuse('Choose your own soldiers outside buildings');
      for (const s of soldiers) {
        s.path = []; s.phase = 'idle'; s.attackId = null; s.waypoints = []; s.isPatrolling = false;
        s.isHolding = true; s.isIgnoringEnemies = false;
      }
      return accept();
    }
    case 'attackBuilding': {
      const soldiers = ownFieldSoldiers(world, command.playerId, command.soldierIds);
      if (!soldiers) return refuse('Choose your own soldiers outside buildings');
      const target = Number.isInteger(command.buildingId) ? buildingById(world, command.buildingId) : undefined;
      if (!target || !isEnemy(world, command.playerId, target.owner) || !hasExploredBuilding(world, command.playerId, target)) {
        return refuse('Choose an enemy building you can see');
      }
      if (!isMilitaryBuilding(target) || !target.isComplete) return refuse('Only towers and castles can be attacked');
      if (soldiers.some((s) => isShipType(s.settlerType))) return refuse('Ships cannot attack: land the soldiers first');
      for (const s of soldiers) {
        s.phase = 'attacking'; s.attackId = target.id; s.path = []; s.enemyId = null;
        // A war machine keeps its hall, where it reloads.
        if (!isWarMachineType(s.settlerType)) s.homeId = null;
        s.waypoints = []; s.isPatrolling = false; s.isHolding = false; s.isIgnoringEnemies = false;
      }
      return accept();
    }
    case 'setSitePriority': {
      const b = ownBuilding(world, command.playerId, command.buildingId);
      if (!b || b.isComplete) return refuse('Only construction sites can be built first');
      if (typeof command.isPriority !== 'boolean') return refuse('Malformed command');
      b.isPriority = command.isPriority;
      return accept();
    }
    case 'setWorkArea': {
      const b = ownBuilding(world, command.playerId, command.buildingId);
      if (!b || !(WORK_AREA_BUILDINGS as readonly string[]).includes(b.typeId)) return refuse('This building has no work area');
      if (!Number.isInteger(command.x) || !Number.isInteger(command.y) || !inBounds(world, command.x, command.y)) return refuse('Invalid position');
      if (Math.hypot(command.x - b.doorX, command.y - b.doorY) > WORK_AREA_REACH) return refuse('Too far from the building');
      if (world.territory[tileIndex(world, command.x, command.y)] !== command.playerId + 1) return refuse('Outside your territory');
      b.workX = command.x; b.workY = command.y;
      return accept();
    }
    case 'setOccupations': {
      if (!isIntIn(command.minCarrierPercent, 0, 100) || !isIntIn(command.maxCrewPercent, 0, 100)) return refuse('Malformed command');
      player.minCarrierPercent = command.minCarrierPercent;
      player.maxCrewPercent = command.maxCrewPercent;
      return accept();
    }
    case 'castSpell': {
      if (!(SPELL_TYPES as readonly string[]).includes(command.spell)) return refuse('Unknown spell');
      const priest = Number.isInteger(command.priestId) ? world.settlers.find((s) => s.id === command.priestId) : undefined;
      if (!priest || priest.owner !== command.playerId || priest.settlerType !== 'priest' || priest.isInside) return refuse('Choose one of your priests');
      if (!Number.isInteger(command.x) || !Number.isInteger(command.y) || !inBounds(world, command.x, command.y)) return refuse('Invalid position');
      if (!hasExplored(world, command.playerId, command.x, command.y) && !SPELL_STATS[command.spell].isRanged) return refuse('You have not explored that land');
      const problem = spellProblem(world, priest, command.spell, command.x, command.y);
      if (problem) return refuse(problem);
      castSpell(world, priest, command.spell, command.x, command.y);
      return accept();
    }
    case 'setTradeRoute': {
      const b = ownBuilding(world, command.playerId, command.buildingId);
      if (!b || (b.typeId !== 'marketplace' && b.typeId !== 'landing_dock') || !b.isComplete) return refuse('Choose one of your marketplaces or landing docks');
      if (!Number.isInteger(command.x) || !Number.isInteger(command.y) || !inBounds(world, command.x, command.y)) return refuse('Invalid position');
      if (!Array.isArray(command.waypoints) || command.waypoints.length > MAX_TRADE_WAYPOINTS) return refuse(`At most ${MAX_TRADE_WAYPOINTS} waypoints`);
      const waypoints: number[] = [];
      for (const w of command.waypoints) {
        if (!w || !Number.isInteger(w.x) || !Number.isInteger(w.y) || !inBounds(world, w.x, w.y)) return refuse('Invalid waypoint');
        // As in the original, waypoints must be land the player can see or has seen.
        if (!hasExplored(world, command.playerId, w.x, w.y)) return refuse('Waypoints must be on explored land');
        waypoints.push(tileIndex(world, w.x, w.y));
      }
      b.tradeRoute = { x: command.x, y: command.y, waypoints, goods: b.tradeRoute?.goods ?? {} };
      return accept();
    }
    case 'setTradeGood': {
      const b = ownBuilding(world, command.playerId, command.buildingId);
      if (!b || (b.typeId !== 'marketplace' && b.typeId !== 'landing_dock') || !b.tradeRoute) return refuse('Set the route first');
      if (!isKnownGood(command.good) || !isIntIn(command.amount, TRADE_UNLIMITED, 10_000)) return refuse('Malformed command');
      b.tradeRoute.goods[command.good] = command.amount;
      return accept();
    }
    case 'setShipOrder': {
      const b = ownBuilding(world, command.playerId, command.buildingId);
      if (!b || b.typeId !== 'shipyard') return refuse('Choose one of your shipyards');
      if (!(SHIP_TYPES as readonly string[]).includes(command.shipType) || !isIntIn(command.count, 0, 20)) return refuse('Malformed command');
      b.shipOrders[command.shipType] = command.count;
      return accept();
    }
    case 'boardShip': {
      const ship = Number.isInteger(command.shipId) ? world.settlers.find((s) => s.id === command.shipId) : undefined;
      if (!ship || ship.owner !== command.playerId || !isShipType(ship.settlerType)) return refuse('Choose one of your ships');
      if (!Array.isArray(command.unitIds) || command.unitIds.length === 0) return refuse('Choose who boards');
      const units = command.unitIds.map((id) => world.settlers.find((s) => s.id === id));
      if (units.some((u) => !u || u.owner !== command.playerId || u.isInside || u.health <= 0 && isUnitType(u.settlerType)
        || !(isSoldierType(u.settlerType) || isSpecialistType(u.settlerType) || u.settlerType === 'priest'))) {
        return refuse('Only your soldiers, specialists and priests outside buildings can board');
      }
      const problem = boardingProblem(world, ship, units as Settler[]);
      if (problem) return refuse(problem);
      board(world, ship, units as Settler[]);
      return accept();
    }
    case 'unloadShip': {
      const ship = Number.isInteger(command.shipId) ? world.settlers.find((s) => s.id === command.shipId) : undefined;
      if (!ship || ship.owner !== command.playerId || !isShipType(ship.settlerType)) return refuse('Choose one of your ships');
      const problem = unload(world, ship);
      return problem ? refuse(problem) : accept();
    }
    case 'setTradeMode': {
      const b = ownBuilding(world, command.playerId, command.buildingId);
      if (!b || (b.typeId !== 'marketplace' && b.typeId !== 'landing_dock')) return refuse('Choose one of your marketplaces or landing docks');
      if (!(TRADE_MODE_TYPES as readonly string[]).includes(command.mode)) return refuse('Malformed command');
      b.tradeMode = command.mode;
      return accept();
    }
    case 'promoteSoldiers': {
      if (!(SOLDIER_TYPES as readonly string[]).includes(command.soldierType)) return refuse('Unknown soldier type');
      const problem = promotionProblem(world, command.playerId, command.soldierType);
      if (problem) return refuse(problem);
      promote(world, command.playerId, command.soldierType);
      return accept();
    }
    case 'setSpecialists': {
      if (!(SPECIALIST_TYPES as readonly string[]).includes(command.specialistType) || !isIntIn(command.count, 0, MAX_SPECIALISTS)) {
        return refuse('Malformed command');
      }
      const made = setSpecialistCount(world, command.playerId, command.specialistType, command.count);
      const tool = SPECIALIST_TOOLS[command.specialistType];
      return made === command.count ? accept() : refuse(`Only ${made} could be made: each needs a free carrier${tool ? ` and a ${tool} in storage` : ''}`);
    }
    case 'moveSpecialists': {
      if (!Array.isArray(command.settlerIds) || command.settlerIds.length === 0 || command.settlerIds.length > MAX_SPECIALISTS) return refuse('Malformed command');
      const ids = new Set(command.settlerIds);
      if (ids.size !== command.settlerIds.length) return refuse('Malformed command');
      const specialists = world.settlers.filter((s) => ids.has(s.id));
      if (specialists.length !== ids.size || specialists.some((s) => s.owner !== command.playerId || !(isSpecialistType(s.settlerType) || s.settlerType === 'priest'))) {
        return refuse('Choose your own geologists, pioneers, thieves or priests');
      }
      if (!Number.isInteger(command.x) || !Number.isInteger(command.y) || !inBounds(world, command.x, command.y)) return refuse('Invalid position');
      if (!hasExplored(world, command.playerId, command.x, command.y)) return refuse('You have not explored that land');
      const centre = tileIndex(world, command.x, command.y);
      const tiles = formationTiles(world, command.x, command.y, specialists.length);
      if (tiles.length === 0) return refuse('They cannot stand there');
      specialists.forEach((s, k) => {
        const path = findPath(world, tileIndex(world, Math.round(s.x), Math.round(s.y)), tiles[k % tiles.length]);
        if (!path) return;
        s.path = path; s.phase = 'moving'; s.isInside = false; s.workCentre = centre; s.targetTile = -1; s.timer = 0;
      });
      return accept();
    }
    case 'releaseSpecialists': {
      if (!Array.isArray(command.settlerIds) || command.settlerIds.length === 0 || command.settlerIds.length > MAX_SPECIALISTS) return refuse('Malformed command');
      const ids = new Set(command.settlerIds);
      if (ids.size !== command.settlerIds.length) return refuse('Malformed command');
      const specialists = world.settlers.filter((s) => ids.has(s.id));
      if (specialists.length !== ids.size || specialists.some((s) => s.owner !== command.playerId || !isSpecialistType(s.settlerType) || s.isInside)) {
        return refuse('Choose your own geologists, pioneers or thieves outside buildings');
      }
      for (const s of specialists) releaseSpecialist(world, s);
      return accept();
    }
    case 'surrender': {
      player.isEliminated = true;
      pushMessage(world, player.id, 'Defeat', 'You surrendered.', true, null);
      settleWinner(world);
      return accept();
    }
  }
  return refuse('Unknown command');
}

/**
 * Makes or dismisses specialists until the player has `count` of that type. A free carrier takes the tool
 * from storage; a dismissed specialist becomes a carrier and the tool goes back. Returns how many there are.
 */
function setSpecialistCount(world: World, playerId: number, type: SpecialistType, count: number): number {
  const tool = SPECIALIST_TOOLS[type];
  const castle = castleOf(world, playerId)!;
  const own = () => world.settlers.filter((s) => s.owner === playerId && s.settlerType === type);
  for (const s of own().slice(count)) {
    s.settlerType = 'carrier'; s.phase = 'idle'; s.path = []; s.workCentre = -1; s.targetTile = -1; s.timer = 0; s.health = 0;
    if (tool) castle.stock[tool]++;
  }
  let have = own().length;
  while (have < count) {
    const store = world.buildings.find((b) => b.owner === playerId && b.isComplete && BUILDING_TYPES[b.typeId].storageCapacity > 0
      && (tool === null || b.stock[tool] - b.reserved[tool] > 0));
    const carrier = world.settlers.find((s) => s.owner === playerId && s.settlerType === 'carrier' && s.phase === 'idle' && !s.carrying);
    if (!store || !carrier) break;
    if (tool) store.stock[tool]--;
    carrier.settlerType = type; carrier.phase = 'idle'; carrier.path = []; carrier.workCentre = -1;
    carrier.health = type === 'thief' ? THIEF_HEALTH : 0;
    if (carrier.isInside) { carrier.isInside = false; carrier.x = store.doorX; carrier.y = store.doorY; carrier.prevX = carrier.x; carrier.prevY = carrier.y; }
    have++;
  }
  return have;
}

/** A specialist becomes a carrier where it stands; its tool goes to the nearest storage on its land, else the castle. */
function releaseSpecialist(world: World, s: Settler): void {
  const tool = SPECIALIST_TOOLS[s.settlerType as SpecialistType];
  if (tool) {
    const region = landRegion(world, s.x, s.y);
    const stores = world.buildings.filter((b) => b.owner === s.owner && b.isComplete && isStorageBuilding(b) && landRegion(world, b.doorX, b.doorY) === region);
    stores.sort((a, b) => Math.hypot(a.doorX - s.x, a.doorY - s.y) - Math.hypot(b.doorX - s.x, b.doorY - s.y));
    (stores[0] ?? castleOf(world, s.owner)!).stock[tool]++;
  }
  s.settlerType = 'carrier'; s.phase = 'idle'; s.path = []; s.workCentre = -1; s.targetTile = -1; s.timer = 0; s.health = 0; s.homeId = null;
}

/** Removes a building, returning half its materials and everything it held to the castle. */
function demolish(world: World, b: Building): void {
  const castle = castleOf(world, b.owner)!;
  const type = BUILDING_TYPES[b.typeId];
  for (const good of GOOD_TYPES) {
    const materials = b.isComplete ? (siteCost(world, b)[good] ?? 0) : b.delivered[good] + b.built[good];
    castle.stock[good] += Math.floor(materials * DEMOLISH_REFUND) + b.stock[good] + b.input[good];
  }
  const garrison = new Set(b.garrison);
  removeBuilding(world, b);
  for (const s of world.settlers) {
    if (garrison.has(s.id)) {
      s.phase = 'idle'; s.isInside = false; s.homeId = null; s.x = b.doorX; s.y = b.doorY; s.path = [];
      continue;
    }
    releaseFromBuilding(world, s.id, b.id, type.tool);
  }
  recomputeTerritory(world);
  pushMessage(world, b.owner, `${type.label} demolished`, 'Half of its materials went back to the castle.', false, null);
}

/** Ends any job that depends on a building that no longer exists. */
export function releaseFromBuilding(world: World, settlerId: number, buildingId: number, tool: ToolType | null): void {
  const s = world.settlers.find((settler) => settler.id === settlerId)!;
  if (s.fromId !== buildingId && s.toId !== buildingId && s.homeId !== buildingId && s.attackId !== buildingId) return;
  const castle = castleOf(world, s.owner);
  if (isUnitType(s.settlerType)) {
    // Soldiers and war machines heading for, defending or attacking the building simply stop where they are.
    if (s.homeId === buildingId) s.homeId = null;
    if (s.attackId === buildingId) s.attackId = null;
    if (s.phase === 'toGarrison' || s.phase === 'defending' || s.phase === 'attacking' || s.phase === 'inside' || s.phase === 'returning') {
      s.phase = 'idle'; s.isInside = false; s.path = [];
    }
    return;
  }
  if (s.phase === 'toPickup' && s.good && s.fromId !== buildingId) {
    const from = buildingById(world, s.fromId);
    if (from) from.reserved[s.good] = Math.max(0, from.reserved[s.good] - 1);
  }
  if (s.phase === 'toTool' && s.good && s.fromId !== buildingId) {
    const from = buildingById(world, s.fromId);
    if (from) from.reserved[s.good] = Math.max(0, from.reserved[s.good] - 1);
  }
  if ((s.phase === 'toPickup' || s.phase === 'toDrop') && s.good && s.toId !== buildingId) {
    const to = buildingById(world, s.toId);
    if (to) to.incoming[s.good] = Math.max(0, to.incoming[s.good] - 1);
  }
  if (s.phase === 'toRecruit' && s.good && castle) castle.stock[s.good]++;
  const isWorker = s.settlerType !== 'carrier' && s.settlerType !== 'builder' && s.settlerType !== 'digger';
  if (s.homeId === buildingId && isWorker) {
    // A worker whose workplace is gone hands in the tool and goes back to carrying.
    if (castle && tool && s.phase !== 'toTool') castle.stock[tool]++;
    s.settlerType = 'carrier';
  }
  if (s.phase === 'toTool') {
    // The tool was never collected: the settler stays a carrier and the workplace waits for someone else.
    const home = buildingById(world, s.homeId);
    if (home && home.workerId === s.id) home.workerId = null;
    s.settlerType = 'carrier';
  }
  if (s.targetTile >= 0) { world.claim[s.targetTile] = 0; s.targetTile = -1; }
  s.fromId = null; s.toId = null; s.good = null; s.homeId = null;
  s.path = []; s.timer = 0; s.isInside = false;
  // Anyone holding goods takes them to the castle; everyone else becomes idle.
  s.phase = s.carrying ? 'toStore' : 'idle';
}
