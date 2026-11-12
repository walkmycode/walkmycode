// The voice endpoints' bodies (docs/VOICE.md §3), kept here rather than in the
// route files so tests can hand them a fake fetch (a route file may only
// export handlers). Each route file wraps its handler in guarded(). A key is
// read here, put on the upstream request and nowhere else: never in a
// response, in a header sent back, or in a log line.
import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { HttpError } from "@/lib/providers/guard";
import { keyForEnv } from "@/lib/providers/keys";
import type { FriendlyError } from "@/lib/providers/wire";
import { buildAgentSettings, fitPrompt, GREETING, LECTURER_PERSONA } from "./agentSettings";
import { GROQ_STT_MODELS, LECTURERS, NARRATORS, STTS, type GroqSttModel, type NarratorId, type SttKeyEnv, type SttVendor } from "./catalogue";
import { loadVoice, resolveVoice, saveAgentRecord, saveVoice, validateVoice, voiceKeys, voiceReadiness, type ElevenAgentRecord } from "./config";
import { classifyVoice, voiceFriendly, type VoiceVendor } from "./errors";
import { elevenToolConfig, FUNCTION_NAMES, FUNCTIONS_VERSION, LECTURER_FUNCTIONS } from "./lecturer/functions";
import { findModel } from "./parakeet/model";
import { hostedSttRefusal } from "./parakeet/routes";
import { engineAvailable } from "./parakeet/engine";
import { splitForSpeech } from "./speech";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export const ELEVEN_BASE = "https://api.elevenlabs.io";
export const DEEPGRAM_BASE = "https://api.deepgram.com";
/** ElevenLabs' default output: MP3, 44.1 kHz, 128 kbps (allowed on every plan). */
export const ELEVEN_FORMAT = "mp3_44100_128";
/** Seconds a Deepgram grant lives: only the handshake needs it, the open socket outlives it. */
export const TOKEN_TTL = 30;
/** The LLM the ElevenLabs agent thinks with: Claude Haiku 4.5, the fastest Claude it offers. */
export const AGENT_LLM = LECTURERS.elevenagents.models[0].think[0];
export const AGENT_NAME = "WalkMyCode lecturer";
const VOICES_TTL_MS = 10 * 60_000;
const NO_STORE = { "cache-control": "no-store" };

/** An upstream failure, already in FriendlyError form, with the status to answer with. */
export class VoiceUpstreamError extends Error {
  constructor(
    readonly error: FriendlyError,
    readonly status = 502,
  ) {
    super(error.title);
    this.name = "VoiceUpstreamError";
  }
}

const fail = (error: FriendlyError, status: number) => Response.json({ error }, { status, headers: NO_STORE });

function issues(e: z.ZodError): string {
  return e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 2000);
  } catch {
    return "";
  }
}

/** fetch, with a failure to connect or a non-2xx answer turned into a VoiceUpstreamError. */
async function upstream(fetchImpl: FetchLike, vendor: VoiceVendor, url: string, init: RequestInit, key: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch (e) {
    if (init.signal?.aborted) throw e;
    throw new VoiceUpstreamError(classifyVoice(vendor, null, "", [key]));
  }
  if (!res.ok) throw new VoiceUpstreamError(classifyVoice(vendor, res.status, await safeText(res), [key]));
  return res;
}

const elevenHeaders = (key: string, accept = "application/json") => ({ "xi-api-key": key, "content-type": "application/json", accept });

// ── ElevenLabs voices ──

export interface ElevenVoice {
  voice_id: string;
  name: string;
  category?: string;
  description?: string | null;
  labels?: Record<string, string>;
}

const voiceCache = new Map<string, { at: number; voices: ElevenVoice[] }>();
/** The cache is keyed by a hash of the key, never the key itself. */
const keyId = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 16);

export function clearVoiceCache(): void {
  voiceCache.clear();
}

/** The account's voices (GET /v1/voices), cached for ten minutes per key. */
export async function elevenVoices(key: string, fetchImpl: FetchLike, signal?: AbortSignal): Promise<ElevenVoice[]> {
  const id = keyId(key);
  const hit = voiceCache.get(id);
  if (hit && Date.now() - hit.at < VOICES_TTL_MS) return hit.voices;
  const res = await upstream(fetchImpl, "elevenlabs", `${ELEVEN_BASE}/v1/voices`, { headers: { "xi-api-key": key, accept: "application/json" }, signal }, key);
  const body = (await res.json()) as { voices?: unknown };
  const voices = (Array.isArray(body.voices) ? body.voices : []).filter((v): v is ElevenVoice => !!v && typeof (v as ElevenVoice).voice_id === "string" && typeof (v as ElevenVoice).name === "string");
  voiceCache.set(id, { at: Date.now(), voices });
  return voices;
}

