"use client";
/**
 * WalkMyCode's one code editor (CodeMirror 6, in the chalkboard colours), used
 * by both rooms: reading and editing files in Explore, and the Code room in
 * Learn. Everything is optional, so each place turns on what it needs:
 *
 * - read-only or editable, with `onChange`, Ctrl+Enter to run, Ctrl+S to save;
 * - a highlighted line range (a tour step or a citation), scrolled into view;
 * - `onSelect`, reporting the lines the user selects (for "explain this");
 * - breakpoints in a gutter, and the debugger's current line.
 * - who last changed each block of lines, and when (git blame), in a gutter of its own.
 *
 * The language follows the file's extension, or `language` when there is no path.
 */
import { useEffect, useRef } from "react";
import {
  Decoration,
  EditorView,
  GutterMarker,
  drawSelection,
  gutter,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type DecorationSet,
} from "@codemirror/view";
import { Compartment, EditorState, RangeSet, StateEffect, StateField, type Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, bracketMatching, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { javascript, javascriptLanguage, jsxLanguage, tsxLanguage, typescriptLanguage } from "@codemirror/lang-javascript";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { python, pythonLanguage } from "@codemirror/lang-python";
import { rust, rustLanguage } from "@codemirror/lang-rust";
import { StandardSQL, sql } from "@codemirror/lang-sql";
import { Tag, styleTags, tags as t } from "@lezer/highlight";

/** The mark that starts a list item, coloured on its own (VS Code does). */
const listMark = Tag.define();

const chalk = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.operatorKeyword], color: "#f3d77a", fontWeight: "600" },
  { tag: [t.string, t.special(t.string)], color: "#a8e0a0" },
  { tag: [t.number, t.bool, t.null], color: "#9fd3f0" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#8fa39a", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#f2c9a0" },
  { tag: [t.definition(t.variableName), t.className, t.typeName], color: "#f2a7a0" },
  { tag: [t.operator, t.punctuation, t.bracket], color: "#cfd8d3" },
  { tag: [t.tagName], color: "#9fd3f0" },
  { tag: [t.attributeName, t.propertyName], color: "#f3d77a" },
  // Markdown, as VS Code colours it: headings bold and blue, emphasis in its own style, code spans,
  // links and list marks in colour, and the marks themselves (#, **, `, >) quieter than the words.
  { tag: t.heading, color: "#9fd3f0", fontWeight: "700" },
  { tag: t.strong, fontWeight: "700", color: "#f4f1e8" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.monospace, color: "#f2c9a0" },
  { tag: t.link, color: "#9fd3f0" },
  { tag: t.url, color: "#8fb8d0", textDecoration: "underline" },
  { tag: t.quote, color: "#b9c4bf", fontStyle: "italic" },
  // A list mark (-, *, 1.) only: Markdown tags whole lists, and their words keep the text colour.
  { tag: [listMark, t.contentSeparator, t.atom], color: "#f3d77a" },
  { tag: [t.processingInstruction, t.labelName], color: "#7f8a86" },
  { tag: t.escape, color: "#f2a7a0" },
]);

const theme = EditorView.theme(
  {
    "&": { color: "var(--chalk)", backgroundColor: "var(--code-bg)", height: "100%" },
    ".cm-content": { fontFamily: "var(--mono)", caretColor: "#f3d77a", padding: "10px 0" },
    ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.55" },
    ".cm-gutters": { backgroundColor: "var(--code-gutter)", color: "var(--code-gutter-ink)", border: "none" },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,.04)" },
    ".cm-activeLineGutter": { backgroundColor: "rgba(255,255,255,.06)", color: "#cfd8d3" },
    "&.cm-focused": { outline: "2px solid #f3d77a", outlineOffset: "-2px" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "rgba(243,215,122,.25) !important" },
    ".cm-cursor": { borderLeftColor: "#f3d77a", borderLeftWidth: "2px" },
    ".cm-matchingBracket": { backgroundColor: "rgba(159,211,240,.25)", outline: "none" },
    ".cm-bp-gutter": { width: "18px", cursor: "pointer" },
    // Git blame (docs/design/git-history.html): its look is in src/ide/localrun/git/git.css.
    ".cm-bp-gutter .cm-gutterElement": { display: "flex", alignItems: "center", justifyContent: "center" },
    ".cm-bp": { width: "10px", height: "10px", borderRadius: "50%", background: "#e8665a", boxShadow: "0 0 0 2px rgba(232,102,90,.25)" },
    ".cm-lit-line": { backgroundColor: "rgba(243,215,122,.14) !important", boxShadow: "inset 3px 0 0 #f3d77a" },
    ".cm-debug-line": { backgroundColor: "rgba(243,215,122,.22) !important", boxShadow: "inset 3px 0 0 #f3d77a" },
  },
  { dark: true },
);

