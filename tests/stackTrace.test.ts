// "Walk an error" (src/lib/stackTrace.ts): a pasted error or stack trace is read in every
// language WalkMyCode maps, its frames are matched to the project's files (absolute,
// Windows, ./ and shorter paths), frames outside the project are dropped, and the frames
// run from where it threw outwards. Then the map's lights, the tour and the AI's question.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CodeMap, MapEdge, MapNode } from "../src/analyzer/types";
import { causeQuestion, cleanPath, lastError, matchFile, parseTrace, walkLit, walkTour, walkTrace } from "../src/lib/stackTrace";

const TEAM = ["lib/email.ts", "lib/tasks.ts", "app/api/projects/[id]/tasks/route.ts", "lib/db.ts", "components/NewTaskForm.tsx"];
const at = (w: { frames: { file: string; line: number }[] }) => w.frames.map((f) => `${f.file}:${f.line}`);

describe("stack traces: JavaScript and TypeScript", () => {
  it("reads `at fn (file:line:col)` and keeps the error line", () => {
    const w = walkTrace(
      `TypeError: fetch failed
    at sendAssignedEmail (lib/email.ts:4:9)
    at createTask (lib/tasks.ts:26:28)
    at POST (app/api/projects/[id]/tasks/route.ts:19:16)`,
      TEAM,
    );
    assert.equal(w.message, "TypeError: fetch failed");
    assert.deepEqual(at(w), ["lib/email.ts:4", "lib/tasks.ts:26", "app/api/projects/[id]/tasks/route.ts:19"]);
    assert.deepEqual(
      w.frames.map((f) => f.fn),
      ["sendAssignedEmail", "createTask", "POST"],
    );
    assert.equal(w.frames[0].col, 9);
    assert.equal(w.outside, 0);
  });

  it("reads `at file:line:col`, async frames, absolute and Windows paths, and drops node's own", () => {
    const w = walkTrace(
      `Error: boom
    at node:internal/deps/undici/undici:13502:13
    at async sendAssignedEmail (C:\\Users\\me\\team-tasks\\lib\\email.ts:4:3)
    at /home/me/team-tasks/lib/tasks.ts:26:5
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
    at Object.<anonymous> (/home/me/team-tasks/node_modules/next/dist/server/base-server.js:10:1)`,
      TEAM,
    );
    assert.deepEqual(at(w), ["lib/email.ts:4", "lib/tasks.ts:26"]);
    assert.equal(w.frames[0].fn, "sendAssignedEmail");
    assert.equal(w.frames[1].fn, null);
    assert.equal(w.outside, 3);
  });

  it("reads webpack-internal:/// and file:/// frames, and drops Next.js's .next/server build", () => {
    const w = walkTrace(
      ` ⨯ TypeError: fetch failed
    at sendAssignedEmail (webpack-internal:///(rsc)/./lib/email.ts:9:11)
    at async createTask (file:///C:/code/team-tasks/lib/tasks.ts:26:28)
    at async POST (webpack-internal:///(rsc)/./app/api/projects/%5Bid%5D/tasks/route.ts:19:16)
    at async C:\\code\\team-tasks\\.next\\server\\app\\api\\projects\\[id]\\tasks\\route.js:57:42
    at async /code/team-tasks/.next/server/chunks/lib/tasks.ts:3:1`,
      TEAM,
    );
    assert.equal(w.message, "TypeError: fetch failed");
    assert.deepEqual(at(w), ["lib/email.ts:9", "lib/tasks.ts:26", "app/api/projects/[id]/tasks/route.ts:19"]);
    assert.equal(w.outside, 2);
  });

  it("reads Firefox's fn@file:line:col and a browser's address", () => {
    const w = walkTrace(`submit@http://localhost:3000/components/NewTaskForm.tsx:12:7\n@http://localhost:3000/_next/static/chunks/main.js:1:200`, TEAM);
    assert.deepEqual(at(w), ["components/NewTaskForm.tsx:12"]);
    assert.equal(w.frames[0].fn, "submit");
  });

  it("keeps the frame line that ends with Node's ` {` and finds the error under a [cause]", () => {
    const text = `TypeError: fetch failed
    at async sendAssignedEmail (/srv/app/lib/email.ts:4:3) {
  [cause]: Error: connect ECONNREFUSED 127.0.0.1:443
      at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1611:16) {
    errno: -4078,
  }
}`;
    const w = walkTrace(text, TEAM);
    assert.equal(w.message, "TypeError: fetch failed");
    assert.deepEqual(at(w), ["lib/email.ts:4"]);
  });
});