/** Eldrin when the account has it (its name starts "Eldrin"), else the account's first voice. */
export function preferredVoice(voices: ElevenVoice[], name = NARRATORS.elevenlabs.preferredVoice ?? "Eldrin"): ElevenVoice | null {
  const want = name.toLowerCase();
  return voices.find((v) => v.name.toLowerCase().startsWith(want)) ?? voices[0] ?? null;
}

const NO_VOICES: FriendlyError = {
  code: "model_unavailable",
  title: "ElevenLabs has no voice to use",
  message: "Your ElevenLabs account lists no voices. Add one in ElevenLabs (Eldrin is WalkMyCode's default), or pick another voice in Settings → Voice.",
  action: "settings",
};

async function elevenVoiceId(key: string, fetchImpl: FetchLike, signal?: AbortSignal): Promise<string> {
  const v = preferredVoice(await elevenVoices(key, fetchImpl, signal));
  if (!v) throw new VoiceUpstreamError(NO_VOICES);
  return v.voice_id;
}

// ── POST /api/voice/speak ──

const SpeakBody = z.object({
  text: z.string().min(1).max(5000),
  stepId: z.string().max(200).optional(),
  // "Test voice" in Settings tries a choice before it is saved, checked the way a save is.
  narrator: z.enum(["elevenlabs", "deepgram", "browser"]).optional(),
  voice_id: z.string().max(200).optional(),
  speed: z.number().optional(),
});

/**
 * Streams the narration as audio/mpeg. ElevenLabs reads with eleven_flash_v2_5
 * in the saved voice (or Eldrin, else the account's first voice); with
 * `?timestamps=1` it answers NDJSON lines of `{audio_base64, alignment}`
 * instead, for word highlighting. Deepgram's Aura-2 takes at most 2,000
 * characters a request, so longer text goes a few sentences at a time into
 * one stream. Nothing has been sent when an error comes back as JSON.
 */
export function speakHandler(deps: { fetch?: FetchLike } = {}) {
  return async (req: Request): Promise<Response> => {
    const fetchImpl = deps.fetch ?? fetch;
    const parsed = SpeakBody.safeParse(await req.json());
    if (!parsed.success) throw new HttpError(400, issues(parsed.error));
    const b = parsed.data;
    const text = b.text.trim();
    if (!text) throw new HttpError(400, "Nothing to read aloud.");
    const saved = resolveVoice();
    const narrator: NarratorId = b.narrator ?? saved.narrator;
    const over = validateVoice({ ...(b.narrator ? { narrator: b.narrator } : {}), ...(b.voice_id !== undefined ? { voiceId: b.voice_id } : {}), ...(b.speed !== undefined ? { speed: b.speed } : {}) }, { narrator: saved.narrator });
    const voiceId = over.voiceId || (narrator === saved.narrator ? saved.voiceId : NARRATORS[narrator].defaultVoice);
    const speed = over.speed ?? saved.speed;
    if (narrator === "browser") throw new HttpError(400, "The browser's voice reads aloud in the page itself.");
    const vendor: VoiceVendor = narrator;
    const env = NARRATORS[narrator].env!;
    const key = keyForEnv(env)?.value;
    if (!key) return fail(voiceFriendly("missing_key", vendor, { feature: "narrator" }), 400);
    const timestamps = new URL(req.url).searchParams.get("timestamps") === "1";
    try {
      return narrator === "elevenlabs" ? await elevenSpeak(fetchImpl, key, text, voiceId, speed, timestamps, req.signal) : await deepgramSpeak(fetchImpl, key, text, voiceId, speed, req.signal);
    } catch (e) {
      if (e instanceof VoiceUpstreamError) return fail(e.error, e.status);
      throw e;
    }
  };
}

