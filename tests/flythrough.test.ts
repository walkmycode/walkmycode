// The fly-through (docs/PLAN.md "Fly-through"), in Node with a small hand-made
// map: plain names resolve in the browser with no AI; every fly_step is checked
// against the map (an unknown node or a made-up arrow is refused, a real gap is
// shown as a gap); the player's reducer (pause, next, back, replay, stop); the
// camera's target; motion off means no duration; and the store end to end with
// a fake room, camera and voice, steps arriving one at a time as the guide's
// tool calls run.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CodeMap, EdgeKind, Layer, MapEdge, MapNode } from "../src/analyzer/types";
import { hiStateOf } from "../src/components/mapHighlight";
import { flyTiming } from "../src/components/mapTrace";
import { runTool } from "../src/lib/claude/tools";
import { checkStep, findByName, findPath, isQuestion, parseLines, resolveGoTo, stepsForPath, type FlyStep } from "../src/lib/flyPath";
import { CAMERA, CAMERA_MS, cameraTarget, dwellMs, easeSettle, flyDuration, flyReducer, FlyThrough, IDLE, litFor, spokenFor, type FlyCamera, type FlyRoom, type FlyState, type FlyVoice } from "../src/lib/flythrough";
import { FLY_HOP_MS } from "../src/lib/motion";

// ── a small app: login page → POST /api/login → auth → users; cart → POST /api/orders → orders → orders table, Stripe ──

const LOGIN = "file:app/login/page.tsx";
const CART = "file:app/cart/page.tsx";
const R_LOGIN = "route:app/api/login/route.ts#POST /api/login";
const R_ORDERS = "route:app/api/orders/route.ts#POST /api/orders";
const AUTH = "file:lib/auth.ts";
const ORDERS = "file:lib/orders.ts";
const USERS = "table:users";
const T_ORDERS = "table:orders";
const STRIPE = "svc:stripe";
const REPORT = "file:lib/report.ts";

const node = (id: string, name: string, layer: Layer, kind: MapNode["kind"], file?: string, line?: number, endLine?: number): MapNode =>
  ({ id, name, layer, kind, area: "app", ...(file ? { file, line: line ?? 1, ...(endLine ? { endLine } : {}) } : {}) }) as MapNode;
const edge = (kind: EdgeKind, from: string, to: string, file: string, line: number, confidence: "certain" | "likely" = "certain"): MapEdge => ({
  id: `${kind}:${from}->${to}`,
  from,
  to,
  kind,
  confidence,
  evidence: [{ file, line, text: "" }],
});

const NODES = [
  node(LOGIN, "LoginPage", "ui", "component", "app/login/page.tsx", 1, 30),
  node(CART, "Cart", "ui", "component", "app/cart/page.tsx", 1, 20),
  node(R_LOGIN, "POST /api/login", "api", "route", "app/api/login/route.ts", 3, 12),
  node(R_ORDERS, "POST /api/orders", "api", "route", "app/api/orders/route.ts", 2, 9),
  node(AUTH, "lib/auth", "logic", "module", "lib/auth.ts"),
  node(ORDERS, "lib/orders", "logic", "module", "lib/orders.ts"),
  node(USERS, "users", "data", "table", "prisma/schema.prisma", 10, 18),
  node(T_ORDERS, "orders", "data", "table", "prisma/schema.prisma", 20, 28),
  node(STRIPE, "Stripe", "external", "service"),
  node(REPORT, "lib/report", "logic", "module", "lib/report.ts"),
];
const EDGES = [
  edge("calls-route", LOGIN, R_LOGIN, "app/login/page.tsx", 12),
  edge("imports", R_LOGIN, AUTH, "app/api/login/route.ts", 1),
  edge("calls", R_LOGIN, AUTH, "app/api/login/route.ts", 5),
  edge("reads", AUTH, USERS, "lib/auth.ts", 20),
  edge("calls-route", CART, R_ORDERS, "app/cart/page.tsx", 8),
  edge("calls", R_ORDERS, ORDERS, "app/api/orders/route.ts", 4),
  edge("writes", ORDERS, T_ORDERS, "lib/orders.ts", 15),
  edge("uses-service", ORDERS, STRIPE, "lib/orders.ts", 30, "likely"),
];
const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n");
const FILES: Record<string, string> = {
  "app/login/page.tsx": lines(40),
  "app/cart/page.tsx": lines(25),
  "app/api/login/route.ts": lines(14),
  "app/api/orders/route.ts": lines(10),
  "lib/auth.ts": lines(30),
  "lib/orders.ts": lines(40),
  "lib/report.ts": lines(5),
  "prisma/schema.prisma": lines(30),
};
const MAP = {
  name: "shop",
  generatedAt: "2026-10-01T00:00:00.000Z",
  nodes: NODES,
  edges: EDGES,
  services: [],
  system: { kind: "monolith", links: [] },
  files: Object.keys(FILES).map((path) => ({ path })),
} as unknown as CodeMap;

