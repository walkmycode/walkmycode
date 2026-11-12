// WalkMyCode for Claude's page (docs/MCP.md §8 B): its end of the bridge (every
// command acknowledged, requests followed to their answer, status and "another
// tab" shown), the AI adapter that turns Explain, Trace it, Tour and questions
// into bridge requests, what the page does with each of Claude's commands, and
// the voice parts that need no browser: the narration queue, the instant line
// for a spoken question, and how a question is heard.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import type { CodeMap } from "../src/analyzer/types";
import { askViaBridge, requestFor } from "../src/lib/adapters/bridgeAi";
import { workspaceOf, saveServerAnswers } from "../src/lib/adapters/serverStorage";
import { AskEnded, BridgeClient, claudeAlert, claudeLine, DOWN_AFTER_MS, NOT_READY, REPLACED_CODE, type BridgeSnapshot, type SocketLike } from "../src/lib/bridge/client";
import { applyCommand, litOf, tourOf, type PageUi } from "../src/lib/bridge/commands";
import { BRIDGE_PROTOCOL, parsePageRequest, type ClaudeStatus, type Command, type PageMessage, type ServerMessage } from "../src/lib/bridge/protocol";
import { ask, AskError, emptyConversation } from "../src/lib/claude/client";
import type { Tour } from "../src/lib/claude/tools";
import { ackLine, cardsNamed, keywords } from "../src/lib/voice/heard";
import { hearWithBrowser, pickListener } from "../src/lib/voice/listen";
import { hush, hushedFor, speaksFor } from "../src/lib/voice/mcp";
import { NarrationQueue, type QueueNarrator } from "../src/lib/voice/queue";
import { narratorInForce, setBrowserOnly, type VoiceView } from "../src/lib/voice/view";
import { describeRequest } from "../mcp/src/tools";
import { buildFixture, readFixture } from "./analyzer.helpers";

/** A socket the test plays the server's part on. */
class FakeSocket implements SocketLike {
  readyState = 0;
  sent: PageMessage[] = [];
  closed: number | null = null;
  private listeners = new Map<string, ((ev: { data?: unknown; code?: number }) => void)[]>();
  addEventListener(type: string, l: (ev: { data?: unknown; code?: number }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), l]);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as PageMessage);
  }
  close(code = 1000) {
    this.closed = code;
  }
  emit(type: string, ev: { data?: unknown; code?: number } = {}) {
    for (const l of this.listeners.get(type) ?? []) l(ev);
  }
  open() {
    this.readyState = 1;
    this.emit("open");
  }
  server(m: ServerMessage) {
    this.emit("message", { data: JSON.stringify(m) });
  }
  acks() {
    return this.sent.filter((m): m is Extract<PageMessage, { type: "ack" }> => m.type === "ack");
  }
}

const status = (o: Partial<ClaudeStatus> = {}): ClaudeStatus => ({ listening: false, lastPollAt: null, queued: 0, working: [], ...o });
const tick = () => new Promise((r) => setImmediate(r));

function connected(o: { now?: () => number } = {}) {
  const sockets: FakeSocket[] = [];
  const timers: (() => void)[] = [];
  const client = new BridgeClient({
    open: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    setTimer: (fn) => timers.push(fn),
    ...o,
  }).start();
  const s = sockets[0];
  s.open();
  s.server({ type: "welcome", protocol: BRIDGE_PROTOCOL, workspace: null, claude: status({ listening: true }) });
  return { client, s, sockets, timers };
}

