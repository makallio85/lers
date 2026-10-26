import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDING_TYPES, DEPOSIT_COAL, FAVOURITE_FOOD_MEALS, SOLDIER_STATS, castleOf, createMatch, createWorld, loadGame,
  BOT_DECISION_TICKS, BOT_TYPE_SETTINGS, decideBot, newBuilding, spotFinder, updateVision, newSettler, observe, placementProblem, recomputeTerritory, saveGame, step, stepMatch, tileIndex
} from '../src/index.ts';
import type { BotLogEntry, Building, BuildingTypeId, World } from '../src/index.ts';

function run(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(world);
}

function runUntil(world: World, isDone: () => boolean, maxTicks: number): void {
  for (let i = 0; i < maxTicks && !isDone(); i++) step(world);
  assert.ok(isDone(), `condition not reached within ${maxTicks} ticks`);
}

/** A finished building with its worker inside, as if built long ago; skips construction in focused tests. */
function finished(world: World, typeId: BuildingTypeId, owner: number, x: number, y: number): Building {
  const b = newBuilding(world, typeId, owner, x, y);
  b.isComplete = true; b.levelProgress = 1; b.buildProgress = 1;
  return b;
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

test('match maps are mirrored and both starts get trees, rocks, water and ore', () => {
  const world = createMatch(4);
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width / 2; x++) {
      assert.equal(world.terrain[tileIndex(world, x, y)], world.terrain[tileIndex(world, world.width - 1 - x, y)]);
    }
  }
  const a = castleOf(world, 0)!, b = castleOf(world, 1)!;
  assert.equal(a.x, world.width - b.x - BUILDING_TYPES.castle.size);
  let coal = 0, iron = 0;
  for (let i = 0; i < world.deposit.length; i++) { if (world.deposit[i] === 1) coal++; if (world.deposit[i] === 2) iron++; }
  assert.ok(coal > 20 && iron > 10);
});

test('a coal mine digs coal from the deposit, longer on its favourite food', () => {
  const world = createWorld({ seed: 11 });
  const castle = castleOf(world, 0)!;
  // A small mountain with coal next to the castle, so the test does not depend on map generation.
  for (let y = castle.y - 4; y < castle.y - 1; y++) {
    for (let x = castle.x + 6; x < castle.x + 9; x++) {
      const i = tileIndex(world, x, y);
      world.terrain[i] = 2; world.tree[i] = -1; world.rock[i] = 0; world.deposit[i] = DEPOSIT_COAL; world.depositAmount[i] = 20;
    }
  }
  const mine = finished(world, 'coal_mine', 0, castle.x + 6, castle.y - 4);
  mine.input.bread = 1;
  const before = world.depositAmount.reduce((s, v) => s + v, 0);
  runUntil(world, () => mine.stock.coal + world.settlers.filter((s) => s.carrying === 'coal').length + castle.stock.coal >= 3, 3000);
  assert.ok(mine.meals <= FAVOURITE_FOOD_MEALS - 3 || mine.input.bread === 0);
  assert.ok(world.depositAmount.reduce((s, v) => s + v, 0) < before);
});

test('smiths follow orders first and the barracks turns weapons into soldiers', () => {
  const world = createWorld({ seed: 11 });
  const castle = castleOf(world, 0)!;
  const p = world.players[0];
  const smithSpot = freeSpot(world, 'toolsmith');
  const smith = finished(world, 'toolsmith', 0, smithSpot.x, smithSpot.y);
  smith.input.iron = 2; smith.input.coal = 2;
  step(world, [{ type: 'setProductionOrder', playerId: 0, good: 'scythe', count: 1 }]);
  const scythes = castle.stock.scythe;
  runUntil(world, () => smith.stock.scythe + castle.stock.scythe > scythes, 1500);
  assert.equal(p.productionOrders.scythe, 0);

  const barracksSpot = freeSpot(world, 'barracks');
  const barracks = finished(world, 'barracks', 0, barracksSpot.x, barracksSpot.y);
  barracks.input.bow = 1;
  const bowmen = () => world.settlers.filter((s) => s.settlerType === 'bowman').length;
  const before = bowmen();
  runUntil(world, () => bowmen() > before, 600);
  assert.equal(p.stats.soldiersRecruited, 1);
});

