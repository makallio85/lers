import { BUILDING_TYPES, DEPOSIT_NONE } from './definitions.ts';
import type { BuildingTypeId } from './definitions.ts';
import { NO_TREE, TERRAIN_GRASS, TERRAIN_MOUNTAIN, TERRAIN_WATER, inBounds, tileIndex, valueNoise } from './world.ts';
import type { World } from './world.ts';

/**
 * Land quality: some places suit a job and some do not. Grain grows best on moist, firm soil and badly on dry land
 * or in the wet ground at the water's edge; rice wants that wet ground; vines want the hillsides by the mountains;
 * bees want trees around them; fish live in some waters and not in others; a mine works the faster the more ore lies
 * around it. Soil and hillsides follow from the map (mirrored with it), fish are counted per water tile and come
 * back slowly after fishing.
 */

/** Most fish a water tile holds. */
export const FISH_MAX = 12;
/** Fish come back one per tile every this many ticks, up to the water's own stock. */
export const FISH_REGROW_TICKS = 1200;

interface LandCache { wet: Float32Array; hill: Float32Array; fishCap: Uint8Array; waterDistance: Uint8Array; mapVersion: number; terrainSum: number }
const cache = new WeakMap<World, LandCache>();

/** Distance in tiles to the nearest tile of a kind, up to `limit` (limit + 1 beyond). */
function distanceTo(world: World, isTarget: (i: number) => boolean, limit: number): Uint8Array {
  const { width, height } = world;
  const out = new Uint8Array(width * height).fill(limit + 1);
  let frontier: number[] = [];
  for (let i = 0; i < out.length; i++) if (isTarget(i)) { out[i] = 0; frontier.push(i); }
  for (let d = 1; d <= limit && frontier.length > 0; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % width, y = Math.floor(i / width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (out[j] > d) { out[j] = d; next.push(j); }
      }
    }
    frontier = next;
  }
  return out;
}

function terrainSum(world: World): number {
  let sum = 0;
  for (let i = 0; i < world.terrain.length; i++) sum = (sum * 31 + world.terrain[i] * (i + 1)) >>> 0;
  return sum;
}

function landOf(world: World): LandCache {
  const kept = cache.get(world);
  if (kept && kept.wet.length === world.width * world.height) {
    if (kept.mapVersion === world.mapVersion) return kept;
    // The map changed: worked out again only if its water or mountains did.
    kept.mapVersion = world.mapVersion;
    if (kept.terrainSum === terrainSum(world)) return kept;
  }
  const { width, height } = world;
  const n = width * height;
  const soilNoise = valueNoise(world.seed ^ 0x5bd1e995, width, height, 9);
  const fishNoise = valueNoise(world.seed ^ 0x27d4eb2f, width, height, 7);
  // On a mirrored map both halves get the same land: the right half reads the noise of its mirror tile.
  const at = (noise: Float32Array, i: number) => {
    if (!world.isMirrored) return noise[i];
    const x = i % width, y = Math.floor(i / width);
    return noise[y * width + Math.min(x, width - 1 - x)];
  };
  const waterDistance = distanceTo(world, (i) => world.terrain[i] === TERRAIN_WATER, 6);
  const mountainDistance = distanceTo(world, (i) => world.terrain[i] === TERRAIN_MOUNTAIN, 7);
  const wet = new Float32Array(n), hill = new Float32Array(n), fishCap = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    wet[i] = Math.max(0, Math.min(1, 0.62 * (1 - waterDistance[i] / 6) + 0.48 * at(soilNoise, i) - 0.08));
    // The hillside: the land within a few tiles of a mountain, steepest next to it.
    hill[i] = world.terrain[i] === TERRAIN_GRASS && mountainDistance[i] <= 6 ? 1 - (mountainDistance[i] - 1) / 6 : 0;
    if (world.terrain[i] === TERRAIN_WATER) fishCap[i] = Math.round(FISH_MAX * Math.max(0, Math.min(1, (at(fishNoise, i) - 0.38) * 2.4)));
  }
  const land = { wet, hill, fishCap, waterDistance, mapVersion: world.mapVersion, terrainSum: terrainSum(world) };
  cache.set(world, land);
  return land;
}

/** How wet the ground is, 0 (dry) to 1 (by the water). */
export function wetnessAt(world: World, i: number): number {
  return landOf(world).wet[i];
}

/** How many fish a water tile holds when left alone. */
export function fishCapOf(world: World, i: number): number {
  return landOf(world).fishCap[i];
}

/** A fresh map's fish: every water tile at its own stock. */
export function stockFish(world: World): Uint8Array {
  const { fishCap } = landOf(world);
  return Uint8Array.from(fishCap);
}

/** Fish come back slowly where they were caught. */
export function regrowFish(world: World): void {
  if (world.tick % FISH_REGROW_TICKS !== 0) return;
  const { fishCap } = landOf(world);
  for (let i = 0; i < world.fish.length; i++) if (world.fish[i] < fishCap[i]) world.fish[i]++;
}

