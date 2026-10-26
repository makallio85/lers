import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDING_STRUCTURE, NO_TREE, TERRAIN_GRASS, WAR_MACHINE_STATS, castleOf, createMatch, isMachinePassable, loadGame, newBuilding, newSettler,
  placementProblem, recomputeTerritory, saveGame, step, tileIndex
} from '../src/index.ts';
import type { Building, BuildingTypeId, Command, Settler, World } from '../src/index.ts';

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

/** Open grass around a point, so a war machine can roll there. */
function clear(world: World, cx: number, cy: number, r: number): void {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const i = tileIndex(world, x, y);
      if (world.footprint[i] !== 0) continue;
      world.terrain[i] = TERRAIN_GRASS; world.tree[i] = NO_TREE; world.rock[i] = 0;
    }
  }
  world.mapVersion++;
}

function machineAt(world: World, owner: number, type: 'catapult' | 'ballista' | 'cannon' | 'war_gong', x: number, y: number, hall: Building | null): Settler {
  const m = newSettler(world, owner, type, x, y);
  m.isInside = false; m.phase = 'idle'; m.homeId = hall?.id ?? null;
  return m;
}

/** An enemy small tower with one soldier inside, out in the open, which player 0 can see. */
function enemyTower(world: World): Building {
  const enemyCastle = castleOf(world, 1)!;
  const tx = enemyCastle.x - 14, ty = enemyCastle.y + 1;
  clear(world, tx + 1, ty + 4, 12);
  const tower = finished(world, 'guard_tower_small', 1, tx, ty);
  const guard = newSettler(world, 1, 'swordsman', tower.doorX, tower.doorY);
  tower.garrison = [guard.id]; tower.isOccupied = true; tower.garrisonWanted = 1; guard.homeId = tower.id; guard.phase = 'inside';
  recomputeTerritory(world);
  for (let y = ty - 2; y <= ty + 8; y++) for (let x = tx - 10; x <= tx + 4; x++) world.vision[0][tileIndex(world, x, y)] = 1;
  return tower;
}

test('each people has its own war machine hall', () => {
  const world = createMatch(4, 'calm', 'small', 'romans', 'asians');
  const castle = castleOf(world, 0)!;
  clear(world, castle.x + 8, castle.y + 2, 4);
  assert.equal(placementProblem(world, 0, 'cannon_hall', castle.x + 7, castle.y + 1), 'Only the Asians build this');
  assert.equal(placementProblem(world, 0, 'catapult_hall', castle.x + 7, castle.y + 1), null);
  for (const stats of Object.values(WAR_MACHINE_STATS)) assert.ok(stats.shots > 0 && stats.range > 0 && stats.accuracy <= 1);
});

test('a machinist builds a catapult from iron, planks and stone, up to three in the field', () => {
  const world = createMatch(4, 'calm', 'small', 'romans', 'asians');
  const castle = castleOf(world, 0)!;
  castle.stock.iron = 12; castle.stock.hammer = Math.max(castle.stock.hammer, 1);
  const hall = finished(world, 'catapult_hall', 0, castle.x + 7, castle.y + 1);
  runUntil(world, () => world.settlers.some((s) => s.settlerType === 'catapult'), 6000);
  const catapult = world.settlers.find((s) => s.settlerType === 'catapult')!;
  assert.equal(catapult.homeId, hall.id);
  assert.equal(catapult.ammo, WAR_MACHINE_STATS.catapult.shots);
  assert.ok(world.messages.some((m) => m.owner === 0 && m.text === 'Catapult ready'));
});

