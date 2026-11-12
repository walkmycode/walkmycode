// The order a trace lights up in (docs/MOTION.md §4.3): pages, then routes,
// then logic, then the database, whichever card it started from. Each lit
// card and arrow gets a place in that sweep (its lane, counted from the first
// lane the trace touches); the gap between places, the hop, is chosen so the
// whole sweep fits in 1.2 s. A trace that crosses into another service
// carries on there: that service's lanes come after (or, walking back,
// before) the ones it left. The chain is the one path the light rides.
//
// No React or DOM here, so tests can check the order without a browser.
import type { CodeMap } from "@/analyzer/types";
import { indexOf, inOf, outOf, type MapIndex } from "@/lib/mapIndex";
import { FLY_HOP_MS, hopMs } from "@/lib/motion";
import type { FlyHop, Lit } from "./mapHighlight";

export interface TraceTiming {
  /** Milliseconds between one lane lighting and the next. */
  hop: number;
  /** How many lanes the sweep crosses. */
  lanes: number;
  /** Each lit node's place in the sweep: 0 lights first. */
  nodeAt: Map<string, number>;
  /** Each lit arrow's place: that of its earlier end. */
  edgeAt: Map<string, number>;
  /** Each lit service's place on the system view: its earliest lit node. */
  serviceAt: Map<string, number>;
  /** The arrows the light rides, in order: back from the origin to the first lane, then on to the last. */
  chain: string[];
  /** A fly-through hop that runs against its arrow: the rider rides it backwards. */
  reverse?: boolean;
  /** A fly-through hop between two cards the map does not join: drawn as a gap. */
  gap?: { from: string; to: string } | null;
}

/**
 * A fly-through's hop (src/lib/flythrough.ts): the path so far stays lit as it
 * is (place 0, so nothing already lit animates again); the arrow of this hop
 * draws at once and the rider takes FLY_HOP_MS along it, and the card it
 * reaches (place 1) ignites as the rider lands.
 */
export function flyTiming(lit: Lit, hop: FlyHop): TraceTiming {
  const nodeAt = new Map<string, number>();
  const edgeAt = new Map<string, number>();
  const serviceAt = new Map<string, number>();
  // Only a hop the rider travels makes its card wait for it (a first hop or a gap lights at once).
  const rides = !!hop.edge && !!hop.from && hop.from !== hop.to;
  for (const id of lit.nodes) nodeAt.set(id, rides && id === hop.to ? 1 : 0);
  for (const id of lit.edges) edgeAt.set(id, 0);
  for (const s of lit.services ?? []) serviceAt.set(s, 0);
  return {
    hop: FLY_HOP_MS,
    lanes: 2,
    nodeAt,
    edgeAt,
    serviceAt,
    chain: hop.edge ? [hop.edge] : [],
    reverse: hop.reverse,
    gap: hop.gap && hop.from ? { from: hop.from, to: hop.to } : null,
  };
}

const RANK: Record<string, number> = { ui: 0, api: 1, logic: 2, data: 3, external: 3 };
/** A service hop moves the sweep on by one whole set of lanes. */
const SERVICE_STEP = 4;

function rankOf(ix: MapIndex, id: string): number {
  const n = ix.node.get(id);
  if (!n) return 2;
  if (n.kind === "channel") return 1.5; // a queue sits between the routes and the logic
  return RANK[n.layer] ?? 2;
}

/** Which lit service comes before which: walk the lit arrows out from the origin, and
 * every arrow that crosses into another service pushes that service one step later
 * (earlier, walking back). */
function serviceOffsets(ix: MapIndex, lit: Lit, origin: string): Map<string, number> {
  const svc = (id: string) => ix.node.get(id)?.service;
  const offsets = new Map<string, number>();
  const home = svc(origin);
  if (home) offsets.set(home, 0);
  const seen = new Set([origin]);
  const queue = [origin];
  while (queue.length) {
    const a = queue.shift()!;
    const sa = svc(a);
    for (const dir of ["out", "in"] as const) {
      for (const e of dir === "out" ? outOf(ix, a) : inOf(ix, a)) {
        if (!lit.edges.has(e.id)) continue;
        const b = dir === "out" ? e.to : e.from;
        if (!lit.nodes.has(b)) continue;
        const sb = svc(b);
        if (sa && sb && sa !== sb && !offsets.has(sb)) offsets.set(sb, (offsets.get(sa) ?? 0) + (dir === "out" ? SERVICE_STEP : -SERVICE_STEP));
        if (!seen.has(b)) {
          seen.add(b);
          queue.push(b);
        }
      }
    }
  }
  return offsets;
}

/** The one path the light rides: from the origin back along lit arrows to earlier
 * lanes (first arrow in map order each time), reversed, then on from the origin,
 * preferring an arrow into a later lane over one along the same lane. */
