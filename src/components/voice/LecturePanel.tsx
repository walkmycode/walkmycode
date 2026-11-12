"use client";
// A live talk with the lecturer (docs/VOICE.md §4, §4c): hands-free by default.
// The microphone streams the whole time and the lecturer's own turn detection
// (Deepgram Flux, ElevenLabs) decides when you have finished; speak over it and
// it stops at once (barge-in). The Talk pill shows what is happening
// (Listening, Thinking, Speaking, Paused), the microphone's level, a recording
// dot while the microphone is open, mute, and "Tap to end"; below it the
// captions, the functions it ran and what it has cost so far. "Hold to talk"
// (Settings → Voice) is the option for noisy rooms. The lecturer drives the
// room through its own actions (open a file at lines, focus a card, light a
// path, step the tour) and hands how/why questions to the typed guide
// (deep_answer). Speaking during a tour pauses the narration and tells the
// lecturer which step is on screen; afterwards it offers to carry on. Loaded
// only when a talk opens; it ends on "Tap to end", Esc, the Talk button, when
// the room is left, or after a minute of quiet ("Still there?" at 45 s), and
// the microphone is let go whenever it ends.
import { openSettings as openSettingsPane } from "@/lib/settingsNav";
import { useCallback, useEffect, useRef, useState } from "react";
import { ask, emptyConversation, type Conversation } from "@/lib/claude/client";
import { mapSummary } from "@/lib/claude/prompts";
import type { Tour } from "@/lib/claude/tools";
import type { FriendlyError } from "@/lib/providers/wire";
import { useShell } from "@/shell/WorkspaceProvider";
import { keytermsOf } from "@/lib/voice/agentSettings";
import { LECTURERS, lectureCost, lecturerModelFor, type InputMode } from "@/lib/voice/catalogue";
import type { TalkEffect } from "@/lib/voice/handsfree/conversation";
import { createLecturer, type CloseReason, type LecturerSession } from "@/lib/voice/lecturer";
import { attachTools, citationFeed, type LecturerUi } from "@/lib/voice/lecturer/tools";
import { stopNarration } from "@/lib/voice/narrate";
import { tourControl } from "@/lib/voice/tourBus";
import { useVoiceView } from "@/lib/voice/view";
import { setTalkControl, talk, type TalkControl } from "./Talk";
import TalkPill, { useConversation, useLevel } from "./TalkPill";
import { codeRoom, runAnswer } from "@/ide/codeRoom";

interface Caption {
  id: number;
  role: "user" | "assistant";
  text: string;
}

/** What the lecturer is told when a question comes during a tour. */
export function stepNote(t: Tour, step: number): string {
  const s = t.steps[step];
  return `The guided tour "${t.title}" is on step ${step + 1} of ${t.steps.length}: ${s.file} lines ${s.start_line}-${s.end_line} are lit on screen, and the narrator was saying: "${s.say}" When the user says "this", "here" or "this step", they mean those lines.`;
}

const VOICE_ANSWER = "(Asked out loud in a voice lecture: answer in under 120 words, in plain sentences a voice can read, citing file:line for each step.)";

