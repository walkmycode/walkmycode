// The microphone, in small pieces, to the on-device recognizer; the words
// heard so far come back in each answer. Loopback + same-origin only
// (guarded); hosted mode refuses. The audio never leaves this computer.
import { guarded } from "@/lib/providers/guard";
import { streamHandler } from "@/lib/voice/parakeet/routes";

export const runtime = "nodejs";

export const POST = guarded(streamHandler());
