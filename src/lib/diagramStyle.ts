// The look of every diagram the Guide and the Professor draw (docs/design/diagram-blueprint.html,
// after the Ahofe "how it works" page): cards with a coloured edge and an icon, links that flow in
// the colour of where they start, pill labels, dashed amber groups. Colours are the map's layers:
// pages & components, API routes, logic, database, outside services. Mermaid draws the diagram;
// styleSvg() dresses it once it is in the page (it measures text, so it needs the live DOM).
import type { CodeMap, Layer } from "@/analyzer/types";

export type Lane = Layer;

export const LANES: Record<Lane, { color: string; label: string }> = {
  ui: { color: "#7eb8e0", label: "Pages & components" },
  api: { color: "#F07070", label: "API routes" },
  logic: { color: "#F5B820", label: "Logic" },
  data: { color: "#5CB87A", label: "Database" },
  external: { color: "#A99BF0", label: "Outside services" },
};
const ORDER: Lane[] = ["ui", "api", "logic", "data", "external"];

/** The surfaces on the chalkboard: a card a shade darker than the board, chalk lines and text. */
export const INK = { card: "#172c24", line: "rgba(241,239,230,.24)", ink: "#F1EFE6", dim: "#c9c3b3", amber: "#F5B820" };

/** A box's lane from its words, when the map can't tell (the Professor, or a name not in the map). */
export function guessLane(text: string): Lane {
  const t = text.toLowerCase();
  if (/\b(stripe|paystack|resend|sendgrid|mailgun|twilio|s3|aws|gcp|firebase|github|openai|anthropic|claude|gemini|webhook|smtp|email service|payment provider|third[- ]party|external|outside)\b/.test(t)) return "external";
  if (/\b(table|tables|database|db|postgres|postgresql|mysql|sqlite|mongo|mongodb|redis|prisma|schema|cache|bucket|storage)\b/.test(t)) return "data";
  if (/\b(get|post|put|patch|delete)\s+\/|\/api\b|\b(route|endpoint|handler|controller|server|api)\b/.test(t)) return "api";
  if (/\b(page|form|component|button|screen|view|browser|user|client|layout|modal|ui)\b|\.(tsx|jsx|vue|svelte)\b/.test(t)) return "ui";
  return "logic";
}

/** A box's lane from the map: the layer of the card, route, table or file its name points at. */
export function mapLanes(map: Pick<CodeMap, "nodes">): (text: string) => Lane | null {
  const byName = new Map<string, Lane>();
  const put = (k: string | undefined, l: Lane) => {
    const key = k?.trim().toLowerCase();
    if (key && !byName.has(key)) byName.set(key, l);
  };
  for (const n of map.nodes) {
    put(n.name, n.layer);
    if (n.method && n.path) put(`${n.method} ${n.path}`, n.layer);
    if (n.path) put(n.path, n.layer);
    if (n.file) {
      put(n.file, n.layer);
      put(n.file.split("/").pop()?.replace(/\.\w+$/, ""), n.layer);
    }
  }
  return (text) => {
    const first = text.split(/\n|<br\s*\/?>/i)[0].trim().toLowerCase();
    const bare = first.replace(/\(.*?\)$/, "").replace(/[.:;,]+$/, "").trim();
    return byName.get(first) ?? byName.get(bare) ?? null;
  };
}

/** The diagram's title (Mermaid front matter, `title: …`), and the source without it. */
export function frontMatter(source: string): { title: string | null; body: string } {
  const m = /^\s*---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!m) return { title: null, body: source };
  const t = /^\s*title:\s*["']?(.+?)["']?\s*$/m.exec(m[1]);
  return { title: t ? t[1].trim() : null, body: source.slice(m[0].length) };
}

/** What kind of diagram, in a word, from Mermaid's aria-roledescription. */
export function kindLabel(role: string | null | undefined): string {
  const r = (role ?? "").toLowerCase();
  if (r.startsWith("flowchart") || r === "graph") return "Flow";
  if (r.startsWith("sequence")) return "Step by step";
  if (r.startsWith("class")) return "Classes";
  if (r === "er" || r.startsWith("entity")) return "Data model";
  if (r.startsWith("state")) return "States";
  if (r.startsWith("mindmap")) return "Mind map";
  return "Diagram";
}