const ok = (r: ReturnType<typeof checkStep>): FlyStep => {
  if (!r.ok) assert.fail(r.error);
  return r.step;
};
const refused = (r: ReturnType<typeof checkStep>): string => {
  if (r.ok) assert.fail(`expected a refusal, got ${r.note}`);
  return r.error;
};

describe("go-to bar: names resolve in the browser, with no AI", () => {
  it("finds a page by its kind word", () => {
    const g = resolveGoTo(MAP, "take me to the login page");
    assert.equal(g.kind, "hit");
    assert.equal(g.kind === "hit" && g.hit.id, LOGIN);
  });

  it("finds a table, a route, an outside service and a file card by name", () => {
    assert.equal(findByName(MAP, "users table")?.id, USERS);
    assert.equal(findByName(MAP, "the orders table")?.id, T_ORDERS);
    assert.equal(findByName(MAP, "POST /api/login")?.id, R_LOGIN);
    assert.equal(findByName(MAP, "Stripe")?.id, STRIPE);
    assert.equal(findByName(MAP, "lib/report")?.id, REPORT);
    assert.equal(findByName(MAP, R_ORDERS)?.id, R_ORDERS, "a node id is a name too");
  });

  it("reads 'log in page' for LoginPage, letters only", () => {
    assert.equal(findByName(MAP, "log in page")?.id, LOGIN);
  });

  it("prefers the card of the kind named over a closer name of another kind", () => {
    // "orders" alone is the logic module first (lib/orders); "orders table" is the table.
    assert.equal(findByName(MAP, "orders table")?.id, T_ORDERS);
    assert.equal(findByName(MAP, "orders route")?.id, R_ORDERS);
  });

  it("reads two names as a path to fly", () => {
    const g = resolveGoTo(MAP, "cart to the orders table");
    assert.equal(g.kind, "path");
    if (g.kind !== "path") return;
    assert.equal(g.from.id, CART);
    assert.equal(g.to.id, T_ORDERS);
  });

  it("sends how / why / what-happens questions to the guide", () => {
    for (const q of ["how does checkout reach the database?", "show me how login works", "why is the users table read twice", "what happens when I pay", "walk me through sign in"]) {
      assert.equal(resolveGoTo(MAP, q).kind, "ask", q);
      assert.ok(isQuestion(q), q);
    }
    assert.ok(!isQuestion("the login page"));
    assert.equal(resolveGoTo(MAP, "where is the login page?").kind, "hit", "'where is' looks a card up");
  });

  it("says nothing for a name the map does not have, and asks the guide for a long sentence it cannot place", () => {
    assert.equal(resolveGoTo(MAP, "zzz").kind, "none");
    assert.equal(resolveGoTo(MAP, "").kind, "none");
    assert.equal(resolveGoTo(MAP, "the part that sends the emails out").kind, "ask");
  });
});

