"use client";
/**
 * The professor's face: what it is doing, and the
 * shape of its mouth while it speaks.
 *
 * The mouth follows the voice that is actually playing. ElevenLabs and
 * Deepgram play through the app's one shared <audio>; a copy of that sound is
 * measured here (captureStream into an analyser), which never touches what is
 * heard. How loud it is opens the jaw; where its energy sits (low, middle,
 * high) blends seven mouth shapes, so an "oo" looks round and an "ee" wide.
 * The browser's own voice gives a page no sound to measure, and neither does a
 * browser without captureStream: then the mouth keeps a speaking rhythm through
 * the same shapes. Nothing here runs unless a face is on screen.
 */
import { sharedAudio } from "@/lib/voice/view";

export type FaceState = "idle" | "speaking" | "thinking" | "listening" | "pleased";

/** What the face shows: listening to the student comes first, then its own voice, then thinking, then a smile. */
export function faceState(o: { listening?: boolean; speaking?: boolean; thinking?: boolean; pleased?: boolean }): FaceState {
  return o.listening ? "listening" : o.speaking ? "speaking" : o.thinking ? "thinking" : o.pleased ? "pleased" : "idle";
}

/** A mouth: how wide, how far open, how round (0 flat to 1 round), how much the corners lift. In the face's own units. */
export type Mouth = { w: number; o: number; r: number; s: number };

/** The mouth shapes speech is made of here, and the two the face rests in. */
export const VISEMES = {
  rest: { w: 15, o: 0, r: 0, s: 0.35 },
  mm: { w: 12, o: 0, r: 0, s: 0 },
  f: { w: 14, o: 2.2, r: 0, s: 0 },
  ee: { w: 21, o: 4.5, r: 0, s: 0.25 },
  ah: { w: 17, o: 14, r: 0.3, s: 0 },
  oh: { w: 11, o: 11, r: 1, s: 0 },
  oo: { w: 7, o: 6, r: 1, s: 0 },
  smile: { w: 22, o: 0, r: 0, s: 1 },
} as const satisfies Record<string, Mouth>;
export type Viseme = keyof typeof VISEMES;

const clamp = (v: number) => Math.max(0, Math.min(1, v));
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** A moment of sound: how loud (0 to 1), and how its energy divides between low, middle and high pitches. */
export type Sound = { level: number; low: number; mid: number; high: number };

/** How much of each mouth shape a moment of sound calls for. The weights add up to 1. */
export function visemeWeights(sound: Sound): Record<Viseme, number> {
  const out: Record<Viseme, number> = { rest: 0, mm: 0, f: 0, ee: 0, ah: 0, oh: 0, oo: 0, smile: 0 };
  const level = clamp(sound.level);
  if (level < 0.04) {
    out.rest = 1;
    return out;
  }
  const total = sound.low + sound.mid + sound.high || 1;
  const hiss = clamp((sound.high / total - 0.3) * 2.4); // s, sh, ee: energy up high
  const round = clamp((sound.low / total - 0.45) * 2.6); // oo, oh: energy down low
  const open = clamp(1 - hiss - round);
  out.f = hiss * (1 - level) * 0.6;
  out.ee = hiss * (0.4 + 0.6 * level);
  out.oo = round * (1 - level);
  out.oh = round * level;
  out.ah = open * level;
  out.mm = open * (1 - level) * 0.5;
  const sum = Object.values(out).reduce((a, b) => a + b, 0) || 1;
  for (const k of Object.keys(out) as Viseme[]) out[k] /= sum;
  return out;
}

/** The mouth for a moment of sound: its shapes blended, and opened further the louder it is. */
export function mouthFor(sound: Sound): Mouth {
  const weights = visemeWeights(sound);
  const m: Mouth = { w: 0, o: 0, r: 0, s: 0 };
  for (const k of Object.keys(weights) as Viseme[]) {
    const v = VISEMES[k];
    m.w += v.w * weights[k];
    m.o += v.o * weights[k];
    m.r += v.r * weights[k];
    m.s += v.s * weights[k];
  }
  m.o *= 0.55 + 0.6 * clamp(sound.level);
  return m;
}

/** The next mouth from the last one, a frame on: quick to open, slower to close, like a jaw. */
export function easeMouth(prev: Mouth, next: Mouth): Mouth {
  const t = next.o > prev.o ? 0.45 : 0.28;
  return { w: mix(prev.w, next.w, t), o: mix(prev.o, next.o, t), r: mix(prev.r, next.r, t), s: mix(prev.s, next.s, t) };
}

/** How loud a moment of sound is, 0 (silence) to 1, from an analyser's wave bytes (128 is the middle). */
export function levelFrom(wave: ArrayLike<number>): number {
  if (!wave.length) return 0;
  let sum = 0;
  for (let i = 0; i < wave.length; i++) {
    const v = (wave[i] - 128) / 128;
    sum += v * v;
  }
  // Speech sits around 0.05 to 0.25 RMS: stretch that over the mouth's range.
  return clamp((Math.sqrt(sum / wave.length) - 0.015) * 5);
}

/** The energy below 550 Hz, from there to 2 kHz, and from 3 to 8 kHz, from an analyser's frequency bytes. */
export function bandsFrom(spectrum: ArrayLike<number>, sampleRate: number): { low: number; mid: number; high: number } {
  const hz = sampleRate / 2 / (spectrum.length || 1);
  const band = (from: number, to: number) => {
    let sum = 0;
    let n = 0;
    for (let i = Math.max(1, Math.floor(from / hz)); i < Math.min(spectrum.length, Math.ceil(to / hz)); i++) {
      sum += spectrum[i];
      n++;
    }
    return n ? sum / n / 255 : 0;
  };
  return { low: band(120, 550), mid: band(550, 2000), high: band(3000, 8000) };
}

