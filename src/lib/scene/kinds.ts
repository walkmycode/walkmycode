/**
 * The kinds of scene beyond the hand-over (model.ts's Scene, where holders pass things on), so a lesson in any
 * subject is shown in the picture that fits its idea (mockup docs/design/analogy-scene.html):
 *
 * - timeline:   when, and for how long (a borrow outliving its owner; the years between the wars)
 * - flow:       what happens in what order, maybe round again (blood round the body; a request through a server)
 * - containers: what is inside, on top, first out (the call stack; a queue at the post office)
 * - compare:    which is bigger, or what changed (compound against simple interest; O(n) against O(n²))
 * - graph:      a diagram the student asks for, built step by step: flowchart, state machine, UML class, ER, mind map
 * - sequence:   who says what to whom, in order (the HTTPS handshake; signing in)
 *
 * Every kind is data a model writes: the structure only, never coordinates (the page lays it out), with the
 * everyday picture's words (`a`) and the real ones (`r`) side by side, so X-ray can swap one for the other.
 * Every step says what it shows, a headline with its key word in *stars*, and may ask the student to guess
 * first. The real side is the code (with the line each step is about) or, for a subject without code, the
 * subject's own facts. cleanKindScene keeps only what the page can draw and what agrees with itself.
 * No React, no DOM, no drawings: tests drive it.
 */
import type { Pair } from "./model";

export const SCENE_KINDS = ["timeline", "flow", "containers", "compare", "graph", "sequence"] as const;
export type SceneKind = (typeof SCENE_KINDS)[number];
export const GRAPH_TYPES = ["flowchart", "state", "class", "er", "mindmap"] as const;
export type GraphType = (typeof GRAPH_TYPES)[number];
export const TONES = ["yellow", "blue", "green", "pink", "purple", "orange"] as const;
export type Tone = (typeof TONES)[number];

/** Guess first: asked before the step it belongs to is shown. */
export type Ask = { q: string; opts: string[]; right: number; why: string };
/** A drawing by name from the set, for the picture (`ia`) and for real (`ir`). */
export type Drawn = { ia?: string; ir?: string; tint?: Tone };
export type Named = Pair & Drawn & { id: string };

type StepBase = {
  /** Two to five words, the key one in *stars*: "The guard *refuses*". */
  head: string;
  /** What happens in the picture, and for real: a sentence each. */
  a: string;
  r: string;
  /** The line of the code it is about (1 is the first). */
  line?: number;
  /** The facts it is about, for a subject without code (0 is the first). */
  facts?: number[];
  /** The word it teaches: its place in `words`. */
  word?: number;
  ask?: Ask;
};

export type TimelineStep = StepBase & {
  /** Where "now" is on the axis (0 is the first mark). */
  at: number;
  /** Each row's bar: from a mark to a mark, or on to now (null). */
  bars: Record<string, [number, number | null]>;
  /** A word on a row's bar: "valid", "dangling". */
  tags?: Record<string, Pair & { tone?: Tone }>;
  /** Something is stopped here: a cross at now. */
  stop?: boolean;
};
export type FlowStep = StepBase & { at: string; carry: string[] };
export type ContainersStep = StepBase & { items: string[]; out?: Pair };
export type CompareStep = StepBase & { upto: number; gap?: boolean };
export type ShowStep = StepBase & { show: string[] };

export type TimelineScene = { kind: "timeline"; rows: (Named & { borrows?: string; tone?: Tone })[]; marks: Pair[]; band?: Pair & { from: number; to: number }; steps: TimelineStep[] };
export type FlowScene = { kind: "flow"; stops: Named[]; mover: Pair & Drawn; items: Named[]; loop: boolean; steps: FlowStep[] };
export type ContainersScene = { kind: "containers"; holder: Pair; order: "stack" | "queue"; items: (Named & { note?: Pair })[]; steps: ContainersStep[] };
export type CompareScene = { kind: "compare"; series: (Named & { values: number[] })[]; points: Pair[]; unit: string; steps: CompareStep[] };
export type GraphNode = Named & {
  shape: "box" | "oval" | "diamond" | "state" | "start" | "end" | "class" | "entity" | "root" | "topic" | "leaf";
  /** A class's fields and methods, a table's columns ("PK id", "FK course_id"). */
  rows?: string[];
  /** A mind map's branch it hangs from. */
  of?: string;
  /** Where it sits, when the professor knows better than the layout: its column, and how far down (0 to 1). */
  rank?: number;
  lane?: number;
};
export type GraphEdge = Partial<Pair> & { from: string; to: string; kind: "arrow" | "inherit" | "has" | "onemany" | "line"; back?: boolean; carry?: string };
export type GraphScene = { kind: "graph"; type: GraphType; nodes: GraphNode[]; edges: GraphEdge[]; steps: ShowStep[] };
export type SeqRow = { id: string } & Pair & ({ from: string; to: string; carry?: string } | { divider: true });
export type SequenceScene = {
  kind: "sequence";
  parts: Named[];
  /** What a message carries, drawn in a colour: a key in blue (public) or pink (private). The legend is built from these. */
  chips: Named[];
  rows: SeqRow[];
  phases: (Pair & { from: string; to: string; tone: Tone })[];
  /** What happens inside one side: two chips become a third ("session key" + "public key" → "encrypted"). */
  insets: (Pair & { id: string; side: string; row: string; ins: string[]; out: string })[];
  steps: ShowStep[];
};

