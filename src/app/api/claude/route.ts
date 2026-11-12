// The ask endpoint: loopback + same-origin only, then one model step through
// the saved provider (see src/lib/providers/ask.ts). The browser runs the
// tools itself, so no code is kept here.
import { askHandler } from "@/lib/providers/ask";
import { guarded } from "@/lib/providers/guard";

export const runtime = "nodejs";
export const maxDuration = 300;

export const POST = guarded(askHandler());