describe("the page's bridge client", () => {
  it("says hello, and follows a request from sent to queued, taken and answered", async () => {
    const { client, s } = connected();
    assert.deepEqual(s.sent[0], { type: "hello", protocol: BRIDGE_PROTOCOL });
    const a = client.request({ kind: "question", payload: { text: "Where is sign-in?" } });
    const sent = s.sent.at(-1) as Extract<PageMessage, { type: "request" }>;
    assert.equal(sent.type, "request");
    assert.equal(sent.ref, a.ref);
    assert.equal(client.snapshot().pending[0].state, "sending");
    s.server({ type: "queued", id: "r1", ref: a.ref, position: 1 });
    assert.equal(await a.id, "r1");
    assert.equal(client.snapshot().pending[0].state, "queued");
    s.server({ type: "taken", id: "r1" });
    assert.equal(client.snapshot().pending[0].state, "taken");
    s.server({ type: "command", id: "c1", command: { name: "answer", requestId: "r1", markdown: "In **lib/auth.ts:7**.", citations: [] } });
    const answer = await a.answer;
    assert.equal(answer.markdown, "In **lib/auth.ts:7**.");
    assert.equal(client.snapshot().pending.length, 0);
    assert.deepEqual(s.acks().at(-1), { type: "ack", id: "c1", ok: true });
  });

  it("acknowledges every command: the handler's note, its error, or why nothing could do it", async () => {
    const { client, s } = connected();
    s.server({ type: "command", id: "c1", command: { name: "focus_node", nodeId: "x" } });
    await tick();
    assert.deepEqual(s.acks().at(-1), { type: "ack", id: "c1", ok: false, error: NOT_READY });
    const off = client.handle("focus_node", (c) => `Showing ${c.nodeId}.`);
    s.server({ type: "command", id: "c2", command: { name: "focus_node", nodeId: "x" } });
    await tick();
    assert.deepEqual(s.acks().at(-1), { type: "ack", id: "c2", ok: true, note: "Showing x." });
    client.handle("open_file", () => {
      throw new Error("No such file on the page.");
    });
    s.server({ type: "command", id: "c3", command: { name: "open_file", path: "nope.ts" } });
    await tick();
    assert.deepEqual(s.acks().at(-1), { type: "ack", id: "c3", ok: false, error: "No such file on the page." });
    off();
    s.server({ type: "command", id: "c4", command: { name: "focus_node", nodeId: "x" } });
    await tick();
    assert.equal(s.acks().at(-1)?.ok, false);
    // A new workspace and an answer no one asked for are taken even with no handler.
    s.server({ type: "command", id: "c5", command: { name: "workspace", workspace: { id: "w", name: "app", repos: ["app"], files: 3, mappedAt: "2026-10-01T00:00:00Z" } } });
    await tick();
    assert.equal(s.acks().at(-1)?.ok, true);
    assert.equal(client.snapshot().workspace?.name, "app");
    assert.equal(s.acks().length, 5, "every command got exactly one ack");
  });

  it("keeps an answer no request was waiting for, and tells the guide", async () => {
    const { client, s } = connected();
    const seen: [string, boolean][] = [];
    client.onAnswer((a, claimed) => seen.push([a.markdown, claimed]));
    s.server({ type: "command", id: "c1", command: { name: "answer", markdown: "Asked in Claude's chat.", citations: [] } });
    await tick();
    assert.deepEqual(seen, [["Asked in Claude's chat.", false]]);
    assert.equal(client.unclaimed[0].markdown, "Asked in Claude's chat.");
  });

  it("takes a request back, and ends one the server dropped or refused", async () => {
    const { client, s } = connected();
    const a = client.request({ kind: "tour", payload: {} });
    s.server({ type: "queued", id: "r7", ref: a.ref, position: 1 });
    await a.id;
    a.cancel();
    assert.deepEqual(s.sent.at(-1), { type: "cancel", id: "r7" });
    await assert.rejects(a.answer, (e) => e instanceof AskEnded && e.reason === "cancelled");
    const b = client.request({ kind: "question", payload: { text: "q" } });
    s.server({ type: "queued", id: "r8", ref: b.ref, position: 1 });
    s.server({ type: "dropped", id: "r8", reason: "Too many waiting." });
    await assert.rejects(b.answer, (e) => e instanceof AskEnded && e.reason === "dropped" && /Too many/.test(e.message));
    const c = client.request({ kind: "question", payload: { text: "q" } });
    s.server({ type: "rejected", ref: c.ref, error: "question needs text" });
    await assert.rejects(c.answer, (e) => e instanceof AskEnded && e.reason === "rejected");
    assert.equal(client.snapshot().pending.length, 0);
  });

  it("holds what it sends until the connection opens, reconnects, and stops when another tab takes over", () => {
    const sockets: FakeSocket[] = [];
    const timers: (() => void)[] = [];
    const client = new BridgeClient({ open: () => (sockets.push(new FakeSocket()), sockets.at(-1)!), setTimer: (fn) => timers.push(fn) }).start();
    client.request({ kind: "question", payload: { text: "early" } });
    assert.equal(sockets[0].sent.length, 0);
    sockets[0].open();
    assert.deepEqual(
      sockets[0].sent.map((m) => m.type),
      ["hello", "request"],
    );
    sockets[0].emit("close", { code: 1006 });
    assert.equal(client.snapshot().conn, "connecting");
    timers.shift()!();
    assert.equal(sockets.length, 2, "it reconnected");
    sockets[1].open();
    sockets[1].server({ type: "replaced" });
    sockets[1].emit("close", { code: REPLACED_CODE });
    assert.equal(client.snapshot().conn, "replaced");
    assert.equal(timers.length, 0, "a replaced tab does not reconnect");
  });

  it("refuses a server of another protocol version", () => {
    const sockets: FakeSocket[] = [];
    const client = new BridgeClient({ open: () => (sockets.push(new FakeSocket()), sockets.at(-1)!), reconnect: false }).start();
    sockets[0].open();
    sockets[0].server({ type: "welcome", protocol: BRIDGE_PROTOCOL + 1, workspace: null, claude: status() });
    assert.equal(client.snapshot().conn, "outdated");
  });

  it("sends activity at most once per interval", () => {
    let now = 0;
    const { client, s } = connected({ now: () => now });
    client.activity();
    client.activity();
    now += 25_000;
    client.activity();
    assert.equal(s.sent.filter((m) => m.type === "activity").length, 2);
  });
});

