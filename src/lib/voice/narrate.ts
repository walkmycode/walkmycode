"use client";
// The narrators (docs/VOICE.md §2): ElevenLabs and Deepgram through
// /api/voice/speak, and the browser's own speechSynthesis (a British English
// voice first, as Lecture Hall). One interface, so the tour player and "Read
// aloud" do not care which one reads. Loaded on first use, never with the map.
//
// Server narration plays while it downloads (MediaSource, where the browser
// takes audio/mpeg there; else once it has all arrived), lights each word as it
// is heard (ElevenLabs sends character timings; Deepgram's words are measured
// from its audio, measure.ts), and is cached per map
// (audioCache.ts), so a replay costs nothing and the next tour step can be
// fetched while this one plays.
import { addNarration } from "@/lib/cost";
import type { FriendlyError } from "@/lib/providers/wire";
import { AudioCache, audioKey, idbAudioStore, type CachedAudio, type Scope } from "./audioCache";
import { NARRATORS, type NarratorId } from "./catalogue";
import { routeError, UNREACHABLE, VoiceError } from "./errors";
import { measureWords, wordHeardAt } from "./measure";
import { sentenceSpans, wordSpanAt, wordTimings, type Alignment, type Span, type SpokenWord } from "./speech";
import { sharedAudio } from "./view";

export type { Scope };

export interface SpeakOptions {
  /** The word being heard, as offsets into the text; null when none is: before the first, in a pause, at the end. */
  onWord?: (w: Span | null) => void;
  /** Once, when the audio is actually heard. */
  onStart?: () => void;
  /** The map the text belongs to: its audio is cached under it. Without one, nothing is cached. */
  scope?: Scope;
}

/** How a reading ended: heard to the end, or stopped (by stop(), or another reading). */
export type SpeakEnd = "ended" | "stopped";

export interface Narrator {
  readonly id: NarratorId;
  /** Words can be lit as they are heard (ElevenLabs' timings, the browser's word boundaries). */
  readonly marks: boolean;
  /** Read a text aloud. Resolves when it has been heard, or was stopped; rejects with a VoiceError. */
  speak(text: string, o?: SpeakOptions): Promise<SpeakEnd>;
  /** Fetch (and cache) a text's audio without playing it. Nothing to do for the browser's voice. */
  prefetch(text: string, scope?: Scope): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  readonly paused: boolean;
}

export { VoiceError };

const BLOCKED: FriendlyError = { code: "unknown", title: "The browser held the sound back", message: "Press play again: browsers start sound only after a click on the page.", action: "retry" };
const NO_SPEECH: FriendlyError = { code: "unknown", title: "This browser has no voice", message: "It offers no speech synthesis. Pick ElevenLabs or Deepgram in Settings → Voice.", action: "settings" };

const errorOf = (res: Response) => routeError(res, "Narration failed");

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

const toArrayBuffer = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Reads /api/voice/speak's answer: audio/mpeg bytes, or NDJSON {audio_base64, alignment} lines. */
export async function readSpeech(res: Response, text: string, sink?: Sink): Promise<CachedAudio> {
  const parts: Uint8Array[] = [];
  const chunks: (Alignment | null)[] = [];
  const reader = res.body!.getReader();
  if ((res.headers.get("content-type") ?? "").includes("ndjson")) {
    const dec = new TextDecoder();
    let buf = "";
    const line = (raw: string) => {
      const l = raw.trim();
      if (!l) return;
      const o = JSON.parse(l) as { audio_base64?: string; alignment?: Alignment | null };
      if (typeof o.audio_base64 !== "string") return;
      const bytes = fromBase64(o.audio_base64);
      parts.push(bytes);
      chunks.push(o.alignment ?? null);
      sink?.bytes(bytes);
      if (o.alignment) sink?.words(wordTimings(text, chunks));
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        line(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    }
    line(buf + dec.decode());
  } else {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value?.byteLength) {
        parts.push(value);
        sink?.bytes(value);
      }
    }
  }
  return { bytes: concat(parts), words: chunks.some(Boolean) ? wordTimings(text, chunks) : [], type: "audio/mpeg" };
}