test('a share of zero keeps a good away from that kind of consumer', () => {
  const world = createWorld({ seed: 11 });
  const castle = castleOf(world, 0)!;
  castle.stock.coal = 10;
  const a = freeSpot(world, 'toolsmith');
  const toolsmith = finished(world, 'toolsmith', 0, a.x, a.y);
  const b = freeSpot(world, 'weaponsmith');
  const weaponsmith = finished(world, 'weaponsmith', 0, b.x, b.y);
  step(world, [{ type: 'setDistribution', playerId: 0, good: 'coal', buildingType: 'toolsmith', share: 0 }]);
  run(world, 600);
  assert.equal(toolsmith.input.coal + toolsmith.incoming.coal, 0);
  assert.ok(weaponsmith.input.coal + weaponsmith.incoming.coal > 0);
});

test('soldiers fight: a swordsman beats a bowman at close range', () => {
  const world = createMatch(4);
  const x = Math.floor(world.width / 2), y = Math.floor(world.height / 2);
  const sword = newSettler(world, 0, 'swordsman', x, y);
  const bow = newSettler(world, 1, 'bowman', x + 1, y);
  for (const s of [sword, bow]) { s.isInside = false; s.phase = 'idle'; }
  runUntil(world, () => !world.settlers.includes(bow) || !world.settlers.includes(sword), 600);
  assert.ok(world.settlers.includes(sword));
  assert.ok(sword.health < SOLDIER_STATS.swordsman.health);
  assert.equal(world.players[1].stats.soldiersLost, 1);
});

test('taking an undefended tower changes its owner and destroys the loser\'s buildings around it', () => {
  const world = createMatch(4);
  const enemyCastle = castleOf(world, 1)!;
  // An enemy tower with nobody inside, and an enemy woodcutter next to it.
  // Far enough from the castle that the castle's land does not cover it.
  const tower = finished(world, 'guard_tower_small', 1, enemyCastle.x - 20, enemyCastle.y);
  tower.garrisonWanted = 0;
  const hut = finished(world, 'woodcutter', 1, enemyCastle.x - 20, enemyCastle.y + 4);
  const attacker = newSettler(world, 0, 'swordsman', tower.doorX, tower.doorY);
  attacker.isInside = false; attacker.phase = 'attacking'; attacker.attackId = tower.id;
  // Remove the castle's defenders from the picture so only the tower matters.
  enemyCastle.garrisonWanted = 0;
  world.settlers = world.settlers.filter((s) => s.owner !== 1 || !['swordsman', 'spearman', 'bowman'].includes(s.settlerType));
  enemyCastle.garrison = [];
  recomputeTerritory(world);
  runUntil(world, () => tower.owner === 0, 300);
  assert.equal(tower.garrison[0], attacker.id);
  assert.equal(world.buildings.includes(hut), false);
  assert.equal(world.players[0].stats.towersTaken, 1);
});

test('observations hide what a player cannot see', () => {
  const world = createMatch(4);
  run(world, 10);
  const enemyCastle = castleOf(world, 1)!;
  const spy = newSettler(world, 1, 'swordsman', enemyCastle.doorX, enemyCastle.doorY);
  spy.isInside = false; spy.phase = 'idle';
  run(world, 10);
  const mine = observe(world, 0);
  assert.equal(mine.otherBuildings.length, 0);
  assert.equal(mine.otherSoldiers.some((s) => s.id === spy.id), false);
  assert.ok(observe(world, 1).ownSoldiers.some((s) => s.id === spy.id));
});

test('surrender ends the match; finished matches refuse commands', () => {
  const world = createMatch(4);
  const [result] = step(world, [{ type: 'surrender', playerId: 0 }]);
  assert.equal(result.isAccepted, true);
  assert.equal(world.winner, 1);
  const [after] = step(world, [{ type: 'surrender', playerId: 1 }]);
  assert.equal(after.isAccepted, false);
});

