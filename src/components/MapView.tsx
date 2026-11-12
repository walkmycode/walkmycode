"use client";
// The map. Three views of one map (docs/SERVICES.md §7): every lane (pages →
// routes → logic → data → outside), one service's lanes with portals to the
// services it talks to, and the system view with one card per service. Arrows
// only where the parser found evidence. Dashed = a guess.
//
// Speed (docs/PERFORMANCE.md): the cards and arrows handed to React Flow are
// made once per layout and never change on a click. What is selected, lit or
// dimmed lives in a small store (mapHighlight.ts); each card and arrow reads
// its own classes from it, so a click redraws only the few whose classes
// change, and the dimming of the rest is one class on the map's box.
import { createContext, memo, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Background,
  BaseEdge,
  EdgeLabelRenderer,
  Controls,
  getSmoothStepPath,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStoreApi,
  useStore,
  type ReactFlowState,
  type Edge,
  type InternalNode,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { createPortal } from "react-dom";
import "@xyflow/react/dist/style.css";
import type { CodeMap, Layer, MapEdge, MapNode, ServiceLink } from "@/analyzer/types";
import { light } from "@/lib/light";
import { cameraTarget, easeSettle, flyDuration, flyThrough } from "@/lib/flythrough";
import { motionOff } from "@/lib/motion";
import { CARD_H, CARD_W, cardColumns, hasSystem, layoutFor, type EdgeItem, type LinkGroup, type MapViewState, type SvcCard } from "./mapLayout";
import { Highlight, cardPick, edgePick, hiStateOf, linkPick, splitPick, svcPick, type HiState, type Lit } from "./mapHighlight";
import { arrowLength, linearEasing, riderStops } from "./mapTrace";
import { afterResize, askFit, newCamera, placed, type CameraState } from "./mapCamera";

export { layoutFor, defaultView, type MapViewState } from "./mapLayout";
export type { Lit } from "./mapHighlight";

/** The highlight store, and the prefix of this map's arrowhead ids. */
const HiCtx = createContext<{ hi: Highlight; markers: string } | null>(null);
/** One card's or arrow's classes; it redraws only when they change. */
function useHi(pick: (s: HiState) => string): string {
  const { hi } = useContext(HiCtx)!;
  return useSyncExternalStore(
    hi.subscribe,
    () => pick(hi.state),
    () => pick(hi.state),
  );
}
/** Its classes and, when lit, its place in the trace's sweep as `--i` and the gap between
 * lanes as `--hop` (MOTION.md §4.3), on the element itself: set on the map's box, a custom
 * property would restyle every card and arrow under it. */
function useHiAt(pick: (s: HiState) => string): { cls: string; style: React.CSSProperties | undefined } {
  // A lit one's snapshot carries the hop too, so a new trace with a new hop redraws it
  // (and only the lit ones: the crowd's snapshots never change with it).
  const snap = useHi((s) => {
    const p = pick(s);
    return p.includes("|") ? `${p}#${s.timing?.hop ?? 0}` : p;
  });
  const h = snap.indexOf("#");
  const { cls, at } = splitPick(h < 0 ? snap : snap.slice(0, h));
  return { cls, style: at === undefined ? undefined : ({ "--i": at, "--hop": hopVar(Number(snap.slice(h + 1))) } as React.CSSProperties) };
}
const hopVar = (ms: number) => `calc(${ms}ms * var(--m))`;
const markerId = (prefix: string, colour: string) => `${prefix}-${colour.slice(1)}`;

interface Props {
  map: CodeMap;
  view: MapViewState;
  selected: string | null;
  lit: Lit | null;
  focus: string | null;
  showImports: boolean;
  /** Bumped by the page to fit the map on one node after a jump. */
  reveal?: { id: string; at: number } | null;
  onSelect: (id: string | null) => void;
  onEdge: (edge: MapEdge) => void;
  onLinks: (links: ServiceLink[]) => void;
  onFocus: (id: string | null) => void;
  onToggleImports: () => void;
  onView: (view: MapViewState) => void;
  /** A portal was clicked: go to the real node at the other end. */
  onJump: (id: string) => void;
  /** Enter in the find box: open the palette with this text. */
  onPalette?: (q: string) => void;
  /** Bumped by the dock when a hidden map tab is shown again: fit the graph to its box. */
  fit?: number;
}

const EDGE_COLOUR: Record<string, string> = {
  "calls-route": "#f3d77a",
  "calls-rpc": "#f3d77a",
  proxies: "#f3d77a",
  publishes: "#c9a8e0",
  consumes: "#c9a8e0",
  reads: "#a8e0a0",
  writes: "#a8e0a0",
  defines: "#6f9a70",
  "uses-service": "#f2a7a0",
  imports: "#7f7666",
  calls: "#b8ae9c",
  "depends-on": "#5b554c",
};
const GROUP_COLOUR: Record<LinkGroup, string> = {
  request: "#f3d77a",
  message: "#c9a8e0",
  data: "#a8e0a0",
  declared: "#5b554c",
  proxies: "#f3d77a",
  outside: "#f2a7a0",
};
/** Parallel arrows between two cards leave and arrive at different heights. */
const HANDLE_AT: Record<LinkGroup, string> = { message: "20%", request: "40%", outside: "40%", data: "60%", declared: "80%", proxies: "80%" };
const GROUPS = Object.keys(HANDLE_AT) as LinkGroup[];

type CardData = { node: MapNode; badge?: string };
type CardNode = Node<CardData, "card">;
type LaneNode = Node<{ title: string; hint: string; count: number; layer: Layer }, "lane">;
type PortalData = { name: string; sub: string; layer: Layer; target: string };
type PortalNode = Node<PortalData, "portal">;
/** `miss`: the find box names other services (dimmed unless a trace is on). */
type SvcData = { card: SvcCard; miss: boolean };
type SvcNode = Node<SvcData, "svc">;
type GroupNode = Node<{ title: string; w: number; h: number }, "groupbox">;
type LinkEdgeData = { links: ServiceLink[]; group: LinkGroup; confidence: string; label: string; told?: string };

const Card = memo(function Card({ id, data }: NodeProps<CardNode>) {
  const n = data.node;
  const { cls, style } = useHiAt((s) => cardPick(s, id));
  const cols = cardColumns(n);
  const sub = n.kind === "route" ? `${n.area} · ${n.handler ?? n.file?.split("/").pop() ?? ""}` : n.kind === "table" ? (n.columns?.length ? `table · ${n.columns.length} column${n.columns.length === 1 ? "" : "s"}` : "table") : n.kind === "service" ? (n.internal ? "this system's own service" : "outside service") : n.kind === "component" && n.note ? n.note : `${n.area} · ${n.kind}`;
  return (
    <div className={`node ${n.layer}${cls}`} style={style} title={n.file ? `${n.file}:${n.line ?? 1}` : n.name}>
      <div className={`nm${n.kind === "route" ? " mono" : ""}`}>{n.name}</div>
      <div className="sub">{sub}</div>
      {cols.shown.length > 0 && (
        <div className="cols">
          {cols.shown.map((c) => (
            <div key={c.name} className="col">
              <span>{c.name}</span>
              {c.type && <i>{c.type}</i>}
            </div>
          ))}
          {cols.more > 0 && <div className="col more">+{cols.more} more</div>}
        </div>
      )}
      {data.badge && <span className="nbadge">{data.badge}</span>}
    </div>
  );
});
function LaneHead({ data }: NodeProps<LaneNode>) {
  return (
    <div className="lanehead" style={{ ["--lane" as string]: `var(--lane-${data.layer})` }}>
      <b>{data.title}</b> · {data.count}
      <small>{data.hint}</small>
    </div>
  );
}
const Portal = memo(function Portal({ data }: NodeProps<PortalNode>) {
  const { cls, style } = useHiAt((s) => cardPick(s, data.target));
  return (
    <div className={`node portal ${data.layer}${cls}`} style={style} title="In another service: click to go there">
      <div className={`nm${data.layer === "api" ? " mono" : ""}`}>{data.name}</div>
      <div className="sub">{data.sub}</div>
    </div>
  );
});
const Svc = memo(function Svc({ id, data }: NodeProps<SvcNode>) {
  const c = data.card;
  const { cls, style } = useHiAt((s) => svcPick(s, id));
  return (
    <div
      className={`svc ${c.kind}${c.declared ? " declared" : ""}${data.miss ? " miss" : ""}${cls}`}
      style={style}
      title={c.title ?? (c.openable ? "Double-click to open its lanes" : c.name)}
    >
      {GROUPS.map((g) => (
        <Handle key={`in-${g}`} id={`in-${g}`} type="target" position={Position.Left} style={{ top: HANDLE_AT[g] }} />
      ))}
      <div className="nm">{c.name}</div>
      {c.lines.map((l, i) =>
        l === "why is this a service?" ? (
          <div key={i} className="why">
            {l}
          </div>
        ) : (
          <div key={i} className="sub">
            {l}
          </div>
        ),
      )}
      {c.badge && <span className="nbadge">{c.badge}</span>}
      {GROUPS.map((g) => (
        <Handle key={`out-${g}`} id={`out-${g}`} type="source" position={Position.Right} style={{ top: HANDLE_AT[g] }} />
      ))}
    </div>
  );
});
/** The labelled box behind the cards of one group (a Backstage `system`): drawn, never
 * clicked; clicks go through it to the map. */
function GroupBox({ data }: NodeProps<GroupNode>) {
  return (
    <div className="groupbox" style={{ width: data.w, height: data.h }}>
      <span>{data.title}</span>
    </div>
  );
}
const nodeTypes = { card: Card, lane: LaneHead, portal: Portal, svc: Svc, groupbox: GroupBox };

const LIT = "#f3d77a";

/** One arrow on the lanes. Its colour, width and dashes follow its own classes;
 * whether it is faded follows the mode on the map's box (CSS). Lit, it also
 * carries the stroke that draws it in (MOTION.md §4.3), timed by `--i`. */
const LanePath = memo(function LanePath({ edge: e, d, onEdge, top }: { edge: MapEdge; d: string; onEdge: (e: MapEdge) => void; top: SVGGElement | null }) {
  const { markers } = useContext(HiCtx)!;
  const { cls: hi, style } = useHiAt((s) => edgePick(s, e.id));
  const isLit = hi.includes("lit");
  const near = hi.includes("near");
  const colour = isLit ? LIT : (EDGE_COLOUR[e.kind] ?? "#7f7666");
  const arrow = (
    <g className="react-flow__edge selectable" data-id={e.id} onClick={() => onEdge(e)} style={style}>
      <path
        d={d}
        fill="none"
        className={`react-flow__edge-path ledge${e.kind === "imports" ? " imports" : ""}${hi}`}
        markerEnd={`url(#${markerId(markers, colour)})`}
        style={{ stroke: colour, strokeWidth: isLit ? 2.5 : near ? 2 : 1.2, strokeDasharray: e.confidence === "likely" ? "6 4" : undefined }}
      />
      {isLit && <path d={d} pathLength={1} className="trace-draw" />}
      <path d={d} fill="none" strokeOpacity={0} strokeWidth={20} className="react-flow__edge-interaction" />
    </g>
  );
  // Lit and neighbouring arrows are drawn over the rest, in the layer on top.
  return hi && top ? createPortal(arrow, top) : arrow;
});

type Anchor = [number, number];
/** Where an arrow leaves (right) or reaches (left) a card: its handle, as React Flow measures it,
 * or the card's own box before it is measured. */
function anchor(n: InternalNode | undefined, side: "source" | "target"): Anchor | null {
  if (!n) return null;
  const p = n.internals.positionAbsolute;
  const h = n.internals.handleBounds?.[side]?.[0];
  if (h) return side === "source" ? [p.x + h.x + h.width, p.y + h.y + h.height / 2] : [p.x + h.x, p.y + h.y + h.height / 2];
  const w = n.measured.width ?? n.width ?? CARD_W;
  const ht = n.measured.height ?? n.height ?? CARD_H;
  return side === "source" ? [p.x + w + 3, p.y + ht / 2] : [p.x - 3, p.y + ht / 2];
}

/** Zoomed out past this, the cards' drop shadows are a pixel or two wide: they are left off (MapView `far`). */
const FAR_ZOOM = 0.5;
const isFar = (s: ReactFlowState) => s.transform[2] < FAR_ZOOM;
/** Marks the map's box `far` while zoomed out; redrawn only when the zoom crosses the line. */
function FarClass({ box }: { box: React.RefObject<HTMLDivElement | null> }) {
  const far = useStore(isFar);
  useLayoutEffect(() => {
    box.current?.classList.toggle("far", far);
  }, [box, far]);
  return null;
}

const edgeLayer = (s: ReactFlowState) => s.domNode?.querySelector<HTMLElement>(".react-flow__edges") ?? null;
const storeNodes = (s: ReactFlowState) => s.nodes;

type Geo = { d: string; s: Anchor; t: Anchor };

/** Every arrow on the lanes in one SVG under the cards, rather than one React Flow edge
 * (its own <svg> and store subscription) per arrow: pan and zoom move them with the
 * viewport for free. Paths are worked out again only when the cards are measured.
 *
 * The rider (MOTION.md §4.3): one dot in the layer on top that walks the trace's
 * chain along a CSS motion path made of the chain's arrows joined by a straight run
 * under each card. A `linear()` easing keeps it one hop per arrow whatever their
 * lengths; its duration is the chain's hops, so it follows the trace's hop and --m. It is
 * keyed per trace so a second trace starts it again.
 *
 * A fly-through hop (src/lib/flythrough.ts) is a chain of one arrow, ridden backwards when
 * the hop goes against it; a hop between two cards the map does not join is a dashed gap,
 * never an arrow. */
function LaneEdges({
  edges,
  measured,
  onEdge,
  chain,
  hop,
  traceSeq,
  onRideEnd,
  reverse = false,
  gap = null,
}: {
  edges: EdgeItem[];
  measured: number;
  onEdge: (e: MapEdge) => void;
  chain: string[];
  hop: number;
  traceSeq: number;
  onRideEnd: (nodeId: string) => void;
  reverse?: boolean;
  /** The two cards of a gap, as React Flow ids. */
  gap?: [string, string] | null;
}) {
  const store = useStoreApi();
  // React Flow takes new cards in an effect after this renders: follow its own list, not the layout's.
  const placed = useStore(storeNodes);
  const paths = useMemo(() => {
    void placed; // recomputed when React Flow has the cards,
    void measured; // and when it has measured them; both read from the store below
    const lookup = store.getState().nodeLookup;
    return edges.map((it): Geo | null => {
      const s = anchor(lookup.get(it.source), "source");
      const t = anchor(lookup.get(it.target), "target");
      return s && t ? { d: getSmoothStepPath({ sourceX: s[0], sourceY: s[1], sourcePosition: Position.Right, targetX: t[0], targetY: t[1], targetPosition: Position.Left })[0], s, t } : null;
    });
  }, [edges, placed, measured, store]);
  const [top, setTop] = useState<SVGGElement | null>(null);

  const ride = useMemo(() => {
    if (!chain.length) return null;
    const at = new Map<string, number>();
    edges.forEach((it, i) => at.set(it.id, i));
    const segs: { g: Geo; end: string }[] = [];
    for (const id of chain) {
      const i = at.get(id);
      const g = i === undefined ? null : paths[i];
      if (g) segs.push({ g, end: reverse ? edges[i!].source : edges[i!].target });
    }
    if (!segs.length) return null;
    let d = "";
    const lengths: number[] = [];
    const crossings: number[] = [];
    segs.forEach(({ g }, i) => {
      d += (i ? " " : "") + (i ? g.d.replace(/^\s*M/, "L") : g.d);
      lengths.push(arrowLength(g.s[0], g.s[1], g.t[0], g.t[1]));
      if (i < segs.length - 1) {
        const n = segs[i + 1].g;
        crossings.push(Math.hypot(n.s[0] - g.t[0], n.s[1] - g.t[1]));
      }
    });
    return { d, easing: linearEasing(riderStops(lengths, crossings)), hops: segs.length, end: segs[segs.length - 1].end };
  }, [chain, edges, paths, reverse]);

  // A gap: a dashed line between the two cards' facing sides, under nothing that says "arrow".
  const gapLine = useMemo(() => {
    void placed;
    void measured;
    if (!gap) return null;
    const lookup = store.getState().nodeLookup;
    const a = lookup.get(gap[0]);
    const b = lookup.get(gap[1]);
    if (!a || !b) return null;
    const box = (n: InternalNode) => ({ x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w: n.measured.width ?? CARD_W, h: n.measured.height ?? CARD_H });
    const p = box(a);
    const q = box(b);
    const right = q.x >= p.x + p.w;
    const left = p.x >= q.x + q.w;
    const s: Anchor = right ? [p.x + p.w, p.y + p.h / 2] : left ? [p.x, p.y + p.h / 2] : [p.x + p.w / 2, q.y > p.y ? p.y + p.h : p.y];
    const t: Anchor = right ? [q.x, q.y + q.h / 2] : left ? [q.x + q.w, q.y + q.h / 2] : [q.x + q.w / 2, q.y > p.y ? q.y : q.y + q.h];
    return `M${s[0]},${s[1]} L${t[0]},${t[1]}`;
  }, [gap, placed, measured, store]);

  // Into React Flow's own edge layer, which the cards are drawn over.
  const host = useStore(edgeLayer);
  if (!host) return null;
  // The lit and neighbouring arrows are an SVG of their own on top, so a trace's
  // drawing repaints only those few, not all the arrows of the map.
  return createPortal(
    <>
      <svg className="lane-edges">{edges.map((it, i) => (paths[i] ? <LanePath key={it.id} edge={it.edge} d={paths[i]!.d} onEdge={onEdge} top={top} /> : null))}</svg>
      <svg className="lane-edges">
        <g ref={setTop} />
        {gapLine && <path key={`gap-${traceSeq}`} className="fly-gap" d={gapLine} />}
        {ride && (
          <circle
            key={traceSeq}
            className="trace-dot"
            r={4}
            style={{ offsetPath: `path("${ride.d}")`, animationDuration: `calc(${ride.hops} * ${hopVar(hop)})`, animationTimingFunction: ride.easing, animationDirection: reverse ? "reverse" : undefined }}
            onAnimationEnd={() => onRideEnd(ride.end)}
          />
        )}
      </svg>
    </>,
    host,
  );
}

/** One arrow between services on the system view, with its label. */
const LinkEdge = memo(function LinkEdge({ data, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }: EdgeProps<Edge<LinkEdgeData, "link">>) {
  const { markers } = useContext(HiCtx)!;
  const d = data!;
  const edgeIds = useMemo(() => d.links.map((l) => l.edgeIds), [d.links]);
  const { cls: hi, style } = useHiAt((s) => linkPick(s, edgeIds));
  const [path, labelX, labelY] = useMemo(() => getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }), [sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition]);
  const isLit = hi !== "";
  const declared = d.group === "declared";
  const dotted = declared || d.group === "proxies";
  const colour = isLit ? LIT : GROUP_COLOUR[d.group];
  // The label is a pill in the layer above every arrow (EdgeLabelRenderer):
  // inside the arrow's own svg any arrow drawn later would strike through it.
  // It hangs just under the line (whole pixels, so its text stays sharp).
  return (
    <>
      <BaseEdge
        path={path}
        className={`sedge${declared ? " declared" : ""}${hi}`}
        markerEnd={`url(#${markerId(markers, colour)})`}
        style={{ ...style, stroke: colour, strokeWidth: declared ? 1 : isLit ? 2.8 : 2, strokeDasharray: dotted ? "2 4" : d.confidence === "likely" ? "6 4" : undefined }}
      />
      {isLit && <path d={path} pathLength={1} className="trace-draw" style={style} />}
      {d.label ? (
        <EdgeLabelRenderer>
          <div className={`edge-pill${d.confidence === "likely" ? " guess" : ""}${d.told ? " told" : ""}${isLit ? " lit" : ""}`} style={{ transform: `translate(-50%, 0) translate(${Math.round(labelX)}px, ${Math.round(labelY) + 7}px)`, maxWidth: Math.max(72, Math.round(Math.abs(targetX - sourceX)) - 20) }} title={[...d.links.map((l) => l.note), d.told].filter(Boolean).join(" ") || undefined}>
            {d.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
});
const edgeTypes = { link: LinkEdge };
const PRO = { hideAttribution: true };
const NO_CHAIN: string[] = [];
/** A number per trace (per `lit` object), so the rider is keyed afresh for each one. */
const traceSeqs = new WeakMap<Lit, number>();
let traceCount = 0;
function traceSeqOf(lit: Lit): number {
  let n = traceSeqs.get(lit);
  if (n === undefined) traceSeqs.set(lit, (n = ++traceCount));
  return n;
}
const MINI_STYLE = { background: "#1a1613" };
const miniColour = (n: Node) =>
  n.type === "groupbox" ? "transparent" : n.type === "svc" ? `var(--svc-${(n.data as SvcData).card.kind})` : n.type === "portal" ? `var(--lane-${(n.data as PortalData).layer})` : `var(--lane-${(n.data as CardData)?.node?.layer ?? "logic"})`;

/** Every arrowhead colour, drawn once (React Flow's own markers are per edge object). */
const MARKER_COLOURS = [...new Set([LIT, ...Object.values(EDGE_COLOUR), ...Object.values(GROUP_COLOUR), "#7f7666"])];
function Arrowheads({ prefix }: { prefix: string }) {
  return (
    <svg aria-hidden="true" style={{ position: "absolute", width: 0, height: 0 }}>
      <defs>
        {MARKER_COLOURS.map((c) => (
          <marker key={c} id={markerId(prefix, c)} className="react-flow__arrowhead" markerWidth="14" markerHeight="14" viewBox="-10 -10 20 20" markerUnits="strokeWidth" orient="auto-start-reverse" refX="0" refY="0">
            <polyline className="arrowclosed" style={{ strokeWidth: 1, stroke: c, fill: c }} strokeLinecap="round" strokeLinejoin="round" points="-5,-4 0,0 -5,4 -5,-4" />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

function Inner({ map, view, selected, lit, focus, showImports, reveal, fit = 0, onSelect, onEdge, onLinks, onFocus, onToggleImports, onView, onJump, onPalette }: Props) {
  const { fitView, setCenter, setViewport } = useReactFlow();
  const store = useStoreApi();
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const isSystem = view.kind === "system" && hasSystem(map);
  const viewKey = view.kind === "service" ? view.id : view.kind;

  const layout = useMemo(() => layoutFor(map, view, { focus, query: q, showImports }), [map, view, focus, q, showImports]);

  // The cards and arrows: made when the layout changes, never on a click. A card drawn
  // before keeps the size React Flow measured, so it stays on screen while the new layout is
  // measured: React Flow hides an unmeasured card, and when a second layout came before the
  // first was measured it never measured them again (the whole map went blank).
  const { rfNodes, rfEdges, laneEdges } = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const drawnBefore = store.getState().nodeLookup;
    const rfNodes: (CardNode | LaneNode | PortalNode | SvcNode | GroupNode)[] = [];
    for (const it of layout.nodes) {
      const was = drawnBefore.get(it.id)?.measured;
      const position = { x: it.x, y: it.y };
      if (it.type === "lane") {
        rfNodes.push({ id: it.id, type: "lane", position, data: { title: it.title, hint: it.hint, count: it.count, layer: it.layer }, draggable: false, selectable: false, connectable: false });
      } else if (it.type === "card") {
        rfNodes.push({ id: it.id, type: "card", position, data: { node: it.node, ...(it.badge ? { badge: it.badge } : {}) }, connectable: false });
      } else if (it.type === "portal") {
        rfNodes.push({ id: it.id, type: "portal", position, data: { name: it.name, sub: it.sub, layer: it.layer, target: it.target }, connectable: false });
      } else if (it.type === "group") {
        rfNodes.push({ id: it.id, type: "groupbox", position, data: { title: it.title, w: it.w, h: it.h }, draggable: false, selectable: false, connectable: false, focusable: false, zIndex: -1, style: { pointerEvents: "none" } });
      } else {
        const miss = !!ql && !it.card.name.toLowerCase().includes(ql) && !map.services.find((s) => s.id === it.id)?.hostnames.some((h) => h.toLowerCase().includes(ql));
        rfNodes.push({ id: it.id, type: "svc", position, data: { card: it.card, miss }, connectable: false });
      }
      if (was?.width && was.height) rfNodes[rfNodes.length - 1].measured = { width: was.width, height: was.height };
    }
    // The system view's arrows go to React Flow (a few dozen, with labels); the lanes' are drawn by LaneEdges.
    const rfEdges: Edge[] = [];
    const laneEdges: EdgeItem[] = [];
    for (const it of layout.edges) {
      if (it.type === "edge") laneEdges.push(it);
      else rfEdges.push({ id: it.id, source: it.source, target: it.target, sourceHandle: `out-${it.group}`, targetHandle: `in-${it.group}`, type: "link", data: { links: it.links, group: it.group, confidence: it.confidence, label: it.label, ...(it.told ? { told: it.told } : {}) } });
    }
    return { rfNodes, rfEdges, laneEdges };
  }, [map, layout, q, store]);

  // Bumped (once a frame at most) when React Flow measures cards, so the lane arrows meet them.
  const [measured, setMeasured] = useState(0);
  const measureFrame = useRef(0);
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    if (measureFrame.current || !changes.some((c) => c.type === "dimensions")) return;
    measureFrame.current = requestAnimationFrame(() => {
      measureFrame.current = 0;
      setMeasured((n) => n + 1);
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(measureFrame.current), []);

  // What is selected, lit and dimmed: a small store the cards and arrows read.
  const hiState = useMemo(() => hiStateOf(map, selected, lit, isSystem), [map, selected, lit, isSystem]);
  const [hi] = useState(() => new Highlight(hiState));
  useLayoutEffect(() => {
    hi.set(hiState);
  }, [hi, hiState]);
  const markers = `lt${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const hiCtx = useMemo(() => ({ hi, markers }), [hi, markers]);
  // The chain the rider walks, and a number that changes with every trace so it starts again.
  const chain = hiState.timing?.chain ?? NO_CHAIN;
  const hop = hiState.timing?.hop ?? 0;
  const traceSeq = lit ? traceSeqOf(lit) : 0;

  // What this view draws, by node id: the card itself, or a portal standing for it.
  const drawn = useMemo(() => {
    const ids = new Set<string>();
    const portal = new Map<string, string>();
    for (const n of rfNodes) {
      ids.add(n.id);
      if (n.type === "portal") {
        const t = (n.data as PortalData).target;
        if (!portal.has(t)) portal.set(t, n.id);
      }
    }
    return { ids, portal };
  }, [rfNodes]);
  const drawnRef = useRef(drawn);
  useLayoutEffect(() => {
    drawnRef.current = drawn;
  }, [drawn]);
  const rfIdOf = useCallback((id: string) => (drawnRef.current.ids.has(id) ? id : (drawnRef.current.portal.get(id) ?? null)), []);
  const gapIds = hiState.timing?.gap;
  const gap = useMemo<[string, string] | null>(() => {
    if (!gapIds) return null;
    const a = drawn.ids.has(gapIds.from) ? gapIds.from : drawn.portal.get(gapIds.from);
    const b = drawn.ids.has(gapIds.to) ? gapIds.to : drawn.portal.get(gapIds.to);
    return a && b ? [a, b] : null;
  }, [gapIds, drawn]);

  // The light (MOTION.md §5) follows the selection: it glides to the selected card's
  // left border and hands off to the card's own beacon; a trace sends it to the card
  // the trace started from, and the rider carries it on. With nothing selected or lit
  // it goes home. The store measures once the frame with the ring has been laid out
  // (a click's other flights, the code line's, coalesce with this one).
  const cardEl = useCallback((id: string) => box.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"] .node, .react-flow__node[data-id="${CSS.escape(id)}"] .svc`) ?? null, []);
  const prevSelected = useRef(selected);
  useEffect(() => {
    const picked = prevSelected.current !== selected;
    prevSelected.current = selected;
    const fly = (id: string) => {
      const el = cardEl(id);
      if (el) light.flyTo(el, { at: "left", dx: -4, handoff: true });
      else light.hide();
    };
    if (lit?.origin) fly(lit.origin);
    // A tour step's lights (no origin) are the guide's to lead; a card picked meanwhile still draws it.
    else if (selected && (picked || !lit)) fly(selected);
    else if (!selected && !lit) light.park();
  }, [selected, lit, cardEl]);
  // The rider has reached the end of the chain: the light appears on that card.
  const onRideEnd = useCallback(
    (id: string) => {
      const el = cardEl(id);
      if (el) light.flyTo(el, { from: el, at: "left", dx: -4 });
    },
    [cardEl],
  );

  // The camera, in two states (docs/PERFORMANCE.md): "fitted", the whole view framed by a fit
  // of our own, which a change of the box's size fits again; or "placed", once anyone has
  // moved it (a drag, a click on a card, a glide), when a change of size keeps the middle
  // where it was rather than throwing the user's place away. A fit asked for while the box
  // has no size yet (the dock still laying itself out, a frame not shown yet) waits for one.
  const cam = useRef<CameraState>(newCamera());
  /** Until when a glide of our own is moving the camera. */
  const gliding = useRef(0);
  const sized = useCallback(() => {
    const { width, height } = store.getState();
    const el = box.current;
    return width > 0 && height > 0 && !!el && el.clientWidth > 0 && el.clientHeight > 0;
  }, [store]);
  const fitAll = useCallback(
    (duration?: number) => {
      if (flyThrough.ownsCamera() || !askFit(cam.current, sized())) return;
      void fitView({ padding: 0.15, ...(duration && !motionOff() ? { duration } : {}) });
    },
    [fitView, sized],
  );

  // The fly-through's camera (src/lib/flythrough.ts): React Flow's own setCenter, eased and
  // ~400 ms (none with motion off), framing the card arrived at with the one it came from.
  const glide = useCallback(
    async (id: string, from: string | null, ms: number): Promise<boolean> => {
      const win = (box.current?.ownerDocument.defaultView ?? window) as Window;
      const frame = () => new Promise<void>((r) => win.requestAnimationFrame(() => r()));
      const rect = (n: InternalNode) => ({ x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, width: n.measured.width ?? n.width ?? CARD_W, height: n.measured.height ?? n.height ?? CARD_H });
      // A view switched for this hop draws the card a frame or two later (and a box with no size yet gets one).
      let n: InternalNode | undefined;
      for (let i = 0; i < 60; i++) {
        const r = rfIdOf(id);
        n = r ? store.getState().nodeLookup.get(r) : undefined;
        if (n?.measured.width && sized()) break;
        await frame();
      }
      if (!n?.measured.width || !sized()) return false;
      placed(cam.current);
      const f = from ? rfIdOf(from) : null;
      const fn = f ? store.getState().nodeLookup.get(f) : undefined;
      const { width, height, transform } = store.getState();
      const t = cameraTarget(rect(n), fn?.measured.width ? rect(fn) : null, { width, height, x: transform[0], y: transform[1], zoom: transform[2] });
      if (!t) return true;
      if (!ms) {
        await setCenter(t.x, t.y, { zoom: t.zoom });
        return true;
      }
      // A glide at one zoom moves the viewport as one GPU layer, kept for the rest of the
      // fly-through (made once, so every later hop only composites: measured, a layer made
      // and dropped per hop cost more than it saved). A glide that zooms repaints instead,
      // so nothing is ever drawn blurred. Straight there, not "smooth": its zoom-out-and-in
      // would redraw the whole map every frame.
      const el = box.current;
      el?.classList.toggle("flying", Math.abs(t.zoom - transform[2]) < 1e-3);
      // A resize meanwhile (the code opening beside the map) must not cut the glide short.
      gliding.current = performance.now() + ms + 150;
      try {
        // A glide cut short (the user drags the map) never says it ended: give up waiting after its time.
        await Promise.race([setCenter(t.x, t.y, { zoom: t.zoom, duration: ms, ease: easeSettle, interpolate: "linear" }), new Promise((r) => win.setTimeout(r, ms + 120))]);
      } finally {
        // During a fly-through the layer is made (or kept) now, while the light rides and the
        // code opens, so the next glide only composites; a single jump gives it up at once.
        el?.classList.toggle("flying", flyThrough.state.status === "playing" || flyThrough.state.status === "paused");
      }
      return true;
    },
    [store, setCenter, rfIdOf, sized],
  );
  useEffect(() => {
    return flyThrough.attachCamera({
      has: (id) => !!rfIdOf(id),
      glide,
      land: (id) => {
        // Along an arrow the rider brings the light (onRideEnd); with motion off there is none.
        if (!motionOff() && box.current?.querySelector(".trace-dot")) return;
        const r = rfIdOf(id);
        const el = r ? cardEl(r) : null;
        if (el) light.flyTo(el, { at: "left", dx: -4, handoff: true });
      },
    });
  }, [glide, cardEl, rfIdOf]);

  // The fly-through's layer goes when it ends (the map is painted sharp, and its own again).
  useEffect(
    () =>
      flyThrough.subscribe(() => {
        const s = flyThrough.state.status;
        if (s === "idle" || s === "done") box.current?.classList.remove("flying");
      }),
    [],
  );

  // Fit when what is shown changes (not while a fly-through drives the camera). The first
  // fit of a mount is instant: a map opening should not swoop in from somewhere else.
  const shown = rfNodes.length;
  const firstFit = useRef(true);
  useEffect(() => {
    if (flyThrough.ownsCamera()) return;
    const t = setTimeout(() => {
      fitAll(firstFit.current ? undefined : 300);
      firstFit.current = false;
    }, 30);
    return () => clearTimeout(t);
  }, [focus, q, shown, viewKey, fitAll]);
  // The dock shows a hidden map tab again: fit only if nobody has placed the camera meanwhile.
  useEffect(() => {
    if (fit && cam.current.fitted) fitAll();
  }, [fit, fitAll]);

  // When the map panel itself changes size (a sash, a floating box, a pop-out window, the
  // dock laying itself out at start): a fitted map is fitted again, or the fit that was
  // waiting for a size is made now; a placed camera keeps its middle where it was. The
  // observer is made in the map's own window, so it keeps working after the panel pops out.
  useEffect(() => {
    const el = box.current;
    const win = (el?.ownerDocument.defaultView ?? window) as Window & typeof globalThis;
    const RO = win.ResizeObserver ?? (typeof ResizeObserver === "undefined" ? undefined : ResizeObserver);
    if (!el || !RO) return;
    let frame = 0;
    const ro = new RO(() => {
      win.cancelAnimationFrame(frame);
      // A frame later, so React Flow has read the new size too.
      frame = win.requestAnimationFrame(() => {
        // A fly-through frames the map itself (a new view's breadcrumb can change the box's height mid-glide).
        const a = afterResize(cam.current, el.clientWidth, el.clientHeight, flyThrough.ownsCamera() || performance.now() < gliding.current);
        if (a.kind === "fit") fitAll();
        else if (a.kind === "shift") {
          const [x, y, zoom] = store.getState().transform;
          void setViewport({ x: x + a.dx, y: y + a.dy, zoom });
        }
      });
    });
    ro.observe(el);
    return () => {
      win.cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [fitAll, setViewport, store]);

  // After a jump (portal, palette, tour), fit on the node once it is drawn.
  const revealed = useRef(0);
  useEffect(() => {
    if (!reveal || reveal.at === revealed.current) return;
    const hit = rfNodes.filter((n) => n.id === reveal.id || (n.type === "portal" && (n.data as PortalData).target === reveal.id));
    if (!hit.length) return;
    revealed.current = reveal.at;
    if (flyThrough.ownsCamera()) return;
    const t = setTimeout(() => {
      placed(cam.current);
      void fitView({ nodes: hit.map((n) => ({ id: n.id })), padding: 0.6, duration: 400, maxZoom: 1.2 });
    }, 120);
    return () => clearTimeout(t);
  }, [reveal, rfNodes, fitView]);

  // Handlers that keep their identity, so a click does not redraw every card
  // (React Flow hands them to each card's wrapper).
  const props = useRef({ onSelect, onJump, onFocus, onView, onEdge, onLinks });
  const glideRef = useRef(glide);
  useLayoutEffect(() => {
    props.current = { onSelect, onJump, onFocus, onView, onEdge, onLinks };
    glideRef.current = glide;
  });
  const handlers = useMemo(
    () => ({
      onNodeClick: (_: unknown, n: Node) => {
        // The user has the camera now: a resize keeps their place rather than fitting again.
        placed(cam.current);
        if (n.type === "card" || n.type === "svc") {
          props.current.onSelect(n.id);
          // Zoomed out too far to read it: glide in to the card, at a zoom where it can be read.
          if (store.getState().transform[2] < FAR_ZOOM && !flyThrough.ownsCamera()) void glideRef.current(n.id, null, flyDuration(motionOff()));
        } else if (n.type === "portal") props.current.onJump((n.data as PortalData).target);
      },
      onMoveStart: (e: unknown) => {
        // A drag or a wheel (an event) places the camera; our own fits and glides have none.
        if (e) placed(cam.current);
      },
      onNodeDoubleClick: (_: unknown, n: Node) => {
        if (n.type === "card") props.current.onFocus(n.id);
        else if (n.type === "svc" && (n.data as SvcData).card.openable) props.current.onView({ kind: "service", id: n.id });
      },
      onEdgeClick: (_: unknown, e: Edge) => {
        const d = e.data as { edge?: MapEdge; links?: ServiceLink[] } | undefined;
        if (d?.edge) props.current.onEdge(d.edge);
        else if (d?.links) props.current.onLinks(d.links);
      },
      onPaneClick: () => props.current.onSelect(null),
      onLaneEdge: (e: MapEdge) => props.current.onEdge(e),
      // A fixed dot cannot follow a moving viewport: it hides, and the card's own beacon stays.
      onMove: () => light.hide(),
    }),
    [store],
  );

  const services = hasSystem(map);
  const hasChannels = useMemo(() => map.nodes.some((n) => n.kind === "channel"), [map]);

  return (
    <div ref={box} className={`flowbox hl-${hiState.mode}`} style={{ position: "absolute", inset: 0 }}>
      <div className="maptools">
        <input
          className="field"
          placeholder={isSystem ? "Find a service…" : "Find a page, route, table…"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onPalette) onPalette(q);
          }}
          title="Filter the map; Enter (or Ctrl+K) opens the go-to bar: the map flies there"
        />
        {!isSystem && (
          <button className={`ctl compact${showImports ? " on" : ""}`} onClick={onToggleImports} title="Also draw which files import which">
            imports
          </button>
        )}
        {services && view.kind !== "system" && (
          <button className="ctl compact" onClick={() => onView({ kind: "system" })} title="One card per service">
            system view
          </button>
        )}
        {services && view.kind !== "all" && (
          <button className="ctl compact" onClick={() => onView({ kind: "all" })} title="Every lane of every service on one map">
            show everything
          </button>
        )}
        {focus && !isSystem && (
          <button className="ctl compact" onClick={() => onFocus(null)}>
            ← whole map
          </button>
        )}
        {!focus && selected && !isSystem && (
          <button className="ctl compact" onClick={() => onFocus(selected)}>
            focus on selected
          </button>
        )}
      </div>
      <HiCtx.Provider value={hiCtx}>
      <Arrowheads prefix={markers} />
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={handlers.onNodeClick}
        onNodeDoubleClick={handlers.onNodeDoubleClick}
        onEdgeClick={handlers.onEdgeClick}
        onPaneClick={handlers.onPaneClick}
        onMoveStart={handlers.onMoveStart}
        onMove={handlers.onMove}
        minZoom={0.05}
        maxZoom={2}
        proOptions={PRO}
        nodesConnectable={false}
        // The map is read-only, and React Flow's key hooks listen to the main
        // document only: no delete or box-select keys, in any window.
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        elevateEdgesOnSelect
        onlyRenderVisibleElements={false}
      >
        <FarClass box={box} />
        {laneEdges.length > 0 && (
          <LaneEdges edges={laneEdges} measured={measured} onEdge={handlers.onLaneEdge} chain={chain} hop={hop} traceSeq={traceSeq} onRideEnd={onRideEnd} reverse={!!hiState.timing?.reverse} gap={gap} />
        )}
        <Background color="#2a2622" gap={24} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor={miniColour} maskColor="rgba(0,0,0,.5)" style={MINI_STYLE} />
      </ReactFlow>
      </HiCtx.Provider>
      {isSystem ? (
        <div className="legend">
          <span>
            <i style={{ borderColor: "#f3d77a" }} /> request
          </span>
          <span>
            <i style={{ borderColor: "#c9a8e0" }} /> message
          </span>
          <span>
            <i style={{ borderColor: "#a8e0a0" }} /> table
          </span>
          <span>
            <i style={{ borderColor: "#f2a7a0" }} /> outside
          </span>
          <span>
            <i className="dot" style={{ borderColor: "#8a8173" }} /> declared, not seen in code
          </span>
          <span>
            <i className="dash" /> guess
          </span>
        </div>
      ) : (
        <div className="legend">
          <span>
            <i style={{ borderColor: "#f3d77a" }} /> request
          </span>
          {hasChannels && (
            <span>
              <i style={{ borderColor: "#c9a8e0" }} /> message
            </span>
          )}
          <span>
            <i style={{ borderColor: "#a8e0a0" }} /> table
          </span>
          <span>
            <i style={{ borderColor: "#f2a7a0" }} /> outside
          </span>
          <span>
            <i className="dash" /> guess
          </span>
        </div>
      )}
    </div>
  );
}

export default function MapView(props: Props) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}
