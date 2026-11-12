// WalkMyCode Lite's adapter layer: which adapter each target and runtime gets, the
// links between rooms inside one page, and the guide's tool loop through a fake
// `sample` that keeps the artifact runtime's rules (sample.d.ts): turns start and
// end on a user turn, tools are page functions whose results go back to Claude,
// a thrown tool error is read as "Error: …", text streams as one growing string.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assetUrl, rebaseWorkerUrl, setAssetBase } from "../src/analyzer/assets";
import type { CodeMap } from "../src/analyzer/types";
import { askViaSample, fitToolResult, historyTurns, NEEDS_CLAUDE, PROMPT_BYTES, sampleError, sampleTools, sampleTurns, TOOL_RESULT_BYTES, type SampleTool, type SampleTurn, type ToolSample } from "../src/lib/adapters/ai";
import { parseRoomHref, roomSearch } from "../src/lib/adapters/rooms";
import { pickAi, pickSettings, pickSource, pickStorage, pickVoice } from "../src/lib/adapters/select";
import { downloadName } from "../src/lib/adapters/source";
import { ask, AskError, emptyConversation, type Conversation, type FetchLike } from "../src/lib/claude/client";
import { SYSTEM, TOUR_ADDENDUM } from "../src/lib/claude/prompts";
import type { RepoView } from "../src/lib/claude/tools";
import type { HistoryEntry } from "../src/lib/providers/wire";

const map = {
  version: 2,
  name: "demo",
  generatedAt: "2026-10-01",
  areas: ["app"],
  files: [{ path: "src/a.ts" }, { path: "src/b.ts" }],
  nodes: [],
  edges: [],
  warnings: [],
  stats: { files: 2, parsed: 2, routes: 0, tables: 0, edges: 0, likely: 0, ms: 1 },
} as unknown as CodeMap;
const repo: RepoView = { map, files: { "src/a.ts": "line one\nline two\nline three", "src/b.ts": "export const b = 1;" } };

type Call = { input: string | SampleTurn[]; options: Parameters<ToolSample>[1] };
type Script = (tools: Map<string, SampleTool>, emit: (s: string) => void, call: (name: string, input: Record<string, unknown>) => Promise<string>) => Promise<void>;

/** A fake `sample`: runs `script` with the page's tools the way the runtime does, and records every call. */
function fakeSample(script: Script, o: { limits?: ToolSample["limits"] | null; reject?: unknown[] } = {}) {
  const calls: Call[] = [];
  const results: string[] = [];
  const reject = [...(o.reject ?? [])];
  const sample = (async (input, options) => {
    calls.push({ input, options });
    if (Array.isArray(input)) {
      assert.equal(input[0].role, "user", "turns start on a user turn");
      assert.equal(input[input.length - 1].role, "user", "turns end on a user turn");
      for (const t of input) assert.ok(t.content.trim(), "no empty turn");
    }
    assert.ok(!(options?.tools && options.cache !== undefined), "cache is never passed with tools");
    const next = reject.shift();
    if (next) throw next;
    const tools = new Map((options?.tools ?? []).map((t) => [t.name, t]));
    let text = "";
    const emit = (s: string) => {
      const delta = (text ? "\n\n" : "") + s;
      text += delta;
      options?.onText?.({ text, delta });
    };
    const call = async (name: string, args: Record<string, unknown>) => {
      const t = tools.get(name);
      assert.ok(t, `tool ${name} offered`);
      let out: string;
      try {
        const r = await t.execute(args, { signal: options?.signal ?? new AbortController().signal });
        out = typeof r === "string" ? r : JSON.stringify(r);
      } catch (e) {
        out = `Error: ${(e as Error).message}`;
      }
      results.push(out);
      return out;
    };
    await script(tools, emit, call);
    return { text, truncated: false };
  }) as ToolSample;
  if (o.limits !== null) sample.limits = o.limits ?? (async () => ({ maxPromptBytes: 262144, tools: { maxCount: 16 } }));
  return { sample, calls, results };
}

const conv = (history: HistoryEntry[] = []): Conversation => ({ history, provider: null });

