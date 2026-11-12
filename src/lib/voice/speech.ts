// Text for the ear. Sentence splitting (Aura-2 takes at most 2,000 characters
// a request, and some browsers stop reading a long utterance halfway), an
// answer's chalk markup turned into something a voice can read, and
// ElevenLabs' per-character timings grouped into words for highlighting.
// Pure, so tests can check every case.

/** A sentence's place in the original text: [from, to), whitespace around it excluded. */
export interface Span {
  from: number;
  to: number;
}

// A sentence ends at . ! ? or … (and any closing quotes or brackets) followed by
// whitespace, or at a blank line. "app.ts", "3.5" and "e.g.x" do not end one.
const SENTENCE = /[^\s][\s\S]*?(?:[.!?…]+["'”’)\]]*(?=\s|$)|(?=\n\s*\n)|$)/g;

/** Where each sentence sits in the text, in order. */
export function sentenceSpans(text: string): Span[] {
  const out: Span[] = [];
  SENTENCE.lastIndex = 0;
  for (let m = SENTENCE.exec(text); m; m = SENTENCE.exec(text)) {
    if (!m[0]) {
      SENTENCE.lastIndex++;
      continue;
    }
    const from = m.index;
    const to = from + m[0].trimEnd().length;
    if (to > from) out.push({ from, to });
  }
  return out;
}

/** The sentences, each with its own punctuation and its inner whitespace folded to single spaces. */
export function sentences(text: string): string[] {
  return sentenceSpans(text).map((s) => text.slice(s.from, s.to).replace(/\s+/g, " "));
}

/** Join pieces with single spaces into runs of at most `max` characters, in order. */
function pack(pieces: string[], max: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const p of pieces) {
    if (!p) continue;
    if (!cur) cur = p;
    else if (cur.length + 1 + p.length <= max) cur += ` ${p}`;
    else {
      out.push(cur);
      cur = p;
    }
  }
  if (cur) out.push(cur);
  return out;
}

const hardCut = (w: string, max: number) => Array.from({ length: Math.ceil(w.length / max) }, (_, i) => w.slice(i * max, (i + 1) * max));
const byWords = (c: string, max: number) => pack(c.split(" ").flatMap((w) => (w.length <= max ? [w] : hardCut(w, max))), max);
const byClauses = (s: string, max: number) => pack(s.split(/(?<=[,;:—–])\s+/).flatMap((c) => (c.length <= max ? [c] : byWords(c, max))), max);

/**
 * Pieces of at most `max` characters for a narrator with a request limit:
 * whole sentences where they fit, then clauses, then words; only a single
 * word longer than `max` is cut. Nothing is dropped and the order is kept.
 */
export function splitForSpeech(text: string, max = 2000): string[] {
  if (max < 1) throw new RangeError("max must be at least 1");
  return pack(sentences(text).flatMap((s) => (s.length <= max ? [s] : byClauses(s, max))), max);
}

// The citations the guide writes (Guide.tsx): path:line or path:start-end, maybe in backticks.
const CITE = /`?((?:[\w.-]+\/)*([\w.-]+\.(?:tsx?|jsx?|py|sql|prisma|mjs|cjs|mts|dart|go|rs|java|kt|rb|php|cs)))(?::(\d+)(?:\s*[-–]\s*(\d+))?)?`?/g;

/**
 * An answer in the guide's chalk markup, made readable aloud: list markers
 * and **bold** and `code` marks dropped, each line or item ending in a stop
 * so the voice pauses, and citations said the way a person would ("cart.ts,
 * lines 12 to 20" rather than the whole path and a colon).
 */
export function speakable(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) =>
      block
        .split("\n")
        .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
        .filter(Boolean)
        .map((l) => (/[.!?:;…]["'”’)\]`*]*$/.test(l) ? l : `${l}.`))
        .join(" "),
    )
    .join(" ")
    .replace(CITE, (_m, _path: string, base: string, a?: string, b?: string) => (a ? `${base}, line${b ? `s ${a} to ${b}` : ` ${a}`}` : base))
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** ElevenLabs' character timings for one streamed chunk (stream/with-timestamps). */
export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** A spoken word: where it is in the text, and when it is heard (seconds from the start). */
export interface SpokenWord extends Span {
  start: number;
  end: number;
}

/**
 * The chunks' characters on one clock. ElevenLabs' docs do not say whether a
 * chunk's times run on from the last chunk or start again at its own audio, so
 * both are handled: a chunk whose first character starts before the previous
 * one ended is moved to follow it.
 */
export function alignChars(chunks: readonly (Alignment | null | undefined)[]): { ch: string; start: number; end: number }[] {
  const out: { ch: string; start: number; end: number }[] = [];
  let base = 0;
  let lastEnd = 0;
  for (const a of chunks) {
    const chars = a?.characters;
    if (!a || !chars?.length) continue;
    const s0 = Number(a.character_start_times_seconds?.[0] ?? 0);
    if (out.length && s0 + base < lastEnd - 0.05) base = lastEnd;
    for (let i = 0; i < chars.length; i++) {
      const start = Number(a.character_start_times_seconds?.[i] ?? 0) + base;
      const end = Math.max(start, Number(a.character_end_times_seconds?.[i] ?? 0) + base);
      out.push({ ch: chars[i], start, end });
      lastEnd = Math.max(lastEnd, end);
    }
  }
  return out;
}

/**
 * Words with their times, placed in `text` (the text that was sent). Words are
 * runs of non-space characters; each is looked for in the text after the
 * previous one, so a word the service normalised away is skipped rather than
 * shifting every word after it.
 */
export function wordTimings(text: string, chunks: readonly (Alignment | null | undefined)[]): SpokenWord[] {
  const chars = alignChars(chunks);
  const words: SpokenWord[] = [];
  let cursor = 0;
  let i = 0;
  while (i < chars.length) {
    while (i < chars.length && /\s/.test(chars[i].ch)) i++;
    if (i >= chars.length) break;
    let j = i;
    let w = "";
    while (j < chars.length && !/\s/.test(chars[j].ch)) w += chars[j++].ch;
    const at = text.indexOf(w, cursor);
    if (at >= 0) {
      words.push({ from: at, to: at + w.length, start: chars[i].start, end: chars[j - 1].end });
      cursor = at + w.length;
    }
    i = j;
  }
  return words;
}

/** The index of the word being heard at `t` seconds: the last one to have started; -1 before the first. */
export function wordAt(words: readonly SpokenWord[], t: number): number {
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
  return best;
}

/** The word around a character offset (the browser's boundary events give only where a word starts). */
export function wordSpanAt(text: string, at: number): Span | null {
  if (at < 0 || at >= text.length) return null;
  let from = at;
  while (from > 0 && !/\s/.test(text[from - 1])) from--;
  let to = at;
  while (to < text.length && !/\s/.test(text[to])) to++;
  return to > from ? { from, to } : null;
}