export type CropType = 'grain' | 'rice' | 'vine' | 'flowers';

/** How well a crop does on a tile, 0.15 (badly) to 1 (well). */
export function cropQuality(world: World, i: number, crop: CropType): number {
  const land = landOf(world);
  const wet = land.wet[i];
  let q: number;
  if (crop === 'grain') {
    // Moist, firm soil is best; dry land is poor, and the wet ground at the water's edge is a swamp.
    q = 1.1 - Math.abs(wet - 0.5) * 1.5;
    if (land.waterDistance[i] <= 1) q *= 0.45;
  } else if (crop === 'rice') {
    q = 0.3 + (wet - 0.25) * 1.6;
  } else if (crop === 'vine') {
    q = 0.35 + 0.75 * land.hill[i] - Math.max(0, wet - 0.75);
  } else {
    // Bees want trees and flowers around them.
    let trees = 0;
    const x = i % world.width, y = Math.floor(i / world.width);
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      if (inBounds(world, x + dx, y + dy) && world.tree[tileIndex(world, x + dx, y + dy)] !== NO_TREE) trees++;
    }
    q = 0.25 + 0.75 * Math.min(1, trees / 10);
  }
  return Math.max(0.15, Math.min(1, q));
}

/** The crop a building grows around it, if it grows one. */
export function cropOf(typeId: BuildingTypeId): CropType | null {
  return typeId === 'farm' ? 'grain' : typeId === 'rice_farm' ? 'rice' : typeId === 'winery' ? 'vine' : typeId === 'beekeeper' ? 'flowers' : null;
}

/** How rich the water around a spot is, 0 to 1: its fish against the most it could hold. */
export function fishQuality(world: World, x: number, y: number, radius: number): number {
  let fish = 0, water = 0;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    if (!inBounds(world, x + dx, y + dy) || Math.hypot(dx, dy) > radius) continue;
    const i = tileIndex(world, x + dx, y + dy);
    if (world.terrain[i] !== TERRAIN_WATER) continue;
    water++; fish += world.fish[i];
  }
  // A few rich tiles are enough for one fisher.
  return water === 0 ? 0 : Math.min(1, fish / (FISH_MAX * Math.min(water, 12)));
}

/** How much of the ground a mine reaches holds its ore, 0 to 1. */
export function oreQuality(world: World, x: number, y: number, size: number, reach: number, deposit: number): number {
  let ore = 0, tiles = 0;
  for (let ty = y - reach; ty < y + size + reach; ty++) for (let tx = x - reach; tx < x + size + reach; tx++) {
    if (!inBounds(world, tx, ty)) continue;
    const i = tileIndex(world, tx, ty);
    if (world.terrain[i] !== TERRAIN_MOUNTAIN) continue;
    tiles++;
    if (world.deposit[i] === deposit && deposit !== DEPOSIT_NONE && world.depositAmount[i] > 0) ore++;
  }
  // Half the ground being ore is as good as it gets.
  return tiles === 0 ? 0 : Math.min(1, (ore / tiles) * 2);
}

/** The radius a building's land is judged over. */
const QUALITY_RADIUS = 4;

/**
 * How good a spot is for a building that depends on its land, 0 to 1, or null for one that does not: the crop's
 * quality over the land around it, the fish in the water nearby, or the ore a mine reaches. `x`, `y` is the top-left
 * tile, `cx`, `cy` the middle of the land it works.
 */
export function siteQuality(world: World, typeId: BuildingTypeId, x: number, y: number, cx = x + 1, cy = y + 1): number | null {
  const type = BUILDING_TYPES[typeId];
  if (type.mine) return oreQuality(world, x, y, type.size, 2, type.mine.deposit);
  if (typeId === 'fisher') return fishQuality(world, cx, cy, 8);
  const crop = cropOf(typeId);
  if (!crop) return null;
  let sum = 0, count = 0;
  for (let dy = -QUALITY_RADIUS; dy <= QUALITY_RADIUS; dy++) for (let dx = -QUALITY_RADIUS; dx <= QUALITY_RADIUS; dx++) {
    if (!inBounds(world, cx + dx, cy + dy) || Math.hypot(dx, dy) > QUALITY_RADIUS) continue;
    const i = tileIndex(world, cx + dx, cy + dy);
    if (world.terrain[i] !== TERRAIN_GRASS) continue;
    sum += cropQuality(world, i, crop); count++;
  }
  return count === 0 ? 0.15 : sum / count;
}

/** A spot's quality in words, for the placement hint and the building card. */
export function qualityLabel(q: number): string {
  return q >= 0.75 ? 'Good' : q >= 0.45 ? 'Fair' : q >= 0.2 ? 'Poor' : 'Very poor';
}
