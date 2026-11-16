"use client";
/**
 * The Learn home's pictures, from the drawings set (src/lib/drawings): a course's cover (one big drawing
 * and two small ones, found from its name and its lessons' titles) and a small drawing beside a label.
 * Loaded on its own (Library.tsx, React.lazy), so the set is not in the page's first load.
 */
import { findDrawing } from "@/lib/drawings";
import Drawing from "@/components/scene/Drawing";

/** Drawings that suit any subject, for a course whose words match none. */
const ANY = ["book", "bulb", "puzzle", "compass", "telescope", "trophy", "magnifier", "pencil", "globe", "blueprint"];

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/** Up to three different drawings for these words: the whole of each text first, then its single words. */
export function drawingsFor(texts: string[], seed: string): string[] {
  const out: string[] = [];
  const add = (n: string | null) => {
    if (n && !out.includes(n)) out.push(n);
  };
  for (const t of texts) add(findDrawing(t));
  for (const t of texts) for (const w of t.split(/[^\p{L}\p{N}]+/u)) if (w.length > 3) add(findDrawing(w));
  for (let i = 0; out.length < 3; i++) add(ANY[(hash(seed) + i) % ANY.length]);
  return out.slice(0, 3);
}

export function Cover({ texts, seed, tint }: { texts: string[]; seed: string; tint: string }) {
  const [big, a, b] = drawingsFor(texts, seed);
  return (
    <>
      <span className="lh-s1"><Drawing name={a} tint={tint} /></span>
      <span className="lh-s2"><Drawing name={b} /></span>
      <span className="lh-big"><Drawing name={big} tint={tint} /></span>
    </>
  );
}

/** One drawing: by its name in the set, or the first that fits these words. */
export function Pic({ name, words, tint }: { name?: string; words?: string; tint?: string }) {
  return <Drawing name={name ?? findDrawing(words) ?? "bulb"} tint={tint} />;
}
