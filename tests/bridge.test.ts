// The bridge of WalkMyCode for Claude (docs/MCP.md §2): the page's requests wait in
// a queue for next_request, which long-polls and can be cancelled without losing
// anything; Claude's commands reach the one open page and are acknowledged. Also
// the protocol checks the server runs on everything a page sends.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Bridge, NoAckError, NoPageError, PageRefusedError, REPLACED_CODE, type PageLink } from "../mcp/src/bridge";
import { formatCitation, parseCitation, parsePageMessage, parsePageRequest, type ServerMessage } from "../src/lib/bridge/protocol";

class FakeLink implements PageLink {
  sent: ServerMessage[] = [];
  closed: { code?: number; reason?: string } | null = null;
  send(m: ServerMessage) {
    this.sent.push(m);
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason };
  }
  types() {
    return this.sent.map((m) => m.type);
  }
  commands() {
    return this.sent.filter((m): m is Extract<ServerMessage, { type: "command" }> => m.type === "command");
  }
}

const question = (text: string) => ({ type: "request", request: { kind: "question", payload: { text } } });

describe("protocol checks", () => {
  it("keeps the fields a request may carry and drops the rest", () => {
    const r = parsePageRequest({ kind: "explain", payload: { path: "lib/auth.ts", from: 7, to: 9, extra: "x" }, context: { file: "lib/auth.ts", lines: { from: 7, to: 9 }, junk: 1 } });
    assert.ok(r.ok);
    assert.deepEqual(r.value, { kind: "explain", payload: { path: "lib/auth.ts", from: 7, to: 9 }, context: { file: "lib/auth.ts", lines: { from: 7, to: 9 } } });
  });

  it("refuses unknown kinds, empty questions and malformed messages, saying why", () => {
    assert.match((parsePageRequest({ kind: "hack", payload: {} }) as { error: string }).error, /kind must be one of/);
    assert.match((parsePageRequest({ kind: "question", payload: { text: "  " } }) as { error: string }).error, /needs text/);
    assert.match((parsePageRequest({ kind: "trace", payload: {} }) as { error: string }).error, /needs from/);
    assert.equal(parsePageMessage("hello").ok, false);
    assert.equal(parsePageMessage({ type: "nope" }).ok, false);
    assert.equal(parsePageMessage({ type: "ack", id: "c1" }).ok, false);
  });

  it("reads citations the way Claude writes them", () => {
    assert.deepEqual(parseCitation("lib/auth.ts:7-9"), { path: "lib/auth.ts", from: 7, to: 9 });
    assert.deepEqual(parseCitation("`app/page.tsx:12`"), { path: "app/page.tsx", from: 12, to: 12 });
    assert.deepEqual(parseCitation("web/a.ts:30-12"), { path: "web/a.ts", from: 12, to: 30 });
    assert.equal(parseCitation("lib/auth.ts"), null);
    assert.equal(parseCitation("lib/auth.ts:0"), null);
    assert.equal(formatCitation({ path: "a.ts", from: 3, to: 3 }), "a.ts:3");
  });
});

