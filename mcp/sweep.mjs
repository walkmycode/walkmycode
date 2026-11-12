// npm run sweep:mcp: every control on WalkMyCode for Claude's page, clicked, with what went wrong
// listed. The real server and page (mcp/dist), headless Chrome, a throwaway ~/.walkmycode with no
// keys (a first run), and a stand-in AI app that answers every request. Then the server stops and
// the saves are tried again, as when the Claude session that opened the page ends.
// After each click it looks for: page errors, console errors, failed requests (other than an
// expected 404 for the icon), and raw technical words on screen ("Failed to fetch", "undefined",
// "[object Object]", "TypeError"...). Controls that remove or reset something are listed, not clicked.
// Exit code 1 when anything was found; every finding is printed with where and after which click.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = join(root, "mcp", "dist", "server.mjs");
if (!existsSync(server) || !existsSync(join(root, "mcp", "dist", "ui", "index.html"))) {
  console.error("sweep:mcp needs the bundle with its page: run npm run build:mcp first.");
  process.exit(1);
}

/** Words that mean code leaked onto the screen instead of a sentence for a person. */
const RAW = /Failed to fetch|TypeError|ReferenceError|SyntaxError|\bundefined\b|\bNaN\b|\[object Object\]|is not a function|Cannot read propert|Unexpected token|ECONNREFUSED|NetworkError/;
/** Controls whose job is to remove, reset or end something: listed, never clicked. */
const DANGER = /remove|delete|revoke|turn off|reset(?! code)|sign out|log out|clear|forget|stop sharing|discard/i;
/** Controls that install, set up, commit or push: real work on the machine or the network, listed not clicked. */
const HEAVY = /^(set up|build it|install|commit|push|pull|sync|publish|create|start)|set up \w+$/i;

const findings = [];
const used = [];
const skipped = [];
const note = (area, what, detail) => findings.push({ area, what, detail });

const home = mkdtempSync(join(tmpdir(), "walkmycode-sweep-"));
const project = join(mkdtempSync(join(tmpdir(), "walkmycode-sweep-project-")), "monolith");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [server],
  env: { ...getDefaultEnvironment(), WALKMYCODE_HOME: home, WALKMYCODE_NO_BROWSER: "1" },
  stderr: "pipe",
});
let logs = "";
transport.stderr?.on("data", (d) => (logs += d));
const client = new Client({ name: "claude-code", version: "2.1.286" });
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return r.content.map((c) => c.text ?? "").join("\n");
};

/** The stand-in AI app: takes each request and answers it, as Claude would, until told to stop. */
let listening = true;
const answered = [];
async function listen() {
  while (listening) {
    let text;
    try {
      text = await call("next_request", { wait_s: 3 });
    } catch {
      return;
    }
    const req = JSON.parse(text.split("\n")[0]);
    if (req.kind === "none" || !req.id) continue;
    answered.push(req.kind);
    try {
      if (req.kind === "tour") {
        await call("start_tour", { title: "Signing in", steps: [{ say: "The sign in page.", file: "app/page.tsx", lines: "1-3" }] });
        await call("answer", { id: req.id, markdown: "Here is the tour.", citations: [] });
      } else {
        await call("narrate", { id: req.id, text: "Let me look." });
        const md = req.kind === "deep" ? "WHY: The packages clash.\nCOMMAND: npm install" : `An answer to the ${req.kind} with **bold** and \`code\` (lib/auth.ts:7-9).\n\n- one\n- two`;
        await call("answer", { id: req.id, markdown: md, citations: req.kind === "deep" ? [] : ["lib/auth.ts:7-9"] });
      }
    } catch (e) {
      note("stand-in AI", `answering ${req.kind}`, String(e));
    }
  }
}

