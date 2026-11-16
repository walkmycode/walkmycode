"use client";
// Talking with the professor (docs/VOICE.md §4d, mockup docs/design/learn-talk.html): a live, hands-free voice
// conversation in the lesson, through Deepgram's agent (Flux listens, a Claude model thinks, Flux speaks in the
// voice style from Settings → Voice). Cut in at any time and he stops and listens. He knows the lesson and the board
// on screen (lib/talk.ts), hears when it changes, and drives the lesson with his functions (next board, the
// example, the quiz, explain it back, a note). Think Live checks in when the student goes quiet and notices
// frustration; with headphones he also says "mm-hmm". Every turn lands in the lesson's conversation, marked as
// spoken. Shown in place of the lesson's controls while the talk is on; the microphone is let go when it ends.
import { useCallback, useEffect, useRef, useState } from "react";
import type { FriendlyError } from "@/lib/providers/wire";
import { openSettings } from "@/lib/settingsNav";
import { LECTURERS, lectureCost, lecturerModelFor, type InputMode } from "@/lib/voice/catalogue";
import type { TalkEffect } from "@/lib/voice/handsfree/conversation";
import { createLecturer, type CloseReason, type LecturerSession } from "@/lib/voice/lecturer";
import { useVoiceView } from "@/lib/voice/view";
import TalkPill, { useConversation, useLevel, type HandState } from "@/components/voice/TalkPill";
import { boardNote, lessonBrief, lessonKeyterms, runProfessorCall, type ProfessorUi } from "@/learn/lib/talk";
import type { Lesson, Profile } from "@/learn/lib/types";

/** What the room shows of the talk: who has the floor, and the line being said. */
export interface TalkShow {
  agentSpeaking: boolean;
  userSpeaking: boolean;
  thinking: boolean;
  line: { role: "you" | "prof"; text: string } | null;
}

interface Props {
  lesson: Lesson;
  idx: number;
  profile: Profile | null;
  notes: string[];
  ui: ProfessorUi;
  /** Made in the click that opened the talk, so the browser lets it play and listen. */
  audio: AudioContext;
  onHeard: (role: "you" | "prof", text: string) => void;
  onShow: (s: TalkShow) => void;
  /** The talk has a voice now (connecting or live), or not (ended: its strip may still show until "Back to the lesson"). */
  onLive?: (live: boolean) => void;
  onClose: () => void;
}

