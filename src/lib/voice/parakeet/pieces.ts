// Writing an utterance down in pieces while it is still being said (docs/VOICE.md
// §4d). Pure: the session asks cutAt() as audio arrives, and stitches the
// pieces' words together.
//
// Parakeet writes down about four seconds of speech a second on an ordinary
// laptop, so one long utterance written down whole after it ends keeps the
// user waiting, and a live preview of all of it soon falls behind. Instead the
// utterance is cut at the speaker's pauses and each piece is written down as
// soon as it is cut, while they go on talking:
// - a piece is cut once it is at least MIN_S long and the speaker pauses for
//   PAUSE_S (a breath, a comma), so the piece ends between words;
// - with no such pause by MAX_S, it is cut in the longest pause it has after
//   its first FORCED_MIN_S (a shorter breath, or one that came too early),
//   or else at its quietest frame, most likely a gap between words;
// - when the utterance ends, only what follows the last cut is left to write
//   down; usually that piece was cut at the start of the final silence and is
//   already done.
// Each piece is decoded on its own: the words are the same as decoding the
// whole, and a seam's comma may come back as a full stop. stitch() mends the
// seams the model itself marks as a continuation: a piece it began in lower
// case, or a sentence it left open.
import { FRAME_S } from "./detect";

export interface PieceOptions {
  /** The pause that ends a piece, in seconds. */
  pauseS: number;
  /** A piece is never cut shorter than this. */
  minS: number;
  /** With no pause, a piece is cut by this length… */
  maxS: number;
  /** …in its longest pause after this much of it. */
  forcedMinS: number;
  /** A piece with less voice than this is not worth writing down yet. */
  minVoicedS: number;
}

export const PIECE_DEFAULTS: PieceOptions = { pauseS: 0.3, minS: 1.5, maxS: 5, forcedMinS: 1, minVoicedS: 0.4 };

/** What cutAt() needs of the utterance being heard (the detector). */
export interface Heard {
  frameCount: number;
  /** Quiet frames at its end. */
  quietFrames: number;
  voicedFrom(from: number): number;
  /** The middle of the longest pause in from..to, or the quietest frame. */
  gap(from: number, to?: number): number;
}

const frames = (seconds: number) => Math.round(seconds / FRAME_S);

/** Where to end the piece that began at frame `from` (the next piece starts there), or null to wait. */
export function cutAt(h: Heard, from: number, o: PieceOptions = PIECE_DEFAULTS): number | null {
  const n = h.frameCount;
  if (n - from < frames(o.minS)) return null;
  if (h.voicedFrom(from) < frames(o.minVoicedS)) return null;
  if (h.quietFrames >= frames(o.pauseS)) return n;
  if (n - from < frames(o.maxS)) return null;
  return h.gap(from + frames(o.forcedMinS), n);
}

/** Words that begin a piece in capitals only because the model begins every clip with one. */
const CONTINUING = new Set("a an and as at but by for from how if in is it of on or so than that the then this to was we what when where which while who why with you".split(" "));

/** The pieces' words as one text, the seams mended where the model marked a continuation. */
export function stitch(parts: string[]): string {
  let out = "";
  for (const raw of parts) {
    let p = raw.trim();
    if (!p) continue;
    if (out) {
      const first = /^[A-Za-z]+/.exec(p)?.[0] ?? "";
      // "a small square." + "and the lines…" → "a small square, and the lines…"; never "e.g." or "...".
      if (/^[a-z]/.test(p) && /(^|\s)[^\s.]+\.$/.test(out)) out = `${out.slice(0, -1)},`;
      // "When you click a square" + "The guide opens…" → "When you click a square the guide opens…".
      else if (/[A-Za-z0-9]$/.test(out) && /^[A-Z][a-z]*$/.test(first) && CONTINUING.has(first.toLowerCase())) p = p[0].toLowerCase() + p.slice(1);
    }
    out = out ? `${out} ${p}` : p;
  }
  return out;
}
