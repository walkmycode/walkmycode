// Line history in the editor (mockup: docs/design/git-history.html): the blocks of lines git blame
// gives (src/ide/localrun/git/blameMarks.ts makes them), and what the editor shows from them:
//
// - the faint note at the end of the line the cursor is on: "Kofi Mensah, 2 Nov 2026 09:14 · Run on
//   start", and beside it "How did this line get here?", which opens the line's own history (./localrun/
//   git/LineStory.tsx) when the editor is given somewhere to open it;
// - the same details in a box when the pointer rests on a line, or a line is clicked;
// - the Blame gutter beside the line numbers, when the user asks for it.
//
// Every line keeps its own history while the file is edited: CodeMirror's changes carry each line's
// blame to where the line went, and a line added or changed since the file was saved says so
// ("Changed, not saved") instead of naming whoever last committed the line that was there. Undo back
// to the saved text, and every line has its own history again. Plain CodeMirror, no React, so tests
// can load it.
import { Facet, StateEffect, StateField, type ChangeDesc, type EditorState, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, ViewPlugin, WidgetType, gutter, hoverTooltip, keymap, showTooltip, type Tooltip } from "@codemirror/view";

/** One block of lines one commit last changed, as the editor shows it. */
export interface BlameMark {
  /** Its first line, from 1, and how many lines. */
  start: number;
  lines: number;
  /** "Ama Owusu", "You", "Not committed". */
  who: string;
  /** "2 Nov", " 2026" and "09:14": the year is left out where the editor is narrow. */
  when: { day: string; year: string; time: string } | string;
  /** The gutter's hover: full date, how long ago, the message, the commit. */
  tip: string;
  /** The note at the end of the cursor's line: who, the date and time, the commit's message. */
  note: string;
  tone?: "me" | "new";
  /** Committed lines: the commit that last changed them (full hash) and each line's number in that
   * commit, so "How did this line get here?" follows the line itself even after lines above it moved. */
  at?: { sha: string; orig: number[] };
  /** Committed lines: the details shown when a line is pointed at or clicked. */
  detail?: { author: string; me: boolean; date: string; ago: string; subject: string; hash: string };
}

/** The block a line is in, if git knows the line. `marks` are in line order, as blame gives them. */
export function markAt(marks: readonly BlameMark[], line: number): BlameMark | null {
  let lo = 0;
  let hi = marks.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const m = marks[mid];
    if (line < m.start) hi = mid - 1;
    else if (line >= m.start + m.lines) lo = mid + 1;
    else return m;
  }
  return null;
}

/** Opens a line's history: its number in the editor now, the element to put the popover beside, and
 * (for a committed line) the commit that last changed it and the line's number there. */
export type OnLineStory = (line: number, anchor: HTMLElement, from?: { sha: string; orig: number }) => void;

/** What a line changed in the editor shows: it has no commit of its own yet. */
export const EDITED: BlameMark = {
  start: 0,
  lines: 0,
  who: "Changed",
  when: "not saved",
  tip: "Changed here since the file was last saved.",
  note: "Changed, not saved",
  tone: "new",
};

/** A line's history: the block it came from and its number in what git blamed (`n`). */
export interface LineEntry {
  mark: BlameMark;
  n: number;
}
const EDITED_LINE: LineEntry = { mark: EDITED, n: 0 };

/** Each line's entry after a change: lines the change didn't touch keep theirs (moved with the lines
 * above them), and so do lines it touched whose text is the same as before (the line above a new one);
 * the rest are `edited`. `old` has one entry per line of `a`, the text before; the result one per line
 * of `b`, the text after. */
export function mapLines<T>(old: readonly T[], a: Text, b: Text, changes: ChangeDesc, edited: T): T[] {
  const groups: { a0: number; a1: number; b0: number; b1: number }[] = [];
  changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    const g = { a0: a.lineAt(fromA).number, a1: a.lineAt(toA).number, b0: b.lineAt(fromB).number, b1: b.lineAt(toB).number };
    const last = groups[groups.length - 1];
    // Two changes on one line are one change to it.
    if (last && g.a0 <= last.a1) {
      last.a1 = Math.max(last.a1, g.a1);
      last.b1 = Math.max(last.b1, g.b1);
    } else groups.push(g);
  });
  const out: T[] = [];
  let next = 1;
  for (const g of groups) {
    while (next < g.a0) out.push(old[next++ - 1]);
    let top = 0;
    while (g.a0 + top <= g.a1 && g.b0 + top <= g.b1 && a.line(g.a0 + top).text === b.line(g.b0 + top).text) top++;
    let bottom = 0;
    while (g.a1 - bottom >= g.a0 + top && g.b1 - bottom >= g.b0 + top && a.line(g.a1 - bottom).text === b.line(g.b1 - bottom).text) bottom++;
    for (let k = 0; k < top; k++) out.push(old[g.a0 + k - 1]);
    for (let n = g.b0 + top; n <= g.b1 - bottom; n++) out.push(edited);
    for (let k = bottom - 1; k >= 0; k--) out.push(old[g.a1 - k - 1]);
    next = g.a1 + 1;
  }
  while (next <= a.lines) out.push(old[next++ - 1]);
  return out;
}

