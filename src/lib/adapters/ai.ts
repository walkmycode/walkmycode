// The guide through the viewer's own Claude (WalkMyCode Lite inside Claude). The
// artifact's `sample` runs the tool loop itself: WalkMyCode's tools go to it as the
// page's own functions, whose `execute` runs runTool against the repo held in
// this tab, and the answer streams through onText. The result has the shape of
// the app's /api/claude loop (src/lib/claude/client.ts), so the Guide, its
// citations and its tours cannot tell the two apart.
//
// `sample` remembers nothing and takes no system prompt: every ask sends the
// guide's rules and the map as a leading user turn, then the conversation so
// far as plain turns, newest last, within the runtime's 256 KiB.
import { AskError, trimHistory, validateTour, type AskResult, type Conversation } from "@/lib/claude/client";
import { mapSummary, SYSTEM, TOUR_ADDENDUM } from "@/lib/claude/prompts";
import { runTool, TOOLS, TOUR_TOOL, type RepoView, type Tour } from "@/lib/claude/tools";
import type { Finish, FriendlyError, HistoryEntry } from "@/lib/providers/wire";

/** One turn of what `sample` reads. */
export interface SampleTurn {
  role: "user" | "assistant";
  content: string;
}

/** A function of this page that Claude may call (the runtime's SampleTool). */
export interface SampleTool {
  name: string;
  description: string;
  inputSchema?: { type: "object"; properties?: Record<string, unknown>; required?: string[]; [keyword: string]: unknown };
  execute(input: Record<string, unknown>, context: { signal: AbortSignal }): unknown;
}

/** The runtime's `sample`, as far as the guide uses it (sample.d.ts in the artifact contract). */
export type ToolSample = ((
  input: string | SampleTurn[],
  options?: { onText?: (u: { text: string; delta: string }) => void; signal?: AbortSignal; tools?: SampleTool[]; cache?: boolean },
) => Promise<{ text: string; truncated: boolean }>) & {
  limits?: () => Promise<{ maxPromptBytes?: number; tools?: { maxCount: number } }>;
};

/** The rejection every `sample` failure carries. */
interface SampleError {
  code?: string;
  message?: string;
  text?: string;
}

/** The runtime takes at most 32 KB of JSON back from one tool call. */
export const TOOL_RESULT_BYTES = 30_000;
/** The runtime takes 256 KiB of text per call; this leaves room for the tool rounds' framing. */
export const PROMPT_BYTES = 200_000;
const SUMMARY_BYTES = 100_000;
const QUESTION_BYTES = 60_000;

const bytes = (s: string) => new TextEncoder().encode(s).length;

/** `s`, cut (with a note) so that it fits in `max` bytes once measured by `size`. */
function fit(s: string, max: number, note: string, size: (t: string) => number = bytes): string {
  if (size(s) <= max) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (size(s.slice(0, mid) + note) <= max) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo) + note;
}

/** A tool's text, cut to what the runtime accepts back (it is sent JSON-encoded). */
export function fitToolResult(s: string, max = TOOL_RESULT_BYTES): string {
  return fit(s, max, "\n…(cut to fit; ask for fewer lines or a narrower search)", (t) => bytes(JSON.stringify(t)));
}

/** WalkMyCode's tools as the page's functions: read_file, search, query_map and
 * list_files, plus finish_tour for a tour. Schemas go as written; the API's own
 * `strict` flag stays behind. */
export function sampleTools(repo: RepoView, mode: "ask" | "tour", hooks: { onTool?: (name: string, input: Record<string, unknown>) => void; onTour: (t: Tour) => void }): SampleTool[] {
  const defs = mode === "tour" ? [...TOOLS, TOUR_TOOL] : TOOLS;
  return defs.map((d) => ({
    name: d.name,
    description: d.description,
    inputSchema: d.input_schema,
    execute: (input: Record<string, unknown>, context: { signal: AbortSignal }) => {
      if (context?.signal?.aborted) throw new Error("Stopped.");
      const args = input && typeof input === "object" ? input : {};
      hooks.onTool?.(d.name, args);
      if (d.name === TOUR_TOOL.name) {
        const tour = validateTour(args);
        // Thrown, Claude reads "Error: …" and can hand the tour in again.
        if (!tour) throw new Error("Invalid tour: every step needs say, file, start_line, end_line, node_ids.");
        hooks.onTour(tour);
        return "Tour received. Reply with one sentence inviting the user to press Play.";
      }
      return fitToolResult(runTool(repo, d.name, args));
    },
  }));
}