describe("what the page says about Claude", () => {
  const snap = (o: Partial<BridgeSnapshot>): BridgeSnapshot => ({ conn: "open", claude: status(), workspace: null, pending: [], error: null, ...o });
  const pending = (state: "sending" | "queued" | "taken") => [{ ref: "p1", kind: "question" as const, id: "r1", state, position: 1, at: 0 }];

  it("says plainly when a request waits and Claude is not polling", () => {
    assert.equal(claudeLine(snap({ pending: pending("queued") }), 0)!.text, "Waiting for your AI app…");
    // The client named itself in the handshake: the page says its name.
    assert.match(claudeLine(snap({ pending: pending("queued"), claude: status({ client: "Antigravity" }) }), 0)!.text, /^Waiting for Antigravity…/);
    assert.equal(claudeLine(snap({ claude: status({ client: "Antigravity", lastPollAt: null }) }), 0)!.text, "Antigravity isn't listening: ask it to continue when you want it back.");
    assert.equal(claudeLine(snap({ claude: status({ client: "Cursor", listening: true }) }), 0)!.text, "Cursor is listening");
    assert.equal(claudeLine(snap({ pending: pending("queued"), claude: status({ listening: true, client: "Claude" }) }), 0)!.text, "Sent to Claude…");
    assert.equal(claudeLine(snap({ pending: pending("taken") }), 0)!.text, "Your AI app is working on it…");
    assert.equal(claudeLine(snap({ claude: status({ listening: true }) }), 0)!.tone, "ok");
    // Between two polls: still listening; after a long silence: say so.
    const at = Date.parse("2026-10-01T10:00:00Z");
    assert.equal(claudeLine(snap({ claude: status({ lastPollAt: new Date(at).toISOString() }) }), at + 5_000)!.tone, "ok");
    assert.equal(claudeLine(snap({ claude: status({ lastPollAt: new Date(at).toISOString() }) }), at + 120_000)!.tone, "bad");
    assert.match(claudeLine(snap({ conn: "replaced" }), 0)!.text, /another tab/);
  });

  it("says the server isn't running once it has been out of reach a while, not \"Connecting…\" for ever", () => {
    const down = snap({ conn: "connecting", downSince: 1_000, claude: status({ client: "Claude" }) });
    assert.equal(claudeLine(down, 1_000 + DOWN_AFTER_MS - 1)!.text, "Connecting to WalkMyCode…");
    assert.match(claudeLine(down, 1_000 + DOWN_AFTER_MS)!.text, /^WalkMyCode's server isn't running: it stops when the Claude session/);
    assert.match(claudeLine({ ...down, claude: status({ standalone: true }) }, 1_000 + DOWN_AFTER_MS)!.text, /start it again in the terminal/);
    assert.equal(claudeLine(snap({ conn: "connecting" }), 1e12)!.text, "Connecting to WalkMyCode…");
  });

  it("notes when the connection dropped, and forgets it once connected again", () => {
    let t = 5_000;
    const { client, s, sockets, timers } = connected({ now: () => t });
    assert.equal(client.snapshot().downSince, null);
    s.emit("close", { code: 1006 });
    assert.equal(client.snapshot().downSince, 5_000);
    t = 9_000;
    timers.shift()!();
    sockets[1].emit("close", { code: 1006 });
    assert.equal(client.snapshot().downSince, 5_000, "kept from the first drop");
    timers.shift()!();
    sockets[2].open();
    assert.equal(client.snapshot().downSince, null);
  });

  it("raises an alert when Claude stopped listening (with the word to type) or the server is gone", () => {
    const at = Date.parse("2026-10-01T10:00:00Z");
    const quiet = snap({ claude: status({ client: "Claude", lastPollAt: new Date(at).toISOString() }) });
    assert.equal(claudeAlert(quiet, at + 5_000), null);
    const a = claudeAlert(quiet, at + 120_000)!;
    assert.equal(a.kind, "unheard");
    assert.equal(a.say, "continue");
    assert.match(a.text, /^Claude stopped listening.*type continue/);
    assert.equal(claudeAlert(snap({ claude: status({ listening: true }) }), at), null);
    assert.equal(claudeAlert(snap({ claude: status({ standalone: true }) }), at), null);
    assert.equal(claudeAlert(snap({ claude: null }), at), null);
    assert.equal(claudeAlert(snap({ conn: "connecting", downSince: at }), at + DOWN_AFTER_MS)!.kind, "down");
  });
});

