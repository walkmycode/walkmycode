// Variety in the professor's pictures (src/learn/lib/worlds.ts): the worlds offered for a lesson, a scene or an
// answer are picked from a broad pool with a seed (so a reload gives the same ones), the course's earlier pictures
// are named so they are not used again, and no prompt carries the old examples that made every analogy a bakery.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHAT_RULES, chatTurns } from "../src/learn/lib/chat";
import { readLesson } from "../src/learn/lib/courseFolder";
import { ANALOGY_RULES, DIAGRAM_RULES, folderLessonPrompt, lessonPrompt, PERSONA, TEACHING } from "../src/learn/lib/professor";
import { scenePrompt } from "../src/learn/lib/scene";
import { DEFAULT_PROFILE, type Lesson } from "../src/learn/lib/types";
import { NAMES, NOTHING_USED, pickNames, pickWorlds, usedPictures, varietyNote, WORLDS } from "../src/learn/lib/worlds";
import { DRAWING_LIST, DRAWING_NAMES } from "../src/lib/drawings/names";
import { KINDS_BRIEF, KINDS_GUIDE } from "../src/lib/scene/kinds";
import { PROFESSOR_PERSONA } from "../src/lib/voice/agentSettings";

const lesson = (o: Partial<Lesson> = {}): Lesson => ({
  id: "l2", course: "Rust", number: 2, title: "Variables", subject: "Variables", summary: "You can name a value.",
  createdAt: 2, updatedAt: 2, at: 0, seen: [0],
  boards: [
    { title: "A name for a value", kind: "talk", lines: [{ w: "`let x = 5;`", s: "Let x be five." }], analogy: "A variable is a name on a peg." },
    { title: "Change it", kind: "talk", lines: [{ w: "`let mut x`", s: "Mut lets it change." }], analogy: "A mutable variable is a whiteboard." },
  ],
  ...o,
});

// The owner's own lesson that started this: the bakery, its cake, Emily and Jack.
const bakery = lesson({
  id: "l1", number: 1, title: "Hello, World",
  boards: [{
    title: "Emily, the baker and the cake", kind: "talk", lines: [{ w: "`main.rs`", s: "x" }],
    analogy: "main.rs is the recipe card, rustc is the baker, and the program is the cake.",
    scene: { title: "Emily bakes the cake", place: "A little bakery on a British high street", actors: [{ id: "emily", a: "Emily", r: "rustc" }, { id: "jack", a: "Jack", r: "you" }], things: [], steps: [], map: [], rule: "", breaks: "" } as never,
  }],
});
const tuckShop = lesson({ id: "l0", number: 3, title: "Payments", boards: [{ title: "Pay", kind: "talk", lines: [{ w: "x", s: "x" }], analogy: "A payment gateway is the till at a school tuck shop in Leeds." }] });

const OLD_ANCHORS = /bakery|\bbaker\b|\bcakes?\b|Emily|\bJack\b|baker \*refuses|the toy is the value|a kitchen, a bus|corner shop|London bus/;

describe("the worlds a picture is set in", () => {
  it("offers a broad pool, each world with things the scenes can draw", () => {
    const fresh = WORLDS.filter((w) => !w.worn);
    assert.ok(fresh.length >= 20, `only ${fresh.length} worlds`);
    for (const w of WORLDS) for (const t of w.things) assert.ok((DRAWING_NAMES as readonly string[]).includes(t), `${w.id}: no drawing called ${t}`);
    assert.equal(new Set(WORLDS.map((w) => w.id)).size, WORLDS.length);
    assert.ok(NAMES.length >= 20 && !NAMES.includes("Emily") && !NAMES.includes("Jack"));
  });

  it("picks the same worlds for the same seed, and different ones across boards and lessons", () => {
    assert.deepEqual(pickWorlds("l2:0"), pickWorlds("l2:0"));
    assert.equal(pickWorlds("l2:0").length, 3);
    const boards = new Set(Array.from({ length: 8 }, (_, i) => pickWorlds(`l2:${i}`)[0].id));
    const lessons = new Set(Array.from({ length: 8 }, (_, i) => pickWorlds(`Rust#${i + 1}:topic`)[0].id));
    assert.ok(boards.size >= 4, `boards share worlds: ${[...boards]}`);
    assert.ok(lessons.size >= 4, `lessons share worlds: ${[...lessons]}`);
    assert.deepEqual(pickNames("l2:0"), pickNames("l2:0"));
    assert.ok(new Set(Array.from({ length: 8 }, (_, i) => pickNames(`l2:${i}`, 1)[0])).size >= 4);
  });

  it("never offers a worn-out world, nor one the course has used", () => {
    for (let i = 0; i < 40; i++) {
      const got = pickWorlds(`s${i}`, 3, ["football", "music"]);
      assert.ok(got.every((w) => !w.worn && w.id !== "football" && w.id !== "music"));
    }
    assert.ok(pickNames("x", 2, ["Priya", "Tomasz"]).every((n) => n !== "Priya" && n !== "Tomasz"));
  });

  it("reads what a course has pictured from its analogies and scenes", () => {
    const used = usedPictures([bakery, tuckShop]);
    assert.ok(used.worlds.includes("bakery") && used.worlds.includes("shop"));
    assert.deepEqual(used.places, ["A little bakery on a British high street"]);
    assert.deepEqual(used.names.sort(), ["Emily", "Jack"]);
    assert.deepEqual(usedPictures([]), NOTHING_USED);
    // Only the most recent lessons count.
    assert.deepEqual(usedPictures([bakery, tuckShop], 1).places, []);
  });
});

