// "Run on: This computer" (src/lib/localrun): which languages this computer can
// run, with which program on PATH, and the exact command for a file. Pure
// apart from the two things passed in (does a file exist, what does a program
// print for its version), so the tests feed it a fake PATH.
import { delimiter as hostDelimiter, posix, win32 } from "node:path";
import { LOCAL_LANGS, type LocalLang } from "./langs";

export { defaultFileName, LOCAL_LANGS, localLangFromEditor, localLangOf, type LocalLang } from "./langs";

/** One program that can run a language, and how to ask it its version. */
interface Candidate {
  cmd: string;
  /** Only on this platform. */
  only?: NodeJS.Platform;
  versionArgs: string[];
}

interface LangDef {
  label: string;
  candidates: Candidate[];
  /** What to install when none is found: exact, with where to get it. */
  install: string;
}

export const LANGS: Record<LocalLang, LangDef> = {
  python: {
    label: "Python",
    candidates: [
      { cmd: "python", versionArgs: ["--version"] },
      { cmd: "python3", versionArgs: ["--version"] },
      { cmd: "py", only: "win32", versionArgs: ["--version"] },
    ],
    install: "Install Python 3 from https://www.python.org/downloads/ (on Windows tick \"Add python.exe to PATH\"), then restart WalkMyCode.",
  },
  javascript: {
    label: "JavaScript (Node.js)",
    candidates: [
      { cmd: "node", versionArgs: ["--version"] },
      { cmd: "deno", versionArgs: ["--version"] },
    ],
    install: "Install Node.js (the LTS) from https://nodejs.org/, then restart WalkMyCode.",
  },
  typescript: {
    label: "TypeScript",
    candidates: [
      { cmd: "tsx", versionArgs: ["--version"] },
      { cmd: "deno", versionArgs: ["--version"] },
      { cmd: "node", versionArgs: ["--version"] },
    ],
    install: "Install tsx with `npm install -g tsx` (it needs Node.js from https://nodejs.org/), or Deno from https://deno.com/, then restart WalkMyCode.",
  },
  go: { label: "Go", candidates: [{ cmd: "go", versionArgs: ["version"] }], install: "Install Go from https://go.dev/dl/, then restart WalkMyCode." },
  rust: {
    label: "Rust",
    candidates: [
      { cmd: "cargo", versionArgs: ["--version"] },
      { cmd: "rustc", versionArgs: ["--version"] },
    ],
    install: "Install Rust with rustup from https://rustup.rs/, then restart WalkMyCode.",
  },
  java: { label: "Java", candidates: [{ cmd: "java", versionArgs: ["-version"] }], install: "Install a JDK, version 11 or later (for example Temurin from https://adoptium.net/), then restart WalkMyCode." },
  php: { label: "PHP", candidates: [{ cmd: "php", versionArgs: ["--version"] }], install: "Install PHP from https://www.php.net/downloads, then restart WalkMyCode." },
  ruby: { label: "Ruby", candidates: [{ cmd: "ruby", versionArgs: ["--version"] }], install: "Install Ruby from https://www.ruby-lang.org/en/downloads/ (on Windows, RubyInstaller), then restart WalkMyCode." },
  csharp: {
    label: "C#",
    candidates: [{ cmd: "dotnet", versionArgs: ["--version"] }],
    install: "Install the .NET SDK, version 10 or later (it runs a single .cs file), from https://dotnet.microsoft.com/download, then restart WalkMyCode.",
  },
  shell: {
    label: "Shell script",
    candidates: [{ cmd: "bash", versionArgs: ["--version"] }],
    install: "On Windows, install Git for Windows (it brings Git Bash) from https://git-scm.com/download/win; on macOS and Linux bash is already there.",
  },
  powershell: {
    label: "PowerShell",
    candidates: [
      { cmd: "pwsh", versionArgs: ["-NoLogo", "-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"] },
      { cmd: "powershell", only: "win32", versionArgs: ["-NoLogo", "-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"] },
    ],
    install: "Install PowerShell 7 from https://aka.ms/powershell (Windows already has Windows PowerShell).",
  },
  batch: { label: "Batch file", candidates: [{ cmd: "cmd", only: "win32", versionArgs: ["/d", "/c", "ver"] }], install: "Batch files run only on Windows." },
  sql: {
    label: "SQL (SQLite)",
    candidates: [{ cmd: "sqlite3", versionArgs: ["--version"] }],
    install: "Install the SQLite command-line shell (sqlite3) from https://sqlite.org/download.html and put it on PATH (on macOS it is already there).",
  },
};

