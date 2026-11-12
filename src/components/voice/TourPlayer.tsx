"use client";
// The tour player (docs/VOICE.md §6): play, pause, and the step bar's own next
// and back. Each step is read by the narrator chosen in Settings → Voice while
// its lines and cards stay lit (the step's highlight, set by the workspace);
// when the audio ends the tour moves on by itself. The word being heard is
// lit when the narrator gives timings, with the CSS Custom Highlight API, so
// no word ever re-renders the board. The next step's audio is fetched while
// this one plays, and every step is cached per map, so a replay is free.
// Loaded only once a tour is on screen.
import { openSettings as openSettingsPane } from "@/lib/settingsNav";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Tour } from "@/lib/claude/tools";
import type { FriendlyError } from "@/lib/providers/wire";
import { getNarrator, VoiceError, type Scope } from "@/lib/voice/narrate";
import type { Span } from "@/lib/voice/speech";
import { registerTour } from "@/lib/voice/tourBus";
import { narratorInForce, unlockAudio, useVoiceView } from "@/lib/voice/view";

interface Props {
  tour: Tour;
  step: number;
  onStep: (i: number) => void;
  /** The map the tour is about: its audio is cached under it. */
  scope: Scope;
  /** The paragraph showing the step's words (its first child is their text). */
  sayEl: () => HTMLElement | null;
}

type Status = "idle" | "loading" | "playing" | "paused";

const HIGHLIGHT = "lantern-spoken";

/** The highlight's look, added once (the bundler's CSS parser rejects ::highlight() in globals.css). */
function highlightStyle(doc: Document) {
  if (doc.getElementById("lantern-spoken-style")) return;
  const s = doc.createElement("style");
  s.id = "lantern-spoken-style";
  s.textContent = `::highlight(${HIGHLIGHT}) { background-color: rgba(243, 215, 122, .3); color: #fff; }`;
  doc.head.appendChild(s);
}

type HighlightWindow = Window & { CSS?: { highlights?: HighlightRegistry }; Highlight?: typeof Highlight };

/** Light one word of the step's paragraph, or none. The paragraph may sit in a popped-out
 * window, whose highlight registry is its own. */
function markWord(el: HTMLElement | null, w: Span | null) {
  const win = (el?.ownerDocument.defaultView ?? (typeof window !== "undefined" ? window : null)) as HighlightWindow | null;
  const registry = win?.CSS?.highlights;
  const HighlightCtor = win?.Highlight;
  if (!win || !registry || !HighlightCtor) return;
  const node = el?.firstChild;
  if (!el || !w || !node || node.nodeType !== Node.TEXT_NODE) {
    registry.delete(HIGHLIGHT);
    return;
  }
  highlightStyle(el.ownerDocument);
  const len = (node as Text).length;
  const r = el.ownerDocument.createRange();
  r.setStart(node, Math.min(w.from, len));
  r.setEnd(node, Math.min(w.to, len));
  registry.set(HIGHLIGHT, new HighlightCtor(r));
}

// "Open settings" opens Settings → Voice.
const openSettings = () => openSettingsPane("voice");

