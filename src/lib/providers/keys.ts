// API keys pasted in Settings. They live in .walkmycode/keys.env (or the old .lantern/keys.env), written only
// by this module and read only here: the values never reach a response, a
// log line or process.env. Anything not in the file falls back to the
// environment (.env.local), which is how it worked before Settings existed.
import "server-only";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { keyEnvAllowlist, PROVIDER_IDS, PROVIDERS, type ProviderId } from "./catalogue";
import { HttpError } from "./guard";
import { dataDirIn, homeBase } from "../dataDir";

export type KeySource = "settings" | "env";

/** Whether a key is set, where from, and (when it is not) another WalkMyCode on this computer that has one. */
export interface EnvStanding {
  has_key: boolean;
  source: KeySource | null;
  /** The folder of another WalkMyCode whose keys.env holds this key ("codebase-guide", "your home folder"). */
  found?: string;
}

const MAX_LEN = 1024;

/** Where the file lives; read on every call so tests can point WALKMYCODE_HOME at a temp dir. */
export function keysPath(): string {
  return join(dataDirIn(homeBase(process.cwd())), "keys.env");
}

let cache: { path: string; mtimeMs: number; keys: Map<string, string> } | null = null;

/** Parse KEY=value lines; quotes stripped, blank lines and # comments skipped. */
function parse(text: string): Map<string, string> {
  const keys = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) value = value.slice(1, -1);
    keys.set(name, value);
  }
  return keys;
}

/** The keys in the file, re-read only when its mtime changes. Missing file = no keys. */
export function readKeys(): Map<string, string> {
  const path = keysPath();
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    cache = { path, mtimeMs: -1, keys: new Map() };
    return cache.keys;
  }
  if (cache && cache.path === path && cache.mtimeMs === mtimeMs) return cache.keys;
  rememberKeyFile(path);
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    text = "";
  }
  cache = { path, mtimeMs, keys: parse(text) };
  return cache.keys;
}

/**
 * The key to use for a provider: the file first, then process.env. The
 * keyless local provider gets LOCAL_API_KEY (LM Studio's optional token)
 * when one is set, else a placeholder Ollama ignores.
 */
export function keyFor(providerId: ProviderId): { value: string; source: KeySource } | null {
  const env = PROVIDERS[providerId].env;
  if (env === null) {
    const token = readKeys().get("LOCAL_API_KEY");
    if (token) return { value: token, source: "settings" };
    return { value: process.env.LOCAL_API_KEY || "local", source: "env" };
  }
  const fromFile = readKeys().get(env);
  if (fromFile) return { value: fromFile, source: "settings" };
  const fromEnv = process.env[env];
  if (fromEnv) return { value: fromEnv, source: "env" };
  return null;
}

/**
 * The key for an allowlisted env var that belongs to no model provider (the
 * voice keys, DEEPGRAM_API_KEY and ELEVENLABS_API_KEY): the file first, then
 * process.env. Anything outside the allowlist gets null.
 */
export function keyForEnv(envVar: string): { value: string; source: KeySource } | null {
  if (!keyEnvAllowlist().includes(envVar)) return null;
  const fromFile = readKeys().get(envVar);
  if (fromFile) return { value: fromFile, source: "settings" };
  const fromEnv = process.env[envVar];
  if (fromEnv) return { value: fromEnv, source: "env" };
  return null;
}

/** Port of iReliabee's _clean_value: trim, cap the length, refuse control characters. */
function cleanValue(value: string): string {
  const v = value.trim();
  if (v.length > MAX_LEN) throw new HttpError(400, "That key is far longer than any real one.");
  for (const ch of v) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code === 127) throw new HttpError(400, "That key contains a line break or control character. Paste just the key.");
  }
  return v;
}

/** Write the file atomically: temp file beside it, chmod 0600 where that means anything, then rename. */
function writeFile(path: string, lines: string[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, lines.length ? lines.join("\n") + "\n" : "", "utf8");
  try {
    chmodSync(tmp, 0o600);
  } catch {
    // Windows has no POSIX modes; the file is as private as the user's profile folder.
  }
  renameSync(tmp, path);
  cache = null;
}

/**
 * Replace or append `ENV_VAR=value` in keys.env. An empty value removes the
 * line. Refuses names outside the allowlist so this cannot be used to set
 * arbitrary server settings.
 */