const CLOSED: Record<CloseReason, string> = {
  ended: "Talk ended. The microphone is off.",
  idle: "Talk ended after a minute of quiet (it is billed by the minute). The microphone is off.",
  left: "Talk ended. The microphone is off.",
  error: "Talk stopped. The microphone is off.",
  server: "The professor hung up. The microphone is off.",
};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function ProfessorTalk({ lesson, idx, profile, notes, ui, audio, onHeard, onShow, onLive, onClose }: Props) {
  const view = useVoiceView();
  // The latest of everything the session's handlers read, without restarting it.
  const latest = useRef({ lesson, idx, profile, notes, ui, onHeard, onShow });
  useEffect(() => {
    latest.current = { lesson, idx, profile, notes, ui, onHeard, onShow };
  });
  const [status, setStatus] = useState<"connecting" | "live" | "closed">("connecting");
  // The page hushes its own voice only while this one can speak: an ended talk gives the voice back at once.
  useEffect(() => {
    onLive?.(status !== "closed");
  }, [status, onLive]);
  useEffect(() => () => onLive?.(false), [onLive]);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [closed, setClosed] = useState<{ reason: CloseReason; seconds: number } | null>(null);
  const [since, setSince] = useState<number | null>(null);
  const [hand, setHand] = useState<HandState>("down");
  const [now, setNow] = useState(() => Date.now());
  const level = useLevel();
  const session = useRef<LecturerSession | null>(null);
  const shown = useRef<TalkShow>({ agentSpeaking: false, userSpeaking: false, thinking: false, line: null });
  const show = useCallback((patch: Partial<TalkShow>) => {
    shown.current = { ...shown.current, ...patch };
    latest.current.onShow(shown.current);
  }, []);
  const toldBoard = useRef(-1);

  const onEffect = useCallback((e: TalkEffect) => {
    if (e.do === "end") session.current?.close(e.reason === "idle" ? "idle" : e.reason === "error" ? "error" : e.reason === "left" ? "left" : "ended");
  }, []);
  const talkState = useConversation(onEffect);
  const { dispatch } = talkState;
  const end = useCallback(() => dispatch({ type: "end", at: Date.now(), reason: "ended" }), [dispatch]);

  const hasKey = !!view?.keys.DEEPGRAM_API_KEY?.has_key;
  const model = view ? (view.lecturer === "deepgram-agent" ? view.lecturerModel : LECTURERS["deepgram-agent"].defaultModel) : null;
  const inputRef = useRef<InputMode>("hands-free");
  const headphonesRef = useRef(false);
  useEffect(() => {
    inputRef.current = view?.input ?? "hands-free";
    headphonesRef.current = view?.headphones ?? false;
  });

  // One session per talk: made once the voice choice is known, closed when the talk goes.
  useEffect(() => {
    if (!view || !model || !hasKey) return;
    const input = inputRef.current;
    const lec = createLecturer({
      lecturer: "deepgram-agent",
      model,
      input,
      headphones: headphonesRef.current,
      audioContext: () => audio,
      context: () => ({ mapSummary: "", keyterms: [] }),
      lesson: () => {
        const l = latest.current;
        toldBoard.current = l.idx;
        return { lesson: lessonBrief(l.lesson, l.idx, l.profile, l.notes), keyterms: lessonKeyterms(l.lesson) };
      },
    });
    session.current = lec;
    dispatch({ type: "start", at: Date.now(), input, connecting: true });
    const off = lec.on((e) => {
      const at = Date.now();
      switch (e.type) {
        case "status":
          setStatus(e.status);
          if (e.status === "live") {
            setSince(Date.now());
            dispatch({ type: "live", at });
          }
          break;
        case "caption": {
          dispatch({ type: "activity", at });
          const role = e.role === "user" ? "you" : "prof";
          latest.current.onHeard(role, e.text);
          show({ line: { role, text: e.text } });
          break;
        }
        case "listening":
          dispatch({ type: e.on ? "user-start" : "user-end", at });
          show({ userSpeaking: e.on, ...(e.on ? { thinking: false } : {}) });
          break;
        case "thinking":
          dispatch({ type: "thinking", at });
          show({ thinking: true });
          break;
        case "speaking":
          dispatch({ type: "speaking", on: e.on, at });
          show({ agentSpeaking: e.on, thinking: false });
          break;
        case "functionCall": {
          dispatch({ type: "activity", at });
          let content: string;
          try {
            content = runProfessorCall(e.name, e.args, latest.current.ui);
          } catch {
            content = JSON.stringify({ ok: false, why: "That did not work in the page." });
          }
          lec.respond(e.id, e.name, content);
          break;
        }
        case "level":
          level.sink.set(e.level);
          break;
        case "hand":
          setHand(e.state === "down" ? "down" : e.state);
          dispatch({ type: "activity", at });
          if (e.state === "floor") show({ agentSpeaking: false, thinking: false });
          break;
        case "error":
          setError(e.error);
          break;
        case "close":
          setClosed({ reason: e.reason, seconds: e.seconds });
          setStatus("closed");
          setHand("down");
          dispatch({ type: "end", at, reason: e.reason === "idle" ? "idle" : e.reason === "error" ? "error" : "ended" });
          level.sink.set(0);
          show({ agentSpeaking: false, userSpeaking: false, thinking: false, line: null });
          break;
        default:
          break;
      }
    });
    lec.connect().catch(() => {
      // Shown from the error event.
    });
    const leave = () => lec.close("left");
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      off();
      lec.close("left");
      session.current = null;
      void audio.close().catch(() => {});
    };
  }, [view, model, hasKey, audio, dispatch, level.sink, show]);

  // The board changed (his doing or the student's): he hears which board is on screen now.
  useEffect(() => {
    const lec = session.current;
    if (!lec || status !== "live" || toldBoard.current === idx) return;
    if (lec.updateContext(boardNote(latest.current.lesson, idx))) toldBoard.current = idx;
  }, [idx, status]);

  // Settings → Voice changed mid-talk: the session follows.
  const input = view?.input;
  const headphones = view?.headphones;
  useEffect(() => {
    if (input) session.current?.setInput(input);
  }, [input]);
  useEffect(() => {
    if (headphones !== undefined) session.current?.setHeadphones?.(headphones);
  }, [headphones]);

  // Raise your hand: he stops, says "Go ahead", then listens.
  const raiseHand = useCallback(() => session.current?.raiseHand?.(), []);

  // Esc ends the talk; H raises a hand; with hold to talk, Space is held to speak (except while typing).
  useEffect(() => {
    let held = false;
    const typing = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true'], .cm-content");
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape") return end();
      if ((e.key === "h" || e.key === "H") && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && !typing(e.target)) {
        e.preventDefault();
        return raiseHand();
      }
      if (e.code !== "Space" || inputRef.current !== "push-to-talk" || typing(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat || held) return;
      held = true;
      dispatch({ type: "press", at: Date.now() });
      session.current?.press();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !held) return;
      e.preventDefault();
      held = false;
      dispatch({ type: "release", at: Date.now() });
      session.current?.release();
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
    };
  }, [dispatch, end, raiseHand]);

  // The clock and the running cost, once a second while live.
  useEffect(() => {
    if (status !== "live") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status]);

  const seconds = closed ? closed.seconds : since ? Math.max(0, (now - since) / 1000) : 0;
  const m = model ? lecturerModelFor("deepgram-agent", model) : undefined;
  const cost = model ? lectureCost("deepgram-agent", model, seconds) : 0;
  const ts = talkState.state;

  if (view && !hasKey) {
    return (
      <div className="talk-strip" role="status" data-testid="professor-talk">
        <span className="talk-note">
          <b>Talking with the professor needs a Deepgram key.</b> Add it in Settings → Voice; it is billed by the minute ({m ? `$${m.pricePerMin}/min` : "a few cents a minute"}).
        </span>
        <span className="sp" />
        <button type="button" className="ctl" onClick={() => openSettings("voice")}>Open settings</button>
        <button type="button" className="ctl" onClick={onClose}>Close</button>
      </div>
    );
  }

  return (
    <div className={`talk-strip ${status}`} role="toolbar" aria-label="Talking with the professor" data-testid="professor-talk">
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
          holdHint="Hold Space to talk, or press H to raise your hand"
          testId="professor-talk-pill"
          hand={hand}
          onHand={status === "live" ? raiseHand : undefined}
        />
      ) : (
        <span className="talk-note" role="status">{CLOSED[closed?.reason ?? "ended"]}</span>
      )}
      {error && (
        <span className="talk-err" role="alert">
          <b>{error.title}.</b> {error.message}
          {error.action === "settings" && <button type="button" className="link" onClick={() => openSettings("voice")}>Open settings</button>}
        </span>
      )}
      <span className="sp" />
      <span className="talk-meter" title={m ? `${m.label}: $${m.pricePerMin}/min, by connected time, on your Deepgram key` : undefined}>
        {m?.label ?? ""} · {clock(seconds)} · ${cost.toFixed(3)}
      </span>
      {status === "closed" ? (
        <button type="button" className="ctl" onClick={onClose}>Back to the lesson</button>
      ) : (
        <button type="button" className="ctl talk-end" onClick={end}>End</button>
      )}
    </div>
  );
}
