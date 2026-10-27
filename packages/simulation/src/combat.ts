import {
  BUILDING_STRUCTURE, BUILDING_TYPES, ECONOMY_OUTSIDE_STRENGTH, ECONOMY_TARGETS, GOLD_FOR_FULL_STRENGTH, OUTSIDE_MIN_STRENGTH, SETTLER_LABELS,
  SOLDIER_STATS, WAR_MACHINE_STATS, emptyGoods, isShipType, isSoldierType, isUnitType, isWarMachineType, mapSizeTypeOf
} from './definitions.ts';
import { updateShip } from './sea.ts';
import type { GoodType, WarMachineType } from './definitions.ts';
import { coveringBuilding, releaseFromBuilding } from './commands.ts';
import { advance, distance, doorTile, isMachinePassable, tileOf, walkTo } from './movement.ts';
import { reachableFrom } from './pathfinding.ts';
import { damageFactor, damageTaken, isFrozen } from './magic.ts';
import {
  buildingById, castleOf, inBounds, isMilitaryBuilding, isSupplyBuilding, nextRandom, playerOf, pushMessage, recomputeTerritory, removeBuilding,
  settlerById, tileIndex, isEnemy, settleWinner
} from './world.ts';
import type { Building, Settler, World } from './world.ts';

/** Soldiers outside notice enemies this close. */
export const ENGAGE_RANGE = 6;
/** A garrison sends soldiers out against enemies this close to its door. */
export const DEFEND_RADIUS = 5;
const REPATH_TICKS = 6;
/** Soldiers see through a thief's disguise this close. */
export const THIEF_SPOT_RANGE = 3;
/** A manned tower or castle watches this far around its door: a thief there is seen, and a soldier comes out. */
export const THIEF_WATCH_RANGE = DEFEND_RADIUS;
/** A castle warns its owner at most this often while under attack. */
const CASTLE_WARNING_TICKS = 600;

/**
 * The treasure that sets a player's soldiers' strength outside its own land, counted in gold bars: gold in
 * storage or waiting at the gold smelter, and for the Egyptians, as in the original, gold at half value and gems at double.
 */
export function storedGold(world: World, owner: number): number {
  let gold = 0, gems = 0;
  for (const b of world.buildings) {
    if (b.owner !== owner || !isSupplyBuilding(b)) continue;
    gold += b.stock.gold; gems += b.stock.gems;
  }
  return world.players[owner]?.raceType === 'egyptians' ? gold / 2 + gems * 2 : gold;
}

/** How hard a soldier hits: always fully on its own land, outside it by the gold its owner has. */
export function strengthOf(world: World, s: Settler): number {
  if (world.territory[tileIndex(world, Math.round(s.x), Math.round(s.y))] === s.owner + 1) return 1;
  // In the economic mode, soldiers are very weak away from home.
  if (world.victoryType === 'economy') return ECONOMY_OUTSIDE_STRENGTH;
  return OUTSIDE_MIN_STRENGTH + (1 - OUTSIDE_MIN_STRENGTH) * Math.min(1, storedGold(world, s.owner) / GOLD_FOR_FULL_STRENGTH);
}

/** An enemy a soldier can fight: a soldier or war machine outside, or a thief close enough to be recognised. */
function isFoe(world: World, s: Settler, other: Settler): boolean {
  if (!isEnemy(world, s.owner, other.owner) || other.isInside || other.health <= 0) return false;
  // Ships at sea are out of a soldier's reach.
  if (isShipType(other.settlerType)) return false;
  if (isUnitType(other.settlerType)) return true;
  return other.settlerType === 'thief' && (distance(other.x, other.y, s.x, s.y) <= THIEF_SPOT_RANGE || isWatched(world, other, s.owner));
}

/** Whether a manned military building of this player has the thief in view near its door. */
function isWatched(world: World, thief: Settler, owner: number): boolean {
  return world.buildings.some((b) => b.owner === owner && b.isComplete && isMilitaryBuilding(b) && (b.garrison.length > 0 || defendersOut(world, b).length > 0)
    && distance(b.doorX, b.doorY, thief.x, thief.y) <= THIEF_WATCH_RANGE);
}

