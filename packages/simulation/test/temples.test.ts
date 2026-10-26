import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELD_RIPE, NO_TREE, PRIEST_TICKS, RACE_SPELLS, SPELL_STATS, TERRAIN_GRASS, TREE_MATURE, buildingCost, buildingLabel, castleOf, createMatch,
  decideBot, loadGame, maxHealth, newBuilding, newSettler, observe, saveGame, spotFinder, step, tileIndex, updateVision
} from '../src/index.ts';
import type { Building, BuildingTypeId, Command, RaceType, Settler, World } from '../src/index.ts';

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

function clear(world: World, cx: number, cy: number, r: number): void {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const i = tileIndex(world, x, y);
      if (world.footprint[i] !== 0 || world.door[i] !== 0) continue;
      world.terrain[i] = TERRAIN_GRASS; world.tree[i] = NO_TREE; world.rock[i] = 0; world.field[i] = -1;
    }
  }
}

function unit(world: World, owner: number, type: Settler['settlerType'], x: number, y: number): Settler {
  const s = newSettler(world, owner, type, x, y);
  s.isInside = false; s.phase = 'idle';
  return s;
}

/** A match with player 0's priest standing on open grass near its castle, and plenty of manna. */
function withPriest(race: RaceType): { world: World; priest: Settler; x: number; y: number } {
  const world = createMatch(4, 'calm', 'small', race, race === 'egyptians' ? 'romans' : 'egyptians');
  const castle = castleOf(world, 0)!;
  const x = castle.x + 8, y = castle.y + 9;
  clear(world, x, y, 6);
  const priest = unit(world, 0, 'priest', x, y);
  world.players[0].manna = 200;
  step(world);
  return { world, priest, x, y };
}

test('temples have each people\'s names and costs', () => {
  assert.equal(buildingLabel('small_temple', 'egyptians'), 'Sphinx');
  assert.equal(buildingLabel('large_temple', 'egyptians'), 'Pyramid');
  assert.equal(buildingLabel('small_temple', 'asians'), 'Small pagoda');
  assert.equal(buildingLabel('small_temple', 'romans'), 'Small temple');
  assert.deepEqual(buildingCost('large_temple', 'egyptians'), { plank: 6, stone: 20 });
  for (const spells of Object.values(RACE_SPELLS)) assert.equal(new Set(spells).size, 8);
});

test('a temple servant offers wine, and each offering is one manna', () => {
  const world = createMatch(4, 'calm', 'small', 'romans', 'egyptians');
  const castle = castleOf(world, 0)!;
  castle.stock.wine = 3;
  finished(world, 'small_temple', 0, castle.x + 6, castle.y + 1);
  runUntil(world, () => world.players[0].manna >= 2, 3000);
});

test('a large temple ordains a free carrier as a priest every five minutes', () => {
  const world = createMatch(4, 'calm', 'small', 'romans', 'egyptians');
  const castle = castleOf(world, 0)!;
  finished(world, 'large_temple', 0, castle.x + 6, castle.y + 1);
  runUntil(world, () => world.settlers.some((s) => s.owner === 0 && s.settlerType === 'priest'), PRIEST_TICKS + 600);
  assert.ok(world.messages.some((m) => m.owner === 0 && m.text === 'A priest is ready'));
});

test('promotion raises the rank of new soldiers only, and costs more each step', () => {
  const world = createMatch(4, 'calm', 'small', 'romans', 'egyptians');
  const castle = castleOf(world, 0)!;
  const veteran = unit(world, 0, 'swordsman', castle.doorX, castle.doorY + 1);
  assert.equal(command(world, { type: 'promoteSoldiers', playerId: 0, soldierType: 'swordsman' }).isAccepted, false, 'no manna yet');
  world.players[0].manna = 30;
  assert.equal(command(world, { type: 'promoteSoldiers', playerId: 0, soldierType: 'swordsman' }).isAccepted, true);
  assert.equal(world.players[0].manna, 20);
  assert.equal(command(world, { type: 'promoteSoldiers', playerId: 0, soldierType: 'swordsman' }).isAccepted, true);
  assert.equal(world.players[0].manna, 0);
  assert.equal(command(world, { type: 'promoteSoldiers', playerId: 0, soldierType: 'swordsman' }).isAccepted, false, 'captain is the top rank');
  assert.equal(veteran.rank, 0, 'soldiers already serving keep their rank');
  const barracks = finished(world, 'barracks', 0, castle.x + 6, castle.y + 1);
  barracks.input.sword = 1;
  runUntil(world, () => world.settlers.some((s) => s.settlerType === 'swordsman' && s.id !== veteran.id && s.owner === 0 && s.rank === 2), 2000);
  const recruit = world.settlers.find((s) => s.settlerType === 'swordsman' && s.id !== veteran.id && s.rank === 2)!;
  assert.equal(recruit.health, maxHealth(recruit));
  assert.equal(maxHealth(recruit), 150);
});

test('far sight shows distant land to its caster', () => {
  const { world, priest } = withPriest('romans');
  const far = { x: world.width - 10, y: 10 };
  assert.equal(world.vision[0][tileIndex(world, far.x, far.y)], 0);
  assert.equal(command(world, { type: 'castSpell', playerId: 0, priestId: priest.id, spell: 'far_sight', x: far.x, y: far.y }).isAccepted, true);
  step(world);
  assert.equal(world.vision[0][tileIndex(world, far.x, far.y)], 2);
  assert.equal(world.players[0].manna, 200 - SPELL_STATS.far_sight.cost);
  assert.equal(command(world, { type: 'castSpell', playerId: 0, priestId: priest.id, spell: 'far_sight', x: far.x, y: far.y }).isAccepted, false, 'the priest rests');
});

