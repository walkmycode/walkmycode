"use client";
// The question loop, run in the browser: send the conversation to our proxy,
// stream the answer, run any tools the guide asks for against the repo held
// here, and go round again until the guide is done. Assistant messages are
// kept exactly as the server sent them; the provider that produced them is
// kept alongside so the server can refuse to replay them to another one.
// Inside Claude (WalkMyCode Lite) the same question goes to the viewer's own
// Claude instead, with the same tools (src/lib/adapters/ai.ts); on WalkMyCode for
// Claude's page it goes to the user's own Claude over the bridge
// (src/lib/adapters/bridgeAi.ts).
import type { ToolSample } from "@/lib/adapters/ai";
import type { BridgeLike } from "@/lib/adapters/bridgeAi";
import { aiRoute, claudeSample } from "@/lib/adapters/runtime";
import type { AskImage, PageRequest } from "@/lib/bridge/protocol";
import type { AiRoute } from "@/lib/adapters/select";
import { addUsage } from "@/lib/cost";
import type { ProviderId } from "@/lib/providers/catalogue";
import type { AskRequest, Finish, FriendlyError, HistoryEntry, StreamEvent, ToolResultPart } from "@/lib/providers/wire";
import { mapSummary } from "./prompts";
import { runTool, type RepoView, type Tour } from "./tools";

export type FetchLike = typeof globalThis.fetch;

/** What the browser keeps between questions: the history and who produced it. */
export interface Conversation {
  history: HistoryEntry[];
  provider: ProviderId | null;
}

export const emptyConversation = (): Conversation => ({ history: [], provider: null });

export interface AskOptions {
  repo: RepoView;
  conversation: Conversation;
  /** The new user turn (context + question). */
  user: string;
  mode: "ask" | "tour";
  onText?: (soFar: string) => void;
  /** Once with just the name when the model starts a call, again with the input when it runs. */
  onTool?: (name: string, input?: Record<string, unknown>) => void;
  signal?: AbortSignal;
  /** Tests inject a fake; the browser uses the global. */
  fetch?: FetchLike;
  /** Tests inject a fake Claude (the artifact's `sample`), or null for the app's own route;
   * the browser asks the page's runtime (src/lib/adapters/runtime.ts). */
  claude?: ToolSample | null;
  /** What the user did, as WalkMyCode for Claude's bridge carries it (Explain, Trace it, Tour, a
   * typed, spoken or deep question). Only the MCP page's route reads it. */
  request?: PageRequest;
  /** Tests inject a fake bridge; the MCP page uses its own (src/lib/bridge/page.ts). */
  bridge?: BridgeLike;
  /** Images the user attached to the question (the MCP page sends them in `request`). */
  images?: AskImage[];
}

export interface AskResult {
  text: string;
  tour: Tour | null;
  conversation: Conversation;
  finish: Finish;
}

/** Anything that stops an answer, with the structured error the UI renders. */
export class AskError extends Error {
  constructor(readonly info: FriendlyError) {
    super(info.message);
    this.name = "AskError";
  }
}

type MessageEvent = Extract<StreamEvent, { type: "message" }>;

const MAX_ROUNDS = 10;
/** Claude Code, Codex and the Gemini CLI read one file or search at a time, each its own round, and run on the user's plan: a longer leash. */
const CLI_MAX_ROUNDS = 40;
const onPlan = (p: string | null | undefined) => p === "claude-code" || p === "codex" || p === "gemini-cli";
const TOOL_OUTPUT_CHARS = 40_000;

// Readiness is checked once per page load; a failed check is retried on the next question.
let ready = false;

/** Forget the last readiness result, e.g. after Settings change. */
export function resetReadiness(): void {
  ready = false;
}

/**
 * After Settings are saved: another provider cannot continue this history
 * (its round-trip state is private to the one that made it), so the
 * context starts fresh. The same provider keeps it.
 */
