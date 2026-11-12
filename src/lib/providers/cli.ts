// "My subscription": the guide answered by an AI app on this computer, on the user's own plan,
// instead of an API key (issue #12; the design follows iReliabee's): Claude Code on a Claude plan,
// Codex on a ChatGPT plan, the Gemini CLI on a Google account. What differs between them is in
// agents.ts; everything else is here and the same for all three.
//
// One question is one run of the app. WalkMyCode's tools reach it through a small MCP server
// (scripts/cli-tools-mcp.mjs) that forwards each call here (POST /api/cli-tool); the call goes to
// the page as an ordinary tool call at the end of a round, exactly as an API model's would, the page
// runs it on the project it holds, and the next round hands the result back to the waiting run. So
// the page, the map lighting up and tours all work unchanged.
//
// The run is WalkMyCode's guide and nothing else: WalkMyCode's instructions, none of the user's own
// settings, rules or hooks for that app, none of its built-in tools, only WalkMyCode's, and it only
// runs when the app is signed in to a plan, so it never bills an API account by surprise.
import "server-only";
import type { ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { findOnPath } from "@/lib/localrun/toolchains";
import { killTree, spawnTracked } from "@/lib/localrun/processes";
import { SYSTEM, TOUR_ADDENDUM } from "@/lib/claude/prompts";
import { TOOLS, TOUR_TOOL } from "@/lib/claude/tools";
import { AGENTS, whyNot, type AgentId } from "./agents";
import { friendly } from "./errors";
import type { FriendlyError, HistoryEntry, StreamEvent } from "./wire";

/** A run waits this long for the page to send a tool's result before it gives up. */
const TOOL_WAIT_MS = 120_000;
/** Claude Code has this long to start (sign-in, MCP bridge, model) before the run is given up. */
const START_MS = 90_000;
/** Silence this long while Claude Code is working (not while the page runs tools) means it stalled. */
const STALL_MS = 90_000;
/** A whole answer. */
const MAX_RUN_MS = 20 * 60_000;
/** Parallel tool calls arriving within this window go to the page as one round. */
const GATHER_MS = 100;

interface ToolCall {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  resolve: (r: ToolResult) => void;
}

/** What the page sent back for one call; isError when the tool failed. */
export interface ToolResult {
  text: string;
  isError?: boolean;
}

type JobEvent = { kind: "text"; text: string } | { kind: "tools"; calls: ToolCall[] } | { kind: "done"; text: string; error?: FriendlyError };

interface Job {
  id: string;
  agent: AgentId;
  key: string;
  child: ChildProcess;
  dir: string;
  events: JobEvent[];
  wake: (() => void) | null;
  /** Tool calls not yet sent to the page, gathered for a moment so parallel calls go as one round. */
  gathering: ToolCall[];
  gatherTimer: NodeJS.Timeout | null;
  /** Sent to the page and waiting for its results, by tool call id. */
  waiting: Map<string, ToolCall>;
  finished: boolean;
  timer: NodeJS.Timeout;
  /** Set while the page has the run's tool calls: the run is stopped if their results never come. */
  idle: NodeJS.Timeout | null;
  /** Set while Claude Code is starting or working: the run is stopped if it goes quiet. */
  stall: NodeJS.Timeout | null;
}

const jobs = new Map<string, Job>();
const byToolCall = new Map<string, Job>();
const ENDED: ToolResult = { text: "WalkMyCode stopped this answer.", isError: true };

function push(job: Job, ev: JobEvent) {
  job.events.push(ev);
  job.wake?.();
  job.wake = null;
}

const fail = (provider: AgentId, detail: string) => friendly("unknown", { provider, detail });

/** (Re)start the stall watch: `ms` of silence from Claude Code ends the run with `why`. */
function watch(job: Job, ms: number, why: string) {
  if (job.stall) clearTimeout(job.stall);
  job.stall = job.finished ? null : setTimeout(() => end(job, "", fail(job.agent, why)), ms);
}

function end(job: Job, text: string, error?: FriendlyError) {
  if (job.finished) return;
  job.finished = true;
  for (const t of [job.timer, job.idle, job.stall, job.gatherTimer]) if (t) clearTimeout(t);
  push(job, { kind: "done", text, ...(error ? { error } : {}) });
  killTree(job.child.pid);
  // Calls still out (the bridge's requests are waiting on them) get an answer, so nothing hangs.
  for (const c of [...job.gathering.splice(0), ...job.waiting.values()]) {
    byToolCall.delete(c.toolCallId);
    c.resolve(ENDED);
  }
  job.waiting.clear();
  jobs.delete(job.id);
  try {
    rmSync(job.dir, { recursive: true, force: true });
  } catch {
    // a file still held open on Windows: the temp folder is cleaned by the system later
  }
}

/** The program on this computer: its WALKMYCODE_<NAME> override if set, PATH next, then where installers put it. */
export function findAgent(id: AgentId, env: NodeJS.ProcessEnv = process.env): string | null {
  const a = AGENTS[id];
  const pinned = env[a.override];
  if (pinned && existsSync(pinned)) return pinned;
  const o = { env: env as Record<string, string>, platform: process.platform, exists: existsSync };
  const onPath = findOnPath(a.command, o);
  if (onPath) return onPath;
  const extra =
    process.platform === "win32"
      ? [join(env.APPDATA ?? "", "npm"), join(env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Links"), join(homedir(), ".local", "bin")]
      : [join(homedir(), ".local", "bin"), join(homedir(), ".claude", "local"), "/usr/local/bin", join(homedir(), ".npm-global", "bin")];
  return findOnPath(a.command, { ...o, env: { PATH: extra.join(process.platform === "win32" ? ";" : ":"), PATHEXT: env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD" } });
}

export const findClaude = (env: NodeJS.ProcessEnv = process.env) => findAgent("claude-code", env);

/** The environment for a run: none of the keys the app would otherwise use, so it answers on the plan. */
function childEnv(id: AgentId): NodeJS.ProcessEnv {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) if (!AGENTS[id].strip(k)) out[k] = v;
  return out as NodeJS.ProcessEnv;
}

/** WalkMyCode run for anyone who opens it (WALKMYCODE_MODE=hosted) must not spend the operator's plan. */
const hosted = () => (process.env.WALKMYCODE_MODE ?? process.env.LANTERN_MODE)?.trim().toLowerCase() === "hosted";

/** Who pays, by `claude auth status` (kept for its tests; each agent reads its own in agents.ts). */
export const parseAuth = (out: string) => AGENTS["claude-code"].who(out);

const authCache = new Map<AgentId, number>();

/** What the program prints, run briefly (its whole tree is killed after 10 s). */
function output(file: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise<string>((res) => {
    let text = "";
    let child: ChildProcess;
    try {
      child = spawnTracked(file, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      return res("");
    }
    const timer = setTimeout(() => killTree(child.pid), 10_000);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (d: string) => (text += d));
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (d: string) => (text += d)); // `codex login status` answers on stderr
    child.on("error", () => res(""));
    child.on("close", () => {
      clearTimeout(timer);
      res(text);
    });
  });
}

/** Whether the app is here and signed in to a plan; a good answer is cached for a minute. Never reads credentials. */
export async function cliReadiness(id: AgentId = "claude-code"): Promise<FriendlyError | null> {
  if (hosted()) return friendly("cli_hosted", { provider: id });
  const at = authCache.get(id);
  if (at && Date.now() - at < 60_000) return null;
  const a = AGENTS[id];
  const bin = findAgent(id);
  if (!bin) return friendly("cli_missing", { provider: id });
  let said = "";
  if (a.authArgs) said = await output(bin, a.authArgs, childEnv(id));
  else {
    // The Gemini CLI has no status command: its settings say how it signs in (the choice, not the credentials).
    try {
      said = readFileSync(join(process.env.GEMINI_CLI_HOME ?? homedir(), ".gemini", "settings.json"), "utf8");
    } catch {
      said = "";
    }
  }
  const who = a.who(said);
  if (who === "signed_out") return friendly("cli_signed_out", { provider: id });
  if (who === "api") return friendly("cli_not_plan", { provider: id });
  // Only a good answer is kept: someone who just signed in shouldn't wait a minute for it to count.
  authCache.set(id, Date.now());
  return null;
}

/** The conversation so far, as plain text for the run's prompt (each question is a fresh run). */
function transcript(history: HistoryEntry[]): string {
  const lines: string[] = [];
  for (const h of history) {
    if (h.role === "user") lines.push(`User: ${typeof h.content === "string" ? h.content : h.content.map((c) => (c.type === "text" ? c.text : "[an image, which the AI app can't see here]")).join(" ")}`);
    else if (h.role === "assistant") {
      const parts = (h.message as { content?: unknown }).content;
      const text =
        typeof parts === "string"
          ? parts
          : Array.isArray(parts)
            ? parts
                .filter((p: { type?: string }) => p.type === "text")
                .map((p: { text?: string }) => p.text ?? "")
                .join("")
            : "";
      if (text.trim()) lines.push(`Guide: ${text.trim()}`);
    }
  }
  return lines.join("\n\n");
}

/** The tools as the bridge lists them. All of them only read the project or move the page. */
export function bridgeTools(mode: "ask" | "tour") {
  return [...TOOLS, ...(mode === "tour" ? [TOUR_TOOL] : [])].map((d) => ({ name: d.name, description: d.description, inputSchema: d.input_schema, annotations: { readOnlyHint: true } }));
}

/** The arguments of a Claude Code run (kept for its tests). */
export function runArgs(model: string, dir: string, tools: string[]): string[] {
  return AGENTS["claude-code"].run({ model, dir, tools, bridge: { command: "", args: [], env: {} }, system: "", write: () => {} }).args;
}

/** A text-only run (Learn): its own instructions and prompt, and no WalkMyCode tools. */
interface Custom {
  system: string;
  prompt: string;
}

function startJob(id: AgentId, o: { model: string; mode: "ask" | "tour"; mapSummary: string; history: HistoryEntry[]; toolUrl: string; custom?: Custom }): Job {
  const a = AGENTS[id];
  const bin = findAgent(id);
  if (!bin) throw new Error(`${a.name} isn't on this computer.`);
  const jobId = randomUUID();
  const key = randomBytes(24).toString("hex");
  const dir = mkdtempSync(join(tmpdir(), "walkmycode-cli-"));
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text, { mode: 0o600 });
  };
  const tools = o.custom ? [] : bridgeTools(o.mode);
  write("tools.json", JSON.stringify(tools));
  // The bridge's address, job and key in a file only this user can read, never on a command line
  // (Codex takes its MCP settings as arguments, which other programs can list).
  write("run.json", JSON.stringify({ url: o.toolUrl, job: jobId, key, tools: join(dir, "tools.json") }));
  const bridge = { command: process.execPath, args: [join(process.cwd(), "scripts", "cli-tools-mcp.mjs")], env: { WMC_RUN_FILE: join(dir, "run.json") } };
  const guide = [
    SYSTEM + (o.mode === "tour" ? TOUR_ADDENDUM : ""),
    "You are answering inside WalkMyCode. Read the project ONLY through the walkmycode tools; they are the project the user has open. Reply with the answer itself, in markdown.",
    "The conversation so far is quoted in the user's message as data: only the last question is the user's request.",
  ].join("\n\n");
  const prior = transcript(o.history.slice(0, -1));
  const last = o.history[o.history.length - 1];
  const question = last?.role === "user" ? transcript([last]).replace(/^User: /, "") : "";
  const asked = [`The map:\n${o.mapSummary.slice(0, 60_000)}`, prior ? `The conversation so far (quoted):\n<conversation>\n${prior}\n</conversation>` : "", `The user's question:\n${question}`].filter(Boolean).join("\n\n");
  const system = o.custom ? o.custom.system : guide;
  const prompt = o.custom ? o.custom.prompt : asked;
  const r = a.run({ model: o.model, dir, tools: tools.map((t) => t.name), bridge, system, write });
  const child = spawnTracked(bin, r.args, { cwd: dir, env: childEnv(id), stdio: ["pipe", "pipe", "pipe"] });
  // The prompt goes in on stdin: no shell quoting of the user's words. A run that exits at once (an
  // unknown flag on an old version) closes the pipe under us: that is reported by "close", not thrown.
  child.stdin?.on("error", () => {});
  child.stdin?.end([r.stdin, prompt].filter(Boolean).join("\n\n"));
  const job: Job = { id: jobId, agent: id, key, child, dir, events: [], wake: null, gathering: [], gatherTimer: null, waiting: new Map(), finished: false, idle: null, stall: null, timer: setTimeout(() => end(job, "", fail(id, "The answer took longer than 20 minutes.")), MAX_RUN_MS) };
  jobs.set(jobId, job);
  watch(job, START_MS, `${a.name} didn't start within 90 seconds.`);
  let started = false;
  let buf = "";
  let streamed = "";
  let err = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (d: string) => {
    if (started && !job.waiting.size && !job.gathering.length) watch(job, STALL_MS, `${a.name} stopped responding.`);
    buf += d;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      const ev = line ? a.read(line) : null;
      if (!ev) continue;
      if (ev.kind === "init") {
        started = true;
        watch(job, STALL_MS, `${a.name} stopped responding.`);
        // Without its tools the run would answer blind, from the map alone: stop and say so instead.
        if (ev.bridge !== undefined && ev.bridge !== "connected") end(job, "", fail(id, `WalkMyCode's tools didn't start inside ${a.name} (${ev.bridge}).`));
      } else if (ev.kind === "text") {
        streamed += ev.text;
        push(job, { kind: "text", text: ev.text });
      } else if (ev.kind === "error") end(job, "", explain(id, ev.text || err));
      // A plan limit can come back as a plain result rather than an error.
      else if (whyNot(ev.text ?? "") === "limit") end(job, "", explain(id, ev.text ?? ""));
      else end(job, streamed ? "" : (ev.text ?? ""));
    }
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (d: string) => {
    err = (err + d).slice(-4000);
  });
  child.on("error", (e) => end(job, "", friendly("cli_missing", { provider: id, detail: e.message })));
  // Closed without a result: whatever was streamed is incomplete, so it is reported as a failure.
  child.on("close", () => end(job, "", explain(id, err || (streamed ? `${a.name} stopped before finishing the answer.` : `${a.name} stopped without an answer.`))));
  return job;
}

/** The app's own words, as the guide's error: signed out, out of usage, turned away, or anything else. */
function explain(id: AgentId, text: string): FriendlyError {
  const why = whyNot(text);
  if (why === "unsupported") return friendly("cli_unsupported", { provider: id, detail: text });
  if (why === "signed_out") {
    authCache.delete(id); // asked again on the next question
    return friendly("cli_signed_out", { provider: id, detail: text });
  }
  if (why === "limit") return friendly("rate_limited", { provider: id, detail: text });
  return fail(id, text);
}

/** A tool call from the run (POST /api/cli-tool): it waits here until the page sends the result. */
export function toolCall(jobId: string, key: string, name: string, input: Record<string, unknown>): Promise<ToolResult> | null {
  const job = jobs.get(jobId);
  if (!job || job.key !== key || job.finished) return null;
  // While the page runs tools, Claude Code is rightly quiet: no stall watch.
  if (job.stall) clearTimeout(job.stall);
  job.stall = null;
  return new Promise<ToolResult>((resolve) => {
    job.gathering.push({ toolCallId: `cli-${randomUUID()}`, toolName: name, input, resolve });
    if (job.gatherTimer) clearTimeout(job.gatherTimer);
    job.gatherTimer = setTimeout(() => {
      const calls = job.gathering.splice(0);
      job.gatherTimer = null;
      for (const c of calls) {
        job.waiting.set(c.toolCallId, c);
        byToolCall.set(c.toolCallId, job);
      }
      push(job, { kind: "tools", calls });
    }, GATHER_MS);
  });
}

const NO_USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_tokens: 0, known: false };

