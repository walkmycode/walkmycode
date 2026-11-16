// A diagram with its analogy drawn in (src/lib/scene/diagram.ts): what is kept
// of what a model writes, which row each box sits in, and what a line says.
// And a drawing a model makes itself (model.ts, cleanShapes): numbers and
// names only, kept inside the square.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHAT_RULES } from "../src/learn/lib/chat";
import { scenePrompt } from "../src/learn/lib/scene";
import { DEFAULT_PROFILE, type Lesson } from "../src/learn/lib/types";
import { SYSTEM } from "../src/lib/claude/prompts";
import { cleanPicture, linkLine, PICTURE_BLOCK, readPictureBlock, rowsOf } from "../src/lib/scene/diagram";
import { cleanScene, cleanShapes, MAX_SHAPES } from "../src/lib/scene/model";

const zoo = () => ({
  title: "Animals at the zoo",
  kind: "class",
  nodes: [
    { id: "Animal", a: "any animal", r: "Animal", rows: ["name: String", "eat()", "", 7] },
    { id: "dog", a: "a dog", r: "Dog", ia: "dog" },
    { id: "cat", a: "a cat", r: "Cat", tint: "grey" },
    { id: "keeper", a: "the keeper", r: "Zoo", draw: [{ s: "circle", x: 32, y: 32, r: 20, c: "green" }] },
    { id: "dog", a: "a second dog", r: "Dog2" },
    { id: "ghost", a: "", r: "Nothing" },
  ],
  links: [
    { from: "dog", to: "animal", kind: "is" },
    { from: "cat", to: "animal", kind: "is", a: "is a kind of", r: "extends" },
    { from: "keeper", to: "animal", kind: "has", a: "looks after", r: "owns", ends: ["1", "many"] },
    { from: "dog", to: "dog" },
    { from: "dog", to: "nowhere" },
    { from: "keeper", to: "dog" },
  ],
  rule: "A dog is an animal.",
  breaks: "Real animals do not inherit code.",
});

describe("a picture diagram: what is kept of what a model writes", () => {
  const p = cleanPicture(zoo())!;

  it("keeps each box once, with its two names, its drawing and what it holds", () => {
    assert.deepEqual(p.nodes.map((n) => n.id), ["animal", "dog", "cat", "keeper"], "ids are made plain; a second dog and a box with one name are dropped");
    assert.deepEqual(p.nodes[0], { id: "animal", a: "any animal", r: "Animal", rows: ["name: String", "eat()"] });
    assert.deepEqual(p.nodes[1], { id: "dog", a: "a dog", r: "Dog", ia: "dog" });
    assert.deepEqual(p.nodes[2].tint, "grey");
    assert.deepEqual(p.nodes[3].draw, [{ s: "circle", x: 32, y: 32, r: 20, c: "green" }]);
  });

  it("keeps a line only between two boxes it has, and gives a line with no kind the diagram's usual one", () => {
    assert.deepEqual(p.links.map((l) => `${l.from}>${l.to}:${l.kind}`), ["dog>animal:is", "cat>animal:is", "keeper>animal:has", "keeper>dog:uses"]);
    assert.deepEqual(p.links[2], { from: "keeper", to: "animal", kind: "has", a: "looks after", r: "owns", ends: ["1", "many"] });
    assert.equal(cleanPicture({ ...zoo(), kind: "flow" })!.links.at(-1)!.kind, "then");
    assert.equal(cleanPicture({ ...zoo(), kind: "er" })!.links.at(-1)!.kind, "has");
  });

  it("refuses what the page could not draw", () => {
    assert.equal(cleanPicture(null), null);
    assert.equal(cleanPicture({ ...zoo(), nodes: [zoo().nodes[0]] }), null, "one box is no diagram");
    assert.equal(cleanPicture({ ...zoo(), links: [] }), null, "boxes with nothing joining them are no diagram");
    assert.equal(readPictureBlock('{"title": "Anim'), null, "a block still arriving");
    assert.equal(readPictureBlock(JSON.stringify(zoo()))!.kind, "class");
  });

  it("holds at most what fits the screen", () => {
    const many = { kind: "flow", nodes: Array.from({ length: 30 }, (_, n) => ({ id: `n${n}`, a: `step ${n}`, r: `s${n}` })), links: Array.from({ length: 40 }, (_, n) => ({ from: `n${n % 12}`, to: `n${(n + 1) % 12}` })) };
    const big = cleanPicture(many)!;
    assert.equal(big.nodes.length, 12);
    assert.equal(big.links.length, 18);
  });
});

describe("a picture diagram: which row each box sits in", () => {
  it("puts the general thing above the particular one, and an owner above what it owns", () => {
    assert.deepEqual(rowsOf(cleanPicture(zoo())!), [["keeper"], ["animal"], ["dog", "cat"]]);
  });

  it("reads a flow downwards, a box one row below the lowest box that leads to it", () => {
    const flow = cleanPicture({ kind: "flow", nodes: ["a", "b", "c", "d"].map((id) => ({ id, a: id, r: id })), links: [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "d" }, { from: "c", to: "d" }, { from: "a", to: "d" }] })!;
    assert.deepEqual(rowsOf(flow), [["a"], ["b", "c"], ["d"]]);
  });

  it("draws a loop without letting it move the boxes or run for ever", () => {
    const loop = cleanPicture({ kind: "state", nodes: ["idle", "busy", "done"].map((id) => ({ id, a: id, r: id })), links: [{ from: "idle", to: "busy" }, { from: "busy", to: "done" }, { from: "done", to: "idle" }] })!;
    assert.deepEqual(rowsOf(loop), [["idle"], ["busy"], ["done"]]);
    assert.equal(loop.links.length, 3, "the line back is still drawn");
  });

  it("orders a row by the boxes above it, so lines cross less", () => {
    const p = cleanPicture({ kind: "flow", nodes: ["l", "r", "x", "y"].map((id) => ({ id, a: id, r: id })), links: [{ from: "l", to: "y" }, { from: "r", to: "x" }] })!;
    assert.deepEqual(rowsOf(p), [["l", "r"], ["y", "x"]], "y hangs under l and x under r, whatever order they were written in");
  });

  it("places every box exactly once", () => {
    const rows = rowsOf(cleanPicture(zoo())!);
    assert.deepEqual(rows.flat().sort(), ["animal", "cat", "dog", "keeper"]);
  });
});

