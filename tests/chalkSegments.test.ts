// The chalkboard's split of an answer into prose and fenced blocks (src/lib/chalkSegments.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { segments, tableRuns } from "../src/lib/chalkSegments";

describe("chalk segments", () => {
  it("keeps a mermaid diagram whole, blank lines and all, between the prose", () => {
    const text = "Here is sign-in:\n\n```mermaid\nsequenceDiagram\n  User->>Web: submit\n\n  Web->>API: POST /login\n```\n\n1. The form posts `web/login.ts:12`";
    assert.deepEqual(segments(text), [
      { kind: "prose", body: "Here is sign-in:" },
      { kind: "fence", lang: "mermaid", body: "sequenceDiagram\n  User->>Web: submit\n\n  Web->>API: POST /login", closed: true },
      { kind: "prose", body: "1. The form posts `web/login.ts:12`" },
    ]);
  });

  it("marks a fence still being written as open", () => {
    assert.deepEqual(segments("Drawing:\n```mermaid\nflowchart TD\n  A-->B"), [
      { kind: "prose", body: "Drawing:" },
      { kind: "fence", lang: "mermaid", body: "flowchart TD\n  A-->B", closed: false },
    ]);
  });

  it("leaves plain prose as one segment", () => {
    assert.deepEqual(segments("One.\n\nTwo."), [{ kind: "prose", body: "One.\n\nTwo." }]);
  });
});

describe("chalk tables", () => {
  it("finds a markdown table in a block, with the lines before and after it kept as text", () => {
    const lines = ["Who reads and writes each table", "| Table | Code | What it does |", "|---|:--|---:|", "| User | `lib/auth.ts:9-33` | sign in |", "| Task | `lib/tasks.ts:5` | a \\| b |", "That is all."];
    assert.deepEqual(tableRuns(lines), [
      { kind: "text", lines: ["Who reads and writes each table"] },
      { kind: "table", head: ["Table", "Code", "What it does"], rows: [["User", "`lib/auth.ts:9-33`", "sign in"], ["Task", "`lib/tasks.ts:5`", "a | b"]] },
      { kind: "text", lines: ["That is all."] },
    ]);
  });

  it("leaves pipes that are not a table alone: no rule line under the first row, or a lone row", () => {
    assert.deepEqual(tableRuns(["| just | pipes |", "and text"]), [{ kind: "text", lines: ["| just | pipes |", "and text"] }]);
    assert.deepEqual(tableRuns(["a || b"]), [{ kind: "text", lines: ["a || b"] }]);
  });

  it("takes a header and rule with no rows yet (an answer still being written)", () => {
    assert.deepEqual(tableRuns(["| A | B |", "|---|---|"]), [{ kind: "table", head: ["A", "B"], rows: [] }]);
  });
});
