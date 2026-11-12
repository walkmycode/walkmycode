/**
 * The links between WalkMyCode's two rooms.
 *
 * Explore → Learn, "Teach me this": a lesson on a concept, taught with the
 * user's own code as the running example.
 *   /learn?teach=<topic>&from=<path>:<start>-<end>[&snippet=<code>]
 *
 * Learn → Explore, "See it in a real codebase": the map focused on a file,
 * its lines and a symbol (the shape the Explore room parses).
 *   /map?focus=<path>[:<start>[-<end>]][#<symbol>]
 */

/** The longest snippet carried in a link; longer code is cut at a line end. */
export const SNIPPET_MAX = 4096;

export type TeachRequest = { topic: string; file?: string; start?: number; end?: number; snippet?: string };

function trimSnippet(code: string) {
  if (code.length <= SNIPPET_MAX) return code;
  const cut = code.lastIndexOf("\n", SNIPPET_MAX);
  return code.slice(0, cut > 0 ? cut : SNIPPET_MAX);
}

export function teachHref({ topic, file, start, end, snippet }: TeachRequest): string {
  const q = new URLSearchParams({ teach: topic });
  if (file) q.set("from", `${file}${start ? `:${start}${end && end !== start ? `-${end}` : ""}` : ""}`);
  if (snippet) q.set("snippet", trimSnippet(snippet));
  return `/learn?${q.toString()}`;
}

/** Read a "Teach me this" request from the Learn page's address, if there is one. */
export function readTeach(search: string): TeachRequest | null {
  const q = new URLSearchParams(search);
  const topic = q.get("teach")?.trim();
  if (!topic) return null;
  const from = q.get("from") ?? "";
  const m = from.match(/^(.*?)(?::(\d+)(?:-(\d+))?)?$/);
  const snippet = q.get("snippet") ?? undefined;
  return {
    topic: topic.slice(0, 200),
    ...(m && m[1] ? { file: m[1] } : {}),
    ...(m && m[2] ? { start: Number(m[2]) } : {}),
    ...(m && m[3] ? { end: Number(m[3]) } : {}),
    ...(snippet ? { snippet: trimSnippet(snippet) } : {}),
  };
}

export function mapHref(file: string, opts: { start?: number; end?: number; symbol?: string } = {}): string {
  const { start, end, symbol } = opts;
  const focus = `${file}${start ? `:${start}${end && end !== start ? `-${end}` : ""}` : ""}${symbol ? `#${symbol}` : ""}`;
  return `/map?${new URLSearchParams({ focus }).toString()}`;
}
