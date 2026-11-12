"use client";
// The page's side of "Run on: This computer" and the terminal: the status
// (GET /api/localrun), the user's consent (POST), and one WebSocket to the
// server that carries runs and terminals. Never in WalkMyCode Lite (no server
// of its own: it keeps MicroPython and sql.js). In the full app the socket is
// on its own loopback port with this launch's token; in WalkMyCode for Claude
// it is the page server's own path, behind the page's cookie.
import { TARGET } from "@/lib/adapters/target";
import { LOCALRUN_ROUTE, type ClientMsg, type LocalRunStatus, type GitAsk, type NewProjectAsk, type ServerMsg, type SetupService } from "@/lib/localrun/protocol";
import type { OutPart } from "../python";
import { UNREACHABLE } from "@/lib/unreachable";

/** This build can have a server that runs code (the full app, WalkMyCode for Claude). */
export const LOCAL_BUILD = TARGET !== "lite";

// ── the status ──


type Snap = { status: LocalRunStatus | null; error: string };
let snap: Snap = { status: null, error: "" };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
let asking: Promise<LocalRunStatus | null> | null = null;

export const localStatus = {
  subscribe(f: () => void) {
    subs.add(f);
    return () => void subs.delete(f);
  },
  get: () => snap,
};

function set(next: Partial<Snap>) {
  snap = { ...snap, ...next };
  emit();
}

async function call(init?: RequestInit, detect = false): Promise<LocalRunStatus | null> {
  try {
    const r = await fetch(`${LOCALRUN_ROUTE}${detect ? "?detect=1" : ""}`, { cache: "no-store", ...init });
    const body = (await r.json().catch(() => null)) as (LocalRunStatus & { error?: unknown }) | null;
    if (!r.ok || !body || typeof body.available !== "boolean") {
      const e = body?.error;
      const msg = typeof e === "string" ? e : e && typeof e === "object" && "title" in e ? String((e as { title: unknown }).title) : `The server answered ${r.status}.`;
      set({ error: msg });
      return null;
    }
    set({ status: body, error: "" });
    return body;
  } catch {
    set({ error: UNREACHABLE });
    return null;
  }
}

/** The status, asked once (again with `fresh`, or `detect` to look for the toolchains again). */
export function loadLocalStatus(o: { fresh?: boolean; detect?: boolean } = {}): Promise<LocalRunStatus | null> {
  if (!LOCAL_BUILD) return Promise.resolve(null);
  if (!asking || o.fresh || o.detect) asking = call(undefined, o.detect);
  return asking;
}

/** Allow or revoke; the answer is the new status. Revoking closes the socket (the server kills what it started). */
export async function setAllowed(allowed: boolean): Promise<LocalRunStatus | null> {
  const s = await call({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ allowed }) });
  asking = Promise.resolve(s);
  if (!allowed) dropSocket();
  return s;
}

export async function setTimeoutS(timeout_s: number): Promise<LocalRunStatus | null> {
  const s = await call({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ timeout_s }) });
  asking = Promise.resolve(s);
  return s;
}

// ── the socket ──

let ws: WebSocket | null = null;
let opening: Promise<WebSocket> | null = null;
const listeners = new Map<string, (m: ServerMsg) => void>();
let termMode: "pty" | "line" | null = null;

function dropSocket() {
  const w = ws;
  ws = null;
  opening = null;
  w?.close();
}

function socketUrl(s: LocalRunStatus): string | null {
  if (!s.socket) return null;
  const base = s.socket.url.startsWith("/") ? `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${s.socket.url}` : s.socket.url;
  return s.socket.token ? `${base}?t=${encodeURIComponent(s.socket.token)}` : base;
}

/** The socket, opened on first use (and again after it closed). */
export function connect(): Promise<WebSocket> {
  if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve(ws);
  opening ??= (async () => {
    const s = await loadLocalStatus({ fresh: true });
    const url = s && socketUrl(s);
    if (!s?.allowed || !url) throw new Error(s?.reason ?? "Running code on this computer is not allowed yet.");
    return new Promise<WebSocket>((ok, fail) => {
      const w = new WebSocket(url);
      w.onopen = () => {
        ws = w;
        ok(w);
      };
      w.onerror = () => fail(new Error("Could not connect to WalkMyCode's server to run code."));
      w.onmessage = (e) => {
        let m: ServerMsg;
        try {
          m = JSON.parse(String(e.data)) as ServerMsg;
        } catch {
          return;
        }
        if (m.type === "hello") termMode = m.terminal;
        if ("id" in m && m.id) listeners.get(m.id)?.(m);
        else if (m.type === "error") for (const l of listeners.values()) l(m);
      };
      w.onclose = (e) => {
        if (ws === w) ws = null;
        opening = null;
        // Everything still open on it is over: the server killed it.
        // 4403 carries the server's reason: turned off in Settings, or the MCP server stopping (its Claude
        // session ended). A plain close on the Claude page is the same stop, said the same way.
        const stopped = e.code === 4403 ? /stopped/i.test(e.reason) : TARGET === "mcp";
        const why = stopped ? UNREACHABLE : e.code === 4403 ? e.reason || "Running code on this computer was turned off." : "The connection to WalkMyCode's server closed.";
        for (const [id, l] of [...listeners]) l({ type: "error", id, message: why });
        listeners.clear();
        fail(new Error(why));
      };
    });
  })();
  const p = opening;
  p.catch(() => {
    if (opening === p) opening = null;
  });
  return p;
}

