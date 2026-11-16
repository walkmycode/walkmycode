/**
 * A diagram with its analogy drawn in: a class, ER, state or flow diagram
 * whose every box is an everyday thing (its drawing, its everyday name) and
 * the real thing it stands for, and whose every line says what it means in
 * both languages. It is the companion of a scene (model.ts): a scene shows
 * what happens over time; a picture diagram shows how things are joined.
 *
 * It is data, written by a model in a fenced ```picture block (or handed to
 * the MCP answer tool) and drawn by src/components/scene/PictureDiagram.tsx,
 * which also lays it out: this file decides which row each box sits in, so
 * tests can check the layout without a page. No React, no DOM, no drawings.
 */
import { cleanShapes, type Pair, type Shape } from "./model";

export const PICTURE_KINDS = ["flow", "state", "class", "er"] as const;
export type PictureKind = (typeof PICTURE_KINDS)[number];
/** What a line means: the next step, a use, owning (has), or being a kind of (is). */
export const LINK_KINDS = ["then", "uses", "has", "is"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export type PictureNode = Pair & {
  id: string;
  /** The drawing for it, by name, or one made for it. */
  ia?: string;
  tint?: string;
  draw?: Shape[];
  /** What it holds, in real terms: a class's fields and methods, a table's columns. */
  rows?: string[];
};
export type PictureLink = {
  from: string;
  to: string;
  kind: LinkKind;
  /** What the line means, in the picture and for real. */
  a?: string;
  r?: string;
  /** How many at each end, for an ER diagram: ["1", "many"]. */
  ends?: [string, string];
};
export type Picture = {
  title: string;
  kind: PictureKind;
  nodes: PictureNode[];
  links: PictureLink[];
  /** The one-line takeaway. */
  rule: string;
  /** Where the picture stops being true. */
  breaks: string;
};

export const MAX_NODES = 12;
export const MAX_LINKS = 18;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const id = (v: unknown) => str(v, 40).toLowerCase().replace(/[^a-z0-9_-]/g, "");
const word = (v: unknown) => str(v, 24).toLowerCase().replace(/[^a-z]/g, "");

/** Keep only a diagram the page can draw; null otherwise. */
export function cleanPicture(raw: unknown): Picture | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;
  const kind = PICTURE_KINDS.find((k) => k === str(r.kind, 10).toLowerCase()) ?? "flow";
  const nodes: PictureNode[] = [];
  for (const x of Array.isArray(r.nodes) ? (r.nodes as Record<string, unknown>[]) : []) {
    const node = { id: id(x?.id), a: str(x?.a, 60), r: str(x?.r, 60) };
    if (!node.id || !node.a || !node.r || nodes.some((n) => n.id === node.id)) continue;
    const draw = cleanShapes(x.draw);
    const rows = (Array.isArray(x.rows) ? (x.rows as unknown[]) : []).map((v) => str(v, 60)).filter(Boolean).slice(0, 6);
    nodes.push({ ...node, ...(word(x.ia) ? { ia: word(x.ia) } : {}), ...(word(x.tint) ? { tint: word(x.tint) } : {}), ...(draw ? { draw } : {}), ...(rows.length ? { rows } : {}) });
    if (nodes.length === MAX_NODES) break;
  }
  if (nodes.length < 2) return null;
  const has = (v: string) => nodes.some((n) => n.id === v);
  // A line with no kind takes the diagram's usual one: the next step in a flow, a use between classes, owning between tables.
  const usual: LinkKind = kind === "class" ? "uses" : kind === "er" ? "has" : "then";
  const links: PictureLink[] = [];
  for (const x of Array.isArray(r.links) ? (r.links as Record<string, unknown>[]) : []) {
    const from = id(x?.from);
    const to = id(x?.to);
    if (!has(from) || !has(to) || from === to) continue;
    const ends = Array.isArray(x.ends) && x.ends.length === 2 ? ([str(x.ends[0], 8), str(x.ends[1], 8)] as [string, string]) : null;
    links.push({
      from,
      to,
      kind: LINK_KINDS.find((k) => k === str(x.kind, 10).toLowerCase()) ?? usual,
      ...(str(x.a, 40) ? { a: str(x.a, 40) } : {}),
      ...(str(x.r, 40) ? { r: str(x.r, 40) } : {}),
      ...(ends && ends[0] && ends[1] ? { ends } : {}),
    });
    if (links.length === MAX_LINKS) break;
  }
  if (!links.length) return null;
  return { title: str(r.title, 80) || "The picture", kind, nodes, links, rule: str(r.rule, 300), breaks: str(r.breaks, 300) };
}

