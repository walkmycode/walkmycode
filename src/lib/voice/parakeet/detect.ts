// Finding utterances in the microphone's audio for on-device speech to text
// (docs/VOICE.md §4d), on the server, fed 16 kHz mono float32 as it arrives.
// Pure, so tests drive it with synthetic audio.
//
// - Speech is energy relative to the room: a 20 ms frame is speech when its
//   RMS is above RATIO × the learnt noise floor, and never below MIN_RMS. The
//   floor follows the frames that are not speech (fast down, slow up), so a
//   fan raises the bar instead of keeping the utterance open.
// - An utterance starts after MIN_SPEECH_S of speech in a row and ends after
//   SILENCE_S of quiet. Under MIN_VOICED_S of voiced audio it is dropped.
// - Past MAX_S it ends at the next short pause (never in the middle of a
//   word), and at HARD_MAX_S whatever is being said.
// - flush() ends it now (push-to-talk let go): what is left is handed over,
//   so a short dictation is never lost waiting for the silence.
// - While someone speaks, the session reads the utterance so far by frame
//   (slice, levels, the quiet at its end) to write it down in pieces.

export const RATE = 16000;
/** Samples in one 20 ms frame. */
export const FRAME = 320;
/** Seconds in one frame. */
export const FRAME_S = FRAME / RATE;

export interface DetectOptions {
  /** Speech is this many times the noise floor… */
  ratio: number;
  /** …and never quieter than this RMS (0–1). */
  minRms: number;
  /** Speech in a row before an utterance starts, in seconds. */
  minSpeechS: number;
  /** Quiet that ends an utterance. */
  silenceS: number;
  /** Past this length the utterance ends at the next pause. */
  maxS: number;
  /** The pause that ends an utterance past maxS. */
  capPauseS: number;
  /** The utterance is cut here whatever is being said. */
  hardMaxS: number;
  /** Less voiced audio than this is not an utterance. */
  minVoicedS: number;
  /** On flush (push-to-talk), this much voiced audio is enough. */
  minFlushVoicedS: number;
  /** Audio kept from just before speech began, so the first word is whole. */
  prerollS: number;
  /** Quiet kept after the last word. */
  tailS: number;
}

export const DETECT_DEFAULTS: DetectOptions = {
  ratio: 2.5,
  minRms: 0.0015,
  minSpeechS: 0.15,
  silenceS: 1.2,
  maxS: 60,
  capPauseS: 0.3,
  hardMaxS: 75,
  minVoicedS: 0.4,
  minFlushVoicedS: 0.15,
  prerollS: 0.3,
  tailS: 0.3,
};

export type DetectEvent =
  /** Speech began. */
  | { type: "start" }
  /** One utterance, whole: its audio, how much of it was voiced, whether the length cap ended it, and its last voiced frame. */
  | { type: "end"; audio: Float32Array; voicedS: number; capped: boolean; lastVoiced: number }
  /** What started was too short to be anything. */
  | { type: "discard" };

/** Root mean square of float32 samples, 0–1. */
export function rmsOf(samples: Float32Array, from = 0, to = samples.length): number {
  const n = to - from;
  if (n <= 0) return 0;
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / n);
}

/** 16-bit little-endian PCM bytes as float32 (-1…1). An odd last byte is dropped. */
export function int16ToFloat32(bytes: Uint8Array): Float32Array {
  const n = bytes.length >> 1;
  const out = new Float32Array(n);
  const v = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  for (let i = 0; i < n; i++) out[i] = v.getInt16(i * 2, true) / 32768;
  return out;
}

export class UtteranceDetector {
  readonly o: DetectOptions;
  /** The learnt noise floor (RMS). */
  floor = 0.0006;
  speaking = false;
  private seen = 0;
  /** Samples not yet a whole frame. */
  private rest = new Float32Array(0);
  /** Recent frames while nobody speaks (the pre-roll, and a start still being confirmed). */
  private recent: Float32Array[] = [];
  private recentLevels: number[] = [];
  private loud = 0;
  /** The utterance's frames, and each one's RMS. */
  private frames: Float32Array[] = [];
  private levels: number[] = [];
  private voiced = 0;
  private quiet = 0;
  /** The utterance's last voiced frame. */
  private lastVoicedAt = -1;

  constructor(o: Partial<DetectOptions> = {}) {
    this.o = { ...DETECT_DEFAULTS, ...o };
  }

  private n(seconds: number): number {
    return Math.max(1, Math.round(seconds / FRAME_S));
  }

  /** The level a frame must pass to be speech now. */
  threshold(): number {
    return Math.max(this.o.minRms, this.floor * this.o.ratio);
  }

  /** Seconds of voiced audio in the utterance being heard. */
  get voicedS(): number {
    return this.voiced * FRAME_S;
  }

  /** Seconds of the utterance being heard, quiet included. */
  get lengthS(): number {
    return this.frames.length * FRAME_S;
  }

  /** Frames in the utterance being heard. Frame 0 is the start of its pre-roll. */
  get frameCount(): number {
    return this.frames.length;
  }

  /** Quiet frames at the end of the utterance being heard (a pause, or the silence that may end it). */
  get quietFrames(): number {
    return this.quiet;
  }

  /** The utterance's last voiced frame; -1 when nobody speaks. */
  get lastVoiced(): number {
    return this.speaking ? this.lastVoicedAt : -1;
  }

  /** Frames from..to of the utterance being heard, as audio; empty when nobody speaks. */
  slice(from: number, to: number = this.frames.length): Float32Array {
    if (!this.speaking) return new Float32Array(0);
    return join(this.frames.slice(from, to));
  }

