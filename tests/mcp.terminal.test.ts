// Terminal mode: `node mcp/dist/server.mjs <folder>` runs WalkMyCode with no AI
// app (mcp/src/cli.ts, mcp/src/terminal.ts). How the command line picks the
// mode, and how the page answers every request itself when no client is
// connected ("standalone", src/lib/bridge/fallback.ts): at once, with its own
// key, or a plain "add a key" — never "X isn't listening".
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { Bridge, type PageLink } from "../mcp/src/bridge";
import { decideMode, helpText, MAX_FOLDERS } from "../mcp/src/cli";
import { createLanternServer, type WalkMyCode } from "../mcp/src/server";
import { banner } from "../mcp/src/terminal";
import { openWorkspace } from "../mcp/src/workspace";
import { askViaBridge, noKeyHereError } from "../src/lib/adapters/bridgeAi";
import { aiName, BridgeClient, claudeLine, isStandalone, type BridgeSnapshot, type SocketLike } from "../src/lib/bridge/client";
import { STANDALONE_NAME } from "../src/lib/bridge/clientName";
import { answerRoute } from "../src/lib/bridge/fallback";
import { BRIDGE_PROTOCOL, type PageMessage, type ServerMessage } from "../src/lib/bridge/protocol";
import { AskError, emptyConversation, type AskResult } from "../src/lib/claude/client";
import { FakePage, FIXTURES, TEST_PAGE } from "./mcp.helpers";

describe("the command line picks the mode", () => {
  it("is the MCP server when an AI app starts it: no arguments, stdin a pipe", () => {
    assert.deepEqual(decideMode([], false), { mode: "mcp" });
  });

  it("prints the help when a person runs it bare in a terminal, instead of waiting for MCP messages", () => {
    assert.deepEqual(decideMode([], true), { mode: "help" });
    for (const a of [["--help"], ["-h"], ["help"], [".", "--help"]]) assert.deepEqual(decideMode(a, true), { mode: "help" }, a.join(" "));
    // Help asked for in a pipe is still help.
    assert.deepEqual(decideMode(["--help"], false), { mode: "help" });
  });

  it("prints the version", () => {
    for (const a of ["--version", "-v", "-V"]) assert.deepEqual(decideMode([a], false), { mode: "version" });
  });

  it("runs in the terminal with a folder, whether stdin is a terminal or not", () => {
    for (const tty of [true, false]) {
      assert.deepEqual(decideMode(["."], tty), { mode: "terminal", folders: ["."] });
      assert.deepEqual(decideMode(["open", "~/code/app"], tty), { mode: "terminal", folders: ["~/code/app"] });
    }
    assert.deepEqual(decideMode(["web", "api"], true), { mode: "terminal", folders: ["web", "api"] });
    assert.deepEqual(decideMode(["open", "web", "api", "--name", "shop"], true), { mode: "terminal", folders: ["web", "api"], name: "shop" });
    assert.deepEqual(decideMode(["--name=shop", "web", "api"], true), { mode: "terminal", folders: ["web", "api"], name: "shop" });
    // A folder called "open" or "help", or one starting with a dash, after --.
    assert.deepEqual(decideMode(["--", "open"], true), { mode: "terminal", folders: ["open"] });
    assert.deepEqual(decideMode(["--", "-odd"], true), { mode: "terminal", folders: ["-odd"] });
    assert.deepEqual(decideMode(["web", "open"], true), { mode: "terminal", folders: ["web", "open"] });
  });

  it("says what is wrong rather than guess", () => {
    const err = (a: string[]) => {
      const m = decideMode(a, true);
      assert.equal(m.mode, "error", a.join(" "));
      return m.mode === "error" ? m.message : "";
    };
    assert.match(err(["open"]), /open needs a folder/);
    assert.match(err(["--name", "shop"]), /Which folder/);
    assert.match(err(["--frobnicate", "."]), /Unknown option --frobnicate/);
    assert.match(err([".", "--name"]), /--name needs a name/);
    assert.match(err(["--name", "--help"]), /--name needs a name/);
    assert.match(err(["--name=", "."]), /--name needs a name/);
    assert.match(err(["--name", "x".repeat(81), "."]), /at most 80/);
    assert.match(err([""]), /empty folder/);
    assert.match(err(Array.from({ length: MAX_FOLDERS + 1 }, (_, i) => `f${i}`)), new RegExp(`At most ${MAX_FOLDERS} folders`));
  });

  it("explains both ways to run it in the help", () => {
    const h = helpText("9.9.9", "node mcp/dist/server.mjs");
    assert.match(h, /WalkMyCode 9\.9\.9/);
    assert.match(h, /node mcp\/dist\/server\.mjs <folder>/);
    assert.match(h, /open <folder>/);
    assert.match(h, /--name/);
    assert.match(h, /Settings → AI model/);
    assert.match(h, /ANTHROPIC_API_KEY/);
    assert.match(h, /Ctrl\+C/);
    assert.match(h, /WALKMYCODE_NO_BROWSER=1/);
  });

  it("prints a banner with what is mapped, the page's URL, who answers and how to stop", () => {
    const b = banner({ name: "team-tasks", folders: ["/code/team-tasks"], files: 12, url: "http://127.0.0.1:5000/?t=abc", opened: false });
    assert.match(b, /Mapped "team-tasks" \(12 files\) from \/code\/team-tasks/);
    assert.match(b, /Page: http:\/\/127\.0\.0\.1:5000\/\?t=abc/);
    assert.match(b, /Open the link above/);
    assert.match(b, /Settings → AI model/);
    assert.match(b, /ANTHROPIC_API_KEY \/ OPENAI_API_KEY \/ GEMINI_API_KEY/);
    assert.match(b, /Ctrl\+C to stop/);
    assert.match(banner({ name: "shop", folders: ["/a/web", "/a/api"], files: 3, url: "u", opened: true }), /2 folders as one workspace:\n {4}\/a\/web\n {4}\/a\/api/);
  });
});

