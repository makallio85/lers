import {
  DONKEYS_PER_MARKETPLACE, DONKEY_LOAD, DONKEY_TICKS, GOOD_TYPES, TRADE_UNLIMITED, TRADE_UNLOAD_RADIUS
} from './definitions.ts';
import type { GoodType } from './definitions.ts';
import { advance, distance, doorTile, walkTo } from './movement.ts';
import { buildingById, isStorageBuilding, newSettler, pushMessage, siteCost, tileIndex } from './world.ts';
import type { Building, Settler, World } from './world.ts';

/** Donkeys that belong to a building (a ranch that raised them, or the marketplace they work for). */
export function donkeysOf(world: World, b: Building): Settler[] {
  return world.settlers.filter((s) => s.settlerType === 'donkey' && s.homeId === b.id && s.owner === b.owner);
}

/** Whether a marketplace's caravans (or a landing dock's trade ships) run: it stands, has a route, and the route is not suspended. */
export function isTrading(b: Building): boolean {
  return (b.typeId === 'marketplace' || b.typeId === 'landing_dock') && b.isComplete && b.tradeRoute !== null && b.tradeMode !== 'suspended';
}

/** Trade ships a landing dock works with. */
export const TRADE_SHIPS_PER_DOCK = 3;

/** What a marketplace still asks carriers for, per good: enough for two loads, or what the order has left. */
export function marketplaceWants(b: Building): Partial<Record<GoodType, number>> {
  const wants: Partial<Record<GoodType, number>> = {};
  if (!isTrading(b)) return wants;
  for (const good of GOOD_TYPES) {
    const amount = b.tradeRoute!.goods[good] ?? 0;
    if (amount === 0) continue;
    // A dock gathers a ship's whole load; a marketplace two donkeys' worth.
    const buffer = b.typeId === 'landing_dock' ? DONKEY_LOAD * 4 : DONKEY_LOAD * 2;
    const target = amount === TRADE_UNLIMITED ? buffer : Math.min(amount, buffer);
    const need = target - b.input[good] - b.incoming[good];
    if (need > 0) wants[good] = need;
  }
  return wants;
}

/** A breeder raises a donkey from one grain and one water while the ranch has fewer than a marketplace needs. */
export function decideBreeding(world: World, s: Settler, home: Building): string | null {
  if (donkeysOf(world, home).length >= DONKEYS_PER_MARKETPLACE) return 'Donkeys are waiting for a marketplace';
  if (home.input.grain <= 0 || home.input.water <= 0) return `Waiting: no ${home.input.grain <= 0 ? 'grain' : 'water'}`;
  home.input.grain--; home.input.water--;
  s.good = null;
  s.phase = 'working'; s.timer = DONKEY_TICKS;
  return null;
}

export function finishBreeding(world: World, home: Building): void {
  const donkey = newSettler(world, home.owner, 'donkey', home.doorX, home.doorY);
  donkey.isInside = false; donkey.homeId = home.id; donkey.phase = 'idle';
}

/** The player's storage nearest the end of a route, within reach of it. */
export function storageAtRouteEnd(world: World, owner: number, x: number, y: number): Building | null {
  let best: Building | null = null, bestDistance = TRADE_UNLOAD_RADIUS;
  for (const b of world.buildings) {
    if (b.owner !== owner || !b.isComplete || !isStorageBuilding(b)) continue;
    const d = distance(b.doorX, b.doorY, x, y);
    if (d <= bestDistance) { bestDistance = d; best = b; }
  }
  return best;
}

/**
 * Unloads a load at a route's end: into the player's storage there, else into the construction site there
 * that still needs this good (how a colony's first storage gets its planks and stone). Returns what is left.
 */
