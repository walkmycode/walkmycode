// The page's end of the bridge (WalkMyCode for Claude, docs/MCP.md §2–§3): one
// WebSocket to the local server, which carries the user's requests to Claude
// and Claude's commands to the page. This is the browser half of protocol.ts:
//  - request() sends what the user did (Explain, Trace it, Tour, a typed or
//    spoken question) and follows it: sent → queued (the server's id) → taken
//    by Claude → answered (the `answer` command naming it), or dropped.
//  - every command is acknowledged: by the handler the page registered for it
//    (its note, or its error), and refused with a reason when nothing on the
//    page can do it yet. `answer` also settles the request it names.
//  - status (is Claude listening?), the open workspace, and whether another tab
//    took over are kept in a snapshot that React reads.
// No DOM or React here, so tests drive it with a fake socket.
import { capName, FALLBACK_CLIENT, STANDALONE_NAME } from "./clientName";
import { BRIDGE_PATH, BRIDGE_PROTOCOL, type ClaudeStatus, type Command, type CommandName, type PageMessage, type PageRequest, type RequestKind, type ServerMessage, type WorkspaceInfo } from "./protocol";

/** The part of a WebSocket the client uses (the browser's, or a test's fake). */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "close" | "error" | "message", listener: (ev: { data?: unknown; code?: number }) => void): void;
}

/** WebSocket.OPEN */
const OPEN = 1;
/** The close code an older tab gets when a newer one takes over (mcp/src/bridge.ts). */
export const REPLACED_CODE = 4001;

export type Conn =
  /** Connecting, or reconnecting after the server went away. */
  | "connecting"
  | "open"
  /** WalkMyCode was opened in another tab, which now gets everything. */
  | "replaced"
  /** The server speaks another version of the protocol: reload. */
  | "outdated";

export type AnswerCommand = Extract<Command, { name: "answer" }>;
export type NarrateCommand = Extract<Command, { name: "narrate" }>;

/** A request on its way: sent, queued at the server, or taken by Claude. */
export interface Pending {
  ref: string;
  kind: RequestKind;
  /** The server's id, once it has queued the request. */
  id: string | null;
  state: "sending" | "queued" | "taken";
  /** Place in the queue when it was queued (1 = next). */
  position: number | null;
  at: number;
}

export interface BridgeSnapshot {
  conn: Conn;
  /** Whether Claude is listening, as the server last said; null before the first word from it. */
  claude: ClaudeStatus | null;
  workspace: WorkspaceInfo | null;
  pending: Pending[];
  /** The last thing the server refused, in its words. */
  error: string | null;
  /** Since when (the client's clock) the page has been trying to reach the server: null while connected. */
  downSince?: number | null;
}

/** One request, followed. */
export interface Ask {
  ref: string;
  /** The server's id for it, once queued. */
  id: Promise<string>;
  /** The server's id now: null until it is queued. */
  idNow(): string | null;
  /** Claude's answer to it. Rejects when it is dropped, refused or cancelled. */
  answer: Promise<AnswerCommand>;
  /** Take it back (the server drops it if Claude has not taken it yet) and stop waiting. */
  cancel(): void;
  /** Take it back from the server's queue even after it ended here (the page answered it another way). */
  withdraw(): void;
}

/** Why a request ended without an answer. */
export class AskEnded extends Error {
  constructor(
    message: string,
    /** "unheard": nobody took it in time (src/lib/bridge/fallback.ts); it stays queued at the server until withdrawn. */
    readonly reason: "cancelled" | "dropped" | "rejected" | "unheard",
  ) {
    super(message);
    this.name = "AskEnded";
  }
}

type Handler<N extends CommandName> = (command: Extract<Command, { name: N }>) => string | void | Promise<string | void>;

export interface ClientOptions {
  /** Open the socket (the browser: new WebSocket(ws://host/bridge)). */
  open: () => SocketLike;
  now?: () => number;
  /** Reconnect after the server goes away (default true). */
  reconnect?: boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  /** At most one `activity` per this many ms (default 20 s). */
  activityEveryMs?: number;
}

interface Waiting {
  pending: Pending;
  resolveId(id: string): void;
  resolve(a: AnswerCommand): void;
  reject(e: Error): void;
}

/** Why the page cannot do a command no handler is registered for. */
export const NOT_READY = "The WalkMyCode page can't do that right now: the map isn't open on it yet.";

