// POST /api/learn with a fake fetch standing in for the provider: the guard,
// the readiness error on the stream, and that the provider, model and effort
// chosen in Settings (.walkmycode/config.json) are the ones the Learn room's
// request goes out with, while the events stay the text/message/error shapes
// src/learn/lib/tutor.ts reads. Runs in a temp WALKMYCODE_HOME with made-up keys.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { configPath, saveConfig } from "../src/lib/providers/config";
import { guarded } from "../src/lib/providers/guard";
import { keysPath, writeKey } from "../src/lib/providers/keys";
import { JSON_RULE, learnHandler } from "../src/lib/providers/learn";
import type { FetchLike } from "../src/lib/providers/sdk";
import type { StreamEvent } from "../src/lib/providers/wire";

const ENV = ["WALKMYCODE_PROVIDER", "WALKMYCODE_MODEL", "WALKMYCODE_EFFORT", "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY"];
let home: string;

before(() => {
  home = mkdtempSync(join(tmpdir(), "walkmycode-learn-"));
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

function request(json: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/learn", { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json", ...headers }, body: JSON.stringify(json) });
}

async function events(res: Response): Promise<StreamEvent[]> {
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  return (await res.text())
    .split("\n\n")
    .filter((f) => f.startsWith("data:"))
    .map((f) => JSON.parse(f.slice(5)) as StreamEvent);
}

type Frame = [string, Record<string, unknown>];
const anthropicSse = (frames: Frame[]) => frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`).join("");
const textAnswer = anthropicSse([
  ["message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
  ["content_block_start", { index: 0, content_block: { type: "text", text: "" } }],
  ["content_block_delta", { index: 0, delta: { type: "text_delta", text: "{\"ok\":" } }],
  ["content_block_delta", { index: 0, delta: { type: "text_delta", text: "true}" } }],
  ["content_block_stop", { index: 0 }],
  ["message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } }],
  ["message_stop", {}],
]);

function recorder(respond: () => Response) {
  const seen: { url?: string; body?: Record<string, unknown> } = {};
  const fetch: FetchLike = async (input, init) => {
    seen.url = String(input);
    seen.body = JSON.parse(String(init?.body));
    return respond();
  };
  return { fetch, seen };
}

describe("POST /api/learn", () => {
  it("refuses a foreign origin with the 403 body and never calls the provider", async () => {
    writeKey("ANTHROPIC_API_KEY", "sk-ant-test");
    const up = recorder(() => new Response(textAnswer, { status: 200, headers: { "content-type": "text/event-stream" } }));
    const res = await guarded(learnHandler({ fetch: up.fetch }))(request({ input: "Hi" }, { origin: "http://evil.example" }));
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, "forbidden");
    assert.equal(up.seen.url, undefined);
  });

  it("returns 400 for a body without input", async () => {
    const res = await guarded(learnHandler())(request({ prompt: "Hi" }));
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /input/);
  });

  it("puts the readiness error for the chosen provider on the stream when its key is missing", async () => {
    saveConfig({ provider: "deepseek", model: "deepseek-v4-pro" });
    const up = recorder(() => new Response("{}", { status: 200 }));
    const evs = await events(await guarded(learnHandler({ fetch: up.fetch }))(request({ input: "Hi" })));
    assert.equal(evs.length, 1);
    const err = evs[0].type === "error" ? evs[0].error : null;
    assert.equal(err?.code, "missing_key");
    assert.equal(err?.provider, "deepseek");
    assert.equal(up.seen.url, undefined);
  });

  it("answers with the model and effort saved in Settings, with no tools, as text then message events", async () => {
    saveConfig({ provider: "anthropic", model: "claude-sonnet-5-5", effort: "high" });
    writeKey("ANTHROPIC_API_KEY", "sk-ant-test");
    const up = recorder(() => new Response(textAnswer, { status: 200, headers: { "content-type": "text/event-stream" } }));
    const evs = await events(await guarded(learnHandler({ fetch: up.fetch }))(request({ input: "Mark this answer.", json: true })));
    assert.deepEqual(
      evs.map((e) => e.type),
      ["text", "text", "message"],
    );
    const m = evs[2];
    if (m.type !== "message") return assert.fail("no message");
    assert.equal(m.finish, "stop");
    assert.equal(m.provider, "anthropic");
    assert.equal(m.model, "claude-sonnet-5-5");
    assert.deepEqual(m.toolCalls, []);

    assert.equal(up.seen.url, "https://api.anthropic.com/v1/messages");
    const sent = up.seen.body!;
    assert.equal(sent.model, "claude-sonnet-5-5");
    assert.equal(sent.tools, undefined);
    assert.equal(typeof sent.max_tokens, "number");
    assert.deepEqual(sent.thinking, { type: "adaptive" });
    assert.match(JSON.stringify(sent), /"effort":"high"/);
    assert.deepEqual(sent.system, [{ type: "text", text: JSON_RULE }]);
    assert.deepEqual(sent.messages, [{ role: "user", content: [{ type: "text", text: "Mark this answer." }] }]);
  });

  it("lowers the answer's cap to max_output when asked (a step of a lesson), and never raises it", async () => {
    saveConfig({ provider: "anthropic", model: "claude-sonnet-5-5", effort: "high" });
    writeKey("ANTHROPIC_API_KEY", "sk-ant-test");
    const cap = async (body: Record<string, unknown>) => {
      const up = recorder(() => new Response(textAnswer, { status: 200, headers: { "content-type": "text/event-stream" } }));
      await events(await guarded(learnHandler({ fetch: up.fetch }))(request(body)));
      return up.seen.body!.max_tokens as number;
    };
    const roomy = await cap({ input: "Write a board.", json: true });
    assert.equal(await cap({ input: "Write a board.", json: true, max_output: 3000 }), 3000);
    assert.equal(await cap({ input: "Write a board.", json: true, max_output: 32_000 }), Math.min(roomy, 32_000));
    const bad = await guarded(learnHandler())(request({ input: "x", max_output: 10 }));
    assert.equal(bad.status, 400);
  });

  it("follows a switch in Settings to another provider and classifies its failure onto the stream", async () => {
    saveConfig({ provider: "deepseek", model: "deepseek-v4-pro" });
    writeKey("DEEPSEEK_API_KEY", "sk-test-deepseek");
    const up = recorder(() => new Response(JSON.stringify({ error: { message: "Authentication Fails, invalid api key" } }), { status: 401, headers: { "content-type": "application/json" } }));
    const evs = await events(await guarded(learnHandler({ fetch: up.fetch }))(request({ input: [{ role: "user", content: "Teach me recursion." }] })));
    assert.equal(evs.length, 1);
    const err = evs[0].type === "error" ? evs[0].error : null;
    assert.equal(err?.code, "invalid_key");
    assert.equal(err?.provider, "deepseek");
    assert.match(up.seen.url ?? "", /^https:\/\/api\.deepseek\.com\//);
    assert.equal(up.seen.body?.model, "deepseek-v4-pro");
    assert.equal(up.seen.body?.tools, undefined);
  });
});
