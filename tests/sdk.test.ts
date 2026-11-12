// The SDK seam without keys: the reasoning table, tool and system shapes,
// the call options, and one real streamText round trip through an injected
// fetch that captures what would go over the wire to Anthropic.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PROVIDER_IDS, PROVIDERS } from "../src/lib/providers/catalogue";
import { callOptions, makeModel, normaliseUsage, reasoningOptions, stepCountIs, streamText, systemMessages, toSdkTools } from "../src/lib/providers/sdk";
import type { Resolved } from "../src/lib/providers/wire";

const SUMMARY = "# Repo: demo\nAreas (packages): app\n3 files, 3 in the map, 1 routes, 0 tables, 2 links (0 guesses).";

describe("reasoningOptions", () => {
  it("follows the table in docs/PROVIDERS.md §4", () => {
    assert.deepEqual(reasoningOptions("anthropic", "claude-opus-5-5", "low"), { anthropic: { effort: "low", thinking: { type: "adaptive" }, fallbacks: "default" } });
    assert.deepEqual(reasoningOptions("anthropic", "claude-sonnet-5-5", "high"), { anthropic: { effort: "high", thinking: { type: "adaptive" }, fallbacks: "default" } });
    assert.deepEqual(reasoningOptions("anthropic", "claude-haiku-4-5", "low"), { anthropic: { thinking: { type: "enabled", budgetTokens: 2048 }, fallbacks: "default" } });
    assert.deepEqual(reasoningOptions("anthropic", "claude-haiku-4-5", "medium"), { anthropic: { thinking: { type: "enabled", budgetTokens: 6000 }, fallbacks: "default" } });
    assert.deepEqual(reasoningOptions("anthropic", "claude-haiku-4-5", "high"), { anthropic: { thinking: { type: "enabled", budgetTokens: 12000 }, fallbacks: "default" } });
    // Fable thinks adaptively only; the fallback goes only where it is documented.
    assert.deepEqual(reasoningOptions("anthropic", "claude-fable-5-2", "high"), { anthropic: { effort: "high", thinking: { type: "adaptive" }, fallbacks: "default" } });
    assert.deepEqual(reasoningOptions("anthropic", "claude-opus-5", "medium"), { anthropic: { effort: "medium", thinking: { type: "adaptive" }, fallbacks: "default" } });
    assert.deepEqual(reasoningOptions("anthropic", "claude-haiku-5-5", "low"), { anthropic: { effort: "low", thinking: { type: "adaptive" } } });
    assert.deepEqual(reasoningOptions("anthropic", "claude-opus-4-8", "high"), { anthropic: { effort: "high", thinking: { type: "adaptive" } } });
    assert.deepEqual(reasoningOptions("openai", "gpt-6.1-sol", "low"), { openai: { reasoningEffort: "low" } });
    assert.deepEqual(reasoningOptions("openai", "gpt-6-astra", "medium"), { openai: { reasoningEffort: "medium" } });
    assert.deepEqual(reasoningOptions("openai", "gpt-6-luna", "low"), { openai: { reasoningEffort: "none" } });
    assert.deepEqual(reasoningOptions("openai", "gpt-6-luna", "medium"), { openai: { reasoningEffort: "low" } });
    assert.deepEqual(reasoningOptions("openai", "gpt-5.4-mini", "high"), { openai: { reasoningEffort: "high" } });
    assert.deepEqual(reasoningOptions("gemini", "gemini-3.8-flash", "medium"), { google: { thinkingConfig: { thinkingLevel: "medium" } } });
    assert.deepEqual(reasoningOptions("groq", "openai/gpt-oss-120b", "high"), { groq: { reasoningEffort: "high" } });
    assert.deepEqual(reasoningOptions("groq", "llama-3.3-70b-versatile", "high"), {});
    assert.deepEqual(reasoningOptions("deepseek", "deepseek-flash", "low"), { deepseek: { thinking: { type: "disabled" } } });
    assert.deepEqual(reasoningOptions("deepseek", "deepseek-flash", "medium"), { deepseek: { thinking: { type: "enabled" }, reasoningEffort: "low" } });
    assert.deepEqual(reasoningOptions("deepseek", "deepseek-v4-pro", "high"), { deepseek: { thinking: { type: "enabled" }, reasoningEffort: "high" } });
    assert.deepEqual(reasoningOptions("xai", "grok-4.3", "low"), { xai: { reasoningEffort: "low" } });
    assert.deepEqual(reasoningOptions("local", "llama3.3", "high"), {});
  });

  it("never sends 'none' or 'minimal' to the OpenAI models that 400 on it", () => {
    for (const m of ["gpt-6-astra", "gpt-6.1-sol", "gpt-6.1-sol-2026-09-01"]) {
      for (const e of ["low", "medium", "high"] as const) {
        const v = (reasoningOptions("openai", m, e).openai as { reasoningEffort: string }).reasoningEffort;
        assert.ok(v !== "none" && v !== "minimal", `${m} ${e} → ${v}`);
      }
    }
  });
});

