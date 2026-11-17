// A change as git writes it, read into files and hunks (the PR / diff tour, docs/GIT.md "Tour a
// change"). The server runs git (src/lib/localrun/git.ts: changeBases, change) and the page reads
// what it sent: `git diff` unified text into files, hunks and the line numbers each added or removed
// line has, and `git diff --numstat -z` into a count per file. Secrets never pass: a .env file (or a
// key, or a secrets file) is dropped from both, here, before anything is shown or sent to an AI.
// No React, no Node: pure, so tests/diffTour.test.ts checks it without git.

/** One line of a hunk: added, removed, or unchanged around them, with its number on each side. */
export interface DiffLine {
  kind: "add" | "del" | "ctx";
  text: string;
  /** Its line in the file before the change (removed and unchanged lines). */
  old?: number;
  /** Its line in the file now (added and unchanged lines). */
  new?: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffFile {
  /** The file's path now (before, for a deleted file), from the project's folder, forward slashes. */
  path: string;
  status: "added" | "deleted" | "modified" | "binary";
  added: number;
  removed: number;
  hunks: DiffHunk[];
}

/** One file's count from `git diff --numstat`: lines added and removed (binary files have none). */
export interface NumStat {
  path: string;
  added: number;
  removed: number;
  binary?: boolean;
}

/** What the server sends for a change: the base it is measured against, the counts, and the diff. */
export interface RangeChange {
  /** The base as asked ("main", "origin/main", "HEAD~1"), or null for the uncommitted changes. */
  base: string | null;
  /** The branch the folder is on now, or null (detached). */
  head: string | null;
  files: NumStat[];
  /** The unified diff, from the project's folder (`--relative`), cut at DIFF_CUT. */
  diff: string;
  /** The diff was longer than that, or had more new files than are read: only the first part is here. */
  cut: boolean;
}

/** The branches a change can be measured against, and the one the folder is on now. */
export interface ChangeBases {
  current: string | null;
  /** Local branches, then remote ones, then "HEAD~1" (the last commit) when there is one. */
  bases: string[];
}

/** The most diff text sent to the page. */
export const DIFF_CUT = 400_000;

/** Files WalkMyCode never shows: a real .env (not .env.example), keys and certificates, secrets files. */
const SECRET = /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx|jks|keystore)|id_rsa.*|id_ed25519.*|.*secrets?\.(json|ya?ml|toml))$/i;
const ENV_EXAMPLE = /(^|\/)\.env\.(example|sample|template|dist)$/i;
export const isSecretPath = (p: string) => SECRET.test(p) && !ENV_EXAMPLE.test(p);

