// The Deepgram session's rules as a pure reducer: the state, and what to do
// about each thing that happens. The controller (session.ts) carries out the
// effects (send, flush the speaker, close the socket, settle connect()); tests
// drive this directly with made-up time.
//
// - Settings go first, the microphone only after SettingsApplied (docs/VOICE.md §4.1).
// - Barge-in: on UserStartedSpeaking the speaker is flushed at once and the rest of the
//   interrupted reply is dropped until the next one starts; pressing Talk does the same
//   without waiting for the server.
// - Push-to-talk: audio flows while held, then a second of silence so the listener hears
//   the turn end; hands-free: always, unless muted.
// - Echo guard (speakers, not headphones; as iReliabee's mock interview does): while the
//   lecturer speaks, Deepgram gets silent frames instead of the microphone, so it never
//   hears itself. The session still watches the microphone, and when the user is clearly
//   louder than the echo it cuts the lecturer off ("barge") and the real frames flow again.
// - KeepAlive every 8 s while no audio flows; close after a minute of nobody saying
//   anything (billing is by connected time).
// - A cancelled call is never answered, even if its answer arrives later.
import type { FriendlyError } from "@/lib/providers/wire";
import { CONTEXT_RESERVE } from "../../agentSettings";
import type { CloseReason, InputMode, LecturerEvent } from "../session";
import { IDLE_CLOSE_MS } from "../session";
import { parseArgs, type ClientMessage, type ServerMessage } from "./protocol";

export type Phase = "idle" | "connecting" | "configuring" | "live" | "closed";
/**
 * Where microphone frames go: nowhere, to Deepgram, replaced by silence (the push-to-talk
 * end-of-turn tail), or replaced by silence while watched for a barge-in (the echo guard).
 */
export type MicRoute = "off" | "live" | "silence" | "guard";

export const KEEPALIVE_MS = 8000;
export const TAIL_MS = 1200;
const MAX_CANCELLED = 64;
const MAX_NOTE = 1200;

export interface AgentState {
  phase: Phase;
  requestId: string | null;
  input: InputMode;
  holding: boolean;
  muted: boolean;
  /** Headphones on: no echo guard, the real microphone goes even while the lecturer speaks. */
  headphones: boolean;
  tailUntil: number;
  mic: MicRoute;
  agent: "idle" | "thinking" | "speaking";
  /** Deepgram has sent the whole reply's audio; the speaker may still be draining it. */
  audioDone: boolean;
  /** Drop agent audio until the next reply starts: the user cut in. */
  gate: boolean;
  userSpeaking: boolean;
  /** Function calls in flight: id → name. */
  calls: Record<string, string>;
  /** Recently cancelled call ids, never to be answered. */
  cancelled: string[];
  /** Characters UpdatePrompt may still add before the prompt reaches Deepgram's limit. */
  promptRoom: number;
  openedAt: number | null;
  closedAt: number | null;
  lastActivity: number;
  lastKeepAlive: number;
}

export type Action =
  | { type: "connect"; at: number; input?: InputMode }
  | { type: "socket-open"; at: number }
  | { type: "message"; msg: ServerMessage; at: number }
  | { type: "audio"; frame: ArrayBuffer; at: number }
  | { type: "drained"; at: number }
  | { type: "press"; at: number }
  | { type: "release"; at: number }
  | { type: "input"; mode: InputMode; at: number }
  | { type: "mute"; muted: boolean; at: number }
  | { type: "headphones"; on: boolean; at: number }
  /** The user is clearly speaking over the lecturer (the session's own detector, under the echo guard). */
  | { type: "barge"; at: number }
  | { type: "result"; id: string; name: string; content: string; at: number }
  | { type: "context"; note: string; at: number }
  | { type: "inject"; message: string; at: number }
  | { type: "tick"; at: number }
  | { type: "socket-close"; code: number; reason: string; at: number }
  | { type: "fail"; error: FriendlyError; at: number }
  | { type: "close"; reason: CloseReason; at: number };