export interface Env {
  PATH?: string;
  Path?: string;
  PATHEXT?: string;
  [k: string]: string | undefined;
}

export interface FindOptions {
  env: Env;
  platform: NodeJS.Platform;
  /** Is there a file here? */
  exists: (path: string) => boolean;
}

const pathOf = (env: Env) => env.PATH ?? env.Path ?? Object.entries(env).find(([k]) => k.toUpperCase() === "PATH")?.[1] ?? "";

/** The full path of a program on PATH, as the shell would find it, or null. */
export function findOnPath(cmd: string, o: FindOptions): string | null {
  const win = o.platform === "win32";
  const p = win ? win32 : posix;
  // Another platform asked about on Windows (tests): a PATH of Windows folders ("C:\…", or ";") is
  // split the Windows way, since its drive letters hold the ":" a Linux or macOS PATH splits on.
  const path = pathOf(o.env);
  const winPath = process.platform === "win32" && /^[A-Za-z]:[\\/]|;/.test(path);
  const delim = win || winPath ? ";" : o.platform === process.platform ? hostDelimiter : ":";
  const exts = win ? (o.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean).map((e) => e.toLowerCase()) : [""];
  const hasExt = win && exts.some((e) => cmd.toLowerCase().endsWith(e));
  for (const raw of path.split(delim)) {
    const dir = raw.trim().replace(/^"(.*)"$/, "$1");
    if (!dir) continue;
    for (const ext of hasExt ? [""] : exts) {
      const full = p.join(dir, cmd + ext);
      if (o.exists(full)) return full;
    }
  }
  return null;
}

/** The Microsoft Store's stand-in for python.exe: on PATH, but it opens the Store instead of running code. */
export function isStoreStub(path: string): boolean {
  return /[\\/]Microsoft[\\/]WindowsApps[\\/]/i.test(path) && /python3?(\.exe)?$/i.test(path);
}

/** The first line that looks like a version: "Python 3.12.4", "v22.1.0", 'openjdk version "21.0.2"'. */
export function cleanVersion(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /\d+\.\d+/.test(l));
  return (line ?? text.trim().split(/\r?\n/)[0] ?? "").slice(0, 80);
}

export interface Toolchain {
  lang: LocalLang;
  label: string;
  /** The program found, or null when none is installed. */
  cmd: string | null;
  path: string | null;
  version: string | null;
  /** What to install, when nothing was found (or only the Store's stand-in). */
  install: string;
  /** Why the program found cannot be used, when it cannot. */
  note?: string;
}

export interface DetectOptions extends FindOptions {
  /** What `path versionArgs…` prints (stdout and stderr), or null when it fails. */
  version: (path: string, args: string[]) => Promise<string | null>;
  /** Where Git Bash may be when bash is not on PATH (Windows). */
  gitBash?: string | null;
}

/** Every language, with the first working program for it. */
export async function detectToolchains(o: DetectOptions): Promise<Toolchain[]> {
  // One version call per program, shared between languages (node for JS and TS).
  const seen = new Map<string, Promise<string | null>>();
  const versionOf = (path: string, args: string[]) => {
    const key = `${path}\0${args.join(" ")}`;
    if (!seen.has(key)) seen.set(key, o.version(path, args));
    return seen.get(key)!;
  };
  return Promise.all(
    LOCAL_LANGS.map(async (lang): Promise<Toolchain> => {
      const def = LANGS[lang];
      let note: string | undefined;
      for (const c of def.candidates) {
        if (c.only && c.only !== o.platform) continue;
        let path = findOnPath(c.cmd, o);
        // On Windows bash on PATH is often WSL's launcher; Git Bash is the one meant here.
        if (c.cmd === "bash" && o.platform === "win32") {
          if (o.gitBash && o.exists(o.gitBash)) path = o.gitBash;
          else if (path && /[\\/]System32[\\/]bash\.exe$/i.test(path)) path = null;
        }
        if (!path) continue;
        if (o.platform === "win32" && isStoreStub(path)) {
          const v = await versionOf(path, c.versionArgs);
          if (!v || !/\d+\.\d+/.test(v)) {
            note = `The ${c.cmd} on PATH is the Microsoft Store's shortcut, not Python itself.`;
            continue;
          }
        }
        // TypeScript on plain Node needs Node 23.6 or later (it strips the types).
        const v = await versionOf(path, c.versionArgs);
        if (lang === "typescript" && c.cmd === "node" && !nodeStripsTypes(v)) continue;
        return { lang, label: def.label, cmd: c.cmd, path, version: v ? cleanVersion(v) : null, install: def.install };
      }
      return { lang, label: def.label, cmd: null, path: null, version: null, install: def.install, ...(note ? { note } : {}) };
    }),
  );
}

