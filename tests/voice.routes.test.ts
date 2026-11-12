// The voice routes with a fake fetch standing in for ElevenLabs and Deepgram:
// what goes upstream (URLs, headers, bodies, Aura-2's 2,000-character pieces,
// the ElevenLabs agent's first-use setup), what comes back to the browser, and
// that the key never appears in a response, a header sent back or a log line.
// Runs in a temp WALKMYCODE_HOME with made-up keys and the synthetic fixtures in
// tests/fixtures/voice/.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { configPath } from "../src/lib/providers/config";
import { guarded } from "../src/lib/providers/guard";
import { keysPath, writeKey } from "../src/lib/providers/keys";
import { LECTURER_PERSONA } from "../src/lib/voice/agentSettings";
import { loadVoice, saveAgentRecord, saveVoice } from "../src/lib/voice/config";
import { FUNCTION_NAMES, FUNCTIONS_VERSION } from "../src/lib/voice/lecturer/functions";
import {
  AGENT_LLM,
  clearVoiceCache,
  configGetHandler,
  configPostHandler,
  elevenSessionHandler,
  ObjectSplitter,
  settingsHandler,
  speakHandler,
  tokenHandler,
  voicesHandler,
  type FetchLike,
} from "../src/lib/voice/routes";

const FIX = join(__dirname, "fixtures", "voice");
const MP3 = readFileSync(join(FIX, "tts.mp3"));
const NDJSON = readFileSync(join(FIX, "with-timestamps.ndjson"), "utf8");
const GRANT = readFileSync(join(FIX, "grant.json"), "utf8");
const VOICES = readFileSync(join(FIX, "voices.json"), "utf8");
const ELDRIN = "Zx9FixtureVoiceEldr02";

const ELEVEN_KEY = "sk_fixture_eleven_0123456789abcdefABCDEF";
const DG_KEY = "f1x7ure0dg0key0000000000000000000000beef";
const ENV = ["ELEVENLABS_API_KEY", "DEEPGRAM_API_KEY"];
let home: string;

// Every console line written while the routes run, to prove no key is logged.
const logged: string[] = [];
const CONSOLE = ["log", "info", "warn", "error", "debug"] as const;
const originals = Object.fromEntries(CONSOLE.map((k) => [k, console[k]])) as Record<(typeof CONSOLE)[number], (...a: unknown[]) => void>;

before(() => {
  home = mkdtempSync(join(tmpdir(), "walkmycode-voice-routes-"));
  process.env.WALKMYCODE_HOME = home;
});

beforeEach(() => {
  for (const v of ENV) delete process.env[v];
  rmSync(configPath(), { force: true });
  rmSync(keysPath(), { force: true });
  clearVoiceCache();
  for (const k of CONSOLE) console[k] = (...a: unknown[]) => logged.push(a.map((x) => (x instanceof Error ? `${x.name} ${x.message} ${x.stack}` : String(x))).join(" "));
});

afterEach(() => {
  for (const k of CONSOLE) console[k] = originals[k];
});

after(() => {
  for (const v of ENV) delete process.env[v];
  delete process.env.WALKMYCODE_HOME;
  rmSync(home, { recursive: true, force: true });
  for (const line of logged) for (const k of [ELEVEN_KEY, DG_KEY]) assert.ok(!line.includes(k), "a key reached the console");
});

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

function fake(answer: (c: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init) => {
    const c: Call = { url: String(input), method: (init?.method ?? "GET").toUpperCase(), headers: Object.fromEntries(new Headers(init?.headers).entries()), body: typeof init?.body === "string" ? init.body : null };
    calls.push(c);
    return answer(c, calls.length);
  };
  return { fetch, calls };
}

