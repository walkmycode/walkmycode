// How the editor draws code (mockup: docs/design/code-view.html), each part a switch in Settings →
// Editor (src/lib/editorSettings.ts):
//
// - neat wrapping: a wrapped line carries on under its own indentation, two columns in. A line
//   decoration gives each line a hanging indent (padding on the left, the same taken back from its
//   first row), so the text itself is never changed and line numbers still match git and tours;
// - indent guides: a faint line for each level of nesting, a colour per level, and the block the
//   cursor is in drawn bright, top to bottom, when it changes. Drawn in layers behind the text (as
//   CodeMirror draws the selection), for the lines on screen only, so the text's layout is untouched;
// - coloured brackets: ( [ { coloured by depth, outside strings and comments (from the syntax tree);
// - the current line: a band behind it that glides to the next line (it replaces CodeMirror's
//   highlightActiveLine).
//
// The motion (the glide, the guide drawing in, the matching bracket's pop) takes its time from the
// app's --m (0 when the computer or the app asks for less motion); the "Motion in the code" switch
// turns it off here alone (the cm-calm class). Its look is in ./codeView.css.
import { syntaxTree } from "@codemirror/language";
import { StateField, type EditorState, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, layer, type DecorationSet, type LayerMarker, type ViewUpdate } from "@codemirror/view";
import { blockAt, bracketDepths, bracketsIn, guideRuns, hangCols, indentCols, indentUnitOf, shownIndent } from "./codeShape";

/** What to draw: the switches in Settings → Editor, for this editor. */
export interface CodeLook {
  /** Neat wrapping, when lines wrap at all. */
  neat: boolean;
  guides: boolean;
  /** Coloured brackets (never in Markdown or plain text, where brackets are words' business). */
  brackets: boolean;
  motion: boolean;
}

/** CodeMirror's own space at the left of every line (its base theme's .cm-line padding). */
const LINE_PAD = 6;
/** Files bigger than this keep plain brackets: colouring them means reading the file from the top. */
const BRACKETS_UP_TO = 400_000;

// ── neat wrapping ──

const hangDecos = new Map<number, Decoration>();
const hangDeco = (cols: number) => {
  let d = hangDecos.get(cols);
  if (!d) hangDecos.set(cols, (d = Decoration.line({ class: "cm-hang", attributes: { style: `--hang:${cols}` } })));
  return d;
};

function hangs(view: EditorView): DecorationSet {
  if (!view.lineWrapping) return Decoration.none;
  // At most half the panel's width, so a deep line in a narrow panel still has room to go on.
  const most = Math.floor(view.contentDOM.clientWidth / Math.max(1, view.defaultCharacterWidth) / 2);
  const tab = view.state.tabSize;
  const marks = [];
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      marks.push(hangDeco(hangCols(indentCols(line.text, tab), most)).range(line.from));
      pos = line.to + 1;
    }
  }
  return Decoration.set(marks);
}

const neatWrap = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = hangs(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.geometryChanged) this.decorations = hangs(u.view);
    }
  },
  { decorations: (p) => p.decorations },
);

// ── indent guides ──

/** The file's step of indentation, worked out again when the text changes (from its first lines). */
const unitField = StateField.define<number>({
  create: (s) => unitOf(s),
  update: (v, tr) => (tr.docChanged ? unitOf(tr.state) : v),
});
function unitOf(state: EditorState): number {
  const doc = state.doc;
  const out: number[] = [];
  for (let n = 1; n <= Math.min(doc.lines, 3000); n++) out.push(indentCols(doc.line(n).text, state.tabSize));
  return indentUnitOf(out);
}

/** A line's own indent, from 0 (-1 blank), remembered for one drawing. */
function indents(doc: Text, tab: number) {
  const seen = new Map<number, number>();
  return (i: number) => {
    let v = seen.get(i);
    if (v === undefined) seen.set(i, (v = indentCols(doc.line(i + 1).text, tab)));
    return v;
  };
}