/** Lucide-style icons, 24×24, stroked. */
const ICONS = {
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  db: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .6-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 18z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l2 2M14 9l2 2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
} as const;
const LANE_ICON: Record<Lane, keyof typeof ICONS> = { ui: "monitor", api: "globe", logic: "cog", data: "db", external: "cloud" };

function iconFor(lane: Lane, text: string): keyof typeof ICONS {
  const t = text.toLowerCase();
  if (/\b(user|customer|visitor|person|actor)\b/.test(t) && lane === "ui") return "user";
  if (/\b(mail|email|smtp)\b/.test(t)) return "mail";
  if (/\b(auth|login|log in|sign ?in|password|session|token|jwt|key)\b/.test(t) && lane !== "data") return "key";
  return LANE_ICON[lane];
}

const SVG = "http://www.w3.org/2000/svg";
function el(doc: Document, tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = doc.createElementNS(SVG, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}
function setStyle(e: Element, css: Record<string, string>) {
  const s = (e as SVGElement).style;
  for (const [k, v] of Object.entries(css)) s.setProperty(k, v, "important");
}
function num(e: Element, a: string): number {
  return Number(e.getAttribute(a) ?? 0) || 0;
}

/** An accent bar and an icon at the left of a box (x, y, w, h in the box's own coordinates). */
function dressBox(box: Element, lane: Lane, text: string, b: { x: number; y: number; w: number; h: number }, icon = true) {
  const doc = box.ownerDocument;
  const c = LANES[lane].color;
  setStyle(box, { fill: INK.card, stroke: c, "stroke-width": "1.2px" });
  box.setAttribute("rx", "0");
  box.setAttribute("ry", "12");
  const bar = el(doc, "rect", { x: b.x, y: b.y, width: 5, height: b.h, rx: 0, fill: c, class: "dg-bar-edge" });
  box.after(bar);
  if (!icon) return;
  const cx = b.x + 24;
  const cy = b.y + b.h / 2;
  const ring = el(doc, "circle", { cx, cy, r: 13, fill: c, "fill-opacity": 0.2, class: "dg-icon" });
  const g = el(doc, "g", { transform: `translate(${cx},${cy}) scale(.66) translate(-12,-12)`, fill: "none", stroke: c, "stroke-width": 2.2, "stroke-linecap": "round", "stroke-linejoin": "round", class: "dg-icon" });
  g.innerHTML = ICONS[iconFor(lane, text)];
  bar.after(ring, g);
}

/** Where the words go in a card with an icon: the space right of it, centred; smaller only if they don't fit. */
const ICON_ZONE = 44;
function fitBeside(label: SVGGraphicsElement, b: { x: number; y: number; w: number; h: number }) {
  let bb: DOMRect;
  try {
    bb = label.getBBox();
  } catch {
    return;
  }
  if (!bb.width) return;
  const room = b.w - ICON_ZONE - 10;
  const s = Math.min(1, room / bb.width);
  const cx = b.x + ICON_ZONE + room / 2;
  const cy = b.y + b.h / 2;
  // The label's transform is replaced: same centre maths, from where its words are now.
  const own = label.getAttribute("transform") ?? "";
  const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\)/.exec(own);
  const [tx, ty] = m ? [Number(m[1]), Number(m[2])] : [0, 0];
  const mx = tx + bb.x + bb.width / 2;
  const my = ty + bb.y + bb.height / 2;
  label.setAttribute("transform", `translate(${cx - s * (mx - tx)}, ${cy - s * (my - ty)}) scale(${s})`);
}

/**
 * A link's label as a pill, the same everywhere: centred on the longest straight stretch of its link
 * (where it reads best, and away from the bends), the line hidden behind it, edged in the link's colour.
 */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const overlaps = (a: Box, b: Box, pad = 4) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

