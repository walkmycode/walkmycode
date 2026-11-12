// GET: the saved voice choice, whether each voice key is set, and what is not
// ready. POST: save a new choice. Keys are set through /api/config/key, like
// the model providers' keys. Loopback + same-origin only.
import { guarded } from "@/lib/providers/guard";
import { configGetHandler, configPostHandler } from "@/lib/voice/routes";

export const runtime = "nodejs";

export const GET = guarded(configGetHandler());
export const POST = guarded(configPostHandler());
