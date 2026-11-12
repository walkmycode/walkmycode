// The one place the Vercel AI SDK and the @ai-sdk/* provider packages are
// imported at runtime. Everything provider-specific that has to go over the
// wire (model construction, tool shapes, cache breakpoints, reasoning
// options, usage normalisation) is decided here, so an SDK bump is a change
// to this file plus a green test run. `fetch` is injectable so tests can
// capture the outbound request and replay recorded streams without keys.
import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import { createHash } from "node:crypto";
import { jsonSchema, tool, type JSONSchema7, type JSONValue, type LanguageModel, type LanguageModelUsage, type SystemModelMessage, type Tool } from "ai";
import { SYSTEM, TOUR_ADDENDUM } from "@/lib/claude/prompts";
import { TOOLS, TOUR_TOOL, type ToolDef } from "@/lib/claude/tools";
import { modelFor, PROVIDERS, type Effort, type ProviderId } from "./catalogue";
import type { Resolved, Usage } from "./wire";

// The route drives the step with these; re-exported so it never imports "ai" itself.
export { stepCountIs, streamText } from "ai";

export type FetchLike = typeof globalThis.fetch;
/** streamText's providerOptions: one JSON object per provider name. */
export type ProviderOptions = Record<string, Record<string, JSONValue | undefined>>;

const DEFAULT_MAX_OUTPUT = 8000;
const MAP_SUMMARY_CHARS = 60_000;
const CACHE = { anthropic: { cacheControl: { type: "ephemeral" } } } as const;

const models = new Map<string, LanguageModel>();

/** The endpoint for a provider: the saved one for editable providers, else the catalogue's. */
export function baseUrlFor(r: Resolved): string | undefined {
  return r.base_url ?? PROVIDERS[r.provider].base_url;
}

function build(r: Resolved, key: string, fetch?: FetchLike): LanguageModel {
  const baseURL = baseUrlFor(r);
  switch (PROVIDERS[r.provider].wire) {
    case "anthropic":
      return createAnthropic({ apiKey: key, baseURL, fetch })(r.model);
    case "openai-responses":
      return createOpenAI({ apiKey: key, baseURL, fetch })(r.model);
    case "google":
      return createGoogleGenerativeAI({ apiKey: key, baseURL, fetch })(r.model);
    case "groq":
      return createGroq({ apiKey: key, baseURL, fetch })(r.model);
    case "deepseek":
      return createDeepSeek({ apiKey: key, baseURL, fetch })(r.model);
    case "xai":
      return createXai({ apiKey: key, baseURL, fetch })(r.model);
    case "openai-compatible":
      return createOpenAICompatible({ name: r.provider, baseURL: baseURL ?? "", apiKey: key, fetch, includeUsage: true })(r.model);
    case "cli":
      throw new Error("A coding agent on this computer is run by ./cli.ts, not the SDK.");
  }
}

/**
 * A LanguageModel for the resolved choice, cached by (provider, model, key,
 * base_url) so a key pasted in Settings takes effect on the next call with
 * no restart. A custom fetch bypasses the cache: it belongs to one test.
 */
export function makeModel(r: Resolved, key: string, fetch?: FetchLike): LanguageModel {
  if (fetch) return build(r, key, fetch);
  const id = [r.provider, r.model, key, baseUrlFor(r) ?? ""].join("\u0000");
  let m = models.get(id);
  if (!m) {
    m = build(r, key);
    models.set(id, m);
  }
  return m;
}

/**
 * WalkMyCode's tools in SDK shape, without `execute`: every step that wants a
 * tool ends with finishReason 'tool-calls' and the browser runs them.
 * `strict` only goes out on finish_tour and only where the provider honours
 * it; the last tool carries Anthropic's cache breakpoint.
 */
export function toSdkTools(mode: "ask" | "tour", provider: ProviderId): Record<string, Tool> {
  const defs: ToolDef[] = [...TOOLS, ...(mode === "tour" ? [TOUR_TOOL] : [])];
  const p = PROVIDERS[provider];
  const out: Record<string, Tool> = {};
  defs.forEach((def, i) => {
    out[def.name] = tool({
      description: def.description,
      inputSchema: jsonSchema(def.input_schema as JSONSchema7),
      ...(def.strict && p.strict_tools ? { strict: true } : {}),
      ...(p.wire === "anthropic" && i === defs.length - 1 ? { providerOptions: CACHE } : {}),
    });
  });
  return out;
}

/** The two system messages, always in this order so auto-caching providers see a stable prefix. */
export function systemMessages(mode: "ask" | "tour", mapSummary: string, provider: ProviderId): SystemModelMessage[] {
  const cache = PROVIDERS[provider].wire === "anthropic" ? { providerOptions: CACHE } : {};
  return [
    { role: "system", content: SYSTEM + (mode === "tour" ? TOUR_ADDENDUM : ""), ...cache },
    { role: "system", content: mapSummary.slice(0, MAP_SUMMARY_CHARS), ...cache },
  ];
}

// OpenAI models that 400 on reasoning effort 'none' or 'minimal'.
const OPENAI_MIN_LOW = /^(gpt-6-astra|gpt-6\.1-sol)/;
// OpenAI models where 'none' is the cheap setting.
const OPENAI_HAS_NONE = /^(gpt-6-luna|gpt-5\.4-mini)/;
const HAIKU_BUDGET: Record<Effort, number> = { low: 2048, medium: 6000, high: 12000 };
/** Models the server-side refusal fallback (fallbacks: "default") is documented for. */
const ANTHROPIC_FALLBACK = /^claude-(fable-5-[12]|opus-5-5|opus-5$|sonnet-5-5)/;

