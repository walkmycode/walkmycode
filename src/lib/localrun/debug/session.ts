// One live debug of code on this computer (docs/DEBUG.md; mockup docs/design/debug-native.html): build it
// with debug info, start its language's debugger (./adapters.ts), and drive it over the Debug Adapter
// Protocol (./dap.ts). The page sees plain views: where the program stopped, its call stack, the variables
// of the frame on show (opened a level at a time), and its output; it says continue, step, stop.
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { killTree, spawnTracked } from "../processes";
import type { Located } from "../run";
import { rustEdition, type LocalLang, type Toolchain } from "../toolchains";
import { adapterDir, adapterFor, type Adapter } from "./adapters";
import { DapClient, type DapEvent } from "./dap";

export type DebugCommand = "continue" | "next" | "stepIn" | "stepOut" | "pause";

export interface DebugRequest {
  lang: LocalLang;
  code: string;
  /** The file's path in the workspace, when the code is a file's. */
  path?: string | null;
  /** Lines (1-based) to stop at in this file. */
  breakpoints: number[];
}

export interface FrameView {
  name: string;
  /** The workspace path when the frame is in the user's code, else the file's name (the standard library's). */
  file: string | null;
  line: number;
  /** In the user's own code (the page can show it). */
  mine: boolean;
}

export interface VarView {
  name: string;
  type: string;
  value: string;
  /** Non-zero: it opens (a Vec's items, a struct's fields); ask for them with this. */
  ref: number;
}

export interface PausedView {
  reason: string;
  frames: FrameView[];
  /** The frame on show (the first of the user's own). */
  frame: number;
  vars: VarView[];
}

export interface DebugEvents {
  start(info: { shown: string; cwd: string; version: string | null; adapter: string; temp: boolean }): void;
  out(stream: "out" | "err", text: string): void;
  paused(p: PausedView): void;
  running(): void;
  exit(info: { code: number | null; ms: number; stopped: boolean }): void;
  /** It could not start: the message says why and what to do. */
  fail(message: string): void;
}

export interface DebugHandle {
  command(c: DebugCommand): void;
  breakpoints(lines: number[]): void;
  vars(ref: number): Promise<VarView[]>;
  /** Show another frame of the stack: its variables. */
  frame(index: number): Promise<VarView[]>;
  stop(): void;
  /** A line the user typed for the program (stdin); `end` closes its input. */
  input(text: string, end?: boolean): void;
}

/** Output kept per debug before the program is paused, so a print loop can't flood the page (as Run's cap). */
export const DEBUG_OUTPUT_CAP = 2 * 1024 * 1024;

// ── Rust's names, as a person reads them ──

/** "alloc::vec::Vec<i32,alloc::alloc::Global>" → "Vec<i32>"; "main::Order" → "Order"; "ref$<str$>" → "&str". */
export function prettyRustType(t: string): string {
  let s = t.replace(/,\s*alloc::alloc::Global/g, "").replace(/\bref\$<([^<>]*)>/g, "&$1").replace(/\bref_mut\$<([^<>]*)>/g, "&mut $1").replace(/\b(str|slice2?)\$/g, (_m, w: string) => (w === "str" ? "str" : "[]"));
  // Module paths go (std's and the crate's): the last segment is the name a person wrote.
  for (let i = 0; i < 6 && /\b[a-z_][a-z0-9_]*::/.test(s); i++) s = s.replace(/\b[a-z_][a-z0-9_]*::/g, "");
  return s.replace(/\btuple\$<>/g, "()").replace(/\s+/g, " ").trim();
}

/** A value as the panel shows it: "size=3" → "len 3". */
export function prettyRustValue(v: string): string {
  return v.replace(/^size=(\d+)$/, "len $1");
}

// ── building it with debug info ──

interface Built {
  program: string;
  cwd: string;
  shown: string;
  temp: string | null;
}

