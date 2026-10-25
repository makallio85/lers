import {
  BUILDING_TYPES, FAVOURITE_FOOD_MEALS, FOOD_TYPES, GOOD_NAMES, GOOD_TYPES, OTHER_FOOD_MEALS, SETTLER_LABELS,
  SOLDIER_STATS, WEAPON_SOLDIERS, WEAPON_TYPES, costTotal, isSoldierType, totalGoods
} from './definitions.ts';
import type { BuildingTypeId, GoodType, SettlerType } from './definitions.ts';
import { applyCommand } from './commands.ts';
import type { Command, CommandResult } from './commands.ts';
import { releaseEmptyBuildings, removeDead, sendDefenders, updateSoldier } from './combat.ts';
import { advance, distance, doorTile, tileOf, walkTo } from './movement.ts';
import { updateVision } from './vision.ts';
import {
  FIELD_RIPE, NO_FIELD, NO_TREE, TERRAIN_GRASS, TERRAIN_WATER, TREE_MATURE,
  buildingById, castleOf, inBounds, isMilitaryBuilding, isStorageBuilding, newSettler, playerOf, pushMessage,
  storedTotal, tileIndex
} from './world.ts';
import type { Building, PlayerState, Settler, World } from './world.ts';


/** A producer stops once this many finished goods wait at its door. */
export const OUTPUT_LIMIT = 8;
export const WARN_AFTER_TICKS = 150;
export const RESIDENT_INTERVAL_TICKS = 60;
export const MAX_FIELDS_PER_FARM = 12;
/** A mine digs from deposits this far around its footprint. */
export const MINE_REACH = 2;

// Pace follows The Settlers III at normal speed (see docs/game-design.md, "Pace"): a small hut takes about
// a minute of levelling and 40 seconds of building.
const BUILD_TICKS_PER_GOOD = 100;
const LEVEL_TICKS_PER_TILE = 150;
/** A tree grows one step per this many ticks: sapling to full size in about 4.5 minutes. */
export const GROWTH_TICKS = 45;
const IDLE_BEFORE_GOING_HOME = 30;

type GatherType = 'woodcutter' | 'stonecutter' | 'forester' | 'fisher' | 'farmer';

interface GatherRule {
  radius: number;
  workTicks: number;
  restTicks: number;
  output: GoodType | null;
  blockedText: string;
}

const GATHER_RULES: Record<GatherType, GatherRule> = {
  woodcutter: { radius: 10, workTicks: 220, restTicks: 30, output: 'log', blockedText: 'No grown trees nearby' },
  stonecutter: { radius: 10, workTicks: 200, restTicks: 30, output: 'stone', blockedText: 'No rocks nearby' },
  forester: { radius: 6, workTicks: 40, restTicks: 160, output: null, blockedText: 'No free land nearby' },
  fisher: { radius: 8, workTicks: 180, restTicks: 60, output: 'fish', blockedText: 'No water nearby' },
  farmer: { radius: 5, workTicks: 90, restTicks: 60, output: 'grain', blockedText: 'No free land for fields' }
};

function isGatherType(value: SettlerType): value is GatherType {
  return Object.hasOwn(GATHER_RULES, value);
}

/** Advances the world by one fixed tick after applying the given commands in order. */
export function step(world: World, commands: readonly Command[] = []): CommandResult[] {
  const results = commands.map((command) => applyCommand(world, command));
  if (world.winner !== null) { world.tick++; return results; }
  for (const s of world.settlers) { s.prevX = s.x; s.prevY = s.y; }
  if (world.tick % GROWTH_TICKS === 0) grow(world);
  if (world.tick % 10 === 0) updateVision(world);
  if (world.tick % RESIDENT_INTERVAL_TICKS === 0) releaseResidents(world);
  if (world.tick % 5 === 0) runLogistics(world);
  if (world.tick % 5 === 0) { assignConstructionCrews(world); assignWorkers(world); }
  fillGarrisons(world);
  recruitSoldiers(world);
  sendDefenders(world);
  for (const s of world.settlers) if (!isSoldierType(s.settlerType)) updateSettler(world, s);
  // Soldiers act in alternating order each tick, so no player always strikes first.
  const soldiers = world.settlers.filter((s) => isSoldierType(s.settlerType));
  if (world.tick % 2 === 1) soldiers.reverse();
  for (const s of soldiers) updateSoldier(world, s);
  removeDead(world);
  warnAboutBlockedBuildings(world);
  world.tick++;
  return results;
}

