// A provider that will not take a whole lesson (a free plan's tokens-per-minute
// limit): the error names the provider, the lesson is written in small steps
// instead. src/learn/lib/tutor.ts and professor.ts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sampleMessage, type Sample } from "../src/learn/lib/claude";
import { readLesson } from "../src/learn/lib/courseFolder";
import { folderEndPrompt, folderPartPrompt, readmeParts, STEP_OUTPUT, writeFolderLessonInSteps, type StepProgress } from "../src/learn/lib/professor";
import { toSampleError } from "../src/learn/lib/tutor";
import { DEFAULT_PROFILE } from "../src/learn/lib/types";

const FENCE = "```";
const README = `# Ownership

Ownership is how Rust stays safe.

> 💡 **The big picture: toys in a playroom.** Every toy has one owner.

## Why ownership exists

${"Memory must be managed. ".repeat(40)}

## Move

${FENCE}rust
## not a heading
let s2 = s1;
${FENCE}

> 💡 **Analogy: the cloakroom ticket.** Only the ticket changes hands.

## Recap

One owner at a time.
`;
const lesson = readLesson("01/06_ownership", { "README.md": README, "examples/move_semantics.rs": "fn main() {}" });

describe("errors name the provider that failed", () => {
  it("says what the app's provider layer said, with the provider's own name", () => {
    const e = toSampleError({ code: "rate_limited", title: "Groq is busy right now", message: "Too many requests or a temporary quota limit. Wait a moment and try again." }, "");
    assert.equal(e.code, "rate_limited");
    assert.equal(sampleMessage(e), "Groq is busy right now. Too many requests or a temporary quota limit. Wait a moment and try again.");
    assert.doesNotMatch(sampleMessage(e), /Claude/);
  });

  it("knows a request refused for its size, by status or by what the provider said", () => {
    const byStatus = toSampleError({ code: "out_of_credits", provider: "groq", title: "Groq account is out of credits", message: "x", status: 413 }, "");
    assert.equal(byStatus.code, "prompt_too_large");
    assert.match(sampleMessage(byStatus), /^Groq would not take that much at once on this plan\./);
    const byWords = toSampleError({ code: "rate_limited", provider: "groq", title: "Groq is busy right now", message: "m", detail: "Request too large for model llama-3.3-70b-versatile on tokens per minute (TPM): Limit 12000, Requested 15133" }, "");
    assert.equal(byWords.code, "prompt_too_large");
    assert.match(sampleMessage(byWords), /smaller steps/);
  });

  it("keeps a missing key as not configured, a stop as silence, and never names Claude for another provider", () => {
    assert.equal(toSampleError({ code: "missing_key", title: "Groq API key missing", message: "Add your Groq key in Settings." }, "").code, "not_configured");
    assert.equal(sampleMessage({ code: "cancelled", message: "Stopped.", said: "anything" }), "");
    assert.doesNotMatch(sampleMessage({ code: "rate_limited" }), /Claude/);
    assert.doesNotMatch(sampleMessage({ code: "something_else" }), /Claude/);
  });
});

