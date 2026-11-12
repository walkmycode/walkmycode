// Shared by the WalkMyCode-for-Claude tests: the server on the MCP SDK's in-memory
// transport with a real client, and a fake page that talks to the bridge over a
// real WebSocket, the way a browser would (Origin, cookie).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";
import { createLanternServer, type WalkMyCode, type LanternOptions } from "../mcp/src/server";
import { cookieName } from "../mcp/src/web";
import { loadGrammarsFrom } from "../mcp/src/workspace";
import type { PageMessage, PageRequest, ServerMessage } from "../src/lib/bridge/protocol";

loadGrammarsFrom({ nodeModules: join(process.cwd(), "node_modules") });

export const FIXTURES = join(process.cwd(), "tests", "fixtures");
export const TEST_PAGE = join(process.cwd(), "mcp", "test-page");

export interface Started {
  lantern: WalkMyCode;
  client: Client;
  /** URLs WalkMyCode asked to open in the browser. */
  opened: string[];
  call(name: string, args?: Record<string, unknown>, opts?: RequestOptions): Promise<{ text: string; isError: boolean }>;
  close(): Promise<void>;
}

/** WalkMyCode and a connected MCP client. `roots` makes the client share those folders as its roots. */
export async function startLantern(o: Partial<LanternOptions> & { roots?: string[] } = {}): Promise<Started> {
  const opened: string[] = [];
  const { roots, ...options } = o;
  const lantern = createLanternServer({
    uiDir: TEST_PAGE,
    openBrowser: async (url) => {
      opened.push(url);
      return true;
    },
    ackTimeoutMs: 2_000,
    // Several servers run at once in the tests: each takes a port of its own.
    samePort: false,
    ...options,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await lantern.mcp.connect(serverSide);
  const client = new Client({ name: "walkmycode-test", version: "1.0.0" }, roots ? { capabilities: { roots: {} } } : {});
  if (roots) client.setRequestHandler(ListRootsRequestSchema, () => ({ roots: roots.map((r) => ({ uri: pathToFileURL(r).href, name: r })) }));
  await client.connect(clientSide);
  return {
    lantern,
    client,
    opened,
    async call(name, args = {}, opts) {
      const r = await client.callTool({ name, arguments: args }, undefined, opts);
      const content = (r.content ?? []) as { type: string; text?: string }[];
      return { text: content.map((c) => c.text ?? "").join("\n"), isError: r.isError === true };
    },
    async close() {
      await client.close().catch(() => {});
      await lantern.close();
    },
  };
}

/** The port and token in a page URL WalkMyCode returned. */
export function parsePageUrl(url: string): { port: number; token: string; origin: string } {
  const u = new URL(url);
  return { port: Number(u.port), token: u.searchParams.get("t") ?? "", origin: u.origin };
}

/** The Cookie header a browser holds after opening the page's URL. */
export function pageCookie(url: string): string {
  const { port, token } = parsePageUrl(url);
  return `${cookieName(port)}=${token}`;
}

/** A plain HTTP request with exactly these headers (fetch would not let a test set Host). */
export function get(port: number, path: string, headers: Record<string, string>, method = "GET"): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  return new Promise((done, fail) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (body += c));
      res.on("end", () => done({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", fail);
    req.end();
  });
}

/** A plain HTTP request with a body (POST, DELETE), with exactly these headers. */
export function send(port: number, path: string, headers: Record<string, string>, method: string, body: string | Buffer): Promise<{ status: number; headers: IncomingHttpHeaders; body: string; bytes: Buffer }> {
  return new Promise((done, fail) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method, headers: { ...headers, "Content-Length": String(Buffer.byteLength(body)) } }, (res) => {
      const parts: Buffer[] = [];
      res.on("data", (c: Buffer) => parts.push(c));
      res.on("end", () => {
        const bytes = Buffer.concat(parts);
        done({ status: res.statusCode ?? 0, headers: res.headers, body: bytes.toString("utf8"), bytes });
      });
    });
    req.on("error", fail);
    req.end(body);
  });
}

