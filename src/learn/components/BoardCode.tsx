"use client";
// Code on a lesson's board, drawn as an editor draws it (the owner: "as if it were in VS Code"): the editor's own
// grammar colours (highlight.ts, the Code room's palette), the editor's font and background. A line of only code is
// a block with the language and a line number, as a one-line file would show; code inside a sentence is inline code.
// Formulas keep the chalk box (markup.tsx decides which is which).
import type { ReactNode } from "react";
import { highlight } from "@/learn/lib/highlight";
import type { CodeRenderer } from "@/learn/lib/markup";

const LABEL: Record<string, string> = { rust: "Rust", python: "Python", javascript: "JavaScript", typescript: "TypeScript", sql: "SQL", go: "Go", java: "Java", c: "C", cpp: "C++", csharp: "C#" };

function Tokens({ src, lang }: { src: string; lang: string }): ReactNode {
  const lines = highlight(src, lang);
  return lines.map((line, i) => (
    <span key={i} className="bc-l">
      {line.map((s, j) => (s.cls ? <span key={j} className={s.cls}>{s.text}</span> : s.text))}
    </span>
  ));
}

/** The renderer for a lesson in `lang` (null: a lesson with no code, whose backticks stay chalk). */
export function boardCode(lang: string | null): CodeRenderer | undefined {
  if (!lang) return undefined;
  const BoardCodeOf = (src: string, block: boolean): ReactNode =>
    block ? (
      <span className="bc" role="figure" aria-label={`${LABEL[lang] ?? lang} code`}>
        <span className="bc-bar" aria-hidden="true">
          <span>{LABEL[lang] ?? lang}</span>
        </span>
        <span className="bc-body">
          <span className="bc-gutter" aria-hidden="true">
            {src.split("\n").map((_, i) => (
              <span key={i}>{i + 1}</span>
            ))}
          </span>
          <code className="bc-code">
            <Tokens src={src} lang={lang} />
          </code>
        </span>
      </span>
    ) : (
      <code className="ic">
        <Tokens src={src} lang={lang} />
      </code>
    );
  return BoardCodeOf;
}
