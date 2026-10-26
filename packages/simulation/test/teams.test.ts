import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEPOSIT_IRON, TERRAIN_GRASS, checkVictory, TERRAIN_MOUNTAIN, VISION_VISIBLE, castleOf, createMatch, isEnemy, isWinner, loadGame, newSettler, observe, removeBuilding,
  saveGame, step, stepMatch, tileIndex, updateVision
} from '../src/index.ts';
import { reachableFrom } from '../src/pathfinding.ts';
import type { World } from '../src/index.ts';

/** A cleared, unowned patch of grass between player 0 and player 1's castles. */
function battlefield(world: World): { x: number; y: number } {
  const a = castleOf(world, 0)!, b = castleOf(world, 1)!;
  const x = Math.round((a.doorX + b.doorX) / 2), y = Math.round((a.doorY + b.doorY) / 2);
  for (let ty = y - 3; ty <= y + 3; ty++) for (let tx = x - 3; tx <= x + 3; tx++) {
    const i = tileIndex(world, tx, ty);
    world.terrain[i] = TERRAIN_GRASS; world.tree[i] = -1; world.rock[i] = 0;
  }
  world.mapVersion++;
  return { x, y };
}

test('a match holds up to the map size\'s players, on a ring, each with a prepared start the others can walk to', () => {
  const world = createMatch(7, 'calm', 'medium', 'romans', undefined, 'continent', { allyCount: 1, enemyCount: 4 });
  assert.equal(world.players.length, 6);
  assert.deepEqual(world.players.map((p) => p.teamId), [0, 0, 1, 2, 3, 4]);
  assert.equal(world.isMirrored, false, 'only two players can mirror');
  const home = castleOf(world, 0)!;
  const reach = reachableFrom(world, tileIndex(world, home.doorX, home.doorY));
  for (const p of world.players) {
    const c = castleOf(world, p.id)!;
    assert.ok(reach(tileIndex(world, c.doorX, c.doorY)), `player ${p.id} can be reached`);
    let iron = 0;
    for (let y = c.y - 16; y <= c.y + 20; y++) for (let x = c.x - 16; x <= c.x + 20; x++) {
      if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
      const i = tileIndex(world, x, y);
      if (world.terrain[i] === TERRAIN_MOUNTAIN && world.deposit[i] === DEPOSIT_IRON) iron++;
    }
    assert.ok(iron > 0, `player ${p.id} has iron near the castle`);
    for (const q of world.players) if (q.id < p.id) {
      const d = castleOf(world, q.id)!;
      assert.ok(Math.hypot(c.x - d.x, c.y - d.y) >= 32, `players ${q.id} and ${p.id} start apart`);
    }
  }
  assert.throws(() => createMatch(7, 'calm', 'small', 'romans', undefined, 'continent', { enemyCount: 4 }), /holds 2 to 4 players/);
});

test('on an islands map with four players, each starts on an island of its own', () => {
  const world = createMatch(3, 'calm', 'medium', 'romans', undefined, 'islands', { enemyCount: 3 });
  const castles = world.players.map((p) => castleOf(world, p.id)!);
  for (const c of castles) {
    const reach = reachableFrom(world, tileIndex(world, c.doorX, c.doorY));
    for (const o of castles) if (o !== c) assert.equal(reach(tileIndex(world, o.doorX, o.doorY)), false);
  }
});

test('allies never fight each other; enemies do', () => {
  const world = createMatch(4, 'calm', 'small', 'romans', undefined, 'continent', { allyCount: 1, enemyCount: 1 });
  assert.equal(isEnemy(world, 0, 1), false);
  assert.equal(isEnemy(world, 0, 2), true);
  const spot = battlefield(world);
  const mine = newSettler(world, 0, 'swordsman', spot.x, spot.y); mine.isInside = false; mine.phase = 'idle';
  const ally = newSettler(world, 1, 'swordsman', spot.x + 1, spot.y); ally.isInside = false; ally.phase = 'idle';
  for (let t = 0; t < 200; t++) step(world);
  assert.equal(mine.health, ally.health, 'nobody was hurt');
  assert.ok(world.settlers.includes(mine) && world.settlers.includes(ally));
  const enemy = newSettler(world, 2, 'swordsman', spot.x, spot.y + 1); enemy.isInside = false; enemy.phase = 'idle';
  const before = mine.health + ally.health;
  for (let t = 0; t < 200; t++) step(world);
  assert.ok(!world.settlers.includes(enemy) || mine.health + ally.health < before, 'the enemy was fought');
  // An ally's building cannot be attacked.
  const allyCastle = castleOf(world, 1)!;
  for (let i = 0; i < world.vision[0].length; i++) world.vision[0][i] = 1;
  const [result] = step(world, [{ type: 'attackBuilding', playerId: 0, soldierIds: [mine.id], buildingId: allyCastle.id }]);
  assert.equal(result.isAccepted, false);
});

test('allies share what they see, and the observation keeps them apart from enemies', () => {
  const world = createMatch(4, 'calm', 'small', 'romans', undefined, 'continent', { allyCount: 1, enemyCount: 1 });
  updateVision(world);
  const allyCastle = castleOf(world, 1)!;
  assert.equal(world.vision[0][tileIndex(world, allyCastle.doorX, allyCastle.doorY)], VISION_VISIBLE);
  const seen = observe(world, 0);
  assert.ok(seen.allyBuildings.some((b) => b.id === allyCastle.id));
  assert.ok(!seen.enemyBuildings.some((b) => b.owner === 1));
});

test('the last team standing wins, allies included, and teams survive a save', () => {
  const world = createMatch(4, 'calm', 'medium', 'romans', undefined, 'continent', { allyCount: 1, enemyCount: 2, areEnemiesAllied: true });
  assert.deepEqual(world.players.map((p) => p.teamId), [0, 0, 1, 1]);
  const copy = loadGame(JSON.parse(JSON.stringify(saveGame(world))));
  assert.deepEqual(copy.players.map((p) => p.teamId), [0, 0, 1, 1]);
  // An ally gives up and one enemy loses its castle: one of each team still stands.
  step(world, [{ type: 'surrender', playerId: 1 }]);
  removeBuilding(world, castleOf(world, 2)!);
  checkVictory(world);
  assert.equal(world.winner, null);
  removeBuilding(world, castleOf(world, 3)!);
  checkVictory(world);
  assert.ok(world.winner !== null && isWinner(world, 0) && isWinner(world, 1) && !isWinner(world, 2));
});

test('three built-in bots, two of them allies, play a match to a winner', () => {
  const world = createMatch(7, 'aggressive', 'small', 'romans', undefined, 'continent', { allyCount: 1, enemyCount: 1 });
  world.players[0].isBot = true;
  // About 76 minutes here since workshops keep a pile of 8 of each input.
  for (let t = 0; t < 90 * 600 && world.winner === null; t++) stepMatch(world);
  assert.notEqual(world.winner, null);
  assert.ok(isWinner(world, 0) === isWinner(world, 1), 'allies win or lose together');
});
