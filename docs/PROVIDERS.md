# WalkMyCode multi-provider layer — final design spec

Base: the Vercel AI SDK design (winner), with the grafts and fixes the judges asked for:

- **Fix:** Anthropic server-side fallback is *not* lost. `@ai-sdk/anthropic` 4.0.68 accepts `providerOptions.anthropic.fallbacks: "default"` and adds the `server-side-fallback-2026-07-01` beta itself (verified: `node_modules/@ai-sdk/anthropic/dist/index.js:1241-1250, 4569-4570, 4779-4782` in the scratchpad install). Parity with today's `route.ts` is full.
- **Fix:** usage normalisation never falls back to a cache-inclusive `inputTokens`. Rule: `no_cache = inputTokenDetails.noCacheTokens ?? max(0, inputTokens − cacheRead − cacheWrite)`.
- **Fix:** SDK drift surface is contained. Exact-pinned versions, every SDK import goes through one file (`src/lib/providers/sdk.ts`), a recorded-fixture test suite that runs without keys, and a smoke script that gates each provider. Upgrading the SDK is a one-file change plus a green test run.
- **Fix:** `providerOptions` can never be stripped by accident: history entries are opaque to the client, `trimHistory` only slices whole messages, the server tags every request with the provider that produced the history and refuses a mismatch.
- **Grafted from A:** never send `temperature`/`top_p`; `toolChoice: "auto"` only; provider 400 text shown in `detail` (scrubbed for key-shaped strings); history reset on provider change; server-side "Settings changed — ask again" check.
- **Grafted from B:** loopback + same-origin guard (now also on `/api/claude`), `GET /api/config/readiness`, `GET /api/config/models` proxy for local servers, DeepSeek `low` = thinking off, model validated against the provider's list (local providers exempt), `scripts/smoke-providers.ts` as the promotion gate.