/** The blame the editor was given (for the text it had then). */
const marksFacet = Facet.define<readonly BlameMark[], readonly BlameMark[] | null>({ combine: (v) => v[0] ?? null });

interface History {
  marks: readonly BlameMark[] | null;
  /** The text git blamed: back at it (undo), every line has its own history again. */
  base: Text;
  lines: readonly (LineEntry | null)[];
}

function fresh(state: EditorState, marks: readonly BlameMark[] | null): History {
  const lines: (LineEntry | null)[] = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    const mark = marks ? markAt(marks, n) : null;
    lines.push(mark ? { mark, n } : null);
  }
  return { marks, base: state.doc, lines };
}

/** Each line's history now, kept through every edit. */
const historyField = StateField.define<History>({
  create: (s) => fresh(s, s.facet(marksFacet)),
  update(v, tr) {
    const marks = tr.state.facet(marksFacet);
    if (marks !== v.marks) return fresh(tr.state, marks);
    if (!tr.docChanged) return v;
    const doc = tr.state.doc;
    if (doc.length === v.base.length && doc.eq(v.base)) return fresh(tr.state, marks);
    return { ...v, lines: mapLines(v.lines, tr.startState.doc, doc, tr.changes, EDITED_LINE) };
  },
});

/** A line's history (from 1), or null when git doesn't know it. */
export function lineAt(state: EditorState, line: number): LineEntry | null {
  return state.field(historyField, false)?.lines[line - 1] ?? null;
}

/** Where "How did this line get here?" starts: the commit and the line's number in it. */
function storyFrom(e: LineEntry): { sha: string; orig: number } | undefined {
  const orig = e.mark.at?.orig[e.n - e.mark.start];
  return e.mark.at && orig ? { sha: e.mark.at.sha, orig } : undefined;
}

function storyButton(line: number, e: LineEntry, story: OnLineStory) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "cm-line-story";
  b.textContent = "How did this line get here?";
  const from = storyFrom(e);
  b.addEventListener("mousedown", (ev) => ev.preventDefault());
  b.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    story(line, b, from);
  });
  return b;
}

