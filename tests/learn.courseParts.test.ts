// A course in part folders, as the owner's Rust course is (src/lib/learnCourse.ts): a part that is only its
// README so far is a part of its own, not a loose "Lessons" one, and a project folder with no README yet
// (06_framework_mastery/axum_basics: Cargo.toml and src/) is a lesson, taught from its code.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { findLessons, loadLesson, loadOutline } from "../src/lib/learnCourse";

const root = mkdtempSync(join(tmpdir(), "wmc-parts-"));
const put = (rel: string, text: string) => {
  const at = join(root, rel);
  mkdirSync(join(at, ".."), { recursive: true });
  writeFileSync(at, text);
};
put("README.md", "# Mastering Rust\n\nFrom basics to mastery.\n");
put("01_foundations/01_hello_world/README.md", "# Hello World\n\n## 1.1 Installation\n");
put("01_foundations/01_hello_world/examples/hello.rs", "fn main() {}\n");
put("01_foundations/02_guessing_game/README.md", "# Guessing Game\n");
put("01_foundations/02_guessing_game/Cargo.toml", "[package]\nname = \"guessing_game\"\n");
put("01_foundations/02_guessing_game/src/main.rs", "fn main() {}\n");
put("05_mastery/README.md", "# Mastery\n\nWhat comes after the Book.\n");
put("06_framework_mastery/README.md", "# Framework mastery\n");
put("06_framework_mastery/axum_basics/Cargo.toml", "[package]\nname = \"axum_basics\"\n");
put("06_framework_mastery/axum_basics/src/main.rs", "// A first Axum server.\nfn main() {}\n");
after(() => rmSync(root, { recursive: true, force: true }));

describe("a course in part folders", () => {
  it("finds the project with no README as a lesson, and a part that is only its README as one", () => {
    assert.deepEqual(findLessons(root), ["01_foundations/01_hello_world", "01_foundations/02_guessing_game", "05_mastery", "06_framework_mastery/axum_basics"]);
  });

  it("gives every part its own name in the outline: no loose \"Lessons\"", () => {
    const o = loadOutline(root);
    assert.deepEqual(
      o.units.map((u) => [u.title, u.lessons.map((l) => l.title)]),
      [
        ["Foundations", ["Hello World", "Guessing Game"]],
        ["Mastery", ["Mastery"]],
        ["Framework mastery", ["Axum basics"]],
      ],
    );
  });

  it("teaches the project from its code", () => {
    const l = loadLesson(root, "06_framework_mastery/axum_basics");
    assert.match(l.project?.code ?? "", /A first Axum server/);
  });
});
