"use client";
/**
 * The scene player (mockup docs/design/analogy-scene.html): a lesson's idea as a picture that plays, in the
 * kind that fits it (src/lib/scene/kinds.ts). One frame for every kind:
 *
 * - a headline for each step, two to five words with the key one coloured; whatever the step is not about dims;
 * - the stage, as large as the space allows, its text scaled with it (one text size, zoomed, like the map);
 * - X-ray: the same places, with the real names and drawings, on blueprint;
 * - the real side: the code with the step's line lit, or the subject's facts with the step's lit, and the
 *   picture's words beside the real ones, the step's word lit;
 * - the caption, lit word by word as it is said, the real sentence under it;
 * - guess first: at a step that asks, the student picks what happens before it is shown;
 * - the rule, big, at the end, then where the picture breaks.
 *
 * The stage itself is drawn by stage.ts. ← → step, Space plays, X is X-ray, W gives the stage the whole width.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { highlight } from "@/learn/lib/highlight";
import type { KindScene } from "@/lib/scene/kinds";
import { useFull } from "../useFull";
import { makeStage, type StageApi } from "./stage";
import "@/lib/drawings/drawings.css";
import "./player.css";

type Props = {
  scene: KindScene;
  /** Where it is from: "Hello, World! · board 2 of 6". */
  where?: string;
  /** More header buttons (the Learn room's Side panels and Close). */
  controls?: ReactNode;
  /** Reads a step aloud, resolving when it has been heard. Without it, Play keeps its own time. */
  speak?: (text: string) => Promise<void>;
  stopVoice?: () => void;
  /** Whose the arrow keys are: the whole window's (the Learn stage) or only while this has the focus (in an answer). */
  keys?: "window" | "focus";
  onClose?: () => void;
};

const KIND_NAME: Record<KindScene["kind"], string> = { timeline: "Timeline", flow: "Flow", containers: "Containers", compare: "Compare", graph: "Diagram", sequence: "Sequence diagram" };
const GRAPH_NAME = { flowchart: "Flowchart", state: "State machine", class: "UML class diagram", er: "ER diagram", mindmap: "Mind map" } as const;
/** "The baker *refuses*" with the starred word coloured. */
const Headline = ({ text }: { text: string }) => (
  <>{text.split(/(\*[^*]+\*)/).map((p, k) => (p.startsWith("*") && p.endsWith("*") ? <em key={k}>{p.slice(1, -1)}</em> : p))}</>
);

