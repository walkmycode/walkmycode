// The local routes of WalkMyCode for Claude's page server (docs/MCP.md §2.4, §6):
// a change (POST, DELETE) needs this launch's cookie, the page's own Origin and
// a JSON body within the size limit; a voice key is saved to ~/.walkmycode/keys.env
// and never comes back, in a response, a header or a log line; the voice routes
// are the full app's handlers, here talking to fake vendors; the user's answers
// are kept with the workspace and the map is made again with them.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { clearVoiceCache } from "../src/lib/voice/routes";
import { cookieName } from "../mcp/src/web";
import { fakeKey, FIXTURES, get, pageCookie, parsePageUrl, send, startLantern, type Started } from "./mcp.helpers";

const pageUrl = (text: string) => /Page: (http:\/\/127\.0\.0\.1:\d+\/\?t=\S+)/.exec(text)?.[1] ?? "";

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

const ELEVEN = fakeKey(32, 11, "abcdef0123456789");
const DEEPGRAM = fakeKey(40, 12, "abcdef0123456789");
const SIGNED = "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_fixture_1&conversation_signature=sig_fixture";

let home: string;
const savedHome = process.env.WALKMYCODE_HOME;
const calls: Call[] = [];
let toolId = 0;

/** The voice vendors, as far as these routes reach them. */
const vendors = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  const c: Call = { url, method: init?.method ?? "GET", headers: new Headers(init?.headers), body: init?.body };
  calls.push(c);
  const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } });
  if (url.endsWith("/v1/voices")) return json({ voices: [{ voice_id: "eldrin0000000001", name: "Eldrin - British baritone" }] });
  if (url.includes("/v1/text-to-speech/")) return new Response(new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]), { headers: { "content-type": "audio/mpeg" } });
  if (url.endsWith("/v1/convai/tools")) return json({ id: `tool_${++toolId}` });
  if (url.endsWith("/v1/convai/agents/create")) return json({ agent_id: "agent_fixture_1" });
  if (url.includes("/v1/convai/conversation/get-signed-url")) return json({ signed_url: SIGNED });
  if (url.startsWith("https://api.deepgram.com/v1/listen")) return json({ results: { channels: [{ alternatives: [{ transcript: " where is sign in " }] }] } });
  if (url === "https://api.elevenlabs.io/v1/speech-to-text") return json({ text: "how does checkout work", language_code: "en" });
  // A model provider asked with the page's own key: refused at once (no retries), the way a bad key is.
  if (url.startsWith("https://api.openai.com/")) return new Response(JSON.stringify({ error: { message: "Incorrect API key provided.", type: "invalid_request_error" } }), { status: 401, headers: { "content-type": "application/json" } });
  return new Response("not faked", { status: 500 });
};

let s: Started;
let url = "";
let port = 0;
let cookie = "";
let origin = "";
let logs = "";
const writeErr = process.stderr.write.bind(process.stderr);