describe("fly_step: checked against the map", () => {
  it("starts anywhere real, opening the node's own code", () => {
    const s = ok(checkStep(MAP, FILES, null, { node: LOGIN, say: "Start on the login page." }));
    assert.equal(s.from, null);
    assert.equal(s.via, null);
    assert.equal(s.gap, false);
    assert.deepEqual([s.file, s.start, s.end], ["app/login/page.tsx", 1, 25], "its first lines, not the whole file");
    assert.equal(s.say, "Start on the login page.");
  });

  it("refuses a made-up node and tells the guide to use query_map, with the closest real ones", () => {
    const e = refused(checkStep(MAP, FILES, null, { node: "route:app/api/checkout.ts#POST /api/checkout", say: "x" }));
    assert.match(e, /^Refused: there is no node/);
    assert.match(e, /query_map/);
    assert.match(refused(checkStep(MAP, FILES, null, { node: "file:lib/authz.ts" })), /close matches: lib\/auth \[file:lib\/auth\.ts\]/);
    assert.match(refused(checkStep(MAP, FILES, null, {})), /give node/);
  });

  it("picks the real arrow from the node before when via_edge is left out: a call before an import", () => {
    const s = ok(checkStep(MAP, FILES, R_LOGIN, { node: AUTH, say: "" }));
    assert.equal(s.via, `calls:${R_LOGIN}->${AUTH}`);
    assert.equal(s.reverse, false);
    // The arrow's own line is the code shown, and a sentence is made when the guide gave none.
    assert.deepEqual([s.file, s.start, s.end], ["app/api/login/route.ts", 5, 5]);
    assert.equal(s.say, "POST /api/login calls lib/auth.");
  });

  it("takes a real via_edge, by id or by kind, either way round", () => {
    assert.equal(ok(checkStep(MAP, FILES, R_LOGIN, { node: AUTH, via_edge: `imports:${R_LOGIN}->${AUTH}` })).via, `imports:${R_LOGIN}->${AUTH}`);
    assert.equal(ok(checkStep(MAP, FILES, AUTH, { node: USERS, via_edge: "reads" })).via, `reads:${AUTH}->${USERS}`);
    const back = ok(checkStep(MAP, FILES, USERS, { node: AUTH, say: "Who reads it?" }));
    assert.equal(back.via, `reads:${AUTH}->${USERS}`);
    assert.equal(back.reverse, true, "travelled against the arrow");
  });

  it("refuses an arrow that does not exist, and one that joins other nodes", () => {
    const fake = refused(checkStep(MAP, FILES, LOGIN, { node: R_LOGIN, via_edge: "calls-route:file:app/login/page.tsx->route:nowhere" }));
    assert.match(fake, /is not an arrow on the map/);
    assert.match(fake, /calls-route:file:app\/login\/page\.tsx->route:app\/api\/login/, "it lists the real arrow");
    const wrong = refused(checkStep(MAP, FILES, LOGIN, { node: R_LOGIN, via_edge: `writes:${ORDERS}->${T_ORDERS}` }));
    assert.match(wrong, /joins lib\/orders and orders, not LoginPage and POST \/api\/login/);
  });

  it("refuses a skipped hop when the map joins the two through others, naming the real hops", () => {
    const e = refused(checkStep(MAP, FILES, LOGIN, { node: USERS, say: "Then the users table." }));
    assert.match(e, /no direct arrow/);
    assert.match(e, /LoginPage → POST \/api\/login → lib\/auth → users/);
    assert.match(e, /call fly_step for POST \/api\/login/);
  });

  it("shows a real gap as a gap, and tells the guide not to invent the link", () => {
    const r = checkStep(MAP, FILES, LOGIN, { node: REPORT, say: "And the report." });
    const s = ok(r);
    assert.equal(s.gap, true);
    assert.equal(s.via, null);
    assert.match(r.ok ? r.note : "", /^Shown as a gap: the map has no link between LoginPage and lib\/report/);
    assert.equal(spokenFor(s), "I can't see a link from LoginPage to lib/report. And the report.");
  });

  it("opens what the step cites, clamped to the file; refuses a file that is not there", () => {
    const s = ok(checkStep(MAP, FILES, null, { node: AUTH, file: "lib/auth.ts", lines: [18, 99] }));
    assert.deepEqual([s.file, s.start, s.end], ["lib/auth.ts", 18, 30]);
    const tail = ok(checkStep(MAP, FILES, null, { node: AUTH, file: "auth.ts", lines: "4-6" }));
    assert.deepEqual([tail.file, tail.start, tail.end], ["lib/auth.ts", 4, 6], "a unique ending finds the file");
    assert.match(refused(checkStep(MAP, FILES, null, { node: AUTH, file: "lib/nope.ts" })), /no file "lib\/nope\.ts"/);
    assert.deepEqual(parseLines([3, 1]), [3, 3]);
    assert.deepEqual(parseLines("12"), [12, 12]);
    assert.equal(parseLines("x"), null);
  });

  it("marks an arrow that is a guess", () => {
    const r = checkStep(MAP, FILES, ORDERS, { node: STRIPE, say: "It charges the card." });
    assert.equal(ok(r).guess, true);
    assert.match(r.ok ? r.note : "", /GUESS/);
  });

  it("runs as the guide's tool: checked even with no map on screen", () => {
    assert.match(runTool({ map: MAP, files: FILES }, "fly_step", { node: LOGIN, say: "x" }), /^Not shown: no map is on screen here/);
    assert.match(runTool({ map: MAP, files: FILES }, "fly_step", { node: "nope", say: "x" }), /^Refused/);
  });
});