function isAliveSoldier(s: Settler): boolean {
  return isSoldierType(s.settlerType) && s.health > 0;
}

function isAliveUnit(s: Settler): boolean {
  return isUnitType(s.settlerType) && !isShipType(s.settlerType) && s.health > 0;
}

/** Enemy units near a military building's door, and thieves there, whom its watch sees through. */
function enemiesNear(world: World, owner: number, x: number, y: number, radius: number): Settler[] {
  return world.settlers.filter((s) => isEnemy(world, s.owner, owner) && (isAliveUnit(s) || (s.settlerType === 'thief' && s.health > 0)) && !s.isInside
    && distance(s.x, s.y, x, y) <= radius);
}

function defendersOut(world: World, b: Building): Settler[] {
  return world.settlers.filter((s) => s.phase === 'defending' && s.homeId === b.id && isAliveSoldier(s));
}

/** Each garrison sends out one defender per attacker near its door, as long as it has soldiers inside. */
export function sendDefenders(world: World): void {
  for (const b of world.buildings) {
    if (!b.isComplete || !isMilitaryBuilding(b) || b.garrison.length === 0) continue;
    const attackers = enemiesNear(world, b.owner, b.doorX, b.doorY, DEFEND_RADIUS);
    if (attackers.length === 0) continue;
    if (b.typeId === 'castle') warnCastleUnderAttack(world, b);
    let out = defendersOut(world, b).length;
    while (out < attackers.length && b.garrison.length > 0) {
      const s = settlerById(world, b.garrison.pop()!);
      if (!s) continue;
      s.phase = 'defending'; s.isInside = false; s.homeId = b.id;
      s.x = b.doorX; s.y = b.doorY; s.prevX = s.x; s.prevY = s.y; s.path = [];
      out++;
    }
  }
}

function warnCastleUnderAttack(world: World, castle: Building): void {
  const last = [...world.messages].reverse().find((m) => m.owner === castle.owner && m.text === 'Your castle is under attack');
  if (last && world.tick - last.tick < CASTLE_WARNING_TICKS) return;
  pushMessage(world, castle.owner, 'Your castle is under attack', 'If it falls, the match is lost.', true, castle.id);
}

function hit(world: World, attacker: Settler, target: Settler): void {
  if (!isSoldierType(attacker.settlerType)) return;
  const stats = SOLDIER_STATS[attacker.settlerType];
  // Rank and Fury make a blow harder; Shield halves what the target takes.
  const damage = stats.damage * strengthOf(world, attacker) * damageFactor(world, attacker) * damageTaken(world, target) * (0.85 + 0.3 * nextRandom(world));
  target.health -= damage;
  attacker.cooldown = stats.cooldown;
  if (target.health <= 0) {
    target.health = 0;
    const loser = playerOf(world, target.owner);
    if (loser && isSoldierType(target.settlerType)) loser.stats.soldiersLost++;
    if (target.settlerType === 'thief') pushMessage(world, target.owner, 'A thief was caught', 'Enemy soldiers saw through the disguise.', true, null);
    if (isWarMachineType(target.settlerType)) pushMessage(world, target.owner, `Your ${SETTLER_LABELS[target.settlerType].toLowerCase()} was destroyed`, 'Enemy soldiers broke it.', true, null);
    attacker.enemyId = null;
  }
}

/** Removes fallen soldiers from the world and from any garrison. */
export function removeDead(world: World): void {
  const dead = new Set(world.settlers.filter((s) => (isUnitType(s.settlerType) || s.settlerType === 'thief') && s.health <= 0).map((s) => s.id));
  if (dead.size === 0) return;
  world.settlers = world.settlers.filter((s) => !dead.has(s.id));
  for (const b of world.buildings) {
    if (b.garrison.some((id) => dead.has(id))) b.garrison = b.garrison.filter((id) => !dead.has(id));
  }
  for (const s of world.settlers) if (s.enemyId !== null && dead.has(s.enemyId)) s.enemyId = null;
  releaseEmptyBuildings(world);
}


