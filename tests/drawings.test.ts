// The drawings an analogy scene is made of (src/lib/drawings): every one is
// plain shapes in the stylesheet's own colours, small, and findable by the
// everyday words a professor or a guide would use for it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { drawingNames, drawingOf, DRAWINGS, findDrawing, isTint, LOOKS, words } from "../src/lib/drawings";
import { DRAWING_LIST, DRAWING_NAMES } from "../src/lib/drawings/names";

const css = readFileSync("src/lib/drawings/drawings.css", "utf8");
const names = Object.keys(DRAWINGS);

describe("drawings: the set", () => {
  it("is big enough for any subject, and small enough to cost nothing", () => {
    assert.ok(names.length >= 320, `${names.length} drawings`);
    const bytes = names.reduce((n, k) => n + DRAWINGS[k].svg.length, 0);
    assert.ok(bytes < 260_000, `${bytes} bytes in all`);
    for (const k of names) assert.ok(DRAWINGS[k].svg.length <= 1500, `${k} is ${DRAWINGS[k].svg.length} bytes`);
  });

  it("is plain shapes only: nothing that loads, runs, or sets its own colour", () => {
    for (const k of names) {
      assert.doesNotMatch(DRAWINGS[k].svg, /style=|<text|<image|<use|<script|<foreignObject|gradient|filter|href|url\(|\son\w+=|fill=|stroke=/i, k);
      assert.match(DRAWINGS[k].svg, /^(<(path|rect|circle|ellipse|g)\b[^<>]*\/?>|<\/g>)+$/, `${k} holds only path, rect, circle, ellipse and g`);
    }
  });

  it("takes every colour from the stylesheet, so a scene can recolour a drawing and both themes can show it", () => {
    for (const k of names) for (const m of DRAWINGS[k].svg.matchAll(/class="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) assert.ok(new RegExp(`\\.${c}\\b`).test(css), `${k} uses .${c}, which drawings.css does not have`);
  });

  it("has names a model can pick: one lower-case word each, with other words it can stand for and a colour", () => {
    for (const k of names) {
      assert.match(k, /^[a-z]+$/, k);
      assert.ok(DRAWINGS[k].also.length >= 3, `${k} needs other words`);
      assert.match(DRAWINGS[k].tint, /^#[0-9a-f]{6}$/i, k);
    }
    assert.equal(drawingNames().split(", ").length, names.length);
  });

  it("tells a model the same names, without carrying the drawings to do it", () => {
    assert.deepEqual([...DRAWING_NAMES], names, "src/lib/drawings/names.ts lists the set's names, in order");
    assert.ok(DRAWING_LIST.includes(names.join(", ")));
    assert.ok(DRAWING_LIST.length < 3_600);
  });

  it("draws every person with a glad face and a sad one, and has looks to tell them apart", () => {
    const people = names.filter((k) => DRAWINGS[k].person);
    assert.ok(people.length >= 10);
    for (const k of people) {
      assert.match(DRAWINGS[k].svg, /class="[^"]*\bsmile\b/, k);
      assert.match(DRAWINGS[k].svg, /class="[^"]*\bfrown\b/, k);
    }
    assert.ok(new Set(LOOKS.map((l) => l.tint + l.skin + l.hair + l.v)).size === LOOKS.length);
  });
});

describe("drawings: how a label finds one", () => {
  it("takes a name the set has, whatever the label says", () => {
    assert.equal(findDrawing("teddy", "Emily"), "teddy");
    assert.equal(findDrawing("van"), "van");
  });

  it("finds one from the everyday label when no name is given, or the name is not in the set", () => {
    assert.equal(findDrawing(undefined, "the postman"), "van");
    assert.equal(findDrawing("unicorn", "a pigeonhole"), "drawer");
    assert.equal(findDrawing(undefined, "the order letter"), "letter", "the last word is the thing");
    assert.equal(findDrawing(undefined, "The Teachers"), "teacher", "capitals and plurals do not matter");
    assert.equal(findDrawing(undefined, "the compiler"), "checker");
    assert.equal(findDrawing(undefined, '"hello" on the heap'), "memory");
  });

  it("reads a label for the thing itself, not for where it is or what it has", () => {
    assert.equal(findDrawing(undefined, "a child at the door"), "child");
    assert.equal(findDrawing(undefined, "the guard at inner doors"), "guard");
    assert.equal(findDrawing(undefined, "a note with name and secret word"), findDrawing(undefined, "a note"));
    assert.equal(findDrawing(undefined, "the door keeper"), "guard");
    assert.equal(findDrawing(undefined, "the front of the queue"), "queue", "when what comes first is not in the set, the rest is still read");
  });

  it("gives a drawing's own name before another drawing's other words", () => {
    assert.equal(findDrawing(undefined, "the server"), "server");
    assert.equal(findDrawing(undefined, "a key"), "key");
    assert.equal(findDrawing(undefined, "the queue"), "queue");
  });

  it("finds drawings across subjects", () => {
    for (const [label, name] of [["the heart", "heart"], ["a bank", "bank"], ["the king", "king"], ["a water drop", "drop"], ["a database", "database"], ["the doctor", "doctor"], ["a magnet", "magnet"], ["the scales", "scales"]] as const) assert.equal(findDrawing(undefined, label), name, label);
  });

  it("finds system design and software engineering by their usual names", () => {
    for (const [label, name] of [["a load balancer", "loadbalancer"], ["the API gateway", "gateway"], ["a docker container", "container"], ["the message broker", "broker"], ["the cache", "cache"], ["the DNS", "dns"], ["a firewall", "firewall"],
      ["the terminal", "terminal"], ["a linked list", "linkedlist"], ["a hash map", "hashmap"], ["a binary tree", "binarytree"], ["a pull request", "pullrequest"], ["the CI pipeline", "conveyor"], ["recursion", "dolls"], ["a keyboard", "keyboard"], ["a bank card", "card"]] as const)
      assert.equal(findDrawing(undefined, label), name, label);
  });

  it("finds the other subjects a lesson can be about, and the people in them", () => {
    for (const [label, name] of [["a microscope", "microscope"], ["the virus", "virus"], ["a kidney", "kidney"], ["a ballot box", "ballot"], ["the parliament", "parliament"], ["a handshake", "handshake"], ["the ladder", "ladder"],
      ["a guitar", "guitar"], ["a speech bubble", "speech"], ["a police officer", "police"], ["a judge", "judge"], ["the astronaut", "astronaut"]] as const)
      assert.equal(findDrawing(undefined, label), name, label);
  });

  it("finds nothing rather than something wrong", () => {
    assert.equal(findDrawing(undefined, "Emily"), null);
    assert.equal(findDrawing(undefined, "s1"), null);
    assert.equal(findDrawing(undefined, ""), null);
    assert.equal(findDrawing("constructor", "toString"), null, "a name is looked up in the set, not on the object");
    assert.equal(drawingOf("constructor"), null);
  });

  it("reads a label as its words", () => {
    assert.deepEqual(words("The order-letters of the Shop!"), ["order", "letter", "shop"]);
  });

  it("takes a colour only by name", () => {
    assert.ok(isTint("green"));
    assert.ok(!isTint("#fff"));
    assert.ok(!isTint("constructor"));
  });
});
