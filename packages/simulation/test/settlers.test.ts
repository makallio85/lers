import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDING_TYPES, DEPOSIT_GOLD, NO_TREE, TERRAIN_GRASS, TERRAIN_MOUNTAIN, TREE_MATURE, VISION_NONE, WORK_AREA_REACH, castleOf, createMatch,
  createWorld, loadGame, newBuilding, placementProblem, saveGame, spotFinder, step, tileIndex, updateVision
} from '../src/index.ts';
import type { Building, BuildingTypeId, Command, World } from '../src/index.ts';

function run(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(world);
}

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

function freeSpot(world: World, typeId: BuildingTypeId, owner = 0, minRing = 3): { x: number; y: number } {
  const castle = castleOf(world, owner)!;
  for (let r = minRing; r < 40; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (placementProblem(world, owner, typeId, castle.x + dx, castle.y + dy) === null) return { x: castle.x + dx, y: castle.y + dy };
      }
    }
  }
  throw new Error(`no spot for ${typeId}`);
}

/** A 3×3 mountain next to the castle, so a test does not depend on map generation. */
function mountainBeside(world: World, deposit: number): { x: number; y: number } {
  const castle = castleOf(world, 0)!;
  const x0 = castle.x + 6, y0 = castle.y - 4;
  for (let y = y0; y < y0 + 3; y++) {
    for (let x = x0; x < x0 + 3; x++) {
      const i = tileIndex(world, x, y);
      world.terrain[i] = TERRAIN_MOUNTAIN; world.tree[i] = NO_TREE; world.rock[i] = 0; world.deposit[i] = deposit; world.depositAmount[i] = 20;
    }
  }
  return { x: x0, y: y0 };
}

test('a gold mine digs gold ore, preferring fish, and the gold smelter makes gold bars', () => {
  const world = createWorld({ seed: 11 });
  const castle = castleOf(world, 0)!;
  const m = mountainBeside(world, DEPOSIT_GOLD);
  const mine = finished(world, 'gold_mine', 0, m.x, m.y);
  mine.input.fish = 1;
  assert.equal(BUILDING_TYPES.gold_mine.mine?.favouriteFood, 'fish');
  const spot = freeSpot(world, 'gold_smelter');
  const smelter = finished(world, 'gold_smelter', 0, spot.x, spot.y);
  castle.stock.coal = 4;
  runUntil(world, () => castle.stock.gold + smelter.stock.gold + world.settlers.filter((s) => s.carrying === 'gold').length > 0, 6000);
  assert.ok(mine.meals > 0 || mine.input.fish === 0);
});

test('a lookout tower shows far beyond the usual sight of a building, without claiming land', () => {
  const world = createWorld({ seed: 11 });
  const spot = freeSpot(world, 'lookout', 0, 8);
  const lookout = finished(world, 'lookout', 0, spot.x, spot.y);
  const before = world.territory.filter((t) => t === 1).length;
  updateVision(world);
  const far = tileIndex(world, Math.min(world.width - 1, lookout.x + 1 + 20), lookout.y + 1);
  assert.notEqual(world.vision[0][far], VISION_NONE);
  assert.equal(world.territory.filter((t) => t === 1).length, before);
});

test('a woodcutter fells trees in its work area, not around its door', () => {
  const world = createWorld({ seed: 11 });
  const castle = castleOf(world, 0)!;
  const spot = freeSpot(world, 'woodcutter');
  const hut = finished(world, 'woodcutter', 0, spot.x, spot.y);
  // Clear every tree, then grow a small wood at the edge of the work area reach.
  world.tree.fill(NO_TREE);
  let wood: { x: number; y: number } | null = null;
  for (let r = 10; r <= 13 && !wood; r++) {
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
      const x = hut.doorX + dx, y = hut.doorY + dy;
      if (x < 2 || y < 2 || x >= world.width - 2 || y >= world.height - 2) continue;
      if (world.territory[tileIndex(world, x, y)] === 1 && world.terrain[tileIndex(world, x, y)] === TERRAIN_GRASS) { wood = { x, y }; break; }
    }
  }
  assert.ok(wood);
  for (let y = wood.y - 1; y <= wood.y + 1; y++) {
    for (let x = wood.x - 1; x <= wood.x + 1; x++) {
      const i = tileIndex(world, x, y);
      if (world.terrain[i] === TERRAIN_GRASS && world.footprint[i] === 0 && world.door[i] === 0 && world.territory[i] === 1) world.tree[i] = TREE_MATURE;
    }
  }
  // Out of reach from the door: the woodcutter finds nothing.
  runUntil(world, () => hut.blockedReason === 'No grown trees nearby', 3000);
  assert.equal(command(world, { type: 'setWorkArea', playerId: 0, buildingId: hut.id, x: wood.x, y: wood.y }).isAccepted, true);
  assert.equal(command(world, { type: 'setWorkArea', playerId: 0, buildingId: castle.id, x: wood.x, y: wood.y }).isAccepted, false);
  runUntil(world, () => hut.stock.log + world.settlers.filter((s) => s.carrying === 'log').length + castle.stock.log > 8, 3000);
});

