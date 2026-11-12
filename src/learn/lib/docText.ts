/**
 * Study material that is not Markdown, turned into the Markdown a lesson is
 * read from (courseFolder.ts): the text of a Word document, of PowerPoint
 * slides, of a PDF's pages or of a plain text file, with its headings marked.
 * Text only: pictures, tables' layout and formatting are left behind. Plain
 * functions with no Node imports; the files are opened in src/lib/learnDocs.ts.
 *
 * Also here: telling a question paper from an answer key by its name, and
 * which paper a key belongs to.
 */

/** The kinds of file a course may be written in. */
export const DOC_EXT = /\.(md|markdown|txt|pdf|docx|pptx)$/i;

const entity = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

/** The text runs of one paragraph of Office XML (`w:t` in Word, `a:t` in PowerPoint), tabs and line breaks kept. */
function runs(xml: string, ns: "w" | "a"): string {
  let out = "";
  const re = new RegExp(`<${ns}:t(?:\\s[^>]*)?>([\\s\\S]*?)</${ns}:t>|<${ns}:tab\\s*/>|<${ns}:br\\s*/>`, "g");
  for (const m of xml.matchAll(re)) out += m[1] !== undefined ? entity(m[1]) : m[0].includes(":tab") ? "\t" : "\n";
  return out;
}

/**
 * A Word document's text (word/document.xml) as Markdown: its Heading 1, 2, 3
 * and Title styles become headings, list paragraphs become list items, and
 * everything else a paragraph.
 */
export function docxToMarkdown(xml: string): string {
  const out: string[] = [];
  let n = 0;
  // Under a Title, Word's Heading 1 is a section of the document, not its name.
  const under = /<w:pStyle\s+w:val="title"/i.test(xml) ? 1 : 0;
  for (const p of xml.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)) {
    const text = runs(p[0], "w").replace(/[ \t]+\n/g, "\n").trim();
    if (!text) {
      n = 0;
      continue;
    }
    const style = /<w:pStyle\s+w:val="([^"]+)"/.exec(p[0])?.[1] ?? "";
    const heading = Number(/^heading\s*([1-6])$/i.exec(style)?.[1] ?? 0);
    const level = /^title$/i.test(style) ? 1 : heading ? heading + under : 0;
    if (level) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      out.push(`${"#".repeat(Math.min(level, 3))} ${text.replace(/\n/g, " ")}`, "");
      n = 0;
    } else if (/<w:numPr>/.test(p[0])) {
      // Word numbers its own lists; whether one is numbered or bulleted is in another file, so a list item keeps its own
      // leading number when it has one and is otherwise counted here.
      out.push(/^\d+[.)]\s/.test(text) ? text : `${++n}. ${text.replace(/\n/g, "\n   ")}`);
    } else {
      if (n) out.push("");
      n = 0;
      out.push(text, "");
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** One PowerPoint slide's text (ppt/slides/slideN.xml) as a Markdown section: its title, then its lines as a list. */
export function slideToMarkdown(xml: string, number: number): string {
  let title = "";
  const lines: string[] = [];
  for (const shape of xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)) {
    const isTitle = /<p:ph[^>]*type="(title|ctrTitle)"/.test(shape[0]);
    for (const p of shape[0].matchAll(/<a:p>[\s\S]*?<\/a:p>/g)) {
      const text = runs(p[0], "a").replace(/\s+/g, " ").trim();
      if (!text) continue;
      if (isTitle && !title) title = text;
      else lines.push(text);
    }
  }
  if (!title) title = lines.shift() ?? `Slide ${number}`;
  return [`## ${title}`, "", ...lines.map((l) => `- ${l}`)].join("\n").trim();
}

/** A line that reads as a heading in plain text: a chapter or section number, or a short line in capitals or ending in a colon on its own. */
function plainHeading(line: string, before: string, after: string): string | null {
  const t = line.trim();
  if (!t || t.length > 70 || /[.,;]$/.test(t)) return null;
  const numbered = /^(?:(?:chapter|section|part|unit|lesson|topic)\s+\d+[.:]?\s*.*|\d+(?:\.\d+){0,2}\s+[A-Z][^.?!]*)$/i.exec(t);
  const shouting = t.length >= 4 && t === t.toUpperCase() && /[A-Z]{3}/.test(t) && !/^\d/.test(t);
  // A heading stands alone: a blank line before it, and something after it.
  if (!(numbered || shouting) || before.trim() || (!after.trim() && shouting && t.length > 40)) return null;
  const words = shouting ? t[0] + t.slice(1).toLowerCase() : t;
  return words.replace(/:$/, "");
}

