// The browser's speech recognition behind the mic buttons (src/lib/listen.ts), with a fake engine: a second
// press of the mic ends the listening even when the engine never says it has ended (a desktop webview, or one
// busy while the professor's voice plays), and the words heard so far are the answer, given once.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { listen, STOP_GRACE_MS } from "../src/lib/listen";

class FakeRecognition {
  static last: FakeRecognition | null = null;
  static endsOnStop = true;
  lang = "";
  interimResults = false;
  continuous = false;
  maxAlternatives = 1;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  log: string[] = [];
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.log.push("start");
  }
  stop() {
    this.log.push("stop");
    if (FakeRecognition.endsOnStop) this.onend?.();
  }
  abort() {
    this.log.push("abort");
  }
  hear(words: string) {
    const result = Object.assign([{ transcript: words }], { isFinal: false });
    this.onresult?.({ resultIndex: 0, results: [result] });
  }
}

const g = globalThis as unknown as { window?: unknown };
beforeEach(() => {
  g.window = { SpeechRecognition: FakeRecognition };
  FakeRecognition.endsOnStop = true;
});
afterEach(() => {
  delete g.window;
});

describe("listening with the browser's speech recognition", () => {
  it("ends with the engine's own end when it comes", () => {
    const done: string[] = [];
    const ear = listen({ onText: () => {}, onDone: (t) => done.push(t) });
    FakeRecognition.last!.hear("what is a macro");
    ear!.stop();
    assert.deepEqual(done, ["what is a macro"]);
  });

  it("a second press is never ignored: an engine that never ends gives its words after a moment, once", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    FakeRecognition.endsOnStop = false;
    const done: string[] = [];
    const ear = listen({ onText: () => {}, onDone: (w) => done.push(w) });
    const r = FakeRecognition.last!;
    r.hear("is println a function");
    ear!.stop();
    ear!.stop();
    t.mock.timers.tick(STOP_GRACE_MS - 1);
    assert.deepEqual(done, []);
    t.mock.timers.tick(1);
    assert.deepEqual(done, ["is println a function"]);
    assert.deepEqual(r.log, ["start", "stop", "abort"]);
    r.onend?.(); // the engine's late end changes nothing
    assert.deepEqual(done, ["is println a function"]);
  });

  it("cancel throws the words away, even when the engine ends later", () => {
    const done: string[] = [];
    const ear = listen({ onText: () => {}, onDone: (w) => done.push(w) });
    FakeRecognition.last!.hear("never mind");
    ear!.cancel();
    FakeRecognition.last!.onend?.();
    assert.deepEqual(done, []);
  });
});
