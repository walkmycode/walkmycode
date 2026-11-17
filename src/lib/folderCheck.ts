// Explore notices a file added, changed or removed in the folders a map was made from, and takes it in where
// the user is (src/shell/folderWatch.tsx). This is the check: each folder listed again with sizes and times
// only (src/lib/folderList.ts), compared with the map, then only the files that changed read, and the map
// built again in place (src/lib/remap.ts updateInPlace). The desktop app's folders are listed by the server
// from their path (/api/folder/list); a browser's by their kept handle, only where the browser already lets the
// page read it. WalkMyCode for Claude (its server made the map) and indexed maps are never checked.
import { redactSource } from "@/analyzer/config/files";
import type { SourceFile } from "@/analyzer/types";
import type { Target } from "./adapters/target";
import { changeCount, changeWords, diffFolder, seenOf, type FolderChanges, type Listed } from "./folderList";
import { knownFiles, repoRefs, updateInPlace, type Build, type FolderUpdate } from "./remap";
import type { RepoSource, Workspace } from "./store";

/** How a folder is listed and read again. */
export interface FolderIo {
  /** The folder's list now, or null when it can't be had (gone, or the browser does not let the page read it).
   * `ask`: the user clicked, so the browser may ask for permission; never on a timer. */
  list(r: RepoSource, ask: boolean): Promise<Listed[] | null>;
  /** The text of these listed files (a file that is not text is left out). */
  read(r: RepoSource, files: Listed[]): Promise<SourceFile[]>;
}

/** The folders this app reads: by path on the server (desktop app, npm run dev), by a kept handle in the browser. */
export const folderIo: FolderIo = {
  async list(r, ask) {
    const lf = await import("./localFolder");
    try {
      if (r.path) return (await lf.listPath(r.path)).files;
      if (r.handle) return (await lf.listHandle(r.handle, { ask }))?.files ?? null;
    } catch {
      // moved, deleted or refused: the map stays as it is
    }
    return null;
  },
  async read(r, files) {
    const lf = await import("./localFolder");
    if (r.path) return (await lf.listPath(r.path, files.map((f) => f.path))).read ?? [];
    if (r.handle) return lf.readHandleFiles(r.handle, files);
    return [];
  },
};

/** Whether Explore checks this workspace's folders: not on WalkMyCode for Claude's page, not an indexed map,
 * and only with a folder it can read again by itself. */
export function canCheck(w: Pick<Workspace, "repos" | "map" | "codeElsewhere">, target: Target): boolean {
  if (target === "mcp" || w.codeElsewhere) return false;
  if (w.map.repos.some((r) => r.kind === "cli")) return false;
  return w.repos.some((r) => !!(r.path || r.handle));
}

export interface Checked {
  /** The workspace to keep: changes taken in (or only the folders' new listings), or null when nothing changed. */
  workspace: Workspace | null;
  /** The toast: "Read 1 new file from rust: SYNTAX.md". Null when nothing the map holds changed. */
  words: string | null;
  /** Map paths of files gone: their open tabs close. */
  removed: string[];
  /** Folders listed, and the labels of those that could not be. */
  listed: number;
  unread: string[];
}

/** Check every folder of `w` once, and take its changes in. */
export async function checkFolders(w: Workspace, io: FolderIo, build: Build, opts: { ask: boolean; now?: Date }): Promise<Checked> {
  const refs = repoRefs(w);
  const updates: (FolderUpdate | null)[] = w.repos.map(() => null);
  const rows: { label: string; changes: FolderChanges }[] = [];
  const removed: string[] = [];
  const unread: string[] = [];
  let listed = 0;
  let real = 0;
  for (const [i, r] of w.repos.entries()) {
    if (!r.path && !r.handle) continue;
    const files = await io.list(r, opts.ask);
    if (!files) {
      unread.push(r.label);
      continue;
    }
    listed++;
    const known = knownFiles(w, i);
    const diff = diffFolder(files, { paths: known.paths, seen: r.seen, readAt: Date.parse(r.readAt ?? r.addedAt) || 0 });
    if (!diff.added.length && !diff.changed.length && !diff.removed.length) continue;
    // Secrets are named on the map, never read: a changed one changes nothing.
    const secret = new Set(known.secrets);
    const want = new Set([...diff.added, ...diff.changed].filter((p) => !secret.has(p)));
    const read = want.size ? await io.read(r, files.filter((f) => want.has(f.path))) : [];
    const text = new Map(read.map((f) => [f.path, f.content]));
    const prefix = refs[i]?.prefix ?? "";
    const kept = (p: string) => w.files[prefix + p];
    // What the map takes in: a new file that is text, a file whose text is new (not a save made here, nor a
    // file only touched), and a file gone or no longer text.
    const taken: FolderChanges = {
      added: diff.added.filter((p) => text.has(p) && kept(p) === undefined),
      changed: [...diff.changed, ...diff.added].filter((p) => text.has(p) && kept(p) !== undefined && redactSource(prefix + p, text.get(p)!) !== kept(p)),
      removed: [...diff.removed, ...[...want].filter((p) => !text.has(p) && kept(p) !== undefined)],
    };
    real += changeCount(taken);
    updates[i] = { files: read, removed: taken.removed, seen: seenOf(files) };
    // A secret is never named, not even when it is gone.
    rows.push({ label: r.label, changes: { ...taken, removed: taken.removed.filter((p) => !secret.has(p)) } });
    removed.push(...taken.removed.map((p) => prefix + p));
  }
  const words = changeWords(rows);
  if (!updates.some(Boolean)) return { workspace: null, words: null, removed: [], listed, unread };
  if (!real) {
    // Only touched, or not text: nothing on the map changes, but the folders' listings are kept, so the same
    // files are not read again next time.
    const at = (opts.now ?? new Date()).toISOString();
    return { workspace: { ...w, repos: w.repos.map((r, i) => (updates[i] ? { ...r, readAt: at, seen: updates[i]!.seen } : r)) }, words: null, removed: [], listed, unread };
  }
  return { workspace: await updateInPlace(w, updates, build, opts.now), words, removed, listed, unread };
}
