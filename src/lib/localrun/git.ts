// Source Control (src/ide/localrun/git): the workspace's git repo on this
// computer, through the user's own git and its sign-in, so no GitHub token is
// ever stored. What changed, a file's diff, commit the files the user ticked,
// discard a file's changes, push and pull, branches, the last commits, and a
// merge's conflicts. And who changed each line of a file and when (blame), and
// the file's own commits (docs/design/git-history.html). The page only names files from the status it was shown;
// every argument goes to git as argv (execFile, no shell), and a commit
// message is never read as an option. Pushing never waits on a typed password
// (GIT_TERMINAL_PROMPT=0): the terminal is where a first sign-in happens.
import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { COMMIT, FUNC_NAME, githubWeb, LINE_LOG_FORMAT, parseLineLog, STORY_COMMITS, type LineStory, type StoryOf } from "./lineStory";
import { cutDiff, dropSecrets, isRefName, isSecretPath, parseDiff, parseNumstat, type ChangeBases, type RangeChange } from "../diffParse";
import { CHURN_FORMAT, CHURN_MAX_COMMITS, isSpan, parseChurn, sinceOf, type Churn, type Span } from "../hotspots";

export type GitChange = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflicted" | "type";

export interface GitFile {
  /** Relative to the repo's top, forward slashes. */
  path: string;
  /** A rename's old path. */
  from?: string;
  change: GitChange;
  /** Already in the index (staged). */
  staged: boolean;
}

export interface GitStatus {
  /** The repo's top folder. */
  top: string;
  /** null when HEAD is detached. */
  branch: string | null;
  /** "origin/main", or null with no upstream. */
  upstream: string | null;
  ahead: number;
  behind: number;
  /** No commit yet. */
  fresh: boolean;
  /** A merge or rebase waiting on the user (conflicts to resolve, then finish or abort). */
  merging: "merge" | "rebase" | null;
  files: GitFile[];
}

export interface GitBranch {
  name: string;
  current: boolean;
  upstream: string | null;
}

export interface GitCommit {
  hash: string;
  subject: string;
  author: string;
  /** "3 hours ago". */
  when: string;
  /** "HEAD -> main, origin/main". */
  refs: string;
  /** When it was made, ISO 8601 with the author's offset ("2026-11-12T22:41:07+00:00"). */
  date?: string;
}

/** A block of lines in a file that one commit last changed (git blame). */
export interface GitBlameHunk {
  /** Its first line in the file as it is now, from 1. */
  start: number;
  lines: number;
  /** The commit's short hash; "" for lines changed and not committed yet. */
  hash: string;
  author: string;
  email: string;
  /** When the commit was made, in seconds since 1970 (0 when not committed). */
  time: number;
  /** The commit's message, its first line. */
  summary: string;
  /** Committed lines: the commit's full hash, and each line's number in that commit (git blame's
   * "original line"), so a line's own history can start there even when lines above it have moved. */
  sha?: string;
  orig?: number[];
}

/** One commit that changed a file. */
export interface GitFileCommit {
  hash: string;
  subject: string;
  author: string;
  email: string;
  /** ISO 8601 with the author's offset. */
  date: string;
}

export type GitResult = { ok: true; output: string } | { ok: false; output: string };

export type Exec = (args: string[], cwd: string, timeoutMs: number) => Promise<{ code: number; stdout: string; stderr: string }>;

/** The largest diff sent to the page. */
export const DIFF_MAX = 200_000;
/** What a drafted commit message is written from: the ticked files' diffs, cut to about this. */
export const DRAFT_MAX = 30_000;
/** A push or pull is given this long. */
const NET_MS = 120_000;

export const runGit: Exec = (args, cwd, timeoutMs) =>
  new Promise((done) => {
    execFile(
      "git",
      args,
      { cwd, timeout: timeoutMs, windowsHide: true, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" } },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { code?: number | string }) | null;
        if (e && e.code === "ENOENT") return done({ code: 127, stdout: "", stderr: "git isn't installed on this computer (or isn't on PATH)." });
        done({ code: e ? (typeof e.code === "number" ? e.code : 1) : 0, stdout: stdout ?? "", stderr: stderr ?? "" });
      },
    );
  });

/** The execs readOnlyExec made. */
const guarded = new WeakSet<Exec>();

/** git commands that never read a file's contents from the working tree, so no clean or smudge filter
 * can run in them. Every other command (blame, diff, status, anything added later) gets the filters
 * switched off first: an unknown command is treated as one that may run them. */
const NO_WORKTREE_READ = new Set(["rev-parse", "for-each-ref", "merge-base", "symbolic-ref", "config", "ls-files", "log", "check-ref-format"]);

/** Why a read is refused when a filter can't be switched off. */
export const FILTER_REFUSED = "This repo sets up a filter program WalkMyCode can't switch off (its name has an \"=\" in it), so WalkMyCode won't read its changed files.";

/** The filter drivers git knows here (`filter.<name>.*` in any config git reads: the repo's own
 * .git/config, its includes, the user's), from `git config --null --get-regexp`: each entry is
 * "key\nvalue" (or just "key"), entries end with NUL. The name is the key between "filter." and its
 * last dot, kept as written (a driver's name is case-sensitive). */
