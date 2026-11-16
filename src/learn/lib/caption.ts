/**
 * The transcript under the board: what the professor is saying, with the word
 * being spoken lit. A narrator that reports its words (ElevenLabs' timings,
 * the browser's word boundaries) says which word that is; for one that does
 * not, the word is reckoned from how long the line has been playing, at the voice's own pace.
 */
import { spokenWeight, voicePace, type Pace } from "@/lib/voice/measure";

export type WordSpan = { from: number; to: number };

/** Every word of a text, as offsets into it. */
export function wordSpans(text: string): WordSpan[] {
  return [...text.matchAll(/\S+/g)].map((m) => ({ from: m.index ?? 0, to: (m.index ?? 0) + m[0].length }));
}

/**
 * The word being spoken after `ms` of a line, reckoned while its audio is not yet measured (the first moments of a
 * streamed line): each word takes as long as it is to say (spokenWeight: syllables, a code name's dots said aloud),
 * at the voice's real pace (voicePace: learned from the lines already measured, at this speed), with its pause after a
 * comma or full stop and its silence before the first word. Null after the last word.
 */
export function reckonedWord(text: string, ms: number, speed = 1, pace: Pace = voicePace(speed)): WordSpan | null {
  const words = wordSpans(text);
  if (!words.length) return null;
  let at = pace.lead * 1000;
  if (ms < at) return words[0];
  for (const w of words) {
    const word = text.slice(w.from, w.to);
    at += spokenWeight(word) * pace.perUnit * 1000;
    if (ms < at) return w;
    if (/[.!?…,;:—–]["'”’)\]]*$/.test(word)) {
      at += pace.pause * 1000;
      // In the pause, the word just said stays lit.
      if (ms < at) return w;
    }
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
