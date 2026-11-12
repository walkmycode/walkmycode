// Speech to text on this computer (docs/VOICE.md §4d) without a microphone,
// a model or a network: the energy detector and endpointing on synthetic
// audio, the preview scheduler, a listening session with a fake engine, the
// download verifier and the safe extraction on small made-up archives, the
// settings state (the catalogue, the saved choice, the fallback, the words
// Settings shows), the stream route and its guard, the page's stream client,
// the Ear and the Learn dictation.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { guarded } from "../src/lib/providers/guard";
import { isEnglish, PARAKEET_CREDIT, STTS, sttFor, voicePrivacy } from "../src/lib/voice/catalogue";
import { loadVoice, resolveVoice, saveVoice } from "../src/lib/voice/config";
import { Ear, type MicHandle } from "../src/lib/voice/handsfree/ear";
import { parakeetFallback, pickListener } from "../src/lib/voice/listen";
import { ParakeetStream, PIECE_FRAMES, STREAM_URL, type ParakeetEvents, type ParakeetLike } from "../src/lib/voice/parakeet/client";
import { DETECT_DEFAULTS, FRAME, int16ToFloat32, rmsOf, UtteranceDetector, type DetectEvent } from "../src/lib/voice/parakeet/detect";
import { threadCount } from "../src/lib/voice/parakeet/engine";
import { dictate } from "../src/lib/voice/parakeet/hear";
import { findModel, installModel, InstallError, isInstalled, MODEL, moveIntoPlace, NEEDED_BYTES, removeOwnModel, type InstallProgress, type ModelDirs } from "../src/lib/voice/parakeet/model";
import { PreviewScheduler } from "../src/lib/voice/parakeet/previews";
import { actionHandler, hostedSttRefusal, parakeetStatus, resetParakeetRoutes, statusHandler, streamHandler } from "../src/lib/voice/parakeet/routes";
import { SttSession, type SttEvent } from "../src/lib/voice/parakeet/session";
import { parakeetLine, parakeetPercent, parakeetUsable, type ParakeetStatus } from "../src/lib/voice/parakeet/status";
import { extractWanted, TarRefused, unsafePath } from "../src/lib/voice/parakeet/tar";

// ── synthetic audio: 16 kHz float32 ──

let seed = 11;
const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;

/** `seconds` of a 180 Hz voice at `amp` (0–1), with a little noise. */
function voice(seconds: number, amp = 0.2): Float32Array {
  const out = new Float32Array(Math.round(seconds * 16000));
  for (let i = 0; i < out.length; i++) out[i] = Math.sin((2 * Math.PI * 180 * i) / 16000) * amp + random() * amp * 0.1;
  return out;
}
/** `seconds` of room noise at `amp`. */
function room(seconds: number, amp = 0.0005): Float32Array {
  const out = new Float32Array(Math.round(seconds * 16000));
  for (let i = 0; i < out.length; i++) out[i] = random() * amp;
  return out;
}
function cat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
/** Feed audio 20 ms at a time; the events, each with the second it happened at. */
function feed(d: UtteranceDetector, audio: Float32Array, from = 0): { at: number; e: DetectEvent }[] {
  const out: { at: number; e: DetectEvent }[] = [];
  for (let i = 0; i + FRAME <= audio.length; i += FRAME) for (const e of d.push(audio.subarray(i, i + FRAME))) out.push({ at: from + (i + FRAME) / 16000, e });
  return out;
}
const secs = (a: Float32Array) => a.length / 16000;

describe("Parakeet: the energy detector and endpointing", () => {
  it("measures RMS and turns 16-bit PCM into float32", () => {
    assert.ok(Math.abs(rmsOf(new Float32Array(320).fill(0.5)) - 0.5) < 1e-6);
    assert.equal(rmsOf(new Float32Array(0)), 0);
    const pcm = new Int16Array([0, 16384, -32768, 32767]);
    const f = int16ToFloat32(new Uint8Array(pcm.buffer));
    assert.deepEqual([...f].map((x) => Math.round(x * 1000) / 1000), [0, 0.5, -1, 1]);
    assert.equal(int16ToFloat32(new Uint8Array([1, 2, 3])).length, 1, "an odd last byte is dropped");
  });

  it("uses iReliabee's numbers", () => {
    assert.equal(DETECT_DEFAULTS.ratio, 2.5);
    assert.equal(DETECT_DEFAULTS.minRms, 0.0015);
    assert.equal(DETECT_DEFAULTS.minSpeechS, 0.15);
    assert.equal(DETECT_DEFAULTS.silenceS, 1.2);
    assert.equal(DETECT_DEFAULTS.maxS, 60);
    assert.equal(DETECT_DEFAULTS.minVoicedS, 0.4);
  });

  it("finds one utterance: it starts after 0.15 s of speech and ends after 1.2 s of silence", () => {
    const d = new UtteranceDetector();
    const events = feed(d, cat(room(1), voice(2), room(2)));
    assert.deepEqual(events.map((x) => x.e.type), ["start", "end"]);
    assert.ok(events[0].at >= 1.14 && events[0].at <= 1.2, `starts 0.15 s into the voice: ${events[0].at}`);
    assert.ok(events[1].at >= 4.18 && events[1].at <= 4.24, `ends 1.2 s after the voice stops: ${events[1].at}`);
    const end = events[1].e;
    assert.ok(end.type === "end");
    assert.ok(Math.abs(end.voicedS - 2) < 0.06, `about 2 s voiced: ${end.voicedS}`);
    assert.equal(end.capped, false);
    // The audio handed over: the pre-roll, the voice, and a little of the quiet after it.
    assert.ok(secs(end.audio) > 2.4 && secs(end.audio) < 2.8, `the utterance with its edges: ${secs(end.audio)} s`);
    assert.equal(d.speaking, false);
  });

  it("keeps the first word whole: the audio starts before speech was confirmed", () => {
    const d = new UtteranceDetector();
    const events = feed(d, cat(room(1), voice(1), room(1.5)));
    const end = events.find((x) => x.e.type === "end")?.e;
    assert.ok(end?.type === "end");
    // Loud from within the pre-roll on: the start of the voice is in the clip.
    const firstLoud = Array.from({ length: Math.floor(end.audio.length / FRAME) }, (_, i) => rmsOf(end.audio, i * FRAME, (i + 1) * FRAME)).findIndex((r) => r > 0.05);
    assert.ok(firstLoud >= 10 && firstLoud <= 16, `about 0.3 s of pre-roll before the voice: frame ${firstLoud}`);
  });

  it("drops a click, and skips an utterance with under 0.4 s of voice", () => {
    const d = new UtteranceDetector();
    assert.deepEqual(feed(d, cat(room(1), voice(0.1), room(2))), [], "0.1 s is not speech");
    const events = feed(d, cat(voice(0.3), room(2)));
    assert.deepEqual(events.map((x) => x.e.type), ["start", "discard"]);
  });

  it("is relative to the room: a steady fan is not speech, a voice over it is", () => {
    const d = new UtteranceDetector();
    // A fan at 0.01 RMS: ten times the minimum level, but it is the floor.
    assert.deepEqual(feed(d, room(6, 0.0173)), []);
    assert.ok(d.floor > 0.008, `the floor rose to the fan: ${d.floor}`);
    const events = feed(d, cat(voice(1, 0.2), room(1.5, 0.0173)));
    assert.deepEqual(events.map((x) => x.e.type), ["start", "end"]);
  });

  it("never counts near-silence as speech, however quiet the room", () => {
    const d = new UtteranceDetector();
    feed(d, room(2, 0.00001));
    assert.ok(d.threshold() >= 0.0015, "the minimum RMS holds");
    assert.deepEqual(feed(d, room(1, 0.001)), [], "0.0006 RMS over a silent room is still not speech");
  });

  it("a pause shorter than 1.2 s does not end the utterance", () => {
    const d = new UtteranceDetector();
    const events = feed(d, cat(room(0.5), voice(1), room(0.9), voice(1), room(1.5)));
    assert.deepEqual(events.map((x) => x.e.type), ["start", "end"]);
    const end = events[1].e;
    assert.ok(end.type === "end" && Math.abs(end.voicedS - 2) < 0.1);
  });

  it("past 60 s it ends at the next pause, not in the middle of a word; and at 75 s whatever is said", () => {
    const d = new UtteranceDetector({ maxS: 3, hardMaxS: 6 });
    // 3.5 s of voice, a 0.4 s breath, more voice: cut at the breath.
    let events = feed(d, cat(room(0.5), voice(3.5), room(0.4), voice(1), room(1.5)));
    assert.deepEqual(events.map((x) => x.e.type), ["start", "end", "start", "end"]);
    const first = events[1].e;
    assert.ok(first.type === "end" && first.capped, "the cap ended it");
    assert.ok(events[1].at > 4.25 && events[1].at < 4.4, `at the breath, 0.3 s in: ${events[1].at}`);
    // No pause at all: cut at the hard limit.
    const e = new UtteranceDetector({ maxS: 3, hardMaxS: 6 });
    events = feed(e, cat(room(0.5), voice(8)));
    const cut = events.find((x) => x.e.type === "end");
    assert.ok(cut && cut.e.type === "end" && cut.e.capped && cut.at > 6 && cut.at < 6.6, `cut at the hard limit: ${cut?.at}`);
  });

  it("flush ends the utterance now (push-to-talk): a short dictation is not lost", () => {
    const d = new UtteranceDetector();
    // "Yes." in 0.3 s: under the 0.4 s an utterance needs, enough when the user let go on purpose.
    assert.deepEqual(feed(d, cat(room(0.5), voice(0.3))).map((x) => x.e.type), ["start"]);
    const e = d.flush();
    assert.ok(e?.type === "end", "handed over at once, without the 1.2 s of silence");
    assert.ok(secs(e.audio) > 0.3 && secs(e.audio) < 0.8);
    assert.equal(d.speaking, false);
    assert.equal(d.flush(), null, "nothing left");
    // Nothing said: nothing to decode.
    const quiet = new UtteranceDetector();
    feed(quiet, room(2));
    assert.equal(quiet.flush(), null);
  });

  it("takes audio in any piece size, and reset forgets the utterance", () => {
    const d = new UtteranceDetector();
    const audio = cat(room(1), voice(2), room(2));
    const types: string[] = [];
    for (let i = 0; i < audio.length; i += 1777) for (const e of d.push(audio.subarray(i, Math.min(audio.length, i + 1777)))) types.push(e.type);
    assert.deepEqual(types, ["start", "end"]);
    const r = new UtteranceDetector();
    feed(r, cat(room(1), voice(1)));
    assert.equal(r.speaking, true);
    assert.ok(secs(r.tail(8)) > 1 && secs(r.tail(0.5)) === 0.5, "the tail is what a preview decodes");
    r.reset();
    assert.equal(r.speaking, false);
    assert.equal(r.tail(8).length, 0);
    assert.deepEqual(feed(r, room(2)), []);
  });
});