/** Cargo's flags for the target the file is: an example, a named binary, or the crate's default. */
export function cargoTarget(file: string, crate: string): string[] {
  const rel = relative(crate, file).split(sep).join("/");
  const stem = basename(file).replace(/\.rs$/i, "");
  if (/^examples\/[^/]+\.rs$/.test(rel)) return ["--example", stem];
  if (/^examples\/([^/]+)\/main\.rs$/.test(rel)) return ["--example", rel.split("/")[1]];
  if (/^src\/bin\/[^/]+\.rs$/.test(rel)) return ["--bin", stem];
  if (/^src\/bin\/([^/]+)\/main\.rs$/.test(rel)) return ["--bin", rel.split("/")[2]];
  return [];
}

/** From cargo's JSON messages: the program built for `file` (its own target), else the first binary. */
export function cargoExecutable(jsonLines: string, file: string): string | null {
  let first: string | null = null;
  const norm = (p: string) => normalize(p).toLowerCase();
  for (const line of jsonLines.split(/\r?\n/)) {
    if (!line.startsWith("{")) continue;
    try {
      const m = JSON.parse(line) as { reason?: string; executable?: string | null; target?: { src_path?: string } };
      if (m.reason !== "compiler-artifact" || !m.executable) continue;
      if (m.target?.src_path && norm(m.target.src_path) === norm(file)) return m.executable;
      first ??= m.executable;
    } catch {
      // Not JSON: cargo's own words.
    }
  }
  return first;
}

function cargoRootOf(file: string, root: string): string | null {
  for (let d = dirname(file); d.startsWith(root); d = dirname(d)) {
    if (existsSync(join(d, "Cargo.toml"))) return d;
    if (dirname(d) === d) break;
  }
  return null;
}

function sameText(file: string, code: string): boolean {
  try {
    return readFileSync(file, "utf8").replace(/\r\n/g, "\n") === code.replace(/\r\n/g, "\n");
  } catch {
    return false;
  }
}

