// A lesson from the student's own codebase, written in steps (src/learn/lib/codebaseLesson.ts). Asked for
// whole, the owner's kola v2 lesson came back cut off: the model spent 16,847 of its 20,000 output tokens
// thinking. Now a plan from the files' outline, then boards two at a time in parallel with only their own
// files, then the close; a step that leaves out its planned diagram, or is cut short, is asked once more.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Sample, SampleOptions } from "../src/learn/lib/claude";
import type { CodebaseDigest } from "../src/learn/lib/codebaseAsk";
import { BOARDS_OUTPUT, cleanPlan, codeBoardsPrompt, codePlanPrompt, filesFor, missingKinds, outlineOf, PLAN_OUTPUT, stepsOf, writeCodebaseLessonInSteps, type CodeLessonRequest } from "../src/learn/lib/codebaseLesson";
import { DEFAULT_PROFILE } from "../src/learn/lib/types";

const HOOK = `import { useMerchantCollect } from '@/api/merchant-collect'
export function usePaymentGateway() {
  const { initiatePayout } = useMerchantCollect()
  const handlePayout = async (payload: PayoutPayload) => {
    return initiatePayout.mutateAsync(payload)
  }
  return { handlePayout }
}`;
const TYPES = `export interface PayoutPayload {
  amount: number
  accountNumber: string
}
export type PaymentMethod = 'momo' | 'bank'`;
const API = `export const useMerchantCollect = () => ({
  initiatePayout: useMutation((p) => api.post('/merchant-collect/payout', p)),
})`;

const digest: CodebaseDigest = {
  name: "kola-merchant-portal-v2",
  path: "C:\\Users\\me\\myenvironment\\kola-merchant-portal-v2",
  files: 378,
  folders: ["src/components/Merchant-collect/collection-and-payout (6)", "src/types (13)"],
  picked: [
    { path: "package.json", content: '{ "name": "portal" }', from: 1, to: 1, lines: 1 },
    { path: "src/components/Merchant-collect/collection-and-payout/usePaymentGateway.ts", content: HOOK, from: 1, to: 8, lines: 8 },
    { path: "src/types/MerchantCollectDataTypes.ts", content: TYPES, from: 10, to: 14, lines: 300 },
    { path: "src/api/merchant-collect/index.ts", content: API, from: 1, to: 3, lines: 3 },
  ],
  terms: ["payment", "gateway"],
};
const req: CodeLessonRequest = {
  request: "use uml diagram to describe how payment gateway in fintech work especially in kola 'codebase in myenvironment … v2'",
  course: "Kola merchant portal v2",
  level: "Complete beginner",
  talks: 4,
  earlier: [],
  diagrams: { uml: true, kinds: ["sequence", "class"] },
};

const SEQ = "---\ntitle: A payout\n---\nsequenceDiagram\n  participant F as payout-form.tsx\n  participant H as usePaymentGateway\n  F->>H: handlePayout(payload)\n  H-->>F: response";
const CLS = "---\ntitle: The payout types\n---\nclassDiagram\n  class PayoutPayload {\n    amount: number\n  }";
const board = (title: string, diagram?: string) => ({ title, kind: "talk", analogy: "Posting a letter.", lines: [{ w: `\`usePaymentGateway.ts:2\` ${title}`, s: "Look." }, { w: "The flow", s: "Here.", ...(diagram ? { diagram } : {}) }] });
const PLAN = {
  title: "How a payout moves through the portal",
  picture: "Posting a letter at the post office.",
  boards: [
    { title: "The big picture", idea: "From the form to the server.", files: ["src/components/Merchant-collect/collection-and-payout/usePaymentGateway.ts"], diagram: null },
    { title: "The types", idea: "PayoutPayload holds amount and accountNumber.", files: ["src\\types\\MerchantCollectDataTypes.ts", "src/not/there.ts"], diagram: "class" },
    { title: "The call", idea: "handlePayout calls initiatePayout.", files: ["src/api/merchant-collect/index.ts"], diagram: null },
    { title: "Recap", idea: "The whole journey.", files: [], diagram: "flowchart" },
  ],
};
const END = { summary: "You can follow a payout.", quiz: [{ q: "Which hook?", options: ["usePaymentGateway", "useCart"], answer: 0, why: "It sends it." }], questions: ["What does handlePayout do?"], cards: [{ q: "Who posts it?", a: "usePaymentGateway." }] };

/** A provider that answers each step from the prompt it is sent, and records the calls. */
function fake(answer: (prompt: string, opts: SampleOptions, n: number) => unknown) {
  const calls: { prompt: string; opts: SampleOptions }[] = [];
  let open = 0;
  let most = 0;
  const json = async <T,>(prompt: string, opts: SampleOptions = {}): Promise<T> => {
    calls.push({ prompt, opts });
    const n = calls.length;
    open++;
    most = Math.max(most, open);
    await new Promise((r) => setTimeout(r, 5));
    open--;
    const a = answer(prompt, opts, n);
    if (a instanceof Error) throw { code: a.message };
    return a as T;
  };
  const sample = Object.assign(async () => ({ text: "", truncated: false }), { json }) as unknown as Sample;
  return { sample, calls, most: () => most };
}