test('a site marked "build first" is served before older sites, and a suspended site gets nothing', () => {
  const world = createWorld({ seed: 11 });
  const placeAt = (typeId: BuildingTypeId) => {
    const spot = freeSpot(world, typeId);
    const result = command(world, { type: 'placeBuilding', playerId: 0, buildingType: typeId, ...spot });
    assert.equal(result.isAccepted, true);
    return world.buildings.find((b) => b.id === (result as { buildingId: number }).buildingId)!;
  };
  const older = placeAt('sawmill');
  const suspended = placeAt('stonecutter');
  const urgent = placeAt('forester');
  command(world, { type: 'setBuildingPaused', playerId: 0, buildingId: suspended.id, isPaused: true });
  assert.equal(command(world, { type: 'setSitePriority', playerId: 0, buildingId: urgent.id, isPriority: true }).isAccepted, true);
  runUntil(world, () => urgent.isComplete, 4000);
  assert.equal(older.isComplete, false);
  assert.equal(suspended.levelProgress, 0);
  assert.equal(suspended.delivered.plank + suspended.incoming.plank, 0);
});

test('occupations limit diggers and builders, and free carriers become new ones when sites wait', () => {
  const world = createWorld({ seed: 11 });
  const crew = () => world.settlers.filter((s) => s.settlerType === 'digger' || s.settlerType === 'builder').length;
  const before = crew();
  command(world, { type: 'setOccupations', playerId: 0, minCarrierPercent: 30, maxCrewPercent: 0 });
  run(world, 600);
  assert.equal(crew(), before, 'diggers and builders keep their tools and jobs; the share only limits new ones');
  assert.equal(command(world, { type: 'setOccupations', playerId: 0, minCarrierPercent: 101, maxCrewPercent: 0 }).isAccepted, false);

  // Many sites and a generous share: new crew appear from free carriers, each taking a tool.
  command(world, { type: 'setOccupations', playerId: 0, minCarrierPercent: 10, maxCrewPercent: 40 });
  const castle = castleOf(world, 0)!;
  castle.stock.shovel = 5; castle.stock.hammer = 5;
  for (const typeId of ['woodcutter', 'forester', 'stonecutter', 'sawmill', 'farm'] as const) {
    const spot = freeSpot(world, typeId);
    command(world, { type: 'placeBuilding', playerId: 0, buildingType: typeId, ...spot });
  }
  const low = crew();
  run(world, 1500);
  assert.ok(crew() > low);
  assert.ok(castle.stock.shovel + castle.stock.hammer < 10);
});

test('idle builders filling the crew share never leave a site without a digger', () => {
  const world = createWorld({ seed: 11 });
  const castle = castleOf(world, 0)!;
  castle.stock.shovel = 3; castle.stock.hammer = 3;
  // No diggers left, and builders alone over the share: what a long match came to after carriers became soldiers.
  for (const s of world.settlers) if (s.settlerType === 'digger') s.settlerType = 'carrier';
  const carriers = world.settlers.filter((s) => s.settlerType === 'carrier');
  for (const s of carriers.slice(0, 6)) s.settlerType = 'builder';
  command(world, { type: 'setOccupations', playerId: 0, minCarrierPercent: 30, maxCrewPercent: 20 });
  const spot = freeSpot(world, 'guard_tower_small');
  const site = command(world, { type: 'placeBuilding', playerId: 0, buildingType: 'guard_tower_small', ...spot });
  assert.equal(site.isAccepted, true);
  run(world, 1200);
  assert.ok(world.settlers.some((s) => s.settlerType === 'digger'), 'a digger comes for the waiting tower');
  const tower = world.buildings.find((b) => b.id === (site as { buildingId: number }).buildingId)!;
  assert.ok(tower.levelProgress > 0, 'and levels its ground');
});

