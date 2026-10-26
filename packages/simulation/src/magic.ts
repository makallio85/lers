import {
  BUILDING_TYPES, PRIEST_REST_TICKS, PROMOTION_COSTS, RACE_GIFTS, RACE_SPELLS, RACE_TRANSMUTES, RANK_BONUS, RANK_LABELS, SETTLER_PLURALS,
  SOLDIER_STATS, SPELL_RANGE, SPELL_STATS, GOOD_LABELS, GOOD_TYPES, isSoldierType
} from './definitions.ts';
import type { SoldierType, SpellType } from './definitions.ts';
import { distance } from './movement.ts';
import {
  NO_FIELD, NO_TREE, ROCK_STONE, TERRAIN_GRASS, TREE_MATURE, FIELD_RIPE, VISION_VISIBLE, inBounds, isStorageBuilding, playerOf, pushMessage, tileIndex
} from './world.ts';
import type { Building, Settler, World } from './world.ts';

/** A soldier's full health: its type's, plus the bonus of its rank. */
export function maxHealth(s: Settler): number {
  return isSoldierType(s.settlerType) ? SOLDIER_STATS[s.settlerType].health * (1 + RANK_BONUS * s.rank) : s.health;
}

/** How much harder a soldier hits for its rank and a Fury spell on it. */
export function damageFactor(world: World, s: Settler): number {
  return (1 + RANK_BONUS * s.rank) * (s.furyUntil > world.tick ? 2 : 1);
}

/** The share of a blow a soldier takes: half under a Shield spell. */
export function damageTaken(world: World, s: Settler): number {
  return s.shieldUntil > world.tick ? 0.5 : 1;
}

export function isFrozen(world: World, s: Settler): boolean {
  return s.frozenUntil > world.tick;
}

/** Why a soldier type cannot be promoted now, or null when it can. */
export function promotionProblem(world: World, playerId: number, soldierType: SoldierType): string | null {
  const player = playerOf(world, playerId);
  if (!player) return 'Unknown player';
  const rank = player.soldierRanks[soldierType];
  if (rank >= RANK_LABELS.length - 1) return `${SETTLER_PLURALS[soldierType]} are already captains`;
  if (player.manna < PROMOTION_COSTS[rank]) return `Needs ${PROMOTION_COSTS[rank]} manna`;
  return null;
}

/** Raises the rank new soldiers of a type are recruited at; those already serving keep theirs. */
export function promote(world: World, playerId: number, soldierType: SoldierType): void {
  const player = playerOf(world, playerId)!;
  player.manna -= PROMOTION_COSTS[player.soldierRanks[soldierType]];
  player.soldierRanks[soldierType]++;
}

/** Why a priest cannot cast this spell here now, or null when it can. */
export function spellProblem(world: World, priest: Settler, spell: SpellType, x: number, y: number): string | null {
  const player = playerOf(world, priest.owner);
  if (!player) return 'Unknown player';
  if (!RACE_SPELLS[player.raceType].includes(spell)) return 'Your priests do not know this spell';
  const stats = SPELL_STATS[spell];
  if (player.manna < stats.cost) return `Needs ${stats.cost} manna`;
  if (priest.timer > 0) return 'The priest is still resting';
  if (!stats.isRanged && distance(priest.x, priest.y, x, y) > SPELL_RANGE) return `Too far: a priest casts within ${SPELL_RANGE} tiles`;
  if ((spell === 'transmute' || spell === 'gift') && !nearestStorage(world, priest.owner, x, y)) return 'No storage of yours to work on';
  return null;
}

function nearestStorage(world: World, owner: number, x: number, y: number): Building | null {
  let best: Building | null = null, bestDistance = Infinity;
  for (const b of world.buildings) {
    if (b.owner !== owner || !b.isComplete || !isStorageBuilding(b)) continue;
    const d = distance(b.doorX, b.doorY, x, y);
    if (d < bestDistance) { bestDistance = d; best = b; }
  }
  return best;
}

function eachTile(world: World, x: number, y: number, radius: number, fn: (i: number, tx: number, ty: number) => void): void {
  for (let ty = Math.floor(y - radius); ty <= Math.ceil(y + radius); ty++) {
    for (let tx = Math.floor(x - radius); tx <= Math.ceil(x + radius); tx++) {
      if (inBounds(world, tx, ty) && Math.hypot(tx - x, ty - y) <= radius) fn(tileIndex(world, tx, ty), tx, ty);
    }
  }
}

function isFreeGrass(world: World, i: number): boolean {
  return world.terrain[i] === TERRAIN_GRASS && world.tree[i] === NO_TREE && world.rock[i] === 0 && world.field[i] === NO_FIELD
    && world.footprint[i] === 0 && world.door[i] === 0;
}

