/**
 * Plays built-in bots against each other in many setups and reports what should never happen: settlers inside
 * buildings or on water, two standing settlers on one tile, settlers stuck mid-walk, buildings blocked by the same
 * problem for ten minutes, goods waiting while carriers stand idle, errors, and matches that do not end.
 *
 * Run: node scripts/health-check.ts [setup-name ...]
 */
import { createMatch, isUnitType, stepMatch, tileIndex, TERRAIN_WATER } from '../packages/simulation/src/index.ts';
import type { MatchSetup, World } from '../packages/simulation/src/index.ts';

interface Setup { name: string; seed: number; bot: 'calm' | 'aggressive'; size: 'small' | 'medium' | 'large'; race: 'romans' | 'egyptians' | 'asians' | 'amazons';
  layout?: 'continent' | 'islands'; setup?: MatchSetup; minutes: number }
const SETUPS: Setup[] = [
  { name: 'small-aggressive', seed: 7, bot: 'aggressive', size: 'small', race: 'romans', minutes: 120 },
  { name: 'small-egyptians', seed: 11, bot: 'aggressive', size: 'small', race: 'egyptians', minutes: 80 },
  { name: 'small-asians-unmirrored', seed: 5, bot: 'aggressive', size: 'small', race: 'asians', setup: { isMirrored: false }, minutes: 80 },
  { name: 'small-amazons-few', seed: 3, bot: 'aggressive', size: 'small', race: 'amazons', setup: { startingGoodsType: 'few' }, minutes: 160 },
  { name: 'medium-calm', seed: 2, bot: 'calm', size: 'medium', race: 'romans', minutes: 120 },
  { name: 'medium-islands', seed: 3, bot: 'aggressive', size: 'medium', race: 'egyptians', layout: 'islands', minutes: 100 },
  { name: 'medium-economy', seed: 9, bot: 'aggressive', size: 'medium', race: 'asians', setup: { victoryType: 'economy' }, minutes: 120 },
  { name: 'medium-ffa4', seed: 4, bot: 'aggressive', size: 'medium', race: 'romans', setup: { enemyCount: 3 }, minutes: 100 },
  { name: 'large-2v2-many', seed: 6, bot: 'aggressive', size: 'large', race: 'amazons', setup: { allyCount: 1, enemyCount: 2, areEnemiesAllied: true, startingGoodsType: 'many' }, minutes: 90 },
];

const MINUTE = 600;

interface Memory {
  stuck: Map<number, { x: number; y: number; phase: string; since: number }>;
  pairs: Map<string, number>;
  blocked: Map<number, { reason: string; since: number }>;
}
type Notes = Map<string, { first: number; count: number; example: string }>;
const BUSY_PHASES = new Set(['toPickup', 'toDrop', 'toStore', 'toSite', 'toTool', 'toWork', 'toTarget', 'returning', 'toRecruit', 'toGarrison', 'moving']);
const note = (notes: Notes, minute: number, kind: string, example: string) => {
  const n = notes.get(kind);
  if (n) n.count++; else notes.set(kind, { first: minute, count: 1, example });
};
const isOut = (world: World, owner: number) => world.players[owner]?.isEliminated;

/** Every second: who has not moved, and who shares a standing tile. */
function sample(world: World, tick: number, notes: Notes, memory: Memory): void {
  const minute = tick / MINUTE;
  const standing = new Map<number, number>();
  for (const s of world.settlers) {
    if (s.isInside || s.shipId !== null || isOut(world, s.owner)) continue;
    const isShip = s.settlerType === 'transport_ship' || s.settlerType === 'trade_ship';
    // Walking (a busy phase) but within half a tile, in the same phase, for two minutes.
    const last = memory.stuck.get(s.id);
    if (!BUSY_PHASES.has(s.phase) || !last || last.phase !== s.phase || Math.hypot(last.x - s.x, last.y - s.y) > 0.5) {
      memory.stuck.set(s.id, { x: s.x, y: s.y, phase: s.phase, since: tick });
    } else if (tick - last.since === 2 * MINUTE) {
      note(notes, minute, `settler not moving in phase ${s.phase}`, `${s.settlerType} #${s.id} of player ${s.owner} at ${Math.round(s.x)},${Math.round(s.y)}, path ${s.path.length}`);
    }
    if (isShip || s.path.length > 0 || s.phase !== 'idle' || s.carrying !== null) continue;
    const i = tileIndex(world, Math.round(s.x), Math.round(s.y));
    const other = standing.get(i);
    if (other === undefined) { standing.set(i, s.id); continue; }
    const key = `${other}-${s.id}`;
    const since = memory.pairs.get(key) ?? tick;
    memory.pairs.set(key, since);
    if (tick - since === 30 * 10) note(notes, minute, 'two settlers standing on one tile for 30 s', `${s.settlerType} #${s.id} with #${other} at ${Math.round(s.x)},${Math.round(s.y)}`);
  }
}