function send(m: ClientMsg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
}

let seq = 0;
const newId = (what: string) => `${what}-${Date.now().toString(36)}-${(++seq).toString(36)}`;

// ── runs ──

export interface RunListener {
  onPart(p: OutPart): void;
  onStatus(s: string): void;
  done(): void;
}

/** Run code on this computer; the output streams into the listener. Returns the run's id (for stop). */
export function runLocal(o: { lang: string; code: string; path?: string | null; timeout_s?: number; test?: boolean }, l: RunListener): string {
  const id = newId("run");
  let ended = false;
  // Printed text comes in many small pieces: handed on at most every 40 ms, so a chatty program cannot swamp the page.
  let pending: { kind: "out" | "err"; text: string }[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    for (const p of pending) l.onPart(p);
    pending = [];
  };
  const queue = (kind: "out" | "err", text: string) => {
    const last = pending.at(-1);
    if (last && last.kind === kind) last.text += text;
    else pending.push({ kind, text });
    timer ??= setTimeout(flush, 40);
  };
  const end = () => {
    if (ended) return;
    ended = true;
    if (timer) clearTimeout(timer);
    flush();
    listeners.delete(id);
    l.onStatus("");
    l.done();
  };
  listeners.set(id, (m) => {
    if (m.type === "run-start") {
      l.onStatus("");
      l.onPart({ kind: "meta", text: `$ ${m.shown}\n${m.version ? `${m.version} · ` : ""}in ${m.cwd}${m.temp ? " (a copy of the code in a temp folder)" : ""}\n` });
    } else if (m.type === "run-out") queue(m.stream, m.text);
    else if (m.type === "run-exit") {
      flush();
      const secs = `${(m.ms / 1000).toFixed(m.ms < 10_000 ? 1 : 0)} s`;
      const what = m.timedOut ? `Stopped after the time limit (${secs}). Change it in Settings → This computer.` : m.stopped ? `Stopped after ${secs}.` : m.code === 0 ? `Finished in ${secs}.` : `Exited with code ${m.code ?? m.signal ?? "?"} after ${secs}.`;
      l.onPart({ kind: "meta", text: `\n${what}\n` });
      end();
    } else if (m.type === "run-fail" || m.type === "error") {
      flush();
      l.onPart({ kind: "error", text: m.message });
      end();
    }
  });
  l.onStatus("Starting on this computer…");
  connect().then(
    () => send({ type: "run", id, lang: o.lang, code: o.code, path: o.path ?? null, ...(o.timeout_s ? { timeout_s: o.timeout_s } : {}), ...(o.test ? { test: true } : {}) }),
    (e: Error) => {
      l.onPart({ kind: "error", text: e.message });
      end();
    },
  );
  return id;
}

export function stopLocal(id: string | null) {
  if (id) send({ type: "stop", id });
}

// ── set up this project (src/lib/localrun/setup.ts plans it, ./setup/ shows it) ──

/** What each service needs; `located` false when the full app doesn't know where the workspace is yet. */
export async function setupScan(workspace?: string): Promise<{ services: SetupService[]; located: boolean }> {
  await connect();
  const id = newId("scan");
  return new Promise((done, fail) => {
    listeners.set(id, (m) => {
      listeners.delete(id);
      if (m.type === "setup-plan") done({ services: m.services, located: m.located });
      else fail(new Error("message" in m ? m.message : "The project could not be checked."));
    });
    send({ type: "setup-scan", id, ...(workspace ? { workspace } : {}) });
  });
}

/** The full app: where the workspace is on this computer. */
export async function setupRoot(workspace: string, path: string): Promise<{ ok: boolean; message?: string }> {
  await connect();
  const id = newId("root");
  return new Promise((done) => {
    listeners.set(id, (m) => {
      listeners.delete(id);
      done(m.type === "setup-root-saved" ? { ok: m.ok, ...(m.message ? { message: m.message } : {}) } : { ok: false, message: "message" in m ? m.message : "That folder could not be saved." });
    });
    send({ type: "setup-root", id, workspace, path });
  });
}