function pillOnLink(label: SVGGElement, path: SVGPathElement | null, color: string, taken: Box[]) {
  const text = label.querySelector("text");
  if (!text) return;
  let bb: DOMRect;
  try {
    bb = (text as SVGGraphicsElement).getBBox();
  } catch {
    return;
  }
  if (!bb.width) return;
  const t = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\)/.exec(label.getAttribute("transform") ?? "");
  let [x, y] = t ? [Number(t[1]), Number(t[2])] : [0, 0];
  const inner = label.querySelector<SVGGElement>(":scope > g.label");
  const it = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\)/.exec(inner?.getAttribute("transform") ?? "");
  const [ix, iy] = it ? [Number(it[1]), Number(it[2])] : [0, 0];
  const h = bb.height + 6;
  const w = bb.width + 18;
  const at = (cx: number, cy: number): Box => ({ x: cx - w / 2, y: cy - h / 2, w, h });
  if (path) {
    try {
      // The straight runs of the line (across or down), sampled every few px, longest first; the pill
      // goes on the middle of the first one where it touches no card and no other label.
      const len = path.getTotalLength();
      const steps = Math.max(8, Math.min(200, Math.round(len / 4)));
      const pts = Array.from({ length: steps + 1 }, (_, i) => path.getPointAtLength((len * i) / steps));
      const runs: { a: number; b: number; score: number }[] = [];
      let a = 0;
      const dirOf = (i: number) => (Math.abs(pts[i + 1].x - pts[i].x) >= Math.abs(pts[i + 1].y - pts[i].y) ? "x" : "y");
      for (let i = 1; i <= steps; i++) {
        const turned = i === steps || dirOf(i) !== dirOf(a) || Math.abs(dirOf(i) === "x" ? pts[i + 1].y - pts[i].y : pts[i + 1].x - pts[i].x) > 0.6;
        if (!turned) continue;
        const size = Math.hypot(pts[i].x - pts[a].x, pts[i].y - pts[a].y);
        // Across beats down for a label of words: a down run must be clearly longer to win.
        runs.push({ a, b: i, score: dirOf(a) === "x" ? size : size * 0.6 });
        a = i;
      }
      runs.sort((p, q) => q.score - p.score);
      // Each long run tried at its middle, then a third of the way along either side.
      const spots = runs.flatMap((r) => [0.5, 0.33, 0.67].map((f) => path.getPointAtLength((len * (r.a + (r.b - r.a) * f)) / steps)));
      const free = spots.find((m) => !taken.some((t) => overlaps(at(m.x, m.y), t)));
      const mid = free ?? spots[0];
      if (mid) [x, y] = [mid.x - ix - (bb.x + bb.width / 2), mid.y - iy - (bb.y + bb.height / 2)];
    } catch {
      // no geometry: Mermaid's own place for it
    }
  }
  label.setAttribute("transform", `translate(${x}, ${y})`);
  taken.push(at(x + ix + bb.x + bb.width / 2, y + iy + bb.y + bb.height / 2));
  const pill = el(label.ownerDocument, "rect", { x: bb.x - 9, y: bb.y + bb.height / 2 - h / 2, width: bb.width + 18, height: h, rx: 0, class: "dg-pill" });
  setStyle(pill, { fill: INK.card, stroke: color, "stroke-opacity": ".55", "stroke-width": "1px" });
  text.before(pill);
}

/** The flowing overlay on a link, in its lane's colour, with a dot where it starts. */
function flowOver(path: SVGPathElement, lane: Lane) {
  const c = LANES[lane].color;
  setStyle(path, { stroke: INK.line, "stroke-width": "1.5px" });
  const flow = path.cloneNode(false) as SVGPathElement;
  flow.removeAttribute("id");
  flow.removeAttribute("marker-end");
  flow.removeAttribute("marker-start");
  flow.removeAttribute("style");
  flow.setAttribute("class", "dg-flow");
  setStyle(flow, { stroke: c, "stroke-width": "2px", fill: "none", "stroke-dasharray": "28 60", "stroke-linecap": "round", opacity: ".9" });
  flow.style.setProperty("animation-delay", `-${(Math.random() * 2.4).toFixed(2)}s`);
  path.after(flow);
  const m = /M\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(path.getAttribute("d") ?? "");
  if (m) flow.after(el(path.ownerDocument, "circle", { cx: m[1], cy: m[2], r: 2.6, fill: c, class: "dg-dot" }));
}