describe("who answers with no AI app connected", () => {
  it("is the page's own key, at once, whatever the loop or sampling would say", () => {
    for (const live of [true, false])
      for (const sampling of [true, false]) {
        assert.equal(answerRoute({ live, sampling, pageKey: true, standalone: true }), "key");
        assert.equal(answerRoute({ live, sampling, pageKey: false, standalone: true }), "tell");
      }
    // Unchanged with a client.
    assert.equal(answerRoute({ live: true, sampling: true, pageKey: true, standalone: false }), "queue");
    assert.equal(answerRoute({ live: false, sampling: true, pageKey: true }), "sampling");
  });
});

class FakeLink implements PageLink {
  sent: ServerMessage[] = [];
  send(m: ServerMessage) {
    this.sent.push(m);
  }
  close() {}
}

describe("the server in terminal mode", () => {
  it("says it is standalone (no made-up client), and hands every request back to the page at once, without sampling", () => {
    // A long wait: a standalone bridge must not use it.
    const b = new Bridge({ unheardAfterMs: 60_000 });
    b.setStandalone(true);
    b.setSampler(async () => assert.fail("no client to sample"));
    const link = new FakeLink();
    b.attach(link);
    const welcome = link.sent[0];
    assert.equal(welcome.type, "welcome");
    assert.equal(welcome.type === "welcome" && welcome.claude.standalone, true);
    assert.equal(welcome.type === "welcome" && welcome.claude.client, undefined);
    b.receive(link, { type: "request", ref: "p1", request: { kind: "question", payload: { text: "Where is sign-in?" } } });
    // Synchronously: queued, then unheard, with nothing left waiting for a client that will never come.
    const types = link.sent.map((m) => m.type);
    assert.ok(types.indexOf("queued") >= 0 && types.indexOf("unheard") > types.indexOf("queued"), types.join());
    assert.equal(b.status().queued, 0);
    assert.deepEqual(b.status().working, []);
    // The page withdrawing it afterwards is harmless.
    b.receive(link, { type: "cancel", id: "r1" });
    b.close();
  });
});

/** A socket the test plays the server's part on; it fails the test if a request is sent. */
class FakeSocket implements SocketLike {
  readyState = 0;
  sent: PageMessage[] = [];
  private listeners = new Map<string, ((ev: { data?: unknown; code?: number }) => void)[]>();
  addEventListener(type: string, l: (ev: { data?: unknown; code?: number }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), l]);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as PageMessage);
  }
  close() {}
  open() {
    this.readyState = 1;
    for (const l of this.listeners.get("open") ?? []) l({});
  }
  server(m: ServerMessage) {
    for (const l of this.listeners.get("message") ?? []) l({ data: JSON.stringify(m) });
  }
}

function standalonePage() {
  const s = new FakeSocket();
  const b = new BridgeClient({ open: () => s, setTimer: () => {} }).start();
  s.open();
  s.server({ type: "welcome", protocol: BRIDGE_PROTOCOL, workspace: null, claude: { listening: false, lastPollAt: null, queued: 0, working: [], standalone: true } });
  return { b, s };
}

