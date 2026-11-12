// The professor's conversation and what sits beside it (docs/LEARNING.md):
// what is sent for an answer (chat.ts), how an answer is read (md.ts,
// highlight.ts), hints before answers, recall cards (recall.ts), the notebook
// (notebook.ts), and marking an exercise from its own tests (exercise.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACTIONS, CHAT_RULES, chatTurns, fromHands, HINTS, hintsUsed, lastLine, shownText, solutionOpen, speakable, splitWonder, starters, type ChatMsg } from "../src/learn/lib/chat";
import { testsIn, testVerdict } from "../src/learn/lib/exercise";
import { highlight } from "../src/learn/lib/highlight";
import { emphasis, parseMd } from "../src/learn/lib/md";
import { addNote, ago, removeNote, searchNotes, type Note } from "../src/learn/lib/notebook";
import { checkPrompt, cleanBoards, lessonPrompt } from "../src/learn/lib/professor";
import { cardsFor, DAY, deckStats, dueCards, dueIn, INTERVALS, mergeCards, review, type Card } from "../src/learn/lib/recall";
import { DEFAULT_PROFILE, type Board, type Lesson } from "../src/learn/lib/types";
import { planRun, rustEdition, type Toolchain } from "../src/lib/localrun/toolchains";

const talk = (title: string, analogy?: string): Board => ({ title, kind: "talk", lines: [{ w: `**${title}** on the board`, s: "said aloud" }], ...(analogy ? { analogy } : {}) });
const exercise: Board = { title: "Exercise 1: fix the move", kind: "code", lines: [{ w: "Your turn", s: "Your turn" }], task: "Make it compile without `.clone()`.", starter: "fn main() {}", language: "rust", exercise: "ex01_fix_move.rs", solution: "fn print_greeting(name: &str) {}" };
const quiz: Board = { title: "Quiz", kind: "quiz", lines: [{ w: "Check", s: "Check" }], quiz: [{ q: "What does `let s2 = s1;` do to a **String**?", options: ["Copies the text", "Moves it"], answer: 1, why: "Only the ticket changes hands." }] };
const lesson = (over: Partial<Lesson> = {}): Lesson => ({
  id: "L1",
  course: "Mastering Rust",
  number: 6,
  title: "Ownership",
  subject: "Ownership",
  summary: "You can say who owns a value.",
  boards: [talk("Why ownership exists", "A playroom where every toy has one owner."), talk("Move"), talk("Borrowing"), exercise, quiz],
  createdAt: 0,
  updatedAt: 0,
  at: 1,
  seen: [0, 1],
  ...over,
});
let n = 0;
const you = (text: string, board = 1, more: Partial<ChatMsg> = {}): ChatMsg => ({ id: `m${++n}`, role: "you", text, at: n, board, ...more });
const prof = (text: string, board = 1, more: Partial<ChatMsg> = {}): ChatMsg => ({ id: `m${++n}`, role: "prof", text, at: n, board, ...more });

