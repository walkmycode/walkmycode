// The browser loop against a fake fetch serving WalkMyCode's own SSE: the tool
// round trip, the finish mapping, the structured error, the history trim and
// what a provider switch does to the conversation. No keys, no network.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { CodeMap } from "../src/analyzer/types";
import { afterSettingsSaved, ask, AskError, emptyConversation, resetReadiness, trimHistory, type Conversation, type FetchLike } from "../src/lib/claude/client";
import type { RepoView } from "../src/lib/claude/tools";
import { resetCost } from "../src/lib/cost";
import type { AskRequest, FriendlyError, HistoryEntry, StreamEvent } from "../src/lib/providers/wire";

const map = {
  version: 1,
  name: "demo",
  generatedAt: "2026-09-30",
  areas: ["app"],
  files: [{ path: "src/a.ts" }],
  nodes: [],
  edges: [],
  warnings: [],
  stats: { files: 1, parsed: 1, routes: 0, tables: 0, edges: 0, likely: 0, ms: 1 },
} as unknown as CodeMap;
const repo: RepoView = { map, files: { "src/a.ts": "line one\nline two\nline three" } };

const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_tokens: 0, known: true };

function message(extra: Partial<Extract<StreamEvent, { type: "message" }>> = {}): StreamEvent {
  return { type: "message", message: { role: "assistant", content: [{ type: "text", text: "Hi" }] }, finish: "stop", toolCalls: [], usage, provider: "anthropic", model: "claude-opus-5-5", ...extra };
}