export class BridgeClient {
  private socket: SocketLike | null = null;
  private snap: BridgeSnapshot = { conn: "connecting", claude: null, workspace: null, pending: [], error: null, downSince: null };
  private readonly listeners = new Set<() => void>();
  private readonly answerListeners = new Set<(a: AnswerCommand, claimed: boolean) => void>();
  private readonly commandListeners = new Set<(c: Command) => void>();
  private readonly handlers = new Map<CommandName, Handler<CommandName>>();
  private readonly waiting = new Map<string, Waiting>();
  private readonly outbox: PageMessage[] = [];
  /** Answers no request on this page was waiting for (a question asked in Claude's chat, an answer after a reload). */
  readonly unclaimed: AnswerCommand[] = [];
  private refs = 0;
  private retries = 0;
  private lastActivity = -Infinity;
  private started = false;
  private readonly now: () => number;

  constructor(private readonly o: ClientOptions) {
    this.now = o.now ?? Date.now;
  }

  // ── what React reads ──

  snapshot = (): BridgeSnapshot => this.snap;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  private set(patch: Partial<BridgeSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const l of [...this.listeners]) l();
  }

  private syncPending(): void {
    this.set({ pending: [...this.waiting.values()].map((w) => ({ ...w.pending })) });
  }

  // ── the connection ──

  /** Connect (once; later calls do nothing). */
  start(): this {
    if (this.started) return this;
    this.started = true;
    this.connect();
    return this;
  }

  private connect(): void {
    let s: SocketLike;
    try {
      s = this.o.open();
    } catch {
      this.retry();
      return;
    }
    this.socket = s;
    s.addEventListener("open", () => {
      if (this.socket !== s) return;
      this.retries = 0;
      this.raw({ type: "hello", protocol: BRIDGE_PROTOCOL });
      this.set({ conn: "open", error: null, downSince: null });
      for (const m of this.outbox.splice(0)) this.raw(m);
    });
    s.addEventListener("message", (ev) => {
      if (this.socket !== s) return;
      let m: ServerMessage;
      try {
        m = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      this.receive(m);
    });
    s.addEventListener("close", (ev) => {
      if (this.socket !== s) return;
      this.socket = null;
      if (ev.code === REPLACED_CODE || this.snap.conn === "replaced") return this.set({ conn: "replaced" });
      if (this.snap.conn === "outdated") return;
      this.set({ conn: "connecting", downSince: this.snap.downSince ?? this.now() });
      this.retry();
    });
    s.addEventListener("error", () => {
      // A close follows.
    });
  }

  private retry(): void {
    if (this.o.reconnect === false) return;
    const ms = Math.min(10_000, 500 * 2 ** this.retries++);
    (this.o.setTimer ?? setTimeout)(() => this.connect(), ms);
  }

  /** Stop: no reconnect, nothing more sent. */
  close(): void {
    this.started = false;
    const s = this.socket;
    this.socket = null;
    try {
      s?.close(1000, "page closed");
    } catch {
      // already gone
    }
  }

  private raw(m: PageMessage): void {
    try {
      this.socket?.send(JSON.stringify(m));
    } catch {
      // the close event follows
    }
  }

  /** Send now when connected, else as soon as the connection opens. */
  private send(m: PageMessage): void {
    if (this.socket && this.socket.readyState === OPEN && this.snap.conn === "open") this.raw(m);
    else this.outbox.push(m);
  }

  // ── from the server ──

  /** One message from the server (public for tests). */
  receive(m: ServerMessage): void {
    switch (m.type) {
      case "welcome":
        if (m.protocol !== BRIDGE_PROTOCOL) {
          this.set({ conn: "outdated", error: `This page speaks bridge protocol ${BRIDGE_PROTOCOL} and WalkMyCode ${m.protocol}: reload the page.` });
          this.close();
          return;
        }
        this.set({ claude: m.claude, workspace: m.workspace });
        return;
      case "status":
        this.set({ claude: m.claude });
        return;
      case "replaced":
        this.set({ conn: "replaced" });
        return;
      case "rejected": {
        const w = m.ref ? this.byRef(m.ref) : undefined;
        if (w) this.end(w, new AskEnded(m.error, "rejected"));
        this.set({ error: m.error });
        return;
      }
      case "queued": {
        const w = (m.ref ? this.byRef(m.ref) : undefined) ?? this.waiting.get(m.id);
        if (!w) return;
        if (w.pending.id !== m.id) {
          this.waiting.delete(w.pending.ref);
          w.pending.id = m.id;
          this.waiting.set(m.id, w);
          w.resolveId(m.id);
        }
        w.pending.state = "queued";
        w.pending.position = m.position;
        this.syncPending();
        return;
      }
      case "taken": {
        const w = this.waiting.get(m.id);
        if (!w) return;
        w.pending.state = "taken";
        w.pending.position = null;
        this.syncPending();
        return;
      }
      case "dropped": {
        const w = this.waiting.get(m.id);
        if (w) this.end(w, new AskEnded(m.reason, "dropped"));
        return;
      }
      case "unheard": {
        // Nobody took it in time: whoever asked answers another way, or says so (src/lib/adapters/bridgeAi.ts).
        const w = this.waiting.get(m.id);
        if (w) this.end(w, new AskEnded(isStandalone(this.snap) ? "No AI app is connected: this page answers itself." : `${capName(aiName(this.snap))} isn't listening.`, "unheard"));
        return;
      }
      case "command":
        void this.run(m.id, m.command);
        return;
    }
  }

  private byRef(ref: string): Waiting | undefined {
    const w = this.waiting.get(ref);
    return w && w.pending.id === null ? w : undefined;
  }

  private end(w: Waiting, e: Error): void {
    this.waiting.delete(w.pending.id ?? w.pending.ref);
    w.reject(e);
    this.syncPending();
  }

  /** Carry out a command and acknowledge it: the handler's note, its error, or why nothing could. */
  private async run(id: string, command: Command): Promise<void> {
    if (command.name === "workspace") this.set({ workspace: command.workspace });
    for (const l of [...this.commandListeners]) {
      try {
        l(command);
      } catch {
        // A listener's failure is not the command's.
      }
    }
    let claimed = false;
    if (command.name === "answer") {
      const w = command.requestId ? this.waiting.get(command.requestId) : undefined;
      if (w) {
        claimed = true;
        this.waiting.delete(command.requestId!);
        w.resolve(command);
        this.syncPending();
      } else {
        this.unclaimed.push(command);
        if (this.unclaimed.length > 5) this.unclaimed.shift();
      }
      for (const l of [...this.answerListeners]) l(command, claimed);
    }
    const handler = this.handlers.get(command.name);
    if (!handler) {
      // An answer is shown by whoever asked, or by the guide when it opens; a new workspace is in the snapshot.
      if (command.name === "answer" || command.name === "workspace") return this.raw({ type: "ack", id, ok: true, ...(claimed ? {} : { note: "Kept for the Guide panel." }) });
      return this.raw({ type: "ack", id, ok: false, error: NOT_READY });
    }
    try {
      const note = await handler(command);
      this.raw(note ? { type: "ack", id, ok: true, note: String(note) } : { type: "ack", id, ok: true });
    } catch (e) {
      this.raw({ type: "ack", id, ok: false, error: (e instanceof Error ? e.message : String(e)) || "The page could not do it." });
    }
  }

  // ── what the page does ──

  /** Send a request to Claude and follow it to its answer. */
  request(request: PageRequest): Ask {
    const ref = `p${++this.refs}`;
    const pending: Pending = { ref, kind: request.kind, id: null, state: "sending", position: null, at: this.now() };
    let resolveId!: (id: string) => void;
    let resolve!: (a: AnswerCommand) => void;
    let reject!: (e: Error) => void;
    const id = new Promise<string>((ok) => (resolveId = ok));
    const answer = new Promise<AnswerCommand>((ok, fail) => {
      resolve = ok;
      reject = fail;
    });
    // Nobody may be listening to `answer` when it fails (a cancelled request): no unhandled rejection.
    answer.catch(() => {});
    const w: Waiting = { pending, resolveId, resolve, reject };
    this.waiting.set(ref, w);
    this.syncPending();
    this.send({ type: "request", request, ref });
    return {
      ref,
      id,
      idNow: () => pending.id,
      answer,
      cancel: () => {
        const key = pending.id ?? ref;
        if (this.waiting.get(key) !== w) return;
        if (pending.id) this.send({ type: "cancel", id: pending.id });
        this.end(w, new AskEnded("Cancelled on the page.", "cancelled"));
      },
      withdraw: () => {
        if (pending.id) this.send({ type: "cancel", id: pending.id });
      },
    };
  }

  /** The page carries out commands named `name` (one handler per name; the newest wins). Returns its removal. */
  handle<N extends CommandName>(name: N, fn: Handler<N>): () => void {
    const h = fn as unknown as Handler<CommandName>;
    this.handlers.set(name, h);
    return () => {
      if (this.handlers.get(name) === h) this.handlers.delete(name);
    };
  }

  /** Every command that arrives, before its handler runs (the guide shows narration as it comes). */
  onCommand(l: (c: Command) => void): () => void {
    this.commandListeners.add(l);
    return () => {
      this.commandListeners.delete(l);
    };
  }

  /** Every answer that arrives, and whether a request on this page was waiting for it. */
  onAnswer(l: (a: AnswerCommand, claimed: boolean) => void): () => void {
    this.answerListeners.add(l);
    return () => {
      this.answerListeners.delete(l);
    };
  }

  /** The user is still using the page: keeps Claude listening (at most one message per interval). */
  activity(): void {
    const t = this.now();
    if (t - this.lastActivity < (this.o.activityEveryMs ?? 20_000)) return;
    this.lastActivity = t;
    if (this.snap.conn === "open") this.raw({ type: "activity" });
  }
}

