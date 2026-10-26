import {
  BUILDING_TYPES, FAVOURITE_FOOD_MEALS, GOOD_NAMES, GOOD_TYPES, HEAL_PER_ROUND, HEAL_RADIUS, OFFERING_TICKS, OTHER_FOOD_MEALS, PRIEST_TICKS, RACE_DRINKS,
  buildingLabel, TRADE_SURPLUS_RESERVE,
  SETTLER_LABELS, SOLDIER_STATS, WAR_MACHINES_PER_HALL, WAR_MACHINE_STATS, WEAPON_SOLDIERS, WORK_AREA_RADIUS, WEAPON_TYPES, costTotal, goodCount, isSoldierType, isUnitType,
  favouriteFoodOf, isSpecialistType, totalGoods
} from './definitions.ts';
import type { BuildingTypeId, GoodType, SettlerType, WarMachineType } from './definitions.ts';
import { applyCommand } from './commands.ts';
import type { Command, CommandResult } from './commands.ts';
import { releaseEmptyBuildings, removeDead, sendDefenders, updateSoldier } from './combat.ts';
import { WALK_SPEED, advance, distance, doorTile, tileOf, walkTo } from './movement.ts';
import { updateVision } from './vision.ts';
import { landRegion } from './regions.ts';
import { decideBreeding, finishBreeding, marketplaceWants, updateDonkey } from './trade.ts';
import { decideShip, launchShip } from './sea.ts';
import { expireSpells, maxHealth } from './magic.ts';
import {
  FIELD_RIPE, NO_FIELD, NO_TREE, TERRAIN_GRASS, TERRAIN_MOUNTAIN, TERRAIN_WATER, TREE_MATURE,
  buildingById, castleOf, inBounds, isMilitaryBuilding, isStorageBuilding, isWalkable, newSettler, playerOf, pushMessage,
  recomputeTerritory, settlerById, siteCost, storedTotal, tileIndex
} from './world.ts';
import type { Building, PlayerState, Settler, World } from './world.ts';


const OCCUPATION_TICKS = 50;
const HEAL_TICKS = 10;
/** A geologist looks this far around the spot he was sent to; a pioneer claims this far. */
export const PROSPECT_RADIUS = 6;
export const CLAIM_RADIUS = 4;
const PROSPECT_TICKS = 40;
const CLAIM_TICKS = 60;

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
  woodcutter: { radius: WORK_AREA_RADIUS.woodcutter, workTicks: 220, restTicks: 30, output: 'log', blockedText: 'No grown trees nearby' },
  stonecutter: { radius: WORK_AREA_RADIUS.stonecutter, workTicks: 200, restTicks: 30, output: 'stone', blockedText: 'No rocks nearby' },
  forester: { radius: WORK_AREA_RADIUS.forester, workTicks: 40, restTicks: 160, output: null, blockedText: 'No free land nearby' },
  fisher: { radius: WORK_AREA_RADIUS.fisher, workTicks: 180, restTicks: 60, output: 'fish', blockedText: 'No water nearby' },
  farmer: { radius: WORK_AREA_RADIUS.farm, workTicks: 90, restTicks: 60, output: 'grain', blockedText: 'No free land for fields' }
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
  // Weapons waiting at a barracks get a free settler before transport takes them all.
  recruitSoldiers(world);
  trainPriests(world);
  expireSpells(world);
  if (world.tick % 5 === 0) runLogistics(world);
  if (world.tick % 5 === 0) { assignConstructionCrews(world); assignWorkers(world); }
  if (world.tick % OCCUPATION_TICKS === 0) for (const p of world.players) applyOccupations(world, p);
  if (world.tick % HEAL_TICKS === 0) healSoldiers(world);
  fillGarrisons(world);
  sendDefenders(world);
  for (const s of world.settlers) if (!isUnitType(s.settlerType)) updateSettler(world, s);
  // Soldiers and war machines act in alternating order each tick, so no player always strikes first.
  const soldiers = world.settlers.filter((s) => isUnitType(s.settlerType));
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