describe("the prompts ask for fresh pictures", () => {
  const earlier = [bakery, tuckShop];
  const ask = { topic: "Variables", course: "Rust", level: "Beginner", boards: 8, notes: "" };

  it("names the course's earlier pictures in the lesson writer's prompt, not to be used again", () => {
    const p = lessonPrompt(ask, DEFAULT_PROFILE, earlier);
    assert.match(p, /Already used in this course, so not these again: worlds: a shop or tuck shop; a bakery, baking and cakes\. places: A little bakery on a British high street\. names: (Emily, Jack|Jack, Emily)\./);
    assert.match(p, /Choose the lesson's big picture from one of these worlds/);
    for (const w of pickWorlds("Rust#3:Variables", 3, ["bakery", "shop"])) assert.ok(p.includes(w.name), w.name);
    assert.equal(p, lessonPrompt(ask, DEFAULT_PROFILE, earlier), "the same lesson asks the same way on every try");
    assert.doesNotMatch(lessonPrompt(ask, DEFAULT_PROFILE, []), /Already used in this course/);
    const fromFolder = folderLessonPrompt(readLesson("01/02_variables", { "README.md": "# Variables\n\n## Let\n" }), "Rust", DEFAULT_PROFILE, earlier);
    assert.match(fromFolder, /Where the author gives no picture of their own:\n {2}- Choose/);
    assert.match(fromFolder, /not these again: worlds: a shop or tuck shop; a bakery/);
  });

  it("names them in a scene's prompt and in a conversation's, and varies the people's names by board", () => {
    const used = usedPictures(earlier);
    const scene = scenePrompt(lesson(), 0, DEFAULT_PROFILE, "child, parcel", "", used);
    assert.match(scene, /not these again: worlds: a shop or tuck shop; a bakery, baking and cakes/);
    assert.match(scene, /If the board's picture already names its people, keep those names; otherwise call them \w+ and \w+\./);
    assert.equal(scene, scenePrompt(lesson(), 0, DEFAULT_PROFILE, "child, parcel", "", used));
    assert.notEqual(varietyNote("l2:0", used, "scene"), varietyNote("l2:1", used, "scene"));
    const chat = chatTurns(lesson(), DEFAULT_PROFILE, [{ id: "q", role: "you", text: "Explain it like I'm 10", at: 1, board: 1 }], { board: 1 }, used)[0].content;
    assert.match(chat, /When you need a new 💡 picture, take it from one of these worlds/);
    assert.match(chat, /not these again: worlds: a shop or tuck shop; a bakery, baking and cakes/);
  });

  it("carries none of the old examples that anchored every picture to a bakery and Emily", () => {
    const fresh = [
      PERSONA, ANALOGY_RULES, DIAGRAM_RULES, TEACHING, CHAT_RULES, KINDS_GUIDE, KINDS_BRIEF, PROFESSOR_PERSONA,
      lessonPrompt(ask, DEFAULT_PROFILE, []),
      folderLessonPrompt(readLesson("01/02_variables", { "README.md": "# Variables\n\n## Let\n" }), "Rust", DEFAULT_PROFILE, []),
      scenePrompt(lesson(), 0, DEFAULT_PROFILE, "child, parcel"),
      chatTurns(lesson(), DEFAULT_PROFILE, [{ id: "q", role: "you", text: "Why?", at: 1, board: 0 }], { board: 0 })[0].content,
    ];
    // The list of drawings names a cake among three hundred things; it offers, it does not anchor.
    for (const p of fresh) assert.doesNotMatch(p.replace(DRAWING_LIST, ""), OLD_ANCHORS);
  });
});
