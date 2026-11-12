// When the AI app stops polling (Antigravity ends its turn after a task), a
// question asked on WalkMyCode's page must still get an answer or a plain
// word (src/lib/bridge/fallback.ts): the loop if it is live, else MCP sampling
// when the client offers it, else the page's own key, else "X isn't listening".
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CreateMessageRequestSchema, type CreateMessageRequest } from "@modelcontextprotocol/sdk/types.js";
import { Bridge, type PageLink } from "../mcp/src/bridge";
import { createLanternServer, type WalkMyCode } from "../mcp/src/server";
import { askViaBridge, unheardError } from "../src/lib/adapters/bridgeAi";
import { BridgeClient, type SocketLike } from "../src/lib/bridge/client";
import { answerRoute, BUSY_LIVE_MS, loopLive, POLL_LIVE_MS } from "../src/lib/bridge/fallback";
import { BRIDGE_PROTOCOL, type PageMessage, type ServerMessage } from "../src/lib/bridge/protocol";
import { AskError, emptyConversation, type AskResult } from "../src/lib/claude/client";
import { FakePage, FIXTURES, TEST_PAGE } from "./mcp.helpers";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("who answers a page's request", () => {
  const now = 1_000_000;

  it("knows when the client's loop is live: waiting now, polled moments ago, or busy with a request it took", () => {
    assert.equal(loopLive({ listening: true, lastPollAt: null, working: 0, now }), true);
    assert.equal(loopLive({ listening: false, lastPollAt: null, working: 0, now }), false);
    assert.equal(loopLive({ listening: false, lastPollAt: now - 1_000, working: 0, now }), true);
    assert.equal(loopLive({ listening: false, lastPollAt: now - POLL_LIVE_MS - 1, working: 0, now }), false);
    // Working on an earlier request: it comes back to poll when done.
    assert.equal(loopLive({ listening: false, lastPollAt: now - 60_000, working: 1, now }), true);
    assert.equal(loopLive({ listening: false, lastPollAt: now - BUSY_LIVE_MS - 1, working: 1, now }), false);
  });

  it("queues for a live loop, else samples, else the page's own key, else says so", () => {
    for (const sampling of [true, false]) for (const pageKey of [true, false]) assert.equal(answerRoute({ live: true, sampling, pageKey }), "queue");
    assert.equal(answerRoute({ live: false, sampling: true, pageKey: true }), "sampling");
    assert.equal(answerRoute({ live: false, sampling: true, pageKey: false }), "sampling");
    assert.equal(answerRoute({ live: false, sampling: false, pageKey: true }), "key");
    assert.equal(answerRoute({ live: false, sampling: false, pageKey: false }), "tell");
  });
});

class FakeLink implements PageLink {
  sent: ServerMessage[] = [];
  send(m: ServerMessage) {
    this.sent.push(m);
  }
  close() {}
  types() {
    return this.sent.map((m) => m.type);
  }
}

const question = (text: string) => ({ type: "request", ref: "p1", request: { kind: "question", payload: { text } } });

