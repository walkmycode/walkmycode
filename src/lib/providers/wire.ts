// The contract between the browser and /api/claude: what the browser keeps
// between turns, what it sends, and the events that come back on the stream.
// Shared by both sides; the imports from "ai" are type-only so nothing of the
// SDK reaches the client bundle.
import type { AssistantModelMessage, ModelMessage } from "ai";
import type { Effort, ProviderId } from "./catalogue";

/** What the browser keeps. Assistant entries are the server's message verbatim — never edited. */
export type HistoryEntry =
  | { role: "user"; content: string | UserPart[] } // UserModelMessage subset: text, or text and images
  | { role: "assistant"; message: AssistantModelMessage } // opaque; providerOptions intact
  | { role: "tool"; content: ToolResultPart[] }; // ToolModelMessage["content"]

/** A user turn's parts when it carries images: base64 (no data: prefix) with its type. */
export type UserPart = { type: "text"; text: string } | { type: "image"; image: string; mediaType: string };

export interface ToolResultPart {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output: { type: "text"; value: string } | { type: "error-text"; value: string };
}

export interface ToolCall {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface AskRequest {
  history: HistoryEntry[];
  history_provider: ProviderId | null; // provider that produced every assistant entry; null when history is empty
  mode: "ask" | "tour";
  mapSummary: string;
}

/** Anthropic field names kept so cost.ts and the header pill change minimally. */
export interface Usage {
  input_tokens: number; // UNCACHED input tokens (noCache)
  output_tokens: number; // includes reasoning tokens
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  reasoning_tokens: number;
  known: boolean; // false when the provider reported no usage (cut stream, local server)
}

export type Finish = "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other";

export type ErrorCode =
  | "no_model"
  | "cli_missing"
  | "cli_signed_out"
  | "cli_not_plan"
  | "cli_hosted"
  | "cli_unsupported"
  | "missing_key"
  | "invalid_key"
  | "out_of_credits"
  | "rate_limited"
  | "model_unavailable"
  | "stale_history"
  | "forbidden"
  | "network"
  | "unknown";

export interface FriendlyError {
  code: ErrorCode;
  title: string;
  message: string;
  action: "settings" | "retry" | null;
  provider?: ProviderId;
  status?: number;
  detail?: string; // first 300 chars of the provider's body, key-shaped strings scrubbed
}

/** Server → browser SSE, framed exactly as today: `data: <json>\n\n`. */
export type StreamEvent =
  | { type: "text"; text: string } // fullStream text-delta
  | { type: "tool"; name: string } // fullStream tool-input-start (early trace)
  | {
      type: "message";
      message: AssistantModelMessage;
      finish: Finish;
      toolCalls: ToolCall[];
      usage: Usage;
      provider: ProviderId;
      model: string; // model = requested id, not the vendor's dated echo
    }
  | { type: "error"; error: FriendlyError };

/** Server side only: what the route hands to sdk.ts */
export interface Resolved {
  provider: ProviderId;
  model: string;
  effort: Effort;
  base_url?: string;
}

/** Turn the browser's history into the SDK's message list. Assistant entries pass through untouched. */
export function toModelMessages(history: HistoryEntry[]): ModelMessage[] {
  return history.map((h): ModelMessage => {
    if (h.role === "user") return { role: "user", content: h.content };
    if (h.role === "assistant") return h.message;
    return { role: "tool", content: h.content };
  });
}
