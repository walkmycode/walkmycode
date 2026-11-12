"use client";
// The Talk button (full app, and the Lightning lecturer on WalkMyCode for
// Claude's page): tap once to start a hands-free conversation with the
// lecturer, tap again (or Esc, or "Tap to end") to end it. With "Hold to talk"
// chosen in Settings → Voice (noisy rooms) the first tap opens the talk and
// the button, or Space, is then held to speak. The lecture panel and the voice
// code behind it load on the first tap. Without the chosen lecturer's key the
// button stays greyed and says what is missing.
import { useEffect, useReducer } from "react";
import type { FriendlyError } from "@/lib/providers/wire";
import type { InputMode } from "@/lib/voice/catalogue";
import { unlockAudio, useVoiceView } from "@/lib/voice/view";

/** What the open lecture panel lends the button (null when no talk is open). */
export interface TalkControl {
  press(): void;
  release(): void;
  end(): void;
  readonly input: InputMode;
}

/** Shared between the button and the panel it opens. */
export const talk: {
  /** Hold to talk: the button (or Space) is held down now. */
  held: boolean;
  control: TalkControl | null;
  /** Made in the tap that opened Talk, so the browser lets Deepgram's lecturer use it. */
  audio: AudioContext | null;
} = { held: false, control: null, audio: null };

const watchers = new Set<() => void>();

/** The panel lends (or takes back) its control; the button redraws. */
export function setTalkControl(c: TalkControl | null): void {
  talk.control = c;
  for (const w of watchers) w();
}

function useTalkControl(): TalkControl | null {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    watchers.add(redraw);
    return () => {
      watchers.delete(redraw);
    };
  }, []);
  return talk.control;
}

interface Props {
  open: boolean;
  /** Open a new talk. */
  onOpen: () => void;
  /** The lecturer cannot start: say why. */
  onBlocked: (e: FriendlyError) => void;
}

export default function TalkButton({ open, onOpen, onBlocked }: Props) {
  const view = useVoiceView({ idle: true });
  const blocked = view?.readiness.lecturer ?? null;
  const control = useTalkControl();
  const live = open && !!control;
  const hold = (control?.input ?? view?.input) === "push-to-talk";

  const start = () => {
    if (blocked) return onBlocked(blocked);
    unlockAudio();
    if (view?.lecturer === "deepgram-agent" && (!talk.audio || talk.audio.state === "closed") && typeof AudioContext !== "undefined") talk.audio = new AudioContext();
    onOpen();
  };
  const press = () => {
    if (talk.held || !talk.control) return;
    talk.held = true;
    talk.control.press();
  };
  const release = () => {
    if (!talk.held) return;
    talk.held = false;
    talk.control?.release();
  };

  const title = blocked
    ? `${blocked.title}. ${blocked.message}`
    : !live
      ? "Talk with the lecturer: tap once and just speak; tap again or press Esc to end"
      : hold
        ? "Hold to speak (or hold Space); let go and the lecturer answers"
        : "End the conversation (Esc)";
  return (
    <button
      type="button"
      className={`ctl talk${live ? " on" : ""}${blocked ? " blocked" : ""}`}
      aria-disabled={!!blocked}
      aria-pressed={live}
      title={title}
      data-testid="talk"
      onClick={() => {
        if (!talk.control) start();
        else if (talk.control.input === "hands-free") talk.control.end();
      }}
      onPointerDown={(e) => {
        if (e.button !== 0 || !talk.control || talk.control.input !== "push-to-talk") return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        press();
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <i className={`talk-dot${live ? " live" : ""}`} aria-hidden />
      {live && !hold ? "End" : "Talk"}
    </button>
  );
}
