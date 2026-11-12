// Reads a folder from disk into SourceFile[] the way the CLI indexer does.
// Shared with the tests so the fixtures are read with the same KEEP/SKIP
// rules as a real run.
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { isAssetPath, isConfigPath, isReadablePath, MAX_ASSETS } from "../src/analyzer/config/files";
import type { SourceFile } from "../src/analyzer/types";

/** Code and manifests; config files (compose, Dockerfile, .env.example, ...) are kept by isConfigPath. Never a real .env. */
export const KEEP = /\.(ts|tsx|js|jsx|mjs|cjs|mts|py|sql|prisma|dart|php|twig)$|(^|[\\/])(package\.json|pyproject\.toml|requirements\.txt|Cargo\.toml|go\.mod|pubspec\.yaml|composer\.json)$/;
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
  await walk(root, root, out, assets, opts.maxFiles ?? Infinity);
  return [...out, ...assets];
}

async function walk(root: string, dir: string, out: SourceFile[], assets: SourceFile[], max: number) {
  const entries = await readdir(dir, { withFileTypes: true });
  const flutter = entries.some((e) => e.isFile() && e.name === "pubspec.yaml");
  const composer = entries.some((e) => e.isFile() && e.name === "composer.json");
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = relative(root, full).split("\\").join("/");
    if (entry.isDirectory()) {
      const runtime = (composer && PHP_RUNTIME.has(entry.name)) || PHP_CACHE.test(rel);
      if (!SKIP.has(entry.name) && (!entry.name.startsWith(".") || HIDDEN_KEPT.test(rel)) && !(flutter && FLUTTER_PLATFORMS.has(entry.name)) && !runtime) await walk(root, full, out, assets, max);
      continue;
    }
    // In .github only the workflows' YAML, and only as config files.
    if (rel.startsWith(".github/") && !isConfigPath(rel)) continue;
    // A file the app serves as it is (public/, static/): its path only, kept apart from the code.
    if (entry.isFile() && !KEEP.test(rel) && isAssetPath(rel)) {
      if (assets.length < MAX_ASSETS) assets.push({ path: rel, content: "" });
      continue;
    }
    // Code the map draws, config, and code in other languages for the guide to read (isReadablePath).
    if (!entry.isFile() || !(KEEP.test(rel) || isConfigPath(rel) || isReadablePath(rel))) continue;
    if (out.length >= max) throw new TooManyFilesError(max);
    const s = await stat(full);
    if (s.size > 2_000_000) continue;
    const content = await readFile(full, "utf8");
    if (content.includes("\0")) continue;
    out.push({ path: rel, content });
  }
}
