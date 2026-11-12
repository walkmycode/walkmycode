// What the map lights up and what it dims, kept out of React Flow's nodes and
// edges (docs/PERFORMANCE.md). The cards and arrows are made once per layout;
// a click or a trace only changes this small state, and each card or arrow
// reads its own few classes from it. Only the ones whose classes change are
// drawn again, and the dimming of everything else is one class on the map's
// box (`hl-near`, `hl-lit`), done by CSS.
//
// A trace also carries its timing (mapTrace.ts): each lit card and arrow
// reads its place in the sweep along with its classes, as `--i` for the CSS.
//
// No React here, so tests can check it without a browser.
import type { CodeMap } from "@/analyzer/types";
import { neighbourhood } from "@/lib/store";
import { flyTiming, traceTiming, type TraceTiming } from "./mapTrace";

export interface Lit {
  nodes: Set<string>;
  edges: Set<string>;
  /** Services the trace passes through (system view cards light by these). */
  services?: Set<string>;
  /** The card the trace was started from (the light flies there first). */
  origin?: string;
  /** A fly-through's hop on screen (src/lib/flythrough.ts): the path so far stays lit and
   * only this hop animates, its arrow ridden (against it when `reverse`) and its card lit
   * as the rider lands; a gap is drawn as one. */
  fly?: FlyHop;
}

export interface FlyHop {
  to: string;
  from: string | null;
  edge: string | null;
  reverse: boolean;
  gap: boolean;
}

export type HiMode = "none" | "near" | "lit";

export interface HiState {
  /** `lit`: a trace or tour step; `near`: a card is selected on the lanes; else `none`. */
  mode: HiMode;
  selected: string | null;
  lit: Lit | null;
  /** The selected card and its neighbours, one hop, imports included (lanes only). */
  near: { nodes: Set<string>; edges: Set<string> } | null;
  /** When each lit card and arrow lights, while a trace is on. */
  timing: TraceTiming | null;
}

export function hiStateOf(map: CodeMap, selected: string | null, lit: Lit | null, isSystem: boolean): HiState {
  const near = selected && !isSystem ? neighbourhood(map, selected, 1, true) : null;
  return { mode: lit ? "lit" : near ? "near" : "none", selected, lit, near, timing: lit ? (lit.fly ? flyTiming(lit, lit.fly) : traceTiming(map, lit, lit.origin)) : null };
}

/** Classes of a card on the lanes, or of a portal (by the node it stands for). */
export function cardClass(s: HiState, id: string): string {
  let c = s.selected === id ? " selected" : "";
  if (s.lit?.nodes.has(id)) c += " lit";
  if (s.mode === "near" && s.near!.nodes.has(id)) c += " near";
  return c;
}

/** Classes of a service card on the system view. */
export function svcClass(s: HiState, id: string): string {
  let c = s.selected === id ? " selected" : "";
  if (s.lit && (s.lit.services?.has(id) || s.lit.nodes.has(id))) c += " lit";
  return c;
}

/** Classes of one arrow on the lanes. */
export function edgeClass(s: HiState, id: string): string {
  let c = "";
  if (s.lit?.edges.has(id)) c += " lit";
  if (s.near?.edges.has(id)) c += " near";
  return c;
}

/** Classes of one arrow on the system view (it stands for many edges). */
export function linkClass(s: HiState, edgeIds: string[][]): string {
  const lit = s.lit;
  if (!lit) return "";
  for (const ids of edgeIds) for (const e of ids) if (lit.edges.has(e)) return " lit";
  return "";
}

// ── classes with the sweep's timing, as one string per element ──
// useSyncExternalStore compares snapshots by identity, so each card or arrow reads
// one string: its classes, then "|" and its place in the sweep when it is lit.

const withAt = (cls: string, at: number | undefined) => (at === undefined ? cls : `${cls}|${at}`);

export function cardPick(s: HiState, id: string): string {
  return withAt(cardClass(s, id), s.timing?.nodeAt.get(id));
}
export function svcPick(s: HiState, id: string): string {
  const t = s.timing;
  return withAt(svcClass(s, id), t ? (t.serviceAt.get(id) ?? t.nodeAt.get(id)) : undefined);
}
export function edgePick(s: HiState, id: string): string {
  return withAt(edgeClass(s, id), s.timing?.edgeAt.get(id));
}
export function linkPick(s: HiState, edgeIds: string[][]): string {
  const cls = linkClass(s, edgeIds);
  const t = s.timing;
  if (!cls || !t) return cls;
  let at: number | undefined;
  for (const ids of edgeIds) for (const e of ids) {
    const a = t.edgeAt.get(e);
    if (a !== undefined && (at === undefined || a < at)) at = a;
  }
  return withAt(cls, at);
}

/** "classes|at" back into its two parts. */
export function splitPick(pick: string): { cls: string; at: number | undefined } {
  const i = pick.indexOf("|");
  return i < 0 ? { cls: pick, at: undefined } : { cls: pick.slice(0, i), at: Number(pick.slice(i + 1)) };
}

/** A tiny store the cards and arrows subscribe to (with useSyncExternalStore). */
export class Highlight {
  private listeners = new Set<() => void>();
  constructor(public state: HiState) {}
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  get = () => this.state;
  set(next: HiState) {
    if (next === this.state) return;
    this.state = next;
    for (const l of this.listeners) l();
  }
}