/**
 * A tower whose garrison and defenders are all gone stops claiming land (it can then be taken). One that another of
 * its owner's manned towers (or the castle, while soldiers are in it) covers cannot be taken, so it keeps its land until that cover is emptied or falls: otherwise
 * it would stand on the enemy's land, untakeable.
 */
export function releaseEmptyBuildings(world: World): void {
  let isChanged = false;
  for (const b of world.buildings) {
    if (!b.isOccupied || b.garrison.length > 0) continue;
    const isDefended = world.settlers.some((s) => s.homeId === b.id && s.phase === 'defending' && s.health > 0);
    if (!isDefended && !coveringBuilding(world, b)) { b.isOccupied = false; isChanged = true; }
  }
  if (isChanged) recomputeTerritory(world);
}

function nearestEnemy(world: World, s: Settler): Settler | null {
  const current = settlerById(world, s.enemyId);
  if (current && isFoe(world, s, current) && distance(current.x, current.y, s.x, s.y) <= ENGAGE_RANGE + 2) return current;
  let best: Settler | null = null, bestDistance = ENGAGE_RANGE;
  for (const other of world.settlers) {
    if (!isFoe(world, s, other)) continue;
    const d = distance(other.x, other.y, s.x, s.y);
    if (d <= bestDistance) { bestDistance = d; best = other; }
  }
  return best;
}

/** One tick of a soldier outside a building: fight anything close, otherwise follow the current order. */
export function updateSoldier(world: World, s: Settler): void {
  if (s.health <= 0 || s.isInside) return;
  if (s.cooldown > 0) s.cooldown--;
  if (isWarMachineType(s.settlerType)) return updateWarMachine(world, s, s.settlerType);
  if (isShipType(s.settlerType)) return updateShip(world, s);
  // A Freeze spell holds soldiers where they stand.
  if (isFrozen(world, s)) return;
  if (s.phase === 'toGarrison') return updateToGarrison(world, s);

  // Moving without fighting: walk on until they arrive.
  const enemy = s.isIgnoringEnemies && s.phase === 'moving' ? null : nearestEnemy(world, s);
  if (enemy && isSoldierType(s.settlerType)) {
    const range = SOLDIER_STATS[s.settlerType].range;
    const d = distance(enemy.x, enemy.y, s.x, s.y);
    // Holding position: fight only what comes into reach, never chase.
    if (!s.isHolding || d <= range) {
      s.enemyId = enemy.id;
      if (d <= range) {
        s.path = [];
        if (s.cooldown === 0) hit(world, s, enemy);
      } else {
        if (s.path.length === 0 || world.tick % REPATH_TICKS === 0) walkTo(world, s, tileOf(world, enemy), 2500);
        advance(world, s);
      }
      return;
    }
  }
  if (s.enemyId !== null) {
    s.enemyId = null;
    // A patrol or a waypoint route carries on after a fight.
    if (s.phase === 'moving') resumeRoute(world, s);
  }

  switch (s.phase) {
    case 'moving':
      if (advance(world, s)) arrive(world, s);
      return;
    case 'attacking':
      return updateAttacking(world, s);
    case 'defending': {
      const home = buildingById(world, s.homeId);
      if (!home || home.owner !== s.owner) { s.phase = 'idle'; s.homeId = null; return; }
      if (enemiesNear(world, s.owner, home.doorX, home.doorY, DEFEND_RADIUS + 3).length > 0) return;
      if (s.path.length === 0 && tileOf(world, s) !== doorTile(world, home) && !walkTo(world, s, doorTile(world, home))) return;
      if (advance(world, s)) {
        home.garrison.push(s.id);
        s.phase = 'inside'; s.isInside = true;
      }
      return;
    }
    default:
      return;
  }
}

/** At the end of a path: on to the next waypoint, back along the patrol, or stop. */
function arrive(world: World, s: Settler): void {
  if (s.waypoints.length > 0) {
    const next = s.waypoints.shift()!;
    if (walkTo(world, s, next)) return;
  }
  if (s.isPatrolling) {
    const here = tileOf(world, s);
    const next = here === s.targetTile ? s.workCentre : s.targetTile;
    if (next >= 0 && walkTo(world, s, next)) return;
  }
  s.phase = 'idle'; s.isIgnoringEnemies = false; s.isPatrolling = false;
}

