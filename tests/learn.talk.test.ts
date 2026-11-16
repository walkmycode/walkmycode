// Talking with the professor (src/learn/lib/talk.ts, the professor's Settings in agentSettings.ts): what he is
// told, what he hears when the board changes, and what his functions do to the lesson.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAgentSettings, PROFESSOR_GREETING, PROFESSOR_PERSONA, withLesson } from "../src/lib/voice/agentSettings";
import { PROFESSOR_FUNCTION_NAMES } from "../src/lib/voice/lecturer/professorFunctions";
import { settingsHandler } from "../src/lib/voice/routes";
import { boardDiagramPrompt, boardNote, lessonBrief, lessonKeyterms, runProfessorCall, type ProfessorUi } from "../src/learn/lib/talk";
import type { Board, Lesson } from "../src/learn/lib/types";

const talk = (title: string, lines: [string, string][], extra: Partial<Board> = {}): Board => ({ title, kind: "talk", lines: lines.map(([w, s]) => ({ w, s })), ...extra });
const lesson: Lesson = {
  id: "l1",
  course: "Machine learning, from zero",
  number: 1,
  title: "What does it mean for a machine to learn?",
  subject: "ml",
  summary: "Rules written by hand, and rules learned from examples.",
  boards: [
    talk("Good evening", [["Today, one question", "Today, one question."]]),
    talk("The old way: people write the rules", [["**rules** by hand", "For decades, programmers wrote rules by hand."]], { analogy: "A recipe written for a cook who never tastes." }),
    { title: "Quick check", kind: "quiz", lines: [], quiz: [{ q: "Who writes the rules?", options: ["People", "Data"], answer: 0, why: "In the old way." }] },
    { title: "Explain it back", kind: "explain", lines: [] },
  ],
  createdAt: 1,
  updatedAt: 1,
  at: 1,
  seen: [0, 1],
} as unknown as Lesson;