  /** Voiced frames from `from` on. */
  voicedFrom(from: number): number {
    const t = this.threshold();
    let n = 0;
    for (let i = Math.max(0, from); i < this.levels.length; i++) if (this.levels[i] > t) n++;
    return n;
  }

  /** The middle of the longest pause in frames from..to; with no quiet frame there, the quietest one (most likely a gap between words). */
  gap(from: number, to: number = this.levels.length): number {
    const t = this.threshold();
    const end = Math.min(to, this.levels.length);
    let quietest = Math.max(0, from);
    let best = -1;
    let bestLength = 0;
    for (let i = quietest, run = 0; i < end; i++) {
      if (this.levels[i] < this.levels[quietest]) quietest = i;
      run = this.levels[i] > t ? 0 : run + 1;
      if (run > bestLength) {
        bestLength = run;
        best = i - ((run - 1) >> 1);
      }
    }
    return best >= 0 ? best : quietest;
  }

  /** Audio in; the events it caused, in order. */
  push(samples: Float32Array): DetectEvent[] {
    const out: DetectEvent[] = [];
    let buf = samples;
    if (this.rest.length) {
      buf = new Float32Array(this.rest.length + samples.length);
      buf.set(this.rest);
      buf.set(samples, this.rest.length);
    }
    let at = 0;
    for (; at + FRAME <= buf.length; at += FRAME) {
      const e = this.frame(buf.slice(at, at + FRAME));
      if (e) out.push(e);
    }
    this.rest = buf.slice(at);
    return out;
  }

  private frame(f: Float32Array): DetectEvent | null {
    const level = rmsOf(f);
    if (this.seen < 10) {
      // The first 200 ms only learn the room.
      this.floor = Math.max(0.0002, this.seen++ === 0 ? level : this.floor + (level - this.floor) * 0.4);
      this.keep(f, level);
      return null;
    }
    const isSpeech = level > this.threshold();
    if (!this.speaking) {
      this.keep(f, level);
      if (!isSpeech) {
        this.loud = 0;
        this.floor = Math.max(0.0002, this.floor + (level - this.floor) * (level < this.floor ? 0.2 : 0.02));
        return null;
      }
      if (++this.loud < this.n(this.o.minSpeechS)) return null;
      this.speaking = true;
      this.frames = this.recent;
      this.levels = this.recentLevels;
      this.recent = [];
      this.recentLevels = [];
      this.lastVoicedAt = this.frames.length - 1;
      this.voiced = this.loud;
      this.loud = 0;
      this.quiet = 0;
      return { type: "start" };
    }
    this.frames.push(f);
    this.levels.push(level);
    if (isSpeech) {
      this.voiced++;
      this.lastVoicedAt = this.frames.length - 1;
      this.quiet = 0;
    } else this.quiet++;
    const long = this.lengthS >= this.o.maxS;
    if (this.quiet >= this.n(this.o.silenceS)) return this.finish(false, this.o.minVoicedS);
    if (long && this.quiet >= this.n(this.o.capPauseS)) return this.finish(true, this.o.minVoicedS);
    if (this.lengthS >= this.o.hardMaxS) return this.finish(true, this.o.minVoicedS);
    return null;
  }

  /** Frames kept while nobody speaks: the pre-roll, plus the loud run that may become a start. */
  private keep(f: Float32Array, level: number): void {
    this.recent.push(f);
    this.recentLevels.push(level);
    const max = this.n(this.o.prerollS) + this.n(this.o.minSpeechS);
    if (this.recent.length > max) {
      this.recent.shift();
      this.recentLevels.shift();
    }
  }

  private finish(capped: boolean, minVoicedS: number): DetectEvent {
    // Drop the quiet at the end, but for a little of it.
    const drop = Math.max(0, this.quiet - this.n(this.o.tailS));
    const frames = drop ? this.frames.slice(0, this.frames.length - drop) : this.frames;
    const voicedS = this.voicedS;
    const lastVoiced = this.lastVoicedAt;
    this.speaking = false;
    this.frames = [];
    this.levels = [];
    this.voiced = 0;
    this.quiet = 0;
    this.loud = 0;
    this.lastVoicedAt = -1;
    return voicedS < minVoicedS ? { type: "discard" } : { type: "end", audio: join(frames), voicedS, capped, lastVoiced };
  }

  /** End the utterance now (push-to-talk let go, or Stop): what was being said, or null when nothing was. */
  flush(): DetectEvent | null {
    const speaking = this.speaking;
    let e: DetectEvent | null = null;
    if (speaking) {
      // The last part-frame belongs to it too.
      if (this.rest.length) this.frames.push(this.rest);
      e = this.finish(false, this.o.minFlushVoicedS);
    }
    this.rest = new Float32Array(0);
    this.recent = [];
    this.recentLevels = [];
    this.loud = 0;
    return e;
  }

  /** Forget everything being heard (muted, or the talk closed). The learnt floor stays. */
  reset(): void {
    this.speaking = false;
    this.frames = [];
    this.levels = [];
    this.recent = [];
    this.recentLevels = [];
    this.rest = new Float32Array(0);
    this.voiced = 0;
    this.quiet = 0;
    this.loud = 0;
    this.lastVoicedAt = -1;
  }
}

function join(frames: Float32Array[]): Float32Array {
  const out = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
  let at = 0;
  for (const f of frames) {
    out.set(f, at);
    at += f.length;
  }
  return out;
}