function grow(world: World): void {
  const { tree, field } = world;
  for (let i = 0; i < tree.length; i++) {
    if (tree[i] >= 0 && tree[i] < TREE_MATURE && ++tree[i] === TREE_MATURE) world.mapVersion++;
    if (field[i] >= 0 && field[i] < FIELD_RIPE) {
      field[i]++;
      if (field[i] === FIELD_RIPE || field[i] % 30 === 0) world.mapVersion++;
    }
  }
}

function releaseResidents(world: World): void {
  for (const b of world.buildings) {
    if (!b.isComplete || b.residentsLeft <= 0) continue;
    b.residentsLeft--;
    const s = newSettler(world, b.owner, 'carrier', b.doorX, b.doorY);
    s.isInside = false;
  }
}

// ---------------------------------------------------------------- helpers

function setBlocked(world: World, b: Building, reason: string | null): void {
  if (reason === b.blockedReason) return;
  b.blockedReason = reason;
  b.blockedSince = reason === null ? null : world.tick;
  b.hasWarned = false;
}

function isIdle(s: Settler, type: SettlerType): boolean {
  return s.settlerType === type && s.phase === 'idle' && s.carrying === null;
}

function becomeIdle(s: Settler): void {
  s.phase = 'idle';
  s.timer = IDLE_BEFORE_GOING_HOME;
  s.fromId = null; s.toId = null; s.good = null; s.homeId = null; s.path = [];
}

function nearestIdle(world: World, type: SettlerType, owner: number, x: number, y: number): Settler | null {
  let best: Settler | null = null, bestDistance = Infinity;
  for (const s of world.settlers) {
    if (!isIdle(s, type) || s.owner !== owner) continue;
    const d = distance(s.x, s.y, x, y);
    if (d < bestDistance) { bestDistance = d; best = s; }
  }
  return best;
}

/**
 * The nearest storage with room for a good. With `respectFlags`, goods the player does not store get none;
 * without it (goods that must go somewhere), the castle is the fallback.
 */
function storageFor(world: World, owner: number, good: GoodType, x: number, y: number, respectFlags: boolean): Building | null {
  const player = playerOf(world, owner);
  if (respectFlags && player && !player.isStored[good]) return null;
  let best: Building | null = null, bestDistance = Infinity;
  for (const b of world.buildings) {
    if (b.owner !== owner || !isStorageBuilding(b)) continue;
    if (storedTotal(b) >= BUILDING_TYPES[b.typeId].storageCapacity) continue;
    const d = distance(b.doorX, b.doorY, x, y);
    if (d < bestDistance) { bestDistance = d; best = b; }
  }
  return best ?? castleOf(world, owner) ?? null;
}

// ---------------------------------------------------------------- logistics

interface Request { building: Building; good: GoodType; isConstruction: boolean; share: number }

function distributionShare(player: PlayerState | undefined, good: GoodType, typeId: BuildingTypeId): number {
  const shares = player?.distribution[good];
  if (!shares || shares[typeId] === undefined) return 1;
  return shares[typeId]!;
}

/**
 * Matches goods that are needed (construction sites first, in the order they were placed, then building
 * inputs) with goods on offer (storage, finished output) and sends the nearest free carrier. Goods follow
 * the player's transport priority; a good several building types use is shared by the Distribution setting.
 * Surplus output goes to storage for goods the player stores.
 */
