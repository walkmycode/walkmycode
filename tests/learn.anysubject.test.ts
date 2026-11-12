// A course in any subject (docs/COURSES.md): lessons that are a README alone
// or one numbered Markdown file, exercises answered in words with model
// answers, and the starter course Learn writes for an author to copy.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { chatTurns, starters, type ChatMsg } from "../src/learn/lib/chat";
import { exerciseBoards, lessonMaterial, readExercise, readLesson, readWrittenSections } from "../src/learn/lib/courseFolder";
import { folderLessonPrompt, writtenCheckPrompt } from "../src/learn/lib/professor";
import { STARTER_COURSE } from "../src/learn/lib/starterCourse";
import { DEFAULT_PROFILE, type Board, type Lesson } from "../src/learn/lib/types";
import { guarded } from "../src/lib/providers/guard";
import { findLessons, learnCourseHandler, loadLesson, loadOutline, writeStarter } from "../src/lib/learnCourse";

const FENCE = "```";
const HISTORY = `# Causes of the First World War

Four long-term causes made a regional crisis into a world war.

> 💡 **The big picture: a room full of gas.** The assassination was only the match.

## Alliances

Two blocs promised to defend their members.

${FENCE}text
## Answers
1. this is inside a code block, not an answer
${FENCE}

## Exercises

1. In your own words, why did one assassination lead to a war across Europe?
2. Which cause do you think mattered most?
   Give one reason.

## Answers

1. Alliances pulled each country in after the next, so a local quarrel could not stay local.
2. Any cause, argued with a reason: for example alliances, because they turned two countries' quarrel into everyone's.

## Further reading

A book list.
`;

