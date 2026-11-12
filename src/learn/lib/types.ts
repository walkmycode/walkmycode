/** One line on a board: what is written in chalk, and what the professor says. */
export type Line = {
  /** Board writing, in the small chalk markup (see markup.ts). Short. */
  w: string;
  /** What the professor says aloud while this line is written. */
  s: string;
  /** An optional small table written under the line. */
  table?: { head: string[]; rows: string[][] };
  /** An optional diagram drawn under the line, as Mermaid source. */
  diagram?: string;
};

export type QuizItem = {
  q: string;
  options: string[];
  /** Index into options. */
  answer: number;
  why: string;
};

export type Board = {
  title: string;
  /** "talk" is the lecture; "quiz" checks understanding; "explain" is the
   *  explain-back; "code" is an exercise in code; "write" is an exercise answered
   *  in words (a course folder's own question, in any subject); "lab-taxi" is the
   *  built-in line-fitting experiment. */
  kind: "talk" | "quiz" | "explain" | "code" | "write" | "lab-taxi";
  lines: Line[];
  quiz?: QuizItem[];
  questions?: string[];
  /** A code board: the task in plain words, the starting code, and what a
   *  correct run roughly prints. */
  task?: string;
  starter?: string;
  expect?: string;
  /** The code board's language (python when absent, as older lessons were). */
  language?: CodeLanguage;
  /** A talk board's everyday picture: the idea as a child would understand it. Shown in a 💡 block. */
  analogy?: string;
  /** The analogy as a scene to watch, written the first time the student asks for it (scene.ts). */
  scene?: import("./scene").Scene;
  /** Code the student can run from this board with one click (a course folder's example file). */
  example?: { name: string; code: string; language: CodeLanguage };
  /** A code board from a course folder: the exercise's file, the course's own answer (never shown
   *  before a real attempt or three hints), and whether the starter carries tests to run. */
  exercise?: string;
  solution?: string;
  tests?: boolean;
};

export type CodeLanguage = "python" | "javascript" | "typescript" | "sql" | "rust";

export type CodeCheck = {
  passed: boolean;
  feedback: string;
  /** An answer in words marked against a mark scheme: each of its points, whether the answer has it, and a remark. */
  points?: { point: string; met: boolean; note: string }[];
};

export type Feedback = {
  score: number; // 0-10
  verdict: string;
  good: string[];
  fix: string[];
  model: string;
};

export type HandRaise = { q: string; a: string; board: number; at: number };

export type Lesson = {
  id: string;
  course: string;
  number: number;
  title: string;
  subject: string;
  summary: string;
  boards: Board[];
  createdAt: number;
  updatedAt: number;
  /** Where the student is, and which boards they have seen. */
  at: number;
  seen: number[];
  answer?: string;
  feedback?: Feedback;
  quiz?: Record<string, number>; // "board.item" -> chosen option
  hands?: HandRaise[];
  /** The student's code: per code board ("b3"), and the lesson's scratchpad ("pad"). */
  code?: Record<string, string>;
  checks?: Record<string, CodeCheck>;
  /** The roadmap module this lesson teaches, when the course has a roadmap. */
  moduleId?: string;
  /** Where in the student's own code this lesson came from ("Teach me this"). */
  source?: { file: string; start?: number; end?: number };
  /** The course folder's lesson this was written from ("01_foundations/06_ownership"). */
  folder?: string;
};

/** One step of a course's road to mastery: a few lessons' worth. */
export type RoadmapModule = { id: string; title: string; summary: string; topics: string[] };
export type RoadmapStage = { title: string; summary: string; modules: RoadmapModule[] };

/** A course: its name (lessons refer to it by name) and its road from beginner to mastery. */
export type Course = {
  id: string;
  name: string;
  goal: string;
  stages: RoadmapStage[];
  /** A course taught from a folder on this computer: its lessons are the roadmap's modules
   *  (a module's id is the lesson's path inside the folder). */
  folder?: { path: string };
  createdAt: number;
  updatedAt: number;
};

export type Profile = {
  name: string;
  about: string;
  /** The Code room's scratchpad, kept between visits. */
  scratch?: string;
};

export const DEFAULT_PROFILE: Profile = {
  name: "",
  about:
    "A complete beginner who learns best with plain words, everyday examples and small steps. " +
    "Has met Python, NumPy, pandas, slopes and probability before but is rusty.",
};
