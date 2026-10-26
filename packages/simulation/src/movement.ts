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

/**
 * The nearest free tile a settler can step to, found by walking outward from it (so a crowd in an alley between
 * buildings finds the open ground beyond, not a tile behind a wall): walkable, out of doorways, not taken, on its
 * own land for a civilian, open ground for a war machine. -1 within 12 steps.
 */
function nearestFreeTile(world: World, s: Settler, taken: ReadonlySet<number>): number {
  const { width, height } = world;
  const start = tileOf(world, s);
  const canStep = (i: number) => isWalkable(world, i) && (!isCivilianType(s.settlerType) || world.territory[i] === s.owner + 1)
    && (!isWarMachineType(s.settlerType) || isMachinePassable(world, i));
  // Caught inside a footprint (a building put up where it stood): it may search through the building to get out.
  const isTrapped = !isWalkable(world, start);
  const seen = new Map<number, number>([[start, 0]]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head], depth = seen.get(current)!;
    if (current !== start && !taken.has(current) && world.door[current] === 0 && canStep(current)) return current;
    if (depth >= 12) continue;
    const cx = current % width, cy = Math.floor(current / width);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const i = y * width + x;
      // Doorways may be crossed, not stood in; a settler standing inside a footprint may step out of it.
      if (seen.has(i) || !(canStep(i) || world.door[i] !== 0 || (isTrapped && world.footprint[i] !== 0))) continue;
      seen.set(i, depth + 1); queue.push(i);
    }
  }
  return -1;
}

/** How often standing settlers make room for each other, in ticks. */
const SPREAD_TICKS = 5;

/**
 * Settlers standing still keep a tile each: soldiers, war machines, specialists, priests and idle civilians waiting
 * for work. One standing on a tile another holds, in a doorway, or where a building has since been put up steps to
 * the nearest free tile. Units keep their place before civilians, then the lower id, so every player sees the same.
 */
export function spreadStanding(world: World): void {
  if (world.tick % SPREAD_TICKS !== 0) return;
  // Anyone at work outside (a fisher at the shore, a woodcutter at a tree) whose tile a building was since put up on
  // steps out of the footprint to the nearest free tile, and carries on with what it was doing.
  for (const s of world.settlers) {
    if (s.isInside || s.path.length > 0 || isShipType(s.settlerType) || world.footprint[tileOf(world, s)] === 0) continue;
    if (s.phase === 'idle') continue;
    const out = nearestFreeTile(world, s, new Set());
    if (out >= 0) { s.x = out % world.width; s.y = Math.floor(out / world.width); s.prevX = s.x; s.prevY = s.y; }
  }
  // Everyone standing about: soldiers and machines, specialists, priests, and idle civilians waiting for a job.
  const isStanding = (s: Settler) => !s.isInside && s.phase === 'idle' && s.path.length === 0 && s.waypoints.length === 0 && !s.isPatrolling
    && !isShipType(s.settlerType) && s.settlerType !== 'donkey' && (!isUnitType(s.settlerType) || s.health > 0) && s.carrying === null;
  // Units keep where they were sent; idle civilians make room for them. Among equals the lower id keeps its tile.
  const isCivilianStanding = (s: Settler) => !isUnitType(s.settlerType) && !isSpecialistType(s.settlerType) && s.settlerType !== 'priest';
  const standing = world.settlers.filter(isStanding).sort((a, b) => Number(isCivilianStanding(a)) - Number(isCivilianStanding(b)) || a.id - b.id);
  const taken = new Set<number>();
  const crowded: Settler[] = [];
  for (const s of standing) {
    const i = tileOf(world, s);
    if (taken.has(i) || world.door[i] !== 0 || !isWalkable(world, i)) crowded.push(s);
    else taken.add(i);
  }
  for (const s of crowded) {
    const best = nearestFreeTile(world, s, taken);
    if (best < 0) { taken.add(tileOf(world, s)); continue; }
    // A building put up where it stood: it steps straight out to the free tile beside it.
    if (!isWalkable(world, tileOf(world, s))) {
      s.x = best % world.width; s.y = Math.floor(best / world.width); s.prevX = s.x; s.prevY = s.y;
      taken.add(best);
      continue;
    }
    if (!walkTo(world, s, best, 4000)) { taken.add(tileOf(world, s)); continue; }
    taken.add(best);
    // Units walk under their own orders; an idle civilian simply follows its path while it waits.
    if (isUnitType(s.settlerType) || isSpecialistType(s.settlerType) || s.settlerType === 'priest') s.phase = 'moving';
  }
}