/** A ```picture block from an answer, as a diagram; null if it is not one (still arriving, or not valid). */
export function readPictureBlock(text: string): Picture | null {
  try {
    return cleanPicture(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * The rows a diagram is drawn in, top to bottom, each a list of node ids left
 * to right. A box sits one row below the lowest box that leads to it; "is a
 * kind of" puts the general thing above the particular one, as a class
 * diagram does. A line that would close a loop is drawn, but does not move
 * its boxes. Within a row, boxes follow the boxes above them, so lines cross
 * as little as a single pass can manage.
 */
export function rowsOf(p: Picture): string[][] {
  const below = new Map<string, string[]>(p.nodes.map((n) => [n.id, []]));
  for (const l of p.links) {
    // "from is a kind of to": to goes above. Every other line reads downwards.
    const [up, down] = l.kind === "is" ? [l.to, l.from] : [l.from, l.to];
    below.get(up)!.push(down);
  }
  // First, walking down from each box in the order written, set aside any line that leads back to a box
  // still being walked: that line closes a loop. What is left has no loops, so every box has a depth.
  const above = new Map<string, string[]>(p.nodes.map((n) => [n.id, []]));
  const state = new Map<string, "walking" | "done">();
  const walk = (n: string) => {
    state.set(n, "walking");
    for (const down of below.get(n)!) {
      if (state.get(down) === "walking") continue;
      above.get(down)!.push(n);
      if (!state.has(down)) walk(down);
    }
    state.set(n, "done");
  };
  for (const n of p.nodes) if (!state.has(n.id)) walk(n.id);
  const depth = new Map<string, number>();
  const depthOf = (n: string): number => {
    const known = depth.get(n);
    if (known !== undefined) return known;
    const d = above.get(n)!.reduce((most, up) => Math.max(most, depthOf(up) + 1), 0);
    depth.set(n, d);
    return d;
  };
  const rows: string[][] = [];
  for (const n of p.nodes) (rows[depthOf(n.id)] ??= []).push(n.id);
  const filled = rows.filter(Boolean);
  const place = new Map<string, number>();
  filled.forEach((row, k) => {
    if (k > 0) {
      const lean = (n: string) => {
        const ups = above.get(n)!.filter((u) => place.has(u));
        return ups.length ? ups.reduce((sum, u) => sum + place.get(u)!, 0) / ups.length : Number.MAX_SAFE_INTEGER;
      };
      const first = new Map(row.map((n, i) => [n, i]));
      row.sort((x, y) => lean(x) - lean(y) || first.get(x)! - first.get(y)!);
    }
    // A box's place is its share of the row's width, so rows of different lengths line up.
    row.forEach((n, i) => place.set(n, (i + 0.5) / row.length));
  });
  return filled;
}

/** A line read aloud or shown as a caption: "Emily gives away to Jack · s1 move s2". */
export function linkLine(p: Picture, l: PictureLink): Pair {
  const from = p.nodes.find((n) => n.id === l.from)!;
  const to = p.nodes.find((n) => n.id === l.to)!;
  const verb = (side: "a" | "r") => l[side] ?? (l.kind === "is" ? "is a kind of" : l.kind === "has" ? "has" : l.kind === "uses" ? "uses" : "then");
  return { a: `${from.a} ${verb("a")} ${to.a}`, r: `${from.r} ${verb("r")} ${to.r}` };
}

/** How any model writes a picture diagram into an answer. Short: it rides in every system prompt. */
export const PICTURE_BLOCK = `For a class, ER, state or flow diagram a beginner can follow (they ask for one with an analogy, or explained simply), add one fenced \`\`\`picture block of JSON in place of Mermaid:
{"title": "what it shows", "kind": "class" | "er" | "state" | "flow", "nodes": [{"id": "one", "a": "everyday name", "r": "real name", "rows": ["its real fields, methods or columns, at most 5"]}], "links": [{"from": "one", "to": "two", "kind": "then" (the next step) | "uses" | "has" (owns) | "is" (is a kind of), "a": "everyday words", "r": "real words", "ends": ["1", "many"]}], "rule": "the one thing to remember", "breaks": "where the picture stops being true"}
2 to 10 nodes. Everyday names are things a ten-year-old knows: the app draws each one. "rows" and "ends" only where the diagram needs them.`;
