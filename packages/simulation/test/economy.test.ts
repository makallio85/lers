import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDING_TYPES, FIELD_RIPE, FISH_REGROW_TICKS, GOOD_TYPES, NO_TREE, TREE_MATURE, castleHeapSpots, castleOf, createWorld, cropQuality, groundProblem, isHeapGround, loadGame, newBuilding, placementProblem,
  saveGame, step, tileIndex
} from '../src/index.ts';
import type { BuildingTypeId, Command, World } from '../src/index.ts';

/** Goods a building holds in all. */
function totalOf(b: { stock: Record<string, number> }): number {
  return Object.values(b.stock).reduce((n, v) => n + v, 0);
}

/** First valid spot for a building type, searched outward from the castle. */
function findSpot(world: World, typeId: BuildingTypeId, minRing = 1): { x: number; y: number } {
  const castle = castleOf(world, 0)!;
  for (let r = minRing; r < 40; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = castle.x + dx, y = castle.y + dy;
        if (placementProblem(world, 0, typeId, x, y) === null) return { x, y };
      }
    }
  }
  throw new Error(`No spot for ${typeId}`);
}

function command(world: World, c: Command) {
  const [result] = step(world, [c]);
  return result;
}

function place(world: World, typeId: BuildingTypeId, minRing = 1): number {
  const { x, y } = findSpot(world, typeId, minRing);
  const result = command(world, { type: 'placeBuilding', playerId: 0, buildingType: typeId, x, y });
  assert.equal(result.isAccepted, true, `placing ${typeId}`);
  return (result as { buildingId: number }).buildingId;
}

function run(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(world);
}

function building(world: World, id: number) {
  return world.buildings.find((b) => b.id === id)!;
}

function runUntil(world: World, isDone: () => boolean, maxTicks: number): void {
  for (let i = 0; i < maxTicks && !isDone(); i++) step(world);
  assert.ok(isDone(), `condition not reached within ${maxTicks} ticks`);
}

function ownedTiles(world: World): number {
  return world.territory.reduce((sum, v) => sum + (v === 1 ? 1 : 0), 0);
}

test('the same seed generates the same map with a castle, territory, trees and rocks', () => {
  const a = createWorld({ seed: 7 });
  const b = createWorld({ seed: 7 });
  assert.deepEqual(a.terrain, b.terrain);
  assert.deepEqual(a.tree, b.tree);
  assert.ok(castleOf(a, 0));
  let trees = 0, rocks = 0;
  for (let i = 0; i < a.tree.length; i++) {
    if (a.territory[i] !== 1) continue;
    if (a.tree[i] === TREE_MATURE) trees++;
    if (a.rock[i] > 0) rocks++;
  }
  assert.ok(trees >= 15, `expected trees in territory, got ${trees}`);
  assert.ok(rocks >= 4, `expected rocks in territory, got ${rocks}`);
});

test('placement rejects unavailable buildings, blocked ground, missing water and other players', () => {
  const world = createWorld({ seed: 3 });
  const castle = castleOf(world, 0)!;
  assert.match(placementProblem(world, 0, 'castle', castle.x + 6, castle.y)!, /not available/);
  assert.match(placementProblem(world, 0, 'castle', castle.x + 6, castle.y)!, /not available/);
  assert.equal(placementProblem(world, 0, 'woodcutter', castle.x, castle.y), 'Another building is in the way');
  assert.equal(placementProblem(world, 0, 'woodcutter', 0, 0) !== null, true);
  const dry = findSpot(world, 'woodcutter');
  const waterProblem = placementProblem(world, 0, 'waterworks', dry.x, dry.y);
  assert.ok(waterProblem === null || waterProblem === 'Needs water nearby');
  const before = world.buildings.length;
  const results = step(world, [
    { type: 'placeBuilding', playerId: 1, buildingType: 'woodcutter', x: dry.x, y: dry.y },
    { type: 'placeBuilding', playerId: 0, buildingType: 'nope' as BuildingTypeId, x: dry.x, y: dry.y },
    { type: 'placeBuilding', playerId: 0, buildingType: 'woodcutter', x: 1.5, y: dry.y }
  ]);
  assert.deepEqual(results.map((r) => r.isAccepted), [false, false, false]);
  assert.equal(world.buildings.length, before);
});

