// The ElevenLabs lecturer (owner's decision, 1 Oct: the default, so one voice
// runs through tours and talk). The server makes and keeps in step a private
// agent in the user's ElevenLabs account and hands back a signed link
// (POST /api/voice/elevenagents/session), so the key never reaches the page.
// The page talks to it with ElevenLabs' own client (@elevenlabs/client,
// pinned), loaded only when this lecturer starts: its client tools are the
// shared functions, answered through the same dispatcher as Deepgram's.
//
// What the SDK does itself: the microphone (echo cancellation and noise
// suppression on), playback, end of turn (ElevenLabs' own turn detection,
// "normal" eagerness), barge-in (it stops the voice when ElevenLabs detects
// the user), and keeping the socket alive. Muted, it sends silence, so
// releasing push-to-talk ends the turn the way a pause would.
//
// Echo guard (speakers, not headphones): while the agent speaks hands-free its
// microphone is muted, so ElevenLabs never hears its own voice back; this
// session watches the microphone's level itself (the SDK's analyser sits
// before its mute), and when the user is clearly louder than the echo it
// quiets the agent at once and opens the microphone again, so ElevenLabs hears
// the user and interrupts for real.
import type { FriendlyError } from "@/lib/providers/wire";
import { routeError, UNREACHABLE, VoiceError } from "../errors";
import { Vad } from "../handsfree/vad";
import { FUNCTION_NAMES } from "./functions";
import { Emitter, IDLE_CLOSE_MS, type CloseReason, type InputMode, type LecturerListener, type LecturerSession } from "./session";

/** What WalkMyCode uses of the SDK's conversation (tests hand in a fake). */
export interface ElevenConversationLike {
  endSession(): Promise<void>;
  setMicMuted(muted: boolean): void;
  setVolume(o: { volume: number }): void;
  sendContextualUpdate(text: string): void;
  /** The microphone's volume, 0–1 (0 while muted). */
  getInputVolume?(): number;
}

/** The SDK's input analyser, which hears the microphone even while muted (not in its public types). */
function analyserOf(conv: ElevenConversationLike): AnalyserNode | null {
  try {
    const input = (conv as unknown as { input?: { getAnalyser?: () => AnalyserNode } }).input;
    return input?.getAnalyser?.() ?? null;
  } catch {
    return null;
  }
}

/** How often the microphone's level is read for the ring and the echo guard. */
const LEVEL_MS = 40;

/** Conversation.startSession, as far as WalkMyCode calls it. */
export type StartSession = (options: Record<string, unknown>) => Promise<ElevenConversationLike>;

export interface ElevenDeps {
  fetch: typeof fetch;
  /** Defaults to @elevenlabs/client's Conversation.startSession, loaded on first use. */
  start?: StartSession;
  context: () => { mapSummary: string; keyterms: string[] };
  input?: InputMode;
  /** Headphones on: no echo guard. */
  headphones?: boolean;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
  onClosed?: (seconds: number) => void;
}

interface SessionAnswer {
  signed_url: string;
  overrides: { prompt?: string; voice_id?: string; keywords?: boolean };
}

/** Kept short of ElevenLabs' contextual-update use: one note per tour step is plenty. */
const MAX_NOTE = 1200;