test('a carrier becomes a geologist with no tool, marks the ore on a mountain, and turns back into a carrier when dismissed', () => {
  const world = createWorld({ seed: 11 });
  const castle = castleOf(world, 0)!;
  const m = mountainBeside(world, DEPOSIT_GOLD);
  const hammers = castle.stock.hammer;
  assert.equal(command(world, { type: 'setSpecialists', playerId: 0, specialistType: 'geologist', count: 1 }).isAccepted, true);
  assert.equal(castle.stock.hammer, hammers, 'no tool taken');
  const geologist = world.settlers.find((s) => s.settlerType === 'geologist')!;
  assert.equal(world.prospect[0][tileIndex(world, m.x + 1, m.y + 1)], 0);
  // The bot's spot finder knows nothing about this gold yet.
  assert.equal(spotFinder(world, 0).findSpot('gold_mine', 'deposit_gold', { x: 0, y: 0 }), null);
  assert.equal(command(world, { type: 'moveSpecialists', playerId: 0, settlerIds: [geologist.id], x: m.x + 1, y: m.y + 1, isWorking: true }).isAccepted, true);
  runUntil(world, () => world.prospect[0][tileIndex(world, m.x + 1, m.y + 1)] === 1, 2000);
  assert.equal(world.prospect[1]?.[0], undefined, 'a sandbox has one player');
  assert.equal(command(world, { type: 'setSpecialists', playerId: 0, specialistType: 'geologist', count: 0 }).isAccepted, true);
  assert.equal(geologist.settlerType, 'carrier');
});

test('pioneers claim neutral land with posts, but never land an enemy tower holds', () => {
  const world = createMatch(4);
  run(world, 10);
  const castle = castleOf(world, 0)!;
  const enemy = castleOf(world, 1)!;
  // A neutral spot just beyond the start border, towards the middle.
  let target = -1;
  for (let x = castle.x + 2; x < world.width / 2 && target < 0; x++) {
    const i = tileIndex(world, x, castle.y + 2);
    if (world.territory[i] === 0 && world.vision[0][i] !== VISION_NONE && world.terrain[i] === TERRAIN_GRASS && world.rock[i] === 0) target = i;
  }
  assert.ok(target >= 0);
  assert.equal(command(world, { type: 'setSpecialists', playerId: 0, specialistType: 'pioneer', count: 2 }).isAccepted, true);
  const pioneers = world.settlers.filter((s) => s.settlerType === 'pioneer').map((s) => s.id);
  const tx = target % world.width, ty = Math.floor(target / world.width);
  assert.equal(command(world, { type: 'moveSpecialists', playerId: 0, settlerIds: pioneers, x: tx, y: ty, isWorking: true }).isAccepted, true);
  runUntil(world, () => world.territory[target] === 1, 3000);
  assert.equal(world.pioneerLand[target], 1);
  // The enemy castle's land stays the enemy's whatever pioneers do.
  const enemyLand = tileIndex(world, enemy.doorX, enemy.doorY + 2);
  // Pioneers may be sent anywhere, unexplored land included, but they claim nothing an enemy tower holds.
  assert.equal(command(world, { type: 'moveSpecialists', playerId: 0, settlerIds: pioneers, x: enemy.doorX, y: enemy.doorY + 2, isWorking: true }).isAccepted, true);
  for (let t = 0; t < 3000; t++) step(world);
  assert.equal(world.territory[enemyLand], 2);
});

