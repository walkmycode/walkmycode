"use client";
/**
 * An analogy to watch (docs/design/learn-analogy.html): the everyday picture
 * on the left, the real code on the right, stepped through together. Both
 * sides are drawn from one Scene (src/learn/lib/scene.ts), so they always
 * agree; pointing at a holder or a thing on one side lights up its counterpart
 * on the other.
 *
 * Things move between holders with the app's motion (× --m): with motion off
 * they simply are where they belong, which is just as clear. ← → step, Space
 * plays or pauses, Esc closes.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { highlight } from "@/learn/lib/highlight";
import { sceneView, type Scene, type SceneThing } from "@/learn/lib/scene";

type Props = {
  scene: Scene;
  /** Where it is from: "Move · board 4 of 18". */
  where: string;
  /** Whether the outline and the professor are shown beside it. */
  panels: boolean;
  onPanels: (shown: boolean) => void;
  onClose: () => void;
  /** Reads a step aloud, resolving when it has been heard (or read, when the voice is off). */
  speak: (text: string) => Promise<void>;
  stopVoice: () => void;
};

/** The motion multiplier in force (globals.css): 0 when motion is off. */
const motionScale = () => {
  const m = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--m"));
  return Number.isFinite(m) ? m : 1;
};

export default function AnalogyScene({ scene, where, panels, onPanels, onClose, speak, stopVoice }: Props) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [lit, setLit] = useState<string | null>(null);
  const root = useRef<HTMLElement | null>(null);
  const run = useRef(0);
  const last = scene.steps.length - 1;
  const step = scene.steps[i];
  const view = useMemo(() => sceneView(scene, i), [scene, i]);
  const code = useMemo(() => highlight(scene.code, scene.plain ? "text" : scene.language), [scene.code, scene.language, scene.plain]);

  const stop = useCallback(() => {
    run.current++;
    stopVoice();
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
        await speak(`${scene.steps[n].a} ${scene.steps[n].r}`);
        if (my !== run.current) return;
        await new Promise((r) => setTimeout(r, 350));
      }
      if (my === run.current) setPlaying(false);
    },
    [last, scene.steps, speak],
  );
  const toggle = useCallback(() => (playing ? stop() : void play(i >= last ? 0 : i)), [playing, stop, play, i, last]);
  useEffect(() => () => void run.current++, []);

  // Before the lesson's own keys: here the arrows step the scene, not the boards.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement).closest("textarea, input, select, [contenteditable], .cm-editor")) return;
      const act = e.key === "ArrowRight" ? () => go(i + 1) : e.key === "ArrowLeft" ? () => go(i - 1) : e.key === "Escape" ? onClose : e.key === " " && !(e.target as HTMLElement).closest("button") ? toggle : null;
      if (!act) return;
      e.preventDefault();
      e.stopPropagation();
      act();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [go, i, onClose, toggle]);

  // A thing that changed hands glides from where it was to where it is (first, last, invert, play).
  const was = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const now = new Map<string, DOMRect>();
    const scale = motionScale();
    el.querySelectorAll<HTMLElement>("[data-flip]").forEach((t) => {
      const key = t.dataset.flip!;
      const rect = t.getBoundingClientRect();
      now.set(key, rect);
      const from = was.current.get(key);
      if (!from || scale === 0 || (Math.abs(from.left - rect.left) < 1 && Math.abs(from.top - rect.top) < 1)) return;
      t.animate([{ transform: `translate(${from.left - rect.left}px, ${from.top - rect.top}px)` }, { transform: "none" }], { duration: 480 * scale, easing: "cubic-bezier(.2, .9, .3, 1.12)" });
    });
    was.current = now;
  }, [i, panels]);

  const link = (id: string) => ({
    "data-lit": lit === id ? "" : undefined,
    onMouseEnter: () => setLit(id),
    onMouseLeave: () => setLit(null),
    onFocus: () => setLit(id),
    onBlur: () => setLit(null),
  });
  const thing = (t: SceneThing, side: "a" | "r", lent = false) => (
    <span key={lent ? `l-${t.id}` : t.id} className={`thing${lent ? " lent" : ""}${side === "r" && !scene.plain ? " mono" : ""}`} data-flip={lent ? undefined : `${side}:${t.id}`} tabIndex={0} {...link(t.id)} title={side === "a" ? `For real: ${t.r}` : `In the picture: ${t.a}`}>
      {t[side]}
      {lent && <small>on loan</small>}
    </span>
  );
  const lane = (side: "a" | "r") => (
    <>
      <div className="actors">
        {view.actors.map((actor) => (
          <div key={actor.id} className={`actor${actor.off ? " off" : ""}`} tabIndex={0} {...link(actor.id)} title={side === "a" ? `For real: ${actor.r}` : `In the picture: ${actor.a}`}>
            <p className={`name${side === "r" && !scene.plain ? " mono" : ""}`}>
              {actor[side]}
              {actor.off && <span className="cannot">{side === "a" ? "empty-handed" : "cannot be used"}</span>}
            </p>
            <div className="slot">
              {actor.holds.map((t) => thing(t, side))}
              {actor.lent.map((t) => thing(t, side, true))}
            </div>
          </div>
        ))}
      </div>
      {view.gone.length > 0 && (
        <p className="gone">
          <span>{side === "a" ? "Tidied away" : "Freed"}</span>
          {view.gone.map((t) => <span key={t.id} className={`thing was${side === "r" && !scene.plain ? " mono" : ""}`} data-flip={`${side}:${t.id}`}>{t[side]}</span>)}
        </p>
      )}
    </>
  );

  return (
    <section className={scene.plain ? "scene plain" : "scene"} ref={root} aria-label={`Analogy: ${scene.title}`}>
      <header>
        <span aria-hidden="true">💡</span>
        <b>{scene.title}</b>
        <span className="where">{where}</span>
        <span className="sp" />
        <button className="ctl compact" type="button" aria-pressed={panels} onClick={() => onPanels(!panels)} title={panels ? "Give the analogy the full width" : "Show the outline and the professor beside it"}>
          Side panels
        </button>
        <button className="ctl compact" type="button" onClick={onClose} title="Back to the board (Esc)">Close</button>
      </header>

      <div className="lanes">
        <div className="lane">
          <p className="eyebrow"><span>The picture</span>{scene.place && <span>{scene.place}</span>}</p>
          {lane("a")}
        </div>
        <div className="lane">
          <p className="eyebrow"><span>{scene.plain ? "For real" : "In the code"}</span><span>the same thing, for real</span></p>
          {lane("r")}
          <pre tabIndex={0} aria-label={scene.plain ? "The real steps" : "The code"}>
            <code>
              {code.map((spans, n) => (
                <span key={n} className={`ln${step.line === n + 1 ? " now" : ""}`}>
                  {spans.map((s, k) => (s.cls ? <span key={k} className={s.cls}>{s.text}</span> : s.text))}
                  {"\n"}
                </span>
              ))}
            </code>
          </pre>
        </div>
      </div>

      <div className="say" aria-live="polite">
        <div><p className="eyebrow">In the picture</p><p>{step.a}</p></div>
        <div><p className="eyebrow">{scene.plain ? "For real" : "In the code"}</p><p>{step.r}</p></div>
      </div>

      {scene.map.length > 0 && (
        <p className="map" aria-label="What stands for what">
          {scene.map.map((m, n) => <span key={n}><b>{m.a}</b> = <code>{m.r}</code></span>)}
        </p>
      )}

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
          <span className="keys"><kbd>←</kbd> <kbd>→</kbd> step · <kbd>Space</kbd> play</span>
        </div>
        {scene.rule && <p className="rule"><span className="eyebrow">The rule</span><b>{scene.rule}</b></p>}
        {scene.breaks && <p className="breaks"><span className="eyebrow">Where the picture breaks</span>{scene.breaks}</p>}
      </footer>
    </section>
  );
}
