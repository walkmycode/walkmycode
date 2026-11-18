// How the editor draws code (src/ide/codeShape.ts, docs/design/code-view.html): indents, the block the
// cursor is in, the guides, a wrapped line's hanging indent, bracket depth; and when the editor scrolls
// to its highlight (src/ide/litScroll.ts). Plain numbers and strings, no browser.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blockAt, bracketDepths, bracketsIn, guideRuns, hangCols, indentCols, indentUnitOf, shownIndent } from "../src/ide/codeShape";
import { litScrollDue } from "../src/ide/litScroll";

// TaskCard.tsx from Team Tasks, as the mockup shows it (lines from 0 here).
const CARD = `export default function TaskCard({ task }: { task: TaskRow }) {
  async function toggle() {
    await fetch(\`/api/tasks/\${task.id}\`, {
      method: "PATCH",
    });
    onChange();
  }

  return (
    <div className="card">
      {task.title}
    </div>
  );
}`.split("\n");
const ind = CARD.map((l) => indentCols(l, 4));
const at = (i: number) => ind[i];

describe("indents", () => {
  it("counts a line's leading spaces, a tab to the next tab stop, and calls a blank line blank", () => {
    assert.equal(indentCols("    x", 4), 4);
    assert.equal(indentCols("\tx", 4), 4);
    assert.equal(indentCols("  \tx", 4), 4, "a tab after two spaces reaches column 4");
    assert.equal(indentCols("\t\tx", 2), 4);
    assert.equal(indentCols("x", 4), 0);
    assert.equal(indentCols("", 4), -1);
    assert.equal(indentCols("   ", 4), -1, "only spaces is blank too");
  });

  it("finds the file's step of indentation, leaving out a block comment's one-column step", () => {
    assert.equal(indentUnitOf(ind), 2);
    assert.equal(indentUnitOf([0, 4, 8, 4, 0, 4]), 4);
    assert.equal(indentUnitOf([0, 1, 1, 1, 0, 2, 4, 2]), 2, '" *" lines don\'t make it 1');
    assert.equal(indentUnitOf([0, 0, -1, 0]), 4, "nothing indented: 4");
  });

  it("gives a blank line the smaller indent of the lines around it, so guides run through it", () => {
    assert.equal(ind[7], -1);
    assert.equal(shownIndent(7, ind.length, at), 2, "between `}` (2) and `return (` (2)");
    assert.equal(shownIndent(0, 3, (i) => [-1, 4, 8][i]), 0, "nothing above: the top level");
    assert.equal(shownIndent(1, 3, (i) => [8, -1, 4][i]), 4);
  });
});

describe("the block the cursor is in", () => {
  it("runs from the nearest line above with less indent to the next line back at that indent", () => {
    // `method: "PATCH",` (line 3) is in the fetch call's object, opened by line 2 at column 4.
    assert.deepEqual(blockAt(3, ind.length, at), { open: 2, close: 4, col: 4 });
    // `onChange();` (line 5) is in toggle(), opened by line 1 at column 2, closed by line 6.
    assert.deepEqual(blockAt(5, ind.length, at), { open: 1, close: 6, col: 2 });
    // `return (` is in the component: the whole body, closed by the last line.
    assert.deepEqual(blockAt(8, ind.length, at), { open: 0, close: 13, col: 0 });
  });

  it("puts a blank line in the block its neighbours are in, and has no block at the top level", () => {
    assert.deepEqual(blockAt(7, ind.length, at), { open: 0, close: 13, col: 0 });
    assert.equal(blockAt(0, ind.length, at), null);
    assert.equal(blockAt(13, ind.length, at), null);
  });

  it("runs to the end of the file when nothing closes it", () => {
    const open = [0, 4, 4];
    assert.deepEqual(blockAt(2, 3, (i) => open[i]), { open: 0, close: 3, col: 0 });
  });
});

describe("indent guides", () => {
  it("draws one guide per step a line is in by, joined down the lines that keep it, a level each", () => {
    const shown = ind.map((_, i) => shownIndent(i, ind.length, at));
    const runs = guideRuns(shown, 2);
    // Column 0 runs down the whole body (lines 1 to 12), blank line 7 included.
    assert.deepEqual(runs[0], { col: 0, level: 0, from: 1, to: 12 });
    const col2 = runs.filter((r) => r.col === 2).map((r) => [r.from, r.to]);
    assert.deepEqual(col2, [[2, 5], [9, 11]], "inside toggle() and inside return ( )");
    assert.deepEqual(runs.filter((r) => r.col === 4).map((r) => [r.from, r.to, r.level]), [[3, 3, 2], [10, 10, 2]]);
    assert.ok(runs.every((r) => r.level === r.col / 2));
  });

  it("starts its line numbers where the stretch of lines starts", () => {
    assert.deepEqual(guideRuns([4, 4], 4, 100), [{ col: 0, level: 0, from: 100, to: 101 }]);
    assert.deepEqual(guideRuns([0, 0], 4), []);
  });
});

describe("neat wrapping", () => {
  it("carries a wrapped line on under its own indentation, two columns in", () => {
    assert.equal(hangCols(0, 40), 2);
    assert.equal(hangCols(6, 40), 8);
    assert.equal(hangCols(-1, 40), 2, "a blank line");
  });

  it("never hangs more than it is allowed, so a deep line in a narrow panel keeps some room", () => {
    assert.equal(hangCols(30, 20), 20);
    assert.equal(hangCols(30, 0), 2, "too narrow to know: two columns");
  });
});

describe("coloured brackets", () => {
  it("gives each bracket its depth: an opener as deep as the brackets around it, a closer as the one it closes", () => {
    assert.deepEqual(bracketDepths("({[]})"), [0, 1, 2, 2, 1, 0]);
    assert.deepEqual(bracketDepths("()()"), [0, 0, 0, 0]);
    assert.deepEqual(bracketDepths("))("), [0, 0, 0], "stray closers stay at 0");
    assert.deepEqual(bracketDepths(")(", 2), [1, 1], "carrying on with two open from an earlier stretch");
    assert.deepEqual([...bracketDepths("({"), ...bracketDepths("})", 2)], bracketDepths("({})"), "in two stretches as in one");
  });

  it("leaves out brackets inside strings and comments", () => {
    const text = 'f("(", x) // )\ng[1]';
    const str = text.indexOf('"(');
    const cm = text.indexOf("//");
    const found = bracketsIn(text, [{ from: str, to: str + 3 }, { from: cm, to: text.indexOf("\n") }]);
    assert.deepEqual(found.map((b) => b.ch).join(""), "()[]");
    assert.deepEqual(found.map((b) => b.pos), [1, 8, 16, 18]);
    assert.deepEqual(bracketDepths(found.map((b) => b.ch).join("")), [0, 0, 0, 0]);
    assert.deepEqual(bracketsIn("(a)", [], 10).map((b) => b.pos), [10, 12], "positions from where the text starts");
  });
});

describe("scrolling to the highlight", () => {
  it("scrolls for a new highlight or new text from outside, never for typing", () => {
    assert.equal(litScrollDue("12-14", "", false), true, "a new highlight");
    assert.equal(litScrollDue("12-14", "12-14", false), false, "the user typed: stay where they are");
    assert.equal(litScrollDue("12-14", "12-14", true), true, "the file's text arrived after the highlight");
    assert.equal(litScrollDue("", "12-14", false), true, "the highlight went: cleared once");
  });
});
