// classify() and scrub(): every status and body the spec names must land on
// the right code with the right copy, and nothing key-shaped may leak out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classify, friendly, scrub } from "../src/lib/providers/errors";

/** A plain object shaped like the SDK's APICallError; classify() only reads these fields. */
function apiError(statusCode: number | undefined, responseBody = "", message = `Failed with ${statusCode}`) {
  return { name: "AI_APICallError", statusCode, responseBody, message, url: "https://example.invalid", requestBodyValues: {}, isRetryable: false };
}

describe("classify", () => {
  it("maps 401 to invalid_key with the settings action", () => {
    const fe = classify(apiError(401, '{"error":{"message":"Invalid API key"}}'), "openai");
    assert.equal(fe.code, "invalid_key");
    assert.equal(fe.title, "OpenAI rejected the API key");
    assert.equal(fe.message, "The key may be mistyped, revoked or expired. Paste a fresh key in Settings.");
    assert.equal(fe.action, "settings");
    assert.equal(fe.provider, "openai");
    assert.equal(fe.status, 401);
  });

  it("maps 403 to invalid_key", () => {
    assert.equal(classify(apiError(403, "forbidden"), "gemini").code, "invalid_key");
  });

  it("maps an authentication message without a status to invalid_key", () => {
    assert.equal(classify(new Error("authentication_error: x-api-key header is required"), "anthropic").code, "invalid_key");
  });

  it("maps 402 to out_of_credits", () => {
    const fe = classify(apiError(402, "Payment required"), "anthropic");
    assert.equal(fe.code, "out_of_credits");
    assert.equal(fe.title, "Anthropic (Claude) account is out of credits");
    assert.equal(fe.message, "Top up your Anthropic (Claude) balance, or switch to another provider in Settings.");
    assert.equal(fe.action, "settings");
  });

  it("maps a 'credit balance' body to out_of_credits whatever the status", () => {
    const fe = classify(apiError(400, '{"error":{"message":"Your credit balance is too low to access the Anthropic API."}}'), "anthropic");
    assert.equal(fe.code, "out_of_credits");
  });

  it("maps OpenAI's 429 insufficient_quota to out_of_credits, not rate_limited", () => {
    assert.equal(classify(apiError(429, '{"error":{"code":"insufficient_quota"}}'), "openai").code, "out_of_credits");
  });

  it("maps a plain 429 to rate_limited with the retry action", () => {
    const fe = classify(apiError(429, '{"error":{"message":"Rate limit reached"}}'), "groq");
    assert.equal(fe.code, "rate_limited");
    assert.equal(fe.title, "Groq is busy right now");
    assert.equal(fe.message, "Too many requests or a temporary quota limit. Wait a moment and try again.");
    assert.equal(fe.action, "retry");
  });

  it("maps 404 to model_unavailable", () => {
    const fe = classify(apiError(404, '{"error":{"message":"The model `gpt-7` does not exist"}}'), "openai");
    assert.equal(fe.code, "model_unavailable");
    assert.equal(fe.title, "OpenAI can't use this model");
    assert.equal(fe.message, "Pick a different model in Settings.");
    assert.equal(fe.action, "settings");
  });

  it("maps a 'model not found' body on another status to model_unavailable", () => {
    assert.equal(classify(apiError(400, '{"error":{"message":"model: llama3 not found, try pulling it first"}}'), "local").code, "model_unavailable");
    assert.equal(classify(apiError(400, "unknown model deepseek-chat"), "deepseek").code, "model_unavailable");
  });

  it("maps connection failures to network", () => {
    const fe = classify(new TypeError("fetch failed"), "openai");
    assert.equal(fe.code, "network");
    assert.equal(fe.title, "Can't reach OpenAI");
    assert.match(fe.message, /^Check your internet connection\./);
    const local = classify(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:11434"), { code: "ECONNREFUSED" }), "local", "http://localhost:11434/v1");
    assert.equal(local.code, "network");
    assert.match(local.message, /http:\/\/localhost:11434\/v1/);
  });

  it("follows a wrapped cause down to the connection error", () => {
    const inner = Object.assign(new Error("getaddrinfo ENOTFOUND api.x.ai"), { code: "ENOTFOUND" });
    const outer = Object.assign(new Error("Cannot connect to API"), { cause: inner });
    assert.equal(classify(outer, "xai").code, "network");
  });

  it("follows a RetryError's lastError", () => {
    const retry = { name: "AI_RetryError", message: "Failed after 3 attempts", lastError: apiError(429), errors: [] };
    assert.equal(classify(retry, "openai").code, "rate_limited");
  });

  it("maps a 5xx to unknown with the body as detail and the retry action", () => {
    const fe = classify(apiError(503, '{"error":{"type":"overloaded_error","message":"Overloaded"}}'), "anthropic");
    assert.equal(fe.code, "unknown");
    assert.equal(fe.title, "Anthropic (Claude) request failed");
    assert.equal(fe.action, "retry");
    assert.equal(fe.status, 503);
    assert.equal(fe.detail, '{"error":{"type":"overloaded_error","message":"Overloaded"}}');
  });

  it("caps detail at 300 characters and scrubs keys out of it", () => {
    const fe = classify(apiError(500, "bad key sk-proj-abcdefghijklmnop " + "x".repeat(400)), "openai");
    assert.equal(fe.detail?.length, 300);
    assert.ok(fe.detail?.startsWith("bad key [key] "));
    assert.ok(!fe.detail?.includes("sk-proj"));
  });

  it("falls back to the message as detail when there is no body", () => {
    const fe = classify(new Error("Something odd happened"), "deepseek");
    assert.equal(fe.code, "unknown");
    assert.equal(fe.detail, "Something odd happened");
  });

  it("copes with non-error values", () => {
    assert.equal(classify("boom", "openai").code, "unknown");
    assert.equal(classify(undefined, "openai").code, "unknown");
    assert.equal(classify(null, "openai").code, "unknown");
  });
});

describe("friendly", () => {
  it("writes the readiness copy for missing_key with the label and env var", () => {
    const fe = friendly("missing_key", { provider: "groq" });
    assert.equal(fe.title, "Groq API key missing");
    assert.equal(fe.message, "Add your Groq key in Settings → Language model, or put GROQ_API_KEY in .env.local.");
    assert.equal(fe.action, "settings");
  });

  it("writes the local-server copy for network on the local provider", () => {
    const fe = friendly("network", { provider: "local", base_url: "http://localhost:1234/v1" });
    assert.equal(fe.title, "Can't reach your local server");
    assert.equal(fe.message, "Nothing answered at http://localhost:1234/v1. Start Ollama or LM Studio and try again.");
    assert.equal(fe.action, "settings");
  });

  it("writes stale_history and forbidden as the spec has them", () => {
    const stale = friendly("stale_history", { provider: "xai" });
    assert.equal(stale.title, "Settings changed");
    assert.equal(stale.message, "You switched provider mid-conversation. Ask again to start a fresh conversation on xAI (Grok).");
    assert.equal(stale.action, "retry");
    const forbidden = friendly("forbidden");
    assert.equal(forbidden.title, "Settings can only be changed from this computer");
    assert.equal(forbidden.message, "Open WalkMyCode at http://localhost:3000 to change keys or ask questions.");
    assert.equal(forbidden.action, null);
    assert.equal(forbidden.provider, undefined);
  });

  it("writes no_model with the settings action", () => {
    const fe = friendly("no_model");
    assert.equal(fe.title, "No AI model selected");
    assert.equal(fe.action, "settings");
  });
});

describe("scrub", () => {
  it("replaces every key-shaped string with [key]", () => {
    const text = [
      "openai sk-proj-AbCdEfGhIjKlMnOpQrStUv",
      "groq gsk_AbCdEfGhIjKlMnOpQrStUv",
      "xai xai-AbCdEfGhIjKlMnOpQrStUv",
      "gemini AIzaSyAbCdEfGhIjKlMnOpQrStUv",
      "anthropic sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv",
    ].join("\n");
    const out = scrub(text);
    assert.equal(out, "openai [key]\ngroq [key]\nxai [key]\ngemini [key]\nanthropic [key]");
  });

  it("leaves ordinary text and short tokens alone", () => {
    assert.equal(scrub("skip this task"), "skip this task");
    assert.equal(scrub("sk-short"), "sk-short");
    assert.equal(scrub("The model gpt-6.1-sol returned 400"), "The model gpt-6.1-sol returned 400");
  });
});