before(async () => {
  home = mkdtempSync(join(tmpdir(), "walkmycode-routes-"));
  process.env.WALKMYCODE_HOME = home;
  clearVoiceCache();
  // Everything the server logs, to check that no key is ever in it.
  process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    logs += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return (writeErr as (c: string | Uint8Array, ...r: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stderr.write;
  s = await startLantern({ voiceFetch: vendors });
  url = pageUrl((await s.call("walkmycode_open", { path: join(FIXTURES, "monolith") })).text);
  ({ port, origin } = parsePageUrl(url));
  cookie = pageCookie(url);
});

after(async () => {
  process.stderr.write = writeErr;
  await s.close();
  if (savedHome === undefined) delete process.env.WALKMYCODE_HOME;
  else process.env.WALKMYCODE_HOME = savedHome;
  rmSync(home, { recursive: true, force: true });
});

const page = () => ({ Host: `127.0.0.1:${port}`, Cookie: cookie, Origin: origin, "Content-Type": "application/json" });
const post = (path: string, body: unknown, headers: Record<string, string> = page(), method = "POST") => send(port, path, headers, method, typeof body === "string" ? body : JSON.stringify(body));

describe("a change needs the cookie, the page's own Origin and JSON", () => {
  it("refuses a request without the cookie, from another Origin or Host, or not JSON", async () => {
    const body = { talk: "free" };
    const without = (name: string) => Object.fromEntries(Object.entries(page()).filter(([k]) => k !== name));
    assert.equal((await post("/api/mcp/settings", body, without("Cookie"))).status, 403);
    assert.equal((await post("/api/mcp/settings", body, { ...page(), Cookie: `${cookieName(port)}=wrong` })).status, 403);
    assert.equal((await post("/api/mcp/settings", body, without("Origin"))).status, 403);
    for (const o of ["http://evil.test", "null", `http://127.0.0.1:${port + 1}`, `https://127.0.0.1:${port}`]) assert.equal((await post("/api/mcp/settings", body, { ...page(), Origin: o })).status, 403, o);
    assert.equal((await post("/api/mcp/settings", body, { ...page(), Host: `evil.test:${port}` })).status, 403);
    assert.equal((await post("/api/mcp/settings", body, { ...page(), "Content-Type": "text/plain" })).status, 415);
    assert.equal((await post("/api/mcp/settings", body, { ...page(), "Content-Type": "application/x-www-form-urlencoded" })).status, 415);
    assert.equal(existsSync(join(home, ".walkmycode", "mcp.json")), false, "nothing refused was saved");
  });

  it("takes it from the page, and reads it back", async () => {
    const r = await post("/api/mcp/settings", { talk: "free" });
    assert.equal(r.status, 200, r.body);
    assert.deepEqual(JSON.parse(readFileSync(join(home, ".walkmycode", "mcp.json"), "utf8")), { talk: "free" });
    const back = await get(port, "/api/mcp/settings", { Host: `127.0.0.1:${port}`, Cookie: cookie });
    assert.deepEqual(JSON.parse(back.body), { talk: "free" });
    assert.equal(back.headers["cache-control"], "no-store");
    assert.equal(back.headers["x-content-type-options"], "nosniff");
    assert.equal((await post("/api/mcp/settings", { talk: "loud" })).status, 400);
    assert.equal((await post("/api/mcp/settings", "{not json")).status, 400);
  });

  it("has only its own few routes, and a size limit", async () => {
    assert.equal((await post("/api/nope", {})).status, 405);
    assert.equal((await post("/api/workspace", {})).status, 405, "the map is only read");
    assert.equal((await post("/", {})).status, 405);
    assert.equal((await post("/api/mcp/settings", { talk: "claude", pad: "x".repeat(3 * 1024 * 1024) })).status, 413);
  });
});

describe("voice keys go to ~/.walkmycode/keys.env and never come back", () => {
  it("saves a key with only has_key in the answer, and refuses keys that are not the voice keys", async () => {
    const r = await post("/api/config/key", { env_var: "ELEVENLABS_API_KEY", value: ELEVEN });
    assert.equal(r.status, 200, r.body);
    assert.deepEqual(JSON.parse(r.body), { ok: true, has_key: true });
    assert.match(readFileSync(join(home, ".walkmycode", "keys.env"), "utf8"), new RegExp(`^ELEVENLABS_API_KEY=${ELEVEN}$`, "m"));
    assert.equal((await post("/api/config/key", { env_var: "DEEPGRAM_API_KEY", value: DEEPGRAM })).status, 200);
    // Only WalkMyCode's own keys: an arbitrary setting is refused.
    const other = await post("/api/config/key", { env_var: "PATH", value: "/tmp/not-a-key" });
    assert.equal(other.status, 400);
    assert.doesNotMatch(readFileSync(join(home, ".walkmycode", "keys.env"), "utf8"), /^PATH=/m);
    const config = await get(port, "/api/voice/config", { Host: `127.0.0.1:${port}`, Cookie: cookie });
    assert.equal(config.status, 200);
    const keys = (JSON.parse(config.body) as { keys: Record<string, { has_key: boolean }> }).keys;
    assert.equal(keys.ELEVENLABS_API_KEY.has_key, true);
    assert.equal(keys.DEEPGRAM_API_KEY.has_key, true);
    for (const body of [r.body, config.body]) {
      assert.ok(!body.includes(ELEVEN));
      assert.ok(!body.includes(DEEPGRAM));
    }
  });

  it("speaks with the saved key: the key goes to the vendor and nowhere else", async () => {
    calls.length = 0;
    assert.equal((await post("/api/voice/config", { narrator: "elevenlabs" })).status, 200);
    const r = await post("/api/voice/speak", { text: "Sign-in starts at the button." });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.headers["content-type"], "audio/mpeg");
    assert.deepEqual([...r.bytes], [0x49, 0x44, 0x33, 1, 2, 3]);
    const tts = calls.find((c) => c.url.includes("/v1/text-to-speech/"))!;
    assert.equal(tts.headers.get("xi-api-key"), ELEVEN);
    assert.ok(!JSON.stringify(r.headers).includes(ELEVEN));
  });

  it("mints the Lightning lecturer's signed link with the user's key", async () => {
    const r = await post("/api/voice/elevenagents/session", { map_summary: "monolith: 2 routes" });
    assert.equal(r.status, 200, r.body);
    const session = JSON.parse(r.body) as { signed_url: string; agent_id: string };
    assert.equal(session.signed_url, SIGNED);
    assert.equal(session.agent_id, "agent_fixture_1");
    assert.ok(calls.filter((c) => c.url.startsWith("https://api.elevenlabs.io")).every((c) => c.headers.get("xi-api-key") === ELEVEN));
    assert.ok(!r.body.includes(ELEVEN));
  });

  it("turns a held Talk clip into text with Deepgram or ElevenLabs", async () => {
    calls.length = 0;
    const audio = Buffer.from("fake webm clip").toString("base64");
    const dg = await post("/api/voice/transcribe", { vendor: "deepgram", audio_base64: audio, mime: "audio/webm;codecs=opus" });
    assert.equal(dg.status, 200, dg.body);
    assert.deepEqual(JSON.parse(dg.body), { text: "where is sign in" });
    const listen = calls.find((c) => c.url.startsWith("https://api.deepgram.com/v1/listen"))!;
    const q = new URL(listen.url).searchParams;
    assert.equal(q.get("model"), "nova-3");
    assert.equal(q.get("mip_opt_out"), "true");
    assert.equal(listen.headers.get("authorization"), `Token ${DEEPGRAM}`);
    assert.equal(listen.headers.get("content-type"), "audio/webm;codecs=opus");

    const el = await post("/api/voice/transcribe", { vendor: "elevenlabs", audio_base64: audio, mime: "audio/webm" });
    assert.equal(el.status, 200, el.body);
    assert.deepEqual(JSON.parse(el.body), { text: "how does checkout work" });
    const stt = calls.find((c) => c.url === "https://api.elevenlabs.io/v1/speech-to-text")!;
    assert.ok(stt.body instanceof FormData);
    assert.equal((stt.body as FormData).get("model_id"), "scribe_v2");
    assert.ok((stt.body as FormData).get("file") instanceof Blob);
    assert.equal((await post("/api/voice/transcribe", { vendor: "elevenlabs", audio_base64: audio, mime: "text/html" })).status, 400);
    for (const body of [dg.body, el.body]) assert.ok(!body.includes(ELEVEN) && !body.includes(DEEPGRAM));
  });

  it("removes a key, and never wrote one into the log", async () => {
    const r = await post("/api/config/key", { env_var: "DEEPGRAM_API_KEY" }, page(), "DELETE");
    assert.equal(r.status, 200, r.body);
    assert.deepEqual(JSON.parse(r.body), { ok: true, has_key: false });
    assert.doesNotMatch(readFileSync(join(home, ".walkmycode", "keys.env"), "utf8"), /DEEPGRAM/);
    assert.ok(!logs.includes(ELEVEN), "the ElevenLabs key is not in the log");
    assert.ok(!logs.includes(DEEPGRAM), "the Deepgram key is not in the log");
  });
});

describe("the page's own AI key, for when the AI app isn't listening", () => {
  const OPENAI = `sk-proj-${fakeKey(40, 13)}`;

  it("saves a provider key and choice, says it's ready, and never sends the key back", async () => {
    const saved = await post("/api/config/key", { env_var: "OPENAI_API_KEY", value: OPENAI });
    assert.equal(saved.status, 200, saved.body);
    const config = await get(port, "/api/config", { Host: `127.0.0.1:${port}`, Cookie: cookie });
    assert.equal(config.status, 200);
    const cfg = JSON.parse(config.body) as { llm_providers: { id: string; has_key: boolean; default_model: string }[] };
    const openai = cfg.llm_providers.find((p) => p.id === "openai")!;
    assert.equal(openai.has_key, true);
    const chose = await post("/api/config", { provider: "openai", model: openai.default_model, effort: "low" });
    assert.equal(chose.status, 200, chose.body);
    const ready = await get(port, "/api/config/readiness", { Host: `127.0.0.1:${port}`, Cookie: cookie });
    assert.deepEqual(JSON.parse(ready.body), { llm: null });
    // One ask step streams back as events (the provider here is faked to fail): the key goes nowhere but the provider.
    calls.length = 0;
    const asked = await post("/api/claude", { history: [{ role: "user", content: "What does lib/auth.ts do?" }], history_provider: null, mode: "ask", mapSummary: "# Repo: monolith" });
    assert.equal(asked.status, 200, asked.body);
    assert.match(String(asked.headers["content-type"]), /text\/event-stream/);
    assert.match(asked.body, /"type":"error"/);
    assert.ok(calls.some((c) => c.url.startsWith("https://api.openai.com/")), "asked the provider");
    for (const body of [saved.body, config.body, chose.body, ready.body, asked.body]) assert.ok(!body.includes(OPENAI));
    assert.ok(!logs.includes(OPENAI));
    // Anything but WalkMyCode's own route: the provider settings take changes only from the page.
    assert.equal((await post("/api/config", { provider: "openai", model: "x" }, { ...page(), Origin: "http://evil.test" })).status, 403);
  });
});

describe("the user's answers", () => {
  it("are kept with the workspace, and the map is made again with them", async () => {
    const ws = s.lantern.session.workspace!;
    const answers = [{ setting: "API_URL", service: null, answeredAt: "2026-10-01T09:00:00.000Z" }];
    const r = await post("/api/answers", { workspace: ws.info.id, answers });
    assert.equal(r.status, 200, r.body);
    assert.deepEqual(JSON.parse(readFileSync(join(ws.savedIn, "answers.json"), "utf8")), { answers });
    await s.lantern.session.remapping;
    assert.notEqual(s.lantern.session.workspace, ws, "mapped again");
    assert.equal(s.lantern.session.workspace!.info.id, ws.info.id);
    assert.equal((await post("/api/answers", { workspace: "another-0000000000", answers })).status, 409);
    assert.equal((await post("/api/answers", { workspace: ws.info.id, answers: [{ setting: "" }] })).status, 400);
  });
});
