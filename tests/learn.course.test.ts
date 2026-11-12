// A course kept as a folder of lessons (src/learn/lib/courseFolder.ts reads the
// text, src/lib/learnCourse.ts walks the folder): the outline in folder order,
// a lesson's analogies and checklist, exercises paired with their solutions,
// and what is never read. The folder is made in a temp directory, in the shape
// of the owner's Rust course.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { brief, courseFromOutline, exerciseBoards, languageOfFile, leadingComment, lessonMaterial, naturalCompare, pairKey, readExercise, readLesson, readReadme, titleOfDir } from "../src/learn/lib/courseFolder";
import { folderBoards, folderLessonPrompt, folderTalkBoards, type WrittenBoard } from "../src/learn/lib/professor";
import { nextUntaught } from "../src/learn/lib/roadmap";
import { DEFAULT_PROFILE, type Lesson } from "../src/learn/lib/types";
import { guarded } from "../src/lib/providers/guard";
import { courseRoot, findLessons, learnCourseHandler, loadLesson, loadOutline } from "../src/lib/learnCourse";

const README = `<!-- hand-written lesson -->
# Ownership

**The Rust Book, chapter 4:** [Understanding Ownership](https://doc.rust-lang.org/book/ch04-00.html)

Ownership is how Rust guarantees memory safety **without a garbage collector**. Take your time here.

> 💡 **The big picture: toys in a playroom.** Every toy belongs to exactly one child.
> A child can give a toy away, or lend it.

## Why ownership exists

| Approach | Cost |
|---|---|
| Garbage collector | Pauses |

> 💡 **Analogy: who tidies the playroom?** A cleaner walks around during playtime.

## Move

\`\`\`rust
// > 💡 not an analogy: this is code
let s2 = s1;
## not a heading
\`\`\`

> A plain quote, not an analogy.

> 💡 **Analogy: handing over the cloakroom ticket.** The coat never moves.

## Checklist

- [ ] [4.1 What is Ownership?](https://doc.rust-lang.org/book/ch04-01.html)
- [x] Beyond the Book: \`Copy\` vs \`Clone\`
`;

const EX1 = `//! Exercise 1: fix the move error.
//!
//! This does not compile (E0382). Make it compile and print both lines
//! WITHOUT calling \`.clone()\`.
//!
//! Run: cargo run -p ownership --features exercises --bin ex01_fix_move

fn print_greeting(name: String) {
    println!("Hello, {name}!");
}

fn main() {
    let name = String::from("Ferris");
    print_greeting(name);
    println!("{name} is the Rust mascot");
}
`;
const SOL1 = EX1.replace("Exercise 1", "SOLUTION to exercise 1").replace("name: String", "name: &str").replace("print_greeting(name)", "print_greeting(&name)");
const EX4 = `//! Exercise 4: return a slice.
//!
//! Implement \`first_word\`.
//!
//! Test: cargo test -p ownership --features exercises --bin ex04_first_word

fn first_word(s: &str) -> &str {
    todo!()
}

fn main() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_word() {
        assert_eq!(first_word("hello"), "hello");
    }
}
`;

let root: string;
const put = (path: string, text: string) => {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};

