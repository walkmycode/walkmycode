"use client";
// The Talk pill (docs/VOICE.md §4c): one look for a spoken conversation in the
// full app and on WalkMyCode for Claude's page. It says what is happening
// (Listening, Thinking, Speaking, Paused, Still there?), shows the
// microphone's level as a ring that swells as you speak, a recording dot
// whenever the microphone is open, and offers mute and "Tap to end". The state
// is announced politely to screen readers; the ring and its pulse follow the
// motion setting (--m). The level is written straight to a CSS variable, so a
// level 25 times a second never re-renders React.
import { useCallback, useEffect, useRef, useState } from "react";
import { GATHER_MS, initialTalk, pillLabel, reduceTalk, type TalkAction, type TalkEffect, type TalkState } from "@/lib/voice/handsfree/conversation";

/** Where the microphone's level goes: set() as often as it comes; the ring follows. */
export interface LevelSink {
  set(level: number): void;
}

/** A level ring's element and its setter (smoothed: quick to rise, slower to fall). */
export function useLevel(): { ref: (el: HTMLElement | null) => void; sink: LevelSink } {
  const [ring] = useState(() => {
    let el: HTMLElement | null = null;
    let shown = 0;
    return {
      ref(node: HTMLElement | null) {
        el = node;
        shown = 0;
        node?.style.setProperty("--lvl", "0");
      },
      sink: {
        set(level: number) {
          // RMS is small: a square root spreads quiet speech across the ring.
          const target = Math.min(1, Math.sqrt(Math.max(0, level)) * 2.4);
          const v = target > shown ? target : shown + (target - shown) * 0.25;
          if (Math.abs(v - shown) < 0.01 && target !== 0) return;
          shown = v;
          el?.style.setProperty("--lvl", v.toFixed(3));
        },
      } as LevelSink,
    };
  });
  return ring;
}

/**
 * The conversation's state (handsfree/conversation.ts) for a component:
 * dispatch() runs an action and hands each effect to `onEffect`; a tick every
 * second while it is on drives "Still there?" and the automatic end.
 */
export function useConversation(onEffect: (e: TalkEffect, s: TalkState) => void) {
  const [shown, setShown] = useState<TalkState>(initialTalk);
  const state = useRef<TalkState>(shown);
  const handler = useRef(onEffect);
  useEffect(() => {
    handler.current = onEffect;
  });
  const dispatch = useCallback((a: TalkAction) => {
    const r = reduceTalk(state.current, a);
    if (r.state !== state.current) {
      state.current = r.state;
      setShown(r.state);
    }
    for (const e of r.effects) handler.current(e, r.state);
  }, []);
  const on = shown.phase !== "off";
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => dispatch({ type: "tick", at: Date.now() }), 1000);
    return () => clearInterval(t);
  }, [on, dispatch]);
  // What was said goes once GATHER_MS pass with nothing more said (a new word starts the wait again).
  const { gathered, gatheredAt } = shown;
  useEffect(() => {
    if (!gathered) return;
    const t = setTimeout(() => dispatch({ type: "settle", at: Date.now() }), Math.max(0, gatheredAt + GATHER_MS - Date.now()) + 20);
    return () => clearTimeout(t);
  }, [gathered, gatheredAt, dispatch]);
  return { state: shown, dispatch, current: () => state.current };
}

interface Props {
  state: TalkState;
  /** The ring's element (from useLevel). */
  levelRef: (el: HTMLElement | null) => void;
  /** The microphone is open (the recording indicator). */
  recording: boolean;
  onMute: () => void;
  onEnd: () => void;
  /** Push-to-talk: what to hold. */
  holdHint?: string;
  testId?: string;
}

const STATE_CLASS: Record<string, string> = {
  Connecting: "connecting",
  Listening: "listening",
  Hearing: "listening",
  Thinking: "thinking",
  Speaking: "speaking",
  Paused: "paused",
  "Still there?": "still",
  "Hold to talk": "hold",
};

export default function TalkPill({ state, levelRef, recording, onMute, onEnd, holdHint, testId }: Props) {
  const label = pillLabel(state);
  if (!label) return null;
  const said = label === "Hold to talk" && holdHint ? holdHint : label === "Still there?" ? "Still there? Say something, or tap to end" : label === "Hearing" ? "Hearing you…" : label;
  const hearing = state.phase === "hearing";
  return (
    <div className={`talk-pill ${STATE_CLASS[label]}${hearing ? " hearing" : ""}`} data-testid={testId} data-state={STATE_CLASS[label]}>
      <span className="talk-ring" ref={levelRef} aria-hidden>
        <i />
      </span>
      {recording && (
        <span className="talk-rec" title="The microphone is on">
          <i aria-hidden />
          <span className="sr-only">Microphone on</span>
        </span>
      )}
      <span className="talk-state" role="status" aria-live="polite">
        {said}
      </span>
      {state.input === "hands-free" && (
        <button type="button" className={`talk-btn${state.muted ? " on" : ""}`} aria-pressed={state.muted} onClick={onMute} title={state.muted ? "Unmute: WalkMyCode listens again" : "Mute: WalkMyCode stops listening"}>
          {state.muted ? "Unmute" : "Mute"}
        </button>
      )}
      <button type="button" className="talk-btn end" onClick={onEnd} title="End the conversation (Esc); the microphone is let go">
        Tap to end
      </button>
    </div>
  );
}
