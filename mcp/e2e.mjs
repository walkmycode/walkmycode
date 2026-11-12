// npm run e2e:mcp, after npm run build:mcp: WalkMyCode for Claude end to end, with
// the REAL page in a headless browser (docs/MCP.md §8 B). The real bundle runs
// over stdio the way an MCP client starts it (a temporary WALKMYCODE_HOME, no
// browser opened by the server, the page server on a random port), and this
// script plays Claude's part through the MCP SDK's client while Playwright
// drives its own headless Chrome (never a shared one):
//  - the page connects with the URL's key and draws the map;
//  - a click on a card's "Explain this" arrives as an explain request through
//    next_request, and before Claude polls the page says it is waiting;
//  - narrate is read aloud through a stubbed speechSynthesis; highlight_lines
//    lights the lines in the code view; answer shows in the Guide; the code view's own
//    "Explain this code" goes to the client too and answers under the code;
//  - a typed question arrives as a question; a tour Claude starts plays by
//    itself, step after step, aloud;
//  - one tap on Talk starts a hands-free conversation (speech recognition
//    stubbed): what is said becomes a spoken request with no key held, and
//    the page says its own short line at once; Esc ends it.
// Exits non-zero on the first failure, with the page's console errors.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// WALKMYCODE_SERVER: another build of the server, e.g. the package installed from npm (its page beside it in ui/).
const server = process.env.WALKMYCODE_SERVER || join(root, "mcp", "dist", "server.mjs");
if (!existsSync(server) || !existsSync(join(dirname(server), "ui", "index.html"))) {
  console.error("e2e:mcp needs the bundle with its page: run npm run build:mcp first.");
  process.exit(1);
}

const home = mkdtempSync(join(tmpdir(), "walkmycode-e2e-"));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [server],
  env: { ...getDefaultEnvironment(), WALKMYCODE_HOME: home, WALKMYCODE_NO_BROWSER: "1" },
  stderr: "pipe",
});
let logs = "";
transport.stderr?.on("data", (d) => (logs += d));
const client = new Client({ name: "walkmycode-e2e", version: "1.0.0" });
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content.map((c) => c.text ?? "").join("\n");
  if (r.isError) throw new Error(`${name} failed: ${text}`);
  return text;
};
const step = (s) => console.log(`✔ ${s}`);