/** The nearest idle settler of a type that can walk there: on the same stretch of its owner's land. */
function nearestIdle(world: World, type: SettlerType, owner: number, x: number, y: number): Settler | null {
  const region = landRegion(world, x, y);
  let best: Settler | null = null, bestDistance = Infinity;
  for (const s of world.settlers) {
    if (!isIdle(s, type) || s.owner !== owner) continue;
    if (region !== 0 && landRegion(world, s.x, s.y) !== region) continue;
    const d = distance(s.x, s.y, x, y);
    if (d < bestDistance) { bestDistance = d; best = s; }
  }
  return best;
}

/**
 * The nearest storage with room for a good. With `respectFlags`, goods the player does not store get none;
 * without it (goods that must go somewhere), the castle is the fallback.
 */
function storageFor(world: World, owner: number, good: GoodType, x: number, y: number, respectFlags: boolean, isAnyLand = false): Building | null {
  const player = playerOf(world, owner);
  if (respectFlags && player && !player.isStored[good]) return null;
  // Only storage on the same stretch of land: carriers do not cross foreign land.
  const region = landRegion(world, x, y);
  const isReachable = (b: Building) => isAnyLand || region === 0 || landRegion(world, b.doorX, b.doorY) === region;
  let best: Building | null = null, bestDistance = Infinity;
  for (const b of world.buildings) {
    if (b.owner !== owner || !isStorageBuilding(b) || !isReachable(b)) continue;
    if (storedTotal(b) >= BUILDING_TYPES[b.typeId].storageCapacity) continue;
    const d = distance(b.doorX, b.doorY, x, y);
    if (d < bestDistance) { bestDistance = d; best = b; }
  }
  const castle = castleOf(world, owner);
  return best ?? (castle && isReachable(castle) ? castle : null);
}

// ---------------------------------------------------------------- logistics