/** The conversation so far as plain turns: questions and the text of answers (tool rounds stay out). */
export function historyTurns(history: HistoryEntry[]): SampleTurn[] {
  const out: SampleTurn[] = [];
  for (const h of history) {
    if (h.role === "user") {
      // A turn that carried images (the app's own route) comes here as its words only.
      const text = typeof h.content === "string" ? h.content : h.content.map((p) => (p.type === "text" ? p.text : "")).join("");
      if (text.trim()) out.push({ role: "user", content: text });
    } else if (h.role === "assistant") {
      const c = h.message.content;
      const text = typeof c === "string" ? c : c.map((p) => (p.type === "text" ? p.text : "")).join("");
      if (text.trim()) out.push({ role: "assistant", content: text });
    }
  }
  return out;
}

function rules(repo: RepoView, mode: "ask" | "tour", tools: boolean): string {
  const noCode = repo.map.files.length > 0 && Object.keys(repo.files).length === 0;
  const how = tools
    ? "You are answering inside WalkMyCode Lite, a page running in Claude. Your tools are the page's own functions: they read the user's code and the map, which stay in the user's browser. Read before you answer."
    : "This Claude app cannot run the page's tools here, so you cannot read more code than the question quotes. Answer from the map below and the quoted lines, and say what you could not check.";
  const missing = noCode ? "\nThe code itself is not loaded in this browser, only its map: read_file and search will find nothing, so answer from the map and say once, simply, that adding the folder again gives full answers." : "";
  const summary = fit(mapSummary(repo.map), SUMMARY_BYTES, "\n…(the summary is cut here; use query_map and list_files for the rest)");
  return `${SYSTEM}${mode === "tour" ? TOUR_ADDENDUM : ""}\n\n${how}${missing}\n\n# The map (built by WalkMyCode's parser, not by an AI)\n${summary}`;
}

/** What `sample` reads: the rules and the map, the conversation so far, the new question.
 * It starts and ends on a user turn; the oldest exchanges go first when it would not fit. */
export function sampleTurns(o: { repo: RepoView; conversation: Conversation; user: string; mode: "ask" | "tour"; tools: boolean }): SampleTurn[] {
  const lead: SampleTurn = { role: "user", content: rules(o.repo, o.mode, o.tools) };
  const now: SampleTurn = { role: "user", content: fit(o.user, QUESTION_BYTES, "\n…(the rest is cut; read the file for more)") };
  let past = historyTurns(o.conversation.history);
  const size = (ts: SampleTurn[]) => ts.reduce((n, t) => n + bytes(t.content), 0);
  while (past.length && size([lead, ...past, now]) > PROMPT_BYTES) {
    // Drop the oldest question with everything said after it, up to the next question.
    let cut = 1;
    while (cut < past.length && past[cut].role !== "user") cut++;
    past = past.slice(cut);
  }
  return [lead, ...past, now];
}

/** Lite opened outside Claude: there is nothing to ask, and the page says why. */
export const NEEDS_CLAUDE: FriendlyError = {
  code: "forbidden",
  title: "Asking needs Claude",
  message: "WalkMyCode Lite answers with your own Claude plan, so questions work when this page is open inside Claude (claude.ai or the Claude app). The map, the code and tracing work here without it.",
  action: null,
};

const TOURS_NEED_TOOLS: FriendlyError = {
  code: "forbidden",
  title: "Tours need Claude's tools",
  message: "Claude cannot run this page's tools here, and a tour has to read the code first. Ask a question instead, or open WalkMyCode Lite in claude.ai.",
  action: null,
};

