/**
 * Colours for code in the professor's answers: the editor's own grammars
 * (CodeMirror's Lezer parsers), read once into spans with tok-* classes that
 * learn.css colours. Unknown languages come back as plain text.
 */
import { javascriptLanguage, typescriptLanguage } from "@codemirror/lang-javascript";
import { pythonLanguage } from "@codemirror/lang-python";
import { rustLanguage } from "@codemirror/lang-rust";
import { StandardSQL } from "@codemirror/lang-sql";
import { classHighlighter, highlightCode } from "@lezer/highlight";
import type { Parser } from "@lezer/common";

export type Span = { text: string; cls: string };

const PARSERS: Record<string, () => Parser> = {
  rust: () => rustLanguage.parser,
  rs: () => rustLanguage.parser,
  python: () => pythonLanguage.parser,
  py: () => pythonLanguage.parser,
  javascript: () => javascriptLanguage.parser,
  js: () => javascriptLanguage.parser,
  jsx: () => javascriptLanguage.parser,
  typescript: () => typescriptLanguage.parser,
  ts: () => typescriptLanguage.parser,
  tsx: () => typescriptLanguage.parser,
  sql: () => StandardSQL.language.parser,
};

/** Long code is shown plain: colouring it is not worth the time it takes. */
const MAX = 20000;

/** The code as lines of coloured spans. */
export function highlight(code: string, lang: string): Span[][] {
  const parser = PARSERS[lang.toLowerCase()]?.();
  if (!parser || code.length > MAX) return code.split("\n").map((text) => [{ text, cls: "" }]);
  const lines: Span[][] = [[]];
  highlightCode(
    code,
    parser.parse(code),
    classHighlighter,
    (text, cls) => lines[lines.length - 1].push({ text, cls }),
    () => lines.push([]),
  );
  return lines;
}
