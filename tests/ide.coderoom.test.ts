// "Run this code" for the voice lecturer (src/ide/codeRoom.ts): the IDE in use
// runs, in its sandbox, with a time limit and a cut-short answer; run_code
// goes through it (src/lib/voice/lecturer/tools.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OutPart } from "../src/ide/python";
import { OUTPUT_LIMIT, createCodeRoom, runAnswer, summarise, type RunnableIde } from "../src/ide/codeRoom";
import { runLecturerTool, type LecturerUi } from "../src/lib/voice/lecturer/tools";

function fakeIde(o: { parts?: OutPart[]; blocked?: string | null; hang?: boolean; language?: string; label?: string } = {}) {
  const calls = { run: 0, stop: 0 };
  const ide: RunnableIde = {
    language: o.language ?? "python",
    label: o.label ?? "fares.py",
    blocked: () => o.blocked ?? null,
    run: () => {
      calls.run++;
      return o.hang ? new Promise(() => {}) : Promise.resolve(o.parts ?? []);
    },
    stop: () => void calls.stop++,
  };
  return { ide, calls };
}

describe("codeRoom.run", () => {
  it("says so when no code is open", async () => {
    const r = await createCodeRoom().run();
    assert.equal(r.ok, false);
    assert.match(r.error, /No code is open/);
  });
  it("runs the IDE used last, and gives its output", async () => {
    const room = createCodeRoom();
    const a = fakeIde({ parts: [{ kind: "out", text: "a\n" }], label: "a.py" });
    const b = fakeIde({ parts: [{ kind: "out", text: "average 18\n" }], label: "b.py" });
    room.register("a", a.ide);
    room.register("b", b.ide);
    room.use("a");
    const r = await room.run();
    assert.deepEqual(r, { ok: true, output: "a", error: "", language: "python", label: "a.py" });
    assert.equal(b.calls.run, 0);
  });
  it("falls back to the one before when the IDE in use closes", async () => {
    const room = createCodeRoom();
    room.register("a", fakeIde({ label: "a.py" }).ide);
    const off = room.register("b", fakeIde({ label: "b.py" }).ide);
    off();
    assert.equal(room.current()?.label, "a.py");
  });
  it("reports an error the code raised, apart from what it printed", async () => {
    const room = createCodeRoom();
    room.register("a", fakeIde({ parts: [{ kind: "out", text: "start\n" }, { kind: "error", text: "NameError: x" }] }).ide);
    const r = await room.run();
    assert.equal(r.ok, false);
    assert.equal(r.output, "start");
    assert.equal(r.error, "NameError: x");
  });
  it("does not run where it is not allowed, and says why", async () => {
    const room = createCodeRoom();
    const f = fakeIde({ blocked: "Rust runs on the laptop, which run_code never uses." });
    room.register("a", f.ide);
    const r = await room.run();
    assert.equal(r.ok, false);
    assert.match(r.error, /laptop/);
    assert.equal(f.calls.run, 0);
  });
  it("stops a run that takes too long", async () => {
    const room = createCodeRoom({ timeoutMs: 20 });
    const f = fakeIde({ hang: true });
    room.register("a", f.ide);
    const r = await room.run();
    assert.equal(r.ok, false);
    assert.match(r.error, /took too long/);
    assert.equal(f.calls.stop, 1);
  });
  it("never throws, even when the IDE does", async () => {
    const room = createCodeRoom();
    room.register("a", { ...fakeIde().ide, run: () => Promise.reject(new Error("worker died")) });
    assert.deepEqual(await room.run(), { ok: false, output: "", error: "worker died", language: "python", label: "fares.py" });
  });
});

describe("the run's summary", () => {
  it("cuts long output short and says how much was cut", () => {
    const s = summarise([{ kind: "out", text: "x".repeat(OUTPUT_LIMIT + 500) }]);
    assert.ok(s.output.length < OUTPUT_LIMIT + 60);
    assert.match(s.output, /500 more characters cut/);
  });
  it("turns tables, plots and values into short text", () => {
    const s = summarise([
      { kind: "table", columns: ["n", "name"], rows: [["1", "a"], ["2", "b"]] },
      { kind: "image", data: "…" },
      { kind: "value", text: "42" },
    ]);
    assert.equal(s.output, "n | name\n1 | a\n2 | b\n[a plot was drawn]\n→ 42");
  });
  it("answers the lecturer in short JSON", () => {
    assert.deepEqual(JSON.parse(runAnswer({ ok: true, output: "", error: "", language: "sql", label: "q.sql" })), { ok: true, file: "q.sql", language: "sql", output: "(it printed nothing)" });
    assert.deepEqual(JSON.parse(runAnswer({ ok: false, output: "", error: "No code is open." })), { ok: false, error: "No code is open." });
  });
});

describe("the lecturer's run_code", () => {
  it("runs the code open now and returns the summary", async () => {
    const room = createCodeRoom();
    room.register("a", fakeIde({ parts: [{ kind: "out", text: "average 18.0\n" }] }).ide);
    const ui = { repo: () => ({ files: {} }), runCode: async () => runAnswer(await room.run()) } as unknown as LecturerUi;
    const out = JSON.parse(await runLecturerTool(ui, "run_code", {}, new AbortController().signal));
    assert.deepEqual(out, { ok: true, file: "fares.py", language: "python", output: "average 18.0" });
  });
});
