"use client";
// Reads a folder the user picked (File System Access API) into memory and
// builds its map right here in the browser. Nothing is uploaded. Each folder
// is one repo of the workspace, read up to MAX_FILES_PER_REPO files; the
// folder handle is kept (IndexedDB can store it) so "refresh" can read the
// same folder again after the browser asks for permission.
// In the desktop app (docs/DESKTOP.md) the system's folder picker gives a path
// instead, and the server reads it with the same rules (src/lib/serverFolder.ts).
import { DOC_MAX_BYTES, isAssetPath, listsHiddenDir, MAX_ASSETS, MAX_OTHER, otherFileMode } from "@/analyzer/config/files";
import type { SourceFile } from "@/analyzer/types";
import { FLUTTER_PLATFORMS, keep, MAX_FILE_BYTES, PHP_CACHE, PHP_RUNTIME, SKIP, skipDir } from "./folderRules";
import { isDesktop, pickFolderPath } from "./desktop";
import { MAX_FILES_PER_REPO } from "./workspace";

type DirHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemHandle>;
  queryPermission?(o: { mode: "read" }): Promise<PermissionState>;
  requestPermission?(o: { mode: "read" }): Promise<PermissionState>;
};

export interface PickedFolder {
  name: string;
  files: SourceFile[];
  /** Only with the folder picker: lets "refresh" read the folder again. */
  handle?: FileSystemDirectoryHandle;
  /** Only in the desktop app: the folder's path on disk, so "refresh" can read it again. */
  path?: string;
  /** The folder had more files than one repo may hold; the rest were not read. */
  capped: boolean;
}

export function canPickFolders(): boolean {
  return typeof window !== "undefined" && ("showDirectoryPicker" in window || isDesktop());
}

export async function pickFolder(): Promise<PickedFolder | null> {
  if (isDesktop()) {
    const path = await pickFolderPath();
    return path ? readPath(path) : null;
  }
  const w = window as unknown as { showDirectoryPicker?: (o?: { mode?: string }) => Promise<DirHandle> };
  if (!w.showDirectoryPicker) return null;
  let handle: DirHandle;
  try {
    handle = await w.showDirectoryPicker({ mode: "read" });
  } catch {
    return null; // cancelled
  }
  return readHandle(handle);
}

async function readHandle(handle: DirHandle): Promise<PickedFolder> {
  const found: Found = { out: [], assets: [], others: [] };
  const capped = await walk(handle, "", found, false);
  return { name: handle.name, files: [...found.out, ...found.assets, ...found.others], handle, capped };
}