describe("the request queue", () => {
  it("hands a request that was waiting to the next poll at once, and tells the page it was queued, then taken", async () => {
    const b = new Bridge();
    const page = new FakeLink();
    b.attach(page);
    b.receive(page, { ...question("where is login?"), ref: "q1" });
    const queued = page.sent.find((m) => m.type === "queued");
    assert.deepEqual(queued && { ...queued }, { type: "queued", id: "r1", ref: "q1", position: 1 });
    const r = await b.next(5_000);
    assert.equal(r?.id, "r1");
    assert.equal(r?.kind, "question");
    assert.deepEqual(r?.payload, { text: "where is login?" });
    assert.ok(page.types().indexOf("queued") < page.types().indexOf("taken"));
    assert.deepEqual(b.status().working, ["r1"]);
    assert.equal(b.markAnswered("r1"), true);
    assert.deepEqual(b.status().working, []);
  });

  it("wakes a waiting poll when the page sends a request", async () => {
    const b = new Bridge();
    const page = new FakeLink();
    b.attach(page);
    const waiting = b.next(5_000);
    assert.equal(b.status().listening, true);
    b.receive(page, question("and now?"));
    assert.deepEqual((await waiting)?.payload, { text: "and now?" });
    assert.equal(b.status().listening, false);
  });

  it("returns null when nothing comes in time", async () => {
    const b = new Bridge();
    const t0 = Date.now();
    assert.equal(await b.next(60), null);
    assert.ok(Date.now() - t0 >= 50);
    assert.equal(b.status().listening, false);
  });

  it("ends a cancelled poll with null and loses nothing: a later request waits for the next poll", async () => {
    const b = new Bridge();
    const page = new FakeLink();
    b.attach(page);
    const ac = new AbortController();
    const waiting = b.next(10_000, ac.signal);
    ac.abort();
    assert.equal(await waiting, null);
    assert.equal(b.status().listening, false);
    b.receive(page, question("still there?"));
    assert.equal(b.status().queued, 1);
    assert.equal((await b.next(1_000))?.id, "r1");
  });

  it("puts a request handed to a cancelled call back at the front", async () => {
    const b = new Bridge();
    const page = new FakeLink();
    b.attach(page);
    b.receive(page, question("first"));
    b.receive(page, question("second"));
    const r1 = (await b.next(1_000))!;
    b.requeue(r1);
    assert.equal(b.status().queued, 2);
    assert.equal((await b.next(1_000))?.id, "r1");
    // Once answered, a late requeue does nothing.
    b.markAnswered("r1");
    b.requeue(r1);
    assert.equal((await b.next(1_000))?.id, "r2");
  });

  it("keeps at most maxQueue requests, dropping the oldest and telling the page", () => {
    const b = new Bridge({ maxQueue: 2 });
    const page = new FakeLink();
    b.attach(page);
    for (const t of ["a", "b", "c"]) b.receive(page, question(t));
    assert.equal(b.status().queued, 2);
    assert.ok(page.sent.some((m) => m.type === "dropped" && m.id === "r1"));
  });

  it("lets the page take back a request Claude has not picked up", async () => {
    const b = new Bridge();
    const page = new FakeLink();
    b.attach(page);
    b.receive(page, question("never mind"));
    b.receive(page, { type: "cancel", id: "r1" });
    assert.equal(b.status().queued, 0);
    assert.equal(await b.next(20), null);
  });

  it("answers a malformed message with the reason", () => {
    const b = new Bridge();
    const page = new FakeLink();
    b.attach(page);
    b.receive(page, { type: "request", ref: "x", request: { kind: "question", payload: {} } });
    const last = page.sent.at(-1);
    assert.equal(last?.type, "rejected");
    assert.equal(last?.type === "rejected" && last.ref, "x");
  });
});

describe("commands to the page", () => {
  it("fails at once when no page is open", async () => {
    await assert.rejects(new Bridge().send({ name: "tour_step", n: 1 }), NoPageError);
  });

  it("resolves with the page's note when it acknowledges", async () => {
    const b = new Bridge();
    const page = new FakeLink();
    b.attach(page);
    const sent = b.send({ name: "open_file", path: "lib/auth.ts", line: 7 });
    const cmd = page.commands()[0];
    assert.deepEqual(cmd.command, { name: "open_file", path: "lib/auth.ts", line: 7 });
    b.receive(page, { type: "ack", id: cmd.id, ok: true, note: "opened" });
    assert.equal(await sent, "opened");
  });

  it("rejects with the page's reason when it refuses, and times out when it says nothing", async () => {
    const b = new Bridge({ ackTimeoutMs: 40 });
    const page = new FakeLink();
    b.attach(page);
    const refused = b.send({ name: "tour_step", n: 9 });
    b.receive(page, { type: "ack", id: page.commands()[0].id, ok: false, error: "There is no step 9." });
    await assert.rejects(refused, (e: Error) => e instanceof PageRefusedError && /no step 9/.test(e.message));
    await assert.rejects(b.send({ name: "tour_step", n: 1 }), NoAckError);
  });

  it("lets the newest tab win: the older one is told, closed, and no longer heard", async () => {
    const b = new Bridge({ ackTimeoutMs: 1_000 });
    const old = new FakeLink();
    const fresh = new FakeLink();
    b.attach(old);
    const pendingOnOld = b.send({ name: "narrate", text: "Hello." });
    b.attach(fresh);
    await assert.rejects(pendingOnOld, NoAckError);
    assert.ok(old.types().includes("replaced"));
    assert.equal(old.closed?.code, REPLACED_CODE);
    assert.equal(fresh.sent[0].type, "welcome");
    b.receive(old, question("from the old tab"));
    assert.equal(b.status().queued, 0);
  });

  it("fails a command whose page closes before confirming", async () => {
    const b = new Bridge({ ackTimeoutMs: 1_000 });
    const page = new FakeLink();
    b.attach(page);
    const sent = b.send({ name: "narrate", text: "Hello." });
    b.detach(page);
    await assert.rejects(sent, /closed before it confirmed/);
    assert.equal(b.hasPage(), false);
  });
});