let browser;
try {
  await client.connect(transport);
  // A copy of the fixture, so Edit and Save in the code view, and New project, change nothing real.
  cpSync(join(root, "tests", "fixtures", "monolith"), project, { recursive: true });
  const open = await call("walkmycode_open", { path: project });
  const url = /Page: (\S+)/.exec(open)?.[1] ?? /http:\/\/127\.0\.0\.1:\d+\/\?t=[\w-]+/.exec(open)?.[0];
  void listen();

  browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() => chromium.launch({ headless: true }));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    // Speech is recorded, not heard (the page reads answers aloud).
    const synth = { speaking: false, pending: false, paused: false, getVoices: () => [], speak: (u) => setTimeout(() => u.onend?.({}), 20), cancel() {}, pause() {}, resume() {}, addEventListener() {}, removeEventListener() {} };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    window.SpeechSynthesisUtterance = class {
      constructor(t) {
        this.text = t;
      }
    };
    // A microphone that hears one question when asked to (window.__speak), for Talk.
    window.SpeechRecognition = window.webkitSpeechRecognition = class {
      start() {
        window.__rec = this;
      }
      stop() {}
      abort() {}
    };
    window.__speak = (t) => window.__rec?.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: t }], { isFinal: true })] });
  });
  // A pop-out opens its own window: checked for errors, then closed.
  const page = await context.newPage();
  context.on("page", async (p) => {
    if (p === page) return;
    p.on("pageerror", (e) => note("pop-out window", "page error", String(e)));
    await p.waitForTimeout(1500).catch(() => {});
    // As a person closes it (the browser fires beforeunload, which is how the panels go back).
    await p.close({ runBeforeUnload: true }).catch(() => {});
  });
  let where = "loading";
  let after = "";
  page.on("pageerror", (e) => note(where, `page error after ${after}`, String(e)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/favicon|status of 404/.test(t)) return;
    note(where, `console error after ${after}`, t);
  });
  page.on("response", async (r) => {
    const p = new URL(r.url()).pathname;
    if (r.status() < 400 || p === "/favicon.ico") return;
    const [w, a] = [where, after];
    const body = await r.text().catch(() => "");
    note(w, `HTTP ${r.status()} after ${a}`, `${r.request().method()} ${p} ${r.request().postData() ?? ""} → ${body.slice(0, 300)}`);
  });
  page.on("requestfailed", (r) => {
    const p = new URL(r.url()).pathname;
    if (!/\/bridge|favicon/.test(p)) note(where, `request failed after ${after}`, `${r.method()} ${p}: ${r.failure()?.errorText}`);
  });

  /** Raw words on screen, outside the code view and the map (code can say undefined). */
  const rawOnScreen = () =>
    page.evaluate((src) => {
      const re = new RegExp(src);
      const out = [];
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const el = n.parentElement;
        if (!el || el.closest(".cm-editor, .react-flow, .xterm, pre, code, .snippet, script, style")) continue;
        if (!el.offsetParent && getComputedStyle(el).position !== "fixed") continue;
        const t = n.textContent.trim();
        if (t && re.test(t)) out.push(t.slice(0, 160));
      }
      return out;
    }, RAW.source);
  const seenRaw = new Set();
  const look = async (label) => {
    after = label;
    used.push(`${where}: ${label}`);
    globalThis.__where = where;
    globalThis.__after = label;
    await page.waitForTimeout(700);
    for (const t of await rawOnScreen()) {
      if (seenRaw.has(t)) continue;
      seenRaw.add(t);
      note(where, `raw text on screen after ${label}`, t);
    }
  };

  /** A picture of the page when a step can't find what it needs: in the temp folder, named for the step. */
  const shot = async (name) => {
    const f = join(tmpdir(), `walkmycode-sweep-${name}.png`);
    await page.screenshot({ path: f }).catch(() => {});
    return f;
  };
  /** Click the first visible button whose text matches (a role query misses names with marks like ▸ or ●).
   * Tried for up to 2 s: a panel brought forward fades in from opacity 0, invisible for a moment. */
  const clickText = async (src) => {
    for (let i = 0; i < 10; i++) {
      const hit = await page.evaluate((src) => {
        const re = new RegExp(src);
        const b = [...document.querySelectorAll("button")].find((e) => (e.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) ?? !!e.offsetParent) && re.test(e.textContent.trim()));
        b?.click();
        return !!b;
      }, src);
      if (hit) return true;
      await page.waitForTimeout(200);
    }
    return false;
  };
  await page.goto(url);
  await page.locator(".react-flow__node").first().waitFor({ timeout: 30_000 });
  where = "page";
  await look("loading the page");

  // ── Settings: every tab, every control ──
  await page.locator('.top [aria-label="Settings"]').first().click();
  await page.waitForTimeout(800);
  const tabs = await page.locator(".setv [role=tab]").allInnerTexts();
  for (const tabName of tabs.map((t) => t.trim()).filter(Boolean)) {
    where = `Settings → ${tabName}`;
    await page.locator(".setv [role=tab]", { hasText: tabName }).first().click();
    await look(`opening ${tabName}`);
    const pane = page.locator(".setv").first();
    const count = await pane.locator("button:visible, select:visible, input[type=checkbox]:visible, input[type=radio]:visible").count();
    for (let i = 0; i < count; i++) {
      const c = pane.locator("button:visible, select:visible, input[type=checkbox]:visible, input[type=radio]:visible").nth(i);
      if (!(await c.count())) break;
      const tag = await c.evaluate((e) => e.tagName.toLowerCase());
      const role = await c.getAttribute("role");
      const label = ((await c.getAttribute("aria-label")) || (await c.innerText().catch(() => "")) || (await c.getAttribute("title")) || tag).trim().replace(/\s+/g, " ").slice(0, 50);
      if (role === "tab" && tabs.some((t) => t.trim() === label)) continue;
      if (await c.isDisabled()) continue;
      if (DANGER.test(label)) {
        skipped.push(`${where}: "${label}"`);
        continue;
      }
      try {
        if (tag === "select") {
          for (const v of await c.evaluate((s) => [...s.options].map((o) => o.value))) {
            await c.selectOption(v);
            await look(`choosing "${v}" in a list`);
          }
        } else {
          await c.click({ timeout: 3000 });
          await look(`clicking "${label}"`);
        }
      } catch (e) {
        note(where, `could not use "${label}"`, String(e).split("\n")[0]);
      }
      // Anything that opened over the page (a sheet, a dialog, a menu) is closed before the next control.
      if (await page.locator("dialog[open], .sheet, [role=menu]").count()) await page.keyboard.press("Escape");
      if (!(await page.locator(".setv").count())) {
        await page.locator('.top [aria-label="Settings"]').first().click();
        await page.locator(".setv [role=tab]", { hasText: tabName }).first().click();
      }
    }
  }

  // ── The top bar ──
  where = "top bar";
  await page.locator(".proj-chip").click();
  await look("the project chip");
  if (!(await page.locator(".proj-card").isVisible())) note(where, "the project chip", "its card did not open");
  await page.keyboard.press("Escape");
  const layout = page.locator(".layout-menu > button");
  if (await layout.count()) {
    await layout.click();
    const items = await page.locator("#layout-menu [role=menuitem], #layout-menu button").allInnerTexts();
    await page.keyboard.press("Escape");
    // Presets close the menu; panel checkboxes leave it open: close it each time before opening it again.
    for (const [i, it] of items.entries()) {
      if (!(await page.locator("#layout-menu").isVisible().catch(() => false))) await layout.click();
      await page.locator("#layout-menu [role=menuitem], #layout-menu button").nth(i).click();
      await look(`layout "${it.split("\n")[0]}"`);
      if (await page.locator("#layout-menu").isVisible().catch(() => false)) await page.keyboard.press("Escape");
    }
  }
  for (const sel of [".setup-pill", ".git-btn", ".term-btn"]) {
    const b = page.locator(sel).first();
    if (!(await b.count())) continue;
    await b.click();
    await look(`the ${sel.slice(1)} button`);
    for (const label of ["Not now", "Close"]) {
      const x = page.getByRole("button", { name: label, exact: true }).first();
      if (await x.isVisible().catch(() => false)) await x.click();
    }
    await page.keyboard.press("Escape");
  }
  await page.locator('.top [data-testid="claude-status"]').click();
  await look("the Claude status pill");

  // ── The map, the guide and the code view: each must come back with an answer ──
  where = "map and guide";
  await page.keyboard.press("Alt+1");
  const card = page.locator('.react-flow__node[data-id^="route:"]').first();
  await card.click();
  for (const name of ["Explain this", "Trace it", "Tour from here"]) {
    // As a person would: the map to the front and the card picked again before each action.
    await page.keyboard.press("Alt+1");
    await card.click();
    await page.waitForTimeout(400);
    const b = page.getByRole("button", { name, exact: true }).first();
    if (!(await b.isVisible().catch(() => false))) {
      note(where, name, "the button is not there after clicking a card");
      continue;
    }
    const before = answered.length;
    await b.click();
    await page.waitForFunction((n) => window.__never !== n, null, { timeout: 100 }).catch(() => {});
    for (let i = 0; i < 40 && answered.length === before; i++) await page.waitForTimeout(250);
    await look(name);
    if (answered.length === before) note(where, name, "no request reached the AI app");
  }
  const ask = page.locator("form.ask input.field").first();
  await ask.fill("Where is the session kept?");
  await ask.press("Enter");
  await page.getByText("An answer to the question", { exact: false }).first().waitFor({ timeout: 10_000 }).catch(() => note(where, "a typed question", "its answer did not show"));
  await look("a typed question");
  where = "code view";
  const explain = page.getByRole("button", { name: "Explain this code", exact: true }).first();
  if (await explain.isVisible().catch(() => false)) {
    await explain.click();
    await page.locator(".ide .ask .help", { hasText: "An answer to the explain" }).first().waitFor({ timeout: 10_000 }).catch(() => note(where, "Explain this code", "its answer did not show under the code"));
    await look("Explain this code");
  } else note(where, "Explain this code", "no code view open with the button");

  // ── One room on this page (docs/MCP.md §5): no Explore / Learn switch ──
  if (await page.locator(".top .rooms").count()) note("top bar", "the room switch", "it shows on the Claude page, where Learn only says it isn't there");

  // ── Every panel: its tab, every button in it, and the header icons ──
  const clickAll = async (scope, label) => {
    const sel = "button:visible";
    const n = await scope.locator(sel).count();
    for (let i = 0; i < n; i++) {
      const c = scope.locator(sel).nth(i);
      if (!(await c.count())) break;
      const name = ((await c.getAttribute("aria-label")) || (await c.innerText().catch(() => "")) || (await c.getAttribute("title")) || "button").trim().replace(/\s+/g, " ").slice(0, 50);
      if (await c.isDisabled().catch(() => true)) continue;
      if (DANGER.test(name) || HEAVY.test(name)) {
        skipped.push(`${where}: "${name}"`);
        continue;
      }
      try {
        await c.click({ timeout: 3000 });
        await look(`${label}: "${name}"`);
      } catch (e) {
        note(where, `could not use "${name}"`, String(e).split("\n")[0]);
      }
      if (await page.locator("dialog[open]").count()) {
        const no = page.locator("dialog[open]").getByRole("button", { name: /not now|close|cancel/i }).first();
        if (await no.isVisible().catch(() => false)) await no.click();
        else await page.keyboard.press("Escape");
      }
    }
  };
  const tabNames = (await page.locator(".dv-tab").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
  for (const t of [...new Set(tabNames)]) {
    where = `panel ${t}`;
    const tab = page.locator(".dv-tab", { hasText: t }).first();
    if (!(await tab.isVisible().catch(() => false))) continue;
    await tab.click();
    await look(`the ${t} tab`);
    const group = page.locator(".dv-groupview", { has: page.locator(".dv-tab.dv-active-tab", { hasText: t }) }).first();
    const body = group.locator(".dv-content-container").first();
    if (await body.count()) await clickAll(body, t);
    // The header's own icons: split, pop out (its window is checked and closed), maximize twice.
    const icons = group.locator(".dv-right-actions-container button:visible, .dv-tabs-and-actions-container [aria-label]:visible");
    for (let i = 0; i < (await icons.count()); i++) {
      const ic = icons.nth(i);
      const name = ((await ic.getAttribute("aria-label")) || (await ic.getAttribute("title")) || "icon").trim();
      if (DANGER.test(name)) continue;
      await ic.click({ timeout: 3000 }).catch((e) => note(where, `header icon "${name}"`, String(e).split("\n")[0]));
      await look(`${t}: header "${name}"`);
      if (/maxim|full/i.test(name)) await ic.click({ timeout: 3000 }).catch(() => {});
    }
  }

  // ── Files: a folder opened, a file opened in the code view ──
  where = "Files";
  await page.locator(".dv-tab", { hasText: "Files" }).first().click().catch(() => {});
  await clickText("^\\W*lib/?$");
  await page.waitForTimeout(400);
  if (await clickText("^\\W*auth\\.ts")) {
    await look("opening lib/auth.ts from Files");
  } else {
    note(where, "lib/auth.ts", `not found in the Files tree (screenshot: ${await shot("files")})`);
  }

  // ── The code view: lines selected and explained, Edit, Save, Reset, Run, Debug, Run on ──
  where = "code view";
  const editor = page.locator(".ide .cm-content:visible").first();
  if (await editor.isVisible().catch(() => false)) {
    // Lines 1-3 selected in the editor itself (a synthetic mouse drag doesn't select in CodeMirror).
    await page.evaluate(() => {
      const c = [...document.querySelectorAll(".ide .cm-content")].find((e) => e.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) ?? !!e.offsetParent);
      const v = c?.cmTile?.view ?? c?.cmView?.view;
      if (v) v.dispatch({ selection: { anchor: 0, head: v.state.doc.line(Math.min(3, v.state.doc.lines)).to } });
    });
    const lines = page.getByRole("button", { name: /^Explain lines/ }).first();
    if (await lines.isVisible().catch(() => false)) {
      await lines.click();
      await page.locator(".ide .ask .help", { hasText: "An answer to the explain" }).first().waitFor({ timeout: 10_000 }).catch(() => note(where, "Explain lines", "its answer did not show"));
      await look("Explain lines");
    } else note(where, "Explain lines", "selecting lines did not offer it");
    if (await clickText("^\\W*Edit$")) {
      await page.waitForTimeout(600);
      // A line typed at the end through the editor, then Ctrl+S as a person saves.
      await page.evaluate(() => {
        const c = [...document.querySelectorAll(".ide .cm-content")].find((e) => e.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) ?? !!e.offsetParent);
        const v = c?.cmTile?.view ?? c?.cmView?.view;
        if (v) {
          v.dispatch({ changes: { from: v.state.doc.length, insert: "\n// sweep" } });
          v.focus();
        }
      });
      // Into the editor with the real mouse (the last line), then Ctrl+S, as a person saves.
      // The middle of the second line of the code shown (the one being edited), clicked like a person.
      const spot = await page.evaluate(() => {
        const c = [...document.querySelectorAll(".ide .cm-content")].find((e) => e.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }));
        // The middle of what the editor shows right now (it may have scrolled), checked to be code.
        const r = c?.closest(".cm-scroller")?.getBoundingClientRect();
        if (!r) return null;
        const x = r.x + r.width / 2;
        const y = r.y + r.height / 2;
        const at = document.elementFromPoint(x, y);
        return { x, y, hit: `${at?.className}${c.contains(at) ? " (in the code)" : " (not the code)"}` };
      });
      if (spot) await page.mouse.click(spot.x, spot.y);
      const typedBefore = await page.evaluate(() => [...document.querySelectorAll(".ide .cm-content")].find((e) => e.getAttribute("aria-label") === "Code: lib/auth.ts")?.textContent.length ?? -1);
      await page.keyboard.type("Q");
      const typedAfter = await page.evaluate(() => [...document.querySelectorAll(".ide .cm-content")].find((e) => e.getAttribute("aria-label") === "Code: lib/auth.ts")?.textContent.length ?? -1);
      if (typedAfter === typedBefore) note(where, "typing after a click in the code", `nothing went in (click hit ${spot?.hit}; focus on ${await page.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.className}`)})`);
      else await page.keyboard.press("Backspace");
      const focusAtSave = await page.evaluate(() => { const a = document.activeElement; return `${a?.tagName.toLowerCase()} ${a?.getAttribute("aria-label") ?? a?.className ?? ""}`; });
      // The save key as the platform has it: Ctrl+S, or ⌘S on a Mac (CodeMirror's Mod-s).
      await page.keyboard.press("ControlOrMeta+s");
      await look("Edit, a line typed, Ctrl+S");
      await page.waitForTimeout(800);
      const onDisk = () => readFileSync(join(project, "lib", "auth.ts"), "utf8").includes("// sweep");
      if (!onDisk()) {
        await clickText("^Save");
        await look("the Save button");
        await page.waitForTimeout(800);
        const state = await page.evaluate(() => {
          const views = [...document.querySelectorAll(".ide .cm-content")].map((c) => ({ shown: !!c.offsetParent, editable: c.getAttribute("contenteditable"), label: c.getAttribute("aria-label"), typed: (c.cmTile?.view ?? c.cmView?.view)?.state.doc.toString().includes("// sweep") ?? null }));
          const save = [...document.querySelectorAll("button")].filter((b) => /^Save/.test(b.textContent.trim())).map((b) => ({ shown: !!b.offsetParent, disabled: b.disabled }));
          return JSON.stringify({ views, save });
        });
        note(where, "Ctrl+S", `${onDisk() ? "did not save (the Save button did)" : "neither Ctrl+S nor the Save button changed the file on disk"}; focus was on ${focusAtSave}; ${state}`);
      }
      await clickText("^Done editing$");
    } else note(where, "Edit", "no Edit button");
    for (const name of ["Reset code", "Run", "Debug"]) {
      const b = page.getByRole("button", { name: new RegExp(`^${name}`) }).first();
      if (!(await b.isVisible().catch(() => false)) || (await b.isDisabled())) continue;
      await b.click();
      await look(`the code view's ${name}`);
      if (await page.locator("dialog[open]").count()) await page.locator("dialog[open]").getByRole("button", { name: /not now/i }).first().click().catch(() => page.keyboard.press("Escape"));
    }
    const runOn = page.locator(".ide select").first();
    if (await runOn.isVisible().catch(() => false)) {
      for (const v of await runOn.evaluate((s) => [...s.options].map((o) => o.value))) {
        await runOn.selectOption(v);
        await look(`Run on "${v}"`);
        if (await page.locator("dialog[open]").count()) await page.locator("dialog[open]").getByRole("button", { name: /not now/i }).first().click().catch(() => page.keyboard.press("Escape"));
      }
    }
  } else note(where, "the editor", "no code view to try");

  // ── The guide: Talk (a question heard), read aloud, a citation ──
  where = "guide";
  await page.locator(".dv-tab", { hasText: "Guide" }).first().click().catch(() => {});
  const before = answered.length;
  if (await clickText("^\\W*Talk$")) {
    await page.waitForTimeout(800);
    await page.evaluate(() => window.__speak?.("how does login work"));
    for (let i = 0; i < 40 && answered.length === before; i++) await page.waitForTimeout(250);
    await look("Talk, a spoken question");
    if (answered.length === before) note(where, "Talk", "the spoken question did not reach the AI app");
    await page.keyboard.press("Escape");
  } else note(where, "Talk", `no Talk button (screenshot: ${await shot("talk")})`);
  const aloud = page.getByRole("button", { name: /read aloud/i }).first();
  if (await aloud.isVisible().catch(() => false)) {
    await aloud.click();
    await look("read aloud");
  }
  const cite = page.locator(".guide button.cite, button.cite").first();
  if (await cite.isVisible().catch(() => false)) {
    await cite.click();
    await look("a citation");
  }

  // ── Ctrl+K: the go-to bar ──
  where = "go-to bar";
  await page.keyboard.press("Control+k");
  await page.keyboard.type("auth");
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter");
  await look("Ctrl+K, auth, Enter");
  await page.keyboard.press("Escape");

  // ── Set up and source control, with this computer allowed (the throwaway home) ──
  where = "set up";
  await page.locator(".setup-pill").first().click();
  const allow = page.getByRole("button", { name: "Allow on this computer" }).first();
  if (await allow.isVisible().catch(() => false)) await allow.click();
  await page.locator(".setup-sheet").first().waitFor({ timeout: 10_000 }).catch(() => note(where, "the sheet", "it did not open after allowing"));
  await page.waitForTimeout(4000);
  await look("the setup sheet, checks done");
  const sheet = page.locator(".setup-sheet").first();
  if (await sheet.count()) await clickAll(sheet, "setup sheet");
  await page.keyboard.press("Escape");
  where = "source control";
  await page.locator(".git-btn").first().click().catch(() => {});
  await page.waitForTimeout(1500);
  await look("source control");
  const git = page.locator(".git-sheet, [class*=git-]").filter({ has: page.locator("button") }).first();
  if (await git.count()) await clickAll(git, "source control");
  await page.keyboard.press("Escape");

  // ── The terminal: one harmless command ──
  where = "terminal";
  // The terminal button toggles: open it only when no terminal is showing.
  if (!(await page.evaluate(() => [...document.querySelectorAll(".xterm")].some((e) => e.offsetParent)))) await page.locator(".term-btn").first().click().catch(() => {});
  await page.waitForTimeout(1000);
  // Asked first when this computer isn't allowed yet (the throwaway home): allow it.
  const allowTerm = page.locator("dialog[open]").getByRole("button", { name: "Allow on this computer" }).first();
  if (await allowTerm.isVisible().catch(() => false)) await allowTerm.click();
  await page.waitForTimeout(3000);
  // The output area may be on its Output tab: the Terminal tab next to it.
  await clickText("^Terminal$");
  await page.waitForTimeout(1500);
  // The visible terminal (another can sit hidden in a closed group). Its prompt must be on one line: a
  // shell told a narrow width while the panel opened keeps the prompt wrapped there.
  const rows = () => page.evaluate(() => { const x = [...document.querySelectorAll(".xterm")].find((e) => e.offsetParent && e.getBoundingClientRect().width > 0); return x ? [...x.querySelectorAll(".xterm-rows > div")].map((r) => r.textContent.trimEnd()) : []; });
  await page.waitForFunction(() => [...document.querySelectorAll(".xterm")].some((e) => e.offsetParent && /PS |\$ |> $/.test(e.textContent)), null, { timeout: 15_000 }).catch(() => {});
  const shown = (await rows()).filter(Boolean);
  if (!shown.length) await shot("terminal");
  // The prompt wraps at the panel's real width: a full first row when it wraps at all. A shell told a
  // narrow width while the panel opened wraps it short, however wide the panel is.
  const cols = await page.evaluate(() => {
    const x = [...document.querySelectorAll(".xterm")].find((e) => e.checkVisibility?.());
    const m = x?.querySelector(".xterm-char-measure-element");
    const w = m ? m.getBoundingClientRect().width / Math.max(1, m.textContent.length) : 0;
    return w ? Math.floor(x.querySelector(".xterm-screen").getBoundingClientRect().width / w) : 0;
  });
  // PowerShell "PS …>", bash "$" or "#", zsh "%" (the macOS default).
  const promptAt = shown.findIndex((r) => /^PS .*>\s*$|[$#>%]\s*$/.test(r));
  if (promptAt < 0) note(where, "the prompt", `none showed: ${JSON.stringify(shown.slice(0, 3))}`);
  else if (promptAt > 0 && cols && shown[0].length < cols - 3) note(where, "the prompt", `wrapped at ${shown[0].length} of ${cols} columns: ${JSON.stringify(shown.slice(0, promptAt + 1))}`);
  await page.locator(".xterm:visible").first().click().catch(() => {});
  await page.keyboard.type("echo sweep-ok");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => [...document.querySelectorAll(".xterm")].some((e) => e.offsetParent && (e.querySelector(".xterm-rows")?.textContent ?? "").split("sweep-ok").length > 2), null, { timeout: 10_000 }).catch(async () => note(where, "echo sweep-ok", `the output did not come back; the terminal showed ${JSON.stringify((await rows()).filter(Boolean).slice(-6))}; its tabs: ${await page.evaluate(() => [...document.querySelectorAll("[class*=term-tab], .lr-term-tabs")].map((t) => t.textContent.trim()).join(" | ").slice(0, 160))}`));
  await look("echo in the terminal");

  // ── A phone: nothing wider than the screen, in the bar and in every Settings tab ──
  where = "phone (390 px)";
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(800);
  // Only what is on screen: hidden panels keep their old size, and a scrolling box may hold wide content.
  const wide = () =>
    page.evaluate(() => {
      const shown = (e) => { for (let p = e; p; p = p.parentElement) { const s = getComputedStyle(p); if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false; } return true; };
      const scrolls = (e) => { for (let p = e.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll") return true; } return false; };
      return [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 && shown(e) && !scrolls(e) && !e.closest(".react-flow, .cm-editor, .xterm, [role=tablist], .dv-tabs-container"); }).slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join(".")} ends at ${Math.round(e.getBoundingClientRect().right)}px`);
    });
  for (const w of await wide()) note(where, "the page", w);
  await page.locator('.top [aria-label="Settings"], .top [data-testid="claude-status"]').first().click().catch(() => {});
  for (const tabName of tabs.map((t) => t.trim()).filter(Boolean)) {
    await page.locator(".setv [role=tab]", { hasText: tabName }).first().click().catch(() => {});
    await page.waitForTimeout(400);
    for (const w of await wide()) note(where, `Settings → ${tabName}`, w);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // ── The start screen, from the logo: back to the map, and a folder opened here ──
  // ("Choose folder…" opens the system's own dialog on the desktop: tried by hand, not here.)
  where = "start screen";
  await page.locator(".top .brand").first().click();
  await page.locator(".mcp-start").first().waitFor({ timeout: 10_000 }).catch(() => note(where, "the logo", "the start screen did not open"));
  await look("the logo");
  if (await clickText("^Back to the map")) {
    await page.locator(".react-flow__node").first().waitFor({ timeout: 10_000 }).catch(() => note(where, "Back to the map", "the map did not come back"));
  } else {
    const back = page.getByRole("link", { name: /^Back to the map/ }).first();
    if (await back.isVisible().catch(() => false)) {
      await back.click();
      await page.locator(".react-flow__node").first().waitFor({ timeout: 10_000 }).catch(() => note(where, "Back to the map", "the map did not come back"));
    } else note(where, "Back to the map", "no way back to the map from the start screen");
  }
  await look("Back to the map");
  await page.locator(".top .brand").first().click();
  await page.locator("#mcp-folder").fill(join(project, "lib"));
  await page.getByRole("button", { name: "Open it here" }).click();
  await page.locator(".proj-name", { hasText: "lib" }).first().waitFor({ timeout: 20_000 }).catch(() => note(where, "Open it here", "the map of the folder did not open"));
  await look("Open it here");

  // ── The server stops (its Claude session ended): every save should say so, in words ──
  where = "server stopped";
  listening = false;
  await client.close().catch(() => {});
  // The page says so after 8 s of not reaching it, and the strip waits 5 s more.
  await page.waitForTimeout(16_000);
  await look("the server stopping");
  if (!(await page.locator(".claude-alert", { hasText: "isn't running" }).count())) note(where, "the strip", "it does not say the server isn't running");
  await page.locator('.top [aria-label="Settings"]').first().click().catch(() => {});
  for (const [tabName, buttons] of [
    ["Voice", ["Lightning lecturer", "Free voice", "Save voice"]],
    ["AI model", []],
    ["This computer", []],
  ]) {
    await page.locator(".setv [role=tab]", { hasText: tabName }).first().click().catch(() => {});
    await look(`opening ${tabName} with the server gone`);
    for (const name of buttons) {
      const b = page.locator(".setv button", { hasText: name }).first();
      if (!(await b.isVisible().catch(() => false))) continue;
      await b.click();
      await look(`clicking "${name}" with the server gone`);
    }
  }
} catch (e) {
  note("sweep", `stopped early in ${globalThis.__where ?? "?"} after ${globalThis.__after ?? "?"}`, e?.stack ?? String(e));
} finally {
  await browser?.close().catch(() => {});
  await client.close().catch(() => {});
  rmSync(home, { recursive: true, force: true });
  rmSync(dirname(project), { recursive: true, force: true });
}

// Network errors are expected once the server has stopped; the words on screen are what is checked then.
const shown = findings.filter((f) => !(f.area === "server stopped" && /request failed|console error/.test(f.what)));
console.log(`\n${used.length} actions checked; answered by the stand-in AI app: ${answered.join(", ") || "nothing"}`);
if (process.env.SWEEP_LIST) console.log(used.map((u) => `  · ${u}`).join("\n"));
if (skipped.length) console.log(`\nNot clicked (they remove or reset something):\n  ${skipped.join("\n  ")}`);
if (!shown.length) {
  console.log("\nsweep passed: every control used, nothing went wrong");
} else {
  console.log(`\nsweep found ${shown.length} problem(s):`);
  for (const f of shown) console.log(`  ✖ [${f.area}] ${f.what}\n      ${(f.area === "sweep" ? f.detail.split("\n").slice(0, 8).join("\n      ") : f.detail.split("\n")[0]).slice(0, 1200)}`);
  if (logs.trim()) console.log(`\nserver log (last lines):\n${logs.trim().split("\n").slice(-12).join("\n")}`);
  process.exitCode = 1;
}
