// The bodies of the provider settings routes: GET/POST /api/config (the
// catalogue with has_key per provider, the saved choice and readiness; save a
// new choice), GET /api/config/readiness and GET /api/config/models. The app's
// route files and the MCP page's local server (mcp/src/routes.ts) both run
// them, each wrapped in `guarded`. Keys never appear here, only whether one is
// set and where it came from.
import "server-only";
import { z } from "zod";
import { PROVIDER_IDS, PROVIDERS } from "./catalogue";
import { localBaseUrl, readiness, resolve, saveConfig } from "./config";
import { HttpError } from "./guard";
import { keyFor, keyStatus, readKeys } from "./keys";

type Handler = (req: Request) => Promise<Response>;

const SaveBody = z.object({
  provider: z.string().min(1),
  model: z.string(),
  effort: z.enum(["low", "medium", "high"]).optional(),
  local_base_url: z.string().optional(),
});

/** The catalogue as the UI sees it: the public fields plus has_key. */
function catalogue() {
  const status = keyStatus();
  return PROVIDER_IDS.map((id) => {
    const p = PROVIDERS[id];
    return {
      id: p.id,
      label: p.label,
      env: p.env,
      has_key: status[id].has_key,
      source: status[id].source,
      wire: p.wire,
      base_url: p.base_url ?? null,
      base_url_editable: p.base_url_editable ?? false,
      models: p.models.map((m) => ({ id: m.id, label: m.label, tools: m.tools, reasoning: m.reasoning, price: m.price })),
      models_freeform: p.models_freeform ?? false,
      default_model: p.default_model,
      url: p.url,
      hint: p.hint,
      privacy: p.privacy,
    };
  });
}

async function snapshot() {
  const { resolved, source, saved } = resolve();
  return {
    saved: { provider: resolved.provider, model: resolved.model, effort: resolved.effort, local_base_url: localBaseUrl(saved) },
    source,
    llm_providers: catalogue(),
    readiness: { llm: await readiness(resolved) },
  };
}

export function configGetHandler(): Handler {
  return async () => Response.json(await snapshot(), { headers: { "cache-control": "no-store" } });
}

export function configPostHandler(): Handler {
  return async (req) => {
    const parsed = SaveBody.safeParse(await req.json());
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
    saveConfig(parsed.data);
    const { readiness: ready } = await snapshot();
    return Response.json({ ok: true, readiness: ready });
  };
}

/** Can a question be asked right now? null when yes, else the FriendlyError to show. */
export function readinessHandler(): Handler {
  return async () => Response.json({ llm: await readiness() }, { headers: { "cache-control": "no-store" } });
}

const MODELS_TIMEOUT_MS = 2000;
const GROQ_MODELS = "https://api.groq.com/openai/v1";

/** The endpoint and bearer for a provider's /models, or null when we do not proxy it. */
function modelsTarget(provider: string): { base_url: string; token?: string } | null {
  if (provider === "local") return { base_url: localBaseUrl(), token: readKeys().get("LOCAL_API_KEY") ?? process.env.LOCAL_API_KEY };
  if (provider === "groq") return { base_url: GROQ_MODELS, token: keyFor("groq")?.value };
  return null;
}

async function listModels(base_url: string, token?: string): Promise<string[]> {
  try {
    const res = await fetch(`${base_url.replace(/\/+$/, "")}/models`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: { id?: unknown }[] };
    return (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

/** The model ids a server actually offers: a local server's pulled models, or Groq's current list. [] on any failure. */
export function modelsHandler(): Handler {
  return async (req) => {
    const provider = new URL(req.url).searchParams.get("provider") ?? "";
    const t = modelsTarget(provider);
    if (!t) throw new HttpError(400, `No model list for provider: ${provider}`);
    return Response.json({ models: await listModels(t.base_url, t.token) });
  };
}