describe("stack traces: other languages", () => {
  it("Python: most recent call last is turned round, the error is the last line", () => {
    const files = ["app/main.py", "app/services/orders.py"];
    const w = walkTrace(
      `Traceback (most recent call last):
  File "/srv/proj/app/main.py", line 40, in <module>
    run()
  File "/srv/proj/app/main.py", line 33, in run
    total = orders.total(cart)
  File "/srv/proj/app/services/orders.py", line 12, in total
    return sum(i.price for i in items) / count
  File "/usr/lib/python3.12/statistics.py", line 5, in mean
    pass
ZeroDivisionError: division by zero`,
      files,
    );
    assert.equal(w.message, "ZeroDivisionError: division by zero");
    assert.deepEqual(at(w), ["app/services/orders.py:12", "app/main.py:33", "app/main.py:40"]);
    assert.deepEqual(
      w.frames.map((f) => f.fn),
      ["total", "run", "<module>"],
    );
    assert.equal(w.outside, 1);
  });

  it("Python: of chained exceptions, the last traceback is walked", () => {
    const w = walkTrace(
      `Traceback (most recent call last):
  File "app/a.py", line 2, in f
    x()
KeyError: 'id'

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "app/b.py", line 9, in g
    f()
ValueError: no id`,
      ["app/a.py", "app/b.py"],
    );
    assert.equal(w.message, "ValueError: no id");
    assert.deepEqual(at(w), ["app/b.py:9"]);
  });

  it("Java and Kotlin: the package gives the folders; library frames go", () => {
    const files = ["src/main/java/com/acme/orders/OrderService.java", "src/main/kotlin/com/acme/Main.kt", "src/main/java/com/acme/web/OrderController.java"];
    const w = walkTrace(
      `Exception in thread "main" java.lang.NullPointerException: Cannot invoke "String.length()"
\tat com.acme.orders.OrderService.total(OrderService.java:42)
\tat com.acme.web.OrderController.lambda$post$0(OrderController.java:17)
\tat java.base/java.util.ArrayList.forEach(ArrayList.java:1596)
\tat com.acme.MainKt.main(Main.kt:5)
\tat org.springframework.web.Servlet.service(Servlet.java:10)
\t... 12 more`,
      files,
    );
    assert.match(w.message, /^Exception in thread "main" java\.lang\.NullPointerException/);
    assert.deepEqual(at(w), ["src/main/java/com/acme/orders/OrderService.java:42", "src/main/java/com/acme/web/OrderController.java:17", "src/main/kotlin/com/acme/Main.kt:5"]);
    assert.equal(w.frames[0].fn, "com.acme.orders.OrderService.total");
    assert.equal(w.outside, 2);
  });

  it("C#: `at Ns.Class.Method() in C:\\path\\File.cs:line 12`", () => {
    const files = ["Api/Controllers/OrdersController.cs", "Api/Services/OrderService.cs"];
    const w = walkTrace(
      `Unhandled exception. System.InvalidOperationException: Sequence contains no elements
   at System.Linq.ThrowHelper.ThrowNoElementsException()
   at Api.Services.OrderService.First(Int32 id) in C:\\src\\shop\\Api\\Services\\OrderService.cs:line 12
   at Api.Controllers.OrdersController.Get(Int32 id) in C:\\src\\shop\\Api\\Controllers\\OrdersController.cs:line 30`,
      files,
    );
    assert.equal(w.message, "Unhandled exception. System.InvalidOperationException: Sequence contains no elements");
    assert.deepEqual(at(w), ["Api/Services/OrderService.cs:12", "Api/Controllers/OrdersController.cs:30"]);
    assert.equal(w.frames[0].fn, "Api.Services.OrderService.First");
  });

  it("Go: the function line, then `/path/file.go:12 +0x..`", () => {
    const files = ["cmd/api/main.go", "internal/orders/handler.go"];
    const w = walkTrace(
      `panic: runtime error: invalid memory address or nil pointer dereference
[signal SIGSEGV: segmentation violation code=0x1 addr=0x0 pc=0x10a3f2]

goroutine 1 [running]:
example.com/shop/internal/orders.(*Handler).Create(0x0, {0x0, 0x0})
\t/home/me/shop/internal/orders/handler.go:27 +0x1d
main.main()
\t/home/me/shop/cmd/api/main.go:14 +0x25
runtime.main()
\t/usr/local/go/src/runtime/proc.go:271 +0x29e
exit status 2`,
      files,
    );
    assert.equal(w.message, "panic: runtime error: invalid memory address or nil pointer dereference");
    assert.deepEqual(at(w), ["internal/orders/handler.go:27", "cmd/api/main.go:14"]);
    assert.equal(w.frames[0].fn, "example.com/shop/internal/orders.(*Handler).Create");
    assert.equal(w.frames[1].fn, "main.main");
  });

  it("Rust: a panic's line, and a backtrace's frames", () => {
    const files = ["src/main.rs", "src/orders.rs"];
    const w = walkTrace(
      `thread 'main' panicked at src/orders.rs:12:5:
called \`Option::unwrap()\` on a \`None\` value
stack backtrace:
   0: rust_begin_unwind
             at /rustc/90b35a6239c3d8bdabc530a6a0816f7ff89a0aaf/library/std/src/panicking.rs:665:5
   1: core::option::unwrap_failed
             at /rustc/90b35a6239c3d8bdabc530a6a0816f7ff89a0aaf/library/core/src/option.rs:2015:5
   2: shop::orders::total
             at ./src/orders.rs:12:5
   3: shop::main
             at ./src/main.rs:4:13
note: Some details are omitted, run with \`RUST_BACKTRACE=full\` for a verbose backtrace.`,
      files,
    );
    assert.equal(w.message, "called `Option::unwrap()` on a `None` value");
    assert.deepEqual(at(w), ["src/orders.rs:12", "src/main.rs:4"]);
    assert.equal(w.frames[0].fn, "shop::orders::total");
    assert.equal(w.frames[1].fn, "shop::main");
  });

  it("Rust: the old panic format, and a crate inside a bigger project", () => {
    const w = walkTrace(`thread 'main' panicked at 'index out of bounds', src/main.rs:7:9\nnote: run with \`RUST_BACKTRACE=1\``, ["engine/src/main.rs", "engine/src/lib.rs"]);
    assert.equal(w.message, "index out of bounds");
    assert.deepEqual(at(w), ["engine/src/main.rs:7"]);
  });
});