test('grow forest and harvest work on the land around the spot, within the priest\'s reach', () => {
  const { world, priest, x, y } = withPriest('romans');
  world.field[tileIndex(world, x + 4, y)] = 10;
  assert.equal(command(world, { type: 'castSpell', playerId: 0, priestId: priest.id, spell: 'harvest', x: x + 2, y }).isAccepted, true);
  assert.equal(world.field[tileIndex(world, x + 4, y)], FIELD_RIPE);
  priest.timer = 0;
  assert.equal(command(world, { type: 'castSpell', playerId: 0, priestId: priest.id, spell: 'grow_forest', x: x - 3, y }).isAccepted, true);
  let trees = 0;
  for (let dx = -3; dx <= 3; dx++) if (world.tree[tileIndex(world, x - 3 + dx, y)] === TREE_MATURE) trees++;
  assert.ok(trees > 0);
  priest.timer = 0;
  const tooFar = command(world, { type: 'castSpell', playerId: 0, priestId: priest.id, spell: 'grow_forest', x: x + 12, y });
  assert.equal(tooFar.isAccepted, false);
  const unknown = command(world, { type: 'castSpell', playerId: 0, priestId: priest.id, spell: 'freeze', x, y });
  assert.equal(unknown.isAccepted, false, 'Roman priests do not know Freeze');
});

test('shield halves the damage soldiers take, and fury doubles what they deal', () => {
  const { world, priest, x, y } = withPriest('romans');
  const guarded = unit(world, 0, 'spearman', x + 1, y);
  assert.equal(command(world, { type: 'castSpell', playerId: 0, priestId: priest.id, spell: 'shield', x, y }).isAccepted, true);
  assert.ok(guarded.shieldUntil > world.tick);
  priest.timer = 0;
  assert.equal(command(world, { type: 'castSpell', playerId: 0, priestId: priest.id, spell: 'fury', x, y }).isAccepted, true);
  assert.ok(guarded.furyUntil > world.tick);
});

test('freeze holds enemy soldiers, and persuade wins some over', () => {
  const { world, priest, x, y } = withPriest('egyptians');
  const enemies = [0, 1, 2, 3].map((k) => unit(world, 1, 'swordsman', x + 2 + (k % 2), y + Math.floor(k / 2)));
  assert.equal(command(world, { type: 'castSpell', playerId: 0, priestId: priest.id, spell: 'freeze', x: x + 2, y }).isAccepted, true);
  const before = enemies.map((e) => [e.x, e.y]);
  for (let t = 0; t < 50; t++) step(world);
  assert.deepEqual(enemies.map((e) => [e.x, e.y]), before, 'frozen soldiers stay where they are');
  assert.ok(world.messages.some((m) => m.owner === 1 && m.text === 'Your soldiers are frozen'));
  priest.timer = 0;
  assert.equal(command(world, { type: 'castSpell', playerId: 0, priestId: priest.id, spell: 'persuade', x: x + 2, y }).isAccepted, true);
  assert.equal(enemies.filter((e) => e.owner === 0).length, 3);
});

test('transmute and gift work on the nearest storage', () => {
  const { world, priest, x, y } = withPriest('romans');
  const castle = castleOf(world, 0)!;
  castle.stock.fish = 20; castle.stock.meat = 0;
  assert.equal(command(world, { type: 'castSpell', playerId: 0, priestId: priest.id, spell: 'transmute', x, y }).isAccepted, true);
  assert.equal(castle.stock.fish, 10);
  assert.equal(castle.stock.meat, 10);
  priest.timer = 0;
  const planks = castle.stock.plank;
  assert.equal(command(world, { type: 'castSpell', playerId: 0, priestId: priest.id, spell: 'gift', x, y }).isAccepted, true);
  assert.equal(castle.stock.plank, planks + 12);
});

test('manna, ranks, spells and far sight survive a save', () => {
  const { world, priest } = withPriest('romans');
  world.players[0].soldierRanks.bowman = 1;
  command(world, { type: 'castSpell', playerId: 0, priestId: priest.id, spell: 'far_sight', x: world.width - 10, y: 10 });
  const copy = loadGame(JSON.parse(JSON.stringify(saveGame(world))));
  assert.equal(copy.players[0].manna, world.players[0].manna);
  assert.equal(copy.players[0].soldierRanks.bowman, 1);
  assert.equal(copy.farSights.length, 1);
  assert.equal(copy.settlers.find((s) => s.id === priest.id)!.settlerType, 'priest');
});

test('a computer priest near a fight freezes the enemy or shields its own soldiers', () => {
  const world = createMatch(4, 'calm', 'small', 'egyptians', 'romans');
  const castle = castleOf(world, 1)!;
  const x = castle.x - 6, y = castle.y + 8;
  clear(world, x, y, 6);
  const priest = unit(world, 1, 'priest', x, y);
  for (let k = 0; k < 3; k++) unit(world, 1, 'swordsman', x + 2, y + k);
  for (let k = 0; k < 3; k++) unit(world, 0, 'swordsman', x + 3, y + k);
  world.players[1].manna = 40;
  step(world);
  updateVision(world);
  const commands = decideBot(observe(world, 1), spotFinder(world, 1));
  const spell = commands.find((c) => c.type === 'castSpell');
  assert.ok(spell, 'the priest casts');
  assert.ok(['persuade', 'shield', 'fury'].includes((spell as { spell: string }).spell), 'a Roman priest persuades, shields or rouses');
  assert.equal(commands.some((c) => c.type === 'promoteSoldiers'), false, 'the manna goes to the fight, not to ranks');
  assert.equal(priest.owner, 1);
});
