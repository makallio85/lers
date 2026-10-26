import { isWalkable, tileIndex } from './world.ts';
import type { World } from './world.ts';

/**
 * Land regions: connected stretches of one player's walkable land. As in the original game, carriers and
 * other civilians stay on their own land, so goods only move between buildings in the same region; a colony
 * cut off by neutral or enemy land is reached by donkey caravans (or, later, ships).
 * Worked out from the map and cached until the map or the territory changes; not saved.
 */
interface RegionCache { key: string; regions: Int32Array }
const cache = new WeakMap<World, RegionCache>();

const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

function compute(world: World): Int32Array {
  const { width, height, territory } = world;
  const regions = new Int32Array(width * height);
  const queue = new Int32Array(width * height);
  let next = 1;
  for (let start = 0; start < regions.length; start++) {
    if (regions[start] !== 0 || territory[start] === 0 || !isWalkable(world, start)) continue;
    const owner = territory[start];
    let head = 0, tail = 0;
    regions[start] = next; queue[tail++] = start;
    while (head < tail) {
      const current = queue[head++];
      const cx = current % width, cy = Math.floor(current / width);
      for (const [dx, dy] of DIRECTIONS) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const i = ny * width + nx;
        if (regions[i] !== 0 || territory[i] !== owner || !isWalkable(world, i)) continue;
        // Diagonal steps may not cut a corner of blocked or foreign land, as in path finding.
        if (dx !== 0 && dy !== 0) {
          const a = cy * width + nx, b = ny * width + cx;
          if (territory[a] !== owner || territory[b] !== owner || !isWalkable(world, a) || !isWalkable(world, b)) continue;
        }
        regions[i] = next; queue[tail++] = i;
      }
    }
    next++;
  }
  return regions;
}

/** The land region a tile belongs to, or 0 for tiles that are no one's walkable land. */
export function landRegion(world: World, x: number, y: number): number {
  const key = `${world.territoryVersion}:${world.mapVersion}:${world.width}`;
  let entry = cache.get(world);
  if (!entry || entry.key !== key) { entry = { key, regions: compute(world) }; cache.set(world, entry); }
  const tx = Math.round(x), ty = Math.round(y);
  if (tx < 0 || ty < 0 || tx >= world.width || ty >= world.height) return 0;
  return entry.regions[tileIndex(world, tx, ty)];
}

/** Whether a civilian of this owner may step on a tile: walkable, and the owner's own land. */
export function isOwnLand(world: World, owner: number, index: number): boolean {
  return world.territory[index] === owner + 1 && isWalkable(world, index);
}
