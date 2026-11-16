// Talking with the professor (docs/VOICE.md §4d): what he is told about the lesson, what he hears when the board
// changes, and his functions run against the lesson. Apart from React, so the tests can drive it; the session
// itself is Deepgram's agent (lib/voice/lecturer), the page wires it in Player.tsx.
import { plain } from "./markup";
import type { Board, Lesson, Profile } from "./types";

/** One board as the professor reads it: what is written, what is said, the everyday picture. */
export function boardText(b: Board, n: number): string {
  const parts = [`Board ${n}: ${plain(b.title)} (${b.kind})`];
  for (const l of b.lines) parts.push(`- writes "${plain(l.w)}", says "${l.s}"`);
  if (b.analogy) parts.push(`- the everyday picture: ${plain(b.analogy)}`);
  if (b.task) parts.push(`- the task: ${plain(b.task)}`);
  if (b.quiz?.length) parts.push(`- a quiz of ${b.quiz.length} question${b.quiz.length === 1 ? "" : "s"}`);
  if (b.example) parts.push(`- a runnable example: ${b.example.name}`);
  return parts.join("\n");
}

/** What the professor knows when the talk opens: the lesson, the student, the boards seen, the board on screen in full. */
export function lessonBrief(lesson: Lesson, idx: number, profile: Profile | null, notes: string[] = []): string {
  const seen = new Set(lesson.seen);
  const outline = lesson.boards.map((b, i) => `${i + 1}. ${plain(b.title)}${i === idx ? "  ← on screen" : seen.has(i) ? "  (seen)" : ""}`).join("\n");
  const out = [
    `Course: ${lesson.course}. Lesson ${lesson.number}: ${lesson.title}.`,
    lesson.summary ? `What it is about: ${lesson.summary}` : "",
    profile ? `The student${profile.name ? `, ${profile.name}` : ""}: ${profile.about}` : "",
    `The boards:\n${outline}`,
    `The board on screen now:\n${boardText(lesson.boards[idx], idx + 1)}`,
    notes.length ? `In their notebook from this lesson:\n${notes.slice(-6).map((n) => `- ${n}`).join("\n")}` : "",
  ];
  return out.filter(Boolean).join("\n\n");
}

/** What the professor is told when the board on screen changes (by him, or by the student). */
export function boardNote(lesson: Lesson, idx: number): string {
  return `The student is now looking at board ${idx + 1} of ${lesson.boards.length}.\n${boardText(lesson.boards[idx], idx + 1)}\nWhen they say "this" or "here", they mean this board.`;
}

/** Names the listener should know: the lesson's own words (titles, bold terms, example names). */
export function lessonKeyterms(lesson: Lesson): string[] {
  const words = new Set<string>();
  const take = (t: string) => {
    for (const w of plain(t).match(/[A-Za-z][A-Za-z0-9_-]{2,39}/g) ?? []) if (/[A-Z_]|[a-z][A-Z]/.test(w.slice(1)) || /^[A-Z]{2,}$/.test(w)) words.add(w);
  };
  take(lesson.title);
  for (const b of lesson.boards) {
    take(b.title);
    if (b.example) words.add(b.example.name.replace(/\.[a-z]+$/, ""));
  }
  return [...words].slice(0, 40);
}

/** What the professor's functions do to the lesson on screen. */
export interface ProfessorUi {
  lesson(): Lesson;
  index(): number;
  goTo(i: number): void;
  openExample(): string;
  saveNote(text: string): void;
  /** Draw on the board: the scene (a picture to watch, or its sequence diagram) redrawn, or a UML diagram added to
   * the board. False when a drawing is already under way. */
  draw(what: string, kind: DrawKind): boolean;
}

export type DrawKind = "scene" | "sequence" | "class" | "state" | "flow";
const DRAW_KINDS: DrawKind[] = ["scene", "sequence", "class", "state", "flow"];
export const drawKind = (v: unknown): DrawKind => (DRAW_KINDS.includes(v as DrawKind) ? (v as DrawKind) : "scene");