/**
 * Plain text (a .txt file, or the pages of a PDF) as Markdown. Lines that read as headings become sections; the first
 * such line, or the first short line, is the title. Lines a PDF broke mid-sentence are joined into paragraphs.
 */
export function plainToMarkdown(text: string, fallbackTitle: string): string {
  const lines = text.replace(/\r\n?/g, "\n").replace(/­/g, "").split("\n").map((l) => l.replace(/[ \t]+$/g, ""));
  const out: string[] = [];
  let titled = false;
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(para.join(" ").replace(/(\w)- (\w)/g, "$1$2"), "");
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = plainHeading(line, lines[i - 1] ?? "", lines[i + 1] ?? "");
    if (heading) {
      flush();
      if (out.length && out[out.length - 1] !== "") out.push("");
      out.push(`${titled ? "##" : "#"} ${heading}`, "");
      titled = true;
      continue;
    }
    // List items, numbered questions and already-marked-up lines keep their own line.
    if (/^\s*(?:[-*•]\s|\d+[.)]\s|\([a-z0-9]+\)\s|#{1,3}\s|>)/.test(line)) {
      flush();
      out.push(line.replace(/^\s*•\s/, "- "));
      continue;
    }
    para.push(line.trim());
  }
  flush();
  const body = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return /^# /m.test(body) ? body : `# ${fallbackTitle}\n\n${body}`;
}

// ── question papers and answer keys ──

// Whole words only: "contest" is not a test, and "monkeys" are not keys.
const QUESTIONS = /(?<![a-z])(questions?|problems?|exercises?|past[\s_-]*papers?|worksheets?|quiz(?:zes)?|homework|assignments?|exam(?:s|ination)?|practice|practise|tutorial[\s_-]*sheet|tests?)(?![a-z])/i;
const ANSWERS = /(?<![a-z])(answers?|solutions?|mark[\s_-]*schemes?|marking[\s_-]*schemes?|answer[\s_-]*keys?|keys?|memo(?:randum)?)(?![a-z])/i;

export type DocRole = "lesson" | "questions" | "answers";

/** What a file is, by its name: a paper of questions, the answers to one, or a lesson. An answer key that names its paper ("questions_answers") is the key. */
export function roleOf(name: string): DocRole {
  const base = name.replace(/\.[A-Za-z0-9]+$/, "");
  if (ANSWERS.test(base)) return "answers";
  if (QUESTIONS.test(base)) return "questions";
  return "lesson";
}

/** What is left of a name once its number and the words that say what it is are gone: what it is about. */
export function stemOf(name: string): string {
  return name
    .replace(/\.[A-Za-z0-9]+$/, "")
    .toLowerCase()
    .replace(/^\d+[._\s-]*/, "")
    .replace(new RegExp(ANSWERS.source, "gi"), " ")
    .replace(new RegExp(QUESTIONS.source, "gi"), " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    // "The heart" and "Heart questions" are about the same thing.
    .replace(/^(the|a|an)\s+/, "");
}

/** Whether two files are about the same thing: the same words, or every word of the shorter name in the longer ("causes" and "causes of the first world war"). */
export function sameSubject(a: string, b: string): boolean {
  const [x, y] = [stemOf(a), stemOf(b)];
  if (!x || !y) return false;
  if (x === y) return true;
  const [few, many] = [x.split(" "), y.split(" ")].sort((p, q) => p.length - q.length);
  return few.every((w) => many.includes(w));
}

/** The number a file starts with ("03_causes.md" is 3), or null. */
export function numberOf(name: string): number | null {
  const m = /^(\d+)/.exec(name);
  return m ? Number(m[1]) : null;
}

/**
 * Which of `candidates` a file belongs with: the one with the same leading number, else the one about the same thing
 * (the same stem), else the only one there is. Null when nothing fits.
 */
export function partnerOf(name: string, candidates: string[]): string | null {
  const n = numberOf(name);
  const byNumber = n === null ? [] : candidates.filter((c) => numberOf(c) === n);
  if (byNumber.length === 1) return byNumber[0];
  const pool = byNumber.length ? byNumber : candidates;
  const exact = pool.filter((c) => stemOf(c) === stemOf(name) && !!stemOf(name));
  const byStem = exact.length ? exact : pool.filter((c) => sameSubject(name, c));
  if (byStem.length >= 1) return byStem[0];
  return n === null && candidates.length === 1 ? candidates[0] : null;
}
