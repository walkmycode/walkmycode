// POST /api/claude end to end with a fake fetch standing in for Anthropic:
// the guard, the readiness and stale-history errors on the stream, a text
// answer, a tool-call step, and that the browser's abort reaches the
// provider request. Runs in a temp WALKMYCODE_HOME with a made-up key.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { askHandler } from "../src/lib/providers/ask";
import { configPath } from "../src/lib/providers/config";
import { guarded } from "../src/lib/providers/guard";
import { keysPath, writeKey } from "../src/lib/providers/keys";
import type { FetchLike } from "../src/lib/providers/sdk";
import type { AskRequest, StreamEvent } from "../src/lib/providers/wire";

const ENV = ["WALKMYCODE_PROVIDER", "WALKMYCODE_MODEL", "WALKMYCODE_EFFORT", "ANTHROPIC_API_KEY"];
let home: string;

before(() => {
  home = mkdtempSync(join(tmpdir(), "walkmycode-route-"));
  process.env.WALKMYCODE_HOME = home;
});

beforeEach(() => {
  for (const v of ENV) delete process.env[v];
  rmSync(configPath(), { force: true });
  rmSync(keysPath(), { force: true });
});

after(() => {
  for (const v of ENV) delete process.env[v];
  delete process.env.WALKMYCODE_HOME;
  rmSync(home, { recursive: true, force: true });
});

const SUMMARY = "# Repo: demo\nAreas (packages): app\n1 files, 1 in the map, 0 routes, 0 tables, 0 links (0 guesses).";

function body(extra: Partial<AskRequest> = {}): AskRequest {
  return { history: [{ role: "user", content: "Where does sign-in happen?" }], history_provider: null, mode: "ask", mapSummary: SUMMARY, ...extra };
}