/** Where a reading's audio goes as it arrives. */
interface Sink {
  bytes(b: Uint8Array): void;
  words(w: SpokenWord[]): void;
  end(): void;
  whole(v: CachedAudio): void;
}

/** One reading through the shared <audio>: streamed in through MediaSource, or played whole. */
class Playback {
  readonly ac = new AbortController();
  readonly done: Promise<SpeakEnd>;
  stopped = false;
  private settle!: (e: SpeakEnd) => void;
  private failWith!: (e: unknown) => void;
  private ms: MediaSource | null = null;
  private sb: SourceBuffer | null = null;
  private queue: Uint8Array[] = [];
  private collected: Uint8Array[] = [];
  private ended = false;
  private url: string | null = null;
  private words: SpokenWord[] = [];
  private raf = 0;
  private lastWord = -2;
  private started = false;
  private finished = false;
  /** Paused before or while the audio arrives: nothing plays until resume(). */
  private held = false;

  constructor(
    readonly audio: HTMLAudioElement,
    private opts: SpeakOptions,
  ) {
    this.done = new Promise<SpeakEnd>((resolve, reject) => {
      this.settle = resolve;
      this.failWith = reject;
    });
    audio.onended = () => this.finish("ended");
    audio.onplaying = () => {
      if (!this.started) {
        this.started = true;
        opts.onStart?.();
      }
      this.tick();
    };
    audio.onpause = () => cancelAnimationFrame(this.raf);
    audio.onerror = () => {
      if (!this.stopped && !this.finished && this.url) this.fail(new VoiceError({ code: "unknown", title: "The audio could not be played", message: "The browser could not decode the narration. Try again, or pick another voice in Settings → Voice.", action: "retry" }));
    };
  }

  private static streams(): boolean {
    return typeof MediaSource !== "undefined" && MediaSource.isTypeSupported("audio/mpeg");
  }

  sink(): Sink {
    return {
      bytes: (b) => this.append(b),
      words: (w) => {
        this.words = w;
      },
      end: () => this.endStream(),
      whole: (v) => this.playWhole(v),
    };
  }

  private append(b: Uint8Array) {
    if (this.stopped) return;
    if (!Playback.streams()) {
      this.collected.push(b);
      return;
    }
    if (!this.ms) {
      const ms = new MediaSource();
      this.ms = ms;
      this.url = URL.createObjectURL(ms);
      ms.addEventListener(
        "sourceopen",
        () => {
          try {
            this.sb = ms.addSourceBuffer("audio/mpeg");
            this.sb.mode = "sequence";
            this.sb.addEventListener("updateend", () => this.pump());
          } catch {
            // This browser said yes to audio/mpeg but will not take it: wait and play the whole file.
            this.ms = null;
            this.collected.push(...this.queue);
            this.queue = [];
          }
          this.pump();
        },
        { once: true },
      );
      this.audio.src = this.url;
      this.play();
    }
    if (this.ms) this.queue.push(b);
    else this.collected.push(b);
    this.pump();
  }

  private pump() {
    const { sb, ms } = this;
    if (!sb || !ms || sb.updating || ms.readyState !== "open") return;
    const next = this.queue.shift();
    if (next) {
      try {
        sb.appendBuffer(toArrayBuffer(next));
      } catch {
        // Full or detached: the rest is dropped; what was appended still plays.
        this.queue = [];
      }
      return;
    }
    if (this.ended) {
      try {
        ms.endOfStream();
      } catch {
        // Already ended or closed.
      }
    }
  }

  private endStream() {
    this.ended = true;
    if (this.ms) this.pump();
    else this.playWhole({ bytes: concat(this.collected), words: this.words, type: "audio/mpeg" });
  }

