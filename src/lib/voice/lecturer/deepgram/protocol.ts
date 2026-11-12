// Deepgram's Voice Agent messages (docs/VOICE.md §4; the vendor's reference as
// read on 2026-10-01). Server → client JSON events, client → server JSON
// messages; audio goes both ways as binary frames.
import type { AgentSettings } from "../../agentSettings";

export interface FunctionRequest {
  id: string;
  name: string;
  /** The arguments as a JSON string. */
  arguments: string;
  /** True for functions without an endpoint: the page runs them and answers. */
  client_side?: boolean;
  thought_signature?: string;
}

export type ServerMessage =
  | { type: "Welcome"; request_id?: string }
  | { type: "SettingsApplied" }
  | { type: "PromptUpdated" }
  | { type: "ConversationText"; role: "user" | "assistant"; content: string }
  | { type: "UserStartedSpeaking" }
  | { type: "AgentThinking"; content?: string }
  | { type: "AgentStartedSpeaking"; total_latency?: number; tts_latency?: number; ttt_latency?: number }
  | { type: "AgentAudioDone" }
  | { type: "EndOfTurn"; trigger?: string }
  | { type: "FunctionCallRequest"; functions: FunctionRequest[] }
  | { type: "FunctionCallCancelled"; functions: { id: string; name?: string }[] }
  | { type: "InjectionRefused"; message?: string }
  | { type: "Warning"; code?: string; description?: string }
  | { type: "Error"; code?: string; description?: string }
  | { type: "History" | "LatencyReport" | "SpeakUpdated" | "ThinkUpdated" };

export type ClientMessage =
  | AgentSettings
  | { type: "KeepAlive" }
  | { type: "FunctionCallResponse"; id: string; name: string; content: string }
  | { type: "UpdatePrompt"; prompt: string }
  | { type: "InjectAgentMessage"; message: string; behavior?: "default" | "queue" | "interrupt" };

const KNOWN = new Set([
  "Welcome",
  "SettingsApplied",
  "PromptUpdated",
  "ConversationText",
  "UserStartedSpeaking",
  "AgentThinking",
  "AgentStartedSpeaking",
  "AgentAudioDone",
  "EndOfTurn",
  "FunctionCallRequest",
  "FunctionCallCancelled",
  "InjectionRefused",
  "Warning",
  "Error",
  "History",
  "LatencyReport",
  "SpeakUpdated",
  "ThinkUpdated",
]);

/** A text frame as a server message, or null for anything unparseable or unknown. */
export function parseServerMessage(text: string): ServerMessage | null {
  try {
    const m = JSON.parse(text) as { type?: unknown };
    return m && typeof m === "object" && typeof m.type === "string" && KNOWN.has(m.type) ? (m as ServerMessage) : null;
  } catch {
    return null;
  }
}

/** A function call's JSON arguments as an object ({} when they do not parse). */
export function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
