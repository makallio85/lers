import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GOLD_FOR_FULL_STRENGTH, OUTSIDE_MIN_STRENGTH, SOLDIER_STATS, castleOf, createMatch, loadGame, newBuilding, newSettler,
  recomputeTerritory, saveGame, step, strengthOf, tileIndex
} from '../src/index.ts';
import type { Building, BuildingTypeId, Command, Settler, World } from '../src/index.ts';

function run(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(world);
}

function runUntil(world: World, isDone: () => boolean, maxTicks: number): void {
  for (let i = 0; i < maxTicks && !isDone(); i++) step(world);
  assert.ok(isDone(), `condition not reached within ${maxTicks} ticks`);
}

function command(world: World, c: Command) {
  return step(world, [c])[0];
}

function finished(world: World, typeId: BuildingTypeId, owner: number, x: number, y: number): Building {
  const b = newBuilding(world, typeId, owner, x, y);
  b.isComplete = true; b.levelProgress = 1; b.buildProgress = 1;
  return b;
}

function soldierAt(world: World, owner: number, type: 'swordsman' | 'spearman' | 'bowman', x: number, y: number): Settler {
  const s = newSettler(world, owner, type, x, y);
  s.isInside = false; s.phase = 'idle';
  return s;
}

/** A walkable middle-of-the-map spot, between the two starts. */
function middle(world: World): { x: number; y: number } {
  return { x: Math.floor(world.width / 2), y: Math.floor(world.height / 2) };
}

test('outside their own land soldiers fight weaker, and gold in storage brings them back to full strength', () => {
  const world = createMatch(4);
  const castle = castleOf(world, 0)!;
  const home = soldierAt(world, 0, 'swordsman', castle.doorX, castle.doorY + 1);
  const { x, y } = middle(world);
  assert.equal(world.territory[tileIndex(world, x, y)], 0);
  const away = soldierAt(world, 0, 'swordsman', x, y);
  castle.stock.gold = 0;
  assert.equal(strengthOf(world, home), 1);
  assert.equal(strengthOf(world, away), OUTSIDE_MIN_STRENGTH);
  castle.stock.gold = GOLD_FOR_FULL_STRENGTH / 2;
  assert.ok(Math.abs(strengthOf(world, away) - (OUTSIDE_MIN_STRENGTH + 1) / 2) < 1e-9);
  castle.stock.gold = GOLD_FOR_FULL_STRENGTH * 3;
  assert.equal(strengthOf(world, away), 1);
});

test('a healer heals wounded soldiers nearby who are not fighting', () => {
  const world = createMatch(4);
  const castle = castleOf(world, 0)!;
  const hut = finished(world, 'healer', 0, castle.x + 6, castle.y + 6);
  const wounded = soldierAt(world, 0, 'spearman', hut.doorX + 1, hut.doorY + 1);
  wounded.health = 40;
  const far = soldierAt(world, 0, 'spearman', hut.doorX + 12, hut.doorY);
  far.health = 40;
  runUntil(world, () => wounded.health >= SOLDIER_STATS.spearman.health, 3000);
  assert.ok(hut.workerId !== null);
  assert.equal(far.health, 40);
});

test('soldiers follow waypoints in order, and holding soldiers do not chase', () => {
  const world = createMatch(4);
  run(world, 10);
  const castle = castleOf(world, 0)!;
  const s = soldierAt(world, 0, 'swordsman', castle.doorX, castle.doorY + 1);
  const a = { x: castle.doorX + 6, y: castle.doorY + 1 }, b = { x: castle.doorX + 6, y: castle.doorY + 6 };
  assert.equal(command(world, { type: 'moveSoldiers', playerId: 0, soldierIds: [s.id], x: a.x, y: a.y }).isAccepted, true);
  assert.equal(command(world, { type: 'moveSoldiers', playerId: 0, soldierIds: [s.id], x: b.x, y: b.y, isAppending: true }).isAccepted, true);
  assert.equal(s.waypoints.length, 1);
  let isPastA = false;
  runUntil(world, () => { if (Math.hypot(s.x - a.x, s.y - a.y) < 1.5) isPastA = true; return s.phase === 'idle'; }, 600);
  assert.ok(isPastA, 'the soldier passes the first spot');
  assert.ok(Math.hypot(s.x - b.x, s.y - b.y) < 2, 'and stops at the second');

  assert.equal(command(world, { type: 'holdSoldiers', playerId: 0, soldierIds: [s.id] }).isAccepted, true);
  const spot = { x: s.x, y: s.y };
  const enemy = soldierAt(world, 1, 'bowman', s.x + 4, s.y);
  enemy.isHolding = true;
  run(world, 60);
  assert.ok(Math.hypot(s.x - spot.x, s.y - spot.y) < 0.5, 'a holding swordsman does not walk to the bowman');
});

