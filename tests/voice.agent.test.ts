// The voice lecturer without a key or a microphone: the Deepgram session's
// reducer (barge-in, push-to-talk, KeepAlive, idle close, function calls and
// their cancellation), the real Deepgram session against an in-process fake
// WebSocket server replaying tests/fixtures/voice/agent-script.json, the shared
// function dispatch, the lecturer's tools against a small map, the audio
// worklets' own source run in a VM, and the ElevenLabs session with a fake SDK.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";
import type { CodeMap } from "../src/analyzer/types";
import type { Lit } from "../src/components/mapHighlight";
import type { RepoView, Tour } from "../src/lib/claude/tools";
import { AGENT_URL, buildAgentSettings, PROMPT_LIMIT } from "../src/lib/voice/agentSettings";
import { VoiceError } from "../src/lib/voice/errors";
import type { AudioIO } from "../src/lib/voice/lecturer/audio";
import type { ServerMessage } from "../src/lib/voice/lecturer/deepgram/protocol";
import { initialState, KEEPALIVE_MS, micRoute, reduce, TAIL_MS, type Action, type AgentState, type Effect } from "../src/lib/voice/lecturer/deepgram/reducer";
import { DeepgramLecturer, type WebSocketLike } from "../src/lib/voice/lecturer/deepgram/session";
import { ElevenAgentsLecturer, type ElevenConversationLike } from "../src/lib/voice/lecturer/elevenagents";
import { FUNCTION_NAMES } from "../src/lib/voice/lecturer/functions";
import { Emitter, IDLE_CLOSE_MS, type LecturerEvent, type LecturerSession } from "../src/lib/voice/lecturer/session";
import { attachTools, citationFeed, findNode, pathBetween, runLecturerTool, WAIT_LINE, type LecturerUi } from "../src/lib/voice/lecturer/tools";
import { AGENT_RATE, MIC_FRAME, WORKLET_SOURCE } from "../src/lib/voice/lecturer/worklets";

const FIX = join(__dirname, "fixtures", "voice");
type Step = { send?: Record<string, unknown>; binary?: string; expect?: string; id?: string };
const SCRIPT = JSON.parse(readFileSync(join(FIX, "agent-script.json"), "utf8")) as Step[];
const GRANT = JSON.parse(readFileSync(join(FIX, "grant.json"), "utf8")) as { access_token: string };

// ── the reducer ──

/** Run actions from a fresh state; returns the state and every effect, in order. */
function drive(actions: Action[], from: AgentState = initialState(0)) {
  let s = from;
  const effects: Effect[] = [];
  for (const a of actions) {
    const r = reduce(s, a);
    s = r.state;
    effects.push(...r.effects);
  }
  return { s, effects };
}
const msg = (m: ServerMessage, at: number): Action => ({ type: "message", msg: m, at });
const sent = (fx: Effect[]) => fx.filter((e): e is Extract<Effect, { do: "send" }> => e.do === "send").map((e) => e.msg);
const events = (fx: Effect[]) => fx.filter((e): e is Extract<Effect, { do: "emit" }> => e.do === "emit").map((e) => e.event);
const LIVE: Action[] = [{ type: "connect", at: 0 }, { type: "socket-open", at: 10 }, msg({ type: "Welcome", request_id: "r1" }, 20), msg({ type: "SettingsApplied" }, 30)];

