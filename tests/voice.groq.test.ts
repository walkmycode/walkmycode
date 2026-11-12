// Groq Whisper as the speech-to-text choice, with a fake fetch standing in for
// Groq: the multipart request POST /api/voice/transcribe sends (file, model,
// language, response_format; the key only in Authorization), which Whisper is
// asked for, the FriendlyError each failure becomes, that the key never
// reaches a response or a log line, and the saved choice (voice.stt).
// Runs in a temp WALKMYCODE_HOME with a made-up key.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { configPath } from "../src/lib/providers/config";
import { guarded } from "../src/lib/providers/guard";
import { keysPath, writeKey } from "../src/lib/providers/keys";
import { GROQ_STT_MODELS, STT_IDS, STTS, sttPrice, transcribeTarget, voicePrivacy } from "../src/lib/voice/catalogue";
import { loadVoice, resolveVoice, saveVoice, validateVoice, voiceKeys } from "../src/lib/voice/config";
import { classifyVoice } from "../src/lib/voice/errors";
import { serverTranscriber } from "../src/lib/voice/handsfree/ear";
import { transcribeRequest } from "../src/lib/voice/listen";
import { configGetHandler, configPostHandler, GROQ_STT_URL, transcribeHandler, type FetchLike } from "../src/lib/voice/routes";
import type { FriendlyError } from "../src/lib/providers/wire";

const GROQ_KEY = "gsk_fixture0groq0key0000000000000000000000000000beef";
let home: string;

const logged: string[] = [];
const CONSOLE = ["log", "info", "warn", "error", "debug"] as const;
const originals = Object.fromEntries(CONSOLE.map((k) => [k, console[k]])) as Record<(typeof CONSOLE)[number], (...a: unknown[]) => void>;

before(() => {
  home = mkdtempSync(join(tmpdir(), "walkmycode-voice-groq-"));
  process.env.WALKMYCODE_HOME = home;
});

beforeEach(() => {
  delete process.env.GROQ_API_KEY;
  rmSync(configPath(), { force: true });
  rmSync(keysPath(), { force: true });
  for (const k of CONSOLE) console[k] = (...a: unknown[]) => logged.push(a.map((x) => (x instanceof Error ? `${x.name} ${x.message} ${x.stack}` : String(x))).join(" "));
});

afterEach(() => {
  for (const k of CONSOLE) console[k] = originals[k];
});

after(() => {
  delete process.env.GROQ_API_KEY;
  delete process.env.WALKMYCODE_HOME;
  rmSync(home, { recursive: true, force: true });
  for (const line of logged) assert.ok(!line.includes(GROQ_KEY), "the Groq key reached the console");
});

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

function fake(answer: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init) => {
    const c: Call = { url: String(input), method: (init?.method ?? "GET").toUpperCase(), headers: new Headers(init?.headers), body: init?.body };
    calls.push(c);
    return answer(c);
  };
  return { fetch, calls };
}