function resumeRoute(world: World, s: Settler): void {
  const goal = s.waypoints.length > 0 ? s.waypoints[0] : s.isPatrolling ? s.targetTile : -1;
  if (goal >= 0) walkTo(world, s, goal);
}

function updateToGarrison(world: World, s: Settler): void {
  const home = buildingById(world, s.homeId);
  if (!home || home.owner !== s.owner || !home.isComplete) { s.phase = 'idle'; s.homeId = null; s.path = []; return; }
  if (!advance(world, s)) return;
  if (home.garrison.length >= BUILDING_TYPES[home.typeId].garrisonCapacity) { s.phase = 'idle'; s.homeId = null; return; }
  home.garrison.push(s.id);
  s.phase = 'inside'; s.isInside = true;
  if (!home.isOccupied && home.typeId !== 'castle') {
    home.isOccupied = true;
    recomputeTerritory(world);
    pushMessage(world, home.owner, `${BUILDING_TYPES[home.typeId].label} occupied`, 'Your territory has grown.', false, home.id);
  }
}

function updateAttacking(world: World, s: Settler): void {
  const target = buildingById(world, s.attackId);
  if (!target || !isEnemy(world, s.owner, target.owner)) { s.phase = 'idle'; s.attackId = null; s.path = []; return; }
  const door = doorTile(world, target);
  if (tileOf(world, s) !== door) {
    if ((s.path.length === 0 || world.tick % (REPATH_TICKS * 5) === 0) && !walkTo(world, s, door)) { s.phase = 'idle'; s.attackId = null; return; }
    advance(world, s);
    return;
  }
  // At the door: the building falls once nobody defends it and no other tower of its owner covers it.
  if (target.garrison.length > 0 || defendersOut(world, target).length > 0) return;
  const cover = coveringBuilding(world, target);
  if (!cover) { capture(world, target, s); return; }
  // Emptied but covered: take the building that covers it first, as the rule says.
  s.attackId = cover.id; s.path = [];
}

/** Removes a building without refund; its people go free and its garrison steps outside. */
export function destroyBuilding(world: World, b: Building): void {
  const tool = BUILDING_TYPES[b.typeId].tool;
  const garrison = new Set(b.garrison);
  removeBuilding(world, b);
  for (const s of world.settlers) {
    if (garrison.has(s.id)) {
      s.phase = 'idle'; s.isInside = false; s.homeId = null; s.x = b.doorX; s.y = b.doorY; s.path = [];
      continue;
    }
    releaseFromBuilding(world, s.id, b.id, tool);
  }
}

function capture(world: World, b: Building, s: Settler): void {
  const loser = b.owner;
  const label = BUILDING_TYPES[b.typeId].label;
  const winnerStats = playerOf(world, s.owner)?.stats;
  if (winnerStats) winnerStats.towersTaken++;
  s.attackId = null; s.path = [];
  if (b.typeId === 'castle') {
    destroyBuilding(world, b);
    s.phase = 'idle';
    pushMessage(world, s.owner, 'Enemy castle taken', 'Your soldiers broke into the enemy castle.', false, null);
    pushMessage(world, loser, 'Your castle has fallen', 'The enemy broke into your castle.', true, null);
  } else {
    b.owner = s.owner;
    b.garrison = [s.id];
    b.isOccupied = true;
    b.garrisonWanted = BUILDING_TYPES[b.typeId].garrisonCapacity;
    b.stock = emptyGoods(); b.input = emptyGoods(); b.incoming = emptyGoods(); b.reserved = emptyGoods();
    b.blockedReason = null; b.blockedSince = null;
    s.phase = 'inside'; s.isInside = true; s.homeId = b.id;
    for (const other of world.settlers) {
      // Carriers of the old owner heading here lose their job.
      if (other.owner === loser && (other.toId === b.id || other.fromId === b.id)) releaseFromBuilding(world, other.id, b.id, null);
    }
    recomputeTerritory(world);
    pushMessage(world, s.owner, `${label} taken`, 'The land around it is yours now.', false, b.id);
    pushMessage(world, loser, `${label} lost`, 'Your buildings in its area were destroyed.', true, null);
  }
  destroyBuildingsOnLostLand(world, loser);
  checkVictory(world);
}

