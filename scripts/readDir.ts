// Reads a folder from disk into SourceFile[] the way the CLI indexer does.
// Shared with the tests so the fixtures are read with the same keepsCode/SKIP
// rules as a real run.
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { DOC_MAX_BYTES, drawnLang, isAssetPath, isConfigPath, isReadablePath, listsHiddenDir, MAX_ASSETS, MAX_OTHER, otherFileMode } from "../src/analyzer/config/files";
import type { SourceFile } from "../src/analyzer/types";

const MANIFEST = /(^|[\\/])(package\.json|pyproject\.toml|requirements\.txt|Cargo\.toml|go\.mod|pubspec\.yaml|composer\.json)$/;
/** Code the map draws (by its language: config/files.ts DRAWN) and manifests; config files (compose, Dockerfile,
 * .env.example, ...) are kept by isConfigPath. Never a real .env. */
export const keepsCode = (path: string): boolean => drawnLang(path) !== null || MANIFEST.test(path);
export const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "target", "__pycache__", ".venv", "venv", "coverage", ".turbo", ".cache", "vendor", ".walkmycode", ".lantern", "storybook-static", ".pytest_cache", ".mypy_cache"]);
/** Beside a pubspec.yaml these are Flutter's platform folders: generated and native code. */
export const FLUTTER_PLATFORMS = new Set(["android", "ios", "macos", "linux", "windows"]);
/** Beside a composer.json, storage/ (Laravel) and var/ (Symfony) are a PHP app's logs, sessions and compiled
 * views and container; bootstrap/cache holds Laravel's cached config and routes. All written at run time, never code. */
export const PHP_RUNTIME = new Set(["storage", "var"]);
export const PHP_CACHE = /(^|\/)bootstrap\/cache$/;
/** The one hidden folder read: GitHub Actions workflows, kept as config files only (a deploy's health check names the app's address). */
export const HIDDEN_KEPT = /^\.github(\/workflows)?$/;

/** A folder holds more code than the caller agreed to read (readDir's `maxFiles`). */
export class TooManyFilesError extends Error {
  constructor(readonly limit: number) {
    super(`more than ${limit} code and config files`);
    this.name = "TooManyFilesError";
  }
}

/** `maxFiles` (default: no limit) stops the walk with TooManyFilesError once that many code and config files are read. */
export async function readDir(root: string, opts: { maxFiles?: number } = {}): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  const assets: SourceFile[] = [];
  const others: SourceFile[] = [];
  await walk(root, root, { out, assets, others }, opts.maxFiles ?? Infinity, false);
  return [...out, ...assets, ...others];
}

interface Found {
  out: SourceFile[];
  assets: SourceFile[];
  /** Every other file (README.md, LICENSE, images…), for Files: small documents with their text, the rest as paths. */
  others: SourceFile[];
}

/** Listed, with its text when it is a small document; never a secret. */
async function other(found: Found, rel: string, full: string): Promise<void> {
  if (found.others.length >= MAX_OTHER) return;
  const mode = otherFileMode(rel);
  if (!mode) return;
  let content = "";
  if (mode === "doc") {
    try {
      if ((await stat(full)).size <= DOC_MAX_BYTES) content = await readFile(full, "utf8");
      if (content.includes("\0")) content = "";
    } catch {
      content = "";
    }
  }
  found.others.push({ path: rel, content });
}

/** In a hidden folder (.vscode, .husky…) `listOnly`: its files are listed, never read as code. */
async function walk(root: string, dir: string, found: Found, max: number, listOnly: boolean) {
  const { out, assets } = found;
  const entries = await readdir(dir, { withFileTypes: true });
  const flutter = entries.some((e) => e.isFile() && e.name === "pubspec.yaml");
  const composer = entries.some((e) => e.isFile() && e.name === "composer.json");
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = relative(root, full).split("\\").join("/");
    if (entry.isDirectory()) {
      const hidden = entry.name.startsWith(".");
      // Never: installs, build output, .git and caches (SKIP's hidden names are ones listsHiddenDir refuses too).
      if (SKIP.has(entry.name) || (hidden && !listsHiddenDir(entry.name))) continue;
      const runtime = (composer && PHP_RUNTIME.has(entry.name)) || PHP_CACHE.test(rel);
      if ((flutter && FLUTTER_PLATFORMS.has(entry.name)) || runtime) continue;
      // .github/workflows is read for its config; any other hidden folder is listed only.
      await walk(root, full, found, max, listOnly || (hidden && !HIDDEN_KEPT.test(rel)));
      continue;
    }
    if (!entry.isFile()) continue;
    // In .github only the workflows' YAML is read, and only as config files; the rest is listed.
    if (listOnly || (rel.startsWith(".github/") && !isConfigPath(rel))) {
      await other(found, rel, full);
      continue;
    }
    // A file the app serves as it is (public/, static/): its path only, kept apart from the code.
    if (!keepsCode(rel) && isAssetPath(rel)) {
      if (assets.length < MAX_ASSETS) assets.push({ path: rel, content: "" });
      continue;
    }
    // Code the map draws, config, and code in other languages for the guide to read (isReadablePath).
    if (!(keepsCode(rel) || isConfigPath(rel) || isReadablePath(rel))) {
      await other(found, rel, full);
      continue;
    }
    if (out.length >= max) throw new TooManyFilesError(max);
    const s = await stat(full);
    if (s.size > 2_000_000) continue;
    const content = await readFile(full, "utf8");
    if (content.includes("\0")) continue;
    out.push({ path: rel, content });
  }
}