describe("Deepgram session reducer", () => {
  it("sends Settings when the socket opens, and only goes live (mic and all) after SettingsApplied", () => {
    let r = drive(LIVE.slice(0, 2));
    assert.deepEqual(r.effects.filter((e) => e.do !== "emit"), [{ do: "send-settings" }]);
    assert.equal(r.s.phase, "configuring");
    r = drive([{ type: "press", at: 15 }], r.s);
    assert.equal(r.s.mic, "live", "frames are kept while configuring, not sent");
    r = drive(LIVE.slice(2), r.s);
    assert.equal(r.s.phase, "live");
    assert.equal(r.s.requestId, "r1");
    assert.ok(r.effects.some((e) => e.do === "live"));
    assert.deepEqual(events(r.effects).map((e) => e.type), ["status"]);
  });

  it("push-to-talk: live while held, then a silent tail so the turn ends, then off", () => {
    let { s } = drive(LIVE);
    assert.equal(s.mic, "off");
    let r = drive([{ type: "press", at: 100 }], s);
    assert.equal(r.s.mic, "live");
    assert.deepEqual(events(r.effects), [{ type: "mic", open: true, mode: "push-to-talk" }]);
    r = drive([{ type: "release", at: 2000 }], r.s);
    assert.equal(r.s.mic, "silence");
    assert.deepEqual(events(r.effects), [{ type: "mic", open: false, mode: "push-to-talk" }]);
    s = drive([{ type: "tick", at: 2000 + TAIL_MS - 1 }], r.s).s;
    assert.equal(s.mic, "silence");
    s = drive([{ type: "tick", at: 2000 + TAIL_MS }], s).s;
    assert.equal(s.mic, "off");
    assert.equal(micRoute(s, 99999), "off");
  });

  it("hands-free: the microphone is open unless muted", () => {
    let { s } = drive([...LIVE, { type: "input", mode: "hands-free", at: 40 }]);
    assert.equal(s.mic, "live");
    s = drive([{ type: "mute", muted: true, at: 50 }], s).s;
    assert.equal(s.mic, "off");
    s = drive([{ type: "mute", muted: false, at: 60 }], s).s;
    assert.equal(s.mic, "live");
  });

  it("sends KeepAlive every 8 s while no audio flows, never while it does", () => {
    const { s } = drive(LIVE);
    let r = drive([{ type: "tick", at: 30 + KEEPALIVE_MS - 1 }], s);
    assert.deepEqual(sent(r.effects), []);
    r = drive([{ type: "tick", at: 30 + KEEPALIVE_MS }], r.s);
    assert.deepEqual(sent(r.effects), [{ type: "KeepAlive" }]);
    r = drive([{ type: "tick", at: 30 + 2 * KEEPALIVE_MS }], r.s);
    assert.deepEqual(sent(r.effects), [{ type: "KeepAlive" }]);
    // Held down: audio flows, no KeepAlive.
    r = drive([{ type: "press", at: 20000 }, { type: "tick", at: 40000 }], r.s);
    assert.deepEqual(sent(r.effects), []);
    // Let go: the count starts again when the audio stops (after the tail).
    r = drive([{ type: "release", at: 41000 }, { type: "tick", at: 41000 + TAIL_MS }, { type: "tick", at: 41000 + TAIL_MS + KEEPALIVE_MS - 1 }], r.s);
    assert.deepEqual(sent(r.effects), []);
    r = drive([{ type: "tick", at: 41000 + TAIL_MS + KEEPALIVE_MS }], r.s);
    assert.deepEqual(sent(r.effects), [{ type: "KeepAlive" }]);
  });

  it("closes after a minute with nobody speaking, counting the connected seconds, but not mid-call or while held", () => {
    let { s } = drive(LIVE);
    s = drive([msg({ type: "FunctionCallRequest", functions: [{ id: "f1", name: "search", arguments: "{}", client_side: true }] }, 100)], s).s;
    let r = drive([{ type: "tick", at: 100 + IDLE_CLOSE_MS + 5 }], s);
    assert.equal(r.s.phase, "live", "a call in flight keeps it open");
    r = drive([{ type: "result", id: "f1", name: "search", content: "x", at: 200 }, { type: "press", at: 300 }, { type: "tick", at: 300 + IDLE_CLOSE_MS + 5 }], r.s);
    assert.equal(r.s.phase, "live", "held down keeps it open");
    r = drive([{ type: "release", at: 400 }, { type: "tick", at: 400 + IDLE_CLOSE_MS }], r.s);
    assert.equal(r.s.phase, "closed");
    assert.ok(r.effects.some((e) => e.do === "close-socket" && e.code === 1000));
    const close = events(r.effects).find((e) => e.type === "close") as Extract<LecturerEvent, { type: "close" }>;
    assert.equal(close.reason, "idle");
    assert.equal(close.seconds, (400 + IDLE_CLOSE_MS - 10) / 1000, "billed from the socket opening");
  });

  it("barge-in: UserStartedSpeaking flushes the speaker and drops the rest of the interrupted reply until the next one", () => {
    let { s } = drive(LIVE);
    const frame = new ArrayBuffer(8);
    let r = drive([msg({ type: "AgentStartedSpeaking" }, 100), { type: "audio", frame, at: 110 }], s);
    assert.deepEqual(r.effects.filter((e) => e.do === "play").length, 1);
    assert.deepEqual(events(r.effects), [{ type: "speaking", on: true }]);
    r = drive([msg({ type: "UserStartedSpeaking" }, 120), { type: "audio", frame, at: 130 }], r.s);
    assert.ok(r.effects.some((e) => e.do === "flush"));
    assert.equal(r.effects.filter((e) => e.do === "play").length, 0, "stale audio is dropped");
    assert.deepEqual(events(r.effects), [{ type: "speaking", on: false }, { type: "listening", on: true }]);
    r = drive([msg({ type: "ConversationText", role: "user", content: "Wait, why?" }, 200), { type: "audio", frame, at: 210 }], r.s);
    assert.equal(r.effects.filter((e) => e.do === "play").length, 1, "the next reply plays");
    s = r.s;
    // Pressing Talk while it speaks does the same at once, without waiting for the server.
    r = drive([{ type: "press", at: 300 }, { type: "audio", frame, at: 310 }], s);
    assert.ok(r.effects.some((e) => e.do === "flush"));
    assert.equal(r.effects.filter((e) => e.do === "play").length, 0);
    r = drive([msg({ type: "AgentStartedSpeaking" }, 400), { type: "audio", frame, at: 410 }], r.s);
    assert.equal(r.effects.filter((e) => e.do === "play").length, 1);
  });

  it("speaking ends when the speaker drains after AgentAudioDone, not at a gap in the stream", () => {
    let { s } = drive([...LIVE, msg({ type: "AgentStartedSpeaking" }, 100), { type: "audio", frame: new ArrayBuffer(4), at: 110 }]);
    let r = drive([{ type: "drained", at: 120 }], s);
    assert.deepEqual(events(r.effects), [], "a gap mid-reply is not the end");
    r = drive([msg({ type: "AgentAudioDone" }, 130), { type: "drained", at: 140 }], r.s);
    assert.deepEqual(events(r.effects), [{ type: "speaking", on: false }]);
    s = r.s;
    assert.equal(s.agent, "idle");
  });

  it("answers function calls once, never a cancelled one, and ignores server-side and repeated ids", () => {
    let { s } = drive(LIVE);
    let r = drive(
      [
        msg(
          {
            type: "FunctionCallRequest",
            functions: [
              { id: "a", name: "highlight_lines", arguments: '{"path":"x.ts","from":1,"to":2}', client_side: true },
              { id: "b", name: "deep_answer", arguments: '{"question":"why?"}', client_side: true },
              { id: "s", name: "server_side", arguments: "{}", client_side: false },
            ],
          },
          100,
        ),
      ],
      s,
    );
    assert.deepEqual(
      events(r.effects).map((e) => (e.type === "functionCall" ? [e.id, e.name, e.args] : e.type)),
      [
        ["a", "highlight_lines", { path: "x.ts", from: 1, to: 2 }],
        ["b", "deep_answer", { question: "why?" }],
      ],
    );
    r = drive([msg({ type: "FunctionCallRequest", functions: [{ id: "a", name: "highlight_lines", arguments: "{}", client_side: true }] }, 110)], r.s);
    assert.deepEqual(events(r.effects), [], "a repeated id is not run twice");
    r = drive([{ type: "result", id: "a", name: "highlight_lines", content: '{"ok":true}', at: 120 }], r.s);
    assert.deepEqual(sent(r.effects), [{ type: "FunctionCallResponse", id: "a", name: "highlight_lines", content: '{"ok":true}' }]);
    r = drive([msg({ type: "FunctionCallCancelled", functions: [{ id: "b", name: "deep_answer" }] }, 130)], r.s);
    assert.deepEqual(events(r.effects), [{ type: "cancelled", ids: ["b"] }]);
    r = drive([{ type: "result", id: "b", name: "deep_answer", content: "late", at: 140 }, { type: "result", id: "a", name: "highlight_lines", content: "again", at: 150 }], r.s);
    assert.deepEqual(sent(r.effects), [], "late and repeated answers are dropped");
    r = drive([msg({ type: "FunctionCallRequest", functions: [{ id: "b", name: "deep_answer", arguments: "{}", client_side: true }] }, 160)], r.s);
    assert.deepEqual(events(r.effects), [], "a cancelled id is never run again");
    s = r.s;
    assert.deepEqual(s.calls, {});
  });

  it("adds tour notes with UpdatePrompt until the reserved room runs out, and covers a wait with InjectAgentMessage", () => {
    let { s } = drive(LIVE);
    let r = drive([{ type: "context", note: "Step 2 of 5 is on screen.", at: 100 }], s);
    const up = sent(r.effects)[0] as { type: string; prompt: string };
    assert.equal(up.type, "UpdatePrompt");
    assert.match(up.prompt, /Step 2 of 5/);
    let room = r.s.promptRoom;
    for (let i = 0; i < 10; i++) r = drive([{ type: "context", note: "x".repeat(1000), at: 200 + i }], r.s);
    assert.ok(r.s.promptRoom >= 0 && r.s.promptRoom < room);
    room = r.s.promptRoom;
    r = drive([{ type: "context", note: "x".repeat(1000), at: 300 }], r.s);
    assert.equal(r.s.promptRoom, room, "no more room: nothing sent");
    assert.deepEqual(sent(r.effects), []);
    r = drive([{ type: "inject", message: WAIT_LINE, at: 400 }], r.s);
    assert.deepEqual(sent(r.effects), [{ type: "InjectAgentMessage", message: WAIT_LINE, behavior: "queue" }]);
    s = drive([{ type: "inject", message: "x", at: 0 }], initialState(0)).s;
    assert.equal(s.phase, "idle");
  });

  it("fails connect() when the socket closes or Deepgram errs before SettingsApplied; after that an error is not fatal", () => {
    let r = drive([{ type: "connect", at: 0 }, { type: "socket-close", code: 1006, reason: "", at: 50 }]);
    const failed = r.effects.find((e) => e.do === "failed") as Extract<Effect, { do: "failed" }>;
    assert.equal(failed.error.code, "network");
    r = drive([{ type: "connect", at: 0 }, { type: "socket-open", at: 10 }, { type: "socket-close", code: 1008, reason: "invalid token", at: 50 }]);
    assert.equal((r.effects.find((e) => e.do === "failed") as Extract<Effect, { do: "failed" }>).error.code, "invalid_key");
    r = drive([...LIVE.slice(0, 2), msg({ type: "Error", code: "INVALID_SETTINGS", description: "bad think" }, 20)]);
    assert.ok(r.effects.some((e) => e.do === "failed"));
    assert.equal(r.s.phase, "closed");
    r = drive([...LIVE, msg({ type: "Error", code: "X", description: "hiccup" }, 40)]);
    assert.deepEqual(events(r.effects).find((e) => e.type === "error"), { type: "error", error: { code: "unknown", title: "The voice agent reported a problem", message: "hiccup", action: "retry", detail: "X" }, fatal: false });
    assert.equal(r.s.phase, "live");
    r = drive([...LIVE, { type: "socket-close", code: 1000, reason: "", at: 5000 }]);
    assert.equal((events(r.effects).find((e) => e.type === "close") as { reason: string }).reason, "server");
  });
});

