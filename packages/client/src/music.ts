import { keepLevel, keptLevel } from './sound.ts';

/**
 * Background music: four CC0 medieval tracks by RandomMind (see public/music/CREDITS.txt), converted by art/music.sh.
 * Streamed one at a time, each loop played twice before the next, quietly under the sound effects. Two players take
 * turns, so each loop fades into the next over a few seconds instead of cutting over. The music starts on the
 * player's first tap or click, as browsers require, keeps playing while the tab is in the background, stops while
 * the game is paused, and can be turned off.
 */
const TRACKS = ['bards_tale', 'old_tower_inn', 'kings_feast', 'minstrel_dance'] as const;
const PLAYS_PER_TRACK = 2;
const VOLUME = 0.28;
/** How long one loop fades into the next, in seconds. */
const FADE_S = 4;
const MUSIC_KEY = 'lers.music';
const MUSIC_LEVEL_KEY = 'lers.musicLevel';

export class MusicPlayer {
  private readonly players = [new Audio(), new Audio()];
  /** The player now heard; the other one fades out, or waits. */
  private current = 0;
  private track = Math.floor(Math.random() * TRACKS.length);
  private plays = 0;
  private hasStarted = false;
  /** While a fade runs: when it began (performance.now), else null. */
  private fadeStart: number | null = null;
  isOn: boolean;
  /** Loudness, 0 to 100, on top of the quiet base volume. */
  level = keptLevel(MUSIC_LEVEL_KEY);
  /** While the game is paused the music waits too, and goes on where it stopped. */
  private isPaused = false;
  private readonly base: string;

  constructor(base = './music/') {
    this.base = base;
    let kept: string | null = null;
    try { kept = localStorage.getItem(MUSIC_KEY); } catch { /* storage blocked: music on */ }
    this.isOn = kept !== 'off';
    for (const audio of this.players) {
      audio.preload = 'auto';
      audio.volume = 0;
      // Near the end of a loop, the next one starts on the other player and the two cross over.
      audio.addEventListener('timeupdate', () => {
        if (audio !== this.audio || this.fadeStart !== null || !Number.isFinite(audio.duration)) return;
        if (audio.duration - audio.currentTime <= FADE_S) this.next();
      });
      // A loop too short to fade, or a missed update: go straight on.
      audio.addEventListener('ended', () => { if (audio === this.audio && this.fadeStart === null) this.next(); });
    }
    const start = () => { this.start(); window.removeEventListener('pointerdown', start); window.removeEventListener('keydown', start); };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
    for (const audio of this.players) audio.addEventListener('playing', () => this.onPlaying?.());
    // Straight away on the title, where the browser allows it (a site often played, or sound allowed for it);
    // otherwise on the first tap, click or key.
    this.start();
    // The match goes on in a background tab, and so does its music; coming back resumes it if the browser paused it.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.isOn && !this.isPaused && this.hasStarted && this.audio.paused) void this.audio.play().catch(() => {});
    });
  }

  /** Called when the music starts playing, so the title can drop its hint. */
  onPlaying: (() => void) | null = null;

  /** Whether music is on but the browser still holds it back until the first tap, click or key. */
  get isWaitingForGesture(): boolean { return this.isOn && !this.isPaused && this.audio.paused; }

  /** The player now heard. */
  get audio(): HTMLAudioElement { return this.players[this.current]; }

  private get fullVolume(): number { return VOLUME * this.level / 100; }

  setOn(isOn: boolean): void {
    this.isOn = isOn;
    try { localStorage.setItem(MUSIC_KEY, isOn ? 'on' : 'off'); } catch { /* storage blocked */ }
    if (isOn) this.start(); else this.stopBoth();
  }

  setLevel(level: number): void {
    this.level = Math.max(0, Math.min(100, Math.round(level)));
    keepLevel(MUSIC_LEVEL_KEY, this.level);
    if (this.fadeStart === null) this.audio.volume = this.fullVolume;
  }

  setPaused(isPaused: boolean): void {
    this.isPaused = isPaused;
    if (isPaused) this.stopBoth(); else this.start();
  }

  private start(): void {
    if (!this.isOn || this.isPaused) return;
    if (!this.hasStarted) { this.hasStarted = true; this.audio.src = this.source(); }
    if (this.fadeStart === null) this.audio.volume = this.fullVolume;
    void this.audio.play().catch(() => {});
  }

  /** Pauses whatever plays; a fade in progress ends at once, on the newer loop. */
  private stopBoth(): void {
    if (this.fadeStart !== null) this.finishFade();
    for (const audio of this.players) audio.pause();
  }

  private source(): string { return `${this.base}${TRACKS[this.track]}.mp3`; }

  /** The current loop again, or after its plays the next track, faded in on the other player. */
  private next(): void {
    this.plays++;
    if (this.plays >= PLAYS_PER_TRACK) { this.plays = 0; this.track = (this.track + 1) % TRACKS.length; }
    if (!this.isOn || this.isPaused) return;
    this.current = 1 - this.current;
    const incoming = this.audio;
    incoming.src = this.source();
    incoming.currentTime = 0;
    incoming.volume = 0;
    void incoming.play().catch(() => {});
    this.fadeStart = performance.now();
    const step = () => {
      if (this.fadeStart === null) return;
      const t = Math.min(1, (performance.now() - this.fadeStart) / (FADE_S * 1000));
      incoming.volume = this.fullVolume * t;
      this.players[1 - this.current].volume = this.fullVolume * (1 - t);
      if (t >= 1) this.finishFade(); else setTimeout(step, 50);
    };
    step();
  }

  private finishFade(): void {
    this.fadeStart = null;
    const outgoing = this.players[1 - this.current];
    outgoing.pause();
    outgoing.volume = 0;
    this.audio.volume = this.fullVolume;
  }
}