function runLogistics(world: World): void {
  const carriers = world.settlers.filter((s) => isIdle(s, 'carrier'));
  if (carriers.length === 0) return;
  const rank = new Map<string, number>();
  for (const p of world.players) p.transportPriority.forEach((g, k) => rank.set(`${p.id}:${g}`, k));
  const requests: Request[] = [];
  for (const b of world.buildings) {
    if (!b.isComplete) {
      const cost = BUILDING_TYPES[b.typeId].cost;
      for (const good of GOOD_TYPES) {
        const need = (cost[good] ?? 0) - b.delivered[good] - b.built[good] - b.incoming[good];
        for (let k = 0; k < need; k++) requests.push({ building: b, good, isConstruction: true, share: 1 });
      }
      continue;
    }
    const limits = BUILDING_TYPES[b.typeId].inputLimits;
    const player = playerOf(world, b.owner);
    for (const good of GOOD_TYPES) {
      const limit = limits[good] ?? 0;
      if (limit === 0) continue;
      const share = distributionShare(player, good, b.typeId);
      if (share <= 0) continue;
      const need = limit - b.input[good] - b.incoming[good];
      for (let k = 0; k < need; k++) requests.push({ building: b, good, isConstruction: false, share });
    }
  }
  const order = (r: Request) => rank.get(`${r.building.owner}:${r.good}`) ?? 99;
  const shareScore = (r: Request) => {
    const counts = playerOf(world, r.building.owner)?.distributionCount[r.good];
    return ((counts?.[r.building.typeId] ?? 0) + 1) / r.share;
  };
  requests.sort((a, b) => Number(b.isConstruction) - Number(a.isConstruction)
    || (a.isConstruction ? a.building.id - b.building.id : 0)
    || order(a) - order(b) || shareScore(a) - shareScore(b) || a.building.id - b.building.id);

  const send = (from: Building, to: Building, good: GoodType): boolean => {
    let best = -1, bestDistance = Infinity;
    for (let k = 0; k < carriers.length; k++) {
      if (carriers[k].owner !== from.owner) continue;
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
      if (b === to || !b.isComplete || b.owner !== to.owner || isMilitaryBuilding(b) && !isStorageBuilding(b)) continue;
      if (b.stock[request.good] - b.reserved[request.good] <= 0) continue;
      const d = distance(b.doorX, b.doorY, to.doorX, to.doorY);
      if (d < fromDistance) { fromDistance = d; from = b; }
    }
    if (from && send(from, to, request.good) && !request.isConstruction) {
      const player = playerOf(world, to.owner);
      if (player?.distribution[request.good]) {
        const counts = (player.distributionCount[request.good] ??= {});
        counts[to.typeId] = (counts[to.typeId] ?? 0) + 1;
      }
    }
  }

  // Surplus output moves to storage, most important goods first.
  const producers = world.buildings.filter((b) => b.isComplete && !isStorageBuilding(b));
  for (const player of world.players) {
    for (const good of player.transportPriority) {
      for (const b of producers) {
        if (b.owner !== player.id) continue;
        while (b.stock[good] - b.reserved[good] > 0) {
          if (carriers.length === 0) return;
          const store = storageFor(world, b.owner, good, b.doorX, b.doorY, true);
          if (!store || !send(b, store, good)) break;
        }
      }
    }
  }
}

// ---------------------------------------------------------------- construction crews, workers, soldiers

function assignConstructionCrews(world: World): void {
  for (const site of world.buildings) {
    if (site.isComplete) continue;
    if (site.levelProgress < 1) {
      if (site.diggerId !== null) continue;
      const digger = nearestIdle(world, 'digger', site.owner, site.doorX, site.doorY);
      if (!digger || !walkTo(world, digger, doorTile(world, site))) { setBlocked(world, site, 'Waiting for a digger'); continue; }
      digger.phase = 'toSite'; digger.homeId = site.id;
      site.diggerId = digger.id;
      setBlocked(world, site, null);
      continue;
    }
    if (site.builderId !== null) continue;
    const builder = nearestIdle(world, 'builder', site.owner, site.doorX, site.doorY);
    if (!builder || !walkTo(world, builder, doorTile(world, site))) { setBlocked(world, site, 'Waiting for a builder'); continue; }
    builder.phase = 'toSite'; builder.homeId = site.id;
    site.builderId = builder.id;
    setBlocked(world, site, null);
  }
}

function assignWorkers(world: World): void {
  for (const b of world.buildings) {
    const type = BUILDING_TYPES[b.typeId];
    if (!b.isComplete || b.workerId !== null || type.worker === null) continue;
    let store: Building | null = null;
    if (type.tool) {
      let bestDistance = Infinity;
      for (const other of world.buildings) {
        if (other.owner !== b.owner || !isStorageBuilding(other)) continue;
        if (other.stock[type.tool] - other.reserved[type.tool] <= 0) continue;
        const d = distance(other.doorX, other.doorY, b.doorX, b.doorY);
        if (d < bestDistance) { bestDistance = d; store = other; }
      }
      if (!store) { setBlocked(world, b, `Missing tool: ${GOOD_NAMES[type.tool][0]}`); continue; }
    }
    const meetAt = store ?? b;
    const carrier = nearestIdle(world, 'carrier', b.owner, meetAt.doorX, meetAt.doorY);
    if (!carrier || !walkTo(world, carrier, doorTile(world, meetAt))) { setBlocked(world, b, 'Waiting for a free settler'); continue; }
    carrier.settlerType = type.worker;
    carrier.homeId = b.id;
    if (store && type.tool) {
      carrier.phase = 'toTool'; carrier.fromId = store.id; carrier.good = type.tool;
      store.reserved[type.tool]++;
    } else {
      carrier.phase = 'toWork';
    }
    b.workerId = carrier.id;
    setBlocked(world, b, null);
  }
}