// ── the real Deepgram session against an in-process fake server ──

/** A WebSocket and the fake agent behind it, replaying the script in order. */
class FakeAgentSocket implements WebSocketLike {
  readyState = 0;
  binaryType = "blob";
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  /** Everything the page sent, in order (text parsed, binary as byte counts). */
  received: (Record<string, unknown> | number)[] = [];
  closed: { code?: number; reason?: string } | null = null;
  private waiting: ((m: Record<string, unknown>) => boolean) | null = null;
  private wake: (() => void) | null = null;
  static last: FakeAgentSocket | null = null;

  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
  ) {
    FakeAgentSocket.last = this;
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.({});
    }, 1);
  }

  send(data: string | ArrayBuffer) {
    if (this.readyState !== 1) throw new Error("not open");
    if (typeof data === "string") {
      const m = JSON.parse(data) as Record<string, unknown>;
      this.received.push(m);
      if (this.waiting?.(m)) {
        this.waiting = null;
        this.wake?.();
      }
    } else this.received.push(data.byteLength);
  }

  close(code?: number, reason?: string) {
    this.closed = { code, reason };
    this.readyState = 3;
  }

  /** Play the script: send what the agent sends, wait where it expects something. */
  async play(script: Step[], hooks: { after?: (i: number) => Promise<void> | void } = {}) {
    for (const [i, step] of script.entries()) {
      if (step.expect) {
        const want = step.expect;
        const pred = (m: Record<string, unknown>) => m.type === want && (!step.id || m.id === step.id);
        if (!this.received.some((m) => typeof m === "object" && pred(m))) {
          await new Promise<void>((resolve, reject) => {
            this.waiting = pred;
            this.wake = resolve;
            setTimeout(() => reject(new Error(`timed out waiting for ${want}`)), 2000);
          });
        }
      } else if (step.send) this.onmessage?.({ data: JSON.stringify(step.send) });
      else if (step.binary) {
        const b = Buffer.from(step.binary, "base64");
        this.onmessage?.({ data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) });
      }
      await hooks.after?.(i);
      await new Promise((r) => setTimeout(r, 1));
    }
  }
}

