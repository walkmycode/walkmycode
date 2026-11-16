// The transcript under the board (src/learn/lib/caption.ts, voice.ts): the word
// being spoken is lit. A narrator that reports its words is believed; for one
// that does not, the word is reckoned from how long the line has played. Also
// the professor's size setting (face.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { captionParts, reckonedWord, wordSpans } from "../src/learn/lib/caption";
import { DEFAULT_PACE, forgetPaces, learnPace, spokenWeight, voicePace } from "../src/lib/voice/measure";
import { FACE_SIZES, parseFaceSize, stepFaceSize } from "../src/learn/lib/face";
import { followWords, type Saying } from "../src/learn/lib/voice";

const LINE = "A reference lets you use a value. You do not own it.";
const word = (text: string, w: { from: number; to: number } | null) => (w ? text.slice(w.from, w.to) : null);

describe("the transcript: which word is being spoken", () => {
  it("finds every word of a line", () => {
    assert.deepEqual(wordSpans("A reference,  two").map((w) => "A reference,  two".slice(w.from, w.to)), ["A", "reference,", "two"]);
    assert.deepEqual(wordSpans("   "), []);
  });

  it("reckons the word from the time played: the first at once, later ones later, none after the end", () => {
    assert.equal(word(LINE, reckonedWord(LINE, 0)), "A");
    assert.equal(word(LINE, reckonedWord(LINE, 450)), "reference");
    const heard = Array.from({ length: 80 }, (_, i) => word(LINE, reckonedWord(LINE, i * 100))).filter(Boolean) as string[];
    assert.deepEqual([...new Set(heard)], LINE.split(" "), "every word is reached, in order, none skipped");
    assert.equal(reckonedWord(LINE, 60_000), null);
    assert.equal(reckonedWord("", 0), null);
  });

  it("takes as long as the voice really takes, pauses at a full stop, and keeps up with a faster voice", () => {
    forgetPaces();
    const end = (text: string, speed = 1) => {
      let ms = 0;
      while (reckonedWord(text, ms, speed)) ms += 20;
      return ms;
    };
    // Measured 15 Nov 2026: Deepgram Aura-2 Draco said this line in 12.2 s; the old reckoning (15 characters a
    // second) finished it in 10.1 s, lighting every word ahead of the voice, 2.5 s ahead by the end.
    const DRACO = "rustc turns a correct main.rs into a program you can run again and again on its own, but if there is even one mistake it builds nothing at all.";
    const said = end(DRACO);
    assert.ok(said > 11_500 && said < 13_000, `${said} ms for a line Draco says in 12,200 ms`);
    // Deepgram does not stretch speech in proportion to the speed setting: 0.7 made that line 15.6 s, 1.2 made it 10.0 s.
    assert.ok(Math.abs(end(DRACO, 0.7) - 15_600) < 1_400, `${end(DRACO, 0.7)} ms at 0.7`);
    assert.ok(Math.abs(end(DRACO, 1.2) - 10_000) < 1_000, `${end(DRACO, 1.2)} ms at 1.2`);
    const normal = end(LINE);
    assert.ok(end(LINE, 1.2) < normal * 0.92);
    // "value." holds a little longer than its letters.
    const during = (w: string) => Array.from({ length: 400 }, (_, i) => word(LINE, reckonedWord(LINE, i * 10))).filter((x) => x === w).length;
    assert.ok(during("value.") > during("reference") * 0.9, "six letters and a stop last about as long as nine letters");
  });

  it("splits the line into what was said, the word being said, and what is to come", () => {
    const w = wordSpans(LINE)[1];
    assert.deepEqual(captionParts(LINE, w), { said: "A ", now: "reference", next: " lets you use a value. You do not own it." });
    assert.deepEqual(captionParts(LINE, null), { said: "", now: "", next: LINE });
    const last = wordSpans(LINE).at(-1)!;
    assert.deepEqual(captionParts(LINE, last), { said: LINE.slice(0, last.from), now: "it.", next: "" });
  });

  it("shows a long answer one sentence at a time", () => {
    const long = `${"First sentence that is fairly long and goes on. ".repeat(5)}The reference is here. And a last one.`;
    const at = long.indexOf("reference");
    const p = captionParts(long, { from: at, to: at + 9 });
    assert.deepEqual(p, { said: "The ", now: "reference", next: " is here. " });
    assert.equal(captionParts(long, null).next, "First sentence that is fairly long and goes on. ");
  });
});