async function elevenSpeak(fetchImpl: FetchLike, key: string, text: string, voiceId: string | null, speed: number, timestamps: boolean, signal: AbortSignal): Promise<Response> {
  const voice = voiceId ?? (await elevenVoiceId(key, fetchImpl, signal));
  const body: Record<string, unknown> = { text, model_id: NARRATORS.elevenlabs.model };
  if (speed !== 1) body.voice_settings = { speed };
  const url = `${ELEVEN_BASE}/v1/text-to-speech/${encodeURIComponent(voice)}/stream${timestamps ? "/with-timestamps" : ""}?output_format=${ELEVEN_FORMAT}`;
  const up = await upstream(fetchImpl, "elevenlabs", url, { method: "POST", headers: elevenHeaders(key, timestamps ? "application/json" : "audio/mpeg"), body: JSON.stringify(body), signal }, key);
  if (!up.body) throw new VoiceUpstreamError(voiceFriendly("unknown", "elevenlabs", { detail: "The answer had no audio." }));
  const headers = { ...NO_STORE, "x-lantern-narrator": "elevenlabs", "x-lantern-voice": voice };
  if (!timestamps) return new Response(up.body, { headers: { ...headers, "content-type": "audio/mpeg" } });
  return new Response(up.body.pipeThrough(alignmentLines()), { headers: { ...headers, "content-type": "application/x-ndjson" } });
}

/**
 * ElevenLabs' with-timestamps stream as NDJSON lines of exactly
 * `{audio_base64, alignment}`. The docs do not say how the objects are
 * framed, so this reads JSON objects whether they come one per line or back
 * to back, and drops anything else (normalized_alignment included).
 */
export function alignmentLines(): TransformStream<Uint8Array, Uint8Array> {
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  const split = new ObjectSplitter();
  const emit = (raw: string, controller: TransformStreamDefaultController<Uint8Array>) => {
    try {
      const o = JSON.parse(raw) as { audio_base64?: unknown; alignment?: unknown };
      if (typeof o.audio_base64 !== "string") return;
      controller.enqueue(enc.encode(`${JSON.stringify({ audio_base64: o.audio_base64, alignment: o.alignment ?? null })}\n`));
    } catch {
      // Not JSON: nothing a player could use.
    }
  };
  return new TransformStream({
    transform(chunk, controller) {
      for (const raw of split.push(dec.decode(chunk, { stream: true }))) emit(raw, controller);
    },
    flush(controller) {
      for (const raw of split.push(dec.decode())) emit(raw, controller);
    },
  });
}

/** Cuts a character stream into top-level JSON objects, whatever lies between them. */
export class ObjectSplitter {
  private buf = "";
  private pos = 0;
  private depth = 0;
  private start = -1;
  private inStr = false;
  private esc = false;

  push(text: string): string[] {
    this.buf += text;
    const out: string[] = [];
    for (; this.pos < this.buf.length; this.pos++) {
      const c = this.buf[this.pos];
      if (this.inStr) {
        if (this.esc) this.esc = false;
        else if (c === "\\") this.esc = true;
        else if (c === '"') this.inStr = false;
        continue;
      }
      if (this.depth === 0 && c !== "{") continue;
      if (c === '"') this.inStr = true;
      else if (c === "{") {
        if (this.depth++ === 0) this.start = this.pos;
      } else if (c === "}" && --this.depth === 0) {
        out.push(this.buf.slice(this.start, this.pos + 1));
        this.start = -1;
      }
    }
    // Keep only what an unfinished object still needs.
    if (this.start >= 0) {
      this.buf = this.buf.slice(this.start);
      this.pos -= this.start;
      this.start = 0;
    } else {
      this.buf = "";
      this.pos = 0;
    }
    return out;
  }
}