/** The page's own provider, for the line in terminal mode: its name, and whether it can answer (null: not known yet). */
export interface OwnModel {
  provider: string | null;
  ready: boolean | null;
}

/** What the page says about Claude right now, in plain words: null when there is nothing to say.
 * With no client at all (terminal mode) it says the page answers here, with `own`'s provider when known. */
export function claudeLine(s: BridgeSnapshot, now: number, own?: OwnModel): { text: string; tone: "ok" | "busy" | "bad" } | null {
  if (s.conn === "replaced") return { text: "WalkMyCode was opened in another tab; this one is no longer connected.", tone: "bad" };
  if (s.conn === "outdated") return { text: "This page is out of date: reload it.", tone: "bad" };
  if (s.conn === "connecting") return serverDown(s, now) ? { text: downText(s), tone: "bad" } : { text: "Connecting to WalkMyCode…", tone: "busy" };
  const c = s.claude;
  if (c?.standalone) {
    if (own?.ready === false) return { text: "Add an AI key in Settings → AI model to ask questions here", tone: "bad" };
    const withWhat = own?.provider ? ` with ${own.provider}` : "";
    return s.pending.length ? { text: `Answering here${withWhat}…`, tone: "busy" } : { text: `Answering here${withWhat}`, tone: "ok" };
  }
  const who = aiName(s);
  const Who = capName(who);
  const waiting = s.pending.filter((p) => p.state !== "taken");
  const working = s.pending.some((p) => p.state === "taken") || (c?.working.length ?? 0) > 0;
  // A request nobody takes within a few seconds is answered another way (src/lib/bridge/fallback.ts): only "waiting" until then.
  if (waiting.length && !c?.listening) return { text: `Waiting for ${who}…`, tone: "busy" };
  if (working) return { text: `${Who} is working on it…`, tone: "busy" };
  if (waiting.length) return { text: `Sent to ${who}…`, tone: "busy" };
  if (c?.listening) return { text: `${Who} is listening`, tone: "ok" };
  // Between two polls the client is not "listening" for a moment: only a long silence is worth a word.
  const last = c?.lastPollAt ? Date.parse(c.lastPollAt) : NaN;
  if (Number.isFinite(last) && now - last < 75_000) return { text: `${Who} is listening`, tone: "ok" };
  return { text: `${Who} isn't listening: ask it to continue when you want it back.`, tone: "bad" };
}

