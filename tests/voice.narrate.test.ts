// Narration in the browser, with fakes for what Node lacks: the audio element,
// speechSynthesis and the server. Pins that a step's audio is cached per map
// version (a replay costs nothing, a re-index drops it), that prefetching the
// next step is shared with its reading, that a pause before the audio arrives
// holds it, that NDJSON timings become word marks, that the browser's voice
// reads sentence by sentence with British voices first, and the cost meter.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { addLecture, addNarration, addUsage, formatCost, readCost, resetCost } from "../src/lib/cost";
import { AudioCache, audioKey, type AudioStore, type CachedAudio, type Scope } from "../src/lib/voice/audioCache";
import { BrowserNarrator, rankVoices, readSpeech, ServerNarrator, VoiceError } from "../src/lib/voice/narrate";

const FIX = join(__dirname, "fixtures", "voice");
const MP3 = new Uint8Array(readFileSync(join(FIX, "tts.mp3")));
const NDJSON = readFileSync(join(FIX, "with-timestamps.ndjson"), "utf8");
const TEXT = readFileSync(join(FIX, "with-timestamps.text.txt"), "utf8").trim();

/** An in-memory AudioStore, recording what it was asked. */
function memoryStore() {
  const rows = new Map<string, { scope: Scope; v: CachedAudio }>();
  const store: AudioStore = {
    async get(id) {
      return rows.get(id)?.v ?? null;
    },
    async put(id, scope, v) {
      rows.set(id, { scope, v });
    },
    async prune(scope) {
      for (const [id, r] of rows) if (r.scope.map === scope.map && r.scope.generatedAt !== scope.generatedAt) rows.delete(id);
    },
  };
  return { store, rows };
}

const entry = (n: number): CachedAudio => ({ bytes: new Uint8Array([n]), words: [], type: "audio/mpeg" });

describe("audio cache", () => {
  it("keys a narration by narrator, voice, speed and text", async () => {
    const a = await audioKey(["elevenlabs", "v1", 1, "Hello."]);
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.equal(a, await audioKey(["elevenlabs", "v1", 1, "Hello."]));
    assert.notEqual(a, await audioKey(["elevenlabs", "v2", 1, "Hello."]));
    assert.notEqual(a, await audioKey(["elevenlabs", "v1", 1.1, "Hello."]));
    assert.notEqual(a, await audioKey(["deepgram", "v1", 1, "Hello."]));
  });

  it("keeps audio per map version: a re-index (new generatedAt) drops that map's old audio, other maps keep theirs", async () => {
    const { store, rows } = memoryStore();
    const cache = new AudioCache(store);
    const v1: Scope = { map: "shop", generatedAt: "2026-10-01T10:00:00Z" };
    const other: Scope = { map: "blog", generatedAt: "2026-09-30T09:00:00Z" };
    await cache.put(v1, "k", entry(1));
    await cache.put(other, "k", entry(2));
    assert.deepEqual((await cache.get(v1, "k"))?.bytes, new Uint8Array([1]));
    assert.equal(rows.size, 2);

    const fresh = new AudioCache(store);
    const v2: Scope = { map: "shop", generatedAt: "2026-10-01T12:00:00Z" };
    assert.equal(await fresh.get(v2, "k"), null);
    assert.equal(rows.size, 1, "the old version of shop is gone from storage");
    assert.deepEqual((await fresh.get(other, "k"))?.bytes, new Uint8Array([2]), "blog keeps its audio");
    // In memory too.
    assert.equal(await cache.get(v2, "k"), null);
    assert.equal(await cache.get(v1, "k"), null, "after seeing the new version, the old one is forgotten in memory");
  });

  it("holds at most `max` narrations in memory, least recently used first out, and still finds the rest in storage", async () => {
    const { store } = memoryStore();
    const cache = new AudioCache(store, 2);
    const s: Scope = { map: "m", generatedAt: "g" };
    await cache.put(s, "a", entry(1));
    await cache.put(s, "b", entry(2));
    await cache.get(s, "a");
    await cache.put(s, "c", entry(3));
    const memOnly = new AudioCache(null, 2);
    await memOnly.put(s, "a", entry(1));
    await memOnly.put(s, "b", entry(2));
    await memOnly.get(s, "a");
    await memOnly.put(s, "c", entry(3));
    assert.equal(await memOnly.get(s, "b"), null, "b was least recently used");
    assert.ok(await memOnly.get(s, "a"));
    assert.ok(await cache.get(s, "b"), "storage still has it");
  });
});

