// The Learn room's saved work in the full app: lessons, courses, the profile,
// conversations, the notebook and recall cards, as files in .walkmycode/learn/
// (src/lib/learnStore.ts). Loopback + same-origin only (guarded). The browser
// side is src/learn/lib/store.ts.
import { guarded } from "@/lib/providers/guard";
import { learnStoreHandlers } from "@/lib/learnStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = learnStoreHandlers();

export const GET = guarded(handlers.GET);
export const PUT = guarded(handlers.PUT);
export const DELETE = guarded(handlers.DELETE);
