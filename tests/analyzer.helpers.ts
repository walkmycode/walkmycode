// Shared bits for analyzer tests: read a fixture repo with the CLI's rules,
// load the grammars from node_modules, build its map.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildMap, type BuildOptions, type BuildResult } from "../src/analyzer/build";
import { extractJs } from "../src/analyzer/extract/js";
import { extractPy } from "../src/analyzer/extract/py";
import { extractDart } from "../src/analyzer/extract/dart";
import { extractPhp } from "../src/analyzer/extract/php";
import type { FileFacts } from "../src/analyzer/facts";
import { GRAMMAR_FILES, grammarFor, parse, setGrammarLoader } from "../src/analyzer/parser";
import type { SourceFile } from "../src/analyzer/types";
import { readDir } from "../scripts/readDir";

setGrammarLoader(async (name) => new Uint8Array(await readFile(join(process.cwd(), "node_modules", GRAMMAR_FILES[name]))));

export const FIXTURES = join(process.cwd(), "tests", "fixtures");

export function readFixture(name: string): Promise<SourceFile[]> {
  return readDir(join(FIXTURES, name));
}

export async function buildFixture(name: string, opts: Partial<BuildOptions> = {}): Promise<BuildResult> {
  const sources = await readFixture(name);
  return buildMap(sources, { name, ...opts });
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

/** Facts of one file given as a snippet, by the grammar its path picks. */
export async function factsOf(path: string, content: string): Promise<FileFacts> {
  const g = grammarFor(path);
  if (!g) throw new Error(`no grammar for ${path}`);
  const root = await parse(g, content);
  return g === "python" ? extractPy(root, content) : g === "dart" ? extractDart(root, content) : g === "php" ? extractPhp(root, content, path) : extractJs(root, content);
}
