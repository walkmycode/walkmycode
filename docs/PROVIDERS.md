# WalkMyCode multi-provider layer — final design spec

Base: the Vercel AI SDK design (winner), with the grafts and fixes the judges asked for:

- **Fix:** Anthropic server-side fallback is *not* lost. `@ai-sdk/anthropic` 4.0.68 accepts `providerOptions.anthropic.fallbacks: "default"` and adds the `server-side-fallback-2026-07-01` beta itself (verified: `node_modules/@ai-sdk/anthropic/dist/index.js:1241-1250, 4569-4570, 4779-4782` in the scratchpad install). Parity with today's `route.ts` is full.
- **Fix:** usage normalisation never falls back to a cache-inclusive `inputTokens`. Rule: `no_cache = inputTokenDetails.noCacheTokens ?? max(0, inputTokens − cacheRead − cacheWrite)`.
- **Fix:** SDK drift surface is contained. Exact-pinned versions, every SDK import goes through one file (`src/lib/providers/sdk.ts`), a recorded-fixture test suite that runs without keys, and a smoke script that gates each provider. Upgrading the SDK is a one-file change plus a green test run.
- **Fix:** `providerOptions` can never be stripped by accident: history entries are opaque to the client, `trimHistory` only slices whole messages, the server tags every request with the provider that produced the history and refuses a mismatch.
- **Grafted from A:** never send `temperature`/`top_p`; `toolChoice: "auto"` only; provider 400 text shown in `detail` (scrubbed for key-shaped strings); history reset on provider change; server-side "Settings changed — ask again" check.
- **Grafted from B:** loopback + same-origin guard (now also on `/api/claude`), `GET /api/config/readiness`, `GET /api/config/models` proxy for local servers, DeepSeek `low` = thinking off, model validated against the provider's list (local providers exempt), `scripts/smoke-providers.ts` as the promotion gate.

