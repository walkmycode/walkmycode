// Lookups for one map, built once and kept for as long as the map object
// lives: nodes and edges by id, and each node's edges in and out (in the map's
// own edge order, so walks over them visit things in the same order a scan of
// `map.edges` would). A map is never changed in place, so the index never goes
// stale: a new map is a new object and gets its own index.
import type { CodeMap, MapEdge, MapNode } from "@/analyzer/types";

export interface MapIndex {
  node: Map<string, MapNode>;
  edge: Map<string, MapEdge>;
  /** Edges leaving a node, in map order. */
  out: Map<string, MapEdge[]>;
  /** Edges arriving at a node, in map order. */
  in: Map<string, MapEdge[]>;
}

const NONE: MapEdge[] = [];
const cache = new WeakMap<CodeMap, MapIndex>();

export function buildIndex(map: CodeMap): MapIndex {
  const node = new Map<string, MapNode>();
  // The first node with an id wins, like `map.nodes.find`.
  for (const n of map.nodes) if (!node.has(n.id)) node.set(n.id, n);
  const edge = new Map<string, MapEdge>();
  const out = new Map<string, MapEdge[]>();
  const inn = new Map<string, MapEdge[]>();
  for (const e of map.edges) {
    if (!edge.has(e.id)) edge.set(e.id, e);
    const o = out.get(e.from);
    if (o) o.push(e);
    else out.set(e.from, [e]);
    const i = inn.get(e.to);
    if (i) i.push(e);
    else inn.set(e.to, [e]);
  }
  return { node, edge, out, in: inn };
}

/** The index of a map, made on first use. */
export function indexOf(map: CodeMap): MapIndex {
  let ix = cache.get(map);
  if (!ix) {
    ix = buildIndex(map);
    cache.set(map, ix);
  }
  return ix;
}

export const outOf = (ix: MapIndex, id: string): MapEdge[] => ix.out.get(id) ?? NONE;
export const inOf = (ix: MapIndex, id: string): MapEdge[] => ix.in.get(id) ?? NONE;
