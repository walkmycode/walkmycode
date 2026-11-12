"use client";
// The fly-through's bar over the map (docs/PLAN.md "Fly-through"): where it is
// going, the line for the hop on screen, one pill per hop (a gap is a dashed
// pill), and the controls: back, pause or play, next, replay, the voice, "Save
// as tour", and close (Esc stops it; the path stays drawn). It reads the store
// in src/lib/flythrough.ts and draws nothing when nothing is flying.
import { useSyncExternalStore } from "react";
import { flyThrough, type FlyState } from "@/lib/flythrough";
import { unlockAudio } from "@/lib/voice/view";

const IDLE_SNAPSHOT = () => flyThrough.state;

/** The line under the title: the hop on screen, or what the fly-through is waiting for. */
function caption(s: FlyState): React.ReactNode {
  const st = s.steps[s.at];
  if (st)
    return (
      <>
        {st.gap && st.fromName && (
          <span className="fly-gapnote">
            I can&apos;t see a link from {st.fromName} to {st.name}.{" "}
          </span>
        )}
        <b>{st.name}</b>
        {st.say && st.say !== `${st.name}.` ? <> · {st.say}</> : null}
        {st.guess && <span className="fly-guess"> (a guess: matched by pattern)</span>}
      </>
    );
  if (s.error) return <span className="fly-err">{s.error}</span>;
  if (s.waiting) return <span className="fly-finding">Finding the way on the map…</span>;
  return <span className="note">The guide answered without moving the map: its answer is in the Guide.</span>;
}

export default function FlyBar() {
  const s = useSyncExternalStore(flyThrough.subscribe, IDLE_SNAPSHOT, IDLE_SNAPSHOT);
  if (s.status === "idle") return null;
  const n = s.steps.length;
  const playing = s.status === "playing";
  const done = s.status === "done";
  return (
    <section className={`flybar${s.waiting && !n ? " finding" : ""}`} data-status={s.status} data-steps={n} aria-label="Fly-through">
      <header>
        <i className="fly-dot" aria-hidden />
        <span className="fly-title" title={s.title}>
          {s.title}
        </span>
        <span className="fly-count">{n ? `${s.at + 1} / ${n}${s.waiting ? "…" : ""}` : ""}</span>
        <button type="button" className="fly-x" onClick={() => flyThrough.close()} title="Close (Esc stops it first)" aria-label="Close the fly-through">
          ×
        </button>
      </header>
      <p className="fly-say" aria-live="polite">
        {caption(s)}
      </p>
      {n > 0 && (
        <div className="fly-pills progress">
          {s.steps.map((st, i) => (
            <button key={i} type="button" className={`${i < s.at ? "done" : i === s.at ? "on" : ""}${st.gap ? " gap" : ""}`} onClick={() => flyThrough.goto(i)} aria-label={`hop ${i + 1}: ${st.name}`} title={st.name} />
          ))}
        </div>
      )}
      <div className="fly-ctl">
        <button type="button" className="ctl compact" onClick={() => flyThrough.back()} disabled={s.at <= 0} aria-label="Back one hop">
          ‹ back
        </button>
        {done ? (
          <button type="button" className="ctl compact primary" onClick={() => flyThrough.replay()} disabled={!n}>
            ⟲ replay
          </button>
        ) : (
          <button type="button" className="ctl compact primary" onClick={() => flyThrough.toggle()} aria-pressed={playing}>
            {playing ? "❚❚ pause" : "▶ play"}
          </button>
        )}
        <button type="button" className="ctl compact" onClick={() => flyThrough.next()} disabled={s.at >= n - 1} aria-label="Next hop">
          next ›
        </button>
        <span className="sp" />
        <button
          type="button"
          className={`ctl compact ghost${s.voice ? " on" : ""}`}
          aria-pressed={s.voice}
          onClick={() => {
            unlockAudio();
            flyThrough.setVoice(!s.voice);
          }}
          title="Read each hop aloud with the voice chosen in Settings → Voice"
        >
          {s.voice ? "voice on" : "voice off"}
        </button>
        <button type="button" className="ctl compact ghost" onClick={() => flyThrough.saveAsTour()} disabled={!n || s.waiting} title="Keep this path as a tour in the Guide, to play again">
          Save as tour
        </button>
      </div>
      {s.refused > 0 && (
        <p className="note fly-refused">
          {s.refused === 1 ? "1 hop the map does not have was turned away." : `${s.refused} hops the map does not have were turned away.`}
        </p>
      )}
    </section>
  );
}
