// Hands-free hearing for Talk through Claude and Free voice (docs/MCP.md §4,
// docs/VOICE.md §4c): the microphone stays open for the whole conversation,
// a small VAD (vad.ts) finds where each utterance starts and ends, and each
// utterance comes out as text, once:
//  - "browser": the browser's own speech recognition runs continuously and
//    shows the words as they come; an utterance ends at the VAD's silence (or
//    the recognizer's final result when the VAD heard nothing);
//  - a server transcriber ("groq-turbo", "groq-large", "deepgram",
//    "elevenlabs"): the utterance's audio (with a little from just before it
//    began) goes as a WAV to the local server, which transcribes it with the
//    user's key;
//  - "parakeet" (on this computer): every frame streams to the local server
//    while speech counts, and the server finds the utterances itself and
//    sends the words back as they come (src/lib/voice/parakeet). The VAD here
//    still listens, for the level and for a barge-in over our own voice.
// While our own voice plays, what the mic hears is taken for its echo unless
// it is clearly louder (a barge-in), which the page answers by stopping the
// voice. The microphone is released by close().
import type { SttId } from "../catalogue";
import { MIC_FRAME, MIC_PROCESSOR, WORKLET_SOURCE } from "../lecturer/worklets";
import { RECOGNITION_ERRORS, transcribeRequest, type Recognition, type RecognitionCtor, type ServerStt } from "../listen";
import type { ParakeetEvents, ParakeetLike } from "../parakeet/client";
import { rms, Vad, type VadEvent } from "./vad";
import { pcmToWav, Transcript, type HeardResult } from "./utterance";

export type EarVia = SttId;

export interface EarEvents {
  /** The microphone's level, 0–1, every 20 ms. */
  level?(level: number): void;
  /** Speech began; `barge` when it was over our own voice. */
  speechStart?(barge: boolean): void;
  /** The words of the utterance so far (browser recognition). */
  interim?(text: string): void;
  /** An utterance's audio went to the server transcriber; its text follows as utterance(). */
  transcribing?(): void;
  /** One finished utterance. Empty when nothing intelligible was said. */
  utterance?(text: string): void;
  /** Something stopped hearing: in words for the user. */
  error?(message: string): void;
  /** Something to tell the user that stops nothing (on-device previews turned off, and why). */
  notice?(message: string): void;
}

export interface MicHandle {
  close(): void;
}

export interface EarDeps {
  via: EarVia;
  /** Start the microphone; each 20 ms 16 kHz linear16 frame goes to onFrame. */
  mic: (onFrame: (frame: Int16Array) => void) => Promise<MicHandle>;
  Recognition?: RecognitionCtor | null;
  /** The utterance's WAV to text (the local server and the user's key). */
  transcribe?: (wav: Uint8Array) => Promise<string>;
  /** On-device speech to text: the stream to the local server, telling these events what it heard. */
  parakeet?: (on: ParakeetEvents) => ParakeetLike;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
}

/** Audio kept from just before speech is detected, so the first word is whole. */
const PREROLL_FRAMES = 15;
/** After the VAD's end, how long the recognizer may take to send its last words. */
const SETTLE_MS = 350;
/** Words heard without the VAD noticing (a quiet voice): sent after this much calm. */
const WORDS_CALM_MS = 1200;

export class Ear {
  readonly vad = new Vad();
  private open = true;
  private playing = false;
  private barged = false;
  private closed = false;
  private mic: MicHandle | null = null;
  private rec: Recognition | null = null;
  private transcript = new Transcript();
  private timer: unknown = null;
  private preroll: Int16Array[] = [];
  private clip: Int16Array[] | null = null;
  /** On-device speech to text: where the frames go, and whether this utterance's start was told. */
  private stream: ParakeetLike | null = null;
  private told = false;

  constructor(
    private deps: EarDeps,
    private on: EarEvents,
  ) {
    if (deps.via === "parakeet" && deps.parakeet) {
      this.stream = deps.parakeet({
        speech: () => this.speechHeard(false),
        partial: (text) => !this.closed && this.open && this.on.interim?.(text),
        decoding: () => !this.closed && this.on.transcribing?.(),
        final: (text) => {
          this.told = false;
          if (this.closed) return;
          this.on.interim?.("");
          this.on.utterance?.(text.trim());
        },
        discard: () => {
          this.told = false;
        },
        notice: (m) => !this.closed && this.on.notice?.(m),
        error: (m) => !this.closed && this.on.error?.(m),
      });
    }
  }

