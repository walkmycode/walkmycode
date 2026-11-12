// Turns whatever a provider threw into a FriendlyError the browser can show:
// a code, a title, what to do next, and (for the unknown case) a scrubbed
// slice of the provider's own words. Nothing here needs the SDK at runtime;
// APICallError is matched on its shape so tests can use plain objects.
import { labelOf, providerFor, type ProviderId } from "./catalogue";
import { AGENTS, isAgent } from "./agents";
import type { ErrorCode, FriendlyError } from "./wire";

const DETAIL_CHARS = 300;
const KEY_SHAPED = /(sk|gsk|xai|AIza|sk-ant)[-_A-Za-z0-9]{8,}/g;

/** Replace anything that looks like an API key with `[key]`. */
export function scrub(text: string): string {
  return text.replace(KEY_SHAPED, "[key]");
}

export interface FriendlyContext {
  provider?: ProviderId;
  base_url?: string;
  status?: number;
  detail?: string;
  origin?: string; // where WalkMyCode answers, for the forbidden copy
}

/** The standard copy for a code. `provider` fills in the label and env var; `base_url` the local-server address. */
export function friendly(code: ErrorCode, ctx: FriendlyContext = {}): FriendlyError {
  const label = ctx.provider ? labelOf(ctx.provider) : "The AI provider";
  const env = (ctx.provider && providerFor(ctx.provider)?.env) || "the API key";
  const where = ctx.base_url ?? "the server URL in Settings";
  // The app on this computer behind a "my subscription" provider (agents.ts): Claude Code unless said otherwise.
  const app = AGENTS[isAgent(ctx.provider) ? ctx.provider : "claude-code"];
  const copy = ((): { title: string; message: string; action: FriendlyError["action"] } => {
    switch (code) {
      case "no_model":
        return { title: "No AI model selected", message: "Choose a model in Settings → Language model before asking.", action: "settings" };
      case "cli_missing":
        return { title: `${app.name} isn't on this computer`, message: `Install ${app.name} (${app.url.replace(/^https:\/\//, "")}), sign in once by running ${app.command}, then ask again. Or pick an API-key provider in Settings.`, action: "settings" };
      case "cli_not_plan":
        return { title: `${app.name} here bills an API account, not your plan`, message: `It is signed in with an API key or a pay-as-you-go account, so every answer would be charged per token. Run ${app.command} and sign in with ${app.account} instead, then ask again. Or pick an API-key provider in Settings.`, action: "settings" };
      case "cli_hosted":
        return { title: `${app.name} can't answer on a hosted WalkMyCode`, message: "Everyone who opens this page would spend the host's own plan. Pick an API-key provider in Settings.", action: "settings" };
      case "cli_signed_out":
        return { title: `${app.name} isn't signed in to your plan`, message: `Run ${app.command} in a terminal and sign in with ${app.account}, then ask again.`, action: "settings" };
      case "cli_unsupported":
        return { title: `${app.name} turned this account away`, message: "Google no longer lets personal Google accounts answer through the Gemini CLI (it points them to Antigravity). Use a Gemini API key in Settings (there is a free tier), or a Gemini Code Assist Standard or Enterprise account.", action: "settings" };
      case "missing_key":
        return { title: `${label} API key missing`, message: `Add your ${label} key in Settings → Language model, or put ${env} in .env.local.`, action: "settings" };
      case "invalid_key":
        return { title: `${label} rejected the API key`, message: "The key may be mistyped, revoked or expired. Paste a fresh key in Settings.", action: "settings" };
      case "out_of_credits":
        return { title: `${label} account is out of credits`, message: `Top up your ${label} balance, or switch to another provider in Settings.`, action: "settings" };
      case "rate_limited":
        return { title: `${label} is busy right now`, message: "Too many requests or a temporary quota limit. Wait a moment and try again.", action: "retry" };
      case "model_unavailable":
        return { title: `${label} can't use this model`, message: "Pick a different model in Settings.", action: "settings" };
      case "stale_history":
        return { title: "Settings changed", message: `You switched provider mid-conversation. Ask again to start a fresh conversation on ${label}.`, action: "retry" };
      case "forbidden":
        return { title: "Settings can only be changed from this computer", message: `Open WalkMyCode at ${ctx.origin ?? "http://localhost:3000"} to change keys or ask questions.`, action: null };
      case "network":
        return ctx.provider === "local"
          ? { title: "Can't reach your local server", message: `Nothing answered at ${where}. Start Ollama or LM Studio and try again.`, action: "settings" }
          : { title: `Can't reach ${label}`, message: `Check your internet connection. For local models: is the server running at ${where}?`, action: "retry" };
      case "unknown":
        return { title: `${label} request failed`, message: "The provider returned an error WalkMyCode does not recognise. The details are below.", action: "retry" };
    }
  })();
  const err: FriendlyError = { code, ...copy };
  if (ctx.provider) err.provider = ctx.provider;
  if (ctx.status !== undefined) err.status = ctx.status;
  if (ctx.detail) err.detail = scrub(ctx.detail).slice(0, DETAIL_CHARS);
  return err;
}

/** The shape of the SDK's APICallError (and anything else) that classify() reads. */
interface ErrorLike {
  statusCode?: number;
  status?: number;
  responseBody?: string;
  message?: string;
  code?: string;
  cause?: unknown;
  lastError?: unknown;
}

/** Follow RetryError.lastError / .cause down to the error that actually came off the wire. */
function unwrap(err: unknown): ErrorLike {
  let e = err as ErrorLike;
  for (let depth = 0; depth < 5; depth++) {
    const inner = (e?.lastError ?? e?.cause) as ErrorLike | undefined;
    if (!inner || typeof inner !== "object") break;
    if (e?.statusCode !== undefined || e?.responseBody !== undefined) break;
    e = inner;
  }
  return e && typeof e === "object" ? e : { message: String(err) };
}

/** Map a provider error to a FriendlyError. `base_url` is only used in the network copy. */
export function classify(err: unknown, provider: ProviderId, base_url?: string): FriendlyError {
  const e = unwrap(err);
  const status = e.statusCode ?? e.status;
  const body = e.responseBody ?? "";
  const message = e.message ?? (typeof err === "string" ? err : "");
  const text = `${body}\n${message}\n${e.code ?? ""}`;
  const ctx: FriendlyContext = { provider, base_url, status };

  if (status === 401 || status === 403 || /invalid api key|authentication|unauthorized/i.test(text)) return friendly("invalid_key", ctx);
  if (status === 402 || /credit balance|insufficient_quota|billing/i.test(text)) return friendly("out_of_credits", ctx);
  if (status === 429) return friendly("rate_limited", ctx);
  if (status === 404 || /model.*(not found|does not exist)|unknown model/i.test(text)) return friendly("model_unavailable", ctx);
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|timeout|aborted/i.test(text)) return friendly("network", ctx);
  return friendly("unknown", { ...ctx, detail: body || message });
}