/** Every minute: positions that should never be, long blocks, and goods left waiting beside idle carriers. */
function check(world: World, minute: number, notes: Notes, memory: Memory): void {
  for (const s of world.settlers) {
    if (s.isInside || s.shipId !== null) continue;
    const i = tileIndex(world, Math.round(s.x), Math.round(s.y));
    const isShip = s.settlerType === 'transport_ship' || s.settlerType === 'trade_ship';
    if (!isShip && world.terrain[i] === TERRAIN_WATER) note(notes, minute, 'settler on water', `${s.settlerType} #${s.id} ${s.phase} at ${Math.round(s.x)},${Math.round(s.y)}`);
    if (!isShip && world.footprint[i] !== 0 && s.path.length === 0) note(notes, minute, 'settler standing inside a building', `${s.settlerType} #${s.id} ${s.phase}`);
  }
  for (const b of world.buildings) {
    if (isOut(world, b.owner)) continue;
    const last = memory.blocked.get(b.id);
    if (!b.blockedReason) { memory.blocked.delete(b.id); continue; }
    if (!last || last.reason !== b.blockedReason) { memory.blocked.set(b.id, { reason: b.blockedReason, since: minute }); continue; }
    if (minute - last.since === 10) note(notes, minute, `blocked 10 min: ${b.blockedReason.replace(/[0-9]+/g, 'N')}`, `${b.typeId} #${b.id} of player ${b.owner}${b.isComplete ? '' : ' (site)'}`);
  }
  for (const p of world.players) {
    if (p.isEliminated) continue;
    const idle = world.settlers.filter((s) => s.owner === p.id && s.settlerType === 'carrier' && s.phase === 'idle' && s.carrying === null).length;
    const full = world.buildings.filter((b) => b.owner === p.id && b.blockedReason?.startsWith('Output full'));
    if (idle >= 4 && full.length > 0) note(notes, minute, 'outputs full while carriers idle', `player ${p.id}: ${idle} idle, ${full.map((b) => `${b.typeId} #${b.id}`).join(', ')}`);
  }
}

const only = process.argv.slice(2);
for (const sc of SETUPS.filter((s) => only.length === 0 || only.includes(s.name))) {
  const started = Date.now();
  const notes: Notes = new Map();
  const memory: Memory = { stuck: new Map(), pairs: new Map(), blocked: new Map() };
  let world: World;
  let error = '';
  let minute = 0;
  try {
    world = createMatch(sc.seed, sc.bot, sc.size, sc.race, undefined, sc.layout ?? 'continent', sc.setup ?? {});
    world.players[0].isBot = true;
    for (; minute < sc.minutes && world.winner === null; minute++) {
      for (let t = 0; t < MINUTE && world.winner === null; t++) {
        stepMatch(world);
        if (world.tick % 10 === 0) sample(world, world.tick, notes, memory);
      }
      check(world, minute + 1, notes, memory);
    }
  } catch (e) { error = String((e as Error).stack ?? e).split('\n').slice(0, 3).join(' | '); world = undefined as unknown as World; }
  const result = error ? `ERROR ${error}` : world.winner === null ? `no winner after ${minute} min` : `won by player ${world.winner} (team ${world.players[world.winner].teamId}) at minute ${minute}`;
  console.log(`\n== ${sc.name}: ${result} (${Math.round((Date.now() - started) / 1000)} s)`);
  if (!error) console.log(`   ${world.players.map((p) => `p${p.id} ${p.isEliminated ? 'out' : 'in'} b${world.buildings.filter((b) => b.owner === p.id).length} soldiers ${world.settlers.filter((s) => s.owner === p.id && isUnitType(s.settlerType)).length}`).join(' · ')}`);
  for (const [kind, n] of notes) console.log(`   - ${kind}: ${n.count}× from minute ${n.first}; e.g. ${n.example}`);
}
