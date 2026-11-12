// The professor's face (src/learn/lib/face.ts): what it shows, and how the
// mouth takes its shape from the voice: loudness opens the jaw, the pitch the
// sound's energy sits at picks rounder or wider shapes, and a voice that cannot
// be measured (the browser's own) keeps a speaking rhythm through the same shapes.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bandsFrom, easeMouth, faceState, imagined, levelFrom, mouthFor, rhythm, visemeWeights, VISEMES, type Sound, type Viseme } from "../src/learn/lib/face";

const sound = (level: number, low: number, mid: number, high: number): Sound => ({ level, low, mid, high });
const top = (s: Sound) => (Object.entries(visemeWeights(s)) as [Viseme, number][]).sort((a, b) => b[1] - a[1])[0][0];

describe("the professor's face: what it shows", () => {
  it("listens first, then speaks, then thinks, then smiles, else rests", () => {
    assert.equal(faceState({}), "idle");
    assert.equal(faceState({ pleased: true }), "pleased");
    assert.equal(faceState({ pleased: true, thinking: true }), "thinking");
    assert.equal(faceState({ thinking: true, speaking: true }), "speaking");
    assert.equal(faceState({ thinking: true, speaking: true, listening: true, pleased: true }), "listening");
  });
});

describe("the professor's face: mouth shapes from the voice", () => {
  it("has the shapes speech needs: closed, lips together, teeth on lip, wide, open, round, small and round", () => {
    assert.deepEqual(Object.keys(VISEMES), ["rest", "mm", "f", "ee", "ah", "oh", "oo", "smile"]);
    assert.equal(VISEMES.rest.o, 0);
    assert.equal(VISEMES.mm.o, 0);
    assert.ok(VISEMES.ah.o > VISEMES.oh.o && VISEMES.oh.o > VISEMES.oo.o && VISEMES.oo.o > VISEMES.ee.o, "ah is the most open, ee the least of the vowels");
    assert.ok(VISEMES.ee.w > VISEMES.ah.w && VISEMES.ah.w > VISEMES.oh.w && VISEMES.oh.w > VISEMES.oo.w, "ee is the widest, oo the narrowest");
    assert.ok(VISEMES.oo.r === 1 && VISEMES.ee.r === 0);
  });

  it("rests in silence", () => {
    assert.deepEqual(visemeWeights(sound(0, 0, 0, 0)).rest, 1);
    assert.equal(top(sound(0.03, 0.2, 0.2, 0.2)), "rest");
    assert.deepEqual(mouthFor(sound(0, 0, 0, 0)), { w: 15, o: 0, r: 0, s: 0.35 });
  });

  it("picks an open ah for loud middle sound, a round oh or oo for low sound, a wide ee for high sound", () => {
    assert.equal(top(sound(0.9, 0.3, 0.6, 0.1)), "ah");
    assert.equal(top(sound(0.9, 0.9, 0.2, 0.05)), "oh");
    assert.equal(top(sound(0.2, 0.9, 0.2, 0.05)), "oo");
    assert.equal(top(sound(0.8, 0.1, 0.2, 0.9)), "ee");
    assert.equal(top(sound(0.15, 0.3, 0.6, 0.1)), "mm", "quiet middle sound is nearly closed lips");
  });

  it("blends the shapes: weights add up to one, and no shape is asked for twice over", () => {
    for (const s of [sound(0.5, 0.4, 0.4, 0.4), sound(1, 1, 0, 0), sound(0.3, 0, 0, 1), sound(0.7, 0.5, 0.5, 0)]) {
      const w = Object.values(visemeWeights(s));
      assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-9);
      assert.ok(w.every((x) => x >= 0 && x <= 1));
    }
    assert.equal(visemeWeights(sound(0.8, 0.3, 0.3, 0.3)).smile, 0, "a smile is a pose, not a sound");
  });

  it("opens wider the louder the same sound is, and rounder for low sound than for high", () => {
    const quiet = mouthFor(sound(0.3, 0.3, 0.6, 0.1));
    const loud = mouthFor(sound(0.9, 0.3, 0.6, 0.1));
    assert.ok(loud.o > quiet.o * 2, `${loud.o} > ${quiet.o}`);
    const low = mouthFor(sound(0.7, 0.9, 0.2, 0.05));
    const high = mouthFor(sound(0.7, 0.1, 0.2, 0.9));
    assert.ok(low.r > 0.8 && high.r < 0.1);
    assert.ok(high.w > low.w + 6, "ee is wide where oh is narrow");
  });

  it("moves quickly to open and more slowly to close, like a jaw", () => {
    const opening = easeMouth(VISEMES.rest, VISEMES.ah);
    const closing = easeMouth(VISEMES.ah, VISEMES.rest);
    assert.ok(opening.o / VISEMES.ah.o > 0.4);
    assert.ok(closing.o / VISEMES.ah.o > 0.7);
    assert.deepEqual(easeMouth(VISEMES.oo, VISEMES.oo), VISEMES.oo);
  });
});

describe("the professor's face: measuring the voice", () => {
  const wave = (amp: number) => Uint8Array.from({ length: 256 }, (_, i) => 128 + Math.round(amp * 127 * Math.sin(i / 4)));

  it("reads silence as nothing and speech as loud", () => {
    assert.equal(levelFrom(new Uint8Array(256).fill(128)), 0);
    assert.equal(levelFrom([]), 0);
    assert.equal(levelFrom(wave(0.01)), 0, "a hiss is not speech");
    const quiet = levelFrom(wave(0.1));
    const loud = levelFrom(wave(0.3));
    assert.ok(quiet > 0.1 && quiet < loud);
    assert.equal(levelFrom(wave(1)), 1);
  });

  it("finds where a sound's energy sits", () => {
    // 256 bins over 24 kHz: 93.75 Hz a bin.
    const spectrum = (from: number, to: number) => Uint8Array.from({ length: 256 }, (_, i) => (i * 93.75 >= from && i * 93.75 < to ? 255 : 0));
    const hum = bandsFrom(spectrum(150, 450), 48000);
    assert.ok(hum.low > 0.5 && hum.mid === 0 && hum.high === 0);
    const vowel = bandsFrom(spectrum(700, 1800), 48000);
    assert.ok(vowel.mid > 0.6 && vowel.low === 0 && vowel.high === 0);
    const hiss = bandsFrom(spectrum(4000, 7000), 48000);
    assert.ok(hiss.high > 0.4 && hiss.low === 0 && hiss.mid === 0);
    assert.deepEqual(bandsFrom([], 48000), { low: 0, mid: 0, high: 0 });
  });

  it("keeps a speaking rhythm for a voice it cannot measure, through several shapes", () => {
    const levels = Array.from({ length: 300 }, (_, i) => rhythm(i * 16));
    assert.ok(levels.every((l) => l >= 0 && l <= 1));
    assert.ok(Math.max(...levels) > 0.7 && Math.min(...levels) < 0.05, "it opens and closes");
    const shapes = new Set(Array.from({ length: 600 }, (_, i) => top(imagined(i * 16))));
    assert.ok(shapes.size >= 4, `an imagined voice moves through ${[...shapes].join(", ")}`);
  });
});
