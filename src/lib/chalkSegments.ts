// An answer split for the chalkboard (src/components/Guide.tsx): fenced blocks
// (a ```mermaid diagram, other code) apart from the prose between them, so a
// blank line inside a diagram never cuts it in two. A fence still being written
// (the answer streaming) comes out with closed: false.
export type Segment = { kind: "prose"; body: string } | { kind: "fence"; lang: string; body: string; closed: boolean };

/** Fenced blocks first (a diagram or code may hold blank lines), then the prose between them. */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let prose: string[] = [];
  let fence: { lang: string; lines: string[] } | null = null;
  const flush = () => {
    const body = prose.join("\n").trim();
    if (body) out.push({ kind: "prose", body });
    prose = [];
  };
  for (const line of text.split("\n")) {
    const m = /^\s*```\s*([\w-]*)/.exec(line);
    if (fence) {
      if (m && !m[1]) {
        out.push({ kind: "fence", lang: fence.lang, body: fence.lines.join("\n"), closed: true });
        fence = null;
      } else fence.lines.push(line);
    } else if (m) {
      flush();
      fence = { lang: m[1].toLowerCase(), lines: [] };
    } else prose.push(line);
  }
  if (fence) out.push({ kind: "fence", lang: fence.lang, body: fence.lines.join("\n"), closed: false });
  flush();
  return out;
}

/** A block's lines as runs: markdown tables (a header row, then |---| under it) and everything else. */
export function tableRuns(lines: string[]): ({ kind: "text"; lines: string[] } | { kind: "table"; head: string[]; rows: string[][] })[] {
  const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const isRule = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const cells = (l: string) =>
    l
      .trim()
      .replace(/^\||\|$/g, "")
      .replace(/\\\|/g, "\u0000")
      .split("|")
      .map((c) => c.replace(/\u0000/g, "|").trim());
  const out: ReturnType<typeof tableRuns> = [];
  let text: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isRow(lines[i]) && i + 1 < lines.length && isRule(lines[i + 1])) {
      if (text.length) out.push({ kind: "text", lines: text });
      text = [];
      const head = cells(lines[i]);
      const rows: string[][] = [];
      i += 2;
      for (; i < lines.length && isRow(lines[i]); i++) rows.push(cells(lines[i]));
      i--;
      out.push({ kind: "table", head, rows });
    } else text.push(lines[i]);
  }
  if (text.length) out.push({ kind: "text", lines: text });
  return out;
}
