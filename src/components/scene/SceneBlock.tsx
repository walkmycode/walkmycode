"use client";
/**
 * An analogy to watch (mockup docs/design/learn-analogy-visual.html), drawn
 * from one Scene (src/lib/scene/model.ts) in two ways:
 *
 * - the stage: the everyday picture above the real thing, column for column,
 *   so what stands for what is a straight line down. Things are drawings that
 *   glide to their new holder; what a step did is an arrow that draws itself,
 *   a dot riding along it, and then keeps flowing the way the thing went (as a
 *   trace does on the map); the word it teaches is stamped as it happens.
 * - a UML sequence diagram: each holder a lifeline, each hand-over a message
 *   carrying the thing, labelled in both languages.
 *
 * Both sides and both views come from the same data, so they always agree.
 * It is used full width by the Learn room's "Watch it happen" and inside an
 * answer wherever a ```scene block appears. Only transform and opacity move
 * (× --m): with motion off, things simply are where they belong.
 * ← → step, Space plays or pauses.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { highlight } from "@/learn/lib/highlight";
import { placeOf, sceneEvents, sceneView, sceneWords, type Scene, type SceneActor, type SceneThing } from "@/lib/scene/model";
import Drawing from "./Drawing";
import { sceneArt } from "./art";
import { useFull } from "./useFull";
import "./scene.css";

type Props = {
  scene: Scene;
  /** Where it is from: "Move · board 4 of 18". */
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

type Side = "a" | "r";
type Link = { kind: "move" | "end" | "loan"; d: string; label: string; x: number; y: number };

/** The motion multiplier in force (globals.css): 0 when motion is off. */
const motionScale = (el: Element) => {
  const m = parseFloat(getComputedStyle(el.ownerDocument.documentElement).getPropertyValue("--m"));
  return Number.isFinite(m) ? m : 1;
};
const round = (n: number) => Math.round(n * 10) / 10;
/** The slot things go to when they are gone. An id is lower-case letters, digits, _ and -, so no holder can have this name. */
const GONE = "#gone";

