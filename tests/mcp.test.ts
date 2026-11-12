// WalkMyCode for Claude end to end (docs/MCP.md §3, §8 A): a real MCP client on the
// SDK's in-memory transport calls the tools, and a fake page on a real WebSocket
// sends requests and acknowledges commands. Maps go to a temporary WALKMYCODE_HOME.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { IDLE_MS, PAGE_GONE_MS } from "../mcp/src/tools";
import { FakePage, FIXTURES, startLantern, until, type Started } from "./mcp.helpers";

const MONOLITH = join(FIXTURES, "monolith");
const TOOLS = ["walkmycode_open", "next_request", "answer", "narrate", "focus_node", "open_file", "highlight_lines", "trace_path", "start_tour", "tour_step", "show_view", "query_map", "read_file", "search", "list_files", "walkmycode_new_project"];

let home: string;
const savedHome = process.env.WALKMYCODE_HOME;
before(() => {
  home = mkdtempSync(join(tmpdir(), "walkmycode-mcp-"));
  process.env.WALKMYCODE_HOME = home;
});
after(() => {
  if (savedHome === undefined) delete process.env.WALKMYCODE_HOME;
  else process.env.WALKMYCODE_HOME = savedHome;
  rmSync(home, { recursive: true, force: true });
});

/** The page URL in walkmycode_open's reply. */
const pageUrl = (text: string) => /Page: (http:\/\/127\.0\.0\.1:\d+\/\?t=\S+)/.exec(text)?.[1] ?? "";