/** A `sample` failure in the guide's words. */
export function sampleError(e: unknown): FriendlyError {
  const err = (e ?? {}) as SampleError;
  switch (err.code) {
    case "cancelled":
      return { code: "unknown", title: "Stopped", message: "The answer was stopped.", action: "retry" };
    case "not_granted":
    case "sampling_disabled":
    case "not_declared":
    case "capability_disabled":
    case "capability_removed":
      return { code: "forbidden", title: "Claude isn't allowed to answer here", message: "WalkMyCode Lite asks Claude on your own plan. Reload the page and choose Allow when Claude asks. If your organization has turned this off, the map, the code and tracing still work.", action: null };
    case "rate_limited":
      return { code: "rate_limited", title: "You've reached your Claude usage limit", message: "Try again in a little while.", action: "retry" };
    case "session_expired":
      return { code: "forbidden", title: "Your Claude sign-in has expired", message: "Sign in to Claude again, then try once more.", action: "retry" };
    case "prompt_too_large":
      return { code: "unknown", title: "That was too much to read at once", message: "Ask about a smaller part of the code, or one file at a time.", action: "retry" };
    case "refused":
      return { code: "unknown", title: "Claude declined to answer that", message: "Try asking it another way.", action: null };
    case "empty_completion":
      return { code: "unknown", title: "Claude gave no answer", message: "Try asking for less at a time.", action: "retry" };
    case "invalid_request":
    case "transform_error":
    case "queue_overflow":
      return { code: "unknown", title: "The guide sent Claude a request it could not take", message: "This is WalkMyCode's fault, not yours.", action: null, ...(err.message ? { detail: err.message.slice(0, 300) } : {}) };
    default:
      return { code: "network", title: "Claude could not be reached", message: "Try again in a moment.", action: "retry" };
  }
}

/** Whether this view can run page tools: `limits()` lists them only where it can. */
async function toolsHere(s: ToolSample): Promise<boolean> {
  if (typeof s.limits !== "function") return true; // an older runtime: try, and fall back on tools_unavailable
  try {
    return !!(await s.limits()).tools;
  } catch {
    return false;
  }
}

export interface SampleAsk {
  sample: ToolSample;
  repo: RepoView;
  conversation: Conversation;
  user: string;
  mode: "ask" | "tour";
  onText?: (soFar: string) => void;
  onTool?: (name: string, input?: Record<string, unknown>) => void;
  signal?: AbortSignal;
}

/** One question through `sample`: the same AskResult as the app's loop. */
export async function askViaSample(o: SampleAsk): Promise<AskResult> {
  const got: { tour: Tour | null } = { tour: null };
  let tools = await toolsHere(o.sample);
  if (!tools && o.mode === "tour") throw new AskError(TOURS_NEED_TOOLS);

  const call = () =>
    o.sample(sampleTurns({ repo: o.repo, conversation: o.conversation, user: o.user, mode: o.mode, tools }), {
      onText: (u) => o.onText?.(u.text),
      signal: o.signal,
      // Calls with tools are never cached; without them, "Try again" must really ask again.
      ...(tools ? { tools: sampleTools(o.repo, o.mode, { onTool: o.onTool, onTour: (t) => (got.tour = t) }) } : { cache: false }),
    });

  let res: { text: string; truncated: boolean };
  try {
    res = await call();
  } catch (e) {
    const code = (e as SampleError)?.code;
    if (code === "tools_unavailable" && tools && o.mode === "ask") {
      // Not a retry of the same call: the same question, without the tools this view lacks.
      tools = false;
      try {
        res = await call();
      } catch (again) {
        throw new AskError(sampleError(again));
      }
    } else if (code === "tools_unavailable") {
      throw new AskError(TOURS_NEED_TOOLS);
    } else {
      throw new AskError(sampleError(e));
    }
  }

  let text = res.text;
  let finish: Finish = "stop";
  if (res.truncated) {
    text += "\n\n(Cut short at the output limit.)";
    finish = "length";
  }
  const history: HistoryEntry[] = [...o.conversation.history, { role: "user", content: o.user }];
  if (res.text.trim()) history.push({ role: "assistant", message: { role: "assistant", content: [{ type: "text", text: res.text }] } });
  return { text: text.trim(), tour: got.tour, conversation: { history: trimHistory(history), provider: null }, finish };
}