describe("a folder lesson written in steps", () => {
  it("cuts the README at its sections, joins small ones, and never at a ## inside code", () => {
    const parts = readmeParts(README, 700);
    assert.deepEqual(parts.map((p) => p.heading), ["Introduction", "Why ownership exists", "Move; Recap"]);
    assert.match(parts[2].text, /## not a heading/);
    assert.ok(parts[1].text.length <= 720, "a long section is cut to size");
    assert.match(parts[1].text, /… \(cut\)$/);
    assert.deepEqual(readmeParts(README, 100_000).map((p) => p.heading), ["Introduction; Why ownership exists; Move; Recap"]);
  });

  it("keeps to a few parts however many sections there are", () => {
    const many = `# T\n\n${Array.from({ length: 30 }, (_, i) => `## S${i}\n\n${"word ".repeat(120)}\n`).join("\n")}`;
    const parts = readmeParts(many, 700, 6);
    assert.equal(parts.length, 6);
    assert.ok(parts.every((p) => p.text.length <= 720));
  });

  it("sends one part of the README at a time, never the examples' code", () => {
    const parts = readmeParts(README, 700);
    const first = folderPartPrompt(lesson, "Mastering Rust", DEFAULT_PROFILE, parts[0], 0, 3, []);
    assert.match(first, /part 1 of 3/);
    assert.match(first, /toys in a playroom/);
    assert.doesNotMatch(first, /cloakroom ticket\./, "other parts stay out");
    assert.match(first, /one of move_semantics\.rs/);
    assert.doesNotMatch(first, /fn main\(\)/);
    assert.match(first, /The first board says what we will learn/);
    const last = folderPartPrompt(lesson, "Mastering Rust", DEFAULT_PROFILE, parts[2], 2, 3, [{ title: "Why", analogy: "A playroom." }]);
    assert.match(last, /Boards already written: "Why"\./);
    assert.match(last, /The lesson's picture so far: A playroom\./);
    assert.match(last, /The last board is the recap/);
    assert.ok(first.length < 5000, `a part's prompt stays small (${first.length})`);
  });

  it("asks for the close from the boards alone", () => {
    const p = folderEndPrompt(lesson, "Mastering Rust", DEFAULT_PROFILE, [{ title: "Move", kind: "talk", lines: [{ w: "`let s2 = s1;` moves", s: "x" }] }]);
    assert.match(p, /1\. "Move": let s2 = s1; moves/);
    assert.match(p, /"quiz"/);
    assert.match(p, /"cards"/);
    assert.doesNotMatch(p, /playroom/, "the README is not sent again");
  });

  const board = (title: string) => ({ title, kind: "talk", analogy: `${title} picture`, example: title === "Move" ? "move_semantics.rs" : undefined, lines: [{ w: title, s: title }] });
  const end = { summary: "You can explain ownership.", quiz: [{ q: "q", options: ["a", "b", "c"], answer: 1, why: "w" }], questions: ["Explain a move."], cards: [{ q: "Who frees a value?", a: "Its owner." }] };

  it("writes the lesson part by part with small replies, then the quiz, the explain-back and the cards", async () => {
    const asked: { prompt: string; max?: number }[] = [];
    const sample = {
      json: async (prompt: string, o?: { maxOutput?: number }) => {
        asked.push({ prompt, max: o?.maxOutput });
        return /Write its close/.test(prompt) ? end : { boards: [board("Why")] };
      },
    } as unknown as Sample;
    const seen: StepProgress[] = [];
    const out = (await writeFolderLessonInSteps(sample, lesson, "Mastering Rust", DEFAULT_PROFILE, (p) => seen.push(p), new AbortController().signal))!;
    // This README is small: at the default size it is one part, plus the close.
    assert.equal(asked.length, 2);
    assert.ok(asked.every((a) => a.max === STEP_OUTPUT));
    assert.deepEqual(out.boards.map((b) => b.kind), ["talk", "quiz", "explain"]);
    assert.equal(out.title, "Ownership");
    assert.equal(out.summary, "You can explain ownership.");
    assert.deepEqual(out.cards, end.cards);
    assert.deepEqual(seen.map((p) => [p.step, p.steps]), [[1, 2], [2, 2]]);
  });

  it("waits and tries a step again when the provider's per-minute limit is hit, then gives up", async () => {
    let calls = 0;
    const sample = {
      json: async (prompt: string) => {
        calls++;
        if (calls === 1 || calls === 2) throw { code: "rate_limited", message: "busy" };
        return /Write its close/.test(prompt) ? end : { boards: [board("Why"), board("Move")] };
      },
    } as unknown as Sample;
    const paused: number[] = [];
    const seen: StepProgress[] = [];
    const out = await writeFolderLessonInSteps(sample, lesson, "Mastering Rust", DEFAULT_PROFILE, (p) => seen.push(p), new AbortController().signal, { pause: async (ms) => void paused.push(ms), waits: [1, 2] });
    assert.deepEqual(paused, [1000, 2000]);
    assert.deepEqual(seen.filter((p) => p.waiting).map((p) => p.waiting), [1, 2]);
    assert.deepEqual(out!.boards.map((b) => b.kind), ["talk", "talk", "quiz", "explain"]);
    assert.equal(out!.boards[1].exampleName, "move_semantics.rs", "a board still names its example for the page to attach");

    // A reply cut short is asked for once more, with twice the room; a second failure is the end.
    const rooms: (number | undefined)[] = [];
    let cut = 0;
    const short = { json: async (prompt: string, o?: { maxOutput?: number }) => { rooms.push(o?.maxOutput); if (cut++ === 0) throw { code: "invalid_json", message: "cut" }; return /Write its close/.test(prompt) ? end : { boards: [board("Why"), board("Move")] }; } } as unknown as Sample;
    assert.ok(await writeFolderLessonInSteps(short, lesson, "c", DEFAULT_PROFILE, () => {}, new AbortController().signal));
    assert.deepEqual(rooms, [STEP_OUTPUT, STEP_OUTPUT * 2, STEP_OUTPUT]);

    const always = { json: async () => { throw { code: "rate_limited", message: "busy" }; } } as unknown as Sample;
    await assert.rejects(writeFolderLessonInSteps(always, lesson, "c", DEFAULT_PROFILE, () => {}, new AbortController().signal, { pause: async () => {}, waits: [1] }), { code: "rate_limited" });
    const broken = { json: async () => { throw { code: "not_configured", message: "no key" }; } } as unknown as Sample;
    await assert.rejects(writeFolderLessonInSteps(broken, lesson, "c", DEFAULT_PROFILE, () => {}, new AbortController().signal, { pause: async () => assert.fail("no waiting for other errors") }), { code: "not_configured" });
  });
});