export function filterDrivers(out: string): string[] {
  const names = new Set<string>();
  for (const entry of out.split("\0")) {
    const key = entry.split("\n", 1)[0];
    const dot = key.lastIndexOf(".");
    if (key.startsWith("filter.") && dot > 7) names.add(key.slice(7, dot));
  }
  return [...names];
}

/** git so that a repo's own settings can't make it start a program, for the ops that only read: no
 * file-system monitor (core.fsmonitor), blame with no text conversion, a diff with no text conversion
 * and no external diff program (diff.external, a diff driver's command), and no clean or smudge
 * filter. The desktop app's read-only route (./gitRead.ts), line history over the local-run socket
 * and the change tour (changeBases, change) run git through this.
 *
 * Filters: a repo's .git/config can define `filter.<name>.clean`, `.smudge` or `.process` (a command),
 * and an attribute `filter=<name>` selects it; git then runs it whenever it reads a file from the
 * working tree (a diff against a commit, blame of a changed file, a new file's diff). Every driver git
 * knows here is switched off by name before such a command: `-c filter.<name>.clean=` (and .smudge,
 * .process) with `.required=false`. git runs no filter whose command is empty, and `-c` outranks every
 * config file. Why not `--attr-source=<the empty tree>` (git 2.40+) instead: it only replaces the
 * working tree's .gitattributes, and $GIT_DIR/info/attributes and a core.attributesFile the repo's own
 * config names still select the filter (tests/gitFilters.test.ts has both); switching the drivers off
 * covers every place an attribute can come from, on every git version, so there's no version to check.
 * A name with "=" in it can't be written as `-c key=value` (git splits at the first "="), so the read
 * is refused instead. The driver list is read with `git config` just before the command; a config
 * changed in between would need something already writing to this computer. */
export function readOnlyExec(exec: Exec = runGit): Exec {
  // Already guarded (a createGit given a readOnlyExec that guards a call again itself): once is enough.
  if (guarded.has(exec)) return exec;
  const ro: Exec = async (all, cwd, timeoutMs) => {
    // The caller's own `-c name=value` pairs (churn's NO_MONITOR) come first; ours go after them, so they win.
    let k = 0;
    while (all[k] === "-c" && k + 1 < all.length) k += 2;
    const pre = all.slice(0, k);
    const args = all.slice(k);
    const a = args[0] === "blame" ? ["blame", "--no-textconv", ...args.slice(1)] : args[0] === "diff" ? ["diff", "--no-textconv", "--no-ext-diff", ...args.slice(1)] : args;
    const base = [...pre, "-c", "core.fsmonitor=false"];
    if (NO_WORKTREE_READ.has(a[0] ?? "")) return exec([...base, ...a], cwd, timeoutMs);
    const list = await exec([...base, "config", "--null", "--get-regexp", "^filter\\."], cwd, 10_000);
    // 1: no filter set up. Anything else: git couldn't read its config, so don't go on blind.
    if (list.code > 1) return { code: list.code, stdout: "", stderr: list.stderr || "git couldn't read this repo's settings." };
    const names = list.code === 0 ? filterDrivers(list.stdout) : [];
    if (names.some((n) => n.includes("="))) return { code: 1, stdout: "", stderr: FILTER_REFUSED };
    const off = names.flatMap((n) => ["-c", `filter.${n}.clean=`, "-c", `filter.${n}.smudge=`, "-c", `filter.${n}.process=`, "-c", `filter.${n}.required=false`]);
    return exec([...base, ...off, ...a], cwd, timeoutMs);
  };
  guarded.add(ro);
  return ro;
}

/** The most new (untracked) files read into a change, and the largest diff git may hand back for one. */
const NEW_FILES_MAX = 40;
/** The branches a change is usually measured against, offered first. */
const USUAL_BASES = ["main", "master", "develop", "dev", "trunk"];
/** A full commit id, as rev-parse and merge-base print it (SHA-1 or SHA-256). */
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

const CHANGE: Record<string, GitChange> = { M: "modified", A: "added", D: "deleted", R: "renamed", C: "added", T: "type", U: "conflicted" };

/** `git status --porcelain=v2 --branch -z` into a status (the top filled in by the caller). */
export function parseStatus(out: string, top: string): GitStatus {
  const s: GitStatus = { top, branch: null, upstream: null, ahead: 0, behind: 0, fresh: false, merging: null, files: [] };
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i];
    if (!line) continue;
    if (line.startsWith("# branch.oid ")) s.fresh = line.endsWith("(initial)");
    else if (line.startsWith("# branch.head ")) {
      const b = line.slice(14);
      s.branch = b === "(detached)" ? null : b;
    } else if (line.startsWith("# branch.upstream ")) s.upstream = line.slice(18);
    else if (line.startsWith("# branch.ab ")) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) [s.ahead, s.behind] = [Number(m[1]), Number(m[2])];
    } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      const f = line.split(" ");
      const xy = f[1];
      const path = f.slice(line.startsWith("1 ") ? 8 : 9).join(" ");
      const x = xy[0];
      const y = xy[1];
      const code = x !== "." ? x : y;
      const file: GitFile = { path, change: CHANGE[code] ?? "modified", staged: x !== "." };
      if (line.startsWith("2 ")) file.from = parts[++i];
      s.files.push(file);
    } else if (line.startsWith("u ")) {
      s.files.push({ path: line.split(" ").slice(10).join(" "), change: "conflicted", staged: false });
    } else if (line.startsWith("? ")) s.files.push({ path: line.slice(2), change: "untracked", staged: false });
  }
  return s;
}