All WalkMyCode paths are under `codebase-guide\`. iReliabee (`ireliabee-desktop\`) is read-only reference.

---

## 1. Architecture (one paragraph)

The browser keeps doing what it does today: `Guide.tsx` calls `ask()` in `src/lib/claude/client.ts`, which POSTs the conversation to `/api/claude`, streams `{type:'text'}` deltas, receives one `{type:'message'}` at the end, runs any tool calls locally with `runTool` against the repo held in memory, and loops (max 10 rounds). What changes is inside the server route and the shape of the messages the browser stores. `src/app/api/claude/route.ts` no longer calls `@anthropic-ai/sdk` directly; per request it loads the saved choice from `.walkmycode/config.json` (falling back to `WALKMYCODE_*` env vars (or the old `WALKMYCODE_*` names), then the default `anthropic / claude-opus-5-5 / medium`), resolves the key from `.walkmycode/keys.env` then `process.env`, builds a `LanguageModel` from the `PROVIDERS` catalogue via the matching `@ai-sdk/*` provider package, and runs **one** `streamText()` step with WalkMyCode's tools declared **without `execute`**, so every step that wants a tool ends with `finishReason: 'tool-calls'` and the calls come back to the browser. The browser stores the SDK's `response.messages[0]` (an `AssistantModelMessage`) verbatim, which is what carries each vendor's private round-trip state (OpenAI reasoning item ids / encrypted content, Gemini thought signatures, DeepSeek `reasoning_content`, Anthropic thinking signatures and fallback blocks) in `providerOptions`; tool results go back as a `role:'tool'` message. Configuration is iReliabee's pattern ported to Next: one catalogue module shared by server and UI, keys written by the server to a private local file and only ever reported as `has_key`, the saved choice in a separate JSON file, format-only validation on save, real errors classified at call time into `missing_key / invalid_key / out_of_credits / rate_limited / model_unavailable / network / unknown` with an "Open settings" action. Write endpoints and the ask endpoint are guarded to loopback + same-origin. No hosted service, no accounts, no tiers, bring-your-own keys.

```
Browser                                          Next.js server (nodejs runtime, per request, stateless)
Guide.tsx ─ ask() ─ POST /api/claude ──────────▶ route.ts
  history: HistoryEntry[] (assistant msgs verbatim)  ├ guard.ts        loopback + same-origin
  runTool() → {role:'tool'} message                   ├ config.ts       .walkmycode/config.json | WALKMYCODE_* | DEFAULT
  ◀── SSE text / tool / message / error               ├ keys.ts         .walkmycode/keys.env | process.env  → has_key only
Settings.tsx ─ /api/config, /api/config/key,          ├ sdk.ts          makeModel(provider, model, key, base_url)
               /api/config/readiness, /models         └ streamText({ tools w/o execute, stopWhen: stepCountIs(1) })
cost.ts ◀ normalised usage + requested model id            ↳ @ai-sdk/anthropic | openai | google | groq | deepseek | xai | openai-compatible
```

---

## 2. The PROVIDERS catalogue — `src/lib/providers/catalogue.ts`

Shared by server and client. Contains no secrets. Prices are $/M tokens as read from vendor pages on 2026-09-29 (research notes 4); anything not read directly from a vendor page carries `unverified: true` and a `note`.

```ts
// src/lib/providers/catalogue.ts
export type ProviderId =
  | "anthropic" | "openai" | "gemini" | "groq" | "deepseek" | "xai" | "local";

export type Wire =
  | "anthropic"            // @ai-sdk/anthropic
  | "openai-responses"     // @ai-sdk/openai  (openai(id) = Responses API)
  | "google"               // @ai-sdk/google  (native generateContent)
  | "groq"                 // @ai-sdk/groq
  | "deepseek"             // @ai-sdk/deepseek
  | "xai"                  // @ai-sdk/xai     (Responses API)
  | "openai-compatible";   // @ai-sdk/openai-compatible (Ollama, LM Studio, anything else)

export type Effort = "low" | "medium" | "high";

export interface Price {
  in: number;            // $/M uncached input tokens
  out: number;           // $/M output tokens (reasoning tokens are inside output for every vendor)
  cacheRead?: number;    // $/M cached input tokens; defaults to `in` when absent
  cacheWrite?: number;   // $/M cache-write tokens; defaults to `in` when absent (only Anthropic bills a premium)
  unverified?: boolean;  // not read directly from a vendor price page, or time/peak dependent
  note?: string;
}

export interface ModelDef {
  id: string;                          // exact vendor id, sent as-is
  label: string;                       // "Claude Opus 5.5 — most capable (default)"
  price: Price | null;                 // null = free/local/unknown → counted as "unknown" in the meter
  tools: "confident" | "best-effort";  // confident = passed scripts/smoke-providers.ts
  reasoning: boolean;                  // model accepts an effort/thinking option
  maxOutput?: number;                  // default 8000
}

export interface ProviderDef {
  id: ProviderId;
  label: string;                       // "Anthropic (Claude)"
  env: string | null;                  // key env var; null = no key needed
  wire: Wire;
  base_url?: string;                   // default endpoint; editable in Settings only when base_url_editable
  base_url_editable?: boolean;
  models: ModelDef[];                  // free-text model id allowed only when models_freeform
  models_freeform?: boolean;
  default_model: string;
  strict_tools: boolean;               // send strict:true on finish_tour
  url: string;                         // where to get a key
  hint: string;                        // one line under the picker
  privacy: string;                     // one sentence shown in Settings and on the connect screen
}

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  anthropic: {
    id: "anthropic", label: "Anthropic (Claude)", env: "ANTHROPIC_API_KEY", wire: "anthropic",
    default_model: "claude-opus-5-5", strict_tools: true,
    url: "https://platform.claude.com", hint: "WalkMyCode's default. Prompt caching keeps repeat questions cheap.",
    privacy: "Snippets of your repo go to Anthropic's API on your key. Anthropic does not train on API traffic.",
    models: [
      { id: "claude-opus-5-5",   label: "Claude Opus 5.5 — most capable (default)", tools: "confident", reasoning: true,
        price: { in: 4,  out: 20, cacheRead: 0.20, cacheWrite: 5 } },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 — speed + intelligence",  tools: "confident", reasoning: true,
        price: { in: 2,  out: 10, cacheRead: 0.20, cacheWrite: 2.5, unverified: true, note: "cacheWrite derived from the 1.25× rule" } },
      { id: "claude-haiku-4-5",  label: "Claude Haiku 4.5 — fastest, cheapest",      tools: "confident", reasoning: true,
        price: { in: 1,  out: 5,  cacheRead: 0.10, cacheWrite: 1.25, unverified: true, note: "cacheWrite derived from the 1.25× rule" } },
    ],
  },
  openai: {
    id: "openai", label: "OpenAI", env: "OPENAI_API_KEY", wire: "openai-responses",
    base_url: "https://api.openai.com/v1", default_model: "gpt-6.1-sol", strict_tools: true,
    url: "https://platform.openai.com/api-keys", hint: "Uses the Responses API (required for GPT-6 tool calling).",
    privacy: "Snippets of your repo go to OpenAI's API on your key. WalkMyCode sends store:false so nothing is retained.",
    models: [
      { id: "gpt-6.1-sol", label: "GPT-6.1 Sol — balanced (default)", tools: "confident", reasoning: true, maxOutput: 16000,
        price: { in: 2,    out: 10,  cacheRead: 0.10 } },
      { id: "gpt-6-luna",  label: "GPT-6 Luna — small and cheap",     tools: "confident", reasoning: true, maxOutput: 16000,
        price: { in: 0.10, out: 0.50, cacheRead: 0.01 } },
      { id: "gpt-6-astra", label: "GPT-6 Astra — flagship",           tools: "confident", reasoning: true, maxOutput: 16000,
        price: { in: 10,   out: 50,  cacheRead: 1 } },
      { id: "gpt-5.4-mini", label: "GPT-5.4 mini — legacy, cheap",    tools: "confident", reasoning: true, maxOutput: 16000,
        price: { in: 0.75, out: 4.50, unverified: true, note: "cacheRead not read from the price page" } },
    ],
  },
  gemini: {
    id: "gemini", label: "Google Gemini", env: "GEMINI_API_KEY", wire: "google",
    default_model: "gemini-3.8-flash", strict_tools: false,
    url: "https://aistudio.google.com/apikey", hint: "Free tier available for Flash models.",
    privacy: "Snippets of your repo go to Google's Gemini API on your key. Free-tier traffic may be used to improve Google products.",
    models: [
      { id: "gemini-3.8-flash",       label: "Gemini 3.8 Flash — fast flagship (default)", tools: "confident", reasoning: true,
        price: { in: 0.75, out: 3.75, cacheRead: 0.075, unverified: true, note: "promotional; doubles to $1.50/$7.50 on 2027-01-01" } },
      { id: "gemini-3.5-flash-lite",  label: "Gemini 3.5 Flash-Lite — cheapest",           tools: "confident", reasoning: true,
        price: { in: 0.30, out: 2.50 } },
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview) — reasoning",        tools: "best-effort", reasoning: true,
        price: { in: 2,    out: 12, unverified: true, note: "≤200k-token prompts; $4/$18 above" } },
    ],
  },
  groq: {
    id: "groq", label: "Groq", env: "GROQ_API_KEY", wire: "groq",
    default_model: "openai/gpt-oss-120b", strict_tools: false,
    url: "https://console.groq.com/keys", hint: "Very fast. Groq retires models often; check the picker if one stops working.",
    privacy: "Snippets of your repo go to Groq's API on your key.",
    models: [
      { id: "openai/gpt-oss-120b",     label: "GPT-OSS 120B — fast flagship (default)", tools: "confident", reasoning: true,
        price: { in: 0.15,  out: 0.60 } },
      { id: "openai/gpt-oss-20b",      label: "GPT-OSS 20B — fastest",                  tools: "confident", reasoning: true,
        price: { in: 0.075, out: 0.30 } },
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B — parallel tools",         tools: "best-effort", reasoning: false,
        price: { in: 0.59,  out: 0.79, unverified: true, note: "docs say Contact Sales; third-party figure" } },
    ],
  },
  deepseek: {
    id: "deepseek", label: "DeepSeek", env: "DEEPSEEK_API_KEY", wire: "deepseek",
    base_url: "https://api.deepseek.com", default_model: "deepseek-flash", strict_tools: false,
    url: "https://platform.deepseek.com/api_keys", hint: "Cheapest cloud option. Effort 'low' turns thinking off.",
    privacy: "Snippets of your repo go to DeepSeek, whose servers are in China and whose terms allow training on inputs.",
    models: [
      { id: "deepseek-flash",  label: "DeepSeek V4.1 Flash — fast, very cheap (default)", tools: "confident", reasoning: true,
        price: { in: 0.30, out: 1.20, cacheRead: 0.006, unverified: true, note: "peak price; halves off-peak (UTC)" } },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro — strongest",                      tools: "confident", reasoning: true,
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
        price: { in: 1.25, out: 2.50, unverified: true, note: "<200k-token prompts; doubles above" } },
      { id: "grok-4.7", label: "Grok 4.7 — flagship",                    tools: "best-effort", reasoning: true,
        price: { in: 2,    out: 6,    unverified: true, note: "<200k-token prompts; doubles above" } },
    ],
  },
  local: {
    id: "local", label: "Local (Ollama / LM Studio)", env: null, wire: "openai-compatible",
    base_url: "http://localhost:11434/v1", base_url_editable: true,
    models: [], models_freeform: true, default_model: "", strict_tools: false,
    url: "https://ollama.com", hint: "Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1. Tool quality depends on the model.",
    privacy: "Nothing leaves this computer.",
  },
};

export const DEFAULT = { provider: "anthropic" as ProviderId, model: "claude-opus-5-5", effort: "medium" as Effort };

// Optional bearer token for local servers (LM Studio's LM_API_TOKEN); allowlisted but never required.
export const EXTRA_KEY_ENVS = ["LOCAL_API_KEY", "DEEPGRAM_API_KEY"] as const;

export function providerFor(id: string): ProviderDef | undefined;
export function modelFor(p: ProviderDef, id: string): ModelDef | undefined;   // exact, then startsWith (dated echoes)
export function labelOf(id: string): string;                                   // "Anthropic (Claude)" | id
export function keyEnvAllowlist(): string[];                                   // every env + EXTRA_KEY_ENVS
```

Deliberately not carried over from iReliabee: `deepseek-chat`, `deepseek-reasoner`, Gemini 2.5, Kimi K2 (retired). Mistral is not in v1 (9-char tool-id constraint, unverified alias mapping); it slots into `openai-compatible` later.

---

## 3. Internal contract and stream events — `src/lib/providers/wire.ts`

```ts
// src/lib/providers/wire.ts  (shared; type-only imports from "ai" are tree-shaken from the client bundle)
import type { AssistantModelMessage, ModelMessage, ToolModelMessage, UserModelMessage } from "ai";
import type { Effort, ProviderId } from "./catalogue";

/** What the browser keeps. Assistant entries are the server's message verbatim — never edited. */
export type HistoryEntry =
  | { role: "user";      content: string }                               // UserModelMessage subset
  | { role: "assistant"; message: AssistantModelMessage }               // opaque; providerOptions intact
  | { role: "tool";      content: ToolResultPart[] };                    // ToolModelMessage["content"]