interface Request {
  building: Building;
  good: GoodType;
  isConstruction: boolean;
  share: number;
  /** A marketplace collecting ahead of construction sites. */
  isUrgent?: boolean;
  /** A marketplace collecting only what storage has to spare. */
  isSurplusOnly?: boolean;
}

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
      if (b.isPaused) continue;
      const cost = siteCost(world, b);
      for (const good of GOOD_TYPES) {
        const need = (cost[good] ?? 0) - b.delivered[good] - b.built[good] - b.incoming[good];
        for (let k = 0; k < need; k++) requests.push({ building: b, good, isConstruction: true, share: 1 });
      }
      continue;
    }
    if (b.typeId === 'marketplace') {
      const wants = marketplaceWants(b);
      for (const good of GOOD_TYPES) {
        for (let k = 0; k < (wants[good] ?? 0); k++) {
          requests.push({ building: b, good, isConstruction: false, share: 1, isUrgent: b.tradeMode === 'construction', isSurplusOnly: b.tradeMode === 'surplus' });
        }
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
  requests.sort((a, b) => Number(b.isUrgent === true) - Number(a.isUrgent === true) || Number(b.isConstruction) - Number(a.isConstruction)
    || (a.isConstruction ? Number(b.building.isPriority) - Number(a.building.isPriority) || a.building.id - b.building.id : 0)
    || order(a) - order(b) || shareScore(a) - shareScore(b) || a.building.id - b.building.id);

  const send = (from: Building, to: Building, good: GoodType): boolean => {
    const region = landRegion(world, from.doorX, from.doorY);
    let best = -1, bestDistance = Infinity;
    for (let k = 0; k < carriers.length; k++) {
      if (carriers[k].owner !== from.owner || landRegion(world, carriers[k].x, carriers[k].y) !== region) continue;
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
    const toRegion = landRegion(world, to.doorX, to.doorY);
    let from: Building | null = null, fromDistance = Infinity;
    for (const b of world.buildings) {
      if (b === to || !b.isComplete || b.owner !== to.owner || isMilitaryBuilding(b) && !isStorageBuilding(b)) continue;
      if (landRegion(world, b.doorX, b.doorY) !== toRegion) continue;
      // "Only surplus" leaves each storage a reserve for the settlement.
      const spare = request.isSurplusOnly ? (isStorageBuilding(b) ? TRADE_SURPLUS_RESERVE : 0) : 0;
      if (b.stock[request.good] - b.reserved[request.good] <= spare) continue;
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
  // Sites marked "Build first" get crews before the others; suspended sites get none.
  const sites = world.buildings.filter((b) => !b.isComplete && !b.isPaused)
    .sort((a, b) => Number(b.isPriority) - Number(a.isPriority) || a.id - b.id);
  for (const site of sites) {
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
/** Every few minutes each large temple ordains a free carrier as a priest, keeping the player's carrier share. */
function trainPriests(world: World): void {
  for (const b of world.buildings) {
    if (!b.isComplete || b.typeId !== 'large_temple' || b.isPaused) continue;
    if (b.timer < PRIEST_TICKS) { b.timer++; continue; }
    const player = playerOf(world, b.owner);
    if (!player) continue;
    const civilians = world.settlers.filter((s) => s.owner === b.owner && !isUnitType(s.settlerType));
    const carriers = civilians.filter((s) => s.settlerType === 'carrier').length;
    if ((carriers - 1) * 100 < (civilians.length - 1) * player.minCarrierPercent) { setBlocked(world, b, 'Waiting for a free settler'); continue; }
    const carrier = nearestIdle(world, 'carrier', b.owner, b.doorX, b.doorY);
    if (!carrier || !walkTo(world, carrier, doorTile(world, b))) { setBlocked(world, b, 'Waiting for a free settler'); continue; }
    carrier.phase = 'toRecruit'; carrier.homeId = b.id; carrier.good = null;
    b.timer = 0;
    setBlocked(world, b, null);
  }
}

function recruitSoldiers(world: World): void {
  if (world.tick % 5 !== 0) return;
  for (const b of world.buildings) {
    if (!b.isComplete || b.typeId !== 'barracks') continue;
    const player = playerOf(world, b.owner);
    if (!player) continue;
    // Recruiting keeps the carrier share the player set in Occupations, so transport never stops entirely.
    const civilians = world.settlers.filter((s) => s.owner === b.owner && !isUnitType(s.settlerType));
    let carriers = civilians.filter((s) => s.settlerType === 'carrier').length;
    for (const weapon of WEAPON_TYPES) {
      while (b.input[weapon] > 0 && (player.isRecruitingAutomatic || player.recruitsLeft > 0)) {
        if ((carriers - 1) * 100 < (civilians.length - 1) * player.minCarrierPercent) { setBlocked(world, b, 'Waiting for a free settler'); return; }
        const carrier = nearestIdle(world, 'carrier', b.owner, b.doorX, b.doorY);
        if (!carrier || !walkTo(world, carrier, doorTile(world, b))) { setBlocked(world, b, 'Waiting for a free settler'); return; }
        b.input[weapon]--;
        if (!player.isRecruitingAutomatic) player.recruitsLeft--;
        carrier.phase = 'toRecruit'; carrier.homeId = b.id; carrier.good = weapon;
        carriers--;
        setBlocked(world, b, null);
      }
    }
  }
}

// ---------------------------------------------------------------- settler behaviour

function updateSettler(world: World, s: Settler): void {
  if (s.settlerType === 'donkey') return updateDonkey(world, s);
  if (s.settlerType === 'priest') {
    // Priests rest after casting; otherwise they only walk where they are sent.
    if (s.timer > 0) s.timer--;
    if (s.phase === 'moving' && advance(world, s)) s.phase = 'idle';
    return;
  }
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
    case 'moving': case 'prospecting': case 'claiming': case 'stealing': return updateSpecialist(world, s);
    default: return updateWorker(world, s);
  }
}

/** Idle settlers wait a moment where they are, then go into the nearest storage building. */
function updateIdle(world: World, s: Settler): void {
  // Geologists and pioneers wait where they are for their next order.
  if (s.isInside || isSpecialistType(s.settlerType)) return;
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
  const total = costTotal(siteCost(world, site));
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
    if (castle && weapon) castle.stock[weapon]++;
    becomeIdle(s);
    return;
  }
  const player = playerOf(world, s.owner);
  if (barracks.typeId === 'large_temple') {
    // A free carrier ordained at the large temple comes out as a priest.
    s.settlerType = 'priest'; s.homeId = null; s.good = null; s.phase = 'idle'; s.isInside = false; s.path = []; s.timer = 0;
    pushMessage(world, s.owner, 'A priest is ready', `He waits at the ${buildingLabel(barracks.typeId, player?.raceType ?? 'romans').toLowerCase()} for your orders.`, false, barracks.id);
    return;
  }
  const soldierType = WEAPON_SOLDIERS[weapon];
  s.settlerType = soldierType;
  // New soldiers join at the rank the player has bought for their type.
  s.rank = player?.soldierRanks[soldierType] ?? 0;
  s.health = maxHealth(s);
  s.homeId = null; s.good = null; s.phase = 'idle'; s.isInside = false; s.path = [];
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
  if (buildingType.warMachine) return decideWarMachine(world, s, home, buildingType.warMachine);
  if (home.typeId === 'small_temple') return decideOffering(world, s, home);
  if (home.typeId === 'shipyard') {
    const problem = decideShip(world, s, home);
    setBlocked(world, home, problem === 'No ship ordered' ? null : problem);
    if (problem) s.timer = 20;
    return;
  }
  if (home.typeId === 'donkey_ranch') {
    const problem = decideBreeding(world, s, home);
    setBlocked(world, home, problem);
    if (problem) s.timer = 20;
    return;
  }
  // Workers with nothing to make, such as the healer, simply stay at their post.
  if (!isGatherType(type) && !buildingType.recipe) { s.timer = 20; return; }
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
        const favourite = favouriteFoodOf(mine, player.raceType);
        const food = home.input[favourite] > 0 ? favourite : mine.foods.find((f) => home.input[f] > 0);
        if (!food) { setBlocked(world, home, 'Waiting: no food'); s.timer = 10; return; }
        home.input[food]--;
        home.meals += food === favourite ? FAVOURITE_FOOD_MEALS : OTHER_FOOD_MEALS;
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
    // A blighted mine works at half speed.
    s.phase = 'working'; s.timer = mine && home.blightUntil > world.tick ? recipe.ticks * 2 : recipe.ticks;
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

/** A temple servant offers one of the people's drinks; each offering becomes one manna. */
function decideOffering(world: World, s: Settler, home: Building): void {
  const drink = RACE_DRINKS[playerOf(world, home.owner)?.raceType ?? 'romans'];
  if (home.input[drink] <= 0) { setBlocked(world, home, `Waiting: no ${GOOD_NAMES[drink][1]}`); s.timer = 20; return; }
  home.input[drink]--;
  setBlocked(world, home, null);
  s.good = null;
  s.phase = 'working'; s.timer = OFFERING_TICKS;
}

/** A machinist builds the hall's war machine once every part is in, while fewer than the limit are out. */
function decideWarMachine(world: World, s: Settler, home: Building, machine: WarMachineType): void {
  const out = world.settlers.filter((m) => m.homeId === home.id && m.settlerType === machine && m.health > 0).length;
  if (out >= WAR_MACHINES_PER_HALL) { setBlocked(world, home, null); s.timer = 40; return; }
  const parts = WAR_MACHINE_STATS[machine].parts;
  const missing = GOOD_TYPES.filter((g) => (parts[g] ?? 0) > home.input[g]);
  if (missing.length > 0) {
    setBlocked(world, home, `Waiting: no ${missing.map((g) => GOOD_NAMES[g][1]).join(' or ')}`);
    s.timer = 20;
    return;
  }
  for (const g of GOOD_TYPES) home.input[g] -= parts[g] ?? 0;
  setBlocked(world, home, null);
  s.good = null;
  s.phase = 'working'; s.timer = WAR_MACHINE_STATS[machine].buildTicks;
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
  const { x: cx, y: cy } = workCentreOf(home);
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (inBounds(world, x, y) && world.field[tileIndex(world, x, y)] >= 0) count++;
    }
  }
  return count;
}

/** A gatherer works around its work area, or around its door when none is set. */
function workCentreOf(home: Building): { x: number; y: number } {
  return { x: home.workX ?? home.doorX, y: home.workY ?? home.doorY };
}

function findTarget(world: World, s: Settler, home: Building, type: GatherType): number | null {
  const radius = GATHER_RULES[type].radius;
  const fields = type === 'farmer' ? countFields(world, home) : 0;
  const ripe: { index: number; d: number }[] = [];
  const candidates: { index: number; d: number }[] = [];
  const { x: cx, y: cy } = workCentreOf(home);
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (!inBounds(world, x, y)) continue;
      const d = distance(x, y, cx, cy);
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
  // Ties go the same way for both players on a mirrored map: the right-hand player counts x from the right edge.
  const isRightSide = (castleOf(world, home.owner)?.x ?? 0) > world.width / 2;
  const tieKey = (i: number) => Math.floor(i / world.width) * world.width + (isRightSide ? world.width - 1 - (i % world.width) : i % world.width);
  const byDistance = (a: { index: number; d: number }, b: { index: number; d: number }) => a.d - b.d || tieKey(a.index) - tieKey(b.index);
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
  if (home.typeId === 'shipyard') {
    launchShip(world, home);
    s.phase = 'inside'; s.timer = 5;
    return;
  }
  if (home.typeId === 'donkey_ranch') {
    finishBreeding(world, home);
    s.phase = 'inside'; s.timer = 5;
    return;
  }
  if (home.typeId === 'small_temple') {
    const player = playerOf(world, home.owner);
    if (player) player.manna++;
    s.phase = 'inside'; s.timer = 5;
    return;
  }
  const machine = BUILDING_TYPES[home.typeId].warMachine;
  if (machine) {
    const m = newSettler(world, home.owner, machine, home.doorX, home.doorY);
    m.isInside = false; m.homeId = home.id;
    pushMessage(world, home.owner, `${SETTLER_LABELS[machine]} ready`, `It waits at the ${BUILDING_TYPES[home.typeId].label.toLowerCase()} for your orders.`, false, home.id);
    s.phase = 'inside'; s.timer = 5;
    return;
  }
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

// ---------------------------------------------------------------- occupations and specialists

/**
 * Keeps the share of diggers and builders under the player's maximum, and makes new ones from free
 * carriers (taking a shovel or hammer from storage) when sites wait for them and carriers can spare it.
 */
function applyOccupations(world: World, player: PlayerState): void {
  const own = world.settlers.filter((s) => s.owner === player.id && !isUnitType(s.settlerType));
  if (own.length === 0) return;
  const countOf = (t: SettlerType) => own.filter((s) => s.settlerType === t).length;
  const crew = countOf('digger') + countOf('builder');
  const carriers = countOf('carrier');
  const castle = castleOf(world, player.id);
  if (!castle) return;
  if (crew * 100 > own.length * player.maxCrewPercent) {
    // Too many: an idle digger or builder goes back to carrying and returns the tool.
    const spare = own.find((s) => (s.settlerType === 'digger' || s.settlerType === 'builder') && s.phase === 'idle');
    if (spare) {
      castle.stock[spare.settlerType === 'digger' ? 'shovel' : 'hammer']++;
      spare.settlerType = 'carrier';
    }
    return;
  }
  if ((crew + 1) * 100 > own.length * player.maxCrewPercent || (carriers - 1) * 100 < own.length * player.minCarrierPercent) return;
  const waiting = world.buildings.filter((b) => b.owner === player.id && !b.isComplete && !b.isPaused);
  const needed: SettlerType | null = waiting.some((b) => b.blockedReason === 'Waiting for a digger') ? 'digger'
    : waiting.some((b) => b.blockedReason === 'Waiting for a builder') ? 'builder' : null;
  if (!needed) return;
  const tool = needed === 'digger' ? 'shovel' : 'hammer';
  const store = world.buildings.find((b) => b.owner === player.id && isStorageBuilding(b) && b.stock[tool] - b.reserved[tool] > 0);
  const carrier = own.find((s) => isIdle(s, 'carrier'));
  if (!store || !carrier) return;
  store.stock[tool]--;
  carrier.settlerType = needed;
}

/**
 * Geologists and pioneers walk to where they were sent, then work around that spot: a geologist puts up
 * signs on mountain tiles, showing its owner what ore lies there; a pioneer puts up posts that claim land
 * no enemy military building holds.
 */
function updateSpecialist(world: World, s: Settler): void {
  if (s.phase === 'moving') {
    if (!advance(world, s)) return;
    if (s.workCentre < 0) { s.phase = 'idle'; return; }
    s.phase = s.settlerType === 'geologist' ? 'prospecting' : s.settlerType === 'pioneer' ? 'claiming' : 'stealing';
    s.targetTile = -1; s.timer = 0; s.toId = null;
    return;
  }
  if (s.phase === 'stealing') return updateThief(world, s);
  if (s.targetTile >= 0) {
    // Walking to the next tile, then working there.
    if (s.path.length > 0) { advance(world, s); return; }
    if (s.timer < (s.phase === 'prospecting' ? PROSPECT_TICKS : CLAIM_TICKS)) { s.timer++; return; }
    const tx = s.targetTile % world.width, ty = Math.floor(s.targetTile / world.width);
    if (s.phase === 'prospecting') {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) if (inBounds(world, tx + dx, ty + dy)) world.prospect[s.owner][tileIndex(world, tx + dx, ty + dy)] = 1;
      }
      world.mapVersion++;
    } else if (canClaim(world, s.owner, s.targetTile)) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!inBounds(world, tx + dx, ty + dy)) continue;
          const i = tileIndex(world, tx + dx, ty + dy);
          if (canClaim(world, s.owner, i)) world.pioneerLand[i] = s.owner + 1;
        }
      }
      recomputeTerritory(world);
    }
    s.targetTile = -1; s.timer = 0;
    return;
  }
  // The nearest tile still worth a sign or a post that the specialist can walk to.
  for (const next of specialistTiles(world, s).slice(0, 6)) {
    if (tileOf(world, s) === next || walkTo(world, s, next, 3000)) { s.targetTile = next; s.timer = 0; return; }
  }
  s.phase = 'idle'; s.workCentre = -1; s.targetTile = -1;
}

