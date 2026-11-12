// The local web server of WalkMyCode for Claude (docs/MCP.md §2.2, §6): the page
// and its WebSocket bridge, on 127.0.0.1 at a random free port. Only the
// user's browser, holding this launch's key, gets in:
//  - the page's URL carries a per-launch token (?t=…). The first visit swaps
//    it for an HttpOnly cookie and takes it out of the address bar; every other
//    request must bring that cookie.
//  - every request's Host must be this server's own (127.0.0.1:port or
//    localhost:port), so a site that points its own name at 127.0.0.1 (DNS
//    rebinding) is refused;
//  - the WebSocket also needs this server's own Origin, besides the cookie.
// So no other site, and no local process without the token, can drive the page
// or read the code through it. The page and the code are only read (GET and
// HEAD); the few local routes that change something (routes.ts: the user's
// answers, the talk mode, a voice key, the voice calls) take POST or DELETE,
// and only with the cookie, from this server's own Origin, as JSON, and within
// a size limit.
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, resolve, sep } from "node:path";
import type { Duplex } from "node:stream";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type { CodeMap } from "../../src/analyzer/types";
import { BRIDGE_PATH, type ServerMessage, type WorkspaceInfo } from "../../src/lib/bridge/protocol";
import type { LocalRun } from "../../src/lib/localrun/hub";
import { LOCALRUN_SOCKET_PATH } from "../../src/lib/localrun/protocol";
import type { Bridge, PageLink } from "./bridge";
import { log } from "./log";
import { bodyLimit, type Handler } from "./routes";
import { guardText } from "./secrets";

// ── the checks (pure, so tests can feed them anything) ──

/** The cookie that holds this launch's token. The port is in its name: cookies are shared across ports. */
export const cookieName = (port: number): string => `lantern_${port}`;

/** Is this Host header this server's own? Anything else is a DNS-rebinding attempt or a stray request. */
export function hostOk(host: string | undefined, port: number): boolean {
  const h = host?.trim().toLowerCase();
  return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
}

/** Is this Origin this server's own page? A WebSocket from any other site is refused. */
export function originOk(origin: string | undefined, port: number): boolean {
  const o = origin?.trim().toLowerCase();
  return o === `http://127.0.0.1:${port}` || o === `http://localhost:${port}`;
}

