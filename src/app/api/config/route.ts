// GET: the catalogue with has_key per provider, the saved choice and
// readiness. POST: save a new choice. Keys never appear here, only whether
// one is set and where it came from. Loopback + same-origin only. The bodies
// live in src/lib/providers/configRoutes.ts (the MCP page's server runs them too).
import { configGetHandler, configPostHandler } from "@/lib/providers/configRoutes";
import { guarded } from "@/lib/providers/guard";

export const runtime = "nodejs";

export const GET = guarded(configGetHandler());

export const POST = guarded(configPostHandler());
