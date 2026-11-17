// A folder's file list with each file's size and time, never its text: what Explore compares with the map to
// notice a file added, changed or removed since the folder was read (src/lib/folderSync.ts). The same rules as
// both folder readers (src/lib/serverFolder.ts, src/lib/localFolder.ts): the same folders skipped, the same
// files kept as code, assets or other files, the same caps, and never a secret, not even by name. One walk for
// the disk (by path, on the server) and for a kept folder handle (in the browser): each gives `listFolder` its
// own way to list a folder. Plain code, no Node or browser APIs.
import { DOC_MAX_BYTES, isAssetPath, listsHiddenDir, MAX_ASSETS, MAX_OTHER, otherFileMode } from "@/analyzer/config/files";
import { keep, MAX_FILE_BYTES, SKIP, skipDir } from "./folderRules";
import { MAX_FILES_PER_REPO } from "./workspace";

/** How the readers take a file in: code or config with its text, an asset by path, a document with its text
 * when it is small, any other file by path. */
export type ListMode = "code" | "asset" | "doc" | "path";

export interface Listed {
  /** From the folder down, "/" between parts ("src/main.rs"). */
  path: string;
  mode: ListMode;
  /** Bytes, and the time it was last written (ms). Only code and documents are asked: an asset's or a
   * listed file's text is never read, so only its coming and going counts (size -1, time 0). */
  size: number;
  mtimeMs: number;
}

/** One thing in a folder, as the walk sees it. */
export interface ListEntry<D> {
  name: string;
  /** A folder to walk into. */
  dir?: D;
  /** A file: its size and time, asked only when they count. */
  stat?: () => Promise<{ size: number; mtimeMs: number }>;
  /** A link: never followed (it could lead out of the folder, or round in a circle). */
  link?: boolean;
}

export type ListDir<D> = (dir: D) => Promise<ListEntry<D>[]>;

const NO_STAT = { size: -1, mtimeMs: 0 };

/** Every file the readers would take in, with its size and time. `capped` as the readers: more code than one repo holds. */
export async function listFolder<D>(root: D, list: ListDir<D>): Promise<{ files: Listed[]; capped: boolean }> {
  const files: Listed[] = [];
  const n = { code: 0, assets: 0, others: 0 };
  const capped = await walk(root, "", false);
  return { files, capped };

  async function walk(dir: D, prefix: string, listOnly: boolean): Promise<boolean> {
    let entries: ListEntry<D>[];
    try {
      entries = await list(dir);
    } catch {
      return false; // a folder this user may not read is left out, as the readers do
    }
    const flutter = entries.some((e) => !e.dir && !e.link && e.name === "pubspec.yaml");
    const composer = entries.some((e) => !e.dir && !e.link && e.name === "composer.json");
    for (const e of entries) {
      if (n.code >= MAX_FILES_PER_REPO) return true;
      if (e.link) continue;
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.dir !== undefined) {
        const skip = listOnly ? SKIP.has(e.name) || (e.name.startsWith(".") && !listsHiddenDir(e.name)) : skipDir(e.name, path, { flutter, composer });
        if (skip) {
          if (!listOnly && listsHiddenDir(e.name) && (await walk(e.dir, path, true))) return true;
          continue;
        }
        if (await walk(e.dir, path, listOnly)) return true;
      } else if (e.stat) {
        if (!listOnly && !keep(path) && isAssetPath(path)) {
          if (n.assets < MAX_ASSETS) {
            n.assets++;
            files.push({ path, mode: "asset", ...NO_STAT });
          }
        } else if (!listOnly && keep(path)) {
          const s = await statOf(e);
          if (!s || s.size > MAX_FILE_BYTES) continue;
          n.code++;
          files.push({ path, mode: "code", ...s });
        } else if (n.others < MAX_OTHER) {
          const mode = otherFileMode(path);
          if (!mode) continue; // a secret: not even its name
          n.others++;
          files.push(mode === "doc" ? { path, mode, ...((await statOf(e)) ?? NO_STAT) } : { path, mode, ...NO_STAT });
        }
      }
    }
    return false;
  }
}