/** How long the page tries to reach the server before saying it isn't running. */
export const DOWN_AFTER_MS = 8_000;

/** The server has been out of reach for a while: it has stopped (its Claude session ended, or its terminal closed). */
export function serverDown(s: Pick<BridgeSnapshot, "conn" | "downSince">, now: number): boolean {
  return s.conn === "connecting" && s.downSince != null && now - s.downSince >= DOWN_AFTER_MS;
}

function downText(s: Pick<BridgeSnapshot, "claude">): string {
  return s.claude?.standalone
    ? "WalkMyCode's server isn't running: start it again in the terminal, then reload this page."
    : `WalkMyCode's server isn't running: it stops when the ${capName(aiName(s))} session that opened this page ends. Ask it to open WalkMyCode again.`;
}

/** What is worth a strip under the top bar, not just the pill: the AI app stopped listening (with the word
 * that brings it back), or the server is gone. null otherwise, and before the AI app has said anything. */
export function claudeAlert(s: BridgeSnapshot, now: number): { kind: "unheard" | "down"; text: string; say?: string } | null {
  if (serverDown(s, now)) return { kind: "down", text: downText(s) };
  const c = s.claude;
  if (s.conn !== "open" || !c || c.standalone || c.listening) return null;
  const last = c.lastPollAt ? Date.parse(c.lastPollAt) : NaN;
  if (Number.isFinite(last) && now - last < 75_000) return null;
  const Who = capName(aiName(s));
  return { kind: "unheard", text: `${Who} stopped listening, so questions here wait. In your ${Who} chat, type continue and it picks them up.`, say: "continue" };
}

/** The connected AI app's friendly name ("Claude", "Antigravity"…), or "your AI app" before it has said;
 * "your AI model" when no client is connected at all (terminal mode: the page's own provider answers). */
export function aiName(s: Pick<BridgeSnapshot, "claude">): string {
  if (s.claude?.standalone) return STANDALONE_NAME;
  return s.claude?.client || FALLBACK_CLIENT;
}

/** No MCP client is connected at all (terminal mode): the page answers every request itself. */
export function isStandalone(s: Pick<BridgeSnapshot, "claude">): boolean {
  return s.claude?.standalone === true;
}

/** The bridge's address for a page served at `location`. */
export function bridgeUrl(loc: { protocol: string; host: string }): string {
  return `${loc.protocol === "https:" ? "wss:" : "ws:"}//${loc.host}${BRIDGE_PATH}`;
}