/** Node 23.6+ runs .ts files itself (types removed, not checked). */
export function nodeStripsTypes(version: string | null): boolean {
  const m = /v?(\d+)\.(\d+)/.exec(version ?? "");
  if (!m) return false;
  const [maj, min] = [Number(m[1]), Number(m[2])];
  return maj > 23 || (maj === 23 && min >= 6) || (maj === 22 && min >= 18);
}

/** One step of a run: a program and its arguments. A compiled language has two (compile, then run). */
export interface Step {
  file: string;
  args: string[];
}

export interface Plan {
  steps: Step[];
  /** The command as a person would type it, for the output's first line. */
  shown: string;
  /** Extra environment for the run. */
  env?: Record<string, string>;
}

const q = (s: string) => (/[\s"]/.test(s) ? `"${s}"` : s);

/**
 * The command that runs `file` (absolute) with this toolchain. `exe` is where
 * a compiled program goes (rustc), `cargoRoot` the crate when the file is in one.
 */
export function planRun(t: Toolchain, file: string, o: { exe?: string; cargoRoot?: string | null; platform?: NodeJS.Platform; test?: boolean } = {}): Plan | null {
  if (!t.path || !t.cmd) return null;
  const exe = t.path;
  const one = (args: string[], env?: Record<string, string>): Plan => ({ steps: [{ file: exe, args }], shown: [t.cmd!, ...args].map(q).join(" "), ...(env ? { env } : {}) });
  switch (t.lang) {
    case "python":
      return one(t.cmd === "py" ? ["-3", "-u", file] : ["-u", file], { PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" });
    case "javascript":
      return t.cmd === "deno" ? one(["run", "--allow-all", file]) : one([file]);
    case "typescript":
      return t.cmd === "deno" ? one(["run", "--allow-all", file]) : one([file]);
    case "go":
      return one(["run", file]);
    case "rust":
      if (t.cmd === "cargo") {
        if (o.cargoRoot) return one(["run", "--quiet"]);
        // No crate: cargo's rustc sits beside it.
        const rustc = exe.replace(/cargo(\.exe)?$/i, (_m, e: string | undefined) => `rustc${e ?? ""}`);
        return compiled(rustc, file, o.exe, rustEdition(t.version), o.test);
      }
      return compiled(exe, file, o.exe, rustEdition(t.version), o.test);
    case "java":
      return one([file]);
    case "php":
      return one([file]);
    case "ruby":
      return one([file]);
    case "csharp":
      return one(["run", file]);
    case "shell":
      return one([file]);
    case "powershell":
      return one(["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file]);
    case "batch":
      return one(["/d", "/c", file]);
    case "sql":
      return one(["-header", "-column", "-bail", ":memory:", `.read '${file.replace(/\\/g, "/").replace(/'/g, "''")}'`]);
  }
}

/** The newest edition this Rust knows: 2024 from Rust 1.85, else 2021. */
export function rustEdition(version: string | null): "2021" | "2024" {
  const m = /(\d+)\.(\d+)/.exec(version ?? "");
  return m && (Number(m[1]) > 1 || Number(m[2]) >= 85) ? "2024" : "2021";
}

/** Compile, then run. `test` builds the file's own tests (rustc --test) and runs those instead of main. */
function compiled(rustc: string, file: string, exe = file.replace(/\.rs$/i, process.platform === "win32" ? ".exe" : ""), edition = "2021", test = false): Plan {
  const args = ["--edition", edition, ...(test ? ["--test"] : []), "-o", exe, file];
  return {
    steps: [
      { file: rustc, args },
      { file: exe, args: [] },
    ],
    shown: `rustc ${args.slice(0, -3).join(" ")} -o ${q(exe)} ${q(file)} && ${q(exe)}`,
  };
}
