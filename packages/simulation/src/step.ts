import { BUILDING_TYPES, GOOD_TYPES, SETTLER_LABELS, costTotal } from './definitions.ts';
import type { GoodType } from './definitions.ts';
import { applyCommand } from './commands.ts';
import type { Command, CommandResult } from './commands.ts';
import { findPath } from './pathfinding.ts';
import {
  NO_TREE, SETTLER_LIMIT, TERRAIN_GRASS, TREE_MATURE,
  buildingById, castleOf, inBounds, newSettler, pushMessage, tileIndex
} from './world.ts';
import type { Building, Settler, World } from './world.ts';

/** Tiles per tick (2.5 tiles per second). */
export const WALK_SPEED = 0.25;
export const OUTPUT_LIMIT = 6;
export const SAWMILL_INPUT_LIMIT = 4;
export const WARN_AFTER_TICKS = 150;
export const CARRIER_SPAWN_TICKS = 200;

const BUILD_TICKS_PER_GOOD = 60;
const IDLE_BEFORE_GOING_HOME = 30;

const WORK_TICKS = { woodcutter: 30, stonecutter: 40, forester: 20, carpenter: 50 } as const;
const SEARCH_RADIUS = { woodcutter: 10, stonecutter: 10, forester: 6 } as const;
const REST_TICKS = { woodcutter: 10, stonecutter: 10, forester: 50, carpenter: 5 } as const;

/** Advances the world by one fixed tick after applying the given commands in order. */
export function step(world: World, commands: readonly Command[] = []): CommandResult[] {
  const results = commands.map((command) => applyCommand(world, command));
  for (const s of world.settlers) { s.prevX = s.x; s.prevY = s.y; }
  if (world.tick % 10 === 0) growTrees(world);
  if (world.tick % CARRIER_SPAWN_TICKS === 0 && world.tick > 0) spawnCarriers(world);
  if (world.tick % 5 === 0) runLogistics(world);
  assignBuilders(world);
  assignWorkers(world);
  for (const s of world.settlers) updateSettler(world, s);
  warnAboutBlockedBuildings(world);
  world.tick++;
  return results;
}

function growTrees(world: World): void {
  const { tree } = world;
  for (let i = 0; i < tree.length; i++) {
    if (tree[i] >= 0 && tree[i] < TREE_MATURE) {
      tree[i]++;
      if (tree[i] === TREE_MATURE) world.mapVersion++;
    }
  }
}

function spawnCarriers(world: World): void {
  for (const castle of world.buildings) {
    if (castle.typeId !== 'castle') continue;
    const owned = world.settlers.filter((s) => s.owner === castle.owner).length;
    if (owned < SETTLER_LIMIT) newSettler(world, castle.owner, 'carrier', castle.doorX, castle.doorY);
  }
}

// ---------------------------------------------------------------- helpers

function tileOf(world: World, s: Settler): number {
  return tileIndex(world, Math.round(s.x), Math.round(s.y));
}

function doorTile(world: World, b: Building): number {
  return tileIndex(world, b.doorX, b.doorY);
}

function walkTo(world: World, s: Settler, goal: number): boolean {
  const path = findPath(world, tileOf(world, s), goal);
  if (path === null) return false;
  s.path = path;
  s.isInside = false;
  return true;
}

/** Moves along the path; true once the settler has arrived. */
function advance(world: World, s: Settler): boolean {
  let budget = WALK_SPEED;
  while (budget > 0 && s.path.length > 0) {
    const next = s.path[0];
    const tx = next % world.width, ty = Math.floor(next / world.width);
    const dx = tx - s.x, dy = ty - s.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= budget) {
      s.x = tx; s.y = ty; budget -= distance;
      s.path.shift();
    } else {
      s.x += (dx / distance) * budget; s.y += (dy / distance) * budget;
      budget = 0;
    }
  }
  return s.path.length === 0;
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function setBlocked(world: World, b: Building, reason: string | null): void {
  if (reason === b.blockedReason) return;
  b.blockedReason = reason;
  b.blockedSince = reason === null ? null : world.tick;
  if (reason === null) b.hasWarned = false;
}

function isIdleCarrier(s: Settler): boolean {
  return s.settlerType === 'carrier' && s.phase === 'idle' && s.carrying === null;
}

function becomeIdle(s: Settler): void {
  s.phase = 'idle';
  s.timer = IDLE_BEFORE_GOING_HOME;
  s.fromId = null; s.toId = null; s.good = null; s.homeId = null; s.path = [];
}

// ---------------------------------------------------------------- logistics