const json = (o: unknown, status = 200) => new Response(typeof o === "string" ? o : JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const post = (path: string, body: string) => new Request(`http://localhost:3000${path}`, { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json" }, body });
const WAV = Buffer.from("RIFF fake wav clip WAVEfmt ").toString("base64");

/** The whole response, headers included, checked for the key. */
async function seen(res: Response): Promise<string> {
  const text = await res.text();
  const all = `${[...res.headers].map(([k, v]) => `${k}: ${v}`).join("\n")}\n${text}`;
  assert.ok(!all.includes(GROQ_KEY), "the key reached the browser");
  return text;
}

describe("Groq speech to text: the catalogue", () => {
  it("lists Groq's two Whispers with the prices read from Groq's docs (2 Oct 2026)", () => {
    assert.deepEqual([...GROQ_STT_MODELS], ["whisper-large-v3-turbo", "whisper-large-v3"]);
    assert.equal(STTS["groq-turbo"].model, "whisper-large-v3-turbo");
    assert.equal(STTS["groq-large"].model, "whisper-large-v3");
    assert.equal(sttPrice(STTS["groq-turbo"]), "$0.04 / hour");
    assert.equal(sttPrice(STTS["groq-large"]), "$0.111 / hour");
    assert.equal(STTS["groq-turbo"].minBilledSec, 10);
    assert.equal(sttPrice(STTS.browser), "free");
    for (const id of STT_IDS) assert.ok(STTS[id].privacy.length > 20, `${id} has a privacy line`);
    assert.equal(STTS["groq-turbo"].env, "GROQ_API_KEY");
  });

  it("asks the server for the right vendor and model", () => {
    assert.deepEqual(transcribeTarget("groq-turbo"), { vendor: "groq", model: "whisper-large-v3-turbo" });
    assert.deepEqual(transcribeTarget("groq-large"), { vendor: "groq", model: "whisper-large-v3" });
    assert.deepEqual(transcribeTarget("deepgram"), { vendor: "deepgram" });
    assert.deepEqual(JSON.parse(transcribeRequest("groq-large", "AAAA", "audio/wav")), { vendor: "groq", model: "whisper-large-v3", audio_base64: "AAAA", mime: "audio/wav" });
  });

  it("names Groq in the privacy line only when it is chosen", () => {
    assert.match(voicePrivacy("browser", null, "groq-turbo"), /Groq/);
    assert.doesNotMatch(voicePrivacy("browser", null, "browser"), /Groq/);
  });
});

describe("POST /api/voice/transcribe with Groq", () => {
  it("sends one multipart request: the WAV as question.wav, turbo by default, English, JSON; the key only in Authorization", async () => {
    writeKey("GROQ_API_KEY", GROQ_KEY);
    const up = fake(() => json({ text: "  where is sign in  ", x_groq: { id: "req_1" } }));
    const res = await guarded(transcribeHandler({ fetch: up.fetch }))(post("/api/voice/transcribe", JSON.stringify({ vendor: "groq", audio_base64: WAV, mime: "audio/wav" })));
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(await seen(res)), { text: "where is sign in" });
    assert.equal(up.calls.length, 1);
    const c = up.calls[0];
    assert.equal(c.url, GROQ_STT_URL);
    assert.equal(c.url, "https://api.groq.com/openai/v1/audio/transcriptions");
    assert.equal(c.method, "POST");
    assert.equal(c.headers.get("authorization"), `Bearer ${GROQ_KEY}`);
    assert.equal(c.headers.get("content-type"), null, "fetch sets the multipart boundary itself");
    assert.ok(c.body instanceof FormData);
    const form = c.body as FormData;
    assert.deepEqual([...form.keys()].sort(), ["file", "language", "model", "response_format"]);
    assert.equal(form.get("model"), "whisper-large-v3-turbo");
    assert.equal(form.get("language"), "en");
    assert.equal(form.get("response_format"), "json");
    const file = form.get("file") as File;
    assert.ok(file instanceof Blob);
    assert.equal(file.name, "question.wav");
    assert.equal(file.type, "audio/wav");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), Buffer.from(WAV, "base64"));
    for (const [k, v] of form.entries()) assert.ok(typeof v !== "string" || !v.includes(GROQ_KEY), `the key is not in the ${k} field`);
  });

  it("asks for whisper-large-v3 when it is chosen, names a webm clip question.webm, and refuses any other model", async () => {
    writeKey("GROQ_API_KEY", GROQ_KEY);
    const up = fake(() => json({ text: "how does checkout work" }));
    const h = guarded(transcribeHandler({ fetch: up.fetch }));
    const res = await h(post("/api/voice/transcribe", JSON.stringify({ vendor: "groq", model: "whisper-large-v3", audio_base64: WAV, mime: "audio/webm;codecs=opus" })));
    assert.equal(res.status, 200);
    const form = up.calls[0].body as FormData;
    assert.equal(form.get("model"), "whisper-large-v3");
    assert.equal((form.get("file") as File).name, "question.webm");
    const bad = await h(post("/api/voice/transcribe", JSON.stringify({ vendor: "groq", model: "gpt-4o-transcribe", audio_base64: WAV, mime: "audio/wav" })));
    assert.equal(bad.status, 400);
    assert.equal(up.calls.length, 1, "nothing went upstream for an unknown model");
  });

  it("without a key, says so (Settings → Voice) and calls nobody", async () => {
    const up = fake(() => json({ text: "x" }));
    const res = await guarded(transcribeHandler({ fetch: up.fetch }))(post("/api/voice/transcribe", JSON.stringify({ vendor: "groq", audio_base64: WAV, mime: "audio/wav" })));
    assert.equal(res.status, 400);
    const { error } = JSON.parse(await seen(res)) as { error: FriendlyError };
    assert.equal(error.code, "missing_key");
    assert.equal(error.action, "settings");
    assert.match(error.message, /GROQ_API_KEY/);
    assert.equal(up.calls.length, 0);
  });

  const cases: [string, number, string, (e: FriendlyError) => void][] = [
    ["a bad key", 401, `{"error":{"message":"Invalid API Key ${GROQ_KEY}","type":"invalid_request_error","code":"invalid_api_key"}}`, (e) => (assert.equal(e.code, "invalid_key"), assert.equal(e.action, "settings"), assert.match(e.title, /Groq rejected/))],
    ["a rate limit", 429, '{"error":{"message":"Rate limit reached for model whisper-large-v3-turbo: Limit 7200 seconds of audio per hour","type":"tokens","code":"rate_limit_exceeded"}}', (e) => (assert.equal(e.code, "rate_limited"), assert.equal(e.action, "retry"))],
    ["flex capacity", 498, '{"error":{"message":"flex tier capacity exceeded"}}', (e) => assert.equal(e.code, "rate_limited")],
    ["a file too large", 413, '{"error":{"message":"Request Entity Too Large","type":"invalid_request_error","code":"request_too_large"}}', (e) => (assert.match(e.title, /too large for Groq/), assert.equal(e.action, "settings"))],
    ["a 400 saying the file is too large", 400, '{"error":{"message":"file size exceeds maximum size of 25MB","type":"invalid_request_error"}}', (e) => assert.match(e.title, /too large for Groq/)],
    ["a retired model", 404, '{"error":{"message":"The model `whisper-large-v3` does not exist","code":"model_not_found"}}', (e) => (assert.equal(e.code, "model_unavailable"), assert.match(e.title, /Whisper model/))],
  ];
  for (const [what, status, body, check] of cases) {
    it(`turns ${what} (${status}) into a FriendlyError, with no key in it`, async () => {
      writeKey("GROQ_API_KEY", GROQ_KEY);
      const up = fake(() => json(body, status));
      const res = await guarded(transcribeHandler({ fetch: up.fetch }))(post("/api/voice/transcribe", JSON.stringify({ vendor: "groq", audio_base64: WAV, mime: "audio/wav" })));
      assert.ok(res.status >= 400);
      const { error } = JSON.parse(await seen(res)) as { error: FriendlyError };
      check(error);
    });
  }

  it("cannot reach Groq: a network error, retry", async () => {
    writeKey("GROQ_API_KEY", GROQ_KEY);
    const fetch: FetchLike = async () => {
      throw new TypeError(`fetch failed for ${GROQ_KEY}`);
    };
    const res = await guarded(transcribeHandler({ fetch }))(post("/api/voice/transcribe", JSON.stringify({ vendor: "groq", audio_base64: WAV, mime: "audio/wav" })));
    const { error } = JSON.parse(await seen(res)) as { error: FriendlyError };
    assert.equal(error.code, "network");
    assert.match(error.title, /Groq/);
  });

  it("scrubs the key out of an unrecognised error's detail", () => {
    const e = classifyVoice("groq", 500, `boom with ${GROQ_KEY} inside`, [GROQ_KEY]);
    assert.equal(e.code, "unknown");
    assert.ok(!(e.detail ?? "").includes(GROQ_KEY));
  });
});

