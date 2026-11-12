// The provider catalogue: every model WalkMyCode can talk to, what it costs and
// where the key comes from. Shared by the server and the browser, so nothing
// secret lives here. Prices are $ per million tokens as read from the vendor
// pages on 2026-09-29; anything not read straight off a price page carries
// `unverified: true` and a note saying why.

export type ProviderId = "anthropic" | "openai" | "gemini" | "groq" | "deepseek" | "xai" | "local" | "claude-code" | "codex" | "gemini-cli";

export type Wire =
  | "anthropic" // @ai-sdk/anthropic
  | "openai-responses" // @ai-sdk/openai  (openai(id) = Responses API)
  | "google" // @ai-sdk/google  (native generateContent)
  | "groq" // @ai-sdk/groq
  | "deepseek" // @ai-sdk/deepseek
  | "xai" // @ai-sdk/xai     (Responses API)
  | "openai-compatible" // @ai-sdk/openai-compatible (Ollama, LM Studio, anything else)
  | "cli"; // a coding agent on this computer, on the user's own plan (./cli.ts): no key, no SDK

export type Effort = "low" | "medium" | "high";

export interface Price {
  in: number; // $/M uncached input tokens
  out: number; // $/M output tokens (reasoning tokens are inside output for every vendor)
  cacheRead?: number; // $/M cached input tokens; defaults to `in` when absent
  cacheWrite?: number; // $/M cache-write tokens; defaults to `in` when absent (only Anthropic bills a premium)
  unverified?: boolean; // not read directly from a vendor price page, or time/peak dependent
  note?: string;
}

export interface ModelDef {
  id: string; // exact vendor id, sent as-is
  label: string; // "Claude Opus 5.5 — most capable (default)"
  price: Price | null; // null = free/local/unknown → counted as "unknown" in the meter
  tools: "confident" | "best-effort"; // confident = passed scripts/smoke-providers.ts
  reasoning: boolean; // model accepts an effort/thinking option
  maxOutput?: number; // default 8000
}

