// The translation drift alarm. For each wire family, POST /api/claude runs
// through the real handler and sdk.ts with a fake fetch that (a) captures
// the outbound request so its shape can be checked against docs/PROVIDERS.md
// §4 and (b) answers with a stream from tests/fixtures/<provider>/. Then the
// returned assistant message goes back in with a tool result, and the next
// request must carry the provider's round-trip field. An SDK bump that
// changes the wire or the parsing fails here before it reaches a user.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { askHandler } from "../src/lib/providers/ask";
import { PROVIDERS, type Effort, type ProviderId } from "../src/lib/providers/catalogue";
import { configPath, saveConfig } from "../src/lib/providers/config";
import { keysPath, writeKey } from "../src/lib/providers/keys";
import type { FetchLike } from "../src/lib/providers/sdk";
import type { AskRequest, HistoryEntry, StreamEvent, ToolCall } from "../src/lib/providers/wire";

const ENV = ["WALKMYCODE_PROVIDER", "WALKMYCODE_MODEL", "WALKMYCODE_EFFORT", "LOCAL_BASE_URL", "WALKMYCODE_ALLOW_REMOTE", ...Object.values(PROVIDERS).flatMap((p) => (p.env ? [p.env] : []))];
const FIXTURES = join(__dirname, "fixtures");
const SUMMARY = "# Repo: demo\nAreas (packages): app\n1 files, 1 in the map, 0 routes, 0 tables, 0 links (0 guesses).";
const QUESTION = "Where does sign-in happen?";
let home: string;