/** In the page before anything else runs: speechSynthesis and speech recognition, recorded instead of heard. */
function stubSpeech() {
  window.__spoken = [];
  const voice = { name: "Test British", lang: "en-GB", default: true, localService: true, voiceURI: "test-gb" };
  const synth = {
    speaking: false,
    pending: false,
    paused: false,
    getVoices: () => [voice],
    speak(u) {
      window.__spoken.push(u.text);
      setTimeout(() => {
        u.onstart?.({});
        setTimeout(() => u.onend?.({}), 30);
      }, 10);
    },
    cancel() {},
    pause() {},
    resume() {},
    addEventListener() {},
    removeEventListener() {},
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  // Hands-free: what the user "says" is window.__say, heard when the test calls window.__speak().
  window.__say = "how does login work";
  // Chrome has it unprefixed too: both names are the stub.
  window.SpeechRecognition = window.webkitSpeechRecognition = class {
    start() {
      window.__hearing = true;
      window.__rec = this;
    }
    stop() {
      window.__hearing = false;
    }
    abort() {
      window.__hearing = false;
    }
  };
  window.__speak = () => {
    const result = Object.assign([{ transcript: window.__say }], { isFinal: true });
    window.__rec?.onresult?.({ resultIndex: 0, results: [result] });
  };
}

let browser;
const errors = [];
try {
  await client.connect(transport);
  const open = await call("walkmycode_open", { path: join(root, "tests", "fixtures", "monolith") });
  const url = /Page: (\S+)/.exec(open)[1];
  step(`WalkMyCode opened the monolith fixture: ${new URL(url).origin}`);

  browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() => chromium.launch({ headless: true }));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(stubSpeech);
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  const missing = [];
  page.on("response", (r) => r.status() === 404 && missing.push(new URL(r.url()).pathname));

  // The page: the key in the URL becomes a cookie, the bridge connects, the map draws.
  await page.goto(url);
  assert.equal(new URL(page.url()).search, "", "the key left the address bar");
  const card = page.locator('.react-flow__node[data-id^="route:"]').first();
  await card.waitFor({ timeout: 30_000 });
  const nodeId = await card.getAttribute("data-id");
  step(`the real page connected and drew the map (${await page.locator(".react-flow__node").count()} cards)`);

  // A click on Explain: before Claude polls, the page says it waits for the client, by name.
  await card.click();
  await page.getByRole("button", { name: "Explain this", exact: true }).click();
  await page.getByText(/^Waiting for Walkmycode E2e…/).first().waitFor({ timeout: 10_000 });
  step("Explain was clicked; the page says plainly it is waiting for the client, by the name it gave");
  const explain = JSON.parse((await call("next_request", { wait_s: 10 })).split("\n")[0]);
  assert.equal(explain.kind, "explain");
  assert.equal(explain.payload.nodeId, nodeId);
  assert.equal(explain.context?.nodeId, nodeId);
  step(`next_request returned it: ${JSON.stringify({ kind: explain.kind, payload: explain.payload })}`);

  // Claude narrates (read aloud by the stubbed speechSynthesis), lights lines, answers.
  await call("narrate", { id: explain.id, text: "This route signs the user in." });
  await page.waitForFunction(() => window.__spoken.some((t) => t.includes("This route signs the user in")), null, { timeout: 10_000 });
  step("narrate was read aloud on the page (speechSynthesis)");
  await call("highlight_lines", { path: "lib/auth.ts", from: 7, to: 9 });
  await page.waitForFunction(() => document.querySelectorAll(".cm-lit-line").length >= 3, null, { timeout: 10_000 });
  step("highlight_lines lit lib/auth.ts:7-9 in the code view");
  await call("answer", { id: explain.id, markdown: "It **checks the session** in lib/auth.ts:7-9 before it answers.", citations: ["lib/auth.ts:7-9"] });
  await page.getByText("checks the session", { exact: false }).waitFor({ timeout: 10_000 });
  await page.locator("button.cite", { hasText: "lib/auth.ts:7" }).first().waitFor({ timeout: 5_000 });
  step("answer showed in the Guide, its citation a button");

  // A typed question.
  const askBox = page.locator("form.ask input.field");
  await askBox.fill("Where is the session kept?");
  await askBox.press("Enter");
  const question = JSON.parse((await call("next_request", { wait_s: 10 })).split("\n")[0]);
  assert.equal(question.kind, "question");
  assert.equal(question.payload.text, "Where is the session kept?");
  await call("answer", { id: question.id, markdown: "In a cookie, set in lib/auth.ts:8.", citations: ["lib/auth.ts:8"] });
  await page.getByText("In a cookie, set in", { exact: false }).waitFor({ timeout: 10_000 });
  step("a typed question arrived as a question, and its answer showed");

  // The code view's own "Explain this code" (lib/auth.ts is open there since highlight_lines)
  // goes to the client too, as an explain of the file, and the answer shows under the code.
  await page.getByRole("button", { name: "Explain this code", exact: true }).click();
  const fileAsk = JSON.parse((await call("next_request", { wait_s: 10 })).split("\n")[0]);
  assert.equal(fileAsk.kind, "explain");
  assert.equal(fileAsk.payload.path, "lib/auth.ts");
  assert.equal(fileAsk.context?.file, "lib/auth.ts");
  await call("answer", { id: fileAsk.id, markdown: "It reads **the session** in `lib/auth.ts`, then the user.", citations: ["lib/auth.ts:7-9"] });
  const shownAnswer = page.locator(".ask .help", { hasText: "It reads the session in lib/auth.ts, then the user." });
  await shownAnswer.waitFor({ state: "visible", timeout: 10_000 });
  assert.equal(await shownAnswer.locator("b").first().textContent(), "the session", "markdown rendered");
  step("the code view's Explain this code went to the client as an explain of the file, and its answer showed there, rendered");

  // "Tour from here": Claude answers with a tour, which plays by itself, step after step, aloud.
  // The map to the front first (Alt+1): an answer may have brought another tab of its group forward.
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press("Alt+1");
  await card.waitFor({ state: "visible", timeout: 10_000 });
  await card.click();
  await page.getByRole("button", { name: "Tour from here", exact: true }).click();
  const tour = JSON.parse((await call("next_request", { wait_s: 10 })).split("\n")[0]);
  assert.equal(tour.kind, "tour");
  await call("start_tour", {
    title: "Signing in",
    steps: [
      { say: "First, the sign in button on the home page.", file: "app/page.tsx", lines: "1-3" },
      { say: "Then the login code checks the password.", file: "lib/auth.ts", lines: "7-9" },
    ],
  });
  await call("answer", { id: tour.id, markdown: "Here is the tour of signing in.", citations: [] });
  await page.waitForFunction(() => window.__spoken.some((t) => t.includes("Then the login code checks the password")), null, { timeout: 15_000 });
  await page.getByText("Signing in", { exact: true }).first().waitFor({ timeout: 5_000 });
  step("Tour from here arrived as a tour request; Claude's tour played both steps aloud by itself, and stayed on the board");

  // Hands-free: one tap on Talk, speak (recognition stubbed), pause. No key is held.
  await page.locator('[data-testid="claude-talk"]').waitFor({ timeout: 10_000 });
  const before = await page.evaluate(() => window.__spoken.length);
  await page.locator('[data-testid="claude-talk"]').click();
  await page.waitForFunction(() => window.__hearing === true, null, { timeout: 5_000 });
  await page.locator('[data-testid="claude-talk-pill"]', { hasText: "Listening" }).waitFor({ timeout: 5_000 });
  await page.evaluate(() => window.__speak());
  const spoken = JSON.parse((await call("next_request", { wait_s: 10 })).split("\n")[0]);
  assert.equal(spoken.kind, "spoken");
  assert.equal(spoken.payload.text, "how does login work");
  const ack = await page.evaluate((n) => window.__spoken.slice(n), before);
  assert.ok(ack.some((t) => /^(Let me|Good question|One moment)/.test(t)), `the page's own line was said at once: ${JSON.stringify(ack)}`);
  await call("narrate", { id: spoken.id, text: "Login starts in the route handler." });
  await call("answer", { id: spoken.id, markdown: "Login is handled in lib/auth.ts:7.", citations: ["lib/auth.ts:7"] });
  await page.getByText("Login is handled in", { exact: false }).waitFor({ timeout: 10_000 });
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="claude-talk"]').waitFor({ timeout: 5_000 });
  assert.equal(await page.evaluate(() => window.__hearing), false, "the recognizer stopped with the conversation");
  step(`one tap on Talk and a spoken question became a spoken request; the page said "${ack[0]}" at once; Esc ended it`);

  // Settings: the AI pane says the user's Claude answers; the Voice pane's talk modes save through a real POST
  // (the browser's own cookie, Origin and JSON) to ~/.walkmycode/mcp.json.
  await page.keyboard.press("Alt+6");
  await page.getByRole("tab", { name: "AI model" }).click();
  await page.getByText("the AI app that opened this page", { exact: false }).first().waitFor({ timeout: 10_000 });
  await page.getByRole("tab", { name: "Voice" }).click();
  await page.locator('[data-testid="talk-claude"][aria-checked="true"]').waitFor({ timeout: 10_000 });
  await page.locator('[data-testid="talk-free"]').click();
  await page.locator('[data-testid="talk-free"][aria-checked="true"]').waitFor({ timeout: 10_000 });
  const saved = JSON.parse(readFileSync(join(home, ".walkmycode", "mcp.json"), "utf8"));
  assert.deepEqual(saved, { talk: "free" });
  await page.locator('[data-testid="talk-claude"]').click();
  await page.locator('[data-testid="talk-claude"][aria-checked="true"]').waitFor({ timeout: 10_000 });
  step("Settings: the AI pane names the user's Claude; a talk mode saved from the page through the server");

  // While Claude waits in next_request, the bar says it is listening.
  const polling = call("next_request", { wait_s: 4 });
  await page.locator('.top [data-testid="claude-status"]', { hasText: "Walkmycode E2e is listening" }).waitFor({ timeout: 5_000 });
  assert.match(await polling, /"kind":"none"/);
  step("the top bar shows Claude listening while next_request waits");

  // Explain this code again; this time Claude reads another file on the way (it opens over lib/auth.ts) and
  // cites nothing that would bring lib/auth.ts back: the answer must not stay hidden behind the other file.
  // Meanwhile the map's cards are watched: lighting a file once laid the whole map out afresh, React Flow
  // hid every card until it measured it again, and now and then it never did (a blank map, arrows only).
  await page.locator(".dv-tab", { hasText: "auth.ts" }).click();
  await page.evaluate(() => {
    window.__cardsHidden = 0;
    new MutationObserver((ms) => {
      for (const m of ms) if (m.target.classList.contains("react-flow__node") && m.target.style.visibility === "hidden") window.__cardsHidden++;
    }).observe(document.querySelector(".react-flow__nodes"), { subtree: true, attributes: true, attributeFilter: ["style"] });
  });
  await page.getByRole("button", { name: "Explain this code", exact: true }).click();
  const again = JSON.parse((await call("next_request", { wait_s: 10 })).split("\n")[0]);
  assert.equal(again.kind, "explain");
  await call("highlight_lines", { path: "app/api/users/[id]/route.ts", from: 1, to: 3 });
  const activeTab = (name) => [...document.querySelectorAll(".dv-tab.dv-active-tab")].some((t) => t.textContent.includes(name));
  await page.waitForFunction(activeTab, "route.ts", { timeout: 10_000 });
  await call("answer", { id: again.id, markdown: "It calls `getUser`, which reads the user.", citations: [] });
  await page.waitForFunction(activeTab, "auth.ts", { timeout: 10_000 });
  await page.locator(".ask .help", { hasText: "It calls getUser, which reads the user." }).waitFor({ state: "visible", timeout: 10_000 });
  step("after Claude opened another file to answer, the code view that asked came back to the front with the answer");
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press("Alt+1");
  await page.waitForFunction(activeTab, "Map", { timeout: 5_000 });
  const cardsShown = await page.locator(".react-flow__node").evaluateAll((ns) => ns.filter((n) => getComputedStyle(n).visibility === "visible").length);
  assert.equal(cardsShown, await page.locator(".react-flow__node").count(), "every card on the map is visible after Alt+1");
  assert.equal(await page.evaluate(() => window.__cardsHidden), 0, "no card went hidden while Claude lit lines in its file and answered");
  step(`the map's ${cardsShown} cards stayed on screen while Claude lit the focused card's own file, and after Alt+1`);

  // WalkMyCode opened in another tab: this one says so, and the new one gets everything.
  const second = await context.newPage();
  await second.goto(new URL("/", url).href);
  await page.getByText("WalkMyCode is open in another tab").waitFor({ timeout: 10_000 });
  await second.locator(".react-flow__node").first().waitFor({ timeout: 30_000 });
  await call("narrate", { text: "Now in the new tab." });
  await second.waitForFunction(() => window.__spoken.some((t) => t.includes("Now in the new tab")), null, { timeout: 10_000 });
  step("a second tab took over; the first says so plainly");

  const real = errors.filter((e) => !/Failed to load resource.*404/.test(e));
  assert.deepEqual(real, [], "no errors on the page");
  // Only the browser's own guess at an icon may be missing.
  assert.deepEqual(missing.filter((p) => p !== "/favicon.ico"), [], `missing files: ${missing.join(", ")}`);
  console.log("\ne2e passed: the real page, the real server, headless");
} catch (e) {
  console.error(`\ne2e FAILED: ${e?.stack ?? e}`);
  if (errors.length) console.error(`page errors:\n${errors.join("\n")}`);
  console.error(`server log:\n${logs.trim().split("\n").slice(-20).join("\n")}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await client.close().catch(() => {});
  rmSync(home, { recursive: true, force: true });
}