/** `git log` with these fields: unit separators between them, a record separator after each commit. */
const LOG_FORMAT = "--format=%h%x1f%s%x1f%an%x1f%ar%x1f%D%x1f%aI%x1e";

export function parseLog(out: string): GitCommit[] {
  return out
    .split("\x1e")
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [hash, subject, author, when, refs, date] = r.split("\x1f");
      return { hash, subject, author, when, refs: refs ?? "", ...(date ? { date } : {}) };
    });
}

/** A file's own commits: hash, subject, author, email, date. */
const FILE_LOG_FORMAT = "--format=%h%x1f%s%x1f%an%x1f%ae%x1f%aI%x1e";

export function parseFileLog(out: string): GitFileCommit[] {
  return out
    .split("\x1e")
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [hash, subject, author, email, date] = r.split("\x1f");
      return { hash, subject: subject ?? "", author: author ?? "", email: email ?? "", date: date ?? "" };
    });
}

/** `git blame --porcelain` into blocks of lines, each last changed by one commit. A commit's details
 * come once, with its first line; later lines of it carry only the header. Lines not committed yet
 * (the all-zero hash) form blocks of their own with no author. */
export function parseBlame(out: string): GitBlameHunk[] {
  const commits = new Map<string, { author: string; email: string; time: number; summary: string }>();
  const lines: { line: number; hash: string; orig: number }[] = [];
  let cur: string | null = null;
  let at = 0;
  let orig = 0;
  for (const l of out.split("\n")) {
    const head = /^([0-9a-f]{40}) (\d+) (\d+)(?: \d+)?$/.exec(l);
    if (head) {
      cur = head[1];
      orig = Number(head[2]);
      at = Number(head[3]);
      if (!commits.has(cur)) commits.set(cur, { author: "", email: "", time: 0, summary: "" });
      continue;
    }
    if (!cur) continue;
    if (l.startsWith("\t")) {
      lines.push({ line: at, hash: cur, orig });
      continue;
    }
    const c = commits.get(cur)!;
    if (l.startsWith("author ")) c.author = l.slice(7);
    else if (l.startsWith("author-mail ")) c.email = l.slice(12).replace(/^<|>$/g, "");
    else if (l.startsWith("author-time ")) c.time = Number(l.slice(12)) || 0;
    else if (l.startsWith("summary ")) c.summary = l.slice(8);
  }
  const hunks: GitBlameHunk[] = [];
  for (const { line, hash, orig } of lines.sort((a, b) => a.line - b.line)) {
    const pending = /^0+$/.test(hash);
    const short = pending ? "" : hash.slice(0, 7);
    const last = hunks[hunks.length - 1];
    if (last && last.hash === short && (pending || last.sha === hash) && last.start + last.lines === line) {
      last.lines++;
      last.orig?.push(orig);
      continue;
    }
    const c = commits.get(hash)!;
    hunks.push(pending ? { start: line, lines: 1, hash: "", author: "", email: "", time: 0, summary: "" } : { start: line, lines: 1, hash: short, author: c.author, email: c.email, time: c.time, summary: c.summary, sha: hash, orig: [orig] });
  }
  return hunks;
}

/** The biggest file blamed (a minified bundle is not worth it). */
const BLAME_MAX_LINES = 20_000;
/** The most lines one line-history may follow (a function's), and the biggest file it reads to count them. */
const STORY_MAX_SPAN = 2000;
const STORY_MAX_BYTES = 5_000_000;

/** git told not to start the repo's file-system monitor (a program a repo's settings can name). */
const NO_MONITOR = ["-c", "core.fsmonitor=false"];

const tail = (r: { stdout: string; stderr: string }) => `${r.stdout}${r.stderr}`.trim();