describe("WalkMyCode for Claude over MCP", () => {
  let s: Started;
  let url = "";
  let page: FakePage;

  before(async () => {
    s = await startLantern();
  });
  after(async () => {
    await page?.close();
    await s.close();
  });

  it("offers every tool of MCP.md §3, and teaches the loop in its instructions", async () => {
    const { tools } = await s.client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOLS].sort());
    for (const t of tools) assert.ok((t.description ?? "").length < 2_048, `${t.name}'s description is too long for Claude Code`);
    const instructions = s.client.getInstructions() ?? "";
    assert.ok(instructions.length < 2_048);
    for (const word of ["walkmycode_open", "next_request", "narrate", "answer", "continue"]) assert.ok(instructions.includes(word), word);
    // Any MCP client runs it (Claude, Antigravity, Cursor…): nothing assumes Claude.
    assert.doesNotMatch(instructions, /claude/i);
    for (const t of tools) assert.doesNotMatch(t.description ?? "", /claude/i, t.name);
  });

  it("says to open WalkMyCode first when nothing is open yet", async () => {
    for (const [name, args] of [["next_request", {}], ["query_map", { query: "auth" }], ["narrate", { text: "Hi." }]] as const) {
      const r = await s.call(name, args);
      assert.equal(r.isError, true);
      assert.match(r.text, /call walkmycode_open/);
    }
  });

  it("walkmycode_open maps a fixture, opens the page, and saves the map and answers under ~/.walkmycode", async () => {
    const r = await s.call("walkmycode_open", { path: MONOLITH });
    assert.equal(r.isError, false, r.text);
    assert.match(r.text, /WalkMyCode is open on "monolith": 7 files, 6 in the map, 2 routes, 2 tables, 9 links/);
    assert.match(r.text, /# Repo: monolith/);
    assert.match(r.text, /next_request\(\)/);
    url = pageUrl(r.text);
    assert.ok(url, r.text);
    assert.deepEqual(s.opened, [url]);
    const saved = readdirSync(join(home, ".walkmycode", "workspaces"));
    assert.equal(saved.length, 1);
    assert.match(saved[0], /^monolith-[0-9a-f]{10}$/);
    for (const f of ["map.json", "answers.json", "workspace.json"]) assert.ok(existsSync(join(home, ".walkmycode", "workspaces", saved[0], f)), f);
    const meta = JSON.parse(readFileSync(join(home, ".walkmycode", "workspaces", saved[0], "workspace.json"), "utf8")) as { folders: string[] };
    assert.deepEqual(meta.folders, [MONOLITH]);
  });

  it("refuses a whole home folder, and a folder that isn't there", async () => {
    const r1 = await s.call("walkmycode_open", { path: homedir() });
    assert.equal(r1.isError, true);
    assert.match(r1.text, /whole home folder/);
    const r2 = await s.call("walkmycode_open", { path: join(FIXTURES, "no-such-folder") });
    assert.equal(r2.isError, true);
    assert.match(r2.text, /doesn't exist/);
    // The open workspace is still the monolith.
    assert.equal(s.lantern.session.workspace?.info.name, "monolith");
  });

  it("a page connects and is welcomed with the workspace", async () => {
    page = await FakePage.connect(url);
    const welcome = page.messages[0];
    assert.equal(welcome.type, "welcome");
    assert.equal(welcome.type === "welcome" && welcome.workspace?.name, "monolith");
    // The client said who it is in the MCP handshake: the page is told its name, to say it.
    assert.equal(welcome.type === "welcome" && welcome.claude.client, "Walkmycode Test");
  });

  it("hands Claude a request the page queued before it asked, with what was on screen", async () => {
    const queued = await page.request({ kind: "explain", payload: { path: "lib/auth.ts", from: 7, to: 9 }, context: { file: "lib/auth.ts", lines: { from: 7, to: 9 } } });
    const r = await s.call("next_request", { wait_s: 5 });
    assert.equal(r.isError, false);
    const first = JSON.parse(r.text.split("\n")[0]) as Record<string, unknown>;
    assert.deepEqual(first, { id: queued.id, kind: "explain", payload: { path: "lib/auth.ts", from: 7, to: 9 }, context: { file: "lib/auth.ts", lines: { from: 7, to: 9 } } });
    assert.match(r.text, new RegExp(`answer\\("${queued.id}"`));
    await page.next((m) => m.type === "taken" && m.id === queued.id);
  });

  it("wakes a waiting next_request as soon as the page sends a question", async () => {
    const waiting = s.call("next_request", { wait_s: 20 });
    await until(() => s.lantern.bridge.status().listening);
    const t0 = Date.now();
    await page.request({ kind: "question", payload: { text: "Where does sign-in happen?" } });
    const r = await waiting;
    assert.ok(Date.now() - t0 < 2_000);
    assert.match(r.text, /"kind":"question","payload":\{"text":"Where does sign-in happen\?"\}/);
  });

  it("returns none when nothing comes within wait_s", async () => {
    const t0 = Date.now();
    const r = await s.call("next_request", { wait_s: 1 });
    assert.ok(Date.now() - t0 >= 900);
    assert.equal(r.isError, false);
    assert.deepEqual(JSON.parse(r.text.split("\n")[0]), { kind: "none" });
    assert.match(r.text, /Call next_request\(\) again/);
  });

  it("stops waiting when the call is cancelled, and keeps the request that comes after", async () => {
    const ac = new AbortController();
    const waiting = s.call("next_request", { wait_s: 30 }, { signal: ac.signal });
    await until(() => s.lantern.bridge.status().listening);
    ac.abort();
    await assert.rejects(waiting);
    await until(() => !s.lantern.bridge.status().listening);
    const queued = await page.request({ kind: "spoken", payload: { text: "What does verify do?" } });
    assert.equal(s.lantern.bridge.status().queued, 1);
    const r = await s.call("next_request", { wait_s: 5 });
    assert.match(r.text, new RegExp(`"id":"${queued.id}","kind":"spoken"`));
    assert.match(r.text, /narrate first/);
  });

  it("answer, narrate, focus_node and highlight_lines reach the page and are acknowledged", async () => {
    const a = await s.call("answer", { id: "r3", markdown: "Sign-in starts at the **Sign in** button.", citations: ["app/page.tsx:8-11", "lib/auth.ts:7", "lib/nowhere.ts:1", "lib/auth.ts:400"] });
    assert.equal(a.isError, false, a.text);
    assert.match(a.text, /Shown on the page as the answer to r3, with app\/page\.tsx:8-11, lib\/auth\.ts:7 lit/);
    assert.match(a.text, /Not lit.*lib\/nowhere\.ts:1.*lib\/auth\.ts:400/);
    const answer = page.commands("answer").at(-1)!.command;
    assert.deepEqual(answer, { name: "answer", requestId: "r3", markdown: "Sign-in starts at the **Sign in** button.", citations: [{ path: "app/page.tsx", from: 8, to: 11 }, { path: "lib/auth.ts", from: 7, to: 7 }] });
    assert.ok(!s.lantern.bridge.isWorking("r3"));

    const n = await s.call("narrate", { text: "Let's look at the sign-in button.", id: "r4" });
    assert.equal(n.text, "Queued to be spoken.");
    assert.deepEqual(page.commands("narrate").at(-1)!.command, { name: "narrate", text: "Let's look at the sign-in button.", requestId: "r4" });

    const f = await s.call("focus_node", { path: "lib/auth.ts" });
    assert.match(f.text, /Showing auth \[file:lib\/auth\.ts\] on the map/);
    assert.deepEqual(page.commands("focus_node").at(-1)!.command, { name: "focus_node", nodeId: "file:lib/auth.ts", path: "lib/auth.ts" });

    const h = await s.call("highlight_lines", { path: "lib/auth.ts", from: 7, to: 9 });
    assert.equal(h.text, "Lit lib/auth.ts:7-9.");
    assert.deepEqual(page.commands("highlight_lines").at(-1)!.command, { name: "highlight_lines", path: "lib/auth.ts", from: 7, to: 9 });
  });

  it("checks what Claude names against the map before the page sees it", async () => {
    const before = page.commands().length;
    const bad = [
      await s.call("focus_node", { id: "file:lib/nope.ts" }),
      await s.call("open_file", { path: "lib/nope.ts" }),
      await s.call("highlight_lines", { path: "lib/auth.ts", from: 300, to: 310 }),
      await s.call("show_view", { view: "service", service: "billing" }),
      await s.call("tour_step", { n: 2 }),
    ];
    for (const r of bad) assert.equal(r.isError, true, r.text);
    assert.match(bad[0].text, /No card matches/);
    assert.match(bad[1].text, /No file lib\/nope\.ts/);
    assert.match(bad[2].text, /has 19 lines/);
    assert.match(bad[4].text, /start_tour first/);
    assert.equal(page.commands().length, before);
  });

  it("trace_path lights the chain from the button to the table, with each hop's evidence", async () => {
    const r = await s.call("trace_path", { from: "app/page.tsx", to: "table:user" });
    assert.equal(r.isError, false, r.text);
    assert.match(r.text, /3 hops/);
    assert.match(r.text, /1\. page sends a request to POST \/api\/login .*app\/page\.tsx:9/);
    assert.match(r.text, /3\. auth reads table user \[table:user\] — lib\/auth\.ts:9/);
    const cmd = page.commands("trace_path").at(-1)!.command;
    assert.deepEqual(cmd.name === "trace_path" && cmd.nodeIds, ["file:app/page.tsx", "route:app/api/login/route.ts#POST /api/login", "file:lib/auth.ts", "table:user"]);
  });

  it("start_tour sends checked steps, refuses bad ones, and tour_step follows it", async () => {
    const refused = await s.call("start_tour", { steps: [{ say: "Here.", file: "lib/missing.ts", lines: "1-3" }] });
    assert.equal(refused.isError, true);
    assert.match(refused.text, /step 1: No file lib\/missing\.ts/);
    const r = await s.call("start_tour", {
      title: "How sign-in works",
      steps: [
        { say: "You press Sign in.", file: "app/page.tsx", lines: "8-11", nodeIds: ["file:app/page.tsx", "card:made-up"] },
        { say: "The server checks the session.", file: "lib/auth.ts", lines: "6-11", nodeIds: ["file:lib/auth.ts"] },
      ],
    });
    assert.equal(r.isError, false, r.text);
    assert.match(r.text, /2 steps/);
    assert.match(r.text, /card:made-up/);
    const tour = page.commands("start_tour").at(-1)!.command;
    assert.deepEqual(tour, {
      name: "start_tour",
      title: "How sign-in works",
      steps: [
        { say: "You press Sign in.", file: "app/page.tsx", from: 8, to: 11, nodeIds: ["file:app/page.tsx"] },
        { say: "The server checks the session.", file: "lib/auth.ts", from: 6, to: 11, nodeIds: ["file:lib/auth.ts"] },
      ],
    });
    assert.match((await s.call("tour_step", { n: 2 })).text, /Showing step 2 of 2/);
    assert.equal((await s.call("tour_step", { n: 3 })).isError, true);
    assert.match((await s.call("show_view", { view: "all" })).text, /whole map/);
    assert.deepEqual(page.commands("show_view").at(-1)!.command, { name: "show_view", view: "all" });
  });

  it("the read tools return grounded text with file:line", async () => {
    const q = await s.call("query_map", { query: "lib/auth.ts" });
    assert.match(q.text, /## auth \[file:lib\/auth\.ts\] — module in the logic layer, lib\/auth\.ts:1/);
    assert.match(q.text, /reads table user \[table:user\] — lib\/auth\.ts:9/);
    const f = await s.call("read_file", { path: "lib/auth.ts", from: 7, to: 9 });
    assert.match(f.text, /^lib\/auth\.ts \(lines 7-9 of 19\)\n {3}7\| /);
    assert.match(f.text, /prisma\.session\.findFirst/);
    const found = await s.call("search", { text: "findUnique" });
    assert.match(found.text, /^lib\/auth\.ts:9: /m);
    const top = await s.call("list_files");
    assert.match(top.text, /app\/\nlib\/\nprisma\//);
    const ts = await s.call("list_files", { glob: "*.ts" });
    assert.match(ts.text, /^4 files match \*\.ts:/);
    assert.doesNotMatch(ts.text, /page\.tsx/);
    assert.match(ts.text, /app\/api\/login\/route\.ts/);
    const deep = await s.call("list_files", { glob: "app/**/route.ts" });
    assert.match(deep.text, /^2 files match/);
  });

  it("tells Claude a command went unconfirmed, or was refused, instead of waiting forever", async () => {
    page.ack = false;
    const t0 = Date.now();
    const r = await s.call("open_file", { path: "lib/auth.ts", line: 7 });
    assert.equal(r.isError, true);
    assert.match(r.text, /didn't confirm within 2 s/);
    assert.ok(Date.now() - t0 < 4_000);
    page.ack = "The code view is busy.";
    const refused = await s.call("open_file", { path: "lib/auth.ts", line: 7 });
    assert.match(refused.text, /The page couldn't do that: The code view is busy\./);
    page.ack = true;
  });

  it("with no page open, the page tools say how to open it", async () => {
    await page.close();
    await until(() => !s.lantern.bridge.hasPage());
    for (const [name, args] of [["narrate", { text: "Hello." }], ["focus_node", { id: "table:user" }], ["answer", { markdown: "Hi." }]] as const) {
      const r = await s.call(name, args);
      assert.equal(r.isError, true);
      assert.equal(r.text, `The WalkMyCode page isn't open: open ${url} (or ask the user to). Nothing was shown.`);
    }
    const none = await s.call("next_request", { wait_s: 1 });
    assert.match(none.text, /The page isn't connected: if the user hasn't opened it, give them http:\/\/127\.0\.0\.1:\d+\/\?t=/);
  });

  it("a second walkmycode_open re-maps, and an open page is told to load the new map", async () => {
    page = await FakePage.connect(url);
    const r = await s.call("walkmycode_open", { paths: [join(FIXTURES, "compose-shop", "web"), join(FIXTURES, "compose-shop", "services")], name: "shop" });
    assert.equal(r.isError, false, r.text);
    assert.match(r.text, /WalkMyCode is open on "shop" \(2 folders: web\/, services\/; every path starts with its folder's name\)/);
    assert.match(r.text, /The page that was already open now shows this map/);
    assert.equal(s.opened.length, 1);
    const cmd = page.commands("workspace").at(-1)!.command;
    assert.equal(cmd.name === "workspace" && cmd.workspace.name, "shop");
    assert.match((await s.call("read_file", { path: "web/app/page.tsx", from: 1, to: 2 })).text, /^web\/app\/page\.tsx \(lines 1-2/);
  });
});

describe("walkmycode_open with no folder", () => {
  it("opens the client's root folder (Claude Code's project)", async () => {
    const s = await startLantern({ roots: [MONOLITH] });
    try {
      const r = await s.call("walkmycode_open", {});
      assert.equal(r.isError, false, r.text);
      assert.match(r.text, /WalkMyCode is open on "monolith"/);
    } finally {
      await s.close();
    }
  });

  it("asks which folder when the client shares none", async () => {
    const s = await startLantern();
    try {
      const r = await s.call("walkmycode_open", {});
      assert.equal(r.isError, true);
      assert.match(r.text, /Which folder\?/);
    } finally {
      await s.close();
    }
  });
});

describe("when to stop listening", () => {
  it("tells Claude to stop once the page has been closed for a while, and to come back on 'continue'", async () => {
    let clock = Date.parse("2026-10-01T10:00:00Z");
    const s = await startLantern({ now: () => clock });
    try {
      const url = pageUrl((await s.call("walkmycode_open", { path: MONOLITH })).text);
      clock += PAGE_GONE_MS + 1_000;
      const stop = await s.call("next_request", { wait_s: 1 });
      assert.deepEqual(JSON.parse(stop.text.split("\n")[0]), { kind: "none", stop: true });
      assert.match(stop.text, /closed for over 5 minutes, so stop listening now/);
      // The user opens the page and says "continue": Claude listens again.
      const page = await FakePage.connect(url);
      const again = await s.call("next_request", { wait_s: 1 });
      assert.deepEqual(JSON.parse(again.text.split("\n")[0]), { kind: "none" });
      // Nobody uses the page for a long time: stop, to save the user's usage.
      clock += IDLE_MS + 1_000;
      assert.match((await s.call("next_request", { wait_s: 1 })).text, /Nobody has used the WalkMyCode page for 20 minutes/);
      // "continue": listening again, and a request still gets through.
      await page.request({ kind: "question", payload: { text: "Back again?" } });
      assert.match((await s.call("next_request", { wait_s: 1 })).text, /"kind":"question"/);
      await page.close();
    } finally {
      await s.close();
    }
  });
});
