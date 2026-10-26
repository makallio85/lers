import { SHIP_SPEED_SHARE, WAR_MACHINE_SPEED_SHARE, isShipType, isSpecialistType, isUnitType, isWarMachineType } from './definitions.ts';
import { isSeaPassable } from './sea.ts';
import type { SettlerType } from './definitions.ts';
import { findPath } from './pathfinding.ts';
import { TERRAIN_MOUNTAIN, isWalkable, tileIndex } from './world.ts';
import type { Building, Settler, World } from './world.ts';

/** Tiles per tick: 2.2 tiles a second, as settlers walk in The Settlers III. */
export const WALK_SPEED = 0.22;

export function tileOf(world: World, s: Settler): number {
  return tileIndex(world, Math.round(s.x), Math.round(s.y));
}

export function doorTile(world: World, b: Building): number {
  return tileIndex(world, b.doorX, b.doorY);
}

/** Searches at most `maxVisited` tiles: short local trips pass a small limit so unreachable targets fail fast. */
export function walkTo(world: World, s: Settler, goal: number, maxVisited = 12_000): boolean {
  const start = tileOf(world, s);
  const passable = isShipType(s.settlerType) ? isSeaPassable : isWarMachineType(s.settlerType) ? isMachinePassable
    // Civilians keep to their own land; one standing outside it (its land was lost) may walk back in.
    : isCivilianType(s.settlerType) && world.territory[start] === s.owner + 1 ? (w: World, i: number) => w.territory[i] === s.owner + 1 && isWalkable(w, i)
    : isWalkable;
  const path = findPath(world, start, goal, maxVisited, passable);
  if (path === null) return false;
  s.path = path;
  s.isInside = false;
  return true;
}

/** Civilians stay on their own land, as in the original; soldiers, specialists, priests and donkeys may leave it. */
export function isCivilianType(type: SettlerType): boolean {
  return !isUnitType(type) && !isSpecialistType(type) && type !== 'priest' && type !== 'donkey';
}

/** War machines need open ground: as in the original, they cannot cross forest, rocks or mountains. */
export function isMachinePassable(world: World, index: number): boolean {
  return isWalkable(world, index) && world.tree[index] < 0 && world.terrain[index] !== TERRAIN_MOUNTAIN;
}

/** Moves along the path; true once the settler has arrived. War machines go slower. */
export function advance(world: World, s: Settler, speed = WALK_SPEED): boolean {
  let budget = isWarMachineType(s.settlerType) ? speed * WAR_MACHINE_SPEED_SHARE : isShipType(s.settlerType) ? speed * SHIP_SPEED_SHARE : speed;
  while (budget > 0 && s.path.length > 0) {
    const next = s.path[0];
    const tx = next % world.width, ty = Math.floor(next / world.width);
    const dx = tx - s.x, dy = ty - s.y;
    const d = Math.hypot(dx, dy);
    if (d <= budget) {
      s.x = tx; s.y = ty; budget -= d;
      s.path.shift();
    } else {
      s.x += (dx / d) * budget; s.y += (dy / d) * budget;
      budget = 0;
    }
  }
  return s.path.length === 0;
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** How often standing settlers make room for each other, in ticks. */
const SPREAD_TICKS = 5;

/**
 * Settlers standing still keep a tile each. A soldier, war machine, specialist or priest standing on a tile another
 * standing one already holds, or in front of a building's door, steps to the nearest free tile next to it. The
 * one with the lower id keeps its place, so every player sees the same.
 */
export function spreadStanding(world: World): void {
  if (world.tick % SPREAD_TICKS !== 0) return;
  const isStanding = (s: Settler) => !s.isInside && s.phase === 'idle' && s.path.length === 0 && s.waypoints.length === 0 && !s.isPatrolling
    && !isShipType(s.settlerType) && (isUnitType(s.settlerType) ? s.health > 0 : isSpecialistType(s.settlerType) || s.settlerType === 'priest');
  const standing = world.settlers.filter(isStanding).sort((a, b) => a.id - b.id);
  const taken = new Set<number>();
  const crowded: Settler[] = [];
  for (const s of standing) {
    const i = tileOf(world, s);
    if (taken.has(i) || world.door[i] !== 0) crowded.push(s);
    else taken.add(i);
  }
  for (const s of crowded) {
    const sx = Math.round(s.x), sy = Math.round(s.y);
    let best = -1, bestDistance = Infinity;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = sx + dx, y = sy + dy;
        if ((dx === 0 && dy === 0) || x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
        const i = tileIndex(world, x, y);
        if (taken.has(i) || world.door[i] !== 0 || !isWalkable(world, i)) continue;
        // Civilians keep to their own land; war machines to open ground.
        if (isCivilianType(s.settlerType) && world.territory[i] !== s.owner + 1) continue;
        if (isWarMachineType(s.settlerType) && !isMachinePassable(world, i)) continue;
        const d = Math.hypot(dx, dy);
        if (d < bestDistance) { bestDistance = d; best = i; }
      }
    }
    if (best < 0 || !walkTo(world, s, best, 200)) { taken.add(tileOf(world, s)); continue; }
    taken.add(best);
    s.phase = 'moving';
  }
}
