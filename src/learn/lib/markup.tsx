/**
 * The chalk markup board lines are written in. It is deliberately tiny, so a
 * lesson written by an AI can never inject HTML into the page:
 *
 *   **bold**        yellow chalk, for key terms
 *   `a × x + b`     a formula or code, in a dashed box
 *   [[boxed]]       a boxed phrase
 *   {pink:text}     coloured chalk: pink, blue or green
 *   $x^2 + 1$       maths, typeset (KaTeX); $$…$$ for a line of its own
 *
 * KaTeX builds its own markup from the LaTeX and never passes HTML through
 * (trust is off), so maths is safe to insert.
 */
import katex from "katex";
import { Fragment, type ReactNode } from "react";

// $$…$$ first; single $…$ only when it hugs its content, so "$5 and $10" stays text.
const TOKEN = /\$\$(.+?)\$\$|\$(?![\s\d])([^$\n]+?)(?<!\s)\$|\*\*(.+?)\*\*|`(.+?)`|\[\[(.+?)\]\]|\{(pink|blue|green):(.+?)\}/g;

function Maths({ tex, block }: { tex: string; block: boolean }) {
  const html = katex.renderToString(tex, { displayMode: block, throwOnError: false, trust: false, strict: "ignore", output: "htmlAndMathml" });
  return <span className={block ? "maths block" : "maths"} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Chalk({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(<Fragment key={key++}>{text.slice(last, at)}</Fragment>);
    if (m[1] !== undefined) out.push(<Maths key={key++} tex={m[1]} block />);
    else if (m[2] !== undefined) out.push(<Maths key={key++} tex={m[2]} block={false} />);
    else if (m[3] !== undefined) out.push(<b key={key++}>{m[3]}</b>);
    else if (m[4] !== undefined) out.push(<span key={key++} className="eq">{m[4]}</span>);
    else if (m[5] !== undefined) out.push(<span key={key++} className="boxed">{m[5]}</span>);
    else out.push(<span key={key++} className={m[6]}>{m[7]}</span>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return <>{out}</>;
}

/** The same text with the markup removed, for reading aloud or listing. Maths keeps its LaTeX, minus the $ signs. */
export const plain = (text: string) =>
  text.replace(TOKEN, (_m, mb, mi, b, eq, box, _c, col) => mb ?? mi ?? b ?? eq ?? box ?? col ?? "");
