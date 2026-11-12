// Where every card on the map goes, as a pure function of the map and the view
// (docs/SERVICES.md §7): `all` is today's five lanes, `service` is those lanes
// for one service plus portals (one stub card per far end of the arrows that
// leave it), `system` is one card per service with arrows between them.
// No React here, so tests can check positions without a browser.
import type { CodeMap, Confidence, EdgeKind, Layer, MapEdge, MapNode, ServiceDef, ServiceLink } from "@/analyzer/types";
import { neighbourhood, nodeById } from "@/lib/store";
import { indexOf } from "@/lib/mapIndex";

export type MapViewState = { kind: "all" } | { kind: "system" } | { kind: "service"; id: string };

export interface Filter {
  focus?: string | null;
  query?: string;
  showImports?: boolean;
}

export interface Lane {
  layer: Layer;
  title: string;
  hint: string;
}

export const LANES: Lane[] = [
  { layer: "ui", title: "Pages & components", hint: "what the user sees and clicks" },
  { layer: "api", title: "API routes", hint: "the doors the app knocks on" },
  { layer: "logic", title: "Logic", hint: "the work behind each door" },
  { layer: "data", title: "Database", hint: "where things are kept" },
  { layer: "external", title: "Outside services", hint: "other companies' APIs" },
];
/** Inside one service the last lane also holds queues and services whose code is not here. */
const SERVICE_OUTSIDE_LANE: Lane = { layer: "external", title: "Outside & other services", hint: "other companies' APIs, queues, and services I can't see" };

export const CARD_W = 220;
export const CARD_H = 46;
/** A table card lists this many of its columns; the rest are "+N more" (the Inspector has them all). */
export const CARD_COLUMNS = 6;
/** One column's line on a table card (globals.css `.node .cols` keeps to it). */
const COLUMN_LINE = 14;
/** The columns a table card shows, and how many it leaves out. */
export function cardColumns(n: MapNode): { shown: NonNullable<MapNode["columns"]>; more: number } {
  const cols = n.kind === "table" ? (n.columns ?? []) : [];
  // "+1 more" takes a line as well as the column would: show it instead.
  const shown = cols.length <= CARD_COLUMNS + 1 ? cols : cols.slice(0, CARD_COLUMNS);
  return { shown, more: cols.length - shown.length };
}
/** A card's height: a table with columns grows a line for each one it lists. */
export function cardHeight(n: MapNode): number {
  const { shown, more } = cardColumns(n);
  const lines = shown.length + (more ? 1 : 0);
  return lines ? CARD_H + 5 + lines * COLUMN_LINE : CARD_H;
}
const GAP_X = 260;
const LANE_GAP = 90;
const PER_COLUMN = 40;

export const SVC_W = 240;
export const SVC_H = 104;
const SVC_COL_GAP = 340;
const SVC_ROW_GAP = 34;
/** Room around the cards of a group box, and for its label. */
const GROUP_PAD = 12;
const GROUP_HEAD = 18;
/** Outside companies stack in columns of this many, so a long list does not dwarf the services. */
const OUTSIDE_PER_COL = 8;

export interface LaneItem {
  id: string;
  type: "lane";
  x: number;
  y: number;
  title: string;
  hint: string;
  count: number;
  layer: Layer;
}
export interface CardItem {
  id: string;
  type: "card";
  x: number;
  y: number;
  node: MapNode;
  /** "← called by orders", "shared with orders", "shared library lib/common". */
  badge?: string;
}
export interface PortalItem {
  id: string;
  type: "portal";
  x: number;
  y: number;
  layer: Layer;
  /** The real node at the far end of the arrow. */
  target: string;
  edgeId: string;
  name: string;
  sub: string;
}
export interface SvcCard {
  kind: ServiceDef["kind"] | "outside";
  name: string;
  /** Lines under the name, e.g. "Next.js", "6 routes · 2 tables". */
  lines: string[];
  badge?: string;
  /** Hover text, e.g. the channels a broker carries. */
  title?: string;
  declared?: boolean;
  /** An app whose code is here: double-click opens its lanes. */
  openable: boolean;
}
export interface SvcItem {
  id: string;
  type: "svc";
  x: number;
  y: number;
  card: SvcCard;
}
/** A labelled box behind the cards of one `group` (a Backstage `system`) on the system view. */
export interface GroupItem {
  id: string;
  type: "group";
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
}
export type LaidNode = LaneItem | CardItem | PortalItem | SvcItem | GroupItem;

