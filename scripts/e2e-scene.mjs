// npm run e2e:scene: an analogy scene in the real app, in headless Chrome, in the three places one appears:
// the Learn room's "Watch it happen" (written by the professor, drawn as a stage and as a sequence
// diagram), an answer of the professor's in conversation, and an answer of the Explore guide's.
// Its own dev server on its own port, a throwaway WALKMYCODE_HOME, and a stand-in AI (an OpenAI-compatible
// server picked as "Local") that answers with a scene, so it needs no key and costs nothing.
// E2E_SHOTS=<folder> keeps a picture of each step. Exit code 1 when anything was wrong.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.E2E_PORT ?? 3127);
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.E2E_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// What the stand-in professor writes: the picture of a move, with the drawings named, a checker, and the words.
const SCENE = {
  title: "Emily's teddy in the playroom",
  place: "a school playroom",
  language: "rust",
  watcher: { a: "the teacher", r: "the compiler", ia: "teacher", ir: "checker" },
  bin: { a: "the toy box", r: "freed memory", ia: "box", ir: "gone" },
  loan: { a: "lends", r: "&s1" },
  actors: [{ id: "emily", a: "Emily", r: "s1", ia: "child", ir: "drawer" }, { id: "olivia", a: "Olivia", r: "r", ia: "child", ir: "drawer" }, { id: "jack", a: "Jack", r: "s2", ia: "child", ir: "drawer" }],
  things: [
    { id: "teddy", a: "the teddy", r: '"teddy"', ia: "teddy", ir: "memory" },
    // Nothing in the set is a kite, so the professor draws one: a diamond, a cross and a tail.
    { id: "kite", a: "the kite", r: "n", tint: "pink", draw: [{ s: "poly", p: [32, 6, 52, 28, 32, 50, 12, 28], c: "t" }, { s: "line", x1: 32, y1: 6, x2: 32, y2: 50, c: "white" }, { s: "line", x1: 12, y1: 28, x2: 52, y2: 28, c: "white" }, { s: "line", x1: 32, y1: 50, x2: 40, y2: 60, c: "yellow" }, { s: "circle", x: 40, y: 60, r: 2.5, c: "yellow" }] },
  ],
  code: 'let s1 = String::from("teddy");\nlet r = &s1;\nlet s2 = s1;\nprintln!("{}", s1); // error: s1 was moved\ndrop(s2);',
  map: [{ a: "the teddy", r: "a value", why: "the text, kept on the heap" }, { a: "lending", r: "a borrow, &", why: "a look at it; the owner keeps it" }, { a: "giving away", r: "a move", why: "ownership passes; the old name is empty" }],
  steps: [
    { line: 1, holds: { teddy: "emily", kite: "olivia" }, lent: {}, off: [], word: 0, made: { a: "brings", r: "String::from" }, a: "Emily brings her teddy.", r: "s1 owns the text." },
    { line: 2, holds: { teddy: "emily" }, lent: { teddy: ["olivia"] }, off: [], word: 1, a: "Emily lends it to Olivia.", r: "r borrows it with &s1." },
    { line: 3, holds: { teddy: "jack" }, lent: {}, off: ["emily"], word: 2, verb: { a: "gives away", r: "move" }, a: "Emily gives it to Jack for good.", r: "The value moves to s2." },
    { line: 4, holds: { teddy: "jack" }, lent: {}, off: ["emily"], stop: { who: "emily", a: "Stop! Emily has no teddy.", r: "error[E0382]" }, a: "Emily reaches for it.", r: "It does not compile." },
    { line: 5, holds: { teddy: null }, lent: {}, off: ["emily", "olivia", "jack"], verb: { a: "tidied away", r: "drop" }, a: "Jack goes home; the teddy is tidied away.", r: "s2 is dropped and the memory freed." },
  ],
  rule: "Every value has one owner at a time.",
  breaks: "Children can sneak a teddy back; the compiler never lets a rule slip.",
};
const PICTURE = {
  title: "Animals at the zoo", kind: "class",
  nodes: [{ id: "animal", a: "any animal", r: "Animal", rows: ["name: String", "eat()"] }, { id: "dog", a: "a dog", r: "Dog" }, { id: "cat", a: "a cat", r: "Cat" }, { id: "keeper", a: "the keeper", r: "Zoo", ia: "farmer" }],
  links: [{ from: "dog", to: "animal", kind: "is", a: "is a kind of", r: "extends" }, { from: "cat", to: "animal", kind: "is" }, { from: "keeper", to: "animal", kind: "has", a: "looks after", r: "owns", ends: ["1", "many"] }],
  rule: "A dog is an animal, so it can do what any animal can.", breaks: "Real animals do not inherit code.",
};
const ANSWER = `Here it is as a picture.\n\n\`\`\`scene\n${JSON.stringify({ ...SCENE, view: "sequence" })}\n\`\`\`\n\nThat is a move. And how the classes are joined:\n\n\`\`\`picture\n${JSON.stringify(PICTURE)}\n\`\`\`\n\nThat is the family.`;

