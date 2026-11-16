// Explore's mute (src/lib/voice/mute.ts): the silent narrator reads nothing
// but takes as long as a reading would, so a tour still moves on by itself;
// pause, resume and stop behave as a real narrator's.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getNarrator, SilentNarrator } from "../src/lib/voice/narrate";
import { readTime } from "../src/lib/voice/mute";

describe("Explore muted: the silent narrator", () => {
  it("is the narrator handed out while muted, and a real one again when not", () => {
    const muted = getNarrator({ narrator: "browser", voiceId: null, speed: 1, muted: true });
    assert.ok(muted instanceof SilentNarrator);
    assert.equal(muted.marks, false);
    const real = getNarrator({ narrator: "browser", voiceId: null, speed: 1 });
    assert.ok(!(real instanceof SilentNarrator));
  });

  it("takes a reading's time, says it started, and ends", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const n = new SilentNarrator("browser");
    let started = false;
    const text = "Pay the merchant, then post both sides to the ledger.";
    const done = n.speak(text, { onStart: () => (started = true) });
    assert.equal(started, true);
    t.mock.timers.tick(readTime(text) - 1);
    let ended = false;
    void done.then(() => (ended = true));
    await Promise.resolve();
    assert.equal(ended, false);
    t.mock.timers.tick(1);
    assert.equal(await done, "ended");
  });

  it("pauses and resumes with the time it had left, and stops as stopped", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const n = new SilentNarrator("browser");
    const text = "x".repeat(100); // 4,700 ms
    const done = n.speak(text);
    t.mock.timers.tick(1000);
    n.pause();
    assert.equal(n.paused, true);
    t.mock.timers.tick(10_000); // paused: nothing moves
    n.resume();
    assert.equal(n.paused, false);
    t.mock.timers.tick(readTime(text) - 1000);
    assert.equal(await done, "ended");

    const again = n.speak(text);
    n.stop();
    assert.equal(await again, "stopped");
  });
});