describe("matching paths to the project's files", () => {
  it("cleans webpack, file and http paths", () => {
    assert.equal(cleanPath("webpack-internal:///(app-pages-browser)/./components/A.tsx"), "components/A.tsx");
    assert.equal(cleanPath("webpack://_N_E/./lib/x.ts?abc"), "lib/x.ts");
    assert.equal(cleanPath("file:///C:/a%20b/lib/x.ts"), "C:/a b/lib/x.ts");
    assert.equal(cleanPath("file:///home/me/x.ts"), "/home/me/x.ts");
    assert.equal(cleanPath(".\\lib\\x.ts"), "lib/x.ts");
  });

  it("prefers the longest file an absolute path ends with, and ignores case", () => {
    const files = ["tasks.ts", "lib/tasks.ts"];
    assert.equal(matchFile("/srv/app/lib/tasks.ts", files), "lib/tasks.ts");
    assert.equal(matchFile("C:\\Code\\App\\LIB\\Tasks.ts", files), "lib/tasks.ts");
    assert.equal(matchFile("./lib/tasks.ts", files), "lib/tasks.ts");
  });

  it("matches a shorter path to a file in a workspace of several folders", () => {
    assert.equal(matchFile("lib/email.ts", ["web/lib/email.ts", "api/lib/other.ts"]), "web/lib/email.ts");
  });

  it("never matches a library's copy of a file name the project also has", () => {
    assert.equal(matchFile("/srv/app/node_modules/pkg/lib/tasks.ts", TEAM), null);
    assert.equal(matchFile("/srv/app/.next/server/lib/tasks.ts", TEAM), null);
    assert.equal(matchFile("/usr/lib/python3.12/site-packages/app/main.py", ["app/main.py"]), null);
    assert.equal(matchFile("node:internal/lib/tasks.ts", TEAM), null);
  });

  it("a file the project does not have is not matched", () => {
    assert.equal(matchFile("/srv/app/lib/nothere.ts", TEAM), null);
  });
});

describe("the last error in a run's output", () => {
  it("finds the last trace after other output", () => {
    const log = `> next dev
  ▲ Next.js 16
 ✓ Ready in 1.2s
Error: first one
    at a (lib/db.ts:1:1)
 GET /api/projects 200 in 30ms
 ⨯ TypeError: fetch failed
    at sendAssignedEmail (lib/email.ts:4:9)
    at createTask (lib/tasks.ts:26:28)
 POST /api/projects/1/tasks 500 in 80ms`;
    const err = lastError(log)!;
    assert.match(err, /^⨯ TypeError: fetch failed/);
    assert.doesNotMatch(err, /first one/);
    assert.deepEqual(at(walkTrace(log, TEAM)), ["lib/email.ts:4", "lib/tasks.ts:26"]);
  });

  it("finds a Python traceback with its error line after printed output", () => {
    const log = `starting\nTraceback (most recent call last):\n  File "app/main.py", line 3, in <module>\n    1/0\nZeroDivisionError: division by zero\n`;
    assert.equal(lastError(log), `Traceback (most recent call last):\n  File "app/main.py", line 3, in <module>\n    1/0\nZeroDivisionError: division by zero`);
  });

  it("is null when the output names no frame", () => {
    assert.equal(lastError("warning: something\nall good"), null);
  });

  it("takes in a Go panic whole", () => {
    const log = `listening\npanic: boom\n\ngoroutine 1 [running]:\nmain.main()\n\t/x/main.go:8 +0x25\nexit status 2`;
    assert.equal(lastError(log), `panic: boom\n\ngoroutine 1 [running]:\nmain.main()\n\t/x/main.go:8 +0x25`);
  });
});