/** As in the original game, a player's buildings on land that another player now holds are destroyed. */
function destroyBuildingsOnLostLand(world: World, loser: number): void {
  for (const other of [...world.buildings]) {
    if (other.owner !== loser) continue;
    let isLost = false;
    for (let dy = 0; dy < other.size && !isLost; dy++) {
      for (let dx = 0; dx < other.size && !isLost; dx++) {
        const owner = world.territory[tileIndex(world, other.x + dx, other.y + dy)];
        if (owner !== 0 && owner !== loser + 1) isLost = true;
      }
    }
    if (isLost) destroyBuilding(world, other);
  }
  recomputeTerritory(world);
}

// ---------------------------------------------------------------- war machines

/** A war machine under fire warns its target's owner at most this often. */
const UNDER_FIRE_WARNING_TICKS = 300;

/** Distance from a machine to the middle of a building's footprint. */
function distanceToBuilding(s: Settler, b: Building): number {
  return distance(s.x, s.y, b.x + (b.size - 1) / 2, b.y + (b.size - 1) / 2);
}

/**
 * One tick of a war machine outside. It never fights people. Ordered against a tower or castle it rolls into
 * range and fires until the building falls or its ammunition runs out; then it goes back to its hall to
 * reload and, when it has shots again, returns to the same target.
 */
function updateWarMachine(world: World, s: Settler, machine: WarMachineType): void {
  const stats = WAR_MACHINE_STATS[machine];
  switch (s.phase) {
    case 'attacking': {
      const target = buildingById(world, s.attackId);
      if (!target || !isEnemy(world, s.owner, target.owner)) { s.phase = 'idle'; s.attackId = null; s.path = []; return; }
      if (s.ammo <= 0) { goReload(world, s); return; }
      if (distanceToBuilding(s, target) <= stats.range) {
        s.path = [];
        if (s.cooldown === 0) fireAt(world, s, target, machine);
        return;
      }
      if ((s.path.length === 0 || world.tick % (REPATH_TICKS * 5) === 0) && !walkToFiringSpot(world, s, target, stats.range)) {
        s.phase = 'idle'; s.attackId = null;
        pushMessage(world, s.owner, `Your ${SETTLER_LABELS[machine].toLowerCase()} cannot get there`, 'War machines need open ground: no forest, rocks or mountains.', true, null);
        return;
      }
      advance(world, s);
      return;
    }
    case 'returning': {
      const hall = buildingById(world, s.homeId);
      if (!hall || hall.owner !== s.owner || !hall.isComplete) { s.phase = 'idle'; s.homeId = null; s.path = []; return; }
      if (tileOf(world, s) !== doorTile(world, hall)) {
        if (s.path.length === 0 && !walkTo(world, s, doorTile(world, hall), 20_000)) { s.phase = 'idle'; return; }
        advance(world, s);
        return;
      }
      const taken = Math.min(stats.shots - s.ammo, hall.input[stats.ammo]);
      hall.input[stats.ammo] -= taken; s.ammo += taken;
      // Wait at the hall until there is something to shoot with.
      if (s.ammo === 0) return;
      if (s.attackId !== null && buildingById(world, s.attackId)) { s.phase = 'attacking'; s.path = []; }
      else if (s.ammo >= stats.shots) s.phase = 'idle';
      return;
    }
    case 'moving':
      if (advance(world, s)) arrive(world, s);
      return;
    default:
      return;
  }
}

/** Heads for the nearest open-ground tile within range of the target that the machine can roll to. */
function walkToFiringSpot(world: World, s: Settler, target: Building, range: number): boolean {
  const reach = reachableFrom(world, tileOf(world, s), isMachinePassable);
  const cx = target.x + (target.size - 1) / 2, cy = target.y + (target.size - 1) / 2;
  let best = -1, bestDistance = Infinity;
  for (let y = Math.floor(cy - range); y <= Math.ceil(cy + range); y++) {
    for (let x = Math.floor(cx - range); x <= Math.ceil(cx + range); x++) {
      if (!inBounds(world, x, y) || Math.hypot(x - cx, y - cy) > range - 0.5) continue;
      const i = tileIndex(world, x, y);
      if (!reach(i)) continue;
      const d = Math.hypot(x - s.x, y - s.y);
      if (d < bestDistance) { bestDistance = d; best = i; }
    }
  }
  return best >= 0 && walkTo(world, s, best, 20_000);
}

