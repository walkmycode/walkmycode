// The ElevenLabs lecturer: makes (once) and keeps in step the agent in the
// user's ElevenLabs account, then hands the browser a signed link to it, so
// the key never reaches the page. Loopback + same-origin only.
import { guarded } from "@/lib/providers/guard";
import { elevenSessionHandler } from "@/lib/voice/routes";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = guarded(elevenSessionHandler());