describe("toSdkTools", () => {
  it("declares every tool without execute, in ask and tour mode", () => {
    for (const id of PROVIDER_IDS) {
      const ask = toSdkTools("ask", id);
      const tour = toSdkTools("tour", id);
      assert.deepEqual(Object.keys(ask), ["read_file", "search", "query_map", "list_files", "fly_step"]);
      assert.deepEqual(Object.keys(tour), ["read_file", "search", "query_map", "list_files", "fly_step", "finish_tour"]);
      for (const t of Object.values(tour)) {
        assert.equal("execute" in t && t.execute !== undefined, false, `${id} tool has execute`);
        assert.ok(t.description);
        assert.ok(t.inputSchema);
      }
    }
  });

  it("sends strict only on finish_tour and only for providers with strict_tools", () => {
    for (const id of PROVIDER_IDS) {
      const tour = toSdkTools("tour", id);
      for (const [name, t] of Object.entries(tour)) {
        const expected = name === "finish_tour" && PROVIDERS[id].strict_tools ? true : undefined;
        assert.equal(t.strict, expected, `${id}/${name}`);
      }
    }
    assert.equal(toSdkTools("tour", "anthropic").finish_tour.strict, true);
    assert.equal(toSdkTools("tour", "openai").finish_tour.strict, true);
    assert.equal(toSdkTools("tour", "gemini").finish_tour.strict, undefined);
  });

  it("puts the Anthropic cache breakpoint on the last tool only", () => {
    const cache = { anthropic: { cacheControl: { type: "ephemeral" } } };
    const ask = toSdkTools("ask", "anthropic");
    assert.deepEqual(ask.fly_step.providerOptions, cache);
    assert.equal(ask.read_file.providerOptions, undefined);
    const tour = toSdkTools("tour", "anthropic");
    assert.deepEqual(tour.finish_tour.providerOptions, cache);
    assert.equal(tour.fly_step.providerOptions, undefined);
    for (const id of PROVIDER_IDS.filter((p) => p !== "anthropic")) {
      for (const t of Object.values(toSdkTools("tour", id))) assert.equal(t.providerOptions, undefined, id);
    }
  });
});

describe("systemMessages", () => {
  it("is always [SYSTEM(+TOUR_ADDENDUM), mapSummary] in that order, capped at 60k", () => {
    const ask = systemMessages("ask", SUMMARY, "openai");
    assert.equal(ask.length, 2);
    assert.ok(ask[0].content.startsWith("You are WalkMyCode"));
    assert.ok(!ask[0].content.includes("guided tour"));
    assert.equal(ask[1].content, SUMMARY);
    const tour = systemMessages("tour", "x".repeat(70_000), "openai");
    assert.ok(tour[0].content.includes("build a guided tour"));
    assert.equal(tour[1].content.length, 60_000);
  });

  it("marks both messages as cache breakpoints for Anthropic and nothing else", () => {
    for (const m of systemMessages("ask", SUMMARY, "anthropic")) assert.deepEqual(m.providerOptions, { anthropic: { cacheControl: { type: "ephemeral" } } });
    for (const id of PROVIDER_IDS.filter((p) => p !== "anthropic")) {
      for (const m of systemMessages("ask", SUMMARY, id)) assert.equal(m.providerOptions, undefined, id);
    }
  });
});

describe("callOptions", () => {
  const r = (provider: Resolved["provider"], model: string, effort: Resolved["effort"] = "medium"): Resolved => ({ provider, model, effort });

  it("sets toolChoice auto, the model's output cap, and never a temperature", () => {
    const o = callOptions(r("anthropic", "claude-opus-5-5"), SUMMARY);
    assert.equal(o.toolChoice, "auto");
    assert.equal(o.maxOutputTokens, 8000);
    assert.equal(o.allowSystemInMessages, true);
    assert.ok(!("temperature" in o) && !("topP" in o));
    assert.equal(callOptions(r("openai", "gpt-6-luna"), SUMMARY).maxOutputTokens, 16000);
    assert.equal(callOptions(r("local", "llama3.3"), SUMMARY).maxOutputTokens, 8000);
  });

  it("adds store:false, the encrypted-reasoning include and a stable cache key for OpenAI", () => {
    const o = callOptions(r("openai", "gpt-6.1-sol", "high"), SUMMARY).providerOptions.openai;
    assert.equal(o.store, false);
    assert.deepEqual(o.include, ["reasoning.encrypted_content"]);
    assert.equal(o.reasoningEffort, "high");
    assert.match(String(o.promptCacheKey), /^lantern:[0-9a-f]{40}$/);
    assert.equal(o.promptCacheKey, callOptions(r("openai", "gpt-6-luna"), SUMMARY).providerOptions.openai.promptCacheKey);
    assert.notEqual(o.promptCacheKey, callOptions(r("openai", "gpt-6.1-sol"), SUMMARY + "\nmore").providerOptions.openai.promptCacheKey);
  });

  it("keys a workspace summary by the workspace's name, not its counts", () => {
    const key = (s: string) => callOptions(r("openai", "gpt-6-luna"), s).providerOptions.openai.promptCacheKey;
    const a = "# Workspace: shop (2 repos: web, api) — 3 services (docker-compose.yml), 7 links (2 guesses)\n";
    assert.equal(key(a), key(a.replace("7 links", "8 links")), "same name and length, same key");
    assert.notEqual(key(a), key(a.replace("shop", "shoe")), "another workspace, another key");
  });

  it("adds store:false for xAI (the SDK adds the include itself), and nothing extra elsewhere", () => {
    const x = callOptions(r("xai", "grok-4.7", "low"), SUMMARY).providerOptions.xai;
    assert.deepEqual(x, { reasoningEffort: "low", store: false });
    assert.deepEqual(callOptions(r("groq", "llama-3.3-70b-versatile"), SUMMARY).providerOptions, {});
    assert.deepEqual(callOptions(r("deepseek", "deepseek-flash", "low"), SUMMARY).providerOptions, { deepseek: { thinking: { type: "disabled" } } });
  });
});

