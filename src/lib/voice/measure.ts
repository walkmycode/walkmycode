// Word timings for a narrator that sends none (Deepgram): measured from the
// recording itself. The audio is decoded, the stretches where there is sound
// are found, and the words are laid over those stretches by their length, so
// no word is placed in a silence: not before the voice begins, not in the
// pause after a sentence, not after the last word. Where the long pauses
// match the text's sentence ends, every sentence starts exactly where its
// sound starts. Inside a sentence a word's place is still an estimate, good
// to about a word. The pure parts are tested in tests/voice.measure.test.ts.
import type { SpokenWord } from "./speech";

/** A stretch of sound in a recording, in seconds. */
export interface Run {
  start: number;
  end: number;
}

/** Shorter gaps than this are part of speech (the stop in "cat", a breath between words). */
const JOIN = 0.14;
/** Shorter bursts than this are clicks, not speech. */
const BLIP = 0.04;
/** A pause at least this long can be the end of a sentence. */
const SENTENCE_PAUSE = 0.2;

/** Where there is sound, from the recording's loudness measured every `step` seconds. */
export function voicedRuns(levels: ArrayLike<number>, step: number): Run[] {
  const n = levels.length;
  if (!n || step <= 0) return [];
  const sorted = Array.from(levels).sort((a, b) => a - b);
  const loud = sorted[Math.min(n - 1, Math.floor(n * 0.95))];
  if (!(loud > 0)) return [];
  const floor = loud * 0.07;
  const raw: Run[] = [];
  let from = -1;
  for (let i = 0; i <= n; i++) {
    const on = i < n && levels[i] > floor;
    if (on && from < 0) from = i;
    else if (!on && from >= 0) {
      raw.push({ start: from * step, end: i * step });
      from = -1;
    }
  }
  const joined: Run[] = [];
  for (const r of raw) {
    const last = joined.at(-1);
    if (last && r.start - last.end < JOIN) last.end = r.end;
    else joined.push({ ...r });
  }
  return joined.filter((r) => r.end - r.start >= BLIP);
}

type Word = { from: number; to: number; weight: number; stop: boolean };

/** The words of a text, each with how long it takes to say (its letters; a digit counts for more) and whether a sentence ends on it. */
function weighed(text: string): Word[] {
  return [...text.matchAll(/\S+/g)].map((m) => {
    const w = m[0];
    const letters = (w.match(/[\p{L}]/gu) ?? []).length + (w.match(/\d/g) ?? []).length * 3;
    return { from: m.index ?? 0, to: (m.index ?? 0) + w.length, weight: letters + 1, stop: /[.!?…]+["'”’)\]]*$/.test(w) };
  });
}

const sounding = (runs: readonly Run[]) => runs.reduce((s, r) => s + (r.end - r.start), 0);

/** Lay words over runs of sound by their weights. */
function lay(words: readonly Word[], runs: readonly Run[]): SpokenWord[] {
  const total = sounding(runs);
  const weight = words.reduce((s, w) => s + w.weight, 0);
  if (!words.length || !(total > 0) || !weight) return [];
  // The moment `sound` seconds of sound have gone by. A word starts where sound resumes, and ends where it stops.
  const at = (sound: number, ending: boolean): number => {
    let gone = 0;
    for (const r of runs) {
      const len = r.end - r.start;
      if (ending ? sound <= gone + len + 1e-9 : sound < gone + len - 1e-9) return r.start + Math.max(0, sound - gone);
      gone += len;
    }
    return runs[runs.length - 1].end;
  };
  const out: SpokenWord[] = [];
  let before = 0;
  for (const w of words) {
    const a = (before / weight) * total;
    before += w.weight;
    const b = (before / weight) * total;
    const start = at(a, false);
    out.push({ from: w.from, to: w.to, start, end: Math.max(start, at(b, true)) });
  }
  return out;
}

/**
 * When each word of `text` is heard in a recording with these runs of sound.
 * Empty when there is no sound to go by.
 */
export function measuredWords(text: string, runs: readonly Run[]): SpokenWord[] {
  const words = weighed(text);
  if (!words.length || !runs.length) return [];
  // Sentences: the words up to each one that ends in a stop.
  const groups: Word[][] = [];
  let cur: Word[] = [];
  for (const w of words) {
    cur.push(w);
    if (w.stop) {
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length) groups.push(cur);
  const whole = lay(words, runs);
  if (groups.length < 2) return whole;
  // The longest pauses, one for each sentence end, if they are long enough to be sentence ends.
  const gaps = runs.slice(1).map((r, i) => ({ after: i, len: r.start - runs[i].end }));
  const cuts = [...gaps].sort((a, b) => b.len - a.len).slice(0, groups.length - 1);
  if (cuts.length < groups.length - 1 || cuts.some((g) => g.len < SENTENCE_PAUSE)) return whole;
  const ends = cuts.map((g) => g.after).sort((a, b) => a - b);
  const parts = groups.map((_, i) => runs.slice(i ? ends[i - 1] + 1 : 0, i < ends.length ? ends[i] + 1 : runs.length));
  // Believed only if every sentence is then said at about the pace of the whole: else the pauses are not the sentence ends.
  const pace = words.reduce((s, w) => s + w.weight, 0) / sounding(runs);
  const fits = groups.every((g, i) => {
    const p = g.reduce((s, w) => s + w.weight, 0) / (sounding(parts[i]) || 1e-9);
    return p > pace * 0.6 && p < pace * 1.6;
  });
  return fits ? groups.flatMap((g, i) => lay(g, parts[i])) : whole;
}

/** After a word's sound has ended, it stays lit this long (seconds) before nothing is lit. */
export const LINGER = 0.1;

/** The word being heard at `t` seconds, or -1 when none is: before the first, in a pause, after the last. */
export function wordHeardAt(words: readonly SpokenWord[], t: number): number {
  let lo = 0;
  let hi = words.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].start <= t) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best >= 0 && t > words[best].end + LINGER ? -1 : best;
}

/** How loud a decoded recording is every `step` seconds (root mean square of each slice). */
export function loudness(samples: Float32Array, rate: number, step: number): Float32Array {
  const size = Math.max(1, Math.round(rate * step));
  const out = new Float32Array(Math.floor(samples.length / size));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let j = i * size; j < (i + 1) * size; j++) sum += samples[j] * samples[j];
    out[i] = Math.sqrt(sum / size);
  }
  return out;
}

const STEP = 0.01;
const RATE = 16000;

/**
 * The words of `text` timed against its audio, in the browser: decoded apart from what is played.
 * Empty where the browser cannot decode it, or takes too long: the reading goes on without lit words.
 */
export async function measureWords(text: string, bytes: Uint8Array): Promise<SpokenWord[]> {
  try {
    const Ctx = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
    if (!Ctx || !bytes.byteLength) return [];
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const decoded = await Promise.race([new Ctx(1, 1, RATE).decodeAudioData(copy), new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
    if (!decoded) return [];
    return measuredWords(text, voicedRuns(loudness(decoded.getChannelData(0), decoded.sampleRate, STEP), STEP));
  } catch {
    return [];
  }
}
