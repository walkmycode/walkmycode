// Suggestions while typing in the editor (Settings → Editor, src/lib/editorSettings.ts). No
// knowledge of types: a name is offered because it is already in the file (declare a variable, and
// it is offered when you start typing it later), or because it is one of the language's own words.
// Where CodeMirror's language package brings its own sources they are used too: JavaScript and
// TypeScript (names in scope, keywords, snippets), Python (the same, and its built-ins), SQL
// (keywords). The others get their keywords and the file's words. SUGGEST says what each gets. Suggestions that know types (a struct's
// methods, what a Vec can do) are a later step: one more switch, and one more source added here.
//
// Keys: Enter or Tab takes the suggestion, Esc closes the list, the arrows move in it,
// Ctrl+Space opens it. With no list open, Tab indents and Enter starts a line, as before.
// Plain CodeMirror, no React, so tests can load it.
import { acceptCompletion, autocompletion, completeAnyWord, completeFromList, type CompletionContext, type CompletionSource } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { EditorState, Prec, type Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import type { Language } from "./languages";

export interface SuggestPlan {
  /** Keep the language package's own sources (names in scope, keywords, snippets) and add to them;
   * without it, only what is listed here is offered. */
  own?: boolean;
  /** The language's words, where its package has no sources of its own. */
  keywords?: readonly string[];
  /** Words already in the file: in code only, or anywhere (JSON, where every name is in quotes). */
  words: "code" | "anywhere";
}

const words = (s: string) => s.split(" ");

/** Rust's keywords and the types everyone writes (the reference's list; CodeMirror's Rust package has no sources). */
const RUST = words(
  "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type union unsafe use where while " +
    "bool char f32 f64 i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize str String Vec Option Some None Result Ok Err Box",
);

/** C and C++ (C++'s list holds C's). */
const C = words(
  "auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while " +
    "bool true false NULL size_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t",
);
const CPP = [
  ...C,
  ...words(
    "alignas alignof catch class concept consteval constexpr constinit const_cast co_await co_return co_yield decltype delete dynamic_cast explicit export friend mutable namespace new noexcept nullptr operator override final " +
      "private protected public reinterpret_cast requires static_assert static_cast template this thread_local throw try typeid typename using virtual wchar_t std string vector map unique_ptr shared_ptr",
  ),
];
const JAVA = words(
  "abstract assert boolean break byte case catch char class continue default do double else enum extends final finally float for if implements import instanceof int interface long native new null package private protected public " +
    "record return sealed short static super switch synchronized this throw throws transient try var void volatile while true false String Integer Long Double Boolean Object List Map Set Optional Override",
);
const CSHARP = words(
  "abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach get goto if implicit in init int " +
    "interface internal is lock long namespace new null object operator out override params partial private protected public readonly record ref required return sbyte sealed set short sizeof static string struct switch this throw " +
    "true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile where while yield String List Dictionary Task IEnumerable Console",
);
const KOTLIN = words(
  "abstract actual annotation as break by catch class companion const constructor continue crossinline data do dynamic else enum expect external false final finally for fun get if import in infix init inline inner interface " +
    "internal is lateinit noinline null object open operator out override package private protected public reified return sealed set super suspend tailrec this throw true try typealias val var vararg when where while " +
    "Any Boolean Byte Char Double Float Int Long Short String Unit Nothing Array List Map Set MutableList MutableMap MutableSet Pair",
);
const DART = words(
  "abstract as assert async await base break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for Function get hide if implements import " +
    "in interface is late library mixin new null on operator part required rethrow return sealed set show static super switch sync this throw true try typedef var void when while with yield " +
    "int double num bool String List Map Set Future Stream Object Widget BuildContext",
);
const PHP = words(
  "abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum extends false final finally fn for foreach function " +
    "global if implements include include_once instanceof insteadof interface isset list match namespace new null or print private protected public readonly require require_once return static switch throw trait true try unset use " +
    "var while xor yield bool int float string iterable mixed object void self parent",
);

/** What each language is offered; null is nothing. Markdown and plain text are prose: a list that
 * takes Enter would get in the way of writing. JSON has no words of its own: the keys and values
 * already in the file. */
export const SUGGEST: Record<Language, SuggestPlan | null> = {
  javascript: { own: true, words: "code" },
  typescript: { own: true, words: "code" },
  jsx: { own: true, words: "code" },
  tsx: { own: true, words: "code" },
  python: { own: true, words: "code" },
  sql: { own: true, words: "code" },
  rust: { keywords: RUST, words: "code" },
  c: { keywords: C, words: "code" },
  cpp: { keywords: CPP, words: "code" },
  java: { keywords: JAVA, words: "code" },
  csharp: { keywords: CSHARP, words: "code" },
  kotlin: { keywords: KOTLIN, words: "code" },
  dart: { keywords: DART, words: "code" },
  // In a .php file the HTML around the PHP keeps its own suggestions (tags).
  php: { own: true, keywords: PHP, words: "code" },
  json: { words: "anywhere" },
  markdown: null,
  text: null,
};

const PROSE = /comment|string|regexp|char|JSXText|heredoc|textblock|^Text$/i;

/** Is the cursor in a comment or a string? (Not in code put inside one: `${name}`, f"{name}".) */
function inProse(ctx: CompletionContext): boolean {
  const n = syntaxTree(ctx.state).resolveInner(ctx.pos, -1);
  return PROSE.test(n.name) || (!!n.parent && n.firstChild === null && PROSE.test(n.parent.name));
}

/** The language's words. Not in a comment or a string, and not after a dot (a member's name goes there). */
export function keywordSource(list: readonly string[]): CompletionSource {
  const from = completeFromList(list.map((label) => ({ label, type: /^[A-Z]|^(bool|char|str|[fiu]\d+|[iu]size)$/.test(label) ? "type" : "keyword" })));
  return (ctx) => {
    if (!ctx.explicit && inProse(ctx)) return null;
    const w = ctx.matchBefore(/[\w$]*/);
    const at = w ? w.from : ctx.pos;
    if (ctx.state.sliceDoc(at - 1, at) === "." && ctx.state.sliceDoc(at - 2, at - 1) !== ".") return null;
    return from(ctx);
  };
}

type Listed = CompletionSource | readonly (string | { label: string })[];

/** Words already in the file. A name another source offers too (a variable in scope, a keyword)
 * is left to that source, so nothing is listed twice: `others` are those sources, or "language"
 * for whatever the language has at the cursor. Never while a number is being typed. */
export function wordSource(where: "code" | "anywhere", others: "language" | readonly CompletionSource[] = []): CompletionSource {
  const self: CompletionSource = async (ctx) => {
    if (where === "code" && !ctx.explicit && inProse(ctx)) return null;
    const r = await completeAnyWord(ctx);
    if (!r || /^\d/.test(ctx.state.sliceDoc(r.from, ctx.pos))) return null;
    const taken = new Set<string>();
    for (const other of others === "language" ? ctx.state.languageDataAt<Listed>("autocomplete", ctx.pos) : others) {
      if (other === self) continue;
      // A language may give a plain list of words in place of a source.
      if (typeof other !== "function") for (const o of other) taken.add(typeof o === "string" ? o : o.label);
      else for (const o of (await other(ctx))?.options ?? []) taken.add(o.label);
    }
    const left = r.options.filter((o) => !taken.has(o.label));
    // Below what the language itself knows is declared: a word seen somewhere is a weaker guess.
    return { ...r, options: others === "language" ? left.map((o) => ({ ...o, boost: -1 })) : left };
  };
  return self;
}

/** A plan's own sources: the keywords, when it has a list, then the file's words. */
export function sourcesOf(plan: SuggestPlan): CompletionSource[] {
  const keywords = plan.keywords ? [keywordSource(plan.keywords)] : [];
  return [...keywords, wordSource(plan.words, plan.own ? "language" : keywords)];
}

/** The editor's suggestions for a language: nothing when the switch is off, the editor is
 * read-only, or the language is prose. */
export function suggestions(lang: Language, on: boolean): Extension {
  const plan = on ? SUGGEST[lang] : null;
  if (!plan) return [];
  const mine = sourcesOf(plan);
  return [
    // Beside the language's own sources, or in place of them: JSON is coloured by the JavaScript
    // package, whose keywords are not JSON's, and the C# and Dart modes' lists open in comments too.
    plan.own ? [autocompletion(), EditorState.languageData.of(() => mine.map((autocomplete) => ({ autocomplete })))] : autocompletion({ override: mine }),
    // Tab takes the suggestion while the list is open; otherwise it falls through and indents.
    Prec.highest(keymap.of([{ key: "Tab", run: acceptCompletion }])),
  ];
}