  private playWhole(v: CachedAudio) {
    if (this.stopped) return;
    this.words = v.words;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(new Blob([toArrayBuffer(v.bytes)], { type: v.type || "audio/mpeg" }));
    this.audio.src = this.url;
    this.play();
  }

  private play() {
    if (this.held || this.stopped || this.finished) return;
    this.audio.playbackRate = 1;
    void this.audio.play().catch((e: unknown) => {
      if (this.stopped || this.finished) return;
      if ((e as { name?: string })?.name === "NotAllowedError") this.fail(new VoiceError(BLOCKED));
      // AbortError: a newer src replaced this one, nothing to report.
    });
  }

  get paused(): boolean {
    return this.held;
  }

  hold() {
    this.held = true;
    this.audio.pause();
  }

  unhold() {
    if (!this.held) return;
    this.held = false;
    if (this.url) this.play();
  }

  /** Light the word being heard, once per change, on animation frames while playing. */
  private tick = () => {
    cancelAnimationFrame(this.raf);
    if (this.stopped || this.finished || !this.opts.onWord) return;
    if (this.words.length) {
      const i = wordHeardAt(this.words, this.audio.currentTime);
      if (i !== this.lastWord) {
        this.lastWord = i;
        this.opts.onWord(i >= 0 ? { from: this.words[i].from, to: this.words[i].to } : null);
      }
    }
    if (!this.audio.paused) this.raf = requestAnimationFrame(this.tick);
  };

  private teardown() {
    cancelAnimationFrame(this.raf);
    this.audio.onended = this.audio.onplaying = this.audio.onpause = this.audio.onerror = null;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.opts.onWord?.(null);
  }

  private finish(e: SpeakEnd) {
    if (this.finished) return;
    this.finished = true;
    this.teardown();
    this.settle(e);
  }

  fail(e: unknown) {
    if (this.finished) return;
    this.finished = true;
    this.ac.abort();
    this.teardown();
    this.failWith(e);
  }

  stop() {
    if (this.finished) return;
    this.stopped = true;
    this.ac.abort();
    this.audio.pause();
    this.finish("stopped");
    this.audio.removeAttribute("src");
    this.audio.load();
  }
}

export interface ServerNarratorOptions {
  voiceId: string | null;
  speed: number;
  /** Settings' "Test voice": send the choice with the text, as it is not saved yet. */
  trial?: boolean;
  cache?: AudioCache;
  fetch?: typeof fetch;
  audio?: () => HTMLAudioElement;
  /** Times the words of a text against its audio, for a narrator that sends no timings (measure.ts). */
  measure?: (text: string, bytes: Uint8Array) => Promise<SpokenWord[]>;
}

/** ElevenLabs or Deepgram, read through /api/voice/speak. */
export class ServerNarrator implements Narrator {
  readonly marks: boolean;
  private run: Playback | null = null;
  private inflight = new Map<string, Promise<CachedAudio>>();

  constructor(
    readonly id: "elevenlabs" | "deepgram",
    private o: ServerNarratorOptions,
  ) {
    this.marks = NARRATORS[id].timings;
  }

  get paused(): boolean {
    return !!this.run && !this.run.stopped && this.run.paused;
  }

  private key(text: string) {
    return audioKey([this.id, this.o.voiceId ?? "auto", this.o.speed, text]);
  }

  async prefetch(text: string, scope?: Scope): Promise<void> {
    await this.load(text, scope).catch(() => {});
  }

