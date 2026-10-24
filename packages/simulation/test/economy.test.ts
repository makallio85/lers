import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDING_TYPES, NO_TREE, TREE_MATURE, castleOf, createWorld, placementProblem, step, tileIndex
} from '../src/index.ts';
import type { BuildingTypeId, World } from '../src/index.ts';

/** First valid spot for a building type, searched outward from the castle. */
function findSpot(world: World, typeId: BuildingTypeId): { x: number; y: number } {
  const castle = castleOf(world, 0)!;
  for (let r = 1; r < 20; r++) {
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

function place(world: World, typeId: BuildingTypeId): number {
  const { x, y } = findSpot(world, typeId);
  const [result] = step(world, [{ type: 'placeBuilding', playerId: 0, buildingType: typeId, x, y }]);
  assert.equal(result.isAccepted, true);
  return (result as { buildingId: number }).buildingId;
}

function run(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(world);
}

function building(world: World, id: number) {
  return world.buildings.find((b) => b.id === id)!;
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

test('placement rejects unavailable buildings, foreign land, blocked tiles and other players', () => {
  const world = createWorld({ seed: 3 });
  const castle = castleOf(world, 0)!;
  assert.match(placementProblem(world, 0, 'bakery', castle.x + 6, castle.y)!, /not available/);
  assert.match(placementProblem(world, 0, 'castle', castle.x + 6, castle.y)!, /cannot be placed/);
  assert.equal(placementProblem(world, 0, 'woodcutter', castle.x, castle.y), 'Another building is in the way');
  assert.equal(placementProblem(world, 0, 'woodcutter', 0, 0) !== null, true);
  const before = world.buildings.length;
  const results = step(world, [
    { type: 'placeBuilding', playerId: 1, buildingType: 'woodcutter', x: castle.x + 6, y: castle.y },
    { type: 'placeBuilding', playerId: 0, buildingType: 'nope' as BuildingTypeId, x: castle.x + 6, y: castle.y },
    { type: 'placeBuilding', playerId: 0, buildingType: 'woodcutter', x: 1.5, y: castle.y }
  ]);
  assert.deepEqual(results.map((r) => r.isAccepted), [false, false, false]);
  assert.equal(world.buildings.length, before);
});

test('carriers deliver materials and a builder finishes the construction site', () => {
  const world = createWorld({ seed: 11 });
  const castle = castleOf(world, 0)!;
  const planksBefore = castle.stock.plank;
  const id = place(world, 'woodcutter');
  run(world, 1200);
  const site = building(world, id);
  assert.equal(site.isComplete, true);
  assert.equal(castle.stock.plank, planksBefore - BUILDING_TYPES.woodcutter.cost.plank!);
  assert.ok(world.messages.some((m) => m.text === 'Woodcutter finished'));
});

test('timber chain: woodcutter logs reach the sawmill and become planks', () => {
  const world = createWorld({ seed: 11 });
  const woodcutterId = place(world, 'woodcutter');
  const sawmillId = place(world, 'sawmill');
  const planks = () => world.buildings.reduce((sum, b) => sum + b.stock.plank, 0)
    + world.settlers.filter((s) => s.carrying === 'plank').length;
  for (let i = 0; i < 3000 && !(building(world, woodcutterId).isComplete && building(world, sawmillId).isComplete); i++) step(world);
  assert.equal(building(world, sawmillId).isComplete, true);
  const planksAfterBuilding = planks();
  // Use up the starting logs so new planks must come from freshly cut trees.
  run(world, 4000);
  assert.ok(planks() > planksAfterBuilding + 8, `planks should be produced: ${planksAfterBuilding} -> ${planks()}`);
  assert.ok(world.settlers.some((s) => s.settlerType === 'carpenter'));
});

test('a woodcutter without trees reports why it is blocked', () => {
  const world = createWorld({ seed: 5 });
  world.tree.fill(NO_TREE);
  const id = place(world, 'woodcutter');
  run(world, 1200);
  assert.equal(building(world, id).blockedReason, 'No grown trees nearby');
  assert.ok(world.messages.some((m) => m.isWarning && m.text === 'Woodcutter is waiting'));
});

test('a forester plants saplings that grow into trees', () => {
  const world = createWorld({ seed: 9 });
  const id = place(world, 'forester');
  run(world, 800);
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

test('cancelling a construction site returns unused materials', () => {
  const world = createWorld({ seed: 11 });
  const castle = castleOf(world, 0)!;
  const before = { ...castle.stock };
  const id = place(world, 'sawmill');
  run(world, 110);
  const built = { ...building(world, id).built };
  assert.ok(built.plank + built.stone + built.log > 0, 'some materials should be built in already');
  const [result] = step(world, [{ type: 'cancelConstruction', playerId: 0, buildingId: id }]);
  assert.equal(result.isAccepted, true);
  run(world, 600);
  assert.deepEqual(castle.stock, {
    log: before.log - built.log, plank: before.plank - built.plank, stone: before.stone - built.stone
  });
  assert.equal(world.settlers.filter((s) => s.carrying !== null).length, 0);
  for (const b of world.buildings) for (const v of Object.values(b.reserved)) assert.equal(v, 0);
});

test('same seed and commands give the same game', () => {
  const play = () => {
    const world = createWorld({ seed: 21 });
    place(world, 'woodcutter');
    place(world, 'stonecutter');
    run(world, 1500);
    return { settlers: world.settlers.map((s) => [s.x, s.y, s.phase]), stock: castleOf(world, 0)!.stock, tree: Array.from(world.tree) };
  };
  assert.deepEqual(play(), play());
});