test('diggers level the site before builders build it, carriers bring the materials', () => {
  const world = createWorld({ seed: 11 });
  const castle = castleOf(world, 0)!;
  const before = { ...castle.stock };
  const id = place(world, 'woodcutter');
  let sawBuildingBeforeLevelled = false;
  runUntil(world, () => {
    const b = building(world, id);
    if (b.levelProgress < 1 && b.built.plank + b.built.stone > 0) sawBuildingBeforeLevelled = true;
    return b.isComplete;
  }, 3000);
  assert.equal(sawBuildingBeforeLevelled, false);
  const cost = BUILDING_TYPES.woodcutter.cost;
  assert.equal(castle.stock.plank, before.plank - cost.plank!);
  assert.equal(castle.stock.stone, before.stone - cost.stone!);
  assert.ok(world.messages.some((m) => m.text === 'Woodcutter finished'));
});

test('timber chain: woodcutter logs reach the sawmill and become planks', () => {
  const world = createWorld({ seed: 11 });
  const woodcutterId = place(world, 'woodcutter');
  const sawmillId = place(world, 'sawmill');
  const planks = () => world.buildings.reduce((sum, b) => sum + b.stock.plank, 0)
    + world.settlers.filter((s) => s.carrying === 'plank').length;
  runUntil(world, () => building(world, woodcutterId).isComplete && building(world, sawmillId).isComplete, 4000);
  const planksAfterBuilding = planks();
  run(world, 4000);
  // With nothing to build, the sawmill fills its pile of 8 and waits until planks are needed.
  assert.ok(planks() >= planksAfterBuilding + 8, `planks should be produced: ${planksAfterBuilding} -> ${planks()}`);
  assert.ok(world.settlers.some((s) => s.settlerType === 'carpenter'));
});

test('a woodcutter without trees reports why it is blocked', () => {
  const world = createWorld({ seed: 5 });
  world.tree.fill(NO_TREE);
  const id = place(world, 'woodcutter');
  run(world, 2000);
  assert.equal(building(world, id).blockedReason, 'No grown trees nearby');
  assert.ok(world.messages.some((m) => m.isWarning && m.text === 'Woodcutter is waiting'));
});

test('a forester plants saplings that grow into trees', () => {
  const world = createWorld({ seed: 9 });
  const id = place(world, 'forester');
  run(world, 1600);
  const forester = building(world, id);
  assert.equal(forester.isComplete, true);
  let saplings = 0;
  for (let y = forester.doorY - 6; y <= forester.doorY + 6; y++) {
    for (let x = forester.doorX - 6; x <= forester.doorX + 6; x++) {
      const t = world.tree[tileIndex(world, x, y)];
      if (t >= 0 && t < TREE_MATURE) saplings++;
    }
  }
  assert.ok(saplings > 0);
});

test('a workplace without its tool waits, then takes the tool from storage', () => {
  const world = createWorld({ seed: 11 });
  const castle = castleOf(world, 0)!;
  castle.stock.saw = 0;
  const id = place(world, 'sawmill');
  runUntil(world, () => building(world, id).isComplete, 4000);
  run(world, 20);
  assert.equal(building(world, id).blockedReason, 'Missing tool: saw');
  assert.equal(building(world, id).workerId, null);
  castle.stock.saw = 1;
  runUntil(world, () => world.settlers.some((s) => s.settlerType === 'carpenter' && s.phase === 'inside'), 600);
  assert.equal(castle.stock.saw, 0);
});

