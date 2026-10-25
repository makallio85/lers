// Times the real game engine, not the movement prototype in benchmark.mjs:
// 1. a bot-vs-bot match on a medium map for up to 60 game minutes;
// 2. a stress run on a large map with many extra settlers per player.
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { castleOf, createMatch, newSettler, stepMatch } from '../packages/simulation/src/index.ts';
import type { World } from '../packages/simulation/src/index.ts';

const EXTRA_SETTLERS = Number(process.env.LERS_EXTRA_SETTLERS ?? 1000);

function measure(world: World, ticks: number): { ticks: number; p50: number; p95: number; p99: number; max: number; settlers: number } {
  const times: number[] = [];
  let peak = 0;
  for (let t = 0; t < ticks && world.winner === null; t++) {
    const start = performance.now();
    stepMatch(world);
    times.push(performance.now() - start);
    peak = Math.max(peak, world.settlers.length);
  }
  times.sort((a, b) => a - b);
  const at = (p: number) => Number(times[Math.min(times.length - 1, Math.ceil(times.length * p) - 1)].toFixed(3));
  return { ticks: times.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: Number(times[times.length - 1].toFixed(1)), settlers: peak };
}

const match = createMatch(2, 'aggressive', 'medium');
match.players[0].isBot = true;
const matchResult = measure(match, 60 * 600);

const stress = createMatch(2, 'aggressive', 'large');
stress.players[0].isBot = true;
for (const player of [0, 1]) {
  const castle = castleOf(stress, player)!;
  for (let k = 0; k < EXTRA_SETTLERS; k++) newSettler(stress, player, 'carrier', castle.doorX, castle.doorY);
}
const stressResult = measure(stress, 10 * 600);

console.log(JSON.stringify({
  runtime: process.version, platform: `${os.platform()} ${os.arch()}`, cpu: os.cpus()[0]?.model,
  tickBudgetMs: { at1x: 100, at4x: 25 },
  match: { workload: 'Bot vs bot, medium map (144 × 96), seed 2, up to 60 game minutes', tickTimeMs: matchResult },
  stress: { workload: `Bot vs bot, large map (192 × 128), seed 2, ${EXTRA_SETTLERS} extra carriers per player, 10 game minutes`, tickTimeMs: stressResult }
}, null, 2));
