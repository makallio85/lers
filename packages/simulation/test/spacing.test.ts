import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castleOf, createMatch, newSettler, step, tileIndex } from '../src/index.ts';

test('settlers standing still keep a tile each, next to each other, and keep doors free', () => {
  const world = createMatch(5, 'calm', 'small', 'romans', 'romans');
  const castle = castleOf(world, 0)!;
  const x = castle.doorX + 4, y = castle.doorY + 3;
  const group = [
    ...['swordsman', 'swordsman', 'bowman', 'spearman', 'geologist', 'priest'].map((t) => newSettler(world, 0, t as 'swordsman', x, y)),
    newSettler(world, 0, 'catapult', x, y),
    newSettler(world, 0, 'swordsman', castle.doorX, castle.doorY)
  ];
  for (const s of group) { s.isInside = false; s.phase = 'idle'; s.homeId = null; }
  for (let t = 0; t < 120; t++) step(world);
  const tiles = group.map((s) => tileIndex(world, Math.round(s.x), Math.round(s.y)));
  assert.equal(new Set(tiles).size, group.length, 'no two share a tile');
  for (const i of tiles) assert.equal(world.door[i], 0, 'nobody stands in a doorway');
  for (const s of group.slice(0, 7)) assert.ok(Math.hypot(s.x - x, s.y - y) <= 2.9, 'they stay close together');
});