function request(json: unknown, headers: Record<string, string> = {}, signal?: AbortSignal): Request {
  return new Request("http://localhost:3000/api/claude", { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json", ...headers }, body: JSON.stringify(json), signal });
}

/** Read every `data:` frame off the response. */
async function events(res: Response): Promise<StreamEvent[]> {
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((f) => f.startsWith("data:"))
    .map((f) => JSON.parse(f.slice(5)) as StreamEvent);
}

type Frame = [string, Record<string, unknown>];
const anthropicSse = (frames: Frame[]) => frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`).join("");

const start: Frame = ["message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5-20260901", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 20, output_tokens: 1 } } }];
const textAnswer = anthropicSse([
  start,
  ["content_block_start", { index: 0, content_block: { type: "text", text: "" } }],
  ["content_block_delta", { index: 0, delta: { type: "text_delta", text: "Hel" } }],
  ["content_block_delta", { index: 0, delta: { type: "text_delta", text: "lo" } }],
  ["content_block_stop", { index: 0 }],
  ["message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } }],
  ["message_stop", {}],
]);
const toolAnswer = anthropicSse([
  start,
  ["content_block_start", { index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "read_file" } }],
  ["content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: '{"path": "src/' } }],
  ["content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: 'a.ts"}' } }],
  ["content_block_stop", { index: 0 }],
  ["message_delta", { delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 12 } }],
  ["message_stop", {}],
]);

/** A fake Anthropic that records the outbound request and answers with one recorded stream. */
function fakeAnthropic(sse: string) {
  const seen: { url?: string; body?: Record<string, unknown>; signal?: AbortSignal | null } = {};
  const fetch: FetchLike = async (input, init) => {
    seen.url = String(input);
    seen.body = JSON.parse(String(init?.body));
    seen.signal = init?.signal;
    return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  return { fetch, seen };
}

describe("POST /api/claude", () => {
  it("refuses a foreign origin with the 403 body and never calls the provider", async () => {
    writeKey("ANTHROPIC_API_KEY", "sk-ant-test");
    const upstream = fakeAnthropic(textAnswer);
    const res = await guarded(askHandler({ fetch: upstream.fetch }))(request(body(), { origin: "http://evil.example" }));
    assert.equal(res.status, 403);
    const json = (await res.json()) as { error: { code: string } };
    assert.equal(json.error.code, "forbidden");
    assert.equal(upstream.seen.url, undefined);
  });

  it("returns 400 for a body that is not an AskRequest", async () => {
    const res = await guarded(askHandler())(request({ messages: [] }));
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /history/);
  });

  it("puts the readiness error on the stream when no key is set", async () => {
    const upstream = fakeAnthropic(textAnswer);
    const evs = await events(await guarded(askHandler({ fetch: upstream.fetch }))(request(body())));
    assert.equal(evs.length, 1);
    assert.equal(evs[0].type, "error");
    const err = evs[0].type === "error" ? evs[0].error : null;
    assert.equal(err?.code, "missing_key");
    assert.equal(err?.action, "settings");
    assert.equal(err?.provider, "anthropic");
    assert.equal(upstream.seen.url, undefined);
  });

  it("refuses a history produced by another provider with stale_history", async () => {
    writeKey("ANTHROPIC_API_KEY", "sk-ant-test");
    const upstream = fakeAnthropic(textAnswer);
    const evs = await events(await guarded(askHandler({ fetch: upstream.fetch }))(request(body({ history_provider: "openai" }))));
    assert.equal(evs.length, 1);
    assert.equal(evs[0].type, "error");
    const err = evs[0].type === "error" ? evs[0].error : null;
    assert.equal(err?.code, "stale_history");
    assert.equal(err?.action, "retry");
    assert.match(err?.message ?? "", /Anthropic \(Claude\)/);
    assert.equal(upstream.seen.url, undefined);
  });

  it("streams text deltas then one message event with the requested model id and normalised usage", async () => {
    writeKey("ANTHROPIC_API_KEY", "sk-ant-test");
    const upstream = fakeAnthropic(textAnswer);
    const evs = await events(await guarded(askHandler({ fetch: upstream.fetch }))(request(body())));
    assert.deepEqual(
      evs.map((e) => e.type),
      ["text", "text", "message"],
    );
    assert.equal(evs[0].type === "text" && evs[0].text, "Hel");
    const m = evs[2];
    assert.equal(m.type, "message");
    if (m.type !== "message") return;
    assert.equal(m.finish, "stop");
    assert.equal(m.provider, "anthropic");
    assert.equal(m.model, "claude-opus-5-5");
    assert.deepEqual(m.toolCalls, []);
    assert.deepEqual(m.usage, { input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 20, cache_creation_input_tokens: 5, reasoning_tokens: 0, known: true });
    assert.equal(m.message.role, "assistant");
    const parts = m.message.content as { type: string; text?: string }[];
    assert.deepEqual(parts.map((p) => p.type), ["text"]);
    assert.equal(parts[0].text, "Hello");

    assert.equal(upstream.seen.url, "https://api.anthropic.com/v1/messages");
    const sent = upstream.seen.body!;
    assert.equal(sent.model, "claude-opus-5-5");
    assert.equal(sent.temperature, undefined);
    assert.deepEqual(sent.tool_choice, { type: "auto" });
    assert.equal((sent.tools as unknown[]).length, 5);
    assert.deepEqual(sent.messages, [{ role: "user", content: [{ type: "text", text: "Where does sign-in happen?" }] }]);
  });

  it("sends a tool event early and the tool calls on the message when the model wants a tool", async () => {
    writeKey("ANTHROPIC_API_KEY", "sk-ant-test");
    const upstream = fakeAnthropic(toolAnswer);
    const evs = await events(await guarded(askHandler({ fetch: upstream.fetch }))(request(body({ mode: "tour" }))));
    assert.deepEqual(
      evs.map((e) => e.type),
      ["tool", "message"],
    );
    assert.equal(evs[0].type === "tool" && evs[0].name, "read_file");
    const m = evs[1];
    if (m.type !== "message") return assert.fail("no message");
    assert.equal(m.finish, "tool-calls");
    assert.deepEqual(m.toolCalls, [{ toolCallId: "toolu_1", toolName: "read_file", input: { path: "src/a.ts" } }]);
    const parts = m.message.content as { type: string; toolCallId?: string; input?: unknown }[];
    assert.equal(parts[0].type, "tool-call");
    assert.equal(parts[0].toolCallId, "toolu_1");
    assert.equal((upstream.seen.body!.tools as unknown[]).length, 6);
  });

  it("replays the stored assistant message and the tool results on the next step", async () => {
    writeKey("ANTHROPIC_API_KEY", "sk-ant-test");
    const first = fakeAnthropic(toolAnswer);
    const evs = await events(await guarded(askHandler({ fetch: first.fetch }))(request(body())));
    const m = evs[1];
    if (m.type !== "message") return assert.fail("no message");
    const second = fakeAnthropic(textAnswer);
    const next = body({
      history: [{ role: "user", content: "Where does sign-in happen?" }, { role: "assistant", message: m.message }, { role: "tool", content: [{ type: "tool-result", toolCallId: "toolu_1", toolName: "read_file", output: { type: "text", value: "src/a.ts (lines 1-1 of 1)\n   1| hi" } }] }],
      history_provider: "anthropic",
    });
    const evs2 = await events(await guarded(askHandler({ fetch: second.fetch }))(request(next)));
    assert.equal(evs2.at(-1)?.type, "message");
    const sent = second.seen.body!.messages as { role: string; content: { type: string; id?: string; tool_use_id?: string }[] }[];
    assert.deepEqual(sent.map((x) => x.role), ["user", "assistant", "user"]);
    assert.equal(sent[1].content[0].type, "tool_use");
    assert.equal(sent[1].content[0].id, "toolu_1");
    assert.equal(sent[2].content[0].type, "tool_result");
    assert.equal(sent[2].content[0].tool_use_id, "toolu_1");
  });

  it("classifies a provider failure onto the stream", async () => {
    writeKey("ANTHROPIC_API_KEY", "sk-ant-test");
    const fetch: FetchLike = async () => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), { status: 401, headers: { "content-type": "application/json" } });
    const evs = await events(await guarded(askHandler({ fetch }))(request(body())));
    assert.equal(evs.length, 1);
    const err = evs[0].type === "error" ? evs[0].error : null;
    assert.equal(err?.code, "invalid_key");
    assert.equal(err?.status, 401);
  });

  it("passes the browser's abort on to the provider request and ends the stream", async () => {
    writeKey("ANTHROPIC_API_KEY", "sk-ant-test");
    const upstreamSignal: { current?: AbortSignal | null } = {};
    const fetch: FetchLike = async (_input, init) => {
      upstreamSignal.current = init?.signal;
      // A stream that only ends when the request is aborted, like a real socket would.
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(anthropicSse([start, ["content_block_start", { index: 0, content_block: { type: "text", text: "" } }], ["content_block_delta", { index: 0, delta: { type: "text_delta", text: "Hel" } }]])));
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("The operation was aborted.", "AbortError")));
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    };
    const ac = new AbortController();
    const res = await guarded(askHandler({ fetch }))(request(body(), {}, ac.signal));
    const reader = res.body!.getReader();
    const first = await reader.read();
    assert.match(new TextDecoder().decode(first.value), /"type":"text"/);
    ac.abort();
    const rest: string[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      rest.push(new TextDecoder().decode(value));
    }
    assert.ok(upstreamSignal.current?.aborted, "the provider fetch was aborted");
    assert.ok(!rest.join("").includes('"type":"message"'), "no final message after abort");
  });
});