function isFreeSoldier(s: Settler): boolean {
  return isSoldierType(s.settlerType) && s.phase === 'idle' && !s.isInside && s.health > 0;
}

/** Free soldiers walk into military buildings that want more; the emptiest building goes first. */
function fillGarrisons(world: World): void {
  if (world.tick % 5 !== 0) return;
  const wanting = world.buildings
    .filter((b) => b.isComplete && isMilitaryBuilding(b))
    .map((b) => {
      const coming = world.settlers.filter((s) => s.phase === 'toGarrison' && s.homeId === b.id).length;
      return { b, missing: Math.min(b.garrisonWanted, BUILDING_TYPES[b.typeId].garrisonCapacity) - b.garrison.length - coming };
    })
    .filter((w) => w.missing > 0)
    .sort((a, b) => a.b.garrison.length - b.b.garrison.length || a.b.id - b.b.id);
  for (const { b, missing } of wanting) {
    for (let k = 0; k < missing; k++) {
      let best: Settler | null = null, bestDistance = Infinity;
      for (const s of world.settlers) {
        if (!isFreeSoldier(s) || s.owner !== b.owner) continue;
        const d = distance(s.x, s.y, b.doorX, b.doorY);
        if (d < bestDistance) { bestDistance = d; best = s; }
      }
      if (!best || !walkTo(world, best, doorTile(world, b))) break;
      best.phase = 'toGarrison'; best.homeId = b.id;
    }
    if (b.garrison.length === 0 && b.typeId !== 'castle') setBlocked(world, b, 'Waiting for a soldier');
    else setBlocked(world, b, null);
  }
  // A garrison above what the player wants sends the extra soldiers outside.
  for (const b of world.buildings) {
    if (!isMilitaryBuilding(b)) continue;
    if (b.garrison.length > 0 && b.blockedReason === 'Waiting for a soldier') setBlocked(world, b, null);
    while (b.garrison.length > b.garrisonWanted) {
      const s = world.settlers.find((settler) => settler.id === b.garrison[b.garrison.length - 1]);
      b.garrison.pop();
      if (!s) continue;
      s.phase = 'idle'; s.isInside = false; s.homeId = null; s.x = b.doorX; s.y = b.doorY; s.path = [];
    }
  }
  releaseEmptyBuildings(world);
}

/** A free carrier fetches a weapon at the barracks and becomes a soldier. */
function recruitSoldiers(world: World): void {
  if (world.tick % 5 !== 0) return;
  for (const b of world.buildings) {
    if (!b.isComplete || b.typeId !== 'barracks') continue;
    const player = playerOf(world, b.owner);
    if (!player) continue;
    for (const weapon of WEAPON_TYPES) {
      while (b.input[weapon] > 0 && (player.isRecruitingAutomatic || player.recruitsLeft > 0)) {
        const carrier = nearestIdle(world, 'carrier', b.owner, b.doorX, b.doorY);
        if (!carrier || !walkTo(world, carrier, doorTile(world, b))) { setBlocked(world, b, 'Waiting for a free settler'); return; }
        b.input[weapon]--;
        if (!player.isRecruitingAutomatic) player.recruitsLeft--;
        carrier.phase = 'toRecruit'; carrier.homeId = b.id; carrier.good = weapon;
        setBlocked(world, b, null);
      }
    }
  }
}

// ---------------------------------------------------------------- settler behaviour