export class ElevenAgentsLecturer implements LecturerSession {
  readonly provider = "elevenagents" as const;
  private emitter = new Emitter();
  private conv: ElevenConversationLike | null = null;
  private input: InputMode;
  private holding = false;
  private muted = false;
  private speaking = false;
  private closed = false;
  private live = false;
  private openedAt: number | null = null;
  private lastActivity: number;
  private timer: unknown = null;
  private seq = 0;
  private calls = new Map<string, (content: string) => void>();
  private closeReason: CloseReason = "server";
  private headphones: boolean;
  /** The user cut in over this reply: the guard stays off until the next one. */
  private barged = false;
  private vad = new Vad({ frameMs: LEVEL_MS });
  private levelTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private deps: ElevenDeps) {
    this.input = deps.input ?? "push-to-talk";
    this.headphones = deps.headphones ?? false;
    this.lastActivity = this.now();
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  on(l: LecturerListener): () => void {
    return this.emitter.on(l);
  }

  private emit = (e: Parameters<Emitter["emit"]>[0]) => this.emitter.emit(e);

  private activity() {
    this.lastActivity = this.now();
  }

  /** Whether the user's microphone should reach ElevenLabs now. */
  private micOpen(): boolean {
    return this.input === "hands-free" ? !this.muted : this.holding;
  }

  /** The echo guard is up: hands-free on speakers, the agent speaking, nobody has cut in. */
  private guarding(): boolean {
    return this.input === "hands-free" && !this.muted && !this.headphones && this.speaking && !this.barged;
  }

  private applyMic() {
    this.conv?.setMicMuted(!this.micOpen() || this.guarding());
    this.emit({ type: "mic", open: this.micOpen(), mode: this.input });
  }

  /** Read the microphone's level: for the ring, and under the guard for the user cutting in. */
  private watchLevel(conv: ElevenConversationLike) {
    const analyser = analyserOf(conv);
    if (!analyser && typeof conv.getInputVolume !== "function") return;
    const buf = analyser ? new Float32Array(analyser.fftSize) : null;
    this.levelTimer = setInterval(() => {
      if (this.closed) return;
      let level = 0;
      if (analyser && buf) {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        level = Math.sqrt(sum / buf.length);
      } else level = conv.getInputVolume?.() ?? 0;
      const open = this.micOpen();
      this.emit({ type: "level", level: open ? level : 0 });
      const guard = this.guarding();
      this.vad.setPlayback(guard);
      if (!open) return this.vad.reset();
      const e = this.vad.push(level);
      if (guard && e?.type === "start" && e.barge) this.bargeIn();
    }, LEVEL_MS);
  }

  /** The user is clearly speaking over the agent: quiet it now and let ElevenLabs hear them. */
  private bargeIn() {
    this.barged = true;
    this.activity();
    this.conv?.setVolume({ volume: 0 });
    this.applyMic();
    if (this.speaking) {
      this.speaking = false;
      this.emit({ type: "speaking", on: false });
    }
    this.emit({ type: "listening", on: true });
  }

  async connect(): Promise<void> {
    this.emit({ type: "status", status: "connecting" });
    try {
      const { mapSummary, keyterms } = this.deps.context();
      let res: Response;
      try {
        res = await this.deps.fetch("/api/voice/elevenagents/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ map_summary: mapSummary }) });
      } catch {
        throw new VoiceError(UNREACHABLE);
      }
      if (!res.ok) throw new VoiceError(await routeError(res, "Talk could not start"));
      const s = (await res.json()) as SessionAnswer;
      if (this.closed) return;
      const start = this.deps.start ?? (((await import("@elevenlabs/client")).Conversation.startSession as unknown) as StartSession);
      const overrides: Record<string, unknown> = {};
      if (s.overrides?.prompt) overrides.agent = { prompt: { prompt: s.overrides.prompt } };
      if (s.overrides?.voice_id) overrides.tts = { voiceId: s.overrides.voice_id };
      if (s.overrides?.keywords && keyterms.length) overrides.asr = { keywords: keyterms };
      const clientTools = Object.fromEntries(FUNCTION_NAMES.map((name) => [name, (params: unknown) => this.call(name, params)]));
      const conv = await start({
        signedUrl: s.signed_url,
        connectionType: "websocket",
        clientTools,
        overrides,
        onConnect: () => {
          this.live = true;
          this.openedAt = this.now();
          this.activity();
          // Push-to-talk starts with the microphone shut.
          this.conv?.setMicMuted(!this.micOpen());
        },
        onDisconnect: (d: { reason?: string; message?: string }) => this.finish(d?.reason === "error" ? "error" : d?.reason === "agent" ? "server" : this.closeReason, d?.reason === "error" ? { code: "network", title: "ElevenLabs closed the conversation", message: d.message || "The connection to ElevenLabs dropped. Press Talk to start again.", action: "retry" } : undefined),
        onMessage: (m: { message?: string; role?: string; source?: string }) => {
          this.activity();
          const text = typeof m?.message === "string" ? m.message.trim() : "";
          if (!text) return;
          const user = m.role === "user" || m.source === "user";
          this.emit({ type: "caption", role: user ? "user" : "assistant", text });
          if (user) {
            this.emit({ type: "listening", on: false });
            this.emit({ type: "thinking" });
          }
        },
        onModeChange: (m: { mode?: string }) => {
          this.activity();
          const on = m?.mode === "speaking";
          if (this.barged) {
            // The reply the user cut into is still the old one; once it ends the next is heard again.
            if (on) return;
            this.barged = false;
            this.conv?.setVolume({ volume: this.holding ? 0 : 1 });
            this.applyMic();
          }
          if (on === this.speaking) return;
          this.speaking = on;
          this.emit({ type: "speaking", on });
          if (this.input === "hands-free") this.applyMic();
        },
        onInterruption: () => {
          this.activity();
          this.emit({ type: "listening", on: true });
          if (this.speaking) {
            this.speaking = false;
            this.emit({ type: "speaking", on: false });
          }
        },
        onVadScore: (v: { vadScore?: number }) => {
          if ((v?.vadScore ?? 0) > 0.6) this.activity();
        },
        onError: (message: string) => this.emit({ type: "error", error: { code: "unknown", title: "ElevenLabs reported a problem", message: String(message || "No details."), action: "retry" }, fatal: false }),
      });
      this.conv = conv;
      if (this.closed) {
        void conv.endSession().catch(() => {});
        return;
      }
      this.live = true;
      this.openedAt ??= this.now();
      this.applyMic();
      this.emit({ type: "status", status: "live" });
      const every = this.deps.setInterval ?? ((f: () => void, ms: number) => setInterval(f, ms));
      this.timer = every(() => this.tick(), 1000);
      this.watchLevel(conv);
    } catch (e) {
      const info: FriendlyError = e instanceof VoiceError ? e.info : { code: "unknown", title: "Talk could not start", message: micOrSdk(e), action: "retry" };
      this.finish("error", info);
      throw e instanceof VoiceError ? e : new VoiceError(info);
    }
  }

  /** A client tool call from the agent: out as an event, back through respond(). */
  private call(name: string, params: unknown): Promise<string> {
    this.activity();
    const id = `el_${++this.seq}`;
    return new Promise<string>((resolve) => {
      this.calls.set(id, resolve);
      this.emit({ type: "functionCall", id, name, args: params && typeof params === "object" && !Array.isArray(params) ? (params as Record<string, unknown>) : {} });
    });
  }

  respond(id: string, _name: string, content: string): void {
    const r = this.calls.get(id);
    if (!r) return;
    this.calls.delete(id);
    this.activity();
    r(content);
  }

  private tick() {
    if (!this.live || this.closed) return;
    if (!this.holding && !this.speaking && !this.calls.size && this.now() - this.lastActivity >= IDLE_CLOSE_MS) this.close("idle");
  }

  setInput(mode: InputMode): void {
    this.input = mode;
    this.holding = false;
    this.muted = false;
    this.activity();
    this.applyMic();
  }

  press(): void {
    if (this.closed) return;
    this.holding = true;
    this.activity();
    // Quiet the lecturer at once; ElevenLabs interrupts it for real when it hears the user.
    this.conv?.setVolume({ volume: 0 });
    this.applyMic();
  }

  release(): void {
    if (!this.holding) return;
    this.holding = false;
    this.activity();
    this.conv?.setVolume({ volume: 1 });
    this.applyMic();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.activity();
    this.applyMic();
  }

  setHeadphones(on: boolean): void {
    this.headphones = on;
    this.applyMic();
  }

  updateContext(note: string): boolean {
    if (!this.conv || this.closed) return false;
    this.conv.sendContextualUpdate(note.slice(0, MAX_NOTE));
    return true;
  }

  /** ElevenAgents speaks before a slow tool itself (pre_tool_speech), so there is nothing to send. */
  inject(): void {}

  private finish(reason: CloseReason, error?: FriendlyError) {
    if (this.closed) return;
    this.closed = true;
    if (this.timer !== null) (this.deps.clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>)))(this.timer);
    this.timer = null;
    if (this.levelTimer !== null) clearInterval(this.levelTimer);
    this.levelTimer = null;
    for (const r of this.calls.values()) r(JSON.stringify({ ok: false, error: "The conversation ended." }));
    this.calls.clear();
    const seconds = this.openedAt === null ? 0 : Math.max(0, (this.now() - this.openedAt) / 1000);
    if (error) this.emit({ type: "error", error, fatal: true });
    if (this.speaking) this.emit({ type: "speaking", on: false });
    this.speaking = false;
    this.emit({ type: "status", status: "closed" });
    this.emit({ type: "close", reason, seconds });
    this.deps.onClosed?.(seconds);
  }

  close(reason: CloseReason = "ended"): void {
    if (this.closed) return;
    this.closeReason = reason;
    const conv = this.conv;
    this.finish(reason);
    void conv?.endSession().catch(() => {});
  }
}

/** The SDK's failure to start, in words: most often the microphone. */
function micOrSdk(e: unknown): string {
  const name = (e as { name?: string })?.name ?? "";
  if (name === "NotAllowedError") return "The microphone is blocked for this page. Allow it (the icon at the left of the address bar), then press Talk again.";
  if (name === "NotFoundError") return "No microphone was found. Plug one in, then press Talk again.";
  return String((e as Error)?.message ?? e ?? "ElevenLabs did not start.").slice(0, 300);
}