// ── Fakes for the page ──

class FakeAudio {
  src = "";
  paused = true;
  currentTime = 0;
  playbackRate = 1;
  dataset: Record<string, string> = {};
  onended: (() => void) | null = null;
  onplaying: (() => void) | null = null;
  onpause: (() => void) | null = null;
  onerror: (() => void) | null = null;
  plays = 0;
  /** How a play() ends: by itself after a tick (default), or when the test says. */
  constructor(private auto = true) {}
  play() {
    this.plays++;
    this.paused = false;
    queueMicrotask(() => this.onplaying?.());
    if (this.auto) setTimeout(() => this.end(), 5);
    return Promise.resolve();
  }
  end() {
    if (this.paused) return;
    this.paused = true;
    this.onended?.();
  }
  pause() {
    this.paused = true;
    this.onpause?.();
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
  load() {}
}

let rafs = 0;
beforeEach(() => {
  resetCost();
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (f: () => void) => setTimeout(f, 1) as unknown as number;
  (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = (h: number) => clearTimeout(h);
  rafs++;
});
afterEach(() => resetCost());

function server(answer: () => Response) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return answer();
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const mp3 = () => new Response(MP3, { headers: { "content-type": "audio/mpeg" } });
const ndjson = () => new Response(NDJSON, { headers: { "content-type": "application/x-ndjson" } });

describe("server narrator", () => {
  it("reads through /api/voice/speak, counts the characters once, and replays a cached step for free", async () => {
    const srv = server(mp3);
    const audio = new FakeAudio();
    const cache = new AudioCache(null);
    const n = new ServerNarrator("deepgram", { voiceId: "aura-2-draco-en", speed: 1, cache, fetch: srv.fetch, audio: () => audio as unknown as HTMLAudioElement });
    const scope: Scope = { map: "shop", generatedAt: "g1" };
    assert.equal(await n.speak("Step one.", { scope }), "ended");
    assert.equal(srv.calls.length, 1);
    assert.equal(srv.calls[0].url, "/api/voice/speak", "no timings asked of Aura-2");
    assert.deepEqual(srv.calls[0].body, { text: "Step one." });
    assert.ok(Math.abs(readCost().usd - (9 / 1000) * 0.03) < 1e-12);
    assert.equal(readCost().voiceChars, 9);
    assert.equal(await n.speak("Step one.", { scope }), "ended");
    assert.equal(srv.calls.length, 1, "the replay came from the cache");
    assert.equal(readCost().voiceChars, 9, "and cost nothing");
  });

  it("prefetches the next step while this one plays, and the reading shares that fetch", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const srv = server(() => new Response(new ReadableStream<Uint8Array>({ async start(c) { await gate; c.enqueue(MP3); c.close(); } }), { headers: { "content-type": "audio/mpeg" } }));
    const audio = new FakeAudio();
    const n = new ServerNarrator("deepgram", { voiceId: null, speed: 1, cache: new AudioCache(null), fetch: srv.fetch, audio: () => audio as unknown as HTMLAudioElement });
    const scope: Scope = { map: "shop", generatedAt: "g1" };
    const pre = n.prefetch("Step two.", scope);
    await new Promise((r) => setTimeout(r, 2));
    const reading = n.speak("Step two.", { scope });
    release();
    await pre;
    assert.equal(await reading, "ended");
    assert.equal(srv.calls.length, 1, "one fetch for both");
  });

  it("asks ElevenLabs for timings and lights the words as they are heard", async () => {
    const srv = server(ndjson);
    const audio = new FakeAudio(false);
    const n = new ServerNarrator("elevenlabs", { voiceId: null, speed: 1, cache: new AudioCache(null), fetch: srv.fetch, audio: () => audio as unknown as HTMLAudioElement });
    const marks: (string | null)[] = [];
    let started = 0;
    const done = n.speak(TEXT, { onWord: (w) => marks.push(w ? TEXT.slice(w.from, w.to) : null), onStart: () => started++ });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(srv.calls[0].url, "/api/voice/speak?timestamps=1");
    assert.equal(started, 1);
    for (const t of [0.05, 0.4, 1.8]) {
      audio.currentTime = t;
      await new Promise((r) => setTimeout(r, 5));
    }
    audio.end();
    assert.equal(await done, "ended");
    assert.deepEqual(marks.filter(Boolean), ["The", "cart", "Then"]);
    assert.equal(marks.at(-1), null, "the mark is cleared at the end");
  });

  it("holds a reading paused before its audio arrives, and stop() settles it as stopped", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const srv = server(() => new Response(new ReadableStream<Uint8Array>({ async start(c) { await gate; c.enqueue(MP3); c.close(); } }), { headers: { "content-type": "audio/mpeg" } }));
    const audio = new FakeAudio(false);
    const n = new ServerNarrator("deepgram", { voiceId: null, speed: 1, cache: new AudioCache(null), fetch: srv.fetch, audio: () => audio as unknown as HTMLAudioElement });
    const reading = n.speak("Held.");
    n.pause();
    assert.equal(n.paused, true);
    release();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(audio.plays, 0, "nothing played while paused");
    n.resume();
    assert.equal(audio.plays, 1);
    n.stop();
    assert.equal(await reading, "stopped");
  });

  it("turns the route's FriendlyError into a VoiceError, and an unreachable server into one too", async () => {
    const err = { code: "missing_key", title: "ElevenLabs API key missing", message: "Add your ElevenLabs key…", action: "settings" };
    const srv = server(() => Response.json({ error: err }, { status: 400 }));
    const n = new ServerNarrator("elevenlabs", { voiceId: null, speed: 1, cache: new AudioCache(null), fetch: srv.fetch, audio: () => new FakeAudio() as unknown as HTMLAudioElement });
    await assert.rejects(n.speak("Hi."), (e: unknown) => e instanceof VoiceError && e.info.code === "missing_key" && e.info.action === "settings");
    assert.equal(readCost().usd, 0, "nothing is counted for a refusal");
    const down = new ServerNarrator("deepgram", {
      voiceId: null,
      speed: 1,
      cache: new AudioCache(null),
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
      audio: () => new FakeAudio() as unknown as HTMLAudioElement,
    });
    await assert.rejects(down.speak("Hi."), (e: unknown) => e instanceof VoiceError && e.info.code === "network");
  });

  it("sends an unsaved choice with the text for Settings' Test voice", async () => {
    const srv = server(mp3);
    const n = new ServerNarrator("deepgram", { voiceId: "aura-2-pandora-en", speed: 1.1, trial: true, cache: new AudioCache(null), fetch: srv.fetch, audio: () => new FakeAudio() as unknown as HTMLAudioElement });
    await n.speak("Testing.");
    assert.deepEqual(srv.calls[0].body, { text: "Testing.", narrator: "deepgram", speed: 1.1, voice_id: "aura-2-pandora-en" });
  });

  it("reads the NDJSON answer back into the same bytes and word timings", async () => {
    const v = await readSpeech(ndjson(), TEXT);
    assert.deepEqual(v.bytes, MP3);
    assert.equal(v.words.length, 10);
    const plain = await readSpeech(mp3(), "x");
    assert.deepEqual(plain.bytes, MP3);
    assert.deepEqual(plain.words, []);
  });
});