export type LinkGroup = "request" | "message" | "data" | "declared" | "proxies" | "outside";

export interface EdgeItem {
  id: string;
  type: "edge";
  source: string;
  target: string;
  edge: MapEdge;
}
export interface LinkItem {
  id: string;
  type: "link";
  source: string;
  target: string;
  group: LinkGroup;
  /** The service links this arrow stands for; outside ones are made here from uses-service edges. */
  links: ServiceLink[];
  label: string;
  confidence: Confidence;
  /** "12 of these rest on what you told WalkMyCode: VITE_API_URL → backend", for the pill's hover text. */
  told?: string;
}
export type LaidEdge = EdgeItem | LinkItem;

export interface Layout {
  nodes: LaidNode[];
  edges: LaidEdge[];
}

// ── which views a map has ──

export function hasSystem(map: CodeMap): boolean {
  return map.system.kind === "services";
}

/** A service whose lanes can be opened: an app with code in the workspace. */
export function isOpenable(s: ServiceDef | undefined): boolean {
  return !!s && s.kind === "app" && s.areas.length > 0;
}

/** Monolith and monorepo: today's lanes. Services: the system view, or every lane when the map is small. */
export function defaultView(map: CodeMap): MapViewState {
  if (!hasSystem(map)) return { kind: "all" };
  return map.nodes.length <= 150 ? { kind: "all" } : { kind: "system" };
}

/** A view that exists for this map, or the default. */
export function checkView(map: CodeMap, v: MapViewState | null | undefined): MapViewState {
  if (!v || !hasSystem(map)) return defaultView(map);
  if (v.kind === "service" && !isOpenable(map.services.find((s) => s.id === v.id))) return defaultView(map);
  return v;
}

/** URL hash: `#system`, `#all`, `#svc-users`, each optionally `/<selected id>`. */
export function hashOf(view: MapViewState, selected: string | null): string {
  const head = view.kind === "service" ? view.id : view.kind;
  return selected ? `${head}/${encodeURIComponent(selected)}` : head;
}
export function parseHash(map: CodeMap, hash: string): { view: MapViewState; selected: string | null } | null {
  const h = hash.replace(/^#/, "");
  if (!h || !hasSystem(map)) return null;
  const cut = h.indexOf("/");
  const head = cut < 0 ? h : h.slice(0, cut);
  let selected: string | null = null;
  if (cut >= 0) {
    try {
      selected = decodeURIComponent(h.slice(cut + 1)) || null;
    } catch {
      selected = null;
    }
  }
  if (selected && !nodeById(map, selected) && !map.services.some((s) => s.id === selected)) selected = null;
  const view: MapViewState = head === "system" ? { kind: "system" } : head === "all" ? { kind: "all" } : { kind: "service", id: head };
  return { view: checkView(map, view), selected };
}

// ── service scope ──

/** Areas that are shared libraries in a system of services: code no app service is bound to. */
function libraryAreas(map: CodeMap): Set<string> {
  if (!hasSystem(map)) return new Set();
  const bound = new Set(map.services.flatMap((s) => (s.kind === "app" ? s.areas : [])));
  return new Set(map.areas.filter((a) => !bound.has(a)));
}

/** Library area → app services whose code uses it (imports or calls into it), plus the one it is drawn under. */
function importersOf(map: CodeMap, libs: Set<string>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if (!libs.size) return out;
  const byId = indexOf(map).node;
  for (const n of map.nodes) if (libs.has(n.area) && n.service) out.set(n.area, (out.get(n.area) ?? new Set()).add(n.service));
  for (const e of map.edges) {
    if (e.kind !== "imports" && e.kind !== "calls") continue;
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b || !libs.has(b.area) || libs.has(a.area) || !a.service) continue;
    out.set(b.area, (out.get(b.area) ?? new Set()).add(a.service));
  }
  return out;
}