describe("the conversation: what is sent for an answer", () => {
  it("opens with the lesson so far and the rules, and says which board is on screen", () => {
    const turns = chatTurns(lesson(), DEFAULT_PROFILE, [you("Why can't I use s1 after the move?")], { board: 1 });
    assert.equal(turns.length, 1);
    assert.equal(turns[0].role, "user");
    assert.match(turns[0].content, /You are the Professor/);
    assert.match(turns[0].content, /You are teaching "Ownership" \(course: Mastering Rust\)/);
    assert.match(turns[0].content, /1\. "Why ownership exists": Why ownership exists on the board \(Analogy given: A playroom/);
    assert.match(turns[0].content, /2\. "Move"/);
    assert.doesNotMatch(turns[0].content, /3\. "Borrowing"/, "boards not reached yet are not given away");
    assert.ok(turns[0].content.includes(CHAT_RULES));
    assert.match(turns[0].content, /\(I am looking at board 2, "Move"\.\) Why can't I use s1 after the move\?$/);
  });

  it("keeps the conversation in order, roles alternating, starting with the student", () => {
    const msgs = [prof("An old answer with no question"), you("First?"), prof("One."), you("Second?"), prof("", 1, { err: "The AI could not answer." }), you("Second, again?")];
    const turns = chatTurns(lesson(), DEFAULT_PROFILE, msgs, { board: 1 });
    assert.deepEqual(turns.map((t) => t.role), ["user", "assistant", "user"]);
    assert.match(turns[0].content, /First\?$/);
    assert.equal(turns[1].content, "One.");
    assert.match(turns[2].content, /Second\?\n\nSecond, again\?$/, "a question left unanswered joins the next one");
  });

  it("sends only the recent conversation, and nothing when there is no question", () => {
    const long = Array.from({ length: 30 }, (_, i) => [you(`q${i}`), prof(`a${i}`)]).flat();
    const turns = chatTurns(lesson(), DEFAULT_PROFILE, [...long, you("last")], { board: 0 });
    assert.ok(turns.length <= 16);
    assert.equal(turns.at(-1)!.role, "user");
    assert.doesNotMatch(turns.map((t) => t.content).join("\n"), /\bq3\b/);
    assert.deepEqual(chatTurns(lesson(), DEFAULT_PROFILE, [], { board: 0 }), []);
    assert.deepEqual(chatTurns(lesson(), DEFAULT_PROFILE, [you("q"), prof("a")], { board: 0 }), []);
  });

  it("on an exercise, shows the professor the student's code and output, and the solution for its eyes only", () => {
    const turns = chatTurns(lesson({ seen: [0, 1, 2, 3] }), DEFAULT_PROFILE, [you("Where do I start?", 3)], { board: 3, code: "fn main() { let x = 1; }", output: "error[E0382]: borrow of moved value" });
    const last = turns.at(-1)!.content;
    assert.match(last, /The board on screen is an exercise \(ex01_fix_move\.rs\)\. The task: Make it compile without \.clone\(\)\./);
    assert.match(last, /The student's code right now:\n```rust\nfn main\(\) \{ let x = 1; \}/);
    assert.match(last, /error\[E0382\]/);
    assert.match(last, /for your eyes only\. Use it to judge their work and to choose hints; never show it/);
    assert.match(last, /name: &str/);
    // Away from the exercise, the solution is not sent at all.
    assert.doesNotMatch(chatTurns(lesson(), DEFAULT_PROFILE, [you("And moves?")], { board: 1 }).at(-1)!.content, /&str/);
  });

  it("tells the professor the rules of the room: analogy, hints first, and questions to wonder about", () => {
    assert.match(CHAT_RULES, /💡/);
    assert.match(CHAT_RULES, /hints come before answers/);
    assert.match(CHAT_RULES, /\?\?\?/);
  });
});

describe("the conversation: reading an answer", () => {
  it("splits the closing questions off the answer", () => {
    const r = splitWonder("Because `s1` gave its ticket away.\n\n💡 Your friend holds the ticket now.\n\n???\nWhat if I need two copies?\n- Does an integer move too?\n");
    assert.equal(r.body, "Because `s1` gave its ticket away.\n\n💡 Your friend holds the ticket now.");
    assert.deepEqual(r.wonder, ["What if I need two copies?", "Does an integer move too?"]);
  });

  it("leaves an answer without them alone, and a question mark inside it too", () => {
    assert.deepEqual(splitWonder("Is it moved? Yes."), { body: "Is it moved? Yes.", wonder: [] });
    assert.deepEqual(splitWonder("What??? No, really."), { body: "What??? No, really.", wonder: [] });
  });

  it("holds back a closing block that is still arriving", () => {
    assert.equal(splitWonder("The answer.\n\n?").body, "The answer.");
    assert.equal(splitWonder("The answer.\n\n??").body, "The answer.");
    assert.deepEqual(splitWonder("The answer.\n\n???"), { body: "The answer.", wonder: [] });
    assert.deepEqual(splitWonder("The answer.\n\n???\nWhat if").wonder, ["What if"]);
  });

  it("keeps at most three questions, and drops a line too long to be one", () => {
    const r = splitWonder(`A.\n???\n1. One?\n2) Two?\n• Three?\nFour?\n${"x".repeat(200)}`);
    assert.deepEqual(r.wonder, ["One?", "Two?", "Three?"]);
  });

  it("makes an answer speakable: no code, no markup, no closing questions", () => {
    const said = speakable("A **move** hands over the *ticket*.\n\n💡 Like a cloakroom.\n\n```rust\nlet s2 = s1;\n```\n\n- then `s1` is empty\n\n???\nWhy?");
    assert.equal(said, "A move hands over the ticket. Like a cloakroom. (the code is on screen.) then s1 is empty");
  });

  it("reads light Markdown into blocks", () => {
    const blocks = parseMd("First line\nsecond line\n\n## A heading\n\n💡 **Analogy:** a coat ticket\nthat changes hands\n\n> a quote\n> goes on\n\n1. one\n2. two\n   wrapped\n\n- a\n- b\n\n```rust\nfn main() {\n\n    // > 💡 not a callout\n}\n```\ntail");
    assert.deepEqual(blocks, [
      { t: "p", text: "First line\nsecond line" },
      { t: "p", text: "**A heading**" },
      { t: "callout", text: "a coat ticket that changes hands" },
      { t: "quote", text: "a quote goes on" },
      { t: "list", ordered: true, items: ["one", "two wrapped"] },
      { t: "list", ordered: false, items: ["a", "b"] },
      { t: "code", lang: "rust", code: "fn main() {\n\n    // > 💡 not a callout\n}", open: false },
      { t: "p", text: "tail" },
    ]);
  });

  it("draws a code block that is still arriving as far as it has come", () => {
    assert.deepEqual(parseMd("Look:\n```rust\nlet s2 ="), [{ t: "p", text: "Look:" }, { t: "code", lang: "rust", code: "let s2 =", open: true }]);
    assert.deepEqual(parseMd("```\nplain\n```"), [{ t: "code", lang: "", code: "plain", open: false }]);
  });

  it("marks *emphasis* but never inside code", () => {
    assert.deepEqual(emphasis("a *big* idea"), [{ text: "a ", em: false }, { text: "big", em: true }, { text: " idea", em: false }]);
    assert.deepEqual(emphasis("**bold** stays for the chalk"), [{ text: "**bold** stays for the chalk", em: false }]);
    assert.deepEqual(emphasis("write `*ptr = *other` here"), [{ text: "write `*ptr = *other` here", em: false }]);
    assert.deepEqual(emphasis("2 * 3 * 4"), [{ text: "2 * 3 * 4", em: false }]);
  });

  it("colours code with the editor's grammars, line by line, and leaves unknown languages plain", () => {
    const lines = highlight('let s = String::from("hi"); // owner\nprintln!("{s}");', "rust");
    assert.equal(lines.length, 2);
    assert.equal(lines.map((l) => l.map((s) => s.text).join("")).join("\n"), 'let s = String::from("hi"); // owner\nprintln!("{s}");');
    const cls = (text: string) => lines.flat().find((s) => s.text === text)?.cls ?? "";
    assert.match(cls("let"), /tok-keyword/);
    assert.match(cls('"hi"'), /tok-string/);
    assert.match(cls("// owner"), /tok-comment/);
    assert.deepEqual(highlight("a\nb", "brainfuck"), [[{ text: "a", cls: "" }], [{ text: "b", cls: "" }]]);
    assert.match(highlight("def f():\n    return 1", "py")[0][0].cls, /tok-keyword/);
  });
});

describe("the conversation: hints before answers", () => {
  it("offers Hint only where there is something to solve", () => {
    assert.deepEqual(ACTIONS.filter((a) => a.exercise).map((a) => a.id), ["hint"]);
    assert.ok(ACTIONS.some((a) => a.id === "ten" && /analogy/.test(a.ask(0))));
  });

  it("climbs the ladder: a nudge, a pointer, a near-answer, and no further", () => {
    const hint = ACTIONS.find((a) => a.id === "hint")!;
    assert.match(hint.ask(0), /first hint: only a nudge/);
    assert.match(hint.ask(1), /second hint: point at the exact line/);
    assert.match(hint.ask(2), /third hint/);
    assert.equal(hint.ask(7), hint.ask(HINTS - 1));
    assert.doesNotMatch(hint.ask(0) + hint.ask(1), /solution|full answer/i);
  });

  it("counts hints per board", () => {
    const hint = ACTIONS.find((a) => a.id === "hint")!;
    const msgs = [you(hint.ask(0), 3, { action: "hint" }), prof("Think about who needs to own it.", 3), you(hint.ask(1), 3, { action: "hint" }), you(hint.ask(0), 4, { action: "hint" }), you("a typed question", 3)];
    assert.equal(hintsUsed(msgs, 3), 2);
    assert.equal(hintsUsed(msgs, 4), 1);
    assert.equal(hintsUsed(msgs, 0), 0);
  });

  it("opens the solution after three hints, or after a real attempt", () => {
    const hint = ACTIONS.find((a) => a.id === "hint")!;
    const two = [0, 1].map((i) => you(hint.ask(i), 3, { action: "hint" }));
    assert.equal(solutionOpen([], 3, false), false);
    assert.equal(solutionOpen(two, 3, false), false);
    assert.equal(solutionOpen([...two, you(hint.ask(2), 3, { action: "hint" })], 3, false), true);
    assert.equal(solutionOpen([], 3, true), true, "work that was checked or tested is an attempt");
  });

  it("shows a quick action by its name, not its full wording", () => {
    const hint = ACTIONS.find((a) => a.id === "hint")!;
    assert.equal(shownText(you(hint.ask(1), 3, { action: "hint" })), "A second hint, please.");
    assert.equal(shownText(you(ACTIONS[0].ask(0), 0, { action: "ten" })), "💡 Like I'm 10");
    assert.equal(shownText(you("typed by hand")), "typed by hand");
  });

  it("gives the marking prompt the course's solution, to judge against and never to show", () => {
    const p = checkPrompt({ lesson: lesson(), board: exercise, code: "fn main() {}", output: "", language: "rust" }, DEFAULT_PROFILE);
    assert.match(p, /The course's own solution, for your eyes only \(judge against it; never show it/);
    assert.match(p, /name: &str/);
    assert.doesNotMatch(checkPrompt({ board: { ...exercise, solution: undefined }, code: "x", output: "" }, DEFAULT_PROFILE), /own solution/);
  });
});

describe("the conversation: kept with the lesson", () => {
  it("turns an old lesson's raised hands into a conversation", () => {
    const msgs = fromHands([{ q: "Why squares?", a: "So big misses count more.", board: 2, at: 50 }]);
    assert.deepEqual(msgs.map((m) => [m.role, m.text, m.board, m.at]), [["you", "Why squares?", 2, 50], ["prof", "So big misses count more.", 2, 50]]);
    assert.deepEqual(fromHands(undefined), []);
  });

  it("says where the conversation stopped, for the carry-on card", () => {
    assert.equal(lastLine(null), "");
    assert.equal(lastLine({ lessonId: "L1", msgs: [], updatedAt: 0 }), "");
    assert.equal(lastLine({ lessonId: "L1", msgs: [you("Why?"), prof("Because **s1** moved.\n\n???\nAnd then?")], updatedAt: 0 }), "The professor said: Because s1 moved.");
    assert.equal(lastLine({ lessonId: "L1", msgs: [you("Why can I not use it?"), prof("", 1, { err: "x" })], updatedAt: 0 }), "You asked: Why can I not use it?");
    assert.match(lastLine({ lessonId: "L1", msgs: [prof("word ".repeat(60))], updatedAt: 0 }), /…$/);
  });

  it("offers questions that fit the board on screen", () => {
    assert.match(starters(talk("Move"), 1)[0], /“Move”/);
    assert.ok(starters(talk("Hello"), 0).every((q) => !/board before/.test(q)), "the first board has none before it");
    assert.match(starters(exercise, 3)[0], /exercise/);
    assert.equal(starters(quiz, 4).length, 3);
  });
});

describe("lessons carry an analogy and recall cards", () => {
  it("asks for an analogy on every talk board and for cards", () => {
    const p = lessonPrompt({ topic: "Ownership", course: "Rust", level: "Beginner", boards: 10, notes: "" }, DEFAULT_PROFILE, []);
    assert.match(p, /Every talk board carries an "analogy"/);
    assert.match(p, /"cards": \[\{"q"/);
    assert.match(p, /"kind": "talk", "analogy"/);
  });

  it("keeps a talk board's analogy and the cards, and no analogy on other boards", () => {
    const out = cleanBoards({
      title: "Ownership",
      summary: "s",
      cards: [{ q: "Who frees a value?", a: "Its owner, at the end of its scope." }],
      boards: [
        { title: "Move", kind: "talk", analogy: "  A cloakroom ticket changes hands.  ", example: "move_semantics.rs", lines: [{ w: "x", s: "x" }] },
        { title: "Plain", kind: "talk", lines: [{ w: "y", s: "y" }] },
        { title: "Quiz", kind: "quiz", analogy: "ignored", lines: [], quiz: [{ q: "q", options: ["a", "b"], answer: 0, why: "w" }] },
      ],
    })!;
    assert.equal(out.boards[0].analogy, "A cloakroom ticket changes hands.");
    assert.equal(out.boards[0].exampleName, "move_semantics.rs");
    assert.ok(!("analogy" in out.boards[1]));
    assert.ok(!("analogy" in out.boards[2]));
    assert.deepEqual(out.cards, [{ q: "Who frees a value?", a: "Its owner, at the end of its scope." }]);
  });
});

describe("recall cards", () => {
  const card = (over: Partial<Card> = {}): Card => ({ id: "L1-0", lessonId: "L1", course: "Rust", q: "q", a: "a", box: 0, due: 1000, seen: 0, right: 0, ...over });

  it("come back later each time they are known: 1, 3, 7, 16, 35 days", () => {
    assert.deepEqual(INTERVALS, [0, 1, 3, 7, 16, 35]);
    let c = card();
    const gaps: number[] = [];
    for (let i = 0; i < 7; i++) {
      c = review(c, true, 0);
      gaps.push(c.due / DAY);
    }
    assert.deepEqual(gaps, [1, 3, 7, 16, 35, 35, 35], "the last box is the longest wait");
    assert.equal(c.seen, 7);
    assert.equal(c.right, 7);
  });

  it("start again tomorrow when missed, however well they were known", () => {
    const c = review(card({ box: 4, seen: 4, right: 4 }), false, 5 * DAY);
    assert.deepEqual([c.box, c.due, c.seen, c.right], [1, 6 * DAY, 5, 4]);
  });

  it("are asked when due, the longest overdue first, for one lesson or all", () => {
    const deck = [card({ id: "a", due: 50 }), card({ id: "b", due: 10 }), card({ id: "c", due: 200 }), card({ id: "d", due: 20, lessonId: "L2" })];
    assert.deepEqual(dueCards(deck, 100).map((c) => c.id), ["b", "d", "a"]);
    assert.deepEqual(dueCards(deck, 100, "L1").map((c) => c.id), ["b", "a"]);
    assert.deepEqual(deckStats([...deck, card({ id: "e", box: 5, due: 999 })], 100), { total: 5, due: 3, learnt: 1 });
  });

  it("say when a card comes back", () => {
    assert.equal(dueIn(0, 100), "now");
    assert.equal(dueIn(100 + DAY, 100), "tomorrow");
    assert.equal(dueIn(100 + 3 * DAY, 100), "in 3 days");
  });

  it("are made from what the professor wrote, else from the lesson's quiz", () => {
    const written = cardsFor(lesson(), [{ q: " Who owns a value? ", a: "Exactly one owner." }, { q: "", a: "dropped" }, "junk"], 77);
    assert.deepEqual(written, [{ id: "L1-0", lessonId: "L1", course: "Mastering Rust", q: "Who owns a value?", a: "Exactly one owner.", box: 0, due: 77, seen: 0, right: 0 }]);
    const fromQuiz = cardsFor(lesson(), null, 77);
    assert.equal(fromQuiz.length, 1);
    assert.equal(fromQuiz[0].q, "What does let s2 = s1; do to a String?");
    assert.equal(fromQuiz[0].a, "Moves it. Only the ticket changes hands.");
    assert.deepEqual(cardsFor(lesson({ boards: [talk("only talk"), talk("more")] }), undefined, 1), []);
  });

  it("join the deck once, keeping the progress of cards already there", () => {
    const deck = [card({ id: "L1-0", box: 3 })];
    const merged = mergeCards(deck, [card({ id: "L1-0" }), card({ id: "L1-1" })]);
    assert.deepEqual(merged.map((c) => [c.id, c.box]), [["L1-0", 3], ["L1-1", 0]]);
  });
});

describe("the notebook", () => {
  const note = (text: string, over: Partial<Note> = {}): Note => ({ id: `n${++n}`, text, at: 0, from: "you", ...over });

  it("keeps notes newest first, and nothing for an empty thought", () => {
    let notes: Note[] = [];
    notes = addNote(notes, note("first"));
    notes = addNote(notes, note("  second  "));
    assert.deepEqual(notes.map((x) => x.text), ["second", "first"]);
    assert.equal(addNote(notes, note("   ")), notes);
  });

  it("saves the same answer once per lesson", () => {
    const a = note("A move hands over the ticket.", { from: "prof", lessonId: "L1" });
    const notes = addNote([], a);
    assert.equal(addNote(notes, { ...a, id: "again" }), notes);
    assert.equal(addNote(notes, { ...a, id: "other", lessonId: "L2" }).length, 2);
    assert.equal(addNote(notes, note("A move hands over the ticket.")).length, 2, "the student's own words are never refused");
  });

  it("removes a note, and finds notes by every word typed, in any course", () => {
    const notes = [note("Slices borrow part of a string", { id: "a", course: "Rust", lessonTitle: "Ownership" }), note("Gradient descent walks downhill", { id: "b", course: "Machine learning" })];
    assert.deepEqual(removeNote(notes, "a").map((x) => x.id), ["b"]);
    assert.deepEqual(searchNotes(notes, "borrow STRING").map((x) => x.id), ["a"]);
    assert.deepEqual(searchNotes(notes, "ownership").map((x) => x.id), ["a"], "the lesson's title counts");
    assert.deepEqual(searchNotes(notes, "machine walks").map((x) => x.id), ["b"]);
    assert.equal(searchNotes(notes, "  ").length, 2);
    assert.equal(searchNotes(notes, "quantum").length, 0);
  });

  it("says how long ago in plain words", () => {
    const now = 10 * DAY;
    assert.equal(ago(now - 5_000, now), "just now");
    assert.equal(ago(now - 5 * 60_000, now), "5 min ago");
    assert.equal(ago(now - 3 * 3_600_000, now), "3 h ago");
    assert.equal(ago(now - 30 * 3_600_000, now), "yesterday");
    assert.equal(ago(now - 4 * DAY, now), "4 days ago");
  });
});

describe("marking an exercise from its own tests", () => {
  it("passes when every test is green", () => {
    const v = testVerdict("running 5 tests\ntest tests::single_word ... ok\n\ntest result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n")!;
    assert.equal(v.passed, true);
    assert.match(v.feedback, /All 5 tests pass/);
    assert.match(testVerdict("test result: ok. 1 passed; 0 failed;")!.feedback, /^The test passes/);
  });

  it("names the tests that still fail", () => {
    const v = testVerdict("test tests::single_word ... ok\ntest tests::leading_whitespace ... FAILED\ntest tests::empty_and_blank ... FAILED\n\ntest result: FAILED. 3 passed; 2 failed; 0 ignored\n")!;
    assert.equal(v.passed, false);
    assert.match(v.feedback, /3 tests pass, 2 still fail: leading_whitespace, empty_and_blank\./);
  });

  it("says what the compiler said when it does not build", () => {
    const v = testVerdict("error[E0382]: borrow of moved value: `name`\n  --> main.rs:15:16\n")!;
    assert.equal(v.passed, false);
    assert.match(v.feedback, /It does not compile yet \(E0382\): borrow of moved value: `name`\./);
    assert.match(testVerdict("error: expected one of `!` or `::`, found `main`\n")!.feedback, /It does not compile yet: expected one of/);
  });

  it("wants every one of the exercise's tests, so deleting the hard ones is not a pass", () => {
    const starter = "#[cfg(test)]\nmod tests {\n    #[test]\n    fn a() {}\n\n    #[test]\n    fn b() {}\n    // #[test] in a comment does not count\n}\n";
    assert.equal(testsIn(starter), 2);
    assert.equal(testsIn("fn main() {}"), 0);
    const v = testVerdict("test result: ok. 1 passed; 0 failed;", 2)!;
    assert.equal(v.passed, false);
    assert.match(v.feedback, /Only 1 of the exercise's 2 tests ran/);
    assert.equal(testVerdict("test result: ok. 2 passed; 0 failed;", 2)!.passed, true);
    assert.equal(testVerdict("test result: ok. 3 passed; 0 failed;", 2)!.passed, true, "adding tests of your own is welcome");
  });

  it("points at a todo!() when that is why the tests fail", () => {
    const v = testVerdict("thread 'tests::a' panicked at main.rs:12:5:\nnot yet implemented: return the first word\ntest tests::a ... FAILED\n\ntest result: FAILED. 0 passed; 5 failed; 0 ignored\n")!;
    assert.equal(v.passed, false);
    assert.match(v.feedback, /0 tests pass, 5 still fail\. A todo!\(\) is still waiting/);
  });

  it("spots a todo!() left in place, an empty test file, and output that is no test run", () => {
    assert.match(testVerdict("thread 'tests::single_word' panicked at main.rs:12:5:\nnot yet implemented: return the first word")!.feedback, /todo!\(\)/);
    assert.equal(testVerdict("test result: ok. 0 passed; 0 failed;")!.passed, false);
    assert.equal(testVerdict("Hello, Ferris!\n"), null);
    assert.equal(testVerdict(""), null);
  });
});

describe("running an exercise's tests on this computer", () => {
  const rustc = (version: string | null): Toolchain => ({ lang: "rust", label: "Rust", cmd: "rustc", path: "/bin/rustc", version, install: "" });

  it("uses the newest edition the compiler knows", () => {
    assert.equal(rustEdition("rustc 1.99.1 (58cf8f9c3 2026-10-13)"), "2024");
    assert.equal(rustEdition("1.85.0"), "2024");
    assert.equal(rustEdition("rustc 1.84.1"), "2021");
    assert.equal(rustEdition(null), "2021");
    assert.equal(rustEdition("2.0.0"), "2024");
  });

  it("compiles the file with its tests and runs those instead of main", () => {
    const test = planRun(rustc("rustc 1.90.0"), "/w/ex04.rs", { exe: "/tmp/main", test: true })!;
    assert.deepEqual(test.steps, [{ file: "/bin/rustc", args: ["--edition", "2024", "--test", "-o", "/tmp/main", "/w/ex04.rs"] }, { file: "/tmp/main", args: [] }]);
    assert.equal(test.shown, "rustc --edition 2024 --test -o /tmp/main /w/ex04.rs && /tmp/main");
    const run = planRun(rustc(null), "/w/ex01.rs", { exe: "/tmp/main" })!;
    assert.deepEqual(run.steps[0].args, ["--edition", "2021", "-o", "/tmp/main", "/w/ex01.rs"]);
    assert.equal(run.shown, "rustc --edition 2021 -o /tmp/main /w/ex01.rs && /tmp/main");
  });

  it("finds cargo's rustc for a file outside a crate, tests included", () => {
    const cargo: Toolchain = { lang: "rust", label: "Rust", cmd: "cargo", path: "/home/u/.cargo/bin/cargo", version: "cargo 1.90.0", install: "" };
    assert.deepEqual(planRun(cargo, "/w/ex04.rs", { exe: "/tmp/main", test: true })!.steps[0], { file: "/home/u/.cargo/bin/rustc", args: ["--edition", "2024", "--test", "-o", "/tmp/main", "/w/ex04.rs"] });
  });
});
