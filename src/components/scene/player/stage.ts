/**
 * The stage of the scene player (ScenePlayer.tsx): one renderer per kind of scene (src/lib/scene/kinds.ts),
 * each building its picture once and then moving it from step to step, so things travel rather than redraw.
 * Ported from the mockup's renderers (docs/design/analogy-scene.html), which were measured for overflow and
 * overlap at three window sizes. Layout comes from the structure alone: layered columns (folding onto a second
 * row when a long diagram meets a narrow stage), a ring for a mind map or a round, lifelines for a sequence.
 *
 * Imperative on purpose, like a canvas: the frame around it is React; inside, positions come from measuring
 * what is drawn. Everything a model wrote goes in as text (textContent); a drawing is only ever one of the
 * set's own, by name. Only transform, opacity and stroke-dashoffset move, × --m, so with motion off every
 * step simply is where it belongs.
 */
import { drawingOf, TINTS } from "@/lib/drawings";
import type { Pair } from "@/lib/scene/model";
import type { CompareScene, ContainersScene, FlowScene, GraphNode, GraphScene, KindScene, SequenceScene, TimelineScene, Tone } from "@/lib/scene/kinds";

export type StageOpts = { hold?: boolean; final?: boolean; still?: boolean };
export type StageApi = { update(i: number, o?: StageOpts): void; relayout(i: number, final: boolean): void; dispose(): void };

const NS = "http://www.w3.org/2000/svg";
/** A whole pixel: text placed on a half pixel is drawn soft. */
const whole = (v: number) => Math.round(v);
export const TONE: Record<Tone, string> = { yellow: "#f3d77a", blue: "#9fd3f0", green: "#a8e0a0", pink: "#f2a7a0", purple: "#c9b6f2", orange: "#f0a94b" };
const motion = () => (typeof window === "undefined" ? 0 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--m")) || 0);

type Attrs = Record<string, string | number | undefined>;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", ...kids: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k !== null && k !== undefined && k !== false) e.append(k);
  return e;
}
function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) e.setAttribute(k, String(v));
  return e;
}
/** The picture's words and the real ones in one place: X-ray shows one, hides the other. */
const two = (p: Partial<Pair>, cls = "") => h("span", `swap ${cls}`.trim(), h("span", "pa", p.a ?? ""), h("span", "pr", p.r ?? p.a ?? ""));
/** One of the set's drawings, by name; nothing for a name it does not have. */
function art(name: string | undefined, tint?: Tone): SVGSVGElement | null {
  const d = drawingOf(name);
  if (!d) return null;
  const el = s("svg", { viewBox: "0 0 64 64", class: "art", "aria-hidden": "true" });
  el.style.setProperty("--t", tint ? (TINTS as Record<string, string>)[tint] ?? TONE[tint] : d.tint);
  // The set's own shapes, never anything a model wrote (src/lib/drawings: names select, nothing else).
  el.innerHTML = d.svg;
  return el;
}
/** A picture drawing and a real one (the same when only one is named), swapped by X-ray. */
function twoArt(ia?: string, ir?: string, tint?: Tone): HTMLElement | null {
  const a = art(ia ?? ir, tint);
  if (!a) return null;
  const r = art(ir ?? ia, tint);
  return h("span", "swap ico", h("span", "pa", a), h("span", "pr", r ?? a.cloneNode(true)));
}
function chip(c: Pair & { ia?: string; tint?: Tone }): HTMLElement {
  const el = h("span", "cchip", art(c.ia, c.tint), two(c));
  el.style.setProperty("--c", TONE[c.tint ?? "yellow"]);
  return el;
}
function markers(svg: SVGSVGElement, uid: string) {
  const defs = s("defs");
  const mk = (id: string, inner: string, refX: number, start = false) => {
    const m = s("marker", { id: `${uid}-${id}`, viewBox: "0 0 12 12", refX, refY: 6, markerWidth: 13, markerHeight: 13, markerUnits: "userSpaceOnUse", orient: start ? "auto-start-reverse" : "auto" });
    m.innerHTML = inner; // fixed shapes, written here
    defs.append(m);
  };
  mk("ah", '<path d="M1 1.5L11 6L1 10.5z" fill="#80848d"/>', 10);
  mk("ahl", '<path d="M1 1.5L11 6L1 10.5z" fill="#f3d77a"/>', 10);
  mk("ahb", '<path d="M1 1.5L11 6L1 10.5z" fill="#9fd3f0"/>', 10);
  mk("tri", '<path d="M1 1L11 6L1 11z" fill="#17181a" stroke="#9da0a8" stroke-width="1.3"/>', 11);
  mk("dia", '<path d="M1 6L6 2.2L11 6L6 9.8z" fill="#17181a" stroke="#9da0a8" stroke-width="1.3"/>', 11, true);
  mk("crow", '<path d="M1 6L11 1M1 6L11 6M1 6L11 11" stroke="#9da0a8" stroke-width="1.4" fill="none"/>', 11);
  mk("one", '<path d="M8 1.5L8 10.5" stroke="#9da0a8" stroke-width="1.6"/>', 11, true);
  svg.append(defs);
}
/** A line drawn on from nothing to whole, after `delay` seconds; then back to its own dashes. */
function drawOn(p: SVGPathElement, delay: number, dash?: string) {
  if (!motion()) { p.style.strokeDasharray = dash ?? "none"; p.style.strokeDashoffset = "0"; return; }
  const len = p.getTotalLength();
  p.style.transition = "none"; p.style.strokeDasharray = `${len}`; p.style.strokeDashoffset = `${len}`;
  void p.getBoundingClientRect();
  p.style.transition = `stroke-dashoffset .75s cubic-bezier(.45,.05,.35,1) ${delay}s, stroke .3s, opacity .3s`;
  p.style.strokeDashoffset = "0";
  window.setTimeout(() => { p.style.strokeDasharray = dash ?? "none"; }, (0.8 + delay) * 1000);
}
/** Placed where it belongs without travelling there: a first placement, or a new size. */
function settle(el: HTMLElement | SVGElement, place: () => void) {
  el.style.transition = "none"; place(); void el.getBoundingClientRect(); el.style.transition = "";
}