/** Sound in and out, recorded; the test feeds microphone frames itself. */
function fakeAudio() {
  const io = {
    played: [] as number[],
    flushes: 0,
    closed: false,
    micStarted: false,
    onFrame: null as ((f: ArrayBuffer) => void) | null,
    drained: null as (() => void) | null,
  };
  const audio: AudioIO = {
    async startMic(onFrame) {
      io.micStarted = true;
      io.onFrame = onFrame;
    },
    play(pcm) {
      io.played.push(pcm.byteLength);
    },
    flush() {
      io.flushes++;
    },
    onDrained(cb) {
      io.drained = cb;
    },
    async close() {
      io.closed = true;
    },
  };
  return { io, audio };
}

/** The WalkMyCode server's two routes, as the session asks them. */
const lanternServer = (async (url: string) => {
  if (url === "/api/voice/token") return Response.json(GRANT);
  if (url === "/api/voice/settings") return Response.json(buildAgentSettings({ model: "fast" }));
  return new Response("not found", { status: 404 });
}) as unknown as typeof fetch;

const tiny = (): RepoView => ({
  map: {
    nodes: [
      { id: "file:src/cart.ts", name: "cart.ts", kind: "module", layer: "logic", file: "src/cart.ts", area: "src" },
      { id: "route:api/orders.py#POST /orders", name: "POST /orders", kind: "route", layer: "api", file: "api/orders.py", line: 3, endLine: 9, area: "api" },
      { id: "table:orders", name: "orders", kind: "table", layer: "data", area: "api" },
      { id: "file:src/page.tsx", name: "CheckoutPage", kind: "component", layer: "ui", file: "src/page.tsx", area: "src" },
    ],
    edges: [
      { id: "e1", from: "file:src/page.tsx", to: "file:src/cart.ts", kind: "imports", confidence: "certain", evidence: [{ file: "src/page.tsx", line: 1, text: "import { cart } from './cart'", role: "code" }] },
      { id: "e2", from: "file:src/cart.ts", to: "route:api/orders.py#POST /orders", kind: "calls-route", confidence: "certain", evidence: [{ file: "src/cart.ts", line: 4, text: "fetch('/orders', { method: 'POST' })", role: "code" }] },
      { id: "e3", from: "route:api/orders.py#POST /orders", to: "table:orders", kind: "writes", confidence: "certain", evidence: [{ file: "api/orders.py", line: 2, text: "db.orders.insert()", role: "code" }] },
    ],
    files: [],
    services: [],
    system: { kind: "monolith", links: [] },
    repos: [],
  } as unknown as CodeMap,
  files: { "src/cart.ts": "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8", "api/orders.py": "def create():\n  pass\n", "src/page.tsx": "export default function CheckoutPage() {}" },
});

