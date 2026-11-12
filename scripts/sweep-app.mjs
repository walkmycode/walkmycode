// npm run sweep:app: every control of the WalkMyCode app (the web app, `next dev`), clicked, with what
// went wrong listed. Its own dev server on its own port, a throwaway WALKMYCODE_HOME (settings and keys:
// yours are never touched), a stand-in AI (an OpenAI-compatible server picked as "Local", so the guide,
// the code view and Learn get answers with no key and no cost), and the bundled example project.
// Then the dev server stops and the saves are tried again.
// After each action it looks for page errors, console errors, failed requests and raw technical words on
// screen. Controls that remove, reset, install, commit or push are listed, not clicked.
// Exit code 1 when anything was found. SWEEP_LIST=1 prints every action.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.SWEEP_PORT ?? 3123);
const BASE = `http://localhost:${PORT}`;

const RAW = /Failed to fetch|TypeError|ReferenceError|SyntaxError|\bundefined\b|\bNaN\b|\[object Object\]|is not a function|Cannot read propert|Unexpected token|ECONNREFUSED|NetworkError/;
const DANGER = /remove|delete|revoke|turn off|reset(?! code)|sign out|log out|clear|forget|stop sharing|discard/i;
/** Buttons that move whole groups (float, pop out): tried once on their own below, not in the general pass. */
const MOVES = /float this group|pop this group out|dock this group back|maximi[sz]e or restore|^close tab$/i;
const HEAVY = /^(set up|build it|install|commit|push|pull|sync|publish|create|start)\b|set up \w+$/i;

const findings = [];
const skipped = [];
const used = [];
const note = (area, what, detail) => findings.push({ area, what, detail: String(detail) });

// ── The stand-in AI: any chat request gets a short answer back, streamed or not ──
const REPLY = "This is the stand-in answer: **bold** and `code`.\n\n- one\n- two";
const ai = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url?.endsWith("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ object: "list", data: [{ id: "stand-in", object: "model" }] }));
    }
    if (!req.url?.endsWith("/chat/completions")) return res.writeHead(404).end();
    const stream = (() => {
      try {
        return JSON.parse(body).stream;
      } catch {
        return false;
      }
    })();
    const base = { id: "c1", created: 0, model: "stand-in" };
    if (!stream) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ...base, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: REPLY }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = (delta, finish = null) => res.write(`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    chunk({ role: "assistant", content: REPLY });
    chunk({}, "stop");
    res.write(`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => ai.listen(0, "127.0.0.1", r));
const aiPort = ai.address().port;

const home = mkdtempSync(join(tmpdir(), "walkmycode-app-sweep-"));
mkdirSync(join(home, ".walkmycode"), { recursive: true });
writeFileSync(join(home, ".walkmycode", "config.json"), JSON.stringify({ provider: "local", model: "stand-in", local_base_url: `http://127.0.0.1:${aiPort}/v1` }));