export function unloadAtRouteEnd(world: World, owner: number, x: number, y: number, good: GoodType, amount: number): number {
  const store = storageAtRouteEnd(world, owner, x, y);
  if (store) { store.stock[good] += amount; return 0; }
  let site: Building | null = null, need = 0, bestDistance = TRADE_UNLOAD_RADIUS;
  for (const b of world.buildings) {
    if (b.owner !== owner || b.isComplete) continue;
    const owed = (siteCost(world, b)[good] ?? 0) - b.delivered[good] - b.built[good] - b.incoming[good];
    const d = distance(b.doorX, b.doorY, x, y);
    if (owed > 0 && d <= bestDistance) { bestDistance = d; site = b; need = owed; }
  }
  if (!site) return amount;
  const taken = Math.min(amount, need);
  site.delivered[good] += taken;
  return amount - taken;
}

/**
 * One tick of a donkey. A donkey at its ranch joins a trading marketplace that needs one. At the marketplace it
 * takes up to 8 of one ordered good, walks the route (across any land) to the storage at its end, unloads, and
 * comes back. A route without storage at its end sends it back with its load.
 */
export function updateDonkey(world: World, s: Settler): void {
  const home = buildingById(world, s.homeId);
  switch (s.phase) {
    case 'idle': {
      if (home && home.typeId === 'marketplace' && isTrading(home)) { s.phase = 'working'; return; }
      if (world.tick % 20 !== s.id % 20) return;
      let best: Building | null = null, bestDistance = Infinity;
      for (const b of world.buildings) {
        if (b.owner !== s.owner || !isTrading(b) || donkeysOf(world, b).length >= DONKEYS_PER_MARKETPLACE) continue;
        const d = distance(b.doorX, b.doorY, s.x, s.y);
        if (d < bestDistance) { bestDistance = d; best = b; }
      }
      if (!best || !walkTo(world, s, doorTile(world, best), 40_000)) return;
      s.homeId = best.id; s.phase = 'toWork';
      return;
    }
    case 'toWork':
      if (!home || home.typeId !== 'marketplace') { s.phase = 'idle'; s.path = []; return; }
      if (advance(world, s)) s.phase = 'working';
      return;
    case 'working': {
      if (!home || !isTrading(home)) { s.phase = 'idle'; return; }
      const route = home.tradeRoute!;
      for (const good of GOOD_TYPES) {
        const amount = route.goods[good] ?? 0;
        if (amount === 0 || home.input[good] <= 0) continue;
        const load = Math.min(DONKEY_LOAD, home.input[good], amount === TRADE_UNLIMITED ? DONKEY_LOAD : amount);
        // Wait for a full load unless the order has less than that left.
        if (load < Math.min(DONKEY_LOAD, amount === TRADE_UNLIMITED ? DONKEY_LOAD : amount)) continue;
        const stops = [...route.waypoints, tileIndex(world, route.x, route.y)];
        if (!walkTo(world, s, stops[0], 40_000)) {
          pushMessage(world, s.owner, 'A caravan cannot get through', 'Nothing walkable leads along the trade route.', true, home.id);
          home.tradeMode = 'suspended';
          return;
        }
        home.input[good] -= load;
        if (amount !== TRADE_UNLIMITED) route.goods[good] = amount - load;
        s.carrying = good; s.cargo = load; s.waypoints = stops.slice(1);
        s.phase = 'toTarget';
        return;
      }
      return;
    }
    case 'toTarget': {
      if (!advance(world, s)) return;
      if (s.waypoints.length > 0) {
        const next = s.waypoints.shift()!;
        if (walkTo(world, s, next, 40_000)) return;
      }
      const route = home?.tradeRoute;
      if (route && s.carrying) {
        const left = unloadAtRouteEnd(world, s.owner, route.x, route.y, s.carrying, s.cargo);
        if (left === s.cargo && home) pushMessage(world, s.owner, 'No storage at the end of the trade route', 'The caravan brings its load back. Build a storage area there.', true, home.id);
        s.cargo = left;
        if (left === 0) s.carrying = null;
      }
      if (!home || !walkTo(world, s, doorTile(world, home), 40_000)) { s.phase = 'idle'; return; }
      s.phase = 'returning';
      return;
    }
    case 'returning':
      if (!advance(world, s)) return;
      if (home && s.carrying) { home.input[s.carrying] += s.cargo; s.carrying = null; s.cargo = 0; }
      s.phase = 'working';
      return;
    default:
      s.phase = 'idle';
  }
}