export type KindBody = TimelineScene | FlowScene | ContainersScene | CompareScene | GraphScene | SequenceScene;
export type KindScene = KindBody & {
  title: string;
  /** Where the picture is set. */
  place: string;
  /** The picture's words and the real ones, each with a few plain words of why. */
  words: (Pair & { why?: string })[];
  /** The real side: the code and its language, or the subject's facts (and where they come from). */
  code?: string;
  language?: string;
  facts?: string[];
  source?: string;
  rule: string;
  breaks: string;
};

/* ── Keeping only what the page can draw ── */
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const id = (v: unknown) => str(v, 40).toLowerCase().replace(/[^a-z0-9_-]/g, "");
const word = (v: unknown) => str(v, 24).toLowerCase().replace(/[^a-z]/g, "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);
const tone = (v: unknown): Tone | undefined => (TONES as readonly string[]).includes(word(v)) ? (word(v) as Tone) : undefined;
const pair = (v: unknown, max = 80): Pair | null => {
  const p = v as Record<string, unknown> | null;
  const a = str(p?.a, max);
  const r = str(p?.r, max);
  return a && r ? { a, r } : null;
};
const drawn = (x: Record<string, unknown>): Drawn => ({ ...(word(x.ia) ? { ia: word(x.ia) } : {}), ...(word(x.ir) ? { ir: word(x.ir) } : {}), ...(tone(x.tint) ? { tint: tone(x.tint) } : {}) });
/** Named things with unique ids, everyday and real names, at most `max`. */
const named = (v: unknown, max: number, nameMax = 50): Named[] => {
  const out: Named[] = [];
  for (const x of list(v)) {
    const p = pair(x, nameMax);
    const i = id(x.id);
    if (!p || !i || out.some((o) => o.id === i)) continue;
    out.push({ id: i, ...p, ...drawn(x) });
    if (out.length === max) break;
  }
  return out;
};

/** A headline: two to six words, one of them in *stars* (added to the last word when the model forgot). */
function headline(v: unknown, fallback: string): string {
  const h = str(v, 60) || fallback.split(" ").slice(0, 5).join(" ");
  const m = h.match(/\*([^*]+)\*/);
  // One key word or phrase in stars; any other stars are dropped.
  if (m && m.index !== undefined) return `${h.slice(0, m.index).replace(/\*/g, "")}*${m[1].trim()}*${h.slice(m.index + m[0].length).replace(/\*/g, "")}`;
  const ws = h.replace(/\*/g, "").split(" ");
  ws[ws.length - 1] = `*${ws[ws.length - 1]}*`;
  return ws.join(" ");
}
function ask(v: unknown): Ask | undefined {
  const x = v as Record<string, unknown> | null;
  if (!x || typeof x !== "object") return undefined;
  const q = str(x.q, 160);
  const opts = (Array.isArray(x.opts) ? x.opts : []).map((o) => str(o, 60)).filter(Boolean).slice(0, 3);
  const right = num(x.right);
  const why = str(x.why, 200);
  return q && opts.length >= 2 && right !== null && Number.isInteger(right) && right >= 0 && right < opts.length && why ? { q, opts, right, why } : undefined;
}
/** What every step has, checked against the real side and the words. */
function base(x: Record<string, unknown>, lines: number, facts: number, words: number): StepBase | null {
  const a = str(x.a);
  const r = str(x.r);
  if (!a || !r) return null;
  const line = num(x.line);
  const fs = (Array.isArray(x.facts) ? x.facts : [x.fact]).map(num).filter((n): n is number => n !== null && Number.isInteger(n) && n >= 0 && n < facts);
  const w = num(x.word);
  const q = ask(x.ask);
  return {
    head: headline(x.head, a),
    a,
    r,
    ...(line !== null && Number.isInteger(line) && line >= 1 && line <= lines ? { line } : {}),
    ...(fs.length ? { facts: [...new Set(fs)] } : {}),
    ...(w !== null && Number.isInteger(w) && w >= 0 && w < words ? { word: w } : {}),
    ...(q ? { ask: q } : {}),
  };
}

const MAX_STEPS = 9;

function cleanBody(kind: SceneKind, r: Record<string, unknown>, at: (x: Record<string, unknown>) => StepBase | null): KindBody | null {
  const steps = <T>(make: (x: Record<string, unknown>, b: StepBase) => T | null): T[] => {
    const out: T[] = [];
    for (const x of list(r.steps)) {
      const b = at(x);
      const s = b && make(x, b);
      if (s) out.push(s);
      if (out.length === MAX_STEPS) break;
    }
    return out;
  };
  const ids = (v: unknown, ok: (i: string) => boolean) => [...new Set((Array.isArray(v) ? v : []).map(id).filter(ok))];

  if (kind === "timeline") {
    const rows = named(r.rows, 4).map((row, n) => {
      const x = list(r.rows)[n] ?? {};
      return { ...row, ...(id(x.borrows) ? { borrows: id(x.borrows) } : {}), ...(tone(x.tone) ? { tone: tone(x.tone) } : {}) };
    });
    const marks = list(r.marks).map((m) => pair(m, 30)).filter((m): m is Pair => !!m).slice(0, 12);
    if (rows.length < 1 || marks.length < 2) return null;
    for (const row of rows) if (row.borrows && !rows.some((o) => o.id === row.borrows && o.id !== row.id)) delete row.borrows;
    const mark = (v: unknown) => { const n = num(v); return n !== null && Number.isInteger(n) && n >= 0 && n < marks.length ? n : null; };
    const band = pair(r.band, 60);
    const bf = mark((r.band as Record<string, unknown> | null)?.from);
    const bt = mark((r.band as Record<string, unknown> | null)?.to);
    const s = steps<TimelineStep>((x, b) => {
      const now = mark(x.at);
      if (now === null) return null;
      const bars: TimelineStep["bars"] = {};
      const given = (x.bars ?? {}) as Record<string, unknown>;
      for (const row of rows) {
        const v = given[row.id];
        if (!Array.isArray(v)) continue;
        const from = mark(v[0]);
        const to = v[1] === null ? null : mark(v[1]);
        if (from !== null && from <= now && (to === null || (to >= from && to <= now))) bars[row.id] = [from, to];
      }
      const tags: NonNullable<TimelineStep["tags"]> = {};
      for (const [k, v] of Object.entries((x.tags ?? {}) as Record<string, unknown>)) {
        const p = pair(v, 24);
        if (p && bars[id(k)]) tags[id(k)] = { ...p, ...(tone((v as Record<string, unknown>).tone) ? { tone: tone((v as Record<string, unknown>).tone) } : {}) };
      }
      return { ...b, at: now, bars, ...(Object.keys(tags).length ? { tags } : {}), ...(x.stop === true ? { stop: true } : {}) };
    });
    return s.length >= 2 ? { kind, rows, marks, ...(band && bf !== null && bt !== null && bt >= bf ? { band: { ...band, from: bf, to: bt } } : {}), steps: s } : null;
  }

  if (kind === "flow") {
    const stops = named(r.stops, 6);
    const items = named(r.items, 4, 30);
    const mover = pair(r.mover, 40);
    if (stops.length < 2 || !mover) return null;
    const isStop = (i: string) => stops.some((x) => x.id === i);
    const s = steps<FlowStep>((x, b) => (isStop(id(x.at)) ? { ...b, at: id(x.at), carry: ids(x.carry, (i) => items.some((it) => it.id === i)) } : null));
    return s.length >= 2 ? { kind, stops, items, mover: { ...mover, ...drawn((r.mover ?? {}) as Record<string, unknown>) }, loop: r.loop !== false, steps: s } : null;
  }

  if (kind === "containers") {
    const items = named(r.items, 6).map((it, n) => {
      const note = pair(list(r.items)[n]?.note, 40);
      return note ? { ...it, note } : it;
    });
    const holder = pair(r.holder, 40);
    if (items.length < 2 || !holder) return null;
    const s = steps<ContainersStep>((x, b) => {
      const inside = ids(x.items, (i) => items.some((it) => it.id === i));
      const out = pair(x.out, 40);
      return { ...b, items: inside, ...(out ? { out } : {}) };
    });
    return s.length >= 2 ? { kind, holder, order: r.order === "queue" ? "queue" : "stack", items, steps: s } : null;
  }

  if (kind === "compare") {
    const points = list(r.points).map((p) => pair(p, 24)).filter((p): p is Pair => !!p).slice(0, 10);
    if (points.length < 2) return null;
    const series = named(r.series, 3).map((sr, n) => {
      const vals = (Array.isArray(list(r.series)[n]?.values) ? (list(r.series)[n].values as unknown[]) : []).map(num);
      return { ...sr, values: vals.slice(0, points.length) };
    }).filter((sr): sr is Named & { values: number[] } => sr.values.length === points.length && sr.values.every((v) => v !== null && v >= 0));
    if (series.length < 2) return null;
    const s = steps<CompareStep>((x, b) => {
      const upto = num(x.upto);
      return upto !== null && Number.isInteger(upto) && upto >= 0 && upto < points.length ? { ...b, upto, ...(x.gap === true ? { gap: true } : {}) } : null;
    });
    return s.length >= 2 ? { kind, series, points, unit: str(r.unit, 4), steps: s } : null;
  }

  if (kind === "graph") {
    const type = (GRAPH_TYPES as readonly string[]).includes(word(r.type)) ? (word(r.type) as GraphType) : "flowchart";
    const SHAPES: GraphNode["shape"][] = ["box", "oval", "diamond", "state", "start", "end", "class", "entity", "root", "topic", "leaf"];
    const nodes: GraphNode[] = [];
    for (const x of list(r.nodes)) {
      const i = id(x.id);
      const shape = (SHAPES as string[]).includes(word(x.shape)) ? (word(x.shape) as GraphNode["shape"]) : type === "state" ? "state" : type === "class" ? "class" : type === "er" ? "entity" : "box";
      const p = pair(x, 50) ?? (shape === "start" || shape === "end" ? { a: "", r: "" } : null);
      if (!i || !p || nodes.some((n) => n.id === i)) continue;
      const rows = (Array.isArray(x.rows) ? x.rows : []).map((v) => str(v, 40)).filter(Boolean).slice(0, 8);
      const rank = num(x.rank);
      const lane = num(x.lane);
      nodes.push({ id: i, ...p, ...drawn(x), shape, ...(rows.length ? { rows } : {}), ...(id(x.of) ? { of: id(x.of) } : {}),
        ...(rank !== null && Number.isInteger(rank) && rank >= 0 && rank < 12 ? { rank } : {}), ...(lane !== null && lane >= 0 && lane <= 1 ? { lane } : {}) });
      if (nodes.length === 14) break;
    }
    if (nodes.length < 2) return null;
    const has = (i: string) => nodes.some((n) => n.id === i);
    for (const n of nodes) if (n.of && !has(n.of)) delete n.of;
    const KINDS: GraphEdge["kind"][] = ["arrow", "inherit", "has", "onemany", "line"];
    const edges: GraphEdge[] = [];
    for (const x of list(r.edges)) {
      const from = id(x.from);
      const to = id(x.to);
      if (!has(from) || !has(to) || from === to) continue;
      const p = pair(x, 40);
      const carry = word(x.carry);
      edges.push({ from, to, kind: (KINDS as string[]).includes(word(x.kind)) ? (word(x.kind) as GraphEdge["kind"]) : type === "mindmap" ? "line" : "arrow", ...(p ?? {}), ...(x.back === true ? { back: true } : {}), ...(carry ? { carry } : {}) });
      if (edges.length === 20) break;
    }
    // A mind map's lines are its structure: whatever hangs from what, a branch from the middle when it says nothing.
    if (type === "mindmap") {
      const root = nodes.find((n) => n.shape === "root");
      for (const n of nodes) if (!n.of && root && n !== root && n.shape === "topic") n.of = root.id;
      for (const n of nodes) if (n.of && !edges.some((e) => e.from === n.of && e.to === n.id)) edges.push({ from: n.of, to: n.id, kind: "line" });
    }
    const s = steps<ShowStep>((x, b) => {
      const show = ids(x.show, (i) => has(i) || edges.some((e) => `${e.from}-${e.to}` === i));
      return show.length ? { ...b, show } : null;
    });
    return s.length >= 2 ? { kind, type, nodes, edges, steps: s } : null;
  }

  // sequence
  const parts = named(r.parts, 4);
  const chips = named(r.chips, 6, 40);
  if (parts.length < 2) return null;
  const isPart = (i: string) => parts.some((p) => p.id === i);
  const isChip = (i: string) => chips.some((c) => c.id === i);
  const rows: SeqRow[] = [];
  for (const x of list(r.rows)) {
    const i = id(x.id);
    const p = pair(x, 60);
    if (!i || !p || rows.some((o) => o.id === i)) continue;
    if (x.divider === true) rows.push({ id: i, ...p, divider: true });
    else if (isPart(id(x.from)) && isPart(id(x.to)) && id(x.from) !== id(x.to)) rows.push({ id: i, ...p, from: id(x.from), to: id(x.to), ...(isChip(id(x.carry)) ? { carry: id(x.carry) } : {}) });
    if (rows.length === 16) break;
  }
  if (rows.filter((x) => !("divider" in x)).length < 2) return null;
  const rowAt = (i: string) => rows.findIndex((x) => x.id === i);
  const phases = list(r.phases).map((x) => {
    const p = pair(x, 40);
    const from = rowAt(id(x.from));
    const to = rowAt(id(x.to));
    return p && from >= 0 && to >= from ? { ...p, from: id(x.from), to: id(x.to), tone: tone(x.tone) ?? TONES[1] } : null;
  }).filter((x): x is SequenceScene["phases"][number] => !!x).slice(0, 5);
  const insets = list(r.insets).map((x) => {
    const p = pair(x, 80);
    const ins = ids(x.ins, isChip).slice(0, 2);
    return p && id(x.id) && isPart(id(x.side)) && rowAt(id(x.row)) >= 0 && ins.length && isChip(id(x.out)) ? { ...p, id: id(x.id), side: id(x.side), row: id(x.row), ins, out: id(x.out) } : null;
  }).filter((x): x is SequenceScene["insets"][number] => !!x).slice(0, 3);
  const known = (i: string) => rowAt(i) >= 0 || insets.some((x) => x.id === i);
  const s = steps<ShowStep>((x, b) => {
    const show = ids(x.show, known);
    return show.length ? { ...b, show } : null;
  });
  return s.length >= 2 ? { kind: "sequence", parts, chips, rows, phases, insets, steps: s } : null;
}

/** Keep only a scene of one of these kinds the page can draw; null otherwise. `language` is null for a subject without code. */
export function cleanKindScene(raw: unknown, language: string | null): KindScene | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;
  const kind = (SCENE_KINDS as readonly string[]).includes(word(r.kind)) ? (word(r.kind) as SceneKind) : null;
  if (!kind) return null;
  const words = list(r.words ?? r.map).map((w) => { const p = pair(w, 60); return p ? { ...p, ...(str(w.why, 110) ? { why: str(w.why, 110) } : {}) } : null; }).filter((w): w is Pair & { why?: string } => !!w).slice(0, 6);
  // Code keeps its own lines and indentation; only its length is capped.
  const keptCode = language && typeof r.code === "string" ? r.code.replace(/\r\n/g, "\n").slice(0, 1600).trimEnd() : "";
  const lines = keptCode ? keptCode.split("\n").length : 0;
  const facts = (Array.isArray(r.facts) ? r.facts : []).map((f) => str(f, 160)).filter(Boolean).slice(0, 8);
  const body = cleanBody(kind, r, (x) => base(x, lines, facts.length, words.length));
  if (!body) return null;
  return {
    ...body,
    title: str(r.title, 80) || "The picture",
    place: str(r.place, 70),
    words,
    ...(keptCode.trim() ? { code: keptCode, language: str(r.language, 20).toLowerCase() || language || "text" } : {}),
    ...(facts.length ? { facts } : {}),
    ...(str(r.source, 120) ? { source: str(r.source, 120) } : {}),
    rule: str(r.rule, 220),
    breaks: str(r.breaks, 260),
  };
}