  /** An utterance began (the server heard it, or the VAD here heard a barge-in): told once. */
  private speechHeard(barge: boolean): void {
    if (this.closed || this.told) return;
    this.told = true;
    this.on.speechStart?.(barge);
  }

  async start(): Promise<void> {
    if (this.deps.via === "browser") this.startRecognition();
    let mic: MicHandle;
    try {
      mic = await this.deps.mic((f) => this.frame(f));
    } catch (e) {
      // The browser's recognition has a microphone of its own: without ours there is no level
      // ring and no silence detector, and its own final results end each utterance.
      if (this.deps.via === "browser" && this.rec) return;
      throw e;
    }
    if (this.closed) return mic.close();
    this.mic = mic;
  }

  /** Whether speech counts now (false: muted, or push-to-talk not held). */
  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    if (!open) {
      this.vad.reset();
      this.clip = null;
      this.cancelTimer();
      this.transcript.drop();
      this.stream?.reset();
      this.told = false;
      this.on.interim?.("");
    }
  }

  /** Our own voice started or stopped playing. */
  setPlayback(on: boolean): void {
    if (on === this.playing) return;
    this.playing = on;
    this.vad.setPlayback(on);
    if (on) {
      this.barged = false;
      return;
    }
    // It stopped by itself: whatever the recognizer heard meanwhile was our own voice.
    if (!this.barged) {
      this.transcript.drop();
      this.on.interim?.("");
    }
    // On-device: nothing was streamed while it played; what was kept back was its echo.
    if (this.stream && !this.barged) this.preroll = [];
  }

  /** End the utterance now (push-to-talk let go). */
  commit(): void {
    this.cancelTimer();
    if (this.deps.via === "browser") return this.send();
    if (this.stream) {
      // The server decodes what is left; its words arrive as the final event.
      void this.stream.flush();
      return;
    }
    const clip = this.clip;
    this.clip = null;
    this.vad.reset();
    if (clip) void this.transcribe(clip);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.cancelTimer();
    this.mic?.close();
    this.mic = null;
    this.stream?.close();
    const rec = this.rec;
    this.rec = null;
    try {
      rec?.abort();
    } catch {
      // already stopped
    }
  }

  // ── the microphone ──

  private frame(f: Int16Array): void {
    if (this.closed) return;
    const level = rms(f, true);
    this.on.level?.(this.open ? level : 0);
    if (!this.open) return;
    if (this.stream) return this.streamFrame(f, level);
    if (this.clip) this.clip.push(f);
    else {
      this.preroll.push(f);
      if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift();
    }
    const e = this.vad.push(level);
    if (e) this.vadEvent(e);
  }

  /** On-device: frames go straight to the server, except our own voice's echo (held back until someone cuts in). */
  private streamFrame(f: Int16Array, level: number): void {
    const e = this.vad.push(level);
    if (this.playing && !this.barged) {
      this.preroll.push(f);
      if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift();
      if (e?.type !== "start" || !e.barge) return;
      // A barge-in: what was held back is the start of it.
      this.barged = true;
      for (const p of this.preroll) this.stream!.push(p);
      this.preroll = [];
      this.speechHeard(true);
      return;
    }
    this.stream!.push(f);
  }

  private vadEvent(e: VadEvent): void {
    if (e.type === "start") {
      this.cancelTimer();
      if (e.barge) this.barged = true;
      if (this.deps.via !== "browser") {
        this.clip = this.preroll;
        this.preroll = [];
      }
      this.on.speechStart?.(e.barge);
      return;
    }
    if (e.type === "discard") {
      this.clip = null;
      return;
    }
    if (this.deps.via !== "browser") {
      const clip = this.clip;
      this.clip = null;
      if (clip) void this.transcribe(clip);
      return;
    }
    // The browser's words may still be on their way.
    this.schedule(this.transcript.settled() ? 0 : SETTLE_MS, true);
  }

  private async transcribe(clip: Int16Array[]): Promise<void> {
    if (!this.deps.transcribe) return;
    this.on.transcribing?.();
    try {
      const text = await this.deps.transcribe(pcmToWav(clip));
      if (!this.closed) this.on.utterance?.(text.trim());
    } catch (e) {
      if (!this.closed) this.on.error?.((e as Error)?.message || "That couldn't be heard. Try again, or type it.");
    }
  }

  // ── the browser's recognition ──

  private startRecognition(): void {
    const Ctor = this.deps.Recognition;
    if (!Ctor) {
      this.on.error?.("This browser can't turn speech into text. Type your question instead.");
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-GB";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      const list: HeardResult[] = [];
      for (let i = 0; i < e.results.length; i++) list.push({ text: e.results[i][0]?.transcript ?? "", final: e.results[i].isFinal });
      this.heard(list);
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      this.on.error?.(RECOGNITION_ERRORS[e.error] ?? `Speech recognition stopped (${e.error}). Type your question instead.`);
      if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture") this.rec = null;
    };
    // Recognizers stop now and then (a long quiet, the network): carry on while the conversation does.
    rec.onend = () => {
      if (this.closed || this.rec !== rec) return;
      this.transcript.restart();
      try {
        rec.start();
      } catch {
        this.rec = null;
      }
    };
    this.rec = rec;
    try {
      rec.start();
    } catch {
      this.rec = null;
      this.on.error?.("Speech recognition didn't start. Type your question instead.");
    }
  }

  /** The recognizer's results, as they stand. */
  heard(list: HeardResult[]): void {
    if (this.closed) return;
    this.transcript.update(list);
    if (!this.open) return this.transcript.drop();
    // Our own voice is playing and nobody cut in: the finished phrases are its echo.
    if (this.playing && !this.barged) return this.transcript.drop(true);
    const text = this.transcript.text();
    this.on.interim?.(text);
    if (!text || this.vad.speaking) return;
    this.schedule(this.transcript.settled() ? SETTLE_MS : WORDS_CALM_MS, false);
  }

  private schedule(ms: number, fromVad: boolean): void {
    this.cancelTimer();
    const set = this.deps.setTimeout ?? ((f: () => void, t: number) => setTimeout(f, t));
    this.timer = set(() => {
      this.timer = null;
      if (!fromVad && this.vad.speaking) return;
      this.send();
    }, ms);
  }

  private send(): void {
    const text = this.transcript.take();
    this.on.interim?.("");
    if (text) this.on.utterance?.(text);
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    (this.deps.clearTimeout ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer);
    this.timer = null;
  }
}

