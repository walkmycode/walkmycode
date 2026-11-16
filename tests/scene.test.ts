// An analogy scene, as data (src/lib/scene/model.ts): what a step did, as the
// stage and the sequence diagram both see it; the new parts a professor may
// add (the words, the checker, where things go); and a ```scene block in an
// answer. The scene is the mockup's: Emily's teddy in the playroom.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHAT_RULES } from "../src/learn/lib/chat";
import { scenePrompt } from "../src/learn/lib/scene";
import { DEFAULT_PROFILE, type Lesson } from "../src/learn/lib/types";
import { SYSTEM } from "../src/lib/claude/prompts";
import { pictureKey } from "../src/lib/scene/key";
import { cleanScene, placeOf, readSceneBlock, SCENE_BLOCK, sceneEvents, sceneView, sceneWords } from "../src/lib/scene/model";

const teddy = () => ({
  title: "Emily's teddy in the playroom",
  place: "a playroom",
  language: "rust",
  watcher: { a: "the teacher", r: "the compiler", ia: "teacher", ir: "checker" },
  bin: { a: "the toy box", r: "freed memory", ia: "box", ir: "<svg onload=x>" },
  loan: { a: "lends", r: "&s1" },
  actors: [{ id: "emily", a: "Emily", r: "s1", ia: "child", ir: "drawer" }, { id: "olivia", a: "Olivia", r: "r", ia: "child" }, { id: "jack", a: "Jack", r: "s2", tint: "green" }],
  things: [{ id: "teddy", a: "the teddy", r: '"teddy"', ia: "teddy", ir: "memory" }, { id: "book", a: "a book", r: "n" }],
  code: 'let s1 = String::from("teddy");\nlet r = &s1;\nprintln!("{}", r);\nlet s2 = s1;\nprintln!("{}", s1);\ndrop(s2);',
  map: [{ a: "the teddy", r: "a value", why: "the text, kept on the heap", icon: "teddy" }, { a: "", r: "skipped" }, { a: "giving away", r: "a move" }],
  steps: [
    { line: 1, holds: { teddy: "emily" }, word: 0, made: { a: "brings", r: "String::from" }, a: "Emily brings her teddy.", r: "s1 owns the text." },
    { line: 2, holds: { teddy: "emily" }, lent: { teddy: ["olivia"] }, a: "Emily lends it to Olivia.", r: "r borrows it." },
    { line: 3, holds: { teddy: "emily" }, lent: { teddy: ["olivia"] }, note: { who: "olivia", a: "shows it round", r: "println! reads r" }, a: "Olivia shows it.", r: "r is read." },
    { line: 4, holds: { teddy: "jack" }, off: ["emily"], word: 2, verb: { a: "gives away", r: "move" }, a: "Emily gives it to Jack.", r: "The value moves to s2." },
    { line: 5, holds: { teddy: "jack" }, off: ["emily"], stop: { who: "emily", a: "Stop! Emily has no teddy.", r: "error[E0382]" }, a: "Emily reaches for it.", r: "It does not compile." },
    { line: 6, holds: { teddy: null }, off: ["emily", "olivia", "jack"], verb: { a: "tidied away", r: "drop" }, note: { who: "nobody", a: "x", r: "y" }, a: "It is tidied away.", r: "The memory is freed." },
  ],
  rule: "One owner at a time.",
  breaks: "Children can sneak it back.",
});

