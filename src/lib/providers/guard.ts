// The request boundary for the settings and ask endpoints. WalkMyCode is a Next
// server anyone on the LAN could POST to, and a web page in the same browser
// could too, so every handler that touches keys or spends them first checks
// that the request came from this computer and from WalkMyCode's own origin.
import "server-only";
import { friendly } from "./errors";
import type { FriendlyError } from "./wire";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A failure a handler wants turned into a plain JSON error with a status. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Thrown by assertLocalSameOrigin; carries the 403 body. */
export class ForbiddenError extends Error {
  constructor(readonly error: FriendlyError) {
    super(error.title);
    this.name = "ForbiddenError";
  }
}

/** "localhost:3000" → "localhost"; "[::1]:3000" → "[::1]". */
function hostname(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  const i = h.indexOf(":");
  return i === -1 ? h : h.slice(0, i);
}

/** The host:port of an Origin header, or null when it does not parse. */
function originHost(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Where to tell a refused user to open WalkMyCode: SITE_URL when it is set;
 * else this Host when it may be used (loopback, or any host under
 * WALKMYCODE_ALLOW_REMOTE=1, or the old LANTERN_ALLOW_REMOTE=1); else localhost on the port the request came in on.
 */
function lanternOrigin(req: Request, remoteOk: boolean): string {
  try {
    if (process.env.SITE_URL) return new URL(process.env.SITE_URL).origin;
  } catch {
    // A malformed SITE_URL falls through to the Host.
  }
  const host = (req.headers.get("host") ?? "").trim().toLowerCase();
  let scheme = "http:";
  try {
    scheme = new URL(req.url).protocol;
  } catch {
    // Keep http: for a request without an absolute URL.
  }
  if (host && (remoteOk || LOOPBACK.has(hostname(host)))) return `${scheme}//${host}`;
  const port = /^:(\d{1,5})$/.exec(host.slice(hostname(host).length))?.[1];
  return `${scheme}//localhost${port ? `:${port}` : ""}`;
}

/** Why a request must be refused, or null when it may proceed. Pure, so tests can feed it plain Requests. */
export function checkLocalSameOrigin(req: Request): FriendlyError | null {
  const host = req.headers.get("host") ?? "";
  const remoteOk = (process.env.WALKMYCODE_ALLOW_REMOTE ?? process.env.LANTERN_ALLOW_REMOTE) === "1";
  const refuse = () => friendly("forbidden", { origin: lanternOrigin(req, remoteOk) });
  if (!remoteOk && !LOOPBACK.has(hostname(host))) return refuse();

  const site = req.headers.get("sec-fetch-site");
  if (site !== null) {
    if (site !== "same-origin" && site !== "none") return refuse();
  } else {
    const origin = req.headers.get("origin");
    if (origin !== null && originHost(origin) !== host.trim().toLowerCase()) return refuse();
  }

  const method = req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const type = req.headers.get("content-type") ?? "";
    if (!/^application\/json\b/i.test(type.trim())) return refuse();
  }
  return null;
}

/** Throws ForbiddenError unless the request is loopback, same-origin and (for writes) JSON. */
export function assertLocalSameOrigin(req: Request): void {
  const denied = checkLocalSameOrigin(req);
  if (denied) throw new ForbiddenError(denied);
}

/**
 * Wrap a route handler: run the guard first, and turn ForbiddenError into
 * the 403 body, HttpError into `{ error }` with its status, and anything
 * else into a 500 that never echoes the thrown message (it might hold a key).
 */
export function guarded(handler: (req: Request) => Promise<Response> | Response): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
      assertLocalSameOrigin(req);
      return await handler(req);
    } catch (e) {
      if (e instanceof ForbiddenError) return Response.json({ error: e.error }, { status: 403 });
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      if (e instanceof SyntaxError) return Response.json({ error: "Body is not valid JSON." }, { status: 400 });
      console.error("[walkmycode] handler failed:", e instanceof Error ? e.name : typeof e);
      return Response.json({ error: "Something went wrong on the server." }, { status: 500 });
    }
  };
}
