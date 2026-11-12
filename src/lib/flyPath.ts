// Where a fly-through may go (docs/PLAN.md "Fly-through"), worked out from the
// map alone: no AI, no DOM, no React, so the same rules run in the browser, in
// WalkMyCode Lite, on the server's tool list and in the tests.
//
// - checkStep: one hop the guide asks for with fly_step, checked against the map.
//   The node must exist; the arrow it arrives by must be a real edge joining it
//   to the node before. A made-up node or arrow is refused, with what the map
//   does have; two nodes the map does not join at all are a gap, shown as one.
// - findPath / stepsForPath: the real arrows between two cards ("A to B" in the
//   go-to bar, trace_path from Claude).
// - resolveGoTo: what the go-to bar's text means: a card by name ("take me to
//   the login page"), two cards ("cart to orders table"), or a question for the
//   guide ("how does checkout reach the database?").
import type { CodeMap, MapEdge, MapNode } from "@/analyzer/types";
import { indexOf, inOf, outOf, type MapIndex } from "./mapIndex";
import { searchMap, type Hit } from "./mapSearch";

/** One hop as the guide (or other code) asks for it. Loose on purpose: it comes from a model. */
export interface FlyStepInput {
  node?: unknown;
  via_edge?: unknown;
  say?: unknown;
  file?: unknown;
  lines?: unknown;
}

/** One hop, checked: what the map shows for it. */
export interface FlyStep {
  /** The node arrived at, and its card's name. */
  node: string;
  name: string;
  /** The node before (null on the first hop) and its name. */
  from: string | null;
  fromName: string | null;
  /** The real edge travelled; null on the first hop, a stay, or a gap. */
  via: string | null;
  /** Travelled against the arrow (it points from `node` to `from`). */
  reverse: boolean;
  /** The map has no link between `from` and `node`: shown as a gap, never as an arrow. */
  gap: boolean;
  /** The arrow travelled is a guess (matched by pattern, not proven). */
  guess: boolean;
  /** One sentence for the hop (read aloud when the voice is on). */
  say: string;
  /** The code to open: the arrow's own line, the node's code, or what the step cited. */
  file: string | null;
  start: number;
  end: number;
}

export type StepCheck = { ok: true; step: FlyStep; note: string } | { ok: false; error: string };

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const int = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined;
};

/** [start, end] from what a model may send: [12, 20], "12-20", "12", 12. */
export function parseLines(v: unknown): [number, number] | null {
  let a: number | undefined;
  let b: number | undefined;
  if (Array.isArray(v)) {
    a = int(v[0]);
    b = int(v[1]);
  } else if (typeof v === "string") {
    const m = /^\s*(\d+)\s*(?:[-–:,]\s*(\d+))?\s*$/.exec(v);
    if (m) {
      a = int(m[1]);
      b = int(m[2]);
    }
  } else a = int(v);
  if (!a) return null;
  return [a, Math.max(a, b ?? a)];
}

/** At most this many of a node's own lines are lit when a step shows the node itself. */
const NODE_LINES = 25;

/** The order an arrow is picked in when the guide leaves via_edge out: a request before an import. */
const KIND_RANK: Record<string, number> = { "calls-route": 0, "calls-rpc": 0, proxies: 1, publishes: 1, consumes: 1, writes: 2, reads: 2, calls: 3, "uses-service": 3, defines: 4, "depends-on": 5, imports: 6 };
const OUT_VERB: Record<string, string> = {
  imports: "imports",
  calls: "calls",
  "calls-route": "sends a request to",
  reads: "reads",
  writes: "writes to",
  defines: "defines",
  "uses-service": "uses",
  "calls-rpc": "calls",
  publishes: "puts messages on",
  consumes: "picks messages up from",
  "depends-on": "starts after",
  proxies: "passes requests on to",
};
const IN_VERB: Record<string, string> = {
  imports: "is imported by",
  calls: "is called by",
  "calls-route": "is requested by",
  reads: "is read by",
  writes: "is written by",
  defines: "is defined by",
  "uses-service": "is used by",
  "calls-rpc": "is called by",
  publishes: "gets messages from",
  consumes: "has its messages picked up by",
  "depends-on": "starts before",
  proxies: "gets requests passed on by",
};