test('demolishing returns half of the materials; the worker keeps trade and tool', () => {
  const world = createWorld({ seed: 11 });
  const castle = castleOf(world, 0)!;
  const id = place(world, 'woodcutter');
  runUntil(world, () => world.settlers.some((s) => s.settlerType === 'woodcutter' && s.phase !== 'toTool'), 4000);
  const planks = castle.stock.plank, stone = castle.stock.stone, axes = castle.stock.axe;
  assert.equal(command(world, { type: 'demolishBuilding', playerId: 0, buildingId: id }).isAccepted, true);
  assert.equal(castle.stock.plank, planks + 1);
  assert.equal(castle.stock.stone, stone + 1);
  assert.equal(castle.stock.axe, axes, 'the axe stays with the woodcutter');
  assert.equal(world.settlers.some((s) => s.settlerType === 'woodcutter' && s.homeId === null), true, 'a jobless woodcutter waits for the next woodcutter hut');
  assert.equal(command(world, { type: 'demolishBuilding', playerId: 0, buildingId: castle.id }).isAccepted, false);
  run(world, 600);
  for (const b of world.buildings) for (const g of GOOD_TYPES) assert.equal(b.reserved[g], 0);
});

test('a finished residence sends out new settlers', () => {
  const world = createWorld({ seed: 11 });
  const before = world.settlers.length;
  const id = place(world, 'residence_small');
  runUntil(world, () => building(world, id).isComplete, 4000);
  run(world, 61 * 10);
  assert.equal(world.settlers.length, before + 10);
});

test('an occupied guard tower expands the territory', () => {
  const world = createWorld({ seed: 11 });
  const before = ownedTiles(world);
  const id = place(world, 'guard_tower_small', 8);
  runUntil(world, () => building(world, id).isComplete, 4000);
  runUntil(world, () => world.buildings.some((b) => b.id === id && b.isOccupied), 1000);
  assert.ok(ownedTiles(world) > before, 'territory should grow');
  assert.ok(world.messages.some((m) => m.text === 'Small tower occupied'));
});

test('food chain: fields become grain, the mill makes flour, the bakery bakes bread with water', () => {
  const world = createWorld({ seed: 11 });
  const castle = castleOf(world, 0)!;
  castle.stock.plank = 200; castle.stock.stone = 200;
  const ids = (['farm', 'mill', 'waterworks', 'bakery'] as const).map((t) => place(world, t));
  runUntil(world, () => ids.every((id) => building(world, id).isComplete), 8000);
  let sawRipeField = false;
  const total = (good: 'grain' | 'flour' | 'bread') => world.buildings.reduce((s, b) => s + b.stock[good] + b.input[good], 0)
    + world.settlers.filter((s) => s.carrying === good).length;
  runUntil(world, () => {
    if (world.field.some((f) => f >= FIELD_RIPE)) sawRipeField = true;
    return world.players[0].stats.breadBaked > 0;
  }, 9000);
  assert.ok(total('bread') > 0);
  assert.ok(sawRipeField);
});

test('goods marked as not stored stay at the producer until it is full', () => {
  const world = createWorld({ seed: 11 });
  assert.equal(command(world, { type: 'setGoodStored', playerId: 0, good: 'log', isStored: false }).isAccepted, true);
  const id = place(world, 'woodcutter');
  // Enough grown trees in reach to fill the hut, whatever this map grew there.
  const hut = building(world, id);
  for (let y = hut.doorY - 6; y <= hut.doorY + 6; y++) {
    for (let x = hut.doorX - 6; x <= hut.doorX + 6; x++) {
      const i = tileIndex(world, x, y);
      if (world.territory[i] === 1 && world.footprint[i] === 0 && world.door[i] === 0 && world.tree[i] === NO_TREE && (x + y) % 3 === 0) world.tree[i] = TREE_MATURE;
    }
  }
  runUntil(world, () => building(world, id).blockedReason === 'Output full: goods wait until needed', 8000);
  assert.equal(building(world, id).stock.log, 8);
});