/** The desktop app's folder, read by the server from its path. Throws with the server's reason. */
export async function readPath(path: string): Promise<PickedFolder> {
  const r = await fetch("/api/folder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) });
  const body = (await r.json().catch(() => ({}))) as Partial<PickedFolder> & { error?: string };
  if (!r.ok || !body.files) throw new Error(body.error ?? `${path} could not be read.`);
  return { name: body.name ?? path, files: body.files, path: body.path ?? path, capped: !!body.capped };
}

/** Read a folder picked earlier again. Null when the browser (or the user) says no. */
export async function rereadFolder(handle: FileSystemDirectoryHandle): Promise<PickedFolder | null> {
  const h = handle as DirHandle;
  try {
    let state = (await h.queryPermission?.({ mode: "read" })) ?? "granted";
    if (state !== "granted") state = (await h.requestPermission?.({ mode: "read" })) ?? "denied";
    if (state !== "granted") return null;
    return await readHandle(h);
  } catch {
    return null;
  }
}

interface Found {
  out: SourceFile[];
  assets: SourceFile[];
  /** Every other file (README.md, LICENSE, images…): small text documents with their text, the rest as paths (MAX_OTHER). */
  others: SourceFile[];
}

/** A file that is neither code, config nor an asset: listed, with its text when it is a small document; never a secret. */
async function other(found: Found, path: string, file: () => Promise<File>): Promise<void> {
  if (found.others.length >= MAX_OTHER) return;
  const mode = otherFileMode(path);
  if (!mode) return;
  let content = "";
  if (mode === "doc") {
    try {
      const f = await file();
      if (f.size <= DOC_MAX_BYTES) content = await f.text();
      if (content.includes("\0")) content = "";
    } catch {
      content = "";
    }
  }
  found.others.push({ path, content });
}

/** Returns true when it stopped at the per-repo cap. Files an app serves as they are
 * (public/, static/) are listed apart, by path only, and do not count towards it; so is every other file.
 * In a hidden folder (.vscode, .husky…) `listOnly`: its files are listed, never read as code. */
async function walk(dir: DirHandle, prefix: string, found: Found, listOnly: boolean): Promise<boolean> {
  const { out, assets } = found;
  const entries: FileSystemHandle[] = [];
  for await (const h of dir.values()) entries.push(h);
  const flutter = entries.some((h) => h.kind === "file" && h.name === "pubspec.yaml");
  const composer = entries.some((h) => h.kind === "file" && h.name === "composer.json");
  for (const h of entries) {
    if (out.length >= MAX_FILES_PER_REPO) return true;
    const path = prefix ? `${prefix}/${h.name}` : h.name;
    if (h.kind === "directory") {
      const skip = listOnly ? SKIP.has(h.name) || (h.name.startsWith(".") && !listsHiddenDir(h.name)) : skipDir(h.name, path, { flutter, composer });
      if (skip) {
        if (!listOnly && listsHiddenDir(h.name) && (await walk(h as DirHandle, path, found, true))) return true;
        continue;
      }
      if (await walk(h as DirHandle, path, found, listOnly)) return true;
    } else if (!listOnly && !keep(path) && isAssetPath(path)) {
      if (assets.length < MAX_ASSETS) assets.push({ path, content: "" });
    } else if (!listOnly && keep(path)) {
      const file = await (h as FileSystemFileHandle).getFile();
      if (file.size > MAX_FILE_BYTES) continue;
      const content = await file.text();
      if (content.includes("\0")) continue;
      out.push({ path, content });
    } else {
      await other(found, path, () => (h as FileSystemFileHandle).getFile());
    }
  }
  return false;
}

/** Fallback for browsers without the picker: <input type="file" webkitdirectory>. */
export async function filesFromInputAsync(list: FileList): Promise<PickedFolder> {
  const relOf = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
  return filesFromListAsync(Array.from(list, (file) => ({ file, rel: relOf(file) })));
}

/** Files with their paths from the folder's own name down ("app/src/x.ts"), read with the picker's rules. */
async function filesFromListAsync(list: { file: File; rel: string }[]): Promise<PickedFolder> {
  const files: SourceFile[] = [];
  const assets: SourceFile[] = [];
  const found: Found = { out: files, assets, others: [] };
  let name = "folder";
  let capped = false;
  // Folders holding a pubspec.yaml: their android/, ios/, ... are Flutter's platform folders.
  const flutterDirs = new Set(list.map((x) => x.rel).filter((r) => r.endsWith("/pubspec.yaml")).map((r) => r.slice(0, -"/pubspec.yaml".length)));
  // Folders holding a composer.json: their storage/ is written at run time.
  const composerDirs = new Set(list.map((x) => x.rel).filter((r) => r.endsWith("/composer.json")).map((r) => r.slice(0, -"/composer.json".length)));
  for (const { file: f, rel } of list) {
    const parts = rel.split("/");
    name = parts[0];
    const path = parts.slice(1).join("/");
    const dirs = parts.slice(1, -1);
    // Never: build output and installs, nor .git or a cache. A file in another hidden folder (.vscode, .husky…) is
    // listed only, but .github/workflows' config; a hidden file (.env.example, .gitignore) is judged like any other.
    if (dirs.some((p) => SKIP.has(p) || (p.startsWith(".") && p.length > 1 && !listsHiddenDir(p)))) continue;
    const inHidden = !/^\.github\/workflows\/[^/]+$/.test(path) && dirs.some((p) => p.startsWith(".") && p.length > 1);
    if (parts.slice(0, -1).some((p, i) => FLUTTER_PLATFORMS.has(p) && flutterDirs.has(parts.slice(0, i).join("/")))) continue;
    if (parts.slice(0, -1).some((p, i) => (PHP_RUNTIME.has(p) && composerDirs.has(parts.slice(0, i).join("/"))) || PHP_CACHE.test(parts.slice(0, i + 1).join("/")))) continue;
    // A file the app serves as it is: its path only, apart from the code.
    if (!inHidden && !keep(path) && isAssetPath(path)) {
      if (assets.length < MAX_ASSETS) assets.push({ path, content: "" });
      continue;
    }
    if (inHidden || !keep(path)) {
      await other(found, path, async () => f);
      continue;
    }
    if (f.size > MAX_FILE_BYTES) continue;
    if (files.length >= MAX_FILES_PER_REPO) {
      capped = true;
      break;
    }
    const content = await f.text();
    if (!content.includes("\0")) files.push({ path, content });
  }
  return { name, files: [...files, ...assets, ...found.others], capped };
}

/** Folders dropped on the page (WalkMyCode Lite, inside Claude, has no folder picker): one
 * picked folder per dropped folder, read with the same rules. Call it during the drop
 * event itself; the browser lets go of the dropped items once the event is over. */
export function foldersFromDrop(dt: DataTransfer): Promise<PickedFolder[]> {
  return foldersFromEntries(Array.from(dt.items, (i) => (i.kind === "file" ? i.webkitGetAsEntry() : null)));
}

/** The dropped folders' entries, taken during the drop (src/lib/dropped.ts), read now. */
export function foldersFromEntries(entries: (FileSystemEntry | null)[]): Promise<PickedFolder[]> {
  const roots = entries.filter((e): e is FileSystemDirectoryEntry => !!e?.isDirectory);
  return Promise.all(roots.map(async (root) => filesFromListAsync(await filesUnder(root, root.name, { kept: 0, out: [] }))));
}

/** A drop the browser also handed over as handles (Chromium): read like a picked folder, so the
 * handle is kept and "refresh" works. Null when there were no handles, or one could not be had. */
export async function foldersFromHandles(handles: Promise<FileSystemHandle | null>[] | null): Promise<PickedFolder[] | null> {
  if (!handles?.length) return null;
  try {
    const got = await Promise.all(handles);
    const dirs = got.filter((h): h is FileSystemDirectoryHandle => h?.kind === "directory");
    return await Promise.all(dirs.map((d) => readHandle(d as DirHandle)));
  } catch {
    return null;
  }
}

/** Every file under a dropped folder, without walking into the folders WalkMyCode skips, and
 * stopping once more files than one repo may hold have been found (the reader marks it capped). */
async function filesUnder(dir: FileSystemDirectoryEntry, rel: string, acc: { kept: number; out: { file: File; rel: string }[] }) {
  const reader = dir.createReader();
  const batch = () => new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
  for (let entries = await batch(); entries.length && acc.kept <= MAX_FILES_PER_REPO; entries = await batch()) {
    for (const e of entries) {
      if (acc.kept > MAX_FILES_PER_REPO) break;
      const path = `${rel}/${e.name}`;
      if (e.isDirectory) {
        if (!SKIP.has(e.name) && (!e.name.startsWith(".") || listsHiddenDir(e.name))) await filesUnder(e as FileSystemDirectoryEntry, path, acc);
        continue;
      }
      const file = await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej));
      if (keep(path.slice(path.indexOf("/") + 1))) acc.kept++;
      acc.out.push({ file, rel: path });
    }
  }
  return acc.out;
}
