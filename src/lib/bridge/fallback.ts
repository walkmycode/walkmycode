// Who answers a question asked on WalkMyCode's MCP page (docs/MCP.md §7). The
// page's requests wait for the client's next_request loop, but not every MCP
// client keeps that loop going: Claude Code polls for as long as it is asked
// to, while Antigravity (Gemini) ends its turn after a task and never polls
// again. So a request never depends on the loop alone:
//  1. "queue": the loop is live (a next_request is waiting, or one came in the
//     last few seconds, or the client is still working on an earlier request):
//     the request waits for it, as it always has;
//  2. "sampling": otherwise, after a few seconds with no poll, when the client
//     declared the MCP `sampling` capability, the server asks the client's
//     model directly (createMessage) with the map and the code the request
//     points at, and shows the answer through the same answer/narrate path;
//  3. "key": otherwise, when the page has its own AI provider key (Settings →
//     AI model, the full app's provider layer), the page answers with that;
//  4. "tell": otherwise the page says plainly that the client isn't listening,
//     and how to bring it back or answer here instead. The request stays queued,
//     so the client still answers it if it comes back.
// Run from a terminal (`node mcp/dist/server.mjs <folder>`, mcp/src/cli.ts) there
// is no MCP client at all: the server says so (`standalone` in its status), and
// every request goes straight to 3 or 4, with no wait and no sampling; 4 then
// asks for a key rather than for a client that will never come.
// Pure, so tests check every case; the server (mcp/src/bridge.ts) decides 1–2
// and the page (src/lib/adapters/bridgeAi.ts) 3–4.

/** A poll this recent means the client is between two next_request calls: its loop is live. */
export const POLL_LIVE_MS = 5_000;
/** A client working on an earlier request comes back to poll when done: live, if it polled within this. */
export const BUSY_LIVE_MS = 5 * 60_000;
/** How long a request waits for a poll before it is answered another way. */
export const UNHEARD_AFTER_MS = 3_500;

export type AnswerRoute = "queue" | "sampling" | "key" | "tell";

export interface LoopState {
  /** A next_request call is waiting right now. */
  listening: boolean;
  /** When the client last polled (ms), or null if it never has. */
  lastPollAt: number | null;
  /** Requests the client has taken and not answered yet. */
  working: number;
  now: number;
}

/** Whether the client's next_request loop is going: waiting now, polled moments ago, or busy with a request it took recently. */
export function loopLive(s: LoopState): boolean {
  if (s.listening) return true;
  if (s.lastPollAt === null) return false;
  const since = s.now - s.lastPollAt;
  return since < POLL_LIVE_MS || (s.working > 0 && since < BUSY_LIVE_MS);
}

/** Who answers a request: the loop, the client's model through sampling, the page's own key, or nobody (say so).
 * `standalone`: no MCP client is connected at all (terminal mode), so only the page's own key can answer, at once. */
export function answerRoute(o: { live: boolean; sampling: boolean; pageKey: boolean; standalone?: boolean }): AnswerRoute {
  if (o.standalone) return o.pageKey ? "key" : "tell";
  if (o.live) return "queue";
  if (o.sampling) return "sampling";
  return o.pageKey ? "key" : "tell";
}
