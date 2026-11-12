// "Run on: This computer" and the terminal (src/lib/localrun): GET says whether
// it is allowed, which toolchains and shells were found, and (once allowed)
// where the page's socket is, with this launch's token; POST allows, revokes
// or sets the time limit. Loopback + same-origin only (guarded), and a
// loopback Host even under WALKMYCODE_ALLOW_REMOTE=1. Hosted mode refuses.
import { guarded } from "@/lib/providers/guard";
import { localRunHandlers } from "@/lib/localrun/routes";
import { localRun, socketFor } from "@/lib/localrun/socket";

export const runtime = "nodejs";

const handlers = () => localRunHandlers(localRun(), socketFor);

export const GET = guarded((req) => handlers().GET(req));
export const POST = guarded((req) => handlers().POST(req));