/** Node ids drawn inside one service: its own, the shared libraries it uses, and the outside companies it talks to. */
export function scopeOf(map: CodeMap, serviceId: string): Set<string> {
  const libs = libraryAreas(map);
  const importers = importersOf(map, libs);
  const ids = new Set<string>();
  for (const n of map.nodes) {
    // A service's card as a whole (svc-int:, the far end of a request with no path) is drawn in its callers' lanes, not its own.
    if (n.service === serviceId && !n.internal) ids.add(n.id);
    else if (libs.has(n.area) && importers.get(n.area)?.has(serviceId)) ids.add(n.id);
  }
  const byId = indexOf(map).node;
  for (const e of map.edges) {
    const other = ids.has(e.from) ? byId.get(e.to) : ids.has(e.to) ? byId.get(e.from) : undefined;
    if (other && other.layer === "external" && !other.internal && !other.service) ids.add(other.id);
  }
  return ids;
}

function serviceName(map: CodeMap, id: string | undefined): string {
  return (id && map.services.find((s) => s.id === id)?.name) || id || "another";
}

// ── search in the find box ──

/** Services a query names by name, hostname or env setting (only asked in a system of services). */
function servicesMatching(map: CodeMap, ql: string): Set<string> {
  const out = new Set<string>();
  if (!ql || !hasSystem(map)) return out;
  for (const s of map.services) {
    if (s.name.toLowerCase().includes(ql) || s.hostnames.some((h) => h.toLowerCase().includes(ql)) || s.devHosts.some((h) => h.toLowerCase().includes(ql))) out.add(s.id);
  }
  return out;
}

// ── lanes (all + service) ──

interface Visible {
  nodes: MapNode[];
  edges: MapEdge[];
  nodeSet: Set<string>;
  focusEdges: Set<string> | null;
  scope: Set<string> | null;
}

export function visibleFor(map: CodeMap, view: MapViewState, filter: Filter = {}): Visible {
  const { focus = null, query = "", showImports = false } = filter;
  let ids: Set<string> | null = null;
  let edgeIds: Set<string> | null = null;
  if (focus) {
    const n = neighbourhood(map, focus, 2, showImports);
    ids = n.nodes;
    edgeIds = n.edges;
  }
  const scope = view.kind === "service" && hasSystem(map) ? scopeOf(map, view.id) : null;
  const ql = query.trim().toLowerCase();
  const svcHits = servicesMatching(map, ql);
  const matches = (n: MapNode) =>
    n.name.toLowerCase().includes(ql) || !!n.file?.toLowerCase().includes(ql) || (svcHits.size > 0 && ((!!n.service && svcHits.has(n.service)) || !!n.path?.toLowerCase().includes(ql)));
  const nodes = map.nodes.filter((n) => (!scope || scope.has(n.id)) && (!ids || ids.has(n.id)) && (!ql || matches(n)));
  const nodeSet = new Set(nodes.map((n) => n.id));
  const edges = map.edges.filter((e) => nodeSet.has(e.from) && nodeSet.has(e.to) && (!edgeIds || edgeIds.has(e.id)) && (showImports || focus || e.kind !== "imports"));
  return { nodes, edges, nodeSet, focusEdges: edgeIds, scope };
}

interface Portal {
  id: string;
  layer: Layer;
  target: string;
  edge: MapEdge;
  name: string;
  sub: string;
}

/** Stub cards for the far end of every arrow that leaves the service, and badges for arrows that come in.
 * One stub per far end: several lines that call the same door share its card (named after the first edge). */