describe("paths between two cards", () => {
  it("follows the arrows, preferring them over imports", () => {
    const p = findPath(MAP, LOGIN, USERS);
    assert.deepEqual(p?.nodes, [LOGIN, R_LOGIN, AUTH, USERS]);
    assert.deepEqual(p?.edges, [`calls-route:${LOGIN}->${R_LOGIN}`, `calls:${R_LOGIN}->${AUTH}`, `reads:${AUTH}->${USERS}`]);
    assert.deepEqual(findPath(MAP, USERS, LOGIN)?.nodes, [USERS, AUTH, R_LOGIN, LOGIN], "against the arrows when it must");
    assert.equal(findPath(MAP, LOGIN, REPORT), null);
  });

  it("turns a path into steps every one of which checks out", () => {
    const p = findPath(MAP, CART, T_ORDERS)!;
    let prev: string | null = null;
    for (const input of stepsForPath(MAP, p.nodes, p.edges)) {
      const s = ok(checkStep(MAP, FILES, prev, input));
      prev = s.node;
    }
    assert.equal(prev, T_ORDERS);
  });
});

describe("the player: a pure reducer", () => {
  const step = (node: string, from: string | null = null): FlyStep => ({ node, name: node, from, fromName: from, via: null, reverse: false, gap: false, guess: false, say: "", file: null, start: 1, end: 1 });
  const begin = (o: Partial<{ waiting: boolean; steps: FlyStep[] }> = {}): FlyState => flyReducer(IDLE, { type: "begin", session: 1, title: "t", voice: false, waiting: o.waiting ?? false, steps: o.steps });

  it("plays a whole path one step at a time, then is done", () => {
    let s = begin({ steps: [step("a"), step("b", "a"), step("c", "b")] });
    assert.deepEqual([s.at, s.settled, s.status], [0, false, "playing"]);
    s = flyReducer(s, { type: "settled" });
    assert.deepEqual([s.at, s.settled], [1, false]);
    s = flyReducer(flyReducer(s, { type: "settled" }), { type: "settled" });
    assert.deepEqual([s.at, s.settled, s.status], [2, true, "done"]);
  });

  it("waits at the end of a live path for the next step, and plays it the moment it comes", () => {
    let s = begin({ waiting: true });
    assert.deepEqual([s.at, s.status], [-1, "playing"]);
    s = flyReducer(s, { type: "add", step: step("a") });
    assert.deepEqual([s.at, s.settled], [0, false], "the first step plays at once");
    s = flyReducer(s, { type: "add", step: step("b", "a") });
    assert.equal(s.at, 0, "the next waits for this one to finish");
    s = flyReducer(s, { type: "settled" });
    assert.equal(s.at, 1);
    s = flyReducer(s, { type: "settled" });
    assert.deepEqual([s.at, s.settled, s.status], [1, true, "playing"], "still waiting for the guide");
    s = flyReducer(s, { type: "add", step: step("c", "b") });
    assert.deepEqual([s.at, s.settled], [2, false]);
    s = flyReducer(flyReducer(s, { type: "end" }), { type: "settled" });
    assert.equal(s.status, "done");
  });

  it("pauses, resumes, and moves on when resumed after the step finished", () => {
    let s = begin({ steps: [step("a"), step("b", "a")] });
    s = flyReducer(s, { type: "pause" });
    assert.equal(s.status, "paused");
    s = flyReducer(s, { type: "settled" });
    assert.deepEqual([s.at, s.settled], [0, true], "paused: no moving on");
    s = flyReducer(s, { type: "resume" });
    assert.deepEqual([s.at, s.settled, s.status], [1, false, "playing"]);
  });

  it("goes next and back, replays from the start, and stops with the path drawn", () => {
    let s = begin({ steps: [step("a"), step("b", "a"), step("c", "b")] });
    s = flyReducer(s, { type: "next" });
    assert.equal(s.at, 1);
    s = flyReducer(s, { type: "back" });
    assert.deepEqual([s.at, s.settled], [0, false]);
    assert.equal(flyReducer(s, { type: "back" }), s, "nothing before the first");
    s = flyReducer(s, { type: "stop" });
    assert.deepEqual([s.at, s.status, s.settled], [2, "done", true], "stop shows the whole path");
    s = flyReducer(s, { type: "back" });
    assert.deepEqual([s.at, s.status], [1, "paused"], "back from the end looks around, paused");
    s = flyReducer(s, { type: "replay" });
    assert.deepEqual([s.at, s.status, s.settled], [0, "playing", false]);
    assert.equal(flyReducer(s, { type: "close" }), IDLE);
  });

  it("turns the guide away once the user stopped a live one, and ends with nothing to show", () => {
    let s = flyReducer(begin({ waiting: true }), { type: "add", step: step("a") });
    s = flyReducer(s, { type: "stop" });
    assert.equal(s.stopped, true);
    const empty = flyReducer(begin({ waiting: true }), { type: "end", error: "No AI set up" });
    assert.deepEqual([empty.status, empty.error], ["done", "No AI set up"]);
  });
});