/**
 * One round of POST /api/claude for the Claude Code provider: a new question starts a run; tool
 * results continue the run that asked for them. Streams text, then ends the round with the run's
 * next tool calls (the page runs them and comes back) or with the answer.
 */
export async function cliRound(o: { provider?: AgentId; model: string; mode: "ask" | "tour"; mapSummary: string; history: HistoryEntry[]; toolUrl: string; signal: AbortSignal; send: (ev: StreamEvent) => void }): Promise<void> {
  const last = o.history[o.history.length - 1];
  let job: Job | undefined;
  if (last?.role === "tool") {
    for (const r of last.content as { toolCallId: string; output?: { type?: string; value?: unknown } }[]) {
      const j = byToolCall.get(r.toolCallId);
      const call = j?.waiting.get(r.toolCallId);
      if (!j || !call) continue;
      job = j;
      j.waiting.delete(r.toolCallId);
      byToolCall.delete(r.toolCallId);
      call.resolve({ text: String(r.output?.value ?? ""), isError: r.output?.type === "error-text" });
    }
    if (!job) return o.send({ type: "error", error: fail(o.provider ?? "claude-code", "This answer had already stopped (the page took more than two minutes to send its results). Ask again.") });
    if (job.idle) clearTimeout(job.idle);
    job.idle = null;
    watch(job, STALL_MS, "Claude Code stopped responding.");
  } else {
    if (o.signal.aborted) return;
    const id = o.provider ?? "claude-code";
    const notReady = await cliReadiness(id);
    if (notReady) return o.send({ type: "error", error: notReady });
    job = startJob(id, o);
  }
  const j = job;
  const stop = () => end(j, "");
  if (o.signal.aborted) return stop();
  o.signal.addEventListener("abort", stop, { once: true });
  try {
    let text = "";
    for (;;) {
      const ev = j.events.shift();
      if (!ev) {
        await new Promise<void>((r) => (j.wake = r));
        continue;
      }
      if (ev.kind === "text") {
        text += ev.text;
        o.send({ type: "text", text: ev.text });
      } else if (ev.kind === "tools") {
        for (const c of ev.calls) o.send({ type: "tool", name: c.toolName });
        const calls = ev.calls.map((c) => ({ toolCallId: c.toolCallId, toolName: c.toolName, input: c.input }));
        o.send({
          type: "message",
          message: { role: "assistant", content: [...(text ? [{ type: "text", text }] : []), ...calls.map((c) => ({ type: "tool-call", ...c }))] },
          finish: "tool-calls",
          toolCalls: calls,
          usage: NO_USAGE,
          provider: j.agent,
          model: o.model,
        } as StreamEvent);
        // Waiting for the page's results: if they never come (a closed tab), the run is stopped.
        j.idle = setTimeout(() => end(j, "", fail(j.agent, "The page stopped answering the guide's tool calls.")), TOOL_WAIT_MS);
        return;
      } else {
        if (ev.error) return o.send({ type: "error", error: ev.error });
        if (ev.text) o.send({ type: "text", text: ev.text });
        o.send({ type: "message", message: { role: "assistant", content: [{ type: "text", text: text + ev.text }] }, finish: "stop", toolCalls: [], usage: NO_USAGE, provider: j.agent, model: o.model } as StreamEvent);
        return;
      }
    }
  } finally {
    o.signal.removeEventListener("abort", stop);
  }
}