describe("the page in terminal mode", () => {
  const base = { conversation: emptyConversation(), user: "Where is sign-in?", mode: "ask" as const };

  it("answers with its own key straight away, without sending the request anywhere, and speaks a spoken one", async () => {
    const { b, s } = standalonePage();
    const own: AskResult = { text: "Sign-in starts at `app/login.tsx:3`.", tour: null, conversation: emptyConversation(), finish: "stop" };
    const said: string[] = [];
    const r = await askViaBridge({ ...base, request: { kind: "spoken", payload: { text: "Where is sign-in?" } }, bridge: b, askOwn: async () => own, ownKey: async () => true, speak: (t) => said.push(t) });
    assert.equal(r, own);
    assert.ok(!s.sent.some((m) => m.type === "request"), "nothing went to the server");
    assert.deepEqual(said, [own.text]);
  });

  it("asks for a key, with Settings as the way, when it has none: no 'isn't listening'", async () => {
    const { b } = standalonePage();
    await assert.rejects(
      askViaBridge({ ...base, bridge: b, askOwn: async () => assert.fail("no key, no own answer"), ownKey: async () => false }),
      (e) => e instanceof AskError && e.info.title === "Add an AI key in Settings → AI model to ask questions here" && e.info.action === "settings" && !/listening/.test(`${e.info.title} ${e.info.message}`),
    );
    assert.equal(noKeyHereError().action, "settings");
  });

  it("answers here when the server hands a request back before the page knew it was standalone", async () => {
    const s = new FakeSocket();
    const b = new BridgeClient({ open: () => s, setTimer: () => {} }).start();
    s.open();
    // The request goes before the welcome; the server then says standalone and hands it back.
    const own: AskResult = { text: "Here.", tour: null, conversation: emptyConversation(), finish: "stop" };
    let asked = false;
    const answer = askViaBridge({ ...base, bridge: b, askOwn: async () => ((asked = true), own), ownKey: async () => false });
    const req = s.sent.find((m): m is Extract<PageMessage, { type: "request" }> => m.type === "request");
    assert.ok(req);
    s.server({ type: "welcome", protocol: BRIDGE_PROTOCOL, workspace: null, claude: { listening: false, lastPollAt: null, queued: 0, working: [], standalone: true } });
    s.server({ type: "queued", id: "r1", ref: req.ref, position: 1 });
    s.server({ type: "unheard", id: "r1" });
    await assert.rejects(answer, (e) => e instanceof AskError && e.info.title.startsWith("Add an AI key"));
    assert.equal(asked, false);
  });

  it("names nobody as the client, and says it answers here in the pill", () => {
    const snap: BridgeSnapshot = { conn: "open", claude: { listening: false, lastPollAt: null, queued: 0, working: [], standalone: true }, workspace: null, pending: [], error: null };
    assert.equal(isStandalone(snap), true);
    assert.equal(aiName(snap), STANDALONE_NAME);
    const now = Date.now();
    assert.deepEqual(claudeLine(snap, now), { text: "Answering here", tone: "ok" });
    assert.deepEqual(claudeLine(snap, now, { provider: "Anthropic", ready: true }), { text: "Answering here with Anthropic", tone: "ok" });
    assert.deepEqual(claudeLine(snap, now, { provider: "Anthropic", ready: false }), { text: "Add an AI key in Settings → AI model to ask questions here", tone: "bad" });
    const busy = { ...snap, pending: [{ ref: "p1", kind: "question" as const, id: null, state: "sending" as const, position: null, at: now }] };
    assert.deepEqual(claudeLine(busy, now, { provider: "OpenAI", ready: true }), { text: "Answering here with OpenAI…", tone: "busy" });
    // Never "Waiting for" or "isn't listening", even long after any poll.
    assert.doesNotMatch(claudeLine(snap, now + 10 * 60_000)?.text ?? "", /Waiting|listening/);
    // A connected client is unchanged.
    const client: BridgeSnapshot = { ...snap, claude: { listening: true, lastPollAt: null, queued: 0, working: [], client: "Cursor" } };
    assert.equal(isStandalone(client), false);
    assert.deepEqual(claudeLine(client, now), { text: "Cursor is listening", tone: "ok" });
  });
});

describe("terminal mode end to end: the page server with no MCP client", () => {
  let home: string;
  const savedHome = process.env.WALKMYCODE_HOME;
  let lantern: WalkMyCode;
  let url: string;

  before(async () => {
    home = mkdtempSync(join(tmpdir(), "walkmycode-terminal-"));
    process.env.WALKMYCODE_HOME = home;
    lantern = createLanternServer({ uiDir: TEST_PAGE, openBrowser: async () => false, ackTimeoutMs: 2_000, samePort: false, standalone: true });
    // As runTerminal does: map the folder as walkmycode_open would, then start the page server.
    lantern.session.opened(await openWorkspace([join(FIXTURES, "monolith")], {}));
    url = (await lantern.session.page()).url;
  });

  after(async () => {
    await lantern.close();
    if (savedHome === undefined) delete process.env.WALKMYCODE_HOME;
    else process.env.WALKMYCODE_HOME = savedHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("welcomes the page with the workspace and as standalone, and hands its requests straight back", async () => {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/\?t=\S+$/);
    const page = await FakePage.connect(url);
    try {
      const welcome = page.messages[0];
      assert.equal(welcome.type === "welcome" && welcome.workspace?.name, "monolith");
      assert.equal(welcome.type === "welcome" && welcome.claude.standalone, true);
      assert.equal(welcome.type === "welcome" && welcome.claude.client, undefined);
      const t0 = Date.now();
      const queued = await page.request({ kind: "explain", payload: { path: "lib/auth.ts", from: 1, to: 3 } });
      await page.next((m) => m.type === "unheard" && m.id === queued.id, 1_000);
      assert.ok(Date.now() - t0 < 1_000, "no 3.5 s wait");
      assert.equal(lantern.bridge.status().queued, 0);
    } finally {
      await page.close();
    }
  });
});
