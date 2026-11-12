/**
 * The conversation with the professor beside a lesson: what is kept, what is
 * sent, and how an answer is read. One conversation per lesson, saved with the
 * lesson's other work (store.ts, "chat-<lessonId>"), so a student carries on
 * where they stopped. The teaching rules are docs/LEARNING.md's.
 */
import { plain } from "./markup";
import { PERSONA, student } from "./professor";
import type { Board, HandRaise, Lesson, Profile } from "./types";

export type ActionId = "ten" | "hint" | "example" | "quiz" | "connect" | "why" | "again";

export type ChatMsg = {
  id: string;
  role: "you" | "prof";
  text: string;
  at: number;
  /** The board on screen when it was said. */
  board: number;
  /** A quick action's question (shown by its label, not its full wording). */
  action?: ActionId;
  /** The professor's answer failed, or was stopped part-way. */
  err?: string;
  stopped?: boolean;
};

export type Chat = { lessonId: string; msgs: ChatMsg[]; draft?: string; updatedAt: number };

export type Turn = { role: "user" | "assistant"; content: string };

export const emptyChat = (lessonId: string): Chat => ({ lessonId, msgs: [], updatedAt: 0 });

/** The most messages kept per lesson, and the most sent back to the professor as the conversation so far. */
export const KEEP = 200;
export const RECALL = 16;
const TURN_MAX = 4000;

export type Action = {
  id: ActionId;
  icon: string;
  label: string;
  title: string;
  /** Only on a board with something to solve. */
  exercise?: boolean;
  ask: (hint: number) => string;
};

/** How far the hint ladder goes before the answer may be shown. */
export const HINTS = 3;

const HINT_ASKS = [
  "Give me a first hint: only a nudge. Name the idea I should think about, in one or two sentences. No code.",
  "Give me a second hint: point at the exact line or part that needs to change and say what kind of change it needs. Do not write the fixed code.",
  "Give me a third hint: show the shape of the answer with one small piece left for me to fill in.",
];

/** The quick actions, in the order they are shown. Each is one of the seven habits (docs/LEARNING.md). */
export const ACTIONS: Action[] = [
  { id: "ten", icon: "💡", label: "Like I'm 10", title: "Explain this board again with a fresh everyday picture", ask: () => "Explain this board again as if I were ten years old, with one new everyday analogy (not the one on the board)." },
  { id: "hint", icon: "🪜", label: "Hint", title: "A nudge first, then a pointer, then a near-answer", exercise: true, ask: (n) => HINT_ASKS[Math.min(n, HINTS - 1)] },
  { id: "example", icon: "🧪", label: "Example", title: "One small example to run and change", ask: () => "Show me one small example of this that I can run, different from the board's, and tell me one thing to change in it to see what happens." },
  { id: "quiz", icon: "❓", label: "Quiz me", title: "One question to test yourself, marked when you answer", ask: () => "Ask me one short question that tests whether I understood this board. Ask only the question and wait: I will answer, then tell me if I am right and why." },
  { id: "connect", icon: "🔗", label: "Connect it", title: "Tie this to an earlier lesson or another field", ask: () => "Connect this idea to something else: an earlier board or lesson, or the same shape in a different field (cooking, sport, music, nature). What is the common pattern?" },
  { id: "why", icon: "🎯", label: "Why it matters", title: "Where this is used in real work", ask: () => "Why does this matter? Where would I meet it in real work, and what goes wrong for people who skip it?" },
];

export const actionOf = (id: ActionId | undefined) => ACTIONS.find((a) => a.id === id);

/** What a quick action's message shows in the thread. */
export function shownText(m: ChatMsg): string {
  if (m.role === "you" && m.action === "again") return "Explain this board again, more simply.";
  if (m.role === "you" && m.action === "hint") return m.text.replace(/^Give me a (first|second|third) hint[\s\S]*$/, (_m, n: string) => `A ${n} hint, please.`);
  const a = m.role === "you" ? actionOf(m.action) : undefined;
  return a ? `${a.icon} ${a.label}` : m.text;
}

/** How many hints were asked for on this board so far. */
export function hintsUsed(msgs: ChatMsg[], board: number): number {
  return msgs.filter((m) => m.role === "you" && m.action === "hint" && m.board === board).length;
}