describe("a scene: what is kept of the parts that make it a picture", () => {
  const s = cleanScene(teddy(), "rust")!;

  it("keeps a drawing's name and a colour's only as one plain word, so nothing written can become markup", () => {
    assert.deepEqual(s.actors[0], { id: "emily", a: "Emily", r: "s1", ia: "child", ir: "drawer" });
    assert.deepEqual(s.actors[2], { id: "jack", a: "Jack", r: "s2", tint: "green" });
    assert.deepEqual(s.bin, { a: "the toy box", r: "freed memory", ia: "box", ir: "svgonloadx" });
    assert.deepEqual(s.watcher, { a: "the teacher", r: "the compiler", ia: "teacher", ir: "checker" });
    assert.deepEqual(s.loan, { a: "lends", r: "&s1" });
  });

  it("keeps each word's meaning, and points a step at its word even when an earlier one was dropped", () => {
    assert.deepEqual(s.map, [{ a: "the teddy", r: "a value", why: "the text, kept on the heap", icon: "teddy" }, { a: "giving away", r: "a move" }]);
    assert.deepEqual(s.steps.map((x) => x.word), [0, undefined, undefined, 1, undefined, undefined]);
  });

  it("keeps a step's verb, a note and a stop only for a holder the scene has", () => {
    assert.deepEqual(s.steps[3].verb, { a: "gives away", r: "move" });
    assert.deepEqual(s.steps[2].note, { who: "olivia", a: "shows it round", r: "println! reads r" });
    assert.deepEqual(s.steps[4].stop, { who: "emily", a: "Stop! Emily has no teddy.", r: "error[E0382]" });
    assert.equal(s.steps[5].note, undefined, "nobody is not in the scene");
  });

  it("leaves a scene written before any of this exactly as it was", () => {
    const old = cleanScene({ title: "t", actors: [{ id: "a", a: "Ama", r: "s1" }, { id: "b", a: "Kofi", r: "s2" }], things: [{ id: "toy", a: "the toy", r: "the text" }], code: "x\ny", steps: [{ line: 1, holds: { toy: "a" }, a: "p", r: "q" }, { line: 2, holds: { toy: "b" }, a: "p", r: "q" }], map: [{ a: "toy", r: "value" }], rule: "r", breaks: "b" }, "rust")!;
    assert.deepEqual(Object.keys(old).sort(), ["actors", "breaks", "code", "language", "map", "place", "rule", "steps", "things", "title"]);
    assert.deepEqual(old.map, [{ a: "toy", r: "value" }]);
    assert.deepEqual(Object.keys(old.steps[0]).sort(), ["a", "holds", "lent", "line", "off", "r"]);
  });
});

describe("a scene: where a thing is, step by step", () => {
  const s = cleanScene(teddy(), "rust")!;

  it("is not in the picture before anyone has had it, and gone only after someone has", () => {
    assert.equal(placeOf(s, 0, "book"), null);
    assert.equal(placeOf(s, 5, "book"), null, "the book was never held: it is not tidied away");
    assert.deepEqual(placeOf(s, 3, "teddy"), { at: "actor", id: "jack" });
    assert.deepEqual(placeOf(s, 5, "teddy"), { at: "bin" });
    assert.deepEqual(sceneView(s, 0).gone, []);
    assert.deepEqual(sceneView(s, 5).gone.map((t) => t.id), ["teddy"]);
  });
});

describe("a scene as a sequence diagram: what each step did", () => {
  const s = cleanScene(teddy(), "rust")!;
  const kinds = (n: number) => sceneEvents(s, n).map((e) => e.kind);

  it("a thing appearing is a note on its holder's lifeline, in the step's own words", () => {
    assert.deepEqual(sceneEvents(s, 0), [{ kind: "made", who: "emily", thing: s.things[0], a: "brings", r: "String::from" }]);
  });

  it("a loan is a message from the owner to the borrower, once, when it starts", () => {
    assert.deepEqual(sceneEvents(s, 1), [{ kind: "loan", from: "emily", to: "olivia", thing: s.things[0], a: "lends", r: "&s1" }]);
    assert.deepEqual(kinds(2), ["note"], "the loan goes on: no second arrow");
  });

  it("a move is a message from the old holder to the new, a drop ends on the last holder's lifeline", () => {
    assert.deepEqual(sceneEvents(s, 3), [{ kind: "move", from: "emily", to: "jack", thing: s.things[0], a: "gives away", r: "move" }]);
    assert.deepEqual(sceneEvents(s, 5), [{ kind: "end", who: "jack", thing: s.things[0], a: "tidied away", r: "drop" }]);
  });

  it("the checker's stop is a note on whoever broke the rule", () => {
    assert.deepEqual(sceneEvents(s, 4), [{ kind: "stop", who: "emily", a: "Stop! Emily has no teddy.", r: "error[E0382]" }]);
  });

  it("has words of its own when the professor gave none, for code and for a subject without it", () => {
    const bare = cleanScene({ ...teddy(), loan: undefined, bin: undefined, steps: teddy().steps.map((x) => ({ ...x, verb: undefined, made: undefined })) }, "rust")!;
    assert.deepEqual(sceneEvents(bare, 3).map((e) => [e.a, e.r]), [["hands over", "move"]]);
    assert.deepEqual(sceneEvents(bare, 0).map((e) => [e.a, e.r]), [["the teddy", '"teddy"']], "a thing appearing is simply named");
    assert.deepEqual(sceneEvents(bare, 5).map((e) => [e.a, e.r]), [["tidied away", "freed"]]);
    assert.deepEqual(sceneWords(cleanScene(teddy(), null)!).off, { a: "out of it", r: "no longer acts" });
  });
});

