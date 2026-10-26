import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEPOSIT_IRON, ECONOMY_OUTSIDE_STRENGTH, TERRAIN_MOUNTAIN, castleOf, createMatch, economyProgress, loadGame, newSettler, saveGame, step, stepMatch,
  strengthOf, tileIndex
} from '../src/index.ts';
import { reachableFrom } from '../src/pathfinding.ts';
import type { BotLogEntry, SettlerType, World } from '../src/index.ts';

const count = (world: World, owner: number, type: SettlerType) => world.settlers.filter((s) => s.owner === owner && s.settlerType === type).length;

test('starting goods: few halves the materials and soldiers, many doubles them, and every tool is kept', () => {
  const normal = createMatch(5, 'calm', 'small', 'romans', 'romans');
  const few = createMatch(5, 'calm', 'small', 'romans', 'romans', 'continent', { startingGoodsType: 'few' });
  const many = createMatch(5, 'calm', 'small', 'romans', 'romans', 'continent', { startingGoodsType: 'many' });
  const stock = (w: World) => castleOf(w, 0)!.stock;
  assert.equal(stock(normal).plank + stock(normal).stone, 80);
  assert.equal(stock(few).plank + stock(few).stone, 40);
  assert.equal(stock(many).plank + stock(many).stone, 160);
  for (const tool of ['axe', 'saw', 'pick', 'scythe', 'rod', 'hammer', 'shovel'] as const) assert.ok(stock(few)[tool] >= 1, `few still has a ${tool}`);
  assert.ok(count(few, 0, 'carrier') < count(normal, 0, 'carrier') && count(normal, 0, 'carrier') < count(many, 0, 'carrier'));
  assert.equal(count(many, 0, 'swordsman'), 2 * count(normal, 0, 'swordsman'));
  assert.equal(count(few, 1, 'carrier'), count(few, 0, 'carrier'), 'both players get the same');
  assert.equal(few.startingGoodsType, 'few');
});

test('an unmirrored map has its own right half, and still gives both players a prepared start they can walk between', () => {
  for (const seed of [3, 7, 11, 19]) {
    const mirrored = createMatch(seed, 'calm', 'medium', 'romans', 'romans');
    const own = createMatch(seed, 'calm', 'medium', 'romans', 'romans', 'continent', { isMirrored: false });
    assert.equal(own.isMirrored, false);
    let same = 0, total = 0;
    for (let y = 0; y < own.height; y++) {
      for (let x = 0; x < own.width / 2; x++) {
        total++;
        if (own.terrain[tileIndex(own, x, y)] === own.terrain[tileIndex(own, own.width - 1 - x, y)]) same++;
      }
    }
    assert.ok(same / total < 0.9, `seed ${seed}: the right half is not a copy of the left`);
    let mirroredSame = 0;
    for (let y = 0; y < mirrored.height; y++) for (let x = 0; x < mirrored.width / 2; x++) if (mirrored.terrain[tileIndex(mirrored, x, y)] === mirrored.terrain[tileIndex(mirrored, mirrored.width - 1 - x, y)]) mirroredSame++;
    assert.equal(mirroredSame, total, 'a mirrored map is an exact copy');
    for (const owner of [0, 1]) {
      const c = castleOf(own, owner)!;
      let iron = 0;
      for (let y = c.y - 20; y <= c.y + 24; y++) for (let x = c.x - 20; x <= c.x + 24; x++) {
        const i = tileIndex(own, Math.max(0, Math.min(own.width - 1, x)), Math.max(0, Math.min(own.height - 1, y)));
        if (own.terrain[i] === TERRAIN_MOUNTAIN && own.deposit[i] === DEPOSIT_IRON) iron++;
      }
      assert.ok(iron > 0, `seed ${seed}: player ${owner} has iron near the castle`);
    }
    const a = castleOf(own, 0)!, b = castleOf(own, 1)!;
    assert.ok(reachableFrom(own, tileIndex(own, a.doorX, a.doorY))(tileIndex(own, b.doorX, b.doorY)), `seed ${seed}: the players can walk to each other`);
  }
});