/** Every edge joining a and b, either way round. */
export function edgesBetween(ix: MapIndex, a: string, b: string): MapEdge[] {
  return [...outOf(ix, a).filter((e) => e.to === b), ...inOf(ix, a).filter((e) => e.from === b)];
}

/** The arrow to travel from `from` when several join the same two nodes: along the arrow,
 * proven, and the most telling kind first (a request before an import). */
function bestEdge(edges: MapEdge[], from: string): MapEdge {
  const rank = (e: MapEdge) => (e.from === from ? 0 : 100) + (e.confidence === "likely" ? 10 : 0) + (KIND_RANK[e.kind] ?? 7);
  return [...edges].sort((a, b) => rank(a) - rank(b))[0];
}

/** The line that proves an arrow: its first code line, else its first line of any kind. */
function proof(e: MapEdge) {
  return e.evidence.find((v) => !v.role || v.role === "code") ?? e.evidence[0];
}

/** One sentence for a hop when the guide gave none: "Cart sends a request to POST /orders." */
export function sayFor(map: CodeMap, from: string, e: MapEdge): string {
  const ix = indexOf(map);
  const name = (id: string) => ix.node.get(id)?.name ?? id;
  const forward = e.from === from;
  return forward ? `${name(e.from)} ${OUT_VERB[e.kind] ?? e.kind} ${name(e.to)}.` : `${name(e.to)} ${IN_VERB[e.kind] ?? e.kind} ${name(e.from)}.`;
}

/** A path as the repo has it: exact, else the one file that ends with it; files known
 * only from the map (the code not loaded here) count too. */
function resolveFile(map: CodeMap, files: Record<string, string> | null, raw: string): string | null {
  const p = raw.replace(/^\.?\/+/, "");
  if (!p) return null;
  const known = (f: string) => (files && files[f] !== undefined) || map.files.some((x) => x.path === f);
  if (known(p)) return p;
  const pool = files && Object.keys(files).length ? Object.keys(files) : map.files.map((f) => f.path);
  const ends = pool.filter((f) => f.endsWith(`/${p}`));
  return ends.length === 1 ? ends[0] : null;
}

