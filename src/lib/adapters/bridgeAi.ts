// The guide through the user's own Claude, in WalkMyCode for Claude (the MCP page,
// docs/MCP.md §3): Explain, Trace it, Tour and a typed or spoken question each
// become one bridge request, which waits at the local server until Claude asks
// for it (next_request). Claude reads the code with its own tools, narrates as
// it goes and drives the page with commands, then sends `answer` naming the
// request: that is the answer the Guide shows. The narration that comes first
// is shown while the answer is on its way, so the board is never blank. The
// result has the shape of the app's loop (AskResult), so the Guide cannot tell
// the routes apart. A tour comes as its own command (start_tour), not here.
import { AskError, trimHistory, type AskResult, type Conversation } from "@/lib/claude/client";
import { MAX_TEXT, type Command, type PageRequest } from "@/lib/bridge/protocol";
import { AskEnded, aiName, isStandalone, type Ask, type BridgeSnapshot } from "@/lib/bridge/client";
import { capName, FALLBACK_CLIENT, STANDALONE_NAME } from "@/lib/bridge/clientName";
import { answerRoute } from "@/lib/bridge/fallback";
import type { FriendlyError } from "@/lib/providers/wire";

/** What the adapter needs of the page's bridge (the BridgeClient, or a test's fake). */
export interface BridgeLike {
  request(r: PageRequest): Ask;
  onCommand(l: (c: Command) => void): () => void;
  /** The bridge's state: the connected AI app's name is in it (the BridgeClient has it; a test's fake may not). */
  snapshot?(): Pick<BridgeSnapshot, "claude">;
}

export interface BridgeAsk {
  bridge: BridgeLike;
  /** What the user did, as the bridge carries it; without one, the user's words go as a typed question. */
  request?: PageRequest;
  conversation: Conversation;
  /** The words the guide was given (context + question): the question's text when no request is given. */
  user: string;
  mode: "ask" | "tour";
  /** The narration so far, while the answer is on its way. */
  onText?: (soFar: string) => void;
  signal?: AbortSignal;
  /** When the client isn't listening (src/lib/bridge/fallback.ts): answer with the page's own provider key
   * (the app's /api/claude loop, run against this page's server). Without it, the page can only say so. */
  askOwn?: () => Promise<AskResult>;
  /** Whether the page's own provider can answer now (default: GET /api/config/readiness says ready). */
  ownKey?: () => Promise<boolean>;
  /** Read an answer aloud: a spoken question answered with the page's own key is spoken back. */
  speak?: (text: string) => void;
}

/** Whether this page's server has a provider ready to answer (a key in Settings → AI model, or a local model). */
export async function ownKeyReady(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl("/api/config/readiness");
    if (!res.ok) return false;
    return ((await res.json()) as { llm?: unknown }).llm === null;
  } catch {
    return false;
  }
}

/** The client isn't listening and the page has no key of its own: say so, plainly, by name, with the way out. */
export function unheardError(who: string = FALLBACK_CLIENT): FriendlyError {
  return {
    code: "unknown",
    title: `${capName(who)} isn't listening`,
    message: `Ask ${who === FALLBACK_CLIENT ? "it" : who} to “keep listening to WalkMyCode”, or add a key in Settings → AI model to chat here.`,
    action: "settings",
  };
}

/** No AI app is connected at all (terminal mode) and the page has no key: the one way to ask here. */
export function noKeyHereError(): FriendlyError {
  return {
    code: "unknown",
    title: "Add an AI key in Settings → AI model to ask questions here",
    message: "WalkMyCode was started from a terminal, so no AI app is connected: answers come from a model you pick in Settings → AI model, with your own key (or a model on this computer).",
    action: "settings",
  };
}

/** The page's own key, when the client can't answer: the answer, spoken back for a spoken question; or the plain error. */
async function answerHere(o: BridgeAsk, request: PageRequest, standalone: boolean, who: string, withdraw: () => void): Promise<AskResult> {
  const pageKey = o.askOwn ? await (o.ownKey ?? ownKeyReady)() : false;
  if (o.signal?.aborted) throw stopped();
  if (answerRoute({ live: false, sampling: false, pageKey, standalone }) !== "key" || !o.askOwn) throw new AskError(standalone ? noKeyHereError() : unheardError(who));
  // Answered here: the client must not answer it too if it comes back.
  withdraw();
  const r = await o.askOwn();
  if (request.kind === "spoken" && r.text) o.speak?.(r.text);
  return r;
}

/** The request for a job that came without one: the user's words, cut to what the bridge takes. */
export function requestFor(user: string, mode: "ask" | "tour"): PageRequest {
  const text = user.trim().slice(0, MAX_TEXT) || "Explain this code.";
  return mode === "tour" ? { kind: "tour", payload: { topic: text.slice(0, 1000) } } : { kind: "question", payload: { text } };
}

const stopped = (): Error => Object.assign(new Error("Stopped."), { name: "AbortError" });

/** A request that ended with no answer, in the guide's words; `who` is the connected AI app's name. */
export function endedError(e: AskEnded, who: string = FALLBACK_CLIENT): FriendlyError {
  return e.reason === "dropped"
    ? { code: "unknown", title: `${capName(who)} didn't get to this one`, message: `${e.message} Ask again when ${who} is listening.`, action: "retry" }
    : { code: "unknown", title: `WalkMyCode couldn't send that to ${who}`, message: e.message, action: "retry" };
}

/** One question through the bridge: the same AskResult as the app's loop. */
export async function askViaBridge(o: BridgeAsk): Promise<AskResult> {
  if (o.signal?.aborted) throw stopped();
  const request = o.request ?? requestFor(o.user, o.mode);
  // No AI app at all (terminal mode): nothing to send it to, so the page answers at once (src/lib/bridge/fallback.ts).
  if (o.bridge.snapshot && isStandalone(o.bridge.snapshot())) return answerHere(o, request, true, STANDALONE_NAME, () => {});
  const ask = o.bridge.request(request);
  let said = "";
  const off = o.bridge.onCommand((c) => {
    const id = ask.idNow();
    if (c.name !== "narrate" || !id || c.requestId !== id) return;
    said = said ? `${said} ${c.text.trim()}` : c.text.trim();
    o.onText?.(said);
  });
  const onAbort = () => ask.cancel();
  o.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const a = await ask.answer;
    const text = a.markdown.trim();
    const history = trimHistory([...o.conversation.history, { role: "user", content: o.user }, ...(text ? [{ role: "assistant" as const, message: { role: "assistant" as const, content: [{ type: "text" as const, text }] } }] : [])]);
    return { text, tour: null, conversation: { history, provider: null }, finish: "stop" };
  } catch (e) {
    if (e instanceof AskEnded) {
      if (e.reason === "cancelled") throw stopped();
      const snap = o.bridge.snapshot?.();
      const who = snap ? aiName(snap) : FALLBACK_CLIENT;
      // Nobody polled and the client can't be asked directly (or there is no client at all): the page's own key, else say so (fallback.ts).
      if (e.reason === "unheard") return await answerHere(o, request, snap ? isStandalone(snap) : false, who, () => ask.withdraw());
      throw new AskError(endedError(e, who));
    }
    throw e;
  } finally {
    off();
    o.signal?.removeEventListener("abort", onAbort);
  }
}
