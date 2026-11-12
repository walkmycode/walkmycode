// Can a question be asked right now? null when yes, else the FriendlyError
// to show (no model, missing key, unknown model, local server down).
import { readinessHandler } from "@/lib/providers/configRoutes";
import { guarded } from "@/lib/providers/guard";

export const runtime = "nodejs";

export const GET = guarded(readinessHandler());