/** A page, as the bridge sees one: it can send requests, and it acknowledges commands (or not, or refuses them). */
export class FakePage {
  messages: ServerMessage[] = [];
  /** true: acknowledge every command; false: say nothing; a string: refuse with that reason. */
  ack: boolean | string = true;
  private listeners: ((m: ServerMessage) => void)[] = [];
  private refs = 0;

  private constructor(readonly ws: WebSocket) {
    ws.on("message", (data) => {
      const m = JSON.parse(String(data)) as ServerMessage;
      this.messages.push(m);
      if (m.type === "command" && this.ack !== false) this.send(this.ack === true ? { type: "ack", id: m.id, ok: true } : { type: "ack", id: m.id, ok: false, error: this.ack });
      for (const l of [...this.listeners]) l(m);
    });
  }

  /** Connect as a browser holding the page's cookie would; resolves on the server's welcome, rejects with the HTTP status of a refusal. */
  static connect(url: string, o: { origin?: string; cookie?: string | null; host?: string } = {}): Promise<FakePage> {
    const { port, origin } = parsePageUrl(url);
    const headers: Record<string, string> = {};
    const cookie = o.cookie === undefined ? pageCookie(url) : o.cookie;
    if (cookie) headers.Cookie = cookie;
    if (o.host) headers.Host = o.host;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge`, { origin: o.origin ?? origin, headers });
    const page = new FakePage(ws);
    return new Promise((done, fail) => {
      ws.once("unexpected-response", (_req, res) => {
        fail(new Error(`refused: ${res.statusCode}`));
        ws.terminate();
      });
      ws.once("error", (e) => fail(e));
      page.next((m) => m.type === "welcome", 5_000).then(() => done(page), fail);
    });
  }

  send(m: PageMessage | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(m));
  }

  /** Send a request and wait until the server has queued it. */
  async request(request: PageRequest): Promise<Extract<ServerMessage, { type: "queued" }>> {
    const ref = `t${++this.refs}`;
    const queued = this.next((m) => m.type === "queued" && m.ref === ref);
    this.send({ type: "request", ref, request });
    return (await queued) as Extract<ServerMessage, { type: "queued" }>;
  }

  /** The next message (already received or still to come) that matches. */
  next(match: (m: ServerMessage) => boolean, timeoutMs = 3_000): Promise<ServerMessage> {
    const seen = this.messages.find(match);
    if (seen) return Promise.resolve(seen);
    return new Promise((done, fail) => {
      const timer = setTimeout(() => {
        this.listeners = this.listeners.filter((l) => l !== listen);
        fail(new Error("the page got no such message"));
      }, timeoutMs);
      const listen = (m: ServerMessage) => {
        if (!match(m)) return;
        clearTimeout(timer);
        this.listeners = this.listeners.filter((l) => l !== listen);
        done(m);
      };
      this.listeners.push(listen);
    });
  }

  /** The commands received so far, by name. */
  commands(name?: string): Extract<ServerMessage, { type: "command" }>[] {
    return this.messages.filter((m): m is Extract<ServerMessage, { type: "command" }> => m.type === "command" && (!name || m.command.name === name));
  }

  close(): Promise<void> {
    return new Promise((done) => {
      if (this.ws.readyState === WebSocket.CLOSED) return done();
      this.ws.once("close", () => done());
      this.ws.close();
    });
  }
}

/** A made-up string of `n` characters from `alphabet` (deterministic per seed): fake keys built at run time,
 * so no key-shaped string sits in the test sources. */
export function fakeKey(n: number, seed: number, alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"): string {
  let x = seed;
  let s = "";
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    s += alphabet[x % alphabet.length];
  }
  return s;
}

/** Wait until `check` holds (polling), or fail after `timeoutMs`. */
export async function until(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > timeoutMs) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
}