test('two built-in bots play a whole match to a winner on a small map', () => {
  const world = createMatch(4, 'aggressive', 'small');
  assert.equal(world.width, 96);
  world.players[0].isBot = true;
  for (let t = 0; t < 50 * 600 && world.winner === null; t++) stepMatch(world);
  assert.notEqual(world.winner, null, 'the match should end within 50 minutes');
  for (const p of world.players) assert.ok(p.stats.soldiersRecruited > 0);
});

test('a calm bot waits 45 minutes before attacking, and then sends a squad, not its whole army', () => {
  const world = createMatch(4, 'calm');
  const castle = castleOf(world, 1)!;
  // A weakly held tower of player 0 in plain sight of the bot, and a large free army.
  const spot = freeSpot(world, 'guard_tower_small', 1);
  const tower = finished(world, 'guard_tower_small', 0, spot.x, spot.y);
  tower.garrisonWanted = 0;
  for (let k = 0; k < 30; k++) { const s = newSettler(world, 1, 'swordsman', castle.doorX, castle.doorY + 1); s.isInside = false; }
  step(world);
  updateVision(world);
  const decide = () => decideBot(observe(world, 1), spotFinder(world, 1)).filter((c) => c.type === 'attackBuilding');
  world.tick = BOT_TYPE_SETTINGS.calm.firstAttackMinutes.medium * 600 - BOT_DECISION_TICKS;
  assert.deepEqual(decide(), []);
  world.tick = BOT_TYPE_SETTINGS.calm.firstAttackMinutes.medium * 600;
  const [attack] = decide();
  assert.ok(attack && attack.type === 'attackBuilding' && attack.buildingId === tower.id);
  assert.ok(attack.soldierIds.length < 30, `squad of ${attack.soldierIds.length}`);
  world.players[1].botType = 'aggressive';
  world.tick = BOT_DECISION_TICKS * 10;
  const [all] = decide();
  assert.ok(all && all.type === 'attackBuilding' && all.soldierIds.length >= 30);
});

test('a tower with a soldier inside stops asking for one', () => {
  const world = createMatch(4);
  const spot = freeSpot(world, 'guard_tower_small');
  const tower = finished(world, 'guard_tower_small', 0, spot.x, spot.y);
  runUntil(world, () => tower.garrison.length > 0, 600);
  run(world, 10);
  assert.equal(tower.blockedReason, null);
});

test('a bot drives an intruder off its land at once', () => {
  const world = createMatch(4, 'calm');
  const castle = castleOf(world, 1)!;
  const log: BotLogEntry[] = [];
  for (let t = 0; t < 20; t++) stepMatch(world, [], log);
  const intruder = newSettler(world, 0, 'bowman', castle.doorX - 6, castle.doorY + 3);
  intruder.isInside = false; intruder.phase = 'idle';
  for (let t = 0; t < 2 * 600 && world.settlers.includes(intruder); t++) stepMatch(world, [], log);
  assert.equal(world.settlers.includes(intruder), false, 'the intruder should be gone within 2 minutes');
  assert.ok(log.some((e) => e.playerId === 1 && e.text.startsWith('defend')));
});

test('a saved match loads and continues exactly like the original', () => {
  const world = createMatch(9);
  world.players[0].isBot = true;
  for (let t = 0; t < 6000; t++) stepMatch(world);
  world.players[1].botType = 'calm';
  const copy = loadGame(JSON.parse(JSON.stringify(saveGame(world))));
  assert.equal(copy.players[1].botType, 'calm');
  const corrupt = JSON.parse(JSON.stringify(saveGame(world)));
  corrupt.players[1].botType = 'sneaky';
  assert.throws(() => loadGame(corrupt), /bot type/);
  for (let t = 0; t < 3000; t++) { stepMatch(world); stepMatch(copy); }
  assert.deepEqual(saveGame(copy), saveGame(world));
});
