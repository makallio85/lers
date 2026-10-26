import { WAR_MACHINE_SPEED_SHARE, isSpecialistType, isUnitType, isWarMachineType } from './definitions.ts';
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
  const passable = isWarMachineType(s.settlerType) ? isMachinePassable
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
  let budget = isWarMachineType(s.settlerType) ? speed * WAR_MACHINE_SPEED_SHARE : speed;
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