test('the setup survives a save', () => {
  const world = createMatch(5, 'calm', 'small', 'romans', 'asians', 'islands', { isMirrored: false, startingGoodsType: 'many' });
  const copy = loadGame(JSON.parse(JSON.stringify(saveGame(world))));
  assert.equal(copy.isMirrored, false);
  assert.equal(copy.startingGoodsType, 'many');
  assert.equal(copy.mapLayout, 'islands');
});

test('with few starting goods on an unmirrored map, two built-in bots still play a match to a winner', () => {
  const world = createMatch(3, 'aggressive', 'small', 'romans', 'egyptians', 'continent', { isMirrored: false, startingGoodsType: 'few' });
  world.players[0].isBot = true;
  // Few hammers: the bot lends one to a geologist, or it never finds ore and stalls.
  // A short start builds slowly: about 100 minutes here.
  for (let t = 0; t < 120 * 600 && world.winner === null; t++) stepMatch(world);
  assert.notEqual(world.winner, null, 'the match should end within 120 minutes');
});

test('economic mode: the first to make every goods target wins, and soldiers are weak away from home', () => {
  const world = createMatch(5, 'calm', 'small', 'romans', 'romans', 'continent', { victoryType: 'economy' });
  assert.equal(world.victoryType, 'economy');
  const targets = economyProgress(world, 1);
  assert.deepEqual(targets.map((t) => t.good), ['plank', 'bread', 'meat', 'iron', 'gold']);
  // One short of the bread target: no winner yet.
  for (const t of targets) world.players[1].stats.goodsMade[t.good] = t.target;
  world.players[1].stats.goodsMade.bread = targets[1].target - 1;
  for (let k = 0; k < 20; k++) step(world);
  assert.equal(world.winner, null);
  world.players[1].stats.goodsMade.bread = targets[1].target;
  for (let k = 0; k < 20; k++) step(world);
  assert.equal(world.winner, 1);
  assert.ok(world.messages.some((m) => m.owner === 0 && m.text === 'Defeat'));
  // Outside its land a soldier hits at a quarter, whatever gold its owner has.
  const other = createMatch(5, 'calm', 'small', 'romans', 'romans', 'continent', { victoryType: 'economy' });
  const castle = castleOf(other, 0)!;
  castle.stock.gold = 100;
  const s = newSettler(other, 0, 'swordsman', Math.floor(other.width / 2), castle.doorY); s.isInside = false;
  assert.equal(strengthOf(other, s), ECONOMY_OUTSIDE_STRENGTH);
  const home = newSettler(other, 0, 'swordsman', castle.doorX, castle.doorY + 2); home.isInside = false;
  assert.equal(strengthOf(other, home), 1);
});

test('workshops count the goods they make, and the count and victory type survive a save', () => {
  const world = createMatch(5, 'calm', 'small', 'romans', 'romans', 'continent', { victoryType: 'economy' });
  world.players[0].isBot = true;
  for (let t = 0; t < 12_000; t++) stepMatch(world);
  assert.ok((world.players[0].stats.goodsMade.plank ?? 0) > 0);
  assert.equal(world.players[0].stats.goodsMade.plank, world.players[0].stats.planksMade);
  const copy = loadGame(JSON.parse(JSON.stringify(saveGame(world))));
  assert.equal(copy.victoryType, 'economy');
  assert.deepEqual(copy.players[0].stats.goodsMade, world.players[0].stats.goodsMade);
});

test('in the economic mode two built-in bots never attack, and one wins the race', () => {
  const world = createMatch(7, 'aggressive', 'small', 'romans', 'egyptians', 'continent', { victoryType: 'economy' });
  world.players[0].isBot = true;
  const log: BotLogEntry[] = [];
  for (let t = 0; t < 110 * 600 && world.winner === null; t++) stepMatch(world, [], log);
  assert.notEqual(world.winner, null, 'the race should end within 110 minutes');
  assert.ok(!log.some((e) => e.text.startsWith('attack ')), 'no attacks');
  assert.ok(world.players.every((p) => castleOf(world, p.id)), 'both castles stand');
});
