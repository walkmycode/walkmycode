// Narration: the text of a tour step or an answer, read by the narrator saved in
// Settings → Voice and streamed back as audio/mpeg (?timestamps=1: NDJSON with
// ElevenLabs' character timings). Loopback + same-origin only; the key stays here.
import { guarded } from "@/lib/providers/guard";
import { speakHandler } from "@/lib/voice/routes";

export const runtime = "nodejs";
export const maxDuration = 120;

export const POST = guarded(speakHandler());
