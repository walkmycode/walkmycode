/**
 * Recall cards: a lesson's key ideas, asked again just before they would be
 * forgotten (docs/LEARNING.md, "Test knowledge"). A card sits in a box; a
 * right answer moves it up a box and further into the future, a wrong one
 * sends it back to the first box, due again tomorrow.
 */
import type { Lesson } from "./types";
import { plain } from "./markup";

export type Card = {
  id: string;
  lessonId: string;
  course: string;
  q: string;
  a: string;
  /** A picture that goes with the answer, as Mermaid source. */
  diagram?: string;
  /** 0 is new; each right answer moves it up, to the last box at most. */
  box: number;
  /** When it is next asked (ms since 1970). */
  due: number;
  /** How often it has been answered, and how often rightly. */
  seen: number;
  right: number;
};

export const DAY = 24 * 60 * 60 * 1000;
/** Days until a card in each box comes back. A new card is due at once. */
export const INTERVALS = [0, 1, 3, 7, 16, 35];

/** The card after an answer. */
export function review(card: Card, knew: boolean, now: number): Card {
  const box = knew ? Math.min(card.box + 1, INTERVALS.length - 1) : 1;
  return { ...card, box, due: now + INTERVALS[box] * DAY, seen: card.seen + 1, right: card.right + (knew ? 1 : 0) };
}

/** The cards to ask now, the longest overdue first. */
export function dueCards(cards: Card[], now: number, lessonId?: string): Card[] {
  return cards.filter((c) => c.due <= now && (!lessonId || c.lessonId === lessonId)).sort((a, b) => a.due - b.due);
}

/** "tomorrow", "in 3 days": when a card comes back. */
export function dueIn(due: number, now: number): string {
  const days = Math.ceil((due - now) / DAY);
  return days <= 0 ? "now" : days === 1 ? "tomorrow" : `in ${days} days`;
}

const clean = (raw: unknown): { q: string; a: string; diagram?: string }[] =>
  (Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [])
    .map((c) => ({
      q: typeof c?.q === "string" ? c.q.trim() : "",
      a: typeof c?.a === "string" ? c.a.trim() : "",
      ...(typeof c?.diagram === "string" && c.diagram.trim() ? { diagram: c.diagram.trim().slice(0, 3000) } : {}),
    }))
    .filter((c) => c.q && c.a)
    .slice(0, 10);

/**
 * A lesson's cards: the ones the professor wrote for it, else one from each
 * quiz question (its right answer and why). Ids come from the lesson and the
 * card's place, so making them twice makes no doubles.
 */
export function cardsFor(lesson: Lesson, written: unknown, now: number): Card[] {
  let pairs: { q: string; a: string; diagram?: string }[] = clean(written);
  if (!pairs.length) {
    pairs = lesson.boards
      .flatMap((b) => b.quiz ?? [])
      .map((it) => ({ q: plain(it.q), a: `${plain(it.options[it.answer] ?? "")}${it.why ? `. ${plain(it.why)}` : ""}` }));
  }
  return pairs.map((p, i) => ({ id: `${lesson.id}-${i}`, lessonId: lesson.id, course: lesson.course, q: p.q, a: p.a, ...(p.diagram ? { diagram: p.diagram } : {}), box: 0, due: now, seen: 0, right: 0 }));
}

/** Add new cards to the deck, keeping the progress of any already there. */
export function mergeCards(deck: Card[], add: Card[]): Card[] {
  const have = new Set(deck.map((c) => c.id));
  return [...deck, ...add.filter((c) => !have.has(c.id))];
}

/** How a deck stands: how many are due, how many are learnt (the last two boxes). */
export function deckStats(cards: Card[], now: number) {
  return { total: cards.length, due: cards.filter((c) => c.due <= now).length, learnt: cards.filter((c) => c.box >= INTERVALS.length - 2).length };
}