/** The provider-specific reasoning knob for an effort level, per the table in docs/PROVIDERS.md §4. */
export function reasoningOptions(provider: ProviderId, model: string, effort: Effort): ProviderOptions {
  const p = PROVIDERS[provider];
  const def = modelFor(p, model);
  if (def && !def.reasoning) return {};
  switch (provider) {
    case "anthropic":
      // Haiku 4.5 still thinks on a budget; every later model thinks adaptively, paced by effort (Fable and
      // Opus 5.5 reject anything else). The server-side refusal fallback goes only where it is documented.
      if (/^claude-haiku-4-5/.test(model)) return { anthropic: { thinking: { type: "enabled", budgetTokens: HAIKU_BUDGET[effort] }, fallbacks: "default" } };
      return { anthropic: { effort, thinking: { type: "adaptive" }, ...(ANTHROPIC_FALLBACK.test(model) ? { fallbacks: "default" } : {}) } };
    case "openai": {
      const level = OPENAI_HAS_NONE.test(model) && !OPENAI_MIN_LOW.test(model) ? { low: "none", medium: "low", high: "high" }[effort] : effort;
      return { openai: { reasoningEffort: level } };
    }
    case "gemini":
      return { google: { thinkingConfig: { thinkingLevel: effort } } };
    case "groq":
      return def ? { groq: { reasoningEffort: effort } } : {};
    case "deepseek":
      return effort === "low"
        ? { deepseek: { thinking: { type: "disabled" } } }
        : { deepseek: { thinking: { type: "enabled" }, reasoningEffort: effort === "medium" ? "low" : "high" } };
    case "xai":
      return { xai: { reasoningEffort: effort } };
    case "claude-code":
    case "codex":
    case "gemini-cli":
      return {};
    case "local":
      return {};
  }
}

/** "# Repo: name" (one app) or "# Workspace: name (2 repos…) — 3 services…" is the first line of every map summary. */
function repoName(mapSummary: string): string {
  const one = /^# Repo: (.*)$/m.exec(mapSummary)?.[1];
  if (one !== undefined) return one.trim();
  return /^# Workspace: (.*?)(?: \(\d+ repos:| — |$)/m.exec(mapSummary)?.[1]?.trim() ?? "";
}

/**
 * Everything streamText needs besides model, tools and messages. No
 * temperature or topP anywhere; toolChoice is always 'auto'; OpenAI and xAI
 * get store:false plus the encrypted-reasoning include so their round-trip
 * state comes back in providerOptions rather than living on their servers.
 * @ai-sdk/xai appends that include itself whenever store is false (without
 * de-duplicating), so it is only passed explicitly for OpenAI.
 */
export function callOptions(r: Resolved, mapSummary: string) {
  return {
    ...textOptions(r, repoName(mapSummary) + String(mapSummary.length)),
    toolChoice: "auto" as const,
    allowSystemInMessages: true as const,
  };
}

/**
 * The tool-free part of callOptions: output cap, the effort setting as the
 * provider's reasoning knob, and store:false for OpenAI and xAI. Used as-is
 * by a plain text answer (the Learn room); `cacheSeed` names the prompt
 * family for OpenAI's prompt cache key.
 */
export function textOptions(r: Resolved, cacheSeed: string) {
  const p = PROVIDERS[r.provider];
  const def = modelFor(p, r.model);
  const providerOptions = reasoningOptions(r.provider, r.model, r.effort);
  if (r.provider === "openai") {
    const cacheKey = createHash("sha1").update(cacheSeed).digest("hex");
    providerOptions.openai = { ...providerOptions.openai, store: false, include: ["reasoning.encrypted_content"], promptCacheKey: `lantern:${cacheKey}` };
  }
  if (r.provider === "xai") providerOptions.xai = { ...providerOptions.xai, store: false };
  return {
    maxOutputTokens: def?.maxOutput ?? DEFAULT_MAX_OUTPUT,
    providerOptions,
  };
}

/**
 * The SDK's usage in Anthropic field names. input_tokens is the UNCACHED
 * count: noCacheTokens when the provider reports it, else total minus the
 * cache reads and writes. The SDK's inputTokens is the grand total for every
 * provider (Anthropic's mapper adds the cache counts to input_tokens; OpenAI's
 * prompt_tokens already includes them), so the subtraction is right for both.
 */
export function normaliseUsage(u: LanguageModelUsage | undefined): Usage {
  const cache_read = u?.inputTokenDetails?.cacheReadTokens ?? 0;
  const cache_creation = u?.inputTokenDetails?.cacheWriteTokens ?? 0;
  return {
    input_tokens: u?.inputTokenDetails?.noCacheTokens ?? Math.max(0, (u?.inputTokens ?? 0) - cache_read - cache_creation),
    output_tokens: u?.outputTokens ?? 0,
    cache_read_input_tokens: cache_read,
    cache_creation_input_tokens: cache_creation,
    reasoning_tokens: u?.outputTokenDetails?.reasoningTokens ?? 0,
    known: u?.inputTokens != null || u?.outputTokens != null,
  };
}