  /** The text's audio: from the cache, a fetch already on its way, or the server (counted in the meter). */
  private async load(text: string, scope: Scope | undefined, sink?: Sink, signal?: AbortSignal): Promise<CachedAudio> {
    const key = await this.key(text);
    const cache = this.o.cache ?? sharedCache();
    if (scope) {
      const hit = await cache.get(scope, key);
      if (hit) {
        // Audio kept from before words were measured: measure it now, once.
        const timed = await this.timed(text, hit);
        if (timed !== hit) await cache.put(scope, key, timed);
        sink?.whole(timed);
        return timed;
      }
    }
    const pending = this.inflight.get(key);
    if (pending) {
      const v = await pending;
      sink?.whole(v);
      return v;
    }
    const p = this.fetchAudio(text, sink, signal)
      .then(async (v) => {
        if (scope && v.bytes.byteLength) await cache.put(scope, key, v);
        return v;
      })
      .finally(() => this.inflight.delete(key));
    // A reading that is stopped aborts its own fetch; a prefetch (no signal) is shared.
    if (!signal) this.inflight.set(key, p);
    return p;
  }

  private async fetchAudio(text: string, sink: Sink | undefined, signal: AbortSignal | undefined): Promise<CachedAudio> {
    const body: Record<string, unknown> = { text };
    if (this.o.trial) Object.assign(body, { narrator: this.id, speed: this.o.speed, ...(this.o.voiceId ? { voice_id: this.o.voiceId } : {}) });
    let res: Response;
    try {
      res = await (this.o.fetch ?? fetch)(`/api/voice/speak${this.marks ? "?timestamps=1" : ""}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new VoiceError(UNREACHABLE);
    }
    if (!res.ok || !res.body) throw new VoiceError(await errorOf(res));
    addNarration(this.id, text.length);
    const v = await readSpeech(res, text, sink);
    sink?.end();
    const timed = await this.timed(text, v);
    if (timed !== v) sink?.words(timed.words);
    return timed;
  }

  /** The audio with its words timed: as the narrator sent them, else measured from the sound. */
  private async timed(text: string, v: CachedAudio): Promise<CachedAudio> {
    if (v.words.length || !v.bytes.byteLength) return v;
    const words = await (this.o.measure ?? measureWords)(text, v.bytes);
    return words.length ? { ...v, words } : v;
  }

  async speak(text: string, opts: SpeakOptions = {}): Promise<SpeakEnd> {
    this.stop();
    const run = new Playback((this.o.audio ?? sharedAudio)(), opts);
    this.run = run;
    this.load(text, opts.scope, run.sink(), run.ac.signal).catch((e: unknown) => {
      if (!run.stopped) run.fail(e instanceof VoiceError ? e : new VoiceError(UNREACHABLE));
    });
    return run.done;
  }

  pause(): void {
    this.run?.hold();
  }

  resume(): void {
    if (this.run && !this.run.stopped) this.run.unhold();
  }

  stop(): void {
    this.run?.stop();
    this.run = null;
  }
}

// ── The browser's voice ──

const score = (v: SpeechSynthesisVoice) => (/en-GB/i.test(v.lang) ? 4 : 0) + (/natural|neural|online/i.test(v.name) ? 3 : 0) + (/male|george|ryan|daniel|thomas|arthur/i.test(v.name) ? 1 : 0);

/** English voices, British first (then natural ones), as Lecture Hall picks them. */
export function rankVoices(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return voices.filter((v) => /^en/i.test(v.lang)).sort((a, b) => score(b) - score(a));
}

/** The browser's English voices, waiting a moment for them to load on browsers that list them late. */
export async function browserVoices(synth: SpeechSynthesis | undefined = typeof window !== "undefined" ? window.speechSynthesis : undefined): Promise<SpeechSynthesisVoice[]> {
  if (!synth) return [];
  let list = synth.getVoices();
  if (!list.length) {
    list = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
      const t = setTimeout(() => resolve(synth.getVoices()), 1200);
      synth.addEventListener(
        "voiceschanged",
        () => {
          clearTimeout(t);
          resolve(synth.getVoices());
        },
        { once: true },
      );
    });
  }
  return rankVoices(list);
}

/** speechSynthesis, a sentence at a time (some engines stop part-way through a long utterance). */
export class BrowserNarrator implements Narrator {
  readonly id = "browser" as const;
  readonly marks = true;
  private token = 0;
  private settle: ((e: SpeakEnd) => void) | null = null;
  private isPaused = false;

  constructor(private o: { voiceId: string | null; speed: number; synth?: SpeechSynthesis }) {}

  private synth(): SpeechSynthesis | undefined {
    return this.o.synth ?? (typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : undefined);
  }

  get paused(): boolean {
    return this.isPaused;
  }

  async prefetch(): Promise<void> {}

  async speak(text: string, opts: SpeakOptions = {}): Promise<SpeakEnd> {
    this.stop();
    const synth = this.synth();
    if (!synth) throw new VoiceError(NO_SPEECH);
    const my = ++this.token;
    const voices = await browserVoices(synth);
    if (my !== this.token) return "stopped";
    const voice = voices.find((v) => v.name === this.o.voiceId) ?? voices[0] ?? null;
    const spans = sentenceSpans(text);
    this.isPaused = false;
    return new Promise<SpeakEnd>((resolve) => {
      this.settle = (e) => {
        this.settle = null;
        opts.onWord?.(null);
        resolve(e);
      };
      let i = 0;
      let started = false;
      const next = () => {
        if (my !== this.token) return;
        if (i >= spans.length) return this.settle?.("ended");
        const s = spans[i++];
        const part = text.slice(s.from, s.to);
        const u = new SpeechSynthesisUtterance(part);
        if (voice) {
          u.voice = voice;
          u.lang = voice.lang;
        } else u.lang = "en-GB";
        u.rate = this.o.speed;
        let moved = false;
        let guard: ReturnType<typeof setTimeout> | undefined;
        const go = () => {
          if (moved) return;
          moved = true;
          clearTimeout(guard);
          next();
        };
        // Some engines never fire onend: move on after about as long as reading it takes (not while paused).
        const arm = () => {
          clearTimeout(guard);
          guard = setTimeout(() => (this.isPaused ? arm() : go()), Math.max(8000, (part.length * 120) / this.o.speed));
        };
        u.onstart = () => {
          if (!started) {
            started = true;
            opts.onStart?.();
          }
        };
        u.onboundary = (e) => {
          if (e.name && e.name !== "word") return;
          const w = wordSpanAt(text, s.from + e.charIndex);
          if (w) opts.onWord?.(w);
        };
        u.onend = go;
        u.onerror = (e) => {
          if (e.error === "interrupted" || e.error === "canceled") return;
          go();
        };
        arm();
        synth.speak(u);
      };
      next();
    });
  }

  pause(): void {
    this.isPaused = true;
    this.synth()?.pause();
  }

  resume(): void {
    this.isPaused = false;
    this.synth()?.resume();
  }

  stop(): void {
    this.token++;
    this.isPaused = false;
    this.synth()?.cancel();
    this.settle?.("stopped");
  }
}

// ── One narrator for the page ──

let cache: AudioCache | null = null;
function sharedCache(): AudioCache {
  cache ??= new AudioCache(idbAudioStore());
  return cache;
}

let current: { sig: string; n: Narrator } | null = null;

/** The narrator for a choice. One at a time: asking for another stops the one reading now. */
export function getNarrator(c: { narrator: NarratorId; voiceId: string | null; speed: number }): Narrator {
  const sig = `${c.narrator}|${c.voiceId ?? ""}|${c.speed}`;
  if (current?.sig === sig) return current.n;
  current?.n.stop();
  const n: Narrator = c.narrator === "browser" ? new BrowserNarrator({ voiceId: c.voiceId, speed: c.speed }) : new ServerNarrator(c.narrator, { voiceId: c.voiceId, speed: c.speed });
  current = { sig, n };
  return n;
}

/** Stop whatever is being read aloud (the lecturer is about to speak, the room is closing). */
export function stopNarration(): void {
  current?.n.stop();
}
