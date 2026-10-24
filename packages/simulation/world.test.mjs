import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, orderMove, step, save, restore } from './world.mjs';

test('same seed and commands reproduce the same state; restored games continue identically', () => {
  const a = createWorld({ unitCount: 100, seed: 42 });
  const b = createWorld({ unitCount: 100, seed: 42 });
  for (const world of [a, b]) {
    orderMove(world, 0, [0, 2, 4], { x: 50, y: 100 });
    for (let i = 0; i < 20; i++) step(world);
  }
  assert.deepEqual(save(a), save(b));
  const resumed = restore(JSON.parse(JSON.stringify(save(a))));
  for (let i = 0; i < 30; i++) { step(a); step(resumed); }
  assert.deepEqual(save(a), save(resumed));
});

test('mixed ownership orders reject atomically', () => {
  const world = createWorld({ unitCount: 4 });
  const before = save(world);
  assert.throws(() => orderMove(world, 0, [0, 1], { x: 5, y: 5 }));
  assert.deepEqual(save(world), before);
});

test('invalid targets and unit IDs never alter state', () => {
  const world = createWorld({ unitCount: 4 });
  const before = save(world);
  for (const target of [{ x: NaN, y: 0 }, { x: Infinity, y: 0 }, { x: -1, y: 0 }, { x: 5000, y: 0 }]) {
    assert.throws(() => orderMove(world, 0, [0], target));
  }
  for (const ids of [[-1], [4], [0.5]]) {
    assert.throws(() => orderMove(world, 0, ids, { x: 5, y: 5 }));
  }
  assert.deepEqual(save(world), before);
});

test('movement stops at target without overshooting and advances fixed ticks', () => {
  const world = createWorld({ unitCount: 1 });
  world.x[0] = 0; world.y[0] = 0;
  orderMove(world, 0, [0], { x: 0.1, y: 0 });
  step(world); step(world);
  assert.equal(world.x[0], 0.1);
  assert.equal(world.y[0], 0);
  assert.equal(world.tick, 2);
});

test('restore rejects corrupt or unsupported saves', () => {
  const snapshot = save(createWorld({ unitCount: 2 }));
  for (const bad of [null, {}, { ...snapshot, version: 2 }, { ...snapshot, x: [NaN, 1] },
    { ...snapshot, owner: [0, 255] }, { ...snapshot, targetX: [] }, { ...snapshot, tick: -1 }]) {
    assert.throws(() => restore(bad));
  }
});
