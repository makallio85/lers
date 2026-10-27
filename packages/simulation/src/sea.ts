import {
  BOARDING_RANGE, DONKEY_LOAD, GOOD_TYPES, SETTLER_LABELS, SHIP_COSTS, SHIP_TICKS, SHIP_TYPES, TRADE_SHIP_PILES, TRADE_UNLIMITED, TRANSPORT_CAPACITY,
  isShipType
} from './definitions.ts';
import { TRADE_SHIPS_PER_DOCK, isTrading, unloadAtRouteEnd } from './trade.ts';
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

/** Water bodies smaller than this are lakes: ships are neither built nor berthed on them. */
export const OPEN_SEA_MIN_TILES = 200;

/** Connected bodies of water: a label per tile (0 for land) and each label's size. Cached until the map changes; not saved. */
interface WaterBodies { key: string; labels: Int32Array; sizes: number[] }
const waterCache = new WeakMap<World, WaterBodies>();

function waterBodies(world: World): WaterBodies {
  const key = `${world.mapVersion}:${world.width}`;
  const cached = waterCache.get(world);
  if (cached && cached.key === key) return cached;
  const { width, height } = world;
  const labels = new Int32Array(width * height);
  const sizes = [0];
  const queue = new Int32Array(width * height);
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] !== 0 || world.terrain[start] !== TERRAIN_WATER) continue;
    const label = sizes.length;
    let head = 0, tail = 0;
    labels[start] = label; queue[tail++] = start;
    while (head < tail) {
      const current = queue[head++];
      const cx = current % width, cy = Math.floor(current / width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const i = ny * width + nx;
        if (labels[i] !== 0 || world.terrain[i] !== TERRAIN_WATER) continue;
        labels[i] = label; queue[tail++] = i;
      }
    }
    sizes.push(tail);
  }
  const entry = { key, labels, sizes };
  waterCache.set(world, entry);
  return entry;
}

/** The body of water a tile belongs to (0 for land). */
export function waterBodyOf(world: World, index: number): number {
  return waterBodies(world).labels[index];
}

/** Whether a tile is water of the open sea rather than a lake. */
export function isOpenSea(world: World, index: number): boolean {
  const { labels, sizes } = waterBodies(world);
  return labels[index] !== 0 && sizes[labels[index]] >= OPEN_SEA_MIN_TILES;
}

