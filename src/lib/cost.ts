"use client";
// A running total of what this session has cost on the user's own keys,
// worked out from the usage the API reports and the catalogue's prices
// ($ per million tokens). Cache tokens are not inside input_tokens and
// reasoning tokens are inside output_tokens, so nothing is billed twice.
import { useSyncExternalStore } from "react";
import { modelFor, PROVIDERS, providerFor, type Price, type ProviderId } from "@/lib/providers/catalogue";
import type { Usage } from "@/lib/providers/wire";
import { lectureCost, lecturerModelFor, narrationCost, type LecturerId, type LecturerModelId, type NarratorId } from "@/lib/voice/catalogue";

export interface CostTotal {
  usd: number;
  calls: number;
  cacheHits: number;
  /** Calls that could not be priced: local models, unknown prices, or no usage reported. */
  unknown: number;
  /** Some call used a fallback or unverified price. */
  approx: boolean;
  /** Characters a paid narrator read aloud (fetched, not replayed from the cache). */
  voiceChars: number;
  /** Seconds a lecturer was connected (billing is by connected time). */
  talkSeconds: number;
}

export const COST_TITLE =
  "Estimated from published prices on your own key. Local models and unpublished prices count as unpriced. Voice: characters read aloud × the narrator's price, and minutes of Talk × the lecturer's price (ElevenLabs' agent also bills its model's tokens, which are not counted here).";

/**
 * The price for a model: exact id, then prefix (dated echoes). An id the
 * catalogue does not know on a cloud provider is priced as that provider's
 * dearest model, never as free; local and unpriced models get null.
 */
export function priceFor(provider: ProviderId, model: string): { price: Price | null; approx: boolean } {
  const p = providerFor(provider);
  if (!p || p.id === PROVIDERS.local.id) return { price: null, approx: false };
  const def = modelFor(p, model);
  if (def) return { price: def.price, approx: false };
  const dearest = p.models
    .map((m) => m.price)
    .filter((x): x is Price => x !== null)
    .sort((a, b) => b.in + b.out - (a.in + a.out))[0];
  return dearest ? { price: dearest, approx: true } : { price: null, approx: false };
}

export function costOf(price: Price, u: Usage): number {
  return (u.input_tokens * price.in + u.output_tokens * price.out + u.cache_read_input_tokens * (price.cacheRead ?? price.in) + u.cache_creation_input_tokens * (price.cacheWrite ?? price.in)) / 1e6;
}

const ZERO: CostTotal = { usd: 0, calls: 0, cacheHits: 0, unknown: 0, approx: false, voiceChars: 0, talkSeconds: 0 };
let total = ZERO;
const listeners = new Set<() => void>();

const changed = () => {
  for (const l of listeners) l();
};

export function addUsage(provider: ProviderId, model: string, u: Usage): void {
  const { price, approx } = priceFor(provider, model);
  const priced = price !== null && u.known;
  total = {
    ...total,
    usd: total.usd + (priced ? costOf(price, u) : 0),
    calls: total.calls + 1,
    cacheHits: total.cacheHits + (u.cache_read_input_tokens > 0 ? 1 : 0),
    unknown: total.unknown + (priced ? 0 : 1),
    approx: total.approx || (priced && (approx || price.unverified === true)),
  };
  changed();
}

/** Narration fetched from a paid narrator: characters × its price per 1,000. The browser's voice and replays from the cache are free. */
export function addNarration(narrator: NarratorId, chars: number): void {
  const usd = narrationCost(narrator, chars);
  if (usd <= 0) return;
  total = { ...total, usd: total.usd + usd, voiceChars: total.voiceChars + chars };
  changed();
}

/** A lecture that has closed: connected seconds × the lecturer's price per minute. ElevenLabs' agent bills its model on top, so its figure is approximate. */
export function addLecture(lecturer: LecturerId, model: LecturerModelId, seconds: number): void {
  if (!(seconds > 0)) return;
  const plus = lecturerModelFor(lecturer, model)?.plusModel === true;
  total = { ...total, usd: total.usd + lectureCost(lecturer, model, seconds), talkSeconds: total.talkSeconds + seconds, approx: total.approx || plus };
  changed();
}

/** The running total outside React (tests, logging). */
export function readCost(): CostTotal {
  return total;
}

/** Back to zero (tests). */
export function resetCost(): void {
  total = ZERO;
  for (const l of listeners) l();
}

/** "1,234 chars read" / "12.3k chars read". */
const chars = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString("en-GB"));

/** The header pill: `$0.123 · 4 calls`, `≈` when approximate, `· 2 unpriced` when some calls could not be priced,
 * then what voice used, when it was used: `· 1,234 chars read · 3.5 min talk`. */
export function formatCost(t: CostTotal): string {
  const voice = `${t.voiceChars > 0 ? ` · ${chars(t.voiceChars)} chars read` : ""}${t.talkSeconds > 0 ? ` · ${(t.talkSeconds / 60).toFixed(1)} min talk` : ""}`;
  return `${t.approx ? "≈" : ""}$${t.usd.toFixed(3)} · ${t.calls} calls${t.unknown > 0 ? ` · ${t.unknown} unpriced` : ""}${voice}`;
}

export function useCost(): CostTotal {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => total,
    () => total,
  );
}
