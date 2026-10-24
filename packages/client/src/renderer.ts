import 'pixi.js/unsafe-eval';
import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import {
  BUILDING_TYPES, TERRAIN_MOUNTAIN, TERRAIN_WATER, TREE_MATURE, costTotal, tileIndex
} from '../../simulation/src/index.ts';
import type { BuildingTypeId, GoodType, World } from '../../simulation/src/index.ts';

export const TILE = 20;
const MIN_SCALE = 0.35;
const MAX_SCALE = 3;

const BUILDING_ACCENTS: Partial<Record<BuildingTypeId, number>> = {
  castle: 0xe3a33b, woodcutter: 0x8a5a2b, forester: 0x4e7a3a, sawmill: 0xc98f3b, stonecutter: 0x8d8a7c
};
const GOOD_COLORS: Record<GoodType, number> = { log: 0x7a4d24, plank: 0xd8a85e, stone: 0xa3a39b };

export interface Ghost {
  typeId: BuildingTypeId;
  x: number;
  y: number;
  isValid: boolean;
}

export interface ViewState {
  ghost: Ghost | null;
  selectedId: number | null;
}

function hash(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  return ((h >>> 0) % 1000) / 1000;
}

function shade(color: number, amount: number): number {
  const r = Math.max(0, Math.min(255, ((color >> 16) & 255) + amount));
  const g = Math.max(0, Math.min(255, ((color >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (color & 255) + amount));
  return (r << 16) | (g << 8) | b;
}

export class MapView {
  readonly app: Application;
  readonly camera = new Container();
  private readonly terrain = new Sprite();
  private readonly territory = new Graphics();
  private readonly objects = new Graphics();
  private readonly buildingLayer = new Container();
  private readonly settlers = new Graphics();
  private readonly overlay = new Graphics();
  private readonly buildingGraphics = new Map<number, { body: Graphics; label: Text }>();
  private mapVersion = -1;
  private world: World;

  private constructor(app: Application, world: World) {
    this.app = app;
    this.world = world;
    this.camera.addChild(this.terrain, this.territory, this.objects, this.buildingLayer, this.settlers, this.overlay);
    app.stage.addChild(this.camera);
  }

  static async create(host: HTMLElement, world: World): Promise<MapView> {
    const app = new Application();
    await app.init({
      resizeTo: host, background: '#141b18', antialias: true, preference: 'webgl',
      autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2)
    });
    host.appendChild(app.canvas);
    // The map area changes size when the phone drawer opens or closes, not only on window resize.
    new ResizeObserver(() => app.resize()).observe(host);
    const view = new MapView(app, world);
    view.setWorld(world);
    return view;
  }

  setWorld(world: World): void {
    this.world = world;
    this.mapVersion = -1;
    for (const { body, label } of this.buildingGraphics.values()) { body.destroy(); label.destroy(); }
    this.buildingGraphics.clear();
    this.drawTerrain();
    this.drawTerritory();
  }

  get scale(): number { return this.camera.scale.x; }

  private drawTerrain(): void {
    const { world } = this;
    const canvas = document.createElement('canvas');
    canvas.width = world.width * TILE;
    canvas.height = world.height * TILE;
    const ctx = canvas.getContext('2d')!;
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        const i = tileIndex(world, x, y);
        const t = world.terrain[i];
        const base = t === TERRAIN_WATER ? 0x4f7fa6 : t === TERRAIN_MOUNTAIN ? 0x8d8a7c : 0x7a9450;
        const color = shade(base, Math.round((hash(i) - 0.5) * 14));
        ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
    this.terrain.texture?.destroy(true);
    this.terrain.texture = Texture.from(canvas);
  }

  private drawTerritory(): void {
    const { world } = this;
    const g = this.territory.clear();
    const owned = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < world.width && y < world.height && world.territory[tileIndex(world, x, y)] === 1;
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        if (!owned(x, y)) {
          g.rect(x * TILE, y * TILE, TILE, TILE);
          continue;
        }
      }
    }
    g.fill({ color: 0x0f1412, alpha: 0.28 });
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        if (!owned(x, y)) continue;
        const px = x * TILE, py = y * TILE;
        if (!owned(x, y - 1)) g.moveTo(px, py).lineTo(px + TILE, py);
        if (!owned(x, y + 1)) g.moveTo(px, py + TILE).lineTo(px + TILE, py + TILE);
        if (!owned(x - 1, y)) g.moveTo(px, py).lineTo(px, py + TILE);
        if (!owned(x + 1, y)) g.moveTo(px + TILE, py).lineTo(px + TILE, py + TILE);
      }
    }
    g.stroke({ width: 3, color: 0xe3a33b, alpha: 0.85 });
  }

  private drawObjects(): void {
    const { world } = this;
    const g = this.objects.clear();
    for (let i = 0; i < world.tree.length; i++) {
      const growth = world.tree[i];
      if (growth < 0 && world.rock[i] === 0) continue;
      const cx = (i % world.width) * TILE + TILE / 2;
      const cy = Math.floor(i / world.width) * TILE + TILE / 2;
      if (world.rock[i] > 0) {
        const r = TILE * (0.22 + 0.04 * world.rock[i]);
        g.roundRect(cx - r, cy - r * 0.8, r * 2, r * 1.6, 4).fill(0xa8a59a).stroke({ width: 1, color: 0x6f6d65 });
      } else if (growth >= TREE_MATURE) {
        g.circle(cx, cy, TILE * 0.46).fill(0x3d5a2e);
        g.circle(cx - 2, cy - 2, TILE * 0.28).fill(0x4f7038);
      } else {
        g.circle(cx, cy, TILE * (0.12 + 0.3 * (growth / TREE_MATURE))).fill(0x6d8f45);
      }
    }
  }

  private drawBuildings(selectedId: number | null): void {
    const { world } = this;
    const alive = new Set<number>();
    for (const b of world.buildings) {
      alive.add(b.id);
      let entry = this.buildingGraphics.get(b.id);
      if (!entry) {
        const label = new Text({
          text: BUILDING_TYPES[b.typeId].label,
          style: { fontFamily: 'Barlow, system-ui, sans-serif', fontSize: 11, fontWeight: '600', fill: 0x1b2420 },
          resolution: 3
        });
        label.anchor.set(0.5);
        entry = { body: new Graphics(), label };
        this.buildingLayer.addChild(entry.body, entry.label);
        this.buildingGraphics.set(b.id, entry);
      }
      const { body, label } = entry;
      const x = b.x * TILE + 1, y = b.y * TILE + 1, size = b.size * TILE - 2;
      const accent = BUILDING_ACCENTS[b.typeId] ?? 0x8fb3d9;
      body.clear();
      if (b.isComplete) {
        body.roundRect(x, y, size, size, 4).fill(0xd8cfb8);
        body.rect(x, y, size, 5).fill(accent);
        label.style.fill = 0x1b2420;
      } else {
        const total = costTotal(BUILDING_TYPES[b.typeId].cost);
        const onSite = b.delivered.log + b.delivered.plank + b.delivered.stone;
        body.roundRect(x, y, size, size, 4).fill({ color: 0xece6d6, alpha: 0.18 }).stroke({ width: 2, color: 0xece6d6, alpha: 0.8 });
        body.rect(x, y + size - size * b.buildProgress, size, size * b.buildProgress).fill({ color: 0xd8cfb8, alpha: 0.75 });
        for (let k = 0; k < Math.min(onSite, 8); k++) body.rect(x + 3 + k * 6, y + 3, 4, 4).fill(0xd8a85e);
        label.style.fill = 0xece6d6;
        if (total === 0) body.rect(x, y, size, 5).fill(accent);
      }
      body.rect(b.doorX * TILE + TILE * 0.3, b.doorY * TILE - 3, TILE * 0.4, 6).fill(0x4a3b2a);
      if (b.blockedReason && b.blockedSince !== null && world.tick - b.blockedSince > 30) {
        body.roundRect(x - 2, y - 2, size + 4, size + 4, 5).stroke({ width: 3, color: 0xe8763a });
      }
      if (b.id === selectedId) body.roundRect(x - 4, y - 4, size + 8, size + 8, 6).stroke({ width: 2, color: 0xffffff });
      label.text = b.isComplete ? BUILDING_TYPES[b.typeId].label : `${BUILDING_TYPES[b.typeId].label} ${Math.floor(b.buildProgress * 100)}%`;
      label.position.set(x + size / 2, y + size / 2 + 2);
      label.style.wordWrap = true;
      label.style.wordWrapWidth = size - 4;
      label.style.align = 'center';
    }
    for (const [id, entry] of this.buildingGraphics) {
      if (alive.has(id)) continue;
      entry.body.destroy(); entry.label.destroy();
      this.buildingGraphics.delete(id);
    }
  }

  private drawSettlers(alpha: number): void {
    const g = this.settlers.clear();
    for (const s of this.world.settlers) {
      if (s.isInside) continue;
      const x = (s.prevX + (s.x - s.prevX) * alpha) * TILE + TILE / 2;
      const y = (s.prevY + (s.y - s.prevY) * alpha) * TILE + TILE / 2;
      const color = s.settlerType === 'carrier' ? 0xece6d6 : s.settlerType === 'builder' ? 0xe3a33b : 0x8fb3d9;
      g.circle(x, y, TILE * 0.26).fill(color).stroke({ width: 1, color: 0x1b2420 });
      if (s.carrying) g.rect(x - 4, y - TILE * 0.62, 8, 6).fill(GOOD_COLORS[s.carrying]).stroke({ width: 1, color: 0x1b2420 });
    }
  }

  private drawOverlay(ghost: Ghost | null): void {
    const g = this.overlay.clear();
    if (!ghost) return;
    const size = BUILDING_TYPES[ghost.typeId].size;
    const color = ghost.isValid ? 0x8fdc7a : 0xe8763a;
    g.rect(ghost.x * TILE, ghost.y * TILE, size * TILE, size * TILE).fill({ color, alpha: 0.4 }).stroke({ width: 2, color });
    const doorX = ghost.x + Math.floor(size / 2), doorY = ghost.y + size;
    g.rect(doorX * TILE + 3, doorY * TILE + 3, TILE - 6, TILE - 6).stroke({ width: 2, color });
  }

  render(alpha: number, state: ViewState): void {
    if (this.mapVersion !== this.world.mapVersion) {
      this.mapVersion = this.world.mapVersion;
      this.drawObjects();
    }
    this.drawBuildings(state.selectedId);
    this.drawSettlers(alpha);
    this.drawOverlay(state.ghost);
  }

  // ------------------------------------------------------------- camera

  screenToTile(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    const wx = (clientX - rect.left - this.camera.x) / this.scale;
    const wy = (clientY - rect.top - this.camera.y) / this.scale;
    return { x: Math.floor(wx / TILE), y: Math.floor(wy / TILE) };
  }

  panBy(dx: number, dy: number): void {
    this.camera.x += dx;
    this.camera.y += dy;
    this.clamp();
  }

  zoomAt(factor: number, clientX: number, clientY: number): void {
    const rect = this.app.canvas.getBoundingClientRect();
    const sx = clientX - rect.left, sy = clientY - rect.top;
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.scale * factor));
    const wx = (sx - this.camera.x) / this.scale, wy = (sy - this.camera.y) / this.scale;
    this.camera.scale.set(next);
    this.camera.x = sx - wx * next;
    this.camera.y = sy - wy * next;
    this.clamp();
  }

  zoomCentre(factor: number): void {
    const rect = this.app.canvas.getBoundingClientRect();
    this.zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  centreOn(tileX: number, tileY: number): void {
    const { width, height } = this.app.screen;
    this.camera.x = width / 2 - (tileX + 0.5) * TILE * this.scale;
    this.camera.y = height / 2 - (tileY + 0.5) * TILE * this.scale;
    this.clamp();
  }

  /** Visible area in tiles, for the minimap frame. */
  visibleTiles(): { x: number; y: number; w: number; h: number } {
    const { width, height } = this.app.screen;
    const s = this.scale * TILE;
    return { x: -this.camera.x / s, y: -this.camera.y / s, w: width / s, h: height / s };
  }

  private clamp(): void {
    const { width, height } = this.app.screen;
    const mapW = this.world.width * TILE * this.scale, mapH = this.world.height * TILE * this.scale;
    const margin = 120;
    this.camera.x = Math.min(margin, Math.max(width - mapW - margin, this.camera.x));
    this.camera.y = Math.min(margin, Math.max(height - mapH - margin, this.camera.y));
  }
}
