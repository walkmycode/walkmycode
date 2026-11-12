// The page's side of on-device speech to text (docs/VOICE.md §4d): the
// microphone's 20 ms 16 kHz frames go to the local server in small pieces
// (POST /api/voice/parakeet/stream, one after another, about five a second),
// and each answer carries what was heard since the last: speech began, the
// words so far, the finished utterance. Nothing is sent anywhere else.
// No React, no DOM beyond fetch and btoa: tests drive it with a fake fetch.

export interface ParakeetEvents {
  /** Speech began. */
  speech?(): void;
  /** The words so far (a preview: they may still change). */
  partial?(text: string): void;
  /** An utterance ended and is being written down. */
  decoding?(): void;
  /** One finished utterance; empty when nothing intelligible was said. */
  final?(text: string): void;
  /** What started was too short to be anything. */
  discard?(): void;
  /** Something to tell the user (previews turned off, and why). */
  notice?(message: string): void;
  /** Hearing stopped: in words for the user. */
  error?(message: string): void;
}

/** What the Ear and the Learn mic need of a stream (tests hand over a fake). */
export interface ParakeetLike {
  push(frame: Int16Array): void;
  flush(): Promise<void>;
  reset(): void;
  close(): void;
}

type ServerEvent = { type: string; text?: string; message?: string };

export const STREAM_URL = "/api/voice/parakeet/stream";
/** Frames sent together: 10 × 20 ms = 0.2 s. */
export const PIECE_FRAMES = 10;
/** The most one post carries (5 s): a stalled post is caught up in a few. */
const MAX_FRAMES = 250;

function base64(frames: Int16Array[]): string {
  const n = frames.reduce((a, f) => a + f.length, 0);
  const bytes = new Uint8Array(n * 2);
  const v = new DataView(bytes.buffer);
  let at = 0;
  for (const f of frames) for (let i = 0; i < f.length; i++, at += 2) v.setInt16(at, f[i], true);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function newSessionId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export class ParakeetStream implements ParakeetLike {
  readonly session: string;
  private queue: Int16Array[] = [];
  private sending = false;
  private closed = false;
  private broken = false;
  private wantReset = false;
  private flushers: (() => void)[] = [];

  constructor(
    private on: ParakeetEvents,
    private fetchImpl: typeof fetch = (...a) => fetch(...a),
    session: string = newSessionId(),
  ) {
    this.session = session;
  }

  /** One 20 ms frame from the microphone. */
  push(frame: Int16Array): void {
    if (this.closed || this.broken) return;
    this.queue.push(frame);
    if (this.queue.length >= PIECE_FRAMES) void this.pump();
  }

  /** Stop, or push-to-talk let go: send what is left and wait for its words. */
  flush(): Promise<void> {
    if (this.closed || this.broken) return Promise.resolve();
    return new Promise<void>((done) => {
      this.flushers.push(done);
      void this.pump();
    });
  }

  /** Forget what is being heard (muted; our own voice was playing). */
  reset(): void {
    if (this.closed || this.broken) return;
    this.queue = [];
    this.wantReset = true;
    void this.pump();
  }

  /** The talk is over: the server forgets the session. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.queue = [];
    this.settleFlushers();
    void this.fetchImpl(STREAM_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: this.session, close: true }), keepalive: true }).catch(() => {});
  }

  private settleFlushers(): void {
    const all = this.flushers;
    this.flushers = [];
    for (const f of all) f();
  }

  private async pump(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      while (!this.closed && !this.broken) {
        const flushing = this.flushers.length > 0;
        if (!this.wantReset && !flushing && this.queue.length < PIECE_FRAMES) break;
        const frames = this.queue.splice(0, MAX_FRAMES);
        // A flush waits for the last piece: more may be queued behind this one.
        const flush = flushing && !this.queue.length;
        const waiting = flush ? this.flushers.splice(0) : [];
        const reset = this.wantReset;
        this.wantReset = false;
        const body = { session: this.session, ...(frames.length ? { pcm_base64: base64(frames) } : {}), ...(flush ? { flush: true } : {}), ...(reset ? { reset: true } : {}) };
        try {
          const res = await this.fetchImpl(STREAM_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
          const data = (await res.json().catch(() => ({}))) as { events?: ServerEvent[]; error?: string | { title?: string; message?: string } };
          if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : data.error ? `${data.error.title ?? "Speech to text failed"}. ${data.error.message ?? ""}`.trim() : `WalkMyCode's server answered ${res.status}.`);
          if (!this.closed) for (const e of data.events ?? []) this.deliver(e);
        } catch (e) {
          this.broken = true;
          this.queue = [];
          if (!this.closed) this.on.error?.((e as Error)?.message || "On-device speech to text stopped. Type your question instead.");
          this.settleFlushers();
        } finally {
          for (const f of waiting) f();
        }
      }
    } finally {
      this.sending = false;
    }
  }

  private deliver(e: ServerEvent): void {
    switch (e.type) {
      case "speech":
        return this.on.speech?.();
      case "partial":
        return this.on.partial?.(e.text ?? "");
      case "decoding":
        return this.on.decoding?.();
      case "final":
        return this.on.final?.(e.text ?? "");
      case "discard":
        return this.on.discard?.();
      case "notice":
        return this.on.notice?.(e.message ?? "");
      case "error":
        return this.on.error?.(e.message ?? "That couldn't be written down. Say it again?");
    }
  }
}

/** Have the model in memory before the first word (a mic panel opened). Never throws. */
export function preloadParakeet(fetchImpl: typeof fetch = (...a) => fetch(...a)): void {
  void fetchImpl("/api/voice/parakeet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "preload" }) }).catch(() => {});
}
