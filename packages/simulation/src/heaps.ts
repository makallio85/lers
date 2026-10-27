import { TERRAIN_WATER, tileIndex } from './world.ts';
import type { Building, World } from './world.ts';

/**
 * Where the castle's stockpile lies on the ground: four heaps of piles on open ground in front of the castle, two in
 * front of its door wall, either side of the way in, and two along its right-hand wall. The client draws the goods on
 * these spots and buildings may not be placed over them, so both read them from here.
 */

/** How far back goods are sorted among upright things, in tiles of depth: a settler on a pile is drawn over it. */
export const GOODS_DEPTH_BACK = 1.9;
/** Distance between piles inside a heap, in tiles: close enough to read as one heap. */
export const HEAP_SPACING = 0.62;
/** Piles one heap holds at most. */
const PILES_PER_HEAP = 12;

export interface HeapSpot { x: number; y: number }

const cache = new WeakMap<World, Map<number, { mapVersion: number; heaps: HeapSpot[][] }>>();

/** The castle's four heaps, each a list of pile spots nearest the castle first. */
export function castleHeapSpots(world: World, castle: Building): HeapSpot[][] {
  let byCastle = cache.get(world);
  if (!byCastle) { byCastle = new Map(); cache.set(world, byCastle); }
  const known = byCastle.get(castle.id);
  if (known && known.mapVersion === world.mapVersion) return known.heaps;
  const s = castle.size;
  const isOpen = (x: number, y: number) => {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= world.width || ty >= world.height) return false;
    if (Math.abs(tx - castle.doorX) <= 1 && ty >= castle.y + s) return false;
    // Only ground the castle's art cannot cover: far enough in front that the goods, sorted back as they are, still
    // sort after the castle, and so does a settler walking over them.
    if (x + y - GOODS_DEPTH_BACK < castle.x + castle.y + s + 0.1) return false;
    const i = tileIndex(world, tx, ty);
    return world.footprint[i] === 0 && world.door[i] === 0 && world.terrain[i] !== TERRAIN_WATER && world.rock[i] === 0 && world.tree[i] < 0;
  };
  // Each heap: a corner to grow from and the two directions it grows in (across, then away from the wall).
  const front = castle.y + s + 0.35, side = castle.x + s + 0.35;
  const regions = [
    { x: castle.doorX - 1.35, y: front, ax: -1, ay: 0, bx: 0, by: 1 },
    { x: castle.doorX + 2.35, y: front, ax: 1, ay: 0, bx: 0, by: 1 },
    { x: side, y: castle.y + s - 0.4, ax: 0, ay: -1, bx: 1, by: 0 },
    { x: side, y: castle.y + s / 2 - 0.9, ax: 0, ay: -1, bx: 1, by: 0 }
  ];
  const heaps = regions.map((r) => {
    const spots: HeapSpot[] = [];
    for (let depth = 0; depth < 8 && spots.length < PILES_PER_HEAP; depth++) {
      for (let across = 0; across < 4 && spots.length < PILES_PER_HEAP; across++) {
        const x = r.x + (r.ax * across + r.bx * depth) * HEAP_SPACING, y = r.y + (r.ay * across + r.by * depth) * HEAP_SPACING;
        if (isOpen(x, y)) spots.push({ x, y });
      }
    }
    return spots;
  });
  byCastle.set(castle.id, { mapVersion: world.mapVersion, heaps });
  return heaps;
}

/** Whether goods from a castle's stockpile lie, or may lie, on this tile: no building goes there. */
export function isHeapGround(world: World, tx: number, ty: number): boolean {
  for (const b of world.buildings) {
    if (b.typeId !== 'castle' || Math.abs(tx - b.x) > b.size + 8 || Math.abs(ty - b.y) > b.size + 8) continue;
    for (const heap of castleHeapSpots(world, b)) for (const spot of heap) if (Math.floor(spot.x) === tx && Math.floor(spot.y) === ty) return true;
  }
  return false;
}