describe("the server, when nobody polls", () => {
  it("tells the page after a short wait, and keeps the request queued for the client", async () => {
    const b = new Bridge({ unheardAfterMs: 20 });
    const link = new FakeLink();
    b.attach(link);
    b.receive(link, question("Where is sign-in?"));
    await sleep(60);
    assert.ok(link.sent.some((m) => m.type === "unheard" && m.id === "r1"), link.types().join());
    assert.equal(b.status().queued, 1);
    // Said once only.
    await sleep(60);
    assert.equal(link.sent.filter((m) => m.type === "unheard").length, 1);
    // The client comes back: it still gets it.
    const r = await b.next(50);
    assert.equal(r?.id, "r1");
    b.close();
  });

  it("waits while the loop is live", async () => {
    const b = new Bridge({ unheardAfterMs: 20 });
    const link = new FakeLink();
    b.attach(link);
    // The client polled just now and is between two calls.
    assert.equal(await b.next(1), null);
    b.receive(link, question("Where is sign-in?"));
    await sleep(60);
    assert.ok(!link.types().includes("unheard"));
    b.close();
  });

  it("asks the client's model when it can be sampled, and puts the request back when that fails", async () => {
    const b = new Bridge({ unheardAfterMs: 20 });
    const link = new FakeLink();
    b.attach(link);
    const seen: string[] = [];
    b.setSampler(async (r) => {
      seen.push(r.id);
      b.markAnswered(r.id);
      return true;
    });
    b.receive(link, question("Where is sign-in?"));
    await sleep(60);
    assert.deepEqual(seen, ["r1"]);
    assert.ok(link.sent.some((m) => m.type === "taken" && m.id === "r1"));
    assert.ok(!link.types().includes("unheard"));
    assert.equal(b.status().queued, 0);

    b.setSampler(async () => false);
    b.receive(link, { ...question("And sign-out?"), ref: "p2" });
    await sleep(60);
    assert.ok(link.sent.some((m) => m.type === "unheard" && m.id === "r2"));
    assert.equal(b.status().queued, 1, "back in the queue for the client");
    assert.deepEqual(b.status().working, []);
    b.close();
  });
});

/** A socket the test plays the server's part on. */
class FakeSocket implements SocketLike {
  readyState = 0;
  sent: PageMessage[] = [];
  private listeners = new Map<string, ((ev: { data?: unknown; code?: number }) => void)[]>();
  addEventListener(type: string, l: (ev: { data?: unknown; code?: number }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), l]);
  }
  send(data: string) {
    const m = JSON.parse(data) as PageMessage;
    this.sent.push(m);
    if (m.type === "request") queueMicrotask(() => this.onRequest?.(m));
  }
  close() {}
  onRequest?: (m: Extract<PageMessage, { type: "request" }>) => void;
  open() {
    this.readyState = 1;
    for (const l of this.listeners.get("open") ?? []) l({});
  }
  server(m: ServerMessage) {
    for (const l of this.listeners.get("message") ?? []) l({ data: JSON.stringify(m) });
  }
}

/** A page whose server says nobody took the request. */
function unheardPage(client = "Antigravity") {
  const s = new FakeSocket();
  const b = new BridgeClient({ open: () => s, setTimer: () => {} }).start();
  s.open();
  s.server({ type: "welcome", protocol: BRIDGE_PROTOCOL, workspace: null, claude: { listening: false, lastPollAt: null, queued: 0, working: [], client } });
  s.onRequest = (m) => {
    s.server({ type: "queued", id: "r1", ref: m.ref, position: 1 });
    s.server({ type: "unheard", id: "r1" });
  };
  return { b, s };
}

describe("the page, when the client isn't listening", () => {
  const base = { conversation: emptyConversation(), user: "Where is sign-in?", mode: "ask" as const };

  it("says so by name, with Settings as the way to answer here, when it has no key", async () => {
    const { b } = unheardPage();
    await assert.rejects(
      askViaBridge({ ...base, bridge: b, askOwn: async () => assert.fail("no key, no own answer"), ownKey: async () => false }),
      (e) => e instanceof AskError && e.info.title === "Antigravity isn't listening" && /keep listening to WalkMyCode/.test(e.info.message) && /Settings → AI model/.test(e.info.message) && e.info.action === "settings",
    );
    assert.deepEqual(unheardError(), { code: "unknown", title: "Your AI app isn't listening", message: "Ask it to “keep listening to WalkMyCode”, or add a key in Settings → AI model to chat here.", action: "settings" });
  });

  it("answers with the page's own key, takes the request back from the queue, and speaks a spoken one", async () => {
    const { b, s } = unheardPage();
    const own: AskResult = { text: "Sign-in starts at `app/login.tsx:3`.", tour: null, conversation: emptyConversation(), finish: "stop" };
    const said: string[] = [];
    const r = await askViaBridge({ ...base, request: { kind: "spoken", payload: { text: "Where is sign-in?" } }, bridge: b, askOwn: async () => own, ownKey: async () => true, speak: (t) => said.push(t) });
    assert.equal(r, own);
    assert.deepEqual(s.sent.at(-1), { type: "cancel", id: "r1" });
    assert.deepEqual(said, [own.text]);
  });
});

