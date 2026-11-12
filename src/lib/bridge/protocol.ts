// The bridge between WalkMyCode's page and the user's own Claude, in WalkMyCode for
// Claude (the MCP version, docs/MCP.md §2–§3). One WebSocket carries two
// directions:
//  - requests: what the user did on the page (Explain, Trace it, Tour, a typed
//    or spoken question). The local server queues them until Claude asks for
//    the next one with `next_request`.
//  - commands: what Claude does to the page (answer, narrate, light a card,
//    open a file…). The page acknowledges each one.
// Plain types and pure checks only: the page (phase B) and the server (mcp/src)
// both import this file, so nothing here may touch Node or the DOM.

/** Bumped when a message changes shape; the server names its version in `welcome`. */
export const BRIDGE_PROTOCOL = 1;
/** The WebSocket's path on the local server. */
export const BRIDGE_PATH = "/bridge";

// ── page → Claude: requests ──

/** An image attached to a question: base64 (no data: prefix) and its type. */
export interface AskImage {
  mediaType: ImageType;
  data: string;
}
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];
/** At most this many images with one question, each at most this many base64 characters (about 3 MB). */
export const MAX_IMAGES = 4;
export const MAX_IMAGE_CHARS = 4_000_000;

/** The images a page attached, checked: known types, plain base64, within the limits; anything else dropped. */
export function parseImages(raw: unknown): AskImage[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: AskImage[] = [];
  for (const v of raw.slice(0, MAX_IMAGES)) {
    if (typeof v !== "object" || v === null) continue;
    const { mediaType, data } = v as Record<string, unknown>;
    const type = IMAGE_TYPES.find((t) => t === mediaType);
    if (!type || typeof data !== "string" || !data || data.length > MAX_IMAGE_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) continue;
    out.push({ mediaType: type, data });
  }
  return out.length ? out : undefined;
}