test('a catapult rolls into range, shoots a tower down, and its soldier steps outside', () => {
  const world = createMatch(4, 'calm', 'small', 'romans', 'asians');
  const tower = enemyTower(world);
  const catapult = machineAt(world, 0, 'catapult', tower.doorX - 9, tower.doorY + 2, null);
  catapult.ammo = 100;
  assert.equal(command(world, { type: 'attackBuilding', playerId: 0, soldierIds: [catapult.id], buildingId: tower.id }).isAccepted, true);
  let closest = Infinity;
  runUntil(world, () => {
    closest = Math.min(closest, Math.hypot(catapult.x - tower.doorX, catapult.y - tower.doorY));
    return !world.buildings.includes(tower);
  }, 8000);
  assert.ok(closest > 2, 'it shoots from a distance instead of walking to the door');
  assert.ok(world.messages.some((m) => m.owner === 1 && m.text === 'Your small tower is under fire'));
  assert.ok(world.messages.some((m) => m.owner === 1 && m.text === 'Your small tower was destroyed'));
  assert.ok(world.settlers.some((s) => s.owner === 1 && s.settlerType === 'swordsman' && !s.isInside), 'the garrison stands outside');
  assert.ok(BUILDING_STRUCTURE.guard_tower_small! > 0);
});

test('out of ammunition, a war machine reloads at its hall and goes back to its target', () => {
  const world = createMatch(4, 'calm', 'small', 'romans', 'asians');
  const castle = castleOf(world, 0)!;
  const tower = enemyTower(world);
  clear(world, castle.x + 8, castle.y + 5, 6);
  const hall = finished(world, 'catapult_hall', 0, castle.x + 7, castle.y + 1);
  hall.input.stone = 6;
  const catapult = machineAt(world, 0, 'catapult', hall.doorX + 1, hall.doorY + 1, hall);
  catapult.ammo = 0;
  assert.equal(command(world, { type: 'attackBuilding', playerId: 0, soldierIds: [catapult.id], buildingId: tower.id }).isAccepted, true);
  runUntil(world, () => catapult.ammo > 0, 600);
  assert.equal(hall.input.stone, 0, 'the shots come out of the hall');
  assert.equal(catapult.phase, 'attacking');
  assert.equal(catapult.homeId, hall.id, 'the attack order keeps the hall');
});

test('war machines keep to open ground: no forest, rocks or mountains', () => {
  const world = createMatch(4, 'calm', 'small', 'romans', 'asians');
  const castle = castleOf(world, 0)!;
  const x = castle.x + 9, y = castle.y + 8;
  clear(world, x, y, 5);
  const tree = tileIndex(world, x + 2, y);
  world.tree[tree] = 60;
  assert.equal(isMachinePassable(world, tree), false);
  assert.equal(isMachinePassable(world, tileIndex(world, x + 2, y + 1)), true);
  const catapult = machineAt(world, 0, 'catapult', x, y, null);
  step(world);
  const moved = command(world, { type: 'moveSoldiers', playerId: 0, soldierIds: [catapult.id], x: x + 4, y });
  assert.equal(moved.isAccepted, true, String((moved as { reason?: string }).reason));
  assert.ok(catapult.path.length > 0 && !catapult.path.includes(tree), 'the route goes round the tree');
});

test('soldiers break enemy war machines, which never fight back', () => {
  const world = createMatch(4, 'calm', 'small', 'romans', 'asians');
  const castle = castleOf(world, 0)!;
  const x = castle.x + 10, y = castle.y + 8;
  clear(world, x, y, 4);
  const cannon = machineAt(world, 1, 'cannon', x, y, null);
  const soldier = newSettler(world, 0, 'swordsman', x + 1, y);
  soldier.isInside = false; soldier.phase = 'idle';
  runUntil(world, () => !world.settlers.includes(cannon), 600);
  assert.equal(soldier.health, 100, 'the cannon never hit back');
  assert.ok(world.messages.some((m) => m.owner === 1 && m.text === 'Your cannon was destroyed'));
});

test('war machines and building damage survive a save', () => {
  const world = createMatch(4, 'calm', 'small', 'romans', 'asians');
  const tower = enemyTower(world);
  tower.damage = 33.5;
  const gong = machineAt(world, 0, 'war_gong', tower.doorX - 6, tower.doorY, null);
  gong.ammo = 1;
  const copy = loadGame(JSON.parse(JSON.stringify(saveGame(world))));
  assert.equal(copy.buildings.find((b) => b.id === tower.id)!.damage, 33.5);
  const loaded = copy.settlers.find((s) => s.id === gong.id)!;
  assert.equal(loaded.settlerType, 'war_gong');
  assert.equal(loaded.ammo, 1);
});