function chainOf(ix: MapIndex, lit: Lit, origin: string, at: Map<string, number>): string[] {
  const place = (id: string) => at.get(id) ?? 0;
  const back: string[] = [];
  const seen = new Set([origin]);
  let cur = origin;
  for (;;) {
    const e = inOf(ix, cur).find((x) => lit.edges.has(x.id) && lit.nodes.has(x.from) && !seen.has(x.from) && place(x.from) < place(cur));
    if (!e) break;
    back.push(e.id);
    seen.add(e.from);
    cur = e.from;
  }
  const forward: string[] = [];
  cur = origin;
  for (;;) {
    const open = outOf(ix, cur).filter((x) => lit.edges.has(x.id) && lit.nodes.has(x.to) && !seen.has(x.to));
    const e = open.find((x) => place(x.to) > place(cur)) ?? open.find((x) => place(x.to) === place(cur));
    if (!e) break;
    forward.push(e.id);
    seen.add(e.to);
    cur = e.to;
  }
  return [...back.reverse(), ...forward];
}

/** When each lit card and arrow lights, and the path the light rides. `origin` is the
 * card the trace was started from; without one (a tour step) the sweep starts at the
 * earliest lit card. */
export function traceTiming(map: CodeMap, lit: Lit, origin?: string | null): TraceTiming {
  const ix = indexOf(map);
  const nodeAt = new Map<string, number>();
  const edgeAt = new Map<string, number>();
  const serviceAt = new Map<string, number>();
  if (!lit.nodes.size) return { hop: hopMs(1), lanes: 1, nodeAt, edgeAt, serviceAt, chain: [] };

  const start = origin && lit.nodes.has(origin) ? origin : [...lit.nodes].sort((a, b) => rankOf(ix, a) - rankOf(ix, b))[0];
  const offsets = serviceOffsets(ix, lit, start);
  const raw = new Map<string, number>();
  let min = Infinity;
  let max = -Infinity;
  for (const id of lit.nodes) {
    const s = ix.node.get(id)?.service;
    const r = rankOf(ix, id) + (s ? (offsets.get(s) ?? 0) : 0);
    raw.set(id, r);
    if (r < min) min = r;
    if (r > max) max = r;
  }
  for (const [id, r] of raw) nodeAt.set(id, r - min);
  for (const id of lit.edges) {
    const e = ix.edge.get(id);
    if (!e) continue;
    const a = nodeAt.get(e.from);
    const b = nodeAt.get(e.to);
    if (a === undefined && b === undefined) continue;
    edgeAt.set(id, Math.min(a ?? Infinity, b ?? Infinity));
  }
  for (const [id, at] of nodeAt) {
    const s = ix.node.get(id)?.service;
    if (s) serviceAt.set(s, Math.min(serviceAt.get(s) ?? Infinity, at));
  }
  for (const s of lit.services ?? []) if (!serviceAt.has(s)) serviceAt.set(s, 0);
  const lanes = Math.max(1, Math.ceil(max - min) + 1);
  return { hop: hopMs(lanes), lanes, nodeAt, edgeAt, serviceAt, chain: chainOf(ix, lit, start, nodeAt) };
}

/** The stops of a `linear()` easing that keep the rider in step with the lanes: it
 * spends one hop on each arrow of the chain (four fifths riding it, one fifth
 * crossing the card at its end), whatever the arrows' lengths. `lengths` are the
 * arrows' lengths and `crossings` the gaps between one arrow's end and the next's
 * start, in the same unit; the result is the easing's value at each stop as a
 * fraction of the whole path. */
export function riderStops(lengths: number[], crossings: number[]): { value: number; at: number }[] {
  const k = lengths.length;
  if (!k) return [{ value: 0, at: 0 }, { value: 1, at: 1 }];
  let total = 0;
  for (let i = 0; i < k; i++) total += lengths[i] + (i < k - 1 ? (crossings[i] ?? 0) : 0);
  if (total <= 0) return [{ value: 0, at: 0 }, { value: 1, at: 1 }];
  const stops: { value: number; at: number }[] = [];
  let pos = 0;
  for (let i = 0; i < k; i++) {
    stops.push({ value: pos / total, at: i / k });
    pos += lengths[i];
    if (i < k - 1) {
      stops.push({ value: pos / total, at: (i + 0.8) / k });
      pos += crossings[i] ?? 0;
    }
  }
  stops.push({ value: 1, at: 1 });
  return stops;
}

/** `linear(0, .2 25%, …, 1)` from the stops above. */
export function linearEasing(stops: { value: number; at: number }[]): string {
  return `linear(${stops.map((s) => `${+s.value.toFixed(4)} ${+(s.at * 100).toFixed(2)}%`).join(", ")})`;
}

/** How long a smooth-step arrow from a right-hand handle to a left-hand one is, near
 * enough for timing: it runs straight across when the target is to the right, and
 * loops back (out, back past its start, and in) when it is not. */
export function arrowLength(sx: number, sy: number, tx: number, ty: number, offset = 20): number {
  const dy = Math.abs(ty - sy);
  if (tx - sx >= offset * 2) return tx - sx + dy;
  return offset * 2 + (sx - tx + offset * 2) + dy;
}