describe("a scene in an answer: a ```scene block", () => {
  it("is read as a scene whose real side is code, unless it says the subject has none", () => {
    const s = readSceneBlock(JSON.stringify({ ...teddy(), view: "sequence" }))!;
    assert.equal(s.language, "rust");
    assert.equal(s.plain, undefined);
    assert.equal(s.view, "sequence");
    assert.equal(readSceneBlock(JSON.stringify({ ...teddy(), language: undefined }))!.plain, undefined, "an answer about code need not name the language");
    assert.equal(readSceneBlock(JSON.stringify({ ...teddy(), language: "none" }))!.plain, true);
  });

  it("is nothing while it is still arriving, or when it is not a scene", () => {
    assert.equal(readSceneBlock('{"title": "Emily'), null);
    assert.equal(readSceneBlock("[1, 2]"), null);
    assert.equal(readSceneBlock(JSON.stringify({ title: "no one in it" })), null);
  });

  it("is taught to every model that answers: the Explore guide and the professor in conversation", () => {
    for (const prompt of [SYSTEM, CHAT_RULES]) assert.ok(prompt.includes(SCENE_BLOCK));
    assert.match(SCENE_BLOCK, /```scene/);
    assert.match(SCENE_BLOCK, /Both sides must agree at every step/);
    assert.ok(SCENE_BLOCK.length < 1_900, "it rides in every system prompt: keep it short");
  });
});

describe("Watch it happen: what the professor is asked for the picture", () => {
  const lesson: Lesson = {
    id: "L1", course: "Mastering Rust", number: 6, title: "Ownership", subject: "Ownership", summary: "s",
    boards: [{ title: "Move", kind: "talk", lines: [{ w: "a move", s: "x" }], analogy: "Giving your teddy to a friend.", example: { name: "move.rs", code: "fn main() {}", language: "rust" } }],
    createdAt: 0, updatedAt: 0, at: 0, seen: [0],
  };

  it("offers the drawings by name, and asks for the words, the checker and where things go", () => {
    const p = scenePrompt(lesson, 0, DEFAULT_PROFILE, "child, teddy, van");
    assert.match(p, /each a name from this list and nothing else: child, teddy, van\./);
    assert.match(p, /"watcher": only when someone checks the rules/);
    assert.match(p, /Include every technical term the scene uses/);
    assert.match(p, /Keep the board's own picture/);
    assert.doesNotMatch(scenePrompt(lesson, 0, DEFAULT_PROFILE), /each a name from this list/, "with no list, it is not asked to pick");
  });

  it("builds the scene in the student's own picture when they ask for one", () => {
    const p = scenePrompt(lesson, 0, DEFAULT_PROFILE, "child", "a football team passing the ball");
    assert.match(p, /The student asked for their own picture instead: "a football team passing the ball"/);
    assert.match(p, /Use the student's picture, made concrete/);
    assert.doesNotMatch(p, /Keep the board's own picture/);
  });
});

describe("a diagram's picture key: the analogy's words in its boxes", () => {
  it("reads each box named twice, the real name and then the picture's word", () => {
    const flow = "flowchart LR\n  A[s1<br/>Emily] -->|move| B[s2<br/>Jack]\n  A --> C[the text hello<br/>the teddy]";
    assert.deepEqual(pictureKey(flow), [{ real: "s1", picture: "Emily" }, { real: "s2", picture: "Jack" }, { real: "the text hello", picture: "the teddy" }]);
    assert.deepEqual(pictureKey("sequenceDiagram\n  participant b as the browser<br/>you\n  participant s as the server<br />the shop"), [{ real: "the browser", picture: "you" }, { real: "the server", picture: "the shop" }]);
  });

  it("leaves out a box whose second line is its file, as the Explore guide writes them", () => {
    assert.deepEqual(pictureKey("flowchart TD\n  A[LoginForm<br/>components/LoginForm.tsx] --> B[signIn<br/>lib/auth.ts]"), []);
  });

  it("names each word once, and holds at most what fits a line or two", () => {
    assert.equal(pictureKey("flowchart LR\n  A[s1<br/>Emily] --> B[s3<br/>emily]").length, 1);
    assert.equal(pictureKey(Array.from({ length: 20 }, (_, n) => `  N${n}[v${n}<br/>toy ${n}]`).join("\n")).length, 8);
    assert.deepEqual(pictureKey("flowchart LR\n  A --> B"), []);
  });
});