function updateSettler(world: World, s: Settler): void {
  switch (s.phase) {
    case 'idle': return updateIdle(world, s);
    case 'toStore': return updateToStore(world, s);
    case 'toPickup': return updatePickup(world, s);
    case 'toDrop': return updateDrop(world, s);
    case 'toSite': if (advance(world, s)) s.phase = s.settlerType === 'digger' ? 'leveling' : 'building'; return;
    case 'leveling': return updateLeveling(world, s);
    case 'building': return updateBuilding(world, s);
    case 'toTool': return updateToTool(world, s);
    case 'toRecruit': return updateToRecruit(world, s);
    default: return updateWorker(world, s);
  }
}

/** Idle settlers wait a moment where they are, then go into the nearest storage building. */
function updateIdle(world: World, s: Settler): void {
  if (s.isInside) return;
  if (s.timer > 0) { s.timer--; return; }
  if (s.path.length === 0) {
    const home = storageFor(world, s.owner, 'log', s.x, s.y, false);
    if (!home) return;
    // Cut off from storage: wait a while before trying again.
    if (tileOf(world, s) !== doorTile(world, home) && !walkTo(world, s, doorTile(world, home))) { s.timer = 50; return; }
  }
  if (advance(world, s)) s.isInside = true;
}

function updateToStore(world: World, s: Settler): void {
  if (s.path.length === 0) {
    const store = buildingById(world, s.toId) ?? storageFor(world, s.owner, s.carrying ?? 'log', s.x, s.y, false);
    if (!store) return;
    s.toId = store.id;
    if (tileOf(world, s) !== doorTile(world, store) && !walkTo(world, s, doorTile(world, store))) { s.toId = null; return; }
  }
  if (!advance(world, s)) return;
  const store = buildingById(world, s.toId) ?? castleOf(world, s.owner);
  if (s.carrying && store) store.stock[s.carrying]++;
  s.carrying = null;
  becomeIdle(s);
  s.isInside = true;
}