const asked = [];
const ai = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url?.endsWith("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ object: "list", data: [{ id: "stand-in", object: "model" }] }));
    }
    if (!req.url?.endsWith("/chat/completions")) return res.writeHead(404).end();
    let json = {};
    try {
      json = JSON.parse(body);
    } catch {
      /* answered as a chat below */
    }
    const text = JSON.stringify(json.messages ?? "");
    asked.push(text);
    // The scene itself is asked for as JSON; anything else is a conversation, answered with a scene in it.
    const reply = /Reply with only this JSON/.test(text) ? JSON.stringify(SCENE) : ANSWER;
    const base = { id: "c1", created: 0, model: "stand-in" };
    if (!json.stream) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ...base, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = (delta, finish = null) => res.write(`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    // In pieces, so the page draws a block that is still arriving.
    chunk({ role: "assistant", content: reply.slice(0, 40) });
    chunk({ content: reply.slice(40) });
    chunk({}, "stop");
    res.write(`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => ai.listen(0, "127.0.0.1", r));

const home = mkdtempSync(join(tmpdir(), "walkmycode-scene-"));
const data = join(home, ".walkmycode");
mkdirSync(join(data, "learn", "lessons"), { recursive: true });
writeFileSync(join(data, "config.json"), JSON.stringify({ provider: "local", model: "stand-in", local_base_url: `http://127.0.0.1:${ai.address().port}/v1` }));
const now = Date.now();
writeFileSync(
  join(data, "learn", "lessons", "scene.json"),
  JSON.stringify({
    id: "scene", course: "Mastering Rust", number: 1, title: "Ownership", subject: "Ownership", summary: "Who owns a value.",
    boards: [
      { title: "Move", kind: "talk", lines: [{ w: "A **move** hands the value over", s: "A move hands the value over.", diagram: "flowchart LR\n  A[s1<br/>the teddy] -->|move| B[s2<br/>the toy box]" }], analogy: "Emily gives her teddy to Jack. It is Jack's now, and Emily is empty-handed." },
      { title: "Try it", kind: "code", lines: [{ w: "Fix the move", s: "Fix the move." }], task: "Fix it.", starter: "fn main() {}", language: "rust" },
    ],
    createdAt: now, updatedAt: now, at: 0, seen: [0],
  }),
);

// The bundled example project, as `npm run dev` packs it before it starts.
spawnSync(process.execPath, [join(root, "scripts", "pack-example.mjs")], { cwd: root, stdio: "ignore" });

let devLog = "";
const dev = spawn(process.execPath, [join(root, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", String(PORT)], { cwd: root, env: { ...process.env, WALKMYCODE_HOME: home, NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"] });
dev.stdout.on("data", (d) => (devLog += d));
dev.stderr.on("data", (d) => (devLog += d));
const stopDev = () =>
  new Promise((done) => {
    if (dev.exitCode !== null) return done();
    dev.once("exit", done);
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(dev.pid), "/T", "/F"], { stdio: "ignore" });
    else dev.kill("SIGTERM");
  });

