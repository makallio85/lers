/**
 * Sound effects from Kenney's CC0 audio packs (see public/sound/LICENSE-kenney.txt), converted by art/sounds.sh.
 * Browsers only allow sound after the player has touched or clicked the page, so the board unlocks itself on the
 * first such gesture. Map sounds play only for what is on screen, quieter toward its edges and panned to their side.
 */
export type SoundId =
  | 'chop' | 'hammer' | 'pick' | 'dig' | 'clash' | 'bow' | 'fall' | 'collapse' | 'siege'
  | 'built' | 'place' | 'click' | 'error' | 'alert' | 'victory' | 'defeat';

/** How many variants each sound has on disk (`<sound>_<n>.mp3`); one is picked at random each time. */
const VARIANTS: Record<SoundId, number> = {
  chop: 3, hammer: 3, pick: 3, dig: 3, clash: 3, bow: 2, fall: 2, collapse: 3, siege: 2,
  built: 1, place: 1, click: 1, error: 1, alert: 1, victory: 1, defeat: 1
};
/** Loudness of each sound before distance: work quiet, battle louder, the interface in between. */
const LOUDNESS: Record<SoundId, number> = {
  chop: 0.35, hammer: 0.35, pick: 0.35, dig: 0.45, clash: 0.45, bow: 0.4, fall: 0.5, collapse: 0.8, siege: 0.7,
  built: 0.5, place: 0.5, click: 0.3, error: 0.45, alert: 0.6, victory: 0.7, defeat: 0.7
};
/** The same sound plays at most this often, in milliseconds, so a crowd at work does not become noise. */
const MIN_GAP_MS = 70;
const MAX_PLAYING = 12;
const SOUND_KEY = 'lers.sound';
const SOUND_LEVEL_KEY = 'lers.soundLevel';

/** A loudness kept in this browser, 0 to 100; full when none is kept. */
export function keptLevel(key: string): number {
  let kept: string | null = null;
  try { kept = localStorage.getItem(key); } catch { /* storage blocked */ }
  const n = Number(kept);
  return kept !== null && Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 100;
}
export function keepLevel(key: string, level: number): void {
  try { localStorage.setItem(key, String(level)); } catch { /* storage blocked */ }
}

export class SoundBoard {
  private context: AudioContext | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly lastPlayed = new Map<SoundId, number>();
  /** When each sound now playing ends (performance.now), so the limit counts only sounds still heard. */
  private endsAt: number[] = [];
  /** Sounds started so far, by name; for tests and tuning. */
  readonly played = new Map<SoundId, number>();
  isOn: boolean;
  /** Loudness of all effects, 0 to 100. */
  level = keptLevel(SOUND_LEVEL_KEY);

  constructor() {
    let kept: string | null = null;
    try { kept = localStorage.getItem(SOUND_KEY); } catch { /* storage blocked: sound on */ }
    this.isOn = kept !== 'off';
    const unlock = () => { this.unlock(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    // Browsers suspend sound in a background tab; coming back wakes it again.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.isOn && this.context && this.context.state !== 'running') void this.context.resume().catch(() => {});
    });
  }

  setOn(isOn: boolean): void {
    this.isOn = isOn;
    try { localStorage.setItem(SOUND_KEY, isOn ? 'on' : 'off'); } catch { /* storage blocked */ }
    if (isOn) this.unlock();
  }

  setLevel(level: number): void {
    this.level = Math.max(0, Math.min(100, Math.round(level)));
    keepLevel(SOUND_LEVEL_KEY, this.level);
  }

  /** Plays a sound; `pan` from -1 (left) to 1 (right), `volume` from 0 to 1 on top of the sound's own loudness. */
  play(id: SoundId, volume = 1, pan = 0): void {
    const ctx = this.context;
    // Nothing while the tab is hidden: the browser may hold such sounds back, and they would never end.
    if (!this.isOn || !ctx || ctx.state !== 'running' || document.hidden || volume * this.level / 100 <= 0.02) return;
    const now = performance.now();
    this.endsAt = this.endsAt.filter((t) => t > now);
    if (this.endsAt.length >= MAX_PLAYING) return;
    if (now - (this.lastPlayed.get(id) ?? -Infinity) < MIN_GAP_MS) return;
    const buffer = this.buffers.get(`${id}_${Math.floor(Math.random() * VARIANTS[id])}`) ?? this.buffers.get(`${id}_0`);
    if (!buffer) return;
    this.lastPlayed.set(id, now);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    // A little variety in pitch, so repeated strokes do not sound mechanical.
    source.playbackRate.value = 0.94 + Math.random() * 0.12;
    const gain = ctx.createGain();
    gain.gain.value = LOUDNESS[id] * Math.min(1, volume) * (this.level / 100);
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    source.connect(gain).connect(panner).connect(ctx.destination);
    this.endsAt.push(now + (buffer.duration / source.playbackRate.value) * 1000 + 50);
    this.played.set(id, (this.played.get(id) ?? 0) + 1);
    source.start();
  }

  /**
   * A sound from the map at a point on the canvas: silent off screen, quieter toward the edges and when zoomed out,
   * panned toward its side.
   */
  playAt(id: SoundId, x: number, y: number, width: number, height: number, zoom: number): void {
    if (x < -40 || y < -40 || x > width + 40 || y > height + 40) return;
    const dx = (x - width / 2) / (width / 2), dy = (y - height / 2) / (height / 2);
    const edge = Math.min(1, Math.hypot(dx, dy * 0.8));
    this.play(id, (1 - edge * 0.6) * Math.min(1, 0.45 + zoom * 0.45), dx * 0.7);
  }

  private unlock(): void {
    if (!this.isOn) return;
    if (!this.context) {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      this.context = new Context();
      void this.load();
    }
    if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
  }

  private async load(): Promise<void> {
    const ctx = this.context!;
    await Promise.all((Object.keys(VARIANTS) as SoundId[]).flatMap((id) => Array.from({ length: VARIANTS[id] }, async (_, k) => {
      try {
        const response = await fetch(`sound/${id}_${k}.mp3`);
        if (!response.ok) return;
        this.buffers.set(`${id}_${k}`, await ctx.decodeAudioData(await response.arrayBuffer()));
      } catch { /* a missing or undecodable sound stays silent */ }
    })));
  }
}