describe("adapter selection", () => {
  it("answers through the viewer's Claude whenever the page runs inside Claude, else the app's server, which Lite lacks", () => {
    assert.equal(pickAi({ target: "lite", sample: true }), "sample");
    assert.equal(pickAi({ target: "full", sample: true }), "sample");
    assert.equal(pickAi({ target: "full", sample: false }), "api");
    assert.equal(pickAi({ target: "lite", sample: false }), "none");
  });

  it("keeps a workspace in the viewer's private space only with both the database and an id", () => {
    assert.equal(pickStorage({ db: true, userId: "u1" }), "account");
    assert.equal(pickStorage({ db: true, userId: null }), "browser");
    assert.equal(pickStorage({ db: false, userId: "u1" }), "browser");
  });

  it("gives Lite a file input and drop, no indexed repos, and saves by offering the file", () => {
    assert.deepEqual(pickSource({ target: "lite", directoryPicker: true }), { picker: "input", drop: true, save: "offer", indexed: false });
    assert.deepEqual(pickSource({ target: "full", directoryPicker: true }), { picker: "directory", drop: true, save: "folder", indexed: true });
    assert.equal(pickSource({ target: "full", directoryPicker: false }).picker, "input");
  });

  it("offers a saved file under a name Claude's download prompt accepts: code goes as .txt", () => {
    assert.equal(downloadName("web/src/app/page.tsx"), "page.tsx.txt");
    assert.equal(downloadName("api/main.py"), "main.py.txt");
    assert.equal(downloadName("package.json"), "package.json");
    assert.equal(downloadName("docs/README.md"), "README.md");
  });

  it("hides the provider form and the cost meter in Lite, and never listens there", () => {
    assert.deepEqual(pickSettings("lite"), { providers: false, costMeter: false });
    assert.deepEqual(pickSettings("full"), { providers: true, costMeter: true });
    assert.deepEqual(pickVoice("lite"), { narration: "browser", microphone: false, talk: "none" });
    // The app reads with the narrator chosen in Settings and has the voice lecturer.
    assert.deepEqual(pickVoice("full"), { narration: "choice", microphone: true, talk: "lecturer" });
  });

  it("gives the MCP page the user's Claude over the bridge, the server's storage, server-read folders and no provider form", () => {
    for (const sample of [true, false]) assert.equal(pickAi({ target: "mcp", sample }), "bridge");
    assert.equal(pickStorage({ target: "mcp", db: true, userId: "u1" }), "server");
    assert.equal(pickStorage({ target: "full", db: false, userId: null }), "browser");
    assert.deepEqual(pickSource({ target: "mcp", directoryPicker: true }), { picker: "input", drop: false, save: "offer", indexed: false, server: true });
    assert.deepEqual(pickSettings("mcp"), { providers: false, costMeter: false });
    // Spoken questions go to the user's Claude; the narrator is the one chosen in Settings.
    assert.deepEqual(pickVoice("mcp"), { narration: "choice", microphone: true, talk: "claude" });
  });
});

describe("assets next to the page", () => {
  it("serves the grammars from the site root in the app, and from the base a worker is handed in Lite", () => {
    assert.equal(assetUrl("wasm/tree-sitter-dart.wasm"), "/wasm/tree-sitter-dart.wasm");
    setAssetBase("https://abc.claudeusercontent.com/artifact/v3/");
    assert.equal(assetUrl("/wasm/web-tree-sitter.wasm"), "https://abc.claudeusercontent.com/artifact/v3/wasm/web-tree-sitter.wasm");
    setAssetBase(undefined);
    assert.equal(assetUrl("wasm/x.wasm"), "/wasm/x.wasm");
  });

  it("re-bases the bundler's worker, and the chunks it hands that worker, on the page's folder", () => {
    const params = [["./app/static/chunks/a.js", "./app/static/chunks/b.js"], "", "./app/", "", ""];
    const built = `http://host/app/static/chunks/turbopack-worker-x.js#params=${encodeURIComponent(JSON.stringify(params))}`;
    const out = new URL(rebaseWorkerUrl(built, "http://host/a/lite/"));
    assert.equal(out.origin + out.pathname, "http://host/a/lite/app/static/chunks/turbopack-worker-x.js");
    const p = JSON.parse(decodeURIComponent(out.hash.slice("#params=".length)));
    assert.deepEqual(p[0], ["http://host/a/lite/app/static/chunks/a.js", "http://host/a/lite/app/static/chunks/b.js"]);
    assert.equal(p[2], "http://host/a/lite/app/");
    // At the site's root the worker is where it was; anything unexpected is left alone.
    assert.equal(new URL(rebaseWorkerUrl(built, "http://host/")).pathname, "/app/static/chunks/turbopack-worker-x.js");
    assert.equal(rebaseWorkerUrl("not a url", "http://host/"), "not a url");
  });
});