const wrong = [];
let step = "starting";
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) wrong.push(`${step}: ${what}`);
};
let browser;
try {
  for (let i = 0; i < 120; i++) {
    if (await fetch(BASE).then((r) => r.ok).catch(() => false)) break;
    if (i === 119) throw new Error(`the dev server did not answer on ${BASE}:\n${devLog.slice(-1500)}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() => chromium.launch({ headless: true }));
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  await context.addInitScript(() => {
    const synth = { speaking: false, pending: false, paused: false, getVoices: () => [], speak: (u) => setTimeout(() => u.onend?.({}), 20), cancel() {}, pause() {}, resume() {}, addEventListener() {}, removeEventListener() {} };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    window.SpeechSynthesisUtterance = class {
      constructor(t) {
        this.text = t;
      }
    };
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => wrong.push(`${step}: page error: ${e.message}`));
  page.on("response", (r) => r.status() >= 400 && wrong.push(`${step}: ${r.status()} ${r.url()}`));
  page.on("console", (m) => m.type() === "error" && !/favicon|Download the React DevTools|Failed to load resource/.test(m.text()) && wrong.push(`${step}: console: ${m.text().slice(0, 300)}`));
  const shot = async (name) => SHOTS && (await page.screenshot({ path: join(SHOTS, `${name}.png`) }));
  const scene = page.locator(".wscene").first();

  // ── 1. Learn: Watch it happen ──
  step = "Learn: Watch it happen";
  await page.goto(`${BASE}/learn?lesson=scene`, { waitUntil: "domcontentloaded" });
  const key = page.locator(".wkey li");
  await key.first().waitFor({ state: "attached", timeout: 90_000 });
  check((await key.count()) === 2 && (await key.locator("svg.art").count()) === 2, "a diagram that backs the analogy has its picture key, drawn");
  check(/the teddy\s*=\s*s1/.test((await key.first().textContent()) ?? ""), "the key says what stands for what");
  const watch = page.getByRole("button", { name: /Watch it happen/ });
  await watch.waitFor({ state: "attached", timeout: 90_000 });
  await watch.evaluate((b) => b.click());
  await scene.waitFor({ timeout: 60_000 });
  check(asked.some((t) => /each a name from this list and nothing else: [a-z, ]*teddy/.test(t)), "the professor is offered the drawings by name");
  check((await scene.locator(".s-row.a .cell > svg.art").count()) === 5, "the picture row draws the teacher, three children and the toy box");
  check((await scene.locator(".s-row.r .cell > svg.art").count()) === 5, "the real row draws the compiler, three variables and freed memory");
  check((await scene.locator('.s-row.a [data-slot="a:emily"] .thing svg.art').count()) === 1, "Emily holds the teddy, drawn");
  const kite = scene.locator('[data-flip="a:kite"] svg.art');
  check((await kite.locator("path, circle").count()) === 5 && (await kite.locator(".c-white").count()) === 2, "a thing the set has no drawing of is drawn from the professor's own shapes");
  check(asked.some((t) => /draw it yourself with \\"draw\\"/.test(t)), "and the professor is told it may draw one, as a last resort");
  await shot("learn-1-stage");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(1300);
  check((await scene.locator(".thing.lent").count()) === 2, "a loan shows a copy with the borrower on both rows");
  check((await scene.locator("svg.links .loan .flow").count()) === 2, "and a dashed thread flowing from the owner on both rows");
  check(/lending\s+is\s+a borrow/.test((await scene.locator(".stamp").textContent()) ?? ""), "the word it teaches is stamped");
  await shot("learn-2-loan");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(1300);
  check((await scene.locator('[data-slot="a:jack"] [data-flip="a:teddy"]').count()) === 1, "a move puts the teddy with Jack");
  check((await scene.locator("svg.links .move .dot").count()) === 2, "and an arrow with a rider for it on both rows");
  check((await scene.locator(".s-row.a .cell.off svg.art.sad").count()) === 1, "Emily is empty-handed, and looks it");
  await page.waitForTimeout(600);
  const rider = await scene.locator("svg.links .move .dot").first().evaluate((d) => ({ opacity: getComputedStyle(d).opacity, name: getComputedStyle(d).animationName, at: getComputedStyle(d).offsetDistance, runs: d.getAnimations().map((x) => x.playState + ":" + x.animationName) }));
  check(rider.opacity === "0", "the rider has crossed and gone, leaving the arrow flowing");
  await shot("learn-3-move");  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(600);
  check((await scene.locator(".cell.aside.stop svg.art.stop").count()) === 2, "the teacher and the compiler stop the broken rule");
  check((await scene.locator("pre .ln.now.bad").count()) === 1, "and the line that does not compile is marked");
  await shot("learn-4-stop");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(1300);
  check((await scene.locator('[data-slot="a:#gone"] .thing.was').count()) === 1, "a drop puts the teddy in the toy box");
  await shot("learn-5-drop");
  await scene.getByRole("button", { name: "Sequence diagram" }).click();
  await page.waitForTimeout(700);
  check((await scene.locator(".shead > span").count()) === 3, "as a sequence diagram: a lifeline for each holder");
  check((await scene.locator(".srow").count()) === 5 && (await scene.locator(".s-msg").count()) === 2, "a row for each step, a message for the loan and for the move");
  check((await scene.locator(".s-tag.stop").count()) === 1 && (await scene.locator(".s-tag.end").count()) === 1, "the stop and the drop as notes on a lifeline");
  check(/the kite/.test((await scene.locator(".srow").first().textContent()) ?? ""), "a thing that simply appears is named, not left as a blank");
  await shot("learn-6-sequence");
  await scene.locator(".srow").nth(2).click();
  check((await scene.locator(".srow.now").getAttribute("aria-label"))?.startsWith("Step 3"), "a row is a way back to its step");
  await scene.getByRole("button", { name: "Close" }).click();
  check((await page.locator(".wscene").count()) === 0, "Close gives the board back");

  // ── 2. Learn: the professor's answer ──
  step = "Learn: a scene in an answer";
  await page.locator("#prof-q").fill("Show me a move as a picture");
  await page.locator("#prof-q").press("Enter");
  const inChat = page.locator(".msg .wscene").first();
  await inChat.waitFor({ timeout: 60_000 });
  check(asked.some((t) => /```scene/.test(t) && /Show me a move as a picture/.test(t)), "the professor is told how to write a scene");
  check((await inChat.locator(".srow").count()) === 5, "the answer's scene opens as the sequence diagram it asked for");
  check((await inChat.locator(".shead svg.art").count()) >= 3, "with its drawings, in the narrow answer");
  await inChat.scrollIntoViewIfNeeded();
  await shot("learn-7-answer");
  await inChat.getByRole("button", { name: "Larger" }).click();
  const large = page.locator(".wscene.full").first();
  await large.getByRole("button", { name: "Picture" }).click();
  await page.waitForTimeout(600);
  const fills = async (el) => { const b = await el.boundingBox(); const v = page.viewportSize(); return !!b && b.x <= 1 && b.y <= 1 && b.width >= v.width - 2 && b.height >= v.height - 2; };
  check(await fills(large), "Larger fills the whole window, out of the narrow answer");
  check((await large.locator(".s-row.a .cell").count()) === 5, "and Picture shows the stage there");
  await shot("learn-8-answer-large");
  await page.keyboard.press("Escape");
  check((await page.locator(".wscene.full").count()) === 0 && (await inChat.count()) === 1, "Esc puts it back in the answer");

  // ── 2b. A class diagram with its analogy drawn in ──
  step = "Learn: a picture diagram in an answer";
  const pic = page.locator(".msg .wpic").first();
  await pic.waitFor({ timeout: 30_000 });
  check(asked.some((t) => /```picture/.test(t)), "the professor is told how to write a picture diagram");
  await pic.getByRole("button", { name: "Larger" }).click();
  const bigPic = page.locator(".wpic.full").first();
  await page.waitForTimeout(900);
  check(await fills(bigPic), "Larger fills the window for a diagram too");
  check((await bigPic.locator(".pd-node").count()) === 4 && (await bigPic.locator(".pd-node svg.art").count()) === 4, "four boxes, each an everyday thing with its drawing");
  check((await bigPic.locator(".pd-row").count()) === 3, "in three rows: the keeper, any animal, then the dog and the cat");
  check((await bigPic.locator(".pd-line .base").count()) === 3, "and a line for each of the three joins");
  const rowsTop = await bigPic.locator(".pd-row").evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll(".pd-node b")].map((b) => b.textContent)));
  check(JSON.stringify(rowsTop) === JSON.stringify([["the keeper"], ["any animal"], ["a dog", "a cat"]]), "the general thing sits above the particular ones");
  const ends = await bigPic.locator(".pd-line .base").evaluateAll((paths) => paths.map((p) => { const n = p.getTotalLength(); const a = p.getPointAtLength(0); const b = p.getPointAtLength(n); return [Math.round(a.y), Math.round(b.y), n > 20]; }));
  check(ends.every(([, , long]) => long) && ends[0][0] > ends[0][1] && ends[2][0] < ends[2][1], "the lines run box to box: a dog up to any animal, the keeper down to it");
  await shot("learn-9-picture");
  await bigPic.getByRole("button", { name: /Play/ }).click();
  await page.waitForTimeout(900);
  check((await bigPic.locator(".pd-node.now").count()) === 2 && (await bigPic.locator(".pd-line.now .dot").count()) === 1, "Play walks a line: its two boxes light and a dot rides it");
  check(/a dog is a kind of any animal/.test((await bigPic.locator(".say").textContent()) ?? ""), "and the caption says it in the picture and for real");
  await shot("learn-10-picture-walk");
  await bigPic.getByRole("button", { name: /Pause/ }).click();
  await page.keyboard.press("Escape");

  // ── 3. Explore: the guide's answer ──
  step = "Explore: a scene in an answer";
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator("button.example-app").first().click();
  await page.waitForURL(/\/map/, { timeout: 90_000 });
  const ask = page.getByPlaceholder(/Ask about this code/).first();
  await ask.waitFor({ timeout: 90_000 });
  await ask.fill("Explain signing in with an analogy");
  await ask.press("Enter");
  const inGuide = page.locator(".wscene").first();
  await inGuide.waitFor({ timeout: 90_000 });
  check(asked.some((t) => /```scene/.test(t) && /Explain signing in with an analogy/.test(t)), "the guide is told how to write a scene");
  check((await inGuide.locator(".srow").count()) === 5, "the guide's answer draws the scene");
  await inGuide.scrollIntoViewIfNeeded();
  await shot("explore-1-answer");
  await inGuide.getByRole("button", { name: "Larger" }).click();
  const largeGuide = page.locator(".wscene.full").first();
  await largeGuide.getByRole("button", { name: "Picture" }).click();
  await page.waitForTimeout(600);
  check(await fills(largeGuide), "in the Explore dock too, Larger fills the whole window, not only the Guide panel");
  await shot("explore-2-large");
  await page.keyboard.press("Escape");
  const guidePic = page.locator(".wpic").first();
  check((await guidePic.locator(".pd-node").count()) === 4, "the guide's answer draws the picture diagram too");
} catch (e) {
  wrong.push(`${step}: ${e?.message ?? e}`);
} finally {
  await browser?.close().catch(() => {});
  await stopDev();
  ai.close();
  rmSync(home, { recursive: true, force: true });
}
if (wrong.length) {
  console.log(`\n${wrong.length} wrong:\n- ${wrong.join("\n- ")}`);
  process.exit(1);
}
console.log("\nThe scene works in Learn, in the professor's answer and in the guide's.");
