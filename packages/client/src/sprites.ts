import { Assets, Rectangle, Texture } from 'pixi.js';
import type { BuildingTypeId, GoodType, RaceType, SettlerType } from '../../simulation/src/index.ts';

/** One cropped sprite: its file, size and the point that sits on the map (render pixels, twice screen size). */
export interface SpriteEntry { file: string; w: number; h: number; anchor: [number, number]; size: number }
export interface SheetEntry { file: string; cell: [number, number]; anchor: [number, number]; anims: Record<string, { col: number; frames: number }> }
interface Manifest {
  scale: number;
  buildings: Record<string, SpriteEntry>;
  nature: Record<string, SpriteEntry>;
  goods: Record<string, SpriteEntry>;
  settlers: Record<string, SheetEntry>;
}

export type SettlerLook =
  | 'carrier' | 'builder' | 'digger' | 'woodcutter' | 'stonecutter' | 'farmer' | 'fisher' | 'worker'
  | 'geologist' | 'pioneer' | 'thief' | 'swordsman' | 'spearman' | 'bowman';
export type SettlerAnim = 'walk' | 'carry' | 'work' | 'attack';

/** Several settler types share a look; workers who stay indoors all share one. */
const SETTLER_LOOKS: Partial<Record<SettlerType, SettlerLook>> = {
  carrier: 'carrier', builder: 'builder', digger: 'digger', woodcutter: 'woodcutter', stonecutter: 'stonecutter', miner: 'stonecutter',
  forester: 'farmer', farmer: 'farmer', wine_grower: 'farmer', rice_farmer: 'farmer', beekeeper: 'farmer', fisher: 'fisher',
  geologist: 'geologist', pioneer: 'pioneer', thief: 'thief', swordsman: 'swordsman', spearman: 'spearman', bowman: 'bowman'
};
export function lookOf(type: SettlerType): SettlerLook { return SETTLER_LOOKS[type] ?? 'worker'; }

export const TREE_VARIANTS = ['tree_oak', 'tree_default', 'tree_pineRoundB', 'tree_fat'] as const;

export interface Sprite { texture: Texture; anchorX: number; anchorY: number }

/** Loads the manifest and textures on demand, and hands out textures with their anchors. */
export class SpriteBank {
  private manifest: Manifest | null = null;
  private readonly textures = new Map<string, Texture>();
  private readonly frames = new Map<string, Texture>();
  readonly scale = 0.5;

  /** Base URL of the art folder; the single-file build sets window.LERS_ART_BASE. */
  private readonly base = ((globalThis as { LERS_ART_BASE?: string }).LERS_ART_BASE ?? './art/');

  get isReady(): boolean { return this.manifest !== null; }

  /** Loads everything a match with these peoples needs. Missing art leaves the old shapes in place. */
  async load(races: readonly RaceType[]): Promise<void> {
    try {
      const response = await fetch(this.base + 'manifest.json');
      if (!response.ok) return;
      const manifest = await response.json() as Manifest;
      const files = new Set<string>();
      for (const [key, e] of Object.entries(manifest.buildings)) if (key.startsWith('scaffold/') || races.some((r) => key.startsWith(r + '/'))) files.add(e.file);
      for (const e of Object.values(manifest.nature)) files.add(e.file);
      for (const e of Object.values(manifest.goods)) files.add(e.file);
      for (const [key, e] of Object.entries(manifest.settlers)) if (races.some((r) => key.startsWith(r + '/'))) files.add(e.file);
      const list = [...files];
      const loaded = await Assets.load(list.map((f) => this.base + f)) as Record<string, Texture>;
      for (const f of list) this.textures.set(f, loaded[this.base + f]);
      this.manifest = manifest;
    } catch (error) {
      console.warn('Art could not be loaded; drawing plain shapes instead', error);
    }
  }

  private sprite(entry: SpriteEntry | undefined): Sprite | null {
    if (!entry) return null;
    const texture = this.textures.get(entry.file);
    return texture ? { texture, anchorX: entry.anchor[0] / entry.w, anchorY: entry.anchor[1] / entry.h } : null;
  }

  building(race: RaceType, typeId: BuildingTypeId): Sprite | null { return this.sprite(this.manifest?.buildings[`${race}/${typeId}`]); }
  scaffold(size: number): Sprite | null { return this.sprite(this.manifest?.buildings[`scaffold/${size}`]); }
  nature(name: string): Sprite | null { return this.sprite(this.manifest?.nature[name]); }
  good(good: GoodType): Sprite | null { return this.sprite(this.manifest?.goods[good]); }

  /** The frame of a settler's animation facing direction `dir` (0 = south, 2 = east, 4 = north, 6 = west). */
  settler(race: RaceType, look: SettlerLook, anim: SettlerAnim, dir: number, frame: number): Sprite | null {
    const sheet = this.manifest?.settlers[`${race}/${look}`];
    if (!sheet) return null;
    const a = sheet.anims[anim] ?? sheet.anims.walk;
    const base = this.textures.get(sheet.file);
    if (!a || !base) return null;
    const col = a.col + (frame % a.frames);
    const key = `${sheet.file}:${col}:${dir}`;
    let texture = this.frames.get(key);
    if (!texture) {
      const [cw, ch] = sheet.cell;
      texture = new Texture({ source: base.source, frame: new Rectangle(col * cw, dir * ch, cw, ch) });
      this.frames.set(key, texture);
    }
    return { texture, anchorX: sheet.anchor[0] / sheet.cell[0], anchorY: sheet.anchor[1] / sheet.cell[1] };
  }

  hasAnim(race: RaceType, look: SettlerLook, anim: SettlerAnim): boolean {
    return !!this.manifest?.settlers[`${race}/${look}`]?.anims[anim];
  }
}