/** The prompt for a UML class, state or flow diagram added to a board: Mermaid, under the lesson's diagram rules. */
export function boardDiagramPrompt(lesson: Lesson, idx: number, what: string, kind: "class" | "state" | "flow", rules: string): string {
  const b = lesson.boards[idx];
  const head = kind === "class" ? "classDiagram" : kind === "state" ? "stateDiagram-v2" : "flowchart LR";
  return [
    `You are the professor of "${lesson.title}" (${lesson.course}). The student asked for a UML ${kind} diagram on board ${idx + 1}: ${what}`,
    `The board:\n${boardText(b, idx + 1)}`,
    rules,
    `Reply with only JSON: {"title": "what the diagram shows, a few words", "diagram": "Mermaid source starting ${head}, at most 12 nodes, short plain labels (a box may have a second line after <br/> with the analogy's word), no styling, no colours, no click, newlines written as \\n"}`,
  ].join("\n\n");
}

/** One function call from the professor, run against the lesson; the answer goes back to him as short JSON. */
export function runProfessorCall(name: string, args: Record<string, unknown>, ui: ProfessorUi): string {
  const lesson = ui.lesson();
  const at = ui.index();
  const count = lesson.boards.length;
  const show = (i: number) => {
    const n = Math.max(0, Math.min(count - 1, i));
    ui.goTo(n);
    return JSON.stringify({ ok: true, board: n + 1, of: count, title: plain(lesson.boards[n].title), text: boardText(lesson.boards[n], n + 1) });
  };
  const numbered = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) - 1 : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) - 1 : null);
  const firstOf = (kind: Board["kind"]) => lesson.boards.findIndex((b) => b.kind === kind);
  switch (name) {
    case "next_board":
      return at >= count - 1 ? JSON.stringify({ ok: false, why: "This is the last board of the lesson." }) : show(at + 1);
    case "previous_board":
      return at <= 0 ? JSON.stringify({ ok: false, why: "This is the first board." }) : show(at - 1);
    case "go_to_board": {
      const i = numbered(args.board);
      return i === null || i < 0 || i >= count ? JSON.stringify({ ok: false, why: `Give a board from 1 to ${count}.` }) : show(i);
    }
    case "read_board": {
      const i = numbered(args.board) ?? at;
      if (i < 0 || i >= count) return JSON.stringify({ ok: false, why: `Give a board from 1 to ${count}.` });
      return JSON.stringify({ ok: true, board: i + 1, text: boardText(lesson.boards[i], i + 1) });
    }
    case "open_example":
      return JSON.stringify({ ok: true, opened: ui.openExample() });
    case "start_quiz": {
      const i = firstOf("quiz");
      return i < 0 ? JSON.stringify({ ok: false, why: "This lesson has no quiz board; ask them a question yourself." }) : show(i);
    }
    case "explain_back": {
      const i = firstOf("explain");
      return i < 0 ? JSON.stringify({ ok: false, why: "This lesson has no explain-back board; ask them to explain it to you out loud." }) : show(i);
    }
    case "draw_picture": {
      const what = typeof args.what === "string" ? args.what.trim().slice(0, 500) : "";
      if (!what) return JSON.stringify({ ok: false, why: "Say what to draw." });
      const kind = drawKind(args.kind);
      return ui.draw(what, kind)
        ? JSON.stringify({ ok: true, drawing: kind === "class" || kind === "state" || kind === "flow" ? "a UML diagram added to the board; it appears in a few seconds" : `on the board, as ${kind === "sequence" ? "a sequence diagram" : "a picture to watch"}; it appears in a few seconds` })
        : JSON.stringify({ ok: false, why: "Something is already being drawn on the board; wait for it." });
    }
    case "save_note": {
      const text = typeof args.text === "string" ? args.text.trim().slice(0, 400) : "";
      if (!text) return JSON.stringify({ ok: false, why: "No text to save." });
      ui.saveNote(text);
      return JSON.stringify({ ok: true, saved: text });
    }
    default:
      return JSON.stringify({ ok: false, why: `There is no ${name} here.` });
  }
}
