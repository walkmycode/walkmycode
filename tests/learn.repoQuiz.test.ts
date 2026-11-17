// A quiz from the user's own code (src/learn/lib/repoQuiz.ts): only questions whose
// citations are real lines that hold what they quote are kept; cited lines are kept as a
// hash, followed when they move and marked stale when they change; answers are scheduled
// with the recall boxes (right later, wrong tomorrow); the AI is shown the map and the code.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CodeMap } from "../src/analyzer/types";
import { DAY, INTERVALS } from "../src/learn/lib/recall";
import {
  answerQuestion,
  boxCounts,
  checkQuestions,
  codeDigest,
  dueQuestions,
  excerptsFor,
  hashLines,
  mergeQuestions,
  quizKey,
  quizPrompt,
  refreshQuestions,
  rewritePrompt,
  topicsOf,
  whyNotPrompt,
  type QuizQuestion,
} from "../src/learn/lib/repoQuiz";

const TASKS = [
  'import { prisma } from "./db";',
  'import { sendAssignedEmail } from "./email";',
  "",
  "export async function createTask(projectId: string, title: string, assigneeId?: string) {",
  "  const task = await prisma.task.create({",
  "    data: { projectId, title, assigneeId },",
  "    include: { assignee: true },",
  "  });",
  "  if (task.assignee) await sendAssignedEmail(task.assignee.email, task.title);",
  "  return task;",
  "}",
].join("\r\n"); // a CRLF file, as many are
const EMAIL = ["export async function sendAssignedEmail(to: string, title: string) {", "  if (!process.env.RESEND_API_KEY) return;", "  await resend.emails.send({ to, subject: title });", "}"].join("\n");
const FILES: Record<string, string> = { "lib/tasks.ts": TASKS, "lib/email.ts": EMAIL, ".env": "RESEND_API_KEY=re_live_123" };

const good = (over: Record<string, unknown> = {}) => ({
  topic: "Creating tasks",
  q: "Someone adds a task for Ama while Resend is down. What happens?",
  options: ["An error, and no task is saved.", "An error, but the task is saved.", "Success: the email is retried later.", "Success: the email is skipped."],
  answer: 1,
  explain: "The task is written at line 5, before the email at line 9, which is awaited.",
  wrong: ["The row is written first.", null, "Nothing retries it.", "Only without a key is it skipped."],
  cites: [
    { path: "lib/tasks.ts", start: 5, end: 8, quote: "prisma.task.create" },
    { path: "lib/tasks.ts", start: 9, end: 9, quote: "await sendAssignedEmail" },
  ],
  ...over,
});

describe("checking the AI's questions against the code", () => {
  it("keeps a question whose lines hold what it quotes, with a hash and a short excerpt", () => {
    const { kept, dropped } = checkQuestions({ questions: [good()] }, FILES, 1000);
    assert.equal(dropped.length, 0);
    assert.equal(kept.length, 1);
    const q = kept[0];
    assert.equal(q.answer, 1);
    assert.deepEqual(q.wrong, ["The row is written first.", null, "Nothing retries it.", "Only without a key is it skipped."]);
    assert.equal(q.cites[0].hash, hashLines(TASKS.split("\r\n").slice(4, 8)));
    assert.equal(q.box, 0);
    assert.equal(q.due, 1000);
    // Lines 5-8 and 9 are close: one excerpt, a line around them, both marked.
    assert.deepEqual(q.shown, [{ path: "lib/tasks.ts", from: 4, lines: TASKS.split("\r\n").slice(3, 10), marks: [[5, 8], [9, 9]] }]);
  });

  it("throws away a question citing a file that is not there, lines past its end, or lines that do not hold the quote", () => {
    const { kept, dropped } = checkQuestions(
      [
        good({ q: "A question about a file that is not in the project?", cites: [{ path: "lib/billing.ts", start: 1, end: 2, quote: "charge" }] }),
        good({ q: "A question about lines the file does not have?", cites: [{ path: "lib/tasks.ts", start: 10, end: 40, quote: "return task" }] }),
        good({ q: "A question whose lines hold something else?", cites: [{ path: "lib/tasks.ts", start: 1, end: 2, quote: "prisma.task.create" }] }),
        good({ q: "A question that quotes the .env file it cites?", cites: [{ path: ".env", start: 1, end: 1, quote: "RESEND_API_KEY" }] }),
      ],
      FILES,
      0,
    );
    assert.equal(kept.length, 0);
    assert.deepEqual(
      dropped.map((d) => d.why),
      [
        "it cites lib/billing.ts, which is not in the project",
        "it cites lib/tasks.ts:10-40, lines the file does not have",
        "lib/tasks.ts:1-2 does not hold what it quotes",
        "it cites .env, which WalkMyCode never shows",
      ],
    );
  });

  it("throws away a question that is not whole: three options, no citation, two options alike", () => {
    const { kept, dropped } = checkQuestions(
      [good({ options: ["a", "b", "c"] }), good({ cites: [] }), good({ options: ["Yes", "yes", "No", "Maybe"] }), "nonsense"],
      FILES,
      0,
    );
    assert.equal(kept.length, 0);
    assert.equal(dropped.length, 4);
    assert.match(dropped[2].why, /same/);
  });

  it("reads an answer given as a letter, a quote with … in it, and ./ or \\ in a path; the same question twice is kept once", () => {
    const { kept } = checkQuestions(
      [good({ answer: "B", cites: [{ path: ".\\lib\\tasks.ts", start: 5, end: 9, quote: "prisma.task.create(…sendAssignedEmail" }] }), good()],
      FILES,
      0,
    );
    assert.equal(kept.length, 1);
    assert.equal(kept[0].answer, 1);
    assert.equal(kept[0].cites[0].path, "lib/tasks.ts");
  });
});