export function afterSettingsSaved(c: Conversation, provider: ProviderId): { conversation: Conversation; switched: boolean } {
  resetReadiness();
  if (c.provider === null || c.provider === provider) return { conversation: c, switched: false };
  return { conversation: emptyConversation(), switched: true };
}

export async function ask(o: AskOptions): Promise<AskResult> {
  const via: AiRoute = o.bridge ? "bridge" : o.claude !== undefined ? (o.claude ? "sample" : "api") : await aiRoute();
  if (via === "bridge") {
    // WalkMyCode for Claude: the user's own Claude answers through the local server's bridge.
    const [{ askViaBridge }, page] = await Promise.all([import("@/lib/adapters/bridgeAi"), o.bridge ? null : import("@/lib/bridge/page")]);
    return askViaBridge({
      ...o,
      bridge: o.bridge ?? page!.bridge(),
      // When the client isn't listening and can't be asked directly: the page's own provider key, through
      // the same /api/claude loop as the app (the MCP page's server runs it), if one is set (fallback.ts).
      askOwn: () => ask({ ...o, bridge: undefined, claude: null }),
      speak: (text) => void import("@/lib/voice/mcp").then(({ narration }) => narration().push(text)).catch(() => {}),
    });
  }
  if (via !== "api") {
    const ai = await import("@/lib/adapters/ai");
    if (via === "none") throw new AskError(ai.NEEDS_CLAUDE);
    const sample = o.claude ?? ((await claudeSample()) as ToolSample | null);
    if (!sample) throw new AskError(ai.NEEDS_CLAUDE);
    return ai.askViaSample({ ...o, sample });
  }
  const fetchImpl = o.fetch ?? fetch;
  await ensureReady(fetchImpl, o.signal);
  // Images go up with this turn only; the history kept afterwards says they were there, so they are not sent again every turn.
  const history: HistoryEntry[] = [...o.conversation.history, { role: "user", content: o.images?.length ? [{ type: "text", text: o.user }, ...o.images.map((i) => ({ type: "image" as const, image: i.data, mediaType: i.mediaType }))] : o.user }];
  const asked = history.length - 1;
  let provider = o.conversation.provider;
  let text = "";
  let tour: Tour | null = null;
  let finish: Finish = "stop";
  const summary = mapSummary(o.repo.map);

  let round = 0;
  for (; round < (onPlan(provider) ? CLI_MAX_ROUNDS : MAX_ROUNDS); round++) {
    const body: AskRequest = { history, history_provider: provider, mode: o.mode, mapSummary: summary };
    const m = await callProxy(fetchImpl, body, o.signal, (delta) => {
      text += delta;
      o.onText?.(text);
    }, (name) => o.onTool?.(name));
    addUsage(m.provider, m.model, m.usage);
    history.push({ role: "assistant", message: m.message });
    provider = m.provider;
    finish = m.finish;

    if (finish === "length") {
      text += "\n\n(Cut short at the output limit.)";
      break;
    }
    if (finish === "content-filter") {
      text += "\n\n(The model declined to answer this one.)";
      break;
    }
    if (finish !== "tool-calls" || !m.toolCalls.length) break;

    const results: ToolResultPart[] = [];
    for (const call of m.toolCalls) {
      o.onTool?.(call.toolName, call.input);
      if (call.toolName === "finish_tour") {
        tour = validateTour(call.input);
        results.push({
          type: "tool-result",
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: tour ? { type: "text", value: "Tour received. Reply with one sentence inviting the user to press Play." } : { type: "error-text", value: "Invalid tour: every step needs say, file, start_line, end_line, node_ids." },
        });
        continue;
      }
      let out: string;
      try {
        out = runTool(o.repo, call.toolName, call.input);
      } catch (e) {
        out = `Tool error: ${(e as Error).message}`;
      }
      results.push({ type: "tool-result", toolCallId: call.toolCallId, toolName: call.toolName, output: { type: "text", value: out.slice(0, TOOL_OUTPUT_CHARS) } });
    }
    history.push({ role: "tool", content: results });
    if (text) text += "\n\n";
  }
  // Out of rounds while the guide still wanted to look: say so rather than end on "Let me look…".
  if (finish === "tool-calls" && round === (onPlan(provider) ? CLI_MAX_ROUNDS : MAX_ROUNDS)) text += "(The guide stopped after reading a lot of the code. Ask a narrower question, or ask it to carry on.)";
  if (o.images?.length) history[asked] = { role: "user", content: `${o.user}\n\n(${o.images.length === 1 ? "An image was" : `${o.images.length} images were`} attached to this question.)` };
  return { text: text.trim(), tour, conversation: { history: trimHistory(history), provider }, finish };
}