class NoteWidget extends WidgetType {
  constructor(
    readonly mark: BlameMark,
    readonly entry: LineEntry,
    readonly line: number,
    readonly story: OnLineStory | null,
  ) {
    super();
  }
  eq(other: NoteWidget) {
    return other.mark === this.mark && other.entry.n === this.entry.n && other.line === this.line && other.story === this.story;
  }
  toDOM() {
    const box = document.createElement("span");
    box.className = "cm-line-note-box";
    const el = box.appendChild(document.createElement("span"));
    el.className = `cm-line-note${this.mark.tone ? ` ${this.mark.tone}` : ""}`;
    el.textContent = this.mark.note;
    // Said by the gutter already: a screen reader doesn't hear it again on every line it passes.
    el.setAttribute("aria-hidden", "true");
    // A line not committed yet has no history to tell.
    if (this.story && storyFrom(this.entry)) box.appendChild(storyButton(this.line, this.entry, this.story));
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

/** The note for the line the cursor is on: where it goes and what it says, or null. */
export function noteFor(state: EditorState, marks: readonly BlameMark[]): { at: number; mark: BlameMark; entry: LineEntry } | null {
  const line = state.doc.lineAt(state.selection.main.head);
  // In an editor, the line's history kept through its edits; otherwise git's blocks as they came.
  let entry = lineAt(state, line.number);
  if (!state.field(historyField, false)) {
    const mark = markAt(marks, line.number);
    entry = mark ? { mark, n: line.number } : null;
  }
  return entry?.mark.note ? { at: line.to, mark: entry.mark, entry } : null;
}

/** The details of a line's history, for the box shown on a line pointed at or clicked. */
function detailBox(line: number, e: LineEntry, story: OnLineStory | null): HTMLElement {
  const box = document.createElement("div");
  box.className = `cm-line-tip${e.mark.tone ? ` ${e.mark.tone}` : ""}`;
  const add = (tag: string, cls: string, text: string) => {
    const el = box.appendChild(document.createElement(tag));
    el.className = cls;
    el.textContent = text;
    return el;
  };
  const d = e.mark.detail;
  if (e.mark === EDITED) {
    add("b", "lt-who", "Changed, not saved");
    add("p", "lt-sub", "Edited here since the file was last saved. Once saved, git calls it not committed yet.");
  } else if (!d) {
    add("b", "lt-who", "Not committed yet");
    add("p", "lt-sub", "Changed since the last commit: no history to show yet.");
  } else {
    const who = add("b", "lt-who", d.author);
    if (d.me) who.appendChild(document.createElement("span")).textContent = " (you)";
    add("span", "lt-when", `${d.date} · ${d.ago}`);
    add("p", "lt-subj", d.subject || "(no message)");
    add("code", "lt-hash", d.hash);
    if (story && storyFrom(e)) box.appendChild(storyButton(line, e, story));
  }
  return box;
}

/** A clicked line's details, open until the cursor leaves the line, the text changes or Esc. */
const openTip = StateEffect.define<{ line: number; pos: number } | null>();

/** The note at the end of the cursor's line, and with `story` its "How did this line get here?"; the
 * details of a line pointed at or clicked. Nothing without marks. */
export function lineNote(marks: readonly BlameMark[] | null, story: OnLineStory | null = null): Extension {
  if (!marks?.length) return [];
  const clicked = StateField.define<{ line: number; pos: number } | null>({
    create: () => null,
    update(v, tr) {
      for (const e of tr.effects) if (e.is(openTip)) return e.value;
      if (!v) return v;
      if (tr.docChanged) return null;
      return tr.state.doc.lineAt(tr.state.selection.main.head).number === v.line ? v : null;
    },
    provide: (f) =>
      showTooltip.from(f, (v): Tooltip | null => {
        if (!v) return null;
        return {
          pos: v.pos,
          above: false,
          create: (view) => {
            const e = lineAt(view.state, v.line);
            return { dom: e ? detailBox(v.line, e, story) : document.createElement("div") };
          },
        };
      }),
  });
  return [
    marksFacet.of(marks),
    historyField,
    clicked,
    EditorView.decorations.compute([historyField, "selection"], (state) => {
      const n = noteFor(state, marks);
      if (!n) return Decoration.none;
      const line = state.doc.lineAt(n.at).number;
      return Decoration.set([Decoration.widget({ widget: new NoteWidget(n.mark, n.entry, line, story), side: 1 }).range(n.at)]);
    }),
    // Pointed at: the line's details, under its start.
    hoverTooltip(
      (view, pos) => {
        const line = view.state.doc.lineAt(pos);
        const e = lineAt(view.state, line.number);
        if (!e || view.state.field(clicked)?.line === line.number) return null;
        return { pos: line.from, end: line.to, above: false, create: () => ({ dom: detailBox(line.number, e, story) }) };
      },
      { hoverTime: 500, hideOnChange: true },
    ),
    // Clicked (a plain click, not a drag or a selection): the same details, until the cursor moves on.
    EditorView.domEventHandlers({
      click: (ev, view) => {
        if (ev.button !== 0 || ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey || !view.state.selection.main.empty) return false;
        if ((ev.target as HTMLElement).closest?.(".cm-line-note-box")) return false;
        const pos = view.posAtCoords({ x: ev.clientX, y: ev.clientY });
        if (pos == null) return false;
        const line = view.state.doc.lineAt(pos);
        if (!lineAt(view.state, line.number)) return false;
        view.dispatch({ effects: openTip.of({ line: line.number, pos: line.from }) });
        return false;
      },
    }),
    keymap.of([{ key: "Escape", run: (view) => (view.state.field(clicked) ? (view.dispatch({ effects: openTip.of(null) }), true) : false) }]),
    pinnedCardWatch(clicked),
  ];
}

/** A clicked line's card lives in the page body (so panels don't clip it), so it would outlive an editor
 * that is hidden when another file is shown. It closes when the editor stops being visible, on a click
 * outside the editor and the card, and on Esc anywhere: a read-only editor never takes keyboard focus. */
function pinnedCardWatch(clicked: StateField<{ line: number; pos: number } | null>): Extension {
  return ViewPlugin.fromClass(
    class {
      io: IntersectionObserver | null = null;
      constructor(readonly view: EditorView) {
        const doc = view.dom.ownerDocument;
        doc.addEventListener("pointerdown", this.down, true);
        doc.addEventListener("keydown", this.key, true);
        if (typeof IntersectionObserver === "function") {
          this.io = new IntersectionObserver((seen) => {
            if (seen.some((s) => !s.isIntersecting)) this.close();
          });
          this.io.observe(view.dom);
        }
      }
      open() {
        return this.view.state.field(clicked, false) != null;
      }
      close = () => {
        if (this.open()) this.view.dispatch({ effects: openTip.of(null) });
      };
      down = (ev: Event) => {
        const t = ev.target as Element | null;
        if (!this.open() || (t && (this.view.dom.contains(t) || t.closest?.(".cm-tooltip")))) return;
        this.close();
      };
      key = (ev: KeyboardEvent) => {
        // With focus in the editor, its own Esc key closes the card.
        if (ev.key === "Escape" && !this.view.hasFocus) this.close();
      };
      destroy() {
        const doc = this.view.dom.ownerDocument;
        doc.removeEventListener("pointerdown", this.down, true);
        doc.removeEventListener("keydown", this.key, true);
        this.io?.disconnect();
      }
    },
  );
}

// ── the Blame gutter ──

class BlameMarker extends GutterMarker {
  constructor(
    readonly mark: BlameMark | null,
    readonly story = false,
  ) {
    super();
  }
  eq(other: BlameMarker) {
    return other.mark === this.mark && other.story === this.story;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = `cm-blame${this.mark?.tone ? ` ${this.mark.tone}` : ""}`;
    const who = el.appendChild(document.createElement("span"));
    who.className = "who";
    const when = el.appendChild(document.createElement("span"));
    when.className = "when";
    if (this.mark) {
      who.textContent = this.mark.who;
      const w = this.mark.when;
      if (typeof w === "string") when.textContent = w;
      else
        for (const [cls, text] of [["d", w.day], ["y", w.year], ["t", w.time]] as const) {
          const s = when.appendChild(document.createElement("span"));
          s.className = cls;
          s.textContent = text;
        }
      const can = this.story && !!this.mark.at;
      el.title = can ? `${this.mark.tip}\nClick: how did this line get here?` : this.mark.tip;
      if (can) el.classList.add("story");
    }
    return el;
  }
}
/** Sizes the gutter before any line is drawn. */
const blameSpacer = new BlameMarker({ start: 0, lines: 0, who: "Not committed", when: { day: "28 Nov", year: " 2026", time: "22:41" }, tip: "", note: "" });

/** The Blame gutter: a label where each block of lines from one commit (or of lines changed and not
 * saved) begins, nothing on the block's other lines. With `story`, a click on a block's label opens
 * the history of its first line. */
export function blameGutter(marks: readonly BlameMark[] | null, story: OnLineStory | null = null): Extension {
  if (!marks?.length) return [];
  const markers = new Map<BlameMark, BlameMarker>();
  const markerOf = (m: BlameMark) => {
    let k = markers.get(m);
    if (!k) markers.set(m, (k = new BlameMarker(m, !!story)));
    return k;
  };
  const startsAt = (state: EditorState, n: number) => {
    const e = lineAt(state, n);
    return e && (n === 1 || lineAt(state, n - 1)?.mark !== e.mark) ? e : null;
  };
  return [
    marksFacet.of(marks),
    historyField,
    gutter({
      class: "cm-blame-gutter",
      lineMarker: (v, line) => {
        const e = startsAt(v.state, v.state.doc.lineAt(line.from).number);
        return e ? markerOf(e.mark) : null;
      },
      lineMarkerChange: (u) => u.startState.field(historyField, false) !== u.state.field(historyField, false),
      initialSpacer: () => blameSpacer,
      domEventHandlers: story
        ? {
            click: (v, line, e) => {
              const n = v.state.doc.lineAt(line.from).number;
              const el = (e.target as HTMLElement).closest<HTMLElement>(".cm-blame.story");
              const entry = startsAt(v.state, n);
              if (!el || !entry) return false;
              story(n, el, storyFrom(entry));
              return true;
            },
          }
        : {},
    }),
  ];
}