const CLOSED: Record<CloseReason, string> = {
  ended: "Talk ended. The microphone is off.",
  idle: "Talk ended after a minute of quiet (it is billed by the minute). The microphone is off.",
  left: "Talk ended. The microphone is off.",
  error: "Talk stopped. The microphone is off.",
  server: "The lecturer hung up. The microphone is off.",
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
// "Open settings" opens Settings → Voice.
const openSettings = () => openSettingsPane("voice");

export default function LecturePanel({ onDismiss }: { onDismiss: () => void }) {
  const s = useShell();
  const shell = useRef(s);
  useEffect(() => {
    shell.current = s;
  });
  const view = useVoiceView();
  const [status, setStatus] = useState<"connecting" | "live" | "closed">("connecting");
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [closed, setClosed] = useState<{ reason: CloseReason; seconds: number } | null>(null);
  const [offerTour, setOfferTour] = useState(false);
  const [calls, setCalls] = useState<string[]>([]);
  const [since, setSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const level = useLevel();

  const session = useRef<LecturerSession | null>(null);
  const conversation = useRef<Conversation>(emptyConversation());
  const speaking = useRef(false);
  const pausedTour = useRef(false);
  const resumeWhenQuiet = useRef(false);
  const lastNote = useRef("");
  const captionId = useRef(0);

  const onEffect = useCallback((e: TalkEffect) => {
    switch (e.do) {
      case "barge-in":
        // The lecturer stops its own voice; a tour's narration stops here.
        stopNarration();
        break;
      case "end":
        session.current?.close(e.reason === "idle" ? "idle" : e.reason === "error" ? "error" : e.reason === "left" ? "left" : "ended");
        break;
      default:
        break;
    }
  }, []);
  const talkState = useConversation(onEffect);
  const { dispatch } = talkState;

  /** A question is coming: the tour waits, and the lecturer hears which step is on screen. */
  const questionComing = useCallback(() => {
    const lec = session.current;
    if (!lec) return;
    const { tour, step } = shell.current;
    if (tour && tour.steps[step]) {
      if (tourControl()?.pauseForQuestion()) {
        pausedTour.current = true;
        setOfferTour(false);
      }
      const key = `${tour.title}#${step}`;
      if (key !== lastNote.current && lec.updateContext(stepNote(tour, step))) lastNote.current = key;
    } else stopNarration();
  }, []);

  const press = useCallback(() => {
    const lec = session.current;
    if (!lec) return;
    questionComing();
    dispatch({ type: "press", at: Date.now() });
    lec.press();
  }, [questionComing, dispatch]);

  const release = useCallback(() => {
    dispatch({ type: "release", at: Date.now() });
    session.current?.release();
  }, [dispatch]);

  const end = useCallback(() => dispatch({ type: "end", at: Date.now(), reason: "ended" }), [dispatch]);

  /** Carry the paused tour on, once the lecturer has stopped speaking. */
  const carryOn = useCallback((): boolean => {
    if (!pausedTour.current || !tourControl()) return false;
    pausedTour.current = false;
    setOfferTour(false);
    if (speaking.current) resumeWhenQuiet.current = true;
    else tourControl()?.carryOn();
    return true;
  }, []);

  // One session per talk: made when the voice choice is known, closed when the panel goes.
  const lecturer = view?.lecturer;
  const model = view?.lecturerModel;
  const ready = !!view;
  const inputRef = useRef<InputMode>("hands-free");
  const headphonesRef = useRef(false);
  // Before the session's effect below, so a new session starts with the saved choice.
  useEffect(() => {
    inputRef.current = view?.input ?? "hands-free";
    headphonesRef.current = view?.headphones ?? false;
  });
  useEffect(() => {
    if (!ready || !lecturer || !model) return;
    const input = inputRef.current;
    const lec = createLecturer({
      lecturer,
      model,
      input,
      headphones: headphonesRef.current,
      audioContext: () => (talk.audio ??= new AudioContext()),
      context: () => ({ mapSummary: mapSummary(shell.current.map), keyterms: keytermsOf(shell.current.map) }),
    });
    session.current = lec;
    dispatch({ type: "start", at: Date.now(), input, connecting: true });
    const ui: LecturerUi = {
      repo: () => shell.current.repoView,
      openAt: (path, start, end) => shell.current.openAt(path, start, end),
      jumpTo: (id) => shell.current.jumpTo(id),
      light: (l) => shell.current.setLit(l),
      tour: () => (shell.current.tour ? { tour: shell.current.tour, step: shell.current.step } : null),
      setStep: (i) => shell.current.setStep(i),
      carryOn,
      ask: async (question, { signal, onCite }) => {
        // On WalkMyCode for Claude's page this is a `deep` request: the user's own Claude answers, and the agent speaks it.
        const r = await ask({ repo: shell.current.repoView, conversation: conversation.current, user: `${question}\n\n${VOICE_ANSWER}`, mode: "ask", request: { kind: "deep", payload: { text: question.slice(0, 20_000) } }, signal, onText: citationFeed(() => shell.current.repoView, onCite) });
        conversation.current = r.conversation;
        return r.text;
      },
      // run_code: the IDE in use now runs its code in the page's sandbox (src/ide/codeRoom.ts),
      // with a time limit; the answer is a short summary of its output or error.
      runCode: async () => runAnswer(await codeRoom.run()),
    };
    const detach = attachTools(lec, ui, {
      onCall: (name, args) => {
        dispatch({ type: "activity", at: Date.now() });
        setCalls((c) => [...c.slice(-5), `${name}(${String(args.path ?? args.id ?? args.query ?? args.question ?? "").slice(0, 40)})`]);
      },
    });
    const control: TalkControl = { press, release, end, input };
    const off = lec.on((e) => {
      const at = Date.now();
      switch (e.type) {
        case "status":
          setStatus(e.status);
          if (e.status === "live") {
            setSince(Date.now());
            dispatch({ type: "live", at });
            // Opened during a tour: the lecturer hears which step is on screen before the first question.
            const { tour, step } = shell.current;
            if (tour?.steps[step] && lec.updateContext(stepNote(tour, step))) lastNote.current = `${tour.title}#${step}`;
          }
          break;
        case "caption":
          dispatch({ type: "activity", at });
          setCaptions((c) => [...c.slice(-5), { id: ++captionId.current, role: e.role, text: e.text }]);
          break;
        case "listening":
          if (e.on) {
            // The user started speaking (heard by the lecturer, or cutting in over it).
            if (inputRef.current === "hands-free") questionComing();
            dispatch({ type: "user-start", at });
          } else dispatch({ type: "user-end", at });
          break;
        case "thinking":
          dispatch({ type: "thinking", at });
          break;
        case "speaking":
          speaking.current = e.on;
          dispatch({ type: "speaking", on: e.on, at });
          if (!e.on) {
            if (resumeWhenQuiet.current) {
              resumeWhenQuiet.current = false;
              tourControl()?.carryOn();
            } else if (pausedTour.current) setOfferTour(true);
          }
          break;
        case "level":
          level.sink.set(e.level);
          break;
        case "error":
          setError(e.error);
          break;
        case "close":
          setClosed({ reason: e.reason, seconds: e.seconds });
          dispatch({ type: "end", at, reason: e.reason === "idle" ? "idle" : e.reason === "error" ? "error" : "ended" });
          level.sink.set(0);
          if (talk.control === control) setTalkControl(null);
          break;
        default:
          break;
      }
    });
    setTalkControl(control);
    lec.connect().catch(() => {
      // Shown from the error event.
    });
    const leave = () => lec.close("left");
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      if (talk.control === control) setTalkControl(null);
      talk.held = false;
      off();
      detach();
      lec.close("left");
      session.current = null;
      // Deepgram's sound closes its own context; one made for nothing is closed here.
      void talk.audio?.close().catch(() => {});
      talk.audio = null;
    };
  }, [ready, lecturer, model, press, release, end, carryOn, questionComing, dispatch, level.sink]);

  // Settings → Voice changed mid-talk: the session follows.
  const input = view?.input;
  const headphones = view?.headphones;
  useEffect(() => {
    if (input) session.current?.setInput(input);
  }, [input]);
  useEffect(() => {
    if (headphones !== undefined) session.current?.setHeadphones?.(headphones);
  }, [headphones]);

  // Esc ends the talk; with hold to talk, Space is held to speak (except while typing).
  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && typeof el.closest === "function" && !!el.closest("input, textarea, select, [contenteditable='true'], [contenteditable=''], .cm-content");
    };
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape" && talk.control) {
        talk.control.end();
        return;
      }
      if (e.code !== "Space" || e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || talk.control?.input !== "push-to-talk") return;
      e.preventDefault();
      if (e.repeat || talk.held) return;
      talk.held = true;
      press();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !talk.held) return;
      e.preventDefault();
      talk.held = false;
      release();
    };
    const blur = () => {
      if (!talk.held) return;
      talk.held = false;
      release();
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", blur);
    };
  }, [press, release]);

  // The clock and the running cost, once a second while live.
  useEffect(() => {
    if (status !== "live") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status]);

  const ts = talkState.state;
  const seconds = closed ? closed.seconds : since ? Math.max(0, (now - since) / 1000) : 0;
  const def = lecturer ? LECTURERS[lecturer] : null;
  const m = lecturer && model ? lecturerModelFor(lecturer, model) : undefined;
  const cost = lecturer && model ? lectureCost(lecturer, model, seconds) : 0;

  return (
    <section className={`panel lecture ${status}`} aria-label="Talk with the lecturer" data-testid="lecture">
      <header>
        {status !== "closed" ? (
          <TalkPill
            state={ts}
            levelRef={level.ref}
            recording={ts.phase !== "off"}
            onMute={() => {
              const muted = !ts.muted;
              dispatch({ type: "mute", muted, at: Date.now() });
              session.current?.setMuted(muted);
            }}
            onEnd={end}
            holdHint="Hold Space or Talk to speak"
          />
        ) : (
          <>
            <i className="talk-dot" aria-hidden />
            <span className="lecture-status" role="status">
              {CLOSED[closed?.reason ?? "ended"]}
            </span>
          </>
        )}
        <span className="sp" />
        <span className="lecture-meter" title={def && m ? `${def.label} lecturer, ${m.label}: $${m.pricePerMin}/min${m.plusModel ? " plus the model's tokens" : ""}, by connected time` : undefined}>
          {clock(seconds)} · {m?.plusModel ? "≈" : ""}${cost.toFixed(3)}
        </span>
        {status === "closed" && (
          <button type="button" className="hdr-act" aria-label="Close" onClick={onDismiss}>
            ×
          </button>
        )}
      </header>
      {captions.length > 0 && (
        <div className="captions">
          {captions.slice(-3).map((c) => (
            <p key={c.id} className={c.role}>
              <b>{c.role === "user" ? "You" : "Lecturer"}:</b> {c.text}
            </p>
          ))}
        </div>
      )}
      {calls.length > 0 && <small className="ticker">did: {calls.slice(-3).join(" · ")}</small>}
      {error && (
        <p className="err">
          <strong>{error.title}</strong> {error.message}{" "}
          {error.action === "settings" && (
            <button type="button" className="ctl compact" onClick={openSettings}>
              Open settings
            </button>
          )}
        </p>
      )}
      {offerTour && status === "live" && (
        <button type="button" className="ctl compact primary" onClick={() => carryOn()}>
          ▶ carry on with the tour
        </button>
      )}
    </section>
  );
}