/**
 * Dress a Mermaid diagram already in the page: lanes, cards, flowing links, pills, groups.
 * Idempotent (a second call does nothing). Returns the lanes it used, in the map's order, for the legend.
 */
export function styleSvg(svg: SVGSVGElement, laneOf: (text: string) => Lane | null = () => null): Lane[] {
  if (svg.dataset.dressed) return (svg.dataset.dressed || "").split(",").filter(Boolean) as Lane[];
  const used = new Set<Lane>();
  const lane = (text: string): Lane => {
    const l = laneOf(text) ?? guessLane(text);
    used.add(l);
    return l;
  };
  const role = svg.getAttribute("aria-roledescription") ?? "";

  if (role.startsWith("flowchart")) {
    const nodeLane = new Map<string, Lane>();
    for (const node of svg.querySelectorAll<SVGGElement>("g.node")) {
      const label = node.querySelector(".label");
      const text = [...(label?.querySelectorAll("tspan.text-outer-tspan") ?? [])].map((t) => t.textContent?.trim()).join("\n") || label?.textContent?.trim() || "";
      const l = lane(text);
      const id = /flowchart-(.+)-\d+$/.exec(node.id)?.[1];
      if (id) nodeLane.set(id, l);
      const shape = node.querySelector(":scope > rect.label-container, :scope > rect.basic");
      if (shape) {
        const b = { x: num(shape, "x"), y: num(shape, "y"), w: num(shape, "width"), h: num(shape, "height") };
        dressBox(shape, l, text, b, b.w >= 120);
        if (b.w >= 120 && label) fitBeside(label as SVGGraphicsElement, b);
      } else {
        for (const s of node.querySelectorAll(":scope > path, :scope > polygon, :scope > circle, :scope > ellipse")) setStyle(s, { fill: INK.card, stroke: LANES[l].color, "stroke-width": "1.2px" });
      }
    }
    const ids = [...nodeLane.keys()].sort((a, b) => b.length - a.length);
    for (const path of svg.querySelectorAll<SVGPathElement>("path.flowchart-link")) {
      const name = /L_(.+)_\d+$/.exec(path.id)?.[1] ?? "";
      const from = ids.find((id) => name.startsWith(`${id}_`));
      flowOver(path, (from && nodeLane.get(from)) || "logic");
    }
    // Labels as pills on their links, all alike, clear of the cards and of each other, drawn above both.
    const taken: Box[] = [...svg.querySelectorAll<SVGGElement>("g.node")].flatMap((n) => {
      const t = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\)/.exec(n.getAttribute("transform") ?? "");
      try {
        const b = n.getBBox();
        return [{ x: b.x + Number(t?.[1] ?? 0), y: b.y + Number(t?.[2] ?? 0), w: b.width, h: b.height }];
      } catch {
        return [];
      }
    });
    const labels = svg.querySelector("g.edgeLabels");
    labels?.parentElement?.append(labels);
    for (const label of svg.querySelectorAll<SVGGElement>("g.edgeLabel")) {
      label.querySelector("rect.background")?.remove();
      if (!label.textContent?.trim()) continue;
      const id = label.querySelector("g.label")?.getAttribute("data-id");
      const path = id ? ([...svg.querySelectorAll<SVGPathElement>("path.flowchart-link")].find((p) => p.id.endsWith(id)) ?? null) : null;
      const from = path && ids.find((n) => (/L_(.+)_\d+$/.exec(path.id)?.[1] ?? "").startsWith(`${n}_`));
      pillOnLink(label, path, LANES[(from && nodeLane.get(from)) || "logic"].color, taken);
    }
    for (const r of svg.querySelectorAll<SVGRectElement>("g.cluster > rect")) {
      setStyle(r, { fill: "none", stroke: INK.amber, "stroke-width": "1.2px", "stroke-dasharray": "6 6", opacity: ".7" });
      r.setAttribute("rx", "0");
      r.setAttribute("ry", "18");
    }
  } else if (role.startsWith("sequence")) {
    // Each participant: its lane from its name; the messages it sends take its colour.
    const at = new Map<number, Lane>();
    for (const box of svg.querySelectorAll<SVGRectElement>("rect.actor")) {
      const text = box.parentElement?.querySelector("text")?.textContent?.trim() || box.getAttribute("name") || "";
      const l = lane(text);
      const b = { x: num(box, "x"), y: num(box, "y"), w: num(box, "width"), h: num(box, "height") };
      at.set(Math.round(b.x + b.w / 2), l);
      dressBox(box, l, text, b, b.w >= 120);
      const label = box.parentElement?.querySelector("text");
      if (label && b.w >= 120) fitBeside(label as SVGGraphicsElement, b);
    }
    for (const stick of svg.querySelectorAll("g.actor-man")) {
      // A stick figure is a person, whatever the map calls a table of the same name.
      const l: Lane = "ui";
      used.add(l);
      for (const s of stick.querySelectorAll("line, circle, path")) setStyle(s, { stroke: LANES[l].color, fill: "none" });
      const x = Number(/translate\(\s*(-?[\d.]+)/.exec(stick.getAttribute("transform") ?? "")?.[1] ?? NaN);
      const cx = Number(stick.querySelector("circle")?.getAttribute("cx") ?? NaN);
      if (Number.isFinite(cx)) at.set(Math.round(cx + (Number.isFinite(x) ? x : 0)), l);
    }
    for (const line of svg.querySelectorAll("line.actor-line")) setStyle(line, { stroke: INK.line, "stroke-dasharray": "3 5", "stroke-width": "1px" });
    const near = (x: number): Lane => {
      let best: Lane = "logic";
      let d = Infinity;
      for (const [cx, l] of at) if (Math.abs(cx - x) < d) [d, best] = [Math.abs(cx - x), l];
      return best;
    };
    for (const line of svg.querySelectorAll<SVGLineElement>("line.messageLine0, line.messageLine1")) {
      const reply = line.classList.contains("messageLine1");
      const c = LANES[near(num(line, "x1"))].color;
      setStyle(line, { stroke: reply ? "rgba(241,239,230,.45)" : c, "stroke-width": "1.6px" });
      if (!reply) line.after(el(line.ownerDocument, "circle", { cx: num(line, "x1"), cy: num(line, "y1"), r: 2.6, fill: c, class: "dg-dot" }));
    }
    for (const l of svg.querySelectorAll("line.loopLine")) setStyle(l, { stroke: INK.amber, "stroke-dasharray": "6 6", opacity: ".7", "stroke-width": "1.2px" });
    for (const p of svg.querySelectorAll("polygon.labelBox")) setStyle(p, { fill: "none", stroke: "none" });
    for (const n of svg.querySelectorAll("rect.note")) {
      setStyle(n, { fill: INK.card, stroke: INK.line });
      n.setAttribute("rx", "0");
    }
  } else {
    // Classes, data models, states, mind maps: the same cards and lines, coloured by name.
    for (const box of svg.querySelectorAll("g.node > rect, g.node > path, rect.er.entityBox, g.classGroup > rect, g.stateGroup > rect")) {
      const text = box.parentElement?.textContent?.trim() ?? "";
      const l = role === "er" ? (used.add("data"), "data" as Lane) : lane(text);
      setStyle(box, { fill: INK.card, stroke: LANES[l].color, "stroke-width": "1.2px" });
      if (box.tagName === "rect") box.setAttribute("rx", "0");
    }
  }
  const lanes = ORDER.filter((l) => used.has(l));
  svg.dataset.dressed = lanes.join(",") || " ";
  return lanes;
}