function portalsFor(map: CodeMap, v: Visible): { portals: Portal[]; badges: Map<string, string>; ends: Map<string, string> } {
  const byTarget = new Map<string, Portal>();
  const ends = new Map<string, string>(); // edge id → portal id
  const add = (p: Portal) => {
    const had = byTarget.get(p.target);
    if (!had) byTarget.set(p.target, p);
    ends.set(p.edge.id, (had ?? p).id);
  };
  const inbound = new Map<string, Set<string>>();
  const shared = new Map<string, Set<string>>();
  const libs = libraryAreas(map);
  const byId = indexOf(map).node;
  for (const e of map.edges) {
    const fromIn = v.nodeSet.has(e.from);
    const toIn = v.nodeSet.has(e.to);
    if (fromIn === toIn) continue;
    if (v.focusEdges && !v.focusEdges.has(e.id)) continue;
    const far = byId.get(fromIn ? e.to : e.from);
    const here = fromIn ? e.from : e.to;
    if (!far || v.scope?.has(far.id)) continue; // hidden by the find box or focus, not another service
    const farSvc = far.service;
    const out = fromIn;
    switch (e.kind) {
      case "calls-route":
      case "calls-rpc":
        if (out) {
          const s = serviceName(map, farSvc);
          add({ id: `portal:${e.id}`, layer: "api", target: far.id, edge: e, name: `→ ${s} · ${far.name}`, sub: `door in the ${s} service · click to jump` });
        } else inbound.set(here, (inbound.get(here) ?? new Set()).add(serviceName(map, farSvc)));
        break;
      case "reads":
      case "writes":
        if (out && far.kind === "table") add({ id: `portal:${e.id}`, layer: "data", target: far.id, edge: e, name: far.name, sub: `shared with ${serviceName(map, farSvc)} · click to jump` });
        else if (!out) shared.set(here, (shared.get(here) ?? new Set()).add(serviceName(map, farSvc)));
        break;
      case "publishes":
      case "consumes":
        if (far.kind === "channel") add({ id: `portal:${e.id}`, layer: "external", target: far.id, edge: e, name: far.name, sub: `${far.tech ?? "queue or topic"} · click to jump` });
        break;
      case "uses-service":
        if (out && far.internal) {
          const app = map.services.find((s) => s.id === far.service)?.kind === "app";
          add({ id: `portal:${e.id}`, layer: "external", target: far.id, edge: e, name: far.name, sub: app ? "another service in this system · click to jump" : "I can't see this code — add its folder" });
        }
        break;
    }
  }
  const badges = new Map<string, string>();
  for (const [id, s] of inbound) badges.set(id, `← called by ${[...s].join(", ")}`);
  for (const [id, s] of shared) badges.set(id, `shared with ${[...s].join(", ")}`);
  for (const n of v.nodes) if (libs.has(n.area) && !badges.has(n.id)) badges.set(n.id, `shared library ${n.area}`);
  return { portals: [...byTarget.values()], badges, ends };
}

