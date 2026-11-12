// The tools Claude gets from WalkMyCode for Claude (docs/MCP.md §3):
//  - the loop: walkmycode_open, next_request, answer, narrate;
//  - driving the page: focus_node, open_file, highlight_lines, trace_path,
//    start_tour, tour_step, show_view (each a command the page acknowledges);
//  - reading, so answers stay grounded: query_map, read_file, search,
//    list_files, run here by the same runner as the typed guide
//    (src/lib/claude/tools.ts), over the workspace held in this process.
// Every result is plain text a model can use, errors say what to do next, and
// everything passes through the secret guard on the way out.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { CallToolResult, ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Assertion, CodeMap, MapEdge, MapNode } from "../../src/analyzer/types";
import { formatCitation, parseCitation, type BridgeRequest, type Citation, type RequestKind, type TourStep } from "../../src/lib/bridge/protocol";
import { mapSummary } from "../../src/lib/claude/prompts";
import { describeEdge, findService, isSystem } from "../../src/lib/claude/system";
import { runTool } from "../../src/lib/claude/tools";
import { createLocalRun, type LocalRun } from "../../src/lib/localrun/hub";
import { killAll } from "../../src/lib/localrun/processes";
import { locateIn } from "../../src/lib/localrun/run";
import { edgesOf } from "../../src/lib/store";
import type { FetchLike } from "../../src/lib/voice/routes";
import { NoAckError, NoPageError, PageRefusedError, type Bridge } from "./bridge";
import { log } from "./log";
import { apiRoutes } from "./routes";
import { guardText } from "./secrets";
import { startWeb, type Web } from "./web";
import { pickFolder } from "./pickFolder";
import { FolderError, keepPort, lanternDir, lastPort, openWorkspace, saveAnswers, writeWorkspaceFile, type OpenedWorkspace } from "./workspace";

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/** next_request's wait when Claude gives none: under the 60 s request timeout of MCP SDK clients, and under Claude Code's 2-minute move to the background (MCP.md §7). */
export const DEFAULT_WAIT_S = 50;
export const MAX_WAIT_S = 110;
/** Under Claude Code's 10,000-token warning for one tool result (about 4 characters a token). */
export const MAX_OUTPUT_CHARS = 36_000;
/** The map summary walkmycode_open returns; query_map and list_files give the rest. */
const SUMMARY_CHARS = 12_000;
/** The page has been closed (or never opened) this long: next_request tells Claude to stop. */
export const PAGE_GONE_MS = 5 * 60_000;
/** Nobody has used the page this long: next_request tells Claude to stop, to save the user's usage. */
export const IDLE_MS = 20 * 60_000;

// ── the session: one workspace and one page server per process ──

export interface SessionOptions {
  bridge: Bridge;
  uiDir: string;
  openBrowser: (url: string) => Promise<boolean>;
  /** Tests fix the page's token; otherwise each launch makes its own. */
  token?: string;
  heartbeatMs?: number;
  /** Where a relative folder path starts (default: this process's folder). */
  cwd?: string;
  maxFiles?: number;
  now?: () => number;
  /** false: never take the last launch's port (tests run several servers at once). */
  samePort?: boolean;
  /** Tests stand in for the voice vendors behind the page's voice routes. */
  voiceFetch?: FetchLike;
}

export class Session {
  workspace: OpenedWorkspace | null = null;
  /** Steps in the last tour sent to the page (0: none). */
  tourSteps = 0;
  /** The map being made again after the user answered on the page (tests wait for it). */
  remapping: Promise<void> | null = null;
  private web: Promise<Web> | null = null;
  private openedAt: number | null = null;
  private stopped = false;
  private resumedAt = 0;

  /** "Run on: This computer" and the terminal: in the workspace's folders, once the user allows it on the page. */
  readonly localRun: LocalRun;

  constructor(readonly o: SessionOptions) {
    this.localRun = createLocalRun({
      configFile: () => join(lanternDir(), "config.json"),
      locate: (path) => (this.workspace ? locateIn(this.workspace.folders, this.workspace.info.repos, path) : null),
      terminalCwd: () => this.workspace?.folders[0] ?? null,
      roots: () => this.workspace?.folders ?? [],
      // "New project": the folder just made becomes the workspace, mapped as walkmycode_open would; the page follows.
      openCreated: async (root, name) => {
        const ws = await openWorkspace([root], { name, cwd: this.o.cwd, maxFiles: this.o.maxFiles });
        this.opened(ws);
        return { ok: true };
      },
    });
  }

  get bridge(): Bridge {
    return this.o.bridge;
  }

  now(): number {
    return (this.o.now ?? Date.now)();
  }

  /** The page's server, started the first time it is needed (at the last launch's port when it is free). */
  page(): Promise<Web> {
    if (!this.web) {
      const started = (async () => {
        const web = await startWeb({
          bridge: this.o.bridge,
          uiDir: this.o.uiDir,
          token: this.o.token,
          heartbeatMs: this.o.heartbeatMs,
          preferPort: this.o.samePort === false ? undefined : await lastPort(),
          api: apiRoutes({ saveAnswers: (id, answers) => this.saveAnswers(id, answers), saveFile: (id, path, text) => this.saveFile(id, path, text), pickFolder: () => pickFolder(), openFolder: (path) => this.openFolder(path), fetch: this.o.voiceFetch, localRun: this.localRun }),
          localRun: this.localRun,
          workspace: () => (this.workspace ? { info: this.workspace.info, map: this.workspace.map, files: this.workspace.files } : null),
        });
        if (this.o.samePort !== false) await keepPort(web.port);
        return web;
      })();
      this.web = started;
      started.catch(() => {
        if (this.web === started) this.web = null;
      });
    }
    return this.web;
  }

