// Line history in the editor (mockup: docs/design/git-history.html): the blocks of lines git blame
// gives (src/ide/localrun/git/blameMarks.ts makes them), and the faint note at the end of the line
// the cursor is on: "Kofi Mensah, 2 Nov 2026 09:14 · Run on start". The gutter beside the line
// numbers is in Editor.tsx. Only the cursor's line gets a note, worked out again when the cursor
// moves. Plain CodeMirror, no React, so tests can load it.
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { EditorState, Extension } from "@codemirror/state";

/** One block of lines one commit last changed, as the editor shows it. */
export interface BlameMark {
  /** Its first line, from 1, and how many lines. */
  start: number;
  lines: number;
  /** "Ama Owusu", "You", "Not committed". */
  who: string;
  /** "2 Nov", " 2026" and "09:14": the year is left out where the editor is narrow. */
  when: { day: string; year: string; time: string } | string;
  /** The hover: full date, how long ago, the message, the commit. */
  tip: string;
  /** The note at the end of the cursor's line: who, the date and time, the commit's message. */
  note: string;
  tone?: "me" | "new";
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

class NoteWidget extends WidgetType {
  constructor(readonly mark: BlameMark) {
    super();
  }
  eq(other: NoteWidget) {
    return other.mark === this.mark;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = `cm-line-note${this.mark.tone ? ` ${this.mark.tone}` : ""}`;
    el.textContent = this.mark.note;
    // Said by the gutter already: a screen reader doesn't hear it again on every line it passes.
    el.setAttribute("aria-hidden", "true");
    return el;
  }
}

/** The note for the line the cursor is on: where it goes and what it says, or null. */
export function noteFor(state: EditorState, marks: readonly BlameMark[]): { at: number; mark: BlameMark } | null {
  const line = state.doc.lineAt(state.selection.main.head);
  const mark = markAt(marks, line.number);
  return mark?.note ? { at: line.to, mark } : null;
}

/** The note at the end of the cursor's line. Nothing without marks. */
export function lineNote(marks: readonly BlameMark[] | null): Extension {
  if (!marks?.length) return [];
  return EditorView.decorations.compute(["selection", "doc"], (state) => {
    const n = noteFor(state, marks);
    return n ? Decoration.set([Decoration.widget({ widget: new NoteWidget(n.mark), side: 1 }).range(n.at)]) : Decoration.none;
  });
}
