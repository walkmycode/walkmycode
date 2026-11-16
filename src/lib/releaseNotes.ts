// A release's notes as the update modal shows them (src/components/UpdateModal.tsx, mockup
// docs/design/update-modal.html). The notes are release-please's CHANGELOG section, written in the
// private development repo: "### Features" then "* **learn:** talk with … ([#53](…)) ([5daa221](…))".
// Read here into plain items: the kind from the heading, the area from the scope, and the text without
// links (they point into the private repo) or commit hashes.

export type NoteKind = "new" | "fixed" | "better" | "changed";

export interface NoteItem {
  kind: NoteKind;
  /** The part of the app, from the commit's scope ("Learn", "Explore, Learn"); empty when it had none. */
  area: string;
  text: string;
}

const KINDS: [RegExp, NoteKind][] = [
  [/^feat/i, "new"],
  [/^(bug )?fix/i, "fixed"],
  [/^perf/i, "better"],
];
const WORDS: Record<string, string> = { ide: "IDE", mcp: "MCP", ai: "AI", ui: "UI", api: "API", ci: "CI" };

const area = (scope: string) =>
  scope
    .split(/\s*,\s*/)
    .filter(Boolean)
    .map((w) => WORDS[w.toLowerCase()] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(", ");

/** One bullet's text, plain: links to their words, the trailing (#53) and (5daa221) refs gone. */
function plain(text: string): string {
  return text
    .replace(/\s*\(\[#?\w+\]\([^)]*\)\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The notes' items, newest section's order kept. Sections other than features, fixes and performance
 * (reverts, docs) come out as "changed". Notes in no known shape give one item of their plain text. */
export function releaseNotes(md: string | null | undefined): NoteItem[] {
  if (!md?.trim()) return [];
  const items: NoteItem[] = [];
  let kind: NoteKind = "changed";
  for (const line of md.split(/\r?\n/)) {
    const head = /^#{3,4}\s+(.*)$/.exec(line);
    if (head) {
      kind = KINDS.find(([re]) => re.test(head[1].trim()))?.[1] ?? "changed";
      continue;
    }
    const bullet = /^\s*[*-]\s+(.*)$/.exec(line);
    if (!bullet) continue;
    const scoped = /^\*\*([^*:]+):\*\*\s*(.*)$/.exec(bullet[1]);
    const text = plain(scoped ? scoped[2] : bullet[1]);
    if (!text) continue;
    items.push({ kind, area: scoped ? area(scoped[1]) : "", text: text.charAt(0).toUpperCase() + text.slice(1) });
  }
  if (items.length) return items;
  const text = plain(md.replace(/^#+.*$/gm, ""));
  return text ? [{ kind: "changed", area: "", text }] : [];
}

/** "96.4 MB" */
export function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 2 : 1)} MB`;
}
