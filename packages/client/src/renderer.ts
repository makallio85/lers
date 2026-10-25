import 'pixi.js/unsafe-eval';
import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import {
  BUILDING_TYPES, DEPOSIT_COAL, FIELD_RIPE, SOLDIER_STATS, TERRAIN_MOUNTAIN, TERRAIN_WATER, TREE_MATURE, VISION_NONE,
  VISION_VISIBLE, canSee, isMilitaryBuilding, isSoldierType, tileIndex
} from '../../simulation/src/index.ts';
import type { Building, BuildingTypeId, GoodType, World } from '../../simulation/src/index.ts';

export const TILE = 20;
const MIN_SCALE = 0.3;
const MAX_SCALE = 3;

/** Border and banner colour per player: you, then the computer. */
const OWNER_COLORS = [0xe3a33b, 0xd05a5a, 0x8fb3d9, 0x9b7fbf];

const BUILDING_ACCENTS: Partial<Record<BuildingTypeId, number>> = {
  woodcutter: 0x8a5a2b, forester: 0x4e7a3a, sawmill: 0xc98f3b, stonecutter: 0x8d8a7c,
  farm: 0xd9b44a, mill: 0xe8d9a8, bakery: 0xc77b3c, waterworks: 0x4f7fa6, fisher: 0x5d93bf, pig_farm: 0xe8a0a0, slaughterhouse: 0xb04a4a,
  coal_mine: 0x2a2a2a, iron_mine: 0x8a5a4a, smelter: 0x9aa3ad, toolsmith: 0x6d6a60, weaponsmith: 0x6d6a60, barracks: 0x7a3030,
  residence_small: 0x9b7fbf, residence_medium: 0x9b7fbf, residence_large: 0x9b7fbf, storage: 0x6d6a60
};
const GOOD_COLORS: Record<GoodType, number> = {
  log: 0x7a4d24, plank: 0xd8a85e, stone: 0xa3a39b, grain: 0xe3c35a, flour: 0xf4efe2, water: 0x5d93bf,
  bread: 0xb5763a, fish: 0x8fb3d9, pig: 0xe8a0a0, meat: 0xb04a4a, coal: 0x2a2a2a, iron_ore: 0x8a5a4a, iron: 0x9aa3ad, gold_ore: 0xb8963a, gold: 0xe8c547,
  axe: 0x5a5a5a, saw: 0x5a5a5a, pick: 0x5a5a5a, scythe: 0x5a5a5a, shovel: 0x5a5a5a, hammer: 0x5a5a5a, rod: 0x5a5a5a,
  sword: 0xc0c6cc, spear: 0xc0c6cc, bow: 0x8a5a2b
};
const SETTLER_COLORS: Partial<Record<string, number>> = {
  carrier: 0xece6d6, builder: 0xe3a33b, digger: 0xb07a45,
  swordsman: 0xd05a5a, spearman: 0xe3a33b, bowman: 0x8fb3d9
};

export interface Ghost {
  typeId: BuildingTypeId;
  x: number;
  y: number;
  isValid: boolean;
}

export interface ViewState {
  ghost: Ghost | null;
  /** Top-left tiles where the building being placed fits. */
  markers: readonly number[];
  markerSize: number;
  selectedId: number | null;
  selectedSoldiers: ReadonlySet<number>;
  /** Drag-selection rectangle in screen pixels relative to the map canvas. */
  selectionBox: { x0: number; y0: number; x1: number; y1: number } | null;
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
  /** The player whose eyes the map is drawn through. */
  viewer = 0;
  private readonly terrain = new Sprite();
  private readonly territory = new Graphics();
  private readonly objects = new Graphics();
  private readonly buildingLayer = new Container();
  private readonly settlers = new Graphics();
  private readonly fog = new Sprite();
  private readonly overlay = new Graphics();
  private readonly screenOverlay = new Graphics();
  private readonly buildingGraphics = new Map<number, { body: Graphics; label: Text }>();
  private fogCanvas = document.createElement('canvas');
  private mapVersion = -1;
  private territoryVersion = -1;
  private fogKey = -1;
  private world: World;

  private constructor(app: Application, world: World) {
    this.app = app;
    this.world = world;
    this.camera.addChild(this.terrain, this.territory, this.objects, this.buildingLayer, this.settlers, this.fog, this.overlay);
    app.stage.addChild(this.camera, this.screenOverlay);
  }

