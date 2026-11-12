// A 30-second Deepgram grant for the browser's agent socket (the Deepgram
// lecturer). Loopback + same-origin only; the key never leaves the server.
import { guarded } from "@/lib/providers/guard";
import { tokenHandler } from "@/lib/voice/routes";

export const runtime = "nodejs";

export const POST = guarded(tokenHandler());