// ── source control (src/lib/localrun/git.ts does it, ./git/ shows it) ──

export type GitAnswer = Extract<ServerMsg, { type: "git-result" }>;

/** One git op on the workspace's repo; the answer carries the status after it. */
export async function gitOp(o: GitAsk): Promise<GitAnswer> {
  await connect();
  const id = newId("git");
  return new Promise((done, fail) => {
    listeners.set(id, (m) => {
      listeners.delete(id);
      if (m.type === "git-result") done(m);
      else fail(new Error("message" in m ? m.message : "Git didn't answer."));
    });
    send({ type: "git", id, ...o });
  });
}

export interface StepListener {
  /** The folder the step runs in. */
  start?(cwd: string): void;
  out(stream: "out" | "err", text: string): void;
  exit(info: { code: number | null; timedOut: boolean; stopped: boolean; ms: number }): void;
  fail(message: string): void;
}

export type NewPlanAnswer = Extract<ServerMsg, { type: "new-plan" }>;

/** "New project": the next round (tools, then the step that makes it), the starters, and the default folder. */
export async function newPlan(create: NewProjectAsk): Promise<NewPlanAnswer> {
  await connect();
  const id = newId("new");
  return new Promise((done, fail) => {
    listeners.set(id, (m) => {
      listeners.delete(id);
      if (m.type === "new-plan") done(m);
      else fail(new Error("message" in m ? m.message : "The new project couldn't be planned."));
    });
    send({ type: "new-plan", id, create });
  });
}

/** Open the project the server just made: WalkMyCode for Claude maps it; the full app indexes it and names the workspace. */
export async function newOpen(root: string, name: string): Promise<{ ok: boolean; workspace?: string; message?: string }> {
  await connect();
  const id = newId("open");
  return new Promise((done) => {
    listeners.set(id, (m) => {
      listeners.delete(id);
      done(m.type === "new-opened" ? { ok: m.ok, ...(m.workspace ? { workspace: m.workspace } : {}), ...(m.message ? { message: m.message } : {}) } : { ok: false, message: "message" in m ? m.message : "It couldn't be opened." });
    });
    send({ type: "new-open", id, root, name });
  });
}

/** Run one planned step (named, never a command); returns its id, for stopLocal. `create`: a "New project" step. */
export function setupRun(service: string, step: string, workspace: string | undefined, l: StepListener, create?: NewProjectAsk): string {
  const id = newId("setup");
  listeners.set(id, (m) => {
    if (m.type === "run-start") l.start?.(m.cwd);
    else if (m.type === "run-out") l.out(m.stream, m.text);
    else if (m.type === "run-exit") {
      listeners.delete(id);
      l.exit({ code: m.code, timedOut: m.timedOut, stopped: m.stopped, ms: m.ms });
    } else if (m.type === "run-fail" || m.type === "error") {
      listeners.delete(id);
      l.fail(m.message);
    }
  });
  connect().then(
    () => send({ type: "setup-run", id, service, step, ...(workspace ? { workspace } : {}), ...(create ? { create } : {}) }),
    (e: Error) => {
      listeners.delete(id);
      l.fail(e.message);
    },
  );
  return id;
}

// ── terminals ──

export interface TermInfo {
  id: string;
  label: string;
  shell: string;
  mode: "pty" | "line" | null;
  why?: string;
  exited: boolean;
  /** What it printed so far (the last 256 KB), so a view mounted again (docked, popped out) shows it. */
  history: string;
}

const HISTORY = 256 * 1024;
let terms: TermInfo[] = [];
let activeTerm: string | null = null;
const termSubs = new Set<() => void>();
const termData = new Map<string, Set<(d: string) => void>>();
const termEmit = () => termSubs.forEach((f) => f());
let termSnap: { terms: TermInfo[]; active: string | null } = { terms, active: activeTerm };

export const terminals = {
  subscribe(f: () => void) {
    termSubs.add(f);
    return () => void termSubs.delete(f);
  },
  get: () => termSnap,
  /** Live output of one terminal, for its view. */
  onData(id: string, f: (d: string) => void) {
    let s = termData.get(id);
    if (!s) termData.set(id, (s = new Set()));
    s.add(f);
    return () => void s!.delete(f);
  },
  info: (id: string) => terms.find((t) => t.id === id) ?? null,
};

function setTerms(next: TermInfo[], active = activeTerm) {
  terms = next;
  activeTerm = active && next.some((t) => t.id === active) ? active : (next.at(-1)?.id ?? null);
  termSnap = { terms, active: activeTerm };
  termEmit();
}