describe("Parakeet: the preview scheduler", () => {
  const speaking = (voicedS: number) => ({ speaking: true, voicedS });

  it("starts after 0.8 s of voice, then every second, never two at once", () => {
    const p = new PreviewScheduler();
    assert.equal(p.due(0, speaking(0.5)), false, "too little said");
    assert.equal(p.due(0, { speaking: false, voicedS: 5 }), false, "nobody is speaking");
    assert.equal(p.due(100, speaking(0.8)), true);
    p.begin(100);
    assert.equal(p.due(1200, speaking(2)), false, "the last one is still running: this tick is skipped");
    assert.equal(p.finish(400), null);
    assert.equal(p.due(900, speaking(1.6)), false, "not a second since the last began");
    assert.equal(p.due(1100, speaking(1.8)), true);
  });

  it("a new utterance does not wait out the interval", () => {
    const p = new PreviewScheduler();
    p.begin(1000);
    p.finish(1200);
    assert.equal(p.due(1300, speaking(1)), false);
    p.utteranceEnded();
    assert.equal(p.due(1300, speaking(1)), true);
  });

  it("turns previews off after two slow ones, and says why", () => {
    const p = new PreviewScheduler();
    p.begin(0);
    assert.equal(p.finish(700), null, "exactly 70% is not slow");
    p.begin(1000);
    assert.equal(p.finish(1701), null, "the first slow one is forgiven");
    assert.equal(p.off, null);
    p.begin(3000);
    assert.equal(p.finish(3500), null, "a quick one changes nothing");
    p.begin(4000);
    const why = p.finish(4900);
    assert.match(why ?? "", /Live previews are off .* 0\.9 s/);
    assert.equal(p.off, why);
    assert.equal(p.due(9000, speaking(5)), false, "off for the session");
  });

  it("an utterance that ends while a preview runs does not make it look slow", () => {
    const p = new PreviewScheduler();
    p.begin(1000);
    p.utteranceEnded();
    assert.equal(p.finish(1200), null);
    p.begin(2000);
    p.utteranceEnded();
    assert.equal(p.finish(2100), null);
    assert.equal(p.off, null);
  });
});

/** A fake engine: says how many seconds it was given; the test decides when it answers. */
function fakeEngine() {
  const calls: { seconds: number; done: (text?: string) => void }[] = [];
  return {
    calls,
    decode: (samples: Float32Array) =>
      new Promise<string>((ok) => {
        const seconds = Math.round((samples.length / 16000) * 10) / 10;
        calls.push({ seconds, done: (text) => ok(text ?? `heard ${seconds}s`) });
      }),
  };
}
const tick = () => new Promise<void>((r) => setImmediate(r));

