// The language a lesson's code speaks, for its scratchpad (Player.tsx): its own exercise's or example's when it
// has one; else what its course and boards say it is about ("Mastering Rust", `fn main`, `println!`); Python
// only when nothing says otherwise. A Rust lesson with no example opened a Python scratchpad before (owner,
// 14 Nov, testing the Rust course).
import type { CodeLanguage, Lesson } from "./types";

/** Names in the course or lesson title, the clearest sign. */
const NAMED: [RegExp, CodeLanguage][] = [
  [/\brust\b|\bcargo\b|\brustc\b/i, "rust"],
  [/\btypescript\b|\bts\b(?=\s|$)/i, "typescript"],
  [/\bjavascript\b|\bnode(\.js)?\b|\bjs\b(?=\s|$)/i, "javascript"],
  [/\bsql\b|\bsqlite\b|\bpostgres(ql)?\b|\bdatabase queries\b/i, "sql"],
  [/\bpython\b|\bpandas\b|\bnumpy\b/i, "python"],
];

/** Code on the boards, as a fallback: what each language's code looks like. */
const SHAPES: [RegExp, CodeLanguage][] = [
  [/\bfn\s+\w+\s*\(|\bprintln!|\blet\s+mut\b|\bimpl\b|&mut\b|::new\(|\bcargo\s+(run|build|new)\b/, "rust"],
  [/\binterface\s+\w+\s*\{|:\s*(string|number|boolean)\b/, "typescript"],
  [/\bconsole\.log\(|\bconst\s+\w+\s*=|=>\s*\{/, "javascript"],
  [/\bSELECT\b[\s\S]*\bFROM\b|\bCREATE\s+TABLE\b/, "sql"],
  [/\bdef\s+\w+\s*\(|\bprint\(|\bimport\s+\w+/, "python"],
];

export function lessonLanguage(lesson: Pick<Lesson, "course" | "title" | "summary" | "boards">): CodeLanguage {
  const own = lesson.boards.find((b) => b.kind === "code")?.language ?? lesson.boards.find((b) => b.example)?.example?.language;
  if (own) return own;
  const names = `${lesson.course ?? ""} ${lesson.title ?? ""}`;
  for (const [re, lang] of NAMED) if (re.test(names)) return lang;
  const text = lesson.boards.flatMap((b) => [b.title, ...b.lines.map((l) => l.w)]).join("\n");
  let best: CodeLanguage | null = null;
  let most = 0;
  for (const [re, lang] of SHAPES) {
    const hits = (text.match(new RegExp(re.source, `${re.flags.replace("g", "")}g`)) ?? []).length;
    if (hits > most) {
      most = hits;
      best = lang;
    }
  }
  if (best) return best;
  for (const [re, lang] of NAMED) if (re.test(lesson.summary ?? "")) return lang;
  return "python";
}