// ── The browser's voice ──

interface FakeUtterance {
  text: string;
  voice: { name: string; lang: string } | null;
  lang: string;
  rate: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onboundary: ((e: { name: string; charIndex: number }) => void) | null;
}

function fakeSynth(voices: { name: string; lang: string }[]) {
  const spoken: FakeUtterance[] = [];
  let cancelled = 0;
  const synth = {
    getVoices: () => voices,
    addEventListener: () => {},
    speak(u: FakeUtterance) {
      spoken.push(u);
      setTimeout(() => {
        u.onstart?.();
        let at = 0;
        for (const w of u.text.split(" ")) {
          u.onboundary?.({ name: "word", charIndex: at });
          at += w.length + 1;
        }
        u.onend?.();
      }, 1);
    },
    cancel() {
      cancelled++;
    },
    pause() {},
    resume() {},
  };
  return { synth: synth as unknown as SpeechSynthesis, spoken, cancelled: () => cancelled };
}

describe("browser narrator", () => {
  beforeEach(() => {
    (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance = class {
      voice = null;
      lang = "";
      rate = 1;
      onstart = null;
      onend = null;
      onerror = null;
      onboundary = null;
      constructor(public text: string) {}
    };
  });

  it("picks a British English voice first, natural ones next", () => {
    const ranked = rankVoices([
      { name: "Google US English", lang: "en-US" },
      { name: "Microsoft Hazel - English (United Kingdom)", lang: "en-GB" },
      { name: "Microsoft Ryan Online (Natural) - English (United Kingdom)", lang: "en-GB" },
      { name: "Google Deutsch", lang: "de-DE" },
    ] as SpeechSynthesisVoice[]);
    assert.deepEqual(ranked.map((v) => v.name), ["Microsoft Ryan Online (Natural) - English (United Kingdom)", "Microsoft Hazel - English (United Kingdom)", "Google US English"]);
  });

  it("reads a sentence at a time at the chosen speed, marking words at their place in the whole text", async () => {
    const { synth, spoken } = fakeSynth([
      { name: "Google US English", lang: "en-US" },
      { name: "Microsoft Hazel - English (United Kingdom)", lang: "en-GB" },
    ]);
    const n = new BrowserNarrator({ voiceId: null, speed: 0.9, synth });
    const text = "The cart checks stock. Then it pays.";
    const marks: string[] = [];
    assert.equal(await n.speak(text, { onWord: (w) => w && marks.push(text.slice(w.from, w.to)) }), "ended");
    assert.deepEqual(spoken.map((u) => u.text), ["The cart checks stock.", "Then it pays."]);
    assert.equal(spoken[0].voice?.name, "Microsoft Hazel - English (United Kingdom)");
    assert.equal(spoken[0].rate, 0.9);
    assert.deepEqual(marks, ["The", "cart", "checks", "stock.", "Then", "it", "pays."]);
  });

  it("uses the voice saved in Settings, and stop() ends the reading", async () => {
    const { synth, spoken, cancelled } = fakeSynth([
      { name: "Microsoft Hazel - English (United Kingdom)", lang: "en-GB" },
      { name: "Google US English", lang: "en-US" },
    ]);
    const n = new BrowserNarrator({ voiceId: "Google US English", speed: 1, synth });
    const reading = n.speak("One. Two. Three.");
    n.stop();
    assert.equal(await reading, "stopped");
    assert.ok(cancelled() >= 1);
    await n.speak("Again.");
    assert.equal(spoken.at(-1)?.voice?.name, "Google US English");
  });
});

describe("cost meter: voice", () => {
  it("adds narration characters × the narrator's price, and talk minutes × the lecturer's", () => {
    addNarration("elevenlabs", 2500);
    addNarration("browser", 9999);
    let t = readCost();
    assert.ok(Math.abs(t.usd - 0.1) < 1e-12);
    assert.equal(t.voiceChars, 2500);
    assert.equal(t.calls, 0);
    assert.equal(formatCost(t), "$0.100 · 0 calls · 2,500 chars read");
    addLecture("deepgram-agent", "fast", 120);
    t = readCost();
    assert.ok(Math.abs(t.usd - (0.1 + 0.15)) < 1e-12);
    assert.equal(formatCost(t), "$0.250 · 0 calls · 2,500 chars read · 2.0 min talk");
    assert.equal(t.approx, false);
    addLecture("elevenagents", "haiku", 60);
    t = readCost();
    assert.equal(t.approx, true, "ElevenLabs bills its model on top: approximate");
    assert.equal(formatCost(t).startsWith("≈$0.330"), true);
    addNarration("deepgram", 20000);
    assert.match(formatCost(readCost()), /22\.5k chars read/);
  });

  it("leaves the pill as it was when no voice was used", () => {
    addUsage("anthropic", "claude-opus-5-5", { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_tokens: 0, known: true });
    assert.doesNotMatch(formatCost(readCost()), /chars|talk/);
    assert.ok(rafs > 0);
  });
});