export function makeStage(stage: HTMLElement, scene: KindScene, uid: string): StageApi {
  stage.replaceChildren(h("span", "place", two({ a: scene.place || scene.title, r: scene.language ? `${scene.language} · for real` : "for real" })));
  const runners: HTMLElement[] = [];
  const clearRunners = () => { while (runners.length) runners.pop()?.remove(); };
  /** Something running along a path: a dot, or the drawing an arrow carries. */
  const runner = (d: string, carry: string | undefined, delay: number) => {
    if (!motion()) return;
    const drawing = art(carry);
    const r = h("div", drawing ? "runner" : "runner dot", drawing);
    r.style.offsetPath = `path("${d}")`;
    r.style.animationDelay = `${delay}s`;
    stage.append(r);
    runners.push(r);
  };
  const body = { timeline, flow, containers, compare, graph, sequence }[scene.kind] as (sc: KindScene) => Omit<StageApi, "dispose">;
  const api = body(scene);
  return { ...api, update(i, o) { clearRunners(); api.update(i, o); }, relayout(i, final) { clearRunners(); api.relayout(i, final); }, dispose: () => { clearRunners(); stage.replaceChildren(); } };

  /* ── Timeline: when, and for how long ── */
  function timeline(sc: KindScene) {
    const t = sc as TimelineScene & KindScene;
    const n = t.marks.length;
    const box = h("div", "tl"), axis = h("div", "axis"), lanes = h("div", "lanes-l"), track = h("div", "track");
    axis.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
    for (const m of t.marks) axis.append(two(m));
    box.append(h("span"), axis, lanes, track);
    stage.append(box);
    const x = (m: number) => (m / n) * 100;
    if (t.band) {
      const b = h("div", "band", h("span", "lbl", two(t.band)));
      b.style.left = `${x(t.band.from)}%`; b.style.width = `${x(t.band.to + 1) - x(t.band.from)}%`;
      track.append(b);
    }
    const now = h("div", "now");
    track.append(now);
    const R: Record<string, { bar: HTMLElement; dangle: HTMLElement; tag: HTMLElement; lane: HTMLElement }> = {};
    t.rows.forEach((row, j) => {
      lanes.append(h("div", "lane-l", twoArt(row.ia, row.ir, row.tint), two(row, "nm")));
      const lane = h("div", "lane");
      lane.style.top = `${((j + 0.5) / t.rows.length) * 100}%`;
      const bar = h("div", "bar", two(row));
      bar.style.background = TONE[row.tone ?? (row.borrows ? "blue" : "yellow")];
      const dangle = h("div", "bar dangle");
      const tag = h("span", "chipst tag", h("span", "pa"), h("span", "pr"));
      lane.append(bar, dangle, tag);
      track.append(lane);
      R[row.id] = { bar, dangle, tag, lane };
    });
    function update(i: number, o: StageOpts = {}) {
      track.querySelectorAll(".x").forEach((e) => e.remove());
      const st = t.steps[Math.max(i, 0)];
      const at = i < 0 ? 0 : st.at;
      [...axis.children].forEach((c, j) => c.classList.toggle("on", j === at && i >= 0));
      now.style.transform = `translateX(${whole((track.clientWidth * (x(at) + 50 / n)) / 100)}px)`;
      const bars = i < 0 ? {} : st.bars;
      for (const row of t.rows) {
        const r = R[row.id], b = bars[row.id];
        if (!b) { r.bar.style.opacity = "0"; r.bar.style.transform = "scaleX(0)"; r.dangle.style.opacity = "0"; r.tag.style.opacity = "0"; continue; }
        const start = x(b[0]), end = b[1] === null ? x(at) + 50 / n : x(b[1]) + 100 / n;
        let solid = end, dangling: number | null = null;
        const owner = row.borrows ? bars[row.borrows] : undefined;
        if (owner && owner[1] !== null) { const ownerEnd = x(owner[1]) + 100 / n; if (end > ownerEnd) { solid = ownerEnd; dangling = end; } }
        r.bar.style.left = `${start}%`; r.bar.style.width = `${Math.max(solid - start, 0.1)}%`; r.bar.style.transform = "scaleX(1)"; r.bar.style.opacity = "1";
        r.bar.classList.toggle("ended", b[1] !== null);
        r.dangle.style.left = `${solid}%`; r.dangle.style.width = dangling ? `${dangling - solid}%` : "0"; r.dangle.style.opacity = dangling ? "1" : "0";
        const tag = i >= 0 ? st.tags?.[row.id] : undefined;
        r.tag.style.opacity = tag ? "1" : "0"; r.tag.style.left = `${dangling ?? solid}%`;
        if (tag) { (r.tag.firstChild as HTMLElement).textContent = tag.a; (r.tag.lastChild as HTMLElement).textContent = tag.r; r.tag.className = `chipst tag ${tag.tone ?? ""}`; }
      }
      if (i >= 0 && st.stop && !o.hold) {
        const last = R[t.rows[t.rows.length - 1].id].lane;
        const mark = h("div", "x", art("bug") ?? "✕");
        mark.style.left = `${x(at) + 50 / n}%`; mark.style.top = last.style.top;
        track.append(mark);
      }
    }
    return { update, relayout: (i: number, final: boolean) => settle(now, () => update(i, { final, still: true })) };
  }

  /* ── Flow: in order, round again ── */
  function flow(sc: KindScene) {
    const f = sc as FlowScene & KindScene;
    const svg = s("svg", { class: "track" });
    const ring = s("ellipse", { class: "ring" }), dash = s("ellipse", { class: "ring dash" });
    svg.append(ring, dash);
    stage.append(svg);
    const N: Record<string, HTMLElement> = {};
    for (const st of f.stops) { const el = h("div", "node", twoArt(st.ia, st.ir, st.tint), two(st, "nm")); stage.append(el); N[st.id] = el; }
    const cargo = h("span", "cargo");
    const mover = h("div", "mover", twoArt(f.mover.ia, f.mover.ir, f.mover.tint), h("span", "nm", two(f.mover)), cargo);
    stage.append(mover);
    let placed = false, lastCarry = "";
    const at = (k: number, W: number, H: number) => { const a = Math.PI + (k * 2 * Math.PI) / f.stops.length; return [W / 2 + W * 0.36 * Math.cos(a), H * 0.54 + H * 0.31 * Math.sin(a)]; };
    function layout() {
      const W = stage.clientWidth, H = stage.clientHeight;
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      for (const e of [ring, dash]) { e.setAttribute("cx", `${W / 2}`); e.setAttribute("cy", `${H * 0.54}`); e.setAttribute("rx", `${W * 0.36}`); e.setAttribute("ry", `${H * 0.31}`); }
      f.stops.forEach((st, k) => { const [px, py] = at(k, W, H); const el = N[st.id]; el.style.transform = `translate(${whole(px - el.offsetWidth / 2)}px, ${whole(py - el.offsetHeight / 2)}px)`; });
    }
    function update(i: number, o: StageOpts = {}) {
      layout();
      const W = stage.clientWidth, H = stage.clientHeight;
      const st = f.steps[Math.max(i, 0)];
      const k = Math.max(0, f.stops.findIndex((x) => x.id === (i < 0 ? f.stops[0].id : st.at)));
      const [px, py] = at(k, W, H);
      // Beside its stop, a little way in towards the middle, so neither covers the other.
      const mx = px + (W / 2 - px) * 0.34, my = py + (H * 0.54 - py) * 0.34;
      const place = () => { mover.style.transform = `translate(${whole(Math.max(6, Math.min(W - mover.offsetWidth - 6, mx - mover.offsetWidth / 2)))}px, ${whole(my - mover.offsetHeight / 2)}px)`; };
      if (!placed || o.still) { settle(mover, place); placed = true; } else place();
      for (const s2 of f.stops) { const lit = i >= 0 && s2.id === st.at; N[s2.id].classList.toggle("lit", lit && !o.final); N[s2.id].classList.toggle("dimmed", i >= 0 && !lit && !o.final); }
      const key = i < 0 ? "" : st.carry.join();
      if (key !== lastCarry) { cargo.replaceChildren(...(i < 0 ? [] : st.carry).map((c) => { const it = f.items.find((x) => x.id === c); return it ? chip(it) : ""; })); lastCarry = key; }
    }
    return { update, relayout: (i: number, final: boolean) => update(i, { final, still: true }) };
  }

  /* ── Containers: on top, or first in line ── */
  function containers(sc: KindScene) {
    const c = sc as ContainersScene & KindScene;
    const queue = c.order === "queue";
    const holder = h("div", queue ? "holder queue" : "holder", h("span", "lbl", two(c.holder)));
    const hint = h("div", "hint", h("b", "", two(queue ? { a: "The first in line goes first.", r: "First in, first out." } : { a: "Only the top one comes off.", r: "Last in, first out." })),
      h("p", "", two(queue ? { a: "Each new one joins the back; the front one leaves.", r: "Enqueue at the back, dequeue at the front." } : { a: "A new one goes on top; only the top one can leave.", r: "Push onto the top; pop from the top." })));
    stage.append(holder, hint);
    const P: Record<string, HTMLElement> = {};
    let prev: string[] = [];
    function make(id: string) {
      const it = c.items.find((x) => x.id === id)!;
      return h("div", "slot in", twoArt(it.ia, it.ir, it.tint), two(it, "nm"), it.note ? h("span", "nt", two(it.note)) : null);
    }
    function update(i: number, o: StageOpts = {}) {
      holder.querySelectorAll(".ret").forEach((e) => e.remove());
      const st = c.steps[Math.max(i, 0)];
      const inside = i < 0 ? [] : st.items;
      const size = queue ? holder.clientWidth / 5.2 : Math.max(48, holder.clientHeight / 5.4);
      for (const id of prev) if (!inside.includes(id) && P[id]) { const el = P[id]; el.classList.add("out"); el.classList.remove("top"); window.setTimeout(() => el.remove(), motion() ? 600 : 0); delete P[id]; }
      inside.forEach((id, k) => {
        if (!P[id]) { P[id] = make(id); holder.append(P[id]); void P[id].offsetWidth; }
        const el = P[id];
        if (queue) { el.style.left = `${whole(8 + k * size)}px`; el.style.width = `${whole(size - 8)}px`; el.style.bottom = ""; el.style.height = ""; }
        else { el.style.bottom = `${whole(8 + k * size)}px`; el.style.height = `${whole(size - 8)}px`; el.style.left = ""; el.style.width = ""; }
        el.classList.remove("in");
        const edge = queue ? k === 0 : k === inside.length - 1;
        el.classList.toggle("top", edge);
        el.classList.toggle("dimmed", !o.final && !edge && inside.length > 1);
      });
      if (i >= 0 && st.out && !o.hold) holder.append(h("div", "ret", "↓ ", two(st.out)));
      prev = inside;
    }
    return { update, relayout: (i: number, final: boolean) => update(i, { final, still: true }) };
  }

  /* ── Compare: which is bigger, and by how much ── */
  function compare(sc: KindScene) {
    const c = sc as CompareScene & KindScene;
    const box = h("div", "cmp");
    const legend = h("div", "legend-row");
    c.series.forEach((sr, k) => { const sw = h("span", "sw"); sw.style.background = TONE[sr.tint ?? (["yellow", "green", "blue"] as Tone[])[k]]; legend.append(h("span", "", sw, twoArt(sr.ia, sr.ir, sr.tint), two(sr))); });
    const plot = h("div", "plot"), marks = h("div", "marks");
    const max = Math.max(...c.series.flatMap((sr) => sr.values)) * 1.1 || 1;
    const G: HTMLElement[][] = [];
    const fmt = (v: number) => `${c.unit}${Number.isInteger(v) ? v : v.toFixed(2)}`;
    c.points.forEach((p, y) => {
      const g = h("div", "grp");
      G.push(c.series.map((sr, k) => { const b = h("div", "b hide", h("span", "", fmt(sr.values[y]))); b.style.height = `${(sr.values[y] / max) * 100}%`; b.style.background = TONE[sr.tint ?? (["yellow", "green", "blue"] as Tone[])[k]]; g.append(b); return b; }));
      plot.append(g);
      marks.append(two(p));
    });
    box.append(legend, plot, marks);
    stage.append(box);
    function update(i: number, o: StageOpts = {}) {
      plot.querySelectorAll(".gap").forEach((e) => e.remove());
      const st = c.steps[Math.max(i, 0)];
      const upto = i < 0 ? -1 : st.upto;
      G.forEach((bars, y) => bars.forEach((b) => { b.classList.toggle("hide", y > upto); b.classList.toggle("dimmed", !o.final && y < upto); }));
      [...marks.children].forEach((m, y) => m.classList.toggle("on", y === upto));
      if (i >= 0 && st.gap) {
        const vals = c.series.map((sr) => sr.values[upto]);
        const lo = Math.min(...vals), hi = Math.max(...vals);
        const g = G[upto][0].parentElement!;
        const gap = h("div", "gap", h("b", "", `+${fmt(hi - lo)}`));
        gap.style.left = `${whole(g.offsetLeft + g.offsetWidth / 2 + 30)}px`; gap.style.bottom = `${(lo / max) * 100}%`; gap.style.height = `${((hi - lo) / max) * 100}%`;
        plot.append(gap);
      }
    }
    return { update, relayout: (i: number, final: boolean) => update(i, { final, still: true }) };
  }

  /* ── Graph: flowchart, state machine, class, ER, mind map ── */
  function graph(sc: KindScene) {
    const g = sc as GraphScene & KindScene;
    const dir = g.type === "mindmap" ? "radial" : g.type === "class" ? "TB" : "LR";
    const svg = s("svg", { class: "dg" });
    markers(svg, uid);
    stage.append(svg);
    const first = (key: string) => g.steps.findIndex((st) => st.show.includes(key));
    type NodeBox = { el: HTMLElement; d: GraphNode; at: number; inner: HTMLElement | null; x: number; y: number; w: number; h: number; shown: boolean };
    const NODES: Record<string, NodeBox> = {};
    for (const n of g.nodes) {
      // Shapes as s-<shape>: plain names such as root or end are the app's own classes.
      const el = h("div", `dn s-${n.shape} hid`);
      if (n.tint) el.style.setProperty("--c", TONE[n.tint]);
      let inner: HTMLElement | null = null;
      if (n.shape === "class" || n.shape === "entity") {
        el.append(h("div", "hd", twoArt(n.ia, n.ir, n.tint), two(n, "lbl")));
        if (n.rows?.length) el.append(h("div", "sec", ...n.rows.map((r) => { const key = /^(PK|FK)\s+/.exec(r); return h("div", "", key ? h("span", key[1].toLowerCase(), `${key[1]} `) : null, key ? r.slice(key[0].length) : r); })));
      } else if (n.shape !== "start" && n.shape !== "end") {
        const into = n.shape === "diamond" ? (inner = h("span", "in")) : el;
        const ico = twoArt(n.ia, n.ir, n.tint);
        if (ico) into.append(ico);
        into.append(two(n, "lbl"));
        if (inner) el.append(inner);
      }
      stage.append(el);
      NODES[n.id] = { el, d: n, at: first(n.id), inner, x: 0, y: 0, w: 0, h: 0, shown: false };
    }
    const EDGES = g.edges.map((e) => {
      const key = `${e.from}-${e.to}`;
      const p = s("path", { class: "e hid" });
      if (e.kind === "inherit") p.setAttribute("marker-end", `url(#${uid}-tri)`);
      if (e.kind === "has") p.setAttribute("marker-start", `url(#${uid}-dia)`);
      if (e.kind === "onemany") { p.setAttribute("marker-start", `url(#${uid}-one)`); p.setAttribute("marker-end", `url(#${uid}-crow)`); }
      svg.append(p);
      const lab = e.a || e.r ? h("div", "elabel hid", two(e)) : null;
      if (lab) stage.append(lab);
      const at = e.back ? (first(key) >= 0 ? first(key) : Math.max(NODES[e.from].at, NODES[e.to].at)) : Math.max(NODES[e.from].at, NODES[e.to].at, first(key));
      return { key, e, p, lab, at, d: "", shown: false };
    });
    function layered() {
      const fwd = g.edges.filter((e) => !e.back && e.kind !== "inherit");
      const rank: Record<string, number> = Object.fromEntries(g.nodes.map((n) => [n.id, 0]));
      for (let k = 0; k < g.nodes.length; k++) for (const e of fwd) rank[e.to] = Math.max(rank[e.to], rank[e.from] + 1);
      // Inheritance points up to the parent: the parent sits a rank above its children.
      for (let k = 0; k < g.nodes.length; k++) for (const e of g.edges) if (e.kind === "inherit") rank[e.from] = Math.max(rank[e.from], rank[e.to] + 1);
      for (const n of g.nodes) if (n.rank !== undefined) rank[n.id] = n.rank;
      const by: Record<number, GraphNode[]> = {};
      for (const n of g.nodes) (by[rank[n.id]] ??= []).push(n);
      const pos: Record<string, { rank: number; lane: number }> = {};
      // Nodes the professor placed keep their place; the rest of a column share what is left, evenly.
      for (const ns of Object.values(by)) {
        const free = ns.filter((n) => n.lane === undefined);
        for (const n of ns) pos[n.id] = { rank: rank[n.id], lane: n.lane ?? (free.indexOf(n) + 1) / (free.length + 1) };
      }
      return pos;
    }
    function radial() {
      const pos: Record<string, { fx: number; fy: number }> = {};
      const root = g.nodes.find((n) => n.shape === "root") ?? g.nodes[0];
      pos[root.id] = { fx: 0.5, fy: 0.53 };
      const topics = g.nodes.filter((n) => n.of === root.id);
      topics.forEach((t, i) => {
        const a = -Math.PI * 0.75 + (i * 2 * Math.PI) / Math.max(topics.length, 1);
        pos[t.id] = { fx: 0.5 + 0.25 * Math.cos(a), fy: 0.53 + 0.25 * Math.sin(a) };
        const leaves = g.nodes.filter((n) => n.of === t.id);
        leaves.forEach((l, k) => { const b = a + (k - (leaves.length - 1) / 2) * 0.42; pos[l.id] = { fx: 0.5 + 0.42 * Math.cos(b), fy: 0.53 + 0.41 * Math.sin(b) }; });
      });
      for (const n of g.nodes) pos[n.id] ??= { fx: 0.5, fy: 0.9 };
      return pos;
    }
    const clip = (N: NodeBox, tx: number, ty: number): [number, number] => {
      const dx = tx - N.x, dy = ty - N.y;
      if (!dx && !dy) return [N.x, N.y];
      const k = N.d.shape === "diamond" ? 1 / (Math.abs(dx) / (N.w / 2 + 3) + Math.abs(dy) / (N.h / 2 + 3)) : Math.min((N.w / 2 + 5) / Math.abs(dx || 1e-9), (N.h / 2 + 5) / Math.abs(dy || 1e-9));
      return [N.x + dx * k, N.y + dy * k];
    };
    function layout() {
      const W = stage.clientWidth, H = stage.clientHeight;
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      const isRadial = dir === "radial";
      const rad = isRadial ? radial() : null;
      const lay = isRadial ? null : layered();
      const R = lay ? Math.max(...Object.values(lay).map((p) => p.rank)) + 1 : 1;
      const padX = W * 0.04, padT = 44 + H * 0.03, padB = H * 0.06;
      const per: Record<number, number> = {};
      if (lay) for (const p of Object.values(lay)) per[p.rank] = (per[p.rank] ?? 0) + 1;
      // A long left-to-right diagram in a narrow stage folds onto a second row rather than squeezing its boxes.
      const rows = lay && dir === "LR" && (W - 2 * padX) / R < 125 ? 2 : 1;
      const cols = Math.ceil(R / rows);
      const colW = isRadial ? W / 5.2 : dir === "LR" ? (W - 2 * padX) / cols : (W - 2 * padX) / Math.max(...Object.values(per), 1);
      const base = parseFloat(getComputedStyle(stage).fontSize) || 13;
      const fs = Math.max(base * 0.95, Math.min(base * 1.6, H * 0.021, colW / 9.5));
      const wrapAt = Math.max(fs * 6.5, colW * (dir === "LR" ? 0.8 : 0.7));
      for (const N of Object.values(NODES)) {
        N.el.style.setProperty("--dfs-k", `${(fs / base).toFixed(3)}`);
        const sh = N.d.shape;
        if (sh === "diamond" && N.inner) {
          // Words fit inside a diamond when it is twice their box each way.
          N.inner.style.maxWidth = `${whole(Math.max(fs * 5, wrapAt * 0.52))}px`;
          const iw = N.inner.offsetWidth, ih = N.inner.offsetHeight;
          N.el.style.width = `${whole(Math.round(iw * 2 + 8))}px`;
          N.el.style.height = `${whole(Math.round(Math.max(ih * 2 + 8, iw * 0.95)))}px`;
        } else if (!["start", "end", "leaf", "root"].includes(sh)) {
          N.el.style.maxWidth = `${whole(wrapAt)}px`;
          N.el.classList.toggle("stack", !!N.d.ia && ["box", "oval", "state"].includes(sh) && colW < 230);
        }
        let x: number, y: number;
        if (rad) { x = rad[N.d.id].fx * W; y = rad[N.d.id].fy * H; }
        else if (dir === "LR") { const p = lay![N.d.id], col = p.rank % cols, row = Math.floor(p.rank / cols), band = (H - padT - padB) / rows; x = padX + ((col + 0.5) / cols) * (W - 2 * padX); y = padT + row * band + p.lane * band; }
        else { const p = lay![N.d.id]; y = padT + ((p.rank + 0.5) / R) * (H - padT - padB); x = padX + p.lane * (W - 2 * padX); }
        const w = N.el.offsetWidth, hh = N.el.offsetHeight;
        x = Math.max(w / 2 + 6, Math.min(W - w / 2 - 6, x)); y = Math.max(hh / 2 + 32, Math.min(H - hh / 2 - 6, y));
        Object.assign(N, { x, y, w, h: hh });
        settle(N.el, () => { N.el.style.translate = `${whole(x - w / 2)}px ${whole(y - hh / 2)}px`; });
      }
      for (const E of EDGES) {
        const A = NODES[E.e.from], B = NODES[E.e.to];
        let d: string;
        if (E.e.back) {
          if (dir === "LR") { const y0 = Math.min(A.y - A.h / 2, B.y - B.h / 2) - (H * 0.17) / rows; d = `M${A.x} ${A.y - A.h / 2} C${A.x} ${y0} ${B.x} ${y0} ${B.x} ${B.y - B.h / 2 - 3}`; }
          else { const x0 = Math.max(A.x + A.w / 2, B.x + B.w / 2) + W * 0.12; d = `M${A.x + A.w / 2} ${A.y} C${x0} ${A.y} ${x0} ${B.y} ${B.x + B.w / 2 + 3} ${B.y}`; }
        } else {
          const [ax, ay] = clip(A, B.x, B.y), [bx, by] = clip(B, A.x, A.y);
          d = Math.abs(bx - ax) >= Math.abs(by - ay) ? `M${ax} ${ay} C${(ax + bx) / 2} ${ay} ${(ax + bx) / 2} ${by} ${bx} ${by}` : `M${ax} ${ay} C${ax} ${(ay + by) / 2} ${bx} ${(ay + by) / 2} ${bx} ${by}`;
        }
        E.d = d; E.p.setAttribute("d", d);
        if (isRadial) { const tint = A.d.tint ?? B.d.tint; E.p.style.stroke = tint ? TONE[tint] : "#9da0a8"; E.p.style.strokeWidth = A.d.shape === "root" ? "3" : "2"; }
        if (E.lab) {
          const m = E.p.getPointAtLength(E.p.getTotalLength() / 2);
          E.lab.style.left = `${whole(m.x)}px`; E.lab.style.top = `${whole(m.y)}px`;
          E.lab.classList.toggle("above", !E.e.back && Math.abs(B.y - A.y) < Math.abs(B.x - A.x) * 0.35);
        }
      }
    }
    let laid = false;
    function update(i: number, o: StageOpts = {}) {
      if (!laid) { layout(); laid = true; }
      const live = !o.final && !o.hold;
      let k = 0;
      for (const N of Object.values(NODES)) {
        const on = N.at >= 0 && N.at <= i;
        const fresh = on && !N.shown && N.at === i && !o.still;
        N.el.style.transitionDelay = fresh ? `${k++ * 0.2 * motion()}s` : "0s";
        if (on && !fresh && !N.shown) settle(N.el, () => N.el.classList.remove("hid"));
        N.el.classList.toggle("hid", !on);
        N.el.classList.toggle("lit", on && N.at === i && live);
        N.shown = on;
      }
      let r = 0;
      for (const E of EDGES) {
        const on = E.at >= 0 && E.at <= i, now = on && E.at === i && live;
        const fresh = on && !E.shown && E.at === i && !o.still;
        if (on && !fresh && !E.shown) { E.p.style.transition = "none"; E.p.style.strokeDasharray = E.e.back ? "7 6" : "none"; E.p.style.strokeDashoffset = "0"; }
        E.p.classList.toggle("hid", !on); E.p.classList.toggle("lit", now); E.p.classList.toggle("past", on && !now && !o.final);
        if (E.e.kind === "arrow") E.p.setAttribute("marker-end", `url(#${uid}-${now ? (!!stage.closest(".xray") ? "ahb" : "ahl") : "ah"})`);
        if (E.e.back && !fresh) E.p.style.strokeDasharray = "7 6";
        const delay = fresh ? k++ * 0.2 * motion() + 0.15 : 0;
        if (fresh) drawOn(E.p, delay, E.e.back ? "7 6" : undefined);
        if (E.lab) { E.lab.classList.toggle("hid", !on); E.lab.classList.toggle("lit", now); E.lab.style.transitionDelay = fresh ? `${delay + 0.5}s` : "0s"; }
        if (now && r < 3 && dir !== "radial") { runner(E.d, E.e.carry, delay + 0.8); r++; }
        E.shown = on;
      }
    }
    return { update, relayout: (i: number, final: boolean) => { layout(); update(i, { final, still: true }); } };
  }

  /* ── Sequence: who says what to whom, in order ── */
  function sequence(sc: KindScene) {
    const q = sc as SequenceScene & KindScene;
    const svg = s("svg", { class: "dg" });
    markers(svg, uid);
    stage.append(svg);
    const first = (key: string) => q.steps.findIndex((st) => st.show.includes(key));
    const chipOf = (key: string) => q.chips.find((c) => c.id === key);
    const xs = q.parts.length === 2 ? [0.37, 0.65] : q.parts.map((_, k) => 0.2 + (k * 0.6) / (q.parts.length - 1));
    const P = q.parts.map((p, k) => { const el = h("div", "sq-p", twoArt(p.ia, p.ir, p.tint), two(p, "nm")); const life = s("path", { class: "life" }); svg.append(life); stage.append(el); return { el, p, life, fx: xs[k], x: 0 }; });
    const partAt = (key: string) => P.find((x) => x.p.id === key)!;
    const legend = h("div", "legend", h("span", "eyebrow", "Key"));
    stage.append(legend);
    const LEG: Record<string, { el: HTMLElement; at: number }> = {};
    const useChip = (key: string, at: number) => {
      const c = chipOf(key);
      if (!c) return;
      if (!LEG[key]) { LEG[key] = { el: h("div", "it hid", chip(c)), at }; legend.append(LEG[key].el); }
      else LEG[key].at = Math.min(LEG[key].at < 0 ? at : LEG[key].at, at < 0 ? LEG[key].at : at);
    };
    const BANDS = q.phases.map((ph, n) => { const el = h("div", "band hid", h("div", "bl", h("b", "", `${n + 1}`), two(ph))); el.style.setProperty("--c", TONE[ph.tone]); stage.append(el); return { ph, el }; });
    const ROWS = q.rows.map((r, idx) => {
      const at = first(r.id);
      if ("divider" in r) { const el = h("div", "divider hid", h("span", "", two(r))); stage.append(el); return { r, idx, at, el, path: null, lab: null, d: "", shown: false }; }
      const path = s("path", { class: "e hid" });
      svg.append(path);
      const lab = h("div", "sq-l hid", two(r));
      if (r.carry) { const c = chipOf(r.carry); if (c) { lab.append(chip(c)); useChip(r.carry, at); } }
      stage.append(lab);
      return { r, idx, at, el: null, path, lab, d: "", shown: false };
    });
    const rowOf = (key: string) => ROWS.find((x) => x.r.id === key)!;
    const INS = q.insets.map((ins) => {
      const at = first(ins.id);
      const flowEl = h("div", "flow");
      ins.ins.forEach((c, n) => { const cc = chipOf(c); if (cc) { if (n) flowEl.append(h("span", "op", "+")); flowEl.append(chip(cc)); } });
      const out = chipOf(ins.out);
      if (out) flowEl.append(h("span", "op", "→"), chip(out));
      [...ins.ins, ins.out].forEach((c) => useChip(c, at));
      const el = h("div", "inset hid", flowEl, h("div", "cap2", two(ins)));
      stage.append(el);
      return { ins, el, at };
    });
    let yOf: (idx: number) => number = () => 0, rowH = 0;
    function layout() {
      const W = stage.clientWidth, H = stage.clientHeight;
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      const head = Math.max(H * 0.17, 84), top = head + 10, bottom = H - 8;
      rowH = (bottom - top) / ROWS.length;
      yOf = (idx) => top + rowH * (idx + 0.5);
      for (const p of P) { p.x = p.fx * W; p.el.style.left = `${whole(p.x)}px`; p.el.style.top = `${whole(Math.max(10, head * 0.08))}px`; p.life.setAttribute("d", `M${p.x} ${head} L${p.x} ${bottom}`); }
      for (const R of ROWS) {
        const y = yOf(R.idx);
        if (R.el) { const lo = Math.min(...P.map((p) => p.x)), hi = Math.max(...P.map((p) => p.x)); R.el.style.left = `${whole(lo - W * 0.1)}px`; R.el.style.width = `${whole(hi - lo + W * 0.2)}px`; R.el.style.top = `${whole(y)}px`; continue; }
        if (!("from" in R.r)) continue;
        const x1 = partAt(R.r.from).x, x2 = partAt(R.r.to).x, d = Math.sign(x2 - x1);
        R.d = `M${x1 + d * 3} ${y} L${x2 - d * 4} ${y}`;
        R.path!.setAttribute("d", R.d);
        R.lab!.style.left = `${whole((x1 + x2) / 2)}px`; R.lab!.style.top = `${whole(y - 2)}px`;
      }
      for (const B of BANDS) {
        const a = rowOf(B.ph.from), b = rowOf(B.ph.to);
        B.el.style.left = `${whole(W * 0.012)}px`; B.el.style.width = `${whole(W * 0.976)}px`; B.el.style.top = `${whole(yOf(a.idx) - rowH / 2)}px`; B.el.style.height = `${whole(rowH * (b.idx - a.idx + 1))}px`;
      }
      const leftmost = P.reduce((m, p) => (p.x < m.x ? p : m), P[0]);
      for (const I of INS) {
        const part = partAt(I.ins.side);
        const left = part === leftmost || part.fx < 0.5;
        I.el.style.top = `${whole(yOf(rowOf(I.ins.row).idx) - rowH * 0.45)}px`;
        if (left) { I.el.style.left = `${whole(W * 0.02)}px`; I.el.style.maxWidth = `${whole(part.x - W * 0.07)}px`; }
        else { I.el.style.left = `${whole(part.x + W * 0.05)}px`; I.el.style.maxWidth = `${whole(W * 0.92 - part.x)}px`; }
      }
    }
    let laid = false;
    function update(i: number, o: StageOpts = {}) {
      if (!laid) { layout(); laid = true; }
      const live = !o.final && !o.hold;
      const cur = new Set(i >= 0 && live ? q.steps[i].show : []);
      const talking = new Set<string>();
      let k = 0;
      for (const R of ROWS) {
        const on = R.at >= 0 && R.at <= i, now = on && R.at === i && live;
        if (R.el) { R.el.classList.toggle("hid", !on); continue; }
        const fresh = on && !R.shown && R.at === i && !o.still, delay = fresh ? k++ * 0.32 * motion() : 0;
        if (on && !fresh && !R.shown) { R.path!.style.transition = "none"; R.path!.style.strokeDasharray = "none"; R.path!.style.strokeDashoffset = "0"; }
        R.path!.classList.toggle("hid", !on); R.path!.classList.toggle("lit", now); R.path!.classList.toggle("past", on && !now && !o.final);
        R.path!.setAttribute("marker-end", `url(#${uid}-${now ? (!!stage.closest(".xray") ? "ahb" : "ahl") : "ah"})`);
        if (fresh) drawOn(R.path!, delay);
        R.lab!.classList.toggle("hid", !on); R.lab!.classList.toggle("lit", now); R.lab!.style.transitionDelay = fresh ? `${delay + 0.35}s` : "0s";
        if (now && "from" in R.r) { talking.add(R.r.from); talking.add(R.r.to); if (R.r.carry) runner(R.d, chipOf(R.r.carry)?.ia, delay + 0.7); }
        R.shown = on;
      }
      for (const B of BANDS) {
        const a = rowOf(B.ph.from).idx, b = rowOf(B.ph.to).idx, inside = ROWS.filter((R) => R.idx >= a && R.idx <= b);
        B.el.classList.toggle("hid", !inside.some((R) => R.at >= 0 && R.at <= i));
        B.el.classList.toggle("lit", inside.some((R) => cur.has(R.r.id)));
      }
      for (const I of INS) { const on = I.at >= 0 && I.at <= i; I.el.classList.toggle("hid", !on); I.el.classList.toggle("lit", on && I.at === i && live); if (on && I.at === i && live) talking.add(I.ins.side); }
      for (const p of P) p.el.classList.toggle("lit", talking.has(p.p.id));
      for (const L of Object.values(LEG)) L.el.classList.toggle("hid", !(L.at >= 0 && L.at <= i));
    }
    return { update, relayout: (i: number, final: boolean) => { layout(); update(i, { final, still: true }); } };
  }
}