async function deepgramSpeak(fetchImpl: FetchLike, key: string, text: string, voiceId: string | null, speed: number, signal: AbortSignal): Promise<Response> {
  const model = voiceId ?? NARRATORS.deepgram.defaultVoice!;
  const q = new URLSearchParams({ model, encoding: "mp3", mip_opt_out: "true" });
  if (speed !== 1) q.set("speed", String(speed));
  const url = `${DEEPGRAM_BASE}/v1/speak?${q}`;
  const pieces = splitForSpeech(text, NARRATORS.deepgram.maxChars!);
  const call = (piece: string) =>
    upstream(fetchImpl, "deepgram", url, { method: "POST", headers: { authorization: `Token ${key}`, "content-type": "application/json", accept: "audio/mpeg" }, body: JSON.stringify({ text: piece }), signal }, key);
  // The first piece fails as JSON, before any audio has gone out.
  const first = await call(pieces[0]);
  let i = 0;
  let current: ReadableStreamDefaultReader<Uint8Array> | null = first.body?.getReader() ?? null;
  // The next piece is asked for while this one plays, so the joins have no gap.
  let next: Promise<Response> | null = pieces.length > 1 ? call(pieces[1]) : null;
  next?.catch(() => {});
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        for (;;) {
          if (!current) return controller.close();
          const { value, done } = await current.read();
          if (!done) {
            if (value?.byteLength) return controller.enqueue(value);
            continue;
          }
          i++;
          if (!next) {
            current = null;
            continue;
          }
          const res = await next;
          next = i + 1 < pieces.length ? call(pieces[i + 1]) : null;
          next?.catch(() => {});
          current = res.body?.getReader() ?? null;
        }
      } catch {
        // A later piece failed: the audio so far stands and the stream ends there.
        controller.error(new Error("Deepgram stopped part-way through."));
      }
    },
    cancel() {
      void current?.cancel().catch(() => {});
    },
  });
  return new Response(stream, { headers: { ...NO_STORE, "content-type": "audio/mpeg", "x-lantern-narrator": "deepgram", "x-lantern-voice": model, "x-lantern-pieces": String(pieces.length) } });
}

// ── POST /api/voice/transcribe ──

/** Deepgram's current pre-recorded model (developers.deepgram.com, checked 1 Oct 2026). */
export const DEEPGRAM_STT_MODEL = STTS.deepgram.model!;
/** ElevenLabs' current speech-to-text model (scribe_v1 is deprecated; elevenlabs.io/docs, checked 1 Oct 2026). */
export const ELEVEN_STT_MODEL = STTS.elevenlabs.model!;
/** Groq's OpenAI-compatible transcription endpoint (console.groq.com/docs/speech-to-text, checked 2 Oct 2026). */
export const GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
/** Whisper large-v3 turbo: fast and cheap, the default; whisper-large-v3 is the accurate choice. */
export const GROQ_STT_DEFAULT: GroqSttModel = "whisper-large-v3-turbo";
/** One spoken question: at most about a minute of compressed audio, or about three minutes of 16 kHz WAV.
 * Well under Groq's 25 MB (free tier) per file. */
export const MAX_CLIP_BYTES = 6 * 1024 * 1024;

const TranscribeBody = z.object({
  vendor: z.enum(["deepgram", "elevenlabs", "groq"]),
  /** Groq only: which Whisper. */
  model: z.enum(GROQ_STT_MODELS).optional(),
  audio_base64: z.string().min(1).max(Math.ceil((MAX_CLIP_BYTES * 4) / 3) + 8),
  mime: z
    .string()
    .max(100)
    .regex(/^audio\/[\w.+-]+(?:;\s*codecs=[\w.+-]+)?$/i)
    .optional(),
});

const STT_ENV: Record<SttVendor, SttKeyEnv> = { deepgram: "DEEPGRAM_API_KEY", elevenlabs: "ELEVENLABS_API_KEY", groq: "GROQ_API_KEY" };

/** The file name a clip is sent under: Groq and ElevenLabs read the type from it. */
export function clipName(mime: string): string {
  return `question.${/wav/i.test(mime) ? "wav" : /mp4/i.test(mime) ? "m4a" : /ogg/i.test(mime) ? "ogg" : "webm"}`;
}

/**
 * A spoken question, recorded by the page (held, or one hands-free utterance
 * as WAV) where the browser's own recognition is not chosen or not there,
 * turned into text with the user's own key: Deepgram's pre-recorded API with
 * nova-3, ElevenLabs' speech-to-text with scribe_v2, or Groq's Whisper
 * (large-v3 turbo by default, large-v3 when asked). Answers { text }.
 */
