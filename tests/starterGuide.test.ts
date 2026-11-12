// "Build it" after New project (src/lib/starterGuide.ts): the form's "What should
// it do?" tidied to one line, and the request the guide sends for it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BRIEF_MAX, buildItAsk, cleanBrief, STARTER_GUIDE } from "../src/lib/starterGuide";
import { STARTER_LANGUAGE } from "../src/lib/projectStack";

describe("cleanBrief", () => {
  it("left empty, or only spaces, is no brief", () => {
    assert.equal(cleanBrief(undefined), "");
    assert.equal(cleanBrief(""), "");
    assert.equal(cleanBrief("  \n\t "), "");
  });

  it("folds lines and runs of spaces into one line", () => {
    assert.equal(cleanBrief("  a todo list\n\nwhere I can   add,\ttick off\r\nand delete tasks  "), "a todo list where I can add, tick off and delete tasks");
  });

  it("is capped, and never ends on a space the cap left behind", () => {
    const long = `${"word ".repeat(200)}end`;
    const out = cleanBrief(long);
    assert.ok(out.length <= BRIEF_MAX);
    assert.equal(out, out.trim());
  });
});

describe("buildItAsk", () => {
  it("names the framework, carries the brief, and asks for files and how to run it", () => {
    assert.equal(
      buildItAsk("Laravel", "a todo list where I can add, tick off and delete tasks"),
      "Build this in the new Laravel project: a todo list where I can add, tick off and delete tasks. Follow the framework's conventions, write the files, and tell me how to run it.",
    );
  });

  it("doesn't double the full stop the user typed, and tidies the brief first", () => {
    assert.equal(buildItAsk("Next.js", "  a notes app \n with tags!  "), "Build this in the new Next.js project: a notes app with tags. Follow the framework's conventions, write the files, and tell me how to run it.");
    assert.ok(!buildItAsk("FastAPI", "a todo API...").includes(".. "));
  });
});

describe("starters", () => {
  it("every starter the guide welcomes has a language for the top bar", () => {
    for (const id of Object.keys(STARTER_GUIDE)) assert.ok(STARTER_LANGUAGE[id], id);
  });
});