  static async create(host: HTMLElement, world: World): Promise<MapView> {
    const app = new Application();
    await app.init({
      resizeTo: host, background: '#0f1412', antialias: true, preference: 'webgl',
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
    this.territoryVersion = -1;
    this.fogKey = -1;
    for (const { body, label } of this.buildingGraphics.values()) { body.destroy(); label.destroy(); }
    this.buildingGraphics.clear();
    this.drawTerrain();
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = world.width;
    this.fogCanvas.height = world.height;
    this.fog.texture = Texture.from(this.fogCanvas);
    this.fog.scale.set(TILE);
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
    const ownerAt = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < world.width && y < world.height ? world.territory[tileIndex(world, x, y)] : 0;
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) if (ownerAt(x, y) !== this.viewer + 1) g.rect(x * TILE, y * TILE, TILE, TILE);
    }
    g.fill({ color: 0x0f1412, alpha: 0.22 });
    for (let owner = 1; owner <= world.players.length; owner++) {
      for (let y = 0; y < world.height; y++) {
        for (let x = 0; x < world.width; x++) {
          if (ownerAt(x, y) !== owner) continue;
          const px = x * TILE, py = y * TILE;
          if (ownerAt(x, y - 1) !== owner) g.moveTo(px, py).lineTo(px + TILE, py);
          if (ownerAt(x, y + 1) !== owner) g.moveTo(px, py + TILE).lineTo(px + TILE, py + TILE);
          if (ownerAt(x - 1, y) !== owner) g.moveTo(px, py).lineTo(px, py + TILE);
          if (ownerAt(x + 1, y) !== owner) g.moveTo(px + TILE, py).lineTo(px + TILE, py + TILE);
        }
      }
      g.stroke({ width: 3, color: OWNER_COLORS[owner - 1], alpha: 0.9 });
    }
  }

