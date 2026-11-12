// The diagrams' blueprint (src/lib/diagramStyle.ts): which lane a box is in, the title, the kind.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MapNode } from "../src/analyzer/types";
import { frontMatter, guessLane, kindLabel, mapLanes } from "../src/lib/diagramStyle";

describe("diagram lanes", () => {
  it("guesses a box's lane from its words when the map can't tell", () => {
    assert.equal(guessLane("LoginForm\ncomponents/LoginForm.tsx"), "ui");
    assert.equal(guessLane("POST /api/login"), "api");
    assert.equal(guessLane("User\ntable"), "data");
    assert.equal(guessLane("Postgres"), "data");
    assert.equal(guessLane("Resend\nemail service"), "external");
    assert.equal(guessLane("Stripe"), "external");
    assert.equal(guessLane("signin()"), "logic");
    assert.equal(guessLane("User"), "ui", "a person, not the table");
  });

  it("takes the lane from the map: a card's name, a route, a file, with or without ()", () => {
    const node = (o: Partial<MapNode>) => ({ id: o.name ?? "x", area: "", kind: "module", layer: "logic", name: "x", ...o }) as MapNode;
    const lanes = mapLanes({
      nodes: [
        node({ name: "LoginForm", layer: "ui", kind: "component", file: "components/LoginForm.tsx" }),
        node({ name: "login", layer: "api", kind: "route", method: "POST", path: "/api/login", file: "app/api/login/route.ts" }),
        node({ name: "signin", layer: "logic", file: "lib/auth.ts" }),
        node({ name: "User", layer: "data", kind: "table" }),
      ],
    });
    assert.equal(lanes("LoginForm\ncomponents/LoginForm.tsx"), "ui");
    assert.equal(lanes("POST /api/login<br/>app/api/login/route.ts"), "api");
    assert.equal(lanes("signin()"), "logic");
    assert.equal(lanes("user"), "data", "the map knows User is a table");
    assert.equal(lanes("auth"), "logic", "a file's name");
    assert.equal(lanes("Something else"), null);
  });
});

describe("diagram title and kind", () => {
  it("lifts the title out of Mermaid front matter and leaves the rest", () => {
    assert.deepEqual(frontMatter("---\ntitle: Sign-in, start to end\n---\nflowchart LR\n  a --> b"), { title: "Sign-in, start to end", body: "flowchart LR\n  a --> b" });
    assert.deepEqual(frontMatter('---\ntitle: "Quoted"\nconfig: {}\n---\nsequenceDiagram'), { title: "Quoted", body: "sequenceDiagram" });
    assert.deepEqual(frontMatter("flowchart TD\n  a --> b"), { title: null, body: "flowchart TD\n  a --> b" });
  });

  it("names the kind of diagram for the window bar", () => {
    assert.equal(kindLabel("flowchart-v2"), "Flow");
    assert.equal(kindLabel("sequence"), "Step by step");
    assert.equal(kindLabel("er"), "Data model");
    assert.equal(kindLabel("stateDiagram"), "States");
    assert.equal(kindLabel("classDiagram"), "Classes");
    assert.equal(kindLabel(null), "Diagram");
  });
});
