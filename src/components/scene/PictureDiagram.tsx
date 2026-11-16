"use client";
/**
 * A class, ER, state or flow diagram with its analogy drawn in
 * (src/lib/scene/diagram.ts): every box is an everyday thing, its drawing and
 * its everyday name over the real name it stands for (and, for a class or a
 * table, what it holds); every line says what it means in everyday words, and
 * in the real ones too while it is the line being shown or pointed at (so a
 * busy diagram stays readable).
 *
 * The boxes sit in rows (rowsOf), laid out by the page's own flow, and the
 * lines are drawn over them from where the boxes are, again on a resize.
 * Pointing at a box lights the lines that touch it. Play walks the lines one
 * at a time, as a trace does on the map: the two boxes light, a dot rides the
 * line, and the caption says the step in the picture and for real.
 * Only transform, opacity and a dash offset move (× --m).
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { drawingOf, findDrawing, isTint, LOOKS, TINTS } from "@/lib/drawings";
import { linkLine, rowsOf, type Picture, type PictureLink } from "@/lib/scene/diagram";
import Drawing from "./Drawing";
import type { Art } from "./art";
import { useFull } from "./useFull";
import "./scene.css";

type Props = { picture: Picture; speak?: (text: string) => Promise<void>; stopVoice?: () => void };
/** A line's words, cut to what fits beside its neighbours. */
const short = (text: string) => (text.length > 26 ? `${text.slice(0, 25).trimEnd()}…` : text);
type Edge = { d: string; x: number; y: number; ends?: [{ x: number; y: number }, { x: number; y: number }] };
type Side = "t" | "b" | "l" | "r";

const KIND = { flow: "Flow", state: "States", class: "Class diagram", er: "Tables and how they join" } as const;
const round = (n: number) => Math.round(n * 10) / 10;