/** A git path as written in a header: `"a/odd name.ts"` (C-quoted when it has odd characters) or plain. */
function unquote(s: string): string {
  const t = s.trim();
  if (!t.startsWith('"') || !t.endsWith('"')) return t;
  const bytes: number[] = [];
  const body = t.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== "\\") {
      for (const b of new TextEncoder().encode(c)) bytes.push(b);
      continue;
    }
    const n = body[++i];
    if (/[0-7]/.test(n ?? "")) {
      bytes.push(parseInt(body.slice(i, i + 3), 8));
      i += 2;
    } else bytes.push(({ n: 10, t: 9, r: 13, '"': 34, "\\": 92 } as Record<string, number>)[n] ?? n.charCodeAt(0));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** "a/lib/x.ts" → "lib/x.ts"; /dev/null (or Windows' NUL) → null. */
function side(s: string): string | null {
  const p = unquote(s.replace(/\t.*$/, ""));
  if (p === "/dev/null" || /(^|\/)NUL$/i.test(p)) return null;
  return p.replace(/^[ab]\//, "");
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** `git diff` text into files and hunks. A diff cut short is read as far as it goes; secret files are left out. */
export function parseDiff(text: string): DiffFile[] {
  const out: DiffFile[] = [];
  let f: DiffFile | null = null;
  let h: DiffHunk | null = null;
  let oldAt = 0;
  let newAt = 0;
  let from: string | null = null;
  const push = () => {
    if (f && f.path && !isSecretPath(f.path)) out.push(f);
  };
  for (const raw of text.split("\n")) {
    const l = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (l.startsWith("diff --git ")) {
      push();
      // The path until --- / +++ say better: "diff --git a/x b/x".
      const m = /^diff --git (?:"?a\/.*?"? )?("?b\/.*)$/.exec(l);
      f = { path: m ? (side(m[1]) ?? "") : "", status: "modified", added: 0, removed: 0, hunks: [] };
      h = null;
      from = null;
      continue;
    }
    if (!f) continue;
    if (!h) {
      if (l.startsWith("new file mode")) f.status = "added";
      else if (l.startsWith("deleted file mode")) f.status = "deleted";
      else if (l.startsWith("Binary files ")) f.status = "binary";
      else if (l.startsWith("--- ")) {
        from = side(l.slice(4));
        if (from === null) f.status = "added";
      } else if (l.startsWith("+++ ")) {
        const to = side(l.slice(4));
        if (to === null) {
          f.status = "deleted";
          if (from) f.path = from;
        } else f.path = to;
      }
    }
    const hm = HUNK.exec(l);
    if (hm) {
      h = { oldStart: +hm[1], oldLines: hm[2] === undefined ? 1 : +hm[2], newStart: +hm[3], newLines: hm[4] === undefined ? 1 : +hm[4], lines: [] };
      f.hunks.push(h);
      oldAt = h.oldStart;
      newAt = h.newStart;
      continue;
    }
    if (!h) continue;
    const c = l[0];
    if (c === "+") {
      h.lines.push({ kind: "add", text: l.slice(1), new: newAt++ });
      f.added++;
    } else if (c === "-") {
      h.lines.push({ kind: "del", text: l.slice(1), old: oldAt++ });
      f.removed++;
    } else if (c === " ") h.lines.push({ kind: "ctx", text: l.slice(1), old: oldAt++, new: newAt++ });
    // "\ No newline at end of file" and anything else: not a line of the file.
  }
  push();
  return out;
}

/** `git diff --numstat -z` (renames off): "added\tremoved\tpath\0" per file, "-" for a binary file's counts. */
export function parseNumstat(z: string): NumStat[] {
  const out: NumStat[] = [];
  for (const rec of z.split("\0")) {
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(rec.replace(/^\n+/, ""));
    if (!m || isSecretPath(m[3])) continue;
    const binary = m[1] === "-";
    out.push({ path: m[3], added: binary ? 0 : +m[1], removed: binary ? 0 : +m[2], ...(binary ? { binary } : {}) });
  }
  return out;
}

/** A diff cut to at most `max` characters, at the start of a file when one fits (so no file is half there). */
export function cutDiff(text: string, max = DIFF_CUT): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false };
  const at = text.lastIndexOf("\ndiff --git ", max);
  return { text: at > 0 ? text.slice(0, at + 1) : text.slice(0, max), cut: true };
}

/** A diff with the secret files' sections taken out (before it is cut, kept or passed on). */
export function dropSecrets(text: string): string {
  // Each file's section on its own: one that reads as no file (a secret, left out by parseDiff) goes.
  return text
    .split(/(?=^diff --git )/m)
    .filter((p) => !p.startsWith("diff --git ") || parseDiff(p).length > 0)
    .join("");
}

/** A base or ref as the page may name it: letters, digits, . _ / -, an optional ~N; never an option or a range. */
const REF = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*\/$)(?!.*\.lock$)(?!.*@\{)[A-Za-z0-9][A-Za-z0-9._/-]{0,199}(?:~\d{1,4})?$/;
export const isRefName = (s: string) => REF.test(s);

/** "+9 −4", "+3", "−2". */
export const countLabel = (added: number, removed: number) => (removed ? (added ? `+${added} −${removed}` : `−${removed}`) : `+${added}`);