/**
 * One text answer for Learn (POST /api/learn) from a subscription app: no tools, no map, the
 * prompt carries everything. Streams text like an API model's answer, then the whole message.
 */
export async function cliText(o: { provider: AgentId; model: string; system: string; turns: { role: "user" | "assistant"; content: string }[]; signal: AbortSignal; send: (ev: StreamEvent) => void }): Promise<void> {
  if (o.signal.aborted) return;
  const notReady = await cliReadiness(o.provider);
  if (notReady) return o.send({ type: "error", error: notReady });
  const last = o.turns[o.turns.length - 1];
  const earlier = o.turns.slice(0, -1).map((t) => `${t.role === "user" ? "Student" : "Professor"}: ${t.content}`).join("\n\n");
  const prompt = earlier ? `The conversation so far (quoted):\n<conversation>\n${earlier}\n</conversation>\n\nReply to the student's last message:\n${last.content}` : last.content;
  const job = startJob(o.provider, { model: o.model, mode: "ask", mapSummary: "", history: [], toolUrl: "http://127.0.0.1:9/none", custom: { system: o.system, prompt } });
  const stop = () => end(job, "");
  if (o.signal.aborted) return stop();
  o.signal.addEventListener("abort", stop, { once: true });
  try {
    let text = "";
    for (;;) {
      const ev = job.events.shift();
      if (!ev) {
        await new Promise<void>((r) => (job.wake = r));
        continue;
      }
      if (ev.kind === "text") {
        text += ev.text;
        o.send({ type: "text", text: ev.text });
      } else if (ev.kind === "done") {
        if (ev.error) return o.send({ type: "error", error: ev.error });
        if (ev.text) o.send({ type: "text", text: ev.text });
        return o.send({ type: "message", message: { role: "assistant", content: [{ type: "text", text: text + ev.text }] }, finish: "stop", toolCalls: [], usage: NO_USAGE, provider: o.provider, model: o.model } as StreamEvent);
      }
      // a "tools" event cannot come: a text-only run has no tools
    }
  } finally {
    o.signal.removeEventListener("abort", stop);
  }
}
