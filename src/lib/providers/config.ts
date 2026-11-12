// The saved provider choice (.walkmycode/config.json), how it falls back to
// WALKMYCODE_* env vars (or the old LANTERN_* ones) and then the built-in default, and the readiness check
// that says whether a question can be asked right now.
import type { AgentId } from "./agents";
import "server-only";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT, modelFor, PROVIDERS, providerFor, type Effort, type ProviderId } from "./catalogue";
import { friendly } from "./errors";
import { HttpError } from "./guard";
import { keyFor } from "./keys";
import { dataDirIn, envVar, homeBase } from "../dataDir";
import type { FriendlyError, Resolved } from "./wire";

export interface SavedConfig {
  provider?: string;
  model?: string;
  effort?: Effort;
  local_base_url?: string;
}

export type ConfigSource = "config" | "env" | "default";

const EFFORTS: Effort[] = ["low", "medium", "high"];
const FREEFORM_MODEL = /^[\w.:/-]{1,120}$/;
const PROBE_MS = 2000;

/** Where the file lives; read on every call so tests can point WALKMYCODE_HOME at a temp dir. */
export function configPath(): string {
  return join(dataDirIn(homeBase(process.cwd())), "config.json");
}

/** The saved choice as-is, or {} when the file is missing or unreadable. */
export function loadConfig(): SavedConfig {
  try {
    const raw = JSON.parse(readFileSync(configPath(), "utf8")) as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as SavedConfig) : {};
  } catch {
    return {};
  }
}

function isEffort(v: unknown): v is Effort {
  return typeof v === "string" && (EFFORTS as string[]).includes(v);
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Check a patch the way POST /api/config does. Throws HttpError(400) with
 * the spec's messages; returns the cleaned patch.
 */
export function validateConfig(patch: SavedConfig): SavedConfig {
  const out: SavedConfig = {};
  if (patch.provider !== undefined) {
    const p = providerFor(patch.provider);
    if (!p) throw new HttpError(400, `Unknown provider: ${patch.provider}`);
    out.provider = p.id;
    if (patch.model !== undefined) {
      const model = patch.model.trim();
      if (p.models_freeform) {
        if (!FREEFORM_MODEL.test(model)) throw new HttpError(400, `Unknown model for ${p.id}: ${patch.model}`);
      } else if (!p.models.some((m) => m.id === model)) {
        throw new HttpError(400, `Unknown model for ${p.id}: ${patch.model}`);
      }
      out.model = model;
    }
  } else if (patch.model !== undefined) {
    throw new HttpError(400, "A model needs a provider.");
  }
  if (patch.effort !== undefined) {
    if (!isEffort(patch.effort)) throw new HttpError(400, `Unknown effort: ${String(patch.effort)}`);
    out.effort = patch.effort;
  }
  if (patch.local_base_url !== undefined) {
    const url = patch.local_base_url.trim().replace(/\/+$/, "");
    if (!isHttpUrl(url)) throw new HttpError(400, "Server URL must start with http:// or https://");
    out.local_base_url = url;
  }
  return out;
}

/** Merge-on-save: fields not in the patch survive. Temp file + rename. */
export function saveConfig(patch: SavedConfig): SavedConfig {
  const cfg = { ...loadConfig(), ...validateConfig(patch) };
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
  return cfg;
}

/** The local server's address: saved, else LOCAL_BASE_URL, else the catalogue's Ollama default. */
export function localBaseUrl(saved: SavedConfig = loadConfig()): string {
  return saved.local_base_url || process.env.LOCAL_BASE_URL || PROVIDERS.local.base_url || "";
}

/**
 * The choice in force: config.json, else WALKMYCODE_PROVIDER / WALKMYCODE_MODEL /
 * WALKMYCODE_EFFORT (or their old LANTERN_* names), else the default. `base_url` is only set for the local
 * provider, whose server address is the one editable endpoint.
 */
export function resolve(): { resolved: Resolved; source: ConfigSource; saved: SavedConfig } {
  const saved = loadConfig();
  const env = process.env;
  let source: ConfigSource;
  let provider: string;
  let model: string | undefined;
  if (saved.provider) {
    source = "config";
    provider = saved.provider;
    model = saved.model;
  } else if (envVar("PROVIDER", env) || envVar("MODEL", env)) {
    source = "env";
    provider = envVar("PROVIDER", env) || DEFAULT.provider;
    model = envVar("MODEL", env) || undefined; // blank, as in .env.example, means the provider's default
  } else {
    source = "default";
    provider = DEFAULT.provider;
    model = DEFAULT.model;
  }
  const def = providerFor(provider);
  const envEffort = envVar("EFFORT", env);
  const effort = isEffort(saved.effort) ? saved.effort : isEffort(envEffort) ? envEffort : DEFAULT.effort;
  const resolved: Resolved = { provider: (def?.id ?? provider) as ProviderId, model: (model ?? def?.default_model ?? "").trim(), effort };
  if (def?.base_url_editable) resolved.base_url = localBaseUrl(saved);
  return { resolved, source, saved };
}

/** Whether something answers at {base_url}/models within two seconds. */
async function reachable(base_url: string, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`${base_url.replace(/\/+$/, "")}/models`, { signal: AbortSignal.timeout(PROBE_MS) });
    return res.status < 500;
  } catch {
    return false;
  }
}

/**
 * Port of iReliabee's resolve_llm: null when a question can be asked, else
 * the FriendlyError to show. The local probe is the only network call.
 */
export async function readiness(r: Resolved = resolve().resolved, fetchImpl: typeof fetch = fetch): Promise<FriendlyError | null> {
  const p = providerFor(r.provider);
  if (!p || !r.model) return friendly("no_model");
  if (p.env !== null && !keyFor(p.id)) return friendly("missing_key", { provider: p.id });
  if (!p.models_freeform && !modelFor(p, r.model)) return friendly("model_unavailable", { provider: p.id });
  if (p.wire === "cli") return (await import("./cli")).cliReadiness(p.id as AgentId);
  if (p.id === "local") {
    const base_url = r.base_url ?? PROVIDERS.local.base_url ?? "";
    if (!(await reachable(base_url, fetchImpl))) return friendly("network", { provider: p.id, base_url });
  }
  return null;
}