test('phase 1 state survives saving and loading', () => {
  const world = createWorld({ seed: 11 });
  const spot = freeSpot(world, 'woodcutter');
  const [placed] = step(world, [{ type: 'placeBuilding', playerId: 0, buildingType: 'woodcutter', ...spot }]);
  const site = world.buildings.find((b) => b.id === (placed as { buildingId: number }).buildingId)!;
  step(world, [
    { type: 'setSitePriority', playerId: 0, buildingId: site.id, isPriority: true },
    { type: 'setOccupations', playerId: 0, minCarrierPercent: 45, maxCrewPercent: 20 },
    { type: 'setSpecialists', playerId: 0, specialistType: 'pioneer', count: 1 }
  ]);
  world.prospect[0][5] = 1; world.pioneerLand[7] = 1;
  const copy = loadGame(JSON.parse(JSON.stringify(saveGame(world))));
  assert.equal(copy.buildings.find((b) => b.id === site.id)!.isPriority, true);
  assert.equal(copy.players[0].minCarrierPercent, 45);
  assert.equal(copy.settlers.filter((s) => s.settlerType === 'pioneer').length, 1);
  assert.equal(copy.prospect[0][5], 1);
  assert.equal(copy.pioneerLand[7], 1);
  run(world, 300); run(copy, 300);
  assert.deepEqual(saveGame(copy), saveGame(world));
});

test('a work area may reach past the border, as long as part of it is on your land', () => {
  const world = createMatch(5, 'calm', 'small', 'romans', 'romans');
  const castle = castleOf(world, 0)!;
  let hut = null;
  for (let r = 6; r < 12 && !hut; r++) for (let dx = -r; dx <= r && !hut; dx++) if (placementProblem(world, 0, 'woodcutter', castle.x + dx, castle.y + r) === null) {
    hut = newBuilding(world, 'woodcutter', 0, castle.x + dx, castle.y + r);
  }
  hut!.isComplete = true;
  // Walk down from the hut to the first tile off our land: just outside the border.
  let y = hut!.doorY;
  while (y < world.height - 1 && world.territory[tileIndex(world, hut!.doorX, y)] === 1) y++;
  assert.notEqual(world.territory[tileIndex(world, hut!.doorX, y)], 1, 'a tile past the border');
  assert.equal(command(world, { type: 'setWorkArea', playerId: 0, buildingId: hut!.id, x: hut!.doorX, y }).isAccepted, true, 'centre just outside: accepted');
  // Far beyond the border, with none of the area on our land.
  const far = command(world, { type: 'setWorkArea', playerId: 0, buildingId: hut!.id, x: hut!.doorX, y: Math.max(0, hut!.doorY - 30) });
  assert.equal(far.isAccepted, false);
});

test('a work area may be set up to the reach from the building, and no farther', () => {
  const world = createMatch(5, 'calm', 'small', 'romans', 'romans');
  const castle = castleOf(world, 0)!;
  let hut = null;
  for (let r = 4; r < 12 && !hut; r++) for (let dx = -r; dx <= r && !hut; dx++) if (placementProblem(world, 0, 'woodcutter', castle.x + dx, castle.y + r) === null) {
    hut = newBuilding(world, 'woodcutter', 0, castle.x + dx, castle.y + r);
  }
  hut!.isComplete = true;
  // Straight through the castle and out the other side: own land all the way.
  const dx = castle.x - hut!.doorX, dy = castle.y - hut!.doorY, d = Math.hypot(dx, dy);
  const at = (dist: number) => ({ x: Math.round(hut!.doorX + (dx / d) * dist), y: Math.round(hut!.doorY + (dy / d) * dist) });
  const near = at(WORK_AREA_REACH - 1);
  assert.equal(command(world, { type: 'setWorkArea', playerId: 0, buildingId: hut!.id, ...near }).isAccepted, true, 'just inside the reach');
  const past = at(WORK_AREA_REACH + 2);
  const result = command(world, { type: 'setWorkArea', playerId: 0, buildingId: hut!.id, ...past });
  assert.equal(result.isAccepted, false);
  assert.equal(!result.isAccepted && result.reason, 'Too far from the building');
});

test('pioneers go on pushing the border outward from their spot, each on its own tiles', () => {
  const world = createMatch(7, 'calm', 'medium', 'romans');
  world.players[1].isBot = false;
  const castle = castleOf(world, 0)!;
  let bx = castle.x;
  while (world.territory[tileIndex(world, bx + 1, castle.y)] === 1) bx++;
  command(world, { type: 'setSpecialists', playerId: 0, specialistType: 'pioneer', count: 2 });
  run(world, 50);
  const pioneers = world.settlers.filter((s) => s.owner === 0 && s.settlerType === 'pioneer');
  assert.equal(pioneers.length, 2);
  command(world, { type: 'moveSpecialists', playerId: 0, settlerIds: pioneers.map((s) => s.id), x: bx, y: castle.y, isWorking: true });
  const own = () => world.territory.reduce((n, t) => n + (t === 1 ? 1 : 0), 0);
  const before = own();
  run(world, 2400);
  assert.ok(own() - before > 40, `four minutes of two pioneers claim well beyond the first few tiles (${own() - before})`);
  assert.ok(pioneers.every((s) => s.phase === 'claiming' || s.phase === 'moving'), 'and they are still at it');
  assert.notEqual(pioneers[0].targetTile, pioneers[1].targetTile);
});