/** Run a build step, its output streamed; resolves with its stdout (kept for cargo's JSON) when it succeeds. */
function step(file: string, args: string[], cwd: string, ev: DebugEvents, keepOut: boolean, track: (c: ChildProcess) => void): Promise<string | null> {
  return new Promise((done) => {
    let out = "";
    let child: ChildProcess;
    try {
      child = spawnTracked(file, args, { cwd, env: { ...process.env, CARGO_TERM_COLOR: "never" }, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      ev.out("err", `Could not start ${basename(file)}: ${(e as Error).message}\n`);
      return done(null);
    }
    track(child);
    child.stdout?.on("data", (b: Buffer) => {
      if (keepOut) out += b.toString("utf8");
      else ev.out("out", b.toString("utf8"));
    });
    child.stderr?.on("data", (b: Buffer) => ev.out("err", b.toString("utf8")));
    child.once("error", (e) => {
      ev.out("err", `Could not start ${basename(file)}: ${e.message}\n`);
      done(null);
    });
    child.once("close", (code) => done(code === 0 ? out : null));
  });
}

// ── the session ──

const q = (s: string) => (/[\s"]/.test(s) ? `"${s}"` : s);

export function startDebug(req: DebugRequest, tool: Toolchain | undefined, located: Located | null, ev: DebugEvents, o: { home?: string; platform?: NodeJS.Platform } = {}): DebugHandle {
  const platform = o.platform ?? process.platform;
  const adapter = adapterFor(req.lang);
  let ended = false;
  let stopped = false;
  let dap: DapClient | null = null;
  let adapterProc: ChildProcess | null = null;
  let server: Server | null = null;
  let building: ChildProcess | null = null;
  let thread = 0;
  let frameIds: number[] = [];
  let temp: string | null = null;
  const t0 = Date.now();
  let source = "";

  const cleanup = () => {
    server?.close();
    if (adapterProc?.pid) killTree(adapterProc.pid);
    if (building?.pid) killTree(building.pid);
    const t = temp;
    if (t)
      setTimeout(() => {
        try {
          rmSync(t, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
        } catch {
          // left for the system to clear
        }
      }, 400);
  };
  const finish = (code: number | null) => {
    if (ended) return;
    flushOut();
    ended = true;
    dap?.dispose();
    cleanup();
    ev.exit({ code, ms: Date.now() - t0, stopped });
  };
  const fail = (message: string) => {
    if (ended) return;
    ended = true;
    dap?.dispose();
    cleanup();
    ev.fail(message);
  };

  const handle: DebugHandle = {
    command(c) {
      if (!dap || ended) return;
      if (c === "pause") return void dap.request("pause", { threadId: thread });
      ev.running();
      void dap.request(c, { threadId: thread });
    },
    breakpoints(lines) {
      if (!dap || ended || !source) return;
      void dap.request("setBreakpoints", { source: { path: source }, breakpoints: lines.map((line) => ({ line })) });
    },
    async vars(ref) {
      if (!dap || ended || !ref) return [];
      const r = await dap.request("variables", { variablesReference: ref });
      return toVars(r.body?.variables);
    },
    async frame(index) {
      if (!dap || ended) return [];
      const id = frameIds[index];
      return id === undefined ? [] : varsOf(id);
    },
    stop() {
      if (ended) return;
      stopped = true;
      // Ask the debugger to end the program, but never wait long: the process tree is killed anyway.
      if (dap && !dap.isClosed) void dap.request("disconnect", { terminateDebuggee: true }, 700).finally(() => finish(null));
      setTimeout(() => finish(null), 800);
      if (!dap) finish(null);
    },
    input(text, end) {
      const w = adapterProc?.stdin;
      if (ended || !w || w.destroyed || w.writableEnded) return;
      if (text) w.write(text);
      if (end) w.end();
    },
  };
  // The program's output, bundled into one message every 50 ms: a print loop sends thousands of tiny pieces,
  // which queued up in front of everything else (Stop's answer included: the page kept drawing for minutes).
  // Capped: past the cap it is paused (Continue goes on, quietly) rather than flooding the page. After Stop,
  // whatever hadn't gone yet is dropped.
  let printed = 0;
  let capped = false;
  let pending: { stream: "out" | "err"; text: string }[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const flushOut = () => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    const go = pending;
    pending = [];
    if (!stopped) for (const p of go) ev.out(p.stream, p.text);
  };
  const out = (stream: "out" | "err", text: string) => {
    if (capped || stopped || ended) return;
    printed += Buffer.byteLength(text);
    if (printed > DEBUG_OUTPUT_CAP) {
      capped = true;
      flushOut();
      ev.out("err", `\n… output cut after ${DEBUG_OUTPUT_CAP / 1024 / 1024} MB: the program was paused. Continue lets it go on (its output isn't shown), or Stop ends it.\n`);
      if (dap && thread) void dap.request("pause", { threadId: thread });
      return;
    }
    const last = pending.at(-1);
    if (last && last.stream === stream) last.text += text;
    else pending.push({ stream, text });
    flushTimer ??= setTimeout(flushOut, 50);
  };

  const toVars = (list: unknown): VarView[] =>
    ((list as { name: string; type?: string; value: string; variablesReference?: number }[] | undefined) ?? [])
      .filter((v) => v.name && v.name !== "[raw]")
      .map((v) => ({ name: v.name, type: req.lang === "rust" ? prettyRustType(v.type ?? "") : (v.type ?? ""), value: req.lang === "rust" ? prettyRustValue(v.value) : v.value, ref: v.variablesReference ?? 0 }));

  const varsOf = async (frameId: number): Promise<VarView[]> => {
    if (!dap) return [];
    const sc = await dap.request("scopes", { frameId });
    const scopes = (sc.body?.scopes as { name: string; variablesReference: number }[] | undefined) ?? [];
    const local = scopes.find((s) => /local/i.test(s.name)) ?? scopes[0];
    if (!local) return [];
    const r = await dap.request("variables", { variablesReference: local.variablesReference });
    return toVars(r.body?.variables);
  };

  if (!adapter) {
    fail(`Debugging ${req.lang} on this computer isn't ready yet: WalkMyCode debugs Rust so far, with more languages coming.`);
    return handle;
  }
  if (!tool?.path) {
    fail(`${req.lang} is not installed on this computer (or not on PATH), so there is nothing to build and debug.`);
    return handle;
  }

  void (async () => {
    // The real file when the editor holds what's saved there; else a copy in a temp folder.
    const inPlace = !!located && sameText(located.file, req.code);
    temp = mkdtempSync(join(tmpdir(), "walkmycode-debug-"));
    if (inPlace) source = located!.file;
    else {
      source = join(/* turbopackIgnore: true */ temp, req.path ? basename(req.path) : "main.rs");
      writeFileSync(source, req.code, "utf8");
    }
    const built = await buildRust(req, tool, source, inPlace ? located : null, temp, platform, ev, (c) => (building = c));
    building = null;
    if (ended) return;
    if (!built) return fail("It didn't build, so there is nothing to debug yet: fix what the compiler says above, then press Debug again.");
    ev.start({ shown: built.shown, cwd: built.cwd, version: tool.version, adapter: `${adapter.label} ${adapter.version}`, temp: !inPlace });
    await debug(adapter, built);
  })().catch((e: unknown) => fail(`The debugger couldn't start: ${(e as Error).message}`));

  async function debug(a: Adapter, built: Built) {
    const dir = adapterDir(a, o.home);
    let exitCode: number | null = null;
    // WalkMyCode listens on a loopback port; the adapter connects to it.
    const conn = await new Promise<Socket>((done, failed) => {
      server = createServer((s) => done(s));
      server.once("error", failed);
      server.listen(0, "127.0.0.1", () => {
        const port = (server!.address() as { port: number }).port;
        const cmd = a.command(dir, port, platform);
        // Tracked, so the server going away kills it (and the program under it) too. Its input is the program's:
        // the page types into it (a guessing game waits for its guess instead of reading end-of-file in a loop).
        adapterProc = spawnTracked(cmd.file, cmd.args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
        adapterProc.stdin?.on("error", () => {
          // The program ended: what was typed has nowhere to go.
        });
        // The program writes to the debugger's console: that is its output.
        adapterProc.stdout?.on("data", (b: Buffer) => out("out", b.toString("utf8")));
        let errText = "";
        adapterProc.stderr?.on("data", (b: Buffer) => (errText = (errText + b.toString("utf8")).slice(-4000)));
        adapterProc.once("error", (e) => failed(new Error(`${a.label} could not start: ${e.message}`)));
        adapterProc.once("exit", (code) => {
          if (!dap) failed(new Error(`${a.label} stopped before it connected (code ${code}). ${errText.trim().split("\n").slice(-3).join(" ")}`));
          else setTimeout(() => finish(exitCode), 300);
        });
      });
      setTimeout(() => failed(new Error(`${a.label} didn't connect within 20 seconds.`)), 20_000);
    });
    if (ended) return conn.destroy();
    dap = new DapClient(conn, conn);
    dap.on((e: DapEvent) => {
      const b = e.body ?? {};
      if (e.event === "stopped") {
        thread = (b.threadId as number) ?? thread;
        void paused(String(b.reason ?? "pause"));
      } else if (e.event === "output") {
        const cat = String(b.category ?? "console");
        if (cat === "stdout" || cat === "stderr") out(cat === "stderr" ? "err" : "out", String(b.output ?? ""));
      } else if (e.event === "exited") exitCode = typeof b.exitCode === "number" ? b.exitCode : null;
      else if (e.event === "terminated" || e.event === "__closed") finish(exitCode);
      else if (e.event === "thread" && b.reason === "started" && !thread) thread = Number(b.threadId) || thread;
    });

    const init = await dap.request("initialize", { clientID: "walkmycode", clientName: "WalkMyCode", adapterID: a.id, linesStartAt1: true, columnsStartAt1: true, pathFormat: "path", supportsVariableType: true });
    if (!init.success) return fail(`${a.label} didn't start: ${init.message ?? "no reason given"}.`);
    const initialized = dap.once("initialized");
    const launched = dap.request("launch", launchArgs(a, built), 60_000);
    await initialized;
    await dap.request("setBreakpoints", { source: { path: source }, breakpoints: req.breakpoints.map((line) => ({ line })) });
    await dap.request("configurationDone", {});
    const l = await launched;
    if (!l.success) fail(`${a.label} couldn't start the program: ${l.message ?? "no reason given"}.`);
  }

  function launchArgs(a: Adapter, built: Built): Record<string, unknown> {
    // CodeLLDB: the program in the debugger's own console (its output is the adapter's stdout).
    return { type: "lldb", request: "launch", name: "WalkMyCode", program: built.program, args: [], cwd: built.cwd, terminal: "console", stopOnEntry: false, sourceLanguages: [req.lang], ...(a.id === "codelldb" ? { sourceMap: {} } : {}) };
  }

  async function paused(reason: string) {
    if (!dap) return;
    const tr = await dap.request("stackTrace", { threadId: thread, startFrame: 0, levels: 40 });
    const raw = (tr.body?.stackFrames as { id: number; name: string; line: number; source?: { path?: string; name?: string } }[] | undefined) ?? [];
    frameIds = raw.map((f) => f.id);
    const frames = raw.map((f) => frameView(f));
    const at = Math.max(0, frames.findIndex((f) => f.mine));
    const vars = raw[at] ? await varsOf(raw[at].id) : [];
    // What it printed before stopping comes first.
    flushOut();
    if (!ended) ev.paused({ reason, frames, frame: at, vars });
  }

  function frameView(f: { name: string; line: number; source?: { path?: string; name?: string } }): FrameView {
    const p = f.source?.path ? normalize(f.source.path) : null;
    const name = prettyRustType(f.name.replace(/<.*$/, ""));
    if (p && source && p.toLowerCase() === normalize(source).toLowerCase()) return { name, file: req.path ?? basename(source), line: f.line, mine: true };
    if (p && located) {
      const rel = relative(located.root, p);
      if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return { name, file: rel.split(sep).join("/"), line: f.line, mine: true };
    }
    return { name, file: f.source?.name ?? (p ? basename(p) : null), line: f.line, mine: false };
  }

  return handle;
}

/** Rust with debug info: cargo build for a file in a crate (its own target), else rustc -g on the file alone. */
async function buildRust(req: DebugRequest, tool: Toolchain, file: string, located: Located | null, temp: string, platform: NodeJS.Platform, ev: DebugEvents, track: (c: ChildProcess) => void): Promise<Built | null> {
  const exe = tool.path!;
  const crate = located ? cargoRootOf(located.file, located.root) : null;
  if (crate && tool.cmd === "cargo") {
    const args = ["build", "--message-format=json-render-diagnostics", ...cargoTarget(file, crate)];
    ev.out("out", `$ cargo ${args.filter((x) => !x.startsWith("--message")).join(" ")}\n`);
    const json = await step(exe, args, crate, ev, true, track);
    const program = json === null ? null : cargoExecutable(json, file);
    if (!program) return null;
    return { program, cwd: crate, shown: `cargo build ${cargoTarget(file, crate).join(" ")}`.trim(), temp: null };
  }
  const rustc = tool.cmd === "cargo" ? exe.replace(/cargo(\.exe)?$/i, (_m, e: string | undefined) => `rustc${e ?? ""}`) : exe;
  const out = join(temp, platform === "win32" ? "main.exe" : "main");
  const args = ["-g", "--edition", rustEdition(tool.version), "-o", out, file];
  ev.out("out", `$ rustc ${args.map(q).join(" ")}\n`);
  if ((await step(rustc, args, dirname(file), ev, false, track)) === null) return null;
  return { program: out, cwd: located?.root ?? dirname(file), shown: `rustc -g ${q(basename(file))}`, temp };
}