describe("reading what the AI wrote loosely where it does no harm", () => {
  it("takes an answer written as \"2\", and a short or untidy list of why each option is wrong", () => {
    const { kept } = checkQuestions([good({ answer: "2", wrong: ["Not this.", 7, "", null].slice(0, 3) })], FILES, 0);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].answer, 2);
    assert.deepEqual(kept[0].wrong, ["Not this.", null, null, null]);
  });
});

describe("questions whose code changed", () => {
  const [q] = checkQuestions([good()], FILES, 0).kept;

  it("leaves a question alone while its lines are the same (trailing spaces and line endings do not count)", () => {
    const files = { ...FILES, "lib/tasks.ts": TASKS.replace(/\r\n/g, "  \n") };
    const r = refreshQuestions([q], files);
    assert.equal(r.questions[0], q);
    assert.deepEqual([r.moved, r.stale], [0, 0]);
  });

  it("follows lines that moved, and takes the excerpt again", () => {
    const files = { ...FILES, "lib/tasks.ts": `// Tasks\n// written by the team\n${TASKS}` };
    const r = refreshQuestions([q], files);
    assert.equal(r.moved, 1);
    assert.deepEqual(r.questions[0].cites.map((c) => [c.start, c.end]), [[7, 10], [11, 11]]);
    assert.deepEqual(r.questions[0].shown[0].marks, [[7, 10], [11, 11]]);
    assert.ok(!r.questions[0].stale);
  });

  it("marks a question stale when a cited line changed or its file is gone, and never asks it", () => {
    const changed = { ...FILES, "lib/tasks.ts": TASKS.replace("if (task.assignee) await sendAssignedEmail", "if (task.assignee) void sendAssignedEmail") };
    const r = refreshQuestions([q], changed);
    assert.equal(r.stale, 1);
    assert.equal(r.questions[0].stale, true);
    assert.deepEqual(dueQuestions(r.questions, Date.now()), []);
    const gone = refreshQuestions([q], { "lib/email.ts": EMAIL });
    assert.equal(gone.questions[0].stale, true);
  });
});

describe("scheduling answers with the recall boxes", () => {
  const [q] = checkQuestions([good()], FILES, 0).kept;

  it("a right answer moves it up a box and further off; a wrong one brings it back tomorrow", () => {
    const right = answerQuestion(q, 1, 0);
    assert.equal(right.box, 1);
    assert.equal(right.due, INTERVALS[1] * DAY);
    assert.equal(right.last, true);
    const again = answerQuestion(right, 1, right.due);
    assert.equal(again.box, 2);
    assert.equal(again.due, right.due + INTERVALS[2] * DAY);
    const wrong = answerQuestion(again, 0, again.due);
    assert.equal(wrong.box, 1);
    assert.equal(wrong.due, again.due + DAY);
    assert.equal(wrong.last, false);
    assert.deepEqual([wrong.seen, wrong.right], [3, 2]);
  });

  it("asks what is due, longest overdue first, by topic when asked, and counts topics and boxes", () => {
    const a: QuizQuestion = { ...q, id: "a", topic: "Signing in", due: 50, last: true, box: 2 };
    const b: QuizQuestion = { ...q, id: "b", topic: "Creating tasks", due: 10 };
    const c: QuizQuestion = { ...q, id: "c", topic: "Signing in", due: 500 };
    const d: QuizQuestion = { ...q, id: "d", topic: "Signing in", due: 0, stale: true };
    assert.deepEqual(dueQuestions([a, b, c, d], 100).map((x) => x.id), ["b", "a"]);
    assert.deepEqual(dueQuestions([a, b, c, d], 100, "Signing in").map((x) => x.id), ["a"]);
    assert.deepEqual(topicsOf([a, b, c, d], 100), [
      { topic: "Signing in", total: 2, right: 1, due: 1 },
      { topic: "Creating tasks", total: 1, right: 0, due: 1 },
    ]);
    assert.deepEqual(boxCounts([a, b, c, d], INTERVALS.length), [2, 0, 1, 0, 0, 0]);
  });

  it("adds new questions without losing the progress of ones already there", () => {
    const answered = answerQuestion(q, 1, 0);
    const merged = mergeQuestions([answered], checkQuestions([good(), good({ q: "What does sendAssignedEmail do without a key?" , cites: [{ path: "lib/email.ts", start: 2, end: 2, quote: "RESEND_API_KEY) return" }] })], FILES, 9).kept);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].box, 1);
  });
});

