// The kinds of scene beyond the hand-over (src/lib/scene/kinds.ts): every example, as a professor would write
// it, comes through whole; anything the page could not draw, or that disagrees with itself, is dropped.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanKindScene, SCENE_KINDS, type GraphScene, type SequenceScene, type TimelineScene } from "../src/lib/scene/kinds";
import { SCENE_EXAMPLES } from "../src/lib/scene/examples";
import { DRAWING_NAMES } from "../src/lib/drawings/names";

const clean = (name: keyof typeof SCENE_EXAMPLES) => cleanKindScene(SCENE_EXAMPLES[name].raw, SCENE_EXAMPLES[name].language);
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("scene kinds: the examples", () => {
  it("cleans every example whole, one of every kind across subjects", () => {
    const kinds = new Set<string>();
    for (const name of Object.keys(SCENE_EXAMPLES) as (keyof typeof SCENE_EXAMPLES)[]) {
      const raw = SCENE_EXAMPLES[name].raw as { steps: unknown[] };
      const s = clean(name);
      assert.ok(s, `${name} cleans`);
      assert.equal(s.steps.length, raw.steps.length, `${name} keeps every step`);
      kinds.add(s.kind);
    }
    assert.deepEqual([...kinds].sort(), [...SCENE_KINDS].sort());
  });

  it("draws only drawings the set has", () => {
    const set = new Set<string>(DRAWING_NAMES);
    const names = JSON.stringify(Object.values(SCENE_EXAMPLES).map((e) => e.raw)).match(/"i[ar]":"([a-z]+)"/g) ?? [];
    for (const n of names) assert.ok(set.has(n.split(":")[1].replace(/"/g, "")), n);
  });

  it("keeps code as it was written, indentation and all", () => {
    const s = clean("callstack");
    assert.match(s?.code ?? "", /\n {4}return word\.upper\(\)/);
    assert.equal(s?.language, "python");
  });

  it("gives every headline one key word in stars", () => {
    for (const name of Object.keys(SCENE_EXAMPLES) as (keyof typeof SCENE_EXAMPLES)[]) for (const st of clean(name)!.steps) assert.equal(st.head.split("*").length, 3, `${name}: ${st.head}`);
  });
});

describe("scene kinds: what is dropped", () => {
  it("drops a scene of no known kind, or with too little to show", () => {
    assert.equal(cleanKindScene({ kind: "carousel", steps: [] }, null), null);
    assert.equal(cleanKindScene(null, null), null);
    const one = copy(SCENE_EXAMPLES.lifetimes.raw) as { steps: unknown[] };
    one.steps = one.steps.slice(0, 1);
    assert.equal(cleanKindScene(one, "rust"), null, "a scene is at least two steps");
  });

  it("drops a step that points at nothing, and keeps the rest", () => {
    const raw = copy(SCENE_EXAMPLES.blood.raw) as { steps: { at: string }[] };
    raw.steps[1].at = "the moon";
    assert.equal(cleanKindScene(raw, null)?.steps.length, 3);
  });

  it("keeps a timeline's bars inside time: none starts after now or ends before it starts", () => {
    const raw = copy(SCENE_EXAMPLES.lifetimes.raw) as { steps: { bars: Record<string, unknown> }[] };
    raw.steps[1].bars = { s: [4, null] };
    raw.steps[2].bars = { s: [2, 1] };
    const s = cleanKindScene(raw, "rust") as TimelineScene;
    assert.deepEqual(s.steps[1].bars, {});
    assert.deepEqual(s.steps[2].bars, {});
  });

  it("only joins nodes that exist, and draws a mind map's lines from what hangs from what", () => {
    const raw = copy(SCENE_EXAMPLES.law.raw) as { edges: unknown[] };
    raw.edges.push({ from: "vote", to: "nowhere" });
    assert.equal((cleanKindScene(raw, null) as GraphScene).edges.length, 9);
    const map = clean("photosynthesis") as GraphScene;
    assert.equal(map.edges.length, map.nodes.length - 1, "one line to every node but the root");
  });

  it("keeps a sequence's messages between two of its parts, and its insets on chips it has", () => {
    const raw = copy(SCENE_EXAMPLES.https.raw) as { rows: Record<string, unknown>[]; insets: Record<string, unknown>[] };
    raw.rows.push({ id: "x", from: "c", to: "c", a: "talks to herself", r: "loopback" });
    raw.insets.push({ id: "bad", side: "c", row: "m8", ins: ["unicorn"], out: "box", a: "a", r: "r" });
    const s = cleanKindScene(raw, null) as SequenceScene;
    assert.equal(s.rows.length, 12);
    assert.equal(s.insets.length, 2);
  });

  it("asks only a question with a right answer among its options", () => {
    const raw = copy(SCENE_EXAMPLES.zoo.raw) as { steps: { ask?: { right: number } }[] };
    raw.steps[2].ask!.right = 5;
    assert.equal(cleanKindScene(raw, "python")?.steps[2].ask, undefined);
  });

  it("drops a line number the code does not have, and a fact the scene does not list", () => {
    const raw = copy(SCENE_EXAMPLES.callstack.raw) as { steps: { line: number }[] };
    raw.steps[0].line = 99;
    assert.equal(cleanKindScene(raw, "python")?.steps[0].line, undefined);
    const b = copy(SCENE_EXAMPLES.blood.raw) as { steps: { facts: number[] }[] };
    b.steps[0].facts = [42];
    assert.equal(cleanKindScene(b, null)?.steps[0].facts, undefined);
  });

  it("puts the key word in stars when the professor forgot, and keeps just one", () => {
    const raw = copy(SCENE_EXAMPLES.interest.raw) as { steps: { head: string }[] };
    raw.steps[0].head = "Both start level";
    raw.steps[1].head = "*Two* keys *here*";
    const s = cleanKindScene(raw, null)!;
    assert.equal(s.steps[0].head, "Both start *level*");
    assert.equal(s.steps[1].head, "*Two* keys here");
  });
});
