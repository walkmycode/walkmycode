"use client";
// Reads a folder the user picked (File System Access API) into memory and
// builds its map right here in the browser. Nothing is uploaded. Each folder
// is one repo of the workspace, read up to MAX_FILES_PER_REPO files; the
// folder handle is kept (IndexedDB can store it) so "refresh" can read the
// same folder again after the browser asks for permission.
import { isAssetPath, isConfigPath, isReadablePath, MAX_ASSETS } from "@/analyzer/config/files";
import type { SourceFile } from "@/analyzer/types";
import { MAX_FILES_PER_REPO } from "./workspace";

/** Code and manifests by name; config files (compose, Dockerfile, .env.example, ...) by path. Never a real .env. */
const KEEP = /\.(ts|tsx|js|jsx|mjs|cjs|mts|py|sql|prisma|dart|php|twig)$|(^|\/)(package\.json|pyproject\.toml|requirements\.txt|Cargo\.toml|go\.mod|pubspec\.yaml|composer\.json)$/;
// The one hidden folder read is .github/workflows, for its config files only (a deploy's health check names the app's address).
// Code in other languages (Rust, Go…) is kept too, for the guide to read and search, though the map doesn't draw it.
const keep = (path: string) => (path.startsWith(".github/") ? isConfigPath(path) : KEEP.test(path) || isConfigPath(path) || isReadablePath(path));
const HIDDEN_KEPT = /^\.github(\/workflows)?$/;
const SKIP = new Set(["node_modules", "dist", "build", "out", "target", "__pycache__", "venv", "coverage", "vendor", "storybook-static", "site-packages"]);
/** Beside a pubspec.yaml these are Flutter's platform folders: generated and native code. */
const FLUTTER_PLATFORMS = new Set(["android", "ios", "macos", "linux", "windows"]);
/** Beside a composer.json, storage/ (Laravel) and var/ (Symfony) are a PHP app's logs, sessions and compiled
 * views and container; bootstrap/cache holds Laravel's cached config and routes. All written at run time, never code. */
const PHP_RUNTIME = new Set(["storage", "var"]);
const PHP_CACHE = /(^|\/)bootstrap\/cache$/;

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
  /** The folder had more files than one repo may hold; the rest were not read. */
  capped: boolean;
}

export function canPickFolders(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function pickFolder(): Promise<PickedFolder | null> {
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
  const files: SourceFile[] = [];
  const assets: SourceFile[] = [];
  const capped = await walk(handle, "", files, assets);
  return { name: handle.name, files: [...files, ...assets], handle, capped };
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

/** Returns true when it stopped at the per-repo cap. Files an app serves as they are
 * (public/, static/) are listed apart, by path only, and do not count towards it. */
async function walk(dir: DirHandle, prefix: string, out: SourceFile[], assets: SourceFile[]): Promise<boolean> {
  const entries: FileSystemHandle[] = [];
  for await (const h of dir.values()) entries.push(h);
  const flutter = entries.some((h) => h.kind === "file" && h.name === "pubspec.yaml");
  const composer = entries.some((h) => h.kind === "file" && h.name === "composer.json");
  for (const h of entries) {
    if (out.length >= MAX_FILES_PER_REPO) return true;
    const path = prefix ? `${prefix}/${h.name}` : h.name;
    if (h.kind === "directory") {
      if (SKIP.has(h.name) || (h.name.startsWith(".") && !HIDDEN_KEPT.test(path)) || (flutter && FLUTTER_PLATFORMS.has(h.name))) continue;
      if ((composer && PHP_RUNTIME.has(h.name)) || PHP_CACHE.test(path)) continue;
      if (await walk(h as DirHandle, path, out, assets)) return true;
    } else if (!keep(path) && isAssetPath(path)) {
      if (assets.length < MAX_ASSETS) assets.push({ path, content: "" });
    } else if (keep(path)) {
      const file = await (h as FileSystemFileHandle).getFile();
      if (file.size > 2_000_000) continue;
      const content = await file.text();
      if (content.includes("\0")) continue;
      out.push({ path, content });
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
    // Hidden folders are skipped (but .github/workflows); a hidden file (.env.example) is judged by keep().
    if (!/^\.github\/workflows\/[^/]+$/.test(path) && parts.slice(0, -1).some((p) => SKIP.has(p) || (p.startsWith(".") && p.length > 1))) continue;
    if (parts.slice(0, -1).some((p, i) => FLUTTER_PLATFORMS.has(p) && flutterDirs.has(parts.slice(0, i).join("/")))) continue;
    if (parts.slice(0, -1).some((p, i) => (PHP_RUNTIME.has(p) && composerDirs.has(parts.slice(0, i).join("/"))) || PHP_CACHE.test(parts.slice(0, i + 1).join("/")))) continue;
    // A file the app serves as it is: its path only, apart from the code.
    if (!keep(path) && isAssetPath(path)) {
      if (assets.length < MAX_ASSETS) assets.push({ path, content: "" });
      continue;
    }
    if (!keep(path) || f.size > 2_000_000) continue;
    if (files.length >= MAX_FILES_PER_REPO) {
      capped = true;
      break;
    }
    const content = await f.text();
    if (!content.includes("\0")) files.push({ path, content });
  }
  return { name, files: [...files, ...assets], capped };
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
        if (!SKIP.has(e.name) && !e.name.startsWith(".")) await filesUnder(e as FileSystemDirectoryEntry, path, acc);
        continue;
      }
      const file = await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej));
      if (keep(path.slice(path.indexOf("/") + 1))) acc.kept++;
      acc.out.push({ file, rel: path });
    }
  }
  return acc.out;
}