export function transcribeHandler(deps: { fetch?: FetchLike } = {}) {
  return async (req: Request): Promise<Response> => {
    const fetchImpl = deps.fetch ?? fetch;
    const parsed = TranscribeBody.safeParse(await req.json());
    if (!parsed.success) throw new HttpError(400, issues(parsed.error));
    const { vendor, audio_base64 } = parsed.data;
    const mime = parsed.data.mime ?? "audio/webm";
    const audio = new Uint8Array(Buffer.from(audio_base64, "base64"));
    if (!audio.length) throw new HttpError(400, "The recording is empty.");
    if (audio.length > MAX_CLIP_BYTES) throw new HttpError(413, "The recording is too long: hold Talk for under a minute.");
    const key = keyForEnv(STT_ENV[vendor])?.value;
    if (!key) return fail(voiceFriendly("missing_key", vendor, { feature: vendor === "groq" ? "transcriber" : "lecturer" }), 400);
    try {
      if (vendor === "groq") {
        const form = new FormData();
        form.set("file", new Blob([audio], { type: mime }), clipName(mime));
        form.set("model", parsed.data.model ?? GROQ_STT_DEFAULT);
        form.set("language", "en");
        form.set("response_format", "json");
        const up = await upstream(fetchImpl, "groq", GROQ_STT_URL, { method: "POST", headers: { authorization: `Bearer ${key}`, accept: "application/json" }, body: form, signal: req.signal }, key);
        const j = (await up.json()) as { text?: unknown };
        return Response.json({ text: typeof j.text === "string" ? j.text.trim() : "" }, { headers: NO_STORE });
      }
      if (vendor === "deepgram") {
        const q = new URLSearchParams({ model: DEEPGRAM_STT_MODEL, smart_format: "true", language: "en", mip_opt_out: "true" });
        const up = await upstream(fetchImpl, "deepgram", `${DEEPGRAM_BASE}/v1/listen?${q}`, { method: "POST", headers: { authorization: `Token ${key}`, "content-type": mime, accept: "application/json" }, body: audio, signal: req.signal }, key);
        const j = (await up.json()) as { results?: { channels?: { alternatives?: { transcript?: unknown }[] }[] } };
        const text = j.results?.channels?.[0]?.alternatives?.[0]?.transcript;
        return Response.json({ text: typeof text === "string" ? text.trim() : "" }, { headers: NO_STORE });
      }
      const form = new FormData();
      form.set("model_id", ELEVEN_STT_MODEL);
      form.set("file", new Blob([audio], { type: mime }), clipName(mime));
      const up = await upstream(fetchImpl, "elevenlabs", `${ELEVEN_BASE}/v1/speech-to-text`, { method: "POST", headers: { "xi-api-key": key, accept: "application/json" }, body: form, signal: req.signal }, key);
      const j = (await up.json()) as { text?: unknown };
      return Response.json({ text: typeof j.text === "string" ? j.text.trim() : "" }, { headers: NO_STORE });
    } catch (e) {
      if (e instanceof VoiceUpstreamError) return fail(e.error, e.status);
      throw e;
    }
  };
}

// ── POST /api/voice/token ──

/** A Deepgram grant for the browser's agent socket: { access_token, expires_in }. The key stays here. */
export function tokenHandler(deps: { fetch?: FetchLike } = {}) {
  return async (req: Request): Promise<Response> => {
    const fetchImpl = deps.fetch ?? fetch;
    const key = keyForEnv("DEEPGRAM_API_KEY")?.value;
    if (!key) return fail(voiceFriendly("missing_key", "deepgram", { feature: "lecturer" }), 400);
    try {
      const up = await upstream(
        fetchImpl,
        "deepgram",
        `${DEEPGRAM_BASE}/v1/auth/grant`,
        { method: "POST", headers: { authorization: `Token ${key}`, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ ttl_seconds: TOKEN_TTL }), signal: req.signal },
        key,
      );
      const j = (await up.json()) as { access_token?: unknown; expires_in?: unknown };
      if (typeof j.access_token !== "string" || !j.access_token || j.access_token === key) throw new VoiceUpstreamError(voiceFriendly("unknown", "deepgram", { detail: "The grant came back without a token." }));
      return Response.json({ access_token: j.access_token, expires_in: typeof j.expires_in === "number" ? j.expires_in : TOKEN_TTL }, { headers: NO_STORE });
    } catch (e) {
      if (e instanceof VoiceUpstreamError) return fail(e.error, e.status);
      throw e;
    }
  };
}

// ── GET /api/voice/settings ──

/** Deepgram's agent Settings for the saved lecturer model, with the persona as the prompt. */
export function settingsHandler() {
  return async (): Promise<Response> => {
    const c = resolveVoice();
    const model = c.lecturer === "deepgram-agent" ? c.lecturerModel : LECTURERS["deepgram-agent"].defaultModel;
    return Response.json(buildAgentSettings({ model }), { headers: NO_STORE });
  };
}

// ── GET / POST /api/voice/config ──