function layoutLanes(map: CodeMap, view: MapViewState, filter: Filter): Layout {
  const v = visibleFor(map, view, filter);
  const inService = view.kind === "service" && hasSystem(map);
  const { portals, badges, ends } = inService ? portalsFor(map, v) : { portals: [], badges: new Map<string, string>(), ends: new Map<string, string>() };
  const nodes: LaidNode[] = [];
  let x = 0;
  for (const base of LANES) {
    const lane = inService && base.layer === "external" ? SERVICE_OUTSIDE_LANE : base;
    const inLane = v.nodes.filter((n) => n.layer === lane.layer).sort((a, b) => a.area.localeCompare(b.area) || a.name.localeCompare(b.name));
    const stubs = portals.filter((p) => p.layer === lane.layer).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const total = inLane.length + stubs.length;
    const cols = Math.max(1, Math.min(3, Math.ceil(total / PER_COLUMN)));
    const rows = Math.ceil(total / cols) || 1;
    nodes.push({ id: `lane:${lane.layer}`, type: "lane", x, y: -60, title: lane.title, hint: lane.hint, count: inLane.length, layer: lane.layer });
    // Cards stack down each column; a table that lists its columns is taller than the rest.
    const colY: number[] = [];
    const place = (i: number, h: number) => {
      const col = Math.floor(i / rows);
      const y = colY[col] ?? 0;
      colY[col] = y + h + 10;
      return { x: x + col * GAP_X, y };
    };
    inLane.forEach((n, i) => {
      const badge = badges.get(n.id);
      nodes.push({ id: n.id, type: "card", ...place(i, cardHeight(n)), node: n, ...(badge ? { badge } : {}) });
    });
    stubs.forEach((p, j) => {
      nodes.push({ id: p.id, type: "portal", ...place(inLane.length + j, CARD_H), layer: p.layer, target: p.target, edgeId: p.edge.id, name: p.name, sub: p.sub });
    });
    x += cols * GAP_X - (GAP_X - CARD_W) + LANE_GAP;
  }
  const edges: LaidEdge[] = v.edges.map((e) => ({ id: e.id, type: "edge", source: e.from, target: e.to, edge: e }));
  const edgeById = indexOf(map).edge;
  for (const [edgeId, portal] of ends) {
    const e = edgeById.get(edgeId)!;
    const fromIn = v.nodeSet.has(e.from);
    edges.push({ id: e.id, type: "edge", source: fromIn ? e.from : portal, target: fromIn ? portal : e.to, edge: e });
  }
  return { nodes, edges };
}

// ── the system view ──

const FLOW: ReadonlySet<EdgeKind> = new Set(["calls-route", "calls-rpc", "publishes", "consumes", "uses-service"]);

