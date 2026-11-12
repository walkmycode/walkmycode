// The professor's voice (src/learn/lib/voice.ts): the Settings narrator via
// speakAloud, Read only at reading pace, stop, and a failing voice that does
// not hold the lesson up.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createProfessorVoice, readTime } from "../src/learn/lib/voice";

function fake(o: { fail?: boolean } = {}) {
  const said: string[] = [];
  const waits: number[] = [];
  const errors: string[] = [];
  let stops = 0;
  let finish: ((e: "ended" | "stopped") => void) | null = null;
  const voice = createProfessorVoice({
    speak: (t) => {
      said.push(t);
      if (o.fail) return Promise.reject(new Error("no key"));
      return new Promise((r) => (finish = r));
    },
    stop: () => {
      stops++;
      finish?.("stopped");
    },
    wait: (ms) => {
      waits.push(ms);
      // The safety timeout never fires in these tests; reading-pace waits resolve at once.
      return ms >= 15000 ? new Promise(() => {}) : Promise.resolve();
    },
    onError: (m) => errors.push(m),
  });
  return { voice, said, waits, errors, get stops() { return stops; }, end: () => finish?.("ended") };
}

describe("the professor's voice", () => {
  it("speaks through the Settings narrator and resolves when the line is heard", async () => {
    const f = fake();
    let done = false;
    const p = f.voice.speak("Hello class.", false).then(() => (done = true));
    await Promise.resolve();
    assert.deepEqual(f.said, ["Hello class."]);
    assert.equal(done, false);
    f.end();
    await p;
    assert.equal(done, true);
  });
  it("Read only says nothing and waits about as long as reading would take", async () => {
    const f = fake();
    await f.voice.speak("A line on the board.", true);
    assert.deepEqual(f.said, []);
    assert.deepEqual(f.waits, [readTime("A line on the board.")]);
  });
  it("stop silences the narrator and lets the pending line resolve", async () => {
    const f = fake();
    const p = f.voice.speak("A long explanation.", false);
    f.voice.stop();
    await p;
    assert.equal(f.stops, 1);
  });
  it("a voice that fails keeps the lesson at reading pace and says why once per failure", async () => {
    const f = fake({ fail: true });
    await f.voice.speak("Two words.", false);
    assert.deepEqual(f.errors, ["no key"]);
    assert.ok(f.waits.includes(readTime("Two words.")));
  });
});