/** "Refused: there is no node …", with the closest real ones. */
function unknownNode(map: CodeMap, id: string): string {
  // The name at the end of the id ("authz" of file:lib/authz.ts), shortened until something matches.
  const tail = (id.replace(/^[a-z-]+:/, "").split(/[/#\s]/).filter(Boolean).pop() ?? id).replace(/\.[^.]+$/, "");
  let near: string[] = [];
  for (let q = tail; q.length >= 3 && !near.length; q = q.slice(0, -1)) {
    near = searchMap(map, q)
      .flatMap((g) => g.hits)
      .filter((h) => h.kind === "node")
      .slice(0, 3)
      .map((h) => `${h.label} [${h.id}]`);
  }
  return `Refused: there is no node "${id}" on the map, so nothing was shown. Use query_map to find the real node ids (they look like file:…, route:…, table:…)${near.length ? `; close matches: ${near.join("; ")}` : ""}. Then call fly_step again.`;
}

/** The real arrows between two nodes, either way round, as a short list for a refusal. */
function linksHint(map: CodeMap, a: MapNode, b: MapNode): string {
  const ix = indexOf(map);
  const between = edgesBetween(ix, a.id, b.id);
  if (between.length) return `The arrows between ${a.name} and ${b.name} are: ${between.map((e) => e.id).join(", ")} (or leave via_edge out).`;
  return `The map has no arrow between ${a.name} and ${b.name}; use query_map("${a.id}") to see its links.`;
}

/**
 * One hop of a fly-through, checked against the map. `prev` is the node the
 * fly-through is at (null before the first hop). The note is what the guide is
 * told when the hop is shown.
 */
export function checkStep(map: CodeMap, files: Record<string, string> | null, prev: string | null, input: FlyStepInput): StepCheck {
  const ix = indexOf(map);
  const id = str(input?.node);
  if (!id) return { ok: false, error: "Refused: give node, a node id from query_map (e.g. route:api/orders.ts#POST /orders)." };
  const n = ix.node.get(id);
  if (!n) return { ok: false, error: unknownNode(map, id) };
  const p = prev ? (ix.node.get(prev) ?? null) : null;
  let via: MapEdge | null = null;
  let gap = false;

  if (p && p.id !== n.id) {
    const raw = str(input.via_edge);
    const between = edgesBetween(ix, p.id, n.id);
    if (raw) {
      // An edge id, or just its kind ("calls-route") when exactly that kind joins the two.
      const e = ix.edge.get(raw) ?? between.find((x) => x.kind === raw);
      if (!e) return { ok: false, error: `Refused: "${raw}" is not an arrow on the map, so nothing was shown. ${linksHint(map, p, n)}` };
      if (!(e.from === p.id && e.to === n.id) && !(e.from === n.id && e.to === p.id)) {
        const nm = (x: string) => ix.node.get(x)?.name ?? x;
        return { ok: false, error: `Refused: ${e.id} joins ${nm(e.from)} and ${nm(e.to)}, not ${p.name} and ${n.name}, so nothing was shown. Every hop must follow a real arrow from the node before it. ${linksHint(map, p, n)}` };
      }
      via = e;
    } else if (between.length) via = bestEdge(between, p.id);
    else {
      // Not joined directly: if the map joins them through other nodes, those are the hops to fly.
      const way = findPath(map, p.id, n.id, { maxHops: 4 });
      if (way && way.nodes.length > 2) {
        const names = way.nodes.map((x) => ix.node.get(x)?.name ?? x);
        return {
          ok: false,
          error: `Refused: there is no direct arrow between ${p.name} and ${n.name}, but the map joins them through ${names.join(" → ")}. Fly those hops one at a time: call fly_step for ${names[1]} [${way.nodes[1]}] next.`,
        };
      }
      gap = true;
    }
  }

  // The code to open: what the step cited, else the arrow's own line, else the node's code.
  let file: string | null = null;
  let start = 1;
  let end = 1;
  const rawFile = str(input.file);
  const lines = parseLines(input.lines);
  if (rawFile) {
    file = resolveFile(map, files, rawFile);
    if (!file) return { ok: false, error: `Refused: there is no file "${rawFile}" in the repo, so nothing was shown. Leave file out to show the arrow's own line, or use a path from query_map or list_files.` };
    [start, end] = lines ?? (n.file === file ? [n.line ?? 1, Math.max(n.line ?? 1, n.endLine ?? n.line ?? 1)] : [1, 1]);
  } else if (lines && n.file) {
    file = n.file;
    [start, end] = lines;
  } else if (via) {
    const ev = proof(via);
    if (ev) {
      file = ev.file;
      start = end = ev.line;
    }
  }
  if (!file && n.file) {
    // The node's own code: its first lines (a whole file lit up says nothing).
    file = n.file;
    start = n.line ?? 1;
    end = Math.min(Math.max(start, n.endLine ?? start), start + NODE_LINES - 1);
  }
  const text = file && files ? files[file] : undefined;
  if (text !== undefined) {
    const total = Math.max(1, text.split("\n").length);
    start = Math.min(Math.max(1, start), total);
    end = Math.min(Math.max(start, end), total);
  }

  const say = str(input.say).replace(/\s+/g, " ").slice(0, 400) || (via ? sayFor(map, p!.id, via) : gap ? "" : `${n.name}.`);
  const step: FlyStep = {
    node: n.id,
    name: n.name,
    from: p && p.id !== n.id ? p.id : null,
    fromName: p && p.id !== n.id ? p.name : null,
    via: via?.id ?? null,
    reverse: !!via && via.from !== p?.id,
    gap,
    guess: via?.confidence === "likely",
    say,
    file,
    start,
    end,
  };
  const at = file ? ` (${file}:${start}${end !== start ? `-${end}` : ""})` : "";
  let note: string;
  if (!p) note = `Shown: ${n.name} [${n.id}]${at}.`;
  else if (p.id === n.id) note = `Shown: still at ${n.name}${at}.`;
  else if (gap) note = `Shown as a gap: the map has no link between ${p.name} and ${n.name}, not even through other nodes. Tell the user you can't see how ${p.name} reaches ${n.name}; don't invent the link.`;
  else {
    const ev = proof(via!);
    note = `Shown: ${p.name} → ${n.name} along the ${via!.kind} arrow [${via!.id}]${ev ? ` (${ev.file}:${ev.line})` : ""}${step.reverse ? `, travelled against the arrow (it points from ${n.name} to ${p.name})` : ""}${step.guess ? "; this arrow is a GUESS, say so" : ""}.`;
  }
  return { ok: true, step, note };
}

/** How the arrows may be walked when looking for a path. */
type Dir = "out" | "in" | "both";

/**
 * The real arrows from one card to another: along the arrows first, then
 * against them, then either way; without imports first, then with them. The
 * shortest of the first kind found, or null when they are not joined within
 * `maxHops`.
 */
export function findPath(map: CodeMap, from: string, to: string, o: { maxHops?: number } = {}): { nodes: string[]; edges: string[] } | null {
  const ix = indexOf(map);
  if (!ix.node.has(from) || !ix.node.has(to)) return null;
  if (from === to) return { nodes: [from], edges: [] };
  const max = o.maxHops ?? 8;
  const walk = (dir: Dir, imports: boolean) => {
    const prev = new Map<string, { node: string; edge: string }>();
    const seen = new Set([from]);
    let frontier = [from];
    for (let depth = 0; depth < max && frontier.length; depth++) {
      const next: string[] = [];
      for (const id of frontier) {
        const steps: [string, MapEdge][] = [];
        if (dir !== "in") for (const e of outOf(ix, id)) steps.push([e.to, e]);
        if (dir !== "out") for (const e of inOf(ix, id)) steps.push([e.from, e]);
        // Two arrows to the same card: the more telling one is the hop (a read before a schema's define).
        steps.sort((a, b) => (KIND_RANK[a[1].kind] ?? 7) - (KIND_RANK[b[1].kind] ?? 7));
        for (const [nb, e] of steps) {
          if ((!imports && e.kind === "imports") || seen.has(nb)) continue;
          seen.add(nb);
          prev.set(nb, { node: id, edge: e.id });
          if (nb === to) {
            const nodes = [to];
            const edges: string[] = [];
            for (let at = to; at !== from; ) {
              const s = prev.get(at)!;
              edges.unshift(s.edge);
              nodes.unshift(s.node);
              at = s.node;
            }
            return { nodes, edges };
          }
          next.push(nb);
        }
      }
      frontier = next;
    }
    return null;
  };
  return walk("out", false) ?? walk("out", true) ?? walk("in", false) ?? walk("in", true) ?? walk("both", false) ?? walk("both", true);
}

/** A path given as ids (trace_path, "A to B") as fly_step inputs, each with its own sentence. */
export function stepsForPath(map: CodeMap, nodes: string[], edges: string[] = []): FlyStepInput[] {
  const ix = indexOf(map);
  return nodes.map((node, i) => {
    if (i === 0) return { node };
    const e = edges[i - 1] ? ix.edge.get(edges[i - 1]) : undefined;
    return e ? { node, via_edge: e.id, say: sayFor(map, nodes[i - 1], e) } : { node };
  });
}

// ── the go-to bar's words ──

/** What the go-to bar's text means. */
export type GoTo =
  /** A card, a service or a file, by name: flown to at once, in the browser. */
  | { kind: "hit"; hit: Hit }
  /** Two cards by name ("cart to orders table"): flown along the real arrows between them. */
  | { kind: "path"; from: Hit; to: Hit }
  /** A how / why / what-happens question: the guide answers it by flying the map. */
  | { kind: "ask"; question: string }
  | { kind: "none" };

/** Questions about how things work go to the guide. */
const QUESTION = /^(how|why|what|when|which|who|does|do|is|are|can|could|should|explain|walk me|tell me|trace|follow|show me (how|what|why|where .* (goes|ends|lands)|the way))\b/i;
/** Words about a flow make it a question wherever they are ("checkout to the database flow"). */
const FLOW = /\b(reach|reaches|reached|get to|gets to|talk to|talks to|end up|ends up|happens|happen|flow|flows|lead to|leads to|go through|goes through|handled|handle)\b/i;
/** Ways of saying "take me there", dropped before the name is looked up. */
const LEAD = /^(please\s+)?(take me to|bring me to|go to|goto|jump to|fly to|fly me to|navigate to|open up|open|show me|show|find me|find|where is|where's|where are|locate|look at|zoom to|zoom in on)\s+/i;
const ARTICLE = /^(the|a|an|my|our|this|that)\s+/i;

/** Words that say what kind of card is meant ("the login page", "the users table"). */
const KINDS: { word: RegExp; fits: (h: Hit, n: MapNode | undefined) => boolean }[] = [
  { word: /\b(page|pages|screen|screens|view|component|components|form|button|ui)\b/i, fits: (_h, n) => n?.layer === "ui" },
  { word: /\b(route|routes|endpoint|endpoints|api|handler|handlers)\b/i, fits: (_h, n) => n?.kind === "route" || n?.layer === "api" },
  { word: /\b(table|tables|collection|model|models)\b/i, fits: (_h, n) => n?.kind === "table" },
  { word: /\b(database|db)\b/i, fits: (_h, n) => n?.kind === "table" || n?.layer === "data" },
  { word: /\b(queue|queues|topic|topics|channel|channels)\b/i, fits: (_h, n) => n?.kind === "channel" },
  { word: /\b(service|services|server|api service)\b/i, fits: (h, n) => h.kind === "service" || n?.kind === "service" },
  { word: /\b(module|modules|logic|function|functions|helper|helpers)\b/i, fits: (_h, n) => n?.layer === "logic" || n?.kind === "module" },
  { word: /\b(file|files|config)\b/i, fits: (h, n) => h.kind === "file" || !!n?.file },
];

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The best card, service or file for a name, or null. Pure: from the map only. */
export function findByName(map: CodeMap, raw: string): Hit | null {
  const ix = indexOf(map);
  const text = raw.trim().replace(ARTICLE, "").trim();
  if (!text) return null;
  const exact = ix.node.get(text);
  if (exact) return { kind: "node", id: exact.id, label: exact.name, sub: exact.file ?? exact.kind, score: 0 };
  const flat = (q: string) =>
    searchMap(map, q, 200)
      .flatMap((g) => g.hits)
      .sort((a, b) => a.score - b.score);

  // The whole text first: a card may be called exactly that.
  const whole = flat(text);
  if (whole.length && whole[0].score <= 1) return whole[0];

  // Then without the kind word, keeping the cards of that kind.
  const kind = KINDS.find((k) => k.word.test(text));
  const bare = kind ? text.replace(kind.word, " ").replace(/\s+/g, " ").replace(ARTICLE, "").trim() : text;
  const fits = (h: Hit) => !kind || kind.fits(h, h.kind === "node" ? ix.node.get(h.id) : undefined);
  if (bare) {
    const kinded = (bare === text ? whole : flat(bare)).filter(fits);
    if (kinded.length) return kinded[0];
    // "sign in page" for SignIn, "user settings" for user_settings: the letters alone.
    const c = compact(bare);
    if (c.length >= 3) {
      const loose: Hit[] = [];
      for (const n of map.nodes) {
        const nm = compact(n.name);
        const base = compact(n.file?.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "");
        const sc = nm === c ? 0 : nm.startsWith(c) ? 1 : nm.includes(c) ? 2 : base === c ? 3 : base.includes(c) ? 4 : Infinity;
        if (sc === Infinity) continue;
        const h: Hit = { kind: "node", id: n.id, label: n.name, sub: n.file ? `${n.file}${n.line ? `:${n.line}` : ""}` : n.kind, score: sc };
        if (fits(h)) loose.push(h);
      }
      loose.sort((a, b) => a.score - b.score || a.label.length - b.label.length);
      if (loose.length) return loose[0];
    }
  }
  return whole[0] ?? null;
}

/** Is this text a question for the guide rather than a place to go? */
export function isQuestion(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (QUESTION.test(t) || FLOW.test(t)) return true;
  return false;
}

/** What the go-to bar's text means: a question, two cards, one card, or nothing on the map. */
export function resolveGoTo(map: CodeMap, raw: string): GoTo {
  const original = raw.trim();
  const text = original.replace(/[?.!]+$/, "").trim();
  if (!text) return { kind: "none" };
  if (isQuestion(text)) return { kind: "ask", question: original };
  const q = text.replace(LEAD, "").replace(ARTICLE, "").trim();
  // "A to B", "from A to B", "A → B": both by name.
  const two = /^(?:from\s+)?(.+?)\s+(?:to|→|->|=>|into)\s+(.+)$/i.exec(q);
  if (two) {
    const a = findByName(map, two[1]);
    const b = findByName(map, two[2]);
    if (a?.kind === "node" && b?.kind === "node" && a.id !== b.id) return { kind: "path", from: a, to: b };
  }
  const hit = findByName(map, q);
  if (hit) return { kind: "hit", hit };
  // A sentence the map has no name for is still a question for the guide.
  if (original.endsWith("?") || q.split(/\s+/).length >= 4) return { kind: "ask", question: original };
  return { kind: "none" };
}