/** Casts a spell checked by spellProblem: pays its manna, works it, and lets the priest rest. */
export function castSpell(world: World, priest: Settler, spell: SpellType, x: number, y: number): void {
  const player = playerOf(world, priest.owner)!;
  const stats = SPELL_STATS[spell];
  player.manna -= stats.cost;
  priest.timer = PRIEST_REST_TICKS;
  priest.path = []; priest.phase = 'idle';
  const until = world.tick + stats.duration;
  const own = (s: Settler) => s.owner === priest.owner && isSoldierType(s.settlerType) && !s.isInside && s.health > 0 && distance(s.x, s.y, x, y) <= stats.radius;
  const enemy = (s: Settler) => s.owner !== priest.owner && isSoldierType(s.settlerType) && !s.isInside && s.health > 0 && distance(s.x, s.y, x, y) <= stats.radius;
  let detail = stats.summary;
  switch (spell) {
    case 'far_sight':
      world.farSights.push({ playerId: priest.owner, x, y, until });
      // Seen at once; the fog of war keeps it in sight until the spell runs out.
      eachTile(world, x, y, stats.radius, (i) => { world.vision[priest.owner][i] = VISION_VISIBLE; });
      break;
    case 'grow_forest': {
      let n = 0;
      eachTile(world, x, y, stats.radius, (i) => { if (isFreeGrass(world, i) && (i * 7) % 3 !== 0) { world.tree[i] = TREE_MATURE; n++; } });
      world.mapVersion++; detail = `${n} trees grew.`;
      break;
    }
    case 'raise_stones': {
      let n = 0;
      eachTile(world, x, y, stats.radius, (i) => { if (isFreeGrass(world, i)) { world.rock[i] = ROCK_STONE; n++; } });
      world.mapVersion++; detail = `${n} rocks rose from the ground.`;
      break;
    }
    case 'harvest': {
      let n = 0;
      eachTile(world, x, y, stats.radius, (i) => {
        if (world.field[i] >= 0 && world.field[i] < FIELD_RIPE) { world.field[i] = FIELD_RIPE; n++; }
        if (world.tree[i] >= 0 && world.tree[i] < TREE_MATURE) { world.tree[i] = TREE_MATURE; n++; }
      });
      world.mapVersion++; detail = `${n} fields and trees are ready.`;
      break;
    }
    case 'transmute': {
      const store = nearestStorage(world, priest.owner, x, y)!;
      const rule = RACE_TRANSMUTES[player.raceType];
      const n = Math.min(rule.amount, store.stock[rule.from] - store.reserved[rule.from]);
      store.stock[rule.from] -= n; store.stock[rule.to] += n;
      detail = `${n} ${GOOD_LABELS[rule.from].toLowerCase()} turned into ${GOOD_LABELS[rule.to].toLowerCase()}.`;
      break;
    }
    case 'gift': {
      const store = nearestStorage(world, priest.owner, x, y)!;
      const gift = RACE_GIFTS[player.raceType];
      for (const g of GOOD_TYPES) store.stock[g] += gift[g] ?? 0;
      detail = GOOD_TYPES.filter((g) => gift[g]).map((g) => `${gift[g]} ${GOOD_LABELS[g].toLowerCase()}`).join(', ') + ' arrived.';
      break;
    }
    case 'shield': for (const s of world.settlers) if (own(s)) s.shieldUntil = until; break;
    case 'fury': for (const s of world.settlers) if (own(s)) s.furyUntil = until; break;
    case 'freeze': {
      const hit = world.settlers.filter(enemy);
      for (const s of hit) { s.frozenUntil = until; s.path = []; }
      for (const owner of new Set(hit.map((s) => s.owner))) pushMessage(world, owner, 'Your soldiers are frozen', 'An enemy priest cast Freeze on them.', true, null);
      break;
    }
    case 'persuade': {
      const won = world.settlers.filter(enemy).sort((a, b) => distance(a.x, a.y, x, y) - distance(b.x, b.y, x, y)).slice(0, 3);
      for (const s of won) {
        pushMessage(world, s.owner, 'Your soldiers changed sides', 'An enemy priest persuaded them.', true, null);
        s.owner = priest.owner; s.phase = 'idle'; s.homeId = null; s.attackId = null; s.enemyId = null; s.path = []; s.waypoints = [];
      }
      detail = `${won.length} enemy soldiers joined you.`;
      break;
    }
    case 'blight': {
      let n = 0;
      for (const b of world.buildings) {
        if (b.owner === priest.owner || !BUILDING_TYPES[b.typeId].mine || distance(b.doorX, b.doorY, x, y) > stats.radius) continue;
        b.blightUntil = until; n++;
        pushMessage(world, b.owner, 'Your mine is blighted', 'It produces half as much for 5 minutes.', true, b.id);
      }
      detail = `${n} enemy mines blighted.`;
      break;
    }
  }
  pushMessage(world, priest.owner, `${stats.label} cast`, detail, false, null);
}

/** Drops Far sight spells that have run out. */
export function expireSpells(world: World): void {
  if (world.farSights.length > 0) world.farSights = world.farSights.filter((f) => f.until > world.tick);
}