  private drawObjects(): void {
    const { world } = this;
    const g = this.objects.clear();
    for (let i = 0; i < world.tree.length; i++) {
      const growth = world.tree[i];
      const px = (i % world.width) * TILE, py = Math.floor(i / world.width) * TILE;
      if (world.field[i] >= 0) {
        const t = world.field[i] / FIELD_RIPE;
        const color = t >= 1 ? 0xe0b84a : shade(0x8fa34a, Math.round(t * 50));
        g.rect(px + 2, py + 2, TILE - 4, TILE - 4).fill(color);
        for (let k = 0; k < 3; k++) g.rect(px + 4 + k * 5, py + 4, 1.5, TILE - 8).fill({ color: 0x5b6a2c, alpha: 0.5 });
        continue;
      }
      const cx = px + TILE / 2, cy = py + TILE / 2;
      if (world.deposit[i] !== 0 && world.depositAmount[i] > 0 && world.rock[i] === 0) {
        // Ore is marked on the mountain until geologists arrive: black for coal, rust for iron.
        g.circle(cx - 3, cy + 2, 2.4).circle(cx + 3, cy - 1, 2).fill(world.deposit[i] === DEPOSIT_COAL ? 0x1e1e1e : 0xa0522d);
      }
      if (growth < 0 && world.rock[i] === 0) continue;
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

  private drawFog(): void {
    const { world } = this;
    const vision = world.vision[this.viewer];
    if (!vision) return;
    const ctx = this.fogCanvas.getContext('2d')!;
    const img = ctx.createImageData(world.width, world.height);
    for (let i = 0; i < vision.length; i++) {
      // Unexplored land is dark; explored land out of sight is dimmed.
      const alpha = vision[i] === VISION_NONE ? 235 : vision[i] === VISION_VISIBLE ? 0 : 110;
      img.data.set([15, 20, 18, alpha], i * 4);
    }
    ctx.putImageData(img, 0, 0);
    this.fog.texture.source.update();
  }

  isBuildingVisible(b: Building): boolean {
    return b.owner === this.viewer || canSee(this.world, this.viewer, b.doorX, b.doorY)
      || canSee(this.world, this.viewer, b.x + b.size / 2, b.y + b.size / 2);
  }

  private drawBuildings(selectedId: number | null): void {
    const { world } = this;
    const alive = new Set<number>();
    for (const b of world.buildings) {
      if (!this.isBuildingVisible(b)) continue;
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
      const isMine = b.owner === this.viewer;
      const accent = isMilitaryBuilding(b) ? OWNER_COLORS[b.owner] : BUILDING_ACCENTS[b.typeId] ?? 0x8fb3d9;
      body.clear();
      if (b.isComplete) {
        body.roundRect(x, y, size, size, 4).fill(isMine ? 0xd8cfb8 : 0xbfb3a6);
        body.rect(x, y, size, 5).fill(accent);
        if (!isMine) body.roundRect(x, y, size, size, 4).stroke({ width: 2, color: OWNER_COLORS[b.owner] });
        label.style.fill = 0x1b2420;
      } else {
        const onSite = b.delivered.plank + b.delivered.stone + b.delivered.log;
        if (b.levelProgress < 1) {
          body.roundRect(x, y, size, size, 4).fill({ color: 0x8a6a45, alpha: 0.35 * b.levelProgress + 0.1 }).stroke({ width: 2, color: 0xece6d6, alpha: 0.6 });
        } else {
          body.roundRect(x, y, size, size, 4).fill({ color: 0x9c7a50, alpha: 0.45 }).stroke({ width: 2, color: 0xece6d6, alpha: 0.8 });
          body.rect(x, y + size - size * b.buildProgress, size, size * b.buildProgress).fill({ color: 0xd8cfb8, alpha: 0.8 });
        }
        for (let k = 0; k < Math.min(onSite, 8); k++) body.rect(x + 3 + k * 6, y + 3, 4, 4).fill(0xd8a85e);
        label.style.fill = 0xece6d6;
      }
      // Soldiers inside a tower or castle as small shields along the bottom edge.
      if (b.isComplete && isMilitaryBuilding(b)) {
        for (let k = 0; k < Math.min(b.garrison.length, 6); k++) {
          const sx = x + 4 + k * 7, sy = y + size - 9;
          body.moveTo(sx, sy).lineTo(sx + 5, sy).lineTo(sx + 5, sy + 3).lineTo(sx + 2.5, sy + 6).lineTo(sx, sy + 3).closePath()
            .fill(OWNER_COLORS[b.owner]).stroke({ width: 1, color: 0x1b2420 });
        }
      }
      if (b.isComplete && b.isPaused) body.rect(x + size - 12, y + 8, 3, 8).fill(0x1b2420).rect(x + size - 7, y + 8, 3, 8).fill(0x1b2420);
      body.rect(b.doorX * TILE + TILE * 0.3, b.doorY * TILE - 3, TILE * 0.4, 6).fill(0x4a3b2a);
      if (isMine && b.blockedReason && b.blockedSince !== null && world.tick - b.blockedSince > 30) {
        body.roundRect(x - 2, y - 2, size + 4, size + 4, 5).stroke({ width: 3, color: 0xe8763a });
      }
      if (b.id === selectedId) body.roundRect(x - 4, y - 4, size + 8, size + 8, 6).stroke({ width: 2, color: 0xffffff });
      const name = BUILDING_TYPES[b.typeId].label;
      label.text = b.isComplete ? name
        : b.levelProgress < 1 ? `${name}\nlevelling ${Math.floor(b.levelProgress * 100)}%`
        : `${name} ${Math.floor(b.buildProgress * 100)}%`;
      label.position.set(x + size / 2, y + size / 2 + 1);
      label.style.wordWrap = true;
      label.style.wordWrapWidth = Math.max(size * 1.6, 60);
      label.style.align = 'center';
      // Shrink long names so they stay inside small buildings instead of running into neighbours.
      label.scale.set(1);
      const fit = Math.min(1, (size - 4) / label.width, (size - 12) / label.height);
      label.scale.set(fit);
    }
    for (const [id, entry] of this.buildingGraphics) {
      if (alive.has(id)) continue;
      entry.body.destroy(); entry.label.destroy();
      this.buildingGraphics.delete(id);
    }
  }

  private drawSettlers(alpha: number, selected: ReadonlySet<number>): void {
    const g = this.settlers.clear();
    for (const s of this.world.settlers) {
      if (s.isInside) continue;
      if (s.owner !== this.viewer && !canSee(this.world, this.viewer, s.x, s.y)) continue;
      const x = (s.prevX + (s.x - s.prevX) * alpha) * TILE + TILE / 2;
      const y = (s.prevY + (s.y - s.prevY) * alpha) * TILE + TILE / 2;
      const color = SETTLER_COLORS[s.settlerType] ?? 0x8fb3d9;
      if (isSoldierType(s.settlerType)) {
        const r = TILE * 0.32;
        if (s.owner === this.viewer) {
          if (selected.has(s.id)) g.circle(x, y, r + 4).stroke({ width: 2, color: 0xffffff });
          g.circle(x, y, r).fill(color).stroke({ width: 2, color: 0x1b2420 });
        } else {
          // Enemy soldiers are diamonds in the enemy's colour, so they read differently at a glance.
          g.moveTo(x, y - r - 2).lineTo(x + r + 2, y).lineTo(x, y + r + 2).lineTo(x - r - 2, y).closePath()
            .fill(0x3a1f1f).stroke({ width: 2, color: OWNER_COLORS[s.owner] });
          g.circle(x, y, r * 0.45).fill(color);
        }
        const max = SOLDIER_STATS[s.settlerType].health;
        if (s.health < max) {
          g.rect(x - 8, y - r - 8, 16, 3).fill(0x1b2420);
          g.rect(x - 8, y - r - 8, 16 * (s.health / max), 3).fill(s.health / max > 0.4 ? 0x8fdc7a : 0xe8763a);
        }
        continue;
      }
      g.circle(x, y, TILE * 0.26).fill(color).stroke({ width: 1, color: s.owner === this.viewer ? 0x1b2420 : OWNER_COLORS[s.owner] });
      if (s.carrying) g.rect(x - 4, y - TILE * 0.62, 8, 6).fill(GOOD_COLORS[s.carrying]).stroke({ width: 1, color: 0x1b2420 });
    }
  }

  private drawOverlay(state: ViewState): void {
    const g = this.overlay.clear();
    const { ghost, markers, markerSize } = state;
    // Placement markers: a small diamond at the centre of every spot where the building fits.
    const half = (markerSize * TILE) / 2;
    for (const i of markers) {
      const cx = (i % this.world.width) * TILE + half, cy = Math.floor(i / this.world.width) * TILE + half;
      g.moveTo(cx, cy - 4).lineTo(cx + 4, cy).lineTo(cx, cy + 4).lineTo(cx - 4, cy).closePath();
    }
    if (markers.length > 0) g.fill({ color: 0x8fdc7a, alpha: 0.85 });
    if (ghost) {
      const size = BUILDING_TYPES[ghost.typeId].size;
      const color = ghost.isValid ? 0x8fdc7a : 0xe8763a;
      g.rect(ghost.x * TILE, ghost.y * TILE, size * TILE, size * TILE).fill({ color, alpha: 0.4 }).stroke({ width: 2, color });
      const doorX = ghost.x + Math.floor(size / 2), doorY = ghost.y + size;
      g.rect(doorX * TILE + 3, doorY * TILE + 3, TILE - 6, TILE - 6).stroke({ width: 2, color });
    }
    const box = this.screenOverlay.clear();
    if (state.selectionBox) {
      const { x0, y0, x1, y1 } = state.selectionBox;
      box.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0))
        .fill({ color: 0xece6d6, alpha: 0.08 }).stroke({ width: 2, color: 0xece6d6 });
    }
  }

