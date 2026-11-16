// The scratchpad's language (src/learn/lib/lessonLanguage.ts): a Rust lesson with no example opened Python.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lessonLanguage } from "../src/learn/lib/lessonLanguage";
import type { Board, Lesson } from "../src/learn/lib/types";

const talk = (title: string, w: string[]): Board => ({ title, kind: "talk", lines: w.map((x) => ({ w: x, s: x })) }) as Board;
const lesson = (course: string, title: string, boards: Board[]) => ({ course, title, summary: "", boards }) as unknown as Lesson;

describe("the scratchpad speaks the lesson's language", () => {
  it("its own exercise's or example's first", () => {
    const code = { title: "Try it", kind: "code", lines: [], language: "sql" } as unknown as Board;
    assert.equal(lessonLanguage(lesson("Mastering Rust", "Hello", [code])), "sql");
  });

  it("then the course's name: the Rust course's Hello World (no example) is Rust, not Python", () => {
    const boards = [talk("What we will learn, and getting Rust", ["rustup = the installer", "rustc = the compiler"])];
    assert.equal(lessonLanguage(lesson("Mastering Rust: basics to mastery", "Hello World", boards)), "rust");
    assert.equal(lessonLanguage(lesson("Machine learning with Python", "What is a model?", [])), "python");
    assert.equal(lessonLanguage(lesson("TypeScript in practice", "Types", [])), "typescript");
  });

  it("then the code on its boards, and Python only when nothing says otherwise", () => {
    assert.equal(lessonLanguage(lesson("Programming", "Hello", [talk("Hello", ["fn main() { … }", 'println!("Hello, world!");'])])), "rust");
    assert.equal(lessonLanguage(lesson("Programming", "Hello", [talk("Hello", ["console.log('hi')"])])), "javascript");
    assert.equal(lessonLanguage(lesson("How computers think", "Bits", [talk("Bits", ["A bit is 0 or 1"])])), "python");
  });
});
