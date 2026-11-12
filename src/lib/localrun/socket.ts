// The full app's local-run socket. Next's route handlers cannot hold a
// WebSocket open, so the server starts a small WebSocket server of its own the
// first time the (guarded) GET /api/localrun is answered with the user's
// consent: on 127.0.0.1 only, at a random free port. A socket gets in only with
//  - this launch's token (random, handed out only by that guarded route, which
//    no other site can read);
//  - a Host of 127.0.0.1:<port> or localhost:<port> (no DNS rebinding);
//  - an Origin the app was itself opened at (one the guarded route was asked from);
//  - the user's consent, checked again on every message.
// One per server process (kept on globalThis, so a dev reload does not start a second).
import "server-only";
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { configPath } from "../providers/config";
import { join } from "node:path";
import { createLocalRun, hostedRefusal, type LocalRun } from "./hub";
import { spawnTracked } from "./processes";
import { sameToken } from "./tokens";

export const SOCKET_PATH = "/localrun";

/** Why an upgrade must be refused ("403 Forbidden"…), or null. Pure, so the tests feed it anything. */
export function checkUpgrade(req: { url?: string; host?: string; origin?: string }, me: { port: number; token: string; origins: Set<string> }): string | null {
  let url: URL;
  try {
    url = new URL(req.url ?? "/", "http://127.0.0.1");
  } catch {
    return "400 Bad Request";
  }
  if (url.pathname !== SOCKET_PATH) return "404 Not Found";
  const host = req.host?.trim().toLowerCase();
  if (host !== `127.0.0.1:${me.port}` && host !== `localhost:${me.port}`) return "403 Forbidden";
  const origin = req.origin?.trim().toLowerCase();
  if (!origin || !me.origins.has(origin)) return "403 Forbidden";
  if (!sameToken(url.searchParams.get("t"), me.token)) return "403 Forbidden";
  return null;
}

/** The origin of a page that asked the guarded route: http://localhost:3000 and the like (loopback only). */
export function originOf(req: Request): string | null {
  const host = (req.headers.get("host") ?? "").trim().toLowerCase();
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/.test(host)) return null;
  let scheme = "http:";
  try {
    scheme = new URL(req.url).protocol;
  } catch {
    // Keep http:.
  }
  return `${scheme}//${host}`;
}

interface Running {
  port: number;
  token: string;
  origins: Set<string>;
  close(): Promise<void>;
}

interface Global {
  lr: LocalRun;
  server: Promise<Running> | null;
}

const KEY = Symbol.for("walkmycode.localrun");

/**
 * "New project" in the full app: map the folder just made the way
 * `npm run index` does (scripts/index.ts), so it opens from /api/demo like any
 * indexed repo; its name is the workspace's name from then on.
 */
function indexProject(root: string, name: string): Promise<{ ok: boolean; workspace?: string; message?: string }> {
  const tsx = join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  return new Promise((done) => {
    let err = "";
    const child = spawnTracked(tsx, [join(process.cwd(), "scripts", "index.ts"), root, "--name", name], { cwd: process.cwd(), env: process.env, stdio: ["ignore", "ignore", "pipe"] });
    child.stderr?.on("data", (b: Buffer) => (err = (err + b.toString()).slice(-2000)));
    child.once("error", (e) => done({ ok: false, message: `The project couldn't be mapped: ${e.message}` }));
    child.once("close", (code) => done(code === 0 ? { ok: true, workspace: name } : { ok: false, message: `The project couldn't be mapped: ${err.trim().split("\n").pop() ?? `code ${code}`}` }));
  });
}

function state(): Global {
  const g = globalThis as unknown as Record<symbol, Global | undefined>;
  g[KEY] ??= { lr: createLocalRun({ configFile: configPath, refusal: () => hostedRefusal(), openCreated: indexProject }), server: null };
  return g[KEY]!;
}

/** The full app's local-run state (consent, toolchains, sockets). */
export const localRun = (): LocalRun => state().lr;

function textOf(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

/** Start the socket server (once). */
export function startSocketServer(lr: LocalRun, o: { token?: string; port?: number } = {}): Promise<Running> {
  const token = o.token ?? randomBytes(24).toString("base64url");
  const origins = new Set<string>();
  const http = createServer((_req, res) => {
    res.writeHead(426, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end("WalkMyCode's terminal socket: WebSocket only.");
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 << 20, perMessageDeflate: false });
  let port = 0;

  const onSocket = (ws: WebSocket) => {
    const conn = lr.connect({
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
    ws.on("error", () => conn.closed());
  };

  http.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const refuse = (status: string) => {
      socket.once("finish", () => socket.destroy());
      socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    const why = checkUpgrade({ url: req.url, host: req.headers.host, origin: req.headers.origin }, { port, token, origins });
    if (why) return refuse(why);
    if (!lr.allowed()) return refuse("403 Forbidden");
    wss.handleUpgrade(req, socket, head, onSocket);
  });

  return new Promise((ok, fail) => {
    http.once("error", fail);
    http.listen(o.port ?? 0, "127.0.0.1", () => {
      http.off("error", fail);
      port = (http.address() as AddressInfo).port;
      ok({
        port,
        token,
        origins,
        close: async () => {
          for (const c of wss.clients) c.terminate();
          await new Promise<void>((done) => wss.close(() => done()));
          http.closeAllConnections();
          await new Promise<void>((done) => http.close(() => done()));
        },
      });
    });
  });
}

/** Where the page that sent `req` connects: started on first use, its origin let in. Null when it may not. */
export async function socketFor(req: Request): Promise<{ url: string; token: string } | null> {
  const s = state();
  if (!s.lr.allowed()) return null;
  const origin = originOf(req);
  if (!origin) return null;
  s.server ??= startSocketServer(s.lr).catch((e: unknown) => {
    s.server = null;
    throw e;
  });
  const r = await s.server;
  r.origins.add(origin);
  return { url: `ws://127.0.0.1:${r.port}${SOCKET_PATH}`, token: r.token };
}