function updatePickup(world: World, s: Settler): void {
  if (!advance(world, s)) return;
  const from = buildingById(world, s.fromId);
  const to = buildingById(world, s.toId);
  const good = s.good!;
  if (!from || !to || from.owner !== s.owner || to.owner !== s.owner) {
    if (from) from.reserved[good] = Math.max(0, from.reserved[good] - 1);
    if (to) to.incoming[good] = Math.max(0, to.incoming[good] - 1);
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
  if (!to || to.owner !== s.owner) { s.phase = 'toStore'; s.toId = null; s.fromId = null; s.good = null; return; }
  to.incoming[good] = Math.max(0, to.incoming[good] - 1);
  if (!to.isComplete) to.delivered[good]++;
  else if (isStorageBuilding(to)) to.stock[good]++;
  else to.input[good]++;
  s.carrying = null;
  becomeIdle(s);
}

function updateLeveling(world: World, s: Settler): void {
  const site = buildingById(world, s.homeId);
  if (!site || site.levelProgress >= 1) { becomeIdle(s); return; }
  site.levelProgress = Math.min(1, site.levelProgress + 1 / (site.size * site.size * LEVEL_TICKS_PER_TILE));
  if (site.levelProgress >= 1) {
    site.diggerId = null;
    world.mapVersion++;
    becomeIdle(s);
  }
}

function updateBuilding(world: World, s: Settler): void {
  const site = buildingById(world, s.homeId);
  if (!site || site.isComplete) { becomeIdle(s); return; }
  const type = BUILDING_TYPES[site.typeId];
  const total = costTotal(type.cost);
  const builtCount = totalGoods(site.built);
  const onSite = GOOD_TYPES.find((good) => site.delivered[good] > 0);
  if (onSite) {
    s.timer++;
    site.buildProgress = (builtCount + s.timer / BUILD_TICKS_PER_GOOD) / total;
    if (s.timer >= BUILD_TICKS_PER_GOOD) { s.timer = 0; site.delivered[onSite]--; site.built[onSite]++; }
    setBlocked(world, site, null);
  } else if (builtCount < total) {
    setBlocked(world, site, 'Waiting for building materials');
  }
  if (totalGoods(site.built) < total) return;
  site.isComplete = true;
  site.buildProgress = 1;
  site.builderId = null;
  site.residentsLeft = type.residents;
  setBlocked(world, site, null);
  world.mapVersion++;
  const player = playerOf(world, site.owner);
  if (player) player.stats.buildingsBuilt++;
  const detail = type.residents > 0 ? `${type.residents} new settlers will move in.`
    : type.garrisonCapacity > 0 ? 'Soldiers are on the way to occupy it.'
    : type.worker ? `A ${SETTLER_LABELS[type.worker].toLowerCase()} is on the way.` : 'Ready to use.';
  pushMessage(world, site.owner, `${type.label} finished`, detail, false, site.id);
  becomeIdle(s);
}

/** A new worker first collects the tool from storage. */
function updateToTool(world: World, s: Settler): void {
  if (!advance(world, s)) return;
  const store = buildingById(world, s.fromId);
  const home = buildingById(world, s.homeId);
  const tool = s.good!;
  if (store) store.reserved[tool]--;
  const giveUp = () => {
    if (home && home.workerId === s.id) home.workerId = null;
    s.settlerType = 'carrier';
    becomeIdle(s);
  };
  if (!store || !home || store.stock[tool] <= 0) { giveUp(); return; }
  store.stock[tool]--;
  if (!walkTo(world, s, doorTile(world, home))) { store.stock[tool]++; giveUp(); return; }
  s.fromId = null; s.good = null;
  s.phase = 'toWork';
}

function updateToRecruit(world: World, s: Settler): void {
  if (!advance(world, s)) return;
  const barracks = buildingById(world, s.homeId);
  const weapon = s.good as (typeof WEAPON_TYPES)[number];
  if (!barracks || barracks.owner !== s.owner) {
    const castle = castleOf(world, s.owner);
    if (castle) castle.stock[weapon]++;
    becomeIdle(s);
    return;
  }
  const soldierType = WEAPON_SOLDIERS[weapon];
  s.settlerType = soldierType;
  s.health = SOLDIER_STATS[soldierType].health;
  s.homeId = null; s.good = null; s.phase = 'idle'; s.isInside = false; s.path = [];
  const player = playerOf(world, s.owner);
  if (player) player.stats.soldiersRecruited++;
}

function updateWorker(world: World, s: Settler): void {
  const home = buildingById(world, s.homeId);
  if (!home) { becomeIdle(s); return; }
  const type = s.settlerType;
  switch (s.phase) {
    case 'toWork':
      if (!advance(world, s)) return;
      s.phase = 'inside'; s.isInside = true; s.timer = 10;
      return;
    case 'inside':
      if (s.timer > 0) { s.timer--; return; }
      return decideWork(world, s, home, type);
    case 'toTarget':
      if (advance(world, s)) { s.phase = 'working'; s.timer = isGatherType(type) ? GATHER_RULES[type].workTicks : 0; }
      return;
    case 'working':
      if (s.timer > 0) { s.timer--; return; }
      return finishWork(world, s, home, type);
    case 'returning':
      if (!advance(world, s)) return;
      if (s.carrying) home.stock[s.carrying]++;
      s.carrying = null;
      s.phase = 'inside'; s.isInside = true; s.timer = isGatherType(type) ? GATHER_RULES[type].restTicks : 5;
      return;
    default:
      becomeIdle(s);
  }
}

/** The next tool or weapon a smith makes: open orders first, then by the long-run shares. */
function chooseOutput(player: PlayerState, choices: readonly GoodType[]): GoodType | null {
  for (const good of choices) {
    if ((player.productionOrders[good] ?? 0) > 0) return good;
  }
  const total = choices.reduce((sum, g) => sum + (player.productionShares[g] ?? 0), 0);
  if (total <= 0) return null;
  let best: GoodType | null = null, bestCredit = -Infinity;
  for (const good of choices) {
    const credit = (player.productionCredit[good] ?? 0) + (player.productionShares[good] ?? 0);
    if (credit > bestCredit) { bestCredit = credit; best = good; }
  }
  return best;
}

function takeOutputChoice(player: PlayerState, choices: readonly GoodType[], made: GoodType): void {
  if ((player.productionOrders[made] ?? 0) > 0) { player.productionOrders[made]!--; return; }
  const total = choices.reduce((sum, g) => sum + (player.productionShares[g] ?? 0), 0);
  for (const good of choices) player.productionCredit[good] = (player.productionCredit[good] ?? 0) + (player.productionShares[good] ?? 0);
  player.productionCredit[made] = (player.productionCredit[made] ?? 0) - total;
}

/** A deposit tile under or around a mine that still holds its ore. */
function mineTile(world: World, home: Building, deposit: number): number | null {
  for (let y = home.y - MINE_REACH; y < home.y + home.size + MINE_REACH; y++) {
    for (let x = home.x - MINE_REACH; x < home.x + home.size + MINE_REACH; x++) {
      if (!inBounds(world, x, y)) continue;
      const i = tileIndex(world, x, y);
      if (world.deposit[i] === deposit && world.depositAmount[i] > 0) return i;
    }
  }
  return null;
}

function decideWork(world: World, s: Settler, home: Building, type: SettlerType): void {
  if (home.isPaused) { setBlocked(world, home, 'Paused'); s.timer = 10; return; }
  const buildingType = BUILDING_TYPES[home.typeId];
  const recipe = buildingType.recipe;
  const player = playerOf(world, home.owner);
  if (!isGatherType(type) && recipe && player) {
    const output = recipe.outputChoices ? chooseOutput(player, recipe.outputChoices) : recipe.output;
    if (output === null) { setBlocked(world, home, 'Nothing ordered'); s.timer = 20; return; }
    if (home.stock[output] >= OUTPUT_LIMIT) { setBlocked(world, home, 'Output full: waiting for carriers'); s.timer = 20; return; }
    const mine = buildingType.mine;
    let oreTile: number | null = null;
    if (mine) {
      oreTile = mineTile(world, home, mine.deposit);
      if (oreTile === null) { setBlocked(world, home, 'The deposit is used up'); s.timer = 40; return; }
      if (home.meals <= 0) {
        const food = home.input[mine.favouriteFood] > 0 ? mine.favouriteFood : FOOD_TYPES.find((f) => home.input[f] > 0);
        if (!food) { setBlocked(world, home, 'Waiting: no food'); s.timer = 10; return; }
        home.input[food]--;
        home.meals += food === mine.favouriteFood ? FAVOURITE_FOOD_MEALS : OTHER_FOOD_MEALS;
      }
    }
    const missing = GOOD_TYPES.filter((g) => (recipe.inputs[g] ?? 0) > home.input[g]);
    if (missing.length > 0) {
      setBlocked(world, home, `Waiting: no ${missing.map((g) => GOOD_NAMES[g][1]).join(' or ')}`);
      s.timer = 10;
      return;
    }
    for (const g of GOOD_TYPES) home.input[g] -= recipe.inputs[g] ?? 0;
    if (mine && oreTile !== null) { home.meals--; world.depositAmount[oreTile]--; }
    if (recipe.outputChoices) takeOutputChoice(player, recipe.outputChoices, output);
    setBlocked(world, home, null);
    s.good = output;
    s.phase = 'working'; s.timer = recipe.ticks;
    return;
  }
  if (!isGatherType(type)) return;
  const rule = GATHER_RULES[type];
  if (rule.output && home.stock[rule.output] >= OUTPUT_LIMIT) { setBlocked(world, home, 'Output full: waiting for carriers'); s.timer = 20; return; }
  const target = findTarget(world, s, home, type);
  if (target === null) {
    // A farmer whose fields are still growing is waiting, not stuck.
    if (type === 'farmer' && countFields(world, home) > 0) { setBlocked(world, home, null); s.timer = 30; return; }
    setBlocked(world, home, rule.blockedText);
    s.timer = 40;
    return;
  }
  setBlocked(world, home, null);
  world.claim[target] = s.id + 1;
  s.targetTile = target;
  s.phase = 'toTarget';
}

function isFreeLand(world: World, i: number): boolean {
  return world.terrain[i] === TERRAIN_GRASS && world.tree[i] === NO_TREE && world.rock[i] === 0
    && world.field[i] === NO_FIELD && world.footprint[i] === 0 && world.door[i] === 0;
}

/** Walkable grass next to water, where a fisher can stand. */
function isShore(world: World, x: number, y: number): boolean {
  const i = tileIndex(world, x, y);
  if (world.terrain[i] !== TERRAIN_GRASS || world.rock[i] > 0 || world.footprint[i] !== 0) return false;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (inBounds(world, x + dx, y + dy) && world.terrain[tileIndex(world, x + dx, y + dy)] === TERRAIN_WATER) return true;
  }
  return false;
}

