// The Learn room's AI: loopback + same-origin only, then one streamed text
// answer from the provider and model chosen in Settings, exactly as
// /api/claude resolves them (see src/lib/providers/learn.ts). The browser
// side is src/learn/lib/tutor.ts.
import { learnHandler } from "@/lib/providers/learn";
import { guarded } from "@/lib/providers/guard";

export const runtime = "nodejs";
export const maxDuration = 300;

export const POST = guarded(learnHandler());
