// Setting up the AI just in time (docs/design/home-redesign.html screens 1–2):
// the top bar's pill from readiness (src/lib/aiPill.ts), the guide's hook that
// opens the setup sheet once, and the sheet's option logic (src/lib/setupOptions.ts).
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { aiNeeded, isNotReady, modelName, pillState, resetAiNeeded, type AiConfig } from "../src/lib/aiPill";
import { friendly } from "../src/lib/providers/errors";
import { PROVIDER_IDS, PROVIDERS } from "../src/lib/providers/catalogue";
import { aboutCost, continueStep, explainCost, firstChoice, keyChips, keyPlaceholder, keyWarning, keyWorksLine, localBadge, startModel } from "../src/lib/setupOptions";

/** GET /api/config's shape, from the real catalogue. */
function config(o: { provider?: string; model?: string; source?: AiConfig["source"]; llm?: AiConfig["readiness"]["llm"] } = {}): AiConfig {
  return {
    saved: { provider: o.provider ?? "anthropic", model: o.model ?? "claude-opus-5-5", effort: "medium", local_base_url: "http://localhost:11434/v1" },
    source: o.source ?? "config",
    llm_providers: PROVIDER_IDS.map((id) => {
      const p = PROVIDERS[id];
      return { id, label: p.label, env: p.env, has_key: false, models: p.models.map((m) => ({ id: m.id, label: m.label })), models_freeform: !!p.models_freeform, default_model: p.default_model, url: p.url, base_url: p.base_url ?? null };
    }),
    readiness: { llm: o.llm ?? null },
  };
}

describe("the AI pill", () => {
  it("waits quietly while /api/config is asked", () => {
    assert.deepEqual(pillState({ state: "loading" }), { kind: "loading" });
  });

  it("says AI · the model's name when readiness passes", () => {
    const p = pillState({ state: "ok", config: config() });
    assert.equal(p.kind, "ready");
    assert.equal(p.kind === "ready" && p.model, "Claude Opus 5.5");
    assert.match(p.kind === "ready" ? p.title : "", /your Anthropic key/);
  });

  it("asks to set up AI when readiness does not pass, saying why", () => {
    const p = pillState({ state: "ok", config: config({ llm: friendly("missing_key", { provider: "anthropic" }) }) });
    assert.equal(p.kind, "setup");
    assert.match(p.kind === "setup" ? p.title : "", /Anthropic \(Claude\) API key missing/);
  });

  it("asks to set up AI when the server cannot be reached", () => {
    assert.equal(pillState({ state: "failed", message: "Offline." }).kind, "setup");
  });

  it("names a local model by its id, and a vendor's dated echo by its catalogue name", () => {
    assert.equal(modelName(config({ provider: "local", model: "llama3.1:8b" })), "llama3.1:8b");
    assert.equal(modelName(config({ provider: "openai", model: "gpt-6.1-sol-2026-09-01" })), "GPT-6.1 Sol");
    assert.equal(modelName(config({ provider: "local", model: "" })), "Local (Ollama / LM Studio)");
    const local = pillState({ state: "ok", config: config({ provider: "local", model: "qwen3:14b" }) });
    assert.match(local.kind === "ready" ? local.title : "", /a model on this computer/);
  });
});

describe("the guide's hook", () => {
  beforeEach(() => resetAiNeeded());

  it("knows the errors that mean no AI is set up yet", () => {
    assert.equal(isNotReady(friendly("no_model")), true);
    assert.equal(isNotReady(friendly("missing_key", { provider: "openai" })), true);
    assert.equal(isNotReady(friendly("model_unavailable", { provider: "groq" })), true);
    assert.equal(isNotReady(friendly("network", { provider: "local" })), true);
    assert.equal(isNotReady(friendly("network", { provider: "anthropic" })), false, "a cloud provider out of reach is not a setup problem");
    assert.equal(isNotReady(friendly("invalid_key", { provider: "anthropic" })), false);
    assert.equal(isNotReady(friendly("rate_limited")), false);
    assert.equal(isNotReady(null), false);
  });

  it("opens the setup sheet the first time only", () => {
    const opened: string[] = [];
    const open = (e: { code: string }) => opened.push(e.code);
    assert.equal(aiNeeded(friendly("rate_limited"), open), false);
    assert.equal(aiNeeded(friendly("missing_key", { provider: "anthropic" }), open), true);
    assert.equal(aiNeeded(friendly("missing_key", { provider: "anthropic" }), open), false);
    assert.deepEqual(opened, ["missing_key"]);
  });
});

