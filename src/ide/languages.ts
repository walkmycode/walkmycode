// The languages the editor colours (Editor.tsx), by file extension, and each one's CodeMirror
// parser. Most are CodeMirror's own Lezer packages; C#, Dart and Kotlin have none that is maintained, so
// they use the stream modes CodeMirror keeps in @codemirror/legacy-modes. A fenced block in
// Markdown is coloured in its own language. Plain CodeMirror, no React, so tests can load it.
import { cpp, cppLanguage } from "@codemirror/lang-cpp";
import { java, javaLanguage } from "@codemirror/lang-java";
import { javascript, javascriptLanguage, jsxLanguage, tsxLanguage, typescriptLanguage } from "@codemirror/lang-javascript";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { php } from "@codemirror/lang-php";
import { python, pythonLanguage } from "@codemirror/lang-python";
import { rust, rustLanguage } from "@codemirror/lang-rust";
import { StandardSQL, sql } from "@codemirror/lang-sql";
import { StreamLanguage, type StreamParser } from "@codemirror/language";
import { csharp, dart, kotlin } from "@codemirror/legacy-modes/mode/clike";
import type { Extension } from "@codemirror/state";
import { Tag, styleTags } from "@lezer/highlight";

/** The mark that starts a list item, coloured on its own (VS Code does). */
export const listMark = Tag.define();

// The legacy modes are typed against their own copy of the stream parser's types: the same shape.
const stream = (mode: unknown) => StreamLanguage.define(mode as StreamParser<unknown>);
const csharpLanguage = stream(csharp);
const dartLanguage = stream(dart);
const kotlinLanguage = stream(kotlin);
const plainPhp = php({ plain: true }).language;

export type Language = "python" | "javascript" | "typescript" | "jsx" | "tsx" | "json" | "sql" | "rust" | "c" | "cpp" | "csharp" | "java" | "kotlin" | "dart" | "php" | "markdown" | "text";

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
  // A .h is read as C: C++ headers that need more usually say .hpp.
  if (/\.[ch]$/.test(path)) return "c";
  if (/\.(cpp|cc|cxx|hpp|hh|hxx)$/.test(path)) return "cpp";
  if (/\.cs$/.test(path)) return "csharp";
  if (/\.java$/.test(path)) return "java";
  if (/\.kts?$/.test(path)) return "kotlin";
  if (/\.dart$/.test(path)) return "dart";
  // A Blade view (x.blade.php) too: HTML with PHP in it.
  if (/\.php$/.test(path)) return "php";
  if (/\.(md|markdown|mdx)$/i.test(path)) return "markdown";
  return "text";
}

export function languageExtension(lang: Language): Extension {
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
    case "c":
    case "cpp":
      return cpp();
    case "java":
      return java();
    case "csharp":
      return csharpLanguage;
    case "dart":
      return dartLanguage;
    case "kotlin":
      return kotlinLanguage;
    case "php":
      // HTML until <?php, as a .php file is.
      return php();
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
  if (["c", "h", "cpp", "c++", "cc", "cxx", "hpp"].includes(name)) return cppLanguage;
  if (["cs", "csharp", "c#"].includes(name)) return csharpLanguage;
  if (name === "java") return javaLanguage;
  if (name === "dart") return dartLanguage;
  if (["kotlin", "kt", "kts"].includes(name)) return kotlinLanguage;
  // A fenced block of PHP rarely starts with <?php.
  if (name === "php") return plainPhp;
  if (name === "sql") return StandardSQL.language;
  return null;
}