const LOCAL = { host: "localhost:3000" };
const post = (path: string, json: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost:3000${path}`, { method: "POST", headers: { ...LOCAL, "content-type": "application/json", ...headers }, body: JSON.stringify(json) });
const get = (path: string, headers: Record<string, string> = {}) => new Request(`http://localhost:3000${path}`, { headers: { ...LOCAL, ...headers } });

/** The whole response as text (latin1 keeps binary bytes), checked for keys, headers included. */
async function seen(res: Response): Promise<string> {
  const text = Buffer.from(await res.arrayBuffer()).toString("latin1");
  const all = `${[...res.headers].map(([k, v]) => `${k}: ${v}`).join("\n")}\n${text}`;
  for (const k of [ELEVEN_KEY, DG_KEY]) assert.ok(!all.includes(k), "the key reached the browser");
  return text;
}

const audio = (bytes: Uint8Array) => new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "audio/mpeg" } });
const json = (o: unknown, status = 200) => new Response(typeof o === "string" ? o : JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

describe("POST /api/voice/speak", () => {
  it("ElevenLabs: finds Eldrin once, streams Flash v2.5 as audio/mpeg, and keeps the key upstream", async () => {
    writeKey("ELEVENLABS_API_KEY", ELEVEN_KEY);
    const up = fake((c) => (c.url.endsWith("/v1/voices") ? json(VOICES) : audio(MP3)));
    const speak = guarded(speakHandler({ fetch: up.fetch }));
    const res = await speak(post("/api/voice/speak", { text: "The cart checks stock first.", stepId: "tour-1" }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "audio/mpeg");
    assert.equal(res.headers.get("x-lantern-voice"), ELDRIN);
    assert.deepEqual(Buffer.from(await seen(res), "latin1"), MP3);
    assert.equal(up.calls[0].url, "https://api.elevenlabs.io/v1/voices");
    assert.equal(up.calls[0].headers["xi-api-key"], ELEVEN_KEY);
    const tts = up.calls[1];
    assert.equal(tts.url, `https://api.elevenlabs.io/v1/text-to-speech/${ELDRIN}/stream?output_format=mp3_44100_128`);
    assert.equal(tts.method, "POST");
    assert.equal(tts.headers["xi-api-key"], ELEVEN_KEY);
    assert.deepEqual(JSON.parse(tts.body!), { text: "The cart checks stock first.", model_id: "eleven_flash_v2_5" });
    // The voice list is cached: the next request goes straight to speech.
    await seen(await speak(post("/api/voice/speak", { text: "Again." })));
    assert.equal(up.calls.length, 3);
    assert.match(up.calls[2].url, /text-to-speech/);
  });

  it("ElevenLabs: falls back to the account's first voice, and uses a saved voice and speed as given", async () => {
    writeKey("ELEVENLABS_API_KEY", ELEVEN_KEY);
    const noEldrin = JSON.stringify({ voices: [{ voice_id: "FirstVoiceIdAaaa0001", name: "Rachel" }] });
    const up = fake((c) => (c.url.endsWith("/v1/voices") ? json(noEldrin) : audio(MP3)));
    await seen(await guarded(speakHandler({ fetch: up.fetch }))(post("/api/voice/speak", { text: "Hi." })));
    assert.match(up.calls[1].url, /text-to-speech\/FirstVoiceIdAaaa0001\/stream/);

    saveVoice({ narrator: "elevenlabs", voiceId: "SavedVoiceIdBbbb0002", speed: 1.15 });
    const up2 = fake(() => audio(MP3));
    await seen(await guarded(speakHandler({ fetch: up2.fetch }))(post("/api/voice/speak", { text: "Hi." })));
    assert.equal(up2.calls.length, 1, "no voice lookup when one is saved");
    assert.match(up2.calls[0].url, /text-to-speech\/SavedVoiceIdBbbb0002\/stream/);
    assert.deepEqual(JSON.parse(up2.calls[0].body!).voice_settings, { speed: 1.15 });
  });

  it("?timestamps=1 answers NDJSON {audio_base64, alignment} lines, however ElevenLabs frames its objects", async () => {
    writeKey("ELEVENLABS_API_KEY", ELEVEN_KEY);
    saveVoice({ voiceId: ELDRIN });
    // Back to back with no newlines, and split mid-object across chunks.
    const joined = NDJSON.trim().split("\n").join("");
    const enc = new TextEncoder().encode(joined);
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.slice(0, 37));
        c.enqueue(enc.slice(37, 1900));
        c.enqueue(enc.slice(1900));
        c.close();
      },
    });
    const up = fake(() => new Response(body, { headers: { "content-type": "application/json" } }));
    const res = await guarded(speakHandler({ fetch: up.fetch }))(post("/api/voice/speak?timestamps=1", { text: "The cart checks stock first. Then it charges the card." }));
    assert.equal(res.headers.get("content-type"), "application/x-ndjson");
    assert.equal(up.calls[0].url, `https://api.elevenlabs.io/v1/text-to-speech/${ELDRIN}/stream/with-timestamps?output_format=mp3_44100_128`);
    const lines = (await seen(res)).trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    assert.equal(lines.length, 2);
    for (const l of lines) assert.deepEqual(Object.keys(l).sort(), ["alignment", "audio_base64"]);
    const bytes = Buffer.concat(lines.map((l) => Buffer.from(l.audio_base64 as string, "base64")));
    assert.deepEqual(bytes, MP3);
  });

  it("Deepgram: Aura-2 in pieces of at most 2,000 characters, one stream in order, mip_opt_out on every call", async () => {
    writeKey("DEEPGRAM_API_KEY", DG_KEY);
    saveVoice({ narrator: "deepgram" });
    const text = Array.from({ length: 75 }, (_, i) => `Step ${i} of the checkout moves the order one stage further along.`).join(" ");
    assert.ok(text.length > 4000);
    const up = fake((_c, n) => audio(new Uint8Array([n, n, n])));
    const res = await guarded(speakHandler({ fetch: up.fetch }))(post("/api/voice/speak?timestamps=1", { text }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "audio/mpeg", "no timings from Aura-2: plain audio");
    const bytes = [...Buffer.from(await seen(res), "latin1")];
    assert.equal(up.calls.length, 3);
    assert.deepEqual(bytes, [1, 1, 1, 2, 2, 2, 3, 3, 3]);
    const pieces = up.calls.map((c) => (JSON.parse(c.body!) as { text: string }).text);
    for (const p of pieces) assert.ok(p.length <= 2000, `piece of ${p.length}`);
    assert.equal(pieces.join(" "), text);
    for (const c of up.calls) {
      assert.equal(c.url, "https://api.deepgram.com/v1/speak?model=aura-2-draco-en&encoding=mp3&mip_opt_out=true");
      assert.equal(c.headers.authorization, `Token ${DG_KEY}`);
    }
  });

  it("tries an unsaved choice for Settings' Test voice, checked like a save", async () => {
    writeKey("DEEPGRAM_API_KEY", DG_KEY);
    const up = fake(() => audio(MP3));
    const speak = guarded(speakHandler({ fetch: up.fetch }));
    await seen(await speak(post("/api/voice/speak", { text: "Testing.", narrator: "deepgram", voice_id: "aura-2-pandora-en", speed: 1.1 })));
    assert.equal(up.calls[0].url, "https://api.deepgram.com/v1/speak?model=aura-2-pandora-en&encoding=mp3&mip_opt_out=true&speed=1.1");
    const bad = await speak(post("/api/voice/speak", { text: "Testing.", narrator: "deepgram", voice_id: "aura-2-zeus-en" }));
    assert.equal(bad.status, 400);
    assert.match(((await bad.json()) as { error: string }).error, /Unknown voice/);
  });

  it("answers JSON FriendlyErrors: a missing key before any call, an upstream refusal scrubbed of the key", async () => {
    const up = fake(() => json({ detail: { status: "invalid_api_key", message: `Key ${ELEVEN_KEY} is not valid` } }, 401));
    const speak = guarded(speakHandler({ fetch: up.fetch }));
    let res = await speak(post("/api/voice/speak", { text: "Hi." }));
    assert.equal(res.status, 400);
    let body = JSON.parse(await seen(res)) as { error: { code: string; action: string } };
    assert.equal(body.error.code, "missing_key");
    assert.equal(body.error.action, "settings");
    assert.equal(up.calls.length, 0);

    writeKey("ELEVENLABS_API_KEY", ELEVEN_KEY);
    saveVoice({ voiceId: ELDRIN });
    res = await speak(post("/api/voice/speak", { text: "Hi." }));
    assert.equal(res.status, 502);
    body = JSON.parse(await seen(res)) as { error: { code: string; action: string } };
    assert.equal(body.error.code, "invalid_key");

    const down = fake(() => {
      throw new TypeError("fetch failed");
    });
    res = await guarded(speakHandler({ fetch: down.fetch }))(post("/api/voice/speak", { text: "Hi." }));
    assert.equal(res.status, 502);
    assert.equal((JSON.parse(await seen(res)) as { error: { code: string } }).error.code, "network");
  });

  it("refuses the browser's voice, empty text, a foreign origin and a non-JSON post", async () => {
    const up = fake(() => audio(MP3));
    const speak = guarded(speakHandler({ fetch: up.fetch }));
    saveVoice({ narrator: "browser" });
    assert.equal((await speak(post("/api/voice/speak", { text: "Hi." }))).status, 400);
    assert.equal((await speak(post("/api/voice/speak", { text: "" }))).status, 400);
    const foreign = await speak(post("/api/voice/speak", { text: "Hi." }, { origin: "http://evil.example" }));
    assert.equal(foreign.status, 403);
    const form = await speak(new Request("http://localhost:3000/api/voice/speak", { method: "POST", headers: { ...LOCAL, "content-type": "text/plain" }, body: "text=hi" }));
    assert.equal(form.status, 403);
    assert.equal(up.calls.length, 0);
  });
});