describe("Parakeet: a listening session (fake engine)", () => {
  it("speech → previews of the last 8 s every second → the final text", async () => {
    const heard: number[] = [];
    let now = 0;
    const s = new SttSession({
      decode: async (a) => {
        heard.push(Math.round((a.length / 16000) * 10) / 10);
        return `take ${heard.length}`;
      },
      now: () => now,
    });
    const types = (e: SttEvent[]) => e.map((x) => x.type);
    /** Audio in 0.2 s pieces, as the page sends it, in real time. */
    const push = async (audio: Float32Array) => {
      for (let i = 0; i < audio.length; i += 3200) {
        s.push(audio.subarray(i, i + 3200));
        now += 200;
        await tick();
      }
    };
    await push(room(1));
    assert.deepEqual(s.take(), []);
    await push(voice(0.6));
    assert.deepEqual(types(s.take()), ["speech"]);
    assert.equal(heard.length, 0, "under 0.8 s of voice: no preview yet");
    await push(voice(0.4));
    assert.equal(heard.length, 1, "a preview began once 0.8 s was voiced");
    assert.deepEqual(s.take(), [{ type: "partial", text: "take 1" }]);
    await push(voice(12));
    const previews = s.take();
    assert.ok(previews.every((e) => e.type === "partial"), types(previews).join(","));
    assert.ok(previews.length >= 11 && previews.length <= 13, `about one a second over 12 s: ${previews.length}`);
    assert.equal(Math.max(...heard), 8, "a preview decodes at most the last 8 s");
    assert.ok(heard[1] > 1.5 && heard[1] < 3, `early previews decode what there is: ${heard[1]}`);
    const before = heard.length;
    await push(room(1.6));
    await s.settled();
    // A last preview may land in the 1.2 s of quiet that ends the utterance.
    const out = s.take().filter((e) => e.type !== "partial");
    assert.deepEqual(types(out), ["decoding", "final"]);
    const whole = heard.at(-1)!;
    assert.ok(heard.length > before && whole > 13 && whole < 14, `the final decodes the whole utterance: ${whole}`);
    const final = out[1];
    assert.ok(final.type === "final" && final.text === `take ${heard.length}` && final.audioS > 13);
  });

  it("a preview that lands after the utterance ended is not shown over the next one", async () => {
    const engine = fakeEngine();
    let now = 0;
    const s = new SttSession({ decode: engine.decode, now: () => now });
    for (const a of [room(1), voice(1.2)]) {
      s.push(a);
      now += 1000;
    }
    assert.equal(engine.calls.length, 1, "a preview is running");
    s.push(room(1.5));
    await tick();
    assert.equal(engine.calls.length, 2, "the final was asked for");
    engine.calls[0].done("stale");
    engine.calls[1].done("the real thing");
    await s.settled();
    await tick();
    const out = s.take();
    assert.deepEqual(out.map((e) => e.type), ["speech", "decoding", "final"]);
    assert.ok(out[2].type === "final" && out[2].text === "the real thing");
  });

  it("flush drains what is left and resolves when its words are in", async () => {
    const s = new SttSession({ decode: async (a) => `${Math.round((a.length / 16000) * 10) / 10}s`, previews: { startVoicedS: 99 } });
    s.push(cat(room(0.5), voice(0.3)));
    assert.deepEqual(s.take().map((e) => e.type), ["speech"]);
    await s.flush();
    const out = s.take();
    assert.deepEqual(out.map((e) => e.type), ["decoding", "final"]);
    await s.flush();
    assert.deepEqual(s.take(), [], "nothing more");
  });

  it("slow previews turn themselves off with a notice; finals keep coming", async () => {
    let now = 0;
    const s = new SttSession({
      decode: async () => {
        now += 900; // every decode takes 0.9 s
        return "words";
      },
      now: () => now,
    });
    s.push(room(1));
    for (let i = 0; i < 12; i++) {
      s.push(voice(0.5));
      now += 500;
      await tick();
    }
    const events = s.take();
    const notice = events.find((e) => e.type === "notice");
    assert.ok(notice && notice.type === "notice" && /Live previews are off/.test(notice.message), JSON.stringify(events.map((e) => e.type)));
    assert.equal(events.filter((e) => e.type === "notice").length, 1, "said once");
    s.push(room(1.5));
    await s.settled();
    assert.ok(s.take().some((e) => e.type === "final"));
  });

  it("an engine failure is an error event, and the next utterance still works", async () => {
    let fail = true;
    const s = new SttSession({ decode: async () => (fail ? Promise.reject(new Error("The speech model couldn't be loaded.")) : "ok"), previews: { startVoicedS: 99 } });
    s.push(cat(room(1), voice(1), room(1.5)));
    await s.settled();
    assert.deepEqual(s.take().at(-1), { type: "error", message: "The speech model couldn't be loaded." });
    fail = false;
    s.push(cat(voice(1), room(1.5)));
    await s.settled();
    assert.equal(s.take().at(-1)?.type, "final");
  });
});

// ── small made-up archives ──

function tarHeader(name: string, size: number, type = "0", o: { link?: string; prefix?: string } = {}): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, "utf8");
  h.write("0000644\0", 100, 8, "ascii");
  h.write("0000000\0", 108, 8, "ascii");
  h.write("0000000\0", 116, 8, "ascii");
  h.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii");
  h.write("00000000000\0", 136, 12, "ascii");
  h.write("        ", 148, 8, "ascii");
  h.write(type, 156, 1, "ascii");
  if (o.link) h.write(o.link, 157, 100, "utf8");
  h.write("ustar\0", 257, 6, "ascii");
  h.write("00", 263, 2, "ascii");
  if (o.prefix) h.write(o.prefix, 345, 155, "utf8");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return h;
}
interface Entry {
  name: string;
  data?: string | Buffer;
  type?: string;
  link?: string;
  prefix?: string;
}
function tar(entries: Entry[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const data = Buffer.from(e.data ?? "");
    const type = e.type ?? "0";
    parts.push(tarHeader(e.name, type === "0" || type === "L" || type === "x" ? data.length : 0, type, e));
    if (data.length && (type === "0" || type === "L" || type === "x")) parts.push(data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}
/** A buffer as a stream of odd-sized chunks, as a download or a decompressor would give it. */
async function* chunks(b: Buffer, size = 700): AsyncIterable<Uint8Array> {
  for (let i = 0; i < b.length; i += size) yield b.subarray(i, i + size);
}

const TOP = "tiny-model";
const WANT = ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"] as const;
const good = (): Entry[] => [
  { name: `${TOP}/`, type: "5" },
  { name: `${TOP}/test_wavs/`, type: "5" },
  { name: `${TOP}/test_wavs/0.wav`, data: "RIFF....".repeat(300) },
  { name: `${TOP}/encoder.int8.onnx`, data: Buffer.alloc(3000, 7) },
  { name: `${TOP}/decoder.int8.onnx`, data: "decoder" },
  { name: `${TOP}/joiner.int8.onnx`, data: "joiner" },
  { name: `${TOP}/tokens.txt`, data: "<blk> 0\n" },
  { name: `${TOP}/README.md`, data: "not wanted" },
];

describe("Parakeet: safe extraction (small fake archives)", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "walkmycode-tar-"));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));
  let n = 0;
  const dest = () => {
    const d = join(dir, `out-${n++}`);
    mkdirSync(d);
    return d;
  };
  const refuses = async (entries: Entry[], why: RegExp) => {
    const d = dest();
    await assert.rejects(extractWanted(chunks(tar(entries)), { dest: d, want: WANT, top: TOP }), (e: Error) => e instanceof TarRefused && why.test(e.message), `expected ${why}`);
    return d;
  };

  it("names unsafe paths", () => {
    assert.equal(unsafePath("tiny-model/tokens.txt"), null);
    assert.match(unsafePath("/etc/passwd") ?? "", /absolute/);
    assert.match(unsafePath("\\\\server\\share\\x") ?? "", /absolute/);
    assert.match(unsafePath("C:\\Windows\\x") ?? "", /absolute/);
    assert.match(unsafePath("tiny-model/../../x") ?? "", /\.\./);
    assert.match(unsafePath("tiny-model\\..\\x") ?? "", /\.\./);
    assert.equal(unsafePath("tiny-model/a..b/x"), null, "dots inside a name are fine");
    assert.ok(unsafePath(""));
  });

  it("writes only the four files, under their plain names", async () => {
    const d = dest();
    const written = await extractWanted(chunks(tar(good())), { dest: d, want: WANT, top: TOP });
    assert.deepEqual(written.sort(), [...WANT].sort());
    assert.deepEqual(readdirSync(d).sort(), [...WANT].sort(), "no test_wavs, no README, no folders");
    assert.equal(readFileSync(join(d, "tokens.txt"), "utf8"), "<blk> 0\n");
    assert.equal(readFileSync(join(d, "encoder.int8.onnx")).length, 3000);
  });

  it("is not fooled by the same name somewhere else in the archive", async () => {
    const d = dest();
    const entries = [...good(), { name: `${TOP}/nested/tokens.txt`, data: "evil" }, { name: `other/tokens.txt`, data: "evil" }, { name: "tokens.txt", data: "evil" }];
    await extractWanted(chunks(tar(entries), 4096), { dest: d, want: WANT, top: TOP });
    assert.equal(readFileSync(join(d, "tokens.txt"), "utf8"), "<blk> 0\n");
  });

  it("refuses an absolute path, a .. path, a symbolic link and a hard link, anywhere in the archive", async () => {
    await refuses([...good(), { name: "/etc/cron.d/evil", data: "x" }], /absolute path/);
    await refuses([{ name: `${TOP}/../../evil.txt`, data: "x" }, ...good()], /climbs out/);
    await refuses([...good(), { name: `${TOP}/link`, type: "2", link: "/etc/passwd" }], /symbolic link/);
    await refuses([...good(), { name: `${TOP}/tokens2.txt`, type: "1", link: `${TOP}/tokens.txt` }], /hard link/);
    // A wanted name that is really a link is refused too, never followed.
    await refuses([...good().filter((e) => !e.name.endsWith("tokens.txt")), { name: `${TOP}/tokens.txt`, type: "2", link: "../../secret" }], /symbolic link/);
  });

  it("refuses a long name (GNU or pax) that climbs out", async () => {
    await refuses([{ name: "././@LongLink", type: "L", data: "../../../evil\0" }, { name: "short", data: "x" }, ...good()], /climbs out/);
    await refuses([{ name: "PaxHeader", type: "x", data: "21 path=/abs/evil.txt\n" }, { name: "short", data: "x" }, ...good()], /absolute path/);
    await refuses([{ name: "tokens.txt", prefix: "../outside", data: "x" }, ...good()], /climbs out/);
  });

  it("refuses a damaged or incomplete archive", async () => {
    const whole = tar(good());
    const broken = Buffer.from(whole);
    broken[5] ^= 0xff;
    await assert.rejects(extractWanted(chunks(broken), { dest: dest(), want: WANT, top: TOP }), /checksum/);
    await assert.rejects(extractWanted(chunks(whole.subarray(0, 2300)), { dest: dest(), want: WANT, top: TOP }), /ends in the middle|doesn't hold/);
    await refuses(good().filter((e) => !e.name.endsWith("joiner.int8.onnx")), /doesn't hold joiner\.int8\.onnx/);
    await refuses([...good(), { name: `${TOP}/tokens.txt`, data: "again" }], /twice/);
    await assert.rejects(extractWanted(chunks(tar(good())), { dest: dest(), want: WANT, top: TOP, maxFileBytes: 100 }), /larger than expected/);
  });
});