export const REQUEST_KINDS = ["explain", "trace", "tour", "question", "spoken", "deep"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export const VIEWS = ["system", "all", "service"] as const;
/** The map's views: the services of a system, every card at once, or one service's lanes. */
export type View = (typeof VIEWS)[number];

/** A range of lines, 1-based and inclusive. */
export interface LineRange {
  from: number;
  to: number;
}

/** What is on screen when the user asks: the file, the lines, the card, the tour step. */
export interface RequestContext {
  file?: string;
  lines?: LineRange;
  nodeId?: string;
  tourStep?: number;
  view?: View;
  service?: string;
}

/** What the page sends with each kind of request. */
export interface RequestPayloads {
  /** Explain this: a card, a file, or selected lines (with their text when the page has it). */
  explain: { nodeId?: string; path?: string; from?: number; to?: number; text?: string };
  /** Trace it: from a card, and to another when the user picked one. */
  trace: { from: string; to?: string };
  /** A guided tour, of a topic or of what is on screen. */
  tour: { topic?: string };
  /** A question typed on the page, with any images the user pasted or dropped in (a screenshot, a diagram). */
  question: { text: string; images?: AskImage[] };
  /** A question said out loud, already turned into text by the page. `continues`: the user kept talking
   * before the answer came, so this is their whole question so far and replaces the spoken one before it. */
  spoken: { text: string; continues?: boolean };
  /** A hard question the fast voice agent hands to Claude (the Lightning lecturer, MCP.md §4). */
  deep: { text: string };
}

export type PageRequest = { [K in RequestKind]: { kind: K; payload: RequestPayloads[K]; context?: RequestContext } }[RequestKind];

/** A request as Claude gets it from next_request: the page's, with the server's id and the time it came in. */
export type BridgeRequest = PageRequest & { id: string; at: string };

// ── Claude → page: commands ──

/** A cited range of a file; the page lights it up. */
export interface Citation {
  path: string;
  from: number;
  to: number;
}

/** One step of a tour: what to say, and the lines and cards to light while it is said. */
export interface TourStep {
  say: string;
  file: string;
  from: number;
  to: number;
  nodeIds: string[];
}

/** The open workspace as the page first hears of it; the map itself comes from GET /api/workspace. */
export interface WorkspaceInfo {
  id: string;
  name: string;
  /** One label per folder; with several, every path starts with its folder's label. */
  repos: string[];
  files: number;
  mappedAt: string;
}

export type Command =
  /** Show an answer in the Guide panel; its citations light up. `requestId` is the request it answers, when there is one. */
  | { name: "answer"; requestId?: string; markdown: string; citations: Citation[] }
  /** Say a short chunk now. The page queues chunks and speaks them in order. */
  | { name: "narrate"; text: string; requestId?: string }
  | { name: "focus_node"; nodeId: string; path?: string }
  | { name: "open_file"; path: string; line?: number }
  | { name: "highlight_lines"; path: string; from: number; to: number }
  /** A path through the map: the cards and arrows to light, in order. */
  | { name: "trace_path"; from: string; to: string; nodeIds: string[]; edgeIds: string[] }
  | { name: "start_tour"; title: string; steps: TourStep[] }
  /** Jump to a tour step, 1-based. */
  | { name: "tour_step"; n: number }
  | { name: "show_view"; view: View; service?: string }
  /** Open "New project" on the page with this starter, name (and what it should do) filled in; the user presses Make it (src/ide/localrun/setup). */
  | { name: "new_project"; starter: string; projectName: string; brief?: string }
  /** A new map is ready (walkmycode_open again): fetch it from GET /api/workspace. */
  | { name: "workspace"; workspace: WorkspaceInfo };

export type CommandName = Command["name"];

/** Whether Claude is listening, so the page can say plainly when it is not (MCP.md §7). */
export interface ClaudeStatus {
  /** A next_request call is waiting right now. */
  listening: boolean;
  /** When Claude last asked for a request (ISO time), or null if it never has. */
  lastPollAt: string | null;
  /** Requests waiting for Claude. */
  queued: number;
  /** Requests Claude has taken and not answered yet. */
  working: string[];
  /** The connected AI app's friendly name ("Claude", "Antigravity", "Cursor"…, src/lib/bridge/clientName.ts), once it has said who it is. */
  client?: string;
  /** No MCP client at all: the server was started from a terminal (mcp/src/cli.ts), so the page answers every
   * request itself with its own key (src/lib/bridge/fallback.ts). Never set together with `client`. */
  standalone?: boolean;
}

// ── the messages ──

export type ServerMessage =
  | { type: "welcome"; protocol: number; workspace: WorkspaceInfo | null; claude: ClaudeStatus }
  | { type: "command"; id: string; command: Command }
  /** A request is waiting for Claude (`ref` is the page's own name for it). */
  | { type: "queued"; id: string; ref?: string; position: number }
  /** A message the server could not take, and why. */
  | { type: "rejected"; ref?: string; error: string }
  /** Claude picked the request up. */
  | { type: "taken"; id: string }
  /** A queued request was removed before Claude took it (cancelled, or the queue was full). */
  | { type: "dropped"; id: string; reason: string }
  | { type: "status"; claude: ClaudeStatus }
  /** Nobody took the request in time and the client can't be asked directly (src/lib/bridge/fallback.ts): it
   * stays queued, and the page may answer it another way (its own key, then it cancels it) or say so. */
  | { type: "unheard"; id: string }
  /** WalkMyCode was opened in another tab, which now gets everything; this one should say so. */
  | { type: "replaced" };

export type PageMessage =
  | { type: "hello"; protocol: number }
  | { type: "request"; request: PageRequest; ref?: string }
  /** The page took a command (`note` may say what it did), or could not (`error` says why). */
  | { type: "ack"; id: string; ok: true; note?: string }
  | { type: "ack"; id: string; ok: false; error: string }
  /** Take back a request Claude has not picked up yet. */
  | { type: "cancel"; id: string }
  /** The user is still using the page: keeps Claude listening. */
  | { type: "activity" };

// ── checks (the server runs these on everything a page sends) ──

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** A question or a selection of code. */
export const MAX_TEXT = 20_000;
/** Ids, paths, names, topics. */
export const MAX_SHORT = 1_000;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const short = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 && v.length <= MAX_SHORT ? v : undefined);
const line = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 10_000_000 ? v : undefined);
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Copy only the fields that are present, so absent ones stay absent (not `undefined`). */
function present<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

function parseContext(raw: unknown): RequestContext | undefined {
  if (!isObject(raw)) return undefined;
  const lines = isObject(raw.lines) && line(raw.lines.from) && line(raw.lines.to) ? { from: line(raw.lines.from)!, to: Math.max(line(raw.lines.from)!, line(raw.lines.to)!) } : undefined;
  const view = VIEWS.find((v) => v === raw.view);
  const ctx = present({ file: short(raw.file), lines, nodeId: short(raw.nodeId), tourStep: line(raw.tourStep), view, service: short(raw.service) });
  return Object.keys(ctx).length ? ctx : undefined;
}

function text(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() && v.length <= MAX_TEXT ? v : undefined;
}