const SaveBody = z.object({
  narrator: z.string().optional(),
  voice_id: z.string().max(200).optional(),
  speed: z.number().optional(),
  lecturer: z.string().optional(),
  lecturer_model: z.string().optional(),
  input: z.enum(["hands-free", "push-to-talk"]).optional(),
  headphones: z.boolean().optional(),
  stt: z.string().max(40).optional(),
});

/** The saved voice choice, whether each voice key is set, and what is not ready. Never a key. */
export function voiceSnapshot() {
  const saved = resolveVoice();
  return { saved, keys: voiceKeys(), readiness: voiceReadiness(saved) };
}

/** Whether on-device speech to text can run now: the model is on this computer, the engine is in this build, and this is not a hosted server. */
export async function parakeetReady(): Promise<boolean> {
  return !hostedSttRefusal() && !!findModel() && (await engineAvailable());
}

export function configGetHandler() {
  return async (): Promise<Response> => Response.json({ ...voiceSnapshot(), parakeet: { ready: await parakeetReady() } }, { headers: NO_STORE });
}

export function configPostHandler() {
  return async (req: Request): Promise<Response> => {
    const parsed = SaveBody.safeParse(await req.json());
    if (!parsed.success) throw new HttpError(400, issues(parsed.error));
    const p = parsed.data;
    saveVoice({
      ...(p.narrator !== undefined ? { narrator: p.narrator as NarratorId } : {}),
      ...(p.voice_id !== undefined ? { voiceId: p.voice_id } : {}),
      ...(p.speed !== undefined ? { speed: p.speed } : {}),
      ...(p.lecturer !== undefined ? { lecturer: p.lecturer as never } : {}),
      ...(p.lecturer_model !== undefined ? { lecturerModel: p.lecturer_model as never } : {}),
      ...(p.input !== undefined ? { input: p.input } : {}),
      ...(p.headphones !== undefined ? { headphones: p.headphones } : {}),
      ...(p.stt !== undefined ? { stt: p.stt as never } : {}),
    });
    return Response.json({ ok: true, ...voiceSnapshot(), parakeet: { ready: await parakeetReady() } }, { headers: NO_STORE });
  };
}

// ── GET /api/voice/voices ──

/** The ElevenLabs account's voices for the picker, and which one WalkMyCode would use. */
export function voicesHandler(deps: { fetch?: FetchLike } = {}) {
  return async (req: Request): Promise<Response> => {
    const key = keyForEnv("ELEVENLABS_API_KEY")?.value;
    if (!key) return Response.json({ voices: [], preferred: null, error: voiceFriendly("missing_key", "elevenlabs", { feature: "narrator" }) }, { headers: NO_STORE });
    try {
      const voices = await elevenVoices(key, deps.fetch ?? fetch, req.signal);
      return Response.json(
        {
          voices: voices.map((v) => ({ id: v.voice_id, name: v.name, accent: v.labels?.accent ?? null, gender: v.labels?.gender ?? null, category: v.category ?? null })),
          preferred: preferredVoice(voices)?.voice_id ?? null,
        },
        { headers: NO_STORE },
      );
    } catch (e) {
      if (e instanceof VoiceUpstreamError) return Response.json({ voices: [], preferred: null, error: e.error }, { headers: NO_STORE });
      throw e;
    }
  };
}

// ── POST /api/voice/elevenagents/session ──

const SessionBody = z.object({
  map_summary: z.string().max(400_000).optional(),
});

/** What the agent in the user's account holds now, and which per-session overrides its security settings allow. */
export interface AgentView {
  agent_id: string;
  prompt: string;
  llm: string | null;
  voice_id: string | null;
  tool_ids: string[];
  overrides: { prompt: boolean; voice: boolean; keywords: boolean };
}

/** What the browser gets: a signed link (valid 15 minutes) and the overrides to send, if the agent allows them. */
export interface ElevenSession {
  signed_url: string;
  agent_id: string;
  overrides: { prompt?: string; voice_id?: string; keywords?: boolean };
}

const hashOf = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

