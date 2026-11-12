// npm run e2e:parakeet, after npm run build:mcp: on-device speech to text end
// to end, with no human at the microphone (docs/VOICE.md §4d). Chrome is given
// a recording as its microphone (--use-file-for-fake-audio-capture: the speech
// model's own test recording), and the real pages hear it:
//  1. WalkMyCode for Claude's page (the built MCP server, started from a
//     terminal on the example project, Team Tasks): Settings → Voice → "On this
//     computer (Parakeet)" is chosen and saved; one tap on Talk in the Guide;
//     the words appear as previews while the recording plays and the final
//     text arrives when it stops.
//  2. With APP_URL set (the full app, e.g. http://localhost:3200): the Learn
//     professor's mic button writes the same recording into the question box.
// Needs the speech model on this machine (iReliabee's copy or WalkMyCode's
// own) and Google Chrome. Screenshots go to OUT_DIR (default: e2e-parakeet/
// in the system's temp folder). Exits non-zero on the first failure.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = join(root, "mcp", "dist", "server.mjs");
const NAME = "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8";
const modelDir = [process.env.WALKMYCODE_IRELIABEE_MODELS_DIR ?? join(homedir(), ".local", "share", "ireliabee", "models"), process.env.WALKMYCODE_MODELS_DIR ?? join(homedir(), ".walkmycode", "models")].map((d) => join(d, NAME)).find((d) => existsSync(join(d, "tokens.txt")));
const wavs = modelDir ? join(modelDir, "test_wavs") : "";
const wavName = wavs && existsSync(wavs) ? readdirSync(wavs).find((f) => f.endsWith(".wav")) : undefined;
if (!modelDir || !wavName) {
  console.error("e2e:parakeet needs the speech model with its test_wavs on this machine.");
  process.exit(1);
}
if (!existsSync(server)) {
  console.error("e2e:parakeet needs the MCP bundle: run npm run build:mcp first.");
  process.exit(1);
}

const out = process.env.OUT_DIR || join(tmpdir(), "e2e-parakeet");
mkdirSync(out, { recursive: true });
const home = mkdtempSync(join(tmpdir(), "walkmycode-e2e-parakeet-"));
// Chrome reads the recording from a path of our own (no spaces, nothing else beside it).
const wav = join(home, "mic.wav");
copyFileSync(join(wavs, wavName), wav);
const step = (s) => console.log(`✔ ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** What the recording says (LibriSpeech; the model's test_wavs/0.wav). */
const SAID = [/don't wish to see it any more/i, /turning away her eyes/i, /very like the old portrait/i];

/** The browser's own voice, recorded instead of heard; speech recognition is left alone (and unused). */
function stubSpeaking() {
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
}

async function launch() {
  const args = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}%noloop`, "--autoplay-policy=no-user-gesture-required"];
  const browser = await chromium.launch({ channel: "chrome", headless: true, args }).catch(() => chromium.launch({ headless: true, args }));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-GB" });
  await context.addInitScript(stubSpeaking);
  return { browser, context };
}

/** Every event the stream route sent this page, in order, with when. */
function watchStream(page) {
  const events = [];
  const t0 = Date.now();
  page.on("response", (r) => {
    if (!r.url().endsWith("/api/voice/parakeet/stream")) return;
    void r
      .json()
      .then((b) => {
        for (const e of b.events ?? []) events.push({ ...e, at: (Date.now() - t0) / 1000 });
        if (r.status() !== 200) events.push({ type: "http", status: r.status(), body: b, at: (Date.now() - t0) / 1000 });
      })
      .catch(() => {});
  });
  return events;
}

function checkHeard(events, where) {
  const types = events.map((e) => e.type);
  const partials = events.filter((e) => e.type === "partial");
  const finals = events.filter((e) => e.type === "final" && e.text);
  assert.ok(!events.some((e) => e.type === "error" || e.type === "http"), `${where}: no errors: ${JSON.stringify(events.filter((e) => e.type === "error" || e.type === "http"))}`);
  assert.ok(types.includes("speech"), `${where}: speech was detected: ${types.join(",")}`);
  assert.ok(partials.length >= 2, `${where}: partial previews arrived: ${partials.length}`);
  assert.ok(finals.length >= 1, `${where}: a final arrived: ${types.join(",")}`);
  const text = finals.map((e) => e.text).join(" ");
  for (const re of SAID) assert.match(text, re, `${where}: the final text is right`);
  return { partials, finals, text };
}

