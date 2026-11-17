// The code editor's helpers and their switches: Settings → Editor (src/lib/editorSettings.ts),
// the note on the cursor's line (src/ide/lineHistory.ts, src/ide/localrun/git/blameMarks.ts) and
// suggestions while typing (src/ide/suggest.ts). CodeMirror's state needs no browser, so the
// sources and decorations are asked directly.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { CompletionContext, type CompletionSource } from "@codemirror/autocomplete";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { Compartment, EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView, type DecorationSet } from "@codemirror/view";
import { lineNote, markAt, noteFor } from "../src/ide/lineHistory";
import { blameMarks } from "../src/ide/localrun/git/blameMarks";
import type { Language } from "../src/ide/languages";
import { SUGGEST, sourcesOf, suggestions } from "../src/ide/suggest";

// A browser's storage, before the settings are first read.
const saved = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v), removeItem: (k: string) => void saved.delete(k) },
  addEventListener: () => {},
};
let settings: typeof import("../src/lib/editorSettings");
before(async () => {
  settings = await import("../src/lib/editorSettings");
});

describe("Settings → Editor: one switch per helper", () => {
  it("starts with line history and suggestions on, and has no switch for type-aware suggestions yet", () => {
    assert.deepEqual(settings.DEFAULT_EDITOR, { lineHistory: true, suggestions: true });
    assert.deepEqual(
      settings.EDITOR_SWITCHES.map((s) => s.label),
      ["Line history (who changed each line, and when)", "Suggestions while typing"],
    );
    assert.deepEqual(settings.editorSettings(), settings.DEFAULT_EDITOR);
  });

  it("shows Lite no switch for line history, which needs git on this computer", () => {
    assert.deepEqual(settings.editorSwitchesFor("lite").map((s) => s.id), ["suggestions"]);
    assert.equal(settings.editorSwitchesFor("full"), settings.EDITOR_SWITCHES);
    assert.equal(settings.editorSwitchesFor("mcp"), settings.EDITOR_SWITCHES);
  });

  it("keeps the default for anything saved that is not true or false", () => {
    assert.deepEqual(settings.parseEditor(null), settings.DEFAULT_EDITOR);
    assert.deepEqual(settings.parseEditor("not json"), settings.DEFAULT_EDITOR);
    assert.deepEqual(settings.parseEditor("[false]"), settings.DEFAULT_EDITOR);
    assert.deepEqual(settings.parseEditor('{"suggestions":false,"lineHistory":"no","other":1}'), { lineHistory: true, suggestions: false });
  });

  it("tells every listener when a switch changes, and remembers it", () => {
    let heard = 0;
    const off = settings.onEditorSettings(() => heard++);
    const before = settings.editorSettings();
    settings.setEditorSetting("lineHistory", true);
    assert.equal(heard, 0, "already on: nothing to tell");
    assert.equal(settings.editorSettings(), before, "the same object until one changes");
    settings.setEditorSetting("lineHistory", false);
    assert.equal(heard, 1);
    assert.deepEqual(settings.editorSettings(), { lineHistory: false, suggestions: true });
    assert.deepEqual(JSON.parse(saved.get(settings.EDITOR_KEY)!), { lineHistory: false, suggestions: true });
    // Another tab turned it back on.
    saved.set(settings.EDITOR_KEY, '{"lineHistory":true}');
    settings.rereadEditorSettings();
    assert.equal(heard, 2);
    assert.deepEqual(settings.editorSettings(), settings.DEFAULT_EDITOR);
    off();
    settings.setEditorSetting("suggestions", false);
    assert.equal(heard, 2, "no longer listening");
    settings.setEditorSetting("suggestions", true);
  });
});

const at = Date.UTC(2026, 10, 12, 9, 14) / 1000;
const hunks = [
  { start: 1, lines: 3, hash: "a1b2c3d", author: "Ama Owusu", email: "ama@example.com", time: at, summary: "First commit" },
  { start: 4, lines: 2, hash: "e4f5a6b", author: "Kofi Mensah", email: "kofi@example.com", time: at, summary: "Run on start" },
  { start: 6, lines: 1, hash: "", author: "", email: "", time: 0, summary: "" },
  { start: 7, lines: 1, hash: "a1b2c3d", author: "Ama Owusu", email: "ama@example.com", time: at, summary: "" },
];

/** The text of the notes an editor state shows, with where each is. */
function notes(state: EditorState): { at: number; text: string }[] {
  const out: { at: number; text: string }[] = [];
  for (const set of state.facet(EditorView.decorations)) {
    if (typeof set === "function") continue;
    const it = (set as DecorationSet).iter();
    for (; it.value; it.next()) out.push({ at: it.from, text: (it.value.spec.widget as { mark: { note: string } }).mark.note });
  }
  return out;
}