/** Pioneers can claim any land no enemy military building holds, including other players' pioneer land. */
function canClaim(world: World, owner: number, i: number): boolean {
  const military = world.militaryLand[i];
  return (military === 0 || military === owner + 1) && world.territory[i] !== owner + 1 && world.terrain[i] !== TERRAIN_WATER;
}

/** Tiles around the work centre still worth a sign or a post, nearest to the specialist first. */
function specialistTiles(world: World, s: Settler): number[] {
  const cx = s.workCentre % world.width, cy = Math.floor(s.workCentre / world.width);
  const radius = s.settlerType === 'geologist' ? PROSPECT_RADIUS : CLAIM_RADIUS;
  const found: { i: number; d: number }[] = [];
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (!inBounds(world, x, y) || Math.hypot(x - cx, y - cy) > radius) continue;
      const i = tileIndex(world, x, y);
      if (!isWalkable(world, i)) continue;
      const isWanted = s.settlerType === 'geologist'
        ? world.terrain[i] === TERRAIN_MOUNTAIN && world.prospect[s.owner][i] === 0
        : canClaim(world, s.owner, i);
      if (isWanted) found.push({ i, d: distance(x, y, s.x, s.y) });
    }
  }
  return found.sort((a, b) => a.d - b.d || a.i - b.i).map((f) => f.i);
}

