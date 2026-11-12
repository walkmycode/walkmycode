// Catalogue invariants: the things a typo in catalogue.ts would silently break.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT, EXTRA_KEY_ENVS, PROVIDERS, PROVIDER_IDS, keyEnvAllowlist, labelOf, modelFor, providerFor, type ProviderId } from "../src/lib/providers/catalogue";

describe("catalogue", () => {
  it("keys every provider by its own id", () => {
    for (const id of PROVIDER_IDS) assert.equal(PROVIDERS[id].id, id);
  });

  it("gives every model a unique id across the whole catalogue (a plan-billed CLI may reuse its maker's)", () => {
    const seen = new Set<string>();
    for (const id of PROVIDER_IDS) {
      if (PROVIDERS[id].wire === "cli") {
        // A subscription app offers its maker's models (Codex: OpenAI's; Claude Code: Anthropic's), or the CLI's own.
        const maker = { "claude-code": "anthropic", codex: "openai", "gemini-cli": null }[id as string] as ProviderId | null | undefined;
        if (maker) for (const m of PROVIDERS[id].models) assert.ok(PROVIDERS[maker].models.some((a) => a.id === m.id), `${id}: ${m.id} is not a ${maker} model`);
        assert.equal(new Set(PROVIDERS[id].models.map((m) => m.id)).size, PROVIDERS[id].models.length, `${id}: duplicate model`);
        continue;
      }
      for (const m of PROVIDERS[id].models) {
        assert.ok(!seen.has(m.id), `duplicate model id ${m.id}`);
        seen.add(m.id);
      }
    }
  });

  it("lists every provider's default model, unless the provider is freeform", () => {
    for (const id of PROVIDER_IDS) {
      const p = PROVIDERS[id];
      if (p.models_freeform) continue;
      assert.ok(p.models.some((m) => m.id === p.default_model), `${id} default ${p.default_model} is not in its list`);
    }
  });

  it("only lets freeform providers have an empty model list", () => {
    for (const id of PROVIDER_IDS) {
      const p = PROVIDERS[id];
      if (!p.models_freeform) assert.ok(p.models.length > 0, `${id} has no models`);
    }
  });

  it("prices every listed model above zero, and none billed to the user's plan", () => {
    for (const id of PROVIDER_IDS) {
      if (PROVIDERS[id].wire === "cli") {
        for (const m of PROVIDERS[id].models) assert.equal(m.price, null, `${m.id} is on the plan`);
        continue;
      }
      for (const m of PROVIDERS[id].models) {
        assert.ok(m.price, `${m.id} has no price`);
        assert.ok(m.price.in > 0, `${m.id} in`);
        assert.ok(m.price.out > 0, `${m.id} out`);
        if (m.price.cacheRead !== undefined) assert.ok(m.price.cacheRead > 0, `${m.id} cacheRead`);
        if (m.price.cacheWrite !== undefined) assert.ok(m.price.cacheWrite > 0, `${m.id} cacheWrite`);
      }
    }
  });

  it("explains every unverified price with a note", () => {
    for (const id of PROVIDER_IDS) {
      for (const m of PROVIDERS[id].models) {
        if (m.price?.unverified) assert.ok(m.price.note && m.price.note.length > 0, `${m.id} is unverified without a note`);
        if (m.price?.note) assert.ok(m.price.unverified, `${m.id} has a note but is not marked unverified`);
      }
    }
  });

  it("names a key env var for every cloud provider and none for local or a plan-billed CLI", () => {
    for (const id of PROVIDER_IDS) {
      const p = PROVIDERS[id];
      if (id === "local" || p.wire === "cli") assert.equal(p.env, null);
      else assert.match(p.env ?? "", /^[A-Z]+_API_KEY$/);
    }
  });

  it("points DEFAULT at a real provider and model", () => {
    const p = providerFor(DEFAULT.provider);
    assert.ok(p);
    assert.ok(modelFor(p, DEFAULT.model));
    assert.equal(DEFAULT.model, p.default_model);
  });
});

describe("providerFor", () => {
  it("finds a catalogue provider and nothing else", () => {
    assert.equal(providerFor("anthropic")?.label, "Anthropic (Claude)");
    assert.equal(providerFor("mistral"), undefined);
    assert.equal(providerFor(""), undefined);
    assert.equal(providerFor("toString"), undefined);
    assert.equal(providerFor("__proto__"), undefined);
  });
});

describe("modelFor", () => {
  it("matches an exact id", () => {
    assert.equal(modelFor(PROVIDERS.openai, "gpt-6.1-sol")?.id, "gpt-6.1-sol");
    assert.equal(modelFor(PROVIDERS.groq, "openai/gpt-oss-20b")?.id, "openai/gpt-oss-20b");
  });

  it("matches a vendor's dated echo by prefix", () => {
    assert.equal(modelFor(PROVIDERS.openai, "gpt-6.1-sol-2026-09-01")?.id, "gpt-6.1-sol");
    assert.equal(modelFor(PROVIDERS.anthropic, "claude-haiku-4-5-20251001")?.id, "claude-haiku-4-5");
  });

  it("prefers the longest prefix when two could match", () => {
    const p = { ...PROVIDERS.openai, models: [
      { ...PROVIDERS.openai.models[0], id: "gpt-6" },
      { ...PROVIDERS.openai.models[0], id: "gpt-6-luna" },
    ] };
    assert.equal(modelFor(p, "gpt-6-luna-2026-01-01")?.id, "gpt-6-luna");
  });

  it("returns undefined for an unknown id", () => {
    assert.equal(modelFor(PROVIDERS.openai, "gpt-4o"), undefined);
    assert.equal(modelFor(PROVIDERS.local, "llama3.3"), undefined);
  });
});

describe("labelOf", () => {
  it("returns the label for a provider and the id for anything else", () => {
    assert.equal(labelOf("anthropic"), "Anthropic (Claude)");
    assert.equal(labelOf("local"), "Local (Ollama / LM Studio)");
    assert.equal(labelOf("mistral"), "mistral");
  });
});

describe("keyEnvAllowlist", () => {
  it("holds every provider env var plus the extras, and nothing else", () => {
    const list = keyEnvAllowlist();
    assert.deepEqual(list, ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY", "DEEPSEEK_API_KEY", "XAI_API_KEY", ...EXTRA_KEY_ENVS]);
    assert.equal(new Set(list).size, list.length);
    assert.ok(!list.includes("WALKMYCODE_MODEL"));
  });
});