describe("hands-free with Groq", () => {
  it("sends each utterance's WAV to the local server with Groq and the chosen Whisper", async () => {
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return json({ text: "open the router" });
    }) as typeof fetch;
    const text = await serverTranscriber("groq-large", fetchImpl)(new Uint8Array([82, 73, 70, 70]));
    assert.equal(text, "open the router");
    assert.equal(sent[0].url, "/api/voice/transcribe");
    assert.deepEqual(sent[0].body, { vendor: "groq", model: "whisper-large-v3", audio_base64: Buffer.from("RIFF").toString("base64"), mime: "audio/wav" });
  });
});

describe("voice.stt in config.json", () => {
  it("defaults to the browser, saves a choice, refuses an unknown one, and reports the Groq key without its value", async () => {
    assert.equal(resolveVoice().stt, "browser");
    saveVoice({ stt: "groq-large" });
    assert.equal(loadVoice().stt, "groq-large");
    assert.equal(resolveVoice().stt, "groq-large");
    assert.equal((JSON.parse(readFileSync(configPath(), "utf8")) as { voice: { stt: string } }).voice.stt, "groq-large");
    assert.throws(() => validateVoice({ stt: "whisper-local" as never }), /Unknown speech to text/);
    assert.equal(resolveVoice({ stt: "nope" as never }).stt, "browser");

    assert.deepEqual(voiceKeys().GROQ_API_KEY, { has_key: false, source: null });
    writeKey("GROQ_API_KEY", GROQ_KEY);
    assert.deepEqual(voiceKeys().GROQ_API_KEY, { has_key: true, source: "settings" });

    const saved = await guarded(configPostHandler())(post("/api/voice/config", JSON.stringify({ stt: "groq-turbo" })));
    assert.equal(saved.status, 200);
    const body = JSON.parse(await seen(saved)) as { saved: { stt: string }; keys: Record<string, { has_key: boolean }> };
    assert.equal(body.saved.stt, "groq-turbo");
    assert.equal(body.keys.GROQ_API_KEY.has_key, true);
    const got = await guarded(configGetHandler())(new Request("http://localhost:3000/api/voice/config", { headers: { host: "localhost:3000" } }));
    assert.equal((JSON.parse(await seen(got)) as { saved: { stt: string } }).saved.stt, "groq-turbo");
    assert.equal((await guarded(configPostHandler())(post("/api/voice/config", JSON.stringify({ stt: "nope" })))).status, 400);
  });
});
