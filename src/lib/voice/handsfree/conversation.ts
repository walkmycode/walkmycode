// One model of a spoken conversation for every way WalkMyCode talks (docs/VOICE.md
// §4c): the full app's lecturers (ElevenAgents, Deepgram) and WalkMyCode for
// Claude's page (Talk through Claude, Free voice, the Lightning lecturer).
// Pure, so tests drive it with made-up time; the panels carry out its effects.
//
// - Hands-free by default: one tap starts it, one tap (or Esc) ends it. People
//   pause mid-thought, so a short pause doesn't end the question: what is said
//   is gathered until GATHER_MS of quiet, then sent as one request. Speaking
//   again before the answer is in sends the whole question again, in order,
//   as one request that replaces the unanswered one (`continues`). "Hold to talk" (Settings → Voice) is the option for
//   noisy rooms: then speech only counts while Space or Talk is held.
// - Barge-in: speech while WalkMyCode is speaking stops the voice at once.
// - Cost and privacy: after 45 s with nobody saying anything a gentle "Still
//   there?", after 60 s the conversation ends and the microphone is let go.
import type { InputMode } from "../catalogue";

export const STILL_THERE_MS = 45_000;
export const AUTO_END_MS = 60_000;
/** Quiet after speech (on top of the ear's own end-of-utterance pause) before what was said is sent. */
export const GATHER_MS = 1500;

export type TalkPhase = "off" | "connecting" | "listening" | "hearing" | "thinking" | "speaking";
export type EndReason = "ended" | "idle" | "left" | "error";

export interface TalkState {
  phase: TalkPhase;
  input: InputMode;
  muted: boolean;
  /** Push-to-talk: Space or the Talk button is down. */
  held: boolean;
  /** The "Still there?" prompt is showing. */
  warned: boolean;
  lastActivity: number;
  /** Said since the last request went, in order: sent once GATHER_MS pass quietly. */
  gathered: string;
  /** When the last of it was said. */
  gatheredAt: number;
  /** The question sent and not yet answered: more words before the answer join it. */
  asked: string | null;
}

export type TalkAction =
  | { type: "start"; at: number; input: InputMode; connecting?: boolean }
  /** Connected: the conversation can hear. */
  | { type: "live"; at: number }
  /** Speech began (our VAD, or the service heard it). */
  | { type: "user-start"; at: number }
  /** The utterance ended; `text` when this page sends it as a request (Talk through Claude). */
  | { type: "user-end"; at: number; text?: string }
  | { type: "thinking"; at: number }
  /** The answer is in (and was not spoken, or has been): listen again. */
  | { type: "done"; at: number }
  | { type: "speaking"; on: boolean; at: number }
  | { type: "mute"; muted: boolean; at: number }
  | { type: "press"; at: number }
  | { type: "release"; at: number }
  /** Something happened worth keeping the conversation open for (a caption, a function call). */
  | { type: "activity"; at: number }
  | { type: "tick"; at: number }
  /** GATHER_MS after the last words: send what was gathered if nobody has spoken since. */
  | { type: "settle"; at: number }
  | { type: "end"; at: number; reason: EndReason };

export type TalkEffect =
  /** Stop our voice and audio now and listen. */
  | { do: "barge-in" }
  /** Send this as one request; `continues`: it is the unanswered question with more said after it, and replaces it. */
  | { do: "send"; text: string; continues?: boolean }
  /** Push-to-talk let go: end the utterance now, whatever the silence detector says. */
  | { do: "commit" }
  | { do: "still-there" }
  /** Close the session and give the microphone back. */
  | { do: "end"; reason: EndReason };

export function initialTalk(at = 0, input: InputMode = "hands-free"): TalkState {
  return { phase: "off", input, muted: false, held: false, warned: false, lastActivity: at, gathered: "", gatheredAt: at, asked: null };
}

/** Whether speech counts now: open, not muted, and hands-free or held. */
export function hears(s: TalkState): boolean {
  if (s.phase === "off" || s.phase === "connecting" || s.muted) return false;
  return s.input === "hands-free" || s.held;
}

/** Whether the microphone is open (the recording indicator): from the start to the end. */
export function micOpen(s: TalkState): boolean {
  return s.phase !== "off";
}

export type PillLabel = "Connecting" | "Listening" | "Hearing" | "Thinking" | "Speaking" | "Paused" | "Still there?" | "Hold to talk";

/** The word on the Talk pill. */
export function pillLabel(s: TalkState): PillLabel | null {
  if (s.phase === "off") return null;
  if (s.phase === "connecting") return "Connecting";
  if (s.muted) return "Paused";
  if (s.warned) return "Still there?";
  if (s.phase === "thinking") return "Thinking";
  if (s.phase === "speaking") return "Speaking";
  if (s.input === "push-to-talk" && !s.held) return "Hold to talk";
  return s.phase === "hearing" ? "Hearing" : "Listening";
}