function countFields(world: World, home: Building): number {
  let count = 0;
  const r = GATHER_RULES.farmer.radius;
  for (let y = home.doorY - r; y <= home.doorY + r; y++) {
    for (let x = home.doorX - r; x <= home.doorX + r; x++) {
      if (inBounds(world, x, y) && world.field[tileIndex(world, x, y)] >= 0) count++;
    }
  }
  return count;
}

function findTarget(world: World, s: Settler, home: Building, type: GatherType): number | null {
  const radius = GATHER_RULES[type].radius;
  const fields = type === 'farmer' ? countFields(world, home) : 0;
  const ripe: { index: number; d: number }[] = [];
  const candidates: { index: number; d: number }[] = [];
  for (let y = home.doorY - radius; y <= home.doorY + radius; y++) {
    for (let x = home.doorX - radius; x <= home.doorX + radius; x++) {
      if (!inBounds(world, x, y)) continue;
      const d = distance(x, y, home.doorX, home.doorY);
      if (d > radius) continue;
      const i = tileIndex(world, x, y);
      if (world.claim[i] !== 0) continue;
      // Workers stay on their own land.
      if (world.territory[i] !== home.owner + 1) continue;
      switch (type) {
        case 'woodcutter': if (world.tree[i] === TREE_MATURE) candidates.push({ index: i, d }); break;
        case 'stonecutter': if (world.rock[i] > 0) candidates.push({ index: i, d }); break;
        case 'forester': if (d >= 2 && isFreeLand(world, i)) candidates.push({ index: i, d }); break;
        case 'fisher': if (isShore(world, x, y)) candidates.push({ index: i, d }); break;
        case 'farmer':
          if (world.field[i] >= FIELD_RIPE) ripe.push({ index: i, d });
          else if (fields < MAX_FIELDS_PER_FARM && d >= 1.5 && isFreeLand(world, i)) candidates.push({ index: i, d });
          break;
      }
    }
  }
  const byDistance = (a: { index: number; d: number }, b: { index: number; d: number }) => a.d - b.d || a.index - b.index;
  // A farmer harvests ripe fields before sowing new ones.
  for (const list of [ripe, candidates]) {
    list.sort(byDistance);
    for (const candidate of list.slice(0, 5)) {
      if (walkTo(world, s, candidate.index, 1500)) return candidate.index;
    }
  }
  return null;
}

