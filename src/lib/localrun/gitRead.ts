// Line history in the desktop app without "run code on this computer" (POST /api/git/read): who last
// changed each line of one file (git blame), the file's own commits (git log), how one line or one
// function got to be as it is (git log -L, "line-log"), and how often each file of the folder changed
// over a span for Hotspots (git log, src/lib/hotspots.ts), read with the user's own git from the folder
// the desktop app opened. And for "Tour a change" (docs/GIT.md): the branches a change can be measured
// against (bases), and the change itself, its counts and its diff (change). Only those, all read-only:
// nothing is written, nothing of the project's runs, no terminal. Everything else git does (status,
// commit, push…) still goes through the local-run socket and its consent (src/lib/localrun/hub.ts).
//
// Refused unless this server is the desktop app's own (WALKMYCODE_DESKTOP, set by src-tauri's
// server.rs; `npm run desktop:dev` sets it by hand), and in hosted mode. The route wraps it in
// guarded(): loopback + same-origin + JSON, like every route that touches this computer. The file
// must be inside the folder (git.locate refuses `..` and anything outside it).
//
// git is run so that a repo's own settings can't make it start a program (readOnlyExec): no
// file-system monitor (core.fsmonitor), blame, a line's log and a diff without text-conversion
// filters (--no-textconv), a diff without an external diff program (--no-ext-diff), and every
// clean/smudge filter driver git knows there switched off by name before anything that reads the
// working tree. A line's log is given whole line numbers inside the file, or a function's plain
// name; git.lineLog checks both, limits the commits and gives git a time limit. A base the page
// names must look like a branch (never an option or a range) and be a commit git finds (./git.ts,
// change).
import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";
import type { ChangeBases, RangeChange } from "../diffParse";
import { SPANS, type Churn } from "../hotspots";
import { createGit, readOnlyExec, type Exec, type GitBlameHunk, type GitFileCommit } from "./git";
import { hostedRefusal } from "./hub";
import { COMMIT, type LineStory } from "./lineStory";

export { readOnlyExec };

/** The folder the desktop app opened (absolute). */
const Folder = z.string().min(1).max(4096);
/** The file, as the map names it: from the folder, or starting with the folder's label. */
const FilePath = z.string().min(1).max(4096);
const Body = z.discriminatedUnion("op", [
  z.object({ op: z.enum(["blame", "file-log"]), folder: Folder, path: FilePath }).strict(),
  z
    .object({
      op: z.literal("line-log"),
      folder: Folder,
      path: FilePath,
      /** The lines, from 1 (one line: from = to), or a function's name. */
      from: z.number().int().min(1).max(10_000_000).optional(),
      to: z.number().int().min(1).max(10_000_000).optional(),
      func: z.string().min(1).max(200).optional(),
      /** The commit that last changed the line (git blame's), then from/to are its number there. */
      at: z.string().regex(COMMIT).optional(),
    })
    .strict(),
  z.object({ op: z.literal("bases"), folder: Folder }).strict(),
  /** `base` null: the changes not committed yet. */
  z.object({ op: z.literal("change"), folder: Folder, base: z.string().min(1).max(200).nullable() }).strict(),
  // Hotspots: the whole folder's history over one of the fixed spans, never a date or range the page makes up.
  z.object({ op: z.literal("churn"), folder: Folder, span: z.enum(SPANS) }).strict(),
]);

export type GitReadOp = z.infer<typeof Body>["op"];

/** What the page gets back. `located` false: the file (or the folder) isn't in a git repo. */
export interface GitRead {
  ok: boolean;
  located: boolean;
  blame?: GitBlameHunk[];
  me?: string;
  history?: GitFileCommit[];
  /** line-log: the commits that changed the line, newest first. */
  story?: LineStory;
  /** "bases": what a change can be toured against. */
  bases?: ChangeBases;
  /** "change": the change itself. */
  change?: RangeChange;
  /** "churn": how often each file changed over the span (Hotspots). */
  churn?: Churn;
  output?: string;
}

export const DESKTOP_ONLY = "Reading git without running code is for the desktop app only.";

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

export function gitReadHandler(o: { env?: Record<string, string | undefined>; exec?: Exec } = {}) {
  const git = createGit(readOnlyExec(o.exec));
  return async (req: Request): Promise<Response> => {
    const env = o.env ?? process.env;
    if (!env.WALKMYCODE_DESKTOP?.trim()) return Response.json({ error: DESKTOP_ONLY }, { status: 403 });
    const refusal = hostedRefusal(env);
    if (refusal) return Response.json({ error: refusal }, { status: 403 });
    const p = Body.safeParse(await req.json().catch(() => null));
    if (!p.success) return Response.json({ error: 'Send { op: "blame" | "file-log" | "line-log", folder, path }, { op: "bases", folder }, { op: "change", folder, base } or { op: "churn", folder, span: "30" | "90" | "365" | "all" }.' }, { status: 400 });
    const asked = p.data;
    const folder = asked.folder;
    if (asked.op === "line-log" && (!asked.func === !asked.from || (asked.to !== undefined && !asked.from) || (asked.at !== undefined && !asked.from))) return Response.json({ error: "A line's history needs its line (from, to) or a function's name (func)." }, { status: 400 });
    if (!isAbsolute(folder) || !isDir(folder)) return Response.json({ error: "That folder isn't on this computer." }, { status: 400 });
    if (asked.op === "churn") {
      const c = await git.churn(folder, asked.span);
      return Response.json((c.ok ? { ok: true, located: true, churn: c.churn } : { ok: false, located: c.located, output: c.output }) satisfies GitRead);
    }
    if (asked.op === "bases" || asked.op === "change") {
      const root = await git.rootOf([folder]);
      if (!root) return Response.json({ ok: false, located: false, output: "This project's folder isn't in a git repo." } satisfies GitRead);
      const r = asked.op === "bases" ? await git.changeBases(root) : await git.change(root, asked.base);
      if ("error" in r) return Response.json({ ok: false, located: true, output: r.error } satisfies GitRead);
      return Response.json((asked.op === "bases" ? { ok: true, located: true, bases: r as ChangeBases } : { ok: true, located: true, change: r as RangeChange }) satisfies GitRead);
    }
    const { op, path } = asked;
    const at = await git.locate([folder], path);
    if (!at) return Response.json({ ok: false, located: false, output: `${path} isn't in a git repo in this project's folder.` } satisfies GitRead);
    if (asked.op === "line-log") {
      const { from, to, func, at: commit } = asked;
      const l = await git.lineLog(at.top, at.rel, func ? { func } : { from: from!, to: to ?? from!, ...(commit ? { at: commit } : {}) });
      return Response.json((l.ok ? { ok: true, located: true, story: l.story } : { ok: false, located: true, output: l.output }) satisfies GitRead);
    }
    if (op === "file-log") return Response.json({ ok: true, located: true, history: await git.fileLog(at.top, at.rel) } satisfies GitRead);
    const b = await git.blame(at.top, at.rel);
    return Response.json((b.ok ? { ok: true, located: true, blame: b.hunks, me: b.me } : { ok: false, located: true, output: b.output }) satisfies GitRead);
  };
}