describe("Parakeet: finding, downloading, verifying and removing the model", () => {
  let home: string;
  let dirs: ModelDirs;
  const archive = tar(good());
  const model = { name: TOP, url: "https://example.test/tiny-model.tar.bz2", bytes: archive.length, sha256: createHash("sha256").update(archive).digest("hex"), files: WANT };
  /** The "decompressor" of these tests reads the plain tar the fake download wrote. */
  const decompress = (file: string) => chunks(readFileSync(file));
  const serve = (body: Buffer, status = 200) => async () => new Response(new Uint8Array(body), { status });

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "walkmycode-model-"));
    dirs = { own: join(home, "wmc", "models"), ireliabee: join(home, "ireliabee", "models") };
  });
  after(() => rmSync(home, { recursive: true, force: true }));

  const put = (base: string, files: Record<string, string>) => {
    const d = join(base, MODEL.name);
    mkdirSync(d, { recursive: true });
    for (const [f, text] of Object.entries(files)) writeFileSync(join(d, f), text);
    return d;
  };
  const four = { "encoder.int8.onnx": "e", "decoder.int8.onnx": "d", "joiner.int8.onnx": "j", "tokens.txt": "t" };

  it("pins the archive: its address, size and SHA-256, and the space asked for", () => {
    assert.equal(MODEL.url, "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2");
    assert.equal(MODEL.bytes, 482440461);
    assert.equal(MODEL.sha256, "6fc4426b54aa549a0019b8a75b8dea59164e71790a37ac56a045ad57f915f714");
    assert.deepEqual([...MODEL.files].sort(), ["decoder.int8.onnx", "encoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"]);
    assert.equal(NEEDED_BYTES, MODEL.bytes + MODEL.unpackedBytes + 150 * 1024 * 1024, "archive + unpacked + 150 MB");
  });

  it("counts a folder as installed only when all four files are there and none is empty", () => {
    assert.equal(findModel(dirs), null);
    const d = put(dirs.own, { ...four, "tokens.txt": "" });
    assert.equal(isInstalled(d), false, "an empty file is not installed");
    writeFileSync(join(d, "tokens.txt"), "t");
    assert.equal(isInstalled(d), true);
    rmSync(join(d, "joiner.int8.onnx"));
    assert.equal(isInstalled(d), false);
  });

  it("uses iReliabee's copy when it is whole, else WalkMyCode's own", () => {
    put(dirs.own, four);
    assert.deepEqual(findModel(dirs), { dir: join(dirs.own, MODEL.name), source: "walkmycode" });
    const theirs = put(dirs.ireliabee, four);
    assert.deepEqual(findModel(dirs), { dir: theirs, source: "ireliabee" });
    rmSync(join(theirs, "encoder.int8.onnx"));
    assert.equal(findModel(dirs)?.source, "walkmycode", "a broken copy of theirs is passed over");
    assert.equal(findModel({ ...dirs, ireliabee: "" })?.source, "walkmycode");
  });

  it("downloads with progress, verifies, unpacks and moves into place", async () => {
    const seen: InstallProgress[] = [];
    const where = await installModel({ dirs, model, fetch: serve(archive), decompress, onProgress: (p) => seen.push(p), needed: 1 });
    assert.equal(where, join(dirs.own, TOP));
    assert.deepEqual(readdirSync(where).sort(), [...WANT].sort());
    assert.deepEqual([...new Set(seen.map((p) => p.phase))], ["downloading", "verifying", "unpacking"]);
    assert.equal(seen.at(-1)?.received, archive.length);
    assert.deepEqual(readdirSync(dirs.own), [TOP], "no archive and no work folder left behind");
  });

  it("moves into place even when Windows refuses the rename for a moment (antivirus, the indexer)", async () => {
    let refused = 0;
    const flaky = (from: string, to: string) => {
      if (refused < 2) {
        refused++;
        throw Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" });
      }
      renameSync(from, to);
    };
    const where = await installModel({ dirs, model, fetch: serve(archive), decompress, needed: 1, rename: flaky });
    assert.equal(refused, 2);
    assert.deepEqual(readdirSync(where).sort(), [...WANT].sort());
    // A refusal that lasts, or one that isn't a moment's lock, still comes through.
    const always = () => {
      throw Object.assign(new Error("EPERM"), { code: "EPERM" });
    };
    await assert.rejects(moveIntoPlace("a", "b", always, [1, 1]), /EPERM/);
    const other = () => {
      throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" });
    };
    await assert.rejects(moveIntoPlace("a", "b", other, [1, 1]), /ENOSPC/);
  });

  it("refuses a download of the wrong size or the wrong checksum, before unpacking anything", async () => {
    let unpacked = false;
    const never = (file: string) => {
      unpacked = true;
      return decompress(file);
    };
    const flipped = Buffer.from(archive);
    flipped[archive.length - 2000] ^= 1;
    await assert.rejects(installModel({ dirs, model, fetch: serve(flipped), decompress: never, needed: 1 }), (e: Error) => e instanceof InstallError && /checksum doesn't match/.test(e.message));
    await assert.rejects(installModel({ dirs, model, fetch: serve(archive.subarray(0, archive.length - 512)), decompress: never, needed: 1 }), (e: Error) => e instanceof InstallError && /bytes arrived, not the/.test(e.message));
    await assert.rejects(installModel({ dirs, model, fetch: serve(Buffer.concat([archive, Buffer.alloc(512)])), decompress: never, needed: 1 }), (e: Error) => e instanceof InstallError && /larger than/.test(e.message));
    await assert.rejects(installModel({ dirs, model, fetch: serve(Buffer.from("no"), 404), decompress: never, needed: 1 }), /GitHub answered 404/);
    await assert.rejects(
      installModel({
        dirs,
        model,
        fetch: async () => {
          throw new TypeError("fetch failed");
        },
        decompress: never,
        needed: 1,
      }),
      /could not be reached/,
    );
    assert.equal(unpacked, false);
    assert.equal(existsSync(join(dirs.own, TOP)), false);
    assert.deepEqual(readdirSync(dirs.own), [], "nothing left behind");
  });

  it("refuses an archive that verifies but is unsafe, leaving nothing in place", async () => {
    const evil = tar([...good(), { name: `${TOP}/x`, type: "2", link: "/etc/passwd" }]);
    const m = { ...model, bytes: evil.length, sha256: createHash("sha256").update(evil).digest("hex") };
    await assert.rejects(installModel({ dirs, model: m, fetch: serve(evil), decompress, needed: 1 }), (e: Error) => e instanceof InstallError && /symbolic link/.test(e.message));
    assert.deepEqual(readdirSync(dirs.own), []);
  });

  it("checks the free space first, and says how much is needed", async () => {
    let asked = false;
    await assert.rejects(
      installModel({
        dirs,
        model,
        fetch: async () => {
          asked = true;
          return new Response("x");
        },
        freeBytes: async () => 500 * 1024 * 1024,
        needed: NEEDED_BYTES,
      }),
      (e: Error) => e instanceof InstallError && /Not enough free space: the speech model needs 1\.2 GB .* this disk has 0\.5 GB free/.test(e.message),
    );
    assert.equal(asked, false, "nothing was downloaded");
  });

  it("can be cancelled part-way, leaving nothing behind", async () => {
    const abort = new AbortController();
    const slow = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new Uint8Array(archive.subarray(0, 1024)));
            setTimeout(() => abort.abort(), 20);
          },
        }),
      );
    const fetchSlow = async (_url: string, init?: RequestInit) => {
      const res = await slow();
      init?.signal?.addEventListener("abort", () => void res.body?.cancel().catch(() => {}));
      // As fetch does: an aborted body read rejects.
      const reader = res.body!.getReader();
      return new Response(
        new ReadableStream<Uint8Array>({
          async pull(c) {
            if (init?.signal?.aborted) return c.error(new DOMException("Aborted", "AbortError"));
            const r = await Promise.race([reader.read(), new Promise<never>((_, no) => init?.signal?.addEventListener("abort", () => no(new DOMException("Aborted", "AbortError"))))]).catch((e: Error) => {
              c.error(e);
              return null;
            });
            if (r && !r.done) c.enqueue(r.value);
          },
        }),
      );
    };
    await assert.rejects(installModel({ dirs, model, fetch: fetchSlow, decompress, signal: abort.signal, needed: 1 }), (e: Error) => e.name === "AbortError");
    assert.deepEqual(readdirSync(dirs.own), []);
  });

  it("removes WalkMyCode's own copy only: iReliabee's folder is never touched", () => {
    const theirs = put(dirs.ireliabee, four);
    assert.equal(removeOwnModel(dirs), false, "there was no copy of ours");
    assert.equal(isInstalled(theirs), true);
    const ours = put(dirs.own, four);
    assert.equal(removeOwnModel(dirs), true);
    assert.equal(existsSync(ours), false);
    assert.equal(isInstalled(theirs), true, "theirs is still whole");
    // Even pointed at the same folder, theirs is refused.
    assert.throws(() => removeOwnModel({ own: dirs.ireliabee, ireliabee: dirs.ireliabee }), /iReliabee's copy/);
    assert.equal(isInstalled(theirs), true);
  });
});