export type Effect =
  | { do: "send"; msg: ClientMessage }
  | { do: "send-settings" }
  | { do: "play"; frame: ArrayBuffer }
  | { do: "flush" }
  | { do: "close-socket"; code: number; reason: string }
  /** connect() resolves: the agent is listening. */
  | { do: "live" }
  /** connect() rejects. */
  | { do: "failed"; error: FriendlyError }
  | { do: "emit"; event: LecturerEvent };

export function initialState(at: number, input: InputMode = "push-to-talk", headphones = false): AgentState {
  return {
    phase: "idle",
    requestId: null,
    input,
    holding: false,
    muted: false,
    headphones,
    tailUntil: 0,
    mic: "off",
    agent: "idle",
    audioDone: true,
    gate: false,
    userSpeaking: false,
    calls: {},
    cancelled: [],
    promptRoom: CONTEXT_RESERVE,
    openedAt: null,
    closedAt: null,
    lastActivity: at,
    lastKeepAlive: at,
  };
}

/** Where microphone frames should go now. */
export function micRoute(s: AgentState, at: number): MicRoute {
  if (s.phase === "idle" || s.phase === "closed") return "off";
  if (s.input === "hands-free") {
    if (s.muted) return "off";
    return s.agent === "speaking" && !s.headphones ? "guard" : "live";
  }
  if (s.holding) return "live";
  return at < s.tailUntil ? "silence" : "off";
}

/** Whether the microphone counts as open (the guard sends silence, but the conversation is listening). */
const sends = (r: MicRoute) => r === "live" || r === "guard";

/** What a close code before SettingsApplied most likely means. */
export function connectError(code: number, reason: string): FriendlyError {
  if (code === 1008 || /auth|token|unauthori[sz]ed|forbidden/i.test(reason)) {
    return { code: "invalid_key", title: "Deepgram refused the connection", message: "The voice agent did not accept WalkMyCode's token. Check your Deepgram key in Settings → Voice (it needs Member permissions or above).", action: "settings" };
  }
  return { code: "network", title: "Can't connect to Deepgram", message: "The voice agent closed the connection before it was ready. Check your internet connection and try again.", action: "retry", ...(reason ? { detail: reason.slice(0, 300) } : {}) };
}

const agentError = (m: { code?: string; description?: string }): FriendlyError => ({
  code: "unknown",
  title: "The voice agent reported a problem",
  message: m.description || "Deepgram sent an error without a description.",
  action: "retry",
  ...(m.code ? { detail: m.code } : {}),
});