/**
 * How a model writes a scene of one of these kinds: what each kind is for, and its JSON. Short on purpose: the
 * professor reads it whenever it draws a scene, and a shorter form (KINDS_BRIEF) rides in every chat.
 */
export const KINDS_GUIDE = `Every kind has: "kind", "title" (the picture in a few words), "place" (where it is set), "words" ([{"a": picture word, "r": real word, "why": a few words}], 3 to 6), "rule" (the one thing to remember), "breaks" (where the picture stops being true), and "steps" (3 to 7). Every step has "head" (two to five words, the key word in *stars*: "The guard *refuses*"), "a" (what happens in the picture, one sentence), "r" (what happens for real, one sentence), "line" (the code line it is about, 1 is the first) or "facts" ([indexes into "facts"]), "word" (its place in "words"), and at the step that matters most "ask" ({"q": a question, "opts": two or three answers, "right": the right one's index, "why": one sentence}). The real side is "code" (the real lines) or, without code, "facts" (3 to 7 true statements) and "source". Everything has an everyday name "a" and a real one "r"; "ia"/"ir" name a drawing for each from the list; "tint"/"tone" is yellow, blue, green, pink, purple or orange.
- "timeline" (when, and for how long: a lifetime, a scope, eras, a deadline): "rows" ([{"id","a","r","ia","ir","tone","borrows": the id of the row it depends on}], 1 to 4), "marks" ([{"a","r"}], the ticks along the bottom, 2 to 12), "band" (optional {"from","to","a","r"}, a stretch of marks to shade). Each step: "at" (the mark that is now, 0 is the first), "bars" ({row id: [from mark, to mark or null while it goes on]}), "tags" (optional {row id: {"a","r","tone"}}), "stop": true where something is stopped.
- "flow" (what happens in order, maybe round again: blood round the body, a request through a server, the water cycle): "stops" ([{"id","a","r","ia","ir"}], 2 to 6, in order round the ring), "mover" ({"a","r","ia","ir"}, what travels), "items" ([{"id","a","r","ia","tint"}], what it carries), "loop": true when it goes round. Each step: "at" (a stop's id), "carry" ([item ids]).
- "containers" (what is inside, on top, first out: a call stack, a queue): "order" ("stack" or "queue"), "holder" ({"a","r"}), "items" ([{"id","a","r","ia","ir","note": {"a","r"}}], 2 to 6). Each step: "items" (the ids inside now, bottom to top or front to back), "out" (optional {"a","r"}, what comes out).
- "compare" (which is bigger, or what changed: two growth rates, before and after, two algorithms): "series" ([{"id","a","r","ia","tint","values": one number per point}], 2 or 3), "points" ([{"a","r"}], 2 to 10), "unit" (a symbol such as "£"). Each step: "upto" (the last point shown), "gap": true to mark the difference.
- "graph" (a diagram, built step by step): "type" ("flowchart", "state", "class", "er" or "mindmap"), "nodes" ([{"id","shape","a","r","ia","rows","of"}], 2 to 14; shape box, oval, diamond (a decision), state, start, end, class, entity, root, topic or leaf; "rows" a class's fields and methods or a table's columns, "PK id" and "FK course_id"; "of" the mind map branch it hangs from), "edges" ([{"from","to","kind","a","r","back","carry"}]; kind arrow, inherit, has, onemany or line; "back": true for a line that goes back, such as a loop). Each step: "show" (the node ids that appear, and "from-to" for a back edge).
- "sequence" (who says what to whom, in order: a handshake, signing in, an order through services): "parts" ([{"id","a","r","ia","ir"}], 2 to 4), "chips" ([{"id","a","r","ia","tint"}], what a message carries: a key in blue, another in pink), "rows" ([{"id","from","to","a","r","carry": a chip id}] or [{"id","divider": true,"a","r"}]), "phases" ([{"a","r","from": row id,"to": row id,"tone"}]), "insets" ([{"id","side": a part's id,"row","ins": [chip ids],"out": chip id,"a","r"}], what happens inside one side). Each step: "show" (row and inset ids).`;

/** The kinds in a few lines, for every chat: enough to write one when a diagram is asked for by name. */
export const KINDS_BRIEF = `When another picture fits better, or a diagram is asked for by name (a flowchart, a state machine, a UML class or ER diagram, a mind map, a sequence diagram, a timeline), the block may instead be one of these kinds, built step by step: {"kind": "graph", "type": "flowchart" | "state" | "class" | "er" | "mindmap", "nodes": [{"id", "shape", "a", "r", "rows"}], "edges": [{"from", "to", "kind", "a", "r"}], "steps": [{"head": "two to five words, the key one in *stars*", "a", "r", "show": [node ids]}]}, or {"kind": "sequence", "parts", "rows": [{"id", "from", "to", "a", "r"}], "steps": [{"head", "a", "r", "show": [row ids]}]}, or "timeline", "flow", "containers", "compare"; each with "title", "place", "words", "rule", "breaks", and "code" or "facts". Every name has an everyday "a" and a real "r".`;
