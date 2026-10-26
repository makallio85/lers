import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDING_TYPES, DEPOSIT_SULFUR, NO_TREE, RACE_TYPES, TERRAIN_MOUNTAIN, buildingCost, castleOf, computerRace, createMatch,
  createWorld, favouriteFoodOf, loadGame, newBuilding, placementProblem, saveGame, siteCost, step, storedGold, tileIndex
} from '../src/index.ts';
import type { Building, BuildingTypeId, World } from '../src/index.ts';

function finished(world: World, typeId: BuildingTypeId, owner: number, x: number, y: number): Building {
  const b = newBuilding(world, typeId, owner, x, y);
  b.isComplete = true; b.levelProgress = 1; b.buildProgress = 1;
  return b;
}

function runUntil(world: World, isDone: () => boolean, maxTicks: number): void {
  for (let i = 0; i < maxTicks && !isDone(); i++) step(world);
  assert.ok(isDone(), `condition not reached within ${maxTicks} ticks`);
}

function freeSpot(world: World, typeId: BuildingTypeId, owner = 0): { x: number; y: number } {
  const castle = castleOf(world, owner)!;
  for (let r = 3; r < 40; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (placementProblem(world, owner, typeId, castle.x + dx, castle.y + dy) === null) return { x: castle.x + dx, y: castle.y + dy };
      }
    }
  }
  throw new Error(`no spot for ${typeId}`);
}

test('each people pays its own costs, from the manual', () => {
  assert.deepEqual(buildingCost('sawmill', 'romans'), { plank: 3, stone: 4 });
  assert.deepEqual(buildingCost('sawmill', 'egyptians'), { plank: 2, stone: 5 });
  assert.deepEqual(buildingCost('sawmill', 'asians'), { plank: 4, stone: 1 });
  assert.deepEqual(buildingCost('sawmill', 'amazons'), { plank: 4, stone: 3 });
  const world = createWorld({ seed: 11, raceTypes: ['asians'] });
  const castle = castleOf(world, 0)!;
  assert.equal(castle.stock.plank, 60, 'Asians start with more planks');
  assert.equal(castle.stock.stone, 20);
  const spot = freeSpot(world, 'woodcutter');
  const [placed] = step(world, [{ type: 'placeBuilding', playerId: 0, buildingType: 'woodcutter', ...spot }]);
  const site = world.buildings.find((b) => b.id === (placed as { buildingId: number }).buildingId)!;
  assert.deepEqual(siteCost(world, site), { plank: 3, stone: 0 });
  runUntil(world, () => site.isComplete, 4000);
  assert.equal(site.built.stone, 0, 'an Asian woodcutter needs no stone');
});

test('buildings of one people cannot be built by another', () => {
  const romans = createWorld({ seed: 11, raceTypes: ['romans'] });
  const spot = freeSpot(romans, 'charcoal_maker');
  assert.equal(placementProblem(romans, 0, 'brewery', spot.x, spot.y), 'Only the Egyptians build this');
  assert.equal(placementProblem(romans, 0, 'gem_mine', spot.x, spot.y), 'Only the Egyptians and Amazons build this');
  for (const typeId of Object.keys(BUILDING_TYPES) as BuildingTypeId[]) {
    const races = BUILDING_TYPES[typeId].races;
    if (races) assert.ok(races.every((r) => RACE_TYPES.includes(r)));
  }
});

test('a Roman charcoal maker turns five planks into coal', () => {
  const world = createWorld({ seed: 11, raceTypes: ['romans'] });
  const castle = castleOf(world, 0)!;
  const spot = freeSpot(world, 'charcoal_maker');
  const maker = finished(world, 'charcoal_maker', 0, spot.x, spot.y);
  castle.stock.coal = 0;
  runUntil(world, () => maker.stock.coal + castle.stock.coal + world.settlers.filter((s) => s.carrying === 'coal').length > 0, 4000);
});

test('sulfur miners prefer rice, Amazon sulfur miners honey', () => {
  const mine = BUILDING_TYPES.sulfur_mine.mine!;
  assert.equal(favouriteFoodOf(mine, 'asians'), 'rice');
  assert.equal(favouriteFoodOf(mine, 'amazons'), 'honey');
  assert.ok(!mine.foods.includes('meat') && !mine.foods.includes('fish'), 'sulfur miners never eat meat or fish');
  const world = createWorld({ seed: 11, raceTypes: ['asians'] });
  const castle = castleOf(world, 0)!;
  const x0 = castle.x + 6, y0 = castle.y - 4;
  for (let y = y0; y < y0 + 3; y++) {
    for (let x = x0; x < x0 + 3; x++) {
      const i = tileIndex(world, x, y);
      world.terrain[i] = TERRAIN_MOUNTAIN; world.tree[i] = NO_TREE; world.rock[i] = 0; world.deposit[i] = DEPOSIT_SULFUR; world.depositAmount[i] = 20;
    }
  }
  const sulfur = finished(world, 'sulfur_mine', 0, x0, y0);
  sulfur.input.rice = 1;
  runUntil(world, () => sulfur.stock.sulfur + castle.stock.sulfur + world.settlers.filter((s) => s.carrying === 'sulfur').length > 0, 4000);
  assert.equal(sulfur.input.rice, 0);
  assert.ok(sulfur.meals >= 3, 'rice lasts five shifts for Asian sulfur miners');
});

test('for the Egyptians gold counts half and gems double toward strength', () => {
  const world = createMatch(4, 'calm', 'small', 'egyptians', 'romans');
  const mine = castleOf(world, 0)!, theirs = castleOf(world, 1)!;
  mine.stock.gold = 10; mine.stock.gems = 3;
  theirs.stock.gold = 10; theirs.stock.gems = 3;
  assert.equal(storedGold(world, 0), 5 + 6);
  assert.equal(storedGold(world, 1), 10);
});

test('the computer gets another people than the player, and races survive a save', () => {
  for (const race of RACE_TYPES) for (let seed = 1; seed < 6; seed++) assert.notEqual(computerRace(seed, race), race);
  const world = createMatch(5, 'calm', 'small', 'amazons');
  assert.equal(world.players[0].raceType, 'amazons');
  assert.notEqual(world.players[1].raceType, 'amazons');
  const copy = loadGame(JSON.parse(JSON.stringify(saveGame(world))));
  assert.deepEqual(copy.players.map((p) => p.raceType), world.players.map((p) => p.raceType));
  const corrupt = JSON.parse(JSON.stringify(saveGame(world)));
  corrupt.players[0].raceType = 'vikings';
  assert.throws(() => loadGame(corrupt), /people/);
});