function patchTerm(id: string, p: Partial<TermInfo>) {
  setTerms(terms.map((t) => (t.id === id ? { ...t, ...p } : t)));
}

export function selectTerminal(id: string) {
  setTerms(terms, id);
}

/** Open a shell (the default one when `shell` is not given). */
export function openTerminal(shell: string | undefined, cols: number, rows: number): string {
  const id = newId("term");
  setTerms([...terms, { id, label: "Starting…", shell: shell ?? "", mode: null, exited: false, history: "" }], id);
  const write = (d: string) => {
    const t = terms.find((x) => x.id === id);
    if (t) t.history = (t.history + d).slice(-HISTORY);
    termData.get(id)?.forEach((f) => f(d));
  };
  listeners.set(id, (m) => {
    if (m.type === "term-opened") {
      patchTerm(id, { label: m.label, shell: m.shell, mode: m.mode, ...(m.why ? { why: m.why } : {}) });
      // The view may have measured itself before the shell was there.
      const size = sizes.get(id);
      if (size) send({ type: "term-resize", id, ...size });
    }
    else if (m.type === "term-data") write(m.data);
    else if (m.type === "term-exit") {
      write(`\r\n[The shell ended${m.code ? ` with code ${m.code}` : ""}.]\r\n`);
      patchTerm(id, { exited: true });
      listeners.delete(id);
    } else if (m.type === "error") {
      write(`\r\n${m.message}\r\n`);
      patchTerm(id, { exited: true, ...(terms.find((t) => t.id === id)?.mode ? {} : { label: "Not started" }) });
      listeners.delete(id);
    }
  });
  connect().then(
    () => send({ type: "term-open", id, ...(shell ? { shell } : {}), cols, rows }),
    (e: Error) => {
      write(`${e.message}\r\n`);
      patchTerm(id, { exited: true, label: "Not started" });
      listeners.delete(id);
    },
  );
  return id;
}

export const termInput = (id: string, data: string) => send({ type: "term-in", id, data });
const sizes = new Map<string, { cols: number; rows: number }>();
/** Narrower than this is a panel still opening, not a terminal: TerminalPane doesn't pass it on. */
export const MIN_COLS = 20;
export function termResize(id: string, cols: number, rows: number) {
  sizes.set(id, { cols, rows });
  send({ type: "term-resize", id, cols, rows });
}

export function closeTerminal(id: string) {
  send({ type: "term-close", id });
  listeners.delete(id);
  termData.delete(id);
  sizes.delete(id);
  setTerms(terms.filter((t) => t.id !== id));
}

/**
 * Type a line into the terminal without pressing Enter, so the user reads it and
 * runs it themselves ("Fix with guide"): the Output panel comes forward on its
 * Terminal tab, in the open shell, or a new one once it has started.
 * Resolves with the shell's id ("powershell", "cmd", "gitbash", "zsh"…).
 */
export function typeInTerminal(text: (shellId: string) => string, show: () => void): Promise<string> {
  outputMode.set("terminal");
  show();
  const live = terms.find((t) => t.id === activeTerm && !t.exited && t.mode) ?? terms.find((t) => !t.exited && t.mode);
  if (live) {
    selectTerminal(live.id);
    termInput(live.id, text(live.shell));
    return Promise.resolve(live.shell);
  }
  const id = terms.find((t) => !t.exited && !t.mode)?.id ?? openTerminal(undefined, 100, 24);
  return new Promise((done, fail) => {
    const off = terminals.subscribe(() => {
      const t = terms.find((x) => x.id === id);
      if (!t || t.exited) {
        off();
        return fail(new Error("The terminal didn't start."));
      }
      if (!t.mode) return;
      off();
      // Once the terminal has its real width (the panel may still be opening: a line typed into a shell
      // that thinks it is 16 columns wide stays wrapped at 16), and a moment for the prompt to draw.
      const started = Date.now();
      const type = () => {
        if (!sizes.has(id) && Date.now() - started < 3000) return void setTimeout(type, 100);
        setTimeout(() => {
          termInput(id, text(t.shell));
          done(t.shell);
        }, 400);
      };
      type();
    });
  });
}

/** What the server said about its terminal on connecting ("pty" or the line-mode stand-in). */
export const terminalMode = () => termMode;

// ── Output | Terminal ──

let mode: "output" | "terminal" = "output";
const modeSubs = new Set<() => void>();
export const outputMode = {
  subscribe(f: () => void) {
    modeSubs.add(f);
    return () => void modeSubs.delete(f);
  },
  get: () => mode,
  set(m: "output" | "terminal") {
    if (m === mode) return;
    mode = m;
    modeSubs.forEach((f) => f());
  },
};
