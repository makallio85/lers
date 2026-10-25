import {
  BUILDING_TYPES, GOLD_FOR_FULL_STRENGTH, OUTSIDE_MIN_STRENGTH, SOLDIER_STATS, emptyGoods, isSoldierType
} from './definitions.ts';
import { coveringBuilding, releaseFromBuilding } from './commands.ts';
import { advance, distance, doorTile, tileOf, walkTo } from './movement.ts';
import {
  buildingById, castleOf, isMilitaryBuilding, nextRandom, playerOf, pushMessage, recomputeTerritory, removeBuilding,
  settlerById, tileIndex
} from './world.ts';
import type { Building, Settler, World } from './world.ts';

/** Soldiers outside notice enemies this close. */
export const ENGAGE_RANGE = 6;
/** A garrison sends soldiers out against enemies this close to its door. */
export const DEFEND_RADIUS = 5;
const REPATH_TICKS = 6;
/** Soldiers see through a thief's disguise this close. */
export const THIEF_SPOT_RANGE = 3;
/** A castle warns its owner at most this often while under attack. */
const CASTLE_WARNING_TICKS = 600;

/** Gold bars in the player's storage, which set its soldiers' strength outside its own land. */
export function storedGold(world: World, owner: number): number {
  let gold = 0;
  for (const b of world.buildings) if (b.owner === owner && b.isComplete && BUILDING_TYPES[b.typeId].storageCapacity > 0) gold += b.stock.gold;
  return gold;
}

/** How hard a soldier hits: always fully on its own land, outside it by the gold its owner has. */
export function strengthOf(world: World, s: Settler): number {
  if (world.territory[tileIndex(world, Math.round(s.x), Math.round(s.y))] === s.owner + 1) return 1;
  return OUTSIDE_MIN_STRENGTH + (1 - OUTSIDE_MIN_STRENGTH) * Math.min(1, storedGold(world, s.owner) / GOLD_FOR_FULL_STRENGTH);
}

/** An enemy a soldier can fight: a soldier outside, or a thief close enough to be recognised. */
function isFoe(s: Settler, other: Settler): boolean {
  if (other.owner === s.owner || other.isInside || other.health <= 0) return false;
  if (isSoldierType(other.settlerType)) return true;
  return other.settlerType === 'thief' && distance(other.x, other.y, s.x, s.y) <= THIEF_SPOT_RANGE;
}

function isAliveSoldier(s: Settler): boolean {
  return isSoldierType(s.settlerType) && s.health > 0;
}

function enemiesNear(world: World, owner: number, x: number, y: number, radius: number): Settler[] {
  return world.settlers.filter((s) => s.owner !== owner && isAliveSoldier(s) && !s.isInside
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
  const damage = stats.damage * strengthOf(world, attacker) * (0.85 + 0.3 * nextRandom(world));
  target.health -= damage;
  attacker.cooldown = stats.cooldown;
  if (target.health <= 0) {
    target.health = 0;
    const loser = playerOf(world, target.owner);
    if (loser && isSoldierType(target.settlerType)) loser.stats.soldiersLost++;
    if (target.settlerType === 'thief') pushMessage(world, target.owner, 'A thief was caught', 'Enemy soldiers saw through the disguise.', true, null);
    attacker.enemyId = null;
  }
}

/** Removes fallen soldiers from the world and from any garrison. */
export function removeDead(world: World): void {
  const dead = new Set(world.settlers.filter((s) => (isSoldierType(s.settlerType) || s.settlerType === 'thief') && s.health <= 0).map((s) => s.id));
  if (dead.size === 0) return;
  world.settlers = world.settlers.filter((s) => !dead.has(s.id));
  for (const b of world.buildings) {
    if (b.garrison.some((id) => dead.has(id))) b.garrison = b.garrison.filter((id) => !dead.has(id));
  }
  for (const s of world.settlers) if (s.enemyId !== null && dead.has(s.enemyId)) s.enemyId = null;
  releaseEmptyBuildings(world);
}

/** A tower whose garrison and defenders are all gone stops claiming land (it can then be taken). */
export function releaseEmptyBuildings(world: World): void {
  let isChanged = false;
  for (const b of world.buildings) {
    if (!b.isOccupied || b.garrison.length > 0) continue;
    const isDefended = world.settlers.some((s) => s.homeId === b.id && s.phase === 'defending' && s.health > 0);
    if (!isDefended) { b.isOccupied = false; isChanged = true; }
  }
  if (isChanged) recomputeTerritory(world);
}

function nearestEnemy(world: World, s: Settler): Settler | null {
  const current = settlerById(world, s.enemyId);
  if (current && isFoe(s, current) && distance(current.x, current.y, s.x, s.y) <= ENGAGE_RANGE + 2) return current;
  let best: Settler | null = null, bestDistance = ENGAGE_RANGE;
  for (const other of world.settlers) {
    if (!isFoe(s, other)) continue;
    const d = distance(other.x, other.y, s.x, s.y);
    if (d <= bestDistance) { bestDistance = d; best = other; }
  }
  return best;
}

/** One tick of a soldier outside a building: fight anything close, otherwise follow the current order. */
export function updateSoldier(world: World, s: Settler): void {
  if (s.health <= 0 || s.isInside) return;
  if (s.cooldown > 0) s.cooldown--;
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
  if (!target || target.owner === s.owner) { s.phase = 'idle'; s.attackId = null; s.path = []; return; }
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
  // As in the original game, the loser's buildings on land that changed hands are destroyed.
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
  checkVictory(world);
}

/** A player without a castle is out; the last one standing wins. */
export function checkVictory(world: World): void {
  if (world.players.length < 2 || world.winner !== null) return;
  for (const p of world.players) {
    if (!p.isEliminated && !castleOf(world, p.id)) {
      p.isEliminated = true;
      pushMessage(world, p.id, 'Defeat', 'You have lost your castle.', true, null);
    }
  }
  const alive = world.players.filter((p) => !p.isEliminated);
  if (alive.length === 1) world.winner = alive[0].id;
}
