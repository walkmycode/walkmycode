// Reads a folder on this computer by its path, with the same rules as the browser's
// reader (src/lib/folderRules.ts, src/lib/localFolder.ts): the desktop app's "Choose a
// folder" opens the system's folder picker, which gives a path, not a handle the page
// could read (docs/DESKTOP.md, "Folders"). What comes back is the same picked folder,
// so it goes on through the same open-a-folder flow.
import "server-only";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { DOC_MAX_BYTES, isAssetPath, listsHiddenDir, MAX_ASSETS, MAX_OTHER, otherFileMode } from "@/analyzer/config/files";
import type { SourceFile } from "@/analyzer/types";
import { keep, MAX_FILE_BYTES, SKIP, skipDir } from "./folderRules";
import { MAX_FILES_PER_REPO } from "./workspace";

export interface ReadFolder {
  name: string;
  /** The folder's absolute path, to read it again. */
  path: string;
  files: SourceFile[];
  capped: boolean;
}

/** The folder at `path`, or why it can't be read. */
export async function readFolderAt(path: string): Promise<ReadFolder | { error: string }> {
  if (!path || !isAbsolute(path)) return { error: "That is not a folder's full path." };
  const root = resolve(path);
  try {
    if (!(await stat(root)).isDirectory()) return { error: `${root} is not a folder.` };
  } catch {
    return { error: `${root} could not be opened.` };
  }
  const files: SourceFile[] = [];
  const assets: SourceFile[] = [];
  const others: SourceFile[] = [];
  const capped = await walk(root, "", { out: files, assets, others }, false);
  return { name: basename(root) || root, path: root, files: [...files, ...assets, ...others], capped };
}

interface Found {
  out: SourceFile[];
  assets: SourceFile[];
  /** Every other file (README.md, LICENSE, images…): small text documents with their text, the rest as paths. */
  others: SourceFile[];
}

/** Returns true when it stopped at the per-repo cap. In a hidden folder (.vscode, .husky…) `listOnly`: its files are listed, never read as code. */
async function walk(dir: string, prefix: string, found: Found, listOnly: boolean): Promise<boolean> {
  const { out, assets, others } = found;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return false; // a folder this user may not read is left out, as the browser's picker does
  }
  const flutter = entries.some((e) => e.isFile() && e.name === "pubspec.yaml");
  const composer = entries.some((e) => e.isFile() && e.name === "composer.json");
  for (const e of entries) {
    if (out.length >= MAX_FILES_PER_REPO) return true;
    const path = prefix ? `${prefix}/${e.name}` : e.name;
    // Links are not followed: one could lead out of the folder, or round in a circle.
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (listOnly ? SKIP.has(e.name) || !listsHiddenDirOrPlain(e.name) : skipDir(e.name, path, { flutter, composer })) {
        if (!listOnly && listsHiddenDir(e.name) && (await walk(join(dir, e.name), path, found, true))) return true;
        continue;
      }
      if (await walk(join(dir, e.name), path, found, listOnly)) return true;
    } else if (e.isFile()) {
      const full = join(dir, e.name);
      if (!listOnly && !keep(path) && isAssetPath(path)) {
        if (assets.length < MAX_ASSETS) assets.push({ path, content: "" });
      } else if (!listOnly && keep(path)) {
        try {
          if ((await stat(full)).size > MAX_FILE_BYTES) continue;
          const content = await readFile(full, "utf8");
          if (!content.includes("\0")) out.push({ path, content });
        } catch {
          // unreadable: left out
        }
      } else if (others.length < MAX_OTHER) {
        const mode = otherFileMode(path);
        if (mode) others.push({ path, content: mode === "doc" ? await readDoc(full) : "" });
      }
    }
  }
  return false;
}

/** Inside a hidden folder: its plain folders are walked too, its hidden ones only if they may be listed. */
const listsHiddenDirOrPlain = (name: string) => !name.startsWith(".") || listsHiddenDir(name);

/** A document's text, or "" when it is too big, binary or unreadable (it is still listed). */
async function readDoc(full: string): Promise<string> {
  try {
    if ((await stat(full)).size > DOC_MAX_BYTES) return "";
    const text = await readFile(full, "utf8");
    return text.includes("\0") ? "" : text;
  } catch {
    return "";
  }
}
