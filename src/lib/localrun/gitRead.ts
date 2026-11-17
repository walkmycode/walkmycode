// Line history in the desktop app without "run code on this computer" (POST /api/git/read): who last
// changed each line of one file (git blame) and the file's own commits (git log), read with the
// user's own git from the folder the desktop app opened. Only those two, both read-only: nothing is
// written, nothing of the project's runs, no terminal. Everything else git does (status, commit,
// push…) still goes through the local-run socket and its consent (src/lib/localrun/hub.ts).
//
// Refused unless this server is the desktop app's own (WALKMYCODE_DESKTOP, set by src-tauri's
// server.rs; `npm run desktop:dev` sets it by hand), and in hosted mode. The route wraps it in
// guarded(): loopback + same-origin + JSON, like every route that touches this computer. The file
// must be inside the folder (git.locate refuses `..` and anything outside it).
//
// git is run so that a repo's own settings can't make it start a program: no file-system monitor
// (core.fsmonitor) and blame without text-conversion filters (--no-textconv).
import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { createGit, runGit, type Exec, type GitBlameHunk, type GitFileCommit } from "./git";
import { hostedRefusal } from "./hub";

const Body = z
  .object({
    op: z.enum(["blame", "file-log"]),
    /** The folder the desktop app opened (absolute). */
    folder: z.string().min(1).max(4096),
    /** The file, as the map names it: from the folder, or starting with the folder's label. */
    path: z.string().min(1).max(4096),
  })
  .strict();

export type GitReadOp = z.infer<typeof Body>["op"];

/** What the page gets back. `located` false: the file isn't in a git repo in that folder. */
export interface GitRead {
  ok: boolean;
  located: boolean;
  blame?: GitBlameHunk[];
  me?: string;
  history?: GitFileCommit[];
  output?: string;
}

export const DESKTOP_ONLY = "Line history without running code is for the desktop app only.";

/** git as this route runs it: no file-system monitor, and blame without text conversion. */
export function readOnlyExec(exec: Exec = runGit): Exec {
  return (args, cwd, timeoutMs) => {
    const a = args[0] === "blame" ? ["blame", "--no-textconv", ...args.slice(1)] : args;
    return exec(["-c", "core.fsmonitor=false", ...a], cwd, timeoutMs);
  };
}

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
    if (!p.success) return Response.json({ error: 'Send { op: "blame" | "file-log", folder, path }.' }, { status: 400 });
    const { op, folder, path } = p.data;
    if (!isAbsolute(folder) || !isDir(folder)) return Response.json({ error: "That folder isn't on this computer." }, { status: 400 });
    const at = await git.locate([folder], path);
    if (!at) return Response.json({ ok: false, located: false, output: `${path} isn't in a git repo in this project's folder.` } satisfies GitRead);
    if (op === "file-log") return Response.json({ ok: true, located: true, history: await git.fileLog(at.top, at.rel) } satisfies GitRead);
    const b = await git.blame(at.top, at.rel);
    return Response.json((b.ok ? { ok: true, located: true, blame: b.hunks, me: b.me } : { ok: false, located: true, output: b.output }) satisfies GitRead);
  };
}
