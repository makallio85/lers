import { findPath } from './pathfinding.ts';
import { tileIndex } from './world.ts';
import type { Building, Settler, World } from './world.ts';

/** Tiles per tick (2.5 tiles per second). */
export const WALK_SPEED = 0.25;

export function tileOf(world: World, s: Settler): number {
  return tileIndex(world, Math.round(s.x), Math.round(s.y));
}

export function doorTile(world: World, b: Building): number {
  return tileIndex(world, b.doorX, b.doorY);
}

/** Searches at most `maxVisited` tiles: short local trips pass a small limit so unreachable targets fail fast. */
export function walkTo(world: World, s: Settler, goal: number, maxVisited = 12_000): boolean {
  const path = findPath(world, tileOf(world, s), goal, maxVisited);
  if (path === null) return false;
  s.path = path;
  s.isInside = false;
  return true;
}

/** Moves along the path; true once the settler has arrived. */
export function advance(world: World, s: Settler, speed = WALK_SPEED): boolean {
  let budget = speed;
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
