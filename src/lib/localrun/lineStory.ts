// "How did this line get here?" (src/ide/localrun/git/LineStory.tsx): the commits that changed one
// line, or one function's lines, as `git log -L` gives them (src/lib/localrun/git.ts, lineLog). Each
// change becomes who, when, the commit's message, its PR number when the message ends in "(#123)",
// and a few of the lines it took out and put in. Also the repo's GitHub page, when its remote is
// one, and the question the guide is asked to tell the line's story. No git and no node here: the
// page and the tests load it too.

/** One commit that changed the line, with what it changed there. */
export interface LineChange {
  /** Short hash. */
  hash: string;
  author: string;
  email: string;
  /** ISO 8601 with the author's offset. */
  date: string;
  /** The commit's message, its first line. */
  subject: string;
  /** "41" from a message ending in "(#41)". */
  pr?: string;
  /** A few of the lines it took out and put in, trimmed; `more` counts the ones left out. */
  removed: string[];
  added: string[];
  more: number;
}

/** What the popover shows: the changes, newest first, and where the repo lives on GitHub (or null). */
export interface LineStory {
  changes: LineChange[];
  /** "https://github.com/owner/repo" when the repo's remote is a GitHub one; links are only made then. */
  web: string | null;
  /** True when there were more changes than git was asked for: the oldest are left out. */
  cut: boolean;
  /** The file has changes not committed yet: its line numbers on disk aren't the last commit's, so
   * only a line's own history (from the commit that last changed it) can be followed, not a range. */
  changed: boolean;
}

/** How many changes are asked for, how many lines of each are kept, and how long each line may be. */
export const STORY_COMMITS = 20;
export const STORY_LINES = 3;
export const STORY_WIDTH = 160;

/** The format lineLog asks git for: a record separator, then the fields, then git's diff of the lines. */
export const LINE_LOG_FORMAT = "--format=%x1e%h%x1f%an%x1f%ae%x1f%aI%x1f%s";

const PR = /\(#(\d{1,7})\)\s*$/;

/** "41" from "Move the check into email.ts (#41)", else undefined. */
export function prOf(subject: string): string | undefined {
  return PR.exec(subject)?.[1];
}

/** The message without its "(#41)": the popover shows the PR on its own. */
export const withoutPr = (subject: string) => subject.replace(PR, "").trimEnd();

const trim = (l: string) => {
  const t = l.replace(/\r$/, "").trimEnd();
  return t.length > STORY_WIDTH ? `${t.slice(0, STORY_WIDTH - 1)}…` : t;
};

/** `git log -L … LINE_LOG_FORMAT` into changes, newest first, as git lists them. */
export function parseLineLog(out: string): LineChange[] {
  const changes: LineChange[] = [];
  for (const rec of out.split("\x1e")) {
    if (!rec.trim()) continue;
    const nl = rec.indexOf("\n");
    const head = (nl < 0 ? rec : rec.slice(0, nl)).replace(/\r$/, "");
    const [hash = "", author = "", email = "", date = "", subject = ""] = head.split("\x1f");
    if (!/^[0-9a-f]{4,40}$/.test(hash)) continue;
    const removed: string[] = [];
    const added: string[] = [];
    let more = 0;
    // Only the lines after a hunk's "@@" are the change: before it come diff --git, ---, +++.
    let inHunk = false;
    for (const l of nl < 0 ? [] : rec.slice(nl + 1).split("\n")) {
      if (l.startsWith("@@")) inHunk = true;
      else if (l.startsWith("diff --git ")) inHunk = false;
      else if (inHunk && (l[0] === "-" || l[0] === "+")) {
        const into = l[0] === "-" ? removed : added;
        if (into.length < STORY_LINES) into.push(trim(l.slice(1)));
        else more++;
      }
    }
    const pr = prOf(subject);
    changes.push({ hash, author, email, date, subject, ...(pr ? { pr } : {}), removed, added, more });
  }
  return changes;
}

/** The repo's GitHub page from its remote's URL (https, ssh or scp-like), or null for anything else. */
export function githubWeb(remote: string): string | null {
  const u = remote.trim();
  const m =
    /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(u) ??
    /^(?:[\w.-]+@)?github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(u);
  if (!m || m[1].startsWith(".") || m[2].startsWith(".")) return null;
  return `https://github.com/${m[1]}/${m[2]}`;
}

/** What the popover asks git for: lines, or a function by name. `at` is the commit that last changed
 * the line (git blame's), and then `from` and `to` are its number in that commit: the log starts
 * there, so lines moved by changes not committed yet still get their own history. */
export type StoryOf = { from: number; to: number; at?: string } | { func: string };

/** A commit's hash as the page may send it: hex only, so never a branch name, `HEAD~1` or an option. */
export const COMMIT = /^[0-9a-f]{7,40}$/;

/** "line 26", "lines 20–28", "createTask". */
export function storyLabel(of: StoryOf): string {
  if ("func" in of) return of.func;
  return of.from === of.to ? `line ${of.from}` : `lines ${of.from}–${of.to}`;
}

/** What git is asked for, as the popover says it: "git log -L 26,26", "git log -L :createTask". */
export function storyCommand(of: StoryOf): string {
  if ("func" in of) return `git log -L :${of.func}`;
  return `git log ${of.at ? `${of.at.slice(0, 7)} ` : ""}-L ${of.from},${of.to}`;
}

/** A function's name git can look for (`-L :<name>:<path>`): a plain identifier, nothing a pattern could misread. */
export const FUNC_NAME = /^[A-Za-z_$][\w$]{0,199}$/;

/** The question the guide is asked: the story of these lines in plain English, from the commits alone.
 * `what` names them as the editor shows them: "line 26", "the function createTask". */
export function storyPrompt(path: string, what: string, story: LineStory, text?: string): string {
  const lines = [...story.changes].reverse().map((c) => {
    const parts = [`- ${c.date.slice(0, 10)} ${c.author} ${c.hash}: "${c.subject}"${c.pr ? ` (PR ${c.pr})` : ""}`];
    for (const r of c.removed) parts.push(`    took out: ${r}`);
    for (const a of c.added) parts.push(`    put in: ${a}`);
    if (c.more) parts.push(`    (and ${c.more} more lines)`);
    return parts.join("\n");
  });
  return [
    `Tell me the story of ${what} in ${path}: how it came to be as it is now, change by change, in plain English.`,
    "Go only by the commits below (and the code, if you read it). Where a commit doesn't say why, say so rather than guess. End with anything worth knowing before changing it.",
    ...(text?.trim() ? [`The code now:\n${text.slice(0, 4000)}`] : []),
    `Its commits, oldest first${story.cut ? " (older ones left out)" : ""}:\n${lines.join("\n")}`,
  ].join("\n\n");
}