export default function TourPlayer({ tour, step, onStep, scope, sayEl }: Props) {
  const view = useVoiceView();
  const inForce = view ? narratorInForce(view) : null;
  const narrator = useMemo(
    () => (view && inForce ? getNarrator({ narrator: inForce.narrator, voiceId: inForce.narrator === view.narrator ? view.voiceId : null, speed: view.speed }) : null),
    // The narrator changes only with the choice that makes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view?.narrator, view?.voiceId, view?.speed, inForce?.narrator],
  );
  // The user pressed play (the tour reads on by itself until it ends or they pause).
  const [want, setWant] = useState(false);
  const [paused, setPaused] = useState(false);
  // Which step's audio has started: before that, the step is loading.
  const [heard, setHeard] = useState<string | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  // A tour Claude hands the page (WalkMyCode for Claude) plays by itself, from its first step.
  const [autoFor, setAutoFor] = useState<Tour | null>(null);
  if (tour.autoplay && autoFor !== tour) {
    setAutoFor(tour);
    setError(null);
    setPaused(false);
    setHeard(null);
    setWant(true);
  }

  const current = tour.steps[step];
  const last = step >= tour.steps.length - 1;
  const stepKey = `${step}:${current?.say ?? ""}`;
  const status: Status = !want ? "idle" : paused ? "paused" : heard === stepKey ? "playing" : "loading";

  const statusRef = useRef<Status>(status);
  const forQuestion = useRef(false);
  const sayRef = useRef(sayEl);
  useEffect(() => {
    sayRef.current = sayEl;
    statusRef.current = status;
  });

  // While playing, read the step on screen; at its end, move on (the effect runs again for the next one).
  useEffect(() => {
    if (!want || !narrator || !current) return;
    let live = true;
    forQuestion.current = false;
    narrator
      .speak(current.say, {
        scope,
        onStart: () => {
          if (!live) return;
          setPaused(false);
          setHeard(stepKey);
        },
        onWord: (w) => live && markWord(sayRef.current(), w),
      })
      .then((end) => {
        if (!live) return;
        if (end === "ended" && !last) onStep(step + 1);
        else setWant(false);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setWant(false);
        setError(e instanceof VoiceError ? e.info : { code: "unknown", title: "Narration failed", message: (e as Error)?.message ?? "", action: "retry" });
      });
    // Gapless: the next step's audio is on its way while this one plays.
    const next = tour.steps[step + 1];
    if (next) void narrator.prefetch(next.say, scope);
    return () => {
      live = false;
      narrator.stop();
      markWord(sayRef.current(), null);
    };
  }, [want, narrator, tour, step, current, last, onStep, scope, stepKey]);

  // The lecturer pauses the narration for a question and carries it on after.
  useEffect(() => {
    if (!narrator) return;
    registerTour({
      pauseForQuestion: () => {
        const s = statusRef.current;
        if (s !== "playing" && s !== "loading") return false;
        narrator.pause();
        setPaused(true);
        forQuestion.current = true;
        return true;
      },
      carryOn: () => {
        if (!forQuestion.current) return false;
        forQuestion.current = false;
        narrator.resume();
        setPaused(false);
        return true;
      },
      playing: () => statusRef.current === "playing",
    });
    return () => registerTour(null);
  }, [narrator]);

  // Ending the tour stops the voice.
  useEffect(() => () => narrator?.stop(), [narrator]);

  const toggle = () => {
    unlockAudio();
    if (!narrator) return;
    if (status === "playing" || status === "loading") {
      narrator.pause();
      setPaused(true);
    } else if (status === "paused") {
      forQuestion.current = false;
      narrator.resume();
      setPaused(false);
    } else {
      setError(null);
      setPaused(false);
      setHeard(null);
      setWant(true);
    }
  };

  const label = status === "playing" ? "❚❚ pause" : status === "loading" ? "… loading" : status === "paused" ? "▶ resume" : "▶ play";
  const who = inForce?.narrator === "browser" ? "your browser's voice" : inForce?.narrator === "deepgram" ? "Deepgram" : "ElevenLabs";
  return (
    <span className="tour-voice">
      <button
        type="button"
        className={`ctl compact${status === "playing" ? " on" : ""}`}
        aria-pressed={status === "playing" || status === "loading"}
        onClick={toggle}
        disabled={!narrator}
        title={narrator ? `Read the tour aloud with ${who}; it moves on by itself` : "Loading the voice…"}
      >
        {label}
      </button>
      {error ? (
        <button type="button" className="voice-note bad" title={error.message} onClick={() => (error.action === "settings" ? openSettings() : toggle())}>
          {error.title}
        </button>
      ) : (
        inForce?.note && (
          <button type="button" className="voice-note" title={inForce.note.message} onClick={openSettings}>
            browser voice
          </button>
        )
      )}
    </span>
  );
}
