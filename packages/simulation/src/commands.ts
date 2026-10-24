import { BUILDING_TYPES, GOOD_TYPES } from './definitions.ts';
import type { BuildingTypeId, GoodType, ToolType } from './definitions.ts';
import { findPath } from './pathfinding.ts';
import {
  TERRAIN_GRASS, TERRAIN_WATER, buildingById, castleOf, inBounds, isWalkable, newBuilding, playerOf, pushMessage,
  recomputeTerritory, removeBuilding, tileIndex
} from './world.ts';
import type { Building, World } from './world.ts';

export type Command =
  | { type: 'placeBuilding'; playerId: number; buildingType: BuildingTypeId; x: number; y: number }
  | { type: 'demolishBuilding'; playerId: number; buildingId: number }
  | { type: 'setBuildingPaused'; playerId: number; buildingId: number; isPaused: boolean }
  | { type: 'setTransportPriority'; playerId: number; good: GoodType; position: number }
  | { type: 'setGoodStored'; playerId: number; good: GoodType; isStored: boolean };

export type CommandResult = { isAccepted: true; buildingId?: number } | { isAccepted: false; reason: string };

/** Share of a building's materials returned when it is demolished. */
export const DEMOLISH_REFUND = 0.5;
const WATER_REACH = 4;

function isKnownBuildingType(value: unknown): value is BuildingTypeId {
  return typeof value === 'string' && Object.hasOwn(BUILDING_TYPES, value);
}

function isKnownGood(value: unknown): value is GoodType {
  return typeof value === 'string' && (GOOD_TYPES as readonly string[]).includes(value);
}

function hasWaterNearby(world: World, x: number, y: number, size: number): boolean {
  for (let ty = y - WATER_REACH; ty < y + size + WATER_REACH; ty++) {
    for (let tx = x - WATER_REACH; tx < x + size + WATER_REACH; tx++) {
      if (inBounds(world, tx, ty) && world.terrain[tileIndex(world, tx, ty)] === TERRAIN_WATER) return true;
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
  const size = type.size;
  const doorX = x + Math.floor(size / 2), doorY = y + size;
  if (!inBounds(world, x, y) || !inBounds(world, x + size - 1, doorY)) return 'Too close to the map edge';
  const owned = playerId + 1;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const i = tileIndex(world, x + dx, y + dy);
      if (world.territory[i] !== owned) return 'Outside your territory';
      if (world.terrain[i] !== TERRAIN_GRASS) return 'Needs flat grassland';
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
  const path = findPath(world, tileIndex(world, castle.doorX, castle.doorY), door, 20_000);
  let k = 0;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) world.footprint[tileIndex(world, x + dx, y + dy)] = saved[k++];
  }
  return path === null ? 'Settlers cannot reach the entrance' : null;
}

function ownBuilding(world: World, playerId: number, buildingId: unknown): Building | null {
  if (!Number.isInteger(buildingId)) return null;
  const b = buildingById(world, buildingId as number);
  return b && b.owner === playerId ? b : null;
}

/** Validates and applies one player command. Invalid commands never change the world. */
export function applyCommand(world: World, command: Command): CommandResult {
  if (!command || typeof command !== 'object') return { isAccepted: false, reason: 'Malformed command' };
  const player = Number.isInteger(command.playerId) ? playerOf(world, command.playerId) : undefined;
  if (!player || !castleOf(world, command.playerId)) return { isAccepted: false, reason: 'Unknown player' };

  switch (command.type) {
    case 'placeBuilding': {
      if (!isKnownBuildingType(command.buildingType)) return { isAccepted: false, reason: 'Unknown building' };
      if (!Number.isInteger(command.x) || !Number.isInteger(command.y)) return { isAccepted: false, reason: 'Invalid position' };
      const problem = placementProblem(world, command.playerId, command.buildingType, command.x, command.y);
      if (problem) return { isAccepted: false, reason: problem };
      const b = newBuilding(world, command.buildingType, command.playerId, command.x, command.y);
      return { isAccepted: true, buildingId: b.id };
    }
    case 'demolishBuilding': {
      const b = ownBuilding(world, command.playerId, command.buildingId);
      if (!b) return { isAccepted: false, reason: 'Unknown building' };
      if (b.typeId === 'castle') return { isAccepted: false, reason: 'The castle cannot be demolished' };
      demolish(world, b);
      return { isAccepted: true };
    }
    case 'setBuildingPaused': {
      const b = ownBuilding(world, command.playerId, command.buildingId);
      if (!b) return { isAccepted: false, reason: 'Unknown building' };
      if (typeof command.isPaused !== 'boolean') return { isAccepted: false, reason: 'Malformed command' };
      b.isPaused = command.isPaused;
      return { isAccepted: true };
    }
    case 'setTransportPriority': {
      if (!isKnownGood(command.good) || !Number.isInteger(command.position)
          || command.position < 0 || command.position >= GOOD_TYPES.length) {
        return { isAccepted: false, reason: 'Malformed command' };
      }
      const order = player.transportPriority.filter((g) => g !== command.good);
      order.splice(command.position, 0, command.good);
      player.transportPriority = order;
      return { isAccepted: true };
    }
    case 'setGoodStored': {
      if (!isKnownGood(command.good) || typeof command.isStored !== 'boolean') return { isAccepted: false, reason: 'Malformed command' };
      player.isStored[command.good] = command.isStored;
      return { isAccepted: true };
    }
  }
  return { isAccepted: false, reason: 'Unknown command' };
}

/** Removes a building, returning half its materials and everything it held to the castle. */
function demolish(world: World, b: Building): void {
  const castle = castleOf(world, b.owner)!;
  const type = BUILDING_TYPES[b.typeId];
  for (const good of GOOD_TYPES) {
    const materials = b.isComplete ? (type.cost[good] ?? 0) : b.delivered[good] + b.built[good];
    castle.stock[good] += Math.floor(materials * DEMOLISH_REFUND) + b.stock[good] + b.input[good];
  }
  removeBuilding(world, b);
  for (const s of world.settlers) releaseFromBuilding(world, s.id, b.id, type.tool);
  recomputeTerritory(world);
  pushMessage(world, `${type.label} demolished`, 'Half of its materials went back to the castle.', false, null);
}

/** Ends any job that depends on a building that no longer exists. */
export function releaseFromBuilding(world: World, settlerId: number, buildingId: number, tool: ToolType | null): void {
  const s = world.settlers.find((settler) => settler.id === settlerId)!;
  if (s.fromId !== buildingId && s.toId !== buildingId && s.homeId !== buildingId) return;
  const castle = castleOf(world, s.owner);
  if (s.phase === 'toPickup' && s.good && s.fromId !== buildingId) {
    const from = buildingById(world, s.fromId);
    if (from) from.reserved[s.good]--;
  }
  if (s.phase === 'toTool' && s.good && s.fromId !== buildingId) {
    const from = buildingById(world, s.fromId);
    if (from) from.reserved[s.good]--;
  }
  if ((s.phase === 'toPickup' || s.phase === 'toDrop') && s.good && s.toId !== buildingId) {
    const to = buildingById(world, s.toId);
    if (to) to.incoming[s.good]--;
  }
  if (s.homeId === buildingId && s.settlerType !== 'carrier' && s.settlerType !== 'builder'
      && s.settlerType !== 'digger' && s.settlerType !== 'soldier') {
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