/** The water tile nearest a point, within a reach, or -1; only tiles of one body of water when given. */
export function nearestWater(world: World, x: number, y: number, reach: number, body = 0): number {
  let best = -1, bestDistance = Infinity;
  for (let ty = Math.floor(y - reach); ty <= Math.ceil(y + reach); ty++) {
    for (let tx = Math.floor(x - reach); tx <= Math.ceil(x + reach); tx++) {
      if (!inBounds(world, tx, ty)) continue;
      const i = tileIndex(world, tx, ty);
      if (world.terrain[i] !== TERRAIN_WATER || (body !== 0 && waterBodyOf(world, i) !== body)) continue;
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

/** Trade ships that work for a landing dock. */
export function shipsOfDock(world: World, dock: Building): Settler[] {
  return world.settlers.filter((s) => s.settlerType === 'trade_ship' && s.homeId === dock.id);
}

/** Where a ship waits at a dock: the water nearest its door on the ship's own sea. */
function berthOf(world: World, dock: Building, ship: Settler): number {
  return nearestWater(world, dock.doorX, dock.doorY, dock.size + 4, waterBodyOf(world, tileIndex(world, Math.round(ship.x), Math.round(ship.y))));
}

/** The open-sea tile nearest a point, within a reach, or -1. */
function nearestOpenSea(world: World, x: number, y: number, reach: number): number {
  let best = -1, bestDistance = Infinity;
  for (let ty = Math.floor(y - reach); ty <= Math.ceil(y + reach); ty++) {
    for (let tx = Math.floor(x - reach); tx <= Math.ceil(x + reach); tx++) {
      if (!inBounds(world, tx, ty)) continue;
      const i = tileIndex(world, tx, ty);
      if (!isOpenSea(world, i)) continue;
      const d = Math.hypot(tx - x, ty - y);
      if (d < bestDistance) { bestDistance = d; best = i; }
    }
  }
  return best;
}

/**
 * One tick of a trade ship. Like a donkey at a marketplace, but at sea: it joins a trading landing dock that
 * needs one, takes up to its people's load of one ordered good (piles of 8), sails the route to the water nearest
 * its end, unloads at the player's storage there, and sails back.
 */
function updateTradeShip(world: World, s: Settler): void {
  const home = world.buildings.find((b) => b.id === s.homeId);
  const isDock = home?.typeId === 'landing_dock';
  switch (s.phase) {
    case 'idle': {
      if (isDock && isTrading(home!)) { s.phase = 'working'; return; }
      if (world.tick % 20 !== s.id % 20) return;
      const dock = world.buildings.filter((b) => b.owner === s.owner && b.typeId === 'landing_dock' && isTrading(b) && shipsOfDock(world, b).length < TRADE_SHIPS_PER_DOCK)
        .sort((a, b) => distance(a.doorX, a.doorY, s.x, s.y) - distance(b.doorX, b.doorY, s.x, s.y))[0];
      const berth = dock ? berthOf(world, dock, s) : -1;
      if (!dock || berth < 0 || !walkTo(world, s, berth, 60_000)) return;
      s.homeId = dock.id; s.phase = 'toWork';
      return;
    }
    case 'toWork':
      if (!isDock) { s.phase = 'idle'; s.path = []; return; }
      if (advance(world, s)) s.phase = 'working';
      return;
    case 'working': {
      if (!isDock || !isTrading(home!)) { s.phase = 'idle'; return; }
      const route = home!.tradeRoute!;
      const capacity = TRADE_SHIP_PILES[playerOf(world, s.owner)?.raceType ?? 'romans'] * DONKEY_LOAD;
      for (const good of GOOD_TYPES) {
        const amount = route.goods[good] ?? 0;
        if (amount === 0 || home!.input[good] <= 0) continue;
        const wanted = Math.min(capacity, amount === TRADE_UNLIMITED ? capacity : amount);
        const load = Math.min(wanted, home!.input[good]);
        if (load < Math.min(wanted, DONKEY_LOAD)) continue;
        const end = nearestWater(world, route.x, route.y, 8, waterBodyOf(world, tileIndex(world, Math.round(s.x), Math.round(s.y))));
        const stops = [...route.waypoints.filter((w) => world.terrain[w] === TERRAIN_WATER), end];
        if (end < 0 || !walkTo(world, s, stops[0], 60_000)) {
          pushMessage(world, s.owner, 'A trade ship cannot get through', 'No open water leads along the sea route.', true, home!.id);
          home!.tradeMode = 'suspended';
          return;
        }
        home!.input[good] -= load;
        if (amount !== TRADE_UNLIMITED) route.goods[good] = amount - load;
        s.carrying = good; s.cargo = load; s.waypoints = stops.slice(1);
        s.phase = 'toTarget';
        return;
      }
      return;
    }
    case 'toTarget': {
      if (!advance(world, s)) return;
      const next = s.waypoints.shift();
      if (next !== undefined && walkTo(world, s, next, 60_000)) return;
      const route = home?.tradeRoute;
      if (route && s.carrying) {
        const left = unloadAtRouteEnd(world, s.owner, route.x, route.y, s.carrying, s.cargo);
        if (left === s.cargo && home) pushMessage(world, s.owner, 'No storage at the end of the sea route', 'The trade ship brings its load back. Build a storage area there.', true, home.id);
        s.cargo = left;
        if (left === 0) s.carrying = null;
      }
      const berth = home ? berthOf(world, home, s) : -1;
      if (berth < 0 || !walkTo(world, s, berth, 60_000)) { s.phase = 'idle'; return; }
      s.phase = 'returning';
      return;
    }
    case 'returning':
      if (!advance(world, s)) return;
      if (home && s.carrying) { home.input[s.carrying] += s.cargo; s.carrying = null; s.cargo = 0; }
      s.phase = 'working';
      return;
    default:
      return;
  }
}

/** One tick of a ship: a trade ship works its dock's route; others sail where sent, passengers riding along. */
export function updateShip(world: World, s: Settler): void {
  if (s.settlerType === 'trade_ship' && s.phase !== 'moving') return updateTradeShip(world, s);
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
  const water = nearestOpenSea(world, home.x + home.size / 2, home.y + home.size / 2, home.size + 4);
  if (water < 0) return;
  home.shipOrders[type] = Math.max(0, (home.shipOrders[type] ?? 0) - 1);
  const ship = newSettler(world, home.owner, type, water % world.width, Math.floor(water / world.width));
  ship.isInside = false; ship.homeId = home.id; ship.phase = 'idle';
  pushMessage(world, home.owner, `${SETTLER_LABELS[type]} ready`, 'It waits off the shipyard for your orders.', false, home.id);
}

export function isShip(s: Settler): s is Settler & { settlerType: ShipType } {
  return isShipType(s.settlerType);
}