describe("a picture diagram: what a line says", () => {
  const p = cleanPicture(zoo())!;

  it("says it in the picture and for real, in the line's own words or the kind's", () => {
    assert.deepEqual(linkLine(p, p.links[1]), { a: "a cat is a kind of any animal", r: "Cat extends Animal" });
    assert.deepEqual(linkLine(p, p.links[0]), { a: "a dog is a kind of any animal", r: "Dog is a kind of Animal" });
    assert.deepEqual(linkLine(p, p.links[3]), { a: "the keeper uses a dog", r: "Zoo uses Dog" });
  });

  it("is taught to every model that answers", () => {
    for (const prompt of [SYSTEM, CHAT_RULES]) assert.ok(prompt.includes(PICTURE_BLOCK));
    assert.match(PICTURE_BLOCK, /```picture/);
    assert.ok(PICTURE_BLOCK.length < 1_100, "it rides in every system prompt: keep it short");
  });
});

describe("a drawing a model makes itself: plain shapes, kept inside the square", () => {
  it("keeps the five shapes, with numbers rounded and a colour by name", () => {
    assert.deepEqual(
      cleanShapes([
        { s: "circle", x: 32.123, y: 30, r: 14, c: "yellow" },
        { s: "rect", x: 10, y: 20, w: 44, h: 30, rx: 4, c: "t" },
        { s: "ellipse", x: 32, y: 40, rx: 20, ry: 10, c: "blue" },
        { s: "line", x1: 10, y1: 50, x2: 54, y2: 50, c: "ink" },
        { s: "poly", p: [32, 8, 54, 50, 10, 50], c: "red" },
      ]),
      [
        { s: "circle", x: 32.1, y: 30, r: 14, c: "yellow" },
        { s: "rect", x: 10, y: 20, w: 44, h: 30, rx: 4, c: "t" },
        { s: "ellipse", x: 32, y: 40, rx: 20, ry: 10, c: "blue" },
        { s: "line", x1: 10, y1: 50, x2: 54, y2: 50, c: "ink" },
        { s: "poly", p: [32, 8, 54, 50, 10, 50], c: "red" },
      ],
    );
  });

  it("keeps nothing that is not a number or a known name, so nothing written can become markup", () => {
    assert.deepEqual(cleanShapes([{ s: "circle", x: 500, y: -20, r: 900, c: "url(#x)" }]), [{ s: "circle", x: 64, y: 0, r: 40, c: "t" }], "out of the square is brought in; an unknown colour is the thing's own");
    assert.equal(cleanShapes([{ s: "script", x: 1 }, { s: "circle", x: "<svg>", y: 1, r: 1 }, { s: "poly", p: [1, 2, 3] }, { s: "poly", p: [1, 2, 3, "4", 5, 6] }, null, "circle"]), null);
    assert.equal(cleanShapes("circle"), null);
    assert.equal(cleanShapes(Array.from({ length: 40 }, () => ({ s: "circle", x: 1, y: 1, r: 1, c: "t" })))!.length, MAX_SHAPES);
  });

  it("travels with a scene's holders, things, checker, bin and words", () => {
    const dot = [{ s: "circle", x: 32, y: 32, r: 10, c: "pink" }];
    const s = cleanScene(
      {
        title: "t", actors: [{ id: "a", a: "Ama", r: "s1" }, { id: "b", a: "Kofi", r: "s2" }], things: [{ id: "kite", a: "the kite", r: "the value", draw: dot }],
        code: "x\ny", watcher: { a: "the umpire", r: "the checker", draw: dot }, bin: { a: "the shed", r: "freed", draw: dot }, map: [{ a: "the kite", r: "a value", draw: dot }],
        steps: [{ line: 1, holds: { kite: "a" }, a: "p", r: "q" }, { line: 2, holds: { kite: "b" }, a: "p", r: "q" }], rule: "r", breaks: "b",
      },
      "rust",
    )!;
    for (const part of [s.things[0], s.watcher, s.bin, s.map[0]]) assert.deepEqual(part?.draw, dot);
    assert.equal(s.actors[0].draw, undefined);
  });

  it("is offered to the professor only as a last resort, after the drawings by name", () => {
    const lesson: Lesson = { id: "L", course: "c", number: 1, title: "t", subject: "s", summary: "s", boards: [{ title: "b", kind: "talk", lines: [{ w: "w", s: "s" }], analogy: "A kite on a string." }], createdAt: 0, updatedAt: 0, at: 0, seen: [0] };
    const p = scenePrompt(lesson, 0, DEFAULT_PROFILE, "child, teddy");
    assert.match(p, /Only when nothing on the list fits a holder or a thing in the picture, leave out its "ia" and draw it yourself with "draw"/);
    assert.ok(p.indexOf("each a name from this list") < p.indexOf('draw it yourself with "draw"'));
    assert.doesNotMatch(scenePrompt(lesson, 0, DEFAULT_PROFILE), /draw it yourself/);
  });
});
