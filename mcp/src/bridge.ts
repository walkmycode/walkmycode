// The bridge between WalkMyCode's page and Claude (docs/MCP.md §2): requests the
// user makes on the page wait in a queue until Claude asks for the next one
// (next_request, a long poll), and commands Claude sends to the page are each
// acknowledged by it, or time out. One page at a time: the newest tab wins and
// the older one is told so. Nothing here knows about WebSockets or MCP; web.ts
// hands pages in as PageLinks and tools.ts calls next() and send().
import { answerRoute, loopLive, UNHEARD_AFTER_MS } from "../../src/lib/bridge/fallback";
import { BRIDGE_PROTOCOL, parsePageMessage, type BridgeRequest, type ClaudeStatus, type Command, type PageRequest, type ServerMessage, type WorkspaceInfo } from "../../src/lib/bridge/protocol";

/** One open page, as the bridge talks to it. */
export interface PageLink {
  send(message: ServerMessage): void;
  close(code?: number, reason?: string): void;
}

/** No page is connected to take a command. */
export class NoPageError extends Error {
  constructor() {
    super("The WalkMyCode page isn't open.");
    this.name = "NoPageError";
  }
}

/** The page did not acknowledge a command in time, or went away first. */
export class NoAckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoAckError";
  }
}

/** The page acknowledged a command but could not carry it out. */
export class PageRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageRefusedError";
  }
}

export interface BridgeOptions {
  /** How long the page has to acknowledge a command (default 5 s). */
  ackTimeoutMs?: number;
  /** Requests kept while Claude is not listening; the oldest goes first beyond this (default 50). */
  maxQueue?: number;
  now?: () => number;
  /** How long a page's request waits for a poll before it is answered another way (src/lib/bridge/fallback.ts); 0: never. */
  unheardAfterMs?: number;
}

/** Answers a request without the client's loop (MCP sampling): true when the answer was shown on the page. */
export type Sampler = (r: BridgeRequest) => Promise<boolean>;

interface Waiter {
  take(r: BridgeRequest | null): void;
}

interface Pending {
  link: PageLink;
  timer: ReturnType<typeof setTimeout>;
  resolve(note: string | undefined): void;
  reject(e: Error): void;
}

/** The close code an older tab gets when a newer one takes over. */
export const REPLACED_CODE = 4001;

export class Bridge {
  /** What `welcome` tells a page that connects: the open workspace, if any. */
  private workspace: WorkspaceInfo | null = null;
  private readonly ackTimeoutMs: number;
  private readonly maxQueue: number;
  private readonly now: () => number;
  private queue: BridgeRequest[] = [];
  private waiters: Waiter[] = [];
  private readonly working = new Map<string, BridgeRequest>();
  private page: PageLink | null = null;
  private readonly pending = new Map<string, Pending>();
  private requestSeq = 0;
  private commandSeq = 0;
  private lastPollAt: number | null = null;
  /** The last time a page connected, left, or said anything: how "away" the user is. */
  private pageSeenAt: number | null = null;
  /** The last time the user did something on the page (a request, or activity). */
  private activeAt: number | null = null;
  /** The connected AI app's friendly name, once the MCP handshake said it. */
  private client: string | null = null;
  /** Set when the client declared the MCP sampling capability: a request nobody polls for goes to its model directly. */
  private sampler: Sampler | null = null;
  /** No MCP client at all (terminal mode, mcp/src/cli.ts): the page answers every request itself, at once. */
  private standalone = false;
  private readonly unheardAfterMs: number;
  /** The checks waiting to see whether a request was taken in time. */
  private readonly watches = new Set<ReturnType<typeof setTimeout>>();
  /** Requests the page was already told nobody took, so it is told once. */
  private readonly told = new Set<string>();

  constructor(o: BridgeOptions = {}) {
    this.ackTimeoutMs = o.ackTimeoutMs ?? 5_000;
    this.maxQueue = o.maxQueue ?? 50;
    this.now = o.now ?? Date.now;
    this.unheardAfterMs = o.unheardAfterMs ?? UNHEARD_AFTER_MS;
  }

  // ── the page side ──

  /** A page connected. The newest page wins: an older one is told it was replaced and closed. */
  attach(link: PageLink): void {
    const old = this.page;
    this.page = link;
    this.pageSeenAt = this.activeAt = this.now();
    if (old && old !== link) {
      this.failPending(old, "The page was replaced by a newer tab before it confirmed.");
      try {
        old.send({ type: "replaced" });
        old.close(REPLACED_CODE, "WalkMyCode was opened in another tab");
      } catch {
        // already gone
      }
    }
    link.send({ type: "welcome", protocol: BRIDGE_PROTOCOL, workspace: this.workspace, claude: this.status() });
  }

  /** A page went away. Requests it made stay queued: they are still what the user asked. */
  detach(link: PageLink): void {
    this.failPending(link, "The page closed before it confirmed.");
    if (this.page !== link) return;
    this.page = null;
    this.pageSeenAt = this.now();
  }