async function statOf<D>(e: ListEntry<D>): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const s = await e.stat!();
    return { size: s.size, mtimeMs: Math.trunc(s.mtimeMs) };
  } catch {
    return null; // unreadable: left out, as the readers do
  }
}

/** A listed file's text as the readers take it: code with its text (null when it is not text, and so left out),
 * a small document with its text, everything else by path only. */
export async function contentFor(f: Pick<Listed, "mode" | "size">, text: () => Promise<string>): Promise<string | null> {
  if (f.mode === "asset" || f.mode === "path") return "";
  if (f.mode === "doc" && f.size > DOC_MAX_BYTES) return "";
  try {
    const t = await text();
    return t.includes("\0") ? (f.mode === "doc" ? "" : null) : t;
  } catch {
    return f.mode === "doc" ? "" : null;
  }
}

/** Each listed file's size and time when the folder was last read, by path: kept with the folder (RepoSource.seen). */
export type Seen = Record<string, [size: number, mtimeMs: number]>;

export function seenOf(files: Listed[]): Seen {
  const out: Seen = {};
  for (const f of files) out[f.path] = [f.size, f.mtimeMs];
  return out;
}

export interface FolderChanges {
  /** On disk, not on the map. */
  added: string[];
  /** On the map, written to since it was read. */
  changed: string[];
  /** On the map, gone from disk. */
  removed: string[];
}

export const changeCount = (c: FolderChanges) => c.added.length + c.changed.length + c.removed.length;

/** What changed in a folder since it was read: its listing now against the files the map holds (`known`,
 * from the folder down) and the listing kept when it was last read (`seen`). A map read before listings were
 * kept has none: a file written after the folder was read (`readAt`, ms) counts as changed. */
export function diffFolder(files: Listed[], known: { paths: Iterable<string>; seen?: Seen; readAt: number }): FolderChanges {
  const onMap = new Set(known.paths);
  const out: FolderChanges = { added: [], changed: [], removed: [] };
  const here = new Set<string>();
  for (const f of files) {
    here.add(f.path);
    const was = known.seen?.[f.path];
    if (known.seen) {
      if (!was) out[onMap.has(f.path) ? "changed" : "added"].push(f.path);
      else if (was[0] !== f.size || was[1] !== f.mtimeMs) out[onMap.has(f.path) ? "changed" : "added"].push(f.path);
    } else if (!onMap.has(f.path)) out.added.push(f.path);
    else if (f.mtimeMs > known.readAt) out.changed.push(f.path);
  }
  for (const p of onMap) if (!here.has(p)) out.removed.push(p);
  return out;
}

const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const files = (n: number) => `${n} file${n === 1 ? "" : "s"}`;

/** The quiet line Explore shows once it has taken changes in: "Read 1 new file from rust: SYNTAX.md",
 * "3 files changed in rust". Null when nothing changed. */
export function changeWords(rows: { label: string; changes: FolderChanges }[]): string | null {
  const hit = rows.filter((r) => changeCount(r.changes));
  if (!hit.length) return null;
  const one = hit.length === 1 ? hit[0].label : null;
  const all: FolderChanges = { added: hit.flatMap((r) => r.changes.added), changed: hit.flatMap((r) => r.changes.changed), removed: hit.flatMap((r) => r.changes.removed) };
  const total = changeCount(all);
  const named = (list: string[]) => (list.length === 1 ? `: ${baseName(list[0])}` : "");
  if (all.added.length === total) return `Read ${all.added.length === 1 ? "1 new file" : `${all.added.length} new files`}${one ? ` from ${one}` : ""}${named(all.added)}`;
  if (all.removed.length === total) return `${files(total)} ${total === 1 ? "is" : "are"} gone${one ? ` from ${one}` : ""}${named(all.removed)}`;
  if (all.changed.length === total) return `${files(total)} changed${one ? ` in ${one}` : ""}${named(all.changed)}`;
  return `${files(total)} changed${one ? ` in ${one}` : ""}`;
}
