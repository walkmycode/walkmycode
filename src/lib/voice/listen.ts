"use client";
// Hearing a question on WalkMyCode for Claude's page (docs/MCP.md §4, push to
// talk): while Space or the Talk button is held, the words are turned into
// text, then sent to the user's Claude as a spoken request.
//  - "On this computer" (Parakeet) when it is chosen, its model is here and
//    the browser's language is English: the microphone streams to the local
//    server, which writes the words down itself (src/lib/voice/parakeet);
//  - the transcriber chosen in Settings → Voice → Speech to text (Groq
//    Whisper, Deepgram Nova-3, ElevenLabs Scribe) when its key is set: the
//    clip is recorded here and sent, as JSON, to the local server, which holds
//    the key (POST /api/voice/transcribe);
//  - else the browser's own speech recognition where it has one (Chrome, Edge,
//    Safari): words appear as they are heard, and nothing needs a key;
//  - else the first transcriber with a key (Groq, Deepgram, ElevenLabs);
//  - else typing: the question box takes the focus.
// "Free voice" uses the browser alone.
import { isEnglish, STT_FALLBACK, STTS, transcribeTarget, type SttId, type VendorSttId } from "./catalogue";
import type { TalkMode } from "./talkMode";

export type ListenVia = SttId | "typing";
/** A transcriber the local server sends a recorded clip to, on the user's key. */
export type ServerStt = VendorSttId;

export interface ListenerFacts {
  mode: TalkMode;
  browser: boolean;
  stt?: SttId;
  /** What was chosen before "On this computer": used where Parakeet can't hear. */
  sttBefore?: SttId;
  keys: { deepgram: boolean; elevenlabs: boolean; groq?: boolean };
  /** On-device speech to text can run: its model is on this computer and this server has the engine. */
  parakeet?: boolean;
  /** The browser's language (navigator.language). Parakeet hears English only. */
  lang?: string | null;
}

/**
 * Why "On this computer" is chosen but something else hears, in words for the
 * user; null when it is not chosen or it hears. Pure.
 */
export function parakeetFallback(o: Pick<ListenerFacts, "stt" | "parakeet" | "lang">): string | null {
  if (o.stt !== "parakeet") return null;
  if (!o.parakeet) return "The speech model isn't on this computer yet (Settings → Voice → Speech to text), so your earlier choice is listening instead.";
  if (!isEnglish(o.lang)) return `On-device speech to text hears English only, and this browser is set to ${o.lang}: your earlier choice is listening instead.`;
  return null;
}

/** How this page hears a question: pure, so tests check every case. */
export function pickListener(o: ListenerFacts): ListenVia {
  // Parakeet runs on this computer, so it serves Free voice too: nothing goes to a voice provider.
  if (o.stt === "parakeet" && o.parakeet && isEnglish(o.lang)) return "parakeet";
  if (o.mode === "free") return o.browser ? "browser" : "typing";
  const keyed = (id: SttId) => {
    const v = STTS[id].vendor;
    return v !== null && !!o.keys[v];
  };
  // Parakeet chosen but unable to hear here: what was chosen before it.
  const stt = o.stt === "parakeet" ? (o.sttBefore === "parakeet" ? undefined : o.sttBefore) : o.stt;
  if (stt && stt !== "browser" && keyed(stt)) return stt;
  if (o.browser) return "browser";
  return STT_FALLBACK.find(keyed) ?? "typing";
}

/** The JSON POST /api/voice/transcribe takes for one clip. */
export function transcribeRequest(stt: ServerStt, audio_base64: string, mime: string): string {
  return JSON.stringify({ ...transcribeTarget(stt), audio_base64, mime });
}

/** The part of the Web Speech API's SpeechRecognition used here (its types are not in every DOM lib). */
export interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type RecognitionCtor = new () => Recognition;

/** The browser's speech recognition, if it has one. */
export function recognitionCtor(w: unknown = typeof window !== "undefined" ? window : undefined): RecognitionCtor | null {
  const g = w as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor } | undefined;
  return g?.SpeechRecognition ?? g?.webkitSpeechRecognition ?? null;
}