  /** A message from a page (already JSON-parsed). A replaced page is no longer heard. */
  receive(link: PageLink, raw: unknown): void {
    if (link !== this.page) return;
    this.pageSeenAt = this.now();
    const parsed = parsePageMessage(raw);
    if (!parsed.ok) {
      const ref = (raw as { ref?: unknown } | null)?.ref;
      link.send(typeof ref === "string" ? { type: "rejected", ref: ref.slice(0, 200), error: parsed.error } : { type: "rejected", error: parsed.error });
      return;
    }
    const m = parsed.value;
    switch (m.type) {
      case "hello":
        if (m.protocol !== BRIDGE_PROTOCOL) link.send({ type: "rejected", error: `This server speaks bridge protocol ${BRIDGE_PROTOCOL}, the page ${m.protocol}: reload the page.` });
        return;
      case "activity":
        this.activeAt = this.now();
        return;
      case "request": {
        const r = this.enqueue(m.request);
        link.send(m.ref ? { type: "queued", id: r.id, ref: m.ref, position: this.queue.indexOf(r) + 1 } : { type: "queued", id: r.id, position: this.queue.indexOf(r) + 1 });
        this.dispatch();
        // With no client to wait for, the page hears at once that it answers this one itself.
        if (this.standalone) this.check(r.id);
        else this.watch(r.id);
        return;
      }
      case "ack": {
        const p = this.pending.get(m.id);
        if (!p || p.link !== link) return;
        clearTimeout(p.timer);
        this.pending.delete(m.id);
        if (m.ok) p.resolve(m.note);
        else p.reject(new PageRefusedError(m.error));
        return;
      }
      case "cancel": {
        const i = this.queue.findIndex((r) => r.id === m.id);
        if (i < 0) return;
        this.queue.splice(i, 1);
        link.send({ type: "dropped", id: m.id, reason: "Cancelled on the page." });
        this.sendStatus();
        return;
      }
    }
  }

  /** Put a request in the queue (the page's, or a test's). Delivery to a waiting Claude happens in dispatch(). */
  enqueue(request: PageRequest): BridgeRequest {
    const r = { ...request, id: `r${++this.requestSeq}`, at: new Date(this.now()).toISOString() } as BridgeRequest;
    this.queue.push(r);
    this.activeAt = this.now();
    while (this.queue.length > this.maxQueue) {
      const dropped = this.queue.shift()!;
      this.page?.send({ type: "dropped", id: dropped.id, reason: `More than ${this.maxQueue} requests were waiting for ${this.client ?? "your AI app"}; the oldest went first.` });
    }
    return r;
  }

  // ── the Claude side ──

