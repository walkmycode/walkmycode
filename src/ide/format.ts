// "Format this file" in the Code panel (src/ide/Ide.tsx): which of Prettier's parsers reads a file,
// which of its plugins that needs, and the project's own Prettier settings, from the files the
// workspace has. No Prettier here (./formatRun.ts loads it, only when Format is pressed) and no
// browser, so tests can load it.

/** Prettier's plugins this app can load (prettier/plugins/<id>). */
export type PrettierPlugin = "babel" | "estree" | "typescript" | "postcss" | "html" | "markdown" | "yaml" | "graphql";

/** How Prettier reads a file: its parser and the plugins that parser needs. */
export interface FormatPlan {
  parser: string;
  plugins: PrettierPlugin[];
}

const JS: PrettierPlugin[] = ["babel", "estree"];
const TS: PrettierPlugin[] = ["typescript", "estree"];

/** The parser for a file name, or null when Prettier can't format it here. */
export function formatPlanFor(path: string | null | undefined): FormatPlan | null {
  if (!path) return null;
  const name = path.split("/").pop()!.toLowerCase();
  // package.json and its lock file keep their own key order and layout, as npm writes them.
  if (name === "package.json" || name === "package-lock.json" || name === "composer.json") return { parser: "json-stringify", plugins: JS };
  const ext = /\.([^.]+)$/.exec(name)?.[1] ?? "";
  switch (ext) {
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
      return { parser: "babel", plugins: JS };
    case "ts":
    case "mts":
    case "cts":
    case "tsx":
      return { parser: "typescript", plugins: TS };
    case "json":
    case "webmanifest":
      return { parser: "json", plugins: JS };
    case "jsonc":
      return { parser: "jsonc", plugins: JS };
    case "json5":
      return { parser: "json5", plugins: JS };
    case "css":
      return { parser: "css", plugins: ["postcss"] };
    case "scss":
      return { parser: "scss", plugins: ["postcss"] };
    case "less":
      return { parser: "less", plugins: ["postcss"] };
    case "html":
    case "htm":
      // The scripts and styles inside it are formatted too.
      return { parser: "html", plugins: ["html", "babel", "estree", "postcss"] };
    case "md":
    case "markdown":
      return { parser: "markdown", plugins: ["markdown"] };
    case "yml":
    case "yaml":
      return { parser: "yaml", plugins: ["yaml"] };
    case "graphql":
    case "gql":
      return { parser: "graphql", plugins: ["graphql"] };
    default:
      return null;
  }
}

const NAMES: Record<string, string> = {
  py: "Python",
  pyw: "Python",
  rs: "Rust",
  go: "Go",
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin",
  cs: "C#",
  c: "C",
  h: "C",
  cpp: "C++",
  cc: "C++",
  hpp: "C++",
  dart: "Dart",
  php: "PHP",
  rb: "Ruby",
  swift: "Swift",
  sql: "SQL",
  sh: "shell",
  toml: "TOML",
  xml: "XML",
  mdx: "MDX",
  vue: "Vue",
  svelte: "Svelte",
};

/** Why Format is off for a file, in a few plain words; null when it can be formatted. */
export function formatUnavailable(path: string | null | undefined): string | null {
  if (formatPlanFor(path)) return null;
  const name = (path ?? "").split("/").pop() ?? "";
  const ext = /\.([^.]+)$/.exec(name.toLowerCase())?.[1];
  if (!ext) return "Formatting this file isn’t available yet";
  return `Formatting ${NAMES[ext] ?? `.${ext}`} files isn’t available yet`;
}

/** Prettier's settings that change how code is laid out, and what each must be. Anything else in a
 * project's config (plugins, overrides, a parser) is left out: this app loads its own. The line
 * ending is left out too: the editor keeps lines, and Save puts back the file's own endings. */
const OPTIONS: Record<string, "number" | "boolean" | readonly string[]> = {
  printWidth: "number",
  tabWidth: "number",
  useTabs: "boolean",
  semi: "boolean",
  singleQuote: "boolean",
  jsxSingleQuote: "boolean",
  quoteProps: ["as-needed", "consistent", "preserve"],
  trailingComma: ["all", "es5", "none"],
  bracketSpacing: "boolean",
  objectWrap: ["preserve", "collapse"],
  bracketSameLine: "boolean",
  arrowParens: ["always", "avoid"],
  proseWrap: ["always", "never", "preserve"],
  htmlWhitespaceSensitivity: ["css", "strict", "ignore"],
  singleAttributePerLine: "boolean",
  embeddedLanguageFormatting: ["auto", "off"],
  experimentalTernaries: "boolean",
};

/** The layout settings in a Prettier config object, each checked; anything else dropped. */
export function cleanPrettierOptions(raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const want = OPTIONS[k];
    if (!want) continue;
    if (want === "number" ? typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1000 : want === "boolean" ? typeof v === "boolean" : typeof v === "string" && want.includes(v)) out[k] = v;
  }
  return out;
}

/** The project's Prettier settings for a file: the nearest folder (the file's own, then up) with a
 * `package.json` that has a "prettier" object, a `.prettierrc` or a `.prettierrc.json`, as Prettier
 * looks. Only the JSON forms are read: a config in YAML or JavaScript means Prettier's defaults.
 * `from` is the file the settings came from; null when there is none. */
export function prettierConfigFor(path: string, files: Readonly<Record<string, string>>): { options: Record<string, unknown>; from: string | null } {
  const parts = path.split("/");
  for (let n = parts.length - 1; n >= 0; n--) {
    const dir = parts.slice(0, n).join("/");
    const at = (name: string) => (dir ? `${dir}/${name}` : name);
    const pkg = files[at("package.json")];
    if (pkg !== undefined) {
      const j = parseJson(pkg);
      if (j && typeof j === "object" && "prettier" in j) {
        const p = (j as Record<string, unknown>).prettier;
        // A string names a shared config package, which can't be loaded here.
        return { options: typeof p === "object" ? cleanPrettierOptions(p) : {}, from: at("package.json") };
      }
    }
    for (const name of [".prettierrc", ".prettierrc.json"]) {
      const text = files[at(name)];
      if (text === undefined) continue;
      return { options: cleanPrettierOptions(parseJson(text)), from: at(name) };
    }
  }
  return { options: {}, from: null };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Prettier's error for code it can't read, in plain words: where it stopped and why, without the
 * code frame it prints under it. */
export function formatError(e: unknown): string {
  const err = e as { message?: unknown; loc?: { start?: { line?: number; column?: number } } };
  const raw = typeof err?.message === "string" ? err.message : String(e);
  const first = raw.split("\n")[0].replace(/\s*\(\d+:\d+\)\s*$/, "").trim();
  const line = err?.loc?.start?.line;
  const col = err?.loc?.start?.column;
  const where = line ? ` at line ${line}${col ? `, column ${col}` : ""}` : "";
  return `Couldn’t format: the code has a mistake${where}. ${first || "Prettier couldn’t read it."} Nothing was changed.`;
}

/** The one change that turns `a` into `b`, leaving out what the two share at the start and the end, so
 * the cursor and the lines around an edit stay put. */
export function smallestChange(a: string, b: string): { from: number; to: number; insert: string } {
  let start = 0;
  const most = Math.min(a.length, b.length);
  while (start < most && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  let end = 0;
  while (end < most - start && a.charCodeAt(a.length - 1 - end) === b.charCodeAt(b.length - 1 - end)) end++;
  return { from: start, to: a.length - end, insert: b.slice(start, b.length - end) };
}
