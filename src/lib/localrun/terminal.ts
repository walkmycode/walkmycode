// A real terminal on this computer: the user's shell in a pseudo-terminal
// (node-pty: colours, prompts, full-screen programs, resize). When node-pty
// cannot load here (no prebuilt binary for this platform, a bundle without
// it), a line-mode shell on plain pipes stands in, and says so: each line is
// sent on Enter, and programs that draw the screen do not work.
import { accessSync, chmodSync, constants, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { killTree, spawnTracked, track } from "./processes";
import { findOnPath, type Env } from "./toolchains";

export interface Shell {
  id: string;
  label: string;
  file: string;
  /** Arguments in a pseudo-terminal. */
  args: string[];
  /** Arguments on plain pipes (line mode): read commands from stdin. */
  lineArgs: string[];
}

export interface ShellOptions {
  env: Env;
  platform: NodeJS.Platform;
  exists: (p: string) => boolean;
}

/** The shells found, the default first: PowerShell, then cmd and Git Bash on Windows; the login shell, bash and zsh elsewhere. */
export function findShells(o: ShellOptions): Shell[] {
  const out: Shell[] = [];
  const add = (s: Shell) => {
    if (!out.some((x) => x.id === s.id)) out.push(s);
  };
  if (o.platform === "win32") {
    const root = o.env.SystemRoot ?? o.env.SYSTEMROOT ?? "C:\\Windows";
    const pwsh = findOnPath("pwsh", o);
    const winPs = join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const ps = pwsh ?? (o.exists(winPs) ? winPs : findOnPath("powershell", o));
    if (ps) add({ id: "powershell", label: pwsh ? "PowerShell 7" : "PowerShell", file: ps, args: ["-NoLogo"], lineArgs: ["-NoLogo", "-NoProfile", "-Command", "-"] });
    const cmd = o.env.ComSpec ?? o.env.COMSPEC ?? join(root, "System32", "cmd.exe");
    if (o.exists(cmd)) add({ id: "cmd", label: "Command Prompt", file: cmd, args: [], lineArgs: ["/Q", "/K"] });
    const bash = gitBash(o);
    if (bash) add({ id: "gitbash", label: "Git Bash", file: bash, args: ["--login", "-i"], lineArgs: ["--login", "-s"] });
    return out;
  }
  const login = o.env.SHELL;
  if (login && o.exists(login)) add({ id: login.split("/").pop() ?? "shell", label: login.split("/").pop() ?? login, file: login, args: ["-l"], lineArgs: ["-s"] });
  for (const name of ["bash", "zsh", "sh"]) {
    const f = findOnPath(name, o);
    if (f) add({ id: name, label: name, file: f, args: name === "sh" ? [] : ["-l"], lineArgs: ["-s"] });
  }
  return out;
}

/** Git for Windows' bash.exe: where its installer puts it, or beside git on PATH. Never WSL's bash. */
export function gitBash(o: ShellOptions): string | null {
  const places = [o.env.ProgramFiles, o.env["ProgramFiles(x86)"], o.env.LOCALAPPDATA && join(o.env.LOCALAPPDATA, "Programs")]
    .filter((p): p is string => !!p)
    .map((p) => join(p, "Git", "bin", "bash.exe"));
  const git = findOnPath("git", o);
  if (git) places.push(join(dirname(dirname(git)), "bin", "bash.exe"));
  return places.find((p) => o.exists(p)) ?? null;
}

export interface TerminalEvents {
  data(text: string): void;
  exit(code: number | null): void;
}

export interface TerminalSession {
  mode: "pty" | "line";
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

type PtyModule = typeof import("node-pty");
let pty: Promise<PtyModule | null> | null = null;
/** Why node-pty is not in use, when it is not. */
let ptyWhy = "";

/** node-pty, or null when it cannot load here (WALKMYCODE_NO_PTY=1 forces line mode). */
export function loadPty(): Promise<PtyModule | null> {
  pty ??= (async () => {
    if (process.env.WALKMYCODE_NO_PTY === "1") {
      ptyWhy = "WALKMYCODE_NO_PTY=1 is set.";
      return null;
    }
    try {
      const m = (await import("node-pty")) as PtyModule & { default?: PtyModule };
      helperRunnable();
      return typeof m.spawn === "function" ? m : (m.default ?? null);
    } catch (e) {
      ptyWhy = `node-pty could not load (${(e as Error).message.split("\n")[0]}).`;
      return null;
    }
  })();
  return pty;
}

export const ptyProblem = () => ptyWhy;

/**
 * On macOS and Linux node-pty starts each shell through its `spawn-helper` program, and an npm
 * install can leave that file without its execute bit: every shell then fails with "posix_spawnp
 * failed". Put the bit back where it is missing (as VS Code does). Windows has no helper.
 */
function helperRunnable() {
  if (process.platform === "win32") return;
  let root: string;
  try {
    root = dirname(createRequire(import.meta.url).resolve("node-pty/package.json"));
  } catch {
    return;
  }
  for (const f of [join(root, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"), join(root, "build", "Release", "spawn-helper")]) {
    if (!existsSync(f)) continue;
    try {
      accessSync(f, constants.X_OK);
    } catch {
      try {
        chmodSync(f, 0o755);
      } catch {
        // Not ours to change (a read-only install): the shell falls back to line mode below.
      }
    }
  }
}

export async function openTerminal(shell: Shell, o: { cwd: string; cols: number; rows: number; env?: NodeJS.ProcessEnv }, ev: TerminalEvents): Promise<TerminalSession> {
  const env = { ...process.env, ...o.env, TERM: "xterm-256color", COLORTERM: "truecolor" } as Record<string, string>;
  const cwd = existsSync(o.cwd) ? o.cwd : process.cwd();
  const m = await loadPty();
  // node-pty can load and still fail to start a shell (its helper not runnable): then line mode.
  let p: ReturnType<PtyModule["spawn"]> | null = null;
  if (m) {
    try {
      p = m.spawn(shell.file, shell.args, { name: "xterm-256color", cols: o.cols, rows: o.rows, cwd, env, useConpty: true });
    } catch (e) {
      ptyWhy = `node-pty could not start ${shell.label} (${(e as Error).message.split("\n")[0]}).`;
    }
  }
  if (p) {
    let done = false;
    const untrack = track({ pid: p.pid, kill: () => kill() });
    const kill = () => {
      if (done) return;
      done = true;
      untrack();
      killTree(p.pid);
      try {
        p.kill();
      } catch {
        // Already gone.
      }
    };
    p.onData((d) => ev.data(d));
    p.onExit(({ exitCode }) => {
      if (!done) {
        done = true;
        untrack();
      }
      ev.exit(exitCode);
    });
    return {
      mode: "pty",
      write: (d) => !done && p.write(d),
      resize: (c, r) => {
        if (!done && c > 0 && r > 0) p.resize(Math.min(c, 500), Math.min(r, 300));
      },
      kill,
    };
  }
  // Line mode: the shell reads commands from its stdin, one line at a time.
  const child = spawnTracked(shell.file, shell.lineArgs, { cwd, env: env as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"] });
  const toTerm = (b: Buffer) => ev.data(b.toString("utf8").replace(/\r?\n/g, "\r\n"));
  child.stdout?.on("data", toTerm);
  child.stderr?.on("data", toTerm);
  child.once("error", (e) => ev.data(`\r\nCould not start ${shell.label}: ${e.message}\r\n`));
  child.once("close", (code) => ev.exit(code));
  return {
    mode: "line",
    write: (d) => {
      if (child.stdin?.writable) child.stdin.write(d.replace(/\r\n?/g, "\n"));
    },
    resize: () => {},
    kill: () => killTree(child.pid),
  };
}