describe("POST /api/voice/token", () => {
  it("mints a 30-second Deepgram grant and passes back only the token and its lifetime", async () => {
    writeKey("DEEPGRAM_API_KEY", DG_KEY);
    const up = fake(() => json({ ...JSON.parse(GRANT), extra: "dropped" }));
    const res = await guarded(tokenHandler({ fetch: up.fetch }))(post("/api/voice/token", {}));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = JSON.parse(await seen(res)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["access_token", "expires_in"]);
    assert.equal(body.access_token, JSON.parse(GRANT).access_token);
    assert.equal(body.expires_in, 30);
    assert.equal(up.calls[0].url, "https://api.deepgram.com/v1/auth/grant");
    assert.equal(up.calls[0].method, "POST");
    assert.equal(up.calls[0].headers.authorization, `Token ${DG_KEY}`);
    assert.deepEqual(JSON.parse(up.calls[0].body!), { ttl_seconds: 30 });
  });

  it("says what is wrong: no key, a key without Member permissions", async () => {
    const up = fake(() => json({ err_msg: `Insufficient permissions for ${DG_KEY}` }, 403));
    const token = guarded(tokenHandler({ fetch: up.fetch }));
    let res = await token(post("/api/voice/token", {}));
    assert.equal(res.status, 400);
    assert.match(await seen(res), /Talk needs a Deepgram key/);
    writeKey("DEEPGRAM_API_KEY", DG_KEY);
    res = await token(post("/api/voice/token", {}));
    assert.equal(res.status, 502);
    assert.match(await seen(res), /Member permissions/);
  });
});

