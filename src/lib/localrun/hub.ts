// "Run on: This computer" and the terminal, on the server: the user's consent,
// the toolchains found, and one handler per open socket that starts runs and
// shells for it and kills them when it closes. Both servers use it: the full
// app's (./socket.ts, on its own loopback port with a per-launch token) and
// WalkMyCode for Claude's page server (mcp/src/web.ts, its cookie and Origin).
// Neither lets a socket in unless the user allowed it; revoking closes them all.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { loadLocalRun, loadSetupRoots, saveLocalRun, saveSetupRoot, type LocalRunSettings } from "./consent";
import { DEFAULT_SPAN, SPANS, type Churn } from "../hotspots";
import { createGit, readOnlyExec, type Git, type GitBlameHunk, type GitBranch, type GitCommit, type GitFileCommit, type GitStatus } from "./git";
import { COMMIT, type LineStory } from "./lineStory";
import type { ChangeBases, RangeChange } from "../diffParse";
import { findServiceDirs, planSetup, publicPlan, refreshPath, runSetupStep, type PlannedService, type PlannedStep } from "./setup";
import { defaultParent, planNew, publicStep, starterList } from "./starters";
import { HOSTED_REFUSAL, type LocalRunStatus, type ServerMsg } from "./protocol";
import { locateIn, startRun, type Located, type RunHandle } from "./run";
import { findShells, gitBash, loadPty, openTerminal, ptyProblem, type Shell, type TerminalSession } from "./terminal";
import { detectToolchains, LOCAL_LANGS, type Env, type LocalLang, type Toolchain } from "./toolchains";
import { adapterFor, adapterReady, ADAPTERS, offerOf } from "./debug/adapters";
import { installAdapter } from "./debug/install";
import { startDebug, type DebugHandle } from "./debug/session";

export interface LocalRunOptions {
  /** .walkmycode/config.json (read on every call: tests and Settings change it). */
  configFile: () => string;
  /** Why this server must never run code (hosted mode), or null. */
  refusal?: () => string | null;
  /** Where a workspace path is on disk, when the workspace is a folder here (WalkMyCode for Claude). */
  locate?: (path: string) => Located | null;
  /** Where a terminal opens: the workspace folder when there is one on disk, else the home folder. */
  terminalCwd?: () => string | null;
  /** The workspace's folders on disk (WalkMyCode for Claude); without it, the folder the user named for the workspace (config.json). */
  roots?: () => string[];
  /** Open a project "New project" just made: WalkMyCode for Claude maps it as the workspace; the full app indexes it (`workspace`: its name there). */
  openCreated?: (root: string, name: string) => Promise<{ ok: boolean; workspace?: string; message?: string }>;
  /** Tests: a fake PATH, platform and version prober. */
  env?: Env;
  platform?: NodeJS.Platform;
  exists?: (p: string) => boolean;
  version?: (path: string, args: string[]) => Promise<string | null>;
  /** Tests: a stand-in for git. */
  git?: Git;
}

/** What one page's socket is given: a way to send, and a way to close it. */
export interface Link {
  send(m: ServerMsg): void;
  close(code?: number, reason?: string): void;
}

export interface Connection {
  receive(raw: unknown): void;
  /** The socket closed: everything it started is killed. */
  closed(): void;
}

const MAX_RUNS = 4;
const MAX_DEBUGS = 2;
const MAX_TERMINALS = 8;
const DETECT_TTL_MS = 5 * 60_000;

const Id = z.string().min(1).max(64);
const NewAsk = z.object({
  starter: z.string().min(1).max(40),
  name: z.string().max(64),
  parent: z.string().min(1).max(1000).optional(),
  // "Any framework": the commands the user read; checked again by planNew (./frameworks.ts checkCommands).
  custom: z.object({ framework: z.string().max(60), commands: z.array(z.string().max(300)).max(10) }).optional(),
});