export type Language = "python" | "javascript" | "typescript" | "jsx" | "tsx" | "json" | "sql" | "rust" | "markdown" | "text";

/** The language for a file, from its extension. */
export function languageOf(path: string | null | undefined): Language {
  if (!path) return "text";
  if (/\.pyw?$/.test(path)) return "python";
  if (/\.tsx$/.test(path)) return "tsx";
  if (/\.(ts|mts|cts)$/.test(path)) return "typescript";
  if (/\.jsx$/.test(path)) return "jsx";
  if (/\.(js|mjs|cjs)$/.test(path)) return "javascript";
  if (/\.json$/.test(path)) return "json";
  if (/\.sql$/.test(path)) return "sql";
  if (/\.rs$/.test(path)) return "rust";
  if (/\.(md|markdown|mdx)$/i.test(path)) return "markdown";
  return "text";
}

function languageExtension(lang: Language): Extension {
  switch (lang) {
    case "python":
      return python();
    case "tsx":
      return javascript({ jsx: true, typescript: true });
    case "typescript":
      return javascript({ typescript: true });
    case "jsx":
      return javascript({ jsx: true });
    case "javascript":
    case "json":
      return javascript();
    case "sql":
      return sql();
    case "rust":
      return rust();
    case "markdown":
      // GitHub's Markdown (tables, task lists, ~~strike~~), with each fenced block coloured in its own language.
      return markdown({ base: markdownLanguage, codeLanguages: fencedLanguage, extensions: { props: [styleTags({ ListMark: listMark })] } });
    default:
      return [];
  }
}

/** A fenced block's language in Markdown, from its info string (```ts, ```rust, ```python …). */
function fencedLanguage(info: string) {
  const name = info.trim().toLowerCase().split(/[\s{]/)[0];
  if (["py", "python", "python3"].includes(name)) return pythonLanguage;
  if (["ts", "typescript", "mts", "cts"].includes(name)) return typescriptLanguage;
  if (name === "tsx") return tsxLanguage;
  if (name === "jsx") return jsxLanguage;
  if (["js", "javascript", "mjs", "cjs", "json", "jsonc", "json5"].includes(name)) return javascriptLanguage;
  if (["rs", "rust"].includes(name)) return rustLanguage;
  if (name === "sql") return StandardSQL.language;
  return null;
}

/* Breakpoints: a marker per line, set from React. */
/** One block of lines one commit last changed, as the blame gutter shows it (src/ide/localrun/git/FileGit.tsx). */
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
  tone?: "me" | "new";
}

class BlameMarker extends GutterMarker {
  constructor(readonly mark: BlameMark | null) {
    super();
  }
  eq(other: BlameMarker) {
    return other.mark === this.mark;
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
      el.title = this.mark.tip;
    }
    return el;
  }
}
/** Sizes the gutter before any line is drawn. */
const blameSpacer = new BlameMarker({ start: 0, lines: 0, who: "Not committed", when: { day: "28 Nov", year: " 2026", time: "22:41" }, tip: "" });

/** The blame gutter: a label where each block begins, nothing on the block's other lines. */
function blameGutter(marks: BlameMark[] | null): Extension {
  if (!marks?.length) return [];
  const byStart = new Map(marks.map((m) => [m.start, new BlameMarker(m)]));
  return gutter({
    class: "cm-blame-gutter",
    lineMarker: (v, line) => byStart.get(v.state.doc.lineAt(line.from).number) ?? null,
    initialSpacer: () => blameSpacer,
  });
}

