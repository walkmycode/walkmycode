// On-device speech to text (Parakeet): where the model stands, and getting,
// removing or preloading it. Loopback + same-origin only (guarded); hosted
// mode refuses. Nothing here leaves the computer but the model's own download.
import { guarded } from "@/lib/providers/guard";
import { actionHandler, statusHandler } from "@/lib/voice/parakeet/routes";

export const runtime = "nodejs";

export const GET = guarded(statusHandler());
export const POST = guarded(actionHandler());