export default function SceneBlock({ scene, where, controls, speak, stopVoice, keys = "focus", onClose }: Props) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<"stage" | "sequence">(scene.view ?? "stage");
  const [lit, setLit] = useState<string | null>(null);
  const [links, setLinks] = useState<{ at: number; list: Link[] }>({ at: -1, list: [] });
  const [size, setSize] = useState(0);
  const root = useRef<HTMLElement | null>(null);
  const { full, setFull, wrap } = useFull(root);
  const run = useRef(0);
  const marker = useId().replace(/[^a-zA-Z0-9]/g, "");
  const last = scene.steps.length - 1;
  const step = scene.steps[i];
  const stage = useMemo(() => sceneView(scene, i), [scene, i]);
  const words = useMemo(() => sceneWords(scene), [scene]);
  const art = useMemo(() => sceneArt(scene), [scene]);
  const events = useMemo(() => scene.steps.map((_, n) => sceneEvents(scene, n)), [scene]);
  const code = useMemo(() => highlight(scene.code, scene.plain ? "text" : scene.language), [scene.code, scene.language, scene.plain]);
  const hasBin = useMemo(() => !!scene.bin || scene.steps.some((_, n) => scene.things.some((t) => placeOf(scene, n, t.id)?.at === "bin")), [scene]);
  const seen = useMemo(() => new Set(scene.steps.slice(0, i).map((s) => s.word)), [scene, i]);
  const mono = scene.plain ? "" : " mono";

  const stop = useCallback(() => {
    run.current++;
    stopVoice?.();
    setPlaying(false);
  }, [stopVoice]);
  const go = useCallback(
    (n: number) => {
      stop();
      setI(Math.max(0, Math.min(last, n)));
    },
    [last, stop],
  );
  const play = useCallback(
    async (from: number) => {
      const my = ++run.current;
      setPlaying(true);
      for (let n = from; n <= last; n++) {
        if (my !== run.current) return;
        setI(n);
        const said = `${scene.steps[n].a} ${scene.steps[n].r}`;
        // Read aloud when there is a voice; otherwise long enough to read both lines.
        if (speak) await speak(said);
        else await new Promise((r) => setTimeout(r, Math.min(6000, 1400 + said.length * 28)));
        if (my !== run.current) return;
        await new Promise((r) => setTimeout(r, 350));
      }
      if (my === run.current) setPlaying(false);
    },
    [last, scene.steps, speak],
  );
  const toggle = useCallback(() => (playing ? stop() : void play(i >= last ? 0 : i)), [playing, stop, play, i, last]);
  useEffect(() => () => void run.current++, []);

  const onKey = useCallback(
    (e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; target: EventTarget | null; preventDefault(): void; stopPropagation(): void }) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.closest("textarea, input, select, [contenteditable], .cm-editor")) return;
      const act =
        e.key === "ArrowRight" ? () => go(i + 1) : e.key === "ArrowLeft" ? () => go(i - 1) : e.key === "Escape" ? (full ? () => setFull(false) : onClose) : e.key === " " && !target.closest("button") ? toggle : null;
      if (!act) return;
      e.preventDefault();
      e.stopPropagation();
      act();
    },
    [full, setFull, go, i, onClose, toggle],
  );
  // On the Learn stage, before the lesson's own keys: the arrows step the scene, not the boards.
  useEffect(() => {
    if (keys !== "window") return;
    const win = root.current?.ownerDocument.defaultView ?? window;
    win.addEventListener("keydown", onKey, true);
    return () => win.removeEventListener("keydown", onKey, true);
  }, [keys, onKey]);

  // The arrows are placed from where things are, so they are placed again when the box changes size.
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

  const was = useRef(new Map<string, DOMRect>());
  const glided = useRef(-1);
  useLayoutEffect(() => {
    const el = root.current;
    const board = el?.querySelector<HTMLElement>(".s-board");
    if (!el || !board || view !== "stage") {
      was.current = new Map();
      glided.current = -1;
      return;
    }
    // A thing still gliding from the step before is put where it belongs first, so it is measured there.
    if (glided.current !== i) el.querySelectorAll<HTMLElement>("[data-flip]").forEach((t) => t.getAnimations().forEach((a) => a.cancel()));
    // 1. What this step did, as arrows: measured now, with everything where it belongs.
    const box = board.getBoundingClientRect();
    const at = (node: Element) => {
      const r = node.getBoundingClientRect();
      return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2, left: r.left - box.left, right: r.right - box.left, bottom: r.bottom - box.top };
    };
    const slot = (side: Side, who: string) => board.querySelector(`[data-slot="${side}:${who}"]`);
    const next: Link[] = [];
    for (const side of ["a", "r"] as const) {
      for (const t of scene.things) {
        const now = placeOf(scene, i, t.id);
        const before = i > 0 ? placeOf(scene, i - 1, t.id) : null;
        if (now && before?.at === "actor" && (now.at === "bin" || now.id !== before.id)) {
          const from = slot(side, before.id);
          const to = slot(side, now.at === "bin" ? GONE : now.id);
          if (from && to) {
            const a = at(from);
            const b = at(to);
            const y = Math.max(a.bottom, b.bottom) + 4;
            const gone = now.at === "bin";
            next.push({ kind: gone ? "end" : "move", d: `M${round(a.x)} ${round(y)}Q${round((a.x + b.x) / 2)} ${round(y + 26)} ${round(b.x)} ${round(y)}`, label: (step.verb ?? (gone ? words.bin : words.move))[side], x: round((a.x + b.x) / 2), y: round(y + 30) });
          }
        }
        const own = board.querySelector(`[data-flip="${side}:${t.id}"]`);
        board.querySelectorAll(`[data-loan^="${side}:${t.id}:"]`).forEach((ghost) => {
          if (!own) return;
          const a = at(own);
          const b = at(ghost);
          const ltr = a.x < b.x;
          const x1 = ltr ? a.right + 2 : a.left - 2;
          const x2 = ltr ? b.left - 4 : b.right + 4;
          next.push({ kind: "loan", d: `M${round(x1)} ${round(a.y)}L${round(x2)} ${round(a.y)}`, label: words.loan[side], x: round((x1 + x2) / 2), y: round(a.y - 7) });
        });
      }
    }
    setLinks((old) => (old.at === i && JSON.stringify(old.list) === JSON.stringify(next) ? old : { at: i, list: next }));

    // 2. A thing that changed hands glides there along a small arc (first, last, invert, play).
    const scale = motionScale(el);
    const fresh = glided.current !== i;
    glided.current = i;
    const now = new Map<string, DOMRect>();
    el.querySelectorAll<HTMLElement>("[data-flip]").forEach((t) => {
      const key = t.dataset.flip!;
      const rect = t.getBoundingClientRect();
      now.set(key, rect);
      const from = was.current.get(key);
      if (!from || scale === 0 || !fresh) return;
      const dx = from.left - rect.left;
      const dy = from.top - rect.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      t.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: `translate(${dx / 2}px, ${dy / 2 - 22}px)`, offset: 0.5 }, { transform: "none" }], { duration: 520 * scale, easing: "cubic-bezier(.3, .7, .3, 1)" });
    });
    was.current = now;
  }, [i, view, size, scene, step, words, full]);

  const link = (id: string) => ({
    "data-lit": lit === id ? "" : undefined,
    onMouseEnter: () => setLit(id),
    onMouseLeave: () => setLit(null),
    onFocus: () => setLit(id),
    onBlur: () => setLit(null),
  });
  const thing = (t: SceneThing, side: Side, kind: "" | "lent" | "was" = "", borrower = "") => (
    <span
      key={`${kind}${t.id}${borrower}`}
      className={`thing${kind ? ` ${kind}` : ""}`}
      data-flip={kind === "lent" ? undefined : `${side}:${t.id}`}
      data-loan={kind === "lent" ? `${side}:${t.id}:${borrower}` : undefined}
      tabIndex={0}
      {...link(t.id)}
      title={side === "a" ? `For real: ${t.r}` : `In the picture: ${t.a}`}
    >
      <Drawing {...art.thing[t.id][side]} />
      <span className={side === "r" ? mono.trim() : undefined}>{t[side]}</span>
      {kind === "lent" && <small>on loan</small>}
    </span>
  );
  const row = (side: Side) => (
    <div className={`s-row ${side}`}>
      {scene.watcher && (
        <div className={`cell aside${step.stop ? " stop" : ""}`}>
          <Drawing {...art.watcher[side]} state={step.stop ? "stop" : false} />
          <p className={`s-name${side === "r" ? mono : ""}`}>{scene.watcher[side]}</p>
          <p className="state">{step.stop ? step.stop[side] : side === "a" ? "watching" : "checking"}</p>
        </div>
      )}
      {stage.actors.map((actor) => (
        <div key={actor.id} className={`cell${actor.off ? " off" : ""}${step.stop?.who === actor.id ? " reach" : ""}`} tabIndex={0} {...link(actor.id)} title={side === "a" ? `For real: ${actor.r}` : `In the picture: ${actor.a}`}>
          <Drawing {...art.actor[actor.id][side]} state={actor.off ? "sad" : false} />
          <p className={`s-name${side === "r" ? mono : ""}`}>{actor[side]}</p>
          <p className="state">{actor.off ? words.off[side] : ""}</p>
          <div className="slot" data-slot={`${side}:${actor.id}`}>
            {actor.holds.map((t) => thing(t, side))}
            {actor.lent.map((t) => thing(t, side, "lent", actor.id))}
          </div>
        </div>
      ))}
      {hasBin && (
        <div className="cell bin">
          <Drawing {...art.bin[side]} />
          <p className={`s-name${side === "r" ? mono : ""}`}>{words.bin[side]}</p>
          <div className="slot" data-slot={`${side}:${GONE}`}>{stage.gone.map((t) => thing(t, side, "was"))}</div>
        </div>
      )}
    </div>
  );
  const cols = `${scene.watcher ? "minmax(60px, var(--side)) " : ""}repeat(${scene.actors.length}, minmax(0, 1fr))${hasBin ? " minmax(60px, var(--side))" : ""}`;
  const column = (id: string) => scene.actors.findIndex((x) => x.id === id) + 1;
  const both = (p: { a: string; r: string }) => (
    <>
      <b>{p.a}</b> · <code>{p.r}</code>
    </>
  );
  const taught = step.word !== undefined ? scene.map[step.word] : undefined;
  const head = (x: SceneActor) => (
    <span key={x.id} {...link(x.id)}>
      <span className="both">
        <Drawing {...art.actor[x.id].a} />
        {art.actor[x.id].r.name && <i>=</i>}
        <Drawing {...art.actor[x.id].r} />
      </span>
      <b>{x.a}</b>
      <code>{x.r}</code>
    </span>
  );

  return wrap(
    <section
      className={`wscene${scene.plain ? " plain" : ""}${full ? " full" : ""}`}
      ref={root}
      aria-label={`Analogy: ${scene.title}`}
      tabIndex={keys === "focus" ? 0 : undefined}
      onKeyDown={keys === "focus" ? onKey : undefined}
    >
      <header>
        <span aria-hidden="true">💡</span>
        <b>{scene.title}</b>
        {where && <span className="s-where">{where}</span>}
        <span className="s-sp" />
        <span className="seg" role="group" aria-label="How it is drawn">
          <button className="ctl compact" type="button" aria-pressed={view === "stage"} onClick={() => setView("stage")} title="The picture above the real thing">Picture</button>
          <button className="ctl compact" type="button" aria-pressed={view === "sequence"} onClick={() => setView("sequence")} title="The same steps as a UML sequence diagram">Sequence diagram</button>
        </span>
        {keys === "focus" && (
          <button className="ctl compact" type="button" aria-pressed={full} onClick={() => setFull((f) => !f)} title={full ? "Back into the answer (Esc)" : "Fill the window"}>
            {full ? "Smaller" : "Larger"}
          </button>
        )}
        {controls}
      </header>

      <div className="s-stage">
        {view === "stage" ? (
          <div className="s-board" style={{ "--cols": cols } as CSSProperties}>
            <p className="eyebrow rowhead"><span>The picture</span>{scene.place && <span>{scene.place}</span>}</p>
            {row("a")}
            <div className="ties">
              {scene.watcher && <i className="none" />}
              {scene.actors.map((x) => <i key={x.id} data-lit={lit === x.id ? "" : undefined} />)}
              {hasBin && <i className="none" />}
              {taught && (
                <p className="stamp" key={i}>
                  <span><b>{taught.a}</b> is <code>{taught.r}</code></span>
                </p>
              )}
            </div>
            <p className="eyebrow rowhead"><span>{scene.plain ? "For real" : "In the code"}</span><span>the same thing, for real</span></p>
            {row("r")}
            <svg className="links" aria-hidden="true">
              <defs>
                {(["move", "end", "loan"] as const).map((k) => (
                  <marker key={k} id={`${marker}-${k}`} viewBox="0 0 10 10" refX="7.5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                    <path className={k} d="M2 1.5L8 5L2 8.5" />
                  </marker>
                ))}
              </defs>
              {/* Keyed by the step, so each arrow draws itself once when its step arrives and only moves on a resize. */}
              {links.at === i &&
                links.list.map((l, n) => (
                  <g key={`${i}-${n}`} className={l.kind}>
                    <path className="base" d={l.d} pathLength={1} />
                    <path className="flow" d={l.d} markerEnd={`url(#${marker}-${l.kind})`} />
                    <circle className="dot" r="3.5" style={{ offsetPath: `path("${l.d}")` }} />
                    <text x={l.x} y={l.y}>{l.label}</text>
                  </g>
                ))}
            </svg>
          </div>
        ) : (
          <div className="seq" style={{ "--n": scene.actors.length } as CSSProperties}>
            <div className="shead">{scene.actors.map(head)}</div>
            {scene.steps.map((_, n) => (
              <button key={n} type="button" className={`srow${n > i ? " later" : ""}${n === i ? " now" : ""}`} onClick={() => go(n)} aria-current={n === i ? "step" : undefined} aria-label={`Step ${n + 1}: ${scene.steps[n].r}`}>
                <span className="num">{n + 1}</span>
                <span className="lifes">{scene.actors.map((x) => <i key={x.id} />)}</span>
                {events[n].length === 0 && (
                  <span className="ev">
                    <span className="s-tag quiet" style={{ gridColumn: "1 / -1" }}>{scene.steps[n].a}</span>
                  </span>
                )}
                {events[n].map((e, k) => {
                  if ("from" in e) {
                    const a = column(e.from);
                    const b = column(e.to);
                    const lo = Math.min(a, b);
                    const hi = Math.max(a, b);
                    return (
                      <span className="ev" key={k}>
                        <span className={`s-msg${a > b ? " rtl" : ""}${e.kind === "loan" ? " loan" : ""}`} style={{ gridColumn: `${lo} / ${hi + 1}`, "--span": hi - lo + 1 } as CSSProperties}>
                          <span className="s-lab">{both(e)}</span>
                          <span className="wire" />
                          <span className="run"><span className="rider"><Drawing {...art.thing[e.thing.id].a} /></span></span>
                        </span>
                      </span>
                    );
                  }
                  return (
                    <span className="ev" key={k}>
                      <span className={`s-tag ${e.kind}`} style={{ gridColumn: column(e.who) }}>
                        {"thing" in e && <Drawing {...art.thing[e.thing.id].a} />}
                        <span>{e.kind === "end" ? "✕ " : ""}{both(e)}</span>
                      </span>
                    </span>
                  );
                })}
              </button>
            ))}
          </div>
        )}

        <div className="side">
          <p className="eyebrow">{scene.plain ? "The real steps" : "The code"}</p>
          <pre tabIndex={0} aria-label={scene.plain ? "The real steps" : "The code"}>
            <code>
              {code.map((spans, n) => (
                <span key={n} className={`ln${step.line === n + 1 ? ` now${step.stop ? " bad" : ""}` : ""}`}>
                  {spans.map((s, k) => (s.cls ? <span key={k} className={s.cls}>{s.text}</span> : s.text))}
                  {"\n"}
                </span>
              ))}
            </code>
          </pre>
          {scene.map.length > 0 && (
            <>
              <p className="eyebrow">The words, in the same picture</p>
              <div className="words" aria-label="What stands for what">
                {scene.map.map((m, n) => {
                  const first = scene.steps.findIndex((s) => s.word === n);
                  return (
                    <button key={n} type="button" className={`word${step.word === n ? " now" : seen.has(n) ? " seen" : ""}${art.words[n].name || art.words[n].shapes ? "" : " bare"}`} disabled={first < 0} onClick={() => go(first)} title={first < 0 ? undefined : "Show me where this happens"}>
                      <Drawing {...art.words[n]} />
                      <span className="pair"><b>{m.a}</b> = <code>{m.r}</code></span>
                      {m.why && <span className="why">{m.why}</span>}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="say" aria-live="polite">
        <div><p className="eyebrow">In the picture</p><p>{step.a}</p></div>
        <div><p className="eyebrow">{scene.plain ? "For real" : "In the code"}</p><p>{step.r}</p></div>
      </div>

      <footer>
        <div className="stepper" role="toolbar" aria-label="Step through the analogy">
          <button className="ctl compact" type="button" disabled={i === 0} onClick={() => go(i - 1)} aria-label="Step back">◀</button>
          <button className="ctl compact primary" type="button" onClick={toggle}>{playing ? "❚❚ Pause" : i >= last ? "↺ Replay" : "▶ Play"}</button>
          <button className="ctl compact" type="button" disabled={i === last} onClick={() => go(i + 1)}>Step ▶</button>
          <span className="dots">
            {scene.steps.map((_, n) => (
              <button key={n} type="button" className={n <= i ? "on" : ""} aria-label={`Step ${n + 1} of ${scene.steps.length}`} aria-current={n === i ? "step" : undefined} onClick={() => go(n)} />
            ))}
          </span>
          <span className="s-keys"><kbd>←</kbd> <kbd>→</kbd> step · <kbd>Space</kbd> play</span>
        </div>
        {scene.rule && <p className="rule"><span className="eyebrow">The rule</span><b>{scene.rule}</b></p>}
        {scene.breaks && <p className="breaks"><span className="eyebrow">Where the picture breaks</span>{scene.breaks}</p>}
      </footer>
    </section>,
  );
}