/** A thief raids an enemy store near where it was sent, then carries the loot home at half speed. */
const THIEF_SEARCH_RADIUS = 8;
const LOOT_ORDER: readonly GoodType[] = ['gold', 'sword', 'spear', 'bow', 'iron', 'hammer', 'pick', 'axe', 'saw', 'shovel', 'scythe', 'rod'];

function updateThief(world: World, s: Settler): void {
  if (s.carrying) {
    // Heading home with the loot.
    if (s.path.length === 0) {
      // A thief walks home across any land.
      const home = storageFor(world, s.owner, s.carrying, s.x, s.y, false, true);
      if (!home || (tileOf(world, s) !== doorTile(world, home) && !walkTo(world, s, doorTile(world, home)))) { s.phase = 'idle'; return; }
      s.toId = home.id;
    }
    if (!advance(world, s, WALK_SPEED / 2)) return;
    const home = buildingById(world, s.toId);
    if (home && home.owner === s.owner) {
      home.stock[s.carrying]++;
      pushMessage(world, s.owner, 'Your thief is back', `It brought ${goodCount(s.carrying, 1)}.`, false, home.id);
    }
    s.carrying = null; s.toId = null; s.phase = 'idle'; s.workCentre = -1;
    return;
  }
  let target = buildingById(world, s.toId);
  if (!target || target.owner === s.owner || !isStorageBuilding(target)) {
    const cx = s.workCentre % world.width, cy = Math.floor(s.workCentre / world.width);
    target = world.buildings.filter((b) => b.owner !== s.owner && isStorageBuilding(b) && totalGoods(b.stock) > 0
      && distance(b.doorX, b.doorY, cx, cy) <= THIEF_SEARCH_RADIUS)
      .sort((a, b) => distance(a.doorX, a.doorY, s.x, s.y) - distance(b.doorX, b.doorY, s.x, s.y) || a.id - b.id)[0];
    if (!target || (tileOf(world, s) !== doorTile(world, target) && !walkTo(world, s, doorTile(world, target)))) {
      s.phase = 'idle'; s.workCentre = -1; return;
    }
    s.toId = target.id;
  }
  if (!advance(world, s)) return;
  const stock = target.stock;
  const loot = LOOT_ORDER.find((g) => stock[g] - target.reserved[g] > 0)
    ?? GOOD_TYPES.filter((g) => stock[g] - target.reserved[g] > 0).sort((a, b) => stock[b] - stock[a])[0];
  if (!loot) { s.toId = null; s.phase = 'idle'; s.workCentre = -1; return; }
  stock[loot]--;
  s.carrying = loot; s.toId = null; s.path = [];
  pushMessage(world, target.owner, 'Goods were stolen', `A thief took ${goodCount(loot, 1)}.`, true, target.id);
}

/** Healer's huts with their healer inside heal the owner's soldiers nearby who are not fighting. */
function healSoldiers(world: World): void {
  for (const b of world.buildings) {
    if (b.typeId !== 'healer' || !b.isComplete || b.isPaused) continue;
    const healer = settlerById(world, b.workerId);
    if (!healer || !healer.isInside) continue;
    for (const s of world.settlers) {
      if (s.owner !== b.owner || !isSoldierType(s.settlerType) || s.isInside || s.enemyId !== null) continue;
      const max = maxHealth(s);
      if (s.health >= max || distance(s.x, s.y, b.doorX, b.doorY) > HEAL_RADIUS) continue;
      s.health = Math.min(max, s.health + HEAL_PER_ROUND);
    }
  }
}