describe("GET /api/voice/settings", () => {
  it("builds Deepgram's Settings for the saved model, with nothing secret in them", async () => {
    writeKey("DEEPGRAM_API_KEY", DG_KEY);
    saveVoice({ lecturer: "deepgram-agent", lecturerModel: "smarter" });
    const res = await guarded(settingsHandler())(get("/api/voice/settings"));
    const text = await seen(res);
    const s = JSON.parse(text) as { type: string; agent: { think: { provider: { model: string } } } };
    assert.equal(s.type, "Settings");
    assert.equal(s.agent.think.provider.model, "claude-sonnet-5");
    assert.doesNotMatch(text, /"(temperature|endpoint|headers)":/);
    const foreign = await guarded(settingsHandler())(get("/api/voice/settings", { "sec-fetch-site": "cross-site" }));
    assert.equal(foreign.status, 403);
  });
});

describe("/api/voice/config", () => {
  it("serves the choice, the keys' standing and readiness, and saves a patch", async () => {
    writeKey("DEEPGRAM_API_KEY", DG_KEY);
    let res = await guarded(configGetHandler())(get("/api/voice/config"));
    let body = JSON.parse(await seen(res)) as { saved: Record<string, unknown>; keys: Record<string, { has_key: boolean }>; readiness: Record<string, { code: string } | null> };
    assert.equal(body.saved.narrator, "elevenlabs");
    assert.equal(body.keys.DEEPGRAM_API_KEY.has_key, true);
    assert.equal(body.keys.ELEVENLABS_API_KEY.has_key, false);
    assert.equal(body.readiness.narrator?.code, "missing_key");

    res = await guarded(configPostHandler())(post("/api/voice/config", { narrator: "deepgram", voice_id: "aura-2-pandora-en", speed: 0.9, lecturer: "deepgram-agent", lecturer_model: "smarter" }));
    body = JSON.parse(await seen(res)) as typeof body;
    assert.deepEqual(body.saved, { narrator: "deepgram", voiceId: "aura-2-pandora-en", speed: 0.9, lecturer: "deepgram-agent", lecturerModel: "smarter", input: "hands-free", headphones: false, stt: "browser", sttBefore: "browser" });
    assert.deepEqual(body.readiness, { narrator: null, lecturer: null });
    assert.deepEqual(loadVoice(), { narrator: "deepgram", voiceId: "aura-2-pandora-en", speed: 0.9, lecturer: "deepgram-agent", lecturerModel: "smarter" });

    const bad = await guarded(configPostHandler())(post("/api/voice/config", { lecturer_model: "your-claude" }));
    assert.equal(bad.status, 400);

    // Hold to talk (noisy rooms) and headphones are saved choices too, kept with the rest.
    res = await guarded(configPostHandler())(post("/api/voice/config", { input: "push-to-talk", headphones: true }));
    body = JSON.parse(await seen(res)) as typeof body;
    assert.equal(body.saved.input, "push-to-talk");
    assert.equal(body.saved.headphones, true);
    assert.equal(loadVoice().lecturerModel, "smarter");
    const wrong = await guarded(configPostHandler())(post("/api/voice/config", { input: "always-on" }));
    assert.equal(wrong.status, 400);
  });
});

