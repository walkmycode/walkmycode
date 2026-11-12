// A small energy-plus-silence voice activity detector (docs/VOICE.md §4c), fed
// one 20 ms microphone frame at a time (the lantern-mic worklet's 16 kHz
// frames). Pure, so tests drive it with synthetic audio.
//
// - The noise floor is learnt from the frames that are not speech (fast down,
//   slow up; the first ~200 ms only listen to the room), and speech is energy
//   clearly above it: a fan or a busy room raises the bar instead of keeping
//   the utterance open.
// - Speech starts after a short run of loud frames (a click is not a question)
//   and ends after SILENCE_MS of quiet; an utterance shorter than MIN_SPEECH_MS
//   is dropped.
// - While our own voice plays, the mic hears it through the speakers. The
//   echo level is learnt the same way, and only energy well above it, held a
//   little longer, counts: that is a barge-in, not the echo.

export interface VadOptions {
  /** Length of one frame, in ms. */
  frameMs: number;
  /** Quiet that ends an utterance (700–900 ms reads as "I'm done"). */
  silenceMs: number;
  /** Loud frames in a row before speech starts. */
  startMs: number;
  /** Shorter utterances are dropped (a cough, a click). */
  minSpeechMs: number;
  /** An utterance is cut here and sent as it is. */
  maxSpeechMs: number;
  /** Speech is this many times the noise floor… */
  ratio: number;
  /** …and never quieter than this RMS (0–1). */
  minLevel: number;
  /** While our audio plays: this many times the echo level… */
  echoRatio: number;
  /** …never quieter than this… */
  minBargeLevel: number;
  /** …held this long. */
  bargeMs: number;
  /** The first frames only learn the room. */
  warmupMs: number;
}

export const VAD_DEFAULTS: VadOptions = {
  frameMs: 20,
  silenceMs: 800,
  startMs: 80,
  minSpeechMs: 250,
  maxSpeechMs: 30_000,
  ratio: 3.5,
  minLevel: 0.012,
  echoRatio: 2.5,
  minBargeLevel: 0.04,
  bargeMs: 160,
  warmupMs: 200,
};

export type VadEvent =
  /** Speech began; `barge` when it began over our own audio. */
  | { type: "start"; barge: boolean }
  /** The utterance ended after `speechMs` of it (quiet included up to the end). */
  | { type: "end"; speechMs: number; cut: boolean }
  /** What started was too short to be anything: forget it. */
  | { type: "discard" };

/** Root mean square of a frame, 0–1. */
export function rms(frame: ArrayLike<number>, int16 = !(frame instanceof Float32Array || frame instanceof Float64Array)): number {
  const n = frame.length;
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = int16 ? frame[i] / 32768 : frame[i];
    sum += v * v;
  }
  return Math.sqrt(sum / n);
}

export class Vad {
  readonly o: VadOptions;
  /** The learnt noise floor (RMS). */
  floor = 0.004;
  /** The learnt level of our own audio heard back while it plays (RMS). */
  echo = 0.01;
  /** The last frame's level. */
  level = 0;
  speaking = false;
  private playing = false;
  private loud = 0;
  private quiet = 0;
  private speechFrames = 0;
  private seen = 0;

  constructor(o: Partial<VadOptions> = {}) {
    this.o = { ...VAD_DEFAULTS, ...o };
  }

  /** Our own audio started (true) or stopped. */
  setPlayback(on: boolean): void {
    if (on === this.playing) return;
    this.playing = on;
    this.loud = 0;
    // A fresh echo estimate starts no lower than the room itself.
    if (on) this.echo = Math.max(this.echo * 0.5, this.floor);
  }

  get playback(): boolean {
    return this.playing;
  }

  /** The level speech must pass now. */
  threshold(): number {
    const base = Math.max(this.o.minLevel, this.floor * this.o.ratio);
    if (!this.playing || this.speaking) return base;
    return Math.max(base, this.o.minBargeLevel, this.echo * this.o.echoRatio);
  }

  private frames(ms: number): number {
    return Math.max(1, Math.round(ms / this.o.frameMs));
  }

  /** One frame's RMS level in; at most one event out. */
  push(level: number): VadEvent | null {
    this.level = level;
    if (this.seen < this.frames(this.o.warmupMs)) {
      // The room as the microphone opens: the floor follows it closely.
      this.floor = Math.max(0.0005, this.seen++ === 0 ? level : this.floor + (level - this.floor) * 0.4);
      return null;
    }
    if (!this.speaking) {
      const t = this.threshold();
      if (level > t) {
        this.loud++;
        const need = this.frames(this.playing ? this.o.bargeMs : this.o.startMs);
        if (this.loud >= need) {
          this.speaking = true;
          this.speechFrames = this.loud;
          this.quiet = 0;
          this.loud = 0;
          return { type: "start", barge: this.playing };
        }
        return null;
      }
      this.loud = 0;
      // Learn the room (or, while our audio plays, the echo) from what is not speech.
      if (this.playing) this.echo += (level - this.echo) * (level > this.echo ? 0.3 : 0.05);
      else this.floor = Math.max(0.0005, this.floor + (level - this.floor) * (level < this.floor ? 0.2 : 0.02));
      return null;
    }
    this.speechFrames++;
    // Hysteresis: a dip is not the end; quiet is clearly under the bar that started it.
    if (level < this.threshold() * 0.7) this.quiet++;
    else this.quiet = 0;
    const cut = this.speechFrames * this.o.frameMs >= this.o.maxSpeechMs;
    if (this.quiet >= this.frames(this.o.silenceMs) || cut) {
      const voiced = (this.speechFrames - this.quiet) * this.o.frameMs;
      this.speaking = false;
      this.quiet = 0;
      this.speechFrames = 0;
      return voiced < this.o.minSpeechMs && !cut ? { type: "discard" } : { type: "end", speechMs: voiced, cut };
    }
    return null;
  }

  /** Forget the utterance in progress (muted, or push-to-talk let go). */
  reset(): void {
    this.speaking = false;
    this.loud = 0;
    this.quiet = 0;
    this.speechFrames = 0;
  }
}