/** A fake bridge on a real client: the test answers as Claude would. */
function bridgeWithClaude(script: (s: FakeSocket, request: Extract<PageMessage, { type: "request" }>) => void) {
  const { client, s } = connected();
  const send = s.send.bind(s);
  s.send = (data: string) => {
    send(data);
    const m = JSON.parse(data) as PageMessage;
    if (m.type === "request") queueMicrotask(() => script(s, m));
  };
  return { client, s };
}

describe("the AI adapter: Explain, Trace it, Tour and questions go to the user's Claude", () => {
  it("sends the request, shows Claude's narration while it works, and returns its answer", async () => {
    const { client } = bridgeWithClaude((s, m) => {
      s.server({ type: "queued", id: "r1", ref: m.ref, position: 1 });
      s.server({ type: "taken", id: "r1" });
      s.server({ type: "command", id: "c1", command: { name: "narrate", requestId: "r1", text: "Sign-in starts at the button." } });
      s.server({ type: "command", id: "c2", command: { name: "narrate", requestId: "r1", text: "It posts to the login route." } });
      setTimeout(() => s.server({ type: "command", id: "c3", command: { name: "answer", requestId: "r1", markdown: "The button posts to `/api/login` (app/page.tsx:8-11).", citations: [{ path: "app/page.tsx", from: 8, to: 11 }] } }), 5);
    });
    const texts: string[] = [];
    const r = await askViaBridge({ bridge: client, request: { kind: "explain", payload: { nodeId: "route:x" } }, conversation: emptyConversation(), user: "Explain", mode: "ask", onText: (t) => texts.push(t) });
    assert.equal(r.text, "The button posts to `/api/login` (app/page.tsx:8-11).");
    assert.equal(r.tour, null);
    assert.equal(r.finish, "stop");
    assert.deepEqual(texts, ["Sign-in starts at the button.", "Sign-in starts at the button. It posts to the login route."]);
    assert.equal(r.conversation.history.length, 2);
  });

  it("goes through the guide's own ask() with the request the job carries", async () => {
    let seen: Extract<PageMessage, { type: "request" }> | null = null;
    const { client } = bridgeWithClaude((s, m) => {
      seen = m;
      s.server({ type: "queued", id: "r2", ref: m.ref, position: 1 });
      s.server({ type: "command", id: "c1", command: { name: "answer", requestId: "r2", markdown: "Traced.", citations: [] } });
    });
    const map = { nodes: [], edges: [], files: [] } as unknown as CodeMap;
    const r = await ask({ repo: { map, files: {} }, conversation: emptyConversation(), user: "Trace it", mode: "ask", request: { kind: "trace", payload: { from: "route:a" }, context: { view: "all" } }, bridge: client });
    assert.equal(r.text, "Traced.");
    assert.deepEqual(seen!.request, { kind: "trace", payload: { from: "route:a" }, context: { view: "all" } });
  });

  it("cancels the request when the user presses stop, and says why when Claude never got it", async () => {
    const { client, s } = bridgeWithClaude((s, m) => s.server({ type: "queued", id: "r3", ref: m.ref, position: 1 }));
    const ac = new AbortController();
    const p = askViaBridge({ bridge: client, conversation: emptyConversation(), user: "why?", mode: "ask", signal: ac.signal });
    await tick();
    await tick();
    ac.abort();
    await assert.rejects(p, (e: Error) => e.name === "AbortError");
    assert.deepEqual(s.sent.at(-1), { type: "cancel", id: "r3" });

    const dropped = bridgeWithClaude((s, m) => {
      s.server({ type: "queued", id: "r4", ref: m.ref, position: 1 });
      s.server({ type: "dropped", id: "r4", reason: "More than 50 requests were waiting." });
    });
    await assert.rejects(askViaBridge({ bridge: dropped.client, conversation: emptyConversation(), user: "q", mode: "ask" }), (e) => e instanceof AskError && /didn't get to this one/.test(e.info.title));
  });

  it("sends the user's words as a question, or a tour's topic, when a job carries no request", () => {
    assert.deepEqual(requestFor("  how does login work?  ", "ask"), { kind: "question", payload: { text: "how does login work?" } });
    assert.deepEqual(requestFor("the checkout flow", "tour"), { kind: "tour", payload: { topic: "the checkout flow" } });
    assert.equal((requestFor("x".repeat(30_000), "ask").payload as { text: string }).text.length, 20_000);
  });
});

describe("spoken and deep requests", () => {
  it("are requests the server takes, with their own instructions to Claude", () => {
    for (const kind of ["spoken", "deep"] as const) {
      const r = parsePageRequest({ kind, payload: { text: "What does the cart do?" }, context: { file: "lib/cart.ts", view: "all" } });
      assert.ok(r.ok);
      assert.equal(r.value.kind, kind);
    }
    const spoken = describeRequest({ id: "r1", at: "", kind: "spoken", payload: { text: "What does the cart do?" } });
    assert.match(spoken, /out loud and is listening: narrate first and often/);
    const deep = describeRequest({ id: "r2", at: "", kind: "deep", payload: { text: "Why is the cart split in two?" } });
    assert.match(deep, /under 120 words \(it is spoken back\)/);
  });

  it("a spoken question that carries on the unanswered one says so, and replaces it; nothing else carries the flag", () => {
    const r = parsePageRequest({ kind: "spoken", payload: { text: "think about sign-in", continues: true } });
    assert.ok(r.ok);
    assert.deepEqual(r.value.payload, { text: "think about sign-in", continues: true });
    const plain = parsePageRequest({ kind: "spoken", payload: { text: "hello", continues: "yes" } });
    assert.ok(plain.ok);
    assert.deepEqual(plain.value.payload, { text: "hello" }, "only a real true counts");
    const deep = parsePageRequest({ kind: "deep", payload: { text: "why", continues: true } });
    assert.ok(deep.ok);
    assert.deepEqual(deep.value.payload, { text: "why" });
    const told = describeRequest({ id: "r3", at: "", kind: "spoken", payload: { text: "think about sign-in", continues: true } });
    assert.match(told, /kept talking before you answered/);
    assert.match(told, /replaces the spoken request/);
    assert.doesNotMatch(describeRequest({ id: "r4", at: "", kind: "spoken", payload: { text: "hi" } }), /kept talking/);
  });

  it("a deep question's answer goes back to the voice agent, and its narration is not read by the page", async () => {
    const { client } = bridgeWithClaude((s, m) => {
      assert.equal(m.request.kind, "deep");
      s.server({ type: "queued", id: "r9", ref: m.ref, position: 1 });
      assert.equal(speaksFor(client.snapshot().pending, "r9"), false, "the agent speaks it");
      s.server({ type: "command", id: "c1", command: { name: "answer", requestId: "r9", markdown: "Because orders and payments scale apart (lib/cart.ts:3).", citations: [] } });
    });
    const r = await askViaBridge({ bridge: client, request: { kind: "deep", payload: { text: "Why is the cart split?" } }, conversation: emptyConversation(), user: "Why is the cart split?", mode: "ask" });
    assert.match(r.text, /^Because orders/);
    assert.equal(speaksFor([{ ref: "p", kind: "spoken", id: "r1", state: "taken", position: null, at: 0 }], "r1"), true);
    assert.equal(speaksFor([], undefined), true);
  });

  it("ending Talk keeps the page quiet for what was asked before it, not for what is asked after", () => {
    const asked = (id: string, at: number) => ({ ref: id, kind: "spoken" as const, id, state: "taken" as const, position: null, at });
    hush(1000);
    assert.equal(hushedFor([asked("r1", 900)], "r1"), true, "asked before End: not read aloud");
    assert.equal(hushedFor([asked("r2", 1100)], "r2"), false, "asked after: read as usual");
    assert.equal(hushedFor([], undefined), false, "Claude speaking unasked is not a question that was ended");
  });
});

describe("Claude's commands on the page", () => {
  let map: CodeMap;
  let files: Record<string, string>;
  before(async () => {
    map = (await buildFixture("monolith")).map;
    files = Object.fromEntries((await readFixture("monolith")).map((f) => [f.path, f.content]));
  });

  function room() {
    const calls: string[] = [];
    let tour: Tour | null = null;
    const ui: PageUi = {
      get map() {
        return map;
      },
      get files() {
        return files;
      },
      jumpTo: (id) => calls.push(`jump ${id}`),
      openAt: (p, a, b) => calls.push(`open ${p}${a ? `:${a}-${b}` : ""}`),
      setLit: (l) => calls.push(`lit ${l ? [...l.nodes].length : 0}`),
      setTour: (t) => {
        tour = t;
        calls.push(`tour ${t ? t.steps.length : "off"}`);
      },
      setStep: (i) => calls.push(`step ${i}`),
      tour: () => tour,
      changeView: (v) => calls.push(`view ${v.kind}`),
      reveal: (p, why) => calls.push(`reveal ${p}${why ? ` (${why})` : ""}`),
      working: () => ["r5"],
    };
    return { ui, calls };
  }

  it("focuses a card, opens files and lights lines, and refuses what is not on the page", () => {
    const { ui, calls } = room();
    const card = map.nodes.find((n) => n.file)!;
    assert.match(applyCommand(ui, { name: "focus_node", nodeId: card.id }), /^Showing /);
    assert.ok(calls.includes(`jump ${card.id}`));
    const path = card.file!;
    assert.match(applyCommand(ui, { name: "open_file", path, line: 2 }), /^Opened /);
    assert.ok(calls.includes(`open ${path}:2-2`));
    assert.match(applyCommand(ui, { name: "highlight_lines", path, from: 1, to: 3 }), /^Lit /);
    assert.throws(() => applyCommand(ui, { name: "focus_node", nodeId: "route:nope" }), /No card/);
    assert.throws(() => applyCommand(ui, { name: "open_file", path: "nope.ts" }), /isn't in the workspace/);
  });

  it("lights a path, plays a tour from its first step by itself, steps it, and switches the view", () => {
    const { ui, calls } = room();
    const e = map.edges[0];
    assert.match(applyCommand(ui, { name: "trace_path", from: e.from, to: e.to, nodeIds: [e.from, e.to], edgeIds: [e.id] }), /Lit 2 cards and 1 arrow/);
    const card = map.nodes.find((n) => n.file)!;
    const start: Command = { name: "start_tour", title: "Sign-in", steps: [{ say: "Here the user signs in.", file: card.file!, from: 1, to: 2, nodeIds: [card.id] }, { say: "Then the route answers.", file: card.file!, from: 3, to: 4, nodeIds: [] }] };
    assert.match(applyCommand(ui, start), /Playing "Sign-in", 2 steps/);
    // Asked for as a tour, so the room leaves an open Settings in front (tourMayShowGuide).
    assert.equal(calls.at(-1), "reveal guide (tour)");
    const t = tourOf(start as Extract<Command, { name: "start_tour" }>, ["r5"]);
    assert.equal(t.autoplay, true);
    assert.deepEqual(t.requests, ["r5"]);
    assert.deepEqual(t.steps[0], { say: "Here the user signs in.", file: card.file!, start_line: 1, end_line: 2, node_ids: [card.id] });
    assert.match(applyCommand(ui, { name: "tour_step", n: 2 }), /step 2 of 2/);
    assert.ok(calls.includes("step 1"));
    assert.equal(calls.at(-1), "reveal guide (tour)");
    assert.throws(() => applyCommand(ui, { name: "tour_step", n: 3 }), /has 2 steps/);
    assert.match(applyCommand(ui, { name: "show_view", view: "all" }), /whole map/);
    assert.throws(() => applyCommand(ui, { name: "show_view", view: "service", service: "svc-nope" }), /No service/);
  });

  it("lights what an answer cites: the first citation opens, the cards that own them glow", () => {
    const { ui, calls } = room();
    const card = map.nodes.find((n) => n.file && n.line)!;
    const note = applyCommand(ui, { name: "answer", markdown: "…", citations: [{ path: card.file!, from: card.line!, to: card.line! }, { path: "gone.ts", from: 1, to: 2 }] });
    assert.match(note, /1 citation lit/);
    assert.ok(calls.some((c) => c.startsWith(`open ${card.file}`)));
    assert.ok(calls.some((c) => /^lit [1-9]/.test(c)));
    assert.ok(!calls.includes("tour off"), "no tour was on");
    assert.equal(litOf(map, ["route:nope"]).nodes.size, 0);
    // The answer to the request a tour belongs to leaves it playing; one to a newer question ends it, so it shows.
    applyCommand(ui, { name: "start_tour", title: "T", steps: [{ say: "One.", file: card.file!, from: 1, to: 1, nodeIds: [] }] });
    applyCommand(ui, { name: "answer", requestId: "r5", markdown: "Here is the tour.", citations: [] });
    assert.ok(!calls.includes("tour off"));
    applyCommand(ui, { name: "answer", requestId: "r6", markdown: "…", citations: [] });
    assert.equal(calls.at(-2), "tour off");
  });
});

describe("the page's workspace lives on the server", () => {
  it("builds the page's workspace from what the server says, and sends an answer only when the answers changed", async () => {
    const map = { nodes: [], edges: [], files: [], unresolvedBases: [], publicHosts: [] } as unknown as CodeMap;
    const w = workspaceOf({ id: "app-1234567890", name: "app", repos: ["app"], files: 2, mappedAt: "2026-10-01T00:00:00Z" }, map, { "a.ts": "", "b.ts": "" });
    assert.equal(w.id, "app-1234567890");
    assert.deepEqual(w.repos, [{ label: "app", kind: "local", fileCount: 2, addedAt: "2026-10-01T00:00:00Z" }]);
    const posts: unknown[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      posts.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const answered = { ...w, assertions: [{ setting: "API_URL", service: "svc-api", answeredAt: "2026-10-01T00:00:00Z" }] };
    assert.equal(await saveServerAnswers(answered, fetchImpl), true);
    assert.equal(await saveServerAnswers({ ...answered }, fetchImpl), false, "nothing changed");
    assert.deepEqual(posts, [{ workspace: "app-1234567890", answers: answered.assertions }]);
  });
});

describe("voice on the page", () => {
  it("reads Claude's narration in order, fetches the next chunk while one plays, and stops for a new question", async () => {
    const log: string[] = [];
    let release: (() => void) | null = null;
    const narrator: QueueNarrator = {
      speak: (t) =>
        new Promise((done) => {
          log.push(`say ${t}`);
          release = () => done("ended");
        }),
      prefetch: async (t) => void log.push(`fetch ${t}`),
      stop: () => {
        log.push("stop");
        release?.();
      },
    };
    const q = new NarrationQueue(async () => narrator);
    assert.equal(q.push("One."), 0);
    await tick();
    assert.equal(q.push("Two."), 1);
    assert.equal(q.push("Three."), 2);
    release!();
    await tick();
    await tick();
    release!();
    await tick();
    await tick();
    // Each chunk is fetched ahead once, while the one before it plays.
    assert.deepEqual(log, ["say One.", "fetch Two.", "fetch Three.", "say Two.", "say Three."]);
    q.push("Four.");
    q.push("Five.");
    await tick();
    q.clear();
    await tick();
    await tick();
    assert.equal(q.length, 0);
    assert.ok(!log.includes("say Five."));
  });

  it("answers a spoken question at once: a short line, and the cards its words name", async () => {
    const { map } = await buildFixture("monolith");
    assert.deepEqual(keywords("How does the login route work?"), ["login", "route"]);
    assert.deepEqual(keywords("Where are the users stored?"), ["users", "user", "stored", "stor"]);
    const named = cardsNamed(map, "how does login work?");
    assert.ok(named.length > 0, "a card about login is found");
    assert.ok(named.some((n) => /login/i.test(n.name) || /login/i.test(n.file ?? "")));
    assert.match(ackLine(named.map((n) => n.name), 0), /^Let me look at /);
    assert.equal(ackLine([], 0), "Let me look.");
    assert.deepEqual(cardsNamed(map, "um, so, what is it?"), []);
  });

  it("reads with the saved narrator, except in Free voice, where the browser reads everything", () => {
    const view: VoiceView = { narrator: "elevenlabs", voiceId: null, speed: 1, lecturer: "elevenagents", lecturerModel: "haiku", input: "hands-free", headphones: false, stt: "browser", keys: { ELEVENLABS_API_KEY: { has_key: true, source: "settings" } }, readiness: { narrator: null, lecturer: null } };
    assert.equal(narratorInForce(view).narrator, "elevenlabs");
    setBrowserOnly(true);
    try {
      assert.equal(narratorInForce(view).narrator, "browser");
    } finally {
      setBrowserOnly(false);
    }
    assert.equal(narratorInForce(view).narrator, "elevenlabs");
  });

  it("hears with the browser where it can, else with a key, else asks for typing", () => {
    const keys = (deepgram: boolean, elevenlabs: boolean) => ({ deepgram, elevenlabs });
    assert.equal(pickListener({ mode: "claude", browser: true, keys: keys(true, true) }), "browser");
    assert.equal(pickListener({ mode: "claude", browser: false, keys: keys(true, true) }), "deepgram");
    assert.equal(pickListener({ mode: "claude", browser: false, keys: keys(false, true) }), "elevenlabs");
    assert.equal(pickListener({ mode: "claude", browser: false, keys: keys(false, false) }), "typing");
    // Free voice never sends audio to a provider.
    assert.equal(pickListener({ mode: "free", browser: false, keys: keys(true, true) }), "typing");
    assert.equal(pickListener({ mode: "free", browser: true, keys: keys(false, false) }), "browser");
  });

  it("hears with the chosen transcriber when its key is set, else falls back (browser, then Groq, Deepgram, ElevenLabs)", () => {
    const all = { deepgram: true, elevenlabs: true, groq: true };
    const none = { deepgram: false, elevenlabs: false, groq: false };
    // Chosen and keyed: used even where the browser could hear.
    assert.equal(pickListener({ mode: "claude", browser: true, stt: "groq-turbo", keys: all }), "groq-turbo");
    assert.equal(pickListener({ mode: "claude", browser: true, stt: "groq-large", keys: all }), "groq-large");
    assert.equal(pickListener({ mode: "claude", browser: true, stt: "elevenlabs", keys: all }), "elevenlabs");
    // Chosen without its key: the browser, else the first key set.
    assert.equal(pickListener({ mode: "claude", browser: true, stt: "groq-large", keys: { ...all, groq: false } }), "browser");
    assert.equal(pickListener({ mode: "claude", browser: false, stt: "groq-large", keys: { ...all, groq: false } }), "deepgram");
    // The browser chosen but absent: Groq first.
    assert.equal(pickListener({ mode: "claude", browser: false, stt: "browser", keys: all }), "groq-turbo");
    assert.equal(pickListener({ mode: "claude", browser: false, stt: "browser", keys: none }), "typing");
    // Free voice: the browser alone, whatever is chosen.
    assert.equal(pickListener({ mode: "free", browser: true, stt: "groq-turbo", keys: all }), "browser");
    assert.equal(pickListener({ mode: "free", browser: false, stt: "groq-turbo", keys: all }), "typing");
  });

  it("turns the browser's recognition results into the words heard", async () => {
    let rec: { onresult: ((e: unknown) => void) | null; onend: (() => void) | null; stop(): void } | null = null;
    class FakeRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      onresult: ((e: unknown) => void) | null = null;
      onerror = null;
      onend: (() => void) | null = null;
      constructor() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        rec = this;
      }
      start() {}
      stop() {
        setTimeout(() => this.onend?.(), 1);
      }
      abort() {}
    }
    const words: string[] = [];
    const h = hearWithBrowser((w) => words.push(w), FakeRecognition as never);
    const result = (t: string, isFinal: boolean) => Object.assign([{ transcript: t }], { isFinal });
    rec!.onresult!({ resultIndex: 0, results: [result("how does", false)] });
    rec!.onresult!({ resultIndex: 0, results: [result("how does login work", true)] });
    assert.equal(await h.stop(), "how does login work");
    assert.deepEqual(words, ["how does", "how does login work"]);
  });
});