describe("sampling end to end: a client that can be asked directly", () => {
  let home: string;
  const savedHome = process.env.WALKMYCODE_HOME;
  let lantern: WalkMyCode;
  let client: Client;
  const asked: CreateMessageRequest["params"][] = [];

  before(async () => {
    home = mkdtempSync(join(tmpdir(), "walkmycode-sampling-"));
    process.env.WALKMYCODE_HOME = home;
    lantern = createLanternServer({ uiDir: TEST_PAGE, openBrowser: async () => true, ackTimeoutMs: 2_000, samePort: false, unheardAfterMs: 50 });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await lantern.mcp.connect(serverSide);
    client = new Client({ name: "antigravity", version: "1.0.0" }, { capabilities: { sampling: {} } });
    client.setRequestHandler(CreateMessageRequestSchema, async (req) => {
      asked.push(req.params);
      return { role: "assistant", model: "gemini-test", content: { type: "text", text: "Sign-in checks the password. The check is in `lib/auth.ts:1-3`, and `nope.ts:4` isn't real." } };
    });
    await client.connect(clientSide);
  });

  after(async () => {
    await client.close().catch(() => {});
    await lantern.close();
    if (savedHome === undefined) delete process.env.WALKMYCODE_HOME;
    else process.env.WALKMYCODE_HOME = savedHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("answers a request nobody polls for with the client's model, grounded in the map and the code, through narrate and answer", async () => {
    const opened = await client.callTool({ name: "walkmycode_open", arguments: { path: join(FIXTURES, "monolith") } });
    const text = ((opened.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n");
    const url = /Page: (http:\/\/127\.0\.0\.1:\d+\/\?t=\S+)/.exec(text)?.[1] ?? "";
    const page = await FakePage.connect(url);
    try {
      const welcome = page.messages[0];
      assert.equal(welcome.type === "welcome" && welcome.claude.client, "Antigravity");
      // The client never calls next_request: it ended its turn.
      const queued = await page.request({ kind: "explain", payload: { path: "lib/auth.ts", from: 1, to: 3 } });
      const answer = (await page.next((m) => m.type === "command" && m.command.name === "answer", 5_000)) as Extract<ServerMessage, { type: "command" }>;
      assert.equal(answer.command.name === "answer" && answer.command.requestId, queued.id);
      assert.deepEqual(answer.command.name === "answer" && answer.command.citations, [{ path: "lib/auth.ts", from: 1, to: 3 }]);
      const narrate = page.commands("narrate")[0];
      assert.equal(narrate.command.name === "narrate" && narrate.command.text, "Sign-in checks the password.");
      assert.ok(page.messages.some((m) => m.type === "taken" && m.id === queued.id));
      assert.ok(!page.messages.some((m) => m.type === "unheard"));
      // What the model was given: the request, the map and the code it points at, numbered, and no tools.
      assert.equal(asked.length, 1);
      const prompt = asked[0].messages[0].content;
      const words = !Array.isArray(prompt) && prompt.type === "text" ? prompt.text : "";
      assert.match(words, /The user pressed Explain/);
      assert.match(words, /# The map/);
      assert.match(words, /## lib\/auth\.ts \(lines 1-/);
      assert.match(words, /^1: /m);
      assert.match(asked[0].systemPrompt ?? "", /cannot call tools/);
      assert.ok(words.length < 60_000);
      assert.equal(lantern.bridge.status().working.length, 0);
    } finally {
      await page.close();
    }
  });
});