test('spare goods are never carried to the castle: they wait at the workplace, or go to a storage area', () => {
  const world = createWorld({ seed: 11 });
  const castle = castleOf(world, 0)!;
  const id = place(world, 'woodcutter');
  const hut = building(world, id);
  for (let y = hut.doorY - 6; y <= hut.doorY + 6; y++) {
    for (let x = hut.doorX - 6; x <= hut.doorX + 6; x++) {
      const i = tileIndex(world, x, y);
      if (world.territory[i] === 1 && world.footprint[i] === 0 && world.door[i] === 0 && world.tree[i] === NO_TREE && (x + y) % 3 === 0) world.tree[i] = TREE_MATURE;
    }
  }
  const castleLogs = castle.stock.log;
  runUntil(world, () => building(world, id).blockedReason === 'Output full: goods wait until needed', 8000);
  assert.equal(building(world, id).stock.log, 8, 'the logs wait at the woodcutter');
  assert.equal(castle.stock.log, castleLogs, 'none went to the castle');
  // With a storage area the logs go there, and the woodcutter goes on.
  const storeId = place(world, 'storage');
  runUntil(world, () => building(world, storeId).isComplete, 6000);
  runUntil(world, () => building(world, storeId).stock.log >= 8, 3000);
  assert.ok(building(world, storeId).stock.log >= 8);
  assert.equal(castle.stock.log, castleLogs);
});

test('a storage area keeps only the goods chosen for it; carriers take the rest to another store', () => {
  const world = createWorld({ seed: 11 });
  const id = place(world, 'woodcutter');
  const hut = building(world, id);
  for (let y = hut.doorY - 6; y <= hut.doorY + 6; y++) {
    for (let x = hut.doorX - 6; x <= hut.doorX + 6; x++) {
      const i = tileIndex(world, x, y);
      if (world.territory[i] === 1 && world.footprint[i] === 0 && world.door[i] === 0 && world.tree[i] === NO_TREE && (x + y) % 3 === 0) world.tree[i] = TREE_MATURE;
    }
  }
  const nearId = place(world, 'storage');
  const farId = place(world, 'storage', 6);
  // Both refuse everything while being built, so the castle's goods do not fill them before the test sets them.
  for (const id of [nearId, farId]) command(world, { type: 'setStorageGoods', playerId: 0, buildingId: id, refusedGoods: [...GOOD_TYPES] });
  runUntil(world, () => building(world, nearId).isComplete && building(world, farId).isComplete, 9000);
  // Whichever is nearer the woodcutter refuses logs.
  const d = (b: { doorX: number; doorY: number }) => Math.hypot(b.doorX - hut.doorX, b.doorY - hut.doorY);
  const [refusing, keeping] = d(building(world, nearId)) <= d(building(world, farId)) ? [nearId, farId] : [farId, nearId];
  assert.equal(command(world, { type: 'setStorageGoods', playerId: 0, buildingId: refusing, refusedGoods: ['log'] }).isAccepted, true);
  // The other keeps logs only, so the castle's goods do not fill it first.
  command(world, { type: 'setStorageGoods', playerId: 0, buildingId: keeping, refusedGoods: GOOD_TYPES.filter((g) => g !== 'log') });
  assert.deepEqual(building(world, refusing).refusedGoods, ['log']);
  assert.equal(command(world, { type: 'setStorageGoods', playerId: 0, buildingId: castleOf(world, 0)!.id, refusedGoods: [] }).isAccepted, false, 'not the castle');
  const before = building(world, refusing).stock.log;
  runUntil(world, () => building(world, keeping).stock.log >= 4, 9000);
  assert.equal(building(world, refusing).stock.log, before, 'no logs went to the store that refuses them');
  // The choice survives a save.
  assert.deepEqual(loadGame(saveGame(world)).buildings.find((b) => b.id === refusing)!.refusedGoods, ['log']);
});

test('a new storage area takes the castle\'s stored goods when carriers are free, not the ones the player does not store', () => {
  const world = createWorld({ seed: 11 });
  const castle = castleOf(world, 0)!;
  command(world, { type: 'setGoodStored', playerId: 0, good: 'bread', isStored: false });
  const storeId = place(world, 'storage');
  runUntil(world, () => building(world, storeId).isComplete, 6000);
  const planks = castle.stock.plank;
  runUntil(world, () => totalOf(building(world, storeId)) >= 20, 6000);
  assert.ok(castle.stock.plank < planks, 'planks left the castle');
  assert.equal(building(world, storeId).stock.bread, 0, 'bread is not stored');
});