interface Request { building: Building; good: GoodType; priority: number }

/**
 * Matches goods that are needed (construction sites, workshop inputs) with goods on offer (castle
 * stock, finished output) and sends the nearest idle carrier. Surplus output goes to the castle.
 */
function runLogistics(world: World): void {
  const carriers = world.settlers.filter(isIdleCarrier);
  if (carriers.length === 0) return;
  const requests: Request[] = [];
  for (const b of world.buildings) {
    if (!b.isComplete) {
      const cost = BUILDING_TYPES[b.typeId].cost;
      for (const good of GOOD_TYPES) {
        const need = (cost[good] ?? 0) - b.delivered[good] - b.built[good] - b.incoming[good];
        for (let k = 0; k < need; k++) requests.push({ building: b, good, priority: 0 });
      }
    } else if (b.typeId === 'sawmill') {
      const need = SAWMILL_INPUT_LIMIT - b.input.log - b.incoming.log;
      for (let k = 0; k < need; k++) requests.push({ building: b, good: 'log', priority: 1 });
    }
  }
  requests.sort((a, b) => a.priority - b.priority || a.building.id - b.building.id);

  const take = (from: Building, to: Building, good: GoodType): boolean => {
    let best = -1, bestDistance = Infinity;
    for (let k = 0; k < carriers.length; k++) {
      const d = distance(carriers[k].x, carriers[k].y, from.doorX, from.doorY);
      if (d < bestDistance) { bestDistance = d; best = k; }
    }
    if (best < 0) return false;
    const s = carriers[best];
    if (!walkTo(world, s, doorTile(world, from))) return false;
    carriers.splice(best, 1);
    s.phase = 'toPickup'; s.fromId = from.id; s.toId = to.id; s.good = good;
    from.reserved[good]++;
    to.incoming[good]++;
    return true;
  };

  for (const request of requests) {
    if (carriers.length === 0) return;
    const to = request.building;
    let from: Building | null = null, fromDistance = Infinity;
    for (const b of world.buildings) {
      if (b === to || !b.isComplete || b.owner !== to.owner) continue;
      if (b.stock[request.good] - b.reserved[request.good] <= 0) continue;
      const d = distance(b.doorX, b.doorY, to.doorX, to.doorY);
      if (d < fromDistance) { fromDistance = d; from = b; }
    }
    if (from) take(from, to, request.good);
  }

  for (const b of world.buildings) {
    if (!b.isComplete || b.typeId === 'castle') continue;
    const castle = castleOf(world, b.owner);
    if (!castle) continue;
    for (const good of GOOD_TYPES) {
      while (b.stock[good] - b.reserved[good] > 0) {
        if (carriers.length === 0 || !take(b, castle, good)) return;
      }
    }
  }
}

// ---------------------------------------------------------------- builders and workers

function assignBuilders(world: World): void {
  for (const site of world.buildings) {
    if (site.isComplete || site.builderId !== null) continue;
    let best: Settler | null = null, bestDistance = Infinity;
    for (const s of world.settlers) {
      if (s.settlerType !== 'builder' || s.phase !== 'idle' || s.owner !== site.owner) continue;
      const d = distance(s.x, s.y, site.doorX, site.doorY);
      if (d < bestDistance) { bestDistance = d; best = s; }
    }
    if (!best || !walkTo(world, best, doorTile(world, site))) continue;
    best.phase = 'toSite';
    best.homeId = site.id;
    site.builderId = best.id;
  }
}

function assignWorkers(world: World): void {
  for (const b of world.buildings) {
    const workerType = BUILDING_TYPES[b.typeId].worker;
    if (!b.isComplete || workerType === null || b.workerId !== null) continue;
    let best: Settler | null = null, bestDistance = Infinity;
    for (const s of world.settlers) {
      if (!isIdleCarrier(s) || s.owner !== b.owner) continue;
      const d = distance(s.x, s.y, b.doorX, b.doorY);
      if (d < bestDistance) { bestDistance = d; best = s; }
    }
    if (!best || !walkTo(world, best, doorTile(world, b))) {
      setBlocked(world, b, 'Waiting for a free settler');
      continue;
    }
    best.settlerType = workerType;
    best.phase = 'toWork';
    best.homeId = b.id;
    b.workerId = best.id;
    setBlocked(world, b, null);
  }
}

// ---------------------------------------------------------------- settler behaviour