before(() => {
  root = mkdtempSync(join(tmpdir(), "walkmycode-course-"));
  put("README.md", "# Mastering Rust: basics to mastery\n\nA hands-on course that follows the Book.\n");
  put("Cargo.toml", "[workspace]\n");
  // Units and lessons numbered so that plain sorting would put 10 before 2.
  put("01_foundations/README.md", "# 01 Foundations\n");
  put("01_foundations/02_guessing_game/README.md", "# Guessing Game\n\nRun it: `cargo run -p guessing_game`\n\n## Concepts\n\n- [ ] [2. Programming a Guessing Game](https://x)\n");
  put("01_foundations/02_guessing_game/src/main.rs", "fn main() {}\n");
  put("01_foundations/10_ownership/README.md", README);
  put("01_foundations/10_ownership/Cargo.toml", "[package]\nname = \"ownership\"\n");
  put("01_foundations/10_ownership/examples/move_semantics.rs", "fn main() {\n    let s1 = String::from(\"hi\");\n    let s2 = s1;\n    println!(\"{s2}\");\n}\n");
  put("01_foundations/10_ownership/examples/slices.rs", "fn main() {}\r\n");
  put("01_foundations/10_ownership/exercises/ex01_fix_move.rs", EX1);
  put("01_foundations/10_ownership/exercises/ex04_first_word.rs", EX4);
  put("01_foundations/10_ownership/exercises/notes.dat", "not code");
  put("01_foundations/10_ownership/solutions/sol01_fix_move.rs", SOL1);
  put("01_foundations/10_ownership/src/main.rs", "fn main() { println!(\"report\"); }\n");
  // Never read: build output, hidden files, secrets.
  put("01_foundations/10_ownership/target/debug/README.md", "# built\n");
  put("01_foundations/10_ownership/examples/.env", "SECRET=1\n");
  put("01_foundations/10_ownership/.env", "SECRET=1\n");
  put("02_core/01_structs/README.md", "# Structs\n\nA struct groups values.\n");
  put("02_core/01_structs/src/main.rs", "fn main() {}\n");
  // A folder with a README, no number in its name and nothing to practise with is not a lesson.
  put("docs/README.md", "# Notes\n");
  put("empty/keep.dat", "nothing to teach");
  put("node_modules/pkg/README.md", "# pkg\n");
  put("node_modules/pkg/src/x.rs", "");
});
after(() => rmSync(root, { recursive: true, force: true }));

