// The shape of code as the editor draws it (mockup: docs/design/code-view.html): how far each line is
// indented, the block of lines the cursor is in, where indent guides run, how far a wrapped line
// hangs, and how deep each bracket is. Plain numbers and strings, no CodeMirror and no browser, so
// tests can load it; ./codeView.ts turns them into what the editor shows.

/** How many columns a line's leading spaces and tabs take (a tab reaches the next tab stop), or -1
 * for a blank line, which has no indent of its own. */
export function indentCols(text: string, tabSize: number): number {
  let col = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 32) col++;
    else if (c === 9) col += tabSize - (col % tabSize);
    else return col;
  }
  return -1;
}

/** Where a wrapped line goes on: under its own indentation, two columns in, so you can still see where
 * each line starts. Never more than `most` columns, so a deep line in a narrow panel keeps some room. */
export function hangCols(indent: number, most: number): number {
  return Math.max(0, Math.min(Math.max(indent, 0) + 2, Math.max(2, most)));
}

/** The file's step of indentation, in columns: the most common step in from one line to the next.
 * Steps of one column (the " *" of a block comment) are left out; 4 when there are none. */
export function indentUnitOf(indents: readonly number[]): number {
  const count = new Map<number, number>();
  let prev = 0;
  for (const ind of indents) {
    if (ind < 0) continue;
    const step = ind - prev;
    if (step >= 2 && step <= 8) count.set(step, (count.get(step) ?? 0) + 1);
    prev = ind;
  }
  let best = 4;
  let most = 0;
  for (const [step, n] of count) if (n > most || (n === most && step < best)) [best, most] = [step, n];
  return best;
}

/** A line's indent for the guides: a blank line takes the smaller indent of the lines around it, so
 * guides run straight through it. `at(i)` is a line's own indent (-1 blank), lines 0 to `count - 1`;
 * at most `reach` lines are looked at either way. */
export function shownIndent(i: number, count: number, at: (i: number) => number, reach = 400): number {
  const own = at(i);
  if (own >= 0) return own;
  let above = 0;
  for (let j = i - 1; j >= Math.max(0, i - reach); j--) {
    const v = at(j);
    if (v >= 0) {
      above = v;
      break;
    }
  }
  let below = 0;
  for (let j = i + 1; j < Math.min(count, i + reach); j++) {
    const v = at(j);
    if (v >= 0) {
      below = v;
      break;
    }
  }
  return Math.min(above, below);
}

/** The block a line is in: the nearest line above with less indent opens it (`open`), and the block runs
 * down to the next line back at that indent (`close`, or `count` when it runs to the end). Its guide is
 * at the opening line's indent (`col`). Null at the top level. Lines are counted from 0. */
export function blockAt(i: number, count: number, at: (i: number) => number, reach = 2000): { open: number; close: number; col: number } | null {
  const mine = shownIndent(i, count, at);
  if (mine <= 0) return null;
  let open = -1;
  for (let j = i - 1; j >= Math.max(0, i - reach); j--) {
    const v = at(j);
    if (v >= 0 && v < mine) {
      open = j;
      break;
    }
  }
  if (open < 0) return null;
  const col = at(open);
  let close = count;
  for (let j = i + 1; j < Math.min(count, i + reach); j++) {
    const v = at(j);
    if (v >= 0 && v <= col) {
      close = j;
      break;
    }
  }
  return { open, close, col };
}

/** One indent guide drawn down a run of lines: at column `col`, from line `from` to line `to` (both
 * in), at nesting `level` (0 for the outermost), which picks its colour. */
export interface GuideRun {
  col: number;
  level: number;
  from: number;
  to: number;
}

/** The guides down a stretch of lines, whose indents (blank lines already given theirs) are `indents`,
 * the first being line `first`: one guide for each step of indentation a line is in by, joined into
 * runs while the lines below keep it. */
export function guideRuns(indents: readonly number[], unit: number, first = 0): GuideRun[] {
  const out: GuideRun[] = [];
  const open = new Map<number, GuideRun>();
  indents.forEach((ind, k) => {
    const line = first + k;
    for (const [col, run] of open) {
      if (col >= ind) {
        out.push(run);
        open.delete(col);
      }
    }
    for (let col = 0, level = 0; col < ind; col += unit, level++) {
      const run = open.get(col);
      if (run) run.to = line;
      else open.set(col, { col, level, from: line, to: line });
    }
  });
  out.push(...open.values());
  return out.sort((a, b) => a.from - b.from || a.col - b.col);
}

/** How deep each bracket is, in order: an opening bracket is as deep as the brackets around it, and a
 * closing one as deep as the one it closes. A stray closing bracket stays at 0. `start`: how many are
 * open before the first (to carry on from an earlier stretch). */
export function bracketDepths(brackets: string, start = 0): number[] {
  const out: number[] = [];
  let depth = start;
  for (const b of brackets) {
    if (b === "(" || b === "[" || b === "{") out.push(depth++);
    else out.push((depth = Math.max(0, depth - 1)));
  }
  return out;
}

/** The brackets in `text` (from offset `base`) outside the ranges to skip (strings and comments, in
 * order and not overlapping): where each is, and which. */
export function bracketsIn(text: string, skip: readonly { from: number; to: number }[], base = 0): { pos: number; ch: string }[] {
  const out: { pos: number; ch: string }[] = [];
  let s = 0;
  for (let i = 0; i < text.length; i++) {
    const pos = base + i;
    while (s < skip.length && skip[s].to <= pos) s++;
    if (s < skip.length && skip[s].from <= pos) {
      i = skip[s].to - base - 1;
      continue;
    }
    const c = text[i];
    if (c === "(" || c === ")" || c === "[" || c === "]" || c === "{" || c === "}") out.push({ pos, ch: c });
  }
  return out;
}