describe("makeModel", () => {
  const resolved: Resolved = { provider: "anthropic", model: "claude-opus-5-5", effort: "medium" };

  it("caches by provider, model, key and base_url, and never caches an injected fetch", () => {
    const a = makeModel(resolved, "sk-ant-a");
    assert.equal(makeModel(resolved, "sk-ant-a"), a);
    assert.notEqual(makeModel(resolved, "sk-ant-b"), a);
    assert.notEqual(makeModel({ ...resolved, model: "claude-haiku-4-5" }, "sk-ant-a"), a);
    const f: typeof fetch = async () => new Response();
    assert.notEqual(makeModel(resolved, "sk-ant-a", f), makeModel(resolved, "sk-ant-a", f));
    const local = makeModel({ provider: "local", model: "llama3.3", effort: "low", base_url: "http://localhost:1234/v1" }, "local") as { provider: string };
    assert.equal(local.provider, "local.chat");
  });

  it("puts the Anthropic wire shape from §4 on the request and reads the stream back", async () => {
    const frames = [
      ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 20, output_tokens: 1 } } }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } }],
      ["message_stop", { type: "message_stop" }],
    ] as const;
    const sse = frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");

    const seen: { req?: { url: string; headers: Headers; body: Record<string, unknown> } } = {};
    const fakeFetch: typeof fetch = async (input, init) => {
      seen.req = { url: String(input), headers: new Headers(init?.headers as HeadersInit), body: JSON.parse(String(init?.body)) };
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
    };

    const result = streamText({
      model: makeModel(resolved, "sk-ant-test", fakeFetch),
      tools: toSdkTools("tour", "anthropic"),
      messages: [...systemMessages("tour", SUMMARY, "anthropic"), { role: "user", content: "Where does sign-in happen?" }],
      stopWhen: stepCountIs(1),
      ...callOptions(resolved, SUMMARY),
    });
    assert.equal(await result.text, "Hello");
    assert.equal(await result.finishReason, "stop");
    assert.deepEqual(normaliseUsage(await result.usage), { input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 20, cache_creation_input_tokens: 5, reasoning_tokens: 0, known: true });

    assert.ok(seen.req, "fetch was called");
    const { url, headers, body } = seen.req;
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    assert.equal(headers.get("x-api-key"), "sk-ant-test");
    assert.match(headers.get("anthropic-beta") ?? "", /server-side-fallback-2026-07-01/);

    assert.equal(body.model, "claude-opus-5-5");
    assert.equal(body.max_tokens, 8000);
    assert.equal(body.stream, true);
    assert.equal(body.temperature, undefined);
    assert.equal(body.top_p, undefined);
    assert.deepEqual(body.tool_choice, { type: "auto" });
    assert.equal(body.fallbacks, "default");
    assert.deepEqual(body.thinking, { type: "adaptive" });
    assert.deepEqual(body.output_config, { effort: "medium" });

    const system = body.system as { text: string; cache_control?: unknown }[];
    assert.equal(system.length, 2);
    assert.ok(system[0].text.startsWith("You are WalkMyCode"));
    assert.equal(system[1].text, SUMMARY);
    for (const s of system) assert.deepEqual(s.cache_control, { type: "ephemeral" });

    const tools = body.tools as { name: string; input_schema: unknown; strict?: boolean; cache_control?: unknown }[];
    assert.deepEqual(
      tools.map((t) => t.name),
      ["read_file", "search", "query_map", "list_files", "fly_step", "finish_tour"],
    );
    assert.ok(tools.every((t) => t.input_schema));
    assert.deepEqual(tools[5].cache_control, { type: "ephemeral" });
    assert.ok(tools.slice(0, 5).every((t) => t.cache_control === undefined));
    assert.equal(tools[5].strict, true);
    assert.ok(tools.slice(0, 5).every((t) => t.strict === undefined));
  });
});