All WalkMyCode paths are under `codebase-guide\`.

---

## 1. Architecture (one paragraph)

The browser keeps doing what it does today: `Guide.tsx` calls `ask()` in `src/lib/claude/client.ts`, which POSTs the conversation to `/api/claude`, streams `{type:'text'}` deltas, receives one `{type:'message'}` at the end, runs any tool calls locally with `runTool` against the repo held in memory, and loops (max 10 rounds). What changes is inside the server route and the shape of the messages the browser stores. `src/app/api/claude/route.ts` no longer calls `@anthropic-ai/sdk` directly; per request it loads the saved choice from `.walkmycode/config.json` (falling back to `WALKMYCODE_*` env vars (or the old `WALKMYCODE_*` names), then the default `anthropic / claude-opus-5-5 / medium`), resolves the key from `.walkmycode/keys.env` then `process.env`, builds a `LanguageModel` from the `PROVIDERS` catalogue via the matching `@ai-sdk/*` provider package, and runs **one** `streamText()` step with WalkMyCode's tools declared **without `execute`**, so every step that wants a tool ends with `finishReason: 'tool-calls'` and the calls come back to the browser. The browser stores the SDK's `response.messages[0]` (an `AssistantModelMessage`) verbatim, which is what carries each vendor's private round-trip state (OpenAI reasoning item ids / encrypted content, Gemini thought signatures, DeepSeek `reasoning_content`, Anthropic thinking signatures and fallback blocks) in `providerOptions`; tool results go back as a `role:'tool'` message. Configuration: one catalogue module shared by server and UI, keys written by the server to a private local file and only ever reported as `has_key`, the saved choice in a separate JSON file, format-only validation on save, real errors classified at call time into `missing_key / invalid_key / out_of_credits / rate_limited / model_unavailable / network / unknown` with an "Open settings" action. Write endpoints and the ask endpoint are guarded to loopback + same-origin. No hosted service, no accounts, no tiers, bring-your-own keys.

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

Deliberately left out: `deepseek-chat`, `deepseek-reasoner`, Gemini 2.5, Kimi K2 (retired). Mistral is not in v1 (9-char tool-id constraint, unverified alias mapping); it slots into `openai-compatible` later.

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
- `writeKey(env_var, value)` — allowlist (`keyEnvAllowlist()`), otherwise `400 Unknown env var: X`; trim; `> 1024` chars → `400 That key is far longer than any real one.`; any char `< 32` or `== 127` → `400 That key contains a line break or control character. Paste just the key.`; replace-or-append; write `keys.env.tmp`, chmod, `rename`; refresh the Map. Empty value or `DELETE` removes the line.
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

Returns `null` when ready, else:

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

Mounted as a fourth tab **Settings** in the `map/page.tsx` tab strip (`guide / details / files / settings`) and inline on the connect screen (`page.tsx`) as a "Model & keys" card. Opens on the `open-settings` custom event; emits `settings-saved` with `{ provider, model }`. Built with the existing `.panel / .ctl / .field / .note / .err` classes plus `.settings .chips .chip .keyrow .badge` (~40 lines in `globals.css`) so the motion-design pass can animate it without restructuring. Layout, in a numbered-card style (uppercase muted field labels, 11px hints):

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
15. **Optional, later** — `WALKMYCODE_MODEL_BACKUP=provider:model` client-side failover on a `worthFailover` rule (0/401/402/403/408/409/429/5xx, and 400 only for credit or quota text); rename `/api/claude` → `/api/ask` and `src/lib/claude/` → `src/lib/guide/` (mechanical, last); Mistral via `openai-compatible` once its id rule is verified.

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

1. **Commit attribution.** The owner's rule forbids Claude attribution in commits for your repos, while this harness asks for a `Co-Authored-By` trailer. WalkMyCode has no rule of its own — which applies here?
2. **DeepSeek in the default picker.** It is the cheapest cloud option but processes data in China and its terms allow training on inputs. Ship it listed by default with the privacy sentence, or hide it behind an "Show all providers" toggle?
3. **Settings surface.** A fourth tab in the map header (smallest change, easiest to animate later) or a slide-over drawer reachable from every screen (better for the motion-design pass)? The spec assumes the tab.

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

Ranking: [["WalkMyCode multi-provider design on the Vercel AI SDK (v7) with catalogue-style configuration",59],["Design C — WalkMyCode on the Vercel AI SDK (v7) with catalogue-style configuration",57],["WalkMyCode multi-provider design: Anthropic-shaped core, catalogue-style configuration, tool-aware translators",49],["Design A — Anthropic-shaped core, catalogue-style configuration, hand-written tool-aware translators",47],["WalkMyCode multi-provider design: a provider-neutral turn model with one adapter per wire family, a shared catalogue/keys/settings",47],["Design B — Provider-neutral Turn model with one adapter per wire family, a shared catalogue/keys/settings",46]]
Designs: ["WalkMyCode multi-provider design: Anthropic-shaped core, catalogue-style configuration, tool-aware translators","WalkMyCode multi-provider design: a provider-neutral turn model with one adapter per wire family, a shared catalogue/keys/settings","WalkMyCode multi-provider design on the Vercel AI SDK (v7) with catalogue-style configuration"]

## Research notes

## Notes 1
# WalkMyCode AI path — Anthropic dependencies and provider-layer integration points

All WalkMyCode paths under `codebase-guide\`.

## 1. Data flow today (one provider, Anthropic wire shape end to end)

Browser `Guide.tsx` → `ask()` in `src/lib/claude/client.ts` → `fetch("/api/claude")` (client.ts:109) → `src/app/api/claude/route.ts` → `client.beta.messages.stream()` (route.ts:33) → SSE back to browser as WalkMyCode's own events `{type:'text'}` / `{type:'message', message}` / `{type:'error'}` (route.ts:47,50,54; parsed client.ts:137-139). The browser runs tools (`runTool`, tools.ts:115) and loops up to `MAX_ROUNDS = 10` (client.ts:31). **The browser↔proxy contract is Anthropic's `BetaMessageParam`/`BetaMessage` shape**, so the history the browser keeps (Guide.tsx:100) is Anthropic content blocks.

## 2. Every Anthropic-specific dependency (file:line)

### `src/app/api/claude/route.ts` (server proxy — the only runtime SDK user)
- :4 `import Anthropic from "@anthropic-ai/sdk"` (runtime).
- :11 `MODEL = process.env.WALKMYCODE_MODEL || "claude-opus-5-5"` — single global model id, read once at module load (cannot change without restart; no provider concept).
- :12 `EFFORT` typed `"low"|"medium"|"high"` → :42 `output_config: { effort }` (Anthropic-only param).
- :15 request body typed `Anthropic.Beta.BetaMessageParam[]`.
- :18 `new Anthropic()` — implicitly reads `ANTHROPIC_API_KEY`; no `baseURL`.
- :19-24 tools built as `Anthropic.Beta.BetaToolUnion` with `input_schema` (Anthropic key name) and top-level `strict: true`.
- :26 `cache_control: { type: "ephemeral" }` on the last tool.
- :33 `client.beta.messages.stream(...)` — **beta** API.
- :35 `max_tokens: 8000` (OpenAI/Groq newer models want `max_completion_tokens`).
- :36-39 `system` as an array of text blocks each with `cache_control` (Anthropic-only; OpenAI-shaped takes a system message string).
- :43 `betas: ["server-side-fallback-2026-07-01"]`, :44 `fallbacks: "default"` — Anthropic beta features.
- :46-48 iterates SDK stream events `content_block_delta` / `delta.type === "text_delta"`.
- :49 `s.finalMessage()` → BetaMessage; :50 whole Anthropic message forwarded to browser.
- :52-54 error surfacing: reads `err.status`, regex `/api key|x-api-key|authentication/`, hint hardcodes "Put ANTHROPIC_API_KEY in .env.local", label `Claude API ${status}`; error is a plain string.
- :8-9 `runtime = "nodejs"`, `maxDuration = 300`.

### `src/lib/claude/client.ts` (browser loop)
- :5 `import type Anthropic` (type-only, but keeps the SDK as a dep of the client bundle types).
- :10-11 `Msg = Anthropic.Beta.BetaMessageParam`, `Message = Anthropic.Beta.BetaMessage`.
- :45 `addUsage(message.model, message.usage)` — expects Anthropic usage fields and the provider-echoed `model` id.
- :46 pushes `message.content` (Anthropic block array incl. `tool_use`) as the assistant turn.
- :47 `stop_reason ?? "end_turn"`; :49-52 `stop_reason === "refusal"` (Anthropic-only value; text "(Claude declined…)"); :53 `stop_reason !== "tool_use"` ends the loop. Not handled: `max_tokens`, `pause_turn`, `model_context_window_exceeded`, `compaction` (SDK `BetaStopReason`, node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.d.ts:3579).
- :55 `Anthropic.Beta.BetaToolResultBlockParam[]`; :56-72 reads `block.type === "tool_use"`, `block.name`, `block.input`, `block.id`; builds `{type:"tool_result", tool_use_id, content, is_error}`.
- :73 tool results sent as a **user** turn holding tool_result blocks (Anthropic convention; OpenAI uses `role:"tool"` messages with `tool_call_id`).
- :96-106 `trimHistory` inspects `content` arrays for `b.type === "tool_result"` and string-vs-array content (Anthropic shape).
- :109 `fetch("/api/claude")`; :120 "The Claude proxy answered"; :136-139 WalkMyCode SSE parse (provider-agnostic).

### `src/lib/claude/tools.ts`
- :7-12 `ToolDef { name, description, input_schema, strict? }` — Anthropic naming (`input_schema`; OpenAI: `function.parameters`).
- :14-55 `TOOLS` (read_file, search, query_map, list_files) — non-strict, optional properties, no `additionalProperties:false` → **not** OpenAI-strict compatible (fine as non-strict).
- :57-85 `TOUR_TOOL` `strict: true`, `additionalProperties:false`, all props required → does satisfy OpenAI strict rules.
- :115-181 `runTool` — provider-agnostic; shared server+browser (no "use client").

### `src/lib/claude/prompts.ts`
- Provider-agnostic text. :4 "You are WalkMyCode"; :19 comment "prompt-cached"; :20-38 `mapSummary` deterministic (good as a stable leading prefix for every provider's auto-caching).

### `src/lib/cost.ts`
- :6-10 `PRICES` keyed by Anthropic ids only (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-4-5`) with `cacheRead/cacheWrite`.
- :12-17 `Usage` = Anthropic field names (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`).
- :23 unknown model **silently priced as opus** (`?? "claude-opus-5-5"`); prefix match via `startsWith`.
- :25 cost formula; :29 `cacheHits` from `cache_read_input_tokens`; :33-42 `useCost` store.

### `src/components/Guide.tsx`
- :5 `import type Anthropic`; :100 `history = useRef<Anthropic.Beta.BetaMessageParam[]>([])` (conversation persists across jobs in a ref — survives a provider switch mid-session).
- :14 doc "What Claude gets"; :113-134 calls `ask`; :132 error stored as `(e as Error).message`; :168 rendered `<p className="err">` (globals.css:57). No structured error / no action button.
- :120 tool-call trace line; :202 "Thinking…" placeholder.

### `src/app/map/page.tsx`
- :12,:23 `useCost()`; :179-181 cost pill `${cost.usd} · calls` in `<header className="top">` (:166-185) with title "on your API key" — natural spot for a provider/model badge + settings entry. :233-239 tab strip (guide/details/files) — could gain a Settings tab. :244 `<Guide …>`.

### `src/app/page.tsx` (connect screen)
- :84 "sent to Claude, on your own API key"; :159-160 privacy paragraph names **Anthropic (Claude)** and Deepgram and `.env.local`. :81-143 cards grid — room for a "Model & keys" card.

### `.env.example`
- :2 `ANTHROPIC_API_KEY`; :3-4 `WALKMYCODE_MODEL=claude-opus-5-5`; :5-6 `WALKMYCODE_EFFORT`; :8 `DEEPGRAM_API_KEY`.

### `README.md`
- :15 "put your ANTHROPIC_API_KEY"; :30 privacy names Anthropic; :43-45 settings table (ANTHROPIC_API_KEY / WALKMYCODE_MODEL / WALKMYCODE_EFFORT).

### `package.json`
- :15 `@anthropic-ai/sdk ^0.129.0` only AI dep; no `openai`/`@google/genai`. :31 `zod` available (config validation). :24 `next 16.3.7` (AGENTS.md: read `node_modules/next/dist/docs/` before writing Next code).

### `docs/PLAN.md`
- :33 "the Claude tool loop"; :37-39 keys in `.env.local`; :55 Haiku labels (not implemented); :59-61 Opus 5.5 + effort + prompt cache; :71-77 cost table; :79-81 `WALKMYCODE_MODEL`, usage-based meter; :84-88 privacy must name every provider.

### Not part of the AI path (leave alone)
- `src/analyzer/extract/common.ts:47,83-84,138` detect Anthropic as an *outside service in analysed repos*.
- `src/lib/store.ts:39-58` IndexedDB "kv" store (repo mirror) — could hold a per-browser UI preference, but keys must stay server-side.
- `src/app/api/demo/route.ts:8` and `scripts/index.ts:48` already use a `.walkmycode/` folder — a natural home for a `config.json` (the saved choice).

## 3. Integration points a provider layer needs in WalkMyCode

1. **Catalogue module** (new, e.g. `src/lib/providers.ts`, shared server+client, no secrets): `{ id, label, env, wire: "anthropic"|"openai", base_url, models: [{id, label, price:{in,out,cacheRead,cacheWrite}, supportsTools, reasoningEffort?}], default_model }` for anthropic / openai / deepseek / gemini / groq.
2. **Where the model is chosen**: today route.ts:11-12 (env, module load). Needs a per-request `{provider, model}` (from client.ts:112 body) or a server-side saved choice (`.walkmycode/config.json`), validated against the catalogue; keys read per request from `process.env`, not at module load.
3. **Key entry / status**: new `GET /api/config` (catalogue + `has_key` + saved) and `POST /api/config`, `POST /api/config/key` (allowlisted env names → append/replace in `.env.local` + set `process.env`). Bring-your-own-keys stays; no accounts.
4. **Settings UI location**: `map/page.tsx:166-185` header beside the cost pill (:179) — a "model: deepseek-chat" badge that opens a settings panel — and/or a card on `page.tsx:81-143`; the component is provider pills, a model select and a key row for the active provider.
5. **Request translation (server, route.ts)**: keep Anthropic as the internal wire format and translate in the proxy: system blocks → system message; `input_schema`/`strict` → `{type:"function", function:{name,description,parameters,strict}}`; assistant `tool_use` blocks → `tool_calls[{id,type:"function",function:{name,arguments:JSON}}]`; user `tool_result` blocks → `role:"tool"` messages `{tool_call_id, content}`; `max_tokens` → per-provider field; `output_config.effort` → `reasoning_effort` where supported; drop `cache_control`, `betas`, `fallbacks` for non-Anthropic.
6. **Response/stream translation**: emit WalkMyCode's `{type:'text'}` from `choices[].delta.content`; accumulate `choices[].delta.tool_calls[]` by index into `tool_use` blocks (`input` = JSON.parse(arguments)); `finish_reason` `tool_calls`→`tool_use`, `length`→`max_tokens`, `content_filter`→`refusal`, else `end_turn`; set `message.model` to the *requested* id so cost.ts:23 prefix-matching works; normalise usage to Anthropic field names.
7. **Cost**: replace cost.ts:6-10 with prices from the catalogue (with an `unverified` flag), replace the silent opus fallback (:23) with a dearest-model `FALLBACK_PRICE`; cache fields already optional (:15-16).
8. **Errors**: route.ts:52-54 → structured `{code,title,message,action,provider}` (classified from status and message: 401→invalid_key, 402/quota text→out_of_credits, 429→rate_limited, 404/model text→model_unavailable, missing env→missing_key naming the right env var); client.ts:139 rethrow with the fields; Guide.tsx:132/168 render title + "Open settings" when `action === "settings"`.
9. **Fallback/backup**: optional `WALKMYCODE_MODEL_BACKUP=provider:model` + a `worthFailover` rule to replace Anthropic `fallbacks: "default"` (route.ts:44).
10. **Copy/docs**: page.tsx:84,159-160; README.md:15,30,43-45; .env.example; client.ts:50,120 "Claude" strings; docs/PLAN.md:84-88 privacy must list every provider (DeepSeek processes in China and may train).
11. **Naming**: `/api/claude` route, `src/lib/claude/` folder, `Anthropic` type imports in client.ts:5 and Guide.tsx:5 can be replaced by a local `Msg`/`Message` type alias exported from the provider layer so the client bundle no longer imports SDK types.

Note: the owner's relayed request also asks for motion-design animations; that is outside this analysis and untouched here.
Key facts:
- Only one runtime SDK use: src/app/api/claude/route.ts:4,18,33 (client.beta.messages.stream); client.ts:5 and Guide.tsx:5 import Anthropic types only.
- Browser<->proxy contract is Anthropic's BetaMessageParam/BetaMessage: route.ts:15 (input), route.ts:50 (final message forwarded whole), client.ts:10-11,46,55-73 (tool_use blocks in assistant turn, tool_result blocks in a user turn).
- Model is a single env-derived global read at module load: route.ts:11 WALKMYCODE_MODEL default claude-opus-5-5; effort route.ts:12/42 output_config.effort; both Anthropic-only params.
- Anthropic-only request features: cache_control on last tool (route.ts:26) and system blocks (route.ts:37-38); betas server-side-fallback-2026-07-01 (route.ts:43); fallbacks 'default' (route.ts:44); max_tokens 8000 (route.ts:35); strict tool flag (route.ts:23, tools.ts:61).
- Stop reasons consumed: client.ts:47-53 uses 'end_turn', 'refusal', 'tool_use'; SDK BetaStopReason also has max_tokens, stop_sequence, pause_turn, compaction, model_context_window_exceeded (unhandled).
- Usage/cost: cost.ts:12-17 Usage uses Anthropic field names; PRICES cost.ts:6-10 only claude-* ids; unknown model silently priced as claude-opus-5-5 (cost.ts:23); model id comes from provider echo at client.ts:45.
- Errors surface as a plain string: route.ts:52-54 (hint hardcodes ANTHROPIC_API_KEY, label 'Claude API <status>') -> client.ts:139 throw -> Guide.tsx:132/168 <p class=err>; no code/action structure.
- Settings UI: none exists. Candidate locations: map/page.tsx:166-185 header next to the cost pill (:179-181) or tab strip (:233-239); connect screen cards page.tsx:81-143. Privacy copy naming Anthropic at page.tsx:84,159-160 and README.md:30,43-45.
- Config surface today: .env.example:2-6 (ANTHROPIC_API_KEY, WALKMYCODE_MODEL, WALKMYCODE_EFFORT); .walkmycode/ folder already used by api/demo/route.ts:8 and scripts/index.ts:48 (natural home for a saved config.json).
Pitfalls:
- WalkMyCode's loop is tool-centric (client.ts:46-73), so a new Anthropic tool_use <-> OpenAI tool_calls / role:'tool' translation (including streamed tool_calls argument fragments accumulated by index and JSON-parsed at the end) must be written.
- OpenAI strict mode requires every property in `required` and additionalProperties:false on every object: TOUR_TOOL (tools.ts:57-85) qualifies, TOOLS (tools.ts:14-55) do not — send them non-strict or their calls will be rejected.
- route.ts:11-12 read WALKMYCODE_MODEL/EFFORT at module load and route.ts:18 `new Anthropic()` reads the key implicitly; a settings UI that writes .env.local will not take effect unless keys and choice are read per request and process.env is updated on write. `next dev` does not reliably reload .env.local.
- cost.ts:23 silently prices any unknown model as claude-opus-5-5; with gpt/deepseek/gemini ids the meter would be wrong. Use a per-provider table plus a 'dearest' fallback and make sure the translated message.model is the requested id (OpenAI echoes dated ids like gpt-5-mini-2026-xx).
- cache_control (route.ts:26,37-38), betas and fallbacks (route.ts:43-44) and output_config.effort (route.ts:42) are rejected or meaningless on OpenAI-shaped endpoints; drop them there and map effort to reasoning_effort only for models that accept it (gpt-5 also rejects non-default temperature).
- DeepSeek reasoner historically does not support function calling; only deepseek-chat should be offered for WalkMyCode's tool loop. Gemini's OpenAI-compatible endpoint supports tools but ignores Anthropic cache markers and may differ on tool_call id handling; verify with a real call before listing a model.
- Conversation history is kept across jobs in Guide.tsx:100; switching provider mid-session replays tool_use/tool_result ids from one provider to another (Anthropic toolu_* vs OpenAI call_*) — translate ids consistently or reset history on provider change.
- Stop-reason mapping gaps: client.ts:49-53 only knows end_turn/refusal/tool_use; map OpenAI finish_reason 'length' -> max_tokens, 'content_filter' -> refusal, 'tool_calls' -> tool_use, and decide what the loop does on max_tokens (today it just stops).
- Privacy copy must name every provider before it is used (docs/PLAN.md:84-88, page.tsx:159-160, README.md:27-33): DeepSeek processes in China and may train on inputs — say so when adding it.
- Next.js 16 conventions differ from training data (codebase-guide/AGENTS.md): read node_modules/next/dist/docs before writing new route handlers or config endpoints.
- Attribution conflict: the owner's rule is no Claude attribution in commits for every one of the owner's repos, while the harness reminder asks for a Co-Authored-By trailer; codebase-guide has no rule of its own — confirm with the owner before committing in WalkMyCode.

## Notes 2
## Multi-provider research for WalkMyCode (verified 2026-09-29 via WebFetch of vendor docs unless flagged)

### Anthropic (platform.claude.com/docs/en/models/overview + /about-claude/pricing)
| Field | Value |
|---|---|
| Base URL | `https://api.anthropic.com/v1/messages` |
| Auth | `x-api-key: <key>`, `anthropic-version: 2023-06-01`, `content-type: application/json` |
| Env var | `ANTHROPIC_API_KEY` |
| Models | `claude-opus-5-5` — default Opus, 1M ctx, 128K out, **$4 / $20** (cache read $0.20, 5m write $5); `claude-sonnet-5-5` — speed+intelligence, 1M/128K, **$2 / $10** (cache read $0.20); `claude-haiku-4-5` (alias of `claude-haiku-4-5-20251001`) — fastest, 200K ctx, 64K out, **$1 / $5** (cache read $0.10); optional top tier `claude-fable-5-1` — 1M/128K, **$10 / $50** |
| Tools+streaming | Yes. `tools[].input_schema`; `strict: true` on tool def (schema needs `additionalProperties:false` + `required`); `eager_input_streaming: true` streams tool input. Parallel tool_use blocks default on; return all `tool_result`s in ONE user message |
| Quirks | Opus 5.5 / Sonnet 5.5 / Fable 5.1: **`tool_choice` `any`/`tool` returns 400** — only `auto`/`none` (+`disable_parallel_tool_use`). Opus 5.5: thinking cannot be disabled (`{type:"disabled"}` and `budget_tokens` 400), effort default `medium` via `output_config.effort`. Sonnet 5.5: `thinking:{type:"disabled"}` 400 → use `{type:"between_tools"}` to turn off; effort default `high`. Haiku 4.5: old `{type:"enabled", budget_tokens}` only. Assistant prefill removed on 4.6+. Tool `input` JSON escaping varies — always `JSON.parse`. Batch 50% off; 1M context at flat price. Legacy still served: opus-5, opus-4-8/4-7/4-6, sonnet-5, sonnet-4-6 |

### OpenAI (developers.openai.com/api/docs/pricing, /models/*, /guides/latest-model, /guides/function-calling, /guides/reasoning)
| Field | Value |
|---|---|
| Base URL | `https://api.openai.com/v1/chat/completions` and `https://api.openai.com/v1/responses` |
| Auth | `Authorization: Bearer <key>` |
| Env var | `OPENAI_API_KEY` |
| Models (current) | `gpt-6-astra` — flagship, 1.05M ctx, 128K out, **$10 / $50** (cached $1); `gpt-6.1-sol` — mid-tier default pick, 1.05M/128K, **$2 / $10** (cached $0.10), effort default `medium`; `gpt-6-sol` — prior Sol, **$2 / $10** (cached $0.20); `gpt-6-luna` — small/cheap, 1.05M/128K, **$0.10 / $0.50** (cached $0.01), effort `none..max` default `medium`. Legacy still priced: `gpt-5.5` $5/$30, `gpt-5.4` $2.50/$15, `gpt-5.4-mini` $0.75/$4.50, `gpt-5.4-nano` $0.20/$1.25, `gpt-5-mini` $0.25/$2, `gpt-5` $1.25/$10, `gpt-4.1` $2/$8, `gpt-4o` $2.50/$10 |
| Tools+streaming | **Critical:** latest-model guide, verbatim: "GPT-6 Astra and GPT-6.1 Sol support Chat Completions, but tool calling requires Responses." and "GPT-6 Sol and GPT-6 Luna support function calling in Chat Completions only with `reasoning_effort: "none"`." → For WalkMyCode's tool loop on GPT-6, use the **Responses API** (`input`, `tools:[{type:"function",name,parameters,strict}]`, results as `{type:"function_call_output", call_id, output}`; stream events `response.output_item.added` → `response.function_call_arguments.delta` → `.done` → `response.output_item.done`; text via `response.output_text.delta`; usage on `response.completed`.response.usage with `output_tokens_details.reasoning_tokens`). Reasoning items returned with tool calls must be passed back with outputs. New `async: true` on a function def lets the model keep reasoning while a tool runs. Chat Completions (gpt-5.x / gpt-4.x / gpt-6 at effort none): `delta.tool_calls[{index,id,type,function:{name,arguments}}]` fragments keyed by `index`; results `{role:"tool", tool_call_id, content}`; `stream_options:{include_usage:true}` adds a final chunk with `usage` and `choices: []` before `[DONE]` |
| Strict schemas | `strict:true`: `additionalProperties:false` on every object, ALL properties in `required`, optional = `["string","null"]` |
| Effort | Chat: `reasoning_effort`; Responses: `reasoning:{effort}`. Values none/minimal/low/medium/high/xhigh/max; Astra and 6.1-Sol reject `none`/`minimal` (400) — min `low`; Sol/Luna accept `none` |
| Quirks | "When reasoning effort is not `none`, remove `temperature`, `top_p`, and `top_logprobs`" (rejected). Use `max_completion_tokens` (Chat) / `max_output_tokens` (Responses); `max_tokens` deprecated. `parallel_tool_calls` default true; `tool_choice`: auto/required/none/{type:"function",name}. Responses `store` defaults true (set `store:false` for BYO-key privacy); reserve ≥25k tokens for reasoning |

### Google Gemini (ai.google.dev/gemini-api/docs/openai, /pricing, /models, /models/gemini-3.8-flash, /api/generate-content)
| Field | Value |
|---|---|
| Base URL (OpenAI-compat) | `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` — "still in beta"; native: `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` and `:streamGenerateContent?alt=sse` |
| Auth | compat: `Authorization: Bearer <key>`; native: `x-goog-api-key: <key>` |
| Env var | `GEMINI_API_KEY` (Google SDKs also read `GOOGLE_API_KEY`) |
| Models | `gemini-3.8-flash` — latest flagship Flash, 1,048,576 in / 65,536 out, **$0.75 / $3.75 through 2026-12-31, then $1.50 / $7.50** (cache $0.075); `gemini-3.5-flash-lite` — cheapest, **$0.30 / $2.50**; `gemini-3.5-flash` — **$1.50 / $9.00**; `gemini-3.1-pro-preview` — reasoning Pro (preview), 1,048,576/65,536, **$2.00 / $12.00 ≤200k, $4 / $18 >200k**. 2.5 models now restricted to prior users — do not list for new installs; 2.0 shut down |
| Tools+streaming | Compat endpoint: function calling "fully supported with standard OpenAI tools format", `stream=true`, `stream_options.include_usage` supported, `extra_body.thinking_config{thinking_level, include_thoughts}`; `reasoning_effort` maps low→thinking_level low, medium, high. Native: `tools:[{functionDeclarations}]`, `toolConfig.functionCallingConfig.mode` AUTO/ANY/NONE, `systemInstruction`, `generationConfig.maxOutputTokens`, `thinkingConfig`; usage in `usageMetadata.promptTokenCount/candidatesTokenCount/thoughtsTokenCount/cachedContentTokenCount` |
| Quirks | Gemini 3 **thought signatures**: model returns signatures with function calls that MUST be echoed back or the next turn 400s ("Thought signature is not valid"). Compat page says Gemini 3 supports signatures in chat completions; community/LiteLLM reports the field is `tool_calls[].extra_content.google.thought_signature` (**field path unverified from Google docs — page redirected**). Compat layer **silently ignores** unknown params (so `strict:true` is likely ignored — **unverified**). Free tier exists for Flash models |

### Groq (console.groq.com/docs/models, /tool-use, /openai, /api-reference, /deprecations)
| Field | Value |
|---|---|
| Base URL | `https://api.groq.com/openai/v1/chat/completions` (models list `/openai/v1/models`) |
| Auth | `Authorization: Bearer <key>` |
| Env var | `GROQ_API_KEY` |
| Models | `openai/gpt-oss-120b` — flagship, ~500 tps, 131K ctx / 65,536 out, **$0.15 / $0.60**, **no parallel tool calls**; `openai/gpt-oss-20b` — 1000 tps, **$0.075 / $0.30**, no parallel; `llama-3.3-70b-versatile` — 131K ctx / 32,768 out, parallel tools ✓, price shown as "Contact Sales" on docs (third-party costbench lists $0.59/$0.79 — **unverified**); `llama-3.1-8b-instant` — 560 tps, 131K, parallel ✓ (price unlisted); preview: `qwen/qwen3.8-27b` **$0.80 / $4.00** (16,384 out), `minimaxai/minimax-m2.7` 196K ctx (Contact Sales). **Kimi K2 (`moonshotai/kimi-k2-instruct-0905`) shut down 2026-04-15**; no Kimi or Llama 4 currently listed |
| Tools+streaming | All hosted models support tool use; OpenAI shape; `tool_choice` none/auto/required/{function}; `parallel_tool_calls` default true; `max_completion_tokens` (max_tokens deprecated); `stream_options.include_usage`; streaming usage may arrive under `x_groq.usage` |
| Quirks | Unsupported: `logprobs`, `logit_bias`, `top_logprobs`, `messages[].name`, `n>1`; `temperature:0` coerced to 1e-8. `reasoning_effort` values none/default/minimal/low/medium/high/xhigh/max vary per model; `reasoning_format` hidden/raw/parsed or `include_reasoning`. Frequent model retirements — validate ids against `/models` at startup |

### DeepSeek (api-docs.deepseek.com/, /quick_start/pricing/, /updates, /api/create-chat-completion, /guides/thinking_mode/, /guides/anthropic_api/)
| Field | Value |
|---|---|
| Base URL | OpenAI: `https://api.deepseek.com/chat/completions` (also `/v1`); **Anthropic-format: `https://api.deepseek.com/anthropic`**; beta (strict tools): `https://api.deepseek.com/beta` |
| Auth | `Authorization: Bearer <key>` (Anthropic route: `x-api-key`/`ANTHROPIC_API_KEY`) |
| Env var | `DEEPSEEK_API_KEY` |
| Models | `deepseek-flash` — DeepSeek-V4.1-Flash (2026-09-10), 1M ctx, 384K max out, vision, **peak $0.30 miss / $0.006 hit / $1.20 out; off-peak half ($0.15 / $0.003 / $0.60)**; `deepseek-v4-pro` — V4-Pro-0813, 1M ctx, 384K out, **peak $1.32 / $0.044 / $3.96; off-peak $0.66 / $0.022 / $1.98**. Off-peak = outside 01:00-04:00 and 06:00-10:00 UTC Mon-Fri. **`deepseek-chat` / `deepseek-reasoner` are no longer listed** (only `deepseek-v4-flash` legacy names are routed) |
| Tools+streaming | Both models: function calling ✓, JSON output ✓, thinking ✓, streaming ✓. `tool_choice` none/auto/required/{function}; `stream_options.include_usage`; up to 128 tools; usage has `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`, `completion_tokens_details.reasoning_tokens`. Anthropic-compatible route supports tools, tool_choice none/auto/any/tool, streaming, system, images, thinking; maps Claude Opus names→v4-pro, Sonnet/Haiku→flash, **unknown model names silently → deepseek-flash**; drops cache_control |
| Quirks | Thinking is **on by default** (`thinking:{type:"enabled"}`, `reasoning_effort` none/low/high/max, default high); use `thinking:{type:"disabled"}` or effort `none` for cheap tool loops. With `tools`, **all prior `reasoning_content` must be passed back or the API returns 400**; without tools it's ignored. `max_tokens` default 8K (non-thinking) / 64K (thinking), max 393,216. temperature/presence/frequency ignored in thinking mode; top_p clamped ≥0.95. Strict mode via `/beta` + `strict:true` (from search snippet — **unverified on docs**) |

### xAI Grok (docs.x.ai/docs/models, /overview, /guides/function-calling, /guides/chat, /guides/reasoning, /guides/streaming-response)
| Field | Value |
|---|---|
| Base URL | `https://api.x.ai/v1` — `/chat/completions` (OpenAI-compatible) and `/responses` (preferred by xAI, stateful, 30-day storage) |
| Auth | `Authorization: Bearer <key>` |
| Env var | `XAI_API_KEY` |
| Models | `grok-4.7` — flagship (2026-09-21), 500K ctx, **$2 / $6 (<200k), $4 / $12 (≥200k)**, effort low/medium/high(default)/xhigh; `grok-4.6` — same price, stable; `grok-4.3` — 1M ctx, **$1.25 / $2.50** (<200k), $2.50/$5 above; `grok-4.20-0309-non-reasoning` / `-reasoning` — 1M ctx, $1.25/$2.50. No `grok-4-fast`/`grok-4.7-fast`/`-latest` on the current models page (older third-party listings mention `grok-4-fast`, `grok-4.1-fast` — **not on docs, treat as retired/unverified**) |
| Tools+streaming | Function calling on both endpoints; `parallel_tool_calls` default true (`false` to disable); `tool_choice` auto/required/none/{function}. **"With streaming, the function call is returned in whole in a single chunk, not streamed across chunks."** Streaming SSE `data:`…`[DONE]`; usage appears cumulatively in chunks |
| Quirks | Reasoning models reject `presencePenalty`, `frequencyPenalty`, `stop`; temperature support on grok-4.7 **not stated**. Responses API returns `reasoning.encrypted_content` to pass back unchanged (set `store:false` for privacy). Recommend timeout up to 3600s for reasoning |

### Mistral (docs.mistral.ai/getting-started/models/models_overview/, /capabilities/function_calling/, /api/, mistral.ai/pricing/api)
| Field | Value |
|---|---|
| Base URL | `https://api.mistral.ai/v1/chat/completions` |
| Auth | `Authorization: Bearer <key>` |
| Env var | `MISTRAL_API_KEY` |
| Models | `mistral-medium-2604` (Mistral Medium 3.5, frontier multimodal/agentic) **$1.50 / $7.50**; `mistral-small-2603` (Small 4, hybrid instruct+reasoning+coding) **$0.15 / $0.60**; `mistral-large-2512` (Large 3, open-weight) **$0.50 / $1.50**; `codestral-2508` **$0.30 / $0.90**; `ministral-3-14b-2512` $0.20/$0.20, `-8b-` $0.15/$0.15, `-3b-` $0.10/$0.10. `-latest` aliases (`mistral-medium-latest`, `mistral-small-latest`, `mistral-large-latest`, `codestral-latest`) exist per third-party listings but the overview page did not show the mapping — **unverified** |
| Tools+streaming | Function calling on Large 3, Medium 3.5, Small, Codestral, Ministral 3; `tool_choice` auto/none/any/required/{function}; `parallel_tool_calls` default true; `stream:true`; `response_format` text/json_object/json_schema; uses `max_tokens` (not max_completion_tokens) |
| Quirks | **Tool call ids must match `^[a-zA-Z0-9]{9}$`** (9 alphanumerics) when echoed in `tool` messages — a foreign id (e.g. Anthropic `toolu_…`) is rejected; source: vercel/ai#11802 + vLLM parser, **not Mistral docs**. Streaming tool-call delta shape not documented (assume OpenAI `delta.tool_calls`) |

### Ollama (docs.ollama.com/api/openai-compatibility, /openai)
| Field | Value |
|---|---|
| Base URL | `http://localhost:11434/v1/chat/completions` (cloud: `https://ollama.com/v1`); native `/api/chat` |
| Auth | Any `Authorization: Bearer` value — "Ollama ignores it" |
| Env var | `OLLAMA_HOST` (server bind/address); app-side convention e.g. `OLLAMA_BASE_URL` |
| Models | user-pulled ids (e.g. `llama3.3`, `qwen3`, `gpt-oss:20b`) — list via `/v1/models`; $0 |
| Tools+streaming | Supported fields: model, messages, stream, stream_options, temperature, top_p, max_tokens, stop, seed, penalties, response_format, tools, reasoning_effort, reasoning. **Not supported: `tool_choice`**, logit_bias, user, n, logprobs. `/v1/responses` exists but is stateless |
| Quirks | Image URLs unsupported — base64 only. Tool quality depends on the model; native `/api/chat` has fuller tool support |

### LM Studio (lmstudio.ai/docs/developer, /openai-compat, /openai-compat/tools)
| Field | Value |
|---|---|
| Base URL | `http://localhost:1234/v1` (`lms server start --port 1234`); endpoints `/v1/models`, `/v1/chat/completions`, `/v1/responses`, `/v1/completions`, `/v1/embeddings` |
| Auth | Optional bearer token (`Authorization: Bearer $LM_API_TOKEN` in docs); not required by default |
| Env var | none standard — suggest `LMSTUDIO_BASE_URL` (Vercel AI SDK convention) |
| Models | model key from `lms ls` / `/v1/models`; $0 |
| Tools+streaming | Tool use on `/v1/chat/completions` and `/v1/responses`; streamed as `chunk.choices[0].delta.tool_calls[].function.name/.arguments` pieces to accumulate. "Native" tool use only for models with trained templates (Qwen2.5, Llama 3.1/3.2, Mistral — hammer badge); others use a `[TOOL_REQUEST]…[END_TOOL_REQUEST]` prompt fallback that may misparse into `content`. `tool_choice` not documented |

### Cross-provider quirk table for a WalkMyCode adapter
- **max-tokens field:** `max_completion_tokens` → OpenAI Chat, Groq; `max_output_tokens` → OpenAI Responses; `max_tokens` → Anthropic, DeepSeek, Gemini-compat, Mistral, xAI, Ollama, LM Studio.
- **Temperature:** rejected on OpenAI when effort ≠ none; ignored in DeepSeek thinking mode; Groq coerces 0; Anthropic Sonnet 5.5 non-default → 400 (with thinking).
- **Parallel tool calls:** on by default everywhere except Groq gpt-oss (unsupported); Anthropic returns multiple tool_use blocks → all results in one user message.
- **Streaming tool args:** OpenAI/Groq/Mistral/DeepSeek/Ollama/LM Studio: `delta.tool_calls` fragments keyed by `index`; xAI: whole call in one chunk; Anthropic: `input_json_delta.partial_json`; Gemini native: `functionCall` parts (+thoughtSignature).
- **Round-trip state:** OpenAI Responses reasoning items; DeepSeek `reasoning_content` (400 if dropped with tools); Gemini 3 thought signatures (400 if dropped); xAI encrypted reasoning (Responses).
- **Streamed usage:** OpenAI/DeepSeek/Gemini-compat/Groq: `stream_options.include_usage` → final `usage` chunk with empty `choices`; Groq may also use `x_groq.usage`; Anthropic `message_start.usage.input_tokens` + `message_delta.usage.output_tokens`; Responses API `response.completed`.
- **Tool ids:** Mistral requires 9-char alphanumeric ids; OpenAI `call_…`, Anthropic `toolu_…` — never forward one provider's ids to another mid-conversation.
Key facts:
- Anthropic current ids/prices (platform.claude.com, 2026-09-29): claude-opus-5-5 $4/$20, claude-sonnet-5-5 $2/$10, claude-haiku-4-5 (=claude-haiku-4-5-20251001) $1/$5, claude-fable-5-1 $10/$50; header anthropic-version: 2023-06-01; tool_choice any/tool returns 400 on Opus 5.5 / Sonnet 5.5 / Fable 5.1
- OpenAI GPT-6 line: gpt-6-astra $10/$50, gpt-6.1-sol $2/$10 (cached $0.10), gpt-6-sol $2/$10, gpt-6-luna $0.10/$0.50; all 1.05M ctx / 128K out; verbatim: 'GPT-6 Astra and GPT-6.1 Sol support Chat Completions, but tool calling requires Responses' and 'GPT-6 Sol and GPT-6 Luna support function calling in Chat Completions only with reasoning_effort: "none"'
- OpenAI: temperature/top_p/top_logprobs rejected when reasoning effort != none; Astra and 6.1-Sol reject effort none/minimal; use max_completion_tokens (Chat) / max_output_tokens (Responses); strict:true needs additionalProperties:false and all props required; Responses stream events response.output_item.added → response.function_call_arguments.delta → .done → response.output_item.done, usage on response.completed
- Gemini: OpenAI-compat base https://generativelanguage.googleapis.com/v1beta/openai/ (Bearer key, beta), tools+streaming+stream_options supported, unknown params silently ignored; native v1beta/models/{model}:generateContent|streamGenerateContent?alt=sse with x-goog-api-key; models gemini-3.8-flash $0.75/$3.75 until 2026-12-31 then $1.50/$7.50, gemini-3.5-flash-lite $0.30/$2.50, gemini-3.5-flash $1.50/$9, gemini-3.1-pro-preview $2/$12 (≤200k); 2.5 models restricted to existing users; Gemini 3 thought signatures must be echoed back with function calls
- Groq: https://api.groq.com/openai/v1, GROQ_API_KEY; openai/gpt-oss-120b $0.15/$0.60 and gpt-oss-20b $0.075/$0.30 (no parallel tool calls), llama-3.3-70b-versatile and llama-3.1-8b-instant (parallel ok, price 'Contact Sales' on docs), preview qwen/qwen3.8-27b $0.80/$4.00; Kimi K2 shut down 2026-04-15; uses max_completion_tokens, tool_choice none/auto/required/function, unsupported logprobs/logit_bias/n/messages[].name
- DeepSeek: base https://api.deepseek.com (+ Anthropic-format https://api.deepseek.com/anthropic, beta /beta); models deepseek-flash (V4.1-Flash, 1M ctx, 384K out, off-peak $0.15 miss/$0.003 hit/$0.60 out, peak double) and deepseek-v4-pro (off-peak $0.66/$0.022/$1.98, peak double); deepseek-chat/deepseek-reasoner no longer listed; thinking on by default (reasoning_effort none/low/high/max, default high); with tools, reasoning_content must be passed back or 400
- xAI: https://api.x.ai/v1 (chat/completions + responses, Responses preferred), XAI_API_KEY; grok-4.7 500K ctx $2/$6 (<200k) $4/$12 (≥200k), grok-4.6 same, grok-4.3 1M ctx $1.25/$2.50, grok-4.20-0309-(non-)reasoning $1.25/$2.50; parallel tool calls default on; when streaming, a function call arrives whole in one chunk; reasoning_effort low/medium/high(default)/xhigh
- Mistral: https://api.mistral.ai/v1/chat/completions, MISTRAL_API_KEY; mistral-medium-2604 $1.50/$7.50, mistral-small-2603 $0.15/$0.60, mistral-large-2512 $0.50/$1.50, codestral-2508 $0.30/$0.90, ministral-3-{3b,8b,14b}-2512 $0.10-$0.20 flat; tool_choice auto/none/any/required/function, parallel_tool_calls default true, max_tokens field; tool_call ids must be exactly 9 alphanumeric chars (third-party sourced)
- Ollama: http://localhost:11434/v1 (any bearer value accepted, OLLAMA_HOST), tools+streaming+stream_options+reasoning_effort supported, tool_choice/logprobs/n/user/logit_bias NOT supported, images base64 only, /v1/responses stateless; LM Studio: http://localhost:1234/v1 (optional LM_API_TOKEN), /v1/chat/completions and /v1/responses, tool calls stream as delta.tool_calls fragments, native tool use only for Qwen2.5/Llama-3.1-3.2/Mistral-family models (hammer badge), others use a [TOOL_REQUEST] prompt fallback
Pitfalls:
- OpenAI Chat Completions is NOT enough for GPT-6 tool loops: Astra and 6.1-Sol need the Responses API for tools; Sol/Luna only with reasoning_effort:none. Plan a Responses-API adapter (function_call / function_call_output items, call_id, reasoning items passed back) rather than a chat-completions-only translator
- Gemini 3 thought signatures: dropping them on the tool-result turn yields a 400 ('Thought signature is not valid'); the OpenAI-compat field path (tool_calls[].extra_content.google.thought_signature) comes from community/LiteLLM writeups — Google's page redirected, so verify against the Thinking guide before shipping; strict:true on the compat endpoint is probably silently ignored (unverified)
- DeepSeek: the deepseek-chat / deepseek-reasoner ids are stale — current ids are deepseek-flash and deepseek-v4-pro; with tools, every prior reasoning_content must be echoed back or the API 400s; thinking is on by default (set thinking disabled or effort none for cheap loops); unknown model names on the Anthropic-format route silently map to deepseek-flash
- Groq retires models often (Kimi K2 gone 2026-04-15, Llama 4 not listed); gpt-oss models lack parallel tool calls; Llama prices show 'Contact Sales' on the docs page (third-party $0.59/$0.79 unverified) — validate ids against /openai/v1/models at startup and keep a price table with 'unknown' allowed
- Anthropic 5.5-generation: tool_choice any/tool is a 400 (WalkMyCode's finish_tour forcing must use auto + prompt), Opus 5.5 thinking can't be disabled and defaults to effort medium, Sonnet 5.5 needs thinking:{type:'between_tools'} to turn thinking off, Haiku 4.5 still uses budget_tokens; parse tool input with JSON.parse (escaping varies)
- Mistral rejects tool_call ids that aren't exactly 9 alphanumerics (sourced from vercel/ai#11802 and vLLM, not Mistral docs) — generate provider-local ids and never forward Anthropic toolu_ ids; -latest alias→dated mapping could not be confirmed from docs.mistral.ai
- xAI streams a whole function call in one chunk (not fragmented) and the current models page lists no grok-4-fast / -latest aliases — older listings of grok-4-fast / grok-4.1-fast are unverified; temperature support on grok-4.7 reasoning is not stated
- Streamed usage differs: OpenAI/DeepSeek/Gemini-compat/Groq need stream_options.include_usage and deliver usage in a final chunk with choices: [] (guard choices[0]); Groq may put it under x_groq.usage; Responses API puts it on response.completed; if the stream is cut, usage never arrives — meter defensively
- Gemini 3.8 Flash price rises 2x on 2027-01-01 ($0.75/$3.75 → $1.50/$7.50) — encode an effective-date in the price table; Gemini 2.5 models are restricted to prior users so don't offer them to new installs
- Local servers: Ollama ignores tool_choice and needs base64 images; LM Studio falls back to a prompt-based [TOOL_REQUEST] format on non-native models which can land in content instead of tool_calls — treat local tool-call parsing as best-effort and surface 'model may not support tools' in the picker