function finishWork(world: World, s: Settler, home: Building, type: SettlerType): void {
  const recipe = BUILDING_TYPES[home.typeId].recipe;
  if (!isGatherType(type) && recipe) {
    const output = s.good ?? recipe.output;
    home.stock[output]++;
    const player = playerOf(world, home.owner);
    if (player && output === 'plank') player.stats.planksMade++;
    if (player && output === 'bread') player.stats.breadBaked++;
    s.good = null;
    s.phase = 'inside'; s.timer = 5;
    return;
  }
  const i = s.targetTile;
  if (i < 0) { s.phase = 'inside'; s.isInside = true; return; }
  world.claim[i] = 0;
  s.targetTile = -1;
  if (type === 'woodcutter' && world.tree[i] === TREE_MATURE) { world.tree[i] = NO_TREE; s.carrying = 'log'; }
  else if (type === 'stonecutter' && world.rock[i] > 0) { world.rock[i]--; s.carrying = 'stone'; }
  else if (type === 'forester' && isFreeLand(world, i)) world.tree[i] = 0;
  else if (type === 'fisher') s.carrying = 'fish';
  else if (type === 'farmer') {
    if (world.field[i] >= FIELD_RIPE) { world.field[i] = NO_FIELD; s.carrying = 'grain'; }
    else if (isFreeLand(world, i)) world.field[i] = 0;
  }
  world.mapVersion++;
  if (!walkTo(world, s, doorTile(world, home))) {
    // Cut off from home: drop what was carried and walk back in when possible.
    s.carrying = null;
    s.phase = 'inside'; s.isInside = true; s.timer = 20;
    return;
  }
  s.phase = 'returning';
}

function warnAboutBlockedBuildings(world: World): void {
  for (const b of world.buildings) {
    if (b.blockedReason === null || b.hasWarned || b.blockedSince === null || b.blockedReason === 'Paused') continue;
    if (world.tick - b.blockedSince < WARN_AFTER_TICKS) continue;
    b.hasWarned = true;
    const label = BUILDING_TYPES[b.typeId].label;
    pushMessage(world, b.owner, `${label} is waiting`, `${b.blockedReason}.`, true, b.id);
  }
}
