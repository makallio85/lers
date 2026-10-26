import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NO_TREE, TERRAIN_GRASS, TRADE_UNLIMITED, castleOf, createMatch, landRegion, loadGame, newBuilding, newSettler, recomputeTerritory,
  saveGame, step, tileIndex
} from '../src/index.ts';
import type { Building, BuildingTypeId, Command, World } from '../src/index.ts';

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

function clear(world: World, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = tileIndex(world, x, y);
      if (world.footprint[i] !== 0 || world.door[i] !== 0) continue;
      world.terrain[i] = TERRAIN_GRASS; world.tree[i] = NO_TREE; world.rock[i] = 0;
    }
  }
  world.mapVersion++;
}

/** Player 0's home, and a colony: an occupied tower with a storage area beside it, cut off by a strip of neutral land. */
function withColony(): { world: World; castle: Building; tower: Building; store: Building } {
  const world = createMatch(4, 'calm', 'small', 'romans', 'egyptians');
  const castle = castleOf(world, 0)!;
  clear(world, castle.x - 4, castle.y - 6, castle.x + 40, castle.y + 12);
  const tower = finished(world, 'guard_tower_small', 0, castle.x + 30, castle.y);
  const guard = newSettler(world, 0, 'swordsman', tower.doorX, tower.doorY);
  tower.garrison = [guard.id]; tower.isOccupied = true; guard.homeId = tower.id; guard.phase = 'inside';
  recomputeTerritory(world);
  const store = finished(world, 'storage', 0, castle.x + 33, castle.y + 3);
  step(world);
  return { world, castle, tower, store };
}

test('carriers stay on their own land, so a cut-off colony gets nothing from home', () => {
  const { world, castle, tower } = withColony();
  assert.notEqual(landRegion(world, castle.doorX, castle.doorY), landRegion(world, tower.doorX, tower.doorY), 'two separate stretches of land');
  const site = newBuilding(world, 'woodcutter', 0, tower.x - 4, tower.y + 4);
  for (let t = 0; t < 1500; t++) step(world);
  assert.equal(site.delivered.plank + site.built.plank, 0, 'no planks cross the neutral strip');
  for (const s of world.settlers) {
    if (s.owner !== 0 || s.settlerType !== 'carrier') continue;
    const owner = world.territory[tileIndex(world, Math.round(s.x), Math.round(s.y))];
    assert.equal(owner, 1, 'every carrier is on its own land');
  }
});

test('a donkey ranch raises donkeys from grain and water', () => {
  const world = createMatch(4, 'calm', 'small', 'romans', 'egyptians');
  const castle = castleOf(world, 0)!;
  clear(world, castle.x + 5, castle.y, castle.x + 10, castle.y + 5);
  castle.stock.grain = 4; castle.stock.water = 4;
  const ranch = finished(world, 'donkey_ranch', 0, castle.x + 6, castle.y + 1);
  runUntil(world, () => world.settlers.some((s) => s.settlerType === 'donkey' && s.homeId === ranch.id), 3000);
});

test('a caravan carries ordered goods from the marketplace to the storage at the route\'s end', () => {
  const { world, castle, store } = withColony();
  const market = finished(world, 'marketplace', 0, castle.x + 7, castle.y + 1);
  for (let k = 0; k < 2; k++) { const d = newSettler(world, 0, 'donkey', market.doorX, market.doorY + 1); d.isInside = false; d.phase = 'idle'; }
  castle.stock.plank = 60;
  assert.equal(command(world, { type: 'setTradeRoute', playerId: 0, buildingId: market.id, x: store.doorX, y: store.doorY, waypoints: [] }).isAccepted, true);
  assert.equal(command(world, { type: 'setTradeGood', playerId: 0, buildingId: market.id, good: 'plank', amount: 16 }).isAccepted, true);
  assert.equal(command(world, { type: 'setTradeMode', playerId: 0, buildingId: market.id, mode: 'construction' }).isAccepted, true);
  runUntil(world, () => store.stock.plank >= 16, 8000);
  assert.equal(market.tradeRoute!.goods.plank, 0, 'the order is filled');
});

test('"only surplus" leaves storage its reserve, and a suspended route collects nothing', () => {
  const { world, castle, store } = withColony();
  const market = finished(world, 'marketplace', 0, castle.x + 7, castle.y + 1);
  castle.stock.stone = 11;
  command(world, { type: 'setTradeRoute', playerId: 0, buildingId: market.id, x: store.doorX, y: store.doorY, waypoints: [] });
  command(world, { type: 'setTradeGood', playerId: 0, buildingId: market.id, good: 'stone', amount: TRADE_UNLIMITED });
  for (let t = 0; t < 1500; t++) step(world);
  assert.ok(market.input.stone + market.incoming.stone <= 3, 'at most the 3 stone above the reserve of 8');
  command(world, { type: 'setTradeMode', playerId: 0, buildingId: market.id, mode: 'suspended' });
  const before = market.input.stone + market.incoming.stone;
  castle.stock.stone = 40;
  for (let t = 0; t < 800; t++) step(world);
  assert.ok(market.input.stone <= before + 0, 'nothing more is brought');
});

test('trade routes, modes and loads survive a save', () => {
  const { world, castle, store } = withColony();
  const market = finished(world, 'marketplace', 0, castle.x + 7, castle.y + 1);
  command(world, { type: 'setTradeRoute', playerId: 0, buildingId: market.id, x: store.doorX, y: store.doorY, waypoints: [{ x: castle.x + 20, y: castle.y + 2 }] });
  command(world, { type: 'setTradeGood', playerId: 0, buildingId: market.id, good: 'iron', amount: 8 });
  const donkey = newSettler(world, 0, 'donkey', market.doorX, market.doorY + 1);
  donkey.carrying = 'iron'; donkey.cargo = 5;
  const copy = loadGame(JSON.parse(JSON.stringify(saveGame(world))));
  const m = copy.buildings.find((b) => b.id === market.id)!;
  assert.deepEqual(m.tradeRoute, market.tradeRoute);
  assert.equal(m.tradeMode, 'surplus');
  assert.equal(copy.settlers.find((s) => s.id === donkey.id)!.cargo, 5);
});