export default function ScenePlayer({ scene, where, controls, speak, stopVoice, keys = "focus", onClose }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const n = scene.steps.length;
  const [i, setI] = useState(0);
  const [xray, setXray] = useState(false);
  const [wide, setWide] = useState(false);
  const [guess, setGuess] = useState(true);
  const [answered, setAnswered] = useState<{ step: number; pick: number } | null>(null);
  const [done, setDone] = useState<ReadonlySet<number>>(new Set());
  const [playing, setPlaying] = useState(false);
  const [said, setSaid] = useState<{ key: string; n: number }>({ key: "", n: 0 });
  const root = useRef<HTMLDivElement>(null);
  const stageEl = useRef<HTMLDivElement>(null);
  // The board: the scene is drawn on a canvas that drags and zooms inside the stage, as the map does.
  const canvasEl = useRef<HTMLDivElement>(null);
  const view = useRef({ x: 0, y: 0, z: 1 });
  const drag = useRef<{ id: number; x: number; y: number; vx: number; vy: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const api = useRef<StageApi | null>(null);
  /** The step on show, for a relayout from outside a render (a resize, a zoom). */
  const shownRef = useRef(0);
  const endRef = useRef(false);
  const { full, setFull, wrap } = useFull(root);

  const end = i >= n;
  const step = scene.steps[Math.min(i, n - 1)];
  /** A step that asks is held on the step before until the student has guessed (or chosen not to). */
  const asking = !end && !!step.ask && guess && !done.has(i);
  const shown = end ? n - 1 : asking ? i - 1 : i;

  // The stage is built once per scene, and moved from step to step after that.
  useLayoutEffect(() => {
    if (!canvasEl.current) return;
    api.current = makeStage(canvasEl.current, scene, uid);
    return () => api.current?.dispose();
  }, [scene, uid]);

  /**
   * Moves the canvas to the view, in step with the pointer. Zoom is never a scaled picture (a CSS scale blurs
   * text and drawings): the canvas is made `z` times the stage and the scene laid out again at that size, so
   * every letter and line is drawn at its real size, crisp at any zoom. Panning moves it by whole pixels.
   */
  const laidAt = useRef(0);
  const applyView = useCallback(() => {
    const c = canvasEl.current, st = stageEl.current;
    if (!c || !st) return;
    const { x, y, z } = view.current;
    const w = Math.round(st.clientWidth * z), h = Math.round(st.clientHeight * z);
    c.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    if (laidAt.current !== z || c.offsetWidth !== w || c.offsetHeight !== h) {
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      c.style.setProperty("--z", `${z}`);
      laidAt.current = z;
      api.current?.relayout(shownRef.current, endRef.current);
    }
  }, []);
  /** Zoom to `z`, keeping the point under (px, py) where it is. */
  const zoomTo = useCallback((z: number, px?: number, py?: number) => {
    const el = stageEl.current;
    if (!el) return;
    const v = view.current;
    const nz = Math.max(0.4, Math.min(3, z));
    const cx = px ?? el.clientWidth / 2, cy = py ?? el.clientHeight / 2;
    view.current = { x: cx - ((cx - v.x) * nz) / v.z, y: cy - ((cy - v.y) * nz) / v.z, z: nz };
    applyView();
    setZoom(nz);
  }, [applyView]);
  const fit = useCallback(() => { view.current = { x: 0, y: 0, z: 1 }; applyView(); setZoom(1); }, [applyView]);
  // Ctrl+scroll (or a pinch) zooms where the pointer is; a plain scroll still scrolls the page.
  useEffect(() => {
    const el = stageEl.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomTo(view.current.z * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomTo]);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button, a, input")) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, vx: view.current.x, vy: view.current.y };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    view.current = { ...view.current, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y };
    applyView();
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
  };
  useLayoutEffect(() => {
    shownRef.current = shown;
    endRef.current = end;
    api.current?.update(shown, { hold: asking, final: end });
  }, [shown, asking, end]);
  // A new size: the canvas takes it (times the zoom) and everything is placed again, without travelling there.
  useEffect(() => {
    const el = stageEl.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      el.style.setProperty("--k", `${Math.max(0.9, Math.min(1.7, Math.min(el.clientWidth / 1000, el.clientHeight / 560)))}`);
      laidAt.current = 0;
      applyView();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [applyView]);
  useEffect(() => {
    stageEl.current?.classList.toggle("xray", xray);
    api.current?.relayout(shown, end);
  }, [xray, shown, end]);

  const go = useCallback((to: number) => {
    stopVoice?.();
    setAnswered(null);
    setI(Math.max(0, Math.min(n, to)));
  }, [n, stopVoice]);

  // The caption: the picture's sentence lit a word at a time as it is said, then on to the next step when playing.
  const words = useMemo(() => (asking || end ? [] : step.a.split(" ")), [asking, end, step]);
  const capKey = `${i}:${asking}:${end}`;
  const lit = said.key === capKey ? said.n : 0;
  useEffect(() => {
    if (!words.length) return;
    let alive = true;
    let k = 0;
    const tick = window.setInterval(() => { k = Math.min(words.length - 1, k + 1); if (alive) setSaid({ key: capKey, n: k }); }, 300);
    const heard = speak ? speak(step.a).catch(() => undefined) : new Promise<void>((ok) => window.setTimeout(ok, words.length * 300 + 200));
    void heard.then(() => {
      window.clearInterval(tick);
      if (!alive) return;
      setSaid({ key: capKey, n: words.length });
      if (playing) window.setTimeout(() => alive && setI((x) => Math.min(n, x + 1)), 900);
    });
    return () => { alive = false; window.clearInterval(tick); };
  }, [capKey, words, speak, step, playing, n]);
  useEffect(() => {
    if (end || asking) { const t = window.setTimeout(() => setPlaying(false), 0); return () => window.clearTimeout(t); }
  }, [end, asking]);

  const pick = (k: number) => {
    setAnswered({ step: i, pick: k });
    window.setTimeout(() => { setDone((d) => new Set(d).add(i)); setAnswered(null); }, 1700);
  };

  // Keys: the window's on the Learn stage, else only while the player has the focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable=true]")) return;
      if (keys === "focus" && !root.current?.contains(t) && !full) return;
      const k = e.key.toLowerCase();
      if (e.key === "ArrowRight") go(i + 1);
      else if (e.key === "ArrowLeft") go(i - 1);
      else if (e.key === " " && !t.closest("button")) { e.preventDefault(); setPlaying((p) => !p); }
      else if (k === "x") setXray((x) => !x);
      else if (k === "w") setWide((w) => !w);
      else if (e.key === "Escape") { if (full) setFull(false); else onClose?.(); }
      else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keys, go, i, full, setFull, onClose]);

  const code = useMemo(() => (scene.code ? highlight(scene.code, scene.language ?? "text") : null), [scene.code, scene.language]);
  const factsOn = new Set(end ? [] : (scene.steps[Math.max(shown, 0)]?.facts ?? []));
  const lineOn = end || shown < 0 ? undefined : scene.steps[shown]?.line;
  const wordOn = end || shown < 0 ? undefined : scene.steps[shown]?.word;
  const kindName = scene.kind === "graph" ? GRAPH_NAME[scene.type] : KIND_NAME[scene.kind];

  return wrap(
    <div ref={root} tabIndex={-1} className={`splayer${wide ? " wide" : ""}${full ? " full" : ""}`} aria-label={`${kindName}: ${scene.title}`}>
      <header className="sp-head">
        <span className="sp-kind">{kindName}</span>
        <span className="sp-count">{end ? "the rule" : `${String(i + 1).padStart(2, "0")} / ${String(n).padStart(2, "0")}`}</span>
        <h2 className="sp-headline" aria-live="polite" key={capKey}>{end ? <Headline text="Remember *this*" /> : asking ? <Headline text="What happens *next*?" /> : <Headline text={step.head} />}</h2>
        <span className="sp-sp" />
        {where && <span className="sp-where">{where}</span>}
        <div className="sp-seg" role="group" aria-label="What the scene shows">
          <button type="button" aria-pressed={!xray} onClick={() => setXray(false)} title="The everyday picture">Picture</button>
          <button type="button" aria-pressed={xray} onClick={() => setXray(true)} title="The same scene with the real names (X)">X-ray</button>
        </div>
        <button className="ctl compact" type="button" aria-pressed={wide} onClick={() => setWide((w) => !w)} title="Give the scene the whole width (W)">⇔ Wide</button>
        <button className="ctl compact" type="button" aria-pressed={full} onClick={() => setFull((f) => !f)} title={full ? "Back (Esc)" : "Fill the window"}>{full ? "Smaller" : "⛶ Larger"}</button>
        {controls}
      </header>
      <div className="sp-body">
        <div className="sp-stage-wrap">
          <div
            className={`sp-stage${dragging ? " dragging" : ""}`}
            ref={stageEl}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={fit}
            title="Drag to move round the board · Ctrl+scroll to zoom · double-click to fit"
          >
            <div className="sp-canvas" ref={canvasEl} />
          </div>
          <div className="sp-zoom" role="group" aria-label="Zoom">
            <button type="button" onClick={() => zoomTo(view.current.z / 1.25)} aria-label="Zoom out">−</button>
            <span>{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => zoomTo(view.current.z * 1.25)} aria-label="Zoom in">+</button>
            <button type="button" onClick={fit} title="Fit the whole scene (double-click)">Fit</button>
          </div>
          {asking && step.ask && (
            <div className="sp-ask" role="dialog" aria-label="Guess first">
              <p className="eyebrow">Guess first</p>
              {answered?.step === i ? (
                <p className="why"><b className={answered.pick === step.ask.right ? "r" : "w"}>{answered.pick === step.ask.right ? "Yes. " : `It's “${step.ask.opts[step.ask.right]}”. `}</b>{step.ask.why}</p>
              ) : (
                <>
                  <p className="q">{step.ask.q}</p>
                  <div className="opts">{step.ask.opts.map((o, k) => <button key={k} className="ctl" type="button" onClick={() => pick(k)}>{o}</button>)}</div>
                  <button className="ctl compact" type="button" onClick={() => setDone((d) => new Set(d).add(i))}>Just show me</button>
                </>
              )}
            </div>
          )}
          {end && (
            <div className="sp-end">
              <p className="eyebrow">The rule · {scene.title}</p>
              <p className="rule">{scene.rule}</p>
              {scene.breaks && <div className="brk"><b>Where the picture breaks</b>{scene.breaks}</div>}
              <div className="next">
                <button className="ctl primary" type="button" onClick={() => { setDone(new Set()); go(0); }}>Watch again</button>
                {onClose && <button className="ctl" type="button" onClick={onClose}>Back to the board</button>}
              </div>
            </div>
          )}
        </div>
        <aside className="sp-real" aria-label="The real thing">
          <p className="eyebrow">The real thing</p>
          {code ? (
            <pre className="sp-code">{code.map((spans, k) => (
              <span key={k} className={`ln${lineOn === k + 1 ? " on" : ""}`}><b>{k + 1}</b>{spans.map((sp, j) => <span key={j} className={sp.cls}>{sp.text}</span>)}{"\n"}</span>
            ))}</pre>
          ) : scene.facts ? (
            <>
              <ol className="sp-facts">{scene.facts.map((f, k) => <li key={k} className={factsOn.has(k) ? "on" : undefined}>{f}</li>)}</ol>
              {scene.source && <p className="sp-src">{scene.source}</p>}
            </>
          ) : null}
          {scene.words.length > 0 && (
            <div className="sp-words">{scene.words.map((w, k) => <span key={k} className={`w${wordOn === k ? " on" : ""}`} title={w.why}><b>{w.a}</b> = <code>{w.r}</code></span>)}</div>
          )}
        </aside>
      </div>
      <div className="sp-cap">
        <p className="a" aria-live="polite">{words.map((w, k) => <span key={k} className={k < lit ? "said" : k === lit ? "now" : undefined}>{w}{k < words.length - 1 ? " " : ""}</span>)}</p>
        {!asking && !end && <p className="r">{step.r}</p>}
      </div>
      <div className="sp-ctl">
        <button className="ctl" type="button" onClick={() => go(i - 1)} disabled={i === 0}>◀ Back</button>
        <button className="ctl primary" type="button" onClick={() => (end ? go(0) : setPlaying((p) => !p))}>{playing ? "❚❚ Pause" : "▶ Play"}</button>
        <button className="ctl" type="button" onClick={() => go(i + 1)} disabled={end || asking}>Next ▶</button>
        <div className="sp-dots">
          {scene.steps.map((_, k) => <button key={k} type="button" className={k === i ? "on" : k < i ? "past" : undefined} onClick={() => go(k)} aria-label={`Step ${k + 1}`} />)}
          <button type="button" className={`end${end ? " on" : ""}`} onClick={() => go(n)} aria-label="The rule, and where the picture breaks" />
        </div>
        <span className="sp-sp" />
        <label className="sp-guess"><input type="checkbox" checked={guess} onChange={(e) => setGuess(e.target.checked)} /> Guess first</label>
      </div>
    </div>,
  );
}
