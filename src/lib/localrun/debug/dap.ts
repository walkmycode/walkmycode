// The Debug Adapter Protocol, the client's half (https://microsoft.github.io/debug-adapter-protocol): what
// WalkMyCode says to a debugger (CodeLLDB, netcoredbg, Delve…) and hears back. Each message is a JSON body
// after a "Content-Length: N\r\n\r\n" header; requests are answered by responses with the request's seq,
// and events arrive at any time. The transport is a plain duplex stream (a TCP socket the adapter
// connected to, or its stdio), so the tests can drive it with a pair of PassThroughs.
import type { Readable, Writable } from "node:stream";

export interface DapEvent {
  event: string;
  body?: Record<string, unknown>;
}

export interface DapResponse {
  success: boolean;
  message?: string;
  body?: Record<string, unknown>;
}

/** Reads framed messages out of a byte stream: whole ones only, however the bytes are split. */
export class DapReader {
  private buf: Buffer = Buffer.alloc(0);
  constructor(private readonly onMessage: (m: Record<string, unknown>) => void) {}

  push(chunk: Buffer): void {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      const end = this.buf.indexOf("\r\n\r\n");
      if (end < 0) return;
      const head = this.buf.subarray(0, end).toString("ascii");
      const m = /Content-Length:\s*(\d+)/i.exec(head);
      if (!m) {
        // Not a header we know: drop it, so one bad frame can't wedge the session.
        this.buf = this.buf.subarray(end + 4);
        continue;
      }
      const len = Number(m[1]);
      if (this.buf.length < end + 4 + len) return;
      const body = this.buf.subarray(end + 4, end + 4 + len).toString("utf8");
      this.buf = this.buf.subarray(end + 4 + len);
      try {
        this.onMessage(JSON.parse(body) as Record<string, unknown>);
      } catch {
        // A body that isn't JSON is skipped.
      }
    }
  }
}

/** One message as it goes on the wire. */
export function frame(m: Record<string, unknown>): Buffer {
  const body = Buffer.from(JSON.stringify(m), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

export class DapClient {
  private seq = 1;
  private readonly pending = new Map<number, { done: (r: DapResponse) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly listeners = new Set<(e: DapEvent) => void>();
  private closed = false;
  /** `read`, `out`: the adapter's connection both ways (a socket is both), or its stdout and stdin. */
  constructor(
    read: Readable,
    private readonly out: Writable,
    private readonly timeoutMs = 30_000,
  ) {
    const reader = new DapReader((m) => this.receive(m));
    read.on("data", (c: Buffer) => reader.push(c));
    read.on("close", () => this.dispose("The debugger closed the connection."));
    read.on("error", () => this.dispose("The connection to the debugger failed."));
  }

  /** Every event, until the returned function is called. */
  on(f: (e: DapEvent) => void): () => void {
    this.listeners.add(f);
    return () => void this.listeners.delete(f);
  }

  /** The next event of this name (resolves once). */
  once(event: string): Promise<DapEvent> {
    return new Promise((done) => {
      const off = this.on((e) => {
        if (e.event !== event) return;
        off();
        done(e);
      });
    });
  }

  request(command: string, args: Record<string, unknown> = {}, timeoutMs = this.timeoutMs): Promise<DapResponse> {
    if (this.closed) return Promise.resolve({ success: false, message: "The debugger has stopped." });
    const seq = this.seq++;
    return new Promise((done) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        done({ success: false, message: `The debugger didn't answer "${command}" in time.` });
      }, timeoutMs);
      this.pending.set(seq, { done, timer });
      this.out.write(frame({ seq, type: "request", command, arguments: args }));
    });
  }

  private receive(m: Record<string, unknown>) {
    if (m.type === "response") {
      const p = this.pending.get(m.request_seq as number);
      if (!p) return;
      this.pending.delete(m.request_seq as number);
      clearTimeout(p.timer);
      p.done({ success: !!m.success, ...(typeof m.message === "string" ? { message: m.message } : {}), ...(m.body ? { body: m.body as Record<string, unknown> } : {}) });
    } else if (m.type === "event") {
      for (const f of [...this.listeners]) f({ event: String(m.event), ...(m.body ? { body: m.body as Record<string, unknown> } : {}) });
    } else if (m.type === "request") {
      // Reverse requests (runInTerminal, startDebugging): WalkMyCode launches in the debugger's own console,
      // so it never needs them; say no, so the adapter falls back rather than waits.
      if (!this.closed) this.out.write(frame({ seq: this.seq++, type: "response", request_seq: m.seq, command: m.command, success: false, message: "Not supported by WalkMyCode." }));
    }
  }

  /** The connection is over: every waiting request is answered with `why`. */
  dispose(why = "The debugger has stopped."): void {
    if (this.closed) return;
    this.closed = true;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.done({ success: false, message: why });
    }
    this.pending.clear();
    for (const f of [...this.listeners]) f({ event: "__closed", body: { message: why } });
    this.listeners.clear();
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