  render(alpha: number, state: ViewState): void {
    if (this.territoryVersion !== this.world.territoryVersion) {
      this.territoryVersion = this.world.territoryVersion;
      this.drawTerritory();
    }
    if (this.mapVersion !== this.world.mapVersion) {
      this.mapVersion = this.world.mapVersion;
      this.drawObjects();
    }
    const fogKey = Math.floor(this.world.tick / 10);
    if (fogKey !== this.fogKey) { this.fogKey = fogKey; this.drawFog(); }
    this.drawBuildings(state.selectedId);
    this.drawSettlers(alpha, state.selectedSoldiers);
    this.drawOverlay(state);
  }

  // ------------------------------------------------------------- camera

  screenToTile(clientX: number, clientY: number): { x: number; y: number } {
    const p = this.screenToWorld(clientX, clientY);
    return { x: Math.floor(p.x), y: Math.floor(p.y) };
  }

  /** Map coordinates in tiles (fractional) under a point on screen. */
  screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    const wx = (clientX - rect.left - this.camera.x) / this.scale;
    const wy = (clientY - rect.top - this.camera.y) / this.scale;
    return { x: wx / TILE, y: wy / TILE };
  }

  /** Screen position (relative to the canvas) of a settler-style tile coordinate. */
  tileToCanvas(x: number, y: number): { x: number; y: number } {
    return { x: (x + 0.5) * TILE * this.scale + this.camera.x, y: (y + 0.5) * TILE * this.scale + this.camera.y };
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
