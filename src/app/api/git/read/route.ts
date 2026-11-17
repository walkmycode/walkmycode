// Line history in the desktop app without "run code on this computer": git blame and the file's
// own commits, read-only, from the folder the desktop app opened (src/lib/localrun/gitRead.ts says
// what it refuses). Loopback + same-origin + JSON only (guarded).
import { gitReadHandler } from "@/lib/localrun/gitRead";
import { guarded } from "@/lib/providers/guard";

export const runtime = "nodejs";

const handler = gitReadHandler();

export const POST = guarded((req) => handler(req));