describe("rooms inside one page", () => {
  it("reads a room, its query and its hash from a link", () => {
    assert.deepEqual(parseRoomHref("/map?focus=src%2Fa.ts%3A3#b"), { room: "/map", search: "?focus=src%2Fa.ts%3A3", hash: "#b" });
    assert.deepEqual(parseRoomHref("/learn?teach=loops"), { room: "/learn", search: "?teach=loops", hash: "" });
    assert.deepEqual(parseRoomHref("/"), { room: "/", search: "", hash: "" });
    assert.deepEqual(parseRoomHref("/map/"), { room: "/map", search: "", hash: "" });
  });

  it("keeps the host's own query when a room opens, and replaces only the rooms' parameters", () => {
    assert.equal(roomSearch("?v=3&focus=a.ts", "?teach=loops&from=a.ts%3A2"), "?v=3&teach=loops&from=a.ts%3A2");
    assert.equal(roomSearch("?teach=x&snippet=y", ""), "");
    assert.equal(roomSearch("", "?focus=src%2Fa.ts%3A3"), "?focus=src%2Fa.ts%3A3");
  });

  it("leaves everything that is not a room alone", () => {
    for (const href of ["https://example.com/map", "//evil/map", "#x", "map", "/api/claude", "/mapping", "mailto:a@b.c"]) assert.equal(parseRoomHref(href), null, href);
  });
});