describe("line history: the note on the cursor's line", () => {
  const marks = blameMarks(hunks, "KOFI@example.com");

  it("says who, the date and time, and the commit's message", () => {
    assert.match(marks[0].note, /^Ama Owusu, 1[123] Nov 2026 \d\d:\d\d · First commit$/);
    assert.match(marks[1].note, /^You, 1[123] Nov 2026 \d\d:\d\d · Run on start$/, "the user's own commits are theirs");
    const w = marks[0].when as { day: string; year: string; time: string };
    assert.equal(marks[0].note, `Ama Owusu, ${w.day}${w.year} ${w.time} · First commit`, "the same date and time as the gutter");
    assert.equal(marks[2].note, "Not committed yet");
    assert.match(marks[3].note, /^Ama Owusu, 1[123] Nov 2026 \d\d:\d\d$/, "a commit with no message: no dot");
    assert.match(blameMarks(hunks, "")[1].note, /^Kofi Mensah, /, "git has no user.email: nobody is You");
  });

  it("finds the block a line is in", () => {
    assert.equal(markAt(marks, 1), marks[0]);
    assert.equal(markAt(marks, 3), marks[0]);
    assert.equal(markAt(marks, 4), marks[1]);
    assert.equal(markAt(marks, 6), marks[2]);
    assert.equal(markAt(marks, 7), marks[3]);
    assert.equal(markAt(marks, 8), null, "a line git doesn't know");
    assert.equal(markAt([], 1), null);
  });

  it("puts one note at the end of the cursor's line, and moves it with the cursor", () => {
    const doc = "mod a;\nmod b;\n\nfn main() {\n    run();\n    stop();\n}\n";
    const note = new Compartment();
    let state = EditorState.create({ doc, extensions: [note.of(lineNote(marks))] });
    assert.deepEqual(notes(state), [{ at: 6, text: marks[0].note }], "line 1 to begin with");
    assert.equal(noteFor(state, marks)?.mark, marks[0]);

    const line5 = state.doc.line(5);
    state = state.update({ selection: EditorSelection.cursor(line5.from + 2) }).state;
    assert.deepEqual(notes(state), [{ at: line5.to, text: marks[1].note }]);

    state = state.update({ selection: EditorSelection.cursor(state.doc.line(6).from) }).state;
    assert.deepEqual(notes(state).map((n) => n.text), ["Not committed yet"]);

    // The last, empty line is past what git blamed: no note.
    state = state.update({ selection: EditorSelection.cursor(state.doc.length) }).state;
    assert.deepEqual(notes(state), []);
  });

  it("goes when line history is switched off, and comes back when it is on", () => {
    const note = new Compartment();
    let state = EditorState.create({ doc: "a\nb\n", extensions: [note.of(lineNote(marks))] });
    assert.equal(notes(state).length, 1);
    state = state.update({ effects: note.reconfigure(lineNote(null)) }).state;
    assert.deepEqual(notes(state), []);
    assert.deepEqual(lineNote([]), [], "no marks: nothing added to the editor");
    state = state.update({ effects: note.reconfigure(lineNote(marks)) }).state;
    assert.equal(notes(state).length, 1);
  });
});

/** Every suggestion offered at `pos`, by label, as the list would show them (one row per label and kind):
 * from the language's sources and ours, or from ours alone where they take the language's place. */
async function offered(state: EditorState, pos: number, explicit = false, lang: Language = "javascript"): Promise<string[]> {
  const out: string[] = [];
  const plan = SUGGEST[lang]!;
  for (const source of plan.own ? state.languageDataAt<CompletionSource>("autocomplete", pos) : sourcesOf(plan)) {
    const r = await source(new CompletionContext(state, pos, explicit));
    if (!r) continue;
    const typed = state.sliceDoc(r.from, pos).toLowerCase();
    for (const o of r.options) if (o.label.toLowerCase().startsWith(typed)) out.push(o.label);
  }
  return out.sort();
}

const editor = (doc: string, lang: Extension, name: Parameters<typeof suggestions>[0], on = true) => EditorState.create({ doc, extensions: [lang, suggestions(name, on)] });