export interface ProviderDef {
  id: ProviderId;
  label: string; // "Anthropic (Claude)"
  env: string | null; // key env var; null = no key needed
  wire: Wire;
  base_url?: string; // default endpoint; editable in Settings only when base_url_editable
  base_url_editable?: boolean;
  models: ModelDef[]; // free-text model id allowed only when models_freeform
  models_freeform?: boolean;
  default_model: string;
  strict_tools: boolean; // send strict:true on finish_tour
  url: string; // where to get a key
  hint: string; // one line under the picker
  privacy: string; // one sentence shown in Settings and on the connect screen
}

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  anthropic: {
    id: "anthropic", label: "Anthropic (Claude)", env: "ANTHROPIC_API_KEY", wire: "anthropic",
    default_model: "claude-opus-5-5", strict_tools: true,
    url: "https://platform.claude.com", hint: "WalkMyCode's default. Prompt caching keeps repeat questions cheap.",
    privacy: "Snippets of your repo go to Anthropic's API on your key. Anthropic does not train on API traffic.",
    // Every Claude model on the API (prices per million tokens, Anthropic's list of 2026-11-03), newest
    // first within each family. Claude Mythos is left out: it is for verified organisations only.
    models: [
      { id: "claude-opus-5-5", label: "Claude Opus 5.5 — most capable everyday (default)", tools: "confident", reasoning: true,
        price: { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 } },
      { id: "claude-fable-5-2", label: "Claude Fable 5.2 — Anthropic's most capable; slower, dearer", tools: "confident", reasoning: true,
        price: { in: 8, out: 40, cacheRead: 0.2, cacheWrite: 10, unverified: true, note: "cacheWrite derived from the 1.25× rule" } },
      { id: "claude-fable-5-1", label: "Claude Fable 5.1 — previous Fable", tools: "confident", reasoning: true,
        price: { in: 10, out: 50, cacheRead: 1, cacheWrite: 12.5, unverified: true, note: "cacheRead and cacheWrite derived from the 0.1× and 1.25× rules" } },
      { id: "claude-fable-5", label: "Claude Fable 5", tools: "confident", reasoning: true,
        price: { in: 10, out: 50, cacheRead: 1, cacheWrite: 12.5, unverified: true, note: "cacheRead and cacheWrite derived from the 0.1× and 1.25× rules" } },
      { id: "claude-opus-5", label: "Claude Opus 5", tools: "confident", reasoning: true,
        price: { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25, unverified: true, note: "cacheRead and cacheWrite derived from the 0.1× and 1.25× rules" } },
      { id: "claude-opus-4-8", label: "Claude Opus 4.8", tools: "confident", reasoning: true,
        price: { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25, unverified: true, note: "cacheRead and cacheWrite derived from the 0.1× and 1.25× rules" } },
      { id: "claude-opus-4-7", label: "Claude Opus 4.7", tools: "confident", reasoning: true,
        price: { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25, unverified: true, note: "cacheRead and cacheWrite derived from the 0.1× and 1.25× rules" } },
      { id: "claude-opus-4-6", label: "Claude Opus 4.6", tools: "confident", reasoning: true,
        price: { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25, unverified: true, note: "cacheRead and cacheWrite derived from the 0.1× and 1.25× rules" } },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 — speed + intelligence", tools: "confident", reasoning: true,
        price: { in: 2, out: 10, cacheRead: 0.1, cacheWrite: 2.5, unverified: true, note: "cacheWrite derived from the 1.25× rule" } },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5", tools: "confident", reasoning: true,
        price: { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5, unverified: true, note: "cacheRead and cacheWrite derived from the 0.1× and 1.25× rules" } },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", tools: "confident", reasoning: true,
        price: { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75, unverified: true, note: "cacheRead and cacheWrite derived from the 0.1× and 1.25× rules" } },
      { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 — fastest, cheapest", tools: "confident", reasoning: true,
        price: { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125, unverified: true, note: "prompts up to 100K tokens ($0.50/$2.50 beyond); cache prices derived from the 0.1× and 1.25× rules" } },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", tools: "confident", reasoning: true,
        price: { in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25, unverified: true, note: "cacheWrite derived from the 1.25× rule" } },
    ],
  },
  openai: {
    id: "openai", label: "OpenAI", env: "OPENAI_API_KEY", wire: "openai-responses",
    base_url: "https://api.openai.com/v1", default_model: "gpt-6.1-sol", strict_tools: true,
    url: "https://platform.openai.com/api-keys", hint: "Uses the Responses API (required for GPT-6 tool calling).",
    privacy: "Snippets of your repo go to OpenAI's API on your key. WalkMyCode sends store:false so nothing is retained.",
    models: [
      { id: "gpt-6.1-sol", label: "GPT-6.1 Sol — balanced (default)", tools: "confident", reasoning: true, maxOutput: 16000,
        price: { in: 2, out: 10, cacheRead: 0.1 } },
      { id: "gpt-6-luna", label: "GPT-6 Luna — small and cheap", tools: "confident", reasoning: true, maxOutput: 16000,
        price: { in: 0.1, out: 0.5, cacheRead: 0.01 } },
      { id: "gpt-6-astra", label: "GPT-6 Astra — flagship", tools: "confident", reasoning: true, maxOutput: 16000,
        price: { in: 10, out: 50, cacheRead: 1 } },
      { id: "gpt-5.4-mini", label: "GPT-5.4 mini — legacy, cheap", tools: "confident", reasoning: true, maxOutput: 16000,
        price: { in: 0.75, out: 4.5, unverified: true, note: "cacheRead not read from the price page" } },
    ],
  },
  gemini: {
    id: "gemini", label: "Google Gemini", env: "GEMINI_API_KEY", wire: "google",
    default_model: "gemini-3.8-flash", strict_tools: false,
    url: "https://aistudio.google.com/apikey", hint: "Free tier available for Flash models.",
    privacy: "Snippets of your repo go to Google's Gemini API on your key. Free-tier traffic may be used to improve Google products.",
    models: [
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash — fast flagship (default)", tools: "confident", reasoning: true,
        price: { in: 0.75, out: 3.75, cacheRead: 0.075, unverified: true, note: "promotional; doubles to $1.50/$7.50 on 2027-01-01" } },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite — cheapest", tools: "confident", reasoning: true,
        price: { in: 0.3, out: 2.5 } },
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview) — reasoning", tools: "best-effort", reasoning: true,
        price: { in: 2, out: 12, unverified: true, note: "≤200k-token prompts; $4/$18 above" } },
    ],
  },
  groq: {
    id: "groq", label: "Groq", env: "GROQ_API_KEY", wire: "groq",
    default_model: "openai/gpt-oss-120b", strict_tools: false,
    url: "https://console.groq.com/keys", hint: "Very fast. Groq retires models often; check the picker if one stops working.",
    privacy: "Snippets of your repo go to Groq's API on your key.",
    models: [
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B — fast flagship (default)", tools: "confident", reasoning: true,
        price: { in: 0.15, out: 0.6 } },
      { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B — fastest", tools: "confident", reasoning: true,
        price: { in: 0.075, out: 0.3 } },
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B — parallel tools", tools: "best-effort", reasoning: false,
        price: { in: 0.59, out: 0.79, unverified: true, note: "docs say Contact Sales; third-party figure" } },
    ],
  },
  deepseek: {
    id: "deepseek", label: "DeepSeek", env: "DEEPSEEK_API_KEY", wire: "deepseek",
    base_url: "https://api.deepseek.com", default_model: "deepseek-flash", strict_tools: false,
    url: "https://platform.deepseek.com/api_keys", hint: "Cheapest cloud option. Effort 'low' turns thinking off.",
    privacy: "Snippets of your repo go to DeepSeek, whose servers are in China and whose terms allow training on inputs.",
    models: [
      { id: "deepseek-flash", label: "DeepSeek V4.1 Flash — fast, very cheap (default)", tools: "confident", reasoning: true,
        price: { in: 0.3, out: 1.2, cacheRead: 0.006, unverified: true, note: "peak price; halves off-peak (UTC)" } },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro — strongest", tools: "confident", reasoning: true,
        price: { in: 1.32, out: 3.96, cacheRead: 0.044, unverified: true, note: "peak price; halves off-peak (UTC)" } },
    ],
  },
  xai: {
    id: "xai", label: "xAI (Grok)", env: "XAI_API_KEY", wire: "xai",
    default_model: "grok-4.3", strict_tools: false,
    url: "https://console.x.ai", hint: "Uses xAI's Responses API with store:false.",
    privacy: "Snippets of your repo go to xAI's API on your key. WalkMyCode sends store:false so nothing is retained.",
    models: [
      { id: "grok-4.3", label: "Grok 4.3 — 1M context, cheap (default)", tools: "best-effort", reasoning: true,
        price: { in: 1.25, out: 2.5, unverified: true, note: "<200k-token prompts; doubles above" } },
      { id: "grok-4.7", label: "Grok 4.7 — flagship", tools: "best-effort", reasoning: true,
        price: { in: 2, out: 6, unverified: true, note: "<200k-token prompts; doubles above" } },
    ],
  },
  local: {
    id: "local", label: "Local (Ollama / LM Studio)", env: null, wire: "openai-compatible",
    base_url: "http://localhost:11434/v1", base_url_editable: true,
    models: [], models_freeform: true, default_model: "", strict_tools: false,
    url: "https://ollama.com", hint: "Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1. Tool quality depends on the model.",
    privacy: "Nothing leaves this computer.",
  },
  // A coding agent on this computer, on the user's own Claude plan (./cli.ts). Last, so the API-key providers keep their order.
  "claude-code": {
  id: "claude-code",
  label: "Claude Code (my subscription)",
  env: null,
  wire: "cli",
  models: [
    // The same models as the API, on the user's plan (a model the plan doesn't include says so when asked).
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 — quick answers (default)", price: null, tools: "confident", reasoning: true },
    { id: "claude-opus-5-5", label: "Claude Opus 5.5 — most capable everyday", price: null, tools: "confident", reasoning: true },
    { id: "claude-fable-5-2", label: "Claude Fable 5.2 — Anthropic's most capable; slowest", price: null, tools: "confident", reasoning: true },
    { id: "claude-fable-5-1", label: "Claude Fable 5.1", price: null, tools: "confident", reasoning: true },
    { id: "claude-fable-5", label: "Claude Fable 5", price: null, tools: "confident", reasoning: true },
    { id: "claude-opus-5", label: "Claude Opus 5", price: null, tools: "confident", reasoning: true },
    { id: "claude-opus-4-8", label: "Claude Opus 4.8", price: null, tools: "confident", reasoning: true },
    { id: "claude-opus-4-7", label: "Claude Opus 4.7", price: null, tools: "confident", reasoning: true },
    { id: "claude-opus-4-6", label: "Claude Opus 4.6", price: null, tools: "confident", reasoning: true },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5", price: null, tools: "confident", reasoning: true },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", price: null, tools: "confident", reasoning: true },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 — fastest", price: null, tools: "confident", reasoning: true },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", price: null, tools: "confident", reasoning: true },
  ],
  default_model: "claude-sonnet-5-5",
  strict_tools: false,
  url: "https://claude.com/product/claude-code",
  hint: "Answers on your Claude plan, through Claude Code on this computer: no API key. Install Claude Code and sign in once (run claude).",
  privacy: "Your question and the code Claude reads go to Anthropic through your own Claude Code, on your plan.",
  },
  // OpenAI's Codex on this computer, on the user's ChatGPT plan (./cli.ts, agents.ts).
  codex: {
    id: "codex",
    label: "Codex (my ChatGPT plan)",
    env: null,
    wire: "cli",
    models: [
      { id: "gpt-6.1-sol", label: "GPT-6.1 Sol — balanced (default)", price: null, tools: "confident", reasoning: true },
      { id: "gpt-6-astra", label: "GPT-6 Astra — flagship, slower", price: null, tools: "confident", reasoning: true },
      { id: "gpt-6-luna", label: "GPT-6 Luna — fastest", price: null, tools: "confident", reasoning: true },
    ],
    default_model: "gpt-6.1-sol",
    strict_tools: false,
    url: "https://developers.openai.com/codex/cli",
    hint: "Answers on your ChatGPT plan, through Codex on this computer: no API key. Install Codex and sign in once (run codex, choose Sign in with ChatGPT).",
    privacy: "Your question and the code Codex reads go to OpenAI through your own Codex, on your ChatGPT plan.",
  },
  // Google's Gemini CLI on this computer, on the user's Google account (./cli.ts, agents.ts).
  "gemini-cli": {
    id: "gemini-cli",
    label: "Gemini CLI (my Google account)",
    env: null,
    wire: "cli",
    models: [
      { id: "auto", label: "Auto — the Gemini CLI picks (default)", price: null, tools: "confident", reasoning: true },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", price: null, tools: "confident", reasoning: true },
      { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash — fastest", price: null, tools: "confident", reasoning: true },
    ],
    default_model: "auto",
    strict_tools: false,
    url: "https://github.com/google-gemini/gemini-cli",
    hint: "Answers on your Google account, through the Gemini CLI on this computer: no API key. Google no longer lets personal accounts use it; a Gemini Code Assist Standard or Enterprise account still can.",
    privacy: "Your question and the code Gemini reads go to Google through your own Gemini CLI, on your Google account.",
  },
};


