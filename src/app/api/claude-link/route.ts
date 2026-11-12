// Where this checkout's WalkMyCode for Claude bundle is, and whether one is
// running: what "Use my Claude subscription" shows (src/lib/claudeLink.ts).
import { claudeLink } from "@/lib/claudeLinkServer";
import { guarded } from "@/lib/providers/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = guarded(async () => Response.json(await claudeLink()));