/** Where the drawing's pixels start: the layers are placed against the scroller, as CodeMirror's own are. */
function origin(view: EditorView) {
  const r = view.scrollDOM.getBoundingClientRect();
  const c = view.contentDOM.getBoundingClientRect();
  const left = r.left - view.scrollDOM.scrollLeft;
  const top = r.top - view.scrollDOM.scrollTop;
  return { x: c.left - left + LINE_PAD, y: view.documentTop - top, cw: view.defaultCharacterWidth, width: c.width };
}

/** A guide: a thin line at a column, down some lines. The bright one (`key` set) keeps its element while
 * its block stays the same, so it draws in only when the cursor moves to another block. */
class Guide implements LayerMarker {
  constructor(
    readonly cls: string,
    readonly left: number,
    readonly top: number,
    readonly height: number,
    readonly key = "",
  ) {}
  draw() {
    const el = document.createElement("div");
    el.className = this.cls;
    this.adjust(el);
    return el;
  }
  update(el: HTMLElement, prev: LayerMarker) {
    if (!(prev instanceof Guide) || prev.cls !== this.cls || prev.key !== this.key) return false;
    this.adjust(el);
    return true;
  }
  adjust(el: HTMLElement) {
    el.style.left = `${this.left}px`;
    el.style.top = `${this.top}px`;
    el.style.height = `${this.height}px`;
  }
  eq(o: LayerMarker): boolean {
    return o instanceof Guide && o.cls === this.cls && o.left === this.left && o.top === this.top && o.height === this.height && o.key === this.key;
  }
}

const span = (view: EditorView, first: number, last: number, o: ReturnType<typeof origin>) => {
  const doc = view.state.doc;
  const a = view.lineBlockAt(doc.line(first).from);
  const b = view.lineBlockAt(doc.line(last).from);
  return { top: o.y + a.top, height: b.bottom - a.top };
};

/** The quiet guides, for the lines CodeMirror has drawn. */
function guides(view: EditorView): Guide[] {
  const { state } = view;
  const doc = state.doc;
  const unit = state.field(unitField);
  const at = indents(doc, state.tabSize);
  const first = doc.lineAt(view.viewport.from).number - 1;
  const last = doc.lineAt(view.viewport.to).number - 1;
  const shown: number[] = [];
  for (let i = first; i <= last; i++) shown.push(shownIndent(i, doc.lines, at));
  const o = origin(view);
  return guideRuns(shown, unit, first).map((r) => {
    const s = span(view, r.from + 1, r.to + 1, o);
    return new Guide(`cm-guide l${r.level % 6}`, o.x + (r.col + 0.5) * o.cw, s.top, s.height);
  });
}

/** The bright guide of the block the cursor is in, top to bottom (even past the lines drawn). */
function activeGuide(view: EditorView): Guide[] {
  const { state } = view;
  const doc = state.doc;
  const at = indents(doc, state.tabSize);
  const i = doc.lineAt(state.selection.main.head).number - 1;
  const b = blockAt(i, doc.lines, at);
  if (!b || b.close - b.open < 2) return [];
  const o = origin(view);
  const s = span(view, b.open + 2, b.close, o);
  const level = Math.round(b.col / state.field(unitField)) % 6;
  return [new Guide(`cm-guide cm-guide-on l${level}`, o.x + (b.col + 0.5) * o.cw, s.top, s.height, `${b.open}:${b.col}`)];
}

const indentGuides: Extension = [
  unitField,
  layer({ above: false, class: "cm-guides", update: (u) => u.docChanged || u.viewportChanged, markers: guides }),
  layer({ above: false, class: "cm-guides-on", update: (u) => u.docChanged || u.selectionSet || u.viewportChanged, markers: activeGuide }),
];

// ── coloured brackets ──

/** Syntax nodes whose brackets are text, not code. */
const WORDS = /string|comment|regexp|regex|char|docstring/i;
const brDecos = [0, 1, 2].map((d) => Decoration.mark({ class: `cm-br cm-br-${d}` }));

/** Every bracket from the top of the file to `end`, with its depth, for one text. Scrolling further
 * down carries on from where the last scan stopped; scrolling back up reuses it. */