function sse(events: StreamEvent[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** A fake server: readiness as given, then one scripted SSE reply per /api/claude call. Records every body it saw. */
function fakeServer(replies: (StreamEvent[] | Response)[], readiness: FriendlyError | null = null) {
  const bodies: AskRequest[] = [];
  const fetch: FetchLike = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/config/readiness")) return Response.json({ llm: readiness });
    assert.ok(url.endsWith("/api/claude"), url);
    bodies.push(JSON.parse(String(init?.body)) as AskRequest);
    const next = replies.shift();
    assert.ok(next, "more calls than scripted replies");
    return next instanceof Response ? next : sse(next);
  };
  return { fetch, bodies };
}

beforeEach(() => {
  resetReadiness();
  resetCost();
});

describe("ask", () => {
  it("streams text, sends history_provider null on a fresh conversation and keeps the assistant message verbatim", async () => {
    const assistant = { role: "assistant" as const, content: [{ type: "text" as const, text: "Hi" }], providerOptions: { anthropic: { secret: "kept" } } };
    const server = fakeServer([[{ type: "text", text: "H" }, { type: "text", text: "i" }, message({ message: assistant })]]);
    const seen: string[] = [];
    const r = await ask({ repo, conversation: emptyConversation(), user: "hello?", mode: "ask", fetch: server.fetch, onText: (t) => seen.push(t) });
    assert.deepEqual(seen, ["H", "Hi"]);
    assert.equal(r.text, "Hi");
    assert.equal(r.finish, "stop");
    assert.equal(r.tour, null);
    assert.equal(server.bodies.length, 1);
    assert.equal(server.bodies[0].history_provider, null);
    assert.equal(server.bodies[0].mode, "ask");
    assert.deepEqual(server.bodies[0].history, [{ role: "user", content: "hello?" }]);
    assert.ok(server.bodies[0].mapSummary.startsWith("# Repo: demo"));
    assert.deepEqual(r.conversation, { history: [{ role: "user", content: "hello?" }, { role: "assistant", message: assistant }], provider: "anthropic" });
  });

  it("runs tool calls locally, pushes a tool entry and goes round again with history_provider set", async () => {
    const call = { toolCallId: "toolu_1", toolName: "read_file", input: { path: "src/a.ts", start_line: 2, end_line: 2 } };
    const server = fakeServer([
      [{ type: "tool", name: "read_file" }, message({ finish: "tool-calls", toolCalls: [call] })],
      [{ type: "text", text: "Line two says line two." }, message()],
    ]);
    const tools: [string, Record<string, unknown> | undefined][] = [];
    const r = await ask({ repo, conversation: emptyConversation(), user: "what is on line 2?", mode: "ask", fetch: server.fetch, onTool: (n, i) => tools.push([n, i]) });
    assert.equal(r.text, "Line two says line two.");
    assert.deepEqual(tools, [
      ["read_file", undefined],
      ["read_file", call.input],
    ]);
    assert.equal(server.bodies.length, 2);
    assert.equal(server.bodies[1].history_provider, "anthropic");
    const h = server.bodies[1].history;
    assert.deepEqual(
      h.map((e) => e.role),
      ["user", "assistant", "tool"],
    );
    const tool = h[2] as Extract<HistoryEntry, { role: "tool" }>;
    assert.equal(tool.content.length, 1);
    assert.equal(tool.content[0].toolCallId, "toolu_1");
    assert.equal(tool.content[0].toolName, "read_file");
    assert.equal(tool.content[0].output.type, "text");
    assert.match(tool.content[0].output.value, /2\| line two/);
  });

  it("validates a tour handed in with finish_tour and answers the tool call", async () => {
    const steps = [{ say: "Start here.", file: "src/a.ts", start_line: 1, end_line: 2, node_ids: ["x", 3] }];
    const server = fakeServer([
      [message({ finish: "tool-calls", toolCalls: [{ toolCallId: "t1", toolName: "finish_tour", input: { title: "A tour", steps } }] })],
      [{ type: "text", text: "Press Play." }, message()],
    ]);
    const r = await ask({ repo, conversation: emptyConversation(), user: "tour", mode: "tour", fetch: server.fetch });
    assert.deepEqual(r.tour, { title: "A tour", steps: [{ say: "Start here.", file: "src/a.ts", start_line: 1, end_line: 2, node_ids: ["x"] }] });
    const tool = server.bodies[1].history[2] as Extract<HistoryEntry, { role: "tool" }>;
    assert.equal(tool.content[0].output.type, "text");
    assert.match(tool.content[0].output.value, /Tour received/);
  });

  it("marks an invalid tour as an error result", async () => {
    const server = fakeServer([
      [message({ finish: "tool-calls", toolCalls: [{ toolCallId: "t1", toolName: "finish_tour", input: { title: "Bad", steps: [{ say: "no file" }] } }] })],
      [message()],
    ]);
    const r = await ask({ repo, conversation: emptyConversation(), user: "tour", mode: "tour", fetch: server.fetch });
    assert.equal(r.tour, null);
    const tool = server.bodies[1].history[2] as Extract<HistoryEntry, { role: "tool" }>;
    assert.equal(tool.content[0].output.type, "error-text");
  });

  it("stops on length and content-filter with the right suffix", async () => {
    let server = fakeServer([[{ type: "text", text: "Half an" }, message({ finish: "length" })]]);
    let r = await ask({ repo, conversation: emptyConversation(), user: "q", mode: "ask", fetch: server.fetch });
    assert.equal(r.text, "Half an\n\n(Cut short at the output limit.)");
    assert.equal(r.finish, "length");
    assert.equal(server.bodies.length, 1);

    server = fakeServer([[message({ finish: "content-filter" })]]);
    r = await ask({ repo, conversation: emptyConversation(), user: "q", mode: "ask", fetch: server.fetch });
    assert.equal(r.text, "(The model declined to answer this one.)");
    assert.equal(r.finish, "content-filter");
  });

  it("throws AskError carrying the FriendlyError from an error event", async () => {
    const error: FriendlyError = { code: "invalid_key", title: "Anthropic (Claude) rejected the API key", message: "Paste a fresh key.", action: "settings", provider: "anthropic", status: 401 };
    const server = fakeServer([[{ type: "error", error }]]);
    await assert.rejects(ask({ repo, conversation: emptyConversation(), user: "q", mode: "ask", fetch: server.fetch }), (e: unknown) => e instanceof AskError && e.info.code === "invalid_key" && e.info.action === "settings" && e.info.status === 401);
  });

  it("throws AskError from the readiness pre-check without calling /api/claude, and checks once when ready", async () => {
    const notReady: FriendlyError = { code: "missing_key", title: "Anthropic (Claude) API key missing", message: "Add your key.", action: "settings" };
    const server = fakeServer([[message()], [message()]], notReady);
    await assert.rejects(ask({ repo, conversation: emptyConversation(), user: "q", mode: "ask", fetch: server.fetch }), (e: unknown) => e instanceof AskError && e.info.code === "missing_key");
    assert.equal(server.bodies.length, 0);

    let readinessCalls = 0;
    resetReadiness();
    const ok = fakeServer([[message()], [message()]]);
    const okCounting: FetchLike = (input, init) => {
      if (String(input).endsWith("/api/config/readiness")) readinessCalls++;
      return ok.fetch(input, init);
    };
    await ask({ repo, conversation: emptyConversation(), user: "one", mode: "ask", fetch: okCounting });
    await ask({ repo, conversation: emptyConversation(), user: "two", mode: "ask", fetch: okCounting });
    assert.equal(readinessCalls, 1);
    assert.equal(ok.bodies.length, 2);
  });

  it("turns a 403 from the guard into AskError forbidden and a plain failure into a retryable unknown", async () => {
    const forbidden: FriendlyError = { code: "forbidden", title: "Settings can only be changed from this computer", message: "Open WalkMyCode at http://localhost:3000.", action: null };
    let server = fakeServer([Response.json({ error: forbidden }, { status: 403 })]);
    await assert.rejects(ask({ repo, conversation: emptyConversation(), user: "q", mode: "ask", fetch: server.fetch }), (e: unknown) => e instanceof AskError && e.info.code === "forbidden");

    server = fakeServer([Response.json({ error: "history: too small" }, { status: 400 })]);
    await assert.rejects(ask({ repo, conversation: emptyConversation(), user: "q", mode: "ask", fetch: server.fetch }), (e: unknown) => e instanceof AskError && e.info.code === "unknown" && e.info.message === "history: too small" && e.info.action === "retry");
  });

  it("gives up after ten rounds of tool calls", async () => {
    const step = message({ finish: "tool-calls", toolCalls: [{ toolCallId: "t", toolName: "list_files", input: {} }] });
    const server = fakeServer(Array.from({ length: 12 }, () => [step]));
    const r = await ask({ repo, conversation: emptyConversation(), user: "loop", mode: "ask", fetch: server.fetch });
    assert.equal(server.bodies.length, 10);
    assert.equal(r.finish, "tool-calls");
  });
});

describe("trimHistory", () => {
  const user = (i: number): HistoryEntry => ({ role: "user", content: `q${i}` });
  const assistant = (): HistoryEntry => ({ role: "assistant", message: { role: "assistant", content: "a" } });
  const tool = (): HistoryEntry => ({ role: "tool", content: [] });

  it("keeps short histories as they are", () => {
    const h = [user(1), assistant(), user(2), assistant()];
    assert.equal(trimHistory(h), h);
  });

  it("never starts on an assistant or tool entry", () => {
    const h: HistoryEntry[] = [];
    for (let i = 0; i < 10; i++) h.push(user(i), assistant(), tool(), assistant());
    const t = trimHistory(h);
    assert.ok(t.length <= 27 && t.length >= 24);
    assert.equal(t[0].role, "user");
    assert.deepEqual(t.slice(-3).map((e) => e.role), ["assistant", "tool", "assistant"]);
    for (let i = 1; i < t.length; i++) if (t[i].role === "tool") assert.equal(t[i - 1].role, "assistant");
  });

  it("keeps a long tool loop whole rather than splitting a call from its result", () => {
    const h: HistoryEntry[] = [user(0), assistant()];
    h.push(user(1));
    for (let i = 0; i < 20; i++) h.push(assistant(), tool());
    h.push(assistant());
    const t = trimHistory(h);
    assert.equal(t[0], h[2]);
    assert.equal(t.length, h.length - 2);
  });
});

describe("afterSettingsSaved", () => {
  const c: Conversation = { history: [{ role: "user", content: "q" }, { role: "assistant", message: { role: "assistant", content: "a" } }], provider: "anthropic" };

  it("starts fresh when the provider changes", () => {
    const r = afterSettingsSaved(c, "openai");
    assert.equal(r.switched, true);
    assert.deepEqual(r.conversation, { history: [], provider: null });
  });

  it("keeps the conversation on the same provider or when nothing has been said", () => {
    assert.deepEqual(afterSettingsSaved(c, "anthropic"), { conversation: c, switched: false });
    const empty = emptyConversation();
    assert.deepEqual(afterSettingsSaved(empty, "groq"), { conversation: empty, switched: false });
  });

  it("makes the next question re-check readiness", async () => {
    let readinessCalls = 0;
    const server = fakeServer([[message()], [message()]]);
    const fetch: FetchLike = (input, init) => {
      if (String(input).endsWith("/api/config/readiness")) readinessCalls++;
      return server.fetch(input, init);
    };
    await ask({ repo, conversation: emptyConversation(), user: "one", mode: "ask", fetch });
    afterSettingsSaved(emptyConversation(), "anthropic");
    await ask({ repo, conversation: emptyConversation(), user: "two", mode: "ask", fetch });
    assert.equal(readinessCalls, 2);
  });
});