// ── The app's own dev server ──
let devLog = "";
const dev = spawn(process.execPath, [join(root, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", String(PORT)], {
  cwd: root,
  env: { ...process.env, WALKMYCODE_HOME: home, NEXT_TELEMETRY_DISABLED: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
dev.stdout.on("data", (d) => (devLog += d));
dev.stderr.on("data", (d) => (devLog += d));
const stopDev = () =>
  new Promise((done) => {
    if (dev.exitCode !== null) return done();
    dev.once("exit", done);
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(dev.pid), "/T", "/F"], { stdio: "ignore" });
    else dev.kill("SIGTERM");
  });

let browser;
try {
  for (let i = 0; i < 120; i++) {
    const ok = await fetch(BASE).then((r) => r.ok).catch(() => false);
    if (ok) break;
    if (i === 119) throw new Error(`the dev server did not answer on ${BASE}:\n${devLog.slice(-1500)}`);
    await new Promise((r) => setTimeout(r, 1000));
  }

  browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() => chromium.launch({ headless: true }));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await context.addInitScript(() => {
    const synth = { speaking: false, pending: false, paused: false, getVoices: () => [], speak: (u) => setTimeout(() => u.onend?.({}), 20), cancel() {}, pause() {}, resume() {}, addEventListener() {}, removeEventListener() {} };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    window.SpeechSynthesisUtterance = class {
      constructor(t) {
        this.text = t;
      }
    };
    window.SpeechRecognition = window.webkitSpeechRecognition = class {
      start() {
        window.__rec = this;
      }
      stop() {}
      abort() {}
    };
    // In the dock a shown panel can still compute visibility: hidden for a moment while it lays out, and a
    // hidden tab's content keeps its size: so "visible" means the element is what is under its own middle.
    window.__vis = (e) => {
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      const x = Math.min(Math.max(r.x + r.width / 2, 0), innerWidth - 1);
      const y = Math.min(Math.max(r.y + r.height / 2, 0), innerHeight - 1);
      const at = document.elementFromPoint(x, y);
      return !!at && (at === e || e.contains(at) || at.contains(e));
    };
    window.__speak = (t) => window.__rec?.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: t }], { isFinal: true })] });
  });
  const page = await context.newPage();
  context.on("page", async (p) => {
    if (p === page || where === "moving a group") return;
    p.on("pageerror", (e) => note("pop-out window", "page error", e));
    await p.waitForTimeout(1500).catch(() => {});
    // As a person closes it (the browser fires beforeunload, which is how the panels go back).
    await p.close({ runBeforeUnload: true }).catch(() => {});
  });
  let where = "loading";
  let after = "";
  page.on("pageerror", (e) => note(where, `page error after ${after}`, e));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // The dev server's own reload channel and the icon are not the app.
    if (/favicon|status of 404|_next\/webpack-hmr|\/_next\/hmr|WebSocket connection/.test(t)) return;
    note(where, `console error after ${after}`, t);
  });
  page.on("response", async (r) => {
    const p = new URL(r.url()).pathname;
    if (r.status() < 400 || /favicon|__nextjs/.test(p)) return;
    const [w, a] = [where, after];
    const body = await r.text().catch(() => "");
    note(w, `HTTP ${r.status()} after ${a}`, `${r.request().method()} ${p} → ${body.slice(0, 300)}`);
  });

  const rawOnScreen = () =>
    page.evaluate((src) => {
      const re = new RegExp(src);
      const out = [];
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const el = n.parentElement;
        if (!el || el.closest(".cm-editor, .react-flow, .xterm, pre, code, .snippet, script, style, nextjs-portal")) continue;
        if (!(el.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) ?? !!el.offsetParent)) continue;
        const t = n.textContent.trim();
        if (t && re.test(t)) out.push(t.slice(0, 160));
      }
      return out;
    }, RAW.source);
  const seenRaw = new Set();
  const look = async (label) => {
    after = label;
    used.push(`${where}: ${label}`);
    await page.waitForTimeout(700);
    for (const t of await rawOnScreen()) {
      if (seenRaw.has(t)) continue;
      seenRaw.add(t);
      note(where, `raw text on screen after ${label}`, t);
    }
  };
  const shot = async (name) => {
    const f = join(tmpdir(), `walkmycode-app-sweep-${name}.png`);
    await page.screenshot({ path: f }).catch(() => {});
    return f;
  };
  /** Click the first visible button or link whose text matches; tried for up to 2 s (panels fade in). */
  const clickText = async (src, sel = "button") => {
    for (let i = 0; i < 10; i++) {
      const hit = await page.evaluate(
        ([src, sel]) => {
          const re = new RegExp(src);
          // As a person would: a match below the fold is scrolled to, then clicked if it is what shows there.
          for (const e of document.querySelectorAll(sel)) {
            if (!re.test(e.textContent.trim()) || !e.getBoundingClientRect().width) continue;
            if (!window.__vis(e)) e.scrollIntoView({ block: "center" });
            if (window.__vis(e)) {
              e.click();
              return true;
            }
          }
          return false;
        },
        [src, sel],
      );
      if (hit) return true;
      await page.waitForTimeout(200);
    }
    return false;
  };
  const closeDialogs = async () => {
    if (!(await page.locator("dialog[open]").count())) return;
    if (!(await clickText("^(Not now|Close|Cancel)$"))) await page.keyboard.press("Escape").catch(() => {});
  };
  /** Every visible button in a part of the page, the risky ones listed instead. */
  const clickAll = async (scope, label) => {
    const marked = await scope.evaluate((root) => {
      const out = [];
      [...root.querySelectorAll("button")].forEach((e, i) => {
        if (!window.__vis(e) || e.disabled) return;
        e.dataset.sweep = String(i);
        out.push({ i, name: (e.getAttribute("aria-label") || e.textContent || e.title || "button").trim().replace(/\s+/g, " ").slice(0, 50) });
      });
      return out;
    });
    for (const { i, name } of marked) {
      if (MOVES.test(name)) continue;
      if (DANGER.test(name) || HEAVY.test(name)) {
        skipped.push(`${where}: "${name}"`);
        continue;
      }
      const c = page.locator(`[data-sweep="${i}"]`).first();
      if (!(await c.count())) continue;
      try {
        await c.click({ timeout: 3000, force: true });
        await look(`${label}: "${name}"`);
      } catch (e) {
        note(where, `could not use "${name}"`, String(e).split("\n")[0]);
      }
      await closeDialogs();
    }
    await page.evaluate(() => document.querySelectorAll("[data-sweep]").forEach((e) => delete e.dataset.sweep)).catch(() => {});
  };
  const wide = () =>
    page.evaluate(() => {
      const shown = (e) => e.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) ?? true;
      const scrolls = (e) => {
        for (let p = e.parentElement; p; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX;
          if (o === "auto" || o === "scroll") return true;
        }
        return false;
      };
      return [...document.querySelectorAll("body *")]
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.right > innerWidth + 1 && shown(e) && !scrolls(e) && !e.closest(".react-flow, .cm-editor, .xterm, [role=tablist], .dv-tabs-container, nextjs-portal");
        })
        .slice(0, 3)
        .map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join(".")} "${(e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 40)}" in .${[...(e.parentElement?.classList ?? [])].join(".")} ends at ${Math.round(e.getBoundingClientRect().right)}px`);
    });

  // ── Home ──
  where = "home";
  await page.goto(BASE);
  await page.waitForLoadState("networkidle").catch(() => {});
  await look("loading the home page");
  for (const w of await wide()) note(where, "the page at 1440 px", w);

  // ── Set up AI: every option, chip and button in the sheet ──
  where = "set up AI";
  if (!(await clickText("^\\W*Set up AI$"))) {
    await page.locator(".ai-pill").first().click().catch(() => note(where, "the AI pill", "not found"));
    await page.waitForTimeout(800);
    if (!(await clickText("^Change$"))) note(where, "Settings → AI model", "no Change button to open the setup sheet");
  }
  await page.locator(".setup").first().waitFor({ timeout: 10_000 }).catch(() => note(where, "the sheet", "did not open"));
  for (const opt of ["claude", "key", "local"]) {
    await page.locator(`[data-opt="${opt}"] button`).first().click().catch(() => {});
    await look(`option ${opt}`);
    const sheet = page.locator(".setup").first();
    if (await sheet.count()) await clickAll(sheet.locator(`[data-opt="${opt}"]`), `option ${opt}`);
  }
  await page.keyboard.press("Escape");

  // ── The example project, and the room around it (from the home page itself: Settings may be showing) ──
  where = "home";
  await page.goto(BASE);
  await page.waitForLoadState("networkidle").catch(() => {});
  if (!(await clickText("Team Tasks", "a, button"))) note(where, "the example project", "no Team Tasks to open");
  await page.locator(".react-flow__node").first().waitFor({ timeout: 60_000 }).catch(async () => note(where, "the example project", `the map did not draw (screenshot: ${await shot("example")})`));
  await look("opening the example project");

  // ── Settings: every tab, every control ──
  where = "settings";
  await page.locator('.top [aria-label="Settings"]').first().click();
  await page.waitForTimeout(800);
  const tabs = (await page.locator(".setv [role=tab]").allInnerTexts()).map((t) => t.trim()).filter(Boolean);
  for (const tabName of tabs) {
    where = `Settings → ${tabName}`;
    await page.locator(".setv [role=tab]", { hasText: tabName }).first().click();
    await look(`opening ${tabName}`);
    const pane = page.locator(".setv").first();
    const sel = "button:visible, select:visible, input[type=checkbox]:visible, input[type=radio]:visible";
    const count = await pane.locator(sel).count();
    for (let i = 0; i < count; i++) {
      const c = pane.locator(sel).nth(i);
      if (!(await c.count())) break;
      const tag = await c.evaluate((e) => e.tagName.toLowerCase());
      const label = ((await c.getAttribute("aria-label")) || (await c.innerText().catch(() => "")) || (await c.getAttribute("title")) || tag).trim().replace(/\s+/g, " ").slice(0, 50);
      if ((await c.getAttribute("role")) === "tab" && tabs.includes(label)) continue;
      if (await c.isDisabled().catch(() => true)) continue;
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
      await closeDialogs();
      if (await page.locator(".setup").count()) await page.keyboard.press("Escape");
      if (!(await page.locator(".setv").count())) {
        await page.locator('.top [aria-label="Settings"]').first().click();
        await page.locator(".setv [role=tab]", { hasText: tabName }).first().click();
      }
    }
  }

  // ── The top bar ──
  where = "top bar";
  await page.locator(".proj-chip").click().catch(() => note(where, "the project chip", "not found"));
  await look("the project chip");
  if (!(await page.locator(".proj-card").isVisible().catch(() => false))) note(where, "the project chip", "its card did not open");
  await page.keyboard.press("Escape");
  const layout = page.locator(".layout-menu > button");
  if (await layout.count()) {
    await layout.click();
    const items = await page.locator("#layout-menu [role=menuitem], #layout-menu button").allInnerTexts();
    await page.keyboard.press("Escape");
    for (const [i, it] of items.entries()) {
      if (!(await page.locator("#layout-menu").isVisible().catch(() => false))) await layout.click();
      await page.locator("#layout-menu [role=menuitem], #layout-menu button").nth(i).click();
      await look(`layout "${it.split("\n")[0]}"`);
      if (await page.locator("#layout-menu").isVisible().catch(() => false)) await page.keyboard.press("Escape");
    }
  }
  for (const s of [".git-btn", ".cost"]) {
    const b = page.locator(s).first();
    if (!(await b.isVisible().catch(() => false))) continue;
    await b.click().catch(() => {});
    await look(`the ${s.slice(1)} button`);
    await closeDialogs();
    await page.keyboard.press("Escape");
  }

  // ── Every panel: its tab, the buttons in it, its header icons ──
  const tabNames = [...new Set((await page.locator(".dv-tab").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean))];
  for (const t of tabNames) {
    where = `panel ${t}`;
    const tab = page.locator(".dv-tab", { hasText: t }).first();
    if (!(await tab.isVisible().catch(() => false))) continue;
    await tab.click();
    await look(`the ${t} tab`);
    const body = page.locator(".dv-groupview", { has: page.locator(".dv-tab.dv-active-tab", { hasText: t }) }).first();
    if (t !== "Settings" && (await body.count())) await clickAll(body, t);
  }

  // ── Moving a group: floated and docked back; popped out and its window closed, the panel comes home ──
  where = "moving a group";
  if (await clickText(".", '[aria-label="Float this group"]')) {
    await look("Float this group");
    if (!(await clickText(".", '[aria-label="Dock this group back"]'))) note(where, "Dock this group back", "no way to dock the floated group back");
    await look("Dock this group back");
  }
  const before = (await page.locator(".dv-tab").allInnerTexts()).map((t) => t.trim()).sort();
  const popped = context.waitForEvent("page", { timeout: 10_000 }).catch(() => null);
  if (await clickText(".", '[aria-label="Pop this group out into a window"]')) {
    const win = await popped;
    await look("Pop this group out");
    if (!win) note(where, "Pop this group out", "no window opened");
    else {
      await win.waitForTimeout(1500).catch(() => {});
      await win.close({ runBeforeUnload: true }).catch(() => {});
      await page.waitForTimeout(2500);
      const back = (await page.locator(".dv-tab").allInnerTexts()).map((t) => t.trim()).sort();
      if (JSON.stringify(back) !== JSON.stringify(before)) note(where, "closing the popped-out window", `the panels did not all come back: before ${JSON.stringify(before)}, after ${JSON.stringify(back)}`);
      await look("closing the popped-out window");
    }
  }

  // ── Files: the first folder opened, the first file in it opened in the code view ──
  where = "Files";
  await page.locator(".dv-tab", { hasText: "Files" }).first().click().catch(() => {});
  const opened = await page.evaluate(() => {
    const vis = (e) => window.__vis(e);
    const folder = [...document.querySelectorAll("button")].find((b) => vis(b) && /^▸ \w[\w.-]*\/$/.test(b.textContent.trim()) && b.textContent.includes("app/"));
    folder?.click();
    return !!folder;
  });
  await page.waitForTimeout(500);
  const file = await clickText("^\\W*page\\.tsx");
  if (!opened || !file) note(where, "app/page.tsx", `not opened from the tree (screenshot: ${await shot("files")})`);
  await look("opening app/page.tsx");

  await shot("after-files");
  // ── The code view: lines explained (the stand-in answers), Edit, typing, Save ──
  where = "code view";
  await page.waitForTimeout(1500);
  const editorIn = () =>
    page.evaluate(() => {
      document.querySelectorAll("[data-sweep-ed]").forEach((e) => delete e.dataset.sweepEd);
      const c = [...document.querySelectorAll(".cm-content")].find((e) => [...e.querySelectorAll(".cm-line")].some((l) => window.__vis(l)));
      if (c) c.dataset.sweepEd = "1";
      return !!c;
    });
  if (await editorIn()) {
    const lines = page.locator("[data-sweep-ed] .cm-line");
    await lines.nth(0).click({ position: { x: 4, y: 4 } });
    await lines.nth(2).click({ modifiers: ["Shift"] });
    await page.waitForTimeout(400);
  } else note(where, "the code", `no editor in view (screenshot: ${await shot("no-editor")})`);
  if (await clickText("^Explain lines")) {
    await page.locator(".ide .ask .help", { hasText: "stand-in answer" }).first().waitFor({ timeout: 20_000 }).catch(async () => note(where, "Explain lines", `the answer did not show (screenshot: ${await shot("explain")})`));
    await look("Explain lines");
  } else note(where, "Explain lines", `selecting lines did not offer it (screenshot: ${await shot("explain-lines")})`);
  if (await clickText("^\\W*Edit$")) {
    await page.waitForTimeout(600);
    const dl = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
    if (await editorIn()) {
      await page.locator("[data-sweep-ed] .cm-line").first().click();
      await page.keyboard.press("Control+End");
      await page.keyboard.type("\n// sweep");
    }
    await clickText("^Save");
    await look("Edit, a line typed, Save");
    // The example lives in the browser: Save hands the file over as a download, and says so.
    if (!(await dl)) note(where, "Save", "nothing was saved or offered as a download");
    await clickText("^Done editing$");
  } else note(where, "Edit", "no Edit button");

  // ── The guide: a typed question, Talk ──
  where = "guide";
  await page.locator(".dv-tab", { hasText: "Guide" }).first().click().catch(() => {});
  let asked = false;
  for (let t = 0; t < 8 && !asked; t++) {
    if (t) await page.waitForTimeout(500);
    asked = await page.evaluate(() => {
      const i = [...document.querySelectorAll("form.ask input.field")].find((e) => window.__vis(e));
      if (i) i.dataset.sweepAsk = "1";
      return !!i;
    });
  }
  if (asked) {
    const ask = page.locator("[data-sweep-ask]").first();
    await ask.fill("What does this app do?");
    await ask.press("Enter");
    await page.getByText("stand-in answer", { exact: false }).first().waitFor({ timeout: 30_000 }).catch(async () => note(where, "a typed question", `no answer showed (screenshot: ${await shot("guide")})`));
    await look("a typed question");
  } else note(where, "the ask box", `not found (screenshot: ${await shot("ask")})`);
  if (await clickText("^\\W*Talk$")) {
    await page.waitForTimeout(800);
    await page.evaluate(() => window.__speak?.("what does this app do"));
    await page.waitForTimeout(3000);
    await look("Talk, a spoken question");
    await page.keyboard.press("Escape");
  } else note(where, "Talk", "no Talk button");

  // ── The terminal, this computer allowed ──
  where = "terminal";
  if (!(await page.locator(".term-btn").count()) && (await page.evaluate(() => localStorage.getItem("walkmycode.terminalButton"))) === "off") {
    await clickText("^Layout");
    await page.waitForTimeout(300);
    await clickText("^\\W*Terminal button", '[role="menuitemcheckbox"]');
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(300);
    await look("Layout ▾ → Terminal button, shown again");
  }
  if (!(await page.locator(".term-btn").count())) {
    const status = await page.evaluate(() => fetch("/api/localrun").then((r) => r.text()).catch((e) => String(e)));
    note(where, "the terminal button", `not in the top bar; /api/localrun says ${status.slice(0, 300)}`);
  }
  if (!(await page.evaluate(() => [...document.querySelectorAll(".xterm")].some((e) => window.__vis(e))))) await page.locator(".term-btn").first().click().catch(() => {});
  await page.waitForTimeout(1000);
  const allow = page.locator("dialog[open]").getByRole("button", { name: "Allow on this computer" }).first();
  if (await allow.isVisible().catch(() => false)) await allow.click();
  await page.waitForTimeout(2500);
  await clickText("^Terminal$");
  await page.waitForTimeout(1500);
  const rows = () =>
    page.evaluate(() => {
      const x = [...document.querySelectorAll(".xterm")].find((e) => window.__vis(e));
      return x ? [...x.querySelectorAll(".xterm-rows > div")].map((r) => r.textContent.trimEnd()) : [];
    });
  await page.locator(".xterm:visible").first().click().catch(() => {});
  await page.keyboard.type("echo sweep-ok");
  await page.keyboard.press("Enter");
  await page
    .waitForFunction(() => [...document.querySelectorAll(".xterm")].some((e) => window.__vis(e) && (e.querySelector(".xterm-rows")?.textContent ?? "").split("sweep-ok").length > 2), null, { timeout: 15_000 })
    .catch(async () => note(where, "echo sweep-ok", `the output did not come back; it showed ${JSON.stringify((await rows()).filter(Boolean).slice(-5))} (screenshot: ${await shot("terminal")})`));
  await look("echo in the terminal");

  // ── The Learn room: every button (a course asked of the stand-in, which isn't a lesson: said in words) ──
  where = "Learn";
  if (await clickText("^Learn$", "a")) {
    // Wait for the Learn room itself: on a cold dev server the page compiles first, and until then the map
    // page (with its tool strips) is still on screen; clicking its buttons by mistake hid the map in CI.
    await page.waitForURL(/\/learn/, { timeout: 60_000 }).catch(() => {});
    const room = page.locator(".learn").first();
    if (await room.waitFor({ timeout: 60_000 }).then(() => true, () => false)) {
      await look("opening Learn");
      await clickAll(room, "Learn");
    } else note(where, "the Learn room", `did not open (screenshot: ${await shot("learn")})`);
    await clickText("^Explore$", "a");
    await page.locator(".react-flow__node").first().waitFor({ timeout: 60_000 }).catch(() => note(where, "back to Explore", "the map did not come back"));
  } else note(where, "the Learn link", "not found");

  // ── A phone ──
  where = "phone (390 px)";
  // Narrow, the dock stacks into one group; the arrangement made wide comes back when it widens.
  const tabsNow = async () => (await page.locator(".dv-tab").allInnerTexts()).map((t) => t.trim()).sort().join(", ");
  const wideTabs = await tabsNow();
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(1000);
  const groups = await page.locator(".dv-groupview").count();
  if (groups !== 1) note(where, "the dock", `${groups} groups side by side on a phone, not one stack (screenshot: ${await shot("phone-dock")})`);
  for (const w of await wide()) note(where, "the room", w);
  await page.locator('.ai-pill').first().click().catch(() => {});
  await page.waitForTimeout(800);
  for (const tabName of tabs) {
    await page.locator(".setv [role=tab]", { hasText: tabName }).first().click().catch(() => {});
    await page.waitForTimeout(400);
    for (const w of await wide()) note(where, `Settings → ${tabName}`, w);
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(1000);
  const backTabs = await tabsNow();
  if (backTabs !== wideTabs) note("wide again", "the panels", `were [${wideTabs}], came back as [${backTabs}]`);

  // ── The dev server stops: saves say so in words ──
  where = "server stopped";
  await stopDev();
  await page.waitForTimeout(3000);
  await page.locator('.top [aria-label="Settings"]').first().click().catch(() => {});
  for (const [tabName, buttons] of [
    ["Voice", ["Save voice"]],
    ["AI model", []],
  ]) {
    await page.locator(".setv [role=tab]", { hasText: tabName }).first().click().catch(() => {});
    await look(`opening ${tabName} with the server gone`);
    for (const name of buttons) {
      if (await clickText(`^${name}`)) await look(`clicking "${name}" with the server gone`);
    }
  }
} catch (e) {
  note("sweep", "stopped early", e?.stack ?? e);
} finally {
  await browser?.close().catch(() => {});
  await stopDev();
  ai.close();
  rmSync(home, { recursive: true, force: true });
}

const shown = findings.filter((f) => !(f.area === "server stopped" && /request failed|console error|HTTP/.test(f.what)));
console.log(`\n${used.length} actions checked`);
if (process.env.SWEEP_LIST) console.log(used.map((u) => `  · ${u}`).join("\n"));
if (skipped.length) console.log(`\nNot clicked (they remove, reset, install, commit or push):\n  ${[...new Set(skipped)].join("\n  ")}`);
if (!shown.length) console.log("\nsweep:app passed: every control used, nothing went wrong");
else {
  console.log(`\nsweep:app found ${shown.length} problem(s):`);
  for (const f of shown) console.log(`  ✖ [${f.area}] ${f.what}\n      ${(f.area === "sweep" ? f.detail.split("\n").slice(0, 8).join("\n      ") : f.detail.split("\n")[0]).slice(0, 1200)}`);
  process.exitCode = 1;
}
