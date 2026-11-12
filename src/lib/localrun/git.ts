// Source Control (src/ide/localrun/git): the workspace's git repo on this
// computer, through the user's own git and its sign-in, so no GitHub token is
// ever stored. What changed, a file's diff, commit the files the user ticked,
// discard a file's changes, push and pull, branches, the last commits, and a
// merge's conflicts. The page only names files from the status it was shown;
// every argument goes to git as argv (execFile, no shell), and a commit
// message is never read as an option. Pushing never waits on a typed password
// (GIT_TERMINAL_PROMPT=0): the terminal is where a first sign-in happens.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

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
const LOG_FORMAT = "--format=%h%x1f%s%x1f%an%x1f%ar%x1f%D%x1e";

export function parseLog(out: string): GitCommit[] {
  return out
    .split("\x1e")
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [hash, subject, author, when, refs] = r.split("\x1f");
      return { hash, subject, author, when, refs: refs ?? "" };
    });
}

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

  return {
    topOf,
    status,

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