const Msg = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run"), id: Id, lang: z.enum(LOCAL_LANGS as [LocalLang, ...LocalLang[]]), code: z.string().max(1_000_000), path: z.string().max(1000).nullish(), timeout_s: z.number().int().min(1).max(3600).optional(), test: z.boolean().optional() }),
  z.object({ type: z.literal("stop"), id: Id }),
  z.object({ type: z.literal("input"), id: Id, text: z.string().max(65_536), end: z.boolean().optional() }),
  z.object({ type: z.literal("term-open"), id: Id, shell: z.string().max(40).optional(), cols: z.number().int().min(1).max(500), rows: z.number().int().min(1).max(300) }),
  z.object({ type: z.literal("term-in"), id: Id, data: z.string().max(65_536) }),
  z.object({ type: z.literal("term-resize"), id: Id, cols: z.number().int().min(1).max(500), rows: z.number().int().min(1).max(300) }),
  z.object({ type: z.literal("term-close"), id: Id }),
  z.object({ type: z.literal("setup-scan"), id: Id, workspace: z.string().min(1).max(200).optional() }),
  z.object({ type: z.literal("setup-run"), id: Id, service: z.string().min(1).max(500), step: z.string().min(1).max(40), workspace: z.string().min(1).max(200).optional(), create: NewAsk.optional() }),
  z.object({ type: z.literal("new-plan"), id: Id, create: NewAsk }),
  z.object({ type: z.literal("new-open"), id: Id, root: z.string().min(1).max(1200), name: z.string().min(1).max(64) }),
  z.object({ type: z.literal("setup-root"), id: Id, workspace: z.string().min(1).max(200), path: z.string().min(1).max(1000) }),
  z.object({ type: z.literal("debug-start"), id: Id, lang: z.enum(LOCAL_LANGS as [LocalLang, ...LocalLang[]]), code: z.string().max(1_000_000), path: z.string().max(1000).nullish(), breakpoints: z.array(z.number().int().min(1).max(10_000_000)).max(500), workspace: z.string().min(1).max(200).optional() }),
  z.object({ type: z.literal("debug-cmd"), id: Id, cmd: z.enum(["continue", "next", "stepIn", "stepOut", "pause"]) }),
  z.object({ type: z.literal("debug-stop"), id: Id }),
  z.object({ type: z.literal("debug-bps"), id: Id, lines: z.array(z.number().int().min(1).max(10_000_000)).max(500) }),
  z.object({ type: z.literal("debug-vars"), id: Id, req: Id, ref: z.number().int().min(0).optional(), frame: z.number().int().min(0).max(1000).optional() }),
  z.object({ type: z.literal("debug-install"), id: Id, adapter: z.string().min(1).max(40) }),
  z.object({
    type: z.literal("git"),
    id: Id,
    op: z.enum(["status", "diff", "draft", "commit", "discard", "push", "pull", "branches", "switch", "log", "resolve", "finish", "blame", "file-log", "line-log", "bases", "change", "churn"]),
    workspace: z.string().min(1).max(200).optional(),
    path: z.string().min(1).max(1000).optional(),
    paths: z.array(z.string().min(1).max(1000)).max(2000).optional(),
    message: z.string().max(10_000).optional(),
    name: z.string().min(1).max(250).optional(),
    create: z.boolean().optional(),
    how: z.enum(["ours", "theirs", "done"]).optional(),
    merge: z.boolean().optional(),
    abort: z.boolean().optional(),
    /** line-log: the lines, from 1, or a function's name (git.lineLog checks them against the file). */
    from: z.number().int().min(1).max(10_000_000).optional(),
    to: z.number().int().min(1).max(10_000_000).optional(),
    func: z.string().min(1).max(200).optional(),
    /** line-log: the commit that last changed the line (git blame's); from/to are its number there. */
    at: z.string().regex(COMMIT).optional(),
    base: z.string().min(1).max(200).optional(),
    span: z.enum(SPANS).optional(),
  }),
]);

/** What `program args…` prints for its version (stdout, else stderr), or null. */
export function probeVersion(path: string, args: string[]): Promise<string | null> {
  return new Promise((done) => {
    const shim = process.platform === "win32" && /\.(cmd|bat)$/i.test(path);
    const [file, argv, extra] = shim
      ? [process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `"${[`"${path}"`, ...args].join(" ")}"`], { windowsVerbatimArguments: true }]
      : [path, args, {}];
    execFile(file, argv, { timeout: 8000, windowsHide: true, encoding: "utf8", ...extra }, (err, stdout, stderr) => {
      const text = `${stdout ?? ""}\n${stderr ?? ""}`.trim();
      done(err && !text ? null : text || null);
    });
  });
}

