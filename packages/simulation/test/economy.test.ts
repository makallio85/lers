import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDING_TYPES, FIELD_RIPE, GOOD_TYPES, NO_TREE, TREE_MATURE, castleOf, createWorld, loadGame, placementProblem,
  saveGame, step, tileIndex
} from '../src/index.ts';
import type { BuildingTypeId, Command, World } from '../src/index.ts';

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
  assert.match(placementProblem(world, 0, 'gold_mine', castle.x + 6, castle.y)!, /not available/);
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
  assert.ok(planks() > planksAfterBuilding + 8, `planks should be produced: ${planksAfterBuilding} -> ${planks()}`);
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

test('demolishing returns half of the materials; the worker hands in the tool', () => {
  const world = createWorld({ seed: 11 });
  const castle = castleOf(world, 0)!;
  const id = place(world, 'woodcutter');
  runUntil(world, () => world.settlers.some((s) => s.settlerType === 'woodcutter' && s.phase !== 'toTool'), 4000);
  const planks = castle.stock.plank, stone = castle.stock.stone, axes = castle.stock.axe;
  assert.equal(command(world, { type: 'demolishBuilding', playerId: 0, buildingId: id }).isAccepted, true);
  assert.equal(castle.stock.plank, planks + 1);
  assert.equal(castle.stock.stone, stone + 1);
  assert.equal(castle.stock.axe, axes + 1);
  assert.equal(world.settlers.some((s) => s.settlerType === 'woodcutter'), false);
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
  runUntil(world, () => building(world, id).blockedReason === 'Output full: waiting for carriers', 8000);
  assert.equal(building(world, id).stock.log, 8);
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