/** A tour the guide handed in, checked: the steps it can play, or null. */
export function validateTour(input: Record<string, unknown>): Tour | null {
  const steps = Array.isArray(input.steps) ? (input.steps as Record<string, unknown>[]) : [];
  const ok = steps.filter((s) => typeof s.say === "string" && typeof s.file === "string" && Number.isFinite(s.start_line) && Number.isFinite(s.end_line));
  if (!ok.length) return null;
  return {
    title: typeof input.title === "string" ? input.title : "Tour",
    steps: ok.map((s) => ({
      say: s.say as string,
      file: s.file as string,
      start_line: Number(s.start_line),
      end_line: Math.max(Number(s.start_line), Number(s.end_line)),
      node_ids: Array.isArray(s.node_ids) ? (s.node_ids as unknown[]).filter((x): x is string => typeof x === "string") : [],
    })),
  };
}

/**
 * Keep the last few entries, whole. The kept slice always starts on a user
 * entry, so a reply is never separated from its question nor a tool call
 * from its result; a long tool loop is kept in full rather than cut.
 */
export function trimHistory(h: HistoryEntry[]): HistoryEntry[] {
  const MAX = 24;
  if (h.length <= MAX) return h;
  let start = h.length - MAX;
  while (start > 0 && h[start].role !== "user") start--;
  return h.slice(start);
}

const unreachable = (): AskError => new AskError({ code: "network", title: "Can't reach the WalkMyCode server", message: "Is `npm run dev` still running? Check the terminal and try again.", action: "retry" });

async function ensureReady(fetchImpl: FetchLike, signal?: AbortSignal): Promise<void> {
  if (ready) return;
  let res: Response;
  try {
    res = await fetchImpl("/api/config/readiness", { signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw unreachable();
  }
  if (!res.ok) return; // let /api/claude say what is wrong
  const { llm } = (await res.json()) as { llm: FriendlyError | null };
  if (llm) throw new AskError(llm);
  ready = true;
}

/** One step: POST the conversation and read the SSE back until the message event. */
async function callProxy(fetchImpl: FetchLike, body: AskRequest, signal: AbortSignal | undefined, onDelta: (t: string) => void, onTool: (name: string) => void): Promise<MessageEvent> {
  let res: Response;
  try {
    res = await fetchImpl("/api/claude", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw unreachable();
  }
  if (!res.ok || !res.body) {
    let error: unknown;
    try {
      error = ((await res.json()) as { error?: unknown }).error;
    } catch {}
    if (error && typeof error === "object" && "code" in error) throw new AskError(error as FriendlyError);
    throw new AskError({ code: "unknown", title: "The guide could not answer", message: typeof error === "string" && error ? error : `The WalkMyCode server answered ${res.status}.`, action: "retry" });
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let final: MessageEvent | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const ev = JSON.parse(line.slice(5)) as StreamEvent;
      if (ev.type === "text") onDelta(ev.text);
      else if (ev.type === "tool") onTool(ev.name);
      else if (ev.type === "message") final = ev;
      else if (ev.type === "error") throw new AskError(ev.error);
    }
  }
  if (!final) throw new AskError({ code: "unknown", title: "The answer ended early", message: "The stream closed without a final message. Try again.", action: "retry" });
  return final;
}
