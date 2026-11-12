// The ElevenLabs account's voices, for the voice picker in Settings → Voice.
// Loopback + same-origin only; the key stays here.
import { guarded } from "@/lib/providers/guard";
import { voicesHandler } from "@/lib/voice/routes";

export const runtime = "nodejs";

export const GET = guarded(voicesHandler());