function goReload(world: World, s: Settler): void {
  const hall = buildingById(world, s.homeId);
  if (!hall) { s.phase = 'idle'; s.attackId = null; s.path = []; return; }
  s.phase = 'returning'; s.path = [];
}

function fireAt(world: World, s: Settler, target: Building, machine: WarMachineType): void {
  const stats = WAR_MACHINE_STATS[machine];
  s.ammo--;
  s.cooldown = stats.cooldown;
  if (nextRandom(world) >= stats.accuracy) return;
  target.damage += stats.damage * (0.85 + 0.3 * nextRandom(world));
  const label = BUILDING_TYPES[target.typeId].label;
  const last = [...world.messages].reverse().find((m) => m.owner === target.owner && m.buildingId === target.id && m.text.endsWith('is under fire'));
  if (!last || world.tick - last.tick >= UNDER_FIRE_WARNING_TICKS) {
    pushMessage(world, target.owner, `Your ${label.toLowerCase()} is under fire`, `An enemy ${SETTLER_LABELS[machine].toLowerCase()} is shooting at it.`, true, target.id);
  }
  if (target.damage >= (BUILDING_STRUCTURE[target.typeId] ?? Infinity)) bringDown(world, target, s.owner);
}

/** A building shot to pieces is destroyed: its soldiers step outside and its land is lost. */
function bringDown(world: World, b: Building, by: number): void {
  const loser = b.owner;
  const label = BUILDING_TYPES[b.typeId].label;
  const stats = playerOf(world, by)?.stats;
  if (stats) stats.towersTaken++;
  for (const s of world.settlers) if (s.attackId === b.id) { s.attackId = null; s.phase = 'idle'; s.path = []; }
  destroyBuilding(world, b);
  recomputeTerritory(world);
  pushMessage(world, by, `Enemy ${label.toLowerCase()} destroyed`, 'Your war machines brought it down.', false, null);
  pushMessage(world, loser, `Your ${label.toLowerCase()} was destroyed`, 'Enemy war machines brought it down.', true, null);
  destroyBuildingsOnLostLand(world, loser);
  checkVictory(world);
}

/** How far a player is toward the economic mode's targets: each target's good, made so far and needed. */
export function economyProgress(world: World, playerId: number): { good: GoodType; made: number; target: number }[] {
  const targets = ECONOMY_TARGETS[mapSizeTypeOf(world.width)];
  const made = world.players[playerId]?.stats.goodsMade ?? {};
  return (Object.entries(targets) as [GoodType, number][]).map(([good, target]) => ({ good, made: made[good] ?? 0, target }));
}

/** A player without a castle is out; the last one standing wins. In the economic mode, the first to make every target wins. */
export function checkVictory(world: World): void {
  if (world.players.length < 2 || world.winner !== null) return;
  if (world.victoryType === 'economy') {
    const first = world.players.find((p) => !p.isEliminated && economyProgress(world, p.id).every((t) => t.made >= t.target));
    if (first) {
      world.winner = first.id;
      for (const p of world.players) {
        if (p.id === first.id) pushMessage(world, p.id, 'Victory', 'Your settlement made every goods target first.', false, null);
        else if (!isEnemy(world, p.id, first.id)) pushMessage(world, p.id, 'Victory', 'An ally\'s settlement made every goods target first.', false, null);
        else pushMessage(world, p.id, 'Defeat', 'Another settlement made every goods target first.', true, null);
      }
      return;
    }
  }
  for (const p of world.players) {
    if (!p.isEliminated && !castleOf(world, p.id)) {
      p.isEliminated = true;
      pushMessage(world, p.id, 'Defeat', 'You have lost your castle.', true, null);
    }
  }
  settleWinner(world);
}