test('specialists sent somewhere wait there; they start work only when told', () => {
  const world = createMatch(7, 'calm', 'medium', 'romans');
  world.players[1].isBot = false;
  const castle = castleOf(world, 0)!;
  let bx = castle.x;
  while (world.territory[tileIndex(world, bx + 1, castle.y)] === 1) bx++;
  command(world, { type: 'setSpecialists', playerId: 0, specialistType: 'pioneer', count: 1 });
  run(world, 50);
  const pioneer = world.settlers.find((s) => s.owner === 0 && s.settlerType === 'pioneer')!;
  const own = () => world.territory.reduce((n, t) => n + (t === 1 ? 1 : 0), 0);
  const before = own();
  command(world, { type: 'moveSpecialists', playerId: 0, settlerIds: [pioneer.id], x: bx, y: castle.y });
  run(world, 600);
  assert.equal(pioneer.phase, 'idle', 'it walked there and waits');
  assert.equal(own(), before, 'and claimed nothing');
  assert.equal(command(world, { type: 'startSpecialistWork', playerId: 0, settlerIds: [pioneer.id] }).isAccepted, true);
  run(world, 600);
  assert.ok(own() > before, 'told to, it claims land where it stands');
  assert.equal(command(world, { type: 'startSpecialistWork', playerId: 0, settlerIds: [castle.id] }).isAccepted, false);
});

test('a work area can be set while the building is still going up', () => {
  const world = createWorld({ seed: 11 });
  const spot = freeSpot(world, 'woodcutter');
  const site = command(world, { type: 'placeBuilding', playerId: 0, buildingType: 'woodcutter', ...spot });
  assert.equal(site.isAccepted, true);
  const b = world.buildings.find((x) => x.id === (site as { buildingId: number }).buildingId)!;
  assert.equal(b.isComplete, false);
  assert.equal(command(world, { type: 'setWorkArea', playerId: 0, buildingId: b.id, x: b.doorX + 3, y: b.doorY }).isAccepted, true);
  assert.equal(b.workX, b.doorX + 3);
});

test('a geologist leaves mountain that becomes another player\'s land, and never searches there', () => {
  const world = createMatch(7, 'calm', 'medium', 'romans');
  world.players[1].isBot = false;
  const castle = castleOf(world, 0)!;
  let best = -1, bestDistance = Infinity;
  for (let i = 0; i < world.terrain.length; i++) {
    if (world.terrain[i] !== TERRAIN_MOUNTAIN || world.territory[i] !== 1) continue;
    const d = Math.hypot((i % world.width) - castle.x, Math.floor(i / world.width) - castle.y);
    if (d < bestDistance) { bestDistance = d; best = i; }
  }
  command(world, { type: 'setSpecialists', playerId: 0, specialistType: 'geologist', count: 1 });
  run(world, 30);
  const geologist = world.settlers.find((s) => s.owner === 0 && s.settlerType === 'geologist')!;
  const mx = best % world.width, my = Math.floor(best / world.width);
  command(world, { type: 'moveSpecialists', playerId: 0, settlerIds: [geologist.id], x: mx, y: my, isWorking: true });
  runUntil(world, () => geologist.phase === 'prospecting' && geologist.targetTile >= 0, 3000);
  // The whole mountain around him becomes the other player's land.
  for (let y = my - 8; y <= my + 8; y++) for (let x = mx - 8; x <= mx + 8; x++) {
    if (x >= 0 && y >= 0 && x < world.width && y < world.height) world.territory[tileIndex(world, x, y)] = 2;
  }
  const before = world.prospect[0].reduce((n, v) => n + v, 0);
  run(world, 400);
  assert.equal(geologist.phase, 'idle', 'he stops');
  assert.equal(world.prospect[0].reduce((n, v) => n + v, 0), before, 'and marks nothing there');
});
