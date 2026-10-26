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
  | 'geologist' | 'pioneer' | 'thief' | 'swordsman' | 'spearman' | 'bowman'
  | 'catapult' | 'ballista' | 'cannon' | 'war_gong' | 'priest' | 'donkey' | 'transport_ship' | 'trade_ship';
export type SettlerAnim = 'walk' | 'carry' | 'work' | 'attack' | 'die' | 'kick';

/** Several settler types share a look; workers who stay indoors all share one. */
const SETTLER_LOOKS: Partial<Record<SettlerType, SettlerLook>> = {
  carrier: 'carrier', builder: 'builder', digger: 'digger', woodcutter: 'woodcutter', stonecutter: 'stonecutter', miner: 'stonecutter',
  forester: 'farmer', farmer: 'farmer', wine_grower: 'farmer', rice_farmer: 'farmer', beekeeper: 'farmer', fisher: 'fisher',
  geologist: 'geologist', pioneer: 'pioneer', thief: 'thief', swordsman: 'swordsman', spearman: 'spearman', bowman: 'bowman',
  catapult: 'catapult', ballista: 'ballista', cannon: 'cannon', war_gong: 'war_gong', priest: 'priest', donkey: 'donkey',
  transport_ship: 'transport_ship', trade_ship: 'trade_ship'
};

/** Looks drawn once for every people, such as the donkey. */
const SHARED_LOOKS: readonly SettlerLook[] = ['donkey', 'transport_ship', 'trade_ship'];
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

  get isReady(): boolean { return this.sharedLoaded; }

  private readonly loadedRaces = new Set<RaceType>();
  private sharedLoaded = false;

  /** Loads what a match with these peoples needs; other peoples load when a later match needs them. */
  async load(races: readonly RaceType[]): Promise<void> {
    try {
      if (!this.manifest) {
        const response = await fetch(this.base + 'manifest.json');
        if (!response.ok) return;
        this.manifest = await response.json() as Manifest;
      }
      const manifest = this.manifest;
      const wanted = races.filter((r) => !this.loadedRaces.has(r));
      const files = new Set<string>();
      if (!this.sharedLoaded) {
        for (const [key, e] of Object.entries(manifest.buildings)) if (key.startsWith('scaffold/')) files.add(e.file);
        for (const e of Object.values(manifest.nature)) files.add(e.file);
        for (const e of Object.values(manifest.goods)) files.add(e.file);
      }
      for (const [key, e] of Object.entries(manifest.buildings)) if (wanted.some((r) => key.startsWith(r + '/'))) files.add(e.file);
      for (const [key, e] of Object.entries(manifest.settlers)) {
        if (wanted.some((r) => key.startsWith(r + '/')) || (!this.sharedLoaded && SHARED_LOOKS.some((l) => key.endsWith('/' + l)))) files.add(e.file);
      }
      const list = [...files];
      const loaded = await Assets.load(list.map((f) => this.base + f)) as Record<string, Texture>;
      for (const f of list) this.textures.set(f, loaded[this.base + f]);
      this.sharedLoaded = true;
      for (const r of wanted) this.loadedRaces.add(r);
    } catch (error) {
      console.warn('Art could not be loaded; drawing plain shapes instead', error);
    }
  }

  /** True once the art of these peoples is in. */
  hasRaces(races: readonly RaceType[]): boolean { return this.sharedLoaded && races.every((r) => this.loadedRaces.has(r)); }

  private sprite(entry: SpriteEntry | undefined): Sprite | null {
    if (!entry) return null;
    const texture = this.textures.get(entry.file);
    return texture ? { texture, anchorX: entry.anchor[0] / entry.w, anchorY: entry.anchor[1] / entry.h } : null;
  }

  building(race: RaceType, typeId: BuildingTypeId): Sprite | null { return this.sprite(this.manifest?.buildings[`${race}/${typeId}`]); }

  private readonly shadowless = new Map<string, Texture | null>();
  /**
   * A building without its shadow, for while it is being built: the shadow is the half-transparent part of the
   * render, the building itself is solid, so cutting away everything not nearly opaque leaves the building alone.
   * Made once per building in a canvas; the full sprite (with its shadow) shows once the building stands.
   */
  buildingWithoutShadow(race: RaceType, typeId: BuildingTypeId): Sprite | null {
    const entry = this.manifest?.buildings[`${race}/${typeId}`];
    const full = this.sprite(entry);
    if (!entry || !full) return null;
    if (!this.shadowless.has(entry.file)) this.shadowless.set(entry.file, cutShadow(full.texture));
    const texture = this.shadowless.get(entry.file);
    return texture ? { ...full, texture } : full;
  }
  /** A moving part drawn over a building, rendered from the same camera, such as a mill's sails (`mill_sails_3`). */
  buildingPart(race: RaceType, name: string): Sprite | null { return this.sprite(this.manifest?.buildings[`${race}/${name}`]); }
  scaffold(size: number): Sprite | null { return this.sprite(this.manifest?.buildings[`scaffold/${size}`]); }
  nature(name: string): Sprite | null { return this.sprite(this.manifest?.nature[name]); }
  good(good: GoodType): Sprite | null { return this.sprite(this.manifest?.goods[good]); }

  /** The frame of a settler's animation facing direction `dir` (0 = south, 2 = east, 4 = north, 6 = west). */
  settler(race: RaceType, look: SettlerLook, anim: SettlerAnim, dir: number, frame: number): Sprite | null {
    const sheet = this.sheetOf(race, look);
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
    return !!this.sheetOf(race, look)?.anims[anim];
  }

  /** The people's own sheet for a look, or the shared one for looks drawn once for everyone. */
  private sheetOf(race: RaceType, look: SettlerLook): SheetEntry | undefined {
    const own = this.manifest?.settlers[`${race}/${look}`];
    if (own || !SHARED_LOOKS.includes(look) || !this.manifest) return own;
    return Object.entries(this.manifest.settlers).find(([key]) => key.endsWith('/' + look))?.[1];
  }
}

/** Copies a texture keeping only its nearly opaque pixels, which drops a rendered building's soft shadow. */
function cutShadow(texture: Texture): Texture | null {
  try {
    const image = texture.source.resource as CanvasImageSource & { width: number; height: number };
    const canvas = document.createElement('canvas');
    canvas.width = texture.source.width; canvas.height = texture.source.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < data.data.length; i += 4) if (data.data[i] < 235) data.data[i] = 0;
    ctx.putImageData(data, 0, 0);
    return Texture.from(canvas);
  } catch {
    return null;
  }
}
