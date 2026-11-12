// Word timings measured from a recording (src/lib/voice/measure.ts), for a
// narrator that sends none: words are laid over the stretches of sound, never
// over a silence, and a narrator's reading lights no word in a pause.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loudness, measuredWords, voicedRuns, wordHeardAt, LINGER } from "../src/lib/voice/measure";
import { ServerNarrator } from "../src/lib/voice/narrate";
import { AudioCache } from "../src/lib/voice/audioCache";

const STEP = 0.01;
/** Loudness every 10 ms: sound in the given [from, to) stretches (seconds), near silence elsewhere. */
function levels(total: number, sound: [number, number][]): Float32Array {
  const out = new Float32Array(Math.round(total / STEP)).fill(0.0004);
  for (const [a, b] of sound) for (let i = Math.round(a / STEP); i < Math.round(b / STEP); i++) out[i] = 0.12 + 0.05 * Math.sin(i);
  return out;
}
const near = (a: number, b: number, by = 0.011) => assert.ok(Math.abs(a - b) <= by, `${a} is not near ${b}`);
const TEXT = "A reference lets you use a value. You do not own it.";
const said = (text: string, w: { from: number; to: number }) => text.slice(w.from, w.to);

describe("measuring where the sound is", () => {
  it("finds the stretches of sound, joins a short gap inside speech, and drops a click", () => {
    const runs = voicedRuns(levels(4, [[0.3, 1.0], [1.06, 1.8], [2.3, 3.4], [3.7, 3.72]]), STEP);
    assert.equal(runs.length, 2);
    near(runs[0].start, 0.3);
    near(runs[0].end, 1.8);
    near(runs[1].start, 2.3);
    near(runs[1].end, 3.4);
  });

  it("finds nothing in silence", () => {
    assert.deepEqual(voicedRuns(new Float32Array(300), STEP), []);
    assert.deepEqual(voicedRuns(new Float32Array(0), STEP), []);
  });

  it("measures loudness slice by slice", () => {
    const samples = new Float32Array(1600).fill(0);
    samples.fill(0.5, 160, 320);
    const l = loudness(samples, 16000, STEP);
    assert.equal(l.length, 10);
    assert.equal(l[0], 0);
    near(l[1], 0.5, 1e-6);
  });
});

describe("timing words against the sound", () => {
  const runs = voicedRuns(levels(5, [[0.4, 2.4], [2.9, 4.3]]), STEP);
  const words = measuredWords(TEXT, runs);

  it("places every word, in order, inside the sound", () => {
    assert.deepEqual(words.map((w) => said(TEXT, w)), TEXT.split(" "));
    for (let i = 0; i < words.length; i++) {
      assert.ok(words[i].end >= words[i].start);
      if (i) assert.ok(words[i].start >= words[i - 1].start);
      assert.ok(runs.some((r) => words[i].start >= r.start - 1e-6 && words[i].end <= r.end + 1e-6), `${said(TEXT, words[i])} lies in one stretch of sound`);
    }
  });

  it("starts each sentence where its sound starts, and ends it where the sound stops", () => {
    near(words[0].start, 0.4);
    const value = words.find((w) => said(TEXT, w) === "value.")!;
    const you = words[words.indexOf(value) + 1];
    near(value.end, 2.4);
    near(you.start, 2.9);
    near(words.at(-1)!.end, 4.3);
  });

  it("gives a longer word more time than a short one", () => {
    const len = (s: string) => {
      const w = words.find((x) => said(TEXT, x) === s)!;
      return w.end - w.start;
    };
    assert.ok(len("reference") > len("A") * 3);
  });

  it("lights no word before the voice, in the pause between sentences, or after the last word", () => {
    const at = (t: number) => {
      const i = wordHeardAt(words, t);
      return i < 0 ? null : said(TEXT, words[i]);
    };
    assert.equal(at(0.1), null);
    assert.equal(at(0.41), "A");
    assert.equal(at(2.39), "value.");
    assert.equal(at(2.4 + LINGER + 0.05), null);
    assert.equal(at(2.85), null);
    assert.equal(at(2.92), "You");
    assert.equal(at(4.29), "it.");
    assert.equal(at(4.6), null);
  });

  it("spreads the words over all the sound when the pauses do not match the sentences", () => {
    // One sentence, said with a pause in the middle; and two sentences said without one.
    const one = measuredWords("This is one long sentence with a pause", voicedRuns(levels(3, [[0.2, 1.0], [1.5, 2.4]]), STEP));
    near(one[0].start, 0.2);
    near(one.at(-1)!.end, 2.4);
    const two = measuredWords("One. Two three four five six seven eight nine ten.", voicedRuns(levels(3, [[0.2, 1.4], [1.9, 2.0]]), STEP));
    assert.ok(two[1].start < 1.4, "a pause that would give a sentence an impossible pace is not taken for its end");
  });

  it("has nothing to say without sound or without words", () => {
    assert.deepEqual(measuredWords(TEXT, []), []);
    assert.deepEqual(measuredWords("   ", runs), []);
  });
});

describe("a narrator that sends no word timings", () => {
  const mp3 = new Uint8Array([1, 2, 3, 4]);
  const scope = { map: "m", generatedAt: "t" };
  const store = () => {
    const kept = new Map<string, { bytes: Uint8Array; words: { from: number; to: number; start: number; end: number }[]; type: string }>();
    return {
      kept,
      store: {
        get: async (id: string) => kept.get(id) ?? null,
        put: async (id: string, _s: unknown, v: { bytes: Uint8Array; words: { from: number; to: number; start: number; end: number }[]; type: string }) => void kept.set(id, v),
        prune: async () => {},
      },
    };
  };

  it("has its words measured from the audio, and keeps them with the audio", async () => {
    const { kept, store: s } = store();
    const asked: string[] = [];
    const measured = [{ from: 0, to: 5, start: 0.2, end: 0.6 }];
    const narrator = new ServerNarrator("deepgram", {
      voiceId: null,
      speed: 1,
      cache: new AudioCache(s),
      fetch: (async () => new Response(mp3, { headers: { "content-type": "audio/mpeg" } })) as typeof fetch,
      measure: async (text, bytes) => {
        asked.push(`${text}:${bytes.byteLength}`);
        return measured;
      },
    });
    await narrator.prefetch("Hello there", scope);
    assert.deepEqual(asked, ["Hello there:4"]);
    assert.deepEqual([...kept.values()][0].words, measured);
    // Heard again from the cache: not measured a second time.
    await narrator.prefetch("Hello there", scope);
    assert.equal(asked.length, 1);
  });
});
