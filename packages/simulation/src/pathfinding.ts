import { isWalkable } from './world.ts';
import type { World } from './world.ts';

const SQRT2 = Math.SQRT2;
const DIRECTIONS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2]
] as const;

let size = 0;
let gScore = new Float64Array(0);
let cameFrom = new Int32Array(0);
let stamp = new Uint32Array(0);
let closed = new Uint32Array(0);
let generation = 0;

function prepare(n: number): void {
  if (n !== size) {
    size = n;
    gScore = new Float64Array(n);
    cameFrom = new Int32Array(n);
    stamp = new Uint32Array(n);
    closed = new Uint32Array(n);
    generation = 0;
  }
  generation++;
  if (generation === 0xffffffff) { stamp.fill(0); closed.fill(0); generation = 1; }
}

/**
 * A* over the tile grid with 8 directions. Returns the tiles to walk through, excluding the start
 * and including the goal, or null when unreachable. The goal itself may be blocked (a tree or a rock
 * the settler works on); every other tile must be walkable, and diagonals may not cut blocked corners.
 */
export function findPath(
  world: World, start: number, goal: number, maxVisited = 40_000,
  isPassable: (world: World, index: number) => boolean = isWalkable
): number[] | null {
  if (start === goal) return [];
  const { width } = world;
  prepare(world.width * world.height);
  const gx = goal % width, gy = Math.floor(goal / width);
  const heuristic = (i: number) => {
    const dx = Math.abs((i % width) - gx), dy = Math.abs(Math.floor(i / width) - gy);
    return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
  };
  const heap: number[] = [];
  const f: number[] = [];
  const push = (node: number, score: number) => {
    heap.push(node); f.push(score);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (f[parent] <= f[i]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      [f[parent], f[i]] = [f[i], f[parent]];
      i = parent;
    }
  };
  const pop = (): number => {
    const top = heap[0];
    const lastNode = heap.pop()!, lastF = f.pop()!;
    if (heap.length > 0) {
      heap[0] = lastNode; f[0] = lastF;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && f[l] < f[m]) m = l;
        if (r < heap.length && f[r] < f[m]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        [f[m], f[i]] = [f[i], f[m]];
        i = m;
      }
    }
    return top;
  };
  stamp[start] = generation; gScore[start] = 0; cameFrom[start] = -1;
  push(start, heuristic(start));
  let visited = 0;
  while (heap.length > 0) {
    const current = pop();
    if (closed[current] === generation) continue;
    closed[current] = generation;
    if (current === goal) {
      const path: number[] = [];
      for (let node = goal; node !== start; node = cameFrom[node]) path.push(node);
      return path.reverse();
    }
    if (++visited > maxVisited) return null;
    const cx = current % width, cy = Math.floor(current / width);
    for (const [dx, dy, cost] of DIRECTIONS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= world.height) continue;
      const next = ny * width + nx;
      if (next !== goal && !isPassable(world, next)) continue;
      if (dx !== 0 && dy !== 0
          && (!isPassable(world, cy * width + nx) || !isPassable(world, ny * width + cx))) continue;
      const g = gScore[current] + cost;
      if (stamp[next] === generation && g >= gScore[next]) continue;
      stamp[next] = generation; gScore[next] = g; cameFrom[next] = current;
      push(next, g + heuristic(next));
    }
  }
  return null;
}

/**
 * Every tile settlers can reach from `start` (8 directions, no corner cutting), as a membership test.
 * Used to check that a new building leaves all entrances reachable.
 */
export function reachableFrom(
  world: World, start: number, isPassable: (world: World, index: number) => boolean = isWalkable
): (tile: number) => boolean {
  const { width, height } = world;
  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0, tail = 0;
  seen[start] = 1; queue[tail++] = start;
  while (head < tail) {
    const current = queue[head++];
    const cx = current % width, cy = Math.floor(current / width);
    for (const [dx, dy] of DIRECTIONS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (seen[next] || !isPassable(world, next)) continue;
      if (dx !== 0 && dy !== 0 && (!isPassable(world, cy * width + nx) || !isPassable(world, ny * width + cx))) continue;
      seen[next] = 1; queue[tail++] = next;
    }
  }
  return (tile) => seen[tile] === 1;
}