export const DEFAULT = { provider: "anthropic" as ProviderId, model: "claude-opus-5-5", effort: "medium" as Effort };

// Optional bearer token for local servers (LM Studio's LM_API_TOKEN); allowlisted but never required.
// The voice keys (docs/VOICE.md §3): ElevenLabs reads aloud and runs the default lecturer;
// Deepgram reads aloud and runs the cheaper one.
export const EXTRA_KEY_ENVS = ["LOCAL_API_KEY", "DEEPGRAM_API_KEY", "ELEVENLABS_API_KEY"] as const;

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

/** The provider for an id, or undefined for anything not in the catalogue. */
export function providerFor(id: string): ProviderDef | undefined {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, id) ? PROVIDERS[id as ProviderId] : undefined;
}

/**
 * The model for an id: an exact match first, then the longest catalogue id
 * the given one starts with, so a vendor's dated echo (gpt-6.1-sol-2026-09-01)
 * still lands on its catalogue entry.
 */
export function modelFor(p: ProviderDef, id: string): ModelDef | undefined {
  const exact = p.models.find((m) => m.id === id);
  if (exact) return exact;
  let best: ModelDef | undefined;
  for (const m of p.models) {
    if (id.startsWith(m.id) && (!best || m.id.length > best.id.length)) best = m;
  }
  return best;
}

/** A provider's human label, or the id itself when it is not one of ours. */
export function labelOf(id: string): string {
  return providerFor(id)?.label ?? id;
}

/** Every env var the key writer may touch: one per keyed provider plus the extras. */
export function keyEnvAllowlist(): string[] {
  const envs = PROVIDER_IDS.map((id) => PROVIDERS[id].env).filter((e): e is string => e !== null);
  return [...envs, ...EXTRA_KEY_ENVS];
}