describe("the setup sheet's options", () => {
  it("offers a chip for every provider that takes a key, with its letter, in catalogue order", () => {
    const chips = keyChips();
    assert.deepEqual(
      chips.map((c) => `${c.mark} ${c.name}`),
      ["A Claude", "O OpenAI", "G Gemini", "Q Groq", "D DeepSeek", "X xAI"],
    );
    assert.ok(chips.every((c) => c.env && c.url.startsWith("https://")));
    assert.ok(!chips.some((c) => c.id === "local"), "the local model is its own option");
  });

  it("opens on the recommended option until something was chosen, then on what was chosen", () => {
    assert.deepEqual(firstChoice(null), { option: "claude", provider: "anthropic" });
    assert.deepEqual(firstChoice(config({ source: "default" })), { option: "claude", provider: "anthropic" });
    assert.deepEqual(firstChoice(config({ provider: "groq", model: "openai/gpt-oss-120b" })), { option: "key", provider: "groq" });
    assert.deepEqual(firstChoice(config({ provider: "local", model: "llama3.1:8b", source: "env" })), { option: "local", provider: "anthropic" });
  });

  it("starts a provider on the saved model, else its default", () => {
    assert.equal(startModel(config({ provider: "anthropic", model: "claude-haiku-4-5" }), "anthropic"), "claude-haiku-4-5");
    assert.equal(startModel(config({ provider: "anthropic", model: "claude-haiku-4-5" }), "openai"), "gpt-6.1-sol");
    assert.equal(startModel(null, "gemini"), "gemini-3.8-flash");
  });

  it("prices one explanation from the catalogue (about $0.05 on Opus 5.5)", () => {
    assert.equal(aboutCost(explainCost("anthropic", "claude-opus-5-5")), "about $0.05 an explanation");
    assert.equal(aboutCost(explainCost("openai", "gpt-6-luna")), "under a cent an explanation");
    assert.equal(explainCost("local", "llama3.1:8b"), null);
    assert.equal(aboutCost(null), "free");
    assert.equal(keyWorksLine("Claude Opus 5.5", explainCost("anthropic", "claude-opus-5-5")), "✓ Key works · Claude Opus 5.5 · about $0.05 an explanation");
  });

  it("warns, without blocking, when a pasted key looks like another provider's", () => {
    assert.equal(keyWarning("anthropic", "sk-ant-api03-abcdef"), null);
    assert.equal(keyWarning("anthropic", "  "), null);
    assert.equal(keyWarning("openai", "sk-ant-api03-abcdef"), "That looks like a Claude key, not an OpenAI one.");
    assert.equal(keyWarning("anthropic", "gsk_abcdef"), "That looks like a Groq key, not a Claude one.");
    assert.equal(keyWarning("anthropic", "sk-proj-abcdef"), "That looks like an OpenAI or DeepSeek key, not a Claude one.");
    assert.equal(keyWarning("deepseek", "sk-abcdef"), null, "OpenAI and DeepSeek keys start alike");
    assert.equal(keyWarning("groq", "xai-abcdef"), "That looks like an xAI key, not a Groq one.");
    assert.equal(keyWarning("gemini", "abcdef"), "Gemini keys usually start with AIza");
    assert.match(keyWarning("anthropic", "sk-ant-abc\ndef") ?? "", /line break/);
    assert.equal(keyPlaceholder("anthropic"), "sk-ant-…");
  });

  it("says Ollama found once the local server lists its models", () => {
    assert.equal(localBadge("http://localhost:11434/v1", ["llama3.1:8b"]), "Ollama found");
    assert.equal(localBadge("http://localhost:1234/v1", ["qwen3"]), "LM Studio found");
    assert.equal(localBadge("http://10.0.0.2:8080/v1", ["m"]), "Local server found");
    assert.equal(localBadge("http://localhost:11434/v1", []), null);
  });

  it("closes on the subscription, saves a key or a local model, and waits for what is missing", () => {
    assert.deepEqual(continueStep({ option: "claude", keyTyped: false, hasKey: false, model: "" }), { step: "save" });
    assert.deepEqual(continueStep({ option: "key", keyTyped: true, hasKey: false, model: "claude-opus-5-5" }), { step: "save" });
    assert.deepEqual(continueStep({ option: "key", keyTyped: false, hasKey: true, model: "claude-opus-5-5" }), { step: "save" });
    assert.equal(continueStep({ option: "key", keyTyped: false, hasKey: false, model: "claude-opus-5-5" }).step, "blocked");
    assert.deepEqual(continueStep({ option: "local", keyTyped: false, hasKey: false, model: "llama3.1:8b" }), { step: "save" });
    assert.equal(continueStep({ option: "local", keyTyped: false, hasKey: false, model: " " }).step, "blocked");
  });
});
