// Whether the user allowed WalkMyCode to run code and open a terminal on this
// computer, and the run's time limit: `local_run` in .walkmycode/config.json
// (the old .lantern folder when only that one exists, as for the rest of the
// config). Off until the user says yes once; "Revoke" turns it off again. The
// rest of the file is kept as it is (merge on save, temp file + rename).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface LocalRunSettings {
  allowed: boolean;
  /** When the user allowed it (ISO), for Settings. */
  allowed_at?: string;
  /** A run is stopped after this many seconds. */
  timeout_s: number;
}

export const DEFAULT_TIMEOUT_S = 60;
export const MIN_TIMEOUT_S = 1;
export const MAX_TIMEOUT_S = 3600;

function readJson(path: string): Record<string, unknown> {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function clampTimeout(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : DEFAULT_TIMEOUT_S;
  return Math.min(MAX_TIMEOUT_S, Math.max(MIN_TIMEOUT_S, n));
}

/** The saved choice; off when the file or the entry is missing or not exactly `allowed: true`. */
export function loadLocalRun(configFile: string): LocalRunSettings {
  const raw = readJson(configFile).local_run as Record<string, unknown> | undefined;
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    allowed: r.allowed === true,
    ...(r.allowed === true && typeof r.allowed_at === "string" ? { allowed_at: r.allowed_at } : {}),
    timeout_s: clampTimeout(r.timeout_s),
  };
}

/** The full app's "Set up this project": where each workspace is on this computer (`setup_roots`, by workspace name). */
export function loadSetupRoots(configFile: string, workspace: string): string[] {
  const all = readJson(configFile).setup_roots as Record<string, unknown> | undefined;
  const v = all && typeof all === "object" ? all[workspace] : undefined;
  return Array.isArray(v) ? v.filter((p): p is string => typeof p === "string") : [];
}

/** Remember where a workspace is (one folder per name; the latest answer wins). */
export function saveSetupRoot(configFile: string, workspace: string, path: string): void {
  const all = readJson(configFile);
  const roots = all.setup_roots && typeof all.setup_roots === "object" ? (all.setup_roots as Record<string, unknown>) : {};
  roots[workspace] = [path];
  all.setup_roots = roots;
  mkdirSync(dirname(configFile), { recursive: true });
  const tmp = `${configFile}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(all, null, 2)}\n`, "utf8");
  renameSync(tmp, configFile);
}

/** Allow, revoke, or change the time limit; every other setting in the file survives. */
export function saveLocalRun(configFile: string, patch: { allowed?: boolean; timeout_s?: number }, now = () => new Date()): LocalRunSettings {
  const all = readJson(configFile);
  const prev = loadLocalRun(configFile);
  const next: LocalRunSettings = { allowed: patch.allowed ?? prev.allowed, timeout_s: patch.timeout_s === undefined ? prev.timeout_s : clampTimeout(patch.timeout_s) };
  if (next.allowed) next.allowed_at = patch.allowed === true && !prev.allowed ? now().toISOString() : (prev.allowed_at ?? now().toISOString());
  all.local_run = next;
  mkdirSync(dirname(configFile), { recursive: true });
  const tmp = `${configFile}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(all, null, 2)}\n`, "utf8");
  renameSync(tmp, configFile);
  return next;
}