export function createGit(exec: Exec = runGit) {
  /** The repo holding the first of these folders that is in one, or null. */
  const topOf = async (roots: string[]): Promise<string | null> => {
    for (const root of roots) {
      if (!existsSync(root)) continue;
      const r = await exec(["rev-parse", "--show-toplevel"], root, 10_000);
      if (r.code === 0 && r.stdout.trim()) return r.stdout.trim();
    }
    return null;
  };

  const status = async (top: string): Promise<GitStatus | { error: string }> => {
    const r = await exec(["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"], top, 20_000);
    if (r.code !== 0) return { error: tail(r) || "git status failed." };
    const s = parseStatus(r.stdout, top);
    const g = await exec(["rev-parse", "--git-dir"], top, 10_000);
    const dir = g.stdout.trim();
    if (g.code === 0 && dir) {
      const gitDir = isAbsolute(dir) ? dir : join(top, dir);
      if (existsSync(join(gitDir, "rebase-merge")) || existsSync(join(gitDir, "rebase-apply"))) s.merging = "rebase";
      else if (existsSync(join(gitDir, "MERGE_HEAD"))) s.merging = "merge";
    }
    return s;
  };

  /** The status's files with these paths, or why not (a path the page names must be one git lists). */
  const listed = async (top: string, paths: string[]): Promise<{ st: GitStatus; files: GitFile[] } | { error: string }> => {
    const st = await status(top);
    if ("error" in st) return st;
    const ok = new Set(st.files.flatMap((f) => (f.from ? [f.path, f.from] : [f.path])));
    const bad = paths.find((p) => !ok.has(p));
    if (bad) return { error: `${bad} has no change any more: refresh and try again.` };
    return { st, files: st.files.filter((f) => paths.includes(f.path)) };
  };

  /** One file's diff text (a new file against nothing), or null when git can't give one. */
  const fileDiff = async (top: string, f: GitFile, fresh: boolean): Promise<string | null> => {
    const args =
      f.change === "untracked"
        ? ["diff", "--no-color", "--no-index", "--", process.platform === "win32" ? "NUL" : "/dev/null", f.path]
        : fresh
          ? ["diff", "--no-color", "--cached", "--", f.path]
          : ["diff", "--no-color", "HEAD", "--", f.path];
    const r = await exec(args, top, 20_000);
    // --no-index exits 1 when the files differ, which is the point.
    return r.code > 1 ? null : r.stdout;
  };

  /** A file of the map in one of these folders: its repo's top and its path in the repo. The map's path
   * is the folder's own (one folder) or starts with the folder's label (several); never outside the folder. */
  const locate = async (roots: string[], path: string): Promise<{ top: string; rel: string } | null> => {
    const clean = path.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!clean || clean.split("/").includes("..")) return null;
    const tries = [clean, clean.split("/").slice(1).join("/")].filter(Boolean);
    for (const root of roots) {
      const base = resolve(root);
      for (const t of tries) {
        const abs = resolve(base, t);
        if (!abs.startsWith(base + sep) || !existsSync(abs)) continue;
        // The file's place in the repo comes from git (its folder's prefix), not from relative(top, abs): git
        // may spell the top differently from the folder we were given (C:\Users\RUNNER~1 against
        // C:/Users/runneradmin, a symlink, a drive letter's case), and the two would not line up.
        const r = await exec(["rev-parse", "--show-toplevel", "--show-prefix"], dirname(abs), 10_000);
        const [top = "", prefix = ""] = r.stdout.split(/\r?\n/).map((l) => l.trim());
        if (r.code !== 0 || !top) return null;
        return { top, rel: `${prefix}${basename(abs)}` };
      }
    }
    return null;
  };

  /** The first of these folders that is in a git repo (the folder itself, not the repo's top), or null. */
  const rootOf = async (roots: string[]): Promise<string | null> => {
    for (const root of roots) {
      if (!existsSync(root)) continue;
      const r = await exec(["rev-parse", "--show-toplevel"], root, 10_000);
      if (r.code === 0 && r.stdout.trim()) return root;
    }
    return null;
  };

  /** A ref the page named, as the commit it is now: checked by its shape first (never an option, never a
   * range), then by git, which must find a commit by that name. Null when it isn't one. */
  const commitOf = async (cwd: string, ref: string): Promise<string | null> => {
    if (ref !== "HEAD" && !isRefName(ref)) return null;
    const r = await exec(["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`], cwd, 10_000);
    const sha = r.stdout.trim();
    return r.code === 0 && SHA.test(sha) ? sha : null;
  };

  return {
    topOf,
    rootOf,
    status,
    locate,

    /** What a change can be toured against: the branch the folder is on, the other branches (local, then
     * remote), and the last commit. Read-only. */
    async changeBases(cwd: string): Promise<ChangeBases | { error: string }> {
      const r = await exec(["for-each-ref", "--format=%(HEAD)%1f%(refname:short)%1f%(refname)", "refs/heads", "refs/remotes"], cwd, 10_000);
      if (r.code !== 0) return { error: tail(r) || "git couldn't list the branches." };
      let current: string | null = null;
      const local: string[] = [];
      const remote: string[] = [];
      for (const line of r.stdout.split("\n")) {
        const [head, name, full] = line.split("\x1f");
        if (!name || !full || !isRefName(name)) continue;
        if (head === "*") current = name;
        // origin/HEAD only points at another remote branch.
        else if (full.startsWith("refs/remotes/")) {
          if (!full.endsWith("/HEAD")) remote.push(name);
        } else local.push(name);
      }
      const last = await commitOf(cwd, "HEAD~1");
      // The usual bases first (main, then origin/main), then the rest as git lists them, local before remote.
      const usual = (n: string, remoteRef: boolean) => USUAL_BASES.indexOf(remoteRef ? n.replace(/^origin\//, "") : n);
      const ranked = [...local.map((n) => ({ n, u: usual(n, false), remote: false })), ...remote.map((n) => ({ n, u: n.startsWith("origin/") ? usual(n, true) : -1, remote: true }))];
      const first = ranked.filter((x) => x.u >= 0).sort((x, y) => x.u - y.u || Number(x.remote) - Number(y.remote));
      const rest = ranked.filter((x) => x.u < 0);
      return { current, bases: [...first, ...rest].map((x) => x.n).slice(0, 60).concat(last ? ["HEAD~1"] : []) };
    },

    /** The change in this folder against a base: the folder as it is now (commits since the branch left
     * the base, and anything not committed yet, new files too) against where it left the base. With no
     * base, against the last commit: the uncommitted changes. Paths are from the folder (`--relative`),
     * secret files are left out, and the diff is cut at DIFF_CUT. Read-only. */
    async change(cwd: string, base: string | null): Promise<RangeChange | { error: string }> {
      const head = await commitOf(cwd, "HEAD");
      if (!head) return { error: "This folder has no commit yet, so there is nothing to compare it with." };
      let from = head;
      if (base !== null) {
        const b = await commitOf(cwd, base);
        if (!b) return { error: `There is no branch or commit called "${base}" here.` };
        // Where this branch left the base; two histories that never met: the base itself.
        const mb = await exec(["merge-base", head, b], cwd, 20_000);
        from = mb.code === 0 && SHA.test(mb.stdout.trim()) ? mb.stdout.trim() : b;
      }
      const branch = await exec(["symbolic-ref", "--quiet", "--short", "HEAD"], cwd, 10_000);
      const opts = ["--no-color", "--no-renames", "--relative"];
      const num = await exec(["diff", "--numstat", "-z", ...opts, from, "--"], cwd, 30_000);
      if (num.code !== 0) return { error: tail(num) || "git couldn't compare the files." };
      const d = await exec(["diff", ...opts, "-U3", from, "--"], cwd, 60_000);
      if (d.code !== 0) return { error: /maxBuffer/i.test(d.stderr) ? "This change is too big to read here." : tail(d) || "git couldn't show the change." };
      const files = parseNumstat(num.stdout);
      let text = dropSecrets(d.stdout);
      let cut = false;
      // New files git doesn't track yet are part of the change too: each as all added lines.
      const ls = await exec(["ls-files", "--others", "--exclude-standard", "-z"], cwd, 20_000);
      const fresh = ls.code === 0 ? ls.stdout.split("\0").filter((p) => p && !isSecretPath(p)) : [];
      if (fresh.length > NEW_FILES_MAX) cut = true;
      for (const p of fresh.slice(0, NEW_FILES_MAX)) {
        if (text.length > DIFF_MAX * 2) {
          cut = true;
          break;
        }
        const n = await exec(["diff", "--no-index", ...opts.filter((o) => o !== "--relative"), "--", process.platform === "win32" ? "NUL" : "/dev/null", p], cwd, 20_000);
        // --no-index exits 1 when the files differ, which is the point.
        if (n.code > 1 || !n.stdout) continue;
        const one = parseDiff(n.stdout)[0];
        if (!one) continue;
        text += n.stdout.endsWith("\n") ? n.stdout : `${n.stdout}\n`;
        files.push({ path: one.path, added: one.added, removed: 0, ...(one.status === "binary" ? { binary: true } : {}) });
      }
      const c = cutDiff(text);
      return { base, head: branch.code === 0 ? branch.stdout.trim() || null : null, files, diff: c.text, cut: cut || c.cut };
    },

    /** Who last changed each line of a file, and when: blocks of lines per commit. Lines changed
     * since the last commit come as blocks with no hash. */
    async blame(top: string, rel: string): Promise<{ ok: true; hunks: GitBlameHunk[]; me: string } | { ok: false; output: string }> {
      const tracked = await exec(["ls-files", "--error-unmatch", "--", rel], top, 10_000);
      if (tracked.code !== 0) return { ok: false, output: `${rel} isn't in git yet: commit it first, then its history shows here.` };
      const r = await exec(["blame", "--porcelain", "--", rel], top, 60_000);
      if (r.code !== 0) return { ok: false, output: tail(r) || `git couldn't blame ${rel}.` };
      const hunks = parseBlame(r.stdout);
      if (hunks.length && hunks[hunks.length - 1].start > BLAME_MAX_LINES) return { ok: false, output: `${rel} is too long to show who changed each line.` };
      const me = await exec(["config", "user.email"], top, 10_000);
      return { ok: true, hunks, me: me.stdout.trim() };
    },

    /** The commits that changed a file, newest first, following it through renames. */
    async fileLog(top: string, rel: string, n = 100): Promise<GitFileCommit[]> {
      const r = await exec(["log", `-n${n}`, "--follow", FILE_LOG_FORMAT, "--", rel], top, 30_000);
      return r.code === 0 ? parseFileLog(r.stdout) : [];
    },

    /** How one line (or a range of lines, or a function by name) got to be as it is: the commits that
     * changed it, newest first, each with the lines it took out and put in (git log -L).
     *
     * A line's number in the file on disk drifts from the commits' once lines above it change and
     * aren't committed, so the page sends the commit that last changed the line and the line's number
     * there (git blame's), `at`: the log starts at that commit, and the lines are checked against the
     * file as that commit has it. Without `at` the lines are the last commit's, so they are refused
     * while the file has changes not committed. The lines are whole numbers inside the file; `at` is
     * a commit's hash (checked by git), never a branch name or an option; a function's name is a plain
     * identifier. git is told not to run a repo's text-conversion or clean/smudge filters or its
     * file-system monitor (readOnlyExec), and is given a limit and a time. */
    async lineLog(top: string, rel: string, of: StoryOf, n = STORY_COMMITS): Promise<{ ok: true; story: LineStory } | { ok: false; output: string }> {
      // Its `diff HEAD` reads the file on disk: guarded like every read (no monitor, no filter), wherever this createGit's exec came from.
      const guard = readOnlyExec(exec);
      const ro = (args: string[], ms = 10_000) => guard(args, top, ms);
      const tracked = await ro(["ls-files", "--error-unmatch", "--", rel]);
      if (tracked.code !== 0) return { ok: false, output: `${rel} isn't in git yet: commit it first, then its history shows here.` };
      // Changes not committed: the file's line numbers on disk aren't the last commit's.
      const changed = (await ro(["diff", "--quiet", "--no-ext-diff", "--no-textconv", "HEAD", "--", rel], 20_000)).code !== 0;
      let range: string;
      let start: string | null = null;
      if ("func" in of) {
        if (typeof of.func !== "string" || !FUNC_NAME.test(of.func)) return { ok: false, output: "That isn't a function's name." };
        // git reads the name as a pattern: a "$" in it is the character, not the end of the line.
        range = `:${of.func.replace(/\$/g, () => "\\$")}:${rel}`;
      } else {
        const { from, to, at } = of;
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to - from >= STORY_MAX_SPAN) return { ok: false, output: "Those aren't lines of the file." };
        let text: string;
        if (at !== undefined) {
          if (typeof at !== "string" || !COMMIT.test(at)) return { ok: false, output: "That isn't a commit." };
          const v = await ro(["rev-parse", "--verify", "--quiet", "--end-of-options", `${at}^{commit}`]);
          start = v.stdout.trim();
          if (v.code !== 0 || !/^[0-9a-f]{40,64}$/.test(start)) return { ok: false, output: "That commit isn't in this repo." };
          const size = await ro(["cat-file", "-s", `${start}:${rel}`]);
          if (size.code !== 0) return { ok: false, output: `${rel} had another name when this line was last changed: its history can't be followed from here yet.` };
          if (Number(size.stdout.trim()) > STORY_MAX_BYTES) return { ok: false, output: `${rel} is too long to follow a line through its history.` };
          const blob = await ro(["cat-file", "blob", `${start}:${rel}`], 20_000);
          if (blob.code !== 0) return { ok: false, output: `git couldn't read ${rel} as that commit has it.` };
          text = blob.stdout;
        } else {
          if (changed) return { ok: false, output: `${rel} has changes not committed yet, so its line numbers don't match the last commit's.` };
          try {
            const abs = join(top, rel);
            if (statSync(abs).size > STORY_MAX_BYTES) return { ok: false, output: `${rel} is too long to follow a line through its history.` };
            text = readFileSync(abs, "utf8");
          } catch {
            return { ok: false, output: `${rel} couldn't be read.` };
          }
        }
        const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
        if (to > lines) return { ok: false, output: `${rel} has only ${lines} lines${start ? " in that commit" : ""}.` };
        range = `${from},${to}:${rel}`;
      }
      // The commit goes after --end-of-options: git can never read it as an option.
      const r = await ro(["log", "--no-textconv", "--no-color", `-n${n + 1}`, LINE_LOG_FORMAT, "-L", range, ...(start ? ["--end-of-options", start] : [])], 30_000);
      if (r.code !== 0) {
        const why = tail(r);
        // A function git can't find in the last commit, or no commit yet: nothing to tell.
        if (/has only \d+ lines|no match|starts beyond|does not have|bad (default )?revision|unknown revision/i.test(why)) return { ok: true, story: { changes: [], web: null, cut: false, changed } };
        return { ok: false, output: why || `git couldn't follow ${rel}'s history.` };
      }
      const all = parseLineLog(r.stdout);
      const remote = await ro(["config", "--get", "remote.origin.url"]);
      return { ok: true, story: { changes: all.slice(0, n), web: remote.code === 0 ? githubWeb(remote.stdout) : null, cut: all.length > n, changed } };
    },

    /** Hotspots (src/lib/hotspots.ts): how often each file in this folder changed over a span, and by how
     * many people, renames followed. Only the folder's own files, with paths from it (--relative). Read-only:
     * no file-system monitor, no text conversion, no outside diff program and no signature check, so a repo's
     * own settings can't make it start a program (here too when it comes through the local-run socket); at
     * most CHURN_MAX_COMMITS commits and 30 seconds. */
    async churn(dir: string, span: Span, now = Date.now()): Promise<{ ok: true; churn: Churn } | { ok: false; located: boolean; output: string }> {
      if (!isSpan(span)) return { ok: false, located: true, output: "Pick 30, 90 or 365 days, or all of the history." };
      const inRepo = await exec([...NO_MONITOR, "rev-parse", "--show-toplevel"], dir, 10_000);
      if (inRepo.code !== 0 || !inRepo.stdout.trim()) return { ok: false, located: false, output: "This project's folder isn't a git repo, so there is no history to read." };
      const since = sinceOf(span, now);
      const r = await exec(
        [...NO_MONITOR, "log", "--no-merges", "--no-textconv", "--no-ext-diff", "--no-show-signature", "--relative", "-M", "--name-status", `-n${CHURN_MAX_COMMITS + 1}`, CHURN_FORMAT, ...(since ? [`--since=${since}`] : []), "--", "."],
        dir,
        30_000,
      );
      // A repo with no commit yet has no history: nothing changed.
      if (r.code !== 0) return /does not have any commits|bad default revision/i.test(tail(r)) ? { ok: true, churn: { span, commits: 0, capped: false, files: {} } } : { ok: false, located: true, output: tail(r) || "git couldn't read the history." };
      return { ok: true, churn: parseChurn(r.stdout, span) };
    },

    /** One file's change as a unified diff; a new file as all added lines. */
    async diff(top: string, path: string): Promise<GitResult> {
      const l = await listed(top, [path]);
      if ("error" in l) return { ok: false, output: l.error };
      const f = l.files[0];
      const out = f ? await fileDiff(top, f, l.st.fresh) : null;
      if (out === null) return { ok: false, output: `git couldn't show the change in ${path}.` };
      const cut = out.length > DIFF_MAX ? `${out.slice(0, DIFF_MAX)}\n… (cut: the diff is longer than ${DIFF_MAX / 1000} KB)` : out;
      return { ok: true, output: cut || "(no line changes: only the file's mode or line endings)" };
    },

    /** The ticked files' changes in one text, for the guide to write a commit message from. */
    async draft(top: string, paths: string[]): Promise<GitResult> {
      const l = await listed(top, paths);
      if ("error" in l) return { ok: false, output: l.error };
      if (!l.files.length) return { ok: false, output: "Tick at least one file." };
      let out = "";
      for (const f of l.files) {
        if (out.length >= DRAFT_MAX) out += `\n(also ${f.path}: ${f.change})`;
        else out += `${((await fileDiff(top, f, l.st.fresh)) ?? `(${f.path}: ${f.change})`).slice(0, DRAFT_MAX)}\n`;
      }
      return { ok: true, output: out };
    },

    /** Commit exactly these files (staging them first); anything else staged stays staged and out of it. */
    async commit(top: string, paths: string[], message: string): Promise<GitResult> {
      const msg = message.trim();
      if (!msg) return { ok: false, output: "Write a message saying what this change does." };
      if (!paths.length) return { ok: false, output: "Tick at least one file to commit." };
      const l = await listed(top, paths);
      if ("error" in l) return { ok: false, output: l.error };
      if (l.st.merging) return { ok: false, output: "Finish or abort the merge first (the buttons above the files)." };
      const add = await exec(["add", "-A", "--", ...paths], top, 60_000);
      if (add.code !== 0) return { ok: false, output: tail(add) };
      const c = await exec(["commit", `--message=${msg}`, "--", ...paths], top, 60_000);
      return { ok: c.code === 0, output: tail(c) };
    },

    /** Throw these files' changes away: back to the last commit, and a new file deleted. */
    async discard(top: string, paths: string[]): Promise<GitResult> {
      const l = await listed(top, paths);
      if ("error" in l) return { ok: false, output: l.error };
      if (!l.files.length) return { ok: false, output: "Name a file to discard." };
      if (l.files.some((f) => f.change === "conflicted")) return { ok: false, output: "A file with a conflict can't be discarded: keep yours or theirs, or abort the merge." };
      const neu = l.files.filter((f) => f.change === "untracked");
      const tracked = l.files.filter((f) => f.change !== "untracked");
      if (tracked.length && l.st.fresh) return { ok: false, output: "There's no commit yet to go back to." };
      if (neu.length) {
        const r = await exec(["clean", "-f", "--", ...neu.map((f) => f.path)], top, 30_000);
        if (r.code !== 0) return { ok: false, output: tail(r) };
      }
      if (tracked.length) {
        const r = await exec(["restore", "--source=HEAD", "--staged", "--worktree", "--", ...tracked.flatMap((f) => (f.from ? [f.path, f.from] : [f.path]))], top, 30_000);
        if (r.code !== 0) return { ok: false, output: tail(r) };
      }
      return { ok: true, output: `Discarded ${l.files.length === 1 ? l.files[0].path : `${l.files.length} files`}.` };
    },

    async branches(top: string): Promise<GitBranch[]> {
      const r = await exec(["for-each-ref", "--format=%(HEAD)%1f%(refname:short)%1f%(upstream:short)", "refs/heads"], top, 10_000);
      if (r.code !== 0) return [];
      return r.stdout
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          const [head, name, up] = l.split("\x1f");
          return { name, current: head === "*", upstream: up || null };
        });
    },

    /** Go to a branch, or make it here and go to it. Git refuses when uncommitted changes would be lost, and says why. */
    async switchTo(top: string, name: string, create: boolean): Promise<GitResult> {
      const n = name.trim();
      const valid = n && !n.startsWith("-") ? await exec(["check-ref-format", "--branch", n], top, 10_000) : null;
      if (!valid || valid.code !== 0) return { ok: false, output: `"${n}" can't be a branch name: use letters, numbers, - and /, with no spaces.` };
      const r = await exec(create ? ["switch", "--create", n] : ["switch", n], top, 60_000);
      return { ok: r.code === 0, output: tail(r) || (create ? `Made ${n} and switched to it.` : `Switched to ${n}.`) };
    },

    /** The last commits on this branch (none before the first commit). */
    async log(top: string, n = 20): Promise<GitCommit[]> {
      const r = await exec(["log", `-n${n}`, LOG_FORMAT], top, 20_000);
      return r.code === 0 ? parseLog(r.stdout) : [];
    },

    /** A file in conflict: keep this side's version, or (after editing it) mark it resolved. */
    async resolve(top: string, path: string, how: "ours" | "theirs" | "done"): Promise<GitResult> {
      const st = await status(top);
      if ("error" in st) return { ok: false, output: st.error };
      if (!st.files.some((f) => f.path === path && f.change === "conflicted")) return { ok: false, output: `${path} has no conflict any more: refresh.` };
      if (how === "done") {
        const check = await exec(["diff", "--check", "--", path], top, 20_000);
        if (/conflict marker/i.test(tail(check))) return { ok: false, output: `${path} still has <<<<<<< ======= >>>>>>> markers: edit them out first.` };
      } else {
        const r = await exec(["checkout", `--${how}`, "--", path], top, 30_000);
        if (r.code !== 0) return { ok: false, output: tail(r) };
      }
      const add = await exec(["add", "--", path], top, 30_000);
      return { ok: add.code === 0, output: tail(add) || `${path}: resolved.` };
    },

    /** Finish the merge or rebase once nothing is left in conflict, or abort it. */
    async finishMerge(top: string, abort: boolean): Promise<GitResult> {
      const st = await status(top);
      if ("error" in st) return { ok: false, output: st.error };
      if (!st.merging) return { ok: false, output: "No merge or rebase is going on." };
      if (!abort && st.files.some((f) => f.change === "conflicted")) return { ok: false, output: "Some files still have conflicts: resolve each one first." };
      const args = st.merging === "rebase" ? ["-c", "core.editor=true", "rebase", abort ? "--abort" : "--continue"] : abort ? ["merge", "--abort"] : ["commit", "--no-edit"];
      const r = await exec(args, top, 60_000);
      return { ok: r.code === 0, output: tail(r) || (abort ? "Stopped: back to where you were." : "Done.") };
    },

    /** Push the branch; with no upstream yet, to origin under the same name (and remember it). */
    async push(top: string): Promise<GitResult> {
      const s = await status(top);
      if ("error" in s) return { ok: false, output: s.error };
      if (!s.branch) return { ok: false, output: "You're not on a branch (detached HEAD): pick one from the branch menu first." };
      const remotes = await exec(["remote"], top, 10_000);
      if (!remotes.stdout.trim()) return { ok: false, output: "This repo has no remote yet. Add one in the terminal: git remote add origin <your GitHub repo's URL>" };
      const names = remotes.stdout.trim().split(/\s+/);
      const args = s.upstream ? ["push"] : ["push", "--set-upstream", names.includes("origin") ? "origin" : names[0], s.branch];
      const r = await exec(args, top, NET_MS);
      if (r.code === 0) return { ok: true, output: tail(r) || "Pushed." };
      const why = tail(r);
      const auth = /Authentication failed|could not read Username|Permission denied|terminal prompts disabled/i.test(why);
      const behind = /rejected|fetch first|non-fast-forward/i.test(why);
      return {
        ok: false,
        output: auth
          ? `${why}\n\nGit needs you to sign in to GitHub once. Run "git push" in the terminal (Ctrl+\`) and follow its sign-in; after that, Push works here.`
          : behind
            ? `${why}\n\nThe remote has commits you don't have yet: Pull first, then Push.`
            : why,
      };
    },

    /** Bring in the remote's commits: only a fast-forward, unless `merge` (then a conflict shows here to resolve). */
    async pull(top: string, merge = false): Promise<GitResult> {
      const r = await exec(merge ? ["pull", "--no-rebase", "--no-edit"] : ["pull", "--ff-only"], top, NET_MS);
      const out = tail(r);
      if (r.code === 0) return { ok: true, output: out || "Up to date." };
      if (merge) return { ok: false, output: /CONFLICT/.test(out) ? `${out}\n\nSome files conflict: resolve each one below, then Finish merge.` : out };
      return { ok: false, output: /Not possible to fast-forward|diverging|divergent/i.test(out) ? `${out}\n\nYour branch and the remote both have new commits: use "Pull & merge".` : out };
    },
  };
}

export type Git = ReturnType<typeof createGit>;