export interface ToolResultPart {
  type: "tool-result"; toolCallId: string; toolName: string;
  output: { type: "text"; value: string } | { type: "error-text"; value: string };
}

export interface ToolCall { toolCallId: string; toolName: string; input: Record<string, unknown> }

export interface AskRequest {
  history: HistoryEntry[];
  history_provider: ProviderId | null;   // provider that produced every assistant entry; null when history is empty
  mode: "ask" | "tour";
  mapSummary: string;
}

/** Anthropic field names kept so cost.ts and the header pill change minimally. */
export interface Usage {
  input_tokens: number;                  // UNCACHED input tokens (noCache)
  output_tokens: number;                 // includes reasoning tokens
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  reasoning_tokens: number;
  known: boolean;                        // false when the provider reported no usage (cut stream, local server)
}

export type Finish = "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other";

export type ErrorCode =
  | "no_model" | "missing_key" | "invalid_key" | "out_of_credits" | "rate_limited"
  | "model_unavailable" | "stale_history" | "forbidden" | "network" | "unknown";

export interface FriendlyError {
  code: ErrorCode; title: string; message: string;
  action: "settings" | "retry" | null;
  provider?: ProviderId; status?: number;
  detail?: string;                       // first 300 chars of the provider's body, key-shaped strings scrubbed
}

/** Server → browser SSE, framed exactly as today: `data: <json>\n\n`. */
export type StreamEvent =
  | { type: "text";    text: string }                                    // fullStream text-delta
  | { type: "tool";    name: string }                                    // fullStream tool-input-start (early trace)
  | { type: "message"; message: AssistantModelMessage; finish: Finish; toolCalls: ToolCall[];
                       usage: Usage; provider: ProviderId; model: string }   // model = requested id, not the vendor's dated echo
  | { type: "error";   error: FriendlyError };

/** Server side only: what the route hands to sdk.ts */
export interface Resolved { provider: ProviderId; model: string; effort: Effort; base_url?: string }

