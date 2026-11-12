// Reading a setup step's output as it streams (src/lib/localrun/setup.ts runs
// it with colours and spinners off): which phase it is in, the package it is
// on, how many are done and, when the tool says, of how many. Each installer
// prints its own way; this knows pip, npm, pnpm, yarn, bun, pub, composer,
// bundler and dotnet. Pure, so tests feed it real output.
import type { ProgressKind } from "@/lib/localrun/setupTypes";

export interface Progress {
  /** "Collecting", "Installing", "Resolving"… shown over the bar. */
  phase: string;
  /** The package it is on right now. */
  pkg: string | null;
  /** Packages done, and the total when the tool says it (null: count only, the bar sweeps). */
  done: number;
  total: number | null;
  /** 0–1, or null when there is no honest figure (the bar sweeps). */
  fraction: number | null;
  /** The last few package names, newest last (the ticker). */
  recent: string[];
  /** A summary line once the tool prints one ("added 459 packages"). */
  summary: string | null;
  /** Unfinished last line, kept for the next chunk. */
  rest: string;
  /** pip's collected names (to count unique ones). */
  seen: string[];
}

export function startProgress(kind: ProgressKind, expect?: number): Progress {
  const phase = kind === "venv" ? "Creating" : kind === "copy" ? "Making" : kind === "pip" ? "Collecting" : kind === "artisan" ? "Running" : kind === "winget" || kind === "brew" ? "Looking up" : kind === "download" ? "Connecting" : "Resolving";
  return { phase, pkg: null, done: 0, total: expect ?? null, fraction: kind === "venv" || kind === "copy" ? null : expect ? 0 : null, recent: [], summary: null, rest: "", seen: [] };
}