describe("what the AI is asked", () => {
  const map = {
    name: "team-tasks",
    system: { kind: "monolith", links: [] },
    files: [{ path: "lib/tasks.ts" }, { path: "lib/email.ts" }, { path: ".env", skipped: "secret" }],
    nodes: [
      { id: "r", kind: "route", name: "POST tasks", method: "POST", path: "/api/projects/[id]/tasks", file: "app/api/projects/[id]/tasks/route.ts", line: 8 },
      { id: "t", kind: "module", name: "tasks", file: "lib/tasks.ts" },
      { id: "e", kind: "module", name: "email", file: "lib/email.ts" },
      { id: "x", kind: "service", name: "Resend" },
      { id: "db", kind: "table", name: "Task", columns: [{ name: "id" }, { name: "title" }], columnsAt: { file: "prisma/schema.prisma", line: 20 } },
    ],
    edges: [{ id: "1", from: "t", to: "e", kind: "calls", evidence: [{ file: "lib/tasks.ts", line: 9, text: "" }] }],
  } as unknown as CodeMap;

  it("shows the map and the code with line numbers, never a secret, and the questions already asked", () => {
    const p = quizPrompt(map, FILES, [{ q: "Who can delete a project?", topic: "Projects" }]);
    assert.match(p, /POST \/api\/projects\/\[id\]\/tasks \(app\/api\/projects\/\[id\]\/tasks\/route\.ts:8\)/);
    assert.match(p, /Task: id, title \(prisma\/schema\.prisma:20\)/);
    assert.match(p, /Outside services: Resend/);
    assert.match(p, /tasks calls email \(lib\/tasks\.ts:9\)/);
    assert.match(p, / {3}5\| {3}const task = await prisma\.task\.create\(\{/);
    assert.match(p, /Topics already used: Projects/);
    assert.match(p, /- Who can delete a project\?/);
    assert.doesNotMatch(p, /re_live_123/);
    // The file with the most on the map comes first.
    assert.ok(codeDigest(map, FILES).indexOf("lib/tasks.ts") < codeDigest(map, FILES).indexOf("lib/email.ts"));
  });

  it("rewrites stale questions from the code they were about, and asks why-not with the cited lines", () => {
    const [q] = checkQuestions([good()], FILES, 0).kept;
    const r = rewritePrompt(map, FILES, [{ ...q, stale: true }]);
    assert.match(r, /\[Creating tasks\] Someone adds a task/);
    assert.match(r, /=== lib\/tasks\.ts ===/);
    assert.doesNotMatch(r, /=== lib\/email\.ts ===/);
    const w = whyNotPrompt(q, 0);
    assert.match(w, /why not A\?/);
    assert.match(w, /The right answer is B\./);
    assert.match(w, / {3}9\| {3}if \(task\.assignee\)/);
  });

  it("keeps each project's quiz under its own key", () => {
    assert.equal(quizKey("team-tasks"), "quiz-team-tasks");
    assert.equal(quizKey("Web + API"), "quiz-web-api");
    assert.match(quizKey("x".repeat(200)), /^quiz-x{60}$/);
  });

  it("joins close citations into one excerpt and keeps far ones apart", () => {
    const long = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n");
    const shown = excerptsFor([{ path: "a.ts", start: 2, end: 3 }, { path: "a.ts", start: 40, end: 40 }], { "a.ts": long });
    assert.deepEqual(shown.map((s) => [s.from, s.lines.length]), [[1, 4], [39, 3]]);
  });
});
