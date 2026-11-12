/**
 * The transcript under the board: what the professor is saying, with the word
 * being spoken lit. A narrator that reports its words (ElevenLabs' timings,
 * the browser's word boundaries) says which word that is; for one that does
 * not, the word is reckoned from how long the line has been playing.
 */
export type WordSpan = { from: number; to: number };

/** Every word of a text, as offsets into it. */
export function wordSpans(text: string): WordSpan[] {
  return [...text.matchAll(/\S+/g)].map((m) => ({ from: m.index ?? 0, to: (m.index ?? 0) + m[0].length }));
}

/** Characters spoken a second at normal speed: a measured pace for the app's narrators reading lesson lines. */
export const SPEAKING_RATE = 15;

/**
 * The word being spoken after `ms` of a line, reckoned from its length: each word takes time by its
 * letters, and a full stop or comma adds a short pause. Null before the first word and after the last.
 */
export function reckonedWord(text: string, ms: number, speed = 1): WordSpan | null {
  const words = wordSpans(text);
  let at = 0;
  const perChar = 1000 / (SPEAKING_RATE * (speed > 0 ? speed : 1));
  for (const w of words) {
    const word = text.slice(w.from, w.to);
    const takes = (word.length + 1) * perChar + (/[.!?]$/.test(word) ? 320 : /[,;:]$/.test(word) ? 160 : 0) / (speed > 0 ? speed : 1);
    if (ms < at + takes) return w;
    at += takes;
  }
  return null;
}

/** A long answer is shown a sentence at a time: the bounds of the sentence that holds `at`. */
function sentenceAround(text: string, at: number): WordSpan {
  if (text.length <= 220) return { from: 0, to: text.length };
  let from = 0;
  for (const m of text.matchAll(/[.!?]["')\]]*\s+/g)) {
    const end = (m.index ?? 0) + m[0].length;
    if (end > at) return { from, to: end };
    from = end;
  }
  return { from, to: text.length };
}

/** The transcript in three parts: what has been said, the word being said, and what is to come. */
export function captionParts(text: string, word: WordSpan | null): { said: string; now: string; next: string } {
  if (!word || word.from >= text.length) return { said: "", now: "", next: sentenceAround(text, 0).to === text.length ? text : text.slice(0, sentenceAround(text, 0).to) };
  const s = sentenceAround(text, word.from);
  const to = Math.min(word.to, s.to);
  return { said: text.slice(s.from, word.from), now: text.slice(word.from, to), next: text.slice(to, s.to) };
}