function updateSettler(world: World, s: Settler): void {
  switch (s.phase) {
    case 'idle': return updateIdle(world, s);
    case 'toStore': return updateToStore(world, s);
    case 'toPickup': return updatePickup(world, s);
    case 'toDrop': return updateDrop(world, s);
    case 'toSite': if (advance(world, s)) s.phase = 'building'; return;
    case 'building': return updateBuilding(world, s);
    default: return updateWorker(world, s);
  }
}

function updateIdle(world: World, s: Settler): void {
  if (s.isInside) return;
  if (s.timer > 0) { s.timer--; return; }
  const castle = castleOf(world, s.owner);
  if (!castle) return;
  if (s.path.length === 0 && !walkTo(world, s, doorTile(world, castle))) return;
  if (advance(world, s)) s.isInside = true;
}

function updateToStore(world: World, s: Settler): void {
  const castle = castleOf(world, s.owner);
  if (!castle) return;
  if (s.path.length === 0 && tileOf(world, s) !== doorTile(world, castle) && !walkTo(world, s, doorTile(world, castle))) return;
  if (!advance(world, s)) return;
  if (s.carrying) castle.stock[s.carrying]++;
  s.carrying = null;
  becomeIdle(s);
  s.isInside = true;
}

function updatePickup(world: World, s: Settler): void {
  if (!advance(world, s)) return;
  const from = buildingById(world, s.fromId);
  const to = buildingById(world, s.toId);
  const good = s.good!;
  if (!from || !to) {
    if (from) from.reserved[good]--;
    if (to) to.incoming[good]--;
    becomeIdle(s);
    return;
  }
  from.reserved[good]--;
  from.stock[good]--;
  s.carrying = good;
  if (!walkTo(world, s, doorTile(world, to))) {
    to.incoming[good]--;
    s.phase = 'toStore'; s.fromId = null; s.toId = null; s.good = null;
    return;
  }
  s.phase = 'toDrop';
}

function updateDrop(world: World, s: Settler): void {
  if (!advance(world, s)) return;
  const to = buildingById(world, s.toId);
  const good = s.carrying!;
  if (!to) { s.phase = 'toStore'; s.toId = null; s.fromId = null; s.good = null; return; }
  to.incoming[good]--;
  if (!to.isComplete) to.delivered[good]++;
  else if (to.typeId === 'castle') to.stock[good]++;
  else to.input[good]++;
  s.carrying = null;
  becomeIdle(s);
}

function updateBuilding(world: World, s: Settler): void {
  const site = buildingById(world, s.homeId);
  if (!site || site.isComplete) { becomeIdle(s); return; }
  const total = costTotal(BUILDING_TYPES[site.typeId].cost);
  const builtCount = () => site.built.log + site.built.plank + site.built.stone;
  const onSite = GOOD_TYPES.find((good) => site.delivered[good] > 0);
  if (onSite) {
    s.timer++;
    site.buildProgress = (builtCount() + s.timer / BUILD_TICKS_PER_GOOD) / total;
    if (s.timer >= BUILD_TICKS_PER_GOOD) { s.timer = 0; site.delivered[onSite]--; site.built[onSite]++; }
    setBlocked(world, site, null);
  } else if (builtCount() < total) {
    setBlocked(world, site, 'Waiting for building materials');
  }
  if (builtCount() >= total) {
    site.isComplete = true;
    site.buildProgress = 1;
    site.builderId = null;
    setBlocked(world, site, null);
    world.mapVersion++;
    const type = BUILDING_TYPES[site.typeId];
    const detail = type.worker ? `A ${SETTLER_LABELS[type.worker].toLowerCase()} is on the way.` : 'Ready to use.';
    pushMessage(world, `${type.label} finished`, detail, false, site.id);
    becomeIdle(s);
  }
}

type WorkerSettlerType = 'woodcutter' | 'stonecutter' | 'forester' | 'carpenter';

function isWorkerType(value: string): value is WorkerSettlerType {
  return value === 'woodcutter' || value === 'stonecutter' || value === 'forester' || value === 'carpenter';
}

function findTarget(world: World, s: Settler, home: Building, type: 'woodcutter' | 'stonecutter' | 'forester'): number | null {
  const radius = SEARCH_RADIUS[type];
  const candidates: { index: number; d: number }[] = [];
  for (let y = home.doorY - radius; y <= home.doorY + radius; y++) {
    for (let x = home.doorX - radius; x <= home.doorX + radius; x++) {
      if (!inBounds(world, x, y)) continue;
      const d = distance(x, y, home.doorX, home.doorY);
      if (d > radius) continue;
      const i = tileIndex(world, x, y);
      if (world.claim[i] !== 0) continue;
      const isMatch = type === 'woodcutter' ? world.tree[i] === TREE_MATURE
        : type === 'stonecutter' ? world.rock[i] > 0
        : world.terrain[i] === TERRAIN_GRASS && world.tree[i] === NO_TREE && world.rock[i] === 0
          && world.footprint[i] === 0 && world.door[i] === 0 && d >= 2;
      if (isMatch) candidates.push({ index: i, d });
    }
  }
  candidates.sort((a, b) => a.d - b.d || a.index - b.index);
  for (const candidate of candidates.slice(0, 5)) {
    if (walkTo(world, s, candidate.index)) return candidate.index;
  }
  return null;
}