class BreakMarker extends GutterMarker {
  toDOM() {
    const d = document.createElement("span");
    d.className = "cm-bp";
    d.setAttribute("aria-label", "Breakpoint");
    return d;
  }
}
const breakMarker = new BreakMarker();
const setBreaks = StateEffect.define<number[]>();
const breaksField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setBreaks)) {
        const doc = tr.state.doc;
        const lines = [...new Set(e.value)].filter((n) => n >= 1 && n <= doc.lines).sort((a, b) => a - b);
        return RangeSet.of(lines.map((n) => breakMarker.range(doc.line(n).from)));
      }
    }
    return value.map(tr.changes);
  },
});

/** Line decorations for a range of lines, re-set from React. */
function lineMarks(className: string) {
  const set = StateEffect.define<[number, number] | null>();
  const field = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, tr) {
      for (const e of tr.effects) {
        if (e.is(set)) {
          if (!e.value) return Decoration.none;
          const doc = tr.state.doc;
          const from = Math.max(1, Math.min(e.value[0], doc.lines));
          const to = Math.max(from, Math.min(e.value[1], doc.lines));
          const marks = [];
          for (let n = from; n <= to; n++) marks.push(Decoration.line({ class: className }).range(doc.line(n).from));
          return Decoration.set(marks);
        }
      }
      return value.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  return { set, field };
}
const lit = lineMarks("cm-lit-line");
const debugMark = lineMarks("cm-debug-line");

/** What the user selected: whole lines, 1-based. */
export interface Selection {
  path: string;
  start: number;
  end: number;
  text: string;
}

export interface EditorProps {
  /** The file's path, which sets the language and is reported with selections. */
  path?: string | null;
  /** The language when there is no path (e.g. the Code room's Python). */
  language?: Language;
  value: string;
  onChange?: (value: string) => void;
  /** Read-only: no typing, but selecting and highlighting still work. */
  readOnly?: boolean;
  onRun?: () => void;
  onSave?: () => void;
  /** A line range to highlight and scroll to (a tour step, a citation). */
  highlight?: [number, number] | null;
  onSelect?: (s: Selection | null) => void;
  breakpoints?: number[];
  onToggleBreakpoint?: (line: number) => void;
  /** The line the debugger is on. */
  debugLine?: number | null;
  /** Long lines wrap instead of scrolling sideways (good for reading). */
  wrap?: boolean;
  /** Who last changed each block of lines, and when (git blame): a gutter beside the line numbers. */
  blame?: BlameMark[] | null;
  fontSize?: number;
  label?: string;
  /** Size the editor from outside, e.g. to fill a dock panel. It fills its box; it has no height of its own. */
  className?: string;
  style?: React.CSSProperties;
}

