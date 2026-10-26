import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHIP_TICKS, TERRAIN_WATER, TRANSPORT_CAPACITY, castleOf, createMatch, loadGame, newBuilding, newSettler, passengersOf, placementProblem,
  saveGame, step, stepMatch, tileIndex
} from '../src/index.ts';
import { reachableFrom } from '../src/pathfinding.ts';
import type { BotLogEntry, Building, BuildingTypeId, Command, Settler, World } from '../src/index.ts';

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

/** The first spot on player 0's island where a building fits, nearest the castle. */
function spotFor(world: World, typeId: BuildingTypeId): { x: number; y: number } {
  const castle = castleOf(world, 0)!;
  for (let r = 3; r < 30; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (placementProblem(world, 0, typeId, castle.x + dx, castle.y + dy) === null) return { x: castle.x + dx, y: castle.y + dy };
      }
    }
  }
  throw new Error(`no spot for ${typeId}`);
}

/** A water tile next to land, on player 0's side of the map, and the land tile beside it. */
function coast(world: World): { water: { x: number; y: number }; land: { x: number; y: number } } {
  const castle = castleOf(world, 0)!;
  for (let r = 4; r < 40; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (const dy of [-r, r]) {
        const x = castle.doorX + dx, y = castle.doorY + dy;
        if (x < 1 || y < 1 || x >= world.width / 2 || y >= world.height - 1) continue;
        if (world.terrain[tileIndex(world, x, y)] !== TERRAIN_WATER) continue;
        for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const i = tileIndex(world, x + ax, y + ay);
          if (world.terrain[i] !== TERRAIN_WATER && world.footprint[i] === 0 && world.rock[i] === 0 && world.territory[i] === 1) {
            return { water: { x, y }, land: { x: x + ax, y: y + ay } };
          }
        }
      }
    }
  }
  throw new Error('no coast');
}

test('on an islands map the players are only reachable by sea, and the layout is saved', () => {
  const world = createMatch(3, 'calm', 'medium', 'romans', 'egyptians', 'islands');
  const a = castleOf(world, 0)!, b = castleOf(world, 1)!;
  assert.equal(reachableFrom(world, tileIndex(world, a.doorX, a.doorY))(tileIndex(world, b.doorX, b.doorY)), false);
  assert.equal(loadGame(JSON.parse(JSON.stringify(saveGame(world)))).mapLayout, 'islands');
  assert.equal(createMatch(3).mapLayout, 'continent');
});

test('a shipbuilder builds the ordered transport ship from planks and iron, and launches it on the water', () => {
  const world = createMatch(3, 'calm', 'medium', 'romans', 'egyptians', 'islands');
  const castle = castleOf(world, 0)!;
  castle.stock.iron = 4;
  const spot = spotFor(world, 'shipyard');
  const yard = finished(world, 'shipyard', 0, spot.x, spot.y);
  assert.equal(command(world, { type: 'setShipOrder', playerId: 0, buildingId: yard.id, shipType: 'transport_ship', count: 1 }).isAccepted, true);
  runUntil(world, () => world.settlers.some((s) => s.settlerType === 'transport_ship'), SHIP_TICKS + 3000);
  const ship = world.settlers.find((s) => s.settlerType === 'transport_ship')!;
  assert.equal(world.terrain[tileIndex(world, Math.round(ship.x), Math.round(ship.y))], TERRAIN_WATER);
  assert.equal(yard.shipOrders.transport_ship, 0);
});

