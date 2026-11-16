// Which files of a folder WalkMyCode reads, and which folders it never walks into. Shared
// by the browser's reader (src/lib/localFolder.ts) and the desktop app's, which reads a
// folder picked with the system's picker on the server (src/lib/serverFolder.ts). Pure.
import { drawnLang, isConfigPath, isReadablePath } from "@/analyzer/config/files";

/** Manifests by name; code the map draws by its language (config/files.ts), config files (compose, Dockerfile,
 * .env.example, ...) by path. Never a real .env. */
const MANIFEST = /(^|\/)(package\.json|pyproject\.toml|requirements\.txt|Cargo\.toml|go\.mod|pubspec\.yaml|composer\.json)$/;
// The one hidden folder read is .github/workflows, for its config files only (a deploy's health check names the app's address).
// Code in other languages (Go, Java…) is kept too, for the guide to read and search, though the map doesn't draw it.
export const keep = (path: string) => (path.startsWith(".github/") ? isConfigPath(path) : drawnLang(path) !== null || MANIFEST.test(path) || isConfigPath(path) || isReadablePath(path));
export const HIDDEN_KEPT = /^\.github(\/workflows)?$/;
export const SKIP = new Set(["node_modules", "dist", "build", "out", "target", "__pycache__", "venv", "coverage", "vendor", "storybook-static", "site-packages"]);
/** Beside a pubspec.yaml these are Flutter's platform folders: generated and native code. */
export const FLUTTER_PLATFORMS = new Set(["android", "ios", "macos", "linux", "windows"]);
/** Beside a composer.json, storage/ (Laravel) and var/ (Symfony) are a PHP app's logs, sessions and compiled
 * views and container; bootstrap/cache holds Laravel's cached config and routes. All written at run time, never code. */
export const PHP_RUNTIME = new Set(["storage", "var"]);
export const PHP_CACHE = /(^|\/)bootstrap\/cache$/;

/** A folder not walked into: `name` at `path` (from the picked folder down), in a folder that does or
 * doesn't hold a pubspec.yaml (`flutter`) or a composer.json (`composer`). */
export function skipDir(name: string, path: string, beside: { flutter: boolean; composer: boolean }): boolean {
  if (SKIP.has(name) || (name.startsWith(".") && !HIDDEN_KEPT.test(path))) return true;
  if (beside.flutter && FLUTTER_PLATFORMS.has(name)) return true;
  return (beside.composer && PHP_RUNTIME.has(name)) || PHP_CACHE.test(path);
}

/** Files bigger than this are not read. */
export const MAX_FILE_BYTES = 2_000_000;
