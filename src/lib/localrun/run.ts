// One run of the code on this computer: the file (the real one when the
// workspace is a folder on disk and the code is what is saved there; else a
// copy in a temp folder), the toolchain's command, stdout and stderr streamed
// as they come, and a stop (the user's, or the time limit) that kills the
// whole process tree.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import { killTree, spawnTracked } from "./processes";
import { defaultFileName, LANGS, planRun, type LocalLang, type Toolchain } from "./toolchains";

export interface RunRequest {
  lang: LocalLang;
  code: string;
  /** The file's path in the workspace ("src/app.py"), when the code is a file's. */
  path?: string | null;
  /** Run the file's own tests instead of its main (a lesson's exercise). Rust only. */
  test?: boolean;
}

/** Where a workspace path is on disk, when the workspace is a folder on this computer (WalkMyCode for Claude). */
export interface Located {
  /** The workspace folder: the run's working directory. */
  root: string;
  /** The file, absolute. */
  file: string;
}

export interface RunEvents {
  start(info: { shown: string; cwd: string; version: string | null; program: string; temp: boolean }): void;
  out(stream: "out" | "err", text: string): void;
  exit(info: { code: number | null; signal: string | null; timedOut: boolean; stopped: boolean; ms: number; cut: boolean }): void;
  /** It could not start (nothing installed, a bad request): the message says what to do. */
  fail(message: string): void;
}

export interface RunHandle {
  stop(): void;
}

/** Output kept per run, so a runaway print loop cannot flood the page. */
export const OUTPUT_CAP = 2 * 1024 * 1024;

/**
 * A workspace path on disk: with one folder, the path inside it; with several,
 * the first segment names the folder (its label). Null for anything that
 * would land outside the folders.
 */
export function locateIn(folders: string[], labels: string[], path: string): Located | null {
  if (!folders.length || !path || path.includes("\0")) return null;
  let root = folders[0];
  let inner = path;
  if (folders.length > 1) {
    const i = path.indexOf("/");
    const at = i > 0 ? labels.indexOf(path.slice(0, i)) : -1;
    if (at < 0 || !folders[at]) return null;
    root = folders[at];
    inner = path.slice(i + 1);
  }
  const file = resolvePath(root, inner);
  const rel = relative(root, file);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  return { root, file };
}

/** The Cargo.toml folder above a file, within the workspace folder. */
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

export function startRun(req: RunRequest, tool: Toolchain | undefined, located: Located | null, timeoutS: number, ev: RunEvents): RunHandle {
  const none: RunHandle = { stop() {} };
  if (!tool?.path) {
    ev.fail(`${LANGS[req.lang].label} is not installed on this computer (or not on PATH). ${tool?.note ? `${tool.note} ` : ""}${LANGS[req.lang].install}`);
    return none;
  }
  // The real file when the editor holds exactly what is on disk; else a copy in a temp folder.
  const inPlace = !!located && sameText(located.file, req.code);
  let temp: string | null = null;
  let file: string;
  if (inPlace) file = located!.file;
  else {
    temp = mkdtempSync(join(tmpdir(), "walkmycode-run-"));
    const name = req.path ? basename(req.path) : defaultFileName(req.lang);
    file = join(/* turbopackIgnore: true */ temp, name);
    writeFileSync(file, req.code, "utf8");
  }
  const cwd = located?.root ?? temp ?? tmpdir();
  if (req.test && req.lang !== "rust") {
    ev.fail(`Running a file's own tests is only set up for Rust so far.`);
    if (temp) rmSync(temp, { recursive: true, force: true });
    return none;
  }
  // A file's tests are compiled from the file alone, never through its crate.
  const cargoRoot = inPlace && req.lang === "rust" && located && !req.test ? cargoRootOf(located.file, located.root) : null;
  const plan = planRun(tool, file, { cargoRoot, test: req.test, exe: temp ? join(temp, process.platform === "win32" ? "main.exe" : "main") : undefined });
  if (!plan) {
    ev.fail(`${LANGS[req.lang].label} cannot run here. ${LANGS[req.lang].install}`);
    return none;
  }
  const runCwd = cargoRoot ?? cwd;
  // Imports of the file's neighbours work from the temp copy too.
  const near = located ? dirname(located.file) : null;
  const env: NodeJS.ProcessEnv = { ...process.env, ...plan.env };
  if (near && req.lang === "python") env.PYTHONPATH = [near, located!.root, process.env.PYTHONPATH].filter(Boolean).join(process.platform === "win32" ? ";" : ":");
  ev.start({ shown: plan.shown, cwd: runCwd, version: tool.version, program: tool.path, temp: !inPlace });

  const t0 = Date.now();
  let size = 0;
  let cut = false;
  let stopped = false;
  let timedOut = false;
  let ended = false;
  let child: ReturnType<typeof spawnTracked> | null = null;
  const cleanup = () => {
    if (temp) rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  };
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, timeoutS * 1000);
  const finish = (code: number | null, signal: string | null) => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    ev.exit({ code, signal, timedOut, stopped, ms: Date.now() - t0, cut });
    // Windows keeps the file locked a moment after the process ends.
    setTimeout(() => {
      try {
        cleanup();
      } catch {
        // A temp folder left behind is cleared by the system later.
      }
    }, 200);
  };
  // The whole tree: a shell's children, the program `go run` built.
  const kill = () => killTree(child?.pid);
  const forward = (stream: "out" | "err") => (b: Buffer) => {
    if (cut) return;
    size += b.length;
    if (size > OUTPUT_CAP) {
      cut = true;
      ev.out("err", `\n… output cut after ${OUTPUT_CAP / 1024 / 1024} MB; the program was stopped.\n`);
      kill();
      return;
    }
    ev.out(stream, b.toString("utf8"));
  };

  const step = (i: number) => {
    const s = plan.steps[i];
    try {
      child = spawnTracked(s.file, s.args, { cwd: runCwd, env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      ev.out("err", `Could not start ${s.file}: ${(e as Error).message}\n`);
      return finish(null, null);
    }
    child.stdout?.on("data", forward("out"));
    child.stderr?.on("data", forward("err"));
    child.once("error", (e) => {
      ev.out("err", `Could not start ${basename(s.file)}: ${e.message}\n`);
      finish(null, null);
    });
    child.once("close", (code, signal) => {
      if (code === 0 && i + 1 < plan.steps.length && !stopped && !timedOut) step(i + 1);
      else finish(code, signal);
    });
  };
  step(0);

  return {
    stop() {
      if (ended) return;
      stopped = true;
      kill();
    },
  };
}
