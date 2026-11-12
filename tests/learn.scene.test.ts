// An analogy as a scene to watch (src/learn/lib/scene.ts): what the professor
// is asked for, what is kept of the reply, and what each step draws. The scene
// is the Rust course's own picture for a move: a toy handed from Ama to Kofi.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHAT_RULES } from "../src/learn/lib/chat";
import { ANALOGY_RULES, DIAGRAM_RULES, folderLessonPrompt, lessonPrompt } from "../src/learn/lib/professor";
import { cardsFor } from "../src/learn/lib/recall";
import { cleanScene, scenePrompt, sceneView } from "../src/learn/lib/scene";
import { readLesson } from "../src/learn/lib/courseFolder";
import { DEFAULT_PROFILE, type Lesson } from "../src/learn/lib/types";

const raw = () => ({
  title: "Handing a toy to a friend",
  place: "a playroom",
  actors: [{ id: "Ama", a: "Ama", r: "s1" }, { id: "kofi", a: "Kofi", r: "s2" }],
  things: [{ id: "toy", a: "the toy", r: '"hello" on the heap' }],
  code: 'let s1 = String::from("hello");\nlet s2 = s1;\nprintln!("{s1}"); // error E0382\n}',
  steps: [
    { line: 1, holds: { toy: "ama" }, lent: {}, off: [], a: "Ama has a toy.", r: "s1 owns the text." },
    { line: 2, holds: { toy: "kofi" }, off: ["ama"], a: "Ama hands it to Kofi.", r: "The text moves to s2." },
    { line: 3, off: ["ama"], a: "Ama's hands are empty.", r: "Using s1 is error E0382." },
    { line: 4, holds: { toy: null }, off: ["ama", "kofi"], a: "Kofi goes home; the toy is tidied away.", r: "s2 is dropped and the text is freed." },
  ],
  map: [{ a: "a child", r: "a variable" }, { a: "the toy", r: "the value" }, { a: "", r: "dropped" }],
  rule: "A value has one owner; assigning it moves it.",
  breaks: "Ama could ask for her toy back; s1 cannot.",
});

const lesson: Lesson = {
  id: "L1", course: "Mastering Rust", number: 6, title: "Ownership", subject: "Ownership", summary: "s",
  boards: [
    { title: "Move", kind: "talk", lines: [{ w: "`let s2 = s1;` moves the **String**", s: "x" }], analogy: "Giving your coat ticket to a friend.", example: { name: "move_semantics.rs", code: "fn main() { let s1 = String::from(\"hi\"); }", language: "rust" } },
    { title: "Exercise", kind: "code", lines: [{ w: "x", s: "x" }], task: "t", starter: "fn main() {}", language: "rust" },
  ],
  createdAt: 0, updatedAt: 0, at: 0, seen: [0],
};

describe("an analogy to watch: what is kept of the professor's scene", () => {
  it("keeps a well-formed scene, with ids made plain", () => {
    const s = cleanScene(raw(), "rust")!;
    assert.deepEqual(s.actors.map((a) => a.id), ["ama", "kofi"]);
    assert.equal(s.language, "rust");
    assert.equal(s.steps.length, 4);
    assert.deepEqual(s.map, [{ a: "a child", r: "a variable" }, { a: "the toy", r: "the value" }], "a pair with a side missing is dropped");
    assert.equal(s.rule, "A value has one owner; assigning it moves it.");
  });

  it("carries a thing's holder forward when a step does not name it, and null means gone", () => {
    const s = cleanScene(raw(), "rust")!;
    assert.deepEqual(s.steps.map((x) => x.holds.toy), ["ama", "kofi", "kofi", null]);
    assert.deepEqual(s.steps.map((x) => x.off), [[], ["ama"], ["ama"], ["ama", "kofi"]]);
  });

  it("drops what cannot be true: unknown holders, a loan to the holder itself, a loan of something gone, a line the code does not have", () => {
    const r = raw();
    r.steps = [
      { line: 1, holds: { toy: "ama" }, lent: { toy: ["kofi", "ama", "nobody", "kofi"] }, off: ["ghost"], a: "Ama lends it.", r: "s2 borrows." },
      { line: 99, holds: { toy: "stranger" }, lent: {}, off: [], a: "Still Ama's.", r: "Still s1's." },
      { line: 4, holds: { toy: null }, lent: { toy: ["kofi"] }, off: [], a: "Gone.", r: "Freed." },
    ] as never;
    const s = cleanScene(r, "rust")!;
    assert.deepEqual(s.steps[0].lent, { toy: ["kofi"] });
    assert.deepEqual(s.steps[0].off, []);
    assert.equal(s.steps[1].holds.toy, "ama", "an unknown holder leaves it where it was");
    assert.equal(s.steps[1].line, undefined);
    assert.deepEqual(s.steps[2].lent, {});
  });

  it("refuses a scene the page could not draw", () => {
    assert.equal(cleanScene(null, "rust"), null);
    assert.equal(cleanScene({ ...raw(), actors: [{ id: "ama", a: "Ama", r: "s1" }] }, "rust"), null, "one holder is no scene");
    assert.equal(cleanScene({ ...raw(), things: [] }, "rust"), null);
    assert.equal(cleanScene({ ...raw(), code: "" }, "rust"), null);
    assert.equal(cleanScene({ ...raw(), steps: [raw().steps[0]] }, "rust"), null, "one step is nothing to watch");
    assert.equal(cleanScene({ ...raw(), steps: [{ line: 1, holds: {}, a: "", r: "" }, { line: 2, a: "x", r: "" }] }, "rust"), null);
  });

  it("holds at most what fits the screen", () => {
    const r = raw();
    r.actors = Array.from({ length: 9 }, (_, i) => ({ id: `a${i}`, a: `Child ${i}`, r: `v${i}` }));
    r.steps = Array.from({ length: 20 }, (_, i) => ({ line: 1, holds: { toy: "a0" }, lent: {}, off: [], a: `step ${i}`, r: "r" }));
    const s = cleanScene(r, "rust")!;
    assert.equal(s.actors.length, 4);
    assert.equal(s.steps.length, 8);
  });
});