export function reduce(s: AgentState, a: Action): { state: AgentState; effects: Effect[] } {
  const fx: Effect[] = [];
  const emit = (event: LecturerEvent) => fx.push({ do: "emit", event });
  let n: AgentState = s;
  const set = (patch: Partial<AgentState>) => {
    n = { ...n, ...patch };
  };
  const seconds = (at: number) => (n.openedAt === null ? 0 : Math.max(0, (at - n.openedAt) / 1000));
  const stopSpeaking = () => {
    if (n.agent === "speaking") emit({ type: "speaking", on: false });
    set({ agent: "idle" });
  };
  const shut = (at: number, reason: CloseReason, error?: FriendlyError) => {
    const wasLive = n.phase === "live";
    const open = n.phase === "configuring" || n.phase === "live";
    set({ phase: "closed", closedAt: at, holding: false, calls: {} });
    fx.push({ do: "flush" });
    if (open) fx.push({ do: "close-socket", code: 1000, reason });
    if (!wasLive) fx.push({ do: "failed", error: error ?? { code: "unknown", title: "Talk was closed", message: "The session closed before it was ready.", action: null } });
    if (error) emit({ type: "error", error, fatal: true });
    emit({ type: "status", status: "closed" });
    emit({ type: "close", reason, seconds: seconds(at) });
  };

  switch (a.type) {
    case "connect":
      if (s.phase !== "idle") break;
      set({ phase: "connecting", lastActivity: a.at, lastKeepAlive: a.at, ...(a.input ? { input: a.input } : {}) });
      emit({ type: "status", status: "connecting" });
      break;

    case "socket-open":
      if (s.phase !== "connecting") break;
      set({ phase: "configuring", openedAt: a.at, lastActivity: a.at });
      fx.push({ do: "send-settings" });
      break;

    case "message": {
      if (s.phase === "closed") break;
      const m = a.msg;
      set({ lastActivity: a.at });
      switch (m.type) {
        case "Welcome":
          set({ requestId: m.request_id ?? null });
          break;
        case "SettingsApplied":
          if (n.phase !== "configuring") break;
          set({ phase: "live", lastKeepAlive: a.at });
          fx.push({ do: "live" });
          emit({ type: "status", status: "live" });
          break;
        case "ConversationText":
          if (typeof m.content !== "string" || !m.content.trim()) break;
          emit({ type: "caption", role: m.role === "user" ? "user" : "assistant", text: m.content });
          if (m.role === "user") {
            // The user's turn is in: whatever audio comes next is the new reply.
            set({ gate: false });
            if (n.userSpeaking) emit({ type: "listening", on: false });
            set({ userSpeaking: false });
          }
          break;
        case "UserStartedSpeaking":
          fx.push({ do: "flush" });
          stopSpeaking();
          set({ gate: true, audioDone: true });
          if (!n.userSpeaking) emit({ type: "listening", on: true });
          set({ userSpeaking: true });
          break;
        case "EndOfTurn":
          if (n.userSpeaking) emit({ type: "listening", on: false });
          set({ userSpeaking: false, gate: false });
          break;
        case "AgentThinking":
          set({ agent: "thinking", gate: false });
          if (n.userSpeaking) emit({ type: "listening", on: false });
          set({ userSpeaking: false });
          emit({ type: "thinking" });
          break;
        case "AgentStartedSpeaking":
          set({ gate: false, audioDone: false });
          if (n.agent !== "speaking") emit({ type: "speaking", on: true });
          set({ agent: "speaking" });
          break;
        case "AgentAudioDone":
          set({ audioDone: true });
          break;
        case "FunctionCallRequest":
          for (const f of Array.isArray(m.functions) ? m.functions : []) {
            if (!f || typeof f.id !== "string" || typeof f.name !== "string") continue;
            // A function with an endpoint is Deepgram's to call (WalkMyCode sends none).
            if (f.client_side === false) continue;
            if (n.cancelled.includes(f.id) || n.calls[f.id]) continue;
            set({ calls: { ...n.calls, [f.id]: f.name } });
            emit({ type: "functionCall", id: f.id, name: f.name, args: parseArgs(f.arguments) });
          }
          break;
        case "FunctionCallCancelled": {
          const ids = (Array.isArray(m.functions) ? m.functions : []).map((f) => f?.id).filter((id): id is string => typeof id === "string");
          if (!ids.length) break;
          const calls = { ...n.calls };
          for (const id of ids) delete calls[id];
          set({ calls, cancelled: [...n.cancelled, ...ids].slice(-MAX_CANCELLED) });
          emit({ type: "cancelled", ids });
          break;
        }
        case "Warning":
          emit({ type: "warning", message: m.description || m.code || "Deepgram sent a warning." });
          break;
        case "Error":
          if (n.phase === "live") emit({ type: "error", error: agentError(m), fatal: false });
          else shut(a.at, "error", agentError(m));
          break;
        default:
          break;
      }
      break;
    }

    case "audio":
      if (s.phase !== "live" || s.gate) break;
      set({ lastActivity: a.at });
      if (n.agent !== "speaking") {
        emit({ type: "speaking", on: true });
        set({ agent: "speaking", audioDone: false });
      }
      fx.push({ do: "play", frame: a.frame });
      break;

    case "drained":
      if (s.agent === "speaking" && s.audioDone) {
        set({ lastActivity: a.at });
        stopSpeaking();
      }
      break;

    case "press":
      if (s.phase === "closed") break;
      set({ holding: true, lastActivity: a.at });
      // Barge-in without waiting for the server: whatever the lecturer was saying stops now.
      if (n.agent === "speaking") {
        fx.push({ do: "flush" });
        set({ gate: true, audioDone: true });
        stopSpeaking();
      }
      break;

    case "release":
      if (!s.holding) break;
      set({ holding: false, tailUntil: a.at + TAIL_MS, lastActivity: a.at });
      break;

    case "input":
      set({ input: a.mode, holding: false, muted: false, tailUntil: 0, lastActivity: a.at });
      break;

    case "mute":
      set({ muted: a.muted, lastActivity: a.at });
      break;

    case "headphones":
      set({ headphones: a.on, lastActivity: a.at });
      break;

    case "barge":
      // Only over the lecturer's own voice: the speaker goes quiet now, the rest of the reply is dropped.
      if (s.phase !== "live" || s.agent !== "speaking") break;
      fx.push({ do: "flush" });
      stopSpeaking();
      set({ gate: true, audioDone: true, lastActivity: a.at });
      if (!n.userSpeaking) emit({ type: "listening", on: true });
      set({ userSpeaking: true });
      break;

    case "result":
      if (s.phase !== "live" || !s.calls[a.id] || s.cancelled.includes(a.id)) break;
      {
        const calls = { ...n.calls };
        delete calls[a.id];
        set({ calls, lastActivity: a.at });
      }
      fx.push({ do: "send", msg: { type: "FunctionCallResponse", id: a.id, name: a.name, content: a.content } });
      break;

    case "context": {
      if (s.phase !== "live") break;
      const prompt = `\n\n# Context note (the latest one wins)\n${a.note.slice(0, MAX_NOTE)}`;
      if (prompt.length > s.promptRoom) break;
      set({ promptRoom: s.promptRoom - prompt.length, lastActivity: a.at });
      fx.push({ do: "send", msg: { type: "UpdatePrompt", prompt } });
      break;
    }

    case "inject":
      if (s.phase !== "live" || !a.message.trim()) break;
      fx.push({ do: "send", msg: { type: "InjectAgentMessage", message: a.message, behavior: "queue" } });
      break;

    case "tick":
      if (s.phase !== "live") break;
      // Only once the audio had already stopped: the count starts when it stops (below).
      if (s.mic === "off" && micRoute(s, a.at) === "off" && a.at - s.lastKeepAlive >= KEEPALIVE_MS) {
        set({ lastKeepAlive: a.at });
        fx.push({ do: "send", msg: { type: "KeepAlive" } });
      }
      if (!s.holding && s.agent === "idle" && !s.userSpeaking && !Object.keys(s.calls).length && a.at - s.lastActivity >= IDLE_CLOSE_MS) shut(a.at, "idle");
      break;

    case "socket-close":
      if (s.phase === "closed") break;
      if (s.phase === "live") shut(a.at, "server");
      else shut(a.at, "error", connectError(a.code, a.reason));
      break;

    case "fail":
      if (s.phase === "closed") break;
      shut(a.at, "error", a.error);
      break;

    case "close":
      if (s.phase === "closed" || s.phase === "idle") {
        if (s.phase === "idle") set({ phase: "closed", closedAt: a.at });
        break;
      }
      shut(a.at, a.reason);
      break;
  }

  // The microphone follows the state; when it stops, the KeepAlive count starts.
  const route = micRoute(n, a.at);
  if (route !== n.mic) {
    if (route === "off") set({ lastKeepAlive: a.at });
    if (sends(route) !== sends(n.mic)) emit({ type: "mic", open: sends(route), mode: n.input });
    set({ mic: route });
  }
  return { state: n, effects: fx };
}