  /**
   * The next request: at once if one is waiting, else as soon as the page sends one, or null
   * after `waitMs`. An aborted signal (the MCP call was cancelled) ends the wait with null and
   * takes nothing from the queue.
   */
  next(waitMs: number, signal?: AbortSignal): Promise<BridgeRequest | null> {
    this.lastPollAt = this.now();
    if (signal?.aborted) return Promise.resolve(null);
    return new Promise((resolve) => {
      let done = false;
      const finish = (r: BridgeRequest | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) this.waiters.splice(i, 1);
        this.lastPollAt = this.now();
        resolve(r);
        this.sendStatus();
      };
      const waiter: Waiter = { take: finish };
      const onAbort = () => finish(null);
      const timer = setTimeout(() => finish(null), Math.max(0, waitMs));
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(waiter);
      this.dispatch();
    });
  }

  /** A request handed to a call that was cancelled before Claude saw it: back to the front of the queue. */
  requeue(r: BridgeRequest): void {
    if (!this.working.delete(r.id) || this.queue.some((q) => q.id === r.id)) return;
    this.queue.unshift(r);
    this.page?.send({ type: "queued", id: r.id, position: 1 });
    this.dispatch();
  }

  /** Claude answered a request (or gave up on it). True when it was one Claude had taken. */
  markAnswered(id: string): boolean {
    const known = this.working.delete(id);
    if (known) this.sendStatus();
    return known;
  }

  /** Whether `id` is a request Claude took and has not answered yet. */
  isWorking(id: string): boolean {
    return this.working.has(id);
  }

  /** Send a command to the page; resolves with the page's note once it acknowledges. */
  send(command: Command): Promise<string | undefined> {
    const link = this.page;
    if (!link) return Promise.reject(new NoPageError());
    const id = `c${++this.commandSeq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new NoAckError(`The page didn't confirm within ${Math.round(this.ackTimeoutMs / 100) / 10} s.`));
      }, this.ackTimeoutMs);
      this.pending.set(id, { link, timer, resolve, reject });
      try {
        link.send({ type: "command", id, command });
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new NoPageError());
      }
    });
  }

  hasPage(): boolean {
    return this.page !== null;
  }

  status(): ClaudeStatus {
    const s: ClaudeStatus = { listening: this.waiters.length > 0, lastPollAt: this.lastPollAt === null ? null : new Date(this.lastPollAt).toISOString(), queued: this.queue.length, working: [...this.working.keys()] };
    if (this.standalone) return { ...s, standalone: true };
    return this.client ? { ...s, client: this.client } : s;
  }

  /** The connected AI app's friendly name (from the MCP handshake): the page names it in what it says. */
  setClient(name: string): void {
    if (name === this.client) return;
    this.client = name;
    this.sendStatus();
  }

  /** No MCP client will ever connect (terminal mode): requests are handed back to the page at once, and the page says it answers here. */
  setStandalone(on: boolean): void {
    if (on === this.standalone) return;
    this.standalone = on;
    this.sendStatus();
  }

  isStandalone(): boolean {
    return this.standalone;
  }

  clientName(): string | null {
    return this.client;
  }

  /** When a page was last connected or heard from (null: never), and when the user last did something there. */
  presence(): { connected: boolean; seenAt: number | null; activeAt: number | null } {
    return { connected: this.page !== null, seenAt: this.pageSeenAt, activeAt: this.activeAt };
  }

  /** The workspace a page that connects from now on is welcomed with (an open page gets a `workspace` command instead). */
  setWorkspace(info: WorkspaceInfo | null): void {
    this.workspace = info;
  }

  /** Close everything: waiting calls get null, unconfirmed commands fail, the page is closed. */
  close(): void {
    for (const t of this.watches) clearTimeout(t);
    this.watches.clear();
    for (const w of [...this.waiters]) w.take(null);
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new NoPageError());
      this.pending.delete(id);
    }
    const link = this.page;
    this.page = null;
    try {
      link?.close(1001, "WalkMyCode stopped");
    } catch {
      // already gone
    }
  }

  /** The client can be asked directly (MCP sampling), or no longer (null). */
  setSampler(s: Sampler | null): void {
    this.sampler = s;
  }

  // ── when nobody polls (src/lib/bridge/fallback.ts) ──

  /** Look again in a moment: a request still queued with no live loop is answered another way. */
  private watch(id: string): void {
    if (this.unheardAfterMs <= 0) return;
    const t = setTimeout(() => {
      this.watches.delete(t);
      this.check(id);
    }, this.unheardAfterMs);
    (t as { unref?: () => void }).unref?.();
    this.watches.add(t);
  }

  private check(id: string): void {
    const r = this.queue.find((q) => q.id === id);
    if (!r || this.told.has(id)) return;
    const live = loopLive({ listening: this.waiters.length > 0, lastPollAt: this.lastPollAt, working: this.working.size, now: this.now() });
    const route = answerRoute({ live, sampling: this.sampler !== null, pageKey: false, standalone: this.standalone });
    if (route === "queue") return this.watch(id);
    if (route === "sampling") return void this.sample(r);
    this.unheard(r);
  }

  /** The page is told nobody took the request: it stays queued, for the client if it comes back (with no client at all, it goes). */
  private unheard(r: BridgeRequest): void {
    if (this.standalone) {
      const i = this.queue.indexOf(r);
      if (i >= 0) this.queue.splice(i, 1);
      this.sendStatus();
    }
    this.told.add(r.id);
    if (this.told.size > 500) this.told.delete(this.told.values().next().value!);
    try {
      this.page?.send({ type: "unheard", id: r.id });
    } catch {
      // the page is going
    }
  }

  /** Ask the client's model directly. On failure the request goes back to the queue and the page is told. */
  private async sample(r: BridgeRequest): Promise<void> {
    const sampler = this.sampler;
    const i = this.queue.indexOf(r);
    if (!sampler || i < 0) return;
    this.queue.splice(i, 1);
    this.working.set(r.id, r);
    this.page?.send({ type: "taken", id: r.id });
    this.sendStatus();
    let ok = false;
    try {
      ok = await sampler(r);
    } catch {
      ok = false;
    }
    if (ok) return;
    if (this.working.delete(r.id) && !this.queue.some((q) => q.id === r.id)) this.queue.unshift(r);
    this.unheard(r);
    this.sendStatus();
  }

  // ── inside ──

  /** Hand queued requests to waiting calls, oldest to oldest. */
  private dispatch(): void {
    while (this.queue.length && this.waiters.length) {
      const w = this.waiters.shift()!;
      const r = this.queue.shift()!;
      this.working.set(r.id, r);
      this.page?.send({ type: "taken", id: r.id });
      w.take(r);
    }
    this.sendStatus();
  }

  private sendStatus(): void {
    try {
      this.page?.send({ type: "status", claude: this.status() });
    } catch {
      // the page is going; detach() will follow
    }
  }

  private failPending(link: PageLink, message: string): void {
    for (const [id, p] of this.pending) {
      if (p.link !== link) continue;
      clearTimeout(p.timer);
      this.pending.delete(id);
      p.reject(new NoAckError(message));
    }
  }
}