describe("the camera", () => {
  const view = { width: 1000, height: 700, x: 0, y: 0, zoom: 0.2 };
  const card = (x: number, y: number) => ({ x, y, width: 220, height: 46 });

  it("zooms in from far out to a readable zoom, centred on the card", () => {
    const t = cameraTarget(card(1000, 400), null, view)!;
    assert.deepEqual(t, { x: 1110, y: 423, zoom: CAMERA.minZoom });
  });

  it("zooms out when too close, and keeps a zoom already in range", () => {
    assert.equal(cameraTarget(card(0, 0), null, { ...view, zoom: 2 })!.zoom, CAMERA.maxZoom);
    assert.equal(cameraTarget(card(3000, 0), null, { ...view, zoom: 1.1 })!.zoom, 1.1);
  });

  it("lands a tour step at a zoom its card's labels can be read at (0.9 or more)", () => {
    // Zoomed out to see the whole map (or at the old 0.6): the step zooms in to read.
    for (const zoom of [0.2, 0.6, 0.85]) assert.ok(cameraTarget(card(3000, 0), null, { ...view, zoom })!.zoom >= 0.9, `from ${zoom}`);
    // Framing the card it came from never zooms back out below that: too far apart, it follows the card.
    const pair = cameraTarget(card(700, 0), card(0, 0), { ...view, zoom: 0.3 })!;
    assert.ok(pair.zoom >= 0.9);
    assert.equal(pair.x, 810, "the pair would need zoom < 0.9, so the camera centres the card arrived at");
  });

  it("frames the arrow travelled: both cards when they fit, else the one arrived at", () => {
    const near = cameraTarget(card(400, 0), card(0, 0), { ...view, zoom: 1 })!;
    assert.deepEqual([near.x, near.y, near.zoom], [310, 23, 1]);
    const far = cameraTarget(card(5000, 0), card(0, 0), { ...view, zoom: 1 })!;
    assert.deepEqual([far.x, far.zoom], [5110, 1], "too far apart: the camera follows the light");
  });

  it("stays still when the card is already in view near the middle", () => {
    // A card centred at zoom 1 in a 1000×700 view: its centre is at (500, 350).
    assert.equal(cameraTarget(card(390, 327), null, { ...view, zoom: 1 }), null);
  });

  it("eases with --ease-settle, and takes no time at all with motion off", () => {
    assert.equal(easeSettle(0), 0);
    assert.equal(easeSettle(1), 1);
    assert.ok(easeSettle(0.5) > 0.8, "a long tail: most of the way by the middle");
    assert.equal(flyDuration(false), CAMERA_MS);
    assert.equal(flyDuration(true), 0);
    assert.ok(dwellMs("", true, true) < dwellMs("", true, false), "no motion to wait for");
    assert.ok(dwellMs("one two three four five six", false, false) > dwellMs("", false, false), "time to read the line");
  });
});