describe("the guide through sample", () => {
  it("offers WalkMyCode's tools as page functions that read the repo here, and streams one growing answer", async () => {
    const seenTools: [string, Record<string, unknown> | undefined][] = [];
    const shown: string[] = [];
    const fake = fakeSample(async (_tools, emit, call) => {
      emit("Let me read it.");
      const out = await call("read_file", { path: "src/a.ts", start_line: 2, end_line: 2 });
      assert.match(out, /^src\/a\.ts \(lines 2-2 of 3\)\n {3}2\| line two$/);
      emit("Line two says `src/a.ts:2`.");
    });
    const r = await askViaSample({ sample: fake.sample, repo, conversation: conv(), user: "what is on line two?", mode: "ask", onText: (t) => shown.push(t), onTool: (n, i) => seenTools.push([n, i]) });
    assert.deepEqual(fake.calls[0].options?.tools?.map((t) => t.name), ["read_file", "search", "query_map", "list_files", "fly_step"]);
    assert.deepEqual(seenTools, [["read_file", { path: "src/a.ts", start_line: 2, end_line: 2 }]]);
    assert.deepEqual(shown, ["Let me read it.", "Let me read it.\n\nLine two says `src/a.ts:2`."]);
    assert.equal(r.text, "Let me read it.\n\nLine two says `src/a.ts:2`.");
    assert.equal(r.finish, "stop");
    assert.equal(r.tour, null);
    assert.deepEqual(r.conversation, {
      history: [
        { role: "user", content: "what is on line two?" },
        { role: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Let me read it.\n\nLine two says `src/a.ts:2`." }] } },
      ],
      provider: null,
    });
  });

  it("sends the guide's rules and the map first, then the conversation as plain turns, tool rounds left out", async () => {
    const history: HistoryEntry[] = [
      { role: "user", content: "first?" },
      { role: "assistant", message: { role: "assistant", content: [{ type: "tool-call", toolCallId: "t1", toolName: "search", input: {} }] } },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "t1", toolName: "search", output: { type: "text", value: "hits" } }] },
      { role: "assistant", message: { role: "assistant", content: [{ type: "text", text: "First answer." }] } },
    ];
    const fake = fakeSample(async (_t, emit) => emit("Second answer."));
    await askViaSample({ sample: fake.sample, repo, conversation: conv(history), user: "second?", mode: "ask" });
    const turns = fake.calls[0].input as SampleTurn[];
    assert.equal(turns.length, 4);
    assert.ok(turns[0].content.startsWith(SYSTEM));
    assert.match(turns[0].content, /# The map \(built by WalkMyCode's parser, not by an AI\)\n# Repo: demo/);
    assert.ok(!turns[0].content.includes(TOUR_ADDENDUM));
    assert.deepEqual(turns.slice(1), [
      { role: "user", content: "first?" },
      { role: "assistant", content: "First answer." },
      { role: "user", content: "second?" },
    ]);
  });

  it("hands a tour in through finish_tour, and lets Claude correct an invalid one", async () => {
    const fake = fakeSample(async (tools, emit, call) => {
      assert.ok(tools.has("finish_tour"));
      const bad = await call("finish_tour", { title: "T", steps: [{ say: "no file" }] });
      assert.match(bad, /^Error: Invalid tour/);
      await call("finish_tour", { title: "Sign-in", steps: [{ say: "Here it starts.", file: "src/a.ts", start_line: 1, end_line: 2, node_ids: ["file:src/a.ts"] }] });
      emit("Press Play.");
    });
    const r = await askViaSample({ sample: fake.sample, repo, conversation: conv(), user: "tour sign-in", mode: "tour" });
    assert.ok((fake.calls[0].input as SampleTurn[])[0].content.includes(TOUR_ADDENDUM));
    assert.deepEqual(r.tour, { title: "Sign-in", steps: [{ say: "Here it starts.", file: "src/a.ts", start_line: 1, end_line: 2, node_ids: ["file:src/a.ts"] }] });
    assert.equal(fake.results[1], "Tour received. Reply with one sentence inviting the user to press Play.");
    assert.equal(r.text, "Press Play.");
  });

  it("reports a tool's failure to Claude rather than failing the answer", async () => {
    const fake = fakeSample(async (_t, emit, call) => {
      const out = await call("read_file", { path: "nope.ts" });
      assert.match(out, /^No such file: nope\.ts/);
      emit("I couldn't find it.");
    });
    const r = await askViaSample({ sample: fake.sample, repo, conversation: conv(), user: "q", mode: "ask" });
    assert.equal(r.text, "I couldn't find it.");
  });

  it("runs no tool after Stop", async () => {
    const ac = new AbortController();
    const fake = fakeSample(async (_t, emit, call) => {
      ac.abort();
      assert.equal(await call("read_file", { path: "src/a.ts" }), "Error: Stopped.");
      emit("x");
    });
    await askViaSample({ sample: fake.sample, repo, conversation: conv(), user: "q", mode: "ask", signal: ac.signal });
  });

  it("keeps every tool inside the runtime's limits", () => {
    const tools = sampleTools(repo, "tour", { onTour: () => {} });
    for (const t of tools) {
      assert.match(t.name, /^[A-Za-z0-9_-]{1,128}$/);
      assert.ok(new TextEncoder().encode(t.description).length <= 1024, `${t.name} description`);
      assert.ok(new TextEncoder().encode(JSON.stringify(t.inputSchema)).length <= 4096, `${t.name} schema`);
      assert.equal(t.inputSchema?.type, "object");
      assert.ok(!("strict" in t), "the API's strict flag stays behind");
    }
    const big = "x".repeat(50_000) + "é\"\\".repeat(5_000);
    const cut = fitToolResult(big);
    assert.ok(new TextEncoder().encode(JSON.stringify(cut)).length <= TOOL_RESULT_BYTES);
    assert.match(cut, /…\(cut to fit; ask for fewer lines or a narrower search\)$/);
    assert.equal(fitToolResult("short"), "short");
  });

  it("drops the oldest exchanges first when the conversation would not fit", () => {
    const long = "y".repeat(60_000);
    const history: HistoryEntry[] = [];
    for (let i = 0; i < 6; i++) history.push({ role: "user", content: `q${i} ${long}` }, { role: "assistant", message: { role: "assistant", content: `a${i}` } });
    const turns = sampleTurns({ repo, conversation: conv(history), user: "now?", mode: "ask", tools: true });
    const size = turns.reduce((n, t) => n + new TextEncoder().encode(t.content).length, 0);
    assert.ok(size <= PROMPT_BYTES, `${size} bytes`);
    assert.equal(turns[1].role, "user");
    assert.ok(turns[1].content.startsWith("q3 "), turns[1].content.slice(0, 5));
    assert.deepEqual(turns[turns.length - 1], { role: "user", content: "now?" });
    assert.deepEqual(historyTurns([{ role: "assistant", message: { role: "assistant", content: "" } }]), []);
  });

  it("asks without tools where this view cannot run them, and refuses a tour there", async () => {
    const fake = fakeSample(async (tools, emit) => {
      assert.equal(tools.size, 0);
      emit("From the map alone.");
    }, { limits: async () => ({ maxPromptBytes: 262144 }) });
    const r = await askViaSample({ sample: fake.sample, repo, conversation: conv(), user: "q", mode: "ask" });
    assert.equal(r.text, "From the map alone.");
    assert.equal(fake.calls[0].options?.cache, false);
    assert.match((fake.calls[0].input as SampleTurn[])[0].content, /cannot run the page's tools here/);
    await assert.rejects(askViaSample({ sample: fake.sample, repo, conversation: conv(), user: "q", mode: "tour" }), (e) => e instanceof AskError && e.info.title === "Tours need Claude's tools");
  });

  it("asks once more without tools when the runtime refuses them", async () => {
    const fake = fakeSample(async (_t, emit) => emit("Without tools."), { limits: null, reject: [{ code: "tools_unavailable", message: "no tools here" }] });
    const r = await askViaSample({ sample: fake.sample, repo, conversation: conv(), user: "q", mode: "ask" });
    assert.equal(fake.calls.length, 2);
    assert.ok(fake.calls[0].options?.tools?.length);
    assert.equal(fake.calls[1].options?.tools, undefined);
    assert.equal(r.text, "Without tools.");
  });

  it("turns each failure into the guide's own error, never a retry loop", async () => {
    for (const [code, want] of [
      ["rate_limited", "rate_limited"],
      ["not_granted", "forbidden"],
      ["session_expired", "forbidden"],
      ["upstream_error", "network"],
      ["something_new", "network"],
    ] as const) {
      const fake = fakeSample(async () => {}, { reject: [{ code, message: "m" }] });
      await assert.rejects(askViaSample({ sample: fake.sample, repo, conversation: conv(), user: "q", mode: "ask" }), (e) => e instanceof AskError && e.info.code === want, code);
      assert.equal(fake.calls.length, 1, code);
    }
    assert.equal(sampleError({ code: "invalid_request", message: "tools[0]: bad" }).detail, "tools[0]: bad");
  });

  it("says when the answer was cut short", async () => {
    const sample = (async () => ({ text: "Half an answer", truncated: true })) as ToolSample;
    const r = await askViaSample({ sample, repo, conversation: conv(), user: "q", mode: "ask" });
    assert.equal(r.finish, "length");
    assert.equal(r.text, "Half an answer\n\n(Cut short at the output limit.)");
  });

  it("tells the model when only the map is here, not the code", () => {
    const turns = sampleTurns({ repo: { map, files: {} }, conversation: emptyConversation(), user: "q", mode: "ask", tools: true });
    assert.match(turns[0].content, /The code itself is not loaded in this browser/);
  });
});

describe("ask() picks the route", () => {
  const noFetch: FetchLike = async () => assert.fail("the app's server is not asked inside Claude");

  it("goes to the viewer's Claude when there is one, without touching /api/claude", async () => {
    const fake = fakeSample(async (_t, emit) => emit("Hello from Claude."));
    const r = await ask({ repo, conversation: emptyConversation(), user: "hi", mode: "ask", fetch: noFetch, claude: fake.sample });
    assert.equal(r.text, "Hello from Claude.");
  });

  it("explains what needs Claude when Lite has none (the error the guide shows)", () => {
    assert.equal(NEEDS_CLAUDE.code, "forbidden");
    assert.match(NEEDS_CLAUDE.message, /inside Claude/);
    assert.match(NEEDS_CLAUDE.message, /map, the code and tracing work here without it/);
  });
});