  /**
   * The user answered "Where does this point?" on the page: keep the answers with the workspace, then map
   * its folders again with them in the background, so Claude's tools see the arrows the page now draws.
   * False when the page names a workspace that is no longer the open one.
   */
  /** A folder the person picked on the page (its start screen): mapped and shown, as walkmycode_open does. */
  async openFolder(path: string): Promise<{ status: number; why: string } | null> {
    try {
      const ws = await openWorkspace([path], { cwd: this.o.cwd, maxFiles: this.o.maxFiles });
      this.opened(ws);
      // As walkmycode_open does: the open page is told, and shows this map.
      if (this.o.bridge.hasPage()) await this.o.bridge.send({ name: "workspace", workspace: ws.info }).catch(() => undefined);
      return null;
    } catch (e) {
      if (e instanceof FolderError) return { status: 400, why: e.message };
      throw e;
    }
  }

  /** The code view's Save: the edited file written back into the open workspace's folder (workspace.ts). */
  async saveFile(workspaceId: string, path: string, text: string): Promise<{ status: number; why: string } | null> {
    const ws = this.workspace;
    if (!ws || ws.info.id !== workspaceId) return { status: 409, why: "That project is no longer the one open: reload the page." };
    return writeWorkspaceFile(ws, path, text);
  }

  async saveAnswers(workspaceId: string, answers: Assertion[]): Promise<boolean> {
    const ws = this.workspace;
    if (!ws || ws.info.id !== workspaceId) return false;
    await saveAnswers(ws.savedIn, answers);
    const name = ws.folders.length > 1 ? ws.info.name : undefined;
    this.remapping = openWorkspace(ws.folders, { name, cwd: this.o.cwd, maxFiles: this.o.maxFiles })
      .then((next) => {
        // Only if nothing else was opened meanwhile; the page already draws this map, so it is not told.
        if (this.workspace === ws) {
          this.workspace = next;
          this.o.bridge.setWorkspace(next.info);
        }
      })
      .catch((e: unknown) => log("could not map the workspace again with the new answers:", e));
    return true;
  }

  /** The page's URL once its server runs, else null. */
  async url(): Promise<string | null> {
    try {
      return this.web ? (await this.web).url : null;
    } catch {
      return null;
    }
  }

  opened(ws: OpenedWorkspace): void {
    this.workspace = ws;
    this.openedAt = this.now();
    this.tourSteps = 0;
    this.o.bridge.setWorkspace(ws.info);
  }

  /** Why next_request should tell Claude to stop listening now, or null to keep listening. */
  stopReason(url: string): string | null {
    const now = this.now();
    if (this.stopped) {
      // Claude asked again after a stop: the user said "continue".
      this.stopped = false;
      this.resumedAt = now;
    }
    const p = this.o.bridge.presence();
    let why: string | null = null;
    if (!p.connected && now - Math.max(p.seenAt ?? 0, this.openedAt ?? 0) > PAGE_GONE_MS) {
      why = `The WalkMyCode page has been closed for over ${PAGE_GONE_MS / 60_000} minutes, so stop listening now. Tell the user: open ${url} and say "continue" here when they want you back.`;
    } else if (p.connected && now - Math.max(p.activeAt ?? 0, this.resumedAt, this.openedAt ?? 0) > IDLE_MS) {
      why = `Nobody has used the WalkMyCode page for ${IDLE_MS / 60_000} minutes, so stop listening now to save the user's usage. Tell them to say "continue" here when they're back.`;
    }
    if (why) this.stopped = true;
    return why;
  }

  async close(): Promise<void> {
    this.o.bridge.close();
    this.localRun.closeAll("The WalkMyCode MCP server stopped.");
    killAll();
    const web = this.web;
    this.web = null;
    if (web) await (await web).close().catch(() => {});
  }
}

// ── results ──

/** A tool result: guarded, cut to size, marked as an error when it is one. */
export function reply(text: string, isError = false): CallToolResult {
  let out = guardText(text);
  if (out.length > MAX_OUTPUT_CHARS) out = `${out.slice(0, MAX_OUTPUT_CHARS)}\n…(cut here to keep the reply small: ask for fewer lines, or search more narrowly)`;
  return isError ? { content: [{ type: "text", text: out }], isError: true } : { content: [{ type: "text", text: out }] };
}

const NOT_OPEN = "WalkMyCode isn't open yet: call walkmycode_open with the project's folder first.";

/** A failure in words Claude can act on. */
async function failed(session: Session, e: unknown): Promise<CallToolResult> {
  if (e instanceof FolderError) return reply(e.message, true);
  if (e instanceof NoPageError) {
    const url = await session.url();
    return reply(url ? `The WalkMyCode page isn't open: open ${url} (or ask the user to). Nothing was shown.` : NOT_OPEN, true);
  }
  if (e instanceof NoAckError) {
    const url = await session.url();
    return reply(`${e.message} The page may be busy or closed: try again, or ask the user to reload ${url ?? "the WalkMyCode page"}.`, true);
  }
  if (e instanceof PageRefusedError) return reply(`The page couldn't do that: ${e.message}`, true);
  log("tool failed:", e);
  return reply(`WalkMyCode hit an error: ${e instanceof Error ? e.message : String(e)}`, true);
}

