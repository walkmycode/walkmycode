// Where the time of one map interaction goes (docs/PERFORMANCE.md): opens the
// demo, shows everything, then records a Chrome trace of one action and sums
// the main thread's time by kind (script, style, layout, paint…), plus the
// hottest script functions from a CPU profile.
//
//   node scripts/perf-profile.mjs [open|everything|click|trace|pan|zoom|fly] [--base http://localhost:3100] [--cpu 4] [--channel msedge]
//
// fly: "components/TaskList to lib/db" in the go-to bar (a fly-through by names).
import { chromium } from "playwright";
import { emptySpot } from "./perf-spot.mjs";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? dflt : process.argv[i + 1];
};
const ACTION = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "click";
const BASE = arg("base", "http://localhost:3100");
const CPU = Number(arg("cpu", "1"));
const CARD = "file:lib/tasks.ts";
const FLY = arg("fly", "components/TaskList to lib/db");

// Chrome, then Edge, then Playwright's own Chromium (or --channel).
const CHANNELS = arg("channel") ? [arg("channel")] : ["chrome", "msedge", undefined];
let browser;
for (const channel of CHANNELS) {
  browser = await chromium.launch({ ...(channel ? { channel } : {}), headless: true }).catch(() => null);
  if (browser) break;
}
if (!browser) throw new Error("no browser to launch");
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const logs = [];
page.on("console", (m) => logs.push(m.text()));
await page.goto(`${BASE}/`);
const button = (text) => page.evaluate((t) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === t)?.click(), text);
/** The demo's card on the home page (the indexed one, "Open the map of team-tasks"), or the old connect screen's button. */
const openDemo = () =>
  page
    .getByRole("button", { name: "Open the map of team-tasks", exact: true })
    .or(page.getByRole("button", { name: "team-tasks", exact: true }))
    .first()
    .click();
if (ACTION !== "open") {
  await openDemo();
  await page.waitForSelector(".react-flow__node", { timeout: 120000 });
}
if (ACTION !== "everything" && ACTION !== "open") {
  await button("show everything");
  await page.waitForFunction(() => document.querySelectorAll(".react-flow__edge").length > 300);
  await page.waitForTimeout(1500);
}
if (ACTION === "trace") {
  await page.evaluate((id) => document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`).click(), CARD);
  await page.waitForTimeout(1500);
}
// --eval "<js>": run in the page just before the action (for experiments).
if (arg("eval")) await page.evaluate(arg("eval"));
// Where to drag or wheel from, found before recording (each probe is a hit test).
const { x: cx, y: cy } = ACTION === "pan" || ACTION === "zoom" ? await emptySpot(page) : { x: 0, y: 0 };
if (ACTION === "fly") {
  await page.keyboard.press("Control+k");
  await page.fill(".palette input", FLY);
  await page.waitForTimeout(400);
}
if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });

await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
const events = [];
cdp.on("Tracing.dataCollected", (d) => events.push(...d.value));
await cdp.send("Tracing.start", { categories: process.env.CATS ?? "devtools.timeline,disabled-by-default-devtools.timeline", transferMode: "ReportEvents" });
await cdp.send("Profiler.start");
const t0 = Date.now();
const transform = () => page.evaluate(() => document.querySelector(".react-flow__viewport")?.style.transform);
console.log("viewport before:", await transform());
if (ACTION === "fly") {
  // Typed before the recording: only the Enter and the flight are recorded.
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".flybar")?.dataset.status === "done", null, { timeout: 20000 }).catch(() => {});
} else if (ACTION === "open") {
  await openDemo();
  await page.waitForSelector(".react-flow__node", { timeout: 120000 });
} else if (ACTION === "everything") await button("show everything");
else if (ACTION === "click") await page.evaluate((id) => document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`).click(), CARD);
else if (ACTION === "trace") await button("Trace it");
else if (ACTION === "pan") {
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i < 60; i++) {
    await page.mouse.move(cx + Math.sin(i / 6) * 200, cy + Math.cos(i / 6) * 120);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
} else if (ACTION === "zoom") {
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, i < 20 ? -60 : 60);
    await page.waitForTimeout(25);
  }
}
console.log("viewport after the action:", await transform());
await page.waitForTimeout(3000);
const { profile } = await cdp.send("Profiler.stop");
if (process.env.LOGS) console.log(logs.slice(-Number(process.env.LOGS)).join("\n"));
const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
await cdp.send("Tracing.end");
await done;
console.log(`${ACTION}: recorded ${Date.now() - t0} ms, CPU slowdown ${CPU}x`);

// Main-thread time by event name (top-level slices only, so nothing is counted twice).
const main = events.find((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain");
const byName = new Map();
const slices = events.filter((e) => e.ph === "X" && e.pid === main?.pid && e.tid === main?.tid && e.dur).sort((a, b) => a.ts - b.ts);
const self = new Map();
// Self time per event name: subtract children.
const stack = [];
for (const e of slices) {
  while (stack.length && stack[stack.length - 1].ts + stack[stack.length - 1].dur <= e.ts) stack.pop();
  const parent = stack[stack.length - 1];
  if (parent) self.set(parent, (self.get(parent) ?? parent.dur) - e.dur);
  if (!self.has(e)) self.set(e, e.dur);
  stack.push(e);
}
for (const [e, t] of self) byName.set(e.name, (byName.get(e.name) ?? 0) + t / 1000);
console.log("\nmain thread self time by kind (ms):");
for (const [n, t] of [...byName].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`  ${t.toFixed(1).padStart(8)}  ${n}`);

// Hottest functions (self time) from the CPU profile.
const dt = new Map();
profile.samples.forEach((id, i) => dt.set(id, (dt.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
const fn = new Map();
for (const n of profile.nodes) {
  const t = (dt.get(n.id) ?? 0) / 1000;
  if (!t) continue;
  const f = n.callFrame;
  const key = `${f.functionName || "(anonymous)"} ${f.url.split("/").pop()}:${f.lineNumber}:${f.columnNumber}`;
  fn.set(key, (fn.get(key) ?? 0) + t);
}
console.log("\nhottest functions, self time (ms):");
for (const [k, t] of [...fn].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${t.toFixed(1).padStart(8)}  ${k}`);
await browser.close();