/** A request from the page, checked field by field; anything else it carried is dropped. */
export function parsePageRequest(raw: unknown): Parsed<PageRequest> {
  if (!isObject(raw)) return fail("A request is an object with kind and payload.");
  const kind = REQUEST_KINDS.find((k) => k === raw.kind);
  if (!kind) return fail(`kind must be one of ${REQUEST_KINDS.join(", ")}.`);
  const p = isObject(raw.payload) ? raw.payload : {};
  const context = parseContext(raw.context);
  const withContext = <R extends PageRequest>(r: R): Parsed<PageRequest> => ({ ok: true, value: context ? { ...r, context } : r });
  switch (kind) {
    case "explain": {
      const payload = present({ nodeId: short(p.nodeId), path: short(p.path), from: line(p.from), to: line(p.to), text: text(p.text) });
      if (!payload.nodeId && !payload.path && !payload.text) return fail("explain needs a nodeId, a path or the selected text.");
      return withContext({ kind, payload });
    }
    case "trace": {
      const from = short(p.from);
      if (!from) return fail("trace needs from (a card's id).");
      return withContext({ kind, payload: present({ from, to: short(p.to) }) });
    }
    case "tour":
      return withContext({ kind, payload: present({ topic: short(p.topic) }) });
    case "question": {
      const t = text(p.text);
      if (!t) return fail(`${kind} needs text (at most ${MAX_TEXT} characters).`);
      const images = parseImages(p.images);
      return withContext({ kind, payload: images ? { text: t, images } : { text: t } });
    }
    case "spoken": {
      const t = text(p.text);
      if (!t) return fail(`${kind} needs text (at most ${MAX_TEXT} characters).`);
      return withContext({ kind, payload: p.continues === true ? { text: t, continues: true } : { text: t } });
    }
    default: {
      const t = text(p.text);
      if (!t) return fail(`${kind} needs text (at most ${MAX_TEXT} characters).`);
      return withContext({ kind, payload: { text: t } });
    }
  }
}

/** Anything a page sends, checked. Unknown types and malformed fields are refused with a reason. */
export function parsePageMessage(raw: unknown): Parsed<PageMessage> {
  if (!isObject(raw) || typeof raw.type !== "string") return fail("A message is a JSON object with a type.");
  switch (raw.type) {
    case "hello":
      return typeof raw.protocol === "number" ? { ok: true, value: { type: "hello", protocol: raw.protocol } } : fail("hello needs the protocol number.");
    case "activity":
      return { ok: true, value: { type: "activity" } };
    case "request": {
      const r = parsePageRequest(raw.request);
      if (!r.ok) return r;
      const ref = short(raw.ref);
      return { ok: true, value: ref ? { type: "request", request: r.value, ref } : { type: "request", request: r.value } };
    }
    case "ack": {
      const id = short(raw.id);
      if (!id || typeof raw.ok !== "boolean") return fail("ack needs the command's id and ok.");
      const note = typeof raw.note === "string" && raw.note ? raw.note.slice(0, MAX_SHORT) : undefined;
      if (raw.ok) return { ok: true, value: note ? { type: "ack", id, ok: true, note } : { type: "ack", id, ok: true } };
      const error = typeof raw.error === "string" && raw.error ? raw.error.slice(0, MAX_SHORT) : "The page could not do it.";
      return { ok: true, value: { type: "ack", id, ok: false, error } };
    }
    case "cancel": {
      const id = short(raw.id);
      return id ? { ok: true, value: { type: "cancel", id } } : fail("cancel needs the request's id.");
    }
    default:
      return fail(`Unknown message type "${raw.type.slice(0, 40)}".`);
  }
}

/** "lib/auth.ts:7-9", "`lib/auth.ts:7`" → the file and lines; null when it is not a citation. */
export function parseCitation(raw: string): Citation | null {
  const m = /^`?(.*?[^\s`]):(\d+)(?:\s*[-–]\s*(\d+))?`?$/.exec(raw.trim());
  if (!m) return null;
  const from = Number(m[2]);
  const to = m[3] === undefined ? from : Number(m[3]);
  if (!Number.isInteger(from) || from < 1 || !Number.isInteger(to)) return null;
  return { path: m[1].replace(/^\.?\//, ""), from: Math.min(from, to), to: Math.max(from, to) };
}

/** A citation as Claude and the page write it: "path:from" or "path:from-to". */
export function formatCitation(c: Citation): string {
  return c.from === c.to ? `${c.path}:${c.from}` : `${c.path}:${c.from}-${c.to}`;
}