describe("the transcript: following a line as it is spoken", () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("believes a narrator that reports its words", async () => {
    const shown: (Saying | null)[] = [];
    const words = followWords((s) => shown.push(s));
    const end = words.begin(LINE, 1);
    assert.deepEqual(shown, [{ text: LINE, word: null }]);
    words.started(LINE);
    words.heard(LINE, { from: 2, to: 11 });
    await wait(250);
    assert.deepEqual(shown.at(-1), { text: LINE, word: { from: 2, to: 11 } }, "the reckoning stays out of it once the narrator tells");
    words.heard("another line", { from: 0, to: 3 });
    assert.equal(shown.length, 2, "a word of some other line is ignored");
    end();
    assert.equal(shown.at(-1), null);
  });

  it("lights nothing when the narrator says no word is being heard: a pause, or the end", async () => {
    const shown: (Saying | null)[] = [];
    const words = followWords((s) => shown.push(s));
    const end = words.begin(LINE, 1);
    words.started(LINE);
    words.heard(LINE, { from: 27, to: 33 });
    words.heard(LINE, null);
    assert.deepEqual(shown.at(-1), { text: LINE, word: null });
    await wait(250);
    assert.deepEqual(shown.at(-1), { text: LINE, word: null }, "and the reckoning does not light one in its place");
    words.heard(LINE, { from: 34, to: 37 });
    assert.equal(word(LINE, shown.at(-1)!.word), "You");
    end();
  });

  it("lights nothing for a line whose sound never begins", async () => {
    let clock = 0;
    const shown: (Saying | null)[] = [];
    const words = followWords((s) => shown.push(s), () => clock);
    const end = words.begin(LINE, 1);
    clock = 4000;
    await wait(250);
    assert.deepEqual(shown, [{ text: LINE, word: null }]);
    end();
  });

  it("reckons the word for a narrator that does not, from when the sound began", async () => {
    let clock = 0;
    const shown: (Saying | null)[] = [];
    const words = followWords((s) => shown.push(s), () => clock);
    const end = words.begin(LINE, 1);
    await wait(200);
    assert.equal(shown.length, 1, "nothing is lit before the sound begins");
    clock = 5000;
    words.started(LINE);
    // The voice's own silence before its first word (0.17 s), then "A": the second word is heard about 0.4 s in.
    clock = 5600;
    await wait(200);
    assert.equal(word(LINE, shown.at(-1)!.word), "reference");
    end();
    assert.equal(shown.at(-1), null);
    const count = shown.length;
    await wait(200);
    assert.equal(shown.length, count, "nothing more after the line has ended");
  });

  it("drops an old line when a new one begins, and an old ending does not clear the new line", async () => {
    const shown: (Saying | null)[] = [];
    const words = followWords((s) => shown.push(s));
    const endFirst = words.begin("first line", 1);
    const endSecond = words.begin("second line", 1);
    endFirst();
    assert.deepEqual(shown.at(-1), { text: "second line", word: null });
    endSecond();
    assert.equal(shown.at(-1), null);
  });
});

describe("the professor's size", () => {
  it("is small, medium or large, and medium when nothing or nonsense is saved", () => {
    assert.deepEqual(FACE_SIZES.map((s) => s.id), ["small", "medium", "large"]);
    assert.equal(parseFaceSize("large"), "large");
    assert.equal(parseFaceSize("small"), "small");
    assert.equal(parseFaceSize("huge"), "medium");
    assert.equal(parseFaceSize(null), "medium");
  });

  it("steps a size down or up with the [ and ] keys, and stops at the ends", () => {
    assert.equal(stepFaceSize("medium", 1), "large");
    assert.equal(stepFaceSize("medium", -1), "small");
    assert.equal(stepFaceSize("large", 1), "large");
    assert.equal(stepFaceSize("small", -1), "small");
  });
});

describe("the transcript: how long a word takes to say", () => {
  it("weighs a word by how it is said, not how it is spelled: code names' dots aloud, letters spelled out", () => {
    // "main.rs" is said "main dot r s": far longer than its seven letters suggest, longer than "mains".
    assert.ok(spokenWeight("main.rs") > spokenWeight("mains") * 2.5);
    // A word with no vowel is spelled: "SQL" is three letters said one by one.
    assert.ok(spokenWeight("SQL") >= 3);
    // camelCase is said as its parts: "useEffect" is "use effect".
    assert.ok(spokenWeight("useEffect") > spokenWeight("use"));
    assert.ok(spokenWeight("a") >= 1);
    assert.equal(spokenWeight("—"), 0.5);
  });

  it("learns the voice's own pace from each measured line, at its speed, and blends one line in gently", () => {
    forgetPaces();
    assert.deepEqual(voicePace(1), DEFAULT_PACE);
    const text = "One two three four five six seven eight nine ten, eleven twelve.";
    // Two stretches of sound, 2 s and 1 s, with a 0.6 s pause at the comma, after 0.3 s of silence.
    learnPace(text, [{ start: 0.3, end: 2.3 }, { start: 2.9, end: 3.9 }], 1);
    const p = voicePace(1);
    assert.ok(Math.abs(p.lead - 0.3) < 1e-9);
    assert.ok(Math.abs(p.pause - 0.6) < 1e-9);
    // 3.6 s from the first word to the last, less the comma's 0.6 s pause: 3 s of words.
    const weight = text.split(" ").reduce((s, w) => s + spokenWeight(w), 0);
    assert.ok(Math.abs(p.perUnit - 3 / weight) < 1e-9);
    // Another speed has its own pace; the first speed's is kept.
    assert.notDeepEqual(voicePace(0.8), p);
    learnPace(text, [{ start: 0.3, end: 4.3 }, { start: 4.9, end: 6.9 }], 1);
    assert.ok(voicePace(1).perUnit > p.perUnit && voicePace(1).perUnit < (6 / weight), "blended, not replaced");
    forgetPaces();
  });
});