describe("what the map lights for a hop", () => {
  it("lights the path so far and animates only the hop on screen", () => {
    const steps = [ok(checkStep(MAP, FILES, null, { node: LOGIN })), ok(checkStep(MAP, FILES, LOGIN, { node: R_LOGIN })), ok(checkStep(MAP, FILES, R_LOGIN, { node: AUTH }))];
    const lit = litFor(MAP, steps, 2);
    assert.deepEqual([...lit.nodes].sort(), [AUTH, LOGIN, R_LOGIN].sort());
    assert.deepEqual([...lit.edges].sort(), [`calls-route:${LOGIN}->${R_LOGIN}`, `calls:${R_LOGIN}->${AUTH}`].sort());
    assert.deepEqual(lit.fly, { to: AUTH, from: R_LOGIN, edge: `calls:${R_LOGIN}->${AUTH}`, reverse: false, gap: false });
    const t = flyTiming(lit, lit.fly!);
    assert.deepEqual(t.chain, [`calls:${R_LOGIN}->${AUTH}`], "the rider rides this hop's arrow only");
    assert.equal(t.nodeAt.get(AUTH), 1, "the card reached lights as the rider lands");
    assert.equal(t.nodeAt.get(LOGIN), 0, "the cards before stay as they are");
    assert.equal(t.hop, FLY_HOP_MS);
    // The highlight store takes the fly-through's timing over the trace's lane sweep.
    assert.equal(hiStateOf(MAP, null, lit, false).timing?.chain.length, 1);
    assert.equal(litFor(MAP, steps, 2, "sweep").fly, undefined, "the whole path, swept in lane order like a trace");
    const still = litFor(MAP, steps, 2, "still");
    assert.deepEqual(flyTiming(still, still.fly!).chain, [], "Esc: nothing rides");
    assert.ok([...flyTiming(still, still.fly!).nodeAt.values()].every((v) => v === 0), "and nothing waits to light");
  });

  it("rides backwards against the arrow, and draws a gap between cards the map does not join", () => {
    const back = ok(checkStep(MAP, FILES, USERS, { node: AUTH }));
    const t = flyTiming(litFor(MAP, [ok(checkStep(MAP, FILES, null, { node: USERS })), back], 1), { to: AUTH, from: USERS, edge: back.via, reverse: true, gap: false });
    assert.equal(t.reverse, true);
    const gap = ok(checkStep(MAP, FILES, LOGIN, { node: REPORT }));
    const lit = litFor(MAP, [ok(checkStep(MAP, FILES, null, { node: LOGIN })), gap], 1);
    assert.deepEqual(flyTiming(lit, lit.fly!).gap, { from: LOGIN, to: REPORT });
    assert.deepEqual(flyTiming(lit, lit.fly!).chain, []);
  });
});

// ── the store, end to end, with a fake room, camera, clock and voice ──

function rig(o: { reduced?: boolean; drawn?: (id: string) => boolean; voice?: boolean } = {}) {
  const timers: { fn: () => void; at: number; id: number }[] = [];
  let clock = 0;
  let ids = 0;
  const glides: { id: string; from: string | null; ms: number }[] = [];
  const landed: string[] = [];
  const lights: ReturnType<typeof litFor>[] = [];
  const opened: string[] = [];
  const shown: { id: string; wide: boolean }[] = [];
  const selected: string[] = [];
  const said: string[] = [];
  const tours: unknown[] = [];
  let voicePref = !!o.voice;
  const voice: FlyVoice = {
    say: async (text) => {
      said.push(text);
      return "ended";
    },
    pause: () => {},
    resume: () => {},
    stop: () => {},
  };
  const fly = new FlyThrough({
    reduced: () => !!o.reduced,
    setTimer: (fn, ms) => {
      const id = ++ids;
      timers.push({ fn, at: clock + ms, id });
      return id;
    },
    clearTimer: (t) => {
      const i = timers.findIndex((x) => x.id === t);
      if (i >= 0) timers.splice(i, 1);
    },
    now: () => clock,
    voice: async () => voice,
    prefs: { get: () => voicePref, set: (on) => (voicePref = on) },
    mark: () => {},
  });
  const room: FlyRoom = {
    map: () => MAP,
    files: () => FILES,
    show: (id, wide) => void shown.push({ id, wide }),
    light: (l) => void (l && lights.push(l)),
    open: (path, start, end) => void opened.push(`${path}:${start}-${end}`),
    select: (id) => (selected.push(id), id),
    tour: (t) => void tours.push(t),
    reveal: () => {},
  };
  const camera: FlyCamera = {
    has: (id) => (o.drawn ? o.drawn(id) : true),
    glide: async (id, from, ms) => {
      glides.push({ id, from, ms });
      return true;
    },
    land: (id) => void landed.push(id),
  };
  fly.attachRoom(room);
  fly.attachCamera(camera);
  /** Let the clock run until every timer has fired (each step's dwell). */
  const run = async () => {
    for (let guard = 0; guard < 100; guard++) {
      await new Promise((r) => setImmediate(r));
      const next = timers.sort((a, b) => a.at - b.at).shift();
      if (!next) return;
      clock = next.at;
      next.fn();
    }
  };
  return { fly, glides, landed, lights, opened, shown, selected, said, tours, run, timers };
}