test('no building goes over the ground where the castle\'s goods lie', () => {
  const world = createWorld({ seed: 11 });
  const castle = castleOf(world, 0)!;
  const spots = castleHeapSpots(world, castle).flat();
  assert.ok(spots.length >= 24, `${spots.length} heap spots`);
  for (const spot of spots) {
    const x = Math.floor(spot.x), y = Math.floor(spot.y);
    assert.ok(isHeapGround(world, x, y));
    const problem = groundProblem(world, 0, 'woodcutter', x, y);
    assert.ok(problem !== null, `a woodcutter at ${x},${y}`);
  }
  // On open grass the goods themselves are the reason.
  assert.ok(spots.some((spot) => groundProblem(world, 0, 'woodcutter', Math.floor(spot.x), Math.floor(spot.y)) === 'Goods lie here'));
});

test('transport priority and pause commands are validated and applied', () => {
  const world = createWorld({ seed: 11 });
  assert.equal(command(world, { type: 'setTransportPriority', playerId: 0, good: 'bread', position: 0 }).isAccepted, true);
  assert.equal(world.players[0].transportPriority[0], 'bread');
  assert.equal(world.players[0].transportPriority.length, GOOD_TYPES.length);
  assert.equal(command(world, { type: 'setTransportPriority', playerId: 0, good: 'bread', position: 99 }).isAccepted, false);
  const id = place(world, 'stonecutter');
  runUntil(world, () => building(world, id).isComplete, 4000);
  command(world, { type: 'setBuildingPaused', playerId: 0, buildingId: id, isPaused: true });
  run(world, 300);
  const stone = building(world, id).stock.stone;
  run(world, 600);
  assert.equal(building(world, id).blockedReason, 'Paused');
  assert.ok(building(world, id).stock.stone <= stone + 1);
});

test('a saved game loads and continues exactly like the original', () => {
  const world = createWorld({ seed: 21 });
  place(world, 'woodcutter');
  place(world, 'farm');
  run(world, 1500);
  const copy = loadGame(JSON.parse(JSON.stringify(saveGame(world))));
  for (let i = 0; i < 1500; i++) { step(world); step(copy); }
  assert.deepEqual(saveGame(copy), saveGame(world));
});

test('corrupt or foreign saves are refused', () => {
  const good = saveGame(createWorld({ seed: 2 }));
  const variants: unknown[] = [
    null, {}, { ...good, version: 99 }, { ...good, tree: [1, 2] }, { ...good, width: 5000 },
    { ...good, buildings: [] },
    { ...good, buildings: [...(good.buildings as object[]), ...(good.buildings as object[])] },
    { ...good, players: [{ id: 0, transportPriority: ['log'], isStored: {} }] },
    { ...good, settlers: [{ ...(good.settlers as Record<string, unknown>[])[0], carrying: 'gold' }] }
  ];
  for (const bad of variants) assert.throws(() => loadGame(JSON.parse(JSON.stringify(bad))), /cannot be loaded/);
});

test('same seed and commands give the same game', () => {
  const play = () => {
    const world = createWorld({ seed: 21 });
    place(world, 'woodcutter');
    place(world, 'stonecutter');
    run(world, 1500);
    return saveGame(world);
  };
  assert.deepEqual(play(), play());
});

test('statistics are sampled once a minute, count gathered goods, and survive a save', () => {
  const world = createWorld({ seed: 11 });
  const castle = castleOf(world, 0)!;
  place(world, 'woodcutter');
  run(world, 6000 - world.tick);
  const stats = world.players[0].stats;
  assert.equal(stats.history.length, 10, 'one sample per minute, the first at the start');
  assert.deepEqual(stats.history.map((s) => s.tick), Array.from({ length: 10 }, (_, k) => k * 600));
  assert.ok((stats.goodsMade.log ?? 0) > 0, 'logs the woodcutter brought home count as made');
  assert.ok(stats.history[9].land > 0 && stats.history[9].buildings >= 1 && castle.isComplete);
  const copy = loadGame(JSON.parse(JSON.stringify(saveGame(world))));
  assert.deepEqual(copy.players[0].stats.history, stats.history);
});

