// What the page says when a request never reached WalkMyCode's server (fetch throws a TypeError:
// "Failed to fetch"): the server has stopped. On WalkMyCode for Claude it stops with the Claude
// session that opened the page, so "try again" can't help; say what will. Every other failure
// keeps its own words.
import { TARGET } from "@/lib/adapters/target";

export const UNREACHABLE =
  TARGET === "mcp"
    ? "WalkMyCode's server isn't running: it stops when the Claude session that opened this page ends. Ask Claude to open WalkMyCode again, then use the page it opens."
    : "WalkMyCode's server isn't running: start WalkMyCode again, then reload this page.";

/** The words for a failed request: the server's own, or that it isn't running at all. */
export function whyFailed(e: unknown): string {
  if (e instanceof TypeError) return UNREACHABLE;
  return (e as Error)?.message || "Something went wrong.";
}