/** The solution opens after every hint was used, or once the student's own work was checked (a real attempt). */
export function solutionOpen(msgs: ChatMsg[], board: number, attempted: boolean): boolean {
  return attempted || hintsUsed(msgs, board) >= HINTS;
}

/**
 * An answer and the "wonder next" questions it ends with. The professor is
 * asked to close with a line `???` and then one question per line; while the
 * answer is still arriving, a half-written closing block is held back.
 */
export function splitWonder(text: string): { body: string; wonder: string[] } {
  const at = text.search(/(^|\n)[ \t]*\?{3,}[ \t]*(\n|$)/);
  if (at < 0) {
    // A lone "?" or "??" at the very end may be the start of the block: do not flash it.
    return { body: text.replace(/\n[ \t]*\?{1,2}[ \t]*$/, "").trimEnd(), wonder: [] };
  }
  const wonder = text
    .slice(at)
    .split("\n")
    .map((l) => l.replace(/^[ \t]*(?:[-*•]|\d+[.)])?[ \t]*/, "").trim())
    .filter((l) => l && !/^\?{3,}$/.test(l) && l.length <= 160)
    .slice(0, 3);
  return { body: text.slice(0, at).trimEnd(), wonder };
}

/** The answer as words to read aloud: no code blocks, no markup, no closing questions. */
export function speakable(text: string): string {
  return plain(
    splitWonder(text)
      .body.replace(/```[\s\S]*?(```|$)/g, " (the code is on screen.) ")
      .replace(/^[ \t]*[-*•][ \t]+/gm, "")
      .replace(/^#+\s*/gm, "")
      .replace(/^>\s?/gm, "")
      .replace(/💡/g, "")
      .replace(/(?<![*\w])\*(?![\s*])([^*\n]+?)\*(?![*\w])/g, "$1"),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Old lessons kept raised hands on the lesson itself: the same questions and answers, as a conversation. */
export function fromHands(hands: HandRaise[] | undefined): ChatMsg[] {
  return (hands ?? []).flatMap((h, i) => [
    { id: `h${i}q`, role: "you" as const, text: h.q, at: h.at, board: h.board },
    { id: `h${i}a`, role: "prof" as const, text: h.a, at: h.at, board: h.board },
  ]);
}

/** Questions worth asking about the board on screen: the empty conversation's way in. */
export function starters(board: Board, index = 1): string[] {
  const title = plain(board.title).replace(/[.:]$/, "");
  if (board.kind === "write") return ["Where should I start with this question?", "Which part of the lesson does this question test?", "Can I try my answer on you first?"];
  if (board.kind === "code") return ["Where should I start with this exercise?", "Which idea from the lesson does this exercise test?", "What is the most common mistake here?"];
  if (board.kind === "quiz") return ["Why is the right answer right?", "Ask me one more question like these.", "Which of these ideas trips people up most?"];
  if (board.kind === "explain") return ["What would a strong answer cover?", "Can I try explaining it to you first?", "Which part should I be most careful with?"];
  return [`What is the one thing to remember about “${title}”?`, "Can you show me this going wrong?", index > 0 ? "How does this connect to the board before?" : "What should I already know before we start?"];
}

const boardText = (b: Board, i: number) =>
  `${i + 1}. "${plain(b.title)}"${b.kind !== "talk" ? ` [${b.kind}]` : ""}: ${b.lines.map((l) => plain(l.w)).filter(Boolean).join(" / ")}${b.analogy ? ` (Analogy given: ${plain(b.analogy)})` : ""}`;

/** What the professor needs to know about the exercise on screen, with the student's work on it. */
function exerciseBlock(b: Board, work: { code?: string; output?: string; passed?: boolean }): string {
  if (b.kind === "write") {
    return [
      `The board on screen is an exercise answered in words${b.exercise ? ` (${b.exercise})` : ""}. The question: ${b.task ?? ""}`,
      work.code?.trim() ? `The student's answer so far:\n"""\n${work.code.slice(0, 6000)}\n"""` : "They have not written an answer yet.",
      work.passed ? "Their answer has already passed." : "",
      b.solution ? `The course's model answer, for your eyes only. Use it to judge their answer and to choose hints; never show it, quote it or give it away:\n"""\n${b.solution.slice(0, 6000)}\n"""` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  const lang = b.language ?? "python";
  return [
    `The board on screen is an exercise${b.exercise ? ` (${b.exercise})` : ""}. The task: ${plain(b.task ?? "")}`,
    work.code ? `The student's code right now:\n\`\`\`${lang}\n${work.code.slice(0, 8000)}\n\`\`\`` : "",
    work.output ? `What it printed when last run:\n\`\`\`\n${work.output.slice(-3000)}\n\`\`\`` : "",
    work.passed ? "Their work on it has already passed." : "",
    b.solution ? `The course's own solution, for your eyes only. Use it to judge their work and to choose hints; never show it, quote it or paste from it:\n\`\`\`${lang}\n${b.solution.slice(0, 6000)}\n\`\`\`` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export const CHAT_RULES = `How you answer in this conversation:
- The first sentence answers the question. Then at most two short paragraphs, 150 words in all unless they ask for more.
- A new idea gets one everyday picture a child would understand, on a line of its own starting with "💡": concrete things a ten-year-old has touched, one idea only, saying what stands for what (the toy is the value), true to the code, and naming where the picture stops being true when that matters.
- Light Markdown only: short paragraphs, **bold** for a key term, \`code\` for names, a fenced code block with its language for code, a short list when steps matter. No headings, no tables.
- On an exercise, hints come before answers: a nudge, then a pointer, then a near-answer. Never write the full solution unless the student says they have tried and asks for it plainly.
- If they answer a question you asked, say first whether they are right, then why.
- Any question is welcome, on the topic or not: answer it briefly and lead back to the lesson.
- End with a line holding only ??? and then two short questions a curious student might ask next, one per line, in the student's voice (at most 12 words each).`;

function preamble(lesson: Lesson, profile: Profile, upTo: number): string {
  const boards = lesson.boards.slice(0, upTo + 1);
  return `${PERSONA}

${student(profile)}

You are teaching "${lesson.title}" (course: ${lesson.course}). ${lesson.summary}
The lesson's boards the student has reached, in order:
${boards.map(boardText).join("\n")}

${CHAT_RULES}`;
}

export type AskContext = { board: number; code?: string; output?: string; passed?: boolean };

/**
 * The messages sent for the next answer: the lesson and the rules first, then
 * the recent conversation, with the last question saying which board is on
 * screen and (on an exercise) what the student's code looks like now. Roles
 * alternate and start with the student, as every provider expects.
 */
export function chatTurns(lesson: Lesson, profile: Profile, msgs: ChatMsg[], ctx: AskContext): Turn[] {
  const said = msgs.filter((m) => m.text.trim() && !(m.role === "prof" && m.err && !m.text.trim())).slice(-RECALL);
  // Start at a question of the student's.
  while (said.length && said[0].role !== "you") said.shift();
  const turns: Turn[] = [];
  for (const m of said) {
    const role = m.role === "you" ? "user" : "assistant";
    const content = (m.role === "prof" ? m.text : m.text).slice(0, TURN_MAX);
    const last = turns.at(-1);
    if (last && last.role === role) last.content += `\n\n${content}`;
    else turns.push({ role, content });
  }
  if (!turns.length || turns.at(-1)!.role !== "user") return [];
  const upTo = Math.max(ctx.board, ...lesson.seen, 0);
  const b = lesson.boards[ctx.board];
  const here = b ? `(I am looking at board ${ctx.board + 1}, "${plain(b.title)}".)` : "";
  const exercise = b && (b.kind === "code" || b.kind === "write") ? `\n\n${exerciseBlock(b, ctx)}` : "";
  const lastTurn = turns.at(-1)!;
  lastTurn.content = `${here} ${lastTurn.content}${exercise}`.trim();
  turns[0].content = `${preamble(lesson, profile, Math.min(upTo, lesson.boards.length - 1))}\n\n---\n\n${turns[0].content}`;
  return turns;
}

/** One line for the library's "carry on" card: what was last said. */
export function lastLine(chat: Chat | null): string {
  const m = chat?.msgs.filter((x) => x.text.trim()).at(-1);
  if (!m) return "";
  const text = m.role === "you" ? shownText(m) : speakable(m.text);
  return `${m.role === "you" ? "You asked" : "The professor said"}: ${text.length > 110 ? `${text.slice(0, 110)}…` : text}`;
}