test('patrolling soldiers walk back and forth until given another order', () => {
  const world = createMatch(4);
  run(world, 10);
  const castle = castleOf(world, 0)!;
  const s = soldierAt(world, 0, 'swordsman', castle.doorX, castle.doorY + 1);
  const start = { x: s.x, y: s.y };
  const end = { x: castle.doorX + 6, y: castle.doorY + 1 };
  assert.equal(command(world, { type: 'patrolSoldiers', playerId: 0, soldierIds: [s.id], x: end.x, y: end.y }).isAccepted, true);
  let visitsEnd = 0, visitsStart = 0, wasAtEnd = false;
  for (let t = 0; t < 600; t++) {
    step(world);
    const atEnd = Math.hypot(s.x - end.x, s.y - end.y) < 1, atStart = Math.hypot(s.x - start.x, s.y - start.y) < 1;
    if (atEnd && !wasAtEnd) visitsEnd++;
    if (atStart && wasAtEnd) visitsStart++;
    if (atEnd) wasAtEnd = true; else if (atStart) wasAtEnd = false;
  }
  assert.ok(visitsEnd >= 2 && visitsStart >= 1, `patrol visits: end ${visitsEnd}, start ${visitsStart}`);
  command(world, { type: 'moveSoldiers', playerId: 0, soldierIds: [s.id], x: start.x, y: start.y });
  assert.equal(s.isPatrolling, false);
});

test('a tower covered by another of its owner’s towers cannot be taken until that one falls', () => {
  const world = createMatch(4);
  const enemyCastle = castleOf(world, 1)!;
  // Two empty enemy towers far from the castle, close enough that the back one covers the front one.
  const front = finished(world, 'guard_tower_small', 1, enemyCastle.x - 26, enemyCastle.y);
  const back = finished(world, 'guard_tower_small', 1, enemyCastle.x - 20, enemyCastle.y);
  const guard = newSettler(world, 1, 'swordsman', back.doorX, back.doorY);
  back.garrison = [guard.id]; back.isOccupied = true; guard.homeId = back.id; guard.phase = 'inside';
  front.garrisonWanted = 0; back.garrisonWanted = 1;
  world.settlers = world.settlers.filter((s) => s.owner !== 1 || s.id === guard.id || !['swordsman', 'spearman', 'bowman'].includes(s.settlerType));
  enemyCastle.garrison = []; enemyCastle.garrisonWanted = 0;
  recomputeTerritory(world);
  run(world, 10);
  const attacker = soldierAt(world, 0, 'swordsman', front.doorX, front.doorY);
  for (let x = front.doorX - 2; x <= front.doorX + 2; x++) world.vision[0][tileIndex(world, x, front.doorY)] = 1;
  // The attack is allowed, but standing at its door does not take it while the back tower stands.
  assert.equal(command(world, { type: 'attackBuilding', playerId: 0, soldierIds: [attacker.id], buildingId: front.id }).isAccepted, true);
  run(world, 100);
  assert.equal(front.owner, 1);
});

test('a thief steals from an enemy store and carries the loot home; enemy soldiers who come close catch it', () => {
  const world = createMatch(4);
  run(world, 10);
  const castle = castleOf(world, 0)!, enemy = castleOf(world, 1)!;
  // Nobody guards the enemy castle's door, so the thief gets in.
  world.settlers = world.settlers.filter((s) => s.owner !== 1 || !['swordsman', 'spearman', 'bowman'].includes(s.settlerType));
  enemy.garrison = []; enemy.garrisonWanted = 0;
  enemy.stock.gold = 3;
  for (let x = enemy.doorX - 3; x <= enemy.doorX + 3; x++) world.vision[0][tileIndex(world, x, enemy.doorY)] = 1;
  assert.equal(command(world, { type: 'setSpecialists', playerId: 0, specialistType: 'thief', count: 1 }).isAccepted, true);
  const thief = world.settlers.find((s) => s.settlerType === 'thief')!;
  assert.equal(command(world, { type: 'moveSpecialists', playerId: 0, settlerIds: [thief.id], x: enemy.doorX, y: enemy.doorY, isWorking: true }).isAccepted, true);
  runUntil(world, () => thief.carrying === 'gold', 4000);
  assert.equal(enemy.stock.gold, 2);
  const goldAtHome = castle.stock.gold;
  runUntil(world, () => castle.stock.gold > goldAtHome || !world.settlers.includes(thief), 8000);
  assert.equal(castle.stock.gold, goldAtHome + 1);

  // A second raid with an enemy soldier waiting by the door, free to chase.
  soldierAt(world, 1, 'swordsman', enemy.doorX + 1, enemy.doorY + 1);
  command(world, { type: 'moveSpecialists', playerId: 0, settlerIds: [thief.id], x: enemy.doorX, y: enemy.doorY, isWorking: true });
  runUntil(world, () => !world.settlers.includes(thief), 6000);
});

