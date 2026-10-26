/**
 * Background music: four CC0 medieval tracks by RandomMind (see public/music/CREDITS.txt), converted by art/music.sh.
 * Streamed one at a time, each loop played twice before the next, quietly under the sound effects. It starts on the
 * player's first tap or click, as browsers require, keeps playing while the tab is in the background, stops while
 * the game is paused, and can be turned off.
 */
const TRACKS = ['bards_tale', 'old_tower_inn', 'kings_feast', 'minstrel_dance'] as const;
const PLAYS_PER_TRACK = 2;
const VOLUME = 0.28;
const MUSIC_KEY = 'lers.music';

export class MusicPlayer {
  private readonly audio = new Audio();
  private track = Math.floor(Math.random() * TRACKS.length);
  private plays = 0;
  private hasStarted = false;
  isOn: boolean;
  /** While the game is paused the music waits too, and goes on where it stopped. */
  private isPaused = false;
  private readonly base: string;

  constructor(base = './music/') {
    this.base = base;
    let kept: string | null = null;
    try { kept = localStorage.getItem(MUSIC_KEY); } catch { /* storage blocked: music on */ }
    this.isOn = kept !== 'off';
    this.audio.volume = VOLUME;
    this.audio.preload = 'auto';
    this.audio.addEventListener('ended', () => this.next());
    const start = () => { this.start(); window.removeEventListener('pointerdown', start); window.removeEventListener('keydown', start); };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
    // The match goes on in a background tab, and so does its music; coming back resumes it if the browser paused it.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.isOn && !this.isPaused && this.hasStarted && this.audio.paused) void this.audio.play().catch(() => {});
    });
  }

  setOn(isOn: boolean): void {
    this.isOn = isOn;
    try { localStorage.setItem(MUSIC_KEY, isOn ? 'on' : 'off'); } catch { /* storage blocked */ }
    if (isOn) this.start(); else this.audio.pause();
  }

  setPaused(isPaused: boolean): void {
    this.isPaused = isPaused;
    if (isPaused) this.audio.pause(); else this.start();
  }

  private start(): void {
    if (!this.isOn || this.isPaused) return;
    if (!this.hasStarted) { this.hasStarted = true; this.audio.src = `${this.base}${TRACKS[this.track]}.mp3`; }
    void this.audio.play().catch(() => {});
  }

  /** The current loop again, or after its plays the next track. */
  private next(): void {
    this.plays++;
    if (this.plays >= PLAYS_PER_TRACK) { this.plays = 0; this.track = (this.track + 1) % TRACKS.length; this.audio.src = `${this.base}${TRACKS[this.track]}.mp3`; }
    else this.audio.currentTime = 0;
    if (this.isOn && !this.isPaused) void this.audio.play().catch(() => {});
  }
}