describe("the professor's Settings", () => {
  it("are the professor's own: persona, functions, greeting and Think Live", () => {
    const s = buildAgentSettings({ model: "fast", room: "learn" });
    const thinks = Array.isArray(s.agent.think) ? s.agent.think : [s.agent.think];
    for (const t of thinks) {
      assert.equal(t.prompt, PROFESSOR_PERSONA);
      assert.deepEqual(t.functions.map((f) => f.name), PROFESSOR_FUNCTION_NAMES);
      assert.ok(t.functions.every((f) => !("endpoint" in f)), "no endpoint: every call comes back to the page");
    }
    assert.equal(s.agent.greeting, PROFESSOR_GREETING);
    assert.equal(s.agent.think_live?.provider.presence_check_max_count, 1, "one gentle check-in: two nag");
    assert.equal(s.agent.think_live?.provider.agent_backchannel_sensitivity, 0, "no mm-hmm through speakers: the echo guard would mute the student");
    assert.equal(buildAgentSettings({ model: "fast", room: "learn", headphones: true }).agent.think_live?.provider.agent_backchannel_sensitivity, 0.35);
  });

  it("leave Explore's lecturer as it was", () => {
    const s = buildAgentSettings({ model: "fast" });
    assert.equal(s.agent.think_live, undefined);
    assert.notEqual(s.agent.greeting, PROFESSOR_GREETING);
    assert.ok((Array.isArray(s.agent.think) ? s.agent.think : [s.agent.think]).every((t) => t.functions.some((f) => f.name === "query_map")));
  });

  it("come from the server for ?room=learn, and the lesson is added in the page", async () => {
    const res = await settingsHandler()(new Request("http://localhost/api/voice/settings?room=learn"));
    const s = (await res.json()) as ReturnType<typeof buildAgentSettings>;
    assert.equal(s.agent.greeting, PROFESSOR_GREETING);
    const withIt = withLesson(s, { lesson: lessonBrief(lesson, 1, { name: "Ama", about: "A beginner." }), keyterms: ["NumPy"] });
    const prompt = (Array.isArray(withIt.agent.think) ? withIt.agent.think[0] : withIt.agent.think).prompt;
    assert.ok(prompt.startsWith(PROFESSOR_PERSONA));
    assert.match(prompt, /# The lesson on screen/);
    assert.match(prompt, /Board 2: The old way: people write the rules/);
    assert.deepEqual(withIt.agent.listen.provider.keyterms, ["NumPy"]);
  });
});

describe("what the professor knows", () => {
  it("the lesson, the student, the boards seen, and the board on screen in full", () => {
    const brief = lessonBrief(lesson, 1, { name: "Ama", about: "A beginner who likes examples." }, ["Rules break on new cases."]);
    assert.match(brief, /Lesson 1: What does it mean for a machine to learn\?/);
    assert.match(brief, /The student, Ama: A beginner who likes examples\./);
    assert.match(brief, /1\. Good evening {2}\(seen\)/);
    assert.match(brief, /2\. The old way: people write the rules {2}← on screen/);
    assert.match(brief, /says "For decades, programmers wrote rules by hand\."/);
    assert.match(brief, /the everyday picture: A recipe written for a cook who never tastes\./);
    assert.match(brief, /- Rules break on new cases\./);
  });

  it("hears which board is on screen when it changes", () => {
    assert.match(boardNote(lesson, 2), /board 3 of 4/);
    assert.match(boardNote(lesson, 2), /a quiz of 1 question/);
  });

  it("keyterms are the lesson's own names, not common words", () => {
    const l = { ...lesson, title: "NumPy arrays and pandas DataFrames" } as Lesson;
    assert.deepEqual(lessonKeyterms(l).sort(), ["DataFrames", "NumPy"]);
  });
});

describe("the professor's functions", () => {
  const make = (at = 1) => {
    const did: string[] = [];
    let i = at;
    const ui: ProfessorUi = {
      lesson: () => lesson,
      index: () => i,
      goTo: (n) => {
        i = n;
        did.push(`board ${n + 1}`);
      },
      openExample: () => {
        did.push("example");
        return "an empty code scratchpad";
      },
      saveNote: (t) => did.push(`note: ${t}`),
      draw: (what, kind) => {
        did.push(`draw ${kind}: ${what}`);
        return !what.includes("busy");
      },
    };
    return { ui, did };
  };

  it("move the lesson, and say where it ends", () => {
    const { ui, did } = make(1);
    assert.equal(JSON.parse(runProfessorCall("next_board", {}, ui)).board, 3);
    assert.equal(JSON.parse(runProfessorCall("previous_board", {}, ui)).board, 2);
    assert.equal(JSON.parse(runProfessorCall("go_to_board", { board: "4" }, ui)).board, 4);
    assert.equal(JSON.parse(runProfessorCall("next_board", {}, ui)).ok, false, "the last board");
    assert.equal(JSON.parse(runProfessorCall("go_to_board", { board: 9 }, ui)).ok, false);
    assert.deepEqual(did, ["board 3", "board 2", "board 4"]);
  });

  it("read a board without moving, find the quiz and the explain-back, keep a note", () => {
    const { ui, did } = make(0);
    assert.match(JSON.parse(runProfessorCall("read_board", { board: 2 }, ui)).text, /A recipe written for a cook/);
    assert.deepEqual(did, []);
    assert.equal(JSON.parse(runProfessorCall("start_quiz", {}, ui)).board, 3);
    assert.equal(JSON.parse(runProfessorCall("explain_back", {}, ui)).board, 4);
    assert.equal(JSON.parse(runProfessorCall("save_note", { text: "  Rules break on new cases. " }, ui)).saved, "Rules break on new cases.");
    assert.equal(JSON.parse(runProfessorCall("open_example", {}, ui)).opened, "an empty code scratchpad");
    assert.equal(JSON.parse(runProfessorCall("save_note", { text: "" }, ui)).ok, false);
    assert.equal(JSON.parse(runProfessorCall("fly_away", {}, ui)).ok, false);
  });

  it("draws on the board: the analogy as a picture or a sequence diagram, or a UML diagram added; says when it is busy", () => {
    const { ui, did } = make(1);
    const seq = JSON.parse(runProfessorCall("draw_picture", { what: "the recipe card going to the baker", kind: "sequence" }, ui));
    assert.equal(seq.ok, true);
    assert.match(seq.drawing, /on the board, as a sequence diagram/);
    assert.match(JSON.parse(runProfessorCall("draw_picture", { what: "who owns what", kind: "class" }, ui)).drawing, /UML diagram added to the board/);
    runProfessorCall("draw_picture", { what: "the analogy", kind: "a cartoon" }, ui);
    assert.deepEqual(did, ["draw sequence: the recipe card going to the baker", "draw class: who owns what", "draw scene: the analogy"]);
    assert.equal(JSON.parse(runProfessorCall("draw_picture", { what: "busy one" }, ui)).ok, false);
    assert.equal(JSON.parse(runProfessorCall("draw_picture", { what: " " }, ui)).ok, false);
  });

  it("asks for a board's UML diagram in Mermaid, under the lesson's rules", () => {
    const p = boardDiagramPrompt(lesson, 1, "who holds the recipe", "state", "RULES HERE");
    assert.match(p, /UML state diagram on board 2: who holds the recipe/);
    assert.match(p, /stateDiagram-v2/);
    assert.match(p, /RULES HERE/);
  });
});