test('phase 2 orders survive saving and loading', () => {
  const world = createMatch(4);
  run(world, 10);
  const castle = castleOf(world, 0)!;
  const s = soldierAt(world, 0, 'swordsman', castle.doorX, castle.doorY + 1);
  step(world, [{ type: 'patrolSoldiers', playerId: 0, soldierIds: [s.id], x: castle.doorX + 6, y: castle.doorY + 1 }]);
  const copy = loadGame(JSON.parse(JSON.stringify(saveGame(world))));
  assert.equal(copy.settlers.find((x) => x.id === s.id)!.isPatrolling, true);
  run(world, 200); run(copy, 200);
  assert.deepEqual(saveGame(copy), saveGame(world));
});

test('a soldier in a fight can be ordered away: it breaks off and walks to the spot', () => {
  const world = createMatch(4);
  run(world, 10);
  const castle = castleOf(world, 0)!;
  const x = castle.doorX + 4, y = castle.doorY + 4;
  const mine = soldierAt(world, 0, 'swordsman', x, y);
  const enemy = soldierAt(world, 1, 'swordsman', x + 1, y);
  for (let t = 0; t < 20 && mine.enemyId === null; t++) step(world);
  assert.equal(mine.enemyId, enemy.id, 'they are fighting');
  const away = { x: castle.doorX - 3, y: castle.doorY + 2 };
  assert.equal(command(world, { type: 'moveSoldiers', playerId: 0, soldierIds: [mine.id], x: away.x, y: away.y }).isAccepted, true);
  // The enemy is held in place so it cannot follow; the order alone must move ours.
  enemy.isHolding = true;
  for (let t = 0; t < 150 && world.settlers.includes(mine); t++) step(world);
  assert.ok(Math.hypot(mine.x - away.x, mine.y - away.y) <= 1.5, 'it walked away from the fight');
});

test('soldiers can be sent into land nobody has explored', () => {
  const world = createMatch(4);
  const castle = castleOf(world, 0)!;
  const s = soldierAt(world, 0, 'swordsman', castle.doorX, castle.doorY + 2);
  const far = { x: Math.floor(world.width / 2), y: castle.doorY };
  assert.equal(world.vision[0][tileIndex(world, far.x, far.y)], 0, 'not explored yet');
  assert.equal(command(world, { type: 'moveSoldiers', playerId: 0, soldierIds: [s.id], x: far.x, y: far.y }).isAccepted, true);
});

test('demolishing your own tower keeps the land it held', () => {
  const world = createMatch(4);
  run(world, 10);
  const castle = castleOf(world, 0)!;
  const tower = newBuilding(world, 'guard_tower_small', 0, castle.x - 12, castle.y);
  tower.isComplete = true; tower.levelProgress = 1; tower.buildProgress = 1;
  const guard = soldierAt(world, 0, 'swordsman', tower.doorX, tower.doorY);
  tower.garrison = [guard.id]; tower.isOccupied = true; guard.homeId = tower.id; guard.phase = 'inside'; guard.isInside = true;
  recomputeTerritory(world);
  const owned = () => world.territory.reduce((n, t) => n + (t === 1 ? 1 : 0), 0);
  const before = owned();
  assert.equal(command(world, { type: 'demolishBuilding', playerId: 0, buildingId: tower.id }).isAccepted, true);
  assert.equal(owned(), before, 'no land lost');
});

test('a manned tower or castle sees a thief near its door and sends a soldier out before anything is taken', () => {
  const world = createMatch(4);
  run(world, 10);
  const enemy = castleOf(world, 1)!;
  // Soldiers only inside the enemy castle: nobody stands outside to spot the thief up close.
  world.settlers = world.settlers.filter((s) => s.owner !== 1 || !['swordsman', 'spearman', 'bowman'].includes(s.settlerType) || s.isInside);
  assert.ok(enemy.garrison.length > 0);
  enemy.stock.gold = 3;
  for (let x = enemy.doorX - 3; x <= enemy.doorX + 3; x++) world.vision[0][tileIndex(world, x, enemy.doorY)] = 1;
  command(world, { type: 'setSpecialists', playerId: 0, specialistType: 'thief', count: 1 });
  const thief = world.settlers.find((s) => s.settlerType === 'thief')!;
  command(world, { type: 'moveSpecialists', playerId: 0, settlerIds: [thief.id], x: enemy.doorX, y: enemy.doorY, isWorking: true });
  runUntil(world, () => !world.settlers.includes(thief) || thief.carrying !== null, 6000);
  assert.ok(!world.settlers.includes(thief), 'the guard caught the thief');
  assert.equal(enemy.stock.gold, 3, 'before it took anything');
});