interface BracketScan {
  doc: Text;
  end: number;
  found: { pos: number; ch: string }[];
  depth: number[];
  /** How many brackets are open at `end`. */
  open: number;
}

function scanBrackets(state: EditorState, end: number, last: BracketScan | null): BracketScan {
  const same = last && last.doc === state.doc ? last : null;
  if (same && same.end >= end) return same;
  // A bracket's depth needs every one before it: from the top of the file, or from the last scan's end.
  const from = same?.end ?? 0;
  const skip: { from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    from,
    to: end,
    enter: (n) => {
      if (n.from === 0 && n.to === state.doc.length) return;
      if (WORDS.test(n.type.name)) {
        skip.push({ from: n.from, to: n.to });
        return false;
      }
    },
  });
  const found = bracketsIn(state.doc.sliceString(from, end), skip, from);
  const depth = bracketDepths(found.map((b) => b.ch).join(""), same?.open ?? 0);
  const k = found.length - 1;
  const open = k < 0 ? (same?.open ?? 0) : "([{".includes(found[k].ch) ? depth[k] + 1 : depth[k];
  return same ? { doc: state.doc, end, found: same.found.concat(found), depth: same.depth.concat(depth), open } : { doc: state.doc, end, found, depth, open };
}

function colourBrackets(view: EditorView, scan: BracketScan): DecorationSet {
  const { from, to } = view.viewport;
  const marks = [];
  // The first bracket on screen, found by halving.
  let lo = 0;
  let hi = scan.found.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (scan.found[mid].pos < from) lo = mid + 1;
    else hi = mid;
  }
  for (let k = lo; k < scan.found.length && scan.found[k].pos < to; k++) marks.push(brDecos[scan.depth[k] % 3].range(scan.found[k].pos, scan.found[k].pos + 1));
  return Decoration.set(marks);
}

const brackets = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    scan: BracketScan | null = null;
    constructor(view: EditorView) {
      this.draw(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.state) !== syntaxTree(u.startState)) this.draw(u.view);
    }
    draw(view: EditorView) {
      if (view.state.doc.length > BRACKETS_UP_TO) {
        this.scan = null;
        this.decorations = Decoration.none;
        return;
      }
      this.scan = scanBrackets(view.state, view.viewport.to, this.scan);
      this.decorations = colourBrackets(view, this.scan);
    }
  },
  { decorations: (p) => p.decorations },
);

// ── the current line ──

/** The band behind the cursor's line: one element, moved (so it can glide) rather than drawn again. */
class Band implements LayerMarker {
  constructor(
    readonly left: number,
    readonly top: number,
    readonly width: number,
    readonly height: number,
  ) {}
  draw() {
    const el = document.createElement("div");
    el.className = "cm-band";
    this.adjust(el);
    return el;
  }
  update(el: HTMLElement) {
    this.adjust(el);
    return true;
  }
  adjust(el: HTMLElement) {
    el.style.left = `${this.left}px`;
    el.style.width = `${this.width}px`;
    el.style.height = `${this.height}px`;
    el.style.transform = `translateY(${this.top}px)`;
  }
  eq(o: LayerMarker): boolean {
    return o instanceof Band && o.left === this.left && o.top === this.top && o.width === this.width && o.height === this.height;
  }
}

const band = layer({
  above: false,
  class: "cm-band-layer",
  update: (u) => u.docChanged || u.selectionSet || u.viewportChanged,
  markers: (view) => {
    const o = origin(view);
    const line = view.lineBlockAt(view.state.selection.main.head);
    return [new Band(o.x - LINE_PAD, o.y + line.top, o.width, line.height)];
  },
});

/** Everything this file draws, as the switches say. */
export function codeView(look: CodeLook): Extension {
  return [
    band,
    look.neat ? neatWrap : [],
    look.guides ? indentGuides : [],
    look.brackets ? brackets : [],
    EditorView.editorAttributes.of({ class: `${look.motion ? "" : "cm-calm "}${look.brackets ? "cm-brackets" : ""}`.trim() }),
  ];
}