describe("Parakeet: the settings state", () => {
  let home: string;
  const ENV = ["WALKMYCODE_HOME", "WALKMYCODE_MODELS_DIR", "WALKMYCODE_IRELIABEE_MODELS_DIR", "WALKMYCODE_MODE"];
  const saved: Record<string, string | undefined> = {};
  before(() => {
    for (const k of ENV) saved[k] = process.env[k];
  });
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "walkmycode-parakeet-"));
    process.env.WALKMYCODE_HOME = home;
    process.env.WALKMYCODE_MODELS_DIR = join(home, "models");
    process.env.WALKMYCODE_IRELIABEE_MODELS_DIR = join(home, "ireliabee");
    delete process.env.WALKMYCODE_MODE;
    resetParakeetRoutes();
  });
  after(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetParakeetRoutes();
  });

  const install = (base = process.env.WALKMYCODE_MODELS_DIR!) => {
    const d = join(base, MODEL.name);
    mkdirSync(d, { recursive: true });
    for (const f of MODEL.files) writeFileSync(join(d, f), "x");
  };
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    new Request(`http://localhost:3000${path}`, { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers }, body: JSON.stringify(body) });
  const status = async () => (await (await statusHandler()()).json()) as ParakeetStatus;

  it("is in the catalogue: free, no key, on this computer", () => {
    const d = sttFor("parakeet");
    assert.ok(d);
    assert.equal(d.label, "On this computer (Parakeet)");
    assert.equal(d.vendor, null);
    assert.equal(d.env, null);
    assert.equal(d.pricePerHour, 0);
    assert.match(d.hint, /Free, private, English, about 630 MB/);
    assert.match(d.privacy, /never leaves/);
    assert.match(voicePrivacy("browser", null, "parakeet"), /Speech to text: Your voice is turned into text on this computer\. The audio never leaves it\./);
    assert.equal(PARAKEET_CREDIT.text, "Speech model: NVIDIA Parakeet-TDT 0.6B v2, used under the CC-BY-4.0 licence, run with sherpa-onnx.");
    assert.ok(Object.keys(STTS).indexOf("parakeet") === 1, "listed right after the browser");
  });

  it("saves the choice and remembers what was chosen before it", () => {
    saveVoice({ stt: "deepgram" });
    saveVoice({ stt: "parakeet" });
    assert.equal(loadVoice().stt, "parakeet");
    assert.equal(resolveVoice().sttBefore, "deepgram");
    saveVoice({ stt: "parakeet", speed: 1.1 });
    assert.equal(resolveVoice().sttBefore, "deepgram", "saving again keeps it");
    saveVoice({ stt: "browser" });
    saveVoice({ stt: "parakeet" });
    assert.equal(resolveVoice().sttBefore, "browser");
    assert.equal(resolveVoice({ stt: "parakeet", sttBefore: "parakeet" }).sttBefore, "browser", "never itself");
    assert.equal(resolveVoice({}).sttBefore, "browser");
  });

  it("hears on this computer only when it can: English, and the model here", () => {
    const keys = { deepgram: true, elevenlabs: false, groq: false };
    const base = { mode: "claude" as const, browser: true, keys, stt: "parakeet" as const, sttBefore: "deepgram" as const };
    assert.equal(pickListener({ ...base, parakeet: true, lang: "en-GB" }), "parakeet");
    assert.equal(pickListener({ ...base, parakeet: true, lang: null }), "parakeet");
    assert.equal(parakeetFallback({ ...base, parakeet: true, lang: "en-US" }), null);
    // Another language: what was chosen before hears, and Talk says so.
    assert.equal(pickListener({ ...base, parakeet: true, lang: "fr-FR" }), "deepgram");
    assert.match(parakeetFallback({ ...base, parakeet: true, lang: "fr-FR" }) ?? "", /English only.*fr-FR.*earlier choice/);
    // The model is not here yet.
    assert.equal(pickListener({ ...base, parakeet: false, lang: "en-GB" }), "deepgram");
    assert.match(parakeetFallback({ ...base, parakeet: false, lang: "en-GB" }) ?? "", /isn't on this computer yet/);
    // The earlier choice's key is gone: the browser, then typing.
    assert.equal(pickListener({ ...base, keys: { deepgram: false, elevenlabs: false }, parakeet: false }), "browser");
    assert.equal(pickListener({ ...base, keys: { deepgram: false, elevenlabs: false }, parakeet: false, browser: false }), "typing");
    // Free voice: nothing goes to a voice provider, and Parakeet sends nothing anywhere.
    assert.equal(pickListener({ ...base, mode: "free", parakeet: true, lang: "en" }), "parakeet");
    assert.equal(pickListener({ ...base, mode: "free", parakeet: false }), "browser");
    // Not chosen: nothing changes.
    assert.equal(pickListener({ mode: "claude", browser: true, keys, stt: "deepgram", parakeet: true }), "deepgram");
    assert.equal(parakeetFallback({ stt: "deepgram", parakeet: false, lang: "fr" }), null);
    for (const [lang, yes] of [["en", true], ["en-GB", true], ["EN_us", true], ["", true], ["fr", false], ["eng-x", false], ["de-EN", false]] as const) assert.equal(isEnglish(lang), yes, lang);
  });

  it("says where the model stands: missing, iReliabee's, WalkMyCode's own", async () => {
    let s = await status();
    assert.equal(s.state, "missing");
    assert.equal(s.source, null);
    assert.equal(s.removable, false);
    assert.equal(parakeetUsable(s), false);
    if (s.available) assert.match(parakeetLine(s), /Not on this computer yet: a one-off download of 460 MB from GitHub \(631 MB once unpacked\)/);
    install(process.env.WALKMYCODE_IRELIABEE_MODELS_DIR);
    s = await status();
    assert.deepEqual([s.state, s.source, s.removable], ["installed", "ireliabee", false]);
    if (s.available) assert.match(parakeetLine(s), /Already on this computer: WalkMyCode uses the copy iReliabee downloaded/);
    install();
    s = await status();
    assert.deepEqual([s.state, s.source, s.removable], ["installed", "ireliabee", true], "theirs is used; ours can go");
    rmSync(process.env.WALKMYCODE_IRELIABEE_MODELS_DIR!, { recursive: true });
    s = await status();
    assert.deepEqual([s.state, s.source, s.removable], ["installed", "walkmycode", true]);
    if (s.available) assert.match(parakeetLine(s), /On this computer \(631 MB/);
  });

  it("puts the download's progress into words and a bar", () => {
    const base: ParakeetStatus = { state: "installing", source: null, removable: false, install: { phase: "downloading", received: 125_000_000, total: MODEL.bytes, error: null }, engine: { state: "cold", loadMs: null, threads: 4, error: null }, available: true, refusal: null, bytes: MODEL.unpackedBytes };
    assert.equal(parakeetLine(base), "Downloading… 119 MB of 460 MB (25%)");
    assert.ok(Math.abs((parakeetPercent(base) ?? 0) - 25.9) < 0.1);
    assert.equal(parakeetLine({ ...base, install: { ...base.install, phase: "verifying" } }), "Checking the download…");
    assert.equal(parakeetLine({ ...base, install: { ...base.install, phase: "unpacking" } }), "Unpacking the four model files…");
    assert.equal(parakeetPercent({ ...base, install: { ...base.install, phase: "unpacking" } }), 100);
    assert.equal(parakeetPercent({ ...base, state: "installed" }), null);
    assert.equal(parakeetLine({ ...base, state: "installed", refusal: "No." }), "No.");
    assert.equal(parakeetUsable({ ...base, state: "installed", refusal: "No." }), false);
    assert.equal(parakeetUsable({ ...base, state: "installed" }), true);
  });

  it("install runs once, shows progress, can fail in words, and can be cancelled", async () => {
    let release: (e?: Error) => void = () => {};
    let calls = 0;
    let signal: AbortSignal | undefined;
    const fake: typeof installModel = (deps = {}) => {
      calls++;
      signal = deps.signal;
      deps.onProgress?.({ phase: "downloading", received: 1024, total: MODEL.bytes, error: null });
      return new Promise<string>((ok, no) => {
        release = (e) => (e ? no(e) : ok("done"));
        deps.signal?.addEventListener("abort", () => no(new DOMException("Aborted", "AbortError")));
      });
    };
    const act = actionHandler({ install: fake });
    let s = (await (await act(post("/api/voice/parakeet", { action: "install" }))).json()) as ParakeetStatus;
    assert.equal(s.state, "installing");
    assert.equal(s.install.received, 1024);
    await act(post("/api/voice/parakeet", { action: "install" }));
    assert.equal(calls, 1, "a second press starts nothing");
    await assert.rejects(act(post("/api/voice/parakeet", { action: "remove" })), /still being set up/);
    release(new InstallError("The download was refused: its checksum doesn't match the speech model's. Nothing was unpacked."));
    await tick();
    s = await status();
    assert.equal(s.state, "missing");
    assert.equal(s.install.phase, "failed");
    assert.match(s.install.error ?? "", /checksum doesn't match/);
    // Again, then cancel: back to idle with no error.
    await act(post("/api/voice/parakeet", { action: "install" }));
    assert.equal(calls, 2);
    await act(post("/api/voice/parakeet", { action: "cancel" }));
    assert.equal(signal?.aborted, true);
    await tick();
    s = await status();
    assert.deepEqual([s.state, s.install.phase, s.install.error], ["missing", "idle", null]);
    await assert.rejects(act(post("/api/voice/parakeet", { action: "explode" })), /install, cancel, remove or preload/);
  });

  it("remove deletes WalkMyCode's copy and leaves iReliabee's", async () => {
    install();
    install(process.env.WALKMYCODE_IRELIABEE_MODELS_DIR);
    const s = (await (await actionHandler()(post("/api/voice/parakeet", { action: "remove" }))).json()) as ParakeetStatus;
    assert.deepEqual([s.state, s.source, s.removable], ["installed", "ireliabee", false]);
    assert.equal(existsSync(join(process.env.WALKMYCODE_MODELS_DIR!, MODEL.name)), false);
    assert.equal(isInstalled(join(process.env.WALKMYCODE_IRELIABEE_MODELS_DIR!, MODEL.name)), true);
  });

  it("preload loads only when the model is there, and never fails the request", async () => {
    let loaded = 0;
    const act = actionHandler({
      preload: async () => {
        loaded++;
        throw new Error("no engine");
      },
    });
    assert.equal((await act(post("/api/voice/parakeet", { action: "preload" }))).status, 200);
    assert.equal(loaded, 0, "nothing to load yet");
    install();
    assert.equal((await act(post("/api/voice/parakeet", { action: "preload" }))).status, 200);
    assert.equal(loaded, 1);
  });

  it("a hosted WalkMyCode refuses all of it", async () => {
    install();
    process.env.WALKMYCODE_MODE = "hosted";
    assert.match(hostedSttRefusal() ?? "", /hosted WalkMyCode can't offer it/);
    assert.equal(hostedSttRefusal({ LANTERN_MODE: "Hosted " }) !== null, true, "the old name too");
    assert.equal(hostedSttRefusal({}), null);
    const s = await parakeetStatus();
    assert.match(s.refusal ?? "", /hosted/);
    assert.equal(parakeetUsable(s), false);
    for (const action of ["install", "remove", "preload"]) {
      const res = await guarded(actionHandler())(post("/api/voice/parakeet", { action }));
      assert.equal(res.status, 403, action);
    }
    const res = await guarded(streamHandler({ decode: async () => "x" }))(post("/api/voice/parakeet/stream", { session: "abcdefgh12345678", pcm_base64: "AAAA" }));
    assert.equal(res.status, 403);
    assert.equal(isInstalled(join(process.env.WALKMYCODE_MODELS_DIR!, MODEL.name)), true, "nothing was removed");
  });

  it("uses most of a small machine's cores, never more than four, always at least one", () => {
    assert.deepEqual([1, 2, 3, 4, 5, 8, 12, 64].map(threadCount), [1, 1, 2, 3, 4, 4, 4, 4]);
  });
});

const b64 = (a: Float32Array) => {
  const pcm = new Int16Array(a.length);
  for (let i = 0; i < a.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(a[i] * 32768)));
  return Buffer.from(pcm.buffer).toString("base64");
};

describe("Parakeet: the stream route (fake engine)", () => {
  const route = (deps: Parameters<typeof streamHandler>[0] = {}) => guarded(streamHandler({ installed: () => true, decode: async (a) => `${(a.length / 16000).toFixed(1)}s of speech`, ...deps }));
  const req = (body: unknown, headers: Record<string, string> = {}) =>
    new Request("http://localhost:3000/api/voice/parakeet/stream", { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers }, body: JSON.stringify(body) });
  const events = async (res: Response) => ((await res.json()) as { events: SttEvent[] }).events;
  beforeEach(() => resetParakeetRoutes());

  it("takes the microphone in pieces and answers with what was heard: speech, then the final text", async () => {
    const h = route();
    const session = "sess-0001-abcdef";
    const audio = cat(room(1), voice(1.5), room(1.6));
    const seen: SttEvent[] = [];
    for (let i = 0; i < audio.length; i += 3200) seen.push(...(await events(await h(req({ session, pcm_base64: b64(audio.subarray(i, i + 3200)) })))));
    await tick();
    seen.push(...(await events(await h(req({ session })))));
    const types = seen.map((e) => e.type);
    assert.deepEqual(types.filter((t) => t !== "partial"), ["speech", "decoding", "final"], types.join(","));
    const final = seen.find((e) => e.type === "final");
    assert.ok(final?.type === "final" && /^\d\.\ds of speech$/.test(final.text));
  });

  it("flush decodes what is left before it answers (push-to-talk let go)", async () => {
    const h = route();
    const session = "sess-0002-abcdef";
    await h(req({ session, pcm_base64: b64(cat(room(0.5), voice(0.3))) }));
    const out = await events(await h(req({ session, flush: true })));
    assert.deepEqual(out.map((e) => e.type), ["decoding", "final"]);
    // reset forgets; close forgets the session itself.
    await h(req({ session, pcm_base64: b64(voice(1)) }));
    assert.deepEqual((await events(await h(req({ session, reset: true, flush: true })))).filter((e) => e.type === "final"), []);
    assert.equal((await h(req({ session, close: true }))).status, 200);
  });

  it("keeps sessions apart", async () => {
    const h = route();
    await h(req({ session: "aaaaaaaa-one", pcm_base64: b64(cat(room(0.5), voice(1))) }));
    const other = await events(await h(req({ session: "bbbbbbbb-two", pcm_base64: b64(room(0.5)), flush: true })));
    assert.deepEqual(other, []);
    const mine = await events(await h(req({ session: "aaaaaaaa-one", flush: true })));
    assert.ok(mine.some((e) => e.type === "final"));
  });

  it("is for this computer and WalkMyCode's own page only", async () => {
    const h = route();
    const body = { session: "sess-0003-abcdef", pcm_base64: b64(room(0.2)) };
    assert.equal((await h(req(body, { host: "192.168.1.20:3000" }))).status, 403, "not over the LAN");
    assert.equal((await h(req(body, { "sec-fetch-site": "cross-site" }))).status, 403, "not from another site");
    assert.equal((await h(req(body, { "content-type": "text/plain" }))).status, 403, "JSON only");
    assert.equal((await h(req(body))).status, 200);
  });

  it("refuses what is not a piece of audio, and says when the model is missing", async () => {
    const h = route();
    assert.equal((await h(req({ session: "short" }))).status, 400);
    assert.equal((await h(req({ pcm_base64: "AAAA" }))).status, 400);
    assert.equal((await h(req({ session: "sess-0004-abcdef", pcm_base64: "A".repeat(600_000) }))).status, 400, "longer than 10 s");
    const missing = await route({ installed: () => false })(req({ session: "sess-0005-abcdef", pcm_base64: "AAAA" }));
    assert.equal(missing.status, 409);
    assert.match(((await missing.json()) as { error: string }).error, /isn't on this computer yet/);
  });
});

describe("Parakeet: the page's stream client", () => {
  const frame = (v = 100) => new Int16Array(320).fill(v);
  /** A fake server: records each post's body; answers with the events queued for it. */
  function server(answers: SttEvent[][] = []) {
    const posts: { session: string; pcm_base64?: string; flush?: boolean; reset?: boolean; close?: boolean }[] = [];
    let hold: (() => void) | null = null;
    const state = { status: 200, fail: false, hang: false };
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(url, STREAM_URL);
      assert.equal((init?.headers as Record<string, string>)["content-type"], "application/json");
      posts.push(JSON.parse(String(init?.body)));
      if (state.hang) await new Promise<void>((r) => (hold = r));
      if (state.fail) throw new TypeError("fetch failed");
      if (state.status !== 200) return Response.json({ error: "The speech model isn't on this computer yet." }, { status: state.status });
      return Response.json({ events: answers.shift() ?? [] });
    }) as typeof fetch;
    return { posts, fetchImpl, state, release: () => hold?.() };
  }
  const settle = async () => {
    for (let i = 0; i < 6; i++) await tick();
  };

  it("sends 0.2 s at a time, one post after another, as 16-bit PCM", async () => {
    const s = server();
    const stream = new ParakeetStream({}, s.fetchImpl, "session-abc-1234");
    for (let i = 0; i < PIECE_FRAMES - 1; i++) stream.push(frame());
    await settle();
    assert.equal(s.posts.length, 0, "not yet a whole piece");
    stream.push(frame(258));
    await settle();
    assert.equal(s.posts.length, 1);
    assert.equal(s.posts[0].session, "session-abc-1234");
    const bytes = Buffer.from(s.posts[0].pcm_base64!, "base64");
    assert.equal(bytes.length, PIECE_FRAMES * 320 * 2);
    assert.deepEqual([bytes[0], bytes[1]], [100, 0], "little-endian");
    assert.deepEqual([bytes.at(-2), bytes.at(-1)], [2, 1]);
  });

  it("never has two posts in flight: what arrives meanwhile goes in the next", async () => {
    const s = server();
    s.state.hang = true;
    const stream = new ParakeetStream({}, s.fetchImpl);
    for (let i = 0; i < 35; i++) stream.push(frame());
    await settle();
    assert.equal(s.posts.length, 1);
    s.state.hang = false;
    s.release();
    await settle();
    assert.equal(s.posts.length, 2);
    assert.equal(Buffer.from(s.posts[1].pcm_base64!, "base64").length, 25 * 640, "the 25 frames that waited, together");
  });

  it("delivers the server's events in order", async () => {
    const s = server([[{ type: "speech" }, { type: "partial", text: "where does" }], [{ type: "decoding" }, { type: "final", text: "Where does sign-in happen?", ms: 400, audioS: 2 }, { type: "notice", message: "Previews are off." }, { type: "discard" }]]);
    const seen: string[] = [];
    const on: ParakeetEvents = { speech: () => seen.push("speech"), partial: (t) => seen.push(`partial:${t}`), decoding: () => seen.push("decoding"), final: (t) => seen.push(`final:${t}`), notice: (m) => seen.push(`notice:${m}`), discard: () => seen.push("discard") };
    const stream = new ParakeetStream(on, s.fetchImpl);
    for (let i = 0; i < 20; i++) {
      stream.push(frame());
      if (i === 9) await settle();
    }
    await settle();
    assert.deepEqual(seen, ["speech", "partial:where does", "decoding", "final:Where does sign-in happen?", "notice:Previews are off.", "discard"]);
  });

  it("flush sends what is left with flush: true and waits for its words", async () => {
    const s = server([[{ type: "final", text: "Yes.", ms: 100, audioS: 0.4 }]]);
    const seen: string[] = [];
    const stream = new ParakeetStream({ final: (t) => seen.push(t) }, s.fetchImpl);
    for (let i = 0; i < 4; i++) stream.push(frame());
    await stream.flush();
    assert.deepEqual(seen, ["Yes."], "the words were in before flush resolved");
    assert.equal(s.posts.length, 1);
    assert.equal(s.posts[0].flush, true);
    assert.equal(Buffer.from(s.posts[0].pcm_base64!, "base64").length, 4 * 640);
    await stream.flush();
    assert.deepEqual([s.posts[1].flush, s.posts[1].pcm_base64], [true, undefined], "an empty flush is still asked");
  });

  it("reset drops what was queued and tells the server; close ends the session", async () => {
    const s = server();
    const stream = new ParakeetStream({}, s.fetchImpl);
    for (let i = 0; i < 5; i++) stream.push(frame());
    stream.reset();
    await settle();
    assert.deepEqual([s.posts[0].reset, s.posts[0].pcm_base64], [true, undefined]);
    stream.close();
    await settle();
    assert.equal(s.posts.at(-1)?.close, true);
    const n = s.posts.length;
    for (let i = 0; i < 20; i++) stream.push(frame());
    await stream.flush();
    assert.equal(s.posts.length, n, "nothing after close");
  });

  it("a refusal or a dead server is one error in words, then silence", async () => {
    for (const how of ["status", "network"] as const) {
      const s = server();
      if (how === "status") s.state.status = 409;
      else s.state.fail = true;
      const errors: string[] = [];
      const stream = new ParakeetStream({ error: (m) => errors.push(m) }, s.fetchImpl);
      for (let i = 0; i < 40; i++) stream.push(frame());
      await settle();
      await stream.flush();
      assert.equal(errors.length, 1, how);
      assert.match(errors[0], how === "status" ? /isn't on this computer yet/ : /fetch failed|stopped/);
      assert.equal(s.posts.length, 1, "it stopped sending");
    }
  });
});

