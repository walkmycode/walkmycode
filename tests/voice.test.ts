// Voice as a setting (docs/VOICE.md): the catalogue, the saved choice and its
// readiness, the text helpers (Aura's sentence splitting, answers made
// speakable, character → word timings), and Deepgram's agent Settings, one
// snapshot per lecturer model: no temperature, no endpoint, no secret.
// Runs in a temp WALKMYCODE_HOME with made-up keys.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { configPath, saveConfig } from "../src/lib/providers/config";
import { EXTRA_KEY_ENVS, keyEnvAllowlist } from "../src/lib/providers/catalogue";
import { HttpError } from "../src/lib/providers/guard";
import { keyForEnv, keysPath, writeKey } from "../src/lib/providers/keys";
import {
  builtModels,
  lectureCost,
  lecturerModelFor,
  LECTURERS,
  narrationCost,
  NARRATORS,
  narratorFor,
  voicePrivacy,
  VOICE_DEFAULT,
  VOICE_KEY_ENVS,
} from "../src/lib/voice/catalogue";
import { loadVoice, resolveVoice, saveAgentRecord, saveVoice, validateVoice, voiceKeys, voiceReadiness } from "../src/lib/voice/config";
import { classifyVoice, scrubVoice, voiceFriendly } from "../src/lib/voice/errors";
import { buildAgentSettings, CONTEXT_RESERVE, fitPrompt, keytermsOf, LECTURER_PERSONA, PROMPT_LIMIT, withContext, type AgentSettings } from "../src/lib/voice/agentSettings";
import { deepgramFunctions, elevenToolConfig, FUNCTION_NAMES, LECTURER_FUNCTIONS } from "../src/lib/voice/lecturer/functions";
import { alignChars, sentences, sentenceSpans, speakable, splitForSpeech, wordAt, wordSpanAt, wordTimings, type Alignment } from "../src/lib/voice/speech";
import type { CodeMap } from "../src/analyzer/types";

const ENV = ["ELEVENLABS_API_KEY", "DEEPGRAM_API_KEY", "ANTHROPIC_API_KEY"];
let home: string;

