// The saved choice: precedence (config.json > WALKMYCODE_* > default),
// merge-on-save, the 400s, and readiness. Runs in a temp WALKMYCODE_HOME.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { DEFAULT } from "../src/lib/providers/catalogue";
import { configPath, loadConfig, localBaseUrl, readiness, resolve, saveConfig, validateConfig } from "../src/lib/providers/config";
import { HttpError } from "../src/lib/providers/guard";
import { keysPath, writeKey } from "../src/lib/providers/keys";

const ENV = ["WALKMYCODE_PROVIDER", "WALKMYCODE_MODEL", "WALKMYCODE_EFFORT", "LANTERN_PROVIDER", "LANTERN_MODEL", "LANTERN_EFFORT", "LOCAL_BASE_URL", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY", "DEEPSEEK_API_KEY", "XAI_API_KEY"];
let home: string;

before(() => {
  home = mkdtempSync(join(tmpdir(), "walkmycode-config-"));
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

const bad = (message: string) => (e: unknown) => e instanceof HttpError && e.status === 400 && e.message === message;

describe("resolve", () => {
  it("falls back to the default when there is no file and no env", () => {
    const { resolved, source } = resolve();
    assert.equal(source, "default");
    assert.deepEqual(resolved, { provider: DEFAULT.provider, model: DEFAULT.model, effort: DEFAULT.effort });
  });

  it("takes WALKMYCODE_* env vars over the default", () => {
    process.env.WALKMYCODE_PROVIDER = "groq";
    process.env.WALKMYCODE_EFFORT = "high";
    let r = resolve();
    assert.equal(r.source, "env");
    assert.deepEqual(r.resolved, { provider: "groq", model: "openai/gpt-oss-120b", effort: "high" });
    delete process.env.WALKMYCODE_PROVIDER;
    process.env.WALKMYCODE_MODEL = "claude-sonnet-5-5";
    r = resolve();
    assert.equal(r.source, "env");
    assert.deepEqual(r.resolved, { provider: "anthropic", model: "claude-sonnet-5-5", effort: "high" });
    // A blank WALKMYCODE_MODEL (as .env.example ships it) means the provider's default.
    process.env.WALKMYCODE_PROVIDER = "openai";
    process.env.WALKMYCODE_MODEL = "";
    assert.equal(resolve().resolved.model, "gpt-6.1-sol");
  });

  it("still reads the old LANTERN_* names when the new ones are unset", () => {
    process.env.LANTERN_PROVIDER = "groq";
    process.env.LANTERN_EFFORT = "low";
    let r = resolve();
    assert.equal(r.source, "env");
    assert.deepEqual(r.resolved, { provider: "groq", model: "openai/gpt-oss-120b", effort: "low" });
    process.env.WALKMYCODE_PROVIDER = "openai";
    r = resolve();
    assert.equal(r.resolved.provider, "openai", "the new name wins");
    assert.equal(r.resolved.effort, "low");
  });

  it("takes config.json over env, field by field", () => {
    process.env.WALKMYCODE_PROVIDER = "groq";
    process.env.WALKMYCODE_EFFORT = "high";
    saveConfig({ provider: "openai", model: "gpt-6-luna" });
    const r = resolve();
    assert.equal(r.source, "config");
    assert.deepEqual(r.resolved, { provider: "openai", model: "gpt-6-luna", effort: "high" });
    saveConfig({ effort: "low" });
    assert.equal(resolve().resolved.effort, "low");
  });

  it("ignores a junk effort in the file or env", () => {
    process.env.WALKMYCODE_EFFORT = "turbo";
    assert.equal(resolve().resolved.effort, DEFAULT.effort);
    writeFileSync(configPath(), JSON.stringify({ provider: "anthropic", model: "claude-opus-5-5", effort: "max" }));
    assert.equal(resolve().resolved.effort, DEFAULT.effort);
  });

  it("sets base_url only for the local provider: saved, then LOCAL_BASE_URL, then the Ollama default", () => {
    saveConfig({ provider: "anthropic", model: "claude-opus-5-5" });
    assert.equal(resolve().resolved.base_url, undefined);
    saveConfig({ provider: "local", model: "llama3.3" });
    assert.equal(resolve().resolved.base_url, "http://localhost:11434/v1");
    process.env.LOCAL_BASE_URL = "http://localhost:1234/v1";
    assert.equal(resolve().resolved.base_url, "http://localhost:1234/v1");
    saveConfig({ local_base_url: "http://10.0.0.2:11434/v1/" });
    assert.equal(resolve().resolved.base_url, "http://10.0.0.2:11434/v1");
    assert.equal(localBaseUrl(), "http://10.0.0.2:11434/v1");
  });

  it("survives a corrupt or hand-edited file", () => {
    writeFileSync(configPath(), "{not json");
    assert.deepEqual(loadConfig(), {});
    assert.equal(resolve().source, "default");
    writeFileSync(configPath(), JSON.stringify({ provider: "mystery", model: "" }));
    const r = resolve();
    assert.equal(r.resolved.provider, "mystery");
    assert.equal(r.resolved.model, "");
  });
});

describe("saveConfig", () => {
  it("merges into what is already saved and writes the file atomically", () => {
    saveConfig({ provider: "openai", model: "gpt-6.1-sol", local_base_url: "http://localhost:1234/v1" });
    saveConfig({ provider: "anthropic", model: "claude-haiku-4-5", effort: "high" });
    const cfg = JSON.parse(readFileSync(configPath(), "utf8"));
    assert.deepEqual(cfg, { provider: "anthropic", model: "claude-haiku-4-5", effort: "high", local_base_url: "http://localhost:1234/v1" });
    assert.equal(existsSync(configPath() + ".tmp"), false);
  });

  it("rejects an unknown provider", () => {
    assert.throws(() => saveConfig({ provider: "mistral", model: "x" }), bad("Unknown provider: mistral"));
    assert.equal(existsSync(configPath()), false);
  });

  it("rejects a model the provider does not list", () => {
    assert.throws(() => saveConfig({ provider: "openai", model: "claude-opus-5-5" }), bad("Unknown model for openai: claude-opus-5-5"));
    assert.throws(() => saveConfig({ provider: "anthropic", model: "" }), bad("Unknown model for anthropic: "));
  });

  it("rejects a bad effort and a bad server URL", () => {
    assert.throws(() => validateConfig({ effort: "max" as never }), bad("Unknown effort: max"));
    assert.throws(() => validateConfig({ local_base_url: "localhost:11434" }), bad("Server URL must start with http:// or https://"));
    assert.throws(() => validateConfig({ local_base_url: "ftp://x" }), bad("Server URL must start with http:// or https://"));
    assert.deepEqual(validateConfig({ local_base_url: "https://box.local:1234/v1/" }), { local_base_url: "https://box.local:1234/v1" });
  });

  it("lets the local provider take any sensible free-text model id", () => {
    for (const m of ["llama3.3", "qwen3:32b", "gpt-oss:20b", "hf.co/org/model-Q4_K_M", "a"]) assert.equal(validateConfig({ provider: "local", model: m }).model, m);
    for (const m of ["", "has space", "x".repeat(121), "semi;colon"]) assert.throws(() => validateConfig({ provider: "local", model: m }), bad(`Unknown model for local: ${m}`));
  });
});

describe("readiness", () => {
  const dead: typeof fetch = async () => {
    throw new TypeError("fetch failed");
  };
  const alive: typeof fetch = async () => Response.json({ data: [] });

  it("is missing_key until a key exists, then null", async () => {
    saveConfig({ provider: "groq", model: "openai/gpt-oss-20b" });
    const fe = await readiness();
    assert.equal(fe?.code, "missing_key");
    assert.equal(fe?.title, "Groq API key missing");
    assert.equal(fe?.action, "settings");
    writeKey("GROQ_API_KEY", "gsk-test");
    assert.equal(await readiness(), null);
  });

  it("accepts a key from process.env too", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    assert.equal(await readiness(), null);
  });

  it("is no_model when the provider is unknown or the model is blank", async () => {
    writeFileSync(configPath(), JSON.stringify({ provider: "mystery", model: "x" }));
    assert.equal((await readiness())?.code, "no_model");
    writeFileSync(configPath(), JSON.stringify({ provider: "local", model: "" }));
    assert.equal((await readiness(undefined, alive))?.code, "no_model");
  });

  it("is model_unavailable when a hand-edited file names a model the provider does not list", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    writeFileSync(configPath(), JSON.stringify({ provider: "openai", model: "gpt-3" }));
    const fe = await readiness();
    assert.equal(fe?.code, "model_unavailable");
    assert.equal(fe?.title, "OpenAI can't use this model");
  });

  it("probes the local server and names its address when nothing answers", async () => {
    saveConfig({ provider: "local", model: "llama3.3", local_base_url: "http://localhost:1234/v1" });
    const fe = await readiness(undefined, dead);
    assert.equal(fe?.code, "network");
    assert.equal(fe?.title, "Can't reach your local server");
    assert.equal(fe?.message, "Nothing answered at http://localhost:1234/v1. Start Ollama or LM Studio and try again.");
    assert.equal(fe?.action, "settings");
    assert.equal(await readiness(undefined, alive), null);
  });

  it("checks whatever Resolved it is handed, not only the saved one", async () => {
    assert.equal((await readiness({ provider: "xai", model: "grok-4.3", effort: "low" }))?.code, "missing_key");
  });
});