const steps = (p: string) => /Write boards ([\d ]+(?:and \d+)?) only/.exec(p)?.[1] ?? "";
function honest(prompt: string): unknown {
  if (prompt.includes("Plan a lesson of exactly")) return PLAN;
  if (prompt.includes("Write its close")) return END;
  const at = steps(prompt);
  if (at === "1 and 2") return { boards: [board("The big picture"), board("The types", CLS)] };
  if (at === "3 and 4") return { boards: [board("The call", SEQ), board("Recap", "flowchart LR\n  A[usePaymentGateway] --> B[initiatePayout]")] };
  return { boards: [] };
}

describe("a codebase lesson's plan", () => {
  it("outlines a file by its declarations and calls, with line numbers, not its code", () => {
    const o = outlineOf(digest.picked[1]);
    assert.match(o, /^--- src\/components\/Merchant-collect\/collection-and-payout\/usePaymentGateway\.ts \(8 lines\)/);
    assert.match(o, /2\| export function usePaymentGateway\(\) \{/);
    assert.match(o, /4\| const handlePayout = async/);
    assert.match(o, /5\| return initiatePayout\.mutateAsync\(payload\)/);
    assert.doesNotMatch(o, /return \{ handlePayout \}/);
    assert.match(outlineOf(digest.picked[2]), /10\| export interface PayoutPayload/);
    assert.match(outlineOf(digest.picked[3]), /api\.post\('\/merchant-collect\/payout'/);
  });

  it("asks for the boards, their files and the diagrams the student asked for, from the outline alone", () => {
    const p = codePlanPrompt(digest, req, DEFAULT_PROFILE);
    assert.match(p, /Plan a lesson of exactly 4 chalkboard "talk" boards/);
    assert.match(p, /each of sequence and class at least once/);
    assert.match(p, /at least 2 boards carry one/);
    assert.ok(!p.includes("return { handlePayout }"), "the plan gets the outline, not the code");
    assert.ok(p.length < 8_000, `${p.length} characters`);
  });

  it("picks its one picture from fresh worlds, and not one the course already used (as every lesson does)", () => {
    const fresh = codePlanPrompt(digest, req, DEFAULT_PROFILE);
    assert.match(fresh, /Choose the lesson's big picture from one of these worlds/);
    assert.match(fresh, /never baking or a shop/);
    const before = { id: "l1", analogy: "", boards: [{ kind: "talk", title: "Hello", lines: [], analogy: "Emily bakes a cake in a little bakery." }], scene: undefined } as unknown as CodeLessonRequest["earlier"][number];
    const again = codePlanPrompt(digest, { ...req, earlier: [before] }, DEFAULT_PROFILE);
    assert.match(again, /not these again/);
    assert.match(again, /Emily/);
  });

  it("keeps only real files, the right number of boards, and gives every asked-for kind a board", () => {
    const plan = cleanPlan({ ...PLAN, boards: [...PLAN.boards, { title: "Too many", idea: "", files: [], diagram: null }] }, digest, 4, req.diagrams);
    assert.ok(plan);
    assert.equal(plan.boards.length, 4);
    assert.deepEqual(plan.boards[1].files, ["src/types/MerchantCollectDataTypes.ts"], "backslashes read, unknown files dropped");
    assert.equal(plan.boards[1].diagram, "class");
    assert.equal(plan.boards[2].diagram, "sequence", "the sequence the plan forgot goes on the first free board after the opening");
    assert.equal(plan.boards[0].diagram, null);
    assert.equal(cleanPlan({ boards: [{ title: "only one" }] }, digest, 4, null), null);
  });

  it("splits the talk boards into steps of two, and gives each step only its own files", () => {
    assert.deepEqual(stepsOf(8), [[0, 1], [2, 3], [4, 5], [6, 7]]);
    assert.deepEqual(stepsOf(5), [[0, 1], [2, 3], [4]]);
    const plan = cleanPlan(PLAN, digest, 4, req.diagrams)!;
    const p = codeBoardsPrompt(digest, plan, [0, 1], req, DEFAULT_PROFILE);
    assert.match(p, /Write boards 1 and 2 only/);
    assert.match(p, /=== src\/types\/MerchantCollectDataTypes\.ts \(lines 10-14 of 300\) ===\n10\| export interface PayoutPayload/);
    assert.ok(!p.includes("api.post('/merchant-collect/payout'"), "board 3's file is not in this step");
    assert.match(p, /classDiagram: the real types/);
    assert.match(p, /Never invent code, names or behaviour these files do not show/);
    assert.match(p, /Follow UML's notation/);
    assert.equal(filesFor(digest, []).map((f) => f.path).join(), "src/components/Merchant-collect/collection-and-payout/usePaymentGateway.ts,src/types/MerchantCollectDataTypes.ts", "no files named: the subject's top files, never the manifest");
    assert.ok(filesFor(digest, [digest.picked[1].path, digest.picked[2].path], 200).every((f) => f.content.length <= 100));
  });

  it("finds a planned diagram that a step left out", () => {
    assert.deepEqual(missingKinds([board("a", SEQ)], ["sequence", "class"]), ["class"]);
    assert.deepEqual(missingKinds([board("a", "flowchart TD\n A-->B")], ["flowchart", "activity"]), []);
  });
});

describe("writing a codebase lesson in steps", () => {
  it("plans, writes the boards in parallel with room to think, then closes: a lesson the board can read", async () => {
    const f = fake(honest);
    const seen: string[] = [];
    const lesson = await writeCodebaseLessonInSteps(f.sample, digest, req, DEFAULT_PROFILE, (p) => seen.push(`${p.step}/${p.steps} ${p.doing}`), new AbortController().signal);
    assert.ok(lesson);
    assert.equal(lesson.title, PLAN.title);
    assert.deepEqual(lesson.boards.map((b) => b.kind), ["talk", "talk", "talk", "talk", "quiz", "explain"]);
    const diagrams = lesson.boards.flatMap((b) => b.lines.map((l) => l.diagram ?? "")).join("\n");
    assert.match(diagrams, /sequenceDiagram/);
    assert.match(diagrams, /classDiagram/);
    assert.equal(f.calls.length, 4, "plan, two steps of boards, close");
    assert.equal(f.calls[0].opts.maxOutput, PLAN_OUTPUT);
    assert.equal(f.calls[1].opts.maxOutput, BOARDS_OUTPUT);
    assert.equal(f.most(), 2, "the two steps of boards were asked for at once");
    assert.match(seen[0], /^1\/4 Planning/);
    assert.match(seen.at(-1)!, /quiz/);
  });

  it("asks a step once more when it left out the diagram the student asked for", async () => {
    let first = true;
    const f = fake((p) => {
      if (steps(p) === "1 and 2" && first) {
        first = false;
        return { boards: [board("The big picture"), board("The types")] };
      }
      return honest(p);
    });
    const lesson = await writeCodebaseLessonInSteps(f.sample, digest, req, DEFAULT_PROFILE, () => {}, new AbortController().signal);
    assert.ok(lesson);
    const again = f.calls.find((c) => c.prompt.includes("it left out the planned classDiagram"));
    assert.ok(again, "the step is asked again, naming what it missed");
    assert.match(lesson.boards[1].lines.map((l) => l.diagram ?? "").join(), /classDiagram/);
  });

  it("asks a step once more, with Mermaid's own words, when a diagram would not draw", async () => {
    const BROKEN = "classDiagram\n  class PayoutPayload\n  PayoutPayload : amount: number";
    let first = true;
    const f = fake((p) => {
      if (steps(p) === "1 and 2" && first) {
        first = false;
        return { boards: [board("The big picture"), board("The types", BROKEN)] };
      }
      return honest(p);
    });
    const check = async (src: string) => (src === BROKEN ? "Parse error on line 3" : null);
    const lesson = await writeCodebaseLessonInSteps(f.sample, digest, req, DEFAULT_PROFILE, () => {}, new AbortController().signal, { check });
    assert.ok(lesson);
    assert.ok(f.calls.some((c) => c.prompt.includes("the diagram on board 2 would not draw (Mermaid said: Parse error on line 3)")));
    assert.equal(lesson.boards[1].lines[1].diagram, CLS, "the second, drawable reply is kept");
  });

  it("tells the professor how a class diagram's members are written, the way Mermaid reads them", () => {
    const p = codeBoardsPrompt(digest, cleanPlan(PLAN, digest, 4, req.diagrams)!, [0, 1], req, DEFAULT_PROFILE);
    assert.match(p, /written inside braces, one member per line/);
    assert.match(p, /never as PayoutPayload : amount: number/);
  });

  it("a reply cut short is asked for once more with half again the room", async () => {
    let cut = true;
    const f = fake((p, o) => {
      if (steps(p) === "3 and 4" && cut) {
        cut = false;
        assert.equal(o.maxOutput, BOARDS_OUTPUT);
        return new Error("invalid_json");
      }
      return honest(p);
    });
    const lesson = await writeCodebaseLessonInSteps(f.sample, digest, req, DEFAULT_PROFILE, () => {}, new AbortController().signal);
    assert.ok(lesson);
    assert.ok(f.calls.some((c) => steps(c.prompt) === "3 and 4" && c.opts.maxOutput === BOARDS_OUTPUT * 1.5));
  });

  it("waits out a provider's per-minute limit, then carries on", async () => {
    let limited = true;
    const f = fake((p) => {
      if (p.includes("Plan a lesson") && limited) {
        limited = false;
        return new Error("rate_limited");
      }
      return honest(p);
    });
    const waited: number[] = [];
    const lesson = await writeCodebaseLessonInSteps(f.sample, digest, req, DEFAULT_PROFILE, (p) => p.waiting && waited.push(p.waiting), new AbortController().signal, { pause: async () => {}, waits: [7] });
    assert.ok(lesson);
    assert.deepEqual(waited, [7]);
  });
});