describe("suggestions while typing", () => {
  it("gives every language a plan: its own sources where the package has them, words in the file, or nothing for prose", () => {
    for (const l of ["javascript", "typescript", "jsx", "tsx", "python", "sql"] as const) assert.deepEqual(SUGGEST[l], { own: true, words: "code" }, l);
    for (const l of Object.keys(SUGGEST) as Language[]) assert.ok(SUGGEST[l] === null || SUGGEST[l]!.own || SUGGEST[l]!.keywords || l === "json", `${l} has words of its own`);
    assert.equal(SUGGEST.rust?.words, "code");
    assert.ok(SUGGEST.rust?.keywords?.includes("match"));
    assert.deepEqual(SUGGEST.json, { words: "anywhere" });
    assert.equal(SUGGEST.markdown, null);
    assert.equal(SUGGEST.text, null);
    assert.deepEqual(suggestions("markdown", true), []);
    assert.deepEqual(suggestions("text", true), []);
  });

  it("offers a variable declared earlier, once, in TypeScript", async () => {
    const doc = "const totalPrice = 4;\nfunction addTax(amount: number) { return amount; }\nconsole.log(tot";
    const state = editor(doc, javascript({ typescript: true }), "typescript");
    assert.deepEqual(await offered(state, doc.length), ["totalPrice"], "from the names in scope, not again from the words in the file");
    const more = doc + ");\nadd";
    assert.deepEqual(await offered(editor(more, javascript({ typescript: true }), "typescript"), more.length), ["addTax"]);
  });

  it("offers a name used after a dot elsewhere in the file, which the language's own sources leave out", async () => {
    const doc = "basket.checkoutNow();\nother.che";
    assert.deepEqual(await offered(editor(doc, javascript(), "javascript"), doc.length), ["checkoutNow"]);
  });

  it("offers Python's names in scope and its own words", async () => {
    const doc = "student_count = 3\ndef student_names():\n    pass\nprint(stu";
    assert.deepEqual(await offered(editor(doc, python(), "python"), doc.length, false, "python"), ["student_count", "student_names"]);
    const kw = "x = 1\nwhi";
    assert.deepEqual(await offered(editor(kw, python(), "python"), kw.length, false, "python"), ["while"]);
  });

  it("offers Rust's keywords and the names already in the file", async () => {
    const doc = "fn main() {\n    let mut running_total = 0;\n    run";
    assert.deepEqual(await offered(editor(doc, rust(), "rust"), doc.length, false, "rust"), ["running_total"]);
    const kw = "fn main() {\n    mat";
    assert.deepEqual(await offered(editor(kw, rust(), "rust"), kw.length, false, "rust"), ["match"]);
    const member = "struct S;\nfn f(items: Vec<u8>) {\n    items.le";
    assert.deepEqual(await offered(editor(member, rust(), "rust"), member.length, false, "rust"), [], "no keyword after a dot, and no type knowledge yet");
  });

  it("offers SQL's keywords and the table names in the file", async () => {
    const doc = "CREATE TABLE customers (id INT);\nSELECT * FROM cust";
    assert.deepEqual(await offered(editor(doc, sql(), "sql"), doc.length, false, "sql"), ["customers"]);
    const kw = "sel";
    assert.ok((await offered(editor(kw, sql(), "sql"), kw.length, false, "sql")).some((l) => l.toLowerCase() === "select"));
  });

  it("stays out of comments and strings, unless asked with Ctrl+Space", async () => {
    const doc = "const totalPrice = 4;\n// the tot";
    const state = editor(doc, javascript(), "javascript");
    assert.deepEqual(await offered(state, doc.length), []);
    assert.deepEqual(await offered(state, doc.length, true), ["totalPrice"]);
    const str = 'let running_total = 0;\nlet s = "run';
    assert.deepEqual(await offered(editor(str, rust(), "rust"), str.length, false, "rust"), []);
    const py = "student_count = 3\n# stu";
    assert.deepEqual(await offered(editor(py, python(), "python"), py.length, false, "python"), []);
  });

  it("offers nothing while a number is typed", async () => {
    const doc = "let a1 = 10;\nlet b = 1";
    assert.deepEqual(await offered(editor(doc, rust(), "rust"), doc.length, false, "rust"), []);
  });

  it("offers JSON the keys and values already in the file, and none of JavaScript's words", async () => {
    const doc = '{ "dependencies": {}, "dep';
    // JSON's list takes the place of the JavaScript package's sources.
    assert.deepEqual(await offered(editor(doc, javascript(), "json"), doc.length, false, "json"), ["dependencies"]);
    assert.equal(SUGGEST.json?.own, undefined);
  });

  it("goes when the switch is off or the editor is read-only, and comes back", async () => {
    const doc = "student_count = 3\nprint(stu";
    const suggest = new Compartment();
    const ours = (state: EditorState) => state.facet(EditorState.languageData).length;
    const bare = ours(EditorState.create({ doc, extensions: [python()] }));
    let state = EditorState.create({ doc, extensions: [python(), suggest.of(suggestions("python", true))] });
    assert.equal(ours(state), bare + 1, "our sources beside Python's");
    assert.deepEqual(await offered(state, doc.length, false, "python"), ["student_count"]);
    state = state.update({ effects: suggest.reconfigure(suggestions("python", false)) }).state;
    assert.equal(ours(state), bare, "ours are gone");
    assert.deepEqual(suggestions("python", false), [], "and the list itself with them");
    assert.deepEqual(suggestions("rust", false), []);
    state = state.update({ effects: suggest.reconfigure(suggestions("python", true)) }).state;
    assert.equal(ours(state), bare + 1);
  });
});
