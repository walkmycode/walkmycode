// Loads tree-sitter grammars once. In the browser they come from /wasm
// (copied there by scripts/copy-wasm.mjs; in WalkMyCode Lite, wasm/ next to the
// page, see assets.ts); a Node caller (the CLI indexer) registers its own
// loader with setGrammarLoader so this file stays free of Node imports and
// bundles cleanly for the client.
import { Language, Parser, type Node } from "web-tree-sitter";
import { assetUrl } from "./assets";

export type GrammarName = "tsx" | "typescript" | "javascript" | "python" | "dart" | "php";

/** Each grammar's file, from node_modules. No npm package ships a Dart grammar
 * this runtime loads, so it is built from source and kept in vendor/
 * (vendor/tree-sitter-dart/README.md says how). PHP is the full grammar, not
 * php_only: a .php file may mix HTML with <?php, and a Blade view is mostly HTML. */
export const GRAMMAR_FILES: Record<GrammarName, string> = {
  tsx: "tree-sitter-typescript/tree-sitter-tsx.wasm",
  typescript: "tree-sitter-typescript/tree-sitter-typescript.wasm",
  javascript: "tree-sitter-javascript/tree-sitter-javascript.wasm",
  python: "tree-sitter-python/tree-sitter-python.wasm",
  dart: "../vendor/tree-sitter-dart/tree-sitter-dart.wasm",
  php: "tree-sitter-php/tree-sitter-php.wasm",
};

type Loader = (name: GrammarName) => Promise<string | Uint8Array>;
// A page or a Web Worker (the map is built in one: build.worker.ts), not Node.
const isBrowser = typeof window !== "undefined" || typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== "undefined";
let loader: Loader = async (name) => assetUrl(`wasm/${GRAMMAR_FILES[name].split("/").pop()}`);
let initPromise: Promise<void> | null = null;
const languages = new Map<GrammarName, Promise<Language>>();

export function setGrammarLoader(fn: Loader) {
  loader = fn;
  languages.clear();
}

function init(): Promise<void> {
  if (!initPromise) initPromise = isBrowser ? Parser.init({ locateFile: (f: string) => assetUrl(`wasm/${f}`) }) : Parser.init();
  return initPromise;
}

export async function getLanguage(name: GrammarName): Promise<Language> {
  await init();
  let p = languages.get(name);
  if (!p) {
    p = loader(name).then((src) => Language.load(src));
    languages.set(name, p);
  }
  return p;
}

export async function parse(name: GrammarName, source: string): Promise<Node> {
  const lang = await getLanguage(name);
  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(source);
  if (!tree) throw new Error(`tree-sitter could not parse (${name})`);
  const root = tree.rootNode;
  parser.delete();
  return root;
}

/** A JS/TS config file (next.config.js, vite.config.ts) parsed on its own, for
 * the config readers; null when the path has no JS grammar. */
export async function parseJsSnippet(path: string, source: string): Promise<Node | null> {
  const g = grammarFor(path);
  if (!g || g === "python" || g === "dart" || g === "php") return null;
  return parse(g, source);
}

export function grammarFor(path: string): GrammarName | null {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "tsx":
      return "tsx";
    case "ts":
    case "mts":
    case "cts":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "py":
      return "python";
    case "dart":
      return "dart";
    case "php":
      return "php";
    default:
      return null;
  }
}
