// Formats a file with Prettier, in this page (./format.ts says which parser and settings). Prettier and
// the plugins a file needs are loaded the first time Format is pressed for that kind of file, never
// with the editor.
import { formatPlanFor, type PrettierPlugin } from "./format";

const LOAD: Record<PrettierPlugin, () => Promise<unknown>> = {
  babel: () => import("prettier/plugins/babel"),
  estree: () => import("prettier/plugins/estree"),
  typescript: () => import("prettier/plugins/typescript"),
  postcss: () => import("prettier/plugins/postcss"),
  html: () => import("prettier/plugins/html"),
  markdown: () => import("prettier/plugins/markdown"),
  yaml: () => import("prettier/plugins/yaml"),
  graphql: () => import("prettier/plugins/graphql"),
};

/** The formatted text and where the cursor goes in it; throws Prettier's error when the code can't be
 * read (./format.ts formatError says it plainly). Null for a file Prettier can't format here. */
export async function formatText(path: string, text: string, cursor: number, options: Record<string, unknown>): Promise<{ text: string; cursor: number } | null> {
  const plan = formatPlanFor(path);
  if (!plan) return null;
  const [prettier, ...plugins] = await Promise.all([import("prettier/standalone"), ...plan.plugins.map((p) => LOAD[p]())]);
  const r = await prettier.formatWithCursor(text, {
    ...options,
    parser: plan.parser,
    plugins: plugins as never[],
    filepath: path,
    endOfLine: "lf",
    cursorOffset: Math.max(0, Math.min(cursor, text.length)),
  });
  return { text: r.formatted, cursor: r.cursorOffset };
}