export function reduceTalk(s: TalkState, a: TalkAction): { state: TalkState; effects: TalkEffect[] } {
  const fx: TalkEffect[] = [];
  let n = s;
  const set = (p: Partial<TalkState>) => {
    n = { ...n, ...p };
  };
  const touch = (at: number) => set({ lastActivity: at, warned: false });
  // What was said goes as one request: joined to the unanswered question when there is one.
  const send = (text: string) => {
    const asked = n.asked;
    const whole = asked ? `${asked} ${text}` : text;
    set({ phase: "thinking", gathered: "", asked: whole });
    fx.push(asked ? { do: "send", text: whole, continues: true } : { do: "send", text: whole });
  };

  if (s.phase === "off" && a.type !== "start") return { state: s, effects: fx };

  switch (a.type) {
    case "start":
      if (s.phase !== "off") break;
      n = { ...initialTalk(a.at, a.input), phase: a.connecting ? "connecting" : "listening" };
      break;
    case "live":
      if (s.phase === "connecting") set({ phase: "listening" });
      touch(a.at);
      break;
    case "user-start":
      if (!hears(s)) break;
      touch(a.at);
      if (s.phase === "speaking") fx.push({ do: "barge-in" });
      set({ phase: "hearing" });
      break;
    case "user-end": {
      // Hold to talk: the words of a hold just let go still count (they arrive after the release).
      if (!hears(s) && !(s.input === "push-to-talk" && !s.muted)) break;
      touch(a.at);
      const text = a.text?.trim();
      if (text && s.input === "push-to-talk") send(text);
      else if (text) {
        // Hands-free: gathered until a longer quiet (settle), so a pause mid-thought keeps the question whole.
        set({ phase: "listening", gathered: s.gathered ? `${s.gathered} ${text}` : text, gatheredAt: a.at });
      } else if (s.phase === "hearing") set({ phase: s.gathered || s.asked === null ? "listening" : "thinking" });
      break;
    }
    case "settle":
      if (s.gathered && s.phase !== "hearing" && a.at - s.gatheredAt >= GATHER_MS) send(s.gathered);
      break;
    case "thinking":
      touch(a.at);
      if (s.phase !== "hearing") set({ phase: "thinking" });
      break;
    case "done":
      touch(a.at);
      set({ asked: null });
      if (s.phase === "thinking") set({ phase: "listening" });
      break;
    case "speaking":
      touch(a.at);
      if (a.on) {
        if (s.phase !== "hearing") set({ phase: "speaking" });
      } else if (s.phase === "speaking") set({ phase: "listening" });
      break;
    case "mute":
      touch(a.at);
      set({ muted: a.muted, held: false });
      if (a.muted && s.phase === "hearing") set({ phase: "listening" });
      break;
    case "press":
      if (s.input !== "push-to-talk" || s.held) break;
      touch(a.at);
      set({ held: true, muted: false });
      if (s.phase === "speaking") fx.push({ do: "barge-in" });
      set({ phase: "hearing" });
      break;
    case "release":
      if (!s.held) break;
      touch(a.at);
      set({ held: false });
      if (s.phase === "hearing") set({ phase: "listening" });
      fx.push({ do: "commit" });
      break;
    case "activity":
      touch(a.at);
      break;
    case "tick": {
      // A missed settle: what was gathered still goes once the quiet is long enough.
      if (s.gathered && s.phase !== "hearing" && a.at - s.gatheredAt >= GATHER_MS) {
        send(s.gathered);
        break;
      }
      // Only quiet counts: while someone speaks, thinks or is held down, the clock waits.
      const quietPhase = s.phase === "listening" || (s.muted && s.phase === "hearing");
      if (!quietPhase || s.held) {
        set({ lastActivity: a.at });
        break;
      }
      const quiet = a.at - s.lastActivity;
      if (quiet >= AUTO_END_MS) {
        n = { ...n, phase: "off", held: false, warned: false };
        fx.push({ do: "end", reason: "idle" });
      } else if (quiet >= STILL_THERE_MS && !s.warned) {
        set({ warned: true });
        fx.push({ do: "still-there" });
      }
      break;
    }
    case "end":
      // Ended by the user right after speaking: what they said still goes.
      if (s.gathered && a.reason === "ended") send(s.gathered);
      n = { ...n, phase: "off", held: false, warned: false, gathered: "", asked: null };
      fx.push({ do: "end", reason: a.reason });
      break;
  }
  return { state: n, effects: fx };
}