describe("raw frames", () => {
  it("drops an anonymous function's name and the arguments of a C# method", () => {
    const { frames } = parseTrace(`Error: x\n    at Object.<anonymous> (/a/b.js:1:2)\n    at <anonymous> (/a/c.js:3:4)`);
    assert.deepEqual(
      frames.map((f) => f.fn),
      [null, null],
    );
  });

  it("merges the same line twice in a row into one step", () => {
    const w = walkTrace(`Error: x\n    at f (lib/tasks.ts:26:3)\n    at async f (lib/tasks.ts:26:3)\n    at g (lib/db.ts:2:1)`, TEAM);
    assert.deepEqual(at(w), ["lib/tasks.ts:26", "lib/db.ts:2"]);
  });

  it("an error with no frames in the project walks nowhere, and says how many it left out", () => {
    const w = walkTrace(`Error: x\n    at f (/elsewhere/other.ts:1:1)\n    at node:fs:2:2`, TEAM);
    assert.equal(w.frames.length, 0);
    assert.equal(w.outside, 2);
    assert.equal(w.message, "Error: x");
  });
});

// ── What the room shows ──

const node = (id: string, file: string, layer: MapNode["layer"], extra: Partial<MapNode> = {}): MapNode => ({ id, name: id, kind: "module", layer, area: "app", file, ...extra }) as MapNode;
const edge = (id: string, from: string, to: string): MapEdge => ({ id, from, to, kind: "calls", confidence: "certain", evidence: [{ file: "x.ts", line: 1, text: "" }] }) as MapEdge;
const map = {
  nodes: [
    node("route:POST", "app/api/projects/[id]/tasks/route.ts", "api", { kind: "route", line: 13, endLine: 21 }),
    node("file:route", "app/api/projects/[id]/tasks/route.ts", "api"),
    node("file:tasks", "lib/tasks.ts", "logic"),
    node("file:email", "lib/email.ts", "logic"),
    node("file:db", "lib/db.ts", "data"),
  ],
  edges: [edge("e1", "route:POST", "file:tasks"), edge("e2", "file:tasks", "file:email"), edge("e3", "file:tasks", "file:db")],
  files: [],
  services: [],
  system: { kind: "monolith", links: [] },
} as unknown as CodeMap;
const walk = walkTrace(
  `TypeError: fetch failed
  at sendAssignedEmail (lib/email.ts:4:9)
  at createTask (lib/tasks.ts:26:28)
  at POST (app/api/projects/[id]/tasks/route.ts:19:16)`,
  TEAM,
);

describe("the walk on the map", () => {
  it("lights the card at each frame and the arrows between them, and starts where it threw", () => {
    const lit = walkLit(map, walk.frames);
    assert.deepEqual([...lit.nodes], ["file:email", "file:tasks", "route:POST"]);
    assert.deepEqual([...lit.edges].sort(), ["e1", "e2"]);
    assert.equal(lit.origin, "file:email");
  });

  it("tours the path in the order the code ran, ending where it broke", () => {
    const t = walkTour(map, walk);
    assert.deepEqual(
      t.steps.map((s) => `${s.file}:${s.start_line}`),
      ["app/api/projects/[id]/tasks/route.ts:19", "lib/tasks.ts:26", "lib/email.ts:4"],
    );
    assert.equal(t.steps[0].say, "POST runs here (route.ts, line 19) and calls createTask.");
    assert.equal(t.steps[2].say, "This is where it broke, in sendAssignedEmail (email.ts, line 4): TypeError: fetch failed");
    assert.deepEqual(t.steps[0].node_ids, ["route:POST"]);
    assert.match(t.title, /fetch failed/);
  });

  it("asks the AI with the error, the frames and the numbered code around each", () => {
    const files = { "lib/email.ts": "a\nb\nc\nawait fetch(url)\ne", "lib/tasks.ts": "x", "app/api/projects/[id]/tasks/route.ts": "y" };
    const q = causeQuestion(walk, files);
    assert.match(q, /The error: TypeError: fetch failed/);
    assert.match(q, /1\. sendAssignedEmail at lib\/email\.ts:4/);
    assert.match(q, /3\. POST at app\/api\/projects\/\[id\]\/tasks\/route\.ts:19/);
    assert.match(q, />   4\| await fetch\(url\)/);
    assert.match(q, /    3\| c/);
    assert.match(q, /Cite path:line/);
  });
});