/** The agent as WalkMyCode makes it: private (signed links only), Claude Haiku, its tools, and room for per-session prompt and voice. */
export function agentCreateBody(o: { prompt: string; voiceId: string; toolIds: string[] }) {
  return {
    name: AGENT_NAME,
    conversation_config: {
      agent: { first_message: GREETING, language: "en", prompt: { prompt: o.prompt, llm: AGENT_LLM, tool_ids: o.toolIds } },
      tts: { voice_id: o.voiceId },
      // ElevenLabs' own end-of-turn detection decides when the user has finished (hands-free
      // Talk streams the microphone the whole time). "normal" is its documented default
      // (elevenlabs.io/docs, conversation flow, checked 2 Oct 2026), set so it is explicit.
      turn: { turn_eagerness: "normal" },
    },
    platform_settings: {
      auth: { enable_auth: true },
      overrides: { conversation_config_override: { agent: { prompt: { prompt: true } }, tts: { voice_id: true }, asr: { keywords: true } } },
    },
  };
}

/** Read an agent; null when ElevenLabs no longer has it (deleted in the dashboard). */
async function getAgent(fetchImpl: FetchLike, key: string, id: string): Promise<AgentView | null> {
  let res: Response;
  try {
    res = await fetchImpl(`${ELEVEN_BASE}/v1/convai/agents/${encodeURIComponent(id)}`, { headers: { "xi-api-key": key, accept: "application/json" } });
  } catch {
    throw new VoiceUpstreamError(classifyVoice("elevenlabs", null, "", [key]));
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await safeText(res);
    if ((res.status === 400 || res.status === 422) && /not[_ ]found|does not exist/i.test(body)) return null;
    throw new VoiceUpstreamError(classifyVoice("elevenlabs", res.status, body, [key]));
  }
  const j = (await res.json()) as {
    agent_id?: string;
    conversation_config?: { agent?: { prompt?: { prompt?: string; llm?: string; tool_ids?: string[] } }; tts?: { voice_id?: string } };
    platform_settings?: { overrides?: { conversation_config_override?: { agent?: { prompt?: { prompt?: boolean } }; tts?: { voice_id?: boolean }; asr?: { keywords?: boolean } } } };
  };
  const p = j.conversation_config?.agent?.prompt;
  const ov = j.platform_settings?.overrides?.conversation_config_override;
  return {
    agent_id: j.agent_id ?? id,
    prompt: p?.prompt ?? "",
    llm: p?.llm ?? null,
    voice_id: j.conversation_config?.tts?.voice_id ?? null,
    tool_ids: Array.isArray(p?.tool_ids) ? p.tool_ids : [],
    overrides: { prompt: ov?.agent?.prompt?.prompt === true, voice: ov?.tts?.voice_id === true, keywords: ov?.asr?.keywords === true },
  };
}

/** WalkMyCode's functions as client tools in the user's account, made once per version of the list. */
async function ensureTools(fetchImpl: FetchLike, key: string, rec: ElevenAgentRecord | undefined): Promise<Record<string, string>> {
  if (rec && rec.tools_version === FUNCTIONS_VERSION && FUNCTION_NAMES.every((n) => typeof rec.tool_ids?.[n] === "string")) return rec.tool_ids;
  const made = await Promise.all(
    LECTURER_FUNCTIONS.map(async (f) => {
      const res = await upstream(fetchImpl, "elevenlabs", `${ELEVEN_BASE}/v1/convai/tools`, { method: "POST", headers: elevenHeaders(key), body: JSON.stringify({ tool_config: elevenToolConfig(f) }) }, key);
      const j = (await res.json()) as { id?: unknown };
      if (typeof j.id !== "string") throw new VoiceUpstreamError(voiceFriendly("unknown", "elevenlabs", { detail: `ElevenLabs made the ${f.name} tool but sent back no id.` }));
      return [f.name, j.id] as const;
    }),
  );
  return Object.fromEntries(made);
}

let agentLock: Promise<unknown> = Promise.resolve();
/** One provisioning at a time, so two first sessions cannot make two agents. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = agentLock.then(fn, fn);
  agentLock = run.catch(() => {});
  return run;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Makes sure the user's ElevenLabs account has WalkMyCode's lecturer agent and
 * returns a signed link to talk to it. On first use the agent is created (its
 * id kept in .walkmycode/config.json); after that it is kept in step: its tools,
 * and its prompt and voice unless the agent lets each session override them,
 * in which case the browser sends them as overrides instead.
 */
