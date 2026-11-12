// Voice failures as the FriendlyError the rest of WalkMyCode shows (wire.ts): a
// code, a title, what to do next and where. Upstream bodies are scrubbed of
// anything key-shaped, and of the key itself, before they reach `detail`.
// Browser-safe: the narrator and the lecturer build these too.
import { scrub } from "@/lib/providers/errors";
import type { ErrorCode, FriendlyError } from "@/lib/providers/wire";

export type VoiceVendor = "elevenlabs" | "deepgram" | "groq";

/** Anything that stops a reading or a lecture, with the FriendlyError to show. */
export class VoiceError extends Error {
  constructor(readonly info: FriendlyError) {
    super(info.message);
    this.name = "VoiceError";
  }
}

/** The WalkMyCode server itself did not answer. */
export const UNREACHABLE: FriendlyError = { code: "network", title: "Can't reach the WalkMyCode server", message: "Is `npm run dev` still running? Check the terminal and try again.", action: "retry" };

/** The error a voice route put in its body (a FriendlyError, or a plain message), or the status. */
export async function routeError(res: Response, title = "Voice request failed"): Promise<FriendlyError> {
  try {
    const body = (await res.json()) as { error?: string | FriendlyError };
    if (body.error && typeof body.error === "object") return body.error;
    if (typeof body.error === "string") return { code: "unknown", title, message: body.error, action: "retry" };
  } catch {
    // Not JSON.
  }
  return { code: "unknown", title, message: `The WalkMyCode server answered ${res.status}.`, action: "retry" };
}

const LABEL: Record<VoiceVendor, string> = { elevenlabs: "ElevenLabs", deepgram: "Deepgram", groq: "Groq" };
const ENV: Record<VoiceVendor, string> = { elevenlabs: "ELEVENLABS_API_KEY", deepgram: "DEEPGRAM_API_KEY", groq: "GROQ_API_KEY" };
const DETAIL_CHARS = 300;

/** scrub() plus the secrets themselves, hex keys (Deepgram's are 40 hex characters) and JWTs. */
export function scrubVoice(text: string, secrets: (string | null | undefined)[] = []): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("[key]");
  return scrub(out)
    .replace(/\b[a-f0-9]{32,}\b/gi, "[key]")
    .replace(/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g, "[token]");
}

export interface VoiceErrorContext {
  status?: number;
  detail?: string;
  /** What the key is for, in the missing-key copy. */
  feature?: "narrator" | "lecturer" | "transcriber";
  /** Strings to cut out of `detail` (the key in use). */
  secrets?: string[];
}

/** The standard copy for a code, naming the vendor and Settings → Voice. */
export function voiceFriendly(code: ErrorCode, vendor: VoiceVendor, ctx: VoiceErrorContext = {}): FriendlyError {
  const label = LABEL[vendor];
  const copy = ((): Pick<FriendlyError, "title" | "message" | "action"> => {
    switch (code) {
      case "missing_key":
        if (ctx.feature === "transcriber")
          return { title: `${label} API key missing`, message: `Speech to text with ${label} needs your key: add it in Settings → Voice, or put ${ENV[vendor]} in .env.local.`, action: "settings" };
        return ctx.feature === "lecturer"
          ? { title: `${label} API key missing`, message: `Talk needs ${vendor === "elevenlabs" ? "an" : "a"} ${label} key: add it in Settings → Voice, or put ${ENV[vendor]} in .env.local.`, action: "settings" }
          : { title: `${label} API key missing`, message: `Add your ${label} key in Settings → Voice, or put ${ENV[vendor]} in .env.local. Until then your browser's voice reads aloud.`, action: "settings" };
      case "invalid_key":
        return vendor === "deepgram" && ctx.status === 403
          ? { title: "Deepgram refused the key", message: "Talk needs a Deepgram key with Member permissions or above. Paste one in Settings → Voice.", action: "settings" }
          : { title: `${label} rejected the API key`, message: "The key may be mistyped, revoked or expired. Paste a fresh key in Settings → Voice.", action: "settings" };
      case "out_of_credits":
        return { title: `${label} account is out of credits`, message: `Top up your ${label} balance, or pick another voice in Settings → Voice.`, action: "settings" };
      case "rate_limited":
        return { title: `${label} is busy right now`, message: "Too many requests or a temporary limit. Wait a moment and try again.", action: "retry" };
      case "model_unavailable":
        if (vendor === "groq") return { title: "Groq can't use this Whisper model", message: "Groq may have retired it. Pick the other Groq model, or another way to hear you, in Settings → Voice.", action: "settings" };
        return { title: `${label} can't use this voice`, message: "Pick a different voice in Settings → Voice.", action: "settings" };
      case "network":
        return { title: `Can't reach ${label}`, message: "Check your internet connection and try again.", action: "retry" };
      case "forbidden":
        return { title: "Voice can only be used from this computer", message: "Open WalkMyCode at http://localhost:3000 to use voice.", action: null };
      default:
        return { title: `${label} request failed`, message: "The voice service returned an error WalkMyCode does not recognise. The details are below.", action: "retry" };
    }
  })();
  const err: FriendlyError = { code, ...copy };
  if (ctx.status !== undefined) err.status = ctx.status;
  if (ctx.detail) err.detail = scrubVoice(ctx.detail, ctx.secrets).slice(0, DETAIL_CHARS);
  return err;
}

/** A recording the vendor would not take: too big (Groq: 25 MB on the free tier, 100 MB on Dev; checked 2 Oct 2026). */
export function tooLarge(vendor: VoiceVendor, status?: number): FriendlyError {
  const err: FriendlyError = {
    code: "unknown",
    title: `The recording is too large for ${LABEL[vendor]}`,
    message: "Ask in shorter turns (under a minute each), or pick another way to hear you in Settings → Voice.",
    action: "settings",
  };
  if (status !== undefined) err.status = status;
  return err;
}

/**
 * An upstream answer (or none: `status` null means the request never got
 * there) as a FriendlyError. ElevenLabs reports an exhausted quota as a 401
 * whose body says quota_exceeded, so the body is read before the status.
 */
export function classifyVoice(vendor: VoiceVendor, status: number | null, body: string, secrets: string[] = []): FriendlyError {
  const ctx: VoiceErrorContext = { secrets, ...(status !== null ? { status } : {}) };
  if (status === null) return voiceFriendly("network", vendor, ctx);
  if (status === 402 || /quota_exceeded|insufficient_(credits|funds|quota)|payment_required|out of (credits|characters)/i.test(body)) return voiceFriendly("out_of_credits", vendor, ctx);
  if (status === 413 || /request_too_large|(file|audio|request|entity|payload)[^.]{0,40}too large|exceeds?[^.]{0,20}(file|maximum|max) ?size/i.test(body)) return tooLarge(vendor, status);
  if (status === 401 || status === 403) return voiceFriendly("invalid_key", vendor, ctx);
  // Groq's 498: its flex tier is at capacity, a wait like any rate limit.
  if (status === 429 || status === 498) return voiceFriendly("rate_limited", vendor, ctx);
  if (status === 404 || /voice_not_found|voice.*(not found|does not exist)|model.*not found/i.test(body)) return voiceFriendly("model_unavailable", vendor, ctx);
  return voiceFriendly("unknown", vendor, { ...ctx, detail: body || `HTTP ${status}` });
}