describe("course folders: reading a lesson's text", () => {
  it("names folders the way a person would", () => {
    assert.equal(titleOfDir("06_ownership"), "Ownership");
    assert.equal(titleOfDir("02_core_types_and_errors"), "Core types and errors");
    assert.equal(titleOfDir("axum-basics"), "Axum basics");
    assert.equal(titleOfDir("01"), "01");
    assert.deepEqual(["10_x", "2_x", "1_x"].sort(naturalCompare), ["1_x", "2_x", "10_x"]);
  });

  it("reads the title, the opening line, the sections, the analogies and the checklist", () => {
    const r = readReadme(README);
    assert.equal(r.title, "Ownership");
    assert.equal(r.summary, "Ownership is how Rust guarantees memory safety without a garbage collector. Take your time here.");
    assert.deepEqual(r.sections, ["Why ownership exists", "Move", "Checklist"]);
    assert.equal(r.analogies.length, 3, "three 💡 blocks; the plain quote and the one inside the code are not analogies");
    assert.match(r.analogies[0], /^💡 \*\*The big picture: toys in a playroom\.\*\* Every toy belongs to exactly one child\. A child can give/);
    assert.match(r.analogies[2], /cloakroom ticket/);
    assert.deepEqual(r.checklist, ["4.1 What is Ownership?", "Beyond the Book: Copy vs Clone"]);
  });

  it("does not take a 'Run it' line for what the lesson is about", () => {
    assert.equal(readReadme("# Control Flow\n\nRun it: `cargo run -p control_flow`\n\n## Concepts\n").summary, "");
  });

  it("cuts a long opening at a sentence, or at a word with an ellipsis", () => {
    assert.equal(brief("One sentence here. Two is the longer one.", 30), "One sentence here.");
    assert.equal(brief("A single very long sentence with no stop in it", 20), "A single very long…");
    assert.equal(brief("short", 20), "short");
  });

  it("reads an exercise's own instructions from the comment it opens with", () => {
    assert.equal(leadingComment(EX1).split("\n")[0], "Exercise 1: fix the move error.");
    assert.equal(leadingComment("# Exercise: sum a list\n# Return the total.\n\ndef total(xs):\n    pass\n"), "Exercise: sum a list\nReturn the total.");
    assert.equal(leadingComment('"""Exercise 2: reverse.\n\nReturn the text reversed."""\n\ndef rev(s): ...\n'), "Exercise 2: reverse.\n\nReturn the text reversed.");
    assert.equal(leadingComment("#![allow(unused)]\nfn main() {}\n"), "", "an attribute is not a comment");
    assert.equal(leadingComment("fn main() {}\n"), "");
  });

  it("pairs an exercise with its solution by number, else by name", () => {
    assert.equal(pairKey("ex01_fix_move.rs"), pairKey("sol01_fix_move.rs"));
    assert.equal(pairKey("ex1_a.rs"), pairKey("sol01_b.rs"), "the number decides");
    assert.equal(pairKey("exercise_slices.py"), pairKey("solution_slices.py"));
    assert.notEqual(pairKey("ex02_x.rs"), pairKey("sol03_x.rs"));
  });

  it("makes an exercise from its file: title, task without the cargo line, solution, tests", () => {
    const e = readExercise({ name: "ex01_fix_move.rs", code: EX1 }, [{ name: "sol04_first_word.rs", code: "x" }, { name: "sol01_fix_move.rs", code: SOL1 }], 1)!;
    assert.equal(e.title, "Exercise 1: fix the move error");
    assert.match(e.task, /^This does not compile \(E0382\)/);
    assert.doesNotMatch(e.task, /cargo run/);
    assert.equal(e.solution, SOL1);
    assert.equal(e.tests, false);
    assert.equal(e.language, "rust");
    const t = readExercise({ name: "ex04_first_word.rs", code: EX4 }, [], 2)!;
    assert.equal(t.tests, true);
    assert.equal(t.solution, undefined);
    assert.equal(readExercise({ name: "notes.dat", code: "x" }, [], 1), null);
    assert.equal(languageOfFile("a.PY"), "python");
    assert.equal(languageOfFile("a.go"), null);
  });

  it("reads a lesson from its files", () => {
    const l = readLesson("01_foundations/10_ownership", {
      "README.md": README,
      "examples/b.rs": "fn main() {}",
      "examples/a.rs": "fn main() {}",
      "examples/deep/c.rs": "nested files are not examples",
      "exercises/ex01_fix_move.rs": EX1,
      "solutions/sol01_fix_move.rs": SOL1,
      "src/main.rs": "fn main() {}",
    });
    assert.equal(l.id, "01_foundations/10_ownership");
    assert.equal(l.title, "Ownership");
    assert.equal(l.unit, "Foundations");
    assert.deepEqual(l.examples.map((e) => e.name), ["a.rs", "b.rs"]);
    assert.equal(l.exercises.length, 1);
    assert.equal(l.project?.name, "src/main.rs");
    assert.equal(readLesson("03_x/04_traits", { "README.md": "no heading here" }).title, "Traits");
  });
});

