// Where WalkMyCode keeps its files and which settings it reads, with the
// names it had before the rename (Lantern) as a fallback, so maps, keys and
// settings saved under the old names keep working. The old folder is only
// ever read and written in place: never moved, renamed or deleted.
import { existsSync } from "node:fs";
import { join } from "node:path";

/** The data folder's name: .walkmycode in the project (or ~ for WalkMyCode for Claude). */
export const DATA_DIR = ".walkmycode";
/** The folder's name before the rename. */
export const OLD_DATA_DIR = ".lantern";

/** base/.walkmycode, or base/.lantern when only that one exists (a folder made before the rename). */
export function dataDirIn(base: string): string {
  const now = join(base, DATA_DIR);
  if (existsSync(now)) return now;
  const old = join(base, OLD_DATA_DIR);
  return existsSync(old) ? old : now;
}

/** WALKMYCODE_<name>, else the old LANTERN_<name> when the new one is not set. */
export function envVar(name: string, env: Record<string, string | undefined> = process.env): string | undefined {
  return env[`WALKMYCODE_${name}`] ?? env[`LANTERN_${name}`];
}

/** The folder WALKMYCODE_HOME (or the old LANTERN_HOME) points at, else `fallback`. */
export function homeBase(fallback: string): string {
  return envVar("HOME") ?? fallback;
}
