// A codebase on this computer named in a Learn request ("…in my kola v2 codebase"),
// found and read for the professor (src/lib/learnCodebase.ts), read only. Loopback +
// same-origin only (guarded); refused in hosted mode, where the disk is the server's.
import { guarded } from "@/lib/providers/guard";
import { learnCodebaseHandler } from "@/lib/learnCodebase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = guarded(learnCodebaseHandler());