describe("Parakeet: the Ear and the Learn dictation (fake microphone and stream)", () => {
  const loud = () => {
    const f = new Int16Array(320);
    for (let i = 0; i < f.length; i++) f[i] = Math.round(Math.sin((2 * Math.PI * 180 * i) / 16000) * 0.3 * 32767);
    return f;
  };
  const quiet = () => new Int16Array(320).fill(20);

  function rig() {
    const log: string[] = [];
    let frames = 0;
    let on: ParakeetEvents = {};
    let feedMic: (f: Int16Array) => void = () => {};
    const stream: ParakeetLike = { push: () => void frames++, flush: async () => void log.push("flush"), reset: () => void log.push("reset"), close: () => void log.push("close") };
    const mic = async (cb: (f: Int16Array) => void): Promise<MicHandle> => {
      feedMic = cb;
      return { close: () => void log.push("mic-closed") };
    };
    return { log, mic, stream, on: () => on, setOn: (o: ParakeetEvents) => (on = o), feed: (f: Int16Array, n = 1) => { for (let i = 0; i < n; i++) feedMic(f); }, frames: () => frames };
  }

  it("streams every frame while speech counts, and turns the server's events into the Ear's", async () => {
    const r = rig();
    const seen: string[] = [];
    const ear = new Ear(
      { via: "parakeet", mic: r.mic, parakeet: (on) => (r.setOn(on), r.stream) },
      { speechStart: (b) => seen.push(`start:${b}`), interim: (t) => seen.push(`interim:${t}`), transcribing: () => seen.push("writing"), utterance: (t) => seen.push(`utterance:${t}`), notice: (m) => seen.push(`notice:${m}`), error: (m) => seen.push(`error:${m}`) },
    );
    await ear.start();
    r.feed(quiet(), 20);
    assert.equal(r.frames(), 20, "the server finds the speech: everything is sent");
    r.on().speech?.();
    r.on().speech?.();
    r.on().partial?.("where does");
    r.on().decoding?.();
    r.on().final?.(" Where does sign-in happen? ");
    r.on().notice?.("Previews are off.");
    assert.deepEqual(seen, ["start:false", "interim:where does", "writing", "interim:", "utterance:Where does sign-in happen?", "notice:Previews are off."]);
    // The next utterance is told again.
    r.on().speech?.();
    assert.equal(seen.at(-1), "start:false");
    // Hold to talk let go: the server drains. Muted: it forgets, and nothing is sent.
    ear.commit();
    ear.setOpen(false);
    r.feed(loud(), 10);
    assert.equal(r.frames(), 20);
    assert.deepEqual(r.log, ["flush", "reset"]);
    ear.close();
    assert.deepEqual(r.log.slice(-2), ["mic-closed", "close"]);
    r.on().final?.("late");
    assert.equal(seen.filter((s) => s.startsWith("utterance")).length, 1, "nothing after close");
  });

  it("holds back our own voice's echo, and lets a barge-in through with its first word", async () => {
    const r = rig();
    const seen: string[] = [];
    const ear = new Ear({ via: "parakeet", mic: r.mic, parakeet: (on) => (r.setOn(on), r.stream) }, { speechStart: (b) => seen.push(`start:${b}`) });
    await ear.start();
    r.feed(quiet(), 20);
    const before = r.frames();
    ear.setPlayback(true);
    r.feed(quiet(), 50); // the narration, heard back quietly
    assert.equal(r.frames(), before, "nothing is streamed while our own voice plays");
    r.feed(loud(), 12); // the user cuts in
    assert.deepEqual(seen, ["start:true"]);
    assert.ok(r.frames() > before + 8, `the held-back start of the barge-in was sent: ${r.frames() - before} frames`);
    const mid = r.frames();
    r.feed(loud(), 5);
    assert.equal(r.frames(), mid + 5, "then every frame, though the voice is still stopping");
    // The server's own "speech" for the same utterance is not told twice.
    r.on().speech?.();
    assert.deepEqual(seen, ["start:true"]);
  });

  it("the Learn mic: words as they come, every utterance joined, and stop waits for the rest", async () => {
    const r = rig();
    const seen: string[] = [];
    let flushed: () => void = () => {};
    r.stream.flush = () =>
      new Promise<void>((ok) => {
        r.log.push("flush");
        flushed = ok;
      });
    const d = dictate({ onText: (t) => seen.push(`text:${t}`), onDone: (t) => seen.push(`done:${t}`), onError: (m) => seen.push(`error:${m}`) }, { mic: r.mic, stream: (on) => (r.setOn(on), r.stream) });
    assert.ok(d);
    await tick();
    r.feed(loud(), 5);
    assert.equal(r.frames(), 5);
    r.on().partial?.("what is a");
    r.on().final?.("What is a closure?");
    r.on().partial?.("and why");
    assert.deepEqual(seen, ["text:what is a", "text:What is a closure?", "text:What is a closure? and why"]);
    d.stop();
    assert.deepEqual(r.log, ["mic-closed", "flush"], "the microphone goes at once; the words are waited for");
    r.feed(loud(), 5);
    assert.equal(r.frames(), 5, "nothing more is sent");
    r.on().final?.("And why does it matter?");
    assert.equal(seen.some((s) => s.startsWith("done")), false);
    flushed();
    await tick();
    assert.equal(seen.at(-1), "done:What is a closure? And why does it matter?");
    assert.equal(r.log.at(-1), "close");
  });

  it("the Learn mic: cancel throws the words away; a blocked microphone says so", async () => {
    const r = rig();
    const seen: string[] = [];
    const d = dictate({ onText: () => {}, onDone: (t) => seen.push(`done:${t}`) }, { mic: r.mic, stream: (on) => (r.setOn(on), r.stream) });
    await tick();
    d?.cancel();
    d?.stop();
    assert.deepEqual(seen, []);
    assert.deepEqual(r.log, ["mic-closed", "close"]);
    const blocked: string[] = [];
    dictate({ onText: () => {}, onDone: () => {}, onError: (m) => blocked.push(m) }, { mic: async () => Promise.reject(new Error("NotAllowedError")), stream: () => r.stream });
    await tick();
    assert.deepEqual(blocked, ["The microphone is blocked for this page."]);
  });
});