before(() => {
  home = mkdtempSync(join(tmpdir(), "walkmycode-translate-"));
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

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Message = Extract<StreamEvent, { type: "message" }>;

/** Save the choice and a made-up key, as Settings would. */
function choose(provider: ProviderId, model: string, effort: Effort = "medium"): void {
  saveConfig({ provider, model, effort });
  const env = PROVIDERS[provider].env;
  if (env) writeKey(env, `test-key-${provider}`);
}

function fixture(provider: ProviderId, name: string): string {
  return readFileSync(join(FIXTURES, provider, `${name}.sse`), "utf8");
}

/**
 * One ask through the handler. The fake fetch answers the local server's
 * readiness probe (a GET) with an empty model list and every POST with the
 * fixture, recording what was sent.
 */
async function ask(provider: ProviderId, name: string, extra: Partial<AskRequest> = {}) {
  const sent: { url: string; headers: Headers; body: Json }[] = [];
  const fetch: FetchLike = async (input, init) => {
    if (!init?.body) return Response.json({ data: [] });
    sent.push({ url: String(input), headers: new Headers(init.headers as HeadersInit), body: JSON.parse(String(init.body)) });
    return new Response(fixture(provider, name), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const body: AskRequest = { history: [{ role: "user", content: QUESTION }], history_provider: null, mode: "ask", mapSummary: SUMMARY, ...extra };
  const req = new Request("http://localhost:3000/api/claude", { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify(body) });
  const res = await askHandler({ fetch })(req);
  assert.equal(res.status, 200);
  const events = (await res.text())
    .split("\n\n")
    .filter((f) => f.startsWith("data:"))
    .map((f) => JSON.parse(f.slice(5)) as StreamEvent);
  const errors = events.filter((e) => e.type === "error");
  assert.deepEqual(errors, [], "no error events");
  assert.equal(sent.length, 1, "one provider request");
  const last = events.at(-1);
  assert.equal(last?.type, "message", "the stream ends with one message event");
  return { events, message: last as Message, sent: sent[0] };
}

/** Event types in order, for sequence assertions. */
const kinds = (events: StreamEvent[]) => events.map((e) => (e.type === "tool" ? `tool:${e.name}` : e.type));

/** The history for the next step: the question, the stored message verbatim, a result per call. */
function followUp(message: Message): Partial<AskRequest> {
  const results: HistoryEntry = {
    role: "tool",
    content: message.toolCalls.map((c: ToolCall) => ({ type: "tool-result", toolCallId: c.toolCallId, toolName: c.toolName, output: { type: "text", value: `results for ${c.toolName}` } })),
  };
  return { history: [{ role: "user", content: QUESTION }, { role: "assistant", message: message.message }, results], history_provider: message.provider };
}

/** [name, strict] for every tool declaration, whatever the wire family calls them. */
function declared(body: Json): [string, unknown][] {
  if (Array.isArray(body.tools?.[0]?.functionDeclarations)) return body.tools[0].functionDeclarations.map((f: Json) => [f.name, f.strict]);
  return (body.tools ?? []).map((t: Json) => (t.function ? [t.function.name, t.function.strict] : [t.name, t.strict]));
}

/** Rules every provider shares: no sampling knobs, strict only on finish_tour and only where honoured. */
function assertCommon(provider: ProviderId, body: Json, mode: "ask" | "tour"): void {
  for (const k of ["temperature", "top_p", "topP"]) assert.equal(k in body, false, `${provider} sent ${k}`);
  if (body.generationConfig) for (const k of ["temperature", "topP"]) assert.equal(k in body.generationConfig, false, `${provider} sent ${k}`);
  const tools = declared(body);
  assert.deepEqual(
    tools.map(([n]) => n),
    ["read_file", "search", "query_map", "list_files", "fly_step", ...(mode === "tour" ? ["finish_tour"] : [])],
  );
  for (const [name, strict] of tools) {
    const expected = name === "finish_tour" && PROVIDERS[provider].strict_tools;
    assert.equal(strict === true, expected, `${provider}/${name} strict=${String(strict)}`);
  }
}

const TEXT_USAGE_NONE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_tokens: 0 };

describe("anthropic (Messages API)", () => {
  it("sends cache breakpoints on both system blocks and the last tool, fallbacks:'default', and reads a text answer", async () => {
    choose("anthropic", "claude-opus-5-5");
    const { events, message, sent } = await ask("anthropic", "text", { mode: "tour" });
    assert.equal(sent.url, "https://api.anthropic.com/v1/messages");
    assert.match(sent.headers.get("anthropic-beta") ?? "", /server-side-fallback-2026-07-01/);
    assertCommon("anthropic", sent.body, "tour");
    assert.equal(sent.body.fallbacks, "default");
    assert.deepEqual(sent.body.tool_choice, { type: "auto" });
    assert.equal(sent.body.system.length, 2);
    for (const s of sent.body.system) assert.deepEqual(s.cache_control, { type: "ephemeral" });
    assert.deepEqual(sent.body.tools.at(-1).cache_control, { type: "ephemeral" });
    assert.ok(sent.body.tools.slice(0, -1).every((t: Json) => t.cache_control === undefined));

    assert.deepEqual(kinds(events), ["text", "text", "message"]);
    assert.equal(message.finish, "stop");
    assert.equal(message.model, "claude-opus-5-5", "the requested id, not the dated echo");
    assert.deepEqual(message.usage, { input_tokens: 12, output_tokens: 9, cache_read_input_tokens: 3400, cache_creation_input_tokens: 0, reasoning_tokens: 0, known: true });
  });

  it("keeps the thinking signature, drops the fallback marker, joins split tool input, and replays the signature", async () => {
    choose("anthropic", "claude-opus-5-5");
    const first = await ask("anthropic", "thinking-fallback-tool");
    assert.deepEqual(kinds(first.events), ["tool:search", "message"]);
    assert.equal(first.message.finish, "tool-calls");
    assert.deepEqual(first.message.toolCalls, [{ toolCallId: "toolu_01SEARCH", toolName: "search", input: { query: "signin" } }]);
    assert.deepEqual(first.message.usage, { input_tokens: 20, output_tokens: 48, cache_read_input_tokens: 0, cache_creation_input_tokens: 3400, reasoning_tokens: 0, known: true });
    const parts = first.message.message.content as Json[];
    assert.deepEqual(
      parts.map((p) => p.type),
      ["reasoning", "tool-call"],
      "the SDK has no content part for a fallback hop, so the marker is dropped",
    );
    assert.equal(parts[0].providerOptions.anthropic.signature, "EqQBCkYIBxgCKkDsyntheticThinkingSignature==");

    const next = await ask("anthropic", "text", followUp(first.message));
    const msgs = next.sent.body.messages as Json[];
    assert.deepEqual(
      msgs.map((m) => m.role),
      ["user", "assistant", "user"],
    );
    assert.deepEqual(msgs[1].content[0], { type: "thinking", thinking: "The question is about sign-in. Search for it first.", signature: "EqQBCkYIBxgCKkDsyntheticThinkingSignature==" });
    assert.equal(msgs[1].content[1].type, "tool_use");
    assert.equal(msgs[1].content[1].id, "toolu_01SEARCH");
    assert.equal(msgs[2].content[0].type, "tool_result");
    assert.equal(msgs[2].content[0].tool_use_id, "toolu_01SEARCH");
  });

  it("returns two parallel tool calls and sends both results in one user message", async () => {
    choose("anthropic", "claude-opus-5-5");
    const first = await ask("anthropic", "parallel-tools");
    assert.deepEqual(kinds(first.events), ["text", "tool:read_file", "tool:query_map", "message"]);
    assert.deepEqual(
      first.message.toolCalls.map((c) => [c.toolName, c.input]),
      [
        ["read_file", { path: "src/auth.ts" }],
        ["query_map", { query: "signin" }],
      ],
    );
    const next = await ask("anthropic", "text", followUp(first.message));
    const results = (next.sent.body.messages as Json[])[2].content as Json[];
    assert.deepEqual(
      results.map((r) => [r.type, r.tool_use_id]),
      [
        ["tool_result", "toolu_01READ"],
        ["tool_result", "toolu_01MAP"],
      ],
    );
  });
});

describe("openai (Responses API)", () => {
  it("sends store:false, the encrypted-reasoning include, a cache key, reasoning effort and strict only on finish_tour", async () => {
    choose("openai", "gpt-6.1-sol", "high");
    const { events, message, sent } = await ask("openai", "text", { mode: "tour" });
    assert.equal(sent.url, "https://api.openai.com/v1/responses");
    assert.equal(sent.headers.get("authorization"), "Bearer test-key-openai");
    assertCommon("openai", sent.body, "tour");
    assert.equal(sent.body.store, false);
    assert.deepEqual(sent.body.include, ["reasoning.encrypted_content"]);
    assert.match(sent.body.prompt_cache_key, /^lantern:[0-9a-f]{40}$/);
    assert.equal(sent.body.reasoning.effort, "high");
    assert.equal(sent.body.max_output_tokens, 16000);
    assert.equal(sent.body.tool_choice, "auto");
    assert.ok(sent.body.tools.every((t: Json) => t.type === "function" && t.parameters));

    assert.deepEqual(kinds(events), ["text", "text", "message"]);
    assert.equal(message.finish, "stop");
    assert.equal(message.model, "gpt-6.1-sol");
    assert.deepEqual(message.usage, { input_tokens: 428, output_tokens: 20, cache_read_input_tokens: 3072, cache_creation_input_tokens: 0, reasoning_tokens: 8, known: true });
  });

  it("keeps the reasoning item with its encrypted content, joins split arguments, and replays both", async () => {
    choose("openai", "gpt-6.1-sol");
    const first = await ask("openai", "reasoning-tool");
    assert.deepEqual(kinds(first.events), ["tool:search", "message"]);
    assert.equal(first.message.finish, "tool-calls");
    assert.deepEqual(first.message.toolCalls, [{ toolCallId: "call_01SEARCH", toolName: "search", input: { query: "signin" } }]);
    assert.equal(first.message.usage.reasoning_tokens, 64);
    const parts = first.message.message.content as Json[];
    assert.equal(parts[0].type, "reasoning");
    assert.deepEqual(parts[0].providerOptions.openai, { itemId: "rs_01TOOL", reasoningEncryptedContent: "gAAAAABsynthetic-encrypted-reasoning-01" });

    const next = await ask("openai", "text", followUp(first.message));
    const input = next.sent.body.input as Json[];
    const reasoning = input.find((i) => i.type === "reasoning");
    assert.ok(reasoning, "the reasoning item goes back before the call it preceded");
    assert.equal(reasoning.encrypted_content, "gAAAAABsynthetic-encrypted-reasoning-01");
    const at = (type: string) => input.findIndex((i) => i.type === type);
    assert.ok(at("reasoning") < at("function_call") && at("function_call") < at("function_call_output"));
    assert.equal(input[at("function_call")].call_id, "call_01SEARCH");
    assert.deepEqual(input[at("function_call_output")], { type: "function_call_output", call_id: "call_01SEARCH", output: "results for search" });
  });

  it("maps incomplete_details.max_output_tokens to finish 'length'", async () => {
    choose("openai", "gpt-6.1-sol");
    const { message } = await ask("openai", "incomplete");
    assert.equal(message.finish, "length");
    assert.equal(message.usage.output_tokens, 16000);
  });
});

describe("xai (Responses API)", () => {
  it("sends store:false with the encrypted-reasoning include and never strict", async () => {
    choose("xai", "grok-4.3", "high");
    const { events, message, sent } = await ask("xai", "text", { mode: "tour" });
    assert.equal(sent.url, "https://api.x.ai/v1/responses");
    assertCommon("xai", sent.body, "tour");
    assert.equal(sent.body.store, false);
    assert.deepEqual(sent.body.include, ["reasoning.encrypted_content"], "exactly once: the SDK adds it for store:false");
    assert.equal(sent.body.reasoning.effort, "high");
    assert.deepEqual(kinds(events), ["text", "text", "message"]);
    assert.equal(message.finish, "stop");
    assert.deepEqual(message.usage, { input_tokens: 500, output_tokens: 30, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0, reasoning_tokens: 20, known: true });
  });

  it("reads a function call that arrives whole and replays the encrypted reasoning", async () => {
    choose("xai", "grok-4.3");
    const first = await ask("xai", "reasoning-tool");
    assert.deepEqual(kinds(first.events), ["tool:search", "message"]);
    assert.equal(first.message.finish, "tool-calls");
    assert.deepEqual(first.message.toolCalls, [{ toolCallId: "call_x01SEARCH", toolName: "search", input: { query: "signin" } }]);
    const parts = first.message.message.content as Json[];
    assert.equal(parts[0].providerOptions.xai.reasoningEncryptedContent, "xai-synthetic-encrypted-reasoning-01");

    const next = await ask("xai", "text", followUp(first.message));
    const input = next.sent.body.input as Json[];
    const reasoning = input.find((i) => i.type === "reasoning");
    assert.equal(reasoning?.encrypted_content, "xai-synthetic-encrypted-reasoning-01");
    assert.ok(input.some((i) => i.type === "function_call" && i.call_id === "call_x01SEARCH"));
    assert.ok(input.some((i) => i.type === "function_call_output" && i.call_id === "call_x01SEARCH"));
  });

  it("reports zeros, not 'unknown', when a stream ends without usage (pinned: the meter shows it as $0)", async () => {
    choose("xai", "grok-4.3");
    const { message } = await ask("xai", "no-usage");
    assert.equal(message.finish, "other");
    assert.deepEqual(message.usage, { ...TEXT_USAGE_NONE, known: true });
  });
});

describe("gemini (native generateContent)", () => {
  it("sends functionDeclarations, a system instruction and the thinking level, and never strict", async () => {
    choose("gemini", "gemini-3.8-flash", "low");
    const { events, message, sent } = await ask("gemini", "text", { mode: "tour" });
    assert.equal(sent.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse");
    assert.equal(sent.headers.get("x-goog-api-key"), "test-key-gemini");
    assertCommon("gemini", sent.body, "tour");
    assert.deepEqual(sent.body.generationConfig.thinkingConfig, { thinkingLevel: "low" });
    assert.equal(sent.body.generationConfig.maxOutputTokens, 8000);
    assert.ok(sent.body.systemInstruction);
    assert.deepEqual(sent.body.toolConfig, { functionCallingConfig: { mode: "AUTO" } });

    assert.deepEqual(kinds(events), ["text", "text", "message"]);
    assert.equal(message.finish, "stop");
    assert.deepEqual(message.usage, { input_tokens: 1452, output_tokens: 39, cache_read_input_tokens: 2048, cache_creation_input_tokens: 0, reasoning_tokens: 30, known: true });
  });

  it("keeps the thoughtSignature on the call and sends it back on the next turn", async () => {
    choose("gemini", "gemini-3.8-flash");
    const first = await ask("gemini", "signed-tool");
    assert.deepEqual(kinds(first.events), ["tool:search", "message"]);
    assert.equal(first.message.finish, "tool-calls");
    assert.equal(first.message.toolCalls.length, 1);
    assert.equal(first.message.toolCalls[0].toolName, "search");
    assert.ok(first.message.toolCalls[0].toolCallId, "the SDK synthesises an id");
    const parts = first.message.message.content as Json[];
    assert.equal(parts[0].providerOptions.google.thoughtSignature, "CiQBsyntheticThoughtSignature01==");

    const next = await ask("gemini", "text", followUp(first.message));
    const contents = next.sent.body.contents as Json[];
    assert.deepEqual(
      contents.map((c) => c.role),
      ["user", "model", "user"],
    );
    assert.equal(contents[1].parts[0].functionCall.name, "search");
    assert.equal(contents[1].parts[0].thoughtSignature, "CiQBsyntheticThoughtSignature01==");
    assert.equal(contents[2].parts[0].functionResponse.name, "search");
  });

  it("returns two parallel calls and sends both responses in one user content", async () => {
    choose("gemini", "gemini-3.8-flash");
    const first = await ask("gemini", "parallel-tools");
    assert.deepEqual(kinds(first.events), ["tool:read_file", "tool:query_map", "message"]);
    assert.equal(first.message.finish, "tool-calls");
    const next = await ask("gemini", "text", followUp(first.message));
    const contents = next.sent.body.contents as Json[];
    assert.equal(contents[1].parts[0].thoughtSignature, "CiQBsyntheticThoughtSignature02==");
    assert.deepEqual(
      (contents[2].parts as Json[]).map((p) => p.functionResponse?.name),
      ["read_file", "query_map"],
    );
  });
});

describe("groq (Chat Completions)", () => {
  it("sends reasoning_effort for gpt-oss and reads usage from x_groq.usage", async () => {
    choose("groq", "openai/gpt-oss-120b", "high");
    const { events, message, sent } = await ask("groq", "text", { mode: "tour" });
    assert.equal(sent.url, "https://api.groq.com/openai/v1/chat/completions");
    assertCommon("groq", sent.body, "tour");
    assert.equal(sent.body.reasoning_effort, "high");
    assert.equal(sent.body.tool_choice, "auto");
    assert.equal("parallel_tool_calls" in sent.body, false);
    assert.deepEqual(kinds(events), ["text", "text", "message"]);
    assert.equal(message.finish, "stop");
    assert.equal(message.model, "openai/gpt-oss-120b");
    assert.deepEqual(message.usage, { input_tokens: 2476, output_tokens: 25, cache_read_input_tokens: 1024, cache_creation_input_tokens: 0, reasoning_tokens: 7, known: true });
  });

  it("sends no reasoning_effort for Llama", async () => {
    choose("groq", "llama-3.3-70b-versatile", "high");
    const { sent } = await ask("groq", "text");
    assertCommon("groq", sent.body, "ask");
    assert.equal("reasoning_effort" in sent.body, false);
  });

  it("joins tool arguments split across chunks and sends the result as a role:'tool' message", async () => {
    choose("groq", "openai/gpt-oss-120b");
    const first = await ask("groq", "split-tool");
    assert.deepEqual(kinds(first.events), ["tool:search", "message"]);
    assert.equal(first.message.finish, "tool-calls");
    assert.deepEqual(first.message.toolCalls, [{ toolCallId: "fc_q01SEARCH", toolName: "search", input: { query: "signin" } }]);
    const next = await ask("groq", "text", followUp(first.message));
    const msgs = next.sent.body.messages as Json[];
    assert.deepEqual(
      msgs.map((m) => m.role),
      ["system", "system", "user", "assistant", "tool"],
    );
    assert.equal(msgs[3].tool_calls[0].id, "fc_q01SEARCH");
    assert.deepEqual(msgs[4], { role: "tool", tool_call_id: "fc_q01SEARCH", content: "results for search" });
  });
});

describe("deepseek (Chat Completions)", () => {
  it("turns thinking off at effort low and asks for streamed usage", async () => {
    choose("deepseek", "deepseek-flash", "low");
    const { message, sent } = await ask("deepseek", "length", { mode: "tour" });
    assert.equal(sent.url, "https://api.deepseek.com/chat/completions");
    assertCommon("deepseek", sent.body, "tour");
    assert.deepEqual(sent.body.thinking, { type: "disabled" });
    assert.equal("reasoning_effort" in sent.body, false);
    assert.deepEqual(sent.body.stream_options, { include_usage: true });
    assert.equal(message.finish, "length");
  });

  it("reads reasoning_content and prompt_cache_hit_tokens from a usage-only final chunk, and replays reasoning_content", async () => {
    choose("deepseek", "deepseek-flash", "medium");
    const first = await ask("deepseek", "reasoning-tool");
    assert.deepEqual(first.sent.body.thinking, { type: "enabled" });
    assert.equal(first.sent.body.reasoning_effort, "low");
    assert.deepEqual(kinds(first.events), ["tool:search", "message"]);
    assert.equal(first.message.finish, "tool-calls");
    assert.deepEqual(first.message.toolCalls, [{ toolCallId: "call_00_d01SEARCH", toolName: "search", input: { query: "signin" } }]);
    assert.deepEqual(first.message.usage, { input_tokens: 300, output_tokens: 60, cache_read_input_tokens: 3200, cache_creation_input_tokens: 0, reasoning_tokens: 40, known: true });

    const next = await ask("deepseek", "length", followUp(first.message));
    const msgs = next.sent.body.messages as Json[];
    const assistant = msgs.find((m) => m.role === "assistant");
    assert.equal(assistant?.reasoning_content, "The question is about sign-in. Search first.", "dropping it 400s with tools");
    assert.equal(assistant?.tool_calls[0].id, "call_00_d01SEARCH");
    assert.deepEqual(msgs.at(-1), { role: "tool", tool_call_id: "call_00_d01SEARCH", content: "results for search" });
  });
});

describe("local (OpenAI-compatible)", () => {
  it("talks to the saved server URL, asks for streamed usage and reads a usage-only final chunk", async () => {
    choose("local", "llama3.3", "high");
    const { events, message, sent } = await ask("local", "text", { mode: "tour" });
    assert.equal(sent.url, "http://localhost:11434/v1/chat/completions");
    assertCommon("local", sent.body, "tour");
    assert.deepEqual(sent.body.stream_options, { include_usage: true });
    assert.equal("reasoning_effort" in sent.body, false);
    assert.deepEqual(kinds(events), ["text", "text", "message"]);
    assert.equal(message.finish, "stop");
    assert.equal(message.model, "llama3.3");
    assert.deepEqual(message.usage, { input_tokens: 3500, output_tokens: 9, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_tokens: 0, known: true });
  });

  it("assembles two parallel calls by index and sends one tool message per result, in call order", async () => {
    choose("local", "llama3.3");
    const first = await ask("local", "parallel-tools");
    assert.deepEqual(kinds(first.events), ["tool:read_file", "tool:query_map", "message"]);
    assert.deepEqual(first.message.toolCalls, [
      { toolCallId: "call_l01READ", toolName: "read_file", input: { path: "src/auth.ts" } },
      { toolCallId: "call_l01MAP", toolName: "query_map", input: { query: "signin" } },
    ]);
    const next = await ask("local", "text", followUp(first.message));
    const msgs = next.sent.body.messages as Json[];
    assert.deepEqual(
      msgs.slice(-2).map((m) => [m.role, m.tool_call_id]),
      [
        ["tool", "call_l01READ"],
        ["tool", "call_l01MAP"],
      ],
    );
  });

  it("marks usage unknown when the stream ends without it", async () => {
    choose("local", "llama3.3");
    const { message } = await ask("local", "no-usage");
    assert.equal(message.finish, "stop");
    assert.deepEqual(message.usage, { ...TEXT_USAGE_NONE, known: false });
  });
});