describe("course folders: walking the folder", () => {
  it("wants a full path to a folder that exists", () => {
    assert.equal(courseRoot(` "${root}" `), root);
    assert.throws(() => courseRoot("rust"), /full path/);
    assert.throws(() => courseRoot(join(root, "nope")), /could not be found/);
    assert.throws(() => courseRoot(join(root, "README.md")), /could not be found/);
    assert.throws(() => courseRoot(""), /folder/);
    assert.throws(() => courseRoot(7), /folder/);
  });

  it("finds every lesson folder in a person's order, and nothing in build or package folders", () => {
    assert.deepEqual(findLessons(root), ["01_foundations/02_guessing_game", "01_foundations/10_ownership", "02_core/01_structs"]);
  });

  it("treats a folder that is itself one lesson as a course of one", () => {
    assert.deepEqual(findLessons(join(root, "01_foundations", "10_ownership")), [""]);
    const o = loadOutline(join(root, "01_foundations", "10_ownership"));
    assert.equal(o.name, "Ownership");
    assert.equal(o.units.length, 1);
    assert.equal(o.units[0].lessons[0].exercises, 2);
  });

  it("builds the outline: the course's name, its units, and what each lesson holds", () => {
    const o = loadOutline(root);
    assert.equal(o.name, "Mastering Rust: basics to mastery");
    assert.equal(o.summary, "A hands-on course that follows the Book.");
    assert.deepEqual(o.units.map((u) => u.title), ["Foundations", "Core"]);
    const own = o.units[0].lessons[1];
    assert.deepEqual({ id: own.id, title: own.title, analogies: own.analogies, examples: own.examples, exercises: own.exercises }, { id: "01_foundations/10_ownership", title: "Ownership", analogies: 3, examples: 2, exercises: 2 });
    assert.equal(o.units[0].lessons[0].summary, "2. Programming a Guessing Game", "a lesson that only lists its sections is summed up by them");
  });

  it("loads a lesson's own files and never a secret, a hidden file or build output", () => {
    const l = loadLesson(root, "01_foundations/10_ownership");
    assert.deepEqual(l.examples.map((e) => e.name), ["move_semantics.rs", "slices.rs"]);
    assert.equal(l.examples[1].code, "fn main() {}\n", "line endings are made plain");
    assert.deepEqual(l.exercises.map((e) => [e.name, e.tests, !!e.solution]), [["ex01_fix_move.rs", false, true], ["ex04_first_word.rs", true, false]]);
    assert.doesNotMatch(JSON.stringify(l), /SECRET|# built|not code/);
  });

  it("refuses a lesson outside the course folder", () => {
    assert.throws(() => loadLesson(join(root, "01_foundations"), "../02_core/01_structs"), /not in the course folder/);
    assert.throws(() => loadLesson(root, "01_foundations/nope"), /not in the course folder/);
  });

  it("answers POST /api/learn/course with the outline or one lesson, to this computer only", async () => {
    const post = (body: unknown, headers: Record<string, string> = {}) =>
      guarded(learnCourseHandler())(new Request("http://localhost:3000/api/learn/course", { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
    const outline = (await (await post({ path: root })).json()) as { outline: { units: unknown[] } };
    assert.equal(outline.outline.units.length, 2);
    const one = (await (await post({ path: root, lesson: "02_core/01_structs" })).json()) as { lesson: { title: string } };
    assert.equal(one.lesson.title, "Structs");
    assert.equal((await post({ path: join(root, "empty") })).status, 422, "a folder with no lessons");
    assert.equal((await post({ path: "relative/path" })).status, 400);
    assert.equal((await post({ path: root, lesson: "../x" })).status, 404);
    assert.equal((await post({ path: root }, { host: "192.168.1.20:3000" })).status, 403);
    // A hosted server reads nobody's folders.
    process.env.WALKMYCODE_MODE = "hosted";
    try {
      assert.equal((await post({ path: root })).status, 403);
    } finally {
      delete process.env.WALKMYCODE_MODE;
    }
  });
});

describe("course folders: from the folder to a lesson", () => {
  const lesson = () => loadLesson(root, "01_foundations/10_ownership");

  it("makes the outline a course: units are stages, lessons are modules by their path", () => {
    const course = courseFromOutline(loadOutline(root), undefined, "c1", 100);
    assert.equal(course.name, "Mastering Rust: basics to mastery");
    assert.deepEqual(course.folder, { path: root });
    assert.deepEqual(course.stages.map((s) => s.title), ["Foundations", "Core"]);
    assert.deepEqual(course.stages[0].modules.map((m) => m.id), ["01_foundations/02_guessing_game", "01_foundations/10_ownership"]);
    assert.deepEqual(course.stages[0].modules[1].topics, ["3 sections", "2 examples to run", "2 exercises"]);
    // Read again later: the same course, its id and start kept.
    const again = courseFromOutline(loadOutline(root), course, "c2", 200);
    assert.deepEqual([again.id, again.createdAt, again.updatedAt], ["c1", 100, 200]);
  });

  it("teaches the next lesson nobody has started, in folder order", () => {
    const course = courseFromOutline(loadOutline(root), undefined, "c1", 100);
    assert.equal(nextUntaught(course, [])?.module.id, "01_foundations/02_guessing_game");
    const taught = { course: course.name, moduleId: "01_foundations/02_guessing_game" } as Lesson;
    assert.equal(nextUntaught(course, [taught])?.module.id, "01_foundations/10_ownership");
  });

  it("turns the folder's exercises into code boards with the solution and the tests", () => {
    const boards = exerciseBoards(lesson());
    assert.equal(boards.length, 2);
    assert.deepEqual(
      boards.map((b) => [b.kind, b.language, b.exercise, b.tests ?? false, !!b.solution]),
      [["code", "rust", "ex01_fix_move.rs", false, true], ["code", "rust", "ex04_first_word.rs", true, false]],
    );
    assert.equal(boards[0].starter, EX1);
    assert.match(boards[0].task!, /E0382/);
    assert.equal(boards[1].expect, "Every test passes.");
  });

  it("gives the professor the author's README, examples and project, and only names the exercises", () => {
    const m = lessonMaterial(lesson());
    assert.match(m, /toys in a playroom/);
    assert.match(m, /### examples\/move_semantics\.rs\n```rust\nfn main\(\) \{/);
    assert.match(m, /Its small project \(src\/main\.rs\)/);
    assert.match(m, /1\. ex01_fix_move\.rs: Exercise 1: fix the move error/);
    assert.doesNotMatch(m, /name: &str/, "a solution never reaches the lesson-writing prompt");
  });

  it("asks for the author's order, their analogies, and an example file by name", () => {
    const l = lesson();
    const p = folderLessonPrompt(l, "Mastering Rust", DEFAULT_PROFILE, []);
    assert.equal(folderTalkBoards(l), 4);
    assert.match(p, /4 "talk" boards/);
    assert.match(p, /use the author's own picture/);
    assert.match(p, /one of: move_semantics\.rs, slices\.rs/);
    assert.match(p, /the course's own 2 come between your talk boards and the quiz/);
    assert.match(p, /"cards"/);
    // A lesson that only lists its sections is taught in the course's style.
    const thin = folderLessonPrompt(loadLesson(root, "01_foundations/02_guessing_game"), "Mastering Rust", DEFAULT_PROFILE, []);
    assert.match(thin, /only listed what the lesson must cover/);
  });

  it("puts each named example on its board and the exercises between the talk and the quiz", () => {
    const l = lesson();
    const talk = (title: string, exampleName?: string): WrittenBoard => ({ title, kind: "talk", lines: [{ w: "x", s: "x" }], ...(exampleName ? { exampleName } : {}) });
    const written: WrittenBoard[] = [
      talk("Why"),
      talk("Move", "move_semantics.rs"),
      talk("Again", "examples/move_semantics"),
      talk("Unknown", "nope.rs"),
      { title: "Quiz", kind: "quiz", lines: [], quiz: [] },
      { title: "Explain it back", kind: "explain", lines: [], questions: ["?"] },
    ];
    const boards = folderBoards(written, l, exerciseBoards(l));
    assert.deepEqual(boards.map((b) => b.kind), ["talk", "talk", "talk", "talk", "code", "code", "quiz", "explain"]);
    assert.deepEqual(boards[1].example, { name: "move_semantics.rs", code: l.examples[0].code, language: "rust" });
    assert.equal(boards[2].example, undefined, "an example is used once");
    assert.equal(boards[3].example, undefined, "a file the folder does not have is dropped");
    assert.ok(!("exampleName" in boards[1]));
    // With no quiz to go before, the exercises come last.
    assert.deepEqual(folderBoards([talk("a"), talk("b")], l, exerciseBoards(l)).map((b) => b.kind), ["talk", "talk", "code", "code"]);
  });
});
