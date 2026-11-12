// The languages "Run on: This computer" knows, by file ending. Plain data with
// no Node imports, so the page (src/ide/Ide.tsx) and the server
// (./toolchains.ts) share it.

export type LocalLang =
  | "python"
  | "javascript"
  | "typescript"
  | "go"
  | "rust"
  | "java"
  | "php"
  | "ruby"
  | "csharp"
  | "shell"
  | "powershell"
  | "batch"
  | "sql";

/** File endings, lower case, with the dot. */
export const LOCAL_EXT: Record<LocalLang, string[]> = {
  python: [".py", ".pyw"],
  javascript: [".js", ".mjs", ".cjs"],
  typescript: [".ts", ".mts", ".cts", ".tsx", ".jsx"],
  go: [".go"],
  rust: [".rs"],
  java: [".java"],
  php: [".php"],
  ruby: [".rb"],
  csharp: [".cs"],
  shell: [".sh", ".bash"],
  powershell: [".ps1"],
  batch: [".bat", ".cmd"],
  sql: [".sql"],
};

export const LOCAL_LANGS = Object.keys(LOCAL_EXT) as LocalLang[];

/** The local language of a file, from its ending; null when this computer has nothing to run it with. */
export function localLangOf(path: string | null | undefined): LocalLang | null {
  if (!path) return null;
  const m = /(\.[A-Za-z0-9]+)$/.exec(path);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  return LOCAL_LANGS.find((l) => LOCAL_EXT[l].includes(ext)) ?? null;
}

/** The editor's language names (src/ide/Editor.tsx) to a local one, for code with no file name. */
export function localLangFromEditor(language: string): LocalLang | null {
  if (language === "python" || language === "javascript" || language === "typescript" || language === "rust" || language === "sql") return language;
  if (language === "jsx" || language === "tsx") return "typescript";
  return null;
}

/** A file name for code with none. */
export function defaultFileName(lang: LocalLang): string {
  if (lang === "java") return "Main.java";
  if (lang === "rust") return "main.rs";
  return `main${LOCAL_EXT[lang][0]}`;
}