function updateWorker(world: World, s: Settler): void {
  const home = buildingById(world, s.homeId);
  if (!home || !isWorkerType(s.settlerType)) { becomeIdle(s); return; }
  const type = s.settlerType;
  switch (s.phase) {
    case 'toWork':
      if (advance(world, s)) { s.phase = 'inside'; s.isInside = true; s.timer = REST_TICKS[type]; }
      return;
    case 'inside':
      if (s.timer > 0) { s.timer--; return; }
      return decideWork(world, s, home, type);
    case 'toTarget':
      if (advance(world, s)) { s.phase = 'working'; s.timer = WORK_TICKS[type]; }
      return;
    case 'working':
      if (s.timer > 0) { s.timer--; return; }
      return finishWork(world, s, home, type);
    case 'returning':
      if (!advance(world, s)) return;
      if (s.carrying) home.stock[s.carrying]++;
      s.carrying = null;
      s.phase = 'inside'; s.isInside = true; s.timer = REST_TICKS[type];
      return;
    default:
      becomeIdle(s);
  }
}

function decideWork(world: World, s: Settler, home: Building, type: WorkerSettlerType): void {
  if (type === 'carpenter') {
    if (home.stock.plank >= OUTPUT_LIMIT) { setBlocked(world, home, 'Output full: waiting for carriers'); s.timer = 20; return; }
    if (home.input.log <= 0) { setBlocked(world, home, 'Waiting: no logs'); s.timer = 10; return; }
    setBlocked(world, home, null);
    s.phase = 'working'; s.timer = WORK_TICKS.carpenter;
    return;
  }
  const output = type === 'woodcutter' ? home.stock.log : type === 'stonecutter' ? home.stock.stone : 0;
  if (output >= OUTPUT_LIMIT) { setBlocked(world, home, 'Output full: waiting for carriers'); s.timer = 20; return; }
  const target = findTarget(world, s, home, type);
  if (target === null) {
    const reason = type === 'woodcutter' ? 'No grown trees nearby' : type === 'stonecutter' ? 'No rocks nearby' : 'No free land nearby';
    setBlocked(world, home, reason);
    s.timer = 40;
    return;
  }
  setBlocked(world, home, null);
  world.claim[target] = s.id + 1;
  s.targetTile = target;
  s.phase = 'toTarget';
}

function finishWork(world: World, s: Settler, home: Building, type: WorkerSettlerType): void {
  if (type === 'carpenter') {
    if (home.input.log > 0) { home.input.log--; home.stock.plank++; }
    s.phase = 'inside'; s.timer = REST_TICKS.carpenter;
    return;
  }
  const i = s.targetTile;
  world.claim[i] = 0;
  s.targetTile = -1;
  if (type === 'woodcutter' && world.tree[i] === TREE_MATURE) { world.tree[i] = NO_TREE; s.carrying = 'log'; }
  else if (type === 'stonecutter' && world.rock[i] > 0) { world.rock[i]--; s.carrying = 'stone'; }
  else if (type === 'forester' && world.tree[i] === NO_TREE && world.footprint[i] === 0 && world.door[i] === 0) world.tree[i] = 0;
  world.mapVersion++;
  if (!walkTo(world, s, doorTile(world, home))) {
    // Cut off from home: drop what was carried and walk back in when possible.
    s.carrying = null;
    s.phase = 'inside'; s.isInside = true; s.timer = REST_TICKS[type];
    return;
  }
  s.phase = 'returning';
}

function warnAboutBlockedBuildings(world: World): void {
  for (const b of world.buildings) {
    if (b.blockedReason === null || b.hasWarned || b.blockedSince === null) continue;
    if (world.tick - b.blockedSince < WARN_AFTER_TICKS) continue;
    b.hasWarned = true;
    const label = BUILDING_TYPES[b.typeId].label;
    pushMessage(world, `${label} is waiting`, `${b.blockedReason}.`, true, b.id);
  }
}