describe("the fly-through store", () => {
  it("flies to one card by name: the camera moves before the selection is drawn, the code opens on arrival", async () => {
    const r = rig();
    assert.equal(r.fly.flyTo(AUTH), true);
    assert.deepEqual(r.glides, [{ id: AUTH, from: null, ms: CAMERA_MS }]);
    assert.deepEqual(r.selected, [AUTH]);
    assert.deepEqual(r.opened, [], "not while the camera is still moving");
    assert.equal(r.fly.state.status, "idle", "one card is not a fly-through");
    assert.equal(r.fly.ownsCamera(), true, "the map does not fit itself while it glides");
    await r.run();
    assert.deepEqual(r.opened, ["lib/auth.ts:1-1"]);
    assert.deepEqual(r.landed, [AUTH], "and the light lands on it");
    assert.equal(r.fly.flyTo("nowhere"), false);
  });

  it("with motion off, every camera move is an instant jump (no duration)", async () => {
    const r = rig({ reduced: true });
    r.fly.flyTo(LOGIN);
    r.fly.between(LOGIN, USERS);
    await r.run();
    assert.ok(r.glides.length >= 4);
    assert.ok(r.glides.every((g) => g.ms === 0));
    assert.ok(r.landed.includes(USERS), "the light lands on each card at once");
  });

  it("plays the guide's steps as each tool call runs, in order, and turns made-up ones away", async () => {
    const r = rig();
    const ask = r.fly.forAsk({ map: MAP, files: FILES, key: 7, title: "How does login reach the database?" });
    assert.match(ask.step({ node: LOGIN, say: "Here is the login page." }), /^Step 1\. Shown: LoginPage/);
    assert.equal(r.fly.state.status, "playing");
    assert.deepEqual(r.glides.map((g) => g.id), [LOGIN], "the first hop plays at once");
    assert.match(ask.step({ node: USERS, say: "skip ahead" }), /^Refused: there is no direct arrow/);
    assert.equal(r.fly.state.refused, 1);
    assert.match(ask.step({ node: R_LOGIN, say: "It posts the form." }), /^Step 2\. Shown: LoginPage → POST \/api\/login along the calls-route arrow/);
    assert.equal(r.glides.length, 1, "the second waits for the first to finish");
    await r.run();
    assert.deepEqual(r.glides.map((g) => [g.id, g.from]), [[LOGIN, null], [R_LOGIN, LOGIN]]);
    ask.step({ node: AUTH, say: "The route checks the password." });
    ask.step({ node: USERS, say: "Which reads the users table." });
    ask.done();
    await r.run();
    assert.deepEqual(r.glides.map((g) => g.id), [LOGIN, R_LOGIN, AUTH, USERS]);
    assert.equal(r.fly.state.status, "done");
    assert.deepEqual(r.opened, ["app/login/page.tsx:1-25", "app/login/page.tsx:12-12", "app/api/login/route.ts:5-5", "lib/auth.ts:20-20"]);
    // The finished path stays drawn: the last light has every card and arrow of it.
    assert.equal(r.lights[r.lights.length - 1].nodes.size, 4);
    assert.equal(r.lights[r.lights.length - 1].edges.size, 3);
    // Only the first hop (no arrow to ride) lands the light from the camera; the rider lands the rest.
    assert.deepEqual(r.landed, [LOGIN]);
  });

  it("plays a hop in beats: the camera, then the light along the arrow, then the code once it has landed", async () => {
    const r = rig();
    r.fly.play([{ node: LOGIN }, { node: R_LOGIN }]);
    assert.equal(r.glides.length, 1);
    assert.equal(r.lights.length, 0, "nothing lights while the camera is still moving");
    await new Promise((res) => setImmediate(res));
    assert.equal(r.lights.length, 1, "the camera is there: the card lights");
    assert.deepEqual(r.opened, ["app/login/page.tsx:1-25"], "no arrow to ride: the code opens at once");
    await r.run();
    assert.equal(r.lights.length, 2);
    assert.equal(r.lights[1].fly?.edge, `calls-route:${LOGIN}->${R_LOGIN}`);
    assert.deepEqual(r.opened, ["app/login/page.tsx:1-25", "app/login/page.tsx:12-12"], "after the rider has landed");
  });

  it("feeds the fly-through the go-to bar began for the same question, and stops taking steps after Esc", async () => {
    const r = rig();
    const session = r.fly.begin({ title: "show me how cart reaches orders", live: true, key: 42 });
    assert.equal(r.fly.state.session, session);
    const ask = r.fly.forAsk({ map: MAP, files: FILES, key: 42, title: "x" });
    ask.step({ node: CART, say: "The cart." });
    assert.equal(r.fly.state.session, session, "no second fly-through");
    assert.equal(r.fly.state.steps.length, 1);
    r.fly.stop();
    assert.match(ask.step({ node: R_ORDERS, say: "x" }), /the user stopped the fly-through/);
    assert.equal(r.fly.state.steps.length, 1);
    r.fly.close();
    assert.equal(r.fly.state.status, "idle");
  });

  it("switches to a view that draws the card when the one on screen does not, wide after the first hop", async () => {
    const drawn = new Set([LOGIN]);
    const r = rig({ drawn: (id) => drawn.has(id) });
    r.fly.path([LOGIN, R_LOGIN]);
    await r.run();
    assert.deepEqual(r.shown, [{ id: R_LOGIN, wide: true }]);
  });

  it("reads each hop aloud when the voice is on, and waits for the narrator before moving on", async () => {
    const r = rig({ voice: true });
    r.fly.play([{ node: LOGIN, say: "Start here." }, { node: REPORT, say: "Then the report." }]);
    await r.run();
    assert.deepEqual(r.said, ["Start here.", "I can't see a link from LoginPage to lib/report. Then the report."]);
    assert.equal(r.fly.state.status, "done");
  });

  it("play() checks every step, leaves refused ones out and says why", () => {
    const r = rig();
    const res = r.fly.play([{ node: LOGIN }, { node: "made:up" }, { node: R_LOGIN, via_edge: "calls-route" }, { node: REPORT }]);
    assert.deepEqual([res.ok, res.shown, res.gaps], [true, 3, 1]);
    assert.equal(res.refused.length, 1);
    assert.equal(res.refused[0].index, 1);
    assert.match(res.refused[0].error, /no node "made:up"/);
  });

  it("saves the path as a normal tour", () => {
    const r = rig();
    r.fly.between(CART, STRIPE, { title: "How the cart pays" });
    assert.equal(r.fly.saveAsTour(), true);
    const t = r.tours[0] as { title: string; steps: { file: string; start_line: number; end_line: number; node_ids: string[]; say: string }[] };
    assert.equal(t.title, "How the cart pays");
    assert.deepEqual(
      t.steps.map((s) => `${s.file}:${s.start_line}`),
      ["app/cart/page.tsx:1", "app/cart/page.tsx:8", "app/api/orders/route.ts:4", "lib/orders.ts:30"],
    );
    assert.deepEqual(t.steps[3].node_ids, [ORDERS, STRIPE]);
    assert.equal(r.fly.state.status, "idle", "the tour player takes over");
  });
});

describe("a tour step's camera (focus)", () => {
  it("glides to the step's card, framing the one before, and selects, opens and lights nothing", async () => {
    const r = rig();
    assert.equal(r.fly.focus(R_LOGIN, LOGIN), true);
    await r.run();
    assert.deepEqual(r.glides, [{ id: R_LOGIN, from: LOGIN, ms: CAMERA_MS }]);
    assert.deepEqual(r.selected, []);
    assert.deepEqual(r.opened, []);
    assert.deepEqual(r.lights, []);
    assert.deepEqual(r.landed, [], "the tour leads the light, not the camera");
  });

  it("jumps with motion off, refuses a card the map lacks, and leaves a fly-through's camera alone", async () => {
    const off = rig({ reduced: true });
    off.fly.focus(AUTH);
    await off.run();
    assert.deepEqual(off.glides, [{ id: AUTH, from: null, ms: 0 }], "no duration: scaled by --m");
    const r = rig();
    assert.equal(r.fly.focus("file:nowhere.ts"), false);
    r.fly.path([LOGIN, R_LOGIN]);
    assert.equal(r.fly.focus(AUTH), false);
  });
});