export function groupOf(kind: EdgeKind): LinkGroup {
  switch (kind) {
    case "publishes":
    case "consumes":
      return "message";
    case "reads":
    case "writes":
    case "defines":
      return "data";
    case "depends-on":
      return "declared";
    case "proxies":
      return "proxies";
    default:
      return "request";
  }
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function linkLabel(map: CodeMap, links: ServiceLink[]): string {
  const edgeOf = indexOf(map).edge;
  const parts: string[] = [];
  let guesses = 0;
  let arrows = 0;
  const count = (kinds: EdgeKind[]) => links.filter((l) => kinds.includes(l.kind)).reduce((s, l) => s + l.count, 0);
  const req = count(["calls-route", "uses-service"]);
  if (req) parts.push(plural(req, "request"));
  const rpc = count(["calls-rpc"]);
  if (rpc) parts.push(plural(rpc, "gRPC call"));
  const chans = [...new Set(links.filter((l) => l.via && (l.kind === "publishes" || l.kind === "consumes")).map((l) => nodeById(map, l.via!)?.name ?? l.via!))];
  if (chans.length) parts.push(`messages via ${chans.join(", ")}`);
  const reads = count(["reads"]);
  if (reads) parts.push(plural(reads, "read"));
  const writes = count(["writes"]);
  if (writes) parts.push(plural(writes, "write"));
  if (links.some((l) => l.kind === "proxies")) parts.push("forwards");
  for (const l of links) {
    if (l.kind === "publishes" || l.kind === "consumes") continue; // the channel link is a guess as a whole, not per edge
    for (const id of l.edgeIds) {
      arrows++;
      if (edgeOf.get(id)?.confidence === "likely") guesses++;
    }
  }
  // All of them guesses: the dashed line and dashed pill already say so (the legend's "guess"),
  // so the label stays short ("278 requests", not "278 requests · 278 guesses").
  if (guesses && guesses < arrows) parts.push(plural(guesses, "guess", "guesses"));
  // Solid arrows that rest on the user's answer are counted apart from the ones the code proves.
  const told = toldOf(map, links);
  if (told.solid) parts.push(`${told.solid} you told WalkMyCode`);
  return parts.join(" · ");
}

/** The arrows behind a link that rest on what the user told WalkMyCode (`solid`: no guess besides),
 * and a sentence naming the answers, for the pill's hover text. */
export function toldOf(map: CodeMap, links: ServiceLink[]): { solid: number; text?: string } {
  const edgeOf = indexOf(map).edge;
  let all = 0;
  let solid = 0;
  const answers = new Set<string>();
  for (const l of links) {
    for (const id of l.edgeIds) {
      const e = edgeOf.get(id);
      const told = e?.evidence.filter((v) => v.role === "user") ?? [];
      if (!told.length) continue;
      all++;
      if (e!.confidence === "certain") solid++;
      for (const v of told) answers.add(v.text.replace(/^you told (?:WalkMyCode|Lantern): /, ""));
    }
  }
  if (!all) return { solid };
  return { solid, text: `${plural(all, "arrow")} here ${all === 1 ? "rests" : "rest"} on what you told WalkMyCode (${[...answers].join(", ")}), not on anything the code proves.` };
}

export function layoutSystem(map: CodeMap): Layout {
  const services = map.services;
  const links = map.system.links;
  const byId = new Map(services.map((s) => [s.id, s]));
  const gateways = services.filter((s) => s.kind === "gateway");
  const apps = services.filter((s) => s.kind === "app");
  // Columns by flow rank: front doors first; services are already in flow order, so a caller is ranked before what it calls.
  const rank = new Map<string, number>();
  for (const g of gateways) rank.set(g.id, 0);
  const start = gateways.length ? 1 : 0;
  for (const s of apps) {
    let r = start;
    for (const l of links) if (l.to === s.id && FLOW.has(l.kind) && rank.has(l.from) && byId.get(l.from)?.kind === "app") r = Math.max(r, rank.get(l.from)! + 1);
    rank.set(s.id, r);
  }
  const last = Math.max(start - 1, ...apps.map((s) => rank.get(s.id)!), -1);
  const infraCol = last + 1;
  for (const s of services) if (!rank.has(s.id)) rank.set(s.id, infraCol);

  const outside = map.nodes.filter((n) => n.kind === "service" && n.layer === "external" && !n.internal).sort((a, b) => a.name.localeCompare(b.name));
  // Infrastructure and placeholders share the column after the apps; skip it when there are none.
  const outsideCol = services.some((s) => rank.get(s.id) === infraCol) ? infraCol + 1 : infraCol;

  const columns = new Map<number, string[]>();
  for (const s of services) columns.set(rank.get(s.id)!, [...(columns.get(rank.get(s.id)!) ?? []), s.id]);
  outside.forEach((n, i) => {
    const col = outsideCol + Math.floor(i / OUTSIDE_PER_COL);
    columns.set(col, [...(columns.get(col) ?? []), n.id]);
  });
  // Cards of one group sit together in their column (a group's first card keeps its place);
  // with no groups the order is untouched.
  const boxOf = new Map(services.filter((s) => s.group).map((s) => [s.id, s.group!]));
  if (boxOf.size) {
    for (const [col, ids] of columns) {
      const firstAt = new Map<string, number>();
      ids.forEach((id, i) => {
        const g = boxOf.get(id);
        if (g && !firstAt.has(g)) firstAt.set(g, i);
      });
      const rankOf = (id: string, i: number) => (boxOf.has(id) ? firstAt.get(boxOf.get(id)!)! : i);
      columns.set(
        col,
        ids.map((id, i) => ({ id, i, r: rankOf(id, i) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.id),
      );
    }
  }
  const tallest = Math.max(1, ...[...columns.values()].map((c) => c.length));
  const rowH = SVC_H + SVC_ROW_GAP;
  const pos = new Map<string, { x: number; y: number }>();
  for (const [col, ids] of columns) {
    const top = ((tallest - ids.length) * rowH) / 2;
    ids.forEach((id, i) => pos.set(id, { x: col * SVC_COL_GAP, y: top + i * rowH }));
  }

  // Who reads and writes each database, for its "shared by" line.
  const usersOf = new Map<string, Set<string>>();
  for (const l of links) if (l.kind === "reads" || l.kind === "writes") usersOf.set(l.to, (usersOf.get(l.to) ?? new Set()).add(l.from));
  const multiRepo = map.repos.length > 1;

  const nodes: LaidNode[] = [];
  // Group boxes first, so they are drawn behind the cards: one per group per column.
  for (const [col, ids] of [...columns].sort((a, b) => a[0] - b[0])) {
    const byGroup = new Map<string, { x: number; y: number }[]>();
    for (const id of ids) {
      const g = boxOf.get(id);
      if (g) byGroup.set(g, [...(byGroup.get(g) ?? []), pos.get(id)!]);
    }
    for (const [g, ps] of byGroup) {
      const top = Math.min(...ps.map((p) => p.y));
      const bottom = Math.max(...ps.map((p) => p.y));
      nodes.push({ id: `group:${g}@${col}`, type: "group", x: ps[0].x - GROUP_PAD, y: top - GROUP_PAD - GROUP_HEAD, w: SVC_W + 2 * GROUP_PAD, h: bottom - top + SVC_H + 2 * GROUP_PAD + GROUP_HEAD, title: g });
    }
  }
  for (const s of services) {
    const p = pos.get(s.id)!;
    nodes.push({ id: s.id, type: "svc", x: p.x, y: p.y, card: cardFor(map, s, usersOf.get(s.id), multiRepo) });
  }
  for (const n of outside) {
    const p = pos.get(n.id)!;
    nodes.push({ id: n.id, type: "svc", x: p.x, y: p.y, card: { kind: "outside", name: n.name, lines: outsideLines(map, n), openable: false } });
  }

  // One arrow per pair and colour; several kinds of the same colour share it (reads + writes).
  const merged = new Map<string, LinkItem>();
  const put = (l: ServiceLink, to: string) => {
    const group: LinkGroup = byId.has(to) || l.kind !== "uses-service" ? groupOf(l.kind) : "outside";
    const key = `link:${l.from}->${to}|${group}`;
    const m = merged.get(key) ?? { id: key, type: "link" as const, source: l.from, target: to, group, links: [], label: "", confidence: "likely" as Confidence };
    m.links.push(l);
    if (l.confidence === "certain") m.confidence = "certain";
    merged.set(key, m);
  };
  for (const l of links) if (pos.has(l.from) && pos.has(l.to)) put(l, l.to);
  // Outside companies: from the uses-service edges, each one a line of code.
  const outsideLinks = new Map<string, ServiceLink>();
  const edgesById = indexOf(map).node;
  for (const e of map.edges) {
    if (e.kind !== "uses-service") continue;
    const to = edgesById.get(e.to);
    const from = edgesById.get(e.from)?.service;
    if (!to || to.internal || !from || !pos.has(from) || !pos.has(to.id)) continue;
    const id = `uses-service:${from}->${to.id}`;
    const l = outsideLinks.get(id) ?? { id, from, to: to.id, kind: "uses-service" as EdgeKind, confidence: "likely" as Confidence, edgeIds: [], count: 0 };
    if (!l.edgeIds.includes(e.id)) {
      l.edgeIds.push(e.id);
      l.count++;
    }
    if (e.confidence === "certain") l.confidence = "certain";
    outsideLinks.set(id, l);
  }
  for (const l of outsideLinks.values()) put(l, l.to);
  const edges: LaidEdge[] = [...merged.values()].map((m) => {
    const told = m.group === "declared" ? undefined : toldOf(map, m.links).text;
    return { ...m, label: m.group === "declared" ? "" : linkLabel(map, m.links), ...(told ? { told } : {}) };
  });
  return { nodes, edges };
}

/** An outside card's two lines: another company's API, or a public address one of the apps may be ("Whose address is this?"). */
function outsideLines(map: CodeMap, n: MapNode): string[] {
  const h = map.publicHosts?.find((x) => x.host === n.name.replace(/:(80|443)$/, ""));
  if (h?.answer && !h.answer.service) return ["outside service", "you said: not one of yours"];
  if (h?.guess && !h.answer && !h.config) return ["an address on the internet", "is it one of yours?"];
  return ["outside service", "another company's API"];
}

function cardFor(map: CodeMap, s: ServiceDef, users: Set<string> | undefined, multiRepo: boolean): SvcCard {
  const routes = map.nodes.filter((n) => n.service === s.id && (n.kind === "route" || n.kind === "rpc")).length;
  const tables = map.nodes.filter((n) => n.service === s.id && n.kind === "table").length;
  const badge = multiRepo && s.repo ? s.repo : undefined;
  const base = { name: s.name, declared: s.declared, badge, openable: isOpenable(s) };
  const usedBy = [...(users ?? [])].map((id) => serviceName(map, id));
  switch (s.kind) {
    case "app":
      return { ...base, kind: "app", lines: [s.framework ?? "app", `${plural(routes, "route")} · ${plural(tables, "table")}`, "why is this a service?"] };
    case "db":
      return { ...base, kind: "db", lines: ["database", usedBy.length > 1 ? `shared by ${usedBy.join(", ")}` : usedBy.length ? `used by ${usedBy[0]}` : s.image ?? ""] };
    case "cache":
      return { ...base, kind: "cache", lines: ["cache", usedBy.length ? `used by ${usedBy.join(", ")}` : s.image ?? ""] };
    case "broker": {
      const chans = map.nodes.filter((n) => n.kind === "channel" && n.service === s.id).map((n) => n.name);
      return { ...base, kind: "broker", lines: ["message broker", chans.length ? plural(chans.length, "channel") : s.image ?? ""], title: chans.length ? `Channels: ${chans.join(", ")}` : undefined };
    }
    case "gateway":
      return { ...base, kind: "gateway", lines: ["gateway", "passes requests on"] };
    default:
      if (s.setting) return { ...base, kind: "placeholder", lines: [`wherever ${s.setting} points`, "I can't see this code — add its folder"], title: `Nothing in the repo gives ${s.setting} a value. Add the backend's folder, or answer “Where does this point?”` };
      return { ...base, kind: "placeholder", lines: ["one of this system's services", "I can't see this code — add its folder"] };
  }
}

// ── entry point ──

/** Positions for a view. `all` for a monolith is exactly today's picture. */
export function layoutFor(map: CodeMap, view: MapViewState, filter: Filter = {}): Layout {
  if (view.kind === "system" && hasSystem(map)) return layoutSystem(map);
  return layoutLanes(map, view.kind === "service" && hasSystem(map) ? view : { kind: "all" }, filter);
}

/** The view to show a node or service in, starting from the current one: stay if it is drawn here,
 * else its service's lanes, else the system view. */
export function viewFor(map: CodeMap, id: string, current: MapViewState): MapViewState {
  if (!hasSystem(map)) return { kind: "all" };
  const svc = map.services.find((s) => s.id === id);
  if (svc) return isOpenable(svc) ? { kind: "service", id: svc.id } : { kind: "system" }; // a service: its lanes, or its card
  const n = nodeById(map, id);
  if (!n || current.kind === "all") return current;
  if (current.kind === "service" && scopeOf(map, current.id).has(id)) return current;
  if (n.internal) return { kind: "system" }; // a service whose code is not here is a card on the system view
  const home = map.services.find((s) => s.id === n.service);
  if (isOpenable(home)) return { kind: "service", id: home!.id };
  // A queue, or an outside company: the lanes of a service that uses it (not the one we are in).
  const users = new Set<string>();
  for (const e of map.edges) {
    const other = e.from === id ? e.to : e.to === id ? e.from : null;
    const s = other ? nodeById(map, other)?.service : undefined;
    if (s) users.add(s);
  }
  const here = current.kind === "service" ? current.id : null;
  const next = map.services.find((s) => users.has(s.id) && s.id !== here && isOpenable(s));
  if (next) return { kind: "service", id: next.id };
  return { kind: "system" };
}
