// Links into the Explore room from elsewhere (the Learn room, a shared URL):
//   /map?focus=<repo-relative path>[:<start>[-<end>]][#<symbol>]
//   /map?node=<map node id>
// The parser is pure; `resolveDeepLink` turns a link into the lines to open
// and the card that owns them, using the map.
import type { CodeMap } from "@/analyzer/types";
import { nodeAt, nodeById } from "@/lib/store";

export type DeepLink =
  | { kind: "focus"; path: string; start?: number; end?: number; symbol?: string }
  | { kind: "node"; id: string };

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Read a deep link from `location.search` and `location.hash`, or null if there is none.
 * `#symbol` may arrive as the URL fragment, or encoded inside `focus` (`%23`). */
export function parseDeepLink(search: string, hash = ""): DeepLink | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const node = params.get("node")?.trim();
  const focus = params.get("focus")?.trim();
  if (focus) {
    let body = focus;
    let symbol: string | undefined;
    const cut = body.indexOf("#");
    if (cut >= 0) {
      symbol = body.slice(cut + 1);
      body = body.slice(0, cut);
    } else if (hash && hash !== "#") {
      symbol = safeDecode(hash.replace(/^#/, ""));
    }
    const m = /^(.+?)(?::(\d+)(?:\s*[-–]\s*(\d+))?)?$/.exec(body.trim());
    if (!m) return null;
    const path = m[1].replace(/^\.?\/+/, "");
    if (!path) return null;
    const link: DeepLink = { kind: "focus", path };
    let start = m[2] ? Number(m[2]) : undefined;
    let end = m[3] ? Number(m[3]) : undefined;
    if (start !== undefined && start < 1) start = 1;
    if (start !== undefined && end !== undefined && end < start) [start, end] = [end, start];
    if (start !== undefined) link.start = start;
    if (start !== undefined) link.end = end ?? start;
    if (symbol?.trim()) link.symbol = symbol.trim();
    return link;
  }
  if (node) return { kind: "node", id: node };
  return null;
}

export interface ResolvedLink {
  /** The file to open, or undefined when the link names something with no code here. */
  path?: string;
  start?: number;
  end?: number;
  /** The card that owns those lines (or the named node). */
  nodeId?: string;
}

/** Where a deep link lands on this map, or null when the file or node is not in it. */
export function resolveDeepLink(map: CodeMap, link: DeepLink): ResolvedLink | null {
  if (link.kind === "node") {
    const n = nodeById(map, link.id);
    if (n) return { path: n.file, start: n.line, end: n.endLine ?? n.line, nodeId: n.id };
    const s = map.services.find((x) => x.id === link.id);
    if (s) return { path: s.entry?.file, start: s.entry?.line, end: s.entry?.line, nodeId: s.id };
    return null;
  }
  const file = map.files.find((f) => f.path === link.path);
  if (!file) return null;
  let { start, end } = link;
  if (link.symbol && start === undefined) {
    const fn = file.fns?.[link.symbol];
    if (fn) {
      start = fn[0];
      end = fn[1];
    } else {
      // Not a top-level function: a card of that name in the file (a route handler, a component).
      const n = map.nodes.find((x) => x.file === link.path && (x.name === link.symbol || x.handler === link.symbol) && x.line !== undefined);
      if (n) {
        start = n.line;
        end = n.endLine ?? n.line;
      }
    }
  }
  const owner = nodeAt(map, link.path, start ?? 1);
  return { path: link.path, start, end: start !== undefined ? (end ?? start) : undefined, nodeId: owner?.id };
}

/** The URL with the deep-link parameters (and a symbol fragment) removed, so a reload doesn't repeat it. */
export function withoutDeepLink(href: string): string {
  const u = new URL(href);
  const had = u.searchParams.has("focus");
  u.searchParams.delete("focus");
  u.searchParams.delete("node");
  if (had) u.hash = "";
  return u.pathname + (u.search === "?" ? "" : u.search) + u.hash;
}
