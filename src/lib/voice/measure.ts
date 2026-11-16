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

type Word = { from: number; to: number; weight: number; stop: boolean; clause: boolean };

const SEPARATOR = /^[._/\\:@#]+$/;

/**
 * How long a word takes to say, in rough syllables, the way a voice says it rather than how it is spelled: the
 * vowel sounds of each part (camelCase and snake_case split), a code name's dots, slashes and colons said aloud
 * ("main.rs" is "main dot r s"), a part with no vowel spelled out letter by letter ("rs", "SQL"), a digit a syllable
 * each. Letters count a little too, so a long word outlasts a short one of the same syllables. At least 1.
 */
export function spokenWeight(word: string): number {
  const core = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (!core) return 0.5;
  let syllables = 0;
  for (const part of core.split(/([._/\\:@#]+)/)) {
    if (!part) continue;
    if (SEPARATOR.test(part)) {
      syllables += part.length;
      continue;
    }
    for (const piece of part.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+|[\p{L}]+/gu) ?? [part]) {
      if (/^\d+$/.test(piece)) {
        syllables += piece.length;
        continue;
      }
      const vowels = (piece.toLowerCase().match(/[aeiouy]+/g) ?? []).length;
      if (!vowels || piece === piece.toUpperCase() && piece.length > 1 && piece.length <= 4) syllables += piece.length;
      else syllables += Math.max(1, vowels - (/[^aeiouy]e$/i.test(piece) && vowels > 1 ? 1 : 0));
    }
  }
  const letters = (core.match(/[\p{L}\p{N}]/gu) ?? []).length;
  return Math.max(1, syllables + letters * 0.12);
}

/** The words of a text, each with how long it takes to say (spokenWeight) and whether a sentence ends on it. */
function weighed(text: string): Word[] {
  return [...text.matchAll(/\S+/g)].map((m) => {
    const w = m[0];
    return { from: m.index ?? 0, to: (m.index ?? 0) + w.length, weight: spokenWeight(w), stop: /[.!?…]+["'”’)\]]*$/.test(w), clause: CLAUSE_END.test(w) };
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
  const whole = byClauses(words, runs);
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
  return fits ? groups.flatMap((g, i) => byClauses(g, parts[i])) : whole;
}

/** A word a voice may pause after inside a sentence: a comma, semicolon, colon or dash. */
const CLAUSE_END = /[,;:—–]["'”’)\]]*$/;
/** How far (seconds) a clause's laid end may be from a pause for the pause to be taken as that clause's end. */
const CLAUSE_REACH = 1.2;

/**
 * Words laid over their runs of sound, with each comma (or semicolon, colon, dash) that the voice paused at matched
 * to that pause: a voice pauses at some commas and not others, and the words after a paused comma start when the sound
 * starts again, not before. A comma is matched to the nearest pause of at least SENTENCE_PAUSE within CLAUSE_REACH of
 * where it was laid, in order; a match that would make a clause far faster or slower than the rest is not believed.
 */
function byClauses(words: readonly Word[], runs: readonly Run[]): SpokenWord[] {
  const laid = lay(words, runs);
  if (laid.length < 2 || runs.length < 2) return laid;
  const gaps = runs.slice(1).map((r, i) => ({ after: i, start: runs[i].end, len: r.start - runs[i].end })).filter((g) => g.len >= SENTENCE_PAUSE);
  const cuts: { word: number; gap: number }[] = [];
  let next = 0;
  words.forEach((w, i) => {
    if (i === words.length - 1 || !w.clause) return;
    const at = laid[i].end;
    let best = -1;
    for (let g = next; g < gaps.length; g++) {
      const d = Math.abs(gaps[g].start - at);
      if (d <= CLAUSE_REACH && (best < 0 || d < Math.abs(gaps[best].start - at))) best = g;
    }
    if (best >= 0) {
      cuts.push({ word: i, gap: gaps[best].after });
      next = best + 1;
    }
  });
  if (!cuts.length) return laid;
  const groups: Word[][] = [];
  const parts: Run[][] = [];
  let w0 = 0;
  let r0 = 0;
  for (const c of cuts) {
    groups.push(words.slice(w0, c.word + 1));
    parts.push(runs.slice(r0, c.gap + 1));
    w0 = c.word + 1;
    r0 = c.gap + 1;
  }
  groups.push(words.slice(w0));
  parts.push(runs.slice(r0));
  const pace = words.reduce((s, w) => s + w.weight, 0) / sounding(runs);
  const fits = groups.every((g, i) => {
    const p = g.reduce((s, w) => s + w.weight, 0) / (sounding(parts[i]) || 1e-9);
    return g.length && parts[i].length && p > pace * 0.5 && p < pace * 2;
  });
  return fits ? groups.flatMap((g, i) => lay(g, parts[i])) : laid;
}

/**
 * How a voice speaks, for lighting words before a line's audio has been measured (the first moments of a streamed
 * line): seconds per unit of spokenWeight, the pause it takes at a comma or full stop, and the silence before its first
 * word. `perUnit` covers the pauses a voice takes where the text has no punctuation (after a code name, a breath), so a
 * line reckoned with it lasts as long as the voice takes to say it, not only as long as it is sounding.
 */
export interface Pace {
  perUnit: number;
  pause: number;
  lead: number;
}

/**
 * Deepgram Aura-2 (Draco) at speed 1, measured on a lesson line against Deepgram's own word times (15 Nov 2026): the
 * line took 12.2 s, 0.17 s of it before the first word, with two punctuated pauses of about 0.5 s; 53.4 units of words.
 */
export const DEFAULT_PACE: Pace = { perUnit: 0.206, pause: 0.5, lead: 0.17 };

/** How many pauses a reckoning takes in this text: one after each word that ends a sentence or a clause. */
const punctuated = (words: readonly Word[]) => words.filter((w, i) => i < words.length - 1 && (w.stop || w.clause)).length;

/** What each line measured so far says about the voice, by speed: the settings change the speed, and with it the pace. */
const learned = new Map<number, Pace>();

/**
 * The pace to reckon with at this speed: learned from the lines measured at it, else the default stretched the way
 * Deepgram stretches speech. It does not slow in proportion: speed 0.7 made a line 1.28 times as long, not 1.43.
 */
export function voicePace(speed = 1): Pace {
  const s = speed > 0 ? speed : 1;
  const known = learned.get(Math.round(s * 100));
  if (known) return known;
  const m = Math.pow(s, -0.7);
  return { perUnit: DEFAULT_PACE.perUnit * m, pause: DEFAULT_PACE.pause * m, lead: DEFAULT_PACE.lead };
}

/** Learn the voice's pace from one measured line (a blend with what is known, so one odd line does not swing it). */
export function learnPace(text: string, runs: readonly Run[], speed = 1): void {
  const words = weighed(text);
  const sound = sounding(runs);
  const weight = words.reduce((s, w) => s + w.weight, 0);
  if (!(sound > 0.5) || !(weight > 3)) return;
  const pauses = runs
    .slice(1)
    .map((r, i) => r.start - runs[i].end)
    .filter((g) => g >= SENTENCE_PAUSE)
    .sort((a, b) => a - b);
  const pause = pauses.length ? pauses[Math.floor(pauses.length / 2)] : DEFAULT_PACE.pause;
  const lead = Math.min(0.6, runs[0].start);
  // The whole line, first word to last, less the pauses the reckoning takes at punctuation: the rest is the words'.
  const spoken = runs[runs.length - 1].end - runs[0].start - pause * Math.min(punctuated(words), pauses.length);
  const now: Pace = { perUnit: Math.max(sound, spoken) / weight, pause, lead };
  const key = Math.round((speed > 0 ? speed : 1) * 100);
  const was = learned.get(key);
  learned.set(key, was ? { perUnit: was.perUnit * 0.6 + now.perUnit * 0.4, pause: was.pause * 0.6 + now.pause * 0.4, lead: was.lead * 0.6 + now.lead * 0.4 } : now);
}

/** For tests: forget every learned pace. */
export function forgetPaces(): void {
  learned.clear();
}

/**
 * The measurement's version, kept with each measured narration: audio kept from an older measurement is measured again
 * (from the audio already here, nothing fetched). 2: words weighed as they are said, commas matched to pauses
 * (15 Nov 2026; version 1 lit words up to 1.4 s early).
 */
export const MEASURE_VERSION = 2;

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
export async function measureWords(text: string, bytes: Uint8Array, speed = 1): Promise<SpokenWord[]> {
  try {
    const Ctx = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
    if (!Ctx || !bytes.byteLength) return [];
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const decoded = await Promise.race([new Ctx(1, 1, RATE).decodeAudioData(copy), new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
    if (!decoded) return [];
    const runs = voicedRuns(loudness(decoded.getChannelData(0), decoded.sampleRate, STEP), STEP);
    // Every measured line teaches the clock this voice's pace, for the first moments of the next line.
    learnPace(text, runs, speed);
    return measuredWords(text, runs);
  } catch {
    return [];
  }
}