export function toModelMessages(history: HistoryEntry[]): ModelMessage[];   // server; user→{role:'user',content}, assistant→message, tool→{role:'tool',content}
```

Stop-reason handling in the browser loop: `tool-calls` → run tools, push `{role:'tool'}` and continue; `length` → append "(Cut short at the output limit.)" and stop; `content-filter` → append "(The model declined to answer this one.)" and stop; `stop`/`other`/`error` → stop.

---

## 4. Tool-call translation table per provider family

WalkMyCode's tool definitions stay `ToolDef { name, description, input_schema, strict? }` in `src/lib/claude/tools.ts`. `sdk.ts` maps each to `tool({ description, inputSchema: jsonSchema(input_schema), strict })` **with no `execute`**. `strict: true` is only forwarded for `finish_tour` and only when `PROVIDERS[p].strict_tools`; the four repo tools have optional properties and are never sent strict. `toolChoice: "auto"` always; `temperature`, `topP`, `parallel_tool_calls` never set (Groq gpt-oss and Anthropic 5.5 quirks are thereby avoided). The SDK provider package does the wire work; the table records what actually goes over the wire so tests can assert it from recorded fixtures.

| Family (wire) | Tool definition on the wire | Assistant tool call ↔ WalkMyCode | Tool result on the wire | Round-trip state that must survive (carried in `providerOptions` of the stored assistant message) | Streamed shape the SDK consumes |
|---|---|---|---|---|---|
| **anthropic** | `tools[{name, description, input_schema, strict?}]`; last tool gets `cache_control: {type:'ephemeral'}` via `providerOptions.anthropic.cacheControl`; both system messages get the same | `tool_use {id: toolu_…, name, input}` ↔ `tool-call` part | one `user` message holding every `tool_result {tool_use_id, content, is_error}` for the step | `thinking`/`redacted_thinking` blocks + `signature`, and `fallback` blocks when `fallbacks:'default'` served the request — the SDK re-emits them from the reasoning parts' `providerOptions.anthropic.signature` / fallback metadata | `content_block_start(tool_use)` → `input_json_delta.partial_json` → `content_block_stop`; `message_delta.stop_reason: tool_use` → `tool-calls` |
| **openai-responses** (OpenAI) | `tools[{type:'function', name, description, parameters, strict}]`; `reasoning:{effort}`; `store:false`; `include:['reasoning.encrypted_content']`; `max_output_tokens`; `prompt_cache_key` | `function_call {call_id: call_…, name, arguments}` ↔ `tool-call` | `function_call_output {call_id, output}` items, one per result | `reasoning` items: the SDK re-sends `item_reference {id}` (from `providerOptions.openai.itemId`) or the encrypted content (`reasoningEncryptedContent`) before the function calls they preceded — dropping them 400s | `response.output_item.added(function_call)` → `response.function_call_arguments.delta` → `.done` → `response.output_item.done`; `response.completed` carries usage and `incomplete_details.reason` |
| **xai** (Responses) | as OpenAI Responses minus `prompt_cache_key`; `store:false`; `include: 'reasoning.encrypted_content'` | `function_call` ↔ `tool-call` (arrives whole in one chunk; harmless) | `function_call_output` | `reasoning.encrypted_content` replayed from `providerOptions.xai.reasoningEncryptedContent` | same event family as OpenAI |
| **google** (native Gemini) | `tools[{functionDeclarations:[{name, description, parameters}]}]`; `systemInstruction`; `generationConfig.thinkingConfig.thinkingLevel`; `maxOutputTokens` | `functionCall {name, args}` part (+ `thoughtSignature`) ↔ `tool-call` (SDK synthesises an id) | `functionResponse {name, response}` parts in a `user` content, all results for the step together | `thoughtSignature` on each tool-call part, replayed from `providerOptions.google.thoughtSignature`; if missing on a Gemini 3 model the SDK sends the documented `skip_thought_signature_validator` sentinel and warns instead of failing | `streamGenerateContent?alt=sse` parts; `finishReason: STOP` with function calls → `tool-calls` |
| **groq / deepseek / openai-compatible** (Chat Completions) | `tools[{type:'function', function:{name, description, parameters}}]`; `[max_completion_tokens \| max_tokens]`; `stream_options:{include_usage:true}`; `reasoning_effort` where the catalogue says `reasoning`; DeepSeek `thinking:{type}` | `tool_calls[{id, type:'function', function:{name, arguments}}]` ↔ `tool-call` | one `{role:'tool', tool_call_id, content}` message per result, in call order, right after the assistant message | DeepSeek: `reasoning_content` on the assistant message (empty string on V4 when none) — required with tools or the API 400s; Groq/local: none | `delta.tool_calls[i]` fragments keyed by `index` (id + name first, arguments appended), usage in the final `choices: []` chunk or `x_groq.usage`; `finish_reason: tool_calls` → `tool-calls`, `length` → `length` |

Provider-specific reasoning options, chosen by `reasoningOptions(provider, model, effort)` in `sdk.ts`:

| provider | low | medium (default) | high |
|---|---|---|---|
| anthropic (Opus/Sonnet 5.5) | `{ effort:'low', thinking:{type:'adaptive'}, fallbacks:'default' }` | `effort:'medium'` | `effort:'high'` |
| anthropic (Haiku 4.5) | `thinking:{type:'enabled', budgetTokens:2048}` | `budgetTokens:6000` | `budgetTokens:12000` |
| openai gpt-6-astra / gpt-6.1-sol | `reasoningEffort:'low'` (never `none`/`minimal`: 400) | `'medium'` | `'high'` |
| openai gpt-6-luna / gpt-5.4-mini | `reasoningEffort:'none'` | `'low'` | `'high'` |
| gemini | `thinkingConfig:{thinkingLevel:'low'}` | `'medium'` | `'high'` |
| groq gpt-oss | `reasoningEffort:'low'` | `'medium'` | `'high'` (llama: nothing) |
| deepseek | `thinking:{type:'disabled'}` | `thinking:{type:'enabled'}, reasoningEffort:'low'` | `thinking:{type:'enabled'}, reasoningEffort:'high'` |
| xai | `reasoningEffort:'low'` | `'medium'` | `'high'` |
| local | nothing | nothing | nothing |

`maxOutputTokens = model.maxOutput ?? 8000`. Prompt caching: Anthropic explicit breakpoints (system ×2 + last tool, as today); OpenAI `promptCacheKey: "lantern:" + sha1(repoName + mapSummary.length)`; Gemini, DeepSeek, Groq automatic on the stable prefix (system messages are always `[SYSTEM(+TOUR_ADDENDUM), mapSummary.slice(0, 60_000)]` in that order).

---

## 5. Key storage, settings UI, readiness

### 5.1 Files (both under the already-gitignored `.walkmycode/`)

- `.walkmycode/config.json` — `{ "provider": "anthropic", "model": "claude-opus-5-5", "effort": "medium", "local_base_url": "http://localhost:11434/v1" }`. Merge-on-save (`cfg = load(); Object.assign(cfg, patch)`), temp file + `rename`.
- `.walkmycode/keys.env` — `KEY=value` lines. Written only by the server, never read by Next's env loader, mode `0600` attempted (`chmod` in `try/catch`; no-op on Windows, README says so).

### 5.2 `src/lib/providers/keys.ts` (server-only)

- `readKeys()` — parse the file (quotes stripped, `#` comments skipped), cached by `mtimeMs`, into a module-level `Map`. `process.env` is never mutated.
- `keyFor(providerId) → { value, source: "settings" | "env" } | null` — file first, then `process.env[env]`. `env === null` → `{ value: "local", source: "env" }` (Ollama ignores the bearer; LM Studio's optional token comes from `LOCAL_API_KEY`).
- `writeKey(env_var, value)` — port of iReliabee `_write_env_var` + `_clean_value`: allowlist (`keyEnvAllowlist()`), otherwise `400 Unknown env var: X`; trim; `> 1024` chars → `400 That key is far longer than any real one.`; any char `< 32` or `== 127` → `400 That key contains a line break or control character. Paste just the key.`; replace-or-append; write `keys.env.tmp`, chmod, `rename`; refresh the Map. Empty value or `DELETE` removes the line.
- `keyStatus() → Record<ProviderId, { has_key: boolean; source: "settings" | "env" | null }>`. Values never leave the module, are never logged, never appear in errors.

### 5.3 `src/lib/providers/guard.ts` (server-only)

`assertLocalSameOrigin(req)`: `Host` must be `localhost`, `127.0.0.1` or `[::1]` (any port) unless `WALKMYCODE_ALLOW_REMOTE=1`; and `Sec-Fetch-Site` ∈ `{same-origin, none}` or, when the header is absent, `Origin` is absent too or its host equals `Host`; `POST` bodies must be `content-type: application/json`. Failure → `403 { error: { code: "forbidden", title: "Settings can only be changed from this computer", message: "Open WalkMyCode at http://localhost:3000 to change keys or ask questions.", action: null } }`. Applied to **every** `/api/config*` handler **and** `/api/claude`, so a foreign page cannot spend the user's keys either.

### 5.4 Endpoints

| route | body → response |
|---|---|
| `GET /api/config` | `{ saved: {provider, model, effort, local_base_url}, source: "config" \| "env" \| "default", llm_providers: [{ id, label, env, has_key, source, wire, base_url, base_url_editable, models: [{id, label, tools, reasoning, price}], models_freeform, default_model, url, hint, privacy }], readiness: { llm: FriendlyError \| null } }` |
| `POST /api/config` | `{ provider, model, effort?, local_base_url? }` → `{ ok: true }`. 400 `Unknown provider: x`; 400 `Unknown model for x: y` unless `models_freeform` (then `/^[\w.:\/-]{1,120}$/`); `effort` ∈ low/medium/high; `local_base_url` must parse as `http(s)://`. Response also includes `readiness`. |
| `POST /api/config/key` | `{ env_var, value }` → `{ ok: true, has_key: true }`. Errors as in 5.2. |
| `DELETE /api/config/key` | `{ env_var }` → `{ ok: true, has_key: <bool from process.env> }` |
| `GET /api/config/readiness` | `{ llm: FriendlyError \| null }` |
| `GET /api/config/models?provider=local` | proxies `GET {base_url}/models` with a 2 s timeout → `{ models: string[] }` (`[]` on any failure). Also accepts `groq` (`/openai/v1/models`) so the picker can flag retired ids. |

### 5.5 Readiness — `src/lib/providers/config.ts: readiness()`

Port of iReliabee `resolve_llm`, returns `null` when ready, else:

| code | title | message | action |
|---|---|---|---|
| `no_model` | No AI model selected | Choose a model in Settings → Language model before asking. | settings |
| `missing_key` | {label} API key missing | Add your {label} key in Settings → Language model, or put {ENV} in .env.local. | settings |
| `model_unavailable` | {label} can't use this model | Pick a different model in Settings. | settings |
| `network` (local only) | Can't reach your local server | Nothing answered at {base_url}. Start Ollama or LM Studio and try again. | settings |

`client.ts` calls `GET /api/config/readiness` once per page load before the first question; `/api/claude` re-checks it and returns `{ type:'error' }` on the stream so the client path is one.

### 5.6 Call-time classification — `src/lib/providers/errors.ts: classify(err, provider)`

From `APICallError.statusCode` / `responseBody` / message: 401/403 or `/invalid api key|authentication|unauthorized/i` → `invalid_key` ("{label} rejected the API key" / "The key may be mistyped, revoked or expired. Paste a fresh key in Settings.", settings); 402 or `/credit balance|insufficient_quota|billing/i` → `out_of_credits` ("{label} account is out of credits" / "Top up your {label} balance, or switch to another provider in Settings.", settings); 429 → `rate_limited` ("{label} is busy right now" / "Too many requests or a temporary quota limit. Wait a moment and try again.", retry); 404 or `/model.*(not found|does not exist)|unknown model/i` → `model_unavailable`; `ECONNREFUSED|ENOTFOUND|fetch failed|timeout|aborted` → `network` ("Can't reach {label}" / "Check your internet connection. For local models: is the server running at {base_url}?"); else `unknown` ("{label} request failed" / first 300 chars of the body as `detail`, after scrubbing `/(sk|gsk|xai|AIza|sk-ant)[-_A-Za-z0-9]{8,}/g` → `[key]`). `stale_history` ("Settings changed" / "You switched provider mid-conversation. Ask again to start a fresh conversation on {label}.", retry) is raised by the route when `history_provider` ≠ the resolved provider.

### 5.7 Settings UI — `src/components/Settings.tsx`

Mounted as a fourth tab **Settings** in the `map/page.tsx` tab strip (`guide / details / files / settings`) and inline on the connect screen (`page.tsx`) as a "Model & keys" card. Opens on the `open-settings` custom event; emits `settings-saved` with `{ provider, model }`. Built with the existing `.panel / .ctl / .field / .note / .err` classes plus `.settings .chips .chip .keyrow .badge` (~40 lines in `globals.css`) so the motion-design pass can animate it without restructuring. Layout, in iReliabee's numbered-card style (uppercase muted field labels, 11px hints):

1. **Language model** — `ProviderPicker`: one chip per provider showing `label`, a green check when `has_key || env === null`, a red x otherwise; picking a provider resets the model to its `default_model`. Model `select` renders `${id} — ${label}` with a `· tools: best-effort` suffix where applicable and `· price unknown` when `price === null`; for `local` a text input backed by a `<datalist>` from `/api/config/models?provider=local` plus a **Server URL** field. **Effort** segmented control `low | medium | high`, hint: "Anthropic: thinking effort. Others: reasoning effort where the model has one. Low is cheapest."
2. **API key** — `KeyRow` for the active provider: `<code>{ENV}</code>` + `✓ set (Settings)` / `✓ set (.env.local)` / `not set`; `type="password"` input with Show/Hide toggle; placeholder `Paste new key to replace…` / `Paste API key…`; Enter submits; `Save` / `Saving…` disabled while saving or empty; input cleared after save and config refetched so the chip flips; `Remove` shown when `source === "settings"`. Hint: "Saved to .walkmycode/keys.env on this computer, readable by the WalkMyCode server only. Never sent anywhere but {label}." Local: "No key needed." with an "Optional token" disclosure for `LOCAL_API_KEY`. A link "Get a key ↗" to `url`.
3. **What leaves this computer** — the selected provider's `privacy` sentence.
4. **Save** — `POST /api/config`; inline status `Configuration saved` / `Save failed`; then `settings-saved`. A readiness banner at the top repeats `readiness.llm` (title + message) when set.

Entry points: `ModelBadge` pill in the `map/page.tsx` header next to the cost pill, `Anthropic · claude-opus-5-5` with a green/red dot from `readiness.llm`; click switches to the Settings tab. `Guide.tsx` renders errors as `<strong>{title}</strong> {message}` plus an **Open settings** button when `action === "settings"` and **Try again** when `action === "retry"`; on `settings-saved` with a changed provider it clears `history.current`, keeps the visible transcript and appends "Switched to {label} · {model}. The conversation context starts fresh." Copy throughout: second person, sentence case, what happened then what to do and where.

---

## 6. Cost metering — `src/lib/cost.ts`

- `normaliseUsage(u: LanguageModelUsage | undefined): Usage` (in `sdk.ts`, server): `cache_read = inputTokenDetails?.cacheReadTokens ?? 0`; `cache_creation = inputTokenDetails?.cacheWriteTokens ?? 0`; `input_tokens = inputTokenDetails?.noCacheTokens ?? Math.max(0, (inputTokens ?? 0) − cache_read − cache_creation)` (safe under both the Anthropic "total includes cache" and OpenAI "prompt_tokens includes cached" conventions); `output_tokens = outputTokens ?? 0`; `reasoning_tokens = outputTokenDetails?.reasoningTokens ?? 0`; `known = inputTokens != null || outputTokens != null`.
- `priceFor(provider, model): { price: Price | null; approx: boolean }` — exact id, then `startsWith`; not found on a cloud provider → the **dearest** `price` in that provider with `approx: true` (never free); `local` or `price: null` → `null`.
- `costOf(price, u) = (u.input_tokens × in + u.output_tokens × out + u.cache_read_input_tokens × (cacheRead ?? in) + u.cache_creation_input_tokens × (cacheWrite ?? in)) / 1e6`. Cache tokens are **not** inside `input_tokens`, so nothing is double-billed; reasoning tokens are inside `output_tokens` for every vendor (verified in the SDK mappers) and are billed at `out` once.
- Store: `{ usd, calls, cacheHits, unknown, approx }`. `addUsage(provider, model, usage)`: `unknown++` when `price === null || !usage.known`; `approx = true` when any call used a fallback or `unverified` price. Header pill: `$0.123 · 4 calls`, `≈` prefix when `approx`, `· 2 unpriced` when `unknown > 0`; title: "Estimated from published prices on your own key. Local models and unpublished prices count as unpriced."
- `Message.model` is the **requested** catalogue id (not the vendor's dated echo), so prefix matching stays stable.

---

## 7. Ordered implementation task list

Each task leaves `npm run typecheck` green and the Anthropic path working. Read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` before task 4 (AGENTS.md rule).

1. **Dependencies** — `package.json`: add exact-pinned `ai@7.0.122 @ai-sdk/anthropic@4.0.68 @ai-sdk/openai@4.0.81 @ai-sdk/google@4.0.85 @ai-sdk/groq@4.0.52 @ai-sdk/deepseek@3.0.56 @ai-sdk/xai@5.0.12 @ai-sdk/openai-compatible@3.0.59 server-only`; add scripts `"test": "tsx --test tests/**/*.test.ts"` and `"smoke": "tsx scripts/smoke-providers.ts"`. Keep `@anthropic-ai/sdk` until task 9.
2. **Catalogue** — add `src/lib/providers/catalogue.ts` exactly as §2 plus helpers; add `tests/catalogue.test.ts` (unique ids, every provider has its default in its list or is freeform, every price `> 0`, every `unverified` has a `note`, `keyEnvAllowlist()` contents).
3. **Wire types + errors** — add `src/lib/providers/wire.ts` (§3) and `src/lib/providers/errors.ts` (`friendly()`, `classify()`, `scrub()`); `tests/errors.test.ts` with fake `APICallError`s for each status/body → code, and a scrub test.
4. **Config + keys + guard** — add `src/lib/providers/config.ts` (`loadConfig`, `saveConfig`, `resolve`, `readiness`), `src/lib/providers/keys.ts`, `src/lib/providers/guard.ts` (all `import "server-only"`; file paths derived from `process.env.WALKMYCODE_HOME ?? process.cwd()` so tests can point at a temp dir); `tests/config.test.ts`, `tests/keys.test.ts`, `tests/guard.test.ts`.
5. **Config routes** — add `src/app/api/config/route.ts` (GET/POST), `src/app/api/config/key/route.ts` (POST/DELETE), `src/app/api/config/readiness/route.ts`, `src/app/api/config/models/route.ts`; all call `assertLocalSameOrigin`; bodies validated with `zod` (already installed). Verify with `curl` on localhost: GET catalogue, POST choice, POST key → `has_key` flips without restart, foreign `Origin` → 403.
6. **SDK seam** — add `src/lib/providers/sdk.ts` (`server-only`): the **only** file importing `ai` runtime and `@ai-sdk/*`; `makeModel(resolved, key)` cached by `(provider, key, base_url)`; `toSdkTools(mode, provider)` (no `execute`); `systemMessages(mode, mapSummary, provider)`; `reasoningOptions()`; `callOptions()`; `normaliseUsage()`. Accepts an injectable `fetch` for tests.
7. **Rewrite `/api/claude` for Anthropic only** — `src/app/api/claude/route.ts`: guard → parse `AskRequest` → `resolve()` → readiness → `stale_history` check → `streamText({ stopWhen: stepCountIs(1), toolChoice:'auto', abortSignal: req.signal, onError })` → forward `text-delta`, `tool-input-start`, `error` → final `{type:'message'}` from `response.messages[0]`, `finishReason`, `toolCalls`, `usage`. Keep `runtime = "nodejs"`, `maxDuration = 300`. Temporarily let the route also accept the old `messages` body so the unchanged client keeps working during this task.
8. **Client migration** — `src/lib/claude/client.ts`: `HistoryEntry[]`, `AskRequest` body with `history_provider`, readiness pre-check once per load, `{type:'tool'}` → `onTool`, finish mapping, `class AskError extends Error { info: FriendlyError }`, `trimHistory` slices whole entries and never starts on `assistant`/`tool`. `src/components/Guide.tsx`: history type, `AskError` rendering with Open settings / Try again, `settings-saved` reset, copy "Claude" → "the guide". `src/lib/cost.ts`: §6. Remove the `import type Anthropic` lines. Remove the temporary old-body acceptance from the route. Run ask + tour on Anthropic: text streaming, tool loop, cache hits in the pill, tour validation all as before. *This is the parity checkpoint.*
9. **Drop the old SDK** — remove `@anthropic-ai/sdk` from `package.json`; `grep` confirms no imports remain.
10. **Settings UI** — add `src/components/Settings.tsx`, `src/components/ModelBadge.tsx`; edit `src/app/map/page.tsx` (badge next to the cost pill, Settings tab), `src/app/page.tsx` (Model & keys card, privacy paragraph enumerating providers from the catalogue), `src/app/globals.css` (`.settings .chips .chip .keyrow .badge`). Checkpoint: paste a key, switch to Sonnet, ask again — no restart.
11. **Translator fixture tests** — add `tests/fixtures/<provider>/*.sse` recorded streams and `tests/translate.test.ts` (§8) driving `sdk.ts` + the route's stream loop through the injected `fetch`. This is the drift alarm for every later SDK bump.
12. **Smoke script** — add `scripts/smoke-providers.ts`: for each provider with a key (or `--provider x`), run a real two-step loop (`search` then answer) through the same `sdk.ts` path; print finish reason, tool-call ids, usage, cost; exit non-zero on any failure. Records results in `docs/PROVIDERS.md`.
13. **Enable providers one at a time** — run `npm run smoke -- --provider openai`, then `groq`, `deepseek`, `gemini`, `xai`, `local`. Flip `tools: "best-effort"` → `"confident"` in the catalogue only on a pass; record fixtures from the real responses (keys stripped) for task 11.
14. **Docs and env** — `.env.example` (`WALKMYCODE_PROVIDER`, `WALKMYCODE_MODEL`, `WALKMYCODE_EFFORT`, one `<PROVIDER>_API_KEY` per provider, `LOCAL_API_KEY`, `LOCAL_BASE_URL`, `WALKMYCODE_ALLOW_REMOTE`), `README.md` (settings table, `.walkmycode/` files, LAN note: run `next dev -H 127.0.0.1`), `docs/PLAN.md` (privacy must name every provider; DeepSeek sentence), `docs/PROVIDERS.md` (support matrix, verification date, threat model, upgrade procedure for the SDK).
15. **Optional, later** — `WALKMYCODE_MODEL_BACKUP=provider:model` client-side failover using iReliabee's `worthFailover` rule; rename `/api/claude` → `/api/ask` and `src/lib/claude/` → `src/lib/guide/` (mechanical, last); Mistral via `openai-compatible` once its id rule is verified.

---

## 8. Test plan

### Runs without keys (`npm test`, `node:test` via `tsx`)

| file | what it pins |
|---|---|
| `tests/catalogue.test.ts` | catalogue invariants (§7 task 2); `modelFor` prefix match on dated ids (`gpt-6.1-sol-2026-09-01` → `gpt-6.1-sol`); `keyEnvAllowlist` |
| `tests/errors.test.ts` | `classify()` table: 401/403/402/404/429/5xx/ECONNREFUSED/"credit balance" body → codes, titles, actions; `scrub()` removes `sk-…`, `gsk_…`, `AIza…`, `sk-ant-…` |
| `tests/config.test.ts` | temp `WALKMYCODE_HOME`; precedence config.json > `WALKMYCODE_*` > DEFAULT; merge-on-save; rejects unknown provider / model / effort / bad URL; freeform model for `local` |
| `tests/keys.test.ts` | temp dir; write → file line, `has_key` true, `process.env` untouched; replace keeps other lines; delete; control-char and length messages verbatim; allowlist refusal; file-before-env precedence; mtime cache invalidation |
| `tests/guard.test.ts` | Host loopback with ports, `Sec-Fetch-Site` values, absent headers + `curl`-style request passes, foreign `Origin` fails, `WALKMYCODE_ALLOW_REMOTE=1` |
| `tests/cost.test.ts` | `normaliseUsage` under Anthropic-shaped (`noCacheTokens` present), OpenAI-shaped (`noCacheTokens` absent, cached inside input), and empty usage (`known:false`); `costOf` never double-bills cache tokens; dearest-price fallback with `approx`; `unknown` counter |
| `tests/translate.test.ts` | For each wire family, `makeModel` with an injected `fetch` that (a) captures the outbound request and asserts the wire shape from §4 (tools without execute, `strict` only on `finish_tour` and only for `strict_tools` providers, no `temperature`, `store:false` for OpenAI/xAI, `cache_control` on system ×2 + last tool for Anthropic, `fallbacks:'default'` present, `thinking:{type:'disabled'}` for DeepSeek low, `reasoning_effort` absent for Groq llama), and (b) replays a recorded SSE fixture from `tests/fixtures/<provider>/`. Fixtures per provider: text-only answer; single tool call; two parallel tool calls; arguments split across chunks; usage-only final chunk (`choices: []`); Groq `x_groq.usage`; DeepSeek `prompt_cache_hit_tokens` + `reasoning_content`; Gemini `thoughtSignature`; OpenAI reasoning item + `incomplete_details.max_output_tokens`; Anthropic thinking + fallback block; stream that ends with no usage. Assertions: `StreamEvent` sequence, `finish`, `toolCalls`, normalised `Usage`, `message.model` = requested id, and **round-trip**: feeding the returned message plus a tool result back through `toModelMessages` + `makeModel` produces an outbound request containing the provider's replay field (`item_reference`/`encrypted_content`, `thoughtSignature`, `reasoning_content`, thinking `signature`). |
| `tests/client.test.ts` | `ask()` against a fake `fetch` serving SSE: loop runs tools and pushes `{role:'tool'}`; stops on `length`/`content-filter` with the right suffix; `AskError` carries `FriendlyError`; `trimHistory` never starts on `assistant`/`tool`; history reset on `settings-saved`; `history_provider` sent |
| `tests/route.test.ts` | `POST /api/claude` handler with the fake fetch: readiness error → `{type:'error'}` on the stream; `stale_history` when `history_provider` mismatches; abort propagates |

Fixtures are recorded once from real calls during task 13 (keys scrubbed, repo text replaced by a tiny sample) and committed; the SDK upgrade procedure is "bump `sdk.ts` deps, run `npm test`".

### Needs real keys

- `npm run smoke -- --provider <id>` for every cloud provider, plus `local` with Ollama running: a real two-step tool loop (`search` → answer) and a tour (`finish_tour` strict on Anthropic/OpenAI). Pass = finish `tool-calls` then `stop`, valid tool ids, non-zero `known` usage, cost within 2× of the catalogue estimate.
- Manual: paste a key in Settings on `next dev` → ask without restart; switch provider mid-conversation → "Switched to…" note; foreign-origin `POST /api/claude` → 403; Anthropic cache hits visible in the pill on the second question; Gemini second tool turn does not 400 (signatures round-trip); OpenAI second tool turn does not 400 (reasoning items round-trip); DeepSeek `medium` second turn does not 400 (`reasoning_content` round-trip).

---

## 9. Open questions for the owner (max 3)

1. **DeepSeek in the default picker.** It is the cheapest cloud option but processes data in China and its terms allow training on inputs. Ship it listed by default with the privacy sentence, or hide it behind an "Show all providers" toggle?
2. **Settings surface.** A fourth tab in the map header (smallest change, easiest to animate later) or a slide-over drawer reachable from every screen (better for the motion-design pass)? The spec assumes the tab.

---

## 10. Support matrix, threat model and SDK upgrades

**Verified 2026-09-30** against the exact pins in `package.json`: `ai@7.0.122`, `@ai-sdk/anthropic@4.0.68`, `@ai-sdk/openai@4.0.81`, `@ai-sdk/google@4.0.85`, `@ai-sdk/groq@4.0.52`, `@ai-sdk/deepseek@3.0.56`, `@ai-sdk/xai@5.0.12`, `@ai-sdk/openai-compatible@3.0.59`. "Verified" means `npm test` is green, including `tests/translate.test.ts`, whose fixtures are **synthetic** (hand-written from §4 and checked against the pinned parsers; see `tests/fixtures/README.md`). No provider has passed `npm run smoke` with a real key yet (§7 task 13). On the same day npm's latest were one patch ahead for every package (`ai@7.0.123`, anthropic 4.0.69, openai 4.0.82, google 4.0.86, groq 4.0.53, deepseek 3.0.57, xai 5.0.13, openai-compatible 3.0.60); they are not adopted until the procedure below has been run.

### Support matrix

| provider | package (wire) | catalogue `tools` | fixture replay (no keys) | round-trip state checked | smoke with a real key | what the fixtures pinned |
|---|---|---|---|---|---|---|
| Anthropic | `@ai-sdk/anthropic` (Messages) | confident, all three | text, thinking + fallback + split tool input, parallel tools | thinking `signature` | not run | The SDK **drops** a `fallback` content block (it has no content part for a model hop; the hop shows only in `usage.iterations`), so there is nothing to round-trip for it, unlike §4's wording. `reasoning_tokens` is 0 unless the API reports `output_tokens_details.thinking_tokens`. Cache breakpoints on system ×2 + last tool, `fallbacks:"default"` and the beta header go out as specified. |
| OpenAI | `@ai-sdk/openai` (Responses) | confident, all four | text, reasoning + split arguments, `incomplete` | reasoning item `encrypted_content` (sent in full, since `store:false` rules out `item_reference`) | not run | System messages go out as `developer` input items; the SDK adds `reasoning.summary:"detailed"`; non-strict tools carry `strict:false`. `incomplete_details.reason: max_output_tokens` → finish `length`. |
| xAI | `@ai-sdk/xai` (Responses) | best-effort | text, whole-call tool + encrypted reasoning, cut stream | reasoning `encrypted_content` | not run | The SDK appends `include: ["reasoning.encrypted_content"]` itself whenever `store:false` (without de-duplicating), so `callOptions()` sends only `store:false` for xAI; the fixture test pins that it goes out exactly once. A stream cut before `response.completed` reports usage as zeros with `known:true`, so the meter counts that call as $0 rather than unpriced. |
| Google Gemini | `@ai-sdk/google` (native) | confident; 3.1 Pro best-effort | text, signed tool call, parallel calls | `thoughtSignature` on the call part (only the first parallel call carries one) | not run | Tool call ids are synthesised by the SDK (random), so they change between runs. Usage: cached content and thought tokens map as §6 expects. |
| Groq | `@ai-sdk/groq` (Chat Completions) | confident; Llama best-effort | text with reasoning, split tool arguments | none needed (reasoning goes back as `reasoning`) | not run | The SDK reads streamed usage **only** from `x_groq.usage` and sends no `stream_options`; a top-level `usage` chunk would be ignored. Sends `max_tokens`. `reasoning_effort` absent for Llama. |
| DeepSeek | `@ai-sdk/deepseek` (Chat Completions) | confident | reasoning + split tool call + usage-only final chunk, `length` | `reasoning_content` on the assistant message | not run | `prompt_cache_hit_tokens` → cache read. Effort low sends `thinking:{type:"disabled"}` and no `reasoning_effort`. V4 models always carry `reasoning_content` (empty string when there was none). |
| Local | `@ai-sdk/openai-compatible` | best-effort by nature | text with usage-only final chunk, parallel calls by index, no usage | none | not run | `stream_options.include_usage` is sent; a stream with no usage chunk gives `known:false`. The readiness probe (`GET {base_url}/models`) runs before every ask. |

Flip a model's `tools` to `"confident"` only after a clean `npm run smoke -- --provider <id>` (and `--model <id>` for non-defaults), and record the run below.

### Smoke runs

`npm run smoke -- --record` adds one row per provider here, newest first. A pass means: loop step 1 finished `tool-calls` with a `search` call, the loop then finished `stop` with an answer, the tour produced a schema-shaped `finish_tour` call, every step had tool ids and non-zero `known` usage, and the metered cost was no more than twice the catalogue's uncached estimate.

<!-- smoke-results -->
| date | provider | model | effort | result | cost | notes |
|---|---|---|---|---|---|---|

### Threat model

What is protected: the API keys, the user's code (only the snippets a question needs ever leave the tab), and the user's spend.

| threat | defence | residual risk |
|---|---|---|
| Another machine on the network calls `/api/config*` or `/api/claude` | `guard.ts`: `Host` must be `localhost`, `127.0.0.1` or `[::1]` unless `WALKMYCODE_ALLOW_REMOTE=1` | `next dev` binds `0.0.0.0` by default; the README says to run `npm run dev -- -H 127.0.0.1` so nothing else can even connect |
| A web page open in the same browser posts to WalkMyCode (CSRF), or reads keys through it | `Sec-Fetch-Site` must be `same-origin` or `none`; without it, `Origin` must match `Host`; writes must be `application/json`, which a cross-site form cannot send and a cross-site `fetch` can send only after a CORS preflight, which fails because WalkMyCode sends no CORS headers | none known for current browsers |
| DNS rebinding (a hostile name re-pointed at 127.0.0.1) | the `Host` check refuses any name but the three loopback ones | none while `WALKMYCODE_ALLOW_REMOTE` is unset |
| A key leaks through a response, log line or error | keys are written only by `keys.ts` to `.walkmycode/keys.env` (gitignored, `chmod 600` attempted), never returned (only `has_key`), never logged; provider error bodies are scrubbed of key-shaped strings before they reach `detail`; a 500 never echoes the thrown message | on Windows the file is only as private as the user profile; any process running as the user can read it, as with `.env.local` |
| The key-writing endpoint used to set arbitrary server settings (e.g. `NODE_OPTIONS`) | `writeKey` accepts only the catalogue's `env` names plus `LOCAL_API_KEY`, `DEEPGRAM_API_KEY` and `ELEVENLABS_API_KEY`, refuses control characters and over-long values, and never touches `process.env` | none |
| One vendor's private state or tool ids sent to another vendor | every ask carries `history_provider`; a mismatch is refused with `stale_history` and the browser starts a fresh conversation | none |
| The local server URL used to make the server fetch somewhere else (SSRF) | only a guarded, same-origin request can save it, and the server only ever GETs `{base_url}/models` and POSTs chat requests there | the user can point it anywhere they like; that is the feature |
| A process on this computer (curl, a script) calls the endpoints | allowed by design: no `Sec-Fetch-Site` and no `Origin` passes | WalkMyCode trusts the local user account, as any dev server does |
| Code reaches a provider the user did not choose | exactly one provider per request, the one saved in Settings; each provider's `privacy` sentence is shown in Settings and on the connect screen; DeepSeek's names China and training | provider retention is governed by each vendor's terms, checked at launch |

### Upgrading the SDK

1. `npm view ai version` and `npm view @ai-sdk/<name> version` for all eight packages; read each provider package's changelog for stream-parser, usage or `providerOptions` changes.
2. Bump every pin in `package.json` together (they share `@ai-sdk/provider-utils`), exact versions, no ranges; `npm install`.
3. `npm run typecheck`. `src/lib/providers/sdk.ts` is the only runtime importer of `ai` and `@ai-sdk/*`, so breaking changes land there.
4. `npm test`. `tests/translate.test.ts` is the drift alarm: a failure means the outbound wire shape or the parsing changed. Read the SDK's parser for that event before touching anything; fix `sdk.ts` when the mapping moved, and a fixture only when the vendor's documented wire moved.
5. `npm run smoke -- --record` with real keys for every provider (and `--provider local` with Ollama running). Any FAIL blocks the bump.
6. Update the "Verified" line and the matrix above, and the pins named at the top of this section.

---

## Design panel record

Ranking: [["WalkMyCode multi-provider design on the Vercel AI SDK (v7) with iReliabee-style configuration",59],["Design C — WalkMyCode on the Vercel AI SDK (v7) with iReliabee-style configuration",57],["WalkMyCode multi-provider design: Anthropic-shaped core, iReliabee-style configuration, tool-aware translators",49],["Design A — Anthropic-shaped core, iReliabee-style configuration, hand-written tool-aware translators",47],["WalkMyCode multi-provider design: a provider-neutral turn model with one adapter per wire family, iReliabee-style catalogue/keys/settings",47],["Design B — Provider-neutral Turn model with one adapter per wire family, iReliabee-style catalogue/keys/settings",46]]
Designs: ["WalkMyCode multi-provider design: Anthropic-shaped core, iReliabee-style configuration, tool-aware translators","WalkMyCode multi-provider design: a provider-neutral turn model with one adapter per wire family, iReliabee-style catalogue/keys/settings","WalkMyCode multi-provider design on the Vercel AI SDK (v7) with iReliabee-style configuration"]