/**
 * The browser's microphone with echo cancellation, noise suppression and
 * automatic gain on, through the lantern-mic worklet as 20 ms 16 kHz frames.
 * Closing it stops every track, so the browser's recording light goes out.
 */
export async function openMic(ctx: AudioContext, onFrame: (frame: Int16Array) => void): Promise<MicHandle> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) throw new Error("The microphone needs a secure page (https or localhost).");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  } catch (e) {
    void ctx.close().catch(() => {});
    throw e;
  }
  try {
    await ctx.resume().catch(() => {});
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (e) {
    for (const t of stream.getTracks()) t.stop();
    void ctx.close().catch(() => {});
    throw e;
  }
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, MIC_PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  node.port.onmessage = (e: MessageEvent<unknown>) => {
    if (e.data instanceof ArrayBuffer && e.data.byteLength === MIC_FRAME * 2) onFrame(new Int16Array(e.data));
  };
  // Pulled through a silent gain so the worklet runs everywhere and nothing is heard.
  const sink = ctx.createGain();
  sink.gain.value = 0;
  source.connect(node);
  node.connect(sink);
  sink.connect(ctx.destination);
  return {
    close() {
      for (const t of stream.getTracks()) t.stop();
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      sink.disconnect();
      void ctx.close().catch(() => {});
    },
  };
}

/** The local server's transcription (POST /api/voice/transcribe) of one utterance, with the chosen transcriber and the user's key. */
export function serverTranscriber(stt: ServerStt, fetchImpl: typeof fetch = fetch) {
  return async (wav: Uint8Array): Promise<string> => {
    let s = "";
    for (let i = 0; i < wav.length; i += 0x8000) s += String.fromCharCode(...wav.subarray(i, i + 0x8000));
    const res = await fetchImpl("/api/voice/transcribe", { method: "POST", headers: { "content-type": "application/json" }, body: transcribeRequest(stt, btoa(s), "audio/wav") });
    const body = (await res.json().catch(() => ({}))) as { text?: unknown; error?: { title?: string; message?: string } | string };
    if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : body.error ? `${body.error.title ?? "Transcription failed"}. ${body.error.message ?? ""}`.trim() : `WalkMyCode's server answered ${res.status}.`);
    return typeof body.text === "string" ? body.text : "";
  };
}