describe("an analogy to watch: what each step draws", () => {
  const s = cleanScene({ ...raw(), steps: [...raw().steps.slice(0, 1), { line: 2, holds: { toy: "ama" }, lent: { toy: ["kofi"] }, off: [], a: "Ama lends it.", r: "s2 borrows it." }, ...raw().steps.slice(1)] }, "rust")!;

  it("puts each thing with its holder, on both sides at once", () => {
    const v = sceneView(s, 0);
    assert.deepEqual(v.actors.map((a) => [a.a, a.r, a.holds.map((t) => t.a), a.holds.map((t) => t.r)]), [["Ama", "s1", ["the toy"], ['"hello" on the heap']], ["Kofi", "s2", [], []]]);
    assert.deepEqual(v.gone, []);
  });

  it("shows a loan beside the borrower while the owner still holds it", () => {
    const v = sceneView(s, 1);
    assert.deepEqual(v.actors[0].holds.map((t) => t.id), ["toy"]);
    assert.deepEqual(v.actors[1].lent.map((t) => t.id), ["toy"]);
  });

  it("marks a moved-from holder as unusable, and a dropped thing as gone", () => {
    assert.deepEqual(sceneView(s, 2).actors.map((a) => [a.id, a.off, a.holds.length]), [["ama", true, 0], ["kofi", false, 1]]);
    const end = sceneView(s, 4);
    assert.deepEqual(end.gone.map((t) => t.id), ["toy"]);
    assert.ok(end.actors.every((a) => a.off && !a.holds.length));
  });

  it("stays within the scene's steps", () => {
    assert.deepEqual(sceneView(s, -3), sceneView(s, 0));
    assert.deepEqual(sceneView(s, 99), sceneView(s, s.steps.length - 1));
  });
});

describe("an analogy to watch: what the professor is asked", () => {
  it("gives the board, its analogy and its example, and asks for both sides from one set of data", () => {
    const p = scenePrompt(lesson, 0, DEFAULT_PROFILE);
    assert.match(p, /The student is on the board "Move"/);
    assert.match(p, /The board's analogy: Giving your coat ticket to a friend\./);
    assert.match(p, /move_semantics\.rs/);
    assert.match(p, /the real rust code on the right/);
    assert.match(p, /"holds": for every thing, the id of the actor that holds it now, or null/);
    assert.match(p, /"breaks": one sentence on where the picture stops being true/);
    assert.match(p, /Check every step against the code as the compiler would/);
    assert.match(p, /Keep the board's own picture/);
  });

  it("holds every analogy to the same bar: concrete, one idea, mapped, true to the code, honest about its limit", () => {
    for (const rule of [/ten-year-old has touched/, /One idea per analogy/, /what stands for what/, /true to the code/, /where it stops/]) assert.match(ANALOGY_RULES, rule);
    const written = lessonPrompt({ topic: "Ownership", course: "Rust", level: "Beginner", boards: 10, notes: "" }, DEFAULT_PROFILE, []);
    const fromFolder = folderLessonPrompt(readLesson("01/06_ownership", { "README.md": "# Ownership\n\n## Move\n" }), "Rust", DEFAULT_PROFILE, []);
    for (const p of [written, fromFolder]) {
      assert.ok(p.includes(ANALOGY_RULES));
      assert.ok(p.includes(DIAGRAM_RULES));
    }
    assert.match(CHAT_RULES, /saying what stands for what/);
  });

  it("asks for diagrams that back the analogy, only where a picture helps", () => {
    assert.match(DIAGRAM_RULES, /never for decoration and never for plain syntax/);
    assert.match(DIAGRAM_RULES, /first line is the real name and its second line \(after <br\/>\) is the analogy's word/);
    assert.match(DIAGRAM_RULES, /match the code on the board exactly/);
  });

  it("lets a recall card carry the picture that is its answer", () => {
    const cards = cardsFor(lesson, [{ q: "What does a move do?", a: "It hands over ownership.", diagram: "  flowchart LR\n  s1 --> s2  " }, { q: "Plain?", a: "Yes.", diagram: "   " }], 5);
    assert.equal(cards[0].diagram, "flowchart LR\n  s1 --> s2");
    assert.ok(!("diagram" in cards[1]));
  });
});
