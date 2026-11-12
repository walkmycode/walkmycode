// GET and POST /api/localrun, as web handlers (Request in, Response out), so
// the full app's route (src/app/api/localrun/route.ts) and WalkMyCode for
// Claude's page server (mcp/src/routes.ts) run the very same code. Both wrap
// them in guarded() (loopback + same-origin + JSON for writes); on top of that
// these answer only a loopback Host, even when WALKMYCODE_ALLOW_REMOTE=1 opens
// the rest of the app to the network: running code is for this computer alone.
import { z } from "zod";
import { HttpError } from "../providers/guard";
import type { LocalRun } from "./hub";

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;

export function loopbackHost(req: Request): boolean {
  return LOOPBACK.test((req.headers.get("host") ?? "").trim());
}

const SaveBody = z.object({ allowed: z.boolean().optional(), timeout_s: z.number().int().min(1).max(3600).optional() }).strict();

const NO_STORE = { "cache-control": "no-store" };

export function localRunHandlers(lr: LocalRun, socketFor: (req: Request) => Promise<{ url: string; token: string | null } | null>) {
  const mustBeHere = (req: Request) => {
    if (!loopbackHost(req)) throw new HttpError(403, "Running code is only for WalkMyCode opened on this computer (localhost).");
  };
  return {
    async GET(req: Request): Promise<Response> {
      mustBeHere(req);
      const fresh = new URL(req.url).searchParams.has("detect");
      return Response.json(await lr.status(() => socketFor(req), fresh), { headers: NO_STORE });
    },
    async POST(req: Request): Promise<Response> {
      mustBeHere(req);
      const why = lr.refusal();
      if (why) throw new HttpError(403, why);
      const p = SaveBody.safeParse(await req.json());
      if (!p.success) throw new HttpError(400, "Send { allowed: true | false } and/or { timeout_s: 1 to 3600 }.");
      lr.save(p.data);
      return Response.json(await lr.status(() => socketFor(req)), { headers: NO_STORE });
    },
  };
}
