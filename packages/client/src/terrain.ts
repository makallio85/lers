import { Container, Sprite, Texture } from 'pixi.js';
import { TERRAIN_MOUNTAIN, TERRAIN_WATER, tileIndex } from '../../simulation/src/index.ts';
import type { World } from '../../simulation/src/index.ts';

/** Ground texture pixels per tile; the ground layer is then tilted into the isometric view. */
const PX = 32;
/** Tiles per chunk, so no single texture grows past what phones can hold. */
const CHUNK = 64;
const PATTERN = 256;

type Palette = readonly [number, number, number][];
// Dark to light, sRGB. Matched to the rendered sprites' grass, stone and water.
const GRASS: Palette = [[44, 74, 26], [58, 92, 32], [72, 106, 38], [86, 118, 44]];
const MOUNTAIN: Palette = [[78, 72, 64], [98, 92, 82], [122, 116, 104], [146, 140, 126]];
const WATER: Palette = [[30, 62, 72], [38, 76, 88], [48, 92, 104], [70, 116, 126]];
const SHORE: Palette = [[120, 102, 70], [138, 118, 82], [152, 132, 94], [164, 146, 106]];

/** Tileable value noise, several octaves, as a canvas pattern in a palette. */
function noisePattern(palette: Palette, seed: number, scales: readonly number[]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PATTERN;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(PATTERN, PATTERN);
  const lattice = (period: number, salt: number) => {
    const values = new Float32Array(period * period);
    let h = (seed * 7919 + salt * 104729) >>> 0;
    for (let i = 0; i < values.length; i++) { h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0; values[i] = (h & 0xffff) / 0xffff; }
    return values;
  };
  const layers = scales.map((period, k) => ({ period, values: lattice(period, k + 1), weight: 1 / (k + 1) }));
  const total = layers.reduce((sum, l) => sum + l.weight, 0);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < PATTERN; y++) {
    for (let x = 0; x < PATTERN; x++) {
      let v = 0;
      for (const { period, values, weight } of layers) {
        const fx = (x / PATTERN) * period, fy = (y / PATTERN) * period;
        const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = smooth(fx - x0), ty = smooth(fy - y0);
        const at = (i: number, j: number) => values[((j % period) * period) + (i % period)];
        const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
        const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
        v += (top + (bottom - top) * ty) * weight;
      }
      v /= total;
      const f = Math.max(0, Math.min(0.999, (v - 0.25) * 2)) * (palette.length - 1);
      const k = Math.floor(f), t = f - k, a = palette[k], b = palette[Math.min(k + 1, palette.length - 1)];
      const o = (y * PATTERN + x) * 4;
      img.data[o] = a[0] + (b[0] - a[0]) * t; img.data[o + 1] = a[1] + (b[1] - a[1]) * t; img.data[o + 2] = a[2] + (b[2] - a[2]) * t; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

let patterns: Record<'grass' | 'mountain' | 'water' | 'shore', HTMLCanvasElement> | null = null;
function getPatterns() {
  patterns ??= {
    grass: noisePattern(GRASS, 1, [4, 8, 16, 64]),
    mountain: noisePattern(MOUNTAIN, 2, [4, 8, 32, 64]),
    water: noisePattern(WATER, 3, [2, 4, 16]),
    shore: noisePattern(SHORE, 4, [8, 32, 64])
  };
  return patterns;
}

/**
 * The map's ground in tile space (TILE px per tile once scaled), drawn in chunks.
 * Mountain and water fade softly into grass, with a strip of sand along the shore.
 */
export function buildTerrain(world: World, tile: number): Container {
  const p = getPatterns();
  const layer = new Container();
  layer.scale.set(tile / PX);
  for (let cy = 0; cy < world.height; cy += CHUNK) {
    for (let cx = 0; cx < world.width; cx += CHUNK) {
      const w = Math.min(CHUNK, world.width - cx), h = Math.min(CHUNK, world.height - cy);
      const canvas = document.createElement('canvas');
      canvas.width = w * PX; canvas.height = h * PX;
      const ctx = canvas.getContext('2d')!;
      ctx.save(); ctx.translate(-cx * PX, -cy * PX);
      ctx.fillStyle = ctx.createPattern(p.grass, 'repeat')!;
      ctx.fillRect(cx * PX, cy * PX, w * PX, h * PX);
      ctx.restore();
      const layerFor = (kind: number, pattern: HTMLCanvasElement, spread: number) => {
        // A one-pixel-per-tile mask (with a border of one tile), blurred and scaled up, gives soft edges.
        const mask = document.createElement('canvas');
        mask.width = w + 2; mask.height = h + 2;
        const m = mask.getContext('2d')!;
        const img = m.createImageData(w + 2, h + 2);
        let any = false;
        for (let y = -1; y <= h; y++) {
          for (let x = -1; x <= w; x++) {
            const tx = Math.max(0, Math.min(world.width - 1, cx + x)), ty = Math.max(0, Math.min(world.height - 1, cy + y));
            if (world.terrain[tileIndex(world, tx, ty)] !== kind) continue;
            img.data[((y + 1) * (w + 2) + x + 1) * 4 + 3] = 255; any = true;
          }
        }
        if (!any) return;
        m.putImageData(img, 0, 0);
        const soft = document.createElement('canvas');
        soft.width = canvas.width; soft.height = canvas.height;
        const s = soft.getContext('2d')!;
        s.filter = `blur(${spread}px)`;
        s.imageSmoothingEnabled = true;
        s.drawImage(mask, -PX, -PX, (w + 2) * PX, (h + 2) * PX);
        s.filter = 'none';
        s.globalCompositeOperation = 'source-in';
        s.translate(-cx * PX, -cy * PX);
        s.fillStyle = s.createPattern(pattern, 'repeat')!;
        s.fillRect(cx * PX, cy * PX, w * PX, h * PX);
        ctx.drawImage(soft, 0, 0);
      };
      layerFor(TERRAIN_MOUNTAIN, p.mountain, PX * 0.35);
      layerFor(TERRAIN_WATER, p.shore, PX * 0.55);
      layerFor(TERRAIN_WATER, p.water, PX * 0.2);
      const sprite = new Sprite(Texture.from(canvas));
      sprite.position.set(cx * PX, cy * PX);
      layer.addChild(sprite);
    }
  }
  return layer;
}