export default function PictureDiagram({ picture, speak, stopVoice }: Props) {
  const [at, setAt] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [lit, setLit] = useState<string | null>(null);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [size, setSize] = useState(0);
  const root = useRef<HTMLElement | null>(null);
  const { full, setFull, wrap } = useFull(root);
  const run = useRef(0);
  const marker = useId().replace(/[^a-zA-Z0-9]/g, "");
  const rows = useMemo(() => rowsOf(picture), [picture]);
  const node = useMemo(() => new Map(picture.nodes.map((n) => [n.id, n])), [picture]);
  const art = useMemo(() => {
    let people = 0;
    const out = new Map<string, Art>();
    for (const n of picture.nodes) {
      const tint = isTint(n.tint) ? TINTS[n.tint] : undefined;
      if (n.draw && !drawingOf(n.ia)) out.set(n.id, { name: null, shapes: n.draw, tint });
      else {
        const name = findDrawing(n.ia, n.a);
        out.set(n.id, drawingOf(name)?.person ? { name, look: { ...LOOKS[people++ % LOOKS.length], ...(tint ? { tint } : {}) } } : { name, tint });
      }
    }
    return out;
  }, [picture]);
  const last = picture.links.length - 1;
  const now: PictureLink | undefined = picture.links[at];
  const said = now ? linkLine(picture, now) : null;

  const stop = useCallback(() => {
    run.current++;
    stopVoice?.();
    setPlaying(false);
  }, [stopVoice]);
  const go = useCallback(
    (n: number) => {
      stop();
      setAt(Math.max(-1, Math.min(last, n)));
    },
    [last, stop],
  );
  const play = useCallback(
    async (from: number) => {
      const my = ++run.current;
      setPlaying(true);
      for (let n = from; n <= last; n++) {
        if (my !== run.current) return;
        setAt(n);
        const line = linkLine(picture, picture.links[n]);
        const text = `${line.a}. ${line.r}.`;
        if (speak) await speak(text);
        else await new Promise((r) => setTimeout(r, Math.min(5000, 1300 + text.length * 26)));
        if (my !== run.current) return;
        await new Promise((r) => setTimeout(r, 300));
      }
      if (my === run.current) setPlaying(false);
    },
    [last, picture, speak],
  );
  const toggle = useCallback(() => (playing ? stop() : void play(at >= last ? 0 : Math.max(0, at))), [playing, stop, play, at, last]);
  useEffect(() => () => void run.current++, []);
  // The line being walked is kept in view: a tall diagram scrolls to where it arrives.
  useEffect(() => {
    if (at < 0) return;
    const to = picture.links[at]?.to;
    const el = to ? root.current?.querySelector<HTMLElement>(`[data-node="${to}"]`) : null;
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [at, picture]);

  useEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setSize((n) => n + 1));
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [full]);

  // The lines, from where the boxes are: each leaves the side of its box that faces the other, and several
  // lines on one side share it out, in the order of where they go, so they do not cross at the box.
  useLayoutEffect(() => {
    const body = root.current?.querySelector<HTMLElement>(".pd-body");
    if (!body) return;
    const box = body.getBoundingClientRect();
    const rect = new Map<string, { l: number; t: number; r: number; b: number; cx: number; cy: number }>();
    body.querySelectorAll<HTMLElement>("[data-node]").forEach((el) => {
      const r = el.getBoundingClientRect();
      rect.set(el.dataset.node!, { l: r.left - box.left, t: r.top - box.top, r: r.right - box.left, b: r.bottom - box.top, cx: r.left - box.left + r.width / 2, cy: r.top - box.top + r.height / 2 });
    });
    const rowOf = new Map<string, number>();
    rows.forEach((row, k) => row.forEach((n) => rowOf.set(n, k)));
    const sides = picture.links.map((l): [Side, Side] => {
      const [a, b] = [rowOf.get(l.from)!, rowOf.get(l.to)!];
      if (a < b) return ["b", "t"];
      if (a > b) return ["t", "b"];
      return rect.get(l.from)!.cx < rect.get(l.to)!.cx ? ["r", "l"] : ["l", "r"];
    });
    const shared = new Map<string, { link: number; toward: number }[]>();
    picture.links.forEach((l, k) => {
      for (const [who, side, other] of [[l.from, sides[k][0], l.to], [l.to, sides[k][1], l.from]] as const) {
        const o = rect.get(other)!;
        const list = shared.get(`${who}:${side}`) ?? [];
        list.push({ link: k, toward: side === "t" || side === "b" ? o.cx : o.cy });
        shared.set(`${who}:${side}`, list);
      }
    });
    for (const list of shared.values()) list.sort((x, y) => x.toward - y.toward);
    const anchor = (who: string, side: Side, k: number) => {
      const r = rect.get(who)!;
      const list = shared.get(`${who}:${side}`)!;
      const f = (list.findIndex((x) => x.link === k) + 1) / (list.length + 1);
      return side === "t" || side === "b" ? { x: r.l + (r.r - r.l) * f, y: side === "t" ? r.t : r.b } : { x: side === "l" ? r.l : r.r, y: r.t + (r.b - r.t) * f };
    };
    const next = picture.links.map((l, k): Edge => {
      const p = anchor(l.from, sides[k][0], k);
      const q = anchor(l.to, sides[k][1], k);
      const upDown = sides[k][0] === "t" || sides[k][0] === "b";
      let d: string;
      let mid: { x: number; y: number };
      if (upDown) {
        const dy = (q.y - p.y) / 2;
        d = `M${round(p.x)} ${round(p.y)}C${round(p.x)} ${round(p.y + dy)} ${round(q.x)} ${round(q.y - dy)} ${round(q.x)} ${round(q.y)}`;
        // Lines that leave one box together are still together half way: their words go nearer the end where they have parted.
        const fanOut = shared.get(`${l.from}:${sides[k][0]}`)!.length > 1;
        const fanIn = shared.get(`${l.to}:${sides[k][1]}`)!.length > 1;
        const turn = (who: string, side: Side) => shared.get(`${who}:${side}`)!.findIndex((x) => x.link === k) % 2;
        const far = Math.abs(rowOf.get(l.from)! - rowOf.get(l.to)!) > 1;
        const t = far ? 0.94 - 0.05 * turn(l.to, sides[k][1]) : fanOut && !fanIn ? 0.84 - 0.2 * turn(l.from, sides[k][0]) : fanIn && !fanOut ? 0.16 + 0.2 * turn(l.to, sides[k][1]) : 0.5;
        const u = 1 - t;
        // A point on the curve (its two middle points sit straight above and below its ends).
        mid = { x: (u * u * u + 3 * u * u * t) * p.x + (3 * u * t * t + t * t * t) * q.x, y: u * u * u * p.y + 3 * u * u * t * (p.y + dy) + 3 * u * t * t * (q.y - dy) + t * t * t * q.y };
      } else {
        const row = rows[rowOf.get(l.from)!];
        const apart = Math.abs(row.indexOf(l.from) - row.indexOf(l.to)) > 1;
        // Neighbours are joined straight; past a box in between, the line arcs over the row.
        const lift = apart ? Math.min(rect.get(l.from)!.t, rect.get(l.to)!.t) - 30 : (p.y + q.y) / 2 - 14;
        d = `M${round(p.x)} ${round(p.y)}Q${round((p.x + q.x) / 2)} ${round(lift)} ${round(q.x)} ${round(q.y)}`;
        mid = { x: (p.x + q.x) / 2, y: 0.25 * p.y + 0.5 * lift + 0.25 * q.y };
      }
      const out = sides[k][0] === "b" ? 14 : sides[k][0] === "t" ? -6 : 0;
      const back = sides[k][1] === "t" ? -6 : sides[k][1] === "b" ? 14 : 0;
      return { d, x: round(mid.x), y: round(mid.y + 4), ...(l.ends ? { ends: [{ x: round(p.x + 9), y: round(p.y + out) }, { x: round(q.x + 9), y: round(q.y + back) }] } : {}) };
    });
    setEdges((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
  }, [picture, rows, size, full]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement;
    const act = e.key === "ArrowRight" ? () => go(at + 1) : e.key === "ArrowLeft" ? () => go(at - 1) : e.key === "Escape" && full ? () => setFull(false) : e.key === " " && !target.closest("button") ? toggle : null;
    if (!act) return;
    e.preventDefault();
    e.stopPropagation();
    act();
  };
  // A line is lit while it is the step being shown, or while one of its boxes is pointed at.
  const lines = (k: number) => {
    const l = picture.links[k];
    return k === at ? " now" : lit && (l.from === lit || l.to === lit) ? " near" : at >= 0 || lit ? " far" : "";
  };
  const boxes = (n: string) => (now && (now.from === n || now.to === n) ? " now" : lit === n ? " near" : now ? " far" : "");

  return wrap(
    <section className={`wscene wpic${full ? " full" : ""}`} ref={root} aria-label={`${KIND[picture.kind]}: ${picture.title}`} tabIndex={0} onKeyDown={onKey}>
      <header>
        <span aria-hidden="true">💡</span>
        <b>{picture.title}</b>
        <span className="s-where">{KIND[picture.kind]}</span>
        <span className="s-sp" />
        <button className="ctl compact" type="button" aria-pressed={full} onClick={() => setFull((f) => !f)} title={full ? "Back into the answer (Esc)" : "Fill the window"}>
          {full ? "Smaller" : "Larger"}
        </button>
      </header>

      <div className="pd-body">
        {rows.map((row, k) => (
          <div className="pd-row" key={k}>
            {row.map((id) => {
              const n = node.get(id)!;
              return (
                <div key={id} className={`pd-node${boxes(id)}`} data-node={id} tabIndex={0} onMouseEnter={() => setLit(id)} onMouseLeave={() => setLit(null)} onFocus={() => setLit(id)} onBlur={() => setLit(null)}>
                  <Drawing {...art.get(id)!} />
                  <b>{n.a}</b>
                  <code>{n.r}</code>
                  {n.rows && (
                    <ul>
                      {n.rows.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        <svg className="pd-lines" aria-hidden="true">
          <defs>
            <marker id={`${marker}-then`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M2 1.5L8 5L2 8.5" fill="none" stroke="context-stroke" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
            <marker id={`${marker}-is`} viewBox="0 0 12 12" refX="11" refY="6" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
              <path className="hollow" d="M1 1L11 6L1 11z" stroke="context-stroke" strokeWidth="1.4" strokeLinejoin="round" />
            </marker>
            <marker id={`${marker}-has`} viewBox="0 0 14 10" refX="1" refY="5" markerWidth="10" markerHeight="7" orient="auto-start-reverse">
              <path d="M1 5L7 1L13 5L7 9z" fill="context-stroke" stroke="context-stroke" strokeWidth="1" strokeLinejoin="round" />
            </marker>
          </defs>
          {edges.map((e, k) => {
            const l = picture.links[k];
            if (!l) return null;
            const head = l.kind === "is" ? `url(#${marker}-is)` : picture.kind === "er" ? undefined : `url(#${marker}-then)`;
            return (
              <g key={k} className={`pd-line${lines(k)}`} style={{ "--i": k } as CSSProperties}>
                <path className="base" d={e.d} pathLength={1} markerEnd={head} markerStart={l.kind === "has" ? `url(#${marker}-has)` : undefined} />
                {k === at && <path className="flow" d={e.d} />}
                {k === at && <circle key={at} className="dot" r="3.5" style={{ offsetPath: `path("${e.d}")` }} />}
              </g>
            );
          })}
        </svg>
        {/* A line passes behind the boxes; its words are written over them, so none is ever hidden. */}
        <svg className="pd-lines pd-words" aria-hidden="true">
          {edges.map((e, k) => {
            const l = picture.links[k];
            if (!l) return null;
            return (
              <g key={k} className={`pd-line${lines(k)}`} style={{ "--i": k } as CSSProperties}>
                {(l.a || l.r) && (
                  <text x={e.x} y={e.y}>
                    {l.a && <tspan className="a">{short(l.a)}</tspan>}
                    {l.a && l.r && <tspan className="mid real"> · </tspan>}
                    {l.r && <tspan className={l.a ? "r real" : "r"}>{short(l.r)}</tspan>}
                  </text>
                )}
                {e.ends && l.ends && e.ends.map((p, i) => <text key={i} className="end" x={p.x} y={p.y}>{l.ends![i]}</text>)}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="say" aria-live="polite">
        <div><p className="eyebrow">In the picture</p><p>{said ? said.a : "Point at a box to see what it is joined to, or press Play to walk the lines one by one."}</p></div>
        <div><p className="eyebrow">For real</p><p>{said ? said.r : ""}</p></div>
      </div>

      <footer>
        <div className="stepper" role="toolbar" aria-label="Walk through the diagram">
          <button className="ctl compact" type="button" disabled={at <= 0} onClick={() => go(at - 1)} aria-label="Step back">◀</button>
          <button className="ctl compact primary" type="button" onClick={toggle}>{playing ? "❚❚ Pause" : at >= last ? "↺ Replay" : "▶ Play"}</button>
          <button className="ctl compact" type="button" disabled={at === last} onClick={() => go(at + 1)}>Step ▶</button>
          <span className="dots">
            {picture.links.map((_, n) => (
              <button key={n} type="button" className={n <= at ? "on" : ""} aria-label={`Line ${n + 1} of ${picture.links.length}`} aria-current={n === at ? "step" : undefined} onClick={() => go(n)} />
            ))}
          </span>
          {at >= 0 && <button className="ctl compact ghost" type="button" onClick={() => go(-1)}>Show all</button>}
        </div>
        {picture.rule && <p className="rule"><span className="eyebrow">The rule</span><b>{picture.rule}</b></p>}
        {picture.breaks && <p className="breaks"><span className="eyebrow">Where the picture breaks</span>{picture.breaks}</p>}
      </footer>
    </section>,
  );
}
