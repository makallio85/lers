import { BUILDING_TYPES, GOOD_TYPES } from './definitions.ts';
import type { BuildingTypeId } from './definitions.ts';
import { findPath } from './pathfinding.ts';
import {
  TERRAIN_GRASS, buildingById, castleOf, inBounds, isWalkable, newBuilding, pushMessage, removeBuildingTiles, tileIndex
} from './world.ts';
import type { World } from './world.ts';

export type Command =
  | { type: 'placeBuilding'; playerId: number; buildingType: BuildingTypeId; x: number; y: number }
  | { type: 'cancelConstruction'; playerId: number; buildingId: number };

export type CommandResult = { isAccepted: true; buildingId?: number } | { isAccepted: false; reason: string };

function isKnownBuildingType(value: unknown): value is BuildingTypeId {
  return typeof value === 'string' && Object.hasOwn(BUILDING_TYPES, value);
}

/** Why a building cannot go at (x, y), or null when it can. Shared by the placement ghost and the command. */
export function placementProblem(world: World, playerId: number, buildingType: BuildingTypeId, x: number, y: number): string | null {
  const type = BUILDING_TYPES[buildingType];
  if (type.groupType === null) return 'This building cannot be placed';
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
    }
  }
  const door = tileIndex(world, doorX, doorY);
  if (world.territory[door] !== owned) return 'Outside your territory';
  if (!isWalkable(world, door) || world.door[door] !== 0 || world.tree[door] >= 0) return 'The entrance is blocked';
  const castle = castleOf(world, playerId);
  if (!castle) return 'You have no castle';
  // Temporarily occupy the footprint so the entrance check sees the finished layout.
  const saved: number[] = [];
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const i = tileIndex(world, x + dx, y + dy);
      saved.push(world.footprint[i]);
      world.footprint[i] = -1;
    }
  }
  const path = findPath(world, tileIndex(world, castle.doorX, castle.doorY), door, 20_000);
  let k = 0;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) world.footprint[tileIndex(world, x + dx, y + dy)] = saved[k++];
  }
  if (path === null) return 'Settlers cannot reach the entrance';
  return null;
}

/** Validates and applies one player command. Invalid commands never change the world. */
export function applyCommand(world: World, command: Command): CommandResult {
  if (!command || typeof command !== 'object') return { isAccepted: false, reason: 'Malformed command' };
  if (!Number.isInteger(command.playerId) || !castleOf(world, command.playerId)) {
    return { isAccepted: false, reason: 'Unknown player' };
  }
  if (command.type === 'placeBuilding') {
    if (!isKnownBuildingType(command.buildingType)) return { isAccepted: false, reason: 'Unknown building' };
    if (!Number.isInteger(command.x) || !Number.isInteger(command.y)) return { isAccepted: false, reason: 'Invalid position' };
    const problem = placementProblem(world, command.playerId, command.buildingType, command.x, command.y);
    if (problem) return { isAccepted: false, reason: problem };
    const b = newBuilding(world, command.buildingType, command.playerId, command.x, command.y);
    return { isAccepted: true, buildingId: b.id };
  }
  if (command.type === 'cancelConstruction') {
    const b = buildingById(world, command.buildingId);
    if (!b || b.owner !== command.playerId) return { isAccepted: false, reason: 'Unknown building' };
    if (b.isComplete) return { isAccepted: false, reason: 'Only construction sites can be cancelled' };
    const castle = castleOf(world, command.playerId)!;
    // Materials not yet built in go back to the castle.
    for (const good of GOOD_TYPES) castle.stock[good] += b.delivered[good];
    removeBuildingTiles(world, b);
    world.buildings = world.buildings.filter((other) => other.id !== b.id);
    for (const s of world.settlers) releaseFromBuilding(world, s.id, b.id);
    pushMessage(world, `${BUILDING_TYPES[b.typeId].label} cancelled`, 'Unused materials went back to the castle.', false, null);
    return { isAccepted: true };
  }
  return { isAccepted: false, reason: 'Unknown command' };
}

/** Ends any job that depends on a building that no longer exists. */
function releaseFromBuilding(world: World, settlerId: number, buildingId: number): void {
  const s = world.settlers.find((settler) => settler.id === settlerId)!;
  const touches = s.fromId === buildingId || s.toId === buildingId || s.homeId === buildingId;
  if (!touches) return;
  if (s.fromId !== null && s.fromId !== buildingId && s.phase === 'toPickup' && s.good) {
    const from = buildingById(world, s.fromId);
    if (from) from.reserved[s.good]--;
  }
  if (s.toId !== null && s.toId !== buildingId && s.good) {
    const to = buildingById(world, s.toId);
    if (to) to.incoming[s.good]--;
  }
  s.fromId = null; s.toId = null; s.good = null; s.homeId = null;
  s.path = []; s.timer = 0; s.isInside = false;
  // A carrier holding goods takes them to the castle; everyone else becomes idle.
  s.phase = s.carrying ? 'toStore' : 'idle';
}