let child;
let browser;
const errors = [];
try {
  // ── 1. Talk in the Guide, on WalkMyCode for Claude's page ──
  child = spawn(process.execPath, [server, join(root, "examples", "team-tasks")], { env: { ...process.env, WALKMYCODE_HOME: home, WALKMYCODE_NO_BROWSER: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  let printed = "";
  child.stdout.on("data", (d) => (printed += d));
  child.stderr.on("data", (d) => (printed += d));
  let url;
  for (let i = 0; i < 300 && !url; i++) {
    url = /Page: (\S+)/.exec(printed)?.[1];
    if (!url) await sleep(100);
  }
  assert.ok(url, `the server printed its page: ${printed.slice(-600)}`);
  step(`WalkMyCode started from a terminal on Team Tasks: ${new URL(url).origin}`);

  let ctx = await launch();
  browser = ctx.browser;
  let page = await ctx.context.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(url);
  await page.locator(".react-flow__node").first().waitFor({ timeout: 30_000 });
  step(`the page drew the map (${await page.locator(".react-flow__node").count()} cards)`);

  // Settings → Voice: choose "On this computer (Parakeet)" and save.
  await page.locator('.top [aria-label="Settings"]').first().click();
  await page.getByRole("tab", { name: /Voice/ }).first().click().catch(async () => page.getByRole("button", { name: /^Voice/ }).first().click());
  const chip = page.locator('[data-testid="stt-parakeet"]');
  await chip.waitFor({ timeout: 10_000 });
  await chip.scrollIntoViewIfNeeded();
  await chip.click();
  const panel = page.locator('[data-testid="parakeet-panel"]');
  await panel.waitFor({ timeout: 10_000 });
  assert.equal(await panel.getAttribute("data-state"), "installed", `the model is on this computer: ${await panel.innerText()}`);
  const line = await page.locator('[data-testid="parakeet-line"]').innerText();
  const credit = (await page.locator('[data-testid="parakeet-credit"]').innerText()).replace(/\s+/g, " ");
  assert.equal(credit, "Speech model: NVIDIA Parakeet-TDT 0.6B v2, used under the CC-BY-4.0 licence, run with sherpa-onnx.");
  assert.equal(await page.locator('[data-testid="parakeet-credit"] a').count(), 3, "the credit's three links");
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(out, "1-settings-voice-parakeet.png") });
  await page.getByRole("button", { name: "Save voice" }).click();
  await page.locator(".sv-status", { hasText: /Saved/i }).first().waitFor({ timeout: 10_000 });
  const saved = await page.evaluate(() => fetch("/api/voice/config").then((r) => r.json()));
  assert.equal(saved.saved.stt, "parakeet");
  assert.equal(saved.parakeet.ready, true);
  step(`Settings → Voice: "On this computer (Parakeet)" chosen and saved. It says: "${line}"`);
  await page.screenshot({ path: join(out, "2-settings-voice-saved.png") });

  // Back to the map; Talk now hears on this computer.
  await page.goto(new URL(url).origin);
  await page.locator(".react-flow__node").first().waitFor({ timeout: 30_000 });
  const talk = page.locator('[data-testid="claude-talk"][data-via="parakeet"]');
  // The Guide shares its side of the dock with Settings: bring it to the front.
  await talk.waitFor({ state: "attached", timeout: 15_000 });
  if (!(await talk.isVisible())) await page.locator(".dv-tab", { hasText: /^\s*Guide\s*$/ }).first().click();
  await talk.waitFor({ timeout: 15_000 });
  // The model loads when the pointer reaches Talk: wait for it, as a person's tap a moment later would find it.
  await talk.hover();
  for (let i = 0; i < 100; i++) {
    const s = await page.evaluate(() => fetch("/api/voice/parakeet").then((r) => r.json()));
    if (s.engine.state === "ready") {
      step(`the model loaded when the pointer reached Talk: ${s.engine.loadMs} ms, ${s.engine.threads} threads, ${s.source}'s copy`);
      break;
    }
    assert.notEqual(s.engine.state, "failed", s.engine.error);
    await sleep(200);
  }
  let events = watchStream(page);
  const heard = [];
  await talk.click();
  await page.locator('[data-testid="claude-talk-pill"]').waitFor({ timeout: 10_000 });
  step("one tap on Talk: the conversation is listening (Chrome's microphone is the recording)");
  let shot = false;
  for (let i = 0; i < 300 && !events.some((e) => e.type === "final" && e.text); i++) {
    const t = await page.locator('[data-testid="talk-heard"]').innerText({ timeout: 200 }).catch(() => "");
    if (t && heard.at(-1) !== t) heard.push(t);
    if (!shot && events.filter((e) => e.type === "partial").length >= 3) {
      shot = true;
      await page.screenshot({ path: join(out, "3-talk-partial.png") });
    }
    await sleep(100);
  }
  await sleep(600);
  const last = await page.locator('[data-testid="talk-heard"]').innerText({ timeout: 500 }).catch(() => "");
  if (last && heard.at(-1) !== last) heard.push(last);
  await page.screenshot({ path: join(out, "4-talk-final.png") });
  let got = checkHeard(events, "Talk");
  assert.ok(heard.some((h) => /^“.*(wish|well)/i.test(h)), `the words showed under the question box as they came: ${JSON.stringify(heard.slice(0, 6))}`);
  assert.ok(heard.some((h) => SAID[2].test(h)), `the whole sentence showed: ${JSON.stringify(heard.slice(-4))}`);
  step(`Talk heard it: ${got.partials.length} previews (first at ${got.partials[0].at.toFixed(1)} s: "${got.partials[0].text}"), final in ${got.finals[0].ms} ms`);
  step(`final: "${got.text}"`);
  step(`on the page: ${heard.slice(0, 3).map((h) => JSON.stringify(h)).join(" → ")} … ${JSON.stringify(heard.at(-1))}`);
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="claude-talk"]').waitFor({ timeout: 5_000 });
  step("Esc ended the talk");
  await browser.close();
  browser = undefined;

  // ── 2. The Learn professor's mic, in the full app ──
  if (process.env.APP_URL) {
    const app = process.env.APP_URL.replace(/\/$/, "");
    ctx = await launch();
    browser = ctx.browser;
    page = await ctx.context.newPage();
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${app}/learn`);
    const res = await page.evaluate(() => fetch("/api/voice/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stt: "parakeet" }) }).then((r) => r.json()));
    assert.equal(res.saved.stt, "parakeet");
    assert.equal(res.parakeet.ready, true, "the app's server has the model and the engine");
    await page.reload();
    const mic = page.locator('.composer .ctl.mic[data-via="parakeet"]');
    if (!(await mic.count())) await (process.env.LEARN_OPEN ? page.locator(process.env.LEARN_OPEN).first() : page.locator(".learn a, .learn button").filter({ hasText: /Start|Continue|Open|lesson/i }).first()).click();
    await mic.waitFor({ timeout: 30_000 });
    await mic.hover();
    for (let i = 0; i < 100; i++) {
      const s = await page.evaluate(() => fetch("/api/voice/parakeet").then((r) => r.json()));
      if (s.engine.state === "ready") {
        step(`the app's server loaded the model: ${s.engine.loadMs} ms`);
        break;
      }
      assert.notEqual(s.engine.state, "failed", s.engine.error);
      await sleep(200);
    }
    events = watchStream(page);
    const box = page.locator(".composer textarea");
    await mic.click();
    let shotLearn = false;
    const typed = [];
    for (let i = 0; i < 300 && !events.some((e) => e.type === "final" && e.text); i++) {
      const t = await box.inputValue();
      if (t && typed.at(-1) !== t) typed.push(t);
      if (!shotLearn && events.filter((e) => e.type === "partial").length >= 3) {
        shotLearn = true;
        await page.screenshot({ path: join(out, "5-learn-mic-partial.png") });
      }
      await sleep(100);
    }
    await mic.click(); // stop: drains what is left
    await page.locator('.composer .ctl.mic[aria-pressed="false"]').waitFor({ timeout: 10_000 });
    got = checkHeard(events, "Learn mic");
    const text = await box.inputValue();
    for (const re of SAID) assert.match(text, re, "the question box holds what was said");
    assert.ok(typed.length >= 3, `the box filled in as it was said: ${typed.length} states`);
    await page.screenshot({ path: join(out, "6-learn-mic-final.png") });
    step(`the Learn mic wrote it into the question box: ${got.partials.length} previews, final in ${got.finals[0].ms} ms: "${text}"`);
    await page.evaluate(() => fetch("/api/voice/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stt: "browser" }) }));
    await browser.close();
    browser = undefined;
  } else console.log("﹣ the Learn mic was not run: set APP_URL to the full app (e.g. http://localhost:3200)");

  const real = errors.filter((e) => !/favicon|ERR_ABORTED|Failed to load resource/.test(e));
  assert.deepEqual(real, [], "no errors on the pages");
  console.log(`\nScreenshots: ${out}`);
} catch (e) {
  console.error(`\n✖ ${e?.message ?? e}`);
  if (errors.length) console.error(`page errors:\n${errors.slice(0, 10).join("\n")}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  child?.kill();
  await sleep(300);
  rmSync(home, { recursive: true, force: true });
}
