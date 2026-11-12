// A recorded question turned into text by the transcriber chosen in Settings →
// Voice (Groq Whisper, Deepgram Nova-3, ElevenLabs Scribe), on the user's key.
// Loopback + same-origin only; the key never leaves the server.
import { guarded } from "@/lib/providers/guard";
import { transcribeHandler } from "@/lib/voice/routes";

export const runtime = "nodejs";

export const POST = guarded(transcribeHandler());