/** A speaking rhythm for a voice that cannot be measured: syllables at about five a second, never quite regular. */
export function rhythm(ms: number): number {
  const t = ms / 1000;
  const syllable = Math.abs(Math.sin(t * Math.PI * 5.2));
  const phrase = 0.65 + 0.35 * Math.sin(t * 2.1 + 1);
  const pause = Math.sin(t * 0.9) > 0.93 ? 0.15 : 1;
  return clamp(syllable * phrase * pause);
}

/** The sound to draw for an unmeasured voice: the rhythm's loudness, with its pitch wandering so the shapes vary. */
export function imagined(ms: number): Sound {
  const t = ms / 1000;
  return { level: rhythm(ms), low: 0.5 + 0.5 * Math.sin(t * 3.1), mid: 0.6, high: 0.5 + 0.5 * Math.sin(t * 4.7 + 2) };
}

// ── measuring the voice that is playing ──

type Tap = { ctx: AudioContext; analyser: AnalyserNode; wave: Uint8Array<ArrayBuffer>; spectrum: Uint8Array<ArrayBuffer>; track: string; source: MediaStreamAudioSourceNode | null };
let tap: Tap | null = null;
let cannot = false;

type Capturing = HTMLAudioElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream };

/** Listen in on the shared audio, again whenever it starts a new sound. False where the browser has no way to. */
function listenIn(): boolean {
  if (cannot) return false;
  try {
    const audio = sharedAudio() as Capturing;
    const capture = audio.captureStream ?? audio.mozCaptureStream;
    if (!capture || typeof AudioContext === "undefined") throw new Error("no capture");
    const track = capture.call(audio).getAudioTracks()[0];
    if (!track) return false; // nothing playing yet
    if (!tap) {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.5;
      tap = { ctx, analyser, wave: new Uint8Array(analyser.fftSize), spectrum: new Uint8Array(analyser.frequencyBinCount), track: "", source: null };
    }
    if (tap.track !== track.id) {
      tap.source?.disconnect();
      tap.source = tap.ctx.createMediaStreamSource(new MediaStream([track]));
      tap.source.connect(tap.analyser); // measured only: never connected to the speakers
      tap.track = track.id;
    }
    if (tap.ctx.state === "suspended") void tap.ctx.resume().catch(() => {});
    return true;
  } catch {
    cannot = true;
    return false;
  }
}

let quietSince = 0;
let lookedAt = 0;

/** The sound to draw right now, while the professor is speaking: measured when it can be, imagined when it cannot. */
export function soundNow(now: number): Sound {
  // Look for the playing sound a few times a second, not on every frame.
  if (now - lookedAt > 250) {
    lookedAt = now;
    listenIn();
  }
  if (tap && tap.ctx.state === "running" && !sharedAudio().paused) {
    tap.analyser.getByteTimeDomainData(tap.wave);
    const level = levelFrom(tap.wave);
    if (level > 0.02) {
      quietSince = now;
      tap.analyser.getByteFrequencyData(tap.spectrum);
      return { level, ...bandsFrom(tap.spectrum, tap.ctx.sampleRate) };
    }
  }
  // Nothing to measure for a while (the browser's own voice, or no way to listen in): keep a speaking rhythm.
  return now - quietSince > 400 ? imagined(now) : { level: 0, low: 0, mid: 0, high: 0 };
}

// ── shown or not (Settings → Voice), in this browser ──

export const FACE_KEY = "walkmycode.professorFace";
const subs = new Set<() => void>();

export function faceOn(): boolean {
  try {
    return localStorage.getItem(FACE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setFaceOn(on: boolean): void {
  try {
    if (on) localStorage.removeItem(FACE_KEY);
    else localStorage.setItem(FACE_KEY, "off");
  } catch {
    /* not remembered */
  }
  subs.forEach((f) => f());
}

/** How large the professor is drawn beside the board. */
export type FaceSize = "small" | "medium" | "large";
export const FACE_SIZES: { id: FaceSize; label: string }[] = [
  { id: "small", label: "Small" },
  { id: "medium", label: "Medium" },
  { id: "large", label: "Large" },
];
export const FACE_SIZE_KEY = "walkmycode.professorFaceSize";

/** A saved size, cleaned: anything unknown is medium. */
export const parseFaceSize = (v: string | null | undefined): FaceSize => (v === "small" || v === "large" ? v : "medium");

export function faceSize(): FaceSize {
  try {
    return parseFaceSize(localStorage.getItem(FACE_SIZE_KEY));
  } catch {
    return "medium";
  }
}

export function setFaceSize(size: FaceSize): void {
  try {
    localStorage.setItem(FACE_SIZE_KEY, size);
  } catch {
    /* not remembered */
  }
  subs.forEach((f) => f());
}

/** The next size down (-1) or up (1), stopping at the smallest and the largest. */
export function stepFaceSize(size: FaceSize, by: -1 | 1): FaceSize {
  const at = FACE_SIZES.findIndex((s) => s.id === size);
  return FACE_SIZES[Math.max(0, Math.min(FACE_SIZES.length - 1, at + by))].id;
}

export function subscribeFace(f: () => void): () => void {
  subs.add(f);
  const onStorage = (e: StorageEvent) => (e.key === FACE_KEY || e.key === FACE_SIZE_KEY) && f();
  window.addEventListener("storage", onStorage);
  return () => {
    subs.delete(f);
    window.removeEventListener("storage", onStorage);
  };
}
