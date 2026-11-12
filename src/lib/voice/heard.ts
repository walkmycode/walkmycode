// The instant answer to a spoken question (docs/MCP.md §4, Talk through
// Claude): the moment the user lets go, before Claude has said a word, the page
// says a short line of its own and lights the cards the question names, found
// by the map's own search. Claude's narration follows in a few seconds, so the
// wait never feels empty. Pure, for tests.
import type { CodeMap, MapNode } from "@/analyzer/types";

/** Words that name nothing on a map. */
const STOP = new Set(
  "a an and are as at be but by can could do does did for from get got has have how i if in into is it its just let me my of on or our please say show so tell than that the their them then there these they this those to up us was we what when where which who why will with work works would you your about after again all also any around before being call calls called code come comes file files go goes happen happens here into know like look make makes more most much need new now one only other out over part really see some still such take thing things through used uses using want way well were".split(
    " ",
  ),
);

/** The words of a question worth looking for on the map: lower case, three letters or more, no filler. */
export function keywords(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9_]+(?:[-.][a-z0-9_]+)*/g) ?? [];
  const out: string[] = [];
  for (const w of words) {
    const stem = w.replace(/(?:ing|ed|es|s)$/, "");
    for (const k of [w, stem]) if (k.length >= 3 && !STOP.has(k) && !out.includes(k)) out.push(k);
  }
  return out.slice(0, 12);
}

/** How well a card matches the words: by name first, then by file. */
function score(n: MapNode, words: string[]): number {
  const name = n.name.toLowerCase();
  const file = (n.file ?? "").toLowerCase();
  const base = file.split("/").pop()?.replace(/\.[a-z]+$/, "") ?? "";
  let s = 0;
  for (const w of words) {
    if (name === w || base === w) s += 4;
    else if (name.includes(w)) s += 2;
    else if (base.includes(w) || (n.path ?? "").toLowerCase().includes(w)) s += 1;
  }
  return s;
}

/** The cards a question names, best first (at most `limit`). */
export function cardsNamed(map: CodeMap, text: string, limit = 6): MapNode[] {
  const words = keywords(text);
  if (!words.length) return [];
  return map.nodes
    .map((n) => ({ n, s: score(n, words) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.n.name.length - b.n.name.length)
    .slice(0, limit)
    .map((x) => x.n);
}

const OPENERS = ["Let me look at", "Good question. Looking at", "One moment, checking", "Let me find"];
const PLAIN = ["Let me look.", "Good question, one moment.", "Let me check the code.", "One moment."];

/** The short line the page says itself, naming the first card when there is one. `n` picks the wording. */
export function ackLine(names: string[], n = 0): string {
  const i = Math.abs(n) % OPENERS.length;
  const name = names[0]?.replace(/[_-]+/g, " ").trim();
  return name ? `${OPENERS[i]} ${name}.` : PLAIN[i];
}