test('soldiers board a transport ship at the shore, sail to the other island and land there', () => {
  const world = createMatch(3, 'calm', 'medium', 'romans', 'egyptians', 'islands');
  const { water, land } = coast(world);
  const ship = newSettler(world, 0, 'transport_ship', water.x, water.y);
  ship.isInside = false; ship.phase = 'idle';
  const soldiers: Settler[] = [0, 1, 2].map(() => { const s = newSettler(world, 0, 'swordsman', land.x, land.y); s.isInside = false; s.phase = 'idle'; return s; });
  step(world);
  assert.equal(command(world, { type: 'boardShip', playerId: 0, shipId: ship.id, unitIds: soldiers.map((s) => s.id) }).isAccepted, true);
  assert.equal(passengersOf(world, ship).length, 3);
  assert.ok(soldiers.every((s) => s.isInside));
  const tooMany = Array.from({ length: TRANSPORT_CAPACITY.romans }, () => { const s = newSettler(world, 0, 'spearman', land.x, land.y); s.isInside = false; s.phase = 'idle'; return s; });
  assert.equal(command(world, { type: 'boardShip', playerId: 0, shipId: ship.id, unitIds: tooMany.map((s) => s.id) }).isAccepted, false, 'more than the ship holds');
  // Sail to the water off the enemy island's coast: mirrored, the same coast on the other side.
  const target = { x: world.width - 1 - water.x, y: water.y };
  for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) world.vision[0][tileIndex(world, x, y)] = 1;
  assert.equal(command(world, { type: 'moveSoldiers', playerId: 0, soldierIds: [ship.id], x: target.x, y: target.y }).isAccepted, true);
  runUntil(world, () => ship.phase === 'idle' && Math.hypot(ship.x - target.x, ship.y - target.y) < 3, 6000);
  assert.ok(soldiers.every((s) => Math.hypot(s.x - ship.x, s.y - ship.y) < 0.01), 'passengers ride along');
  assert.equal(command(world, { type: 'unloadShip', playerId: 0, shipId: ship.id }).isAccepted, true);
  for (const s of soldiers) {
    assert.equal(s.isInside, false);
    assert.notEqual(world.terrain[tileIndex(world, Math.round(s.x), Math.round(s.y))], TERRAIN_WATER, 'ashore on land');
    assert.ok(s.x > world.width / 2, 'on the other island');
  }
  assert.equal(command(world, { type: 'attackBuilding', playerId: 0, soldierIds: [ship.id], buildingId: castleOf(world, 1)!.id }).isAccepted, false);
});

test('ships and passengers survive a save', () => {
  const world = createMatch(3, 'calm', 'medium', 'romans', 'egyptians', 'islands');
  const { water, land } = coast(world);
  const ship = newSettler(world, 0, 'transport_ship', water.x, water.y); ship.isInside = false; ship.phase = 'idle';
  const s = newSettler(world, 0, 'geologist', land.x, land.y); s.isInside = false; s.phase = 'idle';
  command(world, { type: 'boardShip', playerId: 0, shipId: ship.id, unitIds: [s.id] });
  const copy = loadGame(JSON.parse(JSON.stringify(saveGame(world))));
  assert.equal(copy.settlers.find((x) => x.id === s.id)!.shipId, ship.id);
});

test('trade ships carry a landing dock\'s goods across the sea to a colony on the neutral island', () => {
  const world = createMatch(3, 'calm', 'medium', 'romans', 'egyptians', 'islands');
  const castle = castleOf(world, 0)!;
  // A colony on the neutral island: an occupied tower and a storage area on cleared land.
  const cx = Math.floor(world.width / 2) - 9, cy = Math.floor(world.height / 2) - 2;
  for (let y = cy - 1; y <= cy + 7; y++) for (let x = cx - 1; x <= cx + 5; x++) { const i = tileIndex(world, x, y); world.terrain[i] = 0; world.tree[i] = -1; world.rock[i] = 0; }
  const tower = finished(world, 'guard_tower_small', 0, cx, cy);
  const guard = newSettler(world, 0, 'swordsman', tower.doorX, tower.doorY);
  tower.garrison = [guard.id]; tower.isOccupied = true; guard.homeId = tower.id; guard.phase = 'inside';
  const store = finished(world, 'storage', 0, cx + 2, cy + 3);
  const spot = spotFor(world, 'landing_dock');
  const dock = finished(world, 'landing_dock', 0, spot.x, spot.y);
  const { water } = coast(world);
  const ship = newSettler(world, 0, 'trade_ship', water.x, water.y); ship.isInside = false; ship.phase = 'idle';
  castle.stock.plank = 80;
  step(world);
  assert.equal(command(world, { type: 'setTradeRoute', playerId: 0, buildingId: dock.id, x: store.doorX, y: store.doorY, waypoints: [] }).isAccepted, true);
  assert.equal(command(world, { type: 'setTradeGood', playerId: 0, buildingId: dock.id, good: 'plank', amount: 24 }).isAccepted, true);
  runUntil(world, () => store.stock.plank >= 24, 12_000);
  assert.equal(ship.homeId, dock.id);
});

test('on an islands map two built-in bots build ships, ferry their armies across and play to a winner', () => {
  const world = createMatch(7, 'aggressive', 'small', 'romans', 'egyptians', 'islands');
  world.players[0].isBot = true;
  const log: BotLogEntry[] = [];
  for (let t = 0; t < 75 * 600 && world.winner === null; t++) stepMatch(world, [], log);
  assert.notEqual(world.winner, null, 'the match should end within 75 minutes');
  assert.ok(log.some((e) => e.text.startsWith('land ')), 'an army went ashore across the sea');
});