describe("GET /api/voice/voices", () => {
  it("lists the account's voices with Eldrin as the one WalkMyCode would use, or says the key is missing", async () => {
    let res = await guarded(voicesHandler())(get("/api/voice/voices"));
    let body = JSON.parse(await seen(res)) as { voices: { id: string; name: string; accent: string | null }[]; preferred: string | null; error?: { code: string } };
    assert.equal(body.error?.code, "missing_key");
    writeKey("ELEVENLABS_API_KEY", ELEVEN_KEY);
    const up = fake(() => json(VOICES));
    res = await guarded(voicesHandler({ fetch: up.fetch }))(get("/api/voice/voices"));
    body = JSON.parse(await seen(res)) as typeof body;
    assert.equal(body.voices.length, 3);
    assert.equal(body.preferred, ELDRIN);
    assert.equal(body.voices[1].accent, "british");
  });
});

describe("POST /api/voice/elevenagents/session", () => {
  const SIGNED = "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_fixture_1&conversation_signature=sig_fixture";
  const summary = "# Repo: shop\nRoutes: POST /orders (api/orders.py)";

  /** ElevenLabs as the agents API answers it, with an agent whose overrides the test chooses. */
  function account(o: { overrides?: Record<string, unknown>; agentPrompt?: string; gone?: boolean } = {}) {
    let tool = 0;
    return fake((c) => {
      if (c.url.endsWith("/v1/voices")) return json(VOICES);
      if (c.url.endsWith("/v1/convai/tools") && c.method === "POST") return json({ id: `tool_${++tool}`, tool_config: JSON.parse(c.body!).tool_config });
      if (c.url.endsWith("/v1/convai/agents/create")) return json({ agent_id: "agent_fixture_1" });
      if (/\/v1\/convai\/agents\/agent_fixture_1$/.test(c.url) && c.method === "GET") {
        if (o.gone) return json({ detail: { status: "agent_not_found" } }, 404);
        return json({
          agent_id: "agent_fixture_1",
          name: "WalkMyCode lecturer",
          conversation_config: { agent: { prompt: { prompt: o.agentPrompt ?? "old prompt", llm: AGENT_LLM, tool_ids: FUNCTION_NAMES.map((_, i) => `tool_${i + 1}`) } }, tts: { voice_id: ELDRIN } },
          platform_settings: { overrides: { conversation_config_override: o.overrides ?? { agent: { prompt: { prompt: true } }, tts: { voice_id: true }, asr: { keywords: true } } }, auth: { enable_auth: true } },
        });
      }
      if (/\/v1\/convai\/agents\/agent_fixture_1$/.test(c.url) && c.method === "PATCH") return json({ agent_id: "agent_fixture_1" });
      if (c.url.includes("/v1/convai/conversation/get-signed-url")) return json({ signed_url: SIGNED });
      return json({ detail: "unexpected" }, 500);
    });
  }

  it("first use: makes the client tools and a private Claude Haiku agent in the narration voice, keeps its id, returns a signed link", async () => {
    writeKey("ELEVENLABS_API_KEY", ELEVEN_KEY);
    const up = account();
    const res = await guarded(elevenSessionHandler({ fetch: up.fetch }))(post("/api/voice/elevenagents/session", { map_summary: summary }));
    assert.equal(res.status, 200);
    const body = JSON.parse(await seen(res)) as { signed_url: string; agent_id: string; overrides: { prompt?: string; voice_id?: string; keywords?: boolean } };
    assert.equal(body.signed_url, SIGNED);
    assert.equal(body.agent_id, "agent_fixture_1");
    assert.equal(body.overrides.voice_id, ELDRIN);
    assert.ok(body.overrides.prompt?.startsWith(LECTURER_PERSONA));
    assert.ok(body.overrides.prompt?.endsWith(summary));

    const tools = up.calls.filter((c) => c.url.endsWith("/v1/convai/tools"));
    assert.deepEqual(tools.map((c) => (JSON.parse(c.body!) as { tool_config: { name: string } }).tool_config.name).sort(), [...FUNCTION_NAMES].sort());
    for (const t of tools) {
      const cfg = (JSON.parse(t.body!) as { tool_config: Record<string, unknown> }).tool_config;
      assert.equal(cfg.type, "client");
      assert.equal(cfg.expects_response, true);
      assert.equal(t.headers["xi-api-key"], ELEVEN_KEY);
    }
    const create = up.calls.find((c) => c.url.endsWith("/v1/convai/agents/create"))!;
    const agent = JSON.parse(create.body!) as {
      conversation_config: { agent: { prompt: { prompt: string; llm: string; tool_ids: string[] }; first_message: string }; tts: { voice_id: string } };
      platform_settings: { auth: { enable_auth: boolean }; overrides: { conversation_config_override: Record<string, unknown> } };
    };
    assert.equal(agent.conversation_config.agent.prompt.llm, "claude-haiku-4-5");
    assert.notEqual(agent.conversation_config.agent.prompt.llm.includes("opus"), true);
    assert.equal(agent.conversation_config.agent.prompt.tool_ids.length, FUNCTION_NAMES.length);
    assert.ok(agent.conversation_config.agent.prompt.prompt.includes(summary));
    assert.equal(agent.conversation_config.tts.voice_id, ELDRIN);
    assert.equal(agent.platform_settings.auth.enable_auth, true, "a private agent: signed links only");
    assert.deepEqual(agent.platform_settings.overrides.conversation_config_override, { agent: { prompt: { prompt: true } }, tts: { voice_id: true }, asr: { keywords: true } });
    assert.match(up.calls.at(-1)!.url, /get-signed-url\?agent_id=agent_fixture_1$/);

    const rec = loadVoice().elevenagents!;
    assert.equal(rec.agent_id, "agent_fixture_1");
    assert.equal(rec.tools_version, FUNCTIONS_VERSION);
    assert.equal(Object.keys(rec.tool_ids).length, FUNCTION_NAMES.length);
    assert.doesNotMatch(readFileSync(configPath(), "utf8"), new RegExp(ELEVEN_KEY), "config.json holds no key");
  });

  it("later uses: no new tools or agent; overrides carry the map when the agent allows them", async () => {
    writeKey("ELEVENLABS_API_KEY", ELEVEN_KEY);
    saveAgentRecord({ agent_id: "agent_fixture_1", tool_ids: Object.fromEntries(FUNCTION_NAMES.map((n, i) => [n, `tool_${i + 1}`])), tools_version: FUNCTIONS_VERSION });
    const up = account();
    const res = await guarded(elevenSessionHandler({ fetch: up.fetch }))(post("/api/voice/elevenagents/session", { map_summary: summary }));
    const body = JSON.parse(await seen(res)) as { overrides: { prompt?: string } };
    assert.ok(body.overrides.prompt?.endsWith(summary));
    assert.equal(up.calls.filter((c) => c.url.endsWith("/v1/convai/tools")).length, 0);
    assert.equal(up.calls.filter((c) => c.url.endsWith("/agents/create")).length, 0);
    assert.equal(up.calls.filter((c) => c.method === "PATCH").length, 0);
  });

  it("an agent that refuses prompt and voice overrides is updated on the server when the map changes", async () => {
    writeKey("ELEVENLABS_API_KEY", ELEVEN_KEY);
    saveVoice({ narrator: "elevenlabs", voiceId: "ChosenVoiceIdCccc0003" });
    saveAgentRecord({ agent_id: "agent_fixture_1", tool_ids: Object.fromEntries(FUNCTION_NAMES.map((n, i) => [n, `tool_${i + 1}`])), tools_version: FUNCTIONS_VERSION });
    const up = account({ overrides: {} });
    const res = await guarded(elevenSessionHandler({ fetch: up.fetch }))(post("/api/voice/elevenagents/session", { map_summary: summary }));
    const body = JSON.parse(await seen(res)) as { overrides: Record<string, unknown> };
    assert.deepEqual(body.overrides, {});
    const patch = up.calls.find((c) => c.method === "PATCH")!;
    const sent = JSON.parse(patch.body!) as { conversation_config: { agent: { prompt: { prompt: string; llm: string; tool_ids: string[] } }; tts: { voice_id: string } } };
    assert.ok(sent.conversation_config.agent.prompt.prompt.endsWith(summary));
    assert.equal(sent.conversation_config.agent.prompt.llm, AGENT_LLM, "the agent's model is kept");
    assert.equal(sent.conversation_config.tts.voice_id, "ChosenVoiceIdCccc0003");
    // Same map again: the agent already has it, so nothing is patched.
    const up2 = account({ overrides: {}, agentPrompt: sent.conversation_config.agent.prompt.prompt });
    saveVoice({ narrator: "elevenlabs", voiceId: ELDRIN });
    await seen(await guarded(elevenSessionHandler({ fetch: up2.fetch }))(post("/api/voice/elevenagents/session", { map_summary: summary })));
    assert.equal(up2.calls.filter((c) => c.method === "PATCH").length, 0);
  });

  it("makes the agent again when it was deleted in the dashboard, and says when the key is missing", async () => {
    let res = await guarded(elevenSessionHandler())(post("/api/voice/elevenagents/session", {}));
    assert.equal(res.status, 400);
    assert.match(await seen(res), /Talk needs an ElevenLabs key/);
    writeKey("ELEVENLABS_API_KEY", ELEVEN_KEY);
    saveAgentRecord({ agent_id: "agent_fixture_1", tool_ids: Object.fromEntries(FUNCTION_NAMES.map((n, i) => [n, `tool_${i + 1}`])), tools_version: FUNCTIONS_VERSION });
    const up = account({ gone: true });
    res = await guarded(elevenSessionHandler({ fetch: up.fetch }))(post("/api/voice/elevenagents/session", { map_summary: summary }));
    assert.equal(res.status, 200);
    await seen(res);
    assert.equal(up.calls.filter((c) => c.url.endsWith("/agents/create")).length, 1);
  });

  it("an ElevenLabs refusal comes back as a FriendlyError, scrubbed", async () => {
    writeKey("ELEVENLABS_API_KEY", ELEVEN_KEY);
    const up = fake(() => json({ detail: { status: "quota_exceeded", message: `quota for ${ELEVEN_KEY}` } }, 401));
    const res = await guarded(elevenSessionHandler({ fetch: up.fetch }))(post("/api/voice/elevenagents/session", { map_summary: summary }));
    assert.equal(res.status, 502);
    assert.equal((JSON.parse(await seen(res)) as { error: { code: string } }).error.code, "out_of_credits");
  });
});

describe("ObjectSplitter", () => {
  it("cuts JSON objects out of any framing, strings with braces and escapes included", () => {
    const s = new ObjectSplitter();
    assert.deepEqual(s.push('junk {"a":"}{\\""'), []);
    assert.deepEqual(s.push(',"b":{"c":1}}\n{"d":2}'), ['{"a":"}{\\"","b":{"c":1}}', '{"d":2}']);
    assert.deepEqual(s.push("  "), []);
  });
});