before(() => {
  home = mkdtempSync(join(tmpdir(), "walkmycode-voice-"));
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

describe("voice catalogue", () => {
  it("lists the narrators and lecturers of VOICE.md §2 with their prices", () => {
    assert.equal(NARRATORS.elevenlabs.model, "eleven_flash_v2_5");
    assert.equal(NARRATORS.elevenlabs.preferredVoice, "Eldrin");
    assert.equal(NARRATORS.elevenlabs.pricePer1k, 0.04);
    assert.equal(NARRATORS.elevenlabs.timings, true);
    assert.deepEqual(NARRATORS.deepgram.voices.map((v) => v.id), ["aura-2-draco-en", "aura-2-pandora-en"]);
    assert.equal(NARRATORS.deepgram.pricePer1k, 0.03);
    assert.equal(NARRATORS.deepgram.maxChars, 2000);
    assert.equal(NARRATORS.browser.pricePer1k, 0);
    assert.equal(NARRATORS.browser.lite, true);
    assert.equal(NARRATORS.elevenlabs.lite, false);

    const fast = lecturerModelFor("deepgram-agent", "fast")!;
    assert.deepEqual(fast.think, ["claude-haiku-4-5", "claude-sonnet-5"]);
    assert.equal(fast.pricePerMin, 0.075);
    assert.deepEqual(lecturerModelFor("deepgram-agent", "smarter")!.think, ["claude-sonnet-5"]);
    assert.equal(lecturerModelFor("deepgram-agent", "smarter")!.pricePerMin, 0.163);
    assert.equal(lecturerModelFor("deepgram-agent", "your-claude")!.phase, 2);
    assert.equal(LECTURERS["deepgram-agent"].speak, "flux-colin-en");
    assert.equal(LECTURERS["deepgram-agent"].listen, "flux-general-en");
    const haiku = lecturerModelFor("elevenagents", "haiku")!;
    assert.deepEqual(haiku.think, ["claude-haiku-4-5"]);
    assert.equal(haiku.pricePerMin, 0.08);
    assert.equal(haiku.plusModel, true);
  });

  it("defaults to ElevenLabs for both narration and the lecturer, hands-free, the browser in Lite", () => {
    assert.equal(VOICE_DEFAULT.narrator, "elevenlabs");
    assert.equal(VOICE_DEFAULT.lecturer, "elevenagents");
    assert.equal(VOICE_DEFAULT.liteNarrator, "browser");
    assert.equal(VOICE_DEFAULT.input, "hands-free");
    assert.deepEqual(builtModels("deepgram-agent").map((m) => m.id), ["fast", "smarter"]);
  });

  it("prices narration per character and the lecturer per connected minute", () => {
    assert.equal(narrationCost("elevenlabs", 1000), 0.04);
    assert.ok(Math.abs(narrationCost("deepgram", 4500) - 0.135) < 1e-9);
    assert.equal(narrationCost("browser", 99999), 0);
    assert.ok(Math.abs(lectureCost("deepgram-agent", "fast", 300) - 0.375) < 1e-9);
    assert.ok(Math.abs(lectureCost("deepgram-agent", "smarter", 60) - 0.163) < 1e-9);
    assert.ok(Math.abs(lectureCost("elevenagents", "haiku", 120) - 0.16) < 1e-9);
  });

  it("names where audio and text go for every choice", () => {
    assert.match(voicePrivacy("elevenlabs", null), /ElevenLabs/);
    assert.match(voicePrivacy("deepgram", "deepgram-agent"), /mip_opt_out/);
    assert.match(voicePrivacy("browser", "elevenagents"), /microphone audio/);
    assert.match(voicePrivacy("browser", "elevenagents"), /Language model/);
    assert.equal(narratorFor("nope"), undefined);
  });

  it("lets Settings write both voice keys, and nothing else new", () => {
    assert.deepEqual([...VOICE_KEY_ENVS].sort(), ["DEEPGRAM_API_KEY", "ELEVENLABS_API_KEY"]);
    for (const env of VOICE_KEY_ENVS) assert.ok((EXTRA_KEY_ENVS as readonly string[]).includes(env), env);
    assert.ok(keyEnvAllowlist().includes("ELEVENLABS_API_KEY"));
  });
});

describe("voice keys", () => {
  it("reads a voice key from keys.env first, then the environment, and refuses names outside the allowlist", () => {
    assert.equal(keyForEnv("ELEVENLABS_API_KEY"), null);
    process.env.ELEVENLABS_API_KEY = "from-env";
    assert.deepEqual(keyForEnv("ELEVENLABS_API_KEY"), { value: "from-env", source: "env" });
    writeKey("ELEVENLABS_API_KEY", "sk_from_settings");
    assert.deepEqual(keyForEnv("ELEVENLABS_API_KEY"), { value: "sk_from_settings", source: "settings" });
    process.env.PATH_LIKE = "x";
    assert.equal(keyForEnv("PATH_LIKE"), null);
    delete process.env.PATH_LIKE;
    assert.deepEqual(voiceKeys().ELEVENLABS_API_KEY, { has_key: true, source: "settings" });
    assert.deepEqual(voiceKeys().DEEPGRAM_API_KEY, { has_key: false, source: null });
  });
});

describe("voice config", () => {
  it("resolves to the defaults when nothing is saved", () => {
    assert.deepEqual(resolveVoice(), { narrator: "elevenlabs", voiceId: null, speed: 1, lecturer: "elevenagents", lecturerModel: "haiku", input: "hands-free", headphones: false, stt: "browser", sttBefore: "browser" });
  });

  it("saves under voice without touching the model choice, and the model choice without touching voice", () => {
    saveConfig({ provider: "anthropic", model: "claude-sonnet-5-5" });
    saveVoice({ narrator: "deepgram", voiceId: "aura-2-pandora-en", speed: 1.1 });
    let raw = JSON.parse(readFileSync(configPath(), "utf8")) as Record<string, unknown>;
    assert.equal(raw.provider, "anthropic");
    assert.equal(raw.model, "claude-sonnet-5-5");
    assert.deepEqual(raw.voice, { narrator: "deepgram", voiceId: "aura-2-pandora-en", speed: 1.1 });
    saveConfig({ provider: "openai", model: "gpt-6.1-sol" });
    raw = JSON.parse(readFileSync(configPath(), "utf8")) as Record<string, unknown>;
    assert.deepEqual(raw.voice, { narrator: "deepgram", voiceId: "aura-2-pandora-en", speed: 1.1 });
    assert.deepEqual(resolveVoice(), { narrator: "deepgram", voiceId: "aura-2-pandora-en", speed: 1.1, lecturer: "elevenagents", lecturerModel: "haiku", input: "hands-free", headphones: false, stt: "browser", sttBefore: "browser" });
  });

  it("drops the saved voice when the narrator changes, and the model when the lecturer changes", () => {
    saveVoice({ narrator: "deepgram", voiceId: "aura-2-pandora-en" });
    saveVoice({ narrator: "elevenlabs" });
    assert.equal(loadVoice().voiceId, undefined);
    saveVoice({ lecturer: "deepgram-agent", lecturerModel: "smarter" });
    assert.equal(resolveVoice().lecturerModel, "smarter");
    saveVoice({ lecturer: "elevenagents" });
    assert.equal(loadVoice().lecturerModel, undefined);
    assert.equal(resolveVoice().lecturerModel, "haiku");
  });

  it("refuses what the catalogue does not have, with the messages Settings shows", () => {
    const bad = (patch: Parameters<typeof validateVoice>[0], msg: RegExp) =>
      assert.throws(() => validateVoice(patch, {}), (e: unknown) => e instanceof HttpError && e.status === 400 && msg.test(e.message), JSON.stringify(patch));
    bad({ narrator: "polly" as never }, /Unknown narrator: polly/);
    bad({ narrator: "deepgram", voiceId: "aura-2-zeus-en" }, /Unknown voice for Deepgram Aura-2/);
    bad({ voiceId: "not an id!" }, /Unknown voice for ElevenLabs/);
    bad({ speed: 2 }, /Speed must be between 0.7 and 1.2/);
    bad({ speed: Number.NaN }, /Speed must be/);
    bad({ lecturer: "siri" as never }, /Unknown lecturer: siri/);
    bad({ lecturer: "deepgram-agent", lecturerModel: "your-claude" }, /needs the voice relay/);
    bad({ lecturerModel: "fast" }, /Unknown model for ElevenLabs: fast/);
    assert.deepEqual(validateVoice({ narrator: "browser", voiceId: "Microsoft Ryan Online (Natural) - English (United Kingdom)" }, {}), {
      narrator: "browser",
      voiceId: "Microsoft Ryan Online (Natural) - English (United Kingdom)",
    });
    assert.deepEqual(validateVoice({ speed: 0.95 }, {}), { speed: 0.95 });
  });

  it("ignores a saved choice that no longer fits (hand-edited config.json)", () => {
    writeFileSync(configPath(), JSON.stringify({ voice: { narrator: "deepgram", voiceId: "aura-2-zeus-en", speed: 9, lecturer: "deepgram-agent", lecturerModel: "your-claude" } }));
    assert.deepEqual(resolveVoice(), { narrator: "deepgram", voiceId: "aura-2-draco-en", speed: 1, lecturer: "deepgram-agent", lecturerModel: "fast", input: "hands-free", headphones: false, stt: "browser", sttBefore: "browser" });
  });

  it("keeps the ElevenLabs agent's record in the voice block and leaves the rest alone", () => {
    saveVoice({ narrator: "browser" });
    saveAgentRecord({ agent_id: "agent_x", tool_ids: { next_step: "tool_1" }, tools_version: "v" });
    assert.equal(loadVoice().narrator, "browser");
    assert.equal(loadVoice().elevenagents?.agent_id, "agent_x");
    saveVoice({ speed: 0.9 });
    assert.equal(loadVoice().elevenagents?.agent_id, "agent_x", "a voice save keeps the agent");
    saveAgentRecord(null);
    assert.equal(loadVoice().elevenagents, undefined);
    assert.equal(loadVoice().speed, 0.9);
  });

  it("says which key is missing for the narrator and for the lecturer", () => {
    let r = voiceReadiness();
    assert.equal(r.narrator?.code, "missing_key");
    assert.match(r.narrator!.title, /ElevenLabs API key missing/);
    assert.match(r.narrator!.message, /browser's voice reads aloud/);
    assert.match(r.lecturer!.message, /Talk needs an ElevenLabs key/);
    writeKey("ELEVENLABS_API_KEY", "sk_test_eleven");
    r = voiceReadiness();
    assert.deepEqual(r, { narrator: null, lecturer: null });
    saveVoice({ lecturer: "deepgram-agent" });
    r = voiceReadiness();
    assert.equal(r.lecturer?.code, "missing_key");
    assert.match(r.lecturer!.title, /Deepgram API key missing/);
    saveVoice({ narrator: "browser" });
    assert.equal(voiceReadiness().narrator, null, "the browser's voice needs no key");
  });
});

describe("voice errors", () => {
  it("classifies upstream answers, reading ElevenLabs' quota body before its 401", () => {
    assert.equal(classifyVoice("elevenlabs", 401, '{"detail":{"status":"quota_exceeded"}}').code, "out_of_credits");
    assert.equal(classifyVoice("elevenlabs", 401, '{"detail":{"status":"invalid_api_key"}}').code, "invalid_key");
    assert.equal(classifyVoice("deepgram", 403, "").title, "Deepgram refused the key");
    assert.equal(classifyVoice("deepgram", 402, "").code, "out_of_credits");
    assert.equal(classifyVoice("deepgram", 429, "").action, "retry");
    assert.equal(classifyVoice("elevenlabs", 404, "").code, "model_unavailable");
    assert.equal(classifyVoice("elevenlabs", 400, '{"detail":{"status":"voice_not_found"}}').code, "model_unavailable");
    assert.equal(classifyVoice("deepgram", null, "").code, "network");
    const unknown = classifyVoice("deepgram", 500, "boom with key 0123456789abcdef0123456789abcdef01234567 inside", ["dg-secret"]);
    assert.equal(unknown.code, "unknown");
    assert.equal(unknown.status, 500);
    assert.doesNotMatch(unknown.detail!, /0123456789abcdef/);
  });

  it("scrubs the key itself, hex keys, sk_ keys and JWTs", () => {
    const s = scrubVoice("a my-own-secret-123 b sk_abcdefghijklmnop c eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig d", ["my-own-secret-123"]);
    assert.doesNotMatch(s, /my-own-secret|sk_abcdef|eyJhbGci/);
    assert.equal(voiceFriendly("unknown", "elevenlabs", { detail: "x".repeat(900) }).detail!.length, 300);
  });
});

describe("speech text", () => {
  it("finds sentences without breaking file names, versions or decimals", () => {
    assert.deepEqual(sentences("The cart lives in src/cart.ts. It calls v2.5 of the API!  Then 3.5 seconds pass?\n\nNew paragraph"), [
      "The cart lives in src/cart.ts.",
      "It calls v2.5 of the API!",
      "Then 3.5 seconds pass?",
      "New paragraph",
    ]);
    const text = "  One.   Two words here.\nThree";
    for (const s of sentenceSpans(text)) assert.equal(text.slice(s.from, s.to).trim(), text.slice(s.from, s.to));
    assert.deepEqual(sentenceSpans(""), []);
  });

  it("splits for Aura's 2,000-character limit at sentences, then clauses, then words, dropping nothing", () => {
    const long = Array.from({ length: 120 }, (_, i) => `Sentence number ${i} explains one more part of the checkout flow.`).join(" ");
    const pieces = splitForSpeech(long, 2000);
    assert.ok(pieces.length > 1);
    for (const p of pieces) assert.ok(p.length <= 2000, `piece of ${p.length}`);
    assert.equal(pieces.join(" "), long);
    for (const p of pieces) assert.match(p, /\.$/, "whole sentences where they fit");

    const oneSentence = `${"word, ".repeat(600)}end.`;
    const parts = splitForSpeech(oneSentence, 500);
    for (const p of parts) assert.ok(p.length <= 500);
    assert.equal(parts.join(" ").replace(/\s+/g, " "), oneSentence.replace(/\s+/g, " ").trim());

    const giant = "x".repeat(4500);
    assert.deepEqual(splitForSpeech(giant, 2000).map((p) => p.length), [2000, 2000, 500]);
    assert.deepEqual(splitForSpeech("Short.", 2000), ["Short."]);
    assert.deepEqual(splitForSpeech("   ", 2000), []);
  });

  it("makes an answer speakable: no markup, citations said as a person would, a pause after each item", () => {
    const answer = "**Checkout** starts in `web/src/cart.tsx:12-20`.\n\n1. The button posts to `api/orders.py:44`\n2. The server checks stock\n\nNext, look at `api/stock.py`.";
    assert.equal(speakable(answer), "Checkout starts in cart.tsx, lines 12 to 20. The button posts to orders.py, line 44. The server checks stock. Next, look at stock.py.");
    assert.equal(speakable("Plain text"), "Plain text.");
  });

  it("turns ElevenLabs' character timings into words placed in the text", () => {
    const text = readFileSync(join(__dirname, "fixtures/voice/with-timestamps.text.txt"), "utf8").trim();
    const chunks = readFileSync(join(__dirname, "fixtures/voice/with-timestamps.ndjson"), "utf8")
      .trim()
      .split("\n")
      .map((l) => (JSON.parse(l) as { alignment: Alignment }).alignment);
    const words = wordTimings(text, chunks);
    assert.deepEqual(
      words.map((w) => text.slice(w.from, w.to)),
      ["The", "cart", "checks", "stock", "first.", "Then", "it", "charges", "the", "card."],
    );
    for (let i = 1; i < words.length; i++) assert.ok(words[i].start >= words[i - 1].end - 1e-9, "in time order");
    assert.equal(wordAt(words, -1), -1);
    assert.equal(wordAt(words, words[3].start + 0.01), 3);
    assert.equal(wordAt(words, 999), words.length - 1);
  });

  it("puts chunks whose times start again on one clock, and leaves running times alone", () => {
    const a = (chars: string, t0: number): Alignment => ({
      characters: [...chars],
      character_start_times_seconds: [...chars].map((_, i) => t0 + i * 0.1),
      character_end_times_seconds: [...chars].map((_, i) => t0 + (i + 1) * 0.1),
    });
    const relative = alignChars([a("ab", 0), a("cd", 0)]);
    assert.deepEqual(relative.map((c) => Number(c.start.toFixed(2))), [0, 0.1, 0.2, 0.3]);
    const running = alignChars([a("ab", 0), a("cd", 0.2)]);
    assert.deepEqual(running.map((c) => Number(c.start.toFixed(2))), [0, 0.1, 0.2, 0.3]);
    assert.deepEqual(alignChars([null, undefined]), []);
    // A word the service normalised away is skipped, not shifted onto the next one.
    const words = wordTimings("Hello 42 world", [a("Hello forty-two world", 0)]);
    assert.deepEqual(words.map((w) => w.from), [0, 9]);
  });

  it("finds the word around a boundary's character offset", () => {
    assert.deepEqual(wordSpanAt("read the cart now", 9), { from: 9, to: 13 });
    assert.deepEqual(wordSpanAt("read the cart now", 11), { from: 9, to: 13 });
    assert.equal(wordSpanAt("read", 9), null);
  });
});

// ── Deepgram's agent Settings ──

const SECRETS = /sk[-_][A-Za-z0-9]{6,}|eyJ[\w-]{10,}|[a-f0-9]{32,}|api[_-]?key|xi-api-key|authorization|token/i;

function assertSafe(s: AgentSettings) {
  const json = JSON.stringify(s);
  assert.doesNotMatch(json, /"temperature"/, "no temperature: Claude 4.7+ rejects it");
  assert.doesNotMatch(json, /"endpoint"/, "no endpoint: every function comes back to the page");
  assert.doesNotMatch(json, /"headers"/);
  assert.doesNotMatch(json, SECRETS);
  assert.equal(s.mip_opt_out, true);
  assert.deepEqual(s.audio, { input: { encoding: "linear16", sample_rate: 16000 }, output: { encoding: "linear16", sample_rate: 24000, container: "none" } });
  assert.deepEqual(s.agent.listen.provider.type, "deepgram");
  assert.equal(s.agent.listen.provider.model, "flux-general-en");
  assert.equal(s.agent.listen.provider.version, "v2");
  assert.deepEqual(s.agent.speak, { provider: { type: "deepgram", version: "v2", model: "flux-colin-en" } });
  for (const t of Array.isArray(s.agent.think) ? s.agent.think : [s.agent.think]) {
    assert.ok(t.prompt.length <= PROMPT_LIMIT, "prompt within Deepgram's limit");
    assert.deepEqual(t.functions.map((f) => f.name), FUNCTION_NAMES);
    assert.equal(t.provider.type, "anthropic");
  }
}

describe("agent Settings", () => {
  it("Fast: Haiku 4.5 with Sonnet 5 as the fallback, each a full think", () => {
    const s = buildAgentSettings({ model: "fast" });
    assertSafe(s);
    assert.ok(Array.isArray(s.agent.think));
    const thinks = s.agent.think as Exclude<AgentSettings["agent"]["think"], { provider: unknown }>;
    assert.deepEqual(thinks.map((t) => t.provider.model), ["claude-haiku-4-5", "claude-sonnet-5"]);
    assert.equal(thinks[0].prompt, thinks[1].prompt);
    assert.equal(s.type, "Settings");
    assert.deepEqual(s.tags, ["walkmycode"]);
    assert.ok(s.agent.greeting.length > 0);
  });

  it("Smarter: Sonnet 5 alone", () => {
    const s = buildAgentSettings({ model: "smarter" });
    assertSafe(s);
    assert.ok(!Array.isArray(s.agent.think));
    assert.deepEqual((s.agent.think as { provider: unknown }).provider, { type: "anthropic", model: "claude-sonnet-5" });
  });

  it("never builds the relay's model (or a stranger's) into Settings", () => {
    for (const model of ["your-claude", "haiku"] as const) {
      const s = buildAgentSettings({ model });
      assertSafe(s);
      assert.deepEqual((s.agent.think as { provider: { model: string } }[]).map((t) => t.provider.model), ["claude-haiku-4-5", "claude-sonnet-5"]);
    }
  });

  it("sends the functions without endpoints, deferring run_code and deep_answer to the end of the turn", () => {
    const fns = deepgramFunctions();
    assert.deepEqual(
      fns.filter((f) => f.defer_until_eot).map((f) => f.name),
      ["run_code", "deep_answer"],
    );
    for (const name of ["highlight_lines", "open_file", "focus_map_node", "trace_path", "next_step", "run_code", "read_file", "search", "query_map", "deep_answer", "continue_tour"]) assert.ok(FUNCTION_NAMES.includes(name), name);
    for (const f of LECTURER_FUNCTIONS) for (const [p, def] of Object.entries(f.parameters.properties)) assert.ok(def.description, `${f.name}.${p} has a description`);
  });

  it("adds the map in the browser under the prompt limit, leaving the step-note reserve, and only keyterms that are names", () => {
    const s = buildAgentSettings({ model: "fast" });
    const summary = Array.from({ length: 4000 }, (_, i) => `## Route ${i}: POST /api/orders/${i} (api/orders_${i}.py)`).join("\n");
    const out = withContext(s, { mapSummary: summary, keyterms: ["useCart", "checkout", "has space", "a", "useCart", "x/y", "OrderService"] });
    assertSafe(out);
    const thinks = out.agent.think as { prompt: string }[];
    assert.ok(thinks[0].prompt.startsWith(LECTURER_PERSONA));
    assert.ok(thinks[0].prompt.length <= PROMPT_LIMIT - CONTEXT_RESERVE);
    assert.match(thinks[0].prompt, /ask query_map for the rest/);
    assert.equal(thinks[1].prompt, thinks[0].prompt);
    assert.deepEqual(out.agent.listen.provider.keyterms, ["useCart", "checkout", "OrderService"]);
    // The server's fields are untouched.
    assert.deepEqual(out.agent.speak, s.agent.speak);
    assert.equal(out.mip_opt_out, true);
    assert.equal(withContext(s, {}).agent.listen.provider.keyterms, undefined);
  });

  it("fits a short summary whole", () => {
    const p = fitPrompt("Persona.", "# Repo: shop\nRoutes: one");
    assert.equal(p, "Persona.\n\n# The code you are teaching (a map built by a parser; ask query_map for more)\n# Repo: shop\nRoutes: one");
    assert.equal(fitPrompt("Persona.", "  "), "Persona.");
  });

  it("picks the repo's best-connected names as keyterms, skipping common ones", () => {
    const map = {
      nodes: [
        { id: "file:src/cart.ts", name: "cart.ts", kind: "module", layer: "logic", file: "src/cart.ts" },
        { id: "route:api/orders.py#POST /orders", name: "POST /orders", kind: "route", layer: "api", file: "api/orders.py", handler: "create_order" },
        { id: "file:src/index.ts", name: "index.ts", kind: "module", layer: "logic", file: "src/index.ts" },
        { id: "table:orders", name: "orders", kind: "table", layer: "data" },
      ],
      edges: [
        { id: "e1", from: "route:api/orders.py#POST /orders", to: "table:orders" },
        { id: "e2", from: "file:src/cart.ts", to: "route:api/orders.py#POST /orders" },
        { id: "e3", from: "file:src/index.ts", to: "file:src/cart.ts" },
      ],
    } as unknown as CodeMap;
    // Ties on links go by id; "index" is too common to help; "orders" is said once.
    assert.deepEqual(keytermsOf(map), ["cart", "create_order", "orders"]);
  });
});

describe("ElevenAgents client tools", () => {
  it("are the same functions, waiting for an answer, with time for deep_answer and speech before it", () => {
    const cfg = LECTURER_FUNCTIONS.map((f) => elevenToolConfig(f));
    assert.deepEqual(cfg.map((c) => c.name), FUNCTION_NAMES);
    for (const c of cfg) {
      assert.equal(c.type, "client");
      assert.equal(c.expects_response, true);
      assert.ok((c.response_timeout_secs as number) >= 1 && (c.response_timeout_secs as number) <= 120);
    }
    const deep = cfg.find((c) => c.name === "deep_answer")!;
    assert.equal(deep.response_timeout_secs, 120);
    assert.equal(deep.pre_tool_speech, "force");
    assert.equal(cfg.find((c) => c.name === "next_step")!.parameters, undefined, "no empty parameter object");
    assert.deepEqual((cfg.find((c) => c.name === "highlight_lines")!.parameters as { required: string[] }).required, ["path", "from", "to"]);
  });
});