export default function Editor({
  path = null,
  language,
  value,
  onChange,
  readOnly = false,
  onRun,
  onSave,
  highlight = null,
  onSelect,
  breakpoints = [],
  onToggleBreakpoint,
  debugLine = null,
  wrap = false,
  blame = null,
  fontSize,
  label = "Code",
  className = "",
  style,
}: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cb = useRef({ onChange, onRun, onSave, onSelect, onToggleBreakpoint, path });
  const comp = useRef({ lang: new Compartment(), lock: new Compartment(), wrap: new Compartment(), size: new Compartment(), blame: new Compartment() });
  useEffect(() => {
    cb.current = { onChange, onRun, onSave, onSelect, onToggleBreakpoint, path };
  });

  const lang = language ?? languageOf(path);
  const hasBreaks = !!onToggleBreakpoint;

  useEffect(() => {
    if (!host.current) return;
    const toggle = (v: EditorView, pos: number) => {
      if (!cb.current.onToggleBreakpoint) return false;
      cb.current.onToggleBreakpoint(v.state.doc.lineAt(pos).number);
      return true;
    };
    const c = comp.current;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          breaksField,
          ...(hasBreaks
            ? [
                gutter({
                  class: "cm-bp-gutter",
                  markers: (v) => v.state.field(breaksField),
                  initialSpacer: () => breakMarker,
                  domEventHandlers: { mousedown: (v, line) => toggle(v, line.from) },
                }),
              ]
            : []),
          c.blame.of(blameGutter(blame)),
          lineNumbers({ domEventHandlers: { mousedown: (v, line) => toggle(v, line.from) } }),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          lit.field,
          debugMark.field,
          drawSelection(),
          history(),
          indentOnInput(),
          bracketMatching(),
          syntaxHighlighting(chalk),
          theme,
          c.lang.of(languageExtension(lang)),
          c.lock.of(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
          c.wrap.of(wrap ? EditorView.lineWrapping : []),
          c.size.of(EditorView.theme({ "&": { fontSize: fontSize ? `calc(${fontSize}px * var(--fs, 1))` : "var(--text, 13px)" } })),
          EditorState.tabSize.of(4),
          keymap.of([
            { key: "Mod-Enter", run: () => (cb.current.onRun ? (cb.current.onRun(), true) : false) },
            { key: "Shift-Enter", run: () => (cb.current.onRun ? (cb.current.onRun(), true) : false) },
            { key: "Mod-s", preventDefault: true, run: () => (cb.current.onSave?.(), true) },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current.onChange?.(u.state.doc.toString());
            if (u.selectionSet && cb.current.onSelect) {
              const r = u.state.selection.main;
              if (r.empty) return cb.current.onSelect(null);
              const a = u.state.doc.lineAt(r.from).number;
              const b = u.state.doc.lineAt(r.to).number;
              cb.current.onSelect({ path: cb.current.path ?? "", start: a, end: b, text: u.state.sliceDoc(u.state.doc.line(a).from, u.state.doc.line(b).to) });
            }
          }),
          EditorView.contentAttributes.of({ "aria-label": label }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // Built once per mount (and when a breakpoint gutter is added or removed);
    // everything else is applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBreaks]);

  // New text from outside (another file, a reset) replaces the document.
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: comp.current.lang.reconfigure(languageExtension(lang)) });
  }, [lang]);
  useEffect(() => {
    view.current?.dispatch({
      effects: comp.current.lock.reconfigure(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
    });
  }, [readOnly]);
  useEffect(() => {
    view.current?.dispatch({ effects: comp.current.wrap.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }, [wrap]);
  useEffect(() => {
    view.current?.dispatch({ effects: comp.current.blame.reconfigure(blameGutter(blame)) });
  }, [blame]);
  useEffect(() => {
    view.current?.dispatch({ effects: comp.current.size.reconfigure(EditorView.theme({ "&": { fontSize: fontSize ? `calc(${fontSize}px * var(--fs, 1))` : "var(--text, 13px)" } })) });
  }, [fontSize]);

  const breakKey = breakpoints.join(",");
  useEffect(() => {
    view.current?.dispatch({ effects: setBreaks.of(breakKey ? breakKey.split(",").map(Number) : []) });
  }, [breakKey]);

  const litKey = highlight ? `${highlight[0]}-${highlight[1]}` : "";
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const range = litKey ? (litKey.split("-").map(Number) as [number, number]) : null;
    v.dispatch({ effects: lit.set.of(range) });
    if (range) {
      const n = Math.max(1, Math.min(range[0], v.state.doc.lines));
      v.dispatch({ effects: EditorView.scrollIntoView(v.state.doc.line(n).from, { y: "start", yMargin: 60 }) });
    }
  }, [litKey, value]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.dispatch({ effects: debugMark.set.of(debugLine ? [debugLine, debugLine] : null) });
    if (debugLine && debugLine <= v.state.doc.lines) {
      v.dispatch({ effects: EditorView.scrollIntoView(v.state.doc.line(debugLine).from, { y: "center" }) });
    }
  }, [debugLine]);

  return <div className={`ide-editor${readOnly ? " locked" : ""}${className ? ` ${className}` : ""}`} style={style} ref={host} />;
}