// ── reading the workspace ──

const cleanPath = (p: string) => p.trim().replace(/^`|`$/g, "").replace(/^\.?\/+/, "");

type Range = { ok: true; path: string; from: number; to: number; lines: number } | { ok: false; error: string };

/** A file and lines Claude names, checked against the workspace: the lines are clamped to the file's end. */
export function checkRange(ws: OpenedWorkspace, rawPath: string, from = 1, to = from): Range {
  const path = cleanPath(rawPath);
  if (ws.map.files.some((f) => f.path === path && f.skipped === "secret")) return { ok: false, error: `${path} is a secret file: WalkMyCode never shows or reads it.` };
  const content = ws.files[path];
  if (content === undefined) {
    const near = Object.keys(ws.files)
      .filter((p) => p.endsWith(path) || p.includes(path))
      .slice(0, 5);
    return { ok: false, error: `No file ${path} in the workspace${near.length ? `. Did you mean: ${near.join(", ")}` : ". Find it with list_files or search"}.` };
  }
  const lines = content.split("\n").length;
  const [a, b] = from <= to ? [from, to] : [to, from];
  if (a > lines) return { ok: false, error: `${path} has ${lines} lines, so there is no line ${a}.` };
  return { ok: true, path, from: Math.max(1, a), to: Math.min(b, lines), lines };
}

/** A card named by id, file path or name. Several matches: the error lists them. */
export function findNode(map: CodeMap, ref: string): { node: MapNode } | { error: string } {
  const q = ref.trim();
  const byId = map.nodes.find((n) => n.id === q);
  if (byId) return { node: byId };
  const path = cleanPath(q);
  const byFile = map.nodes.find((n) => n.id === `file:${path}`) ?? map.nodes.find((n) => n.file === path);
  if (byFile) return { node: byFile };
  const ql = q.toLowerCase();
  const named = map.nodes.filter((n) => n.name.toLowerCase() === ql);
  const like = named.length ? named : map.nodes.filter((n) => n.name.toLowerCase().includes(ql) || n.file?.toLowerCase().includes(ql));
  if (like.length === 1) return { node: like[0] };
  if (like.length > 1) return { error: `"${q}" matches ${like.length} cards: ${like
    .slice(0, 6)
    .map((n) => `${n.name} [${n.id}]`)
    .join(", ")}${like.length > 6 ? ", …" : ""}. Give one id.` };
  return { error: `No card matches "${q}". Find the ids with query_map.` };
}

/** The shortest chain of links from one card to another: along the flow, then against it, then either way; plain imports only when nothing else joins them. */
export function shortestPath(map: CodeMap, from: string, to: string): MapEdge[] | null {
  if (from === to) return [];
  for (const withImports of [false, true]) {
    for (const way of ["forward", "backward", "any"] as const) {
      const prev = new Map<string, MapEdge | null>([[from, null]]);
      const queue = [from];
      while (queue.length && !prev.has(to)) {
        const id = queue.shift()!;
        const { in: ins, out } = edgesOf(map, id);
        const steps: [MapEdge, string][] = [];
        if (way !== "backward") for (const e of out) steps.push([e, e.to]);
        if (way !== "forward") for (const e of ins) steps.push([e, e.from]);
        for (const [e, next] of steps) {
          if ((!withImports && e.kind === "imports") || prev.has(next)) continue;
          prev.set(next, e);
          queue.push(next);
        }
      }
      if (!prev.has(to)) continue;
      const path: MapEdge[] = [];
      for (let cur = to; cur !== from; ) {
        const e = prev.get(cur)!;
        path.unshift(e);
        cur = e.to === cur ? e.from : e.to;
      }
      return path;
    }
  }
  return null;
}