export function createLocalRun(o: LocalRunOptions) {
  const env = () => (o.env ?? process.env) as Env;
  const platform = () => o.platform ?? process.platform;
  const exists = o.exists ?? existsSync;
  const links = new Set<Link>();
  let found: { at: number; tools: Promise<Toolchain[]> } | null = null;

  const settings = (): LocalRunSettings => loadLocalRun(o.configFile());
  const refusal = () => o.refusal?.() ?? null;
  const allowed = () => !refusal() && settings().allowed;

  const toolchains = (fresh = false): Promise<Toolchain[]> => {
    if (!found || fresh || Date.now() - found.at > DETECT_TTL_MS) {
      const tools = detectToolchains({ env: env(), platform: platform(), exists, version: o.version ?? probeVersion, gitBash: gitBash({ env: env(), platform: platform(), exists }) });
      found = { at: Date.now(), tools };
      tools.catch(() => (found = null));
    }
    return found.tools;
  };
  const shells = (): Shell[] => findShells({ env: env(), platform: platform(), exists });
  /** PATH as the system has it now (a tool installed outside WalkMyCode, or by an earlier run), at most every 30 s. */
  let pathAt = 0;
  const freshPath = () => {
    if (o.env || Date.now() - pathAt < 30_000) return;
    pathAt = Date.now();
    refreshPath();
    found = null;
  };
  /** Projects this server made ("New project"): the only folders new-open will open. */
  const created = new Set<string>();
  // "Any framework" projects: how many of their commands have run, by folder.
  const customDone = new Map<string, number>();
  const customOf = (c: z.infer<typeof NewAsk>, parent: string) => (c.starter === "custom" ? { commands: c.custom?.commands ?? [], done: customDone.get(join(parent, c.name.trim())) ?? 0 } : undefined);
  const git = o.git ?? createGit();
  // Line history and "Tour a change" only read: git that a repo's own settings can't make start a
  // program, its filters included (./git.ts, readOnlyExec).
  const readGit = o.git ?? createGit(readOnlyExec());
  /** Where "Set up this project" looks: the workspace's own folders, else the one the user named for it. */
  const rootsFor = (workspace?: string): string[] => {
    const own = o.roots?.() ?? [];
    if (own.length) return own;
    return workspace ? loadSetupRoots(o.configFile(), workspace).filter((p) => exists(p)) : [];
  };

  /** Close every page's socket (and so kill everything they started). */
  const closeAll = (why = "Running code on this computer was turned off.") => {
    for (const l of [...links]) l.close(4403, why);
    links.clear();
  };

  return {
    refusal,
    allowed,
    settings,
    toolchains,
    shells,
    closeAll,

    /** GET /api/localrun: everything Settings and the Run menu show. `socket` is where to connect, given only once allowed. */
    async status(socket: () => Promise<{ url: string; token: string | null } | null>, fresh = false): Promise<LocalRunStatus> {
      const why = refusal();
      const s = settings();
      if (why) return { available: false, reason: why, allowed: false, timeout_s: s.timeout_s, toolchains: [], shells: [], terminal: null, socket: null };
      const base = { available: true, allowed: s.allowed, ...(s.allowed_at ? { allowed_at: s.allowed_at } : {}), timeout_s: s.timeout_s };
      if (!s.allowed) return { ...base, toolchains: [], shells: [], terminal: null, socket: null };
      const [tools, pty] = await Promise.all([toolchains(fresh), loadPty()]);
      return {
        ...base,
        toolchains: tools.map(({ lang, label, cmd, version, path, install, note }) => ({ lang, label, cmd, version, path, install, ...(note ? { note } : {}) })),
        shells: shells().map(({ id, label }) => ({ id, label })),
        terminal: pty ? { mode: "pty" } : { mode: "line", why: ptyProblem() },
        socket: await socket(),
      };
    },

    /** POST /api/localrun: allow, revoke, or change the time limit. Revoking closes every socket at once. */
    save(patch: { allowed?: boolean; timeout_s?: number }): LocalRunSettings {
      if (refusal()) throw new Error(HOSTED_REFUSAL);
      const next = saveLocalRun(o.configFile(), patch);
      if (!next.allowed) closeAll();
      return next;
    },

    /** One page's socket, accepted only while allowed (the caller checked who it is). Null when not allowed. */
    connect(link: Link): Connection | null {
      if (!allowed()) return null;
      links.add(link);
      const runs = new Map<string, RunHandle>();
      const debugs = new Map<string, DebugHandle>();
      const terms = new Map<string, TerminalSession>();
      let gone = false;
      const send = (m: ServerMsg) => {
        if (!gone) link.send(m);
      };
      void loadPty().then((p) => send({ type: "hello", terminal: p ? "pty" : "line" }));

      const closed = () => {
        if (gone) return;
        gone = true;
        links.delete(link);
        for (const r of runs.values()) r.stop();
        for (const d of debugs.values()) d.stop();
        for (const t of terms.values()) t.kill();
        runs.clear();
        debugs.clear();
        terms.clear();
      };

      const receive = (raw: unknown) => {
        // Revoked while open (from another tab, or the file): nothing more runs.
        if (!allowed()) {
          send({ type: "error", message: "Running code on this computer is turned off. Allow it again in Settings → This computer." });
          link.close(4403, "not allowed");
          return closed();
        }
        const p = Msg.safeParse(raw);
        if (!p.success) return send({ type: "error", message: "That message is not one WalkMyCode understands." });
        const m = p.data;
        switch (m.type) {
          case "run": {
            if (runs.has(m.id)) return send({ type: "run-fail", id: m.id, message: "That run is already going." });
            if (runs.size >= MAX_RUNS) return send({ type: "run-fail", id: m.id, message: `${MAX_RUNS} runs are going already: stop one first.` });
            void toolchains().then((tools) => {
              if (gone) return;
              const tool = tools.find((t) => t.lang === m.lang);
              let located: Located | null = null;
              try {
                located = m.path && o.locate ? o.locate(m.path) : null;
              } catch {
                located = null;
              }
              const handle = startRun({ lang: m.lang, code: m.code, path: m.path, test: m.test }, tool, located, m.timeout_s ?? settings().timeout_s, {
                start: (i) => send({ type: "run-start", id: m.id, ...i }),
                out: (stream, text) => send({ type: "run-out", id: m.id, stream, text }),
                exit: (i) => {
                  runs.delete(m.id);
                  send({ type: "run-exit", id: m.id, ...i });
                },
                fail: (message) => {
                  runs.delete(m.id);
                  send({ type: "run-fail", id: m.id, message });
                },
              });
              if (!gone) runs.set(m.id, handle);
              else handle.stop();
            });
            return;
          }
          case "stop":
            runs.get(m.id)?.stop();
            return;
          case "input":
            (runs.get(m.id) ?? debugs.get(m.id))?.input?.(m.text, m.end);
            return;
          case "debug-start": {
            if (debugs.has(m.id)) return send({ type: "debug-fail", id: m.id, message: "That debug is already going." });
            if (debugs.size >= MAX_DEBUGS) return send({ type: "debug-fail", id: m.id, message: `${MAX_DEBUGS} debugs are going already: stop one first.` });
            const adapter = adapterFor(m.lang);
            if (!adapter) return send({ type: "debug-fail", id: m.id, message: `Debugging ${m.lang} on this computer isn't ready yet: Rust is, more languages are coming.` });
            if (!adapterReady(adapter)) {
              const offer = offerOf(adapter);
              return send(offer ? { type: "debug-need", id: m.id, offer } : { type: "debug-fail", id: m.id, message: `${adapter.label} has no build for this computer.` });
            }
            void toolchains().then((tools) => {
              if (gone) return;
              let located: Located | null = null;
              try {
                // WalkMyCode for Claude knows its folders; the full app, the one the user named for the workspace.
                const roots = !o.locate && m.workspace ? rootsFor(m.workspace) : [];
                located = !m.path ? null : o.locate ? o.locate(m.path) : roots.length === 1 ? locateIn(roots, [], m.path) : null;
              } catch {
                located = null;
              }
              const handle = startDebug({ lang: m.lang, code: m.code, path: m.path, breakpoints: m.breakpoints }, tools.find((t) => t.lang === m.lang), located, {
                start: (i) => send({ type: "debug-start", id: m.id, ...i }),
                out: (stream, text) => send({ type: "debug-out", id: m.id, stream, text }),
                paused: (view) => send({ type: "debug-paused", id: m.id, view }),
                running: () => send({ type: "debug-running", id: m.id }),
                exit: (i) => {
                  debugs.delete(m.id);
                  send({ type: "debug-exit", id: m.id, ...i });
                },
                fail: (message) => {
                  debugs.delete(m.id);
                  send({ type: "debug-fail", id: m.id, message });
                },
              });
              if (!gone) debugs.set(m.id, handle);
              else handle.stop();
            });
            return;
          }
          case "debug-cmd":
            debugs.get(m.id)?.command(m.cmd);
            return;
          case "debug-stop":
            debugs.get(m.id)?.stop();
            return;
          case "debug-bps":
            debugs.get(m.id)?.breakpoints(m.lines);
            return;
          case "debug-vars": {
            const d = debugs.get(m.id);
            if (!d) return send({ type: "debug-vars", id: m.id, req: m.req, vars: [] });
            void (m.frame !== undefined ? d.frame(m.frame) : d.vars(m.ref ?? 0)).then((vars) => send({ type: "debug-vars", id: m.id, req: m.req, vars }));
            return;
          }
          case "debug-install": {
            const adapter = ADAPTERS.find((a) => a.id === m.adapter);
            if (!adapter) return send({ type: "debug-install-done", id: m.id, ok: false, message: "WalkMyCode doesn't know that debugger." });
            void installAdapter(adapter, (p) => send({ type: "debug-install-progress", id: m.id, ...p })).then(
              () => send({ type: "debug-install-done", id: m.id, ok: true }),
              (e: unknown) => send({ type: "debug-install-done", id: m.id, ok: false, message: (e as Error).message }),
            );
            return;
          }
          case "term-open": {
            if (terms.has(m.id)) return;
            if (terms.size >= MAX_TERMINALS) return send({ type: "error", id: m.id, message: `${MAX_TERMINALS} terminals are open already: close one first.` });
            const list = shells();
            const shell = list.find((s) => s.id === m.shell) ?? list[0];
            if (!shell) return send({ type: "error", id: m.id, message: "No shell was found on this computer." });
            const cwd = o.terminalCwd?.() ?? homedir();
            void openTerminal(shell, { cwd, cols: m.cols, rows: m.rows }, {
              data: (data) => send({ type: "term-data", id: m.id, data }),
              exit: (code) => {
                terms.delete(m.id);
                send({ type: "term-exit", id: m.id, code });
              },
            }).then(
              (t) => {
                if (gone) return t.kill();
                terms.set(m.id, t);
                send({ type: "term-opened", id: m.id, shell: shell.id, label: shell.label, mode: t.mode, ...(t.mode === "line" ? { why: ptyProblem() } : {}) });
              },
              (e: unknown) => send({ type: "error", id: m.id, message: `${shell.label} could not start: ${(e as Error).message}` }),
            );
            return;
          }
          case "setup-scan": {
            freshPath();
            const roots = rootsFor(m.workspace);
            void toolchains().then((tools) => {
              if (gone) return;
              const services = roots.length ? planSetup(roots, { env: env(), platform: platform(), exists, python: tools.find((t) => t.lang === "python")?.path ?? null }) : [];
              send({ type: "setup-plan", id: m.id, services: publicPlan(services), located: roots.length > 0 });
            });
            return;
          }
          case "new-plan": {
            freshPath();
            const parent = m.create.parent?.trim() || defaultParent();
            const p = planNew(m.create.starter, m.create.name.trim(), parent, { env: env(), platform: platform(), exists }, (r) => created.has(r), customOf(m.create, parent));
            const base = { type: "new-plan" as const, id: m.id, starters: starterList(), parent };
            if ("error" in p) return send({ ...base, steps: [], root: "", made: false, error: p.error });
            return send({ ...base, steps: p.steps.map(publicStep), root: p.root, made: p.steps.length === 0 });
          }
          case "new-open": {
            if (!created.has(m.root)) return send({ type: "new-opened", id: m.id, ok: false, message: "WalkMyCode didn't make that folder in this session, so it won't open it from here." });
            void (o.openCreated ? o.openCreated(m.root, m.name) : Promise.resolve<{ ok: boolean; workspace?: string; message?: string }>({ ok: false, message: "This WalkMyCode can't open a folder by itself: add it from the home page." })).then(
              (r) => {
                // The full app knows the workspace by its name: setup looks in the new folder from now on.
                if (r.ok && r.workspace) saveSetupRoot(o.configFile(), r.workspace, m.root);
                send({ type: "new-opened", id: m.id, ...r });
              },
              (e: unknown) => send({ type: "new-opened", id: m.id, ok: false, message: (e as Error).message }),
            );
            return;
          }
          case "setup-run": {
            if (runs.has(m.id)) return send({ type: "run-fail", id: m.id, message: "That step is already going." });
            const roots = rootsFor(m.workspace);
            void toolchains().then((tools) => {
              if (gone) return;
              // The plan is made again from the files on disk: the page only names a step, it never sends a command.
              let step: PlannedStep | undefined;
              let service: PlannedService | undefined;
              let newRootNow: string | null = null;
              // "Any framework": which folder this command is for, so the next round starts from the one after it.
              let customRoot: string | null = null;
              if (m.create) {
                const where = m.create.parent?.trim() || defaultParent();
                const p = planNew(m.create.starter, m.create.name.trim(), where, { env: env(), platform: platform(), exists }, (r) => created.has(r), customOf(m.create, where));
                if (!("error" in p)) {
                  step = p.steps.find((s) => s.id === m.step);
                  // The folder new projects go in, before any step runs there (a tool's install too).
                  if (step) mkdirSync(step.cwd, { recursive: true });
                  if (step?.id === "create") newRootNow = p.root;
                  if (step?.id.startsWith("cmd-")) customRoot = p.root;
                }
              } else {
                service = planSetup(roots, { env: env(), platform: platform(), exists, python: tools.find((t) => t.lang === "python")?.path ?? null }).find((s) => s.id === m.service);
                step = service?.planned.find((s) => s.id === m.step);
              }
              if (!step) return send({ type: "run-fail", id: m.id, message: m.create ? "That step isn't needed any more: try again." : service ? "That step isn't needed any more: check again." : "That folder isn't part of this workspace any more." });
              const handle = runSetupStep(step, {
                start: (i) => send({ type: "run-start", id: m.id, ...i }),
                out: (stream, text) => send({ type: "run-out", id: m.id, stream, text }),
                exit: (i) => {
                  runs.delete(m.id);
                  // A tool just went in: PATH as the system now has it, and the toolchains looked for again.
                  if (step!.id === "tool" && i.code === 0) {
                    refreshPath();
                    found = null;
                  }
                  // Made by this server: it may open it, and carry on with it when asked again.
                  if (newRootNow && i.code === 0 && existsSync(newRootNow)) created.add(newRootNow);
                  if (customRoot && i.code === 0) {
                    const n = Number(step!.id.slice(4)) + 1;
                    customDone.set(customRoot, n);
                    if (n >= (m.create?.custom?.commands.filter((c: string) => c.trim()).length ?? 0)) created.add(customRoot);
                  }
                  send({ type: "run-exit", id: m.id, ...i });
                },
              });
              if (!gone) runs.set(m.id, handle);
              else handle.stop();
            });
            return;
          }
          case "git": {
            const roots = rootsFor(m.workspace);
            type Extra = { ok: boolean; status: GitStatus | null; output?: string; branches?: GitBranch[]; log?: GitCommit[]; blame?: GitBlameHunk[]; me?: string; history?: GitFileCommit[]; story?: LineStory; bases?: ChangeBases; change?: RangeChange; churn?: Churn };
            const reply = (r: Extra) => send({ type: "git-result", id: m.id, op: m.op, located: roots.length > 0, ...r });
            void (async () => {
              // "Tour a change": read from the workspace's first folder in a repo, paths from that folder.
              if (m.op === "bases" || m.op === "change") {
                const root = await readGit.rootOf(roots);
                if (!root) return reply({ ok: false, status: null, output: roots.length ? "This project's folder isn't in a git repo." : "" });
                const r = m.op === "bases" ? await readGit.changeBases(root) : await readGit.change(root, m.base ?? null);
                if ("error" in r) return reply({ ok: false, status: null, output: r.error });
                return reply(m.op === "bases" ? { ok: true, status: null, bases: r as ChangeBases } : { ok: true, status: null, change: r as RangeChange });
              }
              // One file's history: the repo it is in, which may be any of the workspace's folders.
              if (m.op === "blame" || m.op === "file-log" || m.op === "line-log") {
                const at = m.path ? await readGit.locate(roots, m.path) : null;
                if (!at) return reply({ ok: false, status: null, output: roots.length ? `${m.path ?? "That file"} isn't in a git repo in this project's folder.` : "" });
                if (m.op === "file-log") return reply({ ok: true, status: null, history: await readGit.fileLog(at.top, at.rel) });
                if (m.op === "line-log") {
                  if (!m.func === !m.from) return reply({ ok: false, status: null, output: "A line's history needs its line or a function's name." });
                  const l = await readGit.lineLog(at.top, at.rel, m.func ? { func: m.func } : { from: m.from!, to: m.to ?? m.from!, ...(m.at ? { at: m.at } : {}) });
                  return reply(l.ok ? { ok: true, status: null, story: l.story } : { ok: false, status: null, output: l.output });
                }
                const b = await readGit.blame(at.top, at.rel);
                return reply(b.ok ? { ok: true, status: null, blame: b.hunks, me: b.me } : { ok: false, status: null, output: b.output });
              }
              // Hotspots: how often each file of the workspace's folder changed (the first folder in a repo).
              if (m.op === "churn") {
                if (!roots.length) return reply({ ok: false, status: null, output: "" });
                let why = "";
                for (const root of roots) {
                  const c = await readGit.churn(root, m.span ?? DEFAULT_SPAN);
                  if (c.ok) return reply({ ok: true, status: null, churn: c.churn });
                  why ||= c.output;
                }
                return reply({ ok: false, status: null, output: why });
              }
              const top = await git.topOf(roots);
              if (!top) return reply({ ok: m.op === "status", status: null });
              const named = (v: string | undefined) => v ?? "";
              let res: { ok: boolean; output: string } | null = null;
              const extra: Pick<Extra, "branches" | "log"> = {};
              switch (m.op) {
                case "diff":
                  res = await git.diff(top, named(m.path));
                  break;
                case "draft":
                  res = await git.draft(top, m.paths ?? []);
                  break;
                case "commit":
                  res = await git.commit(top, m.paths ?? [], m.message ?? "");
                  break;
                case "discard":
                  res = await git.discard(top, m.paths ?? []);
                  break;
                case "push":
                  res = await git.push(top);
                  break;
                case "pull":
                  res = await git.pull(top, !!m.merge);
                  break;
                case "switch":
                  res = await git.switchTo(top, named(m.name), !!m.create);
                  break;
                case "resolve":
                  res = await git.resolve(top, named(m.path), m.how ?? "done");
                  break;
                case "finish":
                  res = await git.finishMerge(top, !!m.abort);
                  break;
                case "branches":
                  extra.branches = await git.branches(top);
                  break;
                case "log":
                  extra.log = await git.log(top);
                  break;
              }
              const st = await git.status(top);
              if ("error" in st) return reply({ ok: false, status: null, output: res ? `${res.output}\n${st.error}` : st.error });
              reply({ ok: res ? res.ok : true, status: st, ...(res ? { output: res.output } : {}), ...extra });
            })().catch((e: unknown) => reply({ ok: false, status: null, output: (e as Error).message }));
            return;
          }
          case "setup-root": {
            const path = m.path.trim().replace(/^"(.*)"$/, "$1");
            let ok = false;
            let message: string | undefined;
            try {
              if (!isAbsolute(path) || !statSync(path).isDirectory()) message = "That isn't a folder on this computer. Paste its full path, like C:\\Users\\you\\projects\\my-app.";
              else if (!findServiceDirs(path).length) message = "That folder has no package.json, requirements.txt, pubspec.yaml or other project file in it.";
              else {
                saveSetupRoot(o.configFile(), m.workspace, path);
                ok = true;
              }
            } catch {
              message = "That folder can't be read. Check the path.";
            }
            send({ type: "setup-root-saved", id: m.id, ok, ...(message ? { message } : {}) });
            return;
          }
          case "term-in":
            terms.get(m.id)?.write(m.data);
            return;
          case "term-resize":
            terms.get(m.id)?.resize(m.cols, m.rows);
            return;
          case "term-close": {
            const t = terms.get(m.id);
            terms.delete(m.id);
            t?.kill();
            return;
          }
        }
      };
      return { receive, closed };
    },
  };
}

export type LocalRun = ReturnType<typeof createLocalRun>;

/** The hosted mode's refusal (WALKMYCODE_MODE=hosted, or the old LANTERN_MODE), else null. */
export function hostedRefusal(env: Record<string, string | undefined> = process.env): string | null {
  return (env.WALKMYCODE_MODE ?? env.LANTERN_MODE)?.trim().toLowerCase() === "hosted" ? HOSTED_REFUSAL : null;
}
