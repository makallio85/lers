import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WAIT_RADIUS, castleOf, createMatch, newBuilding, newSettler, step, tileIndex } from '../src/index.ts';
import type { Building } from '../src/index.ts';

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

test('settlers stay in the world: idle ones wait outside near storage, and step aside for a new building', () => {
  const world = createMatch(5, 'calm', 'small', 'romans', 'romans');
  const castle = castleOf(world, 0)!;
  for (let t = 0; t < 200; t++) step(world);
  const idle = world.settlers.filter((s) => s.owner === 0 && s.settlerType === 'carrier' && s.phase === 'idle');
  assert.ok(idle.length >= 10, 'the starting carriers wait for work');
  for (const s of idle) {
    assert.equal(s.isInside, false, 'outside, not in the castle');
    assert.ok(Math.hypot(s.x - (castle.x + 1.5), s.y - (castle.y + 1.5)) <= WAIT_RADIUS + 0.5, 'around the castle');
  }
  const tiles = idle.map((s) => tileIndex(world, Math.round(s.x), Math.round(s.y)));
  assert.equal(new Set(tiles).size, tiles.length, 'a tile each');
  // A building put up where some of them stand: they step out of its footprint.
  const s = idle[0];
  const x = Math.round(s.x) - 1, y = Math.round(s.y) - 1;
  const b = newBuilding(world, 'woodcutter', 0, x, y);
  b.isComplete = true;
  for (let t = 0; t < 20; t++) step(world);
  assert.equal(world.footprint[tileIndex(world, Math.round(s.x), Math.round(s.y))], 0, 'no longer inside the footprint');
});

test('a construction site takes a crew: several diggers level it and several builders put it up, each on its own spot', () => {
  const world = createMatch(5, 'calm', 'small', 'romans', 'romans');
  for (let t = 0; t < 300; t++) step(world);
  const castle = castleOf(world, 0)!;
  let site: Building | null = null;
  for (let r = 4; r < 12 && !site; r++) for (let dx = -r; dx <= r && !site; dx++) {
    const [result] = step(world, [{ type: 'placeBuilding', playerId: 0, buildingType: 'woodcutter', x: castle.x + dx, y: castle.y + r }]);
    if (result.isAccepted) site = world.buildings.find((b) => b.id === result.buildingId)!;
  }
  assert.ok(site, 'a spot for the site');
  const placed: Building = site;
  for (let t = 0; t < 400 && placed.levelProgress < 1; t++) step(world);
  for (let t = 0; t < 100 && placed.diggerIds.length < 3; t++) step(world);
  const diggers = world.settlers.filter((s) => s.settlerType === 'digger' && s.homeId === placed.id);
  assert.ok(diggers.length >= 2 || placed.levelProgress >= 1, 'several diggers on one site');
  for (let t = 0; t < 3000 && !placed.isComplete; t++) {
    step(world);
    const builders = world.settlers.filter((s) => s.settlerType === 'builder' && s.homeId === placed.id && s.phase === 'building');
    const tiles = new Set(builders.map((s) => tileIndex(world, Math.round(s.x), Math.round(s.y))));
    assert.equal(tiles.size, builders.length, 'each builder on its own spot');
  }
  assert.ok(placed.isComplete, 'the crew finishes it');
});
