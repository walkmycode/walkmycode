// Cost metering: normaliseUsage (the SDK's usage in Anthropic field names,
// input_tokens always the uncached count) and the meter built on it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LanguageModelUsage } from "ai";
import { normaliseUsage } from "../src/lib/providers/sdk";
import { addUsage, COST_TITLE, costOf, formatCost, priceFor, readCost, resetCost } from "../src/lib/cost";
import { PROVIDERS } from "../src/lib/providers/catalogue";
import type { Usage } from "../src/lib/providers/wire";

function usage(partial: { input?: number; noCache?: number; cacheRead?: number; cacheWrite?: number; output?: number; reasoning?: number }): LanguageModelUsage {
  return {
    inputTokens: partial.input,
    inputTokenDetails: { noCacheTokens: partial.noCache, cacheReadTokens: partial.cacheRead, cacheWriteTokens: partial.cacheWrite },
    outputTokens: partial.output,
    outputTokenDetails: { textTokens: undefined, reasoningTokens: partial.reasoning },
    totalTokens: undefined,
  };
}

describe("normaliseUsage", () => {
  it("uses noCacheTokens when the provider reports it (Anthropic shape: total = uncached + cache read + cache write)", () => {
    const u = normaliseUsage(usage({ input: 1000, noCache: 100, cacheRead: 800, cacheWrite: 100, output: 50, reasoning: 20 }));
    assert.deepEqual(u, { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 800, cache_creation_input_tokens: 100, reasoning_tokens: 20, known: true });
  });

  it("subtracts the cache counts from the total when noCacheTokens is absent (OpenAI shape: prompt_tokens includes cached)", () => {
    const u = normaliseUsage(usage({ input: 1000, cacheRead: 900, output: 30 }));
    assert.equal(u.input_tokens, 100);
    assert.equal(u.cache_read_input_tokens, 900);
    assert.equal(u.cache_creation_input_tokens, 0);
    assert.equal(u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens, 1000);
  });

  it("never goes negative when a provider reports odd numbers", () => {
    assert.equal(normaliseUsage(usage({ input: 10, cacheRead: 50 })).input_tokens, 0);
  });

  it("reports known:false and zeros for missing usage (cut stream, local server)", () => {
    assert.deepEqual(normaliseUsage(undefined), { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_tokens: 0, known: false });
    assert.equal(normaliseUsage(usage({})).known, false);
  });

  it("counts usage as known when either side is reported", () => {
    assert.equal(normaliseUsage(usage({ output: 5 })).known, true);
    assert.equal(normaliseUsage(usage({ input: 5 })).known, true);
    assert.equal(normaliseUsage(usage({ input: 0, output: 0 })).known, true);
  });

  it("keeps reasoning tokens inside output_tokens and reports them separately", () => {
    const u = normaliseUsage(usage({ input: 10, output: 500, reasoning: 400 }));
    assert.equal(u.output_tokens, 500);
    assert.equal(u.reasoning_tokens, 400);
  });
});

// The meter itself: which price a call gets, that cache tokens are billed
// once, the dearest-price fallback, and the unknown/approx counters.

describe("priceFor", () => {
  it("matches exact ids, then dated echoes by prefix", () => {
    assert.equal(priceFor("anthropic", "claude-opus-5-5").price, PROVIDERS.anthropic.models[0].price);
    assert.equal(priceFor("anthropic", "claude-opus-5-5").approx, false);
    assert.equal(priceFor("openai", "gpt-6.1-sol-2026-09-01").price, PROVIDERS.openai.models[0].price);
  });

  it("falls back to the dearest price on a cloud provider, flagged approx, never free", () => {
    const r = priceFor("openai", "gpt-7-preview");
    assert.equal(r.approx, true);
    assert.equal(r.price, PROVIDERS.openai.models.find((m) => m.id === "gpt-6-astra")!.price);
    const a = priceFor("anthropic", "claude-unlisted-9"); // a model the catalogue does not list yet
    assert.equal(a.approx, true);
    assert.equal(a.price?.in, 10); // the dearest listed Claude (Fable 5.1 / 5)
  });

  it("prices local models as unknown", () => {
    assert.deepEqual(priceFor("local", "llama3.3"), { price: null, approx: false });
  });
});

describe("costOf", () => {
  const u: Usage = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000, reasoning_tokens: 500_000, known: true };

  it("bills each bucket once at its own rate", () => {
    assert.equal(costOf({ in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 }, u), 29.2);
  });

  it("defaults cache rates to the input rate and keeps reasoning inside output", () => {
    assert.equal(costOf({ in: 2, out: 10 }, u), 16);
  });
});

describe("addUsage", () => {
  const known: Usage = { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_tokens: 0, known: true };

  it("sums priced calls and counts cache hits", () => {
    resetCost();
    addUsage("anthropic", "claude-opus-5-5", known);
    addUsage("anthropic", "claude-opus-5-5", { ...known, input_tokens: 0, cache_read_input_tokens: 1_000_000 });
    const t = readCost();
    assert.equal(t.usd, 4.2);
    assert.equal(t.calls, 2);
    assert.equal(t.cacheHits, 1);
    assert.equal(t.unknown, 0);
    assert.equal(t.approx, false);
    assert.equal(formatCost(t), "$4.200 · 2 calls");
  });

  it("counts unpriced calls (local, no usage) and flags approximate prices", () => {
    resetCost();
    addUsage("local", "llama3.3", known);
    addUsage("anthropic", "claude-opus-5-5", { ...known, known: false });
    let t = readCost();
    assert.equal(t.usd, 0);
    assert.equal(t.unknown, 2);
    assert.equal(formatCost(t), "$0.000 · 2 calls · 2 unpriced");

    addUsage("openai", "gpt-7-preview", known);
    t = readCost();
    assert.equal(t.approx, true);
    assert.equal(t.usd, 10);
    assert.equal(formatCost(t), "≈$10.000 · 3 calls · 2 unpriced");

    resetCost();
    addUsage("anthropic", "claude-sonnet-5-5", known);
    assert.equal(readCost().approx, true, "an unverified price counts as approximate");
  });

  it("names its assumptions in the pill title", () => {
    assert.match(COST_TITLE, /unpriced/);
  });
});