export function writeKey(envVar: string, value: string): void {
  if (!keyEnvAllowlist().includes(envVar)) throw new HttpError(400, `Unknown env var: ${envVar}`);
  const clean = cleanValue(value);
  const path = keysPath();
  const existing = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : [];
  // Match the line the same way parse() reads it: optional `export`, spaces around `=`.
  const isVar = new RegExp(`^(export\\s+)?${envVar}\\s*=`);
  const kept = existing.filter((l) => l.trim() !== "" && !isVar.test(l.trim()));
  if (clean) kept.push(`${envVar}=${clean}`);
  writeFile(path, kept);
}

/** Remove the line for an env var. Keys from process.env are untouched and still count. */
export function deleteKey(envVar: string): void {
  writeKey(envVar, "");
}

/** Whether a key is set for an env var, where it came from, and another WalkMyCode's key file that has it. */
export function envStatus(envVar: string): EnvStanding {
  if (readKeys().get(envVar)) return { has_key: true, source: "settings" };
  if (process.env[envVar]) return { has_key: true, source: "env" };
  const other = foundElsewhere(envVar);
  return other ? { has_key: false, source: null, found: other.label } : { has_key: false, source: null };
}

// ── Keys another WalkMyCode on this computer already holds ──────────────────
// The full app keeps keys.env in its own folder (<project>/.walkmycode), WalkMyCode
// for Claude in ~/.walkmycode. Each one that reads its keys.env writes the file's
// path to ~/.walkmycode/key-files.json, so the other can offer "use the key you
// already saved" instead of asking for it again. Only paths are listed; a value
// is copied server-side, file to file, when the user asks, and never sent anywhere.

/** ~/.walkmycode/key-files.json (WALKMYCODE_HOME moves it, as it moves everything else). */
export function keyFilesListPath(): string {
  return join(dataDirIn(homeBase(homedir())), "key-files.json");
}

/** Only files named keys.env inside a .walkmycode or .lantern folder are ever read from the list. */
function isKeyFile(path: string): boolean {
  return basename(path) === "keys.env" && /^\.(walkmycode|lantern)$/.test(basename(dirname(path)));
}

function readList(): string[] {
  try {
    const v: unknown = JSON.parse(readFileSync(keyFilesListPath(), "utf8"));
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && isKeyFile(x)) : [];
  } catch {
    return [];
  }
}

/** Add this keys.env to the list when it is not there (readKeys calls this only when the file changed); never fails the caller. */
function rememberKeyFile(path: string): void {
  const full = resolve(path);
  try {
    const list = readList();
    if (list.some((p) => resolve(p) === full)) return;
    const out = keyFilesListPath();
    mkdirSync(dirname(out), { recursive: true });
    const tmp = out + ".tmp";
    writeFileSync(tmp, JSON.stringify([...list, full].slice(-20), null, 2), "utf8");
    renameSync(tmp, out);
  } catch {
    // an unwritable home: no sharing, nothing else changes
  }
}

/** The first other listed keys.env that holds envVar, and how to name its folder to the user. */
function foundElsewhere(envVar: string): { path: string; value: string; label: string } | null {
  if (!keyEnvAllowlist().includes(envVar)) return null;
  const mine = resolve(keysPath());
  for (const path of readList()) {
    if (resolve(path) === mine) continue;
    let value: string | undefined;
    try {
      value = parse(readFileSync(path, "utf8")).get(envVar);
    } catch {
      continue;
    }
    if (!value) continue;
    const owner = dirname(dirname(path));
    const label = resolve(owner) === resolve(homedir()) ? "your home folder" : basename(owner);
    return { path, value, label };
  }
  return null;
}

/** Copy envVar from another WalkMyCode's keys.env into this one's. False when none has it. */
export function copyFoundKey(envVar: string): boolean {
  const other = foundElsewhere(envVar);
  if (!other) return false;
  writeKey(envVar, other.value);
  return true;
}

/** has_key per provider. Values never leave this module. */
export function keyStatus(): Record<ProviderId, EnvStanding> {
  const out = {} as Record<ProviderId, EnvStanding>;
  for (const id of PROVIDER_IDS) {
    const env = PROVIDERS[id].env;
    out[id] = env === null ? { has_key: true, source: null } : envStatus(env);
  }
  return out;
}