/** This launch's token from a Cookie header, or null. */
export function cookieToken(header: string | undefined, port: number): string | null {
  if (!header) return null;
  const name = cookieName(port);
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** The token compared in constant time. */
export function sameToken(given: string | null | undefined, token: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── the server ──

/** What the page fetches about the open workspace. */
export interface PageData {
  info: WorkspaceInfo;
  map: CodeMap;
  files: Record<string, string>;
}

export interface WebOptions {
  bridge: Bridge;
  /** The page's folder: the `mcp` front-end target (npm run build:mcp-ui), or a test page. */
  uiDir: string;
  workspace: () => PageData | null;
  /** The local routes, by "METHOD /path" (routes.ts). */
  api?: Map<string, Handler>;
  /** Listen here when it is free (the last launch's port, so the page's own storage, like its audio
   * cache, carries over); else at a random free port. */
  preferPort?: number;
  /** Tests fix it; otherwise a fresh random one per launch. */
  token?: string;
  /** How often an open page is pinged; a page that misses a ping is dropped. */
  heartbeatMs?: number;
  /** "Run on: This computer" and the terminal: their socket, at LOCALRUN_SOCKET_PATH, once the user allowed it. */
  localRun?: LocalRun;
}

export interface Web {
  port: number;
  /** http://127.0.0.1:<port> */
  origin: string;
  /** The page's URL with this launch's token: what the user opens. */
  url: string;
  token: string;
  close(): Promise<void>;
}

const HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cache-Control": "no-store",
};

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".py": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

// What someone sees when they open the page without this launch's key (a
// bookmark, a copied address, an old tab). It's a page a person reads, so it
// looks like WalkMyCode rather than a bare error, but it stays one file: inline
// CSS, no fonts or images to fetch, and nothing about the session in it.
const NEEDS_LINK = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WalkMyCode: open it from your AI app's link</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; box-sizing: border-box;
    background: radial-gradient(120% 90% at 50% 0%, #2d2924, #23201c) fixed, #23201c;
    color: #efe9dd; font: 16px/1.55 "Segoe UI", system-ui, sans-serif;
  }
  main { max-width: 460px; padding: 28px 30px; background: #2e2a25; border: 1px solid #4a443c; border-radius: 12px; }
  .mark { margin: 0 0 14px; font: 700 30px/1.1 "Segoe Print", "Comic Sans MS", cursive; color: #f3d77a; letter-spacing: .4px; }
  p { margin: 0; }
  .hint { margin-top: 10px; color: #b8ae9c; font-size: 14px; }
</style>
</head>
<body>
<main>
  <p class="mark">WalkMyCode</p>
  <p>Open WalkMyCode from the link your AI app gave you (Claude, Antigravity, Cursor&hellip;), or ask it to &ldquo;open WalkMyCode&rdquo; again.</p>
  <p class="hint">That link carries the key for this session, so this address on its own can't show your code.</p>
</main>
</body>
</html>
`;

// The refusal above, sent as HTML with a CSP that lets it load nothing at all
// beyond its own inline style.
function needsLink(res: ServerResponse): void {
  res.writeHead(403, {
    ...HEADERS,
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  });
  res.end(NEEDS_LINK);
}

function plain(res: ServerResponse, status: number, text: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...HEADERS, "Content-Type": "text/plain; charset=utf-8", ...extra });
  res.end(text);
}

function json(res: ServerResponse, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(200, { ...HEADERS, "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function textOf(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

/** A file of the page's folder; never anything outside it. A path with no extension is a page of the app: index.html. */
async function serveStatic(root: string, pathname: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return plain(res, 400, "Bad path.");
  }
  if (rel.includes("\0") || rel.includes("\\")) return plain(res, 400, "Bad path.");
  let file = resolve(root, `.${rel.endsWith("/") ? `${rel}index.html` : rel}`);
  if (file !== root && !file.startsWith(root + sep)) return plain(res, 404, "Not found.");
  let s = await stat(file).catch(() => null);
  if (s?.isDirectory()) {
    file = join(file, "index.html");
    s = await stat(file).catch(() => null);
  }
  if (!s && !extname(rel)) {
    file = join(root, "index.html");
    s = await stat(file).catch(() => null);
  }
  if (!s?.isFile()) return plain(res, 404, "Not found.");
  res.writeHead(200, { ...HEADERS, "Content-Type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "Content-Length": String(s.size) });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file)
    .on("error", () => res.destroy())
    .pipe(res);
}

/** A request body, up to `limit` bytes; null when it is longer. */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((done, fail) => {
    const parts: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) over = true;
      if (!over) parts.push(c);
    });
    req.on("end", () => done(over ? null : Buffer.concat(parts)));
    req.on("error", fail);
  });
}

/** The incoming headers a route may read: never the cookie. */
const PASSED = ["host", "origin", "content-type", "accept", "sec-fetch-site", "sec-fetch-mode"];
/** The route's headers the page may see. */
const KEPT = /^(content-type|content-length|cache-control|x-lantern-[a-z-]+)$/i;

/**
 * One of the local routes. Anything that changes something (POST, DELETE) must come from this server's own
 * Origin, as JSON, within the route's size limit; the route itself is a web handler (Request in, Response out),
 * the same as the full app's, and its answer is streamed back (narration audio plays while it arrives).
 */
async function callRoute(route: Handler, req: IncomingMessage, res: ServerResponse, url: URL, port: number): Promise<void> {
  const method = req.method ?? "GET";
  let body: Buffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    if (!originOk(req.headers.origin, port)) return plain(res, 403, "WalkMyCode takes changes only from its own page.");
    if (!/^application\/json\b/i.test(req.headers["content-type"]?.trim() ?? "")) return plain(res, 415, "Send JSON (content-type: application/json).");
    const read = await readBody(req, bodyLimit(url.pathname));
    if (!read) return plain(res, 413, "That is more than WalkMyCode takes in one request.");
    body = read;
  }
  const headers = new Headers();
  for (const name of PASSED) {
    const v = req.headers[name];
    if (typeof v === "string") headers.set(name, v);
  }
  const ac = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) ac.abort();
  });
  const answer = await route(new Request(`http://127.0.0.1:${port}${url.pathname}${url.search}`, { method, headers, ...(body ? { body: new Uint8Array(body) } : {}), signal: ac.signal }));
  // One spelling per header (the route's lower case wins over the page server's own).
  const out: Record<string, string> = Object.fromEntries(Object.entries(HEADERS).map(([k, v]) => [k.toLowerCase(), v]));
  answer.headers.forEach((v, k) => {
    if (KEPT.test(k)) out[k.toLowerCase()] = v;
  });
  res.writeHead(answer.status, out);
  if (!answer.body || method === "HEAD") {
    res.end();
    return;
  }
  const reader = answer.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (res.destroyed) return void reader.cancel().catch(() => {});
      if (!res.write(value))
        await new Promise<void>((ok) => {
          res.once("drain", ok);
          res.once("close", ok);
        });
    }
    res.end();
  } catch {
    // The upstream stopped part-way (or the page went away): end what was sent.
    res.destroy();
  }
}

/** A per-launch token: 24 random bytes (32 characters). Every tool result passes the secret guard, so a token the
 * guard would take for a key (a run that happens to start like `sk-…`) is drawn again: the URL reaches Claude whole. */
export function freshToken(): string {
  for (;;) {
    const t = randomBytes(24).toString("base64url");
    if (guardText(`/?t=${t}\n`, []) === `/?t=${t}\n`) return t;
  }
}

/** Start the page's server on 127.0.0.1 at a free port. */
export async function startWeb(o: WebOptions): Promise<Web> {
  const token = o.token ?? freshToken();
  const root = resolve(o.uiDir);
  if (!(await stat(join(root, "index.html")).catch(() => null))) log(`no page to serve: ${root} has no index.html (set WALKMYCODE_UI_DIR, or run npm run build:mcp)`);
  let port = 0;

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!hostOk(req.headers.host, port)) return plain(res, 403, `WalkMyCode only answers at 127.0.0.1:${port}.`);
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const method = req.method ?? "GET";
    const route = o.api?.get(`${method} ${url.pathname}`);
    if (method !== "GET" && method !== "HEAD" && !route) return plain(res, 405, "WalkMyCode's page server only reads, except for its own few routes.", { Allow: "GET, HEAD" });
    const given = method === "GET" ? url.searchParams.get("t") : null;
    if (given !== null) {
      if (!sameToken(given, token)) return needsLink(res);
      // The token becomes a cookie, and the address bar loses it.
      url.searchParams.delete("t");
      res.writeHead(303, { ...HEADERS, "Set-Cookie": `${cookieName(port)}=${token}; HttpOnly; SameSite=Lax; Path=/`, Location: url.pathname + url.search });
      res.end();
      return;
    }
    if (!sameToken(cookieToken(req.headers.cookie, port), token)) return needsLink(res);
    if (route) return callRoute(route, req, res, url, port);
    if (url.pathname === "/api/workspace") {
      const w = o.workspace();
      return json(res, w ? { workspace: w.info, map: w.map } : { workspace: null });
    }
    if (url.pathname === "/api/files") return json(res, o.workspace()?.files ?? {});
    return serveStatic(root, url.pathname, req, res);
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      log("page server error:", e);
      if (!res.headersSent) plain(res, 500, "WalkMyCode's page server hit an error.");
      else res.destroy();
    });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 20 << 20, perMessageDeflate: false });

  const onPage = (ws: WebSocket): void => {
    let alive = true;
    const link: PageLink = {
      send: (m: ServerMessage) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
      },
      close: (code, reason) => ws.close(code, reason),
    };
    const beat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, o.heartbeatMs ?? 30_000);
    beat.unref();
    ws.on("pong", () => (alive = true));
    ws.on("message", (data: RawData, binary: boolean) => {
      alive = true;
      if (binary) return link.send({ type: "rejected", error: "Messages are JSON text." });
      let raw: unknown;
      try {
        raw = JSON.parse(textOf(data));
      } catch {
        return link.send({ type: "rejected", error: "Messages are JSON." });
      }
      o.bridge.receive(link, raw);
    });
    ws.on("close", () => {
      clearInterval(beat);
      o.bridge.detach(link);
    });
    ws.on("error", (e) => log("page connection error:", e));
    o.bridge.attach(link);
  };

  // A run or a terminal: what this socket started dies with it.
  const onLocalRun = (ws: WebSocket): void => {
    const conn = o.localRun?.connect({
      send: (m) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
      },
      close: (code, reason) => ws.close(code, reason),
    });
    if (!conn) return ws.close(4403, "not allowed");
    ws.on("message", (data: RawData, binary: boolean) => {
      if (binary) return;
      let raw: unknown;
      try {
        raw = JSON.parse(textOf(data));
      } catch {
        return;
      }
      conn.receive(raw);
    });
    ws.on("close", () => conn.closed());
    ws.on("error", (e) => {
      log("local-run connection error:", e);
      conn.closed();
    });
  };

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const refuse = (status: string) => {
      socket.once("finish", () => socket.destroy());
      socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    let pathname = "";
    try {
      pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    } catch {
      // refused below
    }
    const local = pathname === LOCALRUN_SOCKET_PATH && !!o.localRun;
    if (pathname !== BRIDGE_PATH && !local) return refuse("404 Not Found");
    if (!hostOk(req.headers.host, port) || !originOk(req.headers.origin, port) || !sameToken(cookieToken(req.headers.cookie, port), token)) return refuse("403 Forbidden");
    if (local) {
      // Off until the user allows it on the page (Settings -> This computer).
      if (!o.localRun!.allowed()) return refuse("403 Forbidden");
      return wss.handleUpgrade(req, socket, head, onLocalRun);
    }
    wss.handleUpgrade(req, socket, head, onPage);
  });

  const listen = (at: number) =>
    new Promise<void>((ok, fail) => {
      server.once("error", fail);
      server.listen(at, "127.0.0.1", () => {
        server.off("error", fail);
        ok();
      });
    });
  // The last launch's port when it is free (the page's own storage is per port), else any free one.
  const preferred = o.preferPort && Number.isInteger(o.preferPort) && o.preferPort >= 1024 && o.preferPort <= 65535 ? o.preferPort : 0;
  await listen(preferred).catch((e: unknown) => {
    if (!preferred) throw e;
    return listen(0);
  });
  port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;

  return {
    port,
    origin,
    url: `${origin}/?t=${token}`,
    token,
    close: async () => {
      o.localRun?.closeAll("The WalkMyCode MCP server stopped.");
      for (const c of wss.clients) c.terminate();
      await new Promise<void>((ok) => wss.close(() => ok()));
      server.closeAllConnections();
      await new Promise<void>((ok) => server.close(() => ok()));
    },
  };
}

/** Open a URL in the user's default browser. False when that could not even start: the URL is in Claude's reply anyway. */
export function openInBrowser(url: string): Promise<boolean> {
  const [cmd, args]: [string, string[]] =
    process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  return new Promise((done) => {
    try {
      // stdio ignored: the child must never write into the MCP protocol on stdout.
      const child = spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true });
      child.once("error", () => done(false));
      child.once("spawn", () => {
        child.unref();
        done(true);
      });
    } catch {
      done(false);
    }
  });
}