export function elevenSessionHandler(deps: { fetch?: FetchLike } = {}) {
  return async (req: Request): Promise<Response> => {
    const fetchImpl = deps.fetch ?? fetch;
    const parsed = SessionBody.safeParse(await req.json());
    if (!parsed.success) throw new HttpError(400, issues(parsed.error));
    const key = keyForEnv("ELEVENLABS_API_KEY")?.value;
    if (!key) return fail(voiceFriendly("missing_key", "elevenlabs", { feature: "lecturer" }), 400);
    const prompt = fitPrompt(LECTURER_PERSONA, parsed.data.map_summary ?? "");
    const choice = resolveVoice();
    try {
      const session = await serial(async (): Promise<ElevenSession> => {
        const voiceId = choice.narrator === "elevenlabs" && choice.voiceId ? choice.voiceId : await elevenVoiceId(key, fetchImpl);
        const rec = loadVoice().elevenagents;
        const toolIds = await ensureTools(fetchImpl, key, rec);
        const tools = FUNCTION_NAMES.map((n) => toolIds[n]);
        // Kept at once, so a failure making the agent does not make the tools twice.
        if (toolIds !== rec?.tool_ids) saveAgentRecord({ ...rec, tool_ids: toolIds, tools_version: FUNCTIONS_VERSION });
        let agent = rec?.agent_id ? await getAgent(fetchImpl, key, rec.agent_id) : null;
        if (!agent) {
          const res = await upstream(fetchImpl, "elevenlabs", `${ELEVEN_BASE}/v1/convai/agents/create`, { method: "POST", headers: elevenHeaders(key), body: JSON.stringify(agentCreateBody({ prompt, voiceId, toolIds: tools })) }, key);
          const j = (await res.json()) as { agent_id?: unknown };
          if (typeof j.agent_id !== "string") throw new VoiceUpstreamError(voiceFriendly("unknown", "elevenlabs", { detail: "ElevenLabs made the agent but sent back no agent_id." }));
          agent = { agent_id: j.agent_id, prompt, llm: AGENT_LLM, voice_id: voiceId, tool_ids: tools, overrides: { prompt: true, voice: true, keywords: true } };
        } else {
          const wantPrompt = !agent.overrides.prompt && agent.prompt !== prompt;
          const wantTools = !sameSet(agent.tool_ids, tools);
          const wantVoice = !agent.overrides.voice && agent.voice_id !== voiceId;
          if (wantPrompt || wantTools || wantVoice) {
            // A PATCH may replace nested objects whole, so the prompt block goes with every field it had.
            const promptBlock = { prompt: wantPrompt ? prompt : agent.prompt, ...(agent.llm ? { llm: agent.llm } : {}), tool_ids: tools };
            const conversation_config: Record<string, unknown> = {};
            if (wantPrompt || wantTools) conversation_config.agent = { prompt: promptBlock };
            if (wantVoice) conversation_config.tts = { voice_id: voiceId };
            await upstream(fetchImpl, "elevenlabs", `${ELEVEN_BASE}/v1/convai/agents/${encodeURIComponent(agent.agent_id)}`, { method: "PATCH", headers: elevenHeaders(key), body: JSON.stringify({ conversation_config }) }, key);
            agent = { ...agent, prompt: promptBlock.prompt, tool_ids: tools, voice_id: wantVoice ? voiceId : agent.voice_id };
          }
        }
        saveAgentRecord({ agent_id: agent.agent_id, tool_ids: toolIds, tools_version: FUNCTIONS_VERSION, prompt_hash: hashOf(agent.prompt), voice_id: agent.voice_id ?? undefined });
        const signed = await upstream(fetchImpl, "elevenlabs", `${ELEVEN_BASE}/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agent.agent_id)}`, { headers: { "xi-api-key": key, accept: "application/json" } }, key);
        const s = (await signed.json()) as { signed_url?: unknown };
        if (typeof s.signed_url !== "string" || !s.signed_url.startsWith("wss://")) throw new VoiceUpstreamError(voiceFriendly("unknown", "elevenlabs", { detail: "ElevenLabs sent no signed link." }));
        return {
          signed_url: s.signed_url,
          agent_id: agent.agent_id,
          overrides: {
            ...(agent.overrides.prompt ? { prompt } : {}),
            ...(agent.overrides.voice ? { voice_id: voiceId } : {}),
            ...(agent.overrides.keywords ? { keywords: true } : {}),
          },
        };
      });
      return Response.json(session, { headers: NO_STORE });
    } catch (e) {
      if (e instanceof VoiceUpstreamError) return fail(e.error, e.status);
      throw e;
    }
  };
}
