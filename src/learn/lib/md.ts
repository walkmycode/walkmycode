/**
 * The professor's answers are written in light Markdown: paragraphs, fenced
 * code, short lists, and a "💡" line for an analogy. This reads an answer into
 * blocks; Markdown.tsx draws them. It never produces HTML, so an answer can
 * never inject markup into the page. An answer still arriving may end inside a
 * code block: that block is marked open and drawn as far as it has come.
 */
export type MdBlock =
  | { t: "p"; text: string }
  | { t: "code"; lang: string; code: string; open: boolean }
  | { t: "list"; ordered: boolean; items: string[] }
  /** An analogy: a line starting with 💡 (with or without a quote mark). */
  | { t: "callout"; text: string }
  | { t: "quote"; text: string };

/**
 * A line's emphasis: the pieces of `text` in order, with *italic* runs marked.
 * Code spans are left whole, so the star in `*ptr` is never read as emphasis,
 * and **bold** is left for the chalk markup to draw.
 */
export function emphasis(text: string): { text: string; em: boolean }[] {
  const out: { text: string; em: boolean }[] = [];
  const push = (t: string, em: boolean) => {
    if (!t) return;
    const last = out.at(-1);
    if (last && last.em === em) last.text += t;
    else out.push({ text: t, em });
  };
  // Code spans and maths first, so nothing inside them is touched.
  for (const part of text.split(/(`[^`\n]*`|\$\$.+?\$\$)/)) {
    if (part.startsWith("`") || part.startsWith("$$")) {
      push(part, false);
      continue;
    }
    let last = 0;
    for (const m of part.matchAll(/(?<![*\w\\])\*(?![\s*])([^*\n]+?)(?<![\s*])\*(?![*\w])/g)) {
      push(part.slice(last, m.index), false);
      push(m[1], true);
      last = (m.index ?? 0) + m[0].length;
    }
    push(part.slice(last), false);
  }
  return out;
}

const FENCE = /^\s*(```|~~~)\s*([\w+#.-]*)\s*$/;
const ITEM = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/;
const BULB = /^\s*💡/u;

export function parseMd(text: string): MdBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: MdBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ t: "p", text: para.join("\n") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      let open = true;
      for (i++; i < lines.length; i++) {
        const close = FENCE.exec(lines[i]);
        if (close && close[1] === fence[1] && !close[2]) {
          open = false;
          break;
        }
        code.push(lines[i]);
      }
      out.push({ t: "code", lang: fence[2].toLowerCase(), code: code.join("\n"), open });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const quoted = /^\s*>\s?(.*)$/.exec(line);
    const body = quoted ? quoted[1] : line;
    if (BULB.test(body) || quoted) {
      flush();
      const kind = BULB.test(body) ? "callout" : "quote";
      const parts = [body.replace(/^\s*💡\s*/u, "")];
      // The block runs to the next blank line (or the end of the quote).
      while (i + 1 < lines.length && lines[i + 1].trim() && !FENCE.test(lines[i + 1]) && (quoted ? /^\s*>/.test(lines[i + 1]) : !ITEM.test(lines[i + 1]) && !BULB.test(lines[i + 1]))) {
        parts.push(lines[++i].replace(/^\s*>\s?/, ""));
      }
      out.push({ t: kind, text: parts.join(" ").replace(/^\*\*(?:The )?Analogy:?\*\*:?\s*/i, "").trim() });
      continue;
    }
    const item = ITEM.exec(line);
    if (item) {
      flush();
      const ordered = item[2] !== undefined;
      const items = [item[3]];
      while (i + 1 < lines.length) {
        const next = ITEM.exec(lines[i + 1]);
        if (next && (next[2] !== undefined) === ordered) items.push(next[3]);
        // A wrapped item's next line is indented.
        else if (/^\s{2,}\S/.test(lines[i + 1]) && !FENCE.test(lines[i + 1])) items[items.length - 1] += ` ${lines[i + 1].trim()}`;
        else break;
        i++;
      }
      out.push({ t: "list", ordered, items });
      continue;
    }
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      out.push({ t: "p", text: `**${heading[1].replace(/\*\*/g, "")}**` });
      continue;
    }
    para.push(line);
  }
  flush();
  return out;
}
