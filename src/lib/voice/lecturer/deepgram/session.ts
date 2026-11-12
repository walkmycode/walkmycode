// The Deepgram lecturer (docs/VOICE.md §4, phase 1, no relay): the browser
// asks the server for a 30-second grant and for the Settings, opens
// wss://agent.deepgram.com/v1/agent/converse with the subprotocols
// ["bearer", jwt], sends the Settings (with the map added) and waits for
// SettingsApplied before any microphone audio goes. The rules live in the
// reducer; this file carries out its effects on the socket and the speakers.
import type { FriendlyError } from "@/lib/providers/wire";
import { AGENT_URL, withContext, type AgentSettings } from "../../agentSettings";
import { routeError, UNREACHABLE, VoiceError } from "../../errors";
import { MicError, type AudioIO } from "../audio";
import { Emitter, type CloseReason, type InputMode, type LecturerListener, type LecturerSession } from "../session";
import { rms, Vad } from "../../handsfree/vad";
import { parseServerMessage } from "./protocol";
import { initialState, reduce, type Action, type AgentState, type Effect } from "./reducer";

/** The parts of a browser WebSocket the session uses (tests hand in a fake). */
export interface WebSocketLike {
  readonly readyState: number;
  binaryType: string;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type WebSocketCtor = new (url: string, protocols?: string | string[]) => WebSocketLike;

export interface DeepgramDeps {
  fetch: typeof fetch;
  WebSocket: WebSocketCtor;
  /** Sound in and out, made when the session starts (the microphone prompt comes with Talk). */
  audio: () => Promise<AudioIO>;
  /** What only the page has: the map's summary and its names. */
  context: () => { mapSummary: string; keyterms: string[] };
  input?: InputMode;
  /** Headphones on: no echo guard. */
  headphones?: boolean;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
  url?: string;
  /** The connected seconds, once, when the session closes (for the cost meter). */
  onClosed?: (seconds: number) => void;
}

const OPEN = 1;
/** Microphone frames kept while the session gets ready (300 × 20 ms = 6 s). */
const MAX_PENDING = 300;
/** Real frames kept under the echo guard, sent after a barge-in so the first word is whole (300 ms). */
const PREROLL = 15;

export class DeepgramLecturer implements LecturerSession {
  readonly provider = "deepgram-agent" as const;
  private state: AgentState;
  private emitter = new Emitter();
  private ws: WebSocketLike | null = null;
  private io: AudioIO | null = null;
  private settings: AgentSettings | null = null;
  private pending: ArrayBuffer[] = [];
  private timer: unknown = null;
  private settle: { resolve: () => void; reject: (e: unknown) => void } | null = null;
  private cleaned = false;
  /** Watches the microphone under the echo guard for the user cutting in. */
  private vad = new Vad();
  private preroll: ArrayBuffer[] = [];
  private frames = 0;

