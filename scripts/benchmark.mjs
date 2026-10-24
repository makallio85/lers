import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { createWorld, orderMove, step, TICK_MS } from '../packages/simulation/world.mjs';

const world = createWorld({ unitCount: 10_000, seed: 42 });
for (const player of [0, 1]) {
  const ids = Array.from({ length: 5000 }, (_, i) => i * 2 + player);
  orderMove(world, player, ids, { x: 2048, y: 2048 });
}
for (let i = 0; i < 100; i++) step(world);
const times = [];
for (let i = 0; i < 1000; i++) {
  const start = performance.now();
  step(world);
  times.push(performance.now() - start);
}
times.sort((a, b) => a - b);
const percentile = p => Number(times[Math.ceil(times.length * p) - 1].toFixed(3));
console.log(JSON.stringify({
  workload: 'Movement only on empty terrain; no rendering, paths, collision, combat or networking',
  runtime: process.version, platform: `${os.platform()} ${os.arch()}`,
  cpu: os.cpus()[0]?.model, unitCount: world.x.length, mapSize: world.mapSize,
  seed: 42, tickMs: TICK_MS, warmupTicks: 100, measuredTicks: 1000,
  tickTimeMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) }
}, null, 2));