describe("Deepgram lecturer against a fake agent", () => {
  it("replays a whole session: bearer subprotocol, Settings first, no mic before SettingsApplied, captions, audio, barge-in, calls and a cancel", async () => {
    const { io, audio } = fakeAudio();
    let clock = 1_000;
    const ticks: (() => void)[] = [];
    let closedSeconds = -1;
    const lec = new DeepgramLecturer({
      fetch: lanternServer,
      WebSocket: FakeAgentSocket,
      audio: async () => audio,
      context: () => ({ mapSummary: "# Repo: shop\nRoutes: POST /orders", keyterms: ["useCart", "checkout"] }),
      now: () => clock,
      setInterval: (f) => {
        ticks.push(f);
        return ticks.length;
      },
      clearInterval: () => {},
      onClosed: (s) => (closedSeconds = s),
    });
    const seen: LecturerEvent[] = [];
    lec.on((e) => seen.push(e));

    // The shared dispatcher, with a deep_answer that waits until it is cancelled.
    const opened: string[] = [];
    let deepSignal: AbortSignal | null = null;
    const ui: LecturerUi = {
      repo: tiny,
      openAt: (p, s, e) => opened.push(`${p}:${s}-${e}`),
      jumpTo: () => {},
      light: () => {},
      tour: () => null,
      setStep: () => {},
      carryOn: () => false,
      ask: (_q, o) => {
        deepSignal = o.signal;
        return new Promise<string>((resolve) => o.signal.addEventListener("abort", () => resolve("too late")));
      },
    };
    const detach = attachTools(lec, ui, { waitMs: 60_000 });

    const ready = lec.connect();
    // Pressed before the agent is ready: frames are kept, not sent.
    await new Promise((r) => setTimeout(r, 0));
    lec.press();
    while (!io.onFrame) await new Promise((r) => setTimeout(r, 1));
    io.onFrame(new ArrayBuffer(640));
    io.onFrame(new ArrayBuffer(640));
    while (!FakeAgentSocket.last || FakeAgentSocket.last.readyState !== 1) await new Promise((r) => setTimeout(r, 1));
    const ws = FakeAgentSocket.last;
    assert.equal(ws.url, AGENT_URL);
    assert.deepEqual(ws.protocols, ["bearer", GRANT.access_token]);
    assert.equal(ws.binaryType, "arraybuffer");

    await ws.play(SCRIPT, {
      after: (i) => {
        const step = SCRIPT[i];
        if (step.send?.type === "SettingsApplied") {
          // Settings went first, carrying the map; the held frames go only now.
          const first = ws.received[0] as Record<string, unknown>;
          assert.equal(first.type, "Settings");
          const json = JSON.stringify(first);
          assert.doesNotMatch(json, /"temperature"|"endpoint"/);
          assert.match(json, /# Repo: shop/);
          assert.match(json, /useCart/);
          const think = (first.agent as { think: { prompt: string }[] }).think;
          assert.ok(think[0].prompt.length <= PROMPT_LIMIT);
          assert.deepEqual(ws.received.slice(1), [640, 640], "the frames held back are sent after SettingsApplied, not before");
        }
      },
    });
    await ready;

    const captions = seen.filter((e) => e.type === "caption").map((e) => (e as { role: string; text: string }).role + ": " + (e as { text: string }).text);
    assert.deepEqual(captions, ["assistant: Hello! Which part of this code shall we walk through?", "user: Where does the cart check stock?"]);
    assert.equal(io.played.length, 2 + 1, "two frames of the greeting and one of the next reply; the one after the barge-in is dropped");
    assert.ok(io.flushes >= 2, "each UserStartedSpeaking flushed the speaker");
    assert.deepEqual(opened, ["src/cart.ts:3-7"], "highlight_lines drove the code panel");
    const responses = ws.received.filter((m) => typeof m === "object" && m.type === "FunctionCallResponse") as Record<string, unknown>[];
    assert.deepEqual(
      responses.map((m) => m.id),
      ["fc_fixture_1"],
      "the cancelled deep_answer is never answered",
    );
    assert.deepEqual(JSON.parse(responses[0].content as string), { ok: true, showing: "src/cart.ts:3-7" });
    assert.equal((deepSignal as AbortSignal | null)?.aborted, true, "the cancelled deep_answer's work was aborted");
    assert.ok(seen.some((e) => e.type === "error" && !e.fatal), "the script's last Error is reported, not fatal");

    // Quiet for 8 s with the button up: KeepAlive.
    lec.release();
    clock += TAIL_MS + 10;
    for (const t of ticks) t();
    clock += KEEPALIVE_MS;
    for (const t of ticks) t();
    assert.ok(ws.received.some((m) => typeof m === "object" && m.type === "KeepAlive"));

    lec.close("left");
    assert.deepEqual(ws.closed, { code: 1000, reason: "left" });
    assert.equal(io.closed, true, "the microphone and speaker are let go");
    assert.ok(closedSeconds > 0);
    assert.deepEqual(seen.at(-1), { type: "close", reason: "left", seconds: closedSeconds });
    detach();
  });

  it("rejects connect() with the server's FriendlyError when there is no Deepgram key, and frees the microphone", async () => {
    const { io, audio } = fakeAudio();
    const err = { code: "missing_key", title: "Deepgram API key missing", message: "Talk needs a Deepgram key", action: "settings" };
    const lec = new DeepgramLecturer({
      fetch: (async (url: string) => (url === "/api/voice/token" ? Response.json({ error: err }, { status: 400 }) : Response.json(buildAgentSettings({ model: "fast" })))) as unknown as typeof fetch,
      WebSocket: FakeAgentSocket,
      audio: async () => audio,
      context: () => ({ mapSummary: "", keyterms: [] }),
      setInterval: () => 0,
      clearInterval: () => {},
    });
    const seen: LecturerEvent[] = [];
    lec.on((e) => seen.push(e));
    await assert.rejects(lec.connect(), (e: unknown) => e instanceof VoiceError && e.info.code === "missing_key");
    assert.ok(seen.some((e) => e.type === "error" && e.fatal && e.error.code === "missing_key"));
    assert.equal(io.closed, true);
  });
});

// ── the shared dispatcher ──

/** A session that only carries events, for the dispatcher. */
function hubSession() {
  const hub = new Emitter();
  const responses: [string, string, string][] = [];
  const injected: string[] = [];
  const session: LecturerSession = {
    provider: "deepgram-agent",
    connect: async () => {},
    setInput: () => {},
    press: () => {},
    release: () => {},
    setMuted: () => {},
    respond: (id, name, content) => responses.push([id, name, content]),
    updateContext: () => true,
    inject: (m) => injected.push(m),
    on: (l) => hub.on(l),
    close: () => {},
  };
  return { hub, session, responses, injected };
}

describe("function dispatch", () => {
  it("answers each call, drops cancelled ones (aborting their work) and covers a slow deep_answer once", async () => {
    const { hub, session, responses, injected } = hubSession();
    let resolveDeep: ((s: string) => void) | null = null;
    let deepAborted = false;
    const ui: LecturerUi = {
      repo: tiny,
      openAt: () => {},
      jumpTo: () => {},
      light: () => {},
      tour: () => null,
      setStep: () => {},
      carryOn: () => false,
      ask: (_q, o) =>
        new Promise<string>((resolve) => {
          resolveDeep = resolve;
          o.signal.addEventListener("abort", () => (deepAborted = true));
        }),
    };
    const calls: string[] = [];
    const detach = attachTools(session, ui, { waitMs: 5, onCall: (n) => calls.push(n) });
    hub.emit({ type: "functionCall", id: "1", name: "query_map", args: { query: "orders" } });
    hub.emit({ type: "functionCall", id: "2", name: "deep_answer", args: { question: "How does checkout work?" } });
    hub.emit({ type: "functionCall", id: "3", name: "deep_answer", args: { question: "And payment?" } });
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(calls, ["query_map", "deep_answer", "deep_answer"]);
    assert.deepEqual(injected, [WAIT_LINE, WAIT_LINE], "one line for each slow deep_answer");
    hub.emit({ type: "cancelled", ids: ["2"] });
    assert.equal(deepAborted, true);
    (resolveDeep as unknown as (s: string) => void)("Checkout posts the cart to `api/orders.py:3`.");
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(
      responses.map(([id]) => id),
      ["1", "3"],
    );
    assert.match(responses[0][2], /orders/);
    assert.deepEqual(JSON.parse(responses[1][2]), { ok: true, answer: "Checkout posts the cart to `api/orders.py:3`." });
    detach();
  });
});

// ── the lecturer's tools ──

function uiFor(repo = tiny(), t: { tour: Tour; step: number } | null = null) {
  const did: string[] = [];
  let lit: Lit | null = null;
  let step = t?.step ?? 0;
  const ui: LecturerUi = {
    repo: () => repo,
    openAt: (p, s, e) => did.push(`open ${p}${s ? `:${s}-${e}` : ""}`),
    jumpTo: (id) => did.push(`jump ${id}`),
    light: (l) => (lit = l),
    tour: () => (t ? { tour: t.tour, step } : null),
    setStep: (i) => {
      step = i;
      did.push(`step ${i}`);
    },
    carryOn: () => {
      did.push("carry on");
      return true;
    },
    ask: async (q, o) => {
      o.onCite("src/cart.ts", 2, 4);
      return `Answer to ${q}`;
    },
  };
  return { ui, did, lit: () => lit, step: () => step };
}

const run = (ui: LecturerUi, name: string, args: Record<string, unknown> = {}) => runLecturerTool(ui, name, args, new AbortController().signal).then((s) => (s.startsWith("{") ? (JSON.parse(s) as Record<string, unknown>) : s));

describe("lecturer tools", () => {
  it("highlight_lines and open_file find the file, clamp the lines and drive the code panel", async () => {
    const { ui, did } = uiFor();
    assert.deepEqual(await run(ui, "highlight_lines", { path: "cart.ts", from: 3, to: 99 }), { ok: true, showing: "src/cart.ts:3-8" });
    assert.deepEqual(await run(ui, "open_file", { path: "./src/page.tsx", line: 1 }), { ok: true, open: "src/page.tsx:1" });
    assert.deepEqual(await run(ui, "open_file", { path: "api/orders.py" }), { ok: true, open: "api/orders.py" });
    assert.deepEqual(did, ["open src/cart.ts:3-8", "open src/page.tsx:1-1", "open api/orders.py"]);
    const miss = (await run(ui, "highlight_lines", { path: "nope.ts", from: 1, to: 2 })) as { ok: boolean; error: string };
    assert.equal(miss.ok, false);
    assert.match(miss.error, /No such file: nope.ts/);
  });

  it("focus_map_node takes an id, a file path or a name", async () => {
    const { ui, did } = uiFor();
    await run(ui, "focus_map_node", { id: "table:orders" });
    await run(ui, "focus_map_node", { id: "src/cart.ts" });
    await run(ui, "focus_map_node", { id: "checkoutpage" });
    assert.deepEqual(did, ["jump table:orders", "jump file:src/cart.ts", "jump file:src/page.tsx"]);
    assert.equal(((await run(ui, "focus_map_node", { id: "ghost" })) as { ok: boolean }).ok, false);
    assert.equal(findNode(tiny().map, "")?.id, undefined);
  });

  it("trace_path lights the shortest way from one card to another, along the arrows first", async () => {
    const m = tiny().map;
    assert.deepEqual(pathBetween(m, "file:src/page.tsx", "table:orders"), { nodes: ["file:src/page.tsx", "file:src/cart.ts", "route:api/orders.py#POST /orders", "table:orders"], edges: ["e1", "e2", "e3"] });
    assert.deepEqual(pathBetween(m, "table:orders", "file:src/cart.ts")?.edges, ["e3", "e2"], "against the arrows when there is no way along them");
    const { ui, lit } = uiFor();
    const r = (await run(ui, "trace_path", { from: "CheckoutPage", to: "orders" })) as { ok: boolean; path: string[]; steps: number };
    assert.deepEqual(r, { ok: true, path: ["CheckoutPage", "cart.ts", "POST /orders", "orders"], steps: 3 });
    assert.deepEqual([...lit()!.edges], ["e1", "e2", "e3"]);
    assert.equal(lit()!.origin, "file:src/page.tsx");
  });

  it("next_step and continue_tour step the tour and carry it on; run_code is not available yet", async () => {
    const tour: Tour = { title: "Checkout", steps: [1, 2, 3].map((n) => ({ say: `Step ${n} says this.`, file: "src/cart.ts", start_line: n, end_line: n + 1, node_ids: [] })) };
    const { ui, did, step } = uiFor(tiny(), { tour, step: 0 });
    assert.deepEqual(await run(ui, "next_step"), { ok: true, step: 2, of: 3, says: "Step 2 says this.", file: "src/cart.ts:2-3" });
    assert.equal(step(), 1);
    await run(ui, "next_step");
    assert.match(((await run(ui, "next_step")) as { error: string }).error, /last step/);
    assert.deepEqual(await run(ui, "continue_tour"), { ok: true, carrying_on: true });
    assert.ok(did.includes("carry on"));
    const noTour = uiFor();
    assert.match(((await run(noTour.ui, "next_step")) as { error: string }).error, /No tour is open/);
    assert.match(((await run(ui, "run_code")) as { error: string }).error, /not available yet/);
  });

  it("deep_answer asks the typed guide and lights what it cites; the read tools are the guide's own", async () => {
    const { ui, did } = uiFor();
    assert.deepEqual(await run(ui, "deep_answer", { question: "How does checkout work?" }), { ok: true, answer: "Answer to How does checkout work?" });
    assert.deepEqual(did, ["open src/cart.ts:2-4"]);
    assert.match(String(await run(ui, "read_file", { path: "src/cart.ts", start_line: 2, end_line: 3 })), /2\| line2/);
    assert.match(String(await run(ui, "search", { query: "create" })), /api\/orders.py:1/);
    assert.match(String(await run(ui, "query_map", { query: "orders" })), /orders/);
    assert.equal(((await run(ui, "nope")) as { ok: boolean }).ok, false);
  });

  it("lights each citation once as the answer streams in, waiting out one still being written", () => {
    const lit: string[] = [];
    const feed = citationFeed(tiny, (p, s, e) => lit.push(`${p}:${s}${e ? `-${e}` : ""}`));
    feed("Look at `src/cart.ts:1");
    assert.deepEqual(lit, [], "cart.ts:1 may still become cart.ts:12");
    feed("Look at `src/cart.ts:12` and");
    feed("Look at `src/cart.ts:12` and then `api/orders.py:3-9` too, and `ghost.ts:4` ");
    assert.deepEqual(lit, ["src/cart.ts:12", "api/orders.py:3-9"]);
  });
});

// ── the worklets, run as the browser would ──

function loadWorklets(sampleRate: number) {
  const registered = new Map<string, new () => { port: { postMessage: (m: unknown, t?: unknown) => void; onmessage: ((e: { data: unknown }) => void) | null }; process: (i: Float32Array[][], o: Float32Array[][]) => boolean }>();
  const posted: unknown[] = [];
  class AudioWorkletProcessor {
    port = { postMessage: (m: unknown) => posted.push(m), onmessage: null as ((e: { data: unknown }) => void) | null };
  }
  vm.runInNewContext(WORKLET_SOURCE, { sampleRate, AudioWorkletProcessor, registerProcessor: (name: string, cls: never) => registered.set(name, cls), Int16Array, Math, Float32Array });
  return { registered, posted };
}

describe("audio worklets", () => {
  for (const rate of [48000, 44100]) {
    it(`lantern-mic turns ${rate} Hz audio into 20 ms frames of 16 kHz linear16`, () => {
      const { registered, posted } = loadWorklets(rate);
      const Mic = registered.get("lantern-mic")!;
      const mic = new Mic();
      const seconds = 0.1;
      // A few samples over, so float steps (44100 / 16000) cannot leave the last frame one short.
      const total = Math.round(rate * seconds) + 16;
      for (let at = 0; at < total; at += 128) {
        const block = new Float32Array(Math.min(128, total - at)).fill(0.5);
        assert.equal(mic.process([[block]], [[new Float32Array(128)]]), true);
      }
      const frames = posted as ArrayBuffer[];
      assert.equal(frames.length, Math.floor((16000 * seconds) / MIC_FRAME));
      for (const f of frames) {
        assert.equal(f.byteLength, MIC_FRAME * 2);
        const v = new Int16Array(f);
        assert.ok(v.every((x) => Math.abs(x - 16384) <= 1), "0.5 → about 16384");
      }
    });
  }

  it("lantern-player plays 24 kHz audio at the context's rate, says when it has drained, and flushes at once", () => {
    const { registered, posted } = loadWorklets(48000);
    const Player = registered.get("lantern-player")!;
    const p = new Player();
    const pcm = new Int16Array(AGENT_RATE / 100).fill(16384); // 10 ms
    p.port.onmessage!({ data: { type: "pcm", data: pcm.buffer.slice(0) } });
    const out: number[] = [];
    for (let i = 0; i < 10; i++) {
      const block = new Float32Array(128);
      p.process([], [[block]]);
      out.push(...block);
    }
    const heard = out.filter((x) => Math.abs(x - 0.5) < 0.01).length;
    assert.ok(heard >= 470 && heard <= 482, `10 ms at 48 kHz is 480 samples (got ${heard})`);
    // Objects made inside the VM have its own prototypes: compare their JSON.
    assert.equal(JSON.stringify(posted), JSON.stringify([{ type: "drained" }]));
    // Flush: queued audio is gone at once.
    p.port.onmessage!({ data: { type: "pcm", data: pcm.buffer.slice(0) } });
    const block = new Float32Array(128);
    p.process([], [[block]]);
    assert.ok(block.some((x) => x !== 0));
    p.port.onmessage!({ data: { type: "flush" } });
    const after = new Float32Array(128);
    p.process([], [[after]]);
    assert.ok(after.every((x) => x === 0));
  });
});

// ── ElevenLabs' lecturer with a fake SDK ──

describe("ElevenLabs lecturer", () => {
  function fakeSdk() {
    const calls: { muted: boolean[]; volume: number[]; context: string[]; ended: number } = { muted: [], volume: [], context: [], ended: 0 };
    let options: Record<string, unknown> = {};
    const conv: ElevenConversationLike = {
      endSession: async () => {
        calls.ended++;
      },
      setMicMuted: (m) => calls.muted.push(m),
      setVolume: ({ volume }) => calls.volume.push(volume),
      sendContextualUpdate: (t) => calls.context.push(t),
    };
    const start = async (o: Record<string, unknown>) => {
      options = o;
      (o.onConnect as (p: { conversationId: string }) => void)({ conversationId: "conv_1" });
      return conv;
    };
    return { start, calls, options: () => options };
  }

  const session = (o: Record<string, unknown> = {}) =>
    (async (url: string, init?: RequestInit) => {
      assert.equal(url, "/api/voice/elevenagents/session");
      assert.equal(init?.method, "POST");
      return Response.json({ signed_url: "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=a&conversation_signature=s", agent_id: "a", overrides: { prompt: "PROMPT", voice_id: "VOICE", keywords: true }, ...o });
    }) as unknown as typeof fetch;

  it("starts the SDK with the signed link, every client tool and the overrides the agent allows, push-to-talk shut", async () => {
    const sdk = fakeSdk();
    let posted: unknown = null;
    const lec = new ElevenAgentsLecturer({
      fetch: (async (url: string, init?: RequestInit) => {
        posted = JSON.parse(String(init?.body));
        return session()(url, init);
      }) as unknown as typeof fetch,
      start: sdk.start,
      context: () => ({ mapSummary: "# Repo: shop", keyterms: ["useCart"] }),
      setInterval: () => 0,
      clearInterval: () => {},
    });
    const seen: LecturerEvent[] = [];
    lec.on((e) => seen.push(e));
    await lec.connect();
    assert.deepEqual(posted, { map_summary: "# Repo: shop" });
    const o = sdk.options();
    assert.equal(o.signedUrl, "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=a&conversation_signature=s");
    assert.equal(o.connectionType, "websocket");
    assert.deepEqual(Object.keys(o.clientTools as object).sort(), [...FUNCTION_NAMES].sort());
    assert.deepEqual(o.overrides, { agent: { prompt: { prompt: "PROMPT" } }, tts: { voiceId: "VOICE" }, asr: { keywords: ["useCart"] } });
    assert.equal(sdk.calls.muted.at(-1), true, "push-to-talk starts with the microphone shut");
    assert.ok(seen.some((e) => e.type === "status" && e.status === "live"));

    lec.press();
    assert.equal(sdk.calls.muted.at(-1), false);
    assert.deepEqual(sdk.calls.volume, [0], "the lecturer is quieted at once");
    lec.release();
    assert.equal(sdk.calls.muted.at(-1), true);
    assert.deepEqual(sdk.calls.volume, [0, 1]);
    lec.setInput("hands-free");
    assert.equal(sdk.calls.muted.at(-1), false);
    lec.setMuted(true);
    assert.equal(sdk.calls.muted.at(-1), true);
    assert.equal(lec.updateContext("Step 2 is on screen."), true);
    assert.deepEqual(sdk.calls.context, ["Step 2 is on screen."]);
  });

  it("turns client tool calls into functionCall events and SDK callbacks into captions and speaking", async () => {
    const sdk = fakeSdk();
    const lec = new ElevenAgentsLecturer({ fetch: session(), start: sdk.start, context: () => ({ mapSummary: "", keyterms: [] }), setInterval: () => 0, clearInterval: () => {} });
    const seen: LecturerEvent[] = [];
    lec.on((e) => {
      seen.push(e);
      if (e.type === "functionCall") lec.respond(e.id, e.name, `done ${e.name} ${JSON.stringify(e.args)}`);
    });
    await lec.connect();
    const tools = sdk.options().clientTools as Record<string, (p: unknown) => Promise<string>>;
    assert.equal(await tools.highlight_lines({ path: "src/cart.ts", from: 1, to: 2 }), 'done highlight_lines {"path":"src/cart.ts","from":1,"to":2}');
    const o = sdk.options() as Record<string, (p: unknown) => void>;
    o.onMessage({ message: "Where is stock checked?", role: "user", source: "user" });
    o.onModeChange({ mode: "speaking" });
    o.onMessage({ message: "In the cart.", role: "agent", source: "ai" });
    o.onInterruption({});
    assert.deepEqual(
      seen.filter((e) => ["caption", "speaking", "thinking"].includes(e.type)).map((e) => (e.type === "caption" ? `${e.role}: ${e.text}` : e.type === "speaking" ? `speaking ${e.on}` : e.type)),
      ["user: Where is stock checked?", "thinking", "speaking true", "assistant: In the cart.", "speaking false"],
    );
  });

  it("closes after a minute of quiet, ends the SDK session and reports the connected seconds", async () => {
    const sdk = fakeSdk();
    let clock = 0;
    const ticks: (() => void)[] = [];
    let billed = -1;
    const lec = new ElevenAgentsLecturer({
      fetch: session(),
      start: sdk.start,
      context: () => ({ mapSummary: "", keyterms: [] }),
      now: () => clock,
      setInterval: (f) => ticks.push(f),
      clearInterval: () => {},
      onClosed: (s) => (billed = s),
    });
    const seen: LecturerEvent[] = [];
    lec.on((e) => seen.push(e));
    await lec.connect();
    clock = IDLE_CLOSE_MS - 1;
    for (const t of ticks) t();
    assert.equal(sdk.calls.ended, 0);
    clock = IDLE_CLOSE_MS;
    for (const t of ticks) t();
    assert.equal(sdk.calls.ended, 1);
    assert.deepEqual(seen.at(-1), { type: "close", reason: "idle", seconds: 60 });
    assert.equal(billed, 60);
  });

  it("rejects with the session route's FriendlyError (no key) and never starts the SDK", async () => {
    const sdk = fakeSdk();
    const err = { code: "missing_key", title: "ElevenLabs API key missing", message: "Talk needs an ElevenLabs key", action: "settings" };
    const lec = new ElevenAgentsLecturer({ fetch: (async () => Response.json({ error: err }, { status: 400 })) as unknown as typeof fetch, start: sdk.start, context: () => ({ mapSummary: "", keyterms: [] }) });
    const seen: LecturerEvent[] = [];
    lec.on((e) => seen.push(e));
    await assert.rejects(lec.connect(), (e: unknown) => e instanceof VoiceError && e.info.code === "missing_key");
    assert.deepEqual(sdk.options(), {});
    assert.ok(seen.some((e) => e.type === "error" && e.fatal));
    assert.equal(seen.at(-1)?.type, "close");
  });
});