  constructor(private deps: DeepgramDeps) {
    this.state = initialState(this.now(), deps.input, deps.headphones);
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  /** The reducer's state, for tests and the panel's debugging. */
  get snapshot(): AgentState {
    return this.state;
  }

  on(l: LecturerListener): () => void {
    return this.emitter.on(l);
  }

  connect(): Promise<void> {
    const ready = new Promise<void>((resolve, reject) => {
      this.settle = { resolve, reject };
    });
    this.apply({ type: "connect", at: this.now() });
    void this.open();
    return ready;
  }

  private async open(): Promise<void> {
    try {
      // The microphone prompt, the grant and the Settings, all at once.
      const [, token, settings] = await Promise.all([this.startAudio(), this.token(), this.agentSettings()]);
      if (this.state.phase === "closed") return this.cleanup();
      this.settings = withContext(settings, this.deps.context());
      const ws = new this.deps.WebSocket(this.deps.url ?? AGENT_URL, ["bearer", token]);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      ws.onopen = () => this.apply({ type: "socket-open", at: this.now() });
      ws.onmessage = (ev) => this.message(ev.data);
      // The close that follows an error says what happened.
      ws.onerror = () => {};
      ws.onclose = (ev) => this.apply({ type: "socket-close", code: ev?.code ?? 1006, reason: ev?.reason ?? "", at: this.now() });
      const every = this.deps.setInterval ?? ((f: () => void, ms: number) => setInterval(f, ms));
      this.timer = every(() => this.apply({ type: "tick", at: this.now() }), 1000);
    } catch (e) {
      const info: FriendlyError = e instanceof VoiceError || e instanceof MicError ? e.info : UNREACHABLE;
      this.apply({ type: "fail", error: info, at: this.now() });
    }
  }

  private async startAudio(): Promise<void> {
    const io = await this.deps.audio();
    // Closed while the audio was being set up: let it go at once.
    if (this.cleaned) return void io.close().catch(() => {});
    this.io = io;
    io.onDrained(() => this.apply({ type: "drained", at: this.now() }));
    await io.startMic((frame) => this.frame(frame));
  }

  private async token(): Promise<string> {
    let res: Response;
    try {
      res = await this.deps.fetch("/api/voice/token", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    } catch {
      throw new VoiceError(UNREACHABLE);
    }
    if (!res.ok) throw new VoiceError(await routeError(res, "Talk could not start"));
    const j = (await res.json()) as { access_token?: unknown };
    if (typeof j.access_token !== "string" || !j.access_token) throw new VoiceError({ code: "unknown", title: "Talk could not start", message: "The server sent no Deepgram token.", action: "retry" });
    return j.access_token;
  }

  private async agentSettings(): Promise<AgentSettings> {
    let res: Response;
    try {
      res = await this.deps.fetch("/api/voice/settings");
    } catch {
      throw new VoiceError(UNREACHABLE);
    }
    if (!res.ok) throw new VoiceError(await routeError(res, "Talk could not start"));
    return (await res.json()) as AgentSettings;
  }

  private message(data: unknown): void {
    if (typeof data === "string") {
      const msg = parseServerMessage(data);
      if (msg) this.apply({ type: "message", msg, at: this.now() });
      return;
    }
    if (data instanceof ArrayBuffer) return this.apply({ type: "audio", frame: data, at: this.now() });
    if (ArrayBuffer.isView(data)) return this.apply({ type: "audio", frame: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, at: this.now() });
    const blob = data as { arrayBuffer?: () => Promise<ArrayBuffer> };
    if (blob && typeof blob.arrayBuffer === "function") void blob.arrayBuffer().then((frame) => this.apply({ type: "audio", frame, at: this.now() }));
  }

  /**
   * A microphone frame: sent, replaced by silence (the end-of-turn tail, or the echo guard
   * while the lecturer speaks), kept until ready, or dropped. Under the guard it is also
   * watched: speech clearly above the echo cuts the lecturer off and the real frames flow.
   */
  private frame(buf: ArrayBuffer): void {
    let route = this.state.mic;
    const level = route === "off" ? 0 : rms(new Int16Array(buf), true);
    if (++this.frames % 2 === 0) this.emitter.emit({ type: "level", level });
    this.vad.setPlayback(route === "guard");
    if (route === "guard" || route === "live") {
      const e = this.vad.push(level);
      if (route === "guard" && e?.type === "start" && e.barge) {
        this.apply({ type: "barge", at: this.now() });
        route = this.state.mic;
        if (route === "live") {
          const ws = this.ws;
          if (ws && ws.readyState === OPEN && this.state.phase === "live") for (const p of this.preroll) ws.send(p);
          this.preroll = [];
        }
      }
    }
    if (route === "guard") {
      this.preroll.push(buf.slice(0));
      if (this.preroll.length > PREROLL) this.preroll.shift();
    } else if (this.preroll.length) this.preroll = [];
    if (route === "off") return;
    const out = route === "silence" || route === "guard" ? new ArrayBuffer(buf.byteLength) : buf;
    const ws = this.ws;
    if (this.state.phase !== "live" || !ws || ws.readyState !== OPEN) {
      if (this.state.phase !== "closed" && this.pending.length < MAX_PENDING) this.pending.push(out);
      return;
    }
    this.flushPending();
    ws.send(out);
  }

  private flushPending(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== OPEN || this.state.phase !== "live") return;
    for (const p of this.pending) ws.send(p);
    this.pending = [];
  }

  private send(text: string): void {
    const ws = this.ws;
    if (ws && ws.readyState === OPEN) ws.send(text);
  }

  private apply(a: Action): void {
    const { state, effects } = reduce(this.state, a);
    this.state = state;
    for (const e of effects) this.run(e);
  }

  private run(e: Effect): void {
    switch (e.do) {
      case "send":
        this.send(JSON.stringify(e.msg));
        break;
      case "send-settings":
        if (this.settings) this.send(JSON.stringify(this.settings));
        break;
      case "play":
        this.io?.play(e.frame);
        break;
      case "flush":
        this.io?.flush();
        break;
      case "close-socket":
        try {
          this.ws?.close(e.code, e.reason.slice(0, 100));
        } catch {
          // Already closing.
        }
        break;
      case "live":
        this.flushPending();
        this.settle?.resolve();
        this.settle = null;
        break;
      case "failed":
        this.settle?.reject(new VoiceError(e.error));
        this.settle = null;
        break;
      case "emit":
        if (e.event.type === "close") {
          this.deps.onClosed?.(e.event.seconds);
          this.cleanup();
        }
        this.emitter.emit(e.event);
        break;
    }
  }

  private cleanup(): void {
    if (this.cleaned) return;
    this.cleaned = true;
    if (this.timer !== null) (this.deps.clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>)))(this.timer);
    this.timer = null;
    this.pending = [];
    const io = this.io;
    this.io = null;
    void io?.close().catch(() => {});
  }

  setInput(mode: InputMode): void {
    this.apply({ type: "input", mode, at: this.now() });
  }

  press(): void {
    this.apply({ type: "press", at: this.now() });
  }

  release(): void {
    this.apply({ type: "release", at: this.now() });
  }

  setMuted(muted: boolean): void {
    this.apply({ type: "mute", muted, at: this.now() });
  }

  setHeadphones(on: boolean): void {
    this.apply({ type: "headphones", on, at: this.now() });
  }

  respond(id: string, name: string, content: string): void {
    this.apply({ type: "result", id, name, content, at: this.now() });
  }

  updateContext(note: string): boolean {
    const before = this.state.promptRoom;
    this.apply({ type: "context", note, at: this.now() });
    return this.state.promptRoom < before;
  }

  inject(message: string): void {
    this.apply({ type: "inject", message, at: this.now() });
  }

  close(reason: CloseReason = "ended"): void {
    this.apply({ type: "close", reason, at: this.now() });
    this.cleanup();
  }
}