/** A glob as a regular expression over repo-relative paths: `**` crosses folders, `*` and `?` do not, `{a,b}` is either. */
export function globToRegExp(glob: string): RegExp {
  const body = (g: string): string => {
    let re = "";
    for (let i = 0; i < g.length; i++) {
      const c = g[i];
      if (c === "*" && g[i + 1] === "*") {
        const slash = g[i + 2] === "/";
        re += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else if (c === "*") re += "[^/]*";
      else if (c === "?") re += "[^/]";
      else if (c === "{" && g.indexOf("}", i) > i) {
        const end = g.indexOf("}", i);
        re += `(?:${g
          .slice(i + 1, end)
          .split(",")
          .map(body)
          .join("|")})`;
        i = end;
      } else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    return re;
  };
  return new RegExp(`^${body(cleanPath(glob))}$`, "i");
}

/** Files matching a glob; without a slash the glob is matched against file names anywhere. */
function listGlob(ws: OpenedWorkspace, glob: string): string {
  const re = globToRegExp(glob);
  const byName = !cleanPath(glob).includes("/");
  const inMap = new Map(ws.map.files.map((f) => [f.path, f]));
  const all = [...new Set([...ws.map.files.map((f) => f.path), ...Object.keys(ws.files)])].sort();
  const hits = all.filter((p) => re.test(byName ? p.slice(p.lastIndexOf("/") + 1) : p));
  if (!hits.length) return `No file matches ${glob}. Try list_files() for the top level.`;
  const rows = hits.slice(0, 200).map((p) => {
    const f = inMap.get(p);
    return `${p}${!f ? "  (not in the map)" : f.skipped ? `  (skipped: ${f.skipped})` : f.configKind ? `  (config: ${f.configKind})` : ""}`;
  });
  return `${hits.length} file${hits.length === 1 ? "" : "s"} match ${glob}:\n${rows.join("\n")}${hits.length > 200 ? `\n…${hits.length - 200} more: narrow the glob` : ""}`;
}

function statsLine(map: CodeMap): string {
  const s = map.stats;
  const apps = map.services.filter((x) => x.kind === "app").length;
  // Code in languages the map doesn't draw yet: Claude is told it is there, and how to read it.
  const other = Object.entries(s.otherCode ?? {}).sort((x, y) => y[1] - x[1]);
  const otherLine = other.length
    ? `; also ${other.map(([lang, n]) => `${n} ${lang} file${n === 1 ? "" : "s"}`).join(", ")}, which the map doesn't draw yet (list_files, read_file and search open them: explain from the code itself)`
    : "";
  return `${s.files} files, ${s.parsed} in the map, ${s.routes} routes, ${s.tables} tables, ${s.edges} links${s.likely ? ` (${s.likely} guesses)` : ""}${isSystem(map) ? `, ${apps} services` : ""}${otherLine}`;
}

/** What next_request hands Claude: the request as JSON, then how to handle it. */
export function describeRequest(r: BridgeRequest): string {
  const how: Record<RequestKind, string> = {
    explain: "The user pressed Explain. Read it first (read_file, query_map), light it with highlight_lines or focus_node, narrate as you go,",
    trace: "The user pressed Trace it. query_map the card, then trace_path to where the flow ends (a table or an outside service), narrating each hop,",
    tour: "The user asked for a tour. Follow the real flow with query_map and read_file, then start_tour with 4–9 steps,",
    question: "The user typed a question. Read what you need, show it on the page and narrate as you go,",
    spoken: "The user asked out loud and is listening: narrate first and often, in short spoken sentences, and show what you mean on the page,",
    deep: "The voice agent handed over a hard question and the user is waiting on the line: read quickly, keep the answer under 120 words (it is spoken back),",
  };
  // Attached images come as image content after this text (requestContent), never as base64 inside the JSON.
  const images = r.kind === "question" ? (r.payload.images?.length ?? 0) : 0;
  const payload = images && r.kind === "question" ? { text: r.payload.text, images: `${images} attached, shown below` } : r.payload;
  const request = { id: r.id, kind: r.kind, payload, ...(r.context ? { context: r.context } : {}) };
  // The user kept talking before the answer came: this is the whole question, and the earlier part is not a separate one.
  const more =
    r.kind === "spoken" && r.payload.continues
      ? " The user kept talking before you answered: this text is their whole question so far, in order, and replaces the spoken request you may still be on. Answer this one (once), using all of it; don't answer the earlier part on its own."
      : "";
  const look = images ? ` Look at the ${images === 1 ? "image" : `${images} images`} below first: the question is about ${images === 1 ? "it" : "them"} (a screenshot, an error, a diagram), so tie what you see to the real code.` : "";
  return `${JSON.stringify(request)}\n${how[r.kind]}${more}${look} then answer("${r.id}", markdown, citations). Then call next_request() again.`;
}

/** next_request's reply: the request in words, and any images the user attached as images Claude can see. */
export function requestContent(r: BridgeRequest): CallToolResult {
  const out = reply(describeRequest(r));
  if (r.kind !== "question" || !r.payload.images?.length) return out;
  return { content: [...out.content, ...r.payload.images.map((i) => ({ type: "image" as const, data: i.data, mimeType: i.mediaType }))] };
}

// ── the tools ──

const pathArg = z.string().min(1).max(1000);
const PAGE_TOOL = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const READ_TOOL = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export function registerTools(mcp: McpServer, session: Session): void {
  const bridge = session.bridge;
  const needWorkspace = (): OpenedWorkspace => {
    if (!session.workspace) throw new FolderError(NOT_OPEN);
    return session.workspace;
  };

  // ── the loop ──

  mcp.registerTool(
    "walkmycode_open",
    {
      title: "Open WalkMyCode on a codebase",
      description:
        "Map a local codebase and open WalkMyCode's page in the user's browser: a live map of the code (pages → API routes → logic → database → outside services) that you drive while you explain. Give the project's absolute folder in path (~ works), or several folders in paths to map them as one workspace. Returns the page's URL, a map summary and what to do next. With no folder, opens your app's root folder (in a coding app, usually the open project).",
      inputSchema: {
        path: pathArg.optional().describe("The project's folder, absolute (~ works)"),
        paths: z.array(pathArg).min(1).max(12).optional().describe("Several folders, mapped as one workspace (each folder's paths start with its name)"),
        name: z.string().min(1).max(80).optional().describe("A name for a workspace of several folders"),
      },
      annotations: { title: "Open WalkMyCode", ...PAGE_TOOL },
    },
    async ({ path, paths, name }, extra) => {
      try {
        let folders = paths?.length ? paths : path ? [path] : [];
        if (!folders.length) folders = await clientRoot(mcp, extra);
        if (!folders.length) return reply('Which folder? Call walkmycode_open({ path: "/full/path/to/project" }), or give paths: [...] to map several folders as one workspace.', true);
        const ws = await openWorkspace(folders, { name, cwd: session.o.cwd, maxFiles: session.o.maxFiles, onProgress: progress(extra) });
        session.opened(ws);
        const web = await session.page();
        let how: string;
        if (bridge.hasPage()) {
          how = await bridge.send({ name: "workspace", workspace: ws.info }).then(
            () => "The page that was already open now shows this map.",
            () => `Ask the user to reload the WalkMyCode page, or open ${web.url}.`,
          );
        } else {
          how = (await session.o.openBrowser(web.url)) ? "I opened it in the user's browser." : "No browser opened by itself.";
          // The link is in this reply only, and the user rarely reads tool results: Claude says it in its own
          // words. The log gets the address without its one-time key (?t=…), which keeps other programs out.
          how += ` In your reply to the user, give them this link in one short line, so they can find the page if no tab came up: ${web.url}`;
          log(`page for "${ws.info.name}" at ${new URL(web.url).origin}/ (the link with its key is in the walkmycode_open result)`);
        }
        const folderWords = ws.folders.length > 1 ? ` (${ws.folders.length} folders: ${ws.info.repos.map((r) => `${r}/`).join(", ")}; every path starts with its folder's name)` : "";
        let summary = mapSummary(ws.map);
        if (summary.length > SUMMARY_CHARS) summary = `${summary.slice(0, SUMMARY_CHARS)}\n…(the summary is cut here: use query_map and list_files for the rest)`;
        return reply(
          [
            `WalkMyCode is open on "${ws.info.name}"${folderWords}: ${statsLine(ws.map)}.`,
            `Page: ${web.url}`,
            how,
            "Now call next_request() and keep the loop going: the user's clicks and questions on the page reach you through it.",
            "",
            "# The map (built by WalkMyCode's parser, not by an AI)",
            summary,
          ].join("\n"),
        );
      } catch (e) {
        return failed(session, e);
      }
    },
  );

  mcp.registerTool(
    "next_request",
    {
      title: "Wait for the user on WalkMyCode's page",
      description: `Wait for the next thing the user does on WalkMyCode's page: Explain, Trace it, Tour, a typed question, or one said out loud. Returns {id, kind, payload, context} (context: the file, lines, card or tour step on screen), or {"kind":"none"} after wait_s: then call it again. This is how the page's buttons and speech reach you.`,
      inputSchema: {
        wait_s: z.number().int().min(1).max(MAX_WAIT_S).optional().describe(`Seconds to wait (default ${DEFAULT_WAIT_S}). Keep the default.`),
      },
      annotations: { title: "Next request", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ wait_s }, extra) => {
      try {
        const url = await session.url();
        if (!session.workspace || !url) return reply(NOT_OPEN, true);
        const stop = session.stopReason(url);
        if (stop) return reply(`${JSON.stringify({ kind: "none", stop: true })}\n${stop}`);
        const r = await bridge.next((wait_s ?? DEFAULT_WAIT_S) * 1000, extra.signal);
        if (!r) {
          const page = bridge.hasPage() ? "" : ` The page isn't connected: if the user hasn't opened it, give them ${url}.`;
          return reply(`${JSON.stringify({ kind: "none" })}\nNothing yet. Call next_request() again now, without a word to the user.${page}`);
        }
        // Cancelled as the request was handed over: Claude never sees this reply, so it goes back in the queue.
        if (extra.signal.aborted) {
          bridge.requeue(r);
          return reply("Cancelled.", true);
        }
        extra.signal.addEventListener("abort", () => bridge.requeue(r), { once: true });
        return requestContent(r);
      } catch (e) {
        return failed(session, e);
      }
    },
  );

  mcp.registerTool(
    "answer",
    {
      title: "Show an answer on the page",
      description:
        "Show your answer in the page's Guide panel. id: the request's id from next_request (leave it out for a question asked in this chat). markdown: short, plain English for a beginner; a fenced ```mermaid block (sequenceDiagram, flowchart, classDiagram, erDiagram, stateDiagram-v2) is drawn as a diagram, so use one when asked for a diagram or UML: a title first (--- / title: what it shows / ---), short labels, no styling (the page colours each box by what it is on the map), a code box's file on a second line (LoginForm<br/>components/LoginForm.tsx), subgraph for what lives together. citations: every place you rely on, as 'path:line' or 'path:line-line'; they light up on the page.",
      inputSchema: {
        id: z.string().min(1).max(100).optional().describe("The request's id from next_request"),
        markdown: z.string().min(1).max(40_000),
        citations: z.array(z.string().min(1).max(1000)).max(60).optional().describe("'path:line' or 'path:line-line'"),
      },
      annotations: { title: "Answer", ...PAGE_TOOL },
    },
    async ({ id, markdown, citations }) => {
      try {
        const ws = needWorkspace();
        const lit: Citation[] = [];
        const bad: string[] = [];
        for (const raw of citations ?? []) {
          const c = parseCitation(raw);
          const r = c ? checkRange(ws, c.path, c.from, c.to) : null;
          if (r?.ok) lit.push({ path: r.path, from: r.from, to: r.to });
          else bad.push(`${raw} (${r ? r.error : "not path:line or path:line-line"})`);
        }
        if (id) bridge.markAnswered(id);
        await bridge.send({ name: "answer", ...(id ? { requestId: id } : {}), markdown, citations: lit });
        const shown = `Shown on the page${id ? ` as the answer to ${id}` : ""}${lit.length ? `, with ${lit.map(formatCitation).join(", ")} lit` : ""}.`;
        const dropped = bad.length ? ` Not lit, so check them with read_file next time: ${bad.join("; ")}.` : "";
        return reply(`${shown}${dropped} Now call next_request().`);
      } catch (e) {
        return failed(session, e);
      }
    },
  );

  mcp.registerTool(
    "narrate",
    {
      title: "Say something out loud on the page",
      description:
        "Say a short chunk out loud on the page now: one or two sentences of spoken words (no markdown, code or long paths). Call it as you go, before the whole answer is ready; the page plays chunks in order. id: the request you are answering.",
      inputSchema: {
        text: z.string().min(1).max(1500),
        id: z.string().min(1).max(100).optional(),
      },
      annotations: { title: "Narrate", ...PAGE_TOOL, idempotentHint: false },
    },
    async ({ text, id }) => {
      try {
        needWorkspace();
        await bridge.send({ name: "narrate", text, ...(id ? { requestId: id } : {}) });
        return reply("Queued to be spoken.");
      } catch (e) {
        return failed(session, e);
      }
    },
  );

  // ── driving the page ──

  mcp.registerTool(
    "focus_node",
    {
      title: "Focus a card on the map",
      description: "Select a card on the map and bring it into view. Give the card's id (from query_map), or a file path.",
      inputSchema: {
        id: z.string().min(1).max(1000).optional().describe("A card's id, e.g. route:app/api/login/route.ts#POST /api/login"),
        path: pathArg.optional().describe("A file path; its card is focused"),
      },
      annotations: { title: "Focus a card", ...PAGE_TOOL },
    },
    async ({ id, path }) => {
      try {
        const ws = needWorkspace();
        if (!id && !path) return reply("Give the card's id, or a file path.", true);
        const found = findNode(ws.map, (id ?? path)!);
        if ("error" in found) {
          const file = path ? checkRange(ws, path) : null;
          return reply(file?.ok ? `${file.path} has no card on the map; open_file shows it in the code view.` : found.error, true);
        }
        const n = found.node;
        await bridge.send({ name: "focus_node", nodeId: n.id, ...(n.file ? { path: n.file } : {}) });
        return reply(`Showing ${n.name} [${n.id}] on the map${n.file ? ` (${n.file}${n.line ? `:${n.line}` : ""})` : ""}.`);
      } catch (e) {
        return failed(session, e);
      }
    },
  );

  mcp.registerTool(
    "open_file",
    {
      title: "Open a file in the code view",
      description: "Open a file of the workspace in the page's code view, scrolled to a line.",
      inputSchema: { path: pathArg, line: z.number().int().min(1).optional() },
      annotations: { title: "Open a file", ...PAGE_TOOL },
    },
    async ({ path, line }) => {
      try {
        const r = checkRange(needWorkspace(), path, line ?? 1);
        if (!r.ok) return reply(r.error, true);
        await bridge.send({ name: "open_file", path: r.path, ...(line ? { line: r.from } : {}) });
        return reply(`Opened ${r.path}${line ? ` at line ${r.from}` : ""} (${r.lines} lines).`);
      } catch (e) {
        return failed(session, e);
      }
    },
  );

  mcp.registerTool(
    "highlight_lines",
    {
      title: "Light up lines of a file",
      description: "Light up lines of a file in the page's code view (it opens the file).",
      inputSchema: { path: pathArg, from: z.number().int().min(1), to: z.number().int().min(1) },
      annotations: { title: "Highlight lines", ...PAGE_TOOL },
    },
    async ({ path, from, to }) => {
      try {
        const r = checkRange(needWorkspace(), path, from, to);
        if (!r.ok) return reply(r.error, true);
        await bridge.send({ name: "highlight_lines", path: r.path, from: r.from, to: r.to });
        return reply(`Lit ${formatCitation(r)}.`);
      } catch (e) {
        return failed(session, e);
      }
    },
  );

  mcp.registerTool(
    "trace_path",
    {
      title: "Trace a path on the map",
      description: "Light up the path between two cards on the map, hop by hop, and get each hop's evidence (file:line). from and to: card ids, file paths or names.",
      inputSchema: { from: z.string().min(1).max(1000), to: z.string().min(1).max(1000) },
      annotations: { title: "Trace a path", ...PAGE_TOOL },
    },
    async ({ from, to }) => {
      try {
        const ws = needWorkspace();
        const a = findNode(ws.map, from);
        if ("error" in a) return reply(`from: ${a.error}`, true);
        const b = findNode(ws.map, to);
        if ("error" in b) return reply(`to: ${b.error}`, true);
        const path = shortestPath(ws.map, a.node.id, b.node.id);
        if (!path) return reply(`No chain of links joins ${a.node.name} [${a.node.id}] and ${b.node.name} [${b.node.id}] in the map. query_map each to see what they are linked to.`, true);
        const nodeIds = [a.node.id];
        for (const e of path) nodeIds.push(e.to === nodeIds.at(-1) ? e.from : e.to);
        await bridge.send({ name: "trace_path", from: a.node.id, to: b.node.id, nodeIds, edgeIds: path.map((e) => e.id) });
        const name = (id: string) => ws.map.nodes.find((n) => n.id === id)?.name ?? id;
        const hops = path.map((e, i) => `${i + 1}. ${name(e.from)} ${describeEdge(ws.map, e, true)}`);
        return reply(`Lit the path from ${a.node.name} [${a.node.id}] to ${b.node.name} [${b.node.id}], ${path.length} hop${path.length === 1 ? "" : "s"}:\n${hops.join("\n")}`);
      } catch (e) {
        return failed(session, e);
      }
    },
  );

  mcp.registerTool(
    "start_tour",
    {
      title: "Start a guided tour",
      description:
        "Hand the page a guided tour: it plays each step aloud while that step's lines and cards light up. 4–9 steps in the order of the flow (what the user does → request → logic → data), each 1–3 spoken sentences. Read the code first.",
      inputSchema: {
        title: z.string().min(1).max(200).optional(),
        steps: z
          .array(
            z.object({
              say: z.string().min(1).max(1500).describe("What to say, spoken words"),
              file: pathArg.describe("The file to show"),
              lines: z.string().min(1).max(40).describe("Lines to light: '12-30', or '42'"),
              nodeIds: z.array(z.string().min(1).max(1000)).max(20).optional().describe("Cards to light (ids from query_map)"),
            }),
          )
          .min(1)
          .max(30),
      },
      annotations: { title: "Start a tour", ...PAGE_TOOL },
    },
    async ({ title, steps }) => {
      try {
        const ws = needWorkspace();
        const ids = new Set(ws.map.nodes.map((n) => n.id));
        const out: TourStep[] = [];
        const problems: string[] = [];
        const unknown: string[] = [];
        for (const [i, s] of steps.entries()) {
          const c = parseCitation(`${s.file}:${s.lines.trim()}`);
          const r = c ? checkRange(ws, c.path, c.from, c.to) : null;
          if (!r?.ok) {
            problems.push(`step ${i + 1}: ${r ? r.error : `lines "${s.lines}" should look like 12-30`}`);
            continue;
          }
          const nodeIds: string[] = [];
          for (const id of s.nodeIds ?? []) (ids.has(id) ? nodeIds : unknown).push(id);
          out.push({ say: s.say, file: r.path, from: r.from, to: r.to, nodeIds });
        }
        if (problems.length) return reply(`The tour wasn't sent. Fix these steps and call start_tour again:\n${problems.join("\n")}`, true);
        await bridge.send({ name: "start_tour", title: title ?? "Tour", steps: out });
        session.tourSteps = out.length;
        const skipped = unknown.length ? ` These card ids aren't on the map, so they won't light: ${[...new Set(unknown)].join(", ")}.` : "";
        return reply(`Tour "${title ?? "Tour"}" sent: ${out.length} step${out.length === 1 ? "" : "s"}. The page plays it, lighting each step's lines and cards; tour_step(n) jumps to a step.${skipped}`);
      } catch (e) {
        return failed(session, e);
      }
    },
  );

  mcp.registerTool(
    "tour_step",
    {
      title: "Go to a tour step",
      description: "Jump the page's tour to step n (1-based).",
      inputSchema: { n: z.number().int().min(1).max(30) },
      annotations: { title: "Tour step", ...PAGE_TOOL },
    },
    async ({ n }) => {
      try {
        needWorkspace();
        if (!session.tourSteps) return reply("No tour is on the page yet: start_tour first.", true);
        if (n > session.tourSteps) return reply(`The tour has ${session.tourSteps} steps, so there is no step ${n}.`, true);
        const note = await bridge.send({ name: "tour_step", n });
        return reply(`Showing step ${n} of ${session.tourSteps}.${note ? ` (${note})` : ""}`);
      } catch (e) {
        return failed(session, e);
      }
    },
  );

  mcp.registerTool(
    "walkmycode_new_project",
    {
      title: "Start a new project",
      description:
        "When the user asks for a new project from scratch (\"spin up a Laravel todo app\"), open WalkMyCode's New project form on the page with the starter and a folder name filled in. WalkMyCode then installs the tools it needs (PHP, Composer, Node, Python), makes the project the framework's own way, sets it up and opens it on the map, with the user watching each step; the user presses Make it. Don't run these installs yourself. starter: laravel, next, vite-react, fastapi or express. name: a folder name (letters, numbers, dots, dashes, underscores). brief (optional): what it should do, in a sentence; once it's open the guide offers a Build it button that sends it to you as a request. Without a brief, write the feature they asked for (a todo list, say) in the new folder afterwards.",
      inputSchema: {
        starter: z.enum(["laravel", "next", "vite-react", "fastapi", "express"]),
        name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/),
        brief: z.string().max(600).optional(),
      },
      annotations: { title: "New project", ...PAGE_TOOL },
    },
    async ({ starter, name, brief }) => {
      try {
        const what = brief?.trim();
        const note = await bridge.send({ name: "new_project", starter, projectName: name, ...(what ? { brief: what } : {}) });
        // With a brief the user's Build it click is the go-ahead: building now as well would do it twice.
        const then = what ? " The guide then offers Build it: build it when that request reaches you through next_request." : "";
        return reply(`${note ?? "The New project form is open on the page."} When the page shows it's set up and open, the new folder is the workspace: call query_map and read_file as usual.${then}`);
      } catch (e) {
        return failed(session, e);
      }
    },
  );

  mcp.registerTool(
    "show_view",
    {
      title: "Switch the map's view",
      description: "Switch the map's view: 'system' (the services and the links between them), 'all' (every card), or 'service' (one service's lanes: name it in service).",
      inputSchema: { view: z.enum(["system", "all", "service"]), service: z.string().min(1).max(200).optional() },
      annotations: { title: "Show a view", ...PAGE_TOOL },
    },
    async ({ view, service }) => {
      try {
        const ws = needWorkspace();
        if (view === "service") {
          const apps = ws.map.services.filter((s) => s.kind === "app");
          const svc = service ? findService(ws.map, service) : undefined;
          if (!svc) return reply(`${service ? `No service matches "${service}".` : "Name the service."} The services: ${apps.map((s) => `${s.name} [${s.id}]`).join(", ") || "none (this workspace is one app)"}.`, true);
          await bridge.send({ name: "show_view", view, service: svc.id });
          return reply(`Showing the ${svc.name} service's lanes.`);
        }
        await bridge.send({ name: "show_view", view });
        const note = view === "system" && !isSystem(ws.map) ? " This workspace is one app, so the system view shows a single service." : "";
        return reply(`Showing the ${view === "all" ? "whole map" : "system view"}.${note}`);
      } catch (e) {
        return failed(session, e);
      }
    },
  );

  // ── reading, so answers stay grounded ──

  mcp.registerTool(
    "query_map",
    {
      title: "Look up the code map",
      description:
        "Look up the code map: what a card (route, file, table, outside service) is connected to, with file:line evidence for every link. Give a node id, a file path, or a name ('signin', 'users table', 'Stripe'); in a system of services, a service name, or 'system' for every link between services.",
      inputSchema: { query: z.string().min(1).max(500).describe("A node id, a file path, or a name") },
      annotations: { title: "Query the map", ...READ_TOOL },
    },
    async ({ query }) => {
      try {
        return reply(runTool(needWorkspace(), "query_map", { query: query.trim() }));
      } catch (e) {
        return failed(session, e);
      }
    },
  );

  mcp.registerTool(
    "read_file",
    {
      title: "Read a file",
      description: "Read a file of the workspace with line numbers: up to 250 lines per call (from and to are 1-based). Call again with a later from for more.",
      inputSchema: { path: pathArg, from: z.number().int().min(1).optional(), to: z.number().int().min(1).optional() },
      annotations: { title: "Read a file", ...READ_TOOL },
    },
    async ({ path, from, to }) => {
      try {
        const ws = needWorkspace();
        const clean = cleanPath(path);
        if (ws.map.files.some((f) => f.path === clean && f.skipped === "secret")) return reply(`${clean} is a secret file: WalkMyCode never shows or reads it.`, true);
        return reply(runTool(ws, "read_file", { path: clean, start_line: from, end_line: to }));
      } catch (e) {
        return failed(session, e);
      }
    },
  );

  mcp.registerTool(
    "search",
    {
      title: "Search the code",
      description: "Find lines containing some text across the workspace (case-insensitive). Returns up to 30 hits as path:line: text. Use it to find where something is defined or used.",
      inputSchema: { text: z.string().min(1).max(500), path_prefix: z.string().min(1).max(1000).optional().describe("Only under this folder, e.g. web/src") },
      annotations: { title: "Search", ...READ_TOOL },
    },
    async ({ text, path_prefix }) => {
      try {
        return reply(runTool(needWorkspace(), "search", { query: text, ...(path_prefix ? { path_prefix: cleanPath(path_prefix) } : {}) }));
      } catch (e) {
        return failed(session, e);
      }
    },
  );

  mcp.registerTool(
    "list_files",
    {
      title: "List files",
      description:
        "List the workspace's folders and files: no glob for the top level, a folder path for one folder, or a glob ('src/**/*.ts', '*.py': without a slash it matches file names anywhere). Says which files are in the map, skipped (tests, generated, secrets) or config.",
      inputSchema: { glob: z.string().min(1).max(500).optional().describe("A folder, or a glob") },
      annotations: { title: "List files", ...READ_TOOL },
    },
    async ({ glob }) => {
      try {
        const ws = needWorkspace();
        if (glob && /[*?{]/.test(glob)) return reply(listGlob(ws, glob));
        return reply(runTool(ws, "list_files", glob ? { path: cleanPath(glob) } : {}));
      } catch (e) {
        return failed(session, e);
      }
    },
  );
}

/** The client's first root folder (Claude Code: the project it was started in), when the client shares its roots. */
async function clientRoot(mcp: McpServer, extra: Extra): Promise<string[]> {
  if (!mcp.server.getClientCapabilities()?.roots) return [];
  try {
    const { roots } = await mcp.server.listRoots(undefined, { signal: extra.signal, timeout: 5_000 });
    const first = roots.find((r) => r.uri.startsWith("file://"));
    return first ? [fileURLToPath(first.uri)] : [];
  } catch {
    return [];
  }
}

/** Progress notifications while a big folder is mapped, when the client asked for them (at most twice a second). */
function progress(extra: Extra): ((done: number, total: number) => void) | undefined {
  const token = extra._meta?.progressToken;
  if (token === undefined) return undefined;
  let last = 0;
  return (done, total) => {
    const now = Date.now();
    if (now - last < 500) return;
    last = now;
    extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: done, total, message: `Mapping: ${done} of ${total} files parsed` } }).catch(() => {});
  };
}