test('a toolsmith with no hammer in storage gets one from an idle builder, and new crews leave it alone', () => {
  const world = createWorld({ seed: 11 });
  const castle = castleOf(world, 0)!;
  // Every hammer is a builder's: the start's builders hold theirs, storage has none.
  castle.stock.hammer = 0;
  castle.stock.iron = 4; castle.stock.coal = 4;
  const id = place(world, 'toolsmith');
  const smith = building(world, id);
  runUntil(world, () => smith.isComplete, 8000);
  runUntil(world, () => smith.workerId !== null, 1200);
  assert.notEqual(smith.workerId, null, 'an idle builder handed in its hammer and the toolsmith has a worker');
});

test('land quality: fields grow at their soil pace, fishers catch only where fish are, and fishing thins the water', () => {
  const world = createWorld({ seed: 11 });
  // Soil: a field on the best tile ripens well before one on the worst.
  let good = -1, poor = -1;
  for (let i = 0; i < world.terrain.length; i++) {
    if (world.terrain[i] !== 0) continue;
    const q = cropQuality(world, i, 'grain');
    if (good < 0 || q > cropQuality(world, good, 'grain')) good = i;
    if (poor < 0 || q < cropQuality(world, poor, 'grain')) poor = i;
  }
  assert.ok(cropQuality(world, good, 'grain') > 0.8 && cropQuality(world, poor, 'grain') < 0.3);
  world.field[good] = 0; world.field[poor] = 0;
  runUntil(world, () => world.field[good] >= FIELD_RIPE, 40_000);
  assert.ok(world.field[poor] < FIELD_RIPE * 0.6, `the poor field is far behind (${world.field[poor]} of ${FIELD_RIPE})`);
  // Fish: a water tile at its stock loses one per catch and grows back slowly.
  const water = world.fish.findIndex((f) => f >= 6);
  assert.ok(water >= 0, 'some water holds fish');
  const before = world.fish[water];
  world.fish[water] = before - 3;
  run(world, FISH_REGROW_TICKS * 2 + 1);
  assert.equal(world.fish[water], before - 1, 'two came back');
  assert.ok(world.fish.some((f, i) => world.terrain[i] === 1 && f === 0), 'and some water holds none');
});

test('a gatherer whose target is no longer on its owner\'s land turns back', () => {
  const world = createWorld({ seed: 11 });
  const id = place(world, 'stonecutter');
  runUntil(world, () => building(world, id).isComplete && world.settlers.some((s) => s.homeId === id && s.phase === 'toTarget'), 8000);
  const worker = world.settlers.find((s) => s.homeId === id && s.phase === 'toTarget')!;
  const target = worker.targetTile;
  assert.ok(target >= 0);
  // The border moves under the rock: another player's land now.
  world.territory[target] = 2;
  step(world);
  assert.equal(worker.targetTile, -1, 'it lets the rock go');
  assert.equal(world.claim[target], 0);
  assert.equal(worker.phase, 'returning', 'and walks home');
});

test('the last builder keeps its hammer when a smith waits for one; a toolsmith may still take it', () => {
  const world = createWorld({ seed: 11 });
  const castle = castleOf(world, 0)!;
  castle.stock.hammer = 0;
  // One builder left, holding the only hammer.
  const builders = world.settlers.filter((s) => s.settlerType === 'builder');
  for (const s of builders.slice(1)) s.settlerType = 'carrier';
  const smith = newBuilding(world, 'weaponsmith', 0, castle.x + 8, castle.y + 8);
  smith.isComplete = true; smith.levelProgress = 1; smith.buildProgress = 1;
  run(world, 300);
  assert.equal(world.settlers.filter((s) => s.settlerType === 'builder').length, 1, 'the builder stays');
  assert.equal(smith.workerId, null);
});