/** A question being heard: stop() ends it and gives the words; cancel() drops it. */
export interface Hearing {
  readonly via: Exclude<ListenVia, "typing">;
  stop(): Promise<string>;
  cancel(): void;
}

/** Why hearing failed, in words for the user. */
export class HearError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HearError";
  }
}

export const RECOGNITION_ERRORS: Record<string, string> = {
  "not-allowed": "The browser didn't let WalkMyCode use the microphone. Allow it in the address bar, or type your question.",
  "service-not-allowed": "This browser's speech recognition is turned off. Type your question, or pick Groq, Deepgram or ElevenLabs under Speech to text in Settings → Voice.",
  "audio-capture": "No microphone was found. Type your question instead.",
  network: "The browser's speech recognition couldn't reach its service. Type your question, or try again.",
};

/** Hear with the browser's own recognition (en-GB, words shown as they come). */
export function hearWithBrowser(onWords?: (soFar: string) => void, Ctor: RecognitionCtor | null = recognitionCtor()): Hearing {
  if (!Ctor) throw new HearError("This browser can't turn speech into text. Type your question instead.");
  const rec = new Ctor();
  rec.lang = "en-GB";
  rec.continuous = true;
  rec.interimResults = true;
  let final = "";
  let interim = "";
  let failed: string | null = null;
  let ended = false;
  let onEnded: (() => void) | null = null;
  rec.onresult = (e) => {
    interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    onWords?.(`${final} ${interim}`.replace(/\s+/g, " ").trim());
  };
  rec.onerror = (e) => {
    if (e.error !== "no-speech" && e.error !== "aborted") failed = RECOGNITION_ERRORS[e.error] ?? `Speech recognition stopped (${e.error}). Type your question instead.`;
  };
  rec.onend = () => {
    ended = true;
    onEnded?.();
  };
  rec.start();
  return {
    via: "browser",
    stop: () =>
      new Promise<string>((resolve, reject) => {
        const done = () => {
          if (failed) reject(new HearError(failed));
          else resolve(`${final} ${interim}`.replace(/\s+/g, " ").trim());
        };
        if (ended) return done();
        onEnded = done;
        // Some engines never fire onend after stop(): take what was heard.
        setTimeout(done, 2000);
        try {
          rec.stop();
        } catch {
          done();
        }
      }),
    cancel: () => {
      try {
        rec.abort();
      } catch {
        // already stopped
      }
    },
  };
}

/** The longest clip sent for transcription. */
export const MAX_CLIP_MS = 60_000;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Record the microphone, then have the local server transcribe it with the transcriber chosen in Settings → Voice, on the user's key. */
export async function hearWithServer(stt: ServerStt, fetchImpl: typeof fetch = fetch): Promise<Hearing> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new HearError("This browser can't record the microphone. Type your question instead.");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch {
    throw new HearError(RECOGNITION_ERRORS["not-allowed"]);
  }
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise<void>((ok) => (rec.onstop = () => ok()));
  const release = () => {
    for (const t of stream.getTracks()) t.stop();
  };
  rec.start(250);
  const cap = setTimeout(() => rec.state !== "inactive" && rec.stop(), MAX_CLIP_MS);
  return {
    via: stt,
    stop: async () => {
      clearTimeout(cap);
      if (rec.state !== "inactive") rec.stop();
      await stopped;
      release();
      const blob = new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
      if (!blob.size) return "";
      const audio = toBase64(new Uint8Array(await blob.arrayBuffer()));
      const res = await fetchImpl("/api/voice/transcribe", { method: "POST", headers: { "content-type": "application/json" }, body: transcribeRequest(stt, audio, blob.type) });
      const body = (await res.json().catch(() => ({}))) as { text?: unknown; error?: { title?: string; message?: string } | string };
      if (!res.ok) throw new HearError(typeof body.error === "string" ? body.error : body.error ? `${body.error.title ?? "Transcription failed"}. ${body.error.message ?? ""}`.trim() : `WalkMyCode's server answered ${res.status}.`);
      return typeof body.text === "string" ? body.text.trim() : "";
    },
    cancel: () => {
      clearTimeout(cap);
      if (rec.state !== "inactive") rec.stop();
      release();
    },
  };
}