const RECENT = 8;
const push = (p: Progress, name: string): Progress => ({ ...p, pkg: name, recent: [...p.recent.filter((n) => n !== name), name].slice(-RECENT) });
const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** One complete line of output. */
export function readLine(kind: ProgressKind, p: Progress, raw: string): Progress {
  const line = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim();
  if (!line) return p;
  let m: RegExpExecArray | null;
  // WalkMyCode's own note while a step prints nothing (src/lib/localrun/setup.ts): the phase says so.
  if ((m = /^… quiet for (.+), still running$/.exec(line))) return { ...p, phase: `still working · quiet ${m[1]}` };
  switch (kind) {
    case "pip": {
      if ((m = /^Collecting (\S+)/.exec(line)) || (m = /^Requirement already satisfied: (\S+)/.exec(line))) {
        const name = m[1].split(/[<>=!~;\[(]/)[0].toLowerCase();
        const seen = p.seen.includes(name) ? p.seen : [...p.seen, name];
        const total = Math.max(p.total ?? 0, seen.length);
        // Collecting is the first 60 %: what requirements.txt names, then whatever they need, the bar never runs back.
        return { ...push(p, name), phase: "Collecting", seen, done: seen.length, total: p.total, fraction: Math.max(p.fraction ?? 0, 0.6 * clamp(seen.length / Math.max(total + 2, 1))) };
      }
      if ((m = /^Downloading (\S+)/.exec(line))) return { ...push(p, m[1].split("-")[0]), phase: "Downloading" };
      if ((m = /^Installing collected packages: (.+)$/.exec(line))) {
        const names = m[1].split(/,\s*/);
        return { ...p, phase: "Installing", pkg: names.at(-1) ?? null, recent: names.slice(-RECENT), total: names.length, done: 0, fraction: Math.max(p.fraction ?? 0, 0.7) };
      }
      if ((m = /^Successfully installed (.+)$/.exec(line))) {
        const names = m[1].split(/\s+/).map((n) => n.replace(/-[^-]+$/, ""));
        return { ...p, phase: "Installed", done: names.length, total: names.length, fraction: 1, summary: `${names.length} package${names.length === 1 ? "" : "s"} installed`, recent: names.slice(-RECENT), pkg: null };
      }
      return p;
    }
    case "npm": {
      if ((m = /^npm warn deprecated (\S+?)@/i.exec(line))) return { ...push(p, m[1]), phase: "Fetching" };
      if ((m = /^(?:added|changed) (\d+) packages?/.exec(line))) {
        const n = Number(m[1]);
        return { ...p, phase: "Installed", done: n, total: n, fraction: 1, summary: line.split(",")[0], pkg: null };
      }
      if (/^up to date/.test(line)) return { ...p, phase: "Up to date", fraction: 1, summary: line.split(",")[0] };
      if (/^> /.test(line)) return { ...p, phase: "Running scripts", pkg: line.slice(2).split("@")[0] || p.pkg };
      return p;
    }
    case "pnpm": {
      if ((m = /^Packages: \+(\d+)/.exec(line))) return { ...p, total: Number(m[1]), phase: "Fetching" };
      if ((m = /^Progress: resolved (\d+), reused (\d+), downloaded (\d+), added (\d+)/.exec(line))) {
        const [resolved, , , added] = m.slice(1).map(Number);
        const total = p.total ?? null;
        const fraction = total ? clamp(added / total) : null;
        return { ...p, phase: added ? "Adding" : "Resolving", done: added || resolved, fraction: fraction ?? p.fraction };
      }
      if ((m = /^\+ (\S+) /.exec(line))) return push(p, m[1]);
      if ((m = /^Done in (\S+)/.exec(line))) return { ...p, phase: "Installed", fraction: 1, summary: p.total ? `${p.total} packages added` : `Done in ${m[1]}` };
      return p;
    }
    case "yarn": {
      if ((m = /^\[(\d)\/(\d)\] (.+?)\.*$/.exec(line))) return { ...p, phase: m[3].replace(/ (packages|dependencies)$/, ""), fraction: clamp((Number(m[1]) - 1) / Number(m[2])) };
      if ((m = /YN0000: [┌│] (\w+) step/.exec(line))) {
        const order = ["Resolution", "Fetch", "Link"];
        return { ...p, phase: m[1], fraction: clamp(order.indexOf(m[1]) / order.length) };
      }
      if (/^Done in |Done with warnings|YN0000: · Done/.test(line)) return { ...p, phase: "Installed", fraction: 1, summary: "Packages installed" };
      return p;
    }
    case "bun": {
      if ((m = /^\+ (\S+?)@/.exec(line))) return { ...push(p, m[1]), done: p.done + 1, phase: "Installing" };
      if ((m = /^(\d+) packages? installed/.exec(line))) return { ...p, phase: "Installed", fraction: 1, done: Number(m[1]), summary: line };
      return p;
    }
    case "pub": {
      if (/^Resolving dependencies/.test(line)) return { ...p, phase: "Resolving" };
      if (/^Downloading packages/.test(line)) return { ...p, phase: "Downloading" };
      if ((m = /^[+>~] (\S+) /.exec(line))) return { ...push(p, m[1]), done: p.done + 1, phase: "Getting" };
      if (/^(Got dependencies|Changed \d+ dependenc|No dependencies changed)/.test(line)) return { ...p, phase: "Got them", fraction: 1, summary: line.replace(/!$/, "") };
      return p;
    }
    case "composer": {
      if ((m = /Package operations: (\d+) install/.exec(line))) return { ...p, total: Number(m[1]), phase: "Installing", fraction: 0 };
      if ((m = /^- (?:Installing|Downloading) (\S+)/.exec(line))) {
        const done = p.done + (/Installing/.test(line) ? 1 : 0);
        // create-project installs the project itself too: one more than "Package operations" said.
        const total = p.total ? Math.max(p.total, done) : p.total;
        return { ...push(p, m[1]), done, total, fraction: total ? clamp(done / total) : p.fraction };
      }
      if (/^Generating .*autoload/.test(line)) return { ...p, phase: "Autoload", fraction: 1 };
      return p;
    }
    case "bundle": {
      if ((m = /^(Fetching|Installing) (\S+)/.exec(line))) return { ...push(p, m[2]), phase: m[1], done: p.done + (m[1] === "Installing" ? 1 : 0) };
      if ((m = /^Bundle complete! .*?(\d+) gems? now installed/.exec(line))) return { ...p, phase: "Installed", fraction: 1, summary: `${m[1]} gems installed` };
      return p;
    }
    case "winget": {
      if ((m = /^Found (.+?) \[/.exec(line))) return { ...p, phase: "Found", pkg: m[1], seen: [m[1]] };
      // No size known yet: the bar sweeps (null), never sits at a frozen 0 %.
      if (/^Downloading /.test(line)) return { ...p, phase: "Downloading" };
      // WalkMyCode's own measure of winget's download folder (src/lib/localrun/setup.ts): megabytes rolling up.
      if ((m = /^Downloaded ([\d.]+) MB$/.exec(line))) return { ...p, phase: "Downloading", pkg: `${m[1]} MB` };
      if ((m = /([\d.]+)\s*(KB|MB|GB)\s*\/\s*([\d.]+)\s*(KB|MB|GB)/.exec(line))) {
        const unit = (u: string) => (u === "GB" ? 1024 : u === "KB" ? 1 / 1024 : 1);
        const have = Number(m[1]) * unit(m[2]);
        const all = Number(m[3]) * unit(m[4]);
        // The download is the first 70 %; verifying and installing the rest.
        return { ...p, phase: "Downloading", pkg: `${m[1]} ${m[2]} / ${m[3]} ${m[4]}`, fraction: all ? 0.7 * clamp(have / all) : p.fraction };
      }
      if (/verified installer hash/i.test(line)) return { ...p, phase: "Verified", fraction: Math.max(p.fraction ?? 0, 0.75) };
      if (/Extracting archive/i.test(line)) return { ...p, phase: "Extracting", fraction: Math.max(p.fraction ?? 0, 0.8) };
      if (/Starting package install/i.test(line)) return { ...p, phase: "Installing", fraction: Math.max(p.fraction ?? 0, 0.85) };
      if (/^Successfully installed/i.test(line)) return { ...p, phase: "Installed", fraction: 1, summary: p.seen[0] ? `${p.seen[0]} installed` : "Installed" };
      if (/already installed/i.test(line)) return { ...p, phase: "Installed", fraction: 1, summary: "Already installed" };
      return p;
    }
    case "brew": {
      if ((m = /^==> (Fetching|Downloading|Pouring|Installing) (.+)$/.exec(line))) return { ...p, phase: m[1], pkg: m[2].split(/\s/)[0] };
      if ((m = /^#+\s+([\d.]+)%/.exec(line))) return { ...p, fraction: 0.8 * clamp(Number(m[1]) / 100) };
      if (/^🍺/.test(line)) return { ...p, phase: "Installed", fraction: 1, summary: line.replace(/^🍺\s*/, "") };
      return p;
    }
    case "download": {
      if ((m = /^([\d.]+) MB \/ ([\d.?]+) MB$/.exec(line))) {
        const all = Number(m[2]);
        return { ...p, phase: "Downloading", pkg: `${m[1]} MB${all ? ` / ${m[2]} MB` : ""}`, fraction: all ? 0.9 * clamp(Number(m[1]) / all) : null };
      }
      if (/^Checksum matches/.test(line)) return { ...p, phase: "Verified", fraction: 0.95, pkg: "sha-256 ✓" };
      if (/^Saved /.test(line)) return { ...p, phase: "Saved", fraction: 1, summary: "Downloaded and verified" };
      return p;
    }
    case "artisan": {
      // Laravel's own output: "INFO  Running migrations." then one "name …… 12ms DONE" per migration.
      if (/Application key set/i.test(line)) return { ...p, phase: "Key set", fraction: 1, summary: "Application key set" };
      if (/INFO\s+(Preparing database|Running migrations)/.test(line)) return { ...p, phase: /Preparing/.test(line) ? "Preparing" : "Migrating" };
      if ((m = /^(\S+?)\s+\.{2,}.*\bDONE$/.exec(line))) {
        const done = /migration table/i.test(line) ? p.done : p.done + 1;
        return { ...push(p, m[1]), done, fraction: p.total ? clamp(done / p.total) : p.fraction, summary: `${done} table${done === 1 ? "" : "s"} made` };
      }
      if (/Creating migration table/.test(line)) return { ...p, phase: "Preparing", pkg: "migrations" };
      if (/Nothing to migrate/i.test(line)) return { ...p, fraction: 1, summary: "Nothing to migrate" };
      return p;
    }
    case "dotnet": {
      if (/Determining projects to restore/.test(line)) return { ...p, phase: "Determining" };
      if ((m = /Restored (.+?)\s/.exec(line))) return { ...push(p, m[1].split(/[\\/]/).pop() ?? m[1]), phase: "Restored", fraction: 1, summary: "Packages restored" };
      return p;
    }
    default:
      return p;
  }
}

/** A chunk of output, which may end mid-line. */
export function readChunk(kind: ProgressKind, p: Progress, text: string): Progress {
  const lines = (p.rest + text).split(/\r?\n|\r/);
  let next = { ...p, rest: lines.pop() ?? "" };
  for (const l of lines) next = readLine(kind, next, l);
  return next;
}

/** The lines that say why it failed, from the end of the output: the error and what came just before it. */
export function failureExcerpt(log: string, max = 8): { lines: string[]; hot: number } {
  const lines = log.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").split(/\r?\n/).filter((l) => l.trim());
  const isErr = (l: string) => /\b(error|ERR!|fatal|failed|Traceback|exception|not found|denied|ENOENT|EACCES|could not|cannot)\b/i.test(l);
  let at = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isErr(lines[i])) {
      at = i;
      break;
    }
  }
  if (at < 0) return { lines: lines.slice(-max), hot: -1 };
  const start = Math.max(0, Math.min(at - Math.floor(max / 2), lines.length - max));
  const slice = lines.slice(start, start + max);
  return { lines: slice, hot: at - start };
}
