import {
  BOARDING_RANGE, SETTLER_LABELS, SHIP_COSTS, SHIP_TICKS, SHIP_TYPES, TRANSPORT_CAPACITY, isShipType
} from './definitions.ts';
import type { ShipType } from './definitions.ts';
import { advance, distance, walkTo } from './movement.ts';
import { TERRAIN_WATER, inBounds, isWalkable, newSettler, playerOf, pushMessage, tileIndex } from './world.ts';
import type { Building, Settler, World } from './world.ts';

/** Ships sail only on water. */
export function isSeaPassable(world: World, index: number): boolean {
  return world.terrain[index] === TERRAIN_WATER;
}

/** Settlers aboard a ship. */
export function passengersOf(world: World, ship: Settler): Settler[] {
  return world.settlers.filter((s) => s.shipId === ship.id);
}

/** The water tile nearest a point, within a reach, or -1. */
export function nearestWater(world: World, x: number, y: number, reach: number): number {
  let best = -1, bestDistance = Infinity;
  for (let ty = Math.floor(y - reach); ty <= Math.ceil(y + reach); ty++) {
    for (let tx = Math.floor(x - reach); tx <= Math.ceil(x + reach); tx++) {
      if (!inBounds(world, tx, ty)) continue;
      const i = tileIndex(world, tx, ty);
      if (world.terrain[i] !== TERRAIN_WATER) continue;
      const d = Math.hypot(tx - x, ty - y);
      if (d < bestDistance) { bestDistance = d; best = i; }
    }
  }
  return best;
}

/** Walkable land tiles near a ship, nearest first, where its passengers can step ashore. */
function shoreTiles(world: World, ship: Settler, count: number): number[] {
  const tiles: { i: number; d: number }[] = [];
  for (let ty = Math.floor(ship.y - BOARDING_RANGE); ty <= Math.ceil(ship.y + BOARDING_RANGE); ty++) {
    for (let tx = Math.floor(ship.x - BOARDING_RANGE); tx <= Math.ceil(ship.x + BOARDING_RANGE); tx++) {
      if (!inBounds(world, tx, ty)) continue;
      const i = tileIndex(world, tx, ty);
      if (isWalkable(world, i)) tiles.push({ i, d: Math.hypot(tx - ship.x, ty - ship.y) });
    }
  }
  return tiles.sort((a, b) => a.d - b.d || a.i - b.i).slice(0, count).map((t) => t.i);
}

/** Why units cannot board this ship now, or null when they can. */
export function boardingProblem(world: World, ship: Settler, units: readonly Settler[]): string | null {
  if (ship.settlerType !== 'transport_ship') return 'Only transport ships carry settlers';
  const race = playerOf(world, ship.owner)?.raceType ?? 'romans';
  const room = TRANSPORT_CAPACITY[race] - passengersOf(world, ship).length;
  if (units.length > room) return `Room for ${room} more aboard`;
  if (units.some((u) => distance(u.x, u.y, ship.x, ship.y) > BOARDING_RANGE + 0.5)) return `Bring them to the shore within ${BOARDING_RANGE} tiles of the ship`;
  return null;
}

/** Takes units aboard; they travel hidden with the ship. */
export function board(world: World, ship: Settler, units: readonly Settler[]): void {
  for (const u of units) {
    u.shipId = ship.id; u.isInside = true; u.phase = 'inside'; u.path = []; u.waypoints = [];
    u.homeId = null; u.attackId = null; u.enemyId = null; u.isPatrolling = false; u.isHolding = false;
    u.x = ship.x; u.y = ship.y; u.prevX = u.x; u.prevY = u.y;
  }
}

/** Puts a ship's passengers ashore on the land next to it; null when they landed, or why not. */
export function unload(world: World, ship: Settler): string | null {
  const aboard = passengersOf(world, ship);
  if (aboard.length === 0) return 'Nobody is aboard';
  const tiles = shoreTiles(world, ship, aboard.length);
  if (tiles.length === 0) return `Sail within ${BOARDING_RANGE} tiles of land first`;
  aboard.forEach((u, k) => {
    const i = tiles[k % tiles.length];
    u.shipId = null; u.isInside = false; u.phase = 'idle';
    u.x = i % world.width; u.y = Math.floor(i / world.width); u.prevX = u.x; u.prevY = u.y;
  });
  return null;
}

/** One tick of a ship: sail its route; passengers ride along. */
export function updateShip(world: World, s: Settler): void {
  if (s.phase === 'moving' && advance(world, s)) {
    const next = s.waypoints.shift();
    if (next === undefined || !walkTo(world, s, next, 40_000)) { s.phase = 'idle'; s.waypoints = []; }
  }
  for (const p of world.settlers) if (p.shipId === s.id) { p.x = s.x; p.y = s.y; p.prevX = s.prevX; p.prevY = s.prevY; }
}

/** A shipbuilder builds the next ordered ship once its planks and iron are in. */
export function decideShip(world: World, s: Settler, home: Building): string | null {
  const race = playerOf(world, home.owner)?.raceType ?? 'romans';
  const next = SHIP_TYPES.find((t) => (home.shipOrders[t] ?? 0) > 0);
  if (!next) return 'No ship ordered';
  const cost = SHIP_COSTS[next][race];
  if (home.input.plank < cost.plank || home.input.iron < cost.iron) return `Waiting: no ${home.input.plank < cost.plank ? 'planks' : 'iron'}`;
  home.input.plank -= cost.plank; home.input.iron -= cost.iron;
  home.shipInProgress = next;
  s.good = null;
  s.phase = 'working'; s.timer = SHIP_TICKS;
  return null;
}

/** Launches the finished ship on the water nearest the yard. */
export function launchShip(world: World, home: Building): void {
  const type = home.shipInProgress;
  home.shipInProgress = null;
  if (!type) return;
  const water = nearestWater(world, home.x + home.size / 2, home.y + home.size / 2, home.size + 4);
  if (water < 0) return;
  home.shipOrders[type] = Math.max(0, (home.shipOrders[type] ?? 0) - 1);
  const ship = newSettler(world, home.owner, type, water % world.width, Math.floor(water / world.width));
  ship.isInside = false; ship.homeId = home.id; ship.phase = 'idle';
  pushMessage(world, home.owner, `${SETTLER_LABELS[type]} ready`, 'It waits off the shipyard for your orders.', false, home.id);
}

export function isShip(s: Settler): s is Settler & { settlerType: ShipType } {
  return isShipType(s.settlerType);
}