describe("exercises written in the lesson's own text", () => {
  it("takes the numbered questions and their model answers out of the text that is taught", () => {
    const { readme, exercises } = readWrittenSections(HISTORY);
    assert.equal(exercises.length, 2);
    assert.deepEqual(exercises.map((e) => [e.name, e.kind, e.tests, e.language]), [["Exercise 1", "written", false, undefined], ["Exercise 2", "written", false, undefined]]);
    assert.equal(exercises[0].task, "In your own words, why did one assassination lead to a war across Europe?");
    assert.equal(exercises[1].task, "Which cause do you think mattered most?\nGive one reason.", "a question may run over lines");
    assert.match(exercises[0].solution!, /^Alliances pulled each country in/);
    assert.doesNotMatch(readme, /Alliances pulled each country in|why did one assassination/, "neither questions nor answers stay in the taught text");
    assert.match(readme, /## Alliances/);
    assert.match(readme, /## Further reading\n\nA book list\./, "what follows the answers is kept");
    assert.match(readme, /this is inside a code block/, "a heading inside a code block is not a section");
  });

  it("knows the section by other names, and leaves a section without numbered questions alone", () => {
    for (const [q, a] of [["Practice", "Model answers"], ["Questions", "Solutions"], ["Your turn", "Answer key"], ["Practise:", "Answers."]]) {
      const got = readWrittenSections(`# T\n\n## ${q}\n\n1. Why?\n\n## ${a}\n\n1. Because.\n`);
      assert.deepEqual([got.exercises[0]?.task, got.exercises[0]?.solution], ["Why?", "Because."], `${q} / ${a}`);
    }
    const prose = "# T\n\n## Exercises\n\nDo the ones in the book.\n";
    assert.deepEqual(readWrittenSections(prose), { readme: prose, exercises: [] });
    assert.equal(readWrittenSections("# T\n\n## Exercises\n\n1. Why?\n").exercises[0].solution, undefined, "a question need not have a model answer");
  });

  it("pairs answers by their number, not their place", () => {
    const got = readWrittenSections("# T\n\n## Exercises\n\n1. One?\n2. Two?\n3. Three?\n\n## Answers\n\n3. C.\n1. A.\n");
    assert.deepEqual(got.exercises.map((e) => e.solution), ["A.", undefined, "C."]);
  });

  it("reads a written exercise from its own file, paired with its model answer by number", () => {
    const e = readExercise({ name: "ex01_rewrite.md", code: "# Turn a note into a question\n\nRewrite the note as a question.\n" }, [{ name: "sol02_other.md", code: "no" }, { name: "sol01_rewrite.md", code: "# Model answer\n\nAsk for the idea, not the wording.\n" }, { name: "sol01_rewrite.py", code: "print(1)" }], 1)!;
    assert.deepEqual([e.kind, e.title, e.task, e.solution, e.tests, e.language], ["written", "Turn a note into a question", "Rewrite the note as a question.", "Ask for the idea, not the wording.", false, undefined]);
    assert.equal(readExercise({ name: "ex03_plain.md", code: "Just the question, no heading." }, [], 3)!.title, "Exercise 3");
    assert.equal(readExercise({ name: "ex04_empty.md", code: "  \n" }, [], 4), null);
  });

  it("makes a board to answer in words, with the model answer kept for marking", () => {
    const l = readLesson("01_unit/03_causes", { "README.md": HISTORY, "exercises/ex01_essay.md": "# A short essay\n\nExplain the alliances.", "exercises/ex02_sum.py": "# Exercise 2: add\nprint(1)\n" });
    const boards = exerciseBoards(l);
    assert.deepEqual(boards.map((b) => [b.kind, b.exercise]), [["write", "ex01_essay.md"], ["code", "ex02_sum.py"], ["write", "Exercise 1"], ["write", "Exercise 2"]]);
    const written = boards[2];
    assert.equal(written.task, "In your own words, why did one assassination lead to a war across Europe?");
    assert.match(written.solution!, /Alliances pulled/);
    assert.equal(written.starter, undefined);
    assert.equal(written.language, undefined);
  });

  it("never sends a model answer to the professor who writes the lesson", () => {
    const l = readLesson("01_unit/03_causes", { "README.md": HISTORY });
    for (const text of [lessonMaterial(l), folderLessonPrompt(l, "History", DEFAULT_PROFILE, [])]) {
      assert.doesNotMatch(text, /Alliances pulled each country in/);
      assert.match(text, /a room full of gas/);
    }
    assert.match(folderLessonPrompt(l, "History", DEFAULT_PROFILE, []), /the course's own 2 come between your talk boards and the quiz/);
  });
});

describe("marking and helping with an answer in words", () => {
  const board: Board = { title: "Exercise 1", kind: "write", lines: [{ w: "Your turn", s: "Your turn" }], task: "Why did one assassination lead to a war?", exercise: "Exercise 1", solution: "Alliances pulled each country in." };
  const lesson: Lesson = { id: "L", course: "History", number: 1, title: "Causes of the First World War", subject: "Causes", summary: "s", boards: [{ title: "Alliances", kind: "talk", lines: [{ w: "Two blocs", s: "x" }] }, board], createdAt: 0, updatedAt: 0, at: 1, seen: [0, 1] };

  it("marks against the course's model answer, for its ideas, and never shows it", () => {
    const p = writtenCheckPrompt(lesson, board, "Because countries had promised to defend each other.", DEFAULT_PROFILE);
    assert.match(p, /The course's own exercise \(Exercise 1\)/);
    assert.match(p, /Why did one assassination lead to a war\?/);
    assert.match(p, /model answer, for your eyes only \(judge against its ideas, not its wording; never show it/);
    assert.match(p, /Alliances pulled each country in\./);
    assert.match(p, /Because countries had promised to defend each other\./);
    assert.match(p, /"passed": true or false/);
    assert.match(writtenCheckPrompt(lesson, { ...board, solution: undefined }, "x", DEFAULT_PROFILE), /gives no model answer: judge it against what the lesson taught/);
  });

  it("shows the professor the question, the answer so far and the model answer when the student asks for help", () => {
    const msgs: ChatMsg[] = [{ id: "1", role: "you", text: "Is this on the right track?", at: 1, board: 1 }];
    const last = chatTurns(lesson, DEFAULT_PROFILE, msgs, { board: 1, code: "Because of the alliances." }).at(-1)!.content;
    assert.match(last, /an exercise answered in words \(Exercise 1\)\. The question: Why did one assassination/);
    assert.match(last, /The student's answer so far:\n"""\nBecause of the alliances\.\n"""/);
    assert.match(last, /model answer, for your eyes only/);
    assert.match(chatTurns(lesson, DEFAULT_PROFILE, msgs, { board: 1, code: "  " }).at(-1)!.content, /They have not written an answer yet\./);
    assert.match(starters(board, 1)[0], /this question/);
  });
});

describe("a course of any subject on disk", () => {
  let root: string;
  const put = (path: string, text: string) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  before(() => {
    root = mkdtempSync(join(tmpdir(), "walkmycode-anysubject-"));
    put("README.md", "# Modern history\n\nFrom 1900 to today.\n");
    put("NOTES.md", "# My private notes\n");
    put("01_the-great-war/README.md", "# The Great War\n\nThis unit's overview.\n");
    put("01_the-great-war/02_causes.md", HISTORY);
    put("01_the-great-war/01_europe-in-1900/README.md", "# Europe in 1900\n\nEmpires and rivals.\n\n## The empires\n");
    put("01_the-great-war/10_aftermath.md", "# Aftermath\n\nWhat the peace left behind.\n");
    put("01_the-great-war/glossary.md", "# Glossary\n");
    put("01_the-great-war/pictures/README.md", "# Picture credits\n");
    put("02_between-the-wars/README.md", "# Between the wars\n\nOne README, numbered: a lesson.\n\n## Boom and bust\n");
    put("appendix/README.md", "# Appendix\n");
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  it("finds lessons that are one numbered Markdown file or a numbered folder with only a README, in one order", () => {
    assert.deepEqual(findLessons(root), ["01_the-great-war/01_europe-in-1900", "01_the-great-war/02_causes.md", "01_the-great-war/10_aftermath.md", "02_between-the-wars"]);
  });

  it("leaves out what is not numbered: notes, a glossary, a credits folder, an appendix, and a unit's own README", () => {
    const found = findLessons(root).join("\n");
    assert.doesNotMatch(found, /NOTES|glossary|pictures|appendix/);
    assert.ok(!findLessons(root).includes("01_the-great-war"), "a folder with lessons under it is a unit, not a lesson");
  });

  it("loads a one-file lesson: its title, its sections, and its written exercises", () => {
    const l = loadLesson(root, "01_the-great-war/02_causes.md");
    assert.deepEqual([l.id, l.title, l.unit], ["01_the-great-war/02_causes.md", "Causes of the First World War", "The great war"]);
    assert.deepEqual(l.sections, ["Alliances", "Further reading"]);
    assert.equal(l.analogies.length, 1);
    assert.deepEqual(l.exercises.map((e) => e.kind), ["written", "written"]);
    assert.deepEqual(l.examples, []);
  });

  it("builds the outline with every kind of lesson, and names the course from its README", () => {
    const o = loadOutline(root);
    assert.equal(o.name, "Modern history");
    assert.deepEqual(o.units.map((u) => [u.title, u.lessons.map((l) => l.title)]), [["The great war", ["Europe in 1900", "Causes of the First World War", "Aftermath"]], ["Lessons", ["Between the wars"]]]);
    assert.equal(o.units[0].lessons[1].exercises, 2);
  });

  it("refuses a file that is not a lesson, or one outside the course", () => {
    assert.throws(() => loadLesson(root, "01_the-great-war/../../secrets.md"), /not in the course folder/);
    put("01_the-great-war/data.csv", "a,b");
    assert.throws(() => loadLesson(root, "01_the-great-war/data.csv"), /not in the course folder/);
  });

  it("treats a folder holding one README as a course of one lesson", () => {
    const o = loadOutline(join(root, "appendix"));
    assert.deepEqual([o.name, o.units.length, o.units[0].lessons[0].title], ["Appendix", 1, "Appendix"]);
  });
});

describe("the starter course", () => {
  let home: string;
  before(() => (home = mkdtempSync(join(tmpdir(), "walkmycode-starter-"))));
  after(() => rmSync(home, { recursive: true, force: true }));

  it("is written into a new folder and reads back as a course in every shape Learn knows", () => {
    const root = join(home, "my-course");
    const written = writeStarter(root);
    assert.deepEqual(written.sort(), Object.keys(STARTER_COURSE).sort());
    assert.equal(readFileSync(join(root, "README.md"), "utf8"), STARTER_COURSE["README.md"]);
    const o = loadOutline(root);
    assert.equal(o.name, "My course");
    assert.deepEqual(o.units.map((u) => [u.title, u.lessons.map((l) => l.id)]), [
      ["Getting started", ["01_getting-started/01_how-to-study.md", "01_getting-started/02_taking-notes"]],
      ["With code", ["02_with-code/01_first-program"]],
    ]);
    // One lesson in one file with exercises in its text; one folder with a written exercise file; one with code.
    const [study, notes] = o.units[0].lessons;
    assert.deepEqual([study.analogies, study.exercises], [3, 2]);
    assert.equal(notes.exercises, 1);
    const code = loadLesson(root, "02_with-code/01_first-program");
    assert.deepEqual([code.examples.map((e) => e.name), code.exercises.map((e) => [e.name, !!e.solution, e.language])], [["hello.py"], [["ex01_greet.py", true, "python"]]]);
    assert.match(loadLesson(root, "01_getting-started/02_taking-notes").exercises[0].solution!, /asks for the idea/);
    assert.match(loadLesson(root, "01_getting-started/01_how-to-study.md").exercises[1].solution!, /Several short sittings/);
  });

  it("never writes over anything: not into a folder with files, not onto a file, not under a folder that is not there", () => {
    const full = join(home, "has-files");
    mkdirSync(full);
    writeFileSync(join(full, "mine.txt"), "keep me");
    assert.throws(() => writeStarter(full), /already has files/);
    assert.equal(readFileSync(join(full, "mine.txt"), "utf8"), "keep me");
    assert.equal(existsSync(join(full, "README.md")), false);
    assert.throws(() => writeStarter(join(full, "mine.txt")), /a file, not a folder/);
    assert.throws(() => writeStarter(join(home, "nowhere", "deep", "course")), /folder above that one could not be found/);
    const empty = join(home, "empty");
    mkdirSync(empty);
    assert.equal(writeStarter(empty).length, Object.keys(STARTER_COURSE).length, "an empty folder is fine");
  });

  it("is made through the route, on this computer only, and never on a hosted server", async () => {
    const post = (body: unknown, headers: Record<string, string> = {}) =>
      guarded(learnCourseHandler())(new Request("http://localhost:3000/api/learn/course", { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
    const root = join(home, "by-route");
    const made = (await (await post({ path: root, starter: true })).json()) as { outline: { name: string; units: unknown[] } };
    assert.deepEqual([made.outline.name, made.outline.units.length], ["My course", 2]);
    assert.equal((await post({ path: root, starter: true })).status, 409, "a second time would write over the first");
    assert.equal((await post({ path: "relative", starter: true })).status, 400);
    assert.equal((await post({ path: join(home, "remote"), starter: true }, { host: "192.168.1.20:3000" })).status, 403);
    process.env.WALKMYCODE_MODE = "hosted";
    try {
      assert.equal((await post({ path: join(home, "hosted"), starter: true })).status, 403);
    } finally {
      delete process.env.WALKMYCODE_MODE;
    }
    assert.equal(existsSync(join(home, "remote")), false);
    assert.equal(existsSync(join(home, "hosted")), false);
  });
});
